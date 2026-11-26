#!/usr/bin/env bash
# install.sh - install (or remove) minspec-drain.service, the host user unit that keeps
# the inbox drain running inside the claude-agent container (#3011). Run it ON THE HOST.
#
#   scripts/drain-service/install.sh              install, enable and start the unit
#   scripts/drain-service/install.sh --uninstall  stop, disable and remove the unit
#
# The unit names the checkout as %h/code/MinSpecPro, the path the container mounts it
# at. A checkout anywhere else is refused rather than installed with a wrong path.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
UNIT=minspec-drain.service
UNIT_DIR="$HOME/.config/systemd/user"

if [[ "$(cat /proc/1/comm 2>/dev/null)" == docker-init ]]; then
  echo "install.sh: this is the agent container. Run it on the host: it installs a host user unit." >&2
  exit 78
fi

case "${1:-}" in
  --uninstall)
    systemctl --user disable --now "$UNIT" 2>/dev/null || true  # swallow-ok: a unit that was never installed has nothing to stop
    rm -f "$UNIT_DIR/$UNIT"
    systemctl --user daemon-reload
    echo "drain-service: removed. The pause marker, if any, was left alone."
    exit 0
    ;;
  "") ;;
  *) echo "Usage: install.sh [--uninstall]" >&2; exit 2 ;;
esac

if [[ "$REPO_ROOT" != "$HOME/code/MinSpecPro" ]]; then
  echo "install.sh: the unit expects the checkout at $HOME/code/MinSpecPro, this one is $REPO_ROOT. Run the copy in that checkout." >&2
  exit 1
fi

mkdir -p "$UNIT_DIR"
install -m 644 "$SCRIPT_DIR/$UNIT" "$UNIT_DIR/$UNIT"
systemctl --user daemon-reload
systemctl --user enable --now "$UNIT"
systemctl --user --no-pager status "$UNIT" || true  # swallow-ok: status exits non-zero for a unit still activating; the text is the report
