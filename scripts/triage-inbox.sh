#!/usr/bin/env bash
# triage-inbox.sh — run triage agent on all inbox issues
# Usage: scripts/triage-inbox.sh [issue-number]
#
# Without args: processes all issues labeled 'inbox'
# With arg: triages single issue

set -euo pipefail

REPO="harvest316/minspec"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROLES_DIR="${SCRIPT_DIR}/roles"

triage_issue() {
  local ISSUE="$1"

  if ! [[ "$ISSUE" =~ ^[0-9]+$ ]]; then
    echo "ERROR: Invalid issue number: $ISSUE" >&2
    exit 1
  fi

  local ISSUE_JSON
  ISSUE_JSON=$(gh issue view "$ISSUE" --repo "$REPO" --json body,title,labels)
  local ISSUE_BODY
  ISSUE_BODY=$(echo "$ISSUE_JSON" | jq -r '"# " + .title + "\n\n" + .body')
  local ISSUE_TITLE
  ISSUE_TITLE=$(echo "$ISSUE_JSON" | jq -r '.title')

  echo "Triaging: #$ISSUE — $ISSUE_TITLE"

  local USER_CONTENT
  USER_CONTENT=$(cat <<CONTENT
<untrusted_issue_body>
${ISSUE_BODY}
</untrusted_issue_body>

Repo: ${REPO}
Issue number: ${ISSUE}
Available roles: dev, architect, security, reviewer
Available priority labels: P1, P2, P3

Use \`gh\` CLI to:
- Add labels: \`gh issue edit ${ISSUE} --repo ${REPO} --add-label "role:dev,agent-ready,P2" --remove-label "inbox"\`
- Comment: \`gh issue comment ${ISSUE} --repo ${REPO} --body "triage summary"\`
- Request info: \`gh issue edit ${ISSUE} --repo ${REPO} --add-label "needs-info" --remove-label "inbox"\`
CONTENT
)

  claude -p "$USER_CONTENT" \
    --system-prompt-file "${ROLES_DIR}/triage.md" \
    --allowedTools "gh issue edit,gh issue comment,Read"
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
