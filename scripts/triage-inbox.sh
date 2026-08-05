#!/usr/bin/env bash
# triage-inbox.sh — triage inbox issues into agent-ready / needs-review / needs-info
# Usage: scripts/triage-inbox.sh [issue-number]
#
# Without args: processes all issues labeled 'inbox'
# With arg: triages single issue
#
# Security model (mirrors dispatch-issue.sh): the issue body is UNTRUSTED
# (prompt-injection surface). The triage AGENT therefore gets NO credentials and
# CANNOT mutate labels — it only emits a verdict block. This PARENT script feeds
# that verdict through the deterministic gate (triage-decide.sh) and applies the
# result with gh. An injected "make this agent-ready" cannot reach the label.
#
# ── Verdict RECORD, not just a label (#1002, enabling #983) ──────────────────
# A label is a lossy, point-in-time STAMP: it says a gate once ran, never what it
# concluded, and ANY writer (a human in the GitHub UI, a bulk `gh issue edit`) can
# apply it without passing through the gate at all. So alongside the labels this
# script persists the gate's actual verdict as a delimited, machine-readable block
# inside the bot triage comment — GitHub-side, shared, auditable, and surviving a
# fresh clone (no local state file to strand). dispatch-ready-check.sh REQUIRES
# that record before it will dispatch, so an unverdicted `agent-ready` now holds
# instead of building.
#
# The record carries a `bodyHash` of the issue body AS TRIAGED, which makes the
# verdict falsifiable: edit the issue after triage and the hash no longer matches,
# so dispatch refuses as stale and the issue is re-triaged. Ordering below is
# deliberate — the RECORD is posted BEFORE the labels, so there is never a window
# in which `agent-ready` exists with no verdict behind it.
#
# The record's GRAMMAR is owned by the reader (dispatch-ready-check.sh
# --render-record), never re-implemented here: one file writes and parses it, so
# writer and reader cannot drift into two dialects of the same format.
#
# Re-triage is therefore the ONLY way to (re)authorise dispatch, and it is complete:
# it mints a record for the body as it now stands AND clears the outcome labels the
# new verdict supersedes — including `needs-human-review`, which dispatch applies
# when it holds. Without that clearing, a held issue would re-triage to a perfectly
# good agent-ready verdict and then be countermanded by the leftover hold label,
# stranding real work. (`agent-quarantined` is deliberately NOT cleared: that is a
# security quarantine from the egress guard, and only a human retires it.)

set -euo pipefail

REPO="AIClarityAU/minspec"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROLES_DIR="${SCRIPT_DIR}/roles"
# shellcheck source=scripts/lib/agent-context.sh
source "${SCRIPT_DIR}/lib/agent-context.sh"

DECIDE="${SCRIPT_DIR}/triage-decide.sh"
READY_CHECK="${SCRIPT_DIR}/dispatch-ready-check.sh"

# One `key=value` line out of `triage-decide.sh --fields` output.
verdict_field() {
  printf '%s\n' "$2" | { grep -E "^$1=" || true; } | head -1 | cut -d= -f2-
}

