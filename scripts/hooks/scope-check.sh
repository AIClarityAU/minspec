#!/usr/bin/env bash
# scope-check.sh — UserPromptSubmit context injection, and ONE blocking check (#2651)
#
# Three responsibilities:
#   1. Tell a session that has lost its panel (#2380) — before anything can exit early
#      — and BLOCK every prompt after its one handover turn while that stays true
#      (#2651: advice alone did not stop an orphaned session from running a full tick).
#   2. Remind if no session scope is declared.
#   3. Flag scope-expansion trigger verbs in the prompt (Triage Rule 2).

SCOPE_FILE=".claude/.session-scope"

# Read stdin once — harness provides JSON envelope with the prompt.
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
# exit code IS a blocking decision, and it is never otherwise produced (every other
# failure inside the unit is caught and reported as exit 0, so a non-zero, non-2 exit
# here always means the unit itself did not run). Exit 2 must reach the harness
# unchanged — folding it into the "did not run" branch below would silently turn a
# working block back into the advice-only behaviour #2651 was filed to end.
_PANEL="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)/session-panel.py"
_PANEL_OUT="$(printf '%s' "$INPUT" | python3 -W ignore "$_PANEL" self 2>&1)"
_PANEL_RC=$?
if [ "$_PANEL_RC" -eq 2 ]; then
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
PROMPT=$(printf '%s' "$INPUT" | python3 -c "import json,sys
try:
    print(json.load(sys.stdin).get('prompt',''), end='')
except Exception:
    pass" 2>/dev/null)

# Fall back to raw stdin if JSON parse yielded nothing (older harness behaviour).
if [ -z "$PROMPT" ]; then
  PROMPT="$INPUT"
fi

if [ ! -f "$SCOPE_FILE" ]; then
  echo "[MinSpec] No scope declared. Run: echo 'scope: ...' > .claude/.session-scope"
  exit 0
fi

# Skip trigger scan for very short prompts (one-word replies, "y", "ok", etc).
if [ "${#PROMPT}" -lt 12 ]; then
  exit 0
fi

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

if [ ${#MATCHED[@]} -gt 0 ]; then
  echo "[MinSpec] Scope-expansion trigger(s): ${MATCHED[*]}"
  echo "[MinSpec] Per CLAUDE.md Triage Rules 2-3: confirm in-scope OR park as issue. Detection ≠ integration."
fi

exit 0
