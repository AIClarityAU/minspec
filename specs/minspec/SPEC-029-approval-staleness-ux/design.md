---
id: SPEC-029
type: design
status: implementing
product: minspec
epic: EPIC-002  # Signpost Integrity
---

# MinSpec — Approval-Staleness Prominence + Diff View (Plan)

**Date:** 2026-07-03
**Status:** Plan (SDD Plan phase)
**Reads:** [requirements.md](requirements.md) — FRs, invariants, and the Clarify
decision (dual-list, FR-OQ1) are settled there and not re-litigated here. This
document is HOW, not WHAT/WHY.
**Dependency budget:** **zero new npm dependencies.** Every piece below is
`vscode` built-ins (`TreeDataProvider`, `TextDocumentContentProvider`,
`vscode.diff`) plus functions that already exist in `packages/shared` /
`packages/minspec/src/lib/approval.ts`.

---

## Approach

Two independent slices, buildable and shippable in either order:

- **Slice A (FR-1/2/3/4)** — a second, cross-cutting group in
  `spec-tree-provider.ts`'s existing `getChildren()`, populated by re-filtering
  the same `SpecSummary[]` the status/epic groups already filter. No new data
  source.
- **Slice B (FR-5/6/7/8)** — one new command + one new
  `TextDocumentContentProvider`, both stateless (every value re-derived from
  the spec path on each call, nothing cached or disposed).

Slice A wires into Slice B only at FR-7 (click-through); each is independently
testable and independently shippable if the other slipped.

## UX

The new group renders first, above `Specifying`, in **both** grouping modes
(epic-grouping on or off — see Root-level insertion below). A stale spec's row
is unchanged (FR-3) — same `⚠` icon, same " · stale" description — it simply
now also appears here:

```
MinSpec Explorer
├─ Progress  (rollup — unchanged, still counts SPEC-026 once)
├─ ⚠ Needs Re-Approval (1)                      ← NEW, pinned, always first
│   └─ ⚠ 026: Session Presence · T4 · ▰▰▰▱▱ 60% · plan · stale
│         (click → opens the diff, not the plain file — FR-7)
├─ Specifying (2)
│   └─ 018: Spec Custom Editor · T3 · ▱▱▱▱▱ 0% · specify
│   └─ 029: Approval-Staleness UX · T3 · ▰▱▱▱▱ 20% · plan
├─ Implementing (4)
│   └─ ⚠ 026: Session Presence · T4 · ▰▰▰▱▱ 60% · plan · stale
│         (same spec, same row shape — click here still opens the plain file,
│          because THIS row is not inside Needs-Re-Approval — see FR-7 design)
│   └─ 015: Status Lanes · T3 · ▰▰▰▰▰ 100% · complete
│   └─ ...
├─ Done (…)
└─ Archived (…)
```

The diff view itself (FR-6), opened via VS Code's native side-by-side diff
editor — no custom webview, no new chrome to design:

