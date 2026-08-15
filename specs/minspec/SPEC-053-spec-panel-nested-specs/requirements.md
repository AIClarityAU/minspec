---
id: SPEC-053
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a silently-incomplete signpost is a wrong signpost
relates_to: [SPEC-040, SPEC-017, DR-003, DR-023]
implements: none
implements_reason: creates no new file. FR-1 repoints two callers and deletes listSpecsShallow, and FR-3 rewrites migrateLayout, all inside modules that already exist and are shared with other specs (spec-manager.ts also affects: SPEC-047; artifact-graph.ts affects: SPEC-041/SPEC-046; config.ts implements: SPEC-046 design.md). No affects: list is declared: scripts/hooks/spec-gate.py:350 reads implements: AND affects: into the same block set, so declaring shared core here would freeze those files for every other session until this spec is approved (DR-047 blast radius). The files this spec modifies are named in AC-5 instead, where they document intent without arming a gate.
phases:
  specify: done
  clarify: done
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
is invisible to `listSpecsShallow()`'s two callers; Clarify settled the choice
SPEC-040 FR-4 deferred to triage (**Option 1**: repoint both callers at the
recursive `lib/spec-catalog.ts::listSpecs()` and delete `listSpecsShallow()`),
and this spec implements it.

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
  be visible to both current callers. **Settled at Clarify as Option 1 (D-1).**
  Repoint `spec-panel.ts::buildTrustModel()`
  (`packages/minspec/src/views/spec-panel.ts:112`) and
  `spec-manager.ts::migrateLayout()`
  (`packages/minspec/src/lib/spec-manager.ts:616`) at the recursive
  `lib/spec-catalog.ts::listSpecs()`, and **delete** `listSpecsShallow()`
  outright rather than narrowing its doc comment. Option 2 (add product-dir
  recursion to `listSpecsShallow()` itself, keeping two scan functions alive)
  is rejected; **D-1** records the evidence, including why the perf objection
  that kept both options open does not survive checking in either direction.
- **FR-2 — Trust chart correctness (spec-panel).** Once fixed, `M1` (rework %)
  and `M2` (wasted-review bars) in the spec-panel trust chart MUST include
  every spec `listSpecs()` reports for the same root, i.e. parity with the
  recursive catalog's coverage, not merely "more than zero".
- **FR-3 — Migration correctness (`migrateLayout`).** Once fixed,
  `migrateLayout()` MUST migrate product-nested specs the same as top-level
  ones, and `MigrationResult.migrated` MUST count them. Clarify settled two
  mechanics this FR originally left implicit:
  1. **DQ-NEW-A** — each spec is resolved from `summary.filePath`, not
     re-resolved by id through `findSpecEntry()`. Fixing the listing call alone
     leaves migration broken; see the decision for the proof.
  2. **DQ-NEW-B** — a nested spec migrates **in place under
     `specs/<product>/`**, preserving the product directory; it is not hoisted
     to the `specsDir` root.
  Because DQ-NEW-B makes the write path itself path-aware, this FR can no
  longer claim it "only extends coverage without touching the write path": the
  byte-for-byte flat↔spec-kit round-trip tests in `spec-manager.test.ts` MUST
  be **re-run against nested fixtures** rather than assumed to carry over. The
  lossless invariant is still SPEC-040's, not restated here, but it is now
  re-proved rather than inherited.
- **FR-4 — Regression test, both callers.** A test pinning that a
  product-nested spec (`specs/<product>/SPEC-NNN-*/requirements.md` fixture,
  mirroring the real layout already used by
  `nextSpecId() per-product scoping (#57)` in `spec-manager.test.ts:115`) is:
  (a) present in `listSpecs()`'s output (the replacement for
  `listSpecsShallow()` under D-1), (b) counted in `buildTrustModel()`'s
  `rework`/`wasted` series, and (c) migrated by `migrateLayout()` **to a path
  under `specs/<product>/`** (DQ-NEW-B). This is the missing-direction
  assertion the Context section identifies as absent today.
- **FR-5 — No behaviour change for the flat-layout / single-product case.**
  Projects with specs living directly at `specsDir` top level (no product
  nesting) MUST see identical trust-chart and migration output before and
  after — this is a coverage fix, not a rewrite of the already-correct flat
  path. `spec-manager.test.ts`'s existing `migrateLayout()` suite (from line
  769) continues to pass unmodified. Its `listSpecsShallow()` suite (from line
  278) cannot, because D-1 deletes the function it exercises: those cases MUST
  be **repointed** at `listSpecs()` with their expected outputs unchanged.
  Moving an assertion satisfies FR-5; weakening or dropping one does not.

## Acceptance Criteria

