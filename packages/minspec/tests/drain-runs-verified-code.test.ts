/**
 * #3747 — the drain must run the code that was verified, and say so truthfully.
 *
 * Behaviour, against real temp repos (an origin, a primary checkout held BEHIND it, and the
 * drain's run-dir worktree), with the real scripts/ tree copied in:
 *
 *   1. The "current" line covers the whole scripts/ tree the drain executes from, not only
 *      drain-inbox.sh: a stale lib it sources makes it say STALE (review finding 5).
 *   2. A drain executing FROM the run dir never resets that run dir under itself when
 *      origin/main moves; it ends instead, and the next refresh (done by drain-service.sh
 *      while no drain runs from it) moves it (review finding 4).
 *   3. drain-service.sh launches the run-dir copy, with the primary root pinned, and falls
 *      back to the in-place drain when the override is set or self-refresh is off.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';
import { drainBaseEnv, useHostileAmbientDrainKnobs } from './helpers/drain-env';

useShellTimeout();
useHostileAmbientDrainKnobs();

const SCRIPTS = path.resolve(__dirname, '../../../scripts');
const LIB = 'scripts/lib/agent-worktree.sh';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commitAll(cwd: string, msg: string): string {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', msg);
  git(cwd, 'push', '-q', 'origin', 'main');
  return git(cwd, 'rev-parse', 'HEAD');
}

interface Fixture {
  root: string;
  seed: string;
  primary: string;
  run: string;
  c1: string;
  c2: string;
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    const lock = path.join(root, 'drain.lock');
    if (fs.existsSync(lock)) {
      const pid = Number(fs.readFileSync(lock, 'utf-8'));
      if (pid > 0) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }
    try {
      execFileSync('git', ['-C', path.join(root, 'primary'), 'worktree', 'remove', '--force', path.join(root, 'run')], {
        stdio: 'ignore',
      });
    } catch {
      /* no run dir registered */
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * origin/main at C2, `primary` checked out at C1 (behind). C1 is the real scripts/ tree
 * with `atC1` applied; C2 then applies `atC2` on top.
 */
function fixture(atC1: (seed: string) => void, atC2: (seed: string) => void): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-verified-'));
  roots.push(root);
  const origin = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  const primary = path.join(root, 'primary');
  fs.mkdirSync(origin);
  git(origin, 'init', '-q', '--bare', '-b', 'main');
  git(root, 'clone', '-q', origin, seed);
  git(seed, 'checkout', '-q', '-B', 'main');
  fs.cpSync(SCRIPTS, path.join(seed, 'scripts'), {
    recursive: true,
    filter: (src) => !/(^|\/)(node_modules|__pycache__)(\/|$)/.test(src),
  });
  atC1(seed);
  const c1 = commitAll(seed, 'c1');
  git(root, 'clone', '-q', origin, primary);
  atC2(seed);
  const c2 = commitAll(seed, 'c2');
  expect(c2).not.toBe(c1);
  return { root, seed, primary, run: path.join(root, 'run'), c1, c2 };
}

function appendTo(file: string, text: string): void {
  fs.appendFileSync(file, text);
}

function refresh(script: string, env: NodeJS.ProcessEnv) {
  const r = spawnSync('bash', [script, '--refresh-run-dir'], {
    encoding: 'utf-8',
    env: { ...drainBaseEnv(), ...env },
  });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '', last: (r.stdout ?? '').trim().split('\n').pop() };
}

describe('the "current" line covers the whole executing scripts/ tree (#3747 finding 5)', () => {
  it('a primary behind main only in a SOURCED lib says STALE, never "current"; in sync it says current', () => {
    // C1 carries an extra line in a lib drain-inbox.sh sources; C2 removes it. drain-inbox.sh
    // itself is byte-identical at C1 and C2, so a check of that one file alone says "current".
    const original = fs.readFileSync(path.join(SCRIPTS, 'lib/agent-worktree.sh'), 'utf-8');
    const f = fixture(
      (seed) => appendTo(path.join(seed, LIB), '# stale-at-c1\n'),
      (seed) => fs.writeFileSync(path.join(seed, LIB), original),
    );
    const drain = path.join(f.primary, 'scripts/drain-inbox.sh');

    const behind = refresh(drain, { MINSPEC_DRAIN_RUN_DIR: f.run });
    expect(behind.code).toBe(0);
    expect(behind.last).toBe(f.c2); // the run dir itself is verified at origin/main
    expect(git(f.primary, 'rev-parse', 'HEAD')).toBe(f.c1); // rule #8: primary untouched
    expect(behind.err).toContain('[drain] STALE: run dir verified at origin/main');
    expect(behind.out).not.toContain('pipeline scripts are current');

    git(f.primary, 'merge', '-q', '--ff-only', 'origin/main');
    const inSync = refresh(drain, { MINSPEC_DRAIN_RUN_DIR: f.run });
    expect(inSync.out).toContain('pipeline scripts are current');
    expect(inSync.err).not.toContain('STALE');
  });
});

