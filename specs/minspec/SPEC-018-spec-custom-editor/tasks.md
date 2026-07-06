---
id: SPEC-018
type: tasks
# Editing voids approval (hash in .minspec/approvals → stale); re-run "MinSpec: Approve Spec". DR-012
status: implementing
product: minspec
epic: EPIC-002  # Signpost Integrity
---

# MinSpec — Approvable Custom Editor (in-IDE review surface) (Tasks)

**Requirements:** [requirements.md](requirements.md) · **Design:** [design.md](design.md) · **Decision:** [DR-012](../../../docs/decisions/DR-012.md)

Sequencing note: **Slice A depends on SPEC-014 extracting its render function** as a reusable
pure function (FR-6). Do not start Slice A rendering until that lands. **Slice E additionally
depends on SPEC-014 choosing + building its AI-edit / revision channel** (its FR-OQ2) — there is
no AI broker to reuse today. FR-10's cross-ref parser (`reference-checker.ts`) already exists.

---

## T0 — Invariants (before implementation)
- [ ] Test: `customEditors` selector globs are each path-scoped (specs/ ADRs/ epics/ constitution); set ≠ `**/*.md` and matches no top-level `README.md`. (AC-1, INV-No-global-hijack)
- [ ] Test: import-ban — `approvable-editor.ts` + the FR-12 AI-edit path add no `http`/`https`/`fetch`/`net` import reachable from `packages/minspec`. (AC-8, INV-Tier-0)
- [ ] Test: raw-text escape is always reachable in one action (`reopenWithEditor`) regardless of `useByDefault`; **no setting removes it**. (AC-5, INV-Reversible)
- [ ] Test: open ⇒ **zero** `WorkspaceEdit` (viewer-safe); an edit requires an explicit section action. (AC-11, INV-Viewer-safe)
- [ ] Test: toggling dim/attention ⇒ zero `WorkspaceEdit` and byte-identical file content. (AC-13, INV-Attention-view-only)
- [ ] Test: cross-ref rendering emits no `SPEC-`/`DR-`/`EPIC-` ref into any exported/generated user-facing output (anchors stay webview-DOM-only). (AC-15, INV-Cross-ref-egress-safe)
- [ ] Test: the SPEC-017 metric layer has no import of `approvable-editor.ts` (dependency-direction). (AC-7, INV-Metrics-independent)
- [ ] Test: only SPEC-014's pure render function + the shared `reference-checker` `extractReferences` are imported — no second renderer/sanitiser/ref-parser symbol. (AC-6, AC-10, INV-One-renderer)

## Slice A — Register + render + escape (FR-2, FR-5, FR-6, FR-8)
- [ ] `VIEW_TYPE = "minspec.approvableEditor"` — fix the Costly #1 contract.
- [ ] `packages/minspec/package.json`: `contributes.customEditors` with the four scoped selector globs + `priority:"option"`.
- [ ] `packages/minspec/src/views/approvable-editor.ts`: `CustomTextEditorProvider.resolveCustomTextEditor` mounts the reused renderer with the reused nonce/CSP (from `spec-panel-html.ts`).
- [ ] Subscribe to `workspace.onDidChangeTextDocument` for the open doc → re-render (view stays derived from file truth).
- [ ] Register the provider in `extension.ts` `activate()`.
- [ ] FR-5 escape: rely on the **native** `workbench.action.reopenWithEditor` from the Command Palette — **no** editor-chrome button; T1 asserts the native command always reaches text. (AC-5)
- [ ] T1: save/undo/find/frontmatter-validator operate on the backing `TextDocument` identically to native. (AC-4)

