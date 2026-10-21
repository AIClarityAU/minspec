#!/usr/bin/env bash
# session-scope.sh — the one definition of "has THIS session declared its scope?" (#1914)
#
# WHY THIS FILE EXISTS. scope-check.sh and post-compact.sh both answered that question,
# each with its own copy of `SCOPE_FILE=".claude/.session-scope"`, and both answers were
# wrong in the same three ways (#1914):
#
#   1. A RELATIVE path. `.claude/settings.json:22` locates the hook through
#      $CLAUDE_PROJECT_DIR, but the lookup used the CALLER'S working directory, so one
#      session got opposite verdicts from the repo root and from a subdirectory.
#   2. UNTRACKED, so it cannot exist in a freshly created worktree. Dispatched agents run
#      `claude -p` in `git worktree add ... origin/main` trees (dispatch-issue.sh:703) with
#      project hooks deliberately loaded (agent-context.sh), so every headless run was told
#      to write a file that `.gitignore:24` (`.claude/*`) guarantees is absent. `.claude/`
#      is a harness-sensitive path, so the write was then denied.
#   3. SESSION-AGNOSTIC and never expiring. Existence alone counted as "declared", so a
#      107-day-old scope from another session satisfied the check for every session on the
#      checkout, and short-circuited the scope-expansion scan that is the hook's real job.
#
# The substitution underneath all three: a fact about the filesystem under the caller's cwd
# was used as a fact about the session. This file answers the session question instead.
#
# WHERE DECLARATIONS LIVE: $GIT_DIR/minspec/session-scope/<session_id>, one file per session.
#   * $GIT_DIR is per-worktree and never committed, so no .gitignore rule has to hold and a
#     worktree cannot inherit the primary checkout's declaration. session-start.sh already
#     keeps per-worktree state there (`$gitdir/.claude-last-branch`) for the same reason.
#   * It is NOT under `.claude/`, which the harness treats as sensitive - that guard is what
#     denied 24 of the dispatched agents that obeyed the old instruction.
#   * Keyed by session_id, so one session's declaration can never satisfy another's check
#     and a restarted session is not credited with its predecessor's.
#
# shellcheck shell=bash

# Dispatch worktree base. dispatch-issue.sh:22 sets WORKTREE_BASE and exports it onward as
# MINSPEC_LEASE_WORKTREE_BASE (dispatch-issue.sh:618), so a dispatched run hands this hook
# the live value and only the DEFAULT is duplicated here. The literal is pinned against
# dispatch-issue.sh by packages/minspec/tests/scope-check-hook.test.ts so the two copies
# cannot drift apart silently.
MINSPEC_AGENT_WORKTREE_BASE="${MINSPEC_LEASE_WORKTREE_BASE:-/tmp/minspec-agent}"

# scope_parse_envelope <raw-stdin>
# Emits session_id, source and prompt as NUL-terminated fields on stdout. One python3 call.
# The prompt is UNTRUSTED text, so it is never eval'd and never word-split - read it with
# `readarray -d ''`.
scope_parse_envelope() {
  printf '%s' "${1-}" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    d = {}
if not isinstance(d, dict):
    d = {}
for k in ("session_id", "source", "prompt"):
    v = d.get(k, "")
    sys.stdout.write((v if isinstance(v, str) else "") + "\0")
' 2>/dev/null
}

# scope_project_root
# The repo this hook belongs to, NEVER the caller's $PWD (mechanism 1 of #1914).
# $CLAUDE_PROJECT_DIR first, because that is what .claude/settings.json uses to find the
# hook; the script's own location second, which is correct even when the variable is unset
# (a test piping an envelope straight into the hook, for instance).
scope_project_root() {
  if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "${CLAUDE_PROJECT_DIR:-}" ]; then
    (cd "$CLAUDE_PROJECT_DIR" && pwd)
    return 0
  fi
  # This file is <root>/scripts/hooks/lib/session-scope.sh
  (cd "$(dirname "${BASH_SOURCE[0]}")/../../.." 2>/dev/null && pwd)
}

# scope_store_dir <project-root>
scope_store_dir() {
  local root="${1-}" gd=""
  gd=$(git -C "$root" rev-parse --git-dir 2>/dev/null) || gd=""
  if [ -n "$gd" ]; then
    case "$gd" in
      /*) : ;;
      *) gd="$root/$gd" ;;
    esac
    printf '%s' "$gd/minspec/session-scope"
  else
    # No git dir (a bare copy of the hooks, say). Still per-user and never in the repo.
    printf '%s' "${TMPDIR:-/tmp}/minspec-session-scope-$(id -u 2>/dev/null || echo 0)"
  fi
}

# scope_session_file <project-root> <session-id>
# Empty output when there is no session id: an unidentifiable turn has no declaration,
# which is the safe direction (an extra reminder is advisory; a false "declared" is #1914).
scope_session_file() {
  local root="${1-}" sid="${2-}"
  [ -n "$sid" ] || return 0
  printf '%s/%s' "$(scope_store_dir "$root")" "$sid"
}

# scope_is_declared <project-root> <session-id>
scope_is_declared() {
  local f
  f="$(scope_session_file "${1-}" "${2-}")"
  [ -n "$f" ] && [ -s "$f" ]
}

# scope_is_headless <project-root> <envelope-source>
# Three independent witnesses, because the one the harness ought to provide is not populated.
#
# MEASURED 2026-09-12 on harness 2.1.263: the UserPromptSubmit envelope schema declares
#   source: ["user","sdk","system","loop_wakeup","schedule_wakeup","poll_event"] .optional()
# with "sdk" documented as the non-interactive `-p` / Agent SDK entrypoint - but a real
# `claude -p` run emits NO `source` key at all. Captured envelope, verbatim:
#   {"session_id":...,"transcript_path":...,"cwd":"/tmp/scope-probe","prompt_id":...,
#    "permission_mode":"default","hook_event_name":"UserPromptSubmit","prompt":"..."}
# So witness 3 below is forward-compatible only; it cannot carry this on its own today.
scope_is_headless() {
  local root="${1-}" src="${2-}"
  # 1. Launcher-set marker. scripts/lib/agent-context.sh stamps it on every headless
  #    `claude -p` this repo launches, and every launcher already expands that array.
  [ "${MINSPEC_HEADLESS_AGENT:-0}" = "1" ] && return 0
  # 2. Structural, needs no launcher to remember anything: a dispatch worktree.
  case "$root" in
    "$MINSPEC_AGENT_WORKTREE_BASE"*) return 0 ;;
  esac
  # 3. Harness-native, if it is ever populated: anything other than a composer submit had
  #    no human typing it, so there is nobody to remind.
  [ -n "$src" ] && [ "$src" != "user" ] && return 0
  return 1
}
