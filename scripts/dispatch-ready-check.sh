#!/usr/bin/env bash
# dispatch-ready-check.sh — pure deterministic dispatch-readiness gate (#406, #983).
#
# `agent-ready` is stamped ONCE at triage and then never re-checked. Between the
# drain ENUMERATING the agent-ready issues and the dispatcher actually LAUNCHING one
# (the drain processes issues sequentially, so a slow earlier build defers later
# ones by many minutes), the issue may have been closed, re-triaged to needs-review,
# or quarantined. Dispatching on that stale point-in-time stamp builds a
# no-longer-ready issue. This gate re-validates the issue's CURRENT state at
# dispatch time, deterministically.
#
# ── #983: the label is a STAMP of a verdict, never the verdict ────────────────
# ROOT CAUSE this closes: the checks below (state + countermanding labels) only ever
# asked whether a countermanding signal is PRESENT — they never asked whether an
# affirming verdict EXISTS and STILL HOLDS. So ANY writer of the `agent-ready` label
# (a human clicking it in the GitHub UI, a bulk `gh issue edit`, any script)
# inherited the triage gate's authority without ever passing through it: nothing
# re-computed tier or human_only at dispatch. Confirmed in production — five
# hand-flipped issues (#118/#299/#326/#357/#440) dispatched and burned build-agent
# tokens; one of them was `human-only-type`. Only the weaker model-trusted DR-355
# self-escalation caught them. This is the repo's recurring validator-asymmetry
# class (a validator that checks present-and-resolving, never missing).
#
# The fix: dispatch now REQUIRES a machine-readable VERDICT RECORD written by the
# gate itself (triage-inbox.sh, via --render-record below) and refuses without one.
# The record is keyed to a `bodyHash` of the issue body AS TRIAGED, so it is
# FALSIFIABLE — edit the issue after triage and the hash stops matching, the verdict
# is stale, and dispatch holds until a re-triage regenerates it.
#
# WHY THE RECORD GRAMMAR LIVES HERE (in the READER, not the writer): a format that
# two files each half-know is a format that drifts. This script both RENDERS the
# record (--render-record, called by triage-inbox.sh) and PARSES it, so writer and
# reader are the same code by construction and the round-trip is unit-testable.
#
# HONEST SCOPE — what this does NOT do: it does not bind the record to its AUTHOR.
# Anyone with write access could hand-craft a record comment; what they can no
# longer do is inherit the gate by *clicking a label*, because a forged record must
# also carry a correct sha256 of the exact triaged body. That converts an accidental
# one-click bypass into a deliberate forgery. Author/provenance binding (the
# equivalent of ai-review.yml's bot allowlist, #397) is a separate, tracked
# hardening — see the summary for #983.
#
# Usage:
#   dispatch-ready-check.sh <state> <labels-csv> <verdict-source-file> <body-file>
#     <state>               the issue's CURRENT state from `gh issue view --json state`
#                           (OPEN | CLOSED, case-insensitive).
#     <labels-csv>          the issue's CURRENT labels, comma-separated (label NAMES).
#                           May legitimately be empty (an issue with no labels).
#     <verdict-source-file> a file holding the issue's comment bodies (the dispatcher
#                           writes `[.comments[].body] | join("\n")`). The LAST
#                           verdict record found in it wins, so a re-triage always
#                           supersedes an earlier verdict.
#     <body-file>           a file holding the issue body AS COMPOSED FOR TRIAGE
#                           ("# " + title + "\n\n" + body), used to recompute bodyHash.
#
#   dispatch-ready-check.sh --render-record <decision> <role> <tier> <human_only> <hold> [verdictAt]
#     Issue body on stdin. Prints the comment-embeddable verdict record. This is the
#     WRITER half of the same grammar — triage-inbox.sh's only way to mint a record.
#
# Exit 0  → STILL DISPATCHABLE. Prints "ready".
# Exit 1  → NOT DISPATCHABLE. Prints one line: "not-ready [<code>]: <reason>".
#           Codes, and how the dispatcher treats each:
#             closed | no-label | countermanded  — the #406 staleness classes: an
#               expected, self-evident skip (the issue's own state/labels already
#               say why). Quiet.
#             no-verdict | stale-verdict | bad-schema | human-only | held |
#             decision | no-body | no-hash — the #983 verdict classes: a HOLD that
#               is NOT self-evident from the issue, so the dispatcher SURFACES it
#               (label + a one-time comment). A silent refusal would itself violate
#               "no silent gate" (DR-066). Anything unrecognised is surfaced too —
#               fail toward visible.
#
# DESIGN — only abort on CLEAR signals so valid work is NEVER falsely aborted (the
# #406 invariant): we REQUIRE open + agent-ready + a fresh affirming verdict, and
# additionally refuse when a label that explicitly means "a human must look at this"
# is present — a contradictory {agent-ready + needs-review} state resolves to "hold
# for a human", which is the safe direction. A refusal is always a HOLD: nothing is
# deleted, `agent-ready` is never silently stripped, and the issue is one re-triage
# (`scripts/triage-inbox.sh <N>`) away from dispatching again.
#
# SCOPE (in a comment here and in the dispatcher): this closes the label/open-state
# staleness cases and the unverdicted-label hole. Full dependency-graph freshness —
# re-checking that a linked SPEC's status is >= the phase this work needs, or that a
# linked DR is still `accepted` — is the architect-flagged follow-up and is OUT OF
# SCOPE here.
#
# PURE: no gh/git/network/side-effects (it only reads files the caller names), so it
# is unit-testable in isolation (tests/dispatch-ready-check.test.ts) and the
# dispatcher does the credentialed `gh issue view` itself, exactly as triage/review
# split fetch from decision.

