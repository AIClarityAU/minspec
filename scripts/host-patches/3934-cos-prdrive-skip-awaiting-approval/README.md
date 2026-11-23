# Host patch: `cos.py pr-drive` caps updates on one founder-gated PR (#3934)

**Status: staged, NOT applied.** Delete this directory once applied.

`~/.claude/scripts/cos.py` is outside this repo and read-only to the dispatched agent, so the fix
is staged for a host-side apply: `bash scripts/host-patches/3934-cos-prdrive-skip-awaiting-approval/apply.sh`
(control test must fail first, patch copy with `--fuzz=0`, test copy, back up, install, re-test live).

## Root cause

Root cause: in the human-behind path, `cmd_prdrive` re-sorts founder-gated BEHIND PRs by
`prdrive_priority_order`, whose `tries` cap (`PRDRIVE_PRIORITY_MAX_TRIES`) applies only to ARMED
rows, and nothing else limits an unarmed PR, so a PR waiting on a founder approval with no
approval recorded (`awaiting-approval`, e.g. #3690) is promoted into the single update slot on
every run once main moves, however many updates it already took; and no gate counts those wasted
updates (under strict each is undone by the next merge, and while it settles every other BEHIND
PR waits).

## Fix (narrow)

`prdrive_human_cap(hcands, tries, recorded)`: after the human-behind list is ordered, a row with
`PRDRIVE_PRIORITY_MAX_TRIES` (3) or more recent attempts (the existing `tries` count, 48h window)
and no recorded founder approval is not updated again until those attempts age out. Rows with
fewer attempts take the slot first; a recorded approval is never capped. A line names each capped
PR, so it cannot read as "nothing to drive".

Not done, on purpose: adding `awaiting-approval` / `needs-human-review` to `PRDRIVE_SKIP_LABELS`
(the first attempt, rejected in review of #3935). That filters those PRs out before
`prdrive_classify`, which kills the DR-112 runner-merge path and the bring-current path `cos ready`
relies on, and reintroduces the "53 PRs reached nobody" deadlock documented in `cos.py`. Founder
turn PRs still reach classify, the DR-112 merge path and the bring-current path; only repeated
updates of an unapproved one stop.

Regression test: `prdrive-skip-awaiting-approval.test.py` drives the real `cmd_prdrive` and real
`prdrive_classify` (only I/O faked). It fails with the cap made a no-op and passes with the patch,
and its controls pin: below-cap gated PR still updated, recorded approval still updated at the
cap, a `needs-human-review` PR the runner may merge under DR-112 still classified and updated,
and a current gated PR still a human-turn row.
