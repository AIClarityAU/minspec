#!/usr/bin/env python3
"""session-panel.py - say when a session has lost its panel (#2380, #2379).

WHY. After a window reload the editor re-attaches a panel only to a session it can
find in the transcript store that the EDITOR's own process reads. A session that runs
somewhere with a different store (here: the agent container) is not in it, so its
panel comes back as a blank new session, launched with no `--resume`. The old process
is not signalled: it only sees its input stream close. If it was idle it exits; if it
was mid-turn it runs on with nobody reading it. Measured 2026-10-09: 2 of 2 panels
came back blank, the old chief of staff ran headless for 29 minutes with 9 of 9 file
tool calls refused, and two supervising loops were live on one queue for 10 minutes.
Neither side was told. This unit is that statement, made to both sides:

  self   (UserPromptSubmit) - "THIS session has no panel": its own input has no writer.
  start  (SessionStart)     - "these sessions in this folder lost their panel": the ones
                              still running headless, the ones that ended in the last
                              few minutes without being re-attached, and any schedule
                              (/loop) they held. That last part is the dead-loop
                              backstop of #2379, keyed on the record the CLI itself
                              writes (CronCreate / CronDelete in the transcript) instead
                              of a marker file that nothing ever wrote.

It cannot give the conversation back to a panel; only the editor can. It makes the
loss impossible to miss and names the way back (the transcript path, `--resume`).

HOW "no panel" IS KNOWN. A panel session reads stream-json on standard input, and that
input is an anonymous pipe. When the editor side goes away the pipe has no writer left.
Polling the pipe reports exactly that (POLLHUP) without reading from it. The probe
opens /proc/<pid>/fd/0 read-only, polls with a zero timeout and closes. It NEVER reads:
a read would take bytes out of a message on its way to that session.

WHAT IT CANNOT SEE, stated rather than hidden:
  * A session whose input is not a pipe (a terminal, or a socket when the editor
    launches the CLI directly rather than through a container). Those are skipped.
  * A session killed long before this one started (a container restart after an idle
    night). Only the last RECENT_S seconds are examined, so a stale loss is not
    re-announced at every start for days. Tracked as #2633.
  * The session registry and the transcript fields are internal to the CLI. Where
    this unit cannot evaluate them it says so in one line; it never reads an
    unreadable record as "nothing lost".

Never fatal: every path exits 0, and a failure prints one visible line.
"""
import json
import os
import re
import select
import stat
import sys
import time

ISSUE = "#2380"
RECENT_S = 600            # how far back "ended without being re-attached" looks
HEAD_BYTES = 512 * 1024   # where a transcript's first prompt is looked for
TAIL_BYTES = 256 * 1024   # where its exit record and title are looked for
INPUT_WAIT_S = 2.0        # never hold a session start on an input that does not close
NAME_MAX = 80


# --------------------------------------------------------------------------- input

def read_hook_input():
    """The hook's JSON envelope, or {} - bounded, so a stream that never closes cannot
    hold the session start."""
    try:
        if sys.stdin is None or sys.stdin.isatty():
            return {}
        fd = sys.stdin.fileno()
    except (OSError, ValueError):
        return {}
    chunks, size = [], 0
    deadline = time.monotonic() + INPUT_WAIT_S
    while size < 4 * 1024 * 1024:
        left = deadline - time.monotonic()
        if left <= 0:
            break
        try:
            ready, _, _ = select.select([fd], [], [], left)
            if not ready:
                break
            chunk = os.read(fd, 65536)
        except (OSError, ValueError):
            break
        if not chunk:
            break
        chunks.append(chunk)
        size += len(chunk)
    try:
        data = json.loads(b"".join(chunks).decode("utf-8", "replace"))
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def config_dir():
    return os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")


# ------------------------------------------------------------------------ processes

def proc_stat(pid):
    """(parent pid, start time in clock ticks) for a live pid, else None."""
    try:
        with open("/proc/%d/stat" % pid, "r", errors="replace") as f:
            text = f.read()
        rest = text[text.rindex(")") + 2:].split()
        return int(rest[1]), rest[19]
    except (OSError, ValueError, IndexError):
        return None


