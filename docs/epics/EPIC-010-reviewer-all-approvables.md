---
id: EPIC-010
slug: reviewer-all-approvables
title: Reviewer Across All Approvables
status: active
order: 10
---

# EPIC-010: Reviewer Across All Approvables

## Goal

Ship the independent AI reviewer — established for PRs by
[DR-033 §6](../decisions/DR-033.md) — for **every document type MinSpec produces
or consumes** (Spec, Plan, design.md, tasks.md, DR, constitution invariant, Epic,
**Issue**, PR — including non-human-approvable types). AI review is the universal
floor; the **human gate** is the critical subset (DR-047 Decision 5: low-criticality
docs may auto-accept on AI greenlight, dev opt-in). Every artifact is greenlit by a
fresh-context opus reviewer that is never the author; the human queue becomes a
pre-filtered, AI-greenlit set across all human-gated types; the rubber-stamp failure
class (#344–349) becomes structurally unreachable.

"Done" = an independent reviewer-agent exists and runs for each doc type (the
AI-reviewed superset, Issue included); the signpost predicate (greenlit-for-type ∧
prior-stage-gates-clear ∧ human-gate-open) applies uniformly to the human-gated
subset; the doc-before-*implementing*-code ordering gate is enforced (unrelated
code unblocked); per-type verdict recording (`ai-review/<type>:*`) is wired; the
per-dev coverage-slider and the low-criticality auto-approve config exist.

## Principle

**Independence is the value (DR-033 §6).** The reviewer is always a second agent
with fresh context — never the one that authored the artifact. Reviewing your own
work is worth approximately zero. Every design choice here follows from that
axiom and from the never-wrong / HITL invariant: the reviewer advises, the human
decides; the reviewer can never approve, merge, or modify an artifact.

The PR reviewer (DR-033 §6, #342) is the **precedent pattern** — the per-type
reviewers for Specs, Plans, design.md, tasks.md, DRs, constitution invariants,
Epics, and Issues share its shape: fresh-context opus agent, verdict + findings
block, bounded auto-loop on `request-changes` (default 2 cycles → `agent-escalated`),
`ai-review:*` family recording. For **human-authored** artifacts (no author agent
to loop back to), `request-changes` escalates straight to the human (DR-047 §1).

Rationale: [DR-047](../decisions/DR-047.md) — full context, decision, and
alternatives.

## Checklist

- [ ] **Spec substance reviewer** — fresh-context opus agent audits FRs for
  internal consistency, scope correctness for tier, grounded context, and
  resolved OQs before the spec enters the human queue.
- [ ] **Plan substance reviewer** — audits plan for alignment with spec FRs,
  correct T0-first test sequencing, and risk coverage.
- [ ] **design.md (downstream) reviewer** — audits that the design realises the
  plan, contracts precede implementation, and slice boundaries are coherent.
- [ ] **tasks.md (downstream) reviewer** — audits task coverage of the plan,
  T0-invariant-first ordering, and per-task checkability.
- [ ] **DR substance reviewer** — audits alternatives-genuinely-considered,
  Costly-to-Refactor accuracy, and DR-023 follow-up materialisation.
- [ ] **Constitution invariant reviewer** — audits testability, non-contradiction
  with existing invariants, and tier scoping.
- [ ] **Epic reviewer** — audits member-artifact consistency with the epic goal
  and goal measurability.
- [ ] **Issue reviewer** — AI-reviewed, **never** human-gated: audits
  reproducibility, single-concern scope, and named root cause (RCDD) vs
  bad-state restatement.
- [ ] **Signpost-predicate generalisation** — extend the predicate in SPEC-012's
  resolver from PR-only `ai-review:pass` to the full per-type predicate
  (greenlit-for-type ∧ prior-stage-gates-clear ∧ human-gate-open) across all
  **human-gated** Approvable types; an un-reviewed or `ai-review:changes`
  human-gated Approvable must not appear in the human queue; non-gated docs
  (Issue, auto-accepted design.md/tasks.md) never enter it (extends #182).
- [ ] **Doc-before-code ordering gate** — enforce that when a PR carries an
  Approvable doc **and the code that implements it**, that doc is AI-reviewed and
  greenlit before the *implementing* code's review stage runs; **unrelated code in
  the same PR is not blocked** (DR-047 §3).
- [ ] **Per-type recording** — wire `ai-review/<type>` status checks and the
  `ai-review:<type>:pass` / `:changes` / `:pending` / `:escalated` label family
  for all doc types (Issue included); extend the #342 poster step.
- [ ] **Per-dev AI-review coverage-slider config** — a per-dev sliding scale over
  which doc types are reviewed and at what depth; default for the MinSpecPro
  dogfood projects = **max coverage** (accept token-window waits) (DR-047
  Decision 6).
- [ ] **Auto-approve config (low-criticality)** — dev opt-in (off by default) to
  auto-accept `design.md` / `tasks.md` / issue on AI greenlight with no human
  gate; high-criticality types (spec / DR / constitution / PR-to-main / epic)
  always keep the human gate (DR-047 Decision 5).

> Issues for each checklist item are tracked individually (see DR-047 Follow-ups).
> Do NOT create member issues from this epic — file them separately per DR-023.

## Related

- [DR-047](../decisions/DR-047.md) — decision rationale (this epic's anchor DR)
- [DR-033 §6](../decisions/DR-033.md) — PR reviewer precedent; #342 = implementation
- [DR-041](../decisions/DR-041.md) — canonical Approvable term
- [SPEC-010](../../specs/minspec/SPEC-010-next-task-signpost/requirements.md) /
  [SPEC-012](../../specs/minspec/SPEC-012-next-task-resolver/requirements.md) — signpost +
  resolver that the predicate generalisation extends (#182)
- Issues: label `epic:reviewer-all-approvables`
