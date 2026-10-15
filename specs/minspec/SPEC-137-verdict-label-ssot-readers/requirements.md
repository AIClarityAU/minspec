---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - the ai-review / ready-to-merge gate contract
aspects: [ci, gates, ssot, ai-review, machinery, no-silent-gate, tier-0]
relates_to: [SPEC-054, DR-066, DR-063, "#822", "#839", "#466", "#1688"]
# Ownership is declared in Specify so approval mints a hash over it (SPEC-038). Every file is
# machinery (.github/ or scripts/): the PR that builds this is a human-reviewed `--admin`
# merge, not an auto-merge. Whether the .sh files below are also parity-managed copies in
# adopter repos is Decision D4 - it changes the blast radius, not this list.
implements: [scripts/lib/verdict-labels.sh, scripts/review-decide.sh, scripts/dispatch-issue.sh, scripts/review-pr.sh, scripts/review-branch.sh, scripts/review-approvable.sh, scripts/remediate-pr.sh, scripts/review-churn-report.sh, scripts/drain-inbox.sh, scripts/lib/docs-corpus.sh, .github/workflows/ai-review.yml, .github/workflows/ai-review-retry.yml, .github/workflows/ready-to-merge.yml, .github/workflows/docs-lane.yml, packages/minspec/tests/verdict-label-enforcement.test.ts]
phases:
  specify: in-progress
---

# SPEC-137: shell and workflow producers read the ai-review verdict labels from guard.js

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers or accepts the questions under *Decisions needed (Clarify)*, and approves it
> through the normal spec-approval gate before any code changes.

