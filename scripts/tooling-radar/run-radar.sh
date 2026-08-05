#!/usr/bin/env bash
# run-radar.sh — weekly scan for new external tooling relevant to this workspace.
#
# Two stages, deliberately split by trust level:
#
#   stage 1  `claude -p` with WEB TOOLS ONLY — no Bash, no Read, no Write. It reads
#            untrusted pages and emits JSON. Global rule (DR-345): never hand
#            filesystem or shell tools to a model reading untrusted documents; in
#            `-p` mode Read resolves absolute paths outside cwd, so cwd is not a
#            sandbox boundary and prompt hygiene is not a control.
#   stage 2  `file-findings.mjs` — holds the App credential, contains no model, and
#            makes every dangerous decision (which repo, which labels, whether to
#            file at all) from a fixed table rather than from model output.
#
# A hostile page can therefore shape the TEXT of an issue. It cannot reach a shell,
# pick a repository, or turn a watch item into a filed one.
#
# MONITORING (this is a tool too)
# ------------------------------
# The radar is itself an installed tool, so it follows the rule it enforces on
# others: configured, triggered, monitored. Every run writes `.radar/health.json`
# whether it succeeds or fails, and the systemd OnFailure watchdog writes it even
# when this script dies hard. That matters because of a specific failure mode: a
# radar that silently stopped running looks exactly like a run of quiet weeks. The
# health file makes "no issues because nothing happened" distinguishable from "no
# issues because nothing ran" — the same silent-gate distinction the constitution
# forbids collapsing (invariant 2).
#
# Usage:
#   scripts/tooling-radar/run-radar.sh              # scan and file
#   scripts/tooling-radar/run-radar.sh --dry-run    # scan, print, file nothing
#   scripts/tooling-radar/run-radar.sh --status     # print last-run health, exit 1 if stale/failed
#   scripts/tooling-radar/run-radar.sh --due        # exit 0 if a run is DUE now (used by the
#                                                   # session-start hook), 1 if not
#
# Env:
#   RADAR_MAX_ISSUES  cap per run (default 3); overflow is reported, never silent
#   RADAR_MODEL       model for the scan stage (default sonnet — this is synthesis,
#                     not architecture, and it runs 52 times a year)
#   RADAR_INTERVAL_DAYS  how often --due says yes after a success (default 7)
#   RADAR_RETRY_HOURS    backoff before --due retries a FAILED run (default 6)
#   RADAR_STALE_DAYS  --status fails if the last run is older than this (default 10,
#                     i.e. one missed Monday plus slack)

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$REPO_ROOT/.radar"
HEALTH="$OUT_DIR/health.json"
PROMPT="$SCRIPT_DIR/radar-prompt.md"
MODEL="${RADAR_MODEL:-sonnet}"
STALE_DAYS="${RADAR_STALE_DAYS:-10}"

mkdir -p "$OUT_DIR"

# ---------------------------------------------------------------- health ------

write_health() {
  local status="$1" detail="$2"
  # Written with a temp file + mv so a reader never sees a half-written health
  # record and concludes the radar is broken when it is merely mid-run.
  cat >"$HEALTH.tmp" <<JSON
{
  "status": "$status",
  "detail": "$(printf '%s' "$detail" | tr -d '"' | tr '\n' ' ')",
  "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "host": "$(hostname)"
}
JSON
  mv "$HEALTH.tmp" "$HEALTH"
}

# Any unexpected exit is a FAILURE, recorded as one. No `|| true` anywhere in this
# script: a swallowed error here would be a load-bearing gate signal written
# best-effort, which the constitution prohibits outright.
trap 'write_health failed "aborted at line $LINENO"' ERR

