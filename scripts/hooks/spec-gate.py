#!/usr/bin/env python3
"""MinSpec PreToolUse spec gate (DR-362).

Reads a Claude Code PreToolUse hook envelope on stdin and prints a JSON
permission decision on stdout. Blocks Edit/Write/MultiEdit to *source* files
while any T3/T4 spec in `status: implementing` is unapproved (or approved then
edited -> stale). This is the only enforcement that survives bypass-permissions
mode, because a PreToolUse deny blocks the tool call before permission rules.

Invoked by spec-gate.sh (which handles the MINSPEC_GATE_OFF kill-switch).
Hashing is sha256 over raw file bytes -> byte-identical to `sha256sum` and to
the extension's Node `crypto`, so hook and UI agree on what "approved" means.
"""
import json
import sys
import os
import re
import hashlib
import glob


def allow():
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow"}}))
    sys.exit(0)


def passthrough():
    # Emit nothing -> Claude Code falls back to its normal permission flow.
    sys.exit(0)


def deny(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason}}))
    sys.exit(0)


def fm_value(text, key):
    m = re.search(r'^' + re.escape(key) + r':\s*(.+?)\s*$', text, re.M)
    return m.group(1).strip() if m else None


def sha(path):
    try:
        with open(path, "rb") as fh:
            return hashlib.sha256(fh.read()).hexdigest()
    except Exception:
        return None


def main():
    try:
        env = json.load(sys.stdin)
    except Exception:
        # Can't parse -> fail open, never block on our own bug.
        passthrough()

    tool = env.get("tool_name", "")
    if tool not in ("Edit", "Write", "MultiEdit"):
        passthrough()

    ti = env.get("tool_input", {}) or {}
    fpath = ti.get("file_path") or ti.get("path") or ""
    cwd = env.get("cwd") or os.getcwd()
    if not fpath:
        allow()

    abs_path = fpath if os.path.isabs(fpath) else os.path.join(cwd, fpath)
    try:
        rel = os.path.relpath(abs_path, cwd)
    except Exception:
        rel = fpath
    rel = rel.replace(os.sep, "/")

    # Allowlist: spec/review/config/doc/markdown/scripts are always editable,
    # so the user can always write or fix the specs that unblock the gate.
    allow_prefixes = ("specs/", "docs/", ".minspec/", "scripts/", ".claude/", ".github/")
    if rel.startswith(allow_prefixes) or rel.endswith(".md") or rel.startswith("../"):
        allow()
    if rel.startswith(("node_modules/", "out/", "dist/", "coverage/", ".git/")):
        allow()
    if rel in ("package.json", "package-lock.json", "tsconfig.json"):
        allow()

    approvals = {}
    ap = os.path.join(cwd, ".minspec", "approvals.json")
    if os.path.exists(ap):
        try:
            with open(ap, "r", encoding="utf-8") as fh:
                approvals = json.load(fh) or {}
        except Exception:
            approvals = {}

    blockers = []
    for sp in glob.glob(os.path.join(cwd, "specs", "**", "*.md"), recursive=True):
        try:
            with open(sp, "r", encoding="utf-8") as fh:
                head = fh.read(4000)
        except Exception:
            continue
        fmatch = re.match(r'^---\n(.*?)\n---', head, re.S)
        if not fmatch:
            continue
        fm = fmatch.group(1)
        tier = (fm_value(fm, "tier") or "").upper()
        status = (fm_value(fm, "status") or "").lower()
        sid = fm_value(fm, "id") or ""
        if tier not in ("T3", "T4") or status != "implementing" or not sid:
            continue
        rec = approvals.get(sid)
        cur = sha(sp)
        if not rec:
            blockers.append("%s (not approved)" % sid)
        elif rec.get("specHash") != cur:
            blockers.append("%s (approval stale - spec edited since approval)" % sid)

    if not blockers:
        allow()

    names = ", ".join(blockers)
    deny(
        "MinSpec gate: source edit to '%s' blocked. "
        "Unapproved T3/T4 spec(s) in implementation: %s. "
        "A human must review and approve the spec first "
        "(VS Code: 'MinSpec: Approve Spec for Implementation', or the checkmark "
        "in the MinSpec sidebar). To bypass intentionally, set MINSPEC_GATE_OFF=1."
        % (rel, names)
    )


if __name__ == "__main__":
    main()
