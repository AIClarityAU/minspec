#!/usr/bin/env bash
# drain-service.sh - the durable owner of the inbox drain (#3011).
#
# Before this, the drain (`scripts/drain-inbox.sh`) was started by a keeper session
# inside the agent container and died with it, so somebody had to brief a new keeper
# every few hours. This script is what a host user unit (minspec-drain.service, beside
# this file) runs instead. The unit has Restart=always; this script is the part that
# runs INSIDE the container, reached with `docker exec`, the same way the editor
# wrapper reaches it (claude-agent-wrapper, /etc/nixos/home.nix).
#
# The four rules it keeps, each covered by packages/minspec/tests/drain-service.test.ts:
#
#   1. Never on the host. On the host the founder's git credentials are ambient and
#      lib/gh-bot.sh leaves `git push` alone, so a drain there pushes AS THE FOUNDER.
#      Before anything else, the name of pid 1 is read from /proc/1/comm. Only
#      docker-init is the agent container. Anything else, or a name that cannot be
#      read, refuses with exit 78, which the unit lists in RestartPreventExitStatus so
#      a refusal is a visible failed unit, not a restart loop. The path is fixed here
#      on purpose: no environment variable moves it.
#   2. One drain at a time. The drain's own lock (/tmp/minspec-drain-inbox.lock) still
#      decides. If a live drain already holds it (a keeper's, or the session-start
#      hook's), this script ADOPTS it: it waits for that pid to end and starts nothing.
#      If it starts the drain itself, the keeper path and the hook then see the lock and
#      skip, as they always have. A second copy of this script exits 75 on its own lock.
#   3. Pause survives restart. The pause marker (`drain-inbox.sh --pause`, a file in the
#      primary checkout, so it outlives the container) is read through
#      `drain-inbox.sh --paused`, the drain's own predicate. While it is present this
#      script starts no drain at all: it idles and polls. A drain that is already
#      running idles itself on the same marker between cycles. So a restart, an 8 h
#      lifetime end, or a container restart never turns a paused drain back on.
#   4. A failure is visible. When a drain ends, the lines it wrote to the drain log
#      since this script started waiting on it are printed here (the unit's journal),
#      and the exit code says how it ended: 0 for a normal end (lifetime cap, or a SIGTERM someone
#      else sent), 1 for
#      the loop's "consecutive cycle errors" stop, a launch that failed, or a drain
#      that vanished without its exit line. Those failures are printed and then RETRIED with
#      backoff inside the same start (#3095): exiting would spend one of the unit's
#      StartLimitBurst starts per failure, and a burst of transient failures after a host
#      resume used up the limit and left the unit failed for good. Only a normal end exits 0.
#
# A deliberate stop is `systemctl --user stop minspec-drain`. Killing a `docker exec`
# client does not kill the process it started in the container, so the unit's
# ExecStop runs `drain-service.sh stop`, which sends SIGTERM to this script; this
# script then sends SIGTERM to the drain holding the lock (the drain's own trap
# releases its lock and TERMs its children) and waits up to STOP_GRACE seconds.
# systemd never restarts a unit that was stopped on purpose.
#
# Usage (inside the container; the unit runs these):
#   drain-service.sh run       supervise: idle while paused, else adopt or start a drain
#   drain-service.sh stop      SIGTERM the running supervisor and wait for it
#   drain-service.sh status    print the supervisor pid, the drain pid, paused or not
#   drain-service.sh --is-container <comm-file>   pure seam: exit 0 iff the file says docker-init
#
# Environment (the drain-inbox.sh names are shared with it, on purpose):
#   MINSPEC_DRAIN_LOCK           the drain's lock (default /tmp/minspec-drain-inbox.lock)
#   MINSPEC_DRAIN_LOG            the drain's log  (default /tmp/minspec-drain-inbox.log)
#   MINSPEC_DRAIN_SERVICE_DRAIN  the drain script (default ../drain-inbox.sh)
#   MINSPEC_DRAIN_SERVICE_LOCK   this script's own lock (default /tmp/minspec-drain-service.lock)
#   MINSPEC_DRAIN_SERVICE_POLL   seconds between checks (default 30)
#   MINSPEC_DRAIN_SERVICE_STOP_GRACE  seconds to wait for the drain on stop (default 90)
#   MINSPEC_DRAIN_SERVICE_RETRY_BASE  first backoff after a failed launch/end (default 15, doubles)
#   MINSPEC_DRAIN_SERVICE_RETRY_MAX   backoff ceiling in seconds (default 600)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER_PID1=docker-init
PID1_COMM=/proc/1/comm

