/**
 * T0 invariant tests for the durable drain owner (#3011): `scripts/drain-service/`.
 *
 * A host user unit (Restart=always) keeps drain-service.sh running inside the agent
 * container, and drain-service.sh keeps scripts/drain-inbox.sh running. Four rules make
 * that safe, and each is asserted here against behaviour, with a stub drain standing in
 * for the real one:
 *
 *   1. The drain never runs on the host (pid 1 must be docker-init, else exit 78 and the
 *      unit does not restart).
 *   2. At most one drain: a live lock holder is adopted, never joined by a second, and a
 *      second supervisor exits 75.
 *   3. Pause survives restart: with the marker present a fresh supervisor starts nothing.
 *   4. A failure is visible: the drain's own last lines reach the journal and the exit
 *      code is non-zero.
 *
 * drain-service.sh reads pid 1's name from a path no environment variable can move. The
 * tests source the script and set that shell variable to a fixture, which is the only
 * way to reach the run path on a CI runner whose pid 1 is not docker-init.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';
import { drainBaseEnv, useHostileAmbientDrainKnobs } from './helpers/drain-env';

useShellTimeout();
useHostileAmbientDrainKnobs();

const REPO = path.resolve(__dirname, '../../..');
const SVC = path.join(REPO, 'scripts/drain-service/drain-service.sh');
const UNIT = path.join(REPO, 'scripts/drain-service/minspec-drain.service');
const DRAIN_INBOX = path.join(REPO, 'scripts/drain-inbox.sh');

const STUB = `#!/usr/bin/env bash
echo "$*" >> "$STUB_CALLS"
case "$1" in
  --paused) [[ -e "$STUB_PAUSE" ]] && exit 0; exit 1 ;;
  --continuous)
    (
      echo "$BASHPID" > "$MINSPEC_DRAIN_LOCK"
      trap 'echo "[drain] stopping on SIGTERM"; rm -f "$MINSPEC_DRAIN_LOCK"; exit 143' TERM
      sleep "\${STUB_LIFE:-1}" & wait $!
      echo "\${STUB_END:-[drain] loop exited.}"
      rm -f "$MINSPEC_DRAIN_LOCK"
    ) >>"$MINSPEC_DRAIN_LOG" 2>&1 &
    disown
    exit "\${STUB_RC:-0}" ;;
esac
exit 0
`;

let dir: string;
let env: NodeJS.ProcessEnv;
const children: ChildProcess[] = [];

function file(name: string): string {
  return path.join(dir, name);
}

/** Run `cmd_run` from the SOURCED script, with pid 1's name read from a fixture. */
function runArgs(pid1: string): string[] {
  fs.writeFileSync(file('comm'), `${pid1}\n`);
  return ['-c', 'source "$1"; PID1_COMM="$2"; cmd_run', 'harness', SVC, file('comm')];
}

function runSync(pid1: string) {
  return spawnSync('bash', runArgs(pid1), { env, encoding: 'utf-8', timeout: 20_000 });
}

function runBackground(pid1: string): { proc: ChildProcess; out: () => string; done: Promise<number | null> } {
  const proc = spawn('bash', runArgs(pid1), { env });
  children.push(proc);
  let buf = '';
  proc.stdout!.on('data', (d) => (buf += d));
  proc.stderr!.on('data', (d) => (buf += d));
  const done = new Promise<number | null>((resolve) => proc.on('exit', (code) => resolve(code)));
  return { proc, out: () => buf, done };
}

function calls(): string[] {
  return fs.existsSync(file('calls')) ? fs.readFileSync(file('calls'), 'utf-8').split('\n').filter(Boolean) : [];
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(pred: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-service-'));
  fs.writeFileSync(file('stub-drain.sh'), STUB, { mode: 0o755 });
  env = {
    ...drainBaseEnv(),
    HOME: dir,
    MINSPEC_DRAIN_LOCK: file('drain.lock'),
    MINSPEC_DRAIN_LOG: file('drain.log'),
    MINSPEC_DRAIN_SERVICE_DRAIN: file('stub-drain.sh'),
    MINSPEC_DRAIN_SERVICE_LOCK: file('svc.lock'),
    MINSPEC_DRAIN_SERVICE_POLL: '1',
    MINSPEC_DRAIN_SERVICE_STOP_GRACE: '5',
    STUB_CALLS: file('calls'),
    STUB_PAUSE: file('pause'),
  };
});

