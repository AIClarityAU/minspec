---
id: SPEC-029
type: tasks
status: implementing
product: minspec
epic: EPIC-002  # Signpost Integrity
---

# MinSpec — Approval-Staleness Prominence + Diff View (Tasks)

**Requirements:** [requirements.md](requirements.md) · **Design:** [design.md](design.md)

Order follows design.md's **Build order (vertical slice)**: Slice A end-to-end
with a placeholder command → Slice B standalone → wire them together →
`contextValue` + `package.json` menu. **Within each slice, T0/T1 test tasks
precede the implementation they cover (DR-003 test-first).** Each task names
its file allowlist. Tests are vitest under `packages/minspec/tests/`.

**Shared-checkout note:** `packages/minspec/src/extension.ts` currently carries
an unrelated, in-flight, uncommitted change from another session. Every task
below that touches `extension.ts` is a small, self-contained addition (a new
registration call), not a restructure — written to apply cleanly regardless of
what else is mid-flight in that file.

---

## Slice 1 — Pinned "Needs Re-Approval" group, dual-listed (FR-1, FR-2, FR-3, FR-4)

*Goal: the group renders, dual-lists a stale spec, preserves its existing row
signal, and the roll-up stays correct — provable before Slice B exists at all.
Click-through uses a placeholder command until Slice 4.*

- [x] **(test, T1)** `packages/minspec/tests/spec-tree-provider.test.ts`: with an
  injected `approvalFn` fixture returning `'stale'` for one spec and
  `'approved'`/`'unapproved'` for others, `getChildren(undefined)` returns a
  `SpecGroupNode` labelled "Needs Re-Approval" **first** in the array
  (before the epic/status groups), containing only the stale spec — and this
  holds with `epicGrouping.enabled` both `true` and `false`. *(FR-1)* —
  allowlist: `packages/minspec/tests/spec-tree-provider.test.ts`
- [x] **(test, T1)** same file: flipping the injected `approvalFn`'s return for
  a spec from `'stale'` to `'approved'` between two `getChildren()` calls
  removes it from the Needs-Re-Approval group on the second call; zero stale
  specs ⇒ no such group renders at all (not an empty group). *(FR-2, FR-4)* —
  allowlist: `packages/minspec/tests/spec-tree-provider.test.ts`
- [x] **(test, T0)** same file: a `SpecNode` built via the Needs-Re-Approval
  path and one built via its normal lifecycle-lane path (same underlying
  `spec`/`approval`) have **identical** `iconPath`, `description`, and
  `tooltip` — only `.command` may differ. *(FR-3)* — allowlist:
  `packages/minspec/tests/spec-tree-provider.test.ts`
- [x] **(test, T1)** same file: a fixture with one dual-listed stale spec
  produces the same `RollupNode` `active.length` / progress numbers as an
  equivalent fixture with no Needs-Re-Approval group — proves dual-listing
  needs no `RollupNode` change (design.md's "no code change required" finding,
  locked as a regression test). *(FR-4)* — allowlist:
  `packages/minspec/tests/spec-tree-provider.test.ts`
- [x] **(test, T1 — SEV-2 terminal guard)** same file: a spec with
  `status: 'done'` (and one `'archived'`) whose injected `approvalFn` returns
  `'stale'` (hash-drifted sidecar) does **NOT** appear in the Needs-Re-Approval
  group — the group filter must exclude terminal specs even though
  `getApprovalStatus` is purely hash-based and returns `'stale'` for them.
  *(FR-1, requirements.md Failure-Modes "terminal spec never enters the group")*
  — allowlist: `packages/minspec/tests/spec-tree-provider.test.ts`
- [x] **(impl)** `packages/minspec/src/views/spec-tree-provider.ts`:
  `SpecGroupNode` gains a third, defaulted constructor param
  `kind: 'status' | 'needsReapproval' = 'status'`, stored as `this.kind`.
  *(FR-1)* — allowlist: `packages/minspec/src/views/spec-tree-provider.ts`
- [x] **(impl)** same file: add `private safeApproval(spec): ApprovalStatus`
  (the existing try/catch body factored out of `toSpecNode`) and
  `private getNeedsReapprovalGroup(allSpecs): SpecGroupNode | null` — filters
  `allSpecs` by **`s.status !== 'done' && s.status !== 'archived' &&
  safeApproval(s) === 'stale'`** (the terminal guard is load-bearing per SEV-2:
  `resolveStatus` is hash-only and would otherwise pull terminal specs in),
  returns `null` when empty, else a `SpecGroupNode({label: 'Needs Re-Approval',
  statuses: [], defaultExpanded: true}, stale, 'needsReapproval')`. *(FR-1,
  FR-4)* — allowlist: `packages/minspec/src/views/spec-tree-provider.ts`
