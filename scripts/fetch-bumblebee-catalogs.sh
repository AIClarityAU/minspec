#!/bin/sh
# Fetch perplexityai/bumblebee threat_intel catalogs into a target directory.
#
# Used by CI workflows (.github/workflows/ci.yml, supply-chain-daily.yml).
# Can also be used locally to refresh ~/.cache/bumblebee/catalogs/.
#
# Usage:
#   fetch-bumblebee-catalogs.sh [target_dir]
#   Default target: ~/.cache/bumblebee/catalogs
#
# Requires: gh CLI authenticated (in CI, GH_TOKEN/GITHUB_TOKEN env var).
# Fails non-zero if upstream is unreachable — fail-closed by design.

set -e

TARGET="${1:-$HOME/.cache/bumblebee/catalogs}"
mkdir -p "$TARGET"

LISTING=$(gh api repos/perplexityai/bumblebee/contents/threat_intel --jq '.[] | select(.name | endswith(".json")) | .name')

if [ -z "$LISTING" ]; then
  echo "fetch-bumblebee-catalogs: no JSON catalogs found upstream (or API failure)" >&2
  exit 1
fi

COUNT=0
for name in $LISTING; do
  gh api "repos/perplexityai/bumblebee/contents/threat_intel/${name}" --jq '.content' \
    | base64 -d > "$TARGET/${name}"
  COUNT=$((COUNT + 1))
done

echo "fetch-bumblebee-catalogs: $COUNT catalog(s) → $TARGET" >&2
