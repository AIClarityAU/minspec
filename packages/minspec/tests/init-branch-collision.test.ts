/**
 * T3 regression — the harness commit offer's "Commit on a new branch" action
 * must not dead-end when its branch name is already taken (#1298).
 *
 * `harnessBranchName()` returned a CONSTANT for a RECURRING operation, and
 * `createBranch()` is a create-only `git checkout -b`. So the first refresh in
 * a repo created `chore/minspec-harness-refresh`, its PR merged, the local ref
 * survived (merged branches are not auto-deleted, and a deleted remote only
 * marks the local ref `[gone]`), and every later refresh hit:
 *
 *     MinSpec: could not create branch 'chore/minspec-harness-refresh' —
 *     fatal: a branch named 'chore/minspec-harness-refresh' already exists.
 *     Nothing was committed; the refreshed files are still in your working tree.
 *
 * Nothing checked for the existing ref, nothing disambiguated, and the catch
 * block offered no retry — so the one path that could have recovered instead
 * surfaced a terminal failure with the tree left dirty. Observed 2026-08-06 in
 * AIClarityAU/scroogellm, where the leftover branch was from PR #66.
 *
 * The fix has to hold in BOTH directions. It must find a free name when the
 * base is taken, and it must NOT suffix a repo that never collided — a
 * gratuitous suffix scatters one branch family across every project and makes
 * the ordinary case unpredictable.
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
  uniqueBranchName,
  todayStamp,
  harnessBranchName,
  REFRESH_COMMIT_MESSAGE,
  type ScaffoldCommitter,
} from '../src/commands/init';
import { scaffold, generateHarnessFiles } from '../src/lib/scaffold';

const BRANCH_ACTION = 'Commit on a new branch';
const TODAY = '2026-08-06';
const BASE = harnessBranchName(true);

interface Spy {
  committer: ScaffoldCommitter;
  added: string[][];
  commits: string[];
  branches: string[];
  probed: string[];
}

/**
 * A committer on the default branch (so the branch offer is the one shown),
 * whose `branchExists` reports every name in `taken` as already present.
 */
