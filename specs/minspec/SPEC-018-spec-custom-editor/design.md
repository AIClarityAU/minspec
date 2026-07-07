---
id: SPEC-018
type: design
status: implementing
product: minspec
epic: EPIC-002  # Signpost Integrity
---

# MinSpec — Approvable Custom Editor (in-IDE review surface) — Design

**Date:** 2026-07-05
**Status:** Implementing (SDD Implement phase)
**Reads:** [requirements.md](requirements.md) — the FRs, invariants, and the Clarify
decisions (OQ2 offer-useByDefault, OQ3 all-approvables, OQ1 kept as a research spike) are
settled there and not re-litigated here. This document is HOW, not WHAT/WHY.
**Dependency budget:** **zero new npm dependencies.** Everything below is `vscode`
built-ins (`window.registerCustomEditorProvider` / `CustomTextEditorProvider`,
`WorkspaceEdit`, `webview` messaging, `commands.executeCommand`) plus functions that already
exist in `packages/minspec/src` (the SPEC-014-extracted renderer out of `spec-panel-html.ts`,
`reference-checker.ts`'s `extractReferences`, `approval.ts` gate) and `packages/shared`.
**FR-12's AI edit is NOT a "reuse an existing broker" — there is no AI-invoke broker in
`packages/minspec` today.** FR-12 rides the AI-edit channel SPEC-014 chooses for its revision
loop (its FR-OQ2, unresolved), so Slice E is a hard dependency on that and ships after it;
whatever channel is chosen, it stays host-delegated with **no** network path in core (FR-8).

---

## Approach — six independently-shippable slices

The editor is one `CustomTextEditorProvider`, but the FRs decompose into slices that can
land in order without blocking each other. The load-bearing floor is Slice A (a viewer that
mounts the existing renderer + the always-available text escape); every later slice is an
additive layer over the same `TextDocument` and the same webview message channel.

| Slice | FRs | What | Depends on |
|---|---|---|---|
| **A — Register + render + escape** | FR-2, FR-5, FR-6, FR-8 | The `customEditors` contribution (approvable glob set), the provider that mounts SPEC-014's pure renderer with the existing CSP-nonce, and the palette-only text escape (FR-5, no chrome button). | SPEC-014 render fn extracted |
| **B — Routing + default posture** | FR-1, FR-3, FR-14(a) | Tree-click opens the webview; `priority:"option"` + `minspec.approvableEditor.useByDefault`; the revert setting; init offer to enable default. | A |
| **C — Read ergonomics + quiet diff** | FR-9, FR-10, FR-13, FR-15 | Outline **in the MinSpec Explorer** (under the open doc — one sidebar), cross-ref hotlinks (reuse `reference-checker.ts`), attention/dim (reuse #185/SPEC-013), and the **quiet-diff highlight** (gutter bar + tint, no underline-everything). All view-layer, no document writes. | A |
| **B2 — Chrome** | FR-17 | Defer to native VS Code tabs (draw none); **one** combined action/status bar; approval as the primary CTA (Pre-approve/Approve/Re-approve by state, no red banner) surfacing SPEC-014's approve loop; Re-approve highlights changes (FR-15); drop viewType / read-only / plain-text chrome. | A (+ SPEC-014 approve loop for the CTA) |
| **D — Editing** | FR-4, FR-11, FR-OQ1 | Viewer-by-default; per-section hover/keyboard **pen** switches a section to editable and commits a `WorkspaceEdit` to the backing doc. The FR-OQ1 spike lives here. | A |
| **E — AI chat: edit + converse** | FR-12, FR-16 | Section-anchored **chat**: (edit) AI update via **SPEC-014's channel**, proposal **may span the whole doc**, previewed with FR-15's diff, applied as **one atomic** `WorkspaceEdit`; (converse) two-way ask/explain, **fork to a host chat session**, **file as issue** (parking-lot). | C (FR-15) + D **+ SPEC-014 FR-OQ2 channel built** |
| **F — Telemetry + init** | FR-7, FR-14(a,b) | Emit scroll/focus/dwell to SPEC-017 FR-7a when its opt-in is on; init offers (enable useByDefault, reading-time pointer). | A |

Slices A+B are the minimum that satisfies the original spec's routing intent; the rest are the
2026-07-05/07-06 feedback. If any slips, the editor still opens, renders, and escapes.
**Slice E additionally waits on SPEC-014 building its AI-edit channel** (there is none to reuse
today). **PR-into-IDE link routing is not here — split to #541.**

## Component / seam map (real files)

- **Provider:** new `packages/minspec/src/views/approvable-editor.ts` — the
  `CustomTextEditorProvider`. Registered in `extension.ts` `activate()` via
  `vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, { webviewOptions, supportsMultipleEditorsPerDocument:false })`.
- **Contribution:** `packages/minspec/package.json` → `contributes.customEditors` (Slice A)
  + `contributes.configuration` for `minspec.approvableEditor.*` (Slice B) + `contributes.menus`
  is untouched here (palette-hiding is #532, out of scope).
- **Renderer (reuse, FR-6):** the pure render function extracted from
  [`spec-panel-html.ts`](../../../packages/minspec/src/views/spec-panel-html.ts) by SPEC-014
  (its FR-1/FR-16). Note the *current* `getHtml` in that file renders the phase-stepper /
  task-checklist, **not** prose markdown — the prose render function is SPEC-014's extraction
  target, not today's `getHtml`; do not reuse `getHtml` directly. SPEC-018 imports the extracted
  function; it adds no second renderer/sanitiser or second nonce/CSP path (`spec-panel-html.ts:144-151`
  shows the nonce+CSP pattern to reuse).
- **Cross-ref parser (reuse, FR-10):** [`reference-checker.ts`](../../../packages/minspec/src/lib/reference-checker.ts)'s
  `extractReferences` already tokenises `SPEC-/DR-/EPIC-`/file refs (emits `spec`/`decision`/
  `epic`/`file` kinds); FR-10 renders those tokens as webview anchors. **No forked parser.**
  (`command-references.ts` is a *different* thing — palette-title / shell-CLI ref extraction for
  the SPEC-021 egress gate — do NOT use it for cross-ref tokenising.)
- **Approval gate (reuse, FR-11/12):** [`approval.ts`](../../../packages/minspec/src/lib/approval.ts)
  — a **body** edit changes the approval hash ⇒ approval invalidates automatically. Per SPEC-022
  the hash is over **canonical content** (lifecycle frontmatter like `status`/`phases` excluded),
  not raw file bytes; FR-11/FR-12 edit body sections, so they void approval as intended. The
  editor does nothing special to "void" — it makes an ordinary body edit and the existing
  canonical-content hash does the rest.
- **Tree click (edit, FR-1):** [`spec-tree-provider.ts`](../../../packages/minspec/src/views/spec-tree-provider.ts)
  item `command` currently routes to `vscode.open` / `minspec.showChangesSinceApproval`
  (`:333-340`). FR-1 routes an approvable click through `vscode.openWith(uri, VIEW_TYPE)`
  (or plain `vscode.open` when the revert setting is on).
- **Init offers (edit, FR-14):** [`init.ts`](../../../packages/minspec/src/commands/init.ts)
  already hosts declinable offers (scaffold-commit `:158`, branch-ruleset `:266`). FR-14 adds
  the same shape (enable useByDefault, reading-time pointer); the durable target is the checklist
  page (#533). (The `getExtension('GitHub.vscode-pull-request-github')` detection + PR-ext
  install offer moved to #541.)

## Slice details

### Slice A — register, render, escape (FR-2, FR-5, FR-6, FR-8)

- `VIEW_TYPE = "minspec.approvableEditor"` — the Costly #1 public contract, fixed now.
- `contributes.customEditors[].selector` is a **list**, one glob per approvable type:
  `**/specs/**/*.md`, `**/docs/decisions/**/*.md`, `**/docs/epics/**/*.md`,
  `**/.minspec/constitution.md`. A T0 test (`approvable-editor.test.ts`) reads the manifest,
  asserts each entry is one of the known-scoped globs and that the set contains no `**/*.md`
  and matches no top-level `README.md` (AC-1).
- `resolveCustomTextEditor(document, webviewPanel)` sets `webview.html` from the reused
  renderer with the reused nonce/CSP; it subscribes to `workspace.onDidChangeTextDocument`
  for *this* document to re-render on external edits (git checkout, agent edit), keeping the
  view a *derived view* of file truth (EPIC-002 principle).
- Escape (FR-5): a toolbar/title action `minspec.approvableEditor.openAsText` running
  `workbench.action.reopenWithEditor` / `vscode.openWith(uri, 'default')`. Present regardless
  of settings; a T1 test asserts it always resolves to the text editor.
- Tier-0 (FR-8): `approvable-editor.ts` imports only `vscode` + local libs; the import-ban T0
  test (SPEC-014 FR-17 pattern) extends to this module.

### Slice B — routing + default posture (FR-1, FR-3, FR-14a)

- `contributes.configuration`: `minspec.approvableEditor.useByDefault` (boolean, default
  `false`) and `minspec.approvableEditor.treeClickOpensText` (boolean, default `false`).
- `priority`: the contribution ships `"option"`. There is no VS Code API to flip
  `priority` at runtime, so `useByDefault` is honoured **in our own routing** (FR-1 tree
  click reads the setting) and documented as "for arbitrary Ctrl-P/explorer opens, use
  Reopen With / set the workspace `workbench.editorAssociations`" — the init offer (FR-14a)
  writes that association on the user's behalf when they accept, which is the only truthful
  way to make it the default without a forced `priority:"default"`. A T2 test covers both
  setting states — tree-click default (setting) vs any-path default (editorAssociations via
  init accept) — matching AC-3's two-part assertion.

### Slice C — read ergonomics + quiet diff (FR-9, FR-10, FR-13, FR-15) — no document writes

- **Outline in the Explorer (FR-9):** the renderer already produces heading structure. Rather
  than a second in-webview panel, the outline is contributed to the **MinSpec Explorer**
  (`spec-tree-provider.ts`): the open approvable's node expands to its headings as child items
  (a `TreeItem` per heading with a `command` that posts `toc:goto{id}` to the active editor, or
  reveals + scrolls). One sidebar total (2026-07-06 feedback). Keybindings for next/prev-section
  + focus-outline via `contributes.keybindings` (`when: activeCustomEditorId == minspec.approvableEditor`)
  satisfy the keyboard path (AC-9). The editor still owns scroll-spy → it tells the tree which
  heading is active.
- **Cross-ref hotlinks (FR-10):** post-render, ref tokens from `reference-checker.ts` become
  `<a data-ref="SPEC-014">`; a webview→ext message `ref:open{id, toSide}` resolves the ref to
  a file path and runs `vscode.openWith(target, VIEW_TYPE, toSide ? ViewColumn.Beside : active)`.
  A T1 test asserts the shared `extractReferences` symbol is used and that `toSide` opens
  `Beside` (AC-10). **Egress (INV-Cross-ref-egress-safe):** the anchors live only in the webview
  DOM; a **T0 test** asserts cross-ref rendering writes no `SPEC-`/`DR-`/`EPIC-` ref into any
  exported/generated artifact (AC-15) — a gate, not just design reasoning (the SPEC-021/DR-032
  egress-asymmetry class).
- **Attention + dim (FR-13):** emphasis is driven by the **existing deterministic signals** —
  the #185 read-this eye-icon heading marks + the SPEC-013 Zone-A / core-end divider. The
  webview adds a `dim non-essential` toggle (and per-paragraph checkboxes) that apply a CSS
  class only. A T0 test asserts toggling dim fires **zero** `WorkspaceEdit` and the file bytes
  are unchanged (AC-13, INV-Attention-view-only). FR-OQ4 (may the AI suggest emphasis?) is
  deferred; v1 uses only the deterministic signals.
- **Quiet diff highlight (FR-15):** to show a proposed AI change (Slice E preview) or
  changed-since-approval content **without the underline-everything problem**, the webview marks
  changed paragraphs with a **gutter change-bar** (a thin coloured rule in a left margin, git-
  gutter style) plus a **light background tint** on the changed run — never dense inline
  underline/strikethrough. Change ranges come from a diff of the proposal (Slice E) or from
  `git diff` against the approved blob (read-only). It is pure CSS/DOM over the render — a T0
  test asserts the highlight writes **zero** document bytes (AC-16, same class as
  INV-Attention-view-only). The **per-commit colour timeline** (colour-per-iteration, scrollbar
  markers, selectable legend) is **not built here** — #544 layers on this floor.

### Slice D — editing (FR-4, FR-11, FR-OQ1)

- **Viewer default (INV-Viewer-safe):** `resolveCustomTextEditor` renders read-only markup;
  a T0 test asserts open ⇒ zero `WorkspaceEdit` (AC-11).
- **Per-section pen (FR-11):** each rendered section carries its source char range (from the
  renderer's heading offsets). Hover/focus reveals a pen; activating it swaps that section's
  DOM for a `<textarea>` seeded with the raw slice. On commit, the webview posts
  `edit:section{range, newText}`; the provider applies a `WorkspaceEdit.replace(document.uri,
  range, newText)`. Because it edits the backing `TextDocument`, undo/redo/save/git-gutter/
  validator all work (FR-4) and the DR-012 hash voids approval — verified by a T1 test that
  edits a section then asserts `approval.ts` reports the spec stale (AC-11).
- **Keyboard path:** a `when`-scoped keybinding "edit focused section" (AC-11, no mouse-only edit).
- **FR-OQ1 spike (research task in tasks.md):** prove whether the section-range round-trip is
  robust for the common edits, and decide the ceiling — section-only vs full inline parity vs
  "edit as text" handoff for heavy edits. The fallback (viewer + adjacent text editor) is the
  documented degradation; it never strands the doc (Failure-Modes).

### Slice E — AI edit (FR-12) — waits on SPEC-014's channel

- Per-section **chat** icon → a prompt input in the webview → `ai:editDoc{anchorRange, prompt,
  anchorText, docText}` to the provider. The hovered section is the **anchor/default context**,
  **not a hard boundary** — `docText` (or a doc summary) goes to the model so a request like
  "rename this term everywhere" can return edits **across sections / whole-doc**.
- The provider receives a **set of edits** (one or many `{range,newText}`), not a single-section
  replacement, and stages them as **one** `WorkspaceEdit` (multiple `edit.replace(...)` calls on
  the same edit) so `applyEdit` + undo treat the whole change **atomically** (AC-12). Each range
  is **re-validated against the current document** before staging (stale range ⇒ reject the whole
  proposal + re-render, never a partial write).
- **The invoke channel is SPEC-014's, not a new one.** There is **no** AI-invoke broker in
  `packages/minspec` today — `bridge.ts` is extension *detection*, not an AI channel. FR-12 must
  ride whatever SPEC-014 picks for its revision loop (its FR-OQ2 — chat-participant vs a
  `minspec.dispatchRevision` command vs prompt-file vs the DR-017 broker), which is unresolved
  and unbuilt. So **Slice E is gated on SPEC-014 building that channel**; whatever it is, it is
  host-delegated with no `http` import here (FR-8). Do not shortcut this with a direct fetch —
  that is the exact INV-Tier-0 breach AC-8 forbids.
- **Visible, never silent (INV-Viewer-safe / R6, Costly #2):** the proposed change MUST be shown
  as a diff / before-after (reuse the `minspec.showChangesSinceApproval` / `vscode.diff` surface,
  or an inline before/after in the webview) **before** any `WorkspaceEdit` is applied, then
  applied only via the **same** `WorkspaceEdit` path as Slice D — undoable, saveable, and
  **voids approval** like a hand edit. A T0/T1 test asserts: **the preview surface fires before
  the edit**, a **multi-range** AI edit lands + undoes as **one atomic** `WorkspaceEdit`, the
  spec goes stale (AC-12), and the import-ban still holds (AC-8).
- **Converse, not just edit (FR-16):** the same chat surface takes non-edit prompts
  ("explain this", "why is this here?") answered **in-thread**; a `chat:ask{scope, prompt}`
  round-trips through SPEC-014's channel and renders the reply — **no** `WorkspaceEdit` (it's a
  conversation, not a mutation). Three thread actions: **request-edit** → the FR-12 propose→apply
  flow; **fork to session** → hand the thread to the host chat (a chat-participant forks naturally
  — FR-OQ7); **file as issue** → the existing parking-lot `gh issue` path (`parking-lot.ts`),
  reusing its dedup. Because the editor is a derived view (FR-4 `onDidChangeTextDocument`
  re-render), an edit made in a *forked* session shows up here live — no bespoke sync. Still no
  core network import (AC-8, AC-17).
- **FR-OQ6 batching (plan, when work resumes):** if each proposed AI edit is independently
  AI-reviewed before human approval (DR-047), queue several proposals and review/pre-approve them
  as a **batch** (one combined FR-15 diff) to save tokens — extending SPEC-023's consequence/pre-
  approve batching. Scrooge-adjacent; parked with the whole feature until Scrooge v1.

### Slice B2 — chrome (FR-17)

- **Native tabs:** open approvables are ordinary VS Code editor tabs — the custom editor draws
  **none** of its own. Nothing to build; a review checklist item asserts no tab-strip DOM.
- **One bar:** a single top action bar (the webview's own header) carries the view toggles
  (Attention / Dim / Show-changes / Theme) on the left and, on the right, the reading-time readout
  + the approval CTA. There is **no** separate status bar and **no** `viewType` / "viewer
  read-only" / "Open as plain text" chrome (FR-5's escape is the palette).
- **Approval CTA (surfaces SPEC-014's loop):** the button label is derived from approval state —
  *Approve* (never approved) / *Re-approve* (approved-then-changed) / *Pre-approve* (AI-review
  pending, DR-047). It runs **SPEC-014's** approve action (this spec does not redefine the gate);
  *Re-approve* first turns FR-15 change-highlighting on and scrolls to / pulses the changed
  sections so the human checks the delta. No red "void" banner — the CTA *is* the state signal.

### Slice F — telemetry + init (FR-7, FR-14a/b)

- **Reading-time (FR-7):** when SPEC-017's FR-8 opt-in is **on**, the webview streams
  `engage:{scrollTop, focus, ts}` events (content-free: positions + timestamps, never text) to
  the SPEC-017 M3 collector; when off, the webview registers **no** engagement listeners at
  all. A T1 test toggles the opt-in and asserts zero capture calls when off, events when on
  (AC-7). The metric layer imports nothing from `approvable-editor.ts` (T0 direction test,
  INV-Metrics-independent) — the editor pushes to the collector, never the reverse.
- **Init offers (FR-14):** in `init.ts`, add declinable offers — enable `useByDefault` (writes
  the setting + the `workbench.editorAssociations` for the approvable globs), and a pointer to
  SPEC-017's reading-time opt-in (opens its setting, never flips it). Each offer's consent is
  the click (AC-14). These are intended to migrate into the #533 checklist page; until then they
  follow the existing toast shape, kept minimal to avoid the toast-pile the feedback flagged.
  *(The GitHub-PR-extension install offer + `openPullRequest` link-routing helper that were here
  moved to #541.)*

## Contracts

- **`VIEW_TYPE = "minspec.approvableEditor"`** — stable; Costly #1.
- **Webview ⇄ ext messages:** `toc:goto`, `ref:open`, `edit:section` (single range), `ai:editDoc`
  (returns a **set** of ranges, whole change atomic), `chat:ask` (converse, no edit — FR-16),
  `chat:fork` / `chat:issue` (FR-16 actions), `approve` (runs SPEC-014's loop — FR-17),
  `engage` (out, opt-in only), `dim:toggle`
  + `diff:show` (webview-internal view-layer, no ext write). All validated; `edit:section` and
  each range in an `ai:editDoc` proposal are re-validated against the current document before the
  single `WorkspaceEdit` is staged (any stale range → reject the whole proposal + re-render,
  never a blind or partial write).
- **Settings:** `minspec.approvableEditor.useByDefault` (bool, false),
  `minspec.approvableEditor.treeClickOpensText` (bool, false).
- **AI-edit channel:** `editDoc(docText, anchorText, prompt) → Edit[]` (a set of `{range,newText}`,
  possibly whole-doc) — bound to SPEC-014's chosen revision channel (its FR-OQ2), host-delegated;
  core stays network-free (FR-8). No
  standalone broker is defined here.

## Security / Tier-0 notes

- Reused CSP-nonce + `default-src 'none'` (from `spec-panel-html.ts`); the added `<script>`
  runs under the same nonce; no remote origins.
- Range-validation on every edit message prevents a stale/spoofed range from corrupting the
  doc (INV-Viewer-safe).
- The AI edit is the highest-risk surface: it is gated (visible diff **before apply** + DR-012
  approval-void) and host-delegated via SPEC-014's channel (no core network). It never applies
  without first showing a preview and then landing as a normal, undoable edit.
- Import-ban T0 test extended to `approvable-editor.ts` and the FR-12 AI-edit path.

## What this design does NOT do

- Does not hide palette commands (#532), rename slash commands (#534), build the onboarding
  checklist page (#533), or port to non-VS-Code hosts (#531).
- Does not route PR review into the IDE — that (detection + `openPullRequest` + init install-
  offer + CLAUDE.md/harness rewrite) is #541, not this editor.
- Does not define or build an AI broker — FR-12 rides SPEC-014's revision channel (its FR-OQ2).
- Does not add a second renderer, sanitiser, ref parser, or approval mechanism — all reused.