# Same defaults as drain-inbox.sh (its lines 220 and 222). The test pins them equal.
DRAIN_LOCK="${MINSPEC_DRAIN_LOCK:-/tmp/minspec-drain-inbox.lock}"
DRAIN_LOG="${MINSPEC_DRAIN_LOG:-/tmp/minspec-drain-inbox.log}"
DRAIN="${MINSPEC_DRAIN_SERVICE_DRAIN:-${SCRIPT_DIR}/../drain-inbox.sh}"
SVC_LOCK="${MINSPEC_DRAIN_SERVICE_LOCK:-/tmp/minspec-drain-service.lock}"
POLL="${MINSPEC_DRAIN_SERVICE_POLL:-30}"
STOP_GRACE="${MINSPEC_DRAIN_SERVICE_STOP_GRACE:-90}"
# Backoff between retries of a failed launch or failed drain end, inside ONE start (#3095).
RETRY_BASE="${MINSPEC_DRAIN_SERVICE_RETRY_BASE:-15}"
RETRY_MAX="${MINSPEC_DRAIN_SERVICE_RETRY_MAX:-600}"

say() { echo "[drain-service] $*"; }

# is_container <comm-file>: exit 0 iff the file's content is exactly docker-init.
# An unreadable or empty file is NOT the container.
is_container() {
  local comm=""
  comm="$(cat "$1" 2>/dev/null)" || return 1
  [[ "$comm" == "$CONTAINER_PID1" ]]
}

# drain_holder: print the pid in the drain lock iff that pid is alive; exit 1 otherwise.
drain_holder() {
  local pid=""
  [[ -f "$DRAIN_LOCK" ]] || return 1
  pid="$(cat "$DRAIN_LOCK" 2>/dev/null)" || return 1
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  printf '%s' "$pid"
}

# paused: the drain's own predicate, so the marker path is decided in one place.
paused() { "$DRAIN" --paused >/dev/null 2>&1 9>&-; }

log_size() { stat -c %s "$DRAIN_LOG" 2>/dev/null || echo 0; }

# nap <secs>: `sleep & wait`, so a SIGTERM is handled at once, not after the sleep.
nap() { sleep "$1" & wait $! 2>/dev/null; }

STOPPING=0
HOLDER=""
on_term() {
  trap '' TERM
  STOPPING=1
  say "stopping on SIGTERM."
  local pid waited=0
  if pid="$(drain_holder)"; then
    say "sending SIGTERM to drain pid $pid."
    kill -TERM "$pid" 2>/dev/null
    while kill -0 "$pid" 2>/dev/null && (( waited < STOP_GRACE )); do
      sleep 1; waited=$((waited + 1))
    done
    if kill -0 "$pid" 2>/dev/null; then
      say "WARNING: drain pid $pid still running after ${STOP_GRACE}s. A cycle's foreground step defers the drain's SIGTERM trap; it stops when that step returns."
    else
      say "drain pid $pid stopped."
    fi
  fi
  exit 0
}

# report_end <log-offset> <pid>: print what the drain wrote since <log-offset> and
# return the exit code that describes how it ended.
report_end() {
  local off="$1" pid="$2" tail_text
  tail_text="$(tail -c +"$((off + 1))" "$DRAIN_LOG" 2>/dev/null | tail -n 8)"
  say "drain pid $pid ended. Last lines of $DRAIN_LOG:"
  printf '%s\n' "$tail_text" | sed 's/^/    /'
  if grep -q 'consecutive cycle errors' <<<"$tail_text"; then
    say "FAILED: the drain stopped on consecutive cycle errors."
    return 1
  fi
  if ! grep -q -e 'loop exited' -e 'stopping on SIGTERM' <<<"$tail_text"; then
    say "FAILED: drain pid $pid ended without writing its exit line (killed, or its log is elsewhere)."
    return 1
  fi
  return 0
}

# watch <pid> <log-offset>: wait while the drain lives, then report how it ended.
watch() {
  local pid="$1" off="$2"
  HOLDER="$pid"
  while kill -0 "$pid" 2>/dev/null; do nap "$POLL"; done
  report_end "$off" "$pid"
}