```
┌─ Approved (2026-07-01T07:51Z)  │  Current ─────────────────────┐
│ ...                            │  ...                          │
│ | D2 | HEAD-switch remediation │  | D2 | HEAD-switch remediat… │
│ | **Auto-revert.** `post-che…  │  | **Auto-revert (agent-str…  │
│ ...                            │  ...  ← native diff coloring  │
└────────────────────────────────┴───────────────────────────────┘
```

## Slice A — the pinned group

### Root-level insertion

`getChildren()` (`spec-tree-provider.ts:384-407`) currently branches:

```ts
if (!element) {
  const allSpecs = this._listSpecs(this.workspaceRoot);
  const root: SpecTreeNode[] = [];
  if (allSpecs.length > 0) root.push(new RollupNode(allSpecs));
  const epicGroups = this.epicGrouping.enabled ? this.getEpicGroups(allSpecs) : null;
  root.push(...(epicGroups ?? this.getStatusGroups(allSpecs)));
  return root;
}
```

The new group is inserted **between** `RollupNode` and the
epic-groups-or-status-groups branch, so it is visible regardless of the
epic-grouping toggle (FR-1 says "most prominent position" — that has to hold in
both view modes, not just the status-lane view):

```ts
if (!element) {
  const allSpecs = this._listSpecs(this.workspaceRoot);
  const root: SpecTreeNode[] = [];
  if (allSpecs.length > 0) root.push(new RollupNode(allSpecs));
  const needsReapproval = this.getNeedsReapprovalGroup(allSpecs);   // NEW
  if (needsReapproval) root.push(needsReapproval);                  // NEW
  const epicGroups = this.epicGrouping.enabled ? this.getEpicGroups(allSpecs) : null;
  root.push(...(epicGroups ?? this.getStatusGroups(allSpecs)));
  return root;
}
```

`getNeedsReapprovalGroup` mirrors `getStatusGroups` (`getStatusGroups`, near the
bottom of the provider) but filters by **approval**, not `status`:

```ts
private getNeedsReapprovalGroup(allSpecs: SpecSummary[]): SpecGroupNode | null {
  const stale = allSpecs.filter(s =>
    // Terminal guard (REQUIRED — see below): a done/archived spec whose sidecar
    // hash drifted still resolves to 'stale', but requirements.md excludes
    // terminal specs from this group. Mirror SpecNode's own `terminal` predicate
    // (spec-tree-provider.ts `const terminal = spec.status === 'done' || 'archived'`).
    s.status !== 'done' && s.status !== 'archived' && this.safeApproval(s) === 'stale',
  );
  if (stale.length === 0) return null; // FR-4: non-empty-only
  return new SpecGroupNode(
    { label: 'Needs Re-Approval', statuses: [], defaultExpanded: true },
    stale,
    'needsReapproval',   // NEW 3rd ctor param — see below
  );
}

/** Same try/catch shape as toSpecNode's approval lookup, pulled out so
 *  getNeedsReapprovalGroup and toSpecNode share one approval lookup — no
 *  second try/catch to drift. */
private safeApproval(spec: SpecSummary): ApprovalStatus {
  try { return this._approvalOf(this.workspaceRoot, spec.filePath); }
  catch { return 'unapproved'; }
}
```

> **Why the terminal guard is load-bearing (Opus review SEV-2, confirmed).**
> `safeApproval` → `getApprovalStatus` → `resolveStatus` (`approval.ts` — the
> `resolveStatus` fn) is **purely hash-based**: it returns `'stale'` whenever
> `record.specHash !== currentHash`, with **zero `status` awareness**. So a
> `done`/`archived` spec edited after approval *does* resolve to `'stale'`.
> Without the guard it enters this group — directly violating requirements.md's
> "a terminal spec never enters the Needs-Re-Approval group" (Failure-Modes /
> Edge-Cases). Worse, `SpecNode` short-circuits terminal specs (the `terminal`
> branch sets `contextValue: 'specNode.terminal'` and shows no stale badge), so
> such a row would render an incoherent, count-inflating, signpost-lying entry
> with `diffOnClick=true` but no menu affordance. The guard lives in the
> **filter**, because the terminal short-circuit in `SpecNode` only affects
> *rendering*, not *group membership*. T1 test: a done/archived spec with a
> hash-drifted sidecar must NOT appear in the group.

`statuses: []` on the passed `StatusGroup`-shaped literal is inert — `SpecGroupNode`'s
constructor (`spec-tree-provider.ts:170-183`) never reads `.statuses`, only
`.label` and `.defaultExpanded`; only the *external* `getStatusGroups` filter
reads `.statuses`. No change needed to `StatusGroup`'s type or to SPEC-015's
`STATUS_GROUPS` array (INV — Orthogonal axes, requirements.md).

### Distinguishing the pinned group in `getChildren`

`SpecGroupNode` gains one new **optional, defaulted** constructor parameter so
`getChildren` can tell which group it is rendering children for, without
touching `contextValue` (menus keyed off `contextValue` today are unaffected):

```ts
export class SpecGroupNode extends vscode.TreeItem {
  public readonly specs: SpecSummary[];
  public readonly kind: 'status' | 'needsReapproval';   // NEW

  constructor(group: StatusGroup, specs: SpecSummary[], kind: 'status' | 'needsReapproval' = 'status') {
    ...
    this.kind = kind;
  }
}
```

`getChildren`'s existing `SpecGroupNode` branch (`spec-tree-provider.ts:397-399`)
threads it through to `toSpecNode`'s existing `epicGrouped`-style third
parameter:

```ts
if (element instanceof SpecGroupNode) {
  return element.specs.map(spec => this.toSpecNode(spec, false, element.kind === 'needsReapproval'));
}
```

### `SpecNode` — conditional click-through (FR-7)

`toSpecNode` and `SpecNode`'s constructor both gain one new optional boolean,
`diffOnClick`, exactly mirroring the existing `epicGrouped` precedent (same
file, same pattern, no new abstraction):

```ts
private toSpecNode(spec: SpecSummary, epicGrouped = false, diffOnClick = false): SpecNode {
  const approval = this.safeApproval(spec);
  return new SpecNode(spec, approval, epicGrouped, diffOnClick);
}
```

```ts
export class SpecNode extends vscode.TreeItem {
  constructor(
    public readonly spec: SpecSummary,
    public readonly approval: ApprovalStatus = 'unapproved',
    epicGrouped = false,
    diffOnClick = false,   // NEW — true only for the row rendered under Needs-Re-Approval
  ) {
    ...
    // Click-through passes the STRING spec.filePath. The command handler
    // (Slice B) accepts `SpecNode | string` and normalizes — because the
    // context-menu invocation (FR-5) instead delivers the selected SpecNode
    // object, per VS Code's tree-command convention. See "Command arg
    // normalization" in Slice B.
    this.command = diffOnClick
      ? { command: 'minspec.showChangesSinceApproval', title: 'Show Changes Since Approval', arguments: [spec.filePath] }
      : { command: 'vscode.open', title: 'Open Spec', arguments: [vscode.Uri.file(spec.filePath)] };
    ...
  }
}
```

This is FR-1's dual-list requirement made concrete: the **same underlying
spec** produces two `SpecNode` instances (one per group it renders in) — cheap
(a few fields), and each instance's `command` is independently correct for
where it is sitting. Icon/description/tooltip construction (the icon/description/
tooltip block in `SpecNode`'s constructor) is untouched by `diffOnClick`, so
FR-3 (existing signal preserved, identical in both places) holds by
construction, not by a parallel code path.

### `RollupNode` — no change required

`RollupNode` is constructed once, from `allSpecs` (the flat `SpecSummary[]` from
`listSpecs`), not from rendered tree nodes. Dual-listing only changes how many `SpecNode` *instances* exist for one
`SpecSummary` — `RollupNode` never sees tree nodes, so it already counts each
spec exactly once. **FR-4's roll-up-dedupe requirement needs zero code
change** — flagging this since requirements.md worried it might; the concern
turned out to be pre-empted by the existing architecture (allSpecs-based
rollup, not node-based).

## Slice B — the diff command

### Contracts

```ts
// packages/minspec/src/lib/approval-diff.ts (new, Tier-0: vscode + fs + the
// two existing pure functions below — no new dependency)
import * as fs from 'fs';
import { recoverBaseline, getApprovalRecord } from './approval';
import { getSpecBodyOnly } from '@aiclarity/shared';

export type DiffSide = 'approved' | 'current';

/** Re-derive one side's text on demand — nothing is cached (INV — no fabricated diff,
 *  and it sidesteps any disposal/staleness question: there is no state to go stale). */
export function resolveDiffSide(rootDir: string, specFilePath: string, side: DiffSide): string | undefined {
  if (side === 'current') {
    try { return getSpecBodyOnly(fs.readFileSync(specFilePath, 'utf-8')); } catch { return undefined; }
  }
  // getApprovalRecord takes the ABSOLUTE spec path and relativizes internally
  // (its body is `readRecord(rootDir, specRelPath(rootDir, specFilePath))`).
  // Do NOT pre-apply specRelPath — that double-relativizes (Opus review SEV-1,
  // confirmed: path.relative(rootDir, <already-relative>) resolves against the
  // extension host's cwd, not the workspace root → the lookup misses for every
  // spec → the diff never opens). Pass specFilePath straight through, exactly
  // like every real caller (getApprovalStatus, trust-metrics).
  const record = getApprovalRecord(rootDir, specFilePath);
  if (!record) return undefined;
  return recoverBaseline(rootDir, record); // undefined on any failure (FR-8) — never throws
}
```

### URI scheme (Costly #3)

`minspec-approval-diff:` (namespaced, per Costly #3). One
`TextDocumentContentProvider`, registered once at activation:

```ts
// URI shape: minspec-approval-diff:/<side>/<base64url(specFilePath)>
const scheme = 'minspec-approval-diff';

class ApprovalDiffContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private rootDir: string) {}
  provideTextDocumentContent(uri: vscode.Uri): string {
    const [, side, encodedPath] = uri.path.split('/'); // '' / side / encodedPath
    const specFilePath = Buffer.from(encodedPath, 'base64url').toString('utf-8');
    const text = resolveDiffSide(this.rootDir, specFilePath, side as DiffSide);
    return text ?? ''; // FR-8: command itself gates on undefined BEFORE opening the
                        // diff (see below) — this fallback only matters if VS Code
                        // re-requests content after the doc is already open.
  }
}
```

Stateless by design: nothing is stored per-URI, so there is nothing to
dispose when the user closes the diff tab — VS Code's normal virtual-document
lifecycle handles it. This resolves the "how are the two docs addressed and
disposed" question raised at Specify: **they aren't disposed by us at all,
because we hold no per-document state.**

### Command arg normalization (Opus review SEV-2, confirmed)

The command is reached two ways with **different arg shapes**, so the handler
MUST normalize:

- **FR-7 tree click** — `SpecNode.command.arguments = [spec.filePath]` delivers
  a **string** (VS Code passes `command.arguments` positionally, verbatim).
- **FR-5 context menu** — VS Code passes the **selected `SpecNode` object** as
  arg0 (the established tree-command convention; the existing `minspec.*` tree
  commands are registered `(node) => cmd(node)` and read `node.spec.filePath`).

`rootDir` is **not** a passed arg — it is injected by the registration closure,
matching the existing `goToSpecCommand(workspaceRoot, …)` registration pattern
in `extension.ts`:

```ts
// extension.ts registration (surgical addition — one block, no surrounding edits):
context.subscriptions.push(
  vscode.commands.registerCommand('minspec.showChangesSinceApproval',
    (arg?: SpecNode | string) => showChangesSinceApproval(workspaceRoot, arg)),
  vscode.workspace.registerTextDocumentContentProvider(
    'minspec-approval-diff', new ApprovalDiffContentProvider(workspaceRoot)),
);
```

### Command

```ts
// minspec.showChangesSinceApproval
async function showChangesSinceApproval(rootDir: string, arg?: SpecNode | string): Promise<void> {
  // Normalize both invocation shapes (tree click → string; context menu → SpecNode).
  // Palette-with-no-arg (FR-5 second surface) falls back to the active editor.
  const specFilePath =
    typeof arg === 'string' ? arg
      : arg?.spec?.filePath
        ?? vscode.window.activeTextEditor?.document.uri.fsPath;

  const degrade = (msg: string) => vscode.window.showInformationMessage(msg);

  if (!specFilePath) { degrade('No spec selected — open or select a spec to show its changes since approval.'); return; }

  // FR-8: gate the APPROVED side (no getApprovalRecord double-relativize — pass
  // the absolute path straight through, as in resolveDiffSide).
  const record = getApprovalRecord(rootDir, specFilePath);
  const approved = record ? recoverBaseline(rootDir, record) : undefined;
  if (approved === undefined) {
    degrade('Baseline unavailable for this spec — cannot show what changed; re-approving will restore diffing for future edits.');
    return;
  }
  // SEV-3: gate the CURRENT side too — the file can be deleted/unreadable between
  // the stale-flagged render and the click (TOCTOU). Do NOT let it degrade to ''
  // and render a false "everything deleted" diff.
  const current = resolveDiffSide(rootDir, specFilePath, 'current');
  if (current === undefined) {
    degrade('This spec file is no longer readable — cannot show what changed.');
    return;
  }

  const enc = (p: string) => Buffer.from(p, 'utf-8').toString('base64url');
  const approvedUri = vscode.Uri.parse(`minspec-approval-diff:/approved/${enc(specFilePath)}`);
  const currentUri = vscode.Uri.parse(`minspec-approval-diff:/current/${enc(specFilePath)}`);
  const label = path.basename(path.dirname(specFilePath));
  await vscode.commands.executeCommand(
    'vscode.diff', approvedUri, currentUri,
    `${label}: Approved (${record!.approvedAt}) ↔ Current`,
  );
}
```

**Both sides gated before any URI opens (FR-8 + SEV-3 fix).** The earlier draft
gated only the `approved` side and asserted "only the approved side can be
genuinely unrecoverable" — false: `resolveDiffSide('current')` has its own
`catch → undefined` for a file deleted/unreadable at click time (a real TOCTOU
window, since the row was flagged `stale` at an earlier render). Gating both
means the `provideTextDocumentContent` `?? ''` fallback is only ever reachable
if VS Code re-requests content **after** the tab is already open (e.g. a manual
"Revert File") — never a path this feature's own code triggers.

### `contextValue` — one new value, **and the exact-match menu clauses it breaks**

`SpecNode`'s `contextValue` currently collapses every non-terminal,
non-approved spec (both `unapproved` and `stale`) into the same `'specNode'`
value — too coarse to scope a context-menu item to stale specs only (FR-5's
menu entry must not show on a merely `unapproved` spec, which has no baseline
to diff against per FR-OQ3's resolution). One new branch:

```ts
this.contextValue = terminal ? 'specNode.terminal'
  : approval === 'approved' ? 'specNode.approved'
  : approval === 'stale' ? 'specNode.stale'      // NEW
  : 'specNode';
