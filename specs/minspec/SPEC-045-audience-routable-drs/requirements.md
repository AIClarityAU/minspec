---
id: SPEC-045
title: Audience-routable DRs — plain-language summaries + dual acceptance
type: requirements
status: specifying
tier: T3
product: minspec
created: 2026-07-21
epic: EPIC-009  # Team Readiness
depends_on: [DR-066, DR-029]
relates_to: [SPEC-044, SPEC-022]
phases:
  specify: done
  clarify: done
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-045: Audience-routable DRs — plain-language summaries + dual acceptance

## Summary

Decision records are where big choices get made, and some of them affect the product, not
just the code. This makes each decision record open with a short plain-language "what we
decided and why it matters," keeps the technical reasoning underneath, and — for the few
decisions that affect the product — asks a business owner to sign off too, not only an
architect.

## Context

DR-066 treats DRs as another audience-routable approvable. A DR's default audience is
architect/engineering, and its body is *meant* to be technically precise — forcing the body
jargon-free would gut it. But many DRs are unreadable to a PO/BA who has a legitimate stake
in the product-affecting ones. This spec adds a plain-language lead + a business-relevant
flag + dual sign-off, without backfilling the 66-DR corpus. (Filed as the separable
DR-specific follow-up flagged during the DR-066 discussion, distinct from spec approval
because DRs approve via acceptance, DR-029.)

## Requirements

- **FR-1 (audience + flag).** A DR carries an audience like other approvables; default =
  architect/engineering. A frontmatter `business-relevant: true` marks the minority that
  affect the product (pricing, consent/telemetry, offline-first, accessibility, etc.). It is
  **author-declared**; a deterministic keyword heuristic *advises* and warns when a likely-
  business DR is unflagged — advisory, never a gate (RD-1).
- **FR-2 (plain-language lead).** Every DR gains a plain-language lead summary — Context +
  Decision + product impact — up top; the technical Rationale/Risks/Costly-to-Refactor
  bodies stay dense and are **not** jargon-gated. The `INDEX.md` auto-summary is regenerated
  from / aligned to this lead.
- **FR-3 (dual acceptance).** A `business-relevant` DR routes for dual sign-off: architect
  *acceptance* (DR-029 / `MinSpec: Accept ADR`) **and** product/business approval of the
  product-impact summary. The business half **reuses the SPEC-022 `ApprovalRecord`** (the DR
  file is the approvable, its lead summary the reviewed unit) — not a new signature type —
  so it inherits hash-binding, honest attribution, and the SPEC-041 GitHub ingress; both
  sign-offs are required for `accepted` (RD-2). Non-business DRs keep single architect
  acceptance.
- **FR-4 (jargon advisory on the lead only).** SPEC-044's jargon advisory applies to the DR
  **lead summary**, never the body.
- **FR-5 (warn-first, no backfill).** New/edited DRs adopt the lead-summary convention going
  forward; the existing 66-DR corpus is not retro-fitted.

## Acceptance Criteria

- [ ] **AC-1 (FR-1).** A DR with `business-relevant: true` is routed to the business role in
      addition to architect.
- [ ] **AC-2 (FR-3).** A business-relevant DR cannot reach `accepted` without both sign-offs.
- [ ] **AC-3 (FR-2).** A DR missing its plain-language lead warns.
- [ ] **AC-4 (FR-4).** Jargon in a DR body does not warn; jargon in its lead summary does.

## Resolved Decisions (Clarify)

- **RD-1 (who declares) — author self-declares, heuristic advises.** The author sets
  `business-relevant`; a deterministic keyword heuristic suggests it and warns on a likely-
  miss — advisory, never a hard gate (mirrors the classifier / jargon-advisory philosophy).
- **RD-2 (dual-acceptance mechanism) — reuse SPEC-022.** The business half is a SPEC-022
  `ApprovalRecord` on the DR, atop DR-029 architect acceptance; reuse over invention, and it
  unifies DRs into the same approval substrate (hash-bound, attributed, GitHub-ingressible).

## Out of scope

- Backfilling existing DRs; forcing DR bodies jargon-free.

## Traceability

DR-066 (DR-audience note); DR-029 (ADR acceptance); SPEC-044 (jargon lead); SPEC-022
(approval record); EPIC-009.
