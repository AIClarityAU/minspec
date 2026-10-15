---
id: SPEC-138
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology — code-change safety: the suite is the refactor-confidence gate
aspects: [testing, coverage, mutation-testing, refactor-safety, ci-gate]
relates_to: ["#695", DR-003, SPEC-001]
# Ownership is deliberately NOT declared yet: which files a ratchet baseline, harness and
# mutation report occupy depends on the answers under "Decisions needed (Clarify)". It is
# declared when those are settled and before approval mints a hash (SPEC-038).
---

# SPEC-138: Test-protection hardening

Issue: #695 (test-protection hardening — per-file coverage ratchet, sub-70% files, one-off
mutation pass, reduce own-module mocking). Verified by the 2026-07-13 audit named there.

**Scope sentence.** Make the existing test suite a trustworthy refactor-confidence gate by
(a) stopping per-file coverage regression, (b) reducing tests that mock the project's own
modules, (c) measuring real assertion strength once with mutation testing, and (d) silencing
one expected stderr line that trains readers to skim red output.

**Status of the numbers.** The figures below are the audit's (2026-07-13), quoted from the
issue and **not re-measured** for this spec. Every one is re-measured at implement time
(FR-1 baselines are generated, never typed from this document).

## Problem

1. **Gate is project-wide, not per-file.** `vitest.config.ts` (thresholds block, ~line 55-62)
   applies `minCoverage` (from `.minspec/config.json`) to the project total only, and its
   comment records that several files sit far below any reasonable bar. Audit lows:
   `epic-dnd-controller.ts` 21.7% statements (0% branches), `diagnostics.ts` 26.3%,
   `commands/constitution.ts` 47.4%, `git-analyzer.ts` 61.3%, `spec-panel.ts` 61.3%,
   `bridge.ts` 67.1%. Worst risk x coverage: `git-analyzer.ts` (399 LOC, feeds classifier
   signals). A new file at 0% or a regression to an old one passes while the total stays
   above the bar.
2. **Own-module mocking.** 27 of 133 unit test files `vi.mock` the project's own `src`
   modules (`lib/config` 8x, `resolve-folder` 7x, `spec-tree-provider` 7x, `epic-manager`
   7x). Such tests fail on behaviour-preserving restructures, so the suite stops saying
   "what broke, and nothing else".
3. **Coverage is an unverified upper bound.** No mutation testing exists, so 92% statement
   coverage says what ran, not what is asserted.
4. **Noise.** Every run prints `fatal: Invalid symmetric difference expression
   deadbeef...HEAD` to stderr while passing.

## Functional requirements

**FR-1 Per-file ratchet.** A check fails when any in-scope source file's coverage falls
below its recorded floor, or when a file with no recorded floor falls below the project
minimum (new files are not grandfathered). Floors are generated from a measured coverage
run and committed. In scope = the files vitest's `coverage.include` already covers.
Metrics ratcheted: at least statements and branches.

**FR-2 Fail visibly, never best-effort.** A missing, unparsable or stale baseline, or a
missing coverage report, FAILS the gate with a message naming the cause. It never skips,
never passes on an empty comparison, and the check is not wired with `|| true`
(constitution invariant 2). The failure output lists each offending file, its floor and
its measured value.

**FR-3 Floors move only upward by default.** Regenerating the baseline raises floors and
removes entries for files that reach the project minimum; lowering a floor requires an
explicit, reviewable flag whose use is visible in the diff of the baseline file. A file
that is deleted or renamed has its entry removed by the same regeneration.

**FR-4 Independent second witness.** The ratchet runs in CI as a required-style check on
the same invocation CI actually uses (`npx vitest`, not `npm test`; a `pretest` hook does
not run in CI), and is also runnable locally with one command. The two share one comparison
implementation (no duplicate predicate).

**FR-5 Raise the worst files.** Add tests lifting each audit-listed file to at least the
project minimum, or record per file why it is exempt. Order by risk: `git-analyzer.ts`
first. New tests assert behaviour, not just execution (see FR-8).

**FR-6 Shared vscode-boundary mock harness.** Provide one test-support module that fakes
only the `vscode` boundary (and other true external edges: process, network, clock).
Commands under test call the real `lib/*` against temporary-directory fixtures, the
pattern already used by the approval-store and wasted-review tests.

**FR-7 Migrate own-module mocks.** Convert the 27 files that mock own `src` modules to the
harness, starting with the most-mocked modules. A file may keep an own-module mock only
with a one-line stated reason in the test (e.g. a module that does network or spawns a
process). A guard test or lint rule fails on a new unannotated own-module `vi.mock`.
Migration is behaviour-preserving: no test is deleted to make the count fall.

**FR-8 One-off mutation pass.** Run a mutation tool over `packages/shared` and the five
highest-churn `lib` files (churn measured from git history at run time, not asserted
here). Output a committed report: per file mutation score, and the list of surviving
mutants grouped by file. This is a measurement, not a gate: no threshold is enforced and
it is not added to CI (see Decision D-2).