```

> **CRITICAL — this retag silently removes Approve-Spec + Classify from stale
> specs unless the existing exact-match clauses are widened (Opus review SEV-1,
> confirmed).** Today a stale spec falls through to bare `'specNode'`. Three
> existing menu entries match by **exact equality** `viewItem == specNode`, not
> the prefix regex: `minspec.classify`, and `minspec.approveSpec` (its inline
> **and** its `2_approval` entry). Retagging stale rows to `specNode.stale`
> makes `== specNode` stop matching — so **Approve Spec (the re-approval action)
> and Classify vanish from exactly the "Needs Re-Approval" specs the new group
> exists to prompt.** Since `revokeApproval` is gated on `specNode.approved`,
> `approveSpec` is the *only* re-approve affordance — losing it removes the
> feature's own remediation. (The `viewDesign`/`viewTasks` entries use
> `=~ /^specNode/` and survive — which is precisely why the break is easy to
> miss.) The fix is to widen those three exact clauses to an alternation that
> also matches `specNode.stale` — see the `package.json` edits below, which are
> **mandatory**, not additive-only.

### `package.json` additions **and required edits**

**Add** the command + its stale-scoped menu entry:

```jsonc
// contributes.commands — ADD
{
  "command": "minspec.showChangesSinceApproval",
  "title": "MinSpec: Show Changes Since Approval",
  "icon": "$(diff)"
}

