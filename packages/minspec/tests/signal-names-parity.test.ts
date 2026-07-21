/**
 * T0 ENFORCEMENT — constitution: "don't trust the model to follow a rule — enforce it."
 *
 * The consequence-signal VOCABULARY is spelled in three places that must agree:
 *   1. `consequence-analyzers.ts` — PRODUCES names (`name: 'sensitive_sink'`, …).
 *   2. `auto-merge.ts` — RECOGNIZES names; SPEC-024 FR-5 grades blast from these sets.
 *   3. `scripts/auto-merge-gate.ts` — INJECTS names (`manifest_changed`, the low-blast marker).
 *
 * Nothing but a human reading three files kept them aligned. #824 made (2) the exported
 * single source of truth; this test BINDS (1) and (3) to it so a rename or a new name
 * fails CI instead of an LLM reviewer noticing. Two hazards, only one of which fails safe:
 *
 *  - **A8 — WRONG-HOLD.** An analyzer emits an affirmative-low-intent name nobody added
 *    to `LOW_BLAST_SIGNAL_NAMES`. Deny-by-default reads it as unknown ⇒ `high` ⇒ the PR
 *    holds for a human. Safe, but wrong, and silently so. Caught by `emitted ⊆ RECOGNIZED`.
 *  - **A7 — WRONG-MERGE (the only false-green in the set).** `PUBLIC_API_NAMES` must be a
 *    SUBSET of `HIGH_SIGNAL_NAMES`. Break it and a `public_api_*` signal drives
 *    `touchesExportedSurface` but NOT high blast — an exported-surface change classifies
 *    low and auto-merges to `main` unseen. `auto-merge.ts` now makes this unrepresentable
 *    by CONSTRUCTION (it spreads `PUBLIC_API_NAMES` into `HIGH_SIGNAL_NAMES`); the subset
 *    assertion below is the belt to that braces, in case a future edit re-types a literal.
 *
 * COVERAGE NOTE (both belts): the emitted-name check runs BEHAVIOURALLY — every analyzer
 * in `CONSEQUENCE_ANALYZERS` is exercised over fixture diffs and the real emitted `name`s
 * are collected — AND is backed by a TEXT scan of `consequence-analyzers.ts` for
 * `name: '<literal>'`, so a name on a branch no fixture reaches is still enforced. The
 * gate's literals are enforced text-only and READ-ONLY: `scripts/` is machinery (editing
 * it force-labels the PR `ai-review:changes`), so this test reads it and never touches it.
 *
 * Every collected/parsed set is asserted NON-EMPTY, so a broken regex or a renamed
 * fixture can never make this test pass vacuously.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  HIGH_SIGNAL_NAMES,
  LOW_BLAST_SIGNAL_NAMES,
  LOW_BLAST_DOCS_TEST,
  PUBLIC_API_NAMES,
  RECOGNIZED,
  REACH_UNAVAILABLE,
} from '../src/lib/auto-merge';
import {
  CONSEQUENCE_ANALYZERS,
  runConsequenceAnalyzers,
  type ChangedFile,
  type ConsequenceInput,
} from '../src/lib/consequence-analyzers';

// ─── Repo-root discovery (mirrors reviewer-secrets-enforcement.test.ts) ───────

/** Locate the repo root (the worktree) by walking up to the dir holding the gate script. */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'scripts/auto-merge-gate.ts'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate repo root (…/scripts/auto-merge-gate.ts)');
}

// ─── Fixtures — one per emitting branch of each analyzer ──────────────────────

function file(partial: Partial<ChangedFile> & { path: string }): ChangedFile {
  return { insertions: 1, deletions: 0, status: 'modified', ...partial };
}

/**
 * Diffs chosen to reach EVERY `name:`-emitting branch in `consequence-analyzers.ts`:
 * reach degrade, all three public-API paths (incl. the degraded no-baseline and
 * content-unavailable ones), deletion, migration (both content and no-content),
 * destructive SQL, removed Prisma model, sensitive sink, and concurrency.
 */
