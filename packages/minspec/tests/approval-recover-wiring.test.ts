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

/**
 * #1653 — the recovery path now FINISHES into a PR via `openApprovalPr`, so this
 * file must mock the `gh`/git seam. Without it these unit tests would spawn a real
 * `gh pr create`: the recovery mock returns a plausible branch name, and `gh` IS
 * installed and authenticated in CI and in the dev container. A unit test that can
 * open a real pull request is not a unit test.
 */
const openPullRequestMock = vi.fn();
const branchChangedPathsMock = vi.fn();
const resolveHeadShaMock = vi.fn();
const bodyArgs: Array<{ sha?: string }> = [];
vi.mock('../src/lib/approval-pr', () => ({
  openPullRequest: (...a: unknown[]) => openPullRequestMock(...a),
  branchChangedPaths: (...a: unknown[]) => branchChangedPathsMock(...a),
  // Real behaviour is a pure path predicate (zero I/O), but re-deriving it here
  // would let this test disagree with the shipped corpus. The lane label is
  // asserted from what `openPullRequest` was CALLED with, so a fixed answer is
  // enough and keeps the mock honest about what it is standing in for.
  laneLabelsFor: (paths: readonly string[] | undefined) =>
    paths && paths.length > 0 ? ['docs-lane'] : [],
  // Captures what the body builder is handed, so the #1653-review SHA finding is
  // asserted on the VALUE that reaches the PR body rather than on a call count.
  buildApprovalPrBody: (a: { sha?: string }) => {
    bodyArgs.push(a);
    return 'body';
  },
  defaultExecRun: () => vi.fn(),
  resolveHeadSha: (...a: unknown[]) => resolveHeadShaMock(...a),
}));

