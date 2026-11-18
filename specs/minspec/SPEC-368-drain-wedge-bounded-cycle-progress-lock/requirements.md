---
id: SPEC-368
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline; same epic as SPEC-044 / SPEC-062
aspects: [drain, lock, heartbeat, max-lifetime, no-silent-gate, fail-closed, liveness-vs-progress]
depends_on: []
relates_to: ["#1609", "#1591", "#1599", "SPEC-044", "SPEC-062", "SPEC-321"]
implements: none
implements_reason: >-
  Specify phase only. Expected surface: `scripts/drain-inbox.sh` (owned by SPEC-044, modified here,
  not owned), the session-start banner script, and hermetic tests. None of it is claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-368: A wedged drain driver cannot outlive its cap or hold the lock forever

> **This is a SPECIFICATION ONLY.** Written for issue #1609 (a wedged drain driver blocks all
> future drains). Nothing is built until a human resolves
> [Decisions needed (Clarify)](#decisions-needed-clarify) and approves it. No decision record is
> minted: every choice here is reversible in under a day.

## Problem

Observed 2026-08-20: a `drain-inbox.sh --auto` driver was alive for 11h18m with a log 10h48m
stale, while the queue held 141 `agent-ready` + 294 `agent-ready-specify` and 0 `agent-running`.

Root cause (mechanism, read from `scripts/drain-inbox.sh`):

1. `run_loop` (line ~4105) evaluates its stop conditions — `session_alive`, `lock_held`, the
   `MAX_LIFETIME` deadline (~4126), code drift — **only at the top of each iteration**. A
   `run_cycle` that never returns starves all of them. The 8h backstop was due 04:01:51 and had
   not fired at 07:20 (no `max lifetime reached` line). A cap that the guarded thing can starve is
   not a cap.
2. The launcher's lock check (~4454) reclaims only when `kill -0 $LOCK_PID` fails. A live-but-wedged
   PID is never reclaimed, so every later session prints "Drain already running — skipping" and
   exits 0. Liveness is used as a proxy for progress and the two diverged.
3. Nothing surfaces the staleness: the banner reads the same for a wedged drain as a healthy idle one.

The gate that should have caught it (the backstop) is the thing that failed — constitution
invariant 2 (no silent gate): a required bound that fails silently, and a single producer
(the loop itself) with no independent witness.

## Functional requirements

- **FR-1 — Bounded cycle.** No single `run_cycle` may run past the loop's deadline. The cycle runs
  under a wall-clock bound of at most `min(remaining lifetime, MINSPEC_DRAIN_CYCLE_MAX)`; on
  expiry the cycle's process group is terminated, a visible `[drain] cycle exceeded …` line is
  logged, and control returns to the loop top where the existing stop conditions run. A timed-out
  cycle counts toward `MAX_CONSEC_FAIL` (it is a failure, not a quota pause).
- **FR-2 — Child cleanup.** Terminating a cycle also terminates its descendants (dispatched agents,
  `claude` children), so an `agent-running` label is not left held by an orphan. The `agent-running`
  label of a killed dispatch is handled by the existing crash path (held for a human), not silently
  dropped.
- **FR-3 — Heartbeat.** The driver writes a heartbeat (epoch seconds) to a file beside the lock,
  from a producer **independent of `run_cycle`** (a background ticker owned by the driver
  subshell, killed on exit), so a blocked cycle does not stop it from being *absent of progress*
  — see FR-4 for the progress signal. The lock file keeps holding the PID unchanged (other
  readers parse it).
- **FR-4 — Progress, not liveness.** "Progress" is the **cycle-level** timestamp: it is advanced by
  the loop at each cycle start and end and by the dispatch wait on every poll that observes the
  child still making output. A ticker that merely proves the shell is alive MUST NOT count as
  progress (otherwise the wedge in this issue — a live shell — would look healthy).
- **FR-5 — Progress-aware lock reclaim.** The launcher reclaims the lock when the PID is dead
  **or** the progress timestamp is older than `MINSPEC_DRAIN_STALE_AFTER` (default derived from
  the longest legitimate wait: `max(QUOTA_BACKOFF, cycle bound) + 2 × INTERVAL`). Reclaim of a
  live PID first terminates it (TERM, then KILL after a grace period), verifying the PID is
  still the drain driver (command-line + start-time match) so a recycled PID is never signalled.
- **FR-6 — Fail closed on missing witness.** A missing or unparseable progress file with a live
  PID is treated as *stale after the grace of one stale window from the lock's mtime*, never as
  healthy and never as an instant reclaim, and logs why.
- **FR-7 — Visible at session start.** The session-start banner reports one of: running and
  progressing; **alive but no progress since `<t>`**; not running. It reads the same progress file
  as FR-5 (one source of truth) and makes no network call.
- **FR-8 — Singleton preserved.** Reclaim and re-acquire stay race-safe (the existing
  `noclobber` acquire and `lock_held` check, #2241). Two launchers racing to reclaim the same
  wedged driver result in exactly one new driver.

## Acceptance criteria

- AC-1: a `run_cycle` stub that blocks indefinitely does not prevent the loop stopping at
  `MAX_LIFETIME` (shortened by env in test); the log contains `max lifetime` and the stub's
  process tree is gone. (FR-1, FR-2)
- AC-2: a lock whose PID is alive but whose progress timestamp is older than the stale window is
  reclaimed by a second launcher; a lock whose PID is alive and progress is fresh is not. (FR-5)
- AC-3: a recycled PID (alive, different command line) is never signalled. (FR-5)
- AC-4: live PID + missing progress file is not reclaimed inside the grace window and is
  reclaimed after it, with a log line each way. (FR-6)
- AC-5: two concurrent launchers against one wedged lock yield exactly one running driver. (FR-8)
- AC-6: the banner text differs for healthy-idle vs wedged and names the last-progress time. (FR-7)
- AC-7: mutation check — removing the cycle bound makes AC-1 fail; making the ticker count as
  progress makes AC-2 fail. (FR-1, FR-4)

## Invariants the change must not break

- Constitution invariant 1 (offline): nothing here makes a network call.
- Invariant 2 (no silent gate): every bound, kill, and reclaim logs a visible line; no `|| true`
  on the progress write; a missing witness fails closed (FR-6).
- Invariant 3 (blast radius): applies only where `.minspec/` opted in; no machine-wide config.
- Singleton and signal behaviour from #2241 and SPEC-044 unchanged for a healthy driver.
- `--dry-run` handling is out of scope (tracked by #1591 / PR #1599); this spec must not depend on it.

## Out of scope

Fixing the original hang's trigger (the quota-crash path around #1328) beyond bounding it; the
`--dry-run` parse defect (#1591).

## Decisions needed (Clarify)

Recorded selections: each of the 3 selections below is an agent pick of the option this document marks recommended, recorded on 2026-11-17 under the founder decision in queue item clarsel. Sign-off ratifies them and may change any of them.

1. **Per-cycle bound default.** Options: (a) `MINSPEC_DRAIN_CYCLE_MAX` default 3600s **(rec)** —
   covers a long dispatch, caps a wedge to an hour; cost: a legitimately longer build is killed
   and retried. (b) Equal to remaining lifetime only — no new knob; cost: a wedge still holds the
   drain up to 8h.

   **Recorded selection: the recommended option,** option (a), `MINSPEC_DRAIN_CYCLE_MAX` defaulting to 3600s. Agent pick of the recommended option, founder decision queue item clarsel, recorded 2026-11-17; sign-off ratifies it.
2. **Stale window.** (a) Derived formula in FR-5 **(rec)** — self-tuning; cost: ~2h default, so a
   wedge can idle that long before reclaim. (b) A fixed 30 min — fast recovery; cost: a long quota
   backoff chain risks a false reclaim.

   **Recorded selection: the recommended option,** option (a), the derived formula in FR-5. Agent pick of the recommended option, founder decision queue item clarsel, recorded 2026-11-17; sign-off ratifies it.
3. **Reclaiming a live PID.** (a) Kill-and-reclaim **(rec)** — actually restores auto-drain; cost:
   a wrong match could kill a healthy driver (mitigated by FR-5 identity check). (b) Report only in
   the banner, leave to the human — safe; cost: auto-drain stays down until the founder acts,
   against tenet 1.

   **Recorded selection: the recommended option,** option (a), kill-and-reclaim. Agent pick of the recommended option, founder decision queue item clarsel, recorded 2026-11-17; sign-off ratifies it.