# retry_wait <delay-var>: say it, sleep that long, then double the variable up to RETRY_MAX.
retry_wait() {
  local -n _d="$1"
  say "retrying in ${_d}s (inside this start; no systemd restart is spent)."
  nap "$_d"
  _d=$(( _d * 2 > RETRY_MAX ? RETRY_MAX : _d * 2 ))
}

cmd_run() {
  if ! is_container "$PID1_COMM"; then
    say "REFUSING: pid 1 is '$(cat "$PID1_COMM" 2>/dev/null || echo unreadable)', not $CONTAINER_PID1. The drain must run inside the agent container: on the host it would push as the founder."
    exit 78
  fi
  exec 9>>"$SVC_LOCK" || { say "cannot open $SVC_LOCK"; exit 1; }
  if ! flock -n 9; then
    say "another drain-service is already running (lock $SVC_LOCK); not starting a second."
    exit 75
  fi
  echo "$$" > "$SVC_LOCK.pid"
  trap on_term TERM

  # A failure retries here with backoff, in the SAME start. Exiting non-zero would spend
  # one of the unit's StartLimitBurst starts per failure, and a run of transient failures
  # after a host resume would mark the unit failed for good (#3095). Only a normal end
  # (exit 0) leaves this loop.
  local was_paused=0 pid off rc delay="$RETRY_BASE"
  while :; do
    if pid="$(drain_holder)"; then
      say "adopting the running drain (pid $pid); starting nothing."
      if watch "$pid" "$(log_size)"; then exit 0; fi
      retry_wait delay; continue
    fi
    if paused; then
      (( was_paused )) || say "PAUSED: pause marker present; no drain started. Resume: scripts/drain-inbox.sh --resume"
      was_paused=1
      nap "$POLL"; continue
    fi
    (( was_paused )) && say "RESUMED: pause marker gone."
    was_paused=0
    off="$(log_size)"
    say "starting the drain: $DRAIN --continuous"
    rc=0
    # 9>&-: the drain's loop outlives this call, and must not inherit this script's
    # lock, or a restarted supervisor would find the lock held and exit 75.
    MINSPEC_SESSION_PID=$$ "$DRAIN" --continuous 9>&- || rc=$?
    if (( rc != 0 )); then
      say "FAILED: drain launch exited $rc (see the lines above)."
      retry_wait delay; continue
    fi
    # The launcher forks the loop and returns; the loop writes its pid to the lock a
    # moment later. Give it a few seconds before calling the launch a failure.
    local tries=0
    until pid="$(drain_holder)" || (( tries >= 20 )); do sleep 0.5; tries=$((tries + 1)); done
    if [[ -z "$pid" ]]; then
      say "FAILED: the drain launch exited 0 but no live pid holds $DRAIN_LOCK."
      retry_wait delay; continue
    fi
    if watch "$pid" "$off"; then exit 0; fi
    retry_wait delay
  done
}

cmd_stop() {
  local pid=""
  pid="$(cat "$SVC_LOCK.pid" 2>/dev/null)"
  if [[ ! "$pid" =~ ^[0-9]+$ ]] || ! kill -0 "$pid" 2>/dev/null; then
    say "no drain-service running."
    exit 0
  fi
  say "sending SIGTERM to drain-service pid $pid."
  kill -TERM "$pid"
  exec 9>>"$SVC_LOCK"
  if flock -w "$((STOP_GRACE + 15))" 9; then
    say "drain-service stopped."
    exit 0
  fi
  say "WARNING: drain-service pid $pid still holds $SVC_LOCK after $((STOP_GRACE + 15))s."
  exit 1
}

cmd_status() {
  local pid=""
  pid="$(cat "$SVC_LOCK.pid" 2>/dev/null)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    echo "service: running (pid $pid)"
  else
    echo "service: not running"
  fi
  if pid="$(drain_holder)"; then echo "drain:   running (pid $pid, log $DRAIN_LOG)"; else echo "drain:   not running"; fi
  if paused; then echo "pause:   PAUSED"; else echo "pause:   not paused"; fi
}

# Sourced (the test does this to point PID1_COMM at a fixture), define and return.
# Executed, dispatch. No environment variable can move PID1_COMM.
[[ "${BASH_SOURCE[0]}" == "$0" ]] || return 0

case "${1:-}" in
  run) cmd_run ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  --is-container) is_container "${2:?Usage: drain-service.sh --is-container <comm-file>}" ;;
  *) echo "Usage: drain-service.sh run|stop|status" >&2; exit 2 ;;
esac
