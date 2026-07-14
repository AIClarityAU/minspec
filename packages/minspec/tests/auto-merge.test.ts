/**
 * auto-merge.test.ts — SPEC-024 Test Plan (the safety proof for the on-switch).
 *
 * `decideAutoMerge` is the single highest-consequence decision in MinSpec — it
 * merges PRs to `main` with no human eyes. These T0/T1 tests pin the invariants:
 *   - INV-1 deny-by-default (dropping ANY required input → never eligible)
 *   - INV-2 unmeasured blast = high (degraded reach + exported touch → hold)
 *   - INV-3 no unproven regression (self-report ≠ prover; prover is authority)
 *   - INV-4 hollow/stub findings block
 *   - INV-6 purity (no vscode/fs/network import) + every decision has a reason
 *   - FR-5 deny-by-default over signal NAMES (novel name → high; the allowlist
 *     inversion the independent review mandated)
 *   - FR-4a `touchesExportedSurface` DERIVED (single source of truth)
 *   - T1 contract: fully-green low-blast → eligible; each single failing
 *     condition flips it with the right `failed[]` key; pr-gate → always hold
 *   - Parity: the review-signal green predicates match the #180 renderer exactly
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderReviewSignals, type ReviewSignalsInput } from '@aiclarity/shared';
import type { ClassificationSignal } from '../src/lib/classifier';
import type { TestFinding } from '../src/lib/test-scanner';
import {
  decideAutoMerge,
  deriveTouchesExportedSurface,
  classifyBlast,
  reachKnownLow,
  allReviewSignalsGreen,
  type AutoMergeInput,
  type ProverResult,
} from '../src/lib/auto-merge';

// ─── Factories ───────────────────────────────────────────────────────────────

/** The impact-reach degrade marker the analyzer ALWAYS emits in v1 (no index). */
function reachUnavailable(): ClassificationSignal {
  return {
    name: 'reach_unavailable',
    value: true,
    weight: 0,
    tierContribution: 'T1',
    axis: 'consequence',
    degraded: true,
    explain: 'call graph unavailable; using size signals',
  };
}

function signal(name: string, over: Partial<ClassificationSignal> = {}): ClassificationSignal {
  return {
    name,
    value: true,
    weight: 0,
    tierContribution: 'T3',
    axis: 'consequence',
    ...over,
  };
}

function greenReviewSignals(over: Partial<ReviewSignalsInput> = {}): ReviewSignalsInput {
  return {
    rootCause: 'validator flagged dangling refs but not missing ones',
    changedFiles: ['packages/minspec/src/lib/spec-validator.ts'],
    rootCauseFiles: ['packages/minspec/src/lib/spec-validator.ts'],
    regressionTest: 'spec-validator.test.ts > rejects missing epic ref',
    // Self-reported proof flags are intentionally set here to prove the gate
    // IGNORES them (INV-3) — only `proverResult` counts.
    regressionProvenBaseRed: true,
    regressionProvenHeadGreen: true,
    gate: { test: 'pass', lint: 'pass', build: 'pass', validate: 'pass' },
    ...over,
  };
}

function provenProver(): ProverResult {
  return {
    regressionProvenBaseRed: true,
    regressionGreenOnHead: true,
    note: 'test red on base, green on head',
  };
}

/** A fully-green, low-blast, prover-verified input → the ONE eligible shape. */
function eligibleInput(over: Partial<AutoMergeInput> = {}): AutoMergeInput {
  return {
    reviewSignals: greenReviewSignals(),
    hollowFindings: [],
    consequenceSignals: [reachUnavailable()], // low-blast, no exported touch
    mode: 'consequence-hybrid',
    proverResult: provenProver(),
    ...over,
  };
}

const hollowFinding: TestFinding = {
  file: 'packages/minspec/tests/foo.test.ts',
  line: 3,
  testName: 'does a thing',
  kind: 'hollow',
  reason: 'Test makes no assertion.',
};
const stubFinding: TestFinding = {
  file: 'packages/minspec/tests/foo.test.ts',
  line: 9,
  testName: 'later',
  kind: 'stub',
  reason: 'Test is skipped.',
};

// ─── Sanity: the eligible shape IS eligible ──────────────────────────────────

describe('SPEC-024 — the eligible baseline', () => {
  it('a fully-green, low-blast, prover-verified change is eligible with empty failed[]', () => {
    const d = decideAutoMerge(eligibleInput());
    expect(d.eligible).toBe(true);
    expect(d.blast).toBe('low');
    expect(d.failed).toEqual([]);
    expect(d.reason).not.toBe(''); // INV-6
  });
});

