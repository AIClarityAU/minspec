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
 *   INV-A  a missing / stale / unparseable reading FAILS CLOSED (defers) — an
 *          unknown budget must never read as permission to spend it (#1775;
 *          constitution invariant 2). This inverted the ORIGINAL INV-A, which
 *          read "FAILS OPEN (never wedges work)" — that was the bug: run_loop
 *          already treats a 42 defer as a pause, not a wedge, so failing open
 *          bought nothing but a silently-overspent quota.
 *   INV-B  a defer is AUDIBLE — it always names why, and a fail-closed defer
 *          also names the quota file, so a chronically-missing reading is
 *          diagnosable from one log line (no silent throttle)
 *   INV-C  the gate needs no network: no gh, no curl, no claude
 *   INV-D  the sleep is derived from resets_at, never a fixed guess, never negative
 *   INV-E  BOOTSTRAP is bounded, not fail-open reborn: a machine that has NEVER
 *          produced a reading gets a small, EXPLICIT, ONE-TIME allowance
 *          (QUOTA_BOOTSTRAP_ADMITS, default 3) to admit blind, because the only
 *          reactive producer on a headless/VS Code machine (quota_publish_wall)
 *          fires from INSIDE a dispatch this gate would otherwise prevent from
 *          ever running — plain fail-closed here is a permanent deadlock, not
 *          caution (#1775 review, BLOCKING). The instant a REAL reading is ever
 *          observed, the allowance is pinned exhausted forever (graduation),
 *          even if that reading later goes missing or stale again — "signal
 *          lost" must still fail closed exactly like INV-A. Most of the INV-A/B
 *          tests below pin MINSPEC_QUOTA_BOOTSTRAP_ADMITS=0 specifically so they
 *          keep testing the pure fail-closed invariant in isolation from this
 *          carve-out; the "bootstrap allowance" describe block below tests INV-E
 *          on its own, at the real default.
 *   INV-F  the verdicts here depend on what each test sets and on nothing else: the
 *          helpers start from an environment with every MINSPEC_QUOTA_* and
 *          MINSPEC_DRAIN_* knob removed, and the whole file runs with hostile values
 *          for those knobs in the surrounding environment, so a leak fails here
 *          rather than in the next agent a capped drain dispatches (#2574).
 *
 * THIS FILE TESTS THE FIXED CAPS. Since #2514 an unset cap is a ramp, which has its own
 * table in drain-quota-ramp.test.ts. A cap that IS set must keep meaning exactly what it
 * meant, and the live drain depends on that (it is paused with
 * MINSPEC_QUOTA_ADMIT_PCT_7D=0). So the helpers below pin both caps to the values that
 * were the defaults when these tests were written, 90 and 95, and not one assertion in
 * the file moved when the default did.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { drainBaseEnv, useHostileAmbientDrainKnobs, HOSTILE_AMBIENT_KNOBS } from './helpers/drain-env';

// Module scope, like useShellTimeout: every test below runs with the leak primed (#2574).
useHostileAmbientDrainKnobs();

const DRAIN = path.resolve(__dirname, '../../../scripts/drain-inbox.sh');
const nowSec = () => Math.floor(Date.now() / 1000);

/** The caps this file's verdicts were written against: the pre-#2514 defaults, now explicit. */
const FIXED_CAPS = { MINSPEC_QUOTA_ADMIT_PCT: '90', MINSPEC_QUOTA_ADMIT_PCT_7D: '95' };

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
      // drainBaseEnv(), never process.env: INV-F above (#2574).
      env: { ...drainBaseEnv(), MINSPEC_QUOTA_FILE: quotaFile,
        // Refreshing the reading before consulting it (#1859) is the PRODUCER's
        // job; this file tests the GATE. Left on, it would break INV-C above
        // ("the gate needs no network") and the stale-reading tests would never
        // SEE a stale reading, because the refresh replaces it first — observed:
        // 3 failures, then 1, from the same tree, because the outcome tracked
        // whether the real producer happened to succeed. Pinned off for the same
        // reason MINSPEC_QUOTA_BOOTSTRAP_ADMITS is pinned to 0: one behaviour per
        // file. The refresh seam is tested in drain-quota-refresh.test.ts.
        MINSPEC_QUOTA_REFRESH: '0', ...FIXED_CAPS, ...env },
    });
    return { code: 0, out: out.trim() };
  } catch (e: any) {
    return { code: e.status ?? 1, out: (((e.stdout ?? '') as string) + ((e.stderr ?? '') as string)).trim() };
  }
}

function write(q: Partial<{ used_percentage: number; resets_at: number; observed_at: number }>) {
  fs.writeFileSync(quotaFile, JSON.stringify({ observed_at: nowSec(), ...q }));
}

