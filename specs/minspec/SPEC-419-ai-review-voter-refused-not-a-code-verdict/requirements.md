---
id: SPEC-419
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - a gate label must say what failed, or readers chase the wrong thing
relates_to: [SPEC-182, SPEC-078, DR-079, DR-003, "#4081", "#4079", "#1630", "#1204"]
implements: none
implements_reason: >-
  Specify phase only. Which files carry the work is decided at Plan; the candidates are
  scripts/review-branch.sh, scripts/review-decide.sh, .github/workflows/ai-review.yml,
  .github/workflows/ai-review-retry.yml and scripts/remediate-pr.sh (workflow edits are founder-push only).
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — A voter the CLI refuses to run is "unavailable", never a `changes` vote (Requirements)

> **SPECIFICATION ONLY.** Written by a Specify-only dispatch (DR-076/#1169). Nothing is built until a human resolves **Decisions needed (Clarify)** and approves it.

> Materializes [#4081](https://github.com/AIClarityAU/minspec/issues/4081). Trigger: #4079, where all four voters were refused with "Prompt is too long" (HTTP 400) and the PR carried `ai-review:changes` with no finding. The oversized diff itself (generated base64 template in the review diff) is a separate bug and out of scope here.

## One-Sentence Scope

When a voter's Claude CLI call is refused because of the input (not quota, not a crash), the gate must record that voter as *could not run*, fail the PR closed to a non-code label, say why, and must not hand it to remediation as if it were a code defect.

## Current behaviour (cited)

- `scripts/review-branch.sh:561-587`: no complete verdict → `quota_failure` true → `emit_unavailable` (`REVIEW_UNAVAILABLE` marker, `reason: quota`). Otherwise step 3 emits **no verdict**, "failed (non-quota)".
- `scripts/review-decide.sh:51-123`: marker → `ai-review:blocked`; strict-quota text → `blocked`; any other missing block → `ai-review:changes` (exit 2). So an input refusal lands on `changes`.
- `.github/workflows/ai-review-retry.yml:65-135` re-runs every `ai-review:blocked` PR; the only skip is `evidence: NONE` or a future reset time. `scripts/remediate-pr.sh:169,220` hands `ai-review:changes` PRs to an agent.

Two consequences follow, and they pull in opposite directions: reusing `blocked` as-is would **retry forever** (an oversized input refuses identically each time, spending tokens), while leaving it as `changes` sends remediation to fix code that is not wrong.

## Functional Requirements

- **FR-1 Classify.** `review-branch.sh` distinguishes an *input refusal* (CLI/API rejected the prompt as too long or otherwise invalid for this input, e.g. "Prompt is too long", HTTP 400) from quota/transient (existing) and from a genuine crash (existing). Matching is strict: CLI-sentence phrasing on the harness stream, never loose topic words from the agent's own prose (same discipline as `isQuotaExhaustionStrict`, SPEC-078).
- **FR-2 Distinct marker.** An input refusal emits the `REVIEW_UNAVAILABLE` block with a new machine-readable `reason:` (name settled at Plan, e.g. `input-refused`) and a `retryable: no` field, plus the trimmed refusal line as `detail`. It is never `reason: quota`.
- **FR-3 Not a code verdict.** `review-decide.sh` maps the new reason to a non-`changes` outcome (see DQ-1). It never yields `ai-review:pass`; the PR stays unmergeable (fail closed).
- **FR-4 No futile retry.** The retry workflow does not re-run a PR whose block says it is non-retryable, since the same input fails the same way. It surfaces the PR to a human (`needs-human-review`, as the #1630 path does) instead of looping.
- **FR-5 No remediation.** `remediate-pr.sh` never dispatches an agent to "fix" a PR carrying the new outcome. Its PR comment states the cause and the action that can help (shrink or split the review input).
- **FR-6 Panel aggregation.** When voters disagree in kind (some verdicts, some refused), the PR outcome follows a stated rule (DQ-2); a refused voter is never counted as a `changes` vote in any tally or block.
- **FR-7 Visible.** The PR comment names which voters were refused, the reason, and that it is not a code finding. Marker handling keeps the line-anchored, single-definition discipline in `review-decide.sh:50-77` so a diff quoting the marker cannot forge it.
- **FR-8 Unknown stays closed.** An unclassified failure keeps today's path (no verdict → `changes`). Only an affirmatively matched refusal is reclassified, so the change cannot turn a crash into a quiet non-verdict.

## Acceptance Criteria

- **AC-1** Fixture stderr "Prompt is too long" (HTTP 400), no verdict → marker with the new reason, `retryable: no`; `review-decide.sh` does not print `ai-review:changes` (FR-1..3).
- **AC-2** The #4079 shape (four refused voters) yields the new outcome, one comment naming all four, zero findings, no `changes` (FR-6, FR-7).
- **AC-3** Retry workflow fixture: PR with the non-retryable block is not re-run and gains `needs-human-review`; a quota block still retries (FR-4).
- **AC-4** `remediate-pr.sh` fixture: PR with the new outcome is not dispatched (FR-5).
- **AC-5** Agent prose that merely discusses "prompt is too long" in a normal verdict does not reclassify; an unclassifiable crash still ends `changes` (FR-1, FR-8).
- **AC-6** A diff quoting the new marker mid-line does not forge the outcome (FR-7).

## Invariants this must not break

- **No silent gate** (constitution inv. 2): the refused PR must stay visibly blocked; no swallowed error, no path to `pass`.
- Failing closed is preserved; only the *label and routing* change.
- Offline Tier-0: classification reads local CLI output only (inv. 1).
- Workflow files are founder-push only; the Plan must hand those edits off.

## Decisions needed (Clarify)

- **DQ-1 Which label/outcome?** (a) **(rec)** Keep `ai-review:blocked` and add a `reason:` with `retryable: no`, so existing consumers (merge gates `delegated-merge.ts:122`, `alta-approval-only.ts:317`) already treat it as not-green; cost: `blocked` now means two things, so the retry workflow and any label reader must also read the marker (a missed consumer would retry forever). (b) New label `ai-review:unavailable`; cleaner meaning, but every label consumer must be found and updated, and a missed one would read the PR as having no block at all, a silent-gate risk.
- **DQ-2 Mixed panel.** If some voters return verdicts and some are refused: (a) **(rec)** unavailable outranks any `pass` (cannot green with a missing voter) but a real `changes` from a voter that ran still wins, since it is a true finding; cost: the author sees `changes` and may fix code while a voter is still refused. (b) always unavailable until all voters run; hides a real finding.
- **DQ-3 Remediation hand-off.** (a) **(rec)** human-surface only (`needs-human-review`); cost: no automation shrinks the input. (b) let remediation split/trim the diff; new scope and risks editing the PR without a code reason.
- **DQ-4 Scope of "refused".** Only too-long input, or any deterministic 4xx refusal? Rec: too-long plus HTTP 400 invalid-request, cost: a broader matcher raises misclassification risk (FR-8 keeps unknowns closed).

## Follow-ups (tracked)

- Oversized diff (generated base64 template in the review diff): filed separately per #4081; no change here.
