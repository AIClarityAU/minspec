---
id: SPEC-231
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination; the chief-of-staff supervisor's alert honesty sits beside presence (SPEC-026) and self-completing sessions (SPEC-044)
aspects: [chief-of-staff, alerts, no-silent-gate, stall-detection, cadence]
depends_on: []
relates_to: [SPEC-026, SPEC-044, SPEC-077, "#2092"]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-231: A stalled fleet must not read as a quiet tick

> **This is a SPECIFICATION ONLY.** Written for issue #2092. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

The chief-of-staff supervisor (`cos.py`) prints a one-line "tick" to the founder. It speaks
only urgent (`!`) items and files the rest, printing `quiet`. The STALL alert (a live session
untouched for more than 45 minutes) is filed at severity `?`, so a fleet where every session
is idle prints `10 live | ... | quiet`. Measured 2026-09-22: 34 STALL records in 30 hours, all
`?`; six tick lines shown to the founder (18:48 to 20:33 UTC) read `quiet` while sessions sat
idle 4-9 hours; the founder noticed first and hand-woke 12 sessions at 21:17-21:19Z.

Of the 14 dormant sessions: 2 blocked on the founder, 1 on a peer, 7 parked on their own
`(rec)`, 1 finished (SESSION-COMPLETE unnoticed), 3 dead (2 quota walls past reset, 1 promised
a poll it never resumed). Eleven of fourteen were in a state the mandate forbids, and only
three were legitimately waiting.

Raising STALL to `!` is wrong: STALL cannot tell a legitimately blocked session from a
stalled one, so it would cry wolf on the three legitimate ones and be muted. This spec makes
the tick urgent exactly when idle sessions exist that are *not* legitimately blocked, and
fixes the "machine busy" measurement that is computed over the wrong set.

## Where this lives (measured)

`cos.py` is at `~/.claude/scripts/cos.py` on the host, **not tracked in this repository**
(`git ls-files` has no `cos.py`). Line references below are from the issue (as filed) and
have drifted in the current host copy: STALL is now emitted near line 1323, the `!` filter
near 1546+, and `recent_write` near 1620. See Decision D1 on where the change is made.

| Behaviour | Where | Defect |
|---|---|---|
| STALL severity | `alerts()` emits `("?", "STALL", ...)` for live, non-quota-stuck sessions idle > `STALL_SECS` (45 min) | `?` is never spoken |
| What is spoken | `cmd_tick`: `urgent = [x for x in lines if x[0] == "!"]`; otherwise prints `quiet` | non-`!` is invisible on the tick line |
| Busy aggregate | `recent_write = max(mtime over all rows)`; `machine_busy = now - recent_write < 1200` | rows include the supervisor's own transcript, so `machine_busy` is true by construction while the loop runs; non-self LIVE sessions active in the trailing 20 min was 0 at 12 of 28 half-hour samples, `machine_busy` true at all 28 |

`machine_busy` did not cause the missed alarm (it only pins the fast cadence rung). It is the
right computation over the wrong set, and is fixed here because it feeds the same decision.

## Functional requirements

- **FR-1 Escalating idle count.** Define an *unattended-idle* session as a non-self LIVE row
  idle longer than `STALL_SECS` that is **neither** founder-blocked **nor** peer-blocked
  (and not already quota-stuck, which has its own alert). The tick MUST emit an urgent (`!`)
  item whenever that count is non-zero.
- **FR-2 Legitimate blocks stay quiet.** A session blocked on the founder or on a named peer
  MUST NOT count toward FR-1, and keeps its existing non-urgent STALL record. Whether a
  session is blocked is read from an explicit, checkable signal (see D2), never inferred from
  prose alone.
- **FR-3 Fail visible on unknown.** If a session's block state cannot be determined (transcript
  unreadable, signal absent or unparseable), it counts as unattended-idle. Unknown is never
  treated as blocked (constitution invariant 2).
- **FR-4 Finished and dead are not "waiting".** A session whose last message carries
  `SESSION-COMPLETE:` is reported as finished (not stalled, not counted by FR-1) so it can be
  reaped; a session past a quota-wall reset with no resume counts under FR-1.
