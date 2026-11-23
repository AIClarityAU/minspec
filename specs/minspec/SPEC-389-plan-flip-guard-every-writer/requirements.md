---
id: SPEC-389
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology — the spec→code ownership contract; SPEC-051's DQ-2 (shared guard at the Plan flip) is the decision this spec completes
aspects: [ownership, lifecycle, spec-gate, import-boundaries, tier-0, validation, silent-gate]
depends_on: [SPEC-051]
relates_to: ["#1396", "#1395", "#1446", "#1806", "#874", "SPEC-051", "SPEC-038", "SPEC-040", "SPEC-300", "DR-057"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan. Expected surface:
  `packages/minspec/src/lib/spec-manager.ts` (`transitionPhase`),
  `packages/minspec/src/lib/ownership-advance-guard.ts`, possibly
  `packages/minspec/src/lib/spec-validator.ts` (D2), and a new witness test under
  `packages/minspec/tests/`. None of it is claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-389: Every writer that crosses a spec into Plan runs the one ownership guard

> **This is a SPECIFICATION ONLY.** Written for issue
> [#1396](https://github.com/AIClarityAU/minspec/issues/1396) (SPEC-051 DQ-2: the shared
> ownership guard at the Plan flip was blocked by the zero-cycle invariant). Nothing is built
> until this spec is approved, after [Decisions needed (Clarify)](#decisions-needed-clarify)
> are resolved.
>
> No decision record. Every choice here is where a function call sits, how a test lists
> its call sites, and whether one unused export stays or goes. Each can be undone in well
> under a day (DR-359 ADR filter). The design rests on
> [SPEC-051](../SPEC-051-ownership-before-approval/requirements.md) DQ-2 ("shared guard": every
> actor that writes `plan → in-progress` calls one function) and on
> [SPEC-040](../SPEC-040-import-boundaries/requirements.md)'s zero-runtime-cycle invariant.

## One-Sentence Scope

Make SPEC-051 DQ-2's "fix the class" guarantee hold for every production function that
can move `phases.plan` out of `pending`. Today one such writer, `transitionPhase`, skips
the guard. A deterministic witness test will fail when a new writer appears without the
guard.

## Context: what exists today, and the gap

**The placement problem #1396 describes is already solved on main** (base `bcf26b36`;
checked by reading the code, the zero-cycle test was **not** run in this dispatch because
the worktree has no installed dependencies):

- The vocabulary that caused the cycle moved out of `spec.ts`. `spec-validator.ts` now
  imports `SPEC_STATUSES` / `stripInlineComment` from `./spec-vocabulary` instead of
  value-importing `./spec` (#1446; comment at `packages/minspec/src/lib/spec.ts:22-25`).
- The guard is a module of its own, `packages/minspec/src/lib/ownership-advance-guard.ts`
  (`assertOwnershipDeclaredForAdvance`). Its only edge back to `./spec` is
  `import type { ParsedSpec }`, which the compiler erases. Its header diagram records the
  dependency direction, and notes that pulling in `epic-manager` / `spec-layout` there
  measured 3 cycles, while the current form measured 0.
- `advanceSpecToImplementing` calls the guard before any write
  (`packages/minspec/src/lib/spec.ts:785`). Two more callers exist: `approveSpec`
  (`packages/minspec/src/lib/approval.ts:553`) and the UI command
  (`packages/minspec/src/commands/approve.ts:318`, wired by #1806). The delegated-approval
  script calls it too (`scripts/lib/delegated-approval.ts:608`, then
  `advanceSpecToImplementing` at `:650`). `packages/minspec/tests/ownership-guard.test.ts:175` pins the
  refusal at the writer.

So the issue's Option 1 has shipped, in a different form from the one it proposed. It did
not move the tokenizers (`fmListField` / `rawFrontmatterField`) into a new module. It moved
the vocabulary out of `spec.ts` and put the guard in its own module.

**What remains is the "every actor" half of DQ-2.** The guarantee is enforced inside one
function, `advanceSpecToImplementing`. It is not enforced on the transition itself.
Inventory of production code that writes a `phases:` map (grep of `setSpecPhases(`,
`advancePhase(`, `skipPhase(`, `goBackToPhase(`, `writeEntry(`, `writeSpec(` over
`packages/minspec/src` and `scripts/`, 2026-11-23):

| Writer | Can it move `plan` out of `pending`? | Guarded? |
|---|---|---|
| `advanceSpecToImplementing` (`packages/minspec/src/lib/spec.ts:767`) | yes, via `phasesForApproval` | **yes** (`:785`) |
| `transitionPhase(…, 'advance' \| 'skip')` (`packages/minspec/src/lib/spec-manager.ts:597`; writes via `writeEntry` at `:646`) | **yes**. `advancePhase` from `clarify: in-progress` sets `clarify: done, plan: in-progress` (`packages/minspec/src/lib/lifecycle.ts:229` onward) | **no** |
| `closeOutSpec` (`packages/minspec/src/lib/spec-closeout.ts:102`, `setSpecPhases(f, { implement: 'done' })`) | no. It refuses unless every other phase is already closed (`:86-91`) | not needed |
| `archiveSpecById` (`packages/minspec/src/lib/spec-manager.ts:676`) | no. It sets the status to archived and keeps completed phases | not needed |
| `createSpec` / `migrateLayout` / spec-panel task toggle (`spec-manager.ts:483,781`, `packages/minspec/src/views/spec-panel.ts:171`) | no. They write initial phases, a re-layout, or task checkboxes (`toggleTask` reads `phases`, never writes it) | not needed |

`transitionPhase` has **no production caller today**. Its only callers are tests:
`features.test.ts`, `spec-manager.test.ts` and `text-round-trip.test.ts`. That is the same
"prospective gap" #1396 names. `transitionPhase` is the generic "advance this spec one
phase" API, so a future actor is most likely to reach for it: DR-057's drain consumers, or
the [SPEC-300](../SPEC-300-drain-sweep-phase-advance/requirements.md) phase-advance queue
consumer. Today it would advance an undeclared T3/T4 spec into Plan unchecked, and that
writes exactly the state SPEC-051 exists to prevent: `validateOwnership` armed at `error`,
and `main` red on a file the next PR never touched (#1323).

Nothing structural stops a new writer from repeating the omission either. The SPEC-051
T0 test pins the guard on the function that has it. Nothing fails when a function without
it appears.

## Functional requirements

- **FR-1 (placement is settled; keep it acyclic).** The shared guard stays in
  `ownership-advance-guard.ts`. Its edge to `./spec` stays type-only, and adding a caller
  MUST NOT add a runtime import cycle. A caller inside `src/lib/` that would close a cycle
  by importing the guard is a design defect to fix by moving the dependency, never by a lazy
  `require` that hides the cycle from `check-import-cycles.ts`. *Rationale: #1396's blocker
  is gone. This FR stops it coming back.*

- **FR-2 (every Plan-crossing writer calls the guard before its first write).** A
  production function that can persist a phase map in which `phases.plan` goes from
  `pending` (or absent) to `in-progress` or `done` MUST call the shared ownership guard
  before it writes any byte. That covers `transitionPhase`'s `advance` and `skip` actions.
  The guard is called only when the computed transition actually crosses Plan. A
  `back` transition or an advance inside the Specify band does not call it. *Rationale:
  SPEC-051 DQ-2, "fix the class, not today's actor".*

- **FR-3 (the guard judges the real target).** When a writer calls the guard, the guard
  MUST judge the phase map that writer is about to persist. It MUST NOT judge the
  approval target `phasesForApproval` would compute. Today
  `violationsIntroducedByApproval` (`packages/minspec/src/lib/spec-validator.ts:1210`) always simulates the
  approval target. How the guard learns the real target is D2.

- **FR-4 (refusal leaves the file untouched and is visible).** When the guard refuses,
  the spec file and any sharded siblings MUST be byte-unchanged, and the refusal MUST
  reach the caller with the guard's own message: the violation, its `fixHint`, and why
  fixing first is cheaper. It MUST NOT appear as a successful transition. How
  `transitionPhase` carries it is D1.

- **FR-5 (a structural witness for the class).** A deterministic, offline test MUST fail
  when a production function in `packages/minspec/src/` or `scripts/` gains the ability to
  write a Plan-crossing phase map without reaching the guard. Without it, FR-2 is a
  convention. The mechanism is D3. Whatever it is, it MUST carry a control: a fixture
  with a deliberately unguarded writer that the witness flags, so the witness cannot pass
  vacuously.

- **FR-6 (semantics inherited, not re-implemented).** Every new call site inherits the
  guard's existing properties unchanged. It respects config: a repo on the default
  `ownershipDeclaration: 'warn'` is never refused (SPEC-038 FR-7). It flags only newly
  introduced errors. It fails open on its own infrastructure, but loudly. No call site
  may re-implement the predicate (the #1520 / #1806 duplication shape).

## Acceptance criteria

- **AC-1 (FR-2, FR-4).** A T4 fixture spec with `clarify: in-progress`, no `implements:`,
  and `ownershipDeclaration: 'error'`: `transitionPhase(root, id, 'advance')` does not
  write. The file's bytes are identical before and after, and the caller receives the
  guard's message (form per D1).
- **AC-2 (FR-2).** The same fixture with a valid `implements:` declaration advances to
  `plan: in-progress` exactly as it does today. The existing `features.test.ts`,
  `spec-manager.test.ts` and `text-round-trip.test.ts` cases of `transitionPhase` stay
  green. Each fixture that would now be refused gets an `implements:` declaration or
  `ownershipDeclaration: 'warn'`. A fixture is never weakened by removing the assertion.
- **AC-3 (FR-2 scope).** `transitionPhase(…, 'back')`, and an `advance` from `specify` to
  `clarify`, do not call the guard. A spy, or an injected guard that throws, proves the
  guard was not reached.
- **AC-4 (FR-6).** Under `ownershipDeclaration: 'warn'`, the AC-1 fixture advances.
  A spec already at `plan: in-progress` and already undeclared is not newly refused.
- **AC-5 (FR-3).** For a `skip` from `clarify`, the guard is judged against the map
  `skipPhase` produces. A test pins a case where that map differs from
  `phasesForApproval(…)`, so a guard that silently fell back to the approval target fails.
- **AC-6 (FR-5).** The witness test passes on the post-change tree. It fails on a control
  fixture or mutation that adds an unguarded Plan-crossing writer. The run that shows the
  failure is recorded in the PR.
- **AC-7 (FR-1).** `tests/import-cycle-check.test.ts` "has ZERO runtime import cycles"
  stays green. `ownership-advance-guard.ts` still has no value import of `./spec`.

## Invariants this change must not break

- **INV-1 (zero runtime import cycles — SPEC-040).** No new runtime cycle, and no lazy
  `require` that hides one.
- **INV-2 (no silent gate — constitution invariant 2).** A refusal is never swallowed into
  a success result. A guard infrastructure failure degrades open and announces it, exactly
  as `assertOwnershipDeclaredForAdvance` does today. It never stops silently.
- **INV-3 (Tier-0, offline — constitution invariant 1).** Pure frontmatter and filesystem
  checks. No network, no LLM.
- **INV-4 (approval hash semantics unchanged).** No change to `canonical.ts`, nor to what
  an approval binds. This spec only adds refusals before writes.
- **INV-5 (single predicate — SPEC-051 INV-5).** One implementation of the refusal. The
  existing four call sites (UI command, `approveSpec`, `advanceSpecToImplementing`,
  delegated approval) keep calling the same function. If D2 introduces a generalised
  predicate, `violationsIntroducedByApproval` becomes a thin wrapper over it, never a copy.
- **INV-6 (advance path unchanged).** No change to `advanceSpecToImplementing`'s
  behaviour. Its flip-then-hash ordering (DR-003), the degenerate-block gate, and its
  status/phase sync assertion stay as they are.

## Out of scope

- Re-doing the module extraction #1396 proposed (moving `fmListField` /
  `rawFrontmatterField`). That is superseded by the #1446 vocabulary extraction. Plan
  re-opens it only if FR-1 cannot be met any other way.
- Building the DR-057 drain consumer or the SPEC-300 queue consumer. This spec makes the
  writer they will call safe. It does not write them.
- Changing which rules the guard arms, or the `warn`/`error` ratchet (SPEC-038 FR-7).
- Editing SPEC-051's design.md "Call sites" prose. See Follow-ups.

## Decisions needed (Clarify)

- **D1. What happens to `transitionPhase`, and how it reports a refusal.**
  - (a) **(rec)** Keep it, guard it, and report the refusal through its existing result
    contract: `{ success: false, warning: <guard message> }`, with no write. The function
    already returns `success: false` for "not found" and "no active phase", so callers
    already branch on it. Cost: a caller that ignores `success` never sees the refusal.
    The file is still untouched, so nothing is stranded, but the refusal can be quiet if
    a future caller is careless.
  - (b) Keep it, guard it, and let the guard's error throw. Cost: it breaks the function's
    documented "returns a result" shape, and every existing test caller must expect a
    throw on the refused path.
  - (c) Delete `transitionPhase`. It has no production caller. Cost: three test files
    lose their tool, and the first future actor that needs a generic advance rewrites it,
    probably without the guard, which is the exact gap DQ-2 wanted to close.
  **Recorded selection: the recommended option,** (a), keep `transitionPhase`, guard it, and report a refusal as `{ success: false, warning }` with no write. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-24; sign-off ratifies it.

- **D2. How the guard learns the real target (FR-3).**
  - (a) **(rec)** Add an optional `nextPhases` argument to
    `assertOwnershipDeclaredForAdvance`. Generalise the predicate to
    `violationsIntroducedByPhaseChange(spec, nextPhases, config, options)`, and make
    `violationsIntroducedByApproval` a one-line wrapper that passes
    `phasesForApproval(spec.frontmatter.phases)`. Existing callers pass nothing and are
    unchanged. Cost: it edits a `spec-validator.ts` export that four call sites depend
    on, so it needs a parity test that the wrapper returns the same results as before.
  - (b) Reuse the approval simulation for every caller. Cost: it judges a state the writer
    is not about to write. For `skip` and for partially-done maps it can pass a transition
    that arms an error, or refuse one that does not, which breaks FR-3.
  **Recorded selection: the recommended option,** (a), an optional `nextPhases` argument to `assertOwnershipDeclaredForAdvance`, with `violationsIntroducedByApproval` as a one-line wrapper. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-24; sign-off ratifies it.

- **D3. What the FR-5 witness is.**
  - (a) **(rec)** A source-scan test over `packages/minspec/src/**` and `scripts/**`. It
    finds every call to a phase-transition primitive (`setSpecPhases(`, `advancePhase(`,
    `skipPhase(`, `phasesForApproval(`) and requires each one to sit in a function on a
    reviewed allowlist. Each allowlist entry records either "calls the guard" (asserted by
    the test reading that function's body) or "cannot cross Plan" (with the reason, as in
    the Context table). An unlisted new call site fails with a message naming the guard.
    Cost: it is textual. A writer that builds a `phases` object literal by hand and
    serialises it through `writeSpec` evades it. The spec names that as the residual, and
    Plan should check whether a second pattern can cover `phases:` literals passed to a
    writer.
  - (b) Move the guard down into the write primitive: `setSpecPhases`, with
    `transitionPhase` rerouted through it. Every writer using the primitive is then guarded
    by construction. Cost: `setSpecPhases` changes from a pure line-level edit to one that
    reads config and runs the validator, and every caller pays for that (`closeOutSpec`
    included). `transitionPhase` currently writes through `writeEntry` because of sharded
    layouts (`spec-layout.ts`), so rerouting it risks the SPEC-095 round-trip guarantees.
    A hand-rolled `writeSpec` writer still evades it.
  - (c) The issue's Option 2: a test asserting that every `advanceSpecToImplementing`
    call site is preceded by the guard. Cost: it watches the one function already guarded
    internally and is blind to `transitionPhase`, the actual gap.
  **Recorded selection: the recommended option,** (a), a source-scan test over `packages/minspec/src/**` and `scripts/**` against a reviewed allowlist. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-24; sign-off ratifies it.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Guarding `transitionPhase` breaks existing test fixtures that advance an undeclared T3/T4 spec under `error`. | AC-2: fix each fixture by declaring ownership or setting `warn`. Never weaken the assertion. |
| R2 | The D3(a) witness passes vacuously, for example on a regex that matches nothing. | FR-5 / AC-6 control fixture. Count matches with the witness's own pattern, not `grep -c`. |
| R3 | D2(a) changes `violationsIntroducedByApproval`'s results for existing callers. | INV-5 parity test over the SPEC-051 fixture table before and after. |

## Follow-ups (tracked)

- SPEC-051 `design.md` §2 "Call sites" and `tasks.md` T4.2 still say the
  `advanceSpecToImplementing` guard "adds no coverage now". With `transitionPhase` guarded,
  that sentence stays true only of `advanceSpecToImplementing` itself. backlog: refresh
  SPEC-051 call-sites prose after SPEC-389 lands (not added: `docs/backlog.md` is outside
  this dispatch's file allowlist; the dispatch summary asks for the line).
- #1396 itself: its stated blocker (the cycle) is resolved on main by #1446/#1806. This spec
  is what remains of it. No new issue needed.
