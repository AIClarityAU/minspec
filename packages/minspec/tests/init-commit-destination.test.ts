/**
 * T3 regression — the harness commit offer must not deposit a commit on the
 * push-protected default branch, and must not leave its own manifests behind.
 *
 * Two defects, one user-visible loop. On every VS Code reload the refresh
 * write-path ran and offered a commit; accepting staged the scaffolded paths
 * and committed them on whatever branch HEAD happened to be — with no check
 * that the branch could accept a commit at all. On a repo whose `main` is
 * ruleset-gated on pull-request-only checks that produces a commit which can
 * NEVER be pushed, and the extension reported success. The failure only
 * surfaced later at `git push`, by which point the work was in branch history
 * and needed branch surgery to recover.
 *
 * Compounding it, SCAFFOLD_PATHSPECS omitted `.minspec/generated-hashes.json`
 * and `.minspec/template-baseline.json` — the manifests that DESCRIBE the files
 * being committed and are rewritten by the same refresh. Every refresh commit
 * was therefore partial by construction, leaving the manifests dirty, so the
 * user hand-committed the remainder each time. Observed three times across two
 * repos: the harness commit, then a leftover "dregs" commit, both stranded.
 *
 * The guard has to be precise in both directions. It must stop the unpushable
 * commit, and it must not touch the ordinary case — a feature branch, or a repo
 * whose default branch genuinely accepts direct commits. An offer that blocks
 * legitimate work gets dismissed, and a dismissed offer protects nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
}));

vi.mock('../src/lib/constitution-nudge', () => ({
  evaluateConstitution: vi.fn(() => ({ empty: false, message: 'm', fixHint: 'f' })),
}));

import * as vscode from 'vscode';
import {
  offerScaffoldCommit,
  collectScaffoldPaths,
  REFRESH_COMMIT_MESSAGE,
  harnessBranchName,
  type ScaffoldCommitter,
} from '../src/commands/init';
import { scaffold, generateHarnessFiles } from '../src/lib/scaffold';

const BRANCH_ACTION = 'Commit on a new branch';
const ANYWAY_ACTION = 'Commit here anyway';

interface Spy {
  committer: ScaffoldCommitter;
  added: string[][];
  commits: string[];
  branches: string[];
}

/**
 * `branch` null models a committer that cannot determine the destination
 * (detached HEAD, no origin/HEAD, or an older stub with no branchInfo).
 */
function makeCommitter(branch: { current: string; default: string } | null): Spy {
  const added: string[][] = [];
  const commits: string[] = [];
  const branches: string[] = [];
  const committer: ScaffoldCommitter = {
    isRepo: vi.fn(async () => true),
    add: vi.fn(async (paths: readonly string[]) => {
      added.push([...paths]);
    }),
    commit: vi.fn(async (message: string) => {
      commits.push(message);
    }),
    dirty: vi.fn(async (paths: readonly string[]) => [...paths]),
    branchInfo: vi.fn(async () => branch),
    createBranch: vi.fn(async (name: string) => {
      branches.push(name);
    }),
  };
  return { committer, added, commits, branches };
}

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-commit-dest-')));
  scaffold(tmpDir);
  generateHarnessFiles(tmpDir);
  fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('harness commit offer — refuses to strand a commit on the default branch', () => {
  it('does NOT commit straight onto the default branch', async () => {
    const { committer, commits } = makeCommitter({ current: 'main', default: 'main' });
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined as never);

    await offerScaffoldCommit(tmpDir, { makeCommitter: async () => committer, variant: 'refresh' });

    // Dismissed → nothing written. Critically, the plain "Commit them" offer
    // must never have been the thing shown on a protected branch.
    expect(commits).toEqual([]);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
  });

  it('warns naming the branch, and offers a branch instead of a bare commit', async () => {
    const { committer } = makeCommitter({ current: 'main', default: 'main' });
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined as never);

    await offerScaffoldCommit(tmpDir, { makeCommitter: async () => committer, variant: 'refresh' });

    const call = vi.mocked(vscode.window.showWarningMessage).mock.calls[0];
    expect(call[0] as string).toContain("'main'");
    expect(call.slice(1)).toContain(BRANCH_ACTION);
  });

  it('creates a branch and commits THERE when the branch action is taken', async () => {
    const { committer, commits, branches } = makeCommitter({ current: 'main', default: 'main' });
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(BRANCH_ACTION as never);

    await offerScaffoldCommit(tmpDir, { makeCommitter: async () => committer, variant: 'refresh' });

    expect(branches).toEqual([harnessBranchName(true)]);
    expect(commits).toEqual([REFRESH_COMMIT_MESSAGE]);
  });

  it('commits nothing when the branch cannot be created — never falls back to main', async () => {
    const { committer, commits } = makeCommitter({ current: 'main', default: 'main' });
    committer.createBranch = vi.fn(async () => {
      throw new Error('branch exists');
    });
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(BRANCH_ACTION as never);

    await offerScaffoldCommit(tmpDir, { makeCommitter: async () => committer, variant: 'refresh' });

    // Falling back to committing on main here would recreate the exact bug.
    expect(commits).toEqual([]);
  });

  it('still commits on the default branch if the user explicitly insists', async () => {
    // Not every project protects its default branch; the escape hatch must work.
    const { committer, commits } = makeCommitter({ current: 'main', default: 'main' });
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(ANYWAY_ACTION as never);

    await offerScaffoldCommit(tmpDir, { makeCommitter: async () => committer, variant: 'refresh' });

    expect(commits).toEqual([REFRESH_COMMIT_MESSAGE]);
  });
});

