---
epic: EPIC-002  # Signpost Integrity — a tasks/implement transition that claims test coverage nothing checked is a lying signpost, the same class SPEC-006 (stub-completeness-gate) closed for code
id: SPEC-353
type: requirements
# Editing voids approval (hash in .minspec/approvals.json → stale); re-run "MinSpec: Approve Spec". DR-012
status: planning
tier: T3
product: minspec
relates_to: [SPEC-006, SPEC-114, DR-012, DR-003, DR-004, DR-123, "#52", "#4019"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan. Expected surface:
  a coverage check beside `packages/minspec/src/lib/spec-validator.ts` and `traceability.ts`, read at the
  approve path in `packages/minspec/src/commands/approve.ts` (all owned elsewhere).
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# MinSpec — Test-Completeness Gate (Requirements)

**Date:** 2026-10-02
**Triggered by:** [#52](https://github.com/AIClarityAU/minspec/issues/52)
**Amended:** 2026-11-24 for #4019 - takes the three inputs from SPEC-114 (refactorability
enablers) FR-9: a spec's own `## Invariants` ids join the required set (FR-9 here), files
under `invariant_tests:` join the scan scope (FR-5), and a stub or hollow test cannot cover
an invariant row (FR-10). SPEC-114's Clarify DQ-3 (recorded selection Option A) made this
spec the one owner of invariant-to-test matching.

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
   `grep -rl` for `addFileMapping`/`addTestMapping` outside `traceability.ts`
   itself returns the codelens provider, a benchmark fixture, and three test
   files (`traceability.test.ts`, `features.test.ts`, `codelens-provider.test.ts`);
   the only production writer is the manual codelens click — confirmed by
   direct read, not inferred.

### Prior art — reuse, don't re-derive (mirrors SPEC-006)

[SPEC-006 (stub-completeness-gate)](../SPEC-006-stub-completeness-gate/requirements.md)
closed the sibling gap on the *code* side: a spec could reach `status: done` while
its traced files still held `TODO`/`STUB` markers. Its RD-3 decision — extend the
existing pure `validateSpec()` (`packages/minspec/src/lib/spec-validator.ts:1241`)
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
  test is not fully mechanical yet), requires at least one mapped TT0 test (test tiers: see Test / Verification Strategy).
  **100% of invariants a T3/T4 spec touches must be mapped.** Invariant rows get the same override treatment as every other row: no inline per-row suppression, only FR-8's master toggle.
- **FR-3 (derive required-test set from public shared-package exports).** Every
  exported function/class/type from `packages/shared/src/**` that the spec's
  `implements:` list adds or modifies requires at least one TT1 contract test.
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
  **Which invariant a citation names (DQ-4):** a bare `INV-<id>` citation maps
  to the spec's *own* invariant row (FR-9) of that id. A constitution invariant
  row (FR-2) is cited in the qualified form `constitution INV-N` (the word
  `constitution`, case-insensitive, then whitespace, then the id); a bare
  `INV-N` never satisfies a constitution row, and a qualified one never
  satisfies an own row. Ids match whole: `INV-1` does not satisfy `INV-10`, and
  `INV-A` does not satisfy `INV-A2`.
- **FR-5 (scope = traced files, reusing SPEC-006's model).** Test discovery
  scans only test files mapped to the active spec via
  `.minspec/traceability.json` (same scope source SPEC-006 FR-2 uses), **plus**
  any test file whose path the spec's `implements:` list names directly,
  **plus** any test file whose path the spec's `invariant_tests:` frontmatter
  list names (SPEC-114 FR-9 input (a)). A test file absent from all three is
  not scanned (same traceability-staleness caveat SPEC-006 recorded as its R4 —
  see Risks). `invariant_tests:` is defined by the contract-frontmatter spec
  for #23 and is not yet registered in SPEC-109's (canonical frontmatter
  schema) field table; until it is, the key is read when present and an absent
  key adds nothing to scope. Files it names widen scope for every row kind,
  not only invariant rows: scope is one set, so a file is either scanned or
  not. A path under `invariant_tests:` that does not exist on disk is named in
  a warning diagnostic rather than dropped silently (constitution invariant 2).
