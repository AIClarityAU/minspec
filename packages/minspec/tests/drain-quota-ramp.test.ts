/**
 * T0/T1 (#2514) - the admission cap ramps toward each window's reset, unless it is fixed.
 *
 * THE REQUEST. "the drain cap should ramp up over the week, allowing headroom. perhaps 60%
 * until the second last day of the 7d window, then 80%, then on the last day change to
 * 95%, then in the last hour make it 100%. or hopefully you've got a smarter way to ramp
 * it up more smoothly. similar type of thing inside the 5h windows." (founder, 2026-10-03)
 *
 * THE RULE THAT WAS ACCEPTED. Hold back a reserve that shrinks as the reset approaches:
 *
 *     cap = min(100, max(floor, 100 - rate * time left))
 *
 *   weekly: floor 60, 10% per day    -> 60 until four days are left, 70 at three, 80 at two,
 *                                       90 at one, 95 at twelve hours, above 99 in the last hour
 *   5h:     floor 60,  8% per hour   -> 60 until five hours are left, 92 with one hour left
 *
 * WHAT THIS FILE PINS, in the order a mistake would cost:
 *   R1  a FIXED cap still wins, per window, and means exactly what it meant. The live drain
 *       is paused with MINSPEC_QUOTA_ADMIT_PCT_7D=0; a ramp that ignored that would
 *       un-pause it.
 *   R2  the ramp never opens a path the gate did not have: no reading, a stale reading and
 *       an unusable knob all still hold (constitution invariant 2).
 *   R3  the numbers above, at the boundary: the last usage that is admitted and the first
 *       that is not, for both windows, including no reset time (the floor).
 *   R4  the cap that decided is the cap that is printed, with its mode, on the verdict and
 *       on the health line, so the ramp is read off the log and not inferred.
 *   R5  the sleep after a hold ends when the ramp would next admit, not at the reset. A
 *       ramp that rises during a six-hour sleep is otherwise never seen.
 *   R6  the week that just ended does not hold the one that just began: a reading whose
 *       weekly reset has passed is taken again before it is judged.
 *
 * Fixed caps have their own, older file: drain-quota-deadline.test.ts pins both and has
 * not had an assertion changed by this work.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { drainBaseEnv, useHostileAmbientDrainKnobs } from './helpers/drain-env';
import { DRAIN, cleanupDrains, readingJson, runLoop, type Reading } from './helpers/drain-harness';
import { useShellTimeout } from './helpers/shell-timeout';

// Module scope, never a hook: vitest resolves timeouts before beforeAll runs (#1399).
useShellTimeout();
// Every verdict below is the DEFAULT one, so an inherited cap would change all of them.
// The file runs with both caps set to 0 in the surrounding environment (#2574).
useHostileAmbientDrainKnobs();

const nowSec = () => Math.floor(Date.now() / 1000);
const HOUR = 3600;
const DAY = 86400;

let tmpDir: string;
let quotaFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-ramp-'));
  quotaFile = path.join(tmpDir, 'quota.json');
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  cleanupDrains();
});

interface Out {
  code: number;
  out: string;
}

/** Run one seam with NO cap set unless the test sets one: the ramp is the default. */
function run(args: string[], env: Record<string, string> = {}): Out {
  try {
    const out = execFileSync('bash', [DRAIN, ...args], {
      encoding: 'utf-8',
      stdio: 'pipe',
      env: { ...drainBaseEnv(), MINSPEC_QUOTA_FILE: quotaFile, MINSPEC_QUOTA_REFRESH: '0', ...env },
    });
    return { code: 0, out: out.trim() };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() };
  }
}

const write = (r: Reading) => fs.writeFileSync(quotaFile, readingJson(r, nowSec()));
const gate = (r: Reading, env: Record<string, string> = {}): Out => {
  write(r);
  return run(['--quota-gate'], env);
};
const sleepSecs = (r: Reading, env: Record<string, string> = {}): number => {
  write(r);
  return Number(run(['--quota-sleep'], env).out);
};

/** A 5h reading far below any cap, so a weekly row is decided by the weekly window alone. */
const QUIET_5H = { pct: 0, resetIn: HOUR };

