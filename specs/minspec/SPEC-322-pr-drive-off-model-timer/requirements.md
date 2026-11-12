---
id: SPEC-322
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - same epic as the merge-lane spec this complements
aspects: [merge, pr-drive, chief-of-staff, quota, throughput, host-patch, fail-closed]
depends_on: []
relates_to: ["#3514", "#3453", "SPEC-296", "DR-119"]
implements: none
implements_reason: >-
  Specify phase only. The loop and `cos.py` live outside this repo (read-only mount in the
  container); the deliverable here is a host patch. Which files this repo owns is decided at Plan.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-322: Founder-armed pull requests keep landing while the quota cap is closed

> **This is a SPECIFICATION ONLY.** Written for issue #3514 (founder-armed pull requests land at
> one per 2 hours while the quota cap is closed). Nothing is built until this spec is approved
> and the [Decisions needed (Clarify)](#decisions-needed-clarify) are resolved.

## In plain terms

`cos.py pr-drive` updates one pull-request branch per chief-of-staff (CoS) run. While the drain's
quota cap reads `closed`, the runner loop falls back to a 2 hour heartbeat, so already-armed
(`gh pr merge --auto --squash`) founder pull requests land at about one per 2 hours. Updating a
branch needs no model. This spec lets `pr-drive` run on its own short timer, with no model run,
while the cap is closed.

## Evidence (issue #3514, measured 2026-10-31; not re-verified by this spec)

- Cap at 11:09Z: `closed 7d 60% vs 60.0% ramped`; ramp next admits in 1.3 days.
- Main did not move from 09:15Z (#3235) to at least 11:19Z.
- 15 founder-armed approval pull requests open, all auto-merge armed; at one per run, ~30 hours.
- Unverified by me: that `pr-drive` needs no model, and what a push costs in re-triggered
  review. Both are Plan-phase measurements (FR-6).

## Functional requirements

- **FR-1 Independent timer.** While the quota cap reads `closed`, the loop invokes
  `cos.py pr-drive` on its own short timer, without starting a model run.
- **FR-2 Same serialisation.** The timer invocation uses the same single-branch serialisation
  (lock) and the same output file as the in-run invocation, so the two can never update
  branches concurrently or write interleaved output.
- **FR-3 Armed only.** The timer invocation updates only a pull request that already has
  auto-merge armed. It never arms, merges, approves, re-labels or edits a pull request.
- **FR-4 Fail visibly.** A timer-invocation failure (lock held too long, auth gap, API error,
  missing output file) is logged where the loop's other failures are and surfaced in the CoS
  digest; it is never swallowed (invariant 2).
- **FR-5 Cap-open behaviour unchanged.** When the cap is not closed, behaviour is exactly as
  today; the timer path must not double-drive alongside the in-run call.
- **FR-6 Cost measured first.** Before enabling, measure what one branch update costs: CI
  minutes, and any model tokens a push re-triggers through the review panel. The measured figure
  (with its share of the weekly budget) is recorded in the Plan; if it exceeds the bound chosen
  under Clarify Q2, the timer ships disabled.
- **FR-7 Delivery as a host patch.** The change touches the loop and `cos.py`, which sit on a
  read-only mount in the container, so it is delivered as a patch the founder installs on the
  host. The patch is self-contained and states its install step and rollback.
- **FR-8 No overlap with the lane.** It must not contend with the delegated-approval merge lane
  (SPEC-296) or the machinery-ordering fix (#3453): `dlg-approve/*` branches stay the lane's.

## Acceptance criteria

- **AC-1** With the cap closed and N armed founder PRs behind, main advances by about one
  landing per timer interval, not per 2 hours, with zero model runs started (FR-1).
- **AC-2** A test with two concurrent invocations (timer and in-run) shows one waits or skips and
  the output file is never interleaved (FR-2).
- **AC-3** An unarmed PR is untouched across a full timer cycle (FR-3).
- **AC-4** A forced failure (auth removed) appears in the log and digest (FR-4).
- **AC-5** With the cap open, one `pr-drive` call occurs per run, as before (FR-5).
- **AC-6** The Plan cites a measured per-update cost with its weekly-budget share (FR-6).
- **AC-7** The patch applies cleanly to the host files and has a documented rollback (FR-7).

## Invariants this must not break

- Invariant 1 (offline core): the timer lives in the CoS runner, not in the shipped extension;
  nothing MinSpec ships gains a network call.
- Invariant 2 (no silent gate): FR-4; and the timer must not become the only witness for any
  merge-gating check.
- Invariant 3 (blast radius): no change to repos without `.minspec/`.
- Tenet 2 (tokens): no model run is started by the timer.

## Decisions needed (Clarify)

1. **Timer interval.** (a) 10 min **(rec)**: ~6 landings/hour, so 15 PRs in ~2.5 h; cost: more
   CI minutes and review re-triggers. (b) 30 min: cheaper, 15 PRs in ~7.5 h. (c) 2 h: no change.
2. **Review-cost bound.** If a push re-triggers the model review panel, who pays? (a) Accept it
   up to a stated share of the weekly budget per hour **(rec)**: cost: needs a number from the
   founder. (b) Skip branches whose update would re-trigger review: cost: those never land
   faster. (c) Unbounded: cost: could spend tokens while the cap is deliberately closed.
3. **Where the timer lives.** (a) In the loop (a second short-sleep path) **(rec)**: one place,
   shares its lock; cost: edits the loop itself. (b) A separate host cron/systemd timer: no loop
   edit; cost: a second scheduler to monitor, and lock sharing must be proven.
4. **Scope vs #3453.** Fix only the closed-cap cadence here, leaving ordering to #3453
   **(rec)**; cost: armed founder PRs may still queue behind older machinery PRs until it ships.