const FIXTURES: ReadonlyArray<{ label: string; input: ConsequenceInput }> = [
  {
    label: 'reach degrade (no reference index — the v1 contract)',
    input: { refIndex: null, changedFiles: [file({ path: 'src/util.ts', content: 'const a = 1;' })] },
  },
  {
    label: 'public API: export added and removed against a baseline',
    input: {
      refIndex: null,
      changedFiles: [
        file({
          path: 'packages/x/src/index.ts',
          oldContent: 'export const alpha = 1;\nexport const gone = 2;\n',
          content: 'export const alpha = 1;\nexport const beta = 3;\n',
        }),
      ],
    },
  },
  {
    label: 'public API: no baseline ⇒ degraded additions-only',
    input: {
      refIndex: null,
      changedFiles: [file({ path: 'packages/x/src/index.ts', content: 'export const solo = 1;\n' })],
    },
  },
  {
    label: 'public API: content unavailable ⇒ degraded public_api_changed',
    input: { refIndex: null, changedFiles: [file({ path: 'packages/x/src/index.ts' })] },
  },
  {
    label: 'public API: public-surface file deleted ⇒ removed (+ irreversible deletion)',
    input: {
      refIndex: null,
      changedFiles: [file({ path: 'packages/x/src/index.ts', status: 'deleted' })],
    },
  },
  {
    label: 'irreversibility: new migration file with destructive SQL',
    input: {
      refIndex: null,
      changedFiles: [
        file({
          path: 'db/migrations/003_drop.sql',
          status: 'added',
          content: 'DROP TABLE users;\nALTER TABLE orders DROP COLUMN legacy;\n',
        }),
      ],
    },
  },
  {
    label: 'irreversibility: migration touched, content unavailable ⇒ degraded',
    input: { refIndex: null, changedFiles: [file({ path: 'db/migrations/004_x.sql' })] },
  },
  {
    label: 'irreversibility: Prisma model removed against a baseline',
    input: {
      refIndex: null,
      changedFiles: [
        file({
          path: 'prisma/schema.prisma',
          oldContent: 'model User {\n  id Int\n}\nmodel Ghost {\n  id Int\n}\n',
          content: 'model User {\n  id Int\n}\n',
        }),
      ],
    },
  },
  {
    label: 'sensitive sink: auth path + inline credential',
    input: {
      refIndex: null,
      changedFiles: [
        file({
          path: 'src/auth/login.ts',
          content: 'const password = "hunter2hunter2";\nexport function login() {}\n',
        }),
      ],
    },
  },
  {
    label: 'concurrency: Promise.all + timer + transaction',
    input: {
      refIndex: null,
      changedFiles: [
        file({
          path: 'src/worker.ts',
          content:
            'await Promise.all([a, b]);\nsetTimeout(() => {}, 10);\nawait db.$transaction(async () => {});\n',
        }),
      ],
    },
  },
];

/** Every signal name the analyzers ACTUALLY emit over the fixture corpus. */
function emittedNamesBehavioural(): Set<string> {
  const names = new Set<string>();
  for (const fixture of FIXTURES) {
    // Via the public entry point…
    for (const s of runConsequenceAnalyzers(fixture.input)) names.add(s.name);
    // …and each analyzer directly, so a future analyzer dropped from the aggregator
    // (or one whose signals the aggregator filters) is still covered.
    for (const analyzer of CONSEQUENCE_ANALYZERS) {
      for (const s of analyzer(fixture.input)) names.add(s.name);
    }
  }
  return names;
}

/**
 * Every `name: '<literal>'` in a source file. Deliberately matches ONLY the
 * signal-shaped `snake_case` literals so the analyzers' internal pattern catalogs
 * (`{ name: 'Promise.all', re: … }`, `{ name: 'raw-sql', re: … }`) — which are
 * sub-pattern labels folded into `explain`, NEVER emitted signal names — do not
 * produce false failures.
 */
function nameLiterals(src: string): Set<string> {
  return new Set([...src.matchAll(/\bname:\s*'([a-z0-9]+(?:_[a-z0-9]+)+)'/g)].map((m) => m[1]));
}

// ─── The assertions ──────────────────────────────────────────────────────────

