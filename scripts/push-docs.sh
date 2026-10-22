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

# Docs corpus — single source of truth shared with dispatch-issue.sh's #833
# auto-merge guard (see scripts/lib/docs-corpus.sh). Kept in lock-step with the TS
# canonical (docs-corpus.ts) and docs-lane.yml.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/docs-corpus.sh"
CORPUS="$DOCS_CORPUS_RE"

# The lane's SECOND arming precondition (#1847, #2078): no governance status
# transition. Corpus membership alone is not eligibility — see the check right
# before the commit below (#2158).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/governance-transition.sh"

# The docs-lane PR this opens is an AGENT write, so it must carry the bot's
# identity rather than the human's (#1355). Acquiring the token is LAZY: this
# only arms a `gh` wrapper, and the mint (or a loud abort) happens at the first
# write, not here.
# shellcheck source=scripts/lib/gh-bot.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/gh-bot.sh"
gh_bot_init

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

# ── GOVERNANCE STATUS-TRANSITION CHECK (#2158) ──────────────────────────────
# Corpus membership (CORPUS above) is only the lane's FIRST arming precondition.
# Its second is that the diff not change a `status:` line under docs/decisions/
# or specs/ — a DR acceptance or spec approval is a human act (DR-029, DR-086
# §2) and the lane refuses it with `exit 1`, REVOKING any earlier arming. Before
# this check, push-docs.sh applied the `docs-lane` label unconditionally, so it
# opened a PR the lane was guaranteed to refuse — a manufactured red that reads
# like a defect rather than "this needs a human".
#
# Mirrors laneLabelsFor's WITHHOLD-the-label direction
# (packages/minspec/src/lib/approval-pr.ts), not an outright refusal to push:
# the change is still real and still needs to land, just via a human merge
# keystroke rather than the auto-merging lane. `git -C "$wt" diff --cached`
# reads the SAME staged content the lane's status gate would see, one file at a
# time, so a failing `git diff` here aborts the whole script (`set -euo
# pipefail`) rather than silently reading as "no transition" (constitution
# invariant 2 — no silent gate).
status_hits=()
for f in "${files[@]}"; do
  [[ "$f" =~ $GOVERNANCE_PATH_RE ]] || continue
  diff_text="$(git -C "$wt" diff --cached -- "$f")"
  if grep -qE "$STATUS_TRANSITION_RE" <<<"$diff_text"; then
    status_hits+=("$f")
  fi
done
label_args=(--label docs-lane)
if [ "${#status_hits[@]}" -gt 0 ]; then
  echo "push-docs: NOT labelling docs-lane — governance status transition in: ${status_hits[*]}" >&2
  echo "push-docs: accepting a DR or approving a spec is a human act (DR-029, DR-086 §2);" >&2
  echo "push-docs: the docs-lane would refuse this PR with exit 1 (#1847). Opening it" >&2
  echo "push-docs: un-labelled instead, for an ordinary human merge." >&2
  label_args=()
fi

# DR_INDEX_GATE_OFF=1 (NOT --no-verify): the ephemeral worktree has no node_modules /
# built @aiclarity/shared, so ONLY .githooks/pre-commit's `npm run validate` step crashes
# on module load. That step has this dedicated kill-switch, and it is the right scope —
# the same `npm run validate` is re-run + REQUIRED on the docs-lane PR by ci.yml's `lint`
# job. Targeting just that step KEEPS the two pure-bash gates active (they need no deps):
# the DR-029 born-`proposed` gate (load-bearing — the lane pushes docs/decisions/DR-*.md)
# and the commit-msg RCDD gate. No invariant hole (vs the blunt --no-verify).
DR_INDEX_GATE_OFF=1 git -C "$wt" commit -q -m "$msg"
git -C "$wt" push -q -u origin "$branch"

# $msg is the FULL commit message (subject + body), and this repo's own
# convention — a subject line, a blank line, then an explanatory body, which
# the RCDD gate in .githooks/commit-msg actively requires for `fix:` commits —
# routinely produces a message well past GitHub's 256-char PR title cap
# ("Title is too long (maximum is 256 characters)"). Passing $msg verbatim as
# --title therefore fails PR creation *after* the branch is already pushed
# (#1606). Split it the same way git itself does: first line is the subject
# (truncated on a word boundary if it alone exceeds 256 chars), and whatever
# follows the first blank line is the body — carried into the PR body instead
# of being discarded outright.
pr_title="${msg%%$'\n'*}"
if [ "$pr_title" = "$msg" ]; then
  pr_rest=""
else
  pr_rest="${msg#*$'\n'}"
  pr_rest="${pr_rest#$'\n'}"   # drop the single blank separator line, if present
fi
if [ "${#pr_title}" -gt 256 ]; then
  truncated="${pr_title:0:256}"
  [[ "$truncated" == *' '* ]] && truncated="${truncated% *}"
  pr_title="$truncated"
fi

if [ "${#status_hits[@]}" -gt 0 ]; then
  lane_note="**Not labelled for the docs-lane** — this PR changes a \`status:\` line in: $(printf '\`%s\`, ' "${status_hits[@]}" | sed 's/, $//'). Accepting a DR or approving a spec is a **human act** (DR-029, DR-086 §2), so the lane refuses it by design (#1847). This needs a human merge keystroke (#2158). Files:
$(printf -- '- \`%s\`\n' "${files[@]}")"
else
  lane_note="Docs-only change via the **docs-lane** (auto-merges once green; ai-review still runs). Files:
$(printf -- '- \`%s\`\n' "${files[@]}")"
fi
if [ -n "$pr_rest" ]; then
  pr_body="$pr_rest

$lane_note"
else
  pr_body="$lane_note"
fi

# Push and PR-creation are not transactional: the branch above is ALREADY on
# origin by this point, so a failure here must not read as "nothing happened"
# (constitution invariant 2 — no silent gate). Report the partial success
# loudly and hand back the exact command to finish it by hand, rather than
# `set -e` killing the script on a bare failed command substitution.
if pr_url="$(gh pr create --repo "$slug" --base main --head "$branch" \
  --title "$pr_title" "${label_args[@]}" --body "$pr_body")"; then
  echo "push-docs: opened $pr_url"
  if [ "${#status_hits[@]}" -eq 0 ]; then
    echo "push-docs: docs-lane workflow will verify docs-only + enable auto-merge."
  else
    echo "push-docs: not labelled — this PR needs a human merge (#2158)."
  fi
else
  echo "push-docs: PR creation FAILED, but the branch was already pushed to origin — it is not lost, finish it by hand:" >&2
  echo "push-docs:   branch: $branch" >&2
  if [ "${#status_hits[@]}" -eq 0 ]; then
    printf 'push-docs:   gh pr create --repo %q --base main --head %q --title %q --label docs-lane --body %q\n' \
      "$slug" "$branch" "$pr_title" "$pr_body" >&2
  else
    printf 'push-docs:   gh pr create --repo %q --base main --head %q --title %q --body %q\n' \
      "$slug" "$branch" "$pr_title" "$pr_body" >&2
    echo "push-docs:   (no --label: a governance status transition needs a human merge, #2158)" >&2
  fi
  exit 1
fi
