/**
 * SPEC-202 — retired-path denylist validator (#1253).
 *
 * A path the project has retired (or described but never built) must not be cited as a live
 * or authoritative source in specs, decision records or harness templates: a reader
 * implementing against it would wire to a file that no longer holds the truth (a false
 * signpost). The denylist is DATA (`RETIRED_PATHS`): a future store move adds one row and no
 * code (FR-1).
 *
 * Tier-0: pure text scan, no `vscode`, no network, no LLM (FR-10). I/O is injected so a read
 * failure surfaces as a visible finding instead of an empty corpus (FR-8, invariant 2).
 */

export type RetiredStatus = 'retired' | 'never-built';

export interface RetiredPathRow {
  /** Pattern matching the dead path as cited in prose. Must not carry the `g` flag. */
  readonly path: RegExp;
  /** Human-readable literal shown in messages. */
  readonly label: string;
  readonly status: RetiredStatus;
  /** The live path/description shown in the message. */
  readonly replacement: string;
  /** Date or DR id of the retirement. */
  readonly since: string;
  /** One sentence: why the path is dead. */
  readonly why: string;
}

export const RETIRED_PATHS: readonly RetiredPathRow[] = [
  {
    path: /(?<![\w./-])(?:\.minspec\/)?approvals\.json(?![\w])/i,
    label: '.minspec/approvals.json',
    status: 'retired',
    replacement: 'the committed path-keyed sidecar `.minspec/approvals/<spec-path>.json` (DR-034)',
    since: 'DR-034 (2026-06-13)',
    why: 'the id-keyed, gitignored store was replaced by one committed sidecar per approvable',
  },
  {
    path: /approval-ledger\.jsonl/i,
    label: '.minspec/approval-ledger.jsonl',
    status: 'never-built',
    replacement: 'the committed path-keyed sidecar `.minspec/approvals/<spec-path>.json` (DR-034)',
    since: 'DR-042 / DR-043',
    why: 'it was described by DR-042/DR-043 but never created and no code writes it',
  },
];

/** Words that make a sentence narrate history rather than cite a live source (FR-4). */
export const HISTORICAL_MARKERS: RegExp =
  /\b(?:retired|superseded|legacy|was|were|formerly|replaced|replaces|no longer|migrated|migration|migrate|deprecated|previously)\b/i;

/** A sentence that says the artifact was never created (FR-5). */
export const NEVER_BUILT_MARKERS: RegExp =
  /\bnever\b[^.]{0,40}\b(?:created|built|written|existed|shipped|implemented)\b|\bno code writes\b|\bwas ever created\b/i;

