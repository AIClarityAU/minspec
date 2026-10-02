---
epic: EPIC-002  # Signpost Integrity — a tasks/implement transition that claims test coverage nothing checked is a lying signpost, the same class SPEC-006 (stub-completeness-gate) closed for code
id: SPEC-097
type: requirements
# Editing voids approval (hash in .minspec/approvals.json → stale); re-run "MinSpec: Approve Spec". DR-012
status: specifying
tier: T3
product: minspec
relates_to: [SPEC-006, DR-012, DR-003, DR-004, "#52"]
implements: []
---

# MinSpec — Test-Completeness Gate (Requirements)

**Date:** 2026-10-02
**Status:** Specifying (SDD Specify phase)
**Triggered by:** [#52](https://github.com/AIClarityAU/minspec/issues/52)

---

## Context

A session asked: at what stage does MinSpec map out *all* the tests a change needs,
and how is thoroughness verified — before coding starts, not after?

Today, test definition lives inside the `tasks` phase (T3/T4 only), but it is
ad-hoc prose: individual work items in `specs/minspec/tasks.md` carry an inline
`**T0 tests:**` bullet (e.g. lines 66, 76, 119, 237) written by whoever authored
that item, with nothing checking that every item — let alone every requirement or
invariant — has one. Three gaps follow directly:

1. **No completeness gate between `tasks` and `implement`.** `phaseMappings` in
   `.minspec/config.json` (`T3`/`T4`: `specify → plan → tasks → implement`, with
   `clarify` also required for T4) requires a `tasks` phase before `implement`,
   but nothing checks that the tasks phase actually enumerated a test for every
   `FR-N` in `requirements.md` or every constitution invariant the change touches.
   A tasks phase can be marked done — and, via `minspec.advancePhaseOnApprove`
   (`packages/minspec/src/commands/approve.ts:124`), the spec can advance into
   `implement` — with requirements that have zero test coverage planned.
2. **Tests are scattered inline, not derived systematically.** The `**T0
   tests:**` convention is free text per work item; it is easy to miss a branch,
   an `FR-N`, or an invariant, and nothing re-derives the list from the
   requirements/invariants/API surface to catch the miss.
3. **No traceability matrix exists for requirement/invariant → test.** A
   requirement-level file/test mapping schema *does* already exist —
   `packages/minspec/src/lib/traceability.ts`, backing `.minspec/traceability.json`
   (`requirementKey → { files[], tests[] }`, keyed per spec) — but it is written
   **only** by a human clicking the codelens action in
   `packages/minspec/src/views/codelens-provider.ts`. Nothing populates it
   automatically from `FR-N` ids, nothing populates it from constitution
   invariants at all, and nothing reads it to refuse a phase transition.
   `grep -rl` for writers of `addFileMapping`/`addTestMapping` outside
   `traceability.ts` itself returns only the codelens provider and a benchmark
   fixture — confirmed by direct read, not inferred.

### Prior art — reuse, don't re-derive (mirrors SPEC-006)

[SPEC-006 (stub-completeness-gate)](../SPEC-006-stub-completeness-gate/requirements.md)
closed the sibling gap on the *code* side: a spec could reach `status: done` while
its traced files still held `TODO`/`STUB` markers. Its RD-3 decision — extend the
existing pure `validateSpec()` (`packages/minspec/src/lib/spec-validator.ts:899`)
with another completeness rule, rather than build a second, parallel checking
engine — is the precedent this spec follows for the *test* side. Reusing it keeps
one completeness engine instead of two that can drift (the exact failure SPEC-006's
RD-3 was written to prevent).

## Requirements

- **FR-1 (derive required-test set from `FR-N`).** For a T3/T4 spec, every
  `FR-N` heading in its `requirements.md` (and, for a split-layout spec, its
  sibling `tasks.md`) is enumerated as requiring **at least one** mapped test: a
  happy-path case and, where the FR states a failure/rejection condition, a
  failure case. Pure text/frontmatter parse — no AI, no network (Tier 0, DR-004).
- **FR-2 (derive required-test set from constitution invariants touched by the
  spec).** Every constitution invariant the spec's `relates_to`/body text cites,
  or — failing an explicit citation — every invariant whose subject matter
  overlaps the spec's `implements:` files (see Decisions needed — this overlap
  test is not fully mechanical yet), requires at least one mapped T0 test.
  **100% of invariants a T3/T4 spec touches must be mapped; this is the one
  non-negotiable row (no equivalent of FR-5's inline override applies to
  invariant rows — see FR-6).**
