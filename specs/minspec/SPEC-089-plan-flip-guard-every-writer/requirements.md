---
id: SPEC-089
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology — the spec→code ownership contract (same epic as SPEC-038 and SPEC-051, whose DQ-2 this finishes)
aspects: [ownership, lifecycle, phase-transition, approval, validation, import-boundaries, tier-0]
relates_to: [SPEC-051, SPEC-038, SPEC-040, SPEC-061, DR-057, DR-064, DR-088, DR-003, "#1396", "#1446", "#1806", "#1634", "#874"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-3; the SPEC-051
# trap is declaring after approval, which stales the sign-off). The one file this spec
# CREATES under every answer in "Decisions needed" is its own suite. It does not exist yet
# (greenfield paths are valid, SPEC-038 FR-4).
implements: [packages/minspec/tests/phase-transition-ownership-guard.test.ts]
# Modified, never owned. All five exist on main at f4e6cbcf. `approval.ts` is touched for a
# comment correction only (FR-8).
affects: [packages/minspec/src/lib/ownership-advance-guard.ts, packages/minspec/src/lib/spec-validator.ts, packages/minspec/src/lib/spec-manager.ts, packages/minspec/src/lib/spec.ts, packages/minspec/src/lib/approval.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Every writer that can flip a spec into Plan runs the one ownership guard (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers **Decisions needed (Clarify)**, and approves it through the normal
> spec-approval gate before any code changes.

Materializes **[#1396](https://github.com/AIClarityAU/minspec/issues/1396)** — *"SPEC-051
DQ-2: shared ownership guard at the Plan flip is blocked by the zero-cycle invariant."* It
finishes the second Clarify decision of
[SPEC-051](../SPEC-051-ownership-before-approval/requirements.md) (ownership declared before
approval), recorded in that spec's
[design.md](../SPEC-051-ownership-before-approval/design.md): *"Shared guard. Every actor
that writes `plan → in-progress` calls one function. Fixes the class, not today's actor."*

**Read this first: the issue's premise has moved.** #1396 was filed when the guard could not
reach the phase writer without a runtime import cycle. That blocker was removed by
[#1446](https://github.com/AIClarityAU/minspec/issues/1446) (commit `d1a285b7`) while this
issue sat in the queue. The cycle is gone and the writer the issue names is guarded. What is
left is narrower than the issue describes, and is measured in **Context** below. The first
decision put to the human (DQ-1) is whether that remainder is worth a build at all.

**Id note.** Spec ids 080 through 088 are claimed by other branches visible in this
checkout's remote refs (twenty-three different specs claim id 080 alone), so this is
`SPEC-089`, the highest id seen on disk or on any locally-known remote ref, plus one. Those
refs may be stale and there is no spec-id collision gate (only decision records have one,
`scripts/check-dr-id-collision.ts`). If the id collides at review time, renumber.

**No decision record.** Every choice here is a placement of a function call and a test, and
is undone in under a day by reverting one commit. That is below the bar for a decision
record. `docs/decisions/INDEX.md` was searched for *ownership*, *import cycle* and
*zero-cycle*: the only hit is DR-088 (ownership leaves the approval hash), a different
decision that this spec does not touch.

## One-Sentence Scope

Make "a T3/T4 (full-ceremony tier) primary spec cannot be moved into the Plan build band
with its code ownership undeclared" a property of **every function in `packages/minspec/src`
that persists a phase transition**, not only of the approval writer, by giving the one
existing guard the ability to judge the phase map actually being written, calling it from the
one transition writer that still lacks it, and pinning the set of writers with a test that
fails when a new one appears.

## Context

Every claim below was read from the code at `f4e6cbcf` (this branch's base) on 2026-10-01.
Line numbers are coordinates at that commit and will drift; the symbol names are the stable
handle.

### What #1446 already delivered

- **The cycle is gone, by a different extraction than the issue proposed.** The issue's
  Option 1 was a new dependency-free `ownership-declaration.ts` holding the predicate and the
  two frontmatter tokenizers. What shipped instead moved the three symbols the validator
  imported from `./spec` (`SPEC_STATUSES`, `SPEC_TYPES`, `stripInlineComment`) into a leaf,
  `packages/minspec/src/lib/spec-vocabulary.ts`, which imports nothing.
  `spec-validator.ts:18` now value-imports from that leaf, and its remaining `./spec` import
  (`spec-validator.ts:13`) is type-only. `fmListField` and `rawFrontmatterField` stayed
  private to `spec-validator.ts` (`:743`, `:428`); they did not need to move.
- **The guard has one implementation**, `assertOwnershipDeclaredForAdvance`
  (`packages/minspec/src/lib/ownership-advance-guard.ts:58`), with two production callers:
  `advanceSpecToImplementing` (`packages/minspec/src/lib/spec.ts:674`, before any write in
  that function) and `approveSpec` (`packages/minspec/src/lib/approval.ts:566`).
- **The zero-cycle gate is green with the guard in place.** `npm run check:cycles` on this
  base prints `Import cycle check passed — 110 modules scanned, 0 runtime import cycles.`
- **It is tested at the writer.** `packages/minspec/tests/ownership-guard.test.ts:170`,
  `:180` and `:189` cover refuse, allow, and silent-on-default-config for
  `advanceSpecToImplementing`.

So the three options in the issue body are settled without a decision here: Option 1's goal
(guard adjacent to the write, by construction, no cycle) is met; Option 3 (injected callback)
was not taken; Option 2 (a test over call sites) survives only as the backstop in FR-4.

### What is still open — measured

**1. A second transition writer exists, and it is unguarded.**
`transitionPhase` (`packages/minspec/src/lib/spec-manager.ts:516`) is an exported function
that advances, skips, or reopens a spec's current phase and writes the result to disk
(`spec-manager.ts:566`, via `writeEntry`). Two of its three actions write
`phases.plan: in-progress` on a spec that was pre-Plan:

- `advance` with Clarify in progress — `advancePhase` marks the current phase done and the
  next pending phase in progress (`packages/minspec/src/lib/lifecycle.ts:229`).
- `skip` on Clarify — `skipPhase` starts the next pending phase the same way
  (`lifecycle.ts:290`).

`plan: in-progress` is the state `validateOwnership` arms on
(`packages/minspec/src/lib/spec-validator.ts:800`). Neither `spec-manager.ts` nor
`lifecycle.ts` references the guard. `transitionPhase` has **no production caller** today:
a search of `packages/minspec/src` and `scripts/` for the name returns only its own
definition, and it is exercised by 26 references across `tests/features.test.ts` and
`tests/spec-manager.test.ts`. It is therefore exactly the thing SPEC-051's second Clarify
decision was written about — a ready-made advance function the next actor will reach for,
which re-opens the trap unless that actor remembers a check.

**2. The guard can only judge an approval, not the map being written.**
`violationsIntroducedByApproval` (`spec-validator.ts:868`) compares the spec's current errors
with its errors after `phasesForApproval` (`spec-validator.ts:892`). It takes no target map.
Calling it from `transitionPhase` unchanged would be wrong in both directions for a
non-approval transition. Concretely: advancing an undeclared T3 spec from Specify to Clarify
leaves `plan: pending` (no crossing, nothing to refuse), but the approval simulation sets
`plan: in-progress` and the guard would refuse — a refusal naming a rule the write does not
arm.

**3. The directory layout reads back no raw frontmatter.**
`transitionPhase` supports both storage layouts. For the directory (`spec-kit`) layout it
reads through `readSpecKitDir`, which returns the merged spec with `raw: ''`
(`packages/minspec/src/lib/spec-layout.ts:133`, reached from `:246`). `validateOwnership`
reads `implements:` from `spec.raw` (`spec-validator.ts:807`). A guard handed that merged
value would see no declaration on a correctly declared spec and refuse it. This repo uses the
flat layout default (`packages/minspec/src/lib/config.ts:109`), so nothing here exercises it
today.

**4. One exported primitive takes an arbitrary phase map.**
`setSpecPhases` (`spec.ts:570`) writes whatever map it is given. Its only production caller
is `advanceSpecToImplementing` (`spec.ts:692`), after the guard has run; one test file
imports it directly (`tests/approve-phase-sync.test.ts`).

**5. A comment on main now states the opposite of the code.**
`approval.ts:546-553` says `advanceSpecToImplementing` "remains unguarded" and is "Tracked as
tasks.md T4.2". It has been guarded since `d1a285b7`. SPEC-051's `tasks.md` still shows T2.6
and T4.2 unchecked, and its `requirements.md` scope note still says "NOT guarded". A reader
following any of the three concludes the hole is open.

### What this spec deliberately does not own

Three adjacent defects on the same code are owned elsewhere, and are listed so the reader
does not mistake this spec for a fix to them:

- **The approve command runs its own copy of the refusal, and the `approveSpec` backstop is
  inert by call order** — [#1806](https://github.com/AIClarityAU/minspec/issues/1806), with
  code in flight on `agent/issue-1806`.
- **A refused advance can leave a half-written file** —
  [#1634](https://github.com/AIClarityAU/minspec/issues/1634), in Specify on
  `agent/issue-1634`.
- **A spec with no `phases:` block never arms the ownership rule** —
  [#1543](https://github.com/AIClarityAU/minspec/issues/1543), in Specify on
  `agent/issue-1543`.

## Functional Requirements

FR-1, FR-2, FR-5, FR-6, FR-7 and FR-8 hold under every answer below. FR-3, FR-4 and FR-9 are
shaped by DQ-2 and DQ-3 and say so.

- **FR-1 — The guard judges the transition being written.** The shared guard MUST accept the
  phase map about to be persisted and refuse on the validation **errors that moving from the
  spec's current map to that map newly introduces**. The approval case becomes this general
  form with the target fixed to `phasesForApproval(current)`, and MUST return the same
  verdict it returns today for every input (no behaviour change on the approve path). There
  remains exactly one ownership matcher: the general form re-runs `validateSpec`, it does not
  restate the rule (SPEC-051 INV-5). *Rationale: Context 2 — without this the only available
  guard gives wrong answers for any writer that is not approval.*

- **FR-2 — `transitionPhase` runs the guard before its first write.** For every action
  (`advance`, `skip`, `back`), after the target map is computed and before `writeEntry`,
  `transitionPhase` MUST call the guard with that target. On refusal it MUST write nothing —
  every file of the spec is byte-identical to before the call — and MUST report the refusal
  per the contract below. *Rationale: Context 1 — this is the one existing transition writer
  the guard does not reach.*

- **FR-3 — No exported function persists a caller-supplied phase map unguarded.** *(Shape
  depends on DQ-2.)* Under the recommended answer, `setSpecPhases` either runs the guard
  itself against the map it is handed, or stops being exported so its single guarded caller
  is the only route to it. Either way, the test that imports it directly keeps passing or is
  rewritten against the guarded route — it is not deleted.

- **FR-4 — A witness test pins the set of phase-map writers.** A test MUST enumerate, from
  the source text of `packages/minspec/src`, every site that persists spec frontmatter (calls
  to `setSpecPhases`, `writeSpecFile`, `writeSpecKitDir`, `writeEntry`, and any
  `fs.writeFileSync` whose content comes from `writeSpec` or `updateSpecFrontmatter`) and
  fail when a site is not on a reviewed list. Each list entry MUST state one of two things:
  *guarded* (and by what), or *cannot change the phase map* (and why — for example, creation
  writes an all-pending map; the task-checkbox toggle at `packages/minspec/src/views/spec-panel.ts:166` rewrites
  a body line only). The test MUST prove it is not vacuous: it asserts the enumerated count
  is above zero, and it carries a control showing that an unlisted writer planted in a
  fixture source tree fails it. *Rationale: FR-2 and FR-3 guard the writers that exist; this
  is what makes the next one visible. It is the surviving form of the issue's Option 2 — a
  backstop to the construction, not a substitute for it.*

- **FR-5 — Both storage layouts get the same verdict.** For a directory-layout spec, the
  guard MUST be given the raw bytes of the shard that carries the ownership frontmatter, not
  the merged value whose `raw` is empty. A correctly declared directory-layout spec MUST be
  allowed, and an undeclared one refused, exactly as their flat-layout equivalents are.
  *Rationale: Context 3 — otherwise FR-2 ships a false refusal for a whole layout.*

- **FR-6 — Zero runtime import cycles, without evasion.** `npm run check:cycles` MUST still
  report `0 runtime import cycles` after the change. The guard MUST NOT be reached through a
  lazy `require`, a dynamic `import()`, or any other form the cycle checker does not see.
  `spec-vocabulary.ts` stays a leaf: it gains no import. *Rationale: this is the invariant
  that blocked the issue originally, SPEC-040 FR-2.*

- **FR-7 — The guard's three settled properties are inherited, not re-decided.** At every
  new call site the guard remains (a) **config-respecting** — a repo on the default
  `ownershipDeclaration: 'warn'` (`config.ts:117`) is never refused; (b) limited to **newly
  introduced** errors — a spec already in the build band and already undeclared is not
  refused; and (c) scoped as `validateOwnership` scopes itself — primary specs at T3/T4 only.
  All three are properties of the diff in FR-1, so they hold by construction rather than by a
  second implementation.

- **FR-8 — Stale statements are corrected in the same change.** The comment at
  `approval.ts:546-553` is rewritten to describe the code as it stands. SPEC-051's
  `tasks.md` marks T2.6 and T4.2 delivered, citing `d1a285b7` and this spec. SPEC-051's
  `design.md` gains a dated correction under "Call sites" pointing here.
  SPEC-051's **`requirements.md` is not edited**: it carries a human approval, ownership is
  still inside the approval hash (`grep -c 'implements\|affects' packages/shared/src/canonical.ts`
  returns `0`, so DR-088's strip is not built), and a wording fix is not worth a re-approval.
  The correction is recorded in `design.md`, which is how that spec already handles its own
  citation errors. *Rationale: Context 5 — a comment that says "unguarded" over a guarded
  function is a false signpost.*

- **FR-9 — A guard that could not evaluate is reported to its caller.** *(Shape depends on
  DQ-3.)* Today, when the guard's own machinery throws, it logs a `console.warn` and lets the
  write proceed (`ownership-advance-guard.ts:76-82`). Under the recommended answer that
  behaviour is unchanged for approval, and `transitionPhase` additionally returns the fact
  that the check did not run, so a caller with no human watching a console can act on it.

- **FR-10 — Tier 0 (offline, no model).** Everything added is frontmatter parsing, the
  existing validator, and filesystem reads. No network, no model call, no `vscode` import in
  `packages/minspec/src/lib`.

## Contract

The cross-module surface this spec changes, stated as shapes rather than code. Names are
proposals for Plan; the shapes are the requirement.

```ts
// spec-validator.ts — the general form (FR-1). Pure: no fs, no mutation.
// violationsIntroducedByApproval(spec, config, options) is retained and is defined as
//   violationsIntroducedByTransition(spec, phasesForApproval(spec.frontmatter.phases), config, options)
function violationsIntroducedByTransition(
  spec: ParsedSpec,
  targetPhases: PhaseState,
  config: MinspecConfig,
  options?: ValidateSpecOptions,
): ValidationViolation[];

// ownership-advance-guard.ts — the one guard, now told what is being written (FR-1, FR-5).
// `parsed.raw` MUST be the bytes of the file carrying the ownership frontmatter.
// Omitting `targetPhases` means "the approval transition", preserving both existing callers.
function assertOwnershipDeclaredForAdvance(
  specFilePath: string,
  parsed: ParsedSpec,
  targetPhases?: PhaseState,
): void; // throws on refusal

// lifecycle.ts TransitionResult — additive, both fields optional (FR-2, FR-9).
interface TransitionResult {
  readonly success: boolean;
  readonly newPhases: PhaseState;
  readonly newStatus: SpecStatus;
  readonly warning?: string;
  /** Present only when the ownership guard refused. `success` is false, nothing was written. */
  readonly refused?: readonly { rule: string; message: string; fixHint: string }[];
  /** True when the guard could not evaluate and the write proceeded unchecked (DQ-3). */
  readonly guardDegraded?: boolean;
}
```

`transitionPhase` already reports failure by returning `success: false` rather than throwing
(`spec-manager.ts:524-544`), so a refusal follows that convention and is told apart from an
ordinary failure by `refused`. `advanceSpecToImplementing` keeps throwing, as today.

## Acceptance Criteria

Each is asserted in `packages/minspec/tests/phase-transition-ownership-guard.test.ts` unless
it names another file. Fixtures use a repo with `ownershipDeclaration: 'error'` except where
stated.

- **AC-1 (FR-2).** `transitionPhase(…, 'advance')` on an undeclared T4 primary spec with
  Clarify in progress returns `success: false` with `refused` naming
  `ownership.implements.missing`, and the spec file's bytes are unchanged.
- **AC-2 (FR-2).** The same for `'skip'` on Clarify.
- **AC-3 (FR-2, FR-7).** The same two calls on a spec declaring a valid owned path, and on
  one declaring `implements: none` with an `implements_reason:`, succeed and persist
  `plan: in-progress`.
- **AC-4 (FR-1).** `transitionPhase(…, 'advance')` on an undeclared T4 spec with Specify in
  progress **succeeds** — the target leaves `plan: pending`, so nothing is refused. This is
  the case the approval simulation would wrongly refuse; it fails if FR-2 is wired to the
  approval-only guard.
- **AC-5 (FR-1).** A table of spec shapes shows `violationsIntroducedByApproval` returns
  identical results before and after the change. The existing
  `tests/ownership-guard.test.ts` and `tests/ownership-guard-context-invariance.test.ts`
  pass unmodified.
- **AC-6 (FR-7).** On a repo with the default config, AC-1's call succeeds. A T2 spec and a
  non-primary spec are never refused. A spec already at `plan: in-progress` and undeclared is
  not refused when advanced from Plan to Tasks.
- **AC-7 (FR-5).** AC-1 and AC-3 hold for a directory-layout spec: declared is allowed,
  undeclared is refused, and on refusal no shard file changes.
- **AC-8 (FR-4).** The witness test fails when a fixture source tree contains an unlisted
  phase-map writer, passes on the real tree, and asserts it enumerated more than zero sites.
- **AC-9 (FR-3).** Under the answer chosen at DQ-2, there is no exported function in
  `packages/minspec/src/lib` through which a caller can persist `plan: in-progress` on an
  undeclared T4 primary spec in an `error`-configured repo. Asserted by calling each one.
- **AC-10 (FR-6).** `npm run check:cycles` reports zero runtime cycles, and a source scan
  finds no `require(` or `import(` expression in `ownership-advance-guard.ts`,
  `spec-manager.ts` or `spec.ts` that names the guard or the validator.
- **AC-11 (FR-9).** With the validator made to throw, `transitionPhase` behaves per the
  answer chosen at DQ-3, and under the recommended answer returns `guardDegraded: true`.
- **AC-12 (FR-8).** `grep -n 'remains unguarded' packages/minspec/src/lib/approval.ts`
  returns nothing, and SPEC-051's `requirements.md` is byte-identical to its state before
  the change (its approval sidecar still matches).

**Regression proof required at implementation.** AC-1, AC-2 and AC-7 MUST be shown failing
on the base commit and passing on the change. AC-4 MUST be shown failing against an
intermediate build that wires `transitionPhase` to the approval-only guard, since that is the
plausible wrong implementation.

## Invariants

- **INV-1 (no silent gate — constitution invariant 2).** A refusal is always visible to the
  caller and never downgraded to a log line. A guard that could not run is never reported as
  a guard that passed.
- **INV-2 (one matcher — SPEC-051 INV-5).** "Is ownership declared?" is answered by
  `validateOwnership` and nothing else. No call site restates the rule.
- **INV-3 (zero runtime import cycles — SPEC-040 FR-2).** Held by removing edges, never by
  hiding them from the checker.
- **INV-4 (no approval is minted, refreshed, or staled — SPEC-051 FR-5).** Nothing here
  writes an approval record, and no hash-bound byte of any approved spec changes.
- **INV-5 (offline — constitution invariant 1).** No network call and no model call.
- **INV-6 (the approve path is behaviourally unchanged).** A human approving a spec through
  the command sees the same outcomes as before for every input. This spec adds reach, it does
  not alter the existing reach.
- **INV-7 (no lock-out).** A spec that is already past the Plan boundary can always be
  advanced, skipped, reopened, and re-approved, whatever its ownership state.

## Decisions needed (Clarify)

Three decisions. Each names a recommended option and what that option costs.

### DQ-1 — Is the remainder worth building, now that the issue's blocker is gone?

The issue asked for the guard to reach the phase writer. It does. What is left is a second
writer with no production caller, plus the cleanup.

- **`1a` Build the remainder (FR-1 to FR-10). (rec)** Costs a full T3 cycle to guard a
  function nothing in production calls today; the benefit is entirely prospective, and stays
  so until an actor that advances phases without an approval is built.
- **`1b` Correct the stale statements only (FR-8), and close #1396 as delivered by #1446.**
  Cheapest. Costs the guarantee SPEC-051's second Clarify decision chose: `transitionPhase`
  stays an exported, tested, unguarded route into Plan, and the first actor to call it
  re-creates the red-`main` trap unless its author knows to add the check.
- **`1c` Remove the unguarded route instead of guarding it:** delete or un-export
  `transitionPhase`. Costs working, tested code (26 test references) that a later
  phase-advancing actor would have to rebuild, at which point the same question returns.

Why `1a`: the founder already decided the class should be closed rather than today's actor,
and the gap is one call plus the generalisation in FR-1. Why not sooner or larger: there is
no evidence of a live failure through this route.

### DQ-2 — How far down does "by construction" go?

Only relevant under `1a`.

- **`2a` Guard the transition writers; witness the rest. (rec)** The functions whose purpose
  is to change a phase map (`advanceSpecToImplementing`, `transitionPhase`, `setSpecPhases`)
  are guarded or made unreachable; the general serialisers (`writeSpecFile`, `writeSpec`
  plus a raw write) are covered by FR-4's witness test. Cost: for the serialisers this is a
  reviewed list, and a list can be extended by someone who adds an entry marked "cannot
  change the phase map" without that being true. Construction for transitions, convention
  plus a tripwire for serialisers.
- **`2b` Guard inside the serialisers too.** Every write of a spec file diffs old against new
  phase map and refuses a newly armed error. Strongest. Costs: validation (a config load and
  a walk up the directory tree) runs on every spec write including creation, layout
  migration, and each task-checkbox toggle; four raw `fs.writeFileSync` sites must be
  re-routed first; and a low-level serialiser gains the ability to refuse, which every one of
  its callers must then handle. Likely T4 (complete ceremony) rather than T3.
- **`2c` Witness test only, no new guard call.** Smallest. Costs FR-2: `transitionPhase`
  would be on the list as a known unguarded writer, which records the hole rather than
  closing it.

### DQ-3 — When the guard itself breaks, does an unattended caller proceed?

The guard fails open today: if evaluating it throws, it warns on the console and the write
goes ahead, on the stated ground that `npm run validate` in CI is the backstop
(`ownership-advance-guard.ts:53-56`, `:76-82`). SPEC-051 INV-1 reads the other way ("a
missing/errored ownership signal fails the transition closed"), and no test pins either
behaviour (a search of both guard test files for the warning text returns nothing). For a
human approving in the editor the difference is small. For an unattended actor calling
`transitionPhase`, a console warning reaches nobody.

- **`3a` Keep fail-open everywhere, and return the degrade to the caller (FR-9). (rec)** One
  behaviour for all call sites; the unattended caller gets a field it can act on. Cost: it is
  still fail-open — a caller that ignores `guardDegraded` writes an unchecked transition, and
  the only thing between that and a red `main` is the CI validator, after the fact.
- **`3b` Fail closed at `transitionPhase` only.** Matches SPEC-051 INV-1 for the unattended
  path. Costs: two behaviours for one guard depending on the entry point, and any defect in
  the guard's own plumbing (a config that fails to load, say) blocks every phase transition
  until it is fixed.
- **`3c` Fail closed everywhere, approval included.** Matches SPEC-051 INV-1 as written.
  Costs: changes the approve path (breaking INV-6 here), and a guard defect then makes
  approval unavailable — the outcome the current design explicitly chose to avoid.

Whichever is chosen, the contradiction between SPEC-051 INV-1 and the shipped guard should be
recorded where it is resolved; under `3a` that is a dated note in SPEC-051's `design.md`
(FR-8's route), not an edit to its approved `requirements.md`.

## Risks

| # | Risk | Mitigation |
|---|------|------------|
| R1 | The generalisation in FR-1 changes an approval verdict. | AC-5: a before/after table, and the two existing guard suites pass unmodified. |
| R2 | FR-2 refuses a legitimate transition (false refusal locks a human out). | AC-4, AC-6, AC-7 each pin a case that must be allowed; INV-7. |
| R3 | The witness test goes green without checking anything. | AC-8: a non-zero count assertion and a planted-writer control. |
| R4 | A new import closes a runtime cycle (`spec-manager` → guard → validator). | AC-10. Read at `f4e6cbcf`: the guard value-imports `spec-validator` and `config`; `spec-validator` value-imports `spec-vocabulary`, `config`, `lifecycle` and `ownership-path-rules`; `lifecycle` value-imports only `config`; `config` imports only `fs` and `path`; the other two import nothing. None reaches `spec-manager`, so no cycle is expected — an inference from reading the import lines, to be confirmed by running the gate with the edge in place. |
| R5 | This lands against moving code — #1806 and #1634 touch the same functions. | Sequence after whichever of those merges first, re-read the call order then; FR-2's "before the first write" is stated as an order, not a line. |
| R6 | The directory layout has shards with their own frontmatter; "the shard that carries ownership" is ambiguous. | Plan names it explicitly (expected: `spec.md`) and AC-7 pins it. |

## Out of Scope

- **The approve command's duplicate refusal and the inert `approveSpec` backstop** — #1806.
- **Write ordering inside `advanceSpecToImplementing`** — #1634.
- **Phaseless specs that never arm ownership** — #1543.
- **Dissolving the type-held import cycles** — SPEC-040 FR-6, in Specify on
  `agent/issue-988`.
- **Taking ownership out of the approval hash** — DR-088.
- **Building any actor that calls `transitionPhase`** (the phase-advance queue's consumer
  under DR-057). This spec makes the function safe to call; it does not call it.
- **Two things observed while reading this code, not addressed here, and NOT yet filed**
  (this dispatch may not make network calls, so both are raised in the hand-off for a human
  or a later session to file):
  1. `transitionPhase` writes `status:` from the phases-only `getSpecStatus`
     (`spec-manager.ts:559-565`, `lifecycle.ts:172-178`), which yields `implementing` for a
     spec in Plan with no approval, where the approval-aware `deriveStatus` yields
     `specifying` (`lifecycle.ts:140`). That is a status-mirror disagreement of the kind
     SPEC-059 gates.
  2. A T3/T4 spec whose Plan phase is `skipped` never arms the ownership rule, because the
     trigger is `plan === 'in-progress' || plan === 'done'` (`spec-validator.ts:800`).
     Whether that is intended belongs to SPEC-038.

## Traceability

- **Issue:** [#1396](https://github.com/AIClarityAU/minspec/issues/1396).
- **Decision being finished:** SPEC-051 second Clarify decision (shared guard), recorded in
  [SPEC-051 design.md](../SPEC-051-ownership-before-approval/design.md), "Resolved decisions"
  and "Call sites".
- **Prior delivery:** [#1446](https://github.com/AIClarityAU/minspec/issues/1446), commit
  `d1a285b7` — the `spec-vocabulary.ts` leaf and the guard at `advanceSpecToImplementing`.
- **The rule being guarded:**
  [SPEC-038](../SPEC-038-spec-code-ownership/requirements.md) FR-3, `validateOwnership`.
- **The invariant that blocked the issue:**
  [SPEC-040](../SPEC-040-import-boundaries/requirements.md) FR-2 (zero runtime import
  cycles), checker per [DR-064](../../../docs/decisions/DR-064.md).
- **The prospective callers:** [DR-057](../../../docs/decisions/DR-057.md) (phase-advance
  queue and its drain consumers).
- **Method:** [DR-003](../../../docs/decisions/DR-003.md) — the mechanism (an unguarded
  writer) is paired with the gate that makes the next one visible (FR-4).
