---
id: SPEC-040
type: requirements
# 🔒 Once approved, hash-locked: approved bytes recorded in .minspec/approvals.json[SPEC-040].specHash. ANY edit voids approval (hash → stale) — re-run "MinSpec: Approve Spec". DR-012.
status: implementing
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology — code-change safety
aspects: [architecture, tier-0, governance, validation]
relates_to: [SPEC-038, DR-003, DR-014, DR-064]
# Owned code (SPEC-038 FR-3). Finalised at Plan (design.md §File plan). `affects:` for the
# moved/edited shared surfaces (eslint.config.mjs, status-bar, active-spec, approval-diff,
# spec-tree-provider, spec-manager, spec-panel, the 3 command files, tsconfig, package.json)
# is deliberately deferred to Implement — SPEC-038 edit-locks affects: paths identically to
# implements:, so declaring live shared files under this stale spec would block concurrent edits.
implements:
  - packages/minspec/src/lib/spec-catalog.ts        # FR-4 — new Tier-0 catalog (extracted recursive listSpecs)
  - packages/minspec/src/lib/spec-progress.ts        # FR-5a — new Tier-0 home for fromFrontmatter/computeProgress (OQ-4)
  - packages/minspec/src/lib/import-cycle-check.ts   # FR-2 — in-repo cycle-graph builder + DFS (DR-064 §1)
  - scripts/check-import-cycles.ts                    # FR-2 — CI runner (npx tsx); npm run check:cycles
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# MinSpec — Machine-enforced import boundaries (Requirements)

