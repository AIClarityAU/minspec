---
id: SPEC-040
type: tasks
# tasks.md is NOT separately approvable (#630/#951) and is not hash-locked — only requirements.md is,
# and its record is the per-file sidecar .minspec/approvals/**/requirements.md.json, NOT the legacy
# .minspec/approvals.json (gitignored, absent from every checkout — #974). Editing this file voids nothing.
status: done  # all task groups complete; shipped in #1009 (19a6e08)
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology — code-change safety
depends_on: [SPEC-040, DR-064]  # this spec's own requirements + Plan
---

# SPEC-040 — Task Breakdown

Ordered per [design.md](./design.md) §Sequencing. **Each group ends suite-green (INV-2 / AC-7)
before the next starts**, and the `error`-level rules (FR-1) are physically added **last** so
`main` is never red (AC-5). Groups 1–2 are behaviour-preserving pure moves; 3–5 add gates.

> **Precondition:** run in a worktree off `origin/main` (rule #8). All `lib/**` moves keep Tier-0
> purity (no vscode/network — INV-3). No `eslint-disable` to dodge an `error` rule (INV-4).

## Group 1 — FR-4: extract the recursive `listSpecs` → `lib/spec-catalog.ts` (+ disambiguate)

- [x] **1.1** Create `packages/minspec/src/lib/spec-catalog.ts`; move the **recursive** `listSpecs(rootDir): SpecSummary[]` (currently `views/spec-tree-provider.ts:36`, walks product/feature subfolders) into it **unchanged**. Re-export `SpecSummary` from `lib/spec-manager` so consumers get both from one path.
- [x] **1.2** In `views/spec-tree-provider.ts`: delete the moved fn; `import { listSpecs } from '../lib/spec-catalog'` (allowed down-edge); keep `SpecTreeProvider` + the `ListSpecsFn` DI seam (default `= listSpecs`).
- [x] **1.3** Repoint the three consumers `commands/{approve,approve-active,validate}.ts` from `'../views/spec-tree-provider'` → `'../lib/spec-catalog'` (they import `listSpecs` + `type SpecSummary`).
- [x] **1.4** Disambiguate the collision: rename the **shallow, top-level-only** scan `listSpecs` (`lib/spec-manager.ts:406`) → **`listSpecsShallow`**; repoint **both** call sites — the external consumer `views/spec-panel.ts` **and** the in-file `migrateLayout` caller at `lib/spec-manager.ts:614`. Behaviour-preserving (INV-2) — do **not** switch `spec-panel` to the recursive catalog (that changes its output; the nested-miss bug stays filed as **#877**, not fixed here).
- [x] **1.5** T `packages/minspec/tests/spec-catalog.test.ts`: assert the recursive scan returns the same `SpecSummary[]` as before the move (parity), and that `approve`/`approve-active`/`validate` resolve `listSpecs` from `lib/spec-catalog`; `spec-tree-provider.ts` no longer defines the fs scan. **(AC-6)**
- [x] **1.6** ✅ Checkpoint: `npm test` green (AC-7). Commit — behaviour-preserving move only.

## Group 2 — FR-5: reverse the two `lib→views` inversions

- [x] **2.1** FR-5a: create `packages/minspec/src/lib/spec-progress.ts`; move `fromFrontmatter`, `computeProgress`, and the `StatusBarSpec` type out of `views/status-bar.ts` (they are already pure — only import `lib/config` `PHASES`/`DEFAULT_CONFIG` + `lib/spec` types). OQ-4: this cohesive module, **not** a `lib/util` grab-bag.
- [x] **2.2** Repoint `views/status-bar.ts` and `lib/active-spec.ts:6` to import the three from `'../lib/spec-progress'` / `'./spec-progress'` (down-edges). Removes the one **value** `lib→views` edge.
- [x] **2.3** FR-5b: in `lib/approval-diff.ts`, replace `import type { SpecNode } from '../views/spec-tree-provider'` with a local `type SpecNodeArg = { spec: { filePath: string } }` (the only field used, at line ~127). The view's real `SpecNode` structurally satisfies it, so command wiring is unchanged at runtime. Removes the one **type** `lib→views` edge.
- [x] **2.4** Verify **zero** `lib→views` edges remain: `grep -rE "from '\\.\\./(views|commands)" packages/minspec/src/lib/*.ts` returns nothing.
- [x] **2.5** T `packages/minspec/tests/spec-progress.test.ts`: pins `fromFrontmatter`/`computeProgress` behaviour post-move.
- [x] **2.6** ✅ Checkpoint: `npm test` green (AC-7). Commit — the tree is now layering-clean, so FR-1 can ship green next.

## Group 3 — FR-2: in-repo cycle gate (ships green)

- [x] **3.1** Create `packages/minspec/src/lib/import-cycle-check.ts` (Tier-0; no vscode/network): (a) build the **value-import** graph of `packages/minspec/src` via the `typescript` compiler API (`ts.createSourceFile`), recording an edge only for value imports — skip `importClause.isTypeOnly` and drop `import { type X }` specifiers; resolve `./`/`../` specifiers to on-disk `.ts`, ignore bare/`@aiclarity/*`; exclude `test/**`, `__benchmarks__/**`. (b) detect cycles with the iterative three-color DFS **ported from `next-task.ts:337` `detectCycles`** (explicit stack, deterministic order, O(V+E)). (c) `export function findValueImportCycles(srcRoot): ImportCycle[]`.
- [x] **3.2** Create `scripts/check-import-cycles.ts` (CLI runner, mirrors `validate-frontmatter.ts`): call `findValueImportCycles`, print each cycle's member chain, `process.exit(1)` on any cycle.
- [x] **3.3** `package.json`: add `"check:cycles": "npx tsx scripts/check-import-cycles.ts"`; wire it into the CI workflow. **CI-only, decided at Implement:** the gate takes ~8.8s on the real tree (95 modules), which is too slow to sit in `.githooks/pre-commit` — that hook runs `npm run validate` and is deliberately kept fast enough not to be bypassed, and a hook people disable is worse than no hook. A cycle can only be introduced by an import edit, and CI blocks the merge, so nothing reaches `main` ungated. Also note INV-1 (offline) holds for the checker *module* but not its `npx tsx` runner, which resolves over the network on a cold cache — pre-existing across every `npx tsx` script here, tracked at [#979](https://github.com/AIClarityAU/minspec/issues/979).
- [x] **3.4** T `packages/minspec/tests/import-cycle-check.test.ts`: a synthetic fixture with a fresh **value** back-edge → cycle found; the real `packages/minspec/src` tree → **zero** cycles (confirms the three known cycles are type-only-closed). **(AC-4, AC-5)**
- [x] **3.5** ✅ Checkpoint: `npm run check:cycles` exits 0 (green); `npm test` green. Commit.

## Group 4 — FR-1: direction + depth rules (eslint, `error`) — added last

- [x] **4.1** **R3 measurement (owed by the Plan).** Record `npm run lint` wall-time now (baseline), then with `parserOptions.project` added. If type-aware lint is unacceptably slow, fall back to value-only `no-restricted-imports` (DR-064 §3 documented fallback) — **not** abandoning the gate. Write the numbers into the PR description.
- [x] **4.2** `eslint.config.mjs`: add `parserOptions.project` referencing the `packages/minspec` + `packages/shared` tsconfigs (needed so the parser sees type-only imports — DR-064 §3).
  **Shipped as `projectService: true`, not an explicit `project` array** — the stable documented form in
  `@typescript-eslint` v8, which discovers each package's own tsconfig itself. Equivalent in effect (the
  parser sees type-only imports, which is all DR-064 §3 requires) and avoids a second copy of the package
  list that drifts when a package is added. Consequence: `packages/minspec/tsconfig.json` was never edited,
  so it is absent from `affects:` despite the Plan forecasting it. Recorded in design.md §Risks.
- [x] **4.3** Add a `packages/minspec/src/lib/**`-scoped block: `@typescript-eslint/no-restricted-imports` with `allowTypeImports: false`, banning `../views`, `../views/*`, `../commands`, `../commands/*` (value **and** type — OQ-2). At `error`.
- [x] **4.4** Add a repo-wide block banning **deep** `@aiclarity/shared/*` imports (allow the bare `@aiclarity/shared` barrel — DR-014). At `error`.
- [x] **4.5** Scope: `files` covers `packages/minspec/src/{lib,views,commands}` + `extension.ts`; **exclude** `**/src/test/**` and `**/src/__benchmarks__/**`.
- [x] **4.6** T `packages/minspec/tests/import-boundaries.test.ts`: a `lib` fixture importing `../views` (value) → error and (type) → error **(AC-1)**; a deep `@aiclarity/shared/src/...` → error, the barrel → pass **(AC-2)**.
- [x] **4.7** ✅ Checkpoint: `npm run lint` (error rules) is **green** on the post-refactor tree **(AC-5)**. Commit.

## Group 5 — FR-3: vscode-purity rule (`warn`)

- [x] **5.1** `eslint.config.mjs`: add a second `lib/**`-scoped `no-restricted-imports` entry banning `vscode` at **`warn`**, with **`allowTypeImports: true`** (type-only vscode = zero runtime coupling → Tier-0-legal; the deliberate asymmetry with FR-1). `presence.ts`'s `import type * as vscode` is exempt by design.
- [x] **5.2** Extend `import-boundaries.test.ts`: a `lib` fixture **value**-importing `vscode` → warn; a **type-only** `import type … 'vscode'` → no warn; assert the current tree reports **exactly 7** vscode warnings (value importers), `presence.ts` not among them. Count-asserted so the `warn`→`error` flip at #830 is a one-line, test-verified change. **(AC-3)**
- [x] **5.3** ✅ Checkpoint: `npm run lint` reports **exactly 7** vscode warnings and **0** new errors on the clean tree **(AC-5)**. Commit.

## Group 6 — close-out

- [x] **6.1** Full `npm test` (vitest) green across the whole change **(AC-7)**; `npm run lint` + `npm run check:cycles` green.
- [x] **6.2** Promote the design.md §File-plan **touched** surfaces into `requirements.md` `affects:` (deferred from Plan to avoid edit-locking shared files under a then-stale approval). (Re-approval expected — `affects:` is substantive frontmatter.)
  **The Plan's forecast list was wrong in both directions and was corrected against what was actually touched** — a forecast is not evidence, and a false ownership declaration under SPEC-038 is exactly the kind of signpost this repo must not ship:
  - **Dropped** `packages/minspec/tsconfig.json` — never edited. DR-064 §3's `parserOptions.project` was implemented as `projectService: true`, which reads each package's own tsconfig itself, so nothing needed changing there.
  - **Added** `packages/minspec/src/extension.ts` (FR-5a import repoint), `.github/workflows/ci.yml` (FR-2 gate step), `views/codelens-provider.ts`, `lib/artifact-graph.ts`, `lib/approvable.ts`, `lib/spec-layout.ts`, `lib/spec-validator.ts` (comments that named `listSpecs`'s old home and were inverted by the FR-4 rename), and `commands/view-phase-file.ts` + `src/__benchmarks__/perf.bench.ts` (FR-5's dropped `SpecSummary` re-export).
  - The five new test files were also promoted into `implements:`, per design.md §File plan which lists them as owned.
- [x] **6.3** Advance phases: `tasks: done`, `implement: done`. Confirm AC-1…AC-7 all satisfied in the PR description.

## Acceptance-criteria coverage map

| AC | Covered by |
|---|---|
| AC-1 lib→views value+type → lint error | 4.3, 4.6 |
| AC-2 deep shared error / barrel pass | 4.4, 4.6 |
| AC-3 vscode warn, count==7, type-only exempt | 5.1, 5.2 |
| AC-4 fresh runtime cycle → CI fail | 3.1, 3.4 |
| AC-5 post-refactor lint+cycle green; 7 vscode warns exactly | 4.7, 5.3, 3.5 |
| AC-6 listSpecs from lib/spec-catalog; scan gone from view; two disambiguated | 1.1–1.4, 1.5 |
| AC-7 full suite green across every step | 1.6, 2.6, 3.5, 6.1 |

## Out of scope (mirrors requirements / design)

Relocating the 7 vscode-coupled `lib` files (#830); dissolving the three type-held cycles (FR-6);
dependency-graph *reporting* (#195/#88); splitting `spec-validator.ts` / `extension.ts`.
