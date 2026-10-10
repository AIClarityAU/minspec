/**
 * T0 (#2574) - a drain test's result depends on the test, never on the knobs around it.
 *
 * THE BUG THIS PINS. The drain dispatches agents, each agent runs this suite, and each
 * agent inherits the drain's environment. A helper that hands the script under test
 * `{ ...process.env, <a few pins> }` therefore hands it the operator's own settings. With
 * the drain capped at 60% weekly, every dispatched agent saw two failures in
 * drain-quota-deadline.test.ts on an untouched tree and reported them as "pre-existing,
 * confirmed red on base". Base was red for the same reason: the base run inherited the
 * same variable. Measured again while writing this: with `MINSPEC_DRAIN_QUEUE_LIMIT=2`
 * around it, what the live drain was running with, drain-issue-rank.test.ts failed 12.
 *
 * WHAT SHOULD HAVE CAUGHT IT. Nothing ran those files with the knobs set in the
 * surrounding environment, so the leak was invisible everywhere except inside a
 * dispatched agent, which is the one place nobody reads a test failure critically.
 *
 * Three layers, one per describe block:
 *   1. the scrub itself, by name, so its rule is known rather than assumed;
 *   2. the hostile knobs against the REAL gate: leaked, they change a verdict, and
 *      through the scrub they do not (a hostile set that is not hostile proves nothing);
 *   3. every drain-*.test.ts either runs with the leak primed or says in writing why
 *      not, so the next drain test file is caught the day it is written.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  DRAIN_KNOB_PREFIXES,
  HOSTILE_AMBIENT_KNOBS,
  drainBaseEnv,
  isDrainKnob,
  useHostileAmbientDrainKnobs,
} from './helpers/drain-env';
import { useShellTimeout } from './helpers/shell-timeout';

// Module scope, never a hook: vitest resolves timeouts before beforeAll runs (#1399).
useShellTimeout();
// This file runs with the leak primed too; layer 2 below reads it straight back.
useHostileAmbientDrainKnobs();

const DRAIN = path.resolve(__dirname, '../../../scripts/drain-inbox.sh');
const nowSec = () => Math.floor(Date.now() / 1000);

describe('drainBaseEnv: what a drain test may inherit', () => {
  it.each([
    'MINSPEC_QUOTA_ADMIT_PCT',
    'MINSPEC_QUOTA_ADMIT_PCT_7D',
    'MINSPEC_QUOTA_FILE',
    'MINSPEC_QUOTA_A_KNOB_NOBODY_HAS_WRITTEN_YET',
    'MINSPEC_DRAIN_QUEUE_LIMIT',
    'MINSPEC_DRAIN_CONCURRENCY',
    'MINSPEC_DRAIN_LOCK',
    'MINSPEC_DRAIN_A_KNOB_NOBODY_HAS_WRITTEN_YET',
  ])('removes %s', (name) => {
    expect(isDrainKnob(name)).toBe(true);
    expect(drainBaseEnv({ [name]: 'x', PATH: '/bin' })).toEqual({ PATH: '/bin' });
  });

  it.each([
    'PATH',
    'HOME',
    // The stubbed GitHub credential vitest.setup.ts pins: a hermetic drain run needs it.
    'MINSPEC_GH_APP_TOKEN_SCRIPT',
    'MINSPEC_SESSION_PID',
    'MINSPEC_ISSUE_RANKER',
    // The prefix is the whole word and its underscore, anchored at the start.
    'MINSPEC_QUOTAS',
    'MINSPEC_DRAINAGE',
    'X_MINSPEC_QUOTA_ADMIT_PCT',
    'minspec_quota_admit_pct',
  ])('keeps %s', (name) => {
    expect(isDrainKnob(name)).toBe(false);
    expect(drainBaseEnv({ [name]: 'x' })).toEqual({ [name]: 'x' });
  });

  it('returns a copy and leaves the environment it was given alone', () => {
    const source = { MINSPEC_QUOTA_ADMIT_PCT_7D: '60', PATH: '/bin' };
    const scrubbed = drainBaseEnv(source);
    expect(source).toEqual({ MINSPEC_QUOTA_ADMIT_PCT_7D: '60', PATH: '/bin' });
    scrubbed.PATH = '/elsewhere';
    expect(source.PATH).toBe('/bin');
  });

  it('defaults to the test process environment, which is where the leak comes from', () => {
    process.env.MINSPEC_QUOTA_ONLY_FOR_THIS_TEST = 'set';
    try {
      expect(drainBaseEnv().MINSPEC_QUOTA_ONLY_FOR_THIS_TEST).toBeUndefined();
      expect(drainBaseEnv().PATH).toBe(process.env.PATH);
    } finally {
      delete process.env.MINSPEC_QUOTA_ONLY_FOR_THIS_TEST;
    }
  });

  it('every hostile knob is one the scrub removes, and both prefixes are represented', () => {
    const names = Object.keys(HOSTILE_AMBIENT_KNOBS);
    for (const name of names) expect(isDrainKnob(name), name).toBe(true);
    for (const prefix of DRAIN_KNOB_PREFIXES) {
      expect(names.some((n) => n.startsWith(prefix)), `no hostile knob starts with ${prefix}`).toBe(true);
    }
    // The two #2574 was filed about.
    expect(names).toContain('MINSPEC_QUOTA_ADMIT_PCT');
    expect(names).toContain('MINSPEC_QUOTA_ADMIT_PCT_7D');
  });
});

describe('the hostile knobs against the real gate', () => {
  let tmpDir: string;
  let quotaFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-env-'));
    quotaFile = path.join(tmpDir, 'quota.json');
    // 5% of the 5h window with an hour to run: admitted under any default this gate has had.
    fs.writeFileSync(
      quotaFile,
      JSON.stringify({ used_percentage: 5, resets_at: nowSec() + 3600, observed_at: nowSec() }),
    );
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const gate = (env: NodeJS.ProcessEnv): number => {
    try {
      execFileSync('bash', [DRAIN, '--quota-gate'], { encoding: 'utf-8', env, stdio: 'pipe' });
      return 0;
    } catch (e: unknown) {
      return (e as { status?: number }).status ?? 1;
    }
  };

  it('they really are in the surrounding environment while this file runs', () => {
    // Guards the guard: a helper that planted them from inside a hook, or not at all,
    // would leave every "runs with the leak primed" claim in this suite vacuous.
    for (const [name, value] of Object.entries(HOSTILE_AMBIENT_KNOBS)) {
      expect(process.env[name], name).toBe(value);
    }
  });

  it('CONTROL: handed that environment as it stands, the gate defers a reading it would admit', () => {
    const leaky = { ...process.env, MINSPEC_QUOTA_FILE: quotaFile, MINSPEC_QUOTA_REFRESH: '0' };
    expect(gate(leaky)).toBe(42);
  });

  it('through drainBaseEnv() the same reading is admitted', () => {
    const scrubbed = { ...drainBaseEnv(), MINSPEC_QUOTA_FILE: quotaFile, MINSPEC_QUOTA_REFRESH: '0' };
    expect(gate(scrubbed)).toBe(0);
  });

  it('a knob the test sets itself still arrives: the scrub removes the ambient value, not the knob', () => {
    const capped = {
      ...drainBaseEnv(),
      MINSPEC_QUOTA_FILE: quotaFile,
      MINSPEC_QUOTA_REFRESH: '0',
      MINSPEC_QUOTA_ADMIT_PCT: '5',
    };
    expect(gate(capped)).toBe(42);
  });
});

describe('every drain test file runs with the leak primed, or says why not', () => {
  /**
   * Files that do not call useHostileAmbientDrainKnobs(), each with a reason a reader can
   * check. An entry that waits on other work names the issue tracking it; an entry with
   * no issue is permanent and says what makes it safe.
   */
  const EXEMPT: Record<string, string> = {
    'drain-continuous.test.ts':
      'Pure seams only (--is-quota, --session-alive, --should-continue, --resolve-session-pid). None reads a drain or quota knob.',
    'drain-reconcile.test.ts':
      'Runs the extracted reconciler block and --dispatch-alive. Neither reads a MINSPEC_DRAIN_ or MINSPEC_QUOTA_ knob.',
  };

  const testsDir = __dirname;
  const drainTests = fs
    .readdirSync(testsDir)
    .filter((f) => /^drain-.*\.test\.ts$/.test(f))
    .sort();
  const read = (f: string) => fs.readFileSync(path.join(testsDir, f), 'utf-8');

  /** A module-scope call. Inside a hook it would run after the file's module-scope readers. */
  const primesTheLeak = (src: string) => /^useHostileAmbientDrainKnobs\(\);/m.test(src);

  it('finds the drain test files at all', () => {
    // A scan that walked nothing would report full compliance.
    expect(drainTests.length).toBeGreaterThanOrEqual(10);
    expect(drainTests).toContain('drain-quota-deadline.test.ts');
  });

  it('each one primes the leak or is exempt', () => {
    const offenders = drainTests.filter((f) => !(f in EXEMPT) && !primesTheLeak(read(f)));
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `These drain test files take whatever MINSPEC_QUOTA_* and MINSPEC_DRAIN_* knobs the ` +
            `surrounding environment holds, so a drain run with any of them set hands every agent ` +
            `it dispatches false failures (#2574):\n  ${offenders.join('\n  ')}\n\n` +
            `Fix: build the child environment from drainBaseEnv() and call ` +
            `useHostileAmbientDrainKnobs() at module scope (./helpers/drain-env). If a file ` +
            `really cannot, add it to EXEMPT in this file WITH a reason.`,
    ).toEqual([]);
  });

  it('every exemption is still needed, still names a real file, and carries a reason', () => {
    for (const [file, why] of Object.entries(EXEMPT)) {
      expect(drainTests, `${file} is exempt but does not exist`).toContain(file);
      expect(primesTheLeak(read(file)), `${file} primes the leak now: delete its exemption`).toBe(false);
      expect(why.trim().length, `${file}: an exemption needs a checkable reason`).toBeGreaterThanOrEqual(40);
    }
  });

  it('the detector detects: a module-scope call counts, a call inside a hook or a comment does not', () => {
    expect(primesTheLeak("import x from 'y';\nuseHostileAmbientDrainKnobs();\n")).toBe(true);
    expect(primesTheLeak('beforeAll(() => {\n  useHostileAmbientDrainKnobs();\n});\n')).toBe(false);
    expect(primesTheLeak('// useHostileAmbientDrainKnobs();\n')).toBe(false);
    expect(primesTheLeak('const nothing = 1;\n')).toBe(false);
  });
});
