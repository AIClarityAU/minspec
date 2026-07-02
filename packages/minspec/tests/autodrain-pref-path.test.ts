/**
 * T3 regression — auto-drain opt-in pref path (session-start hook ⇄ drain-inbox.sh).
 *
 * Bug: the session-start hook lives in scripts/hooks/ (one level deeper than
 * drain-inbox.sh in scripts/) and RECOMPUTED the pref path with its own relative
 * `..` walk — landing on scripts/.minspec/auto-drain, one directory too shallow.
 * Meanwhile `drain-inbox.sh --enable-auto` wrote the CORRECT repo-root
 * .minspec/auto-drain. So the hook always read "missing → off", never invoked
 * `--auto`, and the banner lied "Auto-drain is OFF" while the pref said "on".
 * (/tmp/minspec-drain-inbox.log never existed → the drain body never ran.)
 *
 * Root cause = duplicated path derivation that drifted; the gate = a single
 * source of truth. Fix: drain-inbox.sh exposes `--pref-path`; the hook consults
 * that instead of recomputing. These tests pin BOTH halves:
 *   1. round-trip — the path --enable-auto writes IS the path --pref-path reports;
 *   2. location   — it resolves to repo-root .minspec/, never scripts/.minspec/;
 *   3. anti-drift — the hook must obtain PREF via --pref-path, never rebuild it.
 *
 * Hermetic: each test copies the two scripts into its OWN temp tree, so nothing
 * touches the real repo's .minspec/auto-drain.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DRAIN_SRC = path.join(REPO_ROOT, 'scripts', 'drain-inbox.sh');
const HOOK_SRC = path.join(REPO_ROOT, 'scripts', 'hooks', 'session-start.sh');

let ws: string;
let drain: string;

// Build a minimal temp tree: <ws>/scripts/drain-inbox.sh (+ hooks/). We copy
// only the pref-path plumbing's dependencies; --enable-auto / --pref-path /
// --disable-auto need no git, gh, or claude — they just touch the pref file
// relative to the script's own location.
beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'autodrain-'));
  fs.mkdirSync(path.join(ws, 'scripts', 'hooks'), { recursive: true });
  drain = path.join(ws, 'scripts', 'drain-inbox.sh');
  fs.copyFileSync(DRAIN_SRC, drain);
  fs.copyFileSync(HOOK_SRC, path.join(ws, 'scripts', 'hooks', 'session-start.sh'));
  fs.chmodSync(drain, 0o755);
});

afterEach(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

function run(args: string[]): string {
  return execFileSync('bash', [drain, ...args], { encoding: 'utf-8' }).trim();
}

describe('auto-drain pref path', () => {
  it('reports the pref path at repo root, not under scripts/', () => {
    const p = run(['--pref-path']);
    expect(p).toBe(path.join(ws, '.minspec', 'auto-drain'));
    // The original bug resolved here — assert we never regress to it.
    expect(p).not.toBe(path.join(ws, 'scripts', '.minspec', 'auto-drain'));
  });

  it('round-trips: --enable-auto writes exactly where --pref-path reads', () => {
    const prefPath = run(['--pref-path']);
    run(['--enable-auto']);
    // The file the opt-in created must be the one the reader consults.
    expect(fs.existsSync(prefPath)).toBe(true);
    expect(fs.readFileSync(prefPath, 'utf-8').trim()).toBe('on');
  });

  it('--disable-auto flips the same file the reader consults', () => {
    run(['--enable-auto']);
    const prefPath = run(['--pref-path']);
    expect(fs.readFileSync(prefPath, 'utf-8').trim()).toBe('on');
    run(['--disable-auto']);
    expect(fs.readFileSync(prefPath, 'utf-8').trim()).toBe('off');
  });

  it('the hook obtains PREF via --pref-path and never recomputes the .minspec path (anti-drift)', () => {
    const hook = fs.readFileSync(HOOK_SRC, 'utf-8');
    // Must delegate to the single source of truth.
    expect(hook).toMatch(/--pref-path/);
    // Must NOT independently build a .minspec/auto-drain path — that duplication
    // is precisely what drifted. (Comments mentioning the filename are fine; a
    // path-construction expression ending in it is not.)
    expect(hook).not.toMatch(/["')]\/\.minspec\/auto-drain/);
    expect(hook).not.toMatch(/&& pwd\)\/\.minspec\/auto-drain/);
  });
});
