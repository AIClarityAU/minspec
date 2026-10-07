#!/usr/bin/env python3
"""Regression - an open-PR read that was cut short must SAY so, and must not be cut at 40.

Measured 2026-10-01 (minspec #2369): the repo had 79 open pull requests and every
"all open PRs" query in cos.py asked for `--limit 40`. `adminable --verbose` printed
exactly 40 withheld rows, #2366 down to #2292, and the older machinery PRs (#2288,
#2291) appeared nowhere - not ADMIN-OK, not withheld. The verbose withheld-list is the
control that proves the query RAN; with the cap hit it proved nothing about what the
query COVERED, and the tick reported "none qualify" over a queue it had half read.

Two properties, both tested against a fake `gh` that honours `--limit` the way the real
one does (newest first, at most N rows) - so the unfixed build fails here for the same
reason it failed in production, not because of how the fixture is shaped:

  1. COVERAGE  - with more than 40 open, every producer still reaches the oldest PR.
  2. VISIBILITY - when the ceiling IS exceeded, every producer prints a TRUNCATED line,
     exits non-zero, and withholds any whole-queue claim ("nothing to hand over");
     pr-drive, the one producer that ACTS on queue order, refuses to act at all.

Run against a specific build with COS_PY=/path/to/cos.py (apply.sh does, before it
installs anything). Default is the installed copy.
"""
import argparse, contextlib, importlib.util, io, os, json as _j

COS_PATH = os.environ.get("COS_PY") or os.path.expanduser("~/.claude/scripts/cos.py")
spec = importlib.util.spec_from_file_location("cos", COS_PATH)
cos = importlib.util.module_from_spec(spec); spec.loader.exec_module(cos)
FAILS = []
REPO = "AIClarityAU/minspec"
ASKING = [{"name": "ai-review:pass"}, {"name": "needs-human-review"}]


class R:
    def __init__(s, out, rc=0): s.stdout, s.returncode, s.stderr = out, rc, ""


def run(fn, total, limit=None, list_rc=0, labels=None, view=None, seams=None, **argkw):
    """Call producer `fn` against a repo holding `total` open PRs, numbered total..1.

    The fake `gh pr list` returns newest-first and stops at whatever `--limit` the code
    under test actually passed - it is the code's own argument that decides how much of
    the queue it sees, exactly as in production. Returns (exit, stdout, gh_calls).
    """
    calls = []

    def fake_run(cmd, **kw):
        calls.append(list(cmd))
        if "list" in cmd:
            if list_rc:
                return R("", list_rc)
            asked = int(cmd[cmd.index("--limit") + 1])
            rows = [{"number": n, "title": f"pr {n}", "isDraft": False,
                     "labels": (labels(n) if labels else []),
                     "createdAt": f"2026-01-01T00:00:{n:05d}Z",
                     "headRefName": f"b{n}", "author": {"login": "minspec-sdd"}}
                    for n in range(total, 0, -1)]
            return R(_j.dumps(rows[:asked]))
        if "view" in cmd:
            return R(_j.dumps(view or {"mergeable": "MERGEABLE", "mergeStateStatus": "CLEAN",
                                       "autoMergeRequest": None, "statusCheckRollup": []}))
        return R("updated")

    stubs = {
        "gh_env": lambda repo: {},
        "watched_pr_repos": lambda: [REPO],
        "admin_mergeable": lambda repo, n: (False, "not machinery"),
        "human_ready": lambda repo, n: (False, "not asking"),
        "mergeable_now": lambda repo, n: (False, "not green"),
        "is_machinery": lambda repo, n: False,
        "load_sessions": lambda enrich=True: [],
        "self_sid": lambda rows: None,
        "read_state": lambda: {},
        "write_state": lambda patch: None,
    }
    stubs.update(seams or {})
    saved = {k: getattr(cos, k) for k in stubs}
    saved_run = cos.subprocess.run
    had_limit = hasattr(cos, "OPEN_PR_LIMIT")
    saved_limit = getattr(cos, "OPEN_PR_LIMIT", None)
    for k, v in stubs.items():
        setattr(cos, k, v)
    cos.subprocess.run = fake_run
    if limit is not None:
        cos.OPEN_PR_LIMIT = limit
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            args = argparse.Namespace(repo=REPO, verbose=True, dry_run=False, no_why=True)
            for k, v in argkw.items():
                setattr(args, k, v)
            rc = fn(args) if fn is not cos.stalled_prs else fn()
    finally:
        for k, v in saved.items():
            setattr(cos, k, v)
        cos.subprocess.run = saved_run
        if had_limit:
            cos.OPEN_PR_LIMIT = saved_limit
        elif hasattr(cos, "OPEN_PR_LIMIT"):
            del cos.OPEN_PR_LIMIT
    return rc, buf.getvalue(), calls