function makeCommitter(taken: readonly string[]): Spy {
  const added: string[][] = [];
  const commits: string[] = [];
  const branches: string[] = [];
  const probed: string[] = [];
  const takenSet = new Set(taken);
  const committer: ScaffoldCommitter = {
    isRepo: vi.fn(async () => true),
    add: vi.fn(async (paths: readonly string[]) => {
      added.push([...paths]);
    }),
    commit: vi.fn(async (message: string) => {
      commits.push(message);
    }),
    dirty: vi.fn(async (paths: readonly string[]) => [...paths]),
    branchInfo: vi.fn(async () => ({ current: 'main', default: 'main' })),
    createBranch: vi.fn(async (name: string) => {
      // Model the real create-only behaviour, so a test that picked a taken
      // name fails here rather than passing on a name git would have rejected.
      if (takenSet.has(name)) throw new Error(`fatal: a branch named '${name}' already exists`);
      takenSet.add(name);
      branches.push(name);
    }),
    branchExists: vi.fn(async (name: string) => {
      probed.push(name);
      return takenSet.has(name);
    }),
  };
  return { committer, added, commits, branches, probed };
}

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-branch-collision-')));
  scaffold(tmpDir);
  generateHarnessFiles(tmpDir);
  fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
  vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(BRANCH_ACTION as never);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('harness commit offer — a taken branch name is disambiguated, not fatal', () => {
  it('commits on a dated branch when the base name already exists', async () => {
    const { committer, branches, commits, added } = makeCommitter([BASE]);

    await offerScaffoldCommit(tmpDir, {
      makeCommitter: async () => committer,
      variant: 'refresh',
      today: TODAY,
    });

    expect(branches).toEqual([`${BASE}-${TODAY}`]);
    // Anti-vacuity: the point is that the COMMIT happened. A test asserting
    // only the branch name would pass on a build that created the branch and
    // then dropped the work on the floor — which is the defect it replaces.
    expect(commits).toEqual([REFRESH_COMMIT_MESSAGE]);
    expect(added[0]).toContain('CLAUDE.md');
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1); // the offer, not a failure
  });

  it('walks past the dated name too when a second refresh lands the same day', async () => {
    const { committer, branches, commits } = makeCommitter([BASE, `${BASE}-${TODAY}`]);

    await offerScaffoldCommit(tmpDir, {
      makeCommitter: async () => committer,
      variant: 'refresh',
      today: TODAY,
    });

    expect(branches).toEqual([`${BASE}-${TODAY}-2`]);
    expect(commits).toEqual([REFRESH_COMMIT_MESSAGE]);
  });

  it('uses the plain base name when nothing collides — no gratuitous suffix', async () => {
    const { committer, branches, commits } = makeCommitter([]);

    await offerScaffoldCommit(tmpDir, {
      makeCommitter: async () => committer,
      variant: 'refresh',
      today: TODAY,
    });

    expect(branches).toEqual([BASE]);
    expect(commits).toEqual([REFRESH_COMMIT_MESSAGE]);
  });

  it('keeps the base name for a committer that predates branchExists', async () => {
    const { committer, branches, commits } = makeCommitter([]);
    delete (committer as { branchExists?: unknown }).branchExists;

    await offerScaffoldCommit(tmpDir, {
      makeCommitter: async () => committer,
      variant: 'refresh',
      today: TODAY,
    });

    // Cannot-tell must reproduce the pre-fix behaviour exactly rather than
    // guess "taken" and suffix a repo that never needed it.
    expect(branches).toEqual([BASE]);
    expect(commits).toEqual([REFRESH_COMMIT_MESSAGE]);
  });

  it('falls back to the base name when the probe itself errors', async () => {
    const { committer, branches, commits } = makeCommitter([]);
    committer.branchExists = vi.fn(async () => {
      throw new Error('git exploded');
    });

    await offerScaffoldCommit(tmpDir, {
      makeCommitter: async () => committer,
      variant: 'refresh',
      today: TODAY,
    });

    expect(branches).toEqual([BASE]);
    expect(commits).toEqual([REFRESH_COMMIT_MESSAGE]);
  });

  it('still reports a genuine creation failure instead of committing anyway', async () => {
    const { committer, commits } = makeCommitter([]);
    committer.createBranch = vi.fn(async () => {
      throw new Error('fatal: not a git repository');
    });

    await offerScaffoldCommit(tmpDir, {
      makeCommitter: async () => committer,
      variant: 'refresh',
      today: TODAY,
    });

    expect(commits).toEqual([]);
    const warnings = vi.mocked(vscode.window.showWarningMessage).mock.calls.map((c) => String(c[0]));
    expect(warnings.some((w) => w.includes('could not create branch'))).toBe(true);
  });
});

describe('uniqueBranchName', () => {
  const takenBy = (names: readonly string[]) => async (n: string) => names.includes(n);

  it('returns the base name untouched when it is free', async () => {
    expect(await uniqueBranchName('chore/x', takenBy([]), TODAY)).toBe('chore/x');
  });

  it('probes in order: base, dated, then numbered', async () => {
    const seen: string[] = [];
    const exists = async (n: string) => {
      seen.push(n);
      return n !== `chore/x-${TODAY}-3`;
    };
    expect(await uniqueBranchName('chore/x', exists, TODAY)).toBe(`chore/x-${TODAY}-3`);
    expect(seen).toEqual([
      'chore/x',
      `chore/x-${TODAY}`,
      `chore/x-${TODAY}-2`,
      `chore/x-${TODAY}-3`,
    ]);
  });

  it('throws rather than returning a name it knows is taken', async () => {
    await expect(uniqueBranchName('chore/x', async () => true, TODAY)).rejects.toThrow(
      /already exist/,
    );
  });
});

describe('todayStamp', () => {
  it('formats as zero-padded YYYY-MM-DD', () => {
    expect(todayStamp(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(todayStamp(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});