set -uo pipefail

# ── The verdict-record grammar (single source of truth for writer AND reader) ──
# Bumping RECORD_SCHEMA invalidates every existing record: the reader refuses an
# unrecognised `gate:` value rather than guessing at fields it may not understand,
# and every issue is re-triaged. That is deliberate — fail closed on schema drift.
RECORD_SCHEMA="minspec-triage-verdict/1"
RECORD_MARKER="<!-- minspec-verdict-record -->"
RECORD_BEGIN="MINSPEC_VERDICT_BEGIN"
RECORD_END="MINSPEC_VERDICT_END"

# body_hash: sha256 of stdin, printed as "sha256:<hex>". Returns non-zero if no
# digest could be computed, so BOTH halves fail closed rather than treating an
# uncomputable hash as a match (an unfalsifiable record is worse than none).
body_hash() {
  local h
  h="$(sha256sum 2>/dev/null | awk '{print $1}')"
  [[ -n "$h" ]] || return 1
  printf 'sha256:%s' "$h"
}

# Record values come from the deterministic gate's fixed vocabulary, but they are
# rendered into a delimited block a parser later trusts — so constrain them here
# rather than assuming. Anything outside [A-Za-z0-9:._/-] is dropped, which makes a
# newline-bearing value unable to forge extra record fields.
record_scrub() { printf '%s' "$1" | tr -cd 'A-Za-z0-9:._/-'; }

# ── WRITER: mint a verdict record (issue body on stdin) ───────────────────────
if [[ "${1:-}" == "--render-record" ]]; then
  shift
  r_decision="$(record_scrub "${1:?usage: --render-record <decision> <role> <tier> <human_only> <hold> [verdictAt]}")"
  r_role="$(record_scrub "${2:?--render-record needs <role>}")"
  r_tier="$(record_scrub "${3:?--render-record needs <tier>}")"
  r_human="$(record_scrub "${4:?--render-record needs <human_only>}")"
  r_hold="$(record_scrub "${5:?--render-record needs <hold>}")"
  r_at="$(record_scrub "${6:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}")"
  if ! r_hash="$(body_hash)"; then
    echo "ERROR: cannot compute bodyHash (sha256sum unavailable) — refusing to render an unfalsifiable verdict record." >&2
    exit 1
  fi
  # Fenced so the block renders as monospace in the GitHub comment (auditable by a
  # human) while staying trivially machine-extractable by the BEGIN/END sentinels.
  printf '%s\n' "$RECORD_MARKER"
  printf '```\n'
  printf '%s\n' "$RECORD_BEGIN"
  printf 'gate: %s\n'       "$RECORD_SCHEMA"
  printf 'decision: %s\n'   "$r_decision"
  printf 'role: %s\n'       "$r_role"
  printf 'tier: %s\n'       "$r_tier"
  printf 'human_only: %s\n' "$r_human"
  printf 'hold: %s\n'       "$r_hold"
  printf 'bodyHash: %s\n'   "$r_hash"
  printf 'verdictAt: %s\n'  "$r_at"
  printf '%s\n' "$RECORD_END"
  printf '```\n'
  exit 0
fi

# ── READER: the dispatch gate ─────────────────────────────────────────────────
STATE="${1:?usage: dispatch-ready-check.sh <state> <labels-csv> <verdict-source-file> <body-file>}"
LABELS_CSV="${2-}"      # optional: an issue may have zero labels
VERDICT_SRC="${3-}"     # REQUIRED: absence is itself a refusal (fail closed)
BODY_FILE="${4-}"       # REQUIRED: needed to recompute bodyHash

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

# refuse <code> <reason> — every non-dispatch exit goes through here, so the
# machine-readable code and the human sentence can never disagree.
refuse() { echo "not-ready [$1]: $2"; exit 1; }

