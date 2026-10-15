---
id: SPEC-182
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity
depends_on: [SPEC-012]  # SPEC-012 owns the resolver, FR-2 severity classes and FR-13 edge model this corrects
relates_to: [SPEC-010, "#346", "#286"]
implements: none
implements_reason: >-
  Specified, not built. This spec only corrects ordering in `resolvePipeline`
  (packages/shared/src/next-task.ts:1179), which SPEC-012 already owns; it claims no new files.
---

# SPEC-182: Resolver must never rank a blocked artifact above its un-cleared blocker

Issue: #346 (never-wrong P1, found by the retroactive merged-PR audit, DR-033 section 6).
Parent contract: SPEC-012 FR-13 ("a dependent MUST rank below an un-cleared `depends_on` target")
and FR-6 (the pipeline carries the same order). Hardens the flooring first added in #286.

**Scope sentence.** Make `resolvePipeline` / `resolveNextTask` order every un-cleared
`depends_on` blocker before its dependent in the whole returned queue, across severity classes
and after `relates_to` clustering, and pin it with an invariant test.

## Context (verified against `packages/shared/src/next-task.ts` on this branch)

Two live holes, both reproduced by the issue author and re-read here:

1. **Cross-class (blocker severity).** `floorDependsOn` (`:1094`) delegates to `topoFloorBlock`
   (`:1130`), which only reorders inside one `classRank` run (`:1100-1107`). Its comment
   (`:1085-1089`) assumes cross-class dependencies are "already separated by classRank or surfaced
   as an advance-past gate-violation". Neither holds when a higher-class dependent depends on a
   lower-class blocker. `blockedOrPending` (`:560`-area) makes an unapproved spec under an
   `active` epic `blocked-ready` (rank 1) and an unapproved spec with no epic `pending` (rank 3).
   The advance-past gate-violation is only emitted for advancing nodes (`isAdvancing`), and an
   unapproved/specifying spec is not advancing. Result: SPEC-4 (active epic, depends_on SPEC-2)
   is returned as the single next task above SPEC-2.
2. **Cluster after floor.** `resolvePipeline` (`:1179`) runs `clusterRelatesTo` (`:1036`) after
   `floorDependsOn`. Clustering pulls a node's `relates_to` neighbours directly behind it and
   never reads `depends_on`, so it can lift a dependent above its blocker inside one class
   (SPEC-1 relates_to SPEC-4, SPEC-4 depends_on SPEC-2 gives `[1, 4, 2, 3]`). `[0]` is unaffected
   (clustering never moves a node earlier than its own slot), so this one is wrong pipeline
   order (FR-6), not a wrong next task.

No existing test covers either: the FR-13 tests use same-class blockers, and the cluster test
uses no `depends_on` edge.

## Requirements

- **FR-1 (blocker precedes dependent, everywhere).** For every un-cleared `depends_on` edge
  D -> B where both D and B have a node in the queue, B's node MUST appear before D's node in
  `resolvePipeline`, regardless of the severity class either was assigned. Consequently
  `resolveNextTask` MUST NOT return a node whose artifact has an un-cleared `depends_on` target
  that also has a queued node.
- **FR-2 (severity is a ranking input, not a licence to jump a blocker).** Cross-class
  correction MUST be applied as ordering, after the FR-2 class sort (SPEC-012), and MUST NOT
  change any node's reported `severityClass` or `evidence` (the label the human reads stays
  truthful about why a node exists). Which mechanism applies is Decision D1.
- **FR-3 (clustering cannot undo flooring).** The final order MUST satisfy FR-1 after
  `relates_to` clustering. `relates_to` stays a tie-influence only (SPEC-012 FR-13): when
  clustering and flooring conflict, flooring wins, and clustering applies only where it breaks
  no `depends_on` order.
- **FR-4 (blocker with no queued node).** An un-cleared blocker that has no node in the queue
  (e.g. it is `implementing`, so nothing is asked of the human on it) cannot be ordered against.
  Behaviour is Decision D2; whatever is chosen MUST be visible, never a silent drop.
- **FR-5 (transitive chains).** FR-1 holds transitively: for D -> B -> C with all un-cleared,
  order is C, B, D even when they sit in three different classes.
- **FR-6 (cycles stay corruption, never a hang).** A `depends_on` cycle remains the SPEC-012
  FR-15 corruption path. The new pass MUST terminate on a cycle, keep every node (none dropped)
  and keep its prior relative order for the cycle members.
- **FR-7 (no regression of untouched orderings).** With no `depends_on` edge, or only
  edges already in order, output MUST be byte-identical to today's. Determinism (SPEC-012 FR-1,
  FR-14) is preserved: same input, same order, no LLM, no network.
- **FR-8 (node identity).** Several nodes may share an `artifactId` (open question plus
  implement hole, #1436). The pass MUST key "already emitted" per node and "blocker satisfied"
  per artifact, as `topoFloorBlock` documents; it MUST NOT drop a node.
- **FR-9 (stale design comment).** The comment asserting cross-class deps are "already
  separated" MUST be replaced with the true contract, in the same change (a stale comment is a
  false signpost).