## Slice B — Routing + default posture (FR-1, FR-3, FR-14a)
- [ ] `contributes.configuration`: `minspec.approvableEditor.useByDefault` (false), `…treeClickOpensText` (false).
- [ ] `spec-tree-provider.ts`: approvable item `command` → `vscode.openWith(uri, VIEW_TYPE)` unless `treeClickOpensText` → `vscode.open`. (AC-2)
- [ ] Init offer (FR-14a): accepting `useByDefault` writes `workbench.editorAssociations` for the approvable globs (the only truthful "make default" without `priority:"default"`).
- [ ] T2: distinguish tree-click default (setting) from any-path default (`editorAssociations` via init accept); off ⇒ native default + webview via Reopen With; FR-5 holds in both. (AC-3)

## Slice B2 — Chrome (FR-17)
- [ ] Draw **no** own tab strip — rely on native VS Code tabs; review check asserts no tab-strip DOM. (AC-18)
- [ ] **One** combined action bar (view toggles left; reading-time + approval CTA right); no separate status bar; no `viewType` / "viewer read-only" / "Open as plain text" chrome. (AC-18)
- [ ] Approval CTA surfaces **SPEC-014's** approve loop; label = Approve / Re-approve / Pre-approve by state; Re-approve turns on FR-15 highlighting + scrolls to changed sections. (AC-18)
- [ ] T2: CTA label tracks approval state; Re-approve highlights changes; no red "void" banner. (AC-18)

