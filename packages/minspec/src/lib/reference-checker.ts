/**
 * reference-checker.ts — deterministic dangling-reference checker (Slice-1, #161).
 *
 * The corpus accumulates references that silently rot: a `DR-355` that never
 * existed, a `SPEC-014` `approve.ts:70-100` line citation that drifted, a
 * `../research/…` path that should have been `../../docs/research/…`. None of it
 * is caught by frontmatter validation. This module is the deterministic gate the
 * cross-check report flagged as highest-ROI: it scans a markdown artifact for
 * references — `SPEC-NNN`, `DR-NNN`, `EPIC-NNN`, and `path#Lnn` / `path:nn`
 * file:line citations — and reports any that do not resolve to a real artifact or
 * file.
 *
 * STANDALONE by design: it does NOT import or modify spec-validator.ts (a parallel
 * build owns that file). Tier-0 — pure functions over text + an injected registry;
 * no `vscode`, no network, no filesystem reads of its own (the caller supplies a
 * `fileExists` probe so the checker stays unit-testable and platform-agnostic).
 *
 * `checkReferences` checks *existence* only: a `path#Lnn` citation passes when
 * the file exists. The separate `checkCitationFidelity` tier (#1643) adds a line
 * bound and a nearby-literal echo check — see its frozen candidate set below.
 * Cross-repo refs are exempted via an explicit
 * `@namespace` convention (e.g. `SPEC-100@scroogellm`) so legitimately-external
 * citations never trip the gate.
 */

/** Kind of reference found in an artifact. */
export type ReferenceKind = 'spec' | 'decision' | 'epic' | 'file';

/** A single reference extracted from artifact text. */
export interface Reference {
  kind: ReferenceKind;
  /** Canonical id for artifact refs (`SPEC-001`, `DR-001`, `EPIC-001`). */
  id?: string;
  /** Repo-relative path for `file` refs. */
  path?: string;
  /** Cited line / line-range token for `file` refs (e.g. `42`, `70-100`). */
  line?: string;
  /**
   * True when the ref carries an explicit external `@namespace` suffix
   * (`SPEC-100@scroogellm`). External refs are exempt from resolution — they
   * live in another repo's register.
   */
  external?: boolean;
}

/** Registry of artifacts/files a reference may resolve against. */
export interface ReferenceRegistry {
  /** Existing spec ids (`SPEC-001`, …). */
  specs: Set<string>;
  /** Existing decision ids (`DR-001`, …). */
  decisions: Set<string>;
  /** Existing epic ids (`EPIC-001`, …). */
  epics: Set<string>;
  /** Probe: does this repo-relative path exist? */
  fileExists: (relPath: string) => boolean;
  /**
   * Optional probe: the cited file's text, or undefined when it cannot be read
   * (missing, a directory, binary). Enables the fidelity tier
   * (`checkCitationFidelity`); without it that tier checks nothing.
   */
  readFile?: (relPath: string) => string | undefined;
}

/** A reference that failed to resolve. */
export interface ReferenceViolation {
  ref: Reference;
  message: string;
}

// SPEC-NNN / DR-NNN / EPIC-NNN, optionally suffixed with @namespace for an
// external (cross-repo) ref. Captured groups: 1=kind word, 2=number, 3=namespace.
const ARTIFACT_RE = /\b(SPEC|DR|EPIC)-(\d{1,})(?:@([A-Za-z][\w-]*))?\b/g;

// file:line citations. Two shapes:
//   path#Lnn[-nn]   — markdown anchor style (src/foo.ts#L42, src/foo.ts#L70-L100)
//   path:nn[-nn]    — colon style (scripts/bar.ts:70-100)
// A path is a slash-containing, extension-bearing token so bare words and the
// artifact ids above are never mistaken for file paths. Restrict the path charset
// to typical source-path characters.
//
// NOT `\b` at the start (#1451). A word boundary cannot exist between two
// non-word characters, so `\b` could never match at the leading `.` of a
// `./` or `../` path: given `](../SPEC-014-x/requirements.md#L4)`, the engine
// skipped forward to the first word character and captured
// `SPEC-014-x/requirements.md`, silently DROPPING the `../`. Both callers
// resolve relative to the citing file first, so the truncated path then failed
// there too and the citation was reported dangling while being perfectly
// correct — 28 of the 32 file findings on `main` were this.
//
// `(?<![\w./-])` instead: the same "don't start mid-path" guarantee `\b` was
// providing, but expressed against the path charset itself, so a leading `./`
// or `../` is captured. Root-relative paths are unaffected.
const PATH_START = /(?<![\w./-])/.source;
const FILE_HASH_RE = new RegExp(
  `${PATH_START}([\\w./-]+/[\\w.-]+\\.[A-Za-z][\\w]*)#L(\\d+(?:-L?\\d+)?)`,
  'g',
);
const FILE_COLON_RE = new RegExp(
  `${PATH_START}([\\w./-]+/[\\w.-]+\\.[A-Za-z][\\w]*):(\\d+(?:-\\d+)?)\\b`,
  'g',
);

