#!/usr/bin/env bash
# spec-gate.sh — PreToolUse HITL gate wrapper (DR-362)
#
# Thin wrapper around spec-gate.py:
#   - honours the MINSPEC_GATE_OFF=1 kill-switch (escape hatch)
#   - pipes the hook envelope (stdin) straight through to the Python gate
#
# The real decision logic lives in spec-gate.py so the JSON envelope on stdin
# reaches it cleanly (a `python3 - <<HEREDOC` form would steal stdin). See
# DR-362 for the enforcement rationale.

set -uo pipefail

# Kill-switch — explicit escape hatch. Emit nothing → normal permission flow.
if [ "${MINSPEC_GATE_OFF:-0}" = "1" ]; then
  exit 0
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Fail open if python3 is unavailable — never block on a missing interpreter.
if ! command -v python3 >/dev/null 2>&1; then
  exit 0
fi

exec python3 "$HERE/spec-gate.py"
