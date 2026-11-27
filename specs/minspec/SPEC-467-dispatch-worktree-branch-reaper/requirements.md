---
id: SPEC-467
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute
aspects: [dispatch, worktree, branch-lifecycle, reaper, tier-0]
relates_to: ["#1199", "#912", "#3452", SPEC-073, SPEC-273]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-467: Dispatch cleans up its worktrees and branches; a reaper for the backlog

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers the questions under [Decisions needed (Clarify)](#decisions-needed-clarify),
> and approves it through the normal spec-approval gate before any code changes. Requirements
> are written under each question's recommended option.

Materializes **#1199** (*crashed dispatches leak agent worktrees and branches without bound*).

## Problem

`scripts/dispatch-issue.sh` creates `agent/issue-N` and a worktree under
`/tmp/minspec-agent/` per dispatch (`dispatch-issue.sh:1482-1520`). Nothing removes either
when the agent crashes or exits with no commit. Measured on the primary checkout (figures from
the issue, not re-measured here): 176 local `agent/issue-*` branches, 141 at `origin/main`
with zero commits, ~30 carrying 1-2 never-pushed commits, 25 worktrees (623 MB) of which 23
were empty. Consequences: unbounded disk on a path a container recreate wipes (taking the
unpushed commits with it, silently); an unusable `git branch` (goal G-8, hide git);
`checkout_occupied` / `sync_shared_checkouts` enumerate every worktree each cycle.

Existing behaviour this builds on (read, not assumed): `scripts/lib/issue-branch.sh` (#3452)
already **reuses** an empty branch and **continues** from a branch with work, and never
deletes anything. The only existing removals are the pre-create `worktree remove --force` of
the same issue's stale path (`dispatch-issue.sh:1486`) and the drain run-dir removal
(`drain-inbox.sh:1037`). The single exit trap `_dispatch_on_exit` (`dispatch-issue.sh:146-180`)
releases the lease only. So nothing reaps either artefact today.

## Functional requirements

- **FR1 - Exit cleanup, no-commit case.** When a dispatch ends (any exit path, including the
  signal path `_dispatch_on_exit` already handles) and its branch has zero commits beyond
  `origin/main` and its worktree is clean, the dispatcher removes the worktree and deletes the
  local branch. Reuses `issue_branch_state` == `empty`; a state that cannot be counted is
  treated as `work` (never guess toward deletion).
- **FR2 - Exit cleanup, crashed-with-commits case.** When the branch carries commits and no
  PR was opened, the worktree is removed only after the commits are safe per FR4 (preserved
  on the remote). If preservation fails, the worktree and branch are left in place and a
  visible warning names them.
- **FR3 - Dirty worktree is never removed.** Uncommitted or untracked changes in the worktree
  keep it, and its branch, in place with a visible warning. (Crashed agents write partials.)
- **FR4 - Orphaned-commit preservation.** Per decision D1, commits on `agent/issue-N` with no
  open PR are pushed and surfaced as a draft PR so review judges them, instead of staying in
  an invisible local ref.
- **FR5 - Reaper for the backlog.** A new command (one script, dry-run by default, `--apply`
  to act) classifies every local `agent/issue-*` branch:
  1. zero commits beyond `origin/main`, no worktree, not leased -> **delete**;
  2. carries commits, already reachable from `origin/main` or pushed with a merged/closed PR
     -> **delete** (covered by standing branch-lifecycle rules, listed for completeness);
  3. carries unpushed commits -> **report only**, per FR4/D1 never silently deleted;
  4. has a live worktree or live lease -> **skip**, reported.
  Output is a table: branch, class, commit count, age, action taken.
- **FR6 - Stale worktrees.** The reaper also removes clean, zero-commit worktrees under the
  dispatch base directory whose lease is gone, then `git worktree prune`. Dirty or
  with-commits worktrees are reported, never removed.
- **FR7 - Safety against live work.** Neither FR1 nor FR5 touches a branch or worktree held by
  a live lease (`scripts/lib/issue-lease.sh`) or any process still running in it; the lease
  check is made immediately before each deletion, not once at start.
- **FR8 - Visible, never silent.** Every deletion and every skip is logged with branch, tip
  SHA and reason. A failed cleanup step exits non-zero from the reaper and logs from the
  dispatcher; it is never `|| true` (constitution invariant 2). The tip SHA logged makes a
  mistaken deletion recoverable via `git reflog`/`git branch <name> <sha>`.
- **FR9 - Offline.** Classification and local deletion make no network call. Only FR4's push
  and PR creation need the network, and only from the dispatcher's existing credentialed
  path, never from the agent (invariant 1; agents hold no credentials).
- **FR10 - Scheduling.** Per decision D2, the reaper runs from the drain loop once per cycle
  and is also invocable by hand.

## Acceptance criteria

- AC1: a dispatch whose agent exits with no commit leaves no worktree and no `agent/issue-N`
  branch afterwards (FR1).
- AC2: a dispatch that crashes after committing, with push failing, leaves worktree and
  branch intact plus a warning naming both (FR2).
- AC3: a worktree with one untracked file survives every cleanup path (FR3).
- AC4: against a fixture of 3 empty branches, 1 branch with an unpushed commit, 1 branch with a
  worktree and 1 leased branch, `--apply` deletes exactly the 3 and the report lists the other
  2 and the unpushed one with the right class (FR5, FR7).
- AC5: dry-run (default) changes no ref and no directory (FR5).
- AC6: after an `--apply` run, a second run is a no-op (idempotent).
- AC7: with the network unplugged, classification and local deletion succeed (FR9).

## Invariants this must not break

- Never delete a branch carrying commits that exist nowhere else (INV-A; the core promise).
- Never touch another live session's worktree or lease (INV-B; cf. #3452 and the R7
  corruption note at `dispatch-issue.sh:1478-1481`).
- Cleanup failures are visible, not swallowed (constitution invariant 2).
- Offline for everything but the preserve-push (invariant 1).
- Scope: only `agent/issue-*` branches and worktrees under the dispatch base directory;
  nothing outside, and nothing in a repo without `.minspec/` (invariant 3).
- Does not change #3452's reuse/continue semantics; cleanup must leave a state that logic
  handles identically to absent.

## Out of scope

Fixing why dispatches crash (#912). Remote `origin/agent/*` branch pruning. Reaping
non-`agent/issue-*` branches.

## Decisions needed (Clarify)

**D1 - What becomes of an orphaned unpushed agent commit?**
- (a) **(rec)** Dispatcher pushes it and opens a **draft** PR labelled so review judges it.
  Cost: a crashed, possibly half-finished attempt becomes a PR that spends review tokens, and
  a bad one still needs closing; mitigated by draft state and one PR per issue.
- (b) Push the branch only, no PR. Cost: still invisible to anyone not listing remote
  branches, so the work-loss problem returns in a smaller form.
- (c) Leave local, report only. Cost: lost on container recreate, which is the reported harm.
- (d) Save a patch file under a durable path. Cost: a new artefact kind to curate.

**D2 - When does the reaper run?**
- (a) **(rec)** Once per drain cycle plus on demand. Cost: a deletion step on the hot path of
  the drain, so a reaper bug has a wide blast radius; mitigated by FR7/FR8.
- (b) On demand only. Cost: the backlog regrows unless someone remembers (a prose-only rule).
- (c) At the start of each dispatch. Cost: slows every dispatch.

**D3 - Is a never-used zero-commit branch deleted under a standing rule?** The issue notes
branch-lifecycle rules cover merged/closed branches only.
- (a) **(rec)** Yes, explicit rule: zero-commit, no-worktree, no-lease `agent/issue-*` branches
  are deleted. Cost: none material (recreated from `origin/main` on next dispatch).
- (b) Keep them. Cost: the reported clutter.

**D4 - Grace period before reaping a zero-commit branch with no worktree?**
- (a) **(rec)** None beyond FR7's live-lease check. Cost: a dispatch between "branch created"
  and "lease taken" could lose its branch; the plan must order lease before branch creation
  or this needs (b).
- (b) A short age floor (e.g. 1 hour). Cost: one more tunable.

## Follow-ups (tracked)

None beyond the Clarify decisions above.