const KIND_BY_WORD: Record<string, ReferenceKind> = {
  SPEC: 'spec',
  DR: 'decision',
  EPIC: 'epic',
};

/** Normalize a captured number to its canonical zero-padded id. */
function canonicalId(word: string, num: string): string {
  // Existing corpus ids are 3-digit-padded (SPEC-001, DR-040). Pad numbers
  // shorter than 3 digits; leave longer ones (SPEC-100, DR-1000) untouched.
  const padded = num.length < 3 ? num.padStart(3, '0') : num;
  return `${word}-${padded}`;
}

/**
 * Extract every reference from artifact text.
 *
 * Skips the artifact's OWN defining frontmatter `id:` line — that is a definition,
 * not a citation, so a spec is never treated as referencing itself. De-duplicates
 * by (kind,id,path) in first-seen order.
 */
export function extractReferences(text: string): Reference[] {
  // Drop defining `id:`/`epic:` frontmatter lines so self-definitions and the
  // owning epic declaration aren't mis-read as citations to validate.
  const scrubbed = text
    .split('\n')
    .filter((l) => !/^\s*(id|epic):\s/.test(l))
    .join('\n');

  const out: Reference[] = [];
  const seen = new Set<string>();

  const push = (ref: Reference, key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  };

  let m: RegExpExecArray | null;

  ARTIFACT_RE.lastIndex = 0;
  while ((m = ARTIFACT_RE.exec(scrubbed)) !== null) {
    const [, word, num, ns] = m;
    const id = canonicalId(word, num);
    const ref: Reference = { kind: KIND_BY_WORD[word], id };
    if (ns) ref.external = true;
    push(ref, `${ref.kind}:${id}:${ns ?? ''}`);
  }

  FILE_HASH_RE.lastIndex = 0;
  while ((m = FILE_HASH_RE.exec(scrubbed)) !== null) {
    const [, path, line] = m;
    push({ kind: 'file', path, line }, `file:${path}`);
  }

  FILE_COLON_RE.lastIndex = 0;
  while ((m = FILE_COLON_RE.exec(scrubbed)) !== null) {
    const [, path, line] = m;
    push({ kind: 'file', path, line }, `file:${path}`);
  }

  return out;
}

/** Resolve one reference against the registry. Returns a violation or null. */
function resolve(
  ref: Reference,
  registry: ReferenceRegistry,
): ReferenceViolation | null {
  // External (@namespace) refs live in another repo's register — exempt.
  if (ref.external) return null;

  switch (ref.kind) {
    case 'spec':
      return registry.specs.has(ref.id!)
        ? null
        : { ref, message: `dangling SPEC reference: ${ref.id} resolves to no spec` };
    case 'decision':
      return registry.decisions.has(ref.id!)
        ? null
        : { ref, message: `dangling DR reference: ${ref.id} resolves to no decision record` };
    case 'epic':
      return registry.epics.has(ref.id!)
        ? null
        : { ref, message: `dangling EPIC reference: ${ref.id} resolves to no epic` };
    case 'file':
      return registry.fileExists(ref.path!)
        ? null
        : {
            ref,
            message: `dangling file citation: ${ref.path}${
              ref.line ? `:${ref.line}` : ''
            } resolves to no file`,
          };
  }
}

/**
 * Check every reference in `text` against the registry; return the violations.
 * Empty array ⇒ all references resolve (the clean case).
 */
