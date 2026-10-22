#!/usr/bin/env bash
# reconcile-docs-lane-labels.sh — strip a stale `docs-lane` label from an open PR
# whose `docs-lane` check has already failed (#2154).
#
# Usage:
#   scripts/reconcile-docs-lane-labels.sh            # DRY RUN — prints the plan, changes nothing
#   scripts/reconcile-docs-lane-labels.sh --apply    # actually removes the label
#
# ── Why this exists ─────────────────────────────────────────────────────────
# `packages/minspec/src/lib/approval-pr.ts`'s `laneLabelsFor` used to decide the
# `docs-lane` label from docs-corpus MEMBERSHIP alone and never asked whether the PR
# was ELIGIBLE for the lane. Since #1847, `.github/workflows/docs-lane.yml`'s
# governance-status-transition gate refuses, with `exit 1`, any `docs-lane`-labelled
# PR whose diff changes a `status:` line under `docs/decisions/` or `specs/` — which
# is exactly what an approval/acceptance PR is. `ea9e15db` (#2089) fixed the
# PRODUCER so a new approval PR is never mislabelled, but nothing reconciles a label
# a PR was ALREADY carrying before that fix landed: it keeps re-triggering the same
# `exit 1` red on every subsequent push/label/synchronize event, forever, until a
# human removes the label by hand.
#
# This is the general, repeatable form of that one-off `gh pr edit <N> --repo ...
# --remove-label docs-lane` per stuck PR: it sweeps every OPEN PR currently carrying
# the label and strips it from any whose most recent `docs-lane` check run concluded
# a failure, so a future rule change (or a future producer bug) self-heals on the
# next sweep instead of requiring another hand enumeration of PR numbers.
#
# ── Why this reads the CHECK CONCLUSION rather than re-deriving eligibility ────
# `laneRefusal`/`isGovernancePath` (approval-pr.ts) is already a SECOND definition of
# the lane's own bash predicate in docs-lane.yml — a real, documented cost (see that
# module's header) contained only because both engines are pinned byte-identical by
# `tests/governance-lane-eligibility.test.ts`. Encoding a THIRD copy of the same
# regex here, in a script with no such pinning test, would be the exact drift risk
# that comment warns about. The lane's own CI run is the ground truth for whether a
# labelled PR is eligible — asking it directly (via the check-run conclusion) costs
# one `gh pr list` call and needs no regex of its own.
#
# ── Why stripping on ANY failing conclusion is safe ─────────────────────────────
# `docs-lane` is NOT a required check (see #2154, #1847) — nothing merges because of
# it and nothing is blocked by its absence. Removing the label never loses work: the
# PR still needs, and still gets, a human merge keystroke either way. It only stops a
# lane that has already refused this PR from being re-asked the same question on
# every future push.
#
# ── What this deliberately does NOT do ───────────────────────────────────────────
#   * It does not touch PRs whose `docs-lane` check has not run yet, or is still
#     queued/in-progress, or concluded SUCCESS/NEUTRAL/SKIPPED — those are left
#     alone; only a CONFIRMED failure strips the label (fail closed toward leaving a
#     label in place, never toward removing one on a guess).
#   * It does not re-implement the eligibility predicate, per above.
#   * It is not wired into drain-inbox.sh's automatic sweep, matching
#     `backfill-hold-labels.sh`'s precedent: a human runs this by hand when the
#     symptom (docs-lane red on an approval PR) is observed, same as that script.

set -uo pipefail

REPO="AIClarityAU/minspec"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Agent/automation writes carry the BOT's identity, never the human's (#1355).
# Sourcing is offline and cannot fail; only the actual `--apply` write mints a
# token, so the default read-only (no --apply) run needs no credential at all.
# shellcheck source=scripts/lib/gh-bot.sh
source "${SCRIPT_DIR}/lib/gh-bot.sh"
gh_bot_init

APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

# ── Pure decision seam (no gh/git — safe to unit-test in isolation) ───────────
# Given the `docs-lane` check run's `conclusion` (as `gh pr list --json
# statusCheckRollup` reports it — empty string when the check has not run or is
# still in flight), decide whether the label should be stripped.
#
# FAILURE/ERROR/TIMED_OUT/CANCELLED are all "the lane refused this PR" outcomes —
# the same failing-conclusion vocabulary `remediate-pr.sh` already uses for its own
# non-review check classification, reused here rather than re-invented. Anything
# else (SUCCESS, NEUTRAL, SKIPPED, or empty/not-yet-run) leaves the label alone.
decide_reconcile() {
  local conclusion="$1"
  case "$conclusion" in
    FAILURE | ERROR | TIMED_OUT | CANCELLED)
      echo "strip"
      ;;
    *)
      echo "leave"
      ;;
  esac
}

if [[ "${1:-}" == "--decide" ]]; then
  shift
  if [[ $# -ne 1 ]]; then
    echo "Usage: reconcile-docs-lane-labels.sh --decide <conclusion>" >&2
    exit 2
  fi
  decide_reconcile "$1"
  exit 0
fi

echo "Fetching open PRs labelled docs-lane ($REPO)..."
[[ "$APPLY" -eq 1 ]] || echo "DRY RUN — nothing will be changed. Re-run with --apply to act."
echo

PRS_JSON=$(gh pr list --repo "$REPO" --label docs-lane --state open --limit 200 \
  --json number,statusCheckRollup) || {
  echo "ERROR: could not list open docs-lane PRs — refusing to guess a plan." >&2
  exit 1
}

COUNT=$(jq 'length' <<<"$PRS_JSON")
PLANNED=0
LEFT=0

for idx in $(seq 0 $((COUNT - 1))); do
  NODE=$(jq -c ".[$idx]" <<<"$PRS_JSON")
  NUM=$(jq -r '.number' <<<"$NODE")
  # The rollup already collapses re-runs to the latest result per check name, so
  # this reads the CURRENT state of the `docs-lane` check, not stale history.
  CONCLUSION=$(jq -r '
    [.statusCheckRollup[]? | select((.name // "") == "docs-lane") | (.conclusion // "")]
    | last // ""' <<<"$NODE")
  DECISION=$(decide_reconcile "$CONCLUSION")

  if [[ "$DECISION" == "strip" ]]; then
    PLANNED=$((PLANNED + 1))
    printf '  #%-6s docs-lane check concluded %-10s -> remove docs-lane label\n' "$NUM" "$CONCLUSION"
    if [[ "$APPLY" -eq 1 ]]; then
      gh pr edit "$NUM" --repo "$REPO" --remove-label docs-lane >/dev/null 2>&1 \
        || echo "    WARNING: could not remove docs-lane from #${NUM}" >&2
    fi
  else
    LEFT=$((LEFT + 1))
  fi
done

echo
echo "── Summary ──────────────────────────────────────────────"
printf '  open docs-lane-labelled PRs scanned   %d\n' "$COUNT"
printf '  labelled / to unlabel                 %d\n' "$PLANNED"
printf '  left alone (not a confirmed failure)  %d\n' "$LEFT"
echo
[[ "$APPLY" -eq 1 ]] || echo "DRY RUN — re-run with --apply to make these changes."
