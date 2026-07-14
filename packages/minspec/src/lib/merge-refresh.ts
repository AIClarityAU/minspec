/**
 * Merge-on-refresh — section-level merge for harness file regeneration.
 *
 * Strategy:
 *   1. Parse both existing and generated files into sections (## headings)
 *   2. For each section in the new template:
 *      - If section exists in user file AND was modified (hash differs from
 *        last generation) → keep user version
 *      - If section exists in user file AND is unmodified → regenerate from template
 *      - If section is new in template → append
 *   3. Sections in user file not in template → preserve at end
 *   4. Store section hashes in .minspec/generated-hashes.json
 *
 * Pure logic, no vscode dependency.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/** Section hash map: heading → SHA-256 hash of section body */
export interface SectionHashes {
  readonly [heading: string]: string;
}

/** Persisted hashes for all generated files */
export interface GeneratedHashes {
  readonly [filePath: string]: SectionHashes;
}

/** A parsed section: heading + body content */
export interface Section {
  readonly heading: string;
  readonly body: string;
}

/** Result of a merge operation */
export interface MergeResult {
  readonly merged: string;
  readonly newHashes: SectionHashes;
}

/**
 * Parse markdown content into sections delimited by `## ` headings.
 * The content before the first heading is stored under the key "__preamble__".
 */
