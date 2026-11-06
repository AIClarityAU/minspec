/**
 * T0 (in72) - a time-bounded quota boost that ends by itself.
 *
 * THE ASK. The founder, 2026-10-28: "go ahead and use up all 100% of my week's tokens now,
 * as i won't need them for anything else this week." The only cap knobs were environment
 * variables (MINSPEC_QUOTA_ADMIT_PCT / _7D), read once when the drain starts, with no end
 * date. Setting one meant a restart to apply it and someone remembering to take it away.
 *
 * THE MECHANISM. A file (MINSPEC_QUOTA_BOOST_FILE) with a mandatory `until=` and a cap per
 * window, read at every judgment. While it is in force a ramped cap is max(ramp, boost).
 *
 * WHAT THIS FILE PINS, in the order a mistake would cost:
 *   B1  the boost ENDS by itself: the same file past its `until` gives the ramp back.
 *   B2  every fault in the file means the NORMAL caps, and the line says why (invariant 2).
 *   B3  a boost only raises: never below the ramp, never over a fixed cap (a fixed 0 is a
 *       pause somebody set).
 *   B4  while in force, it admits what the ramp holds and says it is a boost.
 *   B5  a boost with no end in sight (more than 8 days off) is refused.
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
const iso = (epochSec: number) => new Date(epochSec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

let tmpDir: string;
let quotaFile: string;
let boostFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-boost-'));
  quotaFile = path.join(tmpDir, 'quota.json');
  boostFile = path.join(tmpDir, 'drain-quota-boost');
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
      env: {
        ...drainBaseEnv(),
        MINSPEC_QUOTA_FILE: quotaFile,
        MINSPEC_QUOTA_REFRESH: '0',
        MINSPEC_QUOTA_BOOST_FILE: boostFile,
        ...env,
      },
    });
    return { code: 0, out };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string };
    return { code: err.status ?? 1, out: err.stdout ?? '' };
  }
}

const write = (r: Reading) => fs.writeFileSync(quotaFile, readingJson(r, nowSec()));
const boost = (text: string) => fs.writeFileSync(boostFile, text);
const cap = (env: Record<string, string> = {}) => run(['--quota-cap'], env);
const gate = (env: Record<string, string> = {}) => run(['--quota-gate'], env);

// 90% of both windows used, 35 h to the weekly reset and 4 h to the 5h one: the ramp holds
// both (85.4% weekly, 68.0% for the 5h window), so a boost is what decides.
const HELD: Reading = { pct: 90, resetIn: 4 * HOUR, weekPct: 90, weekResetIn: 35 * HOUR };
const RAMP_LINE = /^closed 7d 90% vs 85\.4% ramped; 5h not judged \| defer:/;

describe('in72 B1: the boost ends by itself', () => {
  it('the same file, one second past its until, gives the ramp back', () => {
    write(HELD);
    boost(`until=${iso(nowSec() + HOUR)}\ncap_7d=100\ncap_5h=100\n`);
    const on = cap();
    expect(on.code, on.out).toBe(0);
    boost(`until=${iso(nowSec() - 1)}\ncap_7d=100\ncap_5h=100\n`);
    const off = cap();
    expect(off.code, off.out).toBe(42);
    expect(off.out).toMatch(RAMP_LINE);
    // An expired boost is the expected end, not a fault: nothing is reported as ignored.
    expect(off.out).not.toMatch(/IGNORED/);
  });

  it('the gate itself, not only the reader, holds again once it is over', () => {
    write(HELD);
    boost(`until=${iso(nowSec() - 60)}\ncap_7d=100\n`);
    const g = gate();
    expect(g.code, g.out).toBe(42);
    expect(g.out).toMatch(/^defer:\d+ \(7d window 90% used .*cap 85\.4% ramped/);
  });
});

describe('in72 B2: a boost nobody can read means the normal caps, said aloud', () => {
  const later = () => iso(nowSec() + HOUR);
  it.each([
    { why: 'until is not a UTC time', text: () => 'until=tomorrow\ncap_7d=100\n', says: /until=tomorrow is not a UTC time/ },
    { why: 'until is missing', text: () => 'cap_7d=100\n', says: /until= is not a UTC time|until=''/ },
    { why: 'until is not a real date', text: () => 'until=2026-13-45T99:00:00Z\ncap_7d=100\n', says: /is not a UTC time/ },
    { why: 'a cap above 100', text: () => `until=${later()}\ncap_7d=101\n`, says: /cap_7d=101 is not a whole percent/ },
    { why: 'a cap that is not a number', text: () => `until=${later()}\ncap_7d=1O0\n`, says: /cap_7d=1O0 is not a whole percent/ },
    { why: 'no cap at all', text: () => `until=${later()}\n`, says: /sets neither cap_5h nor cap_7d/ },
    { why: 'an unknown key', text: () => `until=${later()}\ncap_week=100\n`, says: /unknown key cap_week/ },
    { why: 'a line that is not key=value', text: () => `until=${later()}\ncap_7d 100\n`, says: /is not key=value/ },
  ])('$why', ({ text, says }) => {
    write(HELD);
    boost(text());
    const r = cap();
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(RAMP_LINE);
    expect(r.out).toMatch(/quota boost .* IGNORED: /);
    expect(r.out).toMatch(says);
    expect(r.out.trim().split('\n')).toHaveLength(1);
  });

  it('a boost path that is a directory', () => {
    write(HELD);
    fs.mkdirSync(boostFile);
    const r = cap();
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(RAMP_LINE);
    expect(r.out).toMatch(/IGNORED: the file cannot be read/);
  });

  it('no boost file at all: the line is exactly the ramp, with nothing about a boost', () => {
    write(HELD);
    const r = cap();
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(RAMP_LINE);
    expect(r.out).not.toMatch(/boost/);
  });
});

describe('in72 B3: a boost only raises', () => {
  it('a boost below the ramp leaves the ramp in force', () => {
    write(HELD);
    boost(`until=${iso(nowSec() + HOUR)}\ncap_7d=50\ncap_5h=50\n`);
    const r = cap();
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(RAMP_LINE);
  });

  it('a fixed cap is never moved: a fixed 0 still pauses under a 100% boost', () => {
    write({ pct: 1, resetIn: 4 * HOUR, weekPct: 1, weekResetIn: 35 * HOUR });
    boost(`until=${iso(nowSec() + HOUR)}\ncap_7d=100\ncap_5h=100\n`);
    const r = cap({ MINSPEC_QUOTA_ADMIT_PCT_7D: '0' });
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(/^closed 7d 1% vs 0\.0% fixed; /);
  });

  it('a boost for one window leaves the other on its ramp', () => {
    write({ pct: 90, resetIn: 4 * HOUR, weekPct: 50, weekResetIn: 35 * HOUR });
    boost(`until=${iso(nowSec() + HOUR)}\ncap_7d=100\n`);
    const r = cap();
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(/^closed 7d 50% vs 100\.0% boosted; 5h 90% vs 68\.0% ramped \|/);
  });
});

describe('in72 B4: in force, it admits what the ramp holds and says so', () => {
  it('both windows at 90% are admitted at 100%, with the ramp figure alongside', () => {
    write(HELD);
    const until = iso(nowSec() + HOUR);
    boost(`# founder, 2026-10-28\nuntil=${until}\ncap_7d=100\ncap_5h=100\n`);
    const r = cap();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/^open 7d 90% vs 100\.0% boosted; 5h 90% vs 100\.0% boosted \| open:/);
    expect(r.out).toContain(`boosted until ${until} by ${boostFile}, the ramp alone 85.4%`);
    expect(r.out).toContain('the ramp alone 68.0%');
    const g = gate();
    expect(g.code, g.out).toBe(0);
  });

  it('a window at 100% is still held under a 100% boost: a boost is not a blind admit', () => {
    write({ pct: 10, resetIn: 4 * HOUR, weekPct: 100, weekResetIn: 35 * HOUR });
    boost(`until=${iso(nowSec() + HOUR)}\ncap_7d=100\ncap_5h=100\n`);
    const r = cap();
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(/^closed 7d 100% vs 100\.0% boosted; 5h not judged \|/);
  });

  it('quota-health names the boost as the cap in force', () => {
    write(HELD);
    boost(`until=${iso(nowSec() + HOUR)}\ncap_7d=100\ncap_5h=100\n`);
    const r = run(['--quota-health']);
    expect(r.out).toMatch(/Cap in force: 5h 100\.0% boosted until .*; 7d 100\.0% boosted until /);
  });
});

describe('in72 B5: a boost must end soon', () => {
  it('until more than 8 days off is ignored, and the line says why', () => {
    write(HELD);
    boost(`until=${iso(nowSec() + 9 * DAY)}\ncap_7d=100\n`);
    const r = cap();
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(RAMP_LINE);
    expect(r.out).toMatch(/IGNORED: until=.* is more than 8 days off/);
  });

  it('until 7 days off is accepted', () => {
    write(HELD);
    boost(`until=${iso(nowSec() + 7 * DAY)}\ncap_7d=100\ncap_5h=100\n`);
    expect(cap().code).toBe(0);
  });
});
