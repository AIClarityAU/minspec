---
id: SPEC-262
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a status surface must not report "clear" while work remains
aspects: [signpost, next-task, flat-layout, no-silent-gate, offline]
depends_on: []
relates_to: [SPEC-010, SPEC-012, "#2562", "#2370", "#2438", "#2519", "#1466", "#1608"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after the root cause
  is reproduced (FR-1) and Decisions D1-D3 are answered.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-262: The signpost never says "clear" while a spec still has work, in any spec layout

> **This is a SPECIFICATION ONLY.** Written for issue #2562. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

In the voip-sms-inbox repository (flat layout: `specs/SPEC-NNN-*.md`, one file per spec) the
status-bar signpost reads "clear". The repo holds one spec being implemented (SPEC-002) and two
waiting for a plan (SPEC-004, SPEC-005). "Clear" tells the user the project is finished. It is
not. Separately, "clear" is also what an unreadable workspace shows, so the user cannot tell
"nothing to do" from "could not tell".

## Measured state (this base)

Read from the code at this base, not inferred:

- `packages/minspec/src/commands/next-task.ts:25-31` (`computeNextTask`) and `:47-52` turn any
  thrown error into `null`; `null` renders as the "clear" message / tick. So a failure and an
  empty queue are one outcome (the #1466 class).
- `packages/shared/src/next-task.ts:859-872`: the implement-phase node (`phase-action`) is only
  emitted when `status === 'implementing'` AND `approvalState === 'approved'` AND
  `phase` is `tasks` or `implement`. A spec in `plan` (the derived `planning` band) emits
  nothing by design (the #1436 review), and no other node kind covers "this spec needs a plan".
- `packages/minspec/src/lib/lifecycle.ts:133-146`: the signpost's status is DERIVED from the
  `phases:` frontmatter map plus approval, not read from the literal `status:` line. A spec
  with no `phases:` map is `allPending` -> `new`, whatever `status:` says.
- `packages/minspec/src/lib/artifact-graph.ts:543` takes `phase` from the same `phases:` map;
  `readImplementHole` (`:408-446`) looks for a sibling `tasks.md` or a `tasks`/`implement`
  section in the one file.
- The `status:` values in the report (`implementing`, `planning`, `done`) are the LITERAL
  field. Whether voip's specs carry a `phases:` map, and whether SPEC-002 is `approved` in
  `.minspec/approvals.json`, is **not verified here** (no access to that repository).

## Root cause (mechanism) - hypotheses, to be settled by FR-1

Not yet established; the report names two candidates and the code adds a third. FR-1 requires a
reproduction to pick among them before any fix is written.

- **H1 - no node for the plan phase.** Specs in `planning` (SPEC-004/005) produce no task at all
  (`next-task.ts:866-870`). This alone explains why they do not show, in every layout.
- **H2 - derived status disagrees with the literal one.** A flat-layout spec with a literal
  `status: implementing` but no `phases:` map (or an unapproved/stale approval, e.g. SPEC-001,
  #2519) derives to `new`/`specifying`, so no implement hole is considered for it. SPEC-002
  would then be invisible for a reason unrelated to the folder layout.
- **H3 - "nothing a human must approve" read as "nothing to do".** The resolver emits only the
  HUMAN queue (SPEC-012 "Two queues"); agent-side work is not a node (#1608). The command's
  `null` then prints "you're clear" - a claim about the whole project made from half the data.

The gate that failed is the same in all three: **the surface has no representation for "work
exists that I do not rank" or "I could not read", so both collapse into "clear".** A data fix to
voip's frontmatter alone would repeat the #2370 pattern (fix the instance, leave the gate).

## Functional requirements

- **FR-1 Reproduce first.** Before any change, a fixture built from the voip table above
  (five flat specs, the five literal statuses, with and without `phases:` maps and approvals)
  is run through `buildArtifactGraph` + `resolveNextTask`; the spec records which of H1-H3 (or
  a combination) holds, citing the node list produced. No fix lands without this.
- **FR-2 Layout parity.** For any fixed spec content, the signpost result is identical whether
  the spec is nested (`specs/<product>/<feature>/requirements.md`) or flat
  (`specs/SPEC-NNN-*.md`). Tested by running one fixture through both layouts.
- **FR-3 "Clear" is a positive claim.** The signpost may say "clear" only when every
  non-terminal spec, DR and epic was read successfully AND none has an open step in ANY queue
  (human or agent, per D1). Otherwise it must not show the green tick.
- **FR-4 Unknown is not clear.** A thrown build/resolve error, a missing or unreadable
  `specs/` tree, or a spec file that fails to parse yields a distinct "could not determine"
  state with its own text and icon, never the clear message. The error is surfaced visibly
  (log line plus the state itself), not swallowed. (Covers the #1466 class for this surface.)
- **FR-5 Plan-phase work is a task.** An approved spec whose current phase is `plan` or
  `clarify` resolves to a next task naming the phase ("Plan SPEC-004"), ranked below approvals
  and above nothing. Rank and class: D2.
- **FR-6 Status disagreement is shown.** When a spec's literal `status:` field and its derived
  status disagree (e.g. literal `implementing`, derived `new`), the signpost does not drop it
  silently: it emits a coherence node ("SPEC-002 status says implementing but its phases map /
  approval do not") so the repair is named. Reuses the existing `coherence.*` rule family.
- **FR-7 Terminal specs stay quiet.** `done`, `archived`, `superseded` specs produce no task
  and do not block "clear". SPEC-001 (done, stale approval) is handled by #2519 and not
  re-solved here; FR-3 must not turn it into a permanent non-clear (D3).
- **FR-8 No regression of #2370.** The signpost must still never ask for an approval that no
  approve command would act on (`literalStatusTerminal` stays honoured).
- **FR-9 Offline and deterministic.** No network, no model call; same workspace bytes give the
  same signpost (SPEC-012 determinism).

## Acceptance criteria

- **AC-1** The voip fixture (FR-1) yields a non-clear signpost whose text names SPEC-002 or a
  plan task for SPEC-004/005, in both layouts.
- **AC-2** A workspace whose spec directory cannot be read renders the "could not determine"
  state, not the clear tick; a workspace that was read and genuinely has nothing open still
  renders clear.
- **AC-3** A forced exception inside `buildArtifactGraph` renders "could not determine" and
  writes a diagnostic; the old test expecting "clear" on throw is changed deliberately.
- **AC-4** A spec with literal `status: implementing` and an empty `phases:` map produces a
  coherence node, not silence.
- **AC-5** Mutation check: reverting FR-3's emptiness test to "no human node" makes AC-1 fail.
- **AC-6** Nested-layout results for existing fixtures are byte-for-byte unchanged (no
  regression of SPEC-012's suite).

## Invariants this change must not break

- Constitution invariant 2 (no silent gate): the very defect. A witness that cannot see work
  must say so; no `catch { return null }` standing in for "no work".
- Constitution invariant 1 (offline) and 3 (blast radius): reads only the opted-in repo.
- SPEC-012 INV-DEGRADE: the signpost still never crashes the thread - it degrades to
  "could not determine", not to a throw and not to "clear".
- SPEC-012 two-queues rule: this spec does not merge the human and agent queues (#1608 owns
  that split); it only stops "clear" from asserting more than the human queue can know (D1).
- Derived status stays derived (#112): the fix must not start trusting the literal `status:`.
- SPEC-010 coverage contract: any new node kind is added to its DAG/coverage tables.

## Out of scope

- The full human-queue / agent-queue split (#1608).
- An approve path for a done flat-layout spec (#2519).
- Reworking `readImplementHole` task parsing.
- Editing voip-sms-inbox content (a data edit there is not the fix).

## Decisions needed (Clarify)

All 3 decisions are resolved: an agent session recorded each option this document already
recommended, under delegation DLG-001 (DR-108, the delegated-approval record). No human
chose them; they are ratified only by approval of this spec.

- **D1 - Recorded selection: Option (a),** "clear" means nothing open in the human queue AND no
  non-terminal spec with open work; agent-only work shows "nothing for you; agent work remains".
- **D2 - Recorded selection: Option (a),** a plan-phase task ranks in the `pending` class, below
  approvals, above corruption-free idle.
- **D3 - Recorded selection: Option (a),** a done spec with a stale approval never blocks "clear";
  #2519 owns the approval repair.

**D1 - What may "clear" claim?**
- (a) **(rec)** "Clear" means nothing open in the human queue AND no non-terminal spec with
  open work; when only agent-side work remains, show "nothing for you; agent work remains:
  SPEC-002". Cost: needs a lightweight "open work exists" signal that the two-queues design
  (SPEC-012) deliberately does not rank, so it adds a second output field.
- (b) Reword the human-queue-empty text to "nothing for you to review" and never claim project
  state. Cheapest and honest; cost: still gives no pointer to SPEC-002, so the user's
  expectation in the report ("name the next task") is unmet.

**D2 - Rank of a plan-phase task.**
- (a) **(rec)** `pending` class, below approvals, above corruption-free idle. Cost: new rule
  in the resolver table and SPEC-010 coverage map.
- (b) Reuse `phase-action` with a plan imperative. Cost: that kind was gated to tasks/implement
  on purpose (#1436); loosening it risks the "Implement X" for a spec still being planned
  regression DR-069 exists to prevent.

**D3 - Does a done spec with a stale approval (SPEC-001) block "clear"?**
- (a) **(rec)** No: terminal specs never block; #2519 owns the approval repair. Cost: a stale
  approval on a done spec stays invisible on this surface.
- (b) Yes, show a coherence warning. Cost: voip would never be clear until #2519 ships.

## Follow-ups (tracked)

- #1608 - human/agent queue split (the durable home for D1 (a)).
- #2519 - approve path for a done flat-layout spec.
- #1466 - unreadable workspace renders the clear tick; FR-4 closes it for this surface, the
  issue may still cover other surfaces.
- Reproduction in voip-sms-inbox itself (settling H1-H3 against real `phases:`/approvals):
  tracked by FR-1 of this spec.
