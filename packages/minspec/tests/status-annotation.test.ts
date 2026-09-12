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
    // `status:` matches first and its inline comment is reported against the spec,
    // even though no writer ever touches a nested key.
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

  // ── Ratchet (SPEC-038 FR-7 pattern) ──────────────────────────────────────
  it('defaults to warn, and ratchets to error behind the config key', () => {
    const annotated = spec(['status: planning  # why']);
    expect(severityOf(annotated, INLINE)).toBe('warning');
    expect(
      severityOf(annotated, INLINE, { ...DEFAULT_CONFIG, statusLineAnnotation: 'error' as const }),
    ).toBe('error');
  });
});
