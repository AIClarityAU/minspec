---
id: SPEC-232
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - a review gate's glue must be tested, not just its library
aspects: [ai-review, workflow-glue, test-coverage, no-silent-gate, mutation-verified]
depends_on: []
relates_to: ["#2165", "#2142", "#2163", "#1840", DR-097, DR-104, SPEC-211]
implements: none
implements_reason: >-
  Specify phase only. Files are decided at Plan, after Decisions D1 and D2.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-232: The ai-review.yml glue that calls selectVotersToRun is executed by a test, and the test is proven non-vacuous

> **This is a SPECIFICATION ONLY.** Written for issue #2165. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

`selectVotersToRun` (per-voter survivor reuse, DR-097, #2142) has 28 unit tests. The shell and
`node -e` glue in `.github/workflows/ai-review.yml` that CALLS it has none. Two real defects
were caught in that glue by hand, and neither is reachable from a unit test on the exported
function: an apostrophe that ends a single-quoted `node -e` string (the YAML still parses), and
a patch file the selector fingerprints but nothing writes (fail-safe, so the feature ships
silently inert). This spec adds a test that executes the workflow block verbatim.

## State at specification time (verified, not assumed)

- `selectVotersToRun` is on `main` in `.github/scripts/ai-review-guard.js` (DR-097 cites
  `main:577`); its unit tests are `packages/minspec/tests/voter-survivor-reuse.test.ts`.
- `grep selectVotersToRun .github/workflows/ai-review.yml` returns nothing: **the wiring is not
  on `main`.** DR-097 states the same ("#2142 is not implemented"). The wiring is a founder
  push (the App holds no `workflows` permission).
- The handover notes and verified patch named in the issue (`.local/2142-wiring-handover.md`,
  `.local/2142-ai-review-wiring.patch`) are **not present in this worktree** (untracked, so not
  in a fresh checkout). This spec therefore cannot cite the wiring's real step name, marker
  names or env vars; Plan must read them from the patch.
- The pattern to follow, `packages/minspec/tests/review-churn-count.test.ts`, brackets the block
  with `# >>> name` / `# <<< name` markers and **throws if they are missing**.
- `scripts/review-decide.sh` exists (the label decision the reuse invariant is asserted against).

## Functional requirements

- **FR-1 Verbatim extraction.** The test extracts the reuse-selection step/block from
  `.github/workflows/ai-review.yml` between explicit markers and executes that text. It never
  restates the block. Missing, duplicated, or empty markers throw (red), never skip.
- **FR-2 Shell syntax.** The extracted step body passes `bash -n`. An unbalanced quote is a red test.
- **FR-3 Quoting property.** Every embedded `node -e '...'` body in the extracted block contains
  zero apostrophes. The test must find at least one such body (a count of zero bodies is red).
- **FR-4 Selector behaviour through the glue.** The extracted selector invocation is run with a
  stubbed `gh` returning a synthetic prior check-run, asserting:
  (a) a voter with a real verdict is reused;
  (b) a voter whose block is the fail-closed placeholder is NOT reused;
  (c) empty `AI_REVIEW_BOT_LOGINS` reuses nothing.
- **FR-5 Fingerprint input exists.** The test asserts that every file the selector fingerprints
  (the `ai-review-reuse.patch` class of defect) is written by an earlier step in the same
  block/job, so "referenced but never created" is red. Detection by running the block and
  asserting a non-null fingerprint reaches the selector.
- **FR-6 No laundering.** A reused block piped through `scripts/review-decide.sh` yields the
  same label as the same panel without reuse: a reused voter can never turn `changes` into
  `pass`. This is the highest-priority assertion.
- **FR-7 Mutation proof.** Each of FR-1..FR-6 has a recorded mutant (a deliberately broken copy
  of the workflow text) the test must fail on, executed in the test suite itself (mutate the
  extracted text in memory, re-run the same assertions, expect failure), so it stays proven and
  is not a one-off manual run. Mutants include: stray apostrophe; patch write removed; markers
  renamed (extraction matches nothing); `AI_REVIEW_BOT_LOGINS` fallback made permissive; reuse
  forced on a placeholder block; reuse path made to emit a `pass` input to `review-decide.sh`.
- **FR-8 Offline.** No network; `gh` is a stub on `PATH`. The test runs under plain `npx vitest`
  (CI runs vitest directly, not `npm test`, so no `pretest` hook may be relied on).

## Acceptance criteria

1. With the wiring present, the new test is green on head; each FR-7 mutant turns exactly the
   assertion(s) it targets red.
2. Deleting the markers, or the whole step, makes the test red with a message naming the missing marker.
3. Reintroducing either historical defect (apostrophe; unwritten patch file) is red.
4. The test file lands **in the same commit as the wiring** (see D1).
5. `npm run validate` and `npx vitest` pass.

## Invariants this must not break

- **No silent gate** (constitution invariant 2): the test fails closed and visibly if extraction
  matches nothing; a vacuous green is the failure mode under test.
- **Offline** (invariant 1): no network.
- **Blast radius** (invariant 3): the test touches only this repo's workflow text; it does not
  change reviewer behaviour or relax `selectVotersToRun` (DR-097, DR-104).
- Reuse stays confined to the same head SHA (DR-097); this spec only observes that, never changes it.

## Out of scope

Changing the selector, the workflow, or `review-decide.sh`; testing the other `node -e` steps in
`ai-review.yml` (D2 asks whether to widen).

## Decisions needed (Clarify)

**D1 - how to land without a red main.** The test cannot precede the wiring (red on main).
- (a) **(rec)** Same commit as the wiring, founder-pushed. Cost: the App cannot push workflow
  files, so the test rides a founder push and cannot be CI-validated by an agent PR beforehand.
- (b) Land the test now, skipped while markers are absent. Cost: a skip is exactly the silent
  gate invariant 2 forbids, and it would stay green if the wiring never arrives.
- (c) Land now, gated on a fixture copy of the wiring patch. Cost: tests a copy, not the live
  workflow, so it can drift from what runs.

**D2 - scope of extraction.** (a) **(rec)** Only the reuse-selection step, since that is the
untested wiring. Cost: other `node -e` steps (lines ~396, 1148, 1273, 1418...) stay un-`bash -n`ed.
(b) All `node -e` bodies in the workflow get the apostrophe check. Cost: may flag existing,
working steps that use other quoting, enlarging the change.

**D3 - marker mechanism.** Markers are comments inside the workflow (`# >>> reuse-select`),
which edits the founder-pushed file, vs. locating the step by `name:`. Recommend markers
(**rec**, matches #1840 pattern); cost: one more thing a future editor can delete, caught by FR-1.
