/**
 * shell-timeout.ts — one honest line for a suite that shells out (#1285).
 *
 * WHY THIS EXISTS. A suite that spawns real `git`/`bash`/script child processes per
 * assertion cannot be judged by vitest's 5s default wall clock: under container
 * scheduling contention a single invocation queues past it with nothing hung, and WHICH
 * suite trips varies run to run. #1099 raised the timeout in six such suites by hand;
 * thirteen more were still on the default, and one of them (approve-commit-hook-parity)
 * later failed CI on an unrelated PR and cost a round of misdiagnosis.
 *
 * WHY NOT A GLOBAL DEFAULT. Raising `testTimeout` in vitest.config.ts would cover every
 * suite, including the pure ones where a 5s ceiling is a genuine signal that something
 * hung. #1099 kept that property deliberately; this preserves it. Slow-because-it-shells
 * is opted into per file, and stays visible in the file that needs it.
 *
 * Enforced by shell-timeout-coverage.test.ts, which fails when a suite makes enough
 * shell calls to qualify and neither calls this nor appears on the exemption list — so
 * the next shell-driving suite is caught the day it is written, not the day it flakes.
 */
import { beforeAll, afterAll, vi } from 'vitest';

/**
 * The measured value from #1099 — every affected suite passed reliably at 30s. Exported
 * so the coverage test can recognise a hand-rolled `vi.setConfig` using the same number.
 */
export const SHELL_TEST_TIMEOUT_MS = 30_000;

/**
 * Raise this file's testTimeout for the duration of the suite, and put it back afterwards.
 *
 * Call at module scope, above the tests:
 *
 * ```ts
 * import { useShellTimeout } from './helpers/shell-timeout';
 * useShellTimeout();
 * ```
 *
 * Scoped per file rather than globally: a genuinely hung test in a suite that does NOT
 * shell out still fails fast at vitest's default.
 */
export function useShellTimeout(ms: number = SHELL_TEST_TIMEOUT_MS): void {
  beforeAll(() => {
    vi.setConfig({ testTimeout: ms });
  });
  afterAll(() => {
    vi.resetConfig();
  });
}
