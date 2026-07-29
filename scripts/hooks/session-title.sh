#!/usr/bin/env bash
# session-title.sh — UserPromptSubmit wrapper for session-title.py
#
# Thin wrapper, matching spec-gate.sh: the real logic lives in the .py so the
# JSON envelope on stdin reaches it cleanly (a `python3 - <<HEREDOC` form would
# steal stdin).
#
# Opt out for a session with MINSPEC_SESSION_TITLE_OFF=1.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "${MINSPEC_SESSION_TITLE_OFF:-0}" = "1" ]; then
  exit 0
fi

# Fail open if python3 is unavailable — a cosmetic title never blocks a turn.
if ! command -v python3 >/dev/null 2>&1; then
  exit 0
fi

exec python3 "$HERE/session-title.py"
