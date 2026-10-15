---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - a red signal must say what kind of red it is
aspects: [review, merge-gate, ux, no-silent-gate, never-wrong, comment, blast-radius]
depends_on: [SPEC-034, DR-004]
relates_to: ["#468", "#428", "#342", "#408", "#425", "#436", "#596", "#900", "SPEC-044"]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Structural-red explainer - say WHY a gate is red by design, so a human can tell it from a defect

Issue: #468 (idea from Paul Harvey, 2026-07-04).

## In plain terms

Some PRs are red on the merge gate for a reason that is not a defect. Today a human has
to already know that. This spec makes the gate say it: one PR comment that names the
structural reason, says it is not a content failure, lists what to verify, and says a
human merge is the intended path. A real failure never gets that comment, so the two
reds can never look alike.

## Current state (observed, not assumed)

- Machinery self-edit: the review comment already carries a warning when the changed set
  touches `.github/` or `scripts/` (`.github/workflows/ai-review.yml`, the
  `SELF_EDIT_KIND = machinery` branch of the comment body, ~line 908). Since #596 the
  label keeps the panel's honest verdict and the hold is the `machinery-review-required`
  check plus `ready-to-merge` staying red.
- Indeterminate changed set: label forced to `ai-review:changes`; the comment has a
  different warning (same file, the `else` arm). This is fail-closed, NOT safe to merge
  without a human actually reading the PR.
- Net-new-gate bootstrap (a PR that adds a required check or base-pinned guard module the
  base commit does not have yet): no explanation exists anywhere. This is the real gap.
- The existing warning lives INSIDE the reviewer's comment, so it appears only when the
  review ran and posted; it does not appear next to the red `ready-to-merge` check a
  human is actually looking at. I believe the red-check summary carries no reason text
  (unverified; Plan must confirm against `ready-to-merge.yml`).

## Functional requirements

- **FR-1 Closed set of structural reasons.** The explainer fires only for a reason in a
  closed, code-defined list: `machinery-self-edit`, `gate-bootstrap`. Each reason has one
  deterministic predicate over data the gate already computes (changed-file set, base
  tree contents). No model output decides whether a red is structural.
- **FR-2 One comment, upserted.** Exactly one explainer comment per PR, identified by a
  hidden marker, updated in place on each head push and removed or replaced when the
  reason no longer holds. No comment pile-up.
- **FR-3 Required content.** Each comment states: (a) which check is red and the
  structural reason; (b) that this is not a content defect; (c) what to verify (per
  reason, from a fixed template); (d) that human merge is the intended path; (e) the head
  SHA it was computed for.
- **FR-4 Structural-red vs real-red never look alike.** If a real failure is present on
  the same PR (reviewer `ai-review:changes` from the panel, failing tests, failing
  validate), the comment MUST say so and MUST NOT use the "safe to merge" wording. Wording
  for the mixed case is "structurally red AND has a real finding: fix the finding".
- **FR-5 Indeterminate is not structural.** An uncomputable changed set (fail-closed
  forced `ai-review:changes`) never receives the "safe to merge" wording; it gets a
  distinct "could not verify, review required" comment, or none.
- **FR-6 Fail visible (invariant 2).** If the predicate or the comment post errors, the
  gate stays red exactly as before and the failure is logged and surfaced in the check
  summary. The explainer is additive: it can never turn a red green, never write a
  gate-signal with a swallowed error, and its absence never changes merge eligibility.
- **FR-7 Adopter-safe (invariant 3).** Ships only through the existing opt-in surface
  (repos with `.minspec/`); adopters inherit it via the workflow template, and it changes
  nothing in a repo that did not opt in.
- **FR-8 Offline-safe (invariant 1).** The predicates and text are pure functions of local
  data; only the comment post uses the network the workflow already has.
- **FR-9 Not a witness.** The comment is prose for humans. Nothing reads it as a gate
  input; the marker is for upsert only.

## Acceptance criteria

- AC-1: A PR touching only `scripts/` gets the `machinery-self-edit` comment with all FR-3
  parts; a docs-only PR gets none.
- AC-2: A PR adding a new required-check module absent from base gets `gate-bootstrap`.
- AC-3: Pushing a new head updates the same comment (one comment total); removing the
  structural cause removes/replaces it.
- AC-4: A machinery PR whose panel verdict is `ai-review:changes` gets the mixed-case
  wording and no "safe to merge" phrase (test asserts absence of the phrase).
- AC-5: Forcing the comment post to throw leaves `ready-to-merge` red and the failure
  visible; no gate state changes versus the no-explainer baseline.
- AC-6: Predicate and renderer are covered by tests with a negative control per reason.

## Invariants this must not break

1. Offline core (no new network beyond the existing comment post).
2. No silent gate: additive only, fails visible, cannot green a red, no second producer
   that a single permission gap silences (the comment is advisory; the gate itself is
   unchanged).
3. Blast radius: opt-in via `.minspec/` only.
- Never-wrong: "safe to merge" wording is emitted only on a deterministic structural
  predicate with no real finding present.

## Decisions needed (Clarify)

1. **Where it posts.** (a) Extend the existing `ai-review.yml` comment (rec: least new
   surface; cost: only appears when the review ran, so a bootstrap PR whose review fails
   early shows nothing). (b) A separate comment from `ready-to-merge.yml`, next to the red
   check the human sees (cost: second producer, more workflow churn, and
   `ready-to-merge.yml` is itself machinery needing a human merge). (c) Both, with the
   check summary carrying a one-line reason (cost: duplication to keep in sync).
2. **How `gate-bootstrap` is detected.** (a) Diff adds a file under a registered
   gate-module path that is absent on the base tree (rec: deterministic and narrow; cost:
   needs a maintained path list, and misses a gate added elsewhere). (b) Any new
   `.github/workflows/*` check name not in base (cost: broad, flags benign workflows).
3. **Wording authority for "safe to merge".** Rec: say "intended path is human merge,
   verify X", not "safe", since the human still verifies; cost: less reassuring than the
   issue asks for. The alternative ("safe to merge") risks being read as approval.
4. **Mixed-case behaviour (FR-4).** Rec: post the mixed wording; cost: a more complex
   template. Alternative: suppress the explainer entirely when any real finding exists;
   cost: a human sees red with no structural note and may over-investigate.
