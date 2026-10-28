---
id: SPEC-231
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-231 is T2.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination
relates_to: ["#2091", "#2633", "#2380", SPEC-219, SPEC-026]
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: pending
---

# SPEC-231 - Design: dead registry entries are recognised, and removed only when provably dead

Plan for [requirements.md](requirements.md), built under the three recorded Clarify
selections: D1 (a) cleanup runs in the `session-panel.py` session-start hook, D2 (a) MinSpec
may delete dead entries after a grace period, D3 a 24 h grace period. Citations of "today" are
against `origin/main` `7430af21`, the commit this plan was written on. New code is cited by
symbol, because its line numbers move.

## Approach in one paragraph

All code lives in `scripts/hooks/session-panel.py`, the one consumer of the CLI session
registry in this repo (requirements.md, "Existing handling"). Four changes, in order. First, a
defect the spec's AC-7 names and today's code has: `mode_start` adds a dead entry's
`sessionId` to `dead_sids` (:720-723) without checking whether another entry for the same id
is live, and the stale-entry loop (:786) never checks `live` either, so a session resumed in a
new process, whose older process left a dead file, can be announced as a SESSION LOSS while it
is running. I believe this from reading the code, unverified by a run; the first task's red
test is what verifies it. Second, one tri-state predicate, `entry_state`, replaces the
two-valued `alive` as the single answer to "is this entry live", with `alive` kept as a
one-line wrapper so its four callers do not move. Third, a pure planner, `plan_cleanup`, that
decides what to remove and deletes nothing. Fourth, an executor wired at the end of
`mode_start` that removes what the planner chose and prints one line.

## [A] FR-1 / AC-7: a duplicate `sessionId` is never read as a loss

After the entry loop in `mode_start`, subtract the live ids: `dead_sids -= set(live)`. A
sessionId with one live file and several dead ones is a resumed session (requirements.md,
"Root-cause diagnosis"), and the live file is the answer. `own_process` (:336) and
`live_peers` (:620) already iterate to the live entry and need no change; the recent-transcript
loop already skips `sid in live` (:759). Only the stale path is wrong.

## [B] FR-2: one predicate, three answers

```python
def entry_state(entry):
    """'live' | 'dead' | 'unknown' for one registry entry ..."""
```

- `unknown` when `pid` is not an int above 1 (bool excluded, matching `registry()` :319), or
  `procStart` is missing, not a string, or empty. Never dead, never live.
- `unknown` when `/proc` itself does not answer: a small `proc_answers()` helper returns
  false when reading `/proc/self/stat` fails (kept separate so a test can stand in for a
  machine with no `/proc`). Without this, `proc_stat` returning `None` on a machine with
  no `/proc` reads as "dead", which is exactly the false fact the `registry_works` comment
  (:734-739) warns about.
- `live` when `proc_stat(pid)` answers and its start time equals `procStart`.
- `dead` when `proc_stat(pid)` is `None` (pid absent) or its start time differs (pid reused).

`alive(entry)` becomes `return entry_state(entry) == "live"`. Its callers keep their meaning:
`unknown` was already read as not-live by every one of them, because `proc_stat` failed or
`procStart` was not a string. `registry()` keeps dropping entries with a bad `pid` or
`sessionId` (it is the reader the announce paths trust); the cleanup planner reads the
directory itself (see [C]) so it can count those as unknown rather than not see them.

## [C] FR-3, FR-5, AC-1/2/4/5/6: the planner deletes nothing

```python
def plan_cleanup(directory, names, read, stat_of, state_of, opted_in, now, recently_announced):
    """-> {"remove": [paths], "unknown": [names], "kept": int, "partial": bool}"""
```

Everything it needs is passed in, so the tests drive it with fakes and no process exists.
The executor in [D] passes the real functions.

- **Names it considers.** `<pid>.json` matching `^[0-9]+\.json\Z` and `<pid>.<hex>.key`
  matching `^[0-9]+\.[0-9a-f]+\.key\Z`. Anything else in the directory is ignored and never
  removed. Each name is joined to the one resolved directory; a name with a separator cannot
  match either pattern, so FR-3's "never another directory" holds by construction.
- **Regular files only.** `stat_of` is an `lstat`; a symlink, directory or FIFO is skipped and
  never removed.
- **Partial listing.** A `.json` that `read` cannot open or parse sets `partial`, and a
  partial plan has an empty `remove` list (FR-4). Unparseable is unknown, not dead.
- **Per entry.** `entry_state` must say `dead`; `unknown` goes to the `unknown` list (AC-2).
  The file must be older than `GRACE_S = 24 * 3600` (D3), measured as the newest `mtime` of
  the `.json` and its paired `.key` files (AC-5). The CLI writes `updatedAt` into the entry
  (the fixture in `packages/minspec/tests/session-panel.test.ts` `register()` mirrors it), so
  I believe, unverified against the CLI source, that `mtime` tracks the last write by the
  process.
