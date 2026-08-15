#!/usr/bin/env bash
# build-extension.sh — production bundle, stamped with the commit it was built from (#1439).
#
# Why the stamp exists: a stale installed extension silently disables shipped gates, and a
# VERSION check cannot detect it. Measured 2026-08-12 — the installed build and the rebuilt
# one were both `0.1.26`, five days and one security-relevant gate apart. Only the commit
# distinguishes them, so the commit is what gets baked in.
#
# The SHA is injected with esbuild `--define`, so it lands as a literal in the bundle. There
# is no generated source file to commit, and therefore no generated file to go stale — the
# stamp cannot outlive the build it describes.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../packages/minspec"

# Dirty tree ⇒ mark it. A bundle built from uncommitted work is not identified by any commit,
# and silently stamping the last commit would misreport what is actually running — the exact
# class of false signpost this feature exists to remove.
sha="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
if [ -n "$(git status --porcelain -- ../../packages ../../scripts 2>/dev/null)" ]; then
  sha="${sha}-dirty"
fi

echo "build-extension: stamping build with ${sha}" >&2

exec npx esbuild src/extension.ts \
  --bundle \
  --outfile=out/extension.js \
  --external:vscode \
  --format=cjs \
  --platform=node \
  --minify \
  --sourcemap=external \
  --define:__MINSPEC_BUILD_SHA__="\"${sha}\""