describe('#2514 R3: the weekly ramp, at the boundary', () => {
  it.each([
    { when: 'five days left: the floor', left: 5 * DAY, cap: '60.0', admits: 59, defers: 60 },
    { when: 'four days left: still the floor', left: 4 * DAY, cap: '60.0', admits: 59, defers: 60 },
    { when: 'three days left', left: 3 * DAY, cap: '70.0', admits: 69, defers: 70 },
    { when: 'two days left (his "second last day": 80)', left: 2 * DAY, cap: '80.0', admits: 79, defers: 80 },
    { when: 'one day left', left: DAY, cap: '90.0', admits: 89, defers: 90 },
    { when: 'twelve hours left (his "last day": 95)', left: 12 * HOUR, cap: '95.0', admits: 94, defers: 95 },
    { when: 'the last hour (his 100: only a spent window is held)', left: HOUR, cap: '99.5', admits: 99, defers: 100 },
    { when: 'the last minute', left: 60, cap: '99.9', admits: 99, defers: 100 },
  ])('$when: cap $cap%, $admits% is admitted and $defers% is not', ({ left, cap, admits, defers }) => {
    const open = gate({ ...QUIET_5H, weekPct: admits, weekResetIn: left });
    expect(open.code, open.out).toBe(0);
    expect(open.out).toContain(`7d window ${admits}% used, cap ${cap}% ramped`);

    const held = gate({ ...QUIET_5H, weekPct: defers, weekResetIn: left });
    expect(held.code, held.out).toBe(42);
    expect(held.out).toMatch(new RegExp(`^defer:\\d+ \\(7d window ${defers}% used[^)]*cap ${cap.replace('.', '\\.')}% ramped`));
    expect(held.out).toMatch(/WEEKLY/);
  });

  it.each([
    { what: 'no weekly reset time in the reading', weekResetIn: undefined },
    { what: 'a weekly reset time that has already passed', weekResetIn: -10 },
  ])('$what: the cap is the floor, and the verdict says why', ({ weekResetIn }) => {
    const open = gate({ ...QUIET_5H, weekPct: 59, weekResetIn });
    expect(open.code, open.out).toBe(0);
    expect(open.out).toMatch(/7d window 59% used, cap 60\.0% ramped: no reset time/);

    const held = gate({ ...QUIET_5H, weekPct: 60, weekResetIn });
    expect(held.code, held.out).toBe(42);
    expect(held.out).toMatch(/no usable reset time/);
    expect(held.out).toMatch(/cap 60\.0% ramped: no reset time/);
  });
});

describe('#2514 R3: the 5h ramp, at the boundary', () => {
  it.each([
    { when: 'six hours left (more than a window: the floor)', left: 6 * HOUR, cap: '60.0', admits: 59, defers: 60 },
    { when: 'five hours left: the floor', left: 5 * HOUR, cap: '60.0', admits: 59, defers: 60 },
    { when: 'four hours left', left: 4 * HOUR, cap: '68.0', admits: 67, defers: 68 },
    { when: 'two and a half hours left', left: 2.5 * HOUR, cap: '80.0', admits: 79, defers: 80 },
    { when: 'one hour left', left: HOUR, cap: '92.0', admits: 91, defers: 92 },
    { when: 'thirty minutes left', left: HOUR / 2, cap: '96.0', admits: 95, defers: 96 },
    { when: 'ninety seconds left', left: 90, cap: '99.8', admits: 99, defers: 100 },
  ])('$when: cap $cap%, $admits% is admitted and $defers% is not', ({ left, cap, admits, defers }) => {
    const open = gate({ pct: admits, resetIn: left });
    expect(open.code, open.out).toBe(0);
    expect(open.out).toContain(`open:${admits}% of the 5h window used, cap ${cap}% ramped`);

    const held = gate({ pct: defers, resetIn: left });
    expect(held.code, held.out).toBe(42);
    expect(held.out).toMatch(new RegExp(`^defer:\\d+ \\(5h window ${defers}% used[^)]*cap ${cap.replace('.', '\\.')}% ramped`));
  });

  it('reads the file as the live producer writes it: percentages as floats with a trailing .0', () => {
    // JSON.stringify drops the ".0", so every other fixture here is an integer. The
    // producer (cos.py) writes floats, and this is its file from 2026-10-06 with the
    // times made relative: 5h 2.0%, weekly 81.0% with 1.81 days left. The weekly cap
    // there is 81.9%, so 81.0 is admitted and 82.0 is not.
    const live = (week: string) =>
      fs.writeFileSync(
        quotaFile,
        `{"used_percentage":2.0,"resets_at":${nowSec() + 16494},"observed_at":${nowSec()},"source":"oauth",` +
          `"seven_day_percentage":${week},"seven_day_resets_at":${nowSec() + 156294}}`,
      );
    live('81.0');
    const open = run(['--quota-gate']);
    expect(open.code, open.out).toBe(0);
    expect(open.out).toContain('7d window 81% used, cap 81.9% ramped');
    live('82.0');
    expect(run(['--quota-gate']).code).toBe(42);
  });

  it('a window reported as over 100% used is held, and waits for the reset', () => {
    const r = gate({ ...QUIET_5H, weekPct: 103, weekResetIn: HOUR });
    expect(r.code).toBe(42);
    expect(r.out).not.toMatch(/next admits/);
  });

  it('a 5h window whose reset has passed is still admitted as reset, whatever it says it used', () => {
    // Unchanged behaviour: the window turned over, so its old percentage describes nothing.
    const r = gate({ pct: 99, resetIn: -60 });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^open:window-reset/);
  });
});

