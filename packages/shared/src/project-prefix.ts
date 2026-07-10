/**
 * Cross-project reference prefixes — DR-053 (materialises #58 → #500).
 *
 * Per-repo-local SDD ids stay unprefixed (DR-027 keeps separate registers per
 * repo, so `SPEC-001` means "this repo's SPEC-001"). A reference that SPANS
 * projects — a minspec DR citing a scrooge spec, a commit referencing another
 * repo's issue — is ambiguous as a bare id, so it carries the target project's
 * SHORT prefix:
 *
 *   - SDD refs:      `<PREFIX>-<ID>`   e.g. `MS-SPEC-019`, `SC-DR-007`, `SB-EPIC-002`
 *   - Issue/PR refs: `<PREFIX>#<N>`    e.g. `MS#500`, `SC#26`
 *
 * The joiner differs because the two local forms differ: an SDD id starts with a
 * letter (`SPEC-`/`DR-`/`EPIC-`) so it needs a `-` separator; an issue ref starts
 * with `#`, which separates itself.
 *
 * The prefix→project mapping is an editable, committed markdown table
 * (`.minspec/project-prefixes.md`). This module is the Tier-0 core that reads
 * and resolves against it: pure string transforms, no `fs`, no `vscode`, no
 * network, no LLM. An UNKNOWN prefix is resolved to a `'unknown-prefix'` result,
 * never an exception — the "not fail loud" contract from #500: the Tier-1 seam
 * (assistant / agent-execute) may then SUGGEST a prefix and offer to edit the
 * table, but the deterministic core degrades gracefully offline.
 *
 * Tier-0: depends on nothing but the language. The file read lives in the
 * extension's fs adapter, mirroring how `canonical.ts` keeps hashing pure.
 */

/** The kinds of reference this module understands. */
export type RefKind = 'SPEC' | 'DR' | 'EPIC' | 'ISSUE';

/** The SDD approvable kinds (everything except a GitHub issue/PR). */
export type ApprovableKind = 'SPEC' | 'DR' | 'EPIC';

/** One row of the prefix table: a short prefix bound to a project (and its repo). */
export interface ProjectPrefix {
  /** Uppercase short prefix, e.g. `"MS"`. */
  prefix: string;
  /** Project key, e.g. `"minspec"`. */
  project: string;
  /** GitHub `owner/repo` slug, if recorded, e.g. `"AIClarityAU/minspec"`. */
  repo?: string;
}

/**
 * A parsed prefix table, indexed both ways. Prefixes key case-insensitively
 * (stored uppercase); projects key by their exact table spelling.
 */
export interface PrefixMap {
  byPrefix: ReadonlyMap<string, ProjectPrefix>;
  byProject: ReadonlyMap<string, ProjectPrefix>;
}

/** An empty map — the resolver treats every prefix as unknown against it. */
export const EMPTY_PREFIX_MAP: PrefixMap = {
  byPrefix: new Map(),
  byProject: new Map(),
};

/**
 * The result of resolving one reference token.
 *
 *   - `null`             — not a reference token at all (parse it as prose).
 *   - `'local'`          — a bare, unprefixed local ref (`SPEC-019`, `#500`).
 *   - `'cross-project'`  — a prefixed ref whose prefix is in the table.
 *   - `'unknown-prefix'` — a prefixed ref whose prefix is NOT in the table
 *                          (advisory: suggest + offer to edit, never throw).
 */
export type RefResolution =
  | { status: 'local'; kind: RefKind; localId: string; num: number }
  | {
      status: 'cross-project';
      kind: RefKind;
      localId: string;
      num: number;
      prefix: string;
      project: string;
      repo?: string;
    }
  | { status: 'unknown-prefix'; kind: RefKind; localId: string; num: number; prefix: string }
  | null;

// A prefix is 2–5 uppercase letters. Real prefixes are 2 (MS/SC/SB); the extra
// headroom tolerates a hand-added longer one without silently misreading it as
// part of the id.
const PREFIX = '[A-Z]{2,5}';
const CROSS_SDD_RE = new RegExp(`^(${PREFIX})-(SPEC|DR|EPIC)-(\\d+)$`);
const CROSS_ISSUE_RE = new RegExp(`^(${PREFIX})#(\\d+)$`);
const LOCAL_SDD_RE = /^(SPEC|DR|EPIC)-(\d+)$/;
const LOCAL_ISSUE_RE = /^#(\d+)$/;

/**
 * Parse the `.minspec/project-prefixes.md` mapping table.
 *
 * Reads GitHub-flavoured pipe-table rows of the form `| MS | minspec | owner/repo |`
 * (the repo column is optional). The header row and its `|---|` separator are
 * skipped; blank and structurally-malformed rows are ignored rather than throwing
 * (a robust Tier-0 read — a half-edited table still yields the good rows). The
 * first occurrence of a prefix or project wins; later duplicates are dropped.
 *
 * Prefixes are uppercased on the way in, so the table may be written in any case.
 */
