---
id: SPEC-256
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-256 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - Alt+A is the one-keystroke approve/accept for every approvable
relates_to: ["#2519", "#2117", "#2370", "#440", "#630", SPEC-236, SPEC-238]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-256 - Design: a flat-layout terminal spec with a stale approval has an approve path (Plan)

Plan for [requirements.md](requirements.md) (APPROVED; read, never edited by this Plan),
built under the three recorded Clarify selections: D1 option (a) (focused-file
classification recognises any file `listSpecs` returns), D2 option (a) (a never-approved
terminal spec may be approved through the focused-file path, and the toast says it was
never approved), D3 option (a) (keep the pure `classifyApprovablePath`; add a
config-aware resolver used only by Alt+A step 2). Citations of "today" are against
`origin/main` `8b3c0017`. New code is named by symbol, because its line numbers will move.
The task list is [tasks.md](tasks.md).

## Approach in one paragraph

Alt+A's step 2 (`approveActiveCommand`, `packages/minspec/src/commands/approve-active.ts:269-290`) keeps its
filename classifier for split-layout specs, decisions and epics. When that classifier
returns nothing, a new step 2b asks a new vscode-free resolver,
`findSpecForFile(rootDir, fsPath)` in `packages/minspec/src/lib/spec-catalog.ts`, whether the focused file is
the representative file `listSpecs` returns for some spec in the folder that contains it.
If it is, Alt+A dispatches `minspec.approveSpec` with that spec node, which already
bypasses the picker's terminal filter (`packages/minspec/src/commands/approve.ts:66`) and already refuses to
downgrade a terminal status (`approve.ts:384`, `wasPreImpl`). If it is not, Alt+A falls
through to step 3 exactly as today. Separately, the two pickers that drop terminal specs
(the palette/backstop picker in `approve.ts` and the recently-viewed picker in
`approve-active.ts`) stop dropping them silently: they name every dropped terminal spec
whose approval is stale, its literal status, and "open its file and press Alt+A"
(FR-4). The approval toast says when a terminal spec had never been approved (D2).

## What Plan measured that the spec did not know

Each was read in code at `8b3c0017`, not inferred.

1. **The issue's diagnosis holds.** `classifyApprovablePath` is a basename test
   (`packages/minspec/src/lib/approvable.ts:26`, `:41`); the palette picker's filter is
   `status !== 'approved' && !isTerminalSpecStatus(s.status)` (`approve.ts:257`); a passed
   node returns before the picker (`approve.ts:66`). Step 2 resolves a classified spec by
   exact path against `listSpecs(root)` (`approve-active.ts:121-123`) and dispatches it
   (`:273-275`). So the gap is classification only, as the spec says.
2. **`listSpecs` already returns flat files.** It walks every `.md` under the configured
   `specsDir`, keys each by its frontmatter `id`, and keeps the lowest-rank file as the
   representative: `requirements.md` 0, `spec.md` 1, `design.md` 2, anything else 3
   (`packages/minspec/src/lib/spec-catalog.ts:69-73`, `:104-106`). A flat `specs/SPEC-001-foo.md` is the only
   file for `SPEC-001`, so it is the representative. A file with no `id:` is skipped
   (`:90`), which is what keeps a `README.md` out (AC-6). `listSpecs` does not read
   `specsLayout` at all: the resolver therefore works for every layout without branching
   on it.
