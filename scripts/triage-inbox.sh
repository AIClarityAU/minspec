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

set -euo pipefail

REPO="AIClarityAU/minspec"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROLES_DIR="${SCRIPT_DIR}/roles"
DECIDE="${SCRIPT_DIR}/triage-decide.sh"

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
    --tools "" \
    --output-format text 2>&1) || {
      echo "WARNING: triage agent failed for #$ISSUE — leaving in inbox" >&2
      return 0
    }

  # Deterministic gate → "<label> <role>"
  local VERDICT LABEL ROLE
  VERDICT=$(printf '%s\n' "$AGENT_OUT" | "$DECIDE" || true)
  LABEL=$(echo "$VERDICT" | awk '{print $1}')
  ROLE=$(echo "$VERDICT" | awk '{print $2}')

  if [[ -z "$LABEL" || -z "$ROLE" ]]; then
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

  # PARENT applies the verdict (credentialed op — never the agent).
  echo "  → #$ISSUE: $LABEL (role:$ROLE)"
  gh issue edit "$ISSUE" --repo "$REPO" \
    --add-label "role:${ROLE},${LABEL}" --remove-label "inbox" >/dev/null
  gh issue comment "$ISSUE" --repo "$REPO" \
    --body "**Triage:** \`${LABEL}\` · role:\`${ROLE}\`
${RATIONALE}

— auto-triaged (\`triage-inbox.sh\`); verdict enforced by the deterministic gate (\`triage-decide.sh\`)." >/dev/null

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