describe('T0 ENFORCE: signal-name parity — emitted ⊆ RECOGNIZED (#824)', () => {
  const root = findRepoRoot();

  it('RECOGNIZED is the union of high + affirmative-low + the reach-degrade marker', () => {
    // Guards the SSOT itself: if a name is added to a member set but RECOGNIZED is
    // rebuilt by hand from literals, this catches the omission.
    const union = new Set([...HIGH_SIGNAL_NAMES, ...LOW_BLAST_SIGNAL_NAMES, REACH_UNAVAILABLE]);
    expect([...RECOGNIZED].sort()).toEqual([...union].sort());
    expect(RECOGNIZED.size).toBeGreaterThan(0);
  });

  it('A7 (WRONG-MERGE): PUBLIC_API_NAMES ⊆ HIGH_SIGNAL_NAMES — an exported touch is always high', () => {
    // The ONLY false-green in the hazard set. A `public_api_*` name that drives
    // `deriveTouchesExportedSurface` but not `classifyBlast` ⇒ an exported-surface
    // change classifies low ⇒ auto-merges to main unseen.
    expect(PUBLIC_API_NAMES.size).toBeGreaterThan(0);
    for (const name of PUBLIC_API_NAMES) expect(HIGH_SIGNAL_NAMES.has(name)).toBe(true);
  });

  it('A8 (WRONG-HOLD): every BEHAVIOURALLY emitted analyzer name ∈ RECOGNIZED', () => {
    const emitted = emittedNamesBehavioural();
    // Non-vacuous: the fixture corpus must actually drive the analyzers.
    expect(emitted.size).toBeGreaterThanOrEqual(8);
    for (const name of emitted) {
      expect(RECOGNIZED.has(name), `analyzer emits unrecognized signal '${name}'`).toBe(true);
    }
  });

  it('A8 (belt): every `name:` LITERAL in consequence-analyzers.ts ∈ RECOGNIZED', () => {
    // Covers emitting branches no fixture reaches (e.g. a future analyzer added
    // without a fixture here).
    const src = fs.readFileSync(
      path.join(root, 'packages/minspec/src/lib/consequence-analyzers.ts'),
      'utf8',
    );
    const literals = nameLiterals(src);
    expect(literals.size).toBeGreaterThanOrEqual(8);
    for (const name of literals) {
      expect(RECOGNIZED.has(name), `consequence-analyzers.ts emits unrecognized '${name}'`).toBe(true);
    }
  });

  it('the behavioural sweep covers every literal in consequence-analyzers.ts', () => {
    // Keeps the fixture corpus honest: if someone adds an emitting branch, the
    // fixtures must grow to reach it rather than leaning on the text belt alone.
    const src = fs.readFileSync(
      path.join(root, 'packages/minspec/src/lib/consequence-analyzers.ts'),
      'utf8',
    );
    const uncovered = [...nameLiterals(src)].filter((n) => !emittedNamesBehavioural().has(n));
    expect(uncovered).toEqual([]);
  });

  it('every intent-low injector name ∈ LOW_BLAST_SIGNAL_NAMES', () => {
    // The gate's only affirmative-low marker. If it ever stops being recognized as
    // low, every docs/test-only PR silently starts holding (A8, at scale).
    expect(LOW_BLAST_SIGNAL_NAMES.size).toBeGreaterThan(0);
    expect(LOW_BLAST_SIGNAL_NAMES.has(LOW_BLAST_DOCS_TEST)).toBe(true);
  });

  it('READ-ONLY: every name scripts/auto-merge-gate.ts INJECTS ∈ RECOGNIZED', () => {
    // `scripts/` is machinery — this test READS it and never edits it. The gate spells
    // `manifest_changed` as a bare literal (twice) and imports LOW_BLAST_DOCS_TEST from
    // auto-merge.ts; both surfaces are enforced here, closing the drift without tripping
    // the ai-review self-edit guard.
    const gate = fs.readFileSync(path.join(root, 'scripts/auto-merge-gate.ts'), 'utf8');

    const literals = nameLiterals(gate);
    expect(literals.size).toBeGreaterThan(0);
    for (const name of literals) {
      expect(RECOGNIZED.has(name), `auto-merge-gate.ts injects unrecognized '${name}'`).toBe(true);
    }

    // Symbolic injections: `name: IDENT` where IDENT is an imported constant. Resolve the
    // ones we know and assert the gate still sources them from auto-merge.ts (which
    // re-exports the SSOT) rather than re-typing a literal.
    const symbolic = new Set(
      [...gate.matchAll(/\bname:\s*([A-Z][A-Z0-9_]+)\s*,/g)].map((m) => m[1]),
    );
    expect(symbolic.has('LOW_BLAST_DOCS_TEST')).toBe(true);
    expect(gate).toMatch(/import\s*\{[\s\S]*?LOW_BLAST_DOCS_TEST[\s\S]*?\}\s*from\s*'[^']*auto-merge'/);
    expect(RECOGNIZED.has(LOW_BLAST_DOCS_TEST)).toBe(true);
  });
});
