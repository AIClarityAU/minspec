/**
 * auto-merge-gate.test.ts — SPEC-024 IO/exec layer safety proof.
 *
 * The pure decision (`decideAutoMerge`) is proven in auto-merge.test.ts. THIS
 * file pins the IMPURE gate (`scripts/auto-merge-gate.ts`) that feeds it — the
 * layer the 4-lens adversarial review found real wrong-merge paths in:
 *
 *   - BLOCKER 1  manifest blind spot: `detectManifestChange` injects a high-blast
 *                signal for a package.json / lockfile / workspace-manifest diff so
 *                a supply-chain change can never classify low-blast.
 *   - BLOCKER 2  prover false-proof: base 'red' means EXECUTED-AND-FAILED
 *                (`baseRedVerdict`); an import-failure / broken-base / green-base
 *                is NOT proven; a base-prep failure ABORTS to not-proven.
 *   - MAJOR 4    kill-switch fail-open: `resolveMode` / `parseArgs` deny-by-default
 *                — only the EXACT token `consequence-hybrid` enables auto-merge.
 *   - MAJOR 5    git-diff swallow: `buildChangedFiles` THROWS on a git failure
 *                (→ main() emits a fail-safe HOLD) instead of yielding 0 files.
 *   - #422       CI/build boundary blind spot (same class as BLOCKER 1):
 *                `detectBoundaryChange` injects a high-blast signal for
 *                `.github/workflows/*`, `.npmrc`/`.yarnrc*`, `tsconfig*.json`,
 *                `.githooks/*`/`.husky/*` (git hooks run arbitrary shell on
 *                commit/push — this repo's `.githooks/commit-msg` is the RCDD
 *                gate), and other CI/build config the public-API analyzer never
 *                sees, so a workflow or hook whose only sink is `run: curl … | sh`
 *                (no SENSITIVE_TERM) cannot classify low-blast.
 *
 * The prover's decision logic is exercised DETERMINISTICALLY via injected deps
 * (`ProverDeps`) — a flaky nested-vitest test on the highest-consequence code
 * would itself be a liability. Each injected scenario reproduces exactly one of
 * the four adversarial cases.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  resolveMode,
  parseArgs,
  headGreenVerdict,
  baseRedVerdict,
  testNotSelected,
  toVitestNamePattern,
  proveRegression,
  detectManifestChange,
  isBoundaryPath,
  detectBoundaryChange,
  detectLowBlastDocsTest,
  buildChangedFiles,
  appendAudit,
  applyAuditFailsafe,
  type VitestRun,
  type ProverDeps,
} from '../../../scripts/auto-merge-gate';
import type { AutoMergeDecision } from '../src/lib/auto-merge';
import { decideAutoMerge } from '../src/lib/auto-merge';
import type { ChangedFile } from '../src/lib/consequence-analyzers';
import type { ClassificationSignal } from '../src/lib/classifier';
import type { ReviewSignalsInput } from '@aiclarity/shared';

// ─── Factories ───────────────────────────────────────────────────────────────

function vr(over: Partial<VitestRun> = {}): VitestRun {
  return { numTotal: 1, numPassed: 1, numFailed: 0, exitCode: 0, files: [], ...over };
}
const GREEN = vr({ numTotal: 1, numPassed: 1, numFailed: 0, exitCode: 0 });
const RED_ASSERTION = vr({ numTotal: 1, numPassed: 0, numFailed: 1, exitCode: 1 });
/** Test FAILED TO LOAD on base (imports a head-only symbol): 0 collected, non-zero exit. */
const INCONCLUSIVE_LOAD_ERROR = vr({ numTotal: 0, numPassed: 0, numFailed: 0, exitCode: 1 });

const WT = '/fake/worktree';

/** A dep set whose runner returns `head` for the head worktree and `base` for the
 *  (internal, tmp) base dir. prepareBase/removeBase are spy-able no-ops. */
function deps(
  head: VitestRun,
  base: VitestRun,
  over: Partial<ProverDeps> & { prepareCalls?: string[]; removeCalls?: string[] } = {},
): ProverDeps {
  return {
    runNamedTest: (dir) => (dir === WT ? head : base),
    prepareBase: over.prepareBase ?? (() => { over.prepareCalls?.push('prepared'); }),
    removeBase: over.removeBase ?? (() => { over.removeCalls?.push('removed'); }),
  };
}

const REG = 'foo.test.ts > rejects the bad state';

// ─── MAJOR 4 — kill-switch deny-by-default ───────────────────────────────────

