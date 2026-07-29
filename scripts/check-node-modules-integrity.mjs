#!/usr/bin/env node
/**
 * check-node-modules-integrity.mjs — pretest guard against a reaper-stripped
 * `node_modules` (#1038).
 *
 * WHAT THIS GUARDS AGAINST: a host-side core-dump reaper (outside the
 * container, outside this repo — nothing here can fix it) periodically
 * deletes every file literally named `core.*` anywhere it walks, with no
 * `node_modules` prune — e.g. `find … -name 'core.*' -delete`. It has hit
 * this checkout at least twice (2026-07-17, 2026-07-28). Every OTHER file in
 * a stripped package is untouched — only its `core.*` siblings vanish — so
 * the first symptom is always a vitest/tsc startup crash naming some
 * unrelated package's `core.js`/`core.json`:
 *
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find module
 *   '.../node_modules/obug/dist/core.js' imported from '.../node_modules/obug/dist/node.js'
 *
 * That message reads like a dependency/version bug and invites chasing the
 * lockfile — a fresh diagnosis every recurrence, even though the fix is
 * always the same one-liner. This is a *recognition* guard, not a prevention
 * one (the reaper isn't reachable from in here, so there is no gate to close
 * at the source): wired as the first step of `npm run pretest`, it checks a
 * fixed handful of `core.*` paths this lockfile's `npm ci` is known to
 * produce and, if any are missing, fails with the actual instruction instead
 * of letting the cryptic downstream crash fire and cost another diagnosis.
 *
 * Deliberately NOT a `find node_modules -name 'core.*'` tree walk — that
 * would cost real time on every single `npm test` run forever, to guard
 * against an event that has fired twice. A fixed sentinel list is O(ms).
 *
 * Usage: node scripts/check-node-modules-integrity.mjs   (wired into `pretest`)
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `core.*` files this lockfile's `npm ci` is known to produce — one per
 * TOP-LEVEL package (never nested inside another package's own
 * `node_modules`, which shifts with hoisting/dedup on every `npm install`
 * and would make a fixed list fragile). Picked from the ~25 such files a
 * reaper sweep stripped on this checkout (2026-07-28): every one below is a
 * real, currently-installed dependency (js-yaml, lodash, and ajv arrive
 * transitively; obug via vitest).
 *
 * If a future `npm install` drops one of these packages outright, update
 * this list in the same PR — a deliberate edit, not silent drift.
 */
export const SENTINELS = [
  'js-yaml/lib/schema/core.js',
  'lodash/core.js',
  'obug/dist/core.js',
  'magicast/dist/core.js',
  '@babel/types/lib/definitions/core.js',
];

/**
 * Checks every sentinel under `<root>/node_modules`. Pure — only reads the
 * filesystem, never writes or exits, so tests can assert on the verdict
 * without spawning a process for every case.
 *
 * `nodeModulesMissing` is reported separately from a stripped tree: an
 * absent `node_modules` means this checkout was never `npm ci`'d, which is
 * NOT the reaper — collapsing the two into one message would misdiagnose a
 * plain fresh checkout as reaper damage (RCDD: name the actual mechanism,
 * not a guess).
 */
export function checkNodeModulesIntegrity(root) {
  const nodeModules = join(root, 'node_modules');
  if (!existsSync(nodeModules)) {
    return { ok: false, nodeModulesMissing: true, missing: [...SENTINELS] };
  }
  const missing = SENTINELS.filter((rel) => !existsSync(join(nodeModules, rel)));
  return { ok: missing.length === 0, nodeModulesMissing: false, missing };
}

/** Renders the verdict exactly as the CLI prints it — one shared source of truth. */
export function formatReport(result) {
  if (result.ok) {
    return `node_modules integrity check passed — ${SENTINELS.length} core.* sentinel(s) present.`;
  }
  if (result.nodeModulesMissing) {
    return 'FAIL node_modules not found — run `npm ci`.';
  }
  return [
    'FAIL node_modules has been stripped of core.* files (host core-dump reaper) — run `npm ci`.',
    ...result.missing.map((rel) => `  missing: node_modules/${rel}`),
  ].join('\n');
}

function run() {
  const result = checkNodeModulesIntegrity(process.cwd());
  const report = formatReport(result);
  if (result.ok) {
    console.log(report);
    return 0;
  }
  console.error(report);
  return 1;
}

// Guarded so importing this module (e.g. for its SENTINELS list in tests)
// does not also execute the CLI and call process.exit() out from under the
// test runner — same convention as scripts/fix-feat-tripwire.ts.
const invokedDirectly = /check-node-modules-integrity\.mjs$/.test(process.argv[1] ?? '');
if (invokedDirectly) {
  // DR-066 — no silent gate: a run that throws has NOT proved node_modules
  // intact, so it exits non-zero with the failure in full, never falls
  // through to a pass (mirrors scripts/check-import-cycles.ts's crash handler).
  let exitCode;
  try {
    exitCode = run();
  } catch (error) {
    console.error('FAIL node_modules integrity check crashed — the gate did not run:');
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    exitCode = 1;
  }
  process.exit(exitCode);
}
