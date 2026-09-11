/**
 * #1114 — pre-commit author identity gate.
 *
 * GitHub links a commit to an account by matching the commit's AUTHOR EMAIL against
 * that account's verified addresses. An 87-commit run authored under an email that was
 * never verified anywhere rendered every cross-reference those commits made as "ghost
 * mentioned this" in issue timelines — a cosmetic-looking symptom of an identity
 * misconfiguration nothing in the harness checked for (a container session's ambient
 * `user.email` shadowing the account's real one).
 *
 * The fix is an OPT-IN gate: when a project configures `minspec.allowedCommitEmails`,
 * the hook refuses a commit whose author email (the one git will actually RECORD) is
 * not in that list. Unconfigured (the default for every project this template scaffolds
 * into), the gate is a total no-op — asserting an identity the harness cannot know in
 * advance would itself violate the blast-radius invariant (constitution invariant 3).
 *
 * "The one git will actually record" is the point of the #1778 review fix. The first
 * version read `git config user.email`, which is only a proxy: git resolves the author
 * with its own precedence (GIT_AUTHOR_EMAIL, which `git commit --author` sets, then
 * author.email, then user.email, then EMAIL), so every one of those produced a commit
 * under an address the gate never looked at.
 *
 * These tests drive a REAL `git commit` against a REAL temp repository with the actual
 * rendered hook installed — a source-text assertion on the template string would pass
 * against a hook that never runs, which is exactly the vacuous-green class the sibling
 * protected-branch-guard suite (pre-commit-protected-branch.test.ts) was written to avoid.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync, spawnSync } from 'child_process';

import { MANAGED_REGION_TEMPLATES, MINSPEC_HOOKS_DIR, renderManagedFile } from '../src/lib/template-registry';
import { useShellTimeout } from './helpers/shell-timeout';

// #1285: spawns real child processes per assertion — 5s default is a load metric,
// not a hang signal. Enforced by shell-timeout-coverage.test.ts.
useShellTimeout();

const PRE_COMMIT = `${MINSPEC_HOOKS_DIR}/pre-commit`;
const template = () => MANAGED_REGION_TEMPLATES.find((t) => t.outputPath === PRE_COMMIT)!;

/**
 * Every variable git consults before, or instead of, `user.email` when it decides who a
 * commit's author is. Because the gate reads the identity git will RECORD, a shell or CI
 * runner that exports GIT_AUTHOR_EMAIL or EMAIL would otherwise decide every result in
 * this file. A test that needs one sets it explicitly.
 */
const AMBIENT_IDENTITY = [
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_AUTHOR_DATE',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  'GIT_COMMITTER_DATE',
  'EMAIL',
];

/**
 * Env with ambient MinSpec bypasses and ambient git identity stripped, and the global and
 * system git config shut out; a test opts into any of them explicitly. Shutting out the
 * config does for a machine-wide `user.email` / `author.email` what the stripping does for
 * the environment, and it keeps a global `core.hooksPath` from sending git to some other
 * hook, which would let every "ALLOWS" assertion here pass without the hook under test
 * ever running.
 */
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const base = { ...process.env };
  delete base.MINSPEC_GATE_OFF;
  delete base.EMAIL_GATE_OFF;
  for (const k of AMBIENT_IDENTITY) delete base[k];
  base.GIT_CONFIG_GLOBAL = '/dev/null';
  base.GIT_CONFIG_NOSYSTEM = '1';
  return { ...base, ...extra };
}

function git(dir: string, args: string[], env?: NodeJS.ProcessEnv): void {
  execFileSync('git', args, { cwd: dir, stdio: 'pipe', env: env ?? cleanEnv() });
}

function gitOut(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, stdio: 'pipe', encoding: 'utf8', env: cleanEnv() }).trim();
}

interface Result {
  code: number;
  stderr: string;
}

interface Repo {
  dir: string;
  /**
   * Stage a change and attempt a commit with `git config user.email` set to `userEmail`
   * (`null` leaves it unset). That is the CONFIG value only: the author git records can
   * differ when `env` or `commitArgs` override it (GIT_AUTHOR_EMAIL, EMAIL, `--author`),
   * which is exactly what the override tests below exercise. Returns exit code + stderr.
   */
  commit(message: string, userEmail: string | null, env?: Record<string, string>, commitArgs?: string[]): Result;
  /**
   * Run the installed hook directly, outside `git commit`. Only for states `git commit`
   * refuses to start in (an unresolvable identity, an unreadable config), which a tool or
   * a person re-running the hook can still reach.
   */
  runHook(env?: Record<string, string>): Result;
  head(): string;
  /** The author email git actually recorded on HEAD. */
  headAuthorEmail(): string;
  cleanup(): void;
}

