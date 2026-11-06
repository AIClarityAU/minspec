---
id: SPEC-231
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-231 is T2.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination
relates_to: ["#2091", "#2633", "#2380"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-231 - Tasks

The order below is the order of work; each task is one pull request, one agent run, and
lands green on its own. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md). Every task writes its failing test first and quotes the
red output in its pull request body.

Every backticked path in this file is a file this change edits. Files it only reads are named
in prose, so the spec gate's ownership signal stays as narrow as the change. All four tasks
touch the same two files, so they run in sequence, never in parallel.

## 1 - A resumed session's dead file is not announced as a loss (FR-1, AC-7)

- [ ] **1.1** `packages/minspec/tests/session-panel.test.ts` - in the #2633 suite, a case
  where `OTHER` has two registry files: one dead (a pid that does not exist) and one live
  (a fake attached process with a matching `procStart`), with a human-panel transcript for
  `OTHER` older than `RECENT_S`. Expect no SESSION LOSS line naming `OTHER`. Run it against
  today's unit and record the red output.
- [ ] **1.2** `scripts/hooks/session-panel.py` - design [A]: after the entry loop in
  `mode_start`, `dead_sids -= set(live)`, with a one-line comment naming the resumed-session
  shape.
  *Done when:* 1.1 is green, and every existing case in the file is unchanged and green.
  Tier T1.

## 2 - One tri-state liveness predicate (FR-2, AC-2 classification)

- [ ] **2.1** `packages/minspec/tests/session-panel.test.ts` - cases that import the unit with
  `importlib.util.spec_from_file_location` in a `python3 -c` and call `entry_state` on: a live
  fake process (live); an absent pid (dead); a live pid with a different `procStart` (dead);
  `procStart` missing, `null`, `""`, a number (unknown each); `pid` a bool, `0`, `1`, a string
  (unknown each). Plus: with `proc_answers` monkeypatched to return False (a machine with no
  readable `/proc`), an entry whose pid is absent is unknown, not dead.
- [ ] **2.2** `scripts/hooks/session-panel.py` - design [B]: add `proc_answers` and `entry_state`; rewrite
  `alive` as `return entry_state(entry) == "live"` with its docstring pointing at
  `entry_state`.
  *Done when:* 2.1 is green and every existing case is unchanged and green (no caller of
  `alive` changes). Tier T1.

## 3 - The cleanup planner, deleting nothing (FR-2/3/4/5, AC-1/2/4/5/6)

- [ ] **3.1** `packages/minspec/tests/session-panel.test.ts` - cases that call `plan_cleanup`
  through the same import harness with fake `read`, `stat_of`, `state_of`, `opted_in` and a
  fixed `now`:
  AC-1 three `.json` files sharing one `sessionId`, one live, one absent pid, one reused pid,
  all older than 24 h: `remove` holds exactly the two dead;
  AC-2 an entry with no `procStart` is in `unknown`, not `remove`;
  AC-4 the dead entry's `<pid>.<hex>.key` is in `remove`, the live entry's key is not;
  AC-5 a dead entry 23 h old is kept, and one whose `.json` is old but whose `.key` is 1 h
  old is kept;
  AC-6 an entry whose `cwd` is not inside a `.minspec/` repo is kept;
  an unparseable `.json` sets `partial` and empties `remove`;
  a corrupt #2633 state file sets `partial` and empties `remove`;
  a dead entry first seen 60 s ago in the state file is kept;
  a symlink, a directory and a name like `../x.json` or `notes.txt` are never in `remove`.
  Plus one case for `opted_in` against a real temporary tree: `.git` + `.minspec/` is in,
  `.git` alone is out, `.minspec/` with no `.git` above it is out, a nested folder inside an
  opted-in repo is in.
- [ ] **3.2** `scripts/hooks/session-panel.py` - design [C]: add `GRACE_S`, the two name
  patterns, `opted_in(folder)` and `plan_cleanup(...)`. No call site yet, so behaviour is
  unchanged.
  *Done when:* 3.1 is green, and a planner run over a real temporary directory leaves every
  file on disk (asserted by listing it after the call, not by reading the source). Tier T2.

## 4 - Wire the executor into session start (FR-3/4, AC-1/3/4, invariant 5)

- [ ] **4.1** `packages/minspec/tests/session-panel.test.ts` - end-to-end cases through
  `unit('start', ...)` with a fixture HOME and a real temporary folder holding `.git/` and
  `.minspec/` as the hook's `cwd`:
  AC-1 the three-file case of 3.1 with real fake processes and `os.utime` set back 25 h:
  after the run, only the two dead `.json` and the dead key are gone, and one
  `Registry cleanup: removed 2` line is printed;
  AC-3 the registry not listing this session (`registry_works` false): nothing removed and
  one `Registry cleanup skipped` line;
  the hook's `cwd` outside any `.minspec/` repo: nothing removed, no cleanup line;
  an unknown entry: kept, and the line reports `1 unknown kept`;
  invariant 5: a dead human-panel entry older than 24 h, never seen before, is announced
  as a SESSION LOSS on this run AND kept on disk; a second start 601 s later (state file
  back-dated) removes it and does not announce it;
  a print-mode run (the unattended early return) removes nothing;
  nothing to do prints nothing.
- [ ] **4.2** `scripts/hooks/session-panel.py` - design [D]: add `cleanup_registry(folder,
  registry_works, now)` with the pre-unlink re-check, the `FileNotFoundError` handling and the
  one-line report; call it at the end of `mode_start` after the SESSION LOSS output. Same
  commit: the docstring sweep from the design (the "never cleaned up" sentences in the module
  docstring and in `decide_announcements`, and the `.key` file under "WHAT IT ASSUMES ABOUT
  THE CLI").
  *Done when:* 4.1 is green, every existing case is unchanged and green, and
  `grep -n "never cleaned up" scripts/hooks/session-panel.py` returns nothing. Tier T2.

## Not in these tasks

- The chief-of-staff roster and session-list consumers in the user-global Claude scripts folder: outside this
  repo (invariant 3); tracked in requirements.md Follow-ups as a backlog line.
- An upstream Claude Code report about unlink-on-exit: requirements.md Follow-ups, backlog.
- Orphan `.key` files with no `.json`: design [C] leaves them untouched; no requirement asks
  for them.
