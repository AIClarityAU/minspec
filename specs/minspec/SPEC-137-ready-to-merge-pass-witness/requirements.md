---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — silent-gate incident family
aspects: [ci, gates, ready-to-merge, ai-review, silent-failure, provenance]
relates_to: [SPEC-071, SPEC-054, SPEC-062, DR-066]
---

# SPEC-137: `ready-to-merge` must go green on a genuine `ai-review:pass` — no single-producer witness

Issue: #810 (ready-to-merge status RED on genuine ai-review:pass PRs; sibling of #560).

## Problem

The required context `ready-to-merge` is a commit STATUS written by `ready-to-merge.yml`.
It was RED on PRs carrying a genuine `ai-review:pass` because its only accepted
SHA-bound witness was the `ai-review/pass` commit status, which `ai-review.yml` posts
best-effort (`|| true`). The post returned 403 (App installation lacked
`statuses: write`), the label landed anyway, and the gate was unsatisfiable: auto-merge
(DR-060/061) never fired and every merge was an `--admin` bypass of the whole gate.
This violates constitution invariant 2: a required check hinged on ONE producer that
one permission gap could disable, with the failure swallowed.

## Current state (verified against the tree at spec time; re-verify before building)

- `.github/workflows/ready-to-merge.yml` already accepts EITHER witness via
  `guard.verifyHeadPassWitness` (status `ai-review/pass`=success OR `ai-review`
  check-run=success on head), both provenance-checked against `AI_REVIEW_BOT_LOGINS`
  (`ready-to-merge.yml` ~L338-395; `.github/scripts/ai-review-guard.js`).
- `ai-review.yml` ~L1331 now emits an `::warning` when the status post fails instead
  of staying silent.
- Machinery PRs are held red on purpose (#596): not part of this bug.
- Not verified here: that the live repo's merges since that change no longer need
  `--admin` for non-machinery PRs; and the existence of an end-to-end test (genuine
  pass on head ⇒ `ready-to-merge`=success) beyond guard unit tests. Clarify must
  establish both before build; this spec does not claim "fixed".

## Functional requirements

- **FR-1** For a non-machinery PR whose head carries `ai-review:pass` with valid
  provenance, `ready-to-merge` resolves `success` when AT LEAST ONE independent
  witness is present on the current head SHA (status or check-run).
- **FR-2** Each witness is bound to the head SHA and verified against the same bot
  allowlist; an unbound, stale-SHA, wrong-actor or non-success witness never counts.
- **FR-3** If neither witness can be read or neither exists, the gate is `failure`
  with a reason naming which witness was missing and why (fail closed, visible).
- **FR-4** A failed `ai-review/pass` status post MUST be visible beyond a log
  warning: the ai-review job summary and the PR must state which witness is absent
  (decision DN-1 below chooses the surface). It must not fail the whole review.
- **FR-5** Name collision: the check-run and status both called `ready-to-merge` must
  not be ambiguous to a reader of the rollup; the spec requires a documented
  disambiguation (job id already renamed `gate`, #1804) and a test pinning the
  required context to the status producer.
- **FR-6** A T0 (offline, no network) test drives the guard + `decideStatus` with
  fixtures: (a) check-run only ⇒ success; (b) status only ⇒ success; (c) both
  missing ⇒ failure; (d) witness on a different SHA ⇒ failure; (e) machinery ⇒
  held red. The test must be mutation-checked (remove FR-1's OR ⇒ (a) goes red).
- **FR-7** Regression sentinel: a repo-level check (or SPEC-071's drift witness)
  reports when a non-machinery `ai-review:pass` PR's `ready-to-merge` is red, so the
  condition cannot silently return (see DN-2).

## Acceptance criteria

- **AC-1** Fixture (a)-(e) in FR-6 pass under `npx vitest` (CI's invocation, not only
  `npm test`).
- **AC-2** With the status post forced to 403, a genuine non-machinery pass still
  yields `ready-to-merge`=success via the check-run, and the failure is visible per FR-4.
- **AC-3** With both witnesses removed, `ready-to-merge`=failure and the description
  names both.
- **AC-4** A non-machinery `ai-review:pass` PR can be merged natively/auto-merged
  without `--admin` (observed on one real PR after the change; recorded in the PR).

## Invariants this must not break

- Offline core (inv. 1): tests are fixture-only, no network.
- No silent gate (inv. 2): no new `|| true` on a gate signal; a missing witness fails
  closed and visibly; two independent witnesses remain (no single producer).
- SHA binding (#466/#776) is never weakened to a label or timestamp.
- Blast radius (inv. 3): changes touch only this repo's workflows/scripts, and
  shipped templates only if already shipped.

## Decisions needed (Clarify)

- **DN-1 Where the missing-status signal surfaces (FR-4).**
  A) job-summary + PR comment **(rec)** — visible where the author looks; costs one
  extra API write that can itself 403.
  B) fail the ai-review job — loudest; but fail-closes every review into
  `ai-review:changes` over a permission gap (the earlier reason it stayed non-fatal).
  C) log warning only (today) — cheapest; invisible to PR authors.
- **DN-2 Sentinel home (FR-7).** A) extend SPEC-071's drift check **(rec)** — one
  place for gate-drift; costs coupling to a spec still in `planning`. B) new
  scheduled workflow — independent; adds CI config surface to maintain.
- **DN-3 Grant `statuses: write` to the App.** Needs a human on the App installation
  (not agent-doable). Recommend granting it **(rec)** so both witnesses exist;
  cost: widens the App's write scope. Not granting leaves the check-run as the sole
  live witness, which still satisfies FR-1 but not "two independent" in practice.
- **DN-4 Scope.** If Clarify finds the end-to-end behaviour already correct and
  FR-6 tests present, reduce this spec to FR-4/FR-7 only (or close #810 with the
  evidence). Recommend verify-then-shrink.

## Out of scope

Machinery-PR holding (#596); admin-bypass policy; auto-merge driver (SPEC-062).
