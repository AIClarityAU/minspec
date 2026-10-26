---
id: SPEC-182
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - a required check must exist and be visible, or it is not a check
aspects: [ai-review, github-actions, check-run, no-silent-gate, fail-closed, head-base-skew, machinery]
depends_on: []
relates_to: [DR-090, "#1925", "#1834", "#1839", "#1120", "#486", "#1728", "#1688", "#2018"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). Nothing is
# built from this spec until it is approved. The work lands in .github/workflows, which
# the App cannot push (#1120): a human pushes it.
affects: [.github/workflows/ai-review.yml, .github/scripts/ai-review-guard.js, scripts/gen-ci-templates.mjs, packages/minspec/src/lib/hook-templates.ts, packages/minspec/tests/managed-region-templates.test.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-182: The required `ai-review` check-run is always posted - red if it cannot be computed

## In plain terms

The `ai-review` workflow ends by posting a check-run named `ai-review`, which branch
protection requires. If the code that builds that check-run's body throws, the step prints
a warning and exits 0, so the job is green and the required check-run is simply missing.
On a machinery PR the resulting red `ready-to-merge` looks like the normal resting state,
so nothing flags it.

This spec makes the step fail loudly instead: if the normal body cannot be built, it posts
a minimal red `ai-review` check-run that needs no guard code, and the step exits non-zero.
It also adds a preflight that catches the cause up front: a head workflow calling a guard
function the trusted base guard does not export.

Issue: #1925 (ai-review check-run step swallows body-compute failure). Related: #1834
(head/base version skew, no handshake), #1839 (the live instance), #1120 (the App cannot
push `.github/workflows/`).

## Context

**Live instance.** #1839's head workflow called `g.patchFingerprint` and
`g.renderPatchFingerprint`, but the step loads `ai-review-guard.js` from the trusted base
checkout, whose guard exported neither. Run 34551496854 (head 5e024f64), step 9, concluded
`success` with `TypeError: g.patchFingerprint is not a function` and the warning "Could not
compute the verdict check-run body". The panel had passed 4/4; the check-run was absent.

**What main already has (verify before planning).** The step "Post honest `ai-review`
verdict check-run" (`.github/workflows/ai-review.yml`, from about line 1090) now
feature-detects `patchFingerprint`, `renderPatchFingerprint` and `renderRoundRecord` and
wraps each in its own try/catch, so a *missing optional helper* no longer loses the
check-run. That fixed the instance. It did not touch the path that swallows the fault:
- `if ! node -e '...'; then ::warning ...; exit 0; fi` still converts any other throw
  (for example `decideReviewCheck` missing or throwing, `require` of the guard failing, a
  `writeFileSync` error) into a green step with no check-run.
- The final `gh api -X POST ... check-runs` failure is likewise only a warning followed by
  `exit 0`. The missing-token branch at the top of the step is the same shape.