# Last complete BEGIN..END range in the verdict source. LAST, not first: a
# re-triage appends a newer record, and the newest verdict must supersede the
# older one (otherwise a superseded agent-ready verdict would outlive its own
# re-triage to needs-review).
last_record() {
  awk -v b="$RECORD_BEGIN" -v e="$RECORD_END" '
    index($0, b) { buf = ""; inb = 1 }
    inb          { buf = buf $0 "\n" }
    index($0, e) { if (inb) { last = buf; inb = 0 } }
    END          { printf "%s", last }
  ' "$1" 2>/dev/null
}

# Single field out of the record block, trimmed; empty if absent.
record_field() {
  printf '%s\n' "$RECORD" \
    | { grep -iE "^[[:space:]]*$1[[:space:]]*:" || true; } \
    | head -1 \
    | sed -E "s/^[^:]*:[[:space:]]*//" \
    | tr -d '\r' \
    | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'
}

if [[ "$state_uc" != "OPEN" ]]; then
  refuse closed "issue state is '${STATE}', not OPEN"
fi

if ! has_label "agent-ready"; then
  refuse no-label "'agent-ready' label no longer present"
fi

# Any explicit human-gate / quarantine label countermands a lingering agent-ready.
for gate in needs-review needs-info needs-human-review agent-quarantined; do
  if has_label "$gate"; then
    refuse countermanded "countermanding label '${gate}' present (re-triaged / quarantined since drain)"
  fi
done

# ── #983: the label got us this far; now the VERDICT has to actually exist ────
if [[ -z "$VERDICT_SRC" || ! -r "$VERDICT_SRC" ]]; then
  refuse no-verdict "no verdict source supplied to the gate (caller must pass the issue's comment bodies) — refusing rather than trusting the label alone"
fi

RECORD="$(last_record "$VERDICT_SRC")"
if [[ -z "$RECORD" ]]; then
  refuse no-verdict "'agent-ready' is present but NO triage verdict record backs it — the label alone is not a verdict (#983). Re-triage with \`scripts/triage-inbox.sh <N>\` to mint one."
fi

r_gate="$(record_field gate)"
if [[ "$r_gate" != "$RECORD_SCHEMA" ]]; then
  refuse bad-schema "verdict record declares gate '${r_gate:-<missing>}', not '${RECORD_SCHEMA}' — unrecognised schema, refusing rather than guessing. Re-triage to mint a current record."
fi

# Freshness FIRST: a record that is not about the issue as it stands now says
# nothing about it, whatever its other fields claim.
r_hash="$(record_field bodyHash)"
if [[ -z "$r_hash" ]]; then
  refuse stale-verdict "verdict record carries no bodyHash — it cannot be shown to describe the CURRENT issue. Re-triage."
fi
if [[ -z "$BODY_FILE" || ! -r "$BODY_FILE" ]]; then
  refuse no-body "no issue-body file supplied to the gate, so the verdict's bodyHash cannot be re-verified — refusing (fail closed)"
fi
if ! now_hash="$(body_hash < "$BODY_FILE")"; then
  refuse no-hash "could not recompute the issue-body hash (sha256sum unavailable) — refusing rather than accepting an unverifiable verdict"
fi
if [[ "$now_hash" != "$r_hash" ]]; then
  refuse stale-verdict "the issue body has changed since it was triaged (verdict bodyHash ${r_hash} != current ${now_hash}) — the verdict describes a different issue. Re-triage with \`scripts/triage-inbox.sh <N>\`."
fi

# Independent of `hold`, on purpose: human_only is the one classification whose
# violation is never recoverable by a build, so it is asserted directly rather than
# inferred from a sibling field that a malformed/forged record could disagree with.
r_human="$(printf '%s' "$(record_field human_only)" | tr '[:upper:]' '[:lower:]')"
if [[ "$r_human" != "no" ]]; then
  refuse human-only "verdict records human_only='${r_human:-<missing>}' — a human-only issue never auto-builds, whatever labels say (#983)"
fi

# `hold` names the branch the triage gate actually fired: none is the ONLY
# affirmative value; human/tier/info/unknown are all refusals (and `unknown` is the
# fail-closed default, so a garbled verdict lands here too).
r_hold="$(printf '%s' "$(record_field hold)" | tr '[:upper:]' '[:lower:]')"
if [[ "$r_hold" != "none" ]]; then
  refuse held "verdict holds this issue: hold='${r_hold:-<missing>}' (none is the only auto-buildable outcome) — a human gate applies"
fi

# Defense in depth: hold=none should already imply decision=agent-ready. If a record
# somehow disagrees with itself, refuse rather than pick the permissive half.
r_decision="$(printf '%s' "$(record_field decision)" | tr '[:upper:]' '[:lower:]')"
if [[ "$r_decision" != "agent-ready" ]]; then
  refuse decision "verdict decision is '${r_decision:-<missing>}', not agent-ready — record is inconsistent with its own hold, refusing"
fi

echo "ready"
exit 0