3. **A shard is never the representative when its spec has a `requirements.md`.** A
   split-layout `design.md` or `tasks.md` carrying the same `id` ranks below
   `requirements.md`, so it is not returned and stays un-approvable, as #630 narrowed it.
   Checked on this repo's own flat set: `specs/minspec/{requirements,design,tasks}.md` all
   carry `id: SPEC-001`, so `requirements.md` is the representative and Alt+A on
   `design.md` / `tasks.md` still resolves to nothing, even though legacy sidecars
   `design.md.json` and `tasks.md.json` exist for them. A `design.md` that is the ONLY file
   for its id would be returned, and would resolve: that is D1 (a) as written ("any file
   `listSpecs` returns").
4. **`approveSpecCommand` is already safe for a terminal spec.** The status flip runs only
   when the literal status is `new` or `specifying` (`approve.ts:384-388`), so approving a
   `done` spec records the approval and leaves `status: done`. The success toast today
   says "Approved SPEC-NNN for implementation", which is misleading for a done spec
   (`approve.ts:405-408`); task 4 fixes the wording.
5. **Opt-in is already enforced downstream, but too late for the new path.**
   `approveSpecCommand` refuses a folder without `.minspec/` (`approve.ts:236-239`). The
   new step 2b would still walk `listSpecs` on every Alt+A in a non-MinSpec folder before
   that refusal, and would turn "Alt+A on a random markdown file in a non-MinSpec repo"
   from step 3 into an error. Step 2b therefore checks `hasOptInMarker(root)` first and
   is skipped without one (FR-7).
6. **`folderForFile` falls back to folder `[0]`** for a file in no workspace folder
   (`packages/minspec/src/lib/resolve-folder.ts:118-123`). Harmless for step 2b: the resolver matches by exact
   resolved path, and a file outside folder `[0]` cannot equal any path `listSpecs(folder[0])`
   returns. AC-7's folder-`[1]` case resolves through `getWorkspaceFolder`, the first arm.
7. **The sidecar scan consumer, traced (spec Follow-up).** `listOrphanedRecords`
   (`packages/minspec/src/lib/approval-store.ts:231-260`) flags a sidecar whose keyed path does not classify.
   Its only production caller is this repo's dev-only `scripts/validate-frontmatter.ts`
   Rule 10 (`:625-640`, a warning), and nothing in `packages/minspec/templates/` ships it
   to adopters. This repo's only flat files are `specs/minspec/`'s SPEC-001 set, whose
   representative is a `requirements.md`. So keeping the classifier pure (D3 a) changes nothing there today.
   It would mislabel a flat-layout sidecar as orphaned if a flat repo ever ran Rule 10;
   that is a latent issue in a dev-only script, recorded under Follow-ups, not fixed here
   (FR-6: no consumer changes as a side effect).
8. **The recently-viewed tracker stays filename-only.** `recordApprovableView`
   (`packages/minspec/src/lib/recent-approvables.ts:39-46`) records only what `classifyApprovablePath` accepts,
   so a flat spec opened in a markdown preview is not in the MRU list. That is unchanged
   (D3 a, FR-6). It costs nothing for FR-1: terminal specs are dropped from the MRU list
   anyway (FR-2), and a non-terminal flat spec is still offered by the backstop picker.
9. **The keybinding already fires on any focused editor.** `alt+a` is bound when
   `editorTextFocus || ...` (`packages/minspec/package.json`, keybindings), so no manifest
   change is needed. A SPEC-029 "changes since approval" diff of a flat spec also reaches
   step 2b, because `activeEditorPath` decodes the diff URI to the spec path first
   (`approve-active.ts:79-83`).

## Architecture

### The resolver: `findSpecForFile` (FR-1, FR-5, FR-7; D1, D3)

Lives in `packages/minspec/src/lib/spec-catalog.ts`, directly after `listSpecs`.
vscode-free, so it is tested against real temp directories.

```ts
/**
 * The spec whose representative file is `fsPath`, in the workspace folder `rootDir`,
 * or undefined. "Representative" is exactly what `listSpecs` returns as `filePath`, so
 * a split-layout shard (design.md / tasks.md of a spec that has a requirements.md) and
 * any file without an `id:` never match (SPEC-256 D1, #630).
 *
 * Config-aware through `listSpecs` (the folder's `.minspec/config.json` `specsDir`).
 * Returns undefined without walking anything when `rootDir` has not opted in, when
 * `fsPath` is not a `.md` file, or when it lies outside the configured specs dir.
 */
export function findSpecForFile(rootDir: string, fsPath: string): SpecSummary | undefined;
```

Steps:

1. `rootDir === ''`, or `!hasOptInMarker(rootDir)` → undefined (FR-7, measured point 5).
2. `path.extname(fsPath).toLowerCase() !== '.md'` → undefined.
3. `specsDir = resolveAndValidate(rootDir, loadConfig(rootDir).specsDir)` (the same call
   `listSpecs` makes). If `path.relative(specsDir, path.resolve(fsPath))` starts with
   `..` or is absolute → undefined. This is a cheap prefilter, not the authority.
4. `listSpecs(rootDir).find((s) => path.resolve(s.filePath) === path.resolve(fsPath))`.

`resolveAndValidate` throws on a `specsDir` that escapes the root. `listSpecs` lets that
throw propagate today; `findSpecForFile` does the same (it does not swallow it), and step
2b turns it into an error message (below). No new `catch {}`.

### Alt+A step 2b (FR-1, FR-5, FR-7; SPEC-236 order kept)

`packages/minspec/src/commands/approve-active.ts`, `approveActiveCommand`, between the
existing step 2 (`if (fromEditor && editorPath) { ... return; }`) and step 3:

```ts
// 2b. A focused file the filename classifier does not know, which IS a spec's
//     representative file (flat layout, SPEC-256). Config-aware via listSpecs;
//     resolved against the folder that contains the file (FR-5).
if (editorPath && !fromEditor) {
  const root = folderForFile(editorPath);
  let spec: SpecSummary | undefined;
  try {
    spec = root ? findSpecForFile(root, editorPath) : undefined;
  } catch (err) {
    vscode.window.showErrorMessage(
      `MinSpec: Could not read the specs folder for "${root}": ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  if (spec) {
    await dispatch('spec', { spec });
    return;
  }
}
```

- Runs only when step 2 did not classify the file, so a `requirements.md`, `DR-*`,
  `EPIC-*` focus behaves byte-for-byte as today (AC-2's split half is the existing path).
- No match → falls through to step 3 silently, as any non-approvable focus does today.
  It does NOT show step 2's "looks like a spec, but could not be matched" error: an
  unclassified file never claimed to be a spec.
- A throw from `findSpecForFile` (an invalid `specsDir`) is shown as the error above and
  the command returns (constitution invariant 2: no silent no-op).
- SPEC-236's tree-selection step sits before step 2; this inserts after step 2, so the
  resolution order SPEC-236 defines is unchanged.
- The module header's resolution-order comment gains step 2b.

### FR-4: dropped terminal specs are named, not hidden

One pure helper, used by both pickers, in `packages/minspec/src/lib/approvable.ts` (already
the vscode-free home of the Alt+A routing rules):

```ts
export interface HiddenTerminalSpec {
  readonly id: string;
  readonly status: string;              // the literal terminal status: done | archived | superseded
  readonly approval: 'unapproved' | 'stale' | 'approved';
}