/**
 * A temp repo with the rendered pre-commit hook installed and NO remote at all, so the
 * unrelated protected-branch guard (Stage 0) can never fire here — nothing to push to
 * means nothing can be push-protected — and this suite exercises the identity gate
 * (Stage 1) in isolation.
 */
function makeRepo(): Repo {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-identity-gate-')));

  git(dir, ['init', '-b', 'main', '-q']);
  git(dir, ['config', 'user.email', 'seed@example.com']);
  git(dir, ['config', 'user.name', 'Seed']);
  git(dir, ['config', 'commit.gpgsign', 'false']);

  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
  git(dir, ['add', 'seed.txt']);
  git(dir, ['commit', '-q', '-m', 'seed', '--no-verify']);

  const hookPath = path.join(dir, '.git', 'hooks', 'pre-commit');
  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  fs.writeFileSync(hookPath, renderManagedFile(template()));
  fs.chmodSync(hookPath, 0o755);

  let n = 0;
  return {
    dir,
    commit(message, userEmail, extraEnv = {}, commitArgs = []) {
      const file = `change-${++n}.txt`;
      fs.writeFileSync(path.join(dir, file), `${message}\n`);
      const env = cleanEnv({ ...extraEnv });
      if (userEmail === null) {
        try {
          git(dir, ['config', '--unset-all', 'user.email'], env);
        } catch (e: unknown) {
          // Exit 5 is "no such key": already the unset state the caller asked for.
          if ((e as { status?: number }).status !== 5) throw e;
        }
      } else {
        git(dir, ['config', 'user.email', userEmail], env);
      }
      git(dir, ['add', file], env);
      try {
        execFileSync('git', ['commit', '-m', message, ...commitArgs], { cwd: dir, stdio: 'pipe', env });
        return { code: 0, stderr: '' };
      } catch (e: unknown) {
        const err = e as { status?: number; stderr?: Buffer };
        return { code: err.status ?? 1, stderr: String(err.stderr ?? '') };
      }
    },
    runHook(extraEnv = {}) {
      const r = spawnSync('sh', [hookPath], { cwd: dir, encoding: 'utf8', env: cleanEnv(extraEnv) });
      // A hook that never ran must not read as a refusal: both of these would otherwise
      // surface as a non-zero "code" and pass every refusal assertion below vacuously.
      if (r.error) throw r.error;
      if (r.status === null) throw new Error(`pre-commit hook killed by ${r.signal}`);
      return { code: r.status, stderr: r.stderr };
    },
    head() {
      return gitOut(dir, ['rev-parse', 'HEAD']);
    },
    headAuthorEmail() {
      return gitOut(dir, ['log', '-1', '--format=%ae']);
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function withRepo(fn: (r: Repo) => void): void {
  const repo = makeRepo();
  try {
    fn(repo);
  } finally {
    repo.cleanup();
  }
}

describe('pre-commit author identity gate — off by default', () => {
  it('ALLOWS any author email when minspec.allowedCommitEmails is unconfigured', () => {
    withRepo((repo) => {
      const r = repo.commit('unconfigured project', 'whoever@example.invalid');
      expect(r.code).toBe(0);
    });
  });

  it('stays a total no-op when unconfigured, even where no author identity can be resolved', () => {
    // The fail-closed branch below must be scoped to projects that opted in: an
    // unconfigured repo is never refused by this gate, whatever state git is in.
    withRepo((repo) => {
      git(repo.dir, ['config', '--unset-all', 'user.email']);
      git(repo.dir, ['config', 'user.useConfigOnly', 'true']);
      expect(() => gitOut(repo.dir, ['var', 'GIT_AUTHOR_IDENT'])).toThrow();
      expect(repo.runHook().code).toBe(0);
    });
  });
});

describe('pre-commit author identity gate — enforces a configured allowlist', () => {
  it('ALLOWS a commit whose user.email is in the allowlist', () => {
    withRepo((repo) => {
      git(repo.dir, ['config', 'minspec.allowedCommitEmails', 'linked@example.com']);
      const r = repo.commit('linked identity', 'linked@example.com');
      expect(r.code).toBe(0);
    });
  });

  it('BLOCKS a commit whose user.email is NOT in the allowlist', () => {
    withRepo((repo) => {
      git(repo.dir, ['config', 'minspec.allowedCommitEmails', 'linked@example.com']);
      const r = repo.commit('unlinked identity', 'ambient@example.com');
      expect(r.code).not.toBe(0);
      expect(r.stderr).toMatch(/ghost/i);
      expect(r.stderr).toContain('ambient@example.com');
      expect(r.stderr).toContain('git config user.email');
    });
  });

  it('leaves the commit UNMADE — the branch tip must not move on refusal', () => {
    withRepo((repo) => {
      git(repo.dir, ['config', 'minspec.allowedCommitEmails', 'linked@example.com']);
      const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
      repo.commit('unlinked identity', 'ambient@example.com');
      const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
      expect(after).toBe(before);
    });
  });

  it('honours a SPACE-SEPARATED allowlist of more than one address', () => {
    withRepo((repo) => {
      git(repo.dir, ['config', 'minspec.allowedCommitEmails', 'first@example.com second@example.com']);
      expect(repo.commit('second of two', 'second@example.com').code).toBe(0);
      expect(repo.commit('unrelated third', 'third@example.com').code).not.toBe(0);
    });
  });

  it('names the offending email and the full configured allowlist in the refusal', () => {
    withRepo((repo) => {
      git(repo.dir, ['config', 'minspec.allowedCommitEmails', 'a@example.com b@example.com']);
      const r = repo.commit('bad identity', 'c@example.com');
      expect(r.stderr).toContain('c@example.com');
      expect(r.stderr).toContain('a@example.com');
      expect(r.stderr).toContain('b@example.com');
    });
  });
});

/**
 * #1778 review (HIGH). Each override that outranks `user.email` is exercised in BOTH
 * directions: it must be able to put an unlisted address past an allowed `user.email`
 * (the bypass), and it must be able to put an allowed address past an unlisted one (the
 * converse). A hook that simply refused more often could pass the first half of each pair
 * and never the second; only a hook that reads the recorded author passes both.
 */
describe('pre-commit author identity gate — checks the author git will RECORD, not the user.email proxy', () => {
  it('BLOCKS when GIT_AUTHOR_EMAIL overrides an allowed user.email', () => {
    withRepo((repo) => {
      git(repo.dir, ['config', 'minspec.allowedCommitEmails', 'linked@example.com']);
      const before = repo.head();
      const r = repo.commit('env override', 'linked@example.com', { GIT_AUTHOR_EMAIL: 'ambient@example.com' });
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain('ambient@example.com');
      // The config is already right, so the refusal must name the override rather than
      // tell the user to fix a user.email that is not the problem.
      expect(r.stderr).toContain('GIT_AUTHOR_EMAIL');
      expect(repo.head()).toBe(before);
    });
  });

  it('ALLOWS when GIT_AUTHOR_EMAIL supplies an allowed address over an unlisted user.email', () => {
    withRepo((repo) => {
      git(repo.dir, ['config', 'minspec.allowedCommitEmails', 'linked@example.com']);
      const r = repo.commit('env supplies the linked address', 'ambient@example.com', {
        GIT_AUTHOR_EMAIL: 'linked@example.com',
      });
      expect(r.code).toBe(0);
      expect(repo.headAuthorEmail()).toBe('linked@example.com');
    });
  });

  it('BLOCKS `git commit --author` naming an unlisted address over an allowed user.email', () => {
    // Measured before this was written, not assumed: git (2.54 here) exports the
    // --author identity into the hook's environment as GIT_AUTHOR_EMAIL before
    // pre-commit runs, and `git var GIT_AUTHOR_IDENT` inside the hook reports it.
    withRepo((repo) => {
      git(repo.dir, ['config', 'minspec.allowedCommitEmails', 'linked@example.com']);
      const before = repo.head();
      const r = repo.commit('author flag override', 'linked@example.com', {}, ['--author=Someone <bad@example.com>']);
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain('bad@example.com');
      expect(r.stderr).toContain('--author');
      expect(repo.head()).toBe(before);
    });
  });

  it('ALLOWS `git commit --author` naming an allowed address over an unlisted user.email', () => {
    withRepo((repo) => {
      git(repo.dir, ['config', 'minspec.allowedCommitEmails', 'linked@example.com']);
      const r = repo.commit('author flag supplies the linked address', 'ambient@example.com', {}, [
        '--author=Linked <linked@example.com>',
      ]);
      expect(r.code).toBe(0);
      expect(repo.headAuthorEmail()).toBe('linked@example.com');
    });
  });

  it('BLOCKS when author.email overrides an allowed user.email', () => {
    // author.email outranks user.email for the author (not the committer) identity.
    withRepo((repo) => {
      git(repo.dir, ['config', 'minspec.allowedCommitEmails', 'linked@example.com']);
      git(repo.dir, ['config', 'author.email', 'ambient@example.com']);
      const r = repo.commit('author.email override', 'linked@example.com');
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain('ambient@example.com');
      expect(r.stderr).toContain('git config author.email');
    });
  });

  it('follows the EMAIL fallback git uses when no author.email or user.email is configured', () => {
    withRepo((repo) => {
      git(repo.dir, ['config', 'minspec.allowedCommitEmails', 'linked@example.com']);
      expect(repo.commit('EMAIL fallback, linked', null, { EMAIL: 'linked@example.com' }).code).toBe(0);
      expect(repo.headAuthorEmail()).toBe('linked@example.com');
      const r = repo.commit('EMAIL fallback, unlisted', null, { EMAIL: 'ambient@example.com' });
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain('ambient@example.com');
    });
  });
});

describe('pre-commit author identity gate — reads the allowlist exactly as configured', () => {
  it('honours every value of a MULTI-VALUED allowlist (git config --add), not only the last', () => {
    // `git config --get` on a multi-valued key returns only the LAST value (measured on
    // git 2.54: exit 0, last value), so a --get read allowed the second address below
    // and refused the first. Both orders are asserted for that reason.
    withRepo((repo) => {
      git(repo.dir, ['config', '--add', 'minspec.allowedCommitEmails', 'first@example.com']);
      git(repo.dir, ['config', '--add', 'minspec.allowedCommitEmails', 'second@example.com']);
      expect(repo.commit('second of two', 'second@example.com').code).toBe(0);
      expect(repo.commit('first of two', 'first@example.com').code).toBe(0);
      const r = repo.commit('unrelated third', 'third@example.com');
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain('first@example.com');
      expect(r.stderr).toContain('second@example.com');
    });
  });

  it('compares entries LITERALLY: a glob character is not a pattern, even when a file matches it', () => {
    // An unquoted `for x in $list` also pathname-expands every entry against the hook's
    // working directory, which git sets to the repository root. `*@example.com` then
    // became the name of any file matching it, so a stray file named like an address
    // admitted that address. The file exists to make the expansion observable: with no
    // matching file the unquoted loop leaves the pattern literal, and this test could
    // not tell a fixed hook from an unfixed one.
    withRepo((repo) => {
      git(repo.dir, ['config', 'minspec.allowedCommitEmails', '*@example.com']);
      fs.writeFileSync(path.join(repo.dir, 'anyone@example.com'), '');
      const r = repo.commit('glob entry', 'anyone@example.com');
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain('*@example.com');
    });
  });
});

describe('pre-commit author identity gate — fails CLOSED when it cannot see (invariant 2)', () => {
  // `git commit` itself exits 128 in both states below before any hook runs (measured),
  // so they are driven through runHook, the other way the hook is reached.

  it('REFUSES when the author identity cannot be resolved, rather than passing', () => {
    withRepo((repo) => {
      git(repo.dir, ['config', 'minspec.allowedCommitEmails', 'linked@example.com']);
      git(repo.dir, ['config', '--unset-all', 'user.email']);
      git(repo.dir, ['config', 'user.useConfigOnly', 'true']);
      // Control: git itself cannot name an author here.
      expect(() => gitOut(repo.dir, ['var', 'GIT_AUTHOR_IDENT'])).toThrow();
      const r = repo.runHook();
      expect(r.code).not.toBe(0);
      expect(r.stderr).toMatch(/cannot determine the author/i);
    });
  });

  it('REFUSES when the allowlist cannot be read, rather than reading it as "not configured"', () => {
    withRepo((repo) => {
      git(repo.dir, ['config', 'minspec.allowedCommitEmails', 'linked@example.com']);
      git(repo.dir, ['config', 'user.email', 'linked@example.com']);
      // Control: the same hook with a readable config passes, so the unreadable config
      // below is the only variable.
      expect(repo.runHook().code).toBe(0);

      const unreadable = path.join(repo.dir, '.git', 'unparseable.gitconfig');
      fs.writeFileSync(unreadable, '[broken\n');
      const r = repo.runHook({ GIT_CONFIG_GLOBAL: unreadable });
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain('minspec.allowedCommitEmails');
    });
  });
});

describe('pre-commit author identity gate — documented escape hatch', () => {
  it('honours EMAIL_GATE_OFF=1 even against a configured, mismatched allowlist', () => {
    withRepo((repo) => {
      git(repo.dir, ['config', 'minspec.allowedCommitEmails', 'linked@example.com']);
      const r = repo.commit('bypassed', 'ambient@example.com', { EMAIL_GATE_OFF: '1' });
      expect(r.code).toBe(0);
    });
  });

  it('the existing whole-gate MINSPEC_GATE_OFF=1 bypass also covers this gate', () => {
    withRepo((repo) => {
      git(repo.dir, ['config', 'minspec.allowedCommitEmails', 'linked@example.com']);
      const r = repo.commit('bypassed via whole gate', 'ambient@example.com', { MINSPEC_GATE_OFF: '1' });
      expect(r.code).toBe(0);
    });
  });
});
