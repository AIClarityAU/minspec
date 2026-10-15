---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - the Specify phase guidance a spec author follows
aspects: [specify, invariants, guidance, methodology, tier-0, offline]
depends_on: []
relates_to: [DR-001, DR-003, DR-019, DR-014, DR-023, SPEC-134, "#295", "#269", "#270", "#228", "#245", "#534"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3).
# No new files are owned: this is a guidance-text change to existing files.
implements: []
# Modified, not owned. slash-commands.ts is the single source of the shipped /minspec-specify
# body (the repo-local .claude/commands/minspec-specify.md is its generated managed block);
# the test file pins the new guidance.
affects: [packages/minspec/src/lib/slash-commands.ts, .claude/commands/minspec-specify.md]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Event Storm - a named technique for discovering a T3/T4 spec's invariants

## In plain terms

Authors are told to declare invariants and never to break them, but not how to find the ones
their own change introduces, so `## Invariants` stays blank or shallow. We add one named
technique to the Specify guidance: for T3/T4, walk the feature's events in order and record,
per event, trigger / data produced / data consumed / side effects / invariants. The agent
does the walk; the human confirms the invariants. Cost: a longer Specify prompt and one more
confirmation for T3/T4 authors. Left out: any UI, any auto-detection, any enforcement.
Riskiest assumption: agents produce a real event walk rather than padding one.

Issue: #295. Source: the CDD playbook "Phase 1: Event Storm" (mmo-platform
`docs/contract-driven-development.md`, outside this repo - the method is restated in FR-2 so
no reader depends on that link).

## Context

- The `## Invariants` section of a spec (`specs/minspec/requirements.md:190`) and the
  constitution's `## Invariants` exist, but the shipped Specify guidance
  (`packages/minspec/src/lib/slash-commands.ts`, `specify` entry) only says "Never violate
  invariants in `CLAUDE.md` or `.minspec/constitution.md`" - how to *discover* new ones is
  absent.
- The issue names `.claude/commands/specify.md`; that file does not exist. Since #534 the
  command is `minspec-specify`, generated from `slash-commands.ts` into
  `.claude/commands/minspec-specify.md` (a managed block). The source of truth is
  `slash-commands.ts`; the generated file is refreshed from it, not hand-edited.
- Pipeline position: Event Storm *discovers* (this spec) -> #269 *seeds* the constitution at
  Initialize (closed) -> #270 *enforces* in the resolver/validator (open). This spec touches
  neither.

## Requirements

- **FR-1 Tier-scaled trigger.** For T3/T4 specs the Specify guidance directs the agent to run
  the Event Storm walk *before* authoring the spec's `## Invariants` section. T1/T2 guidance is
  unchanged (one sentence / short paragraph) - no storm, no extra section.
- **FR-2 The walk.** The guidance states the method in the prompt itself: list the feature's
  events in chronological order; for each event capture **Trigger**, **Data produced**,
  **Data consumed**, **Side effects**, **Invariants** (rules that must hold true after the
  event). Invariants are taken from the walk's last field, not invented from the blank section.
- **FR-3 Where it lands.** The result is recorded in the spec as a short `## Event Storm`
  section placed immediately before `## Invariants` (a table or list, one row/entry per event),
  and each invariant in `## Invariants` that came from the walk names the event it fell out of.
  Invariants with no originating event are allowed (some come from CLAUDE.md / the
  constitution) but are not attributed to a storm.
- **FR-4 Human confirms, agent drafts.** The agent drafts the walk and proposes invariants;
  the human confirms each before it is treated as an invariant, because an invariant is a
  "never violate" rule. Unconfirmed candidates are listed as proposals, never written under
  `## Invariants` as settled. The surface mirrors #228's split: the dev-time agent asks via
  its question tool; the shipped extension's equivalent is a QuickPick or an Open-Questions
  style entry - the exact shipped surface is DQ-2.
- **FR-5 Silence beats padding.** The guidance tells the agent to omit an event field that is
  genuinely empty (write "none") and to stop at the events the feature actually has; a thin,
  accurate walk beats a padded one. This matches the constitution command's own rule.
- **FR-6 One worked example.** MinSpec's docs carry one worked example (the outreach-pipeline
  storm: `[Keyword Submitted]` -> market must be in the English-only list; `[Site Scored]` ->
  LLM usage logged, score breakdown non-null), placed where `MinSpec: Generate Example Spec`
  authors will see it (DQ-3 decides the exact file).