## Decisions needed (Clarify)

**D1. How to correct a cross-class dependent.**
- **A (rec): sink the dependent.** Compute an effective sort position for D no better than its
  deepest queued blocker's, ordering by the real class sort first and moving only D (and its
  transitive dependents) behind the blocker. Fewest changes; blocker keeps its own class. Cost:
  an important blocked-ready item in an active epic can drop below unrelated pending items that
  sit between it and its blocker, so the epic-order the founder set is locally overridden
  (correct by FR-13, but visible as a surprise).
- **B: lift the blocker.** Blocker inherits the best class of anything it blocks (priority
  inheritance). The human is told to do the blocker first, which is arguably the more useful
  signpost. Cost: it changes which node the epic/goal dials consider urgent, and it must either
  alter `severityClass` (violates FR-2 above) or order by a hidden effective class the evidence
  does not explain.
- **C: withhold the dependent.** Remove blocked dependents from the queue until the blocker
  clears. Simplest to reason about. Cost: the queue silently shrinks, which hides pending work
  and conflicts with SPEC-012 FR-6 (the pipeline is the full queue).

**D2. Un-cleared blocker with no queued node (FR-4).**
- **A (rec): leave the dependent queued, attach evidence.** Add the blocker to the dependent's
  `evidence.refs`/explanation ("blocked by SPEC-N, not yet actionable") so the human sees why.
  Cost: the signpost can still name a task the human cannot yet finish, though it now says so.
- **B: demote to last.** Treat the dependent as lowest in its class. Cost: arbitrary position,
  and no explanation unless A's evidence is also added.
- **C: surface a gate-violation node.** Cost: widens SPEC-012 FR-2.1 beyond advancing nodes,
  so a merely-unapproved spec becomes a top-priority violation; overstates severity.

**D3. Order of passes (FR-3).**
- **A (rec): cluster, then floor.** Floor last, so the hard constraint always wins. Cost:
  flooring may break a cluster's adjacency (acceptable, clustering is advisory).
- **B: floor, then cluster with a depends_on guard.** Cluster never emits D before an
  un-cleared B. Cost: a more complex clustering pass and two places that must agree.

## Acceptance Criteria

- **AC-1 (cross-class, the issue's repro).** epics=[EPIC-1 active]; specs=[SPEC-4 unapproved
  epic EPIC-1, SPEC-2 unapproved no epic]; edge depends_on SPEC-4 -> SPEC-2. `resolveNextTask`
  MUST NOT return SPEC-4; pipeline order has SPEC-2 before SPEC-4. (FR-1)
- **AC-2 (cluster interaction, the issue's repro).** SPEC-1..4 same class; depends_on
  SPEC-4 -> SPEC-2; relates_to SPEC-1 -> SPEC-4. SPEC-2 precedes SPEC-4 in the pipeline. (FR-3)
- **AC-3 (transitive, three classes).** D -> B -> C across three classes yields C, B, D. (FR-5)
- **AC-4 (property invariant).** For generated graphs mixing classes, epics, `depends_on` and
  `relates_to` edges, no queued node precedes a queued un-cleared `depends_on` target, and
  `resolveNextTask` never returns a node with a queued un-cleared target. This is the
  RCDD Phase 4 asymmetry test the issue asks for. (FR-1, FR-3)
- **AC-5 (cycle).** A two-node `depends_on` cycle terminates, keeps both nodes, and reports
  corruption as before. (FR-6)
- **AC-6 (no-op).** Existing `next-task.test.ts` cases pass unchanged; a graph with no
  `depends_on` edges is byte-identical. (FR-7)
- **AC-7 (shared artifact).** An artifact with two nodes keeps both after the pass. (FR-8)
- **AC-8 (labels unchanged).** The cross-class dependent keeps its original `severityClass`. (FR-2)

## Invariants this change must not break

- **INV-1 never wrong.** A dependent never outranks its un-cleared blocker (the bug itself).
- **INV-2 deterministic and offline.** Pure function of the graph; no LLM, no network
  (constitution invariant 1; SPEC-012 FR-1).
- **INV-3 no silent drop.** Every node in the unfloored queue is in the floored queue (FR-6, FR-8).
- **INV-4 relates_to never gates.** Clustering stays advisory (SPEC-012 FR-13).
- **INV-5 no silent gate (constitution invariant 2).** The un-orderable blocker case (FR-4)
  fails visibly, not by quietly hiding or reordering.
- **INV-6 same behaviour for opted-out repos.** Change is confined to the shared resolver; no
  write, hook or CI change (constitution invariant 3).

## Out of scope

- Implementing any of this (this dispatch is Specify only).
- Changing SPEC-012's class definitions or `epic.order` dials.
- Edits to the approved SPEC-012 text; its FR-13 already states the intended behaviour. Any
  wording change there is a separate approved edit.

## Follow-ups (tracked)

None beyond this spec's own implementation, which is created from its Plan phase.
