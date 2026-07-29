#!/usr/bin/env python3
"""session-title.py — UserPromptSubmit hook: append approvable IDs to the CC session title.

Claude Code lets a `UserPromptSubmit` (and `SessionStart`) hook set the session
title by emitting `hookSpecificOutput.sessionTitle`. The title shows in the
prompt box, the `/resume` picker, and the terminal tab title, and is persisted
to the session transcript as a `{"type":"custom-title"}` record.

This hook composes:

    <Claude's own auto-summary> — SPEC-019 DR-071 #1082

so the tab still says what the session is *about*, with the approvable IDs the
session actually touched appended on the end.

Rules:
  - IDs come from the USER's typed prompts only (never tool output or assistant
    text), so reading `docs/decisions/INDEX.md` does not flood the title.
  - Most-recently-mentioned first, deduped, capped so the whole title fits the
    harness's 200-character limit.
  - No IDs found -> emit nothing, leaving Claude Code's own title untouched.
  - Every failure path is silent and non-blocking: a title is cosmetic, and a
    broken hook must never cost the user a turn.
"""

from __future__ import annotations

import json
import os
import re
import sys

# Harness caps the title at 200 chars (and strips control characters).
MAX_TITLE = 200
# Never let the ID list eat the whole title.
MAX_REFS = 6
# Bound how much transcript we parse, so the hook stays fast on long sessions.
MAX_TAIL_BYTES = 8 * 1024 * 1024

SEPARATOR = " — "

# Approvables: SPEC-NNN / DR-NNN / EP-NNN, and GitHub issues/PRs as #NNN.
# DR-053 v2 cross-project forms (MIN/SP19) are matched too and kept verbatim.
REF_RE = re.compile(
    r"\b(?:[A-Z]{3}/)?(?:SPEC|DR|EP)-\d+\b"
    r"|\b(?:[A-Z]{3}/)?(?:SP|DR|EP|PR|IS)\d+\b"
    r"|(?<![\w/])#\d+\b"
)

# A trailing run of refs we appended on an earlier turn — stripped before
# re-appending, so the title never grows "title — DR-071 — DR-071 #1082".
TAIL_REFS_RE = re.compile(
    r"\s+—\s+(?:(?:[A-Z]{3}/)?(?:SPEC|DR|EP)-\d+|(?:[A-Z]{3}/)?(?:SP|DR|EP|PR|IS)\d+|#\d+)"
    r"(?:\s+(?:(?:[A-Z]{3}/)?(?:SPEC|DR|EP)-\d+|(?:[A-Z]{3}/)?(?:SP|DR|EP|PR|IS)\d+|#\d+))*\s*$"
)


def read_tail(path: str) -> list[str]:
    """Return the transcript's lines, bounded to the last MAX_TAIL_BYTES."""
    size = os.path.getsize(path)
    with open(path, "rb") as fh:
        if size > MAX_TAIL_BYTES:
            fh.seek(size - MAX_TAIL_BYTES)
            fh.readline()  # drop the partial line we landed in the middle of
        data = fh.read()
    return data.decode("utf-8", "replace").splitlines()


def user_prompts(lines: list[str]) -> list[str]:
    """Typed user prompts, oldest first.

    Only `type: "user"` entries whose content is a plain string are real typed
    prompts — tool results arrive as content *arrays*, and meta entries carry
    hook output, command wrappers, and system reminders.
    """
    out: list[str] = []
    for line in lines:
        if '"type":"user"' not in line and '"type": "user"' not in line:
            continue
        try:
            entry = json.loads(line)
        except Exception:
            continue
        if entry.get("type") != "user" or entry.get("isMeta"):
            continue
        content = (entry.get("message") or {}).get("content")
        if not isinstance(content, str) or not content.strip():
            continue
        if content.lstrip().startswith(("<command-name>", "<local-command", "<user-memory")):
            continue
        out.append(content)
    return out


def last_ai_title(lines: list[str]) -> str:
    """Claude Code's own rolling auto-summary — it keeps updating even once a
    custom title is set, so it stays a live base to append to."""
    base = ""
    for line in lines:
        if '"ai-title"' in line:
            try:
                entry = json.loads(line)
            except Exception:
                continue
            if entry.get("type") == "ai-title" and entry.get("aiTitle"):
                base = str(entry["aiTitle"])
        elif '"custom-title"' in line and not base:
            try:
                entry = json.loads(line)
            except Exception:
                continue
            if entry.get("type") == "custom-title" and entry.get("customTitle"):
                base = TAIL_REFS_RE.sub("", str(entry["customTitle"]))
    return base.strip()


def collect_refs(prompts: list[str]) -> list[str]:
    """Deduped approvable IDs, most-recently-mentioned first."""
    seen: dict[str, None] = {}
    for text in reversed(prompts):  # newest prompt first
        for ref in REF_RE.findall(text):
            seen.setdefault(ref, None)
            if len(seen) >= MAX_REFS:
                return list(seen)
    return list(seen)


def compose(base: str, refs: list[str]) -> str:
    tail = " ".join(refs)
    if not base:
        return tail[:MAX_TITLE]
    room = MAX_TITLE - len(SEPARATOR) - len(tail)
    if room < 12:  # refs alone are already near the cap — drop the summary
        return tail[:MAX_TITLE]
    if len(base) > room:
        base = base[: room - 1].rstrip() + "…"
    return f"{base}{SEPARATOR}{tail}"


def main() -> int:
    try:
        envelope = json.load(sys.stdin)
    except Exception:
        return 0

    prompts: list[str] = []
    transcript = envelope.get("transcript_path")
    if transcript and os.path.isfile(transcript):
        try:
            lines = read_tail(transcript)
        except Exception:
            lines = []
    else:
        lines = []

    prompts.extend(user_prompts(lines))
    current = envelope.get("prompt")
    if isinstance(current, str) and current.strip():
        prompts.append(current)

    refs = collect_refs(prompts)
    if not refs:
        return 0  # nothing to append — leave Claude Code's own title alone

    title = compose(last_ai_title(lines), refs)
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "sessionTitle": title,
            }
        },
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)  # cosmetic hook — never block a turn
