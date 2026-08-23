import * as fs from 'fs';
import { SPEC_STATUSES, stripInlineComment } from './spec-vocabulary';
import { assertOwnershipDeclaredForAdvance } from './ownership-advance-guard';
import type { SpecStatus } from './spec-vocabulary';
import type { Tier, Phase } from './config';
import { PHASES } from './config';
import { deriveStatus, phasesForApproval } from './lifecycle';
import { bodyStatusToken } from './status-parity';

/** Status of an individual phase */
export type PhaseStatus = 'pending' | 'in-progress' | 'done' | 'skipped';

/**
 * Lifecycle statuses of a spec, in lifecycle order. Single source of truth:
 * `SpecStatus` derives from this tuple, and consumers that must cover every
 * status (e.g. the tree's status lanes, SPEC-015 INV-1) import it so adding a
 * status here forces a decision everywhere it matters.
 */
// Moved to ./spec-vocabulary (#1446) so spec-validator can import them WITHOUT
// value-importing this module — that edge was the runtime cycle blocking the
// SPEC-051 ownership guard from reaching advanceSpecToImplementing below.
// Re-exported here so every existing `from './spec'` import site is unchanged.
export {
  SPEC_STATUSES,
  SPEC_TYPES,
  stripInlineComment,
} from './spec-vocabulary';
export type { SpecStatus, SpecType } from './spec-vocabulary';

/** A single task item within a phase section */
export interface TaskItem {
  readonly text: string;
  readonly done: boolean;
}

/** Parsed content of a phase section */
export interface PhaseContent {
  readonly status: PhaseStatus;
  readonly body: string;
  readonly tasks: TaskItem[];
}

/** YAML frontmatter for a spec file — Spec Kit compatible with MinSpec extensions */
export interface SpecFrontmatter {
  readonly id: string;
  readonly title: string;
  readonly tier: Tier;
  readonly status: SpecStatus;
  readonly created: string;
  readonly phases: Record<Phase, PhaseStatus>;
  /** Optional epic reference (EPIC-NNN id or slug). Absent = ungrouped. */
  readonly epic?: string;
  /**
   * Owning product slug (e.g. `minspec` / `scroogellm`) from the `product:`
   * frontmatter field. Drives the SPECS-pane product-prefix strip under epic
   * grouping (the H1 title carries a redundant `MinSpec — ` / `ScroogeLLM — `
   * prefix). Absent for single-product repos that omit the field.
   */
  readonly product?: string;
  /**
   * Split-layout phase-file kind: `requirements` | `design` | `tasks`. Present
   * when a spec is split across sibling files (one phase per file) rather than a
   * single file carrying all `## Phase` sections. Drives layout-aware validation
   * (a `design` file legitimately has no in-file `## Plan`). Absent = single-file.
   */
  readonly type?: string;
  /**
   * Successor reference for a `superseded` spec (SPEC-017 / #162): `superseded-by:
   * SPEC-NNN` names what wholly replaced this spec. A recognized, content-class
   * frontmatter field — required when `status: superseded` (validated by
   * `spec-validator.ts`), absent otherwise. Because it is a canonical-hashed
   * content field, adding it voids the live approval (SPEC-022), which M2's
   * wasted-review bar reads through the PRESERVED prior baseline, not the live one.
   */
  readonly supersededBy?: string;
}

/** Complete parsed spec */
export interface ParsedSpec {
  readonly frontmatter: SpecFrontmatter;
  readonly preamble: string;
  readonly sections: Map<string, string>;
  readonly phaseSections: Partial<Record<Phase, PhaseContent>>;
  readonly raw: string;
}

// --- Parser ---

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const TASK_RE = /^- \[([ xX])\] (.+)$/;
const HEADING_RE = /^## (.+)$/;
const H1_RE = /^# (.+)$/;

