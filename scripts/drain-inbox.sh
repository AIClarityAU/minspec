#!/usr/bin/env bash
# drain-inbox.sh — dispatch all agent-ready issues in background
#
# Called from session-start.sh hook so inbox work piggybacks onto active
# sessions without blocking the user. Each issue is dispatched sequentially
# (not in parallel) to respect subscription quota.
#
# Two scheduling modes share ONE dispatch cycle (triage inbox → dispatch every
# resulting agent-ready issue → sweep open PRs and auto-remediate fixable problems
# such as ai-review:changes, failing CI checks, or a branch behind main):
#   • one-shot   — run the cycle once and exit (the original behaviour; still the
#                  default for a MANUAL `scripts/drain-inbox.sh` invocation).
#   • continuous — repeat the cycle on an interval for as long as the launching
#                  Claude session is alive, so newly-arriving agent-ready work is
#                  drained opportunistically (#239). This is the default for the
#                  hook's `--auto` path. It is NOT a daemon: the loop is tied to
#                  the session process and self-terminates when the session ends
#                  (see "Session-lifetime tie" below). It is also quota-aware
#                  (#609): a Claude usage-limit signal pauses the loop and backs
#                  off until the window resets, instead of hard-failing.
#
# Usage:
#   scripts/drain-inbox.sh              # triage + dispatch ONCE now (manual)
#   scripts/drain-inbox.sh --dry-run    # report count, no dispatch
#   scripts/drain-inbox.sh --continuous # continuous loop, tied to THIS shell
#   scripts/drain-inbox.sh --once       # force a single cycle (opt out of loop)
#   scripts/drain-inbox.sh --enable-auto    # opt in: auto-drain every session start
#   scripts/drain-inbox.sh --disable-auto   # opt out
#   scripts/drain-inbox.sh --auto       # drain ONLY if opted in (the hook calls this)
#
# Testable decision seams (pure — no gh/git/claude; used by the loop + unit tests):
#   scripts/drain-inbox.sh --session-alive <pid>            # exit 0 alive / 1 gone
#   scripts/drain-inbox.sh --should-continue <pid> <epoch>  # exit 0 continue / 1 stop
#   scripts/drain-inbox.sh --is-quota   (<text on stdin)    # exit 0 quota / 1 not
#   scripts/drain-inbox.sh --resolve-session-pid            # print session anchor PID
#
# Env knobs (all optional):
#   MINSPEC_DRAIN_CONTINUOUS=0     — force pure one-shot even on --auto/--continuous
#                                    (the "keep it a one-shot" opt-out).
#   MINSPEC_DRAIN_INTERVAL=1200    — seconds between cycles (default 20 min).
#   MINSPEC_DRAIN_QUOTA_BACKOFF=1800 — seconds to pause after a quota signal (30 min).
#   MINSPEC_DRAIN_POLL=30          — session-liveness poll granularity while waiting.
#   MINSPEC_DRAIN_MAX_LIFETIME=28800 — hard wall-clock cap on a loop (8 h backstop).
#   MINSPEC_DRAIN_MAX_FAILURES=3   — stop after N consecutive non-quota cycle errors.
#   MINSPEC_SESSION_PID=<pid>      — explicit session anchor (else auto-resolved).
#   MINSPEC_ALLOW_STALE=1          — proceed even if the checkout is behind main.
#
# Opt-in is the once-off permission gate (#239): set it once with --enable-auto,
# then the session-start hook drains automatically thereafter. The pref lives in
# .minspec/auto-drain (gitignored — machine-local, never inherited by teammates).
#
# ── Session-lifetime tie (how the continuous loop dies WITH the session) ──────
# The loop runs in a backgrounded, `disown`ed subshell so it outlives the fast
# session-start hook (the hook must return immediately, it cannot block on a
# long-running loop). `disown` means no SIGHUP reaches it, and being reparented
# to init keeps it running — so it is NOT killed for free. What makes it die with
# the session is an EXPLICIT liveness poll, not process-tree luck:
#   1. Before forking, the FOREGROUND resolves SESSION_PID — the Claude Code
#      session process (comm=claude), which is an ancestor of this hook and lives
#      exactly as long as the session (normal close, crash, or kill all end it).
#      Resolution walks up from $PPID; it must happen in the foreground while that
#      ancestry is still intact (after the fork+disown the loop is reparented and
#      $PPID no longer points at the session).
#   2. The disowned loop polls `kill -0 $SESSION_PID` every MINSPEC_DRAIN_POLL
#      seconds (both between cycles and before each cycle). When the session
#      process is gone the poll fails and the loop exits within one poll interval.
#      => no orphaned daemon survives the session.
#   3. Backstop: a hard MINSPEC_DRAIN_MAX_LIFETIME cap bounds the loop even in the
#      pathological case where the anchor PID is stale/reused, so termination is
#      GUARANTEED, never merely best-effort.

