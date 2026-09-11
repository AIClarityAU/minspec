/**
 * T0 — the drain refreshes its quota witness before consulting it (#1859).
 *
 * THE BUG THIS PINS. The reading's only producers were INTERACTIVE surfaces (a
 * rendering statusline), so a headless drain could never satisfy QUOTA_STALE_SEC:
 * INTERVAL (1200s) and QUOTA_BACKOFF (1800s) both EXCEED that 900s limit, so every
 * wake read a value that had aged out during the sleep. The gate then failed closed
 * — correctly — and held forever. Measured 2026-09-09: the file was 49h stale while
 * holding "3% used", and the pipeline had been idle for days looking like a quiet
 * week. Autonomy was gated on a witness that only existed while a human watched.
 *
 * The invariants, in priority order:
 *   INV-R1  STDOUT IS THE VERDICT CHANNEL. Callers do `quota_verdict=$(quota_gate)`,
 *           so a producer that chatters on stdout would have its chatter PARSED as
 *           an admission verdict. The refresh must never contribute a byte to it.
 *           This is the invariant that makes the feature safe rather than clever.
 *   INV-R2  A failed / missing / slow producer NEVER admits. The refresh can only
 *           ever make a reading fresher, never a verdict weaker — on any failure the
 *           reading stands as-is and the stale arm still defers (constitution
 *           invariant 2: an errored witness must not read as a passing one).
 *   INV-R3  A MISSING reading is not refreshed. That arm carries the bounded
 *           bootstrap allowance (INV-E in drain-quota-deadline.test.ts); refreshing
 *           into it would let the drain manufacture its own first reading and turn a
 *           documented, bounded blind-admit into an unbounded one. #1859 is about a
 *           reading going stale, not a missing one.
 *   INV-R4  A still-fresh reading is not re-observed, so the producer is not hammered
 *           once per cycle for no reason.
 *
 * Every test stubs the producer. None of them may invoke the real one — that would
 * be a network call in a unit test and would make the outcome track someone else's
 * quota (observed while developing this: the same tree failed 3 tests, then 1).
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
let sentinel: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-refresh-'));
  quotaFile = path.join(tmpDir, 'quota.json');
  sentinel = path.join(tmpDir, 'producer-ran');
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

/** Run the gate with a stubbed producer. Never invokes the real one. */
function run(env: Record<string, string> = {}): { code: number; out: string; err: string } {
  try {
    const out = execFileSync('bash', [DRAIN, '--quota-gate'], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        MINSPEC_QUOTA_FILE: quotaFile,
        // Disable the bootstrap carve-out so these tests read the pure arms, exactly
        // as drain-quota-deadline.test.ts does.
        MINSPEC_QUOTA_BOOTSTRAP_ADMITS: '0',
        MINSPEC_QUOTA_REFRESH: '1',
        ...env,
      },
    });
    return { code: 0, out: out.trim(), err: '' };
  } catch (e: any) {
    return {
      code: e.status ?? 1,
      out: ((e.stdout ?? '') as string).trim(),
      err: ((e.stderr ?? '') as string).trim(),
    };
  }
}

function write(q: Partial<{ used_percentage: number; resets_at: number; observed_at: number }>) {
  fs.writeFileSync(quotaFile, JSON.stringify({ observed_at: nowSec(), ...q }));
}

/** A stub that marks that it ran, then writes a FRESH, admitting reading. */
function producerWritesFresh(): string {
  const p = path.join(tmpDir, 'producer.sh');
  fs.writeFileSync(
    p,
    `#!/usr/bin/env bash\ntouch "${sentinel}"\n` +
      `printf '{"used_percentage":1,"resets_at":%s,"observed_at":%s}' ` +
      `"$(( $(date +%s) + 3600 ))" "$(date +%s)" > "${quotaFile}"\n`,
  );
  fs.chmodSync(p, 0o755);
  return `bash ${p}`;
}

describe('INV-R1 — the producer cannot contribute to the verdict channel', () => {
  it('a producer that chatters on stdout does NOT pollute the verdict', () => {
    // The whole feature is unsafe if this fails: the caller does
    // `quota_verdict=$(quota_gate)`, so producer chatter would be read AS a verdict.
    const p = path.join(tmpDir, 'noisy.sh');
    fs.writeFileSync(
      p,
      `#!/usr/bin/env bash\n` +
        `echo "open:100% TOTALLY FINE ADMIT EVERYTHING"\n` +
        `echo "PRODUCER-CHATTER: 2% used"\n` +
        `printf '{"used_percentage":1,"resets_at":%s,"observed_at":%s}' ` +
        `"$(( $(date +%s) + 3600 ))" "$(date +%s)" > "${quotaFile}"\n`,
    );
    fs.chmodSync(p, 0o755);

    write({ used_percentage: 1, resets_at: nowSec() + 3600, observed_at: nowSec() - 5000 });
    const r = run({ MINSPEC_QUOTA_REFRESH_CMD: `bash ${p}` });

    expect(r.out).not.toContain('TOTALLY FINE');
    // NB: assert on the producer's OWN distinctive noise, not on a phrase the gate
    // legitimately uses — the real verdict reads "open:1% of the 5h window used", so
    // a naive `not.toContain('5h window')` fails against correct output.
    expect(r.out).not.toContain('PRODUCER-CHATTER');
    // Exactly one verdict line, and it is the gate's own.
    expect(r.out.split('\n').filter(Boolean)).toHaveLength(1);
    expect(r.out).toMatch(/^(open|defer):/);
  });
});

