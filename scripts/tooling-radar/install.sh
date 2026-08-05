#!/usr/bin/env bash
# install.sh — install (or remove) the weekly tooling-radar systemd user timer.
#
# The units are GENERATED here rather than committed as files, because they must
# carry an absolute path to this checkout and a committed path would be wrong for
# anyone whose repo lives elsewhere — a stale absolute path fails at 07:13 on a
# Monday, which is precisely when nobody is watching.
#
# Three units:
#   minspec-tooling-radar.timer          — fires Mon 07:13 local, Persistent
#   minspec-tooling-radar.service        — runs the scan
#   minspec-tooling-radar-failed.service — OnFailure watchdog: records the failure
#                                          even when the scan dies before it can
#                                          write its own health record
#
# The watchdog is the point of the whole arrangement. Without it, the failure mode
# is invisible: a scan that crashes writes nothing, an empty inbox looks like a
# quiet week, and the radar can be dead for a month before anyone notices. With it,
# `run-radar.sh --status` returns non-zero and says why.
#
# Usage:
#   scripts/tooling-radar/install.sh              # install and start the timer
#   scripts/tooling-radar/install.sh --uninstall  # stop, disable, remove the units
#   scripts/tooling-radar/install.sh --status     # timer state + last-run health

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
BASE="minspec-tooling-radar"
HEALTH="$REPO_ROOT/.radar/health.json"

case "${1:-}" in
  --uninstall)
    systemctl --user disable --now "$BASE.timer" 2>/dev/null || true
    rm -f "$UNIT_DIR/$BASE.timer" "$UNIT_DIR/$BASE.service" "$UNIT_DIR/$BASE-failed.service"
    systemctl --user daemon-reload
    echo "radar: uninstalled. (The .radar/ output directory was left alone.)"
    exit 0
    ;;
  --status)
    systemctl --user list-timers "$BASE.timer" --all --no-pager || true
    echo
    exec "$SCRIPT_DIR/run-radar.sh" --status
    ;;
esac

mkdir -p "$REPO_ROOT/.radar"

# The dev container mounts ~/.config read-only as root, so the systemd user unit
# directory is writable only from a host shell. Say so plainly instead of dying on
# a permission error: the radar still runs, because the session-start hook triggers
# it independently (scripts/hooks/session-start.sh). The timer is the belt; the hook
# is the braces, and inside the container the braces are all there is.
if ! mkdir -p "$UNIT_DIR" 2>/dev/null; then
  echo "radar: TIMER NOT INSTALLED — $UNIT_DIR is not writable from here."
  echo "       (In the dev container ~/.config is a root-owned mount.)"
  echo
  echo "       The radar is still triggered: scripts/hooks/session-start.sh starts a"
  echo "       scan whenever one is due, so the weekly cadence holds as long as you"
  echo "       open a session. Nothing further is required."
  echo
  echo "       To ALSO install the systemd timer, run this same script from a host"
  echo "       shell (not the container):"
  echo "         $REPO_ROOT/scripts/tooling-radar/install.sh"
  exit 0
fi

# `bash -lc` so the unit inherits a login PATH. A systemd user unit otherwise starts
# with a minimal environment in which `claude`, `node`, and `gh` are all missing —
# and the resulting failure ("command not found" at 07:13) is the kind that gets
# discovered weeks later.
cat >"$UNIT_DIR/$BASE.service" <<UNIT
[Unit]
Description=MinSpec weekly tooling radar (token savings + code quality scan)
Documentation=file://$REPO_ROOT/scripts/tooling-radar/README.md
OnFailure=$BASE-failed.service

[Service]
Type=oneshot
WorkingDirectory=$REPO_ROOT
ExecStart=/bin/bash -lc '$REPO_ROOT/scripts/tooling-radar/run-radar.sh'
TimeoutStartSec=1800
UNIT

cat >"$UNIT_DIR/$BASE-failed.service" <<UNIT
[Unit]
Description=Record a failed tooling-radar run so a dead timer cannot look like a quiet week

[Service]
Type=oneshot
ExecStart=/bin/bash -lc 'mkdir -p "$REPO_ROOT/.radar" && printf "{\\n  \\"status\\": \\"failed\\",\\n  \\"detail\\": \\"unit failed; see journalctl --user -u $BASE.service\\",\\n  \\"at\\": \\"%%s\\",\\n  \\"host\\": \\"%%s\\"\\n}\\n" "\$(date -u +%%Y-%%m-%%dT%%H:%%M:%%SZ)" "\$(hostname)" > "$HEALTH"'
UNIT

# Off the :00 and :30 marks on purpose, and Persistent=true so a machine that was
# asleep on Monday runs the scan when it next comes up rather than skipping a week.
cat >"$UNIT_DIR/$BASE.timer" <<UNIT
[Unit]
Description=Weekly trigger for the MinSpec tooling radar

[Timer]
OnCalendar=Mon *-*-* 07:13:00
Persistent=true
RandomizedDelaySec=300
Unit=$BASE.service

[Install]
WantedBy=timers.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now "$BASE.timer"

echo "radar: installed."
systemctl --user list-timers "$BASE.timer" --all --no-pager
echo
echo "Trigger a run now:   systemctl --user start $BASE.service"
echo "Check health:        scripts/tooling-radar/run-radar.sh --status"
echo "Read the log:        journalctl --user -u $BASE.service -n 50"
