/**
 * constitution-proposer.ts — SPEC-025 FR-3 (seam) + FR-4 (integrate) +
 * FR-5 (deterministic seed) + FR-7 (review-time provenance).
 *
 * Defines the {@link ConstitutionProvider} interface that BOTH the deterministic
 * seed (built now) and a future LLM provider (the Tier-1 `agent-execute`
 * extension, deferred) satisfy — so FR-3 slots in with no rework. Implements the
 * offline {@link seedProvider} (FR-5: a fixed Signal→Candidate catalog that is
 * never empty for a non-empty manifest), and {@link integrateProposal} (FR-4:
 * whole-doc, additive, DRAFT-marked, idempotent, never overwriting human /
 * non-DRAFT content, injecting `## Goals` if absent).
 *
 * INVARIANTS (T0 — see constitution-invariants.test.ts):
 *  - INV-1 Tier-0. No `vscode`, no network, no exec. The seed never calls a model
 *    or the network; integrate is pure markdown composition.
 *  - INV-2 Never assert, never overwrite. Every candidate is `draft: true` and
 *    rendered with a DRAFT marker. A section already holding human (non-DRAFT)
 *    content is left byte-untouched. Re-running adds only what is absent
 *    (idempotent / additive).
 *  - INV-4 Degrade, never block. {@link buildSeedProposal} returns ≥1 candidate
 *    for any non-empty manifest; integrate never produces an empty constitution.
 *
 * Pure logic, no vscode dependency.
 */

import {
  parseSections,
  type Section,
} from './merge-refresh';
import type {
  ContextManifest,
  ConstitutionSection,
  ConstitutionSignal,
} from './constitution-context';

export type { ConstitutionSection } from './constitution-context';

/** The constitution's fixed section schema (FR-2 / FR-4). */
export interface SectionSchema {
  readonly sections: ConstitutionSection[];
}

/** The canonical four-section schema, in document order. */
export const CONSTITUTION_SECTION_SCHEMA: SectionSchema = {
  sections: ['Invariants', 'Principles', 'Constraints', 'Goals'],
};

/**
 * One proposed entry, always marked DRAFT, carrying review-time-only provenance
 * (FR-7). `draft` is the literal `true` so a candidate can never be authored as
 * an asserted (human) rule (INV-2).
 */
export interface Candidate {
  readonly id: string;
  readonly section: ConstitutionSection;
  readonly text: string;
  readonly provenance: string;
  readonly draft: true;
}

/** A provider's full proposal: candidates to write + notable signals left unwritten. */
export interface Proposal {
  readonly candidates: Candidate[];
  /** Signals surfaced to the human but deliberately NOT written (FR-4 silence>noise). */
  readonly notableUnwritten: string[];
}

/**
 * The single contract both providers satisfy (the FR-3 seam). The deterministic
 * {@link seedProvider} (sync, offline, FR-5) and a future LLM provider (async,
 * `agent-execute`, FR-3) are interchangeable behind this type. `propose()` is
 * pure-data-in / proposal-out: it NEVER writes files ({@link integrateProposal}
 * does that) and the seed NEVER calls a model or the network (INV-1/INV-4).
 */
export interface ConstitutionProvider {
  propose(manifest: ContextManifest, schema: SectionSchema): Proposal | Promise<Proposal>;
}

// ─── Rendering / markers ──────────────────────────────────────────────────────

/** Prefix that marks a list item as a MinSpec-proposed DRAFT (INV-2). */
const DRAFT_MARKER = 'DRAFT:';

/** True if a list-item line is a MinSpec DRAFT entry. */
export function isDraftLine(line: string): boolean {
  const trimmed = line.trim();
  const m = trimmed.match(/^(?:[-*]|\d+\.)\s+(.*)$/);
  if (!m) return false;
  return m[1].trimStart().startsWith(DRAFT_MARKER);
}

/** A provenance blockquote line (review-time only, stripped by compaction). */
function isProvenanceLine(line: string): boolean {
  return line.trim().startsWith('> _proposed because');
}

/** Render one candidate as a DRAFT list item + a provenance blockquote (FR-7). */
function renderCandidate(c: Candidate): string {
  return `- ${DRAFT_MARKER} ${c.text}\n  > _proposed because ${c.provenance}_`;
}

/**
 * The text body of a DRAFT item, normalized for dedupe: lowercased, marker and
 * list bullet stripped, whitespace collapsed. Used so re-running never re-adds
 * an entry whose text already exists in the section (idempotence).
 */
