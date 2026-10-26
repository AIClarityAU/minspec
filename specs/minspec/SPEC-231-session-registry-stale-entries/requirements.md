---
id: SPEC-231
type: requirements
status: specifying
tier: T2
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination
aspects: [sessions, registry, stale-state, no-silent-gate, blast-radius, offline]
depends_on: []
relates_to: ["#2091", "#2633", "#2380", "#2020", SPEC-219, SPEC-026]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decision D1.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-231: Dead entries in the Claude Code session registry are recognised as dead, and no consumer reads a duplicate sessionId as a conflict

> **This is a SPECIFICATION ONLY.** Written for issue #2091. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

`~/.claude/sessions/<pid>.json` files pile up and many share one `sessionId`. The issue
reads this as "a store keyed by id that fails to enforce uniqueness" (like #2020). Measured
evidence says that reading is mostly wrong: **the duplicates are normal; the leak is the
dead files.** This spec separates the two.

## Root-cause diagnosis (measured 2026-10-26, live container)

- 167 files, 29 distinct `sessionId`s, 17 held by more than one file.
- Every duplicate pair has different `pid` AND different `procStart` (field 22 of
  `/proc/<pid>/stat`). Example: sessionId `0495cff4-…` is held by 5 files (pids 3158349,
  3401, 308, 3267868, 29777), each a distinct process. That is the shape of a session
  **resumed** across processes (container restarts, `--resume`, panel re-attach): one logical
  session, one process at a time, one registry file per process.
- Therefore "one row per `sessionId`" is **not an invariant of the registry**; the key is the
  pid. De-duplicating on write would delete the record of a still-running resumed process.
- The real defect is **no cleanup of entries whose process is gone** (killed processes and
  container restarts leave the file; `scripts/hooks/session-panel.py:75-84` already records
  this: "never cleaned up", 80 stale entries measured 2026-10-09, #2633).
- The writer is the Claude Code CLI, not MinSpec. `scripts/hooks/session-panel.py:75-84`
  states the format is internal and undocumented (read from 2.1.283). I believe, unverified,
  that the CLI has no exit-time unlink; the CLI source is not in this repo.

## Existing handling in this repo (cited)

- `session-panel.py` `registry()` (:300) returns every readable entry; `alive()` (:327) tests
  pid + `procStart` equality, which survives pid reuse after a container restart;
  `own_process()` (:336) picks the live entry for the asking session. So that consumer already
  handles one-to-many correctly. It stays quiet about old dead entries via a state file
  (#2633) rather than removing them.
- Consumers named in the issue (session-list, chief-of-staff roster) live outside this repo
  (`~/.claude/scripts/`) and were not checked; see Follow-ups.

## Functional requirements

**FR-1. Liveness is the rule, not sessionId uniqueness.** Any code in this repo that reads
the registry treats an entry as live only if its pid exists AND `procStart` matches. A
sessionId with several files is valid; at most one is expected live.

**FR-2. Dead entries are identifiable by one shared predicate.** One function (not a copy per
consumer) answers "is this registry entry dead". An entry missing or malformed in `pid` or
`procStart` is reported **unknown**, never dead and never live (no silent gate).

**FR-3. Dead-entry cleanup (subject to D1).** Entries that are dead per FR-2 and older than a
grace period may be removed, together with the paired `<pid>.<hash>.key` file. Removal never
touches a live or unknown entry, never touches a directory other than the resolved sessions
directory, and every removal or failure is logged visibly (one line, count and ids).

**FR-4. Fail closed on the destructive side.** If `/proc` is unreadable or the sessions
directory listing is partial, nothing is removed.

**FR-5. Opt-in blast radius.** Cleanup runs only in a repo carrying `.minspec/` (invariant 3).
The sessions directory is user-global and shared with every other repo's sessions; D2 decides
whether MinSpec may delete from it at all.

**FR-6. Offline.** No network call (invariant 1).

## Invariants (must not break)

1. Offline; no network call.
2. No silent gate: unknown entries and failed removals are visible, never best-effort `|| true`.
3. Blast radius: MinSpec must not change machine-wide state in a repo that did not opt in.
   `~/.claude/sessions/` is machine-wide, which is why D2 exists.
4. A live session's registry file is never removed (a wrong removal makes `own_process`
   report a panel the session still has).
5. The `#2633` announce-once behaviour of `session-panel.py` is unchanged.

## Acceptance criteria

- AC-1: Fixture with 3 files sharing one sessionId, one live (pid+procStart match), two dead
  (one pid absent, one pid reused with different `procStart`): only the two dead are removed.
- AC-2: Entry with missing `procStart` is reported unknown and kept.
- AC-3: `/proc` unreadable: zero removals, one visible line.
- AC-4: Paired `.key` file removed with its dead entry; a `.key` whose entry is live is kept.
- AC-5: Dead entry younger than the grace period is kept.
- AC-6: Run outside a `.minspec/` repo: no removal.
- AC-7: A consumer reading a dup-sessionId set returns the live entry, not "conflict".

## Decisions needed (Clarify)

All 3 decisions are resolved: an agent session recorded each option this document already
recommended, under delegation DLG-001 (DR-108, the delegated-approval record). No human
chose them; they are ratified only by approval of this spec.

**D1. Where does cleanup run?**
- (a) `session-panel.py` session-start hook, **(rec)**: already reads and tests liveness, one
  predicate. Cost: a read-only-looking hook gains a delete side effect.
- (b) Drain/startup script: cleans on schedule. Cost: new moving part, and the drain is not
  running in every opted-in repo.
- (c) Do not delete; only report (status quo plus count). Cost: files keep accumulating.

**Recorded selection: Option (a),** the `session-panel.py` session-start hook, which already reads
and tests liveness with one predicate.

**D2. May MinSpec delete files it did not write, in a user-global directory?**
- (a) Yes after grace period, **(rec)**: dead-by-`procStart` is a hard fact. Cost: relies on an
  undocumented CLI format (can break on a CLI upgrade; FR-2 "unknown" limits damage).
- (b) No; file upstream to Claude Code and only report. Cost: leak stays until upstream acts,
  and nothing here can force that.

**Recorded selection: Option (a),** yes, after the grace period; dead-by-`procStart` is a hard fact
and FR-2's "unknown" limits the damage of a CLI format change.

**D3. Grace period for dead entries.** 24 h **(rec)** (lets a human inspect a crash; cost:
slower reclaim) vs 0 (cost: removes evidence of a just-crashed session).

**Recorded selection: 24 h,** which lets a human inspect a crash before the entry goes.

## Alternatives rejected

- **De-duplicate on write per sessionId.** Rejected: the writer is the CLI, and the
  duplicates are resumed processes, not a unique-key violation.
- **Remove files by pid-not-running alone.** Rejected: pid reuse after container restart
  would keep a dead entry alive or wrongly match; `procStart` is required.

## Follow-ups (tracked)

- Check the chief-of-staff roster / session-list consumers (outside this repo) for the
  one-to-many case: not filed; they live in `~/.claude/scripts/`, outside MinSpec's reach
  (invariant 3). backlog: check CoS roster handles dup sessionId by liveness.
- Upstream report that the CLI does not unlink its registry file on exit: backlog: file
  Claude Code issue for registry cleanup.
