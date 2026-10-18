---
id: SPEC-141
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - a gate that cannot see the tests cannot defend them
aspects: [typecheck, tests, ci, no-silent-gate, required-check, red-then-green]
depends_on: []
relates_to: ["#1878", "#1742", "#1424", SPEC-071, SPEC-080]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). The two NEW
# files are the test-scoped tsconfig and the red-then-green test. Modified, not owned:
# the root package.json (script), ci.yml (step) and the required-check set (machinery).
implements: [packages/minspec/tsconfig.tests.json, packages/minspec/tests/typecheck-tests.test.ts]
affects: [package.json, .github/workflows/ci.yml]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-141: Typecheck `packages/*/tests/**`

Issue: #1878 (surfaced by the review of #1742). Status: **specified, not built.**

## Scope

One sentence: make a TypeScript error in any file under `packages/*/tests/**` fail CI.

## Problem

On #1742 a test file imported `ChangedFile` and `ClassificationSignal` from modules that
do not export them. 261 tests passed, lint reported 0 errors, build was clean; a direct
`tsc --noEmit` on that one file gave two `TS2459` errors.

## Root cause (mechanism + missing gate)

Verified against the tree at the time of writing:

- `packages/minspec/tsconfig.json` has `include: ["src/**/*.ts"]` and `rootDir: "src"`;
  `packages/shared/tsconfig.json` is the same shape. Tests are outside both.
- `npm run typecheck` (`package.json:23`, CI step "Typecheck", `ci.yml` ~line 105, added by
  #1424) runs `tsc --noEmit -p` on exactly those two configs, so it also skips tests.
- `packages/minspec/tsconfig.test.json` exists but includes only `src/test/**` (mocha
  types); it matches no file today and is not the missing gate.
- The root `tsconfig.json` has no `include`, but nothing invokes it.
- vitest/esbuild strip `import type` before execution, so the defect cannot fail at runtime.
- eslint does no type-aware resolution of these imports.

The gate that should have rejected it is a typecheck whose input set includes the tests.
The #1424 comment says "nothing else typechecks the source"; the same sentence holds for
the tests, and #1424 fixed only half of it.

Backlog, measured once and NOT trustworthy: a throwaway root-extending config over
`packages/*/tests/**/*.ts` gave 2565 errors across 414 files, but 1180 are TS2307 (module
not found) and 470 TS2580 (node/vitest types not resolved), i.e. the throwaway config's own
type resolution, not real defects. The real backlog is therefore unknown and likely far
smaller; FR-3 and FR-5 make the plan produce a correctly resolved count first.

## Functional requirements

- **FR-1** A new tsconfig (proposed `packages/minspec/tsconfig.tests.json`, extending the root)
  covers `packages/*/tests/**/*.ts` with `noEmit`, so no test file enters the emitted build graph.
- **FR-2** A root script (`typecheck:tests`) runs it, and CI runs it as a step next to
  "Typecheck", with the same `docs_only` skip as that step.
- **FR-3** Before the gate is enabled, the plan measures the pre-existing error count and
  records it in the PR. Landing is only allowed in one of the forms chosen under Decision D1.
- **FR-4** The check fails closed: a tsc crash, a missing config, or an include that matches
  zero files is a failure, never a pass (constitution invariant 2).
- **FR-5** Type resolution for the tests must work for the packages' real dependencies
  (`vscode` types, `@aiclarity/shared` built output, vitest globals); the config must not
  widen the check with blanket `any` shims to make errors disappear.
- **FR-6** The check is required for merge (see D2), so it cannot be skipped silently.
- **FR-7** A test, `typecheck-tests.test.ts`, proves red-then-green: it writes a fixture test
  file with a deliberate bad type-only import, asserts `tsc` exits non-zero with `TS2459`
  (or equivalent), then corrects the fixture and asserts exit 0. The fixture lives in a temp
  directory, never in the tree.

## Acceptance criteria

- **AC-1** Re-introducing the #1742 bad import in any existing test file makes
  `npm run typecheck:tests` exit non-zero naming that file; reverting it makes it exit 0.
- **AC-2** CI shows the step, and it runs on a PR touching only a test file.
- **AC-3** `npm test`, `npm run lint`, `npm run build`, `npm run typecheck`, `npm run validate`
  are unchanged in outcome.
- **AC-4** An empty include or a nonexistent config path produces a non-zero exit.

## Invariants this must not break

- Invariant 1 (offline): no network call added.
- Invariant 2 (no silent gate): FR-4 and FR-6; no `|| true`; warn-only mode, if chosen, must be
  visible in the CI summary and carry a dated ratchet-to-blocking issue.
- Invariant 3 (blast radius): changes only this repo's CI; nothing shipped to adopters.
- Test files must stay out of the emitted `out/` build (the reason they were excluded).

## Decisions needed (Clarify)

- **D1 Backlog handling.** (a) **Fix the backlog first, then block** (rec): the gate is
  honest from day one, as #1424 was (0 errors measured then). Cost: unknown size; a large
  backlog makes the PR big and conflict-prone with ~15 concurrent sessions. (b) Warn-only
  first, ratchet later: small PR. Cost: warn-only gates tend never to be turned up.
  (c) Blocking with a committed baseline of known errors that may only shrink: honest and
  small. Cost: a baseline file to maintain and a custom comparison script.
- **D2 Required-check status.** Making it required edits the ruleset, which is machinery
  and needs the human. Options: (a) separate required check (rec; independent witness), cost:
  ruleset change by the founder; (b) fold into the existing "Typecheck" step, cost: no ruleset
  change, but a longer single step and a failure message that does not say "tests".
- **D3 Config home.** (a) one tsconfig at the root-level glob (rec, covers `broker` and
  future packages), cost: tests of different packages share one set of compiler options;
  (b) one config per package, cost: more files, each can drift or be forgotten.
- **D4 Rejected alternatives**, per the issue: adding tests to each package's `include`
  (puts tests in the emitted build graph); a lint rule banning type imports from non-declaring
  modules (catches one instance, leaves the rest unchecked). Confirm both stay rejected.