set -euo pipefail

REPO="AIClarityAU/minspec"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DISPATCH="${SCRIPT_DIR}/dispatch-issue.sh"
TRIAGE="${SCRIPT_DIR}/triage-inbox.sh"
REMEDIATE="${SCRIPT_DIR}/remediate-pr.sh"
PREF_FILE="$(cd "${SCRIPT_DIR}/.." && pwd)/.minspec/auto-drain"
# Single source of truth for the quota/transient classifier (tested JS, shared
# with review-branch.sh via decideReviewCheck's isQuotaExhaustion). scripts/ is a
# sibling of .github/scripts/. Reused, never re-implemented — bash and JS must not
# drift on what counts as a session-limit signal.
GUARD="${SCRIPT_DIR}/../.github/scripts/ai-review-guard.js"
DRY_RUN=false
CONTINUOUS=false
# Default lock/log paths; env-overridable so hermetic tests can point them at a
# temp dir instead of the shared /tmp file (behaviour is identical otherwise).
LOCK="${MINSPEC_DRAIN_LOCK:-/tmp/minspec-drain-inbox.lock}"
LOG="${MINSPEC_DRAIN_LOG:-/tmp/minspec-drain-inbox.log}"

# ── Continuous-loop tunables (env-overridable) ───────────────────────────────
INTERVAL="${MINSPEC_DRAIN_INTERVAL:-1200}"           # 20 min between cycles
QUOTA_BACKOFF="${MINSPEC_DRAIN_QUOTA_BACKOFF:-1800}"  # 30 min pause on a quota hit
POLL="${MINSPEC_DRAIN_POLL:-30}"                     # liveness-poll granularity
MAX_LIFETIME="${MINSPEC_DRAIN_MAX_LIFETIME:-28800}"  # 8 h hard cap (backstop)
MAX_CONSEC_FAIL="${MINSPEC_DRAIN_MAX_FAILURES:-3}"   # stop after N straight errors

# ── Pure decision helpers (no gh/git/claude — safe to unit-test in isolation) ──

# is_quota: read combined agent output on stdin; exit 0 iff it is a quota /
# rate-limit / overload / retry signal (a transient, NOT-your-code condition).
# Delegates to the SAME tested classifier review-branch.sh uses, so the two never
# drift. If node/guard is somehow absent, treat as NOT quota (conservative → a
# real crash is never mistaken for a retryable limit).
is_quota() {
  [[ -f "$GUARD" ]] || return 1
  GUARD="$GUARD" node -e 'const g=require(process.env.GUARD);let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.exit(g.isQuotaExhaustion(s)?0:1));' 2>/dev/null
}

# session_alive <pid>: exit 0 while the session process is alive, 1 once it is
# gone. `kill -0` sends no signal — it only probes existence/permission.
session_alive() { kill -0 "${1:?session_alive needs a pid}" 2>/dev/null; }

