/**
 * The bundle that gets packaged carries a build stamp (#1527).
 *
 * #1439 shipped the stamp and the staleness advisory; nothing asserted that the bundle
 * actually being packaged CONTAINED one. It did not: `packages/minspec/package.json` carried
 * two ways to bundle the same entry point — `build` (plain esbuild, no `--define`) and
 * `build:prod` (the stamping script) — and every caller except `npm run package` took the
 * unstamped one. That included the CI `package` job, whose .vsix is the artifact a third
 * party is most likely to install: in it `buildSha()` fell through to `'dev'`,
 * `detectBuildSkew` short-circuited to `not-applicable`, and the install was permanently
 * silent about running behind. A missing stamp is not a cosmetic gap — it disables the one
 * feature that exists to stop shipped gates from going quietly missing.
 *
 * These tests grep the built bundle for the stamped VALUE, and derive the expected value
 * from `git` rather than from the build's own log line — a build that reports a stamp it
 * did not inject must still fail here. Grepping for the identifier `__MINSPEC_BUILD_SHA__`
 * would prove nothing about a stamped bundle: `--define` substitutes at build time, so a
 * correctly stamped bundle contains that symbol ZERO times.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const PKG_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PKG_DIR, '../..');
const WORKFLOW_DIR = path.join(REPO_ROOT, '.github', 'workflows');
const SHARED_OUT_DIR = path.resolve(REPO_ROOT, 'packages/shared/out');
const SHARED_OUT_FILES = ['index.js', 'canonical.js'];

/** Give the real bundler room on a cold CI runner — this shells out to esbuild + tsc. */
const BUILD_TIMEOUT_MS = 300_000;

/**
 * The commit the build must claim. Computed independently of the build script so the two
 * cannot agree with each other while both being wrong. The optional `-dirty` suffix is the
 * script's own marker for a bundle built over uncommitted work.
 */
const HEAD_SHA = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: REPO_ROOT,
  stdio: ['ignore', 'pipe', 'ignore'],
})
  .toString()
  .trim();
const STAMP_RE = new RegExp(`"${HEAD_SHA}(-dirty)?"`);

let tmpDir: string;
let build: { status: number | null; output: string };
let bundleText = '';
let sharedOutBefore: Record<string, { mtimeMs: number; content: Buffer } | null> = {};
let sharedOutAfter: Record<string, { mtimeMs: number; content: Buffer } | null> = {};

/**
 * Snapshot mtime + content of shared's built output, not just mtime alone — a rewrite that
 * happens to land the same bytes at a new mtime would still prove the isolation claim wrong
 * (the file was touched), so both signals are checked independently in the assertion.
 */
function snapshotSharedOut(): typeof sharedOutBefore {
  const snapshot: typeof sharedOutBefore = {};
  for (const name of SHARED_OUT_FILES) {
    const file = path.join(SHARED_OUT_DIR, name);
    snapshot[name] = fs.existsSync(file)
      ? { mtimeMs: fs.statSync(file).mtimeMs, content: fs.readFileSync(file) }
      : null;
  }
  return snapshot;
}

/**
 * Run the extension build the way CI's `package` job does — `npm run build`, the DEFAULT
 * build script, not the stamping script by name. That distinction IS the defect: invoking
 * `scripts/build-extension.sh` directly would prove only that the script works, which was
 * never in doubt, while leaving the path CI actually takes untested.
 *
 * Output goes to a temp file rather than `out/extension.js` so a parallel test file reading
 * the real bundle (no-app-private-key-shipped.test.ts) cannot observe a half-written one.
 * The stamp does not depend on the output path.
 *
 * `--ignore-scripts` (#2244): without it, npm also runs `build`'s `prebuild` hook
 * (`build:shared`, `tsc -p ../shared/tsconfig.json`), which rewrites the live
 * `packages/shared/out/*.js` in place — `openSync(file, 'w')` then `writeSync`, so each
 * output is briefly empty — while vitest runs OTHER test files in parallel. A spawned tsx
 * child in one of those files that resolves `@aiclarity/shared` (through its `main` field,
 * `out/index.js` — the `src` alias in vitest.config.ts only applies inside vitest itself)
 * during that window gets `{}` back, and any shared export it calls is `undefined`.
 * `--ignore-scripts` skips `prebuild` while still running the named `build` script (verified
 * on npm 10.9.8), so this test never touches `packages/shared/out`. Nothing this file asserts
 * depends on `prebuild` having run: CI and `pretest` already build shared before vitest
 * starts, so `out/` is current by the time this test runs, and the build-stamp property it
 * guards lives entirely in `build-extension.sh`.
 */
