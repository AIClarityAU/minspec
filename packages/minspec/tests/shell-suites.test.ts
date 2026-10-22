/**
 * Collection point for every shell test suite under `scripts/tests/` (#1958).
 *
 * WHY THIS EXISTS. `scripts/tests/workflow-perm-probe.sh` sat on main with a
 * failing case and nobody saw it, because nothing ran it. The mechanism: the
 * required `test` check runs `npx vitest run --coverage` directly (ci.yml), and
 * vitest collects only `*.test.ts` files under `packages/<pkg>/tests/` — a `.sh`
 * suite is structurally invisible to that glob. No gate was weak here; there was
 * no gate at all, which is why it produced no signal rather than a red one.
 *
 * WHY NOT AN npm SCRIPT. The obvious fix — a `test:shell` entry in package.json —
 * would have been theatre. The CI job does not go through `npm test`, so the
 * suite would run on developer machines and never once in CI, which is the same
 * invisible-absence failure wearing a green tick.
 *
 * WHY DISCOVERY, NOT A LIST. The suites are read from the directory rather than
 * enumerated here, so the next `scripts/tests/*.sh` is picked up by existing CI
 * with no further wiring. A hand-maintained list would reproduce the original
 * defect the first time someone forgot to append to it — fixing the property,
 * not the one instance.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { useShellTimeout, SHELL_TEST_TIMEOUT_MS } from './helpers/shell-timeout';

useShellTimeout();

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SUITE_DIR = join(REPO_ROOT, 'scripts', 'tests');

/**
 * A missing directory resolves to zero suites rather than throwing during
 * collection: an exception here aborts the whole FILE, so the "at least one
 * suite" assertion below would never get to run and say what is wrong.
 */
const suites: string[] = (() => {
  try {
    return readdirSync(SUITE_DIR)
      .filter((f) => f.endsWith('.sh'))
      .sort();
  } catch {
    return [];
  }
})();

describe('shell test suites under scripts/tests/', () => {
  /**
   * An empty discovery must be RED. Deleting, renaming or relocating every suite
   * otherwise looks exactly like "all shell suites pass": zero tests generated,
   * file green. That is #1958 again one level up, so it is asserted rather than
   * assumed.
   */
  it('discovers at least one suite', () => {
    expect(suites).not.toHaveLength(0);
  });

  for (const suite of suites) {
    it(`${suite} passes`, () => {
      // Invoked through `bash` explicitly, so a suite's verdict does not hinge on
      // its executable bit — a redirect-and-move loses mode 755 silently, and
      // `bash -n` still reads clean afterwards.
      const r = spawnSync('bash', [join(SUITE_DIR, suite)], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        // Under the file's own ceiling, so a hung suite is killed here with its
        // partial output intact rather than by vitest, which reports only that
        // the test timed out and discards which case was running.
        timeout: SHELL_TEST_TIMEOUT_MS - 5_000,
      });

      if (r.status !== 0) {
        // These suites print a line per case; the exit code alone identifies the
        // file but not the failing case, so replay their output into the failure.
        throw new Error(
          `${suite} exited ${r.status ?? `on signal ${r.signal}`}\n\n` +
            `${r.stdout ?? ''}${r.stderr ?? ''}`,
        );
      }
    });
  }
});