describe('#2514: the four ramp numbers are knobs', () => {
  interface KnobRow {
    knob: string;
    value: string;
    reading: Reading;
    /** The verdict with the knob set: 0 admits, 42 holds. Without it the verdict is the other one. */
    tuned: 0 | 42;
    names: RegExp;
  }
  const rows: KnobRow[] = [
    // A lower floor is a lower cap early in the week: 55% is held at 50, admitted at 60.
    { knob: 'MINSPEC_QUOTA_RAMP_FLOOR_7D', value: '40', reading: { ...QUIET_5H, weekPct: 55, weekResetIn: 5 * DAY }, tuned: 42, names: /7d window 55% used[^)]*cap 50\.0% ramped/ },
    // A slower ramp holds back less: two days out the cap is 90, not 80.
    { knob: 'MINSPEC_QUOTA_RAMP_PER_DAY_7D', value: '5', reading: { ...QUIET_5H, weekPct: 89, weekResetIn: 2 * DAY }, tuned: 0, names: /7d window 89% used, cap 90\.0% ramped/ },
    { knob: 'MINSPEC_QUOTA_RAMP_FLOOR', value: '80', reading: { pct: 79, resetIn: 5 * HOUR }, tuned: 0, names: /of the 5h window used, cap 80\.0% ramped/ },
    { knob: 'MINSPEC_QUOTA_RAMP_PER_HOUR', value: '4', reading: { pct: 89, resetIn: 2.5 * HOUR }, tuned: 0, names: /of the 5h window used, cap 90\.0% ramped/ },
    // Nothing held back at all: the top of the rule, min(100, ...). Only a spent window is held.
    { knob: 'MINSPEC_QUOTA_RAMP_PER_DAY_7D', value: '0', reading: { ...QUIET_5H, weekPct: 99, weekResetIn: 5 * DAY }, tuned: 0, names: /7d window 99% used, cap 100\.0% ramped/ },
    { knob: 'MINSPEC_QUOTA_RAMP_PER_HOUR', value: '0', reading: { pct: 99, resetIn: 5 * HOUR }, tuned: 0, names: /of the 5h window used, cap 100\.0% ramped/ },
  ];
  it.each(rows)('$knob=$value moves the cap', ({ knob, value, reading, tuned, names }) => {
    const withKnob = gate(reading, { [knob]: value });
    expect(withKnob.code, withKnob.out).toBe(tuned);
    expect(withKnob.out).toMatch(names);
    // CONTROL: without the knob the same reading gets the other verdict, so it is the
    // knob that moved the cap and not the reading that happened to sit under it.
    expect(gate(reading).code).toBe(tuned === 0 ? 42 : 0);
  });

  it('the verdict names the rate and the floor in force, not only the result', () => {
    const r = gate({ pct: 10, resetIn: HOUR }, { MINSPEC_QUOTA_RAMP_PER_HOUR: '4', MINSPEC_QUOTA_RAMP_FLOOR: '70' });
    expect(r.out).toContain('cap 96.0% ramped: 4%/hour held back');
    expect(r.out).toContain('floor 70%');
  });
});

describe('#2514 R1: a cap that is SET is fixed, per window, and wins over the ramp', () => {
  it('weekly: MINSPEC_QUOTA_ADMIT_PCT_7D=95 with five days left admits 94 and holds 95 (the ramp would hold both at 60)', () => {
    const env = { MINSPEC_QUOTA_ADMIT_PCT_7D: '95' };
    const open = gate({ ...QUIET_5H, weekPct: 94, weekResetIn: 5 * DAY }, env);
    expect(open.code, open.out).toBe(0);
    expect(open.out).toContain('7d window 94% used, cap 95% fixed by MINSPEC_QUOTA_ADMIT_PCT_7D');
    // The 5h window was left unset, so it still ramps: each window picks its own mode.
    expect(open.out).toContain('of the 5h window used, cap 92.0% ramped');

    const held = gate({ ...QUIET_5H, weekPct: 95, weekResetIn: 5 * DAY }, env);
    expect(held.code).toBe(42);
    expect(held.out).toMatch(/7d window 95% used[^)]*cap 95% fixed by MINSPEC_QUOTA_ADMIT_PCT_7D/);
    // CONTROL: unset, the ramp holds 94 with five days left.
    expect(gate({ ...QUIET_5H, weekPct: 94, weekResetIn: 5 * DAY }).code).toBe(42);
  });

  it('5h: MINSPEC_QUOTA_ADMIT_PCT=90 with five hours left admits 89 and holds 90 (the ramp would hold both at 60)', () => {
    const env = { MINSPEC_QUOTA_ADMIT_PCT: '90' };
    const open = gate({ pct: 89, resetIn: 5 * HOUR }, env);
    expect(open.code, open.out).toBe(0);
    expect(open.out).toContain('of the 5h window used, cap 90% fixed by MINSPEC_QUOTA_ADMIT_PCT');
    expect(gate({ pct: 90, resetIn: 5 * HOUR }, env).code).toBe(42);
    expect(gate({ pct: 89, resetIn: 5 * HOUR }).code).toBe(42);
  });

  it('a fixed cap BELOW the ramp wins too: it is an override, not a ceiling on the ramp', () => {
    // One hour left: the ramp would allow 92. A fixed 40 holds at 40.
    expect(gate({ pct: 40, resetIn: HOUR }).code).toBe(0);
    const held = gate({ pct: 40, resetIn: HOUR }, { MINSPEC_QUOTA_ADMIT_PCT: '40' });
    expect(held.code).toBe(42);
    expect(held.out).toContain('cap 40% fixed by MINSPEC_QUOTA_ADMIT_PCT');
  });

  it('a fixed cap does not move as the reset nears', () => {
    const env = { MINSPEC_QUOTA_ADMIT_PCT_7D: '60' };
    for (const left of [5 * DAY, DAY, HOUR, 60]) {
      expect(gate({ ...QUIET_5H, weekPct: 60, weekResetIn: left }, env).code, `${left}s left`).toBe(42);
      expect(gate({ ...QUIET_5H, weekPct: 59, weekResetIn: left }, env).code, `${left}s left`).toBe(0);
    }
  });

  const zeroCaps: Array<{ window: string; env: Record<string, string>; reading: Reading }> = [
    { window: 'weekly', env: { MINSPEC_QUOTA_ADMIT_PCT_7D: '0' }, reading: { ...QUIET_5H, weekPct: 0, weekResetIn: 3 * DAY } },
    { window: '5h', env: { MINSPEC_QUOTA_ADMIT_PCT: '0' }, reading: { pct: 0, resetIn: HOUR } },
  ];
  it.each(zeroCaps)('a $window cap of 0 holds a 0% reading: 0 is a cap, not "unset"', ({ env, reading }) => {
    // The pause the live drain is using. `${VAR:-}` reads an EMPTY value as unset; a
    // change that treated 0 the same way would silently un-pause it.
    const held = gate(reading, env);
    expect(held.code, held.out).toBe(42);
    expect(held.out).toMatch(/cap 0% fixed by MINSPEC_QUOTA_ADMIT_PCT/);
    // CONTROL: the same reading with no cap set is admitted.
    expect(gate(reading).code).toBe(0);
  });

  it('a SET weekly cap that a reading gives nothing to hold against is not skipped in silence', () => {
    // Only some producers see the weekly window, so a reading without one is still
    // judged on the 5h window alone, exactly as before (#2586 is the open question of
    // whether it should be). What changed is that the admit says the cap was not applied:
    // a drain "paused" with a weekly cap of 0 that dispatches on such a reading used to
    // look, in the log, exactly like one that had honoured the cap.
    const env = { MINSPEC_QUOTA_ADMIT_PCT_7D: '0' };
    const r = gate({ pct: 3, resetIn: HOUR }, env);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/reports NO weekly window, so the weekly cap of 0% fixed by MINSPEC_QUOTA_ADMIT_PCT_7D was not applied/);
    expect(run(['--quota-health'], env).out).toMatch(/weekly cap of 0% fixed by MINSPEC_QUOTA_ADMIT_PCT_7D is NOT being applied/);
    // The same on the other admit there is, a 5h window that has reset.
    expect(gate({ pct: 3, resetIn: -60 }, env).out).toMatch(/^open:window-reset[^\n]*weekly cap of 0%[^\n]*was not applied/);
    // CONTROL: with no weekly cap set there is nothing to report, and nothing is.
    expect(gate({ pct: 3, resetIn: HOUR }).out).not.toMatch(/not applied/);
    expect(run(['--quota-health']).out).not.toMatch(/NOT being applied/);
    // CONTROL: with a weekly figure in the reading the cap is applied, and holds.
    expect(gate({ pct: 3, resetIn: HOUR, weekPct: 0, weekResetIn: DAY }, env).code).toBe(42);
  });

  it('an EMPTY cap variable is the same as none: that window ramps', () => {
    const r = gate({ pct: 91, resetIn: HOUR }, { MINSPEC_QUOTA_ADMIT_PCT: '' });
    expect(r.code).toBe(0);
    expect(r.out).toContain('cap 92.0% ramped');
  });

  it('a cap above 100 never holds that window, as before', () => {
    expect(gate({ pct: 100, resetIn: HOUR }, { MINSPEC_QUOTA_ADMIT_PCT: '101' }).code).toBe(0);
  });
});