function runBuild(extraArgs: string[]): { status: number | null; output: string } {
  const res = spawnSync('npm', ['run', 'build', '--ignore-scripts', '--', ...extraArgs], {
    cwd: PKG_DIR,
    encoding: 'utf-8',
    timeout: BUILD_TIMEOUT_MS,
  });
  return { status: res.status, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

beforeAll(() => {
  // Deliberately no assertions here: a throwing hook reports every test in the file as
  // skipped, which hides WHICH property broke. Capture, then assert in the tests.
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-build-stamp-'));
  const outfile = path.join(tmpDir, 'extension.js');
  sharedOutBefore = snapshotSharedOut();
  build = runBuild([`--outfile=${outfile}`]);
  sharedOutAfter = snapshotSharedOut();
  if (fs.existsSync(outfile)) bundleText = fs.readFileSync(outfile, 'utf-8');
}, BUILD_TIMEOUT_MS);

afterAll(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('the default build emits a stamped bundle (#1527)', () => {
  it('builds, and says which commit it stamped', () => {
    expect(build.status, `npm run build failed:\n${build.output}`).toBe(0);
    expect(build.output).toMatch(
      new RegExp(`build-extension: stamping build with ${HEAD_SHA}(-dirty)?`),
    );
  });

  it('bakes the commit into the bundle as a string literal', () => {
    // Non-vacuity guard: an empty/absent bundle must not let the greps below pass by
    // having nothing to match.
    expect(bundleText.length, 'no bundle was emitted to grep').toBeGreaterThan(1000);
    expect(bundleText).toMatch(STAMP_RE);
  });

  it('substitutes the identifier away, so a symbol-name grep proves nothing', () => {
    expect(bundleText.length, 'no bundle was emitted to grep').toBeGreaterThan(1000);
    // Asserted rather than merely commented: `__MINSPEC_BUILD_SHA__` survives only when the
    // define was NOT applied, so its absence is corroborating evidence — and its presence is
    // exactly what the unstamped CI artifact contained.
    expect(bundleText).not.toContain('__MINSPEC_BUILD_SHA__');
  });

  it(
    'fails closed, and loudly, when the stamp does not reach the bundle (SPEC-060 INV-1)',
    () => {
      // Override the define so the stamp cannot land, and assert the build REFUSES to emit
      // rather than shipping a silent bundle. Without this the guard itself is unproven — an
      // emit-anyway build is indistinguishable from a working one until someone installs it.
      const { status, output } = runBuild([
        `--outfile=${path.join(tmpDir, 'unstamped.js')}`,
        '--define:__MINSPEC_BUILD_SHA__=undefined',
      ]);
      expect(status, `expected a non-zero exit, got ${status}:\n${output}`).not.toBe(0);
      expect(output).toContain('does not contain the build stamp');
    },
    BUILD_TIMEOUT_MS,
  );
});

describe("the build doesn't rewrite shared's live output mid-suite (#2244)", () => {
  it('leaves packages/shared/out/index.js and canonical.js untouched', () => {
    for (const name of SHARED_OUT_FILES) {
      const before = sharedOutBefore[name];
      const after = sharedOutAfter[name];
      expect(before, `${name} must already be built before this test runs`).not.toBeNull();
      expect(after, `${name} vanished during the build`).not.toBeNull();
      expect(after!.mtimeMs, `${name} was rewritten (mtime changed)`).toBe(before!.mtimeMs);
      expect(
        after!.content.equals(before!.content),
        `${name} was rewritten (content changed)`,
      ).toBe(true);
    }
  });
});

describe('one bundling path — nothing can produce an unstamped bundle (#1527)', () => {
  const scripts: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf-8'),
  ).scripts;

  it('no npm script invokes esbuild directly', () => {
    // The regression in one line: a second esbuild command line, alongside the stamping
    // script, that silently loses the `--define`.
    const raw = Object.entries(scripts).filter(([, cmd]) => /\besbuild\b/.test(cmd));
    expect(
      raw,
      'bundle only through scripts/build-extension.sh — a rival esbuild command line drifts out of stamp',
    ).toEqual([]);
  });

  it('every script that bundles routes through the stamped build', () => {
    expect(scripts.build).toContain('scripts/build-extension.sh');
    for (const name of ['build:prod', 'watch', 'package', 'pretest:e2e']) {
      expect(scripts[name], `${name} must bundle via the stamped build`).toContain(
        'npm run build',
      );
    }
  });

  it('packaging cannot skip the build', () => {
    // `vsce package` bundles nothing itself — it archives whatever `out/` already holds, so
    // a bare `vsce package` ships the last build made, stamped or not.
    expect(scripts.package).toMatch(/npm run build\s*&&\s*vsce package/);
  });
});

describe('CI cannot reintroduce an unstamped bundle (#1527)', () => {
  const workflows = fs
    .readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => ({ name: f, text: fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf-8') }));

  it('reads at least one workflow (the sweeps below are not vacuous)', () => {
    expect(workflows.length).toBeGreaterThan(0);
  });

  it('no workflow bundles the extension with a raw esbuild call', () => {
    // The npm scripts are the only bundling path now, so a workflow calling esbuild itself
    // would be a second one — reopening this defect from the CI side, which is where the
    // artifact that other people download is produced.
    const offenders = workflows
      .filter(({ text }) => /(^|[^-\w])(npx\s+)?esbuild\s/.test(text))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  it('every workflow that packages a .vsix builds through an npm script first', () => {
    const offenders = workflows
      .filter(({ text }) => /vsce package/.test(text))
      .filter(({ text }) => !/npm run (build|package)\b/.test(text))
      .map(({ name }) => name);
    expect(
      offenders,
      'a job that packages without running the npm build uploads whatever out/ happens to hold',
    ).toEqual([]);
  });
});
