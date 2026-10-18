---
id: SPEC-141
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - the gates that decide when a spec may be approved
aspects: [validator, approval, lifecycle, flat-layout, no-silent-gate, tier-0, offline, rcdd]
depends_on: [DR-012, DR-034]  # DR-012 owns the completeness floor this spec re-times; DR-034 the approval records and derived status it reads
relates_to: [SPEC-022, SPEC-038, SPEC-051, DR-003, DR-033, DR-069, DR-076, "#1852", "#1317", "#1806", "#37", "#109", "#111"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). One NEW file is
# owned here: the regression tests for the phase-aware rule (flat-layout fixtures, the
# terminal floor, the approval evaluation and the mutation pairs). Modified, not owned:
# spec-validator.ts holds the rule; approve.ts holds the refusal; validate-frontmatter.ts is
# where OQ-2 Option A re-asserts the floor in CI (review machinery - see FR-9).
implements: [packages/minspec/tests/spec-validator-phase-due.test.ts]
affects: [packages/minspec/src/lib/spec-validator.ts, packages/minspec/src/commands/approve.ts, scripts/validate-frontmatter.ts]
phases:
  specify: done
  clarify: done
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-141: A required phase section is checked when its phase is due, not before

Triggered by: issue 1852 (flat-layout T3/T4 spec is unapprovable until Plan, Tasks and
Implement are written). Rests on DR-012 (hard-to-skip HITL spec gate - the completeness
floor) and DR-034 (approval records and derived status). No new decision record: see
"Decisions recorded by an agent", item 2.

## In plain terms

In a single-file ("flat") spec, MinSpec refuses to approve a T3 or T4 spec until its
`## Plan`, `## Tasks` and `## Implement` sections are written. But approval is the step that
lets Plan begin. So the human's one sign-off can only happen after the work it was meant to
authorise.

With this spec, a required section is only demanded once its phase is due: Specify and
Clarify at approval, Plan once Tasks or Implement has started, and every section once the
spec is done. A finished spec with an empty `## Implement` is still refused, as today.

Cost: in a flat spec the approval covers the whole file, so writing `## Plan` after approval
makes the approval stale and asks for a second read (OQ-1). Left out: the same early demand
for mockups, schemas and diagrams (OQ-3). Riskiest assumption: that a repo-wide check in CI
is enough to hold the floor at `done`, given no command moves a spec to `done` (OQ-2).

## Context

**The rule.** `validateSpec` walks `config.phaseMappings[tier].requiredPhases` and flags
every missing or empty `## <Phase>` section as `section.<phase>.empty`, at error severity for
T3/T4 and warning for T2 (`packages/minspec/src/lib/spec-validator.ts:1268-1283`). It reads
only the section bodies, never `phases:`. For T4 the required set is all five phases, for T3
it is specify, plan, tasks and implement (`packages/minspec/src/lib/config.ts:159-160`).
`complete` is "zero error-severity violations" (`spec-validator.ts:49-50`, computed at
`:1338`).

**The refusal.** The Approve Spec command calls `validateSpec` and, when `!complete`, shows a
modal whose only button is "Open Spec", then returns (`packages/minspec/src/commands/approve.ts:273-299`).
This is the only place approval checks completeness: `validateSpec` is called from
`approve.ts:274` and `validate.ts:58` and nowhere else outside tests, plus indirectly by the
advance guard below (grep over `packages/` and `scripts/`, 2026-10-18).

**Where approval sits.** A first approval advances the phase map with `phasesForApproval`:
specify and clarify become `done`, and the first unfinished of plan, tasks, implement becomes
`in-progress` (`packages/minspec/src/lib/lifecycle.ts:199-210`, called from
`advanceSpecToImplementing`, `packages/minspec/src/lib/spec.ts:766-795`). Approval is the
Clarify-to-Plan boundary.

**Why this repo never saw it.** The rule is skipped for any file whose `type:` is
`requirements`, `design` or `tasks` (`spec-validator.ts:1266-1269`). Measured at `418515d8`:
136 spec files carry an `id: SPEC-` line; the 3 without `type:` (SPEC-039 requirements.md and
design.md, SPEC-050 design.md) are all T2, where the rule only warns. No T3/T4 spec in this
repo is subject to the error. The defect fires only in adopter repos that use flat specs.
The issue reproduced it against `AIClarityAU/voip-sms-inbox` `specs/SPEC-004-canary.md`
(T4): before its plan landed, `complete: false` with `section.plan.empty`,
`section.tasks.empty` and `section.implement.empty` as errors.