// contributes.commands — ADD: FR-5 palette surface, ENABLED (not when:false).
// FR-5 requires palette availability "when the active editor is a stale spec";
// the handler's activeTextEditor fallback + degrade-if-not-stale gate enforces
// that at invocation time (a static menu `when` can't read editor content).
// contributes.menus["commandPalette"] — ADD
{ "command": "minspec.showChangesSinceApproval", "when": "editorLangId == markdown" }

// contributes.menus["view/item/context"] — ADD (stale-scoped)
{
  "command": "minspec.showChangesSinceApproval",
  "when": "view == minspecStatus && viewItem == specNode.stale",
  "group": "2_approval@1"
}
```

**Edit** (mandatory — the SEV-1 fix): widen the three existing exact-match
`view/item/context` clauses so a `specNode.stale` row keeps Classify + Approve:

```jsonc
// minspec.classify — was:  "viewItem == specNode"
"when": "viewItem =~ /^specNode(\\.stale)?$/",

// minspec.approveSpec (inline)   — was:  "view == minspecStatus && viewItem == specNode"
"when": "view == minspecStatus && viewItem =~ /^specNode(\\.stale)?$/",

// minspec.approveSpec (2_approval) — was:  "view == minspecStatus && viewItem == specNode"
"when": "view == minspecStatus && viewItem =~ /^specNode(\\.stale)?$/",
```

`/^specNode(\.stale)?$/` matches exactly `specNode` and `specNode.stale` and
**not** `specNode.approved`/`specNode.terminal` (which must keep their distinct
menus). New context-menu entry grouped under `2_approval` alongside
`approveSpec`/`revokeApproval` — same family of actions, consistent ordering.
**A T1/menu test asserts Approve Spec + Classify remain visible on a
"Needs Re-Approval" (`specNode.stale`) row.**

## API

No network/HTTP surface (Tier-0 throughout — INV — Tier-0 core). "API" here is
the one new pure module's exported contract, already shown under Contracts
above (`resolveDiffSide`, `DiffSide`).

## Data model

**None.** No new field on `ApprovalRecord`, no new file, no new persisted
state anywhere (FR-2's "live, not persisted" made concrete: `getChildren` and
the diff command both re-derive everything from the existing sidecar +
git blob + current file on every call).

## Build order (vertical slice)

1. **Slice A first, end-to-end for one spec.** `SpecGroupNode.kind`,
   `getNeedsReapprovalGroup`, root-level insertion, `SpecNode.diffOnClick`
   wired to a **placeholder command** (`vscode.window.showInformationMessage`
   stub) — proves the group renders, dual-lists, and click-routes correctly
   before Slice B exists.
2. **Slice B**, `approval-diff.ts` + `ApprovalDiffContentProvider` +
   `showChangesSinceApproval`, tested standalone against SPEC-026's real
   `.minspec/approvals/` sidecar (a genuine stale spec already in this repo —
   no fixture needed for the first manual smoke test).
3. **Wire Slice A's placeholder to the real command** (one-line swap).
4. **`contextValue: 'specNode.stale'` + `package.json`: add the new command /
   palette / context-menu entries AND widen the three exact-match
   `viewItem == specNode` clauses (classify + approveSpec ×2) to
   `=~ /^specNode(\.stale)?$/` — the mandatory SEV-1 fix so Approve/Classify
   survive on stale rows. Land the menu-preservation test with this step.**

## Test plan

| FR | Tier | Assertion |
|---|---|---|
| FR-1 | T1 | `getChildren(undefined)` on a fixture with one stale + one clean spec returns a "Needs Re-Approval" `SpecGroupNode` first, containing only the stale spec, regardless of `epicGrouping.enabled`. |
| FR-2 | T1 | Flipping the injected `approvalFn`'s return for a spec from `'stale'` to `'approved'` between two `getChildren()` calls removes it from the group on the second call. |
| FR-3 | T0 | A `SpecNode` built with `diffOnClick=true` has identical `iconPath`/`description`/`tooltip` to one built with `diffOnClick=false` for the same `(spec, approval)` — only `.command` differs. |
| FR-4 | T1 | Zero stale specs → `getNeedsReapprovalGroup` returns `null`, no empty group renders. `RollupNode` built from a fixture with one dual-listed spec reports the same `active.length` as one without the second listing (proves the "zero code change" claim, not just asserts it). |
| FR-1 terminal-guard | T1 | **(SEV-2 fix)** A `done`/`archived` spec with a hash-drifted sidecar (resolves `'stale'`) does **NOT** appear in the Needs-Re-Approval group. |
| FR-5/6 | T1 | `resolveDiffSide(root, path, 'approved')` returns exactly `recoverBaseline`'s output (called with the **absolute** path — no double-relativize); `'current'` returns exactly `getSpecBodyOnly(fs.readFileSync(...))`'s output. |
| FR-5 arg-shape | T1 | **(SEV-2 fix)** `showChangesSinceApproval` resolves the spec path from all three inputs: a string arg (tree click), a `SpecNode` arg (context menu), and no arg + a stale spec in the active editor (palette). |
| FR-5 palette | T1 | **(SEV-2 fix)** Invoked from the palette with the active editor on a non-stale (or non-spec) document, it shows the degrade message and opens no diff; on a stale spec it opens the diff. |
| FR-5 menu-preservation | T0 | **(SEV-1 fix)** With a `specNode.stale` `viewItem`, the `minspec.classify` and both `minspec.approveSpec` `when`-clauses (`=~ /^specNode(\.stale)?$/`) still evaluate true; `specNode.approved`/`specNode.terminal` do not gain them. |
| FR-7 | T1 | A `SpecNode` from the Needs-Re-Approval group's `.command.command === 'minspec.showChangesSinceApproval'`; the same spec's node from its lifecycle group has `.command.command === 'vscode.open'`. |
| FR-8 approved-side | T1 | `showChangesSinceApproval` with a record whose `baselineBlob === ''` (or a SHA `git cat-file` fails on) shows the degrade message and never calls `vscode.commands.executeCommand('vscode.diff', ...)`. |
| FR-8 current-side | T1 | **(SEV-3 fix)** With a recoverable baseline but the spec file deleted/unreadable at click time, it shows the degrade message and opens no diff (no false "everything deleted" render). |
| INV-Orthogonal-axes | T0 | `STATUS_GROUPS` array snapshot unchanged; `SpecStatus` string-literal union unchanged. |
| INV-Tier-0 | T0 | Inherited import-ban test covers the new `approval-diff.ts` module too. |

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | A third `getChildren` root-level branch order (Rollup → NeedsReapproval → epic/status) becomes a fourth thing to keep in sync if a future group is added. | Small, explicit, linear `if` chain — no abstraction warranted at this scale (3 branches); revisit only if a 4th cross-cutting group is proposed. |
| R2 | `base64url` path-encoding in the diff URI could collide/mis-decode on an unusual spec path (spaces, unicode). | `Buffer.from(...).toString('base64url')` round-trips any UTF-8 path losslessly; T1 test with a spec dir containing a space, confirming round-trip. |
| R3 | **(Opus review SEV-1 — was under-scoped here.)** Introducing `contextValue: 'specNode.stale'` silently strips **Approve Spec + Classify** from stale rows, because three existing menus match `viewItem == specNode` by **exact equality** — removing the feature's own re-approval affordance. | Widen those three clauses to `=~ /^specNode(\.stale)?$/` (mandatory `package.json` edit, above) + a T0 menu-preservation test. NOT just "avoid a typo in the new entry" — the regression is in the *existing* entries. |
| R4 | Command-arg shape mismatch: tree click delivers a string, context menu delivers a `SpecNode` — one handler must consume both. | Handler normalizes `SpecNode \| string \| undefined` (→ active-editor fallback); registration closure injects `workspaceRoot`, matching `goToSpecCommand`. Covered by the FR-5 arg-shape test. |

## Open plan questions

- **~~Command-palette invocation~~ — RESOLVED (Opus review SEV-2).** The earlier
  "omit for v1, `when:false`" leaning **violated FR-5**, which requires the
  command be available "from the command palette when the active editor is a
  stale spec" — a settled requirement, not a nicety. Now implemented: palette
  entry `when: editorLangId == markdown`, and the handler resolves the active
  editor when invoked with no node, gating/degrading if it is not a stale spec.
  No longer open.
- **`vscode.diff` title format.** The sketch uses the spec's directory name
  (`path.basename(path.dirname(...))`) as the label; confirm at implement that
  this reads better than the full `SPEC-NNN` id once seen in the actual tab bar
  (cosmetic, non-blocking).

## Deferred & Follow-ups

- Everything already listed in requirements.md's own Follow-ups /
  Out-of-scope sections (pre-commit race hardening —
  [harvest316/minspec#424](https://github.com/harvest316/minspec/issues/424);
  DR/ADR parity) is unchanged by this plan and not repeated here.
- **SPEC-018 webview highlight layering (strengthened at Clarify follow-up,
  2026-07-03) — the committed successor to FR-6, not a someday-maybe.** Once
  SPEC-018 ships, `showChangesSinceApproval` swaps its `vscode.diff` call for
  mounting `resolveDiffSide`'s two bodies in SPEC-018's webview with inline
  highlighted-section rendering, reusing SPEC-014's render function (no second
  markdown path, per SPEC-018 FR-6). `resolveDiffSide` and `approval-diff.ts`
  are written so this swap only touches the *rendering* call-site — the diff
  *sourcing* (FR-5's baseline/current resolution) is unchanged either way.

## Plan review (Opus adversarial pass, 2026-07-03)

This design.md was re-reviewed by a 5-lens Opus adversarial workflow (each
finding independently verified by a default-refute skeptic against the real
code). **7 defects confirmed and fixed in place above**, none requiring an
architectural rethink:

| # | Sev | Defect | Fix location |
|---|---|---|---|
| 1 | SEV-1 | `getApprovalRecord(rootDir, specRelPath(...))` double-relativizes → diff never opens | `resolveDiffSide` + Command: pass absolute path |
| 2 | SEV-1 | `specNode.stale` retag strips Approve/Classify (exact `== specNode` menus) | `package.json`: widen 3 clauses to `=~ /^specNode(\.stale)?$/` |
| 3 | SEV-2 | Command arg shape (string vs `SpecNode`) unreconciled | "Command arg normalization" + R4 |
| 4 | SEV-2 | `getNeedsReapprovalGroup` filter lacked terminal guard | filter: `status !== done/archived &&` |
| 5 | SEV-2 | FR-5 palette surface dropped (`when:false`) | palette entry enabled + active-editor fallback |
| 6 | SEV-3 | `current`-side read failure ungated → false full-deletion diff | Command: gate current side too |
| 7 | SEV-3 | drifted line-number citations | re-anchored to symbol names |

The two SEV-1s were exactly the class of plausible-but-wrong error the review
was commissioned to catch: both would have compiled and *looked* right, then
shipped broken (the diff silently never opening; the re-approval button silently
vanishing from the specs that need it).