export function checkReferences(
  text: string,
  registry: ReferenceRegistry,
): ReferenceViolation[] {
  const violations: ReferenceViolation[] = [];
  for (const ref of extractReferences(text)) {
    const v = resolve(ref, registry);
    if (v) violations.push(v);
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Fidelity tier (#1643) — does the cited LINE / CONTENT exist, beyond the file?
//
// FROZEN CANDIDATE SET. "The fidelity check passed" means exactly the following
// and nothing more; a new prose form extends THIS list, not the regexes:
//   1. Line bound — for every `path:NN[-MM]` / `path#LNN[-LMM]` citation whose file
//      exists and is readable, the file has at least max(NN, MM) lines.
//   2. Literal echo — every backticked IDENTIFIER (`[A-Za-z_$][\w$]*`, optionally
//      dotted and/or with a trailing `()`; >= 3 characters) within +/- 1
//      line of the citation (the same proximity window as `hasDanglingParkRef`,
//      spec-validator.ts) appears verbatim in the cited file. Edges that are word
//      characters carry a boundary guard, so `42K` is not found inside `142K`.
//      A literal is NOT a candidate when it is itself a citation or contains the
//      cited path, or when the window cites more than one distinct file (the
//      literal's owner is then ambiguous; rule 1 still applies to each citation).
// NOT checked: backticked commands/phrases/flags (`git push`, `status:` — prose
// mentions, not symbols; including them measured ~1500 false positives), quoted prose, dates, numbers, multi-line literals, literals that
// are not backticked, whether the cited line is the RIGHT line (only that the
// literal exists somewhere in the file), unreadable/missing files (the existence
// tier reports missing files).
// EXEMPTIONS (deliberate, complete list): the artifact's own `id:`/`epic:`
// frontmatter lines, and `@namespace` external refs (which are not file
// citations). Status blocks and fenced code are scanned like any other prose —
// corrections live there, so a checker must not look away from them.
// Severity is the caller's call; the shipped caller reports WARNINGS.
// ---------------------------------------------------------------------------

const FIDELITY_IDENT_RE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

/** Minimum length of a backticked literal to be a fidelity candidate. */
export const FIDELITY_MIN_LITERAL_LENGTH = 3;

interface LocatedCitation {
  path: string;
  line: string;
  /** 0-based index of the line holding the citation. */
  lineIdx: number;
  /** The exact matched citation token, e.g. `src/a.ts:42`. */
  token: string;
}

function locateCitations(lines: string[]): LocatedCitation[] {
  const out: LocatedCitation[] = [];
  lines.forEach((l, lineIdx) => {
    if (/^\s*(id|epic):\s/.test(l)) return;
    for (const re of [FILE_HASH_RE, FILE_COLON_RE]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(l)) !== null) {
        out.push({ path: m[1], line: m[2], lineIdx, token: m[0] });
      }
    }
  });
  return out;
}

function lastLineOf(token: string): number {
  const nums = token.match(/\d+/g) ?? [];
  return Number(nums[nums.length - 1]);
}

function countLines(content: string): number {
  if (content === '') return 0;
  const n = content.split('\n').length;
  return content.endsWith('\n') ? n - 1 : n;
}

function containsGuarded(content: string, literal: string): boolean {
  let from = 0;
  const first = /\w/.test(literal[0]);
  const last = /\w/.test(literal[literal.length - 1]);
  for (;;) {
    const i = content.indexOf(literal, from);
    if (i === -1) return false;
    const before = i > 0 ? content[i - 1] : '';
    const after = content[i + literal.length] ?? '';
    const okBefore = !first || !/\w/.test(before);
    const okAfter = !last || !/\w/.test(after);
    if (okBefore && okAfter) return true;
    from = i + 1;
  }
}

/**
 * Fidelity tier: verify cited lines exist and nearby backticked literals appear in
 * the cited file. Returns violations (callers report them as warnings). See the
 * frozen candidate set above for the exact, bounded claim.
 */
export function checkCitationFidelity(
  text: string,
  registry: ReferenceRegistry,
): ReferenceViolation[] {
  if (!registry.readFile) return [];
  const lines = text.split('\n');
  const citations = locateCitations(lines);
  const violations: ReferenceViolation[] = [];
  const seen = new Set<string>();
  const add = (ref: Reference, message: string) => {
    if (seen.has(message)) return;
    seen.add(message);
    violations.push({ ref, message });
  };

  for (const c of citations) {
    if (!registry.fileExists(c.path)) continue; // existence tier owns this
    const content = registry.readFile(c.path);
    if (content === undefined) continue;
    const ref: Reference = { kind: 'file', path: c.path, line: c.line };

    const total = countLines(content);
    const cited = lastLineOf(c.line);
    if (cited > total) {
      add(ref, `citation fidelity: ${c.path}:${c.line} cites line ${cited} but the file has only ${total} lines`);
      continue;
    }

    const lo = Math.max(0, c.lineIdx - 1);
    const hi = Math.min(lines.length - 1, c.lineIdx + 1);
    const windowCites = citations.filter((o) => o.lineIdx >= lo && o.lineIdx <= hi);
    if (new Set(windowCites.map((o) => o.path)).size > 1) continue; // ambiguous owner

    for (let i = lo; i <= hi; i++) {
      for (const lm of lines[i].matchAll(/`([^`\n]+)`/g)) {
        const literal = lm[1].replace(/\(\)$/, '');
        if (!FIDELITY_IDENT_RE.test(literal)) continue;
        if (literal.length < FIDELITY_MIN_LITERAL_LENGTH) continue;
        if (literal.includes(c.path)) continue;
        if (windowCites.some((o) => literal.includes(o.path))) continue;
        if (!containsGuarded(content, literal)) {
          add(
            ref,
            `citation fidelity: \`${literal}\` is cited near ${c.path}:${c.line} but does not appear in ${c.path}`,
          );
        }
      }
    }
  }
  return violations;
}
