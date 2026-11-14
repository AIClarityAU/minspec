import { describe, it, expect } from 'vitest';
import { bodyReadinessProblems, readinessVerdict } from '../../../scripts/lib/approval-readiness';

/**
 * T3 regression for the 2026-11-12 approval asks (queue items sp213, sp217, sp227): each
 * was filed while the spec body still declared itself unfinished, the founder approved, the
 * body was then fixed (#3696), and the fix voided his approvals (#3680-#3682 closed). The
 * excerpts below are the real pre-#3696 lines (`git show a60a245e^:<path>`); each must be
 * refused. The post-#3696 lines that replaced them must pass.
 */

const FM = '---\nid: SPEC-900\nstatus: specifying\nphases:\n  clarify: pending\n---\n\n# SPEC-900\n\n';

const PRE_213 =
  FM +
  'answers (DLG-001, DR-108, covers spec approval and engineering-DR acceptance only). This spec is\n' +
  'unapproved, so these selections bind nothing until a human or a covered delegation approves it. This\n' +
  'spec is T4, and the FR-2 table (`specs/minspec/requirements.md:74`) requires stakeholder review of a\n' +
  'T4 Clarify. No stakeholder has reviewed these selections (SPEC-281 D3 proposes dropping that phrase,\n' +
  'and that selection is itself unratified), so `phases.clarify` stays `pending`.\n';

const PRE_217 =
  FM +
  'recorded selection, but the evidence gap under DQ-3 stays open and that text leaves it to the\n' +
  'founder, so `phases.clarify` stays `pending`.\n';

const PRE_227 =
  FM +
  'Selection (b) is recorded, so the cheaper-claimant rule\n' +
  'applies, and FR-10 needs rewriting in Clarify before Plan.\n' +
  'This section stays open, and the spec is not ready to approve, until the founder confirms\n' +
  'DQ-2 and DQ-4 and approves the text with the DQ-5 selection in place.\n';

const PRE_227_DQ5 =
  FM +
  'place. FR-10 therefore needs rewriting in Clarify before Plan, as the closing paragraph of\n' +
  'this decision says; this record does not edit FR-10.\n';

const POST_213 =
  FM +
  'answers (DLG-001, DR-108, covers spec approval and engineering-DR acceptance only). These\n' +
  'selections bind nothing until a human or a covered delegation approves this spec; that approval,\n' +
  'not this record, is what ratifies them, and it may overturn them. This spec is T4, and the FR-2\n' +
  'table (`specs/minspec/requirements.md:74`) requires stakeholder review of a T4 Clarify (SPEC-281 D3\n' +
  'proposes dropping that phrase, and that selection is itself unratified). The approval is that\n' +
  'review: `phases.clarify` is `done` only as a result of an approval, and this text records no\n' +
  'such approval.\n';

const POST_217 =
  FM +
  'recorded selection. The evidence gap under DQ-3 stays open as a finding for the approver to weigh\n' +
  '(it is not a pending Clarify item); approval of this spec\'s text is the confirmation or reversal\n' +
  'of every selection above, and `phases.clarify` is `done` only as a result of such an approval,\n' +
  'which this text does not record.\n';

const POST_227 =
  FM +
  'applies; FR-10 has been rewritten to match it. The founder\'s approval of this\n' +
  'text, with the DQ-2, DQ-4 and DQ-5 selections in place, is what confirms them; this\n' +
  'record writes no such approval.\n' +
  'place. FR-10 is written to match this selection.\n';

const rules = (t: string): string[] => bodyReadinessProblems(t).map((p) => p.rule);

describe('bodyReadinessProblems - the 2026-11-12 asks (T3, sp213/sp217/sp227)', () => {
  it('refuses SPEC-213 as it stood when sp213 was filed', () => {
    const p = bodyReadinessProblems(PRE_213);
    expect(p.map((x) => x.rule)).toEqual(expect.arrayContaining(['pending-phase-prose']));
    // Line numbers are file lines (frontmatter counted), so the founder's editor goes straight there.
    expect(p.find((x) => /phases\.clarify/.test(x.text))?.line).toBe(14);
    expect(p.some((x) => /unapproved/.test(x.text))).toBe(true);
  });
  it('refuses SPEC-217 as it stood when sp217 was filed', () => {
    expect(rules(PRE_217)).toContain('pending-phase-prose');
  });
  it('refuses SPEC-227 as it stood when sp227 was filed (self-declared not ready, FR-10 rewrite deferred)', () => {
    const r = rules(PRE_227);
    expect(r).toContain('self-declared-not-ready');
    expect(r).toContain('deferred-edit');
    expect(r).toContain('pending-phase-prose'); // "This section stays open"
    expect(rules(PRE_227_DQ5)).toEqual(['deferred-edit', 'deferred-edit']);
  });
  it('passes the post-#3696 text that replaced each passage', () => {
    expect(bodyReadinessProblems(POST_213)).toEqual([]);
    expect(bodyReadinessProblems(POST_217)).toEqual([]);
    expect(bodyReadinessProblems(POST_227)).toEqual([]);
  });
});

