#!/usr/bin/env python3
"""host-write-guard.py - refuse credentialed GitHub writes from a HOST session (#1816).

PreToolUse deny on `Bash`. A deny blocks the tool call before permission rules, which is
the same mechanism spec-gate.py uses (see its module docstring).

WHY THIS EXISTS, AND WHY THE EXISTING UNIT IS NOT ENOUGH.
`scripts/hooks/session-identity.sh` already detects this exact condition and prints a
warning. It is a REPORT, not a gate: it has one exit (`exit 0`) and `session-start.sh`
invokes it as `... || true` under a comment reading "Never fatal". It refuses nothing.
#1816 measured the consequence twice - a comment accepting DR-050's amendment posted under
the founder's account, and a fabricated founder decision that kept security issue #1482
closed for ten days. Both were agent writes that every signal the GitHub API exposes reads
as genuine, because on the HOST a bare `gh` IS the founder.

THE RULE, deliberately small.
  * Provably in the container -> ALLOW. That is the overwhelmingly common path and this
    hook must not change its behaviour at all.
  * Anywhere else (HOST, or the location cannot be established) -> DENY a command that
    invokes `gh` or `git push`, UNLESS it mints the bot token first.

Fail-closed on "cannot establish" is constitution invariant 2: a missing or errored witness
fails the gate closed and visibly, never silently passes. A missing detector denies too, and
says so.

WHAT THIS CONTROL IS NOT, stated here rather than discovered later.
It reads the command TEXT. A process that wants to evade it can - write the call into a
script and run that, or invoke the API directly in Python. It is a guard against the
accidental and the honest path, which is what both measured incidents actually were, and it
raises a one-command mistake to deliberate circumvention. It is NOT a defence against an
agent that has decided to forge, and the real remedy remains not launching agent sessions on
the host. Written down because a control whose limit is not stated gets read as stronger
than it is - the same failure `approve-issue.sh:49-52` names about its own TTY check.

Location comes from ~/.claude/scripts/identity-boundary-check.sh --location, which is two
/proc reads: measured 14-16ms over five runs, so it is called LIVE per invocation rather
than read from session-identity.sh's 30-minute cache. A cached verdict attests to a past
measurement, never to the act being gated.
"""

import json
import os
import re
import shutil
import subprocess
import sys

IBC = os.path.expanduser("~/.claude/scripts/identity-boundary-check.sh")

# The remedy the session-identity warning already tells the agent to use. A command that
# mints the bot token is acting as `minspec-sdd[bot]`, not as the founder, so it is allowed
# even on the host - refusing it would leave a host session with no legitimate path at all.
MINTS_BOT_TOKEN = re.compile(r"gh-app-token\.sh")

# `gh` as a command word (start, or after a pipe/;/&&/||/backtick/$(), optionally with
# env assignments in front), and `git push` in any form. Anchored on a word boundary so
# `github`, `light`, `gh-app-token.sh` and `regh` do not match.
GH_INVOCATION = re.compile(r"(?:^|[;&|(`\n]|\$\()\s*(?:\w+=\S*\s+)*gh\b")
GIT_PUSH = re.compile(r"\bgit\b(?:\s+-\S+|\s+--\S+|\s+\S+=\S+)*\s+push\b")


def emit(decision, reason=None):
    out = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
        }
    }
    if reason is not None:
        out["hookSpecificOutput"]["permissionDecisionReason"] = reason
    print(json.dumps(out))
    sys.exit(0)


def location():
    """('container'|'host'|'unknown', detail). Never raises: any failure is 'unknown'."""
    if not (os.path.isfile(IBC) and os.access(IBC, os.X_OK)):
        return "unknown", f"identity check not installed ({IBC})"
    try:
        p = subprocess.run(
            [IBC, "--location"], capture_output=True, text=True, timeout=5
        )
    except subprocess.TimeoutExpired:
        return "unknown", "identity check timed out after 5s"
    except OSError as e:  # noqa: BLE001 - any exec failure is an unestablished location
        return "unknown", f"identity check could not run ({e})"
    detail = (p.stdout or p.stderr or "").strip().replace("\n", " ")[:120]
    if p.returncode == 0:
        return "container", detail
    if p.returncode == 1:
        return "host", detail
    return "unknown", f"{detail} (exit {p.returncode})"


def writes_to_github(command):
    if MINTS_BOT_TOKEN.search(command):
        return None
    if GIT_PUSH.search(command):
        return "git push"
    if GH_INVOCATION.search(command):
        return "gh"
    return None


def main():
    try:
        envelope = json.load(sys.stdin)
    except Exception:  # noqa: BLE001 - an unreadable envelope must not wedge every call
        emit("allow")

    if envelope.get("tool_name") != "Bash":
        emit("allow")
    command = (envelope.get("tool_input") or {}).get("command") or ""

    verb = writes_to_github(command)
    if verb is None:
        emit("allow")

    where, detail = location()
    if where == "container":
        emit("allow")

    if where == "host":
        lead = (
            "This session is running on the HOST, not in the claude-agent container, "
            "where a bare `gh` or `git push` acts as the FOUNDER."
        )
    else:
        lead = (
            "This session's location could not be established, so it is treated as the "
            "HOST (fail-closed, constitution invariant 2)."
        )

    emit(
        "deny",
        f"{lead} Refusing this `{verb}` call (#1816: two agent writes were recorded "
        f"under the founder's account this way, and one fabricated founder decision kept "
        f"a security issue closed for ten days).\n\n"
        f"Location check: {detail}\n\n"
        f'Mint the bot token and the call is allowed: GH_TOKEN="$(~/.claude/scripts/'
        f'gh-app-token.sh)" gh ...\n'
        f"Better: ask the human to relaunch this panel inside the container.",
    )


if __name__ == "__main__":
    main()