**Root cause (RCDD, DR-003).** Mechanism: a terminal-completeness rule (DR-012 built it so a
T3/T4 spec cannot reach implement without its artifacts, `docs/decisions/DR-012.md:53-64`,
`:89-90`) is evaluated at the entry gate, with no notion of which phases are due. Missing
gate: nothing tests the rule against a flat T3/T4 spec at the Clarify-to-Plan boundary, and
the dogfooding corpus cannot exercise it (above). Same family as DR-003 Phase 4's validator
asymmetry: the rule asks whether a section exists, never whether it is yet due.

**The advance guard.** `violationsIntroducedByApproval` re-runs `validateSpec` on the phase
map approval would write and refuses on any error the advance newly introduces
(`spec-validator.ts:1126-1155`); `assertOwnershipDeclaredForAdvance` wraps it and fails open
on its own infrastructure errors (`packages/minspec/src/lib/ownership-advance-guard.ts:66-110`).
A phase-aware rule changes what that diff sees, so the definition of "due" below is chosen to
keep it quiet when a plan merely becomes `in-progress`.

**No command moves a spec to `done`.** `transitionPhase` (`packages/minspec/src/lib/spec-manager.ts:517`)
has no caller in `packages/minspec/src` (grep, 2026-10-18). Phases past approval are moved by
hand or by an agent editing frontmatter. So there is no "implement to done" transition for a
second check to hook onto; the floor at `done` can only be re-asserted by a validator that
reads the files (OQ-2).

**The approval hash covers the whole body.** `canonicalizeSpec` removes only `status` and
`phases` from the frontmatter; every body byte, every `## Phase` section included, is hashed
(`packages/shared/src/canonical.ts:9-26`). In a flat spec, any edit to `## Plan` after approval
stales it (OQ-1). Split layout does not have this effect, because the plan lives in a
different file.

## Terms

- **Flat spec** - a single-file spec: its `type:` is absent or not one of `requirements`,
  `design`, `tasks`. The rule in this spec applies only to flat specs, exactly as today.
- **Required phase** - a phase in `config.phaseMappings[tier].requiredPhases`.
- **Started** - a phase whose status is `in-progress`, `done` or `skipped`.
- **Due** - a required phase P is due when P is `done` or `skipped`, or when any phase after P
  in the order specify, clarify, plan, tasks, implement is started. A phase that is merely
  `in-progress`, with nothing after it started, is being written and is not due.
- **Evaluation map** - the phase map dueness is computed from (FR-4, FR-5).

## Requirements

### A. Dueness

- **FR-1** The required-section rule decides dueness from the evaluation map using the
  definition in Terms. It is a pure function of (tier, config, evaluation map, parsed
  sections): no filesystem, no network, no clock.
- **FR-2** A due required phase whose section is missing or empty yields the existing
  violation, unchanged: rule id `section.<phase>.empty`, error for T3/T4, warning for T2. The
  rule ids stay the same so every consumer that keys on them keeps working.
- **FR-3** A required phase that is not due yields no `section.<phase>.empty` violation of any
  severity (OQ-4 records the warning alternative).
- **FR-4** Outside approval, the evaluation map is the spec's own parsed `phases:` (absent
  phases parse as `pending`, `packages/minspec/src/lib/spec.ts:324-330`).
- **FR-5** At approval, the evaluation map is `phasesForApproval(current phases)`, the state
  approval writes or confirms. So at the Clarify-to-Plan boundary Specify is due, Clarify is
  due when the tier requires it (T4), and Plan, Tasks and Implement are not. This holds when
  the spec has no `phases:` block at all, which today parses as all-pending and would
  otherwise make nothing due.
- **FR-6** FR-5 is enforced inside the approve command's own completeness refusal
  (`approve.ts:273-299`), not only through the advance guard. The guard fails open on its own
  errors by design; the Specify and Clarify floor must not depend on it (constitution
  invariant 2).

### B. The floor at the end

