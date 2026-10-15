---
id: SPEC-138
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - this changes how the next-task signpost orders ties inside a severity class
aspects: [signpost, priority, wsjf, next-task, goals, tie-break, determinism, tier-0, offline, classifier]
depends_on: [SPEC-012, DR-039, DR-019]  # SPEC-012 owns the resolver this adds a term to; DR-039 §5 records this as the future upgrade; DR-019 forbids non-deterministic ranking
relates_to: [SPEC-023, SPEC-007, DR-021, DR-022, "#262", "#259", "#260", "#261", "#264"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). Both NEW files are
# needed under every answer to the open questions below: the pure scoring module and its test.
implements: [packages/shared/src/auto-wsjf.ts, packages/shared/tests/auto-wsjf.test.ts]
# Modified, not owned. The resolver gains one comparison term; the shared index re-exports the
# module; the fs-adapter supplies the inputs; config gains the opt-out key (OQ-4).
affects: [packages/shared/src/next-task.ts, packages/shared/src/index.ts, packages/shared/tests/next-task.test.ts, packages/minspec/src/lib/artifact-graph.ts, packages/minspec/src/lib/config.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-138: Auto-derived WSJF - a computed, value-against-size tie-break inside a severity class

Triggered by: [#262](https://github.com/AIClarityAU/minspec/issues/262). Design rationale:
[DR-039](../../../docs/decisions/DR-039.md) §5 (Goals drive priority - auto-derived WSJF as the
recorded future upgrade). Resolver: [SPEC-012](../SPEC-012-next-task-resolver/requirements.md)
(next-task resolver). Determinism rule: [DR-019](../../../docs/decisions/DR-019.md).

## In plain terms

The next-task signpost picks one thing for the human to do. Inside a severity class it orders
by `(epic.order, goal-rank, priority, artifact-id)`. Today, in this repo, that order almost
always falls through to the **artifact id**: no artifact carries a `goal:` ref and none carries
`priority:` (counts below). So two equally-urgent approvals are ordered by which number is
lower - an arbitrary order that looks like a judgement.

WSJF (Weighted Shortest Job First) says: do the job with the most **cost of delay per unit of
size** first. MinSpec already has a manual WSJF calculator for GitHub issues. This spec adds a
**computed** WSJF for the artifacts the signpost ranks, from signals already on disk, so the
tie-break weighs value and unblocking power against size - with no new human input.

It is a tie-break only. It never moves anything across a severity class, never overrides a
`depends_on` blocker, and never touches the manual calculator.

## One-Sentence Scope

Add a deterministic, Tier-0 WSJF score, computed from each artifact's recorded tier, goal-rank
and dependency fan-in (and milestones once they exist), as a comparison term inside the
next-task resolver's within-class order, with its inputs shown in the explanation.

## Context - what the code and corpus do today (read from the worktree at 5f792386, not inferred)

| Fact | Evidence |
|---|---|
| The within-class order is `classRank, epicOrder, goalRank, priority, artifactId`. | `packages/shared/src/next-task.ts:1018-1024` (`compareRanked`) |
| `goalRank` is parsed from a `goal: G-N` ref and the constitution's ranked `## Goals`. | `packages/minspec/src/lib/artifact-graph.ts:133-185`, `:491` |
| The constitution has 8 ranked goals. | `.minspec/constitution.md` `## Goals` (8 `G-N` rows) |
| **Zero** artifacts under `specs/` or `docs/` carry `goal:`; **zero** carry `priority:`. | `grep -rlE "^goal:"` and `"^priority:"` over `specs docs` → 0 files each |
| 39 files under `specs/` and `docs/` carry `depends_on:`. | `grep -rlE "^depends_on:" specs docs` → 39 |
| `SpecNode` carries `tier` (from frontmatter) but no ranking step reads it. | `next-task.ts:88`; `artifact-graph.ts:542`; `compareRanked` has no tier term |
| Every spec has `tier:`; 88 of 103 DRs do. Epics are not checked here. | `grep -L "^tier:"` over spec requirements → 0; `grep -c "^tier:"` over DRs → 88/103 |
| Milestones (SPEC-012 FR-3b, `MILESTONE-NNN`) are **not built**. | `next-task.ts:40` lists FR-3b as out of the shipped slice |
| The consequence analyzers (SPEC-023) take a **diff** (`ConsequenceInput` of changed files) and score how much a change can *hurt*. | `packages/minspec/src/lib/consequence-analyzers.ts:1-20`, `:61-68` |
| Manual WSJF: `(businessValue + timeCriticality + riskReduction) / jobSize`, each 1-10, stored as a `wsjf:N` issue label. | `packages/minspec/src/lib/backlog.ts:73-87`, `:142-148` |

Two things follow, and they shape the design below:

1. **The DR-039 §5 input table does not map cleanly onto the code.** Two of its four sources
   need adjusting (see OQ-2 and OQ-3):
   - Its "risk reduction" source, the consequence analyzers, needs a diff, and a pending
     approval has none.
   - Those analyzers also measure the risk *of doing* a change. WSJF's risk term is the risk
     *removed* by doing it, which is the opposite direction.
   - Its "time criticality" source, milestones, does not exist yet.
2. **In this repo today, auto-WSJF would be driven by size and fan-in alone.** No artifact has
   `goal:` yet, so the business-value term is constant for everyone. That is still better than
   ordering by artifact id. It also means the effect of the goal term cannot be measured on
   real data until #259's `goal:` refs get authored.

## Terms

- **Job.** The artifact the resolver node points at (`targetId`): a spec, DR or epic. The
  "job" is getting that artifact through its pending human step *and* the work it unblocks.
  Its recorded `tier:` is a proxy for both (a T4 spec is longer to read and bigger to build).
- **Recorded tier.** The `tier:` frontmatter value. It is set when the work is triaged: by the
  tier classifier as an upward-only floor, or raised by a human. It is **not** re-classified
  here. It is not a guaranteed classifier output, and this spec does not claim it is.
- **Fan-in.** The number of distinct artifacts that reach this artifact through un-cleared
  `depends_on` edges, directly or transitively. The resolver already computes un-cleared
  edges (`unclearedDependsOn`, `next-task.ts`).
- **Within-class order.** The `compareRanked` comparison after severity class.

## Functional Requirements

### A. The score

- **FR-1 (pure, Tier-0 function).** A new module `packages/shared/src/auto-wsjf.ts` exports a
  pure function that takes one artifact's inputs (FR-2) and returns its components and score.
  It must not import `vscode`, `fs`, or any network module. It must not read the clock or use
  randomness or an LLM. Same inputs give the same output (DR-019 §1, SPEC-012 INV
  Determinism).
- **FR-2 (inputs and mapping).** Each component is an integer, so it can be compared with
  manual WSJF's 1-10 scale:
  | Component | Source | Mapping |
  |---|---|---|
  | **Size** | recorded `tier:` | T1→1, T2→3, T3→5, T4→8. Absent or unparseable → 8 (assume big; same direction as the tier floor). |
  | **Business value (BV)** | goal-rank (DR-039 §3) | rank *r* → `max(1, 11 - r)`. No `goal:`, or a goal not in the constitution → 1. |
  | **Risk reduction / opportunity enablement (RR)** | per OQ-2 (recommended: fan-in) | fan-in *d* → `min(10, 1 + d)` |
  | **Time criticality (TC)** | per OQ-3 (recommended: milestone gating, once FR-3b ships) | Until a source exists → 1 for every artifact |
  The cost of delay is `CoD = BV + TC + RR`. The score is `CoD / Size`. Changing these
  constants is a cheap edit, so the tables are not a costly-to-refactor seam.
- **FR-3 (exact comparison).** Two scores are compared by cross-multiplying,
  `CoD_a × Size_b` against `CoD_b × Size_a`, in integer arithmetic. No floating-point division
  takes part in ordering, so platform rounding cannot reorder the queue. Higher score ranks
  first. Equal scores fall through to the next term.
- **FR-4 (visible degrade).** When a component falls back to its default (absent tier, no
  goal, no time-criticality source), the result says which components defaulted. FR-7 shows
  this; the score never pretends to know a value it guessed.

### B. Where it sits in the order

- **FR-5 (tie-break inside a class only).** The score is a term of `compareRanked`, below
  `classRank`. It never changes a node's severity class. It never runs before the
  `depends_on` flooring pass (`floorDependsOn`), and it cannot undo it: an un-cleared blocker
  still ranks before its dependent whatever the scores say (SPEC-012 FR-13; DR-039 R1).
- **FR-6 (position).** The term goes at the position chosen in **OQ-1**. Recommended:
  `(classRank, epicOrder, wsjf, priority, artifactId)`, which folds goal-rank in as the BV
  component instead of keeping a separate lexicographic goal term. `epicOrder` stays above
  the score in every option. It is the human's coarse dial, and a computed value never
  outranks it (DR-019 §3, DR-039 §6).

### C. Explanation

- **FR-7 (inputs are shown, not hidden).** When the pipeline is expanded (SPEC-012 FR-6), and
  in the evidence for the selected next task, a node whose position the score decided shows
  its components and score in one line, for example
  `WSJF 2.4 = (BV 1 + TC 1 + RR 10) / size 5 (T3); TC: no source; BV: no goal`.
  The display may round. Ordering uses FR-3's exact comparison.
- **FR-8 (no new surface).** It adds no new command, view or setting except FR-10's opt-out.
  It reuses the existing status bar, `minspec.nextTask` command and pipeline expansion.

### D. Boundaries

- **FR-9 (manual WSJF unchanged).** `minspec.scoreWsjf`, `calculateWsjf`, the `wsjf:N` issue
  labels and the backlog view keep working exactly as they do now. Auto-WSJF never reads or
  writes `wsjf:` labels, never writes `priority:` or any frontmatter, and never ranks GitHub
  issues (the resolver ranks only artifacts; DR-039 §4).
- **FR-10 (opt-out).** Per **OQ-4**. Recommended: on by default, with
  `.minspec/config.json` → `nextTask.autoWsjf: false` restoring today's order exactly.
- **FR-11 (inputs come through the existing adapter).** `artifact-graph.ts` (the fs-adapter)
  supplies any input that needs file reads. The core computes fan-in from the `Edge[]` it
  already receives. Nothing new is read over the network (constitution invariant 1).
- **FR-12 (DR-039 kept true).** Shipping this updates DR-039 with a dated amendment if the
  answers to OQ-1, OQ-2 or OQ-3 differ from DR-039 §3/§5. With the recommended answers they
  differ on all three: goal-rank folded into BV, fan-in instead of the consequence analyzers,
  and TC held at 1 until milestones exist. Amending DR-039 is part of this spec's delivery,
  not a separate follow-up, so the DR does not go on describing a design that was not built.

## Acceptance Criteria

- **AC-1 (FR-1, FR-3).** A test asserts `auto-wsjf.ts` imports nothing outside
  `packages/shared` and no `fs`/`vscode`/network module. A table test gives the same result
  over repeated runs and with the input order shuffled.
- **AC-2 (FR-2).** Table tests cover each mapping row, including absent tier → 8, a goal ref
  outside the constitution → BV 1, fan-in 0 → RR 1, and fan-in ≥ 9 → RR 10.
- **AC-3 (FR-3).** Two artifacts whose scores are equal as fractions (e.g. CoD 6 / size 3 and
  CoD 10 / size 5) compare equal and fall through to the next term. A test shows the
  comparison has no floating-point division in it.
- **AC-4 (FR-5).** A fixture where a high-scoring node depends on a low-scoring un-cleared
  blocker in the same class still yields the blocker first. A fixture with a high-scoring
  `pending` node and a low-scoring `blocked-ready` node yields the `blocked-ready` node first.
- **AC-5 (FR-6).** With two nodes in one class and one epic, a T1 node with fan-in 3 ranks
  before a T4 node with fan-in 0 when neither has a goal. That is the case that is ordered by
  artifact id today.
- **AC-6 (FR-6, epic dial).** A node in an epic with a lower `epic.order` ranks first even
  when its score is lower.
- **AC-7 (FR-7).** The explanation line for a score-decided node lists all four components
  and names every defaulted one.
- **AC-8 (FR-9).** The existing backlog/WSJF tests pass unchanged, and no auto-WSJF code path
  calls the `wsjf:` label reader or writer.
- **AC-9 (FR-10).** With the opt-out set, the full pipeline for the existing `next-task.test.ts`
  fixtures is byte-identical to the pipeline before this change.
- **AC-10 (FR-12).** DR-039 has a dated amendment covering every way the shipped design
  differs from §3/§5, or states that it does not differ.

## Invariants (must not break)

- **SPEC-012 INV - Determinism / Tier-0.** No LLM, network, clock or randomness in ranking.
- **SPEC-012 severity precedence.** gate-violation ▸ blocked-ready ▸ promote-parent ▸ pending
  is untouched. The score lives strictly inside a class.
- **SPEC-012 FR-13 `depends_on` flooring.** A blocker always precedes its dependent.
- **SPEC-012 INV - Two Queues.** No agent work item enters the human queue. The score
  reorders existing nodes and creates none.
- **SPEC-012 node identity (`next-task.ts:23-28`).** Any per-node bookkeeping is keyed on
  the node, not `artifactId`.
- **DR-039 §4.** Manual WSJF stays an optional standalone tool, not wired to the resolver.
- **Constitution invariant 1 (offline).** No network call.
- **Constitution invariant 2 (no silent gate).** The score is not a gate. A missing input
  degrades visibly (FR-4, FR-7) and never makes a node disappear.
- **Constitution invariant 3 (blast radius).** Only repos with `.minspec/` run the resolver.
  Nothing here reaches outside the project.

## Decisions needed (Clarify)

Recommended answers are an agent's. They are ratified only by approval of this spec.

### OQ-1 - Where does the score sit in the within-class order?

- **A (rec)** - `(epicOrder, wsjf, priority, artifactId)`. Goal-rank becomes the BV input
  rather than a separate term. This is the only option that does what DR-039 §5 asks for:
  "weighs value against effort … so small high-value work isn't starved". **Cost:** goal-rank
  is no longer strict. A small G-3 task can outrank a large G-1 task in the same epic, which
  a reader of DR-039 §3 would not expect without the FR-12 amendment. `priority:` (used by
  nothing today) only breaks score ties, so it becomes nearly inert.
- **B** - `(epicOrder, goalRank, priority, wsjf, artifactId)`. The score only replaces the
  artifact-id fallback. Smallest change: every ordering the dials decide today stays as it
  is. **Cost:** BV is constant inside a goal tie, so the score is only fan-in over size, and
  value never weighs against size.
- **C** - score above `epicOrder`. Rejected: a computed value would outrank the human's coarse
  dial (DR-019 §3).

### OQ-2 - What feeds risk reduction / opportunity enablement?

- **A (rec)** - fan-in: how many artifacts this one is (transitively) blocking. It is
  deterministic, already computed in the core, and matches WSJF's "enables other work"
  meaning. **Cost:** it departs from DR-039 §5's table, so DR-039 needs an amendment (FR-12).
  The classifier still feeds the score, through recorded tier.
- **B** - the consequence analyzers, as DR-039 §5 lists, run over the artifact's
  `implements:`/`affects:` paths as a synthetic "modified" change set. **Cost:** it gets the
  direction wrong. Those analyzers rate how much a change can hurt, so risky work would rank
  *higher*. A pending approval also has no diff, so the analyzers that need file contents
  would mostly return `degraded`.
- **C** - drop RR (constant 1). **Cost:** with no `goal:` refs and no milestones, the score is
  then size alone.

### OQ-3 - What feeds time criticality before milestones exist?

- **A (rec)** - constant 1 now, shown as "no source" (FR-4). Once SPEC-012 FR-3b ships, TC
  comes from milestone gating: an artifact an `open` milestone `depends_on` scores higher.
  **Cost:** TC does nothing until FR-3b lands, which has no date. Wiring it later is a second
  small change to the adapter.
- **B** - parent epic `active` → higher TC. **Cost:** an `active` epic already decides
  `blocked-ready` against `pending`, so inside a class this adds almost no information and
  counts that signal twice.
- **C** - a date field such as `due:`. Rejected: SPEC-012 already rejected a date-typed
  deferral (its OQ2), and the Tier-0 core may not read the clock.

### OQ-4 - On by default, or opt-in?

- **A (rec)** - on by default, opt out with `nextTask.autoWsjf: false`. That is DR-039's
  "zero-ceremony" intent, and today it only reorders ties that fall to artifact id (OQ-1 B), or
  ties nothing ranked (OQ-1 A, while no goals exist). **Cost:** the signpost's pick changes for
  existing users without them asking. FR-7's explanation line is the only place they find out
  why.
- **B** - opt-in. **Cost:** a ranking improvement nobody turns on is not adopted (the same
  failure DR-039 records for manual WSJF).

## Out of Scope

- Building milestones (`MILESTONE-NNN`). That is SPEC-012 FR-3b. This spec only consumes them.
- Changing manual WSJF, the backlog view, or ranking GitHub issues (FR-9).
- Authoring `goal:` refs across the corpus (#259 owns the field; authoring them is human work).
- Marketing and listing copy about auto-WSJF ([#264](https://github.com/AIClarityAU/minspec/issues/264)).
- Re-running the tier classifier on artifacts. The score reads the recorded `tier:`.
- Any LLM suggestion of scores (DR-019, DR-039 Alternatives).

## Costly to Refactor

Low. DR-039 already calls this an "independently reversible … isolated tie-break stage", and
the code agrees. The change is one comparison term, one pure module and one opt-out key. It
adds no frontmatter field and writes no data, so removing it orphans nothing. The one
user-visible commitment is the explanation line format (FR-7), and nothing parses it. So this
spec mints no new decision record. It amends DR-039 (FR-12) so the existing record stays
accurate.

## Risks & Mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | The score floats a node above its blocker or across a class. | FR-5; AC-4. Ordering runs only inside a class, and flooring stays after sorting. |
| R2 | Raising a tier (more ceremony) lowers an artifact's score, which rewards under-tiering. | Tier is set at triage as an upward-only floor, not to move priority. The effect is limited to ties inside one epic (FR-6). The FR-7 line makes it visible. |
| R3 | The score orders ties that used to fall to artifact id, so the signpost's pick changes "for no reason". | FR-7 explains every score-decided position; FR-10 opt-out; AC-9 proves the opt-out restores the old order. |
| R4 | Fan-in rewards authoring many `depends_on` edges. | Edges are already load-bearing for blocking (SPEC-012 FR-13), so a fake edge also blocks real work. RR is capped at 10. |
| R5 | DR-039 goes on describing the §5 table after a different design ships. | FR-12, AC-10. |

## Alternatives considered and rejected

- **Ship manual WSJF scores into the resolver.** Rejected by DR-039 §4: four numbers per item
  is ceremony nobody does, and `wsjf:` lives on issues, not artifacts.
- **Re-classify each artifact's size from its `implements:` paths.** Rejected: there is no
  diff before the work is built, and it would be a second size source that can disagree with
  recorded tier.
- **Floating-point score with an epsilon.** Rejected for FR-3's exact integer comparison: an
  epsilon is a tuning knob, and it can still reorder on a boundary.

## Test plan (for the Plan phase to place)

- Unit tests in `packages/shared/tests/auto-wsjf.test.ts` (AC-1 to AC-3, AC-7).
- Resolver ordering fixtures added to `packages/shared/tests/next-task.test.ts` (AC-4 to AC-6,
  AC-9).
- The existing backlog tests run unchanged (AC-8).

## Traceability

- Issue: [#262](https://github.com/AIClarityAU/minspec/issues/262)
- Design rationale: DR-039 §5 (amended on delivery per FR-12); DR-019; DR-021 (classifier
  accuracy, a dependency of recorded tier)
- Siblings from DR-039: #259 (goals + `goal:` parser - built, `artifact-graph.ts:133`),
  #260 (goal-rank/epic.order tie-break - built, `next-task.ts:1018`), #261 (drag-and-drop dial
  - built, `epic-dnd-controller.ts`), #264 (copy - out of scope)
