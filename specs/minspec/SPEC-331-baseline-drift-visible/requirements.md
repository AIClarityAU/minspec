---
id: SPEC-331
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - per-machine baseline drift must be visible, not silent
aspects: [ci, trust-dashboard, baseline, fail-visible, warn-only]
depends_on: []
relates_to: ["#3729", "#3724", "#435", "#404", "SPEC-017", "DR-042", "DR-043"]
implements: none
implements_reason: >-
  Specify phase only. Expected surface: one non-required CI step (machinery, founder gate) and a baseline-drift
  readout in the trust dashboard. Neither is built.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-331: Baseline drift is visible without running a script by hand

Issue: #3729 (follow-up to #435, deferred from PR #3724). Rationale records: DR-043 (approval baseline; snapshot refs are not pushed by default), DR-042.

## Problem

`checkBaselineIntegrity` (`packages/minspec/src/lib/approval.ts:318`) classifies every approval record's baseline as recovered, unrecoverable or absent. PR #3724 adds the warn-only `npm run check:baseline-integrity` caller, which emits `::warning::` under GitHub Actions. Nothing runs it in CI and no dashboard shows it, so drift is detectable but nobody sees it unless they run the script by hand. Drift is per-machine: the baseline blob is only gc-safe where it was minted (`approval.ts:136-140`), so a fresh clone legitimately reports unrecoverable records. It is not a defect in the change under review.

## Functional requirements

- **FR-1** A CI workflow step runs `npm run check:baseline-integrity` on pull requests so drift is annotated on the PR.
- **FR-2** The step is never required and never fails the job: not in the required-check set, and a drift finding or script non-zero exit must not turn the PR red. (Warn-only by design.)
- **FR-3** The step's own breakage (script missing, crash) is visible in the job log and as an annotation, not swallowed with `|| true`. Constitution invariant 2 (no silent gate) is honoured by distinguishing "drift found" (warning) from "the check could not run" (visible error annotation, still non-blocking).
- **FR-4** The trust dashboard (SPEC-017) shows baseline drift: the counts from `BaselineIntegrityReport` (total, recovered, unrecoverable, noBaseline) and the list of unrecoverable spec paths.
- **FR-5** The dashboard readout is computed offline from the local ledger and git object store only (invariant 1); it makes no network call.
- **FR-6** The readout labels drift as per-machine ("this clone cannot recover N baselines") and never as a spec or change defect.
- **FR-7** Both surfaces call `checkBaselineIntegrity`; neither re-implements the classification (no duplicate predicate).
- **FR-8** Both surfaces run only in a repo that opted in via `.minspec/` (invariant 3).

## Acceptance criteria

- **AC-1** A PR in this repo shows a `::warning::` annotation when at least one record is unrecoverable on the CI runner; the PR's required checks are unchanged. (FR-1, FR-2)
- **AC-2** With the script made to exit non-zero, the PR stays mergeable and the failure is annotated. (FR-2, FR-3)
- **AC-3** The step name does not appear in the repo ruleset's required-check list. (FR-2)
- **AC-4** In a clone with an unresolvable baseline SHA, the dashboard lists that spec under unrecoverable; in a clean clone it shows zero. (FR-4, FR-6)
- **AC-5** A test fixture with no network proves the dashboard readout makes no network call. (FR-5)
- **AC-6** Grep shows no second classification of baselines outside `approval.ts`. (FR-7)

## Invariants the change must not break

1. Offline core: no network call (constitution 1).
2. No silent gate: step failure is visible; no `|| true` on the load-bearing signal (constitution 2).
3. Blast radius: nothing runs in a repo without `.minspec/` (constitution 3).
4. Warn-only: drift never blocks a merge.

## Out of scope

- Making drift self-healing (pushing snapshot refs, DR-043 default stays "do not push").
- Changing `checkBaselineIntegrity` classification semantics.

## Dependency

Blocked on PR #3724 landing (it introduces `npm run check:baseline-integrity`). Not on this branch's base at spec time, so the script's exact output format is unverified here.

## Decisions needed (Clarify)

1. **CI step: gate on the founder.** Workflow edits are machinery and need the founder's gate (a dev-role agent cannot edit CI config). Options: (a) **(rec)** a separate non-required job, which keeps a drift crash from ever touching required checks, at the cost of an extra runner spin-up per PR; (b) a step inside the existing `ci.yml` job, cheaper, but a misconfigured `continue-on-error` could mask a failure in, or redden, a required job.
2. **Dashboard placement.** Options: (a) **(rec)** a small drift row in the existing SPEC-017 rework panel, least new surface, but it is invisible to someone who never opens a spec; (b) a status-bar item, more visible, but it adds standing UI for a per-machine, warn-only signal and invites noise.
3. **CI-runner meaning.** A fresh CI checkout will usually report many records unrecoverable because snapshot refs are not pushed (DR-043), so the PR annotation may be permanent noise. Options: (a) **(rec)** annotate only the count change versus main, needs a stored baseline count and extra machinery; (b) annotate always, simplest, but a constant warning teaches reviewers to ignore it; (c) skip CI and ship only the dashboard, no noise, but drops FR-1 which the issue asked for.
