---
id: SPEC-091
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - one added term in the never-wrong signpost's ordering
aspects: [signpost, next-task, tie-break, walking-skeleton, vertical-slice, frontmatter-contract, determinism, tier-0]
relates_to: [SPEC-012, SPEC-010, DR-019, DR-039, "#297", "#260", "#262"]
depends_on: [DR-101]  # the proposed decision that fixes the marker shape and amends the within-class order; this spec must not reach Plan before it is accepted
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1/FR-2). All four
# files are NEW. The reader module is owned here because FR-2 requires ONE reader shared by
# the graph adapter and the validator.
implements: [packages/minspec/src/lib/skeleton-marker.ts, packages/minspec/tests/skeleton-marker.test.ts, packages/shared/tests/next-task-skeleton.test.ts, packages/minspec/tests/artifact-graph-skeleton.test.ts]
# Modified, not owned. next-task.ts and artifact-graph.ts are owned by SPEC-012 (its
# `implements:`); this spec adds one term and one field to them.
affects: [packages/shared/src/next-task.ts, packages/minspec/src/lib/artifact-graph.ts, scripts/validate-frontmatter.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-091: Prefer the task that advances an unfinished walking skeleton

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves
> it through the normal spec-approval gate before any code changes. Every requirement below
> is written under each decision's recommended option, so approving the spec as it stands
> accepts those recommendations. Choosing a different option changes only the requirements
> that decision names.

Materializes **[#297](https://github.com/AIClarityAU/minspec/issues/297)** - *"vertical-slice
(walking-skeleton) completion as a deterministic priority signal feeding the next-task
resolver."* Rests on **[DR-101](../../../docs/decisions/DR-101.md)** (walking-skeleton
tie-break term, `proposed`), which amends the within-class order set by
[DR-019](../../../docs/decisions/DR-019.md) (deterministic next-task ordering) and
[DR-039](../../../docs/decisions/DR-039.md) (goals drive priority). It extends
[SPEC-012](../SPEC-012-next-task-resolver/requirements.md) (next-task resolver) and does not
replace any part of it.

**Id note.** The four ids after `SPEC-086` are claimed on branches visible in this checkout
(775 local and remote-tracking refs scanned on 2026-10-01), so this is `SPEC-091`. Open pull
requests could not be listed (no network on this dispatch). If either id collides at review
time, renumber, and update `depends_on:` above in the same change: a `depends_on` that does
not resolve is resolver corruption and would put "state unclear" on the signpost.

## One-Sentence Scope

Let a human mark, on an epic, which specs form its thinnest end-to-end path, and make the
next-task resolver prefer work that advances an unfinished stage of that path when, and only
when, every existing ordering term is tied.

## Context - what the code does today (read from `main` at `27661a68`, not inferred)

### The within-class order ends in an arbitrary pick

`compareRanked` (`packages/shared/src/next-task.ts:996-1002`) orders pending human tasks by
severity class, then `epic.order`, then goal-rank, then `priority`, then artifact id. The
first four are a gate ranking and three human weights. The id is a deterministic but
meaningless pick (SPEC-012 FR-14).

Nothing in that order knows whether a task closes an end-to-end path. Contract-Driven
Development asks for one entity through the whole flow before anything is fleshed out; the
resolver cannot express that preference, so it can recommend the fourth variant of a
working stage ahead of the last unbuilt stage of the skeleton.

### Inside an epic, the arbitrary pick is the normal case

Measured on this checkout:

| Term | What separates two specs today | Evidence |
|---|---|---|
| `epic.order` | always across epics, never within one | all 10 epics carry a distinct `order` |
| goal-rank | never | 0 of 72 specs declare `goal:` |
| `priority` | never | the adapter passes `priority: undefined` for every artifact (`packages/minspec/src/lib/artifact-graph.ts:522`, `:546`, `:569`) |
| artifact id | everything else | - |

So any two same-class tasks in the same epic are ordered by id. EPIC-002 (Signpost
Integrity) holds 24 specs, EPIC-009 (Team Readiness) 15, EPIC-006 (Trust, Consent and
Supply Chain) 12. The new term replaces that pick with a meaningful one, and by the same
measurement it will not fire across epics.

### The resolver ranks artifacts, not task-list items

A resolver node is one pending human decision about one artifact: approve a spec, accept a
decision, promote an epic, answer an open question, or carry on implementing a spec
(`NodeKind`, `next-task.ts:152`). The issue's "task that completes the skeleton" therefore
means, at the grain the engine has, a pending node whose artifact is a stage of the
skeleton. A stage is a spec. The signal does not look inside `tasks.md`.

### A blocked task does not lift its blocker

Probed against the shipped pure function: four unapproved specs under one active epic,
called W, X, Y and Z here in ascending id order, where W `depends_on` Z.

| Graph | Pipeline |
|---|---|
| no edges | W, X, Y, Z |
| W `depends_on` Z | X, Y, Z, W |

The flooring pass (`floorDependsOn`, `next-task.ts:1072`) correctly puts W behind its
blocker, but the blocker keeps its own rank. If W were a skeleton stage, a term that looked
only at W would change nothing: the signpost would still say X. This is why FR-5 exists.

## Functional Requirements

Requirement ids are local to this spec. "The core" is `packages/shared/src/next-task.ts`;
"the adapter" is `packages/minspec/src/lib/artifact-graph.ts`.

### The marker

- **FR-1 (the skeleton is declared on the epic).** An epic file MAY carry, in its
  frontmatter, `skeleton: [SPEC-NNN, SPEC-NNN, ...]`: an inline array of spec ids. Each
  entry names a **stage**. The grammar is the inline-array grammar already used for
  `depends_on` / `supersedes` / `relates_to` (`parseEdgeArray`, `artifact-graph.ts:114-124`),
  including a trailing `# comment` after the closing bracket. A stage MAY belong to any
  epic. List order is not read by the engine. The key is optional; an epic without it
  declares no skeleton.
- **FR-2 (one reader).** Exactly one function reads a `skeleton:` value from a frontmatter
  block. The adapter and the validation rule (FR-10) MUST both call it. Two readers would
  let the signpost and the validator disagree about what the author wrote.
- **FR-3 (the adapter passes the list through; the core decides).** The adapter sets
  `EpicNode.skeleton` to the entries as authored, or leaves it absent when the key is
  absent or the array is empty. It does not filter, resolve or classify entries. Every
  rule below is computed in the core, so every surface that calls the core agrees
  (SPEC-012 FR-11).

### What advancing a skeleton means

- **FR-4 (stage state comes from `status`).** For an entry that resolves to a spec in the
  graph:

  | State | Spec `status` |
  |---|---|
  | walked | `done` |
  | withdrawn | `archived`, `superseded` |
  | unwalked | any other value |

  An entry that does not resolve to a spec in the graph has no state and is ignored by the
  core (FR-9). A skeleton declared by an epic whose status is `abandoned` is ignored
  entirely.
- **FR-5 (a node advances a skeleton directly or as a blocker).** A node **advances a
  skeleton** when its ranking key (`RankedNode.artifactId`, the key `compareRanked` and the
  flooring pass already use, `next-task.ts:724-731`) is either:
  1. an unwalked stage of at least one live skeleton; or
  2. an artifact whose own gate is not cleared (`gateCleared`, `next-task.ts:254`) and that
     an unwalked stage reaches through one or more `depends_on` edges, every artifact along
     the way also being uncleared.

  The closure in (2) MUST terminate on a dependency cycle (a cycle is already reported as
  corruption; it must not hang or throw here). Only this property is inherited. The
  stage's `epic.order`, goal-rank and `priority` are NOT transferred to its blocker.
  Implicit tree edges (an epic gating its members) do not inherit; `promote-parent` already
  outranks the `pending` class those members sit in.

### The ordering

- **FR-6 (one term, last before the id).** The within-class order becomes
  `(epic.order, goal-rank, priority, skeleton-advance, artifact-id)`. `skeleton-advance` is
  binary: a node that advances a skeleton sorts before one that does not. It applies
  identically in every severity class and to every node kind.
- **FR-7 (what the term can never do).** The term MUST NOT:
  1. change any node's severity class, or move a node across a class boundary;
  2. place a node ahead of one that wins on `epic.order`, goal-rank or `priority`;
  3. place a node ahead of an uncleared `depends_on` blocker in its class. The flooring
     pass stays after the sort and is not modified;
  4. add, remove or re-target any node. The set of tasks in the pipeline is the same with
     and without skeletons; only their order within a tie can differ.

  The `relates_to` clustering pass (`clusterRelatesTo`, `next-task.ts:1014`) is not
  modified. It may still pull a kindred node next to an earlier one mid-pipeline, exactly
  as it does past the existing terms today, and it cannot change the first element.

### Showing why

- **FR-8 (evidence).** A node that advances a skeleton MUST carry a structured record of
  why, in an optional `Evidence.skeleton` field (contract below), and its
  `Evidence.explanation` MUST end with a plain clause naming the declaring epic and the
  progress, for example `advances EPIC-002's walking skeleton (2 of 5 stages done)`, or for
  an inherited node `unblocks SPEC-014, a stage of EPIC-002's walking skeleton (2 of 5
  stages done)`. When several skeletons or stages qualify, the one reported is the lowest
  epic id, then the lowest stage id, by the existing numeric-aware comparison
  (`compareIds`, `next-task.ts:224`). `Evidence.rule` and `Evidence.severityClass` are
  unchanged. A node that does not advance a skeleton carries neither the field nor the
  clause. The evidence states a property of the node, so it is present whether or not the
  term happened to decide the order.

### Staying safe when the marker is absent or wrong

- **FR-9 (inert by default, and never corruption).** A graph in which no epic has a
  `skeleton` MUST produce a pipeline identical, field for field, to the one the resolver
  produces before this change. In the core, an entry that does not resolve, or resolves to
  something that is not a spec, is ignored: it MUST NOT produce a `Corruption`, a
  gate-violation node, or a "state unclear" task. This follows the rule the core already
  applies to `relates_to` (`next-task.ts:332-341`): a broken tie-influence link is a lint,
  never a signpost-blocking violation.
- **FR-10 (a bad marker fails validation, visibly).** A deterministic, offline rule MUST
  report each of the following, naming the epic file and the offending entry, and
  `npm run validate` MUST exit non-zero when any is present:
  1. an entry that resolves to no spec in the corpus;
  2. an entry that is not of the form `SPEC-NNN` (a decision id, an epic id, a slug);
  3. an entry repeated within one list;
  4. a `skeleton:` key whose value is not an inline array (for example a block-style YAML
     list), which the reader would otherwise drop without a word.

  A list naming a withdrawn stage (FR-4) is reported as a warning, not a failure: the list
  is stale but not malformed. The rule lives beside the other validator rules that
  `scripts/validate-frontmatter.ts` imports from `packages/minspec/src/lib/` (its imports
  at lines 20-36), so the editor and CI can share it.

### Determinism and packaging

- **FR-11 (pure, Tier 0, order-independent).** The computation is a pure function of the
  `ArtifactGraph`. No filesystem, network, clock, randomness or model call is added to the
  core. The exported function signatures (`resolvePipeline`, `resolveNextTask`,
  `resolveCorruption`) do not change; the only type changes are the two optional fields in
  the contract below. The result MUST NOT depend on the order of entries in a `skeleton`
  list, the order of `graph.epics`, or the order of `graph.edges`.
- **FR-12 (no skeleton is authored by this work).** The implementing change MUST NOT add a
  `skeleton:` line to any real epic in this repository. Which path is the skeleton is a
  human priority decision; the feature ships inert and stays inert until a human writes a
  list.

### Keeping the governing documents true

- **FR-13 (amend what states the old order).** The implementing change MUST update, in the
  same pull request as the code:
  1. SPEC-012 FR-2 and FR-3, its FR-2 acceptance criterion and its FR-2 test-strategy row,
     so they state the five-term order and point here;
  2. DR-019 section 2, with an "Amended by DR-101" note beside the existing DR-039 one.
     `validateDrAmendments` (`packages/minspec/src/lib/adr-manager.ts:262`) reports an
     accepted amending decision until its target mentions it;
  3. the comments that state the order in the core: the file header, the Step 4 heading
     above `compareRanked`, and the `INV-TIE` suite title in
     `packages/shared/tests/next-task.test.ts:193`.

  SPEC-012 has a stored approval record, so (1) stales its approval and costs one
  re-approval. That cost is accepted: an authoritative spec stating an order the code no
  longer implements is the false signpost this epic exists to prevent.

## Contract (cross-package: adapter to core)

Additive and optional. A caller that sets neither field sees no change.

```ts
// packages/shared/src/next-task.ts

export interface EpicNode {
  id: string;
  status: EpicStatus;
  order?: number;
  goalRank?: number;
  priority?: number;
  /**
   * Stage ids exactly as authored in the epic's `skeleton:` frontmatter list.
   * Absent or empty: this epic declares no walking skeleton. Unfiltered: the core
   * decides which entries resolve (FR-3, FR-9).
   */
  skeleton?: string[];
}

/** Why a node advances a walking skeleton (FR-8). */
export interface SkeletonEvidence {
  /** The epic that declares the skeleton. */
  epicId: string;
  /** The unwalked stage this node advances: itself, or the stage it blocks. */
  stageId: string;
  /** Entries of that skeleton whose spec is `done`. */
  walked: number;
  /** Entries that resolve to a spec and are not withdrawn. */
  total: number;
  /** True when the node is an uncleared depends_on blocker of `stageId`, not the stage. */
  inherited: boolean;
}

export interface Evidence {
  severityClass: SeverityClass;
  rule: string;
  explanation: string;
  refs: string[];
  /** Present only on a node that advances a skeleton. */
  skeleton?: SkeletonEvidence;
}
```

## Acceptance Criteria

Every ordering criterion is a fixture **with a control**: the same graph with the
`skeleton` removed must produce the other answer. A fixture that passes with and without
the feature proves nothing.

- [ ] **AC-1 (FR-6, the issue's first fixture).** Two unapproved specs under one active
  epic have identical weights. The epic's `skeleton` names only the one with the higher id.
  The next task is that stage. Control: without the list, it is the lower-id spec.
- [ ] **AC-2 (FR-7.1, the issue's second fixture).** A skeleton-advancing node in a lower
  class never precedes a node in a higher class. One fixture per adjacent class pair
  (gate-violation over blocked-ready, blocked-ready over promote-parent, promote-parent
  over pending), each with the skeleton node in the lower class.
- [ ] **AC-3 (FR-7.2).** A non-advancing node that wins on `epic.order` precedes a
  skeleton-advancing node; likewise for goal-rank; likewise for `priority`. Three fixtures.
- [ ] **AC-4 (FR-5, FR-7.3).** The probed graph above with W as a stage yields Z, W, X, Y:
  the blocker inherits the term and still precedes the stage. Control: without the list,
  X, Y, Z, W.
- [ ] **AC-5 (FR-5).** Inheritance is transitive through two uncleared hops; stops at a
  cleared blocker (a cleared artifact gains nothing, and nothing beyond it inherits);
  reaches a `proposed` decision record; and a `depends_on` cycle through a stage returns
  inside a 1000 ms test timeout, as the existing cycle test does, without throwing.
- [ ] **AC-6 (FR-4).** A walked stage and a withdrawn stage give no preference to any node.
  A skeleton whose every stage is walked produces a pipeline identical to the same graph
  with no skeleton. A skeleton on an `abandoned` epic is ignored.
- [ ] **AC-7 (FR-9).** The existing `packages/shared/tests/next-task.test.ts` suite passes
  unmodified apart from the FR-13 title change. A graph with no `skeleton` deep-equals its
  pre-change pipeline.
- [ ] **AC-8 (FR-9).** An entry naming a missing spec, a decision id and an epic id each
  leave `resolveCorruption` empty and add no gate-violation node; the remaining valid
  entries still take effect.
- [ ] **AC-9 (FR-8).** A direct and an inherited advancing node each carry
  `Evidence.skeleton` with the right `epicId`, `stageId`, `walked`, `total` and `inherited`,
  and the explanation clause. A non-advancing node carries neither. With two qualifying
  skeletons the lowest epic id is reported.
- [ ] **AC-10 (FR-11).** Permuting the `skeleton` entries, `graph.epics` and `graph.edges`
  leaves the pipeline identical. The existing source scan for clock, randomness, network,
  filesystem and editor imports (`INV-DET-2`, `next-task.test.ts:73`) still passes.
- [ ] **AC-11 (FR-1, FR-2, FR-3).** Against a real temporary corpus the adapter reads an
  inline list, a list with a trailing comment, and an empty list (field absent), and the
  validator and adapter return the same entries for the same file.
- [ ] **AC-12 (FR-10).** Each of the four malformed shapes is reported with the file and
  the entry and makes `npm run validate` exit non-zero; a withdrawn stage is a warning and
  does not. A corpus with no `skeleton:` key reports nothing.
- [ ] **AC-13 (FR-7, clustering).** With a `relates_to` edge that pulls a non-advancing
  node up the pipeline, the first element is still the skeleton-advancing node.
- [ ] **AC-14 (FR-12, FR-13).** No file under `docs/epics/` gains a `skeleton:` line in the
  implementing change. SPEC-012 FR-2 and DR-019 section 2 state the five-term order and
  name DR-101; `npm run validate` reports no unacknowledged amendment.

## Invariants (must not break)

- **INV-1 (never outranks a gate).** A skeleton preference never changes a severity class
  and never precedes an uncleared blocker. SPEC-012's "Next-task correctness" invariant and
  EPIC-002's promise both depend on it. (FR-7; AC-2, AC-4.)
- **INV-2 (the human's weights win).** `epic.order`, goal-rank and `priority` always
  outrank the term (DR-019 section 3). (FR-6, FR-7.2; AC-3.)
- **INV-3 (read, never inferred).** Which specs are stages comes only from the authored
  list. No path is derived from graph shape, edit recency or a model (DR-019 sections 1 and
  3; SPEC-012 FR-1, FR-3). (FR-1, FR-11.)
- **INV-4 (deterministic, Tier 0, one engine).** Same graph, same pipeline, on every
  surface; no network (constitution invariant 1; SPEC-012 FR-1, FR-11). (FR-11; AC-10.)
- **INV-5 (anchored to the plan).** The term reads artifact state only. What the developer
  is currently doing is not an input (SPEC-012 FR-8a).
- **INV-6 (two queues).** No agent or dispatch work enters the pipeline; this change adds
  no node (SPEC-012 FR-8). (FR-7.4.)
- **INV-7 (no silent drop).** A marker the reader cannot use is reported, not ignored
  quietly (constitution invariant 2's shape, applied to a non-gating input). (FR-10; AC-12.)
- **INV-8 (opt-in).** A project without a `skeleton:` key behaves exactly as before
  (constitution invariant 3; DR-019's "absent means no edge"). (FR-9; AC-7.)

## Decisions needed (Clarify)

Each decision carries a recommendation and its cost. The requirements above assume the
recommended option in every case.

### DQ-1 - Where is the skeleton declared?

This is the decision DR-101 records. Accepting DR-101 answers it.

- **Option A - an inline `skeleton:` list on the epic (rec).** One line, one file, one
  place to read the whole path. A mistyped entry is detectable because it names a spec that
  does not exist. *Cost:* one skeleton per epic, and the list lives away from the specs it
  names, so adding a stage means remembering to edit the epic.
- **Option B - a `slice: <name>` key on each member spec.** Membership travels with the
  spec and a spec can join several named slices. *Cost:* a mistyped name silently creates a
  new one-member slice that nothing can detect. Adding the key to an approved spec stales
  its approval, because the hash covers every frontmatter key except `status` and `phases`
  (`packages/shared/src/canonical.ts:14-15`), and a stale spec gets an approve task and
  loses its implement task (`next-task.ts:749`, `:841`): one re-approval per stage. FR-1,
  FR-3, FR-10 and the contract would be rewritten around a per-spec field.
- **Option C - read an existing `relates_to` cluster as the path.** No new key. *Cost:*
  every cluster already written for loose kinship would become a skeleton the author never
  declared, which is the engine inferring weight, and DR-019 section 3 forbids that. Not
  recommended under any reading.

### DQ-2 - Where does the term sit among the existing ones?

- **Option A - last, immediately before the artifact id (rec).** It only ever replaces the
  arbitrary pick, so no human weight is overridden. This is the placement the issue asks
  for. *Cost:* it fires only when every weight ties. Measured today that means inside one
  epic and never across epics, so a skeleton stage in EPIC-006 will not be preferred over a
  non-stage in EPIC-002.
- **Option B - ahead of `priority`, or ahead of goal-rank.** The signal fires more often.
  *Cost:* a structural hint outranks an explicit human weight, against DR-019 section 3,
  and AC-3 inverts. Since neither weight separates specs today, this buys nothing now and
  would surprise whoever first sets a `priority`.

### DQ-3 - Do a stage's blockers inherit the preference in this version?

- **Option A - yes, through uncleared `depends_on` edges (rec).** Without it the term does
  nothing in the blocked case, as the probe shows: the stage sinks behind its blocker and
  the blocker ranks behind unrelated work. *Cost:* a transitive closure in the core, the
  AC-5 fixtures, and an evidence clause that must explain an indirect reason ("unblocks
  SPEC-014") clearly enough to be trusted.
- **Option B - direct stages only.** Smaller: drop FR-5 item 2, AC-4's expected order and
  AC-5. *Cost:* the signal goes quiet whenever a stage is waiting on something, which is
  when knowing what to clear first matters most.

## Out of Scope

- **Any change to the severity classes, the node kinds, or the exported function
  signatures** of the resolver (SPEC-012 FR-2, FR-11). One term and two optional fields.
- **Rendering the skeleton** in the explorer, the status bar or the graph surface. DR-038
  (unified next-task graph surface) owns that; this spec only makes the evidence available.
- **Detecting or suggesting what the skeleton should be**, by the engine or by a model.
- **Inheriting the human weights through `depends_on`**, so that a blocker ranks with the
  `order` of what it blocks. That is a question about SPEC-012's ordering as a whole.
- **Economic weighting** (#262, auto-derived WSJF) and **goal mapping** (#259, #260).
- **Task-list granularity.** Preferring one item over another inside a single `tasks.md`.
- **Parsing `priority:`** from disk. The adapter does not read it today; that is SPEC-012's
  unfinished dial, not this spec's.

### An adjacent defect found while probing, not fixed here

With an unapproved spec under an active epic, and its `depends_on` target an unapproved
spec under a `proposed` epic, the shipped resolver returns the blocked spec as the next
task, ahead of both the epic promotion and the blocker. The flooring pass only reorders within one severity class
(`next-task.ts:1063-1071`), and here the blocked spec is in a higher class than its
blocker. SPEC-012 FR-13 says a dependent "MUST rank below an un-cleared target". This
exists today, is independent of skeletons, and the new term neither fixes nor worsens it.
**It is not yet filed as an issue**: this dispatch had no network. It needs filing against
SPEC-012 before this spec's sign-off is taken as covering blocked work across classes.

## Alternatives considered and rejected

Recorded in full in DR-101 ("Alternatives rejected"). In short: a per-spec key (DQ-1 B), a
registered `SLICE-NNN` artifact kind, a `relates_to` cluster (DQ-1 C), a skeleton inferred
from the dependency graph, a new severity class, a graded "fewest stages remaining" term,
and treating a bad entry as resolver corruption. Two more are specific to this spec:

- **Having the adapter filter and classify entries.** Rejected by FR-3: every consumer of
  the core would then need the same filtering, and a second caller could disagree.
- **Appending the reason only to the explanation string.** Rejected by FR-8: a later
  surface (DR-038's graph) should not have to parse prose to learn which epic and stage a
  node advances.

## Dependencies and blast radius

- **DR-101** must be accepted before Plan (`depends_on:` above).
- **SPEC-012** owns both files this spec modifies. Its FR-2 order, its `INV-TIE` tests and
  its header comments change (FR-13).
- **SPEC-010** (signpost correctness) is unaffected: the implement hole it feeds arrives as
  a node like any other, and the term applies to it through `artifactId`.
- **In-flight neighbours.** Branches in this checkout carry unmerged spec folders whose
  names say they add resolver node kinds (`pr-review-signpost-node`, `issue-triage-node`).
  Their contents were not read. Because the term keys on `artifactId` rather than node kind, I believe it
  composes with a new kind without change; that is unverified and Plan should re-check it
  against whichever has merged.
- **Rollback.** Remove the compared field and the adapter read; the contract fields are
  optional, and an unread `skeleton:` line is inert. Authored lists are the only sticky
  part (DR-101, "Costly to Refactor").

## Test plan (for the Plan phase to place)

| File | Covers |
|---|---|
| `packages/shared/tests/next-task-skeleton.test.ts` (new) | AC-1 to AC-10, AC-13: pure-core fixtures, each ordering case with its control |
| `packages/minspec/tests/artifact-graph-skeleton.test.ts` (new) | AC-11: the adapter against a temporary corpus on disk |
| `packages/minspec/tests/skeleton-marker.test.ts` (new) | AC-11 (reader parity), AC-12: the reader and the validation rule |
| `packages/shared/tests/next-task.test.ts` (existing) | AC-7: must stay green with only the suite title changed |

All T0 (SPEC-012 FR-12: no ordering rule ships without its invariant test). CI runs
`npx vitest`, so nothing here may rely on an npm lifecycle hook.

## Traceability

- Issue: [#297](https://github.com/AIClarityAU/minspec/issues/297). Siblings that add other
  tie-break inputs and are not duplicated here: #260 (goal-rank and `epic.order` terms),
  #262 (auto-derived WSJF), #259 (project Goals).
- Decision: [DR-101](../../../docs/decisions/DR-101.md) (this spec's marker and order).
  Amends [DR-019](../../../docs/decisions/DR-019.md) section 2 and
  [DR-039](../../../docs/decisions/DR-039.md) section 3.
- Extends: [SPEC-012](../SPEC-012-next-task-resolver/requirements.md) FR-2 (within-class
  order), reads its FR-13 `depends_on` edges, and keeps FR-1, FR-8a, FR-11 and FR-14.
- Epic: [EPIC-002 Signpost Integrity](../../../docs/epics/EPIC-002-signpost-integrity.md).
- Source of the method: the Contract-Driven Development playbook's "Walking Skeleton" and
  "Vertical Slices" sections, as quoted in #297. The playbook lives in another repository
  and was not opened on this dispatch.
