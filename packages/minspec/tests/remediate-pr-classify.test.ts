/**
 * T1/T2 — remediate-pr.sh classifier seam (drain PR-remediation sweep).
 *
 * The drain now sweeps open PRs and auto-remediates FIXABLE problems (ai-review:
 * changes, failing CI checks, behind-base) while SURFACING conflicts. The whole
 * decision lives in one pure CLI seam (`--classify`, no gh/git/claude) so it is
 * unit-testable in isolation — same convention as dispatch-ready-check.test.ts and
 * drain-continuous.test.ts. These assert the safety-critical properties:
 *   • only automation branches (agent/*, fix/*, feat/*) are ever touched, and
 *   • merge conflicts are NEVER auto-remediated (surfaced for a human), and
 *   • priority: real check failures before a re-review; behind-base last.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const SCRIPT = path.resolve(__dirname, '../../../scripts/remediate-pr.sh');
const LIB = path.resolve(__dirname, '../../../scripts/lib/agent-egress.sh');

// classify_pr(branch, mergeable, mergeState, labelsCsv, failingNonReview, aiReviewBad)
function classify(
  branch: string,
  mergeable: string,
  mergeState: string,
  labelsCsv: string,
  failingNonReview: 'yes' | 'no',
  aiReviewBad: 'yes' | 'no',
): string {
  return execFileSync(
    'bash',
    [SCRIPT, '--classify', branch, mergeable, mergeState, labelsCsv, failingNonReview, aiReviewBad],
    { encoding: 'utf-8' },
  ).trim();
}

describe('remediate-pr.sh --classify: scope gate (only automation branches)', () => {
  it('skips a non-automation branch even when it has a fixable problem', () => {
    expect(classify('main', 'MERGEABLE', 'BLOCKED', 'ai-review:changes', 'no', 'yes')).toBe('skip-not-automation');
    expect(classify('my-feature', 'MERGEABLE', 'UNSTABLE', '', 'yes', 'no')).toBe('skip-not-automation');
    expect(classify('dependabot/npm/x', 'MERGEABLE', 'BEHIND', '', 'no', 'no')).toBe('skip-not-automation');
  });

  it.each(['agent/issue-1', 'fix/489-x', 'feat/thing'])('accepts automation branch %s', (branch) => {
    expect(classify(branch, 'MERGEABLE', 'BLOCKED', 'ai-review:changes', 'no', 'no')).toBe('agent-remediate-review');
  });
});

describe('remediate-pr.sh --classify: conflicts are surfaced, never auto-fixed', () => {
  it('CONFLICTING → skip-conflict (even with a review/label problem alongside)', () => {
    expect(classify('fix/x', 'CONFLICTING', 'DIRTY', 'ai-review:changes', 'yes', 'yes')).toBe('skip-conflict');
  });
  it('mergeStateStatus DIRTY → skip-conflict', () => {
    expect(classify('fix/x', 'UNKNOWN', 'DIRTY', '', 'no', 'no')).toBe('skip-conflict');
  });
});

describe('remediate-pr.sh --classify: problem priority', () => {
  it('failing non-review checks beat a re-review (fix the code first)', () => {
    expect(classify('feat/y', 'MERGEABLE', 'UNSTABLE', 'ai-review:changes', 'yes', 'yes')).toBe('agent-remediate-checks');
  });

  it('ai-review:changes via LABEL routes to review remediation', () => {
    expect(classify('fix/x', 'MERGEABLE', 'BLOCKED', 'ai-review:changes', 'no', 'no')).toBe('agent-remediate-review');
  });

  it('ai-review red CHECK (no label) routes to review remediation', () => {
    expect(classify('fix/x', 'MERGEABLE', 'BLOCKED', '', 'no', 'yes')).toBe('agent-remediate-review');
  });

  it('behind base only → rebase-only (mechanical, no agent)', () => {
    expect(classify('feat/y', 'MERGEABLE', 'BEHIND', '', 'no', 'no')).toBe('rebase-only');
  });

  it('clean automation PR → skip-clean', () => {
    expect(classify('fix/x', 'MERGEABLE', 'CLEAN', '', 'no', 'no')).toBe('skip-clean');
    expect(classify('fix/x', 'MERGEABLE', 'BLOCKED', 'needs-human-review', 'no', 'no')).toBe('skip-clean');
  });
});

describe('remediate-pr.sh --classify: input hygiene', () => {
  it('tolerates an empty labels_csv without erroring', () => {
    // Regression: `${4:?}` used to reject an empty label CSV (colon errors on empty
    // too), aborting the seam. Count-check the args instead.
    expect(classify('fix/x', 'MERGEABLE', 'CLEAN', '', 'no', 'no')).toBe('skip-clean');
  });

  it('requires exactly 6 args (usage error otherwise)', () => {
    let code = 0;
    try {
      execFileSync('bash', [SCRIPT, '--classify', 'fix/x', 'MERGEABLE'], { encoding: 'utf-8', stdio: 'pipe' });
    } catch (e: any) {
      code = e.status ?? 1;
    }
    expect(code).toBe(2);
  });
});

describe('remediate-pr.sh: shared egress guard is reused (no security-control drift)', () => {
  it('sources the shared lib rather than re-implementing the scan', () => {
    const src = fs.readFileSync(SCRIPT, 'utf-8');
    expect(src).toContain('source "${SCRIPT_DIR}/lib/agent-egress.sh"');
    expect(src).toContain('agent_egress_scan');
  });

  it('the shared egress lib exists and defines agent_egress_scan', () => {
    expect(fs.existsSync(LIB)).toBe(true);
    expect(fs.readFileSync(LIB, 'utf-8')).toContain('agent_egress_scan()');
  });

  it('dispatch-issue.sh ALSO sources the shared lib — the no-drift invariant is real, both publish channels share one scan', () => {
    // The claim is "no drift between dispatch-issue.sh and remediate-pr.sh": it
    // only holds if BOTH source the lib. Extraction landed on main via #747;
    // this asserts the second consumer (#750) shares it, so a future patch to the
    // scan touches one file, not two.
    const dispatch = fs.readFileSync(path.resolve(__dirname, '../../../scripts/dispatch-issue.sh'), 'utf-8');
    expect(dispatch).toContain('source "${SCRIPT_DIR}/lib/agent-egress.sh"');
    expect(dispatch).toContain('agent_egress_scan');
    // And neither re-implements the scan body (no inline git-log-p orchestration).
    const remediate = fs.readFileSync(SCRIPT, 'utf-8');
    expect(remediate).not.toMatch(/git .*log -p .*origin\/main/);
    expect(dispatch).not.toMatch(/local -a targets=\(\)/); // the old inline guard's array
  });
});
