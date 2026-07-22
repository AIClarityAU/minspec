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
# Catalog ref = BUMBLEBEE_CATALOG_REF, defaulting to BUMBLEBEE_VERSION (the pinned
# scanner-binary version check-supply-chain.sh installs). CI leaves it at the default
# so catalogs and reader move together and per-PR scans stay reproducible (#848: a
# HEAD-tracked fetch once drifted to schema 0.2.0 while the pinned v0.1.2 reader only
# understood 0.1.0, failing closed every run).
#
# The daily early-warning scan overrides ONLY BUMBLEBEE_CATALOG_REF=main to read the
# freshest catalogs while the BINARY stays pinned — so a compromised upstream cannot
# ship executable code into the token-scoped CI job (#850 security). New threat entries
# within the pinned schema are caught; a schema advance past the pinned reader makes
# check-supply-chain.sh fail closed with a distinct exit code (2), which the daily
# workflow reports as a "bump bumblebee" ops alert — never a false compromise finding,
# never executed as code.

set -e

TARGET="${1:-$HOME/.cache/bumblebee/catalogs}"
BUMBLEBEE_VERSION="${BUMBLEBEE_VERSION:-v0.1.2}"
# Data-only fetch ref — may float ahead of the (executed) binary; defaults to it.
BUMBLEBEE_CATALOG_REF="${BUMBLEBEE_CATALOG_REF:-$BUMBLEBEE_VERSION}"
mkdir -p "$TARGET"

LISTING=$(gh api "repos/perplexityai/bumblebee/contents/threat_intel?ref=${BUMBLEBEE_CATALOG_REF}" --jq '.[] | select(.name | endswith(".json")) | .name')

if [ -z "$LISTING" ]; then
  echo "fetch-bumblebee-catalogs: no JSON catalogs found upstream at ref ${BUMBLEBEE_CATALOG_REF} (or API failure)" >&2
  exit 1
fi

COUNT=0
for name in $LISTING; do
  gh api "repos/perplexityai/bumblebee/contents/threat_intel/${name}?ref=${BUMBLEBEE_CATALOG_REF}" --jq '.content' \
    | base64 -d > "$TARGET/${name}"
  COUNT=$((COUNT + 1))
done

echo "fetch-bumblebee-catalogs: $COUNT catalog(s) @ ${BUMBLEBEE_CATALOG_REF} → $TARGET" >&2
