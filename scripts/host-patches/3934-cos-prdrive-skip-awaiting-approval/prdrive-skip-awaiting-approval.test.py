#!/usr/bin/env python3
"""#3934 regression - one founder-gated PR must not keep pr-drive's single update slot.

Measured: #3690 (`awaiting-approval`, no approval recorded on its branch) took ~6 updates in 48h.
Under strict each update is undone by the next merge to main, and while it settles every other
BEHIND PR waits. The fix caps updates per founder-gated PR (the existing `tries` count) in the
human-behind path ONLY. Founder-gated PRs must still reach prdrive_classify, the DR-112
runner-merge path and the bring-current path, so no label is added to PRDRIVE_SKIP_LABELS.

Everything runs through the REAL cmd_prdrive and the REAL prdrive_classify; only I/O is faked
(PR list, PR views, diffs, approval deltas, the update-branch call, the mark file).
Set COS_PY to test a copy other than ~/.claude/scripts/cos.py.
"""
import contextlib, importlib.machinery, importlib.util, io, json, os, tempfile, types
from datetime import datetime, timedelta, timezone

path = os.environ.get("COS_PY") or os.path.expanduser("~/.claude/scripts/cos.py")
spec = importlib.util.spec_from_file_location("cos", path, loader=importlib.machinery.SourceFileLoader("cos", path))
cos = importlib.util.module_from_spec(spec); spec.loader.exec_module(cos)
FAILS = []
REPO = "AIClarityAU/minspec"
NOW = datetime.now(timezone.utc)
OK = {"name": "test", "status": "COMPLETED", "conclusion": "SUCCESS",
      "startedAt": "2026-11-01T00:00:00Z", "completedAt": "2026-11-01T00:01:00Z"}
PLAIN_DIFF = "diff --git a/packages/a.ts b/packages/a.ts\n+const a = 1\n"
APPROVE_DIFF = "diff --git a/packages/a.ts b/packages/a.ts\n+status: accepted\n"  # not runner-mergeable


def check(label, got, want):
    if got != want:
        FAILS.append(f"{label}: got {got!r}, want {want!r}")


def view(st):
    return {"mergeStateStatus": st, "statusCheckRollup": [OK], "autoMergeRequest": None,
            "files": [{"path": "packages/a.ts"}], "updatedAt": NOW.isoformat(),
            "baseRefName": "main", "closingIssuesReferences": []}


def drive(prs, tries=None, recorded=()):
    """prs: {number: (labels, mergeStateStatus, diff)}; tries: {number: recent update count};
    recorded: PR numbers whose branch carries the founder's approval (a NEW sidecar delta).
    Returns (stdout, [PRs update-branch was called on])."""
    updated = []

    class R:
        def __init__(s, out="[]"): s.stdout, s.stderr, s.returncode = out, "", 0

    def fake_run(cmd, *a, **k):
        if "update-branch" in cmd:
            updated.append(int(cmd[cmd.index("update-branch") + 1]))
        return R()

    names = ("subprocess.run", "gh_env", "open_prs", "prdrive_read_view", "prdrive_read_diff",
             "prdrive_read_handoff_view", "approval_delta", "PRDRIVE_MARK", "prdrive_write_mark")
    saved = {n: getattr(cos.subprocess, "run") if n == "subprocess.run" else getattr(cos, n) for n in names}
    saved_sleep = cos.time.sleep
    mpath = os.path.join(tempfile.mkdtemp(), "mark.json")
    ups = {str(n): [(NOW - timedelta(hours=3 + i)).isoformat() for i in range(c)] for n, c in (tries or {}).items()}
    with open(mpath, "w") as f:
        json.dump({"repo": REPO, "updates": ups}, f)
    cos.subprocess.run = fake_run
    cos.gh_env = lambda repo: {}
    cos.open_prs = lambda repo, f: ([{"number": n, "title": "t", "isDraft": False,
                                      "createdAt": f"2026-11-01T00:00:{n % 60:02d}Z",
                                      "labels": [{"name": l} for l in labs], "author": {"login": "bot"}}
                                     for n, (labs, st, d) in sorted(prs.items())], False)
    cos.prdrive_read_view = lambda repo, n: view(prs[n][1])
    cos.prdrive_read_diff = lambda repo, n: prs[n][2]
    cos.prdrive_read_handoff_view = lambda repo, n: {"comments": [], "commits": []}
    cos.approval_delta = lambda repo, n: ([{"verdict": "NEW"}] if n in recorded else [], None)
    cos.PRDRIVE_MARK = mpath
    cos.prdrive_write_mark = lambda new: None
    cos.time.sleep = lambda s: None
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            cos.cmd_prdrive(types.SimpleNamespace(repo=REPO, dry_run=False, no_why=True))
    finally:
        for n, v in saved.items():
            if n == "subprocess.run":
                cos.subprocess.run = v
            else:
                setattr(cos, n, v)
        cos.time.sleep = saved_sleep
    return buf.getvalue(), updated


