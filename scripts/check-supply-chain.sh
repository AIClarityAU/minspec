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
# Read-only: bumblebee never executes package managers or reads source files.
# https://github.com/perplexityai/bumblebee

set -e

if [ "${SKIP_SUPPLY_CHAIN_CHECK}" = "1" ]; then
  echo "check-supply-chain: SKIP_SUPPLY_CHAIN_CHECK=1 — bypassing" >&2
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
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
  echo "check-supply-chain: installing bumblebee..." >&2
  GOBIN="$HOME/go/bin" "$GO_BIN" install github.com/perplexityai/bumblebee/cmd/bumblebee@latest
fi

mkdir -p "$OUT_DIR" "$CATALOG_DIR"

CATALOG_FLAG=""
if [ -n "$(ls -1 "$CATALOG_DIR"/*.json 2>/dev/null)" ]; then
  CATALOG_FLAG="--exposure-catalog=$CATALOG_DIR"
fi

echo "check-supply-chain: scanning $REPO_ROOT" >&2

"$BUMBLEBEE_BIN" scan \
  --profile project \
  --root "$REPO_ROOT" \
  --output file \
  --output-file "$OUT_FILE" \
  $CATALOG_FLAG

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