describe('a drain executing from the run dir never refreshes it under itself (#3747 finding 4)', () => {
  it('origin/main moves: the run dir is left byte-for-byte as it was and the drain asks to be restarted', () => {
    const f = fixture(
      () => undefined,
      (seed) => appendTo(path.join(seed, LIB), '# c2\n'),
    );
    const primaryDrain = path.join(f.primary, 'scripts/drain-inbox.sh');
    const runDrain = path.join(f.run, 'scripts/drain-inbox.sh');

    // The service's step: refresh from the primary (nothing runs from the run dir yet).
    expect(refresh(primaryDrain, { MINSPEC_DRAIN_RUN_DIR: f.run }).last).toBe(f.c2);

    // From the run dir, at origin/main: verified, and its own tree is current.
    const env = { MINSPEC_DRAIN_RUN_DIR: f.run, MINSPEC_DRAIN_PRIMARY_ROOT: f.primary };
    const atMain = refresh(runDrain, env);
    expect(atMain.out).toContain('pipeline scripts are current');
    expect(atMain.err).not.toContain('STALE');

    // main moves on to C3 while that drain is running.
    appendTo(path.join(f.seed, LIB), '# c3\n');
    const c3 = commitAll(f.seed, 'c3');
    const libBefore = fs.readFileSync(path.join(f.run, LIB), 'utf-8');

    const moved = refresh(runDrain, env);
    expect(moved.code).toBe(0);
    expect(moved.out).toContain('not refreshing it under the running script');
    expect(git(f.run, 'rev-parse', 'HEAD')).toBe(f.c2);
    expect(fs.readFileSync(path.join(f.run, LIB), 'utf-8')).toBe(libBefore);
    expect(moved.out).not.toContain('pipeline scripts are current');

    // The service's next refresh (from the primary, between drains) does move it.
    expect(refresh(primaryDrain, { MINSPEC_DRAIN_RUN_DIR: f.run }).last).toBe(c3);
    expect(fs.readFileSync(path.join(f.run, LIB), 'utf-8')).toContain('# c3');
  });

  it('the loop ends on that signal before the next cycle, so the supervisor restarts it', () => {
    // Driving --continuous needs the quota gate, gh and the dispatch fan-out; the wiring is
    // asserted on the source, the decision itself by the behaviour test above.
    const src = fs.readFileSync(path.join(SCRIPTS, 'drain-inbox.sh'), 'utf-8');
    const cycle = src.slice(src.indexOf('\nrun_cycle() {'));
    const refreshAt = cycle.indexOf('  ensure_fresh_run_dir\n');
    expect(refreshAt).toBeGreaterThan(0);
    expect(cycle.slice(refreshAt, refreshAt + 200)).toMatch(/if \$RUN_DIR_RESTART; then[\s\S]*return 0/);
    const loop = src.slice(src.indexOf('\nrun_loop() {'));
    const body = loop.slice(0, loop.indexOf('\n}\n'));
    const after = body.slice(body.indexOf('run_cycle || rc=$?'));
    expect(after.slice(0, 300)).toMatch(/if \$RUN_DIR_RESTART; then[\s\S]*break/);
  });
});

