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
#   MINSPEC_DRAIN_SELF_REFRESH=0   — run the pipeline in place from SCRIPT_DIR
#                                    instead of a self-synced run dir (#773 opt-out).
#   MINSPEC_DRAIN_RUN_DIR=<path>   — where the self-synced run-dir worktree lives
#                                    (default /tmp/minspec-drain-run).
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

# ── Self-refreshing run directory (#773) ─────────────────────────────────────
# The drain is launched from the SHARED primary checkout, which goes stale as main
# advances (rule #8 forbids pulling it) — and auto-merge makes main advance faster.
# The old behaviour self-TERMINATED on staleness (rc 43 → loop exit), so the drain
# died and auto-fix/dispatch never ran. Instead, each cycle runs the pipeline
# scripts from a DEDICATED worktree hard-synced to origin/main: fresh by
# construction, self-healing, and NEVER touching the primary's HEAD/working tree
# (rule #8). Overridable for tests; opt out with MINSPEC_DRAIN_SELF_REFRESH=0.
DRAIN_RUN_DIR="${MINSPEC_DRAIN_RUN_DIR:-/tmp/minspec-drain-run}"
PRIMARY_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "${SCRIPT_DIR}/.." && pwd))"

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

# ensure_fresh_run_dir (#773): guarantee the pipeline scripts we run this cycle are
# CURRENT, by maintaining a dedicated worktree hard-synced to origin/main and
# repointing TRIAGE/DISPATCH/REMEDIATE at ITS copies. This replaces the old
# terminal "die on staleness" (rc 43) with self-healing: staleness is impossible by
# construction because we resync every cycle.
#
# RULE #8 SAFETY (load-bearing): every git op targets an EXPLICIT dir via `-C`.
# `git -C "$PRIMARY_ROOT" fetch` is read-only (never moves HEAD). `git worktree add`
# creates a SEPARATE worktree — it does not switch the primary's branch. `git -C
# "$DRAIN_RUN_DIR" reset --hard` acts on the RUN DIR only. NONE of these touch the
# shared primary checkout's HEAD or working tree, so concurrent sessions are safe.
#
# Fails OPEN, never fatal: if the worktree can't be created/synced (git/network),
# it logs and falls back to the in-place SCRIPT_DIR scripts (whose own #481 guard
# then applies) — the loop keeps going and retries next cycle. Opt out entirely
# with MINSPEC_DRAIN_SELF_REFRESH=0 (runs in place, pre-#773 behaviour).
ensure_fresh_run_dir() {
  [[ "${MINSPEC_DRAIN_SELF_REFRESH:-1}" == "0" ]] && return 0
  [[ -z "$DRAIN_RUN_DIR" ]] && { echo "[drain] WARNING: MINSPEC_DRAIN_RUN_DIR is empty — self-refresh disabled, running in place." >&2; return 0; }

  # SAFETY (rule #8): the run dir must resolve OUTSIDE the primary checkout — we
  # hard-reset and may remove it. CANONICALIZE both paths first (readlink -m resolves
  # symlinks + `..`/`.`/`//` without requiring existence), so a run dir symlinked or
  # relatively-pointed INTO the primary cannot slip past a purely-lexical compare
  # (#773 review, BLOCKING). Require absolute too.
  local run_canon primary_canon
  run_canon="$(readlink -m -- "$DRAIN_RUN_DIR" 2>/dev/null || echo "$DRAIN_RUN_DIR")"
  primary_canon="$(readlink -m -- "$PRIMARY_ROOT" 2>/dev/null || echo "$PRIMARY_ROOT")"
  case "$run_canon" in
    "$primary_canon"|"$primary_canon"/*)
      echo "[drain] WARNING: MINSPEC_DRAIN_RUN_DIR ('$DRAIN_RUN_DIR' → '$run_canon') is inside the primary checkout — self-refresh disabled, running in place." >&2
      return 0 ;;
    /*) : ;;  # absolute, outside primary — ok
    *)  echo "[drain] WARNING: MINSPEC_DRAIN_RUN_DIR ('$DRAIN_RUN_DIR') must be an absolute path — self-refresh disabled." >&2
        return 0 ;;
  esac

  git -C "$PRIMARY_ROOT" fetch origin main -q 2>/dev/null || true

  # (Re)create the worktree if it is missing or not a usable checkout. Use git's own
  # worktree removal (not a blind rm) to unregister a stale/broken one; only rm a
  # leftover path when it is NOT a populated checkout, so we never nuke real content.
  if [[ ! -e "${DRAIN_RUN_DIR}/scripts/drain-inbox.sh" ]]; then
    git -C "$PRIMARY_ROOT" worktree remove --force "$DRAIN_RUN_DIR" 2>/dev/null || true
    git -C "$PRIMARY_ROOT" worktree prune 2>/dev/null || true
    [[ -e "$DRAIN_RUN_DIR" && ! -d "${DRAIN_RUN_DIR}/scripts" ]] && rm -rf "$DRAIN_RUN_DIR" 2>/dev/null || true
    if ! git -C "$PRIMARY_ROOT" worktree add --detach "$DRAIN_RUN_DIR" origin/main 2>/dev/null; then
      echo "[drain] WARNING: could not create run-dir worktree at $DRAIN_RUN_DIR — running in place (SCRIPT_DIR)." >&2
      return 0
    fi
  fi

  # DEFENSE IN DEPTH (rule #8): even past the lexical guard, refuse to reset/repoint if
  # git reports the run dir IS the primary working tree (a symlink/bind that fooled the
  # path compare). The reset below must never touch the primary.
  local run_toplevel
  run_toplevel="$(git -C "$DRAIN_RUN_DIR" rev-parse --show-toplevel 2>/dev/null || echo '')"
  if [[ -z "$run_toplevel" || "$(readlink -m -- "$run_toplevel" 2>/dev/null || echo "$run_toplevel")" == "$primary_canon" ]]; then
    echo "[drain] WARNING: run dir resolves to the primary checkout — self-refresh disabled (rule #8), running in place." >&2
    return 0
  fi

  # Hard-sync to origin/main — the self-heal. On any git error we do NOT trust the run
  # dir (see the verify-before-repoint below); we never die.
  git -C "$DRAIN_RUN_DIR" reset --hard origin/main -q 2>/dev/null \
    || echo "[drain] WARNING: could not resync run-dir to origin/main." >&2

  # node/tsx helpers (render-review-signals.mjs, auto-merge-gate.ts) need the
  # workspace's hoisted modules; symlink the primary's so children resolve without a
  # per-cycle install. HONEST CAVEAT (#773 review, minor): this uses the primary's
  # COMPILED deps — including @aiclarity/shared's gitignored `out/` — which can lag
  # origin/main's source. Those helpers are best-effort and degrade if it mismatches
  # (the render block is skipped, not corrupted), so the staleness is accepted, not fatal.
  [[ -d "${PRIMARY_ROOT}/node_modules" ]] \
    && ln -sfn "${PRIMARY_ROOT}/node_modules" "${DRAIN_RUN_DIR}/node_modules" 2>/dev/null || true
  [[ -d "${PRIMARY_ROOT}/packages/minspec/node_modules" ]] \
    && ln -sfn "${PRIMARY_ROOT}/packages/minspec/node_modules" "${DRAIN_RUN_DIR}/packages/minspec/node_modules" 2>/dev/null || true

  # VERIFY the run dir is ACTUALLY at origin/main before trusting it (#773 review,
  # MAJOR). Only then repoint children + tell them freshness is validated. If the reset
  # failed (e.g. a leftover index.lock from a killed prior cycle left the run dir
  # behind), do NOT export MINSPEC_FRESHNESS_CHECKED — fall back to in-place so each
  # child's own #481 guard fires instead of silently running STALE orchestration.
  local run_head origin_head
  run_head="$(git -C "$DRAIN_RUN_DIR" rev-parse HEAD 2>/dev/null || echo 'norun')"
  origin_head="$(git -C "$PRIMARY_ROOT" rev-parse origin/main 2>/dev/null || echo 'noorigin')"
  if [[ "$run_head" == "$origin_head" && -x "${DRAIN_RUN_DIR}/scripts/dispatch-issue.sh" ]]; then
    TRIAGE="${DRAIN_RUN_DIR}/scripts/triage-inbox.sh"
    DISPATCH="${DRAIN_RUN_DIR}/scripts/dispatch-issue.sh"
    REMEDIATE="${DRAIN_RUN_DIR}/scripts/remediate-pr.sh"
    export MINSPEC_FRESHNESS_CHECKED=1
    echo "[drain] run dir verified at origin/main (${run_head:0:7}) — pipeline scripts are current."
  else
    echo "[drain] WARNING: run dir NOT verified at origin/main (run=${run_head:0:7} origin=${origin_head:0:7}) — running in place; children re-check freshness (#481)." >&2
  fi
  return 0
}

# sync_shared_checkouts (founder ask 2026-07-16): keep the SHARED human checkouts
# — this MinSpecPro plus the sibling scroogellm/sealbox repos — fast-forwarded to
# origin/main each cycle, so live editor sessions and this drain do not silently
# drift behind. STRICTLY SAFE by construction:
#   • fast-forward ONLY (`merge --ff-only`) — never reset/rebase/force; a diverged
#     or non-main checkout is left exactly as-is (another session may be live on it).
#   • only touches a checkout that is on `main` with NO real uncommitted content.
#   • `update-index --refresh` first clears STAT-dirty (a file whose mtime was
#     touched but whose content is identical to HEAD) so it does not block the ff —
#     this exact case (constitution.md) silently blocked syncing for hours.
# Read-only fetch + a guarded ff can never strand another session's work, so this
# is safe to run unconditionally at the top of every cycle. Disable with
# MINSPEC_DRAIN_SYNC_CHECKOUTS=0.
sync_shared_checkouts() {
  [[ "${MINSPEC_DRAIN_SYNC_CHECKOUTS:-1}" == "0" ]] && return 0
  local base d branch
  base="$(dirname "$PRIMARY_ROOT")"
  for d in "$PRIMARY_ROOT" "$base/scroogellm" "$base/sealbox"; do
    [[ -d "$d/.git" ]] || continue
    git -C "$d" fetch origin --prune -q 2>/dev/null || continue
    git -C "$d" update-index -q --refresh 2>/dev/null || true
    branch="$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
    if [[ "$branch" == "main" ]] \
        && git -C "$d" diff --quiet 2>/dev/null \
        && git -C "$d" diff --cached --quiet 2>/dev/null; then
      if [[ "$(git -C "$d" rev-list --count HEAD..origin/main 2>/dev/null || echo 0)" -gt 0 ]]; then
        git -C "$d" merge --ff-only origin/main -q 2>/dev/null \
          && echo "[drain] synced $(basename "$d") → $(git -C "$d" rev-parse --short HEAD)" \
          || echo "[drain] sync skip $(basename "$d") — main not fast-forwardable (diverged), left as-is"
      fi
    else
      echo "[drain] sync skip $(basename "$d") — branch=$branch or uncommitted changes, left as-is"
    fi
  done
}

# run_cycle: ONE drain pass = triage inbox → dispatch every resulting agent-ready
# issue → sweep open PRs and remediate fixable problems, all sequentially. Return
# code drives the
# continuous loop's scheduling (it is ignored by the one-shot path):
#   0  — cycle completed (work done or nothing ready).
#   42 — a Claude quota/limit signal was seen mid-dispatch → loop should back off.
#   1  — a transient error → loop counts it toward MAX_CONSEC_FAIL, keeps going.
# (There is no longer a terminal "stale" code: #773 self-heals the run dir each
#  cycle instead of stopping the loop when the checkout falls behind main.)
run_cycle() {
  local inbox_issues all_ready n out drc cap

  # #773: refresh the run dir FIRST, so triage/dispatch/remediate all execute the
  # CURRENT orchestration (self-heal, not die-on-stale). Never fatal — on failure it
  # falls back to in-place scripts and the cycle proceeds.
  ensure_fresh_run_dir

  # Keep the shared human checkouts (this repo + siblings) current with origin/main
  # — fast-forward-only, main-and-clean only, never force. Best-effort; a failure
  # here must never abort the cycle.
  sync_shared_checkouts || true

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

  # Freshness is guaranteed by ensure_fresh_run_dir at the top of this cycle (#773):
  # the pipeline scripts run from a worktree hard-synced to origin/main, and
  # MINSPEC_FRESHNESS_CHECKED is exported so the children trust it. No terminal
  # "die on stale" (the old rc-43 path) — staleness is impossible by construction.
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
  --refresh-run-dir)
    # Seam (#773): refresh the dedicated run dir and print the ref it synced to
    # (or "in-place" when self-refresh is off / fell back). Lets a test assert the
    # run dir tracks origin/main without driving the whole loop.
    ensure_fresh_run_dir
    if [[ "${MINSPEC_DRAIN_SELF_REFRESH:-1}" != "0" && -e "${DRAIN_RUN_DIR}/.git" ]]; then
      git -C "$DRAIN_RUN_DIR" rev-parse HEAD 2>/dev/null || echo "in-place"
    else
      echo "in-place"
    fi
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

# Freshness is no longer a fail-loud FOREGROUND gate (#773 supersedes the #481
# foreground guard): both the one-shot and continuous paths call run_cycle, which
# runs ensure_fresh_run_dir first and executes the pipeline from a run dir
# hard-synced to origin/main. A stale primary checkout no longer blocks a manual
# run — the drain self-heals instead of refusing. (dispatch-issue.sh keeps its own
# #481 guard for direct invocation.)

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