- **FR-3 (derive required-test set from public shared-package exports).** Every
  exported function/class/type from `packages/shared/src/**` that the spec's
  `implements:` list adds or modifies requires at least one T1 contract test.
  Scope is deliberately `packages/shared` only (the Tier-0, no-vscode-import
  boundary already named in `.minspec/constitution.md` Constraints #1) — not
  `packages/minspec/src/**` generally, whose exported-function surface is far
  larger and would make this rule noisy on day one (see Out of scope).
- **FR-4 (test-to-requirement matching is a literal reference, not semantic
  judgement).** A test maps to an `FR-N`/`INV-N` when the test file is in scope
  (per FR-2 of SPEC-006's traced-file model, reused here) **and** the test's name
  or an adjacent line carries the requirement id as a word-boundary literal
  (`FR-3`, `INV-2`), mirroring the existing informal `**T0 tests:**` bullet
  convention in `tasks.md` and SPEC-006's own marker-matching approach (FR-1,
  FR-6 there). No AI inference of "this test probably covers FR-3" — only an
  explicit, greppable citation counts. This keeps the gate Tier 0 and avoids the
  false-positive class SPEC-006 FR-6 exists to exclude.
- **FR-5 (scope = traced files, reusing SPEC-006's model).** Test discovery
  scans only test files mapped to the active spec via
  `.minspec/traceability.json` (same scope source SPEC-006 FR-2 uses) **plus**
  any test file whose path the spec's `implements:` list names directly. A test
  file absent from both is not scanned (same traceability-staleness caveat
  SPEC-006 recorded as its R4 — see Risks).
- **FR-6 (gate point: `tasks` → `implement` phase transition, T3/T4 only).**
  The check runs when a spec's `tasks` phase is marked done / approved (the
  action in `packages/minspec/src/commands/approve.ts` that can trigger
  `advancePhaseOnApprove` into `implement`). If any `FR-N` or in-scope
  invariant has zero mapped tests, the transition is refused with a naming
  reason, listing exactly which ids are unmapped. T1/T2 specs are unaffected
  (mirrors SPEC-006 FR-3's tier gate — `phaseMappings` for T1/T2 has no `tasks`
  phase at all, so the hook point does not fire).
- **FR-7 (traceability-matrix surface).** A `requirement/invariant → test id →
  status (mapped/unmapped)` matrix is computable on demand (a
  `minspec.showTestTraceability`-style command, mirroring SPEC-006's
  `minspec.scanStubs`) and surfaced as editor diagnostics on the `tasks.md` /
  `requirements.md` file for each unmapped row. The matrix itself is **not**
  persisted as a new on-disk artifact (see Decisions needed — Zone A below
  explains why `.minspec/traceability.json` is reused rather than duplicated).
- **FR-8 (override).** A setting (e.g. `minspec.testGate.enabled`, default
  `true`) disables FR-6's block entirely, mirroring SPEC-006 FR-5's master
  toggle. **No per-row inline suppression exists for `FR-N` or public-API rows**
  — unlike SPEC-006's `minspec-stub-ok`, a missing test is not something a
  single line comment should wave through silently; the master toggle is the
  only override (see FR-2 for why invariant rows are even stricter — no override
  of any kind once the master toggle is on).

## Costly to Refactor (Zone A)

1. **Reuse `.minspec/traceability.json` + `traceability.ts` as the storage
   substrate (FR-5, FR-7).** The schema (`requirementKey → {files[], tests[]}`)
   already exists and is already read by the codelens provider. Building a
   second, parallel traceability file for this gate would immediately recreate
   the two-engines-drift failure SPEC-006's RD-3 was written to prevent, one
   layer up (two *traceability* stores instead of two *completeness* checks).
   Any implementation that adds a new file format here is a sign the wrong
   design was picked.
2. **The derive-from-artifacts direction (FR-1 FR-2, FR-3).** Required tests are
   computed *from* `requirements.md`/constitution/shared exports, never
   hand-declared in a separate "test plan" document. Flipping this (a
   human-authored test-plan file the gate merely checks exists) reintroduces
   gap #2 from Context — ad-hoc, drift-prone enumeration — which is the defect
   this spec exists to close.
3. **Literal-reference matching, not semantic (FR-4).** Once the gate ships on
   word-boundary id citation, switching to an AI/semantic "this test probably
   covers FR-3" judgement would cross the Tier-0 boundary (constitution
   invariant 1 / DR-004) and reopen the exact false-positive risk SPEC-006 FR-6
   was written to close for stub markers.
