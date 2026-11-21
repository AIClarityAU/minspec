#!/usr/bin/env python3
"""#3934 regression - pr-drive must not spend its one update slot on a PR whose only remaining
blocker is a human approval (`awaiting-approval` / `needs-human-review`), nor wait on one as
"settling". Such a PR cannot merge however current it is and goes BEHIND on the next merge to
main, so the update is thrown away (#3690 was updated ~6 times in 48h).
Set COS_PY to test a copy other than ~/.claude/scripts/cos.py.
"""
import contextlib, importlib.machinery, importlib.util, io, json, os, tempfile, types
from datetime import datetime, timezone

path = os.environ.get("COS_PY") or os.path.expanduser("~/.claude/scripts/cos.py")
spec = importlib.util.spec_from_file_location("cos", path, loader=importlib.machinery.SourceFileLoader("cos", path))
cos = importlib.util.module_from_spec(spec); spec.loader.exec_module(cos)
FAILS = []


def check(label, got, want):
    if got != want:
        FAILS.append(f"{label}: got {got!r}, want {want!r}")


if not hasattr(cos, "prdrive_skip_label"):
    print("FAIL prdrive-skip-awaiting-approval\n  - prdrive_skip_label missing")
    raise SystemExit(1)

check("awaiting-approval", cos.prdrive_skip_label({"awaiting-approval", "ai-review:pass"}), "awaiting-approval")
check("needs-human-review", cos.prdrive_skip_label({"needs-human-review"}), "needs-human-review")
check("quarantine still skipped", cos.prdrive_skip_label({"agent-quarantined"}), "agent-quarantined")
check("clean", cos.prdrive_skip_label({"ai-review:pass"}), None)


def run(prs, kinds, mark=None):
    """prs: [(number, labels, createdAt)]; kinds: {number: classify kind}. Returns (out, updated)."""
    updated = []

    class R:
        def __init__(s, out="[]"): s.stdout, s.stderr, s.returncode = out, "", 0

    def fake_run(cmd, *a, **k):
        if "update-branch" in cmd:
            updated.append(int(cmd[cmd.index("update-branch") + 1]))
        return R()

    saved = (cos.subprocess.run, cos.gh_env, cos.open_prs, cos.prdrive_read_view,
             cos.prdrive_classify, cos.PRDRIVE_MARK, cos.time.sleep)
    tmpd = tempfile.mkdtemp()
    mpath = os.path.join(tmpd, "mark.json")
    if mark:
        with open(mpath, "w") as f:
            json.dump({"repo": "o/r", "pr": mark, "at": datetime.now(timezone.utc).isoformat()}, f)
    cos.subprocess.run = fake_run
    cos.gh_env = lambda repo: {}
    cos.open_prs = lambda repo, f: ([{"number": n, "title": "t", "isDraft": False, "createdAt": c,
                                      "labels": [{"name": l} for l in labs]} for n, labs, c in prs], False)
    cos.prdrive_read_view = lambda repo, n: {"number": n, "autoMergeRequest": {"x": 1}}
    cos.prdrive_classify = lambda v, labs: (kinds[v["number"]], "t")
    cos.PRDRIVE_MARK = mpath
    cos.time.sleep = lambda s: None
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            cos.cmd_prdrive(types.SimpleNamespace(repo="o/r", dry_run=False, no_why=True))
    finally:
        (cos.subprocess.run, cos.gh_env, cos.open_prs, cos.prdrive_read_view,
         cos.prdrive_classify, cos.PRDRIVE_MARK, cos.time.sleep) = saved
    return buf.getvalue(), updated


Q = ["ai-review:pass", "awaiting-approval"]
G = ["ai-review:pass"]
out, upd = run([(3484, Q, "2026-11-01"), (3572, G, "2026-11-02")], {3484: "behind", 3572: "behind"})
check("clean PR chosen over earlier awaiting-approval", upd, [3572])
check("skip line printed", "#3484 SKIP - awaiting-approval (cannot bot-merge; not spending the update slot)" in out, True)

out, upd = run([(3484, Q, "2026-11-01"), (3572, G, "2026-11-02")], {3484: "settling", 3572: "behind"}, mark=3484)
check("settling awaiting-approval PR does not block the next update", upd, [3572])
check("no waiting line for skipped PR", "waiting:" in out, False)

out, upd = run([(3484, G, "2026-11-01"), (3572, G, "2026-11-02")], {3484: "settling", 3572: "behind"}, mark=3484)
check("control: a clean settling PR still holds the slot", upd, [])
check("control: waiting line printed", "waiting: #3484" in out, True)

if FAILS:
    print("FAIL prdrive-skip-awaiting-approval")
    for f in FAILS: print("  -", f)
    raise SystemExit(1)
print("ok prdrive-skip-awaiting-approval - approval-gated PRs never take or hold the update slot")