# resolve_session_pid: print the PID of the Claude Code session that (transitively)
# launched us, so the loop can watch it. MUST be called in the FOREGROUND, before
# any fork/disown, while $PPID still chains up to the session. Prefers an explicit
# MINSPEC_SESSION_PID; else walks up the process tree to the nearest `claude`
# ancestor; else falls back to $PPID (a manual run's own shell — so a hand-started
# continuous drain still dies with the terminal that launched it).
resolve_session_pid() {
  if [[ -n "${MINSPEC_SESSION_PID:-}" ]] && kill -0 "${MINSPEC_SESSION_PID}" 2>/dev/null; then
    printf '%s' "$MINSPEC_SESSION_PID"; return 0
  fi
  local pid="$PPID" guard=0 comm args
  while [[ -n "$pid" && "$pid" != "0" && "$pid" != "1" && "$guard" -lt 20 ]]; do
    comm="$(ps -o comm= -p "$pid" 2>/dev/null | tr -d ' \t' || true)"
    args="$(ps -o args= -p "$pid" 2>/dev/null || true)"
    if [[ "$comm" == *claude* || "$args" == *claude-code* || "$args" == *anthropic.claude* ]]; then
      printf '%s' "$pid"; return 0
    fi
    pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' \t' || true)"
    guard=$((guard + 1))
  done
  printf '%s' "$PPID"
  return 0
}

# assert_fresh: the #481 stale-checkout guard, re-usable per cycle. Returns 0 when
# the checkout is at/ahead of origin/main (safe to run the pipeline), 1 when it is
# behind (the PR/reviewer/gate orchestration dispatch-issue.sh runs may be stale).
# MINSPEC_ALLOW_STALE=1 downgrades the stop to a warning. Fails OPEN on fetch/ref
# errors (network/auth) — an unrelated infra blip must not masquerade as staleness.
assert_fresh() {
  git fetch origin main -q 2>/dev/null || true
  local behind
  behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
  if [[ "${behind:-0}" -gt 0 ]]; then
    if [[ "${MINSPEC_ALLOW_STALE:-}" == "1" ]]; then
      echo "WARNING: checkout is $behind commit(s) behind origin/main — proceeding anyway (MINSPEC_ALLOW_STALE=1)." >&2
      return 0
    fi
    echo "ERROR: checkout is $behind commit(s) behind origin/main — the pipeline orchestration (PR/reviewer/gate) dispatch-issue.sh runs may be stale. Pull main (or run from a fresh checkout) before draining. Override (not recommended): MINSPEC_ALLOW_STALE=1" >&2
    return 1
  fi
  return 0
}

