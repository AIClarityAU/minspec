/**
 * Deterministic body↔frontmatter status parity (#626).
 *
 * The #362 backfill found ~20-29 approvables whose frontmatter `status:` disagrees with
 * the body status line — because status-correction / re-approval commits flip the
 * frontmatter field to match the approval record and leave the prose header stale, and
 * nothing checked the two agree. This is the recurring VALIDATOR-ASYMMETRY class:
 * present-and-valid is checked, but cross-representation PARITY of the same fact is not.
 * In a never-wrong-signpost product, two disagreeing status readouts in one file is the
 * worst defect class.
 *
 * This is a pure, deterministic check (no LLM). It extracts the leading RECOGNISED status
 * token from the body status line and compares it to the frontmatter status. It is
 * deliberately CONSERVATIVE: a body line whose leading token is not a recognised status
 * word (free-form prose like "Clarify complete — awaiting Approve") yields NO finding, so
 * it can never false-positive — a false validator error would block a legitimate commit,
 * which the never-wrong invariant forbids.
 *
 * Body status conventions:
 *   - spec: a `**Status:** <word> …` line (the `<word>` may be followed by free prose).
 *   - DR:   a `## Status` heading, then the first non-empty line's leading word, which the
 *           house style EMPHASISES (`**Accepted**, 2026-07-26`).
 *
 * #968 — two defects fixed here, one of them structural:
 *
 *  1. The DR arm matched `/^([A-Za-z]+)/` directly against the line, so an emphasised word
 *     ("**Proposed**, …") began with `*`, failed, and yielded no token. Measured at the
 *     time: 22 DRs carried a body `## Status`, 2 were emphasised, and those same 2 were the
 *     register's ONLY genuine mismatches — the gate missed 2/2 real defects while correctly
 *     clearing the 20 unemphasised ones. Leading emphasis is now stripped before matching.
 *
 *  2. More importantly, `null` was OVERLOADED — it meant both "consistent / nothing to
 *     compare" and "this line defeated the parser". Those are opposite facts, and collapsing
 *     them is why (1) hid for weeks: an inert branch was indistinguishable from a passing
 *     one. `inspectStatusLine` now reports WHICH non-comparable case occurred, so callers can
 *     surface "I could not read this" instead of silently treating it as agreement. Fixing
 *     only the regex would have left the next unrecognised shape just as silent
 *     (constitution invariant #2 — no silent gate).
 *
 * The conservative contract is unchanged: `unparseable` and `freeform` still produce NO
 * parity finding. Visibility is the caller's job (the validator WARNs); this module never
 * escalates an unreadable line into a blocking error.
 */

/** Which artifact family — decides the recognised status vocabulary. */
export type ArtifactKind = 'spec' | 'dr';

/** SPEC_STATUSES (spec.ts) — the closed spec status enum. */
const SPEC_STATUS_WORDS: ReadonlySet<string> = new Set([
  'new',
  'specifying',
  'planning', // DR-069 (#886)
  'implementing',
  'done',
  'archived',
  'superseded',
]);

/** AdrStatus (adr-manager.ts) — the closed DR status enum. */
const DR_STATUS_WORDS: ReadonlySet<string> = new Set([
  'proposed',
  'accepted',
  'deprecated',
  'superseded',
]);

function statusWords(kind: ArtifactKind): ReadonlySet<string> {
  return kind === 'spec' ? SPEC_STATUS_WORDS : DR_STATUS_WORDS;
}

export interface BodyStatus {
  /** The recognised leading status token, lowercased. */
  readonly token: string;
  /** 1-based line number of the body status line (for the diagnostic). */
  readonly line: number;
}

/**
 * What the body status line turned out to be. The three non-comparable cases are kept
 * DISTINCT on purpose (#968): collapsing them into a bare `null` is what let an inert
 * parser branch masquerade as a passing check.
 *
 *  - `comparable`  — a recognised status word was read; parity can be judged.
 *  - `freeform`    — a word was read but it is not in this artifact's vocabulary
 *                    ("Clarify complete — awaiting Accept"). Legitimate and common; not a
 *                    defect, and deliberately low-noise.
 *  - `unparseable` — a status line EXISTS but no leading word could be read from it. This
 *                    is the dangerous class: it means the corpus uses a shape this module
 *                    does not understand, so the gate is silently not running on that file.
 *  - `absent`      — no status line at all. Nothing to check.
 */
