---
id: SPEC-031
type: requirements
status: implementing
tier: T3
product: minspec
epic: EPIC-010  # Reviewer Across All Approvables
aspects: [reviewer, hitl, never-wrong, signpost]
depends_on: [SPEC-012]
relates_to: [SPEC-010, SPEC-024, DR-047, DR-033, DR-041, DR-023]
implements: [scripts/review-pr.sh, .github/workflows/ai-review.yml, scripts/review-decide.sh]  # per-type reviewer prompts (FR-1/#527), per-type recording (FR-3/#530), ordering gate (FR-5/#529). FR-4 resolver owned by SPEC-012; extension stays Tier-0.
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# MinSpec — Independent AI Review Across Every Approvable Type — Requirements

**Date:** 2026-07-05 (Clarify 2026-07-06)
**Status:** Clarify complete — awaiting human *Approve Spec* before Plan
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
- **INV-8 — One positive "your turn" signal (DR-063).** A human-gated Approvable that is
  AI-greenlit and still awaiting its human keystroke is marked by EXACTLY ONE positive
  label — `awaiting-approval`. "My turn" is therefore a single-label filter, NEVER an AND
  of `ai-review:*:pass` and a negative label. It is applied only when the type is greenlit,
  prior-stage gates are clear, the human gate is still open, and (on the PR surface) the PR
  is not self-merging (no auto-merge armed). It is removed the instant it no longer holds —
  the gate stops being green (a flip to `changes`, a stale/forged-pass strip #359 / #397),
  an auto-merge arms, or the human acts (on the PR surface the keystroke IS the merge, which
  closes the PR and clears the label with it; on the doc surface — FR-9b, forward — an
  *Approve* strips it). **Shipped scope:** the PR-surface applier (FR-9a) keys on the
  ready-to-merge gate state plus the merge; the on-*Approve* strip for docs lands with the
  #527 runner. It NEVER coexists with `ai-review:*:changes` (INV-4), and it advises only —
  it is not a gate and grants no merge power (INV-2). It supersedes the overloaded eager
  `needs-human-review`, which conflated "AI failed → fix" with "AI passed → approve"
  (retirement tracked in #816).

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
    restatement. **AI-reviewed, never human-gated.** Fires on **promotion from inbox**
    (a `triage` / `role:*` label applied), not on raw open — reviews the issues that
    matter, not inbox noise (OQ-4).
- **FR-2 — Bounded auto-loop + human-authored fallback.** On `request-changes` the runner
  re-dispatches the **author agent** (default 2 cycles; then `agent-escalated` to the
  human). An `approve` verdict ends the cycle. For a **human-authored** artifact with no
  author agent (e.g. a hand-written DR or PR), the loop is skipped and the verdict
  escalates straight to the human with findings attached (DR-047 §1 fallback).
- **FR-3 — Per-type recording.** Extend the `ai-review:*` family (#342 poster) per type:
  `ai-review/<type>` status check + `ai-review:<type>:{pass,changes,pending,escalated}`
  labels, for all PR-attached doc types
  ([#530](https://github.com/AIClarityAU/minspec/issues/530)). Labels prefixed
  `ai-review:<type>:*` to bound proliferation. Named `ai-review:*`, never `ai-approved:*`
  (INV-2). **Issue is the exception (OQ-4):** an Issue has no PR head SHA to carry a
  commit status, so the Issue verdict records as an `ai-review:issue:*` **label + a
  findings comment only — no status check.** Acceptable because Issue is non-gated (no
  `ready-to-merge`-style check consumes it).
- **FR-4 — Signpost predicate generalisation (contract; owned by SPEC-012).** The
  next-human-task predicate generalises from PR-only to **all human-gated** types:
  present iff greenlit-for-type ∧ prior-stage-gates-clear ∧ human-gate-open (INV-4). This
  spec defines the **contract**; the resolver change lands in SPEC-012's PR path
  ([#528](https://github.com/AIClarityAU/minspec/issues/528)), extending #182.
- **FR-5 — Doc-before-implementing-code ordering gate.** When a PR carries a doc
  Approvable **and its implementing code**, the doc must be greenlit before the
  *implementing* code's review stage runs. Precedence per doc↔code pair: doc AI review →
  implementing-code AI review → human gate. **Unrelated code in the same PR is NOT blocked**
  (INV-5 — [#529](https://github.com/AIClarityAU/minspec/issues/529)). **Executes as a CI
  job in `.github/workflows/ai-review.yml`** (OQ-3): a merge-blocker must hold for **any**
  PR, including external contributors with no local harness. `review-pr.sh` runs the same
  check locally as fast-feedback preview; CI is the enforcing copy.
- **FR-6 — Auto-approve config (low-criticality, dev opt-in).** A per-dev, off-by-default
  setting that lets an `ai-review:<type>:pass` on **design.md / tasks.md / issue** advance
  the artifact with **no** human keystroke. High-criticality types (Spec / Plan / DR /
  constitution / PR-to-main / Epic) ALWAYS keep the human gate; Issue is never gated
  regardless (INV-6 — [#330](https://github.com/AIClarityAU/minspec/issues/330)).
  **Dogfood default (MinSpecPro projects): opt IN — auto-approve ON for design.md /
  tasks.md** (OQ-1). At max breadth these derivative docs are reviewed then auto-accepted
  (hands-off); the human keystroke is retained only on the high-criticality types. This is
  the dogfood *exercising* the opt-in (DR-047 keeps it off by default everywhere else) — a
  reviewed-then-auto-accepted derivative doc, not an un-reviewed one.
- **FR-7 — Two orthogonal review-config axes (breadth × depth), on the doc-approvable
  surface.** SPEC-031's per-dev config is **two independent settings** (OQ-2), not one
  slider — and both govern the **doc-approvable reviewer** (the #527 per-type runner /
  `review-approvable.sh`), a surface *distinct* from the already-shipped CI PR-diff
  reviewer (see **Two surfaces** below):
  - **Breadth — which doc types are reviewed:** `critical-only` (Spec/Plan/DR/constitution/
    Epic/PR) → `+downstream` (add design.md/tasks.md) → `all` (add Issue). Composes with
    FR-6: breadth decides *what* is reviewed; auto-approve decides whether a reviewed
    low-criticality doc still needs a human.
  - **Depth — how many reviewers per artifact:** `single` (one fresh-context reviewer, the
    floor) → `panel` (an adversarial multi-voter panel; #453's `none/single/panel` is this
    axis). Depth is orthogonal to breadth — any breadth can run at either depth.
  - **Two surfaces — the depth knobs do NOT compose as one (resolves OQ-2 / #793).** There
    are two *independent* reviewer surfaces, each with its own depth default; **neither
    overrides the other** because they read different inputs:
    1. **CI PR-diff review** — the DR-033 §6 reviewer over a PR *diff*, its depth set by the
       repo variable `AI_REVIEW_COVERAGE` (default `panel` = reviewer + architect + skeptic;
       `.github/workflows/ai-review.yml` line 270, extra voters wired at lines 354 / 367).
       **Already shipped**, merge-blocking, runs for **any** PR incl. external contributors
       with no local harness (FR-5 / OQ-3). It is the DR-033 §6 CI path — **out of
       SPEC-031's scope**: this spec neither sets nor dials it.
    2. **Doc-approvable review** — SPEC-031's per-type reviewer over a *standalone* doc
       (Spec/Plan/DR/…), its depth set by *this* FR-7 per-dev slider (still unbuilt — #527 /
       #453). Floor `single`. This is the surface that produced review issue #793 itself —
       one opus reviewer over SPEC-031's own `requirements.md` (FR-9b), while this repo's CI
       PR-diff surface runs `panel`.
    A doc that lands *via a PR* is therefore read by **both** surfaces — the CI PR-diff panel
    on its diff, and (once #527 lands) the doc-approvable reviewer at this slider's depth —
    and they do not dial each other back. MinSpecPro on CI `panel` **and** doc-approvable
    depth `single` is not a contradiction: two surfaces, two independent depths.
  - **Dogfood default (MinSpecPro projects) = breadth `all` × depth `single` on the
    doc-approvable surface** — one fresh-context reviewer per doc type, accepting the
    token-window latency ([#453](https://github.com/AIClarityAU/minspec/issues/453)). The
    repo's **CI PR-diff** surface independently defaults to `panel`
    (`.github/workflows/ai-review.yml` line 270); the two coexist by the **Two surfaces**
    rule above. SPEC-031's per-dev **doc-approvable** depth slider is still unbuilt and keeps
    `single` as its floor (see Out of scope).
- **FR-8 — Canonical human-gated classification.** A single source of truth for which
  Approvable types are human-gated (Spec, Plan, DR, constitution invariant, PR-to-main,
  Epic), AI-reviewed-only (Issue), or config-dependent (design.md, tasks.md — FR-6). The
  resolver (FR-4) and the gate placement both read this one table.
- **FR-9 — Ship the `awaiting-approval` queue signal (materialises DR-063).** Realise INV-8
  as a concrete label, applied by a SINGLE authoritative owner per surface (never scattered
  across every apply/strip site):
  - **FR-9a — PR surface (this change).** `.github/workflows/ready-to-merge.yml` — already the
    sole owner of the verified-fresh-pass decision on every PR event — applies / removes
    `awaiting-approval` in lock-step with its own `success` state, skipping application when
    native auto-merge (DR-061) is armed (that PR merges itself; not a human turn). The decision
    is a pure, tested seam `shouldAwaitApproval({ statusState, autoMergeArmed })` in
    `.github/scripts/ai-review-guard.js`. Every stale-strip / forged-revert / flip already
    drives that state to `failure`, so removal needs no extra mirror site. The label write is
    best-effort and never fails the load-bearing commit status.
  - **FR-9b — Doc-approvable surface (forward, with the #527 runner).** When the per-type CI
    runner (FR-3) records `ai-review:<type>:pass` on a human-gated type, it applies
    `awaiting-approval`; the signpost predicate (FR-4) reads this one label. Until #527 lands,
    `review-approvable.sh` stays a label-less local preview (its verdict surfaces as a
    `needs-review` issue, e.g. #793), so the doc-surface applier is NOT yet built — only the
    PR-surface applier (FR-9a) ships now.
  - **FR-9c — Supersession.** `awaiting-approval` is the canonical "human's turn" signal.
    Retiring the eager `needs-human-review`-on-`changes` (so that label means only
    "automation exhausted → human fix") is the subtractive follow-up tracked in #816 —
    deliberately NOT bundled with this additive label, because it touches fail-closed semantics.

## Out of scope

- **The SPEC-012 resolver internals** for FR-4 — this spec defines the predicate contract;
  the resolver code lands in SPEC-012's own PR path (#528). No never-wrong resolver edit is
  made under this spec.
- **Reviewer-bot identity / label provenance / label-guard** — #428 / #397 / #459 / #464
  (separate hardening; a hand-added `ai-review:*` label remains a trust hole this spec does
  not close).
- **Backfill / re-review of EXISTING approvables** — [#362](https://github.com/AIClarityAU/minspec/issues/362)
  / #455 (this spec ships the forward-going reviewer; backfill is its own run).
- **The CI PR-diff panel depth** (`AI_REVIEW_COVERAGE`, default `panel` = reviewer +
  architect + skeptic; `.github/workflows/ai-review.yml` line 270) — the depth axis of #453 as
  built at the repo-level **CI PR-diff** surface, a *separate* surface from SPEC-031's
  doc-approvable reviewer (FR-7 **Two surfaces**). This spec neither sets nor changes it.
  SPEC-031's own per-dev **doc-approvable** depth slider remains unbuilt and not required
  for v1 (single fresh-context reviewer is the floor).
- **Building `agent-execute`** or its model-access broker (DR-017) — the reviewer runs in
  the existing dispatch / CI path, not a new extension.

## Clarify — open questions resolved (2026-07-06, Paul Harvey)

All four blocking OQs resolved; each decision is threaded into the FR/invariant noted.
OQ-2 was **further clarified 2026-07-17** (issue #793 independent review) to name the two
depth *surfaces* and their composition rule — see OQ-2 below. No implementation-blocking OQ
remains hidden; the spec is Plan-ready once a human approves it.

- **OQ-1 — Dogfood: auto-approve OR review-only for design.md/tasks.md?** → **Auto-approve
  ON for the dogfood** (design.md / tasks.md). At max breadth these derivative docs are
  reviewed then auto-accepted (hands-off); the human keystroke is retained only on the
  high-criticality types. DR-047 keeps auto-approve off *by default* everywhere else — the
  dogfood explicitly *opts in*. Threaded into **FR-6**. (Note: this is a
  reviewed-then-auto-accepted doc, never an un-reviewed one — INV-3/INV-6 hold.)
- **OQ-2 — Coverage axes: one 2-D slider or two orthogonal settings?** → **Two orthogonal
  settings — breadth (which types) × depth (single / panel).** #453's `none/single/panel`
  is the *depth* axis; the type-selection is the *breadth* axis; they compose freely.
  Threaded into **FR-7**. Dogfood = breadth `all` × depth `single`.
  - **Depth-surface reconciliation (#793, 2026-07-17).** The independent AI review of this
    spec ([#793](https://github.com/AIClarityAU/minspec/issues/793)) flagged that "dogfood
    depth = `single`" appears to contradict the already-shipped CI `panel` default (a repo
    *is* a repo). **Resolved:** these are **two distinct reviewer surfaces**, not one axis
    with two defaults — (a) the **CI PR-diff** reviewer, depth `AI_REVIEW_COVERAGE` (default
    `panel`, `.github/workflows/ai-review.yml` line 270), which is DR-033 §6's CI path and
    **out of SPEC-031's scope**; and (b) SPEC-031's own per-dev **doc-approvable** depth slider
    (floor `single`, still unbuilt). **Neither overrides the other** — they read different
    inputs and both run; a doc landing via a PR is read by both. This spec's `depth single`
    sets only the doc-approvable surface. Full composition rule threaded into **FR-7 → Two
    surfaces**. With this explicit, the Plan author can wire dogfood doc-depth without a
    further decision — no implementation-blocking OQ remains.
- **OQ-3 — Ordering-gate execution locus?** → **CI job in `.github/workflows/ai-review.yml`.**
  A merge-blocker must hold for any PR incl. external contributors with no local harness;
  `review-pr.sh` stays a local fast-feedback preview, CI is the enforcing copy. Threaded
  into **FR-5**.
- **OQ-4 — Issue-reviewer trigger + recording (no PR head SHA)?** → **Trigger on promotion
  from inbox** (a `triage` / `role:*` label), not on raw open; **record as an
  `ai-review:issue:*` label + findings comment only — no commit status.** An Issue has no
  head SHA and is non-gated, so no check-run is needed. Threaded into **FR-1** (Issue
  bullet) + **FR-3** (recording exception).

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
- A human-gated PR that reaches a verified-fresh `ai-review:pass` with no auto-merge armed
  carries `awaiting-approval`; the moment its pass is stripped (new commits) or flips to
  `changes`, `awaiting-approval` is gone — so "my turn" is a truthful single-label filter,
  and it never coexists with `ai-review:changes` (INV-8 / FR-9a).
- Auto-approve **off** (default): a greenlit `design.md` still requires a human keystroke.
  Auto-approve **on**: the same greenlit `design.md` advances with no human. A greenlit
  **DR** requires a human keystroke even with auto-approve on (INV-6).
- **FR-2 escalation (happy + failure).** An `approve` verdict within the cycle budget ends
  the auto-loop (happy). Two `request-changes` cycles with no intervening `approve` escalate
  to the human as `agent-escalated` with findings attached (failure); a **human-authored**
  artifact with no author agent skips the loop and escalates on the **first**
  `request-changes` (FR-2 fallback — DR-047 §1).
- **FR-7 axes + surfaces (happy + failure).** Breadth and depth are independently settable —
  a config of breadth `all` × depth `single` is valid, as is `critical-only` × `panel`
  (happy). The **doc-approvable** depth slider (`single`) and the **CI PR-diff** coverage
  (`AI_REVIEW_COVERAGE` = `panel`) are separate surfaces: a repo on CI `panel` still runs
  the doc-approvable reviewer at the per-dev depth, and neither dials the other back — a test
  that setting one changes the other would FAIL (failure guard for FR-7 **Two surfaces**).
- The reviewer never mutates the artifact and never applies an `:approved`-style label
  (INV-2).

## Traceability

Materialises [DR-047](../../../docs/decisions/DR-047.md) under
[EPIC-010](../../../docs/epics/EPIC-010-reviewer-all-approvables.md). Precedent: DR-033 §6
/ [#342](https://github.com/AIClarityAU/minspec/issues/342) (PR reviewer). Canonical term:
DR-041 (Approvable). Follow-up issues: #527 / #528 / #529 / #530 / #330 / #453. The FR-4
predicate change is owned by SPEC-012 (#528).