# run_cycle: ONE drain pass = triage inbox → dispatch every resulting agent-ready
# issue → sweep open PRs and remediate fixable problems, all sequentially. Return
# code drives the continuous loop's scheduling (it is ignored by the one-shot path):
#   0  — cycle completed (work done or nothing ready).
#   42 — a Claude quota/limit signal was seen mid-dispatch → loop should back off.
#   43 — persistent freshness failure (behind main) → loop should stop cleanly.
#   1  — a transient error → loop counts it toward MAX_CONSEC_FAIL, keeps going.
run_cycle() {
  local inbox_issues all_ready n out drc cap

  # Step 1: triage inbox issues → labels T1/T2 as agent-ready
  inbox_issues=$(gh issue list --repo "$REPO" --label "inbox" \
    --json number --jq '.[].number' 2>/dev/null || true)
  if [[ -n "$inbox_issues" ]]; then
    echo "[drain] triaging $(echo "$inbox_issues" | wc -l | tr -d ' ') inbox issue(s)..."
    for n in $inbox_issues; do
      echo "[drain] triaging #$n..."
      "$TRIAGE" "$n" || echo "[drain] WARNING: triage failed for #$n"
    done
  fi

  # Step 2: drain whatever is now agent-ready (original + newly triaged)
  all_ready=$(gh issue list --repo "$REPO" --label "agent-ready" \
    --json number --jq '.[].number' 2>/dev/null || true)
  if [[ -z "$all_ready" ]]; then
    echo "[drain] no agent-ready issues after triage — cycle done."
    return 0
  fi

  # Freshness gate (#481) — checked HERE, only once real dispatch is imminent, so
  # an empty-inbox continuous cycle never blocks on it. Stale ⇒ stop the loop.
  if ! assert_fresh; then
    return 43
  fi
  # Tell each dispatch-issue.sh child we already validated freshness this cycle,
  # so it does not re-fetch per issue (drain owns the check; children trust it).
  export MINSPEC_FRESHNESS_CHECKED=1

  echo "[drain] dispatching $(echo "$all_ready" | wc -l | tr -d ' ') agent-ready issue(s)..."
  for n in $all_ready; do
    echo "[drain] dispatching #$n..."
    # Stream the dispatch output live to the drain log (via tee) AND capture it so
    # we can classify a quota/limit signal from the text (dispatch-issue.sh exits 0
    # even on a quota-blocked claude run — the signal is in the OUTPUT, so we read
    # the text, never the exit code, exactly as review-branch.sh does).
    cap=$(mktemp)
    if "$DISPATCH" "$n" 2>&1 | tee "$cap"; then drc=0; else drc=$?; fi
    out=$(cat "$cap" 2>/dev/null || true); rm -f "$cap"
    if is_quota <<<"$out"; then
      echo "[drain] Claude usage-limit signal while dispatching #$n — pausing this cycle (will back off, not fail)."
      return 42
    fi
    [[ "$drc" -ne 0 ]] && echo "[drain] WARNING: dispatch failed for #$n (rc=$drc)"
  done

  # Step 3: sweep open PRs for FIXABLE problems and auto-remediate them (conflicts
  # are surfaced, not touched). remediate-pr.sh owns ALL the decision-making —
  # branch-prefix scope, classification, attempt caps — so the drain stays thin and
  # there is ONE source of truth for what "fixable" means. We only enumerate open,
  # non-draft PRs and hand each to it; a clean/out-of-scope PR self-skips cheaply
  # (one gh fetch, no agent). Disable with MINSPEC_DRAIN_REMEDIATE_PRS=0.
  if [[ "${MINSPEC_DRAIN_REMEDIATE_PRS:-1}" != "0" ]]; then
    local open_prs pr rcap rout
    open_prs=$(gh pr list --repo "$REPO" --state open --json number,isDraft \
      --jq '.[] | select(.isDraft==false) | .number' 2>/dev/null || true)
    if [[ -n "$open_prs" ]]; then
      echo "[drain] sweeping $(echo "$open_prs" | wc -l | tr -d ' ') open PR(s) for fixable problems..."
      for pr in $open_prs; do
        # Same quota discipline as dispatch: remediation may launch claude, which
        # exits 0 even under a usage limit — the signal is in the OUTPUT. Capture
        # + classify; a quota hit pauses the whole cycle (loop backs off).
        rcap=$(mktemp)
        "$REMEDIATE" "$pr" 2>&1 | tee "$rcap" || true
        rout=$(cat "$rcap" 2>/dev/null || true); rm -f "$rcap"
        if is_quota <<<"$rout"; then
          echo "[drain] Claude usage-limit signal while remediating PR #$pr — pausing this cycle (will back off, not fail)."
          return 42
        fi
      done
    fi
  fi

  echo "[drain] cycle done."
  return 0
}

# wait_interval <seconds>: sleep in POLL-sized chunks, bailing the moment the
# session dies so the loop reacts within MINSPEC_DRAIN_POLL, not a whole interval.
wait_interval() {
  local remaining="$1" chunk
  while (( remaining > 0 )); do
    session_alive "$SESSION_PID" || return 0
    chunk=$(( remaining < POLL ? remaining : POLL ))
    sleep "$chunk"
    remaining=$(( remaining - chunk ))
  done
}

