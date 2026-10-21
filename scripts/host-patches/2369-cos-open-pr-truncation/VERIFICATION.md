# Independent verification: #2369 host patch is live (second witness)

`e1137124` ("chore(#2500): delete the applied host patch directory for #2369") deleted
this directory on the strength of a prose claim — "Verified before deletion: the patch
was applied to the live `~/.claude/scripts/cos.py`" — with no evidence carried in the
diff. Review on the pull request correctly blocked on that: the target file lives
outside this repository, so the claim was a "done" assertion with nothing citable
backing it (RCDD/DR-003 — an assertion is not evidence), and the constitution's
invariant 2 asks for an independent second witness rather than a single self-report.

This file is that second witness: the checks below were re-run independently, from a
separate remediation session, after the deletion commit already existed (re-run
2026-10-21 against the live host file), and all three reproduce the original claim.
`apply.sh`, `cos.py.patch` and the test all remain recoverable at `e1137124^`.

## 1. The backup is a genuine pre-patch snapshot

`apply.sh` (deleted by `e1137124`; recovered from `git show e1137124^:.../apply.sh`) recorded the
sha256 of the `cos.py` it was cut against:

    BASE_SHA="3d91e4c91da488d1aff1bcaae2c0ca50cf2fa5cfddc39d9fd68d7b6c204f9f80"

The backup `apply.sh` left beside the live file matches that value exactly:

    $ sha256sum ~/.claude/scripts/.cos.py.bak-2369-1790914174
    3d91e4c91da488d1aff1bcaae2c0ca50cf2fa5cfddc39d9fd68d7b6c204f9f80  .cos.py.bak-2369-1790914174

A fabricated or mislabeled backup could not reproduce this value — it is derived from
the actual pre-patch file content, not asserted.

## 2. The live file carries the patch

    $ grep -n 'OPEN_PR_LIMIT = 500\|def open_prs\|TRUNCATED' ~/.claude/scripts/cos.py
    2110:OPEN_PR_LIMIT = 500
    2122:def open_prs(repo, fields):
    2151:    return (f"TRUNCATED: showing {shown}, more exist - {repo} has over {OPEN_PR_LIMIT} "
    2214:            out.append(("!", "PR-TRUNCATED", f"PRTRUNC:{_repo}:{OPEN_PR_LIMIT}",

    $ sha256sum ~/.claude/scripts/cos.py
    a609dc62893258fa6cf063407de34245089495b720ced40cbbc0d83300efcc8d  cos.py

The live file's hash is not the one a patched-at-apply-time file would have: `cos.py`
has been edited by other work since the patch landed (mtime 2026-10-20), which also
moved the line numbers. The hash is therefore a point-in-time reading (2026-10-21), not
an identity to match; what matters is that the patch's markers are still present.

## 3. The regression test passes against the LIVE file, re-run now

The test (deleted by `e1137124`; recoverable via
`git show e1137124^:.../open-pr-truncation.test.py`) is also already installed
at `~/.claude/scripts/tests/open-pr-truncation.test.py` (apply.sh's step 5):

    $ COS_PY=~/.claude/scripts/cos.py python3 open-pr-truncation.test.py
    ok open-pr-truncation - every producer reads the full open set, and says so when it cannot
    $ echo $?
    0

## Conclusion

All three checks are independently reproducible by anyone with host access, and all
three agree with `e1137124`'s claim. The #2369 patch is live, the backup is authentic,
and the installed regression test passes against the live file. The deletion in
`e1137124` stands; this file supplies the citable evidence that commit's prose lacked.

This file is itself transient closure evidence, not a staged patch — unlike the
directory it used to sit beside, it carries nothing pending. Delete it once a future
reader trusts the commit history above without re-checking it.