describe('#2514 R2: the ramp opens no path the gate did not have (invariant 2)', () => {
  it('a STALE reading still holds, even one the ramp would admit', () => {
    const r = gate({ pct: 1, resetIn: 60, weekPct: 1, weekResetIn: 60, ageSec: 901 });
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/^defer:stale/);
  });

  it('NO reading still holds once the bootstrap allowance is spent, and is still admitted while it is not', () => {
    const none = run(['--quota-gate'], { MINSPEC_QUOTA_BOOTSTRAP_ADMITS: '0' });
    expect(none.code).toBe(42);
    expect(none.out).toMatch(/^defer:no-reading/);
    expect(run(['--quota-gate']).out).toMatch(/^open:bootstrap 1\/3/);
  });

  it('the weekly window still outranks a 5h window that has reset', () => {
    const r = gate({ pct: 5, resetIn: -60, weekPct: 99, weekResetIn: 3 * DAY });
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/WEEKLY/);
    expect(r.out).not.toMatch(/window-reset/);
  });

  it.each([
    { knob: 'MINSPEC_QUOTA_ADMIT_PCT', value: 'abc' },
    { knob: 'MINSPEC_QUOTA_ADMIT_PCT_7D', value: '6O' },
    { knob: 'MINSPEC_QUOTA_ADMIT_PCT_7D', value: '-5' },
    { knob: 'MINSPEC_QUOTA_ADMIT_PCT', value: '92.5' },
    { knob: 'MINSPEC_QUOTA_ADMIT_PCT_7D', value: '60%' },
    { knob: 'MINSPEC_QUOTA_RAMP_FLOOR', value: 'low' },
    { knob: 'MINSPEC_QUOTA_RAMP_FLOOR_7D', value: '101' },
    { knob: 'MINSPEC_QUOTA_RAMP_PER_HOUR', value: '0.5' },
    { knob: 'MINSPEC_QUOTA_RAMP_PER_DAY_7D', value: 'ten' },
  ])('an unusable $knob=$value holds everything and names the knob, instead of guessing a cap', ({ knob, value }) => {
    // The safe side of a cap nobody can read is to hold: whoever set it was trying to
    // restrict the drain, and falling back to a default could be looser than they meant.
    const r = gate({ pct: 0, resetIn: HOUR, weekPct: 0, weekResetIn: 3 * DAY }, { [knob]: value });
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(/^defer:bad-config /);
    expect(r.out).toContain(knob);
    // One line: this is the verdict channel.
    expect(r.out.split('\n')).toHaveLength(1);
    // Health says the same thing, and the sleep is still a bare integer.
    const health = run(['--quota-health'], { [knob]: value });
    expect(health.code).toBe(0);
    expect(health.out).toMatch(/^inert:/);
    expect(health.out).toContain(knob);
    expect(run(['--quota-sleep'], { [knob]: value }).out).toMatch(/^\d+$/);
  });

  it('an unusable knob is refused before the bootstrap allowance: no blind admit is spent on a misconfigured drain', () => {
    // No reading at all, the state the bootstrap allowance exists for. A drain that
    // cannot work out its cap is not "unobserved", it is misconfigured, and admitting it
    // blind would spend an allowance on a cycle no cap could then govern.
    const r = run(['--quota-gate'], { MINSPEC_QUOTA_ADMIT_PCT_7D: 'sixty' });
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/^defer:bad-config /);
    expect(fs.existsSync(`${quotaFile}.bootstrap`)).toBe(false);
    // CONTROL: the same empty state with a usable cap does take the bootstrap admit.
    expect(run(['--quota-gate'], { MINSPEC_QUOTA_ADMIT_PCT_7D: '60' }).out).toMatch(/^open:bootstrap 1\/3/);
  });

  it('a corrupt far-future reset with a very large rate still gets the floor, not an overflowed 100%', () => {
    // rate x seconds x 10 overflows 64 bits here (999999 x 1e12 x 10), and wrapped
    // negative it used to read as "nothing held back": a cap of 100% from garbage.
    const reading = { pct: 70, resetIn: 1e12 };
    const env = { MINSPEC_QUOTA_RAMP_PER_HOUR: '999999' };
    const r = gate(reading, env);
    expect(r.code, r.out).toBe(42);
    expect(r.out).toMatch(/5h window 70% used[^)]*cap 60\.0% ramped/);
    // CONTROL: a usage under the floor is still admitted on the same reading.
    expect(gate({ ...reading, pct: 59 }, env).code).toBe(0);
    // And the sleep is still a bare integer inside the clamp.
    expect(sleepSecs(reading, env)).toBe(6 * HOUR);
  });

  it('a knob with leading zeros is read as the decimal number it looks like', () => {
    // bash reads 08 as bad octal; a cap of "060" must be 60, not an error and not 48.
    expect(gate({ ...QUIET_5H, weekPct: 59, weekResetIn: DAY }, { MINSPEC_QUOTA_ADMIT_PCT_7D: '060' }).code).toBe(0);
    expect(gate({ ...QUIET_5H, weekPct: 60, weekResetIn: DAY }, { MINSPEC_QUOTA_ADMIT_PCT_7D: '060' }).code).toBe(42);
    expect(gate({ pct: 8, resetIn: HOUR }, { MINSPEC_QUOTA_ADMIT_PCT: '08' }).code).toBe(42);
    expect(gate({ pct: 7, resetIn: HOUR }, { MINSPEC_QUOTA_ADMIT_PCT: '08' }).code).toBe(0);
  });

  it('T0: the signal veto still agrees with the gate, reading for reading, under the ramp', () => {
    // One predicate, two consumers (#2233). The ramp changed the predicate; the veto must
    // have changed with it, or a text signal could be "contradicted" by a meter the gate
    // itself would not admit on.
    const readings: Reading[] = [
      { pct: 0, resetIn: HOUR },
      { pct: 91, resetIn: HOUR },
      { pct: 92, resetIn: HOUR },
      { pct: 59, resetIn: 5 * HOUR },
      { pct: 60, resetIn: 5 * HOUR },
      { pct: 100, resetIn: -60 },
      { pct: 0, resetIn: HOUR, ageSec: 901 },
      { pct: 0, resetIn: HOUR, weekPct: 69, weekResetIn: 3 * DAY },
      { pct: 0, resetIn: HOUR, weekPct: 70, weekResetIn: 3 * DAY },
      { pct: 0, resetIn: HOUR, weekPct: 99, weekResetIn: HOUR },
      { pct: 5, resetIn: -60, weekPct: 99, weekResetIn: 3 * DAY },
    ];
    let admitted = 0;
    for (const r of readings) {
      const admits = gate(r, { MINSPEC_QUOTA_BOOTSTRAP_ADMITS: '0' }).code === 0;
      const veto = run(['--quota-signal-sleep']).out.split(/\s+/)[1];
      expect(veto === 'contradicted', `reading ${JSON.stringify(r)}: gate admits=${admits}, veto=${veto}`).toBe(admits);
      if (admits) admitted++;
    }
    expect(admitted).toBeGreaterThan(0);
    expect(admitted).toBeLessThan(readings.length);
  });
});

