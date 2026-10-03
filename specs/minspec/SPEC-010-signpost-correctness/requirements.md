---
id: SPEC-010
type: requirements
# Editing voids approval (hash in .minspec/approvals.json → stale); re-run "MinSpec: Approve Spec". DR-012
status: specifying  # Amendment A (#121) edits approved text, so the DR-012 hash approval is void until re-approved; `implementing` is not derivable without a current approval (lifecycle.ts:130, :140)
tier: T4  # foundational: 17 FRs, DAG model, shared multi-caller contract — full ceremony (manual classification; classifier under-tiers by diff size)
product: minspec
epic: EPIC-002  # Signpost Integrity
relates_to: [SPEC-005, SPEC-006, SPEC-012, SPEC-013, DR-028, DR-029]  # repair trigger; predicate strength; global order (DR-019); traceability parse-grammar co-owner; DR-028/DR-029 = the cross-cutting-section coverage edge (Amendment A, #121)
implements: none
implements_reason: >-
  Specified, not built. Verified by absence rather than inferred: zero `SPEC-010` citations
  across packages/minspec/src, packages/shared/src, scripts, .github and .githooks; the spec
  directory holds only requirements.md; `packages/shared/src` has no coverage/checker/DAG
  module; and there are zero hits for the FR-17 command. The signpost headers that do exist
  read `SPEC-012 / DR-019`, i.e. a sibling spec owns them. Declares its owned files at
  implementation, per the SPEC-034 precedent.
affects: []
---

# MinSpec — Signpost Correctness (Requirements)

