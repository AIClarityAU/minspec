# Host patch: cos.py open-PR queries were capped at 40 and silent about it (#2369)

**Status: staged, NOT applied.** Nothing in this directory runs on its own, and the fix is
not live until a human runs `apply.sh` on the host. Delete this directory once it has been
applied - a staged patch left behind reads as still-pending work.

## Why this is a patch

The file being fixed is `~/.claude/scripts/cos.py`, the operator's chief-of-staff script. It
is not part of this repository, and its directory is mounted read-only inside the agent
container, so the dispatched agent could read it and could not write it. The fix was made on
a copy, verified there, and staged here for a host-side apply.

## Apply (on the host)

    bash scripts/host-patches/2369-cos-open-pr-truncation/apply.sh

The script's header lists each step. In short: it checks the defect is present, patches a
copy with no fuzz, tests the copy, backs up the live file, installs, and re-tests the live
file - restoring the backup if that last test fails. To rehearse without touching the real
file: `COS_PY=/tmp/cos-copy.py bash .../apply.sh`.

If `cos.py` has changed around a patched hunk since 2026-10-01 the script refuses and changes
nothing. The patch then needs re-cutting; an older copy of this patch should be discarded,
not forced.

## What the patch changes

Root cause: six producers each ran their own `gh pr list --state open --limit 40` and none
compared the row count against the limit, so a truncated read was indistinguishable from a
complete one. With 79 open pull requests, the 39 oldest were examined by nothing.

- **One reader, `open_prs(repo, fields)`**, replaces the six copies. Ceiling raised from 40
  to `OPEN_PR_LIMIT = 500`; `gh` pages 100 rows per API call, so this costs one extra list
  call per 100 open pull requests.
- **Truncation is detected exactly.** The reader asks for one row more than the ceiling;
  getting it back proves more exist. A queue of exactly the ceiling is not a false alarm.
- **Every producer reports it and fails closed** with
  `TRUNCATED: showing N, more exist - ...` and a non-zero exit, and withholds its
  whole-queue claim ("nothing to hand over", "nothing to shepherd", "no failures found"):
  - `adminable`, `ready`, `shepherd`, `flakes` - still show what they did read.
  - `pr-drive` - refuses to update any branch. `gh` lists newest first, so the rows cut
    off are the oldest, which is exactly where its oldest-first queue starts.
  - `tick` (`stalled_prs`) - raises an urgent `PR-TRUNCATED` alert, placed first so the
    tick's four-alert slice cannot drop it.
- **A failed `gh pr list` is no longer an empty queue.** `ready` and `shepherd` used to
  turn a non-zero exit into `[]` and then print their "nothing to do" line; `adminable`
  exited 0 in silence. The reader now raises, and each producer's existing handler prints
  `could not list PRs` and exits 1.
- **Tick cost offset.** `stalled_prs` asked `is_machinery` (one `gh pr view`) about every
  open pull request before looking at labels it already held. The label test now runs
  first; the alerts are unchanged and only labelled pull requests cost a call.

## Not changed

- Per-pull-request `gh pr view` calls in `adminable`, `ready`, `shepherd` and `flakes` now
  scale with the real open count (79, not 40), so those commands take roughly twice as
  long as before. Folding those fields into the single list query, as the issue suggests,
  would remove them - but it changes how `mergeStateStatus` is read inside the merge
  gates, and that could not be measured without network access. Not attempted here.
- The two `--limit 300` queries (`pr_states`, `prcost`) read merged/closed pull requests
  by number and have the same uncompared-limit shape. Out of this issue's scope.

## Verification done before staging

Run against a copy of `cos.py` (sha256 `3d91e4c9...`, as mounted 2026-10-01):

- `open-pr-truncation.test.py` fails on the unpatched file (26 assertions) and passes on
  the patched one. Its fake `gh` honours `--limit`, so the unpatched build fails for the
  production reason: it asks for 40 and gets 40.
- Seven mutants of the patched file (probe removed, truncation never reported, `pr-drive`
  keeps acting, exit code left at 0, failed list swallowed, label pre-filter removed,
  label pre-filter too strict) each fail the test.
- `apply.sh` rehearsed on copies: a fresh copy installs byte-identical to the verified
  build with the backup equal to the original; a second run reports already-applied and
  changes nothing; a copy with one edited context line is refused and left untouched.
- The eight existing `tests/*.test.py` give the same result patched and unpatched. One of
  them, `mergeable-neutral.test.py`, already fails on the unpatched file
  (`required_checks`: `'str' object has no attribute 'get'`) - not caused by this patch
  and not fixed by it.
