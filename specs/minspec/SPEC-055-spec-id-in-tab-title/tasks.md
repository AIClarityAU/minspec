---
id: SPEC-055
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-055 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-002  # Signpost Integrity
relates_to: [SPEC-012, SPEC-026, SPEC-040, DR-019, DR-075, DR-076, "#897", "#374"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-055 - Tasks

The order below is the order of work. Each task is one agent run and one pull request: one
concern, a few files, its own test. It names the requirement IDs it satisfies, the files it
touches, its prerequisites and what an outside observer checks to call it done. The plan is
[design.md](design.md), including its *Decisions*, and holds each test's contract; the contract
for the work is [requirements.md](requirements.md), which no task edits.

Every backticked path in this file is a file this change edits. Files a task only reads are
named in prose, so the spec gate's ownership signal stays as narrow as the change.

Rules for every task:

- Tasks 1.1, 1.2, 1.3, 2.1 and 4.1 share one test file, so they run one at a time, in order.
- Write the test first. A test that is red on the unchanged code: paste the red into the pull
  request. A test that asserts an absence already true (AC-3, AC-4) has a meta test instead,
  fed the text it must reject, and that meta test is the proof it can fire.
- Test cases key on text, never on line numbers. The numbers in [design.md](design.md) are
  those of `ef84097b` and move.
- Pull requests say `Refs #897`, never `Closes`: #897 carries the deferred title feature and
  must stay open (AC-5).
- Add no import of a network or LLM module and no second progress or active-spec resolver
  (AC-6, FR-6, INV-3, INV-4).
- Run `npx vitest run` (what CI runs), `npm run typecheck` and `npm run validate` before
  calling a task done. That typecheck covers `src/` only, so also run `tsc` on any test file
  under `tests/` you changed.

## 1 - Comment sweep and the absence pins

- [ ] **1.1** (FR-1, AC-1, INV-1) `packages/minspec/src/views/status-bar.ts` - comments only,
  worded as in design.md's component table: the header, and the three priority comments.
  Test: `packages/minspec/tests/status-bar.test.ts`, new `describe('AC-1')` - the helpers
  `tsFiles`, `commentText`, `codeText`, `badPriorityComments` from the TypeScript compiler's
  comment ranges, with their meta tests, and the AC-1 scan with `$(shield) MinSpec` and
  `per-spec progress item` only. Prerequisites: none.
  *Done when:* the scan is red on the unchanged file (four sites) and green after, and the
  file's code is unchanged apart from comments.
- [ ] **1.2** (FR-1, AC-1, PQ2 decision) Comments in `packages/minspec/src/commands/status.ts`,
  `packages/minspec/src/lib/active-spec.ts`, `packages/minspec/src/lib/spec-progress.ts` and
  `packages/minspec/src/extension.ts`, and the comments, title and assertion message in
  `packages/minspec/src/test/views.test.ts`, as in design.md's component table. Keep the
  header paragraph in the third file about the #994 rename: it is true.
  Test: `packages/minspec/tests/status-bar.test.ts` - add design.md's retired phrases to the
  AC-1 scan. Prerequisites: 1.1.
  *Done when:* the scan is red on the unchanged files and green after, and `git diff` shows
  only comment lines in the four source files.
- [ ] **1.3** (FR-3, AC-3, INV-1) Tests only. `packages/minspec/tests/status-bar.test.ts` - the
  AC-3 static scan of the status-bar view, with its meta test.
  `packages/minspec/tests/extension.test.ts` - the behavioural test in `describe('activate()')`,
  contract in design.md, with its non-vacuity check on captured handlers. Prerequisites: 1.1.
  *Done when:* both are green, the meta test fails on a sample holding either identifier in
  code, and the pull request quotes one run with a temporary focus-driven `update` call added
  to the activate function going red, then removed.
- [ ] **1.4** (FR-4, AC-4, INV-2) Tests only.
  `packages/minspec/tests/invariant3-project-local-prefs.test.ts` - `configWriteSites` with all
  three call forms, `AC4_PINNED` with its four files, the `.vscode` path pin, and the meta tests.
  The existing Global scan stays unchanged. Prerequisites: none.
  *Done when:* green, the meta test counts as design.md states, and a temporary fifth write site
  in any source file goes red, quoted in the pull request. If a fifth site has landed on `main`
  since `ef84097b`, read whether only a user choice reaches it before pinning it; if not, stop
  and report it, because that is the AC-4 failure itself.

## 2 - User-facing copy (PQ2 decision)

- [ ] **2.1** (FR-1, INV-1) `packages/minspec/media/walkthrough/explore-sidebar.md` - delete the
  `## Status Bar` section; the signpost paragraph above it stays.
  `packages/minspec/src/commands/example.ts` - the checkbox sentence in the generated example
  becomes "The sidebar updates automatically as you check items off."
  Test: `packages/minspec/tests/status-bar.test.ts` - that markdown file holds no `## Status Bar`
  heading and the example source holds no `sidebar and status bar`. Prerequisites: 1.2.
  *Done when:* red on the unchanged files, green after. README and `package.json` are not edited:
  what they say about the status bar on `ef84097b` is true.

## 3 - The tracker

- [ ] **3.1** (FR-5, AC-5) No file changes and no pull request. As the bot, add #374 as a
  "blocked by" dependency of #897. Read back
  `gh issue view 897 --repo AIClarityAU/minspec --json state,blockedBy` and
  `grep -rn 'window\.title' packages/minspec/src`, and post both outputs as a comment on this
  task's issue. If the App token cannot write the dependency, report the ready-to-run command
  instead of using the human account. Prerequisites: none.
  *Done when:* the read-back shows `OPEN`, #374 among the blockers, and 0 grep hits.

## 4 - Blocked on the founder

- [ ] **4.1** (FR-1, AC-2) **Prerequisite: the founder's answer to PQ1** (design.md, *Plan
  Questions*); do not start without it. AC-2's approved text pins two items and `main` creates
  three. Test: `packages/minspec/tests/status-bar.test.ts` - `createStatusBarItem(` occurrences
  in `codeText` over the source tree equal `AC2_PINNED.length`, with `AC2_PINNED` as that answer
  sets it. Also needs 1.1, for the helpers.
  *Done when:* green on the state the answer describes, and its meta test goes red on a sample
  holding one more call. Until this lands the spec cannot be called done, because AC-2 is false.