describe('SPEC-024 MAJOR 4 — mode resolution is deny-by-default (no fail-open)', () => {
  it.each([
    ['pr-gate', 'pr-gate'],
    ['PR-gate', 'pr-gate'],
    ['Consequence-Hybrid', 'pr-gate'], // different case is NOT the exact token
    ['CONSEQUENCE-HYBRID', 'pr-gate'],
    ['consequence_hybrid', 'pr-gate'], // underscore ≠ hyphen
    ['hybrid', 'pr-gate'],
    ['', 'pr-gate'],
    ['xyz', 'pr-gate'],
    ['  ', 'pr-gate'],
    [undefined, 'pr-gate'], // absent ⇒ default HOLD
    ['consequence-hybrid', 'consequence-hybrid'], // the ONE enabling value
    ['  consequence-hybrid  ', 'consequence-hybrid'], // trimmed
  ])('resolveMode(%p) → %s', (input, expected) => {
    expect(resolveMode(input as string | undefined)).toBe(expected);
  });

  it('parseArgs with no --mode → pr-gate (auto-merge OFF by default)', () => {
    expect(parseArgs(['--worktree', WT, '--base', 'origin/main']).mode).toBe('pr-gate');
  });

  it('parseArgs with --mode garbage → pr-gate', () => {
    expect(parseArgs(['--mode', 'yolo']).mode).toBe('pr-gate');
  });

  it('parseArgs with the exact opt-in token → consequence-hybrid', () => {
    expect(parseArgs(['--mode', 'consequence-hybrid']).mode).toBe('consequence-hybrid');
  });
});

// ─── BLOCKER 2a — the red / green verdict predicates ─────────────────────────

describe('SPEC-024 BLOCKER 2 — baseRedVerdict requires an EXECUTED assertion failure', () => {
  it('a real assertion failure (0 passed, ≥1 failed) → red', () => {
    expect(baseRedVerdict(vr({ numTotal: 1, numPassed: 0, numFailed: 1 }))).toBe(true);
  });

  it('a load/collection error on base (0 collected, non-zero exit) → NOT red (inconclusive)', () => {
    // This is THE false-proof the old predicate allowed: it counted
    // `numTotal===0 && exitCode!==0` as red. The fix drops that branch.
    expect(baseRedVerdict(INCONCLUSIVE_LOAD_ERROR)).toBe(false);
  });

  it('a passing test → NOT red', () => {
    expect(baseRedVerdict(GREEN)).toBe(false);
  });

  it('0 total / exit 0 → NOT red', () => {
    expect(baseRedVerdict(vr({ numTotal: 0, numPassed: 0, numFailed: 0, exitCode: 0 }))).toBe(false);
  });
});

describe('SPEC-024 — headGreenVerdict requires an EXECUTED pass', () => {
  it('executed and passed → green', () => {
    expect(headGreenVerdict(vr({ numTotal: 1, numPassed: 1, numFailed: 0 }))).toBe(true);
  });
  it('any failure → not green', () => {
    expect(headGreenVerdict(vr({ numTotal: 1, numPassed: 0, numFailed: 1 }))).toBe(false);
  });
  it('nothing collected → not green', () => {
    expect(headGreenVerdict(vr({ numTotal: 0, numPassed: 0, numFailed: 0 }))).toBe(false);
  });
});

// ─── BLOCKER 2 — proveRegression end-to-end decision (injected deps) ─────────

