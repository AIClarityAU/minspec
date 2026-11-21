/**
 * The owned-set oracle (SPEC-070 FR-5, design section 3 "Snapshot normalisation").
 *
 * One TypeScript function that agrees with the PreToolUse spec-gate's
 * `owned_file_set` (scripts/hooks/spec-gate.py) on what a spec OWNS, exposing the
 * STRUCTURED set (`implements:` + `affects:`, merged) separately from the FULL set
 * (structured plus the fuzzy `tasks.md` backtick arm). The structured set is the
 * value SPEC-070 signs into an approval record as `ownedAtApproval`; the full set is
 * what the gate freezes. Parity with Python is pinned, corpus-wide and on synthetic
 * fixtures, by tests/owned-set-parity.test.ts (AC-7). Change neither side alone.
 *
 * Every step below reproduces the gate's `fm_value` / `fm_list` / `consider()`
 * literally, storing the POST-transform string, because the gate applies no
 * normpath and set equality is on the raw stored string:
 *   - Python `str.strip()` is reproduced with Python's own whitespace class
 *     (PY_WS below), never `.trim()`. The two differ in both directions: Python
 *     strips U+001C-U+001F and U+0085, JavaScript strips U+FEFF.
 *   - Python `re` `.` excludes only `\n`; JavaScript `.` also excludes `\r`,
 *     U+2028 and U+2029. Every regex here spells `[^\n]` instead of `.`, or is
 *     replaced by an explicit emulation of the Python match.
 *   - Python `re.I` folds U+017F into `s`, U+212A into `k`, and U+0130/U+0131 into
 *     `i`; JavaScript `/i` without `u` folds no non-ASCII character into ASCII. The
 *     extension test therefore runs the shared pattern on the token AND on a copy
 *     with those four characters mapped to ASCII, widening TypeScript to Python
 *     without touching OWNED_SRC_EXT_PATTERN (whose string equality with the gate is
 *     pinned by tests/ownership-path-parity.test.ts).
 *   - Files are read the way Python text mode reads them: strict UTF-8 (a decode
 *     error reads as empty, as the gate's `except` does), a BOM kept, and universal
 *     newlines (`\r\n` and lone `\r` become `\n`).
 *   The design accepted the strip and `$` divergences as fail-closed residue; mirroring
 *   Python's whitespace class closes the strip one outright, and the `$` one cannot
 *   arise once a token has been Python-stripped (no trailing `\n` survives).
 *
 * THE INLINE-COMMENT DIVERGENCE (FR-5's first named divergence) - closed here,
 * explicitly accepted elsewhere. The gate's inline arm `fm_value` does no comment
 * handling, so `implements: packages/a/src/x.ts # see packages/b/src/y.ts` owns BOTH
 * paths (`#` and `see` die at the no-slash filter; `packages/b/src/y.ts` survives
 * every filter). The validator's twin `fmListField` (spec-validator.ts) strips the
 * inline comment first and yields only the first path; that asymmetry is deliberate
 * and documented there (#812). This module therefore has its OWN tokenizer that
 * KEEPS comment tokens and MUST NOT call `fmListField`: its whole contract is
 * equality with `owned_file_set`, and a narrower snapshot on a comment-carrying spec
 * would read as permanent ownership drift. Consequence of the accepted half: a spec
 * whose INLINE ownership line carries a path-shaped comment has that path frozen by
 * the gate and uncounted by `validateOwnership`, before SPEC-070 and after it. Block
 * form diverges on nothing (both twins strip `(?:#.*)?$` there).
 *
 * Deliberately NOT done (each would break set equality with the gate): no existence
 * check on structured tokens (they are creation-blocking, `require_exists=False`);
 * no normpath, no lowercasing, no `//` or `/./` collapse, no trailing-slash
 * handling; exactly ONE leading `./` stripped; no special case for `none`
 * (`implements: none` dies at the no-slash filter); dedup is exact-case. Output is
 * sorted for diff stability only - JavaScript sorts by UTF-16 code unit and Python
 * by code point, so nothing may compare order.
 *
 * Tier-0: no vscode import, no network (INV-3). Filesystem reads only in `ownedSets`
 * (the fuzzy arm) and `readGateFrontmatter`.
 */
import * as fs from 'fs';
import * as path from 'path';
import { OWNED_INFRA_PREFIXES, OWNED_SRC_EXT_PATTERN } from './ownership-path-rules';

