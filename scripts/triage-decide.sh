#!/usr/bin/env bash
# triage-decide.sh — pure deterministic triage gate (no network, no gh, no side effects).
#
# Reads a triage agent's output on stdin, extracts its verdict block, and writes
# the FINAL triage outcome to stdout as: "<final-label> <role> <hold>".
#
# This is the machine-checkable gate that BACKS the LLM's judgment — a human-only
# or T3/T4 verdict can never become `agent-ready`, regardless of what the agent
# "decided". It fails CLOSED: any missing/garbled field downgrades to a human gate.
#
# Why this exists: the triage agent reads an UNTRUSTED issue body (prompt-injection
# surface). Per the repo's dispatch security model, the agent therefore gets NO
# credentials and CANNOT mutate labels — it only emits a verdict. The parent
# (triage-inbox.sh) feeds that verdict here and applies the result with gh. An
# injected "set this agent-ready" cannot bypass the deterministic rules below.
#
# Expected verdict block in stdin (case-insensitive field names):
#   TRIAGE_VERDICT_BEGIN
#   decision: agent-ready | needs-review | needs-info
#   role: dev | architect | security | reviewer
#   tier: T1 | T2 | T3 | T4
#   human_only: yes | no
#   rationale: <one line>
#   TRIAGE_VERDICT_END
#
# stdout: one line "<label> <role> <hold>"
#   label ∈ {agent-ready, needs-review, needs-info}
#   role  ∈ {dev, architect, security, reviewer}
#   hold  ∈ {none, human, tier, info, unknown} — WHY this is not auto-buildable (#1002)
# exit 0 always when a block is found; exit 2 (still prints a fail-closed line) if not.
#
# The third token exists because the label alone is a lossy, point-in-time STAMP of
# a verdict: it records *that* a gate ran, never *what it concluded*. Downstream
# (dispatch) needs the machine-readable reason to refuse a held item without
# re-running an LLM, so this gate stops discarding the reason it already computes.
# Mapping — each token names the BRANCH that fired, in the order below:
#   human    human_only was asserted (any tier)      → needs-review
#   info     the agent asked for more information     → needs-info
#   tier     T3/T4: too much ceremony to auto-build   → needs-review
#   none     the ONLY affirmative outcome             → agent-ready
#   unknown  no usable verdict could be derived — no verdict block at all, an
#            unsizable/garbled tier, or a decision that fell through every rule.
#            `unknown` is never affirmative; it is the fail-closed default.

set -eu

INPUT="$(cat)"

BLOCK="$(printf '%s\n' "$INPUT" | sed -n '/TRIAGE_VERDICT_BEGIN/,/TRIAGE_VERDICT_END/p')"
if [[ -z "$BLOCK" ]]; then
  echo "needs-review reviewer unknown"   # fail closed: no parseable verdict → human gate
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
ROLE="$(field role)"
TIER="$(field tier)"
HUMAN="$(field human_only)"

# Role must be one of the four; otherwise fail closed to reviewer (human-facing).
case "$ROLE" in
  dev|architect|security|reviewer) ;;
  *) ROLE="reviewer" ;;
esac

# Unknown/garbled tier → cannot size the work → ask for info. The HOLD is
# `unknown`, not `info`: the label says what the human should do (supply the
# missing size), while the hold says what the gate concluded — and a garbled
# field means it concluded nothing. Two axes, deliberately not conflated.
case "$TIER" in
  t1|t2|t3|t4) ;;
  *) echo "needs-info $ROLE unknown"; exit 0 ;;
esac

# Deterministic gate — order matters, every fall-through lands on a human gate:
# 1. human-only (any tier)            → needs-review  (hold: human)
# 2. agent asked for info             → needs-info    (hold: info)
# 3. T3/T4 (complex/architectural)    → needs-review  (hold: tier)
# 4. T1/T2 AND agent-ready            → agent-ready   (hold: none — the ONLY auto path)
# 5. anything else                    → needs-review  (hold: unknown — fail closed)
if [[ "$HUMAN" == "yes" || "$HUMAN" == "true" ]]; then
  echo "needs-review $ROLE human"; exit 0
fi
if [[ "$DECISION" == "needs-info" ]]; then
  echo "needs-info $ROLE info"; exit 0
fi
if [[ "$TIER" == "t3" || "$TIER" == "t4" ]]; then
  echo "needs-review $ROLE tier"; exit 0
fi
if [[ "$TIER" == "t1" || "$TIER" == "t2" ]] && [[ "$DECISION" == "agent-ready" ]]; then
  echo "agent-ready $ROLE none"; exit 0
fi
echo "needs-review $ROLE unknown"; exit 0