- **FR-7** A spec whose implement phase is `done` or `skipped` has every required phase due
  by FR-1, so an empty `## Implement`, `## Tasks` or `## Plan` on a finished flat T3/T4 spec
  is an error, as DR-012 requires.
- **FR-8** A spec whose implement phase has started has plan and tasks due, so a flat T3/T4
  spec cannot be implementing with an empty `## Plan` or `## Tasks` and validate clean. This
  is DR-012's "cannot reach implement without its artifacts" moved to the point where
  implement begins.
- **FR-9** (Under OQ-2 Option A.) `scripts/validate-frontmatter.ts` runs the phase-aware
  section rule over every flat spec, using FR-4's evaluation map, and fails on any error. It
  must call the same exported function the validator uses, not a copy (the #1520 / #1806
  duplication shape). This script is review machinery; the pull request that changes it goes
  through the machinery path.

### C. The advance guard and messages

- **FR-10** `violationsIntroducedByApproval` introduces no `section.*.empty` error when
  approval moves plan (or tasks, or implement) to `in-progress`: by the definition of due, an
  `in-progress` phase with nothing after it started is not due.
- **FR-11** The refusal and the fix hint for a due section say why it is due, naming the
  phase state that made it so (for example "Implement is in-progress, so Plan must be
  written"), instead of today's "T4 requires the Specify, Clarify, Plan, Tasks, Implement
  phases" (`spec-validator.ts:1279`).

### D. Boundaries - what does not change

- **FR-12** Split-layout files keep the skip (`spec-validator.ts:1266-1269`) and the
  directory coverage check stays a warning (`validateSplitLayoutCoverage`,
  `spec-validator.ts:1425`).
- **FR-13** The acceptance-criteria rule (`checkAcceptanceCriteria`, `spec-validator.ts:1289`)
  is unchanged: acceptance criteria are a Specify-phase artifact and are correctly due at
  approval.
- **FR-14** The aspect-artifact rules (mockup, schema, diagram; `spec-validator.ts:1298-1318`)
  are unchanged by this spec (OQ-3).
- **FR-15** No change to the approval hash, the canonical form or its Python twin, the
  approval sidecar schema, or the phase-advance writers. No per-phase approval.
- **FR-16** A required phase that is `skipped` keeps today's behaviour: it is due, so an empty
  section for it is still flagged. Whether a required phase may be skipped is not this
  spec's question.

## Acceptance criteria

All on parsed fixtures through the real `validateSpec` and `violationsIntroducedByApproval`,
with the default config's `phaseMappings`. No fixture declares `type:`.

- [ ] **AC-1** (the issue's regression) A flat T4 fixture with only `## Specify` and
  `## Clarify` written and `phases: {specify: done, clarify: done, plan: pending, tasks:
  pending, implement: pending}` returns `complete: true` and no `section.*` violation.
- [ ] **AC-2** (the DR-012 floor) The same fixture with every phase `done`, Plan and Tasks
  written and `## Implement` empty returns `complete: false` with exactly one
  `section.implement.empty` at error severity.
- [ ] **AC-3** Approval on the AC-1 fixture, through the approve command's completeness path
  with FR-5's evaluation map, is not refused; `violationsIntroducedByApproval` on it returns
  no `section.*` violation (FR-10).
- [ ] **AC-4** A flat T4 fixture with no `phases:` block and an empty `## Clarify` is refused
  at approval naming `section.clarify.empty`; with an empty `## Specify`, naming
  `section.specify.empty` (FR-5). Without FR-5 both would pass, because all-pending makes
  nothing due.
- [ ] **AC-5** A flat T3 fixture with `implement: in-progress` and an empty `## Tasks` returns
  `section.tasks.empty` at error severity (FR-8).
- [ ] **AC-6** A flat T3 fixture with `plan: in-progress`, nothing later started and an empty
  `## Plan` returns no `section.plan.empty` (in-progress is not due).
- [ ] **AC-7** A flat T2 fixture with `plan: pending` and an empty `## Plan` returns no
  violation; with `plan: done` it returns `section.plan.empty` at warning severity.
- [ ] **AC-8** A `type: requirements` T4 fixture returns no `section.*` violation under every
  phase map used above (FR-12).
- [ ] **AC-9** A flat T4 fixture with `clarify: skipped` and an empty `## Clarify` still
  returns `section.clarify.empty` (FR-16).
- [ ] **AC-10** The refusal message for AC-5 names the phase state that made Tasks due
  (FR-11).
- [ ] **AC-11** (Under OQ-2 Option A.) `validate-frontmatter` on this repository reports no
  new error (the untyped T3/T4 count was 0 at `418515d8`); on a fixture tree holding the AC-2
  file it exits non-zero and names that file and `section.implement.empty`.
- [ ] **AC-12** Mutation pairs, each paired with the test that must fail: treating
  `in-progress` as due fails AC-1's approval half (AC-3); ignoring dueness (today's code)
  fails AC-1; ignoring "a later phase started" fails AC-5; evaluating approval on the
  pre-approval map instead of FR-5's fails AC-4.

## Invariants this must not break

- **Constitution 1 (offline).** The rule stays pure and Tier-0; no network.
- **Constitution 2 (no silent gate).** The floor at approval is enforced in the command's own
  refusal (FR-6), not only through a guard that fails open; the floor at `done` fails visibly
  wherever it is checked (FR-7, FR-9). A not-yet-due section is not a skipped gate: the
  requirement does not apply yet, and it applies the moment the phase is due.
- **Constitution 3 (blast radius).** Only MinSpec projects run the validator; nothing here
  reaches a repo without `.minspec/`.
- **DR-012.** Approval still refuses an incomplete spec; a finished T3/T4 spec still needs
  every required section. What moves is when each section is demanded.
- **DR-076.** The one human checkpoint kept for T3/T4, reading the spec before it is built,
  now happens before Plan, as `phasesForApproval` already assumes.
- **SPEC-022 / DR-034.** The hash, canonical form and derived status are untouched (FR-15).

## Limitations, stated plainly

- **Adopter repos have no repo-wide check.** The CI script in FR-9 runs in this repository;
  the spec-gate was never shipped to adopters (issue 37). In an adopter repo, a flat T4 spec
  hand-edited to `implement: done` with an empty `## Implement` is flagged by the Validate
  Spec command and by any later re-approval, but nothing refuses the edit itself. Today the
  same repo checks every section once, at approval, before Plan exists, so this spec moves
  that check later rather than removing one that runs at `done`.
- **Hand edits to `phases:` are trusted.** Dueness reads `phases:`. A spec that writes
  `plan: pending` while its Implement is under way is judged by what it says; that is true of
  every phase-gated rule today (ownership, implement evidence).
- **Approval paths other than the command.** Only `approve.ts` checks completeness today
  (Context). Other writers of approval records reach only the advance guard; this spec does
  not add completeness checks to them.

## Decisions recorded by an agent (ratified only by approval of this spec)

Under this repository's `act` autonomy the agent chose these; the rejected alternatives are
here because nobody saw them live (DR-086 section 4).

1. **Phase-aware rule, the issue's recommended option.** Rejected: per-phase approvals (needs
   per-section hashing, a sidecar schema change and a migration of every approval; the
   largest option, and OQ-1 shows the flat layout gets a plan checkpoint anyway); scaffolding
   empty phase stubs at Specify (turns a refusal into a signature over placeholder text).