describe('#2514 R4: the health line names the cap in force and its mode', () => {
  it('live, both windows ramped', () => {
    write({ pct: 42, resetIn: HOUR, weekPct: 61, weekResetIn: 3 * DAY });
    const h = run(['--quota-health']).out;
    expect(h).toMatch(/^live: 5h window 42% used/);
    expect(h).toContain('7d window 61% used');
    expect(h).toMatch(/Cap in force: 5h 92\.0% ramped: 8%\/hour held back, [^;]*floor 60%; 7d 70\.0% ramped: 10%\/day held back, 3\.0 days to reset, floor 60%/);
  });

  it('live, one fixed and one ramped: the mode is per window', () => {
    write({ pct: 42, resetIn: HOUR, weekPct: 61, weekResetIn: 3 * DAY });
    const h = run(['--quota-health'], { MINSPEC_QUOTA_ADMIT_PCT_7D: '0' }).out;
    expect(h).toMatch(/Cap in force: 5h 92\.0% ramped[^;]*; 7d 0% fixed by MINSPEC_QUOTA_ADMIT_PCT_7D/);
  });

  it('live with no weekly reading says so instead of inventing a weekly cap', () => {
    write({ pct: 42, resetIn: HOUR });
    const h = run(['--quota-health']).out;
    expect(h).toMatch(/no weekly reading/);
    expect(h).toMatch(/Cap in force: 5h 92\.0% ramped/);
    expect(h).not.toMatch(/7d \d/);
  });

  it('inert (no reading) still says which mode each window will be judged in', () => {
    const h = run(['--quota-health'], { MINSPEC_QUOTA_ADMIT_PCT_7D: '60' }).out;
    expect(h).toMatch(/^inert:/);
    expect(h).toMatch(/5h ramped from a 60% floor, 8%\/hour held back/);
    expect(h).toMatch(/7d fixed at 60% by MINSPEC_QUOTA_ADMIT_PCT_7D/);
  });
});

