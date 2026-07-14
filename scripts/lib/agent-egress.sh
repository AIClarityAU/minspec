#!/usr/bin/env bash
# scripts/lib/agent-egress.sh — the pre-publish egress guard ORCHESTRATION,
# extracted into a single-responsibility, testable lib so every parent that
# publishes a credential-free agent's output can run EXACTLY the same fail-closed
# scan. Today the SOLE caller is dispatch-issue.sh; a second consumer — the
# PR-remediation publish path — is PLANNED (#750). Once it calls this lib, the
# "no drift between publish channels" guarantee is realized (until then the
# extraction is reuse-ready, not yet reused). Sourced, not executed.
#
# Rationale (#358, and the no-drift rule for security controls): a credential-free
# agent holds no creds, but the PARENT then PUBLISHES its output — it pushes the
# committed diff, opens/updates a PR, and posts .agent-summary.md /
# .review-signals.json. So a prompt-injected agent's exfil channel is: read a
# secret from a file it can Read, then smuggle it into the committed diff, a commit
# MESSAGE, or a summary file — which the parent would faithfully publish. This
# guard scans EXACTLY that about-to-be-published material and FAILS CLOSED: any hit
# / unreadable input / scan error → do NOT publish.
#
# HONEST SCOPE — do NOT overclaim: this closes the WRITE-TO-PUBLISHED channel only.
# It does NOT close arbitrary NETWORK egress DURING the agent's `npm test` run — the
# agent can edit test files and the runner executes them. That residual is inherent
# to running the project's own build and is out of this guard's scope.
#
# Usage:
#   source "$(dirname "$0")/lib/agent-egress.sh"
#   if ! matches=$(agent_egress_scan "$WORKTREE" "$BASE_REF" [summary_file] [signals_file]); then
#     # BLOCKED — publish nothing; $matches holds the redacted reasons.
#   fi
#
# Args:
#   $1 worktree     — the checkout holding the agent's committed work.
#   $2 base_ref     — the ref the published commits are measured against
#                     (origin/main for a fresh dispatch; the pre-remediation SHA
#                     for a PR remediation, so only the NEW commits are scanned).
#   $3 summary_file — OPTIONAL path to .agent-summary.md (scanned if present).
#   $4 signals_file — OPTIONAL path to .review-signals.json (scanned if present).
#
# Returns: 0 = clean (safe to publish); non-zero = BLOCK. On block, redacted match
# reasons are printed to stdout so the caller can log/quarantine.

# Resolve the scanner relative to THIS lib (scripts/lib/ → scripts/egress-scan.sh),
# so the caller need not pass it. Overridable for hermetic tests.
_AGENT_EGRESS_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_EGRESS_SCAN="${AGENT_EGRESS_SCAN:-${_AGENT_EGRESS_LIB_DIR}/../egress-scan.sh}"

agent_egress_scan() {
  local worktree="${1:?agent_egress_scan needs a worktree}"
  local base_ref="${2:?agent_egress_scan needs a base ref}"
  local summary_file="${3:-}"
  local signals_file="${4:-}"
  local scan="$AGENT_EGRESS_SCAN"
  local -a targets=()

  # Scratch dir OUTSIDE the worktree for the dumps we materialise — so we never
  # leave a stray dump in the worktree a human later inspects. Removed on every
  # path. mktemp failure → fail closed.
  local scan_tmp
  if ! scan_tmp=$(mktemp -d 2>/dev/null); then
    echo "BLOCK: mktemp failed — failing closed"
    return 1
  fi

  # Scan the ADDED lines of EVERY published commit, not the net diff: `git push`
  # publishes the full branch history, so a secret added in one commit and removed
  # in a later one is gone from the net diff yet still in the pushed history and the
  # PR "Commits" view. `git log -p` walks every commit's patch; keep only
  # added-content lines (`^+`, minus the `+++` file headers).
  local patches="${scan_tmp}/patches.txt"
  if ! git -C "$worktree" log -p --no-color "${base_ref}..HEAD" > "$patches" 2>/dev/null; then
    rm -rf "$scan_tmp"
    echo "BLOCK: could not read branch history (git log -p failed) — failing closed"
    return 1
  fi
  local added_dump="${scan_tmp}/added-lines.txt"
  # grep exits 1 on zero added lines (an empty range) — a valid clean result, not
  # an error — so tolerate it; the file is then empty and scans clean.
  grep -E '^\+' "$patches" | grep -Ev '^\+\+\+ ' > "$added_dump" || true
  targets+=("$added_dump")

  # Commit MESSAGES are published too — `git push` carries them and the PR displays
  # them — so a prompt-injected agent could exfiltrate a secret via
  # `git commit -m "<secret>"`, which scanning only the diff would miss. Scan every
  # commit body this range adds. Uncomputable → fail closed.
  local msg_dump="${scan_tmp}/commit-messages.txt"
  if ! git -C "$worktree" log "${base_ref}..HEAD" --format=%B > "$msg_dump" 2>/dev/null; then
    rm -rf "$scan_tmp"
    echo "BLOCK: could not read commit messages (git log failed) — failing closed"
    return 1
  fi
  targets+=("$msg_dump")

  # The artefacts the parent publishes, WHEN present (both optional — only scan what
  # exists, so a legit run that skips them is not falsely blocked; a present-but-
  # unreadable one still fails closed inside the scanner).
  [[ -n "$summary_file" && -f "$summary_file" ]] && targets+=("$summary_file")
  [[ -n "$signals_file" && -f "$signals_file" ]] && targets+=("$signals_file")

  # Pure scanner: exits non-zero (and prints redacted reasons on stdout) on any hit
  # / unreadable / scanner error. Its exit code becomes ours; its stdout flows to
  # the caller so the block reason can be logged.
  "$scan" "${targets[@]}"
  local rc=$?
  rm -rf "$scan_tmp"
  return "$rc"
}
