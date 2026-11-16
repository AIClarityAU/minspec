#!/usr/bin/env bash
# scope-check.sh — UserPromptSubmit context injection, and ONE blocking check (#2651)
#
# Three responsibilities:
#   1. Tell a session that has lost its panel (#2380) - before anything can exit early
#      - and BLOCK every prompt after its one handover turn while that stays true
#      (#2651: advice alone did not stop an orphaned session from running a full tick).
#   2. Remind a HUMAN if this session has not declared its scope.
#   3. Flag scope-expansion trigger verbs in the prompt (Triage Rule 2).
#
# Responsibility 3 is the one with teeth, and until #1914 it almost never ran: the hook
# returned at the "no scope declared" branch before reaching the scan, and the declaration
# test was wrong three different ways. See scripts/hooks/lib/session-scope.sh for the root
# cause and the storage design. Behaviour is pinned by
# packages/minspec/tests/scope-check-hook.test.ts - this hook fires on every prompt of
# every dispatched agent, so a regression here is a regression in 100% of runs.
#
# Apart from the no-panel block in (1), this hook is ADVISORY: it never blocks a turn.

# Read stdin once — harness provides a JSON envelope with the prompt.
INPUT=$(cat 2>/dev/null || true)

# --- No panel (#2380), one handover turn then BLOCK (#2651) ---
# A session whose panel was replaced at a window reload keeps running, and keeps
# receiving prompts (messages from other sessions, finished background tasks), with
# nobody reading it. On 2026-10-09 one ran that way for 29 minutes and this hook fired
# in it 13 times, the first 24 seconds after the reload. This is where it can be told.
# FIRST, because the branch below exits when no scope file exists, which is most
# sessions. Never fatal; a unit that stopped running says so rather than reading as
# "this session has a panel", and says WHY: its error stream is captured, not
# discarded, and the last line of it is printed. (-W ignore keeps an interpreter
# warning, which is not a failure, out of every prompt.)
#
# session-panel.py's `self` mode exits 2, deliberately, for exactly one decision: this
# session already had its one no-panel turn and its input still has no writer. That
# exit code IS a blocking decision. But python3 ITSELF exits 2 when it cannot open or
# read the script (missing / unreadable file), before the unit runs, so the code alone
# cannot tell a deliberate block from a launcher failure: that would hard-block every
# prompt, attached human sessions included. A block is therefore exit 2 AND the unit's
# own "BLOCKED" banner in its output; exit 2 without it is "did not run" and fails open
# below. A real block must reach the harness unchanged — folding it into that branch
# would silently turn a working block back into the advice-only behaviour #2651 ended.
_PANEL="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)/session-panel.py"
_PANEL_OUT="$(printf '%s' "$INPUT" | python3 -W ignore "$_PANEL" self 2>&1)"
_PANEL_RC=$?
if [ "$_PANEL_RC" -eq 2 ] && printf '%s\n' "$_PANEL_OUT" | grep -q '^⛔ BLOCKED'; then
  # BLOCK: this is a UserPromptSubmit hook, so the harness reads OUR exit code, not
  # the unit's. stderr is what a blocking hook's reason is read from.
  printf '%s\n' "$_PANEL_OUT" >&2
  exit 2
elif [ "$_PANEL_RC" -ne 0 ]; then
  echo "[MinSpec] No-panel check did not run (exit $_PANEL_RC: $_PANEL) — this session would not be told it lost its panel (#2380)."
  _PANEL_WHY="$(printf '%s\n' "$_PANEL_OUT" | grep -v '^[[:space:]]*$' | tail -n 1 | LC_ALL=C tr -cd '[:print:]' | cut -c1-200)"
  if [ -n "$_PANEL_WHY" ]; then
    echo "    Why: $_PANEL_WHY"
  fi
elif [ -n "$_PANEL_OUT" ]; then
  printf '%s\n' "$_PANEL_OUT"
fi
# The lib is only needed from here on. The no-panel block above needs none of it, so a
# missing/unsourceable lib must not disable that one blocking gate (#2651).
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
# shellcheck source=lib/session-scope.sh
if [ ! -r "$HOOK_DIR/lib/session-scope.sh" ]; then
  # Say so rather than going quiet: a hook that degrades in silence is indistinguishable
  # from a hook with nothing to report, which is the failure this whole issue is about.
  echo "[MinSpec] scope-check: scripts/hooks/lib/session-scope.sh is missing, skipping."
  exit 0
fi
. "$HOOK_DIR/lib/session-scope.sh" || exit 0

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