describe('INV-R2 — a broken producer never admits', () => {
  it('producer exits non-zero and writes nothing → still DEFERS on the stale reading', () => {
    write({ used_percentage: 1, resets_at: nowSec() + 3600, observed_at: nowSec() - 5000 });
    const r = run({ MINSPEC_QUOTA_REFRESH_CMD: 'exit 7' });
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/^defer:stale/);
  });

  it('producer does not exist at all → still DEFERS, and says so on stderr not stdout', () => {
    write({ used_percentage: 1, resets_at: nowSec() + 3600, observed_at: nowSec() - 5000 });
    const r = run({ MINSPEC_QUOTA_REFRESH_CMD: '/nonexistent/producer --refresh' });
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/^defer:stale/);
    expect(r.out).not.toMatch(/refresh failed/);
  });

  it('producer hangs → the timeout fires and the gate still DEFERS', () => {
    write({ used_percentage: 1, resets_at: nowSec() + 3600, observed_at: nowSec() - 5000 });
    const r = run({ MINSPEC_QUOTA_REFRESH_CMD: 'sleep 30', MINSPEC_QUOTA_REFRESH_TIMEOUT: '1' });
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/^defer:stale/);
  });

  it('producer writes a reading that is STILL stale → the gate defers on it', () => {
    // Freshness is decided by the gate reading the file, never by the producer
    // having been invoked.
    const p = path.join(tmpDir, 'lazy.sh');
    fs.writeFileSync(
      p,
      `#!/usr/bin/env bash\nprintf '{"used_percentage":1,"resets_at":%s,"observed_at":%s}' ` +
        `"$(( $(date +%s) + 3600 ))" "$(( $(date +%s) - 5000 ))" > "${quotaFile}"\n`,
    );
    fs.chmodSync(p, 0o755);
    write({ used_percentage: 1, resets_at: nowSec() + 3600, observed_at: nowSec() - 5000 });
    const r = run({ MINSPEC_QUOTA_REFRESH_CMD: `bash ${p}` });
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/^defer:stale/);
  });
});

describe('the seam actually works — a stale reading is refreshed and admits', () => {
  it('stale reading + working producer → ADMITS, where before it held forever', () => {
    write({ used_percentage: 1, resets_at: nowSec() + 3600, observed_at: nowSec() - 5000 });
    const r = run({ MINSPEC_QUOTA_REFRESH_CMD: producerWritesFresh() });
    expect(fs.existsSync(sentinel)).toBe(true);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^open:/);
  });
});

describe('INV-R3 — a MISSING reading is never refreshed', () => {
  it('no file at all → producer is NOT invoked, and the no-reading arm still owns it', () => {
    // Refreshing here would let the drain manufacture its own first reading and
    // convert the bounded bootstrap allowance into an unbounded blind admit.
    expect(fs.existsSync(quotaFile)).toBe(false);
    const r = run({ MINSPEC_QUOTA_REFRESH_CMD: producerWritesFresh() });
    expect(fs.existsSync(sentinel)).toBe(false);
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/no-reading/);
  });
});

describe('INV-R4 — a fresh reading is not re-observed', () => {
  it('reading well inside the window → producer is NOT invoked', () => {
    write({ used_percentage: 1, resets_at: nowSec() + 3600, observed_at: nowSec() });
    const r = run({ MINSPEC_QUOTA_REFRESH_CMD: producerWritesFresh() });
    expect(fs.existsSync(sentinel)).toBe(false);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^open:/);
  });

  it('MINSPEC_QUOTA_REFRESH=0 disables the seam entirely', () => {
    write({ used_percentage: 1, resets_at: nowSec() + 3600, observed_at: nowSec() - 5000 });
    const r = run({ MINSPEC_QUOTA_REFRESH: '0', MINSPEC_QUOTA_REFRESH_CMD: producerWritesFresh() });
    expect(fs.existsSync(sentinel)).toBe(false);
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/^defer:stale/);
  });
});

