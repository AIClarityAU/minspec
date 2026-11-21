# Host patch: `cos.py asked` / `cos.py waiting` read the #1857 routing marker (#2036)

**Status: staged, NOT applied.** The target, `~/.claude/scripts/cos.py`, is outside this
repository and read-only inside the agent container, so this directory carries the fix
for a human to apply on the host:

    bash scripts/host-patches/2036-cos-asked-waiting-fyi/apply.sh

## Defect and root cause

`cmd_asked` and `cmd_waiting` decided "this session holds a question for you" by
substring presence of the arrow (or `Your turn`) anywhere in the session's last turn.
The #1857 marker (`[act]` / `[fyi]` / `[human:<StopClass>]`) was wired into exactly one
consumer, `cmd_nudge`, via `item_actor()`; the two display consumers kept their own
older predicate, so a block of pure `[fyi]` was still reported as `ASKING YOU`, and
`asked` printed `[act]` and `[human:...]` items identically. The gate that should have
caught the drift - one shared classifier every arrow consumer must call - did not exist.

## The fix (`cos.py.patch`)

- `human_ask(txt)` - one classifier for "does this turn hold anything for a human",
  built on the same `pending_items()` + `item_actor()` that `cmd_nudge` dispatches on.
  It fails closed: an unmarked, unknown, wrong-case or high-stakes-vetoed item is an
  ask, and an arrow or `Your turn` with no readable item is an ask (unclassified).
  Only a block whose every item is explicitly `[fyi]` or `[act]` is not an ask.
- `cmd_asked` lists only sessions with a human item, prints each human item with its
  resolved reason (`[unmarked]`, `[human:spend-above-threshold]`, `[vetoed:merge]`),
  counts the non-human items in the same block, and prints the sessions it judged to
  hold nothing for you in a separate list with their tally - never silently dropped.
- `cmd_waiting` says `ASKING YOU` only when `human_ask` does; an all-`[fyi]`/`[act]`
  block is `NOTHING FOR YOU (<tally>)`.

None of this dispatches anything; `cmd_nudge` is unchanged.

Where the hunks land (so the diff context is not misread): the new `human_ask` /
`item_tally` helpers are *inserted before* `def cmd_nudge` (that `def` line is only
diff context, not an edit), the `cmd_asked` body is rewritten, and the last hunk (the
`QUOTA WALL` / `ASKING YOU` / `NOTHING FOR YOU` classifier) is inside `cmd_waiting`,
which begins before it (`def cmd_waiting` precedes the `kind = "QUOTA WALL"` line in
the base). No line of `cmd_nudge`'s body is touched, and `test_waiting` exercises that
classifier.

## Evidence (agent reading, 2026-11-20, against base sha256 `3cb6c734…64f4`)

- `asked-waiting-fyi.test.py` FAILS against the unpatched base (14 failures, e.g.
  `waiting: s-fyi-only holds only [fyi]/[act] items but is classified ASKING YOU`)
  and PASSES against the patched copy.
- Two mutants are killed: resolving an unreadable block to "not asking" (fail-open),
  and treating `[act]` as a human ask.
- `patch --fuzz=0` applies to the base exactly; `apply.sh` rehearsed on a copy
  installs, and a second run reports "already applied, nothing changed".

Delete this directory once applied on the host and its test is installed beside the
other `cos.py` tests.