## Slice C — Read ergonomics + quiet diff (FR-9, FR-10, FR-13, FR-15) — view-layer only
- [ ] Outline **in the MinSpec Explorer** (`spec-tree-provider.ts`): open approvable expands to heading child-items; child `command` posts `toc:goto`/reveal+scroll. One sidebar — NOT a second panel. (AC-9)
- [ ] `contributes.keybindings` (when `activeCustomEditorId == minspec.approvableEditor`): next/prev-section + focus-outline; editor scroll-spy tells the tree the active heading. (AC-9)
- [ ] Cross-ref hotlinks: render `reference-checker.ts` `extractReferences` tokens as `<a data-ref>`; `ref:open{id,toSide}` → `openWith(target, VIEW_TYPE, Beside?)`. (AC-10)
- [ ] T1: shared ref parser used (no forked symbol); `toSide` opens `ViewColumn.Beside`. (AC-10)
- [ ] Attention: emphasise via existing #185 eye-icon + SPEC-013 Zone-A/core-end signals; `dim non-essential` toggle + per-paragraph checkboxes apply CSS only. (AC-13)
- [ ] Quiet diff (FR-15): changed runs get a **gutter change-bar + light tint** (CSS/DOM only), NO underline-everything; ranges from the Slice-E proposal diff or `git diff` vs the approved blob. (AC-16)
- [ ] T0: FR-15 highlight writes **zero** document bytes (view-layer). (AC-16). *(Per-commit colour timeline is #544, not here.)*

## Slice D — Editing (FR-4, FR-11, FR-OQ1)
- [ ] **FR-OQ1 research spike (no ship):** prove section-range round-trip robustness; decide edit-depth ceiling (section-only vs full inline parity vs "edit as text" handoff). Record the call in design.md + (if load-bearing) a DR. (Costly #3)
- [ ] Renderer emits per-section source char ranges (heading offsets).
- [ ] Per-section pen (hover + keyboard-focus reveal); activate → `<textarea>` seeded with raw slice.
- [ ] `edit:section{range,newText}` → **re-validate range vs current doc** → `WorkspaceEdit.replace`. Stale range ⇒ reject + re-render (never a blind write).
- [ ] Keybinding "edit focused section" (no mouse-only edit). (AC-11)
- [ ] T1: section edit → backing-doc `WorkspaceEdit`, undoable, and `approval.ts` reports the spec stale (DR-012 void). (AC-11)

## Slice E — AI chat: edit + converse (FR-12, FR-16) — gated on SPEC-014's channel + Slice C (FR-15)
- [ ] **Blocker:** confirm SPEC-014 has chosen + built its revision channel (FR-OQ2). Do NOT build a new broker or a direct AI call. If the channel is unbuilt, Slice E waits (Slices A–D + F ship without the chat).
- [ ] Section-anchored chat icon → prompt input → `ai:editDoc{anchorRange,prompt,anchorText,docText}`. Section is context anchor, **not** a hard boundary — proposal may span sections / whole doc.
- [ ] Invoke via **SPEC-014's channel** `editDoc(...)→Edit[]` (host-delegated; **no** core network import — FR-8 non-negotiable).
- [ ] **Re-validate every returned range** vs current doc → stage as **one** `WorkspaceEdit` (multiple `replace`s) so apply+undo are **atomic**; any stale range ⇒ reject whole proposal + re-render (never partial). (AC-12)
- [ ] Show proposal as an **FR-15 diff before any `WorkspaceEdit` is applied**; apply only via Slice D's path. (R6, Costly #2, INV-Viewer-safe)
- [ ] T0/T1: **preview fires before the edit**; a **multi-range** AI edit applies + undoes as **one unit**, spec goes stale, import-ban holds. (AC-12, AC-8)
- [ ] **Converse (FR-16):** `chat:ask{scope,prompt}` → in-thread reply via SPEC-014's channel, **no** `WorkspaceEdit`. Thread actions: request-edit (→ propose flow), **fork to host session** (`chat:fork`), **file as issue** (`chat:issue` → `parking-lot.ts` `gh issue` path w/ dedup). (AC-17)
- [ ] T2/T0: a non-edit question answers in-thread; fork + file-issue fire; an out-of-editor edit re-renders live via the FR-4 watcher; import-ban holds. (AC-17, AC-8)
- [ ] *(FR-OQ6, plan when work resumes: batch proposals into one AI-review/pre-approve pass — combined FR-15 diff — to save tokens; extend SPEC-023. FR-OQ7: conversation depth + fork mechanism. Scrooge-adjacent.)*

## Slice F — Telemetry + init (FR-7, FR-14a/b)
- [ ] Reading-time: when SPEC-017 FR-8 opt-in ON, webview streams content-free `engage:{scrollTop,focus,ts}` to the M3 collector; when OFF, register no engagement listeners.
- [ ] T1: opt-in OFF ⇒ zero capture calls + editor still renders; ON ⇒ events flow to FR-7a. (AC-7)
- [ ] Init offers (FR-14a/b): enable `useByDefault`; pointer to SPEC-017 reading-time opt-in (open its setting, never flip). Each declinable, consent = click. (AC-14)
- [ ] *(PR-into-IDE `openPullRequest` routing + GitHub-PR-ext install offer + `/pull/` harness rewrite → **#541**, not this spec.)*

## Wire-up / verification
- [ ] `npm run build` + `npm test` green (new T0/T1/T2 pass; existing suite unbroken).
- [ ] `npm run validate` green (this spec's frontmatter + refs).
- [ ] Manual: open a spec, DR, epic, and the constitution via the editor; verify render, TOC, a cross-ref "open to the side", a pen edit (→ stale), the quiet diff highlight (gutter bar + tint, not underline-everything), dim toggle (byte-lossless), and the text escape. (AI edit only once SPEC-014's channel is built — Slice E.)
- [ ] Package + `codium --install-extension … --force`, reload window; confirm no stale build (per install-steps memory).

## Notes / deferred
- **FR-OQ4** (AI-suggested emphasis for FR-13) — resolved-deferred; v1 uses deterministic signals only.
- **FR-OQ1** (edit-depth) — research spike (Slice D), no shippable DoD; output is a design/DR decision.
- **FR-OQ6** (batch AI-edit review) — plan when work resumes; scrooge-adjacent, extends SPEC-023.
- PR-into-IDE routing (#541), per-commit diff-colour timeline (#544), palette-command hiding (#532),
  `/minspec-` rename (#534), onboarding checklist page (#533), other-IDE port (#531) are **out of
  scope** — follow-ups, not tasks here.
- **Whole feature PAUSED until Scrooge v1 ships** (token economy) — do not resume implementation
  before then. Not parked to an issue (user directive 2026-07-06).