/**
 * Extract the first level-1 (`# `) heading text from a markdown body.
 * Used as the human title fallback when frontmatter has no `title:` field —
 * spec files carry their title in the first `# ` heading, not the frontmatter.
 * Returns '' when no level-1 heading exists.
 */
function firstH1Heading(body: string): string {
  for (const line of body.split('\n')) {
    const match = line.match(H1_RE);
    if (match) return match[1].trim();
  }
  return '';
}

/** Parse YAML frontmatter — lightweight, no dependency */

const PHASE_STATUSES = ['pending', 'in-progress', 'done', 'skipped'] as const;

/** Strip any inline comment, then validate against PhaseStatus (default pending). */
function phaseStatusOf(raw: unknown): PhaseStatus {
  if (typeof raw !== 'string') return 'pending';
  const v = stripInlineComment(raw);
  return (PHASE_STATUSES as readonly string[]).includes(v) ? (v as PhaseStatus) : 'pending';
}

function parseFrontmatterYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let nested: Record<string, string> | null = null;

  for (const line of yaml.split('\n')) {
    const trimmed = line.trimEnd();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Nested key (indented under a parent)
    if (/^\s{2,}\w/.test(line) && currentKey) {
      const stripped = trimmed.trim();
      const match = stripped.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
      if (match) {
        if (!nested) nested = {};
        nested[match[1]] = match[2].trim();
      }
      continue;
    }

    // Flush previous nested block. An empty-valued top-level key (e.g. `title:`
    // with nothing after it) opened a nested block that gained no children — that
    // is an empty scalar, NOT a nested object. Storing `{}` would defeat downstream
    // `?? firstH1Heading()` fallbacks (`{}` isn't nullish) and crash slugify
    // (`title.toLowerCase` is not a function) — #153.2. Store `''` instead.
    if (nested && currentKey) {
      result[currentKey] = Object.keys(nested).length === 0 ? '' : nested;
      nested = null;
    }

    // Top-level key
    const match = trimmed.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (match) {
      currentKey = match[1];
      const value = match[2].trim();
      if (value === '') {
        // Start of a nested block
        nested = {};
      } else {
        result[currentKey] = value;
        currentKey = null;
      }
    }
  }

  // Flush final nested block (same empty-block-is-an-empty-scalar rule, #153.2).
  if (nested && currentKey) {
    result[currentKey] = Object.keys(nested).length === 0 ? '' : nested;
  }

  return result;
}

/** Parse task items from markdown body */
function parseTasks(body: string): TaskItem[] {
  const tasks: TaskItem[] = [];
  for (const line of body.split('\n')) {
    const match = line.trim().match(TASK_RE);
    if (match) {
      tasks.push({ text: match[2], done: match[1] !== ' ' });
    }
  }
  return tasks;
}

/** Determine phase status from frontmatter phases map, falling back to body content */
function resolvePhaseStatus(phase: Phase, fmPhases: Record<string, string> | undefined, body: string): PhaseStatus {
  if (fmPhases && fmPhases[phase]) {
    const raw = stripInlineComment(fmPhases[phase]);
    if (['pending', 'in-progress', 'done', 'skipped'].includes(raw)) {
      return raw as PhaseStatus;
    }
  }
  // Infer from content
  const tasks = parseTasks(body);
  if (tasks.length === 0 && body.trim() === '') return 'pending';
  if (tasks.length > 0 && tasks.every(t => t.done)) return 'done';
  if (tasks.some(t => t.done) || body.trim().length > 0) return 'in-progress';
  return 'pending';
}

/**
 * Parse a spec markdown file into structured data.
 * Handles Spec Kit format (YAML frontmatter + ## sections).
 */
