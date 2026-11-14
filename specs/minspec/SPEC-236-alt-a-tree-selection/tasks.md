---
id: SPEC-236
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-236 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - Alt+A is the one-keystroke approve/accept for every approvable
relates_to: ["#2118", "#303", "#377"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-236 - Tasks

The order below is the order of work, and all of it is one pull request: the keybinding
split (task 5) without the handler's step 0 would send a marker the handler does not
understand, and the handler without the split is dead code. Each task names the
requirement IDs it satisfies, the files it touches and the test that proves it. The plan
is [design.md](design.md); the contract is [requirements.md](requirements.md), which no
task edits.

Shared rules for every task:

- Tests first. Each task's test is written and seen RED against `origin/main` before the
  code that turns it green.
- No file under `.github/`, `.githooks/` or `.minspec/` changes. No machinery merge is
  needed.
- `implements: none` stays true: no new file under `packages/*/src/` (design.md, P4).
- Existing cases in `packages/minspec/tests/approve-active-command.test.ts` are not edited
  (FR-6, AC-5); new cases are added in new `describe` blocks. Their passing unmodified is
  the FR-6 proof.
- Before calling a task done, run `npx vitest run packages/minspec/tests` from the repo
  root (CI's shape: `npx vitest`, not `npm test`), then `npm run lint`, and
  `npx tsc --noEmit -p packages/minspec` (tests sit outside the tsconfig include, so also
  typecheck each touched test file directly).

## 1 - The contract (FR-2)

- [ ] **1.1** `packages/minspec/tests/approve-active-command.test.ts` - new
  `describe('classifyArg')`:
  - `{source:'tree', viewId:'minspecStatus'}` (and each of the other two ids) →
    `{kind:'tree', viewId}`;
  - `{source:'tree', viewId:'minspecFoo'}`, `{source:'tree'}`, `{source:'tree', viewId: 7}`
    → `{kind:'tree-unknown'}` with `viewId` rendered by `String()`;
  - `undefined`, `null`, a string, a spec node `{spec:{...}}`, an adr node, an epic node,
    `{source:'editor', viewId:'minspecStatus'}` → `{kind:'other'}`;
  - `TREE_VIEW_IDS` equals `['minspecStatus','minspecAdrs','minspecBacklog']`.
  *Done when:* RED on `origin/main` (missing exports), observed once before 1.2.
- [ ] **1.2** `packages/minspec/src/commands/approve-active.ts` - add `TREE_VIEW_IDS`,
  `TreeViewId`, `TreeFocusArgs`, `TreeSelectionLookup`, `ApproveActiveDeps`,
  `TREE_VIEW_NAMES` (`MinSpec: Specs`, `MinSpec: Decisions`, `MinSpec: Backlog`) and the
  pure `classifyArg`, as design.md *The contract* specifies. *Done when:* 1.1 is green.

## 2 - Step 0 in the handler (FR-1, FR-3, FR-4, FR-5; D2, D3; AC-1 to AC-4)

- [ ] **2.1** `packages/minspec/tests/approve-active-command.test.ts` - new
  `describe('approveActiveCommand - tree focus (step 0)')`. Each case passes a fake
  `treeSelection` lookup (a `vi.fn`) and, where it dispatches, stubs `showQuickPick` to
  return its single item (the confirmation accepted):
  - AC-1: lookup returns one `{spec}` node for `minspecStatus`; the active editor is set to
    a decision file (`setActiveFile('/tmp/ws/docs/decisions/DR-001-x.md')`, resolvable via
    `listAdrs`). Expect exactly one `executeCommand('minspec.approveSpec', <that node>)`,
    no `minspec.acceptAdr`, and `recentApprovables` not called.
  - AC-2: `minspecAdrs` with one `{adr}` node → `minspec.acceptAdr` with that node.
  - AC-3 (D3): `minspecStatus` with an epic group row `{ epic: {...}, members: [] }` →
    `minspec.acceptEpic` with it. The no-epic group row (`{ members: [], epic: undefined }`)
    → FR-5 case (b) instead.
  - The lookup is called once with the marker's `viewId`, and nothing else reads selection.
  *Done when:* RED before 2.3.
- [ ] **2.2** Same file, new `describe('approveActiveCommand - tree focus, nothing to
  approve (FR-5, D2)')`. Each case asserts exactly one `showInformationMessage` call whose
  text contains the view's `TREE_VIEW_NAMES` value (or, for (c), the raw id) and the
  matching exported reason constant; and that `executeCommand`, `showQuickPick` and
  `recentApprovables` are never called (D2: no fall-through to the picker or backstop):
  - (a) empty selection;
  - (b) a `BacklogIssueNode`-shaped `{issue:{number:1}}`, a `SpecGroupNode`-shaped
    `{specs:[]}`, and a message-row-shaped `{}` (one case each);
  - (c) marker with `viewId: 'minspecFoo'` (lookup not called);
  - a two-element selection;
  - a valid marker with no `treeSelection` dep supplied.
  *Done when:* RED before 2.3.
- [ ] **2.3** `packages/minspec/src/commands/approve-active.ts` - change the signature to
  `approveActiveCommand(arg?: unknown, deps: ApproveActiveDeps = {})` and add step 0 before
  today's step 1, exactly as design.md *Step 0* specifies, with the reason strings as
  exported constants. No `try/catch` around `deps.treeSelection(...)`. For this task,
  dispatch directly after classification (the confirmation is task 3). *Done when:* 2.2 is
  green and 2.1 is green with the `showQuickPick` stub ignored; the pre-existing cases in
  the file are green unmodified.

## 3 - The tree-path confirmation (D1, design.md measured point 1)

- [ ] **3.1** `packages/minspec/tests/approve-active-command.test.ts` - new
  `describe('approveActiveCommand - tree confirmation')`:
  - for a selected spec, decision and epic node, `showQuickPick` is called once with a
    single item whose label is `describeTreeTarget(kind, node)` and contains that node's
    id and title (fixtures use distinct ids, so a wrong-node label fails);
  - `showQuickPick` resolving `undefined` (Esc) → no `executeCommand`, no
    `showInformationMessage`;
  - the editor path (no argument, approvable editor active) and the node path (a spec node
    passed directly) never call `showQuickPick` (FR-6: only the tree path confirms).
  - `describeTreeTarget` unit cases: spec → `SPEC-NNN: <title>`, adr → `DR-NNN: <title>`,
    epic → `EPIC-NNN: <title>`.
  *Done when:* RED before 3.2.
- [ ] **3.2** `packages/minspec/src/commands/approve-active.ts` - add `describeTreeTarget`
  and `confirmTreeTarget` (design.md *Confirmation*, decision P1) and call it between
  classification and dispatch in step 0. *Done when:* 3.1 and all of 2.1 are green.

## 4 - The contribution test (FR-7; AC-6)

- [ ] **4.1** `packages/minspec/tests/approve-active-keybindings.test.ts` (new) - the pure
  checker `altAContributionProblems(manifest, treeViewIds)` local to the test, with the
  rules in design.md *The contribution test* (including the disjointness guard), and these
  cases:
  - mutant 1: the real manifest with `|| focusedView == minspecFoo` appended to the
    editor entry's `when` → problems non-empty and naming `minspecFoo`;
  - mutant 2: the real manifest with the `minspecAdrs` entry deleted → problems non-empty
    and naming `minspecAdrs`;
  - mutant 3 (overlap): the real manifest with `focusedView != minspecAdrs` removed from the
    `minspec.markdownPreviewActive` arm of the no-`args` entry → problems non-empty and
    naming `minspecAdrs` and that arm (it must fail while that entry is the only change,
    so the guard rule, not the delete rule, is what catches it);
  - order independence: the real manifest with its `alt+a` entries in reverse order → `[]`;
  - a hand-built manifest in the target shape → `[]` (the checker's control: it can
    return empty, so mutant 1 and 2 are not failing for an unrelated reason);
  - every `TREE_VIEW_IDS` member is a `contributes.views` id, and `TREE_VIEW_NAMES[id]`
    equals that view's `name`;
  - the real manifest → `[]`.
  Mutants are built with `structuredClone` of the parsed manifest; the file on disk is
  never written. *Done when:* the real-manifest case is RED on `origin/main` (one entry
  with three `focusedView` arms and no `args`, and no `!=` guard) and the three mutant cases, the order case and the control are green against the checker.

## 5 - Wiring (FR-1, FR-3)

- [ ] **5.1** `packages/minspec/package.json` - replace the one `alt+a` entry with the
  four in design.md *Keybindings*, the first carrying the `focusedView != <id>` guards in
  both arms. *Done when:* 4.1's real-manifest case is green, and
  `tests/readme-manifest-parity.test.ts`, `tests/manifest-no-internal-ids.test.ts`,
  `tests/getting-started.test.ts` and `tests/status-bar.test.ts` are green unmodified
  (design.md measured point 7).
- [ ] **5.2** `packages/minspec/src/extension.ts` - build `treeViewsById` from
  `specTreeView`, `adrTreeView`, `backlogTreeView` and pass
  `{ treeSelection: (id) => treeViewsById[id].selection }` at the `minspec.approveActive`
  registration (design.md *Registration*). Type the map as `Record<TreeViewId, ...>` so a
  new `TREE_VIEW_IDS` member without a view fails `tsc`. *Done when:* `npx tsc --noEmit -p
  packages/minspec` is clean and the e2e suite (`npm run test:e2e` in
  `packages/minspec`, under `xvfb-run -a` in the container) is green; it activates the
  extension, so a broken registration fails it.
- [ ] **5.3** `packages/minspec/src/commands/approve-active.ts` - update the module
  header's "Resolution order" list to put step 0 first, naming the keybinding `args`, the
  confirmation and the D2 stop, and say that step 1's node comes from a programmatic or
  menu call (FR-8). Update the registration comment in `extension.ts` to match. *Done
  when:* a reviewer can match each numbered header step to a branch of
  `approveActiveCommand` in order (checked in the pull request's self-review).

## 6 - Manual acceptance and packaging (AC-7)

- [ ] **6.1** Build the vsix (`npm run package` in `packages/minspec`) and record in the
  pull request body the AC-7 run in VSCodium on a scratch workspace with throwaway specs:
  (i) "Focus on Specs View" with an older spec row selected and a DR editor open, Alt+A →
  the confirmation names the selected spec, Enter approves it (FR-4, D1 confirmation);
  (ii) in the Specs view, click spec A, arrow-down to spec B, Alt+A → the confirmation
  names A, not B (the focus/selection split, design.md measured point 1); Esc → nothing
  approved; (iii) Alt+A on a backlog issue row → one message, nothing approved; (iv) make a markdown
  preview the active tab, then focus the Specs view and press Alt+A → the tree
  confirmation appears, not the recently-viewed picker (the overlap case design.md R4
  closes).
  If (ii) shows B, the split is not real in VSCodium: remove `confirmTreeTarget`, its call
  and task 3.1's cases in the same pull request, per D1, and say so in the body. This is
  the spec's own manual acceptance step; the builder states it as pending in the pull
  request if no human has run it yet, rather than marking it done.

## Requirement coverage

| Requirement | Tasks |
|---|---|
| FR-1 | 2.1, 5.1, 5.2 |
| FR-2 | 1.1, 1.2 |
| FR-3 | 2.1, 2.3, 5.2 |
| FR-4 | 2.1, 2.3, 3.2 |
| FR-5 | 2.2, 2.3 |
| FR-6 | 2.3 (existing cases unmodified), 3.1 |
| FR-7 | 4.1, 5.1 |
| FR-8 | 5.3 |
| D1 (confirmation) | 3.1, 3.2, 6.1 |
| D2 | 2.2 |
| D3 | 2.1 |
| AC-1 to AC-4 | 2.1, 2.2 |
| AC-5 | 2.3 |
| AC-6 | 4.1 |
| AC-7 | 6.1 |
