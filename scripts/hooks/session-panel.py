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
(Those counts cannot be checked from this file: the transcripts, times and method are
in the comment of 2026-10-09 on #2380.) Neither side was told. This unit is that
statement, made to both sides:

  self   (UserPromptSubmit) - "THIS session has no panel": its own input has no writer.
  start  (SessionStart)     - "these sessions in this folder lost their panel": the ones
                              still running headless, the ones that ended in the last
                              few minutes without being re-attached, one whose registry
                              entry was found dead long before this session started (a
                              container restart, announced once via a small state file
                              rather than re-announced for as long as the stale entry
                              sits there - #2633), and any schedule (/loop) they held.
                              That last part is the dead-loop backstop of #2379, keyed
                              on the record the CLI itself writes (CronCreate /
                              CronDelete in the transcript) instead of a marker file
                              that nothing ever wrote.

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
  * Any running process on a machine with no /proc (macOS, Windows). There `self`
    says nothing, and `start` names only a session that wrote its exit record.
  * An ENDED session whose first prompt was written before the CLI recorded where a
    prompt came from (about 2026-09-22). Its transcript does not show it was a panel
    a person typed into, so it is not named once it has ended. While it still runs
    headless it IS named: that path reads the process, not the transcript.
  * A session killed long before this one started (a container restart after an idle
    night) IS named (#2633), by its dead registry entry rather than by transcript age:
    alive() already proves the process is gone, with no RECENT_S limit. What this path
    still cannot do: call a dead entry with no transcript on disk a panel loss (there is
    nothing to read "human" from, so it is skipped), or tell the difference between a
    loss nobody has seen yet and one this folder has already been told about - that is
    what the small state file under ${XDG_CACHE_HOME:-~/.cache}/session-panel/ is for:
    it remembers the first session that saw a given dead entry and stays quiet after
    ANNOUNCE_WINDOW_S, forever, even though the registry entry itself is never cleaned
    up (measured 2026-10-09: 80 of them, the oldest from 2026-09-17). A corrupt or
    unwritable state file is read as empty, which means "announce it" - the fail-open
    side costs one repeat announcement, never a silently swallowed loss.
  * A session that is still running, is absent from the registry and has written no
    exit record. The registry is the only witness for such a process, so at start it
    is named, in those words: "the registry lists no live process for it". The
    registry is believed at all only when it lists the session that is asking.
  * The session registry and the transcript fields are internal to the CLI. Where
    this unit cannot evaluate them it says so in one line; it never reads an
    unreadable record as "nothing lost".

WHAT IT ASSUMES ABOUT THE CLI (read from 2.1.283; none of it is a documented interface):
  registry    <config>/sessions/<pid>.json holding pid, sessionId (a UUID), cwd and
              procStart (field 22 of /proc/<pid>/stat); optionally name, status,
              startedAt and messagingSocketPath.
  transcript  <config>/projects/<folder>/<session id>.jsonl, one JSON record a line.
              A prompt is type "user" and carries turnOrigin and entrypoint ("human"
              and "sdk-cli" when typed into a panel). A clean exit is a LAST record
              of type "cost-state"; startTime + totalDuration is when. A title is
              "custom-title" or "ai-title". A schedule is a CronCreate tool_use whose
              result names "job <id>", cancelled by a CronDelete tool_use of that id.
  process     a panel session has "--input-format stream-json" in its arguments and
              an anonymous pipe as its standard input.
When one of these stops holding, the unit says less and says so (the registry no
longer lists this session; no recent prompt carries an origin). It does not guess.

WHAT IT PRINTS is read by a session and by a person, so nothing from a file name, the
registry or a transcript is printed as found: a session id must be a UUID, names and
titles go through clean(), and paths through shown().

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
ANNOUNCE_WINDOW_S = 600   # a stale registry entry (#2633) is announced only to sessions
                          # starting this soon after it is FIRST seen, never again after
STATE_LOCK_WAIT_S = 2.0   # never hold a session start on the announce-state lock either
UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\Z")


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
        if chunk.rstrip().endswith(b"}"):
            # Possibly complete. If it parses, answer now: a caller that leaves the
            # stream open must not cost every prompt the whole deadline.
            data = parse_envelope(chunks)
            if data is not None:
                return data
    return parse_envelope(chunks) or {}


def parse_envelope(chunks):
    try:
        data = json.loads(b"".join(chunks).decode("utf-8", "replace"))
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


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
    """True when the process IS a Claude Code CLI: by its command name, by the binary
    it runs (the versioned per-release binary shows only a version number as its
    name, #2215), or by the program it was started as. Deliberately NOT by a marker
    anywhere in its arguments: the shell that runs this very hook has the repo path
    in its arguments, and a checkout under a folder called "claude-code" would then
    be taken for the CLI and end the walk one process too early."""
    try:
        with open("/proc/%d/comm" % pid, "r", errors="replace") as f:
            if f.read().strip() == "claude":
                return True
    except OSError:
        pass
    programs = [arg.decode("utf-8", "replace") for arg in argv_of(pid)[:2]]
    try:
        programs.append(os.readlink("/proc/%d/exe" % pid))
    except OSError:
        pass
    for program in programs:
        if "/claude/versions/" in program or "@anthropic-ai/claude-code/" in program or os.path.basename(program) == "claude":
            return True
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
        if isinstance(pid, bool) or not isinstance(pid, int) or pid <= 1:
            continue
        if not isinstance(sid, str) or not UUID.match(sid):
            continue  # a session id is printed and becomes part of a path: a UUID or nothing
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


# ---------------------------------------------------------------- announce-once state

def state_paths():
    """(state directory, state file, lock file) for the #2633 announce-once record.
    Same base session-identity.sh already uses for its own per-machine state."""
    base = os.environ.get("XDG_CACHE_HOME") or os.path.join(os.path.expanduser("~"), ".cache")
    directory = os.path.join(base, "session-panel")
    return directory, os.path.join(directory, "announced.json"), os.path.join(directory, "announced.lock")


def decide_announcements(candidate_sids, known_sids, now):
    """Which of candidate_sids (dead registry entries whose panel transcript was just
    found) get announced NOW: ones never seen before (first sight - and now recorded as
    seen), and ones seen within the last ANNOUNCE_WINDOW_S. Never one seen longer ago
    than that: the registry entry itself is never cleaned up (measured 2026-10-09: 80
    of them, the oldest from 2026-09-17), so without this cutoff the same loss would be
    re-announced at every session start in the folder for as long as the entry sits
    there.

    known_sids prunes the state file to sessions the registry still lists at all, so
    it stays bounded by the registry's own size rather than growing forever on top of it.

    Two sessions starting at once must reach the SAME answer for a given sid, or one
    would announce a loss the other just silently recorded as seen. The read-decide
    -write below runs under a lock for that reason - but a lock that cannot be taken
    quickly is not worth holding a session start for: on timeout, or on any error
    reading or writing the file, this degrades to treating the state as empty, which
    means "announce it". Fail-open on this side costs one repeat announcement, which
    is cheap; fail-closed would risk a loss nobody is ever told about, which is exactly
    what this unit exists to prevent (see 'Never fatal' at the bottom of the file).
    """
    directory, state_path, lock_path = state_paths()
    try:
        os.makedirs(directory, mode=0o700, exist_ok=True)
    except OSError:
        pass

    lock_fd = None
    try:
        lock_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
        import fcntl
        deadline = time.monotonic() + STATE_LOCK_WAIT_S
        while time.monotonic() < deadline:
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                time.sleep(0.02)
    except (OSError, ImportError):
        pass  # no lock taken: still correct, just not race-safe under concurrent starts

    try:
        try:
            with open(state_path, "r", encoding="utf-8") as f:
                state = json.load(f)
            if not isinstance(state, dict):
                state = {}
        except (OSError, ValueError):
            state = {}

        state = {sid: seen for sid, seen in state.items() if sid in known_sids and isinstance(seen, (int, float))}
        announce = set()
        for sid in candidate_sids:
            first_seen = state.get(sid)
            if first_seen is None:
                state[sid] = now
                announce.add(sid)
            elif now - first_seen <= ANNOUNCE_WINDOW_S:
                announce.add(sid)

        try:
            tmp = "%s.tmp.%d" % (state_path, os.getpid())
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(state, f)
            os.replace(tmp, state_path)
        except OSError:
            pass
        return announce
    finally:
        if lock_fd is not None:
            try:
                import fcntl
                fcntl.flock(lock_fd, fcntl.LOCK_UN)
            except OSError:
                pass
            os.close(lock_fd)


# ----------------------------------------------------------------------- transcripts

def clean(text, limit=NAME_MAX):
    """Text from a transcript or the registry, made safe to print: one line, no
    control characters, bounded."""
    text = "".join(ch if ch.isprintable() else " " for ch in str(text))
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 3] + "..."


def shown(path):
    """A path, made safe to print: each non-printable character becomes "?". Neither
    shortened nor re-spaced, so a clean path is printed exactly and can be used."""
    return "".join(ch if ch.isprintable() else "?" for ch in str(path))


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
    # Every record in the span is parsed, on purpose. Parsing only lines that look like
    # a prompt saved 27 ms over the 30 newest real transcripts (41 ms to 14 ms, measured
    # 2026-10-09) and would go blind, silently, on any change in how the CLI spaces its
    # JSON: no prompt seen means no "could not classify" warning either.
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
    mine = next((e for e in entries if e.get("pid") == pid and alive(e)), None)
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
    dead_sids = set()  # #2633: registry entries for THIS folder whose process is gone
    for entry in entries:
        if not alive(entry):
            if entry.get("sessionId") != me and entry.get("cwd") == folder:
                dead_sids.add(entry["sessionId"])
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
        if not UUID.match(sid):
            continue  # not a session's transcript, and never printed (see WHAT IT PRINTS)
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

    # #2633: a session whose registry entry died long before this one started (a
    # container restart after an idle night) - not caught above, which only looks back
    # RECENT_S seconds. alive() already proved its process gone, with no time limit;
    # what is still needed is a transcript to tell a human panel from anything else,
    # and the once-only announce gate so the stale entry (never cleaned up) is not
    # re-announced at every start for as long as it sits in the registry.
    ended_sids = {sid for _, sid, _, _, _ in ended}
    stale = []
    for sid in dead_sids:
        if sid in ended_sids:
            continue  # already reported above; no duplicate line for the same session
        path = os.path.join(directory, sid + ".jsonl")
        try:
            info = os.stat(path)
        except OSError:
            continue  # no transcript on disk: nothing to read "human panel" from
        if not stat.S_ISREG(info.st_mode):
            continue
        prompt_seen, origin_seen, panel = head_facts(path)
        prompts_seen += prompt_seen
        origins_seen += origin_seen
        if not panel:
            continue
        stale.append((sid, path, info))
    if stale:
        known_sids = {e.get("sessionId") for e in entries if isinstance(e.get("sessionId"), str)}
        to_announce = decide_announcements([sid for sid, _, _ in stale], known_sids, now)
        for sid, path, info in stale:
            if sid not in to_announce:
                continue
            clean_exit, ended_at, title = tail_facts(path, info.st_size)
            when = ended_at if ended_at is not None and info.st_mtime - 3600 <= ended_at <= now + 60 else info.st_mtime
            ended.append((when, sid, title, clean_exit, path))
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
            out.append("      Transcript: %s" % shown(path))
    for when, sid, title, clean_exit, path in ended:
        # Without an exit record the claim is exactly as strong as its one witness.
        how = (
            "ended %s ago" % age(now - when)
            if clean_exit
            else "the registry lists no live process for it (no exit record; last write %s ago)" % age(now - when)
        )
        out.append('    * "%s" (%s) - %s and was not re-attached.' % (clean(title or "untitled"), sid[:8], how))
        lost = schedule_lines(path, "It had armed")
        if lost:
            out += lost
            out.append("      That schedule died with it. If this panel takes over, re-arm it here with CronCreate.")
        out.append("      Transcript: %s" % shown(path))
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
            % (prompts_seen, "" if prompts_seen == 1 else "s", shown(directory))
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
