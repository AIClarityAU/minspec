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
  proveRegression,
  detectManifestChange,
  isBoundaryPath,
  detectBoundaryChange,
  buildChangedFiles,
  type VitestRun,
  type ProverDeps,
} from '../../../scripts/auto-merge-gate';
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

  it('named test not found on head → NOT proven', () => {
    const r = proveRegression(WT, 'BASE', REG, deps(vr({ numTotal: 0, numPassed: 0 }), RED_ASSERTION));
    expect(r.regressionProvenBaseRed).toBe(false);
    expect(r.note).toMatch(/not found on head/);
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

  it('control: an ordinary src/foo.ts change with no other high signal is NOT forced high by this matcher', () => {
    const changed: ChangedFile[] = [cf({ path: 'src/foo.ts' })];
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
      consequenceSignals: [], // no analyzer signal, no boundary signal
      mode: 'consequence-hybrid',
      proverResult: { regressionProvenBaseRed: true, regressionGreenOnHead: true, note: 'proven' },
    });
    // Not asserting eligible:true here — other gate conjuncts may still hold it.
    // The point of this control is narrow: the boundary matcher itself must not
    // be the thing forcing high-blast for an ordinary source file.
    expect(d.blast).not.toBe('high');
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