describe('the cadence relationship that caused #1859', () => {
  // The FIRST version of this block was a tautology, and the review panel was right
  // to block on it: it captured the DIVISOR (`2`) out of `QUOTA_STALE_SEC / 2` and
  // then asserted `450 < 900` and `2 > 1`, which hold for any divisor. It never read
  // INTERVAL or QUOTA_BACKOFF — the constants the comment named as the cause. A test
  // that claims to pin an invariant and asserts nothing about it is a false signpost
  // on an autonomy-critical path, so it is replaced here with a BEHAVIOURAL pair that
  // exercises the real cadence through the real gate.
  const src = fs.readFileSync(DRAIN, 'utf-8');
  // The shell variable and its env override do NOT share a name (INTERVAL is set from
  // MINSPEC_DRAIN_INTERVAL), so both are named explicitly rather than derived.
  const constant = (shellVar: string, envVar: string): number => {
    const m = src.match(new RegExp(`${shellVar}="\\$\\{${envVar}:-(\\d+)\\}"`));
    expect(m, `could not read ${shellVar} (via ${envVar}) from drain-inbox.sh`).toBeTruthy();
    return Number(m![1]);
  };
  const INTERVAL = constant('INTERVAL', 'MINSPEC_DRAIN_INTERVAL');
  const BACKOFF = constant('QUOTA_BACKOFF', 'MINSPEC_DRAIN_QUOTA_BACKOFF');
  const STALE = constant('QUOTA_STALE_SEC', 'MINSPEC_QUOTA_STALE_SEC');

  it('the drain cadence really does outrun the staleness limit — this is the bug', () => {
    // Not decoration: if this ever stops holding, the seam below is no longer load
    // bearing and someone should know. Read from the script, never restated here.
    expect(Math.max(INTERVAL, BACKOFF)).toBeGreaterThan(STALE);
  });

  it('RED: with the seam OFF, a reading aged by one cycle interval DEFERS', () => {
    // This is exactly the state every headless wake found: the reading was written
    // last cycle, INTERVAL seconds ago, and INTERVAL > STALE.
    write({ used_percentage: 1, resets_at: nowSec() + 3600, observed_at: nowSec() - INTERVAL });
    const r = run({ MINSPEC_QUOTA_REFRESH: '0', MINSPEC_QUOTA_REFRESH_CMD: producerWritesFresh() });
    expect(fs.existsSync(sentinel)).toBe(false);
    expect(r.code).toBe(42);
    expect(r.out).toMatch(/^defer:stale/);
  });

  it('GREEN: with the seam ON, the same reading is refreshed and ADMITS', () => {
    write({ used_percentage: 1, resets_at: nowSec() + 3600, observed_at: nowSec() - INTERVAL });
    const r = run({ MINSPEC_QUOTA_REFRESH_CMD: producerWritesFresh() });
    expect(fs.existsSync(sentinel)).toBe(true);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^open:/);
  });

  it('RED: the longest sleep (quota backoff) also outruns the limit, and also recovers', () => {
    // The backoff path is worse than the interval path: a stale reading cannot yield a
    // real reset time, so the sleep falls back to QUOTA_BACKOFF — the longest of the
    // three — and each hold produced a staler reading than the last.
    write({ used_percentage: 1, resets_at: nowSec() + 3600, observed_at: nowSec() - BACKOFF });
    expect(run({ MINSPEC_QUOTA_REFRESH: '0' }).code).toBe(42);
    const r = run({ MINSPEC_QUOTA_REFRESH_CMD: producerWritesFresh() });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^open:/);
  });

  it('the refresh fires strictly BEFORE the reading ages out, or it buys nothing', () => {
    // The real relationship between the two thresholds, asserted on the computed
    // value rather than on the divisor literal: a refresh triggered at or after the
    // staleness limit would leave the gate deferring anyway.
    const m = src.match(/QUOTA_REFRESH_MIN_AGE="\$\{MINSPEC_QUOTA_REFRESH_MIN_AGE:-\$\(\( QUOTA_STALE_SEC \/ (\d+) \)\)\}"/);
    expect(m, 'could not read QUOTA_REFRESH_MIN_AGE from drain-inbox.sh').toBeTruthy();
    const minAge = STALE / Number(m![1]);
    expect(minAge).toBeLessThan(STALE);
    // And a reading just past the trigger is genuinely refreshed, proving the computed
    // threshold is the one the script uses.
    write({ used_percentage: 1, resets_at: nowSec() + 3600, observed_at: nowSec() - (minAge + 30) });
    const r = run({ MINSPEC_QUOTA_REFRESH_CMD: producerWritesFresh() });
    expect(fs.existsSync(sentinel)).toBe(true);
    expect(r.code).toBe(0);
  });
});