# run_loop: the session-scoped continuous scheduler. Repeats run_cycle until the
# session ends, the wall-clock cap is hit, freshness fails persistently, or too
# many consecutive cycle errors accrue. Quota signals pause-and-retry; a single
# cycle error never kills the loop (log + continue).
run_loop() {
  local deadline consec=0 rc
  deadline=$(( $(date +%s) + MAX_LIFETIME ))
  echo "[drain] continuous loop started (session=$SESSION_PID, interval=${INTERVAL}s, quota_backoff=${QUOTA_BACKOFF}s, max_lifetime=${MAX_LIFETIME}s)."
  while :; do
    if ! session_alive "$SESSION_PID"; then
      echo "[drain] session $SESSION_PID ended — stopping loop (drain dies with the session)."; break
    fi
    if (( $(date +%s) >= deadline )); then
      echo "[drain] max lifetime (${MAX_LIFETIME}s) reached — stopping loop (backstop cap)."; break
    fi

    rc=0; run_cycle || rc=$?
    case "$rc" in
      0)
        consec=0
        wait_interval "$INTERVAL"
        ;;
      42)
        # Quota window exhausted (#609): pause, do NOT count as a failure, and
        # keep probing — the window resets on its own and the next cycle resumes.
        consec=0
        echo "[drain] backing off ${QUOTA_BACKOFF}s for the quota window to reset."
        wait_interval "$QUOTA_BACKOFF"
        ;;
      43)
        echo "[drain] persistent freshness failure (behind origin/main) — stopping loop cleanly. Pull main to resume next session."
        break
        ;;
      *)
        consec=$((consec + 1))
        echo "[drain] cycle error (rc=$rc) — ${consec}/${MAX_CONSEC_FAIL} consecutive."
        if (( consec >= MAX_CONSEC_FAIL )); then
          echo "[drain] $consec consecutive cycle errors — stopping loop cleanly (likely a persistent auth/config failure, not transient)."
          break
        fi
        wait_interval "$INTERVAL"
        ;;
    esac
  done
  echo "[drain] loop exited."
}

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
  --session-alive)
    # Pure seam: is the session (or any pid) still alive?
    if session_alive "${2:?Usage: drain-inbox.sh --session-alive <pid>}"; then exit 0; else exit 1; fi
    ;;
  --should-continue)
    # Pure seam: combined loop guard = session-alive AND before the lifetime cap.
    # Exit 0 (print "continue") to keep looping; exit 1 (print the stop reason) to
    # stop. Mirrors the checks run_loop makes at the top of each iteration.
    _pid="${2:?Usage: drain-inbox.sh --should-continue <pid> <deadline-epoch>}"
    _deadline="${3:?Usage: drain-inbox.sh --should-continue <pid> <deadline-epoch>}"
    if (( $(date +%s) >= _deadline )); then echo "max-lifetime reached"; exit 1; fi
    if ! session_alive "$_pid"; then echo "session $_pid ended"; exit 1; fi
    echo "continue"; exit 0
    ;;
  --is-quota)
    # Pure seam: classify combined agent output (stdin) as quota/limit or not.
    if is_quota; then exit 0; else exit 1; fi
    ;;
  --resolve-session-pid)
    resolve_session_pid; echo
    exit 0
    ;;
  --dry-run) DRY_RUN=true ;;
  --continuous) CONTINUOUS=true ;;
  --once) CONTINUOUS=false ;;
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
    # The session path drains continuously by default (#239) — the whole point is
    # to keep piggybacking new agent-ready work onto the live session.
    CONTINUOUS=true
    ;;
  "") ;;
  *) echo "Unknown arg: $1"; exit 1 ;;
esac