describe('drain-inbox.sh --quota-gate — INV-A/INV-B: unknown state fails CLOSED, audibly', () => {
  // These four pin MINSPEC_QUOTA_BOOTSTRAP_ADMITS=0 to disable the INV-E carve-out
  // (see the top doc comment) and test the pure fail-closed invariant in isolation.
  // Without the override, a FRESH tmpDir has never produced a reading, so these
  // would legitimately bootstrap-admit instead of defer — that behaviour has its
  // own describe block below ("the bootstrap allowance") rather than being folded
  // in here, so this block keeps testing exactly one thing.
  const noBootstrap = { MINSPEC_QUOTA_BOOTSTRAP_ADMITS: '0' };

  it('no file at all → DEFER (exit 42), says why, and names the quota file', () => {
    const r = run(['--quota-gate'], noBootstrap);
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/^defer:/);
    expect(r.out).toMatch(/no-reading/);
    expect(r.out).toContain(quotaFile);
  });

  it('an unreadable file (permission denied) → DEFER, same as missing', () => {
    write({ used_percentage: 1, resets_at: nowSec() + 3600 });
    fs.chmodSync(quotaFile, 0o000);
    let readable = true;
    try { fs.accessSync(quotaFile, fs.constants.R_OK); } catch { readable = false; }
    try {
      // Root (common in containers) ignores file permissions, so chmod cannot make
      // the file unreadable to this process there — skip rather than assert nothing.
      if (!readable) {
        const r = run(['--quota-gate'], noBootstrap);
        expect(r.code).toBe(42);
        expect(r.out).toMatch(/^defer:/);
        expect(r.out).toMatch(/no-reading/);
      }
    } finally {
      fs.chmodSync(quotaFile, 0o644);
    }
  });

  it('unparseable garbage → DEFER, not a crash and not a silent admit', () => {
    fs.writeFileSync(quotaFile, 'not json at all {{{');
    const r = run(['--quota-gate'], noBootstrap);
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/^defer:/);
    expect(r.out).toMatch(/no-reading/);
  });

  it('a reading with fields missing → DEFER', () => {
    fs.writeFileSync(quotaFile, JSON.stringify({ observed_at: nowSec() }));
    expect(run(['--quota-gate'], noBootstrap).code).toBe(42);
  });

  it('STALE reading → DEFER even though the percentage is way over the bar (the staleness, not the level, is what deferred it — see the control below)', () => {
    // 99% used, but observed hours ago: nobody has looked since, so it proves nothing.
    write({ used_percentage: 99, resets_at: nowSec() + 3600, observed_at: nowSec() - 86400 });
    const r = run(['--quota-gate']);
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/^defer:/);
    expect(r.out).toMatch(/stale/);
    expect(r.out).toContain(quotaFile);
  });

  it('CONTROL: a fresh reading well under the bar still ADMITS — the gate is not simply denying everything', () => {
    write({ used_percentage: 5, resets_at: nowSec() + 3600 });
    const r = run(['--quota-gate']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^open:/);
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

describe('drain-inbox.sh --quota-publish-wall — the reactive producer', () => {
  // The statusline publisher only runs when a statusline RENDERS, which VS Code and
  // headless sessions never do — so on this machine it never fires and the gate sits
  // inert. The wall message is the one reading that is always available, because it
  // arrives exactly when the window is exhausted. It carries a clock time and a zone
  // but no date, so the rollover has to be inferred.
  const at = (text: string, env: Record<string, string> = {}) => {
    try {
      const out = execFileSync('bash', [DRAIN, '--quota-publish-wall'], {
        input: text, encoding: 'utf-8',
        // drainBaseEnv(), never process.env: INV-F at the top of this file (#2574).
        env: { ...drainBaseEnv(), MINSPEC_QUOTA_FILE: quotaFile,
        // Refreshing the reading before consulting it (#1859) is the PRODUCER's
        // job; this file tests the GATE. Left on, it would break INV-C above
        // ("the gate needs no network") and the stale-reading tests would never
        // SEE a stale reading, because the refresh replaces it first — observed:
        // 3 failures, then 1, from the same tree, because the outcome tracked
        // whether the real producer happened to succeed. Pinned off for the same
        // reason MINSPEC_QUOTA_BOOTSTRAP_ADMITS is pinned to 0: one behaviour per
        // file. The refresh seam is tested in drain-quota-refresh.test.ts.
        MINSPEC_QUOTA_REFRESH: '0', ...FIXED_CAPS, ...env },
      });
      return { code: 0, out: out.trim() };
    } catch (e: any) {
      return { code: e.status ?? 1, out: (((e.stdout ?? '') as string) + ((e.stderr ?? '') as string)).trim() };
    }
  };
  const read = () => JSON.parse(fs.readFileSync(quotaFile, 'utf-8'));

  it('extracts the reset from the real wall message and publishes a FUTURE epoch', () => {
    const r = at("You've hit your session limit · resets 10:10pm (Australia/Sydney)");
    expect(r.code).toBe(0);
    const q = read();
    expect(q.resets_at).toBeGreaterThan(nowSec());
    // At the wall the window is by definition spent; the gate must then defer.
    expect(q.used_percentage).toBeGreaterThanOrEqual(100);
  });

  it('rolls over to tomorrow when the named time has already passed today', () => {
    // 00:01 is in the past for all but one minute of the day, so a naive parse would
    // publish an epoch behind `now` and the gate would read it as window-reset.
    const r = at("You've hit your session limit · resets 12:01am (Australia/Sydney)");
    expect(r.code).toBe(0);
    expect(read().resets_at).toBeGreaterThan(nowSec());
  });

  it('honours the timezone in the message rather than the machine zone', () => {
    at("You've hit your session limit · resets 10:10pm (Australia/Sydney)");
    const sydney = read().resets_at;
    fs.rmSync(quotaFile, { force: true });
    at("You've hit your session limit · resets 10:10pm (America/New_York)");
    expect(read().resets_at).not.toBe(sydney);
  });

  it('ignores text that is not a wall message, and writes nothing', () => {
    const r = at('build failed: TypeError at foo.ts:12');
    expect(r.code).not.toBe(0);
    expect(fs.existsSync(quotaFile)).toBe(false);
  });

  it('never publishes a reset further out than one day (a bad parse cannot park the drain)', () => {
    at("You've hit your session limit · resets 11:59pm (Australia/Sydney)");
    expect(read().resets_at - nowSec()).toBeLessThanOrEqual(86400 + 60);
  });

  it('the published file is immediately readable by the gate, which defers on it', () => {
    at("You've hit your session limit · resets 11:59pm (Australia/Sydney)");
    expect(run(['--quota-gate']).code).toBe(42);
  });
});

describe('drain-inbox.sh --quota-health — an inert gate must not be silent', () => {
  // With the bootstrap allowance EXHAUSTED (or disabled — pinned here so this test
  // is about the true fail-closed end state, not INV-E's bootstrap window; see the
  // "bootstrap allowance" describe block below for that), a missing reading HOLDS
  // the gate shut (fails closed, #1775) rather than admitting blind, but that hold
  // is still uninformed — it isn't weighing a real usage number. A blind-and-holding
  // gate and a healthy one still look identical from the outside; this is the seam
  // that tells them apart.
  it('says INERT when there is no reading and bootstrap is exhausted, naming that it fails CLOSED', () => {
    const r = run(['--quota-health'], { MINSPEC_QUOTA_FILE: '/nonexistent/x.json', MINSPEC_QUOTA_BOOTSTRAP_ADMITS: '0' });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^inert:/);
    expect(r.out).toMatch(/failing closed/i);
  });

  it('says INERT when the reading is stale rather than reporting a stale number as live', () => {
    write({ used_percentage: 50, resets_at: nowSec() + 3600, observed_at: nowSec() - 86400 });
    expect(run(['--quota-health']).out).toMatch(/^inert:/);
  });

  it('says LIVE with the actual numbers when a fresh reading exists', () => {
    write({ used_percentage: 42, resets_at: nowSec() + 3600 });
    const r = run(['--quota-health']);
    expect(r.out).toMatch(/^live:/);
    expect(r.out).toContain('42%');
  });

  it('reports but never gates — exit 0 in every state', () => {
    expect(run(['--quota-health'], { MINSPEC_QUOTA_FILE: '/nonexistent/x.json' }).code).toBe(0);
    write({ used_percentage: 99, resets_at: nowSec() + 3600 });
    expect(run(['--quota-health']).code).toBe(0);
  });
});

describe('drain-inbox.sh --quota-gate — INV-E: the bootstrap allowance (a machine that has NEVER seen a reading)', () => {
  // This is the #1775-review BLOCKING finding: plain fail-closed on "no reading"
  // deadlocks a fresh machine forever, because the only producer that could break
  // the tie on a headless/VS Code box (quota_publish_wall) fires from INSIDE a
  // dispatch this gate would otherwise prevent from ever running. See quota_gate's
  // doc comment ("WORST CASE while blind") for the exact bound this allowance puts
  // on that blind spot.

  it('a fresh environment that has NEVER had a reading ADMITS via the bounded bootstrap allowance — the drain can reach a first dispatch', () => {
    const r = run(['--quota-gate']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^open:bootstrap 1\/3/);
    expect(r.out).toContain(quotaFile);
  });

  it('grants exactly QUOTA_BOOTSTRAP_ADMITS admits, counting up, then refuses outright and names what to install', () => {
    expect(run(['--quota-gate']).out).toMatch(/^open:bootstrap 1\/3/);
    expect(run(['--quota-gate']).out).toMatch(/^open:bootstrap 2\/3/);
    expect(run(['--quota-gate']).out).toMatch(/^open:bootstrap 3\/3/);
    const r = run(['--quota-gate']);
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/^defer:no-reading/);
    expect(r.out).toMatch(/bootstrap allowance is exhausted/);
    expect(r.out).toMatch(/quota-publish-wall/); // names what to install, not just "install something"
  });

  it('the allowance is tunable, and 0 disables it entirely — pure fail-closed, the state before this fix', () => {
    const r = run(['--quota-gate'], { MINSPEC_QUOTA_BOOTSTRAP_ADMITS: '0' });
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/^defer:no-reading/);
  });

  it('once a REAL reading has ever existed, the bootstrap allowance is retired FOREVER — it does not re-open when the reading is later lost', () => {
    // Consume exactly ONE of the three admits.
    expect(run(['--quota-gate']).out).toMatch(/^open:bootstrap 1\/3/);
    // A real reading now appears — e.g. another session's statusline render, or
    // this bootstrap dispatch's own eventual usage-limit hit via quota_publish_wall
    // — with plenty of window left.
    write({ used_percentage: 5, resets_at: nowSec() + 3600 });
    expect(run(['--quota-gate']).out).toMatch(/^open:5% of the 5h window used/);
    // The reading disappears again — #1775's actual "signal lost" scenario.
    fs.rmSync(quotaFile, { force: true });
    // TWO of the three bootstrap admits were never consumed. A naive "count
    // successes, not attempts" design would let them be spent now — graduation
    // must block that: this is exactly the state #1775 requires to fail closed.
    const r = run(['--quota-gate']);
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/^defer:no-reading/);
    expect(r.out).toMatch(/bootstrap allowance is exhausted/);
  });

  it('a STALE reading still DEFERS even on a machine that has never bootstrapped — staleness is a REAL reading, not the "never had one" state', () => {
    // 99% used, but observed a day ago: _quota_read SUCCEEDS (this graduates the
    // allowance) before staleness is even checked, so bootstrap never applies here.
    write({ used_percentage: 99, resets_at: nowSec() + 3600, observed_at: nowSec() - 86400 });
    const r = run(['--quota-gate']);
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/^defer:stale/);
    expect(r.out).not.toMatch(/bootstrap/);
  });

  it('CONTROL: a fresh reading well under the bar still ADMITS normally, not via bootstrap', () => {
    write({ used_percentage: 5, resets_at: nowSec() + 3600 });
    const r = run(['--quota-gate']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^open:5% of the 5h window used/);
    expect(r.out).not.toMatch(/bootstrap/);
  });

  it('a bootstrap sidecar that cannot be written REFUSES to admit, rather than granting an admit it cannot remember granting', () => {
    // The directory itself does not exist, so "<quotaFile>.bootstrap" can never be
    // created either — an unbounded free pass would be worse than no allowance at
    // all, because it could never self-exhaust.
    const r = run(['--quota-gate'], { MINSPEC_QUOTA_FILE: '/nonexistent/nowhere/quota.json' });
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/^defer:no-reading/);
  });

  it('quota-health names the bootstrap counter and says NOT YET failing closed while admits remain', () => {
    const r = run(['--quota-health']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^inert:/);
    expect(r.out).toMatch(/0\/3/);
    expect(r.out).toMatch(/NOT YET FAILING CLOSED/i);
  });

  it('quota-health switches to failing-closed once the allowance is actually exhausted', () => {
    run(['--quota-gate']); run(['--quota-gate']); run(['--quota-gate']); // consume all 3
    const r = run(['--quota-health']);
    expect(r.out).toMatch(/BLIND and HOLDING \(failing closed\)/i);
  });
});

