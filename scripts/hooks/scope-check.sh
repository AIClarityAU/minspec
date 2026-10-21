#!/usr/bin/env bash
# scope-check.sh — non-blocking UserPromptSubmit context injection
#
# Two responsibilities:
#   1. Remind a HUMAN if this session has not declared its scope.
#   2. Flag scope-expansion trigger verbs in the prompt (Triage Rule 2).
#
# Responsibility 2 is the one with teeth, and until #1914 it almost never ran: the hook
# returned at the "no scope declared" branch before reaching the scan, and the declaration
# test was wrong three different ways. See scripts/hooks/lib/session-scope.sh for the root
# cause and the storage design. Behaviour is pinned by
# packages/minspec/tests/scope-check-hook.test.ts - this hook fires on every prompt of
# every dispatched agent, so a regression here is a regression in 100% of runs.
#
# This hook is ADVISORY. It never blocks a turn and always exits 0.

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
# shellcheck source=lib/session-scope.sh
if [ ! -r "$HOOK_DIR/lib/session-scope.sh" ]; then
  # Say so rather than going quiet: a hook that degrades in silence is indistinguishable
  # from a hook with nothing to report, which is the failure this whole issue is about.
  echo "[MinSpec] scope-check: scripts/hooks/lib/session-scope.sh is missing, skipping."
  exit 0
fi
. "$HOOK_DIR/lib/session-scope.sh" || exit 0

# Read stdin once — harness provides a JSON envelope with the prompt.
INPUT=$(cat 2>/dev/null || true)

# Process substitution, never `$(...)`: command substitution DROPS NUL bytes, which would
# splice the three fields into one and put the whole prompt in $SESSION_ID.
FIELDS=()
readarray -d '' -t FIELDS < <(scope_parse_envelope "$INPUT") 2>/dev/null || FIELDS=()
SESSION_ID="${FIELDS[0]:-}"
SRC="${FIELDS[1]:-}"
PROMPT="${FIELDS[2]:-}"

# Fall back to raw stdin if JSON parse yielded nothing (older harness behaviour).
if [ -z "$PROMPT" ]; then
  PROMPT="$INPUT"
fi

ROOT="$(scope_project_root)"

# A headless agent has no human to remind and no way to declare anything: the scope file is
# untracked, so its fresh worktree can never hold one. Measured before this guard existed:
# 149 of 149 drain transcripts carried the reminder, 30 agents acted on it, 24 of those hit a
# sensitive-file permission denial (#1914). Silent, and no scan either — the "prompt" there
# is a machine-built brief quoting an untrusted issue body, so scanning it for "also add"
# would warn on the issue's own words.
if scope_is_headless "$ROOT" "$SRC"; then
  exit 0
fi

# Skip the trigger scan for very short prompts (one-word replies, "y", "ok", etc).
if [ "${#PROMPT}" -ge 12 ]; then
  PROMPT_LOWER=$(printf '%s' "$PROMPT" | tr '[:upper:]' '[:lower:]')

  # Trigger verbs/phrases that often signal scope expansion beyond declared work.
  # Patterns are extended-regex fragments.
  TRIGGERS=(
    "integrate with"
    "integration with"
    "also support"
    "also add"
    "and also"
    "include .{1,40} too"
    "expand to"
    "extend to"
    "make it work with"
    "while you're at it"
    "\+ any other"
    "what other"
  )

  MATCHED=()
  for trig in "${TRIGGERS[@]}"; do
    if printf '%s' "$PROMPT_LOWER" | grep -qE "$trig"; then
      MATCHED+=("$trig")
    fi
  done

  # Runs whether or not a scope was declared. Before #1914 an undeclared session skipped
  # this entirely, which inverted the hook: the sessions least likely to have a scope in
  # mind were the only ones never warned about expanding it.
  if [ ${#MATCHED[@]} -gt 0 ]; then
    echo "[MinSpec] Scope-expansion trigger(s): ${MATCHED[*]}"
    echo "[MinSpec] Per CLAUDE.md Triage Rules 2-3: confirm in-scope OR park as issue. Detection ≠ integration."
  fi
fi

if ! scope_is_declared "$ROOT" "$SESSION_ID"; then
  SCOPE_FILE="$(scope_session_file "$ROOT" "$SESSION_ID")"
  echo "[MinSpec] No scope declared for THIS session."
  if [ -n "$SCOPE_FILE" ]; then
    echo "[MinSpec] Declare it - edit the sentence, then run the line:"
    echo "[MinSpec]   mkdir -p '$(dirname "$SCOPE_FILE")' && echo 'scope: <one sentence>' > '$SCOPE_FILE'"
  fi
fi

exit 0
