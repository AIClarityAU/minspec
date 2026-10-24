---
id: SPEC-230
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline (this is its admission-width layer)
aspects: [autonomous-pipeline, drain, dispatch, quota, concurrency, admission-control, fail-closed, no-silent-gate, blast-radius]
depends_on: []
relates_to: [SPEC-044, SPEC-062, SPEC-074, SPEC-078, "#2853", "#1208", "#2514", "#2573", "#2641", "#1394", "#912", "#1775", "#3024"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). The drain,
# dispatcher, remediator and lease library are OWNED by SPEC-044 (its implements:), so
# this spec modifies them and owns only its new test file. scripts/lib/autonomy.ts is
# deliberately absent from both lists: the autonomy stop list is not touched (INV-2).
implements: [packages/minspec/tests/drain-concurrency-width.test.ts]
affects: [scripts/drain-inbox.sh, scripts/remediate-pr.sh, packages/minspec/tests/drain-concurrency.test.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-230: The drain runs as many agents as quota headroom allows, and falls back to one or none as the cap closes

> **This is a SPECIFICATION ONLY.** It was written for issue #2853 (scale drain and
> dispatch concurrency to quota headroom). Nothing is built until a human reads it,
> resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

The founder's direction (2026-10-17, verbatim): *"unless work is throttled by tokens, the
fan speed (CPU) should be high all the time."*

Today the background drain runs **one** agent at a time unless someone sets an environment
variable by hand, so the machine sits mostly idle while paid quota goes unspent. Measured
2026-10-22T23:2xZ: load average 3.9 on 12 cores, 7-day quota 4% used, and the drain's own cap
line read `open`.

With this spec the drain decides how many agents to run from the same quota reading it
already trusts. Lots of headroom: several agents at once, up to a ceiling the host can
carry. Headroom shrinking: fewer. Cap closed or the reading unknown: none, exactly as today.
Nothing about *whether* work may start changes; only *how much at once*.

## Where concurrency is capped today (measured on main, `b1ae1fb1`)