// ─── INV-1 deny-by-default (property) ────────────────────────────────────────

describe('SPEC-024 INV-1 — deny-by-default: dropping ANY required input → never eligible', () => {
  const requiredKeys: (keyof AutoMergeInput)[] = [
    'reviewSignals',
    'hollowFindings',
    'consequenceSignals',
    'mode',
    'proverResult',
  ];

  for (const key of requiredKeys) {
    it(`omitting '${key}' → ineligible`, () => {
      const broken = { ...eligibleInput() } as Record<string, unknown>;
      delete broken[key];
      const d = decideAutoMerge(broken as unknown as AutoMergeInput);
      expect(d.eligible).toBe(false);
      expect(d.failed.length).toBeGreaterThan(0);
      expect(d.reason).not.toBe('');
    });

    it(`setting '${key}' to undefined → ineligible`, () => {
      const broken = { ...eligibleInput(), [key]: undefined };
      const d = decideAutoMerge(broken as unknown as AutoMergeInput);
      expect(d.eligible).toBe(false);
    });
  }

  it('an entirely empty object → ineligible (no throw)', () => {
    const d = decideAutoMerge({} as unknown as AutoMergeInput);
    expect(d.eligible).toBe(false);
    expect(d.reason).not.toBe('');
  });
});

// ─── INV-3 no unproven regression (prover is the sole authority) ──────────────

describe('SPEC-024 INV-3 — a self-reported regression proof is NOT authoritative', () => {
  it('reviewSignals.regressionProvenBaseRed:true with NO proverResult → ineligible', () => {
    const d = decideAutoMerge(
      eligibleInput({
        proverResult: undefined,
        // reviewSignals already self-reports both flags true (greenReviewSignals).
      }),
    );
    expect(d.eligible).toBe(false);
    expect(d.failed).toContain('regression-unproven');
  });

  it('prover says base was NOT red (green-on-base) → ineligible even with self-report true', () => {
    const d = decideAutoMerge(
      eligibleInput({
        proverResult: { regressionProvenBaseRed: false, regressionGreenOnHead: true, note: 'green on base' },
      }),
    );
    expect(d.eligible).toBe(false);
    expect(d.failed).toContain('regression-unproven');
  });

  it('prover says head was NOT green (red-on-head) → ineligible', () => {
    const d = decideAutoMerge(
      eligibleInput({
        proverResult: { regressionProvenBaseRed: true, regressionGreenOnHead: false, note: 'red on head' },
      }),
    );
    expect(d.eligible).toBe(false);
    expect(d.failed).toContain('regression-unproven');
  });

  it('a genuine prover red→green (with a self-report of FALSE) → the prover wins → eligible', () => {
    const d = decideAutoMerge(
      eligibleInput({
        reviewSignals: greenReviewSignals({
          regressionProvenBaseRed: false,
          regressionProvenHeadGreen: false,
        }),
        proverResult: provenProver(),
      }),
    );
    expect(d.eligible).toBe(true);
  });
});

// ─── INV-4 hollow / stub tests block ─────────────────────────────────────────

describe('SPEC-024 INV-4 — any hollow OR stub finding → ineligible', () => {
  it('a hollow finding blocks', () => {
    const d = decideAutoMerge(eligibleInput({ hollowFindings: [hollowFinding] }));
    expect(d.eligible).toBe(false);
    expect(d.failed).toContain('hollow-tests');
  });

  it('a stub finding blocks', () => {
    const d = decideAutoMerge(eligibleInput({ hollowFindings: [stubFinding] }));
    expect(d.eligible).toBe(false);
    expect(d.failed).toContain('hollow-tests');
  });
});

// ─── FR-5 blast classification (deny-by-default over NAMES) ───────────────────