export function parseSections(content: string): Section[] {
  const sections: Section[] = [];
  if (typeof content !== 'string') return sections;
  const lines = content.split('\n');
  let currentHeading = '__preamble__';
  let currentBody: string[] = [];

  const flush = () => {
    sections.push({
      heading: currentHeading,
      body: currentBody.join('\n'),
    });
    currentBody = [];
  };

  for (const line of lines) {
    const match = line.match(/^## (.+)$/);
    if (match) {
      flush();
      currentHeading = match[1];
    } else {
      currentBody.push(line);
    }
  }
  flush();

  return sections;
}

/**
 * SHA-256 hash of section content (trimmed to ignore trailing whitespace).
 * Deterministic — same content always produces the same hash.
 */
export function hashSection(content: string): string {
  return crypto.createHash('sha256').update(content.trim()).digest('hex');
}

/**
 * Rebuild markdown from sections array.
 */
function sectionsToMarkdown(sections: Section[]): string {
  const parts: string[] = [];
  for (const section of sections) {
    if (section.heading === '__preamble__') {
      parts.push(section.body);
    } else {
      parts.push(`## ${section.heading}`);
      parts.push(section.body);
    }
  }
  // Join, normalize trailing whitespace
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * Build a hash map for all sections in the content.
 */
export function buildSectionHashes(sections: Section[]): SectionHashes {
  const hashes: Record<string, string> = {};
  for (const section of sections) {
    hashes[section.heading] = hashSection(section.body);
  }
  return hashes;
}

/**
 * Whether a section body contains at least one authored markdown list item
 * (numbered or bulleted), ignoring HTML comments. The constitution's content
 * sections (Invariants/Principles/Constraints/Goals) express their content as
 * lists; the bundled template ships them as a descriptive sentence plus
 * commented-out example placeholders — i.e. prose but NO real list items. This
 * is the signal the merge uses to refuse replacing populated human content with
 * an unfilled template scaffold (#706, INV-2).
 */
export function hasAuthoredListItems(body: string): boolean {
  const withoutComments = body.replace(/<!--[\s\S]*?-->/g, '');
  return withoutComments.split('\n').some((line) => /^\s*(?:\d+\.|[-*])\s+\S/.test(line));
}

/**
 * Merge an existing file with a newly generated version, using stored hashes
 * to determine which sections the user has modified.
 *
 * @param existing   - Current file content on disk
 * @param generated  - Freshly rendered template content
 * @param oldHashes  - Section hashes from the last generation (from generated-hashes.json)
 * @returns merged content + new hashes for storage
 */
export function mergeFile(
  existing: string,
  generated: string,
  oldHashes: SectionHashes,
): MergeResult {
  const existingSections = parseSections(existing);
  const generatedSections = parseSections(generated);

  // Index existing sections by heading as an occurrence-ordered queue.
  // A plain Map<string,string> would collapse duplicate-named headings and
  // silently drop one section's body (#153). We retain every occurrence and
  // consume them positionally instead.
  const existingByHeading = new Map<string, Section[]>();
  for (const s of existingSections) {
    const queue = existingByHeading.get(s.heading);
    if (queue) {
      queue.push(s);
    } else {
      existingByHeading.set(s.heading, [s]);
    }
  }
  // Track which existing sections have been consumed (by reference identity)
  // so the preserve pass can append everything left over — including extra
  // duplicate occurrences — verbatim.
  const consumed = new Set<Section>();

  const mergedSections: Section[] = [];
  const newHashes: Record<string, string> = {};

  // Process sections in the order they appear in the new template
  for (const genSection of generatedSections) {
    const heading = genSection.heading;
    const queue = existingByHeading.get(heading);
    const existSection = queue && queue.length > 0 ? queue.shift()! : undefined;

    if (existSection) {
      // Section exists in both files — consume the first unmatched occurrence.
      consumed.add(existSection);
      const existingBody = existSection.body;
      const existingHash = hashSection(existingBody);
      const oldHash = oldHashes[heading];

      if (hasAuthoredListItems(existingBody) && !hasAuthoredListItems(genSection.body)) {
        // INV-2 guard (#706): never replace populated human content with an
        // unfilled template scaffold. The constitution's content sections
        // (Invariants/Principles/Constraints/Goals) ship as descriptive prose +
        // commented example placeholders — prose but no real list items — so the
        // "unmodified → use template" path below would silently destroy
        // hand-authored list content, whether because no baseline hash was
        // recorded for the section or because seedConstitution laundered the
        // human content into the baseline (existingHash === oldHash). If the
        // user's section has authored list items and the template's has none,
        // preserve the user's content regardless of the hashes.
        mergedSections.push({ heading, body: existingBody });
        newHashes[heading] = existingHash;
      } else if (oldHash && existingHash !== oldHash) {
        // User modified this section → keep user version
        mergedSections.push({ heading, body: existingBody });
        newHashes[heading] = existingHash;
      } else {
        // Section unmodified (or no previous hash → first refresh) → use new template
        mergedSections.push({ heading, body: genSection.body });
        newHashes[heading] = hashSection(genSection.body);
      }
    } else {
      // New section in template → append from template
      mergedSections.push({ heading, body: genSection.body });
      newHashes[heading] = hashSection(genSection.body);
    }
  }

  // Preserve every existing section the template did not consume — in original
  // document order. This covers both user-added sections (heading absent from
  // template) and surplus occurrences of duplicate-named headings, so no user
  // content is ever dropped (#153).
  for (const existSection of existingSections) {
    if (consumed.has(existSection)) continue;
    mergedSections.push(existSection);
    // Only record a tracking hash if this heading has no hash yet, so the
    // first occurrence's hash (used for modified-detection) is not clobbered
    // by a later duplicate.
    if (!(existSection.heading in newHashes)) {
      newHashes[existSection.heading] = hashSection(existSection.body);
    }
  }

  return {
    merged: sectionsToMarkdown(mergedSections),
    newHashes,
  };
}

export const HASHES_FILENAME = 'generated-hashes.json';

/**
 * Load persisted section hashes from .minspec/generated-hashes.json.
 * Returns empty object if file doesn't exist or is invalid.
 */
export function loadHashes(rootDir: string): GeneratedHashes {
  const hashesPath = path.join(rootDir, '.minspec', HASHES_FILENAME);
  if (!fs.existsSync(hashesPath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(hashesPath, 'utf-8');
    return JSON.parse(raw) as GeneratedHashes;
  } catch {
    return {};
  }
}

/**
 * Save section hashes to .minspec/generated-hashes.json.
 */
export function saveHashes(rootDir: string, hashes: GeneratedHashes): void {
  const hashesPath = path.join(rootDir, '.minspec', HASHES_FILENAME);
  fs.mkdirSync(path.dirname(hashesPath), { recursive: true });
  fs.writeFileSync(hashesPath, JSON.stringify(hashes, null, 2) + '\n');
}

export const TEMPLATE_BASELINE_FILENAME = 'template-baseline.json';

/**
 * Load the raw-template section-hash baseline from
 * `.minspec/template-baseline.json`.
 *
 * This records the hash of each *unrendered* bundled template section (with
 * `{{placeholders}}` intact) as of the last generate/refresh — the like-for-like
 * reference `hasHarnessDrift` compares the current bundled template against. It
 * is deliberately SEPARATE from `generated-hashes.json`, which stores
 * rendered + user-merged content hashes for edit preservation. Comparing the raw
 * template against those rendered/merged hashes is what produced the perpetual
 * false-positive drift toast (#117): a raw `{{projectName}}` never hash-matches
 * the rendered project name.
 *
 * Returns `{}` if the file is missing or invalid.
 */
export function loadTemplateBaseline(rootDir: string): GeneratedHashes {
  const baselinePath = path.join(rootDir, '.minspec', TEMPLATE_BASELINE_FILENAME);
  if (!fs.existsSync(baselinePath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(baselinePath, 'utf-8');
    return JSON.parse(raw) as GeneratedHashes;
  } catch {
    return {};
  }
}

/**
 * Persist the raw-template baseline to `.minspec/template-baseline.json`.
 * Written at every generate/refresh so drift detection always has a current
 * like-for-like reference. See {@link loadTemplateBaseline}.
 */
export function saveTemplateBaseline(rootDir: string, baseline: GeneratedHashes): void {
  const baselinePath = path.join(rootDir, '.minspec', TEMPLATE_BASELINE_FILENAME);
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Managed-region merge (#249, DR-037)
//
// Generalizes the existing `<!-- minspec:dr-index:start -->` marker convention to
// ANY file type via a per-call comment style. A managed region is the content
// between a start and end marker; on refresh MinSpec overwrites ONLY that region
// and preserves everything outside it verbatim. No content baseline is needed —
// the markers ARE the boundary, so user edits outside the region always survive and
// MinSpec's region is always brought current (unlike a whole-file preserve-on-edit
// rule, which one stray edit could freeze forever).
// ---------------------------------------------------------------------------

/** Parsed split of a file around a single managed region. */
export interface ManagedRegionSplit {
  /** Everything before the start marker (start marker excluded). */
  readonly before: string;
  /** Everything after the end marker (end marker excluded). */
  readonly after: string;
}

/**
 * Locate a managed region delimited by `startMarker` … `endMarker` (exact,
 * trimmed line matches) and return the content surrounding it. Returns `null` when
 * the markers are missing, out of order, or incomplete — the caller MUST treat a
 * `null` as "no recognizable region" and never clobber the file (never-wrong: a
 * deleted/corrupted marker is a skip-and-warn, not a silent whole-file overwrite).
 *
 * Matching is whole-line and whitespace-tolerant (the marker line may be indented
 * or trailing-padded) so reasonable hand-formatting of the surrounding file does
 * not break detection, while still requiring the exact marker text.
 */
export function splitManagedRegion(
  content: string,
  startMarker: string,
  endMarker: string,
): ManagedRegionSplit | null {
  if (typeof content !== 'string') return null;
  const lines = content.split('\n');

  let startIdx = -1;
  let endIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (startIdx === -1) {
      if (trimmed === startMarker) startIdx = i;
    } else if (trimmed === endMarker) {
      endIdx = i;
      break;
    }
  }

  // Both markers must be present, in order, and the end must follow the start.
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;

  const before = lines.slice(0, startIdx).join('\n');
  const after = lines.slice(endIdx + 1).join('\n');
  return { before, after };
}

/**
 * Rebuild a file from its preserved surroundings and a freshly rendered managed
 * block. Joins `before` + block + `after`, collapsing the seams so the block is
 * separated from non-empty surrounding content by exactly one blank line and no
 * stray leading/trailing whitespace accumulates across refreshes (idempotent: a
 * refresh that re-inserts the same block produces byte-identical output).
 *
 * Surrounding content is whitespace-trimmed at the seams (the user's own
 * non-whitespace bytes are preserved verbatim); the result ends in exactly one
 * trailing newline.
 */
export function spliceManagedRegion(
  split: ManagedRegionSplit,
  block: string,
): string {
  const beforeTrim = split.before.replace(/\s+$/, '');
  const afterTrim = split.after.replace(/^\s+/, '').replace(/\s+$/, '');
  const blockTrim = block.replace(/^\n+/, '').replace(/\n+$/, '');

  let out = '';
  if (beforeTrim.length > 0) out += beforeTrim + '\n\n';
  out += blockTrim + '\n';
  if (afterTrim.length > 0) out += '\n' + afterTrim + '\n';
  return out;
}