describe('drain-inbox.sh --quota-gate — the WEEKLY ceiling, which the 5h reading cannot see', () => {
  // Only some producers can see the 7d window, so the fields are optional and their
  // absence must never invalidate an otherwise-good 5h reading.
  const write7 = (q: Record<string, number>) =>
    fs.writeFileSync(quotaFile, JSON.stringify({ observed_at: nowSec(), ...q }));

  it('admits when both windows have room (real observed state: 5h 30%, 7d 61%)', () => {
    write7({ used_percentage: 30, resets_at: nowSec() + 11640,
             seven_day_percentage: 61, seven_day_resets_at: nowSec() + 313800 });
    expect(run(['--quota-gate']).code).toBe(0);
  });

  it('defers on the WEEKLY ceiling even when the 5h window is nearly empty', () => {
    write7({ used_percentage: 10, resets_at: nowSec() + 11640,
             seven_day_percentage: 97, seven_day_resets_at: nowSec() + 313800 });
    const r = run(['--quota-gate']);
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/WEEKLY/);
  });

  it('defers to the WEEKLY reset distance, not the 5h one', () => {
    write7({ used_percentage: 10, resets_at: nowSec() + 600,
             seven_day_percentage: 97, seven_day_resets_at: nowSec() + 313800 });
    expect(Number(run(['--quota-gate']).out.replace(/^defer:(\d+).*/s, '$1'))).toBeGreaterThan(100000);
  });

  it('a missing weekly reading leaves 5h behaviour completely unchanged', () => {
    write({ used_percentage: 10, resets_at: nowSec() + 3600 });
    expect(run(['--quota-gate']).code).toBe(0);
    expect(run(['--quota-health']).out).toMatch(/no weekly reading/);
    write({ used_percentage: 95, resets_at: nowSec() + 3600 });
    expect(run(['--quota-gate']).code).toBe(42);
  });

  it('the weekly bar is separately tunable, and is its own number, not the 5h bar', () => {
    // 92% is over this file's 5h cap (90) and under its weekly cap (95): the weekly
    // window is judged against the weekly cap. Lowering that cap flips the verdict.
    write7({ used_percentage: 10, resets_at: nowSec() + 3600,
             seven_day_percentage: 92, seven_day_resets_at: nowSec() + 313800 });
    expect(run(['--quota-gate']).code).toBe(0);                                    // 92 < 95
    expect(run(['--quota-gate'], { MINSPEC_QUOTA_ADMIT_PCT_7D: '90' }).code).toBe(42);
  });

  it('a weekly cap of 0 holds everything, even a 0% reading: the pause the live drain relies on', () => {
    // The drain is paused by starting it with MINSPEC_QUOTA_ADMIT_PCT_7D=0, and that
    // only works because "at or above the cap" includes 0 at a cap of 0. A change that
    // read 0 as "unset", or compared with > instead of >=, would silently un-pause it.
    write7({ used_percentage: 0, resets_at: nowSec() + 3600,
             seven_day_percentage: 0, seven_day_resets_at: nowSec() + 200000 });
    const r = run(['--quota-gate'], { MINSPEC_QUOTA_ADMIT_PCT_7D: '0' });
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/^defer:\d+ \(7d window 0% used/);
    expect(r.out).toMatch(/WEEKLY/);
    // CONTROL: the same reading under a cap it is below is admitted, so it is the cap
    // of 0 that held it and not something else about the reading.
    expect(run(['--quota-gate'], { MINSPEC_QUOTA_ADMIT_PCT_7D: '1' }).code).toBe(0);
  });

  it('a weekly ceiling with no usable reset still defers, bounded by the clamp', () => {
    write7({ used_percentage: 10, resets_at: nowSec() + 3600,
             seven_day_percentage: 99, seven_day_resets_at: nowSec() - 10 });
    const r = run(['--quota-gate']);
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/no usable reset time/);
    // The gate's own printed number names what it would actually sleep: the fixed
    // backoff, not the 6h clamp (#2603 — those used to disagree, 21600 printed here
    // while the loop slept toward an unrelated 5h reset).
    expect(r.out).toMatch(/^defer:1800 /);
  });

  it("T3 regression (#2603): a weekly hold with a PASSED reset sleeps the fixed backoff, not the 5h reset hours away", () => {
    // Measured case: weekly 97% with its reset 20s in the past, 5h window 2% with
    // ~4h left to run. _quota_sleep_plan only took the weekly branch when wr > now,
    // so a weekly hold with no usable reset time fell through to the 5h branch and
    // slept toward ITS reset — four hours away for a hold that lifts the moment the
    // producer publishes the new week. The weekly window's own hold must win this
    // sleep too, exactly as it already wins the gate's admission verdict.
    write7({ used_percentage: 2, resets_at: nowSec() + 4 * 3600,
             seven_day_percentage: 97, seven_day_resets_at: nowSec() - 20 });
    expect(run(['--quota-gate']).code).toBe(42);
    const secs = Number(run(['--quota-sleep']).out);
    expect(secs).toBe(1800);
    // CONTROL: the same 5h reading with the weekly window NOT binding (room to spare)
    // sleeps toward the 5h reset as usual — so it is the weekly hold, not some other
    // change, that redirected the sleep above.
    write7({ used_percentage: 2, resets_at: nowSec() + 4 * 3600,
             seven_day_percentage: 10, seven_day_resets_at: nowSec() - 20 });
    const controlSecs = Number(run(['--quota-sleep']).out);
    expect(controlSecs).toBeGreaterThan(1800);
  });

  it('reports the weekly level in health when it is known', () => {
    write7({ used_percentage: 30, resets_at: nowSec() + 3600,
             seven_day_percentage: 61, seven_day_resets_at: nowSec() + 313800 });
    expect(run(['--quota-health']).out).toMatch(/7d window 61%/);
  });
});