describe('SPEC-024 FR-5 — blast classification defaults UNKNOWN names to high', () => {
  it('a fabricated/novel signal name → high-blast (the mandated allowlist inversion)', () => {
    expect(classifyBlast([signal('future_signal')], false)).toBe('high');
  });

  it('a fabricated name alongside the reach marker → still high-blast', () => {
    expect(classifyBlast([reachUnavailable(), signal('future_signal')], false)).toBe('high');
  });

  it('destructive_schema_op alone → high', () => {
    expect(classifyBlast([signal('destructive_schema_op', { tierContribution: 'T4' })], false)).toBe('high');
  });

  it('a concurrency signal → high', () => {
    expect(classifyBlast([signal('concurrency')], false)).toBe('high');
  });

  it.each([
    'irreversible_deletion',
    'irreversible_migration',
    'destructive_schema_op',
    'sensitive_sink',
    'public_api_added',
    'public_api_changed',
    'public_api_removed',
    'concurrency',
    'manifest_changed',
  ])('recognized high name %s → high', (name) => {
    expect(classifyBlast([signal(name)], false)).toBe('high');
  });

  it('reach_unavailable ONLY, no exported touch → low', () => {
    expect(classifyBlast([reachUnavailable()], false)).toBe('low');
  });

  it('an empty signal set → low', () => {
    expect(classifyBlast([], false)).toBe('low');
  });

  it('a novel signal name drives the decision through decideAutoMerge → high-blast, ineligible', () => {
    const d = decideAutoMerge(eligibleInput({ consequenceSignals: [reachUnavailable(), signal('future_signal')] }));
    expect(d.blast).toBe('high');
    expect(d.eligible).toBe(false);
    expect(d.failed).toContain('high-blast');
  });
});

// ─── BLOCKER 1 — manifest change forces high-blast (defense-in-depth #414) ────

describe('SPEC-024 BLOCKER 1 — a manifest change classifies high-blast → hold', () => {
  // The gate (auto-merge-gate.ts) INJECTS a `manifest_changed` signal for any
  // package.json / lockfile / workspace-manifest diff, because the public-API
  // analyzer skips non-code files (#414). Here we prove the PURE gate treats that
  // injected signal as high-blast → ineligible. The injection itself is covered
  // by detectManifestChange in auto-merge-gate.test.ts (a package.json-only diff).
  const manifestChanged = signal('manifest_changed', {
    tierContribution: 'T4',
    explain: 'manifest/boundary file(s) changed (package.json)',
  });

  it('manifest_changed alone → high-blast', () => {
    expect(classifyBlast([manifestChanged], false)).toBe('high');
  });

  it('an otherwise-eligible change carrying manifest_changed → high-blast, ineligible', () => {
    const d = decideAutoMerge(
      eligibleInput({ consequenceSignals: [reachUnavailable(), manifestChanged] }),
    );
    expect(d.blast).toBe('high');
    expect(d.eligible).toBe(false);
    expect(d.failed).toContain('high-blast');
    // FR-8: the hold reason names the driving signal.
    expect(d.reason).toMatch(/manifest_changed/);
  });
});

// ─── FR-4a touchesExportedSurface is DERIVED (single source of truth) ─────────

describe('SPEC-024 FR-4a — touchesExportedSurface derived from public_api_* presence', () => {
  it('export * sentinel (degraded public_api_added) → touchesExportedSurface = true', () => {
    const exportStar = signal('public_api_added', {
      value: 1,
      tierContribution: 'T2',
      degraded: true,
      explain: '1 export(s) present at packages/x/index.ts; no baseline (additions-only)',
    });
    expect(deriveTouchesExportedSurface([reachUnavailable(), exportStar])).toBe(true);
  });

  it('content-unavailable public_api_changed (degraded) → touchesExportedSurface = true', () => {
    const contentUnavailable = signal('public_api_changed', {
      tierContribution: 'T2',
      degraded: true,
      explain: 'public surface packages/x/index.ts changed; content unavailable',
    });
    expect(deriveTouchesExportedSurface([reachUnavailable(), contentUnavailable])).toBe(true);
  });

  it('no public_api_* signal → touchesExportedSurface = false', () => {
    expect(deriveTouchesExportedSurface([reachUnavailable()])).toBe(false);
    expect(deriveTouchesExportedSurface([signal('concurrency')])).toBe(false);
    expect(deriveTouchesExportedSurface([])).toBe(false);
  });

  it('reach_unavailable + export * sentinel → derived exported touch → ineligible', () => {
    const exportStar = signal('public_api_added', {
      value: 1,
      tierContribution: 'T2',
      degraded: true,
      explain: 'export * sentinel; no baseline',
    });
    const d = decideAutoMerge(eligibleInput({ consequenceSignals: [reachUnavailable(), exportStar] }));
    expect(d.eligible).toBe(false);
    // public_api_* is a high name AND an exported touch under degraded reach.
    expect(d.failed).toContain('high-blast');
    expect(d.failed).toContain('unmeasured-blast');
  });
});

