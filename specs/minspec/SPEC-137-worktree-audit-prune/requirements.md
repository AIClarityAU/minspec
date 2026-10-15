---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - worktree-per-session is how concurrent sessions stay isolated; this keeps that isolation from accreting
aspects: [worktree, cleanup, audit, destructive-op, no-silent-gate, blast-radius, dev-tooling]
relates_to: [DR-074, SPEC-062, SPEC-073, "#540", "#168"]
---

# SPEC-137: Audit and prune orphaned git worktrees

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers the Clarify questions, and approves it through the normal spec-approval gate
> before any code changes.

Materializes **[#540](https://github.com/AIClarityAU/minspec/issues/540)** - *"audit + prune
orphaned worktrees (many stale `.claude/worktrees/agent-*` + long-lived feature worktrees)"*.
No DR is rested on; the one hard-to-reverse choice (deleting a branch) is a Clarify question.

**Id note.** `SPEC-137` is the next free id on `origin/main` and in every branch visible from
this checkout (highest seen: `SPEC-136`). Open pull requests are invisible here; renumber if
the collision check reports a clash.

## Problem

`git worktree list` on the primary checkout shows 150+ entries (measured 2026-10-16:
66 under `~/code/.worktrees/MinSpecPro`, 25 under `~/code/.worktrees/minspec`, 6 under
`~/code/MinSpecPro/.claude/worktrees`, 53 under `/tmp/minspec-agent`). Each is a full
checkout plus a branch ref, and the shared `.git` makes every `git worktree list`, `git gc`
and branch listing slower. Nothing tells anyone which are safe to drop.

## Root cause (RCDD - mechanism, not state)

"Many stale worktrees" is the symptom. The mechanisms, each checked in code:

1. **Dispatch cleanup is best-effort and unconditional.** `scripts/dispatch-issue.sh:1007`,
   `scripts/remediate-pr.sh:738,753,761` and `scripts/drain-inbox.sh:793-794` remove
   worktrees with `... --force 2>/dev/null || true`. A crash, kill, timeout or an
   un-trapped exit skips the removal and leaves no record; a failure is swallowed.
   (This also cuts against constitution invariant 2, *no silent gate*, for the cleanup
   signal.)
2. **Nothing reconciles after the fact.** `scripts/new-worktree.sh:10` documents cleanup as
   a manual step ("after the branch is merged"). No script lists, classifies or prunes
   worktrees, so every skipped removal in (1) and every finished long-lived feature
   worktree persists forever.
3. **`.claude/worktrees/agent-*` are owned by the Claude Code harness, not by this repo.**
   `scripts/new-worktree.sh:15` states they are "harness-owned, auto-removed". What removes
   them, and under what conditions, is not in this repository; the issue's RCDD ask
   ("why isn't it") can only be answered here up to that boundary. See Clarify DQ-3.

The missing gate is a reconciler: something deterministic that classifies each worktree and
refuses to destroy anything it cannot prove is already preserved elsewhere.

## Scope

A single repo script plus its test, in the style of `scripts/check-primaries-clean.sh`:
**audit by default (read-only)**, and an explicit prune mode that removes only worktrees the
audit classifies as safe. It never touches a worktree it cannot classify.

Out of scope: changing the harness's own cleanup; changing dispatch scripts' cleanup (a
follow-up, see FR-9); worktrees of other repos.

## Functional requirements

- **FR-1 (inventory).** The tool enumerates every worktree from
  `git worktree list --porcelain` run against the primary checkout, including detached HEADs,
  locked and prunable entries, and reports for each: path, branch (or detached SHA), and the
  class from FR-2. Output is stable-sorted and machine-readable (`--json`) as well as human
  readable.
- **FR-2 (classification).** Each worktree gets exactly one class, evaluated in this order,
  first match wins:
  1. `current` - the worktree the tool runs in, the primary checkout, or one held by a live
     process (FR-4). Never removable.
  2. `dirty` - has uncommitted changes or untracked files (`git status --porcelain` non-empty).
     Never removable.
  3. `unpushed` - has commits reachable from its branch that are in neither `origin/main` nor
     any other remote ref. Never removable.
  4. `merged` - branch tip is an ancestor of `origin/main`, **or** the two-dot tree diff
     against `origin/main` is empty (content already landed, e.g. by squash merge). Removable.
  5. `pr-open` - branch tip equals the head of an open pull request. Never removable.
  6. `prunable` - git reports the directory missing (`prunable` in porcelain). Removable by
     `git worktree prune` only.
  7. `unmerged-clean` - clean, fully pushed, not merged, no open PR. **Reported, never
     removed** unless DQ-1 selects otherwise.
- **FR-3 (fail closed).** If any classifying input is unavailable (no `origin/main`, `git
  status` errors, the PR lookup fails or is not run), the affected worktrees are classified
  `unknown`, are never removable, and the run exits non-zero with the reason printed. A probe
  that returns nothing is not evidence of absence (memory: *empty query ≠ settled gate*); the
  tool runs a control against a known ref before trusting an empty result.
- **FR-4 (liveness).** A worktree is `current` if its path is the process's cwd, an ancestor
  of any live process's cwd, or contains a `.git/index.lock`-style lock. Liveness is measured
  (process cwd scan), never inferred from the branch name or an `agent-*` prefix.
- **FR-5 (audit is read-only).** Default invocation performs no `git worktree remove`, no
  branch deletion, no `git worktree prune`, no network write. Exit 0 means "audit completed",
  with the report listing candidates.
- **FR-6 (prune requires an explicit mode and a plan).** `--prune` first prints the exact set
  it will remove, then removes only worktrees classed `merged` or `prunable`. It never passes
  `--force` to `git worktree remove`; a refusal by git is reported and the worktree kept. It
  re-classifies each worktree immediately before removing it (state may have changed since the
  audit).
- **FR-7 (branch deletion).** After a successful removal of a `merged` worktree, the local
  branch is deleted with `git branch -d` (never `-D`) only if git agrees it is merged;
  squash-merged branches that `-d` refuses are reported, not forced, unless DQ-2 selects
  otherwise. Remote branches are never deleted by this tool.
- **FR-8 (no silent failure).** Every removal or deletion failure is printed with its path and
  git's message, and makes the exit code non-zero. No `2>/dev/null || true` on any gate-bearing
  call.
- **FR-9 (follow-up for the cause).** The `|| true` removals in FR-root-cause item 1 are
  noted as follow-ups, filed as issues, not changed by this spec.
- **FR-10 (scope of effect).** The tool operates on the repo it is run inside and writes
  nothing outside `git worktree` metadata and the worktree directories it removes. It does not
  create `.minspec/` anywhere (constitution invariant 3).

## Acceptance criteria

- **AC-1.** Against a fixture repo with one worktree of each FR-2 class, the audit reports the
  expected class for each and removes nothing (FR-1, FR-2, FR-5).
- **AC-2.** `--prune` on that fixture removes exactly the `merged` and `prunable` worktrees;
  `dirty`, `unpushed`, `pr-open`, `unmerged-clean`, `current` remain on disk (FR-6).
- **AC-3.** A squash-merged branch (tree identical to `origin/main`, tip not an ancestor) is
  classed `merged` (FR-2.4).
- **AC-4.** With `origin/main` absent or the PR lookup failing, nothing is removable, output
  names the missing input, exit is non-zero (FR-3).
- **AC-5.** A worktree with a live process cwd inside it is `current` even though its branch
  is merged (FR-4).
- **AC-6.** If `git worktree remove` refuses, the tool exits non-zero, keeps the worktree and
  prints git's message (FR-6, FR-8).
- **AC-7.** Test uses a throwaway repo under a temp dir and asserts the primary repo's
  worktree list is unchanged (FR-10).
- **AC-8.** A run on the real repo is done once as an audit only and the report is attached to
  #540; the human decides whether to run `--prune` (see DQ-4).

## Invariants this must not break

- Invariant 1 (offline): the audit and prune use only local git state by default. The PR
  lookup in FR-2.5 uses `gh` and is therefore opt-in (`--check-prs`); without it, PR state is
  `unknown` and FR-3 applies, so default prune on a cold run removes nothing it cannot prove.
  (Alternative in DQ-5.)
- Invariant 2 (no silent gate): FR-3 and FR-8.
- Invariant 3 (blast radius): FR-10.
- Never delete work that exists nowhere else: FR-2.2, FR-2.3, FR-6, FR-7.

## Decisions needed (Clarify)

- **DQ-1 - `unmerged-clean` worktrees.** Options: **A (rec)** report only, never remove;
  costs: the pile of long-lived feature worktrees from the issue never shrinks without a
  human reading the list. **B** remove if pushed and branch exists on the remote (work is
  preserved there); costs: a later "where did my checkout go" for a worktree someone still
  uses, and any remote branch deleted later loses the work.
- **DQ-2 - squash-merged local branches.** **A (rec)** report the branch, leave it; costs:
  stale local branch refs remain. **B** `git branch -D` when FR-2.4's content-identity proof
  holds; costs: force-deletion on a proof that checks tree identity with `origin/main` only
  at one instant.
- **DQ-3 - harness-owned `.claude/worktrees/agent-*`.** **A (rec)** treat like any other
  worktree under the FR-2 rules and file an issue against the harness for the cleanup gap;
  costs: this repo cannot fix the cause. **B** exclude them from the tool entirely; costs:
  the 6 current entries stay forever.
- **DQ-4 - who runs prune.** **A (rec)** a human (or the chief-of-staff session) runs
  `--prune` after reading the audit; costs: manual step, the accumulation can recur.
  **B** run the audit from a scheduled/drain hook and prune automatically; costs: an
  automated destructive operation, a drift risk the constitution warns about, and it needs
  its own consent surface.
- **DQ-5 - PR lookup.** **A (rec)** `gh` lookup behind `--check-prs` as in the invariants
  section; costs: default runs classify open-PR branches `unknown` and prune less. **B**
  derive "has open PR" from remote refs only (`refs/pull/*`); costs: only works when those
  refs are fetched.

## Open items

None beyond the Clarify questions above. Design, tasks and the file list are Plan-phase work;
suggested home: `scripts/audit-worktrees.sh` plus a bats/vitest test, owned at Plan time.
