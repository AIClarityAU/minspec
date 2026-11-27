---
id: SPEC-383
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - docs-lane push ergonomics; same epic as the recovery specs it amends
aspects: [approval, protected-branch, recovery, no-silent-gate, cleanup, failure-record]
depends_on: [SPEC-208, SPEC-050]
relates_to: ["#3880", "#1022", "#2974", "#3515", "#1115", SPEC-140, SPEC-208, SPEC-050, DR-080, DR-123]
affects: [packages/minspec/src/lib/approval-recover.ts, packages/minspec/src/commands/commit-on-approve.ts]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decision D-1. Expected surface: `packages/minspec/src/lib/approval-recover.ts` and `packages/minspec/src/commands/commit-on-approve.ts`.
---

# SPEC-383: A failed protected-branch approval recovery cleans up after itself and fails visibly

Tracks [#3880](https://github.com/AIClarityAU/minspec/issues/3880). Amends the recovery flow
of [DR-080](../../../docs/decisions/DR-080.md) as implemented in
`packages/minspec/src/lib/approval-recover.ts` (`recoverProtectedBranchApproval`) and its caller
`recoverOnProtectedBranch` in `packages/minspec/src/commands/commit-on-approve.ts`.

## Scope sentence

When approval recovery on a protected default branch fails after it has created its branch, it
must (a) remove that branch, and (b) leave a machine-detectable, founder-visible failure record,
so the outcome is never "empty local branch plus uncommitted approval files, reason only in the
editor log".

## Incident (2026-11-19, DR-123)

The founder accepted DR-123 on protected `main`. The three approval files were written to the
primary working tree; no approval PR opened. A local branch
`approvals/decisions-dr-123-20261119T220129392Z` existed at origin/main's tip with no commit and
was never pushed. A runner job later carried the same bytes to PR #3879. Re-running copy, stage
and commit in a container worktree succeeded, so the host-side failure reason is known only from
the editor log line `approval recovery failed - ...`, which nothing but that log carries.

## Root-cause analysis (from the code, read at base `87f4c2d4`)

Claims below cite code. What is NOT knowable from code is stated as such.

1. **Leftover branch (cited).** `approval-recover.ts` step 4 runs
   `git worktree add -q -b <branch> <wt> origin/<base>`, which creates the branch. Every later
   failure (copy step 5, `add` step 6, `commit` step 8, push step 9) returns `{outcome:'failed'}`
   and falls into the `finally`, which runs only `git worktree remove --force` and `rmSync` of the
   temp dir. **No code ever deletes the branch** (`git worktree remove` does not delete the
   branch). So any failure from step 5 to step 9 leaves a local `approvals/...` branch: empty if
   it failed before the commit (this incident), or holding an unpushed commit if the push failed.
   The branch is a local ref in the primary checkout, so it is also visible to the founder's
   branch list.
2. **Silent failure (cited).** In `recoverOnProtectedBranch`, a non-`recovered` outcome does
   `console.warn('MinSpec: approval recovery <outcome> - <error>')` and returns `undefined`
   (commit-on-approve.ts, the `res.outcome !== 'recovered'` branch). The caller then shows the
   generic "Approval written but NOT committed ... commit them on a branch" toast, which names
   neither the failing step nor the git/hook stderr. `console.warn` lands only in the extension
   host log. Nothing is written where the queue, the PR gate, a later session or the container
   can read it. That is the missing gate: the failure is a load-bearing signal written to a
   best-effort sink, which violates invariant 2 (no silent gate).
3. **Why it can fail on the host but not in the container (NOT determinable from code).** Steps
   5-8 depend on host state the container does not share: git config (e.g. commit signing or
   `core.hooksPath`), hooks and the tools they call (gitleaks, `npm`), file permissions or
   locks on the host's temp dir (`os.tmpdir()`), antivirus/file watchers, and
   `GIT_LITERAL_PATHSPECS`/env inheritance from the editor process. The result carries only the
   last stderr; it does not record WHICH step failed. The exact reason for this incident is
   therefore unproven until the founder's log line is read (see Decisions needed D-1). The spec
   does not guess it; it makes the next occurrence self-describing.

## Functional requirements

- **FR-1 (branch cleanup).** After any failure at or after `worktree add` creates the branch,
  `recoverProtectedBranchApproval` removes the local branch it created, unless that branch has
  been pushed successfully (outcome `recovered`) or holds a commit not reachable from the pushed
  state (see FR-2). Cleanup runs after the worktree is removed (a branch checked out in a
  worktree cannot be deleted), is best-effort in the INV-2 sense (never throws), and a cleanup
  failure is itself reported (FR-3), not swallowed.
- **FR-2 (never destroy an unpushed approval commit).** If the failure happened after the commit
  succeeded (push failed, offline), the branch holds the only committed copy of the approval. It
  is NOT deleted; it is kept and named in the failure record and the toast as the recoverable
  artifact. Only branches with no commit beyond `origin/<base>` are deleted. Deletion uses
  `git branch -d`-equivalent safety (refuse if the tip differs from the recorded base SHA),
  never `-D` on a branch carrying a commit.
- **FR-3 (failure record).** On any non-`recovered`, non-`nothing-to-commit` outcome that
  involved a created branch or reached the copy step, recovery writes a failure record to a
  fixed, git-ignored location under `.minspec/` (opt-in marker, invariant 3), containing at
  least: ISO timestamp, approved paths, outcome, the failing step name (`fetch`, `worktree-add`,
  `copy`, `stage`, `commit`, `push`, `cleanup`), the git/hook stderr, the branch name and whether
  it was deleted or kept, and the base SHA. The record is machine-readable (JSON). Writing the
  record must not throw; if it cannot be written, the failure toast says so (FR-4).
- **FR-4 (visible to the founder).** On such failure the founder sees a toast that names the
  failing step and the first line of stderr, and states where the record is. The generic
  "commit them on a branch" text stays as the closing advice. The toast is non-modal (project
  HITL rule: never steal focus).
- **FR-5 (queue-detectable).** The failure record is discoverable by a deterministic probe so
  the existing stranded-work detection (SPEC-057, stranded branch detection) and the
  chief-of-staff queue can flag "approval recovery failed, files uncommitted in the primary".
  The record is cleared when the same paths later land (an approval PR merges or the working
  tree matches origin/main).
- **FR-6 (failing step recorded in the result).** `RecoverResult` gains a `step` field naming
  where it failed, so FR-3/FR-4 do not parse stderr. Existing `outcome` values and the
  never-throws contract are unchanged.
- **FR-7 (stale leftovers).** Before creating a new recovery branch, recovery deletes any prior
  local `approvals/*` branch of its own naming scheme that has no commit beyond its
  `origin/<base>` fork point and no worktree checked out (an earlier failed run), so a retry
  does not accumulate empty branches. Branches with commits are left alone.

## Acceptance criteria

- **AC-1.** Stub `GitRun` fails at `copy`, `stage`, `commit` in turn: afterwards the stub
  recorded a `branch -d`-style delete of the created branch, the worktree was removed, and the
  result is `failed` with the right `step`. (Distinguishing test for the incident: before this
  spec the branch delete never occurs.)
- **AC-2.** Stub fails at `push` after a successful commit: the branch is NOT deleted, the
  record names it as kept, and the toast names it.
- **AC-3.** A real-git test (temp repo with a bare origin) where `commit` is made to fail via a
  rejecting hook: no `approvals/*` branch remains and the failure record exists with the hook
  stderr.
- **AC-4.** An unwritable record location produces a toast that says the record could not be
  written; the approval files in the primary are untouched.
- **AC-5.** Retry after a failure leaves no more than the one new branch (FR-7).
- **AC-6.** A recovery that succeeds writes no failure record and deletes nothing.

## Invariants (must not break)

- Recovery never mutates the primary checkout's HEAD or index (INV-1 of
  `approval-recover.ts`; rule #8 / DR-051 4a). Branch deletion touches a ref only, never
  checks out, resets or stages in the primary.
- Never throws (INV-2). Never mints or edits an approval record (INV-3). Network only after
  push consent (INV-4; this spec adds no network call).
- Constitution invariant 2: failure is visible and machine-detectable, no swallowed error.
- Constitution invariant 3: the failure record lives under `.minspec/`, written only in a repo
  that already has it.
- Constitution invariant 1: no new network call.
- An unpushed approval commit is never deleted (FR-2).

## Out of scope

- Making the push/commit itself succeed on the founder's host: depends on D-1.
- #1022 (approve commits but never pushes), #2974 (primary dirty after approval on protected
  main) and #3515 (acceptance stops at an open PR) are separate defects; this spec only covers
  recovery's failure path.