describe('SPEC-024 BLOCKER 2 — proveRegression cannot be fooled into a false proof', () => {
  it('genuine behavioural red→green (fails on base, passes on head) → PROVEN', () => {
    const removeCalls: string[] = [];
    const r = proveRegression(WT, 'BASE', REG, deps(GREEN, RED_ASSERTION, { removeCalls }));
    expect(r.regressionProvenBaseRed).toBe(true);
    expect(r.regressionGreenOnHead).toBe(true);
    expect(removeCalls).toContain('removed'); // base worktree always cleaned up
  });

  it('test imports a head-only symbol → import-failure on base → NOT proven', () => {
    const r = proveRegression(WT, 'BASE', REG, deps(GREEN, INCONCLUSIVE_LOAD_ERROR));
    expect(r.regressionProvenBaseRed).toBe(false);
    expect(r.regressionGreenOnHead).toBe(false);
    expect(r.note).toMatch(/passed or inconclusive/);
  });

  it('broken base env (base-prep / symlink fails) → NOT proven, base never run', () => {
    let baseRuns = 0;
    const removeCalls: string[] = [];
    const r = proveRegression(WT, 'BASE', REG, {
      runNamedTest: (dir) => {
        if (dir !== WT) baseRuns++;
        return GREEN;
      },
      prepareBase: () => {
        throw new Error('symlink EACCES');
      },
      removeBase: () => {
        removeCalls.push('removed');
      },
    });
    expect(r.regressionProvenBaseRed).toBe(false);
    expect(r.note).toMatch(/base preparation failed/);
    expect(baseRuns).toBe(0); // a half-prepared base is never executed
    expect(removeCalls).toContain('removed'); // still cleaned up
  });

  it('non-regression: test passes on base too → NOT proven', () => {
    const r = proveRegression(WT, 'BASE', REG, deps(GREEN, GREEN));
    expect(r.regressionProvenBaseRed).toBe(false);
    expect(r.note).toMatch(/passed or inconclusive/);
  });

  it('flaky on base (verdict differs across the two runs) → NOT proven', () => {
    let baseCall = 0;
    const r = proveRegression(WT, 'BASE', REG, {
      runNamedTest: (dir) => {
        if (dir === WT) return GREEN;
        baseCall += 1;
        return baseCall === 1 ? RED_ASSERTION : GREEN; // red then green
      },
      prepareBase: () => {},
      removeBase: () => {},
    });
    expect(r.regressionProvenBaseRed).toBe(false);
    expect(r.note).toMatch(/non-deterministic on base/);
  });

  it('named test not selected on head (0 collected) → NOT proven', () => {
    const r = proveRegression(WT, 'BASE', REG, deps(vr({ numTotal: 0, numPassed: 0 }), RED_ASSERTION));
    expect(r.regressionProvenBaseRed).toBe(false);
    expect(r.note).toMatch(/not selectable on head/);
  });

  it('#513 — a SKIPPED head run (file matched, -t hit no test) → not-found/inconclusive, NOT red', () => {
    // vitest reports an unmatched `-t` as SKIPPED, not absent: numTotal 1 with
    // 0 passed / 0 failed / 1 pending. The old `numTotal === 0` guard missed this
    // shape, so `headGreenVerdict` read it as a false "RED on head". It must now be
    // surfaced as a selection miss — never classified red.
    const SKIPPED = vr({ numTotal: 1, numPassed: 0, numFailed: 0, exitCode: 0 });
    const r = proveRegression(WT, 'BASE', REG, deps(SKIPPED, RED_ASSERTION));
    expect(r.regressionProvenBaseRed).toBe(false);
    expect(r.regressionGreenOnHead).toBe(false);
    expect(r.note).toMatch(/not selectable on head/);
    expect(r.note).not.toMatch(/RED on head/);
  });

  it('red on head (the fix does not actually pass) → NOT proven', () => {
    const r = proveRegression(WT, 'BASE', REG, deps(RED_ASSERTION, RED_ASSERTION));
    expect(r.regressionProvenBaseRed).toBe(false);
    expect(r.note).toMatch(/RED on head/);
  });

  it('no regression test named → NOT proven', () => {
    const r = proveRegression(WT, 'BASE', '', deps(GREEN, RED_ASSERTION));
    expect(r.regressionProvenBaseRed).toBe(false);
    expect(r.note).toMatch(/nothing to prove/);
  });
});

// ─── #513 — `-t` selection format + skipped≠red predicates ───────────────────

describe('#513 — toVitestNamePattern matches vitest space-joined full name', () => {
  it('normalizes ` > ` separators in the name portion to single spaces', () => {
    expect(toVitestNamePattern('outer group > inner > rejects the bad state')).toBe(
      'outer group inner rejects the bad state',
    );
  });

  it('regex-escapes metacharacters so titles match literally (parens/dots)', () => {
    // `(v1.2)` unescaped is a capture group + wildcard `.` → matches nothing
    // against the literal `(v1.2)` in the name. Escaped, it matches literally.
    expect(toVitestNamePattern('outer group > inner (v1.2) > rejects the #bad state')).toBe(
      'outer group inner \\(v1\\.2\\) rejects the #bad state',
    );
  });

  it('a name with no ` > ` is passed through (escaped) unchanged in structure', () => {
    expect(toVitestNamePattern('plain name + suffix')).toBe('plain name \\+ suffix');
  });

  it('the escaped pattern actually matches its source string as a RegExp (vitest semantics)', () => {
    // vitest compiles `-t` via `new RegExp(pattern)` (no flags) and matches it
    // against the SPACE-joined full name with `.match`. Prove the round-trip.
    const fullName = 'outer group inner (v1.2) rejects the #bad state';
    const docId = 'outer group > inner (v1.2) > rejects the #bad state';
    expect(fullName.match(new RegExp(toVitestNamePattern(docId)))).not.toBeNull();
    // The OLD (unescaped, ` > `-joined) pattern matches NOTHING — the #513 bug.
    expect(fullName.match(new RegExp(docId))).toBeNull();
  });
});