export function parseSpec(content: string): ParsedSpec {
  // Normalize line endings up front (#153.3). FRONTMATTER_RE (and the validator's
  // own frontmatter-block regex, which reads `spec.raw`) anchor on `\n`, so a CRLF
  // (`\r\n`) or old-Mac (`\r`) spec failed to match — id came out '' and the spec
  // was silently dropped from listSpecs. Single-point normalization here covers
  // every read seam that flows through the parser (readSpecFile, readSpecKitDir,
  // the custom editor, …); writeSpec always emits `\n`, so this loses nothing.
  const normalized = content.replace(/\r\n?/g, '\n');
  const raw = normalized;

  // Extract frontmatter
  const fmMatch = normalized.match(FRONTMATTER_RE);
  const fmRaw = fmMatch ? fmMatch[1] : '';
  const bodyAfterFm = fmMatch ? normalized.slice(fmMatch[0].length) : normalized;

  const fmParsed = parseFrontmatterYaml(fmRaw);
  const fmPhases = (fmParsed.phases as Record<string, string>) ?? {};

  // Build frontmatter with defaults
  const frontmatter: SpecFrontmatter = {
    id: (fmParsed.id as string) ?? '',
    // Title comes from frontmatter when present and non-empty; otherwise fall back
    // to the first level-1 `# ` heading in the body (the human title for spec files).
    // An empty `title:` is treated like an absent one (both fall back to the H1) so
    // they behave identically. Defense-in-depth (#153.2): a non-string title (a
    // malformed empty nested block that slipped through) is coerced to '' so the
    // fallback fires instead of leaking an object that crashes slugify.
    title: (typeof fmParsed.title === 'string' ? fmParsed.title : '') || firstH1Heading(bodyAfterFm),
    // Closed-enum fields strip inline comments before the membership check, so a
    // commented value (e.g. `status: implementing  # note`) isn't silently
    // coerced to the default. epic/title keep their raw form (epic carries its
    // human title in a `#` comment by design — see updateSpecFrontmatter).
    tier: (() => { const t = stripInlineComment(String(fmParsed.tier ?? '')); return (TIERS_SET.has(t) ? t : 'T2') as Tier; })(),
    status: (() => { const s = stripInlineComment(String(fmParsed.status ?? '')); return (STATUSES_SET.has(s) ? s : 'new') as SpecStatus; })(),
    created: (fmParsed.created as string) ?? new Date().toISOString().slice(0, 10),
    epic: (fmParsed.epic as string) || undefined,
    product: (fmParsed.product as string) || undefined,
    type: (fmParsed.type as string) || undefined,
    // `superseded-by: SPEC-NNN` — recognized successor ref (SPEC-017 / #162). Keyed
    // by the hyphenated YAML key; surfaced camelCased on the frontmatter so writers
    // preserve it on round-trip rather than silently dropping it.
    supersededBy: (fmParsed['superseded-by'] as string) || undefined,
    phases: {
      specify: phaseStatusOf(fmPhases.specify),
      clarify: phaseStatusOf(fmPhases.clarify),
      plan: phaseStatusOf(fmPhases.plan),
      tasks: phaseStatusOf(fmPhases.tasks),
      implement: phaseStatusOf(fmPhases.implement),
    },
  };

  // Split body into sections by ## headings
  const sections = new Map<string, string>();
  const phaseSections: Partial<Record<Phase, PhaseContent>> = {};
  let preamble = '';

  const lines = bodyAfterFm.split('\n');
  let currentHeading: string | null = null;
  let currentBody: string[] = [];

  const flushSection = () => {
    if (currentHeading === null) {
      preamble = currentBody.join('\n').trim();
    } else {
      const body = currentBody.join('\n').trimEnd();
      sections.set(currentHeading, body);

      // Check if heading matches a phase name
      const phaseKey = currentHeading.toLowerCase() as Phase;
      if (PHASES.includes(phaseKey)) {
        phaseSections[phaseKey] = {
          status: resolvePhaseStatus(phaseKey, fmPhases, body),
          body,
          tasks: parseTasks(body),
        };
      }
    }
    currentBody = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      flushSection();
      currentHeading = headingMatch[1];
    } else {
      currentBody.push(line);
    }
  }
  flushSection();

  return { frontmatter, preamble, sections, phaseSections, raw };
}

