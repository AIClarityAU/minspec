# Independent verification: #2369 host patch is live (second witness)

`e1137124` ("chore(#2500): delete the applied host patch directory for #2369") deleted
this directory on the strength of a prose claim — "Verified before deletion: the patch
was applied to the live `~/.claude/scripts/cos.py`" — with no evidence carried in the
diff. Review on the pull request correctly blocked on that: the target file lives
outside this repository, so the claim was a "done" assertion with nothing citable
backing it (RCDD/DR-003 — an assertion is not evidence), and the constitution's
invariant 2 asks for an independent second witness rather than a single self-report.

This file is that second witness: the checks below were re-run independently, from a
separate remediation session, after the deletion commit already existed, and all three
reproduce the original claim.

## 1. The backup is a genuine pre-patch snapshot

`apply.sh` (now deleted, recovered from `git show e1137124^:.../apply.sh`) recorded the
sha256 of the `cos.py` it was cut against:

    BASE_SHA="3d91e4c91da488d1aff1bcaae2c0ca50cf2fa5cfddc39d9fd68d7b6c204f9f80"

The backup `apply.sh` left beside the live file matches that value exactly:

    $ sha256sum ~/.claude/scripts/.cos.py.bak-2369-1790914174
    3d91e4c91da488d1aff1bcaae2c0ca50cf2fa5cfddc39d9fd68d7b6c204f9f80  .cos.py.bak-2369-1790914174

A fabricated or mislabeled backup could not reproduce this value — it is derived from
the actual pre-patch file content, not asserted.

## 2. The live file carries the patch

    $ grep -n 'OPEN_PR_LIMIT = 500\|def open_prs\|TRUNCATED' ~/.claude/scripts/cos.py
    2106:OPEN_PR_LIMIT = 500
    2118:def open_prs(repo, fields):
    2147:    return (f"TRUNCATED: showing {shown}, more exist - ...

    $ sha256sum ~/.claude/scripts/cos.py
    9deb6c3dfb7c4a5aa6f203bc8946493df2a53c544f59b72247d35214ad8ad053  cos.py

## 3. The regression test passes against the LIVE file, re-run now

The test content was recovered from history
(`git show e1137124^:.../open-pr-truncation.test.py`) and also found already installed
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
