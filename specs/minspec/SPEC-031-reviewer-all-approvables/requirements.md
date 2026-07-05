---
id: SPEC-031
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-010  # Reviewer Across All Approvables
aspects: [reviewer, hitl, never-wrong, signpost]
depends_on: [SPEC-012]
relates_to: [SPEC-010, SPEC-024, DR-047, DR-033, DR-041, DR-023]
phases:
  specify: in-progress   # requirements drafted 2026-07-05, awaiting human review; OQ-1..4 open
  clarify: not-started   # T3 requires Clarify before Plan (OQs must resolve)
  plan: not-started
  tasks: not-started
  implement: not-started
---

# MinSpec — Independent AI Review Across Every Approvable Type — Requirements

**Date:** 2026-07-05
**Status:** Specifying (SDD Specify phase)
**Triggered by:** [DR-047](../../../docs/decisions/DR-047.md) — generalises the PR-only
independent reviewer (DR-033 §6) to every Approvable, after the 2026-06-29 rubber-stamp
session ([#344](https://github.com/AIClarityAU/minspec/issues/344)–349: 7 live defects,
incl. never-wrong + egress-leak, waved through by a fatigued human reviewer).
**Epic:** [EPIC-010](../../../docs/epics/EPIC-010-reviewer-all-approvables.md)
**Materialises issues:** [#527](https://github.com/AIClarityAU/minspec/issues/527) (runner),
[#528](https://github.com/AIClarityAU/minspec/issues/528) (signpost §2),
[#529](https://github.com/AIClarityAU/minspec/issues/529) (ordering §3),
[#530](https://github.com/AIClarityAU/minspec/issues/530) (recording §4),
[#330](https://github.com/AIClarityAU/minspec/issues/330) (auto-approve, Decision 5),
[#453](https://github.com/AIClarityAU/minspec/issues/453) (coverage, Decision 6).

## Problem

**DR-033 §6** built an independent reviewer-agent — a fresh-context opus agent, never the
one that authored the branch — for **PR/code only**. Its verdict records as an
`ai-review:*` status/label; the signpost may only surface a PR as a human task if
`ai-review:pass` ∧ mergeable ∧ checks-green.

Every **other** Approvable — Spec, Plan, design.md, tasks.md, DR, constitution invariant,
Epic, Issue — is worse for rubber-stamping, not better:

1. **AI-authored by design.** The architect / Specify / Propose-Constitution agents draft
   Specs, DRs, and invariants. The human approval that follows is the **only** check —
   author → human, no independent third voice.
2. **Existing gates check structure, not substance.** `validateSpec`, the dangling-ref
   checker, and the symmetric-validator class (DR-032 / SPEC-021) verify schema and
   reference resolution — never whether the *reasoning* is sound, whether an FR
   contradicts a requirement, whether a DR overlooks a risk class.
3. **Friction-reduction lowered scrutiny.** The low-friction HITL approval UX (#214 /
   DR-041) makes an uncritical "approve" the path of least resistance for a fatigued
   reviewer. #344–349 proves this is not theoretical.

## Scope (one sentence)

Extend the independent fresh-context reviewer from PR/code to **every** doc Approvable
type (the **AI-reviewed superset**, Issue included), record per-type verdicts, **decouple**
AI-review (the universal floor) from human-approval (the critical subset), and enforce
doc-before-*implementing*-code ordering — **advisory only**, the human always holds the
final approval keystroke for human-gated types.

## Architecture — who does what

The reviewer LLM call lives in the **dispatch / CI** layer (`scripts/review-pr.sh` +
`.github/workflows/ai-review.yml`, DR-033 §6 / #342) — **not** inside MinSpec-the-extension
(Tier-0, air-gapped: DR-004 / DR-015 / DR-019 §6). MinSpec reads the resulting labels /
status and renders them; it never calls the model.

| Step | Who | Tier |
|---|---|---|
| Detect an Approvable needing review; dispatch a fresh-context reviewer | dispatch / CI runner | dev-time / CI |
| **Generate the substance verdict** for the artifact's type | reviewer agent (opus, fresh context) | LLM |
| Record verdict as `ai-review/<type>` status + `ai-review:<type>:*` label | runner / poster | dev-time / CI |
| Consume the verdict in the next-human-task predicate | MinSpec resolver (SPEC-012) | Tier-0 |
| Auto-loop `request-changes` → author agent (bounded); else escalate to human | dispatch runner | dev-time / CI |
| Gate placement (auto-accept vs human keystroke) per criticality + dev config | MinSpec + config | Tier-0 |

This mirrors the product thesis — **the LLM thinks, MinSpec harnesses/gates** ("just
enough human") — and matches how the PR reviewer already runs (#342), extended per type.

## Invariants (this change must preserve)

- **INV-1 — Independence is the value.** The reviewer is ALWAYS a second agent with fresh
  context, NEVER the one that authored the artifact. Self-review is worth ~0 (DR-033 §6).
- **INV-2 — Advisory / never-wrong.** The reviewer never approves, merges, or modifies an
  artifact. For human-gated types the human ALWAYS holds the final approval keystroke.
  Labels are `ai-review:*` (advises), never `ai-approved:*` (approves). **AI-greenlit ≠
  approved.**
- **INV-3 — AI-reviewed superset ⊇ human-gated subset (decoupled).** EVERY doc type is
  AI-reviewed — including types with **no** human gate (Issue). Only the critical subset
  (Spec, Plan, DR, constitution invariant, PR-to-main, Epic) requires a human keystroke.
  Whether a doc is AI-reviewed and whether it is human-gated are independent axes.
- **INV-4 — The signpost never surfaces an un-greenlit human-gated Approvable.** A
  human-gated Approvable appears as a human task ONLY IF: greenlit-for-its-type ∧
  prior-stage-gates-clear ∧ human-gate-still-open. An un-reviewed or
  `ai-review:<type>:changes` Approvable MUST NOT enter the human queue. Non-gated docs
  (Issue; auto-accepted design.md/tasks.md) never enter it.
- **INV-5 — Ordering is scoped to *implementing* code only.** The doc-before-code gate
  applies pairwise between a doc and the code that realises *that* doc — NEVER PR-wide.
  Unrelated code in a mixed PR advances on its own gates. (Regression guard: the
  over-broad scoping bug closed in [#426](https://github.com/AIClarityAU/minspec/issues/426).)
- **INV-6 — Auto-approve never silently drops a gate.** Auto-accept is opt-in, off by
  default, and scoped to low-criticality types ONLY. High-criticality types can NEVER
  auto-approve. The dev consents once, explicitly; the policy is auditable.
- **INV-7 — MinSpec-the-extension stays Tier-0.** The reviewer LLM call is external
  (dispatch / CI). MinSpec only reads labels/status and renders — no in-process model or
  network call (consistency with SPEC-025 INV-1 / DR-004).

## Functional Requirements

- **FR-1 — Per-type reviewer prompts, one shared runner.** A distinct substance-review
  prompt per Approvable type, all extending the SAME `review-pr.sh` runner seam (one
  mechanism, not eight — [#527](https://github.com/AIClarityAU/minspec/issues/527)):
  - **Spec** — FRs internally consistent, scoped for tier, grounded in context, no
    implementation-blocking OQs.
  - **Plan** — approach matches the spec's FRs, T0 invariant tests sequenced first, risks
    called.
  - **design.md** (downstream) — realises the plan, contracts precede implementation,
    slice boundaries coherent.
  - **tasks.md** (downstream) — covers the plan, T0-invariant-first ordering, each task
    checkable.
  - **DR** — alternatives genuinely considered, Costly-to-Refactor claim accurate,
    DR-023 follow-ups materialised.
  - **Constitution invariant** — testable, non-contradicting existing invariants,
    correctly tier-scoped.
  - **Epic** — members consistent with the goal, goal measurable.
  - **Issue** — reproducible, single concern, named root cause (RCDD) not a bad-state
    restatement. **AI-reviewed, never human-gated.**
- **FR-2 — Bounded auto-loop + human-authored fallback.** On `request-changes` the runner
  re-dispatches the **author agent** (default 2 cycles; then `agent-escalated` to the
  human). An `approve` verdict ends the cycle. For a **human-authored** artifact with no
  author agent (e.g. a hand-written DR or PR), the loop is skipped and the verdict
  escalates straight to the human with findings attached (DR-047 §1 fallback).
- **FR-3 — Per-type recording.** Extend the `ai-review:*` family (#342 poster) per type:
  `ai-review/<type>` status check + `ai-review:<type>:{pass,changes,pending,escalated}`
  labels, for all doc types incl. Issue
  ([#530](https://github.com/AIClarityAU/minspec/issues/530)). Labels prefixed
  `ai-review:<type>:*` to bound proliferation. Named `ai-review:*`, never `ai-approved:*`
  (INV-2).
- **FR-4 — Signpost predicate generalisation (contract; owned by SPEC-012).** The
  next-human-task predicate generalises from PR-only to **all human-gated** types:
  present iff greenlit-for-type ∧ prior-stage-gates-clear ∧ human-gate-open (INV-4). This
  spec defines the **contract**; the resolver change lands in SPEC-012's PR path
  ([#528](https://github.com/AIClarityAU/minspec/issues/528)), extending #182.
- **FR-5 — Doc-before-implementing-code ordering gate.** When a PR carries a doc
  Approvable **and its implementing code**, the doc must be greenlit before the
  *implementing* code's review stage runs. Precedence per doc↔code pair: doc AI review →
  implementing-code AI review → human gate. **Unrelated code in the same PR is NOT blocked**
  (INV-5 — [#529](https://github.com/AIClarityAU/minspec/issues/529)).
- **FR-6 — Auto-approve config (low-criticality, dev opt-in).** A per-dev, off-by-default
  setting that lets an `ai-review:<type>:pass` on **design.md / tasks.md / issue** advance
  the artifact with **no** human keystroke. High-criticality types (Spec / Plan / DR /
  constitution / PR-to-main / Epic) ALWAYS keep the human gate; Issue is never gated
  regardless (INV-6 — [#330](https://github.com/AIClarityAU/minspec/issues/330)).
- **FR-7 — Per-dev coverage slider.** A per-dev sliding scale over *which* doc types are
  reviewed and *at what depth* — from minimal (highest-criticality types only) to **max**
  (every type incl. Issue + downstream design/tasks, full depth). Composes with FR-6:
  coverage decides *what* is reviewed; auto-approve decides whether a reviewed
  low-criticality doc still needs a human. **Dogfood default (MinSpecPro projects) = max**,
  accepting the token-window latency ([#453](https://github.com/AIClarityAU/minspec/issues/453)).
- **FR-8 — Canonical human-gated classification.** A single source of truth for which
  Approvable types are human-gated (Spec, Plan, DR, constitution invariant, PR-to-main,
  Epic), AI-reviewed-only (Issue), or config-dependent (design.md, tasks.md — FR-6). The
  resolver (FR-4) and the gate placement both read this one table.

## Out of scope

- **The SPEC-012 resolver internals** for FR-4 — this spec defines the predicate contract;
  the resolver code lands in SPEC-012's own PR path (#528). No never-wrong resolver edit is
  made under this spec.
- **Reviewer-bot identity / label provenance / label-guard** — #428 / #397 / #459 / #464
  (separate hardening; a hand-added `ai-review:*` label remains a trust hole this spec does
  not close).
- **Backfill / re-review of EXISTING approvables** — [#362](https://github.com/AIClarityAU/minspec/issues/362)
  / #455 (this spec ships the forward-going reviewer; backfill is its own run).
- **Adversarial multi-voter panel** (a 3rd/4th skeptic voter) — the depth axis of #453; not
  required for v1 (single fresh-context reviewer is the floor).
- **Building `agent-execute`** or its model-access broker (DR-017) — the reviewer runs in
  the existing dispatch / CI path, not a new extension.

## Open questions — OPEN (must resolve in Clarify; T3 requires it)

- **OQ-1 — Does the dogfood default also auto-approve, or review-only?** DR-047 sets
  auto-approve **off by default** (Decision 5) but **max coverage** for the dogfood
  projects (Decision 6). Max coverage means design.md/tasks.md ARE reviewed — but does the
  dogfood also flip FR-6 on for them (fully hands-off derivative docs), or review-only with
  a human keystroke retained? The two Decisions touch here and DR-047 does not settle it.
- **OQ-2 — Coverage-slider axes.** #453 proposes `none / single / panel` — that is a
  **depth** axis (how many voters). FR-7's scale is a **breadth** axis (which types).
  Reconcile: one 2-D setting (breadth × depth) or two orthogonal settings?
- **OQ-3 — Where does the ordering gate (FR-5) execute?** CI job (`ai-review.yml`, enforced
  on external contributors) vs local dispatch (`review-pr.sh`, dev-time only). Determines
  whether the gate holds for a PR from someone without the local harness.
- **OQ-4 — Issue-reviewer trigger + recording surface.** An Issue has no PR head SHA to
  attach a commit status to. What event fires the Issue reviewer (on open? on
  `role:*`/triage label?) and where does its verdict record — a label only (no status
  check), or a synthetic check? FR-3's status-check model assumes a PR; Issue breaks that
  assumption.

## Acceptance (T2 feature tests — happy + primary failure)

- An AI-authored Spec receives a fresh-context reviewer verdict + `ai-review:spec:*` label
  **before** it can appear in the human queue; the reviewer is provably not the author
  agent (INV-1).
- An un-reviewed or `ai-review:spec:changes` Spec does **NOT** appear as the next human
  task (INV-4).
- A mixed PR (a Spec + its implementing code + an unrelated fix): the implementing code's
  review stage waits for the Spec greenlight, while the unrelated fix advances on its own
  gates (INV-5).
- The Issue reviewer runs and records `ai-review:issue:*`, and **never** produces a
  human-gate task (INV-3).
- Auto-approve **off** (default): a greenlit `design.md` still requires a human keystroke.
  Auto-approve **on**: the same greenlit `design.md` advances with no human. A greenlit
  **DR** requires a human keystroke even with auto-approve on (INV-6).
- The reviewer never mutates the artifact and never applies an `:approved`-style label
  (INV-2).

## Traceability

Materialises [DR-047](../../../docs/decisions/DR-047.md) under
[EPIC-010](../../../docs/epics/EPIC-010-reviewer-all-approvables.md). Precedent: DR-033 §6
/ [#342](https://github.com/AIClarityAU/minspec/issues/342) (PR reviewer). Canonical term:
DR-041 (Approvable). Follow-up issues: #527 / #528 / #529 / #530 / #330 / #453. The FR-4
predicate change is owned by SPEC-012 (#528).
