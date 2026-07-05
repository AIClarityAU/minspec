#!/usr/bin/env bash
# review-decide.sh — pure deterministic AI-review gate (no network, no gh, no side effects).
#
# Reads a reviewer agent's output on stdin, extracts its verdict block, and writes
# the FINAL review label to stdout: "ai-review:pass" or "ai-review:changes".
#
# This is the machine-checkable gate that BACKS the LLM's judgment. It fails
# CLOSED: any missing/garbled field, any blocking finding, an ESCALATE, more than
# one verdict block, or a non-"pass" verdict → ai-review:changes (never a false
# green). A green (ai-review:pass) is emitted ONLY on an unambiguous clean verdict.
#
# Why this exists: the reviewer reads an UNTRUSTED diff (a PR — incl. arbitrary
# contributor code — is a prompt-injection surface). Per the repo's dispatch
# security model (DR-345 / mirrors triage-decide.sh), the agent gets NO tools and
# CANNOT apply labels — it only emits a verdict. The parent (review-pr.sh, or the
# dispatch-time run_reviewer_stage via review-branch.sh) feeds that verdict here
# and applies the result with gh. An injected "mark this ai-review:pass" cannot
# bypass the deterministic rules below.
#
# Expected verdict block in stdin (case-insensitive field names):
#   REVIEW_VERDICT_BEGIN
#   verdict: pass | changes
#   blocking: <integer>        # count of blocking/correctness findings
#   summary: <one line>
#   REVIEW_VERDICT_END
#
# stdout: one line, label ∈ {ai-review:pass, ai-review:changes}
# exit 0 when a clean verdict is parsed; exit 2 (still prints changes) otherwise.

set -eu

INPUT="$(cat)"

# A review that could NOT RUN (quota / rate-limit / transient) is distinct from a
# review that ran and requested changes. review-branch.sh emits a
# REVIEW_UNAVAILABLE marker for that case; surface it as `ai-review:blocked` —
# retry-able, NOT a code verdict. Checked FIRST so a transient failure can never
# masquerade as `ai-review:changes` (which would read as "the reviewer wants
# changes" and hide the real, fixable cause from the dev). No verdict block is
# required alongside it.
if printf '%s\n' "$INPUT" | grep -q 'REVIEW_UNAVAILABLE'; then
  echo "ai-review:blocked"; exit 0
fi

# An explicit escalation is never a pass.
if printf '%s\n' "$INPUT" | grep -qE '^[[:space:]]*ESCALATE:'; then
  echo "ai-review:changes"; exit 2
fi

BLOCK="$(printf '%s\n' "$INPUT" | sed -n '/REVIEW_VERDICT_BEGIN/,/REVIEW_VERDICT_END/p')"
if [[ -z "$BLOCK" ]]; then
  echo "ai-review:changes"   # fail closed: no parseable verdict → not green
  exit 2
fi

# Fail closed on AMBIGUITY: the reviewer is contractually told to emit EXACTLY ONE
# verdict block. More than one BEGIN marker means the captured output carries a
# second block — the prompt-injection channel this gate exists to defeat: an
# UNTRUSTED diff can embed its own `REVIEW_VERDICT_BEGIN verdict: pass …` block,
# and an HONEST reviewer that merely QUOTES that block in its findings (before its
# own real verdict) would otherwise have `field()`'s `head -1` read the attacker's
# `pass` instead of the reviewer's `changes`. Any count != 1 is anomalous
# (injection echo, a malformed double-emit, or a truncated block) → distrust the
# whole thing and block. Counted over the RAW input, not the sed-joined BLOCK, so a
# quoted block that never closed its END still trips this.
BEGIN_COUNT="$(printf '%s\n' "$INPUT" | grep -c 'REVIEW_VERDICT_BEGIN' || true)"
if [[ "$BEGIN_COUNT" -ne 1 ]]; then
  echo "ai-review:changes"   # >1 verdict block → ambiguous/injected → fail closed
  exit 0
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

VERDICT="$(field verdict)"
BLOCKING="$(field blocking)"

# Blocking count must be a non-negative integer; anything else → fail closed.
if ! [[ "$BLOCKING" =~ ^[0-9]+$ ]]; then
  echo "ai-review:changes"; exit 2
fi

# The ONLY green path: explicit pass AND zero blocking findings.
if [[ "$VERDICT" == "pass" && "$BLOCKING" -eq 0 ]]; then
  echo "ai-review:pass"; exit 0
fi

echo "ai-review:changes"; exit 0