4. **Gate point = `tasks`→`implement`, not per-task `[x]` (FR-6).** Mirrors
   SPEC-006 RD-2's reasoning: a per-checkbox hook fires far more often than the
   phase-transition action and re-entangles with other PreToolUse-style gates
   this spec is defined to stay distinct from.

## Invariants (must hold)

- **INV — Tier 0 (DR-004, constitution invariant 1):** detection is pure
  file-system/text scan; no AI, no network call.
- **INV (ceremony ∝ complexity):** T1/T2 specs are untouched; the gate only
  fires where `tasks` is already a required phase (T3/T4).
- **INV (no silent gate, constitution invariant 2):** an unmapped `FR-N` or
  invariant fails the transition **visibly**, with the specific unmapped ids
  named — never a best-effort pass, never a swallowed error.
- **INV #5 (user override wins):** the master toggle (FR-8) disables the block;
  there is no finer-grained suppression that could be set-and-forgotten per row.

## Acceptance Criteria (Zone A)

- [ ] A T3/T4 spec's `requirements.md` with an `FR-N` that has no test citing
      `FR-N` (word-boundary) in any traced test file blocks the `tasks` →
      `implement` transition, naming `FR-N` in the refusal — **FR-1, FR-6**.
- [ ] A constitution invariant the spec cites (or that its `implements:` files
      overlap — pending the Decisions-needed resolution below) with zero
      mapped T0 tests blocks the transition the same way — **FR-2, FR-6**.
- [ ] An exported `packages/shared/src/**` function added/modified by the
      spec's `implements:` list, with zero T1 test citing it, blocks the
      transition — **FR-3, FR-6**.
- [ ] A test file outside both `.minspec/traceability.json`'s scope and the
      spec's `implements:` list is not scanned and cannot satisfy a mapping —
      **FR-5**.
- [ ] On a T1 or T2 spec, the gate never fires (no diagnostics, no
      transition block) — **tier-gate invariant**.
- [ ] `minspec.testGate.enabled = false` silences the block entirely; there is
      no inline per-row suppression — **FR-8**.
- [ ] The on-demand matrix command (FR-7) lists every `FR-N`/invariant/public
      export row with its mapped-test status, reading only
      `.minspec/traceability.json` plus a fresh scan — no second persisted
      store is created — **FR-7, Zone A #1**.
- [ ] The gate is implemented as an additional rule inside the existing
      `validateSpec()` (`packages/minspec/src/lib/spec-validator.ts:899`),
      reached through the same phase-transition call path SPEC-006 extended —
      no second validation engine — **Zone A #1, prior-art precedent**.

## Out of scope

- Enforcement on `packages/minspec/src/**`'s full exported-function surface
  (FR-3 is `packages/shared` only for v1 — see Decisions needed for the
  follow-up option).
- Mutation testing / branch-coverage percentage — this gate checks *presence*
  of a mapped test, not test *quality* or statement coverage. The existing,
  separate `coverage.minimumPercentage` config key
  (`packages/minspec/src/lib/config.ts:39`, read by CI/vitest) is a
  line-coverage floor on a different axis and is not touched by this spec —
  the two must not be conflated in the implementation.