def check(cond, msg):
    if not cond:
        FAILS.append(msg)


# --- 1. COVERAGE: the measured case, 79 open ---------------------------------------------
# The fixed build reads all 79 and reaches #1. The unfixed build asks for 40, gets #79..#40,
# and prints nothing about the 39 it never saw - which is the defect.
rc, out, _ = run(cos.cmd_adminable, total=79)
rows = [l for l in out.splitlines() if "withheld" in l]
check(len(rows) == 79, f"adminable examined {len(rows)} of 79 open PRs")
check("#1  " in out, "adminable never reached the OLDEST open PR (#1) - the #2288/#2291 case")
check("TRUNCATED" not in out, "adminable cried TRUNCATED on a queue it read completely")
check(rc == 0, f"adminable exited {rc} on a complete read")

# --- 2. VISIBILITY: the ceiling is exceeded ----------------------------------------------
# Ceiling pinned to 40 with 79 open reproduces the production numbers exactly.
rc, out, _ = run(cos.cmd_adminable, total=79, limit=40)
rows = [l for l in out.splitlines() if "withheld" in l]
check("TRUNCATED: showing 40, more exist" in out,
      "adminable read 40 of 79 and did not print `TRUNCATED: showing 40, more exist`")
check(rc == 1, f"adminable exited {rc} on a truncated read - it must fail closed")
check(len(rows) == 40, f"adminable showed {len(rows)} rows under a ceiling of 40")
check(out.find("TRUNCATED") < out.find("withheld"),
      "TRUNCATED is not printed BEFORE the rows, so a capped read of the output loses it")

# A queue of EXACTLY the ceiling is complete. `len == limit` would call it truncated; the
# one-row probe does not. Control for the case above: same ceiling, nothing cut.
rc, out, _ = run(cos.cmd_adminable, total=40, limit=40)
check("TRUNCATED" not in out and rc == 0,
      "a queue of exactly the ceiling was reported TRUNCATED (false alarm)")

# --- ready: no whole-queue claim beside a truncated read ---------------------------------
rc, out, _ = run(cos.cmd_ready, total=79, limit=40)
check("TRUNCATED: showing 40, more exist" in out, "ready did not report its truncated read")
check("nothing to hand over" not in out,
      "ready claimed 'nothing to hand over' about a queue it read half of")
check(rc == 1, f"ready exited {rc} on a truncated read")
rc, out, _ = run(cos.cmd_ready, total=79)          # control: complete read, same PRs
check("nothing to hand over" in out and rc == 0 and "TRUNCATED" not in out,
      "ready on a COMPLETE read lost its normal 'nothing to hand over' / exit 0")
check(out.count("withheld:") == 79, f"ready examined {out.count('withheld:')} of 79 open PRs")

# --- shepherd ----------------------------------------------------------------------------
rc, out, _ = run(cos.cmd_shepherd, total=79, limit=40)
check("TRUNCATED: showing 40, more exist" in out, "shepherd did not report its truncated read")
check(rc == 1, f"shepherd exited {rc} on a truncated read")
rc, out, _ = run(cos.cmd_shepherd, total=79, limit=40,
                 seams={"human_ready": lambda repo, n: (True, "ready")})
check("nothing to shepherd" not in out and rc == 1,
      "shepherd claimed 'nothing to shepherd' about a queue it read half of")
rc, out, _ = run(cos.cmd_shepherd, total=79)       # control
check("79 open PR(s) not ready" in out and rc == 0, "shepherd did not cover all 79 open PRs")

# --- pr-drive: the producer that ACTS must refuse on a partial read -----------------------
# Every PR is green, auto-armed and BEHIND, so on a complete read it WILL update a branch.
# That is the control: the refusal below is then attributable to truncation and nothing else.
DRIVE = dict(labels=lambda n: ASKING,
             view={"mergeStateStatus": "BEHIND", "autoMergeRequest": {"x": 1},
                   "statusCheckRollup": []})
rc, out, calls = run(cos.cmd_prdrive, total=79, **DRIVE)
updated = [c for c in calls if "update-branch" in c]
check(len(updated) == 1, f"control: pr-drive on a complete read made {len(updated)} updates")
check(updated and updated[0][3] == "1",
      f"pr-drive updated #{updated[0][3] if updated else '?'}, not the OLDEST PR (#1) - "
      "the head of an oldest-first queue was outside the read")
