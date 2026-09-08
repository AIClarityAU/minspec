#!/usr/bin/env node
// #1509 — `test:e2e` shelled out to `vscode-test` bare, which resolves and
// downloads a VS Code build from the network on every run with no retry and
// no cache. One transient connect timeout to the download host (ETIMEDOUT)
// therefore failed the whole job outright, and because `e2e` is a required
// check, a runner-side network blip got promoted into a red `main` that
// blocked the merge path for every other PR until a human re-ran it.
//
// This wraps the command in a small retry loop instead of touching CI config
// (out of this role's file allowlist and explicitly disallowed) — the retry
// lives in the npm script itself, so it protects a local run exactly the same
// as a CI run. Each attempt (success or failure) is logged explicitly so a
// "passed on attempt 2/3" run stays visible in the log rather than reading as
// a clean first-try pass (the mitigation called out in #1509).

import { spawnSync } from 'node:child_process';

/**
 * Run `command args` up to `attempts` times, stopping at the first success
 * (exit code 0). Waits `delayMs` between attempts. Injectable `spawnFn` /
 * `sleepFn` / `logFn` make this deterministically unit-testable without
 * actually shelling out or sleeping in the test suite.
 *
 * @returns {Promise<number>} the exit code of the last attempt (0 on success)
 */
export async function retryCommand({
  command,
  args = [],
  attempts = 3,
  delayMs = 5000,
  spawnFn = (cmd, cmdArgs) => spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: true }),
  sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logFn = (msg) => console.error(msg),
} = {}) {
  if (!command) {
    throw new Error('retryCommand: command is required');
  }
  if (attempts < 1) {
    throw new Error('retryCommand: attempts must be >= 1');
  }

  let lastCode = 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnFn(command, args);
    // spawnSync can report a launch failure (ENOENT etc.) via `.error` with no
    // `.status` — treat that the same as a non-zero exit rather than passing
    // `null` through as a truthy-looking "success".
    const code = result && typeof result.status === 'number' ? result.status : 1;

    if (code === 0) {
      if (attempt > 1) {
        logFn(`[retry-e2e] ${command} passed on attempt ${attempt}/${attempts}`);
      }
      return 0;
    }

    lastCode = code;
    logFn(`[retry-e2e] ${command} attempt ${attempt}/${attempts} failed (exit code ${code})`);

    if (attempt < attempts) {
      // Attempts must be sequential, not concurrent — this await is intentional.
      await sleepFn(delayMs);
    }
  }

  logFn(`[retry-e2e] ${command} failed after ${attempts} attempts (exit code ${lastCode})`);
  return lastCode;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isMain) {
  const code = await retryCommand({ command: 'vscode-test', args: [], attempts: 3, delayMs: 5000 });
  process.exit(code);
}
