---
id: SPEC-258
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination
aspects: [dispatch, worktree, disk-budget, no-silent-gate, cleanup]
depends_on: []
relates_to: ["#2561", SPEC-044, SPEC-257]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-258: Dispatch reaps finished per-issue worktrees and fails loudly on a disk budget

> **This is a SPECIFICATION ONLY.** Written for issue #2561 (https://github.com/AIClarityAU/minspec/issues/2561).
> Nothing is built until a human reads it, resolves
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

`scripts/dispatch-issue.sh` makes one git worktree per dispatched issue under `/tmp/minspec-agent` and never removes it. Each holds a full `npm ci` (about 535 MB of about 573 MB). On 2026-10-04 that was 289 directories and 96 GB in 5 days, filling the host root volume to 92%. Nothing reaps them and nothing refuses to dispatch when the area is full, so the leak is silent until the host fills.

## Verified state (checked 2026-10-27 on this worktree's base; issue line numbers have drifted)

- `scripts/dispatch-issue.sh:22` `WORKTREE_BASE="/tmp/minspec-agent"`; path is claim-unique `issue-<N>-<sessionId>` via `lease_worktree_path` (`scripts/lib/issue-lease.sh:99-102`).
- `:1271` `launcher_git ... worktree add -b "$BRANCH" "$WORKTREE" origin/main`.
- The only `worktree remove` in the script is `:1250`, which clears a pre-existing dir at the same claim-unique path. Because the path now includes a session id, it practically never matches a prior run, so it is no reaper at all.
- The exit trap `_dispatch_on_exit` (`:116-150`) releases claims and tears down the ticker; it does not touch the worktree.
- `scripts/drain-inbox.sh:858-859` removes its own `DRAIN_RUN_DIR` and runs `git worktree prune`; `:894-908` already symlinks `node_modules` from the primary checkout for the drain's run dir. So a shared-install form exists, but not in `dispatch-issue.sh`.
- `ALLOWED_TOOLS` (`:1470`) includes `Bash(npm ci)`, so the agent installs per worktree.
- I found no reaper for dispatch worktrees by grepping `reap|prune|worktree remove` in `scripts/dispatch-issue.sh` and `scripts/drain-inbox.sh`; the one at `drain-inbox.sh:959+` reaps orphan claims, not directories. Not exhaustively verified elsewhere.

## Root cause

The mechanism: worktree creation (`:1271`) has no matching teardown on any exit path, and the one `remove` call is keyed on a path that is unique per session, so it never fires. The missing gate: nothing measures `WORKTREE_BASE` (count or bytes) before a new dispatch, so unbounded growth cannot fail visibly (constitution invariant 2, no silent gate).

## Functional requirements

**FR-1. Reap on finish, only when nothing is lost.** When a dispatch run ends, its worktree is removed only if BOTH hold, each observed (not inferred): the branch tip is reachable from a pushed remote ref (compare local `HEAD` to the remote branch via `git ls-remote`/fetched ref), and `git status --porcelain` is empty. Otherwise the worktree is kept and a one-line reason is printed.

**FR-2. Reaping covers every exit path.** Success, failure, scope-guard refusal, and signal exits all go through the single existing exit trap (`_dispatch_on_exit`); no second `trap ... EXIT` (it would replace the claim release, per the comment at `:119`).

**FR-3. Kept worktrees still shed weight.** A worktree kept under FR-1 (unpushed or dirty) has its `node_modules` removed if it is not a symlink, so the retained cost is source only (about 7%). Source, git state and branch stay untouched.

**FR-4. Shared install.** `dispatch-issue.sh` provisions each worktree's `node_modules` (root and `packages/*/node_modules`) as symlinks to the primary checkout's install, as `drain-inbox.sh:904-908` does, instead of a per-worktree `npm ci`. Where the primary has no install, it falls back to `npm ci` and prints a warning. FR-3 never deletes through a symlink (remove the link, never its target).