- SPEC-208 (recovery loan repayment) plans a shared worktree transport that will move this code.
  Order of landing is a Clarify item (D-3).

## Decisions needed (Clarify)

- **D-1: How is the host failure reason obtained?** The code cannot say why the host failed.
  Options: (a) **(rec)** founder pastes the `approval recovery failed - ...` line from the
  editor log into #3880, so the spec can add a targeted fix on top of FR-1..FR-7; cost: one
  human step, and the generic fixes ship without addressing the host cause. (b) ship FR-1..FR-7
  only and let the next occurrence self-report via FR-3; cost: the founder hits the failure at
  least once more.
- **D-2: Where does the failure record live?** (a) **(rec)** a git-ignored file under
  `.minspec/` (for example `.minspec/recovery-failures.json`), simple and offline; cost: it is
  per-checkout, so the container cannot see the founder host's primary unless it is mounted.
  (b) also open a GitHub issue automatically; cost: a new network act needing consent, and it
  fails exactly when the network is the problem.

  **Recorded selection: the recommended option,** (a), a git-ignored file under `.minspec/`, for example `.minspec/recovery-failures.json`. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-22; sign-off ratifies it.

- **D-3: Landing order with SPEC-208 and SPEC-140.** (a) **(rec)** land this first because it is
  small and fixes a live leak; cost: SPEC-208's transport rewrite must absorb the cleanup logic
  and may need a merge. (b) fold into SPEC-208; cost: the leak persists until a larger spec is
  planned and built.

  **Recorded selection: the recommended option,** (a), land this spec first, ahead of SPEC-208 and SPEC-140. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-22; sign-off ratifies it.
