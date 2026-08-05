#!/usr/bin/env bash
# triage-decide.sh — pure deterministic triage gate (no network, no gh, no side effects).
#
# Reads a triage agent's output on stdin, extracts its verdict block, and writes
# the FINAL triage outcome to stdout as: "<final-label> <role> <hold>".
#
# This is the machine-checkable gate that BACKS the LLM's judgment — a human-only
# or T3/T4 verdict can never become plain `agent-ready`, regardless of what the agent
# "decided". It fails CLOSED: any missing/garbled field downgrades to a human gate.
#
# ── #1169 / DR-076: T3/T4 auto-buildable now dispatches SPECIFY-ONLY ──────────
# DR-076 keeps exactly one review-shaped human moment: reading a T3/T4 SPEC before
# anything is built from it. This gate used to spend a DIFFERENT one first — every
# T3/T4 landed on `needs-review` (hold `tier`), so the human read the RAW ISSUE
# before an agent could even write that spec, and then read the spec anyway at the
# approval gate. Two human reads where the accepted decision funds one, and the
# raw-issue read is the lower-leverage of the two: an unrefined issue body is
# exactly the artifact the Specify phase exists to turn into something worth human
# attention.
#
# So an auto-buildable, non-human-only T3/T4 now resolves to `agent-ready-specify`
# (hold `specify`) — dispatchable for the SPECIFY PHASE ONLY. Nothing about the
# IMPLEMENT path moved: plain `agent-ready` is still reachable from T1/T2 alone,
# and building from a T3/T4 spec still waits on the human's spec approval.
#
# The class is DERIVED HERE from `tier`; the agent's input vocabulary is UNCHANGED
# (`agent-ready | needs-review | needs-info`). That is deliberate — the agent reads
# an untrusted issue body, so an injected "give me a specify dispatch" must not be
# expressible. It also means the affirmative decision is still a single token, so
# the agent cannot half-authorise anything.
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
#   label ∈ {agent-ready, agent-ready-specify, needs-review, needs-info}
#   role  ∈ {dev, architect, security, reviewer}
#   hold  ∈ {none, specify, human, tier, info, unknown} — WHY this is not fully
#           auto-buildable (#1002, extended #1169)
# exit 0 always when a block is found; exit 2 (still prints a fail-closed line) if not.
#
# `--fields` prints the SAME decision as key=value lines instead of one space-joined
# line, adding the two NORMALISED inputs the verdict record must carry for audit:
#   label=… role=… hold=… tier=<T1|T2|T3|T4|unknown> human_only=<yes|no>
# Same code path, same exit codes — only the projection differs. It exists so the
# record written by triage-inbox.sh carries THIS gate's normalised view of tier /
# human_only rather than a second, hand-rolled re-parse of the agent's raw text
# (two parsers of one format is how a gate and its record start disagreeing).
#
# The third token exists because the label alone is a lossy, point-in-time STAMP of
# a verdict: it records *that* a gate ran, never *what it concluded*. Downstream
# (dispatch) needs the machine-readable reason to refuse a held item without
# re-running an LLM, so this gate stops discarding the reason it already computes.
# Mapping — each token names the BRANCH that fired, in the order below:
#   human    human_only was asserted (any tier)      → needs-review
#   info     the agent asked for more information     → needs-info
#   specify  T3/T4 auto-buildable: the SPEC may be    → agent-ready-specify
#            written now; implementation stays held
#            until the human approves that spec
#   tier     T3/T4 the agent did NOT call            → needs-review
#            auto-buildable — too much ceremony,
#            a human reads it (the pre-#1169 T3/T4 outcome, now the residue)
#   none     the ONLY unrestricted affirmative       → agent-ready
#   unknown  no usable verdict could be derived — no verdict block at all, an
#            unsizable/garbled tier, or a decision that fell through every rule.
#            `unknown` is never affirmative; it is the fail-closed default.
#
# Label and hold are LOCKED IN PAIRS, and the pairs never cross:
#   agent-ready          goes with none, and only none       (full build authorised)
#   agent-ready-specify  goes with specify, and only specify  (spec authorised;
#                                                              implementation is not)
# Downstream reads the HOLD, not the label (#983: a label is a stamp of a verdict,
# never the verdict), so a crossed pair would hand two readers two authorities.

