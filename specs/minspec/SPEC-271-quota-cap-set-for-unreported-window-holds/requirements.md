---
id: SPEC-271
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline (this is its quota-gate layer)
aspects: [autonomous-pipeline, drain, quota, fail-closed, no-silent-gate]
depends_on: []
relates_to: [SPEC-044, SPEC-074, SPEC-230, "#2586", "#1187", "#2573", "#2514"]
implements: []
affects: [scripts/drain-inbox.sh]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-271: A quota cap that is SET for a window the reading does not report holds the drain

> **This is a SPECIFICATION ONLY.** Written for issue #2586. Nothing is built until a
> human resolves [Decisions needed (Clarify)](#decisions-needed-clarify) and approves it.

Issue: #2586 (a quota cap of 0 is not a pause: a reading with no weekly figure, or a 5h
window that has reset, is admitted). Related: #1187 (no pause/resume knob), #2573 (cap
checked per dispatch), #2514 (ramped cap). No decision record yet; see Decisions needed D3.

## Problem (observed, not inferred)

`quota_gate` (`scripts/drain-inbox.sh:2537`) has two paths that admit without comparing
a SET cap:

1. **No weekly figure.** The weekly comparison is guarded by `if (( wp >= 0 ))`
   (`drain-inbox.sh:2575`). A reading with `wp < 0` skips it. The `elif [[ -n
   "$QUOTA_ADMIT_PCT_7D" ]]` arm (`:2597`) only rewords the admit line ("weekly cap ...
   was not applied"); it still falls through to the 5h check and returns 0.
2. **5h window already reset.** `if (( r <= now ))` (`:2601`) returns `open:window-reset`
   before `_quota_defers 5h` is ever evaluated, so a 5h cap (including 0) is never read.

Per the issue's measurement on main db4b2cd6: `MINSPEC_QUOTA_ADMIT_PCT_7D=0` with a
5h-only reading → `open:3% of the 5h window used`, exit 0; `MINSPEC_QUOTA_ADMIT_PCT=0`
with a reset 60s in the past → `open:window-reset`, exit 0. A cap of 0 on an evaluated
window always defers (`_quota_defers`: `used*10 >= 0`, `:2458`), so the hole is only in
the NOT-evaluated paths. The wall parser (`quota_publish_wall`) writes a reading with no
weekly figure, so any wall-sourced reading opens the hole. Whether the statusline
producer reports the weekly window is unverified.

Root cause: the gate treats "window not reported / already reset" as "nothing to compare"
and admits, with no distinction between a cap meaning "leave headroom" and a cap the
operator SET meaning "restrict or stop". The gate then has a set cap with no witness,
which constitution invariant 2 (no silent gate) says must fail closed and visibly.

## Functional requirements

- **FR-1 — Set weekly cap + no weekly figure holds.** When `MINSPEC_QUOTA_ADMIT_PCT_7D`
  is set (non-empty) and the reading carries no weekly figure, `quota_gate` returns 42
  with a `defer:` verdict that names the cause (cap set, reading reports no weekly
  window) and the cap value. It does not fall through to the 5h check.
- **FR-2 — Unset weekly cap is unchanged.** With `MINSPEC_QUOTA_ADMIT_PCT_7D` unset, a
  reading without a weekly figure is judged on the 5h window alone, as today
  (`_quota_read` documents the absence as normal).
- **FR-3 — Hold duration.** The FR-1 defer carries a wait that the existing sleep plan
  (`_quota_sleep_plan`, #2603 backoff) already handles for a "no usable reset" case,
  using the fixed `QUOTA_BACKOFF`, never a 5h reset time (the hold lasts until a
  producer reports a weekly figure or the cap is unset, not until a reset).
- **FR-4 — Reset 5h window under a SET 5h cap (shape per D1).** Behaviour of
  `open:window-reset` when `MINSPEC_QUOTA_ADMIT_PCT` is set is decided in D1; whichever
  option is chosen, the admit/hold outcome and its reason are printed in the verdict.
- **FR-5 — Visible.** Every hold from FR-1/FR-4 appears in the loop's cap line
  (`quota_cap_line`) and the `--quota-gate` output, so a paused drain is distinguishable
  from a healthy one (invariant 2: fails visibly).
- **FR-6 — One predicate.** The meter (`_quota_meter_admits`), the cap line and the
  per-dispatch check (`:1372`, `:1603`, `:1952`) all reach this behaviour by calling
  `quota_gate`, not by a duplicated predicate (a duplicate would drift).
- **FR-7 — Start line honest.** The loop's start line states when a set cap cannot be
  honoured by the current reading's producer, rather than naming only the cap value.

## Acceptance criteria

- AC-1: weekly cap `0`, reading with 5h 3%, reset in 1h, no weekly figure → exit 42,
  `defer:` verdict (FR-1). Same with weekly cap `50`.
- AC-2: weekly cap unset, same reading → exit 0 as today (FR-2).
- AC-3: weekly cap `0`, reading WITH a weekly figure → unchanged existing defer.
- AC-4: 5h cap `0`, 5h reset 60s in the past → per D1 chosen option (hold under A; admit
  under B), covered by a test that fails on current main for A.
- AC-5: a test for each branch is run against the pre-change gate and observed RED, then
  GREEN (distinguishing, not vacuous): the fixture must vary reading shape (5h-only,
  both windows, reset passed), not just the cap.
- AC-6: `--quota-gate`, `quota_cap_line` and the dispatch-time check report the same
  verdict for the same reading (FR-6).

## Invariants this must not break

- INV-1 (constitution 2, no silent gate): the new hold is loud and fail-closed; the old
  "was not applied" admit text is removed, not kept beside a hold.
- INV-2: offline; no new network call (constitution 1).
- INV-3: bootstrap allowance (no reading ever) and `defer:stale` / `defer:bad-config`
  ordering unchanged.
- INV-4: weekly check stays BEFORE any 5h logic (existing load-bearing order).
- INV-5: `quota_gate` stdout stays the verdict channel; no stray output.
- INV-6: unset caps keep today's behaviour exactly.

## Out of scope

The explicit pause/resume marker of #1187 (see D2), the ramp (#2514), and wiring a
weekly figure into the wall parser.

## Decisions needed (Clarify)

All 3 decisions are answered, not ratified: an agent session selected, for each, the option this
document already recommended. No human chose them, and no delegation covers authoring Clarify
answers (DLG-001, DR-108, covers spec approval and engineering-DR acceptance only). This spec is
unapproved, so these answers bind nothing until a human or a covered delegation approves it.

- **D1 - Recorded selection: Option A,** under a set 5h cap, hold after a `window-reset` until a
  fresh reading shows the new window.
- **D2 - Recorded selection: fix the gate now** in this spec; the pause marker (#1187) stays separate.
- **D3 - Recorded selection: no DR;** the change is reversible in under a day.

**D1 — 5h `window-reset` under a SET 5h cap.** "Window reset" is not "window
unreported": the old usage is stale, new usage is unknown.
- **A (rec): hold when a 5h cap is set, until a fresh reading shows the new window.**
  Fails closed for cap 0 (a real pause). Cost: after every 5h reset the drain waits for
  a fresh reading before resuming, so a machine whose producer refreshes rarely loses
  idle time; a cap like 80 also holds right after a reset where it could safely admit.
- **B: hold only for cap 0 (treat 0 as "pause" specially).** Cost: a special case that
  gives 0 a different meaning from every other cap; cap 1 still leaks on reset.
- **C: leave `window-reset` admitting.** Cost: the 5h half of the hole stays open.

**D2 — Fix the gate, or build the pause marker (#1187)?** (rec) fix the gate now (this
spec): small, and a marker would still leave a SET cap silently skipped for anyone who
uses one. Cost of the rec: a machine whose only producer cannot see the weekly window
cannot run a weekly-capped drain and must unset the cap. The marker remains worth
building separately; it is not a substitute.

**D3 — DR needed?** (rec) no: the change is reversible in under a day, so the
DR-359 filter is not met. Cost: the "set cap fails closed" rule is recorded only here.
