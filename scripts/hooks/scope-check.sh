#!/usr/bin/env bash
# scope-check.sh — non-blocking UserPromptSubmit context injection
#
# Three responsibilities:
#   1. Tell a session that has lost its panel (#2380) — before anything can exit early.
#   2. Remind if no session scope is declared.
#   3. Flag scope-expansion trigger verbs in the prompt (Triage Rule 2).

SCOPE_FILE=".claude/.session-scope"

# Read stdin once — harness provides JSON envelope with the prompt.
INPUT=$(cat 2>/dev/null || true)

# --- No panel (#2380) ---
# A session whose panel was replaced at a window reload keeps running, and keeps
# receiving prompts (messages from other sessions, finished background tasks), with
# nobody reading it. On 2026-10-09 one ran that way for 29 minutes and this hook fired
# in it 13 times, the first 24 seconds after the reload. This is where it can be told.
# FIRST, because the branch below exits when no scope file exists, which is most
# sessions. Never fatal; a unit that stopped running says so in one line rather than
# reading as "this session has a panel".
_PANEL="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)/session-panel.py"
_PANEL_OUT="$(printf '%s' "$INPUT" | python3 "$_PANEL" self 2>/dev/null)"
_PANEL_RC=$?
if [ "$_PANEL_RC" -ne 0 ]; then
  echo "[MinSpec] No-panel check did not run (exit $_PANEL_RC: $_PANEL) — this session would not be told it lost its panel (#2380)."
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