describe('#2514 R5: after a hold, the sleep ends when the ramp would next admit', () => {
  const MARGIN = 15; // QUOTA_SLEEP_MARGIN: settle past the boundary
  // A reading is written, then the script reads the clock. On a quiet machine that is a
  // few milliseconds; a loaded CI runner can take seconds to start a shell. The waits
  // here are hundreds to thousands of seconds, so twenty of slack costs them nothing.
  const SLOP = 20;

  it('weekly: 81% with 1.9 days left sleeps about 14 minutes, not six hours', () => {
    // cap(1.9 days) = 81.0, so 81% is held. The cap passes 81 once 163296s are left,
    // 864s from now. Before the bound this slept to the weekly reset, i.e. the 6h clamp.
    const left = 164160;
    const reading = { ...QUIET_5H, weekPct: 81, weekResetIn: left };
    expect(gate(reading).code).toBe(42);
    const secs = sleepSecs(reading);
    expect(secs).toBeLessThanOrEqual(864 + MARGIN);
    expect(secs).toBeGreaterThanOrEqual(864 + MARGIN - SLOP);
  });

  it('5h: 95% with an hour left sleeps to the minute the ramp reaches it, not to the reset', () => {
    // cap(1h) = 92.0. It passes 95 once 2205s are left: 1395s from now, where the reset
    // is 3600s away.
    const reading = { pct: 95, resetIn: HOUR };
    expect(gate(reading).code).toBe(42);
    const secs = sleepSecs(reading);
    expect(secs).toBeLessThanOrEqual(1395 + MARGIN);
    expect(secs).toBeGreaterThanOrEqual(1395 + MARGIN - SLOP);
  });

  interface BoundRow {
    name: string;
    reading: Reading;
    /** Which reset the hold is waiting on: the field to move when asking "and at that moment?". */
    shift: 'weekResetIn' | 'resetIn';
  }
  const bounds: BoundRow[] = [
    { name: 'weekly 66% with 3.5 days left', reading: { ...QUIET_5H, weekPct: 66, weekResetIn: 302400 }, shift: 'weekResetIn' },
    { name: 'weekly 97% with 10 hours left', reading: { ...QUIET_5H, weekPct: 97, weekResetIn: 36000 }, shift: 'weekResetIn' },
    { name: '5h 70% with four hours left', reading: { pct: 70, resetIn: 4 * HOUR }, shift: 'resetIn' },
    { name: '5h 99% with twenty minutes left', reading: { pct: 99, resetIn: 1200 }, shift: 'resetIn' },
  ];
  it.each(bounds)('$name: the gate admits when the sleep ends, and not before', ({ reading, shift }) => {
    // The property the bound exists for, checked against the gate itself, not against
    // a second copy of the ramp's arithmetic in this file.
    const max = { MINSPEC_QUOTA_SLEEP_MAX: '999999' }; // lift the 6h clamp: this is about the bound
    expect(gate(reading).code).toBe(42);
    const secs = sleepSecs(reading, max);
    const left = reading[shift] as number;
    expect(secs).toBeLessThan(left); // sooner than the reset
    const wait = secs - MARGIN;
    const then = (delta: number): Reading => ({ ...reading, [shift]: left - wait + delta });
    expect(gate(then(-SLOP)).code, 'when the sleep ends').toBe(0);
    expect(gate(then(SLOP + 2)).code, 'a little earlier').toBe(42);
  });

  it('the verdict says when, so the hold reads as a wait and not as a wall', () => {
    const r = gate({ ...QUIET_5H, weekPct: 81, weekResetIn: 164160 });
    expect(r.out).toMatch(/^defer:8[3-6]\d \(7d window 81% used/);
    expect(r.out).toMatch(/at this usage the ramp next admits in 15 min/);
  });

  it('a spent window sleeps to the reset: no ramp admits 100%', () => {
    expect(sleepSecs({ pct: 100, resetIn: 1800 })).toBeGreaterThanOrEqual(1800 + MARGIN - SLOP);
    expect(sleepSecs({ pct: 100, resetIn: 1800 })).toBeLessThanOrEqual(1800 + MARGIN);
    expect(gate({ pct: 100, resetIn: 1800 }).out).not.toMatch(/next admits/);
  });

  it('a wait shorter than the minimum is still the minimum: the loop never spins on a cap about to lift', () => {
    // 81% is held until 163296s are left. Forty seconds short of that, the ramp admits in
    // about forty seconds; with the margin that is under a minute, and the sleep is the
    // 60s floor.
    const reading = { ...QUIET_5H, weekPct: 81, weekResetIn: 163296 + 40 };
    expect(gate(reading).code).toBe(42);
    expect(sleepSecs(reading)).toBe(60);
  });

  it('a wait longer than the clamp is still clamped: the loop wakes, looks again, and sleeps again', () => {
    expect(sleepSecs({ ...QUIET_5H, weekPct: 97, weekResetIn: 3.5 * DAY })).toBe(6 * HOUR);
  });

  it('a FIXED cap sleeps to the reset exactly as before: it will not admit sooner', () => {
    const env = { MINSPEC_QUOTA_ADMIT_PCT_7D: '80', MINSPEC_QUOTA_SLEEP_MAX: '999999' };
    const secs = sleepSecs({ ...QUIET_5H, weekPct: 81, weekResetIn: 164160 }, env);
    expect(secs).toBeLessThanOrEqual(164160 + MARGIN);
    expect(secs).toBeGreaterThanOrEqual(164160 + MARGIN - SLOP);
  });

  it('with room on the meter the sleep is still to the 5h reset: a text signal is a wall the reading cannot see', () => {
    // quota_sleep_secs is also the fail-closed rest after a usage-limit TEXT signal that
    // the meter does not confirm. That rest is to the published reset, as it always was.
    const secs = sleepSecs({ pct: 10, resetIn: 600 });
    expect(secs).toBeLessThanOrEqual(600 + MARGIN);
    expect(secs).toBeGreaterThanOrEqual(600 + MARGIN - SLOP);
  });
});

describe('#2514: the week that just ended does not hold the week that just began', () => {
  // The ramp lets usage climb toward 100% by the weekly reset, so "the drain sleeps to the
  // reset and wakes a few seconds after it" is the ordinary end of every week. The
  // reading it wakes with is seconds old and describes a window that no longer exists:
  // high usage, and a reset time already in the past, which the ramp can only answer
  // with the floor. Unrefreshed, the first act of the new week would be a hold.
  const producer = (body: string): string => {
    const p = path.join(tmpDir, 'producer.sh');
    fs.writeFileSync(p, `#!/usr/bin/env bash\ntouch "${tmpDir}/producer-ran"\n${body}\n`, { mode: 0o755 });
    return `bash ${p}`;
  };
  const newWeek = () =>
    producer(
      `now=$(date +%s)\nprintf '{"used_percentage":1,"resets_at":%s,"observed_at":%s,"seven_day_percentage":1,"seven_day_resets_at":%s}' ` +
        `"$(( now + 18000 ))" "$now" "$(( now + 604800 ))" > "${quotaFile}"`,
    );
  const ran = () => fs.existsSync(path.join(tmpDir, 'producer-ran'));
  const lastWeek: Reading = { pct: 2, resetIn: HOUR, weekPct: 97, weekResetIn: -20, ageSec: 60 };

  it('a reading whose weekly reset has passed is taken again before it is judged, however fresh it is', () => {
    const r = gate(lastWeek, { MINSPEC_QUOTA_REFRESH: '1', MINSPEC_QUOTA_REFRESH_CMD: newWeek() });
    expect(ran()).toBe(true);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('7d window 1% used, cap 60.0% ramped');
  });

  it('CONTROL: a reading just as fresh whose weekly reset is still ahead is left alone', () => {
    // Same age, same usage, twenty seconds the other side of the reset. The producer is
    // not hammered once per ask for a reading that is still about the current week.
    const r = gate({ ...lastWeek, weekPct: 100, weekResetIn: 20 }, { MINSPEC_QUOTA_REFRESH: '1', MINSPEC_QUOTA_REFRESH_CMD: newWeek() });
    expect(ran()).toBe(false);
    expect(r.code).toBe(42);
  });

  it('if the producer cannot answer, the old reading stands and the floor holds it (fails closed)', () => {
    const r = gate(lastWeek, { MINSPEC_QUOTA_REFRESH: '1', MINSPEC_QUOTA_REFRESH_CMD: producer('exit 7') });
    expect(ran()).toBe(true);
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/^defer:\d+ \(7d window 97% used[^)]*no usable reset time; cap 60\.0% ramped: no reset time/);
  });

  it('a weekly reading that never carried a reset time is not refreshed for that reason alone', () => {
    // No reset time is not "a reset that has passed": the producer simply cannot see
    // one, and asking it again on every single ask would get the same answer.
    const r = gate({ pct: 2, resetIn: HOUR, weekPct: 50, ageSec: 60 }, { MINSPEC_QUOTA_REFRESH: '1', MINSPEC_QUOTA_REFRESH_CMD: newWeek() });
    expect(ran()).toBe(false);
    expect(r.code).toBe(0);
  });
});

