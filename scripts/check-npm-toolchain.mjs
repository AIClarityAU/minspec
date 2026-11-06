#!/usr/bin/env node
/**
 * check-npm-toolchain.mjs — preinstall gate for the npm 10 arborist crash
 * (#2217).
 *
 * MECHANISM THIS GUARDS AGAINST: on npm 10.9.8 (the container's default, and
 * historically what Node 22 bundles), `npm install` — and any other command
 * that rebuilds the dependency tree (`npm update`, `npm uninstall`,
 * `npm dedupe`, `npm audit fix`, ...) — crashes inside `@npmcli/arborist`:
 *
 *   Cannot read properties of null (reading 'edgesOut')
 *
 * Root cause (per the #2214 agent's diagnosis): vitest's reciprocal peer pin
 * (`vitest` <-> `@vitest/coverage-v8`) after the 4.1.7 -> 4.1.11 bump trips
 * an npm 10 arborist bug that npm 11 does not have. `engines.npm` in
 * package.json documents the floor (`>=11.0.0`) but npm's own engines check
 * is advisory-only without `engine-strict` in `.npmrc` — and this repo's
 * sandbox will not let an agent write `.npmrc` (flagged as a credential-
 * bearing file), so the floor alone would print a warning and then crash
 * anyway, exactly the "nothing points at npm 11" failure this issue names.
 * A `preinstall` lifecycle script runs before npm resolves/builds the tree
 * (the same mechanism the `only-allow` package uses to block the wrong
 * package manager before any install activity starts), so it can turn the
 * crash into a clear, immediate, actionable failure instead.
 *
 * SCOPE: `npm ci` is deliberately exempt (checked via `npm_command`). It
 * installs straight from the lockfile without npm install's ideal-tree
 * rebuild and does not hit this bug — that is exactly why the workaround was
 * "regenerate the lockfile with npm 11, then `npm ci` on npm 10 installs
 * cleanly from it." Every CI workflow in this repo runs `npm ci`
 * exclusively (see .github/workflows/*.yml) — gating it here as well would
 * fail CI on the bundled npm version for zero benefit. This is a dev-
 * machine safety net, not a CI-required check.
 *
 * FAIL-OPEN when the npm version can't be determined (`npm_config_user_agent`
 * missing or unparseable — e.g. the script is invoked directly with `node`,
 * outside of npm, or a future npm changes the env var's format): a guess we
 * can't back up must never block a working install. This script exists to
 * turn a real crash into a clear message, not to become a new source of
 * false blocks.
 *
 * Usage: node scripts/check-npm-toolchain.mjs   (wired into `preinstall`)
 */

/** The npm major version this lockfile requires (matches package.json engines.npm). */
export const REQUIRED_NPM_MAJOR = 11;

/**
 * Parses the npm major version out of npm's own `npm_config_user_agent` env
 * var, e.g. `"npm/11.0.2 node/v22.23.2 linux x64 workspaces/false"` -> 11.
 * Returns null if the var is absent or doesn't match the expected shape —
 * never throws, so the caller can fail open on anything it can't parse.
 */
export function parseNpmMajor(userAgent) {
  if (!userAgent) return null;
  const match = /(?:^|\s)npm\/(\d+)\./.exec(userAgent);
  if (!match) return null;
  return Number(match[1]);
}

/**
 * Pure verdict function — takes an env-shaped object (so tests can inject
 * fixtures without spawning a real npm) and returns why it did or didn't
 * gate. Never reads `process.env` itself.
 */
export function checkNpmToolchain(env) {
  const npmMajor = parseNpmMajor(env.npm_config_user_agent);

  if (env.npm_command === 'ci') {
    return { ok: true, reason: 'npm-ci-exempt', npmMajor };
  }
  if (npmMajor === null) {
    return { ok: true, reason: 'npm-version-undetected', npmMajor: null };
  }
  if (npmMajor < REQUIRED_NPM_MAJOR) {
    return { ok: false, reason: 'npm-too-old', npmMajor };
  }
  return { ok: true, reason: 'npm-version-ok', npmMajor };
}

/** Renders the verdict exactly as the CLI prints it — one shared source of truth. */
export function formatReport(result) {
  if (result.ok) {
    switch (result.reason) {
      case 'npm-ci-exempt':
        return 'npm toolchain check skipped — `npm ci` does not hit the npm 10 arborist crash (#2217).';
      case 'npm-version-undetected':
        return 'npm toolchain check skipped — could not determine the npm version (not run via npm?).';
      default:
        return `npm toolchain check passed — npm ${result.npmMajor}.x satisfies the >=${REQUIRED_NPM_MAJOR} floor.`;
    }
  }
  return [
    `FAIL npm ${result.npmMajor}.x cannot install this lockfile — vitest's peer pin trips an npm ${result.npmMajor} ` +
      `arborist bug ("Cannot read properties of null (reading 'edgesOut')") that npm ${REQUIRED_NPM_MAJOR} does not have (#2217).`,
    `  Use npm ${REQUIRED_NPM_MAJOR}: \`npx npm@${REQUIRED_NPM_MAJOR} install\` (or install/activate npm ${REQUIRED_NPM_MAJOR}+ as your default).`,
    '  `npm ci` is unaffected and does not need npm 11.',
  ].join('\n');
}

function run() {
  const result = checkNpmToolchain(process.env);
  const report = formatReport(result);
  if (result.ok) {
    console.log(report);
    return 0;
  }
  console.error(report);
  return 1;
}

// Guarded so importing this module for its exports in tests does not also
// execute the CLI and call process.exit() out from under the test runner —
// same convention as scripts/check-node-modules-integrity.mjs.
const invokedDirectly = /check-npm-toolchain\.mjs$/.test(process.argv[1] ?? '');
if (invokedDirectly) {
  // DR-066 — no silent gate: a run that throws has NOT proved the toolchain
  // is fine, so it exits non-zero with the failure in full, never falls
  // through to a pass.
  let exitCode;
  try {
    exitCode = run();
  } catch (error) {
    console.error('FAIL npm toolchain check crashed — the gate did not run:');
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    exitCode = 1;
  }
  process.exit(exitCode);
}
