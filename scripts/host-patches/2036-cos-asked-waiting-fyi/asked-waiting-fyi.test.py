#!/usr/bin/env python3
"""Regression - `asked` and `waiting` must read the #1857 routing marker, not the arrow's presence.

AIClarityAU/minspec#2036. After #1857 the arrow carries a bracketed marker:
`[act]` (dispatchable to an agent), `[fyi]` (informational), `[human:<StopClass>]`
(advisory), or nothing (a human is the actor). `cmd_nudge` classifies every item
through item_actor(). `cmd_asked` and `cmd_waiting` tested only whether the arrow
character (or "Your turn") appeared ANYWHERE in the turn, so a session whose
entire block was `[fyi]` was still reported as holding a question for the human,
and `asked` printed `[act]` and `[human:...]` items identically.

Properties, each exercised through the real commands against fake sessions:

  1. SIGNAL     - a block of only [fyi] / only [act] items is NOT an ask: absent
                  from `asked`'s question list, and `waiting` does not say ASKING YOU.
  2. FAIL-CLOSED - every input the marker cannot vouch for is still an ask: a bare
                  arrow, an unknown or wrong-case token, an [act] the high-stakes
                  witness vetoes, "Your turn" with no arrow, an arrow with no readable
                  item. Never resolved to "fyi" (that would delete the item).
  3. VISIBLE    - a session judged to hold nothing for the human is still PRINTED by
                  `asked`, with its tally, never silently dropped (invariant 2).
  4. CLASSIFIED - each item `asked` prints carries its resolved reason, so an
                  [act] item and a [human:...] item no longer render identically,
                  and non-human items in a mixed block are counted, not shown as asks.

Run against a specific build with COS_PY=/path/to/cos.py (apply.sh does, before it
installs anything). Default is the installed copy. Makes no network call and reads
no real transcript: load_sessions and last_assistant_text are replaced by fakes.
"""
import argparse, contextlib, importlib.machinery, importlib.util, io, os

COS_PATH = os.environ.get("COS_PY") or os.path.expanduser("~/.claude/scripts/cos.py")
# An explicit loader, so a target without a .py suffix (a backup, a rehearsal copy)
# still loads instead of spec_from_file_location() returning None.
spec = importlib.util.spec_from_loader(
    "cos", importlib.machinery.SourceFileLoader("cos", COS_PATH))
cos = importlib.util.module_from_spec(spec); spec.loader.exec_module(cos)
FAILS = []
A = "➡️"   # the arrow as sessions write it: U+27A1 + VS16

# name -> the session's last assistant turn, already whitespace-collapsed the way
# last_assistant_text() returns it.
TURNS = {
    "s-fyi-only":     f"Merged and verified. **Your turn** {A}[fyi] #1231 landed on main {A}[fyi] nothing else pending",
    "s-act-only":     f"**Your turn** {A}[act] rebase #1240 onto main",
    "s-bare":         f"**Your turn** {A} #1231 dispatch env scrub - `m` merge",
    "s-mixed":        f"**Your turn** {A}[fyi] the drain is idle {A}[human:spend-above-threshold] buy two more seats",
    "s-human-tag":    f"{A}[human:approval-or-acceptance] read SPEC-044 FR-4b",
    "s-yourturn-only": "**Your turn** decide whether the hook is named agent-context",
    "s-vetoed-act":   f"{A}[act] merge #1500 once green",
    "s-wrong-case":   f"{A}[FYI] looks informational but the token is not the allow-listed one",
    "s-empty-arrow":  f"All done here {A}",
    "s-no-block":     "Finished the refactor; tests pass.",
}
ASKS = {"s-bare", "s-mixed", "s-human-tag", "s-yourturn-only", "s-vetoed-act",
        "s-wrong-case", "s-empty-arrow"}
QUIET = {"s-fyi-only", "s-act-only"}


def check(cond, msg):
    if not cond:
        FAILS.append(msg)


