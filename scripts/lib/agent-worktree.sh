#!/usr/bin/env bash
# scripts/lib/agent-worktree.sh - how a launcher touches a worktree an agent has worked in.
#
# Sourced by the launchers that give an agent a worktree and then act on it themselves,
# scripts/dispatch-issue.sh and scripts/remediate-pr.sh, and by scripts/drain-inbox.sh,
# which runs git in every checkout the repository has on record.
#
# ── Why this exists ───────────────────────────────────────────────────────────
# An agent is started with an environment built from a list of names
# (lib/agent-context.sh), so it is not handed the token its launcher writes with. That is
# a statement about the AGENT's process. The launcher still holds the token, and after the
# agent exits the launcher goes back into the same directory to finish the job: it pushes
# the branch, rebases it, re-runs the checks, asks a reviewer. Whatever in that directory
# the launcher RUNS at that point runs as the launcher, with the launcher's environment,
# and every file in the directory is one the agent could have edited. Three ways it did:
#
#   git hooks      This repository sets `core.hooksPath` to the relative `.githooks`, and
#                  git resolves a relative hooks path against the tree it is working in.
#                  So `git -C <worktree> push` ran the worktree's own `.githooks/pre-push`,
#                  and a rebase, a merge, a checkout or a fetch ran whichever hook of
#                  theirs was there.
#   git itself     A worktree's `.git` is a file naming the directory git should use. An
#                  agent that rewrites it chooses the configuration every later
#                  `git -C <worktree>` reads, and git configuration names programs to run.
#   the checks     `npm test`, `npm run lint`, `npm run build` and `npm run validate` are
#                  the worktree's own code by definition, and `npx` resolves a tool from
#                  the directory it is run in.
#
# ── What a launcher does instead ──────────────────────────────────────────────
#   launcher_git        git in the launcher's OWN repository, for the operations that make
#                       or remove a worktree. Hooks come from the launcher's tree.
#   agent_worktree_pin  called once, straight after the worktree is made and before any
#                       agent runs in it: remembers which git directory is this worktree's.
#   agent_worktree_git  every later git operation on that worktree. It names the
#                       remembered git directory outright, so the worktree's `.git` file is
#                       never consulted, and takes its hooks from the launcher's tree.
#   agent_worktree_trusted  a program from the launcher's own tree that has to run IN the
#                       worktree and calls git for itself (the reviewers). Its git is
#                       pointed at the remembered git directory, and at the launcher's
#                       hooks, through the environment.
#   agent_worktree_function  the same for one of the launcher's own shell functions (the
#                       pre-publish scan).
#   launcher_worktree_git  git on a worktree this script did NOT make, and so could not
#                       pin when it was new: scripts/drain-inbox.sh visits every checkout
#                       the repository lists, agents' worktrees among them. The git
#                       directory comes from the repository's own record of the worktree.
#
# And the worktree's own code (its tests, its build) is run the way the agent itself was:
# `bash "$AGENT_LAUNCH_ENV" <command>`, the environment allowlist of lib/agent-context.sh,
# after `cd` into the worktree. A tool the launcher needs there is named by an absolute
# path in the launcher's own tree, never looked up from the worktree with `npx`.
#
# HOOKS ARE PINNED, NOT TURNED OFF. One of them is a gate: `.githooks/pre-push` refuses a
# push that changes CI workflow files when the pushing credential cannot (#1120). It still
# runs on every launcher push, from the launcher's tree, where it reads its own library by
# its own path. (`commit-msg` and `pre-commit` are gates on a COMMIT. No launcher commits
# in an agent's worktree; the merge remediate-pr.sh makes runs `commit-msg`, which reads
# the message and nothing else. `pre-commit` runs the worktree's `npm run validate` with
# whatever environment the commit has, so a launcher must not start committing there.)
#
# ── What this does not do ─────────────────────────────────────────────────────
# It is about what the launcher EXECUTES out of the worktree. It does not confine the
# agent: an agent runs the project's build, as the launcher's user, and a process of that
# user can write outside its worktree, including to the launcher's own tree and to the git
# directory remembered here. Nothing in a shell script can stop that; a separate user or a
# sandbox can. And it does not make a check's RESULT trustworthy: an agent that rewrites
# the test script gets the answer it wrote, here as in CI.
#
# Enforced by packages/minspec/tests/agent-worktree-trust.test.ts, which plants a file at
# each of these places in a real worktree and reads what the launcher let it see, and by
# the enumerating gate in agent-launch-sites.test.ts.

