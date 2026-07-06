#!/bin/sh
# Vendor a PINNED-COMMIT copy of the mapped msitarzewski/agency-agents role prompts
# into scripts/roles/vendor/agency-agents/ (#230, decided #231: vendor + pin + bundle,
# never a floating/live fetch, never force-installed).
#
# Usage:
#   scripts/sync-agency-agents.sh [<commit-sha>]
#   With no arg: re-fetches at the SHA already recorded in agency-agents.lock.json
#   (a no-op content-wise, useful to re-verify the pin still resolves).
#   With an arg: re-pins to that commit and updates the lockfile — this is the
#   "reviewed bump" action; the resulting diff under scripts/roles/vendor/ is what
#   a human reviews before folding anything into scripts/roles/*.md (see vendor/README.md).
#
# This script ONLY writes into scripts/roles/vendor/ — it never touches the
# hand-authored scripts/roles/*.md overlay files.
#
# Requires: gh CLI authenticated (in CI, GH_TOKEN/GITHUB_TOKEN env var).
# Fails non-zero if upstream is unreachable — fail-closed by design, mirrors
# fetch-bumblebee-catalogs.sh.

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/scripts/roles/vendor/agency-agents"
LOCK_FILE="$ROOT_DIR/scripts/roles/vendor/agency-agents.lock.json"
REPO="msitarzewski/agency-agents"

if [ ! -f "$LOCK_FILE" ]; then
  echo "sync-agency-agents: missing $LOCK_FILE — cannot determine the mapped files" >&2
  exit 1
fi

SHA="${1:-$(node -e "console.log(require('$LOCK_FILE').pinnedCommit)")}"

if [ -z "$SHA" ]; then
  echo "sync-agency-agents: no commit SHA (none given, none in lockfile)" >&2
  exit 1
fi

# Confirm the pin resolves before writing anything (fail-closed on a bad/rotated SHA).
if ! gh api "repos/${REPO}/commits/${SHA}" >/dev/null 2>&1; then
  echo "sync-agency-agents: commit ${SHA} not found on ${REPO} — aborting, nothing written" >&2
  exit 1
fi

FILES=$(node -e "
const m = require('$LOCK_FILE').mapping;
for (const role of Object.keys(m)) for (const f of m[role]) console.log(f);
")

if [ -z "$FILES" ]; then
  echo "sync-agency-agents: lockfile mapping is empty — nothing to fetch" >&2
  exit 1
fi

COUNT=0
for path in $FILES; do
  DEST="$VENDOR_DIR/$path"
  mkdir -p "$(dirname "$DEST")"
  gh api "repos/${REPO}/contents/${path}?ref=${SHA}" --jq '.content' \
    | base64 -d > "$DEST"
  COUNT=$((COUNT + 1))
done

gh api "repos/${REPO}/contents/LICENSE?ref=${SHA}" --jq '.content' \
  | base64 -d > "$VENDOR_DIR/LICENSE"

TODAY=$(date -u +%Y-%m-%d)
node -e "
const fs = require('fs');
const lock = JSON.parse(fs.readFileSync('$LOCK_FILE', 'utf8'));
lock.pinnedCommit = '$SHA';
lock.pinnedAt = '$TODAY';
lock.reviewedBy = 'unreviewed — this script just re-pinned; update this field once a human has diffed scripts/roles/vendor/';
fs.writeFileSync('$LOCK_FILE', JSON.stringify(lock, null, 2) + '\n');
"

echo "sync-agency-agents: $COUNT file(s) + LICENSE → $VENDOR_DIR (pinned @ ${SHA})" >&2
echo "sync-agency-agents: review with 'git diff scripts/roles/vendor/' before folding anything into scripts/roles/*.md" >&2