def run(fn, **argkw):
    rows = [{"name": n, "sid": f"sid-{n}", "state": "LIVE", "tpath": f"/fake/{n}.jsonl",
             "mtime": 1} for n in TURNS]
    stubs = {
        "load_sessions": lambda enrich=True: rows,
        "last_assistant_text": lambda p: TURNS[os.path.basename(p)[:-len(".jsonl")]],
        "idle_secs": lambda r: 3600,
        "machine_uptime": lambda: None,
    }
    saved = {k: getattr(cos, k) for k in stubs}
    try:
        for k, v in stubs.items():
            setattr(cos, k, v)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            fn(argparse.Namespace(**argkw))
        return buf.getvalue()
    finally:
        for k, v in saved.items():
            setattr(cos, k, v)


def asked_sections(out):
    """(question-list text, quiet-list text) of `asked` output, split at the quiet header."""
    marker = "nothing for you"
    i = out.find(marker)
    if i < 0:
        return out, ""
    head = out.rfind("\n", 0, i)
    return out[:head], out[head:]


def blocks(text):
    """name -> the lines printed under that session's header in the question list."""
    res, cur = {}, None
    for line in text.splitlines():
        first = line.split(" ")[0] if line else ""
        if first in TURNS:
            cur = first
            res[cur] = []
        elif cur and line.startswith("   "):
            res[cur].append(line)
        elif not line.strip():
            cur = None
    return res


def test_asked():
    out = run(cos.cmd_asked)
    qs, quiet = asked_sections(out)
    got = blocks(qs)
    for n in sorted(QUIET):
        check(n not in got, f"asked: {n} (no human item) is listed as holding a question for you")
        check(n in quiet, f"asked: {n} is not printed in the 'nothing for you' list (silently dropped)")
    for n in sorted(ASKS):
        check(n in got, f"asked: {n} is an ask the marker cannot vouch for, but asked did not list it")
    check("s-no-block" not in out, "asked: a turn with no action block was mentioned at all")
    check("1 act" in quiet and "2 fyi" in quiet,
          f"asked: the quiet list does not carry each session's tally:\n{quiet}")
    mixed = "\n".join(got.get("s-mixed", []))
    check("[human:spend-above-threshold]" in mixed,
          f"asked: the human item does not carry its resolved reason:\n{mixed}")
    check("the drain is idle" not in mixed,
          f"asked: an [fyi] item is printed as an ask in a mixed block:\n{mixed}")
    check("1 fyi" in mixed, f"asked: the mixed block does not count its [fyi] item:\n{mixed}")
    check("[unmarked]" in "\n".join(got.get("s-bare", [])),
          "asked: a bare-arrow item is not labelled unmarked")
    check("[vetoed:merge]" in "\n".join(got.get("s-vetoed-act", [])),
          "asked: an [act] item naming a merge is not shown as vetoed to a human")
    check("[unknown:FYI]" in "\n".join(got.get("s-wrong-case", [])),
          "asked: a wrong-case [FYI] token is not shown as an unknown (human) item")
    check("unclassified" in "\n".join(got.get("s-empty-arrow", [])),
          "asked: an arrow with no readable item is not flagged unclassified")


def test_waiting():
    out = run(cos.cmd_waiting)
    kinds = {}
    for line in out.splitlines():
        first = line.split(" ")[0] if line else ""
        if first in TURNS:
            kinds[first] = line
    for n in sorted(QUIET):
        check("ASKING YOU" not in kinds.get(n, ""),
              f"waiting: {n} holds only [fyi]/[act] items but is classified ASKING YOU")
        check("NOTHING FOR YOU" in kinds.get(n, ""),
              f"waiting: {n} is not classified NOTHING FOR YOU: {kinds.get(n)!r}")
    for n in sorted(ASKS):
        check("ASKING YOU" in kinds.get(n, ""),
              f"waiting: {n} is an ask the marker cannot vouch for, but is {kinds.get(n)!r}")
    check("finished/idle" in kinds.get("s-no-block", ""),
          f"waiting: a turn with no block is {kinds.get('s-no-block')!r}")


test_asked()
test_waiting()
if FAILS:
    for f in FAILS:
        print("FAIL", f)
    raise SystemExit(1)
print("ok asked-waiting-fyi - asked and waiting classify each item; only [fyi]/[act]-only blocks are not asks")
