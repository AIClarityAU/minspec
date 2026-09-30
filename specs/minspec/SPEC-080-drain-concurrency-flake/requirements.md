---
id: SPEC-080
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a required check that cries wolf on unrelated changes is a false signpost in the other direction (false-red, not false-green), same family as SPEC-073/SPEC-059
aspects: [testing, ci, concurrency, flake, reliability]
relates_to: ["#1702", "#1208", "#912", "#1203"]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — `drain-concurrency.test.ts` must stop flaking under the full suite (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers **Decisions needed (Clarify)**, and approves it through the normal
> spec-approval gate before any code changes.

Materializes **#1702** — *"drain-concurrency.test.ts fails under the full suite, passes
in isolation (3 of 3 runs)."* The issue is filed as an observation with evidence, not a
diagnosis, and explicitly asks whoever picks it up to confirm the mechanism before
touching a timing constant. This spec follows that instruction: it does not pick a fix,
it frames the diagnosis step as a requirement and lays out the fix options as Clarify
decisions with the evidence this reading turned up.

**Id note.** `SPEC-080` is the next id after the highest on disk (`SPEC-079`). No open-PR
check was run (this dispatch makes no network call, per constitution invariant 1); if the
id collides with another in-flight spec at review time, renumber per the DR/spec
collision-gate convention in `CLAUDE.md`.

## One-Sentence Scope

Make the four "drives the REAL loop" tests in
`packages/minspec/tests/drain-concurrency.test.ts` (the width-1/width-4 fan-out checks
and the two quota-signal checks) pass reliably under full-suite load, on a diagnosed
mechanism rather than a guessed one, without weakening what #1208 built them to prove:
that widening dispatch concurrency cannot silently break the autocompact breaker
(#912/#1203) or orphan in-flight work on a quota signal.

## Context — findings from reading the code (not inferred)

The issue's own hypothesis ("fan-out assertions use wall-clock or ordering assumptions
that only hold when the box is idle") is explicitly marked unverified. Reading the test
and the script it drives (`scripts/drain-inbox.sh`) surfaces three concrete, citable
mechanisms that could each produce the reported symptom. None is confirmed as *the*
cause — that confirmation is FR-1 below — but restating them here means the Plan phase
does not restart the reading job.

**Finding A — every "REAL loop" test shells out to the real issue ranker, unstubbed.**
`runCycle()` (`drain-concurrency.test.ts:166-183`) never sets `MINSPEC_ISSUE_RANKER`.
`drain-inbox.sh`'s dispatch step always ranks through the real
`scripts/rank-issues.ts`, cold-started via `npx tsx` and bounded by
`timeout "${MINSPEC_ISSUE_RANK_TIMEOUT:-180}"` (`drain-inbox.sh:1076`). A failed or slow
ranker cannot corrupt the dispatch *set* — `drain-inbox.sh` falls back to numeric order,
loudly, on any non-zero exit or mismatched set (`:1082-1087`) — so this alone would not
explain a wrong `peakInFlight` count. It is, however, an uncontrolled, load-sensitive
subprocess (node/tsx cold start under CPU contention from 21 sibling vitest workers)
consuming wall-clock budget out of each test's fixed `60000` ms timeout
(`drain-concurrency.test.ts:212,220,231,244`) before dispatch itself even starts, and it
is not the thing any of these four tests claims to exercise.

**Finding B — the quota-freshness fixture is written once, not kept fresh for the run.**
`quota_gate()` fails CLOSED on a reading older than `QUOTA_STALE_SEC` (default `900`
seconds, `drain-inbox.sh:189`), and is re-consulted on every launch in the parallel path
(`:1208`). `makeHarness()` writes the quota fixture's `observed_at` once, at
harness-creation time (`drain-concurrency.test.ts:142-146`); nothing refreshes it while a
test runs. If wall-clock time between harness creation and a later launch's `quota_gate()`
call exceeds 900s — plausible on a contended box, and roughly consistent with the issue's
own outlier data point (~1,137,000 ms, ~19 minutes, for a single test) — the gate defers
(`defer:stale`, `:1432`), and the loop stops launching further items
(`saw_quota=1; stop_launching=1`, `:1210`). That failure would read like, but is
distinguishable in the log from, the two "quota signal" tests' intended scenario: a
staleness defer prints `defer:stale (...)`, not `usage-limit signal`, so grepping the
actual failing run's captured log (not just its assertion name) tells these apart.
*Unverified:* this spec did not reproduce a failure to confirm the log actually shows
`defer:stale`; that check is part of FR-1.

**Finding C — the width-4 overlap assertion is reconstructed from wall-clock timestamps
written by independently-scheduled processes.** `peakInFlight()`
(`drain-concurrency.test.ts:186-196`) reconstructs concurrency from `date +%s%N`
timestamps that `TIMED_STUB` (`:198-203`) writes from N separately forked processes, each
sleeping a fixed `0.5`s. Its correctness assumes the OS schedules those N forks close
enough together, relative to the 0.5s window, that their sleeps genuinely overlap. Under
the same CPU contention implicated in Findings A/B, fork/exec latency for N stub
processes is no longer negligible next to a fixed 0.5s margin. Two distinct explanations
are both consistent with this and are NOT the same thing to fix: (i) contention smears out
concurrent launches enough that `peakInFlight` under-reports (a margin problem, matches the
issue's "hides under load" framing), or (ii) an actual ordering assumption in the
launch/reap loop (`drain-inbox.sh:1182-1245`) is wrong and only manifests once real timing
noise is introduced (a correctness problem, the thing the issue explicitly warns against
assuming away). FR-1 exists because a fix aimed at (i) does nothing for (ii), and vice
versa.

## Functional Requirements

- **FR-1 (diagnose before fixing).** Before any fix lands, reproduce the flake under a
  controlled, repeatable load condition (full-suite run, or an equivalent injected-load
  harness) enough times to attribute at least one real failure to a specific mechanism —
  Finding A, B, C, or another found in the process — citing the failing assertion and the
  actual captured log/timing evidence, not a restated guess. This is the issue's own
  explicit instruction ("confirm the mechanism before changing a timing constant"; see
  also CLAUDE.md's RCDD sibling rule: a bad-state restatement is not a root cause).

- **FR-2 (a genuine ordering defect gets fixed in the script, not hidden in the test).**
  If FR-1 attributes a failure to a real race/ordering bug in `drain-inbox.sh`'s
  launch/reap loop (Finding C(ii)) rather than a test-harness timing assumption, that bug
  MUST be fixed in `scripts/drain-inbox.sh` itself. Loosening the test's assertions would
  hide the exact regression class #1208 built this file to catch.

- **FR-3 (the fix keeps driving the real dispatcher).** After the fix, the four
  real-loop tests MUST still invoke the genuine `drain-inbox.sh` end-to-end — no rewrite
  may replace the real dispatcher call with a re-implementation of its algorithm or a
  fully-mocked stand-in. The test file's own header states this is the property under
  test (`drain-concurrency.test.ts:1-20`): "the risk ... is NOT 'does bash spawn jobs' —
  it is that widening the fan-out silently weakens the autocompact circuit-breaker,"
  proven by driving the real loop rather than inferring from it.

- **FR-4 (remove uncontrolled variance that isn't the thing under test).** Unless
  Clarify's DQ-2 decides otherwise, the harness MUST stop letting Finding A's real
  ranker invocation run uncontrolled inside these four tests — e.g. by pinning
  `MINSPEC_ISSUE_RANKER` to a fast, deterministic stub. Ranking order is not part of what
  #1208's tests assert, so removing this variance costs no test fidelity.

- **FR-5 (quota fixture freshness, if Finding B is confirmed).** If FR-1 attributes any
  failure to Finding B, the quota fixture MUST stay within the freshness window for the
  full duration of a single test regardless of how long that test actually takes on a
  contended machine, and a resulting deferral must be distinguishable in the test's own
  failure output from a genuine usage-limit-signal pause (they must never be allowed to
  look identical to a reader debugging a red run).

- **FR-6 (regression-catching power is preserved, proven by mutation).** After the fix,
  deliberately reintroducing a known-bad change to the width cap, the breaker's
  rolling-window rule, or the quota-drain-before-pause behavior MUST still turn the
  corresponding test red. Record which mutation proved this for each of the four tests
  (same discipline as SPEC-078 FR-8's pinning tests).

- **FR-7 (the bar is the full suite, not the isolated file).** The fix's acceptance bar
  is repeated full-suite runs (or the CI `test` job), not an isolated run of this one
  file — an isolated pass is exactly the false-negative signal the issue's own evidence
  table already shows three times.

## Acceptance Criteria

- **AC-1 (reliability bar defined and cleared).** Plan phase names a concrete repetition
  count and environment (e.g., N consecutive full-suite runs, or M consecutive days of
  the CI `test` job) that these four tests must clear with zero flakes before this spec
  is considered satisfied. DQ-3 covers the cadence trade-off if isolation (Option C) is
  chosen for any part of the fix.
- **AC-2 (mechanism cited, not just "fixed").** The PR that closes #1702 states, in its
  body or a comment near the fix, which Finding (A/B/C/other) was confirmed as a real
  contributor and what reproduction evidence supports it — the Evidence Discipline bar
  in CLAUDE.md for a mechanism claim.
- **AC-3 (ranker pinned or the decision to leave it real is recorded).** Either
  `MINSPEC_ISSUE_RANKER` is set in the harness to a deterministic stub, or Clarify's
  answer to DQ-2 records why leaving it real is intentional.
- **AC-4 (mutation proof per FR-6).** At least one deliberate mutation per scenario
  family (width cap, breaker rolling-window, quota-drain-before-pause) is run against the
  fixed tests and shown to fail them; recorded in the PR or a comment near the test.
- **AC-5 (no bare timeout increase).** If the fix includes raising any `sleep`/timeout
  constant, the PR also states, per FR-1, that no ordering defect was found — never that
  raising the constant alone made the failures stop.

## Invariants

- **INV-1 (constitution 2, no silent gate).** A required CI check that fails
  unpredictably on unrelated changes stops reliably meaning "this change is broken" —
  functionally the same failure family the no-silent-gate invariant names, just in the
  false-red direction rather than the false-green one. The fix must restore that meaning,
  not merely lower the failure rate to "rare enough that nobody notices," which only
  lengthens the time to the next false-alarm-trained miss.
- **INV-2 (#1208's guarantee, unweakened).** The tests must keep proving, against real
  `drain-inbox.sh` execution, that widening dispatch concurrency cannot silently break
  the autocompact circuit breaker (#912/#1203) or abandon in-flight work on a quota
  signal. FR-3 and FR-6 are this invariant restated as requirements on the fix itself.
- **INV-3 (constitution 1, offline).** Any new or changed fixture/stub introduced by the
  fix must add no network call. The existing harness is already fully offline (stubbed
  `gh`, stubbed dispatcher) and must stay that way.
- **INV-4 (constitution 3, blast radius).** Changes stay inside
  `packages/minspec/tests/drain-concurrency.test.ts` and, only if FR-2 applies,
  `scripts/drain-inbox.sh` — both already within this repo's own scope. No adopter-facing
  surface is touched.

## Decisions needed (Clarify)

### DQ-1 — Fix direction, per the issue's own three options

- **Option A — ordering-based rewrite (rec).** Drive the fan-out with explicit barriers
  or deterministic scheduling so "strictly one at a time" / "four genuinely overlap" are
  proven by recorded sequence, not elapsed time. Matches the issue's own recommendation
  and FR-3's "still drives the real loop" constraint. *Cost:* real harness-design work,
  and the risk the issue names explicitly — over-mocking to the point the test stops
  exercising the real dispatcher, which FR-3's acceptance check exists to catch.
- **Option B — raise timeouts/sleep windows.** *Cost:* cheap, but converts a loud flake
  into a slower, still-occasionally-red one if the true cause is contention rather than a
  fixed margin, and is disallowed by this spec as a standalone fix (AC-5) without FR-1's
  diagnosis first.
- **Option C — `test.sequential` or a dedicated worker pool for this file.** Plausible
  middle ground per the issue. *Cost:* risks hiding the exact failure mode (CPU
  contention) that reproduces the flake, since isolating the file removes it from the
  contention it needs in order to be exercised — see DQ-3 for how to keep a contended run
  in the loop if this is chosen.
- **Recommendation:** A, shaped by whichever of Finding A/B/C actually reproduces under
  FR-1 — the landed fix may combine A for a genuine ordering assumption with a scoped B or
  C for a purely mechanical contributor like Finding A's uncontrolled subprocess or
  Finding B's staleness window.

### DQ-2 — Pin `MINSPEC_ISSUE_RANKER` in this harness now, independent of the main fix?

- **Option A — yes, pin it to a fast deterministic stub now (rec).** Removes one
  uncontrolled, load-sensitive subprocess from a suite whose failures are already timing
  related, at no cost to what these four tests assert. *Cost:* one more env var for the
  harness to maintain; if the ranker's interaction with the real dispatch loop is ever
  itself something #1208-family tests want to exercise, that needs its own dedicated test
  rather than riding along here.
- **Option B — leave it real, fold it into FR-1's diagnosis surface** (remove it only if
  confirmed a contributor). *Cost:* keeps an uncontrolled subprocess in the suite for at
  least one more diagnosis cycle.

### DQ-3 — If Option C (isolation) is chosen for any part of the fix, how does the suite
keep proving these tests survive real contention?

- **Option A — keep an explicit, occasional full-suite (or equivalent contended) run as
  the real gate for this file's reliability, with a faster isolated run for per-PR
  feedback (rec if C is chosen at all).** *Cost:* a second CI cadence to maintain; a
  regression introduced between the occasional runs is caught later than today's
  per-PR signal.
- **Option B — no compensating run; trust the isolated-pool run alone.** *Cost:* this is
  close to reverting to "isolated re-run passes," the exact proxy the issue's own
  evidence table already shows disagreeing with the full-suite result three times.

## Why no new DR

The DR-359 filter asks whether the choice costs more than a day to undo. Every candidate
fix under DQ-1 (test-harness rewrite, ranker stub, quota-fixture freshness, or a
`drain-inbox.sh` ordering fix under FR-2) is a revertible diff confined to one test file
and one already-mutable script; the DQ-1 options are variations on "how do we assert
concurrency," not a new standing mechanism. `docs/decisions/INDEX.md` has no entry
governing this suite's test-timing methodology. If Clarify's DQ-3 answer commits to a
permanent second CI cadence (a standing nightly/scheduled job rather than an ad hoc
occasional run), that crosses into "costs more than a day to undo" and should get its own
DR at Plan time.

## Out of scope

- Fixing any other flaky test in the suite. This spec is scoped to the four "drives the
  REAL loop" tests in `drain-concurrency.test.ts`, plus its width-validation and
  breaker-decide unit tests only if FR-1 finds they share the same mechanism.
- Changing `rank-issues.ts`'s own behavior, timeout default, or cold-start cost — DQ-2
  only asks whether to stub it out of *this* harness.
- Changing `QUOTA_STALE_SEC`'s production default (900s) — FR-5 concerns only the test
  fixture's freshness, not the real 5h-window gate's threshold.
- Building a general injected-load harness for the whole suite. FR-1's reproduction step
  may be ad hoc for this issue; a general facility is a separate feature if it turns out
  to be needed repeatedly.

## Test plan (for the Plan phase to place)

1. FR-1: a reproduction procedure (full-suite run, or an equivalent contention
   injection) executed enough times to attribute at least one real failure to a named
   finding, with the captured log/timing evidence retained.
2. FR-3 / AC-1: the chosen fix, run against the reliability bar AC-1 sets, both isolated
   and under full-suite contention.
3. FR-6 / AC-4: one deliberate mutation per scenario family (width cap, breaker
   rolling-window, quota-drain-before-pause), each confirmed to redden the corresponding
   test.
4. AC-3: the harness diff pinning `MINSPEC_ISSUE_RANKER`, or the recorded Clarify
   decision not to.