**FR-5. Disk-budget gate.** Before creating a worktree, dispatch measures `WORKTREE_BASE` entry count and size against configurable limits. Over budget: it first attempts a reap sweep (FR-6); if still over, it refuses to dispatch with a visible, non-zero, non-success exit that callers can tell from "started" (the exit-status contract at `:25+`, #2641), and the issue is left dispatchable. A failed measurement (du error, unreadable dir) fails closed and visibly, never passes.

**FR-6. Sweep of stale worktrees.** A sweep (run from FR-5 and callable standalone) applies FR-1's safety test to every `issue-*` directory under `WORKTREE_BASE` older than a threshold and not held by a live claim, then runs `git worktree prune`. Directories that fail the safety test are listed, never deleted.

**FR-7. Housekeeping of the existing backlog.** The sweep is the one-off cleaner for the 372 registered worktrees; it must report counts of removed, kept-unpushed, kept-dirty, and kept-live.

**FR-8. Test fixtures clean up (related, in the issue).** Tests that `mkdtemp` remove their directories in teardown. A gate (or lint) flags a test file that calls `mkdtemp` with no matching removal. This is the second leak in the issue (about 179,000 dirs, enough to break `docker system df`).

## Acceptance criteria

- AC-1: after a clean dispatch that pushed its branch, the worktree directory and its registration are gone.
- AC-2: after a run whose branch is unpushed, or with an uncommitted file, the directory remains, has no real `node_modules`, and the log names which test failed.
- AC-3: a worktree with a symlinked `node_modules` is reaped or shed without the primary's `node_modules` being touched (primary install intact, asserted).
- AC-4: with `WORKTREE_BASE` over the configured limit and nothing reapable, dispatch exits as a refusal, not a start, and prints the measured value and limit.
- AC-5: a failing `git ls-remote`, `git status` or `du` leaves the worktree in place and is reported; it is never treated as "pushed and clean".
- AC-6: the claim is still released when reaping itself fails (the existing trap job is not skipped).
- AC-7: a synthetic suite of N dispatches leaves at most the unsafe ones on disk.
- AC-8: a test file with `mkdtemp` and no cleanup is flagged by the FR-8 check.

## Invariants this change must not break

- Invariant 1 (offline core): reaping and measuring are local; `git ls-remote` is a dev-time dispatch network call that already happens in this script, not a MinSpec extension call.
- Invariant 2 (no silent gate): FR-5 and FR-1 fail visibly and closed; no `|| true` on a load-bearing measurement (each swallow needs the existing `# swallow-ok:` justification).
- Invariant 3 (blast radius): acts only under `WORKTREE_BASE` and only on `issue-*` entries; never the primary checkout or other worktrees.
- SPEC-044 claim-unique path rule: never remove another live session's directory.
- The claim release and ticker teardown in `_dispatch_on_exit` still run on every exit.

## Decisions needed (Clarify)

1. **Reap trigger.** (a) On exit of each run (rec): immediate, bounded disk; costs that a reviewer or remediation agent cannot inspect the tree after the fact (the pushed branch still exists). (b) Only by periodic sweep: keeps trees for debugging; costs up to a day of growth (about 20 GB) between sweeps.
2. **Unpushed or dirty worktrees.** (a) Keep, drop only `node_modules` (rec): no data loss; costs about 7% of the weight stays and needs a human or later sweep to resolve. (b) Push a rescue branch then remove: fully reaps; costs an automatic outward-facing push of unreviewed agent state.
3. **Shared install vs per-worktree.** (a) Symlink to primary (rec): removes 93% of cost; costs that a worktree whose PR changes `package-lock.json` tests against the primary's dependencies, and a primary reinstall mid-run changes what runs. (b) Keep `npm ci`, rely on reaping: exact deps; costs about 535 MB per live run and a slower start.
4. **Budget limits.** Proposed defaults: 40 entries and 30 GB, env-overridable. Founder to confirm or give numbers; too low stalls the drain, too high allows a 30 GB spike.
5. **Scope of FR-8.** Whether test-fixture cleanup stays here or is split to its own issue (it is a different mechanism, in `packages/minspec/tests`, 237 files use `mkdtemp`). Rec: split; costs a second spec cycle.

## Follow-ups (tracked)

- Test-fixture temp-dir leak (FR-8), if split: to be filed by the human decision in item 5.