- **FR-6 (gate point: `tasks` → `implement` phase transition, T3/T4 only).**
  The check runs when a spec's `tasks` phase is marked done / approved (the
  action in `packages/minspec/src/commands/approve.ts` that can trigger
  `advancePhaseOnApprove` into `implement`). If any `FR-N`, any in-scope
  constitution invariant, or any of the spec's own invariant ids (FR-9) has
  zero mapped tests, the transition is refused with a naming reason, listing
  exactly which ids are unmapped. An invariant row cited only by stub or
  hollow tests (FR-10) is listed separately, as "cited only by stub/hollow
  tests", naming those tests, so the fix is clear. T1/T2 specs are unaffected
  (mirrors SPEC-006 FR-3's tier gate — `phaseMappings` for T1/T2 has no `tasks`
  phase at all, so the hook point does not fire).
- **FR-7 (traceability-matrix surface).** A `requirement/invariant → test id →
  status (mapped/unmapped)` matrix is computable on demand (a
  `minspec.showTestTraceability`-style command, mirroring SPEC-006's
  `minspec.scanStubs`) and surfaced as editor diagnostics on the `tasks.md` /
  `requirements.md` file for each unmapped row. The matrix itself is **not**
  persisted as a new on-disk artifact (see Decisions needed — Zone A below
  explains why `.minspec/traceability.json` is reused rather than duplicated).
  Rows cover all four kinds — `FR-N`, constitution invariant, own invariant
  (FR-9), public export — and the status column has four values: `mapped`,
  `unmapped`, `stub/hollow only` (FR-10), and `not checked — no id` (FR-9's
  id-less items). The last two are never rendered as mapped; this is the
  surface SPEC-114 FR-10 reads instead of reporting invariant coverage as
  "not checked".
- **FR-8 (override).** A setting (e.g. `minspec.testGate.enabled`, default
  `true`) disables FR-6's block entirely, mirroring SPEC-006 FR-5's master
  toggle. **No per-row inline suppression exists for any row kind** (`FR-N`, constitution invariant, own invariant, or public-API) — unlike SPEC-006's `minspec-stub-ok`, a missing test is not something a single line comment should wave through silently; the master toggle is the only override and it applies equally to every row kind (turning it off also stops blocking invariant rows).