# --due answers one question for the session-start hook: should a scan start NOW?
# It is deliberately separate from --status, which answers "is the radar healthy?".
# Collapsing the two would make a FAILED run relaunch on every single session start,
# turning one broken scan into a retry storm. The backoff below is why they differ:
#   never run          → due
#   last run ok        → due once RADAR_INTERVAL_DAYS have passed (default 7)
#   last run failed    → due again only after RADAR_RETRY_HOURS (default 6)
if [[ "${1:-}" == "--due" ]]; then
  trap - ERR
  [[ -f "$HEALTH" ]] || exit 0
  at="$(grep -o '"at": *"[^"]*"' "$HEALTH" | head -1 | sed 's/.*: *"//;s/"//')"
  status="$(grep -o '"status": *"[^"]*"' "$HEALTH" | head -1 | sed 's/.*: *"//;s/"//')"
  [[ -n "$at" ]] || exit 0
  age_hours=$(( ( $(date -u +%s) - $(date -u -d "$at" +%s) ) / 3600 ))
  if [[ "$status" == "ok" ]]; then
    (( age_hours >= ${RADAR_INTERVAL_DAYS:-7} * 24 )) && exit 0 || exit 1
  fi
  (( age_hours >= ${RADAR_RETRY_HOURS:-6} )) && exit 0 || exit 1
fi

if [[ "${1:-}" == "--status" ]]; then
  trap - ERR
  if [[ ! -f "$HEALTH" ]]; then
    echo "radar: NEVER RUN — no $HEALTH. Install the timer: scripts/tooling-radar/install.sh" >&2
    exit 1
  fi
  cat "$HEALTH"
  status="$(grep -o '"status": *"[^"]*"' "$HEALTH" | head -1 | sed 's/.*: *"//;s/"//')"
  at="$(grep -o '"at": *"[^"]*"' "$HEALTH" | head -1 | sed 's/.*: *"//;s/"//')"
  age_days=$(( ( $(date -u +%s) - $(date -u -d "$at" +%s) ) / 86400 ))
  if [[ "$status" != "ok" ]]; then
    echo "radar: last run FAILED ($age_days day(s) ago)" >&2
    exit 1
  fi
  if (( age_days > STALE_DAYS )); then
    echo "radar: STALE — last successful run was $age_days day(s) ago (> $STALE_DAYS)." >&2
    echo "       The timer is probably not firing: systemctl --user status minspec-tooling-radar.timer" >&2
    exit 1
  fi
  echo "radar: healthy — last run $age_days day(s) ago"
  exit 0
fi

DRY_RUN=""
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN="--dry-run"

# ------------------------------------------------------------ stage 1 --------

STAMP="$(date -u +%Y-%m-%d)"
RAW="$OUT_DIR/raw-$STAMP.json"
FINDINGS="$OUT_DIR/findings-$STAMP.json"
BRIEFING="$OUT_DIR/briefing-$STAMP.md"

echo "radar: scanning (model=$MODEL, web tools only) …"

# The allowlist is the security control; the denylist restates the dangerous tools
# explicitly so that a future change to the CLI's default tool set cannot quietly
# widen what this stage can reach. Both are asserted by a test — see
# packages/minspec/tests/tooling-radar.test.ts, which greps this file. If you add a
# tool here, that test fails, and it is meant to: widening the scan stage's reach
# is a security decision, not a config tweak.
claude -p "$(cat "$PROMPT")" \
  --model "$MODEL" \
  --output-format json \
  --allowedTools WebSearch WebFetch \
  --disallowedTools Bash Read Write Edit MultiEdit NotebookEdit Task Agent Glob Grep \
  >"$RAW"

# ------------------------------------------------------------ stage 2 --------

node "$SCRIPT_DIR/parse-scan.mjs" "$RAW" "$FINDINGS" "$BRIEFING"

set +e
node "$SCRIPT_DIR/file-findings.mjs" "$FINDINGS" $DRY_RUN
file_rc=$?
set -e

if (( file_rc != 0 )); then
  write_health failed "filing stage exited $file_rc"
  echo "radar: filing FAILED (rc=$file_rc). Briefing kept at $BRIEFING" >&2
  exit "$file_rc"
fi

write_health ok "briefing=$BRIEFING"
echo "radar: done — briefing at $BRIEFING"