describe('bodyReadinessProblems - other shapes', () => {
  it('refuses the delegated-lane shape (#3702-#3704)', () => {
    expect(rules(FM + 'Clarify stays open. No human chose any option.\n')).toEqual(['pending-phase-prose']);
  });
  it('refuses an unrecorded Clarify decision (reuses findOpenClarify)', () => {
    const t = FM + '## Decisions needed (Clarify)\n\n### DQ-1 - Width?\n\n(a) x **(rec)**\n\n### DQ-2 - Depth?\n\n**Recorded selection: (a),** y.\n';
    const p = bodyReadinessProblems(t);
    expect(p).toHaveLength(1);
    expect(p[0].rule).toBe('open-clarify');
    expect(p[0].text).toContain('DQ-1');
  });
  it('never reads the frontmatter', () => {
    expect(bodyReadinessProblems('---\nid: SPEC-1\nnote: phases.clarify stays pending\n---\n\n# x\n')).toEqual([]);
  });
  it('ignores fenced code and double-quoted examples (a spec about this rule must be able to quote it)', () => {
    expect(bodyReadinessProblems(FM + '```\nso `phases.clarify` stays `pending`\n```\n')).toEqual([]);
    expect(bodyReadinessProblems(FM + 'For example "so `phases.clarify` stays `pending`" is flagged.\n')).toEqual([]);
    expect(bodyReadinessProblems(FM + 'Prose such as “the spec is not ready to approve” is flagged.\n')).toEqual([]);
  });
  it('matches across a wrapped line and reports the line the match starts on', () => {
    const p = bodyReadinessProblems(FM + 'Intro.\n\nThe gate holds, and the spec is not\nready to approve yet.\n');
    expect(p.map((x) => [x.rule, x.line])).toEqual([['self-declared-not-ready', 12]]);
  });
  it('does not flag ordinary uses of open/pending', () => {
    expect(
      bodyReadinessProblems(
        FM + 'The evidence gap is open because X is unmeasured. A pending job retries. The PR stays open until CI passes.\n' +
          'FR-3 is rewritten by the reader at load time.\n' +
          // corpus-survey false hits, 2026-11-14: an issue title (SPEC-296) and another spec (SPEC-314)
          '- #3104 (Clarify pending with no decision text detected) is an inherited hole.\n' +
          'No commit is refused merely because some spec is unapproved.\n',
      ),
    ).toEqual([]);
  });
});

describe('readinessVerdict', () => {
  it('is ready only with an approvable status, no approve-command refusal and a clean body', () => {
    expect(readinessVerdict({ status: 'specifying', notApprovable: undefined, content: POST_227 }).ready).toBe(true);
    expect(readinessVerdict({ status: 'new', notApprovable: undefined, content: POST_227 }).ready).toBe(true);
  });
  it('refuses an already-approved spec (pre-flight check 4)', () => {
    const v = readinessVerdict({ status: 'planning', notApprovable: undefined, content: POST_227 });
    expect(v.ready).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/already past the approval gate/);
  });
  it('carries the Approve Spec refusal verbatim', () => {
    const v = readinessVerdict({ status: 'specifying', notApprovable: 'the spec is not complete: implements missing', content: POST_227 });
    expect(v.ready).toBe(false);
    expect(v.reasons).toContain('approve-command: the spec is not complete: implements missing');
  });
  it('carries body problems with their line', () => {
    const v = readinessVerdict({ status: 'specifying', notApprovable: undefined, content: PRE_227 });
    expect(v.ready).toBe(false);
    expect(v.reasons.some((r) => /^line 11 deferred-edit:/.test(r))).toBe(true);
  });
});
