#!/usr/bin/env bash
# approve-issue.sh — the human's exit from a triage hold (#1084).
#
# Usage: scripts/approve-issue.sh <issue-number> [--reason "<why>"]
#
# ── Why this exists ──────────────────────────────────────────────────────────
# #983 closed a real hole: dispatch used to accept the `agent-ready` LABEL as if it
# were the verdict, so anyone who could click a label inherited the triage gate's
# authority without passing through it. The fix made dispatch demand a machine-readable
# verdict record with `hold: none`.
#
# That left `needs-review` a ONE-WAY DOOR. The only writer of such a record was the
# LLM triage gate, and re-running it re-derives the same hold — so a human who had
# read an issue and wanted to say "I've reviewed this, go" had no way to say it. A
# gate that refuses valid work is worse than the hole it closed.
#
# This script is the missing exit, and it goes THROUGH the gate rather than around
# it: it does not flip a label and it has no `--force`. It mints a second, distinct
# verdict record (`minspec-human-approval/1`) that names the approving human and is
# bound to the issue body's sha256, exactly as a triage verdict is. Edit the issue
# after approving and the approval goes stale on its own. An override that skipped
# the record would simply be #983 by another name.
#
# ── What it will and will not release (DR-070 §5.1 — policy, not a local choice) ─
#   hold: tier    ✅ "too big to auto-build". Human review is the designed remedy.
#   hold: human   ❌ human_only is a CONTENT class (marketing / positioning / copy /
#                    legal / decide). It says who may AUTHOR the work, not who may
#                    permit it — and no keystroke transfers authorship.
#   hold: info    ❌ triage asked for missing information; approval does not supply it.
#   hold: unknown ❌ the gate concluded nothing, so there is nothing to approve.
# A MIS-classified issue is cured by fixing the gate's INPUT — make the issue body
# unambiguous about its type and re-triage, which changes the bodyHash and is
# therefore a genuine re-verdict — never by overriding the classifier's output.
#
# The liftable set and every refusal message live in `dispatch-ready-check.sh
# --may-approve`, the same pure file the dispatcher reads records with, so this
# credentialed script holds NO policy of its own to drift out of step with the gate.
#
# ── Provenance, and its honest limit ─────────────────────────────────────────
# Three controls, and none of them is cryptography:
#   1. INTERACTIVE ONLY. Refuses without a TTY on stdin AND stdout, so an agent's
#      non-interactive shell cannot run it. Deliberately no `--yes` / `--force`.
#   2. TYPED CONFIRMATION of the issue number — not "y". Scripting that is not a
#      slip, it is deliberate spoofing.
#   3. IDENTITY FROM THE API, not a flag. `gh api user` names who is authenticated,
#      and a bot login is refused outright, so the autonomous pipeline (which writes
#      as `minspec-sdd[bot]`) can never mint the human keystroke it waits for.
#
# LIMIT, stated rather than papered over: in a container whose `gh` is authenticated
# as the maintainer, controls 1 and 2 are what separate "the human approved this" from
# "something running as the human approved this". They raise a one-command bypass to
# deliberate forgery — the same bar #983 settled for with `bodyHash` — and no further.
# Binding a record to its comment's AUTHOR (so the triage half is provably bot-written
# and this half provably is not) is the remaining hardening; it needs the App-token
# path and is tracked with #397.

set -euo pipefail

REPO="AIClarityAU/minspec"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
READY_CHECK="${SCRIPT_DIR}/dispatch-ready-check.sh"

RECORD_BEGIN="MINSPEC_VERDICT_BEGIN"
RECORD_END="MINSPEC_VERDICT_END"

ISSUE="${1:-}"
REASON=""
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --reason) REASON="${2:-}"; shift 2 ;;
    *) echo "ERROR: unknown argument '$1'" >&2; exit 1 ;;
  esac
done

if ! [[ "$ISSUE" =~ ^[0-9]+$ ]]; then
  echo "usage: scripts/approve-issue.sh <issue-number> [--reason \"<why>\"]" >&2
  exit 1
fi

# ── Control 1: interactive only ───────────────────────────────────────────────
if [[ ! -t 0 || ! -t 1 ]]; then
  cat >&2 <<'EOF'
