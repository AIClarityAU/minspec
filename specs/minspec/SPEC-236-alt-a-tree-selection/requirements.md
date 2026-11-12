---
id: SPEC-236
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - Alt+A is the one-keystroke approve/accept for every approvable
aspects: [keybinding, approve-active, tree-views, no-silent-gate, offline]
depends_on: []
relates_to: ["#2118", "#440", "#2117", "#303", "#377", "#936", "#950", "#357"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec owns is fixed at Plan, after Decision D1
  (expected: packages/minspec/package.json keybindings, packages/minspec/src/commands/approve-active.ts,
  and the command registration in packages/minspec/src/extension.ts).
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-236: Alt+A pressed while a MinSpec tree view is focused acts on that tree's selected row

> **This is a SPECIFICATION ONLY.** Written for issue #2118 (Alt+A advertises tree focus but
> never reads the tree selection). Nothing is built until a human reads it, resolves
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it. No decision record:
> every option here is a keybinding and command-routing change, undoable in well under a day
> (the parent-register ADR filter: record only choices not undoable in under a day).

## In plain terms

The Alt+A keybinding says it works when the Specs, Decisions or Backlog tree is focused. It
does not: the handler never looks at what is selected in the tree, so a keypress there falls
through to the "recently viewed" picker. This spec makes a tree-focused Alt+A act on the
tree's selected row, and makes every case where it cannot do that say so.

## Root-cause diagnosis (read from code at 7a200191)

- **Contribution.** `packages/minspec/package.json:274-277` binds `alt+a` to
  `minspec.approveActive` with `when: editorTextFocus || minspec.markdownPreviewActive ||
  focusedView == minspecStatus || focusedView == minspecAdrs || focusedView == minspecBacklog`.
- **Handler.** `packages/minspec/src/commands/approve-active.ts:258-297`
  (`approveActiveCommand(node?)`) resolves in four steps: passed node (`classifyNode`, :60),
  active text editor (`activeEditorPath`, :79), most-recently-viewed picker
  (`pickRecentApprovable`), then the spec QuickPick. No step reads a tree selection.
- **The mechanism.** A keybinding invocation passes no argument (the contribution has no
  `args`), so step 1 only fires for menu/context-menu invocations, which pass the clicked node.
  The three `focusedView` arms of the `when` clause therefore reach step 2 with whatever
  editor is active, or step 3.
- **The unused input.** All three views are built with `createTreeView`
  (`packages/minspec/src/extension.ts:158-167`), so each has `.selection`; a grep of
  `packages/minspec/src` for `.selection` finds only text-editor selections
  (`packages/minspec/src/views/codelens-provider.ts`), never a tree view's.
- **The missing gate.** No test exercises the `focusedView` arms of the `when` clause against
  the handler, so the contribution and the handler drifted apart without anything failing.
  FR-7 closes that.
- **Why it is mostly hidden.** Row commands open the file with `preserveFocus: false`
  (`packages/minspec/src/views/spec-tree-provider.ts:214`, `packages/minspec/src/views/adr-tree-provider.ts:74`,
  `packages/minspec/src/views/epic-grouping.ts:108`), so clicking a row moves focus to the editor and step 2 then
  resolves correctly. The gap shows when the view is focused without re-triggering a row
  ("Focus on ... View", clicking the view header), leaving an older selection and an unrelated
  editor.