describe('#2514 R5 in the real loop: the sleep line says what bounded the sleep', () => {
  const settled = (log: string) => log.includes('cycle done') || /sleeping \d+s/.test(log);

  it('a fixed cap whose reset is within reach: "to the published reset"', async () => {
    const d = await runLoop(
      {
        ready: [901, 902],
        reading: { pct: 40, resetIn: 2 * HOUR },
        readingAfterIssue: { 901: { pct: 55, resetIn: 2 * HOUR } },
        env: { MINSPEC_QUOTA_ADMIT_PCT: '50' },
      },
      settled,
    );
    const m = d.log().match(/quota window exhausted — sleeping (\d+)s, to the published reset rather than a guess/);
    expect(m, d.log()).not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(2 * HOUR + 15);
    expect(Number(m![1])).toBeGreaterThanOrEqual(2 * HOUR + 15 - 30);
  });

  it('a reading that went stale offers no deadline: the fixed backoff, named as that', async () => {
    const d = await runLoop(
      {
        ready: [901, 902],
        reading: { pct: 5, resetIn: 2 * HOUR },
        readingAfterIssue: { 901: { pct: 5, resetIn: 2 * HOUR, ageSec: 5000 } },
        env: { MINSPEC_DRAIN_QUOTA_BACKOFF: '777' },
      },
      settled,
    );
    expect(d.log()).toMatch(/defer:stale/);
    expect(d.log()).toMatch(/quota window exhausted — sleeping 777s, the fixed backoff: no deadline could be taken from the reading/);
    expect(d.log()).not.toContain('to the published reset');
  });
});