export interface OwnedSets {
  /** `implements:` + `affects:` only - the set an approval signs. Never the fuzzy arm. */
  readonly structured: readonly string[];
  /** structured plus existing fuzzy `tasks.md` backtick paths - what the gate freezes. */
  readonly full: readonly string[];
}

/** Python `str.isspace()` / `re` `\s` for str patterns (verified against CPython 3.12). */
const PY_WS =
  '\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const PY_WS_CHAR = new RegExp(`[${PY_WS}]`);
/** `re.split(r'[,\s\[\]]+', inline)` from `fm_list`. */
const INLINE_SPLIT = new RegExp(`[,${PY_WS}\\[\\]]+`);

const SRC_EXT_RE = new RegExp(OWNED_SRC_EXT_PATTERN, 'i');
/** Non-ASCII characters CPython's `re.I` matches against an ASCII pattern letter. */
const PY_CASEFOLD_WIDEN: Readonly<Record<string, string>> = {
  'ſ': 's',
  'K': 'k',
  'İ': 'i',
  'ı': 'i',
};
const PY_CASEFOLD_WIDEN_RE = /[ſKİı]/g;
/** `_CODE_SPAN_RE` - `[^`]` crosses newlines in both engines. */
const CODE_SPAN_RE = /`([^`]+)`/g;
/** `re.match(r'^---\n(.*?)\n---', head, re.S)`. */
const GATE_FM_RE = /^---\n([\s\S]*?)\n---/;
/** The gate reads only the first 8000 CHARACTERS (code points) of a spec. */
const GATE_HEAD_CHARS = 8000;

/** Python `s.strip(chars)`; `chars` undefined means Python whitespace. */
function pyStrip(s: string, ch?: string): string {
  const hit = (c: string): boolean => (ch === undefined ? PY_WS_CHAR.test(c) : c === ch);
  let a = 0;
  let b = s.length;
  while (a < b && hit(s[a])) a++;
  while (b > a && hit(s[b - 1])) b--;
  return s.slice(a, b);
}

function leadingSpaceTab(s: string): number {
  let k = 0;
  while (k < s.length && (s[k] === ' ' || s[k] === '\t')) k++;
  return k;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The gate's `fm_value(text, key)`: `re.search(r'^key:[ \t]*(.+?)\s*$', text, re.M)`
 * then `.strip()`, or null when no line matches. Emulated rather than ported as a
 * regex because the engines disagree on `.`, `\s` and multiline `$`. Includes the
 * gate's quirk that `key:` followed only by spaces/tabs returns `''` (the greedy
 * `[ \t]*` backtracks one character for `.+?`), which makes a block-form list
 * written as `implements: ` (trailing space) tokenize to nothing.
 */
export function gateFmValue(text: string, key: string): string | null {
  const prefix = `${key}:`;
  for (const line of text.split('\n')) {
    if (!line.startsWith(prefix)) continue;
    const s = line.slice(prefix.length);
    const k = leadingSpaceTab(s);
    let j: number;
    if (s.length > k) j = k;
    else if (k >= 1) j = k - 1;
    else continue; // nothing after `key:` on this line - re.search tries later lines
    let end = s.length;
    while (end > 0 && PY_WS_CHAR.test(s[end - 1])) end--;
    return pyStrip(s.slice(j, Math.max(j + 1, end)));
  }
  return null;
}

/** `(.+?)[ \t]*(?:#.*)?$` tail check: the text after the lazy group. */
function blockItemRestMatches(rest: string): boolean {
  return /^[ \t]*(?:#[^\n]*)?$/.test(rest);
}

/**
 * One block-list item, `re.match(r'^[ \t]+-[ \t]*(.+?)[ \t]*(?:#.*)?$', line)`:
 * the lazy group, or null when the line is not an item.
 */
function blockItem(line: string): string | null {
  const lead = leadingSpaceTab(line);
  if (lead < 1 || line[lead] !== '-') return null;
  const s = line.slice(lead + 1);
  const k = leadingSpaceTab(s);
  for (let j = k; j >= 0; j--) {
    for (let e = j + 1; e <= s.length; e++) {
      if (blockItemRestMatches(s.slice(e))) return s.slice(j, e);
    }
  }
  return null;
}

/** The gate's `fm_list(fm, key)`: raw tokens, inline or block form, comments kept inline. */
export function gateFmList(fm: string, key: string): string[] {
  const unquote = (t: string): string => pyStrip(pyStrip(pyStrip(t), '"'), "'");
  const inline = gateFmValue(fm, key);
  if (inline !== null) {
    return inline.split(INLINE_SPLIT).filter((t) => t !== '').map(unquote);
  }
  const toks: string[] = [];
  const header = new RegExp(`^${escapeRe(key)}[ \\t]*:[ \\t]*(?:#[^\\n]*)?$`);
  const lines = fm.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!header.test(lines[i])) continue;
    for (const cont of lines.slice(i + 1)) {
      if (/^[ \t]*$/.test(cont)) continue;
      const item = blockItem(cont);
      if (item === null) break; // de-indented / next key -> list ended
      toks.push(unquote(item));
    }
    break;
  }
  return toks;
}