const TIERS_SET = new Set(['T1', 'T2', 'T3', 'T4']);
const STATUSES_SET = new Set<string>(SPEC_STATUSES);

// --- Writer ---

/** Serialize frontmatter to YAML string */
function serializeFrontmatter(fm: SpecFrontmatter): string {
  const lines: string[] = [];
  lines.push(`id: ${fm.id}`);
  lines.push(`title: ${fm.title}`);
  // Split-layout phase-file kind (requirements|design|tasks). Absent = single-file
  // spec — emit only when present so a single-file spec stays type-less (its absence
  // IS the single-file signal). Without this the field was dropped on every write
  // round-trip, erasing the split-vs-single signal (#153.4).
  if (fm.type) lines.push(`type: ${fm.type}`);
  lines.push(`tier: ${fm.tier}`);
  // SPEC-022 (FR-3): the approval hash is now CANONICAL and excludes the lifecycle
  // fields (status/phases), so editing status no longer voids approval — the old
  // DR-012 "Editing voids approval" reminder line was removed here (it lied after
  // SPEC-022). Editing the BODY or any other frontmatter field still voids it.
  lines.push(`status: ${fm.status}`);
  // Successor ref for a superseded spec — emit only when present so a non-superseded
  // spec stays superseded-by-less. Preserves the field on a writeSpec round-trip.
  if (fm.supersededBy) lines.push(`superseded-by: ${fm.supersededBy}`);
  lines.push(`created: ${fm.created}`);
  if (fm.epic) lines.push(`epic: ${fm.epic}`);
  // Owning product slug (SPECS-pane prefix-strip key). Emit only when present so a
  // single-product repo stays product-less. Was dropped on every round-trip (#153.4).
  if (fm.product) lines.push(`product: ${fm.product}`);
  lines.push('phases:');
  for (const phase of PHASES) {
    lines.push(`  ${phase}: ${fm.phases[phase]}`);
  }
  return lines.join('\n');
}

/**
 * Write a spec to markdown string.
 * Preserves user content in sections not managed by frontmatter.
 */
export function writeSpec(spec: ParsedSpec): string {
  const parts: string[] = [];

  // Frontmatter
  parts.push('---');
  parts.push(serializeFrontmatter(spec.frontmatter));
  parts.push('---');
  parts.push('');

  // Preamble (title, description, etc.)
  if (spec.preamble) {
    parts.push(spec.preamble);
    parts.push('');
  }

  // Sections in order — phases first (in PHASES order), then others
  const writtenSections = new Set<string>();

  for (const phase of PHASES) {
    const capitalized = phase.charAt(0).toUpperCase() + phase.slice(1);
    const body = spec.sections.get(capitalized);
    if (body !== undefined) {
      parts.push(`## ${capitalized}`);
      parts.push(body);
      parts.push('');
      writtenSections.add(capitalized);
    }
  }

  // Non-phase sections in original order
  for (const [heading, body] of spec.sections) {
    if (!writtenSections.has(heading)) {
      parts.push(`## ${heading}`);
      parts.push(body);
      parts.push('');
      writtenSections.add(heading);
    }
  }

  return parts.join('\n').trimEnd() + '\n';
}

/**
 * Update frontmatter on an existing spec, preserving all user content.
 * Returns new markdown string.
 */
export function updateSpecFrontmatter(content: string, updates: Partial<SpecFrontmatter>): string {
  const spec = parseSpec(content);
  const newFm: SpecFrontmatter = {
    ...spec.frontmatter,
    ...updates,
    phases: updates.phases
      ? { ...spec.frontmatter.phases, ...updates.phases }
      : spec.frontmatter.phases,
  };
  return writeSpec({ ...spec, frontmatter: newFm });
}

/** Read and parse a spec file from disk */
export function readSpecFile(filePath: string): ParsedSpec {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parseSpec(content);
}