describe('T3 regression — the weekly ceiling must outrank the 5h window-reset', () => {
  // Found in review of #1676. quota_gate returned open:window-reset as soon as the 5h
  // resets_at passed, BEFORE consulting the weekly ceiling. The two windows are
  // independent: the 5h one turning over does not refill the weekly one. So a fresh
  // reading whose 5h window had reset but whose 7d window was exhausted was admitted,
  // and the drain walked into exactly the wall this feature exists to prevent.
  //
  // Deterministically reachable, not a race: the loop sleeps to the 5h reset, wakes,
  // the poller has refreshed the reading (so it is not stale), 5h resets_at is now in
  // the past -> admitted despite 7d at 99%.
  const write7 = (q: Record<string, number>) =>
    fs.writeFileSync(quotaFile, JSON.stringify({ observed_at: nowSec(), ...q }));

  it('defers on the weekly ceiling even when the 5h window has already reset', () => {
    write7({
      used_percentage: 5, resets_at: nowSec() - 60,          // 5h window turned over
      seven_day_percentage: 99, seven_day_resets_at: nowSec() + 200000, // weekly spent
    });
    const r = run(['--quota-gate']);
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/WEEKLY/);
    expect(r.out).not.toMatch(/window-reset/);
  });

  it('still reports window-reset when the 5h window reset and the weekly has room', () => {
    write7({
      used_percentage: 5, resets_at: nowSec() - 60,
      seven_day_percentage: 20, seven_day_resets_at: nowSec() + 200000,
    });
    const r = run(['--quota-gate']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/window-reset/);
  });

  it('with no weekly reading, a passed 5h reset still admits (behaviour unchanged)', () => {
    write({ used_percentage: 99, resets_at: nowSec() - 60 });
    expect(run(['--quota-gate']).code).toBe(0);
  });

  it('sleeps toward the WEEKLY reset when the weekly ceiling is what is deferring', () => {
    // Non-blocking finding from the same review: quota_sleep_secs read the weekly
    // fields but never used them, so the loop slept on the 5h reset (or the clamp)
    // while the gate reported a days-out weekly deferral. Safe, but the message lied.
    write7({
      used_percentage: 5, resets_at: nowSec() + 120,
      seven_day_percentage: 99, seven_day_resets_at: nowSec() + 200000,
    });
    const secs = Number(run(['--quota-sleep']).out);
    // The weekly reset is ~200000s out, so the answer must be the 6h clamp — NOT the
    // 135s the 5h reset would give. A `> 120` assertion would pass on that 135 and
    // prove nothing, which is how this test first went green while still broken.
    expect(secs).toBe(6 * 3600);
  });
});

