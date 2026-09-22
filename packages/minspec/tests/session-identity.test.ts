/**
 * T2 — the identity line at session start (#1816).
 *
 * A session launched on the host holds every founder credential, so a bare `gh` or
 * `git push` there acts as the founder; three agent writes were recorded under the
 * founder's account that way. session-identity.sh says where the session runs, and
 * how old the last full identity check is, every time a session starts.
 *
 * Executed, not grepped. Each case runs the real unit with HOME pointed at a fixture
 * whose ~/.claude/scripts/identity-boundary-check.sh is a stub, so no case reads a
 * real credential, the real /proc environments, or the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync, spawnSync } from 'child_process';

// Module level, not in a hook: vi.setConfig() inside beforeAll is inert.
vi.setConfig({ testTimeout: 30_000 });

const REPO = path.resolve(__dirname, '../../..');
const HOOK = path.join(REPO, 'scripts', 'hooks', 'session-start.sh');
const UNIT = path.join(REPO, 'scripts', 'hooks', 'session-identity.sh');
const HOSTNAME = fs.readFileSync('/proc/sys/kernel/hostname', 'utf-8').trim();

const PASS = 'PASS — no GitHub user credential reachable (7 path(s) checked)';
let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'session-identity-'));
});
afterEach(async () => {
  // The unit leaves a full check running in the background by design. Deleting the
  // fixture under it raced that run (ENOTEMPTY, 1 run in 12). "No run in flight" alone
  // was not enough — it is also true in the moment BEFORE the run starts (2 in 12) — so
  // wait until nothing holds the unit's lock and no run is in flight, for a full second.
  await settle();
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

interface Stub {
  locRc: number;
  locLine?: string;
  locSleep?: number;
  verdict?: string;
  fullSleep?: number;
}
function stub(s: Stub): void {
  const dir = path.join(home, '.claude', 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'identity-boundary-check.sh'),
    [
      '#!/usr/bin/env bash',
      'if [ "${1:-}" = --location ]; then',
      `  sleep ${s.locSleep ?? 0}`,
      `  echo '${s.locLine ?? 'IDENTITY-LOCATION [container (stub)]'}'; exit ${s.locRc}`,
      'fi',
      `echo start >> '${home}/full-runs'`,
      `sleep ${s.fullSleep ?? 0}`,
      "echo '[clean]   stub'",
      `echo 'IDENTITY-BOUNDARY [container (stub)]: ${s.verdict ?? PASS}'`,
      `echo done >> '${home}/full-runs'`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
}
const lastFile = (): string => path.join(home, '.cache', 'identity-boundary', `${HOSTNAME}.last`);
function seedLast(verdict: string, ageSeconds = 0): void {
  fs.mkdirSync(path.dirname(lastFile()), { recursive: true });
  fs.writeFileSync(lastFile(), `[clean]   seeded\nIDENTITY-BOUNDARY [container (stub)]: ${verdict}\n`);
  const t = Date.now() / 1000 - ageSeconds;
  fs.utimesSync(lastFile(), t, t);
}
const runLines = (kind: 'start' | 'done'): number => {
  const f = path.join(home, 'full-runs');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8').split('\n').filter((l) => l === kind).length : 0;
};
const fullRuns = (): number => runLines('start');
function lockFree(): boolean {
  const lock = path.join(home, '.cache', 'identity-boundary', `${HOSTNAME}.lock`);
  return !fs.existsSync(lock) || spawnSync('flock', ['-n', lock, 'true']).status === 0;
}
async function settle(): Promise<void> {
  let quietSince = 0;
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    if (!(lockFree() && runLines('start') === runLines('done'))) quietSince = 0;
    else if (!quietSince) quietSince = Date.now();
    else if (Date.now() - quietSince >= 1_000) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

function run(): { out: string; ms: number } {
  const t0 = Date.now();
  // A throw here (non-zero exit) fails the case: the unit must never be fatal.
  const out = execFileSync('bash', [UNIT], {
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home },
    timeout: 20_000,
  });
  return { out, ms: Date.now() - t0 };
}
async function waitFor(pred: () => boolean, ms = 10_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return pred();
}

describe('session-identity — where the session runs', () => {
  it('says so in one line when the check is not installed', () => {
    const { out } = run();
    expect(out).toContain('check not installed');
    expect(out.trim().split('\n')).toHaveLength(1);
  });

  it('on the HOST, warns that gh and git push act as the founder, and says what to do', () => {
    stub({ locRc: 1, locLine: 'IDENTITY-LOCATION [HOST (k7, pid1=systemd)]' });
    const { out } = run();
    expect(out).toContain('running on the HOST (k7, pid1=systemd), not in the claude-agent');
    expect(out).toContain('acts as the FOUNDER');
    expect(out).toContain('gh-app-token.sh');
    expect(out).toContain('relaunch this panel inside the');
  });

  it('control characters in the location never reach the terminal', () => {
    stub({ locRc: 1, locLine: 'IDENTITY-LOCATION [HOST (k7[31m)]' });
    const { out } = run();
    expect(out).toContain('running on the HOST (k7[31m)');
    expect(out).not.toContain('');
  });

  it('an undetermined location is treated as the host', () => {
    stub({ locRc: 2, locLine: 'IDENTITY-LOCATION [UNDETERMINED (x)]' });
    expect(run().out).toContain('treat it as the HOST');
  });

  it('a check that crashes never wedges a session start', () => {
    stub({ locRc: 99, locLine: 'garbage' });
    expect(run().out).toContain('could not establish');
  });

  it('a check that hangs is cut off, and read as undetermined', () => {
    stub({ locRc: 0, locSleep: 30 });
    const { out, ms } = run();
    expect(out).toContain('exit 124');
    expect(ms).toBeLessThan(12_000);
  });
});

describe('session-identity — the last full check, with its age', () => {
  it('with no result yet, says one is running, and the background run records a verdict', async () => {
    stub({ locRc: 0 });
    expect(run().out).toContain('no full check has completed here yet');
    expect(await waitFor(() => fs.existsSync(lastFile()))).toBe(true);
    expect(fs.readFileSync(lastFile(), 'utf-8')).toContain(`IDENTITY-BOUNDARY [container (stub)]: ${PASS}`);
  });

  it('returns before the background check finishes — it never holds the session start', async () => {
    // If the background run inherited the hook's stdout, execFileSync would wait for it.
    stub({ locRc: 0, fullSleep: 6 });
    const { ms } = run();
    expect(ms).toBeLessThan(4_000);
    expect(await waitFor(() => fs.existsSync(lastFile()), 15_000)).toBe(true);
  });

  it('a fresh PASS is one line with its age, and starts no new run', async () => {
    stub({ locRc: 0 });
    seedLast(PASS, 120);
    const { out } = run();
    expect(out.trim()).toBe('🔑 Identity: container · last full check 2m ago: PASS — no GitHub user credential reachable');
    await new Promise((r) => setTimeout(r, 1_000));
    expect(fullRuns()).toBe(0);
  });

  it('a FAIL recorded inside the container is loud', () => {
    stub({ locRc: 0 });
    seedLast('FAIL — 1 path(s) yield a GitHub USER credential', 60);
    const { out } = run();
    expect(out).toContain('FAILED inside the container');
    expect(out).toContain('tell the human before any GitHub write');
  });

  it('an old result says STALE and starts a new run', async () => {
    stub({ locRc: 0 });
    seedLast(PASS, 3 * 86_400);
    expect(run().out).toContain('STALE: the background check has not completed for 3d');
    expect(await waitFor(() => fullRuns() === 1)).toBe(true);
  });

  it('the age reads in days from the moment it is stale', () => {
    stub({ locRc: 0 });
    seedLast(PASS, 86_400 + 60);
    expect(run().out).toContain('has not completed for 1d');
  });

  it('a record with no verdict is unknown — neither PASS nor FAILED — and is re-run', async () => {
    stub({ locRc: 0 });
    fs.mkdirSync(path.dirname(lastFile()), { recursive: true });
    fs.writeFileSync(lastFile(), '[clean]   a record that lost its verdict line\n');
    const { out } = run();
    expect(out).toContain('has no verdict');
    expect(out).not.toContain('FAILED');
    expect(out).not.toContain('PASS');
    expect(await waitFor(() => fullRuns() === 1)).toBe(true);
  });

  it('runs one full check at a time, however many sessions start together', async () => {
    stub({ locRc: 0, fullSleep: 3 });
    run();
    run();
    run();
    expect(await waitFor(() => fs.existsSync(lastFile()), 15_000)).toBe(true);
    await new Promise((r) => setTimeout(r, 500));
    expect(fullRuns()).toBe(1);
  });
});

describe('session-start hook wiring', () => {
  it('session-start delegates to the unit, so the executed path is the wired one', () => {
    const hook = fs.readFileSync(HOOK, 'utf-8');
    expect(hook).toContain('session-identity.sh');
    expect(hook).toMatch(/session-identity\.sh[^\n]*\|\| true/);
  });
});
