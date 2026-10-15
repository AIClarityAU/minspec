---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - the checks are the methodology; this makes the heavy ones bite without taxing every PR
aspects: [ci, required-checks, tier-gate, scheduled-run, no-silent-gate, blast-radius]
depends_on: [SPEC-001, DR-033, DR-074]  # SPEC-001 owns the classifier; DR-033 the gate-by-blast-radius rule; DR-074 the opt-in scope rule
relates_to: ["#391"]
# Ownership is declared in Plan, once the shape of the two levers is chosen (see Decisions needed).
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Occasionally enforce the full check suite - a tier-gated required check plus a scheduled run on main

Issue: #391. Design rests on DR-033 (consequence-hybrid, gate by blast radius).

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. A human reads
> it and approves it through the normal spec-approval gate before design or code.

## In plain terms

Today the ruleset requires `lint` and `test`. The `e2e`, `security` (bumblebee supply-chain
scan) and `package` jobs in `.github/workflows/ci.yml` run on every PR but do not block a
merge, so a red heavy check can be merged past and drift reaches `main` unseen. This spec
adds two stateless levers: (1) a single required `tier-gate` status that makes the heavy
checks blocking only for T4 changes, and (2) a scheduled run of the whole suite on `main`
that opens an issue when it fails. Cost: one more required check and a cron's worth of CI
minutes. Left out: an every-Nth-PR counter (rejected, see below).

## Current state (to be verified in Plan, not assumed)

I believe, from reading `ci.yml` (jobs `lint`, `actionlint`, `test`, `build`, `e2e`,
`security`, `package`; triggers `push`/`pull_request` on `main`, no `schedule:`), that the
heavy jobs are not in `main`'s required set. Plan must confirm the required set by reading
`/rules/branches/main`, not the classic-protection endpoint.

## Functional requirements

- **FR-1 Single required `tier-gate` status.** A workflow posts one commit status named
  `tier-gate` on every PR head SHA. It is the only new required check; the heavy jobs stay
  non-required in the ruleset (GitHub required checks are static per ruleset, so the tier
  logic lives inside this status).
- **FR-2 Tier input.** `tier-gate` derives the change's tier by running the existing
  deterministic classifier over the PR diff. It never re-implements classification, and
  never lowers a tier (upward-only floor, per CLAUDE.md SDD Methodology). A `tier:` label
  or spec frontmatter tier may raise it.
- **FR-3 T4 enforces the full suite.** For a T4 change `tier-gate` is green only when the
  `e2e`, `security` and `package` jobs of the same head SHA concluded `success`. Pending
  keeps `tier-gate` pending; failure, cancelled or skipped fails it.
- **FR-4 T1-T3 do not wait on heavy jobs.** `tier-gate` is green as soon as classification
  completes; it does not read heavy-job results.
- **FR-5 Fail closed, visibly (constitution invariant 2).** If the classifier errors, the
  tier cannot be determined, a heavy job's result cannot be read, or the status cannot be
  posted, `tier-gate` fails red with the reason in its description. No `|| true`, no
  default-to-green. A heavy job that is expected for T4 but never ran counts as failed, not
  as absent.
- **FR-6 Independent second witness.** The T4 enforcement must not hinge on one producer: if
  the workflow that posts `tier-gate` does not run (permission or config gap), the required
  check stays unreported and the PR stays unmergeable, which is the safe direction. Plan
  names how that is verified.
- **FR-7 Scheduled full suite on main.** A `schedule:` workflow (cron cadence per Decision
  D-2) runs the entire suite (lint, test, build, e2e, security, package) against the current
  `main` head, plus `workflow_dispatch` for a manual run. Stateless: no counter, no stored
  prior result.
- **FR-8 Failure is reported, not logged.** A failed scheduled run opens (or comments on one
  existing open) issue titled for the failing job(s) with the run link and head SHA. Repeated
  failures do not open duplicates. A failure to open the issue fails the run itself (FR-5
  applies).
