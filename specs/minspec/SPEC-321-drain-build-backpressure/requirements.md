---
id: SPEC-321
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline; same epic as SPEC-062 (the PR drain)
aspects: [drain, backpressure, pull-request, strict, merge-rate, quota, no-silent-gate, fail-closed]
depends_on: []
relates_to: ["#3506", "#2939", "#3344", "#3570", "#3241", "#2975", "#2641", "#2196", "#3163", "SPEC-062", "SPEC-270", "SPEC-296", "DR-060", "DR-114"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan. Expected surface:
  `scripts/drain-inbox.sh` (owned by SPEC-044, modified here, not owned) and one new hermetic
  test beside `packages/minspec/tests/drain-specify-backpressure.test.ts`. None of it is claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-321: The drain stops dispatching new builds while its open build pull requests are at a cap

> **This is a SPECIFICATION ONLY.** Written for issue
> [#3506](https://github.com/AIClarityAU/minspec/issues/3506). Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.
>
> No decision record is minted. The cap is one environment value with an in-script default,
> undone in minutes by changing that value, so it does not pass the cannot-be-undone-in-a-day
> filter. `docs/decisions/INDEX.md` was searched for an existing backpressure or merge-rate
> record (terms: `backpressure`, `drain`, `landing`, `merge rate`, `pile`); none covers this.

## In plain terms

The drain already stops writing new specs when too many spec drafts wait on a human
(`SPECIFY_MAX_HELD`, #2939) or sit unapproved on main (`SPECIFY_MAX_PENDING`, #3344). Nothing
does the same for builds: every cycle dispatches up to the dispatch cap of new build issues, each
of which opens a pull request, however many build pull requests are already open and waiting to
land.

Under the strict ruleset every merge puts every other open pull request behind `main`, so each
extra open pull request adds update pushes and CI runs per landing, without making any single
landing more likely. This spec adds a third brake of the same shape: count the drain's own open
build pull requests each cycle, and while that count is at or above a cap, leave the build queue
alone. Triage, spec-writing (under its own brakes) and pull request remediation keep running, so
the quota that would have gone to new builds goes to landing what is open.

What this costs: new builds wait while the pile drains. If the pile is stuck for a reason no
remediation fixes (red `main`, an outage), builds stay paused until a human looks. The log says
so on every cycle (FR7), so it is never a quiet week.

## Problem

### Verified from code (base of this branch, read 2026-11-12)

- The spec-writing brake exists and says builds are untouched: `scripts/drain-inbox.sh`, the
  `SPECIFY_MAX_HELD=` comment block ("Builds, triage and remediation are untouched") and the
  run_cycle block that prints `spec-writing is PAUSED`.
- The build queue (`agent-ready`, variable `ready_full`) reaches ranking and the dispatch cap
  with no count of open pull requests consulted. The only open-PR read before dispatch is
  `_pr_claims` (#3241), which drops an issue an open pull request already closes; it does not
  count or cap anything.
- The dispatch cap (`MINSPEC_DRAIN_QUEUE_LIMIT`, default 30) caps dispatches per CYCLE, not open
  pull requests in total, so a loop of cycles is unbounded in open pull requests.
- The host drain service runs at concurrency 8 (DR-114), so one cycle can add several build pull
  requests at once.
- The sweep (`sweep_open_prs`) hands every open non-draft pull request to `remediate-pr.sh`, which
  fixes `ai-review:changes`, red checks and behind-base (DR-060). That is the spend this brake
  shifts toward; it already runs on a cycle with nothing dispatched (the spec-writing-only branch
  of run_cycle calls it directly).

### Reported by the issue, not re-measured by this dispatch

This dispatch makes no network call, so these figures are the issue's (job prdrive-slow-1031,
2026-10-31) and are unverified here:

- Last 12h: 82 pull requests opened, 36 merged; the pile grew by 46.
- `cos.py pr-drive` updates one pull request and holds it about 9 minutes of CI. The chance `main`
  does not move during that slot: 81% over 96h, 56% over 12h, 40% over 6h, 30% over 1.5h.
- #3163 (a pull request taking 15 base-merge pushes in 48h without landing).

Not every one of the 82 is a drain build pull request; sessions open pull requests too (see D1).

### Root cause (mechanism plus missing gate)

Inflow and landing are decoupled. The drain's dispatch decision reads the ready queue, the quota
gate and a per-cycle cap, none of which observe the number of build pull requests already
waiting to land. When the landing rate is below the dispatch rate the pile grows without bound,
and under strict, each additional open pull request raises the update-and-CI cost of every
landing. The missing gate is a dispatch-time check of the open build pile against a cap, the
same check #2939 added for spec drafts.

## Definitions

- **Build pull request.** An open pull request whose head branch starts with `agent/issue-` and
  which is NOT a spec draft under the #3570 predicate (at least one file under `specs/`, every file
  under `specs/` or `docs/decisions/`). The exact population counted (drafts, held for a human,
  non-drain branches) is D1 and D2.
- **Open build count.** The number of build pull requests in the counted population, read once
  per cycle.
- **Cap.** `MINSPEC_DRAIN_BUILD_MAX_OPEN`, a whole number. Default per D3.
- **Headroom.** `cap - open build count`, floored at 0.
- **Landing rate.** Pull requests merged into `main` per hour over a stated window.

## Functional requirements

- **FR1 - Count each cycle.** When the build queue is non-empty, run_cycle counts the open build
  pull requests with one `gh pr list --state open` read carrying an explicit `--limit`, before
  ranking and before the dispatch cap. A cycle with an empty build queue makes no read (same
  rule as the spec-writing brake: a quiet queue costs no read).
- **FR2 - Pause at the cap.** While the open build count is at or above the cap, no build issue
  is dispatched this cycle. "At or above" matches `SPECIFY_MAX_HELD` and `SPECIFY_MAX_PENDING`;
  the issue's "exceeds" is read as this, so a cap of N means at most N open.
- **FR3 - Headroom limits a cycle.** Below the cap, the cycle dispatches at most headroom build
  issues, on top of the existing dispatch cap (the smaller of the two wins). Without this, a
  cycle at cap minus 1 at concurrency 8 could open up to 30 more. Like the dispatch cap (#2641),
  headroom counts dispatches that START: an issue the dispatcher refuses uses no headroom.
- **FR4 - Narrow before ranking.** A paused build queue is removed from the ready set BEFORE
  ranking and before the dispatch cap, exactly as spec-writing is narrowed (the "capped first and
  skipped afterwards" failure in the existing comment). With builds paused and spec-writing
  admitted, spec-writing issues are ranked and dispatched as usual.
- **FR5 - Spend moves to landing, not to idle.** A cycle whose builds are paused still runs the
  pull request sweep (`sweep_open_prs` and `_sweep_fetch_verdict`), including when the paused
  builds were the only ready work. This is the same path the spec-writing-only branch already
  takes. Whether paused build slots should also be offered to anything new is out of scope
  (see Out of scope).
- **FR6 - Fail closed on an unreadable count (invariant 2).** If the read fails (after the
  existing one-retry credential re-mint, #3400), returns anything but a whole number, or returns
  exactly as many rows as its `--limit` (possibly truncated, #2975), the build queue is paused
  for the cycle. A count nobody read is not zero. The sweep still runs.
- **FR7 - Every pause says so, every cycle.** Each paused cycle prints one line beginning
  `[drain] builds are PAUSED:` that names: the reason (at cap, unreadable count, or unreadable
  cap), the count and cap when known, the knob name `MINSPEC_DRAIN_BUILD_MAX_OPEN` and `#3506`,
  how many `agent-ready` issues were left undispatched, and that triage, spec-writing and pull
  request remediation run as usual. A cycle below the cap prints the count, cap and headroom on
  one `[drain] build backpressure:` line, so a reader can tell a gate that admitted from a gate
  that was never asked.
- **FR8 - An unreadable cap pauses.** A cap that is not a whole number is read as 0, which pauses
  builds, and FR7's line names the value with `printf '%q'`. Same reading as the two spec brakes:
  the knob exists to stop spending, so the reading that spends nothing is the safe one.
- **FR9 - Resume is automatic.** No state is kept between cycles. The first cycle whose count is
  below the cap dispatches again, within headroom. (Hysteresis is D4.)
- **FR10 - Independence.** The build brake never pauses spec-writing, triage, the sweep, the
  delegated-approval steps (Step 0b/0c/0d) or the quota gate, and the spec brakes never pause
  builds. When both are paused, the cycle goes straight to the sweep.
- **FR11 - Exemptions are logged.** Any issue dispatched despite a pause (only if D5 chooses an
  exemption) is named on its own line with the reason.
- **FR12 - Cap derived from measured landing rate.** The default cap is computed, at Plan, from a
  measured landing rate over a stated window with the formula in D3, and the drain's comment
  block above the knob records the measurement: the window, the merged count, the base SHA or
  date, and the arithmetic. A number with no measurement beside it is a guess and fails review.
- **FR13 - Persisted setting.** The knob is listed for SPEC-270 (drain settings persisted on disk)
  so a relaunch does not revert a founder's chosen cap. If SPEC-270 has not shipped when this is
  built, the env value with its in-script default is enough and the listing is a one-line note in
  SPEC-270's covered-knob list, made by whoever builds SPEC-270.

## Acceptance criteria

Hermetic, using the existing drain stubs (as `drain-specify-backpressure.test.ts` does). Each
must fail on a tree without this change (red on base, green on head).

- **AC1 (FR2, FR4).** Ready: one build, one spec-writing issue; open build count equals the cap.
  The build is not dispatched, the spec-writing issue is, and the `builds are PAUSED` line names
  the count and cap.
- **AC2 (FR3).** Ready: five builds; cap 4, open count 2, dispatch cap 30. Exactly two builds are
  dispatched. With the first one refused by the dispatcher, two others still are (refusals use no
  headroom).
- **AC3 (FR6).** The open-PR read exits non-zero: no build dispatched, the PAUSED line names the
  unreadable count, the sweep still runs. Separately, the read returns exactly `--limit` rows:
  same outcome, and the line says it may be truncated.
- **AC4 (FR8).** `MINSPEC_DRAIN_BUILD_MAX_OPEN` set to each of `ten`, `-1`, `1.5`, ` 10`: no build
  dispatched, and the line names the value.
- **AC5 (FR5).** Only builds are ready and they are paused: the sweep runs and the cycle ends
  `cycle done.` with exit 0.
- **AC6 (FR1).** Empty build queue: no open-PR count read is made (the `gh` stub records no call
  for it).
- **AC7 (FR10).** Builds paused and spec-writing paused by `SPECIFY_MAX_HELD`: nothing is
  dispatched, two PAUSED lines print, the sweep runs.
- **AC8 (definitions).** A spec-draft pull request (#3570 shape) and a non-`agent/issue-*` pull
  request are not counted; a build pull request is. Plus whatever D1 and D2 decide about drafts
  and held pull requests, each with a fixture row.
- **AC9 (FR7).** Below the cap, the `build backpressure:` line prints count, cap and headroom.
- **AC10 (FR12).** Review-checked, not tested: the knob's comment block carries the measurement
  and the arithmetic.

## Invariants this must not break

- **Invariant 1 (offline).** This is the dev-time drain, not the extension. The extension gains
  no network call. The one added `gh` read sits beside the drain's existing ones.
- **Invariant 2 (no silent gate).** An unreadable count or cap pauses builds and says so every
  cycle (FR6, FR7, FR8). No swallowed error writes the count. This brake is a dispatch
  throttle, not a merge-gating check, so the second-witness clause does not apply; its failure
  direction (pause) is the one that spends nothing.
- **Invariant 3 (blast radius).** Only the drain of this checkout reads the knob; nothing is
  written outside it.
- The quota gate is not relaxed. The brake only narrows what is dispatched, never widens past the
  quota gate or the dispatch cap.
- The spec-writing brakes (#2939, #3344, #3570 predicate) keep their behaviour; their tests stay
  green unchanged.
- `_pr_claims` (#3241) and its fail-closed hold keep their behaviour and order.
- Ranking (#2196) and the start-counting dispatch cap (#2641) are unchanged; headroom is applied
  the same way.

## Decisions needed (Clarify)

Each has a recommendation and the cost of taking it.

- **D1 - Which pull requests count toward the pile.**
  - (a) **(rec)** The drain's own build pull requests only (`agent/issue-*`, not a spec draft).
    That is the inflow this gate can throttle, and it keeps the brake's meaning plain. Cost:
    pull requests opened by sessions and runners (part of the issue's 82) still add strict churn
    and are not seen, so the true pile can exceed the cap.
  - (b) Every open non-draft pull request on the repo. Measures the strict contention directly.
    Cost: a session's burst of pull requests pauses the drain's builds, which it cannot drain,
    and a founder's own long-lived pull requests hold a permanent share of the cap.
  - Either way, draft pull requests are not counted (they are not updated or merged under strict).
    Counting them is (c) if the human wants it.
- **D2 - Do build pull requests held for a human count?** (`needs-human-review`, e.g. machinery
  builds waiting on an `--admin` merge.)
  - (a) **(rec)** Not counted, and reported as a separate number on the FR7 line. They do not
    land through remediation, so counting them pauses builds behind a founder backlog: the
    mirror of the #3570 failure, where 44 held builds paused spec-writing. Cost: the held pile is
    unbounded by this gate; a founder backlog grows without the drain slowing.
  - (b) Counted. Bounds the total. Cost: a weekend away from the founder stops all builds, which
    is idle quota, the thing the issue forbids.
- **D3 - How the cap is set.**
  - (a) **(rec)** A static default in the script, computed at Plan by Little's law:
    `cap = ceil(landing rate per hour x target hours a build pull request may wait)`, landing
    rate measured over the last 7 days of merges into `main` by the counted population (D1).
    Recommended target wait: 8 hours, so a build dispatched at the end of one working session
    lands by the next. Example with the issue's figure of 36 merged in 12h (3 per hour,
    unverified, and over all pull requests, not the D1 population): `3 x 8 = 24`. Cost: the cap
    goes stale as the landing rate moves, and needs re-measuring by hand.
  - (b) Computed every cycle from merges in a trailing window (one more `gh` read per cycle).
    Tracks the rate automatically. Cost: a second read that must also fail closed, a falling
    landing rate shrinks the cap and pauses builds exactly when the pile is stuck (possibly
    right), and the behaviour is harder to predict from the log.
  - (c) A plain guess (say 20). Rejected by the issue ("rather than a guess").
- **D4 - Hysteresis.**
  - (a) **(rec)** None: pause at the cap, resume below it, with FR3 headroom. Headroom already
    stops overshoot, and stateless is simplest to test. Cost: near the cap, builds trickle in
    one or two per cycle rather than in batches.
  - (b) Resume only below a low mark (say 75% of the cap). Fewer, larger dispatch bursts. Cost:
    state across cycles (or a second knob), and idle build slots while the pile sits between
    the two marks.
- **D5 - Exemption for `pipeline-blocker` issues.**
  - (a) **(rec)** Exempt: a `pipeline-blocker` build is dispatched even when paused, named on its
    own line (FR11). A fix to the thing that stops landing (a red required check, a broken
    remediation) is what drains the pile, and pausing it would deadlock the brake. Cost: a
    pile can exceed the cap by the number of blocker issues; the label becomes a bypass if
    applied loosely.
  - (b) No exemption. Cost: a blocker that keeps the pile above the cap is never built by the
    drain; a human must dispatch it by hand.

## Out of scope (tracked elsewhere)

- Making `cos.py pr-drive` faster or rotating its slot: the staged supervisor patch the issue
  names, outside this repo's drain. Not this spec.
- Throttling pull requests opened by sessions or runners other than the drain (D1(a) leaves them
  uncounted). If the human picks D1(a) and wants those bounded too, that is a new issue.
- Redirecting paused build quota to new kinds of work (pre-emptive base updates, extra review
  rounds). FR5 keeps the existing sweep running; adding work to it is a new feature.
- Persisting the knob on disk: SPEC-270 (FR13 only lists it there).
- Serialising merges or a merge queue: SPEC-296 works one-at-a-time for delegated approvals only.

## Follow-ups (tracked)

- None beyond the cross-references above. The measurement in FR12 is part of this spec's Plan,
  not a follow-up.
