---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness — docs-lane ergonomics (same epic as SPEC-039)
aspects: [ai-review, docs-lane, token-economy, silent-gate, machinery]
relates_to: [SPEC-024, SPEC-039, DR-051, DR-029, DR-086, "#789", "#575", "#1688", "#1847"]
---

# SPEC-137 — ai-review deterministic fast-pass for pure approval-record diffs

Issue: #789 (AIClarityAU/minspec). Rests on DR-051 (docs-lane), DR-029 / DR-086 §2
(approval is a human act). No new DR proposed — see Decisions needed.

## One-Sentence Scope

When a PR's whole diff is a set of approval-record sidecars under `.minspec/approvals/**`
that pass a deterministic structural check, `ai-review` posts its normal bot-provenanced,
SHA-bound `ai-review:pass` without invoking any LLM voter; every other diff keeps the full panel.

## Context (what exists today — to be re-verified in Plan against origin/main)

- `.github/workflows/docs-lane.yml:100` allows `.minspec/approvals/` inside the docs corpus
  regex, so an approval-only PR can ride the lane. It still must satisfy the required checks,
  including `ai-review`.
- `ai-review.yml` runs the LLM reviewer panel (reviewer, plus security/architect/skeptic when
  required) for every PR and combines labels in the `verdict-combine` block; it already has a
  deterministic short-circuit shape in the #1688 verdict-carry step (`carry=yes|no`, fail-closed
  to the full panel on any error).
- An approval sidecar is a small JSON record (`specPath`, `specHash`, `approvedAt`, `approvedBy`,
  `tier`, `migrated`, `baselineBlob`) written by the Approve Spec UI action. The human already
  made the decision in the UI; an LLM read of the JSON adds no signal and costs a full panel run.
