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
# Requires: curl, tar. No token: fetches a public codeload tarball (#3008).
# Fails non-zero if upstream is unreachable or rate-limited — fail-closed by design.
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
# expressed in the pinned reader's schema are caught. A catalog whose schema_version the
# pinned reader REJECTS makes check-supply-chain.sh fail closed with a distinct exit code
# (2) — a "bump bumblebee" ops alert, never a false compromise, never executed as code.
# LIMIT: an ADDITIVE catalog change that keeps the schema_version but encodes a threat via
# fields the pinned matcher does not read parses without error and may be silently
# unmatched (false green). Pinning the matcher for safety bounds freshness to the pinned
# schema; catching genuinely new threat EXPRESSIONS needs a reviewed reader bump (DR-005).

set -e

TARGET="${1:-$HOME/.cache/bumblebee/catalogs}"
# Pinned to a main SHA that reads exposure-catalog schema 0.2.0. No released tag
# reads 0.2.0 (v0.1.2, the latest, only reads 0.1.0); a checksum-pinned SHA is
# immutable + GOSUMDB-verified and satisfies #850's "never floating" intent (DR-005/#866).
BUMBLEBEE_VERSION="${BUMBLEBEE_VERSION:-4a02b80aaca86641767c0d6cbe77c6856e4b481b}"
# Data-only fetch ref — may float ahead of the (executed) binary; defaults to it.
BUMBLEBEE_CATALOG_REF="${BUMBLEBEE_CATALOG_REF:-$BUMBLEBEE_VERSION}"
mkdir -p "$TARGET"

# Fetch ONE codeload tarball of the pinned ref instead of N `gh api` REST calls (#3008).
# The REST API draws on the shared installation-token rate limit, which PR bursts exhaust
# (HTTP 403 "API rate limit exceeded"); codeload.github.com is outside that quota and the
# repo is public, so no token is needed (or sent). Still fail-closed: every failure path
# exits non-zero, and rate-limit vs unreachable are told apart so the CI log names the cause.
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
URL="https://codeload.github.com/perplexityai/bumblebee/tar.gz/${BUMBLEBEE_CATALOG_REF}"

RC=0
HTTP_CODE=$(curl -sS -L --retry 2 --retry-delay 2 --retry-max-time 60 \
  -o "$WORK/src.tgz" -w '%{http_code}' "$URL" 2>"$WORK/curl.err") || RC=$?

if [ "$RC" -ne 0 ]; then
  echo "fetch-bumblebee-catalogs: upstream UNREACHABLE fetching ${URL} (curl exit ${RC}): $(cat "$WORK/curl.err")" >&2
  exit 1
fi
case "$HTTP_CODE" in
  200) ;;
  403|429)
    echo "fetch-bumblebee-catalogs: RATE LIMITED (HTTP ${HTTP_CODE}) fetching ${URL}; retry later" >&2
    exit 1 ;;
  *)
    echo "fetch-bumblebee-catalogs: unexpected HTTP ${HTTP_CODE} fetching ${URL} (ref ${BUMBLEBEE_CATALOG_REF} missing?)" >&2
    exit 1 ;;
esac

mkdir "$WORK/x"
if ! tar -xzf "$WORK/src.tgz" -C "$WORK/x" --wildcards '*/threat_intel/*.json' 2>"$WORK/tar.err"; then
  echo "fetch-bumblebee-catalogs: could not extract tarball from ${URL}: $(cat "$WORK/tar.err")" >&2
  exit 1
fi

# Tarball root is <repo>-<ref>/; take only top-level threat_intel/*.json (same set the
# old contents-API listing produced).
COUNT=0
for f in "$WORK"/x/*/threat_intel/*.json; do
  [ -f "$f" ] || continue
  cp "$f" "$TARGET/$(basename "$f")"
  COUNT=$((COUNT + 1))
done

if [ "$COUNT" -eq 0 ]; then
  echo "fetch-bumblebee-catalogs: no JSON catalogs found upstream at ref ${BUMBLEBEE_CATALOG_REF}" >&2
  exit 1
fi

echo "fetch-bumblebee-catalogs: $COUNT catalog(s) @ ${BUMBLEBEE_CATALOG_REF} → $TARGET" >&2