describe('T3 regression (#2233): a text-only signal that a fresh meter contradicts does not sleep to the reset', () => {
  // Measured 2026-09-30. A false match on the word "quota" (19:03) paused the drain; the
  // last in-flight build finished at 19:15:54, and the drain then slept 17061s "to the
  // published reset". The reading beside that reset said 5h 0% / 7d 26%, observed 861s
  // earlier: 39s inside the 900s freshness limit, so quota_sleep_secs believed its
  // resets_at and never looked at the percentage next to it.
  //
  // `--quota-signal-sleep [<streak>]` is the pure seam for the rest the loop takes after a
  // TEXT signal: "<secs> <verdict> <meter says>". The verdict is `contradicted` (a fresh
  // reading shows room in every window: short backoff), `confirmed` (the meter agrees or
  // cannot speak: today's sleep, fail closed) or `overruled` (the meter contradicted the
  // previous signal too, so it is not seeing whatever is binding: fail closed).
  const sig = (env: Record<string, string> = {}, streak?: number) => {
    const r = run(streak === undefined ? ['--quota-signal-sleep'] : ['--quota-signal-sleep', String(streak)], env);
    const [secs, verdict] = r.out.split(/\s+/);
    return { code: r.code, secs: Number(secs), verdict, out: r.out };
  };
  const write7 = (q: Record<string, number>) =>
    fs.writeFileSync(quotaFile, JSON.stringify({ observed_at: nowSec(), ...q }));

  it('the measured case: fresh 5h 0% / 7d 26%, reset 17061s out, gets the SHORT backoff and names the reading', () => {
    write7({
      used_percentage: 0, resets_at: nowSec() + 17061, observed_at: nowSec() - 861,
      seven_day_percentage: 26, seven_day_resets_at: nowSec() + 400000,
    });
    const r = sig();
    expect(r.code).toBe(0);
    expect(r.verdict).toBe('contradicted');
    expect(r.secs).toBe(60);
    expect(r.out).toMatch(/0% of the 5h window used/);
  });

  it('CONTROL: the same signal with the 5h window at 95% still sleeps to the published reset', () => {
    write({ used_percentage: 95, resets_at: nowSec() + 600 });
    const r = sig();
    expect(r.verdict).toBe('confirmed');
    expect(r.secs).toBeGreaterThanOrEqual(600);
    expect(r.secs).toBeLessThan(900);
  });

  it('a STALE reading cannot contradict anything: the fixed backoff, exactly as before (fail closed)', () => {
    write({ used_percentage: 0, resets_at: nowSec() + 17000, observed_at: nowSec() - 901 });
    const r = sig({ MINSPEC_DRAIN_QUOTA_BACKOFF: '1800' });
    expect(r.verdict).toBe('confirmed');
    expect(r.secs).toBe(1800);
    expect(r.out).toMatch(/stale/);
  });

  it('NO reading cannot contradict anything either, and spends no bootstrap admit finding that out', () => {
    const r = sig({ MINSPEC_DRAIN_QUOTA_BACKOFF: '1800' });
    expect(r.verdict).toBe('confirmed');
    expect(r.secs).toBe(1800);
    expect(fs.existsSync(`${quotaFile}.bootstrap`)).toBe(false);
  });

  it('a WEEKLY window at its bar is not headroom, even with the 5h window empty', () => {
    write7({
      used_percentage: 0, resets_at: nowSec() + 3600,
      seven_day_percentage: 97, seven_day_resets_at: nowSec() + 200000,
    });
    const r = sig();
    expect(r.verdict).toBe('confirmed');
    expect(r.secs).toBe(6 * 3600);
  });

  it('a meter that already contradicted the previous signal is overruled: fail closed to the published reset', () => {
    // A cap the meter cannot see (a per-model limit, say) produces a signal on every
    // launch while the meter keeps reading low. Believing it every time would strand one
    // issue per probe, so the veto is spent after MINSPEC_QUOTA_CONTRADICT_MAX in a row.
    write({ used_percentage: 0, resets_at: nowSec() + 3000 });
    expect(sig({}, 0).verdict).toBe('contradicted');
    const r = sig({}, 1);
    expect(r.verdict).toBe('overruled');
    expect(r.secs).toBeGreaterThanOrEqual(3000);
    expect(r.secs).toBeLessThan(3300);
  });

  it('MINSPEC_QUOTA_CONTRADICT_MAX=0 turns the veto off (every signal fails closed, the pre-#2233 behaviour)', () => {
    write({ used_percentage: 0, resets_at: nowSec() + 3000 });
    const r = sig({ MINSPEC_QUOTA_CONTRADICT_MAX: '0' });
    expect(r.verdict).toBe('overruled');
    expect(r.secs).toBeGreaterThanOrEqual(3000);
  });

  it('the short backoff is tunable, and clamped so it can never spin', () => {
    write({ used_percentage: 0, resets_at: nowSec() + 3000 });
    expect(sig({ MINSPEC_QUOTA_CONTRADICTED_BACKOFF: '300' }).secs).toBe(300);
    expect(sig({ MINSPEC_QUOTA_CONTRADICTED_BACKOFF: '0' }).secs).toBe(60);
  });

  it('always leads with a bare integer, because the loop feeds it to sleep', () => {
    write({ used_percentage: 0, resets_at: nowSec() + 3000 });
    expect(run(['--quota-signal-sleep']).out).toMatch(/^\d+ contradicted /);
    expect(run(['--quota-signal-sleep'], { MINSPEC_QUOTA_FILE: '/nonexistent/x.json' }).out).toMatch(/^\d+ confirmed /);
  });

  it('T0: the meter contradicts a signal IF AND ONLY IF the admission gate would admit on the same reading', () => {
    // One predicate, two consumers: the veto is quota_gate's own verdict, not a copy of
    // its rules that could drift from them. Walk readings on both sides of every bar.
    const readings: Array<Record<string, number> | null> = [
      { used_percentage: 0, resets_at: nowSec() + 3600 },
      { used_percentage: 89, resets_at: nowSec() + 3600 },
      { used_percentage: 90, resets_at: nowSec() + 3600 },
      { used_percentage: 100, resets_at: nowSec() - 60 },
      { used_percentage: 0, resets_at: nowSec() + 3600, observed_at: nowSec() - 901 },
      { used_percentage: 0, resets_at: nowSec() + 3600, seven_day_percentage: 94, seven_day_resets_at: nowSec() + 100000 },
      { used_percentage: 0, resets_at: nowSec() + 3600, seven_day_percentage: 95, seven_day_resets_at: nowSec() + 100000 },
      { used_percentage: 5, resets_at: nowSec() - 60, seven_day_percentage: 99, seven_day_resets_at: nowSec() + 200000 },
      null,
    ];
    let contradicted = 0;
    for (const q of readings) {
      fs.rmSync(quotaFile, { force: true });
      if (q) write7(q);
      const admits = run(['--quota-gate'], { MINSPEC_QUOTA_BOOTSTRAP_ADMITS: '0' }).code === 0;
      const verdict = sig().verdict;
      expect(verdict === 'contradicted', `reading ${JSON.stringify(q)}: gate admits=${admits}, veto=${verdict}`).toBe(admits);
      if (admits) contradicted++;
    }
    // Both sides of the equivalence were exercised, so it cannot hold vacuously.
    expect(contradicted).toBeGreaterThan(0);
    expect(contradicted).toBeLessThan(readings.length);
  });
});