/** A drain stand-in: records how it was started, then runs a 1 s "loop" holding the lock. */
function stub(label: string, realNextToIt: boolean): string {
  return `#!/usr/bin/env bash
if [[ "$1" == --continuous ]]; then
  echo "${label} $* root=\${MINSPEC_DRAIN_PRIMARY_ROOT-unset}" >> "$STUB_CALLS"
  (
    echo "$BASHPID" > "$MINSPEC_DRAIN_LOCK"
    sleep 1
    echo "[drain] loop exited."
    rm -f "$MINSPEC_DRAIN_LOCK"
  ) >>"$MINSPEC_DRAIN_LOG" 2>&1 &
  disown
  exit 0
fi
${realNextToIt ? 'exec bash "$(dirname "$0")/drain-inbox-real.sh" "$@"' : 'exit 1'}
`;
}

describe('drain-service.sh launches the verified run-dir copy (#3747)', () => {
  // The primary's drain-inbox.sh delegates every seam (--refresh-run-dir, --paused) to the
  // real script and records a --continuous launch as "primary"; origin/main's
  // drain-inbox.sh records it as "run". Which one the service starts is then observable.
  function serviceFixture(): Fixture {
    return fixture(
      (seed) => {
        fs.renameSync(path.join(seed, 'scripts/drain-inbox.sh'), path.join(seed, 'scripts/drain-inbox-real.sh'));
        fs.writeFileSync(path.join(seed, 'scripts/drain-inbox.sh'), stub('primary', true), { mode: 0o755 });
      },
      (seed) => fs.writeFileSync(path.join(seed, 'scripts/drain-inbox.sh'), stub('run', false), { mode: 0o755 }),
    );
  }

  function runService(f: Fixture, extra: NodeJS.ProcessEnv) {
    const file = (n: string) => path.join(f.root, n);
    fs.writeFileSync(file('comm'), 'docker-init\n');
    const svc = path.join(f.primary, 'scripts/drain-service/drain-service.sh');
    const r = spawnSync('bash', ['-c', 'source "$1"; PID1_COMM="$2"; cmd_run', 'harness', svc, file('comm')], {
      encoding: 'utf-8',
      timeout: 60_000,
      env: {
        ...drainBaseEnv(),
        HOME: f.root,
        MINSPEC_DRAIN_LOCK: file('drain.lock'),
        MINSPEC_DRAIN_LOG: file('drain.log'),
        MINSPEC_DRAIN_PAUSE_FILE: file('pause'),
        MINSPEC_DRAIN_SERVICE_LOCK: file('svc.lock'),
        MINSPEC_DRAIN_SERVICE_POLL: '1',
        MINSPEC_DRAIN_SERVICE_RETRY_BASE: '1',
        MINSPEC_DRAIN_SERVICE_RETRY_MAX: '1',
        MINSPEC_DRAIN_RUN_DIR: f.run,
        STUB_CALLS: file('calls'),
        ...extra,
      },
    });
    const calls = fs.existsSync(file('calls'))
      ? fs.readFileSync(file('calls'), 'utf-8').split('\n').filter(Boolean)
      : [];
    return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? ''), calls };
  }

  it('from a behind primary, it refreshes the run dir and starts ITS drain-inbox.sh with the primary pinned', () => {
    const f = serviceFixture();
    const res = runService(f, {});
    expect(res.code).toBe(0);
    expect(res.calls).toEqual([`run --continuous root=${f.primary}`]);
    expect(res.out).toContain(`starting the drain: ${f.run}/scripts/drain-inbox.sh --continuous`);
    expect(git(f.run, 'rev-parse', 'HEAD')).toBe(f.c2);
    expect(git(f.primary, 'rev-parse', 'HEAD')).toBe(f.c1);
  });

  it('an explicit MINSPEC_DRAIN_SERVICE_DRAIN override runs in place', () => {
    const f = serviceFixture();
    const res = runService(f, { MINSPEC_DRAIN_SERVICE_DRAIN: path.join(f.primary, 'scripts/drain-inbox.sh') });
    expect(res.code).toBe(0);
    expect(res.calls).toEqual([`primary --continuous root=${f.primary}`]);
  });

  it('self-refresh off (unverifiable run dir) runs in place', () => {
    const f = serviceFixture();
    const res = runService(f, { MINSPEC_DRAIN_SELF_REFRESH: '0' });
    expect(res.code).toBe(0);
    expect(res.calls).toEqual([`primary --continuous root=${f.primary}`]);
  });
});
