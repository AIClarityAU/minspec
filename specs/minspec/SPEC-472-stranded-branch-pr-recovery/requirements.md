---
id: SPEC-472
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination (drain / dispatch reliability)
aspects: [dispatch, drain, rate-limit, recovery, no-silent-gate]
relates_to: ["#4103", "#4062", "#4061", "#3735", "#3400", "#2114"]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-472: Recover pushed agent branches that have no PR after a rate-limit window

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers the questions under [Decisions needed (Clarify)](#decisions-needed-clarify),
> and approves it through the normal spec-approval gate before any code changes. Requirements
> are written under each question's recommended option.

Materializes **#4103** (*drain strands pushed agent branches with no PR when the GraphQL rate
limit outlasts the #4062 re-auth retry*). Builds on #4062 (re-auth retry in `ensure_branch_pr`)
and #4061 (a no-PR branch is a failed dispatch). No decision record yet; see Decisions item 3.

## Problem

`ensure_branch_pr` (`scripts/dispatch-issue.sh:1831`) lists, creates, re-lists, then makes ONE
immediate retry after `gh_bot_reauth_read`. That is the right answer to a stale token and the
wrong one to a GraphQL rate limit: the retry fails identically, `run_reviewer_stage` sets
`PR_STRANDED=1` (`dispatch-issue.sh:1950`) and the script exits 1 (`dispatch-issue.sh:3336`).
That fails the dispatch **visibly** but nothing ever revisits it. On 2026-11-26 `agent/issue-1267`
(`fae1e20`) and `agent/issue-91` (`d67c11e`) were left on origin with no PR in any state, while
`#1189` in the same window got PR #4101 once the limit reset.

**Root cause (mechanism + missing gate):** the no-PR path has a single, cause-blind retry (it
treats every empty result as a token fault), and no later cycle scans for `agent/issue-*`
branches on origin that lack a PR. The failure is loud once, then forgotten.

## Functional requirements

- **FR-1 Classify the failure.** When the PR list/create in `ensure_branch_pr` fails, the
  failure is classified as `rate-limit`, `auth`, or `unknown` from the `gh` error text and HTTP
  status (secondary or primary rate limit; 401/bad credentials), not from an empty result alone.
  Stderr is captured, not discarded to `/dev/null`.
- **FR-2 Rate-limit path waits, then retries.** On `rate-limit`, do NOT re-mint. Read the reset
  time (`gh api rate_limit`, which does not consume GraphQL quota; or the response header) and
  wait until reset (bounded, see FR-3), then retry list+create. On `auth`, keep the existing
  single forced re-mint (#4062). On `unknown`, behave as today.
- **FR-3 Bounded wait.** The in-dispatch wait is capped (default per Decision 1). Past the cap
  the dispatch does not hold its slot: it records the branch as pending-PR (FR-4) and exits 1
  as today.
- **FR-4 Durable pending-PR marker.** A stranded branch is recorded in a place a later cycle can
  read without the dispatch's process (branch name, head SHA, issue number, verdict if any,
  time). The marker is never the only witness: FR-5 does not depend on it.
- **FR-5 Recovery sweep.** A later drain cycle lists `agent/issue-*` branches on origin that
  have no PR in any state, excluding branches whose issue has a merged/closed PR, and, for each,
  opens the PR with the body the dispatch would have used, then runs the usual review and gate.
  This is independent of the marker (second witness, constitution invariant 2).
- **FR-6 Rate-limit aware sweep.** The sweep checks remaining quota first and defers entirely
  while it is exhausted; it never loops tightly against the limit.
- **FR-7 No duplicate PRs, no duplicate dispatch.** The sweep is idempotent (re-list before
  create) and takes the same per-issue claim the dispatcher takes, so it cannot race a live
  dispatch or a re-dispatch of the same issue.
- **FR-8 Visible failure.** A branch the sweep cannot recover (repeated failure, or a verdict
  that cannot be reconstructed) is reported in the drain log and on the issue, never swallowed.
  Any `|| true` introduced carries a `# swallow-ok:` justification like the existing ones.
- **FR-9 Reviewer verdict.** A stranded branch's earlier verdict (pass or changes) is not
  trusted after the gap; the sweep re-runs review on the recovered PR (Decision 2).
- **FR-10 One-off recovery.** `agent/issue-1267` and `agent/issue-91` get their PRs opened,
  by the sweep once built, or by hand before it. That act is not code and is not done by this
  spec.

## Acceptance criteria

1. With `gh` stubbed to return a GraphQL rate-limit error on list/create, `ensure_branch_pr`
   does not call `gh_bot_reauth_read`, and does not retry before reset.
2. With `gh` stubbed to return 401, it re-mints once and retries (today's behaviour, #4062).
3. A fixture origin with `agent/issue-N` and no PR: the sweep opens exactly one PR; a second run
   opens none.
4. The sweep skips a branch whose issue already has an open, merged or closed PR, and a branch
   claimed by a live dispatch.
5. Sweep with quota exhausted makes no create call and exits without error, logging the defer.
6. An unrecoverable branch yields a visible log line and issue comment, and a non-zero count in
   the cycle summary.
7. Tests fail against the current code for 1 and 3 (regression-proof, not vacuous).

## Invariants this must not break

- Invariant 2 (no silent gate): the failed dispatch stays exit 1; recovery adds a witness, it
  does not soften the failure. No new unjustified `|| true`.
- Invariant 1 (offline core): the change lives in dev-time `scripts/`, not the shipped extension.
- Invariant 3 (blast radius): scripts act only on `agent/issue-*` branches of the repo they run in.
- Role/DR-076 limits: the sweep opens PRs only; it never merges, and approvable-doc PRs keep
  their human gate.

## Out of scope

Raising or avoiding the GraphQL limit itself; changing the #4062 auth retry for genuine token
faults; recovering non-`agent/issue-*` branches.

## Decisions needed (Clarify)

1. **In-dispatch wait cap.** (a) **(rec)** short cap (e.g. 5 min) then hand to the sweep; costs a
   little holding of a drain slot and a stranded window up to one cycle. (b) wait to reset
   whatever it is; simplest, but a slot can sit idle up to an hour. (c) no wait, always defer to
   the sweep; slot freed fastest but every transient blip becomes a next-cycle PR.
2. **Verdict after recovery.** (a) **(rec)** re-run review on the recovered PR; costs review
   tokens once more per recovered branch. (b) reuse the stored verdict; cheaper, but trusts a
   verdict whose own post step errored (as `issue-1267` did) and which may predate main moving.
3. **Decision record.** (a) **(rec)** no DR: the change is reversible in under a day (script
   logic, DR-359 filter); costs no durable rationale beyond this spec. (b) file a DR for the
   marker format if it becomes a cross-script contract.
4. **Marker location.** (a) **(rec)** none beyond origin itself (branch with no PR is the
   marker; sweep derives the rest from the branch and issue); fewest moving parts, but loses
   the saved verdict and timestamps. (b) a git-ignored local state file or an issue comment;
   richer, but a local file is lost with the machine and a comment needs a working API.

*Recorded selection:* none yet; these await the human's read.
