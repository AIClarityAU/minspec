---
id: SPEC-053
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a silently-incomplete signpost is a wrong signpost
relates_to: [SPEC-040, SPEC-017, DR-003, DR-023]
implements: [packages/minspec/src/lib/spec-manager.ts, packages/minspec/src/views/spec-panel.ts, packages/minspec/src/lib/artifact-graph.ts, packages/minspec/tests/spec-manager.test.ts, packages/minspec/tests/spec-panel-class.test.ts, packages/minspec/tests/features.test.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — `spec-panel` and `migrateLayout` miss product-nested specs (Requirements)

> Traces to **[#877](https://github.com/AIClarityAU/minspec/issues/877)**, filed per
> **SPEC-040** FR-4 / R4 (design.md) + DR-023 (DRs must materialize their
> follow-ups — this is that materialization, not a silent carry).

## One-Sentence Scope

`lib/spec-manager.ts`'s `listSpecsShallow()` only reads the top level of
`specsDir` — in this monorepo that top level is the **product** dirs
(`specs/minspec`, `specs/agent-execute`), so every spec nested under a product
(`specs/minspec/SPEC-NNN-*/...`, i.e. essentially all real specs in this repo)
is invisible to `listSpecsShallow()`'s two callers, and this spec picks and
implements one of the two fix options SPEC-040 FR-4 deferred to triage.

## Context

SPEC-040 FR-4 (status: done, merged) extracted the **recursive** spec walk out
of `views/spec-tree-provider.ts` into `lib/spec-catalog.ts::listSpecs()` — used
by `approve`, `approve-active`, and `validate` — and renamed the pre-existing
**shallow**, top-level-only walk in `lib/spec-manager.ts` to
`listSpecsShallow()` as a **behaviour-preserving disambiguation**. It
deliberately did not change what `listSpecsShallow()` returns, and flagged that
its shallow behaviour is itself the bug this spec now addresses (design.md
FR-4/R4).

Verified against `main` at the time of writing, `listSpecsShallow()`
(`packages/minspec/src/lib/spec-manager.ts:408`) has exactly two callers, both
silently degraded by the same root cause:

- **`views/spec-panel.ts:112`**, `buildTrustModel()` — builds the trust-chart
  model (`M1` rework-% per spec, `M2` wasted-review bars) shown in the spec
  panel webview (SPEC-017). Every spec nested under a product dir is missing
  from both series. In this repo that is ~all of them — the trust chart is not
  approximately right, it is showing data for a near-empty set.
- **`lib/spec-manager.ts:616`**, `migrateLayout()` — the flat↔spec-kit layout
  migration invoked by the `minspec.migrateLayout` command
  (`commands/migrate.ts`). Nested specs are silently skipped: `migrated` under-
  reports and the command exits `success: true` having touched none of the
  specs a user would actually expect it to touch. No data is lost (skipped, not
  deleted) but the count and the completion message both lie by omission.

No test pins nested-spec coverage for either caller —
`spec-manager.test.ts`'s `listSpecsShallow()` suite (from line 278) and its
`migrateLayout()` suite (from line 769) both assert specs are found, never that
a **product-nested** spec is found. This is the #137 validator-asymmetry class
applied to test coverage rather than a validator: present-and-flat is checked,
missing-because-nested is not — same shape as the SPEC-002/SPEC-014 gap DR-003
was root-caused from.

Per the constitution's evidence-discipline / "never wrong" bar (this repo's own
CLAUDE.md, RCDD): a dashboard that silently omits ~all its data, and a
migration command that silently no-ops on ~all its targets while reporting
`success: true`, are exactly the class of false-positive signpost this project
exists to prevent developers from shipping. This bug is *of* the product,
found *in* the product.

## Functional Requirements

- **FR-1 — Fix `listSpecsShallow()`'s coverage.** Product-nested specs
  (`specs/<product>/SPEC-NNN-*/...` and `specs/<product>/SPEC-NNN-*.md`) MUST
  be visible to both current callers. Two options, deliberately left open —
  see **Decisions needed** below:
  1. Repoint `spec-panel.ts::buildTrustModel()` and
     `spec-manager.ts::migrateLayout()` at the recursive
     `lib/spec-catalog.ts::listSpecs()`, and retire (or narrow the doc comment
     on) `listSpecsShallow()`.
  2. Add product-dir recursion to `listSpecsShallow()` itself, keeping two
     scan functions with genuinely different behaviour.
- **FR-2 — Trust chart correctness (spec-panel).** Once fixed, `M1` (rework %)
  and `M2` (wasted-review bars) in the spec-panel trust chart MUST include
  every spec `listSpecs()`/`listSpecsShallow()` would report for the same
  root — i.e. parity with the recursive catalog's coverage — not merely "more
  than zero".
- **FR-3 — Migration correctness (`migrateLayout`).** Once fixed,
  `migrateLayout()` MUST migrate product-nested specs the same as top-level
  ones (byte-for-byte content preservation is already covered by
  `spec-manager.test.ts`'s existing flat↔spec-kit round-trip tests — FR-3 only
  extends that coverage to nested specs, it does not restate the lossless
  invariant). `MigrationResult.migrated` MUST count them.
- **FR-4 — Regression test, both callers.** A test pinning that a
  product-nested spec (`specs/<product>/SPEC-NNN-*/requirements.md` fixture,
  mirroring the real layout already used by
  `nextSpecId() per-product scoping (#57)` in `spec-manager.test.ts:115`) is:
  (a) present in `listSpecsShallow()`'s (or its replacement's) output, (b)
  counted in `buildTrustModel()`'s `rework`/`wasted` series, and (c) migrated
  by `migrateLayout()`. This is the missing-direction assertion the Context
  section identifies as absent today.
