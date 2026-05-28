#!/usr/bin/env bash
# scope-check.sh — non-blocking UserPromptSubmit context injection
#
# Two responsibilities:
#   1. Remind if no session scope is declared.
#   2. Flag scope-expansion trigger verbs in the prompt (Triage Rule 2).

SCOPE_FILE=".claude/.session-scope"

# Read stdin once — harness provides JSON envelope with the prompt.
INPUT=$(cat 2>/dev/null || true)
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