def argv_of(pid):
    try:
        with open("/proc/%d/cmdline" % pid, "rb") as f:
            return f.read().split(b"\0")
    except OSError:
        return []


def is_stream_driven(pid):
    """True when the process takes its conversation as stream-json on standard input.
    That is what an editor panel launches. A print-mode run (`claude -p <prompt>`)
    has no input stream by design, and must never be read as "lost its panel"."""
    argv = argv_of(pid)
    for i, arg in enumerate(argv):
        if arg == b"--input-format=stream-json":
            return True
        if arg == b"--input-format" and i + 1 < len(argv) and argv[i + 1] == b"stream-json":
            return True
    return False


def is_unattended_run(pid):
    """True for a print-mode or background run: nobody reads it and it has no panel
    to lose, so the start-of-session report has no reader there."""
    return any(arg in (b"-p", b"--print", b"--bg") for arg in argv_of(pid))


def looks_like_cli(pid):
    """True when the process is a Claude Code CLI, by the same three signals the
    inbox drain uses (#2215): the command name, the old argument markers, or the
    versioned binary path, which `comm` (just a version number there) does not show."""
    try:
        with open("/proc/%d/comm" % pid, "r", errors="replace") as f:
            if "claude" in f.read():
                return True
    except OSError:
        pass
    joined = b" ".join(argv_of(pid))
    if b"/claude/versions/" in joined or b"claude-code" in joined or b"anthropic.claude" in joined:
        return True
    try:
        return "/claude/versions/" in os.readlink("/proc/%d/exe" % pid)
    except OSError:
        return False


def probe(pid):
    """'attached' | 'headless' | 'unknown' - does this process's input still have a
    writer? Opens, polls, closes. Never reads."""
    path = "/proc/%d/fd/0" % pid
    try:
        if not stat.S_ISFIFO(os.stat(path).st_mode):
            return "unknown"
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    except OSError:
        return "unknown"
    try:
        poller = select.poll()
        poller.register(fd, select.POLLIN)
        events = poller.poll(0)
    except OSError:
        return "unknown"
    finally:
        os.close(fd)
    for _fd, event in events:
        if event & select.POLLHUP:
            return "headless"
    return "attached"


# ------------------------------------------------------------------------- registry

def registry():
    """Every readable entry of the CLI's session registry (<config>/sessions/<pid>.json).
    Entries outlive their process when it is killed, so each one still needs alive()."""
    entries = []
    directory = os.path.join(config_dir(), "sessions")
    try:
        names = os.listdir(directory)
    except OSError:
        return entries
    for name in names:
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(directory, name), "r", encoding="utf-8", errors="replace") as f:
                entry = json.load(f)
        except (OSError, ValueError):
            continue
        if not isinstance(entry, dict):
            continue
        pid, sid = entry.get("pid"), entry.get("sessionId")
        if isinstance(pid, bool) or not isinstance(pid, int) or pid <= 1 or not isinstance(sid, str):
            continue
        entries.append(entry)
    return entries


def alive(entry):
    """The entry's pid exists AND is the same process (start time matches). A bare pid
    match is not enough: pids are reused, and after a container restart they restart
    from 1."""
    found = proc_stat(entry["pid"])
    recorded = entry.get("procStart")
    return found is not None and isinstance(recorded, str) and recorded == found[1]


def own_process(session_id, entries):
    """The pid of the CLI process this hook runs under, or None when it cannot be
    established. The registry answers when it lists a LIVE process for the session.
    When it does not (no entry, or only the stale entry of a process that was killed),
    the hook is still a descendant of its session's process, so walk up to it: that
    is a fact about this process, not a guess, and it needs no internal file.

    The walk stops at the NEAREST CLI process, stream-driven or not. A print-mode run
    started from inside a panel session (a review, a dispatched agent) has that panel
    session further up its ancestry; walking past its own process would tell it that
    it had lost a panel it never had."""
    for entry in entries:
        if session_id and entry.get("sessionId") == session_id and alive(entry):
            return entry["pid"]
    pid, hops = os.getppid(), 0
    while pid > 1 and hops < 32:
        if is_stream_driven(pid) or looks_like_cli(pid):
            return pid
        found = proc_stat(pid)
        if found is None:
            return None
        pid, hops = found[0], hops + 1
    return None


