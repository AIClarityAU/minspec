---
id: SPEC-233
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-233 is T2.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology
relates_to: ["#2108", "#1317", "#1806", "#1543", DR-003, SPEC-038]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-233 - Tasks

The order below is the order of work. Each task names the file it changes and what an
outside observer checks to call it done. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md). One pull request; nothing under `.github/` or
`.githooks/`, so it needs no machinery merge.

Every backticked path in this file is a file this change edits or creates. Files it only
reads (`spec-validator.ts`, `ownership-advance-guard.ts`, `lifecycle.ts`, the approve
composition test it copies its fixture from) are named in prose, so the spec gate's ownership
signal stays as narrow as the change.

## 1 - T0: the regression test, red before any code

- [ ] **1.1** `packages/minspec/tests/validate-reports-approval-refusal.test.ts` (new) - build
  the harness from the design's Tests section: mock only `vscode` (the thin surface the
  approve composition test uses, plus `workspace.getWorkspaceFolder` returning the temporary
  root so `folderForFile` resolves it), and wrap `../src/lib/spec-validator` with
  `importOriginal` so `violationsIntroducedByApproval` is a `vi.fn` delegating to the real
  function. `beforeEach` writes a temporary repo: `.minspec/config.json` with
  `ownershipDeclaration: 'error'` and a T4 requirements spec at `plan: pending`, no
  `implements:`. Add the precondition case (real `validateSpec` on the fixture returns no
  violations; add body sections until it does) and the AC-1, AC-4 and AC-5 cases.
  *Done when:* the precondition case passes, and AC-1, AC-4 and AC-5 fail against the
  unchanged `validate.ts` (AC-1 because the `✓` text is shown). Quote the failing output in
  the pull request body as the red-before evidence. Do not commit while red: CI runs the
  whole suite, so a red commit breaks bisect. Commit 1.1 together with 2.1.
- [ ] **1.2** Same file - add the AC-2 (declared `implements:` path present on disk), AC-3
  (`ownershipDeclaration: 'warn'`) and FR-7 (fixture already at `plan: in-progress` with
  `implements:` present) cases.
  *Done when:* all three pass against the unchanged command. They guard the clean path and
  must stay green through task 2.

## 2 - T2: the command change

- [ ] **2.1** `packages/minspec/src/commands/validate.ts` - per the design's Code shape:
  move the `parsed` declaration out of the existing `try` (read failure still shows the
  error and returns); hoist `loadConfig(rootDir)` and the `pathExists` closure into single
  `const`s used by both calls; add the module-private, never-throwing `precheckApproval`
  calling `violationsIntroducedByApproval(parsed, config, { pathExists })`; replace the
  `result.violations.length === 0` decision with the design's result table, including the
  `Approval would be refused:` block, the severity partition for FR-5, and the
  `not confirmed — approval pre-check could not run` header for FR-6.
  *Done when:* every case in the new test file passes; `npx vitest run
  tests/validate-reports-approval-refusal.test.ts tests/validate-command.test.ts
  tests/approve-command-ownership-guard.test.ts tests/ownership-guard.test.ts` is green
  from `packages/minspec` (the last two prove INV-1: the approve path is untouched); and
  `git diff --stat` shows no change to `ownership-advance-guard.ts`, `approve.ts` or
  `spec-validator.ts`. Commit 1.1, 1.2 and 2.1 together.
- [ ] **2.2** `packages/minspec/tests/validate-command.test.ts` - add one case: after a run
  on a spec, the mocked `violationsIntroducedByApproval` was called once, and the keys of
  its third argument are exactly `['pathExists']`.
  *Done when:* the case passes, and fails if `validate.ts` is edited to pass its full
  `validateSpec` options object instead (check by making that edit locally, seeing red,
  and reverting; note the result in the pull request body).

## 3 - Close out

- [ ] **3.1** From `packages/minspec`: `npx tsc --noEmit -p .`, `npm run lint`, and the full
  `npx vitest run`, all green. Run `npx tsc --noEmit` on the new test file as well, since
  `tests/` is outside every tsconfig `include`.
  *Done when:* each command exits 0 and its summary line is quoted in the pull request body.
- [ ] **3.2** Rebuild the vsix (`npm run package` in `packages/minspec`) and confirm the
  bundle contains the new label, with `grep -c "Approval would be refused" out/extension.js`
  greater than 0 (a string literal, because a minified bundle hides symbol names).
  *Done when:* the count is quoted in the pull request body.
