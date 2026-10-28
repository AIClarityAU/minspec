---
id: SPEC-263
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a reporting surface must not name a violation the writing side can create
aspects: [approve, gate, depends-on, clarify, no-silent-gate, offline]
depends_on: []
relates_to: [SPEC-012, "#2649", "#2375", "#1806", "#1317", "DR-012", "DR-056"]
implements: none
implements_reason: >-
  Specify phase only. File ownership is decided at Plan, after Decisions D1-D4 are answered.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-263: Approve Spec refuses an open Clarify question and an uncleared dependency

> **This is a SPECIFICATION ONLY.** Written for issue #2649. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

Approve Spec is the one human gate on a T3/T4 spec. A replay on 2026-10-09 showed it accepts
(1) a spec with a Clarify question that has no recorded answer, and (2) a spec whose
`depends_on` target is not yet cleared (SPEC-135 over SPEC-060). In case (2) the status
signpost then calls the result a gate violation (`depends_on.uncleared`) - a state Approve itself
created. The rule exists on the reporting side and not on the writing side, so the order the
signpost asks for is advice, not a gate.

## Measured state (this base)

Read from code, not inferred:

- The signpost predicate: `packages/shared/src/next-task.ts:622-634` (`unclearedDependsOn`)
  collects `depends_on` edges whose target exists and fails `gateCleared`
  (`:271-284`): a spec target is cleared only when `approvalState === 'approved'` or the spec is
  terminal (`isSpecTerminal`). The violation node is emitted at `:695-730` only when the source
  is "advancing" (`isAdvancing`, `:648-659`: `implementing` or `done`). A merely-pending source
  is floored in rank, not flagged.
- `packages/minspec/src/commands/approve.ts` runs, before any write: the opt-in check, spec
  pick filter, `validateSpec` (`:268-296`), `assertOwnershipDeclaredForAdvance` (`:318`, shared
  with `approval.ts:580` and `spec.ts:784`), and the approver check (`:344`). None evaluates
  `depends_on` clearance or Clarify completeness.
