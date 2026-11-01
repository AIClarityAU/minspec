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
 * The same file's `ceiling_7d` (in81) has its own block at the end.
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

/**
 * T0 (in81) - a boost file can also hold the weekly cap AT a figure.
 *
 * THE ASK. The founder, 2026-11-02: "burn up the remaining quota now, up to 95%, leaving the
 * last 5% for host-side work." A boost only raises, and the weekly ramp passes 95 twelve
 * hours before the reset, so nothing could keep that 5%. `ceiling_7d` can, until `until`.
 *
 * Fixtures vary time left and usage, because the cap stops being monotonic toward the reset
 * here, and that is where a sleep answer would go wrong.
 */
// The gate has always called the weekly window "the WEEKLY ceiling", so a bare /ceiling/
// would match every weekly hold. These are the words only the boost file's key produces.
const NAMES_FILE_CEILING = /ceiling_7d|% ceiling|ramp and boost without it/;

describe('in81 C1: the ceiling beats the ramp', () => {
  // Ramp figures: 100 - 10 x days left. 7.2 h left is 97.0, 3 h is 98.7, 11 h is 95.4.
  it.each([
    { left: 7.2, ramp: '97.0' },
    { left: 3, ramp: '98.7' },
    { left: 11, ramp: '95.4' },
  ])('with $left h left the ramp says $ramp: holds at 95 and 96 used, admits at 94', ({ left, ramp }) => {
    const until = iso(nowSec() + left * HOUR);
    boost(`until=${until}\nceiling_7d=95\n`);

    write({ pct: 10, resetIn: 4 * HOUR, weekPct: 94, weekResetIn: left * HOUR });
    const open = cap();
    expect(open.code, open.out).toBe(0);
    expect(open.out).toMatch(/^open 7d 94% vs 95\.0% ceiling; 5h 10% vs /);
    expect(open.out).toContain(`95.0% ceiling until ${until} by ${boostFile}`);
    expect(open.out).toMatch(new RegExp(`the ramp and boost without it ${ramp.replace('.', '\\.')}%`));

    for (const used of [95, 96]) {
      write({ pct: 10, resetIn: 4 * HOUR, weekPct: used, weekResetIn: left * HOUR });
      const held = cap();
      expect(held.code, held.out).toBe(42);
      expect(held.out).toMatch(new RegExp(`^closed 7d ${used}% vs 95\\.0% ceiling; 5h not judged \\|`));
      expect(gate().code).toBe(42);
    }
  });

  it('a ceiling above the ramp changes nothing, and the line does not name it', () => {
    write(HELD); // the ramp is 85.4
    boost(`until=${iso(nowSec() + HOUR)}\nceiling_7d=95\n`);
    const r = cap();
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(RAMP_LINE);
    expect(r.out).not.toMatch(NAMES_FILE_CEILING);
  });

  it('a ceiling equal to the ramp is not what decided', () => {
    // 24 h left is a ramp of exactly 90.0.
    write({ pct: 10, resetIn: 4 * HOUR, weekPct: 50, weekResetIn: 24 * HOUR });
    boost(`until=${iso(nowSec() + HOUR)}\nceiling_7d=90\n`);
    const r = cap();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/^open 7d 50% vs (89\.9|90\.0)% ramped;/);
  });

  it('a ceiling below the ramp lowers it, however far off the reset is', () => {
    write({ pct: 10, resetIn: 4 * HOUR, weekPct: 82, weekResetIn: 35 * HOUR }); // ramp 85.4
    boost(`until=${iso(nowSec() + HOUR)}\nceiling_7d=80\n`);
    const r = cap();
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(/^closed 7d 82% vs 80\.0% ceiling; 5h not judged \|/);
  });

  it('ceiling_7d=0 is a cap like any other: it holds 0% used', () => {
    write({ pct: 10, resetIn: 4 * HOUR, weekPct: 0, weekResetIn: 35 * HOUR });
    boost(`until=${iso(nowSec() + HOUR)}\nceiling_7d=0\n`);
    const r = cap();
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(/^closed 7d 0% vs 0\.0% ceiling;/);
  });

  it('only the weekly window: the 5h cap stays on its ramp', () => {
    write({ pct: 90, resetIn: 4 * HOUR, weekPct: 10, weekResetIn: 3 * HOUR });
    boost(`until=${iso(nowSec() + HOUR)}\nceiling_7d=50\n`);
    const r = cap();
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(/^closed 7d 10% vs 50\.0% ceiling; 5h 90% vs 68\.0% ramped \|/);
  });

  it('quota-health names the ceiling as the cap in force', () => {
    write({ pct: 10, resetIn: 4 * HOUR, weekPct: 50, weekResetIn: 3 * HOUR });
    boost(`until=${iso(nowSec() + HOUR)}\nceiling_7d=95\n`);
    expect(run(['--quota-health']).out).toMatch(/; 7d 95\.0% ceiling until /);
  });

  it('a reading with no weekly window says the ceiling was not applied', () => {
    write({ pct: 10, resetIn: 4 * HOUR });
    boost(`until=${iso(nowSec() + HOUR)}\nceiling_7d=95\n`);
    const r = cap();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/reports NO weekly window, so the ceiling_7d of 95% .* was not applied/);
  });
});