vi.mock('../src/lib/approval-store', () => ({
  readRecord: () => undefined,
  toPosixRel: (p: string) => p,
}));

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
  bodyArgs.length = 0;
  commitApprovalMock.mockReset().mockResolvedValue(REFUSED);
  openPullRequestMock
    .mockReset()
    .mockResolvedValue({ outcome: 'created', url: 'https://github.com/O/R/pull/7' });
  branchChangedPathsMock
    .mockReset()
    .mockResolvedValue(['.minspec/approvals/specs/x/requirements.md.json']);
  resolveHeadShaMock.mockReset().mockResolvedValue('BASE_TIP_NOT_THE_APPROVAL');
  recoverMock.mockReset().mockResolvedValue({
    outcome: 'recovered',
    branch: 'approvals/spec-099-x',
    compareUrl: 'https://github.com/O/R/compare/approvals%2Fspec-099-x?expand=1',
    paths: ['specs/x/requirements.md'],
    sha: 'RECOVERYCOMMIT',
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

  // ── #1653 — the recovered branch must be FINISHED into a PR ────────────────
  //
  // The defect: this path stopped at a toast whose `Open PR` action opened the
  // compare page, so `openApprovalPr` was never reached from the ONE workflow that
  // always lands here (approving while on `main`, per DR-051). SPEC-050 shipped and
  // was unreachable; 12 of 12 recent approval PRs were hand-created, unlabelled, and
  // needed a manual bypass merge.

  it('T3 #1653: a RECOVERED approval opens the PR — it does not stop at a compare link', async () => {
    CONFIG.pushOnApprove = 'always';
    await commitApprovalIfEnabled('/root', ['/root/specs/x/requirements.md'], 'msg');
    expect(openPullRequestMock).toHaveBeenCalledTimes(1);
    const arg = openPullRequestMock.mock.calls[0][0] as {
      head?: string;
      title?: string;
      labels?: string[];
    };
    // The PR is opened for the branch recovery actually pushed…
    expect(arg.head).toBe('approvals/spec-099-x');
    // …titled with the approval commit's subject, not a generated stand-in…
    expect(arg.title).toBe('msg');
    // …and labelled for the lane, which is what enables auto-merge. An unlabelled
    // PR is the pre-fix outcome wearing a PR's clothes: it still needs a human.
    expect(arg.labels).toEqual(['docs-lane']);
  });

  it('T3 #1653: the suffix reports the opened PR, and no bare compare toast is shown', async () => {
    CONFIG.pushOnApprove = 'always';
    const r = await commitApprovalIfEnabled('/root', ['/root/specs/x/requirements.md'], 'msg');
    expect(r.suffix).toContain('PR opened');
    expect(r.suffix).toContain('https://github.com/O/R/pull/7');
    // The pre-fix wording must be gone — it promised a click that no longer exists.
    expect(infos.join('\n')).not.toContain('Approval saved on');
  });

  it('T3 #1653: a FAILED PR-open still reports the pushed branch — never a lost approval', async () => {
    CONFIG.pushOnApprove = 'always';
    openPullRequestMock.mockResolvedValue({ outcome: 'gh-absent' });
    const r = await commitApprovalIfEnabled('/root', ['/root/specs/x/requirements.md'], 'msg');
    // Degrades to exactly the legacy surface, WITH the reason stated — the approval
    // is committed and pushed either way, so this must never read as a failure.
    expect(r.suffix).toContain('approvals/spec-099-x');
    expect(r.suffix).not.toContain('NOT committed');
    expect(infos.join('\n')).toContain('the gh CLI is not installed');
  });

  it('T3 DR-078 §4: a project-local pushOnApprove=always is honoured, so there is no prompt', async () => {
    // The VS Code setting still says `prompt`; the project-local preference says
    // `always`. Before the fix this path read the setting DIRECTLY, so the user who
    // had already answered "always push from now on" was asked again every time.
    CONFIG.pushOnApprove = 'prompt';
    vi.doMock('../src/lib/auto-bootstrap.js', () => ({
      loadPreferences: () => ({ pushOnApprove: 'always' }),
      savePreferences: vi.fn(),
    }));
    await commitApprovalIfEnabled('/root', ['/root/specs/x/requirements.md'], 'msg');
    expect(warnings).toHaveLength(0);
    expect(recoverMock).toHaveBeenCalledTimes(1);
    vi.doUnmock('../src/lib/auto-bootstrap.js');
  });

  it('T3 #1653 review: the PR body names the RECOVERY commit, not the primary checkout HEAD', async () => {
    // The blocking finding. Recovery commits in a SEPARATE worktree, so the primary
    // checkout's HEAD never moves and still points at the base tip. `openApprovalPr`
    // falling back to `resolveHeadSha(run, rootDir)` would therefore stamp the body's
    // `**Approval commit:**` line with the base branch's commit — a signpost that lies.
    CONFIG.pushOnApprove = 'always';
    await commitApprovalIfEnabled('/root', ['/root/specs/x/requirements.md'], 'msg');
    expect(bodyArgs).toHaveLength(1);
    expect(bodyArgs[0].sha).toBe('RECOVERYCOMMIT');
    expect(bodyArgs[0].sha).not.toBe('BASE_TIP_NOT_THE_APPROVAL');
    // …and the wrong-SHA probe is not even consulted when the caller knows.
    expect(resolveHeadShaMock).not.toHaveBeenCalled();
  });

  it('T3 #1653 review: an unreadable recovery SHA degrades to the probe, never to a crash', async () => {
    // `sha` is undefined when `rev-parse` fails in the ephemeral worktree. One body
    // line degrades; the approval, the push and the PR all still happen.
    CONFIG.pushOnApprove = 'always';
    recoverMock.mockResolvedValue({
      outcome: 'recovered',
      branch: 'approvals/spec-099-x',
      compareUrl: 'https://github.com/O/R/compare/approvals%2Fspec-099-x?expand=1',
      paths: ['specs/x/requirements.md'],
    });
    const r = await commitApprovalIfEnabled('/root', ['/root/specs/x/requirements.md'], 'msg');
    expect(openPullRequestMock).toHaveBeenCalledTimes(1);
    expect(r.suffix).toContain('PR opened');
  });

  it('a THROWING seam still degrades to the warning — commitApprovalIfEnabled never rejects', async () => {
    CONFIG.pushOnApprove = 'always';
    recoverMock.mockRejectedValue(new Error('boom'));
    const r = await commitApprovalIfEnabled('/root', ['/root/specs/x/requirements.md'], 'msg');
    expect(r.suffix).toContain('NOT committed');
  });
});
