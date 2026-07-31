#!/usr/bin/env bash
# approve-on-label.sh — restore the label-flip UX for approving a held issue (#1113).
#
# Runs ONLY inside GitHub Actions, from `.github/workflows/approve-on-label.yml`,
# on `issues: [labeled]`. It is the UI front end for the same human-approval exit
# that `scripts/approve-issue.sh` provides on the command line; both call the SAME
# pure predicates in `dispatch-ready-check.sh`, so neither carries a policy of its own.
#
# ── Why the label flip is a legitimate gesture again ─────────────────────────
# #983 closed a real hole: `agent-ready` was a point-in-time STAMP of a verdict, and
# any writer of the label inherited the triage gate's authority without passing
# through it. Five hand-flipped issues dispatched and burned build-agent tokens.
#
# But note precisely WHAT was wrong. It was never "a human flipped a label" — it was
# "nothing recorded WHO flipped it, or WHAT verdict they were overriding". The gesture
# was fine; the record was missing. This script supplies the record, so the maintainer
# keeps the gesture they already have muscle memory for.
#
# ── Provenance: stronger here than on the command line ───────────────────────
# `approve-issue.sh` cannot prove who is at the keyboard, which is exactly why it
# needs a TTY check and a typed confirmation. A webhook does not have that problem:
#
#   1. The approver is read ONLY from `$GITHUB_EVENT_PATH` — the file the Actions
#      runner writes. There is deliberately NO `--approver` flag, so there is no
#      parameter through which a caller could name someone else.
#   2. It refuses to run outside Actions (`GITHUB_ACTIONS` must be `true`).
#   3. **The event is re-verified against GitHub's own timeline** (`--verify-label-event`):
#      a `labeled` event for THIS label by THIS actor must actually exist on the issue.
#      This is the load-bearing control — it does not trust the payload it was handed,
#      it confirms the action against the server's record. Forging it requires actually
#      applying the label as that account, i.e. actually being them.
#   4. The actor must hold write/admin permission on the repo.
#
# That chain binds the approval to a GitHub-recorded human action rather than to a
# self-declared field, which is a partial delivery of the record-author binding
# tracked in #1105 (family of #397).
#
# ── What it will and will not release ────────────────────────────────────────
# Exactly what the CLI releases, because it asks the same predicate: `hold:tier` only.
# `hold:human` / `info` / `unknown` are absolute (DR-072 §3, upstream DR-070 §5). When
# the predicate refuses, this script REMOVES `agent-ready` again and explains why —
# an improvement on both the old behaviour (silently dispatch) and today's (silently
# hold at dispatch time, far from where the human acted).
#
# Usage (Actions only):
#   approve-on-label.sh
#
# Pure entry point, unit-tested without network:
#   approve-on-label.sh --verify-label-event <label> <actor>   # timeline JSON on stdin
#     exit 0 + "verified"      — a matching `labeled` event exists
#     exit 1 + "unverified: …" — it does not

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
READY_CHECK="${SCRIPT_DIR}/dispatch-ready-check.sh"
# Absolute path to THIS file, so the `--verify-label-event` self-call below resolves
# regardless of the caller's cwd (`$0` would be relative when invoked as
# `bash scripts/approve-on-label.sh`). The verification runs through the same entry
# point the tests exercise, so what CI executes is what the suite proves.
SELF="${SCRIPT_DIR}/$(basename "${BASH_SOURCE[0]}")"

APPROVE_LABEL="agent-ready"
RECORD_BEGIN="MINSPEC_VERDICT_BEGIN"
RECORD_END="MINSPEC_VERDICT_END"

