---
id: SPEC-012
type: requirements
status: specifying
product: minspec
epic: EPIC-002  # Signpost Integrity
---

# MinSpec — Next-Task Resolver (Requirements)

**Date:** 2026-06-01
**Status:** Specifying (SDD Specify phase)
**Decision:** [DR-019](../../../docs/decisions/DR-019.md) (this spec is the contract that decision governs)
**Triggered by:** session request — "a prioritised list of docs/specs/epics/DRs I need to approve … but actually I don't need a list, just the next task; priority via DAG not LLM."
**Epic:** [EPIC-002 Signpost Integrity](../../../docs/epics/EPIC-002-signpost-integrity.md)
**Resolves:** [SPEC-010](../signpost-correctness/requirements.md) Open Question #1 (global topological ordering across simultaneously-pending items).

---

## Context

[SPEC-010](../signpost-correctness/requirements.md) makes the **within-feature**
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
| `epic-promote` | epic `status: proposed` | promote → `active` |
| `spec-approve` | spec unapproved/stale AND not `done`/`archived` (DR-012) | Approve Spec |
| `adr-accept` | ADR `status: proposed` | accept/reject |
| `phase-action` | SPEC-010 within-feature hole (uncovered FR / unchecked task) | author the phase |

Edges = **dependency gates** (a partial order; the DAG):

```
epic(active) ──gates──▶ spec-approve, adr-accept, phase-action of its members
spec(approved) ──gates──▶ implement phase-action of that spec   (DR-012)
phase predecessor ──gates──▶ phase successor                    (SPEC-010 chain)
```

A node whose gate is **unsatisfied while downstream work has already started** is
a **gate violation** (e.g. spec `implementing` but unapproved; spec `implementing`
under a `proposed` epic). Violations are detectable purely structurally and rank
highest — they are live invariant breaches, not future work.

## Requirements

### Determinism & layering

- **FR-1 (deterministic, no LLM — *derive, never guess*).** Priority and the
  next task MUST be a pure function of filesystem + frontmatter + approval state.
  Same inputs → same output. No LLM, no network, no randomness, no hidden state.
  An LLM-derived next-task is non-reproducible and untestable; it is forbidden
  here. (Tier 0, DR-004; DR-019.)
- **FR-2 (severity classes — total order, deterministic).** Every pending node is
  assigned exactly one severity class, ranked:
  1. **gate-violation** — downstream work proceeding past an unsatisfied gate.
  2. **blocked-ready** — at a gate whose clearance unblocks the next phase, under
     an `active` epic.
  3. **promote-parent** — a `proposed` epic with members waiting on it.
  4. **pending** — remaining `proposed` ADRs / unapproved specs.
  Tie-break **within** a class by `(epic.order, artifact-id)`. The resolver MUST
  produce a single total order; the **next task** is its minimum.
- **FR-3 (subjective weight is explicit data, never inferred).** Any priority
  input that is a human judgement — relative importance of independent branches,
  "this epic is future/deferred" — MUST be read from explicit frontmatter
  (`epic.order`, and new `deferred: true` / `priority:` fields), NOT inferred by
  the engine and NOT inferred by an LLM. Prose in CLAUDE.md ("ScroogeLLM is
  future") is invisible to the resolver until lifted into a field. The engine
  computes structure; the human sets weight.
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

### Coherence precondition

- **FR-9 (status-coherence validation, deterministic).** Before emitting a next
  task the resolver MUST check structural coherence: a child MUST NOT be further
  along than its parent (e.g. spec `implementing` under a `proposed` epic; ADR
  `accepted` under a `proposed` epic). A coherence breach is surfaced as the
  highest-priority *gate-violation* next task ("resolve: SPEC-004 implementing
  under proposed EPIC-004"), not silently ranked among normal work.
- **FR-10 (honest degradation — reuse SPEC-010 FR-6).** If state is incoherent
  beyond the FR-9 rules (dangling epic refs, malformed frontmatter), the resolver
  MUST say "state unclear — <file>" rather than fabricate a confident next task.

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

## Invariants (must hold)

- **INV — Next-task correctness (T0).** The resolver MUST NOT present a next task
  that is wrong for the current state, and MUST emit "unclear" rather than guess
  when state is incoherent (FR-10). Because it is a derived view of file truth
  (FR-1), correctness reduces to "reads state + applies the ranked rules" —
  testable (FR-12), not predicted.
- **INV — Two Queues (T0).** The human next-task queue and the agent/LLM dispatch
  queue MUST remain distinct. No agent work item is ever emitted as a human next
  task, and vice versa.
- **INV — Determinism / Tier 0 (DR-004, DR-018).** Resolution is pure
  filesystem + frontmatter; no AI, no network. The LLM's only sanctioned role is
  *suggesting* values for the explicit weight fields (FR-3) for the human to
  accept — never computing the live next task. (DR-019.)
- **INV #5 (user override wins).** Reuses SPEC-010 FR-7 override memory: the human
  may dismiss the current next task ("not this — I'm on X"); the dismissal sticks
  until state changes.

## Coverage Map (all bases)

| Concern (from session) | FR |
|---|---|
| Priority via DAG not LLM | FR-1, FR-2, INV-determinism |
| One next task, not a list | FR-5 |
| Optional expand to see pipeline | FR-6 |
| Next task = human's, not LLM's | FR-8, INV-two-queues |
| Reliable / deterministic assessment | FR-1, FR-2, FR-9, FR-12 |
| Subjective weight (ScroogeLLM=future) | FR-3 |
| Gate violations (the 2 found by hand) | FR-9, FR-12 |
| Resolve SPEC-010 OQ#1 (global order) | FR-2, FR-4 |
| One engine, every surface | FR-11 |

## Out of scope

- **Within-feature coverage predicates** — owned by SPEC-010 (consumed, not
  redefined) and strengthened by SPEC-006.
- **Visual / UX design** of the status-bar signpost and explorer rollup (separate
  UX spec; this defines the data contract + ordering only). The pane restructuring
  the session flagged is downstream of this engine.
- **The agent/LLM dispatch queue** and its ordering — separate substrate
  (DR-015/017, agent-execute).
- **LLM suggestion of `order`/`deferred` values** — a distinct optional feature;
  this spec only mandates that such values, *however* set, are explicit data the
  engine reads (FR-3), never engine/LLM inference at resolve time.
- **Blocking enforcement** — the resolver is advisory (mirrors SPEC-010 FR-5);
  the blocking gate is DR-012.

## Open questions

- **New frontmatter fields for weight (FR-3).** Minimal set: is `epic.order`
  enough, or are per-spec `priority:` and a boolean `deferred:` both needed? Lean
  `deferred:` (boolean, cheap) for the ScroogeLLM=future case; defer `priority:`
  until a real tie demands it.
- **Where deferred items rank.** Does `deferred: true` drop a node below all
  non-deferred (a 5th severity floor), or just weight its tie-break? Lean: hard
  floor — deferred never surfaces as *the* next task unless nothing else pends.
- **Cross-epic vs in-epic gate violations.** When two gate-violations exist in
  different epics, is `epic.order` the right tie-break, or should violation
  *recency* / blast-radius win? Lean `epic.order` for determinism; revisit if it
  mis-orders in practice.
