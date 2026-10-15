---
id: SPEC-197
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - code-change safety; finishes the layer contract SPEC-040 started
aspects: [architecture, tier-0, layering, eslint, refactor, no-silent-gate]
depends_on: [SPEC-040, DR-064]  # SPEC-040 FR-3 shipped the vscode-purity rule at warn and named #830 as the flip; DR-064 owns the allowed-edge set this spec extends
relates_to: [DR-014, DR-066, SPEC-029, SPEC-086, SPEC-136, "#830", "#690", "#989", "#54"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038, the spec-code
# ownership spec). Every path below is NEW and is written under the recommended answer to
# DQ-1 (a new `src/host/` layer). Choosing DQ-1 option B (shells into `views/`) renames these
# paths, and that choice edits this spec anyway.
implements:
  - packages/minspec/src/host/active-spec.ts         # FR-2 - editor tracker + vscode config read for findActiveSpec
  - packages/minspec/src/host/active-adr.ts          # FR-3 - editor tracker for the open ADR
  - packages/minspec/src/host/resolve-folder.ts      # FR-4 - workspace-folder resolution (all of today's lib/resolve-folder.ts)
  - packages/minspec/src/host/approval-diff.ts       # FR-5 - content provider + showChangesSinceApproval command body
  - packages/minspec/src/host/diagnostics.ts         # FR-6 - registerReferenceDiagnostics
  - packages/minspec/tests/lib-vscode-free.test.ts   # AC-2 - every lib module loads with no vscode mock
# `affects:` is DEFERRED to Plan on purpose, as SPEC-040 did. The relocation edits
# `extension.ts`, about eighteen `commands/*.ts`, three `views/*.ts`, `eslint.config.mjs`,
# `tests/import-boundaries.test.ts` and roughly twenty-five test files that mock these modules
# by path. The spec gate (`scripts/hooks/spec-gate.py`) edit-locks `affects:` paths exactly as
# it locks `implements:`, so declaring that set now, under an unapproved spec, would freeze
# the most-edited files in the package for every concurrent session. Plan lists them.
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-197: `lib/` becomes genuinely vscode-free, so SPEC-040's vscode-purity rule can flip from warn to error

Triggered by: [#830](https://github.com/AIClarityAU/minspec/issues/830) (SPEC-040 follow-up).
Design rests on: [DR-064](../../../docs/decisions/DR-064.md) (machine-enforced layer contract;
names #830 as the flip) and [DR-014](../../../docs/decisions/DR-014.md) (Tier-0 purity).

## In plain terms

SPEC-040 (the import-boundaries spec) made the layer rules machine-checked, but it had to
let one rule - "`lib/` does not import `vscode`" - only *warn*, because some `lib/` files
really do use the editor today. This spec moves the editor-touching part of each of those
files out of `lib/` into a thin adapter layer, leaves the pure logic where it is, and then
turns the warning into an error. After it lands, anything in `lib/` can be loaded by plain
Node - a test with no editor mock, a command-line tool, the headless core SPEC-136 plans -
and the lint stops a new editor dependency from creeping back in.

## One-Sentence Scope

Split each of the five `lib/` files that value-import `vscode` into a pure `lib/` core and a
thin vscode shell in an adapter layer, update their importers, and flip SPEC-040 FR-3's
`vscode` rule from `warn` to `error` in the same change - with no change to what the user sees.

## Context - what the code does today (read from this worktree's base, `origin/main`)

**The issue's list of seven is stale; it is five.** The issue body names seven files.
SPEC-086 (remove the ScroogeLLM upsell) deleted two of them, `lib/bridge.ts` and
`lib/ai-usage-detector.ts`; neither exists on disk. The test that pins the warn set already
says so and lists five (`packages/minspec/tests/import-boundaries.test.ts:62-76`,
`EXPECTED_VSCODE_WARN_FILES`). A grep of `packages/minspec/src/lib` for a value import of
`vscode` returns exactly these five, and `packages/minspec/src/lib/presence.ts:35` is the one type-only importer
(deliberately exempt, `allowTypeImports: true`, `eslint.config.mjs:107-112`). No file under
`src/lib/` imports any of the five, so moving their shells creates no `lib` to shell edge.
A grep for `import('vscode')` / `require('vscode')` under `src/lib` returns nothing.

| `lib/` file | vscode use (cited) | Pure part that can stay in `lib/` | vscode part that must leave |
|---|---|---|---|
| `active-spec.ts` (193 lines) | `workspace.getConfiguration('minspec')` (`:19`), `window.tabGroups` (`:140`), `onDidChangeActiveTextEditor` + `ExtensionContext` (`:153-157`), `window.activeTextEditor` (`:173`) | spec discovery walk and status preference of `findActiveSpec` (`:17-64`) given a `specsDir` override; `summarizeActiveSpec` (`:82`); the remember/decline decision of `resolveActiveSpecId` over plain data | reading the vscode setting, reading the active editor and tab, registering the listener, the cache |
| `active-adr.ts` (101 lines) | `window.tabGroups` (`:48`), `onDidChangeActiveTextEditor` + `ExtensionContext` (`:61-65`), `window.activeTextEditor` (`:83`) | `isAdrPath`, the remember rule, the preview-fallback decision | reading the editor and tab, the listener, the cache |
| `resolve-folder.ts` (123 lines) | `workspace.workspaceFolders`, `showErrorMessage`, `showWorkspaceFolderPick`, `getWorkspaceFolder`, `Uri.file` (`:15-121`) | already extracted: `pickFolderPath` lives in `lib/workspace.ts` (imported at `:3`) | the whole file - every export reads the live workspace |
| `approval-diff.ts` (176 lines) | `TextDocumentContentProvider` (`:89`), `Uri.parse` (`:100`), `activeTextEditor` + `showInformationMessage` (`:139-142`), `commands.executeCommand('vscode.diff')` (`:170`) | `resolveDiffSide` (`:50`), path encoding and decoding of the diff URI, the gating order of `showChangesSinceApproval` (FR-8 approved side first, then current side) | the content-provider class, URI construction as `vscode.Uri`, the messages, opening the diff |
| `diagnostics.ts` (247 lines) | `createDiagnosticCollection` (`:208`), `new Diagnostic`/`Range` (`:226-229`), document listeners (`:238-245`) | already pure: `violationsToDiagnostics` (`:71`), `diagnoseDocument`, `isCheckableArtifact`, `LocatedDiagnostic` (`:34`) | `registerReferenceDiagnostics` (`:202-247`) |

Importers, by grep: `resolve-folder` has eighteen in `src/` (fourteen commands, three views,
`extension.ts`) and eleven tests; `active-spec` three in `src/` and six tests; `active-adr`
two and two; `approval-diff` two and one; `diagnostics` one and one.

**Where the rule lives.** `eslint.config.mjs:241` and `:270` scope the `lib` rules to
`packages/minspec/src/lib/**/*.ts`; `NO_VSCODE_IN_LIB` is the FR-3 entry, registered under a
second plugin key so it can sit at `warn` beside FR-1's `error` (`eslint.config.mjs:114-130`).
`npm run lint` runs in the CI `lint` job (`.github/workflows/ci.yml:68-83`), which the
workflow's own comment calls a required check (`ci.yml:23`; I believe this matches the
ruleset, unverified from this offline checkout).

**What a new directory gets today: nothing.** The direction rule bans `lib` from importing
`views`/`commands` by path pattern (`NO_UI_LAYER_FROM_LIB`, `eslint.config.mjs:76-90`). A new
`src/host/` directory is in neither pattern, so without a rule change `lib/x.ts` could import
`../host/y` and reach vscode *transitively* while the FR-3 lint stays green. That is the
central trap in this change, and FR-8 closes it.

## Functional Requirements

- **FR-1 - Split, don't just move.** For each of the five files, the logic that does not
  need the editor stays in `lib/` under the **same file path**, and only the code that calls
  the vscode API moves to the adapter layer (DQ-1). Keeping the `lib/` path keeps SPEC-029's
  `implements:` entry (`lib/approval-diff.ts`) and SPEC-041's `affects:` entry true, so neither
  approved spec is edited. Exception: `lib/resolve-folder.ts` has no pure remainder (its pure
  helper already lives in `lib/workspace.ts`), so it is moved whole and the `lib/` path is
  deleted.
- **FR-2 - `active-spec`.** The pure `lib/active-spec.ts` takes the vscode `specsDir`
  override as a parameter instead of reading `workspace.getConfiguration` itself; the host
  shell reads the setting and passes it. The tracker cache (`lastActiveSpecId`,
  `lastActiveSpecPath`) lives in exactly **one** module (DQ-2); `resetActiveSpecTracking`
  still clears it.
- **FR-3 - `active-adr`.** Same split as FR-2; the ADR-filename rule and the
  preview-fallback decision are pure; the cache lives in exactly one module.
- **FR-4 - `resolve-folder`.** Every export (`resolveTargetFolder`,
  `resolveTargetFolderNonInteractive`, `workspaceFolderLabel`, `allWorkspaceRoots`,
  `folderForFile`) moves to the host layer with an unchanged signature and unchanged
  behaviour - including the `undefined`-versus-`[]` distinction of `allWorkspaceRoots` (#574)
  and the enumerate-never-index-zero property the workspace-folders guard test pins.
- **FR-5 - `approval-diff`.** The URI scheme string, the `approved`/`current` side
  encoding and the FR-8 gating order (approved side checked before current side, each
  degrading with today's message text) are unchanged. The pure core exposes the decision
  ("which message, or which two sides") and the shell renders it.
- **FR-6 - `diagnostics`.** `registerReferenceDiagnostics` moves to the host layer; the
  collection name `minspec.references`, the `Warning` severity, the `source` field and the
  seeding of already-open documents are unchanged.
- **FR-7 - Pure cores carry no vscode types by value, and prefer structural types.** A
  `lib/` core may not value-import `vscode`. Where a core must name an editor-shaped value
  (a document, a tab, a URI) it uses a local structural type, as `rememberAdrEditor` already
  does (`packages/minspec/src/lib/active-adr.ts:39-41`), unless DQ-3 selects otherwise.
- **FR-8 - The adapter layer is fenced on both sides.** In the same change:
  (a) the `lib` direction rule also bans importing the adapter layer, value **and** type
  (extend `NO_UI_LAYER_FROM_LIB`; `allowTypeImports: false`, same reasoning as DR-064 §2);
  (b) the adapter layer may import `lib`, `@aiclarity/shared` (barrel only) and `vscode`, and
  may **not** import `views/` or `commands/`, at `error`;
  (c) the adapter layer is inside the cycle checker's scan.
  Without (a) the flip is a silent gate: `lib` reaches vscode one hop away and the lint
  stays green (constitution invariant 2).
- **FR-9 - The flip.** `NO_VSCODE_IN_LIB` moves from `warn` to `error` in the **same commit**
  that removes the last value importer, so `main` is never red and never has a window where
  the rule is `error` with known violations. `allowTypeImports: true` stays
  (`lib/presence.ts` remains legal). The rule's message stops pointing at #830. The comment
  block above it (`eslint.config.mjs:92-112`, which still says "7 files") is rewritten to
  state the current contract.
- **FR-10 - The second plugin key is kept or retired, deliberately.** The synthetic second
  plugin key exists only so FR-1 (`error`) and FR-3 (`warn`) can coexist at different
  severities (`eslint.config.mjs:114-130`). Once both are `error`, Plan decides whether to
  merge them into one rule entry or keep two. Either way, the existing test that a file
  violating both rules gets **both** diagnostics must still pass, or be replaced by one that
  proves the merged entry still reports both.
- **FR-11 - DR-064 is amended, not superseded.** DR-064's allowed-edge set gains the
  adapter layer (FR-8). The repo states that changing that set is a DR-064 amendment
  (`eslint.config.mjs:13-14`). The amendment lands with the implementation, as a dated
  `## Amendment` section in `DR-064.md`. No new DR: the move is reversible in well under a
  day (the architect role's under-a-day ADR filter); the layer contract it changes already has a record.
- **FR-12 - SPEC-040 is not edited.** It is `done` and hash-locked. Its FR-3 already says
  the rule "flips to `error` when #830 lands"; this spec is that landing.

## Acceptance Criteria

- **AC-1** - On the real tree, `npm run lint` reports **zero** FR-3 diagnostics, and the
  FR-3 rule's configured severity is `error`. `import-boundaries.test.ts` asserts both: the
  `EXPECTED_VSCODE_WARN_FILES` list becomes an assertion of the **empty** set at `error`, and
  a fixture `lib` file value-importing `vscode` now produces an **error**, not a warning.
- **AC-2** - A new test imports every module under `packages/minspec/src/lib/` **with no
  `vi.mock('vscode')`** and with `vscode` unresolvable, and each import succeeds. The
  module list is discovered from disk, not hand-written, and the test fails if it discovers
  zero modules (a vacuous pass is a failure).
- **AC-3** - A fixture `lib` file importing the adapter layer (relative, deep-relative,
  and type-only forms) produces a lint **error** (FR-8a). A fixture adapter file importing
  `views/` or `commands/` produces an **error** (FR-8b). A fixture adapter file importing
  `lib`, the shared barrel and `vscode` produces nothing.
- **AC-4** - A type-only `import type ... from 'vscode'` in `lib` still produces **no**
  diagnostic, and the test that pins `lib/presence.ts` as the type-only exemplar still
  passes unchanged.
- **AC-5** - The cycle checker (`npm run check:cycles`) passes and its scanned-module list
  includes the adapter layer's files.
- **AC-6** - Behaviour unchanged, proven by the existing suite: every existing test of the
  five modules (`active-spec-lib`, `active-spec-preview`, `active-adr-preview`,
  `resolve-folder`, `workspace-folders-runtime-removal`, `approval-diff`, `diagnostics`,
  `multi-root-command-scope`, `extension-extra` and the command tests that mock
  `resolve-folder`) passes with **only** import-path and mock-path edits. A test assertion
  that has to change in substance is a behaviour change and is called out in the PR.
- **AC-7** - The single-cache property: a test drives the tracker through the host shell,
  then calls the reset function, and observes the resolved id clear - which fails if a
  second copy of the cache exists in another module (FR-2, FR-3).
- **AC-8** - No `lib/` file contains `import('vscode')` or `require('vscode')` (a grep-based
  assertion in the AC-2 test), because the lint rule cannot see dynamic imports (#989). This
  pins today's state; it does not close #989.
- **AC-9** - `npm run lint`, `npm test`, `npm run build` and `npm run validate` pass, and
  the rebuilt `.vsix` activates: the Specs and Decisions trees render, Approve Spec resolves
  the active spec from a markdown preview, Show Changes Since Approval opens a diff, and a
  dangling reference shows a Warning in the Problems panel.

## Invariants (must not break)

- **INV-1 - No behaviour change.** Command ids, setting keys, the diff URI scheme, the
  diagnostic collection name, every user-visible message string and the multi-root rules
  (#123, #549, #574, #604) are identical before and after.
- **INV-2 - `main` is never red, and the gate never under-covers silently.** The flip and
  the last relocation land together (FR-9); the adapter layer is fenced in the same change
  (FR-8) so the `error` rule cannot be passed by a one-hop detour (constitution invariant 2;
  DR-066).
- **INV-3 - Offline.** Nothing here adds a dependency or a network call (constitution
  invariant 1; the Tier-0 network-import ban test keeps passing and covers the new
  directory, since it scans the whole `packages/minspec/src` tree).
- **INV-4 - No suppression.** No `eslint-disable` of the FR-3 or FR-8 rules anywhere in
  `src/` (SPEC-040 INV-4; the existing suppression tests keep passing).
- **INV-5 - Approved specs stay approved.** No edit to SPEC-029, SPEC-040 or SPEC-041
  bodies or frontmatter (FR-1, FR-12).
- **INV-6 - Blast radius.** The change is confined to `packages/minspec`, the root
  `eslint.config.mjs` and `DR-064.md`; nothing ships to adopters (constitution invariant 3).

## Decisions needed (Clarify)

### DQ-1 - Where do the vscode shells go?

- **Option A (rec) - a new `packages/minspec/src/host/` layer** (`lib <- host <- views,
  commands, extension.ts`). It says what the code is - the editor adapter - and gives the
  future headless core (SPEC-136) a clean line: everything below `host/` is reusable without
  an editor. *Cost:* a new layer means a DR-064 amendment and two new lint fences (FR-8,
  FR-11); forgetting either fence is exactly the silent-gate trap described in Context.
- **Option B - distribute the shells into `views/`** (`commands` may already import
  `views`, so every importer stays legal with no rule change). *Cost:* `resolve-folder` and
  the editor trackers are not views, so the layer names stop meaning anything; and `views`
  already depends on these modules, so it adds no new fence - the next relocation has
  nowhere principled to go.
- Option C - one `host` file per shell inside `lib/host/` excluded by glob. Rejected: an
  exemption inside `lib` is the standing carve-out DR-064 §2 refused for FR-1.

### DQ-2 - Where does a tracker's cache live?

- **Option A (rec) - in the host shell.** The pure core is a set of functions over plain
  data (`rememberX(state, editor) -> state`, `resolveX(state, editor, tab) -> id`); the
  module-level state lives where the listener is. *Cost:* the pure tests that today call
  `resolveActiveSpecId()` against a mocked `vscode` change shape (they call the pure
  function with plain data), so AC-6's "path edits only" does not hold for those tests -
  they are listed in the PR.
- Option B - in the pure core, with setters the shell calls. *Cost:* module state in
  `lib/` that only an editor ever writes, which is the coupling this spec removes, in
  another form.

### DQ-3 - May a pure core use `import type ... from 'vscode'`?

- **Option A (rec) - no, use local structural types (FR-7).** A core that names
  `vscode.Uri` even type-only needs `@types/vscode` to compile, which a headless consumer
  (SPEC-136) should not need. *Cost:* small duplicated shape declarations, and a lint that
  allows what the spec asks you not to do - review, not the rule, holds this line.
- Option B - yes, the rule already allows it. *Cost:* the cores stay editor-typed; moving
  them to `packages/shared` later (DR-014, #54) needs a second pass.

### DQ-4 - After the flip, one rule entry or two? (FR-10)

- **Option A (rec) - keep two entries**, both at `error`. *Cost:* the synthetic plugin key
  outlives its original reason; its comment must be rewritten to say why it stays
  (separate messages and separate `allowTypeImports` values).
- Option B - merge into one. *Cost:* `allowTypeImports` differs between FR-1 (`false`) and
  FR-3 (`true`), so a merge needs two pattern entries inside one rule anyway, and the
  regression test for "both diagnostics fire" must be rewritten.

## Out of Scope

- Moving any `lib` module into `packages/shared` (DR-014's move, #54).
- Gating dynamic `import()` in `lib` (#989); AC-8 only pins today's absence.
- The headless core itself (SPEC-136).
- Any other `views`/`commands` restructuring.

## Alternatives considered and rejected

- **Raise the rule to `error` and add `eslint-disable` to the five files.** Rejected:
  SPEC-040 INV-4 bans suppression, and it would turn a visible warning into an invisible
  exemption.
- **Exempt the five files by glob in the FR-3 block.** Rejected: same as above with less
  trace; the gate reads green while the tree is not vscode-free.
- **Move each file whole (no split).** Rejected for four of the five: it deletes `lib/`
  paths two approved specs name (FR-1), and it moves pure, editor-free logic out of the
  tier that exists to hold it.

## Traceability

- Issue: [#830](https://github.com/AIClarityAU/minspec/issues/830).
- Parent: SPEC-040 FR-3 / AC-3 (`specs/minspec/SPEC-040-import-boundaries/requirements.md:83,99`).
- Decision: DR-064 (amended by FR-11 at implementation); DR-014 (Tier-0 purity).
- Related: SPEC-086 (deleted two of the original seven), SPEC-029 (owns `lib/approval-diff.ts`),
  SPEC-136 (headless core - the consumer that benefits), #989 (dynamic-import gap).