afterEach(() => {
  for (const c of children.splice(0)) if (c.exitCode === null) c.kill('SIGKILL');
  const lock = file('drain.lock');
  if (fs.existsSync(lock)) {
    const pid = Number(fs.readFileSync(lock, 'utf-8'));
    if (pid > 0 && alive(pid)) process.kill(pid, 'SIGKILL');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('invariant 1: the drain never runs on the host', () => {
  it('the container predicate accepts docker-init and nothing else', () => {
    const cases: Array<[string | null, number]> = [
      ['docker-init', 0],
      ['systemd', 1],
      ['init', 1],
      ['docker-init-x', 1],
      ['', 1],
      [null, 1], // file missing
    ];
    for (const [content, want] of cases) {
      const f = file('pid1');
      fs.rmSync(f, { force: true });
      if (content !== null) fs.writeFileSync(f, `${content}\n`);
      const r = spawnSync('bash', [SVC, '--is-container', f], { env });
      expect([content, r.status]).toEqual([content, want]);
    }
  });

  it('run refuses with exit 78 off the container and never touches the drain', () => {
    const r = runSync('systemd');
    expect(r.status).toBe(78);
    expect(r.stdout).toContain('REFUSING');
    expect(calls()).toEqual([]);
  });

  it('executed directly, run reads the real /proc/1/comm', () => {
    const real = fs.readFileSync('/proc/1/comm', 'utf-8').trim();
    if (real === 'docker-init') {
      // Inside the agent container the real path is the container: run must NOT refuse.
      // Pause it so the stub starts nothing, then stop it.
      fs.writeFileSync(file('pause'), '');
      const r = spawnSync('bash', [SVC, 'run'], { env, encoding: 'utf-8', timeout: 3_000, killSignal: 'SIGTERM' });
      expect(r.status).not.toBe(78);
    } else {
      const r = spawnSync('bash', [SVC, 'run'], { env, encoding: 'utf-8', timeout: 10_000 });
      expect(r.status).toBe(78);
      expect(calls()).toEqual([]);
    }
  });

  it('the unit runs the supervisor through docker exec and never restarts a refusal', () => {
    const unit = fs.readFileSync(UNIT, 'utf-8');
    const execStart = unit.match(/^ExecStart=(.*)$/m)?.[1] ?? '';
    const execStop = unit.match(/^ExecStop=(.*)$/m)?.[1] ?? '';
    expect(execStart).toMatch(/^\/usr\/bin\/env docker exec .* claude-agent \S+\/scripts\/drain-service\/drain-service\.sh run$/);
    expect(execStop).toMatch(/^\/usr\/bin\/env docker exec .* claude-agent \S+\/scripts\/drain-service\/drain-service\.sh stop$/);
    expect(unit).toMatch(/^Restart=always$/m);
    expect(unit).toMatch(/^RestartPreventExitStatus=78$/m);
    expect(unit).toMatch(/^StartLimitBurst=\d+$/m);
    // No environment the unit passes may reach the drain's knobs: docker exec carries
    // only what -e names, and the only -e is HOME.
    expect(execStart.match(/ -e (\S+)/g)).toEqual([' -e HOME=%h']);
    expect(unit).not.toMatch(/^Environment=.*MINSPEC/m);
  });
});

describe('invariant 2: at most one drain', () => {
  it('shares the drain lock and log defaults with drain-inbox.sh', () => {
    const svc = fs.readFileSync(SVC, 'utf-8');
    const drain = fs.readFileSync(DRAIN_INBOX, 'utf-8');
    for (const v of ['MINSPEC_DRAIN_LOCK', 'MINSPEC_DRAIN_LOG']) {
      const re = new RegExp(`\\$\\{${v}:-([^}]+)\\}`);
      const a = svc.match(re)?.[1];
      expect(a).toBeTruthy();
      expect(a).toBe(drain.match(re)?.[1]);
    }
  });

  it('adopts a live lock holder and starts nothing', async () => {
    const holder = spawn('sleep', ['30']);
    children.push(holder);
    fs.writeFileSync(file('drain.lock'), String(holder.pid));
    const sv = runBackground('docker-init');
    await until(() => sv.out().includes('adopting'));
    expect(calls().filter((c) => c.startsWith('--continuous'))).toEqual([]);
    holder.kill('SIGKILL');
    const code = await sv.done;
    // The adopted drain wrote no exit line, so its end is reported as a failure.
    expect(code).toBe(1);
    expect(calls().filter((c) => c.startsWith('--continuous'))).toEqual([]);
  });

  it('a second supervisor exits 75', async () => {
    fs.writeFileSync(file('pause'), '');
    const first = runBackground('docker-init');
    await until(() => first.out().includes('PAUSED'));
    const second = runSync('docker-init');
    expect(second.status).toBe(75);
    first.proc.kill('SIGTERM');
    expect(await first.done).toBe(0);
  });
});

describe('invariant 3: pause survives restart', () => {
  it('a fresh supervisor with the marker present starts no drain, then starts one on resume', async () => {
    fs.writeFileSync(file('pause'), '');
    const sv = runBackground('docker-init');
    await until(() => sv.out().includes('PAUSED'));
    await new Promise((r) => setTimeout(r, 2_500)); // several polls
    expect(calls().filter((c) => c.startsWith('--continuous'))).toEqual([]);
    fs.rmSync(file('pause'));
    await until(() => calls().some((c) => c.startsWith('--continuous')));
    expect(sv.out()).toContain('RESUMED');
    expect(await sv.done).toBe(0);
  });
});

describe('invariant 4: a failure is visible', () => {
  it('a normal end exits 0 and echoes the drain log', async () => {
    const r = runSync('docker-init');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[drain] loop exited.');
  });

  it('consecutive cycle errors exit 1 with the drain line in the journal', () => {
    env.STUB_END = '[drain] 3 consecutive cycle errors — stopping loop cleanly';
    const r = runSync('docker-init');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('consecutive cycle errors');
    expect(r.stdout).toContain('FAILED');
  });

  it('a failed launch exits 1', () => {
    env.STUB_RC = '1';
    const r = runSync('docker-init');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('drain launch exited 1');
  });
});

describe('deliberate stop', () => {
  it('stop ends the supervisor and the drain it started', async () => {
    env.STUB_LIFE = '60';
    const sv = runBackground('docker-init');
    await until(() => fs.existsSync(file('drain.lock')) && sv.out().includes('starting the drain'));
    const drainPid = Number(fs.readFileSync(file('drain.lock'), 'utf-8'));
    expect(alive(drainPid)).toBe(true);
    const stop = spawnSync('bash', [SVC, 'stop'], { env, encoding: 'utf-8', timeout: 20_000 });
    expect(stop.status).toBe(0);
    expect(await sv.done).toBe(0);
    await until(() => !alive(drainPid));
    expect(fs.existsSync(file('drain.lock'))).toBe(false);
    expect(fs.readFileSync(file('drain.log'), 'utf-8')).toContain('stopping on SIGTERM');
  });
});
