---
id: SPEC-013
type: requirements
status: specifying
tier: T2
product: minspec
epic: EPIC-003  # SDD Core Methodology
depends_on: [DR-022]
---

# MinSpec — Required-Section Policy Enforcement (Requirements)

> **Interim: implements [DR-020](../../../docs/decisions/DR-020.md) (tier-proportional).**
> DR-022's screen-gated re-scope was **downgraded to proposed** ([DR-024](../../../docs/decisions/DR-024.md))
> pending reach validation ([#91](https://github.com/harvest316/minspec/issues/91)),
> so **DR-020 remains in force** and this spec implements it as written below. When
> DR-022 is accepted, the risks section becomes **screen-gated** — required *iff the
> risk screen trips*, not by tier — and FR-2/FR-3's tier logic changes to "required
> when the screen reports tripped signals" (`depends_on` the consequence screen).
> The `depends_on: [DR-022]` link tracks that eventual re-scope; the operative policy
> today is DR-020.

**Date:** 2026-06-01
**Status:** Specifying (SDD Specify phase)
**Decision:** [DR-020](../../../docs/decisions/DR-020.md) (in force — tier-proportional)
today; re-scopes to [DR-022](../../../docs/decisions/DR-022.md) (screen-gated) on its
acceptance, gated on #91 per [DR-024](../../../docs/decisions/DR-024.md)
**Triggered by:** session request — "spec the risk-enforcing policy, then I'll
review it so we can implement + backfill directly after approval."
**Epic:** [EPIC-003 SDD Core Methodology](../../../docs/epics/EPIC-003-sdd-core.md)

---

## Context

[DR-020](../../../docs/decisions/DR-020.md) requires a **Risks & Mitigations**
section on every spec and DR, with depth proportional to tier (one line at T1, a
full table at T4), enforced by a **soft validator warning** — never a block.

There is a second, symmetric gap. Every DR carries a classic-ADR **Consequences**
section — the Create ADR template emits one and all 25 current DRs have it — but
**nothing enforces its presence**: a hand-written DR can silently drop it. Rather
than build a near-duplicate risks-only mechanism, this spec generalizes to a
small **required-section registry** and one section-agnostic predicate, then
applies it to both sections.

This spec turns that into three concrete, shared changes: a single section-agnostic
definition of "has section «X»", template stubs that pre-fill each required section,
and a validator rule that warns when one is absent. It deliberately does **not**
redefine the *policies* (DR-020 owns the Risks taxonomy; Consequences is the
ADR-format convention) — it specifies the mechanism that enforces them. The
DR-022 consequence/*reach* risk axis is a different "consequence" and is explicitly
out of scope (see below).

## Requirements

### The required-section registry

- **FR-0 (section-agnostic policy via a small registry).** Enforcement is driven by
  an explicit, small registry of *required sections*, each entry
  `{ heading, appliesTo, depth }`. v1 registry:

  | Section | Applies to | Depth |
  |---|---|---|
  | `Risks & Mitigations` | specs + DRs | tier-proportional (DR-020) |
  | `Consequences` | DRs only | presence (ADR-format convention) |

  Adding or removing a required section is a registry edit, not new mechanism.
  Epics are exempt (DR-020: lightweight). The registry has exactly one mechanism
  behind it (FR-1).

### Detection (the shared predicate)

- **FR-1 (one section-agnostic predicate).** A single deterministic predicate
  `hasSection(artifact, heading)` decides whether an artifact satisfies a registry
  entry: presence of a heading matching «heading» (case-insensitive, `##`/`###`)
  with at least one non-empty content line beneath it. This predicate is the
  **sole** source of truth, **parameterized by heading** and shared by the
  validator (FR-4) and any template self-check, for every registry entry — the stub
  and the check can never disagree, and no per-section re-implementation exists
  (DR-020 R3; INV-single-predicate).
- **FR-2 (per-entry satisfaction shape).** For the **Risks** entry the predicate
  MUST accept the tier-appropriate forms from DR-020: a full table (T3/T4), a short
  table or bullets (T2), or a single line including an explicit "None material"
  (T1). For the **Consequences** entry, satisfaction is **presence-only** (a
  populated `## Consequences` section, any depth — not tier-graded). In both cases
  the check is *presence + non-emptiness*, never depth/quality — depth is guidance,
  not a gate (consistent with advisory-not-blocking).

### Templates

- **FR-3 (every scaffold emits the stubs for its applicable registry entries).**
  The artifact-creating surfaces — the `specify` / `plan` skill scaffolds and the
  **Create ADR** command template — MUST emit a stub for each registry section that
  `appliesTo` the artifact kind: a Risks & Mitigations stub **sized to tier**
  (table header at T3/T4, 2–4 bullet prompt at T2, one-line prompt with "None
  material" shown as valid at T1; table form for DRs), and — for DRs — a
  `## Consequences` stub. (Create ADR already emits Consequences; FR-3 makes it a
  guaranteed registry output, not an incidental template line.) No applicable
  section is omitted. The cost to the author is editing a stub, not authoring from
  blank.

### Validation

- **FR-4 (soft-warn, never block).** The frontmatter/structure validator
  (`scripts/validate-frontmatter.ts`) MUST emit a **warning** for any artifact
  missing a registry section that `appliesTo` it (failing FR-1 for that entry),
  naming the file and the missing section. It MUST NOT fail the validation run /
  exit non-zero on this rule alone — mirrors the soft `epic:` unresolved-ref rule
  (DR-013 §4). Epics are exempt (DR-020: lightweight).
- **FR-5 (warning is actionable).** Each warning MUST give the artifact id/path,
  the missing section name, and a one-line fix ("add a `## Consequences` section" /
  "add `## Risks & Mitigations` — one line is enough at T1"). A warning the author
  cannot act on is noise.

### Scope boundary

- **FR-6 (policy lives in its DR/convention, not here).** This spec MUST NOT encode
  section *depth/applicability policy* as logic beyond the registry (FR-0) + the
  presence/non-emptiness predicate (FR-1). The Risks taxonomy (which tiers, what
  depth) is DR-020's; the Consequences requirement is the classic ADR-format
  convention the Create ADR template already follows. If a policy changes, the
  registry entry or stub text changes; the predicate does not. Keeps the mechanism
  stable across policy edits.

## Invariants (must hold)

- **INV — Advisory (T0).** The risk-section rule warns, never blocks (FR-4). Only
  the DR-012 approval gate blocks. No MinSpec validation rule may newly hard-fail a
  build for a missing risks section.
- **INV — Single predicate (T0).** Exactly one definition of "has section «X»"
  (FR-1), parameterized by heading, is used by both validator and any template
  self-check for every registry entry; no second implementation may exist
  (prevents stub/checker drift, DR-020 R3).

## Risks & Mitigations

| # | Risk | Likelihood · Impact | Mitigation |
|---|---|---|---|
| R1 | **Stub/validator drift** — the template emits a heading the predicate doesn't accept (or vice-versa), so freshly-scaffolded docs warn immediately. | Med · High | FR-1 single shared predicate + INV-single-predicate; one T1 test scaffolds each tier and asserts the predicate passes on the raw stub. |
| R2 | **Warning fatigue** — backfilling onto 19 existing DRs floods the validator with warnings, training users to ignore all warnings. | High · Med | Backfill (separate follow-up) lands before/with enabling the rule, or the rule ships warn-once-per-file; sequence handled at plan time. Advisory-only keeps it from blocking meanwhile. |
| R3 | **Predicate too loose** — an empty `## Risks & Mitigations` header with no content passes, defeating the policy. | Med · Med | FR-1 requires ≥1 non-empty content line beneath the heading, not just the heading. |
| R4 | **Scope creep into depth-grading** — pressure to make the validator judge whether the risks are "good enough". | Low · Med | FR-2 + FR-6 explicitly bound the check to presence + non-emptiness; semantic adequacy is out of scope (no programmatic oracle, mirrors SPEC-012 FR-15). |
| R5 | **Over-generalization** — a section-agnostic registry invites piling on required sections, re-creating ceremony bloat. | Low · Med | Registry is explicit + small (2 entries v1, FR-0); adding one is a deliberate edit + review, not automatic. Advisory-only (INV-advisory) keeps any addition non-blocking. |
| R6 | **"Consequences" name collision** — readers conflate the enforced doc-section with the gated DR-022 consequence/*reach* risk axis. | Med · Low | Out-of-scope explicitly separates them; the registry enforces a *doc-section heading*, never a risk-screen signal. |

## Out of scope

- **The policies themselves** (Risks: which tiers, what depth — DR-020;
  Consequences: the ADR-format convention) — this spec enforces them, does not
  define them.
- **The DR-022 consequence/*reach* risk axis** — the call-graph impact model is a
  *different* "consequence" (a risk-screen signal, not a doc section) and is
  **gated on [#91](https://github.com/harvest316/minspec/issues/91)** per DR-024.
  This spec enforces the **Consequences doc-section** only; it neither implements
  nor depends on the reach screen.
- **Consequences on specs** — Consequences is a DR/ADR convention; specs use Risks
  & Mitigations. The registry applies Consequences to DRs only.
- **Semantic quality of section content** — no programmatic judge of whether a risk
  analysis or consequence list is *good*; presence + non-emptiness only (FR-2).
- **Hard-blocking enforcement** — excluded by INV-advisory; the only gate is
  DR-012.

## Resolved design decisions (were open questions)

- **RD-1 — backfill before enabling the warn rule.** The Risks-section backfill
  onto existing DRs lands **before** (or in the same change as) enabling FR-4, so
  the rule first runs against a clean tree — avoids the R2 warning-flood. (No
  Consequences backfill is needed: all 25 current DRs already carry the section;
  only the *forward* guard is new.) Plan sequences backfill → enable.
- **RD-2 — warn surface = CLI stdout for v1.** FR-4 warnings ship on the
  validator's existing stdout channel in v1. The VS Code Problems-panel diagnostic
  is a later enhancement, parked as
  [#118](https://github.com/harvest316/minspec/issues/118) (reuses the FR-1
  predicate; coordinates with the SPEC-010 signpost diagnostics surface).

## Open questions

- **Consequences policy home.** Formalize "DRs MUST carry a `## Consequences`
  section" as a short DR-020 addendum, or treat it as the self-evident ADR-format
  convention the template already emits? Lean: a one-line DR-020 addendum, so the
  registry entry (FR-0) has a cited policy source symmetric with the Risks entry.
  Confirm at plan.
- **Consequences satisfaction shape.** Presence-only (current FR-2) vs a minimal
  shape (e.g. at least a positive *and* a negative consequence)? Lean: presence-only
  for v1 — no programmatic oracle for "good consequences" (mirrors R4 / SPEC-012
  FR-15).
