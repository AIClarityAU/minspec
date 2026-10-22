/**
 * drain-env.ts - the environment a drain test hands to the script under test (#2574).
 *
 * WHY THIS EXISTS. `scripts/drain-inbox.sh` reads its knobs from the environment, and a
 * test that builds the child's environment as `{ ...process.env, <a few pins> }` hands it
 * every knob the test process happened to inherit. That is not hypothetical: the drain
 * dispatches agents, each agent runs this suite, and each agent inherits the drain's own
 * environment. #2574 records the result: on 2026-10-03 and 2026-10-04 the drain ran with
 * `MINSPEC_QUOTA_ADMIT_PCT_7D=60`, and at least six dispatched agents reported "2
 * pre-existing failures in drain-quota-deadline.test.ts, confirmed red on base too". Both
 * halves were true and the conclusion was wrong: base was red only because the base run
 * inherited the same variable. `main` was green. Reproduced while writing this file: the
 * untouched suite under that one variable fails exactly those two tests.
 *
 * Two parts, and a file needs both:
 *
 *   1. `drainBaseEnv()` is what a helper spreads INSTEAD of `process.env`: the ambient
 *      environment with every drain and quota knob removed. The test then adds the knobs
 *      it means to set, so a verdict depends on the test and on nothing else.
 *
 *   2. `useHostileAmbientDrainKnobs()` is the gate that part 1 was missing. Called at
 *      module scope, it plants knob values in the test process's own environment that
 *      would change a verdict if any of them reached the script. Every test in the file
 *      then runs with the leak primed, on every run, so a helper that goes back to
 *      spreading `process.env` turns the file red the same day rather than the next time
 *      someone runs a capped drain.
 *
 * The knobs are matched by PREFIX, not listed, so a knob added to the script next month is
 * covered without anyone remembering this file. That is also why the hostile set below
 * does not need to be complete: it only has to be potent, which
 * drain-env-scrub.test.ts checks against the real script.
 */
import { afterAll } from 'vitest';

/** Every knob the drain and its quota gate read from the environment starts with one of these. */
export const DRAIN_KNOB_PREFIXES = ['MINSPEC_QUOTA_', 'MINSPEC_DRAIN_'] as const;

/** Is `name` a drain or quota knob? */
export function isDrainKnob(name: string): boolean {
  return DRAIN_KNOB_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * `source` (the test process's own environment unless told otherwise) with every drain and
 * quota knob removed. Spread this, then add what the test sets:
 *
 * ```ts
 * env: { ...drainBaseEnv(), MINSPEC_QUOTA_FILE: quotaFile, ...env }
 * ```
 *
 * Everything else passes through untouched, including PATH and the stubbed GitHub
 * credential that vitest.setup.ts pins (`MINSPEC_GH_APP_TOKEN_SCRIPT`).
 */
export function drainBaseEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (!isDrainKnob(name)) env[name] = value;
  }
  return env;
}

/**
 * Knob values that change what the drain does, taken from both prefixes. The first two are
 * the cap knobs #2574 was filed about; `MINSPEC_QUOTA_ADMIT_PCT_7D=0` is, to the character,
 * what the live drain was started with while this was written.
 */
export const HOSTILE_AMBIENT_KNOBS: Readonly<Record<string, string>> = {
  MINSPEC_QUOTA_ADMIT_PCT: '0', // a 5h cap of 0 holds every reading
  MINSPEC_QUOTA_ADMIT_PCT_7D: '0', // the same for the weekly window
  MINSPEC_QUOTA_STALE_SEC: '1', // every reading older than a second is stale
  MINSPEC_QUOTA_BOOTSTRAP_ADMITS: '0', // no bootstrap allowance at all
  MINSPEC_DRAIN_QUEUE_LIMIT: '1', // one dispatch per cycle
  MINSPEC_DRAIN_CONCURRENCY: '3', // a fan-out nobody asked for
  MINSPEC_DRAIN_SPECIFY: '0', // spec-writing switched off
};

/**
 * Run this file's tests with hostile drain knobs in the surrounding environment, and put
 * the environment back afterwards.
 *
 * Call at MODULE scope, above the tests, like `useShellTimeout()`:
 *
 * ```ts
 * import { drainBaseEnv, useHostileAmbientDrainKnobs } from './helpers/drain-env';
 * useHostileAmbientDrainKnobs();
 * ```
 *
 * The knobs are planted the moment this is called, not in a hook, so a helper that reads
 * the environment while the file is still being collected sees them too.
 */
export function useHostileAmbientDrainKnobs(): void {
  const before = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(HOSTILE_AMBIENT_KNOBS)) {
    before.set(name, process.env[name]);
    process.env[name] = value;
  }
  afterAll(() => {
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}