# ----------------------------------------------------------------------- transcripts

def clean(text, limit=NAME_MAX):
    """Text from a transcript or the registry, made safe to print: one line, no
    control characters, bounded."""
    text = "".join(ch if ch.isprintable() else " " for ch in str(text))
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 3] + "..."


def age(seconds):
    seconds = max(0, int(seconds))
    if seconds < 120:
        return "%ds" % seconds
    if seconds < 7200:
        return "%dm" % (seconds // 60)
    if seconds < 172800:
        return "%dh" % (seconds // 3600)
    return "%dd" % (seconds // 86400)


def project_dir(hook, cwd):
    """Where this folder's transcripts live. The hook is told its own transcript path,
    which is authoritative; the fallback rebuilds the folder name the way the CLI does."""
    transcript = hook.get("transcript_path")
    if isinstance(transcript, str) and os.path.isdir(os.path.dirname(transcript)):
        return os.path.dirname(transcript)
    return os.path.join(config_dir(), "projects", re.sub(r"[^a-zA-Z0-9]", "-", cwd))


def json_lines(blob):
    for line in blob.split(b"\n"):
        line = line.strip()
        if not line.startswith(b"{"):
            continue
        try:
            record = json.loads(line.decode("utf-8", "replace"))
        except ValueError:
            continue
        if isinstance(record, dict):
            yield record


def read_span(path, start, length):
    try:
        with open(path, "rb") as f:
            if start:
                f.seek(start)
            return f.read(length)
    except OSError:
        return b""


def head_facts(path):
    """What kind of session wrote this transcript: (a prompt was seen, an origin field
    was seen, it is an editor panel a human typed into)."""
    prompt_seen = origin_seen = panel = False
    for record in json_lines(read_span(path, 0, HEAD_BYTES)):
        if record.get("type") != "user":
            continue
        prompt_seen = True
        if "turnOrigin" in record:
            origin_seen = True
            if record.get("turnOrigin") == "human" and record.get("entrypoint") == "sdk-cli":
                panel = True
                break
    return prompt_seen, origin_seen, panel


def tail_facts(path, size):
    """(exited cleanly, exit time or None, title or None) from the end of a transcript.
    A cost-state record that is the LAST record means the process wrote its exit and
    nothing has continued the session since."""
    records = list(json_lines(read_span(path, max(0, size - TAIL_BYTES), TAIL_BYTES)))
    clean_exit, ended_at, title = False, None, None
    if records and records[-1].get("type") == "cost-state":
        clean_exit = True
        start, duration = records[-1].get("startTime"), records[-1].get("totalDuration")
        if isinstance(start, (int, float)) and isinstance(duration, (int, float)):
            ended_at = (start + duration) / 1000.0
    for record in reversed(records):
        kind = record.get("type")
        if kind == "custom-title" and isinstance(record.get("customTitle"), str):
            title = record["customTitle"]
            break
        if kind == "ai-title" and title is None and isinstance(record.get("aiTitle"), str):
            title = record["aiTitle"]
    return clean_exit, ended_at, title


JOB_ID = re.compile(r"\bjob ([0-9A-Za-z_-]{4,64})\b")


def result_text(block):
    content = block.get("content")
    if isinstance(content, list):
        return " ".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
    return str(content or "")


def armed_schedules(path):
    """Schedules this session created and never cancelled: [(cron, prompt, job id)].
    Schedules are held in the process only, so this record in the transcript is the
    one durable trace that a loop was armed."""
    pending, created, cancelled = {}, {}, set()
    try:
        handle = open(path, "rb")
    except OSError:
        return []
    with handle:
        for line in handle:
            if b"Cron" not in line and not pending:
                continue
            try:
                record = json.loads(line.decode("utf-8", "replace"))
            except ValueError:
                continue
            message = record.get("message") if isinstance(record, dict) else None
            content = message.get("content") if isinstance(message, dict) else None
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "tool_use":
                    args = block.get("input") if isinstance(block.get("input"), dict) else {}
                    if block.get("name") == "CronCreate":
                        pending[block.get("id")] = (args.get("cron"), args.get("prompt"))
                    elif block.get("name") == "CronDelete" and isinstance(args.get("id"), str):
                        cancelled.add(args["id"])
                elif block.get("type") == "tool_result" and block.get("tool_use_id") in pending:
                    cron, prompt = pending.pop(block["tool_use_id"])
                    found = JOB_ID.search(result_text(block))
                    if found and not block.get("is_error"):
                        created[found.group(1)] = (cron, prompt)
    return [(cron, prompt, job) for job, (cron, prompt) in created.items() if job not in cancelled]


def schedule_lines(path, verb):
    lines = []
    for cron, prompt, job in armed_schedules(path):
        lines.append('      %s: %s on "%s" (job %s)' % (verb, clean(prompt), clean(cron, 40), clean(job, 20)))
    return lines


# ----------------------------------------------------------------------------- self

def mode_self(hook):
    entries = registry()
    pid = own_process(hook.get("session_id"), entries)
    if pid is None or not is_stream_driven(pid) or probe(pid) != "headless":
        return
    mine = next((e for e in entries if e.get("pid") == pid), None)
    folder = hook.get("cwd") or (mine or {}).get("cwd")
    peers = []
    for entry in entries:
        if entry["pid"] == pid or entry.get("cwd") != folder or not alive(entry):
            continue
        if is_stream_driven(entry["pid"]) and probe(entry["pid"]) == "attached":
            peers.append(entry)
    out = [
        "⚠️  THIS SESSION HAS NO PANEL (%s). Its input stream has no writer: a window reload" % ISSUE,
        "    or an editor restart replaced its panel with a new, blank session. Nobody can read",
        "    what you write here, and in every measured case Read, Write and Edit were refused.",
        "    Do not start new work and do not dispatch agents.",
        "    1. Hand over now. SendMessage what is in flight to a live session in this folder:",
    ]
    for entry in peers:
        sock = entry.get("messagingSocketPath")
        target = (' -> "uds:%s"' % clean(sock, 200)) if isinstance(sock, str) and sock else ""
        out.append('         "%s"%s' % (clean(entry.get("name") or entry["sessionId"][:8]), target))
    if not peers:
        out.append("         (none is live: write the handover to a file the next session will read)")
    out += [
        "    2. Cancel every schedule you hold: CronList, then CronDelete each id. A schedule",
        "       left armed here keeps firing with nobody watching.",
        "    3. Stop. This process exits by itself once it is idle.",
    ]
    print("\n".join(out))


# ---------------------------------------------------------------------------- start

def mode_start(hook):
    me = hook.get("session_id")
    folder = hook.get("cwd") or os.getcwd()
    now = time.time()
    entries = registry()
    mine = own_process(me, entries)
    if mine is not None and is_unattended_run(mine) and not is_stream_driven(mine):
        # A print-mode or background run (the inbox drain starts dozens a day in this
        # folder). It cannot tell a human anything and is not taking over a panel.
        return
    live = {}
    headless = []
    for entry in entries:
        if not alive(entry):
            continue
        live[entry["sessionId"]] = entry
        if entry["sessionId"] == me or entry.get("cwd") != folder:
            continue
        if is_stream_driven(entry["pid"]) and probe(entry["pid"]) == "headless":
            headless.append(entry)
    # The registry is an internal file. It is only trusted to say "that process is
    # gone" when it demonstrably works, and the proof is that it lists THIS session.
    registry_works = bool(me) and me in live

    directory = project_dir(hook, folder)
    ended = []
    prompts_seen = origins_seen = 0
    try:
        listing = list(os.scandir(directory))
    except OSError:
        listing = []
    for item in listing:
        if not item.name.endswith(".jsonl"):
            continue
        sid = item.name[: -len(".jsonl")]
        try:
            info = item.stat()
        except OSError:
            continue
        if not stat.S_ISREG(info.st_mode) or sid == me or sid in live:
            continue
        if now - info.st_mtime > RECENT_S:
            continue
        prompt_seen, origin_seen, panel = head_facts(item.path)
        prompts_seen += prompt_seen
        origins_seen += origin_seen
        if not panel:
            continue
        clean_exit, ended_at, title = tail_facts(item.path, info.st_size)
        if not clean_exit and not registry_works:
            # No exit record, and no working registry to say its process is gone: it
            # may simply be running. Reporting it would cry wolf at every start.
            continue
        when = ended_at if ended_at is not None and info.st_mtime - 3600 <= ended_at <= now + 60 else info.st_mtime
        ended.append((when, sid, title, clean_exit, item.path))
    ended.sort()

    out = []
    count = len(headless) + len(ended)
    if count:
        one = count == 1
        out += [
            "⚠️  SESSION LOSS (%s) - %d session%s in this folder lost %s panel, and the editor did"
            % (ISSUE, count, "" if one else "s", "its" if one else "their"),
            "    not re-attach %s. %s NOT in your context. Tell the human now, before"
            % ("it" if one else "them", "Its conversation is" if one else "Their conversations are"),
            "    other work, and ask which one this panel is taking over.",
            "",
        ]
    for entry in headless:
        sid = entry["sessionId"]
        path = os.path.join(directory, sid + ".jsonl")
        started = entry.get("startedAt")
        since = (", started %s ago" % age(now - started / 1000.0)) if isinstance(started, (int, float)) and started > 0 else ""
        out.append(
            '    * "%s" (%s) - still running with NO panel (pid %d, %s%s).'
            % (clean(entry.get("name") or "unnamed"), sid[:8], entry["pid"], clean(entry.get("status") or "state unknown", 20), since)
        )
        out.append("      Nobody can read what it writes, and it can still act. It is told at its next prompt.")
        sock = entry.get("messagingSocketPath")
        if isinstance(sock, str) and sock:
            out.append('      To stand it down sooner, SendMessage to "uds:%s": hand over and stop.' % clean(sock, 200))
        out += schedule_lines(path, "It still holds")
        if os.path.isfile(path):
            out.append("      Transcript: %s" % path)
    for when, sid, title, clean_exit, path in ended:
        how = "ended %s ago" % age(now - when) if clean_exit else "its process is gone (no exit record; last write %s ago)" % age(now - when)
        out.append('    * "%s" (%s) - %s and was not re-attached.' % (clean(title or "untitled"), sid[:8], how))
        lost = schedule_lines(path, "It had armed")
        if lost:
            out += lost
            out.append("      That schedule died with it. If this panel takes over, re-arm it here with CronCreate.")
        out.append("      Transcript: %s" % path)
        out.append("      Resume it in a terminal: claude --resume %s" % sid)
    if count:
        out += [
            "",
            "    Nothing was lost from disk. To pick up a conversation in THIS session, read the end",
            "    of its transcript. The editor cannot show it in a panel again until %s is fixed." % ISSUE,
        ]
    if prompts_seen and not origins_seen:
        out.append(
            "⚠️  Lost-panel check: could not classify %d recent transcript%s in %s (no origin field) -"
            % (prompts_seen, "" if prompts_seen == 1 else "s", directory)
        )
        out.append("    a session that ended without being re-attached would NOT be reported (%s)." % ISSUE)
    if out:
        print("\n".join(out))


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode not in ("start", "self"):
        print("usage: session-panel.py start|self   (hook JSON on standard input)", file=sys.stderr)
        return 0
    try:
        hook = read_hook_input()
        (mode_start if mode == "start" else mode_self)(hook)
    except Exception as error:  # noqa: BLE001 - a hook must never wedge a session
        print(
            "⚠️  Lost-panel check failed (%s) - a session that lost its panel is NOT being reported (%s)."
            % (type(error).__name__, ISSUE)
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