- [x] **(impl)** same file: in `getChildren()`'s root branch, insert
  `getNeedsReapprovalGroup(allSpecs)` between the `RollupNode` push and the
  `epicGroups ?? getStatusGroups(...)` push, pushed only when non-null.
  *(FR-1, FR-4)* — allowlist: `packages/minspec/src/views/spec-tree-provider.ts`
- [x] **(impl)** same file: `toSpecNode` gains a third param
  `diffOnClick = false`, threaded from the `SpecGroupNode` branch of
  `getChildren()` as `element.kind === 'needsReapproval'`. `SpecNode`'s
  constructor gains the matching `diffOnClick = false` param; when `true`,
  `this.command` is set to a **placeholder**
  (`{command: 'minspec._showChangesSinceApprovalPlaceholder', title: ...,
  arguments: [spec.filePath]}` — a no-op `showInformationMessage` stub
  registered alongside, deleted in Slice 4) instead of `vscode.open`.
  *(FR-7 — placeholder only; see Slice 4)* — allowlist:
  `packages/minspec/src/views/spec-tree-provider.ts`,
  `packages/minspec/src/extension.ts` (placeholder command registration only)

## Slice 2 — Diff sourcing: `approval-diff.ts` (FR-5 resolution, FR-8)

*Goal: the pure(ish) sourcing layer — recover the approved body, read the
current body — proven correct and honestly degrading, independent of any
VS Code diff-editor wiring.*

- [x] **(test, T1)** `packages/minspec/tests/approval-diff.test.ts` (**new**):
  `resolveDiffSide(root, specPath, 'approved')` on a fixture with a valid
  `baselineBlob` returns exactly `recoverBaseline`'s output;
  `resolveDiffSide(root, specPath, 'current')` returns exactly
  `getSpecBodyOnly(fs.readFileSync(specPath, 'utf-8'))`'s output, byte for
  byte. *(FR-5)* — allowlist: `packages/minspec/tests/approval-diff.test.ts`
- [x] **(test, T1 — INV-No-fabricated-diff)** same file: a record with
  `baselineBlob === ''` (legacy) and a record whose blob SHA `git cat-file`
  fails on (simulated prune) both make `resolveDiffSide(..., 'approved')`
  return `undefined` — never a thrown error, never an empty string standing
  in for "no data". *(FR-8, INV — No fabricated diff)* — allowlist:
  `packages/minspec/tests/approval-diff.test.ts`
- [x] **(impl)** `packages/minspec/src/lib/approval-diff.ts` (**new**):
  `DiffSide = 'approved' | 'current'` and
  `resolveDiffSide(rootDir, specFilePath, side): string | undefined` exactly
  as specced in design.md's Contracts — `'current'` reads+`getSpecBodyOnly`s
  the live file (`undefined` on read failure); `'approved'` resolves the
  sidecar via **`getApprovalRecord(rootDir, specFilePath)` — pass the ABSOLUTE
  path, do NOT wrap in `specRelPath` (SEV-1: `getApprovalRecord` relativizes
  internally; pre-relativizing double-relativizes and misses every lookup)** +
  `recoverBaseline` (`undefined` when no record or baseline unrecoverable).
  Imports only `fs`, `./approval` (`getApprovalRecord`, `recoverBaseline` —
  **not** `specRelPath`), and `@aiclarity/shared` (`getSpecBodyOnly`) — no
  `vscode`, Tier-0. *(FR-5, FR-8,
  INV — Tier-0, INV — One diff source of truth)* — allowlist:
  `packages/minspec/src/lib/approval-diff.ts`

## Slice 3 — Diff view: content provider + command (FR-6, FR-8)

*Goal: `MinSpec: Show Changes Since Approval` opens VS Code's native diff
editor over the two sourced bodies, or degrades honestly — standalone,
invokable from the Command Palette with a hardcoded path for manual testing
before Slice 1's group can drive it.*

- [x] **(test, T1)** `packages/minspec/tests/approval-diff.test.ts`: a stub
  `vscode.commands.executeCommand` mock — `showChangesSinceApproval` with a
  fixture that has a recoverable baseline calls `executeCommand('vscode.diff',
  approvedUri, currentUri, <title containing record.approvedAt>)` exactly
  once, with both URIs using the `minspec-approval-diff:` scheme. *(FR-6)* —
  allowlist: `packages/minspec/tests/approval-diff.test.ts`
