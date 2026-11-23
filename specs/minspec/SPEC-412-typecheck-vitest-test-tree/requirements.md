---
id: SPEC-412
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a green typecheck signposts coverage of tests/ that it does not have
aspects: [typecheck, tests, silent-gate, ci]
depends_on: []
relates_to: ["#1660", "#1659", "#1399", "#957", "SPEC-061"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan. Expected surface:
  a new vitest tsconfig per package, the root `typecheck` script in `package.json`, and
  whatever test files the first run proves wrong. None of it is claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-412: The vitest test tree is typechecked, and a green typecheck means it

> **This is a SPECIFICATION ONLY.** Written for issue
> [#1660](https://github.com/AIClarityAU/minspec/issues/1660). Nothing is built until this
> spec is approved after the [Decisions needed (Clarify)](#decisions-needed-clarify) are
> resolved. No decision record: the choice is a tsconfig layout, undoable in well under a
> day (DR-359 ADR filter).

## One-Sentence Scope

`npm run typecheck` fails when a type error exists anywhere under a package's vitest `tests/`
tree, so that a green typecheck is evidence about the tests as well as `src/`.

## Problem (from the issue, checked where noted)

- `packages/minspec/tsconfig.json` has `include: ["src/**/*.ts"]`; `tsconfig.test.json` has
  `include: ["src/test/**/*.ts"]` (the vscode-test integration tree). The vitest tree,
  `packages/minspec/tests/` (491 `.ts` files counted by `find`), matches neither.
- The root `typecheck` script (`package.json:28`) runs the `tsc --noEmit` of three projects:
  shared, minspec, core. None includes a `tests/` tree.
- `packages/core/tests` and `packages/shared/tests` also exist. I did not read their
  tsconfigs; whether they are covered is **unverified** and is Decision D2.
- The issue's control (append `const __ctl: number = "x"` to a test, tsc prints nothing)
  was run by the issue author; I could not re-run it here (no `node_modules` in this
  worktree). The Plan phase must repeat the control before and after.
- Consequence: a required parameter is enforced for `src/` callers and not test callers; a
  mutation-based proof against a test file can silently prove nothing (#1659); same shape
  as #1399, a check that appears to cover what it cannot reach.

## Functional Requirements

- **FR-1.** A tsconfig project exists that includes `packages/minspec/tests/**/*.ts`
  (and the helpers and fixture `.ts` files they import), with `noEmit` semantics and no
  `outDir`/`rootDir` that would let it write into `out/`.
- **FR-2.** The root `typecheck` script runs that project, so CI's existing typecheck step
  gates it with no new workflow file.
- **FR-3.** Test typechecking uses the same strictness as `src/` (the root `tsconfig.json`
  options); it must not be weakened to `strict: false` to reach green. Narrow per-line
  `// @ts-expect-error` is allowed only with a reason comment.
- **FR-4.** A control proves the gate: a fixture or a one-off check shows that an
  intentional type error inside `tests/` makes `npm run typecheck` exit non-zero, and that
  removing it restores zero. The control is run against the real script, not a copy of its
  logic (#1399).
- **FR-5.** Vitest-only types (`vitest` globals if used, `vitest.setup.ts`) resolve; the
  mocha-typed `src/test/` tree is not pulled into the vitest project and vice versa.
- **FR-6.** Existing type errors in the suite are fixed by correcting the test or the type,
  not by excluding the file. Any exclusion is listed in the spec with a reason and an
  issue number.

## Acceptance Criteria

1. `npm run typecheck` exits 0 on main-plus-this-change.
2. Appending `const __ctl: number = "x";` to any file under `packages/minspec/tests/`
   makes `npm run typecheck` exit non-zero and name that file.
3. `npm test` and `npm run build` are unchanged in result; `packages/minspec/out/`
   contains no test output after a build.
4. The number of pre-existing errors found by the first run is recorded in the PR, with
   how each was resolved.
5. The `src/test/` vscode-test compile (`pretest:e2e`) is unchanged.

## Invariants this must not break

- **Invariant 2 (no silent gate):** the new check fails visibly and closed. It must not be
  wired with `|| true`, and the control in FR-4 is the independent witness that the project
  really covers the tree (a green run alone is not).
- **Invariant 1 / 3:** dev-time tooling only; no network call, nothing shipped to adopters.
- The `.vsix` content is unchanged (no test files enter the package).

## Out of scope

- Typechecking `scripts/` (separate surface; file an issue if wanted).
- Making vitest itself typecheck at run time (`vitest --typecheck`).

## Decisions needed (Clarify)

### D1. Where does the config live?

- **(a) (rec) A new `tsconfig.vitest.json` per package, added to `typecheck`.** Smallest
  change; no coupling to the build project. **Cost:** an extra file per package and a
  longer typecheck run; the first run is red until the backlog of pre-existing test type
  errors is cleared, so the PR carries that fix-up work and may be large.
- (b) Widen `packages/minspec/tsconfig.json` to include `tests/**`. No new file.
  **Cost:** its `rootDir: "src"` and `outDir` must be overridden and tests excluded from
  emit; a mistake pollutes `out/` and the `.vsix`.
- (c) Leave as is. **Cost:** a green typecheck stays vacuous for tests.

Recorded selection: not yet recorded. Recommended option is (a).

### D2. Scope of packages

- **(a) (rec) minspec first; core and shared in the same PR only if the control shows they
  are also uncovered.** Matches the issue's scope. **Cost:** a possible second PR.
- (b) All three packages in one PR. **Cost:** a bigger red backlog in one change.

Recorded selection: not yet recorded. Recommended option is (a).

### D3. How to land a red backlog

- **(a) (rec) Fix all errors in the same PR so the gate lands green.** No window of a red
  or unenforced check. **Cost:** the PR size depends on an unmeasured error count; if
  large, Plan should split by directory behind a temporary exclude list that FR-6 caps.
- (b) Land the config with a baseline of tolerated errors. **Cost:** a baseline is a
  silent-gate shape (invariant 2); rejected unless the count is unmanageable.

Recorded selection: not yet recorded. Recommended option is (a).