- **FR-9 (derive required-test set from the spec's own `## Invariants` ids —
  SPEC-114 FR-9 input (0)).** For a T3/T4 spec, every invariant id the spec
  declares in its own invariants section requires at least one mapped test
  (FR-4), on the same footing as an `FR-N` row. This is derived from the
  artifact, not declared in frontmatter (Zone A #2), so it needs neither
  DQ-1's constitution ids nor DQ-2's `invariants:` field. Parse rules, all
  pure text (Tier 0):
  - **Section.** A level-2 heading whose text starts with the word
    `Invariants` (`## Invariants`, `## Invariants (must not break)`,
    `## Invariants this change must not break`, ...), up to the next heading
    of level 2 or higher. Files read: `requirements.md` and, for a
    split-layout spec, its sibling `tasks.md` (the same files FR-1 reads).
  - **Id.** In each top-level list item of that section, the first
    `INV-<id>` literal, where `<id>` is one or more letters or digits,
    optionally joined by single hyphens (`INV-2`, `INV-A`, `INV-R3`,
    `INV-single-predicate`). Worded ids count: on `main` at `7931142f`, 5
    requirement files cite only a worded form (SPEC-114 DQ-3). An id appearing
    twice in the section is one row. `INV-N` mentions outside the section add
    no rows.
  - **Item with no id.** A top-level item with no `INV-<id>` literal (such as
    this spec's own `INV —` bullets) cannot be matched, so it is not a
    required row. It is never passed silently either: the matrix (FR-7)
    lists it as "not checked — no id", and a non-blocking warning diagnostic
    on the item names the count. Treating it as blocking would refuse every
    spec written before this rule over a naming convention, not a missing test.
- **FR-10 (a stub or hollow test does not cover an invariant row — SPEC-114
  FR-9 input (b)).** For a constitution-invariant row (FR-2) or an own-invariant
  row (FR-9), a citation counts only if the test it attaches to is not reported
  by `scanTestSource()` (`packages/minspec/src/lib/test-scanner.ts:504`) as
  `stub` or `hollow`. A citation attaches to the test whose title carries it or
  whose declaration line is adjacent to it (FR-4); a citation on a `describe`
  block counts when at least one test inside that block is not reported. The
  check reuses `scanTestSource()` — no second stub/hollow detector (SPEC-006
  RD-3). `FR-N` and public-export rows keep FR-4's citation-only rule for v1
  (see Alternatives Considered and Follow-ups).

## Costly to Refactor (Zone A)

1. **Reuse `.minspec/traceability.json` + `traceability.ts` as the storage
   substrate (FR-5, FR-7).** The schema (`requirementKey → {files[], tests[]}`)
   already exists and is already read by the codelens provider. Building a
   second, parallel traceability file for this gate would immediately recreate
   the two-engines-drift failure SPEC-006's RD-3 was written to prevent, one
   layer up (two *traceability* stores instead of two *completeness* checks).
   Any implementation that adds a new file format here is a sign the wrong
   design was picked.
2. **The derive-from-artifacts direction (FR-1, FR-2, FR-3, FR-9).** Required tests are
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
- **INV (user override wins — SPEC-006 FR-5 master-toggle precedent, not a numbered constitution invariant):** the master toggle (FR-8) disables the block;
  there is no finer-grained suppression that could be set-and-forgotten per row.

## Acceptance Criteria (Zone A)

- [ ] A T3/T4 spec's `requirements.md` with an `FR-N` that has no test citing
      `FR-N` (word-boundary) in any traced test file blocks the `tasks` →
      `implement` transition, naming `FR-N` in the refusal — **FR-1, FR-6**.
- [ ] A constitution invariant the spec cites (or that its `implements:` files
      overlap — pending the Decisions-needed resolution below) with zero
      mapped TT0 tests blocks the transition the same way — **FR-2, FR-6**.
- [ ] A T3/T4 spec whose own `## Invariants (must not break)` section declares
      `INV-1` and `INV-single-predicate`, with a traced test citing only
      `INV-1`, blocks the transition naming `INV-single-predicate`; a test
      citing `INV-10` does not satisfy `INV-1` — **FR-9, FR-4, FR-6**.
- [ ] An own-invariant section item with no `INV-<id>` literal is not a
      required row, is listed in the matrix as "not checked — no id", and
      raises a non-blocking warning — **FR-9**.
- [ ] A bare `INV-2` citation satisfies the spec's own `INV-2` row but not a
      constitution `INV-2` row; `constitution INV-2` satisfies the
      constitution row but not the own row — **FR-4, DQ-4**.
- [ ] A test file named only under the spec's `invariant_tests:` frontmatter
      is scanned and can satisfy a mapping; a path there that does not exist
      raises a warning naming it — **FR-5**.
- [ ] An invariant row whose only citing tests are reported `stub` or
      `hollow` by `scanTestSource()` blocks the transition, listed as "cited
      only by stub/hollow tests" with those tests named; the same citation
      from a real test passes — **FR-10, FR-6**.
- [ ] An exported `packages/shared/src/**` function added/modified by the
      spec's `implements:` list, with zero TT1 test citing it, blocks the
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
      `validateSpec()` (`packages/minspec/src/lib/spec-validator.ts:1241`),
      invoked from the Approve Spec / `advancePhaseOnApprove` path (`packages/minspec/src/commands/approve.ts:124`) — SPEC-006 hooks the `status: done` transition instead (its RD-2), so this is a different call path into the same engine; no second validation engine — **Zone A #1, prior-art precedent**.

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
  genuinely out of scope for v1 pending a "what counts as a cross-boundary payload" definition; recorded under Follow-ups (tracked), not silently dropped.

## Decisions needed (Clarify)

- **DQ-1 — Constitution invariants have no stable, referenceable id today.**
  `.minspec/constitution.md`'s `## Invariants` section is a *positional*
  numbered list (`1.`, `2.`, `3.` — confirmed by direct read, not the `INV-N`
  scheme the issue body assumes). Goals already solved this exact problem with
  a stable `G-N` id (`.minspec/constitution.md:52-53`, referenced via `goal: G-N`
  frontmatter). Two options:
  - **(rec) Option A — mint stable `INV-N` ids on the invariants list,
    mirroring `G-N`.** Cost: a one-time constitution edit (owned by the
    `minspec-constitution` skill/flow, not this spec) plus updating every
    prose reference that currently says "invariant 2" / "invariant #8"
    (several hit in this project's own memory notes) to the new id. Without
    it, FR-2's "every invariant the spec touches" has nothing stable to cite,
    and inserting a new invariant mid-list silently renumbers every later
    `INV-N` reference — the same collision class the DR id-collision gate (`scripts/check-dr-id-collision.ts`) exists to prevent for DR numbers.
  - **Option B — key invariant rows by a content slug/hash instead of a
    position number.** Avoids touching the constitution, but produces opaque
    ids (`inv-a3f9c1`) nobody can cite in prose, which cuts against this
    project's own "label every ref" convention.
  - This spec's FR-2 is written assuming Option A ships first; if the human
    picks Option B (or defers id-minting entirely), FR-2's matching mechanism
    needs to change before FR-6 can safely block on invariant rows, and the
    acceptance criterion for FR-2 should be treated as blocked, not partially
    gradeable.

  **Recorded selection: the recommended option,** Option A, mint stable `INV-N` ids on the invariants list, mirroring `G-N` (the constitution edit itself goes through its own flow, not this spec). Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
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
  **Recorded selection: the recommended option,** require an explicit `invariants: [INV-N, ...]` frontmatter field, populated at Specify time. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
- **DQ-3 — should FR-3's public-API scope widen to `packages/minspec/src/**`
  later?** Recommend **(rec) stay `packages/shared` only for v1** (current
  wording) — cost: a `packages/minspec`-only public API change (e.g. a new
  exported command handler) gets no FR-3 coverage until a follow-up widens
  scope; the alternative (scope it in from day one) risks the exact noisy,
  trained-to-ignore outcome SPEC-006's R1 risk names for its own heuristic.
  **Recorded selection: the recommended option,** stay `packages/shared` only for v1. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
- **DQ-4 — A bare `INV-N` could name the spec's own invariant or a
  constitution invariant (added 2026-11-24, #4019).** FR-9 makes a spec's own
  `INV-N` ids required rows; DQ-1 Option A mints constitution `INV-N` ids too.
  Both namespaces start at `INV-1`, so a test citing `INV-2` is ambiguous.
  Today's tests already use the bare form for own invariants: a grep over
  `packages/*/tests` on 2026-11-24 found 60 files citing an `INV-<digit>` id,
  14 of them carrying at least one `SPEC-NNN INV-N` prefixed citation (the
  rest cite only the bare form); no constitution `INV-N` id
  exists yet to cite.
  - **(rec) Option A — bare `INV-N` means the spec's own invariant; a
    constitution row needs `constitution INV-N`.** Matches what existing
    tests already write, so no own-invariant test needs re-citing. *Cost:*
    constitution citations need a qualifier word that FR-4's original
    examples did not use, and an author who writes a bare `INV-2` meaning the
    constitution gets an "unmapped" block on the constitution row (visible,
    not silent, but a false block until re-cited).
  - **Option B — own invariants need `SPEC-NNN INV-N`; bare `INV-N` means
    the constitution.** *Cost:* every existing test citing a bare own id
    (most of the 60 files) reads as unmapped until migrated.
  - **Option C — one bare citation satisfies both rows.** *Cost:* a test
    written for the spec's `INV-2` marks constitution `INV-2` covered — a
    false green, which constitution invariant 2 (no silent gate) forbids.
  **Recorded selection: the recommended option,** Option A, bare `INV-N` names the spec's own invariant and a constitution row needs `constitution INV-N`. Agent pick of the recommended option, no human chose it; DR-123, recorded 2026-11-24; sign-off ratifies it.

## Risks & Mitigations

| # | Risk | Likelihood · Impact | Mitigation |
|---|------|---------------------|------------|
| R1 | `.minspec/traceability.json` is stale/empty (today it is populated only via a manual codelens click), so FR-5's scope is empty and every row reads unmapped, so the gate blocks every T3/T4 transition (consistent with Failure-Modes #1) until traceability is populated | Med · High | The block is visible, not silent, but it is a false block on a healthy spec: FR-6's refusal reason must name "zero traced tests found" distinctly from "tests found but unmapped" so the cause is obvious, and FR-8's master toggle is the escape hatch while traceability is populated (same staleness caveat SPEC-006 recorded as its R4) |
| R2 | DQ-1/DQ-2 (invariant ids + touch-detection) ship unresolved, so FR-2 is implemented against a moving target | Med · High | FR-2's acceptance criterion is explicitly gated on the Decisions-needed resolution above; Plan phase must not proceed on FR-2 until DQ-1 is answered |
| R3 | FR-4's literal-reference matching misses a test that *does* cover an `FR-N` but doesn't cite it by id, producing a false "unmapped" block on an already-tested requirement | Med · Med | Same trade-off SPEC-006 accepted for its own marker convention: authors adopt the citation convention going forward; a migration pass over existing tests is a follow-up, not a blocker for new specs |
| R5 | FR-10 inherits `scanTestSource()`'s false-`hollow` cases (it blanks template-literal `${...}` interpolations, so an assertion written inside one looks absent, `test-scanner.ts:144-147`), so a genuinely tested invariant reads "cited only by stub/hollow tests" | Low · Med | The refusal names the test and the reason `scanTestSource()` gave, so a false hollow is visible and fixable in the scanner (one engine, SPEC-006 RD-3) rather than worked around here; FR-8's toggle is the escape hatch meanwhile |
| R6 | FR-9 adds own-invariant rows to every T3/T4 spec at once: most already carry `INV-N` sections (SPEC-114 DQ-3 counted 124 of 224 requirement files on `main` at `7931142f` citing one), so enabling FR-6 blocks many specs whose invariant tests exist but are uncited | Med · High | Same adoption path as R3 — the backlogged migration pass (re-cite existing tests) runs before FR-6 is enabled project-wide; DQ-4's recorded option keeps today's bare citations valid, shrinking that pass |
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
| Required-test derivation from the spec's own `## Invariants` ids | FR-9 |
| `invariant_tests:` files join scan scope | FR-5 |
| Stub/hollow citing test does not cover an invariant row | FR-10 |
| Own vs constitution `INV-N` citation namespace | FR-4 (DQ-4) |

## Consequences

**Positive:**
- Closes the Context gap: a T3/T4 spec can no longer advance into `implement`
  (FR-6) while an `FR-N`, a declared invariant, or a `packages/shared` public
  export it touches has zero mapped test — the test-side mirror of SPEC-006's
  code-side completeness gate.
- A spec's own invariants — the refactor safety net SPEC-114 (refactorability
  enablers) relies on — become checked rows (FR-9), and a stub or hollow test
  can no longer stand in for one (FR-10). FR-9 does not wait on DQ-1/DQ-2, so
  own-invariant coverage can ship before constitution-invariant coverage.
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
2. **A spec with `implements:` but no `invariants:` field** (DQ-2, if its recommended `invariants:` frontmatter field ships) — ambiguous whether it touches zero invariants or the field was
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
5. **A spec with no invariants section at all** (FR-9) — zero own-invariant
   rows; nothing to block and nothing to warn about, since the absence is the
   author's statement, not an omission the gate can detect (that
   missing-direction check is DQ-2's validator rule, not this one).
6. **The same id under two invariants headings** (e.g. one in
   `requirements.md`, one in a split-layout `tasks.md`) — one row, satisfied by
   one citation.

## Test / Verification Strategy

Test tiers (TT) are a vocabulary distinct from the T1-T4 spec ceremony tiers: **TT0** = pure unit test of one function, no I/O (the sense of the `**T0 tests:**` bullets in `specs/minspec/tasks.md`); **TT1** = contract test at a package boundary (`packages/shared` exports); **TT2** = integration test across modules (e.g. `validateSpec()` over a fixture spec + traceability pair).

| FR | Test tier | Assertion sketch |
|---|---|---|
| FR-1 | TT2 | `validateSpec()` on a fixture spec with `FR-1`..`FR-3` and test citations for only `FR-1`/`FR-2` reports `FR-3` unmapped |
| FR-2 | TT2 | Blocked on DQ-1/DQ-2 — write once invariant ids + `invariants:` frontmatter exist; assertion sketch: declared `INV-2` with no citing TT0 test reports unmapped |
| FR-3 | TT1 | A `packages/shared/src` export added by the spec's `implements:` list with no citing test reports unmapped; an export outside `packages/shared` is not checked |
| FR-4 | TT1 | A test named `...FR-3...` or carrying an adjacent `// FR-3` comment counts as a citation; `FR-30` does not satisfy `FR-3` (word-boundary) |
| FR-5 | TT0 | A test file absent from both `.minspec/traceability.json` and `implements:` cannot satisfy any mapping, even if it textually cites the id |
| FR-6 | TT0 | Fixture with all ids mapped: `tasks`→`implement` transition succeeds; any one id unmapped: transition refused, naming it; T1/T2 fixture: never blocked |
| FR-7 | TT1 | Matrix command output matches `validateSpec()`'s own unmapped-id list for the same fixture (single source of truth) |
| FR-8 | TT0 | `minspec.testGate.enabled = false` → transition never blocked regardless of unmapped ids |
| FR-9 | TT0 | Section parser over each heading variant in FR-9 returns exactly the first `INV-<id>` per top-level item (`INV-1`, `INV-A`, `INV-single-predicate`), ignores `INV-N` mentions in other sections, and returns id-less items as a separate "no id" list; TT2: `validateSpec()` reports an uncited own id unmapped |
| FR-10 | TT2 | Own `INV-1` cited only by an `it('INV-1 ...', () => {})` (stub) and an `expect(true).toBe(true)` test (hollow) → reported "cited only by stub/hollow tests" naming both; adding one real asserting test citing `INV-1` → mapped |
| FR-4 (DQ-4) | TT0 | Bare `INV-2` satisfies own `INV-2` only; `constitution INV-2` satisfies the constitution row only |

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
- **SPEC-114 builds its own invariant-to-test matcher.** Rejected by SPEC-114
  DQ-3 (recorded selection Option A): two literal-citation matchers would be
  the duplicate implementation SPEC-114 exists to flag. This spec takes its
  three inputs instead (FR-5, FR-9, FR-10).
- **Declare own invariants in frontmatter (extend DQ-2's `invariants:` field
  to the spec's own ids) instead of parsing the section (FR-9).** Rejected:
  the section already exists in most specs, and a second hand-kept list of the
  same ids is the drift-prone enumeration Zone A #2 rules out.
- **Apply FR-10's stub/hollow rule to `FR-N` and public-export rows too.**
  Deferred, not rejected: one rule for all rows is simpler, but it would make
  every `FR-N` row depend on `scanTestSource()`'s precision (R5) beyond what
  #4019 asks for. Backlogged below.
- **Make an id-less invariant item a blocking row (FR-9).** Rejected: it would
  refuse specs over an id convention rather than a missing test; the item is
  surfaced as "not checked — no id" instead of being passed silently.

## Follow-ups (tracked)

Per the DR-023 amendment, none of these would change a decision within 30 days
(each waits on a human answering DQ-1/DQ-2/DQ-3 or on FR-6 shipping), so each is
one dated line in `docs/backlog.md`, cited here by its leading text.

- backlog: `2026-11-16: SPEC-353 DQ-1 - mint stable INV-N ids` (FR-2 cannot proceed to Plan until this lands)
- backlog: `2026-11-16: SPEC-353 DQ-2 - add an invariants: frontmatter field` (with its missing-direction validator rule, per DR-003's addendum)
- backlog: `2026-11-16: SPEC-353 migration - re-cite existing tests` (before FR-6 is enabled project-wide)
- backlog: `2026-11-16: SPEC-353 cross-boundary payload/schema contract tests` (out of scope for v1 until "payload" is scoped)
- backlog: `2026-11-16: SPEC-353 DQ-3 - widen FR-3 public-API scope` (only if shared-only scope misses real gaps)
- backlog: `2026-11-24: SPEC-353 FR-10 - extend the stub/hollow rule to FR-N and public-export rows` (only after FR-10 has run on invariant rows without false-hollow trouble)
- `invariant_tests:` registration in SPEC-109's field table — not a new follow-up: SPEC-109 (canonical frontmatter schema) already records that whichever of it and the #23 contract-frontmatter spec lands second adds the `contracts`/`invariant_tests`/`file_allowlist` rows. FR-5 reads the key when present and needs nothing more from this spec.

## Open questions

- See Decisions needed (Clarify) above — DQ-1 and DQ-2 are the blocking
  questions, DQ-3 and DQ-4 the non-blocking ones, and each carries a recorded
  selection; none of the other FRs have
  open questions beyond what Risks & Mitigations already names.