describe('harness commit offer — untouched for every ordinary case', () => {
  it('uses the plain info offer on a feature branch', async () => {
    const { committer, commits } = makeCommitter({ current: 'fix/thing', default: 'main' });
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Commit them' as never);

    await offerScaffoldCommit(tmpDir, { makeCommitter: async () => committer, variant: 'refresh' });

    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(commits).toEqual([REFRESH_COMMIT_MESSAGE]);
  });

  it('FAILS OPEN when the destination is unknown', async () => {
    const { committer, commits } = makeCommitter(null);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Commit them' as never);

    await offerScaffoldCommit(tmpDir, { makeCommitter: async () => committer, variant: 'refresh' });

    expect(commits).toEqual([REFRESH_COMMIT_MESSAGE]);
  });

  it('FAILS OPEN for a committer that predates branchInfo entirely', async () => {
    const { committer, commits } = makeCommitter(null);
    delete (committer as { branchInfo?: unknown }).branchInfo;
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Commit them' as never);

    await offerScaffoldCommit(tmpDir, { makeCommitter: async () => committer, variant: 'refresh' });

    expect(commits).toEqual([REFRESH_COMMIT_MESSAGE]);
  });

  it('does not treat a branch merely NAMED like the default as the default', async () => {
    const { committer, commits } = makeCommitter({ current: 'feat/main-menu', default: 'main' });
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Commit them' as never);

    await offerScaffoldCommit(tmpDir, { makeCommitter: async () => committer, variant: 'refresh' });

    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(commits).toEqual([REFRESH_COMMIT_MESSAGE]);
  });
});

describe('harness commit offer — commits its own manifests, not a partial set', () => {
  it('includes the refresh manifests in the staged set', () => {
    // These describe the very files being committed and are rewritten by the
    // same refresh. Excluding them is what left a dirty tree behind every time.
    fs.mkdirSync(path.join(tmpDir, '.minspec'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.minspec', 'generated-hashes.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, '.minspec', 'template-baseline.json'), '{}');

    const paths = collectScaffoldPaths(tmpDir);

    expect(paths).toContain('.minspec/generated-hashes.json');
    expect(paths).toContain('.minspec/template-baseline.json');
  });

  it('stages the manifests as part of the accepted commit', async () => {
    fs.mkdirSync(path.join(tmpDir, '.minspec'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.minspec', 'generated-hashes.json'), '{}');

    const { committer, added } = makeCommitter({ current: 'fix/thing', default: 'main' });
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Commit them' as never);

    await offerScaffoldCommit(tmpDir, { makeCommitter: async () => committer, variant: 'refresh' });

    expect(added[0]).toContain('.minspec/generated-hashes.json');
  });

  it('omits a manifest that is not present on disk', () => {
    // collectScaffoldPaths stays existence-filtered: a project without a given
    // manifest must not have git asked to stage a path that isn't there.
    // (generateHarnessFiles writes both manifests, so remove one to model a
    // project that does not carry it.)
    const baseline = path.join(tmpDir, '.minspec', 'template-baseline.json');
    expect(fs.existsSync(baseline)).toBe(true);
    fs.rmSync(baseline);

    const paths = collectScaffoldPaths(tmpDir);

    expect(paths).not.toContain('.minspec/template-baseline.json');
    expect(paths).toContain('.minspec/generated-hashes.json');
  });
});
