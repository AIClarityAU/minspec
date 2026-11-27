---
id: SPEC-474
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - guardrails a repo must carry, provisionable without hand-set secrets
aspects: [ci-review, ready-to-merge, no-silent-gate, provenance]
depends_on: ["SPEC-268"]
relates_to: ["#4140", "#4079", "#2982", "SPEC-268", "DR-115", "DR-054"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after the Decisions below.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-474: `ready-to-merge` re-evaluation must not turn a fresh green red on a lagging events list

> **This is a SPECIFICATION ONLY.** Written for issue #4140. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## Premise and base caveat

The defect lives in the SPEC-268 D2 option (b) amendment (PR #4079, "adopters need only the
Claude secret"), which adds a `workflow_run` / action `reevaluate` path to
`.github/workflows/ready-to-merge.yml`. That path is **not on the base this spec was written
against** (`a2ef7c72`: `grep reevaluate .github/workflows/ready-to-merge.yml` returns nothing).
The issue's line numbers (~:536-565) refer to #4079's branch. Plan must re-confirm each claim
below against the code once #4079 lands, and cite `file:line`. Claims here are the issue's, not
independently observed, except the base-visible read shown next.

On base, the pass-provenance read is at `ready-to-merge.yml:373-405`: when the event is
`labeled` with `ai-review:pass`, the signed sender plus `now()` is used (comment at :375-379:
"avoids eventual-consistency lag in the events list"); every other event reads
`issues.listEvents` (:390).

## In plain terms

Two runs can judge the same PR. The `labeled` run trusts the signed event and says green. The
`reevaluate` run, which queues behind it (per-PR concurrency group, `cancel-in-progress: false`)
and so writes the LAST status, reads the events list instead. If that list lags a few seconds
it sees no qualifying pass and posts `failure` over the green. This fails closed (never a false
green) but nothing re-runs, so a passing PR sits red until an unrelated push or label event.

## Problem (root cause, mechanism plus missing gate)

1. **Asymmetric witnesses.** The same verdict is derived from two different sources of the pass
   fact, one lag-immune and one lag-prone, and the lag-prone one runs last.
2. **No retry on an inconsistent read.** `reevaluate` treats "live `ai-review:pass` label on
   the head, but no pass in the timeline" as a verdict rather than as a contradiction in its own
   inputs.
3. **Replaced runs lose their side effects.** A `labeled`/`synchronize` run that the
   `workflow_run` run displaces in the queue never executes its provenance revert or
   stale-pass strip, because `decideProvenanceRevert` / `decideStalenessStrip` are no-ops for
   `reevaluate`.
4. **The test cannot see it.** `review-identity-mode.test.ts` (~:524, "same verdict the labeled
   run would") mocks an already-consistent timeline, so it passes with the defect present.

## Functional requirements

- **FR1 — Contradiction is not a verdict.** In `reevaluate`, when the live `ai-review:pass`
  label is present on the current head and the timeline shows no qualifying pass, the run
  re-reads the pass witness (per Decision D1) before posting `failure`.
- **FR2 — Bounded.** The re-read is bounded in attempts and total wall time (values fixed at
  Plan; the bound must fit inside the job timeout and not hold the per-PR concurrency slot
  longer than needed). Exhausting it posts `failure` with a reason that names the lag, not a
  generic "no pass".
- **FR3 — Fail closed, never open.** No path through FR1/FR2 can post `success` without a
  verified pass newer than the head commit and an allowlisted actor. A read that errors after
  retries fails closed and visibly (invariant 2); it is never swallowed.
- **FR4 — No change to the other arms.** The `labeled` arm, the App arm, and fork/machinery
  narrowing behave exactly as before on the same fixtures.
- **FR5 — Replaced-run effects preserved.** Per Decision D2, a `labeled`/`synchronize` run
  displaced by `workflow_run` still gets its provenance revert and stale-pass strip applied
  exactly once, by some run.
- **FR6 — Lag is testable.** A T3 test drives `reevaluate` with a timeline mock that returns no
  pass on the first N reads and the pass on read N+1, and asserts `success`. A second case where
  the pass never appears asserts `failure` after the bound. The existing "same verdict the
  labeled run would" test is extended or replaced so it fails when the lag handling is removed.

## Acceptance criteria

- **AC1.** Lagging mock (pass appears on read 2 or 3): `reevaluate` ends `success`; the final
  status on the PR is green with no push or label event.
- **AC2.** Never-appearing pass with the label present: `failure`, reason names the lagging
  timeline, attempts bounded as in FR2.
- **AC3.** Label absent on head: no retry loop; `failure` as today.
- **AC4.** Stale pass (timeline pass older than head commit) is still `failure`; retry must not
  turn staleness into green. Mutation test: removing the recency comparison fails a test.
- **AC5.** A `synchronize` run displaced by `workflow_run` leaves the PR with the revert/strip
  applied (per D2), proven by a test that fails on today's no-op.
- **AC6.** Mutation: deleting the retry (or the check-run fallback in D1) makes AC1 fail.

## Invariants this must not break

- Constitution invariant 2 (no silent gate): fail closed and visibly; no swallowed error; a
  missing or errored witness never passes.
- Never a false green: the fix may only convert a spurious red into green when a verified,
  newer-than-head pass exists.
- Invariant 3 (blast radius): changes ship only via the scaffolded workflow for repos that
  opted in (`.minspec/`).
- Workflow files are founder-push only: the implementing PR hands the push to the founder.

## Decisions needed (Clarify)

**D1 — Where does `reevaluate` get a lag-free pass witness?**
- (a) **Bounded backoff re-read of `issues.listEvents`** **(rec)**. Smallest change, one
  producer, matches the issue's first proposal. Cost: adds seconds of wall time on a lag and
  still depends on the lagging source, so a lag longer than the bound stays red.
- (b) **Read provenance from the `ai-review` check-run on the head SHA.** Written atomically by
  the reviewer App/Actions step, so no lag. Cost: a new trust path to verify (who may author
  the check-run, forge-narrowing per SPEC-268 AC4) and a second source that can disagree.
- (c) Both: check-run first, events as fallback. Cost: most code and the largest test matrix.

**D2 — How are the displaced run's revert and strip kept?**
- (a) **Run `decideProvenanceRevert` / `decideStalenessStrip` in `reevaluate` too** **(rec)**.
  Cost: `reevaluate` gains write side effects, widening what a `workflow_run` trigger can
  mutate; needs idempotence so a labeled run and a reevaluate run do not double-apply.
- (b) Keep `labeled`/`synchronize` out of the queue slot `workflow_run` can take (separate
  concurrency groups). Cost: both can then run concurrently and race on the final status,
  which is the ordering the current design relies on to be safe.

**D3 — Retry bound.** Recommend ~3 attempts over ~10 s **(rec)**; cost: a lag beyond that is
still a red that needs a push. Alternatives: longer bound (holds the queue slot), or no
bound-by-time with attempt count only.

Recorded selection: none. These are open for the human reader.

## Follow-ups (tracked)

None beyond #4140 itself.