- **FR-9 Optional cost lever.** Per-PR heavy jobs may be skipped on T1-T2 PRs unless a
  `run-full-ci` label is present, because FR-7 still covers `main`. Whether to ship this is
  Decision D-3; if shipped, a skipped heavy job on a T3+/labelled PR is a failure (FR-3/FR-5).
- **FR-10 Opt-in scope (invariant 3).** Anything shipped to adopters (template workflows)
  stays inert without `.minspec/`; the monorepo's own workflows are this repo's only change
  unless Decision D-4 says otherwise.

## Acceptance criteria

- **AC-1** A T4 PR with a failing `e2e` cannot merge; the same PR with all heavy jobs green
  can (FR-3).
- **AC-2** A T2 PR with a failing `e2e` is not blocked by `tier-gate` (FR-4).
- **AC-3** With the classifier made to throw, `tier-gate` is red with a stated reason (FR-5).
- **AC-4** With the `tier-gate` workflow disabled, the PR shows the required check as
  unreported and cannot merge (FR-6).
- **AC-5** The scheduled workflow, dispatched against a deliberately failing job, opens
  exactly one issue; a second failing run adds a comment, not a second issue (FR-7, FR-8).
- **AC-6** A heavy job expected for a T4 PR that was skipped or never ran leaves
  `tier-gate` red (FR-3, FR-5).
- **AC-7** Each of AC-1..AC-6 is pinned by a test that was seen to fail without the change
  (no vacuous pass).

## Invariants this change must not break

- Offline core (invariant 1): the classifier and gate logic make no network call of their
  own; only CI-side status reads/writes use the forge API, and nothing runs in the editor.
- No silent gate (invariant 2): FR-5/FR-6.
- Blast radius (invariant 3): FR-10.
- Machinery PRs still merge by human `--admin`; `tier-gate` must not be a path that
  auto-merges machinery.
- `ready-to-merge` remains the single status workflow for its purpose (its header says do
  not add a second workflow); `tier-gate` is a separate status, not a parallel gate for it.

## Rejected

- **Every-Nth-PR counter.** Stateful, non-deterministic about which PR is the Nth, and races
  across concurrent merges. The schedule gives the same "occasionally" guarantee without state.

## Decisions needed (Clarify)

- **D-1 Where does `tier-gate` live?** (a) New workflow `tier-gate.yml` **(rec)** - isolated,
  easy to disable; cost: one more workflow to keep in step with `ci.yml` job names.
  (b) A final job inside `ci.yml` that `needs:` the heavy jobs - fewer moving parts; cost:
  `ci.yml` has `paths:` filtering, and a skipped workflow never reports the required check,
  leaving PRs pending forever (the paths-ignore trap noted in `ci.yml`).
- **D-2 Schedule cadence.** Nightly **(rec)** - drift found within a day; cost: ~7x the
  minutes of weekly. Weekly - cheap; cost: up to a week of undetected drift.
- **D-3 Ship the cost lever (FR-9)?** Not in this spec **(rec)** - keeps scope to
  enforcement; cost: trivial PRs keep paying for e2e/bumblebee. Include - saves minutes;
  cost: a skip rule is itself a gate that can silently under-run, widening the spec to T4.
- **D-4 Do adopters get this?** Monorepo only **(rec)** - matches the issue; cost: adopters
  get no heavy-check enforcement. Ship a template - useful to adopters; cost: new template
  registry entry, which is review machinery needing human merge, and a new opt-in surface.
- **D-5 Tier source for PRs without a spec.** Run the classifier on the diff **(rec)** -
  one deterministic source; cost: classifier input is a diff, not intent, so it can under-
  classify (upward-only floor mitigates via label). Require a declared `tier:` label -
  explicit; cost: a missing label must then fail closed, adding friction to every PR.
- **D-6 Heavy-job reporting on a T4 PR that touches only docs.** Still enforce **(rec)** -
  simplest, tier is the only input; cost: occasional slow docs PR. Path-narrow - faster;
  cost: a second rule that can drift from the classifier.
