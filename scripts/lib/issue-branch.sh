#!/usr/bin/env bash
# scripts/lib/issue-branch.sh - what an issue's agent/issue-N branch already holds (#3452).
#
# dispatch-issue.sh used to run `worktree add -b agent/issue-N` unconditionally, which git
# refuses (rc=255) when an earlier attempt left that branch behind - so the issue was
# selected again every cycle and spent a dispatch slot failing. Decide per branch instead:
#
#   absent    no local or origin branch                  -> create it from origin/main
#   empty     branch exists, no commit beyond origin/main -> reuse it (fast-forward to main)
#   work      branch carries commits not on origin/main  -> CONTINUE from it; skip the
#                                                           dispatch if an open PR is the route
#
# Nothing here deletes, resets or force-moves a branch. The only ref movement is a
# fast-forward of a branch that is an ancestor of its target.
#
# All functions take the repository root as $1 and the branch as $2 and are read-only
# unless the name says otherwise.

# issue_branch_tip <repo> <branch>: the ref to continue from, or nothing when absent.
# Local wins; origin's copy wins when local is strictly behind it (a pure fast-forward).
issue_branch_tip() {
  local repo="$1" br="$2" has_local=0 has_remote=0
  git -C "$repo" show-ref --verify --quiet "refs/heads/$br" && has_local=1
  git -C "$repo" show-ref --verify --quiet "refs/remotes/origin/$br" && has_remote=1
  if (( has_local && has_remote )); then
    if git -C "$repo" merge-base --is-ancestor "refs/heads/$br" "refs/remotes/origin/$br"; then
      echo "refs/remotes/origin/$br"
    else
      echo "refs/heads/$br"
    fi
  elif (( has_local )); then
    echo "refs/heads/$br"
  elif (( has_remote )); then
    echo "refs/remotes/origin/$br"
  fi
}

# issue_branch_state <repo> <branch>: prints absent | empty | work.
# A branch whose commits cannot be counted is "work": never guess toward reuse.
issue_branch_state() {
  local repo="$1" br="$2" tip n
  tip=$(issue_branch_tip "$repo" "$br")
  if [[ -z "$tip" ]]; then echo absent; return 0; fi
  if ! n=$(git -C "$repo" rev-list --count "origin/main..$tip" 2>/dev/null) || [[ ! "$n" =~ ^[0-9]+$ ]]; then
    echo work; return 0
  fi
  if (( n == 0 )); then echo empty; else echo work; fi
}

# issue_branch_open_pr <repo-slug> <branch>: 0 when an open PR has this head, 1 when none,
# 2 when it could not be asked. The caller decides what 2 means (dispatch continues, loudly).
issue_branch_open_pr() {
  local slug="$1" br="$2" out
  out=$(gh pr list --repo "$slug" --head "$br" --state open --json number --jq 'length' 2>/dev/null) || return 2
  [[ "$out" =~ ^[0-9]+$ ]] || return 2
  (( out > 0 )) && return 0
  return 1
}

# issue_branch_plan <repo> <branch>: how to make the worktree, as "<mode> <ref>":
#   new <ref>       branch absent: `worktree add -b BRANCH WT <ref>` (ref = origin/main)
#   existing <ref>  local branch exists: `worktree add WT BRANCH`, then fast-forward onto <ref>
#   track <ref>     only origin has it: `worktree add -b BRANCH WT <ref>`, then fast-forward
#                   onto origin/main when the branch is empty
# <ref> after "existing"/"track" is the fast-forward target ("-" = none needed). The
# `worktree add` itself stays in dispatch-issue.sh as a launcher_git line: agent-launch-sites
# requires every worktree creation to go through the hook-pinned launcher.
issue_branch_plan() {
  local repo="$1" br="$2" state tip target
  state=$(issue_branch_state "$repo" "$br")
  tip=$(issue_branch_tip "$repo" "$br")
  if [[ "$state" == absent ]]; then echo "new origin/main"; return 0; fi
  if [[ "$state" == empty ]]; then target="origin/main"; else target="$tip"; fi
  if git -C "$repo" show-ref --verify --quiet "refs/heads/$br"; then
    [[ "$target" == "refs/heads/$br" ]] && target="-"
    echo "existing $target"
  else
    if [[ "$state" == empty ]]; then echo "track $tip origin/main"; else echo "track $tip -"; fi
  fi
}
