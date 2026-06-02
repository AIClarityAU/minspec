---
id: SPEC-013
type: requirements
status: specifying
tier: T2
product: minspec
epic: EPIC-003  # SDD Core Methodology
depends_on: [DR-020, DR-022, DR-026, DR-028]  # DR-020(+addendum) policy; DR-022 future re-scope; DR-026 offer-not-silent; DR-028 cross-cutting freshness
relates_to: [SPEC-010, SPEC-006]
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
**Decision:** [DR-020](../../../docs/decisions/DR-020.md) + its 2026-06-02 addendum
(Risks tier-proportional; Consequences ± on DRs) · enforcement posture
[DR-026](../../../docs/decisions/DR-026.md) (offer-never-silent) +
[DR-028](../../../docs/decisions/DR-028.md) (cross-cutting complete-last, freshness).
Re-scopes to [DR-022](../../../docs/decisions/DR-022.md) (screen-gated) on its
acceptance, gated on #91 per [DR-024](../../../docs/decisions/DR-024.md).
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

This spec specifies the **mechanism** that enforces those policies (it does not
redefine them — DR-020 + its 2026-06-02 addendum own the taxonomy): a single
section-agnostic predicate, template stubs that pre-fill each required section, and a
**detect → one-click offer** path when a section is missing or stale.

Two cross-cutting principles from the review shape the mechanism:

- **Prevent first, then detect-and-offer — never silent, never a dead nag**
  ([DR-026](../../../docs/decisions/DR-026.md)). Correct *generation* (FR-3) is the
  primary line; a missing section is surfaced as a **visible one-click fix**, not
  silently rewritten and not just passively warned. A visible catch is the product
  demonstrating its value.
- **Presence never latches "complete" for cross-cutting sections**
  ([DR-028](../../../docs/decisions/DR-028.md)). Risks & Consequences summarise the
  whole artifact, so they are **completed last / due at the ready point** and bound
  to the spec's FR-set (freshness + coverage) — a section written early can't read
  "done" once the spec grows past it.

