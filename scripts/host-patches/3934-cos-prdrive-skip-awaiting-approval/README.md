# Host patch: `cos.py pr-drive` skips PRs waiting only on a human approval (#3934)

**Status: staged, NOT applied.** Delete this directory once applied.

`~/.claude/scripts/cos.py` is outside this repo and read-only to the dispatched agent, so the fix
is staged for a host-side apply: `bash scripts/host-patches/3934-cos-prdrive-skip-awaiting-approval/apply.sh`
(control test must fail first, patch copy with no fuzz, test copy, back up, install, re-test live).

## Root cause

`PRDRIVE_SKIP_LABELS` listed only `parked` and `agent-quarantined` (plus `hold:*`), so a PR whose
sole blocker is a founder approval (`awaiting-approval`, `needs-human-review`) was treated as
mergeable-once-current. Under strict mode it goes BEHIND on the next main merge, so each update was
wasted, and its "settling" state blocked every other BEHIND PR. The patch adds both labels to the
skip list; the existing SKIP print and slot logic then apply unchanged.