/** A heading that opens a dated amendment block (FR-4). */
const AMENDMENT_HEADING = /^#{1,6}\s+.*\bamend(?:ment|ed)?\b/i;
const ANY_HEADING = /^(#{1,6})\s/;

/** FR-6: own-definition exemption, short and asserted by a test. */
export const RETIRED_PATH_EXEMPT: readonly string[] = [
  'specs/minspec/SPEC-202-retired-path-denylist/',
  'packages/minspec/src/lib/retired-paths.ts',
  'packages/minspec/tests/retired-paths.test.ts',
];

export interface RetiredPathFinding {
  readonly file: string;
  readonly line: number;
  readonly row: RetiredPathRow;
  readonly message: string;
}

interface Unit {
  readonly text: string;
  readonly line: number;
}

/**
 * Split text into sentence units, each tagged with the 1-based line it starts on.
 * A unit ends at sentence punctuation followed by whitespace, a blank line, or the start of
 * a list item / heading / table row / fence line, so a marker in a neighbouring bullet never
 * licenses a match (AC-7).
 */
function sentenceUnits(lines: readonly string[]): Unit[] {
  const units: Unit[] = [];
  let buf = '';
  let bufLine = 0;
  const flush = (): void => {
    if (buf.trim()) units.push({ text: buf, line: bufLine });
    buf = '';
  };
  lines.forEach((raw, i) => {
    const line = raw.replace(/^(?:\s*>\s?)+/, '');
    if (line.trim() === '') return flush();
    if (/^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|\||```)/.test(line)) flush();
    const parts = line.split(/(?<=[.!?])\s+(?=[A-Z`"'(\[*_<])/);
    parts.forEach((part, pi) => {
      if (pi > 0) flush();
      if (!buf) bufLine = i + 1;
      buf += (buf ? ' ' : '') + part;
    });
  });
  flush();
  return units;
}

/** Lines that sit in a dated amendment block, a fenced block or a blockquote with a marked intro. */
function licensedLines(lines: readonly string[]): Set<number> {
  const out = new Set<number>();
  let amendLevel = 0;
  let prevText = '';
  let inFence = false;
  let fenceLicensed = false;
  let quoteLicensed: boolean | null = null;
  lines.forEach((line, i) => {
    const h = ANY_HEADING.exec(line);
    if (!inFence && h) {
      const level = h[1].length;
      if (AMENDMENT_HEADING.test(line)) amendLevel = level;
      else if (amendLevel && level <= amendLevel) amendLevel = 0;
    }
    if (/^\s*```/.test(line)) {
      if (!inFence) {
        inFence = true;
        fenceLicensed = HISTORICAL_MARKERS.test(prevText);
      } else {
        inFence = false;
        fenceLicensed = false;
      }
    }
    const isQuote = /^\s*>/.test(line);
    if (isQuote) {
      if (quoteLicensed === null) quoteLicensed = HISTORICAL_MARKERS.test(prevText);
    } else quoteLicensed = null;
    if (amendLevel || (inFence && fenceLicensed) || (isQuote && quoteLicensed)) out.add(i + 1);
    if (line.trim() !== '' && !isQuote && !inFence) prevText = line;
  });
  return out;
}

/** Scan one file's text. Pure. */
export function scanRetiredPaths(
  file: string,
  text: string,
  table: readonly RetiredPathRow[] = RETIRED_PATHS,
): RetiredPathFinding[] {
  const lines = text.split(/\r?\n/);
  const licensed = licensedLines(lines);
  const findings: RetiredPathFinding[] = [];
  for (const unit of sentenceUnits(lines)) {
    for (const row of table) {
      if (!row.path.test(unit.text)) continue;
      const allowed =
        row.status === 'never-built'
          ? NEVER_BUILT_MARKERS.test(unit.text)
          : HISTORICAL_MARKERS.test(unit.text) || NEVER_BUILT_MARKERS.test(unit.text);
      if (allowed) continue;
      // Strikethrough (`~~...~~`) is how DR-042 retracts its own claim in place.
      if (/~~[^~]*~~/.test(unit.text) && unit.text.replace(/~~[^~]*~~/g, '').search(row.path) < 0) continue;
      // Per-line lookup of the match, so file:line points at the citing line, not the sentence start.
      const at = lines.findIndex((l, i) => i + 1 >= unit.line && row.path.test(l));
      const line = at >= 0 ? at + 1 : unit.line;
      if (licensed.has(line) && row.status === 'retired') continue;
      findings.push({
        file,
        line,
        row,
        message:
          `${file}:${line}: \`${row.label}\` is ${row.status === 'never-built' ? 'never built' : 'retired'} ` +
          `(${row.why}; since ${row.since}). Cite ${row.replacement} instead, or make the sentence ` +
          `say the path is historical (retired/superseded/was/migrated) — SPEC-202.`,
      });
    }
  }
  return findings;
}

export interface RetiredPathScanInput {
  /** Repo-relative POSIX path -> readable text. A thrown read becomes a failure finding. */
  readonly files: readonly string[];
  readonly read: (file: string) => string;
  readonly table?: readonly RetiredPathRow[];
  readonly exempt?: readonly string[];
}

export interface RetiredPathScanResult {
  readonly findings: RetiredPathFinding[];
  /** Files that could not be read — each is a failure (FR-8), never a skip. */
  readonly unreadable: { readonly file: string; readonly cause: string }[];
  readonly scanned: number;
}

export function scanRetiredPathCorpus(input: RetiredPathScanInput): RetiredPathScanResult {
  const exempt = input.exempt ?? RETIRED_PATH_EXEMPT;
  const findings: RetiredPathFinding[] = [];
  const unreadable: { file: string; cause: string }[] = [];
  let scanned = 0;
  for (const file of input.files) {
    if (exempt.some((e) => file === e || file.startsWith(e))) continue;
    let text: string;
    try {
      text = input.read(file);
    } catch (err) {
      unreadable.push({ file, cause: err instanceof Error ? err.message : String(err) });
      continue;
    }
    scanned++;
    findings.push(...scanRetiredPaths(file, text, input.table));
  }
  return { findings, unreadable, scanned };
}

/**
 * FR-7 severity ratchet. Approved, hash-locked artifacts cannot be edited by this change
 * (FR-9 / INV-hash-lock), so occurrences that PREDATE the rule are grandfathered by per-file
 * count: they warn, and any occurrence beyond the count is an error. Fixing one lowers the
 * true count; the baseline may only ever shrink — a new file, or a new hit in a listed file,
 * fails. Measured on the base this rule shipped against (SPEC-202 FR-9 hit list).
 */
export const RETIRED_PATH_BASELINE: Readonly<Record<string, number>> = {
  'specs/agent-execute/SPEC-016-reality-check/requirements.md': 1,
  'specs/agent-execute/SPEC-019-execution-substrate/requirements.md': 2,
  'specs/minspec/SPEC-004-classifier-validation/design.md': 1,
  'specs/minspec/SPEC-004-classifier-validation/requirements.md': 1,
  'specs/minspec/SPEC-004-classifier-validation/tasks.md': 1,
  'specs/minspec/SPEC-005-auto-structure-repair/requirements.md': 1,
  'specs/minspec/SPEC-006-stub-completeness-gate/requirements.md': 1,
  'specs/minspec/SPEC-007-epic-grouping/design.md': 1,
  'specs/minspec/SPEC-007-epic-grouping/requirements.md': 1,
  'specs/minspec/SPEC-007-epic-grouping/tasks.md': 1,
  'specs/minspec/SPEC-010-signpost-correctness/requirements.md': 1,
  'specs/minspec/SPEC-011-epic-backfill/requirements.md': 1,
  'specs/minspec/SPEC-013-risk-section-policy/requirements.md': 1,
  'specs/minspec/SPEC-017-trust-dashboard/requirements.md': 2,
  'specs/minspec/SPEC-017-trust-dashboard/tasks.md': 1,
  'specs/minspec/SPEC-021-dr-ref-isolation/requirements.md': 2,
  'specs/minspec/SPEC-022-approval-foundation/design.md': 4,
  'specs/minspec/SPEC-022-approval-foundation/requirements.md': 2,
  'specs/minspec/SPEC-026-session-presence/requirements.md': 1,
  'specs/minspec/SPEC-034-oidc-review-broker/design.md': 1,
  'specs/minspec/SPEC-034-oidc-review-broker/requirements.md': 2,
  'specs/minspec/SPEC-035-approvable-ref-lozenges/requirements.md': 1,
  'specs/minspec/SPEC-038-spec-code-ownership/requirements.md': 1,
  'specs/minspec/SPEC-040-import-boundaries/requirements.md': 1,
  'specs/minspec/SPEC-040-import-boundaries/tasks.md': 1,
  'specs/minspec/SPEC-041-cross-artifact-staleness/requirements.md': 1,
  'specs/minspec/SPEC-043-harness-refresh-manifest-consistency/requirements.md': 1,
  'specs/minspec/SPEC-043-harness-refresh-manifest-consistency/tasks.md': 1,
  'specs/minspec/SPEC-044-coordinated-self-completing-sessions/design.md': 1,
  'specs/minspec/SPEC-044-coordinated-self-completing-sessions/requirements.md': 1,
  'specs/minspec/SPEC-070-ownership-hash-exit/design.md': 1,
  'specs/minspec/design.md': 1,
  'specs/minspec/requirements.md': 1,
  'specs/minspec/tasks.md': 1,
  'docs/decisions/DR-012.md': 3,
  'docs/decisions/DR-031.md': 4,
  'docs/decisions/DR-032.md': 1,
  'docs/decisions/DR-034.md': 5,
  'docs/decisions/DR-036.md': 2,
  'docs/decisions/DR-041.md': 1,
  'docs/decisions/DR-043.md': 2,
  'docs/decisions/DR-051.md': 1,
  'docs/decisions/DR-054.md': 1,
  'docs/decisions/DR-061.md': 1,
  'docs/decisions/DR-072.md': 1,
  'docs/decisions/DR-074.md': 1,
  'docs/decisions/INDEX.md': 1,
};

export interface BaselineSplit {
  readonly errors: RetiredPathFinding[];
  readonly grandfathered: RetiredPathFinding[];
}

export function splitByBaseline(
  findings: readonly RetiredPathFinding[],
  baseline: Readonly<Record<string, number>> = RETIRED_PATH_BASELINE,
): BaselineSplit {
  const used: Record<string, number> = {};
  const errors: RetiredPathFinding[] = [];
  const grandfathered: RetiredPathFinding[] = [];
  for (const f of findings) {
    const n = (used[f.file] = (used[f.file] ?? 0) + 1);
    (n <= (baseline[f.file] ?? 0) ? grandfathered : errors).push(f);
  }
  return { errors, grandfathered };
}