// ─── INV-2 unmeasured blast = high ───────────────────────────────────────────

describe('SPEC-024 INV-2 — degraded reach + exported touch → ineligible', () => {
  it('reachKnownLow is always false in v1 (no index)', () => {
    expect(reachKnownLow([reachUnavailable()])).toBe(false);
    expect(reachKnownLow([])).toBe(false);
  });

  it('classifyBlast escalates reach_unavailable + exported touch to high (FR-4)', () => {
    expect(classifyBlast([reachUnavailable()], true)).toBe('high');
  });

  it('decideAutoMerge holds a degraded-reach exported-touch change', () => {
    const publicApi = signal('public_api_changed', { tierContribution: 'T2' });
    const d = decideAutoMerge(eligibleInput({ consequenceSignals: [reachUnavailable(), publicApi] }));
    expect(d.eligible).toBe(false);
    expect(d.failed).toContain('unmeasured-blast');
  });
});

// ─── T1 contract: each single failing condition flips eligibility ─────────────

describe('SPEC-024 T1 — each single failing condition flips eligible → ineligible', () => {
  it('root cause not mapped to the diff → failed root-cause', () => {
    const d = decideAutoMerge(
      eligibleInput({ reviewSignals: greenReviewSignals({ rootCauseFiles: ['some/other/file.ts'] }) }),
    );
    expect(d.eligible).toBe(false);
    expect(d.failed).toEqual(['root-cause']);
  });

  it('empty root cause → failed root-cause', () => {
    const d = decideAutoMerge(eligibleInput({ reviewSignals: greenReviewSignals({ rootCause: '' }) }));
    expect(d.eligible).toBe(false);
    expect(d.failed).toContain('root-cause');
  });

  it('gate not green → failed gate-not-green', () => {
    const d = decideAutoMerge(
      eligibleInput({ reviewSignals: greenReviewSignals({ gate: { test: 'fail', lint: 'pass', build: 'pass', validate: 'pass' } }) }),
    );
    expect(d.eligible).toBe(false);
    expect(d.failed).toEqual(['gate-not-green']);
  });

  it('no regression test named → failed regression-unproven', () => {
    const d = decideAutoMerge(
      eligibleInput({ reviewSignals: greenReviewSignals({ regressionTest: undefined }) }),
    );
    expect(d.eligible).toBe(false);
    expect(d.failed).toContain('regression-unproven');
  });

  it('hollow finding → failed hollow-tests', () => {
    const d = decideAutoMerge(eligibleInput({ hollowFindings: [hollowFinding] }));
    expect(d.eligible).toBe(false);
    expect(d.failed).toEqual(['hollow-tests']);
  });

  it('a high consequence signal → failed high-blast even with all review signals green', () => {
    const d = decideAutoMerge(
      eligibleInput({ consequenceSignals: [reachUnavailable(), signal('sensitive_sink')] }),
    );
    expect(d.eligible).toBe(false);
    expect(d.failed).toContain('high-blast');
  });
});

// ─── pr-gate mode → always hold ──────────────────────────────────────────────

describe('SPEC-024 C4 — pr-gate mode always holds', () => {
  it('a change that would be eligible in hybrid mode holds under pr-gate', () => {
    const d = decideAutoMerge(eligibleInput({ mode: 'pr-gate' }));
    expect(d.eligible).toBe(false);
    expect(d.failed).toEqual(['pr-gate-mode']);
    expect(d.reason).toMatch(/pr-gate/);
  });

  it('pr-gate still reports the derived blast class', () => {
    const d = decideAutoMerge(
      eligibleInput({ mode: 'pr-gate', consequenceSignals: [reachUnavailable(), signal('concurrency')] }),
    );
    expect(d.blast).toBe('high');
    expect(d.eligible).toBe(false);
  });
});

// ─── INV-6 purity — no vscode / fs / network import in the module source ──────