# shellcheck shell=bash

# The launcher's own hooks, by absolute path: the directory beside the `scripts/` this
# file is in. A path that does not exist means no hook runs, never the worktree's.
AGENT_TRUSTED_HOOKS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.githooks"

# The worktree a launcher has pinned, and the git directory that is its own. Empty until
# agent_worktree_pin succeeds. Assigned here, unconditionally, so a value that arrived in
# the environment never survives to be used.
AGENT_WORKTREE=""
AGENT_WORKTREE_GIT_DIR=""

# launcher_git <git arguments>: git in the launcher's own repository.
launcher_git() {
  git -c "core.hooksPath=${AGENT_TRUSTED_HOOKS}" "$@"
}

# launcher_worktree_git_dir <repository> <worktree>: the git directory the REPOSITORY
# has on record for one of its worktrees. For a script that did not make the worktree and
# so could not pin it when it was new (the drain, which visits every checkout the
# repository lists): the answer comes from the repository's own records, under its own
# git directory, and never from the worktree's `.git` file. Prints nothing, and returns
# 1, for a directory the repository has no record of.
launcher_worktree_git_dir() {
  local repo="${1-}" worktree="${2-}" common admin recorded
  common="$(git -C "$repo" rev-parse --git-common-dir 2>/dev/null)" || return 1
  [[ "$common" == /* ]] || common="${repo%/}/${common}"
  common="$(cd "$common" 2>/dev/null && pwd -P)" || return 1
  worktree="$(cd "$worktree" 2>/dev/null && pwd -P)" || return 1
  # The repository's first checkout: its git directory is the repository's own.
  if [[ "${common##*/}" == ".git" && "${common%/.git}" == "$worktree" ]]; then
    printf '%s\n' "$common"
    return 0
  fi
  # Every other one has a directory under worktrees/, whose `gitdir` file names the
  # worktree's `.git` file. That record is the repository's, written when the worktree
  # was made.
  for admin in "$common"/worktrees/*/; do
    [[ -f "${admin}gitdir" ]] || continue
    recorded="$(<"${admin}gitdir")"
    recorded="$(cd "${recorded%/.git}" 2>/dev/null && pwd -P)" || continue
    if [[ "$recorded" == "$worktree" ]]; then
      printf '%s\n' "${admin%/}"
      return 0
    fi
  done
  return 1
}

# launcher_worktree_git <repository> <worktree> <git arguments>: git on one of the
# repository's worktrees, with the git directory taken from the repository's records
# (launcher_worktree_git_dir) and the launcher's hooks. Runs nothing, and returns 1, for
# a directory the repository has no record of.
launcher_worktree_git() {
  local repo="${1-}" worktree="${2-}" git_dir
  if (( $# < 2 )); then
    echo "agent-worktree: launcher_worktree_git needs a repository and a worktree." >&2
    return 1
  fi
  shift 2
  if ! git_dir="$(launcher_worktree_git_dir "$repo" "$worktree")" || [[ -z "$git_dir" ]]; then
    echo "agent-worktree: '${repo}' has no record of a worktree at '${worktree}', so git was not run there." >&2
    return 1
  fi
  git -C "$worktree" --git-dir="$git_dir" --work-tree="$worktree" \
      -c "core.hooksPath=${AGENT_TRUSTED_HOOKS}" "$@"
}

# agent_worktree_pin <worktree>: remember which git directory belongs to this worktree.
#
# Call it straight after `worktree add`, before any agent has run there: that is the one
# moment the worktree's `.git` file is known to be what git itself wrote. Refuses, and
# leaves nothing pinned, when the answer is not an existing directory OUTSIDE the worktree
# (one inside it is one an agent can rewrite).
agent_worktree_pin() {
  local worktree="${1-}" resolved git_dir
  AGENT_WORKTREE=""
  AGENT_WORKTREE_GIT_DIR=""
  if [[ -z "$worktree" || ! -d "$worktree" ]]; then
    echo "agent-worktree: there is no worktree at '${worktree}' to pin. Nothing was pinned." >&2
    return 1
  fi
  resolved="$(cd "$worktree" && pwd -P)" || resolved=""
  git_dir="$(git -C "$worktree" rev-parse --absolute-git-dir 2>/dev/null)" || git_dir=""
  if [[ -z "$resolved" || "$git_dir" != /* || ! -d "$git_dir" ]]; then
    echo "agent-worktree: git could not say which directory is the git directory of '${worktree}'. Nothing was pinned." >&2
    return 1
  fi
  git_dir="$(cd "$git_dir" && pwd -P)" || git_dir=""
  case "${git_dir}/" in
    ""|/|"${resolved}"/*)
      echo "agent-worktree: the git directory of '${worktree}' is inside the worktree itself, where an agent can rewrite it. Nothing was pinned." >&2
      return 1 ;;
  esac
  AGENT_WORKTREE="$resolved"
  AGENT_WORKTREE_GIT_DIR="$git_dir"
}

# Is a worktree pinned? Says so, and returns 1, when it is not: an operation on a
# worktree that was never pinned is not run at all.
_agent_worktree_pinned() {
  if [[ -z "$AGENT_WORKTREE" || -z "$AGENT_WORKTREE_GIT_DIR" ]]; then
    echo "agent-worktree: no worktree is pinned (agent_worktree_pin was not called, or it refused), so nothing was run on one." >&2
    return 1
  fi
}

# agent_worktree_git <git arguments>: git on the pinned worktree.
agent_worktree_git() {
  _agent_worktree_pinned || return 1
  git -C "$AGENT_WORKTREE" \
      --git-dir="$AGENT_WORKTREE_GIT_DIR" --work-tree="$AGENT_WORKTREE" \
      -c "core.hooksPath=${AGENT_TRUSTED_HOOKS}" "$@"
}

# Point every git started from here on at the pinned git directory and the launcher's
# hooks, through the environment: the hooks as one more entry on the end of whatever git
# configuration the environment already carries. It exports, so it is only ever called
# inside the subshell of the two functions below.
_agent_worktree_export_pins() {
  local count="${GIT_CONFIG_COUNT:-0}"
  [[ "$count" =~ ^[0-9]+$ ]] || count=0
  export GIT_DIR="$AGENT_WORKTREE_GIT_DIR"
  export GIT_WORK_TREE="$AGENT_WORKTREE"
  export "GIT_CONFIG_KEY_${count}=core.hooksPath"
  export "GIT_CONFIG_VALUE_${count}=${AGENT_TRUSTED_HOOKS}"
  export GIT_CONFIG_COUNT="$(( count + 1 ))"
}

# agent_worktree_trusted <program> [arguments]: run a program from the launcher's own
# tree in the worktree. The program must be named by an absolute path, which is how a
# launcher names its own files; a bare name would be looked up, and a relative one would
# be the worktree's. Any git it calls uses the pinned git directory and the launcher's
# hooks.
agent_worktree_trusted() {
  _agent_worktree_pinned || return 1
  if [[ "${1-}" != /* ]]; then
    echo "agent-worktree: '${1-}' is not an absolute path, so it was not run in the worktree as a trusted program." >&2
    return 1
  fi
  ( _agent_worktree_export_pins && cd "$AGENT_WORKTREE" && "$@" )
}

# agent_worktree_function <function> [arguments]: call one of the launcher's own shell
# functions that runs git on the worktree for itself (the pre-publish scan of
# lib/agent-egress.sh). It must be a function this shell has defined: a program is run
# with agent_worktree_trusted instead. Its git uses the pinned git directory and the
# launcher's hooks. It runs in a subshell, so it can answer on stdout and by its status
# and cannot set a variable for its caller.
agent_worktree_function() {
  _agent_worktree_pinned || return 1
  if [[ "$(type -t "${1-}" 2>/dev/null)" != "function" ]]; then
    echo "agent-worktree: '${1-}' is not a shell function of this launcher, so it was not called." >&2
    return 1
  fi
  ( _agent_worktree_export_pins && "$@" )
}
