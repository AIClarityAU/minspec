/**
 * T0/T3 (in41) - one cap figure, computed in one place, readable by everything that judges it.
 *
 * THE FAULT. On 2026-10-22 the chief-of-staff runner wrote "7d quota 90% (over cap): kept
 * small" and started no work for two hours, while the drain's own gate, reading the same
 * meter minutes earlier, said `open ... 7d window 89% used, cap 92.4% ramped`. The same
 * split happened on 2026-10-20 (runner held at "66% vs 60 cap" while the ramped cap was
 * 76.2%). The runner was not reading the drain's cap at all: its loop compares the weekly
 * level with a fixed 60% of its own and calls the result a slow heartbeat, and its skill
 * prose reads a slow heartbeat as "over the founder's cap". Two figures for one question.
 *
 * THE GATE. `drain-inbox.sh --quota-cap` is quota_gate itself, run as a READER: one line,
 * `open|closed`, each window's used% against the cap in force, then the gate's own verdict.
 * Anything outside this script that wants to know whether quota allows work asks it,
 * instead of carrying a threshold of its own.
 *
 * WHAT THIS FILE PINS, in the order a mistake would cost:
 *   C1  a reader never opens what the gate holds: no reading, a stale reading and an
 *       unusable knob are all `closed`, exit 42 (constitution invariant 2).
 *   C2  a reader never spends, and never resets, the drain's bootstrap allowance. The meter
 *       reader that already existed reset it (B1 below), which reopened blind admits.
 *   C3  the verdict is the gate's verdict, on every row of a grid: same exit code, same arm.
 *   C4  the two dated readings come out the way the drain judged them, with the figures.
 *   C5  the line is one line, and its first word is the verdict, so a caller can parse it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { drainBaseEnv, useHostileAmbientDrainKnobs } from './helpers/drain-env';
import { DRAIN, readingJson, type Reading } from './helpers/drain-harness';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();
useHostileAmbientDrainKnobs();

const nowSec = () => Math.floor(Date.now() / 1000);
const HOUR = 3600;
const DAY = 86400;

let tmpDir: string;
let quotaFile: string;
let sidecar: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-cap-'));
  quotaFile = path.join(tmpDir, 'quota.json');
  sidecar = `${quotaFile}.bootstrap`;
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

interface Out {
  code: number;
  out: string;
}

function run(args: string[], env: Record<string, string> = {}): Out {
  try {
    const out = execFileSync('bash', [DRAIN, ...args], {
      encoding: 'utf-8',
      stdio: 'pipe',
      env: { ...drainBaseEnv(), MINSPEC_QUOTA_FILE: quotaFile, MINSPEC_QUOTA_REFRESH: '0', ...env },
    });
    return { code: 0, out };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string };
    return { code: err.status ?? 1, out: err.stdout ?? '' };
  }
}

const write = (r: Reading) => fs.writeFileSync(quotaFile, readingJson(r, nowSec()));
const cap = (env: Record<string, string> = {}) => run(['--quota-cap'], env);
const gate = (env: Record<string, string> = {}) => run(['--quota-gate'], env);

describe('in41 C1: a reader never opens what the gate holds', () => {
  it('no reading at all: closed, 42', () => {
    const r = cap();
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(/^closed unknown \| defer:no-reading/);
  });

  it('a stale reading: closed, 42', () => {
    write({ pct: 1, resetIn: HOUR, weekPct: 1, weekResetIn: DAY, ageSec: 3600 });
    const r = cap();
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(/^closed unknown \| defer:stale/);
  });

  it('an unusable knob: closed, 42, whatever the reading', () => {
    write({ pct: 1, resetIn: HOUR, weekPct: 1, weekResetIn: DAY });
    const r = cap({ MINSPEC_QUOTA_RAMP_FLOOR_7D: '6O' });
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(/^closed unknown \| defer:bad-config/);
  });

  it('a weekly window at its cap: closed, with the figure that held it', () => {
    write({ pct: 0, resetIn: HOUR, weekPct: 93, weekResetIn: 18.2 * HOUR });
    const r = cap();
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(/^closed 7d 93% vs 92\.4% ramped; 5h not judged \| defer:/);
  });

  it('a 5h window at its cap: closed, with both figures', () => {
    write({ pct: 61, resetIn: 5 * HOUR, weekPct: 10, weekResetIn: 5 * DAY });
    const r = cap();
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(/^closed 7d 10% vs 60\.0% ramped; 5h 61% vs 60\.0% ramped \| defer:/);
  });
});

describe('in41 C2: a reader never spends or resets the bootstrap allowance', () => {
  it('with no reading, --quota-cap consumes no admit (the gate would have opened one)', () => {
    expect(cap().code).toBe(42);
    expect(fs.existsSync(sidecar)).toBe(false);
    const g = gate();
    expect(g.code, g.out).toBe(0);
    expect(g.out).toMatch(/^open:bootstrap 1\/3/);
  });

  it.each([
    { seam: '--quota-cap', args: ['--quota-cap'] },
    // B1 (T3): this reader existed before in41 and zeroed the pin, so the next blind ask
    // was admitted. Reproduced 2026-10-22: sidecar 3 -> 0, then `open:bootstrap 1/3`.
    { seam: '--quota-signal-sleep', args: ['--quota-signal-sleep', '0'] },
  ])('$seam on a real reading leaves bootstrap graduated, so a later lost reading still holds', ({ args }) => {
    write({ pct: 10, resetIn: HOUR, weekPct: 10, weekResetIn: 5 * DAY });
    expect(gate().code).toBe(0);
    expect(fs.readFileSync(sidecar, 'utf-8').trim()).toBe('3');
    run(args);
    expect(fs.readFileSync(sidecar, 'utf-8').trim()).toBe('3');
    fs.rmSync(quotaFile);
    const g = gate();
    expect(g.code, g.out).toBe(42);
    expect(g.out).toMatch(/^defer:no-reading/);
  });
});

describe('in41 C3: the reader returns the gate verdict on every row', () => {
  const grid: Array<{ what: string; r: Reading; env?: Record<string, string> }> = [
    { what: 'quiet week, quiet window', r: { pct: 5, resetIn: 4 * HOUR, weekPct: 20, weekResetIn: 5 * DAY } },
    { what: 'week near its ramped cap, under it', r: { pct: 5, resetIn: 4 * HOUR, weekPct: 89, weekResetIn: 18.2 * HOUR } },
    { what: 'week over its ramped cap', r: { pct: 5, resetIn: 4 * HOUR, weekPct: 95, weekResetIn: 18.2 * HOUR } },
    { what: '5h over its ramped cap', r: { pct: 70, resetIn: 4.5 * HOUR, weekPct: 20, weekResetIn: 5 * DAY } },
    { what: '5h window already reset', r: { pct: 99, resetIn: -10, weekPct: 20, weekResetIn: 5 * DAY } },
    { what: 'no weekly window reported', r: { pct: 5, resetIn: 4 * HOUR } },
    { what: 'weekly with no reset time', r: { pct: 5, resetIn: 4 * HOUR, weekPct: 59 } },
    { what: 'a fixed weekly cap of 0 (the pause)', r: { pct: 5, resetIn: 4 * HOUR, weekPct: 0, weekResetIn: 5 * DAY }, env: { MINSPEC_QUOTA_ADMIT_PCT_7D: '0' } },
    { what: 'a fixed 5h cap', r: { pct: 50, resetIn: 4 * HOUR, weekPct: 20, weekResetIn: 5 * DAY }, env: { MINSPEC_QUOTA_ADMIT_PCT: '50' } },
  ];
  it.each(grid)('$what', ({ r, env }) => {
    write(r);
    const g = gate(env);
    const c = cap(env);
    expect(c.code, c.out).toBe(g.code);
    expect(c.out.startsWith(g.code === 0 ? 'open ' : 'closed ')).toBe(true);
    const arm = (s: string) => s.split(/[: ]/)[0];
    expect(arm(c.out.split(' | ')[1] ?? ''), c.out).toBe(arm(g.out));
  });
});

describe('in41 C4: the dated readings, as the drain judged them', () => {
  it('2026-10-22: 7d 89% with 18.2 h left is OPEN against 92.4%, not "over cap"', () => {
    write({ pct: 29, resetIn: 10400, weekPct: 89, weekResetIn: 18.2 * HOUR });
    const r = cap();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/^open 7d 89% vs 92\.4% ramped; 5h 29% vs 76\.8% ramped \| open:/);
  });

  it('2026-10-20: 7d 66% against a 76.2% ramped cap is OPEN, not held at a fixed 60', () => {
    write({ pct: 10, resetIn: 4.5 * HOUR, weekPct: 66, weekResetIn: 205600 });
    const r = cap();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/^open 7d 66% vs 76\.2% ramped; 5h 10% vs /);
  });

  it('a fixed cap reads as fixed, so a caller sees which rule decided', () => {
    write({ pct: 10, resetIn: 4 * HOUR, weekPct: 30, weekResetIn: 5 * DAY });
    const r = cap({ MINSPEC_QUOTA_ADMIT_PCT_7D: '40' });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/^open 7d 30% vs 40\.0% fixed; 5h 10% vs /);
  });

  it('no weekly window and a reset 5h window read as such', () => {
    write({ pct: 99, resetIn: -10 });
    const r = cap();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/^open 7d unreported; 5h window reset \| open:window-reset/);
  });
});

describe('in41 C5: one line, verdict first', () => {
  it.each([
    { what: 'open', r: { pct: 5, resetIn: 4 * HOUR, weekPct: 20, weekResetIn: 5 * DAY } as Reading | null },
    { what: 'closed', r: { pct: 5, resetIn: 4 * HOUR, weekPct: 99, weekResetIn: 5 * DAY } as Reading | null },
    { what: 'unknown', r: null },
  ])('$what', ({ r }) => {
    if (r) write(r);
    const out = cap().out;
    expect(out.endsWith('\n')).toBe(true);
    expect(out.trimEnd().split('\n')).toHaveLength(1);
    expect(out).toMatch(/^(open|closed) /);
  });
});
