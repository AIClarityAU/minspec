import { describe, it, expect, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

// init.ts is a command module, so it imports vscode at load. Only the config
// surface matters here — `conventionalDefaultBranches()` reads
// `minspec.protectedBranches`, the same setting commit-on-approve consumes.
const getConfiguration = vi.fn(() => ({
  get: (_key: string, fallback: string[]) => fallback,
}));
vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
  workspace: {
    getConfiguration: (...args: unknown[]) =>
      (getConfiguration as unknown as (...a: unknown[]) => unknown)(...args),
  },
}));

vi.mock('../src/lib/constitution-nudge', () => ({
  evaluateConstitution: vi.fn(() => ({ empty: false, message: 'm', fixHint: 'f' })),
}));

import { defaultCommitter } from '../src/commands/init';

/**
 * Real-execution coverage for `defaultCommitter` (#1054 review, skeptic finding 2).
 *
 * Every other test in this area injects a stub committer, so `branchInfo()`'s
 * origin/HEAD resolution and `add()`'s ignore filter had never actually run. That is
 * precisely how #1057 shipped an inert guard: its fixture created the `origin/HEAD`
 * ref that neither real repo had, so the test proved a path production never took.
 *
 * These drive real `git` in temp repositories and assert the observable outcome. The
 * cases are chosen to be the ones a mock CANNOT model honestly — above all "origin
 * remote configured but origin/HEAD absent", which is the state both MinSpecPro and
 * sealbox were actually in.
 */

function git(cwd: string, ...args: string[]) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0 && !args.includes('--is-inside-work-tree')) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${res.stderr}`);
  }
  return (res.stdout ?? '').trim();
}

interface RepoOpts {
  /** Branch the working repo sits on. */
  branch?: string;
  /** Configure an `origin` remote. */
  origin?: boolean;
  /** Write refs/remotes/origin/HEAD. Absent in both real repos this guard targets. */
  originHead?: string;
  /** Lines to write into .gitignore before the initial commit. */
  gitignore?: string[];
}

const made: string[] = [];

function makeRepo(opts: RepoOpts = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-committer-'));
  made.push(dir);
  const branch = opts.branch ?? 'main';
  git(dir, 'init', '--initial-branch', branch);
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  if (opts.gitignore) {
    fs.writeFileSync(path.join(dir, '.gitignore'), `${opts.gitignore.join('\n')}\n`);
  }
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'seed');
  if (opts.origin) {
    git(dir, 'remote', 'add', 'origin', 'https://example.invalid/repo.git');
  }
  if (opts.originHead) {
    // Mirror what `git clone` writes, WITHOUT contacting a remote.
    git(dir, 'update-ref', `refs/remotes/origin/${opts.originHead}`, 'HEAD');
    git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${opts.originHead}`);
  }
  return dir;
}

