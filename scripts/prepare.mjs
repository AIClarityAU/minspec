#!/usr/bin/env node
/**
 * prepare.mjs — the monorepo's `npm install`/`npm ci` lifecycle script (#2671, #1530).
 *
 * Replaces the old inline `prepare` one-liner:
 *
 *   git config core.hooksPath .githooks || true && npm run build --workspace=@aiclarity/shared
 *
 * ── Root cause (#2671) ────────────────────────────────────────────────────────
 * That `|| true` is a load-bearing gate signal written with a swallowed error —
 * constitution invariant 2 ("no silent gate") forbids exactly this. If `git config`
 * failed (no `.git`, a read-only `.git/config`, …), `prepare` still exited 0, so
 * `npm install` reported success over a clone with every commit-time gate (secret
 * scan, spec-frontmatter check, RCDD root-cause gate) silently absent. The checker
 * that enforces clause 1 (scripts/check-swallowed-gate-signal.ts) only ever walked
 * `.sh` files, so a swallow written inside a `package.json` script string was
 * structurally outside what it could see (closed by extending it — see that file).
 *
 * ── Two independent steps, each fails on its own exit code ────────────────────
 * 1. Build `@aiclarity/shared`, so `packages/shared/out/` exists the moment
 *    `npm install` finishes (#1530). A build failure must abort — `out/` missing is
 *    a real defect every other consumer (facts CLI, a plain `node`/`tsx` import)
 *    hits immediately.
 * 2. Point `core.hooksPath` at `.githooks`. A failure here must be LOUD (clear
 *    message, non-zero exit) rather than silently absorbed.
 *
 * Both run regardless of the other's outcome: a hooks-install failure must not
 * leave `out/` missing (that would reopen #1530), and a build failure must not be
 * hidden behind a hooks success (that would reopen the exact defect clause 1
 * forbids, just moved one line down). The script's own exit code is non-zero if
 * EITHER step failed, so `npm install` itself goes red — never quietly green over a
 * half-broken clone.
 */

import { execFileSync } from 'node:child_process';

/**
 * Run one step. Never throws — returns whether it succeeded, after printing the
 * real subprocess output (inherited stdio) and, on failure, one labelled line so
 * the two steps' outcomes aren't confused with each other in the combined log.
 *
 * `exec` is injectable so unit tests can assert the control flow (does step 2 run
 * when step 1 fails? does the combined exit code reflect each outcome?) without
 * spawning a real `npm`/`git` subprocess for every case.
 */
export function runStep(label, cmd, args, exec = execFileSync) {
  try {
    exec(cmd, args, { stdio: 'inherit' });
    return true;
  } catch {
    console.error(`\n✖ ${label} failed (see output above).\n`);
    return false;
  }
}

/**
 * Run both prepare steps and report the combined verdict. Pure with respect to
 * its `exec` dependency — the CLI block below supplies the real one and reads
 * `process.exitCode` from the result.
 */
export function runPrepare(exec = execFileSync) {
  const buildOk = runStep(
    'Building @aiclarity/shared',
    'npm',
    ['run', 'build', '--workspace=@aiclarity/shared'],
    exec,
  );

  const hooksOk = runStep(
    'Installing git hooks (core.hooksPath=.githooks)',
    'git',
    ['config', 'core.hooksPath', '.githooks'],
    exec,
  );

  if (!hooksOk) {
    console.error(
      'git hooks are NOT installed in this clone: the secret scan, the spec-frontmatter\n' +
        'check, and the RCDD root-cause gate (.githooks/*) will not run on commit. Fix the\n' +
        'error above, then re-run: npm run prepare\n',
    );
  }

  return { buildOk, hooksOk, ok: buildOk && hooksOk };
}

// Guarded so importing this module for its exported functions (tests) does not
// also run the real steps and call process.exit() out from under the test runner
// — same convention as scripts/check-node-modules-integrity.mjs.
const invokedDirectly = /prepare\.mjs$/.test(process.argv[1] ?? '');
if (invokedDirectly) {
  // DR-066 — no silent gate: a run that throws has NOT proved both steps ok, so it
  // exits non-zero with the failure in full, never falls through to a pass.
  let exitCode;
  try {
    exitCode = runPrepare().ok ? 0 : 1;
  } catch (error) {
    console.error('FAIL prepare crashed — the gate did not run:');
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    exitCode = 1;
  }
  process.exit(exitCode);
}