2. **No new decision record.** The change is a validator rule and one command's evaluation
   map, revertible in under a day, so the decision-record filter (a record only for a
   choice that cannot be undone in under a day) does not require one. DR-012's text
   ("Required-phase sections ... must be non-empty", `docs/decisions/DR-012.md:55`) becomes
   imprecise; a dated amendment to DR-012 belongs to this spec's Implement phase, so the
   record matches the code that ships. If OQ-1 selects Option B, that is a hashing change
   and does need its own decision record.
3. **"Due" excludes `in-progress`.** Rejected: due at `in-progress`. Approval writes
   `plan: in-progress`, so the advance guard would refuse every flat T3/T4 approval with an
   empty Plan, re-creating the bug one step later (FR-10, AC-3).
4. **A new spec, not an amendment.** SPEC-022 owns the hash and SPEC-038 the ownership rule;
   neither owns the completeness rule, which DR-012 introduced without a spec.

## Decisions needed (Clarify)

Each question names the option this document recommends and what that option costs. The
requirements above read as the recommended answers; each question says what changes under
the others. None is irreversible or a spend, except OQ-1 Option B (a hash change).

### OQ-1 - In a flat spec, writing `## Plan` after approval stales the approval. Accept that?

The approval hash covers the whole body (`packages/shared/src/canonical.ts:9-26`). Today a
flat T3/T4 spec is approved once, with Plan, Tasks and Implement already written. After this
spec, it is approved at Clarify-to-Plan; the moment the plan is written the approval is stale
and the spec derives `specifying` again until re-approved.