# Global opt-out (#239): MINSPEC_DRAIN_CONTINUOUS=0 forces pure one-shot even on
# --auto/--continuous, for anyone who wants the old single-pass behaviour back.
[[ "${MINSPEC_DRAIN_CONTINUOUS:-1}" == "0" ]] && CONTINUOUS=false

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

# Nothing to do right now. A one-shot (or any dry-run) exits quietly, unchanged.
# A CONTINUOUS run still starts its loop even on an empty inbox — new agent-ready
# work may arrive later in the session, which is exactly what #239 is for.
if [[ "$TOTAL" -eq 0 ]] && { ! $CONTINUOUS || $DRY_RUN; }; then
  exit 0
fi

if [[ "$TOTAL" -gt 0 ]]; then
  echo "📬  $INBOX_COUNT inbox + $READY_COUNT agent-ready issue(s) pending"
fi

if $DRY_RUN; then
  echo "    (dry-run — run scripts/drain-inbox.sh to triage + dispatch)"
  exit 0
fi

# One-shot manual runs keep the fail-loud FOREGROUND stale-checkout guard (#481)
# so a dev running `scripts/drain-inbox.sh` sees the error and a non-zero exit,
# rather than having it buried in the background log. (The continuous loop instead
# re-checks freshness inside every cycle via assert_fresh, since main can advance
# mid-session — it cannot hard-exit the foreground for a condition that may not
# exist yet.) See the drain→dispatch stale-pipeline rationale in dispatch-issue.sh.
if ! $CONTINUOUS; then
  if [[ "${MINSPEC_FRESHNESS_CHECKED:-}" != "1" ]]; then
    if ! assert_fresh; then
      exit 1
    fi
    export MINSPEC_FRESHNESS_CHECKED=1
  fi
fi

# Resolve the session anchor NOW, in the foreground, while $PPID still chains up to
# the Claude session (after the fork+disown below the loop is reparented and this
# ancestry is gone). Only needed for the continuous loop.
SESSION_PID=""
if $CONTINUOUS; then
  SESSION_PID="$(resolve_session_pid)"
fi

# Only one drain process at a time. The lock holds the background driver's PID; if
# a previous driver died WITHOUT its EXIT trap firing (e.g. SIGKILL), the PID is
# dead and we reclaim the stale lock rather than blocking every future session.
if [[ -f "$LOCK" ]]; then
  LOCK_PID=$(cat "$LOCK" 2>/dev/null || echo "")
  if [[ -n "$LOCK_PID" ]] && kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "⚠️   Drain already running (PID $LOCK_PID, log: $LOG) — skipping."
    exit 0
  fi
  echo "ℹ️   Reclaiming stale drain lock (holder PID ${LOCK_PID:-?} no longer running)."
  rm -f "$LOCK"
fi

(
  # $BASHPID, NOT $$: inside a subshell `$$` is still the PARENT script's PID
  # (POSIX keeps it constant across subshells), and the parent exits right after
  # `disown` below — so writing $$ would record a PID that is dead within
  # milliseconds, and the stale-lock reclaim above would then fire on EVERY later
  # session and spawn a second concurrent loop (double-dispatch / quota abuse).
  # $BASHPID is this subshell's own PID (== $DRAIN_PID), i.e. the long-lived loop
  # the reclaim's `kill -0` must actually probe. (ai-review #676: BLOCKING/HIGH.)
  echo "$BASHPID" > "$LOCK"
  trap 'rm -f "$LOCK"' EXIT

  if $CONTINUOUS; then
    run_loop
  else
    run_cycle || true
    echo "[drain] done."
  fi
) >>"$LOG" 2>&1 &

DRAIN_PID=$!
disown "$DRAIN_PID"
if $CONTINUOUS; then
  echo "🔁  Continuous drain in background (PID $DRAIN_PID, session $SESSION_PID, every $((INTERVAL / 60))m; dies with the session; log: $LOG)"
else
  echo "🚀  Triage + drain in background (PID $DRAIN_PID, log: $LOG)"
fi