export type BodyStatusResult =
  | { readonly kind: 'comparable'; readonly token: string; readonly line: number }
  | { readonly kind: 'freeform'; readonly token: string; readonly line: number }
  | { readonly kind: 'unparseable'; readonly line: number; readonly text: string }
  | { readonly kind: 'absent' };

/**
 * Leading markdown emphasis (`**`, `__`, `*`, `_`) carries no semantic weight for a status
 * word, but it does defeat a `^[A-Za-z]` match — which was exactly bug #968. Stripping it is
 * safe because the RECOGNISED-word guard downstream is unchanged: widening what can be READ
 * never widens what counts as a status.
 */
function stripLeadingEmphasis(line: string): string {
  return line.replace(/^[*_]+/, '');
}

function classify(raw: string, line: number, words: ReadonlySet<string>): BodyStatusResult {
  const m = stripLeadingEmphasis(raw.trim()).match(/^([A-Za-z]+)/);
  if (!m) return { kind: 'unparseable', line, text: raw.trim().slice(0, 80) };
  const token = m[1].toLowerCase();
  return words.has(token) ? { kind: 'comparable', token, line } : { kind: 'freeform', token, line };
}

/**
 * A DR's status assertion written as a head callout — `> **Status: proposed — …**`.
 *
 * Deliberately narrow, because a false FATAL blocks legitimate commits: the line must
 * start a blockquote and its FIRST field must literally be `Status:`. The recognised-word
 * guard in `classify` is unchanged, so free-form text after the word still reads as
 * `freeform` and never as a mismatch — widening what can be READ never widens what counts
 * as a status.
 */
function headBlockquoteStatus(
  lines: readonly string[],
  words: ReadonlySet<string>,
): BodyStatusResult | null {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^>\s*[*_]{0,2}Status:\s*(.+)$/i);
    if (m) return classify(m[1], i + 1, words);
  }
  return null;
}

/**
 * Inspect the body status line and report which case it is. Never throws.
 *
 * Prefer this over {@link bodyStatusToken} when you care about the DIFFERENCE between
 * "agrees" and "could not be read" — e.g. a validator that should warn about shapes it
 * cannot parse rather than passing them in silence.
 */
export function inspectStatusLine(content: string, kind: ArtifactKind): BodyStatusResult {
  const lines = content.split('\n');
  const words = statusWords(kind);

  if (kind === 'spec') {
    for (let i = 0; i < lines.length; i++) {
      if (!/^\*\*Status:\*\*/.test(lines[i])) continue;
      // NB: the spec token is deliberately NOT emphasis-stripped. `setBodyStatusToken`
      // (spec.ts) rewrites this line with /^(\*\*Status:\*\*[ \t]*)[A-Za-z]+/, so reading a
      // shape the writer cannot rewrite would reintroduce the read/write asymmetry this
      // module exists to prevent. No spec in the corpus emphasises its token; if one ever
      // does, it surfaces as `unparseable` (visible) rather than being silently skipped.
      const m = lines[i].match(/^\*\*Status:\*\*\s*([A-Za-z]+)/);
      if (!m) return { kind: 'unparseable', line: i + 1, text: lines[i].trim().slice(0, 80) };
      const token = m[1].toLowerCase();
      return words.has(token)
        ? { kind: 'comparable', token, line: i + 1 }
        : { kind: 'freeform', token, line: i + 1 };
    }
    return { kind: 'absent' };
  }

  // DR: the `## Status` section — the first non-empty line after the heading.
  for (let i = 0; i < lines.length; i++) {
    if (!/^##\s+Status\b/i.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      return classify(lines[j], j + 1, words);
    }
    return { kind: 'absent' };
  }

  // FALLBACK: a blockquote status assertion near the head (#1223).
  //
  // Many DRs carry their real status caveat as a callout under the H1 rather than in a
  // `## Status` section — `> **Status: proposed — scope-split by DR-024.**`. Without this
  // the inspector returned `absent`, so Rule 11 compared NOTHING and passed in silence.
  // DR-022 sat that way for two months: frontmatter `accepted`, its own body `proposed`,
  // on a T4 decision about the ceremony model. One document, but the register's whole
  // job is to be the thing you can trust without reading the prose.
  //
  // Deliberately narrow, because a false FATAL blocks legitimate commits: the line must
  // start a blockquote and its FIRST field must literally be `Status:`. The recognised-
  // word guard in `classify` is unchanged, so free-form text after the word still reads
  // as `freeform` and never as a mismatch — widening what can be READ never widens what
  // counts as a status.
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^>\s*[*_]{0,2}Status:\s*(.+)$/i);
    if (m) return classify(m[1], i + 1, words);
  }

  return { kind: 'absent' };
}

