---
id: SPEC-320
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - lifecycle/phase state and the spec-gate
aspects: [clarify, phases, spec-gate, validator, fail-closed, lifecycle]
depends_on: []
relates_to: ["#3414", "#3375", "#3104", "#3102", "#3234", "#3239", "DR-069", "SPEC-210"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan. Expected surface:
  `packages/minspec/src/lib/slash-commands.ts`, `.claude/commands/minspec-clarify.md`,
  `packages/minspec/src/lib/spec-validator.ts`, and tests. None of it is claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-320: The Clarify command must not write `clarify: done` on an unapproved spec, and a validator refuses that state

> **This is a SPECIFICATION ONLY.** Written for issue
> [#3414](https://github.com/AIClarityAU/minspec/issues/3414). Nothing is built until this spec is
> approved and the [Decisions needed (Clarify)](#decisions-needed-clarify) are resolved.

## Problem

The shipped Clarify command (`packages/minspec/src/lib/slash-commands.ts:147`, mirrored in
`.claude/commands/minspec-clarify.md`) tells an agent to set `phases.clarify: done` when the last
open question is recorded. On a spec with `specify: done` that makes the first pending phase
`plan`; `_current_phase` (`scripts/hooks/spec-gate.py:210`) returns `plan`, and the gate reads the
spec as in its implementing band. The freeze starts when the pull request merges. Nothing refuses
the pull request: `validateSpec` (`packages/minspec/src/lib/spec-validator.ts`) has no rule that
compares a spec's phases with its approval, so `validate-frontmatter` passes.

Measured by the issue on main `5d524f96` (reported, not re-measured here): 0 unapproved specs
block on main; #3083 had four specs (16 files flipped allow to deny), #3399 three, #3181 two.
SPEC-207 on main carries the armed-later shape today.

Root cause (from the issue): #3375 added the `clarify: done` instruction to serve a field check
proposed in #3104, but that check does not exist on main (`scripts/lib/clarify-open.ts` reads the
body only); and no gate rejects the resulting state. Two defects: a writer, and a missing gate.

Scope boundary: #3234 / #3239 (spec-gate reach, `affects:` versus `implements:`) own the hook's
reach. This spec owns only the writer and the pre-merge refusal.

## Functional requirements

- **FR1.** The Clarify command text (both the `slash-commands.ts` source and the generated
  `.claude/commands/minspec-clarify.md`) MUST NOT instruct setting `phases.clarify: done` (or
  `skipped`) on a spec that has no current approval. It states that answers live in the body and
  that `clarify` stays as it was until approval.
- **FR2.** `validateSpec` MUST raise an **error** for a T3/T4 spec with no current approval whose
  `phases` make `phase_intent_status` (mirrored by `getSpecStatus`) return `implementing` or
  `done`. The message names the offending phases and states the fix.
- **FR3.** The rule MUST share one derivation with the gate's phase reading (no third copy of the
  predicate); a test pins the validator and `scripts/hooks/spec-gate.py` to the same verdict over
  a table of phase maps.
- **FR4.** An approved spec (current approval, hash matching) is exempt; `phasesForApproval`
  (`lifecycle.ts:199`) continues to write `clarify: done` at approval.
- **FR5.** A stale approval is the same state by another route. Before the rule is made blocking,
  a survey over `specs/**` lists every existing spec that would fail it; the Plan fixes or
  grandfathers each explicitly. No silent exemption list.
- **FR6.** The rule fails closed: a spec whose approval cannot be read errors rather than passing.
- **FR7.** Option A also drops the `clarify: done` field check from #3104's scope (comment on
  #3104 is a Plan task; this spec does not edit issues).

## Acceptance criteria

1. Clarify command text contains no `clarify: done` instruction for unapproved specs; a test
   asserts the generated text.
2. A fixture spec `tier: T3`, unapproved, `specify: done, clarify: done, plan: pending` fails
   `validateSpec`; the same fixture with `clarify: pending` passes; the same with a valid approval
   passes.
3. `specify: in-progress, clarify: done` (arms later) is covered per the Decisions section.
4. `validate-frontmatter` on main passes after the survey outcome from FR5 is applied.
5. Mutation check: reverting the rule makes AC2 fail.

## Invariants this must not break

- Invariant 2 (no silent gate): the new rule is blocking, with no `|| true` and no skip on
  unreadable input.
- DR-069 section 3: the gate's freeze range is not narrowed by this spec.
- Invariant 3: nothing changes outside repos with `.minspec/`.
- Invariant 1: no network calls.

## Out of scope

Hook reach (#3234 / #3239); a `clarify` open-question body check (#3104); #3102's asymmetry.

## Decisions needed (Clarify)

1. **Writer: Option A or B?**
   - **A (rec):** remove the instruction, add the validator rule, drop the field check from
     #3104. Cost: `phases.clarify` reads `pending` on answered specs until approval, so a sidebar
     or next-task view names Clarify as current, and #3102's asymmetry stays open with body text
     as the only witness.
   - **B:** keep the instruction; make the gate treat `specify: done, clarify: done, plan:
     pending` as specifying. Cost: changes the freeze range DR-069 section 3 says not to narrow;
     needs a decision record.
2. **Does the rule also refuse the arms-later shape** (`specify: in-progress, clarify: done`)?
   Rec: yes, since `advancePhase` converts it to the armed state; cost: more existing specs fail
   the survey (FR5). Alternative: only the shapes already returning `implementing`/`done`.
3. **Stale-approval specs found by the survey:** fix each in this change (rec; cost: touches many
   spec files, each a hash-sensitive edit) or grandfather by dated allowlist (cost: a standing
   exemption that can drift).