- **A (rec) Accept it, and say so at approval.** The re-approval after Plan is the plan
  checkpoint the issue argues for (a human reads "how I will delete your messages" before it
  is built). The approval toast for a flat T3/T4 spec says that writing Plan will need a
  second approval. *Cost:* a flat T3/T4 spec now takes two full reads instead of one, and
  every later edit to Tasks or Implement stales it too, as it already does today during
  implementation.
- **B Hash only the sections due at approval.** One approval stays valid while Plan is
  written. *Cost:* a change to the canonical form and its Python twin, every existing flat
  approval goes stale on upgrade unless the hash is versioned, and it needs a decision record.
  The plan would then never be read by a human in flat layout.
- **C Leave it undocumented.** *Cost:* the user meets an unexplained "stale approval" right
  after approving, the same never-wrong failure this spec exists to remove.

**Recorded selection:** A.

### OQ-2 - Where is the floor at `done` re-asserted?

No command moves a spec to `done` (Context), so there is no transition to hook a check onto.

- **A (rec) In CI, through `validate-frontmatter` (FR-9), plus the Validate Spec command.**
  *Cost:* changes review machinery, so its pull request needs the machinery path; and it
  covers only repositories that run this script, which adopters do not (issue 37).
- **B Also add a check to every writer of `phases:` in the extension.** *Cost:* the writers
  that move a spec past approval are frontmatter edits by people and agents, not extension
  code, so this covers almost nothing that A does not.
- **C Validate Spec command only.** *Cost:* in this repository a flat T3/T4 spec could reach
  `done` with an empty section and no failure anywhere; today there are none, but nothing
  would stop the first.

**Recorded selection:** A.

### OQ-3 - The mockup, schema and diagram rules have the same early demand. Fix them here?

The aspect-artifact rules run at T3/T4 error severity on every flat spec regardless of phase
(`spec-validator.ts:380-384`, `:1303-1318`). A flat T4 spec that declares a UX surface is
therefore also unapprovable at Clarify-to-Plan without a mockup.

- **A (rec) Leave them out of this spec; track them as their own issue.** *Cost:* flat T3/T4
  specs that declare `ux`, `api`, `data` or `architecture` stay unapprovable before design
  until that issue lands. A mockup is often part of the requirements a human should read,
  so whether it is a Specify or a Plan artifact deserves its own decision. The follow-up
  issue must be filed when this spec is approved (it is not filed yet; this dispatch has no
  issue-filing permission).
- **B Make them phase-aware here, due with Plan.** *Cost:* widens this spec past the issue,
  and moves mockups out of what the human reads at approval.

**Recorded selection:** A.

### OQ-4 - Say anything about a not-yet-due section?

- **A (rec) Nothing (FR-3).** The `phases:` map and the spec tree already show which phases
  are pending. *Cost:* the Validate Spec output no longer lists what remains to be written.
- **B A warning, new rule id `section.<phase>.not-due`.** Mirrors the split-layout coverage
  warning (issue 111). *Cost:* every T3/T4 flat spec in Specify carries two or three
  warnings that ask for nothing, and the approval toast reports them as advisory warnings.

**Recorded selection:** A.

## Follow-ups (tracked)

- The aspect-artifact rules under OQ-3 Option A: an issue to be filed at approval of this
  spec. Not yet filed (this dispatch may not file issues); it must carry a number before this
  spec leaves Clarify.
- DR-012 amendment (decision item 2): part of this spec's Implement phase.

## Traceability

- Triggered by: issue 1852.
- Rests on: DR-012 (completeness floor), DR-034 (approval records, derived status), DR-076
  (solo-mode HITL keep-list), DR-003 Phase 4 (validator asymmetry), DR-033 (consequence-hybrid
  checkpoints).
- Adjacent, not covered: issue 37 (spec-gate never shipped to adopters), issue 109
  (heading-name phase detection), issue 111 (split-layout coverage), issues 1317 and 1806
  (the advance guard).
