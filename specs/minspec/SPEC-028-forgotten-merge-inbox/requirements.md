---
id: SPEC-028
type: requirements
status: implementing
tier: T4
product: minspec
epic: EPIC-009  # Team Readiness — concurrent multi-session coordination
relates_to: [SPEC-024, SPEC-026, SPEC-027, SPEC-032, DR-051]  # done-ness/mergeability signal (SPEC-024) · presence (SPEC-026) · inter-session comms (SPEC-027) · discovery/done-ness input (SPEC-032) · session-coordination decision (DR-051)
---

# MinSpec — Forgotten-Merge Actions: Single & Bulk Merge (Requirements)

**Date:** 2026-07-02 (narrowed to action-only 2026-07-06 at Clarify, OQ-5)
**Status:** Implementing (approved 2026-07-06; Specify + Clarify done, awaiting Plan)
**Triggered by:** [#276](https://github.com/harvest316/minspec/issues/276) — "some devs (such as myself) tend to forget that they have other pending branches to merge."
**Epic:** [EPIC-009 Team Readiness](../../../docs/epics/EPIC-009-team-readiness.md)

> ⚠️ **Outward-facing.** The bulk action in this spec **pushes `main`**. That places it
> in the same never-wrong / hard-to-reverse tier as [SPEC-024](../SPEC-024-auto-merge-eligibility/requirements.md).
> "Transparent" is a promise to **surface**, never a licence to merge silently. See INV-1.
>
> **Split at Clarify (2026-07-06, OQ-5).** This spec originally covered discovery,
> classification, done-ness assessment *and* merge actions. The discovery/classification/
> done-ness half was read-only and outward-neutral, so it was carved out to
> [SPEC-032](../SPEC-032-forgotten-merge-discovery/requirements.md) (T3). This document now
> covers only the two actions that push `main`: single-merge and bulk "merge all clean" —
> the reason this spec stays T4. See [#551](https://github.com/AIClarityAU/minspec/issues/551).

## Context

[SPEC-032](../SPEC-032-forgotten-merge-discovery/requirements.md) discovers, classifies, and
computes a done-ness verdict for every unmerged branch — including bot-, collaborator-, and
self-authored branches that live only on `origin/*` and were never checked out locally. This
spec is what happens **once that candidate list exists**: how a human (or, once armed, an
opt-in policy) actually merges one branch or many.

The merge-execution half overlaps existing machinery, but that machinery targets MinSpec's
**own auto-built PR branches**, not arbitrary external ones:

- [SPEC-024](../SPEC-024-auto-merge-eligibility/requirements.md) / [#199](https://github.com/harvest316/minspec/issues/199) — auto-merge eligibility gate (this spec delegates all mergeability judgement here — INV-2, no second engine).
- [#183](https://github.com/harvest316/minspec/issues/183) / [#229](https://github.com/harvest316/minspec/issues/229) — per-dev HITL gate-placement + auto-merge-on-clean default.

**The new part** = extending single- and bulk-merge actions to candidates [SPEC-032](../SPEC-032-forgotten-merge-discovery/requirements.md)
surfaces (including origin-only branches never checked out), while still delegating every
individual eligibility call to SPEC-024's gate.

## Non-Goals (Out of Scope)

- **Discovery, classification, done-ness computation** — owned by [SPEC-032](../SPEC-032-forgotten-merge-discovery/requirements.md) as of the 2026-07-06 split. This spec consumes that verdict; it does not compute it.
- **Branch cleanup / pruning** — owned by #177 / #272. This spec merges *unmerged* work; deleting *merged* leftovers is a separate concern.
- **Re-implementing mergeability / CI-green computation** — reused from SPEC-024. This spec never introduces a second, divergent mergeability judgement (INV-2).
- **Rewriting history / rebasing forgotten branches** — any conflict resolution is HITL, out of the auto path.
- **Bulk-auto-merging human-collaborator branches** — settled at Clarify (OQ-3): forever HITL-only, regardless of done-ness verdict. Different consent than a bot dependency bump.

## Actions (FR-1..3) — two stakes, two gates

Candidates and their source classification (bot / human-collaborator / your-own) and
done-ness verdict (ready / needs-attention / stale-behind / conflicted) come from
[SPEC-032](../SPEC-032-forgotten-merge-discovery/requirements.md). This spec only decides
what a merge *action* against those candidates does.

**FR-1 — Single-merge (cheap).** *(renumbered from FR-8 at the split.)* Merge one branch =
a HITL toast over that branch's diff summary (reuses existing approval UX). Low blast
radius; one branch, visible, reversible-ish.

**FR-2 — "Merge all clean" (outward-facing, hard to reverse).** *(renumbered from FR-9.)*
Bulk-merge every `ready` candidate pushes `main`. This MUST:
- gate per the per-dev consequence-hybrid model (#183) — **never silent**;
- **exclude every `human-collaborator`-sourced candidate outright** (settled OQ-3 — never
  bulk-eligible, regardless of verdict);
- present the full manifest of what will merge (branch, source, done-ness, CI) **before** acting;
- delegate each individual merge's eligibility to SPEC-024's gate (no bypass);
- emit an **after-action audit record** of exactly what merged (auditable invariant), so a
  green-but-breaking bump is traceable.

**FR-3 — Future "auto in future" opt-in.** *(renumbered from FR-10.)* The user's "auto-merge
all transparently in future" is an **opt-in standing policy**, not a default, and it **arms
per source classification** (settled OQ-1 — e.g. dependabot-only auto, not per-repo or
global). When armed for a source, each run still produces the FR-2 manifest + audit record
for that source's candidates; arming it does not remove the surface, only the per-run
prompt. Default = **off**. `human-collaborator` can never be armed (FR-2).

## Invariants (T0 — tests before implementation)

- **INV-1 — Transparent ≠ silent.** *(renumbered from INV-3.)* No branch reaches `main` via
  the bulk path without (a) a pre-action manifest, (b) a CI-green (or no-CI) minimum, and
  (c) an after-action audit record. A green dependabot bump can still break the build; the
  never-wrong/auditable invariant forbids merging without surfacing.
- **INV-2 — No new merge engine.** *(renumbered from INV-4.)* Merge eligibility is decided
  by SPEC-024's gate; this spec never introduces a second, divergent mergeability judgement
  (single source of truth).
- **INV-3 — Human-collaborator branches are never bulk-auto-eligible.** *(new, from OQ-3.)*
  Regardless of done-ness verdict, `human-collaborator`-sourced candidates are excluded from
  FR-2/FR-3's bulk path outright; they are only ever reachable via FR-1 single-merge.

## Acceptance Criteria

1. "Merge all clean" shows a manifest, refuses any branch SPEC-024's gate rejects, excludes
   every `human-collaborator`-sourced candidate, and writes an audit record naming every
   merged branch. *(renumbered from AC-4.)*
2. Arming "auto in future" for one source (e.g. dependabot) does not arm other sources; a
   `human-collaborator` candidate can never be armed.
3. Single-merging one candidate produces exactly one HITL approval toast and one merge; no
   other candidate is touched.

## Open Questions (Clarify phase) — resolved 2026-07-06

- **OQ-1 — Auto-arm scope. RESOLVED: per-source.** "Auto in future" (FR-3) arms per
  source classification (e.g. dependabot-only auto), not per-repo or global. Matches the
  source risk table in [SPEC-032](../SPEC-032-forgotten-merge-discovery/requirements.md#the-three-actors-this-must-model) —
  the granularity this spec already gates on.
- **OQ-3 — Human-collaborator bulk. RESOLVED: HITL-only forever.** Human-authored branches
  are never bulk-auto-eligible, regardless of done-ness verdict — different consent than a
  bot dependency bump. Now codified as INV-3.
- **OQ-5 — Tier. RESOLVED: split.** This spec narrowed to the T4 action layer (FR-1..3,
  INV-1..3, AC-1..3); discovery/classification/done-ness moved to
  [SPEC-032](../SPEC-032-forgotten-merge-discovery/requirements.md) (T3). Split executed
  2026-07-06 per [#551](https://github.com/AIClarityAU/minspec/issues/551).

(OQ-2 fork discovery and OQ-4 surface home are discovery-layer questions, resolved in
[SPEC-032](../SPEC-032-forgotten-merge-discovery/requirements.md#open-questions--resolved-at-spec-028-clarify-2026-07-06).)

## Traceability

- **Issue:** [#276](https://github.com/harvest316/minspec/issues/276) (materialised jointly with SPEC-032).
- **Split into:** [SPEC-032](../SPEC-032-forgotten-merge-discovery/requirements.md) (discovery/classification/done-ness, T3), per [#551](https://github.com/AIClarityAU/minspec/issues/551). This document retains the T4 action layer.
- **Consumes:** [SPEC-032](../SPEC-032-forgotten-merge-discovery/requirements.md) (candidate list, source classification, done-ness verdict — no independent recomputation).
- **Reuses:** [SPEC-024](../SPEC-024-auto-merge-eligibility/requirements.md) (eligibility gate), [DR-033](../../../docs/decisions/DR-033.md) (auto-build gate placement).
- **Coordinates with:** [SPEC-026](../SPEC-026-session-presence/requirements.md) (presence — "in flight" annotation), [SPEC-027](../SPEC-027-inter-session-comms/requirements.md), [DR-051](../../../docs/decisions/DR-051.md).
- **Distinct from (not cleanup):** #168, #272, #177.
- **Follow-ups (tracked):** OQ-2 (fork discovery, now SPEC-032's concern) → [#550](https://github.com/AIClarityAU/minspec/issues/550). OQ-5 (tier split) → [#551](https://github.com/AIClarityAU/minspec/issues/551), **done** (this edit).
