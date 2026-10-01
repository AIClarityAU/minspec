---
id: SPEC-080
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — DR-014's shared-code boundary (the tier→package map and version-skew guarantee this spec executes) lives here
aspects: [shared, classifier, tier-0, monorepo-boundary, versioning, calibration]
relates_to: [DR-014, SPEC-004, SPEC-023, "#53", "#54"]
implements:
  - packages/shared/src/classifier.ts
  # NEW file — does not exist yet. The engine's new home (DQ-1/DQ-2 below settle its
  # exact exported surface; the file's existence and its ownership of the engine do not
  # depend on either answer).
  - packages/shared/tests/classifier.test.ts
  # NEW file — the T0/T2 engine tests currently in packages/minspec/tests/classifier.test.ts
  # (pickDrivingSignal, classify(), overrideClassification(), applyFloor(), loadCalibration())
  # move here verbatim per FR-7.
  - packages/minspec/src/lib/classifier.ts
  # Shrinks to the calibration WRITE path only (saveCalibration/recordOverride) plus
  # re-exports for existing call sites, under every answer to DQ-1/DQ-2 (FR-1..FR-4 are
  # unconditional). Verified UNOWNED today — SPEC-004's frontmatter says so explicitly
  # ("classifier.ts/git-analyzer.ts are deliberately NOT owned"); SPEC-023 predates the
  # implements: convention and claims no files.
affects:
  - packages/minspec/src/lib/config.ts
  # Tier/Phase/TierPhaseMapping move out (FR-1); DQ-1 decides whether classify()'s
  # signature changes, not whether this file's type exports change — they change either way.
  - packages/shared/src/index.ts
  # New barrel line, mirroring the existing one-export-per-concern pattern (contracts/
  # conformance, canonical, rework, trust-model, review-signals, next-task, project-prefix).
  - packages/minspec/tests/classifier.test.ts
  # Shrinks to the calibration-write describe block (saveCalibration/recordOverride);
  # imports loadCalibration from @aiclarity/shared instead of defining it locally.
  - packages/minspec/src/commands/classify.ts
  - packages/minspec/src/views/spec-panel-html.ts
  - packages/minspec/src/lib/auto-merge.ts
  - packages/minspec/src/lib/consequence-analyzers.ts
  - packages/minspec/src/lib/ast-analyzer.ts
  - packages/minspec/src/lib/git-analyzer.ts
  - packages/minspec/src/__benchmarks__/perf.bench.ts
  # All seven are the current importers of packages/minspec/src/lib/classifier.ts
  # (verified by grep). Each gets an import-path edit (types/scoring from
  # @aiclarity/shared, calibration-write still from the local module); none is
  # structurally changed by this spec and none is claimed as owned.
---