set -eu

MODE="line"
if [[ "${1:-}" == "--fields" ]]; then
  MODE="fields"
fi

# The two normalised inputs the decision is derived FROM, carried alongside the
# outcome so a verdict record can state them. Initialised to the fail-closed values
# so every early exit below still emits a complete, honest set.
TIER_OUT="unknown"
HUMAN_OUT="no"

# emit <label> <role> <hold> — the single place either projection is written, so the
# two output shapes can never describe different decisions.
emit() {
  if [[ "$MODE" == "fields" ]]; then
    printf 'label=%s\nrole=%s\nhold=%s\ntier=%s\nhuman_only=%s\n' \
      "$1" "$2" "$3" "$TIER_OUT" "$HUMAN_OUT"
  else
    printf '%s %s %s\n' "$1" "$2" "$3"
  fi
}

INPUT="$(cat)"

BLOCK="$(printf '%s\n' "$INPUT" | sed -n '/TRIAGE_VERDICT_BEGIN/,/TRIAGE_VERDICT_END/p')"
if [[ -z "$BLOCK" ]]; then
  emit needs-review reviewer unknown   # fail closed: no parseable verdict → human gate
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
  t1|t2|t3|t4) TIER_OUT="$(printf '%s' "$TIER" | tr '[:lower:]' '[:upper:]')" ;;
  *) emit needs-info "$ROLE" unknown; exit 0 ;;
esac

# Normalised human_only, carried into the record. Note the asymmetry is deliberate:
# only an explicit yes/true asserts human-only, and everything else (including a
# missing field) reads as `no` — because the AFFIRMATIVE path is gated by `hold`,
# which fails closed on its own. A missing human_only can therefore never turn a
# held verdict into a buildable one.
if [[ "$HUMAN" == "yes" || "$HUMAN" == "true" ]]; then
  HUMAN_OUT="yes"
fi

# Deterministic gate — order matters, every fall-through lands on a human gate:
# 1. human-only (any tier)                 → needs-review          (hold: human)
# 2. agent asked for info                  → needs-info            (hold: info)
# 3. T3/T4 AND agent-ready (auto-buildable)→ agent-ready-specify   (hold: specify — #1169)
# 4. T3/T4 otherwise                       → needs-review          (hold: tier)
# 5. T1/T2 AND agent-ready                 → agent-ready           (hold: none — the ONLY
#                                                                   unrestricted auto path)
# 6. anything else                         → needs-review          (hold: unknown — fail closed)
#
# Rules 3 and 4 are two branches of the SAME tier, split on the agent's decision, and
# the split is load-bearing rather than decoration: before #1169 the agent's
# `decision` was ignored entirely at T3/T4, so making the tier alone route to a
# specify dispatch would auto-specify issues the agent had explicitly declined to
# call auto-buildable (a human-only-adjacent, unclear, or garbled one). Requiring the
# affirmative token keeps every non-affirmative T3/T4 on exactly its pre-#1169
# outcome — needs-review, hold `tier`.
if [[ "$HUMAN_OUT" == "yes" ]]; then
  emit needs-review "$ROLE" human; exit 0
fi
if [[ "$DECISION" == "needs-info" ]]; then
  emit needs-info "$ROLE" info; exit 0
fi
if [[ "$TIER" == "t3" || "$TIER" == "t4" ]]; then
  if [[ "$DECISION" == "agent-ready" ]]; then
    emit agent-ready-specify "$ROLE" specify; exit 0
  fi
  emit needs-review "$ROLE" tier; exit 0
fi
if [[ "$TIER" == "t1" || "$TIER" == "t2" ]] && [[ "$DECISION" == "agent-ready" ]]; then
  emit agent-ready "$ROLE" none; exit 0
fi
emit needs-review "$ROLE" unknown; exit 0