ERROR: approve-issue.sh requires an interactive terminal.

This command mints a record that says a HUMAN approved this issue for an agent to
build. Running it from a script or an agent shell would put a human's name on a
machine's decision, so there is deliberately no --yes and no --force.

Run it yourself from a terminal.
EOF
  exit 1
fi

# ── Fetch the issue: state, body and the verdict record are all gate INPUT ────
echo "Fetching #${ISSUE}…"
ISSUE_JSON="$(gh issue view "$ISSUE" --repo "$REPO" --json body,title,labels,state,comments)"
ISSUE_STATE="$(printf '%s' "$ISSUE_JSON" | jq -r '.state')"
ISSUE_TITLE="$(printf '%s' "$ISSUE_JSON" | jq -r '.title')"
# Composed EXACTLY as triage-inbox.sh composes it, so both sides hash identical bytes.
ISSUE_BODY="$(printf '%s' "$ISSUE_JSON" | jq -r '"# " + .title + "\n\n" + .body')"

if [[ "$ISSUE_STATE" != "OPEN" ]]; then
  echo "ERROR: #${ISSUE} is ${ISSUE_STATE}, not OPEN — nothing to approve." >&2
  exit 1
fi

# ── The approval must be OF something: read the triage verdict being lifted ───
# Approving an issue that was never triaged would let this script become a second
# admission lane that skips the gate entirely — precisely #983. So a fresh triage
# verdict is a PRECONDITION of approval, not an alternative to it.
RECORD="$(printf '%s' "$ISSUE_JSON" \
  | jq -r '[.comments[]?.body // ""] | join("\n")' \
  | awk -v b="$RECORD_BEGIN" -v e="$RECORD_END" '
      index($0, b) { buf = ""; inb = 1 }
      inb          { buf = buf $0 "\n" }
      index($0, e) { if (inb) { last = buf; inb = 0 } }
      END          { printf "%s", last }')"

if [[ -z "$RECORD" ]]; then
  echo "ERROR: #${ISSUE} carries no triage verdict record, so there is no hold to approve." >&2
  echo "       Triage it first:  scripts/triage-inbox.sh ${ISSUE}" >&2
  exit 1
fi

record_field() {
  printf '%s\n' "$RECORD" \
    | { grep -iE "^[[:space:]]*$1[[:space:]]*:" || true; } \
    | head -1 | sed -E "s/^[^:]*:[[:space:]]*//" | tr -d '\r' \
    | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'
}

V_HOLD="$(record_field hold)"
V_HUMAN="$(record_field human_only)"
V_ROLE="$(record_field role)"
V_TIER="$(record_field tier)"
V_HASH="$(record_field bodyHash)"
V_AT="$(record_field verdictAt)"

# ── Freshness FIRST: a verdict about a different body says nothing about this one ─
NOW_HASH="sha256:$(printf '%s' "$ISSUE_BODY" | sha256sum | awk '{print $1}')"
if [[ -z "$V_HASH" || "$V_HASH" != "$NOW_HASH" ]]; then
  echo "ERROR: the triage verdict on #${ISSUE} is STALE — the issue body has changed since it was triaged." >&2
  echo "         verdict bodyHash: ${V_HASH:-<missing>}" >&2
  echo "         current  bodyHash: ${NOW_HASH}" >&2
  echo "       Approving a stale verdict would approve an issue that no longer exists." >&2
  echo "       Re-triage first:  scripts/triage-inbox.sh ${ISSUE}" >&2
  exit 1
fi

# ── The policy call, made by the gate's own pure predicate ───────────────────
MAY=""
if ! MAY="$("$READY_CHECK" --may-approve "$V_HOLD" "$V_HUMAN")"; then
  echo "REFUSED — #${ISSUE} is not approvable." >&2
  echo "  ${MAY}" >&2
  exit 1
fi

# ── Control 3: identity from the API, never from a flag ──────────────────────
APPROVER="$(gh api user -q .login 2>/dev/null || true)"
if [[ -z "$APPROVER" ]]; then
  echo "ERROR: could not resolve the authenticated GitHub identity (\`gh api user\`) — refusing to mint an unattributed approval." >&2
  exit 1