- Auto-generating or stubbing the missing tests. The gate names the gap; a
  human or a later agent dispatch writes the test.
- Cross-boundary payload/schema contract tests called out in the issue body —
  genuinely out of scope for v1 pending the "what counts as a cross-boundary
  payload" definition (see Decisions needed); tracked as a follow-up, not
  silently dropped.

## Decisions needed (Clarify)

- **DQ-1 — Constitution invariants have no stable, referenceable id today.**
  `.minspec/constitution.md`'s `## Invariants` section is a *positional*
  numbered list (`1.`, `2.`, `3.` — confirmed by direct read, not the `INV-N`
  scheme the issue body assumes). Goals already solved this exact problem with
  a stable `G-N` id (`.minspec/constitution.md:35`, referenced via `goal: G-N`
  frontmatter). Two options:
  - **(rec) Option A — mint stable `INV-N` ids on the invariants list,
    mirroring `G-N`.** Cost: a one-time constitution edit (owned by the
    `minspec-constitution` skill/flow, not this spec) plus updating every
    prose reference that currently says "invariant 2" / "invariant #8"
    (several hit in this project's own memory notes) to the new id. Without
    it, FR-2's "every invariant the spec touches" has nothing stable to cite,
    and inserting a new invariant mid-list silently renumbers every later
    `INV-N` reference — the same collision class DR-012/DR's own id-collision
    gate exists to prevent for DR numbers.
  - **Option B — key invariant rows by a content slug/hash instead of a
    position number.** Avoids touching the constitution, but produces opaque
    ids (`inv-a3f9c1`) nobody can cite in prose, which cuts against this
    project's own "label every ref" convention.
  - This spec's FR-2 is written assuming Option A ships first; if the human
    picks Option B (or defers id-minting entirely), FR-2's matching mechanism
    needs to change before FR-6 can safely block on invariant rows, and the
    acceptance criterion for FR-2 should be treated as blocked, not partially
    gradeable.
- **DQ-2 — "the spec touches invariant N" has no mechanical test today.**
  Even with stable ids (DQ-1), deciding *which* invariants a given spec
  "touches" (FR-2) is not yet a pure function — today it is inferred from
  `relates_to` entries or free prose. Recommend **(rec) require an explicit
  `invariants: [INV-N, ...]` frontmatter field**, populated at Specify time
  (mirrors the existing `epic:`/`goal:` frontmatter pattern), rather than
  inferring touch from file overlap — explicit declaration is checkable
  (present/absent), inferred overlap is not. Cost: adds one more frontmatter
  field authors must remember to fill in, with nothing yet to catch a spec
  that silently omits it (the same missing-direction asymmetry DR-003's
  addendum names — a validator rule for "T3/T4 spec with an empty
  `invariants:` field" would need to ship alongside, which is Plan-phase
  scope, not Specify).
- **DQ-3 — should FR-3's public-API scope widen to `packages/minspec/src/**`
  later?** Recommend **(rec) stay `packages/shared` only for v1** (current
  wording) — cost: a `packages/minspec`-only public API change (e.g. a new
  exported command handler) gets no FR-3 coverage until a follow-up widens
  scope; the alternative (scope it in from day one) risks the exact noisy,
  trained-to-ignore outcome SPEC-006's R1 risk names for its own heuristic.

## Risks & Mitigations

| # | Risk | Likelihood · Impact | Mitigation |
|---|------|---------------------|------------|
| R1 | `.minspec/traceability.json` is stale/empty (today it is populated only via a manual codelens click), so FR-5's scope is empty and the gate passes vacuously | Med · High | Same honest-edge acceptance SPEC-006 recorded for its own R4: detection is correct, scope is empty; FR-6's refusal reason should name "zero traced tests found" distinctly from "tests found but unmapped" so the vacuous case is visible, not silent |
| R2 | DQ-1/DQ-2 (invariant ids + touch-detection) ship unresolved, so FR-2 is implemented against a moving target | Med · High | FR-2's acceptance criterion is explicitly gated on the Decisions-needed resolution above; Plan phase must not proceed on FR-2 until DQ-1 is answered |
| R3 | FR-4's literal-reference matching misses a test that *does* cover an `FR-N` but doesn't cite it by id, producing a false "unmapped" block on an already-tested requirement | Med · Med | Same trade-off SPEC-006 accepted for its own marker convention: authors adopt the citation convention going forward; a migration pass over existing tests is a follow-up, not a blocker for new specs |
| R4 | FR-3's shared-package scope misses a public-API change that lives in `packages/minspec/src` but is still externally consumed (e.g. by `packages/extension-pack`) | Low · Med | Named explicitly in Out of scope / DQ-3; not silently dropped |

## Assumptions

- `packages/minspec/src/lib/spec-validator.ts`'s `validateSpec()` remains the
  single completeness-rule engine (SPEC-006's RD-3 precedent holds); this spec
  adds rules to it rather than introducing a parallel checker.
- `.minspec/traceability.json`'s existing schema (`requirementKey → {files[],
  tests[]}`) is adequate as the storage substrate once populated more broadly;
  this spec does not propose a schema change.
- Each T3/T4 spec resolves a `tier:` (as SPEC-006 already assumes for its own
  FR-3) so the tier gate can decide enforcement.

## Test-thought

Verified by feeding `validateSpec()` a spec/tasks pair with a known set of
`FR-N` ids, a known `invariants:` declaration (post-DQ-1/DQ-2), and traced test
files carrying some-but-not-all matching citations, then asserting: (a) the
`tasks`→`implement` transition is refused naming exactly the unmapped ids, (b)
a fully-cited fixture passes, (c) T1/T2 fixtures are inert regardless of
citation state, and (d) the matrix command (FR-7) reports the same unmapped
set without needing a transition attempt.

## Coverage Map

| Mechanism / concern | FR |
|---|---|
| Required-test derivation from `FR-N` | FR-1 |
| Required-test derivation from constitution invariants | FR-2 |
| Required-test derivation from `packages/shared` public exports | FR-3 |
| Literal-reference (word-boundary id) matching, no AI | FR-4 |
| Scope = traced files (reuses SPEC-006's model) | FR-5 |
| Gate point: `tasks` → `implement`, T3/T4 only | FR-6 |
| On-demand traceability matrix, no new persisted store | FR-7 |
| Master-toggle override, no per-row suppression | FR-8 |

## Consequences

**Positive:**
- Closes the Context gap: a T3/T4 spec can no longer advance into `implement`
  (FR-6) while an `FR-N`, a declared invariant, or a `packages/shared` public
  export it touches has zero mapped test — the test-side mirror of SPEC-006's
  code-side completeness gate.
- Reuses `traceability.ts`'s existing schema and `validateSpec()`'s existing
  engine — no new storage format, no second completeness checker to drift.
- Stays Tier 0 (constitution invariant 1 / DR-004): pure text scan, no AI, no
  network.

**Negative:**
- FR-2 (the invariant-coverage row, the "100% required" one) cannot ship
  correctly until DQ-1/DQ-2 are resolved by a human — this spec's riskiest
  requirement is also its least mechanically ready one today.
- FR-4's literal-citation convention has a migration cost: tests written
  before this gate ships will read as "unmapped" until re-citation, the same
  adoption cost SPEC-006 accepted for its own marker convention.

## Failure-Modes / Edge-Cases

1. **Empty/missing `.minspec/traceability.json`** (FR-5) — zero traced test
   files → every row reads unmapped; gate blocks everything until the project
   populates traceability, which is a visible (not silent) consequence per the
   no-silent-gate invariant, distinct from "tests exist but uncited" (R1).
2. **A spec with `implements:` but no `invariants:` field** (DQ-2, if Option A
   ships) — ambiguous whether it touches zero invariants or the field was
   simply omitted; pending DQ-2's resolution, v1 should treat an absent field
   as "zero declared, zero required" rather than inferring, to avoid a false
   block, with the omission itself surfaced as a separate (non-blocking)
   warning.
3. **Split-layout spec** (`requirements.md` + `tasks.md` + `design.md`
   siblings) — `FR-N` ids may be declared in `requirements.md` but tests
   enumerated against `tasks.md`'s work items; FR-1 must read both files for
   a split-layout spec, not `requirements.md` alone.
4. **T1/T2 spec with uncited tests** — gate inert; no diagnostics, no block
   (tier-gate invariant).

## Test / Verification Strategy

| FR | Tier | Assertion sketch |
|---|---|---|
| FR-1 | T2 | `validateSpec()` on a fixture spec with `FR-1`..`FR-3` and test citations for only `FR-1`/`FR-2` reports `FR-3` unmapped |
| FR-2 | T2 | Blocked on DQ-1/DQ-2 — write once invariant ids + `invariants:` frontmatter exist; assertion sketch: declared `INV-2` with no citing T0 test reports unmapped |
| FR-3 | T1 | A `packages/shared/src` export added by the spec's `implements:` list with no citing test reports unmapped; an export outside `packages/shared` is not checked |
| FR-4 | T1 | A test named `...FR-3...` or carrying an adjacent `// FR-3` comment counts as a citation; `FR-30` does not satisfy `FR-3` (word-boundary) |
| FR-5 | T0 | A test file absent from both `.minspec/traceability.json` and `implements:` cannot satisfy any mapping, even if it textually cites the id |
| FR-6 | T0 | Fixture with all ids mapped: `tasks`→`implement` transition succeeds; any one id unmapped: transition refused, naming it; T1/T2 fixture: never blocked |
| FR-7 | T1 | Matrix command output matches `validateSpec()`'s own unmapped-id list for the same fixture (single source of truth) |
| FR-8 | T0 | `minspec.testGate.enabled = false` → transition never blocked regardless of unmapped ids |

## Alternatives Considered

- **A human-authored test-plan document the gate merely checks for
  existence.** Rejected (Zone A #2): reintroduces the ad-hoc, drift-prone
  enumeration this spec exists to replace with a derived set.
- **AI/semantic matching of tests to requirements ("this probably covers
  FR-3").** Rejected (Zone A #3, FR-4): crosses the Tier-0 boundary and
  reopens the false-positive class SPEC-006 FR-6 excluded for stub markers.
- **A new, separate traceability store for this gate.** Rejected (Zone A #1):
  recreates the two-engines-drift failure one layer up; reuse
  `traceability.ts`.
- **Gate on per-task `[x]` toggle instead of the `tasks`→`implement`
  transition.** Rejected (Zone A #4), mirroring SPEC-006's RD-2: fires too
  often, wrong granularity.
- **Widen FR-3 to all of `packages/minspec/src` immediately.** Rejected for
  v1 (DQ-3): noise risk outweighs the coverage gain until the narrower scope
  is proven.

## Follow-ups (tracked)

- Resolve DQ-1 (stable `INV-N` ids on `.minspec/constitution.md`'s invariants
  list) — file a GitHub issue once a human picks Option A or B above; FR-2
  cannot proceed to Plan phase until this lands.
- Resolve DQ-2 (`invariants:` frontmatter field + its own missing-direction
  validator rule, per DR-003's addendum) — same gate as DQ-1.
- Migration pass: re-cite existing tests with `FR-N`/`INV-N` ids so FR-4 does
  not read a healthy, already-tested spec as freshly unmapped on gate
  activation — file as a sibling issue before FR-6 is enabled project-wide.
- Cross-boundary payload/schema contract tests (named in the original issue
  body, placed Out of scope above) — file as a separate issue once "payload"
  is scoped; not silently dropped.
- DQ-3's `packages/minspec/src` FR-3 widening — file as a follow-up issue if
  the `packages/shared`-only scope proves to miss real gaps in practice.

## Open questions

- See Decisions needed (Clarify) above — DQ-1, DQ-2, and DQ-3 are the blocking
  and non-blocking open questions respectively; none of the other FRs have
  open questions beyond what Risks & Mitigations already names.