describe('#513 — testNotSelected folds 0-collected AND skipped into one selection-miss', () => {
  it('0 collected (numTotal 0) → not selected', () => {
    expect(testNotSelected(vr({ numTotal: 0, numPassed: 0, numFailed: 0 }))).toBe(true);
  });
  it('vitest skipped-reporting (numTotal 1, 0 passed, 0 failed) → not selected', () => {
    expect(testNotSelected(vr({ numTotal: 1, numPassed: 0, numFailed: 0 }))).toBe(true);
  });
  it('a real failure (numFailed ≥ 1) is NOT a selection miss (it is a genuine red)', () => {
    expect(testNotSelected(RED_ASSERTION)).toBe(false);
  });
  it('a pass is NOT a selection miss', () => {
    expect(testNotSelected(GREEN)).toBe(false);
  });
});

// ─── #513 — REAL prover path (NO runNamedTest mock) over a nested-describe fixture
//
// Every other prover test injects `runNamedTest`, so the actual vitest `-t`
// selection was never exercised — which is why #513 shipped. These two spawn the
// REAL `runNamedTest` (real `npx vitest` subprocesses) against a hermetic tmp
// fixture with a genuine NESTED `describe` and metacharacters in the titles (the
// exact shape the ` > `-joined pattern broke). Only base-PREP is injected (a tmp
// dir with the OLD source + the head test overlaid — the real RCDD red→green
// setup, minus the `git worktree add` that is not the code under test).
// ─────────────────────────────────────────────────────────────────────────────