rc, out, calls = run(cos.cmd_prdrive, total=79, limit=40, **DRIVE)
check(not any("update-branch" in c for c in calls),
      "pr-drive updated a branch after a TRUNCATED read - the queue head and any in-flight "
      "update were among the PRs it never saw")
check("TRUNCATED: showing 40, more exist" in out and rc == 1,
      f"pr-drive did not refuse visibly on a truncated read (exit {rc})")

# --- flakes ------------------------------------------------------------------------------
rc, out, _ = run(cos.cmd_flakes, total=79, limit=40)
check("TRUNCATED: showing 40, more exist" in out and rc == 1,
      f"flakes did not report its truncated read (exit {rc})")
check("no infrastructure-signature failures found" not in out,
      "flakes claimed no failures exist about a queue it read half of")
rc, out, calls = run(cos.cmd_flakes, total=79)     # control
check(sum(1 for c in calls if "view" in c) == 79 and rc == 0,
      "flakes did not look at all 79 open PRs")

# --- the tick's producer -----------------------------------------------------------------
# The tick takes `stalled_prs()[:4]`, so the truncation alert must be FIRST or that slice
# can drop it; and it must be urgent, because every other alert is then partial.
# Every PR reads BEHIND so a second alert (PR-BEHIND) exists: "first" is only a meaningful
# claim when there is something for it to be ahead of.
alerts = run(cos.stalled_prs, total=79, limit=40,
             view={"mergeable": "MERGEABLE", "mergeStateStatus": "BEHIND",
                   "autoMergeRequest": None})[0]
check(any(a[1] == "PR-BEHIND" for a in alerts),
      "tick fixture: no PR-BEHIND alert, so the ordering check below proves nothing")
check(bool(alerts) and alerts[0][1] == "PR-TRUNCATED" and alerts[0][0] == "!",
      f"tick: first alert on a truncated read is not an urgent PR-TRUNCATED: {alerts[:1]}")
check(bool(alerts) and "TRUNCATED: showing 40, more exist" in alerts[0][3],
      "tick: the PR-TRUNCATED alert does not carry the TRUNCATED line")
alerts, _o, calls = run(cos.stalled_prs, total=79)  # control
check(not any(a[1] == "PR-TRUNCATED" for a in alerts),
      "tick: PR-TRUNCATED raised on a complete read")
check(sum(1 for c in calls if "view" in c) == 79, "tick did not read all 79 open PRs")

# The full read doubles the open set, so the tick must not spend a `gh pr view` asking
# whether an UNLABELLED PR is machinery: no alert can fire for one either way. Only the
# 3 labelled PRs may be asked about; the alert they raise must be unchanged.
asked = []
def _mach(repo, n):
    asked.append(n)
    return True
alerts = run(cos.stalled_prs, total=79, labels=lambda n: ASKING if n <= 3 else [],
             seams={"is_machinery": _mach,
                    "admin_mergeable": lambda repo, n: (True, "machinery; all voters pass")})[0]
check(sorted(set(asked)) == [1, 2, 3],
      f"tick asked is_machinery about {len(set(asked))} PRs; only the 3 labelled ones matter")
human = [a for a in alerts if a[1] == "PR-MACHINERY-HUMAN"]
check(bool(human) and all(f"#{n}" in human[0][3] for n in (1, 2, 3)),
      "tick: the labelled machinery PRs (#1-#3, the OLDEST) are missing from the founder alert")

# --- a FAILED list is not an empty queue -------------------------------------------------
rc, out, _ = run(cos.cmd_ready, total=79, list_rc=1)
check(rc == 1 and "nothing to hand over" not in out,
      "ready reported 'nothing to hand over' when `gh pr list` FAILED")
rc, out, _ = run(cos.cmd_shepherd, total=79, list_rc=1)
check(rc == 1 and "nothing to shepherd" not in out,
      "shepherd reported 'nothing to shepherd' when `gh pr list` FAILED")
rc, out, _ = run(cos.cmd_adminable, total=79, list_rc=1)
check(rc == 1 and "could not list PRs" in out,
      f"adminable was silent / exit {rc} when `gh pr list` FAILED")
alerts = run(cos.stalled_prs, total=79, list_rc=1)[0]
check(alerts == [], f"tick: an unreachable repo must be skipped, not raised: {alerts}")

if FAILS:
    print("FAIL open-pr-truncation")
    for f in FAILS:
        print("  -", f)
    raise SystemExit(1)
print("ok open-pr-truncation - every producer reads the full open set, and says so when it cannot")
