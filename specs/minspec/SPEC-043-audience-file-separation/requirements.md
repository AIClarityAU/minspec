---
id: SPEC-043
title: Audience file-separation authoring discipline + validator
type: requirements
status: specifying
tier: T3
product: minspec
created: 2026-07-21
epic: EPIC-009  # Team Readiness
depends_on: [DR-066, SPEC-013]
relates_to: [SPEC-041, SPEC-044, SPEC-038]
phases:
  specify: done
  clarify: done
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-043: Audience file-separation authoring discipline + validator

## Summary

Keep each kind of reader's content in its own file — the product owner's "what and why" in
one file, the engineering "how" in another. That single habit is what lets each person be
sent exactly their file to review, so it needs a gentle rule (a warning, not a wall) that
nudges new specs to keep them apart.

## Context

DR-066 (decision 1) makes audience = whole files and drops sub-file projection. The whole
approval-routing story (SPEC-041) depends on each audience living in its own file, because
GitHub review, CODEOWNERS, and the approval sidecar are all per-file. This spec is the
authoring gate that keeps new specs conformant, reusing SPEC-013's section machinery.

## Requirements

- **FR-1 (audience→file map, single source of truth).** Define the map as data: default
  `requirements.md` = PO; `design.md`, `tasks.md` = engineering; extensible per project/role.
  It is **authoritative**: the SPEC-041 `CODEOWNERS` globs are **generated from it** (with a
  validation that flags drift), so routing can never silently diverge from the map (RD-2).
  The map is an attribute on SPEC-013's existing section registry, not a parallel registry
  (RD-1).
- **FR-2 (mixed-file detection).** The validator warns when a file mixes audiences — e.g.
  engineering-typed content in `requirements.md` — using the DR-053 paragraph-type signal
  where present, else a heuristic heading set.
- **FR-3 (separation rule).** New specs author each audience in its own file; a single-file
  mixed-audience spec is non-conformant (warn).
- **FR-4 (small-spec exemption).** T1 (and optionally T2) specs may be single-file; the rule
  applies at T3/T4 where the split earns its keep. Reads `tier:` only.
- **FR-5 (warn-first ratchet, no backfill).** Ships as a warning; a project may promote to
  error once its corpus is conformant (the SPEC-038 grandfather pattern). Existing specs are
  not retro-fitted.
- **FR-6 (scaffold the split).** The `specify`/`plan` scaffolds emit the separated files by
  default for T3+, so conformance is the path of least resistance.

## Acceptance Criteria

- [ ] **AC-1 (FR-2).** A `requirements.md` containing a `## Contracts`/`INV` block warns.
- [ ] **AC-2 (FR-4).** A T1 single-file spec does not warn.
- [ ] **AC-3 (FR-5).** The rule is warning severity by default; a pre-rule spec is not newly
      blocked.
- [ ] **AC-4 (FR-6).** `MinSpec: Specify` scaffolds `requirements.md` + `design.md` +
      `tasks.md` for a T3+.

## Resolved Decisions (Clarify)

- **RD-1 (registry) — reuse SPEC-013.** Audience is an attribute on SPEC-013's existing
  section registry + `core-end` divider, not a parallel registry — one source, no drift
  (the SPEC-030 two-sources-of-truth failure mode avoided).
- **RD-2 (single source) — map is authoritative; CODEOWNERS generated from it.** The
  audience→file map is the one source of truth; SPEC-041's `CODEOWNERS` globs are generated
  and drift-validated from it, offline (Tier-0). Prevents routing silently diverging from
  the map.

## Out of scope

- The jargon/readability rule (SPEC-044); per-paragraph audience typing (dropped Phase C).

## Traceability

DR-066 (decision 1); SPEC-013 (section policy + divider); SPEC-038 (warn→error ratchet);
SPEC-041 (CODEOWNERS routing); EPIC-009.
