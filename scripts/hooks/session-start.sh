#!/usr/bin/env bash
# session-start.sh — injected at Claude Code session start

# --- Lost panels (#2380, #2379) ---
# RUN FIRST, printed below the header. The hook's JSON (session id, folder, transcript
# path) arrives on standard input exactly once, and everything this script starts
# inherits that stream, so the unit that needs it has to read it before anything else
# can. Delegated to its own unit so it is tested by EXECUTION (see session-panel.py).
# Never fatal, but never silent either: a check that stopped running reads exactly like
# "no session lost its panel", which is how the dead-loop backstop went unnoticed for
# three weeks (#2379). So a non-zero exit is reported, with the last line of what the
# unit wrote on its way out: its error stream is captured, not discarded, so the notice
# says WHY and nobody has to re-run it by hand to find out. (-W ignore keeps an
# interpreter warning, which is not a failure, out of every session start.)
_PANEL="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)/session-panel.py"
_PANEL_OUT="$(python3 -W ignore "$_PANEL" start 2>&1)"
_PANEL_RC=$?

cat <<'SCOPE'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MinSpec Monorepo — Session Start
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Declare scope before writing code:
  Session scope: [one sentence]
  Project: minspec | scroogellm | shared | infra
  Type: bug | feat | explore | plan

MinSpec status: SDD Implement phase → specs/minspec/tasks.md
ScroogeLLM status: awaiting Specify phase (future session)

Topic drift → GitHub issue (AIClarityAU/minspec), not inline work.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCOPE

# Lost panels: what the unit at the top of this script found (#2380).
if [ "$_PANEL_RC" -ne 0 ]; then
  echo "⚠️  Lost-panel check did not run (exit $_PANEL_RC: $_PANEL) — a session that lost its panel is NOT being reported here (#2380)."
  _PANEL_WHY="$(printf '%s\n' "$_PANEL_OUT" | grep -v '^[[:space:]]*$' | tail -n 1 | LC_ALL=C tr -cd '[:print:]' | cut -c1-200)"
  if [ -n "$_PANEL_WHY" ]; then
    echo "    Why: $_PANEL_WHY"
  fi
elif [ -n "$_PANEL_OUT" ]; then
  printf '%s\n' "$_PANEL_OUT"
fi

# --- Identity boundary (#1816) ---
# Where this session runs decides whose GitHub account a bare `gh` or `git push` uses:
# on the host it is the founder's. First, so it is read before any write. Delegated to
# its own unit so it is tested by EXECUTION (see session-identity.sh). Never fatal.
"$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)/session-identity.sh" || true

# --- Concurrent-session branch guardrail (issue #168) ---
# One checkout has one HEAD. If a parallel session ran `git checkout`/`merge` in
# THIS folder, the branch moved under you and uncommitted work may be stranded on
# the old branch. Compare the branch to what the last session here left, and warn.
# State lives in $GIT_DIR (per-worktree, never committed) so worktrees don't
# false-positive against each other.
if git rev-parse --git-dir >/dev/null 2>&1; then
  cur="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  gitdir="$(git rev-parse --git-dir 2>/dev/null)"
  state="$gitdir/.claude-last-branch"
  dirty=""
  { git diff --quiet 2>/dev/null && git diff --cached --quiet 2>/dev/null; } || dirty="yes"
  if [ -f "$state" ]; then
    last="$(cat "$state" 2>/dev/null)"
    if [ -n "$last" ] && [ "$last" != "$cur" ]; then
      cat <<WARN
