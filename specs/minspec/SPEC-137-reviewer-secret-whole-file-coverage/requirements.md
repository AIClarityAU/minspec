---
id: SPEC-137
type: requirements
status: specifying
tier: T2
product: minspec
epic: EPIC-009  # Team Readiness — guardrails a shared repo must carry
relates_to: [SPEC-033, SPEC-034, SPEC-054, "#825", "#796", "#819", "#559", "#666"]  # SPEC-033 FR-4 is the checklist this makes derived · SPEC-034 will change the secret set · #819/#796 are the partial gate this completes
---

# MinSpec — Whole-file reviewer-secret coverage + one shared activation constant — Requirements

Issue: [#825](https://github.com/AIClarityAU/minspec/issues/825). Builds on the partial gate from #819 (the #796 follow-up). No DR: nothing here is hard to undo in under a day.

## Problem

The set of secrets the AI reviewer needs is written out by hand in several places:

1. `ai-review.yml` — the guard step's `env:` block.
2. `ai-review.yml` — the `if [ -z ... ]` test in that guard.
3. `ai-review.yml` — the `::notice::` text an operator reads when the reviewer is skipped.
4. `ai-review.yml` — the `ACTIVATION` header comment.
5. SPEC-033 FR-4 — the activation checklist.
6. `REVIEWER_SECRETS` in `ruleset-advisor.ts` — the constant the probe uses.

`packages/minspec/tests/reviewer-secrets-enforcement.test.ts` (#819) binds only the `secrets.*` references to the constant. Places 2, 3, 4 and 5 can go stale with every test green. The failure: a secret is renamed, the constant and guard are updated, but the notice or checklist still names the old one. An operator follows the stale text, sets a wrong-named secret, the guard sees an empty value and skips with a notice, and `ai-review` is required but never produced: every merge deadlocks (the #559 shape). SPEC-033 FR-4 already records one real instance of this drift (#666, the `AI_REVIEW_BOT_LOGINS` rename).

## Functional requirements

- **FR-1 — Whole-file coverage.** The enforcement test asserts that every name in `REVIEWER_SECRETS` appears in each of: the guard step's `env:` block, the `if [ -z ... ]` test, the `::notice::` string, and the `ACTIVATION` header comment of `ai-review.yml`.
- **FR-2 — Both directions.** For each of those four places, a secret-shaped name found there that is not in `REVIEWER_SECRETS` or `REVIEWER_OPTIONAL_SECRETS` also fails the test. A stale name is as much a defect as a missing one.
- **FR-3 — Shipped copy.** FR-1 and FR-2 apply equally to the embedded `AI_REVIEW_WORKFLOW` copy the extension scaffolds into other repos, so an initialised repo gets correct instructions.
- **FR-4 — Single source for the checklist.** SPEC-033 FR-4's secret list is not hand-copied. One shared constant is the source (see Decisions needed), and the checklist is derived from it. A test fails if the derived output and the source disagree.
- **FR-5 — Fail visibly.** If the test cannot find a region (header, env block, guard, notice), it fails with a message naming the region. A missing region never reads as "nothing to check" (constitution invariant 2).
- **FR-6 — Offline.** The test reads local files only.

## Acceptance criteria

- **AC-1** Renaming one secret in the constant only, with the workflow untouched, turns the test red and names the place that is stale (FR-1).
- **AC-2** Leaving the old name in the `::notice::` string, or in the `ACTIVATION` header, after renaming everywhere else turns the test red (FR-2).
- **AC-3** The same two mutations applied to `AI_REVIEW_WORKFLOW` turn the test red (FR-3).
- **AC-4** Changing the shared constant changes the rendered FR-4 checklist with no other edit, and a hand-edited copy of the list turns the test red (FR-4).
- **AC-5** Deleting the `ACTIVATION` header, or reshaping the guard so a region cannot be located, fails with a named-region message rather than passing (FR-5).
- **AC-6** On the current tree the test passes, and the `secrets.*` assertions from #819 still run unchanged.

## Invariants

- **INV-1** No silent gate: a missing region or unreadable file fails the test (constitution invariant 2).
- **INV-2** No network and no new dependency (constitution invariant 1).
- **INV-3** The gating and optional secret sets stay disjoint, and the existing probe behaviour is unchanged.
- **INV-4** No change to the runtime behaviour of `ai-review.yml`; only its enforcement tests and the checklist's source change.

## Decisions needed (Clarify)

1. **Where does the single source live?**
   - **(a, rec) A TS export beside `REVIEWER_SECRETS`.** The test checks the `ACTIVATION` header against it. Cost: the header comment remains hand-written prose, kept honest by the test and not generated.
   - (b) The workflow's `ACTIVATION` header is the source, and the test parses it. Cost: parsing free-form comments is fragile, and a reshaped header would break the parser (it fails visibly by FR-5, but it is churn).
2. **What does "render FR-4's checklist" produce?** FR-4 describes a runtime checklist, yet no extension code that presents one was found under `packages/minspec/src` outside `ruleset-advisor.ts` (an inference from grep for `MINSPEC_APP_ID`, not read end to end).
   - **(a, rec) Test-only.** The constant plus a test binding SPEC-033 FR-4's prose to it. Cost: the checklist stays prose in the spec and is only checked.
   - (b) Also build a generated checklist surface now. Cost: new UI scope, which belongs with SPEC-033's own implementation.
3. **Ordering with SPEC-034.** It will shrink the secret set (broker, no per-repo PEM). Does this land first (rec, so the guard exists when the set changes; cost: one small rework when SPEC-034 ships), or wait for SPEC-034 (cost: the deadlock class stays open meanwhile)?
