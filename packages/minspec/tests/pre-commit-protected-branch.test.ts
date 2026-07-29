/**
 * T3 regression — the pre-commit gate must refuse a commit on the push-protected
 * default branch.
 *
 * Root cause this locks: `git commit` on `main` succeeds locally, but `main` on
 * these repos is ruleset-gated on PR-only status checks (`ai-review`,
 * `ready-to-merge`, ...). A commit that lands on local `main` can therefore NEVER
 * be pushed — the rejection surfaces only at `git push`, long after the work is
 * sealed into branch history, and recovering it needs branch surgery. The DR-037
 * pre-commit hook validated commit CONTENT (secrets, spec frontmatter) but never
 * the DESTINATION BRANCH, so the bad state was trivially creatable and was caught
 * only by the remote. It stranded work twice in two repos inside a day.
 *
 * These tests drive a real `git commit` against a real temp repository rather than
 * asserting on the rendered hook text. A source-text assertion would pass against
 * a hook that never runs, which is exactly the vacuous-green this bug hid behind.
 *
 * The guard must be precise in BOTH directions — it has to block the authored
 * commit on the default branch AND stay out of the way of every legitimate commit
 * (feature branches, conflict resolution mid-merge, detached HEAD, an unknown
 * default branch, and the explicit bypasses). A gate that over-blocks gets
 * disabled, and a disabled gate is the same as no gate.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';

import { MANAGED_REGION_TEMPLATES, MINSPEC_HOOKS_DIR, renderManagedFile } from '../src/lib/template-registry';

const PRE_COMMIT = `${MINSPEC_HOOKS_DIR}/pre-commit`;
const template = () => MANAGED_REGION_TEMPLATES.find((t) => t.outputPath === PRE_COMMIT)!;

/** Env with ambient MinSpec bypasses stripped — a test opts into a bypass explicitly. */
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const base = { ...process.env };
  delete base.MINSPEC_GATE_OFF;
  delete base.MINSPEC_ALLOW_MAIN;
  return { ...base, ...extra };
}

function git(dir: string, args: string[], env?: NodeJS.ProcessEnv): void {
  execFileSync('git', args, { cwd: dir, stdio: 'pipe', env: env ?? cleanEnv() });
}

interface Repo {
  dir: string;
  /** Stage a change and attempt a commit. Returns the exit code and stderr. */
  commit(message: string, env?: Record<string, string>): { code: number; stderr: string };
  cleanup(): void;
}

/**
 * A temp repo with the rendered pre-commit hook installed.
 *
 * `defaultBranch` seeds `refs/remotes/origin/HEAD`, which is how the guard learns
 * the default branch OFFLINE — those refs are written by `git clone` / `git remote
 * set-head`, so reading them costs no network call (Tier-0 invariant). Passing
 * null leaves origin/HEAD unset, modelling a repo with no remote.
 */
