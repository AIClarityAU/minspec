---
id: SPEC-014
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity
aspects: [ux]
depends_on: [SPEC-012]
relates_to: [SPEC-010, SPEC-006]
---

# MinSpec — Prettified Spec-Review Webview (Requirements)

**Date:** 2026-06-01
**Status:** Specifying (SDD Specify phase)
**Triggered by:** session request — "expand the planned webview that approximates
ExitPlanMode (pretty not MD, with a text-select → comment → LLM revision → highlight
changes process); a scroll-bottom Approve button that, instead of closing, shows the
next spec/dr/issue/doc that needs approving."
**Materialises:** [#36](https://github.com/harvest316/minspec/issues/36) (parked from
[DR-012](../../../docs/decisions/DR-012.md) — prettified review webview).
**Epic:** [EPIC-002 Signpost Integrity](../../../docs/epics/EPIC-002-signpost-integrity.md)
**Consumes:** [SPEC-012 Next-Task Resolver](../next-task-resolver/requirements.md)
(ordering authority — this webview is a *surface* over the resolver, never its own queue).
**Composes:** [DR-012](../../../docs/decisions/DR-012.md) approval gate +
[`approval.ts`](../../../packages/minspec/src/lib/approval.ts),
[`spec-validator.ts`](../../../packages/minspec/src/lib/spec-validator.ts).

---

## Context

The current spec surface ([`spec-panel-html.ts`](../../../packages/minspec/src/views/spec-panel-html.ts))
is a lightweight phase stepper + task checklist + classification table. It is **not**
a review surface: it does not render spec prose, cannot select text, has no comment or
revision loop, and its only write action is toggling task checkboxes.

DR-012 parked a richer surface (issue #36): an ExitPlanMode-style **prettified review
webview** — rendered (not raw) markdown, selectable text, inline comment pins, "have
Claude edit the plan from those comments", and an approve action that runs the DR-012
validator gate. DR-012's research finding stands: `ExitPlanMode`'s native approval panel
is **model-only** — an extension cannot invoke it — so this MUST be a custom
`WebviewPanel`.

This spec expands that parked plan along two axes the session added:

1. **Revision loop with change-highlighting.** Not just "write a comment back to the
   spec" — a closed loop: select text → attach a comment/instruction → an LLM revises
   that span → the change is **highlighted as a diff** the human accepts or rejects
   per-hunk → only then approve.
2. **Chained approval (review-session walk).** The scroll-bottom **Approve** button does
   **not** close the panel. It records the approval and **advances to the next artifact
   that needs a human decision**, fed by the SPEC-012 next-task signpost — so a reviewer
   clears the whole pending queue in one continuous surface instead of re-opening the
   panel per artifact.

### Tier-0 reframe — revision is *delegation*, not in-extension AI

The "LLM revision" step looks like it collides with invariant #2 (Tier-0 core:
zero `http`/`https`/`fetch` in `packages/minspec`, DR-004). It does not. The webview
does exactly what a developer already does by hand in their Claude Code chat — *"fix the
paragraph about X"* — only with the selection and instruction pre-assembled. MinSpec
**triggers the host agent the dev is already running**; it does not itself open a socket.

This is the same boundary the extension already lives on for `gh` (DR-004 **Tier 1 — local
tool delegation**): the extension hands an instruction to a locally-installed tool that
owns its own auth and networking, and imports no networking module itself. **Triggering an
agent ≠ calling a model.** The webview ships in core (Tier 0); only the revision *handoff*
crosses into Tier 1, and it degrades gracefully when no agent is present (the comment
persists as a standing review note — FR-6). Change-highlighting (FR-7) is a purely local
file diff and needs no network at all.

> No standalone DR: this spec records the boundary decision inline (session choice —
> "spec only"). The reasoning leans on the existing DR-004 Tier-1 delegation precedent;
> it does not create a new network posture.

## Surfaces & interaction modes

