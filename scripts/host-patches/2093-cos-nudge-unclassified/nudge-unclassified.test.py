#!/usr/bin/env python3
"""#2093 regression - `cos.py nudge` must never drop a session it cannot classify.

`cmd_nudge` read each idle session's last assistant turn through
`last_assistant_text`, which returns "" both when the transcript ends on a USER
record (a tool result: the session is wedged mid-tool-call) and when there is
nothing to read at all. `cmd_nudge` then did `if not txt: continue`, so such a
session landed in neither DUE nor HELD, and a run where every idle session had
that shape printed "no parked sessions" - "nothing to do" instead of "something
I could not classify". The wedged-mid-tool-call session is exactly the class a
nudge policy exists to catch.

Fingerprint in the field: 8 of 16 entries in `.cos-state.json`'s `nudged` map
carried hash `da39a3ee5e6b`, the SHA-1 of the empty string - written by
`nudge --mark`, which hashed the "" it got for such a session without
complaint.

Run: COS_PY=/path/to/cos.py python3 nudge-unclassified.test.py
(defaults to ~/.claude/scripts/cos.py). No network: sessions, transcripts and
the state file are all faked in a temp dir.
"""
import contextlib, importlib.machinery, importlib.util, io, json, os, sys, tempfile, time, types

TARGET = os.environ.get("COS_PY") or os.path.expanduser("~/.claude/scripts/cos.py")
# An explicit loader, so a backup named `cos.py.bak-*` (no .py suffix) still loads.
spec = importlib.util.spec_from_file_location(
    "cos_under_test", TARGET, loader=importlib.machinery.SourceFileLoader("cos_under_test", TARGET))
cos = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cos)

FAILS = []
TMP = tempfile.mkdtemp(prefix="nudge-2093-")
EMPTY_SHA = "da39a3ee5e6b"


def check(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}")
    if not cond:
        FAILS.append(f"{name}: {detail}")


def transcript(name, records):
    path = os.path.join(TMP, name + ".jsonl")
    with open(path, "w") as fh:
        for r in records:
            fh.write(json.dumps(r) + "\n")
    return path


def asst(text=None, tool=False):
    content = []
    if text is not None:
        content.append({"type": "text", "text": text})
    if tool:
        content.append({"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "sleep 9999"}})
    return {"type": "assistant", "message": {"role": "assistant", "content": content}}


def tool_result():
    return {"type": "user", "message": {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "t1", "content": "ok"}]}}


PROMPT = {"type": "user", "message": {"role": "user", "content": "go"}}

WEDGED = transcript("wedged", [PROMPT, asst("running it", tool=True), tool_result()])
TOOLCALL = transcript("toolcall", [PROMPT, asst(tool=True)])
PARKED = transcript("parked", [PROMPT, asst("Done. **Your turn** ➡️ #1 merge [act]")])


def row(sid, name, tpath):
    return {"sid": sid, "name": name, "state": "LIVE", "tpath": tpath,
            "mtime": time.time() - 3600}


def run_nudge(rows, state=None, **argv):
    """Run cmd_nudge against fake rows + a private state file; return (stdout, exit, state)."""
    st_path = os.path.join(TMP, f"state-{time.time_ns()}.json")
    with open(st_path, "w") as fh:
        json.dump(state or {}, fh)
    saved = (cos.STATE, cos.load_sessions, cos.idle_secs)
    cos.STATE = st_path
    cos.load_sessions = lambda enrich=True: [dict(r) for r in rows]
    cos.idle_secs = lambda r: 3600.0
    args = types.SimpleNamespace(mark=argv.get("mark"), mark_due=argv.get("mark_due", False))
    buf, code = io.StringIO(), 0
    try:
        with contextlib.redirect_stdout(buf):
            try:
                code = cos.cmd_nudge(args) or 0
            except SystemExit as e:
                code = e.code or 0
    finally:
        cos.STATE, cos.load_sessions, cos.idle_secs = saved
    with open(st_path) as fh:
        return buf.getvalue(), code, json.load(fh)


print("nudge-unclassified (#2093)")

# 1. The acceptance shape: the ONLY idle session is wedged mid-tool-call.
out, _, _ = run_nudge([row("s-wedged", "wedged-session", WEDGED)])
check("a wedged-mid-tool-call session appears in the output", "wedged-session" in out, out)
check("it is reported as UNCLASSIFIED", "UNCLASSIFIED" in out, out)
check("the reason names the USER last record", "USER record" in out, out)
check("'no parked sessions' is NOT printed while a session is unclassified",
      "no parked sessions" not in out, out)

# 2. A session whose last record is an assistant tool_use with no text.
out, _, _ = run_nudge([row("s-tool", "toolcall-session", TOOLCALL)])
check("an assistant turn with no text (ended on a tool call) is UNCLASSIFIED, not dropped",
      "toolcall-session" in out and "UNCLASSIFIED" in out, out)

# 3. No transcript at all, and an unreadable transcript path.
out, _, _ = run_nudge([row("s-none", "no-transcript-session", None),
                       row("s-gone", "missing-file-session", os.path.join(TMP, "absent.jsonl"))])
check("a session with no transcript is UNCLASSIFIED, not dropped",
      "no-transcript-session" in out, out)
check("a session whose transcript cannot be read is UNCLASSIFIED, not dropped",
      "missing-file-session" in out, out)
check("the count says 2 unclassified", "2 idle session(s)" in out, out)

# 4. Mixed: the parked session is still DUE, and the wedged one still shown.
out, _, _ = run_nudge([row("s-parked", "parked-session", PARKED),
                       row("s-wedged", "wedged-session", WEDGED)])
check("an ordinary parked session is still DUE (no regression)",
      "DUE" in out and "parked-session" in out, out)
check("alongside it the wedged session is UNCLASSIFIED",
      "wedged-session" in out and "UNCLASSIFIED" in out, out)

# 5. Control: nothing idle at all still prints the truthful quiet line.
out, _, _ = run_nudge([])
check("with no sessions, 'no parked sessions' is still printed", "no parked sessions" in out, out)

# 6. --mark must not write the empty-string hash for an unclassifiable session.
out, code, st = run_nudge([row("s-wedged", "wedged-session", WEDGED)], mark=["wedged-session"])
hashes = [v.get("hash") for v in (st.get("nudged") or {}).values()]
check("--mark refuses to record an empty-text hash (da39a3ee5e6b)", EMPTY_SHA not in hashes,
      f"nudged={st.get('nudged')}")
check("--mark says why it did not mark the unclassified session",
      "UNCLASSIFIED" in out or "unclassified" in out, out)

# 7. --mark-due marks the parked session and leaves the wedged one out.
out, _, st = run_nudge([row("s-parked", "parked-session", PARKED),
                        row("s-wedged", "wedged-session", WEDGED)], mark_due=True)
led = st.get("nudged") or {}
check("--mark-due still marks the parked session", "s-parked" in led, f"nudged={led}")
check("--mark-due does not mark the unclassified session", "s-wedged" not in led, f"nudged={led}")

print()
if FAILS:
    print(f"{len(FAILS)} FAILING:")
    for f in FAILS:
        print(f"  - {f}")
    sys.exit(1)
print("ok nudge-unclassified - a session nudge cannot classify is reported, never dropped")
