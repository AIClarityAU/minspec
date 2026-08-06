/**
 * T0 — the WIRING between the `protected-branch` refusal and the recovery seam (#1115).
 *
 * approval-recover.test.ts proves the seam behaves; this proves the caller reaches it
 * — and, critically, that it does NOT reach it without consent. The same gap this
 * file's sibling was written for: a well-tested seam with an untested caller shipped a
 * dead code path in #975, and the review on #1255 flagged the same shape here.
 *
 * The consent rule under test is constitution invariant #1: no network call without
 * explicit user consent. `pushOnApprove: never`, and a declined `prompt`, must both
 * reach the seam ZERO times.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let CONFIG: Record<string, unknown> = {};
let WARN_CHOICE: string | undefined;
const warnings: string[] = [];
const infos: string[] = [];

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, def?: unknown) => (key in CONFIG ? CONFIG[key] : def),
    }),
  },
  window: {
    showWarningMessage: vi.fn(async (msg: string) => {
      warnings.push(msg);
      return WARN_CHOICE;
    }),
    showInformationMessage: vi.fn(async (msg: string) => {
      infos.push(msg);
      return undefined;
    }),
  },
  commands: { executeCommand: vi.fn(async () => undefined) },
  env: { openExternal: vi.fn(async () => undefined) },
  Uri: { parse: (s: string) => s },
}));

const commitApprovalMock = vi.fn();
vi.mock('../src/lib/approve-commit', () => ({
  commitApproval: (...a: unknown[]) => commitApprovalMock(...a),
  isUntrackedAtHead: vi.fn(async () => false),
}));

const recoverMock = vi.fn();
vi.mock('../src/lib/approval-recover', () => ({
  recoverProtectedBranchApproval: (...a: unknown[]) => recoverMock(...a),
}));

vi.mock('../src/lib/approve-push', () => ({ pushApproval: vi.fn() }));

import { commitApprovalIfEnabled } from '../src/commands/commit-on-approve';

/** The refusal this feature exists to rescue. */
const REFUSED = {
  outcome: 'protected-branch' as const,
  branch: { current: 'main', default: 'main' },
};

beforeEach(() => {
  CONFIG = { commitOnApprove: true };
  WARN_CHOICE = undefined;
  warnings.length = 0;
  infos.length = 0;
  commitApprovalMock.mockReset().mockResolvedValue(REFUSED);
  recoverMock.mockReset().mockResolvedValue({
    outcome: 'recovered',
    branch: 'approvals/spec-099-x',
    compareUrl: 'https://github.com/O/R/compare/approvals%2Fspec-099-x?expand=1',
    paths: ['specs/x/requirements.md'],
  });
});

describe('protected-branch recovery wiring — #1115', () => {
  it('INV-1 (constitution #1): pushOnApprove=never NEVER reaches the seam, and shows no prompt', async () => {
    CONFIG.pushOnApprove = 'never';
    const r = await commitApprovalIfEnabled('/root', ['/root/specs/x/requirements.md'], 'msg');
    expect(recoverMock).not.toHaveBeenCalled();
    // Falls back to the honest warning — the approval really is still local.
    expect(r.suffix).toContain('NOT committed');
    expect(warnings.join('\n')).toContain('default branch');
  });

  it('INV-1: a DECLINED prompt reaches the seam zero times', async () => {
    CONFIG.pushOnApprove = 'prompt';
    WARN_CHOICE = 'Not now';
    const r = await commitApprovalIfEnabled('/root', ['/root/specs/x/requirements.md'], 'msg');
    expect(recoverMock).not.toHaveBeenCalled();
    expect(r.suffix).toContain('NOT committed');
  });

  it('#1255 nit: declining shows ONE warning, not the offer plus a near-identical repeat', async () => {
    CONFIG.pushOnApprove = 'prompt';
    WARN_CHOICE = 'Not now';
    await commitApprovalIfEnabled('/root', ['/root/specs/x/requirements.md'], 'msg');
    // Exactly the offer. Re-showing "NOT committed / default branch" after the user
    // has just read and answered it makes a deliberate choice look like an error.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Save it on a branch');
  });

  it('pushOnApprove=never still shows the fallback warning — the user was never asked', async () => {
    // The complement of the case above: silence here would leave the approval
    // uncommitted with no signal at all, which is the #1064 defect.
    CONFIG.pushOnApprove = 'never';
    await commitApprovalIfEnabled('/root', ['/root/specs/x/requirements.md'], 'msg');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('default branch');
    expect(warnings[0]).not.toContain('Save it on a branch');
  });

  it('an ACCEPTED prompt runs recovery and reports the branch honestly', async () => {
    CONFIG.pushOnApprove = 'prompt';
    WARN_CHOICE = 'Save it on a branch';
    const r = await commitApprovalIfEnabled('/root', ['/root/specs/x/requirements.md'], 'msg');
    expect(recoverMock).toHaveBeenCalledTimes(1);
    expect(r.suffix).toContain('approvals/spec-099-x');
    expect(r.suffix).not.toContain('NOT committed');
  });

  it('pushOnApprove=always recovers with no prompt at all', async () => {
    CONFIG.pushOnApprove = 'always';
    await commitApprovalIfEnabled('/root', ['/root/specs/x/requirements.md'], 'msg');
    expect(recoverMock).toHaveBeenCalledTimes(1);
    expect(warnings).toHaveLength(0);
  });

  it('#1255: passes the REFUSED branch as baseBranch, not a hardcoded main', async () => {
    CONFIG.pushOnApprove = 'always';
    commitApprovalMock.mockResolvedValue({
      outcome: 'protected-branch',
      branch: { current: 'master', default: 'master' },
    });
    await commitApprovalIfEnabled('/root', ['/root/specs/x/requirements.md'], 'msg');
    const opts = recoverMock.mock.calls[0][3] as { baseBranch?: string };
    expect(opts.baseBranch).toBe('master');
  });

  it('a FAILED recovery falls back to the honest warning — never a false success', async () => {
    CONFIG.pushOnApprove = 'always';
    recoverMock.mockResolvedValue({ outcome: 'offline', error: 'could not resolve host' });
    const r = await commitApprovalIfEnabled('/root', ['/root/specs/x/requirements.md'], 'msg');
    expect(r.suffix).toContain('NOT committed');
    expect(warnings.join('\n')).toContain('default branch');
  });

  it('a THROWING seam still degrades to the warning — commitApprovalIfEnabled never rejects', async () => {
    CONFIG.pushOnApprove = 'always';
    recoverMock.mockRejectedValue(new Error('boom'));
    const r = await commitApprovalIfEnabled('/root', ['/root/specs/x/requirements.md'], 'msg');
    expect(r.suffix).toContain('NOT committed');
  });
});
