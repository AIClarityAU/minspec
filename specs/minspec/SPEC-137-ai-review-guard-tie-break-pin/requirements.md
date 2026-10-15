---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — a merge-gating witness whose tie behaviour is undocumented and unpinned is DR-066's silent-gate family
aspects: [ci, gates, ai-review, witness, tie-break, tests, tier-0]
relates_to: [DR-066, DR-063, SPEC-054, SPEC-079]
---

# MinSpec — Pin the ai-review guard's "most recent witness" tie-break (Requirements)

> Materializes **[#870](https://github.com/AIClarityAU/minspec/issues/870)** (filed from the
> scroogellm#81 parity work). Rests on [DR-066](../../../docs/decisions/DR-066.md) (No silent gate,
> constitution invariant 2). No new DR: the choice is reversible in under a day (one comparison
> operator plus tests), below the DR filter.

## One-Sentence Scope

Make the identical-timestamp tie-break of every "most recent witness" reducer in
`.github/scripts/ai-review-guard.js` an explicit, documented, test-pinned decision, so flipping it
can never again be a silent change.

## Context — what the issue claims vs. what `main` shows

Checked against `origin/main` at spec time (plausible-inference ≠ observation, CLAUDE.md):

| Issue claim | Observed |
|---|---|
| The reducer was `>` before #854 and silently became `>=` | **Not supported.** `git log -S"Date.parse(b.created_at) > Date.parse"` on the guard returns nothing; `>=` was introduced with the function itself (#466 / #776). The *tie-flip* is real as a latent property, but I found no commit that flipped it. |
| Reducer is at L227/L301 | Now `verifyHeadPassStatus` (~L1428) and `verifyHeadPassCheckRun` (~L1509), **plus a third site**: `latestHeadRound` (~L1031), same `checkRunTime(b) >= checkRunTime(a)` shape. |
| A test `on a tie … first-listed … wins` existed and was deleted | Not in `main`'s `ai-review-guard.test.js`; only a downstream copy had it. Nothing in `main` pins a tie today. |
| The four new witness fns have no tests | **Out of date.** `verifyHeadPassCheckRun`, `verifyHeadPassWitness`, `shouldAwaitApproval` have tests (`ai-review-guard.test.js` ~L517-650, #810). `checkRunTime` is not exported and is exercised only indirectly. **No test pins a tie** for any of them. |
| Test file is not shipped to siblings | **Out of date.** #871 (commit `0b253daa`) ships it as a parity-managed file (`scripts/gen-ci-templates.mjs` SOURCES). |

What remains true and is the real defect: the tie outcome differs by array order under `>=`
(tail wins on equal timestamps), the in-code comment ("the API returns newest-first, but be
explicit") describes an intent the code does not implement for ties, and nothing fails if the
operator flips. Direction today is fail-safe only by accident of operand order: with
`[success, failure]` at equal time the tail (`failure`) wins ⇒ red; with `[failure, success]` the
tail (`success`) wins ⇒ **green**. So `>=` is not deny-on-tie — it is "last-listed wins", and
GitHub's listing order is not a contract this guard documents.

## Functional Requirements

- **FR-1 — One decided tie rule, applied at all three reducers.** `verifyHeadPassStatus`,
  `verifyHeadPassCheckRun`, and `latestHeadRound` use the same documented rule for equal
  timestamps (see Decision DQ-1). No reducer keeps an unstated tie behaviour.
- **FR-2 — Rule is order-independent where the decision requires it.** If DQ-1 selects
  deny-on-tie, a tie containing any non-success candidate resolves to not-verified regardless of
  array order; the fix is a comparison that does not depend on listing order, not merely a
  flipped operator.
- **FR-3 — In-code documentation.** Each reducer carries a comment stating the tie rule and why,
  replacing the misleading "newest-first, but be explicit" line.
- **FR-4 — Tie tests, both orders, all three reducers.** For each reducer: a test with equal
  timestamps, `[success, failure]` and `[failure, success]`, asserting the chosen outcome. At
  least one per reducer must go red if the comparison operator is flipped (mutation-checked).
- **FR-5 — `checkRunTime` pinned.** Direct tests (export it, or equivalently exercise through the
  public fns) for: `completed_at` preferred over `started_at`, fallback to `started_at`,
  unparseable/missing ⇒ never "latest", and tie handling when both are `-Infinity`.
- **FR-6 — Downstream re-sync is the forcing function, not extra work.** The guard and its test
  are already parity-managed, so siblings go red on `minspec-ci-parity` until re-synced; this
  spec adds no new sync mechanism and edits no sibling repo.

## Invariants (must not break)

1. Constitution inv. 2 — the change may only make the gate stricter or equal on ambiguity; a
   missing/unparseable timestamp still never wins as "latest" and never verifies.
2. No existing guard test changes meaning; the "later failure supersedes earlier success, either
   array order" tests stay green.
3. Provenance checks (allowlist, SHA match, completed/success strictness) are untouched.
4. Tier 0 — no network, no new dependency.
5. `ai-review-guard.js` is a machinery file: the implementing PR needs the human `--admin` merge
   path; this spec does not change that.

## Acceptance Criteria

- AC-1: Swapping the tie operator in any one of the three reducers fails at least one test.
- AC-2: For equal timestamps, both array orders yield the same verdict at every reducer (if
  DQ-1 = deny-on-tie), or the documented winner (if DQ-1 = another rule).
- AC-3: A grep of the guard for the old comment returns nothing; each reducer's comment names the
  tie rule.
- AC-4: `checkRunTime` cases in FR-5 are asserted.
- AC-5: `npm test`, `npm run validate`, `npm run lint` pass; `minspec-ci-parity` on siblings is
  expected red until re-sync, per FR-6.

## Decisions needed (Clarify)

**DQ-1 — What wins an identical-timestamp tie?**

- **(a) Deny-on-tie, order-independent (rec).** Any non-success among tied-latest candidates ⇒
  not verified. Matches DR-066's closed-fail posture and removes dependence on API ordering.
  *Cost:* a legitimate same-second success after a failure (re-review in the same second) is
  denied until the next distinct-timestamp event; at one-second resolution that is rare but
  non-zero, and costs a re-run.
- **(b) Keep `>=` (last-listed wins), document it.** Zero behaviour change. *Cost:* the outcome
  stays hostage to GitHub's listing order and can verify (`[failure, success]`) on a tie — the
  weaker, less defensible rule; only "documented", not "safe".
- **(c) Restore `>` (first-listed/newest-first wins).** Matches the deleted downstream test.
  *Cost:* relies on an undocumented API ordering and can verify on a tie when the head is a
  success.

**DQ-2 — Orphan stale test copies in sibling repos** (issue's "adjacent cleanup"). The test is
now managed, so sibling copies are overwritten on re-sync. Options: (a) **(rec)** nothing here —
the parity re-sync replaces them; *cost:* an un-wired stale copy lingers until each sibling
re-syncs; (b) file a cleanup issue per sibling. Sibling repos are outside this repo's blast radius.

## Out of Scope

- Editing `scroogellm` / `sealbox` copies (their re-sync is FR-6).
- Changing `verifyPassProvenance`, `decideStatus`, or any label/provenance logic.
- Broader audit of other `reduce` selectors in the guard (none found beyond the three named; a
  new one is covered by AC-1's pattern, not by this spec).

## Alternatives considered and rejected

- *Do nothing, close as fail-safe.* Rejected: `[failure, success]` ties verify today, so the
  "fails safe" premise holds only for one array order.
- *Pin an App-id or ordering contract from the GitHub API.* Rejected: undocumented guarantee;
  same class of brittle pin as #560.

## Traceability

- **Issue:** [#870](https://github.com/AIClarityAU/minspec/issues/870).
- **Rule:** [DR-066](../../../docs/decisions/DR-066.md) No silent gate; related gate-signal
  linter [SPEC-054](../SPEC-054-gate-signal-linter/requirements.md).
- **Managed-file parity (FR-6):** #871 (`0b253daa`); drift family
  [SPEC-079](../SPEC-079-managed-parity-localization-drift/requirements.md).
- **Witnesses under test:** #466/#776 (status), #810 (check-run).
