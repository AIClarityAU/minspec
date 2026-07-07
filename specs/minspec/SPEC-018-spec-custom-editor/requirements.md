---
id: SPEC-018
type: requirements
status: implementing
tier: T4
product: minspec
epic: EPIC-002  # Signpost Integrity
aspects: [ux]
depends_on: [SPEC-014]
relates_to: [SPEC-017, SPEC-022, SPEC-021, SPEC-013, DR-012]
---

# MinSpec — Approvable Custom Editor (in-IDE review surface) (Requirements)

**Date:** 2026-06-04 · **Amended:** 2026-07-05 (re-approval feedback)
**Status:** Specifying (SDD Specify phase)
**Triggered by:** session request (SPEC-017 clarify) — "the webview gives better
[engagement] tracking, so default to webview for all operations: click targets from any
MinSpec explorer pane, and hook Ctrl-P to open .md files in our webview." — **plus** the
2026-07-05 re-approval feedback (this amendment): all-approvables scope, floating TOC,
cross-ref hotlinks, hover section-edit + AI-chat-edit, attention-dimming, reading-time
capture, and an init prompt to use the editor. (PR-into-IDE link routing, originally folded
into this feedback, was **split to [#541](https://github.com/AIClarityAU/minspec/issues/541)**
as cross-cutting — it acts on the signpost + generated harness, not the editor surface.)
**Scoped decision (this session):** own-tree-click routing **+ a scoped, opt-in custom
editor for approvable-document paths** (specs, ADRs, epics, plans, tasks, constitution) —
*not* a global Ctrl-P / all-markdown hijack (rejected, see §What this is NOT).
**Composes:** [SPEC-014](../SPEC-014-review-webview/requirements.md) renderer (one render function,
reused — DRY) + [DR-012](../../../docs/decisions/DR-012.md) approval gate +
[SPEC-022](../SPEC-022-approval-foundation/requirements.md) approvable set / approval ground truth.
**Epic:** [EPIC-002 Signpost Integrity](../../../docs/epics/EPIC-002-signpost-integrity.md).
**Serves:** [SPEC-017 Trust Dashboard](../SPEC-017-trust-dashboard/requirements.md) FR-7a as the
*richest* engagement source — but SPEC-017 must work without it.

---

## Context

Approvables (specs, ADRs, epics, plans, tasks, the constitution) are `.md` files; today
they open in VS Code's default text editor. SPEC-017's engagement-denoised time metric
(FR-7a) is richer when the human reads a doc **inside a webview** MinSpec owns (full-DOM
scroll/focus/dwell) than in the plain editor (only `onDidChangeTextEditorVisibleRanges` /
`Selection` / `ActiveTextEditor`). The session asked to therefore "default to the webview
for all operations." The 2026-07-05 re-approval sharpened the ask: this editor is not just
a routing trick for a metric — it is meant to be **the review surface**, the place a human
does the "just enough human" verification MinSpec sells (see [[just-enough-human]]): read
what matters, dim what doesn't, jump between linked approvables, and make a small edit (by
hand or by asking the AI) without leaving the rendered view.

Two mechanisms were proposed; only one is real:

- **Hooking Ctrl-P** to redirect `.md` opens — **not possible.** VS Code Quick Open exposes
  no interception API; an extension cannot reroute "open this file" from the Quick Open path.
- **A custom editor** (`customEditors` contribution) — the *only* API that makes a file open
  in an extension-owned webview by any path (tree click, Ctrl-P, explorer). This spec uses
  that, **scoped to approvable paths and opt-in**, to deliver the intent without the hijack.

The premise keeps its guardrail: this routing serves **only M3** (SPEC-017's secondary,
opt-in correlate). **M1** (char rework %, the ground truth) diffs files and needs no webview
(SPEC-017 FR-3). So the *metrics* never load-bear on this editor (INV — Metrics-independent).
The editor's own value — reading, navigating, attention-triage, and light editing of
approvables — stands on its own whether or not telemetry is on.

## Clarify decisions (this amendment)

The three v1 open questions are resolved here (2026-07-05 feedback); one becomes a plan
research spike rather than a settled answer:

- **OQ2 → resolved: offer `useByDefault`.** Ship `priority:"option"` **and** the
  `minspec.approvableEditor.useByDefault` setting, and surface it as an **init prompt**
  (FR-14) so the user can opt the editor in as the default at setup. (Was "option-only for
  v1"; the feedback asks for the offer up front.)
- **OQ3 → resolved: all approvables, not specs-only.** The custom-editor selector covers the
  full approvable set (specs, ADRs `docs/decisions/**`, epics `docs/epics/**`, plans/tasks
  under `specs/**`, `.minspec/constitution.md`) — **never** `**/*.md` (FR-2, INV-No-global-hijack).
- **OQ1 → remains open as a plan research spike (edit-parity depth).** The feedback confirms
  this "needs research." The v1 *direction* is now fixed by FR-4/FR-11 (viewer-by-default +
  per-section edit round-tripped to the `TextDocument`); what the spike resolves is **how
  deep** in-webview editing goes — section-scoped round-trip only, vs full inline editing
  parity (find/replace, multi-cursor), vs "edit as text" for heavy edits (FR-OQ1).

## What this is NOT (rejected)

- **No global markdown hijack.** Registration MUST NOT target `**/*.md`. Owning every
  README/note in the workspace replaces the user's editor wholesale — the exact intrusive
  over-reach the "just enough human" thesis sells against.
- **No forced default.** The editor MUST NOT seize approvables as the unavoidable default
  with no easy way back to text (no `priority:"default"` with no escape).
- **No Ctrl-P keybinding hook.** Routing is achieved by the custom-editor registration, not
  by intercepting the Quick Open keystroke (which has no API). Documented so no one tries.
- **No telemetry coupling.** The editor existing does NOT mean reading-time capture is on;
  capture stays SPEC-017 FR-8's own opt-in (INV — Metrics-independent, FR-7).
- **No silent AI writes.** The hover-chat AI edit (FR-12) never writes an approvable silently:
  the change lands on the `TextDocument` visibly and passes through the DR-012 approval gate
  (editing voids approval), exactly like a human edit.
- **No PR-review surface here.** Routing PR review into the IDE (open PRs in the GitHub Pull
  Requests extension when present, browser fallback, init install-offer) is **out of scope for
  this spec** — the editor renders approvables (specs/DRs/epics), never PRs. That cross-cutting
  link-routing lives in [#541](https://github.com/AIClarityAU/minspec/issues/541).

## Requirements

### Routing into MinSpec's surface

- **FR-1 (tree-click → webview, with a text escape).** Clicking an approvable in MinSpec's
  own tree view ([`spec-tree-provider.ts`](../../../packages/minspec/src/views/spec-tree-provider.ts))
  MUST open it in the MinSpec webview editor (FR-2), and MUST always offer a one-click
  "Open as plain text" affordance. A setting MUST let the user revert tree-clicks to the
  plain text editor.
- **FR-2 (scoped custom-editor registration — approvable paths).** MinSpec MUST register a
  `customEditors` contribution whose selector matches **approvable-document paths only**
  (specs `**/specs/**/*.md`, ADRs `**/docs/decisions/**/*.md`, epics `**/docs/epics/**/*.md`,
  the constitution `**/.minspec/constitution.md`), never all markdown. The set of globs is
  the machine-readable expression of "an approvable" (aligned with SPEC-022); adding a new
  approvable type widens this set, nothing else. The `viewType` is a stable public contract
  once shipped (Costly #1).
- **FR-3 (opt-in priority — `option`, not `default`, plus an offered default).** The custom
  editor MUST ship with `priority: "option"`: it appears in "Reopen Editor With…" but does
  NOT become the default for approvables unless the user opts in via
  `minspec.approvableEditor.useByDefault` (default **off**). The init flow MUST *offer* to
  enable it (FR-14, resolves OQ2). Even when default-on, FR-5's escape holds.

### Don't strand the document (viewer-first, editing preserved)

- **FR-4 (editing preserved — `CustomTextEditorProvider`, not a replacement editor).** The
  custom editor MUST be a `CustomTextEditorProvider` backed by the real `TextDocument`, so
  **save, undo/redo, find, git gutter, the frontmatter validator, and the RCDD/commit hooks
  keep working** on the underlying file. Edits made in the webview (FR-11 pen, FR-12 chat)
  round-trip to that `TextDocument` via `WorkspaceEdit`, so they are ordinary document edits
  (undoable, saveable, hashable for DR-012). A read-only viewer that strips editing is NOT
  acceptable as the *default* path; the FR-OQ1 fallback (viewer + always-adjacent text
  editor) is the only permitted degradation, never a strand.
- **FR-5 (always-available escape hatch — via the palette, not editor chrome).** From the
  webview the user MUST be able to reach the raw text in one action, always, regardless of FR-3
  state. This is the **native** `workbench.action.reopenWithEditor` / "Open as plain text",
  reachable from the **Command Palette** — the editor MUST NOT waste a chrome button on it
  (2026-07-06 feedback: the palette already carries it). The native command MUST continue to work.

### Reuse + boundary

- **FR-6 (one renderer — reuse SPEC-014, no second markdown path).** The editor MUST mount
  the **same pure render function** SPEC-014 defines (its FR-1/FR-16) / SPEC-017 FR-12 — no
  duplicate markdown renderer/sanitiser. Same CSP-nonce, same Tier-0 sanitisation.
- **FR-8 (Tier-0 — inherited).** The editor adds no `http`/`https`/`fetch`/`net` import to
  `packages/minspec` (SPEC-014 FR-17 / invariant #2 / DR-004). This binds FR-12's AI edit too: it is host-delegated through SPEC-014's revision channel, never a network import in core.
  Import-ban T0 test.

### Reading-time capture (answering "why aren't we capturing reading time here?")

- **FR-7 (this editor IS the rich reading-time source — gated by SPEC-017's opt-in).** When
  SPEC-017 FR-8 telemetry is ON, this editor MUST emit the richer full-DOM scroll/focus/dwell
  events that feed SPEC-017 FR-7a's **engaged reading time** — i.e. reading time *is* captured
  here, and this is the surface that captures it best. When telemetry is OFF the editor
  captures **nothing** and stays fully usable for reading/reviewing. The editor's usefulness
  MUST NOT depend on telemetry being on. The init prompt (FR-14) may *point to* SPEC-017's
  opt-in, but the editor never turns human telemetry on by itself (INV — Metrics-independent).

### In-webview review ergonomics (2026-07-05 feedback)

- **FR-9 (document outline — merged into the MinSpec Explorer, one sidebar).** The editor MUST
  provide a section outline (a TOC) built from the document's headings; clicking an entry scrolls
  to that section. Placement (2026-07-06 feedback): the outline lives **inside the MinSpec
  Explorer as an expandable node under the currently-open approvable** — NOT a second right-hand
  panel (that wastes width; one sidebar total). The outline MUST be keyboard-navigable (a two-key
  path to jump to next/previous section and to focus it), per the keyboard-over-mouse preference.
- **FR-10 (approvable cross-ref hotlinks).** References to other approvables in the body —
  `SPEC-NNN`, `DR-NNN`, `EPIC-NNN`, and relative doc links — MUST render as **hotlinks** that
  open the referenced approvable. Each MUST offer opening **in another editor group / window**
  ("open to the side"), so a reviewer can read a spec beside the DR it cites. Ref detection
  MUST reuse MinSpec's existing DR/SPEC/EPIC-ref machinery (do not fork a second parser); the
  UI is internal, but MUST NOT surface MinSpec's own internal refs into *user-facing exported
  output* (stay consistent with [SPEC-021](../SPEC-021-dr-ref-isolation/requirements.md) / DR-032 egress rule).
- **FR-11 (section-level edit — hover pen; viewer by default).** Default posture is a
  **viewer**. Each section MUST show, on hover (and on keyboard focus), a **pen icon** that
  switches *that section* into an editable field; on commit, the edit round-trips to the
  backing `TextDocument` (FR-4). A keyboard path MUST edit the focused section (no mouse-only
  edit). Editing a section is an ordinary document edit — it voids approval per DR-012 like
  any other (INV — Viewer-safe / edit-is-explicit).
- **FR-12 (AI edit — hover chat; section-anchored, *not* section-limited).** Each section MUST
  show, on hover (and on keyboard focus), a **chat icon** that opens a prompt to ask the AI to
  update the document. The hovered section is the **invocation anchor / default context**, but
  the AI's proposed change **MUST NOT be forced to stay within that section** — the request may
  legitimately need a document-wide edit or changes across several related sections (e.g. "rename
  this term everywhere", "make the Risks table consistent with the new FR"). The proposal is
  therefore a **set of edits** (one or many ranges, up to whole-document), applied to the
  `TextDocument` through the **same** edit path as FR-11 as **one atomic `WorkspaceEdit`**
  (undoable/redoable as a unit, hashable). It MUST be **visible/diffable before it lands** (never
  a silent write; the diff highlighting is FR-15), and — being a change to an approvable — MUST
  pass through the DR-012 approval gate (the edit voids prior approval). The AI call MUST go
  through the **same AI-edit channel SPEC-014 chooses for its revision loop** (SPEC-014's FR-OQ2 —
  chat-participant vs a `minspec.dispatchRevision` command vs prompt-file vs the DR-017 broker),
  **not** a new or assumed one; that channel is **unresolved and unbuilt today**, so FR-12
  (Slice E) is a **hard dependency** on its resolution (Dependencies) and MUST NOT ship before
  it. Whatever the channel, it adds **no** network import to `packages/minspec` (FR-8) — the
  Tier-0 boundary is non-negotiable; the channel choice is SPEC-014's.
- **FR-13 (attention-marking + dim non-essential).** The editor MUST let the reader focus on
  **what needs the most human attention** and **dim the less-essential paragraphs** (a toggle
  / per-paragraph checkbox). This is the "just enough human" thesis made visual: emphasise the
  Zone-A / cross-check / MUST-READ content (align with the read-this eye-icon mechanism, #185,
  and the Zone-A / core-end divider convention from [SPEC-013](../SPEC-013-risk-section-policy/requirements.md)),
  de-emphasise the rest. The dim/attention state is a **view preference only** — it MUST NOT
  alter the underlying bytes (INV — Attention model is view-only).

### Init prompts (offered, declinable) (2026-07-05 feedback)

- **FR-14 (init prompts — offered, declinable, consolidated toward a checklist).** Init MUST
  *offer* (never silently enable): (a) enable the approvable editor as default (`useByDefault`,
  FR-3, resolves OQ2); (b) a pointer to SPEC-017's reading-time opt-in (FR-7) — pointing, never
  enabling telemetry. Each offer's consent is the click. Because init-toast overload is a real
  smell, these SHOULD land as items in the onboarding **checklist page**
  ([#533](https://github.com/AIClarityAU/minspec/issues/533)) rather than more modal toasts;
  until that page exists they MAY ship as minimal toasts consistent with the existing init flow.
  *(The GitHub-PR-extension install offer that originally sat here moved to
  [#541](https://github.com/AIClarityAU/minspec/issues/541) with the PR-routing feature.)*

### Change visualization (2026-07-06 feedback)

- **FR-15 (subtle, non-distracting diff highlighting).** When the editor shows a proposed change
  (FR-12 AI edit, before it lands) or *changed-since-approval* content, it MUST highlight what
  changed **subtly** — **NOT** underline-everything or any treatment that makes the whole
  paragraph hard to read. The floor for v1: a **quiet change-bar in the gutter** next to changed
  paragraphs (like a git gutter) plus a **light background tint** on the changed run — never
  dense inline underlines/strikethroughs across the body. The highlight is a **view layer only**
  — it MUST NOT alter the document bytes (same class as INV — Attention view-only). The richer
  *per-commit colour timeline* (a different colour per iteration/commit, scrollbar markers, a
  selectable commit legend) is **out of scope here** — parked at
  [#544](https://github.com/AIClarityAU/minspec/issues/544); FR-15 is only the quiet-diff floor
  that that feature later builds on.

### Conversation + editor chrome (2026-07-06 feedback)

- **FR-16 (chat is a *conversation* about the doc, not only an edit box).** The FR-12 chat MUST
  support two-way discussion — asking the AI to **explain / discuss** a section or the whole
  document ("why is this section here?", "explain FR-12"), not just "make this edit". From the
  conversation the user MUST be able to: (a) **request an edit** → the FR-12 propose-diff-then-
  apply flow; (b) **fork/continue the exchange as a full LLM session** (hand the thread to the
  host's chat — same channel family as FR-12 / SPEC-014 FR-OQ2); and (c) **file the thread (or a
  point in it) as an issue** (reuse the parking-lot `gh issue` path, `parking-lot.ts`). A
  *separate-window* conversation is a valid path **because FR-4 already re-renders on
  `onDidChangeTextDocument`** (the editor is a derived view) — so an edit made in a forked session
  reflects live. FR-16 adds **no** network import to core (FR-8) — it rides the same host-delegated
  channel. *(Conversation + fork/session is the largest of the 2026-07-06 additions; its depth is
  FR-OQ7.)*
- **FR-17 (editor chrome — defer to VS Code, one bar, approval as the CTA).** The editor MUST NOT
  draw its **own** tab strip — open approvables are **native VS Code editor tabs/windows** (do not
  reinvent them). The editor's toolbar and status line MUST be **one combined bar**, not two. The
  approval state MUST be presented as the bar's **primary action button** — *Pre-approve /
  Approve / Re-approve* by state — **not** a large red "approval void" banner; when the label is
  *Re-approve*, activating it MUST highlight the changed sections (FR-15). The bar MUST NOT carry
  low-value chrome: no `viewType` string, no "viewer — read-only" label, no "Open as plain text"
  button (that escape is the Command Palette, FR-5). The approval action itself is
  **[SPEC-014](../SPEC-014-review-webview/requirements.md)'s approve loop** surfaced here — this
  spec only positions it, it does not redefine the gate (DR-012 / SPEC-022 own that).

*Expensive-to-reverse commitments, ranked most→least.*

1. **`customEditors` `viewType` + selector globs (FR-2).** A public-ish contract: once users
   associate approvables with this editor (and `Reopen With` remembers it), changing the
   viewType or the glob set churns their settings + muscle memory. *Check: viewType name +
   glob set (the approvable path list) fixed before first release.*
2. **AI-edit round-trip + gate contract (FR-12).** How the hover-chat edit reaches the
   `TextDocument` (as **one atomic, possibly multi-range/doc-wide** `WorkspaceEdit`), how it is
   shown before landing (FR-15 diff), and that it voids approval (DR-012) — a behaviour users
   will trust. Shipping "silent apply", "single-section-only", or "apply then retrofit a gate"
   are all trust regressions. *Check: edit-is-visible + atomic-multi-range + edit-voids-approval
   settled before release.*
3. **Edit-depth decision (FR-4, FR-11, FR-OQ1).** Section-round-trip only vs full inline
   editing parity vs "edit as text" fallback = a near-rewrite of the interaction layer if
   flipped later. *Check: edit-depth settled at plan, before any release sets expectations.*
4. **Priority/default posture (FR-3).** Shipping `priority:"default"` then retreating to
   `option` (or vice-versa) re-trains users and may strand `Reopen With` associations.
   *Check: `option` + opt-in-setting + init-offer posture confirmed before release.*

## Invariants (must hold)

- **INV — No global hijack (T0).** The `customEditors` selector targets approvable paths only
  (specs / ADRs / epics / constitution), never `**/*.md`. A test asserts each contributed glob
  is path-scoped and that the set does not match a top-level `README.md`.
- **INV — Reversible / never stranded (T0).** A raw-text path is always one action away
  (FR-5); the user can always edit an approvable as text. No configuration removes the escape.
- **INV — Viewer-safe / edit-is-explicit (T0).** Opening an approvable never immediately
  mutates it; an edit requires an explicit per-section action (FR-11 pen / FR-12 chat); the AI
  edit (FR-12) never writes silently and always passes the DR-012 gate. A test asserts open ⇒
  zero `WorkspaceEdit`, and that an AI edit produces a visible, undoable, approval-voiding edit.
- **INV — Attention model is view-only (T0).** Dimming / attention-marking (FR-13) is a render
  preference; it never changes the document bytes. A test asserts toggling dim produces zero
  document edits and identical file bytes.
- **INV — Metrics-independent (T0).** SPEC-017's M1/M2 (and M3's existence) do **not** depend
  on this editor; with this feature disabled the Trust Dashboard still computes. This editor
  only *enriches* M3's engagement source (FR-7). A test asserts the metric layer has no hard
  import of the custom-editor module.
- **INV — One renderer (T0).** No second markdown render/sanitise path; SPEC-014's pure
  function is reused (FR-6); cross-ref rendering (FR-10) reuses the existing ref parser, not a
  fork. Tier-0 sanitisation preserved.
- **INV — Cross-ref egress-safe (T0).** FR-10's cross-ref hotlinks are **webview-internal**:
  MinSpec-internal `SPEC-`/`DR-`/`EPIC-` refs render as in-webview anchors and are NEVER emitted
  into user-facing *exported/generated* output (the SPEC-021 / DR-032 egress-asymmetry class). A
  test asserts cross-ref rendering writes no ref into any exported artifact.
- **INV — Tier-0 core (T0).** No networking import added to `packages/minspec` (FR-8),
  including via FR-12's AI edit — which is host-delegated through SPEC-014's revision channel,
  never a core network import.

## Acceptance Criteria

*Definition-of-done; each traces an FR / INV. Zone A — read before approving.*

- [ ] **AC-1 (FR-2 / INV-No-global-hijack).** Every `customEditors` `selector` glob is
  path-scoped to an approvable type (specs / ADRs / epics / constitution) and the set is
  **never** `**/*.md`; the T0 glob-scope test asserts this and fails on a global pattern or a
  top-level `README.md` match.
- [ ] **AC-2 (FR-1).** Clicking an approvable in
  [`spec-tree-provider.ts`](../../../packages/minspec/src/views/spec-tree-provider.ts)
  opens it in the MinSpec webview editor, with a visible one-click "Open as plain text"
  affordance; the revert setting restores plain-text open.
- [ ] **AC-3 (FR-3 / OQ2).** The contribution ships `priority: "option"`; with
  `minspec.approvableEditor.useByDefault` at default (**off**), opening an approvable uses the
  native text editor and the webview is reachable via "Reopen Editor With…". The setting governs
  **MinSpec's own tree-click routing** (FR-1); making the webview the default for *arbitrary*
  opens (Ctrl-P / explorer) is done by the init offer writing `workbench.editorAssociations`
  (there is no API to flip a custom-editor `priority` at runtime — design Slice B). A test
  asserts: setting-on ⇒ tree-click opens the webview; init-accept ⇒ `editorAssociations` written;
  FR-5 escape holds in both.
- [ ] **AC-4 (FR-4).** Inside the webview, save, undo/redo, find, git gutter, the frontmatter
  validator, and the RCDD/commit hooks all act on the underlying `TextDocument` (T1 tests for
  save/undo/validator pass); the provider is a `CustomTextEditorProvider`, not a replacement
  editor.
- [ ] **AC-5 (FR-5 / INV-Reversible).** From the webview the raw text is reachable in one
  action regardless of FR-3 state; `workbench.action.reopenWithEditor` still works; no setting
  removes this escape.
- [ ] **AC-6 (FR-6 / INV-One-renderer).** The editor mounts SPEC-014's pure render function;
  no second markdown renderer/sanitiser is introduced; cross-ref hotlinks (FR-10) reuse the
  existing ref parser; same CSP-nonce and Tier-0 sanitisation.
- [ ] **AC-7 (FR-7 / INV-Metrics-independent).** With SPEC-017 FR-8 telemetry OFF the editor
  captures nothing and remains fully usable; with it ON the editor emits scroll/focus/dwell
  feeding FR-7a engaged reading time; the metric layer has no hard import of the custom-editor
  module (T0 dependency-direction test).
- [ ] **AC-8 (FR-8 / INV-Tier-0).** No `http`/`https`/`fetch`/`net` import is added to
  `packages/minspec` — including through the FR-12 AI edit (host-delegated via SPEC-014's
  channel); the import-ban T0 test passes.
- [ ] **AC-9 (FR-9).** The floating TOC lists the document's headings, clicking an entry
  scrolls to that section, and next/previous-section + focus-TOC each have a keyboard path.
- [ ] **AC-10 (FR-10).** `SPEC-NNN` / `DR-NNN` / `EPIC-NNN` / relative-link references render
  as hotlinks that open the referenced approvable, with an "open to the side" affordance; a
  test asserts the ref parser is the shared one (no forked parser symbol).
- [ ] **AC-11 (FR-11 / INV-Viewer-safe).** Default open is a viewer with zero document edits;
  a per-section pen (mouse or keyboard) switches that section to editable and commits a
  `WorkspaceEdit` to the backing `TextDocument`; the edit is undoable and voids approval.
- [ ] **AC-12 (FR-12 / INV-Viewer-safe).** The chat icon submits an AI update request anchored
  at the hovered section; the proposal **may span multiple sections or the whole document**, is
  **surfaced as a diff (FR-15) before any `WorkspaceEdit` is applied**, then lands as **one
  atomic, undoable `WorkspaceEdit`** (possibly multi-range) through the FR-11 path, never a
  silent write, and voids prior approval (DR-012); the AI call uses SPEC-014's channel (no core
  network import, AC-8). A test asserts: the preview fires before the edit; a multi-range
  proposal applies + undoes as a single unit.
- [ ] **AC-13 (FR-13 / INV-Attention-view-only).** The editor can emphasise
  most-attention content and dim less-essential paragraphs; toggling dim produces **zero**
  document edits and byte-identical file content.
- [ ] **AC-14 (FR-14).** Init offers (a) enable `useByDefault` and (b) a pointer to SPEC-017's
  reading-time opt-in; each is declinable and none enables telemetry or writes without the
  user's click.
- [ ] **AC-15 (FR-10 / INV-Cross-ref-egress-safe).** Cross-ref hotlink rendering emits no
  MinSpec-internal `SPEC-`/`DR-`/`EPIC-` ref into any exported/generated user-facing output
  (the anchors live only in the webview DOM); a T0 test asserts this.
- [ ] **AC-16 (FR-15).** A proposed/changed run is highlighted **subtly** — gutter change-bar +
  light background tint, **no** dense inline underline/strikethrough across the paragraph; the
  highlight alters **zero** document bytes (view-layer test). The per-commit colour timeline is
  NOT built here (→ #544).
- [ ] **AC-17 (FR-16).** The chat answers a non-edit question (e.g. "explain this") in-thread;
  from the thread the user can (a) request an edit → the FR-12 propose→apply flow, (b) fork to a
  full LLM session, and (c) file the thread as an issue (parking-lot `gh issue` path). An edit
  made out-of-editor re-renders here live (FR-4 watcher). No core network import (AC-8).
- [ ] **AC-18 (FR-17).** The editor draws **no** own tab strip (uses native VS Code tabs); the
  toolbar + status are **one** bar; the approval CTA reads *Pre-approve/Approve/Re-approve* by
  state (no red "void" banner), and *Re-approve* highlights the changed sections (FR-15); the bar
  shows no `viewType` / "viewer read-only" / "Open as plain text" button.

## Coverage Map (session ask → FR)

| Concern (from session / 2026-07-05 feedback) | FR |
|---|---|
| click targets from MinSpec explorer pane → webview | FR-1 |
| "hook Ctrl-P to open .md in our webview" | FR-2 (custom editor — the real mechanism) + §What this is NOT (no Ctrl-P hook) |
| "default to webview for all operations" | FR-2/FR-3 (scoped + opt-in), bounded by INV-No-global-hijack |
| better engagement tracking (motivation) | FR-7 (gated by SPEC-017 FR-8) |
| "why aren't we capturing reading time in the new editor?" | FR-7 (this editor *is* the rich FR-7a source; opt-in) |
| don't lose normal editing | FR-4, FR-5 |
| don't re-implement rendering | FR-6, FR-10 (shared ref parser) |
| OQ2 — offer `useByDefault` | FR-3, FR-14 |
| OQ3 — all approvables, not specs only | FR-2 |
| OQ1 — edit parity needs research | FR-OQ1 (plan spike) + FR-4/FR-11 direction |
| floating TOC | FR-9 |
| hotlink approvable refs → open in other windows | FR-10 |
| viewer by default, hover pen to edit a section | FR-11 |
| hover chat icon to ask AI to update the doc (may be doc-wide, not just the section) | FR-12 |
| batch proposed AI changes for one review pass (token economy) | FR-OQ6 |
| note what needs human attention / dim less-essential | FR-13 |
| highlight diffs subtly, not underline-everything | FR-15 |
| different diff colour per commit + selectable timeline/legend | → **#544** (parked) |
| converse with the LLM about the doc (explain / discuss), fork a session, file an issue | FR-16 (+ FR-OQ7) |
| merge both sidebars → TOC as outline inside the MinSpec Explorer | FR-9 |
| use native VS Code tabs; combine top+bottom bar; approve/re-approve CTA not a red warning; drop viewType / "read-only" / plain-text button | FR-17 |
| init question/toast to use the new editor | FR-14 |
| init getting too UX-heavy for toasts → checklist page | FR-14 → #533 (parked) |
| keep PR reviewing inside VS Code if GitHub vsix installed | → **#541** (split out — not the editor surface) |
| offer GitHub vsix via toast during init if absent | → **#541** (split out) |

## Risks & Mitigations

| # | Risk | Likelihood · Impact | Mitigation |
|---|---|---|---|
| R1 | **Fights other markdown extensions for approvables.** Markdown All-in-One / preview / linters lose their grip on approvable files. | Med · Med | `priority:"option"` (FR-3) so default behaviour is unchanged until opt-in; scoped glob set; FR-5 escape. |
| R2 | **Editing regressions.** find/replace, LSP, git gutter, validator break inside a custom editor. | Med · High | FR-4 `CustomTextEditorProvider` over the real `TextDocument`; T1 tests for save/undo/validator; viewer-fallback never the default. |
| R3 | **Hijack/surprise perception.** Users feel MinSpec seized their editor → marketplace backlash. | Med · High | INV-No-global-hijack + FR-3 opt-in default-off + FR-5 escape + scoped glob. Never `**/*.md`, never silent default. |
| R4 | **Telemetry-coupling confusion.** "Webview editor = I'm being watched." | Med · Med | INV-Metrics-independent + FR-7: editor works fully with telemetry OFF; capture is SPEC-017 FR-8's separate, visible opt-in; FR-14 points, never enables. |
| R5 | **Renderer slower than native editor on a large approvable** — FR-6's reused render builds full DOM where the text editor virtualises lines. | Low · Med | FR-5's text path reused as a size-triggered fallback (Failure-Modes); byte/line threshold set at plan; whether FR-6 must virtualise is an FR-OQ1-adjacent plan call. |
| R6 | **AI edit (FR-12) writes something wrong, silently.** The chat icon becomes a way to corrupt an approvable without the human seeing it — sharper now that FR-12 may edit doc-wide, not just one section. | Med · High | INV-Viewer-safe: FR-12 shows the diff (FR-15) **before** applying, lands **one atomic undoable** `WorkspaceEdit` (whole multi-range change reverts as a unit), and **voids approval** (DR-012); never a silent write; host-delegated AI (no core network). |
| R7 | **Feature sprawl → the review surface becomes a mini-IDE.** TOC + cross-ref + section-edit + AI-chat + attention is a lot; risk of a heavy, slow, un-focused webview. | Med · Med | Slices are independently shippable (design Approach); viewer + escape (FR-5) is the load-bearing floor; TOC/attention/cross-ref are read-side and cheap; edit/AI are gated add-ons behind the same `TextDocument` seam. **PR-routing was split out (#541)** to keep this surface to approvables only. |
| R8 | **Attention-dimming hides content a reviewer needed.** De-emphasising the "wrong" paragraph could mask a real issue. | Low · Med | INV-Attention-view-only: dim is reversible, byte-lossless, and per-paragraph; nothing is removed; emphasis defaults to the existing Zone-A/#185 signals, not a new heuristic. |

## Dependencies

- **`depends_on: SPEC-014` (two hard couplings).** (i) **Render:** reuses its renderer/
  sanitiser + CSP-nonce (FR-6); SPEC-014 is `implementing`; this editor's render layer sequences
  after that render function is extracted as a reusable pure function. (ii) **AI-edit channel:**
  FR-12 (Slice E) MUST use the *same* AI-edit channel SPEC-014 picks for its revision loop
  (SPEC-014's FR-OQ2 — chat-participant / `minspec.dispatchRevision` / prompt-file / DR-017
  broker), which is **unresolved and unbuilt**. There is no existing MinSpec "AI broker" to
  reuse today; FR-12 is a **hard dependency** on that resolution and MUST NOT ship before it.
  The cross-ref parser (FR-10) is `reference-checker.ts`, which already exists (below).
- **`relates_to: SPEC-022`** — the approvable set (FR-2 glob list) and the approval gate
  (FR-11/FR-12 void-on-edit) are grounded in SPEC-022's approval ground truth. Note SPEC-022
  replaces raw-byte hashing with **canonical-content** hashing (excludes lifecycle frontmatter);
  FR-11/FR-12 edit *body* sections, which still void approval — the design cites canonical-content
  hashing, not "file bytes".
- **`relates_to: SPEC-017`** — provides FR-7a's richest engagement source; *enrich-only*
  (INV-Metrics-independent), never a hard dependency either direction.
- **`relates_to: SPEC-021`** — cross-ref rendering (FR-10) must not become an egress leak of
  internal refs into exported user output (DR-032 rule).
- **`relates_to: SPEC-013` / #185** — the attention model (FR-13) reuses the Zone-A / core-end
  divider convention and the read-this eye-icon signal, not a new heuristic.

## Assumptions

- VS Code's `CustomTextEditorProvider` can back a webview with the real `TextDocument` so
  save/undo/find/git-gutter keep working (FR-4); FR-OQ1 exists because the *edit-depth* this
  supports (section round-trip vs full parity) is not yet proven.
- SPEC-014's render function is extracted as a reusable pure function (FR-6) before this editor
  mounts it (SPEC-014 is `implementing`).
- Approvables live under the path shapes in FR-2 so a path-scoped glob set selects them
  without touching other markdown (INV-No-global-hijack).
- MinSpec already has a DR/SPEC/EPIC-ref parser — `reference-checker.ts`'s `extractReferences`
  (emits `spec`/`decision`/`epic`/`file` kinds) — that FR-10 reuses rather than forks.
- **Not assumed:** an existing AI-invoke broker. There is none in `packages/minspec` today
  (`bridge.ts` is extension *detection*, not an AI channel). FR-12's AI edit therefore depends on
  SPEC-014 first choosing + building the revision channel (Dependencies); the FR-8 Tier-0
  boundary holds whatever channel is chosen (no core network import).

## Test-thought

Verified by: (1) T0 glob-scope test — every selector path-scoped, set ≠ `**/*.md`, rejects a
top-level `README.md` (INV-No-global-hijack, FR-2); (2) T0 metric-layer-has-no-editor-import
(INV-Metrics-independent); (3) T0 open-is-viewer-safe (zero `WorkspaceEdit` on open) + AI-edit-
is-visible-and-voids-approval (INV-Viewer-safe, FR-11/12); (4) T0 attention-toggle-is-byte-
lossless (INV-Attention-view-only, FR-13); (5) T0 cross-ref-egress-safe (no internal ref in
exported output, INV-Cross-ref-egress-safe, FR-10); (6) T1 save/undo/validator through the
`CustomTextEditorProvider` (FR-4); (7) the inherited import-ban T0 (FR-8, incl. FR-12's
host-delegated AI channel).

## Consequences

**Positive:**
- Delivers the "default to webview for all operations" intent via the only real mechanism
  (`customEditors`, FR-2) without the rejected Ctrl-P/global-markdown hijack, and extends it
  to the whole approvable set (OQ3).
- Makes the editor the *review* surface the "just enough human" thesis needs: TOC (FR-9),
  cross-ref navigation (FR-10), attention-triage (FR-13), and light hand/AI editing (FR-11/12)
  — all over one reused renderer (FR-6) and one `TextDocument` seam (FR-4).
- Gives SPEC-017 FR-7a its richest engaged-reading-time source (FR-7) while staying enrich-only.

**Negative:**
- Adds a public-ish `viewType` + selector-glob-set contract (FR-2, Costly #1) and an AI-edit
  round-trip + gate contract (FR-12, Costly #2) that are expensive to change once trusted.
- Grows the editing-regression surface (FR-4, R2) and the feature surface overall (R7) — a
  review webview that can now edit, call the AI, navigate refs, and triage attention.
- Couples this render layer to SPEC-014's render function, **and FR-12 to SPEC-014's still-
  unresolved AI-edit channel** (Dependencies), so it cannot ship ahead of SPEC-014.
- Bumped **T3 → T4** by this amendment: the added surfaces (AI edit, section edit, TOC,
  cross-ref nav, attention model, init flow) exceed a T3 ceremony; full cycle now.

## Failure-Modes / Edge-Cases

- **Edit-depth infeasible at plan (FR-OQ1 resolves shallow).** If `CustomTextEditorProvider`
  cannot give acceptable in-webview editing, FR-4's fallback (viewer + always-adjacent text
  editor) engages — the doc must never be stranded un-editable; FR-11/12 degrade to "edit as text".
- **Large approvable performance (R5).** A very large doc makes FR-6's full-DOM mount degrade
  vs the line-virtualising native editor; the FR-5 text path is the size-triggered fallback,
  threshold set at plan.
- **Competing markdown extension on an approvable path (R1).** Linters lose grip on approvable
  files; mitigated because `priority:"option"` (FR-3) leaves default behaviour unchanged until opt-in.
- **User opts FR-3 default-on then wants out.** FR-5 escape (`reopenWithEditor`) still reaches
  raw text even when `useByDefault` is on (INV-Reversible).
- **AI edit rejected by the reviewer (FR-12).** The proposed `WorkspaceEdit` is undoable; a
  reject is a plain undo — no partial/silent state left behind (INV-Viewer-safe).
- **SPEC-014's AI-edit channel not yet built (FR-12).** Slice E cannot ship until SPEC-014
  resolves + builds its revision channel (Dependencies); Slices A–D + F ship without it — the
  editor reads, navigates, triages, and hand-edits with the chat icon simply absent.
- **Telemetry OFF.** Editor emits nothing (FR-7) and remains fully usable; reviewing must not
  silently depend on capture being on (INV-Metrics-independent).

## Test / Verification Strategy

| FR | Tier | Assertion sketch |
|---|---|---|
| FR-1 | T2 | Clicking a node in `spec-tree-provider.ts` opens the webview + a visible "Open as plain text"; the revert setting restores plain-text open. |
| FR-2 | T0 | Each contributed `customEditors` selector glob is path-scoped (matches a `specs/**`/`docs/decisions/**`/`docs/epics/**`/constitution path, rejects a top-level `README.md`); the set never equals `**/*.md`. |
| FR-3 | T2 | With `useByDefault` off a doc opens native; the webview appears in "Reopen Editor With…"; flipping makes it default while FR-5 holds; init offers the toggle. |
| FR-4 | T1 | Through the `CustomTextEditorProvider`, save / undo-redo / find / frontmatter-validator each operate on the backing `TextDocument` identically to the native editor. |
| FR-5 | T1 | `workbench.action.reopenWithEditor` from the webview yields raw text regardless of FR-3 state; no config disables it. |
| FR-6 | T0 | Only SPEC-014's pure render function is imported; no second markdown renderer/sanitiser symbol; CSP-nonce present. |
| FR-7 | T1 | With SPEC-017 FR-8 ON the editor emits scroll/focus/dwell; with it OFF zero capture calls fire and the editor still renders. |
| FR-8 | T0 | Import-ban: no `http`/`https`/`fetch`/`net` import reachable from `packages/minspec` via this editor — including FR-12's AI edit (host-delegated through SPEC-014's channel). |
| FR-9 | T2 | Outline lists headings **inside the MinSpec Explorer** (expandable under the open doc, not a second panel); click scrolls; next/prev-section + focus-outline have keyboard bindings. |
| FR-10 | T1/T0 | Ref tokens render as hotlinks opening the target approvable with "open to the side"; the shared `reference-checker` parser is used (no forked symbol); T0 asserts no internal ref reaches exported output (INV-Cross-ref-egress-safe). |
| FR-11 | T1/T0 | Open ⇒ zero `WorkspaceEdit` (T0); pen (mouse+keyboard) edits a section → `WorkspaceEdit` on the backing doc, undoable, voids approval. |
| FR-12 | T1/T0 | Chat edit **surfaces a preview (FR-15) before applying**; a **doc-wide/multi-range** proposal lands + undoes as **one atomic** `WorkspaceEdit`, never silent, voids approval; AI call via SPEC-014's channel (import-ban holds). |
| FR-13 | T0 | Toggling dim/attention produces zero document edits and byte-identical file content. |
| FR-14 | T2 | Init offers enable-useByDefault / reading-time-pointer; each declinable; none enables telemetry or writes without a click. |
| FR-15 | T0/T2 | A changed run shows a gutter change-bar + light tint (no dense underline); T0 asserts the highlight writes zero document bytes; the #544 per-commit timeline is not asserted here. |
| FR-16 | T2/T0 | Chat answers a non-edit question in-thread; request-edit routes to FR-12; fork-to-session and file-as-issue actions fire; an out-of-editor edit re-renders live (FR-4 watcher); import-ban holds (T0). |
| FR-17 | T2 | No own tab strip (native tabs); one combined bar; approval CTA label tracks state (Pre-approve/Approve/Re-approve); Re-approve highlights changed sections; no viewType / read-only / plain-text button in the bar. |

## Alternatives Considered

- **Hook Ctrl-P / Quick Open to reroute `.md` opens** — rejected: no interception API.
- **Global markdown custom editor (`**/*.md`)** — rejected: owning every README is the
  over-reach the "just enough human" thesis sells against (INV-No-global-hijack).
- **Read-only viewer** — rejected as the *default* path (strips editing, FR-4); it is the
  FR-OQ1 fallback with an always-adjacent text editor.
- **Ship `priority:"default"` immediately** — rejected: seizing approvables re-trains users
  (Costly #4); FR-3 ships `option` + opt-in setting + init offer instead.
- **AI edit applies silently** — rejected: a silent write to an approvable is the R6 trust
  hole; FR-12 lands a visible, undoable, approval-voiding edit.
- **AI edit is hard-limited to the hovered section** — rejected: the request may legitimately
  need a doc-wide or cross-section change (rename a term everywhere, reconcile a table with a new
  FR); FR-12 anchors *context* at the section but allows the proposal to span the document, applied
  atomically.
- **Route PR review into the IDE from within this spec** — rejected: the editor renders
  approvables, never PRs; PR-link routing (detection + in-IDE open + init install-offer + the
  optional CLAUDE.md/harness rewrite) is cross-cutting and lives in #541 (Triage rule 3).
- **Fork a second DR/SPEC-ref parser for hotlinks** — rejected: reuse `reference-checker.ts`'s
  `extractReferences` (FR-10, INV-One-renderer) to avoid drift and egress leaks (SPEC-021).

## Out of scope

- **The review/comment/approve loop** — that is SPEC-014 (this editor may host it, but the loop is defined there).
- **The trust metrics themselves** — SPEC-017.
- **Any non-approvable markdown** — README/notes/etc. explicitly untouched (INV-No-global-hijack).
- **Intercepting Quick Open / keybindings** — no such API; not attempted.
- **PR-into-IDE link routing** (detect the GitHub PR extension, open PRs in-IDE, init install-
  offer, CLAUDE.md/harness link rewrite) — split out to #541; not the editor surface.
- **Per-commit diff-colour timeline** (colour-per-iteration bar + scrollbar markers + selectable
  commit legend) — FR-15 ships only the quiet-diff floor; the timeline is #544 (parked).
- **The onboarding checklist page itself** — FR-14 *feeds* it; the page is #533 (parked).
- **`/minspec-` slash-command rename** (#534), **hiding palette commands** (#532), **porting
  the UI to other IDEs** (#531) — related follow-ups, not this spec.

## Open questions

*These are research questions; each has **no definition-of-done AC by design** — the DoD is
"the question is resolved at plan / in a DR", not a shippable acceptance test. The spike/plan-call
tasks live in tasks.md.*

- **FR-OQ1 — edit-depth (research spike at plan).** How deep is in-webview editing: section
  round-trip only (FR-11), full inline parity (find/replace, multi-cursor), or "edit as text"
  for heavy edits? The 2026-07-05 feedback confirms this needs research; direction is
  viewer-first + per-section edit, depth TBD. *(Open — plan spike; Costly #3. No DoD AC — the
  spike's output is the design/DR decision.)*
- **FR-OQ4 — attention-emphasis source.** Does FR-13's "most attention" come *only* from the
  existing Zone-A / #185 eye-icon / core-end-divider signals, or may the AI suggest emphasis?
  ***Resolved-deferred: v1 uses only the existing deterministic signals*** (no new heuristic, R8);
  AI-suggested emphasis is a post-v1 question. *(Closed for v1 — no DoD AC.)*
- *(FR-OQ5 — PR-link routing reach — moved to #541 with the PR-routing feature.)*
- **FR-OQ7 — conversation depth + fork/session mechanism (plan).** FR-16 makes the chat a
  two-way conversation (explain/discuss) that can fork to a full LLM session and file issues. How
  deep in v1: a lightweight inline Q&A that hands off to the host chat for anything long, or a
  first-class threaded panel? And the fork mechanism is the **same channel question as SPEC-014
  FR-OQ2** — a chat-participant naturally forks; a dispatch-command / prompt-file does not. Lean:
  inline Q&A + "open in host chat session" hand-off; keep the editor thin. Scrooge-adjacent (token
  cost of chat) — resolve when work resumes. *(Open — plan; no v1 DoD AC.)*
- **FR-OQ6 — batch AI-edit review for token economy (plan).** If proposed FR-12 AI edits are
  independently AI-reviewed before a human approves (the AI-review-all-approvables initiative,
  DR-047), reviewing each change alone burns tokens. Should MinSpec **batch** several proposed
  changes into a single review/pre-approve pass — extending the consequence-screen / pre-approve
  batching ([SPEC-023](../SPEC-023-consequence-screen/requirements.md))? Lean: yes — queue
  proposals and review as a batch, showing the combined diff (FR-15). Interacts with SPEC-014's
  channel choice (FR-OQ2) and is **scrooge-adjacent** (this whole feature is paused until Scrooge
  v1). *(Open — plan when work resumes; no v1 DoD AC.)*

## Follow-ups (tracked)

- **SPEC-014 render function must be extracted as a shared pure function** (FR-6) before this
  editor mounts it — sequencing note for SPEC-014 (same epic), not a new issue.
- **SPEC-014 must resolve + build its AI-edit / revision channel** (its FR-OQ2) before FR-12
  (Slice E) can ship — hard dependency, sequencing note for SPEC-014, not a new issue.
- **`minspec.approvableEditor.*` settings** (FR-1 revert, FR-3 useByDefault) — contributed
  config; lands at implement with the contribution, no separate issue.
- **PR-into-IDE link routing** (was FR-14/FR-OQ5 here) — [#541](https://github.com/AIClarityAU/minspec/issues/541).
- **Per-commit diff-colour timeline** (layer on FR-15) — [#544](https://github.com/AIClarityAU/minspec/issues/544).
- **Onboarding checklist page** (FR-14 target surface) — [#533](https://github.com/AIClarityAU/minspec/issues/533).
- **`/minspec-` slash-command prefix** — [#534](https://github.com/AIClarityAU/minspec/issues/534).
- **Hide low-level palette commands once this editor ships** — [#532](https://github.com/AIClarityAU/minspec/issues/532).
- **Port VS Code-only UI to other supported IDEs** — [#531](https://github.com/AIClarityAU/minspec/issues/531).
- **Read-this eye-icon attention signal reuse** (FR-13) — [#185](https://github.com/AIClarityAU/minspec/issues/185).
- **Marketplace listing note** — a custom editor for approvables is a listing capability/keyword;
  non-code, → `AIClarityAU/minspec` issue per DR-023 forward rule if the team wants it surfaced.