/** Write a parsed spec back to disk */
export function writeSpecFile(filePath: string, spec: ParsedSpec): void {
  fs.writeFileSync(filePath, writeSpec(spec), 'utf-8');
}

/**
 * Surgically rewrite the leading status word of a spec's body `**Status:**` line
 * in place, preserving whatever free-form prose follows it (e.g. `(SDD Implement
 * phase)` or a hand-written note). No-op — never invents a line — when the body
 * has no `**Status:**` line, or its leading token is not a recognised status word
 * (`bodyStatusToken`'s conservative contract; mirrors `setSpecPhases` never adding
 * a phase line that was absent).
 *
 * This is the write-path half of the #626 parity gate (`checkStatusParity`):
 * without it, `setSpecStatus` was the only writer of the *frontmatter* status,
 * leaving the body's prose line — a second source of truth for the same fact —
 * stale on every approve / phase-advance (#667).
 */
function setBodyStatusToken(filePath: string, content: string, status: SpecStatus): void {
  const existing = bodyStatusToken(content, 'spec');
  if (!existing) return;
  const lines = content.split('\n');
  const capitalized = status.charAt(0).toUpperCase() + status.slice(1);
  lines[existing.line - 1] = lines[existing.line - 1].replace(
    /^(\*\*Status:\*\*[ \t]*)[A-Za-z]+/,
    `$1${capitalized}`,
  );
  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
}

/**
 * Surgically rewrite the `status:` line in a spec's frontmatter in place,
 * adding it if absent, and the body's `**Status:**` line's leading word to match
 * (#667 — the two are separate sources of truth for the same fact; see
 * `setBodyStatusToken`). Returns the new status. Throws on invalid status or no
 * frontmatter block.
 *
 * Deliberately a line-level rewrite (mirrors `setEpicStatus`/`setAdrStatus`),
 * NOT a `writeSpec()` re-serialize: the latter would drop full-line `#` comments
 * (e.g. the DR-012 hash-lock reminder) and reorder fields. The symmetric
 * present-value writer specs previously lacked — its absence is why approval
 * could not keep the lifecycle signpost in sync (DR-003 RCDD; #137).
 */