function makeRepo(
  opts: { defaultBranch?: string | null; initialBranch?: string; remote?: boolean } = {},
): Repo {
  const initialBranch = opts.initialBranch ?? 'main';
  const defaultBranch = opts.defaultBranch === undefined ? initialBranch : opts.defaultBranch;
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-branch-guard-')));

  git(dir, ['init', '-b', initialBranch, '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  // A remote URL WITHOUT origin/HEAD is the real-world shape that made the
  // guard inert: both repos it was written for look exactly like this. Opting
  // out models a purely local repo, where no branch can be push-protected.
  if (opts.remote !== false) {
    git(dir, ['config', 'remote.origin.url', 'https://example.invalid/repo.git']);
  }

  // Seed history without the hook installed, so setup can never be blocked by it.
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
  git(dir, ['add', 'seed.txt']);
  git(dir, ['commit', '-q', '-m', 'seed', '--no-verify']);

  if (defaultBranch !== null) {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    git(dir, ['update-ref', `refs/remotes/origin/${defaultBranch}`, head]);
    git(dir, ['symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${defaultBranch}`]);
  }

  const hookPath = path.join(dir, '.git', 'hooks', 'pre-commit');
  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  fs.writeFileSync(hookPath, renderManagedFile(template()));
  fs.chmodSync(hookPath, 0o755);

  let n = 0;
  return {
    dir,
    commit(message, extraEnv = {}) {
      const file = `change-${++n}.txt`;
      fs.writeFileSync(path.join(dir, file), `${message}\n`);
      const env = cleanEnv(extraEnv);
      git(dir, ['add', file], env);
      try {
        execFileSync('git', ['commit', '-m', message], { cwd: dir, stdio: 'pipe', env });
        return { code: 0, stderr: '' };
      } catch (e: unknown) {
        const err = e as { status?: number; stderr?: Buffer };
        return { code: err.status ?? 1, stderr: String(err.stderr ?? '') };
      }
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function withRepo(opts: Parameters<typeof makeRepo>[0], fn: (r: Repo) => void): void {
  const repo = makeRepo(opts);
  try {
    fn(repo);
  } finally {
    repo.cleanup();
  }
}

describe('pre-commit protected-branch guard — blocks the unpushable commit', () => {
  it('BLOCKS an authored commit on the default branch', () => {
    withRepo({}, (repo) => {
      const r = repo.commit('harness refresh');
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain('main');
    });
  });

  it('names the branch and tells the user how to move the work', () => {
    withRepo({}, (repo) => {
      const { stderr } = repo.commit('harness refresh');
      // An actionable gate, not just a refusal: the recovery command must be present,
      // otherwise the user's fastest route out is to disable the hook.
      expect(stderr).toContain('git switch -c');
    });
  });

  it('leaves the commit UNMADE — the branch tip must not move', () => {
    withRepo({}, (repo) => {
      const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
      repo.commit('harness refresh');
      const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
      expect(after).toBe(before);
    });
  });

  it('guards whatever the default branch is called, not a hardcoded "main"', () => {
    withRepo({ initialBranch: 'trunk', defaultBranch: 'trunk' }, (repo) => {
      const r = repo.commit('on trunk');
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain('trunk');
    });
  });

  it('does NOT block a branch whose name merely contains the default branch name', () => {
    withRepo({}, (repo) => {
      git(repo.dir, ['switch', '-q', '-c', 'feat/main-menu']);
      expect(repo.commit('not actually main').code).toBe(0);
    });
  });
});

describe('pre-commit protected-branch guard — stays out of the way otherwise', () => {
  it('ALLOWS a commit on a feature branch', () => {
    withRepo({}, (repo) => {
      git(repo.dir, ['switch', '-q', '-c', 'fix/thing']);
      expect(repo.commit('real work').code).toBe(0);
    });
  });

  it('ALLOWS conflict resolution mid-merge on the default branch', () => {
    withRepo({}, (repo) => {
      // A merge commit is not authored work being stranded — it is how a branch
      // legitimately lands. Blocking it would break the normal merge path.
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
      fs.writeFileSync(path.join(repo.dir, '.git', 'MERGE_HEAD'), `${head}\n`);
      expect(repo.commit('merge branch').code).toBe(0);
    });
  });

  it('ALLOWS a commit mid-cherry-pick on the default branch', () => {
    withRepo({}, (repo) => {
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
      fs.writeFileSync(path.join(repo.dir, '.git', 'CHERRY_PICK_HEAD'), `${head}\n`);
      expect(repo.commit('cherry-pick').code).toBe(0);
    });
  });

  it('ALLOWS a commit on detached HEAD', () => {
    withRepo({}, (repo) => {
      git(repo.dir, ['checkout', '-q', '--detach']);
      expect(repo.commit('detached work').code).toBe(0);
    });
  });

  it('FAILS OPEN on an unconventional branch name with no origin/HEAD', () => {
    // Never-wrong rule: a repo the guard cannot reason about must not be bricked.
    withRepo({ defaultBranch: null, initialBranch: 'delivery' }, (repo) => {
      expect(repo.commit('no remote here').code).toBe(0);
    });
  });
});

describe('pre-commit protected-branch guard — must not go inert without origin/HEAD', () => {
  // The regression that shipped: origin/HEAD is NOT populated in every clone —
  // it was absent in BOTH repos this guard was written for, so the guard hit its
  // fail-open path and protected nothing. The original fixture always created
  // the ref, which encoded the assumption instead of testing it. These cases
  // model the real repos.

  it.each(['main', 'master', 'trunk'])(
    'still BLOCKS on conventional default branch %s with no origin/HEAD',
    (branch) => {
      withRepo({ defaultBranch: null, initialBranch: branch }, (repo) => {
        const r = repo.commit('would have been stranded');
        expect(r.code).not.toBe(0);
        expect(r.stderr).toContain(branch);
      });
    },
  );

  it('leaves the branch tip unmoved in the no-origin/HEAD case', () => {
    withRepo({ defaultBranch: null }, (repo) => {
      const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
      repo.commit('would have been stranded');
      const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
      expect(after).toBe(before);
    });
  });

  it('honours minspec.protectedBranches for a non-conventional default name', () => {
    withRepo({ defaultBranch: null, initialBranch: 'delivery' }, (repo) => {
      git(repo.dir, ['config', 'minspec.protectedBranches', 'delivery release']);
      expect(repo.commit('on a custom protected branch').code).not.toBe(0);
    });
  });

  it('a configured list REPLACES the defaults rather than adding to them', () => {
    // Opting a project into custom names must be able to opt `main` out.
    withRepo({ defaultBranch: null, initialBranch: 'main' }, (repo) => {
      git(repo.dir, ['config', 'minspec.protectedBranches', 'delivery']);
      expect(repo.commit('main is not protected here').code).toBe(0);
    });
  });

  it('ALLOWS committing on main in a repo with no remote at all', () => {
    // Nothing to push to means nothing can be push-protected. Scratch repos,
    // fixtures and local-only projects must stay completely unaffected —
    // blocking them would be pure over-reach and get the gate switched off.
    withRepo({ defaultBranch: null, remote: false }, (repo) => {
      expect(repo.commit('local-only repo').code).toBe(0);
    });
  });

  it('still prefers origin/HEAD when it IS set, over the name list', () => {
    // A repo whose default branch is `delivery` must be guarded on `delivery`
    // and left alone on `main`, regardless of conventional naming.
    withRepo({ initialBranch: 'delivery', defaultBranch: 'delivery' }, (repo) => {
      expect(repo.commit('on the real default').code).not.toBe(0);
    });
  });
});

describe('pre-commit protected-branch guard — the .githooks twin must not drift', () => {
  // This repo sets core.hooksPath=.githooks, so the GENERATED hook never runs
  // here and the repo shipping the guard would otherwise be the one repo without
  // it. That makes a second copy necessary — and two copies of the same logic
  // drift silently, so the decisive lines are pinned in both.
  const repoRoot = path.resolve(__dirname, '../../..');
  const githook = path.join(repoRoot, '.githooks', 'pre-commit');

  const DECISIVE = [
    'minspec_branch_guard()',
    'MINSPEC_ALLOW_MAIN',
    'minspec.allowCommitOnDefaultBranch',
    'MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD',
    'rebase-merge',
    'rebase-apply',
    'refs/remotes/origin/HEAD',
    'git switch -c',
  ];

  it.each(DECISIVE)('both the template and .githooks/pre-commit carry: %s', (line) => {
    expect(renderManagedFile(template())).toContain(line);
    expect(fs.readFileSync(githook, 'utf8')).toContain(line);
  });

  it('is not preceded by any whole-hook `exit 0` that could skip it', () => {
    // Originally this asserted the guard sat above ADR_BORN_GATE_OFF, which was a
    // whole-hook `exit 0` set routinely for merge commits. #1043 scoped every
    // bypass to its own block, so that specific ordering no longer matters — but
    // the invariant behind it still does: any unconditional or flag-guarded
    // top-level `exit 0` above the guard would disable it wholesale. Pin that
    // directly rather than keeping an assertion whose stated reason is obsolete.
    const src = fs.readFileSync(githook, 'utf8');
    const guardAt = src.indexOf('minspec_branch_guard()');
    expect(guardAt).toBeGreaterThan(-1);
    const preceding = src.slice(0, guardAt).split('\n');
    const offenders = preceding.filter((line) => /^\s*(\[[^\]]*\]\s*&&\s*)?exit\s+0\s*$/.test(line));
    expect(offenders).toEqual([]);
  });

  it('BLOCKS a real commit on the default branch when run as the live hook', () => {
    withRepo({}, (repo) => {
      fs.copyFileSync(githook, path.join(repo.dir, '.git', 'hooks', 'pre-commit'));
      fs.chmodSync(path.join(repo.dir, '.git', 'hooks', 'pre-commit'), 0o755);
      const r = repo.commit('via .githooks');
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain('git switch -c');
    });
  });

  it('is NOT disabled by ADR_BORN_GATE_OFF=1', () => {
    withRepo({}, (repo) => {
      fs.copyFileSync(githook, path.join(repo.dir, '.git', 'hooks', 'pre-commit'));
      fs.chmodSync(path.join(repo.dir, '.git', 'hooks', 'pre-commit'), 0o755);
      const r = repo.commit('merge-ish', { ADR_BORN_GATE_OFF: '1' });
      expect(r.code).not.toBe(0);
    });
  });
});

describe('pre-commit protected-branch guard — documented escape hatches', () => {
  it('honours the one-shot MINSPEC_ALLOW_MAIN=1 bypass', () => {
    withRepo({}, (repo) => {
      expect(repo.commit('deliberate', { MINSPEC_ALLOW_MAIN: '1' }).code).toBe(0);
    });
  });

  it('honours the per-repo minspec.allowCommitOnDefaultBranch opt-out', () => {
    withRepo({}, (repo) => {
      git(repo.dir, ['config', 'minspec.allowCommitOnDefaultBranch', 'true']);
      expect(repo.commit('opted out').code).toBe(0);
    });
  });

  it('honours the existing whole-gate MINSPEC_GATE_OFF=1 bypass', () => {
    withRepo({}, (repo) => {
      expect(repo.commit('gate off', { MINSPEC_GATE_OFF: '1' }).code).toBe(0);
    });
  });
});