- [x] **(test, T1 — INV-No-fabricated-diff)** same file: with an unrecoverable
  baseline, `showChangesSinceApproval` shows the degrade
  `showInformationMessage` and **never** calls `executeCommand('vscode.diff',
  ...)`. *(FR-8)* — allowlist: `packages/minspec/tests/approval-diff.test.ts`
- [x] **(test, T1)** same file: a spec path containing a space round-trips
  through the URI's `base64url` path-encode/decode losslessly (R2 from
  design.md's Risks). *(FR-6)* — allowlist:
  `packages/minspec/tests/approval-diff.test.ts`
- [x] **(test, T1 — SEV-2 arg-shape)** same file: `showChangesSinceApproval`
  resolves the spec path from **all three** inputs — a `string` arg (tree
  click), a `SpecNode`-shaped object arg (`{spec:{filePath}}`, context menu),
  and **no arg** with a stale spec as the mocked `activeTextEditor` document
  (palette) — and opens the diff in each. *(FR-5)* — allowlist:
  `packages/minspec/tests/approval-diff.test.ts`
- [x] **(test, T1 — SEV-2 palette gate)** same file: invoked with no arg and
  the active editor on a non-stale (or non-spec) document, it shows the degrade
  message and never calls `executeCommand('vscode.diff', ...)`. *(FR-5)* —
  allowlist: `packages/minspec/tests/approval-diff.test.ts`
- [x] **(test, T1 — SEV-3 current-side gate)** same file: with a recoverable
  baseline but the spec file unreadable at call time (`resolveDiffSide(...,
  'current') === undefined`), it shows the degrade message and opens no diff
  (no false "everything deleted" render). *(FR-8)* — allowlist:
  `packages/minspec/tests/approval-diff.test.ts`
- [x] **(impl)** `packages/minspec/src/lib/approval-diff.ts`: add
  `ApprovalDiffContentProvider implements vscode.TextDocumentContentProvider`
  (`provideTextDocumentContent` parses `<side>/<base64url(specFilePath)>` from
  `uri.path`, delegates to `resolveDiffSide`, returns `''` only as VS Code's
  own re-request fallback — never the path this feature's code triggers) and
  `async function showChangesSinceApproval(rootDir, arg?: SpecNode | string)`
  per design.md's Command section: **normalize `arg`** (string → path; SpecNode
  → `arg.spec.filePath`; undefined → `vscode.window.activeTextEditor?.document
  .uri.fsPath`; still nothing → degrade); resolve the record + approved body
  via the absolute-path `getApprovalRecord` (**no `specRelPath` wrapper**),
  degrade-and-return on `undefined`; **also gate the current side**
  (`resolveDiffSide(..., 'current') === undefined` → degrade, SEV-3); else
  build the two `minspec-approval-diff:` URIs and
  `vscode.commands.executeCommand('vscode.diff', approvedUri, currentUri,
  title)`. *(FR-5, FR-6, FR-8)* — allowlist:
  `packages/minspec/src/lib/approval-diff.ts`
- [x] **(impl)** `packages/minspec/src/extension.ts`: register, as one
  self-contained block near the other `minspec.*` registrations (surgical
  addition — does NOT touch the concurrent in-flight change in this file),
  both: `registerTextDocumentContentProvider('minspec-approval-diff', new
  ApprovalDiffContentProvider(workspaceRoot))` **and** the real command via a
  closure that injects `workspaceRoot` — `registerCommand(
  'minspec.showChangesSinceApproval', (arg) => showChangesSinceApproval(
  workspaceRoot, arg))` (mirrors the existing `goToSpecCommand(workspaceRoot,
  …)` registration pattern; `rootDir` is injected, never a passed command arg).
  *(FR-5, FR-6)* — allowlist: `packages/minspec/src/extension.ts`

## Slice 4 — Wire Slice 1's placeholder to the real command (FR-7)

*Goal: clicking a spec inside Needs-Re-Approval opens the real diff; the same
spec's row in its lifecycle lane is untouched.*

> **Deviation note:** implemented in one continuous session rather than across
> separate commits/PRs, so the placeholder-command step (whose only purpose
> was letting Slice A ship independently verifiable before Slice B existed)
> was skipped — `SpecNode`'s `diffOnClick` branch was wired directly to
> `minspec.showChangesSinceApproval` from Slice 1 onward. No placeholder was
> ever registered, so there is nothing to remove.