**FR-9 Act on survivors, bounded.** Surviving mutants that reveal an untested decision
become new assertions, up to a stated budget; the rest are filed as issues, each linked
from the report (DR-023 follow-up rule). Nothing is left as prose-only.

**FR-10 Quiet the expected stderr.** The negative-path test that provokes
`Invalid symmetric difference expression deadbeef...HEAD` captures the child's stderr
and asserts on it, so a normal run prints nothing for it. The test must still fail if the
error stops being raised (assert the captured text, do not merely swallow it).

## Acceptance criteria

- **AC-1** Dropping one audited file's coverage below its floor (e.g. deleting a test) makes
  the ratchet exit non-zero naming that file; restoring it exits zero. (FR-1, FR-2)
- **AC-2** A brand-new source file with no tests and below the minimum fails the check. (FR-1)
- **AC-3** With the baseline file removed, corrupted, or the coverage report absent, the
  check exits non-zero with a cause message; none of these passes. (FR-2)
- **AC-4** Regenerating the baseline after adding tests raises floors and never lowers one
  without the explicit flag. (FR-3)
- **AC-5** CI runs the ratchet under the same command shape as the coverage job. (FR-4)
- **AC-6** Each audit-listed file is at or above the project minimum or has a recorded
  exemption. (FR-5)
- **AC-7** The count of test files mocking own `src` modules, measured by the guard's own
  matcher, is below 27 and every remaining one carries a reason; adding an unannotated one
  fails the guard. (FR-6, FR-7)
- **AC-8** A mutation report is committed with per-file scores and survivor lists, every
  survivor either killed by a new assertion or linked to a filed issue. (FR-8, FR-9)
- **AC-9** A full `npm test` run prints no `fatal: Invalid symmetric difference` line, and
  reverting the production behaviour that raises it fails the test. (FR-10)

## Invariants the change must not break

- **Offline (constitution invariant 1).** Nothing here calls the network; the mutation tool
  runs locally on checked-in code.
- **No silent gate (invariant 2).** FR-2 is the load-bearing requirement; a ratchet that
  skips on a missing input would be the failure it exists to prevent.
- **Blast radius (invariant 3).** The ratchet, harness and mutation tooling are
  dev-time for this monorepo. They must not be shipped in the `.vsix`, scaffolded into
  adopter repos, or alter behaviour of a repo without `.minspec/`.
- **Suite stays fast.** The audit measured ~12s; the ratchet adds no second full test run
  (it reads the existing coverage output).
- **No test deleted to pass** the guard or raise a percentage.

## Out of scope

- Raising the project-wide minimum itself (`.minspec/config.json`).
- A permanent mutation-testing CI gate (parked; see D-2).
- Rewriting tests that mock genuine external edges.

## Decisions needed (Clarify)

**D-1 Ratchet mechanism.**
- (a) **Committed baseline JSON + small comparison script (rec)** — exact, grandfathers
  current lows, shows regressions as diffs. Cost: a new script and a baseline file that
  every coverage-moving PR may touch (merge-conflict surface under ~15 concurrent
  sessions).
- (b) vitest native `coverage.thresholds` glob/per-file entries — no new script. Cost:
  thresholds live in config as hand-typed numbers, a per-file `perFile: true` would fail
  today's lows, and per-glob entries are coarse and easy to loosen silently.

**D-2 Mutation testing: one-off or permanent.** Issue asks one-off. Options:
- (a) **One-off report, no CI (rec)** — cheap, no new required check. Cost: scores rot; no
  protection against later decay.
- (b) Also add a scheduled (non-gating) run. Cost: new CI workflow (outside this spec's
  allowed paths; needs a human merge) and a dev dependency.
Either way Stryker (or equivalent) is a **new dev dependency**: confirm it fits the
dependency budget for a complex change (2-3), or run it via `npx` without adding it.

**D-3 Baseline scope.** Ratchet statements+branches only **(rec)**, or all four metrics
(adds functions, lines). Cost of recommending two: a regression in functions/lines alone
is not caught.

**D-4 Delivery split.** One spec, but three independently mergeable slices — ratchet
(FR-1..5), mock-harness migration (FR-6..7), mutation + stderr (FR-8..10) — **(rec)**, vs
one PR. Cost of splitting: three review cycles and the ratchet lands before the files it
grandfathers are improved. Cost of one PR: a very large, hard-to-review diff touching 27
test files.

**D-5 Spec id.** `SPEC-137` is referenced as a "spirit" in SPEC-051's risk table
(R5) with no spec of that number on disk, so this spec takes `SPEC-138` to avoid
silently resolving that old reference to unrelated content. If SPEC-137 was meant to be
this spec, renumber before approval.

## Follow-ups (tracked)

- Mutation survivors not killed in FR-9: filed at implement time, linked from the report.
- A permanent mutation gate: not filed; decided by D-2.