- **FR-5 One urgent line per tick, naming sessions.** The urgent item states the count and
  names up to N sessions with idle age, mirroring the existing STALL text, so the founder can
  act without running `report`. The `fired` TTL de-duplication (6 h, keyed per session) is
  preserved so a standing stall is re-announced rather than silenced forever.
- **FR-6 Correct busy aggregate.** `machine_busy` MUST be derived from the count of non-self
  LIVE rows with a transcript write inside the trailing 20-minute window (busy iff count > 0),
  not from the maximum mtime across all rows. The supervisor's own row is excluded.
- **FR-7 No quiet when stalled.** The tick line MUST NOT end in `quiet` on a tick where FR-1's
  count is non-zero.
- **FR-8 Fixture, not just unit.** The regression test replays the 2026-09-22 shape: ten live
  sessions, seven idle > 45 min and none founder/peer-blocked, plus the supervisor row freshly
  written; it must produce a `!` item and a non-quiet line, and fail on the pre-fix code.

## Acceptance criteria

- **AC-1** Fixture of FR-8 prints an `!` STALL-class line naming the idle sessions; on the
  unfixed code the same fixture prints `quiet`.
- **AC-2** Fixture where every idle session is founder-blocked or peer-blocked prints no `!`
  and the 2 + 1 legitimate cases of the 14 are not counted.
- **AC-3** A session with an unreadable transcript is counted (FR-3).
- **AC-4** Fixture with only the supervisor row fresh and all others idle: `machine_busy` is
  false (FR-6); with one non-self LIVE session written 5 minutes ago it is true.
- **AC-5** Re-running the tick inside the 6 h TTL does not re-announce an unchanged stall;
  after the TTL it does.

## Invariants the change must not break

- **INV-1 (constitution 2, no silent gate).** The new alert fails closed and visibly: unknown
  block state alerts, never passes. No swallowed error on the path that decides urgency.
- **INV-2 (constitution 1, offline).** Pure local transcript/state reads; no network call.
- **INV-3 (constitution 3, blast radius).** The change must not alter behaviour of machine-wide
  config in repos that have not opted in; see D1 for the file's location.
- **INV-4** Quiet-branch semantics for genuinely quiet fleets are unchanged (no new noise when
  nothing is idle-unattended), and existing alert codes/keys keep their `fired` hashes.

## Out of scope (tracked separately by the issue)

1. `cmd_nudge` silently drops a session whose last transcript record is a user record.
2. Two sessions quota-walled ~20 h past reset while the lone RESUMABLE alert named another
   session (cos.py:693 should have caught both; cause unverified).

Both are filed as their own issue, each with an independently checkable fix. This spec does
not fix them and must not be read as claiming they are fixed.

## Decisions needed (Clarify)

- **D1. Where does the change live?** `cos.py` is host-local (`~/.claude/scripts/`), outside
  this repo, so a PR here cannot change it and cannot test it.
  - **(rec) Option A:** keep the fix in the host script, track it via the existing
    `.cos-patches` flow, and keep only this spec and a fixture description in the repo.
    Cost: the regression test is not run by this repo's CI, so FR-8 is enforced only by the
    patch flow's own A/B check.
  - **Option B:** vendor `cos.py` into the repo (e.g. under `scripts/`) so CI covers it.
    Cost: a large file (~237 KB) gains a second source of truth and a sync burden, and
    touches the invariant-3 boundary for machine-wide tooling.
- **D2. What counts as "founder-blocked" / "peer-blocked"?** The issue says 3 of 14 were
  legitimate but not how to detect them.
  - **(rec) Option A:** an explicit marker the session writes (e.g. a final-message line
    `BLOCKED-ON: founder|<peer>`), unknown means unattended (FR-3). Cost: sessions must be
    taught the marker, and sessions that forget it are alerted, which is noisy until adopted.
  - **Option B:** heuristic on the last assistant message (an open `**Your turn**` block or
    an unanswered peer message). Cost: false negatives on prose drift, the very failure the
    constitution says not to trust a model for.
- **D3. Cap on urgent noise.** If 12 sessions stall at once, one `!` line naming all or a
  summary with the top N plus a count? **(rec)** summary line, top 5 by idle age, full list
  in `report`. Cost: sessions beyond the top 5 are only visible in `report`.