triage_issue() {
  local ISSUE="$1"

  if ! [[ "$ISSUE" =~ ^[0-9]+$ ]]; then
    echo "ERROR: Invalid issue number: $ISSUE" >&2
    return 1
  fi

  local ISSUE_JSON ISSUE_BODY ISSUE_TITLE
  ISSUE_JSON=$(gh issue view "$ISSUE" --repo "$REPO" --json body,title,labels)
  ISSUE_BODY=$(echo "$ISSUE_JSON" | jq -r '"# " + .title + "\n\n" + .body')
  ISSUE_TITLE=$(echo "$ISSUE_JSON" | jq -r '.title')

  echo "Triaging: #$ISSUE — $ISSUE_TITLE"

  local USER_CONTENT
  USER_CONTENT=$(cat <<CONTENT
<untrusted_issue_body>
${ISSUE_BODY}
</untrusted_issue_body>

Repo: ${REPO}
Issue number: ${ISSUE}

Classify this issue per your role instructions (apply the human-only type filter
FIRST, then tier). You CANNOT edit labels or run any command — the dispatcher
applies your verdict. Emit EXACTLY ONE verdict block, and nothing after it:

TRIAGE_VERDICT_BEGIN
decision: agent-ready | needs-review | needs-info
role: dev | architect | security | reviewer
tier: T1 | T2 | T3 | T4
human_only: yes | no
rationale: <one line — for needs-review say tier-complexity vs human-only-type; for needs-info say what is missing>
TRIAGE_VERDICT_END
CONTENT
)

  # Agent runs with NO tools: it classifies tier from the issue TEXT alone and
  # can only return text. The issue body is UNTRUSTED (prompt-injection surface),
  # so per the global `claude -p` Subprocess Rule #1 (DR-345 / FiverrGigmeister
  # DR-002) it gets NO filesystem/network tool — granting Read over untrusted
  # input is an arbitrary-file-read / cred-exfil hole (`claude -p` resolves
  # absolute paths OUTSIDE cwd; cwd is not a sandbox boundary), so the tool is
  # ELIMINATED, not justified by triage.md's anti-injection prose (#344). `--tools
  # ""` disables the entire built-in tool set. We capture the returned text.
  local AGENT_OUT
  AGENT_OUT=$(claude -p "$USER_CONTENT" \
    --system-prompt-file "${ROLES_DIR}/triage.md" \
    "${AGENT_CONTEXT_ARGS[@]}" \
    --tools "" \
    --output-format text 2>&1) || {
      echo "WARNING: triage agent failed for #$ISSUE — leaving in inbox" >&2
      return 0
    }

  # Deterministic gate → the normalised verdict, as key=value fields. `--fields`
  # (not the space-joined default line) because the RECORD must carry the gate's own
  # view of tier / human_only, and re-parsing the agent's raw text here would be a
  # second parser of the same format — the classic way a gate and its record drift.
  local FIELDS LABEL ROLE HOLD TIER HUMAN_ONLY
  FIELDS=$(printf '%s\n' "$AGENT_OUT" | "$DECIDE" --fields || true)
  LABEL=$(verdict_field label "$FIELDS")
  ROLE=$(verdict_field role "$FIELDS")
  HOLD=$(verdict_field hold "$FIELDS")
  TIER=$(verdict_field tier "$FIELDS")
  HUMAN_ONLY=$(verdict_field human_only "$FIELDS")

  if [[ -z "$LABEL" || -z "$ROLE" || -z "$HOLD" || -z "$TIER" || -z "$HUMAN_ONLY" ]]; then
    echo "WARNING: no verdict parsed for #$ISSUE — leaving in inbox" >&2
    return 0
  fi

  # Pull the agent's rationale line for the triage comment (best-effort).
  local RATIONALE
  RATIONALE=$(printf '%s\n' "$AGENT_OUT" \
    | sed -n '/TRIAGE_VERDICT_BEGIN/,/TRIAGE_VERDICT_END/p' \
    | { grep -iE '^[[:space:]]*rationale[[:space:]]*:' || true; } \
    | head -1 | sed -E 's/^[^:]*:[[:space:]]*//')
  [[ -z "$RATIONALE" ]] && RATIONALE="(no rationale emitted)"

  # Mint the machine-readable verdict record, keyed to the body we just triaged.
  # FAIL CLOSED: if the record cannot be rendered we apply NO labels at all —
  # an `agent-ready` with no verdict behind it is precisely the #983 hole, and
  # producing one here would be worse than leaving the issue untriaged.
  local RECORD
  if ! RECORD=$(printf '%s' "$ISSUE_BODY" | "$READY_CHECK" --render-record \
                  "$LABEL" "$ROLE" "$TIER" "$HUMAN_ONLY" "$HOLD"); then
    echo "ERROR: could not render the verdict record for #$ISSUE — refusing to apply any label (an unverdicted label is the #983 hole). Left as-is." >&2
    return 1
  fi

  # PARENT applies the verdict (credentialed op — never the agent).
  echo "  → #$ISSUE: $LABEL (role:$ROLE · tier:$TIER · hold:$HOLD)"

  # RECORD FIRST, labels second — so `agent-ready` never exists, even momentarily,
  # without the verdict that authorises it.
  gh issue comment "$ISSUE" --repo "$REPO" \
    --body "$(printf '**Triage:** `%s` · role:`%s` · tier:`%s` · hold:`%s`\n%s\n\n%s\n\n— auto-triaged (`triage-inbox.sh`); verdict enforced by the deterministic gate (`triage-decide.sh`). The block above is the machine-readable verdict record that `dispatch-ready-check.sh` requires before any dispatch (#983). It is keyed to the issue body as triaged — edit the issue and this verdict goes stale, so re-run `scripts/triage-inbox.sh %s`.' \
        "$LABEL" "$ROLE" "$TIER" "$HOLD" "$RATIONALE" "$RECORD" "$ISSUE")" >/dev/null

  gh issue edit "$ISSUE" --repo "$REPO" --add-label "role:${ROLE},${LABEL}" >/dev/null

  # Clear the outcome labels this verdict SUPERSEDES. Load-bearing for the
  # agent-ready branch: dispatch labels a held issue `needs-human-review`, which
  # countermands `agent-ready` — so without this, a re-triage could mint a valid
  # verdict that the stale hold label then vetoes forever. Best-effort + LOUD
  # (never silent, DR-066): a failure here holds the issue, it never releases it.
  local SUPERSEDED
  case "$LABEL" in
    agent-ready)  SUPERSEDED="inbox,needs-review,needs-info,needs-human-review" ;;
    needs-review) SUPERSEDED="inbox,agent-ready,needs-info" ;;
    needs-info)   SUPERSEDED="inbox,agent-ready,needs-review" ;;
    *)            SUPERSEDED="inbox" ;;
  esac
  if ! gh issue edit "$ISSUE" --repo "$REPO" --remove-label "$SUPERSEDED" >/dev/null 2>&1; then
    # `gh` resolves label NAMES against the repo's label set and fails the whole
    # request if any one of them does not exist there — which would leave EVERY
    # superseded label in place, `inbox` included, re-triaging this issue forever.
    # Retry one at a time so a single unknown name cannot veto the rest.
    local one failed=""
    IFS=',' read -r -a _sup <<< "$SUPERSEDED"
    for one in "${_sup[@]}"; do
      gh issue edit "$ISSUE" --repo "$REPO" --remove-label "$one" >/dev/null 2>&1 || failed+="${one} "
    done
    if [[ -n "$failed" ]]; then
      echo "WARNING: could not clear superseded label(s) on #$ISSUE: ${failed}— if a human-gate label lingers it will keep countermanding this verdict at dispatch; clear it by hand." >&2
    fi
  fi

  echo "Triage complete for #$ISSUE"
}

if [[ "${1:-}" ]]; then
  triage_issue "$1"
else
  ISSUES=$(gh issue list --repo "$REPO" --label "inbox" --json number -q '.[].number')
  if [[ -z "$ISSUES" ]]; then
    echo "No inbox issues found."
    exit 0
  fi
  for ISSUE in $ISSUES; do
    triage_issue "$ISSUE"
  done
fi