> Traces to **[#690](https://github.com/AIClarityAU/minspec/issues/690)** — the second step of the code-safety track (malleability audit → #742). Where SPEC-038 made the **spec→code** contract enforceable, this makes the **code→code layering** contract enforceable. Adversarially reviewed before this draft; the review corrected several claims (see Context) — held to SPEC-038's evidence bar.

## One-Sentence Scope

Turn MinSpec's layered architecture — `lib/**` never imports `views`/`commands`, `@aiclarity/shared` is consumed barrel-only, and there are no runtime import cycles — from a **convention that already leaks** into a **machine-enforced gate** (eslint + a CI cycle check), after the small refactors that make the current code pass it; the vscode-purity rule ships at `warn` pending a separate relocation.

## Context

The 2026-07-13 malleability audit found the architecture is held **by convention alone**, and that convention has **already leaked** (all verified present on `main` at the time of writing):

- **Two `lib→views` inversions** (pure logic depending on the UI layer): `packages/minspec/src/lib/active-spec.ts:6` value-imports `fromFrontmatter`/`computeProgress` from `../views/status-bar`; `lib/approval-diff.ts:21` type-imports `SpecNode` from `../views/spec-tree-provider`. Grep confirms these are the **only two** `lib→views` edges and there are **zero** `lib→commands` edges.
- **Three import cycles** among `lib` modules, each currently held runtime-safe by exactly one `import type` edge — so there are **zero runtime cycles today**, but each is one careless `type`→value edit from a real require cycle, ungated: `approval↔approval-store` (value edge `approval→approval-store`), `lifecycle↔spec` (value edge `spec→lifecycle`), and the 4-node `epic-manager→spec-layout→spec-validator→epic-manager→spec-manager` closed by `epic-manager.ts:4` value-importing `slugify` from `spec-manager`.
- **Core data access living in a UI file:** the recursive `listSpecs()` (a pure fs scan) sits in `views/spec-tree-provider.ts:36` and is consumed by the `approve`, `approve-active`, and `validate` flows — so "refactor the tree view" silently reaches the approval pipeline (that file is the 2nd-highest-churn source file, ~26 commits).

The lesson SPEC-038 proved: **deterministic gates change behaviour; conventions do not** — the RCDD commit-msg gate visibly forced `Root cause:` compliance up at install (exact figures per the commit-msg-gate landing, not re-derived here). This is the validator-asymmetry insight (#137) applied to **code structure**: today the linter checks style but never asserts the layering rule.

## Functional Requirements

- **FR-1 — Layer-import rules, shipped at `error` (eslint `no-restricted-imports`), scoped to `packages/minspec/src/{lib,views,commands}` + `extension.ts`** (NOT `src/test/**` or `src/__benchmarks__/**`, which legitimately import views/vscode and stay exempt):
  - `lib/**` MUST NOT import from `../views` or `../commands`, **value or type** (OQ-2: banning type too keeps the rule a simple "`lib` imports nothing from the UI layers"; note this needs `@typescript-eslint/no-restricted-imports` with `allowTypeImports:false` + a `parserOptions.project`, since base eslint can't see type-only imports — OQ-3).
  - No **deep** `@aiclarity/shared/*` imports anywhere — barrel-only (`@aiclarity/shared`), per DR-014. (Preventive — zero violations today.)
- **FR-2 — No runtime import cycles (CI gate), at `error`.** A **value-import** cycle among `packages/minspec/src` modules fails CI. There are **zero today** (the three cycles are type-only-closed), so the gate ships green; it guards every future edit — including a `type`→value flip that would introduce one. Runs **offline** (INV-1).
- **FR-3 — vscode-purity rule, shipped at `warn`.** Only `commands/**`, `views/**`, `extension.ts` should import `vscode`; a `lib/**` file importing it **at runtime (value import)** is flagged. **7 `lib/` files value-import vscode today** (`diagnostics`, `active-adr`, `resolve-folder`, `bridge`, `ai-usage-detector`, `active-spec`, `approval-diff`) with deep API use — relocating them is [#830](https://github.com/AIClarityAU/minspec/issues/830). **Type-only exempt (`allowTypeImports: true`) — the one asymmetry with FR-1:** a `import type * as vscode` compiles away to zero runtime coupling, so it does not break Tier-0 purity; `lib/presence.ts:22` is exactly this (a deliberate Tier-0 choice so unit tests + the bash-parity harness import it without a vscode mock) and is correctly **not** counted. FR-3 enforces *runtime purity*; FR-1 enforces *layering* (and bans type edges) — different goals, hence the different `allowTypeImports`. Until #830 relocates the 7, this rule is `warn`, not `error` (so `main` is never red); it flips to `error` when #830 lands.
- **FR-4 — Prerequisite refactor A: extract the recursive `listSpecs`.** Move the recursive `listSpecs()` from `views/spec-tree-provider.ts` into a new Tier-0 `lib/spec-catalog.ts`; the `approve`/`approve-active`/`validate` flows import it from `lib`. **Note the collision:** a *second, different* `listSpecs` (flat, top-level-only) already exists at `lib/spec-manager.ts:406` and is consumed by `views/spec-panel.ts` — Plan MUST disambiguate the two (rename one, or consolidate; the flat one misses nested specs, a latent `spec-panel` bug worth surfacing).
- **FR-5 — Prerequisite refactor B: reverse the two `lib→views` inversions.**
  - Move `fromFrontmatter`/`computeProgress` from `views/status-bar` into `lib`, fixing `active-spec.ts`.
  - `SpecNode` — the type `approval-diff.ts` imports from the view — is defined in the view; `SpecSummary` (which the view merely **re-exports** from `lib/spec-manager.ts:25`) is already in lib. Relocate the field-subset `approval-diff` needs into `lib` and **drop the view's re-export path**, so `lib` imports nothing (value or type) from `views`.
- **FR-6 — Deferred: dissolving the three type-held cycles is fragility-reduction, not gate-required.** Because FR-2 gates *runtime* cycles and there are zero, the gate ships green without touching the three. Optionally re-homing the closing value edges (e.g. `slugify` → a `lib` util so `epic-manager` no longer imports `spec-manager`; the `approval→approval-store` and `spec→lifecycle` value edges likewise) removes the "one-edit-away" fragility. Tracked as a follow-up, NOT a blocker for FR-1/FR-2 (a spec that must ship the gate need not first refactor edges the gate does not flag).

## Costly to Refactor

- **The layering contract encoded in the eslint config** — which layer may import which. Loosening it later silently re-opens the door; treat it as an architectural artifact. Decide the allowed-edge set at Clarify/Plan.
- **Cheap to reverse:** the cycle-checker tool (OQ-1), the type-vs-value strictness (OQ-2/OQ-3), whether FR-6's cleanup happens now or later.

## Acceptance Criteria

- **AC-1** — A `lib/**` file importing from `../views` or `../commands` (value or type) fails `npm run lint`.
- **AC-2** — A deep `@aiclarity/shared/src/...` import fails `npm run lint`; the barrel `@aiclarity/shared` import passes.
- **AC-3** — A `lib/**` file **value**-importing `vscode` produces a lint **warning** (not error, until #830); a **type-only** `import type … 'vscode'` (e.g. `presence.ts`) does **not** warn (`allowTypeImports: true`). Asserted by **count == 7** (value importers) on the current tree, so the warn→error flip is a one-line change verified by the same test.
- **AC-4** — Introducing a **runtime (value-import) cycle** in `packages/minspec/src` — a fresh value back-edge between two modules — fails the CI cycle gate. (NOT flipping an existing `import type` edge on the shipped tree, which need not close a loop after FR-4/FR-5.)
- **AC-5** — On the post-refactor tree, `npm run lint` (error rules) **and** the cycle gate are green; the vscode rule reports exactly its 7 known warnings and no more.
- **AC-6** — The recursive `listSpecs` resolves from `lib/spec-catalog`; `approve`/`approve-active`/`validate` import it from `lib`; `spec-tree-provider.ts` no longer defines the fs scan; the two `listSpecs` are disambiguated.
- **AC-7** — The full existing test suite stays green across the refactors (behaviour-preserving moves — the tests pin observable behaviour, not import paths).

## Out of Scope

- **Relocating the 7 vscode-coupled lib files** — [#830](https://github.com/AIClarityAU/minspec/issues/830); this spec only ships the vscode rule at `warn`.
- **Dissolving the three type-held cycles** — optional fragility-reduction (FR-6), a follow-on, not part of the gate.
- **Fan-in/fan-out metrics, blast-radius reporting, a queryable dependency graph** — #195/#88 / CodeGraph. This enforces *rules*, it does not *report* structure.
- **Splitting the god files** (`spec-validator.ts`, `extension.ts`) — separate.

## Open Questions

> **OQ-1/OQ-2/OQ-3 resolved by [DR-064](../../../docs/decisions/DR-064.md)** (the three load-bearing, costly-to-reverse choices). OQ-4 stays Plan-level (cheap to reverse) by design. Resolutions folded below; Clarify closes on these.

- **OQ-1 — cycle-checker.** `madge --circular` (dev-dep + transitive deps), `dependency-cruiser` (heavier), or a **small in-repo checker adapting `packages/shared/src/next-task.ts`'s proven three-color-DFS `detectCycles`** (currently over the `depends_on` DAG — the same algorithm applied to the module import graph). The in-repo route adds no supply-chain surface and satisfies INV-1 best. *(Corrects an earlier draft claim that "the audit already prototyped a checker" — it did not; `detectCycles` is the real reusable asset.)* **Resolved (DR-064 §1): in-repo checker** — madge/dependency-cruiser rejected for supply-chain surface + offline (INV-1) cost.
- **OQ-2 — type-only `lib→views`.** Ban them too (FR-5 removes the type), or allow type-only edges (no runtime coupling)? **Resolved (DR-064 §2): ban type too** — a clean "`lib` imports nothing from the UI layers" is unambiguous, and FR-5 removes the one type edge so it costs nothing on the shipped tree.
- **OQ-3 — eslint mechanism.** Base `no-restricted-imports` can't distinguish type vs value; "ban type too" (OQ-2) requires `@typescript-eslint/no-restricted-imports` + `parserOptions.project` (the config has none today). Weigh adding type-aware linting (slower) vs a lighter path. `eslint-plugin-boundaries` is a heavier alternative. **Resolved (DR-064 §3): `@typescript-eslint/no-restricted-imports` with `allowTypeImports:false` + add `parserOptions.project`** (plugin+parser are already deps — no new dependency); documented fallback to value-only if type-aware lint cost is unacceptable (R3); `eslint-plugin-boundaries` rejected (new dep).
- **OQ-4 — home for relocated utilities** (`fromFrontmatter`/`computeProgress`, the `SpecNode` subset, and — if FR-6 runs — `slugify`) — one `lib/util` module or each beside its most-related lib module. **Plan-level (unresolved by design — cheap to reverse; DR-064 §5).** Leaning: co-locate beside the most-related lib module, not a grab-bag `lib/util`.

## Invariants

- **INV-1 (constitution #1 — offline).** The cycle gate + lint run with no network — constrains OQ-1 toward a dependency-free or pinned-dev-only checker.
- **INV-2 (behaviour-preserving refactors).** FR-4/FR-5 are pure moves; AC-7 (the full suite) is the guardrail — a test that breaks on a move signals real coupling, not an acceptable cost.
- **INV-3 (Tier-0 purity, DR-014).** Relocated helpers land in `lib` with no vscode/network imports; `@aiclarity/shared` stays barrel-consumed.
- **INV-4 (no self-exemption).** A per-file `eslint-disable` to dodge an `error`-level boundary rule is itself a violation the review must reject. (The vscode rule is `warn` by design, not by disable.)

## Risks & Mitigations

| # | Risk | L·I | Mitigation |
|---|---|---|---|
| R1 | A refactor move silently changes behaviour. | Low·High | INV-2 + AC-7: full suite across every move; moves are mechanical, reviewed per-file. |
| R2 | The `error` rules over-fire on a legitimate edge. | Med·Med | They ship only after FR-4/FR-5 make the tree clean (AC-5); allowed edges reviewed at Plan; the vscode rule (the one with current violations) ships at `warn`. |
| R3 | Type-aware linting (OQ-3) is slow / needs `parserOptions.project`. | Med·Low | Measured at Plan; fallback to value-only `no-restricted-imports` (OQ-2 "allow type-only") if the cost is unacceptable. |
| R4 | The two `listSpecs` diverge further / `spec-panel`'s flat scan misses nested specs. | Med·Med | FR-4/AC-6 force disambiguation; the latent `spec-panel` bug is surfaced for a decision, not silently carried. |

## Dependencies

- **[#690](https://github.com/AIClarityAU/minspec/issues/690)** + the malleability audit (#689–#696, #742).
- **[#830](https://github.com/AIClarityAU/minspec/issues/830)** — relocate the 7 vscode-coupled lib files (flips FR-3 to error).
- **SPEC-038 / #460** — the sibling code-safety spec (spec→code); this is code→code, same "gates not conventions" thesis (#137).
- **DR-014** — the `@aiclarity/shared` public-API boundary FR-1 enforces.
- **`packages/shared/src/next-task.ts` `detectCycles`** — the reusable three-color-DFS pattern for OQ-1's in-repo checker.
