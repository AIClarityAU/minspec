---
id: SPEC-012
type: requirements
status: implementing
tier: T4
product: minspec
epic: EPIC-002  # Signpost Integrity
relates_to: [DR-047, SPEC-031]
# FR-16/FR-17/FR-18 (added for #528, DR-047 §2) generalise the human-gate predicate from
# PR-only (ai-review:pass ∧ mergeable ∧ checks-green) to every human-gated node kind. This
# is new content on top of an already-`implementing`, already-approved spec: editing these
# FRs intentionally stales the DR-012 content hash so the extension re-asks for approval —
# per DR-012 the hash lock applies only after Approve Spec, and this file was approved
# before #528 existed. `status: implementing` is left unchanged because the bulk of this
# spec (FR-1 through FR-15) already ships; only the FR-16/17/18 slice is new, unbuilt, and
# — per DQ-1/DQ-2 below — partly dormant-by-design pending #527's per-type reviewer.
implements:
  - packages/shared/src/next-task.ts
  - packages/shared/tests/next-task.test.ts
  - packages/minspec/src/commands/next-task.ts
  - packages/minspec/tests/next-task-command.test.ts
  - packages/minspec/src/lib/artifact-graph.ts
  - packages/minspec/tests/artifact-graph-realdata.test.ts
  - packages/minspec/tests/artifact-graph-degrade.test.ts
  - packages/minspec/tests/artifact-graph-fidelity.test.ts
  - packages/minspec/tests/implement-hole.test.ts
# PARTIAL, and the partiality is first-party: next-task.ts:29-45 names FR-1/FR-2/FR-9/FR-11/FR-15
# as shipped and FR-3b (MILESTONE-NNN), FR-15's LLM-escalation half, PR-review nodes and explorer
# decoration as "out of this slice" (zero `MILESTONE` hits confirm). Ownership is not contingent
# on every FR landing.
# Resolver core + its test born in 1b7b90f8; the fs-adapter, command and four graph tests all in
# 28bdd8ef ("signpost wiring … [SPEC-012]"); implement-hole.test.ts in 2eb4d4de (#1436/#1467).
# artifact-graph.ts's own header names the SPEC-012 resolver as its sole purpose, and its only
# non-test importer is commands/next-task.ts.
# No `affects:`. `views/status-bar.ts` hosts three unrelated status bars (SPEC-012's signpost at
# :21, harness-refresh #758 at :137, tidy-primary #1162 at :196); `extension.ts` (1025 lines) is
# the shared activation entrypoint; `invariants.test.ts` predates this spec; `shared/src/index.ts`
# is a 7-module barrel. Freezing any of them corpus-wide is not warranted — explicit exclusion,
# not an assertion that nothing else was touched. SPEC-040/041/046/059 already list next-task.ts
# and/or artifact-graph.ts under their own `affects:`, which is the correct shape: they touch what
# this spec owns.
---

# MinSpec — Next-Task Resolver (Requirements)

**Date:** 2026-06-01
**Status:** Implementing (SDD Implement phase)
**Decision:** [DR-019](../../../docs/decisions/DR-019.md) (this spec is the contract that decision governs)
**Triggered by:** session request — "a prioritised list of docs/specs/epics/DRs I need to approve … but actually I don't need a list, just the next task; priority via DAG not LLM."
**Epic:** [EPIC-002 Signpost Integrity](../../../docs/epics/EPIC-002-signpost-integrity.md)
**Resolves:** [SPEC-010](../SPEC-010-signpost-correctness/requirements.md) Open Question #1 (global topological ordering across simultaneously-pending items).

---

## Context