function draftKey(text: string): string {
  return text
    .replace(/^(?:[-*]|\d+\.)\s+/, '')
    .replace(new RegExp(`^${DRAFT_MARKER}\\s*`), '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Does a section body already hold human (non-DRAFT) content? Constitution rules
 * are authored as list items, so human content is a non-DRAFT **list item**.
 * Comment-only / empty / DRAFT-only bodies — and the template's descriptive prose
 * paragraph under each heading — are NOT human content (so the seed may fill the
 * section). A single human-authored list item gates the whole section against the
 * seed (INV-2 non-overwrite).
 */
export function sectionHasHumanContent(body: string): boolean {
  let inComment = false;
  for (const raw of body.split('\n')) {
    const trimmed = raw.trim();
    if (inComment) {
      if (trimmed.includes('-->')) inComment = false;
      continue;
    }
    if (trimmed.startsWith('<!--')) {
      if (!trimmed.includes('-->')) inComment = true;
      continue;
    }
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue; // sub-heading
    if (isProvenanceLine(raw)) continue; // belongs to a DRAFT item
    if (isDraftLine(raw)) continue; // MinSpec DRAFT — not human
    // A non-DRAFT list item is a human-authored rule.
    if (/^(?:[-*]|\d+\.)\s+/.test(trimmed)) return true;
    // Otherwise a descriptive prose paragraph (template scaffolding) — not a rule.
  }
  return false;
}

/** Existing DRAFT item keys already present in a section body (for idempotence). */
function existingDraftKeys(body: string): Set<string> {
  const keys = new Set<string>();
  for (const line of body.split('\n')) {
    if (isDraftLine(line)) {
      const m = line.trim().match(/^(?:[-*]|\d+\.)\s+(.*)$/);
      if (m) keys.add(draftKey(m[1]));
    }
  }
  return keys;
}

// ─── FR-5: deterministic seed catalog ─────────────────────────────────────────

/** A fixed Signal-kind → candidate-text/provenance mapping (FR-5). */
interface SeedRule {
  readonly text: string;
  readonly provenance: string;
}

/**
 * The deterministic Signal→Candidate catalog. Each entry is shallow but concrete:
 * a rule the codebase already implies. Keyed by `SignalKind`. (Tier-0 packages
 * are handled specially below so each named package gets a distinct candidate.)
 */
const SEED_CATALOG: Partial<Record<ConstitutionSignal['kind'], SeedRule>> = {
  'no-network-deps': {
    text: 'Runs offline — no network calls without explicit user consent.',
    provenance: 'no runtime network-client dependency was detected',
  },
  'monorepo-layout': {
    text: 'Cross-package changes must respect workspace boundaries; no deep reach into another package’s internals.',
    provenance: 'a monorepo / workspaces layout was detected',
  },
  'node-engine': {
    text: 'Target the pinned Node engine range; do not rely on newer runtime features.',
    provenance: 'package.json pins an engines.node range',
  },
  'vscode-extension': {
    text: 'Keep extension activation cheap and side-effect-free; do not block the editor on init.',
    provenance: 'this package is a VS Code extension',
  },
  'has-claude-md': {
    text: 'Honor CLAUDE.md project instructions — they override default behavior.',
    provenance: 'a CLAUDE.md instructions file is present',
  },
  'has-decisions': {
    text: 'Record hard-to-reverse decisions as decision records before implementing.',
    provenance: 'a docs/decisions/ register is in use',
  },
  'has-epics': {
    text: 'Trace specs to their owning epic so scope ladders up to a goal.',
    provenance: 'docs/epics/ epics are tracked',
  },
};

/**
 * Build the deterministic seed proposal for a manifest (FR-5). For a non-empty
 * manifest this NEVER returns zero candidates (INV-4). Each candidate carries
 * `draft: true` and a non-empty provenance string (FR-7).
 */
export function buildSeedProposal(manifest: ContextManifest): Proposal {
  const candidates: Candidate[] = [];
  const seenKinds = new Set<string>();
  let n = 0;

  for (const signal of manifest.signals) {
    if (signal.kind === 'tier0-package') {
      const pkg = signal.id.replace(/^tier0-package:/, '');
      candidates.push({
        id: `SEED-${++n}`,
        section: 'Constraints',
        text: `${pkg} stays vscode/network-free (Tier-0) — no editor or network imports.`,
        provenance: `${pkg} is a vscode-free workspace package`,
        draft: true,
      });
      continue;
    }
    if (seenKinds.has(signal.kind)) continue;
    seenKinds.add(signal.kind);
    const rule = SEED_CATALOG[signal.kind];
    if (!rule) continue;
    candidates.push({
      id: `SEED-${++n}`,
      section: signal.section,
      text: rule.text,
      provenance: rule.provenance,
      draft: true,
    });
  }

  // notableUnwritten: signals we observed but did not turn into candidates
  // (FR-4 silence > noise). Seed catalog is intentionally shallow, so any signal
  // whose kind has no catalog entry (and isn't a tier0-package) is surfaced, not
  // written.
  const producedKinds = new Set<string>();
  for (const signal of manifest.signals) {
    if (signal.kind === 'tier0-package') producedKinds.add(signal.kind);
    else if (SEED_CATALOG[signal.kind]) producedKinds.add(signal.kind);
  }
  const notableUnwritten = manifest.signals
    .filter((s) => !producedKinds.has(s.kind))
    .map((s) => s.summary);

  return { candidates, notableUnwritten };
}

/** The deterministic, offline provider (FR-5). Satisfies the FR-3 seam. */
export const seedProvider: ConstitutionProvider = {
  propose(manifest: ContextManifest, _schema: SectionSchema): Proposal {
    void _schema;
    return buildSeedProposal(manifest);
  },
};

// ─── FR-4: integrate the proposal into the constitution ───────────────────────

/** Result of integrating a proposal into an existing constitution. */
export interface IntegrateResult {
  readonly merged: string;
  readonly added: Candidate[];
  readonly skipped: Candidate[];
}

/** Rebuild markdown from sections (mirrors merge-refresh's private composer). */
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
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * Append DRAFT candidate items to a section body, after any leading
 * comment/prose, returning the new body. Skips candidates whose text already
 * exists as a DRAFT item (idempotence).
 */
function appendCandidates(
  body: string,
  candidates: Candidate[],
  added: Candidate[],
  skipped: Candidate[],
): string {
  const existing = existingDraftKeys(body);
  const toAdd: Candidate[] = [];
  for (const c of candidates) {
    if (existing.has(draftKey(c.text))) {
      skipped.push(c);
    } else {
      existing.add(draftKey(c.text));
      toAdd.push(c);
      added.push(c);
    }
  }
  if (toAdd.length === 0) return body;

  const rendered = toAdd.map(renderCandidate).join('\n');
  // Preserve the section's existing body, ensure a clean blank-line separator.
  const trimmed = body.replace(/\s+$/, '');
  if (trimmed.length === 0) return '\n' + rendered + '\n';
  return trimmed + '\n' + rendered + '\n';
}

/**
 * Integrate a proposal into an existing constitution (FR-4).
 *
 * Whole-doc & additive: for each schema section, append the proposal's
 * candidates for that section *only if* the section holds no human (non-DRAFT)
 * content. Idempotent: re-running adds nothing already present. Never overwrites
 * human content (INV-2). Injects a `## Goals` section if absent.
 *
 * @param existing  current `.minspec/constitution.md` content
 * @param proposal  the provider's proposal (seed or LLM)
 */
export function integrateProposal(existing: string, proposal: Proposal): IntegrateResult {
  const added: Candidate[] = [];
  const skipped: Candidate[] = [];

  const sections = parseSections(existing && existing.trim() ? existing : '# Constitution\n');

  // Index sections by lowercased heading for lookup; keep array for ordering.
  const headingIndex = new Map<string, number>();
  sections.forEach((s, i) => {
    if (s.heading !== '__preamble__') headingIndex.set(s.heading.toLowerCase(), i);
  });

  // Ensure every schema section exists; inject (e.g. ## Goals) if absent.
  for (const sectionName of CONSTITUTION_SECTION_SCHEMA.sections) {
    if (!headingIndex.has(sectionName.toLowerCase())) {
      sections.push({ heading: sectionName, body: '\n' });
      headingIndex.set(sectionName.toLowerCase(), sections.length - 1);
    }
  }

  // Group candidates by their target section.
  const bySection = new Map<ConstitutionSection, Candidate[]>();
  for (const c of proposal.candidates) {
    const list = bySection.get(c.section) ?? [];
    list.push(c);
    bySection.set(c.section, list);
  }

  // Build a new sections array, appending candidates into empty sections only.
  const merged: Section[] = sections.map((s) => ({ ...s }));
  for (const [sectionName, candidates] of bySection) {
    const idx = headingIndex.get(sectionName.toLowerCase());
    if (idx === undefined) {
      // Section not in schema-known set (shouldn't happen) — skip all.
      for (const c of candidates) skipped.push(c);
      continue;
    }
    const section = merged[idx];
    if (sectionHasHumanContent(section.body)) {
      // INV-2: human content present → never touch. All candidates skipped.
      for (const c of candidates) skipped.push(c);
      continue;
    }
    merged[idx] = {
      heading: section.heading,
      body: appendCandidates(section.body, candidates, added, skipped),
    };
  }

  return {
    merged: sectionsToMarkdown(merged),
    added,
    skipped,
  };
}
