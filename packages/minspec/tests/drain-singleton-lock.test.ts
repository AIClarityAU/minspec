/**
 * #2241 — the drain's singleton lock: atomic acquisition, never unlinked.
 *
 * Observed 2026-09-30: two `drain-inbox.sh --auto` loops ran at once, both keyed to the
 * same session. The old lock was a check-then-write PID file:
 *   1. read $LOCK, decide nobody live holds it
 *   2. (only then) write our own PID into $LOCK
 *   3. on exit, `rm -f "$LOCK"` UNCONDITIONALLY — no check that the file still named us
 *
 * Step 1→2 is a read-then-write race: two launches inside that window can both pass the
 * "not held" read and each overwrite the other's PID, so both proceed while the file on
 * disk names only one. Step 3 compounds it: an unrelated driver's shutdown can delete a
 * DIFFERENT, still-live driver's lock file, and a later launch then finds no lock at all.
 * The hypothesis in #2241 is exactly that sequence: one driver's exit trap deleted a
 * second driver's lock, and a third then started unguarded.
 *
 * The fix (scripts/drain-inbox.sh, the singleton-lock block near the bottom, plus
 * lock_still_ours) replaces this with an flock(2)-based lock: acquisition is one atomic
 * kernel call, the lock lives on a file descriptor held for the holder's whole lifetime
 * (released automatically on ANY exit, trap or none), and the lock file is never
 * unlinked. These tests drive the REAL script — a stubbed `gh` and dispatcher, not a
 * reimplementation of the locking algorithm — so a regression in the shipped shell would
 * fail these even if a from-scratch model of "how flock should work" would not.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'scripts')) && fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('repo root not found from ' + __dirname);
}
const DRAIN = path.join(findRepoRoot(), 'scripts', 'drain-inbox.sh');
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

interface Harness { dir: string; bin: string; lock: string; quota: string; flight: string }

function makeHarness(issues: number[], dispatchBody: string): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-lock-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(dir, 'root'), { recursive: true });
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env bash
for a in "$@"; do [[ "$a" == "inbox" ]] && exit 0; done
if [[ "$1" == "issue" && "$2" == "list" ]]; then printf '${issues.join('\\n')}\\n'; exit 0; fi
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'dispatch.sh'), dispatchBody.replace(/__DIR__/g, dir), { mode: 0o755 });
  const quota = path.join(dir, 'quota.json');
  // Fresh, well-under-the-bar — the gate fails CLOSED on missing/stale (#1775), so a
  // real, current, low-usage reading is required to get a deterministic admit.
  fs.writeFileSync(quota, JSON.stringify({
    used_percentage: 1,
    resets_at: Math.floor(Date.now() / 1000) + 3600,
    observed_at: Math.floor(Date.now() / 1000),
  }));
  return { dir, bin, lock: path.join(dir, 'lock'), quota, flight: path.join(dir, 'flight') };
}

function baseEnv(h: Harness, logName: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${h.bin}:${process.env.PATH}`,
    MINSPEC_DRAIN_DISPATCH: path.join(h.bin, 'dispatch.sh'),
    MINSPEC_DRAIN_RUN_DIR: '',
    MINSPEC_DRAIN_REMEDIATE_PRS: '0',
    MINSPEC_DRAIN_PRIMARY_ROOT: path.join(h.dir, 'root'),
    MINSPEC_DRAIN_LOG: path.join(h.dir, `log.${logName}`),
    MINSPEC_DRAIN_LOCK: h.lock,
    MINSPEC_QUOTA_FILE: h.quota,
  };
}

/** Spawn `drain-inbox.sh --once`, resolving with its FOREGROUND stdout once it exits
 *  (the foreground forks the long-lived cycle into a disowned background process and
 *  returns almost immediately — this does not wait for that background work). */
function launchOnce(h: Harness, logName: string): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [DRAIN, '--once'], { env: baseEnv(h, logName) });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', () => resolve({ stdout: out }));
  });
}

const cleanupDirs: string[] = [];
afterEach(() => {
  while (cleanupDirs.length) {
    const d = cleanupDirs.pop()!;
    fs.rmSync(d, { recursive: true, force: true });
  }
});

const SLOW_STUB = `#!/usr/bin/env bash
echo "start $1 $(date +%s%N)" >> "__DIR__/flight"
sleep 0.6
echo "end $1 $(date +%s%N)" >> "__DIR__/flight"
echo "dispatched $1"
`;

