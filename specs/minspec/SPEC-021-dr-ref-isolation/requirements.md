---
id: SPEC-021
type: requirements
status: implementing
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity
---

# MinSpec — Internal DR-Reference Isolation (Requirements)

**Date:** 2026-06-05
**Status:** Implementing (SDD Implement phase)
**Decision:** [DR-032](../../../docs/decisions/DR-032.md) (this spec is the contract that decision governs)
**Triggered by:** session request 2026-06-05 (Paul Harvey) — *"if a MinSpec user has a decision register in their project that also numbers DR-XXX then we should prevent any DR-XXX references from being published in templates or displayed on screen by our vsix to prevent confusion."*
**Epic:** [EPIC-002 Signpost Integrity](../../../docs/epics/EPIC-002-signpost-integrity.md)

---

## One-Sentence Scope

MinSpec must never emit a specific internal `DR-<number>` into any user-facing
surface (project files it writes, or on-screen text), and a gate must make such a
leak un-committable.

---

## Context

MinSpec dogfoods SDD, so its source is full of internal `DR-NNN` references. They
belong in code comments (never shipped). One escaped into emitted content:
[`spec.ts:310`](../../../packages/minspec/src/lib/spec.ts) writes
`"… re-run \"MinSpec: Approve Spec\". DR-012"` into the frontmatter of **every** spec
file MinSpec generates in a user's project, and the spec panel renders it on screen.
If the user's own register has a `DR-012`, that is a false cross-reference; even
without a collision it is an unresolvable internal token. See
[DR-032](../../../docs/decisions/DR-032.md) for the full audit and rationale
(unconditional strip + symmetric egress gate, not collision-conditional suppression).

This is the egress member of the recurring **validator-asymmetry** class
([DR-003](../../../docs/decisions/DR-003.md) Phase 4): MinSpec gates the *user's*
content but has never gated its *own emitted output*.

---

## Invariants

**INV-1 (T0).** No user-facing surface MinSpec produces contains a
`(DR|SPEC|EPIC)-<digits>` literal. The placeholder tokens `DR-NNN` / `SPEC-NNN` /
`EPIC-NNN` are the only permitted forms. "User-facing surface" = harness/scaffold
templates written into the project, generated spec / ADR / INDEX content, webview HTML,
walkthrough docs, and user-visible notification strings. MinSpec's own source comments
and its own repo `docs/`, `specs/`, README, CHANGELOG, and notices are **not**
user-facing (OQ-2: exempt — public repo, docs are lookupable).

---

## Functional Requirements

### FR-1: Strip the spec-footer leak

The generated spec approval footer MUST drop the trailing `DR-012`, keeping the
behaviour text verbatim:

- **Before:** `# Editing voids approval (hash in .minspec/approvals.json → stale); re-run "MinSpec: Approve Spec". DR-012`
- **After:** `# Editing voids approval (hash in .minspec/approvals.json → stale); re-run "MinSpec: Approve Spec".`

Code comments that reference DR-012 to explain *why* the footer exists
([`spec.ts`](../../../packages/minspec/src/lib/spec.ts) internal comments) are internal
and MUST remain. *(FR-1 already landed — the footer line was removed; see the `spec.ts`
comment "the DR-012 … reminder line was removed here". Retained as the contract of
record; the live leak is now FR-1b.)*

### FR-1b: Strip the scaffold `tasks.md` leak (second live egress leak, #669)

