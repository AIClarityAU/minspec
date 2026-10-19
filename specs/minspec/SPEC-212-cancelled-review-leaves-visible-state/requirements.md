---
id: SPEC-212
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - DR-066's own domain (the silent-gate incident family); SPEC-071/SPEC-078 use it for the same gate-signal integrity class
aspects: [ai-review, ci, no-silent-gate, fail-closed, harness, parity]
depends_on: [DR-066]  # No silent gate: a missing or errored witness fails closed AND visibly, and never hinges on one producer
relates_to: ["#2070", "#2067", "#1468", "#1630", "#1688", "#810", "#466", SPEC-078]
# Ownership declared in Specify (SPEC-038 FR-1 to FR-3). Every change lands in existing
# workflow files that no spec owns, and they are shipped to adopters through the
# generated ci-review-templates.ts, so owning them from a defect spec would freeze them
# for every other change to the review stack.
implements: none
implements_reason: >-
  The change lands in existing, shared review-stack files (two workflows and the guard),
  which are parity-managed and shipped to adopters; owning them from a defect spec would
  freeze them for every other change.
# Modified, not owned. ci-review-templates.ts is generated from the workflow files and is
# never hand-edited (it is listed because the parity test makes it change in lock-step).
affects: [.github/workflows/ai-review.yml, .github/workflows/ai-review-retry.yml, .github/scripts/ai-review-guard.js, .github/scripts/ai-review-guard.test.js, packages/minspec/src/lib/ci-review-templates.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-212: A cancelled ai-review run leaves a visible, self-healing state, never a silent hole

Triggered by: #2070 (cancelled ai-review run clears the stale pass and posts no
replacement verdict). Design rests on DR-066 (no silent gate). No new DR: every choice
below is a workflow edit that can be reverted in under a day (the architect role's ADR filter).

## In plain terms

When the ai-review workflow starts on a new commit, its first real act is to remove the
previous `ai-review:pass` label so an old pass cannot merge new code. The verdict that
replaces it is written many steps later. If the run is cancelled anywhere in between, the
pull request ends up with **no verdict label, no `ai-review` check on its head, and nothing
that will ever run again by itself**. Merging stays blocked (good), but nothing says *why*:
to a human or to the chief-of-staff loop it looks exactly like a review that ran and said
no. The PR silently drops out of the queue until someone notices.

This spec makes that state **impossible to leave unexplained and impossible to leave
stuck**: a cancelled or vanished review is labelled as "could not run, will retry", and an
independent sweeper re-runs it on the PR's *current* head.

## Observed defect (evidence)

From #2070, PR #2067, head `7fd4e63c`, run `35761667438` attempt 1:

- step 4 (`Clear stale pass at run start`) **cancelled**; every later step **skipped**,
  including the verdict check-run step (`ai-review.yml:1090-1091`, `if: always() && ...`)
  and the fail-closed backstop (`ai-review.yml:1568-1569`, `if: failure() && ...`);
- the head had no `ai-review` check-run, and the PR had no `ai-review:*` label at all.

Mechanism, read from the code:

1. `ai-review.yml:268` removes `ai-review:pass`, and only then `ai-review.yml:273` adds
   `ai-review:pending`. A cancel between the two leaves no label. (I believe this is
   exactly where attempt 1 was cut, because `pending` was also absent - inferred from the
   issue's label report, unverified.)
2. Even when `pending` does land, a cancelled run leaves `pending` on the PR forever: no
   step, and no other workflow, ever clears or re-runs it.
3. The backstop runs on `failure()` only (`ai-review.yml:1569`), not `cancelled()`.
4. **The in-run arm alone cannot be the fix.** The verdict check-run step is already
   `always()`, which GitHub documents as running after a cancel, yet the issue records it
   as *skipped*. Why it was skipped is not established (a forced second cancel, or a lost
   runner, would both do it - unverified). Whatever the cause, it proves that a step
   inside the cancelled run is not a reliable witness for that run's own cancellation.
   Per DR-066, the gate needs a second producer that does not live in the run that died.
5. `ai-review-retry.yml` (hourly) re-runs only PRs labelled `ai-review:blocked`
   (`ai-review-retry.yml:63-66`). A PR with no label is invisible to it.

The missing gate, in RCDD terms: nothing asserts the invariant *"every open PR's current
head either has a verdict check-run, or has a live ai-review run, or carries a visible
retry-able label"*. This spec adds that assertion.

The cancellation cause of attempt 1 itself is out of scope, as in the issue: the hole is
reachable from any cancellation.

## Functional requirements

- **FR-1 - Never a label-less window at run start.** The stale-clear step adds
  `ai-review:pending` *before* it removes `ai-review:pass` (and `ai-review:carried`). A cancel
  at any point in that step leaves either the old labels or `pending`, never nothing.
  (`pending` next to `pass` for a moment is safe: ready-to-merge already reads a
  contradictory pair as "not passed", the #1468 rule.)

- **FR-2 - Orphaned-head sweep (the independent witness).** A sweeper that runs outside
  ai-review-runner finds every open PR whose **current head SHA** meets all of:
  1. no `ai-review` check-run on that SHA from an allowlisted reviewer login
     (`AI_REVIEW_BOT_LOGINS`), and
  2. no ai-review-runner run for that SHA in `queued`, `waiting`, `pending` or
     `in_progress`, and
  3. the newest ai-review-runner run for that SHA (if any) completed more than a grace
     period `G` ago, or no run exists for that SHA and the head commit is older than `G`.

  Each such PR is an **orphaned head**. Where the sweeper lives and how often it runs is
  DQ-1.

- **FR-3 - Make the orphan visible.** For each orphaned head the sweeper writes the label
  chosen in DQ-2, removes `ai-review:pending` and `ai-review:pass`, and posts one comment
  that says, in plain words: the review on `<short SHA>` did not finish (`cancelled` /
  `failed before a verdict` / `never started`, from the run's own conclusion), it has been
  re-queued, and a link to the run. The comment is posted once per head SHA, not once per
  sweep tick (idempotence marker in the comment body).

- **FR-4 - Re-run on the current head only.** The sweeper re-runs the newest
  ai-review-runner run whose `head_sha` equals the PR's current head. It **never** re-runs
  a run for an older SHA: that run would join the per-PR concurrency group
  (`ai-review.yml:188-190`, `cancel-in-progress: true`) and cancel the live review of the
  new head, recreating this very defect. If no run exists for the current head, it
  dispatches nothing and leaves the visible label from FR-3 in place for a human (a
  PR the workflow never ran on is a configuration fault, not a transient).

- **FR-5 - Bounded retries, then a human.** A head is re-run at most `N` times by the
  sweeper (counted from the run's `run_attempt`, not from a stored counter). After `N`
  the sweeper stops re-running, adds `needs-human-review`, and says so in the comment, the
  same exhaustion shape as #1630's unevidenced-block guard. `G` and `N` are DQ-3.

- **FR-6 - In-run fast path, superseded runs stay silent.** The fail-closed backstop also
  runs on `cancelled()`. Before writing anything it re-reads the PR's current head; if it
  differs from this run's `pull_request.head.sha` (a newer push superseded this run), it
  writes **nothing** and exits. Only a cancel of the run for the current head writes the
  DQ-2 label and comment. This answers the issue's stated cost (a spurious verdict on the
  old head moments before the new run's real one): a supersede never posts. Whether to
  build this fast path at all is DQ-4; FR-2 to FR-5 are the guarantee either way.

- **FR-7 - Distinguishable from a declined review.** Every surface that reports "ai-review
  has not passed" can tell *ran and declined* from *did not finish*: the label (DQ-2) and
  the comment differ from the `ai-review:changes` ones, and the label is a member of the
  guard's `VERDICT_LABELS` handling (`ai-review-guard.js:1894`) so the post step and the
  backstop clear it on the next real verdict. The host-side `cos.py recheck` reader is not
  in this repo; teaching it the new reason is a follow-up (see below).

- **FR-8 - Adopter parity.** The workflow changes flow to adopters through the generated
  `ci-review-templates.ts` and the existing `ci-stack-portability` parity test; no new
  file is introduced that the template registry does not ship.

## Acceptance criteria

- **AC-1** (FR-1) The stale-clear step's label writes are ordered add-`pending` first. A
  guard test pins the order by reading the workflow, and a mutant that swaps them fails it.
- **AC-2** (FR-2, FR-3) Given a fixture PR whose head has no `ai-review` check-run, no live
  run, and a newest run with conclusion `cancelled` older than `G`, the sweeper's pure
  decision function returns "orphaned, reason cancelled". Variants with a live run, an
  allowlisted-bot check-run present, and a run younger than `G` each return "not
  orphaned"; a variant whose only `ai-review` check-run is from a non-allowlisted login
  still returns "orphaned" (a forged check is not a witness).
- **AC-3** (FR-4) Given a PR whose newest run is for an older SHA than the current head,
  the decision is "do not re-run". No code path calls `gh run rerun` with a run whose
  `head_sha` is not the current head - asserted on the decision function's output, not
  on source text.
- **AC-4** (FR-3) Two consecutive sweep ticks over the same orphaned head post exactly one
  comment.
- **AC-5** (FR-5) A head whose newest run has `run_attempt` greater than or equal to the
  cap yields "stop, summon human", and `needs-human-review` is applied.
- **AC-6** (FR-6, if DQ-4 = build) With the current head different from the run's head,
  the cancelled arm makes zero label or comment writes; with them equal, it writes the
  DQ-2 label.
- **AC-7** (FR-7) After a real verdict on the re-run, no orphan label remains (the
  verdict-clear seam from #1472 includes it).
- **AC-8** (FR-8) `ci-stack-portability` passes with the regenerated templates; the guard
  tests run inside the shipped `ai-review-guard.test.js` (SPEC-211's parity rule), not a
  MinSpec-only file.
- **AC-9** Replay of the #2070 shape on a scratch PR: cancel the run during step 4; within
  `G` plus one sweep interval the PR carries the DQ-2 label, the comment, and a re-queued
  run on the same head; the re-run posts a real verdict.

## Invariants the change must not break

- **INV-1 - No spurious pass, ever.** Nothing in this spec writes `ai-review:pass`, a
  `success` `ai-review` check-run, or the `ai-review/pass` status. The sweeper is not a
  verdict producer; it only re-queues and labels "not finished".
- **INV-2 - SHA binding (#466, #810).** ready-to-merge's head-witness rule is untouched;
  a label never stands in for the SHA-bound check-run or status.
- **INV-3 - No silent gate (constitution invariant 2, DR-066).** Every new label write
  whose absence would leave the PR invisible is checked: a failed write fails the sweep
  step red with the PR number, never `|| true`. (The pre-existing best-effort writes
  in step 4 are not made worse; FR-1 only reorders them.)
- **INV-4 - Verdict carry (#1688) unchanged.** A re-run is `run_attempt > 1` and therefore
  always reviews; that is already the carry rule and is relied on, not altered.
- **INV-5 - Credential separation.** The sweeper holds the App token or `GITHUB_TOKEN`
  with `actions: write` + label scopes only; it never runs the reviewer and never holds
  `CLAUDE_CODE_OAUTH_TOKEN`.
- **INV-6 - Blast radius (constitution invariant 3).** The sweeper acts only on the repo
  it runs in, which is a repo that opted in by having the review stack.
- **INV-7 - Offline core (constitution invariant 1).** No change to the extension's
  runtime; all network activity is GitHub Actions in the adopter's own CI.

## Decisions needed (Clarify)

- **DQ-1 - Where the sweeper lives.**
  - (a) **(rec)** Extend `ai-review-retry.yml`'s hourly tick with the orphaned-head query.
    One scheduled workflow already owns "re-run reviews that did not finish", already has
    `actions: write`, and adopters already get it. *Cost:* up to about an hour (plus `G`)
    before an orphan is labelled and re-queued; scheduled workflows can also be delayed
    or skipped by GitHub under load.
  - (b) A new `workflow_run: [ai-review-runner] types: [completed]` trigger that reacts to
    `cancelled`/`failure` within seconds. *Cost:* it only fires for runs that complete,
    so a run that never started is missed; it is one more producer that one workflow-file
    or permission fault can disable.
  - (c) Both. *Cost:* two code paths that must share one decision function to avoid
    drift.

- **DQ-2 - What label an orphaned head wears.**
  - (a) **(rec)** `ai-review:blocked` with the comment giving reason `cancelled` /
    `no verdict`. It already means "could not run, retry-able, not a code verdict", the
    retry workflow already re-runs it, and every reader already treats it as not-passed.
    *Cost:* `blocked` has meant "quota/transient" in practice; readers that assume quota
    (and #1630's evidence check, which treats an unevidenced block as suspect) must accept
    a non-quota reason, or they will summon a human early.
  - (b) `ai-review:changes`, as the issue first suggested. *Cost:* reads as a code verdict
    on code nobody reviewed, and feeds `remediate-pr.sh`'s change-request loop with nothing
    to remediate.
  - (c) A new `ai-review:incomplete` label. *Cost:* a fifth verdict label that the guard,
    ready-to-merge, the retry workflow, the remediation classifier and the host-side
    `cos.py` must all learn in step.

- **DQ-3 - Grace period `G` and retry cap `N`.**
  - (a) **(rec)** `G` = 10 minutes, `N` = 3 attempts. Ten minutes clears normal Actions
    queue latency so a run that is merely slow to start is not called orphaned; three
    matches the order of re-runs a human would try before looking. *Cost:* a genuinely
    stuck PR waits up to `G` + one sweep interval before anyone is told.
  - (b) Shorter `G` (2 minutes). *Cost:* false orphans during queue congestion, each one
    a needless comment and re-run.

- **DQ-4 - Build the in-run `cancelled()` fast path (FR-6)?**
  - (a) **(rec)** Yes, with the current-head check. It labels the common case
    (a cancel that the runner does honour) in seconds instead of up to an hour. *Cost:* a
    second writer of the same label to keep aligned with the sweeper; mitigated by both
    calling one guard function.
  - (b) No - sweeper only. *Cost:* every cancel is invisible until the next tick.

## Out of scope

- Finding what cancelled attempt 1 of run `35761667438` (the issue leaves it open on
  purpose; the hole exists for any cause).
- The COMPLETE TOCTOU fix in ready-to-merge (pass SHA equals head), already tracked by the
  comment at `ai-review.yml:77-82`.
- Changing the per-PR `cancel-in-progress: true` policy.

## Follow-ups (tracked)

- Teaching the host-side `cos.py recheck` to print the "did not finish" reason distinctly
  from a declined review lives outside this repo (host patches go through
  `scripts/host-patches/`). backlog: 2026-10-19 cos.py recheck should report an orphaned
  ai-review head (SPEC-212 FR-7) distinctly from a declined review. To be filed or added to
  `docs/backlog.md` at Plan, once DQ-2 fixes the label name it must read.