fi
# Asks the gate rather than re-testing the rule here, so there is exactly one
# definition of "is this a bot" across the writer and the reader.
if "$READY_CHECK" --is-bot-identity "$APPROVER"; then
  echo "ERROR: \`gh\` is authenticated as '${APPROVER}', a bot identity." >&2
  echo "       The pipeline may not mint the human approval it exists to wait for (#1084)." >&2
  echo "       Unset GH_TOKEN (or use your own) and run this as yourself." >&2
  exit 1
fi

# ── Control 2: show the consequence, then require the number typed back ──────
cat <<EOF

  Issue    #${ISSUE} — ${ISSUE_TITLE}
  Held on  hold:${V_HOLD}  (role:${V_ROLE} · tier:${V_TIER} · triaged ${V_AT:-unknown})
  Approver ${APPROVER}
  Effect   an agent will build this and open a PR. That PR still needs your merge
           keystroke — approval moves the gate, it does not remove it.

EOF
read -r -p "  Type ${ISSUE} to approve, anything else to abort: " CONFIRM
if [[ "$CONFIRM" != "$ISSUE" ]]; then
  echo "Aborted — nothing was changed."
  exit 1
fi

# ── Mint the record. FAIL CLOSED: no record ⇒ no label, exactly as triage does ─
if ! APPROVAL="$(printf '%s' "$ISSUE_BODY" | "$READY_CHECK" --render-approval \
                   "$APPROVER" "${V_ROLE:-dev}" "${V_TIER:-unknown}" "$V_HOLD")"; then
  echo "ERROR: could not render the approval record — no label applied (an unverdicted \`agent-ready\` is the #983 hole)." >&2
  exit 1
fi

[[ -n "$REASON" ]] || REASON="(no reason given)"

# RECORD FIRST, labels second — so `agent-ready` never exists, even momentarily,
# without the approval that authorises it.
gh issue comment "$ISSUE" --repo "$REPO" --body "$(printf \
  '## ✅ Approved for dispatch by a human\n\n**%s** reviewed this issue and lifted the `hold:%s` triage hold.\n\n> %s\n\n%s\n\nThis is a human approval recorded THROUGH the dispatch gate, not a label flipped around it (#1084): the block above is the machine-readable record `dispatch-ready-check.sh` requires, and it is keyed to the issue body as approved — **edit the issue and this approval goes stale**, exactly like a triage verdict. `hold:human`, `hold:info` and `hold:unknown` are never liftable this way (DR-070 §5.1).\n\nThe resulting PR still requires a human merge keystroke.' \
  "$APPROVER" "$V_HOLD" "$REASON" "$APPROVAL")" >/dev/null

gh issue edit "$ISSUE" --repo "$REPO" --add-label "agent-ready" >/dev/null

# Clear the labels this approval supersedes. Load-bearing: `needs-review` and
# `needs-human-review` are COUNTERMANDING labels at dispatch, so leaving either in
# place would let a valid approval be vetoed forever. Best-effort but LOUD, never
# silent (DR-066) — and a failure here HOLDS the issue, it never releases it.
# `agent-quarantined` is deliberately not cleared: that is a security quarantine
# from the egress guard, and only a human retires it explicitly.
if ! gh issue edit "$ISSUE" --repo "$REPO" \
     --remove-label "needs-review,needs-human-review,inbox" >/dev/null 2>&1; then
  # `gh` fails the whole request if ANY named label is absent from the repo, which
  # would leave every one of them in place. Retry singly so one unknown name cannot
  # veto the rest.
  failed=""
  for one in needs-review needs-human-review inbox; do
    gh issue edit "$ISSUE" --repo "$REPO" --remove-label "$one" >/dev/null 2>&1 || failed+="${one} "
  done
  if [[ -n "$failed" ]]; then
    echo "WARNING: could not clear label(s) on #${ISSUE}: ${failed}— if a human-gate label lingers it will keep countermanding this approval at dispatch; clear it by hand." >&2
  fi
fi

echo "Approved #${ISSUE} as ${APPROVER} (lifted hold:${V_HOLD}). It is now dispatchable."