Materializes **[#839](https://github.com/AIClarityAU/minspec/issues/839)**, the single-source
half of **#822** (verdict labels re-typed across producers). The enforcement half already
exists: `packages/minspec/tests/verdict-label-enforcement.test.ts` binds every producer's
restated literal to the `.github/scripts/ai-review-guard.js` exports and fails CI on drift.
That test detects divergence; this spec removes the ability to diverge.

## Problem

The `ai-review:<verdict>` labels and the `ai-review/pass` status context are the one contract
between the writer of a verdict and the `ready-to-merge` reader. `ai-review-guard.js` exports
them (`PASS`, `CHANGES`, `BLOCKED`, `CARRIED`, `PENDING`, `PASS_STATUS_CONTEXT`; `guard.js:33,34,40,53,839,1893`)
but 13 shell/workflow files (counted with `grep -cE 'ai-review[:/](pass|changes|blocked|pending|carried)'`
on 2026-10-16) re-type them as bare literals: 86 occurrences in `ai-review.yml`, 39 in
`dispatch-issue.sh`, 20 each in `review-decide.sh` and `ready-to-merge.yml`, and so on.
Today only the test stands between a one-character edit and a deadlocked merge queue.

## Scope

In: the *functional* literals - those a `gh --add-label/--remove-label/label create`, a
`-f context=`, a label comparison (`= "ai-review:pass"`), or a `jq`/`select` filter acts on - in the
files named under `implements`. Out: literals in comments and prose (they document, they
do not act; the enforcement test keeps covering them), `ai-review-guard.js` itself, and
any change to the label vocabulary or to gate behaviour. This is a pure refactor.

## Functional requirements

- **FR-1 Single definition.** After this change no executable line in a producer contains a
  verdict-label or status-context string literal. Each reads it from `ai-review-guard.js`.
- **FR-2 One shared reader for shell.** A single sourced helper, `scripts/lib/verdict-labels.sh`,
  resolves the literals once (via `node -e 'require(<guard>)'`) and exports them as shell
  variables (`AI_REVIEW_PASS`, `AI_REVIEW_CHANGES`, `AI_REVIEW_BLOCKED`, `AI_REVIEW_CARRIED`,
  `AI_REVIEW_PENDING`, `AI_REVIEW_PASS_STATUS`). Scripts source it; none shells out to node itself.
- **FR-3 Workflows read once per job.** Each workflow job that needs a literal resolves them in
  one early step and exposes them through `$GITHUB_ENV` (or step outputs). Existing `node -e`
  reads of the guard in `ai-review.yml` (lines 375, 396, 879, 1095) are the pattern to follow.
- **FR-4 Fail closed, visibly.** If node is missing, the guard fails to load, or an export is
  absent/empty, the helper prints a named error and exits non-zero; the caller aborts. No
  fallback to a restated default (a fallback would be the second source this spec removes),
  and no `|| true` on the read (constitution invariant 2, no silent gate).
- **FR-5 Trusted source in workflows.** In any workflow running with write permissions on
  untrusted PR content, the guard is read from the trusted base checkout, never from the PR
  head, so a PR cannot choose the label the gate trusts.
- **FR-6 No behaviour change.** Labels applied, statuses posted, and comparisons made are
  byte-identical to today for every verdict path. The refactor adds no new label.
- **FR-7 Test updated, not weakened.** The enforcement test keeps its guard-binding checks and
  adds a rule: no *executable* producer line may contain a verdict literal (comments exempt).
  Because the check now implies FR-1, a regression that re-introduces a literal fails CI.
- **FR-8 Constants complete.** `PENDING` is a guard constant (`guard.js:1893`); the build confirms it is in `module.exports` (the export list read on 2026-10-16 showed it only if present further down - to verify) so the test's hand-written `PENDING` string goes away.
  absent from `module.exports` if not exported there; the build exports it, so the test's
  hand-written `PENDING` string goes away.

## Acceptance criteria

- **AC-1** `grep -nE 'ai-review[:/](pass|changes|blocked|pending|carried)'` over the producers,
  filtered to non-comment lines, returns nothing (FR-1).
- **AC-2** With the guard file renamed, every producer script and workflow job exits non-zero
  with a message naming the guard; none proceeds (FR-4).
- **AC-3** With one export deleted from a copy of the guard, the helper fails naming that export (FR-4).
- **AC-4** A test that changes `PASS` in a copy of the guard to a new value shows
  `review-decide.sh` and `ready-to-merge.yml` logic apply and read the new value with no other
  edit (single-source property, FR-1/FR-2).
- **AC-5** Existing suites (`ai-review-guard.test.js`, the review-decide tests, the enforcement
  test) pass unchanged in behaviour (FR-6).
- **AC-6** Re-introducing one literal in an executable line makes the enforcement test fail (FR-7).

## Invariants this must not break

- **INV-1 (constitution 2, no silent gate).** Reading the label is itself a gate signal; its
  failure must be loud and stop the run (FR-4). A helper that falls back to a literal fails this.
- **INV-2 (constitution 1, offline).** The read is a local `require`; no network.
- **INV-3 (constitution 3, blast radius).** Nothing here may change behaviour in a repo that did
  not opt in; see D4 for the parity-managed copies.
- **INV-4.** No change to the guard's security posture: it stays I/O-free and its exports
  are only ever handed to the shell as data after being read from a trusted checkout (FR-5).

## Delivery constraint

Every file edited is `.github/` or `scripts/`, which the ai-review self-edit guard keeps out
of a clean auto-merge. The build lands as one human-reviewed machinery PR, merged by the
human via `--admin`. A single PR is preferred over per-file PRs: a half-converted tree is the
state where one producer reads and another restates.

## Decisions needed (Clarify)

- **D1 - mechanism.** (a) **(rec)** one sourced `verdict-labels.sh` resolving once per process:
  one node spawn, one failure point; cost: a new file all scripts depend on, so a bad edit
  there breaks every script at once (loud, per FR-4). (b) inline `node -e` at each use: no new
  file; cost: ~200 node spawns across the tree and 200 places to get quoting wrong.
  (c) generate a static `labels.env` from guard.js at build time and commit it: no runtime
  node; cost: a second committed copy of the literals, which is the problem being solved.
- **D2 - workflow trust (FR-5).** (a) **(rec)** read from the base-branch checkout that
  `ai-review.yml` already uses for the guard; cost: a PR that changes the guard is judged
  against the old labels until merged (acceptable, same as today). (b) read from the PR head;
  cost: opens a label-choice channel to the PR author - rejected unless you disagree.
- **D3 - comments.** (a) **(rec)** leave comment/prose literals alone, test-covered; cost: they can
  still go stale, but they cannot act. (b) strip them too; cost: unreadable explanatory
  headers and a much larger diff for the human reviewer.
- **D4 - adopter parity.** Some of these scripts may be parity-managed and shipped to adopter
  repos (check `parity` manifests before build). If so, an adopter without
  `.github/scripts/ai-review-guard.js` would fail closed under FR-4. Options: (a) **(rec)**
  ship the guard alongside the scripts that need it; cost: more files in adopters. (b) make
  the helper a no-op in repos lacking the opt-in marker `.minspec/`; cost: a repo that has
  the scripts but not the guard silently skips the reads, which sits close to invariant 2.
  I have not verified which scripts are parity-managed - **unverified, to check at Plan**.
- **D5 - sequencing.** One PR (rec, per Delivery constraint; cost: a large machinery diff to
  review) versus several; several risk a mixed tree between merges.

## Follow-ups (tracked)

None beyond this spec: the enforcement half is already in the tree; the build is this spec's
own Implement phase.