# Relocate the classifier engine to `@aiclarity/shared` (Tier 0), keep signal producers in MinSpec

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch
> that produced it. A human reads this spec, resolves the
> **[Decisions needed (Clarify)](#decisions-needed-clarify)** section, and approves it
> through the normal spec-approval gate before anything is built.

Materializes **[#54](https://github.com/AIClarityAU/minspec/issues/54)** — DR-014 §2
("Classifier split — engine to shared, signal producers stay local") decided this move;
its own Clause-state table (added 2026-07-29) records clause 2 as **"Not executed. The
engine is still `packages/minspec/src/lib/classifier.ts`;
`packages/shared/src/classifier.ts` does not exist. Tracked at #54."** — verified still
true against this worktree's `HEAD` while writing this spec. This spec is the Specify
phase that lets that execution happen.

## One-Sentence Scope

Move the classifier's pure engine (`Tier`/`Phase` types, `ClassificationSignal` /
`ClassificationResult` shapes, `classify()`, `applyFloor()`, `pickDrivingSignal()`,
`overrideClassification()`, and the calibration **read** path) from
`packages/minspec/src/lib/classifier.ts` into `@aiclarity/shared`, leaving the
diff-measuring signal producers (`git-analyzer.ts`, `ast-analyzer.ts`) and the
calibration **write** path (`saveCalibration()`, `recordOverride()`) in `packages/minspec`.

## Context

### What already exists, verified against this worktree

- `packages/minspec/src/lib/classifier.ts` (289 lines) defines the full engine today:
  `ClassificationSignal`/`ClassificationResult`/`CalibrationData`/`CalibrationOverride`
  types, `applyFloor()`, `classify()`, `pickDrivingSignal()`, `overrideClassification()`,
  `loadCalibration()`, `saveCalibration()`, `recordOverride()`. It imports `Tier`,
  `Phase`, `MinspecConfig` from `./config` (`classifier.ts:3`).
- `packages/minspec/src/lib/config.ts` defines `Tier` (`:5`), `Phase` (`:8`),
  `TierPhaseMapping` (`:17`), and the full `MinspecConfig` shape (`:43`) — including
  fields that are purely extension/workspace concerns (`specsDir`, `decisionsDir`,
  `epicsDir`, `coverage`, `approvers`, `projectName`) that have nothing to do with
  classification. `classify()` reads only `config.phaseMappings` (`classifier.ts:115,139`).
- `@aiclarity/shared` (`packages/shared/src/`) is Tier 0 today — grepped for
  `vscode`/`http`/`https`/`fetch`/child-process imports across `packages/shared/src`:
  none found. It is consumed **barrel-only**: `packages/shared/src/index.ts` re-exports
  one file per concern (`contracts/conformance`, `canonical`, `rework`, `trust-model`,
  `review-signals`, `next-task`, `project-prefix`); deep imports are banned at `error`
  by an ESLint rule (DR-064 / SPEC-040), already live in CI.
- `packages/shared/src/next-task.ts:52-58` already faced this exact seam once: it needs
  `Phase`/`PhaseStatus` but, rather than depending on `packages/minspec`, it
  **redeclares them Tier-0-locally** with the comment "mirror packages/minspec
  source-of-truth, redeclared Tier-0-locally". That precedent and the one this issue
  asks for pull in opposite directions — next-task.ts duplicates rather than relocates.
  See DQ-2.
- Seven files currently import from `packages/minspec/src/lib/classifier.ts` (verified
  by grep, zero false positives): `commands/classify.ts`, `__benchmarks__/perf.bench.ts`,
  `views/spec-panel-html.ts`, `lib/auto-merge.ts`, `lib/consequence-analyzers.ts`,
  `lib/ast-analyzer.ts`, `lib/git-analyzer.ts`.
- `packages/minspec/tests/classifier.test.ts` (442 lines) tests the engine (lines 1-302:
  `pickDrivingSignal`, `classify()`, `overrideClassification()`, `applyFloor()`) and the
  calibration persistence trio (lines 303-442: `loadCalibration()`, `saveCalibration()`,
  `recordOverride()`) in one file.
- Ownership check (SPEC-038 FR-3, one `implements:` owner per file): neither
  `classifier.ts` nor `config.ts` is claimed by any existing spec's `implements:` list.
  SPEC-004's own frontmatter says so explicitly — `classifier.ts`/`git-analyzer.ts` are
  "deliberately NOT owned" because its harness "measures; it does not mutate the
  classifier." SPEC-023 predates the `implements:` convention and declares no files.
  Both files are free for this spec to claim.

### Why DR-014's "blocked by #53" note may no longer apply as written

The issue body (filed before ScroogeLLM's DR-027 repo split and DR-021/DR-076 shelving)
says this work is "**Blocked by #53** (calibration single-writer decision)." Tracing the
actual scope against DR-014's own Clause-state table complicates that:

- Clause 3 (single-writer) is recorded as **"Premise changed, enforcement unverified...
  `bridge.ts` exists but contains no calibration handling, so the #53 writer election is
  not visible in this repo. Nothing enforces single-writer today."** — i.e. #53 has not
  landed in this repo either.
- This spec's scope (FR-1..FR-6 below) moves only the calibration **read** path
  (`loadCalibration`). `saveCalibration`/`recordOverride` — the **write** path #53's
  writer-election decision actually governs — stay in `packages/minspec`, unchanged in
  behavior. Nothing in this spec adds a second writer or changes who writes
  `.minspec/calibration.json`.

So, read narrowly, this move does not obviously need #53 resolved first. See **DQ-3** —
this is flagged as a decision rather than assumed, because the issue author may have had
a reason (e.g. ScroogeLLM's shelved shadow-classifier instrument eventually becoming a
second reader/writer) that isn't visible from this repo alone.

### Why this is tier T3, not T4

The blast radius is large in file count (11 files touch, per `implements:`/`affects:`
above) but mechanically bounded: every touched file's change is a type relocation or an
import-path edit, none introduces new runtime behavior for an existing MinSpec user
(the engine's inputs/outputs are unchanged — see Invariants). No new user-facing surface,
no schema migration for `.minspec/calibration.json` beyond an additive optional field
(FR-6). That matches T3 (full spec cycle, no Clarify-mandatory HITL beyond this Specify
read) rather than T4.

## Functional Requirements

1. **Relocate the Tier-0 engine types.** `Tier`, `Phase`, `TierPhaseMapping`,
   `ClassificationSignal`, `ClassificationResult`, `CalibrationData`,
   `CalibrationOverride` are defined in `@aiclarity/shared` and exported from its barrel
   (`packages/shared/src/index.ts`). `packages/minspec/src/lib/config.ts` no longer
   defines `Tier`/`Phase`/`TierPhaseMapping` itself — see DQ-2 for whether it imports
   them from `@aiclarity/shared` or keeps a local alias.
2. **Relocate the scoring functions.** `classify()`, `applyFloor()`,
   `pickDrivingSignal()`, `overrideClassification()` move to `@aiclarity/shared` with
   identical input/output behavior (same signal → same `ClassificationResult`, byte-for-byte
   on every existing test case in `packages/minspec/tests/classifier.test.ts` lines 1-302).
   See DQ-1 for `classify()`'s exact parameter shape.
3. **Relocate the calibration READ path only.** `loadCalibration()` (and its private
   `emptyCalibration()` helper) move to `@aiclarity/shared`, unchanged in behavior
   (missing file / invalid JSON / wrong shape all still resolve to an empty override
   log, per the existing tests).
4. **Calibration WRITE path stays in MinSpec.** `saveCalibration()` and
   `recordOverride()` remain in `packages/minspec/src/lib/classifier.ts` (or a renamed
   sibling file), importing `loadCalibration`/`CalibrationData`/`CalibrationOverride`
   from `@aiclarity/shared` rather than defining them locally. MinSpec remains the sole
   writer of `.minspec/calibration.json` — unchanged from today.
5. **Signal producers stay in MinSpec.** `git-analyzer.ts` and `ast-analyzer.ts` are not
   moved; they continue to produce `ClassificationSignal[]` (now importing that type from
   `@aiclarity/shared`) by measuring a code diff.
6. **Engine-version stamp (DR-014 §4).** `@aiclarity/shared` exports a classifier
   engine-version constant (e.g. derived from `packages/shared/package.json`'s
   `version` field, or a dedicated `CLASSIFIER_ENGINE_VERSION` constant bumped
   alongside it). `saveCalibration()` stamps every write with this value in a new
   optional `CalibrationData.engineVersion` field; `loadCalibration()` surfaces
   whatever value is on disk (or `undefined` for a pre-existing file with no stamp —
   never fabricated). This exists so a future second consumer of this engine (DR-014's
   stated reason — ScroogeLLM; see DQ-3) can detect "I'm running engine version X but
   the on-disk calibration was last written by Y" rather than silently disagreeing. No
   consumer compares versions in this spec's scope — only the stamp is written/read.
   The field is additive; a file without it is still valid (FR-3's existing-tests
   contract is unchanged).
7. **Test relocation mirrors code relocation.** The engine + calibration-read tests in
   `packages/minspec/tests/classifier.test.ts` (lines 1-337, i.e. everything except the
   `saveCalibration()`/`recordOverride()` describe blocks) move to
   `packages/shared/tests/classifier.test.ts` verbatim (same assertions, same fixture
   data). The remaining `saveCalibration()`/`recordOverride()` tests stay in
   `packages/minspec/tests/classifier.test.ts` and import `loadCalibration` /
   `CalibrationData` from `@aiclarity/shared`.
8. **Barrel-only consumption, no deep imports.** Every consumer in `packages/minspec`
   imports relocated symbols via `from '@aiclarity/shared'`, never
   `from '@aiclarity/shared/src/classifier'` or similar — enforced by the existing
   DR-064/SPEC-040 ESLint rule, which this spec does not need to extend (it already
   covers any new file under `packages/shared/src`).
9. **No Tier-0 contamination.** `packages/shared/src/classifier.ts` imports only `fs`
   and `path` (for the calibration-read file access, matching what `classifier.ts`
   already does today) — no `vscode`, no `http`/`https`/`fetch`, no child-process
   spawn. This is a continuation of an existing property, not a new one; stated as an
   FR because it is the property this entire move must not break.

## Invariants (must not break)

- **INV-1 (behavioral equivalence).** For every existing input in
  `packages/minspec/tests/classifier.test.ts`, the relocated `classify()` /
  `applyFloor()` / `pickDrivingSignal()` / `overrideClassification()` /
  `loadCalibration()` produce byte-identical output to today's. This is a pure code
  move, not a rewrite — no scoring-logic change is in scope here.
- **INV-2 (constitution #1 — offline).** `@aiclarity/shared` makes no network call
  before or after this move. `fs`/`path` reads of `.minspec/calibration.json` are the
  only I/O, matching the existing Tier-0 contract (DR-014 §1).
- **INV-3 (DR-014 §1 tier→package map).** `@aiclarity/shared` gains no `vscode` import
  as a result of this move. `packages/minspec` keeps its signal producers and its
  extension-only `MinspecConfig` fields (`specsDir`, `coverage`, `approvers`, etc.).
- **INV-4 (DR-014 §3 single-writer).** `.minspec/calibration.json` has exactly one
  writer after this move: `packages/minspec`'s `saveCalibration()`/`recordOverride()`.
  Nothing in `@aiclarity/shared` writes that file.
- **INV-5 (SPEC-038 FR-3 ownership).** No file this spec does not list in `implements:`
  gains a second claimed owner; no file already owned by another spec's `implements:`
  is reclaimed here (verified: none is, per Context above).
- **INV-6 (constitution #2 — no silent gate, applied to this move).** The relocation
  must not make `npm run validate` / `npm test` pass vacuously — i.e. the moved tests
  must still exercise the real relocated functions (import from `@aiclarity/shared`,
  not a stub), not a copy that silently diverges.

## Acceptance Criteria

- AC-1: `packages/shared/src/classifier.ts` exists, exports `Tier`, `Phase`,
  `TierPhaseMapping`, `ClassificationSignal`, `ClassificationResult`, `CalibrationData`,
  `CalibrationOverride`, `classify`, `applyFloor`, `pickDrivingSignal`,
  `overrideClassification`, `loadCalibration`, and is re-exported from
  `packages/shared/src/index.ts`.
- AC-2: `packages/minspec/src/lib/classifier.ts` (or its renamed successor) exports only
  `saveCalibration` and `recordOverride`, importing everything else it needs from
  `@aiclarity/shared`.
- AC-3: All seven existing consumers of the old `classifier.ts` compile and behave
  identically after switching their imports.
- AC-4: `packages/shared/tests/classifier.test.ts` contains the relocated engine +
  calibration-read tests and passes; `packages/minspec/tests/classifier.test.ts`
  contains only the calibration-write tests and passes.
- AC-5: `saveCalibration()` writes an `engineVersion` field; `loadCalibration()` round-trips
  it; loading a calibration.json written before this change (no `engineVersion` key)
  does not throw and does not fabricate a value.
- AC-6: `npm run lint` passes with the existing no-deep-import-from-shared rule — no new
  exception is added for this move.
- AC-7: `npm test` and `npm run validate` both pass.
- AC-8: `grep -rn "from '\.\./lib/classifier'\|from '\./classifier'" packages/minspec/src`
  (or the Plan phase's equivalent check) finds only the calibration-write import, never a
  deep import into `@aiclarity/shared/src/*`.

## Decisions needed (Clarify)

### DQ-1 — Does `classify()` keep taking a `MinspecConfig`-shaped parameter, or a narrower `phaseMappings` table?

`classify()` today takes `config: MinspecConfig` but reads only `config.phaseMappings`
(`classifier.ts:115,139`). `MinspecConfig` carries fields (`specsDir`, `coverage`,
`approvers`, `projectName`, ...) that are pure MinSpec-extension concerns, unrelated to
scoring a signal set — pulling the whole type into a Tier-0 engine library is a coupling
smell DR-014 §1 argues against for the opposite direction (keeping `vscode`-adjacent
things out of `shared`).

- **Option A — narrow the signature (rec).** `classify(signals, phaseMappings: Record<Tier,
  TierPhaseMapping>)`. The 7 call sites change one line each (`classify(signals, config)` →
  `classify(signals, config.phaseMappings)`). Cost: a mechanical one-line edit at every
  call site, and any future `classify()` caller must remember to pass the sub-object
  instead of the config it already has in hand.
- **Option B — keep a config-shaped parameter, structurally typed.** `@aiclarity/shared`
  declares its own minimal interface (e.g. `interface PhaseMappingSource { phaseMappings:
  Record<Tier, TierPhaseMapping> }`); `MinspecConfig` satisfies it structurally with zero
  call-site changes beyond the import path. Cost: a second similarly-named type for a
  future reader to confuse with `MinspecConfig` itself, and it keeps the engine
  "aware" of a config-object shape rather than being a pure `(signals, mapping) → result`
  function.

### DQ-2 — Does `config.ts` import `Tier`/`Phase` back from `@aiclarity/shared`, or keep its own local redeclaration?

`packages/shared/src/next-task.ts:52-58` already chose "redeclare Tier-0-locally" over
depending on `packages/minspec` for this exact `Phase` type, specifically to avoid a
cross-package dependency for a Tier-0-only consumer. This issue asks for the opposite:
make `@aiclarity/shared` the one place `Tier`/`Phase` are *defined*, with
`packages/minspec/src/lib/config.ts` importing them.

- **Option A — true relocation (rec, matches the issue text).** `config.ts` does
  `import type { Tier, Phase, TierPhaseMapping } from '@aiclarity/shared'` and no longer
  declares them. One source of truth, which is the stated point of DR-014 §2 ("same
  vocabulary MinSpec classifies with"). Cost: `packages/minspec` now has a
  compile-time dependency on `@aiclarity/shared` for its own core config type, not just
  for the classifier — a slightly wider surface than the issue's bullet list names.
- **Option B — duplicate, matching `next-task.ts`'s existing precedent.** `shared`
  redeclares `Tier`/`Phase` for its own engine's use; `config.ts` keeps its own copy.
  Cost: two independently-edited definitions of the same union type already exist in
  this repo (`config.ts` and `next-task.ts`) — Option B makes it three, and nothing
  currently checks they stay in sync (a future edit to one and not the others reintroduces
  the inconsistency DR-014 was partly written to prevent).

This also surfaces a **pre-existing** inconsistency this spec did not create:
`packages/shared/src/next-task.ts`'s own `Phase` type is already a second, independently
maintained copy of `packages/minspec/src/lib/config.ts`'s `Phase`. Resolving that
duplication (e.g. by having `next-task.ts` import from the new
`packages/shared/src/classifier.ts` once it exists) is **out of scope** for this spec —
flagged here so a reviewer doesn't mistake it for something this spec introduces, and so
the choice on DQ-2 is made with that existing duplicate in view.

### DQ-3 — Does this spec actually need #53 resolved first, or is "Blocked by #53" stale?

See Context above. The scope in FR-1..FR-7 touches only the calibration **read** path
and leaves the writer unchanged (MinSpec, unconditionally, matching DR-014 §3's
steady state). Two readings:

- **Option A — proceed now (rec).** Treat the relocation as decoupled from the
  writer-election question; #53 governs *who writes* `.minspec/calibration.json` when
  ScroogeLLM is also present, which this spec does not touch. Cost: if #53's eventual
  design changes `CalibrationData`'s on-disk shape (e.g. adds a writer-identity field),
  this spec's relocated types get a second, later edit — acceptable churn for a
  mechanical move, not a redesign.
- **Option B — wait for #53.** Honor the issue's stated blocking relationship literally
  and park this spec's approval until #53 is resolved. Cost: #53 is itself not visible
  as resolved anywhere in this repo (DR-014's own Clause-state table says so), and
  ScroogeLLM's product work is shelved (DR-075/076) with only measurement instruments
  live — so "wait for #53" may mean waiting indefinitely for a decision whose original
  motivating consumer (ScroogeLLM-as-a-product) no longer exists in that form.

## Out of Scope

- Any change to `classify()`'s scoring algorithm, signal weighting, or tier thresholds —
  this is a pure relocation (INV-1).
- ScroogeLLM's own repo (`AIClarityAU/scroogellm`, private) consuming
  `@aiclarity/shared`'s relocated engine — tracked as that repo's own concern once
  product work there resumes (currently shelved per DR-075/076).
- Resolving the pre-existing `next-task.ts` / `config.ts` `Phase`-type duplication
  (see DQ-2) beyond the choice this spec makes for the classifier's own types.
- Building the CI/publish version-lockstep gate DR-014 §4 separately calls for
  (asserting both extensions resolve the same `@aiclarity/shared` version) — that gate
  has no consumer in this monorepo post-DR-027 (ScroogeLLM is a separate repo); FR-6's
  engine-version stamp is the detectable-skew half this spec delivers, not the gate
  itself.
- #53 (calibration single-writer election) itself — this spec does not decide or
  implement writer election; DQ-3 only asks whether this spec's narrower scope needs
  to wait on that separate decision.

## Traceability

- Issue: [#54](https://github.com/AIClarityAU/minspec/issues/54)
- Decision: [DR-014](../../../docs/decisions/DR-014.md) §2 (the decision this spec
  executes), §1 (tier→package map this spec's INV-3 preserves), §3 (single-writer rule
  this spec's INV-4 preserves), §4 (version-lockstep/skew-detection this spec's FR-6
  partially delivers)
- Related specs: [SPEC-004](../SPEC-004-classifier-validation/requirements.md) (classifier
  validation harness — explicitly does not own `classifier.ts`), [SPEC-023](../SPEC-023-consequence-screen/requirements.md)
  (consequence-screen analyzers that stay in `packages/minspec` per FR-5)
- Blocking relationship under review: [#53](https://github.com/AIClarityAU/minspec/issues/53)
  (see DQ-3)