describe('SPEC-024 INV-6 — decideAutoMerge is a pure Tier-0 function', () => {
  const moduleSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'lib', 'auto-merge.ts'),
    'utf-8',
  );

  it('imports no vscode', () => {
    expect(moduleSrc).not.toMatch(/from\s+['"]vscode['"]/);
    expect(moduleSrc).not.toMatch(/require\(\s*['"]vscode['"]\s*\)/);
  });

  it('imports no fs / path / child_process / network module (runtime IO)', () => {
    expect(moduleSrc).not.toMatch(/from\s+['"](?:node:)?fs['"]/);
    expect(moduleSrc).not.toMatch(/from\s+['"](?:node:)?path['"]/);
    expect(moduleSrc).not.toMatch(/from\s+['"](?:node:)?child_process['"]/);
    expect(moduleSrc).not.toMatch(/from\s+['"](?:node:)?(?:http|https|net)['"]/);
  });

  it('the value-level imports it does have are type-only (erased at runtime)', () => {
    // The only non-type imports permitted are none; every import is `import type`.
    const importLines = moduleSrc.split('\n').filter((l) => /^\s*import\b/.test(l));
    for (const line of importLines) {
      expect(line, `non-type import: ${line}`).toMatch(/^\s*import type\b/);
    }
  });
});

// ─── Parity: the green predicates match the #180 renderer's "all green" ───────

describe('SPEC-024 — review-signal green predicates match the #180 renderer (no drift)', () => {
  const ALL_GREEN_SENTINEL = 'All three signals verified';

  const cases: ReviewSignalsInput[] = [
    greenReviewSignals(),
    greenReviewSignals({ rootCause: '' }),
    greenReviewSignals({ rootCauseFiles: [] }),
    greenReviewSignals({ rootCauseFiles: ['unrelated.ts'] }),
    greenReviewSignals({ regressionTest: undefined }),
    greenReviewSignals({ regressionProvenBaseRed: false }),
    greenReviewSignals({ regressionProvenHeadGreen: false }),
    greenReviewSignals({ gate: undefined }),
    greenReviewSignals({ gate: { test: 'fail', lint: 'pass', build: 'pass', validate: 'pass' } }),
    greenReviewSignals({ gate: { test: 'pass', lint: 'unknown', build: 'pass', validate: 'pass' } }),
  ];

  it.each(cases.map((c, i) => [i, c] as const))(
    'case %i: allReviewSignalsGreen agrees with the renderer sentinel',
    (_i, rs) => {
      const rendered = renderReviewSignals(rs);
      const rendererAllGreen = rendered.includes(ALL_GREEN_SENTINEL);
      expect(allReviewSignalsGreen(rs)).toBe(rendererAllGreen);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// #489 — Signal-1 (root cause) is checked against the REAL git diff
// (`changedFilePaths`), not the agent's self-reported `reviewSignals.changedFiles`.
// The agent could otherwise pass Signal-1 trivially by claiming a self-consistent
// {rootCauseFiles ⊆ changedFiles} set. Same real-diff authority the prover already
// gives Signal-2 (INV-3).
// ─────────────────────────────────────────────────────────────────────────────
describe('#489 — Signal-1 uses the real diff, not the agent self-report', () => {
  it('HOLDS when the claimed root-cause files are NOT in the real diff', () => {
    // greenReviewSignals claims rootCauseFiles ⊆ changedFiles = [spec-validator.ts],
    // but the REAL diff touched a different file → root cause is unverified.
    const d = decideAutoMerge(
      eligibleInput({ changedFilePaths: ['packages/minspec/src/lib/some-other-file.ts'] }),
    );
    expect(d.eligible).toBe(false);
    expect(d.failed).toContain('root-cause');
  });

  it('stays eligible when the real diff DOES contain the claimed root-cause files', () => {
    const d = decideAutoMerge(
      eligibleInput({ changedFilePaths: ['packages/minspec/src/lib/spec-validator.ts'] }),
    );
    expect(d.eligible).toBe(true);
    expect(d.failed).toEqual([]);
  });

  it('inflating the self-reported changedFiles cannot fabricate the file universe (real diff wins)', () => {
    const d = decideAutoMerge(
      eligibleInput({
        reviewSignals: greenReviewSignals({
          rootCauseFiles: ['packages/minspec/src/lib/spec-validator.ts'],
          // Agent CLAIMS the root-cause file is among the changed files…
          changedFiles: ['packages/minspec/src/lib/spec-validator.ts', 'padding.ts'],
        }),
        // …but the real diff never touched it.
        changedFilePaths: ['unrelated.ts'],
      }),
    );
    expect(d.eligible).toBe(false);
    expect(d.failed).toContain('root-cause');
  });

  it('absent changedFilePaths falls back to the review-signal diff (pure-unit-test path preserved)', () => {
    const d = decideAutoMerge(eligibleInput()); // no real-diff override supplied
    expect(d.eligible).toBe(true);
  });
});