describe('in81 C2: cap_7d and ceiling_7d together, the file the founder asked for', () => {
  const file = (until: string) => `until=${until}\ncap_7d=95\nceiling_7d=95\ncap_5h=100\n`;

  it('days from the reset the boost lifts the cap to 95, and it stays a boost', () => {
    const t = nowSec();
    boost(file(iso(t + 3 * DAY)));
    write({ pct: 10, resetIn: 4 * HOUR, weekPct: 94, weekResetIn: 3 * DAY }); // ramp 70
    const open = cap();
    expect(open.code, open.out).toBe(0);
    expect(open.out).toMatch(/^open 7d 94% vs 95\.0% boosted;/);
    write({ pct: 10, resetIn: 4 * HOUR, weekPct: 95, weekResetIn: 3 * DAY });
    const held = cap();
    expect(held.code, held.out).toBe(42);
    expect(held.out).toMatch(/^closed 7d 95% vs 95\.0% boosted;/);
  });

  it('in the last 12 hours, where the ramp passes 95, the ceiling keeps it at 95', () => {
    const t = nowSec();
    boost(file(iso(t + 7 * HOUR)));
    write({ pct: 10, resetIn: 4 * HOUR, weekPct: 94, weekResetIn: 7 * HOUR });
    expect(cap().out).toMatch(/^open 7d 94% vs 95\.0% ceiling;/);
    write({ pct: 10, resetIn: 4 * HOUR, weekPct: 95, weekResetIn: 7 * HOUR });
    const held = cap();
    expect(held.code, held.out).toBe(42);
    expect(held.out).toMatch(/^closed 7d 95% vs 95\.0% ceiling;/);
  });

  it('a ceiling under the boost wins', () => {
    boost(`until=${iso(nowSec() + 3 * DAY)}\ncap_7d=100\nceiling_7d=95\n`);
    write({ pct: 10, resetIn: 4 * HOUR, weekPct: 95, weekResetIn: 3 * DAY });
    const r = cap();
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(/^closed 7d 95% vs 95\.0% ceiling;/);
    expect(r.out).toContain('the ramp and boost without it 100.0%');
  });

  it('a ceiling over the boost leaves the boost in force', () => {
    boost(`until=${iso(nowSec() + 3 * DAY)}\ncap_7d=90\nceiling_7d=95\n`);
    write({ pct: 10, resetIn: 4 * HOUR, weekPct: 89, weekResetIn: 3 * DAY });
    expect(cap().out).toMatch(/^open 7d 89% vs 90\.0% boosted;/);
  });
});

