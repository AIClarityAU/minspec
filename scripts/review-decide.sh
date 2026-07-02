#!/usr/bin/env bash
# review-decide.sh — pure deterministic reviewer gate (no network, no gh, no side effects).
#
# Reads a reviewer agent's output on stdin, extracts its REVIEW_VERDICT block,
# and writes the FINAL review outcome to stdout as a single line:
#
#     "<decision> <severity>"
#
# where <decision> ∈ {approve, request-changes} and <severity> ∈
# {none, low, medium, high, critical, unknown}. A caller parses field 1 for the
# gate (approve|request-changes) and MAY use field 2 for reporting.
#
# It FAILS CLOSED: any missing / garbled / unparseable verdict → "request-changes
# <severity>", NEVER "approve". This is the machine-checkable gate that BACKS the
# LLM reviewer — the reviewer reads an UNTRUSTED diff (prompt-injection surface),
# so an injected "decision: approve" it was tricked into emitting can never bypass
# the rules here; an unparseable/partially-corrupt verdict downgrades to
# request-changes. Mirrors triage-decide.sh in structure and philosophy.
#
# Expected verdict block in stdin (case-insensitive field names):
#   REVIEW_VERDICT_BEGIN
#   decision: approve | request-changes
#   severity: none | low | medium | high | critical
#   findings: <file:line — finding>   (zero or more lines)
#   rationale: <one line>
#   REVIEW_VERDICT_END
#
# stdout: one line "<decision> <severity>".
# exit 0 when a block is found (well-formed OR present-but-garbled);
# exit 2 (still prints a fail-closed "request-changes unknown" line) when the
#        block is entirely missing — mirroring triage-decide.sh's exit-2-on-missing.

set -eu

INPUT="$(cat)"

BLOCK="$(printf '%s\n' "$INPUT" | sed -n '/REVIEW_VERDICT_BEGIN/,/REVIEW_VERDICT_END/p')"
if [[ -z "$BLOCK" ]]; then
  echo "request-changes unknown"   # fail closed: no parseable verdict → block merge
  exit 2
fi

# Extract a single field value, lowercased and trimmed; empty if absent.
field() {
  printf '%s\n' "$BLOCK" \
    | { grep -iE "^[[:space:]]*$1[[:space:]]*:" || true; } \
    | head -1 \
    | sed -E "s/^[^:]*:[[:space:]]*//" \
    | tr -d '\r' \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'
}

DECISION="$(field decision)"
SEVERITY="$(field severity)"

# Severity must be one of the five; otherwise mark unknown (recorded, not trusted).
SEV_OK=0
case "$SEVERITY" in
  none|low|medium|high|critical) SEV_OK=1 ;;
  *) SEVERITY="unknown" ;;
esac

# Fail-closed decision gate. An "approve" is honored ONLY when the WHOLE verdict
# is well-formed (valid decision AND valid severity) — a corrupt severity on an
# otherwise-"approve" verdict is treated as evidence the block did not render
# cleanly, so the approve is distrusted (downgraded to request-changes). Any
# other decision (request-changes, missing, garbled) → request-changes.
case "$DECISION" in
  approve)
    if [[ "$SEV_OK" -eq 1 ]]; then
      echo "approve $SEVERITY"; exit 0
    else
      echo "request-changes $SEVERITY"; exit 0   # garbled severity → distrust the approve
    fi
    ;;
  request-changes)
    echo "request-changes $SEVERITY"; exit 0
    ;;
  *)
    echo "request-changes $SEVERITY"; exit 0      # missing/garbled decision → fail closed
    ;;
esac