describe('#2514 R4 + R5 in the real loop: the log shows the cap at the start, on each cycle and on a hold', () => {
  it('a default-capped loop that crosses the ramp mid-cycle names the cap three times and sleeps to its next admit', async () => {
    // 3.5 days left: the weekly cap is 65.0%. Admitted at 61%, held at 66% after the
    // first dispatch. At 66% the ramp next admits once 292896s are left, 9504s away.
    const d = await runLoop(
      {
        ready: [901, 902, 903],
        reading: { pct: 5, resetIn: 3 * HOUR, weekPct: 61, weekResetIn: 302400 },
        readingAfterIssue: { 901: { pct: 6, resetIn: 3 * HOUR, weekPct: 66, weekResetIn: 302400 } },
      },
      (log) => log.includes('cycle done') || /sleeping \d+s/.test(log),
    );
    const log = d.log();
    expect(d.dispatched()).toEqual([901]);

    // The loop's start line.
    expect(log).toMatch(/\[drain\] quota gate — live: 5h window 5% used[^\n]*Cap in force: 5h 76\.0% ramped[^\n]*; 7d 65\.0% ramped/);
    // The cycle's own line, on an ADMIT: the cap is visible when nothing is wrong too.
    expect(log).toMatch(/\[drain\] quota gate — open:5% of the 5h window used, cap 76\.0% ramped[^\n]*7d window 61% used, cap 65\.0% ramped/);
    // The hold.
    expect(log).toMatch(/\[drain\] defer:9[45]\d\d \(7d window 66% used[^\n]*cap 65\.0% ramped[^\n]*the ramp next admits in 2\.6 h\) — holding the rest of the queue/);
    // The sleep: bounded by the ramp, and the log says that is what bounded it.
    const m = log.match(/\[drain\] quota cap holding - sleeping (\d+)s, until the ramped cap would next admit/);
    expect(m, log).not.toBeNull();
    const secs = Number(m![1]);
    expect(secs).toBeLessThanOrEqual(9504 + 15);
    expect(secs).toBeGreaterThanOrEqual(9504 + 15 - 30);
    expect(log).not.toContain('to the published reset');
  });

  it('a fixed cap is named as fixed on the same three lines, and its sleep is to the reset', async () => {
    const d = await runLoop(
      {
        ready: [901, 902],
        reading: { pct: 5, resetIn: 3 * HOUR, weekPct: 58, weekResetIn: 378000 },
        readingAfterIssue: { 901: { pct: 6, resetIn: 3 * HOUR, weekPct: 66, weekResetIn: 378000 } },
        env: { MINSPEC_QUOTA_ADMIT_PCT_7D: '60' },
      },
      (log) => log.includes('cycle done') || /sleeping \d+s/.test(log),
    );
    const log = d.log();
    expect(log).toMatch(/quota gate — live:[^\n]*7d 60% fixed by MINSPEC_QUOTA_ADMIT_PCT_7D/);
    expect(log).toMatch(/quota gate — open:[^\n]*7d window 58% used, cap 60% fixed by MINSPEC_QUOTA_ADMIT_PCT_7D/);
    expect(log).toMatch(/defer:\d+ \(7d window 66% used[^\n]*cap 60% fixed by MINSPEC_QUOTA_ADMIT_PCT_7D\) — holding/);
    // The weekly reset is 105 hours off, so the sleep is the six-hour clamp, and the
    // line says so instead of claiming to sleep "to the published reset".
    expect(log).toMatch(/quota window exhausted — sleeping 21600s, the longest single sleep \(MINSPEC_QUOTA_SLEEP_MAX\)/);
    expect(log).not.toContain('to the published reset');
    expect(log).not.toContain('next admits');
  });
});
