/**
 * #1912 — the `status:` line carries a value and nothing else.
 *
 * TEST-FIRST (DR-003): written RED against a not-yet-wired `validateStatusAnnotation`.
 * The POSITIVE cases fail until the rule ships; the NEGATIVE guards pass trivially now
 * and must keep passing after — they are the ones that matter, because the corpus is
 * full of legitimately-annotated OTHER keys (`epic: EPIC-007  # Agent Execute …`) and a
 * rule that flags those would be worse than the defect it closes.
 *
 * Two shapes, one convention (#1900 — "move the status rationale off the line the status
 * writer owns"):
 *   A1 `status.inline-comment`  — an inline `#` on the status line. The three status
 *       writers rebuild that line as indent + key + value, so the comment is DESTROYED.
 *   A2 `status.orphan-comment`  — indented `#` lines directly after it. Those SURVIVE the
 *       rewrite and go on describing a value that no longer holds (SPEC-062 was the live
 *       case, #1879).
 *
 * T0 symmetry (#137): both shapes must fail, in one test, so the validator-asymmetry
 * class cannot return by fixing one direction and forgetting the other.
 *
 * Ships as `warn` (SPEC-038 FR-7 ratchet). Tests assert by rule identity, not severity,
 * except the one case that pins the ratchet itself.
 */
import { describe, it, expect } from 'vitest';
import { validateSpec } from '../src/lib/spec-validator';
import { parseSpec } from '../src/lib/spec';
import { DEFAULT_CONFIG } from '../src/lib/config';

const INLINE = 'status.inline-comment';
const ORPHAN = 'status.orphan-comment';
const PROSE = 'frontmatter.prose-line';

/** Build a raw spec whose frontmatter is assembled verbatim, so raw shape is under test. */
function spec(fmLines: string[]): string {
  return (
    ['---', 'id: SPEC-999', 'title: Status Annotation Test', 'tier: T2', ...fmLines, '---', '']
      .join('\n') + '\n## Specify\nx\n'
  );
}

const rules = (raw: string, config = DEFAULT_CONFIG): string[] =>
  validateSpec(parseSpec(raw), config).violations.map((v) => v.rule);

const severityOf = (raw: string, rule: string, config = DEFAULT_CONFIG): string | undefined =>
  validateSpec(parseSpec(raw), config).violations.find((v) => v.rule === rule)?.severity;

