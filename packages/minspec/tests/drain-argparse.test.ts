/**
 * T3 regression — drain-inbox.sh must parse EVERY argument, not just `$1` (#1591).
 *
 * Bug: the flag dispatcher was `case "${1:-}" in … esac` with no enclosing loop and
 * no `shift`, so only the first argument was ever inspected. `--auto --dry-run`
 * therefore matched `--auto` (which sets CONTINUOUS=true) and silently DISCARDED
 * `--dry-run`, leaving DRY_RUN=false. The dry-run guard further down is correct; it
 * simply never received the flag. The result: a command whose whole point was to
 * preview started a real continuous drain that wrote labels to GitHub.
 *
 * The gate that should have rejected it was asymmetric in the same way — the
 * `*) echo "Unknown arg: $1"; exit 1` arm validates `$1` and nothing else, so a
 * typo in FIRST position fails loudly while anything after it is dropped in
 * silence. That asymmetry is the real defect, so it is pinned here directly: a
 * test that only asserted `--auto --dry-run` would pass again the moment someone
 * special-cased that one pair.
 *
 * Hermetic: each test builds its own temp tree with a stubbed `gh`, so no case can
 * reach the network, the real .minspec/auto-drain, or dispatch an agent.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

// Module scope, never a hook: vitest resolves timeouts before beforeAll runs (#1399).
useShellTimeout();

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DRAIN_SRC = path.join(REPO_ROOT, 'scripts', 'drain-inbox.sh');

let ws: string;
let drain: string;
let binDir: string;

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-argparse-'));
  fs.mkdirSync(path.join(ws, 'scripts'), { recursive: true });
  drain = path.join(ws, 'scripts', 'drain-inbox.sh');
  fs.copyFileSync(DRAIN_SRC, drain);
  fs.cpSync(path.join(REPO_ROOT, 'scripts', 'lib'), path.join(ws, 'scripts', 'lib'), {
    recursive: true,
  });
  fs.chmodSync(drain, 0o755);

  // Opt in, so `--auto` proceeds past its pref check and actually reaches the
  // dry-run guard. Without this the case would exit 0 for the WRONG reason and the
  // test would pass vacuously against the bug.
  fs.mkdirSync(path.join(ws, '.minspec'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.minspec', 'auto-drain'), 'on\n');

  // Stub `gh` so the pending-work count resolves offline. It must report a NON-empty
  // issue list: with zero pending work the drain exits early and quietly, before the
  // dry-run notice is ever reached — which would let the main case pass without the
  // dry-run branch running at all. Pending work is also the only state in which the
  // bug is dangerous, so it is the state worth pinning.
  binDir = path.join(ws, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const gh = path.join(binDir, 'gh');
  fs.writeFileSync(gh, '#!/usr/bin/env bash\nprintf "101\\n102\\n"\nexit 0\n', { mode: 0o755 });
});

afterEach(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): Run {
  try {
    const stdout = execFileSync('bash', [drain, ...args], {
      encoding: 'utf-8',
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return {
      status: err.status ?? -1,
      stdout: String(err.stdout ?? ''),
      stderr: String(err.stderr ?? ''),
    };
  }
}

describe('#1591 — every argument is parsed, not just $1', () => {
  it('THE #1591 CASE: `--auto --dry-run` honours --dry-run and starts no drain', () => {
    const r = run(['--auto', '--dry-run']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/dry-run/);
    // The tell that separates a real drain from a preview: the background driver
    // announces itself. Its absence is the assertion that actually fails pre-fix.
    expect(r.stdout).not.toMatch(/Continuous drain in background/);
  });

  it('starts no lock file — nothing was launched', () => {
    run(['--auto', '--dry-run']);
    const lockish = fs
      .readdirSync(path.join(ws, '.minspec'))
      .filter((f) => f.includes('lock') || f.includes('drain-pid'));
    expect(lockish).toEqual([]);
  });

  it('rejects an unknown flag in SECOND position — the asymmetry itself', () => {
    // The generalisation. Pre-fix this exits 0 (the flag is silently dropped);
    // a fix that special-cased only --dry-run would leave this red.
    const r = run(['--dry-run', '--definitely-not-a-flag']);
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toMatch(/Unknown arg/);
  });

  it('still rejects an unknown flag in FIRST position', () => {
    const r = run(['--definitely-not-a-flag']);
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toMatch(/Unknown arg/);
  });

  it('a later flag is read: `--continuous --once` resolves to one-shot', () => {
    // NOT a regression pin — this one passes against the unfixed script too, because
    // with pending work the pre-fix `--continuous` path exits before announcing the
    // background driver. It is kept as a forward semantics check (a later flag must
    // be able to override an earlier one), not as evidence the bug is fixed. The two
    // cases that actually go red pre-fix are the #1591 case and the second-position
    // unknown flag.
    const r = run(['--continuous', '--once']);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/Continuous drain in background/);
  });

  it('positional-operand seams still work (they exit before any shift)', () => {
    // `--session-alive <pid>` reads $2 directly. A loop that shifted carelessly
    // would break these, so pin one: our own PID is alive, PID 1 is not us.
    const alive = run(['--session-alive', String(process.pid)]);
    expect(alive.status).toBe(0);
    const dead = run(['--session-alive', '999999999']);
    expect(dead.status).toBe(1);
  });
});
