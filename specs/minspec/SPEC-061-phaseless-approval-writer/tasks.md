---
id: SPEC-061
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-061 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-002  # Signpost Integrity - an approved spec must be able to agree with itself
relates_to: [SPEC-022, SPEC-095, DR-003, DR-069, "#957", "#1634", "#1651", "#1659", "#2180", "#3258"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-061 - Tasks

The order below is the order of work. Each task is one pull request, ends with the full
suite green, and names the requirement IDs it satisfies, the files it touches and the test
that proves it. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md), whose body no task edits.

Every backticked path in this file is a file a task edits or creates. Files a task only
reads are named in prose.

Before calling a task done, run `npx vitest run packages/minspec/tests/approve-phase-sync.test.ts`,
then the whole suite, `npm run lint`, `npm run typecheck` and `npm run validate`. CI runs
`npx vitest`, so nothing may rely on a `pretest` hook.

## 0 - Already built (recorded, not to be redone)

- [x] **0.1** FR-1 to FR-5, DQ-2, DQ-3 - merged in #1651.
- [x] **0.2** FR-6, AC-8, DQ-1 and its sub-choice (required option, runtime guard) - merged
  in #1659.

  *Evidence:* design.md, *Most of this spec is already built*, maps each requirement to its
  code and its test. 92 tests green over the approval-sync and lifecycle test files at
  `a799afcc`.

## 1 - Extract the pure phases transform

- [ ] **1.1** `packages/minspec/src/lib/spec.ts`, `packages/minspec/tests/approve-phase-sync.test.ts`
  - Satisfies FR-6 and AC-8 (one documented behaviour, one guard), and prepares AC-6.
  - Extract `applySpecPhasesText(content, phases, opts): string` from `setSpecPhases`,
    exported, with the contract in design.md, *Contract*. Move the `opts` guard into it
    (design.md D2). `setSpecPhases` becomes read, transform, write-if-changed, restoring
    line endings as today. No change to `advanceSpecToImplementing` in this task.
  - *Test:* a new `describe('applySpecPhasesText - the pure transform (SPEC-061)')` with the
    T1 cases in design.md, *Tests*: equal to what `setSpecPhases` writes for each existing
    fixture shape, touches no file, and throws the DQ-1 message for a missing and an empty
    options object.
  - *Done when:* the new cases are green, and every existing case in the file passes
    unchanged, including "is a no-op when there is no phases block (default: shape-preserving)".

## 2 - A refused approval writes nothing

- [ ] **2.1** `packages/minspec/src/lib/spec.ts`, `packages/minspec/tests/approve-phase-sync.test.ts`
  - Satisfies AC-6 (as amended at Clarify), INV-1 and INV-4. Fixes #1634 and design.md's
    Finding 2. Depends on 1.1.
  - Write the two T0 tests first and see them red on the base: (a) widen the existing
    "still throws on a degenerate block (%s)" `it.each` to read the file before the call and
    assert byte identity after the throw; (b) a new case: a spec with a full `phases:`
    block and the #2180 negating body line (copy the fixture shape from spec.test.ts,
    "#2180 - a spec Status line whose prose negates a status word") throws
    `/negates a status word/` and leaves the file byte-identical, with a control that the
    same spec with a benign status line advances to `planning`.
  - Then reorder `advanceSpecToImplementing` per design.md D1: compute the prospective text
    with `applySpecPhasesText`, derive `persistedStatus` from it, run the degenerate-block
    gate and `specStatusProseWouldInvert(content)` before any write, then write phases and
    status. Keep both refusal messages as they are (D3) and keep the post-write equality
    assert. Rewrite the function's docstring so it says the refusal happens before any
    write, and that the status is derived from the bytes about to be written.
  - *Test:* the two T0 tests above. The PR body states they were red on the base and green
    on the head.
  - *Done when:* both are green, and every other case in the file, including the hash and
    idempotence cases, passes unchanged.

## 3 - Sweep the two stale comments

- [ ] **3.1** `packages/minspec/src/lib/spec.ts`, `packages/minspec/src/commands/approve.ts`
  - Satisfies DQ-3's sweep and FR-6's rationale (prose and behaviour must agree). Comments
    only, no code.
  - In `setBodyStatusToken`'s docstring, replace "mirrors `setSpecPhases` never adding a
    phase line that was absent" with wording that matches today: `setSpecPhases` never
    invents an individual phase line inside an existing block. In `approveSpecCommand`,
    replace "(when present)" in the comment above the `wasPreImpl` line: the map is created
    when absent (SPEC-061 FR-1).
  - *Test:* none new; comment-only. Check: `grep -n "when present" packages/minspec/src/commands/approve.ts`
    and `grep -n "never adding" packages/minspec/src/lib/spec.ts` both print nothing, and the
    suite is green.

## 4 - Close the lifecycle

- [ ] **4.1** `specs/minspec/SPEC-061-phaseless-approval-writer/requirements.md`,
  `specs/minspec/SPEC-061-phaseless-approval-writer/design.md`,
  `specs/minspec/SPEC-061-phaseless-approval-writer/tasks.md`
  - After 1.1 to 3.1 have merged: advance the `status:` and `phases:` mirrors in all three
    files, and tick the tasks above. `status` and `phases` only; no other line of
    requirements.md changes, because its body is hash-bound to the founder's approval.
  - *Test:* `npm run facts -- hash SPEC-061` reports APPROVED with stored and computed hashes
    equal before and after, and `npm run facts -- status SPEC-061` reports MATCH.
