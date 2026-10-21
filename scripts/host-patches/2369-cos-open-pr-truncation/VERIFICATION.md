# Verification record: #2369 host patch is applied to the live `cos.py`

`e1137124` ("chore(#2500): delete the applied host patch directory for #2369") deleted
this directory on the strength of a prose claim — "Verified before deletion: the patch
was applied to the live `~/.claude/scripts/cos.py`" — with no evidence carried in the
diff. That claim gates the deletion and the closure of #2369: a staged patch removed
before it is applied turns pending work invisible.

## What this file can and cannot prove

The target, `~/.claude/scripts/cos.py`, lives on the operator's host, outside this
repository. **No repo-scoped reader — CI, the AI review panel, a fresh clone — can
re-run any check below.** This file is a recorded host reading, not a gate, and it is
not an independent second witness in invariant 2's sense: it is one more report from an
agent session. What it adds over `e1137124`'s prose is (a) checks tied to artifacts that
*are* in this repository's history, so a reader with host access can reproduce them in
one command, and (b) the exact command for the human confirmation below.

## Human confirmation before merge

This is a machinery pull request, so it already merges only by a human. Before merging,
run on the host, from a checkout of this branch:

    git show e1137124^:scripts/host-patches/2369-cos-open-pr-truncation/cos.py.patch \
      | grep '^+' | grep -v '^+++' | cut -c2- | grep -v '^[[:space:]]*$' \
      | while IFS= read -r l; do grep -qF -- "$l" ~/.claude/scripts/cos.py || echo "MISSING: $l"; done
    (cd ~/.claude/scripts/tests && COS_PY=~/.claude/scripts/cos.py python3 open-pr-truncation.test.py)

No `MISSING:` lines and an `ok open-pr-truncation` line means the patch is live. Any
`MISSING:` line means it is not: restore this directory (`git revert e1137124`) instead
of merging.

## Agent reading, 2026-10-21T03:00Z

### 1. Every line the patch adds is present in the live file

The patch itself is in this repository's history at `e1137124^`. Each non-blank `+`
line of it was searched for, as a fixed string, in the live file:

    added lines: 103 missing: 0

Control: the same check against the pre-patch backup (§3) reports 92 missing, so the
check discriminates patched from unpatched rather than passing on any file.

This is the check that ties the live file to the patch. It is presence-per-line, not a
contiguous-hunk match, so it would not catch a hunk reordered into nonsense; the
regression test in §2 covers behaviour.

### 2. The installed regression test is the repo's test, and it passes

    $ git show e1137124^:.../open-pr-truncation.test.py | sha256sum
    05886bee2fabf976212f5fe47600a0d27d288e21495070ca79b2d79d39d9b2d7  -
    $ sha256sum ~/.claude/scripts/tests/open-pr-truncation.test.py
    05886bee2fabf976212f5fe47600a0d27d288e21495070ca79b2d79d39d9b2d7

    $ COS_PY=~/.claude/scripts/cos.py python3 open-pr-truncation.test.py
    ok open-pr-truncation - every producer reads the full open set, and says so when it cannot
    rc=0

### 3. Context only: the pre-patch backup

`apply.sh` recorded the sha256 of the `cos.py` it was cut against
(`BASE_SHA="3d91e4c9…9f80"`), and the backup it left, `.cos.py.bak-2369-1790914174`,
hashes to that value. This shows `apply.sh` ran against the expected base. It does **not**
show the patch is live — §1 and §2 carry that. The live file's own hash
(`a609dc62…cc8d`) is not the patched-at-apply-time hash, because `cos.py` has been edited
by other work since (mtime 2026-10-20); it is a point-in-time reading, not an identity.

## Recovery

`apply.sh`, `cos.py.patch` and the test remain recoverable at `e1137124^`. Delete this
file once the human confirmation above has been done and the pull request is merged.