if not hasattr(cos, "prdrive_human_cap"):
    print("FAIL prdrive-skip-awaiting-approval\n  - prdrive_human_cap missing (a founder-gated PR can hold the update slot)")
    raise SystemExit(1)

AW = ["ai-review:pass", "awaiting-approval"]
NH = ["ai-review:pass", "needs-human-review"]

# The founder-turn states must still be reachable: the REAL classifier, no skip label.
check("awaiting-approval not a skip label", cos.prdrive_skip_label({"awaiting-approval"}), None)
check("needs-human-review not a skip label", cos.prdrive_skip_label({"needs-human-review"}), None)
check("classify: gated BEHIND", cos.prdrive_classify(view("BEHIND"), set(AW))[0], "human-behind")
check("classify: gated current", cos.prdrive_classify(view("CLEAN"), set(NH))[0], "human-turn")

# Defect: #3690 alone, already at the cap, no recorded approval. Old logic updated it again.
out, upd = drive({3690: (AW, "BEHIND", APPROVE_DIFF)}, tries={3690: 3})
check("capped founder-gated PR is not updated again", upd, [])
check("cap line names it", "#3690 (3)" in out, True)
check("not a SKIP (still classified)", "SKIP" in out, False)

# Rotation: the capped one yields the slot to a gated PR with fewer attempts.
out, upd = drive({3690: (AW, "BEHIND", APPROVE_DIFF), 3700: (AW, "BEHIND", APPROVE_DIFF)}, tries={3690: 4})
check("slot goes to the gated PR under the cap", upd, [3700])

# Control: below the cap a founder-gated PR is still brought current (the `ready` path).
out, upd = drive({3690: (AW, "BEHIND", APPROVE_DIFF)}, tries={3690: 2})
check("below the cap still updated", upd, [3690])

# Control: a recorded founder approval is never capped (the last step before his merge).
out, upd = drive({3690: (AW, "BEHIND", APPROVE_DIFF)}, tries={3690: 5}, recorded={3690})
check("recorded approval still updated at the cap", upd, [3690])

# Control: a needs-human-review PR the runner may merge under DR-112 is still classified, handled
# and updated, however many attempts it has had.
out, upd = drive({3801: (NH, "BEHIND", PLAIN_DIFF)}, tries={3801: 5})
check("DR-112 runner-mergeable PR still updated", upd, [3801])
check("DR-112 line printed", "runner-mergeable under DR-112" in out and "#3801" in out, True)
check("DR-112 PR not skipped", "SKIP" in out, False)

# Control: a current founder-gated PR stays a human-turn row, nothing updated.
out, upd = drive({3690: (AW, "CLEAN", APPROVE_DIFF)}, tries={3690: 5})
check("current gated PR not updated", upd, [])
check("pile counts it", "1 (1 current with the founder" in out, True)

if FAILS:
    print("FAIL prdrive-skip-awaiting-approval")
    for f in FAILS: print("  -", f)
    raise SystemExit(1)
print("ok prdrive-skip-awaiting-approval - a founder-gated PR is capped, the runner-merge and bring-current paths stay open")