- The shared advance guard is the established single enforcement point (#1806): UI,
  `approveSpec`, and `advanceSpecToImplementing` all call it. A new refusal belongs there or
  beside it, not inline in `approve.ts`.
- `grep` of `spec-validator.ts` finds no rule that inspects Clarify question state; "Clarify
  complete" today is only the `phases.clarify` map value, which `approve` itself advances.
- **Not verified here:** how a Clarify question and its "recorded selection" are represented in
  spec text (the filer's `CQ` heading); whether a `depends_on` naming a nonexistent spec is
  accepted (the resolver treats danglers as corruption, `next-task.ts:621`). FR-1 settles both.

## Root cause (mechanism)

A rule is defined once on the read side (signpost) and not at the write side that can violate it.
Approve validates the state a spec is *leaving* and (since #1806) one class of state it *creates*
(ownership), but has no check for the other two states it can create: "clarify done with open
questions" and "advancing while a dependency is uncleared". The missing gate is the point;
editing SPEC-135/SPEC-060 content would repeat the #2370 pattern (fix the instance, leave the gate).

## Functional requirements

- **FR-1 Reproduce first.** Before any change, tests reproduce both accepts against the shipped
  `approveSpec` path (fixture: a spec with an unanswered CQ and `clarify: pending`; a spec
  `depends_on` a `specifying`/stale spec) and a third probe: `depends_on` naming a nonexistent
  id. The spec records what each did.
- **FR-2 Refuse an open Clarify question.** Approve refuses, before any write, a spec containing
  a Clarify question with no recorded selection. The refusal names each open question and says
  how to resolve it. Representation of "open" and "recorded": D1.
- **FR-3 Refuse an uncleared dependency.** Approve refuses, before any write, a spec whose
  `depends_on` contains a resolving target that is not cleared. The refusal names each blocker
  and its state (e.g. "SPEC-060 is specifying/stale").
- **FR-4 One predicate, not two.** FR-3 uses the signpost's own clearance definition
  (`gateCleared` / `unclearedDependsOn`), exported from `@aiclarity/shared` and called by both
  surfaces. A second copy of the rule is a defect (the #1520/#1806 drift class). A test pins that
  the signpost and Approve agree on a table of dependency states.
- **FR-5 Dangling dependency.** A `depends_on` naming a nonexistent spec is handled per D2; it
  must be visible either way, never silently accepted.
- **FR-6 Single enforcement point.** The new checks are reached from every actor that crosses a
  spec into approval (UI command, `approveSpec`, `approval.ts`, `advanceSpecToImplementing`),
  via the shared advance guard or an equally shared function; not inline in `approve.ts` only.
- **FR-7 Refuse before write.** Both refusals precede the status flip and approval record, so a
  refused spec is byte-identical on disk afterwards (no `planning` status, no record).
- **FR-8 Visible refusal.** Each refusal is a modal error with an "Open Spec" action, same shape
  as the existing refusals; the failure to *evaluate* (unreadable graph, parse error) also
  refuses visibly and never passes (constitution invariant 2).
- **FR-9 Offline and deterministic.** No network or model call; same workspace bytes give the
  same verdict.
- **FR-10 Already-approved and terminal specs unaffected.** Re-approval of a stale spec is
  checked like a first approval; terminal specs remain off the picker.

## Acceptance criteria

- **AC-1** Spec with an open CQ -> Approve refuses; spec file and approvals store unchanged.
- **AC-2** Same spec with the CQ's selection recorded -> Approve proceeds.
- **AC-3** SPEC-A `depends_on` SPEC-B (specifying, or approved-but-stale) -> refused naming SPEC-B
  and its state; once SPEC-B is approved or terminal -> proceeds.
- **AC-4** Table test: for each dependency state, `unclearedDependsOn` and the Approve check
  return the same answer (FR-4). Mutating `gateCleared` flips both.
- **AC-5** A dangling `depends_on` follows the D2 outcome with a named message.
- **AC-6** Each refusal has a T0 test (the issue asks for one per refusal); each also fails
  against the pre-change base (reproduce-red, then green).
- **AC-7** Each of the four actors in FR-6 refuses; a test enters through at least the lib
  entry points, not only the command.
- **AC-8** After the change, Approve cannot produce a `depends_on.uncleared` violation on a spec
  it just approved (property check over the fixture set).

## Invariants this change must not break

- Constitution invariant 2 (no silent gate): refusals and evaluation failures are visible.
- Invariant 1 (offline) and 3 (blast radius): reads only the opted-in repo.
- DR-056: approver-identity check stays and still runs; order relative to new checks is
  irrelevant to the outcome but refusals must precede any write.
- DR-012 approve-before-implement; #1806 single enforcement point; #440 terminal specs off-picker.
- SPEC-012 determinism and the signpost's output for existing fixtures (no behaviour change on
  the read side beyond sharing the predicate).

## Decisions needed (Clarify)

- **D1 - what is an "open Clarify question"?** (a) A `CQ<n>` heading/row with no selection line
  in the spec body **(rec)** - matches the filer's probe and needs no new field; costs a
  text-convention parser that can miss a question written in a different shape. (b) Structured
  frontmatter list of questions with `selected:`; robust, but a new schema and migration of
  existing specs. (c) Only the `## Decisions needed (Clarify)` heading present = open; trivial,
  but blocks specs that keep the heading after answering.
- **D2 - dangling `depends_on`.** (a) Refuse **(rec)** - a dependency that cannot be cleared is
  not cleared; costs blocking a spec whose target was renamed until its ref is fixed. (b) Warn
  only; costs another silent-ish accept of the very class this spec closes.
- **D3 - is the refusal waivable?** (a) Hard refuse, no override **(rec)** - the point is a
  gate, not advice; costs a founder who truly wants out-of-order approval must edit
  `depends_on` first (visible in the diff). (b) Founder override flag; costs a new bypass to
  keep honest and audit.
- **D4 - which dependency states block?** (a) Exactly the signpost's definition: not approved
  and not terminal **(rec)** - one definition, per FR-4; costs a stale-approved dependency
  counting as uncleared, which matches SPEC-135/SPEC-060 as measured. (b) Looser (any
  approval record); costs diverging from the signpost.

## Out of scope

- Phase-completeness detection letting incomplete specs be approved (#2375 owns it).
- Changing the signpost's ranking, flooring, or when it emits `depends_on.uncleared`.
- Editing SPEC-135/SPEC-060 content.
- Retroactively un-approving specs already approved out of order.
