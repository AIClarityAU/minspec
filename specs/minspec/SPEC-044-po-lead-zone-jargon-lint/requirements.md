---
id: SPEC-044
title: PO-facing lead zone (position gate) + jargon advisory lint
type: requirements
status: specifying
tier: T3
product: minspec
created: 2026-07-21
epic: EPIC-009  # Team Readiness
depends_on: [DR-066, SPEC-013]
relates_to: [SPEC-043, SPEC-006, SPEC-045]
phases:
  specify: in-progress
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-044: PO-facing lead zone (position gate) + jargon advisory lint

## Summary

Make sure a product owner can always start reading at the top and understand what a spec is
about, in plain words. We do two different things: *require* that the plain-language part
comes first (a firm rule, because position is easy to check), and *advise* on wording by
flagging developer jargon (a suggestion, not a wall, because "plain enough" can't be checked
exactly).

## Context

The 2026-07-21 audit found ≈96% of PO-facing paragraphs carry developer jargon — so
separating files (SPEC-043) surfaces the right content but not readable content. DR-066 (R1)
makes readable authoring a precondition, and splits the rule by enforceability: position is
deterministic (hard-gate); jargon is not (advise). This spec implements that split, reusing
SPEC-013's zone/divider and SPEC-006's vacuity detection.

## Requirements

- **FR-1 (position — hard gate).** A PO-facing file MUST open with a plain-language lead zone
  (above the SPEC-013 `core-end` divider). A missing or mis-ordered lead is an **error**
  (deterministic; reuse the section registry).
- **FR-2 (jargon — advisory).** A lint flags developer/CS jargon in the PO lead zone against
  a configurable per-audience lexicon. **Warning** severity, never a hard block.
- **FR-3 (per-audience lexicon).** The lexicon is per-project and per-audience (MinSpec's own
  PO is semi-technical; a marketing audience is not), seeded from the audit's recurrent terms
  (`T0`–`T4`, file paths, `code()`, `frontmatter`, `gate`, `CI`, git internals, `hash`).
- **FR-4 (vacuity guard).** The lint must not reward empty plain-language filler: reuse the
  SPEC-006 / SPEC-013 hollow/tautology detection to warn when a lead is jargon-free but
  vacuous.
- **FR-5 (rewrite-assist).** Offer an AI-delegated "rephrase in plain language" (Tier-1
  delegation per SPEC-014 / DR-017; the offline core is unaffected). Optional, never required.
- **FR-6 (honesty).** A lint pass means "no flagged terms," never "a PO will understand this."
  No surface renders a comprehensibility claim from the lint.
- **FR-7 (warn-first, no backfill).** The jargon advisory ratchets warn→(optional) stricter;
  existing specs are not retro-fitted (96% would fail).

## Acceptance Criteria

- [ ] **AC-1 (FR-1).** A PO file without a lead zone fails `validate` (error).
- [ ] **AC-2 (FR-2).** Jargon in the lead zone warns, does not block.
- [ ] **AC-3 (FR-3).** A term on the project allowlist does not warn.
- [ ] **AC-4 (FR-4).** A jargon-free but tautological lead warns.
- [ ] **AC-5 (FR-6).** No UI/status renders "PO-readable ✓" from the lint.

## Open Questions

- **OQ-1.** Lexicon seeding + curation — who maintains the per-audience list?
- **OQ-2.** Does the position gate apply only within the PO file, or also define the top-zone
  for single-file (SPEC-043-exempt) specs?

## Out of scope

- File separation (SPEC-043); enforcing *wording* as a hard gate (explicitly rejected —
  advisory only).

## Traceability

DR-066 (R1, the position/jargon split); SPEC-013 (zone + divider); SPEC-006 (hollow
detection); DR-017 (delegation); SPEC-045 (applies to DR lead summaries); EPIC-009.
