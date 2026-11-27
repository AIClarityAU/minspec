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

# ── Which worktree already holds the branch (#3909, SPEC-384) ──────────────────────────
#
# git lets one worktree at a time have a branch checked out. A dispatch that finished (or
# crashed) leaves its worktree registered at ${WORKTREE_BASE}/issue-N-<its sid>, still
# holding agent/issue-N, and every later dispatch's `worktree add` for that branch died
# with rc=128 ("already used by worktree"), cycle after cycle. The cleanup in
# dispatch-issue.sh only looks at THIS session's claim-unique path, which is always fresh.
#
# issue_branch_holder_plan <repo> <branch> <worktree-base> <issue> <witness>
# prints ONE tab-separated line saying what the dispatch does about a holder:
#
#   none                     nobody holds the branch: create the worktree as before
#   prune  <path>            the holder's folder is gone: drop that one registration
#                            (`git worktree remove <path>`, never a repository-wide prune)
#   reuse  <path>            a dead dispatch's worktree: continue in it, as it is (D1 a)
#   defer  <path>  <reason>  anything else: in flight, or not provably dead. Touch nothing.
#
# <witness> is "claim" when the caller has just WON this issue's claim (SPEC-044): no
# other session holds a live claim on it, so a dispatch worktree under the base is dead
# (D2, the lease is the one liveness witness). Anything else is "liveness unknown", and
# unknown is never treated as dead (FR-5). Only a worktree under <worktree-base> named
# issue-<issue>-<something> is eligible for prune or reuse; any other holder (a human's
# checkout) is in flight (D3).
#
# Read-only, and runs no git inside the holder: the holder's `.git` file is read as text,
# because an agent had that tree and may have rewritten it. A git failure listing the
# worktrees returns 1 and prints nothing on stdout (no silent gate).
issue_branch_holder_plan() {
  local repo="$1" br="$2" base="${3%/}" issue="$4" witness="$5"
  local listing line wt="" head="" locked=0 holders=() flags=() i base_real
  if ! listing=$(git -C "$repo" worktree list --porcelain 2>&1); then
    echo "issue-branch: could not list the worktrees of '${repo}': ${listing}" >&2
    return 1
  fi
  # Records are blank-line separated; the extra newline closes the last one.
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) wt="${line#worktree }"; head=""; locked=0 ;;
      "branch "*) head="${line#branch }" ;;
      locked|"locked "*) locked=1 ;;
      "")
        if [[ -n "$wt" && "$head" == "refs/heads/${br}" ]]; then
          holders+=("$wt"); flags+=("$locked")
        fi
        wt=""; head=""; locked=0 ;;
    esac
  done <<<"${listing}"$'\n'
  if (( ${#holders[@]} == 0 )); then printf 'none\n'; return 0; fi
  if (( ${#holders[@]} > 1 )); then
    printf 'defer\t%s\t%s\n' "${holders[0]}" "git lists ${#holders[@]} worktrees holding ${br}"
    return 0
  fi
  wt="${holders[0]}"; locked="${flags[0]}"
  base_real="$(cd "$base" 2>/dev/null && pwd -P)" || base_real="$base"
  local name="${wt##*/}" parent="${wt%/*}"
  if [[ "$parent" != "$base" && "$parent" != "$base_real" ]] \
     || [[ "$name" != "issue-${issue}-"?* ]]; then
    printf 'defer\t%s\t%s\n' "$wt" "held by a worktree outside this dispatcher's base (${base}/issue-${issue}-*), so treated as in flight (D3)"
    return 0
  fi
  if (( locked )); then
    printf 'defer\t%s\t%s\n' "$wt" "the holder is locked (git worktree lock)"
    return 0
  fi
  if [[ ! -e "$wt" ]]; then
    printf 'prune\t%s\n' "$wt"
    return 0
  fi
  if [[ "$witness" != "claim" ]]; then
    printf 'defer\t%s\t%s\n' "$wt" "liveness unknown: no won claim to prove its owner dead (FR-5)"
    return 0
  fi
  # The holder's `.git` must still name the git directory the REPOSITORY recorded for it,
  # or pinning it later would trust whatever an agent wrote there.
  local recorded named=""
  recorded="$(launcher_worktree_git_dir "$repo" "$wt" 2>/dev/null)" || recorded=""
  if [[ -f "${wt}/.git" ]]; then
    named="$(<"${wt}/.git")"
    named="${named%%$'\n'*}"
    named="${named#gitdir: }"
    named="$(cd "$named" 2>/dev/null && pwd -P)" || named=""
  fi
  if [[ -z "$recorded" || "$named" != "$recorded" ]]; then
    printf 'defer\t%s\t%s\n' "$wt" "its .git does not name the repository's own record for it, so it is not reused"
    return 0
  fi
  printf 'reuse\t%s\n' "$wt"
}

# issue_branch_set_aside_artifacts <holder> <dest-root>: before a reused worktree runs a new
# agent, move the previous run's dispatcher files (.agent-summary.md, .review-signals.json,
# .auto-merge-signals.json, .agent.log) to <dest-root>/<holder name>-<UTC stamp>/, outside
# the tree. Otherwise a new run that writes no summary would have the OLD one posted as its
# own, and the old signals would feed the merge gate. Nothing is deleted; the tree's own
# work (commits, modified and untracked files) is left exactly as it is. Prints the
# directory when something was moved; returns 1, moving nothing, when it cannot be made.
issue_branch_set_aside_artifacts() {
  local wt="${1%/}" root="${2%/}" dest f found=()
  for f in .agent-summary.md .review-signals.json .auto-merge-signals.json .agent.log; do
    [[ -e "${wt}/${f}" || -L "${wt}/${f}" ]] && found+=("$f")
  done
  (( ${#found[@]} )) || return 0
  dest="${root}/${wt##*/}-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  if ! mkdir -p "$dest"; then
    echo "issue-branch: could not make '${dest}' to set the previous run's files aside; nothing was moved." >&2
    return 1
  fi
  for f in "${found[@]}"; do
    if ! mv -n -- "${wt}/${f}" "${dest}/${f}"; then
      echo "issue-branch: could not move '${wt}/${f}' to '${dest}'." >&2
      return 1
    fi
  done
  printf '%s\n' "$dest"
}