describe('#1912 status-line annotation', () => {
  // ── T0 invariant: symmetry (#137) ────────────────────────────────────────
  it('T0 — fails on BOTH shapes (asymmetry cannot return)', () => {
    expect(rules(spec(['status: planning  # rationale']))).toContain(INLINE);
    expect(rules(spec(['status: planning', '  # rationale continues here']))).toContain(ORPHAN);
  });

  // ── A1: inline comment on the status line ────────────────────────────────
  it('A1 — inline comment is flagged', () => {
    expect(rules(spec(['status: planning  # why'])))?.toContain(INLINE);
  });

  it('A1 — a single space before the # still counts', () => {
    expect(rules(spec(['status: planning # why']))).toContain(INLINE);
  });

  it('A1 — tab-separated comment still counts', () => {
    expect(rules(spec(['status: planning\t# why']))).toContain(INLINE);
  });

  // ── A2: orphan-able continuation lines ───────────────────────────────────
  it('A2 — one indented comment line after status is flagged', () => {
    expect(rules(spec(['status: planning', '  # orphan']))).toContain(ORPHAN);
  });

  it('A2 — several continuation lines are flagged once', () => {
    const found = rules(spec(['status: planning', '  # one', '  # two', '  # three'])).filter(
      (r) => r === ORPHAN,
    );
    expect(found).toHaveLength(1);
  });

  it('A2 — a continuation line before the NEXT key still belongs to status', () => {
    expect(rules(spec(['status: planning', '  # about status', 'tier2: x']))).toContain(ORPHAN);
  });

  // ── A2 widened (#1955 re-review): indent is not the signal ───────────────
  //
  // Every frontmatter comment survives the status write. Indentation only hints at what
  // the comment is ABOUT, so the run is read at any indent with one measured asymmetry.
  it('A2 — a column-0 run that NAMES the status is flagged (the steering hole)', () => {
    // `status.inline-comment` tells the author to move the rationale off the status line.
    // The nearest compliant-looking move is the same text one line down at column 0 — which
    // survives the rewrite identically and, before this widening, was green.
    const r = rules(
      spec(['status: planning', '# the status is planning because the approval is stale']),
    );
    expect(r).toContain(ORPHAN);
  });

  it('A2 — a column-0 run about ANOTHER key is not flagged (SPEC-044 shape)', () => {
    // Verbatim shape of both corpus instances: a note about the deliberately absent
    // `tier:`, sitting under `status:` because that is where the key order puts it.
    // Flagging these would be 2 false positives and 0 true positives.
    const r = rules(
      spec([
        'status: implementing',
        '# tier lives on requirements.md (the single tier-carrying approvable). A T3/T4 tier',
        '# on a NON-approved sibling doc can shadow the approved requirements.md.',
        'product: minspec',
      ]),
    );
    expect(r).not.toContain(ORPHAN);
  });

  it('A2 — an indented run is flagged even when it names nothing', () => {
    // The wrapped-continuation arm is unconditional: indentation under `status:` already
    // says the comment belongs to it, so no content test applies.
    expect(rules(spec(['status: planning', '  # see the decision record']))).toContain(ORPHAN);
  });

  it('A2 — a BLANK line ends the run (rejected widening, 0 corpus instances)', () => {
    // Deliberate: a comment past a blank line is as likely to annotate the next key.
    const r = rules(spec(['status: planning', '', '# the status here is provisional']));
    expect(r).not.toContain(ORPHAN);
  });

  it('A2 — a mixed run counts every line, once', () => {
    const r = rules(spec(['status: planning', '# about status', '  # wrapped', '# more'])).filter(
      (x) => x === ORPHAN,
    );
    expect(r).toHaveLength(1);
  });

  // ── Clean ────────────────────────────────────────────────────────────────
  it('a bare status line produces neither finding', () => {
    const r = rules(spec(['status: planning']));
    expect(r).not.toContain(INLINE);
    expect(r).not.toContain(ORPHAN);
  });

  // ── NEGATIVE GUARDS — the corpus is full of these; flagging them is worse ──
  it('an inline comment on a DIFFERENT key is never flagged', () => {
    const r = rules(spec(['status: planning', 'epic: EPIC-007  # Agent Execute — the pipeline']));
    expect(r).not.toContain(INLINE);
    expect(r).not.toContain(ORPHAN);
  });

  it('an indented comment inside a LATER block is never flagged', () => {
    const r = rules(
      spec(['status: planning', 'phases:', '  specify: done   # merged via PR #769']),
    );
    expect(r).not.toContain(ORPHAN);
    expect(r).not.toContain(INLINE);
  });

  it('an INDENTED status: key is never the one under test, even when it sorts first', () => {
    // Kills the unanchored-findIndex mutant: without the `^` anchor the nested
    // `status:` matches first and its inline comment is reported against the spec.
    //
    // The rule is scoped to the top-level key because that is the key it is ABOUT — NOT
    // because "no writer ever touches a nested key", which this comment used to claim and
    // which is false (the writers' `/^([ \t]*)status[ \t]*:.*$/m` is non-global and hits
    // the first `status:` at any indent). See the validator docblock; 0 corpus files order
    // their keys that way, so the divergence is latent.
    const r = rules(
      spec(['rollout:', '  status: draft  # nested, not the frontmatter status', 'status: planning']),
    );
    expect(r).not.toContain(INLINE);
    expect(r).not.toContain(ORPHAN);
  });

  it('a nested status: does not mask a REAL finding on the top-level one', () => {
    // The converse direction, so the anchor cannot be "fixed" by skipping the key
    // entirely whenever a nested one exists.
    const r = rules(
      spec(['rollout:', '  status: draft', 'status: planning  # why']),
    );
    expect(r).toContain(INLINE);
  });

  it('a comment line following a non-status key is never flagged', () => {
    const r = rules(spec(['tier2: x', '  # not about status', 'status: planning']));
    expect(r).not.toContain(ORPHAN);
  });

  it('a `#` in the BODY is never flagged', () => {
    const raw =
      ['---', 'id: SPEC-999', 'tier: T2', 'status: planning', '---', ''].join('\n') +
      '\n# Heading\n\nstatus: planning  # this is prose, not frontmatter\n';
    const r = rules(raw);
    expect(r).not.toContain(INLINE);
    expect(r).not.toContain(ORPHAN);
  });

  it('a `#` inside a quoted status value is not a comment', () => {
    expect(rules(spec(['status: "planning # not a comment"']))).not.toContain(INLINE);
  });

  // ── frontmatter.prose-line (#1955 review) ────────────────────────────────
  //
  // The gate for the defect this change itself made: a note moved OFF the status line
  // but landed inside the frontmatter, where the parser silently drops it and every
  // status write leaves it standing.
  it('a column-0 blockquote inside frontmatter is flagged', () => {
    expect(rules(spec(['status: planning', '> **Status note.** moved here by mistake']))).toContain(
      PROSE,
    );
  });

  it('several blockquote lines report once', () => {
    const found = rules(spec(['status: planning', '> one', '> two'])).filter((r) => r === PROSE);
    expect(found).toHaveLength(1);
  });

  it('indented text inside a REAL block scalar is never flagged', () => {
    // `key: >` + indented text is valid YAML. Flagging it would be a false positive on
    // a legitimate multi-line value. The exemption is the OPEN SCALAR, not the indent —
    // see the indented-under-a-value case below.
    expect(rules(spec(['status: planning', 'note: >', '  some folded text']))).not.toContain(PROSE);
  });

  it('every chomping/indent indicator opens a scalar (`>-`, `|`, `>2`)', () => {
    for (const opener of ['note: >-', 'note: >+', 'note: |', 'note: |-', 'note: >2']) {
      expect(rules(spec(['status: planning', opener, '  folded text']))).not.toContain(PROSE);
    }
  });

  it('the real corpus block scalar (`implements_reason: >-`) stays exempt', () => {
    // 9 files use exactly this shape; a regression here is a corpus-wide false positive.
    const r = rules(
      spec([
        'status: planning',
        'implements: none',
        'implements_reason: >-',
        '  This spec ships no code of its own; it is a convention change that',
        '  the validator enforces.',
      ]),
    );
    expect(r).not.toContain(PROSE);
  });

  it('a `>` line INSIDE an open scalar region is content, not prose', () => {
    const r = rules(
      spec(['status: planning', 'note: >-', '  intro line', '  > quoted inside the value']),
    );
    expect(r).not.toContain(PROSE);
  });

  // The escape hatch the #1955 re-review found: an indented `>` under a key that already
  // CARRIES a value cannot be a block scalar, and it escaped both rules —
  // `validateStatusAnnotation` only scans for `#`, so `validateSpec` returned [] and
  // `setSpecStatus` left the blockquote standing under a status it no longer described.
  it('an indented `>` under a VALUE-CARRYING key is flagged', () => {
    expect(
      rules(spec(['status: implementing', '  > **Status note.** why it is implementing'])),
    ).toContain(PROSE);
  });

  it('an indented `>` after a plain key elsewhere in the block is flagged', () => {
    expect(rules(spec(['status: planning', 'product: minspec', '  > parked prose']))).toContain(
      PROSE,
    );
  });

  it('a scalar region ENDS at the next key, so prose after it is still flagged', () => {
    const r = rules(
      spec(['status: planning', 'note: >-', '  folded text', 'product: minspec', '  > parked']),
    );
    expect(r).toContain(PROSE);
  });

  it('a blockquote in the BODY is never flagged', () => {
    const raw =
      ['---', 'id: SPEC-999', 'tier: T2', 'status: planning', '---', ''].join('\n') +
      '\n# Heading\n\n> **Status note.** this is where it belongs\n';
    expect(rules(raw)).not.toContain(PROSE);
  });

  it('clean frontmatter produces no prose finding', () => {
    expect(rules(spec(['status: planning']))).not.toContain(PROSE);
  });

  // ── Ratchet (SPEC-038 FR-7 pattern) ──────────────────────────────────────
  it('defaults to warn, and ratchets to error behind the config key', () => {
    const annotated = spec(['status: planning  # why']);
    expect(severityOf(annotated, INLINE)).toBe('warning');
    expect(
      severityOf(annotated, INLINE, { ...DEFAULT_CONFIG, statusLineAnnotation: 'error' as const }),
    ).toBe('error');
  });
});