- **FR-5 — No behaviour change for the flat-layout / single-product case.**
  Projects with specs living directly at `specsDir` top level (no product
  nesting) MUST see identical `listSpecsShallow()`/trust-chart/migration
  output before and after — this is a coverage fix, not a rewrite of the
  already-correct flat path. `spec-manager.test.ts`'s existing
  `listSpecsShallow()` and `migrateLayout()` suites (lines 278, 769) continue
  to pass unmodified.

## Acceptance Criteria

- **AC-1** (FR-1, FR-4): Given a project with `specs/<product>/SPEC-NNN-*/requirements.md`,
  the chosen fix's spec-listing function returns that spec. Test fails on
  `main` today (red), passes after the fix (green) — the base-red/head-green
  pair the regression test must demonstrate.
- **AC-2** (FR-2, FR-4): Given the same fixture, `spec-panel`'s
  `buildTrustModel()` output includes an entry for the nested spec's id in
  `rework`, and, where that spec has superseded review history, in `wasted`.
- **AC-3** (FR-3, FR-4): Given the same fixture, `migrateLayout(rootDir,
  target)` migrates the nested spec (file moves/converts per SPEC-040's
  existing round-trip invariant) and `MigrationResult.migrated` includes it in
  the count.
- **AC-4** (FR-5): The full pre-existing `listSpecsShallow()` and
  `migrateLayout()` test suites in `spec-manager.test.ts` pass unmodified
  against the fixed implementation.
- **AC-5** (whichever option Clarify picks): if Option 1 (repoint to
  `listSpecs()`), `listSpecsShallow()`'s exported surface is either removed or
  its doc comment is corrected to state its top-level-only scope truthfully
  (it currently only says so implicitly, via SPEC-040's rename) — no
  now-misleading "list all specs" callers left pointing at the shallow
  version. If Option 2 (add recursion), `listSpecsShallow()`'s name and doc
  comment stop being an accurate description of what it does and MUST be
  revisited too (a "shallow" function that recurses is its own asymmetry).

## Invariants this change must not break

- **T0 / offline (constitution #1):** the fix is a pure filesystem-walk change;
  no network call is introduced.
- **Lossless migration (SPEC-040 FR-4's carried invariant, INV-2):** frontmatter
  and body content byte-for-byte preserved across `migrateLayout()` — FR-3
  extends coverage, does not touch the write path's correctness.
- **Non-destructive trust chart (SPEC-017 FR-11):** `buildTrustModel()` remains
  read-only over specs + approval sidecars; FR-2 only widens what it reads, not
  what it writes (still nothing).
- **`lib` layering (SPEC-040 FR-1):** whichever option is chosen, the fix stays
  within `lib/**`'s existing import boundaries — Option 1 reuses an existing
  `lib/spec-catalog.ts` import (already legal per FR-1's eslint rule),
  Option 2 adds no new cross-layer edge.

## Decisions needed (Clarify)

1. **Which fix option (FR-1)?** The issue's own scope section names both and
   explicitly defers the choice:
   - **Option 1 — repoint both callers at `lib/spec-catalog.ts::listSpecs()`.**
     Pro: one spec-listing implementation, not two with subtly different
     coverage (the exact shape of bug that created this issue). Con: `listSpecs()`
     was written for the approval/validate pipeline's needs (its doc comment:
     "Multiple files sharing one id... collapse to a single entry") — needs a
     check that its output shape is a drop-in for `SpecSummary` as
     `spec-panel.ts` and `migrateLayout()` currently consume it, and a look at
     whether `listSpecs()`'s per-call cost (full recursive parse) is
     acceptable in `buildTrustModel()`, which SPEC-017 already flags as a
     perf-sensitive path (see `spec-tree-provider.ts:340`'s comment on
     avoiding a full pass per render).
   - **Option 2 — add product-dir recursion to `listSpecsShallow()` itself.**
     Pro: smaller diff, no perf-characteristic change for the two existing
     callers. Con: keeps two spec-walk implementations with different
     recursion depth alive long-term, which is the precise convention-not-gate
     failure mode SPEC-040's Context section (echoed above) already named once
     for the code-layering problem — recreating it for spec-listing coverage
     is a foreseeable repeat.
   Recommendation for Plan phase: default to **Option 1** unless the perf
   check above turns up a real regression — one implementation is the
   asymmetry-resistant choice, and SPEC-040 already paid the cost of proving
   `listSpecs()` is the correct recursive walk.
2. **Does `migrateLayout()` staying on the (possibly retired) shallow function
   matter operationally before this ships**, i.e. is there a known population
   of real projects with nested specs who have run `minspec.migrateLayout` and
   silently had specs skipped? (Informs whether AC-3 needs an explicit
   backward-compat note in the PR description, not a spec change.)

## Out of scope

- Any change to `lib/spec-catalog.ts::listSpecs()`'s own behaviour — it is
  already correct (SPEC-040 FR-4) and this spec only decides whether more
  callers point at it.
- `views/spec-tree-provider.ts`'s consumption of `listSpecs()` — unaffected,
  already recursive.
- Renumbering or re-scoping SPEC-040 (`status: done`) — this is a follow-up
  spec per DR-023, not an amendment to a shipped one.