describe('in81 C3: the ceiling ends by itself', () => {
  it('the same file, one second past its until, gives the ramp back', () => {
    write({ pct: 10, resetIn: 4 * HOUR, weekPct: 95, weekResetIn: 7.2 * HOUR }); // ramp 97
    boost(`until=${iso(nowSec() + HOUR)}\nceiling_7d=95\n`);
    expect(cap().code).toBe(42);
    boost(`until=${iso(nowSec() - 1)}\nceiling_7d=95\n`);
    const off = cap();
    expect(off.code, off.out).toBe(0);
    expect(off.out).toMatch(/^open 7d 95% vs 97\.0% ramped;/);
    expect(off.out).not.toMatch(/IGNORED/);
    expect(off.out).not.toMatch(NAMES_FILE_CEILING);
    expect(gate().code).toBe(0);
  });
});

describe('in81 C4: a fixed cap is never moved', () => {
  it('a fixed cap above the ceiling stays, and the line does not name the ceiling', () => {
    write({ pct: 10, resetIn: 4 * HOUR, weekPct: 96, weekResetIn: 7 * HOUR });
    boost(`until=${iso(nowSec() + HOUR)}\nceiling_7d=95\n`);
    const r = cap({ MINSPEC_QUOTA_ADMIT_PCT_7D: '98' });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/^open 7d 96% vs 98\.0% fixed;/);
    expect(r.out).not.toMatch(NAMES_FILE_CEILING);
  });

  it('held by a fixed cap, the wait is the reset: until does not release a fixed cap', () => {
    const t = nowSec();
    fs.writeFileSync(quotaFile, readingJson({ pct: 10, resetIn: 4 * HOUR, weekPct: 96, weekResetIn: 7 * HOUR }, t));
    boost(`until=${iso(t + HOUR)}\nceiling_7d=95\n`);
    const g = gate({ MINSPEC_QUOTA_ADMIT_PCT_7D: '90' });
    expect(g.code, g.out).toBe(42);
    const secs = Number(/^defer:(\d+) /.exec(g.out)?.[1]);
    expect(Math.abs(secs - 7 * HOUR), g.out).toBeLessThanOrEqual(5);
    expect(g.out).not.toMatch(NAMES_FILE_CEILING);
  });
});

describe('in81 C5: a bad ceiling means the whole file is ignored, said aloud', () => {
  it.each([
    { val: '101', says: /ceiling_7d=101 is not a whole percent/ },
    { val: '9.5', says: /ceiling_7d=9\.5 is not a whole percent/ },
    { val: '95%', says: /ceiling_7d=95% is not a whole percent/ },
    { val: '-1', says: /ceiling_7d=-1 is not a whole percent/ },
    { val: 'high', says: /ceiling_7d=high is not a whole percent/ },
    { val: '', says: /ceiling_7d='' is not a whole percent/ },
  ])('ceiling_7d=$val also drops the raise beside it', ({ val, says }) => {
    write(HELD);
    boost(`until=${iso(nowSec() + HOUR)}\ncap_7d=100\nceiling_7d=${val}\n`);
    const r = cap();
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(RAMP_LINE);
    expect(r.out).toMatch(/quota boost .* IGNORED: /);
    expect(r.out).toMatch(says);
    expect(r.out.trim().split('\n')).toHaveLength(1);
  });

  it('a file holding only ceiling_7d and until is valid, and sets no raise', () => {
    write(HELD);
    boost(`until=${iso(nowSec() + HOUR)}\nceiling_7d=95\n`);
    const r = cap();
    expect(r.out).not.toMatch(/IGNORED/);
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(RAMP_LINE);
  });

  it('ceiling_7d with no until is the same fault as a cap with none', () => {
    write(HELD);
    boost('ceiling_7d=95\n');
    const r = cap();
    expect(r.out).toMatch(/IGNORED: until=.* is not a UTC time/);
  });

  it('a file with no key that does anything still says so', () => {
    write(HELD);
    boost(`until=${iso(nowSec() + HOUR)}\n`);
    expect(cap().out).toMatch(/sets neither cap_5h nor cap_7d nor ceiling_7d/);
  });
});

