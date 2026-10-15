---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — ai-review / ready-to-merge gate integrity
aspects: [ci, gates, ai-review, ssot, deadlock, fail-closed]
relates_to: [SPEC-054, DR-066, DR-005, DR-003]
implements: []
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Single source of truth for ai-review verdict labels and the pass-status context (Requirements)

> Materializes **[#822](https://github.com/AIClarityAU/minspec/issues/822)** (A3 + A4 of the #796
> drift survey; parked from PR #819). Same defect class as the #796 / #559 "2-of-3 secrets"
> deadlock: an enumeration re-typed across files that only agrees by the author's memory.
> No DR is required for this spec; the choice of mechanism (Decisions D1) is reversible in under a day.

## One-Sentence Scope

Make `.github/scripts/ai-review-guard.js` the only place the verdict-label literals and the
pass-status context are *defined*, make the shell and workflow producers *read* them from it, and add
a vitest that fails the build when any producer file carries a literal outside that set.

## Context

The verdict label set and the SHA-bound status context are typed by hand in four languages:

| Constant | SSOT today | Re-typed literally in |
|---|---|---|
| `PASS='ai-review:pass'` | `ai-review-guard.js:33` | `scripts/review-decide.sh` (:83–:217), `scripts/dispatch-issue.sh` (:1299–:1828), `.github/workflows/ai-review.yml` (:256–:1274) |
| `CHANGES='ai-review:changes'` | `ai-review-guard.js:34` | same three files |
| `BLOCKED='ai-review:blocked'` | `ai-review-guard.js:53` | same, plus `.github/workflows/ai-review-retry.yml:65` |
| `PENDING='ai-review:pending'` | `ai-review-guard.js:1893` | `ai-review.yml:256,274` |
| `CARRIED='ai-review:carried'` | `ai-review-guard.js:839` | `ai-review.yml:266,273` (**not in the issue's set — see FR-6**) |
| `PASS_STATUS_CONTEXT='ai-review/pass'` (slash, not colon) | `ai-review-guard.js:40` | `ai-review.yml:1333` (`-f context="ai-review/pass"`) |

**Failure mode (deadlock, fail-closed).** Rename `guard.PASS` and leave a producer: the producer
applies the old label, `ready-to-merge` (which reads `guard.PASS`) never recognises it, no PR merges.
**A4 (colon/slash):** a one-character slip in the `-f context=` string leaves
`verifyHeadPassStatus` (`ai-review-guard.js:1425`) with no head-SHA witness, so `ready-to-merge` is
red on a genuine pass. Both are loud (nothing merges) rather than silent-green, hence fail-closed,
but they are an outage with no signal pointing at the cause.

**Current gate: none.** The template byte-fidelity gate checks copy fidelity of shipped files, not
cross-file literal agreement. `ai-review-guard-test-parity.test.ts` covers test parity only.

## Functional Requirements

- **FR-1 (guard exports the full set).** `ai-review-guard.js` exports `PASS`, `CHANGES`, `BLOCKED`,
  `PENDING`, `CARRIED`, `PASS_STATUS_CONTEXT` (verify which already are; `VERDICT_LABELS` exists at
  `:1894`). Adding any missing export is the only change to the guard.
- **FR-2 (shell reads, never types).** `review-decide.sh` and `dispatch-issue.sh` obtain every verdict
  label from the guard (`node -e 'process.stdout.write(require(GUARD).PASS)'` or one helper that
  emits all, resolved once per script) instead of echoing a literal. If the node call fails or yields
  an empty/non-`ai-review:`-prefixed value the script **fails closed** — emits the strict verdict or
  exits non-zero, never an empty label and never a hard-coded fallback (constitution invariant 2: no
  swallowed error on a load-bearing signal).
- **FR-3 (workflow reads, never types).** `ai-review.yml` and `ai-review-retry.yml` take label names
  and the `-f context=` value from the guard (per the mechanism chosen in D1). The `case` arms at
  `ai-review.yml:806–808` and `:1273` are the sensitive sites: they must be built from the sourced
  values, not literals.
- **FR-4 (drift test).** A vitest `require`s the guard and scans the producer files
  (`scripts/review-decide.sh`, `scripts/dispatch-issue.sh`, `.github/workflows/ai-review.yml`,
  `.github/workflows/ai-review-retry.yml`, plus any file the scan discovers — see FR-5):
  (a) every distinct `ai-review:[a-z]+` token ∈ `{PASS, CHANGES, BLOCKED, PENDING, CARRIED}` read from
  the guard; (b) every `context="…"` / `context=…` value on a commit-status write equals
  `PASS_STATUS_CONTEXT`. The set is read from the guard, never re-typed in the test.
- **FR-5 (discovery, not a fixed list).** The scanned file set is found by glob over `scripts/**`
  and `.github/**` rather than a hand-kept list, so a new producer cannot escape the test by being
  absent from it (the same model-trusted-enumeration defect this spec removes). Prose and comment
  occurrences are either excluded by rule or must also match the set; the rule is stated in the test.
- **FR-6 (carried label).** `ai-review:carried` is a real producer-side label absent from the issue's
  set; it is included in the allowed set (FR-4a) — see D2.
- **FR-7 (tests-first proof).** The test is demonstrated red against a mutated producer (a renamed
  label, and a colon-for-slash context) before the producers are converted, and green after.

## Acceptance Criteria

- **AC-1.** Changing `PASS` in the guard to a new value makes no producer file hold a stale
  literal: the drift test stays green only if the producers read it. (Proves FR-2/3/4.)
- **AC-2.** Editing `ai-review.yml:1333` to `context="ai-review:pass"` fails the drift test.
- **AC-3.** Adding `echo "ai-review:passed"` to any scanned file fails the drift test.
- **AC-4.** With the guard unloadable, `review-decide.sh` does not print a passing label and
  `ai-review.yml` does not apply one; the failure is visible in the log.
- **AC-5.** Existing `ai-review-guard.test.js`, `ready-to-merge` and `ai-review` workflow behaviour
  unchanged for the current label values (no value changes in this work).
- **AC-6.** `npm test`, `npm run validate`, `npm run lint` pass.

## Invariants

- **Invariant 2 (No silent gate).** Neither the node read nor the test may swallow an error; absence
  of the guard fails closed and visibly. No `|| true` on the label read.
- **Invariant 3 (blast radius).** Changes touch only this repo's own gate files; nothing shipped to
  adopters changes unless a file is in the shipped template set (see Risks).
- **Invariant 1.** No network call introduced; `node` reading a local file only.
- Label and context **values do not change** — this is a refactor; existing labels on live PRs
  keep working.
- `ai-review.yml` runs from the PR head while `ready-to-merge` runs the base's guard
  (`ready-to-merge.yml:144`): the conversion must not create a window where the two read different
  values (FR-3 / D1).

## Decisions needed (Clarify)

- **D1 — How do workflow steps read the guard?**
  (a) **`actions/github-script` / `node -e` in a step after checkout** **(rec)** — no new
  dependency, reads the checked-out guard; cost: every consuming step needs a checkout and a node
  step, and the PR-head vs base asymmetry above must be handled (a PR editing the guard would feed
  its own labels to its own producer).
  (b) Generate a small constants file at build time and have the YAML `source` it — simpler YAML,
  but a second generated artifact that can itself drift.
  (c) Leave YAML as literals and rely on the drift test alone (FR-4 only) — smallest change, but
  still re-types the set in 4 languages; the test then *is* the whole gate.
- **D2 — Is `ai-review:carried` a verdict label?** It is excluded from `VERDICT_LABELS`
  (`:1894`) by design (it annotates, not decides). Options: include it in the drift allowed set but
  not in `VERDICT_LABELS` **(rec)**, cost: the allowed set in the test is "verdict labels + annotation
  labels", two lists to keep in the guard; or widen `VERDICT_LABELS`, which changes the
  exactly-one-survives semantics and is out of scope here.
- **D3 — Scope split.** One PR covering both A3 (labels) and A4 (status context) **(rec)**, cost: a
  larger machinery diff to hand-merge; or two PRs, cost: the context fix is a one-line change that
  rides alone for no benefit.
- **D4 — Is any converted file machinery?** `.github/workflows/*` edits are machinery-class and merge
  by human `--admin`; confirm before Plan that D1(a) is acceptable on that basis.

## Risks

- Converting `ai-review.yml` while it runs from the PR head means the PR that lands this change is
  reviewed by the *old* workflow; the first post-merge PR is the real test.
- A scan that includes prose/comments would flag existing explanatory text (e.g.
  `ai-review.yml:49`, `:140`); FR-5's exclusion rule must be precise or the test is noisy and will be
  disabled.
- `ai-review-guard.js` may be a byte-synced template copy; if so the shipped copy and its parity test
  must change together (not verified here — confirm at Plan).

## Out of Scope

- Changing any label or context value; renaming the `slash` vs `colon` convention.
- Other model-trusted enumerations from the #796 survey (separate issues).
- The `ai-review` check-run name (`CHECK_NAME`), already a guard constant.

## Traceability

Issue #822 · parent drift survey #796 / PR #819 · sibling deadlock #559 · related SPEC-054
(gate-signal linter, same "enforce, don't trust" class) · DR-066 (No silent gate) · DR-003 (RCDD).