**Not established:** whether this is what the founder hit when reporting that Alt+A "doesn't
work". Unexcluded alternatives: a VSCodium-side binding conflict, a stale installed build
(#357), #936 (Alt+A on a phase file silently no-ops), #950 (Alt+N dead on macOS). This spec
fixes the defect it names and claims nothing about that report.

## Functional requirements

**FR-1. Tree focus is known at keypress, not inferred.** When Alt+A fires because a MinSpec
tree view holds focus, the handler learns WHICH view is focused from the keypress itself, as
evaluated by the editor's `when` context at that moment. Recommended mechanism (D1-a): split
the keybinding into one entry for `editorTextFocus || minspec.markdownPreviewActive` (no args,
today's behaviour) and one entry per view (`focusedView == <id>`) carrying
`args: { source: 'tree', viewId: '<id>' }`. The handler keeps no mutable focus state for this.

**FR-2. Argument contract.** `approveActiveCommand` accepts, as its first argument, either a
tree node (unchanged) or a tree-focus marker:

```ts
type TreeViewId = 'minspecStatus' | 'minspecAdrs' | 'minspecBacklog';
interface TreeFocusArgs {
  readonly source: 'tree';
  readonly viewId: TreeViewId;
}
```

A value is a marker only if `source === 'tree'` and `viewId` is one of the three ids; any
other value is classified exactly as today (`classifyNode`). An unknown `viewId` is reported
visibly (FR-5), never treated as "no argument".

**FR-3. Selection lookup is injected, not global.** The handler reads a view's selection
through a lookup supplied at registration (`(viewId) => readonly unknown[]`, built in
`extension.ts` from the three `TreeView` objects), so the command module does not import the
views and stays unit-testable with a fake lookup.

**FR-4. A selected approvable row is acted on directly.** With a marker and exactly one
selected element that `classifyNode` classifies, Alt+A dispatches to that kind's existing
command with that element, exactly as a context-menu invocation on that row does today. It
never consults the active editor or the recently-viewed list in this case.

**FR-5. Every non-actionable tree case says so (no silent fallthrough).** With a marker and
(a) an empty selection, (b) a selected element that is not an approvable (a backlog issue, a
status group, a message row), or (c) an unknown `viewId`, Alt+A shows one information message
naming the view and why nothing was approved, and then behaves per D2. It never silently
approves something other than the selected row.

**FR-6. Editor and preview paths unchanged.** Invocations with no argument, or with a tree
node, resolve exactly as today (steps 1-4 of the module header). Today's tests for those paths
pass unmodified.

**FR-7. Contribution and handler cannot drift again.** A test reads the `alt+a` entries from
`packages/minspec/package.json` and asserts that every `focusedView == X` arm in any `when`
clause has a matching entry whose `args.viewId` is X and that X is in the `TreeViewId` set the
handler accepts. Adding a view to the `when` clause without wiring it fails this test.

**FR-8. Header comment matches behaviour.** The resolution-order comment at the top of
`approve-active.ts` lists the tree-focus step in its real position.

## Acceptance criteria

- **AC-1.** Fake lookup returns one spec node for `minspecStatus`; invoking the handler with
  `{source:'tree', viewId:'minspecStatus'}` while an unrelated DR editor is active dispatches
  `minspec.approveSpec` with that node, and not `minspec.acceptAdr`.
- **AC-2.** Same for `minspecAdrs` with an ADR node: dispatches `minspec.acceptAdr` with it.
- **AC-3.** An epic group node selected in `minspecStatus` routes per D3.
- **AC-4.** Empty selection, a backlog issue node, and an unknown `viewId` each produce exactly
  one information message and no dispatch of a different artifact than the one selected
  (then D2's behaviour).
- **AC-5.** No-argument invocation with an approvable editor active dispatches as today;
  menu invocation with a node dispatches as today (existing tests unmodified and green).
- **AC-6.** The FR-7 contribution test fails when a mutant adds `focusedView == minspecFoo` to
  the `when` clause without an args entry, and when a mutant deletes one per-view entry.
- **AC-7.** Manual, in VSCodium (the founder's editor), recorded in the PR: focus the Specs
  view via "Focus on Specs View" with an older row selected and a DR editor open, press Alt+A,
  observe the selected spec routed. Plan confirms first that VSCodium honours `args` on a
  contributed keybinding (I believe it does, as VS Code does; unverified here).

## Invariants this change must not break

- **Constitution 1 (offline).** No network call is added; the Backlog view's selection is read
  from memory, never refreshed from GitHub by Alt+A.
- **Constitution 2 (no silent gate).** Every tree case that does not approve the selected row
  is visible (FR-5); no `catch {}` around the lookup.
- **Constitution 3 (blast radius).** Keybinding entries stay scoped to MinSpec's own view ids;
  no global or editor-wide binding is widened. The approve commands keep enforcing the opt-in
  marker as today (`commands/approve.ts`).
- **Approval semantics.** Alt+A only routes; it never re-implements approve/accept logic and
  never approves a different artifact than the one the user selected or is editing.

## Decisions needed (Clarify)

All 3 decisions are answered, not ratified: an agent session selected, for each, the option this
document already recommended. No human chose them, and no delegation covers authoring Clarify
answers. Delegation DLG-001 (DR-108) made none of these selections and covers spec approval and
engineering-DR acceptance only. An agent-recorded selection carries no consent, whoever prompted
it. It is ratified only by approval of this spec, the founder's or the bot's under DLG-001, and
that approval may overturn it.

**D1. How the handler learns that a tree is focused.**

**Recorded selection: Option (a),** per-view keybinding entries carrying `args` (FR-1),
verifying the focus/selection split first and adding the tree-path confirmation only if
it is real.

- **(a) (rec)** Per-view keybinding entries carrying `args` (FR-1). The editor evaluates
  `focusedView` at the keypress, so the answer is exact and needs no stored state. Cost: three
  extra keybinding entries to keep aligned with the views (FR-7 tests that), and the selected
  row may not be the row under the keyboard cursor (see the risk below).
- (b) The issue's option: track most-recent interaction across the three views and the editor,
  and resolve from the tree when a view was touched last. Cost: new mutable focus state, and
  it can act on a stale tree selection when the user believes the editor is active, which for
  a one-keystroke approval with no confirmation means approving the wrong artifact. Rejected
  in favour of (a), which gets the same information exactly.
- (c) Drop the three `focusedView` arms from the `when` clause. Cost: removes the keyboard path
  instead of fixing it; a keyboard-first user in the tree loses Alt+A.

**Risk under (a) and (b) alike:** I believe, unverified, that in a VS Code custom tree arrow
keys move the keyboard focus without changing `.selection` (selection changes on click or
Enter), and that the API exposes no focused-element accessor. If so, a user who arrows to row B
after selecting row A and presses Alt+A gets A approved. Plan must check this in VSCodium. If it
holds, the safe variant is: when a marker resolves a selection, show a non-modal confirmation
naming the artifact before dispatching (one extra keypress, tree path only).
- **(rec)** Verify first; add the tree-path confirmation only if the focus/selection split is
  real. Cost: Plan carries an editor experiment before the design is final.

**D2. What happens after the FR-5 message.**

**Recorded selection: Option (a),** stop after the FR-5 message, without continuing to the
recently-viewed picker.

- **(a) (rec)** Stop there. The user was in the tree, so the recently-viewed picker answers a
  question they did not ask. Cost: one more keypress (click the row) to get the approval.
- (b) Continue to the recently-viewed picker (step 3), as today. Cost: keeps the confusing
  behaviour the issue reports, now with a message in front of it.

**D3. Epic group rows.** Epic group nodes in the Specs and Backlog trees carry `.epic`, so
`classifyNode` routes them to `minspec.acceptEpic`.

**Recorded selection: Option (a),** keep routing epic group rows to `minspec.acceptEpic`,
matching the row's context-menu Approve/Accept.

- **(a) (rec)** Keep that: it matches what the row's context-menu Approve/Accept already does.
  Cost: Alt+A on a group header accepts the epic in one keystroke, which a user collapsing
  groups may not expect.
- (b) Treat group rows as non-approvable on the keyboard path (FR-5). Cost: the keyboard and
  context-menu paths disagree on the same row.

## Out of scope

- The founder's "Alt+A doesn't work" report as a whole, #936 and #950 (separate issues).
- Any change to the approve/accept commands themselves, or a staleness signal for installed
  builds (#357).

## Follow-ups (tracked)

None. D1's verification is part of this spec's Plan, not a separate item.
