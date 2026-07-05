#!/usr/bin/env bash
# drain-inbox.sh — dispatch all agent-ready issues in background
#
# Called from session-start.sh hook so inbox work piggybacks onto active
# sessions without blocking the user. Each issue is dispatched sequentially
# (not in parallel) to respect subscription quota.
#
# Usage:
#   scripts/drain-inbox.sh              # triage + dispatch now (manual trigger)
#   scripts/drain-inbox.sh --dry-run    # report count, no dispatch
#   scripts/drain-inbox.sh --enable-auto    # opt in: auto-drain every session start
#   scripts/drain-inbox.sh --disable-auto   # opt out
#   scripts/drain-inbox.sh --auto       # drain ONLY if opted in (the hook calls this)
#
# Opt-in is the once-off permission gate (#239): set it once with --enable-auto,
# then the session-start hook drains automatically thereafter. The pref lives in
# .minspec/auto-drain (gitignored — machine-local, never inherited by teammates).

set -euo pipefail

REPO="AIClarityAU/minspec"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DISPATCH="${SCRIPT_DIR}/dispatch-issue.sh"
TRIAGE="${SCRIPT_DIR}/triage-inbox.sh"
PREF_FILE="$(cd "${SCRIPT_DIR}/.." && pwd)/.minspec/auto-drain"
DRY_RUN=false
LOCK="/tmp/minspec-drain-inbox.lock"
LOG="/tmp/minspec-drain-inbox.log"

case "${1:-}" in
  --pref-path)
    # Single source of truth for the opt-in pref location. The session-start
    # hook lives one directory deeper (scripts/hooks/) than this script, so it
    # MUST NOT recompute PREF_FILE with its own relative `..` walk — that drift
    # is exactly what silently disabled auto-drain (the hook read
    # scripts/.minspec/auto-drain, one level too shallow, while --enable-auto
    # wrote the correct repo-root .minspec/auto-drain). The hook asks us instead.
    echo "$PREF_FILE"
    exit 0
    ;;
  --dry-run) DRY_RUN=true ;;
  --enable-auto)
    mkdir -p "$(dirname "$PREF_FILE")"
    echo "on" > "$PREF_FILE"
    echo "✅  Auto-drain ENABLED. Each session start will triage + dispatch pending work."
    echo "    Pref: $PREF_FILE (gitignored — only affects your machine). Disable: scripts/drain-inbox.sh --disable-auto"
    exit 0
    ;;
  --disable-auto)
    mkdir -p "$(dirname "$PREF_FILE")"
    echo "off" > "$PREF_FILE"
    echo "🛑  Auto-drain DISABLED. Drains run only when you invoke scripts/drain-inbox.sh."
    exit 0
    ;;
  --auto)
    # Hook entrypoint: honor the opt-in, stay silent otherwise (no opt-in = no nag here).
    if [[ "$(cat "$PREF_FILE" 2>/dev/null || echo off)" != "on" ]]; then
      exit 0
    fi
    ;;
  "") ;;
  *) echo "Unknown arg: $1"; exit 1 ;;
esac

# Count pending work across both stages
INBOX_COUNT=0
INBOX_ISSUES=$(gh issue list --repo "$REPO" --label "inbox" \
  --json number --jq '.[].number' 2>/dev/null || true)
[[ -n "$INBOX_ISSUES" ]] && INBOX_COUNT=$(echo "$INBOX_ISSUES" | wc -l | tr -d ' ')

READY_ISSUES=$(gh issue list --repo "$REPO" --label "agent-ready" \
  --json number --jq '.[].number' 2>/dev/null || true)
READY_COUNT=0
[[ -n "$READY_ISSUES" ]] && READY_COUNT=$(echo "$READY_ISSUES" | wc -l | tr -d ' ')

TOTAL=$(( INBOX_COUNT + READY_COUNT ))

if [[ "$TOTAL" -eq 0 ]]; then
  exit 0
fi

echo "📬  $INBOX_COUNT inbox + $READY_COUNT agent-ready issue(s) pending"

if $DRY_RUN; then
  echo "    (dry-run — run scripts/drain-inbox.sh to triage + dispatch)"
  exit 0
fi