# ── PURE: does GitHub's own timeline record this actor applying this label? ───
# Takes the timeline JSON array on stdin so it is testable with no network. Matching
# is on the EXACT label name and the EXACT actor login; a `labeled` event for some
# other label, or by some other actor, is not a match. Any parse failure ⇒ unverified
# (fail closed) — "could not tell" must never read as "verified".
if [[ "${1:-}" == "--verify-label-event" ]]; then
  shift
  v_label="${1:?usage: --verify-label-event <label> <actor>}"
  v_actor="${2:?--verify-label-event needs <actor>}"
  if [[ -z "$v_label" || -z "$v_actor" ]]; then
    echo "unverified: empty label or actor"; exit 1
  fi
  v_hits="$(jq -r --arg l "$v_label" --arg a "$v_actor" \
    '[ .[]? | select(.event == "labeled")
            | select((.label.name // "") == $l)
            | select((.actor.login // "") == $a) ] | length' 2>/dev/null)" || v_hits=""
  if [[ -z "$v_hits" || ! "$v_hits" =~ ^[0-9]+$ ]]; then
    echo "unverified: timeline could not be parsed — refusing rather than assuming the event happened"
    exit 1
  fi
  if [[ "$v_hits" -lt 1 ]]; then
    echo "unverified: no 'labeled' event for '${v_label}' by '${v_actor}' exists on this issue"
    exit 1
  fi
  echo "verified"
  exit 0
fi

# ── Guard: Actions only, and the identity comes from the runner's event file ──
if [[ "${GITHUB_ACTIONS:-}" != "true" ]]; then
  echo "ERROR: approve-on-label.sh runs only inside GitHub Actions." >&2
  echo "       To approve from a terminal use: scripts/approve-issue.sh <N> --reason \"…\"" >&2
  exit 1
fi
if [[ -z "${GITHUB_EVENT_PATH:-}" || ! -r "${GITHUB_EVENT_PATH}" ]]; then
  echo "ERROR: no readable \$GITHUB_EVENT_PATH — the approver identity has no trusted source. Refusing." >&2
  exit 1
fi
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"

# EVERY identity field is read from the event file, never from an argument.
LABEL="$(jq -r '.label.name // ""'   "$GITHUB_EVENT_PATH")"
SENDER="$(jq -r '.sender.login // ""' "$GITHUB_EVENT_PATH")"
ISSUE="$(jq -r '.issue.number // ""'  "$GITHUB_EVENT_PATH")"

if [[ "$LABEL" != "$APPROVE_LABEL" ]]; then
  echo "Not the approval label ('${LABEL}') — nothing to do."; exit 0
fi
if ! [[ "$ISSUE" =~ ^[0-9]+$ ]]; then
  echo "ERROR: event carries no usable issue number." >&2; exit 1
fi
if [[ -z "$SENDER" ]]; then
  echo "ERROR: event names no sender — refusing to mint an unattributed approval." >&2; exit 1
fi

# The triage gate applies `agent-ready` itself; that path already has its own record.
if "$READY_CHECK" --is-bot-identity "$SENDER"; then
  echo "Label applied by the bot identity '${SENDER}' (the triage path) — nothing to approve."
  exit 0
fi

say() { echo "$@"; }
comment() { gh issue comment "$ISSUE" --repo "$REPO" --body "$1" >/dev/null 2>&1 || true; }

# Put the label back the way the gate wants it, and say why. Used on every refusal:
# leaving `agent-ready` in place would leave the issue looking approved when it is not.
bounce() {
  gh issue edit "$ISSUE" --repo "$REPO" --remove-label "$APPROVE_LABEL" >/dev/null 2>&1 || true
  comment "$(printf '## ⏸ `agent-ready` removed — this issue is not approvable\n\n%s\n\n%s\n\n_Applied by @%s. The label flip IS the approval gesture (#1113) — it just has to pass the same gate the CLI does. Nothing was deleted._' "$1" "$2" "$SENDER")"
  say "BOUNCED #${ISSUE}: $1"
}

# ── Control 3 (load-bearing): confirm the action against GitHub's own record ──
# Do NOT trust the payload we were handed; ask the server whether this actor really
# applied this label. `--paginate` because a long-lived issue's timeline spans pages.
TIMELINE="$(gh api "repos/${REPO}/issues/${ISSUE}/timeline" --paginate \
              -H "Accept: application/vnd.github+json" 2>/dev/null)" || TIMELINE=""
if [[ -z "$TIMELINE" ]]; then
  say "ERROR: could not read the issue timeline — cannot confirm the label event. Failing closed."
  bounce "The labelling action could not be confirmed against GitHub's timeline." \
         "Re-apply the label, or approve from a terminal with \`scripts/approve-issue.sh ${ISSUE}\`."
  exit 1
fi
# `--paginate` concatenates pages as separate arrays; flatten to one.
if ! VERIFY="$(printf '%s' "$TIMELINE" | jq -s 'add // []' \
                 | bash "$SELF" --verify-label-event "$APPROVE_LABEL" "$SENDER")"; then
  say "ERROR: ${VERIFY}"
  bounce "The labelling action could not be confirmed against GitHub's timeline (\`${VERIFY}\`)." \
         "An approval must correspond to a real, recorded human action."
  exit 1
fi

# ── Control 4: the actor must actually hold write access ─────────────────────
PERM="$(gh api "repos/${REPO}/collaborators/${SENDER}/permission" --jq '.permission' 2>/dev/null || echo "")"
case "$PERM" in
  admin|write|maintain) ;;
  *)
    bounce "@${SENDER} holds permission \`${PERM:-none}\` on this repo; approving an issue for an agent to build requires write access." \
           "Ask a maintainer to approve it."
    exit 1 ;;
esac

# ── The issue, and the verdict this approval would lift ──────────────────────
ISSUE_JSON="$(gh issue view "$ISSUE" --repo "$REPO" --json body,title,state,comments 2>/dev/null)" || ISSUE_JSON=""
if [[ -z "$ISSUE_JSON" ]]; then
  say "ERROR: could not fetch #${ISSUE}. Failing closed."; exit 1
fi
STATE="$(printf '%s' "$ISSUE_JSON" | jq -r '.state')"
if [[ "$STATE" != "OPEN" ]]; then
  say "#${ISSUE} is ${STATE} — nothing to approve."; exit 0
fi
# Composed EXACTLY as triage-inbox.sh composes it, so both sides hash identical bytes.
ISSUE_BODY="$(printf '%s' "$ISSUE_JSON" | jq -r '"# " + .title + "\n\n" + .body')"

RECORD="$(printf '%s' "$ISSUE_JSON" | jq -r '[.comments[]?.body // ""] | join("\n")' \
  | awk -v b="$RECORD_BEGIN" -v e="$RECORD_END" '
      index($0, b) { buf = ""; inb = 1 }
      inb          { buf = buf $0 "\n" }
      index($0, e) { if (inb) { last = buf; inb = 0 } }
      END          { printf "%s", last }')"

if [[ -z "$RECORD" ]]; then
  bounce "This issue carries no triage verdict record, so there is no hold to approve — and an approval that is not OF a verdict would be a second admission lane that skips triage entirely (#983)." \
         "$(printf 'Triage it first:\n```\nscripts/triage-inbox.sh %s\n```\nthen re-apply `agent-ready` if the gate holds it on `hold:tier`.' "$ISSUE")"
  exit 0
fi

record_field() {
  printf '%s\n' "$RECORD" | { grep -iE "^[[:space:]]*$1[[:space:]]*:" || true; } \
    | head -1 | sed -E "s/^[^:]*:[[:space:]]*//" | tr -d '\r' \
    | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'
}
V_HOLD="$(record_field hold)"; V_HUMAN="$(record_field human_only)"
V_ROLE="$(record_field role)"; V_TIER="$(record_field tier)"
V_HASH="$(record_field bodyHash)"

# The ordinary triage path: an affirmative verdict already authorises this label.
if [[ "$(printf '%s' "$V_HOLD" | tr '[:upper:]' '[:lower:]')" == "none" ]]; then
  say "#${ISSUE} already carries an affirmative verdict (hold:none) — no approval needed."
  exit 0
fi

# ── Freshness FIRST: a verdict about a different body says nothing about this one ─
NOW_HASH="sha256:$(printf '%s' "$ISSUE_BODY" | sha256sum | awk '{print $1}')"
if [[ -z "$V_HASH" || "$V_HASH" != "$NOW_HASH" ]]; then
  bounce "The triage verdict on this issue is **stale** — the body has changed since it was triaged, so the verdict describes a different issue and approving it would approve something that no longer exists." \
         "$(printf 'Re-triage first:\n```\nscripts/triage-inbox.sh %s\n```' "$ISSUE")"
  exit 0
fi

# ── The policy call, made by the gate's own pure predicate ───────────────────
if ! MAY="$("$READY_CHECK" --may-approve "$V_HOLD" "$V_HUMAN")"; then
  bounce "\`${MAY}\`" \
         "A human approval lifts \`hold:tier\` and nothing else (DR-072 §3): \`hold:human\` is a content class (who may **author**), \`hold:info\` is missing information, and \`hold:unknown\` means the gate reached no conclusion."
  exit 0
fi

# ── Mint. FAIL CLOSED: no record ⇒ the label does not stand ──────────────────
if ! APPROVAL="$(printf '%s' "$ISSUE_BODY" | "$READY_CHECK" --render-approval \
                   "$SENDER" "${V_ROLE:-dev}" "${V_TIER:-unknown}" "$V_HOLD")"; then
  bounce "The approval record could not be rendered, so the label does not stand — an \`agent-ready\` with no verdict behind it is precisely the #983 hole." \
         "Try again, or use \`scripts/approve-issue.sh ${ISSUE}\`."
  exit 1
fi

comment "$(printf '## ✅ Approved for dispatch by a human\n\n@%s applied `%s`, which lifted the `hold:%s` triage hold.\n\n%s\n\nThis approval was recorded THROUGH the dispatch gate rather than being a bare label flip (#1113): the block above is the machine-readable record `dispatch-ready-check.sh` requires, the approver is the account GitHub recorded as applying the label (confirmed against the issue timeline, not merely read from the webhook payload), and it is keyed to the issue body as approved — **edit the issue and this approval goes stale**, exactly like a triage verdict.\n\nThe resulting PR still requires a human merge keystroke.' \
  "$SENDER" "$APPROVE_LABEL" "$V_HOLD" "$APPROVAL")"

# Clear the countermanding labels this approval supersedes. Byte-aligned with
# dispatch-ready-check.sh's `countermanded` arm; a leftover hold label would veto a
# valid approval at dispatch time. LOUD on failure, never silent (DR-066), and a
# failure HOLDS the issue rather than releasing it. `agent-quarantined` is
# deliberately NOT cleared — that is a security quarantine only a human retires.
if ! gh issue edit "$ISSUE" --repo "$REPO" \
     --remove-label "needs-review,needs-info,needs-human-review,inbox" >/dev/null 2>&1; then
  failed=""
  for one in needs-review needs-info needs-human-review inbox; do
    gh issue edit "$ISSUE" --repo "$REPO" --remove-label "$one" >/dev/null 2>&1 || failed+="${one} "
  done
  [[ -n "$failed" ]] && say "WARNING: could not clear label(s): ${failed}— a lingering hold label will countermand this approval at dispatch."
fi

say "Approved #${ISSUE} as ${SENDER} (lifted hold:${V_HOLD})."