- **FR-7 Single source, no drift.** The text lives once in `slash-commands.ts`; the repo's
  `.claude/commands/minspec-specify.md` and every other generated target (Cursor/Copilot/etc.
  variants the file already emits) are regenerated from it. A test pins that the T3/T4 Event
  Storm paragraph is present in the generated Specify body for each target and absent from the
  T1/T2 wording.
- **FR-8 Offline and opt-in.** The change is prose in an already-shipped, already-opt-in
  command body. It adds no network call, no new file written outside `.minspec/`-opted repos,
  and no new command.

## Out of Scope

Per the issue (detection is not integration): an Event-Storm diagram or sticky-note canvas;
auto-detecting invariants by static analysis (#269); enforcing discovered invariants in the
resolver or validator (#270); any change to the gate/severity model; any new contract type in
`packages/shared`; the language-agnostic CDD *contracts* guidance (#245, Phase 2 not Phase 1).
No validator rule requires `## Event Storm` to exist - a missing section is not a gate failure
(that would be an enforcement change, and #270's territory).

## Invariants

- **INV-1 No gate change.** Nothing here adds, removes or reweights a validator or resolver
  check; DR-019's deterministic DAG is untouched.
- **INV-2 Human confirmation is mandatory** for every invariant the storm proposes (FR-4);
  the agent never promotes a candidate to a settled invariant on its own.
- **INV-3 Tier-0 / offline** (constitution invariant 1): the guidance is static text; no
  network access, no `vscode` import added to `packages/shared` (DR-014).
- **INV-4 Blast radius** (constitution invariant 3): the text ships only inside the command
  body that opted-in repos already receive; no repo without `.minspec/` changes behaviour.
- **INV-5 Single source** (FR-7): no second hand-maintained copy of the Specify guidance.

## Costly to Refactor

Low - prose in one generated command body plus a docs example. The only sticky choice is the
`## Event Storm` section name and position (FR-3): once specs carry it, #270 may later key on
it, so renaming then would touch every spec that adopted it. Check that name before approval.

## Acceptance Criteria

- [ ] **T3/T4 get the walk** — the generated Specify command for a T3/T4 spec instructs the event walk with all five fields before `## Invariants`. (FR-1, FR-2)
- [ ] **T1/T2 unchanged** — the guidance for T1/T2 carries no Event Storm requirement. (FR-1)
- [ ] **Walk is recorded and attributed** — a spec authored under the guidance has an `## Event Storm` section before `## Invariants`, and storm-derived invariants cite their event. (FR-3)
- [ ] **No self-confirmed invariants** — the guidance requires human confirmation before an invariant is written as settled. (FR-4, INV-2)
- [ ] **One source** — the repo's generated `minspec-specify.md` and all per-tool variants match `slash-commands.ts`; a test fails if the paragraph is missing from any. (FR-7)
- [ ] **Example present** — the worked example exists in the docs and uses the five-field format. (FR-6)
- [ ] **No enforcement leaked** — `npm run validate` accepts a T3 spec with no `## Event Storm` section. (Out of Scope, INV-1)

## Decisions needed (Clarify)

- **DQ-1 Section placement: dedicated `## Event Storm` section vs. folded into `## Invariants`.**
  Option A **(rec)**: dedicated section before `## Invariants` - the walk is auditable and the
  human can see where each invariant came from; costs one more section in every T3/T4 spec
  and a name that #270 might later depend on. Option B: put the per-event rows inside
  `## Invariants` - no new section, but the section gets long and the walk's non-invariant
  fields (produced/consumed/side effects) have nowhere clean to live.
- **DQ-2 Shipped-extension confirmation surface.** Option A **(rec)**: prose-only in the
  command body (the agent asks in chat; matches the issue's "guidance, not a build" scope);
  costs no deterministic confirmation record. Option B: a QuickPick in the extension like
  #228's shipped surface; gives a recorded confirmation but is new UI code, which this spec
  otherwise excludes and would need T4 ceremony.
- **DQ-3 Where the worked example lives.** Option A **(rec)**: in the output of
  `MinSpec: Generate Example Spec` / its docs page, beside the Acceptance Criteria format
  authors already copy; costs touching `commands/example.ts` if it is generated there (which
  moves this spec out of guidance-only). Option B: a standalone doc under `docs/`; no code
  touch, but easy to miss. Confirm which file in Plan.
- **DQ-4 Does this need a DR?** The issue anticipates one (DR-023). Option A **(rec)**: no DR -
  the change is a prose edit reversible in under a day, below the DR filter; costs the
  "formally adopts Event Storm" record the issue floated. Option B: file a DR; adds a
  register entry for a revertible edit.

## Follow-ups (tracked)

None new. Enforcement is #270; seeding is #269 (closed); contracts guidance is #245.
