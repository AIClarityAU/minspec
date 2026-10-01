---
id: SPEC-091
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - the next-task resolver and everything that ranks inside it live here
aspects: [signpost, next-task, priority, goals, epic-order, determinism, tier-0]
relates_to: [SPEC-012, DR-039, DR-019, DR-038, "#260", "#259", "#261", "#262"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1/FR-2). One NEW
# file: the dial-contract test suite, required under every answer to the decisions below.
implements: [packages/shared/tests/next-task-dials.test.ts]
# Modified, not owned. next-task.ts, artifact-graph.ts and their existing tests belong to
# SPEC-012 (its `implements:` list); this spec tightens a contract inside them and does not
# take them over. scripts/lib/issue-rank.ts holds the second copy of the within-class
# comparator (FR-12) and scripts/validate-frontmatter.ts is the advisory surface (FR-9).
affects: [packages/shared/src/next-task.ts, packages/shared/tests/next-task.test.ts, packages/minspec/src/lib/artifact-graph.ts, packages/minspec/tests/artifact-graph-fidelity.test.ts, scripts/lib/issue-rank.ts, packages/minspec/tests/issue-rank.test.ts, scripts/validate-frontmatter.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-091: The human priority dial in the next-task resolver - `epic.order`, goal-rank and `priority` as tie-breaks that can never outrank a gate

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves
> it through the normal spec-approval gate before any code changes. Every requirement below
> is written under each decision's recommended option, so approving the spec as it stands
> accepts those recommendations. Choosing a different option changes only the requirements
> that decision names.

Materializes **[#260](https://github.com/AIClarityAU/minspec/issues/260)** - *"goal-rank +
epic.order as deterministic tie-break dimensions in the resolver"* - the resolver follow-up
of [DR-039](../../../docs/decisions/DR-039.md) (goals drive priority), which amends
[DR-019](../../../docs/decisions/DR-019.md) section 2 (the total order).

**Id note.** The four ids after `SPEC-086` are claimed by branches that have not merged
(read from every local and remote ref in this checkout on 2026-10-01; open pull requests
are not visible without a network call, which this dispatch may not make). `SPEC-091` is
the first id above all of them. If it collides at review time, renumber.

## One-Sentence Scope

Pin the within-severity-class order `(epic.order, goal-rank, priority, artifact-id)` as a
tested contract of the next-task resolver, make the one inert dial (`priority:`) live, and
close the four places where the order is currently unprotected, undiagnosable, or not
actually deterministic.

## Context - what the code does today (read from `main` at 27661a68, not inferred)

### Most of the issue's headline is already in the code

The issue was filed when the resolver did not exist. It has since been built under SPEC-012
(the next-task resolver), and the tuple the issue asks for is live:

- **The comparator.** `packages/shared/src/next-task.ts:996-1002` (`compareRanked`)
  compares severity class first, then `epicOrder`, `goalRank`, `priority`, then artifact id.
  An absent dial is `+Infinity`, so it sorts last in its term (`next-task.ts:566`,
  `:594-595`).
- **Goal-rank is read from real files.** `packages/minspec/src/lib/artifact-graph.ts:152`
  (`buildGoalRankMap`) reads the ranked `## Goals` list in `.minspec/constitution.md`, and
  `:181` (`goalRankOf`) resolves an artifact's `goal: G-N` frontmatter ref to that rank.
- **`epic.order` is read from real files.** `artifact-graph.ts:520` passes the epic's
  `order`; all ten epics in `docs/epics/` carry a distinct `order:` from 1 to 10.
- **One test per term exists.** `packages/shared/tests/next-task.test.ts:193-250` (the
  `INV-TIE` block) has one case each for epic order, goal-rank, absent goal-rank, priority
  and artifact id.

So this spec does **not** ask for the comparator to be written. An approver should not read
it as "the dial is unbuilt". What follows is what is still missing.

### Gap 1 - `priority:` is declared but inert

`artifact-graph.ts:522`, `:546` and `:569` pass `priority: undefined` for every epic, spec
and decision record. Nothing parses a `priority:` frontmatter line. DR-019's own amendment
note says so ("that dial is declared but inert"), and DR-038 (the graph view) attributes the
gap to #259/#260.

### Gap 2 - the central safety claim is tested for one dial out of three

The issue's one hard rule is that a dial "never overrides gate-violation/blocked". DR-039's
risk table (R1) names the mitigation: "T0 test asserts ordering precedence". The only such
test is `next-task.test.ts:129` (`INV-SEV-1`), and its fixture varies **`epic.order` only**
(`:111-116`). No test gives a lower-class node a better goal-rank or a better `priority`
than a higher-class node. Likewise, no test sets two dials against each other: every
`INV-TIE` case varies exactly one term, so swapping two adjacent terms in the comparator
would be caught only indirectly, by a parity test against a *copy* of the same comparator
(`packages/minspec/tests/issue-rank.test.ts:281`), not against a stated expectation.

### Gap 3 - a non-numeric dial makes the order depend on input order

Measured, by running `resolvePipeline` on five same-class specs (called S1 to S5 here, in
id order) where S1 and S3 carry `priority: NaN`, S2 has 1, S4 has 2 and S5 has none, once
in id order and once reversed:

| Input order | Pipeline |
|---|---|
| S1 ... S5 | `S1, S2, S3, S4, S5` |
| reversed | `S2, S4, S5, S3, S1` |

The mechanism: `compareRanked` tests `a.priority !== b.priority` (true for `NaN`) and then
`a.priority < b.priority` (false both ways), so it returns "greater" in both directions and
the sort is no longer a consistent order. This is **not reachable from real files today**:
`priority` is always undefined, epic order is guarded by `Number.isFinite`
(`packages/minspec/src/lib/epic-manager.ts:150`), and goal-rank comes from a `\d+` capture
(`artifact-graph.ts:149`). It becomes reachable the moment Gap 1 is closed by a parser that
does `Number(value)`, and it is reachable now for any direct caller of the exported
function. The resolver's first invariant is "same graph, identical pipeline"
(`next-task.ts:12-14`); the guard belongs in the pure core, not only in each adapter.

### Gap 4 - `relates_to` clustering can lift a worse-ranked item above a better one

Measured: three same-class specs with goal-rank 1, 2 and 3, where the rank-1 spec
`relates_to` the rank-3 spec, resolve in the order rank 1, rank 3, rank 2 - the rank-3
item is placed ahead of the rank-2 item. The clustering pass (`next-task.ts:1014-1057`) pulls
related neighbours forward within a class regardless of dials. Its doc comment says it
never moves an element "ahead of a strictly-higher-ranked one" (`:1010-1011`), which holds
for the top element only. SPEC-012 FR-13 calls clustering "a tie-influence only". Today
this costs nothing, because no artifact carries a `goal:` or `priority:` (next paragraph);
once the dial has data, the human's explicit ranking is overridden mid-pipeline by an edge
that was never meant to rank anything. See DQ-2.

### Gap 5 - a mistyped dial is silent, and an unset epic order is a number

- `goal: G-99` (no such goal) resolves to undefined (`artifact-graph.ts:181-185`) and the
  artifact ranks exactly as if it had no goal. Nothing reports it. DR-039 names this
  failure ("a forgotten `goal:` ref or stale goal-rank silently mis-ranks").
- An epic with no parseable `order:` is given **999** (`epic-manager.ts:135`, `:150`), the
  explorer's sort sentinel, and that number is passed to the resolver unchanged
  (`artifact-graph.ts:520`). So an epic with `order: 1000` ranks *after* an epic with no
  order at all. The epic parser also captures the whole rest of the line as the value
  (`epic-manager.ts:76`), so `order: 2  # launch first` parses to not-a-number and silently
  becomes 999.

### Gap 6 - the "why" does not name the dial

SPEC-012 FR-7 requires the next task to show its derivation, and SPEC-012's risk R4 relies
on it: a wrong human-set order must be "diagnosable to the field that caused it". The
`Evidence` shape (`next-task.ts:154-162`) carries the class, the rule and a sentence; it
carries no dial values. When goal-rank decides between two items, nothing the resolver
returns says so. See DQ-3.

### What the dial can and cannot do, given the order DR-039 chose

`epic.order` is compared first. With ten epics on ten distinct orders, goal-rank and
`priority` can only ever reorder items **inside one epic** (or among artifacts with no
epic). That is the decided design (DR-039 section 3: `epic.order` is the coarse dial,
goals the thematic one), not a defect, and this spec does not reopen it. It is stated here
because it bounds what an approver should expect the feature to change.

### There is no live dial data yet

Zero files under `specs/`, `docs/` or `.minspec/` have a frontmatter line starting `goal:`
or `priority:` (counted with a start-of-line match for exactly those two keys). Every
behaviour change below is therefore invisible on today's corpus except the epic-order
sentinel (FR-7), which affects no current ordering either because every epic has an order.
This is the cheap moment DR-039's "Costly to Refactor" section describes.

## Functional Requirements

### The order

- **FR-1 (the within-class key).** Inside one severity class the resolver MUST order nodes
  by the key `(epic.order, goal-rank, priority, artifact-id)`, compared left to right, each
  term ascending (a lower number is more important), with `artifact-id` compared
  numeric-aware (number 2 before number 10). The same key applies in all four classes
  (gate-violation, blocked-ready, promote-parent, pending).
- **FR-2 (a dial never crosses a class boundary).** Severity class MUST be compared before
  any dial, and no dial value may be read while a node's class is being assigned. However
  good its `epic.order`, goal-rank and `priority`, a node MUST NOT precede any node of a
  higher class.
- **FR-3 (a dial never outranks a blocker).** Inside one class, a node with an un-cleared
  `depends_on` blocker in the same class MUST come after that blocker whatever the dials
  say (the existing flooring pass, `next-task.ts:1072`). The dial orders only nodes that
  no dependency already orders.
- **FR-4 (absent means last in that term, nothing more).** An absent dial MUST sort after
  every present value in that term and tie with other absent values, so the next term
  decides. An absent dial is never an error, never a class change, and never a penalty in
  any other term.

### Determinism

- **FR-5 (dials are finite numbers; anything else is absent).** The pure core MUST treat a
  dial that is not a finite number (not-a-number, positive or negative infinity) as absent
  before any comparison. For every input, the comparison MUST be a consistent order: the
  pipeline for a graph and the pipeline for the same graph with each non-finite dial
  removed MUST be identical. Any finite number is valid, including zero, negatives and
  fractions; the resolver does not clamp or round.

### Where each node's dials come from

- **FR-6 (dial source per node kind).** Every ranked node MUST take its three dials by the
  rule below, and a node kind added later MUST state its row before it ships.

  | Node | `epic.order` | goal-rank | `priority` |
  |---|---|---|---|
  | spec nodes (approve, answer open question, phase action) | the spec's parent epic | the spec's own `goal:` | the spec's own |
  | decision-record accept | the record's parent epic | the record's own `goal:` | the record's own |
  | epic promote | the epic's own `order` | the epic's own `goal:` | the epic's own |
  | corruption (cycle, dangling ref, incoherence) | as for the artifact the node targets | same | same |
  | advancing past an un-cleared `depends_on` | the **advancing** artifact, not the blocker it points the human at | same | same |

  A goal is **not** inherited from an epic by its members: every member of one epic already
  shares that epic's `order`, so an inherited goal-rank would tie across exactly the nodes
  it is meant to separate.
- **FR-7 (an unset epic order is absent, not 999).** An epic with no parseable `order:`
  MUST reach the resolver with no order, so it sorts after every epic that has one. The
  explorer's own display sort (`listEpics`) is unchanged.
- **FR-8 (`priority:` is read).** The filesystem adapter MUST read a scalar `priority:`
  frontmatter line on specs, decision records and epics, tolerate a trailing `# comment`,
  and pass a finite number through. The value domain is a number, lower first (DQ-4).

### Never silent, never a gate

- **FR-9 (an unusable dial is reported, and ranks as absent).** When a dial is written but
  unusable - a `goal:` ref that names no goal in the constitution's `## Goals`, a
  `priority:` or `order:` that is not a finite number - the artifact MUST rank as if that
  dial were absent (FR-4), and `npm run validate` MUST print one warning naming the file,
  the field and the raw value. It MUST NOT fail validation and MUST NOT create a
  gate-violation node (DQ-1). The adapter exposes these as data
  (`{ artifactId, field: 'order' | 'goal' | 'priority', raw, reason }`), so the warning and
  any later surface read one source.

### Diagnosable

- **FR-10 (the evidence names the dials).** Every `NextTask` MUST carry the normalised
  dials it was ranked with, as an optional additive field on its evidence
  (`dials: { epicOrder?, goalRank?, priority? }`, absent terms omitted). Existing consumers
  that do not read it are unaffected. (DQ-3.)

### Interaction with the rest of the ordering

- **FR-11 (clustering yields to the dial).** `relates_to` clustering MUST only reorder
  nodes that are equal on class and on all three dials. It MUST NOT place a node ahead of
  one that the FR-1 key ranks strictly better on a dial term. (DQ-2.)
- **FR-12 (one order, wherever it is used).** `scripts/lib/issue-rank.ts:442`
  (`structuralOrder`) reimplements the within-class key for issue ranking. It MUST apply
  the same FR-4, FR-5 and FR-7 rules, and the existing parity property test
  (`packages/minspec/tests/issue-rank.test.ts:281`) MUST be extended to draw non-finite
  dial values so the two cannot drift on normalisation.
- **FR-13 (what "equally next" means).** For SPEC-012 FR-14 (ties are an equivalence
  class), the tie band is the set of nodes equal on class and on all three dials.
  `artifact-id` only picks a reproducible representative and carries no meaning. This spec
  fixes the definition; reporting "N equally-next tasks" stays with SPEC-012 and is not
  built here.

### Proof

- **FR-14 (the contract is tested against stated expectations).** A new T0 suite,
  `packages/shared/tests/next-task-dials.test.ts`, MUST contain:
  1. **Class dominance, per dial.** For each of the three boundaries between adjacent
     classes and each of the three dials, a fixture where the lower-class node has the best
     value and the higher-class node the worst or none; the higher class still comes first.
  2. **Term precedence.** For each adjacent pair of terms (order over goal-rank, goal-rank
     over priority, priority over id), a fixture where the two terms disagree.
  3. **Absent last**, per term, and absent ties with absent.
  4. **Blocker over dial** (FR-3): a dependent with the best dials still follows its
     blocker.
  5. **Non-finite equivalence** (FR-5), as a property over generated graphs.
  6. **Dial source** (FR-6): the advancing-past node ranks by the advancing artifact's
     dials; an epic-promote node by the epic's own.
  7. **Evidence** (FR-10) and **clustering** (FR-11), under the recommended options.

  Each case in items 1 and 2 MUST be shown to fail against a deliberately broken
  comparator (the two terms swapped, or the class comparison moved after a dial) before it
  is accepted - a test that stays green under the mutation it exists to catch proves
  nothing.

## Acceptance Criteria

- [ ] A pending node with `epic.order` 1, goal-rank 1 and `priority` 1 sorts after a
      gate-violation node with no dials at all, and the same holds across each of the three
      class boundaries for each dial separately. (FR-2, FR-14.1)
- [ ] With the `epicOrder` and `goalRank` comparisons swapped in `compareRanked`, at least
      one FR-14.2 case fails; likewise for `goalRank` and `priority`. Recorded in the pull
      request. (FR-1, FR-14)
- [ ] A spec with the best dials in its class that `depends_on` an un-cleared spec in the
      same class appears after that spec. (FR-3)
- [ ] The five-spec fixture from Gap 3 yields the same pipeline in both input orders, and
      the same pipeline as the fixture with the non-numeric values deleted. (FR-5)
- [ ] An epic file with no `order:` line produces an epic node with no order, and its
      members sort after members of an epic with `order: 1000`. (FR-7)
- [ ] A spec with `priority: 2  # after launch` produces a spec node with priority 2; a
      spec with `priority: soon` produces no priority and one validate warning. (FR-8, FR-9)
- [ ] A spec with `goal: G-99` under a constitution that has no `G-99` ranks as if it had
      no goal, `npm run validate` prints one warning naming the file and `goal`, validation
      still exits zero, and the pipeline contains no gate-violation node for it. (FR-9)
- [ ] The next task's evidence lists the dial values it was ranked with. (FR-10)
- [ ] The Gap 4 fixture resolves in goal-rank order (1, 2, 3); the existing
      `FR-13-relates-cluster` test (`next-task.test.ts:546`, four dial-less specs) still
      passes unchanged. (FR-11)
- [ ] The issue-rank parity property test draws non-finite dials and passes. (FR-12)
- [ ] `packages/shared/src/next-task.ts` still imports nothing and reaches no `vscode`,
      filesystem, network, clock or random source. (INV-1)

## Invariants (must not break)

- **INV-1 - Deterministic, offline core (constitution invariant 1; DR-019 sections 1 and
  6; SPEC-012 FR-1, FR-11).** The resolver stays a pure function in `packages/shared`.
  Dials are read from frontmatter and the constitution; nothing is inferred, scored by a
  model, or fetched.
- **INV-2 - The signpost does not lie (DR-039 section 3 and risk R1).** A dial is a
  tie-break inside a severity class. It never lifts a blocked or lower-class item above the
  thing that blocks or outranks it.
- **INV-3 - No silent gate, and no invented one (constitution invariant 2).** This spec
  adds no merge-gating check. The FR-9 warning is advisory by design and says so; it must
  never be the only witness for anything a merge depends on.
- **INV-4 - Read, never inferred (DR-019 section 3; DR-039 section 2).** The engine never
  guesses a goal, an order or a priority for an artifact that does not declare one, and
  never writes one.
- **INV-5 - Severity classes untouched (SPEC-012 "Costly to Refactor" item 3).** The
  number, names and order of the four classes do not change.
- **INV-6 - Unannotated work is not punished (FR-4).** A corpus with no `goal:` and no
  `priority:` anywhere resolves exactly as it does today.
- **INV-7 - Blast radius (constitution invariant 3).** Only files inside the repository
  that opted in are read; nothing is written anywhere.

## Decisions needed (Clarify)

Each decision carries a recommendation and its cost. The requirements above assume the
recommended option in every case.

### DQ-1 - What happens when a dial is written but unusable (`goal: G-99`, `priority: soon`)?

- **Option A - rank as absent, warn in `npm run validate` (rec).** FR-9 as written.
  *Cost:* a warning is easy to miss, so a typo can mis-rank an item until someone reads
  validate output; nothing stops the merge.
- **Option B - treat it as corruption: a top gate-violation node.** Consistent with
  SPEC-012 FR-13's rule that an id which does not resolve is corruption. *Cost:* one typo
  in an optional ranking hint replaces the real next task with "state unclear". The same
  shape already went wrong once: a dangling `relates_to` was promoted to a gate-violation
  and buried every real task, and was reverted for that reason (`next-task.ts:332-341`,
  #893).
- **Option C - stay silent (today's behaviour).** *Cost:* the failure DR-039 itself lists
  as its first negative consequence stays undetectable.

### DQ-2 - May `relates_to` clustering move an item ahead of one the dial ranks higher?

- **Option A - no; clustering acts only among items equal on all three dials (rec).**
  FR-11 as written. Matches SPEC-012 FR-13's own wording ("a tie-influence only"). *Cost:*
  related items stop being pulled together whenever their dials differ, so two kindred
  specs in different epics will sit apart in the pipeline; and it changes shipped ordering
  behaviour, though no current file is affected because no dial data exists.
- **Option B - yes; keep today's behaviour.** Clustering may reorder anything below the
  top item. *Cost:* the expanded pipeline can show a goal-rank-3 item above a goal-rank-2
  item with nothing explaining why, which is the "human set it, tool ignored it" outcome
  the dial exists to prevent. FR-11 is dropped and the doc comment at
  `next-task.ts:1010-1011` must be corrected to say what the code does.

### DQ-3 - Should the next task say which dial values ranked it?

- **Option A - yes; add an optional `dials` field to the evidence (rec).** FR-10 as
  written. Makes SPEC-012's risk R4 mitigation true. *Cost:* it widens the resolver's
  output shape, which SPEC-012 lists as a costly-to-change seam (four consumers:
  `commands/next-task.ts`, `views/status-bar.ts`, `extension.ts`, `scripts/next-task.ts`);
  additive and optional, but once a surface renders it, it is part of the contract.
- **Option B - no; leave the evidence as it is.** FR-10 and its acceptance line are
  dropped. *Cost:* a wrong order caused by a stale goal or priority can only be diagnosed
  by opening the files and comparing frontmatter by hand.

### DQ-4 - What is a `priority:` value?

- **Option A - a number, lower first (rec).** FR-8 as written. Same direction as
  `epic.order` and goal-rank, and the shape the resolver's type and existing test already
  assume (`next-task.ts:74-75`, `next-task.test.ts:227`). *Cost:* "priority 1 beats
  priority 5" reads backwards to anyone who expects a bigger number to mean more
  important, and once values are authored across the corpus the direction is expensive to
  flip.
- **Option B - named levels (`P0` to `P3`).** *Cost:* a second vocabulary beside two
  numeric dials, a mapping table to maintain, and a change to the resolver's typed input;
  needs an amendment to DR-039 before Plan because the value domain becomes corpus data.
- **Option C - leave `priority:` inert for now.** FR-8 is dropped and the tuple's third
  term stays declared-but-unread, as DR-019's amendment note already describes. *Cost:*
  the issue's stated tuple is only two-thirds live, and the fine dial DR-039 keeps as "an
  optional fine override" still does nothing.

## Why no new DR

The decision this spec implements is already recorded: DR-039 section 3 (the tuple, and
that it never overrides a gate) and the amendment note in DR-019 section 2. Under the
reversibility filter (can it be undone in under a day), everything here is a revertable
change to one pure function, one adapter and tests, on a corpus with zero `goal:` and zero
`priority:` values. The register was searched for "priority", "goal", "epic.order" and
"tie-break" before concluding this; DR-039 and DR-019 are the only in-force records on the
subject. A decision record becomes necessary only if DQ-4 resolves to Option B, which
changes what DR-039 says a `priority:` is.

## Out of Scope

- **The `## Goals` section format and its parser** - what counts as a goal line, whether
  rank is the typed numeral or the position in the list, how a retired goal keeps its
  slot. That is #259. One observation for it, not absorbed here: rank is taken from the
  typed numeral (`artifact-graph.ts:149`, `:171`), so a list a human reorders without
  renumbering keeps its old ranks.
- **Adding `goal:` or `priority:` values to existing artifacts.** Mapping is human
  judgement (DR-039 section 2); the engine and this work never write one.
- **Drag-and-drop reordering of epics and goals** (#261) and **auto-derived WSJF** (#262).
- **Reporting "N equally-next tasks"** (SPEC-012 FR-14) - only its definition is fixed
  (FR-13).
- **Milestones, the repair ladder, and new node kinds** (SPEC-012 FR-3b, FR-15, and the
  in-flight node work). FR-6 only requires that a new node kind declare its dial source.
- **Editing SPEC-012.** It already states the four-term order (its FR-2 and FR-3); this
  spec refines the contract beside it rather than rewriting an approved document. SPEC-012's
  open question OQ4 (whether `epic.order` is the right tie-break between gate violations in
  different epics) is answered in practice by FR-1 applying one key to every class, which
  is what the issue asks for; closing OQ4 formally remains SPEC-012's to do.
- **Changing the explorer's epic sort** or the 999 sentinel inside `listEpics`.

## Alternatives considered and rejected

Recorded because this spec was written without a live conversation (DR-086 section 4).

- **Treating #260 as already done and closing it.** Rejected: the comparator exists, but
  the issue's one hard rule is protected by a test for one dial in three, the third term
  reads nothing, and two measured behaviours (Gaps 3 and 4) contradict the stated
  contract.
- **Inheriting an epic's goal onto its members.** Rejected in FR-6: it cannot change any
  ordering, because members of one epic already tie on `epic.order`.
- **Normalising non-finite dials only in the filesystem adapter.** Rejected: the function
  is exported and has a second caller path in `scripts/`; determinism is the core's
  invariant, so the core must hold it for every input.
- **Making goal-rank outrank `epic.order`.** Not considered open: DR-039 section 3 fixes
  the order of terms.
- **Replacing the second comparator in `scripts/lib/issue-rank.ts` with a shared export.**
  Not required: its key deliberately inserts an epic-slot term the signpost does not have
  (`issue-rank.ts:468-474`). The parity test is the witness (FR-12); merging the two is a
  refactor the Plan phase may choose but this spec does not demand.

## Rollback

All changes are to a read-only derived view. Reverting the diff restores today's ordering
with no data migration: the FR-9 diagnostics and the FR-10 evidence field are additive, and
`priority:` lines authored meanwhile become inert frontmatter that nothing rejects.

## Test plan (for the Plan phase to place)

- **T0, before implementation:** `next-task-dials.test.ts` items 1 to 6 (FR-14). Items 1
  to 4 and 6 are expected green on current code apart from the mutation check; item 5 and
  the FR-11 clustering case are expected red on current code (Gaps 3 and 4 above).
- **T1:** adapter cases in `artifact-graph-fidelity.test.ts` for FR-7, FR-8 and FR-9.
- **Parity:** the extended property test in `issue-rank.test.ts` (FR-12).
- **Run the suite the way CI does** (`npx vitest`), not only through `npm test`.

## Traceability

- **Issue:** [#260](https://github.com/AIClarityAU/minspec/issues/260).
- **Governing decisions:** [DR-039](../../../docs/decisions/DR-039.md) (goals drive
  priority; section 3 is the tuple and the never-overrides-a-gate rule),
  [DR-019](../../../docs/decisions/DR-019.md) (deterministic next-task order; section 2 as
  amended), [DR-038](../../../docs/decisions/DR-038.md) (the graph view, which records the
  dials as inert on live data).
- **Refines:** [SPEC-012](../SPEC-012-next-task-resolver/requirements.md) FR-2, FR-3, FR-7,
  FR-13 and FR-14, without editing it.
- **Adjacent, not absorbed:** [#259](https://github.com/AIClarityAU/minspec/issues/259)
  (Goals section, `goal:` ref and parser),
  [#261](https://github.com/AIClarityAU/minspec/issues/261) (drag-and-drop reorder),
  [#262](https://github.com/AIClarityAU/minspec/issues/262) (auto-derived WSJF).
- **DR for this spec:** none, by design; see "Why no new DR" for the one condition that
  would require it.