afterAll(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

describe('defaultCommitter.branchInfo() — real git', () => {
  it('is exercising the real implementation, not a stub (anti-vacuity)', async () => {
    const dir = makeRepo();
    const c = await defaultCommitter(dir);
    expect(await c.isRepo()).toBe(true);
    expect(typeof c.branchInfo).toBe('function');
  });

  it('resolves the default branch from origin/HEAD when it exists', async () => {
    const dir = makeRepo({ branch: 'main', origin: true, originHead: 'main' });
    const info = await (await defaultCommitter(dir)).branchInfo!();
    expect(info).toEqual({ current: 'main', default: 'main' });
  });

  it('reports a feature branch as NOT the default (nothing to warn about)', async () => {
    const dir = makeRepo({ branch: 'main', origin: true, originHead: 'main' });
    git(dir, 'checkout', '-q', '-b', 'feat/thing');
    const info = await (await defaultCommitter(dir)).branchInfo!();
    expect(info).toEqual({ current: 'feat/thing', default: 'main' });
    expect(info!.current).not.toBe(info!.default);
  });

  it('falls back to the conventional name when origin/HEAD is ABSENT — the real repos\' state', async () => {
    // No originHead: exactly the condition that made the #1057 hook guard inert.
    const dir = makeRepo({ branch: 'main', origin: true });
    expect(() => git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD')).toThrow();
    const info = await (await defaultCommitter(dir)).branchInfo!();
    expect(info).toEqual({ current: 'main', default: 'main' });
  });

  it('does not flag a local-only repo, even on a conventionally-named branch', async () => {
    // No origin remote: nothing to push to, so no branch can be push-protected.
    const dir = makeRepo({ branch: 'main', origin: false });
    expect(await (await defaultCommitter(dir)).branchInfo!()).toBeNull();
  });

  it('does not flag an unconventionally-named branch with no origin/HEAD to confirm it', async () => {
    const dir = makeRepo({ branch: 'develop', origin: true });
    expect(await (await defaultCommitter(dir)).branchInfo!()).toBeNull();
  });

  it('honours a renamed default branch via minspec.protectedBranches', async () => {
    // The reviewer's consistency point: this must read the SAME setting
    // commit-on-approve does, not a private literal list. A user whose default is
    // `develop` configures it once.
    const dir = makeRepo({ branch: 'develop', origin: true });
    getConfiguration.mockReturnValueOnce({ get: () => ['develop'] } as never);
    const info = await (await defaultCommitter(dir)).branchInfo!();
    expect(getConfiguration).toHaveBeenCalledWith('minspec');
    expect(info).toEqual({ current: 'develop', default: 'develop' });
  });

  it('returns null on a detached HEAD (no branch to strand work on)', async () => {
    const dir = makeRepo({ branch: 'main', origin: true, originHead: 'main' });
    git(dir, 'checkout', '-q', '--detach');
    expect(await (await defaultCommitter(dir)).branchInfo!()).toBeNull();
  });
});

describe('defaultCommitter.add() — real git', () => {
  it('stages a normal path', async () => {
    const dir = makeRepo();
    fs.writeFileSync(path.join(dir, 'kept.txt'), 'x\n');
    await (await defaultCommitter(dir)).add(['kept.txt']);
    expect(git(dir, 'diff', '--cached', '--name-only')).toBe('kept.txt');
  });

  it('drops a gitignored path instead of failing the whole commit', async () => {
    // `git add <explicitly-named-ignored-path>` errors, which without the filter
    // would abort the entire harness commit over one deliberately-untracked file.
    const dir = makeRepo({ gitignore: ['ignored.json'] });
    fs.writeFileSync(path.join(dir, 'ignored.json'), '{}\n');
    fs.writeFileSync(path.join(dir, 'kept.txt'), 'x\n');
    await (await defaultCommitter(dir)).add(['kept.txt', 'ignored.json']);
    const staged = git(dir, 'diff', '--cached', '--name-only').split('\n').filter(Boolean);
    expect(staged).toEqual(['kept.txt']);
  });

  it('stages nothing, and does not throw, when every path is ignored', async () => {
    const dir = makeRepo({ gitignore: ['ignored.json'] });
    fs.writeFileSync(path.join(dir, 'ignored.json'), '{}\n');
    await expect((await defaultCommitter(dir)).add(['ignored.json'])).resolves.toBeUndefined();
    expect(git(dir, 'diff', '--cached', '--name-only')).toBe('');
  });
});

describe('defaultCommitter.dirty() — real git', () => {
  it('reports only the paths that actually differ', async () => {
    const dir = makeRepo();
    fs.writeFileSync(path.join(dir, 'seed.txt'), 'changed\n');
    fs.writeFileSync(path.join(dir, 'new.txt'), 'new\n');
    const dirty = await (await defaultCommitter(dir)).dirty(['seed.txt', 'new.txt']);
    expect(new Set(dirty)).toEqual(new Set(['seed.txt', 'new.txt']));
  });

  it('reports nothing when the tree is clean', async () => {
    const dir = makeRepo();
    expect(await (await defaultCommitter(dir)).dirty(['seed.txt'])).toEqual([]);
  });
});