export function setSpecStatus(filePath: string, status: SpecStatus): SpecStatus {
  if (!(SPEC_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Invalid spec status: ${status}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const fmMatch = content.match(FRONTMATTER_RE);
  if (!fmMatch) {
    throw new Error(`No frontmatter block in ${filePath}`);
  }
  const yaml = fmMatch[1];
  const statusLineRe = /^([ \t]*)status[ \t]*:[ \t]*.*$/m;
  const newYaml = statusLineRe.test(yaml)
    ? yaml.replace(statusLineRe, `$1status: ${status}`)
    : `${yaml}\nstatus: ${status}`;
  const newContent = content.replace(FRONTMATTER_RE, `---\n${newYaml}\n---\n`);
  fs.writeFileSync(filePath, newContent, 'utf-8');
  setBodyStatusToken(filePath, newContent, status);
  return status;
}

/** Options for {@link setSpecPhases} (SPEC-061 DQ-1). */
export interface SetSpecPhasesOptions {
  /**
   * Create the `phases:` block when the spec has none.
   *
   * **REQUIRED, not defaulted** — SPEC-061 DQ-1's remaining sub-choice, resolved toward
   * `required`. DQ-1 recorded the hazard of a defaulted flag in its own words: *"a future
   * caller who forgets `{ createIfAbsent: true }` silently reproduces the exact #957
   * half-write this spec exists to remove, and nothing errors."* A spec whose entire purpose
   * is deleting a silent half-write should not ship a new way to cause one, so the compiler
   * asks every caller instead. `false` keeps the shape-preserving no-op approved FR-6
   * requires stay reachable; only the approval writer passes `true`.
   *
   * Cost of requiring it, stated: every call site must name its intent, which is a wider
   * diff and slightly more ceremony at the three read-only test sites that only ever wanted
   * the default.
   */
  readonly createIfAbsent: boolean;
}

/**
 * Surgically rewrite phase-status lines inside a spec's `phases:` frontmatter
 * block, in place. Only lines that ALREADY exist under `phases:` are rewritten —
 * absent phases are NOT added, preserving the file's chosen shape (a spec that
 * tracks no `clarify:` line keeps none).
 *
 * TWO KINDS OF ABSENCE, and they are treated differently on purpose (SPEC-061 FR-1/FR-2):
 *
 *  - **No `phases:` block at all** → a no-op when `{ createIfAbsent: false }` (approved FR-6
 *    keeps that contract reachable); pass `{ createIfAbsent: true }` and the block is created, with
 *    every phase in `PHASES` order (any phase the caller does not supply is written
 *    `pending`). Only `advanceSpecToImplementing` opts in. The unconditional no-op is what
 *    made an approval write only half the lifecycle state:
 *    `setSpecStatus` creates its key when absent (below), `setSpecPhases` did not, so
 *    `advanceSpecToImplementing` stamped a literal the file provably could not re-derive.
 *    `deriveStatus` tests `allPending` before the approval check (lifecycle.ts), and
 *    `parseSpec` materializes absent phases to `pending`, so such a spec derived `new`
 *    however it was approved. One missing block also left `validateOwnership` un-armed
 *    (its `inBuildPath` reads `plan`), so 22 specs drifted (#1513) and 20 were never
 *    ownership-gated (#1543). See #957 / SPEC-061.
 *  - **A block that omits individual phase lines** → unchanged. Lines are still never
 *    invented, so the degenerate-block gate in `advanceSpecToImplementing` still fires
 *    rather than silently under-advancing (SPEC-061 AC-6).
 *
 * Creating the block is hash-neutral: `canonical.ts` strips `status` and `phases` from
 * the canonical form, so an approval-time write cannot stale the approval it is recording
 * (SPEC-061 FR-4). Idempotent — a second call rewrites the same block rather than
 * appending a second one (FR-5).
 *
 * Mirrors `setSpecStatus`: line-level, never a `writeSpec()` re-serialize, so
 * full-line `#` comments (the DR-012 lock reminder) and field order survive.
 * Throws when there is no frontmatter block at all.
 */
export function setSpecPhases(
  filePath: string,
  phases: Partial<Record<Phase, PhaseStatus>>,
  opts: SetSpecPhasesOptions,
): void {
  // `opts` is REQUIRED (SPEC-061 DQ-1). TypeScript enforces that for `src/` callers, but the
  // vitest tree under `packages/minspec/tests/` is covered by no tsconfig — `tsconfig.json`
  // includes only `src/**/*.ts` and `tsconfig.test.json` only `src/test/**/*.ts`, verified
  // with a control (a blatant type error in a test file raises nothing). So an omitting
  // caller would otherwise reach `opts.createIfAbsent` and die on an opaque
  // "Cannot read properties of undefined". Fail closed and SAY WHY instead: this function
  // exists to delete a silent half-write, so its own failure mode must not be a riddle.
  if (opts == null || typeof opts.createIfAbsent !== 'boolean') {
    throw new Error(
      `setSpecPhases(${filePath}) requires an explicit { createIfAbsent: boolean }. ` +
        `Pass false for the shape-preserving rewrite (the historical behaviour), or true to ` +
        `create the block when the spec has none — only the approval writer should pass true ` +
        `(SPEC-061 DQ-1 / #957).`,
    );
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const fmMatch = content.match(FRONTMATTER_RE);
  if (!fmMatch) {
    throw new Error(`No frontmatter block in ${filePath}`);
  }
  const lines = fmMatch[1].split('\n');
  const phasesIdx = lines.findIndex((l) => /^phases[ \t]*:/.test(l));
  if (phasesIdx === -1) {
    // OPT-IN, per SPEC-061 DQ-1 (resolved 2026-08-22). The default stays the
    // shape-preserving no-op this function has always had, because approved FR-6 requires
    // that contract to remain available to any future caller — which unconditional widening
    // would leave no way to obtain. The approval writer is the one caller that opts in.
    if (!opts.createIfAbsent) return;
    // Appended at the end of the frontmatter, matching where every hand-authored spec puts
    // it. Two-space indent is the corpus convention and the shape `parseSpec` reads back.
    const created = ['phases:', ...PHASES.map((p) => `  ${p}: ${phases[p] ?? 'pending'}`)];
    const newYaml = [...lines, ...created].join('\n');
    fs.writeFileSync(filePath, content.replace(FRONTMATTER_RE, `---\n${newYaml}\n---\n`), 'utf-8');
    return;
  }
  for (let i = phasesIdx + 1; i < lines.length; i++) {
    // The phases block ends at the first line that is not an indented child.
    if (!/^[ \t]/.test(lines[i])) break;
    const m = lines[i].match(/^([ \t]+)([A-Za-z][\w-]*)[ \t]*:/);
    if (!m) continue;
    const val = phases[m[2] as Phase];
    if (val !== undefined) lines[i] = `${m[1]}${m[2]}: ${val}`;
  }
  const newYaml = lines.join('\n');
  fs.writeFileSync(filePath, content.replace(FRONTMATTER_RE, `---\n${newYaml}\n---\n`), 'utf-8');
}

/**
 * Advance a spec into the `implementing` band on approval, keeping the literal
 * `status:` line and the `phases:` map in agreement (#148). The block is advanced
 * (specifying band → done, implementing band started) and the status line is written
 * as the status the *persisted bytes* derive, so the two representations cannot
 * diverge. ONE path, for every input shape: a spec with no `phases:` block gets one
 * created by `setSpecPhases` (SPEC-061 FR-1), rather than the status-only flip this
 * function used to fall back on. That fallback was #957 — it stamped `implementing`
 * on bytes that derive `new`, so the file contradicted itself the moment it was
 * re-read, and it left `validateOwnership` un-armed for the spec's own files.
 *
 * Degenerate-case gate (#148 MAJOR). `phasesForApproval` computes the target from
 * the in-memory map, where `parseSpec` MATERIALIZED every absent phase to
 * `pending`. But within an EXISTING block `setSpecPhases` only rewrites phase lines
 * that PHYSICALLY exist — it never invents an individual line (creating a whole
 * missing block is the separate case above). So a phases block missing every
 * implementing-band line (e.g. just `specify: in-progress`,
 * no plan/tasks/implement) cannot persist an implementing-band `in-progress`
 * marker: a re-read of the bytes derives a different status than the in-memory
 * target. Writing the status from the in-memory map — the shape of the earlier
 * fix — would emit a `status:` line the file provably won't reproduce, i.e. the
 * exact #148 desync this function exists to prevent. Instead:
 *   1. the written status is derived from the PERSISTED bytes, never the in-memory
 *      map, so `status` == `getSpecStatus(persisted phases)` by construction; and
 *   2. if the bytes cannot realize the approval target (the degenerate block), the
 *      advance is REJECTED with a throw rather than silently under-advanced — an
 *      un-committable-bad-state gate (RCDD Phase 4). Real specs all carry an
 *      implementing-band line, so this fires only on a degenerate block, and the
 *      file is left internally consistent (status == derived) either way.
 *
 * Preserves approval's flip-then-hash discipline (DR-003): callers invoke this
 * BEFORE recording the approval hash, so the hash binds post-flip bytes. Returns
 * the new spec status. Throws when there is no frontmatter block, and when a
 * degenerate phases block cannot realize the approval target without desyncing.
 */
export function advanceSpecToImplementing(filePath: string): SpecStatus {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fmMatch = content.match(FRONTMATTER_RE);
  if (!fmMatch) {
    throw new Error(`No frontmatter block in ${filePath}`);
  }

  // SPEC-051 T4.2 (#1446). THIS is the function that writes `phases.plan: in-progress`
  // — the state `validateOwnership` keys on — so it is the last place an undeclared
  // T3/T4 spec can be stopped before the illegal state reaches disk. #1423 guarded
  // `approveSpec` but could not guard here: `spec-validator` value-imported this module,
  // and closing that loop would have been a runtime cycle. The extraction to
  // `./spec-vocabulary` removed the edge, so the guard finally reaches the writer.
  //
  // Same shape as the one in `approveSpec`: config-respecting and newly-introduced-only
  // (both inherited from `violationsIntroducedByApproval`), placed BEFORE any write, and
  // failing open on its own infrastructure while announcing the degrade.
  assertOwnershipDeclaredForAdvance(filePath, parseSpec(content));

  // NO SPECIAL CASE FOR A PHASELESS SPEC (SPEC-061 / #957 — the DR-069 residual is fixed).
  // This used to short-circuit to `setSpecStatus(filePath, 'implementing')` when the
  // frontmatter had no `phases:` block, because `setSpecPhases` could not create one. That
  // stamped a literal the file provably could not re-derive: `parseSpec` materializes absent
  // phases to `pending`, and `deriveStatus` tests `allPending` before the approval check, so
  // the spec derived `new` however it was approved. `setSpecPhases` now creates the block, so
  // the single path below is correct for every input shape — which is the point: the
  // post-condition "the persisted bytes re-derive the written literal" is a property, not a
  // property of specs that happened to arrive with a block (SPEC-061 INV-4).
  const newPhases = phasesForApproval(parseSpec(content).frontmatter.phases);
  // DR-069 (#886): write the APPROVAL-AWARE derived status (deriveStatus), not the
  // phases-only getSpecStatus — so an approved-but-pre-implement spec is stamped
  // `planning` (matching what the validator/tree derive; no mirror-drift), and only
  // a spec whose implement phase has started is stamped `implementing`. This caller
  // runs solely at approval, so the 'approved' verdict is correct here.
  const target = deriveStatus(newPhases, 'approved', undefined);
  setSpecPhases(filePath, newPhases, { createIfAbsent: true });

  // Derive the status from the PERSISTED bytes (never the in-memory map) so the
  // `status:` line and the derived status are identical by construction.
  const persistedStatus = deriveStatus(
    parseSpec(fs.readFileSync(filePath, 'utf-8')).frontmatter.phases,
    'approved',
    undefined,
  );
  const status = setSpecStatus(filePath, persistedStatus);

  // Enforced invariant (defense-in-depth): the persisted `status:` line MUST equal
  // the status its persisted `phases:` map derives (approval-aware). True by
  // construction above; asserting it turns any future regression into a loud throw,
  // never a silent self-contradicting file (#148).
  const after = parseSpec(fs.readFileSync(filePath, 'utf-8')).frontmatter;
  if (after.status !== deriveStatus(after.phases, 'approved', undefined)) {
    throw new Error(
      `advanceSpecToImplementing left ${filePath} desynced: status=${after.status} ` +
        `but its phases derive ${deriveStatus(after.phases, 'approved', undefined)} (should be impossible).`,
    );
  }

  // Degenerate-block gate: the bytes could not realize the approval target, so
  // reject rather than record an approval that half-advanced the spec.
  if (persistedStatus !== target) {
    throw new Error(
      `Cannot advance ${filePath} to ${target}: its phases block has no ` +
        `implementing-band line (plan/tasks/implement) to mark in-progress, so the ` +
        `status line and the phases-derived status would disagree (the persisted ` +
        `phases derive ${persistedStatus}). Add a plan/tasks/implement phase line, ` +
        `or remove the phases block.`,
    );
  }
  return status;
}