- The ready-to-merge gate demands the SHA-bound pass witnesses (label + `ai-review` check-run,
  #466/#810). A fast-pass must produce the same witnesses, not a weaker path.

## Functional Requirements

- **FR-1 (eligibility is a pure function of the diff).** A new deterministic classifier decides
  `fast_pass=yes|no` from the PR's changed-file list and the diff content only: no network, no
  model. It returns `yes` only if EVERY changed path (adds, modifies, deletes, renames — both
  sides of a rename) matches `^\.minspec/approvals/.+\.json$`. Any other path, including docs,
  specs, DRs, `.github/`, `scripts/`, or `packages/`, yields `no`.
- **FR-2 (structural validity of each record).** For `yes`, each added/modified sidecar must parse
  as JSON, carry exactly the known key set with correct types, have `specHash` as 64 hex chars,
  `baselineBlob` as 40 hex chars, and its `specPath` must equal the path the sidecar sits at
  (the path mirrors `specs/<product>/<SPEC>/requirements.md`). Any parse error, unknown key,
  missing key, or mismatch yields `no` (full panel), never an error exit that skips review.
- **FR-3 (record agrees with the spec it approves).** The record's `specHash` must equal the
  canonical spec hash computed from the spec file at the PR head (the same function the
  validator uses, so `status:` flips do not stale it). A hash for a spec that is absent at head,
  or that disagrees, yields `no`. This stops a fast-pass vouching for a forged or stale record.
- **FR-4 (deletions).** A pure deletion of a sidecar is eligible only if the spec it covered is
  also absent at head or the PR is otherwise empty of non-approval paths; otherwise `no`.
  (Open: DQ-2.)
- **FR-5 (same witnesses as a full pass).** On `yes`, the workflow applies `ai-review:pass`
  and posts the `ai-review` check-run/status as the App, bound to the head SHA, using the same
  posting steps as the normal path. Its comment states `fast-pass: approval-record-only diff, no
  LLM voters ran`, lists the files, and states which FR-1..FR-3 checks passed. It never labels the
  result as an LLM review.
- **FR-6 (fail closed to the full panel).** Any error in the classifier (unparsable diff, git
  failure, hash helper missing or older-base mismatch, truncated file list) yields `no` and the
  full panel runs, visibly noting why in the run log. A missing or errored classifier never
  produces a pass (constitution invariant 2).
- **FR-7 (trusted control plane).** The classifier and its path list execute from the BASE ref,
  like the other reviewer scripts, so a PR cannot edit the classifier to widen its own
  eligibility. A PR that itself touches the classifier or `ai-review.yml` is `no` by FR-1.
- **FR-8 (no interaction with the human gate).** The fast-pass does not enable auto-merge, does
  not bypass `docs-lane`'s own refusals (`hold:*`, `status:` transitions, #1847) and does not
  stand in for the human approval that produced the record. It removes only the LLM spend.
- **FR-9 (observability).** Each run records `ai-review-fast-pass=yes|no` plus the reason when
  `no`, in the step summary, so token savings and false negatives can be counted.
- **FR-10 (head SHA freshness).** A later push re-runs the classifier; a stale fast-pass label
  is removed by the existing stale-label clear step before re-evaluation, as for any pass.

## Acceptance Criteria

- **AC-1.** A PR changing only `.minspec/approvals/specs/<p>/<SPEC>/requirements.json` with a
  valid, hash-matching record reaches `ai-review:pass` and a green `ai-review` check with zero
  reviewer invocations (assert via the run log / absence of `review-branch.sh` calls).
- **AC-2.** The same PR plus one changed line in any doc body (including the approved spec) gets
  the full panel.
- **AC-3.** A sidecar with a wrong `specHash`, an extra key, malformed JSON, or a `specPath`
  that does not match its location gets the full panel.
- **AC-4.** A PR touching `.github/workflows/ai-review.yml` or the classifier itself gets the
  full panel and keeps its machinery handling.
- **AC-5.** Forcing the classifier to throw yields the full panel, not a pass and not a skipped
  check (mutation test: remove the fail-closed arm and the test must go red).
- **AC-6.** The fast-pass pass is accepted by `ready-to-merge` through the same SHA-bound
  witnesses as a normal pass; a pass on an older SHA is not.
- **AC-7.** A `docs-lane` PR with hold label or `status:` transition is still refused by
  `docs-lane` regardless of fast-pass.

## Invariants (must not break)

1. Offline core (inv. 1): the classifier uses git objects already in the runner checkout only.
2. No silent gate (inv. 2): error means full panel, never pass, never skip; the `ai-review`
   check always posts. Two SHA-bound witnesses stay required.
3. Blast radius (inv. 3): changes ship in this repo's own CI; nothing ships to adopters.
4. Approval is a human act (DR-029, DR-086 §2): no agent or workflow mints, edits, or counts as
   an approval; the fast-pass only reads records.
5. Trusted control plane from base: eligibility logic cannot be edited by the PR it judges.

## Decisions needed (Clarify)

- **DQ-1 — Trivial `status:` flips.** The issue also mentions "trivial status flips".
  - **A (rec): approval-record sidecars only.** Costs: a spec whose approval PR also flips
    `status:` in the spec body still gets the full panel. Why: a `status:` flip is a governance
    transition that `docs-lane` already refuses (#1847); a classifier that also recognises it
    must parse markdown frontmatter, a much larger attack surface.
  - **B: also pure single-line `status:` frontmatter flips.** Saves more tokens; costs a
    frontmatter-aware diff parser in trusted CI and a ruling on which transitions are "trivial".
- **DQ-2 — Sidecar deletions.** **A (rec): eligible only per FR-4**, costs a little code.
  **B: never eligible**, simplest, costs full panel on cleanup PRs.
- **DQ-3 — Where the classifier lives.** **A (rec): a script under `scripts/` plus a pure,
  unit-tested TS module sharing the canonical hash function**, costs one more machinery file to
  human-merge. **B: inline shell in `ai-review.yml`**, fewer files, but untestable in isolation
  (the repo already pins verbatim-executed blocks by test, so this is a style cost, not a
  blocker).
- **DQ-4 — Who may rely on it.** **A (rec): any PR meeting FR-1..3, docs-lane label or not**,
  since eligibility is a property of the diff. Costs: slightly wider than the issue's
  "docs-lane" wording. **B: also require the `docs-lane` label**, matches the issue literally
  but ties review spend to a label the author controls.
- **DQ-5 — DR.** No irreversible choice is made here (a workflow branch is reversible in under a
  day), so no DR is proposed. Confirm.

## Out of Scope

- Skipping or thinning review for substantive docs bodies (the issue says keep full review).
- Changing `docs-lane.yml`, auto-merge arming, or approval semantics.
- Any LLM-based cheaper-model routing (a scroogellm concern).

## Implementation note for the Plan phase

`ai-review.yml` and the classifier are machinery: the implementing PR needs a human `--admin`
merge and base-trust means the fast-pass only takes effect after that merge. Tests must run the
real extracted block (as `ai-review-verdict-combine.test.ts` does), not a restatement.

## Traceability

Issue #789 · DR-051 · DR-029 · DR-086 · SPEC-024 · SPEC-039 · #575 · #1688 · #1847
