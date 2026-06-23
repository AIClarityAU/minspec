/**
 * consequence-analyzers.test.ts — SPEC-023 Test Plan
 *
 * T0 (invariants):
 *  - INV-1 purity/offline: no `vscode` / `simple-git` import in the analyzer module.
 *  - INV-3 monotonicity: adding any consequence signal never lowers the tier.
 *  - INV-4 honest degrade: refIndex:null → impact-reach emits a degraded marker;
 *    size signals still floor.
 *
 * T1 (one suite per analyzer FR-2…FR-5): exactly the cases the spec Test Plan lists.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  impactReachAnalyzer,
  publicApiAnalyzer,
  irreversibilityAnalyzer,
  sensitiveSinkAnalyzer,
  concurrencyAnalyzer,
  runConsequenceAnalyzers,
  type ConsequenceInput,
  type ChangedFile,
  type ClassificationSignal,
} from '../src/lib/consequence-analyzers';
import { classify } from '../src/lib/classifier';
import { DEFAULT_CONFIG, TIERS, type Tier } from '../src/lib/config';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function file(overrides: Partial<ChangedFile> & { path: string }): ChangedFile {
  return {
    insertions: 1,
    deletions: 0,
    status: 'modified',
    ...overrides,
  };
}

function input(
  changedFiles: ChangedFile[],
  refIndex: ConsequenceInput['refIndex'] = null,
): ConsequenceInput {
  return { changedFiles, refIndex };
}

const TIER_IDX: Record<Tier, number> = { T1: 0, T2: 1, T3: 2, T4: 3 };

// ─── INV-1: Tier-0 purity / offline ──────────────────────────────────────────

describe('SPEC-023 INV-1 — analyzer module is Tier-0 (pure, offline)', () => {
  const moduleSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'lib', 'consequence-analyzers.ts'),
    'utf-8',
  );

  it('imports no vscode', () => {
    expect(moduleSrc).not.toMatch(/from\s+['"]vscode['"]/);
    expect(moduleSrc).not.toMatch(/require\(\s*['"]vscode['"]\s*\)/);
  });

  it('imports no simple-git', () => {
    expect(moduleSrc).not.toMatch(/from\s+['"]simple-git['"]/);
    expect(moduleSrc).not.toMatch(/require\(\s*['"]simple-git['"]\s*\)/);
  });

  it('performs no network / disk IO (no fs, http, fetch)', () => {
    expect(moduleSrc).not.toMatch(/from\s+['"]fs['"]/);
    expect(moduleSrc).not.toMatch(/from\s+['"]node:fs['"]/);
    expect(moduleSrc).not.toMatch(/\bfetch\s*\(/);
    expect(moduleSrc).not.toMatch(/from\s+['"]https?['"]/);
  });

  it('every analyzer is a pure (input) => signals with no side effects', () => {
    const inp = input([
      file({ path: 'src/auth/login.ts', content: 'export const x = 1;' }),
    ]);
    const before = JSON.stringify(inp);
    runConsequenceAnalyzers(inp);
    // Input is not mutated.
    expect(JSON.stringify(inp)).toBe(before);
  });
});

// ─── INV-3: Upward-only ratchet (monotonicity property test) ─────────────────

describe('SPEC-023 INV-3 — adding a consequence signal never lowers the tier', () => {
  // A representative spread of base size-signal sets across every tier.
  const baseSets: ClassificationSignal[][] = [
    [],
    [{ name: 'files_changed', value: 1, weight: 1, tierContribution: 'T1' }],
    [
      { name: 'files_changed', value: 4, weight: 1, tierContribution: 'T2' },
      { name: 'lines_changed', value: 50, weight: 1, tierContribution: 'T2' },
    ],
    [{ name: 'cross_directory', value: 6, weight: 1, tierContribution: 'T3' }],
    [{ name: 'big', value: 999, weight: 1, tierContribution: 'T4' }],
  ];

  // Every consequence signal an analyzer can emit, at each tier it can emit.
  const consequenceSignals: ClassificationSignal[] = [
    { name: 'reach_unavailable', value: true, weight: 0, tierContribution: 'T1', axis: 'consequence', degraded: true },
    { name: 'public_api_added', value: 1, weight: 0, tierContribution: 'T2', axis: 'consequence' },
    { name: 'public_api_removed', value: 1, weight: 0, tierContribution: 'T3', axis: 'consequence' },
    { name: 'irreversible_deletion', value: true, weight: 0, tierContribution: 'T3', axis: 'consequence' },
    { name: 'destructive_schema_op', value: true, weight: 0, tierContribution: 'T4', axis: 'consequence' },
    { name: 'sensitive_sink', value: 1, weight: 0, tierContribution: 'T3', axis: 'consequence' },
    { name: 'concurrency', value: 1, weight: 0, tierContribution: 'T3', axis: 'consequence' },
  ];

  it('result tier is monotonic non-decreasing when adding any consequence signal', () => {
    for (const base of baseSets) {
      const baseTier = classify(base, DEFAULT_CONFIG).tier;
      for (const cs of consequenceSignals) {
        const withCs = classify([...base, cs], DEFAULT_CONFIG).tier;
        expect(TIER_IDX[withCs]).toBeGreaterThanOrEqual(TIER_IDX[baseTier]);
      }
      // Adding ALL of them at once is also never a downgrade.
      const all = classify([...base, ...consequenceSignals], DEFAULT_CONFIG).tier;
      expect(TIER_IDX[all]).toBeGreaterThanOrEqual(TIER_IDX[baseTier]);
    }
  });

  it('a clean diff produces no consequence signal that lowers a high size tier', () => {
    const cleanInput = input([
      file({ path: 'README.md', content: '# docs only', status: 'modified' }),
    ]);
    const cs = runConsequenceAnalyzers(cleanInput);
    // Only the (T1) degraded reach marker is allowed from a clean diff.
    for (const s of cs) {
      expect(['T1']).toContain(s.tierContribution);
    }
    const highBase: ClassificationSignal[] = [
      { name: 'big', value: 999, weight: 1, tierContribution: 'T4' },
    ];
    expect(classify([...highBase, ...cs], DEFAULT_CONFIG).tier).toBe('T4');
  });
});

// ─── INV-4: Honest degrade (impact-reach + size still floors) ────────────────

describe('SPEC-023 INV-4 / FR-1 — impact-reach degrades honestly, never fabricates', () => {
  it('refIndex:null → emits exactly one degraded reach_unavailable marker (T1)', () => {
    const signals = impactReachAnalyzer(input([file({ path: 'a.ts' })], null));
    expect(signals).toHaveLength(1);
    const s = signals[0];
    expect(s.name).toBe('reach_unavailable');
    expect(s.tierContribution).toBe('T1');
    expect(s.degraded).toBe(true);
    expect(s.axis).toBe('consequence');
    expect(s.explain).toBe('call graph unavailable; using size signals');
  });

  it('NEVER emits a fabricated reach number when degraded', () => {
    const signals = impactReachAnalyzer(input([file({ path: 'a.ts' })], null));
    // value is the boolean degraded marker, not a number masquerading as reach.
    expect(typeof signals[0].value).toBe('boolean');
  });

  it('the degraded marker does not raise the tier — size signals still floor', () => {
    // A real T2 size set + the T1 degraded marker → still T2 (reach does not floor).
    const sizeSignals: ClassificationSignal[] = [
      { name: 'files_changed', value: 4, weight: 1, tierContribution: 'T2' },
    ];
    const reach = impactReachAnalyzer(input([file({ path: 'a.ts' })], null));
    expect(classify([...sizeSignals, ...reach], DEFAULT_CONFIG).tier).toBe('T2');
  });

  it('impact-reach is always present in the aggregate (visible, not silent)', () => {
    const all = runConsequenceAnalyzers(input([file({ path: 'a.ts' })], null));
    expect(all.some((s) => s.name === 'reach_unavailable' && s.degraded)).toBe(true);
  });
});

// ─── FR-2: Public-API surface delta ──────────────────────────────────────────

describe('SPEC-023 FR-2 — public-API surface delta', () => {
  it('removed export floors HIGHER (T3) than an added export (T2)', () => {
    const removed = publicApiAnalyzer(
      input([
        file({
          path: 'packages/lib/src/index.ts',
          oldContent: 'export const foo = 1;\nexport const bar = 2;\n',
          content: 'export const foo = 1;\n',
        }),
      ]),
    );
    const added = publicApiAnalyzer(
      input([
        file({
          path: 'packages/lib/src/index.ts',
          oldContent: 'export const foo = 1;\n',
          content: 'export const foo = 1;\nexport const bar = 2;\n',
        }),
      ]),
    );
    const removedSig = removed.find((s) => s.name === 'public_api_removed')!;
    const addedSig = added.find((s) => s.name === 'public_api_added')!;
    expect(removedSig.tierContribution).toBe('T3');
    expect(addedSig.tierContribution).toBe('T2');
    expect(TIER_IDX[removedSig.tierContribution]).toBeGreaterThan(
      TIER_IDX[addedSig.tierContribution],
    );
  });

  it('a renamed export reads as removed (old name gone) + added (new name)', () => {
    const signals = publicApiAnalyzer(
      input([
        file({
          path: 'src/index.ts',
          oldContent: 'export function oldName() {}\n',
          content: 'export function newName() {}\n',
        }),
      ]),
    );
    expect(signals.some((s) => s.name === 'public_api_removed')).toBe(true);
    expect(signals.some((s) => s.name === 'public_api_added')).toBe(true);
  });

  it('no oldContent ⇒ additions-only, flagged degraded (FR-2 degrade)', () => {
    const signals = publicApiAnalyzer(
      input([
        file({
          path: 'src/index.ts',
          content: 'export const a = 1;\nexport const b = 2;\n',
          // no oldContent
        }),
      ]),
    );
    const added = signals.find((s) => s.name === 'public_api_added')!;
    expect(added).toBeDefined();
    expect(added.degraded).toBe(true);
    expect(signals.some((s) => s.name === 'public_api_removed')).toBe(false);
  });

  it('deleting a public-surface file floors T3', () => {
    const signals = publicApiAnalyzer(
      input([file({ path: 'src/index.ts', status: 'deleted' })]),
    );
    const sig = signals.find((s) => s.name === 'public_api_removed')!;
    expect(sig.tierContribution).toBe('T3');
  });

  it('ignores non-public-surface internal files', () => {
    const signals = publicApiAnalyzer(
      input([
        file({
          path: 'src/internal/util.ts',
          oldContent: 'export const a = 1;\n',
          content: 'export const a = 1;\nexport const b = 2;\n',
        }),
      ]),
    );
    expect(signals).toHaveLength(0);
  });
});

// ─── FR-3: Irreversibility ───────────────────────────────────────────────────

describe('SPEC-023 FR-3 — irreversibility', () => {
  it('a file deletion trips irreversible_deletion (T3)', () => {
    const signals = irreversibilityAnalyzer(
      input([file({ path: 'src/old-feature.ts', status: 'deleted' })]),
    );
    const sig = signals.find((s) => s.name === 'irreversible_deletion')!;
    expect(sig).toBeDefined();
    expect(sig.tierContribution).toBe('T3');
  });

  it('a migrations/ path trips irreversible_migration', () => {
    const signals = irreversibilityAnalyzer(
      input([
        file({
          path: 'prisma/migrations/20260101_init/migration.sql',
          status: 'added',
          content: 'CREATE TABLE foo (id int);',
        }),
      ]),
    );
    expect(signals.some((s) => s.name === 'irreversible_migration')).toBe(true);
  });

  it('a DROP TABLE in content trips destructive_schema_op (T4)', () => {
    const signals = irreversibilityAnalyzer(
      input([
        file({
          path: 'db/cleanup.sql',
          content: 'DROP TABLE users;',
        }),
      ]),
    );
    const sig = signals.find((s) => s.name === 'destructive_schema_op')!;
    expect(sig).toBeDefined();
    expect(sig.tierContribution).toBe('T4');
  });

  it('an ALTER TABLE ... DROP COLUMN trips destructive_schema_op', () => {
    const signals = irreversibilityAnalyzer(
      input([
        file({ path: 'db/alter.sql', content: 'ALTER TABLE users DROP COLUMN email;' }),
      ]),
    );
    expect(signals.some((s) => s.name === 'destructive_schema_op')).toBe(true);
  });

  it('a removed Prisma model trips destructive_schema_op', () => {
    const signals = irreversibilityAnalyzer(
      input([
        file({
          path: 'schema.prisma',
          oldContent: 'model User {\n id Int\n}\nmodel Post {\n id Int\n}\n',
          content: 'model User {\n id Int\n}\n',
        }),
      ]),
    );
    expect(signals.some((s) => s.name === 'destructive_schema_op')).toBe(true);
  });

  it('path-only fallback when content absent (migration file, no content) → degraded', () => {
    const signals = irreversibilityAnalyzer(
      input([file({ path: 'migrations/0001.sql', status: 'modified' })]),
    );
    const sig = signals.find((s) => s.name === 'irreversible_migration')!;
    expect(sig).toBeDefined();
    expect(sig.degraded).toBe(true);
  });

  it('an ordinary modified .ts file trips nothing', () => {
    const signals = irreversibilityAnalyzer(
      input([file({ path: 'src/util.ts', content: 'export const a = 1;' })]),
    );
    expect(signals).toHaveLength(0);
  });
});

// ─── FR-4: Sensitive-sink reach ──────────────────────────────────────────────

describe('SPEC-023 FR-4 — sensitive-sink reach (capped catalog)', () => {
  it('a direct path hit (auth) trips sensitive_sink, degraded (v1 = direct only)', () => {
    const signals = sensitiveSinkAnalyzer(
      input([file({ path: 'src/auth/session.ts', content: 'const x = 1;' })]),
    );
    const sig = signals.find((s) => s.name === 'sensitive_sink')!;
    expect(sig).toBeDefined();
    expect(sig.tierContribution).toBe('T3');
    // Transitive reach needs a refIndex (n/a v1) → degrades to direct, flagged.
    expect(sig.degraded).toBe(true);
  });

  it('a credential identifier in content trips sensitive_sink', () => {
    const signals = sensitiveSinkAnalyzer(
      input([
        file({
          path: 'src/config.ts',
          content: 'const password = "hunter2longenough";',
        }),
      ]),
    );
    expect(signals.some((s) => s.name === 'sensitive_sink')).toBe(true);
  });

  it('a raw-SQL interpolation pattern trips sensitive_sink', () => {
    const signals = sensitiveSinkAnalyzer(
      input([
        file({
          path: 'src/db.ts',
          content: 'const q = `SELECT * FROM users WHERE id = ${id}`;',
        }),
      ]),
    );
    expect(signals.some((s) => s.name === 'sensitive_sink')).toBe(true);
  });

  it('transitive-only would need refIndex (n/a v1) — degrades to direct-only', () => {
    // With refIndex null (always, in v1) the analyzer flags only direct matches
    // and marks them degraded; a non-sensitive file produces nothing.
    const none = sensitiveSinkAnalyzer(
      input([file({ path: 'src/math.ts', content: 'export const add = (a,b)=>a+b;' })]),
    );
    expect(none).toHaveLength(0);
  });

  it('a non-sensitive change trips nothing', () => {
    const signals = sensitiveSinkAnalyzer(
      input([file({ path: 'src/widget.ts', content: 'export const w = 1;' })]),
    );
    expect(signals).toHaveLength(0);
  });
});

// ─── FR-5: Concurrency ───────────────────────────────────────────────────────

describe('SPEC-023 FR-5 — concurrency', () => {
  it('Promise.all trips concurrency (T3)', () => {
    const signals = concurrencyAnalyzer(
      input([
        file({ path: 'src/fetch.ts', content: 'await Promise.all([a(), b()]);' }),
      ]),
    );
    const sig = signals.find((s) => s.name === 'concurrency')!;
    expect(sig).toBeDefined();
    expect(sig.tierContribution).toBe('T3');
  });

  it('new Worker trips concurrency', () => {
    const signals = concurrencyAnalyzer(
      input([file({ path: 'src/job.ts', content: 'const w = new Worker("x");' })]),
    );
    expect(signals.some((s) => s.name === 'concurrency')).toBe(true);
  });

  it('a lock/mutex trips concurrency', () => {
    const signals = concurrencyAnalyzer(
      input([file({ path: 'src/sync.ts', content: 'await mutex.acquireLock();' })]),
    );
    expect(signals.some((s) => s.name === 'concurrency')).toBe(true);
  });

  it('a stat-only diff (no content) emits NOTHING — no degraded marker (FR-5)', () => {
    const signals = concurrencyAnalyzer(
      input([file({ path: 'src/job.ts', status: 'modified' })]),
    );
    expect(signals).toHaveLength(0);
  });

  it('non-concurrency code trips nothing', () => {
    const signals = concurrencyAnalyzer(
      input([file({ path: 'src/pure.ts', content: 'export const f = (x)=>x+1;' })]),
    );
    expect(signals).toHaveLength(0);
  });

  it('ignores non-code files even if they contain the words', () => {
    const signals = concurrencyAnalyzer(
      input([file({ path: 'docs/notes.md', content: 'we use Promise.all here' })]),
    );
    expect(signals).toHaveLength(0);
  });
});

// ─── Aggregator ──────────────────────────────────────────────────────────────

describe('SPEC-023 — runConsequenceAnalyzers aggregator', () => {
  it('runs all five analyzers and concatenates their signals', () => {
    const signals = runConsequenceAnalyzers(
      input([
        file({
          path: 'packages/lib/src/index.ts',
          oldContent: 'export const a = 1;\nexport const b = 2;\n',
          content: 'export const a = 1;\n', // removed export
        }),
        file({ path: 'src/auth/login.ts', content: 'await Promise.all([a()]);' }),
        file({ path: 'db/migrate.sql', content: 'DROP TABLE old;' }),
      ]),
    );
    // reach (degraded) + public_api_removed + sensitive_sink + concurrency + destructive
    expect(signals.some((s) => s.name === 'reach_unavailable')).toBe(true);
    expect(signals.some((s) => s.name === 'public_api_removed')).toBe(true);
    expect(signals.some((s) => s.name === 'sensitive_sink')).toBe(true);
    expect(signals.some((s) => s.name === 'concurrency')).toBe(true);
    expect(signals.some((s) => s.name === 'destructive_schema_op')).toBe(true);
    // Every consequence signal carries the consequence axis tag.
    for (const s of signals) expect(s.axis).toBe('consequence');
  });

  it('an empty diff yields only the degraded reach marker', () => {
    const signals = runConsequenceAnalyzers(input([]));
    expect(signals).toHaveLength(1);
    expect(signals[0].name).toBe('reach_unavailable');
  });
});

// ─── Sanity: TIERS spread used above is exhaustive ──────────────────────────

describe('test-fixture sanity', () => {
  it('TIERS covers T1..T4', () => {
    expect([...TIERS]).toEqual(['T1', 'T2', 'T3', 'T4']);
  });
});