/**
 * Extract the body status line's leading RECOGNISED status token, or null when there is
 * no body status line, or its leading token is not a recognised status word (free-form).
 * Returning null on an unrecognised token is what makes the parity check false-positive
 * free.
 *
 * Thin wrapper over {@link inspectStatusLine}, kept for callers that only need the token
 * (notably `setBodyStatusToken` in spec.ts, the write-path half of this gate).
 */
export function bodyStatusToken(content: string, kind: ArtifactKind): BodyStatus | null {
  const r = inspectStatusLine(content, kind);
  return r.kind === 'comparable' ? { token: r.token, line: r.line } : null;
}

export interface StatusParityFinding {
  /** frontmatter `status:` value (lowercased). */
  readonly frontmatter: string;
  /** the body line's recognised status token (lowercased). */
  readonly body: string;
  /** 1-based line of the body status line. */
  readonly line: number;
}

/**
 * Returns a parity finding when the body's recognised status token disagrees with the
 * frontmatter status; otherwise null. Null (consistent / not comparable) when: frontmatter
 * status is empty, there is no body status line, or the body's leading token is free-form
 * (unrecognised). Never throws.
 */
export function checkStatusParity(
  content: string,
  frontmatterStatus: string | undefined,
  kind: ArtifactKind,
): StatusParityFinding | null {
  // Frontmatter values may carry a trailing `# inline comment` (e.g.
  // `status: implementing  # harness built …`) — strip it and take the leading token,
  // so a status that AGREES but is annotated never false-positives.
  const fm = (frontmatterStatus ?? '')
    .replace(/\s*#.*$/, '')
    .trim()
    .toLowerCase()
    .split(/\s+/)[0] ?? '';
  if (!fm) return null;
  const body = inspectStatusLine(content, kind);
  // Only a recognised token is comparable. `freeform` / `unparseable` / `absent` never
  // produce a finding — see the module header on why unreadable must not mean "blocking".
  if (body.kind !== 'comparable') return null;
  if (body.token === fm) return null;
  return { frontmatter: fm, body: body.token, line: body.line };
}

/**
 * EVERY status claim in the body, not just the first.
 *
 * WHY THE SINGULAR VERSION IS NOT ENOUGH (#1223 — and this fix's own first attempt got it
 * wrong): a DR can carry BOTH a `## Status` section and a head blockquote, and they can
 * DISAGREE. `inspectStatusLine` returns one — the section — so a validator built on it
 * compares the claim that happens to agree with frontmatter and never sees the other.
 *
 * That is exactly how DR-022 hid for two months. Three representations: frontmatter
 * `accepted`, `## Status` `accepted`, head blockquote `proposed`. Rule 11 compared the two
 * that agreed. A section-absent-only fallback does NOT help, because the section was
 * present — verified against the real file, after an earlier "proof" used a fabricated
 * input with the section stripped.
 *
 * So: return them all, and let the caller reject ANY comparable claim that disagrees. A
 * document showing two different statuses is a false signpost whichever one is read first.
 */
export function inspectAllStatusClaims(content: string, kind: ArtifactKind): BodyStatusResult[] {
  const claims: BodyStatusResult[] = [];
  const primary = inspectStatusLine(content, kind);
  if (primary.kind !== 'absent') claims.push(primary);

  if (kind === 'dr') {
    const bq = headBlockquoteStatus(content.split('\n'), statusWords(kind));
    // Only add it when it is a DIFFERENT line: when there is no `## Status` section,
    // inspectStatusLine already returned this very blockquote, and reporting it twice
    // would double-count for any caller tallying findings.
    const already = claims.some((c) => 'line' in c && bq !== null && 'line' in bq && c.line === bq.line);
    if (bq && !already) claims.push(bq);
  }
  return claims;
}