describe('T3 regression (#2574): knobs in the surrounding environment never reach the gate under test', () => {
  // Every test above already ran with both cap knobs set to 0 in the surrounding
  // environment (useHostileAmbientDrainKnobs at the top of this file), which is the
  // requirement: with the caps set around it, no verdict in this file changes. These
  // three make that arrangement checkable, so it cannot quietly become a no-op.
  const raw = (env: NodeJS.ProcessEnv): { code: number; out: string } => {
    try {
      const out = execFileSync('bash', [DRAIN, '--quota-gate'], { encoding: 'utf-8', env, stdio: 'pipe' });
      return { code: 0, out: out.trim() };
    } catch (e: any) {
      return { code: e.status ?? 1, out: ((e.stdout ?? '') as string).trim() };
    }
  };

  it('the surrounding environment really does carry both cap knobs while this file runs', () => {
    expect(process.env.MINSPEC_QUOTA_ADMIT_PCT).toBe(HOSTILE_AMBIENT_KNOBS.MINSPEC_QUOTA_ADMIT_PCT);
    expect(process.env.MINSPEC_QUOTA_ADMIT_PCT_7D).toBe(HOSTILE_AMBIENT_KNOBS.MINSPEC_QUOTA_ADMIT_PCT_7D);
    expect(process.env.MINSPEC_QUOTA_ADMIT_PCT_7D).toBe('0');
  });

  it('CONTROL: handed that environment as it stands, the gate gives a different verdict (the leak is real)', () => {
    // The pre-fix helper, reduced to its shape: `{ ...process.env, <pins> }`. On a
    // reading the gate admits by default, the ambient cap of 0 defers it. If this
    // ever admits, the hostile knobs have stopped being hostile and the tests above
    // are proving nothing.
    fs.writeFileSync(quotaFile, JSON.stringify({
      observed_at: nowSec(), used_percentage: 30, resets_at: nowSec() + 3600,
      seven_day_percentage: 61, seven_day_resets_at: nowSec() + 313800,
    }));
    // Staleness is pinned so that the ambient cap, and nothing else that is hostile
    // out there, is what decides.
    const leaky = { ...process.env, MINSPEC_QUOTA_FILE: quotaFile, MINSPEC_QUOTA_REFRESH: '0', MINSPEC_QUOTA_STALE_SEC: '900' };
    const leaked = raw(leaky);
    expect(leaked.code).toBe(42);
    expect(leaked.out).toMatch(/^defer:\d+ \(7d window 61% used/);
    // The same reading through this file's helper: admitted, as the weekly-ceiling
    // block above asserts ("real observed state: 5h 30%, 7d 61%").
    expect(run(['--quota-gate']).code).toBe(0);
  });

  it('the two tests #2574 named pass with the incident value, 60, in the surrounding environment', () => {
    // 2026-10-03/04: the drain ran with MINSPEC_QUOTA_ADMIT_PCT_7D=60 and every agent
    // it dispatched saw exactly two failures here, on a 61% and a 92% weekly reading.
    const saved = process.env.MINSPEC_QUOTA_ADMIT_PCT_7D;
    process.env.MINSPEC_QUOTA_ADMIT_PCT_7D = '60';
    try {
      const reading = (week: number) => fs.writeFileSync(quotaFile, JSON.stringify({
        observed_at: nowSec(), used_percentage: 10, resets_at: nowSec() + 3600,
        seven_day_percentage: week, seven_day_resets_at: nowSec() + 313800,
      }));
      reading(61);
      expect(run(['--quota-gate']).code).toBe(0);
      reading(92);
      expect(run(['--quota-gate']).code).toBe(0);
      // And 60 still means 60 when a test asks for it: the knob is not being ignored.
      expect(run(['--quota-gate'], { MINSPEC_QUOTA_ADMIT_PCT_7D: '60' }).code).toBe(42);
    } finally {
      process.env.MINSPEC_QUOTA_ADMIT_PCT_7D = saved;
    }
  });
});