**Date:** 2026-05-31
**Status:** Specifying — Amendment A (2026-10-03, [#121](https://github.com/AIClarityAU/minspec/issues/121)) is proposed and awaits re-approval; FR-1 to FR-17 are unchanged
**Decision:** [DR-012](../../../docs/decisions/DR-012.md) (HITL gate consumes this contract)
**Triggered by:** session request — "the signpost must always be correct; cover all the bases"
**Epic:** [EPIC-002 Signpost Integrity](../../../docs/epics/EPIC-002-signpost-integrity.md)

---

## Context

MinSpec's core value proposition is a **signpost**: a status-bar (and explorer)
indicator that always tells the developer and the AI agent the single next SDD
action — "Specify SPEC-NNN", "plan FR-4 is uncovered", "implement task 3",
"validate & commit". It is what makes MinSpec an *opinionated framework* rather
than a folder convention, and it is the marketing hook (guardrails against
vibe-coded AI slop).

A signpost is only valuable if it is **correct**. A green light that doesn't mean
"complete", or a "next: X" that is wrong for the current state, is worse than no
signpost: the developer (and the agent) trusts it, acts on it, and is led astray.
One wrong signpost and trust — the whole product — is gone.

The naive implementation ("which files exist?") is wrong for the common case of
being **partway through a stage**: a spec with FR-1..5 but a plan covering only
FR-1..3 is neither "no plan" nor "planned". Existence checks cannot see the hole.
Correctness therefore requires modelling *coverage*, not *presence* — a
dependency graph (DAG) whose edges carry completeness predicates.

This spec defines the foundational signpost: the DAG state model, the six
correctness mechanisms, the save-time completeness check, and the five
nag-avoidance guardrails. It composes with two existing specs rather than
duplicating them:

- **[SPEC-006](../SPEC-006-stub-completeness-gate/requirements.md)** (Stub & Completeness
  Gate) — strengthens the deterministic completeness predicate so placeholder
  prose / stubs can't pass as "complete".
- **[SPEC-005](../SPEC-005-auto-structure-repair/requirements.md)** (Auto-Structure
  Repair) — the offer-driven recovery path for missing/incoherent structure.
  This spec's *honest-degradation* state (FR-6) is the trigger; SPEC-005's
  offer-never-silent rule (its FR-3) is the contract for any LLM-assisted fix.

## State Model

Nodes = SDD artifacts (`spec`, `plan`, `tasks`, `code`) per feature. Edges =
**coverage** dependencies, each carrying a completeness predicate:

```
spec(FR-1..N) ──covers──▶ plan(items) ──covers──▶ tasks(checkboxes) ──covers──▶ code
```

Signpost = the **first incomplete node in topological order**. A partially-
covered node (plan covers FR-1..3 of FR-1..5) is itself the signpost target,
named to the specific hole (FR-4, FR-5). Multiple specs = multiple chains = a
graph; topo-sort yields the global next step.

> **Amendment A (proposed, [#121](https://github.com/AIClarityAU/minspec/issues/121))** adds a
> second edge out of the spec node, to each required cross-cutting section. It is specified
> in full at the end of this document and changes nothing above until it is approved.

## Requirements

### Correctness mechanisms

- **FR-1 (DAG state model — coverage, not presence).** State is modelled as a
  dependency graph of artifact nodes joined by coverage edges, not a file-exists
  checklist. "Partway through a stage" (a node partially covered by its
  predecessor) MUST be a first-class state whose signpost names the specific
  uncovered items.
- **FR-2 (deterministic derivation — *derive, never guess*).** The signpost MUST
  be a pure function of file-system + frontmatter state. Same inputs → same
  signpost; no heuristic guessing, randomness, or hidden state. (Tier 0, DR-004.)
- **FR-3 (L1 coverage predicates via traceability IDs).** Edge completeness is
  checked deterministically using the existing traceability convention: every
  `FR-N` in a spec has a downstream reference in the plan; every plan item has a
  task; task checkbox state is read directly. Greppable, fast, 100% precise.
  Predicate strength is extended by SPEC-006; semantic judgement is out of scope.
- **FR-4 (show the evidence — *why, not just what*).** Every signpost MUST be
  able to show its derivation on demand (hover / click): the exact state that
  produced it ("plan.md exists; FR-4, FR-5 have no plan ref → next: cover FR-4,
  FR-5"). A wrong signpost MUST be diagnosable to the file/ID that caused it, so
  an error becomes a bug report, not an uninstall.
- **FR-5 (advisory, never blocking — *suggest, never block*).** The signpost is
  advisory: a pointer the developer may ignore, skip, or act on out of order. It
  MUST NOT block edits or commits. (Blocking enforcement is the separate, opt-in
  HITL gate, DR-012, which *consumes* this completeness contract.)
- **FR-6 (honest degradation — *degrade honestly*).** When state is *incoherent*
  (tasks with no parent plan, dangling ID references, colliding hand-edited IDs),
  the resolver MUST say so explicitly ("state unclear — open tasks.md") and MUST
  NOT fabricate a confident next step. This is the documented trigger for
  LLM-assisted repair (SPEC-005). Distinct from "incomplete but coherent", which
  is normal and points forward.
- **FR-7 (override memory — *dismissible + sticky*).** The developer MUST be able
  to dismiss/override the signpost ("not this — I'm on X"). An override persists
  and suppresses the same guidance until state changes; the signpost MUST NOT
  re-nag the identical step. A confirmed repair result is cached the same way,
  making it deterministic thereafter. (Reuses the `preferences.json` /
  INV #5 override model.)
- **FR-8 (correctness invariant + T0 tests — *test = invariant*).** Every state →
  signpost mapping (each edge predicate, each degradation case) MUST have a T0
  invariant test. Signpost correctness is an invariant (see Invariants), not a
  feature behaviour. No mapping ships without its test.

### Save-time completeness check + nag-avoidance guardrails

- **FR-9 (save-time check).** On save of a tracked artifact (`specs/**`,
  `plan`/`tasks`), the L1 checker runs (debounced) and refreshes the signpost.
  Holes surface immediately — the gate runs continuously, not only at commit/CI.
- **FR-10 (authorship branch — agent vs human).** Action on detected holes
  depends on author: **agent-authored** (`claude -p` dispatch) → auto-bounce
  (feed holes back; agent fixes and re-checks, in-loop). **Human-authored** →
  non-blocking diagnostics (Problems panel) + signpost + an offered "Fix with AI"
  action; MUST NOT auto-invoke the LLM on a human save.
- **FR-11 (draft vs ready — *guardrail 1*).** A half-written artifact is normally
  incomplete. Holes are treated as errors only when the artifact declares
  `status` at a ready/transition point (e.g. moving to `done`/gate) — mirrors
  SPEC-006 RD-2. Before that, holes are a forward-looking checklist, not red
  squiggles. (No nagging on every keystroke of a draft.)
- **FR-12 (deterministic check, LLM repair only — *guardrail 2*).** *Detection*
  of holes stays deterministic (L1) and runs every save at zero LLM cost. An LLM
  is invoked only to *propose a fix*, never to *decide whether* a hole exists.
  Keeps the every-save path cheap, offline-capable, trustworthy.
- **FR-13 (loop cap — *guardrail 3*).** Agent auto-bounce (FR-10) is bounded
  (config, default 3 iterations); repeated failure escalates per DR-355 (higher
  model, then human). Never an infinite write→check→rewrite loop.
- **FR-14 (dirty-editor safety — *guardrail 4*).** An LLM/auto fix MUST NOT
  clobber a file open with unsaved changes; fixes apply as a confirmable
  `WorkspaceEdit` / suggested edit, or defer until saved. (Upholds advisory
  invariant; mirrors SPEC-005 non-destructive INV.)
- **FR-15 (debounce + index lag — *guardrail 5*).** The save-time check debounces
  (~500ms), fires on save not keystroke, and MUST NOT re-check the same write
  twice. One save → at most one check.
- **FR-16 (shared checker, four callers — the leverage).** The L1 checker is a
  single pure function in `packages/shared`, consumed identically by (a) the
  extension save hook, (b) the pre-commit hook, (c) CI (`npm run validate`), and
  (d) agent dispatch. One checker → one verdict everywhere; editor, commit, CI,
  and agent can never disagree about "complete".

### Bug report — close the loop on a wrong signpost

- **FR-17 (one-click bug report — *capture the wrongness*).** When a signpost is
  wrong, the developer MUST be able to file it in **one action**: a **"Report wrong
  signpost"** command that opens a **pre-filled GitHub issue** (`harvest316/minspec`,
  labels `bug,signpost`) whose body is **FR-4's derivation evidence** (the exact state
  that produced the signpost) plus the MinSpec version and a **sanitised** state
  snapshot. The extension MUST NOT submit silently — it opens the pre-filled URL in the
  browser; the developer **reviews and submits** (upholds INV-Tier-0: no extension-side
  network; visible + opt-in per INV #5). FR-4 already produces the report *content*;
  FR-17 is the *channel*. Rationale: a wrong signpost is the single highest-value signal
  a never-wrong product can capture — this makes it captured **by default** rather than
  lost to a manual copy-paste (or an uninstall). Verified by a **T2 feature test**:
  derivation state → correctly pre-filled issue URL. (Not a state→signpost mapping, so
  not a T0 case under FR-8.)

## Costly to Refactor

*Expensive-to-reverse commitments — read these closely; everything else is cheap to
change. Ranked most→least costly.*

1. **DAG coverage model — edges-not-presence (FR-1).** The entire correctness story keys
   off "first incomplete node in topo order." Retreating to file-exists checks = re-deriving
   every signpost and re-writing every T0 mapping test. *Check: Acceptance Criterion 1
   ("coverage, not presence" — spec FR-1..5 + plan covering FR-1..3 names holes FR-4/FR-5)
   passes against fixtures, and the DAG model is the one recorded in DR-019, before implement.*
2. **Shared L1 checker — one pure fn, four callers (FR-16).** A near-public contract
   consumed by extension, pre-commit, CI, and agent dispatch. A second implementation =
   permanent drift; the four surfaces disagree about "complete." *Check: one function in
   `packages/shared`, imported everywhere, no fork.*
3. **L1 predicate grammar — traceability IDs (FR-3).** The `FR-N` → plan-ref → task grammar
   the predicate greps; co-owned with SPEC-013's parse contract. Changing it = re-parse +
   migrate every spec. *Check: grammar fixed before specs depend on it.*
4. **Advisory boundary (FR-5, INV-Advisory).** Shipping advisory then later making the
   signpost block = a behaviour reversal users feel. Blocking lives only in the separate
   opt-in DR-012 gate. *Check: advisory-only confirmed; blocking stays in DR-012.*
5. **Derive-on-demand, no cache (OQ2 resolved).** Pure-fs derivation is the contract; any
   future DAG cache must stay an internal optimisation behind the same pure fn, never a
   second source of truth. *Check: cache (if ever) cannot become a new way to be wrong.*

## Invariants (must hold)

- **INV — Signpost correctness (T0).** The signpost MUST NOT present a next step
  that is wrong for the current state, MUST NOT show "complete/green" unless the
  DAG is fully covered, and MUST say "unclear" rather than guess when state is
  incoherent. Because the signpost is a derived view of file-system truth (FR-2),
  correctness reduces to "reads state correctly" — testable (FR-8), not predicted.
- **INV — Advisory (T0).** The signpost and the save-time checker MUST NOT write
  to the developer's artifacts or block the developer's own edits/commits without
  explicit confirmation. All LLM repair is confirm-before-write (SPEC-005 FR-3)
  and dirty-editor-safe (FR-14).
- **INV — Tier 0 (DR-004).** L1 detection is pure file-system; no AI, no network.
- **INV #5 (user override wins).** Master toggle + per-signpost dismissal (FR-7).

## Acceptance Criteria

The signpost is **done** when all hold (each traces to its FR/INV; each is a T0/T1/T2 test per FR-8):

- [ ] **Coverage, not presence** — given a spec with FR-1..5 and a plan covering only FR-1..3, the signpost names the specific holes (FR-4, FR-5), not "planned" or "no plan". (FR-1, FR-3)
- [ ] **Deterministic, one verdict everywhere** — identical filesystem + frontmatter state yields an identical signpost across repeated runs *and* across all four callers (extension save hook, pre-commit, CI, agent dispatch), proven by a T1 contract test. (FR-2, FR-16)
- [ ] **Show why** — every signpost renders its derivation on demand (hover/click): the exact state + IDs that produced it ("plan.md exists; FR-4, FR-5 have no plan ref → next: cover FR-4, FR-5"). (FR-4)
- [ ] **One-click bug report** — a wrong signpost files a pre-filled `harvest316/minspec` issue from that derivation in a single action, and the extension never submits silently. (FR-17)
- [ ] **Advisory** — the signpost and the save-time checker never block edits or commits, and never write to the developer's artifacts without explicit confirmation. (FR-5, FR-14, INV-Advisory)
- [ ] **Honest degradation** — incoherent state (dangling/colliding IDs) surfaces "state unclear — open <file>" and never fabricates a confident next step. (FR-6)
- [ ] **Dismissible + sticky** — a dismissed signpost stays suppressed for the identical step until state changes; it never re-nags the same step. (FR-7)
- [ ] **Every mapping tested (T0)** — each state→signpost edge predicate and each degradation case has a passing T0 invariant test; no mapping ships without one. (FR-8, INV-correctness)
- [ ] **Tier-0** — the L1 detection path contains no AI and no network in `packages/minspec` / `packages/shared`. (INV-Tier-0, DR-004)
- [ ] **Ready-gated, debounced** — holes are a forward checklist (not errors) until `status: done`; the check is debounced, fires on save not keystroke, and runs at most once per save. (FR-11, FR-15)

## Coverage Map (all bases)

Explicit trace from the discussed mechanisms to FRs — nothing dropped.

| Correctness mechanism | FR |
|---|---|
| 1. Derive, never guess (pure fn) | FR-2 |
| 2. Show *why*, not just *what* | FR-4 |
| 3. Suggest, never block (advisory) | FR-5, INV-advisory |
| 4. Degrade honestly | FR-6 |
| 5. Dismissible + sticky (override memory) | FR-7 |
| 6. T0 test = invariant | FR-8, INV-correctness |
| LLM escalation (recovery) | FR-6 trigger → SPEC-005 |
| Partway-through-a-stage (DAG) | FR-1, FR-3 |
| Capture the wrongness (one-click bug report) | FR-17 (channel) ← FR-4 (content) |

| Nag-avoidance guardrail | FR |
|---|---|
| 1. Draft vs ready | FR-11 |
| 2. L1 checks, LLM only fixes | FR-12 |
| 3. Loop cap → escalate | FR-13 |
| 4. Dirty-editor safety | FR-14 |
| 5. Debounce + index lag | FR-15 |
| Authorship branch (agent vs human) | FR-10 |
| Save-time gate | FR-9 |
| Shared checker (one fn, four callers) | FR-16 |
| Bug-report channel | FR-17 |

## Risks & Mitigations

| # | Risk | Likelihood · Impact | Mitigation |
|---|---|---|---|
| R1 | **A wrong signpost ships — trust gone (the core threat).** A state→signpost mapping is incorrect; dev/agent is led astray. | Low · High | FR-8 T0 test per mapping; FR-2 pure derivation (testable, not predicted); FR-6 says "unclear" rather than guess; FR-17 captures any miss as a filed report. |
| R2 | **Checker drift across the four callers (FR-16).** Editor, pre-commit, CI, agent disagree on "complete". | Med · High | One pure fn in `packages/shared`; INV — single checker; T1 contract test asserts identical verdict across all four callers. |
| R3 | **Partial-coverage hole missed.** A presence check passes a plan covering FR-1..3 of FR-1..5. | Med · High | FR-1 DAG models coverage not presence; FR-3 greps every `FR-N` for a downstream ref; FR-8 T0 case for partway-through. |
| R4 | **Nag fatigue.** Every-keystroke squiggles on a half-written draft → users disable the signpost. | High · Med | FR-11 holes are errors only at the ready/transition (`status: done`); FR-15 debounce, save-not-keystroke; FR-7 dismissible + sticky, never re-nag. |
| R5 | **Incoherent state → confident-but-wrong next step.** Dangling/colliding IDs produce a fabricated "next". | Med · High | FR-6 honest degradation ("state unclear — open tasks.md") routes to SPEC-005 repair offer, never a guess. |
| R6 | **Auto-fix clobbers unsaved work / loops forever (the FR-10 agent-bounce path).** A `WorkspaceEdit` overwrites a dirty buffer, or the write→check→rewrite cycle never converges. | Low · High | FR-14 dirty-editor safety (confirmable `WorkspaceEdit`); FR-13 loop cap (default 3) → DR-355 escalation. |
| R7 | **FR-17 leaks private spec content to GitHub.** Pre-filled issue body carries paths / spec text. | Med · Med | Sanitised snapshot; extension never auto-submits — opens pre-filled URL, dev reviews + submits (INV-Tier-0; INV #5 visible + opt-in). |
| R8 | **Floor depends on unbuilt specs.** Predicate strength (SPEC-006) is `specifying`. | Med · Med | FR-3 ships with the L1 grammar today; SPEC-006 strengthens the predicate behind the same interface; SPEC-012/DR-019 already resolved global order (OQ1). Sequence SPEC-006 before the L4 layer is trusted. |

## Consequences

**Positive:**
- A signpost **correct by construction** — derived (FR-2) and tested per-mapping (FR-8). The product's whole trust claim becomes *earnable*, not asserted.
- One checker, four callers (FR-16) → editor / commit / CI / agent can never disagree about "complete".
- The rare wrong signpost is **captured** (FR-17), not lost — it feeds back instead of churning a user.

**Negative:**
- A DAG + coverage grammar is more machinery than a file-exists check — more to build, test, and keep coherent with SPEC-006/SPEC-013's parse contract.
- Derive-on-demand (no cache) trades per-query cost for correctness; very large repos may later need the optimisation (additive — OQ2).
- The traceability `FR-N`-ref grammar becomes load-bearing: specs that don't follow it degrade to "unclear" (honest, but a real authoring constraint).

## Alternatives Considered

- **File-exists checklist (the naive impl).** Rejected (Context): can't see a partial-coverage hole — a plan covering FR-1..3 of FR-1..5 is neither "no plan" nor "planned". Correctness requires coverage, not presence (FR-1).
- **LLM-judged "is the next step right?"** Rejected: breaks Tier-0 (DR-004) + derive-never-guess (FR-2); non-deterministic, un-T0-testable, costs tokens every save. The LLM is confined to *repair* (SPEC-005), never *detection*.
- **Blocking the signpost (hard gate at every hole).** Rejected here: the signpost is advisory (FR-5 / INV-Advisory). Blocking is the separate opt-in DR-012 gate that *consumes* this contract; keeping them apart preserves "suggest, never block".
- **Persisted DAG cache as source of truth.** Rejected (OQ2): adds a cache-coherence failure surface — a new way to be wrong — against a product whose one job is never being wrong. Derive on-demand; cache only ever as an internal optimisation behind the pure fn.
- **FR-17 auto-submit telemetry.** Rejected: silent network breaks INV-Tier-0 / air-gap. Pre-filled URL + manual submit keeps capture visible + opt-in.

## Dependencies

- **`relates_to: SPEC-006`** (Stub & Completeness Gate) — strengthens the L1 completeness
  predicate (FR-3, and the hollow-test layer) so stubs / placeholder prose can't pass as
  complete. This spec defines the predicate *interface* and consumes it; SPEC-006 is
  `specifying` — sequence it before that layer is trusted.
- **`relates_to: SPEC-005`** (Auto-Structure Repair) — the honest-degradation state (FR-6)
  is the trigger; SPEC-005's offer-never-silent (its FR-3) is the contract for any LLM
  repair. Confirm-before-write + dirty-editor-safe (FR-14).
- **`relates_to: SPEC-012`** (Next-Task Resolver) / **DR-019** — resolved OQ1: the
  deterministic global order `(severity-class, epic.order, artifact-id)` when multiple
  specs are simultaneously incomplete.
- **`relates_to: SPEC-013`** (Self-Audit floor) — co-owns the traceability parse grammar
  the L1 predicate greps; its FR-11 *consumes* this spec's DAG coverage edge (amended
  under [#121](https://github.com/harvest316/minspec/issues/121)).
- **DR-012** — the HITL approval gate *consumes* this completeness contract (blocking lives
  there, not here). **DR-004** — Tier-0 pure-fs. **DR-355** — escalation for the FR-13 loop cap.

### Blast-Radius (what breaks if changed)

The shared L1 checker (FR-16) is the highest-blast-radius surface in this spec: a single
pure function in `packages/shared` imported by four callers, so a change ripples outward.

- **Change the L1 checker's verdict shape / predicate semantics (FR-3, FR-16)** → breaks all
  four consumers at once: the extension save hook (FR-9), the pre-commit hook
  (`.githooks`), CI (`npm run validate`), and agent dispatch (`scripts/dispatch-issue.sh`,
  FR-10). The four-caller leverage cuts both ways — one edit, four surfaces. Mitigated by the
  T1 contract test (Acceptance Criterion 2) asserting identical verdict across all callers.
- **Change the traceability `FR-N`→plan-ref→task grammar (FR-3)** → breaks SPEC-013's
  co-owned parse contract (Dependencies) and forces a re-parse/migrate of every spec under
  `specs/**`; also breaks SPEC-013 FR-11 which *consumes* this DAG coverage edge (#121).
- **Retreat the DAG coverage model to file-exists (FR-1)** → every signpost re-derives and
  every T0 mapping test (FR-8) is rewritten (Costly #1).
- **Make the signpost block (reverse FR-5 / INV-Advisory)** → breaks the advisory contract
  DR-012's opt-in gate relies on; users feel a behaviour reversal (Costly #4).
- **Change `preferences.json` override schema (FR-7)** → breaks dismissal stickiness and the
  cached-repair determinism that reuses the INV #5 override model.

Low-blast-radius (isolated to this spec): FR-17 bug-report channel, the debounce timing
(FR-15), and the loop-cap default (FR-13) — all tunable without touching consumers.

## Assumptions

- The traceability `FR-N`→plan-ref→task grammar (FR-3) is actually followed by spec authors;
  specs that don't follow it deliberately degrade to "unclear" (FR-6) rather than to a wrong
  signpost (accepted authoring constraint, see Consequences negative #3).
- `status: done` (reused from SPEC-006 RD-2 per resolved OQ) is the single ready/transition
  trigger for FR-11 — no separate signpost-ready signal exists or is needed.
- Topological global order is already resolved by SPEC-012 / DR-019 `(severity-class,
  epic.order, artifact-id)`; this spec consumes that order and does not re-derive it (OQ1).
- The DAG is derived on-demand from `.minspec/traceability.json` + frontmatter with no
  persisted cache (resolved OQ2) — repo sizes are assumed small enough that per-query
  derivation cost is acceptable until proven otherwise.
- Agent-authored saves are reliably distinguishable from human saves (FR-10) via the
  `claude -p` dispatch path, so the auto-bounce vs offered-fix branch is decidable.

## Test-thought

Verified by the FR-8 T0 mapping suite: each state→signpost edge predicate and each
degradation case (FR-6) has a passing T0 invariant test, plus a T1 contract test proving the
shared checker (FR-16) returns an identical verdict across all four callers, and a T2 feature
test for the FR-17 pre-filled-issue channel. Because the signpost is a pure function of
filesystem state (FR-2), correctness is *tested against fixtures*, not predicted.

## Failure-Modes / Edge-Cases

- **Partial coverage straddling a stage (FR-1, FR-3).** Plan covers FR-1..3 of FR-1..5 →
  signpost MUST name the specific holes (FR-4, FR-5), not collapse to "planned" or "no plan".
- **Incoherent state — dangling/colliding IDs (FR-6).** A `task` with no parent plan item, a
  dangling `FR-N` reference, or two hand-edited specs colliding on the same `FR-N` → resolver
  emits "state unclear — open <file>" and routes to SPEC-005, never a fabricated "next".
- **Dirty editor during auto-fix (FR-14).** Target file open with unsaved changes → fix MUST
  apply as a confirmable `WorkspaceEdit` or defer until saved; MUST NOT clobber.
- **Agent auto-bounce non-convergence (FR-13).** Holes persist after the loop cap (default 3)
  → escalate per DR-355 (higher model, then human); never an infinite write→check→rewrite.
- **Save storm / double-fire (FR-15).** Rapid saves or the ~500ms index-lag debounce window
  → at most one check per write; the same write is never re-checked twice.
- **Draft-stage noise (FR-11).** Holes in an artifact still below `status: done` → surfaced
  as a forward checklist, NOT red-squiggle errors (no every-keystroke nagging).
- **Private content in a bug report (FR-17).** Pre-filled issue body would carry spec paths /
  prose → sanitised snapshot; extension opens the URL, dev reviews + submits (never silent).

## Test / Verification Strategy

Per-FR test tier (T0 = invariant, T1 = contract, T2 = feature) with a one-line assertion
sketch. T0 is mandated by FR-8 for every state→signpost mapping.

| FR | Tier | Assertion sketch |
|---|---|---|
| FR-1 | T0 | Spec FR-1..5 + plan covering FR-1..3 → signpost == "cover FR-4, FR-5" (not "planned"). |
| FR-2 | T1 | Same fixture run twice → byte-identical signpost; no randomness/hidden state. |
| FR-3 | T0 | Each `FR-N` without a downstream plan ref is flagged; every covered FR passes. |
| FR-4 | T2 | Hover/derivation request returns the exact state string + IDs that produced the signpost. |
| FR-5 | T0 | Edits/commits proceed with the signpost present; no block raised. |
| FR-6 | T0 | Dangling/colliding ID fixture → "state unclear — open <file>", never a confident next. |
| FR-7 | T0 | Dismiss step X → X stays suppressed until state changes; re-nag never fires for identical X. |
| FR-8 | T0 | Meta: assert each edge predicate + degradation case owns a passing T0 test (no orphan mapping). |
| FR-9 | T2 | Save of `specs/**` (debounced) → signpost refreshes; holes surface without commit/CI. |
| FR-10 | T2 | Agent-authored save → auto-bounce; human-authored save → diagnostics + offered fix, no auto-LLM. |
| FR-11 | T0 | Holes below `status: done` → checklist (no errors); at `done` transition → errors. |
| FR-12 | T0 | Detection path invokes no LLM; LLM entered only on an explicit fix request. |
| FR-13 | T2 | Auto-bounce hits cap (3) on persistent hole → escalates per DR-355, loop terminates. |
| FR-14 | T0 | Fix against a dirty file → applied as confirmable `WorkspaceEdit`/deferred; original untouched. |
| FR-15 | T0 | N rapid saves of one write → exactly one check; same write never re-checked. |
| FR-16 | T1 | Same state → identical verdict from extension hook, pre-commit, CI, agent (one fn, no fork). |
| FR-17 | T2 | Derivation state → correctly pre-filled `harvest316/minspec` issue URL; no silent submit. |

## Rollback / Reversibility

- **Undo mechanism.** The signpost is a pure derived view (FR-2) with no persisted DAG cache
  (resolved OQ2) — disabling it writes nothing back, so removal is a clean revert plus the
  INV #5 master toggle (FR-7) lets a user switch it off without a code change. Per-caller
  wiring (extension hook FR-9, pre-commit, CI, agent FR-10) can each be unhooked independently
  because they share one `packages/shared` function (FR-16).
- **ADR-filter answer.** Reversible in <1 day for the *advisory surface and its callers*, but
  **NOT** for the load-bearing commitments — the DAG coverage model (FR-1, Costly #1), the
  shared checker contract (FR-16, Costly #2), and the traceability grammar (FR-3, Costly #3)
  are co-owned with SPEC-013 and depended on by SPEC-006/SPEC-012; these crossed the ADR
  threshold and are recorded in DR-012 (gate consumer) and DR-019 (global order). So: the
  feature wiring is cheap to pull; the model and contract are not, and already carry DRs.

## Out of scope

- **Stub / placeholder predicate body** — owned by SPEC-006 (this spec defines
  the predicate interface and consumes it).
- **Semantic adequacy** ("is this a *good* plan") — would require AI judgement;
  the LLM only repairs structure (SPEC-005), it does not score quality.
- **Incoherent-structure offer/repair mechanics** — owned by SPEC-005; this spec
  defines only the honest-degradation trigger and the confirm-before-write
  contract.
- Visual/UX design of the status-bar and explorer surfaces (separate UX spec).
- Blocking enforcement (the HITL gate is DR-012; the signpost itself is advisory).

## Open questions

- ~~Topological ordering when multiple specs are simultaneously incomplete — most
  recently edited, lowest SPEC-NNN, or explicit priority/WSJF? (Affects which
  single "next step" surfaces globally.)~~ **Resolved by
  [SPEC-012 Next-Task Resolver](../SPEC-012-next-task-resolver/requirements.md) / DR-019:**
  deterministic total order `(severity-class, epic.order, artifact-id)`; subjective
  weight in explicit frontmatter, never inferred.
- ~~Where the coverage DAG lives: derived on demand from `.minspec/traceability.json`
  + frontmatter, or cached.~~ **Resolved (this review): derive on-demand**, no persisted
  cache — honours DR-004 pure-fs / FR-2 derive-never-guess and avoids a cache-coherence
  failure surface. If perf demands it later, a cache is an additive optimisation behind
  the same pure fn (Costly #5).
- ~~Exact "ready/transition" trigger set for FR-11 (reuse SPEC-006 RD-2 `status: done`
  transition vs a distinct signpost-ready signal).~~ **Resolved (this review): reuse
  SPEC-006 RD-2 `status: done` transition** — no new signal. Holes are a forward-looking
  checklist before `done`; they become errors at the `done`/gate transition. One trigger,
  fewer dependencies (FR-11).

**None open.**

## Follow-ups (tracked)

- **FR-17 "Report wrong signpost" command** — contributed command + pre-filled
  `harvest316/minspec` issue body (labels `bug,signpost`); lands at implement with the
  signpost surface — no separate issue (same spec/epic). The issue *template* is a
  one-time repo setup → file a `harvest316/minspec` issue per DR-023 if the team wants it
  tracked separately.
- **SPEC-006 predicate strength** must land before the FR-9 L4 (hollow-test) layer is
  trusted — sequencing note for SPEC-006's plan; not a new issue (same epic).
- **[#121](https://github.com/harvest316/minspec/issues/121)** (approved-spec amend:
  SPEC-013 FR-11 consumes this DAG coverage edge) — already tracked; this spec's edge
  ships independently of #121.
- **Site / marketplace copy** — "the signpost is computed deterministically — no LLM in
  that decision path, so it can't hallucinate — and the rare gap is one click to
  report" is a positioning beat (FR-17); lead with the mechanism, not a "never wrong"
  infallibility claim (baseline correctness isn't a differentiator). Non-code →
  `harvest316/minspec` issue per DR-023 forward rule if the team wants it surfaced.

## Amendment A (2026-10-03) — coverage edge from each FR to the required cross-cutting sections — PROPOSED, not accepted

**Triggered by:** [#121](https://github.com/AIClarityAU/minspec/issues/121) (amend SPEC-010:
the coverage DAG must include required cross-cutting sections).
**Rests on:** [DR-028](../../../docs/decisions/DR-028.md) decision 3 (cross-cutting sections
are coverage-checked, on this spec's DAG) and [DR-029](../../../docs/decisions/DR-029.md)
(self-audit floor; names this amendment in its follow-ups). No new decision record: the
choice to put this edge on SPEC-010's DAG is already recorded in DR-028, which is accepted.
**Consumed by:** [SPEC-013](../SPEC-013-risk-section-policy/requirements.md) FR-11 (coverage
layer of the self-audit floor).

**How to read this amendment.** FR-1 to FR-17 above are untouched. Everything this
amendment adds is in this section, numbered on from FR-18. Outside this section the diff
changes only the two status lines, the `relates_to:` list and a three-line pointer under the
State Model. This spec is T4 (complete ceremony) and was approved on 2026-09-09; editing it
voids that hash-bound approval (DR-012, the approval gate), so the frontmatter says
`specifying` until a human re-approves. Three questions under
[Decisions needed (Clarify)](#decisions-needed-clarify) are for the human to settle.

### One-sentence scope

Add one edge type to the coverage DAG so that a required cross-cutting section which is
present but does not reference every FR is a partially-covered node naming the missing FRs,
instead of reading as complete because it exists.

### Context

The State Model above has one chain: `spec`, then `plan`, then `tasks`, then `code`. A
spec's own cross-cutting sections (Risks & Mitigations, Consequences) are not nodes, so the
DAG cannot see the failure DR-028 was written for: a Risks section is authored early, FRs
are added later, and the section still reads as done because it is present.

DR-028 splits the cure in two. **Freshness** (was the section written against the current
FR text?) is a hash check and belongs to SPEC-013 FR-10. **Coverage** (is each FR referenced
in the section at all?) is the same question FR-3 already asks of the plan, so it belongs
here. This amendment specifies only the coverage half.

**Measured state of the corpus (2026-10-03, base commit `350c6fa4`).** A throwaway read-only
script (not committed) scanned every `specs/**/SPEC-*/requirements.md`, took as the FR set
each `FR-N` that opens a list item, heading or table row, and looked for whole-token
references inside the section whose heading starts with "Risks" or "Consequences":

| Measure | Count |
|---|---|
| Spec requirements files scanned | 76 |
| ...with at least one FR id | 73 |
| ...with a Risks section | 41 |
| ...whose Risks section references every FR | 2 |
| ...with a Consequences section | 13 |
| ...whose Consequences section references every FR | 0 |
| ...using a suffixed FR id such as `FR-4a` | 9 |
| Sections using a range such as `FR-1..3` | 3 |

This spec is itself in the 39: its Risks & Mitigations table references 13 of 17 FRs and
omits FR-4, FR-5, FR-9 and FR-12. The parser used for these counts is ad hoc, so the
numbers are an order-of-magnitude guide for the decisions below, not a baseline to assert
against. No FR-id parser exists in the product today: a search of `packages/minspec/src`,
`packages/shared/src` and `scripts` for an `FR-` digit pattern in code returns nothing,
which agrees with SPEC-013 FR-12 ("parses none of these").

### State model (amended)

```
spec(FR-1..N) --covers--> plan(items) --covers--> tasks(checkboxes) --covers--> code
      |
      +--referenced-in--> section(Risks & Mitigations)
      +--referenced-in--> section(<each further coverage-bearing section>)
```

A section node is a **leaf**: nothing depends on it. It has four states, defined in FR-20.

### Requirements (Amendment A)

- **FR-18 (section nodes).** For each spec, the DAG gains one node per **coverage-bearing
  section** that applies to that spec. Which sections are coverage-bearing, and which apply
  to a given spec (artifact kind and minimum tier), is supplied to the checker as input by
  its caller; the source of that list is SPEC-013 FR-1's section registry. This spec does
  not hold a second copy of the registry. The initial list is settled by DQ-1.
- **FR-19 (the reference predicate).** FR-N is **covered by** a section when the section
  body contains FR-N as a whole token.
  - *One FR set.* The FR set is the same set FR-3 uses for the spec-to-plan edge. The two
    edges MUST NOT be able to disagree about which FRs a spec has.
  - *Whole token.* `FR-1` is not matched inside `FR-10`, and `FR-4` is not matched inside
    `FR-4a`; a suffixed id is its own FR and is covered only by its own token.
  - *Literal only.* A range or shorthand (`FR-1..3`, `FR-2/3/4`, "FR-1 to FR-5") covers
    only the ids written out in full. Interior ids are not inferred.
  - *Foreign references do not count.* A token qualified by another spec's id
    (`SPEC-005 FR-3`, `SPEC-005's FR-3`, `SPEC-005/FR-3`) does not cover this spec's FR-3.
    The same token qualified by this spec's own id does.
  - *Section body.* From the matching heading to the next heading of the same or a higher
    level. Locating the heading is SPEC-013 FR-2's predicate, not redefined here; when it
    matches more than one section, the body is the union of them.
  - *Unknown ids are ignored.* A token naming an FR that is not in the FR set is listed in
    the evidence (FR-22) and never changes the verdict. It is not the incoherent state of
    FR-6, because prose legitimately mentions other specs' FRs in looser phrasing.
- **FR-20 (four states; presence never latches complete).** Each section node reports
  exactly one of:
  - `covered` — the section is present and every FR in the FR set is covered;
  - `partial` — the section is present and one or more FRs are not covered. The verdict
    names them, in ascending id order. A present section that references no FR at all is
    `partial` with every FR named;
  - `absent` — no section with that heading exists;
  - `not-applicable` — the spec's FR set is empty.

  A present section is never `covered` on presence alone. An empty FR set is never reported
  as `covered`: a spec whose FR ids failed to parse must not read as fully covered.
- **FR-21 (signpost placement).** A `partial` section is the FR-1 "partway" state and is
  named to its specific FRs ("Risks & Mitigations does not reference FR-7, FR-8"). FR-11
  applies unchanged: before the ready transition a `partial` section is a forward checklist
  entry, at the transition it is an error-severity diagnostic. Because a section node is a
  leaf, it never changes the verdict of the plan, tasks or code edges. Within one spec, a
  section hole that is due sorts **before** that spec's plan, tasks and code holes (a spec
  whose own self-audit has a hole is not finished being specified); the order across specs
  remains SPEC-012's. When an `absent` section becomes a finding is settled by DQ-2.
- **FR-22 (evidence).** FR-4's derivation covers the new edge: for each section node the
  signpost can show the section heading and file, the state, the covered ids, the uncovered
  ids, and any unknown ids. A wrong verdict is diagnosable to the heading and the FR id.
- **FR-23 (structural only).** The edge answers one question: is the FR's id present in
  the section. It MUST NOT score, rank or judge what is written beside the id. A written
  escape that names the FR ("FR-9: no distinct risk, covered by FR-2", SPEC-013 FR-3)
  covers it. Mirrors SPEC-013 FR-4 and SPEC-012 FR-15 (no quality oracle).
- **FR-24 (coverage and freshness stay separate).** The edge reads section text and the FR
  set. It MUST NOT read, write or depend on SPEC-013's freshness hash (SPEC-013 FR-10), and
  a freshness verdict MUST NOT suppress or satisfy a coverage verdict, nor the reverse. The
  two are reported independently; a consumer that shows both joins them by FR id.
- **FR-25 (same checker, same guarantees).** The edge is part of the single shared L1
  checker of FR-16, not a second function, so all four callers get the identical verdict.
  It is Tier 0 (no AI, no network), pure (FR-2), advisory (FR-5), and it never writes or
  generates section text. A finding from this edge MUST NOT change any caller's exit code
  (aligned with SPEC-013 FR-6, which forbids a non-zero exit for the same findings). Every
  state in FR-20 and every rule in FR-19 has a T0 (invariant-tier) test under FR-8.

### Contract (the shape SPEC-013 FR-11 consumes)

Interface only; names are final at Plan, the fields and states are the contract.

```ts
/** One coverage-bearing section that applies to this spec (caller-supplied, FR-18). */
interface CoverageSection {
  heading: string;        // registry heading, e.g. "Risks & Mitigations"
  body: string | null;    // union of matching section bodies; null when absent
}

type SectionCoverage =
  | { heading: string; state: 'covered'; covered: string[]; unknown: string[] }
  | { heading: string; state: 'partial'; covered: string[]; uncovered: string[]; unknown: string[] }
  | { heading: string; state: 'absent' }
  | { heading: string; state: 'not-applicable'; reason: 'no-fr-ids' };

/** Pure. Same inputs give the same output. `frIds` is the FR-3 FR set. */
declare function sectionCoverage(
  specId: string,
  frIds: readonly string[],
  sections: readonly CoverageSection[],
): SectionCoverage[];
```

`covered`, `uncovered` and `unknown` are id lists in ascending order (numeric part first,
then suffix). `partial` always has a non-empty `uncovered`.

### Decisions needed (Clarify)

Each question states a recommendation and what that recommendation costs.

**DQ-1 — Which sections carry the edge at first?** The caller-supplied list makes this a
data choice that is cheap to widen later, but the first list decides how much the edge
flags on day one.

- `a` **(rec)** Risks & Mitigations only. It is the one section whose registry shape is
  already per-FR, and the only one with a per-FR written escape (SPEC-013 FR-3), so every
  flagged FR has a legitimate one-line way to be covered. *Cost: it is narrower than the
  issue's wording and DR-028's context paragraph, which both name Consequences; a
  Consequences section can still silently under-cover, caught only by SPEC-013 freshness.*
- `b` Risks & Mitigations and Consequences, as the issue words it. *Cost: SPEC-013 FR-4
  defines Consequences as a minimal positive/negative shape with no per-FR escape, so
  satisfying the edge means listing every FR id in a section never designed per-FR.
  Measured: 0 of 13 existing Consequences sections would pass.*
- `c` Every registry row marked cross-cutting (ten sections), the widest reading of
  DR-029's "self-audit-section coverage edge". *Cost: demands per-FR references in
  Assumptions, Alternatives Considered and Rollback, which are free prose; the largest
  volume of findings and the strongest pull toward id-listing boilerplate.*

If `a` is chosen, Test / Verification Strategy (registry shape "per-FR test tier") is the
natural second row and is a list edit, not a new mechanism. It is not proposed here because
the issue does not ask for it.

**DQ-2 — When does an `absent` section become a finding?** FR-11's resolved open question
says there is one ready trigger, the `status: done` transition. SPEC-013 FR-13, approved
later, makes the self-audit sections due earlier for T3/T4 specs, at core-signoff. Two
approved specs disagree about "due".

- `d` **(rec)** Keep FR-11's single trigger. An `absent` section is silent until the
  ready transition and a finding at it; the signpost never learns about core-signoff.
  SPEC-013 FR-6 raises its own offer after core-signoff, using this predicate. *Cost:
  between core-signoff and the ready transition the signpost does not point at an absent
  section; until SPEC-013's lifecycle is built nothing does.*
- `e` Dueness is a second caller-supplied input, fed from SPEC-013's lifecycle, with
  FR-11 as the fallback while that lifecycle is unbuilt. *Cost: reopens a resolved open
  question, adds a second trigger and couples the signpost's timing to an unbuilt
  mechanism (SPEC-013 FR-13 has no implementation, per its own `implements_reason`).*

**DQ-3 — What happens to the specs that already fail?** By the measurement above, about 39
of the 41 specs with a Risks section would report `partial`.

- `f` **(rec)** No grandfathering. Findings are advisory and never change an exit code
  (FR-25), so existing specs simply show their holes and are fixed when next edited.
  *Cost: every already-approved spec that is fixed needs re-approval, because adding the
  missing FR ids edits hash-locked text; and until fixed, about 39 specs carry a standing
  diagnostic, which risks teaching the reader to ignore the edge.*
- `g` Apply the edge only to specs approved after this amendment ships. *Cost: needs a
  persisted per-spec marker or an approval-date comparison, which is new state the pure
  derivation (FR-2) must read, and leaves the 39 permanently unchecked.*
- `h` One backfill pass before the edge is switched on. *Cost: about 39 spec edits and 39
  re-approvals in one batch, for a human who reads every document.*

### Invariants (Amendment A)

- **INV-A1 — Presence never latches complete (T0).** No input exists for which a section
  is `covered` while an FR in the FR set has no whole-token reference in its body.
- **INV-A2 — Empty is not covered (T0).** An empty FR set yields `not-applicable`, never
  `covered`.
- **INV-A3 — Structural only (T0).** The verdict depends only on which FR ids appear in
  the section body; changing any other text leaves it unchanged.
- **INV-A4 — Leaf node (T0).** Adding, removing or changing a section node never changes
  the plan, tasks or code verdict for the same spec.
- **INV-A5 — One checker, one FR set (T1).** The edge lives in the FR-16 function and uses
  the FR-3 FR set.
- The four invariants above this amendment (signpost correctness, advisory, Tier 0, user
  override wins) and constitution invariants 1 (offline core) and 2 (no silent gate) hold
  unchanged. This edge is advisory, so it is not a gate; if a later spec makes it gate
  anything, invariant 2's visible-failure rule applies to that spec.

### Acceptance criteria (Amendment A)

- [ ] **Partial is named** — a spec with FR-1 to FR-5 whose Risks section references FR-1
  to FR-3 reports `partial` with `uncovered` exactly FR-4, FR-5. (FR-19, FR-20, INV-A1)
- [ ] **Added FR reopens the node** — starting from `covered`, adding FR-6 to the spec
  with no section edit yields `partial` naming FR-6. (FR-20, INV-A1)
- [ ] **Whole token** — a section containing only `FR-10` and `FR-4a` covers neither FR-1
  nor FR-4. (FR-19)
- [ ] **Literal only** — a section containing `FR-1..3` covers FR-1 and nothing else.
  (FR-19)
- [ ] **Foreign reference** — `SPEC-005 FR-3` does not cover this spec's FR-3; the same
  token qualified by the spec's own id does. (FR-19)
- [ ] **Empty FR set** — a spec with no parsed FR ids reports `not-applicable`, and the
  evidence says no FR ids were parsed. (FR-20, FR-22, INV-A2)
- [ ] **Written escape covers** — "FR-9: no distinct risk, covered by FR-2" covers FR-9;
  rewording the text beside the id does not change the verdict. (FR-23, INV-A3)
- [ ] **Leaf** — toggling a section between `covered` and `partial` leaves the plan, tasks
  and code verdicts byte-identical. (FR-21, INV-A4)
- [ ] **Independent of freshness** — the verdict is identical with and without a SPEC-013
  freshness record present, and for a stale and a fresh one. (FR-24)
- [ ] **One verdict, no exit-code change** — the four FR-16 callers return the identical
  section verdicts for one fixture, and a `partial` finding leaves `npm run validate` exit
  status unchanged. (FR-25, INV-A5)
- [ ] **Evidence** — the derivation for a `partial` section shows heading, file, covered,
  uncovered and unknown ids. (FR-22)
- [ ] **Unknown id ignored** — a section mentioning FR-99 in a spec with FR-1 to FR-5
  lists FR-99 as unknown and reports the same state as without it. (FR-19)

### Costly to refactor (Amendment A)

1. **The reference grammar (FR-19).** Once specs are authored to satisfy it, tightening it
   (for example, requiring the id to open a table row) reopens every `covered` section.
   Loosening is cheap. It is co-owned with SPEC-013 FR-12's parse contract and extends
   Costly #3 above. *Check: FR-19's five rules are fixed and tested before any spec is
   edited to satisfy the edge.*
2. **The verdict shape (Contract).** SPEC-013 FR-11 consumes it; changing a state name or
   field is a two-spec change.

Everything else is cheap: the section list is data (DQ-1), and the intra-spec sort position
in FR-21 is one ordering key.

### Risks & mitigations (Amendment A)

| # | Risk | Likelihood · Impact | Mitigation |
|---|---|---|---|
| RA1 | **Id-listing passes the edge.** A line reading "FR-1 to FR-17: none" written out in full covers everything and says nothing. | High · Med | Stated, not solved: FR-23 makes the edge structural by design; SPEC-013 R4 (vacuity passes Tier 0) is the standing residual and its specificity layer is the next net. No skim claim rests on this edge. |
| RA2 | **False covered through a loosely phrased foreign reference** ("its FR-3" about another spec). | Med · Med | FR-19 excludes the three id-qualified forms; the unqualified form is an accepted residual, visible in FR-22 evidence. |
| RA3 | **False covered through an unparsed FR set.** | Low · High | FR-20 and INV-A2: empty is `not-applicable`, never `covered`; FR-19 ties the FR set to FR-3's so a parse gap shows on the plan edge too. |
| RA4 | **Standing noise.** About 39 existing specs report `partial`; readers learn to ignore it. | High · Med | DQ-3 puts the choice to the human; FR-25 keeps findings off every exit code; FR-21 with FR-11 keeps pre-ready holes as a checklist, not errors. |
| RA5 | **Section list drifts from SPEC-013's registry.** | Med · Med | FR-18: the list is caller-supplied from the registry, with no second copy in this spec. |
| RA6 | **Coverage and freshness get merged into one signal** and one masks the other. | Low · High | FR-24 forbids either reading or satisfying the other; acceptance criterion "Independent of freshness". |
| RA7 | **Two unbuilt specs each wait on the other.** This edge needs SPEC-013 FR-2 (heading match) and FR-12 (FR-id grammar); SPEC-013 FR-11 needs this edge. | Med · Med | The dependency is on two small pure parsers, not on SPEC-013's lifecycle. Plan sequences those parsers first in `packages/shared`; FR-22's evidence and FR-25's tests do not depend on the rest of SPEC-013. |
| RA8 | **A section hole outranks real plan work** in the signpost. | Low · Low | FR-21 sorts it first only once due; FR-7 dismissal applies; the position is one ordering key. |

### Alternatives considered (Amendment A)

- **A new spec instead of an amendment.** Rejected: DR-028 decision 3, SPEC-013 FR-11 and
  the issue all place the edge on this spec's DAG, and FR-16's single-checker rule means a
  second spec would own half of one function.
- **Put coverage in SPEC-013 beside freshness.** Rejected by DR-028: it is the question
  FR-3 already asks, and a second coverage implementation is the drift FR-16 exists to
  prevent.
- **Expand ranges** (`FR-1..3` covers FR-2). Rejected: three notations are in use in the
  corpus and each needs its own rule; a mis-expanded range reads as covered when it is not,
  which is the one direction this spec forbids. Literal-only errs toward naming a hole.
- **Treat unknown ids as incoherent state (FR-6).** Rejected: sections routinely mention
  other specs' FRs, so this would degrade healthy specs to "state unclear".
- **Section nodes on the main chain, before plan.** Rejected: it would let a Risks hole
  change the plan edge's verdict, and DR-028 wants these sections completed last.
- **Require the id in a fixed position** (first cell of a table row). Rejected for now:
  stronger against RA1 but fails T1 and T2 specs, whose Risks form is a line or bullets
  (SPEC-013 FR-4). Recorded under Costly to refactor as the direction that is expensive
  to take later.

### Out of scope (Amendment A)

- Freshness, the hash, and when a section is stale (SPEC-013 FR-10).
- Whether a section is required, its shape, and its heading match (SPEC-013 FR-1, FR-2,
  FR-4).
- Decision records. They have no FR set, so this edge does not apply to them; nothing here
  promises a DR equivalent.
- Authoring, repairing or backfilling section text. Backfill of existing specs is DQ-3.
- The DR-053 version 2 reference grammar (`FR3`, slash-joined). The edge follows whatever
  FR-id grammar SPEC-013 FR-12 fixes; migration is tracked at #679 (grammar) and #681
  (corpus).
- Making any finding blocking.

### Follow-ups (Amendment A, tracked)

- **This spec's own Risks & Mitigations omits FR-4, FR-5, FR-9 and FR-12.** Deliberately
  not fixed in this amendment, so the diff above the amendment stays reviewable; it falls
  under whichever option DQ-3 selects. Tracked on #121.
- **SPEC-013 FR-11** already says it consumes this edge "amended under #121"; no edit to
  SPEC-013 is needed for this amendment as proposed. If DQ-2 option `e` is chosen, SPEC-013
  FR-13 gains a consumer and that spec needs its own tracked amendment (no issue filed:
  this dispatch has no network access; it would be filed when `e` is selected).
- **Plan and tasks** for the edge follow re-approval, on #121.