The DR-022 consequence/*reach* risk axis is a different "consequence" (a risk-screen
signal, not a doc section) and is explicitly out of scope (see below).

## Requirements

### The required-section registry

- **FR-0 (section-agnostic policy via a small registry).** Enforcement is driven by
  an explicit, small registry of *required sections*, each entry
  `{ heading, appliesTo, depth }`. v1 registry:

  | Section | Applies to | Satisfaction shape | Cross-cutting |
  |---|---|---|---|
  | `Risks & Mitigations` | specs + DRs | tier-proportional (DR-020) | yes |
  | `Consequences` | DRs only | minimal ± shape (DR-020 addendum) | yes |

  Adding or removing a required section is a registry edit, not new mechanism.
  Epics are exempt (DR-020: lightweight). The registry has exactly one detection
  mechanism behind it (FR-1). A `crossCutting` entry (both current entries) is
  governed by the completed-last / freshness rules (FR-7–FR-9, DR-028).

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
  (T1). For the **Consequences** entry, satisfaction is a **minimal ± shape**
  (DR-020 addendum, review OQ2 — "better than presence-only"): at least one
  **positive** and one **negative** consequence, detected deterministically via a
  configurable **polarity-cue set** (`Positive`/`Negative`, `Pros`/`Cons`,
  `Benefits`/`Drawbacks`, `+`/`−`). An explicit one-sided answer ("Negative: none")
  satisfies the missing side — the value is the *written* judgement, mirroring Risks
  "None material". In all cases the check is **structural** (presence + shape),
  never depth/quality — no programmatic oracle for "good" content (R4; SPEC-012
  FR-15).

### Templates

- **FR-3 (every scaffold emits the stubs for its applicable registry entries).**
  The artifact-creating surfaces — the `specify` / `plan` skill scaffolds and the
  **Create ADR** command template — MUST emit a stub for each registry section that
  `appliesTo` the artifact kind: a Risks & Mitigations stub **sized to tier**
  (table header at T3/T4, 2–4 bullet prompt at T2, one-line prompt with "None
  material" shown as valid at T1; table form for DRs), and — for DRs — a
  `## Consequences` stub with the **± skeleton** (`Positive:` / `Negative:` prompts,
  so a filled stub passes FR-2 and the stub/checker never drift, R1). Cross-cutting
  stubs (FR-7) are emitted as **deferred placeholders** (explicitly marked "complete
  after FRs stable — not yet counted"), not as satisfied content. No applicable
  section is omitted. The cost to the author is editing a stub, not authoring from
  blank.

### Detection → offer (never silent, never block)

- **FR-4 (detect + one-click offer, never silent, never block).** The validator
  (`scripts/validate-frontmatter.ts`) MUST detect any artifact missing/under-shape on
  a registry section that `appliesTo` it (failing FR-1/FR-2), naming the file and
  section. Detection is **surfaced as a visible, one-click "Add/complete section"
  offer** ([DR-026](../../../docs/decisions/DR-026.md)) — never a silent rewrite and
  never a bare passive nag. The offer inserts only the **stub/skeleton** (structure);
  the content is always author-written. It MUST NOT fail the validation run / exit
  non-zero on this rule alone (mirrors the soft `epic:` unresolved-ref rule, DR-013
  §4), and MUST NOT block edits or commits — only the DR-012 approval gate blocks.
  Epics are exempt.
- **FR-5 (the offer is actionable).** Each finding MUST give the artifact id/path,
  the section name, and a one-line remedy ("add a `## Consequences` section with a
  positive and a negative" / "add `## Risks & Mitigations` — one line is enough at
  T1"), plus the one-click action where a surface supports it (CLI text v1; Problems
  panel later, [#118](https://github.com/harvest316/minspec/issues/118)). A finding
  the author cannot act on is noise.

### Cross-cutting completeness — never latch on presence (DR-028)

- **FR-7 (deferred-placeholder third state).** A cross-cutting registry section
  (`crossCutting: true`) recognises three states, not two: **missing**,
  **deferred-placeholder**, **satisfied**. While the artifact is a draft
  (`status: specifying`) a deferred placeholder is **not "missing"** (no nag) and
  **not "satisfied"** (cannot latch complete). These sections are **due at the
  ready/`done` transition** (aligns SPEC-006 RD-2 / FR-11) — completed last, after
  the FRs stabilise. Early authorship is allowed, never forced or forbidden.
- **FR-8 (freshness-bound — DR-012 pattern).** A completed cross-cutting section is
  bound to a hash of the spec's **FR-set** (structure: FR ids). Adding / removing /
  renaming an FR after the section was completed marks it **stale**, surfacing a
  *named* offer ("Risks may not cover FR-7, FR-8 added since — revisit"). Binds to
  FR-set structure, not prose, to avoid false-positives. (Same edit-voids-the-claim
  mechanism as DR-012 approval staleness.)
- **FR-9 (coverage — consumes SPEC-010).** Completeness checks that each `FR-N` is
  *referenced* in the applicable cross-cutting section (DR-020 already wants
  mitigations→FR); uncovered FRs are named. The FR→section coverage edge is owned by
  SPEC-010's DAG and added there under
  [#121](https://github.com/harvest316/minspec/issues/121) (SPEC-010 is approved —
  amended + re-reviewed, not silently edited). This spec **consumes** that predicate;
  it does not re-implement coverage.

### Scope boundary

- **FR-6 (policy lives in its DR/convention, not here).** This spec MUST NOT encode
  section *depth/applicability policy* as logic beyond the registry (FR-0) + the
  predicate (FR-1/FR-2). The Risks taxonomy is DR-020's; the Consequences requirement
  + ± shape is the DR-020 addendum (2026-06-02). If a policy changes, the registry
  entry or stub text changes; the predicate does not. Keeps the mechanism stable
  across policy edits.

## Invariants (must hold)

- **INV — Advisory, offer-never-silent (T0).** The required-section rule **detects
  and offers a one-click fix; it never silently writes the author's artifact and
  never blocks** (FR-4, DR-026). Only the DR-012 approval gate blocks. No MinSpec
  validation rule may newly hard-fail a build for a missing/stale section. Section
  *content* is always author-written — the offer inserts structure only.
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
| R7 | **Stale-but-present (false-complete)** — a cross-cutting section filled early reads "done" after the spec grows past it. | Med · High | FR-7 deferred-placeholder (never latches) + FR-8 freshness hash (FR-set edit → stale) + FR-9 coverage (uncovered FRs named); DR-012 re-approval backstop. DR-028. |
| R8 | **Freshness false-positives** — cosmetic FR rewords mark sections stale, breeding ignore-the-warning. | Med · Med | FR-8 binds to FR-set *structure* (ids), not prose; an FR-ref in the section clears it. |

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

- **RD-1 — backfill before enabling the rule.** Backfill lands **before** (or in the
  same change as) enabling FR-4, so the rule first runs against a clean tree (avoids
  the R2 flood). Backfill scope is **two-part**: (a) Risks onto any DR/spec lacking
  it, and (b) **restructure the 25 existing DRs' Consequences from prose into the ±
  shape** (FR-2) — presence already holds, the ± shape does not. Plan sequences
  backfill → enable.
- **RD-2 — surface = CLI stdout for v1.** FR-4/FR-5 findings ship on the validator's
  existing stdout channel in v1; the VS Code Problems-panel diagnostic is parked as
  [#118](https://github.com/harvest316/minspec/issues/118) (reuses the FR-1 predicate;
  coordinates with the SPEC-010 signpost diagnostics surface).
- **RD-3 — Consequences policy home = DR-020 addendum** (review OQ1). Recorded in the
  DR-020 2026-06-02 addendum so the registry's second entry (FR-0) has a cited policy
  source, symmetric with the Risks entry.
- **RD-4 — Consequences shape = minimal ± (review OQ2, "better than presence-only").**
  ≥1 positive + ≥1 negative via polarity cues, explicit-"none" satisfies a side
  (FR-2). Structural, not a quality oracle.
- **RD-5 — detect → offer, never silent (review).** Missing/stale sections are a
  visible one-click offer, not a silent write and not a dead nag
  ([DR-026](../../../docs/decisions/DR-026.md)); prevention (FR-3) is primary.
- **RD-6 — cross-cutting sections complete last + never latch on presence.** Deferred
  placeholders, due-at-ready, freshness- + coverage-bound (FR-7–FR-9,
  [DR-028](../../../docs/decisions/DR-028.md)).

## Open questions

- **None blocking.** One external dependency: the FR-9 FR→section coverage edge is an
  amendment to the approved SPEC-010, tracked at
  [#121](https://github.com/harvest316/minspec/issues/121) — FR-7/FR-8 (this spec)
  ship independently; FR-9 lands when #121 merges.