⚠️  BRANCH CHANGED since the last session in this folder: '$last' → '$cur'
    A parallel session may share this checkout. If you did NOT switch, your
    uncommitted work could be stranded on '$last'. Rule: one session = one
    worktree — \`scripts/new-worktree.sh <name>\` (global CLAUDE.md rule #8, #168).
WARN
    fi
  fi
  [ -n "$dirty" ] && echo "⚠️  Working tree is DIRTY on '$cur' — commit or stash BEFORE any branch switch."
  printf '%s' "$cur" > "$state" 2>/dev/null || true
  echo "Git: on '$cur'${dirty:+ (dirty)}. One session = one worktree; never checkout-switch this shared folder (#168)."
fi

# --- Agent-ready inbox drain (#239) ---
# Piggybacks pending issue work onto active sessions, in the background so the
# session starts immediately. Opt-in gated (#239): once you run
# `scripts/drain-inbox.sh --enable-auto`, this auto-triages + dispatches on every
# session start. Until then it only reports the pending count.
#
# On the opted-in `--auto` path the drain runs CONTINUOUSLY (#239): it keeps
# draining agent-ready work on an interval for as long as THIS Claude session is
# alive, then dies with the session (no daemon — drain-inbox.sh ties the loop to
# the session process; see its "Session-lifetime tie" header). It is also quota-
# aware (#609): a Claude usage-limit signal pauses the loop and it resumes once the
# window resets. Opt back to a single pass any time with MINSPEC_DRAIN_CONTINUOUS=0.
# Do NOT resolve the session PID or recompute drain state here — drain-inbox.sh
# owns that (single source of truth; the pref-path drift bug, #415, is why).
DRAIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/drain-inbox.sh"
# Ask drain-inbox.sh where the pref lives — do NOT recompute it here. This hook
# sits in scripts/hooks/, one level deeper than drain-inbox.sh, so an independent
# relative-path walk silently drifted (read scripts/.minspec/auto-drain while
# --enable-auto wrote the repo-root .minspec/auto-drain), leaving auto-drain
# permanently OFF and the banner lying "OFF" while the pref said "on". Delegating
# to `--pref-path` keeps a single source of truth (regression: #415).
PREF="$("$DRAIN" --pref-path 2>/dev/null || true)"  # swallow-ok: an advisory session banner, not a gate; empty simply omits it
if [[ -x "$DRAIN" ]]; then
  if [[ -n "$PREF" && "$(cat "$PREF" 2>/dev/null || echo off)" == "on" ]]; then
    "$DRAIN" --auto 2>/dev/null || true
  else
    pending="$("$DRAIN" --dry-run 2>/dev/null || true)"  # swallow-ok: an advisory session banner, not a gate; empty simply omits it
    if [[ -n "$pending" ]]; then
      printf '%s\n' "$pending"
      # nudge only when there is real pending work
      echo "$pending" | grep -q '📬' && \
        echo "    Auto-drain is OFF. Enable once: scripts/drain-inbox.sh --enable-auto"
    fi
  fi
fi

# --- Weekly tooling radar (#1210) ---
# Trigger of last resort AND the only trigger available inside the dev container:
# `~/.config/systemd/user` is a root-owned mount here, so the systemd timer that
# scripts/tooling-radar/install.sh writes can only be installed from a host shell.
# Rather than let the radar depend on a path that may not exist, it also rides
# session start — the same pattern the inbox drain uses (#239).
#
# `--due` (NOT `--status`) decides whether to launch: --status answers "is the radar
# healthy?", --due answers "should a scan start now?", and it applies backoff so a
# failed scan retries in hours rather than on every single session start.
#
# The lock directory matters because several sessions routinely start at once; without
# it, three windows opening together would run three scans and file the same findings
# three times. mkdir is the atomic primitive that makes the check-and-claim one step.
RADAR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/tooling-radar/run-radar.sh"
RADAR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Linked worktrees share the repo but must not each launch a scan; in a worktree
# --git-dir and --git-common-dir differ, in the primary checkout they match.
if [[ -x "$RADAR" ]] \
  && [[ "$(git rev-parse --git-dir 2>/dev/null)" == "$(git rev-parse --git-common-dir 2>/dev/null)" ]]; then
  if ! "$RADAR" --status >/dev/null 2>&1; then
    # Never-run, failed, or stale — each deserves a visible line. A radar that
    # stopped running produces the same empty inbox as a quiet week, so silence
    # here would be the failure mode the radar exists to avoid.
    echo "📡 Tooling radar: $("$RADAR" --status 2>&1 | tail -1)"
  fi
  if "$RADAR" --due >/dev/null 2>&1; then
    if mkdir "$RADAR_ROOT/.radar/.lock" 2>/dev/null; then
      (
        trap 'rmdir "$RADAR_ROOT/.radar/.lock" 2>/dev/null' EXIT
        "$RADAR" >>"$RADAR_ROOT/.radar/run.log" 2>&1
      ) &
      disown 2>/dev/null || true
      echo "    Scan due — running in the background; findings file as issues."
      echo "    Watch: tail -f .radar/run.log · Health: scripts/tooling-radar/run-radar.sh --status"
    fi
  fi
fi

# ── Autonomy state (DR-086) ──────────────────────────────────────────────────
# Delegated to its own side-effect-free unit so it can be tested by EXECUTION
# rather than by grepping this file (see session-autonomy.sh). Never fatal.
_AUT=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)/session-autonomy.sh
[ -x "$_AUT" ] && "$_AUT" || true