- [x] **(test, T1)** `packages/minspec/tests/spec-tree-provider.test.ts`: a
  `SpecNode` from the Needs-Re-Approval group has
  `.command.command === 'minspec.showChangesSinceApproval'` with
  `arguments === [spec.filePath]`; the same spec's node from its lifecycle
  group has `.command.command === 'vscode.open'`. *(FR-7)* — covered by the
  FR-3 test in Slice 1's "Needs Re-Approval group" describe block.
- [x] **(impl)** `packages/minspec/src/views/spec-tree-provider.ts`: wired
  directly to `minspec.showChangesSinceApproval` in Slice 1 (no placeholder
  swap needed — see deviation note). *(FR-7)*
- [x] **(impl)** N/A — no placeholder was registered in `extension.ts`, so
  there is nothing to remove (see deviation note). *(FR-7 cleanup)*

## Slice 5 — `contextValue` + menu surfaces (FR-5), **incl. the SEV-1 menu-regression fix**

*Goal: the command is reachable from the tree's right-click menu AND the command
palette (FR-5's two surfaces), scoped to stale specs only (not merely-unapproved,
per Clarify FR-OQ3) — WITHOUT stripping Approve/Classify off stale rows.*

- [x] **(test, T0)** `packages/minspec/tests/spec-tree-provider.test.ts`: a
  `SpecNode` with `approval === 'stale'` (non-terminal) has
  `contextValue === 'specNode.stale'`; `'approved'` and `'unapproved'` cases
  are unchanged (`'specNode.approved'` / `'specNode'`). — allowlist:
  `packages/minspec/tests/spec-tree-provider.test.ts`
- [x] **(test, T0 — SEV-1 menu-preservation)** assert the widened `when`-clauses
  keep the existing actions on stale rows — implemented as TWO tests: a pure
  regex-behavior test, AND a stronger test that parses the actual
  `package.json` and asserts the real `classify`/`approveSpec` `when` strings
  match the widened pattern (and `revokeApproval` does NOT). *(SEV-1)* —
  allowlist: `packages/minspec/tests/spec-tree-provider.test.ts`
- [x] **(impl)** `packages/minspec/src/views/spec-tree-provider.ts`: added the
  `approval === 'stale' ? 'specNode.stale' : ...` branch to the existing
  `contextValue` ternary, preserving the terminal short-circuit.
- [x] **(impl — SEV-1 fix, MANDATORY)** `packages/minspec/package.json`: widened
  the three existing exact-match `view/item/context` `when`-clauses
  (`minspec.classify`, both `minspec.approveSpec` entries) to
  `viewItem =~ /^specNode(\\.stale)?$/`. `viewDesign`/`viewTasks`/
  `revokeApproval` left untouched.
- [x] **(impl)** `packages/minspec/package.json`: added the
  `minspec.showChangesSinceApproval` command, a `view/item/context` entry
  scoped to `specNode.stale` (`2_approval@2`), and a `commandPalette` entry
  (`when: editorLangId == markdown`).

## Wire-up & verification

- [x] Run `npm run build` (all packages) — clean, no type errors.
- [x] Run `npm test` — **118/118 test files, 2328/2330 tests green** (2 pre-existing
  skips), including the SPEC-015 `STATUS_GROUPS`/INV-1 coverage case (untouched)
  and `approval.test.ts`/`approval-store.test.ts`. Two OTHER test files'
  `vscode` mocks (`extension.test.ts`, `extension-extra.test.ts`) needed
  `registerTextDocumentContentProvider: vi.fn()` added to their `workspace`
  mock object — a real, expected ripple from the new registration, fixed.
- [x] Tier-0 import-ban test — `approval-diff.ts` is covered by the existing
  repo-wide glob with no edit needed; confirmed passing standalone.
- [x] Run `npm run validate` — **"Frontmatter validation passed"**, zero
  warnings/failures attributable to SPEC-029 (only pre-existing warnings on
  unrelated specs).
- [x] `git diff --name-only` review: changes confined to the allowlists above;
  `extension.ts`'s diff is a pure addition (2 import lines + one registration
  block) — see the commit for the exact diff.
- [ ] Manual smoke test against a real stale spec: **not run** — SPEC-026 (the
  spec that was stale for most of this session) was approved by the human
  partway through this work, so no spec in the repo is currently stale to
  smoke-test against. The automated fixture-based tests (real git repo +
  `approveSpec` + edit-after-approval, mirroring `approve-baseline.test.ts`'s
  pattern) cover the same path with a real git-blob baseline. Flagging as
  deferred, not silently skipped — first real stale spec after merge is a
  good manual check.
