---
id: SPEC-236
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-236 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - Alt+A is the one-keystroke approve/accept for every approvable
relates_to: ["#2118", "#303", "#377", "#440", "#936", "#950", "#357"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-236 - Design: Alt+A in a focused MinSpec tree acts on that tree's selected row (Plan)

Plan for [requirements.md](requirements.md) (APPROVED; read, never edited by this Plan),
built under the three recorded Clarify selections: D1 option (a) (per-view keybinding
entries carrying `args`, verify the focus/selection split first and add a tree-path
confirmation only if the split is real), D2 option (a) (stop after the FR-5 message), D3
option (a) (an epic group row routes to `minspec.acceptEpic`). Citations of "today" are
against `origin/main` `0b82f159`. New code is named by symbol, because its line numbers
will move. The task list is [tasks.md](tasks.md).

## Approach in one paragraph

The single `alt+a` keybinding in `packages/minspec/package.json` becomes four: one for the
editor and markdown preview (no `args`, today's behaviour) and one per MinSpec tree view,
each `when: focusedView == <id>` and carrying `args: { source: 'tree', viewId: '<id>' }`.
`approveActiveCommand` gains a step 0: when its first argument is a tree-focus marker, it
reads that view's selection through a lookup injected at registration in `extension.ts`
(built from the three existing `TreeView` objects), and either confirms and dispatches the
selected approvable row to its existing command, or shows one information message naming
the view and the reason and stops. Every other argument shape resolves exactly as today.
A new contribution test parses the manifest and fails if a `focusedView` arm ever exists
without a matching `args` entry, so the keybinding and the handler cannot drift apart again.

## What Plan measured that the spec did not know

Each item was read in code, not inferred.

1. **The focus/selection split is real (D1's verification).** Read in VS Code `main` at
   `968fb17b` (VSCodium builds from the same source):
   - Arrow keys in a workbench tree run `list.focusDown` / `list.focusUp`
     (`src/vs/workbench/browser/actions/listCommands.ts`), which call `updateFocus`. That
     function moves the selection with the focus ONLY when the list's
     `WorkbenchListSelectionNavigation` context key is true.
   - The custom (extension) tree view, `src/vs/workbench/browser/parts/views/treeView.ts`,
     never sets `selectionNavigation` (zero occurrences in the file), so the key is false
     and arrows move focus without changing `.selection`.
   - The extension API exposes the focused element only through the proposed
     `treeViewActiveItem` API (`src/vscode-dts/vscode.proposed.treeViewActiveItem.d.ts`),
     which a published extension cannot use. Stable `TreeView` has `.selection` only.
   So a user who clicks row A, arrows to row B and presses Alt+A would get A approved with
   no prompt: D1's recorded selection therefore adds the tree-path confirmation
   (*Confirmation* below). A manual check in VSCodium still runs as AC-7 (task 6.1), and
   if it contradicts this reading, the confirmation is removed in the same pull request.
2. **Keybinding `args` reach the command.** Extension-contributed keybindings carry `args`
   through to `executeCommand` (`src/vs/workbench/services/keybinding/browser/keybindingService.ts`,
   the contribution schema's `args` property and `_asCommandRule`
   reading `{ command, args, when, ... }` from each entry). This settles AC-7's first
   unverified premise in code; AC-7 still observes it in VSCodium.
3. **No downstream confirmation exists.** `approveSpecCommand`
   (`packages/minspec/src/commands/approve.ts`, the comment "a second confirmation modal
   is redundant") approves on invocation, as do `acceptAdrCommand` (`commands/adr.ts`) and
   `acceptEpicCommand` (`commands/epic.ts`). Whatever Alt+A dispatches is approved; the
   confirmation cannot be delegated downstream.
4. **Tree views are single-select.** None of the three `createTreeView` calls
   (`packages/minspec/src/extension.ts:159-169`) sets `canSelectMany`, so `.selection`
   holds zero or one element. A length above one is still handled (FR-5 case, *Step 0*),
   because `canSelectMany` could be turned on later.
5. **Epic group rows appear in all three trees, and one kind carries no epic.**
   `EpicGroupNode` (`packages/minspec/src/views/epic-grouping.ts`) is built by the Specs,
   Decisions and Backlog providers, and its `epic` field is optional: the "no epic" group
   has none. So `classifyNode` routes a registered epic's group row to `acceptEpic` (D3)
   and returns `undefined` for the no-epic group, which takes FR-5 case (b).
6. **Non-approvable rows, by class.** `classifyNode` returns `undefined` for
   `SpecGroupNode` (carries `.specs`, plural), `RollupNode`, `SpecFolderNode`,
   `AdrGroupNode`, `AdrFolderNode`, `BacklogGroupNode`, `BacklogIssueNode` (carries
   `.issue`) and the Backlog `MessageNode`. All take FR-5 case (b).
7. **Other readers of the `alt+a` entry tolerate duplicates.** `hotkeysFromManifest`
   (`commands/getting-started.ts`) keeps the first entry per command, so its label stays
   `Alt+A`; `tests/readme-manifest-parity.test.ts` checks each entry's key is in the README
   (all four are `alt+a`); `tests/manifest-no-internal-ids.test.ts` scans `contributes`
   for `SPEC-`/`DR-`/`#NNN`, and the `args` values carry none. No existing reader breaks.
8. **No view-title or context menu invokes `minspec.approveActive`.** Its only menu
   surface is the command palette, so a tree-node argument reaches the handler only from
   a programmatic call or a future menu entry. Step 1 (node) keeps working for both.

## Architecture

### The contract (FR-2)

In `packages/minspec/src/commands/approve-active.ts`, exported:

```ts
export const TREE_VIEW_IDS = ['minspecStatus', 'minspecAdrs', 'minspecBacklog'] as const;
export type TreeViewId = (typeof TREE_VIEW_IDS)[number];

export interface TreeFocusArgs {
  readonly source: 'tree';
  readonly viewId: TreeViewId;
}

/** Selection of a MinSpec tree view, read at keypress (FR-3). */
export type TreeSelectionLookup = (viewId: TreeViewId) => readonly unknown[];

export interface ApproveActiveDeps {
  readonly treeSelection?: TreeSelectionLookup;
}

/** Human name of each view, for messages; equals package.json `views[].name`. */
export const TREE_VIEW_NAMES: Record<TreeViewId, string>;
```

A pure classifier, `classifyArg(arg)`, returns one of:

- `{ kind: 'tree', viewId }` when `arg` is an object with `source === 'tree'` and a
  `viewId` in `TREE_VIEW_IDS`;
- `{ kind: 'tree-unknown', viewId }` when `source === 'tree'` but `viewId` is anything
  else (including missing or not a string; `viewId` is then rendered with `String()` for
  the message): FR-2's "an unknown `viewId` is reported visibly, never treated as no
  argument";
- `{ kind: 'other' }` for every other value, which falls to today's step 1
  (`classifyNode`) unchanged (FR-6).

### Step 0: tree focus (FR-1, FR-3, FR-4, FR-5, D2, D3)

`approveActiveCommand(arg?: unknown, deps: ApproveActiveDeps = {})`. Before today's
step 1:

1. `classifyArg(arg)` is `other` → skip to step 1. Nothing below runs.
2. `tree-unknown` → FR-5 case (c): one information message, stop.
3. `tree` with no `deps.treeSelection` → one information message saying the selection of
   that view could not be read, stop. (Registration always supplies the lookup; this arm
   exists so a wiring regression is visible rather than silently falling through to the
   editor, invariant 2.)
4. `tree` → `selection = deps.treeSelection(viewId)`. Not wrapped in `try/catch`: a throw
   propagates to VS Code's command error surface (invariant 2, "no `catch {}` around the
   lookup").
   - `selection.length === 0` → FR-5 case (a): message, stop.
   - `selection.length > 1` → message ("more than one row is selected"), stop. Not reachable
     today (measured point 4); kept so a future `canSelectMany` cannot approve an arbitrary
     one of several.
   - one element, `classifyNode(element)` is `undefined` → FR-5 case (b): message, stop.
   - one element, classified as `kind` → *Confirmation*, then on accept
     `dispatch(kind, element)`: the same call the context-menu path makes, with the tree's
     own node (FR-4). An epic group row with an `epic` dispatches `minspec.acceptEpic` (D3).

Step 0 never reads the active editor, the recently-viewed list, or the spec QuickPick
backstop (FR-4; D2 for the FR-5 cases). Each FR-5 message has the form
`MinSpec: Alt+A in <view name> did nothing - <reason>. Select an approvable row (a spec,
decision or epic) and press Alt+A again.` and is shown with `showInformationMessage`
exactly once per keypress. The reason strings are exported constants so tests assert on
them, not on prose.

### Confirmation (D1, measured point 1)

`confirmTreeTarget(kind, node, viewName): Promise<boolean>` shows a `showQuickPick` with a
single item whose label names the artifact (`SPEC-012: <title>`, `DR-040: <title>`,
`EPIC-003: <title>`, read from the node's `spec` / `adr` / `epic` summary) and whose
detail reads `Approve this spec` / `Accept this decision` / `Accept this epic`; placeholder
`Alt+A in <view name>: confirm the selected row (Enter) or Esc to cancel`;
`ignoreFocusOut: false`. Enter returns the item and the handler dispatches; Esc or a
click elsewhere returns `undefined` and the handler stops with no message (the user
cancelled on purpose). One extra keypress, on the tree path only: steps 1-4 (node, editor,
preview, backstop) are unchanged and never confirm (FR-6).

The label is built by a pure `describeTreeTarget(kind, node)` so the test asserts the
artifact named is the selected one.

### Registration (FR-3)

`packages/minspec/src/extension.ts`, the `minspec.approveActive` registration:

```ts
const treeViewsById: Record<TreeViewId, vscode.TreeView<unknown>> = {
  minspecStatus: specTreeView, minspecAdrs: adrTreeView, minspecBacklog: backlogTreeView,
};
vscode.commands.registerCommand('minspec.approveActive', async (arg) => {
  await approveActiveCommand(arg, { treeSelection: (id) => treeViewsById[id].selection });
}),
```

The command module imports no view and no `TreeView`; tests pass a fake lookup. The
lookup reads `.selection` from memory: no refresh, no GitHub call for the Backlog view
(invariant 1).

### Keybindings (FR-1, FR-7)

`packages/minspec/package.json` `contributes.keybindings`, replacing the one `alt+a` entry:

```json
{ "command": "minspec.approveActive", "key": "alt+a",
  "when": "editorTextFocus || minspec.markdownPreviewActive" },
{ "command": "minspec.approveActive", "key": "alt+a",
  "when": "focusedView == minspecStatus",
  "args": { "source": "tree", "viewId": "minspecStatus" } },
{ "command": "minspec.approveActive", "key": "alt+a",
  "when": "focusedView == minspecAdrs",
  "args": { "source": "tree", "viewId": "minspecAdrs" } },
{ "command": "minspec.approveActive", "key": "alt+a",
  "when": "focusedView == minspecBacklog",
  "args": { "source": "tree", "viewId": "minspecBacklog" } }
```

The four `when` clauses are disjoint (a focused view never has `editorTextFocus`), so
order does not matter. No binding is widened: each clause names one MinSpec view id
(invariant 3).

### The contribution test (FR-7, AC-6)

`packages/minspec/tests/approve-active-keybindings.test.ts` (new) holds a pure checker,
`altAContributionProblems(manifest, treeViewIds)`, local to the test file, returning a list
of problem strings. Rules:

- Every `minspec.approveActive` entry whose `when` contains `focusedView == X` (regex over
  the clause, so `||`/`&&` composites are covered) must: carry
  `args` deep-equal to `{ source: 'tree', viewId: X }`; have X in `treeViewIds`; and name no
  second `focusedView` arm or `editorTextFocus` in the same clause (one view per entry, so
  the `args` is exact).
- Every id in `treeViewIds` must have exactly one such entry.
- At least one entry with no `args` must exist and cover `editorTextFocus` (FR-6: the
  editor path is not lost).

The test runs the checker on the real manifest (expect `[]`) and on two in-memory mutants
of it (AC-6): one adds `|| focusedView == minspecFoo` to the editor entry's `when`, one
deletes the `minspecAdrs` entry. Each mutant must produce a non-empty problem list naming
the id. `treeViewIds` is the handler's exported `TREE_VIEW_IDS`, so adding a view in one
place without the other fails. A third check asserts every `TREE_VIEW_IDS` member is a
`contributes.views` id and `TREE_VIEW_NAMES[id]` equals that view's `name`, so messages
name the view the user sees.

### Header comment (FR-8)

The module header's "Resolution order" list gains step 0 (tree focus, via the keybinding's
`args`, with the confirmation, and the D2 stop), and its step 1 text says a node arrives
from a programmatic or menu call (measured point 8).

## Decisions (recorded alternatives)

- **P1 Confirmation by a one-item QuickPick, not a notification toast.** Enter accepts,
  Esc cancels: one extra keypress, keyboard-first (the founder's keyboard-over-mouse
  preference). It is non-modal (no dialog; the editor is not blocked) and names the
  artifact on screen. Rejected: an information toast with an `Approve` button, which needs
  a focus chord or the mouse to press, so "one extra keypress" would be three; and a
  modal dialog, which the project rejects for approval UX. Cost of the choice: the
  QuickPick takes keyboard focus for one keypress.
- **P2 Confirm on every tree-path press, not only when the split is suspected.** The
  extension cannot observe the focused row (measured point 1), so it cannot tell when the
  selection is stale. Rejected: tracking `onDidChangeSelection` timestamps to skip the
  confirm after a fresh click, which is the mutable focus state D1 (b) was rejected for.
- **P3 Not the internal `$focusedTreeItem` argument.** VS Code's extension host converts an
  argument shaped `{ $treeViewId, $focusedTreeItem: true }` into the view's focused element
  (`extHostTreeViews.ts`, `_convertArgument`); view-title toolbars use it. Putting that
  shape in the keybinding `args` would hand the handler the FOCUSED row and remove the
  confirmation, but it is an undocumented internal contract, and it would replace FR-2's
  approved `{ source, viewId }` contract, which this Plan may not change. Recorded so a
  later spec can weigh it.
- **P4 No new source file.** The spec is `implements: none` ("owned files are fixed at
  Plan"). All logic goes in the existing `approve-active.ts`, `extension.ts` and
  `package.json`, so `implements: none` stays true and requirements.md needs no edit
  (changing `implements:` would alter its canonical hash and void the approval). Rejected:
  a new `tree-focus.ts` module, cleaner ownership at the cost of a re-approval.
- **P5 Multi-selection is a visible stop, not "act on the first".** See *Step 0*, item 4.

## Files

| File | Change | Owned by |
|---|---|---|
| `packages/minspec/src/commands/approve-active.ts` | contract types, `TREE_VIEW_IDS`, `TREE_VIEW_NAMES`, `classifyArg`, step 0, `describeTreeTarget`, `confirmTreeTarget`, message constants, header comment | modifies, not owns |
| `packages/minspec/src/extension.ts` | lookup built from the three `TreeView`s, passed at registration | modifies, not owns |
| `packages/minspec/package.json` | one `alt+a` entry becomes four | modifies, not owns |
| `packages/minspec/tests/approve-active-command.test.ts` | step 0 cases (AC-1 to AC-5) | test file |
| `packages/minspec/tests/approve-active-keybindings.test.ts` | new: FR-7 checker, real manifest + two mutants (AC-6) | test file |

Nothing under `.github/`, `.githooks/` or `.minspec/` changes, so no task needs a
machinery merge.

## Invariants (from requirements.md) and where each is held

- **Constitution 1 (offline).** The lookup reads `TreeView.selection` in memory; no task
  adds a network call. Task 3.1 asserts the lookup is the only selection source.
- **Constitution 2 (no silent gate).** Every non-dispatching tree outcome shows a message
  (tasks 2.1, 2.2), including a missing lookup and an unknown view id; the lookup is not
  wrapped in `catch`. A confirmation cancel is the user's own act, not a gate outcome, and
  shows nothing.
- **Constitution 3 (blast radius).** Each new keybinding is scoped to one MinSpec view id;
  the contribution test (task 4.1) rejects an entry naming no MinSpec view.
- **Approval semantics.** Step 0 only routes to `APPROVE_COMMAND[kind]` with the selected
  node; it never approves a different artifact (AC-1 asserts the unrelated active editor is
  ignored).

## Risks

- **R1 The confirmation reads as ceremony.** One keypress per tree-path approval. Accepted
  under D1; editor-path Alt+A, the common case (measured in the spec: row clicks move focus
  to the editor), never confirms.
- **R2 VSCodium differs from VS Code `main`.** Measured point 1 reads upstream source. AC-7
  (task 6.1) checks both premises in VSCodium; if arrows DO move the selection there, the
  builder removes `confirmTreeTarget` and its test cases in the same pull request, per D1.
- **R3 A future view is added to `when` but not to `TREE_VIEW_IDS`.** That is exactly what
  task 4.1's test fails on.

## Follow-ups (tracked)

None. P3's alternative needs a requirements change and nothing in the next 30 days depends
on it; it stays recorded here only.
