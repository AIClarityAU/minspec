---
id: SPEC-256
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-256 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - Alt+A is the one-keystroke approve/accept for every approvable
relates_to: ["#2519", "#440", SPEC-236]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-256 - Tasks

The order below is the order of work. All tasks are one pull request (the resolver without
the FR-4 notice would add a path the pickers still hide silently). Each task names the
requirement IDs it satisfies, the files it touches and the test that proves it. The plan
is [design.md](design.md); the contract is [requirements.md](requirements.md), which no
task edits.

Shared rules for every task:

- Tests first. Each task's test is written and seen RED against `origin/main` before the
  code that turns it green.
- No file under `.github/`, `.githooks/` or `.minspec/` changes. No machinery merge is
  needed.
- `implements: none` stays true: no new file under `packages/*/src/` (design.md, D4).
- Unchanged on purpose (FR-6): `packages/minspec/src/lib/recent-approvables.ts`, `packages/minspec/src/lib/approval-store.ts`,
  `classifyApprovablePath`, `packages/minspec/src/views/spec-tree-provider.ts`, `packages/minspec/package.json`.
- Before calling a task done, run `npx vitest run packages/minspec/tests` from the repo
  root (CI's shape: `npx vitest`, not `npm test`), then `npm run validate` and
  `npm run lint`. New test files are also typechecked once with
  `npx tsc --noEmit -p packages/minspec` plus the file, because `tests/` sits outside the
  tsconfig include.

## 1 - The resolver (FR-1, FR-5, FR-7; AC-1 resolve half, AC-2, AC-6, AC-7)

- [ ] **1.1** `packages/minspec/tests/find-spec-for-file.test.ts` (new) - cases against
  `findSpecForFile` on real `fs.mkdtempSync` folders, each with `.minspec/config.json`
  unless the case says otherwise:
  - AC-1: `specs/SPEC-001-foo.md` with `id: SPEC-001`, `status: done` → returns the
    SPEC-001 summary, `status` `done`, `filePath` that file.
  - AC-2: the same spec as `specs/SPEC-001-foo/requirements.md` → returns it when given
    the `requirements.md` path.
  - Shard: split set with `requirements.md`, `design.md`, `tasks.md` all `id: SPEC-001`
    → `design.md` and `tasks.md` return undefined (#630 kept).
  - AC-6: `specs/README.md` with no frontmatter `id:` → undefined.
  - Outside `specsDir`: `docs/notes.md` carrying `id: SPEC-005` → undefined.
  - Custom `specsDir` (FR-5): config `"specsDir": "requirements"`, flat file under it →
    resolves; the same file under `specs/` → undefined.
  - AC-7 at the library level: two roots, root A default config, root B
    `"specsDir": "rq"`; a flat spec in B resolves with `rootDir` B and not with A.
  - FR-7: the AC-1 fixture with no `.minspec/` directory → undefined, although the flat
    spec file is present and would otherwise match.
  - Not markdown: `specs/SPEC-001-foo.txt` → undefined.
  - A `specsDir` escaping the root (`"../x"`) → throws (the `resolveAndValidate` error is
    not swallowed).
  *Done when:* the file runs RED on `origin/main` (missing export), observed once before 1.2.
- [ ] **1.2** `packages/minspec/src/lib/spec-catalog.ts` - add `findSpecForFile` directly
  after `listSpecs`, exactly as design.md, *The resolver*, specifies: opt-in check with
  `hasOptInMarker` (imported from `./opt-in`), `.md` check, `resolveAndValidate` prefilter,
  then exact `path.resolve` match over `listSpecs(rootDir)`. Doc comment as in design.md.
  *Done when:* 1.1 is green.

## 2 - Alt+A step 2b (FR-1, FR-5, FR-7; SPEC-236 order kept)

- [ ] **2.1** `packages/minspec/tests/approve-active-command.test.ts` - add
  `findSpecForFile: vi.fn(() => undefined)` to the existing `spec-catalog` mock, and a
  `describe('SPEC-256 step 2b')` with:
  - Focused `/tmp/ws/specs/SPEC-001-foo.md`, `findSpecForFile` returns a `done` summary
    → `executeCommand('minspec.approveSpec', { spec })` once; no QuickPick (AC-1 routing).
  - The same with `findSpecForFile` returning undefined → falls through to step 3/4
    exactly as a non-approvable focus (backstop `minspec.approveSpec` with no node), and
    `showErrorMessage` is NOT called.
  - A focused `requirements.md` → `findSpecForFile` is not called (step 2 unchanged).
  - AC-7: `getWorkspaceFolder` returns `/tmp/ws1` for the file → `findSpecForFile` is
    called with `/tmp/ws1`, not `/tmp/ws`.
  - `findSpecForFile` throws `Error('escapes root')` → one `showErrorMessage` containing
    `escapes root` and the root; no dispatch.
  - No active editor → `findSpecForFile` not called.
  *Done when:* the new cases run RED on `origin/main`, then 2.2 turns them green, and every
  pre-existing case in the file still passes.
- [ ] **2.2** `packages/minspec/src/commands/approve-active.ts` - re-read
  `approveActiveCommand` on current `main` first (SPEC-236, design.md R3). Import
  `findSpecForFile`; insert step 2b after step 2, as design.md, *Alt+A step 2b*, shows;
  add step 2b to the module header's resolution order. *Done when:* 2.1 is green.

## 3 - The FR-4 notice (FR-2, FR-4; AC-3, AC-5)

- [ ] **3.1** `packages/minspec/tests/hidden-terminal-notice.test.ts` (new) - against
  `hiddenTerminalSpecsNotice`:
  - `[]` → undefined; only `unapproved` and `approved` terminal entries → undefined (D5).
  - One stale `SPEC-001 (done)` → text contains `SPEC-001`, `done`, `Alt+A` and
    `MinSpec: Approve/Accept Active` (AC-5's three parts: id, status, reach path).
  - Four stale entries → three named, then `and 1 more`.
  - Mixed: two stale, five never-approved → names the two; the never-approved ids are
    absent from the text.
  - `PER_ARTIFACT_APPROVE_HINT` appears verbatim in every non-undefined result.
  *Done when:* RED on `origin/main`, observed once.
- [ ] **3.2** `packages/minspec/src/lib/approvable.ts` - add `HiddenTerminalSpec`,
  `PER_ARTIFACT_APPROVE_HINT` and `hiddenTerminalSpecsNotice` as design.md specifies; amend
  the module header to say it also holds the Alt+A notice wording. Pure: no fs, no vscode.
  *Done when:* 3.1 is green.
- [ ] **3.3** `packages/minspec/tests/approve-terminal-lifecycle.test.ts` - add, keeping
  every existing #440 case unchanged:
  - AC-5: `listSpecs` returns only `SPEC-001` `done`, `getApprovalStatus` `stale`;
    `approveSpecCommand()` with no node → `showQuickPick` not called, and one
    `showInformationMessage` whose text contains `SPEC-001`, `done` and `Alt+A`.
  - Same with approval `unapproved` → the existing `emptyMessage` text, and no `SPEC-001`
    in it (D5).
  - AC-3 plus FR-4: `listSpecs` returns `SPEC-001` `done` stale and `SPEC-005`
    `specifying` unapproved → the QuickPick items hold `SPEC-005` only, and the options'
    `title` contains `SPEC-001` and `Alt+A`.
  - Revoke's picker options carry no `title` (unchanged).
  *Done when:* the new cases are RED on `origin/main`.
- [ ] **3.4** `packages/minspec/src/commands/approve.ts` - add `PickOptions.hiddenNotice`;
  in `pickSpec` keep the rejected entries, compute the notice, append it to `emptyMessage`
  when nothing survives, pass it as `title` to `showQuickPick` otherwise. Approve's call
  passes a `hiddenNotice` built on `hiddenTerminalSpecsNotice` over the rejected entries
  whose `spec.status` is terminal. Revoke passes none. *Done when:* 3.3 is green.
- [ ] **3.5** `packages/minspec/tests/approve-active-command.test.ts` - MRU case: recents
  hold a `done` stale spec and a `specifying` unapproved spec (both via `listSpecs` mock,
  focus on a non-approvable file) → QuickPick items hold only the `specifying` one, and
  `title` contains the `done` spec's id and `Alt+A`. And: recents hold only the `done`
  stale spec → no MRU QuickPick, falls to the backstop (one message, from step 4).
  *Done when:* RED on `origin/main`.
- [ ] **3.6** `packages/minspec/src/commands/approve-active.ts` - in
  `pickRecentApprovable`, collect spec entries dropped by `isPending` whose literal status
  is terminal (with `getApprovalStatus` on their own folder); pass
  `hiddenTerminalSpecsNotice(...)` as the QuickPick `title`. Nothing shown on
  `outcome: 'none'`. *Done when:* 3.5 is green.

## 4 - D2 toast wording (FR-3, FR-4; AC-4)

- [ ] **4.1** First grep `packages/minspec/tests` for `Approved .* for implementation` and
  list the assertions it finds in the pull request body (design.md R4). Then add to
  `packages/minspec/tests/approve-terminal-lifecycle.test.ts`, with
  `readSpecFile` / `validateSpec` / `assertOwnershipDeclaredForAdvance` mocked to pass
  for a `done` spec node (follow `approve-command.test.ts`'s mock set):
  - AC-4 allow arm: approval `unapproved`, node passed → `recordApproval` called once;
    the toast contains `SPEC-001`, `status stays done` and `never been approved`.
  - Stale arm: approval `stale` → toast contains `Re-approved SPEC-001` and
    `status stays done`, and not `never been approved`.
  - Non-terminal spec → toast unchanged (`for implementation`).
  - AC-4 refuse arm: D2 recorded option (a), so there is no refusal; assert instead that
    no error message is shown for the never-approved terminal case.
  *Done when:* RED on `origin/main`.
- [ ] **4.2** `packages/minspec/src/commands/approve.ts`, `approveSpecCommand` - compute
  `priorApproval` before `recordApproval` for a terminal literal status, and add the
  terminal branch to `base` as design.md, *D2*, specifies. *Done when:* 4.1 is green and
  every test 4.1's grep found still passes.

## 5 - End to end (AC-1, AC-2, AC-8)

- [ ] **5.1** `packages/minspec/tests/approve-flat-terminal-e2e.test.ts` (new) - real temp
  repo (`git init`, `.minspec/config.json`, `minspec.approverEmail` returned by the mocked
  `getConfiguration`, `commitOnApprove` off), shaped on
  `approve-command-ownership-guard.test.ts`:
  - AC-1: flat `specs/SPEC-001-foo.md`, complete body, `status: done`; record an approval
    with the real `approveSpec` lib, then edit the body so `getApprovalStatus` is `stale`.
    `findSpecForFile(root, file)` resolves it, `approveSpecCommand({ spec })` runs, and
    afterwards `getApprovalStatus(root, file) === 'approved'` and the file still reads
    `status: done`.
  - AC-2: the same fixture as `specs/SPEC-001-foo/requirements.md` → identical outcome.
  - AC-8: `recordApprovableView` on the flat file leaves `recentApprovables()` empty, and
    `listOrphanedRecords(root)` returns the flat sidecar exactly as it does on
    `origin/main` (the pre-existing output, pinned, not changed by this spec).
  *Done when:* AC-1 and AC-2 are RED on `origin/main` (no `findSpecForFile`), green after
  tasks 1 to 4, and the AC-8 case is green on both.
- [ ] **5.2** Final sweep: `npx vitest run packages/minspec/tests`, `npm run validate`,
  `npm run lint`, and a rebuilt `.vsix` (`npm run package` in `packages/minspec`). The
  pull request body names voip-sms-inbox#123 as unblocked by this change.
