---
id: SPEC-367
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - the harness refresh landing path
aspects: [no-silent-gate, offline-first, consent]
depends_on: []
relates_to: ["#1554", "#758", "#1298", "#533", "DR-050", "SPEC-043", "SPEC-042"]
implements: none
implements_reason: >-
  Specify phase only. Nothing is built yet; the push/PR offer, the branch return and the recovery
  detection are all planned (#1554).
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-367: A harness refresh committed on a new branch is offered a landing step, never stranded, and never leaves the user silently on that branch

Issue: #1554. Design rests on DR-050 (shelling the user's own authenticated `gh`/git on explicit consent does not violate the zero-network-in-core invariant, accepted).

## Problem

*Refresh Harness Files* on the default branch offers to commit on a new branch (`offerScaffoldCommit`, `packages/minspec/src/commands/init.ts:366`). On accept it runs `createBranch` (`git checkout -b`, `:302`), then `commitOrWarn` (`:429`, `:535`) and returns. There is no push, no PR, no return to the previous branch, and the success toast names the branch and goes silent. Verified: the only git operations on this path are `checkout -b`, `add`, `commit` (and read-only probes).

Consequences, observed in a real project (two stranded local-only branches, each holding genuine template updates):

1. Refreshed harness files never reach the default branch, and nobody is told.
2. The user is left checked out on the new branch, so unrelated later work lands there too.
3. `safeUniqueBranchName` (`:515`, from #1298) correctly avoids a taken name by falling back to a dated name, so each later refresh creates a NEW orphan branch.
4. *Commit Harness Refresh* (#758, `commitHarnessRefreshCommand`, `:572`) returns early with "no uncommitted harness/scaffold output" when the tree is clean (`:575-580`), so it cannot see "commit exists, unpushed, on a branch nobody is on".

Root cause (mechanism + missing gate): the branch offer was added so a commit is not made on a push-protected default branch, but the flow ends at the local commit; no step owns "did the work leave the machine", and the only recovery affordance keys on a dirty tree, not on an unlanded branch. Nothing checks that the refresh landed, so drift can be re-detected forever.

## Functional requirements

- **FR1 (landing offer).** After `offerScaffoldCommit` commits on a newly created branch, the success notification MUST offer the next step: `Push and open PR`, `Push only`, `Stay local`. Dismissal is equivalent to `Stay local`. No git/network action beyond the commit happens without a click (invariant 1; DR-050).
- **FR2 (push).** `Push only` and `Push and open PR` run `git push -u <remote> <branch>` for the new branch only, never force, never another ref. Failure is surfaced as a warning naming the branch and the error, and the branch and commit are left intact.
- **FR3 (PR).** `Push and open PR` additionally runs `gh pr create` against the default branch using the user's own `gh`, with the refresh commit subject as title. If `gh` is absent or unauthenticated, the push result is still reported and the toast says plainly that the PR step was skipped and why, with the branch name. Never silent.
- **FR4 (branch posture).** After the commit (whatever the FR1 choice), the user MUST NOT be left silently on the new branch. Per Decision 1, the extension either checks the previous branch back out, or states plainly in the same toast that HEAD is now on `<branch>`.
- **FR5 (recovery sees stranded work).** *Commit Harness Refresh* MUST also detect a local harness branch (name `chore/minspec-harness-refresh` or `chore/harness-refresh-*`, and the scaffold branch) that is ahead of the default branch and has no upstream, and offer FR1's push/PR choices for it. "Nothing to do" is reported only when the tree is clean AND no such branch exists. Detection is local-only (no fetch).
- **FR6 (optional, branch reuse).** Per Decision 3, when an unmerged, unpushed-or-pushed harness branch already exists, a refresh MAY reuse it (checkout, commit on top) instead of creating a dated sibling.
- **FR7 (no behaviour change off-path).** Committing on a non-default branch, "commit anyway" on the default branch, declining, and scaffold (non-refresh) wording are unchanged except where FR1/FR4 apply to the scaffold-on-new-branch case (Decision 2).
- **FR8 (injectable, testable).** The push, PR and branch-detection operations are added to the existing `ScaffoldCommitter` / deps seam so every arm is testable without a real remote or `gh`.

## Acceptance criteria

- **AC1.** Accepting the new-branch commit shows a toast with exactly the three actions; choosing `Stay local` runs no push and no `gh` call.
- **AC2.** `Push only` calls push with upstream for the new branch and nothing else; a rejected push yields a warning and leaves the commit.
- **AC3.** `Push and open PR` with `gh` unavailable pushes, then reports that the PR was skipped and why.
- **AC4.** After any outcome the post-condition of FR4 holds: either HEAD equals the pre-refresh branch, or the toast text names the branch HEAD is on.
- **AC5.** With a clean tree and an unpushed ahead-of-default harness branch, *Commit Harness Refresh* offers the landing choices instead of "nothing to commit"; with a clean tree and no such branch it still reports nothing to do.
- **AC6.** A harness branch already pushed (has upstream) or not ahead of default is not offered.
- **AC7.** A test proves no network/`gh` call occurs on decline or dismiss at every prompt.

## Invariants the change must not break

- Invariant 1 (offline core): push and `gh` only after an explicit click in that prompt; DR-050 consent rule.
- Invariant 2 (no silent gate): every skipped or failed landing step is reported with branch name and reason; no swallowed error.
- Invariant 3 (blast radius): applies only in repos with `.minspec/`; the default-branch protection reasoning from the existing offer is preserved (still no commit on the default branch unless chosen).
- Never push to or force-push the default branch.

## Decisions needed (Clarify)

1. **Branch posture after commit (FR4).** (a) Return to the previous branch **(rec)**: removes the compounding accident; cost: the refreshed files vanish from the working tree until the branch is merged, which may surprise a user who wanted to keep working with the new harness locally. (b) Stay and state it plainly: harness stays live; cost: it relies on the user reading the toast, the exact failure that caused this issue.
2. **Scope of FR1/FR4: refresh only, or scaffold too?** (a) Both **(rec)**, one shared path, no divergence between init and refresh (the file's own stated aim); cost: touches first-run init UX. (b) Refresh only; cost: a scaffold-on-branch has the same stranding.
3. **Branch reuse (FR6).** (a) Defer to a follow-up issue **(rec)**: keeps this spec small; cost: orphans still accumulate for repos not using the recovery path. (b) Include now; cost: reusing a branch whose content is stale or diverged needs merge/rebase handling and widens the change.
4. **Network step at all.** Issue's alternative is FR4 + FR5 only, push left manual. Recommended: include push/PR **(rec)**; cost: a reflexive click on the highlighted action creates a remote branch (and PR) the user did not plan. Without it the knowledge gap that produced this report remains.
5. **Default highlighted action.** `Stay local` **(rec)** is the non-highlighted-risk choice (a reflexive click does nothing outward); cost: one more click for users who always want the PR.
6. **Onboarding (#533).** Add a "harness branch not landed" checklist item (SPEC-042)? Rec: separate follow-up issue; cost: until then only the recovery command surfaces it.
