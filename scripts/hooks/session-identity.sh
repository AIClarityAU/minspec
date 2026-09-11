#!/usr/bin/env bash
# session-identity.sh — which GitHub identity can this session reach? (#1816)
#
# Agent sessions belong in the claude-agent container, where no founder credential is
# reachable. A session launched on the HOST holds every founder credential by construction:
# a bare `gh` or `git push` acts as the founder. On 2026-09-11 three agent writes were
# recorded under the founder's account exactly that way, from a panel opened on the host,
# and nothing at session start said where the session was. This unit says it, every time,
# before anything is written.
#
# The check itself lives outside the repo, in ~/.claude/scripts: it is about this machine,
# not about MinSpec, and nothing here ships to adopters (constitution invariant 3). When it
# is missing this prints one line saying so.
#
#   * Location is instant (two /proc reads), so it is printed NOW, every session start.
#   * The full check takes ~10 s, so it runs in the background — one at a time per location
#     (flock), at most every 30 min — and its verdict is printed at the next session start
#     WITH ITS AGE. A check that stopped completing reads as stale, never as a quiet week.
#
# Its own file, like session-autonomy.sh, so a test can EXECUTE it without also firing the
# drain, the radar or the branch guardrail. Never fatal, and the background run is detached
# from the hook's stdout — a hook that held its pipe open would hold the session start.

IBC="$HOME/.claude/scripts/identity-boundary-check.sh"
STATE="${XDG_CACHE_HOME:-$HOME/.cache}/identity-boundary"
# Private state: the container's umask is 000, which made the verdict file world-writable —
# anything could have written a PASS into it.
umask 077
FRESH_S=1800      # re-run the full check once the last result is older than this
STALE_S=86400     # past this, say the background check has stopped completing

if [ ! -x "$IBC" ]; then
  echo "🔑 Identity: check not installed ($IBC) — this session's location is unknown (#1816)."
  exit 0
fi

human_age() {
  local s=$1
  if   [ "$s" -lt 3600 ];  then echo "$((s / 60))m"
  elif [ "$s" -lt 86400 ]; then echo "$((s / 3600))h"
  else                          echo "$((s / 86400))d"; fi
}

loc=$(timeout 5 "$IBC" --location 2>/dev/null); lrc=$?
where="${loc#IDENTITY-LOCATION [}"; where="${where%]}"     # e.g. "HOST (k7, pid1=systemd)"
where=$(printf '%s' "$where" | tr -d '[:cntrl:]')          # display-only, but never a terminal escape
case "$lrc" in
  0) ;;
  1) cat <<EOF
⚠️  IDENTITY: this session is running on the $where, not in the claude-agent
    container. A bare \`gh\` or \`git push\` acts as the FOUNDER here. Mint the bot token for
    every GitHub write — GH_TOKEN="\$(~/.claude/scripts/gh-app-token.sh)" gh … — never push
    with the founder's credentials, and ask the human to relaunch this panel inside the
    container (#1816).
EOF
  ;;
  *) echo "⚠️  IDENTITY: could not establish whether this session is in the container (${where:-no answer}, exit $lrc) — treat it as the HOST (#1816)." ;;
esac

host=$(cat /proc/sys/kernel/hostname 2>/dev/null || echo unknown)
mkdir -p "$STATE" 2>/dev/null
last="$STATE/$host.last"
now=$(date +%s)
age_s=""
[ -s "$last" ] && age_s=$(( now - $(stat -c %Y "$last" 2>/dev/null || echo "$now") ))

verdict=""
[ -n "$age_s" ] && { verdict=$(grep '^IDENTITY-BOUNDARY ' "$last" 2>/dev/null | tail -1); verdict="${verdict#*]: }"; }
if [ -z "$age_s" ]; then
  echo "🔑 Identity: no full check has completed here yet — one is running in the background."
elif [ -z "$verdict" ]; then
  # The writer only ever moves a file with a verdict into place, so this is a damaged
  # record. Unknown is the honest reading — not a PASS, and not a FAIL either.
  echo "⚠️  IDENTITY: the last full-check record has no verdict ($last) — treat the result as unknown; a new check is running (#1816)."
  age_s=$FRESH_S
else
  stale=""
  [ "$age_s" -ge "$STALE_S" ] && stale=" — STALE: the background check has not completed for $(human_age "$age_s")"
  case "$lrc/$verdict" in
    0/PASS*) echo "🔑 Identity: container · last full check $(human_age "$age_s") ago: ${verdict%% (*}$stale" ;;
    0/*)     cat <<EOF
⚠️  IDENTITY: the last full check FAILED inside the container ($(human_age "$age_s") ago): $verdict
    A founder credential may be reachable from agent sessions. See which path with
    ~/.claude/scripts/identity-boundary-check.sh, and tell the human before any GitHub write (#1816).$stale
EOF
    ;;
    *)       echo "    Last full check here ($(human_age "$age_s") ago): $verdict$stale" ;;
  esac
fi

if [ -z "$age_s" ] || [ "$age_s" -ge "$FRESH_S" ]; then
  (
    exec 9>"$STATE/$host.lock"
    if command -v flock >/dev/null 2>&1; then flock -n 9 || exit 0; fi
    tmp="$last.$$"
    timeout 300 "$IBC" >"$tmp" 2>&1
    # Only a run that reached its verdict replaces the last result; a killed or hung run
    # leaves the old one in place, where its growing age shows.
    if grep -q '^IDENTITY-BOUNDARY ' "$tmp" 2>/dev/null; then mv -f "$tmp" "$last"; else rm -f "$tmp"; fi
  ) </dev/null >/dev/null 2>&1 &
  disown 2>/dev/null || true
fi
exit 0