/** Alt+A's per-artifact route, named once so every message says the same thing. */
export const PER_ARTIFACT_APPROVE_HINT = 'open its file and press Alt+A (MinSpec: Approve/Accept Active)';

/**
 * The FR-4 sentence for terminal specs a picker dropped, or undefined when none
 * need saying. Names each STALE one (id + literal status); never-approved and
 * approved terminal specs are counted, not listed. Pure.
 */
export function hiddenTerminalSpecsNotice(hidden: readonly HiddenTerminalSpec[]): string | undefined;
```

Output rules:

- No stale entry → undefined. A never-approved `done` spec is past the gate by design
  (#440) and is not a re-approval candidate, so naming every one of them would bury the
  message (this repo alone has dozens). See D5.
- Up to three stale entries are named: `SPEC-001 (done), SPEC-004 (archived)`; more are
  summarised as `and N more`.
- Sentence: `Hidden here because they are past the gate, with a stale approval: SPEC-001
  (done). To re-approve one, open its file and press Alt+A (MinSpec: Approve/Accept
  Active).` The hotkey and the palette title are both in the text (hotkey-visibility rule).

Wiring:

- **Palette and backstop picker** (`approve.ts`, `pickSpec`): `PickOptions` gains an
  optional `hiddenNotice?: (dropped: readonly { spec: SpecSummary; status: ApprovalStatus }[]) => string | undefined`.
  `pickSpec` keeps the entries `include` rejected; Approve passes a `hiddenNotice` that
  maps the terminal ones to `HiddenTerminalSpec` and calls `hiddenTerminalSpecsNotice`.
  Revoke passes none (unchanged). When the filtered list is empty, the information
  message is `emptyMessage` followed by the notice (AC-5: Alt+A with only a terminal
  stale spec reaches this through step 4). When it is not empty, the notice becomes the
  QuickPick's `title`, so it is on screen while the user picks. The dropped spec stays
  out of the items (FR-2, AC-3).
- **Recently-viewed picker** (`approve-active.ts`, `pickRecentApprovable`): entries
  dropped by `isPending` whose kind is `spec` and whose literal status is terminal are
  collected with their approval status. When a QuickPick is shown, the notice is its
  `title`. When nothing is left (`outcome: 'none'`), nothing is shown here: control
  goes to step 4, whose picker computes and shows the same notice over the full list,
  so the user sees one message, not two.

### D2: the toast says what was approved (FR-3, FR-4, AC-4)

`approveSpecCommand` (`approve.ts`), immediately before `recordApproval`:
`const priorApproval = isTerminalSpecStatus(parsed.frontmatter.status) ? getApprovalStatus(rootDir, spec.filePath) : undefined;`
The `base` toast text gains a terminal branch:

- `priorApproval === 'unapproved'`: `MinSpec: ✓ Approved SPEC-001 (status stays done). It
  had never been approved: this records an approval for a spec that skipped the gate.`
- `priorApproval === 'stale'` or `'approved'`: `MinSpec: ✓ Re-approved SPEC-001 (status
  stays done).`
- Non-terminal: the two existing strings, unchanged.

This applies to every route that reaches a terminal spec with a node (the tree, an
explicit command argument, step 2 for split layout, step 2b for flat), so split and flat
say the same thing (AC-2 parity). No new refusal: D2 (a) allows the approval.

## Decisions (recorded alternatives)

- **D4 Resolver in `spec-catalog.ts`, helper in `approvable.ts`, no new source file.** The
  spec is `implements: none` ("owned files are decided at Plan"). Adding to existing
  modules keeps that true, as SPEC-212 and SPEC-059 do, so this Plan needs no
  requirements.md edit and no re-approval. Rejected: a new `packages/minspec/src/lib/focused-spec.ts`. It
  would make `implements: none` false, and changing `implements:` changes the canonical
  hash and voids the approval. Rejected: putting the fs resolver in `approvable.ts`,
  whose header promises "pure - no filesystem".
- **D5 Name stale terminal specs only, count the rest.** FR-4 asks that a skipped terminal
  spec be explained. The dead end #2519 reports is the STALE terminal spec; a
  never-approved terminal spec is hidden by design (#440) and listing all of them turns
  the message into a wall. Rejected: list every dropped terminal spec (noise); rejected:
  a separate toast per spec (several toasts for one keystroke). The count clause keeps
  the others visible as a number.
- **D6 Notice as the QuickPick `title`, not as a picker item.** FR-2 says terminal specs
  stay out of the pickers. A disabled or separator item would still be an item in the
  list and would break the existing #440 assertion that the picker does not offer them.
  Rejected: an extra toast beside an open picker (two surfaces at once).
- **D7 Step 2b only when step 2 did not classify.** Keeps every currently-working
  focus byte-identical and keeps SPEC-236's order. Rejected: replacing step 2's
  classifier with the resolver for specs (D3 option b, not selected).
- **D8 Opt-in check inside the resolver, not only in the command.** The resolver walks
  the specs tree; a folder without `.minspec/` must not be walked or routed at all
  (invariant 3). Rejected: relying on `approveSpecCommand`'s later refusal, which would
  turn a harmless Alt+A in a non-MinSpec repo into an error toast.

## Files

| File | Change | Owned by |
|---|---|---|
| `packages/minspec/src/lib/spec-catalog.ts` | `findSpecForFile` | modifies, not owns |
| `packages/minspec/src/commands/approve-active.ts` | step 2b; MRU picker notice; header comment | modifies, not owns |
| `packages/minspec/src/lib/approvable.ts` | `HiddenTerminalSpec`, `PER_ARTIFACT_APPROVE_HINT`, `hiddenTerminalSpecsNotice` | modifies, not owns |
| `packages/minspec/src/commands/approve.ts` | `PickOptions.hiddenNotice`; picker title / empty message; terminal toast text | modifies, not owns |
| `packages/minspec/tests/find-spec-for-file.test.ts` | new: resolver on real temp folders (AC-1 resolve half, AC-2, AC-6, AC-7, FR-7) | test file |
| `packages/minspec/tests/approve-active-command.test.ts` | step 2b routing cases; MRU notice | test file |
| `packages/minspec/tests/hidden-terminal-notice.test.ts` | new: pure helper cases | test file |
| `packages/minspec/tests/approve-terminal-lifecycle.test.ts` | FR-4 notice on palette/backstop; D2 toast text; #440 cases kept | test file |
| `packages/minspec/tests/approve-flat-terminal-e2e.test.ts` | new: AC-1 end to end on a real temp repo (sidecar becomes current) | test file |

Unchanged on purpose (FR-6, AC-8): `packages/minspec/src/lib/recent-approvables.ts`, `packages/minspec/src/lib/approval-store.ts`,
`classifyApprovablePath`, `packages/minspec/src/views/spec-tree-provider.ts`, `packages/shared/src/next-task.ts`,
`packages/minspec/package.json`. Nothing under `.github/` or `.githooks/` changes, so no
task needs a machinery merge.

## Risks

- **R1 Alt+A gets slower on unclassified files.** Step 2b walks `listSpecs` on Alt+A over
  any `.md` under `specsDir`. Mitigation: the opt-in, extension and directory prefilters
  run first; the walk is the same one step 2 and the backstop already do per keystroke.
- **R2 A flat file sharing an id with a split spec.** `listSpecs` keeps the lower-rank
  file, so the split `requirements.md` wins and the flat duplicate does not resolve.
  Accepted: duplicate ids are a validator error elsewhere; step 2b must not pick between
  them.
- **R3 Merge contention with SPEC-236 (Alt+A tree selection, planned in #3666).** Both
  edit `approveActiveCommand`. The edits are in different steps (SPEC-236 before step 2,
  this after it); whichever lands second rebases a few lines. Task 2.2 re-reads the
  function on current `main` first.
- **R4 Toast text is asserted by existing tests.** `approve-command.test.ts` and siblings
  may match the old "Approved ... for implementation" string. Only the terminal branch
  changes, so non-terminal assertions stay valid; task 4.1 greps for the string first.

## Follow-ups (tracked)

- Sidecar-scan consumer (`listOrphanedRecords`, spec Follow-up): traced in measured
  point 7. No change: its one caller is a dev-only rule in a split-layout repo. None
  filed: it would change no decision in 30 days, because no flat-layout repo runs
  `scripts/validate-frontmatter.ts`.
- voip-sms-inbox#123 (live SPEC-001 re-approve): unblocked when this ships; the builder
  notes it in the implementing pull request. No new issue.