| Cap | Where | Value today | Effect |
|---|---|---|---|
| Dispatch fan-out width | `scripts/drain-inbox.sh:366-401` (`_validated_concurrency`), `:489` | `MINSPEC_DRAIN_CONCURRENCY`, default **1**, hard max 8 | Opt-in only. The live drain (PID 1244307, observed 2026-10-23) has no override, so it is serial. |
| Dispatch is synchronous | `scripts/dispatch-issue.sh:2109` (`claude -p` under `timeout`) | one agent per dispatch call | At width 1 the drain has at most one build agent in flight. |
| PR remediation sweep | `scripts/drain-inbox.sh:1194-1240` (`sweep_open_prs`) | strictly serial, no width knob | One `remediate-pr.sh` at a time, and only after the dispatch phase of the cycle has fully finished. |
| Cycle barrier | `scripts/drain-inbox.sh:1966-2010` (parallel path loop) | waits for every in-flight build before the sweep | With width > 1, one long build (the claim lifetime `LEASE_ABS_MAX_SECS` is 7200 s; a 14400 s `timeout` was in the process table on 2026-10-23) holds every other slot idle until it ends. |
| Idle between cycles | `scripts/drain-inbox.sh:222` (`INTERVAL`) | 1200 s | The drain sleeps 20 min after a cycle even when the gate is open and work is queued. |
| Per-cycle queue limit | `scripts/drain-inbox.sh:1362` | `MINSPEC_DRAIN_QUEUE_LIMIT`, default 30 | A budget of builds per cycle, not a width; unchanged by this spec. |
| Quota gate | `quota_gate` / `quota_cap_line` (`scripts/drain-inbox.sh:2400-2539`) | per-window cap, ramped toward 100% by each reset (#2514), fails closed on missing/stale/unparseable readings (#1775), `QUOTA_BOOTSTRAP_ADMITS`=3 | Asked before every launch on both paths (#2573). Answers yes/no only; it never sizes the fan-out. |
| Drain singleton | `scripts/drain-inbox.sh:3151-3172`, `/tmp/minspec-drain-inbox.lock` | one drain per host | Unchanged. |

Host: 12 cores (`nproc`), 31 GiB RAM (`free -g`, 13 GiB available at the time of writing,
with other sessions running).

The code's own reason for defaulting to 1 (`scripts/drain-inbox.sh:376-381`): two queued
issues touching the same file produce competing pull requests, because each agent branches
from `origin/main` and cannot see an unmerged sibling. That is true serially too, only slower.
This spec must answer it rather than ignore it: see Clarify decision D2.

**Out of scope.** The chief-of-staff runner's 3-job cap and its loop interval live outside
this repo (`~/.claude/scripts/`); the runner interval is being drafted separately (runner job
runner-cadence-web-1017), and a MinSpec change must not reach into machine-wide config
(constitution invariant 3). Both remain free to read this spec's width through the reader in
FR-7, as they already read `--quota-cap` (in41).

## Functional requirements

**FR-1. Width follows headroom.** Before every launch, the drain computes an admission width
`W` from the same verdict `quota_gate` produces (one cap, one comparison, in41). Per judged
window, headroom is `cap - used` in percentage points; the binding headroom is the smallest
across the windows the reading reports. `W` is a pure, deterministic function of
(binding headroom, configured maximum, host ceiling) that is:
- **0** whenever `quota_gate` would hold (exit 42), for any reason;
- **at least 1** whenever `quota_gate` admits;
- **non-decreasing** in binding headroom, all else equal;
- **never above** the configured maximum (FR-3) or the host ceiling (FR-4).

The exact mapping from headroom to width is decided in Clarify D1.

**FR-2. One pool for builds and remediation.** Dispatch builds and PR remediation agents
draw from a single slot pool of width `W`. The total number of drain-launched agents in
flight never exceeds `W` at the moment of any launch. The PR sweep may run while builds are
still in flight, rather than only after the dispatch phase ends.

**FR-3. Configured maximum.** `MINSPEC_DRAIN_CONCURRENCY` keeps its name and becomes the
upper bound on `W` rather than a fixed width. Unset means adaptive, up to the default maximum
(Clarify D3). `MINSPEC_DRAIN_CONCURRENCY=1` restores today's strictly serial behaviour
byte-for-byte on the dispatch path. A malformed value falls back to 1 and says so, as
`_validated_concurrency` does today. The hard absolute ceiling of 8 stays unless D3 changes it.

**FR-4. Host ceiling.** Independently of quota, a launch is refused when the host cannot
carry another agent: available memory (`MemAvailable` from `/proc/meminfo`) below a
per-agent reserve, or the 1-minute load average already above a multiple of `nproc`. The
refusal is logged with the figures read. An unreadable `/proc` value makes the host ceiling
**1** (never 0, so the host check alone cannot wedge the drain; never more, so it cannot
widen on an unknown). Reserve and multiple are knobs with defaults set at plan time from a
measured per-agent footprint.

**FR-5. Rolling admission, no idle barrier.** While `W` exceeds the agents in flight and
admissible work is queued (agent-ready issues or sweepable pull requests), the drain fills
the free slot without waiting for unrelated in-flight agents to finish and without sleeping
`INTERVAL`. `INTERVAL` applies only when there is no admissible work, or when `W` is 0.

**FR-6. Shrinking never kills.** When `W` falls below the agents in flight (headroom shrank,
cap closed, a quota signal arrived, the autocompact breaker tripped), the drain stops
launching and lets in-flight agents finish. No running agent is killed or abandoned because
the width dropped; the existing "drain in-flight, then pause" behaviour on the parallel path
is the model.

**FR-7. Reader.** `scripts/drain-inbox.sh --concurrency` prints, in one line, the width the
drain would use right now and why, for example
`width 4 of max 8 | binding 7d headroom 51.2pp | host ok (mem 13.1G, load 3.9/12) | <quota_cap_line>`.
It spends nothing (`QUOTA_BOOTSTRAP_ADMITS=0`, as `quota_cap_line`), exits 0 when `W >= 1`
and 42 when `W` is 0. Anything outside the script that asks "how much may run?" reads this
line instead of holding its own figure.

**FR-8. Every width decision is visible.** Each launch logs the width in force, the binding
window and its headroom, the host figures, and the in-flight count (constitution invariant 2).
Each change of `W` between launches is logged with both values. A width that silently stays
at 1 is indistinguishable from a quiet week, which is the failure this spec exists to remove.

**FR-9. Idle is classified, not guessed.** Once per cycle the drain logs a utilisation line
with both halves the founder asked to be measured (#2853 comment, 2026-10-17): local load
(`/proc/loadavg` against `nproc`) and server-side work (GitHub Actions runs in progress and
queued for the repo). The line classifies the moment as `busy`, `waiting` (low local load,
CI busy), `throttled` (`W` limited by quota or host), or `stall` (gate open, admissible work
queued, fewer agents in flight than `W`). A failed server-side read is `server unknown`,
never counted as idle. `stall` is the defect state: the acceptance criteria require it to be
rare.

**FR-10. Same-file collisions are bounded.** Widening must not turn the competing-PR risk
(`scripts/drain-inbox.sh:376-381`) into unbounded rework. The mechanism is Clarify D2; whatever
is chosen, the drain measures the rate of drain pull requests that need a conflict-driven
re-run or are closed as superseded, and logs it per cycle so the trade can be re-tuned on data.

## Invariants (must not break)

- **INV-1. The quota gate stays fail-closed and single.** `W` is derived from `quota_gate`'s
  own verdict; no second threshold is introduced. Missing, stale or unparseable readings give
  `W = 0` exactly where the gate holds today. Bootstrap never widens: with no reading ever
  produced, `W <= 1` and every launch still consumes one of `QUOTA_BOOTSTRAP_ADMITS`.
- **INV-2. The autonomy stop list is untouched.** `scripts/lib/autonomy.ts` (`mayProceed`) is
  not modified and nothing in this spec routes around it.
- **INV-3. One drain singleton.** The lock at `/tmp/minspec-drain-inbox.lock` and its
  stale-PID reclaim are unchanged; widening happens inside the one drain, never by starting a
  second.
- **INV-4. No two agents on one issue, pull request or worktree.** Builds keep the per-item
  flock, the issue lease and the claim-unique worktree path (SPEC-044 D11/FR-11/INV-7);
  remediation keeps its lease check (`scripts/remediate-pr.sh:627`). Within one cycle the
  drain also never offers the same item to two slots, nor an issue and its own open pull
  request at the same time.
- **INV-5. Existing stop semantics hold at any width.** The per-launch gate (#2573), the
  quota-signal pause, the autocompact breaker (`_breaker_decide`, #912), the queue limit and
  its refused-offer accounting (#2641) keep their meaning; at `W = 1` each behaves exactly as
  today.
- **INV-6. Blast radius.** The change lives in this repo's scripts and tests. No machine-wide
  config, no other repo, and no shipped extension behaviour changes (constitution invariant 3).
- **INV-7. No new network surface in the extension.** All of this is dev-time scripting that
  already uses `gh`; the shipped extension makes no new call (constitution invariant 1).

## Acceptance criteria

- **AC-1 (width function, T0).** A table and property test over the pure width function:
  gate closed gives 0 for every headroom; gate open gives at least 1; width is non-decreasing
  as headroom rises; width never exceeds the configured maximum or host ceiling; no reading
  plus bootstrap gives at most 1; a malformed maximum gives 1.
- **AC-2 (rises and falls, T2).** A hermetic run with a fake dispatcher and remediator (each
  stub records start and end, then sleeps) and a fake quota file: with low usage the observed
  peak in flight equals the computed `W` (> 1); raising usage mid-run makes the in-flight count
  fall to 1 and then to 0 as the cap closes, with no stub killed; at no recorded instant does
  the in-flight count exceed the `W` logged for the latest launch. Mutating the width function
  to ignore headroom must fail this test.
- **AC-3 (serial parity, T0).** With `MINSPEC_DRAIN_CONCURRENCY=1`, the existing
  `drain-concurrency.test.ts` and `drain-quota-*.test.ts` suites pass unchanged.
- **AC-4 (no barrier, T2).** A fake run with one stub that sleeps far longer than the others
  shows the other slots refilled while it runs, and no `INTERVAL` sleep while admissible work
  remains and `W` > in flight.
- **AC-5 (no duplicate agent, T0).** A fake queue containing the same issue twice, and an issue
  together with its own open pull request, never has two stubs on one item at once.
- **AC-6 (visibility, T2).** Every launch line carries width, binding window, headroom, host
  figures and in-flight count; `--concurrency` exits 0/42 consistently with `--quota-cap` on the
  same fake reading.
- **AC-7 (outcome, measured after release).** Over the first 7 days after the change ships,
  from the drain log: when the cap line reads `open` and admissible work is queued, `stall`
  is under 10% of cycles, and the 7-day window finishes the week above 60% used unless the
  queue ran dry. Measured, not asserted; the result is recorded on #2853.

## Decisions needed (Clarify)

**D1. How headroom maps to width.**
- (a) **(rec)** Fixed steps: one extra slot per `MINSPEC_DRAIN_WIDTH_STEP` percentage points of
  binding headroom (default 10pp), so 51pp gives 1 + 5 = 6, clamped to the maximum.
  Deterministic and trivially testable. Cost: it ignores how fast agents actually burn quota,
  so the step may need re-tuning once FR-10/FR-9 data exists.
- (b) Measured burn: width such that projected spend of `W` agents until the next re-check stays
  under headroom, using a rolling per-agent burn rate from successive readings. Tracks reality.
  Cost: a new stateful estimator that can be wrong on a cold start, and much harder to test.

> **Proposed (recommended): option (a), fixed steps.** Cost of the recommendation: it ignores how fast agents actually burn quota, so the step may need re-tuning once FR-10/FR-9 data exists. Not a resolution: the header reserves Clarify decisions for a human, who confirms or changes this before approval. One extra slot per `MINSPEC_DRAIN_WIDTH_STEP` points of binding headroom, default 10pp, clamped to the maximum. Would set aside: (b) measured burn, a stateful estimator that can be wrong on a cold start.

**D2. Same-file collisions.**
- (a) **(rec)** Accept competing pull requests and bound them by measurement: log the
  collision/rework rate (FR-10) and drop the maximum to 1 automatically for the rest of the
  cycle when it passes a tripwire (default 25% of the last 8 drain pull requests). Cost: some
  rework tokens are spent before the tripwire trips, and the merge queue's `strict` base
  updates (#1394) get more frequent.
- (b) Serialise on declared scope: never run two items in parallel when their spec `affects:`
  / `implements:` overlap. Cost: most issues carry no declared paths, so it protects little
  and adds a parser.
- (c) Keep dispatch serial and widen only remediation. Cost: builds stay the bottleneck, so the
  founder's outcome is only partly met.

> **Proposed (recommended): option (a), accept and bound by measurement.** Cost of the recommendation: some rework tokens are spent before the tripwire trips, and the merge queue's `strict` base updates (#1394) get more frequent. Not a resolution: the header reserves Clarify decisions for a human, who confirms or changes this before approval. Log the collision/rework rate and drop the maximum to 1 for the rest of the cycle past the tripwire (default 25% of the last 8 drain pull requests). Would set aside: (b) serialise on declared scope, (c) serial dispatch.

**D3. Default maximum when unset.**
- (a) **(rec)** 6: half the cores, leaving room for the founder's own sessions. Cost: on an
  otherwise idle host it under-fills by up to half.
- (b) 8, today's hard cap. Cost: more competing pull requests per cycle and more memory
  pressure alongside interactive sessions.
- (c) Keep 1 and require opt-in. Cost: the machine stays idle by default, which is the
  defect #2853 reports.

> **Proposed (recommended): option (a), default maximum 6.** Cost of the recommendation: on an otherwise idle host it under-fills by up to half. Not a resolution: the header reserves Clarify decisions for a human, who confirms or changes this before approval. Would set aside: (b) 8, (c) keep 1 and opt in.

## Alternatives rejected

- **Raise `MINSPEC_DRAIN_CONCURRENCY` by hand.** Already possible; it is fixed, so it either
  over-spends near a reset or idles when headroom is large, the same bad choice #2514 removed
  for the cap itself.
- **Run a second drain.** Breaks INV-3 and the stale-lock design; two drains would race the
  same queue.
- **Width from CPU load alone.** Load says nothing about quota; it would widen when the week
  is nearly spent. Load is used only as a host ceiling (FR-4).

## Follow-ups (tracked)

None yet. Anything Clarify defers is materialised on approval per DR-023.
