/**
 * run-tsx-cli.ts — deterministic subprocess spawn for CLI-under-test suites (#1032).
 *
 * WHY THIS EXISTS. `check-import-cycles-cli.test.ts`, `facts-cli.test.ts`, and
 * `validate-frontmatter-acceptance-criteria.test.ts` each spawn a `scripts/*.ts`
 * entrypoint as a real child process with `cwd` pointed at a throwaway fixture tree
 * OUTSIDE the repo — that is the point, it exercises the runner's own root discovery,
 * not an in-process import. All three used to do this via
 * `spawnSync('npx', ['tsx', SCRIPT], { cwd })`. Because `cwd` is a fixture tree with no
 * `node_modules` of its own, `npx` cannot resolve `tsx` by walking up from `cwd` — it
 * falls back to its own cross-invocation cache (`~/.npm/_npx`) or, if that's empty, a
 * registry fetch. Neither is something a Tier-0/offline gate (constitution invariant 1)
 * should depend on, and both are exactly the kind of machine-shared, environment-
 * dependent state that races under concurrent `npm`/`npx` activity.
 *
 * That race is what put `main` red at ce7d24a: `check-import-cycles-cli.test.ts` got
 * exit 127 ("command not found") — the CLI under test never ran, and `toBe(1)` was the
 * only assertion precise enough to notice (#1032). The two runs after it were green,
 * confirming it was environment-dependent, not a code regression.
 *
 * THE FIX. Resolve `tsx`'s own binary via an ABSOLUTE path under this repo's own
 * `node_modules/.bin`, computed from THIS file's location rather than from any child's
 * `cwd`. No `npx`, no PATH lookup, no npx-cache, no network. Already the proven pattern
 * in `migrate-approvals.test.ts` (#1037, the same failure class) and
 * `autonomy-merge-gate.test.ts` — this centralises it for the three CLI suites that
 * still spawned through `npx`.
 *
 * 126/127 ARE NOT GATE VERDICTS. A 126 ("found but not executable") or 127
 * ("not found") exit code means the child process never ran the code under test — a
 * broken test environment, not a verdict on the gate. Returning it to the caller like
 * any other exit code would let a sibling assertion of the shape `not.toBe(0)` /
 * `toBeGreaterThan(0)` pass on exactly this failure: green while the gate never ran,
 * the silent-gate shape DR-066 exists to rule out. `runTsxCli` throws instead, so a
 * spawn that never ran the target always surfaces as a distinct, loud test error —
 * never as a passing assertion, and never as a precisely-worded but wrong one.
 */
import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import * as path from 'path';

/** Repo root, resolved from this helper's own location — never from a child's cwd. */
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

/** This repo's own locally-installed `tsx` binary, resolved by absolute path. */
export const TSX_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

export interface CliResult {
  status: number | null;
  /** stdout and stderr together — these runners write passes to one, failures to the other. */
  output: string;
}

export interface RunTsxCliOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Spawn `scriptPath` under this repo's own `tsx`, deterministically resolved (see
 * module doc). Throws — rather than returning a result a caller might assert
 * non-zero-and-move-on over — if:
 *   - `scriptPath` doesn't exist (a typo'd path is not a gate verdict either),
 *   - the spawn itself errored (`result.error`, e.g. ENOENT on `TSX_BIN`), or
 *   - the process exited 126/127 (the target never ran).
 */
export function runTsxCli(scriptPath: string, args: string[], options: RunTsxCliOptions): CliResult {
  if (!existsSync(scriptPath)) {
    throw new Error(`runTsxCli: script under test does not exist: ${scriptPath}`);
  }
  if (!existsSync(TSX_BIN)) {
    throw new Error(`runTsxCli: tsx binary not found at ${TSX_BIN} — run \`npm ci\` first.`);
  }

  const result = spawnSync(TSX_BIN, [scriptPath, ...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf-8',
  });

  // A spawn that never started is not a gate verdict — rethrow rather than let it
  // read as a null exit code an assertion might squint at.
  if (result.error) throw result.error;

  if (result.status === 126 || result.status === 127) {
    throw new Error(
      `runTsxCli: ${scriptPath} exited ${result.status} — the CLI under test never ran ` +
        `(${result.status === 127 ? 'binary not found' : 'found but not executable'}), this is ` +
        `a broken test environment, not a gate verdict (#1032).\n` +
        `command: ${TSX_BIN} ${scriptPath} ${args.join(' ')}\n` +
        `stdout: ${result.stdout ?? ''}\nstderr: ${result.stderr ?? ''}`,
    );
  }

  return { status: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}