- **Opt-in, per entry (FR-5, AC-6).** `opted_in(entry["cwd"])` must be true: the nearest
  ancestor of the entry's `cwd` that holds `.git` (directory or file) also holds `.minspec/`
  as a directory. The hook's own folder must pass the same test before the planner runs at
  all. Both are filesystem checks with no subprocess and no network (FR-6). Rejected
  alternative: removing every dead entry machine-wide once the asking repo is opted in. D2
  accepted deleting from the user-global directory, but an entry whose `cwd` is a repo that
  never opted in is that repo's state, and invariant 3 says MinSpec does not change it. Cost
  of the choice made: dead entries from non-MinSpec repos keep accumulating.
- **Announce window (invariant 5).** An entry whose `sessionId` the #2633 state file shows as
  first seen less than `ANNOUNCE_WINDOW_S` ago is kept, so every session that starts inside the
  window is still told, exactly as today. `recently_announced` is read without the lock; if the
  state file exists but cannot be read or parsed, the planner sets `partial` and removes
  nothing. Rejected alternative: ignoring the window. A session-start in the window would then
  find the entry already gone and not be told, which changes #2633's behaviour.
- **Keys (AC-4).** A `.key` is removed only when its pid prefix belongs to a `.json` this plan
  removes. A `.key` whose entry is live, unknown, young or absent is kept. Orphan `.key` files
  with no `.json` are out of this spec's scope and are not touched.

## [D] FR-3/FR-4, AC-3: the executor and its one line

`cleanup_registry(folder, registry_works, now)` runs at the end of `mode_start`, after the
SESSION LOSS report has printed, so the report's text and order are unchanged. It does not run
on the unattended early return (:713-716), so the drain's print-mode runs never delete.

- **Fail closed.** If `registry_works` is false, `/proc` is unreadable, or
  `os.listdir` raises, nothing is removed and one line is printed:
  `Registry cleanup skipped (<reason>) - no dead entries removed (#2091).` `registry_works` is
  the existing proof (:732) that the registry lists this live session, reused rather than
  re-derived. Skips caused by the hook's folder not being opted in print nothing: that is the
  invariant-3 case, not a fault.
- **Re-check before each unlink.** Immediately before removing a `.json`, re-read it and
  re-run `entry_state`. If it no longer says `dead` with the same `procStart` (a new process
  took the pid between plan and act), it is kept. The remaining window is microseconds and is
  stated, not hidden, in the docstring.
- **Unlink errors.** `FileNotFoundError` means a concurrent session start removed it first and
  counts as `already gone`, not a failure. Any other `OSError` is a failure.
- **One line when anything happened.** `Registry cleanup: removed N dead entr(y|ies)
  (<sessionId prefixes>), K key file(s); U unknown kept; F failed (#2091).` Printed when N,
  U or F is non-zero. A run that found nothing to remove and nothing unknown prints nothing.
  Rejected alternative: printing a line on every start. It would teach the reader to skip it,
  which is the silent-gate failure by another route. Cost of the choice made: an unknown entry
  is re-reported at every start until it is fixed by hand.
- **Never fatal.** Any exception inside the executor is caught by `main()`'s existing handler
  (:885-889), which already prints one visible line.

## Docstring sweep

The module docstring says the registry entry is "never cleaned up" (:24-27, :62-63) and
`decide_announcements` says the same (:375-379). Those sentences become false once [D] lands,
so the task that lands [D] rewrites them, and adds the `.key` file to "WHAT IT ASSUMES ABOUT
THE CLI".

## Files

| File | Change |
|---|---|
| `scripts/hooks/session-panel.py` | [A] to [D] and the docstring sweep |
| `packages/minspec/tests/session-panel.test.ts` | new cases per task; existing #2633 cases unchanged |

The new tests drive the pure functions by importing the unit in a short `python3 -c` with
`importlib.util.spec_from_file_location` (the file name has a dash), and drive [A] and [D]
end to end through the same fixture HOME and fake processes the suite already uses. The
existing fixture's `cwd` (`/home/somebody/code/project`) does not exist on disk, so it never
passes the opt-in check and every existing case keeps running with cleanup inert; the new
end-to-end cases build a real temporary folder with `.git/` and `.minspec/`.

## Requirement coverage

| Requirement | Section | Task |
|---|---|---|
| FR-1, AC-7 | [A] | 1 |
| FR-2, AC-2 | [B], [C] | 2, 3 |
| FR-3, AC-1, AC-4, AC-5 | [C], [D] | 3, 4 |
| FR-4, AC-3 | [C], [D] | 3, 4 |
| FR-5, AC-6 | [C] | 3 |
| FR-6 | all (no network, no subprocess) | 2, 3, 4 |
| Invariant 5 (#2633 announce-once) | [C] announce window, [D] ordering | 4 |