/**
 * The gate's `consider()` normalisation (steps 2-8 of design section 3): the stored
 * post-transform path, or null when the token is not owned code.
 */
function normaliseToken(token: string): string | null {
  const t = pyStrip(pyStrip(pyStrip(pyStrip(token), '"'), "'"));
  if (t === '' || !t.includes('/')) return null; // runs BEFORE backslash conversion
  let p = t.replace(/\\/g, '/');
  if (p.startsWith('./')) p = p.slice(2); // exactly one
  if (p.startsWith('/') || p.startsWith('../') || p.split('/').includes('..')) return null;
  if (OWNED_INFRA_PREFIXES.some((pre) => p.startsWith(pre))) return null; // case-sensitive
  const widened = p.replace(PY_CASEFOLD_WIDEN_RE, (c) => PY_CASEFOLD_WIDEN[c]);
  if (!SRC_EXT_RE.test(p) && !SRC_EXT_RE.test(widened)) return null;
  return p;
}

function sorted(set: Set<string>): string[] {
  return [...set].sort();
}

function addStructured(fm: string, into: Set<string>): void {
  for (const key of ['implements', 'affects']) {
    for (const tok of gateFmList(fm, key)) {
      const p = normaliseToken(tok);
      if (p !== null) into.add(p);
    }
  }
}

/**
 * The STRUCTURED owned set of a spec's frontmatter text (the block between the
 * `---` fences): `implements:` and `affects:` merged, normalised exactly as the gate
 * stores them, deduped exact-case, sorted. Pure - no I/O.
 */
export function structuredOwnedSet(frontmatter: string): string[] {
  const set = new Set<string>();
  addStructured(frontmatter, set);
  return sorted(set);
}

/**
 * Read a file the way Python text mode does: strict UTF-8, BOM kept, universal
 * newlines. Returns null when the file is unreadable or not valid UTF-8.
 */
function readPythonText(absPath: string): string | null {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(absPath);
  } catch {
    return null;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf);
    return text.replace(/\r\n?/g, '\n');
  } catch {
    return null;
  }
}

/** `os.path.isfile(os.path.join(cwd, p))`. */
function isFile(cwd: string, p: string): boolean {
  try {
    return fs.statSync(path.join(cwd, p), { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    return false;
  }
}

/**
 * `owned_file_set(cwd, specPath, frontmatter)` split in two. `specPath` resolves
 * against `cwd` (the gate passes an absolute path); its directory's `tasks.md`
 * feeds the fuzzy arm, whose tokens count only when they resolve to an existing
 * file under `cwd`. An absent, unreadable or non-UTF-8 `tasks.md` contributes
 * nothing, as the gate's `except` makes it.
 */
export function ownedSets(cwd: string, specPath: string, frontmatter: string): OwnedSets {
  const structured = new Set<string>();
  addStructured(frontmatter, structured);
  const full = new Set(structured);
  const tasks = readPythonText(path.join(path.dirname(path.resolve(cwd, specPath)), 'tasks.md')) ?? '';
  for (const m of tasks.matchAll(CODE_SPAN_RE)) {
    const p = normaliseToken(m[1]);
    if (p !== null && isFile(cwd, p)) full.add(p);
  }
  return { structured: sorted(structured), full: sorted(full) };
}

/**
 * The frontmatter text the gate hands to `owned_file_set` for a spec file: the
 * first 8000 characters read in Python text mode, matched against
 * `^---\n(.*?)\n---` (DOTALL). Null when the file is unreadable or has no
 * frontmatter inside that window - the gate then skips the spec entirely.
 */
export function readGateFrontmatter(absPath: string): string | null {
  const text = readPythonText(absPath);
  if (text === null) return null;
  const head = Array.from(text).slice(0, GATE_HEAD_CHARS).join('');
  const m = GATE_FM_RE.exec(head);
  return m ? m[1] : null;
}