[SPEC-010](../SPEC-010-signpost-correctness/requirements.md) makes the **within-feature**
signpost correct: for one feature's `spec→plan→tasks→code` chain it derives the
single next SDD *phase action* ("plan FR-4", "implement task 3"). It explicitly
left open (OQ#1) what happens when **multiple** features / decisions are pending
at once: which single step surfaces *globally*.

Separately, MinSpec has a second class of pending state SPEC-010 does not model:
**cross-artifact approval / status gates** the *human* must clear —

- a **spec** awaiting approval before implement (DR-012 content-hash gate),
- an **epic** still `proposed` that must be promoted to `active` before its
  children are real,
- an **ADR** still `proposed` awaiting accept/reject.

The product promise (EPIC-002) is that MinSpec is **always opinionated about what
must happen next**. The realised form of that promise is **one next task for the
human dev** — not a list. A list is a backlog; a backlog is what MinSpec exists to
collapse into a single pointer. The list is at most an *optional expansion* to
sense the pipeline.

This spec defines the **Next-Task Resolver**: a deterministic engine that unifies
every pending human decision (SPEC-010 phase actions + the three approval/status
gates) into one total order and emits **the single next human task**, with an
optional ranked pipeline behind it.

### Two queues, never merged

The next task is **what the human dev must do** — approve, promote, accept,
author a phase. It is **not** the agent/LLM work queue (the dispatch system,
`scripts/`, agent-execute). Those are a separate substrate with their own
ordering. Conflating them would put "LLM is writing task 3" into the human's
signpost, which is noise. The resolver models the **human** queue only.

## State Model

Each **pending human decision** is a node:

| Node kind | Pending when | Cleared by |
|---|---|---|
| `epic-promote` | epic `status: proposed` **∧ greenlit** (`ai-review/epic:pass`, FR-16) | promote → `active` |
| `spec-approve` | spec unapproved/stale AND not `done`/`archived` (DR-012) **∧ greenlit** (`ai-review/spec:pass`, FR-16) | Approve Spec |
| `adr-accept` | ADR `status: proposed` **∧ greenlit** (`ai-review/dr:pass`, FR-16) | accept/reject |
| `constitution-accept` *(new, FR-17)* | constitution invariant `status: proposed` **∧ greenlit** (`ai-review/constitution:pass`) | accept/reject |
| `pr-review` *(new, FR-17 — subsumes #182)* | PR-to-main open ∧ mergeable ∧ checks-green **∧ greenlit** (`ai-review:pass`) | merge |
| `phase-action` | SPEC-010 within-feature hole (uncovered FR / unchecked task) — **not** gated by FR-16: a phase-action is SPEC-010-owned work, not a reviewed Approvable type | author the phase |

The greenlit clause on every row above except `phase-action` is this spec's #528 addition
(FR-16/FR-17, DR-047 §2). `plan-approve` is deliberately **absent** from this table — see
Decisions needed → DQ-3.

Edges are of two kinds. **(a) Implicit SDD-tree edges** — derived from structure,
always present:

```
epic(active) ──gates──▶ spec-approve, adr-accept, phase-action of its members
spec(approved) ──gates──▶ implement phase-action of that spec   (DR-012)
phase predecessor ──gates──▶ phase successor                    (SPEC-010 chain)
```

**(b) Explicit cross-cutting edges** — arbitrary dependencies between *any* two
artifacts, *outside* the tree, that the SDD hierarchy cannot express: "this spec
is blocked by that ADR being accepted", "this DR depends on those DRs", "this spec
supersedes that one". Today these live only in prose (`Triggered by:`, `Resolves:`,
`composes`) and are invisible to the engine. They MUST become machine-readable
frontmatter edges (FR-13) so the resolver can rank a blocked node below its
blocker. The union of (a) + (b) is the dependency DAG; **it MUST be acyclic — a
cycle is corruption** (FR-15), and acyclicity is itself a free correctness check.

A node whose gate is **unsatisfied while downstream work has already started** is
a **gate violation** (e.g. spec `implementing` but unapproved; spec `implementing`
under a `proposed` epic; a spec advancing while an ADR it `depends_on` is still
`proposed`). Violations are detectable purely structurally and rank highest — they
are live invariant breaches, not future work.

## Requirements

### Determinism & layering

- **FR-1 (deterministic ranking, no LLM — *derive, never guess*).** The priority
  *ranking* MUST be a pure function of filesystem + frontmatter + approval +
  dependency-edge state. Same inputs → same ranking. No LLM, no network, no hidden
  state. The single permitted non-determinism is an arbitrary choice **among a true
  priority tie** (FR-14) — never in the ranking itself. An LLM-derived next-task is
  non-reproducible and untestable; it is forbidden here. (Tier 0, DR-004; DR-019.)
- **FR-2 (severity classes — partial order).** Every pending node is assigned
  exactly one severity class, ranked:
  1. **gate-violation** — downstream work proceeding past an unsatisfied gate
     (incl. an unsatisfied explicit `depends_on`, FR-13).
  2. **blocked-ready** — at a gate whose clearance unblocks the next phase, under
     an `active` epic, with all `depends_on` already cleared.
  3. **promote-parent** — a `proposed` epic with members waiting on it.
  4. **pending** — remaining `proposed` ADRs / unapproved specs.
  Order **within** a class by `(epic.order, goal-rank, priority, artifact-id)` (FR-3 dials;
  `artifact-id` is the final deterministic tie-break). This yields a partial order
  whose top band may contain ties (FR-14); the **next task** is any member of that
  top band.
- **FR-3 (subjective weight is explicit data, never inferred).** Any priority
  input that is a human judgement — relative importance of independent branches —
  MUST be read from explicit frontmatter, NOT inferred by the engine and NOT
  inferred by an LLM. Three dials: `epic.order` (coarsest, cross-epic), `goal-rank`
  (mid, DR-039 §3) and a per-spec
  `priority:` field (finest, within a tie — applied at the `(epic.order, goal-rank, …)`
  tie-break, ahead of `artifact-id`). Prose in CLAUDE.md ("ScroogeLLM is future")
  is invisible to the resolver until lifted into structured data. The engine
  computes structure; the human sets weight.
- **FR-3a (deferral is a link to a blocker, never a bare boolean).** "Not now"
  MUST be expressed as a dependency on the thing that unblocks it — reusing
  `depends_on` (FR-13) — not a standalone `deferred: true` flag. A boolean rots:
  it is set once and never unset, so the item stays hidden after its real blocker
  clears. A link instead (a) **auto-clears** when the blocker clears, (b) is
  **explainable** ("hidden because blocked on EPIC-003"), and (c) reuses one
  mechanism. Consequently a deferred node is simply a node with an un-cleared
  `depends_on`, which FR-13 already ranks below its blocker — no separate
  "deferred floor" rule is needed. Purely-temporal deferral with no artifact
  blocker ("after public launch") MUST still link a *named* target, never a flag:
  a **milestone artifact** (`MILESTONE-NNN`, FR-3b) the item `depends_on`.
- **FR-3b (milestones are first-class blockers).** A `MILESTONE-NNN` is a
  lightweight registered artifact (id, title, `status: open|reached`) that exists
  solely to be a `depends_on` target for time/event-based deferral with no spec/DR
  blocker. It clears (unblocks dependents) when a human marks it `reached`. Keeps
  deferral one mechanism end-to-end — temporal "later" becomes "blocked on
  MILESTONE-003 (public launch)", auto-clearing on reach, no rotting boolean.
- **FR-4 (composes with SPEC-010, does not duplicate).** SPEC-010's per-feature
  resolver is consumed as the `phase-action` node source. This spec adds the
  cross-artifact gate nodes and the **global** ordering across all node kinds. It
  MUST NOT re-implement SPEC-010's coverage predicates.

### Output surface

- **FR-5 (single next task is primary).** The primary output is **one** next
  human task: kind, target artifact id, one-line imperative ("Approve SPEC-001",
  "Promote EPIC-004", "Accept DR-003", "Plan FR-4 of SPEC-006"), and the action
  that clears it. Not a list.
- **FR-6 (pipeline is optional expansion).** The full ranked queue MUST be
  available on demand (expand) for pipeline awareness, but MUST be secondary to
  FR-5 — collapsed by default. Sensing what's coming ≠ working a list.
- **FR-7 (show the evidence — *why, not just what*).** The next task MUST be able
  to show its derivation: the severity class and the gate that produced it
  ("gate-violation: SPEC-001 is `implementing` but unapproved → approve before
  implement, DR-012"). A wrong next-task MUST be diagnosable to the artifact +
  rule that caused it.
- **FR-8 (human queue only — never the agent queue).** The resolver MUST model
  only human decisions. Agent/LLM dispatch work MUST NOT appear as a next task.
  The two queues are separate surfaces (INV — Two Queues).
- **FR-8a (signpost anchored to plan, not to dev activity).** The canonical next
  task is derived solely from artifact + frontmatter + edge state (FR-1). A
  developer **deviating** from it — working out of order, hacking on something
  off-plan — is allowed and is NOT an input to the resolver: it MUST NOT re-rank or
  change the canonical next task. The signpost reflects *what the plan says is
  next*, not *what the dev is doing now*. Deviation only ever moves the signpost by
  changing artifact state (e.g. completing a phase, clearing a gate). Distinct from
  INV #5 override, which is an *explicit* dismissal the dev records; silent
  deviation records nothing and the signpost holds its ground.

### Coherence precondition

- **FR-9 (status-coherence validation, deterministic).** Before emitting a next
  task the resolver MUST check structural coherence: a child MUST NOT be further
  along than its parent (e.g. spec `implementing` under a `proposed` epic; ADR
  `accepted` under a `proposed` epic). A coherence breach is surfaced as the
  highest-priority *gate-violation* next task ("resolve: SPEC-004 implementing
  under proposed EPIC-004"), not silently ranked among normal work.
- **FR-10 (honest degradation — reuse SPEC-010 FR-6).** If state is incoherent
  beyond the FR-9 rules (dangling epic refs, malformed frontmatter), the resolver
  MUST say "state unclear — <file>" rather than fabricate a confident next task,
  and route to the repair ladder (FR-15).

### Cross-cutting dependencies, ties & corruption repair

- **FR-13 (explicit cross-cutting edges — three kinds).** Artifacts MUST be able
  to declare machine-readable relationships to *any* other artifact, independent of
  the SDD tree, via frontmatter. v1 vocabulary:
  - **`depends_on: [ID, …]`** — *blocking*. This node is blocked until each target's
    own gate is cleared; it MUST rank below an un-cleared target, and advancing past
    an un-cleared one is a **gate-violation** (FR-2.1).
  - **`supersedes: [ID, …]`** — *replacement*. The superseded target drops out of
    the queue (no longer a pending task); the superseding node carries forward.
  - **`relates_to: [ID, …]`** — *non-blocking clustering*. Does NOT gate, but the
    resolver SHOULD keep related items **adjacent in ordering** — within a severity
    class, cluster `relates_to` neighbours so kindred work/tests surface together
    rather than scattered. A clustering tie-influence only; never changes severity.

  These edges join the implicit tree edges to form the dependency DAG the resolver
  ranks over, replacing the prose-only links (`Triggered by:`, `Resolves:`,
  `composes`) the engine cannot read today. The edge set is the single structured
  source of cross-artifact relationship truth; an `id` that does not resolve is
  corruption (FR-15), not a silent drop. (`depends_on` + `supersedes` gate the DAG
  and MUST be acyclic; `relates_to` is non-blocking and exempt from the acyclicity
  rule.)
- **FR-14 (ties are an equivalence class — arbitrary pick licensed).** When, after
  all ranking (FR-2) and dependency (FR-13) computation, >1 node shares the top
  priority band, those nodes are **equally-correct** next tasks. The resolver MAY
  pick any of them; correctness does NOT depend on which. The default pick MUST be
  **deterministic-arbitrary** (lowest `artifact-id`) so T0 tests stay reproducible
  — random selection is permitted but discouraged for that reason. The product
  MUST NOT present the tie-break order as carrying meaning, and SHOULD be able to
  reveal "N equally-next tasks" rather than imply a single forced winner.
- **FR-15 (corruption: detect → deterministic repair → offer LLM escalation).**
  Correctness is **reliably assessable for structure, not for meaning.** The
  resolver MUST deterministically detect structural corruption — malformed
  frontmatter, dangling `epic:`/`depends_on` refs, status-incoherence (FR-9),
  **dependency-graph cycles** (the DAG must be acyclic) — and MUST NOT claim a
  confident next task while corruption stands. Semantic corruption (well-formed
  but wrong content) is explicitly **not** programmatically detectable and out of
  scope. On detected structural corruption the response is a ladder, never a
  silent fix: (1) attempt a **deterministic programmatic repair** (e.g. regenerate
  a stale generated INDEX, re-resolve an unambiguous ref) and **offer** it
  (confirm-before-write); (2) only if no deterministic repair applies, **offer to
  escalate to an LLM** repair — confirm-before-write, dirty-editor-safe, bounded
  and escalating per DR-355. This composes
  [SPEC-005 Auto-Structure Repair](../SPEC-005-auto-structure-repair/requirements.md)
  (offer-never-silent, non-destructive) — it MUST NOT reinvent it. The LLM never
  *decides whether* corruption exists (deterministic, step 0); it only *proposes a
  fix* a human confirms.

### Human-gate predicate generalisation (DR-047 §2, #528)

- **FR-16 (greenlit-for-type is a precondition for every human-gated node, not just
  gate-open).** The existing structural "gate-open" condition (epic `proposed`, spec
  un/stale-approved, ADR `proposed`) is **necessary but no longer sufficient**. Before a
  node of kind `epic-promote`, `spec-approve`, `adr-accept`, or either FR-17 kind is added
  to the pending set, the resolver MUST also check **greenlit-for-type**: the artifact's
  `ai-review/<type>` status reads `pass`, bound to the artifact's *current* content
  revision — a verdict pinned to a stale/prior revision is NOT greenlit (mirrors SPEC-031
  FR-9a's verified-fresh semantics; re-derive, never trust an old label). `phase-action` is
  unaffected — it is SPEC-010-owned work, not itself a reviewed Approvable type. This
  generalises DR-033 §6's PR-only predicate (`ai-review:pass` ∧ mergeable ∧ checks-green)
  to every human-gated type per **DR-047 §2 / SPEC-031 FR-4** (which defines the contract
  and explicitly assigns the resolver half of it here): the full predicate is
  **greenlit-for-type ∧ prior-stage-gates-clear ∧ human-gate-open**. "Prior-stage-gates-clear"
  for a doc Approvable reuses the existing FR-9/FR-13 coherence and `depends_on` checks
  unchanged; for `pr-review` it is DR-033 §6's original `mergeable ∧ checks-green`.
- **FR-17 (two new human-gated node kinds — `constitution-accept`, `pr-review`; subsumes
  #182).** The node-kind set gains:
  - **`constitution-accept`** — a constitution invariant `status: proposed`, mirroring
    `adr-accept`'s shape (DR-047 Decision 1 names the constitution invariant as
    high-criticality / always-human).
  - **`pr-review`** — a PR-to-main that is open, mergeable, and checks-green, pending
    human merge-confirmation. This is the node kind issue #182 proposed; #182's own
    predicate was never built into the resolver (`grep -c ai-review
    packages/shared/src/next-task.ts` → 0 today, and this file's own header already lists
    "PR-review nodes (#182) … out of this slice"), so FR-17 builds it directly as the
    `pr-review` case of FR-16's generalised predicate rather than as a separate
    PR-only predecessor this spec would then have to extend again. DR-038 §6 confirms the
    *rendering* of PR nodes is downstream of whatever this resolver emits, not a competing
    source of truth — building the predicate here is consistent with that DR, not a
    detour from it. See Decisions needed → DQ-1 for the scope call this makes.
  - `plan-approve` is **not** introduced by this FR — see Decisions needed → DQ-3.
- **FR-18 (fail closed — absence or a non-pass verdict is never read as greenlit).** Per
  the project's no-silent-gate invariant (constitution #2): if an artifact's
  `ai-review/<type>` check has never run, or reads `pending`, `escalated`, or `changes`,
  the node is **not emitted as pending at all** — withheld from the ranked set entirely,
  never merely demoted (mirrors DR-047 §2's "MUST NOT appear in the human queue"). Absence
  of evidence MUST NOT be read as a pass. A T0 fixture asserts: a `spec-approve` candidate
  with zero `ai-review/spec` history is excluded from the resolver's output entirely, not
  ranked-low. See Decisions needed → DQ-2 for why this rule, applied naively today, is a
  live blackout risk and needs a sequencing answer before it ships.

### Packaging

- **FR-11 (Tier-0 pure function in `packages/shared`).** The resolver is a single
  pure function in `packages/shared` (no `vscode`, no network), consumed
  identically by (a) the status-bar signpost, (b) the explorer rollup, (c) CI /
  `npm run validate`, and (d) any future surface. One engine → one next-task
  everywhere; editor, CI, and explorer can never disagree. (DR-014 tier map.)
- **FR-12 (correctness invariant + T0 tests).** Every (state → next-task) mapping
  — each severity class, each gate edge, each coherence rule — MUST have a T0
  invariant test. The next task is an invariant, not a feature behaviour. No rule
  ships without its test. The two inconsistencies found in the triggering session
  (stale epic INDEX; SPEC-004 implementing-under-proposed) become T3 regression
  fixtures.

## Costly to Refactor (Zone A)

Seams where a v1 mistake is expensive to undo later — ranked. Each is FR-anchored.

1. **The frontmatter edge vocabulary (`depends_on` / `supersedes` / `relates_to`, FR-13).** Once authors write these keys across real specs/DRs/epics, the *names, cardinality (lists), and gating semantics* become a corpus-wide contract. Renaming a key or flipping `depends_on` from blocking→advisory means migrating every artifact that adopted it. Get the v1 vocabulary right (OQ3 resolved to ship all three) — adding a *new* edge kind later is cheap; changing an existing one is a corpus migration.
2. **`MILESTONE-NNN` as a first-class artifact kind (FR-3b).** Introducing a brand-new registered artifact type (id namespace, `status: open|reached`, INDEX participation) is a schema commitment. If temporal deferral were later modelled differently (a date edge, a flag), every `depends_on: [MILESTONE-NNN]` link and every milestone file would have to be rewritten. The "deferral is always a link" decision (FR-3a) is the load-bearing constraint that makes milestones necessary — reversing *that* unwinds FR-3a, FR-3b together.
3. **The severity-class partial order and its boundaries (FR-2's 4 classes).** Callers (status-bar, explorer, CI — FR-11) and every T0 test (FR-12) encode "gate-violation > blocked-ready > promote-parent > pending". Re-splitting or re-ordering classes invalidates the whole T0 fixture set and any UI that colour-codes by class. The class *count and order* is the stable contract; the `(epic.order, goal-rank, priority, artifact-id)` within-class tie-break (FR-3) is comparatively cheap to retune.
4. **`packages/shared` pure-function signature (FR-11).** The resolver's `(filesystem+frontmatter state) → next-task` signature is imported by 4 surfaces. Changing its input shape or return type is a cross-package break (DR-014 tier map). The Tier-0 purity constraint (no `vscode`, no network) is the hard wall — admitting either later contaminates every consumer and breaks CI usage.
5. **"Human queue only" node-source boundary (FR-8, INV — Two Queues).** The set of node kinds the resolver draws from (epic-promote, spec-approve, adr-accept, phase-action) is defined by *exclusion* of the agent/dispatch queue. If an agent-work node kind were ever admitted, the Two-Queues invariant and its tests fall, and the signpost's meaning ("what the human must do") silently changes. The exclusion is structural and should stay structural.

## Invariants (must hold)

- **INV — Next-task correctness (T0).** The resolver MUST NOT present a next task
  that is wrong for the current state, and MUST emit "unclear" rather than guess
  when state is incoherent (FR-10). Because it is a derived view of file truth
  (FR-1), correctness reduces to "reads state + applies the ranked rules" —
  testable (FR-12), not predicted.
- **INV — Two Queues (T0).** The human next-task queue and the agent/LLM dispatch
  queue MUST remain distinct. No agent work item is ever emitted as a human next
  task, and vice versa.
- **INV — Determinism / Tier 0 (DR-004, DR-019).** Resolution is pure
  filesystem + frontmatter; no AI, no network. The LLM's only sanctioned role is
  *suggesting* values for the explicit weight fields (FR-3) for the human to
  accept — never computing the live next task. (DR-019.)
- **INV #5 (user override wins).** Reuses SPEC-010 FR-7 override memory: the human
  may dismiss the current next task ("not this — I'm on X"); the dismissal sticks
  until state changes.
- **INV — Greenlit-for-type gate (DR-047 §2, FR-16/FR-17/FR-18, #528).** A human-gated
  node (`spec-approve`, `adr-accept`, `epic-promote`, `constitution-accept`, `pr-review`)
  MUST NOT be emitted unless its type's independent AI-review verdict is a fresh `pass`
  (FR-16); absence or any non-pass verdict withholds the node entirely (FR-18, fail
  closed — never defaulted to pass). Non-gated types (Issue; auto-accepted
  design.md/tasks.md per dev config, DR-047 Decision 5) are never emitted as nodes at all,
  regardless of review verdict. Generalises DR-033 §6's PR-only predicate to every
  human-gated Approvable type.

## Acceptance Criteria (Zone A)

Definition-of-done — each item traces FR(s) and is the concrete check that the
requirement is met. The resolver ships only when every box is tickable.

- [ ] **(FR-1, INV-determinism)** Given a fixed fixture tree, the resolver returns the *same* next-task on repeated runs; no LLM/network call is reachable from the resolve path. A test asserts byte-identical output across N runs.
- [ ] **(FR-2)** A fixture with one node of each severity class yields the next-task drawn from **gate-violation** first; T0 tests cover all four class boundaries and the `(epic.order, goal-rank, priority, artifact-id)` within-class tie-break.
- [ ] **(FR-5)** The primary output is exactly **one** task object (kind, target id, imperative string, clearing action) — not a list — verified by output shape.
- [ ] **(FR-6)** The full ranked queue is retrievable on demand and is collapsed/secondary by default.
- [ ] **(FR-7)** Every emitted next-task carries its derivation (severity class + the gate/rule that produced it, e.g. "implementing-but-unapproved → DR-012"); a deliberately-wrong fixture is diagnosable to the artifact+rule.
- [ ] **(FR-8, INV — Two Queues)** No agent/dispatch node ever appears in resolver output; a fixture seeded with a dispatch item proves exclusion.
- [ ] **(FR-8a)** Simulated dev "deviation" (state unchanged) does NOT alter the canonical next-task; only an artifact-state change moves it.
- [ ] **(FR-9, FR-10)** A child-ahead-of-parent fixture surfaces as the top gate-violation; beyond-FR-9 incoherence (dangling ref / malformed frontmatter) yields "state unclear — <file>", never a fabricated task.
- [ ] **(FR-13)** `depends_on` / `supersedes` / `relates_to` are parsed from frontmatter; a `depends_on` blocker ranks its dependent below it; an un-cleared blocker that is advanced-past is reported as gate-violation; a dangling edge id is corruption (FR-15), not a silent drop.
- [ ] **(FR-14)** A top-band tie returns a deterministic-arbitrary pick (lowest `artifact-id`) and can report "N equally-next tasks".
- [ ] **(FR-15)** Structural corruption (malformed frontmatter, dangling refs, DAG cycle) is detected deterministically; the ladder offers programmatic repair first, LLM escalation only when no deterministic repair applies; both confirm-before-write.
- [ ] **(FR-11)** A single pure function in `packages/shared` (no `vscode`, no network) is the *only* resolver, imported by status-bar, explorer rollup, and CI/`npm run validate`.
- [ ] **(FR-12)** Each (state → next-task) mapping has a T0 invariant test; the two triggering-session inconsistencies (stale epic INDEX; SPEC-004 implementing-under-proposed) exist as T3 regression fixtures.
- [ ] **(FR-16)** A fixture with a structurally-open `spec-approve`/`adr-accept`/`epic-promote` node but no `ai-review/<type>:pass` verdict is excluded from the ranked set; the identical fixture with a fresh `pass` verdict is included.
- [ ] **(FR-17)** A `pr-review` fixture (PR open, mergeable, checks-green, `ai-review:pass`) is ranked; the same PR missing any one of the three conditions is excluded. A `constitution-accept` fixture mirrors `adr-accept`'s on/off behaviour.
- [ ] **(FR-18)** Absent, `pending`, `escalated`, and `changes` verdicts all exclude the node (fail-closed); a test asserts the resolver never defaults an unknown/missing verdict to pass.

## Coverage Map (all bases)

| Concern (from session) | FR |
|---|---|
| Priority via DAG not LLM | FR-1, FR-2, INV-determinism |
| One next task, not a list | FR-5 |
| Optional expand to see pipeline | FR-6 |
| Next task = human's, not LLM's | FR-8, INV-two-queues |
| Reliable / deterministic assessment | FR-1, FR-2, FR-9, FR-12 |
| Subjective weight (ScroogeLLM=future) | FR-3, FR-3a |
| Three weight dials (order + goal-rank + priority) | FR-3, FR-2 |
| Deferral as a link, not a boolean | FR-3a, FR-13 |
| Temporal deferral via milestones | FR-3b |
| Cross-cutting deps outside SDD tree | FR-13 |
| Relates-to clustering for ordering | FR-13 |
| Deviation must not move signpost | FR-8a |
| Ties → arbitrary pick OK | FR-14 |
| Corruption: detect → fix → escalate | FR-15 |
| Reliable correctness = structural only | FR-15 |
| Gate violations (the 2 found by hand) | FR-9, FR-12 |
| Resolve SPEC-010 OQ#1 (global order) | FR-2, FR-4 |
| One engine, every surface | FR-11 |
| Generalise PR-only predicate to all human-gated types (DR-047 §2, #528) | FR-16, FR-17 |
| Fail closed on missing/non-pass review evidence | FR-18 |

## Risks & Mitigations

| # | Risk | Likelihood · Impact | Mitigation |
|---|---|---|---|
| R1 | **Frontmatter rot → confident-wrong next task.** The DAG is only as fresh as the frontmatter; a stale `status`/`order`/`depends_on` yields a wrong signpost stated with full confidence (the stale-INDEX bug, exactly). | High · High | FR-9 coherence + FR-15 structural-corruption checks run as a resolve-time **precondition**; on breach, degrade honestly (FR-10) — emit "unclear", never a wrong step. Acyclicity check catches dependency rot. |
| R2 | **Edge-maintenance burden → cross-cutting deps never authored.** If devs don't write `depends_on`, real blockers stay invisible and the resolver under-orders (ranks a blocked item too high). | High · Med | Prose-link linter flags `Resolves:`/`Triggered by:`/`composes` prose with no matching machine edge; optional opt-in LLM **suggests** edges for human accept (never auto-writes, DR-019). |
| R3 | **Surfaces disagree.** Status-bar, explorer rollup, and CI computing the next task differently destroys trust in the signpost. | Low · High | FR-11 single pure function in `packages/shared` — one engine, one verdict everywhere. T0 tests pin the mapping. |
| R4 | **`epic.order` is a human guess → wrong global next task, confidently.** Determinism faithfully propagates a bad human-set weight. | Med · Med | FR-7 show-the-evidence makes any wrong order diagnosable to the field that caused it; `order` is cheap to edit; INV #5 override lets the human dismiss and proceed. |
| R5 | **Corruption blackout (DoS).** One cycle or malformed file makes the resolver say "unclear" globally → no next task at all, signpost dead. | Med · High | FR-15 localizes the report to the offending edge/file set and offers repair; the rest of the DAG MUST still resolve. A single bad node must not blank the whole signpost. |
| R6 | **Advisory drifts to de-facto blocking.** Human follows the signpost blindly, mis-ordering real-world priorities the model can't see. | Med · Med | FR-5 advisory + INV #5 override + FR-6 pipeline view (see what's behind the one task). The signpost suggests; the human still decides. |
| R7 | **Two-queue leak.** Agent/LLM dispatch work surfaces as a human next task (or vice-versa), polluting the signpost. | Low · Med | INV — Two Queues (T0) + dedicated tests; the resolver's node sources exclude the dispatch queue by construction (FR-8). |
| R8 | **Greenlit gate blanks the signpost by omission, not error.** Unlike R5 (one bad node blanks the DAG), FR-16/FR-18 can make *every* `spec-approve`/`adr-accept`/`epic-promote`/`constitution-accept` node vanish at once — silently indistinguishable from the honest "nothing pending" empty-queue state (Failure-Mode #3) — if the per-type reviewer (#527) that produces `ai-review/<type>` verdicts has not shipped yet. This is the exact "signpost lies" failure EPIC-010 exists to prevent, via omission instead of a wrong task. | High (certain, if sequenced naively) · High | See Decisions needed → DQ-1/DQ-2: this spec does not ship FR-16 enabled for the doc-type kinds until #527 posts real verdicts; FR-7's show-the-evidence is extended so a withheld node's reason ("no `ai-review/spec` verdict yet") is inspectable via the FR-6 expand, never a silent disappearance. |

## Assumptions

- SPEC-010's per-feature resolver already exposes a consumable `phase-action` node source (FR-4 composes it, does not re-implement); this spec assumes that interface exists or lands alongside it.
- Artifacts carry parseable YAML frontmatter with `status`, and (where set) `epic`, `epic.order`, `priority`, and the FR-13 edge keys — i.e. the validation gate from `npm run validate` keeps frontmatter well-formed enough to parse.
- The implicit SDD-tree edges (epic→members, spec-approval→implement per DR-012, phase-predecessor→successor per SPEC-010) are derivable from existing structure without new authoring; only the **explicit** cross-cutting edges (FR-13) require new frontmatter authoring.
- A `MILESTONE-NNN` artifact registry / INDEX participation (FR-3b) can reuse the same id+status+index pattern already used for SPECs/DRs/epics rather than needing a new storage substrate.
- **(FR-16/FR-17)** A PR's `mergeable` / `checks-green` / `ai-review:*` fields, and each doc Approvable's `ai-review/<type>` verdict, are supplied as already-fetched structured input by the calling adapter (the fs-adapter for docs; a CI/dispatch-side adapter for PRs) — the pure resolver core never fetches them itself. This preserves FR-11's Tier-0/no-network constraint exactly as the existing fs-adapter does for epic/spec/ADR status today; a PR-fetching resolver would violate constitution invariant #1 (no network calls without consent) and FR-1's determinism (a live API response is not a pure function of a fixed input).
- **(FR-16/FR-18)** The per-type reviewer that produces `ai-review/<type>` verdicts for Spec/DR/Epic/Constitution (#527, SPEC-031 FR-1/FR-3) is assumed to exist and be posting verdicts before FR-16's gate is *enabled* for those four node kinds — see Decisions needed → DQ-1. The `pr-review` kind's `ai-review` verdict pipeline is assumed already live (DR-033 §6 / SPEC-031: "already shipped").

## Test-thought

Verified by a T0 invariant-fixture suite in `packages/shared/tests`: each (state → next-task) mapping (every FR-2 severity class, every gate edge, every FR-9 coherence rule, the FR-14 tie pick, FR-15 corruption detection) is a deterministic fixture-in → expected-next-task-out assertion (FR-12), with the two triggering-session bugs (stale epic INDEX; SPEC-004 implementing-under-proposed) pinned as T3 regression fixtures. Determinism is itself the test enabler — same input, same output, no mocking of LLM/network because none is reachable (FR-1).

## Consequences

**Positive:**
- Collapses SPEC-010's within-feature signpost and the three cross-artifact approval gates into **one** total order, resolving SPEC-010 OQ#1 (global ordering) with a single engine rather than per-surface logic (FR-2, FR-4).
- Makes prose-only relationships (`Triggered by:`, `Resolves:`, `composes`) machine-readable (FR-13), so blockers the engine was blind to now actually re-rank — and a dangling ref becomes detectable corruption instead of an invisible drop (FR-15).
- One `packages/shared` pure function means status-bar, explorer, and CI can never disagree on "next task" (FR-11) — the signpost has a single source of truth.
- The signpost queue becomes a pre-filtered, AI-greenlit set across every human-gated type, not just PRs (FR-16/FR-17) — closing the rubber-stamp surface DR-047 names (#344–349) at the resolver layer, not just by policy.

**Negative:**
- Adds authoring burden: cross-cutting blockers only count once a human writes `depends_on`/`supersedes` (FR-13) and registers `MILESTONE-NNN` artifacts (FR-3b). Un-authored edges leave the resolver under-ordering (R2).
- Introduces a new corpus-wide frontmatter contract (the edge vocabulary) that, once adopted, is costly to change (see Costly to Refactor #1) — and a new artifact kind (milestones) to maintain.
- The resolver is now a single point of failure for the signpost: a structural-corruption blackout (R5) must be carefully localized (FR-15) or one bad file blanks the global next-task.
- The greenlit gate (FR-16/FR-18) adds a second, silent way for the queue to go empty — not corruption, just missing review evidence (R8) — which must be sequenced against #527's rollout or the signpost blanks for every doc Approvable in the corpus.

## Failure-Modes / Edge-Cases

1. **Dependency-graph cycle** (`A depends_on B`, `B depends_on A`, possibly transitively). The DAG-must-be-acyclic invariant (FR-15) is breached; resolver MUST report the cycle as structural corruption and degrade (FR-10), not loop or pick arbitrarily.
2. **Dangling edge id** — `depends_on: [SPEC-999]` where SPEC-999 doesn't resolve. Corruption (FR-13/FR-15), surfaced for repair; never silently dropped.
3. **Empty queue** — no pending human decisions at all (every gate cleared, no `phase-action` hole). The resolver MUST emit a clean "nothing pending" state — a well-formed empty result, distinct from the FR-10 "state unclear" degradation — and MUST NOT fabricate a task (the inverse of the FR-5 single-task output: zero, not one) nor error.
4. **All-tied top band** — every top-priority node is in one FR-14 equivalence class; resolver returns the deterministic-arbitrary lowest-`artifact-id` pick and can report "N equally-next".
5. **Coherence breach vs deeper incoherence** — child-ahead-of-parent (FR-9) routes to a gate-violation next-task; malformed/dangling state beyond FR-9 routes to "state unclear — <file>" + repair ladder (FR-10/FR-15). The boundary between these two must not be miscategorized.
6. **`supersedes` to an already-`done`/`archived` target** — superseding a node whose target is already out of the queue must be a no-op, not a re-introduction or error (FR-13).
7. **Milestone never reached** — a `depends_on: [MILESTONE-NNN]` whose milestone stays `open` keeps the dependent legitimately hidden indefinitely; this is correct (auto-clears on reach), not a stuck state (FR-3a/FR-3b).
8. **No `ai-review/<type>` history exists at all for a type** (e.g. #527 not yet shipped) — every node of that kind is withheld (FR-18), and the resulting empty/thinner queue is indistinguishable from edge-case #3's honest "nothing pending." This is the R8 risk made concrete; the mitigation is sequencing (DQ-1), not a resolver-side fix, because the resolver cannot tell "truly nothing pending" apart from "nothing has been reviewed yet" from inputs alone.
9. **A greenlit verdict regresses mid-queue** (a fresh `ai-review/spec:changes` lands after a prior `pass` — new commits, a re-review). The node that was previously withheld-as-absent or included-as-greenlit must re-evaluate on the next resolve; a stale cached `pass` must never outlive the content revision it was verified against (FR-16's "current revision" clause).

## Test / Verification Strategy

Per-FR tier + one-line assertion sketch:

| FR | Tier | Assertion sketch |
|---|---|---|
| FR-1 | T0 | Repeated resolve on a fixed fixture → byte-identical output; no LLM/network call reachable from the resolve path. |
| FR-2 | T0 | One-node-per-class fixture → next-task is the gate-violation; within-class order follows `(epic.order, goal-rank, priority, artifact-id)`. |
| FR-3 / FR-3a / FR-3b | T0 | `epic.order`/`priority` change re-orders deterministically; a `depends_on` (incl. on a `MILESTONE-NNN`) hides the dependent until the blocker/milestone clears. |
| FR-4 | T1 | Resolver consumes SPEC-010's `phase-action` source; does not re-derive coverage predicates (no duplicate predicate code path). |
| FR-5 / FR-6 | T2 | Primary output = single task object; full queue retrievable on demand, secondary by default. |
| FR-7 | T2 | Emitted task includes severity class + producing rule; a wrong-on-purpose fixture is diagnosable to artifact+rule. |
| FR-8 / FR-8a | T0 | Dispatch-seeded fixture proves no agent node emitted (INV — Two Queues); state-unchanged "deviation" leaves next-task fixed. |
| FR-9 / FR-10 | T0 | Child-ahead-of-parent → top gate-violation; beyond-FR-9 incoherence → "state unclear — <file>", never a fabricated task. |
| FR-13 | T0/T1 | Each edge kind parsed; `depends_on` ranks dependent below blocker; advancing past un-cleared blocker = gate-violation; dangling id = corruption. |
| FR-14 | T0 | Top-band tie → lowest-`artifact-id` pick; "N equally-next" reportable. |
| FR-15 | T0/T2 | Cycle/dangling/malformed detected deterministically; repair ladder offered (deterministic first, LLM second), confirm-before-write. |
| FR-11 | T1 | Single `packages/shared` pure function (no `vscode`/network) imported by status-bar, explorer, CI. |
| FR-12 | T0 | Coverage check: every severity class + gate edge + coherence rule has a mapped T0 test; 2 session bugs exist as T3 fixtures. |
| FR-16 | T0 | Structurally-open node + no/stale `ai-review/<type>` verdict → excluded; same node + fresh `pass` → included. |
| FR-17 | T0 | `pr-review`/`constitution-accept` fixtures each exercise their full on/off predicate independently. |
| FR-18 | T0 | Every non-`pass` verdict value (absent, `pending`, `escalated`, `changes`) excludes the node; none default to included. |

## Alternatives Considered

- **LLM-ranked next task.** Let an LLM read the corpus and pick the next task. **Rejected:** non-reproducible, untestable, and violates Tier-0/determinism (FR-1, INV — Determinism, DR-004/DR-019); the whole point of EPIC-002 is a signpost that can't lie, which requires a derived (not guessed) verdict.
- **Emit a ranked list/backlog instead of one task.** **Rejected:** a backlog is precisely what MinSpec exists to collapse into a single pointer (Context); the list survives only as the optional FR-6 expansion, not the primary output (FR-5).
- **`deferred: true` boolean for "not now".** **Rejected (FR-3a):** a boolean rots — set once, never unset, so the item stays hidden after its blocker clears. Replaced by a `depends_on` link (auto-clears, explainable, one mechanism), with `MILESTONE-NNN` for purely-temporal deferral (FR-3b).
- **Per-surface resolver logic** (status-bar, explorer, CI each compute their own). **Rejected:** surfaces would disagree and destroy signpost trust (R3); replaced by the single `packages/shared` pure function (FR-11).
- **Date-typed deferral edge** for temporal "later". **Rejected (OQ2):** adds a second deferral mechanism and a non-artifact edge type; milestones keep deferral as one uniform link end-to-end (FR-3b).

## Dependencies & Blast-Radius

**Declared dependencies (what this spec consumes / reaches into):**
- [SPEC-010 signpost-correctness](../SPEC-010-signpost-correctness/requirements.md) — `phase-action` node source and FR-6 honest-degradation (FR-4, FR-10); resolves its OQ#1.
- [SPEC-005 auto-structure-repair](../SPEC-005-auto-structure-repair/requirements.md) — composed for the FR-15 repair ladder (offer-never-silent, non-destructive).
- [DR-012](../../../docs/decisions/DR-012.md) content-hash approval gate — defines the `spec-approve` node and the implementing-but-unapproved gate-violation.
- [DR-014](../../../docs/decisions/DR-014.md) tier map — mandates the resolver live in `packages/shared` (FR-11).
- [DR-019](../../../docs/decisions/DR-019.md) — the decision this spec is the contract for (determinism, no-LLM ranking).
- The frontmatter schema across all SPEC/DR/epic artifacts (parsed for `status`, `epic.order`, `priority`, FR-13 edges) and the `MILESTONE-NNN` registry (FR-3b).
- [DR-047](../../../docs/decisions/DR-047.md) §2 — the predicate contract FR-16/FR-17/FR-18 implement (the resolver half; [SPEC-031](../SPEC-031-reviewer-all-approvables/requirements.md) FR-4/FR-8 own the rest).
- [SPEC-031](../SPEC-031-reviewer-all-approvables/requirements.md) FR-1/FR-3 (#527, unbuilt) — the per-type reviewer that must be posting `ai-review/<type>` verdicts before FR-16 is safe to enable for the doc-type node kinds (DQ-1).

**Blast-radius — what breaks if changed:**
- Changing the `packages/shared` resolver signature breaks **all four consumers** (status-bar signpost, explorer rollup, CI/`npm run validate`, future surfaces) simultaneously (FR-11, DR-014).
- Changing the FR-13 edge vocabulary names/semantics requires migrating every artifact that authored them (Costly to Refactor #1).
- Changing the FR-2 severity-class set/order invalidates the entire T0 fixture suite (FR-12) and any class-coded UI.
- A regression that lets an agent/dispatch node leak in breaks INV — Two Queues across every surface at once (FR-8).
- Enabling FR-16's greenlit gate for the doc-type node kinds before #527 ships withholds **every** `spec-approve` / `adr-accept` / `epic-promote` / `constitution-accept` node across the whole corpus simultaneously (R8) — the single highest-blast-radius risk this addition introduces, because it is silent by design (FR-18 is correct to fail closed; the danger is purely sequencing).

## Rollback / Reversibility

- **Undo mechanism — the engine.** The resolver is a pure additive read-only view (FR-1, FR-11): deleting/disabling the `packages/shared` function and its call-sites removes the signpost with no data loss. Nothing it computes is persisted state, so reverting the code fully reverts the feature.
- **Undo mechanism — the data.** The new frontmatter edges (`depends_on`/`supersedes`/`relates_to`, FR-13) and `MILESTONE-NNN` files are additive metadata; left unread they are inert YAML/markdown. Removing the resolver does not require removing them, and removing them does not corrupt artifacts (they're optional keys).
- **Hard-to-reverse seam (the caveat).** Once authors have written FR-13 edges across the corpus, the *vocabulary* is corpus-wide (Costly to Refactor #1) — the code is reversible in <1 day, but un-adopting the edge keys from many artifacts is not. This asymmetry (reversible engine, sticky data contract) is the reason this is T4 and carries a DR (DR-019).
- **ADR-filter answer.** Can this be undone in <1 day? **The engine: yes** (delete code + call-sites). **The data contract + `MILESTONE-NNN` artifact kind: no** — it's a corpus-wide schema commitment, which is exactly why it is governed by a DR (DR-019) rather than done ad-hoc.

## Follow-ups (tracked)

- **Prose-link linter (R2 mitigation):** flag `Resolves:` / `Triggered by:` / `composes` prose that lacks a matching machine-readable FR-13 edge. Cross-cutting tooling — file as a GitHub issue on `harvest316/minspec` if not already covered by a spec; not yet a SPEC.
- **OQ4 (cross-epic gate-violation tie-break)** and **OQ5 (deterministic-repairable vs LLM-only corruption set)** — both deferred to the plan phase (see Open questions); resolve before implement.
- **MILESTONE-NNN registry/INDEX mechanics (FR-3b)** — exact storage + index-participation to be specified at plan time (assumed to reuse the SPEC/DR id+status+INDEX pattern).
- **UX/data-contract handoff** — the status-bar signpost + explorer rollup visual design is a separate downstream UX spec (see Out of scope); this spec hands it the ordering + task-object contract.
- **Activation of FR-16 for the doc-type node kinds (#528 / DQ-1):** tracked as an explicit follow-up step, not a prose promise — **no issue number yet** (this dispatch is specify-only and forbids opening one; the approving human should file it, or route it through the usual triage, before Plan). It must name: "flip the greenlit gate on for `spec-approve`/`adr-accept`/`epic-promote`/`constitution-accept` once #527 is confirmed posting verdicts."
- **DR-047 Plan/design.md identity contradiction (DQ-3):** also not yet issue-tracked for the same reason. Blocks introducing a `plan-approve` node kind until resolved.
- **#182 closure note:** if DQ-1 resolves to "absorb" (this spec's working assumption, FR-17), #182 should be closed/relinked as *"subsumed by #528 / SPEC-012 FR-17"* explicitly in the implementing PR — never silently, per the project's prose-only-follow-up-leak rule.

## Out of scope

- **Within-feature coverage predicates** — owned by SPEC-010 (consumed, not
  redefined) and strengthened by SPEC-006.
- **Visual / UX design** of the status-bar signpost and explorer rollup (separate
  UX spec; this defines the data contract + ordering only). The pane restructuring
  the session flagged is downstream of this engine.
- **The agent/LLM dispatch queue** and its ordering — separate substrate
  (DR-015/017, agent-execute).
- **LLM suggestion of `order` / `depends_on` values** — a distinct optional
  feature; this spec only mandates that such values, *however* set, are explicit
  data the engine reads (FR-3), never engine/LLM inference at resolve time.
- **Blocking enforcement** — the resolver is advisory (mirrors SPEC-010 FR-5);
  the blocking gate is DR-012.
- **A `plan-approve` node kind** — not introduced by FR-17; blocked on DQ-3
  (the Plan/design.md file-identity contradiction DR-047 itself flags unresolved).
- **The per-type reviewer that produces `ai-review/<type>` verdicts** — owned by
  SPEC-031 (#527); this spec only *consumes* the resulting label/status.
- **The ordering gate (doc-before-implementing-code)** — owned by SPEC-031 FR-5 (#529);
  a PR-level gate, distinct from this spec's per-node predicate.

## Resolved questions

- **OQ1 — per-spec `priority:` field.** **Resolved: keep it.** All three dials ship —
  `epic.order` (coarsest), `goal-rank` (mid, DR-039 §3), and `priority:` (finest, within tie). (FR-3, FR-2.)
- **OQ2 — temporal deferral with no artifact blocker.** **Resolved: milestones.**
  Add `MILESTONE-NNN` artifacts as `depends_on` targets; deferral stays one
  mechanism (a link), no date-typed edge, no flag. (FR-3a, FR-3b.)
- **OQ3 — edge vocabulary scope.** **Resolved: include `relates_to` in v1.** Ships
  `depends_on` + `supersedes` (blocking, gate the DAG) + `relates_to` (non-blocking
  clustering — keeps kindred work/tests adjacent in ordering). (FR-13.)

## Open questions

- **OQ4 — Cross-epic vs in-epic gate violations.** When two gate-violations exist
  in different epics, is `epic.order` the right tie-break, or should violation
  *recency* / blast-radius win? Lean `epic.order` for determinism; revisit if it
  mis-orders in practice. *(Open — plan phase.)*
- **OQ5 — Auto-repairable vs LLM-only corruption (FR-15).** Which structural
  corruptions have a *deterministic* fix (stale generated INDEX → regenerate;
  unambiguous dangling ref → re-resolve) vs require an LLM offer (ambiguous ref,
  malformed hand-edited frontmatter)? Enumerate the deterministic set at plan time;
  default everything outside it to the LLM-escalation rung. *(Open — plan phase.)*

## Decisions needed (Clarify)

Added for #528 (DR-047 §2). These are the human's read. Each names a recommendation
**and** what that recommendation costs, per the project's decision convention.

- **DQ-1 — Scope: does #528 absorb #182's never-built PR-node-kind work, or does it
  depend on #182 landing first?** The issue body reads "extends #182 (PR-only precursor)
  to all human-gated types," phrasing that assumes #182 already shipped a PR-only
  predicate to extend. It did not — `grep -c ai-review packages/shared/src/next-task.ts`
  is `0` today, and this file's own header already lists "PR-review nodes (#182) …
  out of this slice" as unbuilt. FR-17 (above) takes the working assumption that #528
  builds `pr-review` directly, since no other spec owns this predicate and DR-038 §6
  confirms the graph-render surface is downstream of whatever this resolver emits, not a
  competing source of truth.
  - **(A) Absorb — recommended.** Build `pr-review` here (FR-17), close #182 as
    subsumed, relinked explicitly in the implementing PR (never silently — see Out of
    scope). *Cost:* grows this spec's diff by a full new node kind rather than
    "generalise 3 existing predicates" — worth re-confirming the T3/T4 tier call still
    fits once Plan sizes it, and loses whatever discussion/history lives only on #182 if
    it is closed rather than cross-linked.
  - **(B) Depend on #182.** Scope #528 to the four doc-type node kinds only
    (`spec-approve`/`adr-accept`/`epic-promote`/`constitution-accept`); file/land #182
    as its own prerequisite PR first. *Cost:* two sequenced PRs instead of one, and a
    `depends_on: [#182]` edge this spec's own FR-13 machinery would have to track on
    itself — recursive, and slower for no correctness gain since the predicate shape
    (FR-16) is identical either way.

- **DQ-2 — Rollout sequencing of the FR-16 greenlit gate.** Enabling FR-16/FR-18 for
  `spec-approve`/`adr-accept`/`epic-promote`/`constitution-accept` the moment this spec's
  code ships will withhold **every** node of those kinds corpus-wide, because #527 (the
  per-type reviewer that posts `ai-review/<type>` verdicts) has never run — confirmed
  unbuilt in SPEC-031 ("still unbuilt — #527/#453", FR-7). The signpost would read
  "nothing pending," indistinguishable from the honest empty-queue case (Failure-Mode #3),
  while real human-gated work sits un-surfaced — the exact *signpost-lies* failure
  EPIC-010 exists to prevent, reached via omission instead of a wrong answer. `pr-review`
  is NOT at risk here — its `ai-review` pipeline is already shipped and merge-blocking
  (SPEC-031: "already shipped").
  - **(B) Gate only `pr-review` now; land FR-16/FR-18 for the four doc-type kinds
    specified-but-dormant until #527 ships, then flip one corpus-wide switch —
    recommended.** *Cost:* ships a documented-but-unenforced requirement for 4 of 6 node
    kinds; the activation step must get its own tracked issue (see Out of scope) so it
    is never a prose-only promise that quietly never happens.
  - **(A) Gate everything now.** Correct per DR-047's letter if #527 ships
    first/atomically with this spec. *Cost:* if the two land out of order — plausible,
    since they are different issues with no enforced sequencing today — the signpost
    goes blank for every doc Approvable until #527 catches up, with no error raised.
  - **(C) Treat "never reviewed" as distinct from "reviewed and rejected"; gate only on
    an actual negative verdict, never on absence.** *Rejected as a standalone answer:*
    this is exactly the fail-open shape FR-18 and constitution invariant #2 (no silent
    gate) forbid — "not reviewed yet" and "never going to be reviewed" are
    indistinguishable from the resolver's inputs, so this reopens the rubber-stamp
    surface DR-047 closes. Could still serve as (B)'s temporary bridge condition, not as
    its own resolution.

- **DQ-3 — What artifact backs the "Plan" human gate?** DR-047 Decision 1/5 lists Plan
  as high-criticality/always-human, but DR-047's own 2026-08-05 self-correction #3 found
  no `plan.md` exists anywhere in the corpus (`find specs -name plan.md` → empty) — the
  Plan-phase artifact **is** `design.md`, which Decision 5 separately classifies as
  low-criticality/auto-acceptable. One physical file, two contradictory policies, flagged
  by the DR itself and never resolved. FR-17 deliberately ships **no** `plan-approve`
  node kind until this is settled (see Out of scope).
  - **(A) Plan's gate = design.md's own approval sidecar; reclassify "Plan" out of the
    high-criticality list — recommended.** Fewer concepts: one file, one gate, matching
    what already exists for design.md (#630's sidecar mechanism). *Cost:* requires a
    DR-047 follow-up amendment correcting Decision 1/5's text before this spec can
    honestly claim Plan coverage; until that lands, Plan stays a documented gap here, not
    a silent omission.
  - **(B) Plan's gate is a new, SPEC-012-native sub-gate on the spec's `phases.plan`
    transition**, distinct from design.md's content-sidecar — "approving the plan
    decision" ≠ "approving the design.md document," even though one file realises both
    today. *Cost:* introduces a frontmatter/approval concept with no existing analogue in
    the corpus, and routes around DR-047's flagged contradiction rather than resolving
    it — risking the two gates drifting further apart in meaning over time.
