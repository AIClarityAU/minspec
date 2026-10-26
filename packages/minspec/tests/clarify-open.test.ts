import { describe, it, expect } from 'vitest';
import { findOpenClarify } from '../../../scripts/lib/clarify-open';

describe('findOpenClarify (#3059)', () => {
  it('flags unanswered decisions', () => {
    const t = '# S\n\n## Decisions needed (Clarify)\n\n**D1. Width.**\n- (a) x\n\n**D2. Other.**\n- (a) y\n\n## Risks\n\n- D9 not here\n';
    expect(findOpenClarify(t)).toEqual({ open: true, items: ['D1', 'D2'] });
  });
  it('passes when the section says all are resolved', () => {
    expect(findOpenClarify('## Decisions needed (Clarify) — ALL RESOLVED 2026-08-14\n\n- **DQ-1 — x**\n').open).toBe(false);
    expect(findOpenClarify('## Decisions needed (Clarify)\n\n*All four questions are RESOLVED.*\n\n### DQ-1 (a)\n').open).toBe(false);
  });
  it('passes with no section or an empty one', () => {
    expect(findOpenClarify('# S\n\n- FR-1. x\n').open).toBe(false);
    expect(findOpenClarify('## Decisions needed (Clarify)\n\nNone.\n\n## Risks\n').open).toBe(false);
  });
  it('ignores a heading inside a code fence', () => {
    expect(findOpenClarify('```\n## Decisions needed\n**D1. x**\n```\n').open).toBe(false);
  });
  it('flags a numbered-list decision (SPEC-225 shape, #3060 missed it)', () => {
    const t =
      '## Decisions needed (Clarify)\n\n1. **Where the gate lives.**\n   - A. hook **(rec)**\n   - B. CI only\n' +
      '2. **Which fields count.** Use the strip-list **(rec)**.\n\n## Risks\n\n1. not a decision\n';
    expect(findOpenClarify(t)).toEqual({ open: true, items: ['1', '2'] });
  });
  it('a numbered list under an all-resolved section is not open', () => {
    expect(findOpenClarify('## Decisions needed (Clarify) - all resolved\n\n1. **Where.** Hook.\n').open).toBe(false);
  });
});
