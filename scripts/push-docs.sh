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

# Snapshot of the working tree's porcelain status, keyed by path — used to
# classify each path as an add/modify (copied into the worktree) vs a deletion
# (`git rm`'d there), since a deleted path has no on-disk content and existence
# alone can't tell the two apart. Kept separate from the (ordered) gather below
# so the default file set still follows git's own listing order.
declare -A path_status=()
status_lines=()
while IFS= read -r line; do
  [ -n "$line" ] || continue
  status_lines+=("$line")
  code="${line:0:2}"
  p="${line:3}"
  p="${p##*-> }"
  path_status["$p"]="$code"
done < <(git -C "$root" status --porcelain)

# Default file set: changed working-tree paths that are inside the docs corpus,
# in git's own listing order.
if [ "${#files[@]}" -eq 0 ]; then
  for line in "${status_lines[@]}"; do
    p="${line:3}"
    p="${p##*-> }"
    [[ "$p" =~ $CORPUS ]] && files+=("$p")
  done
  [ "${#files[@]}" -gt 0 ] || { echo "push-docs: no changed docs-corpus files found" >&2; exit 1; }
fi

# Client-side guard + classify: every explicit/gathered path must be docs corpus.
# A deletion (` D` worktree / `D ` staged) has nothing on disk to copy — it's
# `git rm`'d in the worktree instead, alongside the copied adds/mods.
add_files=()
del_files=()
for f in "${files[@]}"; do
  [[ "$f" =~ $CORPUS ]] || { echo "push-docs: refusing non-docs path: $f" >&2; exit 1; }
  case "${path_status[$f]:-}" in
    ' D'|'D ') del_files+=("$f") ;;
    *)
      [ -e "$root/$f" ] || { echo "push-docs: no such file: $f" >&2; exit 1; }
      add_files+=("$f")
      ;;
  esac
done

branch="docs-lane/$(git -C "$root" rev-parse --short HEAD)-$$"
wt="$(mktemp -d)"
cleanup() { git -C "$root" worktree remove --force "$wt" 2>/dev/null || true; }
trap cleanup EXIT

git -C "$root" worktree add -q -b "$branch" "$wt" origin/main
for f in "${add_files[@]}"; do
  mkdir -p "$wt/$(dirname "$f")"
  cp "$root/$f" "$wt/$f"
done
git -C "$wt" add -A
for f in "${del_files[@]}"; do
  # --ignore-unmatch: the path may already be absent from origin/main (e.g. added
  # then deleted before ever landing on the lane) — that's a no-op, not an error.
  git -C "$wt" rm -q --ignore-unmatch -- "$f"
done
if git -C "$wt" diff --cached --quiet; then
  echo "push-docs: no delta vs origin/main — nothing to push" >&2
  exit 0
fi
git -C "$wt" commit -q -m "$msg"
git -C "$wt" push -q -u origin "$branch"

pr_url="$(gh pr create --repo "$slug" --base main --head "$branch" \
  --title "$msg" --label docs-lane \
  --body "Docs-only change via the **docs-lane** (auto-merges once green; ai-review still runs). Files:
$(printf -- '- \`%s\`\n' "${files[@]}")")"
echo "push-docs: opened $pr_url"
echo "push-docs: docs-lane workflow will verify docs-only + enable auto-merge."
