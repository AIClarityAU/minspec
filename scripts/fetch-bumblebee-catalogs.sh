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
#
# Pinned to BUMBLEBEE_VERSION (same var check-supply-chain.sh pins the
# scanner binary to) so catalogs never advance past what the pinned reader
# supports. Bumping the scanner version and the catalog ref are the SAME
# change — do not bump one without the other (#848: a HEAD-tracked catalog
# fetch drifted to schema 0.2.0 while the pinned v0.1.2 reader only
# understood 0.1.0, and the scan failed closed on every run).

set -e

TARGET="${1:-$HOME/.cache/bumblebee/catalogs}"
BUMBLEBEE_VERSION="${BUMBLEBEE_VERSION:-v0.1.2}"
mkdir -p "$TARGET"

LISTING=$(gh api "repos/perplexityai/bumblebee/contents/threat_intel?ref=${BUMBLEBEE_VERSION}" --jq '.[] | select(.name | endswith(".json")) | .name')

if [ -z "$LISTING" ]; then
  echo "fetch-bumblebee-catalogs: no JSON catalogs found upstream at ref ${BUMBLEBEE_VERSION} (or API failure)" >&2
  exit 1
fi

COUNT=0
for name in $LISTING; do
  gh api "repos/perplexityai/bumblebee/contents/threat_intel/${name}?ref=${BUMBLEBEE_VERSION}" --jq '.content' \
    | base64 -d > "$TARGET/${name}"
  COUNT=$((COUNT + 1))
done

echo "fetch-bumblebee-catalogs: $COUNT catalog(s) @ ${BUMBLEBEE_VERSION} → $TARGET" >&2
