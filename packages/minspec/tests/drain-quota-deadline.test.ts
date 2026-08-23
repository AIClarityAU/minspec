/**
 * T0 — the 5-hour quota gate is a DEADLINE, not a flag.
 *
 * The drain must not admit a unit of work into a window too small to finish it,
 * and must resume when the window resets without anybody delivering a signal.
 *
 * Why a deadline and not a paused/unpaused flag: a flag needs someone to clear
 * it, which needs a resume signal, which is read on the very channel the pause
 * is meant to gate — so it is evaluated after the condition it describes has
 * already flipped. An epoch needs nobody: every consumer compares `now` against
 * resets_at locally, at the moment it matters.
 *
 * The load-bearing invariants, in priority order:
 *   INV-A  a missing / stale / unparseable reading FAILS OPEN (never wedges work)
 *   INV-B  failing open is AUDIBLE — it always names why (no silent throttle)
 *   INV-C  the gate needs no network: no gh, no curl, no claude
 *   INV-D  the sleep is derived from resets_at, never a fixed guess, never negative
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const DRAIN = path.resolve(__dirname, '../../../scripts/drain-inbox.sh');
const nowSec = () => Math.floor(Date.now() / 1000);

let tmpDir: string;
let quotaFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-gate-'));
  quotaFile = path.join(tmpDir, 'quota.json');
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function run(args: string[], env: Record<string, string> = {}): { code: number; out: string } {
  try {
    const out = execFileSync('bash', [DRAIN, ...args], {
      encoding: 'utf-8',
      env: { ...process.env, MINSPEC_QUOTA_FILE: quotaFile, ...env },
    });
    return { code: 0, out: out.trim() };
  } catch (e: any) {
    return { code: e.status ?? 1, out: (((e.stdout ?? '') as string) + ((e.stderr ?? '') as string)).trim() };
  }
}

function write(q: Partial<{ used_percentage: number; resets_at: number; observed_at: number }>) {
  fs.writeFileSync(quotaFile, JSON.stringify({ observed_at: nowSec(), ...q }));
}

describe('drain-inbox.sh --quota-gate — INV-A/INV-B: unknown state fails OPEN, audibly', () => {
  it('no file at all → open, and says why', () => {
    const r = run(['--quota-gate']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^open:/);
    expect(r.out).toMatch(/no-reading/);
  });

  it('unparseable garbage → open, not a crash and not a silent throttle', () => {
    fs.writeFileSync(quotaFile, 'not json at all {{{');
    const r = run(['--quota-gate']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^open:/);
    expect(r.out).toMatch(/no-reading/);
  });

  it('a reading with fields missing → open', () => {
    fs.writeFileSync(quotaFile, JSON.stringify({ observed_at: nowSec() }));
    expect(run(['--quota-gate']).code).toBe(0);
  });

  it('STALE reading → open even though the percentage is way over the bar', () => {
    // 99% used, but observed hours ago: nobody has looked since, so it proves nothing.
    write({ used_percentage: 99, resets_at: nowSec() + 3600, observed_at: nowSec() - 86400 });
    const r = run(['--quota-gate']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/stale/);
  });

  it('resets_at already in the past → open (the window reset itself)', () => {
    write({ used_percentage: 99, resets_at: nowSec() - 60 });
    const r = run(['--quota-gate']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/window-reset/);
  });
});

describe('drain-inbox.sh --quota-gate — the actual admission decision', () => {
  it('plenty of window left → open', () => {
    write({ used_percentage: 12, resets_at: nowSec() + 3600 });
    const r = run(['--quota-gate']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^open:/);
  });

  it('over the bar with the window still running → DEFER (exit 42)', () => {
    write({ used_percentage: 95, resets_at: nowSec() + 3600 });
    const r = run(['--quota-gate']);
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/^defer:/);
  });

  it('exactly at the bar defers; one under it does not (boundary is not off by one)', () => {
    write({ used_percentage: 90, resets_at: nowSec() + 3600 });
    expect(run(['--quota-gate'], { MINSPEC_QUOTA_ADMIT_PCT: '90' }).code).toBe(42);
    write({ used_percentage: 89, resets_at: nowSec() + 3600 });
    expect(run(['--quota-gate'], { MINSPEC_QUOTA_ADMIT_PCT: '90' }).code).toBe(0);
  });

  it('the bar is tunable, so a caller can be more or less cautious than the default', () => {
    write({ used_percentage: 50, resets_at: nowSec() + 3600 });
    expect(run(['--quota-gate'], { MINSPEC_QUOTA_ADMIT_PCT: '40' }).code).toBe(42);
    expect(run(['--quota-gate'], { MINSPEC_QUOTA_ADMIT_PCT: '99' }).code).toBe(0);
  });

  it('a fractional percentage is handled, not treated as garbage', () => {
    write({ used_percentage: 95.7, resets_at: nowSec() + 3600 });
    expect(run(['--quota-gate']).code).toBe(42);
  });
});

describe('drain-inbox.sh --quota-sleep — INV-D: sleep to the deadline, never a guess', () => {
  it('sleeps the distance to resets_at, not the fixed fallback', () => {
    write({ used_percentage: 95, resets_at: nowSec() + 600 });
    const secs = Number(run(['--quota-sleep']).out);
    // ~600s plus a small settling margin — emphatically not the 1800s fallback.
    expect(secs).toBeGreaterThanOrEqual(600);
    expect(secs).toBeLessThan(900);
  });

  it('with NO reading, falls back to the fixed backoff rather than sleeping 0 and spinning', () => {
    const secs = Number(run(['--quota-sleep'], { MINSPEC_DRAIN_QUOTA_BACKOFF: '1800' }).out);
    expect(secs).toBe(1800);
  });

  it('a reset already in the past never yields a negative or zero sleep', () => {
    write({ used_percentage: 99, resets_at: nowSec() - 5000 });
    const secs = Number(run(['--quota-sleep']).out);
    expect(secs).toBeGreaterThan(0);
  });

  it('is clamped so a corrupt far-future epoch cannot park the drain for a week', () => {
    write({ used_percentage: 99, resets_at: nowSec() + 999999999 });
    const secs = Number(run(['--quota-sleep']).out);
    expect(secs).toBeLessThanOrEqual(6 * 3600);
  });

  it('always prints a bare integer — it is fed straight to sleep', () => {
    write({ used_percentage: 95, resets_at: nowSec() + 600 });
    expect(run(['--quota-sleep']).out).toMatch(/^\d+$/);
    expect(run(['--quota-sleep'], { MINSPEC_QUOTA_FILE: '/nonexistent/x.json' }).out).toMatch(/^\d+$/);
  });
});

describe('drain-inbox.sh --quota-gate — INV-C: decides offline', () => {
  it('still decides correctly with gh, curl and claude sabotaged on PATH', () => {
    // Not a source-text assertion: a grep for "no gh call" passes vacuously if the
    // call is spelled differently. This puts poisoned binaries EARLIER on PATH, so
    // any network reach-out fails loudly and the verdict would change.
    const binDir = path.join(tmpDir, 'bin');
    fs.mkdirSync(binDir);
    for (const tool of ['gh', 'curl', 'claude', 'wget']) {
      const p = path.join(binDir, tool);
      fs.writeFileSync(p, '#!/bin/sh\necho "NETWORK CALL: ' + tool + '" >&2\nexit 99\n');
      fs.chmodSync(p, 0o755);
    }
    write({ used_percentage: 95, resets_at: nowSec() + 3600 });
    const r = run(['--quota-gate'], { PATH: `${binDir}:${process.env.PATH}` });
    expect(r.code).toBe(42);
    expect(r.out).not.toMatch(/NETWORK CALL/);
  });
});
