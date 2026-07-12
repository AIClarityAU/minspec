---
id: SPEC-035
type: requirements
# 🔒 Once approved, hash-locked: approved bytes recorded in .minspec/approvals.json[SPEC-035].specHash. ANY edit voids approval (hash → stale) — re-run "MinSpec: Approve Spec". DR-012.
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity
aspects: [ux, traceability, render, tier-1, references]
depends_on: [DR-053]   # the paragraph-addressable reference scheme this feature renders
relates_to: [SPEC-014, SPEC-018, SPEC-029, DR-038, DR-032, SPEC-021]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Approvable-Reference Lozenges + Hover Cards (Requirements)

**Date:** 2026-07-12
**Status:** Specifying
**Triggered by:** session request (2026-07-12, founder) — *"in the pretty reviewing
webview, turn the links to approvables into inline lozenges with hover cards that show
the title, status and summary of each approvable … then tell the LLM that generates
approvables it doesn't have to mention the current status of any other approvables it
mentions, as this will be rendered live … do the same with references to paras/items in
project-wide docs like the constitution, and for invariants."*

> **Consumer of [DR-053](../../../docs/decisions/DR-053.md) v2.** DR-053 defines the
> paragraph-addressable reference grammar (`MIN/SP19/FR3`); this spec **renders** it.
> Build is **queued, not now** — this feature is Scrooge-adjacent and paused with the
> rest of the pretty-webview work (SPEC-018) pending the token economy; this doc
> captures the requirements so the decision and shape are recorded.

## One-Sentence Scope

In the MinSpec review/approvable webview, detect every reference to an approvable (or a
paragraph/row inside one, or a project-wide item like a constitution goal or invariant)
using the DR-053 grammar, render it as an inline **lozenge** with a **hover/focus card**
showing the target's **title · status · summary** read *live* from the authoritative
source — so the authoring LLM never has to restate another approvable's status in prose.

## Context

Approvables cite each other constantly (`SPEC-014`, `DR-053`, `FR-3`, `#500`). Today
those are inert text, and worse, the authoring LLM **hand-writes the cited artifact's
status into prose** ("SPEC-014, which is `specifying`…") — which **rots** the moment the
target's status changes, producing exactly the stale/false "implemented" signposts the
Evidence-Discipline rule (RCDD / DR-003) exists to prevent. A reference should be a
**live** object, not a frozen restatement.

Two enablers now exist or are proposed:
- **DR-053 v2** gives every referenceable item a machine-findable id — the precondition
  for regex-detecting refs and resolving them.
- The **pretty webview** (SPEC-018 custom editor / SPEC-014 review pane) is the render
  host; it already owns DOM rendering of approvables, so lozenges live there, not in the
  plain text editor.

Prior art to reconcile: the ADR index already embeds **auto-generated per-DR summaries**
as HTML-comment blocks (`<!-- dr-summary:DR-001 auto=… -->`). That is a summary source
this feature can reuse rather than reinvent (see FR4 / OQ1).

