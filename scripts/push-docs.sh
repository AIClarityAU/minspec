#!/usr/bin/env bash
# push-docs.sh — land docs/approvable changes on main via the docs-lane
# (Option 2, DR-051 #575). Opens a docs-only PR labelled `docs-lane`; the
# docs-lane workflow verifies docs-only + enables auto-merge, so it merges once
# the required checks pass — no manual merge click, nothing bypassed.
#
# SAFE ON THE SHARED PRIMARY CHECKOUT: it copies the named docs files into a
# fresh worktree off origin/main and never moves the primary HEAD (rule #8).
# Non-docs paths are refused client-side (the workflow re-checks server-side).
#
# Usage:
#   scripts/push-docs.sh -m "docs(DR-051): wire note" [FILE ...]
#     FILE ...  explicit docs paths (relative to repo root). If omitted, uses
#               the working tree's changed files intersected with the docs corpus.
set -euo pipefail

CORPUS='^(specs/|docs/|\.minspec/approvals/|[^/]+\.md$)'

msg=""
files=()
while [ $# -gt 0 ]; do
  case "$1" in
    -m) msg="${2:-}"; shift 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) files+=("$1"); shift ;;
  esac
done
[ -n "$msg" ] || { echo "push-docs: need -m <commit/PR message>" >&2; exit 2; }

root="$(git rev-parse --show-toplevel)"
slug="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
git -C "$root" fetch -q origin main

# Default file set: changed working-tree paths that are inside the docs corpus.
if [ "${#files[@]}" -eq 0 ]; then
  while IFS= read -r f; do
    [[ "$f" =~ $CORPUS ]] && files+=("$f")
  done < <(git -C "$root" status --porcelain | sed 's/^...//' | sed 's/^.*-> //')
  [ "${#files[@]}" -gt 0 ] || { echo "push-docs: no changed docs-corpus files found" >&2; exit 1; }
fi

# Client-side guard: every explicit/gathered path must be docs corpus.
for f in "${files[@]}"; do
  [[ "$f" =~ $CORPUS ]] || { echo "push-docs: refusing non-docs path: $f" >&2; exit 1; }
  [ -e "$root/$f" ] || { echo "push-docs: no such file: $f" >&2; exit 1; }
done

branch="docs-lane/$(git -C "$root" rev-parse --short HEAD)-$$"
wt="$(mktemp -d)"
cleanup() { git -C "$root" worktree remove --force "$wt" 2>/dev/null || true; }
trap cleanup EXIT

git -C "$root" worktree add -q -b "$branch" "$wt" origin/main
for f in "${files[@]}"; do
  mkdir -p "$wt/$(dirname "$f")"
  cp "$root/$f" "$wt/$f"
done
git -C "$wt" add -A
if git -C "$wt" diff --cached --quiet; then
  echo "push-docs: no delta vs origin/main — nothing to push" >&2
  exit 0
fi
# --no-verify: the ephemeral worktree has no node_modules / built @aiclarity/shared,
# so the repo's pre-commit validate hook (tsx) crashes on module load. Local hooks
# are a fast-fail convenience; CI's MinSpec-validate required check is the guarantee
# on the docs-lane PR (DR-037). Skip them here.
git -C "$wt" commit -q --no-verify -m "$msg"
git -C "$wt" push -q -u origin "$branch"

pr_url="$(gh pr create --repo "$slug" --base main --head "$branch" \
  --title "$msg" --label docs-lane \
  --body "Docs-only change via the **docs-lane** (auto-merges once green; ai-review still runs). Files:
$(printf -- '- \`%s\`\n' "${files[@]}")")"
echo "push-docs: opened $pr_url"
echo "push-docs: docs-lane workflow will verify docs-only + enable auto-merge."
