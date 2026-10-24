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
});