- **AC-1** (FR-1, FR-4): Given a project with `specs/<product>/SPEC-NNN-*/requirements.md`,
  the replacement listing call (`lib/spec-catalog.ts::listSpecs()`, per D-1)
  returns that spec. Test fails on `main` today (red), passes after the fix
  (green) — the base-red/head-green pair the regression test must demonstrate.
- **AC-2** (FR-2, FR-4): Given the same fixture, `spec-panel`'s
  `buildTrustModel()` output includes an entry for the nested spec's id in
  `rework`, and, where that spec has superseded review history, in `wasted`.
- **AC-3** (FR-3, FR-4, DQ-NEW-A, DQ-NEW-B): Given the same fixture,
  `migrateLayout(rootDir, target)` migrates the nested spec (file
  moves/converts per SPEC-040's existing round-trip invariant),
  `MigrationResult.migrated` includes it in the count, **and the test asserts
  the migrated path**: the spec now lives under `specs/<product>/`, the product
  directory still exists, and nothing landed at the `specsDir` root. A
  count-only assertion does **not** satisfy AC-3 — an implementation that
  hoists every spec and dissolves `specs/minspec` and `specs/agent-execute`
  would pass a count-only check (DQ-NEW-B), and the byte-for-byte round-trip
  assertions run against this nested fixture, not only the flat one (FR-3).
- **AC-4** (FR-5): The pre-existing `migrateLayout()` test suite in
  `spec-manager.test.ts` passes unmodified against the fixed implementation.
  The pre-existing `listSpecsShallow()` suite is repointed at `listSpecs()`
  per D-1 with every expected output unchanged — a moved assertion passes this
  AC, a deleted or weakened one fails it.
- **AC-5** (D-1, DQ-NEW-B): No comment or exported surface is left describing
  code that no longer exists, or behaviour that changed under it.
  Specifically: (a) `listSpecsShallow()` is gone from
  `packages/minspec/src/lib/spec-manager.ts` with no dangling references left
  behind — the stale mentions at `packages/minspec/src/lib/artifact-graph.ts:195`
  and `packages/minspec/src/lib/spec-manager.ts:51` are swept; (b)
  `SpecsLayout`'s `"flat"` carries a doc comment stating that *flat* describes
  the **per-spec representation, not the depth of the tree**, since after
  DQ-NEW-B a flat-layout spec no longer necessarily sits at the `specsDir`
  root.
- **AC-6** (D-1 accepted cost): A T0 test covers two specs that legitimately
  share one `SPEC-NNN` under different products (`specs/a/SPEC-001-*` and
  `specs/b/SPEC-001-*`), pinning that **neither** is dropped from the trust
  chart or from migration; alternatively `listSpecs()`'s id collapse is keyed
  on `product` + `id` so the case cannot arise. `listSpecs()` collapses on the
  bare `fm.id` today (`packages/minspec/src/lib/spec-catalog.ts:67-73`,
  `:104-106`) while ids are scoped per product
  (`packages/minspec/src/lib/spec-manager.ts:208-222`), so this is the one
  silent-omission path Option 1 leaves open — the same class of defect this
  spec exists to close.

## Invariants this change must not break

- **T0 / offline (constitution #1):** the fix is a pure filesystem-walk change;
  no network call is introduced.
- **Lossless migration (SPEC-040 FR-4's carried invariant, INV-2):** frontmatter
  and body content byte-for-byte preserved across `migrateLayout()`. DQ-NEW-B
  makes the write path **path-aware**, so this invariant is no longer inherited
  untouched: the round-trip assertions MUST be re-run against nested fixtures
  rather than assumed to carry over from the flat ones (FR-3, AC-3).
- **Non-destructive trust chart (SPEC-017 FR-11):** `buildTrustModel()` remains
  read-only over specs + approval sidecars; FR-2 only widens what it reads, not
  what it writes (still nothing).
- **`lib` layering (SPEC-040 FR-1):** the fix stays within `lib/**`'s existing
  import boundaries. Option 1 (D-1) reuses an existing `lib/spec-catalog.ts`
  import, already legal per FR-1's eslint rule, and adds no new cross-layer
  edge: `views/spec-panel.ts` swaps one `lib/` import for another, and
  `lib/spec-manager.ts` reaches sideways within `lib/`.

## Decisions (settled at Clarify)

All four below are **settled**, not recommendations awaiting a human. Each
records the question, the option chosen, the evidence the choice turned on, and
the cost accepted alongside it.

**Two of the four did not exist in this spec when Clarify opened.** DQ-NEW-A
and DQ-NEW-B were surfaced *during* Clarify, by reading the code the original
two questions only gestured at, and both bear directly on **AC-3**: without
DQ-NEW-A, AC-3 cannot pass at all; without DQ-NEW-B, AC-3 can pass while the
spec tree is flattened. They are labelled *[surfaced during Clarify]* and left
out of the original 1/2 numbering deliberately. That the original list omitted
a hard blocker of one of its own acceptance criteria is the useful measurement
of how incomplete this section was, and renumbering them into a tidy 1–4 would
erase exactly that signal.

### D-1 — Which fix option for FR-1? → **Option 1**

*(Decision 1 in the original **Decisions needed** list.)*

**Decided.** Repoint both callers — `buildTrustModel()`
(`packages/minspec/src/views/spec-panel.ts:112`) and `migrateLayout()`
(`packages/minspec/src/lib/spec-manager.ts:616`) — at the recursive
`lib/spec-catalog.ts::listSpecs()`, and **delete `listSpecsShallow()`
outright** rather than narrowing its doc comment. Sweep the stale mention at
`packages/minspec/src/lib/artifact-graph.ts:195` (and the second one in the
`SpecSummary` doc comment at `packages/minspec/src/lib/spec-manager.ts:51`,
found while recording this decision) so no comment names a function that no
longer exists.

**Why.** The perf objection that kept both options open does not survive
checking, in either direction:

- The comment the objection cited
  (`packages/minspec/src/views/spec-tree-provider.ts:334-345`) is about
  **coalescing refresh bursts** for #154, and its shipped mitigation is the
  debounce at `:346-352`. It says nothing about SPEC-017 and nothing about
  `buildTrustModel`.
- The recursive walk is **already** the Specs pane's steady-state per-render
  cost: `spec-tree-provider.ts:325` defaults `_listSpecs` to `listSpecs`. Option 1
  introduces no walk the extension host does not already perform.
- Decisively, **perf cannot discriminate between the two options at all.**
  `buildTrustModel()` is already O(specs) with per-spec disk work — `spec-panel.ts:118-127`
  calls `computeSpecRework` once per spec, and `:132` calls `computeWastedReview`
  over the whole list — so its cost tracks **how many specs are returned**, not
  which function returns them. Option 2's stated Pro, "no perf-characteristic
  change for the two existing callers", is therefore **false as written**: both
  options take the trust chart from ~0 specs to ~50 and pay identically for it.

With perf neutralised, only the two-implementations asymmetry remains, and it
points one way. The swap is a genuine drop-in, not a hopeful one: `listSpecs()`
returns the same `SpecSummary`
(`packages/minspec/src/lib/spec-catalog.ts:92-103`), the extra
`hasDesignFile`/`hasTasksFile` fields it can carry are optional
(`packages/minspec/src/lib/spec-manager.ts:54-55`), and both callers read only
`s.id` and `s.filePath`. `listSpecsShallow()`'s `filter` parameter is dead
surface — neither caller passes it — so deleting the function drops no
capability in use.

**Accepted cost.** `listSpecs()` collapses duplicate ids on `fm.id` alone with
**no product scoping** (`spec-catalog.ts:67-73` keys `byId` on the bare id;
`:104-106` keeps one representative per id), while `nextSpecId()` scopes
numbering **per product** (`spec-manager.ts:208-222`). Two products may
therefore legitimately hold the same `SPEC-NNN`. No such collision exists in
this repo today, so the defect is latent rather than live — but a future
duplicate id would silently drop one product's spec from **both** the trust
chart and migration: a fresh instance of the exact silent-omission class this
spec exists to kill. Plan MUST therefore carry a T0 test for two
same-id-different-product specs, or key the collapse on `product` + `id`. Bound
as **AC-6** so it cannot leak as prose.

### DQ-NEW-A *[surfaced during Clarify]* — How does `migrateLayout()` resolve a nested spec? → **Option A**

**Not in the original list. Blocks AC-3.**

**Decided.** `migrateLayout()` builds its `SpecEntry` from `summary.filePath`,
instead of re-resolving the spec by id through `findSpecEntry()`.

**Why.** Repointing the listing call alone provably does **not** fix migration.
`migrateLayout()` ignores `summary.filePath` entirely: it takes `summary.id` and
re-resolves via `findSpecEntry(specsDir, summary.id)` at
`packages/minspec/src/lib/spec-manager.ts:621`, skipping on `null` at `:622`.
`findSpecEntry()` does a single top-level `fs.readdirSync` at `:242` and never
recurses. So under D-1 alone, nested ids would arrive correctly from the fixed
listing, resolve to `null`, `continue`, and the function would still
under-report `migrated` and still return `success: true` at `:667` — FR-3 and
AC-3 failing while FR-1 looked done. That is the "reports success having touched
nothing" defect this spec was written to kill, reproduced one layer down.

Chosen over making `findSpecEntry()` recurse because `findSpecEntry()` is also
called by `getSpec()` at `spec-manager.ts:463`, and widening it is a behaviour
change this spec neither covers nor tests.

**Accepted cost.** Deriving a `SpecEntry` from a path re-decides
flat-vs-spec-kit from path shape, duplicating a slice of the layout
classification `findSpecEntry()` owns (the `SpecEntry` union at
`spec-manager.ts:232-234`) — a mild version of the two-implementations smell
D-1 just avoided. It also leaves `getSpec()` blind to nested specs; that is
filed as [#1452](https://github.com/AIClarityAU/minspec/issues/1452) and
deliberately **not** fixed here (see *Out of scope*).

### DQ-NEW-B *[surfaced during Clarify]* — Where does a migrated nested spec land? → **Option A**

**Not in the original list, and it changes what AC-3 means.**

**Decided.** `migrateLayout()` **preserves the product directory**, migrating in
place under `specs/<product>/` rather than hoisting to the `specsDir` root.
**AC-3 must assert the migrated path, not merely the count.**

**Why.** The current code defaults to hoisting: `migrateLayout()` always writes
to `path.join(specsDir, dirName)` at `spec-manager.ts:630` or
`path.join(specsDir, fileName)` at `:642`, then deletes the original at
`:659-665`. An implementation could therefore satisfy AC-3 *as originally
written* — count and all — while flattening the whole spec tree and dissolving
`specs/minspec` and `specs/agent-execute`. Nobody decided that.

Hoisting is also self-defeating for the very repos this spec is fixing.
Per-product id scoping is real (`nextSpecId()`, `:208-222`), so two products may
hold the same `SPEC-NNN`, and hoisting collides them. The existing guards at
`:631-638` and `:643-650` make that collision fail **visibly** with
`success: false` rather than clobbering, so constitution invariant 2 (no silent
gate) holds — but migration becomes unusable for exactly the multi-product
layout that motivated the spec.

**Accepted cost.** This makes `migrateLayout()` **path-aware** rather than
`specsDir`-relative: a larger diff than FR-1's framing implies, and it touches
the write path FR-3 explicitly promised not to touch. The byte-for-byte
round-trip tests MUST therefore be **re-run against nested fixtures** rather
than assumed to carry over. It also means `SpecsLayout`'s `"flat"` no longer
literally means "everything at the `specsDir` root", and needs a doc comment
saying *flat* describes the **per-spec representation, not the depth of the
tree** (AC-5b). Of the four, this is the **one decision that is costly to
reverse** once Plan commits to it.

### D-2 — Is there a known population of installs already harmed? → **Option A**

*(Decision 2 in the original list.)*

**Decided.** Answer **"no known population"**, and do **not** gate Plan on
investigating it.

**Why.** The question said so itself when it was posed: it informs whether AC-3
needs a backward-compat note in the PR description, "not a spec change". It
alters no FR, no AC and no invariant, so no Plan decision depends on it.
Investigating is also unanswerable by construction: MinSpec is Tier-0 and
offline by constitution invariant 1, so no usage telemetry exists to consult and
none ever will. Residual risk is low because the failure mode is **skip, not
delete** — skipped specs never enter `toDelete` (`spec-manager.ts:618`, `:654`,
`:659-665`), so nothing was destroyed on any past run.

**Accepted cost.** If some install did run `migrateLayout()` against a nested
layout, that user silently holds an un-migrated tree and gets no notice.
Unverified and unverifiable by design. Agreed cheap hedge: one line in the PR
body reading "re-run *Migrate Layout* if you ran it before this fix".

## Out of scope

- Any change to `lib/spec-catalog.ts::listSpecs()`'s own behaviour — it is
  already correct (SPEC-040 FR-4), and D-1 settled that both of
  `listSpecsShallow()`'s callers now point at it. One exception is live: if
  Plan takes AC-6's second branch (key the id collapse on `product` + `id`
  rather than pin the duplicate-id case with a T0 test), that *is* a change to
  `listSpecs()` and moves in scope. Choosing the T0-test branch keeps this
  bullet true as written.
- Making `findSpecEntry()` recurse, and with it `getSpec()`'s blindness to
  product-nested specs (`packages/minspec/src/lib/spec-manager.ts:463`).
  Rejected under DQ-NEW-A: `getSpec()` is a second caller whose behaviour
  change this spec neither covers nor tests. Filed as
  [#1452](https://github.com/AIClarityAU/minspec/issues/1452).
- `views/spec-tree-provider.ts`'s consumption of `listSpecs()` — unaffected,
  already recursive.
- Renumbering or re-scoping SPEC-040 (`status: done`) — this is a follow-up
  spec per DR-023, not an amendment to a shipped one.
