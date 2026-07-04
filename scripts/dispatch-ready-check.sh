#!/usr/bin/env bash
# dispatch-ready-check.sh — pure deterministic dispatch-readiness gate (#406).
#
# `agent-ready` is stamped ONCE at triage and then never re-checked. Between the
# drain ENUMERATING the agent-ready issues and the dispatcher actually LAUNCHING one
# (the drain processes issues sequentially, so a slow earlier build defers later
# ones by many minutes), the issue may have been closed, re-triaged to needs-review,
# or quarantined. Dispatching on that stale point-in-time stamp builds a
# no-longer-ready issue. This gate re-validates the issue's CURRENT state at
# dispatch time, deterministically.
#
# Usage:
#   dispatch-ready-check.sh <state> <labels-csv>
#     <state>       the issue's CURRENT state from `gh issue view --json state`
#                   (OPEN | CLOSED, case-insensitive).
#     <labels-csv>  the issue's CURRENT labels, comma-separated (label NAMES).
#                   May legitimately be empty (an issue with no labels).
#
# Exit 0  → STILL DISPATCHABLE: state is OPEN, `agent-ready` is present, and no
#           human-gate label countermands it. Prints "ready".
# Exit 1  → NOT DISPATCHABLE (stale): closed, `agent-ready` gone, or a human-gate
#           label (needs-review/needs-info/needs-human-review/agent-quarantined) was
#           added after triage. Prints a one-line reason to stdout.
#
# DESIGN — only abort on CLEAR staleness signals so valid work is NEVER falsely
# aborted (the #406 invariant): we REQUIRE open + agent-ready, and additionally
# refuse when a label that explicitly means "a human must look at this" is present
# — a contradictory {agent-ready + needs-review} state (e.g. a re-triage that added
# the human gate without stripping agent-ready) resolves to "hold for a human",
# which is the safe direction.
#
# SCOPE (in a comment here and in the dispatcher): this closes the label/open-state
# staleness cases only. Full dependency-graph freshness — re-checking that a linked
# SPEC's status is >= the phase this work needs, or that a linked DR is still
# `accepted` — is the architect-flagged follow-up and is OUT OF SCOPE here.
#
# PURE: no gh/git/network/side-effects, so it is unit-testable in isolation
# (tests/dispatch-ready-check.test.ts) and the dispatcher does the credentialed
# `gh issue view` itself, exactly as triage/review split fetch from decision.

set -uo pipefail

STATE="${1:?usage: dispatch-ready-check.sh <state> <labels-csv>}"
LABELS_CSV="${2-}"   # optional: an issue may have zero labels

# Normalise state; gh emits OPEN | CLOSED.
state_uc="$(printf '%s' "$STATE" | tr '[:lower:]' '[:upper:]' | tr -d '[:space:]')"

# Exact (whole-label) membership test over the comma-separated set. `grep -Fxq`
# so a label like `agent-ready-later` can never satisfy a check for `agent-ready`.
has_label() {
  printf '%s' "$LABELS_CSV" \
    | tr ',' '\n' \
    | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' \
    | grep -Fxq -- "$1"
}

if [[ "$state_uc" != "OPEN" ]]; then
  echo "not-ready: issue state is '${STATE}', not OPEN"
  exit 1
fi

if ! has_label "agent-ready"; then
  echo "not-ready: 'agent-ready' label no longer present"
  exit 1
fi

# Any explicit human-gate / quarantine label countermands a lingering agent-ready.
for gate in needs-review needs-info needs-human-review agent-quarantined; do
  if has_label "$gate"; then
    echo "not-ready: countermanding label '${gate}' present (re-triaged / quarantined since drain)"
    exit 1
  fi
done

echo "ready"
exit 0