This is the **reference** half of a pair. The **term glossary** half — dotted-underline
hover cards for project vocabulary/jargon — is a sibling feature tracked separately at
[#672](https://github.com/AIClarityAU/minspec/issues/672) and is **out of scope here**.

## Functional Requirements

- **FR1 — detect references (Tier-0).** Over a rendered approvable's text, detect every
  DR-053-grammar reference — approvable (`MIN/SP19`, `DR53`, `#500`), paragraph
  (`SP19/FR3`, `FR3`), and project-wide item (a constitution goal `G3`, an `INV`) —
  using a regex anchored on the **closed code vocabulary** (project codes from the
  table; `SP|DR|EP|PR|IS`; the paragraph type codes), so it does not fire on file paths
  or URLs (DR-053 R1/OQ1). Detection + resolution reuse `@aiclarity/shared`
  `project-prefix` — pure, no `fs`/`vscode`/network/LLM.
- **FR2 — render as lozenge.** Each detected, resolved reference renders as an inline
  **lozenge/chip** in the webview, visually distinct from prose, carrying the canonical
  short form as its label.
- **FR3 — hover/focus card.** On hover **or keyboard focus**, the lozenge shows a card
  with the target's **title, current status, and summary**. Card open/close and
  lozenge next/prev/activate all have **keyboard paths** (RSI standing constraint — not
  mouse-only).
- **FR4 — `summary:` source.** The card's summary comes from a per-approvable one-line
  summary. Provide it via a `summary:` **frontmatter field** on approvables and/or by
  reusing the existing auto `dr-summary` block (OQ1 decides source + who authors it).
- **FR5 — live status, deterministically.** The card's **status** is read **live** from
  the authoritative source (approvals.json + frontmatter `status`/phase), never guessed,
  never a cached restatement. A cross-project target resolves via the table; if its repo
  is not locally available, the card **degrades** to code + title only (OQ2) — never a
  wrong status.
- **FR6 — authoring LLM stops restating status.** Because status renders live (FR5), the
  approvable-authoring guidance instructs the LLM that it **need not** (should not)
  write another approvable's *current status* into prose. Where this instruction lives
  (constitution / authoring prompt) is OQ4.
- **FR7 — navigate on activate.** Click/Enter on a lozenge navigates to the target
  approvable; for a paragraph ref, scrolls to that item's anchor **if** the target
  carries its id (depends on DR-053 migration — until then, resolves to the doc; OQ3).
- **FR8 — unknown/unresolvable → plain text, advisory.** An unknown project/approvable/
  paragraph code, or a ref whose target cannot be found, renders as **plain text**
  (never an error, never a dead lozenge); the Tier-1 layer may *advise* adding a table
  row (DR-053 §5). Graceful degrade is mandatory (INV-graceful-degrade).
- **FR9 — project-wide items + invariants.** The same lozenge/card treatment applies to
  references into project-wide docs (constitution goals `G`n, invariants `INV`n). Their
  addressing form is DR-053 OQ5; this spec consumes whatever DR-053 settles.

## Costly to Refactor

- **The detection regex + resolver contract** (FR1) — shared with the DR-053 module and
  the future trace graph. Changing the grammar it keys on ripples to both. Kept Tier-0
  and vocabulary-anchored so the *rule* is stable even as codes are added.
- **The `summary:` storage choice** (FR4/OQ1) — once approvables carry a `summary:`
  field (or once we commit to the `dr-summary` auto-block), reversing means touching
  every approvable's frontmatter. Decide the source once.
- **Cheap to reverse:** lozenge/card visual styling, hover-vs-focus trigger tuning,
  keyboard-binding choices — all same-day webview knobs.

## Acceptance Criteria

- **AC1** A rendered approvable containing `SPEC-014` / `DR-053` / `#500` / a paragraph
  ref shows each as a lozenge; a string like `src/foo/bar` or a URL does **not** become
  a lozenge.
- **AC2** Hovering **or** keyboard-focusing a lozenge opens a card with title, status,
  summary; every action is reachable without a mouse.
- **AC3** The card's status matches the target's authoritative status at render time
  (change the target's status → re-render → card reflects it); no status text is read
  from the citing prose.
- **AC4** An unknown code renders as plain text with no error and no broken lozenge.
- **AC5** Activating a lozenge navigates to the target (doc, or item anchor when present).
- **AC6** Detection + resolution modules import no `vscode`, no network, no LLM.

## Out of Scope

- The **term/glossary** hover cards for project vocabulary — [#672](https://github.com/AIClarityAU/minspec/issues/672).
- Building the **trace-graph visualization** itself (this spec produces the addressable,
  hoverable refs the graph would later consume; the graph is future work — cf. DR-038).
- The **corpus migration** to the DR-053 token grammar and the `project-prefix` **module
  update** — both are DR-053 follow-ups, not this spec.
- Assigning ids to **untyped prose** paragraphs (DR-053 OQ3).
- Any **network/LLM** in the detection or status path (never-wrong; INV-live-status).

## Open Questions

- **OQ1 — summary source + author.** New `summary:` frontmatter field, reuse the auto
  `dr-summary` HTML-comment block, or both? And is the summary human-written,
  LLM-generated-then-skimmed (just-enough-human), or auto-derived from the doc's first
  paragraph / one-sentence-scope? Affects FR4 + every approvable's frontmatter.
- **OQ2 — cross-project card data offline.** When a `MIN/…`-from-scrooge (or vice-versa)
  target repo is not checked out, where do title/status/summary come from? Degrade to
  code+title only? Optional sibling-repo read? No network (Tier-0).
- **OQ3 — paragraph anchor availability.** FR7 scroll-to-item needs the target item to
  carry its id anchor, which depends on the DR-053 migration. Interim: resolve paragraph
  refs to the doc. Confirm the interim behavior.
- **OQ4 — where the "don't restate status" instruction lives.** Constitution rule vs
  authoring-prompt guidance vs a validate advisory that flags hand-written status prose.
- **OQ5 — inherited from DR-053 OQ5** — the addressing form for project-wide items
  (constitution goals, invariants): `MIN/G3` vs a reserved `CON` pseudo-approvable.

## Invariants

- **INV-live-status-deterministic** — a lozenge/card status is read from the
  authoritative source (approvals.json / frontmatter), never LLM-guessed, never a stale
  restatement. (Never-wrong: a signpost that lies is the worst defect — DR-003 evidence
  discipline.)
- **INV-graceful-degrade** — an unknown or unresolvable reference renders as plain text;
  it never errors, never breaks the view, never becomes a dead lozenge.
- **INV-tier0-detection** — reference detection + resolution import nothing from
  `vscode`, the network, or an LLM; they are pure functions over text + the prefix table.
- **INV-keyboard** — lozenge focus/next/prev/activate and card open/close each have a
  keyboard path (RSI).

<!-- minspec:core-end -->

## Risks & Mitigations

| # | Risk | Likelihood · Impact | Mitigation |
|---|---|---|---|
| R1 | **Detector fires on paths/URLs** (the DR-053 `/` joiner, R1/OQ1). | High · Med | FR1 anchors on the closed code vocabulary, not on slashes; a ref must present a known project code and/or `SP\|DR\|EP\|PR\|IS`+digits and/or a known paragraph code. Tracks DR-053 OQ1's joiner decision. |
| R2 | **Stale summary** — `summary:` drifts from the doc it describes. | Med · Low | OQ1: prefer a derived/regenerated summary (or the auto `dr-summary` block that already hashes its source) over a hand-frozen field; a stale summary is advisory, not a status lie (status is FR5-live regardless). |
| R3 | **Cross-project target unavailable** → card can't show status. | Med · Med | FR5/OQ2: degrade to code+title, **never** a fabricated/blank-passed-as-current status; the lozenge still links. |
| R4 | **LLM stops writing status but the render isn't there** (plain-text / non-webview view, or FR6 lands before FR2-5). | Med · Med | Sequence FR6 *after* the render ships; in plain-markdown fallback the ref is still the human-readable code, just not a lozenge — no information lost, only the live chip. |

## Dependencies

- **DR-053 v2 (proposed)** — the reference grammar + `project-prefix` resolver this
  feature detects and resolves against. Blocked on DR-053 acceptance + its module update
  for the full paragraph grammar; the **approvable-level** subset (`SPEC-014`, `#500`)
  can render against the v1 resolver today.
- **SPEC-018 / SPEC-014** — the webview render host. Paused (token economy); this spec
  ships when that work resumes.