describe('in81 C6: the wait and the sleep are true while a ceiling holds', () => {
  // Every case judges a hold, from one instant, so the seconds can be checked to a tolerance.
  const judged = (r: Reading, file: (t: number) => string, env: Record<string, string> = {}) => {
    const t = nowSec();
    fs.writeFileSync(quotaFile, readingJson(r, t));
    boost(file(t));
    const g = gate(env);
    expect(g.code, g.out).toBe(42);
    const wait = Number(/^defer:(\d+) /.exec(g.out)?.[1]);
    const sleep = Number(run(['--quota-sleep'], env).out.trim());
    return { text: g.out, wait, sleep };
  };
  const near = (got: number, want: number, within = 90) =>
    expect(Math.abs(got - want), `${got} vs ${want}`).toBeLessThanOrEqual(within);
  const MARGIN = 15;
  // A hold is at or above the cap and the cap moves in tenths, so a ramp admits a usage one
  // tenth past it: 0.1% of the 10%/day ramp is 864 seconds later than the plain crossing.
  const TENTH = 864;

  it.each([
    { name: '3 h left', left: 3 * HOUR, used: 95, sleep: 3 * HOUR + MARGIN },
    { name: '3 h left, more used', left: 3 * HOUR, used: 99, sleep: 3 * HOUR + MARGIN },
    { name: '7 h left: clamped to one six-hour hop', left: 7 * HOUR, used: 95, sleep: 21600 },
    { name: '11 h left', left: 11 * HOUR, used: 96, sleep: 21600 },
  ])('until at the reset, $name: the wait is the reset and no ramp time is named', ({ left, used, sleep }) => {
    const r = judged(
      { pct: 10, resetIn: 4 * HOUR, weekPct: used, weekResetIn: left },
      (t) => `until=${iso(t + left)}\ncap_7d=95\nceiling_7d=95\n`,
    );
    near(r.wait, left, 5);
    near(r.sleep, sleep, 5);
    expect(r.text).not.toMatch(/next admits/);
    expect(r.text).toContain('ceiling until');
  });

  it('until past the reset: still the reset, the first moment anything can change', () => {
    const r = judged(
      { pct: 10, resetIn: 4 * HOUR, weekPct: 95, weekResetIn: 3 * HOUR },
      (t) => `until=${iso(t + 9 * HOUR)}\nceiling_7d=95\n`,
    );
    near(r.wait, 3 * HOUR, 5);
    near(r.sleep, 3 * HOUR + MARGIN, 5);
    expect(r.text).not.toMatch(/next admits/);
  });

  it('until before the reset, and the ramp already past this usage: the wait is until', () => {
    // 10 h left, ramp 95.8 now and 96.6 at until, 95 used.
    const r = judged(
      { pct: 10, resetIn: 4 * HOUR, weekPct: 95, weekResetIn: 10 * HOUR },
      (t) => `until=${iso(t + 2 * HOUR)}\nceiling_7d=95\n`,
    );
    near(r.wait, 2 * HOUR, 5);
    near(r.sleep, 2 * HOUR + MARGIN, 5);
    expect(r.text).toMatch(/the ceiling_7d holds until .*, when the ramp admits, in 2\.0 h/);
  });

  it('until before the reset, and the ramp past this usage only later: the wait is the ramp', () => {
    // 10 h left, 98 used: the ramp reaches 98.1 about 5.4 h from now, well after until.
    const r = judged(
      { pct: 10, resetIn: 4 * HOUR, weekPct: 98, weekResetIn: 10 * HOUR },
      (t) => `until=${iso(t + 2 * HOUR)}\nceiling_7d=95\n`,
    );
    near(r.wait, 5.2 * HOUR + TENTH);
    near(r.sleep, 5.2 * HOUR + TENTH + MARGIN);
    expect(r.text).toMatch(/the ramp next admits in 5\.4 h/);
  });

  it('until before the reset, and 100% used: only the reset admits', () => {
    const r = judged(
      { pct: 10, resetIn: 4 * HOUR, weekPct: 100, weekResetIn: 5 * HOUR },
      (t) => `until=${iso(t + 2 * HOUR)}\nceiling_7d=95\n`,
    );
    near(r.wait, 5 * HOUR, 5);
    near(r.sleep, 5 * HOUR + MARGIN, 5);
    expect(r.text).not.toMatch(/next admits|holds until/);
  });

  it('under the ceiling and over the ramp: the ramp still decides the wait', () => {
    // 35 h left, ramp 85.4, 90 used, ceiling 95: the ramp reaches 90.1 about 11.2 h from now.
    const r = judged(
      { pct: 10, resetIn: 4 * HOUR, weekPct: 90, weekResetIn: 35 * HOUR },
      (t) => `until=${iso(t + 35 * HOUR)}\nceiling_7d=95\n`,
    );
    near(r.wait, 11 * HOUR + TENTH);
    near(r.sleep, 21600, 5);
    expect(r.text).toMatch(/the ramp next admits in 11\.2 h/);
  });

  it('over the ceiling and over the ramp, the ramp the later of the two: no admit before it', () => {
    // 5 days left, ramp 60 (the floor), 96 used, ceiling 95 for an hour: the ramp passes 96
    // with 9.6 h left. The ceiling is not what decides now and the until is no answer.
    const r = judged(
      { pct: 10, resetIn: 4 * HOUR, weekPct: 96, weekResetIn: 5 * DAY },
      (t) => `until=${iso(t + HOUR)}\nceiling_7d=95\n`,
    );
    near(r.wait, 5 * DAY - 9.6 * HOUR + TENTH);
    near(r.sleep, 21600, 5);
    expect(r.text).not.toMatch(/holds until/);
  });

  it('the boost ends at until too, so it is no reason to call that moment an admit', () => {
    // 3 days left, 92 used, cap_7d=100 and ceiling_7d=90 for an hour. From until on only the
    // ramp is left, and it reaches 92.1 with about 19 h to go, not at until.
    const r = judged(
      { pct: 10, resetIn: 4 * HOUR, weekPct: 92, weekResetIn: 3 * DAY },
      (t) => `until=${iso(t + HOUR)}\ncap_7d=100\nceiling_7d=90\n`,
    );
    near(r.wait, 3 * DAY - 19.2 * HOUR + TENTH);
    near(r.sleep, 21600, 5);
    expect(r.text).toMatch(/the ramp next admits in /);
    expect(r.text).not.toMatch(/holds until/);
  });

  it('a ceiling above the usage it never reaches is no reason to wait past the ramp', () => {
    // 10 h left, 96 used, ceiling 98: the ramp 95.8 holds, and reaches 96.1 in about 38 min.
    const r = judged(
      { pct: 10, resetIn: 4 * HOUR, weekPct: 96, weekResetIn: 10 * HOUR },
      (t) => `until=${iso(t + 10 * HOUR)}\nceiling_7d=98\n`,
    );
    near(r.wait, 24 * 60 + TENTH);
    near(r.sleep, 24 * 60 + TENTH + MARGIN);
  });

  it('never a tight loop: at the ceiling with seconds left the sleep is the minimum', () => {
    const r = judged(
      { pct: 10, resetIn: 4 * HOUR, weekPct: 95, weekResetIn: 5 },
      (t) => `until=${iso(t + 5)}\nceiling_7d=95\n`,
    );
    expect(r.sleep).toBe(60);
  });
});