# ── Fail-loud stale-checkout guard (#481) ───────────────────────────────────
# This script drives dispatch-issue.sh, whose PIPELINE (PR creation, reviewer
# stage, auto-merge gate) lives IN that script. A checkout behind origin/main
# runs an OUT-OF-DATE pipeline silently — the build always looks fresh (each
# dispatch worktree is forced onto origin/main), which masks that the
# ORCHESTRATION is stale. Checked here — after the zero-work and dry-run
# early exits above — so it only fires when real dispatch work is about to
# happen. A stale local checkout is the documented normal state for this
# project's worktree workflow (many parallel worktrees off one shared
# `.git`, nobody force-pulls main in each — see global rule #8), so an
# opted-in `--auto` session with an empty inbox, or any `--dry-run` report,
# must not be blocked by it. Config-only commands earlier in the arg-parsing
# case (--pref-path, --enable-auto, --disable-auto) already returned before
# this point since they never touch the pipeline either.
#
# Escape hatches:
#   MINSPEC_ALLOW_STALE=1        — human override: proceed anyway (loud warning).
#   MINSPEC_FRESHNESS_CHECKED=1  — set automatically once this check passes,
#                                  and exported to every dispatch-issue.sh call
#                                  below, so we fetch/check ONCE per drain run,
#                                  not once per dispatched issue.
if [[ "${MINSPEC_FRESHNESS_CHECKED:-}" != "1" ]]; then
  git fetch origin main -q 2>/dev/null || true
  # Known blind spot: if the fetch fails (network/auth) or origin/main isn't
  # a resolvable ref, rev-list falls through to `echo 0`, so BEHIND reads as
  # "0 commits behind" and the guard fails OPEN (proceeds as if fresh) rather
  # than blocking on an unrelated infra problem. Accepted tradeoff — see the
  # `|| true` / `|| echo 0` robustness design above.
  BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
  if [[ "${BEHIND:-0}" -gt 0 ]]; then
    if [[ "${MINSPEC_ALLOW_STALE:-}" == "1" ]]; then
      echo "WARNING: checkout is $BEHIND commit(s) behind origin/main — proceeding anyway (MINSPEC_ALLOW_STALE=1)." >&2
    else
      echo "ERROR: checkout is $BEHIND commit(s) behind origin/main — the pipeline orchestration (PR/reviewer/gate) dispatch-issue.sh runs may be stale. Pull main (or run from a fresh checkout) before draining. Override (not recommended): MINSPEC_ALLOW_STALE=1" >&2
      exit 1
    fi
  fi
  export MINSPEC_FRESHNESS_CHECKED=1
fi

# Only one drain process at a time
if [[ -f "$LOCK" ]]; then
  LOCK_PID=$(cat "$LOCK" 2>/dev/null || echo "?")
  echo "⚠️   Drain already running (PID $LOCK_PID, log: $LOG) — skipping."
  exit 0
fi

(
  echo "$$" > "$LOCK"
  trap 'rm -f "$LOCK"' EXIT

  # Step 1: triage inbox issues → labels T1/T2 as agent-ready
  if [[ -n "$INBOX_ISSUES" ]]; then
    echo "[drain] triaging $INBOX_COUNT inbox issue(s)..."
    for n in $INBOX_ISSUES; do
      echo "[drain] triaging #$n..."
      "$TRIAGE" "$n" || echo "[drain] WARNING: triage failed for #$n"
    done
  fi

  # Step 2: drain whatever is now agent-ready (original + newly triaged)
  ALL_READY=$(gh issue list --repo "$REPO" --label "agent-ready" \
    --json number --jq '.[].number' 2>/dev/null || true)
  if [[ -z "$ALL_READY" ]]; then
    echo "[drain] no agent-ready issues after triage — done."
    exit 0
  fi
  echo "[drain] dispatching $(echo "$ALL_READY" | wc -l | tr -d ' ') agent-ready issue(s)..."
  for n in $ALL_READY; do
    echo "[drain] dispatching #$n..."
    "$DISPATCH" "$n" || echo "[drain] WARNING: dispatch failed for #$n"
  done
  echo "[drain] done."
) >>"$LOG" 2>&1 &

DRAIN_PID=$!
disown "$DRAIN_PID"
echo "🚀  Triage + drain in background (PID $DRAIN_PID, log: $LOG)"
