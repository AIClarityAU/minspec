#!/bin/sh
# Pre-publish supply-chain gate for MinSpec / ScroogeLLM VS Code extensions.
#
# Scans the repo with perplexityai/bumblebee and fails the build if any
# bundled package matches an entry in the local exposure catalog.
#
# Wired into packages/<ext>/package.json as a "prepackage" / "prepublish" hook.
# Bypass with SKIP_SUPPLY_CHAIN_CHECK=1 (use only for known-good emergency cuts).
#
# Catalogs live in ~/.cache/bumblebee/catalogs/*.json. Empty catalog dir =
# pre-flight inventory only (script still fails on bumblebee errors).
#
# BUMBLEBEE_VERSION below also pins scripts/fetch-bumblebee-catalogs.sh's
# catalog fetch ref — bump both together, never just one (#848).
#
# Read-only: bumblebee never executes package managers or reads source files.
# https://github.com/perplexityai/bumblebee

set -e

if [ "${SKIP_SUPPLY_CHAIN_CHECK}" = "1" ]; then
  echo "check-supply-chain: SKIP_SUPPLY_CHAIN_CHECK=1 — bypassing" >&2
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
BUMBLEBEE_VERSION="${BUMBLEBEE_VERSION:-v0.1.2}"
BUMBLEBEE_BIN="${BUMBLEBEE_BIN:-$HOME/go/bin/bumblebee}"
GO_BIN="${GO_BIN:-$HOME/.local/opt/go1.26.3/bin/go}"
CATALOG_DIR="${BUMBLEBEE_CATALOGS:-$HOME/.cache/bumblebee/catalogs}"
OUT_DIR="$REPO_ROOT/.cache/supply-chain"
OUT_FILE="$OUT_DIR/$(date +%Y%m%d-%H%M%S).ndjson"

# Self-install bumblebee on first run.
if [ ! -x "$BUMBLEBEE_BIN" ]; then
  if [ ! -x "$GO_BIN" ]; then
    echo "check-supply-chain: Go toolchain not found at $GO_BIN" >&2
    echo "  required for bumblebee install. Set GO_BIN or install Go 1.25+." >&2
    exit 1
  fi
  echo "check-supply-chain: installing bumblebee $BUMBLEBEE_VERSION..." >&2
  GOBIN="$HOME/go/bin" "$GO_BIN" install "github.com/perplexityai/bumblebee/cmd/bumblebee@$BUMBLEBEE_VERSION"
fi

mkdir -p "$OUT_DIR" "$CATALOG_DIR"

CATALOG_FLAG=""
if [ -n "$(ls -1 "$CATALOG_DIR"/*.json 2>/dev/null)" ]; then
  CATALOG_FLAG="--exposure-catalog=$CATALOG_DIR"
fi

echo "check-supply-chain: scanning $REPO_ROOT" >&2

# A non-zero exit from the scanner ITSELF is a SCAN ERROR (an unsupported catalog
# schema for the pinned reader, a parse failure, I/O) — NOT a compromised-dependency
# finding. Surface it with a DISTINCT exit code (2) so callers (the daily workflow)
# report "scan could not run — bump bumblebee" instead of a false compromise alarm.
# This matters now that the daily scan floats catalogs to upstream HEAD: a schema
# advance past the pinned reader must fail closed as a bump signal, never as a P1
# "compromised dependency" (#850 security / #869). Real findings keep exit 1 below.
set +e
"$BUMBLEBEE_BIN" scan \
  --profile project \
  --root "$REPO_ROOT" \
  --output file \
  --output-file "$OUT_FILE" \
  $CATALOG_FLAG
SCAN_RC=$?
set -e
if [ "$SCAN_RC" -ne 0 ]; then
  echo "" >&2
  echo "✗ check-supply-chain: bumblebee scan errored (rc=$SCAN_RC) — the scan could NOT run." >&2
  echo "  Most likely the pinned reader (bumblebee $BUMBLEBEE_VERSION) does not support the" >&2
  echo "  fetched catalog schema. Bump the pinned bumblebee version. This is a scan error," >&2
  echo "  NOT a compromised-dependency finding." >&2
  exit 2
fi

if [ -n "$CATALOG_FLAG" ]; then
  FINDINGS=$(grep -c '"record_type":"finding"' "$OUT_FILE" 2>/dev/null || true)
  FINDINGS=${FINDINGS:-0}
  if [ "$FINDINGS" -gt 0 ] 2>/dev/null; then
    echo "" >&2
    echo "✗ check-supply-chain: $FINDINGS compromised package(s) detected" >&2
    grep '"record_type":"finding"' "$OUT_FILE" >&2
    echo "" >&2
    echo "  Inventory: $OUT_FILE" >&2
    echo "  Bypass (NOT recommended): SKIP_SUPPLY_CHAIN_CHECK=1 npm run package" >&2
    exit 1
  fi
  echo "check-supply-chain: 0 findings against $(ls -1 "$CATALOG_DIR"/*.json | wc -l) catalog(s)" >&2
else
  echo "check-supply-chain: no exposure catalogs in $CATALOG_DIR — inventory-only run" >&2
fi

PKG_COUNT=$(grep -c '"record_type":"package"' "$OUT_FILE" 2>/dev/null || true)
PKG_COUNT=${PKG_COUNT:-0}
echo "check-supply-chain: ok ($PKG_COUNT packages catalogued → $OUT_FILE)" >&2
