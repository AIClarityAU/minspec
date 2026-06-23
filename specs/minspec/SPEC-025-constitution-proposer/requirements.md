---
id: SPEC-025
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology
---

# MinSpec — Constitution Proposer (deterministic, Tier-0) — Requirements

**Date:** 2026-06-23
**Status:** Specifying (SDD Specify phase)
**Triggered by:** [#269](https://github.com/harvest316/minspec/issues/269) — "shouldn't MinSpec propose Invariants/Principles/Constraints alongside Goals at init, instead of empty placeholders?"
**Related:** [#270](https://github.com/harvest316/minspec/issues/270) (enforce invariants as gates — the sequel), [#242](https://github.com/harvest316/minspec/issues/242) (init tech-debt scan), DR-039 (Goals), DR-004/DR-015 (Tier-0 boundary)

## Problem

`Initialize SDD Structure` scaffolds `.minspec/constitution.md` with **empty**
Invariants/Principles/Constraints (template comments) and **no Goals section**. Every
MinSpec project starts with an empty *foundational* doc, and nothing surfaces that it is
empty — the same asymmetry MinSpec exists to prevent (the scaffolder writes the section
but never asserts it should be filled). An empty constitution is a bad state.

## Scope (one sentence)

At Initialize/Refresh, deterministically **propose a DRAFT constitution**
(Invariants/Principles/Constraints/Goals) from codebase signals — never empty
placeholders — and softly surface an empty constitution as a next human task.

## Invariants (this change must preserve)

- **INV-1 — Tier-0.** No LLM, no network. The proposer is a pure function over the
  filesystem (DR-004/DR-015/DR-019 §6). LLM enrichment is explicitly **out of scope**
  (Tier-1 `agent-execute` follow-up).
- **INV-2 — Never assert, never overwrite human content.** Proposals are marked DRAFT.
  A section that already holds human-authored (non-DRAFT) content is left untouched.
  Idempotent across repeated Refresh runs.
- **INV-3 — Populate, do not enforce.** This spec only *writes* candidate invariants. It
  does **not** wire invariants as resolver gates — that is #270. (populate ≠ enforce.)
- **INV-4 — Determinism is auditable.** Every candidate carries machine-readable
  provenance ("proposed because <signal>"), so the proposal is reproducible and
  reviewable.

## Functional Requirements

- **FR-1 — Deterministic signal scan.** Read, without executing or networking:
  `package.json` (`engines` → runtime constraint; dependencies → "runs offline / no
  network without consent" candidate when no network deps), monorepo layout (Tier-0
  packages → "shared stays `vscode`/network-free" invariant candidate), bundle config
  (`.vscodeignore`/size), and existing `CLAUDE.md` / `docs/decisions/*` prose (extract
  already-stated invariants/principles). Output: a list of typed `Signal` records.
- **FR-2 — Rule-based candidate generation.** A fixed catalog maps `Signal → Candidate`
  (kind ∈ {invariant, principle, constraint, goal}, text, stable ID, provenance). No
  inference beyond the catalog. Unmatched signals produce nothing (silence over noise).
- **FR-3 — Scaffold integration.** `Initialize` writes the proposed DRAFT constitution —
  **including a `## Goals` section** (currently absent from the scaffold) — instead of
  empty placeholders. `Refresh Harness` offers to fill **only** empty/template sections
  (INV-2).
- **FR-4 — DRAFT marking + human boundary.** Each proposed item is visibly DRAFT and
  removable; the moment a section has human content the proposer never rewrites it.
- **FR-5 — Empty-constitution nudge.** When the constitution is empty/all-template, a
  **soft** advisory (signpost/validator, never a block) surfaces "author your
  constitution" as a next human task (RCDD phase-4: surface the bad state).
- **FR-6 — Provenance shown.** The DRAFT renders each candidate's provenance so the human
  can judge it ("proposed because: no network dependencies detected").

## Out of scope

- **LLM enrichment** of the draft → Tier-1 `agent-execute` follow-up (separate spec).
- **Invariant enforcement** (wiring invariants as `gate-violation` in the resolver) →
  [#270](https://github.com/harvest316/minspec/issues/270).
- Re-proposing / churning a human-authored constitution.

## Open questions (for Clarify/Plan)

- **OQ-1 — Catalog contents.** Exact `Signal → Candidate` rules and their wording. How
  conservative? (Bias to few high-confidence candidates over many weak ones.)
- **OQ-2 — Refresh ergonomics.** Offer-to-fill UX when only *some* sections are empty —
  per-section offer vs whole-doc?
- **OQ-3 — Provenance format.** Inline comment vs a trailing "proposed because" note;
  must survive human edits without rotting.

## Acceptance (T2 feature tests, happy + primary failure)

- A fresh `Initialize` on a repo with no network deps yields a constitution whose
  `## Invariants` contains a DRAFT "runs offline / no network without consent" candidate
  with provenance — not an empty placeholder.
- `Refresh Harness` on a constitution with human-authored Invariants but empty
  Constraints fills **only** Constraints (INV-2 idempotence/non-overwrite).
- An all-template constitution triggers the soft "author your constitution" advisory
  (FR-5); a populated one does not.

## Traceability

Materializes #269. Enforcement sequel: #270. Tier-1 LLM enrichment: future spec.
