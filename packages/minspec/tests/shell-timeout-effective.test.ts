/**
 * #1399 — T0: the shell-timeout mechanism actually raises the timeout.
 *
 * WHY A SECOND FILE. `shell-timeout-coverage.test.ts` checks that a shell-driving suite
 * ASKS for a raise. It reads source text, so it cannot check that the raise WORKS — and
 * for the entire life of #1285 and #1099 it was green while all 20 opted-in suites still
 * ran at vitest's 5s default. `useShellTimeout()` wrapped `vi.setConfig({ testTimeout })`
 * in `beforeAll`, and vitest has already resolved every test's timeout by the time that
 * hook fires, so the call succeeded and changed nothing.
 *
 * The failure surfaced as `facts-cli.test.ts` timing out "in 5000ms" on a file whose
 * header explicitly documents a 30s timeout — and was misread twice as a code regression
 * before anyone questioned whether the raise was real.
 *
 * THE ONLY ASSERTION THAT CATCHES IT is one that outlives the default clock. A textual
 * guard cannot; a shorter test cannot. This file therefore costs ~6s of wall time per CI
 * run, on purpose. That is the price of the guard being behavioural instead of textual,
 * and it is cheaper than one more round of misdiagnosing a timeout as a broken feature.
 */
import { describe, it, expect } from 'vitest';
import { useShellTimeout, SHELL_TEST_TIMEOUT_MS } from './helpers/shell-timeout';

useShellTimeout();

/** vitest's default `testTimeout` is 5000ms; exceed it enough to be unambiguous. */
const OVER_DEFAULT_MS = 6_000;

describe('#1399 the shell-timeout helper genuinely raises testTimeout', () => {
  it(`survives a ${OVER_DEFAULT_MS}ms test, which vitest's 5s default would kill`, async () => {
    const started = Date.now();
    await new Promise((resolve) => setTimeout(resolve, OVER_DEFAULT_MS));
    const elapsed = Date.now() - started;

    // If `useShellTimeout()` is inert, this test never reaches here — vitest kills it at
    // 5000ms and reports a timeout, which is the whole point. The assertion below only
    // guards against the sleep being optimised or mocked away, leaving a test that
    // "passes" without ever having outlived the default.
    expect(elapsed).toBeGreaterThanOrEqual(OVER_DEFAULT_MS - 50);
  });

  it('raises to the documented value, so the comment in every opted-in suite stays true', () => {
    expect(SHELL_TEST_TIMEOUT_MS).toBe(30_000);
    expect(SHELL_TEST_TIMEOUT_MS).toBeGreaterThan(OVER_DEFAULT_MS);
  });
});