**Root cause.** The step treats the check-run as best-effort ("the label/comment remain
authoritative"), yet the check-run is the *required, server-attested witness* (#397). A
required witness whose producer can disappear while the producer shows green is a silent
gate (constitution invariant 2). The guard is loaded from the base while the step runs
from the head, with no version handshake (#1834), which makes the failure reachable.

## Functional requirements

- **FR-1 Never absent.** Whenever the step runs (its existing `if:` condition) and a token
  is available, an `ai-review` check-run MUST exist on the head SHA afterward, or the step
  MUST exit non-zero. "Warn and exit 0" is removed from the body-compute path and from the
  POST-failure path.
- **FR-2 Guard-free fallback.** If the body cannot be computed by the guard-based script,
  the step MUST post a minimal check-run with `name: ai-review`, `conclusion: failure`, the
  head SHA, and a summary naming the failure, built with no `require` of the guard (plain
  shell and `gh`, or a node script that only uses core modules). It then exits non-zero.
- **FR-3 Real conclusion preserved.** The fallback applies only on failure to compute. When
  the body is computed, the conclusion is exactly what `decideReviewCheck` returns today
  (machinery -> neutral, pass -> success, changes -> failure). No change to verdict logic.
- **FR-4 POST failure is visible.** If posting the computed check-run fails, the step
  retries the fallback post once where meaningful, and in every case exits non-zero. It
  never reports success with the witness absent.
- **FR-5 Export-compatibility preflight (#1834).** Before the verdict steps depend on the
  guard, a preflight enumerates the guard functions the head workflow calls and checks that
  each is exported by the base guard. A required function that is missing fails the job
  visibly with the function name. Optional, feature-detected helpers (FR-6) are listed
  separately and produce a notice, not a failure.
- **FR-6 One source of truth for optional vs required.** The set of required and optional
  guard exports lives in one place that both the preflight and the step read, so the two
  cannot drift.
- **FR-7 No-token case.** An absent App token is not a reason to exit 0 silently:
  see Decisions needed (D2).

## Acceptance criteria

- **AC-1** A test that forces the body script to throw (guard missing `decideReviewCheck`;
  guard `require` failing) observes: a failure-conclusion `ai-review` check-run posted
  without the guard, and a non-zero step exit. Fails on current main, passes after.
- **AC-2** A test with a base guard that lacks an optional helper still posts the real
  conclusion check-run and exits 0 (no regression of the existing #1925 feature
  detection).
- **AC-3** A test where `gh api` POST fails: step exits non-zero.
- **AC-4** The preflight fails, naming the function, for a head workflow that calls a guard
  function absent from the base guard, and passes for the current pair.
- **AC-5** The executable-glue test pattern already used for this block
  (`ai-review-verdict-carry-glue.test.ts` executes the script) covers the new branches,
  including the single-quoted-shell-string constraint (no apostrophes in the node script).
- **AC-6** On a machinery PR, a compute failure yields `failure`, never `neutral`, so a
  broken witness cannot read as the normal machinery resting state.

## Invariants this must not break

- **Constitution invariant 2 (no silent gate)** is the point of the change: a missing or
  errored witness fails closed and visibly, with a second producer (the guard-free
  fallback) so one fault in the guard cannot disable the check.
- **Invariant 1 (offline)** unaffected: CI-only, no extension network calls.
- **Invariant 3 (blast radius)** holds, but not because the edit is local. Both
  `ai-review.yml` and `ai-review-guard.js` are managed templates (`scripts/gen-ci-templates.mjs`
  `SOURCES`, regenerated into `packages/minspec/src/lib/hook-templates.ts` and checked by
  `managed-region-templates.test.ts`), so the change reaches every adopter on Refresh Harness
  Files. It stays inside the blast radius because adopters opt in via `.minspec/`; the
  regenerated template and its parity test are part of this change.
- Trusted-input discipline stays: only App token, repo slug, GitHub-assigned SHAs and our
  own gate's outputs reach the shell; no PR-controlled text in the fallback summary.
- The fallback must not mask a real verdict: it is only reachable on compute failure.

## Out of scope

- Redesigning head/base loading (running the head guard is a trust-boundary change, see
  #1834). This spec only makes the skew loud and checkable.
- The `machinery-review-required` and other check-run steps, which share the
  warn-and-exit-0 shape. Tracked as a follow-up decision (D3).

## Decisions needed (Clarify)

- **D1 - Preflight placement.** (a) Separate early step that fails the job before the
  review runs **(rec)**: fastest, clearest signal; costs a CI step and a failed job that
  burns no review quota but also blocks the review on an optional-only skew if mis-classified.
  (b) Fold the check into the verdict step: no new step, but the failure arrives after the
  review spend.
- **D2 - No App token.** (a) Exit non-zero **(rec)**: consistent with FR-1; costs red runs
  on forks or repos where the App is intentionally not installed, unless gated by
  `steps.guard.outputs.configured` (already the step's condition, so likely a non-issue).
  (b) Keep warn + exit 0: preserves current behaviour but leaves the witness silently absent.
- **D3 - Sibling steps.** Apply the same fail-visible rule to `machinery-review-required`
  now **(rec)**, closes the sibling hole, widens the machinery diff and review; or file a
  follow-up and keep this PR to the one step.
- **D4 - Failure-conclusion wording.** `failure` (as the issue proposes) versus
  `action_required`. `failure` **(rec)**: unambiguous red; cost is it cannot be told
  apart from a changes verdict except by title, so the title must say "could not compute".
- **D5 - Delivery.** The change is in `.github/workflows/`, which the App cannot push
  (#1120), and it is machinery so it needs a human `--admin` merge. A human must push it.
- **D6 - Record a DR?** FR-2's guard-free second witness and the FR-5/FR-6 preflight contract
  are design choices. Clarify/Plan decides whether they need a DR (constitution invariant 2,
  "independent second witness") or stay spec-only.
  - **Option (write a DR).** Record FR-2's guard-free second witness and the FR-5/FR-6
    preflight contract in a decision record, so the design choice outlives this spec.
  **Recorded selection: Option (write a DR),** drafted as DR-113 (`proposed`), which records
  the guard-free second witness and the preflight contract as this spec describes them.
  Recorded by an agent session under delegation DLG-001 (DR-108, the delegated-approval
  record); ratified only by approval of this spec, and DR-113 takes effect only on acceptance.