describe('#2241 singleton lock — atomic acquisition (no read-then-write race)', () => {
  it('two --once launches racing for the same lock: exactly one runs, the other is refused', async () => {
    const h = makeHarness([901, 902], SLOW_STUB);
    cleanupDirs.push(h.dir);

    const [r1, r2] = await Promise.all([launchOnce(h, 'a'), launchOnce(h, 'b')]);

    const results = [r1, r2];
    const refused = results.filter((r) => /already running/i.test(r.stdout));
    const winners = results.filter((r) => /in background \(PID (\d+)/i.test(r.stdout));

    // Exactly one side of the race wins and one is refused — never both, never neither.
    // (Both-win would reproduce #2241's double-dispatch; both-refused would mean the
    // lock was never acquired at all.)
    expect(refused).toHaveLength(1);
    expect(winners).toHaveLength(1);

    const pidMatch = winners[0].stdout.match(/PID (\d+)/);
    expect(pidMatch).not.toBeNull();
    const winnerPid = Number(pidMatch![1]);

    // Wait for the winning background loop to finish its one cycle.
    const deadline = Date.now() + 15000;
    while (alive(winnerPid) && Date.now() < deadline) await pause(50);
    expect(alive(winnerPid), 'the winning background drain should have finished').toBe(false);

    // The loser never forked a background process at all, so it dispatched nothing —
    // each issue was started exactly once (never the double-dispatch #2241 warns about).
    const flight = fs.existsSync(h.flight) ? fs.readFileSync(h.flight, 'utf-8') : '';
    const starts901 = flight.split('\n').filter((l) => l.startsWith('start 901 ')).length;
    const starts902 = flight.split('\n').filter((l) => l.startsWith('start 902 ')).length;
    expect(starts901).toBe(1);
    expect(starts902).toBe(1);
  }, 30000);

  it('the lock file is never removed when the drain exits cleanly (no unconditional rm)', async () => {
    const h = makeHarness([901], SLOW_STUB);
    cleanupDirs.push(h.dir);

    const r = await launchOnce(h, 'solo');
    const pidMatch = r.stdout.match(/PID (\d+)/);
    expect(pidMatch).not.toBeNull();
    const pid = Number(pidMatch![1]);

    const deadline = Date.now() + 15000;
    while (alive(pid) && Date.now() < deadline) await pause(50);
    expect(alive(pid)).toBe(false);

    // #2241's exit trap did `rm -f "$LOCK"` unconditionally. flock locks the file's
    // INODE, not its path — unlinking the path is what let an unrelated process's
    // clean exit erase a DIFFERENT, still-live holder's lock. The fix never unlinks,
    // so the path (and a diagnostic PID inside it) survives the holder's own exit.
    expect(fs.existsSync(h.lock), 'the lock file must survive a clean exit').toBe(true);
    const content = fs.readFileSync(h.lock, 'utf-8').trim();
    expect(content).toMatch(/^\d+$/);
  }, 30000);
});

describe('#2241 — lock_still_ours self-check (defense in depth)', () => {
  it('a continuous loop stops itself, loudly, if $LOCK is removed out from under it', async () => {
    const h = makeHarness([901], `#!/usr/bin/env bash\necho "dispatched $1"\n`);
    cleanupDirs.push(h.dir);
    const log = path.join(h.dir, 'log.continuous');
    const session = spawn('sleep', ['300'], { stdio: 'ignore' });

    const env: NodeJS.ProcessEnv = {
      ...baseEnv(h, 'unused'),
      MINSPEC_DRAIN_LOG: log,
      MINSPEC_DRAIN_POLL: '1',
      MINSPEC_DRAIN_INTERVAL: '2',
      MINSPEC_SESSION_PID: String(session.pid),
    };

    const startOut = await new Promise<string>((resolve, reject) => {
      const child = spawn('bash', [DRAIN, '--continuous'], { env });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      child.on('error', reject);
      child.on('close', () => resolve(out));
    });
    const pidMatch = startOut.match(/PID (\d+)/);
    expect(pidMatch).not.toBeNull();
    const drainPid = Number(pidMatch![1]);

    const readLog = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf-8') : '');

    // Wait for the first cycle to complete, proving the loop is genuinely running
    // (holding the lock) before we pull the rug.
    let deadline = Date.now() + 15000;
    while (!readLog().includes('cycle done') && Date.now() < deadline) await pause(100);
    expect(readLog()).toContain('cycle done');

    // Simulate the #2241 scenario: something else removes the lock path while this
    // loop still (uselessly, post-removal) holds its flock on the old inode.
    fs.rmSync(h.lock, { force: true });

    // The loop must notice at the top of its next iteration and stop loudly, rather
    // than keep dispatching believing it is still the sole holder.
    deadline = Date.now() + 15000;
    while (!readLog().includes('loop exited') && Date.now() < deadline) await pause(100);
    const finalLog = readLog();
    expect(finalLog).toMatch(/singleton lock.*no longer names this process/);
    expect(finalLog).toContain('loop exited');

    // And the process itself is actually gone, not just log-complaining while alive.
    deadline = Date.now() + 10000;
    while (alive(drainPid) && Date.now() < deadline) await pause(50);
    expect(alive(drainPid)).toBe(false);

    session.kill();
  }, 40000);
});
