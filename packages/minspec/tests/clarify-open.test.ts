import { describe, it, expect } from 'vitest';
import { findOpenClarify } from '../../../scripts/lib/clarify-open';

describe('findOpenClarify (#3059)', () => {
  it('flags unanswered decisions', () => {
    const t = '# S\n\n## Decisions needed (Clarify)\n\n**D1. Width.**\n- (a) x\n\n**D2. Other.**\n- (a) y\n\n## Risks\n\n- D9 not here\n';
    expect(findOpenClarify(t)).toEqual({ open: true, items: ['D1', 'D2'] });
  });
  it('passes when the section says all are resolved', () => {
    expect(findOpenClarify('## Decisions needed (Clarify) — ALL RESOLVED 2026-08-14\n\n- **DQ-1 — x**\n').open).toBe(false);
    expect(findOpenClarify('## Decisions needed (Clarify)\n\n### DQ-1 (a) - RESOLVED: yes\n').open).toBe(false);
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
  it('a numbered list under an all-resolved heading is not open', () => {
    expect(findOpenClarify('## Decisions needed (Clarify) - all resolved\n\n1. **Where.** Hook.\n').open).toBe(false);
  });
  it('body prose saying all are decided does not close an unanswered decision (#3699)', () => {
    const t =
      '## Decisions needed (Clarify)\n\nAll 3 decisions below were decided by the runner.\n\n- **D1. Width.**\n  - (a) x\n- **D2. Other.**\n  **Recorded selection: Option (a).**\n';
    expect(findOpenClarify(t)).toEqual({ open: true, items: ['D1'] });
  });
  it('an item with its own recorded selection is closed; a restated label counts once', () => {
    const t = '## Decisions needed (Clarify)\n\n- **D1 - x.** Recorded selection: Option (a).\n\n### D1 - detail\n\nprose\n';
    expect(findOpenClarify(t).open).toBe(false);
  });
  it('flags letter-labelled decisions (SPEC-258 shape, #3230)', () => {
    const t = '## Decisions needed (Clarify)\n\n### DQ-A — Which bucket?\n\n### DQ-B — Where?\n\n- **D-C — x**\n\n## Risks\n';
    expect(findOpenClarify(t)).toEqual({ open: true, items: ['DQ-A', 'DQ-B', 'D-C'] });
  });
  it('does not treat QA or Q&A prose as a letter label', () => {
    expect(findOpenClarify('## Decisions needed (Clarify)\n\nQA pass and Q&A notes.\n').open).toBe(false);
  });
  it('a decision label or question line using selection words stays open (#3701 review)', () => {
    const labels = [
      '- **D1. Which width gets chosen**',
      '- **D2. Not yet decided: owner must pick.**',
      '### DQ-1 - To be decided (needs founder)',
      '- **D3. What is decided here:** a or b',
    ];
    for (const label of labels) {
      const t = `## Decisions needed (Clarify)\n\n${label}\n  - (a) x\n  - (b) y\n\n## Risks\n`;
      expect(findOpenClarify(t).open, label).toBe(true);
    }
  });
  it('a negated status never reads as answered (#3701 review)', () => {
    for (const status of ['NOT RESOLVED', 'Status: NOT RESOLVED', 'Resolved: TBD', 'Decided: not yet']) {
      const t = `## Decisions needed (Clarify)\n\n- **D1. Width.**\n  ${status}\n`;
      expect(findOpenClarify(t), status).toEqual({ open: true, items: ['D1'] });
    }
  });
  it('recorded selections in their real shapes still close (#3701 review)', () => {
    const recorded = [
      '  **Recorded selection: Option (a),** keep the order.',
      '  **Resolved: Option A.**',
      '  RESOLVED 2026-08-23 - Option A',
      '  RESOLVED: (d).',
      '  Status: RESOLVED: Option B.',
      '  question text → RESOLVED: out of scope.',
      '  with no artifact blocker.** **Resolved: milestones.**',
      '  > **RESOLVED — Option B: a dedicated command.**',
      '  → RESOLVED (2026-07-12, founder): new FR-6.',
      '  RESOLVED for the declaration, deferred only in extent',
      '  **Recorded selection: Option (a),** case-sensitive `DRAFT:` and `DRAFT?:` forms.',
      '  **Recorded answer: yes, four role files ship.**',
      '- **D1 - Recorded selection: Option (a),** clear means nothing open.',
    ];
    for (const r of recorded) {
      const t = `## Decisions needed (Clarify)\n\n- **D1. Width.**\n${r}\n`;
      expect(findOpenClarify(t).open, r).toBe(false);
    }
  });
  it('a record whose value wraps to the next line closes; an empty or question value does not (#3701 review)', () => {
    const wrapped = '## Decisions needed (Clarify)\n\n- **D5 — Thresholds.** like with like. **Recorded selection:**\n  `W` = 15 minutes.\n';
    expect(findOpenClarify(wrapped).open).toBe(false);
    const empty = '## Decisions needed (Clarify)\n\n- **D5 — Thresholds.** **Recorded selection:**\n\n- **D6 — x.** Resolved: a.\n';
    expect(findOpenClarify(empty)).toEqual({ open: true, items: ['D5'] });
    const question = '## Decisions needed (Clarify)\n\n- **D4. Resolved: which width wins?**\n';
    expect(findOpenClarify(question)).toEqual({ open: true, items: ['D4'] });
  });
  it('"not a choice" prose never closes an item that still lists options (#3701 review)', () => {
    const shapes = [
      '- **D1. Width.** Option space, not a choice yet: (a) 80 or (b) 120.',
      '- **D1. Width.**\n  Option space, not a choice:\n  - (a) 80\n  - (b) 120',
      '- **D1. Width.** This is not a choice we can make alone.',
    ];
    for (const b of shapes) {
      expect(findOpenClarify(`## Decisions needed (Clarify)\n\n${b}\n`), b).toEqual({ open: true, items: ['D1'] });
    }
  });
  it('option text and hyphenated "Not-yet-decided" are not a record (#3701 review)', () => {
    const shapes = [
      '- **D1. Width.**\n  - (b) Chosen - the faster path',
      '- **D1. Width.**\n- (b) Chosen - the faster path',
      '- **D1. Width.** Not-yet-decided: owner must pick',
      '- **D1. Width.**\n  Not-yet-decided: owner must pick',
    ];
    for (const b of shapes) {
      expect(findOpenClarify(`## Decisions needed (Clarify)\n\n${b}\n`), b).toEqual({ open: true, items: ['D1'] });
    }
  });
});
