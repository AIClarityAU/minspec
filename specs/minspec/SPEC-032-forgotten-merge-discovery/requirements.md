---
id: SPEC-032
type: requirements
status: implementing
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness — concurrent multi-session coordination
relates_to: [SPEC-024, SPEC-026, SPEC-027, SPEC-028, SPEC-012, DR-051]  # done-ness/mergeability signal (SPEC-024) · presence (SPEC-026) · inter-session comms (SPEC-027) · consumer of this discovery (SPEC-028) · signpost surface home (SPEC-012) · session-coordination decision (DR-051)
---

# MinSpec — Forgotten-Merge Discovery & Done-ness (Requirements)

**Date:** 2026-07-06
**Status:** Implementing (approved 2026-07-06; Specify + Clarify done, awaiting Plan)
**Split from:** [SPEC-028](../SPEC-028-forgotten-merge-inbox/requirements.md) at Clarify
(OQ-5, 2026-07-06) — see [SPEC-028 Traceability](../SPEC-028-forgotten-merge-inbox/requirements.md#traceability)
and [#551](https://github.com/AIClarityAU/minspec/issues/551).
**Triggered by:** [#276](https://github.com/harvest316/minspec/issues/276) — "some devs (such as myself) tend to forget that they have other pending branches to merge."
**Epic:** [EPIC-009 Team Readiness](../../../docs/epics/EPIC-009-team-readiness.md)

> **Why split from SPEC-028.** This half is read-only (`git fetch` only, INV-3) and
> outward-neutral — no `main`-push, no external side effect. It does not need Clarify
> ceremony on its own merits; it was carved out of a T4 spec whose *other* half (bulk
> and single-merge actions, still SPEC-028) does push `main` and stays T4. This document
> is the T3 discovery/classification/done-ness core; [SPEC-028](../SPEC-028-forgotten-merge-inbox/requirements.md)
> is the T4 action layer that consumes it.

## Context

MinSpec's existing branch work is all **cleanup of branches the dev already dealt with**:

- [#168](https://github.com/harvest316/minspec/issues/168) — worktree-per-session corruption guardrail.
- [#272](https://github.com/harvest316/minspec/issues/272) — detect orphaned **worktrees** (session↔worktree map).
- [#177](https://github.com/harvest316/minspec/issues/177) — prune **merged** worktrees/branches.

**None discovers unmerged branches the dev forgot**, and none considers **bot- or
remote-authored sources** (dependabot, renovate, a collaborator's pushed branch) that
live only on `origin/*` and were never checked out — invisible to every local- or
worktree-based scan. That is the gap this spec fills: **discovery + classification +
done-ness assessment** of unmerged work, not branch cleanup and not merge execution
(that's [SPEC-028](../SPEC-028-forgotten-merge-inbox/requirements.md)).

The done-ness half overlaps existing machinery, but that machinery targets MinSpec's
**own auto-built PR branches**, not arbitrary external ones:

- [SPEC-024](../SPEC-024-auto-merge-eligibility/requirements.md) / [#199](https://github.com/harvest316/minspec/issues/199) — auto-merge eligibility gate (the done-ness signal set this spec reuses).
- [#181](https://github.com/harvest316/minspec/issues/181) — keep PR branches mergeable as base advances.

**The new part** = discovery + source-classification + done-ness assessment across **all**
branches including origin-only. This spec computes the verdict; it never acts on it —
merge execution is entirely [SPEC-028](../SPEC-028-forgotten-merge-inbox/requirements.md)'s concern.

## Non-Goals (Out of Scope)

- **Branch cleanup / pruning** — owned by #177 / #272. This spec surfaces *unmerged* work; deleting *merged* leftovers is a separate concern.
- **Re-implementing mergeability / CI-green computation** — reused from SPEC-024. This spec is the *discoverer*, not a second merge engine.
- **Merging, deleting, or rebasing anything** — that's [SPEC-028](../SPEC-028-forgotten-merge-inbox/requirements.md). This spec is read-only by construction (INV-3).
- **Cross-remote discovery** beyond the repo's own `origin` in v1 (forks, secondary remotes) — tracked as [#550](https://github.com/AIClarityAU/minspec/issues/550).

## The three actors this must model

Done-ness signal **and** risk differ per source; classification is not cosmetic — it gates
what [SPEC-028](../SPEC-028-forgotten-merge-inbox/requirements.md) treats as bulk-eligible downstream.

| Source | Detection signal | Typical done-ness | Downstream auto-merge stance (SPEC-028) |
|---|---|---|---|
| **Bot** (dependabot / renovate) | branch prefix `dependabot/*`, `renovate/*`; author identity | single dep bump, usually CI-green | strongest candidate — but still CI-gated |
| **Human collaborator** | `origin/*` branch not authored by you, PR often open | varies | HITL only — never bulk-auto (settled, SPEC-028 OQ-3) |
| **Your own abandoned** | local or `origin/*` branch you authored, no recent activity | varies; may be half-done | HITL; done-ness must warn on `behind`/stale |

## Requirements

### Discovery (FR-1..4)

**FR-1 — Fetch before enumerate.** Discovery MUST `git fetch --prune` and enumerate
`origin/*` refs, not just local/worktree branches. Dependabot/renovate/collaborator
branches exist **nowhere else**; a local-only scan is structurally blind to them. Fetch
failure (offline) → degrade gracefully to local + last-known `origin/*`, and **label the
result stale** (never present stale data as live — auditable invariant).

**FR-2 — Enumerate the union.** The candidate set = { local branches } ∪ { `origin/*`
tracking refs } minus the current branch and minus anything already merged into the
default base (fully-contained by `git branch --merged <base>` / ancestor check).

**FR-3 — Source classification.** Each candidate is classified bot / human-collaborator /
your-own per the table above, using branch-prefix + commit author identity. Classification
is a **committed, testable pure function** of (branch name, author, base) — no network, no
LLM (Tier-0 determinism, mirrors the eligibility predicates).

**FR-4 — Exclude the already-handled.** A branch with an **open PR you have already
interacted with**, or one already in a MinSpec worktree/session (cross-ref SPEC-026
presence), is annotated as "in flight", not "forgotten" — this discovery is for genuinely
dormant work.

### Done-ness assessment (FR-5..7)

**FR-5 — Done-ness signal set.** For each candidate compute: ahead/behind base · PR open? ·
mergeable (no conflicts) · CI status (green/red/none) · age since last commit. This is the
**same signal set as SPEC-024**; this spec MUST consume SPEC-024's computation, not fork it.

**FR-6 — Done-ness verdict.** A deterministic rollup → { ready · needs-attention ·
stale/behind · conflicted }. `ready` requires: no conflicts **and** (CI green **or** no CI
configured) **and** not behind base by unmerged base commits that would silently drop.

**FR-7 — Dependabot fast-path.** A `dependabot/*` branch that is a single dep bump, ahead-only,
mergeable, CI-green → the canonical `ready` example. This spec only computes the verdict;
[SPEC-028](../SPEC-028-forgotten-merge-inbox/requirements.md) INV-1 governs how that verdict
is allowed to act.

### Surface (FR-8)

**FR-8 — Inbox surface + keyboard path.** *(renumbered from SPEC-028 FR-11 at the split.)*
The forgotten-merge candidate list is a section of the signpost (SPEC-012 next-task
surface) — **resolved at SPEC-028's Clarify, OQ-4**, not a standalone view. Per the global
keyboard-over-mouse preference, the frequent actions (open next candidate, dismiss) MUST
each have a two-key path composing with SPEC-012's existing keyboard model. The
per-candidate merge/bulk-merge actions themselves are rendered here but **execute** via
[SPEC-028](../SPEC-028-forgotten-merge-inbox/requirements.md).

## Invariants (T0 — tests before implementation)

- **INV-1 — Discovery is complete or honestly-partial.** Either `origin/*` was fetched and
  enumerated, or the result is explicitly labelled stale/partial. Never present a
  local-only scan as the full picture. (Root of the whole issue: forgotten = invisible.)
- **INV-2 — Classification + done-ness are Tier-0 pure functions.** No network, no LLM, no
  clock-nondeterminism in the verdict; identical inputs → identical verdict (testable,
  mirrors SPEC-024 predicate parity).
- **INV-3 — Read-only until an explicit action.** Discovery + assessment mutate nothing
  (only `git fetch`). No branch is merged, deleted, or rebased as a side effect of *viewing*
  this surface — mutation only happens through [SPEC-028](../SPEC-028-forgotten-merge-inbox/requirements.md).

## Acceptance Criteria

1. A dependabot branch pushed only to `origin/*`, never checked out locally, **appears** classified `bot / ready`.
2. A half-finished local branch behind base appears classified `your-own / stale` with a behind-warning, and is **excluded** from `ready`.
3. Offline (fetch fails) → surface renders from cache **labelled stale**.
4. Classification + done-ness verdict functions pass unit tests with fixture branches for all three sources (no network in the test).
5. Viewing the surface produces zero repo mutations beyond `git fetch` (INV-3 test).

## Open Questions — resolved at SPEC-028 Clarify (2026-07-06)

These were raised against the pre-split SPEC-028; the ones scoped to this discovery half:

- **OQ-2 — Secondary remotes / forks. RESOLVED: follow-up, not v1.** v1 stays `origin`-only
  per Non-Goals. Tracked as [#550](https://github.com/AIClarityAU/minspec/issues/550).
- **OQ-4 — Surface home. RESOLVED: section of the signpost (SPEC-012).** Not a standalone
  view (see FR-8).

(OQ-1 auto-arm scope, OQ-3 human-bulk policy, and OQ-5 the split decision itself are
action-layer or meta and are recorded in [SPEC-028](../SPEC-028-forgotten-merge-inbox/requirements.md#open-questions-clarify-phase--resolved-2026-07-06).)

## Traceability

- **Issue:** [#276](https://github.com/harvest316/minspec/issues/276) (materialised jointly with SPEC-028).
- **Split from:** [SPEC-028](../SPEC-028-forgotten-merge-inbox/requirements.md), per [#551](https://github.com/AIClarityAU/minspec/issues/551).
- **Reuses:** [SPEC-024](../SPEC-024-auto-merge-eligibility/requirements.md) (eligibility/done-ness signal set).
- **Coordinates with:** [SPEC-026](../SPEC-026-session-presence/requirements.md) (presence — "in flight" annotation), [SPEC-027](../SPEC-027-inter-session-comms/requirements.md), [SPEC-012](../SPEC-012-next-task-resolver/requirements.md) (surface home), [DR-051](../../../docs/decisions/DR-051.md).
- **Consumed by:** [SPEC-028](../SPEC-028-forgotten-merge-inbox/requirements.md) (bulk/single-merge actions read this spec's verdict; no independent mergeability judgement — INV-2 there).
- **Distinct from (not cleanup):** #168, #272, #177.
- **Follow-ups (tracked):** OQ-2 (fork discovery) → [#550](https://github.com/AIClarityAU/minspec/issues/550).