The webview is **additive** — it does not replace the existing stepper panel (#36 out of
scope is preserved). It is a second, richer panel opened for *review*.

The chain walks whatever SPEC-012 emits as the next human task. Resolver node kinds split
into two interaction modes:

| Resolver node kind (SPEC-012) | Mode | Affordances in webview |
|---|---|---|
| `spec-approve` | **content-review** | render + select + comment + revise + diff + **Approve** (re-hash, DR-012 gate) |
| `adr-accept` (ADR is a doc) | **content-review** | render + select + comment + revise + diff + **Accept / Reject** |
| `epic-promote` | **decision-only** | summary card + **Promote** control (status flip); no revise loop needed |
| `issue-triage` *(new — see §Dependencies)* | **decision-only** | issue summary + triage control (inbox → P1/P2/P3); Tier-1 `gh` |
| `phase-action` (author a phase) | **not approvable** | NOT an approval — show "next is authoring work: <imperative>" + Open / Dispatch; never a fake Approve |

The primary button is always present; the **comment → revise → diff** loop appears only
for content-bearing artifacts (specs, ADRs).

## Requirements

### Rendering (pretty, not raw MD)

- **FR-1 (rendered markdown, sanitised, Tier-0).** The active artifact MUST render as
  formatted HTML (headings, tables, code blocks, links) — not raw markdown text. The
  renderer + sanitiser MUST run locally with no network fetch (no remote images/scripts/
  fonts) and MUST reuse the existing CSP-nonce pattern
  ([`spec-panel-html.ts:131-138`](../../../packages/minspec/src/views/spec-panel-html.ts#L131-L138)):
  `default-src 'none'`, inline style allowed, scripts only via per-render nonce. Untrusted
  spec content MUST be sanitised before injection (no raw HTML passthrough).
- **FR-2 (frontmatter + gate state header).** The panel MUST show the artifact's id,
  title, tier, status, approval status (`approved`/`stale`/`unapproved` from `approval.ts`),
  and any blocking validator violations (DR-012) at the top, so the reviewer sees *why*
  this artifact is in the queue before reading it (mirrors SPEC-012 FR-7 show-the-evidence).

### Selection → comment pins

- **FR-3 (text-select → comment pin).** Selecting rendered text MUST offer "Add comment".
  A pin stores `{ anchor, selectedText, comment, createdAt }` in a sidecar
  `.minspec/review/<artifactId>.json` (anchor = stable locator; exact scheme is a
  plan-phase decision, FR-OQ). Pins render in a gutter/margin against their span.
- **FR-4 (pins are non-destructive to the artifact).** Pins live in the sidecar, NOT in
  the spec body. They MUST NOT change the spec's content hash (so adding a comment does
  not by itself invalidate an existing approval — only an actual edit does, per DR-012).
- **FR-5 (pin lifecycle).** A pin is `open` → (revision applied) → `resolved` /
  `dismissed`. Resolved pins are retained for audit but visually de-emphasised.

### LLM revision (delegated to host agent — Tier-0 preserved)

- **FR-6 (revise = delegate, never in-extension network).** "Revise with AI" on a pin
  MUST assemble `{ selectedText, comment, surrounding context, target file }` into an
  edit instruction and **hand it to the host agent** (Claude Code / `agent-execute`
  broker / a prompt the running session picks up — mechanism is plan-phase, FR-OQ). The
  webview code in `packages/minspec` MUST import no `http`/`https`/`fetch`/`net` (invariant
  #2). If no agent is reachable, the action MUST degrade: the pin persists as a standing
  review note and the UI states "no agent available — comment saved" (never an error).
- **FR-6a (the dev stays in control of the model).** MinSpec MUST NOT choose, configure,
  or pay for a model. It only constructs the instruction; the host agent (the dev's own
  Claude Code session / their `agent-execute` config) decides how the edit is performed.
  This is what keeps "LLM revision" inside the Tier-1 delegation precedent, not a new
  network surface.

### Highlight changes (local diff, per-hunk)

- **FR-7 (change-highlighting after revision).** When a revision lands (the agent edits
  the file on disk), the webview MUST show the change as a **diff against the pre-revision
  snapshot** — added/removed spans highlighted inline or side-by-side. This is a local
  computation (snapshot vs current bytes / git); no network.
- **FR-8 (per-hunk accept / reject).** The reviewer MUST be able to **accept** (keep) or
  **reject** (revert to snapshot) each revised hunk independently, before approving.
  Reject restores the original span; the artifact file reflects only accepted hunks.
- **FR-9 (revision invalidates prior approval — by design).** Because approval is
  content-hash bound (DR-012), any accepted revision changes the hash and any prior
  approval goes `stale`. The diff → accept → approve sequence is the re-review the gate
  intends; the webview MUST make the re-hash explicit at the Approve step.

### Approve + chain to next (the signpost walk)

- **FR-10 (Approve runs the DR-012 gate, never bypasses it).** The scroll-bottom primary
  action MUST run `validateSpec` first and **refuse** on errors (reusing the exact
  `approveSpecCommand` logic — [`approve.ts:70-100`](../../../packages/minspec/src/commands/approve.ts#L70-L100)),
  surfacing blocking violations. On success it records the approval (re-hash) /
  acceptance / promotion appropriate to the node kind. The webview MUST NOT be a softer
  path to approval than the existing command.
- **FR-11 (Approve advances, does not close).** After a successful decision the panel MUST
  **not** close. It MUST request the next human task from the SPEC-012 resolver and load
  that artifact into the same panel. The panel closes only when the resolver reports the
  queue empty — then it shows a terminal "All clear — no pending approvals" state.
- **FR-12 (ordering is SPEC-012's, never re-derived).** The "next" artifact MUST come from
  the SPEC-012 next-task resolver (one engine, every surface — SPEC-012 FR-11). This
  webview MUST NOT implement its own priority/ordering. Whatever the signpost points to is
  what loads next, including gh issues once SPEC-012 models them (§Dependencies).
- **FR-13 (phase-action nodes are not approvable).** If the resolver's next task is a
  `phase-action` (author a phase — not a gate), the webview MUST NOT present an Approve
  button for it. It MUST show the imperative ("Plan FR-4 of SPEC-006") with Open / Dispatch
  affordances and let the reviewer skip to the next *decision-class* node. Approving
  authoring work would be a category error (and a two-queue leak risk — SPEC-012 INV).
- **FR-14 (skip / defer within the walk).** The reviewer MUST be able to skip the current
  artifact without deciding it (advance to next, current stays pending) and to stop the
  walk. Skipping MUST NOT mutate any artifact. (Composes SPEC-012 INV #5 override —
  dismiss does not change the canonical ranking.)
- **FR-15 (progress affordance).** The walk MUST show position ("3 of 7 pending") and let
  the reviewer expand the full pending pipeline on demand (SPEC-012 FR-6 — pipeline is
  optional expansion, collapsed by default).

### Packaging & boundary

- **FR-16 (HTML generation is a pure, testable function).** Following the existing split
  (`spec-panel.ts` = vscode glue, `spec-panel-html.ts` = pure HTML), all render/diff/markup
  generation MUST be pure functions (no `vscode`, no network) so they are unit-testable;
  the `vscode`-aware shell only wires messages and file I/O.
- **FR-17 (Tier-0 invariant — enforced).** No file in `packages/minspec` reachable from
  this feature may import `http`/`https`/`fetch`/`net`. A T0 test MUST assert this for the
  new module(s), matching the DR-004 code-review boundary.

## Mockup (ux aspect — DR-012 §2)

```
┌─ MinSpec · Review ──────────────────────────────────────── 3 / 7 pending ─┐
│ SPEC-006  Stub-Completeness Gate            [T3] [stale ⚠]  [▸ pipeline]   │
│ ⚠ approval stale — edited since last approve · validator: 0 errors        │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                   ┌───────┐ │
│  ## Context                                                       │ 💬 pin │ │
│  The gate enforces spec completeness but does not look at ────────┤ "tie  │ │
│  implementation code, so a task can be marked done while ─────────┤  this │ │
│  the code behind it is a stub.                                    │  to   │ │
│                                                                   │  FR-3"│ │
│  ## Decision                          ┌── revised (diff) ──────┐  └───────┘ │
│  Add a code-completeness gate that  → │ - scans the whole tree │  ✓ accept  │
│  scans spec-traced files only for     │ + scans only files     │  ✗ reject  │
│  stub markers.                        │ +  mapped via          │            │
│                                       │ + traceability.json    │            │
│                                       └────────────────────────┘            │
│  ```ts                                                                       │
│  interface StubFinding { file: string; marker: string; line: number }       │
│  ```                                                                         │
│                                                                              │
│   [ select text → 💬 Add comment ]      [ ✨ Revise with AI (delegated) ]    │
│ ─────────────────────────────────────────────────────────────────────────  │
│                                              scroll ⌄                        │
│ ┌─────────────────────────────────────────────────────────────────────────┐│
│ │  ✓ Approve SPEC-006  →  next: Accept DR-018           [ Skip ]  [ Stop ] ││
│ └─────────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘

decision-only node (epic-promote / issue-triage) collapses to a summary card:

┌─ MinSpec · Review ──────────────────────────────────────── 5 / 7 pending ─┐
│ EPIC-004  Classifier Validation              [proposed]                    │
│ 2 member specs are waiting on this epic being promoted to active.          │
│                              [ ✓ Promote → active ]   [ Skip ]   [ Stop ]  │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Invariants (must hold)

- **INV — Tier-0 core (T0).** The review webview adds no networking import to
  `packages/minspec`. LLM revision is delegation to the host agent only (FR-6, FR-17).
- **INV — Gate parity (T0).** Approving from the webview is never weaker than
  `minspec.approveSpec`: same validator, same refusal on errors, same content-hash
  re-bind (FR-10). The webview is a nicer door to the *same* gate, not a bypass.
- **INV — Single ordering authority (T0).** "Next to approve" is always the SPEC-012
  resolver's output. The webview never computes its own order (FR-12). Surfaces cannot
  disagree (SPEC-012 FR-11).
- **INV — Two queues (T0, inherited).** Only human-decision nodes are walked. Agent/LLM
  dispatch work is never presented as an approvable step; `phase-action` authoring work is
  shown but not "approved" (FR-13, SPEC-012 INV).
- **INV — Non-destructive review (T0).** Comments (FR-4) and skips (FR-14) never mutate the
  artifact or its hash; only an accepted revision (FR-8) and an explicit Approve (FR-10) do.

## Coverage Map (session asks → FR)

| Concern (from session) | FR |
|---|---|
| Pretty, not raw MD | FR-1 |
| Approximates ExitPlanMode (custom webview, native not invocable) | FR-1, DR-012 finding |
| Text select → comment | FR-3, FR-4 |
| → LLM revision | FR-6, FR-6a |
| → highlight changes | FR-7, FR-8 |
| Scroll-bottom Approve that does NOT close | FR-11 |
| Approve shows the next spec/dr/issue/doc | FR-11, FR-12 |
| "whatever the next-human-task signpost points to" | FR-12 (consume SPEC-012) |
| "probably includes gh issues too" | FR-12 + §Dependencies (SPEC-012 issue node) |
| "rules getting in the way" (Tier-0 vs AI) | §Tier-0 reframe, FR-6, FR-17 |
| Doesn't replace existing stepper | Surfaces §, additive |

## Risks & Mitigations

| # | Risk | Likelihood · Impact | Mitigation |
|---|---|---|---|
| R1 | **Tier-0 erosion.** "Just one fetch" creeps into the webview to call a model directly, breaking the air-gapped selling point (invariant #2). | Med · High | FR-6/FR-17 + a T0 import-ban test; revision is delegation only. Reviewed at the DR-004 code-review boundary. |
| R2 | **Gate bypass via the pretty door.** The webview becomes an easier path that skips the validator the command enforces. | Med · High | FR-10 reuses `approveSpecCommand`'s validate-then-refuse logic verbatim; INV — Gate parity + test. |
| R3 | **Ordering drift.** Webview computes its own "next" and disagrees with the status-bar/CI signpost, destroying trust. | Low · High | FR-12 forbids local ordering; consumes SPEC-012's single engine (its FR-11). |
| R4 | **Lost edits / bad revert.** Per-hunk reject mis-reverts or the agent's edit clobbers concurrent manual edits. | Med · High | FR-7 snapshot before revision; FR-8 reject restores from snapshot; dirty-editor-safe handoff (mechanism resolved at plan, mirrors SPEC-012 FR-15 dirty-safe rung). |
| R5 | **Stale anchors.** A comment pin's anchor drifts after edits and points at the wrong span. | Med · Med | FR-3 stable-anchor scheme is an explicit plan-phase decision (FR-OQ); resolved pins de-emphasised (FR-5) limit blast radius. |
| R6 | **Approve-chain fatigue → rubber-stamping.** A continuous walk encourages reflexive approval without reading (the DR-020 R1 risk, amplified by flow). | Med · Med | FR-2 surfaces violations + stale state up-front; FR-14 skip is frictionless so "not sure" need not become a click-through approve; validator still refuses incomplete specs (FR-10). |
| R7 | **Phase-action category error.** Authoring work shown with an Approve button → two-queue leak. | Low · Med | FR-13 explicitly de-approves phase-action nodes; INV — Two queues + test. |

## Dependencies

- **`depends_on: SPEC-012`** — this webview is a surface over the next-task resolver; it
  cannot chain without it. The resolver today models `spec-approve`, `adr-accept`,
  `epic-promote`, `phase-action` — it does **not** yet model **gh issues**. The session
  asked the chain to "probably include gh issues too", so SPEC-012 needs an
  **`issue-triage` node kind** (Tier-1, `gh`). That is a SPEC-012 extension, tracked as a
  follow-up below — this spec consumes whatever node kinds the resolver emits and does not
  add ordering of its own.

## Out of scope

- **Replacing the existing stepper panel** (`spec-panel*.ts`) — this is additive (#36 out
  of scope, preserved).
- **The ordering engine** — owned by SPEC-012 (consumed, not redefined).
- **Choosing/configuring/paying for a model** — the host agent owns that (FR-6a).
- **Defining `issue-triage` / arbitrary-doc approval node kinds** — a SPEC-012 concern
  (follow-up). This spec only requires that the chain renders whatever the resolver emits.
- **The blocking enforcement itself** — DR-012's PreToolUse gate is unchanged; this is a
  review *surface*, not a new enforcement primitive.

## Open questions

- **FR-OQ1 — anchor scheme for comment pins.** Char-offset, heading-path + quote, or fuzzy
  context match? Must survive minor edits (R5). *(Open — plan phase.)*
- **FR-OQ2 — revision handoff mechanism.** Which Tier-1 path: VS Code chat-participant API,
  a `minspec.dispatchRevision` command into `agent-execute`, a prompt file the running
  session watches, or `claude -p` via the DR-017 broker? Must be dirty-editor-safe (R4).
  *(Open — plan phase.)*
- **FR-OQ3 — diff application model.** Does the agent edit the file directly (webview diffs
  snapshot vs disk) or propose a patch the human applies on accept? Affects FR-8 revert.
  *(Open — plan phase.)*

## Follow-ups (tracked)

- **SPEC-012 `issue-triage` node kind** — so the approve-chain can include gh issues
  (session ask). Cross-spec follow-up, not covered by this spec's own FRs → SPEC-012
  amendment, tracked at
  [#92](https://github.com/harvest316/minspec/issues/92).