export function parsePrefixTable(markdown: string): PrefixMap {
  const byPrefix = new Map<string, ProjectPrefix>();
  const byProject = new Map<string, ProjectPrefix>();
  if (!markdown) return { byPrefix, byProject };

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;

    // Split into cells, dropping the empty leading/trailing cells from the pipes.
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 2) continue;

    const prefix = cells[0].toUpperCase();
    const project = cells[1];
    const repo = cells[2] || undefined;

    // Skip the header row and its separator (`---`, `:--:`, etc.).
    if (prefix === 'PREFIX' || /^:?-{2,}:?$/.test(prefix)) continue;
    // Only accept a well-formed prefix + a non-empty project.
    if (!new RegExp(`^${PREFIX}$`).test(prefix) || !project) continue;

    const entry: ProjectPrefix = { prefix, project, repo };
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, entry);
    if (!byProject.has(project)) byProject.set(project, entry);
  }

  return { byPrefix, byProject };
}

/**
 * Resolve a single reference token against a prefix map.
 *
 * Cross-project forms are tried before local forms so a prefixed token is never
 * mis-read as a local one. Returns `null` for anything that is not a reference
 * token at all. An unrecognised prefix yields `'unknown-prefix'` — the caller
 * decides whether to advise (never a throw; never a silent drop).
 */
export function resolveRef(token: string, map: PrefixMap = EMPTY_PREFIX_MAP): RefResolution {
  const t = token.trim();

  let m = CROSS_SDD_RE.exec(t);
  if (m) {
    const [, prefix, kind, digits] = m;
    return crossOrUnknown(prefix, kind as RefKind, `${kind}-${digits}`, Number(digits), map);
  }

  m = CROSS_ISSUE_RE.exec(t);
  if (m) {
    const [, prefix, digits] = m;
    return crossOrUnknown(prefix, 'ISSUE', `#${digits}`, Number(digits), map);
  }

  m = LOCAL_SDD_RE.exec(t);
  if (m) {
    const [, kind, digits] = m;
    return { status: 'local', kind: kind as RefKind, localId: `${kind}-${digits}`, num: Number(digits) };
  }

  m = LOCAL_ISSUE_RE.exec(t);
  if (m) {
    const [, digits] = m;
    return { status: 'local', kind: 'ISSUE', localId: `#${digits}`, num: Number(digits) };
  }

  return null;
}

function crossOrUnknown(
  rawPrefix: string,
  kind: RefKind,
  localId: string,
  num: number,
  map: PrefixMap,
): RefResolution {
  const prefix = rawPrefix.toUpperCase();
  const entry = map.byPrefix.get(prefix);
  if (!entry) return { status: 'unknown-prefix', kind, localId, num, prefix };
  return {
    status: 'cross-project',
    kind,
    localId,
    num,
    prefix,
    project: entry.project,
    repo: entry.repo,
  };
}

/**
 * Format a local id as a cross-project reference to `project`.
 *
 *   formatCrossRef('SPEC-019', 'minspec', map) -> 'MS-SPEC-019'
 *   formatCrossRef('#500',     'minspec', map) -> 'MS#500'
 *
 * Returns `null` if `project` has no prefix in the table — the caller then
 * reaches for `suggestPrefixDeterministic` (or the Tier-1 LLM suggestion) and
 * offers to add a row, rather than emitting an un-prefixed (ambiguous) ref.
 * The local id may be given with or without a leading `#`/kind — only its shape
 * (`#…` vs `KIND-…`) selects the joiner.
 */
export function formatCrossRef(localId: string, project: string, map: PrefixMap): string | null {
  const entry = map.byProject.get(project);
  if (!entry) return null;
  const id = localId.trim();
  return id.startsWith('#') ? `${entry.prefix}${id}` : `${entry.prefix}-${id}`;
}

/**
 * Deterministic Tier-0 fallback prefix for a project with no table row yet.
 *
 * This is the offline default the core can always produce; the Tier-1 seam may
 * offer a nicer human-facing suggestion (`minspec → MS` rather than `MI`). It
 * takes the first two alphabetic characters, uppercased, and — if that collides
 * with a `taken` prefix — walks the remaining characters (then A–Z) for a free
 * second letter, so a batch of projects never collapses onto one prefix.
 */
export function suggestPrefixDeterministic(project: string, taken: ReadonlySet<string> = new Set()): string {
  const letters = project.toUpperCase().replace(/[^A-Z]/g, '');
  const first = letters[0] ?? 'X';
  const takenUpper = new Set([...taken].map((p) => p.toUpperCase()));

  const candidates: string[] = [];
  for (let i = 1; i < letters.length; i++) candidates.push(first + letters[i]);
  for (let c = 65; c <= 90; c++) candidates.push(first + String.fromCharCode(c));

  for (const cand of candidates) {
    if (!takenUpper.has(cand)) return cand;
  }
  // Every A–Z second letter taken (pathological) — fall back to the first pair.
  return (first + (letters[1] ?? 'X'));
}

/** True when a token is a cross-project reference (known OR unknown prefix). */
export function isCrossProjectRef(token: string, map: PrefixMap = EMPTY_PREFIX_MAP): boolean {
  const r = resolveRef(token, map);
  return r !== null && r.status !== 'local';
}