/** Locate the hoisted `node_modules/vitest` by walking up from cwd. */
function findRootNodeModules(start: string): string {
  let dir = start;
  for (let i = 0; i < 64; i++) {
    const nm = path.join(dir, 'node_modules');
    if (fs.existsSync(path.join(nm, 'vitest'))) return nm;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate node_modules/vitest from ${start}`);
}

const NESTED_TEST_SRC =
  `import { describe, it, expect } from 'vitest';\n` +
  `import { answer } from './subject';\n` +
  `describe('outer group', () => {\n` +
  `  describe('inner (v1.2)', () => {\n` +
  `    it('rejects the #bad state', () => { expect(answer()).toBe(42); });\n` +
  `  });\n` +
  `});\n`;

const VITEST_CFG = `import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { include: ['**/*.test.ts'] } });\n`;

/** Build a hermetic HEAD fixture dir with the CORRECT source (answer → 42). */
function makeHeadFixture(nodeModules: string): string {
  const headDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-513-head-'));
  fs.symlinkSync(nodeModules, path.join(headDir, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(headDir, 'vitest.config.ts'), VITEST_CFG);
  fs.writeFileSync(path.join(headDir, 'subject.ts'), `export function answer(): number { return 42; }\n`);
  fs.writeFileSync(path.join(headDir, 'regression.test.ts'), NESTED_TEST_SRC);
  return headDir;
}

/** Base-prep dep: tmp dir with the OLD source (answer → 41) + head test overlaid. */
function makeBasePrep(headDir: string, nodeModules: string, cleanup: string[]): ProverDeps {
  return {
    prepareBase: (worktree, _base, baseDir, overlayFiles) => {
      fs.mkdirSync(baseDir, { recursive: true });
      cleanup.push(baseDir);
      fs.symlinkSync(nodeModules, path.join(baseDir, 'node_modules'), 'dir');
      fs.copyFileSync(path.join(headDir, 'vitest.config.ts'), path.join(baseDir, 'vitest.config.ts'));
      // OLD source: returns 41, so the overlaid (head) test FAILS on base → red.
      fs.writeFileSync(path.join(baseDir, 'subject.ts'), `export function answer(): number { return 41; }\n`);
      for (const abs of overlayFiles) {
        const rel = path.relative(worktree, abs);
        const dest = path.join(baseDir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(abs, dest);
      }
    },
    removeBase: (_wt, baseDir) => {
      fs.rmSync(baseDir, { recursive: true, force: true });
    },
  };
}

describe('#513 — REAL prover path over a genuine nested-describe fixture (no runNamedTest mock)', () => {
  const NODE_MODULES = findRootNodeModules(process.cwd());
  // doc-format id the dispatch passes: `file > describe > describe > it`, ` > `-joined.
  const REG_NESTED = 'regression.test.ts > outer group > inner (v1.2) > rejects the #bad state';

  it(
    '(a) nested-describe test red-on-base / green-on-head → PROVEN (regression-unproven cleared)',
    () => {
      const cleanup: string[] = [];
      const headDir = makeHeadFixture(NODE_MODULES);
      cleanup.push(headDir);
      try {
        const r = proveRegression(headDir, 'BASE', REG_NESTED, makeBasePrep(headDir, NODE_MODULES, cleanup));
        // Before the fix the ` > `-joined `-t` selected NOTHING → head read as a
        // false RED → NOT proven. With the fix the nested test is selected, green
        // on head, red on base → genuinely PROVEN.
        expect(r.regressionGreenOnHead).toBe(true);
        expect(r.regressionProvenBaseRed).toBe(true);
        expect(r.note).toMatch(/proven red→green/);
      } finally {
        for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it(
    '(b) a mis-named / unmatched nested test → not-found/inconclusive, NEVER classified red',
    () => {
      const cleanup: string[] = [];
      const headDir = makeHeadFixture(NODE_MODULES);
      cleanup.push(headDir);
      try {
        const MISNAMED = 'regression.test.ts > outer group > inner (v1.2) > NO SUCH title';
        const r = proveRegression(headDir, 'BASE', MISNAMED, makeBasePrep(headDir, NODE_MODULES, cleanup));
        // Real vitest reports the unmatched `-t` as SKIPPED; the prover must read
        // that as a selection miss (not-found), never as a red on head.
        expect(r.regressionProvenBaseRed).toBe(false);
        expect(r.regressionGreenOnHead).toBe(false);
        expect(r.note).toMatch(/not selectable on head/);
        expect(r.note).not.toMatch(/RED on head/);
      } finally {
        for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
      }
    },
    120_000,
  );
});

// ─── BLOCKER 1 — manifest change injection ───────────────────────────────────

function cf(over: Partial<ChangedFile> & { path: string }): ChangedFile {
  return { insertions: 1, deletions: 0, status: 'modified', ...over };
}

describe('SPEC-024 BLOCKER 1 — detectManifestChange flags manifest/boundary diffs', () => {
  it.each([
    'package.json',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'lerna.json',
    'packages/minspec/package.json', // matched by basename in any workspace pkg
  ])('%s → manifest_changed high-blast signal', (p) => {
    const sig = detectManifestChange([cf({ path: p })]);
    expect(sig?.name).toBe('manifest_changed');
    expect(sig?.axis).toBe('consequence');
  });

  it('a pure code diff → no manifest signal', () => {
    expect(detectManifestChange([cf({ path: 'packages/minspec/src/lib/foo.ts' })])).toBeUndefined();
    expect(detectManifestChange([])).toBeUndefined();
  });

  it('package.json-only diff → blast:high, ineligible (end-to-end through the pure gate)', () => {
    // Reproduce what main() does: analyzers emit nothing for package.json, the
    // gate injects manifest_changed, decideAutoMerge classifies high → hold.
    const changed: ChangedFile[] = [cf({ path: 'package.json' })];
    const manifestSignal = detectManifestChange(changed);
    expect(manifestSignal).toBeDefined();
    const consequenceSignals: ClassificationSignal[] = manifestSignal ? [manifestSignal] : [];

    const reviewSignals: ReviewSignalsInput = {
      rootCause: 'dependency bump',
      changedFiles: ['package.json'],
      rootCauseFiles: ['package.json'],
      regressionTest: 'x.test.ts > y',
      gate: { test: 'pass', lint: 'pass', build: 'pass', validate: 'pass' },
    };
    const d = decideAutoMerge({
      reviewSignals,
      hollowFindings: [],
      consequenceSignals,
      mode: 'consequence-hybrid',
      proverResult: { regressionProvenBaseRed: true, regressionGreenOnHead: true, note: 'proven' },
    });
    expect(d.blast).toBe('high');
    expect(d.eligible).toBe(false);
    expect(d.failed).toContain('high-blast');
  });
});

// ─── #422 — CI/build boundary files force high-blast (same class as BLOCKER 1) ─

describe('#422 — detectBoundaryChange flags CI/build boundary diffs', () => {
  it.each([
    '.github/workflows/ci.yml',
    '.github/actions/setup/action.yml',
    '.circleci/config.yml',
    '.buildkite/pipeline.yml',
    '.gitlab-ci.yml',
    '.travis.yml',
    'azure-pipelines.yml',
    'Jenkinsfile',
    '.npmrc',
    '.yarnrc',
    '.yarnrc.yml',
    'tsconfig.json',
    'tsconfig.build.json',
    'packages/minspec/tsconfig.json', // matched by basename in any workspace pkg
    '.githooks/pre-commit', // git hooks run arbitrary shell on commit/push (this repo's core.hooksPath)
    '.githooks/commit-msg', // the RCDD gate itself — a poisoned hook could disable its own gate
    '.husky/pre-commit', // husky-managed hook — same arbitrary-shell-on-commit surface
  ])('%s → manifest_changed high-blast signal (isBoundaryPath + detectBoundaryChange)', (p) => {
    expect(isBoundaryPath(p)).toBe(true);
    const sig = detectBoundaryChange([cf({ path: p })]);
    expect(sig?.name).toBe('manifest_changed');
    expect(sig?.axis).toBe('consequence');
  });

  it('an ordinary source-code diff → NOT flagged as a boundary change', () => {
    expect(isBoundaryPath('packages/minspec/src/lib/foo.ts')).toBe(false);
    expect(detectBoundaryChange([cf({ path: 'packages/minspec/src/lib/foo.ts' })])).toBeUndefined();
    expect(detectBoundaryChange([])).toBeUndefined();
  });

  it('.github/workflows/ci.yml-only diff → blast:high, ineligible (end-to-end through the pure gate)', () => {
    // The #412 adversarial-review exploit: `run: curl … | sh` trips no
    // SENSITIVE_TERM, and a workflow-only diff emits no analyzer signal. Without
    // the boundary matcher this would classify low-blast and could auto-merge.
    const changed: ChangedFile[] = [cf({ path: '.github/workflows/ci.yml' })];
    const boundarySignal = detectBoundaryChange(changed);
    expect(boundarySignal).toBeDefined();
    const consequenceSignals: ClassificationSignal[] = boundarySignal ? [boundarySignal] : [];

    const reviewSignals: ReviewSignalsInput = {
      rootCause: 'add a CI step',
      changedFiles: ['.github/workflows/ci.yml'],
      rootCauseFiles: ['.github/workflows/ci.yml'],
      regressionTest: 'x.test.ts > y',
      gate: { test: 'pass', lint: 'pass', build: 'pass', validate: 'pass' },
    };
    const d = decideAutoMerge({
      reviewSignals,
      hollowFindings: [],
      consequenceSignals,
      mode: 'consequence-hybrid',
      proverResult: { regressionProvenBaseRed: true, regressionGreenOnHead: true, note: 'proven' },
    });
    expect(d.blast).toBe('high');
    expect(d.eligible).toBe(false);
    expect(d.failed).toContain('high-blast');
  });

  it('.npmrc-only diff → blast:high, ineligible', () => {
    const changed: ChangedFile[] = [cf({ path: '.npmrc' })];
    const boundarySignal = detectBoundaryChange(changed);
    const consequenceSignals: ClassificationSignal[] = boundarySignal ? [boundarySignal] : [];
    const d = decideAutoMerge({
      reviewSignals: {
        rootCause: 'registry config change',
        changedFiles: ['.npmrc'],
        rootCauseFiles: ['.npmrc'],
        regressionTest: 'x.test.ts > y',
        gate: { test: 'pass', lint: 'pass', build: 'pass', validate: 'pass' },
      },
      hollowFindings: [],
      consequenceSignals,
      mode: 'consequence-hybrid',
      proverResult: { regressionProvenBaseRed: true, regressionGreenOnHead: true, note: 'proven' },
    });
    expect(d.blast).toBe('high');
    expect(d.eligible).toBe(false);
  });

  it('tsconfig.json-only diff → blast:high, ineligible', () => {
    const changed: ChangedFile[] = [cf({ path: 'tsconfig.json' })];
    const boundarySignal = detectBoundaryChange(changed);
    const consequenceSignals: ClassificationSignal[] = boundarySignal ? [boundarySignal] : [];
    const d = decideAutoMerge({
      reviewSignals: {
        rootCause: 'compiler option change',
        changedFiles: ['tsconfig.json'],
        rootCauseFiles: ['tsconfig.json'],
        regressionTest: 'x.test.ts > y',
        gate: { test: 'pass', lint: 'pass', build: 'pass', validate: 'pass' },
      },
      hollowFindings: [],
      consequenceSignals,
      mode: 'consequence-hybrid',
      proverResult: { regressionProvenBaseRed: true, regressionGreenOnHead: true, note: 'proven' },
    });
    expect(d.blast).toBe('high');
    expect(d.eligible).toBe(false);
  });

  it('Jenkinsfile-only diff → blast:high, ineligible', () => {
    const changed: ChangedFile[] = [cf({ path: 'Jenkinsfile' })];
    const boundarySignal = detectBoundaryChange(changed);
    const consequenceSignals: ClassificationSignal[] = boundarySignal ? [boundarySignal] : [];
    const d = decideAutoMerge({
      reviewSignals: {
        rootCause: 'pipeline step change',
        changedFiles: ['Jenkinsfile'],
        rootCauseFiles: ['Jenkinsfile'],
        regressionTest: 'x.test.ts > y',
        gate: { test: 'pass', lint: 'pass', build: 'pass', validate: 'pass' },
      },
      hollowFindings: [],
      consequenceSignals,
      mode: 'consequence-hybrid',
      proverResult: { regressionProvenBaseRed: true, regressionGreenOnHead: true, note: 'proven' },
    });
    expect(d.blast).toBe('high');
    expect(d.eligible).toBe(false);
  });

  it('.githooks/pre-commit-only diff → blast:high, ineligible (end-to-end through the pure gate)', () => {
    // The review finding this fixes: git-hook directories run arbitrary shell on
    // commit/push (this repo: core.hooksPath=.githooks, .githooks/commit-msg is
    // the RCDD gate) but were not classified as a boundary path, so a poisoned
    // hook could slip through as low-blast and reach auto-merge.
    const changed: ChangedFile[] = [cf({ path: '.githooks/pre-commit' })];
    const boundarySignal = detectBoundaryChange(changed);
    expect(boundarySignal).toBeDefined();
    const consequenceSignals: ClassificationSignal[] = boundarySignal ? [boundarySignal] : [];

    const reviewSignals: ReviewSignalsInput = {
      rootCause: 'add a pre-commit hook step',
      changedFiles: ['.githooks/pre-commit'],
      rootCauseFiles: ['.githooks/pre-commit'],
      regressionTest: 'x.test.ts > y',
      gate: { test: 'pass', lint: 'pass', build: 'pass', validate: 'pass' },
    };
    const d = decideAutoMerge({
      reviewSignals,
      hollowFindings: [],
      consequenceSignals,
      mode: 'consequence-hybrid',
      proverResult: { regressionProvenBaseRed: true, regressionGreenOnHead: true, note: 'proven' },
    });
    expect(d.blast).toBe('high');
    expect(d.eligible).toBe(false);
    expect(d.failed).toContain('high-blast');
  });

  it('control: the boundary matcher does not fire on an ordinary src/foo.ts change (the #490 unmeasured default is what holds it)', () => {
    const changed: ChangedFile[] = [cf({ path: 'src/foo.ts' })];
    // The narrow point of this control: the boundary matcher itself must NOT flag
    // ordinary source (that would be a false positive of THIS matcher).
    expect(detectBoundaryChange(changed)).toBeUndefined();

    const d = decideAutoMerge({
      reviewSignals: {
        rootCause: 'fix off-by-one',
        changedFiles: ['src/foo.ts'],
        rootCauseFiles: ['src/foo.ts'],
        regressionTest: 'x.test.ts > y',
        gate: { test: 'pass', lint: 'pass', build: 'pass', validate: 'pass' },
      },
      hollowFindings: [],
      consequenceSignals: [], // no analyzer signal → opaque code change
      mode: 'consequence-hybrid',
      proverResult: { regressionProvenBaseRed: true, regressionGreenOnHead: true, note: 'proven' },
    });
    // Post-DR-058 (#490): an opaque code change with zero recognized signals is
    // UNMEASURED → high (deny-by-default). The control still holds — the boundary
    // matcher (undefined above) is NOT the cause; the #490 default is. An ordinary
    // src change now correctly holds for a human until an analyzer can vouch for it.
    expect(d.blast).toBe('high');
    expect(d.failed).toContain('high-blast');
  });
});

// ─── MAJOR 5 — git-diff failure THROWS (→ fail-safe HOLD) ─────────────────────

describe('SPEC-024 MAJOR 5 — buildChangedFiles throws on a git failure (no silent 0-file diff)', () => {
  const q = (cwd: string, args: string[]): void => {
    execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });
  };

  it('an unresolvable base ref → throws (main() turns this into a fail-safe HOLD)', () => {
    // A real repo, but the base ref does not exist — the exact infra failure the
    // old `?? ''` swallowed into a 0-file (low-blast) diff.
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-gitfail-'));
    try {
      q(repo, ['init', '-q']);
      q(repo, ['config', 'user.email', 't@t']);
      q(repo, ['config', 'user.name', 't']);
      fs.writeFileSync(path.join(repo, 'a.txt'), 'hi\n');
      q(repo, ['add', '-A']);
      q(repo, ['commit', '-qm', 'init']);
      expect(() => buildChangedFiles(repo, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).toThrow(
        /cannot enumerate changed files|cannot measure the diff|failed/,
      );
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #491 — FR-7 fail-safe: an ELIGIBLE decision whose audit line did NOT persist
// must HOLD, not proceed untraced. The pure `applyAuditFailsafe` carries the
// downgrade (unit-tested here, no flaky main()/e2e), and `appendAudit` now
// REPORTS success so main() can act on it.
// ─────────────────────────────────────────────────────────────────────────────
describe('#491 — audit-write failure fail-safes an eligible decision to HOLD', () => {
  const ELIGIBLE: AutoMergeDecision = { eligible: true, blast: 'low', reason: 'all conditions met', failed: [] };
  const HOLD: AutoMergeDecision = { eligible: false, blast: 'high', reason: 'prover not green', failed: ['head-not-green'] };

  it('downgrades an ELIGIBLE decision to HOLD when the audit did not persist', () => {
    const d = applyAuditFailsafe(ELIGIBLE, false);
    expect(d.eligible).toBe(false);
    expect(d.failed).toContain('audit-write-failed');
    expect(d.reason).toMatch(/audit-write-failed/);
    expect(d.blast).toBe('low'); // preserved for the FR-8 fallback comment
  });

  it('leaves an ELIGIBLE decision untouched when the audit DID persist', () => {
    const d = applyAuditFailsafe(ELIGIBLE, true);
    expect(d).toEqual(ELIGIBLE);
    expect(d.eligible).toBe(true);
  });

  it('does NOT alter an already-HOLD decision on audit failure (audit is best-effort on holds)', () => {
    const d = applyAuditFailsafe(HOLD, false);
    expect(d).toEqual(HOLD);
    expect(d.failed).not.toContain('audit-write-failed');
  });

  it('appendAudit returns true and writes the record on success', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-audit-ok-'));
    try {
      const ok = appendAudit(dir, { eligible: true, note: 'test491' });
      expect(ok).toBe(true);
      const written = fs.readFileSync(path.join(dir, '.minspec', 'auto-merge-audit.log'), 'utf8');
      expect(written).toMatch(/"note":"test491"/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('appendAudit returns false (never throws) when the record cannot be written', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-audit-fail-'));
    try {
      // `.minspec` as a FILE blocks mkdirSync(dir/.minspec) → append throws →
      // appendAudit catches and reports false (the signal main() fail-safes on).
      fs.writeFileSync(path.join(dir, '.minspec'), 'not a directory');
      expect(appendAudit(dir, { eligible: true })).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #490 / DR-058 — detectLowBlastDocsTest is the affirmative low-blast analyzer:
// it emits a low-blast signal ONLY when every changed path is docs and/or a test
// (no product source). Absence of this signal is what makes an opaque change hold.
// ─────────────────────────────────────────────────────────────────────────────
describe('#490 / DR-058 — detectLowBlastDocsTest certifies a docs/test-only diff', () => {
  it('docs-only diff → affirmative low-blast signal', () => {
    const sig = detectLowBlastDocsTest([cf({ path: 'README.md' }), cf({ path: 'docs/guide.md' })]);
    expect(sig?.name).toBe('low_blast_docs_test_only');
  });

  it('test-only diff → affirmative low-blast signal', () => {
    const sig = detectLowBlastDocsTest([cf({ path: 'packages/minspec/tests/foo.test.ts' })]);
    expect(sig?.name).toBe('low_blast_docs_test_only');
  });

  it('docs + test mix (no product code) → still certified', () => {
    const sig = detectLowBlastDocsTest([cf({ path: 'CHANGELOG.md' }), cf({ path: 'a.spec.ts' })]);
    expect(sig?.name).toBe('low_blast_docs_test_only');
  });

  it('LICENSE (no extension) → certified docs', () => {
    expect(detectLowBlastDocsTest([cf({ path: 'LICENSE' })])?.name).toBe('low_blast_docs_test_only');
  });

  it('any product source file present → NO signal (opaque → the change will hold)', () => {
    expect(
      detectLowBlastDocsTest([cf({ path: 'README.md' }), cf({ path: 'packages/minspec/src/lib/auth.ts' })]),
    ).toBeUndefined();
  });

  it('a manifest/config file → NO signal (handled high by detectManifestChange)', () => {
    expect(detectLowBlastDocsTest([cf({ path: 'package.json' })])).toBeUndefined();
  });

  it('empty diff → no signal', () => {
    expect(detectLowBlastDocsTest([])).toBeUndefined();
  });

  // #490 review finding: CODEOWNERS is GOVERNANCE (required-reviewer routing), NOT
  // docs — certifying it low let a review-gate change auto-merge unseen. It must be
  // excluded from the docs certification AND affirmatively flagged high (boundary).
  it('CODEOWNERS is NOT certified docs — at repo root, .github/, or docs/', () => {
    expect(detectLowBlastDocsTest([cf({ path: 'CODEOWNERS' })])).toBeUndefined();
    expect(detectLowBlastDocsTest([cf({ path: '.github/CODEOWNERS' })])).toBeUndefined();
    expect(detectLowBlastDocsTest([cf({ path: 'docs/CODEOWNERS' })])).toBeUndefined();
    // even mixed with a genuine doc, the CODEOWNERS presence blocks certification
    expect(detectLowBlastDocsTest([cf({ path: 'README.md' }), cf({ path: 'CODEOWNERS' })])).toBeUndefined();
  });

  it('CODEOWNERS is affirmatively HIGH-blast (boundary), at any path', () => {
    expect(isBoundaryPath('CODEOWNERS')).toBe(true);
    expect(isBoundaryPath('.github/CODEOWNERS')).toBe(true);
    expect(isBoundaryPath('docs/CODEOWNERS')).toBe(true);
    expect(detectBoundaryChange([cf({ path: '.github/CODEOWNERS' })])?.name).toBe('manifest_changed');
  });
});
