---
id: SPEC-212
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - DR-066 clause 1 enforcement coverage
aspects: [ci, gates, no-silent-gate, lint, workflows, tier-0, offline]
depends_on: [DR-066]
relates_to: [SPEC-054, "#1986", "#1980", "#1859", "#2671", "#2389", DR-079]
implements: none
implements_reason: >-
  Extends the existing clause-1 lint (scripts/check-swallowed-gate-signal.ts and
  scripts/lib/swallowed-gate-signal.ts), which no spec owns; the sibling SPEC-054 is a
  different linter (gate-manifest) and owning shared lint files here would freeze them.
affects: [scripts/check-swallowed-gate-signal.ts, scripts/lib/swallowed-gate-signal.ts, .github/workflows/]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec - Clause-1 lint coverage of workflow `run:` bash (Requirements)

> Materializes [#1986](https://github.com/AIClarityAU/minspec/issues/1986). Rests on
> [DR-066](../../../docs/decisions/DR-066.md) clause 1 (no load-bearing gate signal written
> with a swallowed error). No new DR: the lint's rule is unchanged, only the set of sources
> it reads grows.

## One-Sentence Scope

Make the DR-066 clause 1 lint read the shell inside `.github/workflows/*.yml` `run:` steps
with the same matcher it already applies to `scripts/**/*.sh` and `package.json` scripts, and
fail closed when it cannot read a workflow.

## Background (verified at origin/main)

- The lint scans `*.sh` under `scripts/` and the `scripts` object of every workspace
  `package.json` (#2671). `main()` in `scripts/check-swallowed-gate-signal.ts` has no
  workflow path, so a swallow inside YAML is structurally invisible.
- The issue's named instance (`ci.yml` badge step: `TEST_OUTPUT=$(npx vitest run 2>&1 || true)`
  then `[ "$PASSED" = "$TOTAL" ]`, green when vitest never started) is **already fixed**:
  the `ci.yml` comment cites #2389 and says it now uses the exit status and a JSON report and
  fails the step on an unreadable report. So this spec is about the **coverage gap**, not that
  line. Whether other workflow instances exist is unknown: `|| true` appears in `ai-review.yml`
  (37), `docs-lane.yml` (7), `ai-review-retry.yml` (5), `approve-on-label.yml` (2), `ci.yml` (2),
  `main-red-watch.yml` (1), `secret-scan.yml` (1) - a count of the token, not of findings.
  Triage of real findings is FR-6.
- No YAML parser dependency exists in the root or package manifests (grep of `package.json`
  files for `yaml`/`js-yaml`: none). Dependency budget for a T3 is 2-3 (role rules).

## Functional Requirements

- **FR-1 Extraction.** For every `.github/workflows/*.yml` (and `.yaml`), extract each step's
  `run:` value as a shell fragment, with its YAML block-scalar indentation removed and a
  mapping from fragment line back to the workflow file line.
- **FR-2 One matcher.** Each fragment is passed through `findSwallowedGateSignals` unchanged;
  no second definition of "swallowed" or "decides". Findings report `file:line` in the
  **workflow file's** coordinates.
- **FR-3 Expressions.** `${{ ... }}` GitHub expressions inside a fragment are neutralised to a
  same-length inert token before matching, so they neither hide a swallow nor create a false
  paren/quote imbalance in the matcher's statement splitter.
- **FR-4 Markers.** `# swallow-ok: <reason>` and `# swallow-known: #NNNN <reason>` work inside
  a `run:` block exactly as in `.sh` files, with the same effect (annotated = non-fatal).
- **FR-5 Fail closed.** An unreadable workflow file, a workflow directory with zero workflow
  files, a YAML parse failure, or a `run:` the extractor cannot classify is a RED naming the
  file - never a skip. A scan that extracted zero fragments from a directory that has workflows
  with `run:` steps is also RED (a broken extractor must not look like a clean tree).
- **FR-6 Landing triage.** Before the check becomes enforcing, every finding in the current
  workflows is classified: fixed, `swallow-ok` with reason, or `swallow-known` with an issue.
  Workflow edits need a human (App installation lacks `workflows` permission, host DR-079);
  the PR lists them as a human action item.
- **FR-7 Enforcement path.** Enforced through the same merge-blocking vitest wrapper as today
  (CI runs `npx vitest run`, not `npm test`), not a new workflow step.
- **FR-8 Self-witness.** Tests include a fixture workflow containing the issue's exact
  `ci.yml` pre-#2389 shape and assert it is flagged, and a control with the exit status
  retained that is not.

## Acceptance Criteria

1. Running the lint on a tree containing the pre-#2389 badge step exits 1 and prints
   `ci.yml:<line>` pointing at the YAML line.
2. The same step with `# swallow-ok: <reason>` exits 0 for that finding.
3. A `run: |` block with `${{ github.ref }}` and a quoted capture does not misparse.
4. Deleting `.github/workflows/` contents or feeding malformed YAML makes the check exit 1.
5. Current tree: check exits 0 only after FR-6 triage; findings are listed in the PR.
6. A mutation test: disabling the extractor (returning no fragments) turns FR-5's zero-fragment
   guard red.

## Invariants

- Constitution #1 offline: no network. #2 no silent gate: FR-5 is the clause applied to the
  lint itself. #3 blast radius: the lint scans this repo's workflows only; it is not shipped
  into adopters unless a separate decision says so.
- Existing `.sh` and `package.json` behaviour unchanged (regression-tested by existing tests).

## Non-goals

- Fixing workflow findings in-session (human, DR-079). Extending to other YAML (composite
  actions) - see DQ-3. Judging `if:`-gated steps' severity.

## Decisions needed (Clarify)

- **DQ-1 Extractor.** (a) hand-rolled line scanner for `run:` / `run: |` / `run: >` blocks
  **(rec)**: zero dependencies, offline, ~60 lines; cost: a second parser with its own bugs
  (flow scalars, anchors, quoted multi-line `run:` can be missed, which FR-5 only partly
  catches). (b) add a YAML library: correct parsing, but a new dependency (budget 1 of 2-3) and
  line-mapping is harder because parsers drop block-scalar positions. (c) hybrid: library for
  structure, own code for line mapping - most robust, highest cost.
- **DQ-2 Landing.** (a) triage all findings in the same PR and enforce immediately **(rec)**;
  cost: PR may need a human workflow edit before it can be green. (b) land enforcing with
  `swallow-known` on every existing finding, fix later; cost: bulk-annotated debt that hides
  real defects (the pattern DR-066 was written against).
- **DQ-3 Scope.** Also scan `.github/actions/**/action.yml` composite `run:` steps and
  `.githooks`? Recommend yes for composite actions only if any exist today (unverified here);
  otherwise leave as a follow-up. Cost of widening: scope creep (CLAUDE.md triage rule 2).