A second emitted leak of the same class is **live**: the split-layout `tasks.md`
scaffolder writes an internal ref into **the user's project file**. The scaffolded body
carries the literal comment
`Ticking a checkbox here is body-only — it never voids spec approval (DR-035).`
([`scaffold.ts` `buildTasksMdContent`](../../../packages/minspec/src/lib/scaffold.ts),
added by #225 after this spec) — a `DR-035` literal in a surface INV-1 governs.

The scaffolded comment MUST drop the internal ref, keeping the behaviour text verbatim:

- **Before:** `… it never voids spec approval (DR-035).`
- **After:** `… it never voids spec approval.`

Per the DR-003 data-only-fix corollary this string strip is only the **data-fix half**;
the durable fix is FR-2 registering the scaffolder as an emit surface (below), so the
class is un-committable. Stripping the string without registering the surface leaves the
gate blind to the next scaffold-emitted ref. Both are required.

### FR-2: Output-provenance gate (render test — the INV-1 enforcement)

A T0 test MUST render every emit surface and assert none contains
`/\b(DR|SPEC|EPIC)-\d+\b/`, with the literal placeholders `DR-NNN` / `SPEC-NNN` /
`EPIC-NNN` explicitly allowed. The surface set MUST include, at minimum:

- every entry of `TEMPLATES` (rendered with representative substitution data),
- `generateSpecContent(...)` output,
- `generateAdrContent(...)` output,
- the split-layout `tasks.md` scaffolder — `buildTasksMdContent(...)` /
  `scaffoldTasksMd(...)` output (the emit path added by #225 that writes `tasks.md`
  into the user's project; it is the FR-1b live-leak surface, and was absent from this
  list because it postdated the spec — registered here per the "any new emit path MUST
  register" rule below),
- the Decision-Register INDEX / summary generators' output,
- webview HTML producers (e.g. `spec-panel-html`).

The test MUST document its surface list and state that any new emit path is required to
register its output here. Test tier: **T0** (invariant), highest priority — written
before the FR-3 scanner.

### FR-3: Static scan for surfaces the render test cannot exercise

A check (test or `npm run` script) MUST scan emit-surface files the render test cannot
easily render — walkthrough markdown (`media/walkthrough/*.md`) and webview HTML string
sources — for `(DR|SPEC|EPIC)-<digits>` literals. It MUST:

- allow `DR-NNN` / `SPEC-NNN` / `EPIC-NNN`,
- support an inline `dr-ok` suppression marker for a justified exception,
- exempt MinSpec's own marketing/legal/docs surfaces by explicit allowlist
  (README, CHANGELOG, THIRD-PARTY-NOTICES, `docs/**`, `specs/**`). **Confirmed exempt**
  (OQ-2): MinSpec is a public repo, so its own copy may cite real MinSpec refs and link
  to GitHub.

### FR-4: No regression of existing artifacts

Running the gate against the current tree MUST surface every currently-live leak and, once
FR-1 + FR-1b land, pass clean. As of #669 the FR-1 spec-footer leak is already stripped in
`spec.ts`; the single remaining live leak is the FR-1b scaffold `tasks.md` `DR-035`
literal. The gate (FR-2, once the scaffolder surface is registered) MUST flag that literal
*before* the FR-1b strip and pass *after*. The pre-existing dogfooded
[`specs/minspec/requirements.md`](../requirements.md) frontmatter footer is regenerated
output, not hand-authored content — corrected by FR-1's generator change on next write, and
MAY be edited in place to clear the gate.

---

## Acceptance Criteria

*Definition-of-done — each box traces a concrete FR/INV. Checked = built + its T0/T1
test green (see Test / Verification below).*

- [ ] **Footer carries no internal ref** — output of `generateSpecContent(...)` contains
      the approval-behaviour footer with **no** trailing `DR-012` and no
      `(DR|SPEC|EPIC)-\d+` literal anywhere; the explanatory code comments at
      the `spec.ts` explanatory code comments remain. *(FR-1, INV-1)*
- [ ] **Scaffold `tasks.md` carries no internal ref** — output of `buildTasksMdContent(...)`
      / `scaffoldTasksMd(...)` contains the checkbox-scope comment with **no** trailing
      `(DR-035)` and no `(DR|SPEC|EPIC)-\d+` literal; the behaviour text is unchanged.
      *(FR-1b, INV-1)*
- [ ] **Render gate green on all emit surfaces** — a T0 test renders every `TEMPLATES`
      entry, `generateSpecContent`, `generateAdrContent`, **the `tasks.md` scaffolder
      (`buildTasksMdContent`)**, the INDEX/summary generators, and the webview-HTML
      producers, and asserts none matches `/\b(DR|SPEC|EPIC)-\d+\b/`; the placeholders
      `DR-NNN` / `SPEC-NNN` / `EPIC-NNN` pass. *(FR-2, INV-1)*
- [ ] **Gate bites (negative proof)** — injecting a `DR-012` literal into any registered
      emit surface makes the FR-2 test fail; removing it makes it pass — proving the gate
      is not vacuous. *(FR-2)*
- [ ] **Surface list documented + extension-required** — the FR-2 test enumerates its
      emit-surface set and states that any new emit path MUST register its output here.
      *(FR-2)*
- [ ] **Static scan covers unrenderable surfaces** — the FR-3 scan flags a
      `(DR|SPEC|EPIC)-<digits>` literal in `media/walkthrough/*.md` or webview-HTML
      sources; placeholders pass; an inline `dr-ok` suppresses **only** the finding on its
      own line; README, CHANGELOG, THIRD-PARTY-NOTICES, `docs/**`, `specs/**` are exempt.
      *(FR-3)*
- [ ] **Whole-tree clean after FR-1** — running both gates over the repo surfaces exactly
      the FR-1 footer leak *before* the fix and passes clean *after*, including the
      regenerated [`specs/minspec/requirements.md`](../requirements.md) footer. *(FR-4, INV-1)*
- [ ] **No blanket disable** — suppression is per-line `dr-ok` only; there is no global
      off-switch that would silently re-open the egress gap. *(FR-3, INV-1)*

---

## Out of Scope

- **Collision-conditional suppression** — rejected in DR-032 Decision 4 (unconditional
  strip instead).
- **Runtime scanning / rewriting of the user's register** — not built.
- **Website / marketing content** (minspec.dev, `sites/**`) — **not a vsix emit
  surface**; it ships nowhere near a user's project. MinSpec's own site may freely cite
  its real `DR-`/`SPEC-`/`EPIC-` numbers (same rationale as the README/CHANGELOG
  exemption, OQ-2: public repo, refs are lookupable). The gate (INV-1) governs only what
  the **extension emits into a user's project or renders on screen** — never MinSpec's
  self-describing public copy.

---

## Open Questions (resolved at approval 2026-06-05)

- **OQ-1 → GENERALISE.** Gate regex is `(DR|SPEC|EPIC)-\d+` now (folded into INV-1,
  FR-2, FR-3). No follow-up deferral.
- **OQ-2 → KEEP EXEMPT.** README/CHANGELOG/THIRD-PARTY/`docs/**`/`specs/**` stay on the
  FR-3 allowlist — public repo, refs are lookupable.
- **OQ-3 → T3 confirmed.**

---

## Traceability

- **Decision:** [DR-032](../../../docs/decisions/DR-032.md)
- **Epic:** [EPIC-002 Signpost Integrity](../../../docs/epics/EPIC-002-signpost-integrity.md)
- **Sibling asymmetry-gate lineage:** [DR-003](../../../docs/decisions/DR-003.md)
  Phase 4; SPEC-004 / `#115` / `#126`.
- **Second live leak (FR-1b):** `#669` (doc-honesty actioning tracker); scaffolder
  origin `#225`.
- **Next phases (T3):** plan → tasks → implement, on approval.
