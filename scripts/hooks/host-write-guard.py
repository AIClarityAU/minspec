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
/proc reads, so it is called LIVE per invocation rather than read from
session-identity.sh's 30-minute cache. A cached verdict attests to a past
measurement, never to the act being gated.
"""

import json
import os
import re
import shutil
import subprocess
import sys

IBC = os.path.expanduser("~/.claude/scripts/identity-boundary-check.sh")

# The detector's CONTRACT, written down because it lives outside this repo and is not
# version-controlled here: `--location` exits 0 in the container, 1 on the host, anything
# else means it could not establish where it is. Any other exit, a timeout, a missing file
# or a non-executable file are all "unknown", and unknown denies. If that contract ever
# changes, this gate fails closed rather than open, which is the direction it must fail.

# A command is split into SIMPLE COMMANDS on the shell operators that separate them, and
# each is judged on its own. Whole-string matching is what the first version of this gate
# got wrong: it searched for `gh-app-token.sh` anywhere in the command, so
# `gh issue comment N --body "see gh-app-token.sh"` and `echo gh-app-token.sh; gh pr merge N`
# both read as "mints the bot token" and were ALLOWED - writing under the founder's account,
# which is the exact incident class this exists to stop. A substring is not a position.
# `$(` and a backtick open a NEW command context, so they separate segments too: without
# them `x=$(gh pr view 1)` reads as one segment beginning `x=` and never matches.
SEGMENT_SPLIT = re.compile(r"(?:\|\||&&|\$\(|[;&|`\n])")

# `gh` as the command word of a segment: optional env assignments, then `gh`. Anchored at
# the segment start and on a word boundary, so `github`, `lighthouse`, `regh` and a bare
# mention inside an argument do not match.
GH_COMMAND = re.compile(r"^\s*(?:\w+=\S+\s+)*gh(?=\s|$)")

# An EXPLICIT identity was chosen for this segment. The threat is the AMBIENT credential:
# on the host, `gh` with no GH_TOKEN is the founder. Setting GH_TOKEN is the caller naming
# an identity, which is the documented remedy. Deliberately does NOT require the value to
# come from the broker - `T="$(gh-app-token.sh)"; GH_TOKEN="$T" gh ...` is the established
# two-step form in this repo, and the token's own value is not knowable from the text.
GH_TOKEN_SET = re.compile(r"^\s*(?:\w+=\S+\s+)*GH_TOKEN=")

# `git push` in the forms that actually occur, including `git -C <path> push`. A bare
# non-flag argument between `git` and `push` is why the first version missed that one.
GIT_PUSH = re.compile(r"\bgit\b(?:\s+-C\s+\S+|\s+-\S+|\s+--\S+|\s+\S+=\S+)*\s+push\b")


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
    """Return the verb this command would use an ambient credential for, or None.

    Judged per simple-command, never over the whole string.
    """
    for seg in SEGMENT_SPLIT.split(command):
        if GIT_PUSH.search(seg):
            # Minting GH_TOKEN does NOT re-route this: git authenticates through the
            # credential helper or SSH, so there is no in-command remedy on the host.
            return "git push"
        if GH_COMMAND.search(seg) and not GH_TOKEN_SET.search(seg):
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

    if verb == "git push":
        remedy = (
            "There is no in-command remedy: `git` authenticates through the credential "
            "helper or SSH, so minting GH_TOKEN does not re-route this push. Ask the human "
            "to relaunch this panel inside the container."
        )
    else:
        remedy = (
            'Name an identity and the call is allowed: '
            'GH_TOKEN="$(~/.claude/scripts/gh-app-token.sh)" gh ...\n'
            "Better: ask the human to relaunch this panel inside the container."
        )

    emit(
        "deny",
        f"{lead} Refusing this `{verb}` call (#1816: two agent writes were recorded "
        f"under the founder's account this way, and one fabricated founder decision kept "
        f"a security issue closed for ten days).\n\n"
        f"Location check: {detail}\n\n{remedy}",
    )


if __name__ == "__main__":
    main()
