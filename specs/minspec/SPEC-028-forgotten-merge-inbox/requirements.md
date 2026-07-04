---
id: SPEC-028
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-009  # Team Readiness — concurrent multi-session coordination
relates_to: [SPEC-024, SPEC-026, SPEC-027, DR-051]  # done-ness/mergeability signal (SPEC-024) · presence (SPEC-026) · inter-session comms (SPEC-027) · session-coordination decision (DR-051)
---

# MinSpec — Forgotten-Merge Inbox (Requirements)

**Date:** 2026-07-02
**Status:** Specifying (SDD Specify phase)
**Triggered by:** [#276](https://github.com/harvest316/minspec/issues/276) — "some devs (such as myself) tend to forget that they have other pending branches to merge."
**Epic:** [EPIC-009 Team Readiness](../../../docs/epics/EPIC-009-team-readiness.md)

> ⚠️ **Outward-facing.** The bulk action in this spec **pushes `main`**. That places it
> in the same never-wrong / hard-to-reverse tier as [SPEC-024](../SPEC-024-auto-merge-eligibility/requirements.md).
> "Transparent" is a promise to **surface**, never a licence to merge silently. See INV-3.

## Context

MinSpec's existing branch work is all **cleanup of branches the dev already dealt with**:

- [#168](https://github.com/harvest316/minspec/issues/168) — worktree-per-session corruption guardrail.
- [#272](https://github.com/harvest316/minspec/issues/272) — detect orphaned **worktrees** (session↔worktree map).
- [#177](https://github.com/harvest316/minspec/issues/177) — prune **merged** worktrees/branches.

**None discovers unmerged branches the dev forgot**, and none considers **bot- or
remote-authored sources** (dependabot, renovate, a collaborator's pushed branch) that
live only on `origin/*` and were never checked out — invisible to every local- or
worktree-based scan. That is the gap this spec fills: a **forgotten-merge inbox**, which
is *discovery + triage of unmerged work*, not branch cleanup.

The done-ness / auto-merge half overlaps existing machinery, but that machinery targets
MinSpec's **own auto-built PR branches**, not arbitrary external ones:

- [SPEC-024](../SPEC-024-auto-merge-eligibility/requirements.md) / [#199](https://github.com/harvest316/minspec/issues/199) — auto-merge eligibility gate (the done-ness **consumer** this spec reuses).
- [#181](https://github.com/harvest316/minspec/issues/181) — keep PR branches mergeable as base advances.
- [#183](https://github.com/harvest316/minspec/issues/183) / [#229](https://github.com/harvest316/minspec/issues/229) — per-dev HITL gate-placement + auto-merge-on-clean default.

**The new part** = discovery + source-classification + done-ness assessment across **all**
branches including origin-only. The merge-execution part **delegates** to SPEC-024's
eligibility gate — this spec does not re-implement mergeability.

## Non-Goals (Out of Scope)

- **Branch cleanup / pruning** — owned by #177 / #272. This inbox surfaces *unmerged* work; deleting *merged* leftovers is a separate concern.
- **Re-implementing mergeability / CI-green computation** — reused from SPEC-024. This spec is the *discoverer + presenter*, not a second merge engine.
- **Rewriting history / rebasing forgotten branches** — surfacing only; any conflict resolution is HITL, out of the auto path.
- **Cross-remote discovery** beyond the repo's own `origin` in v1 (forks, secondary remotes) — parked as an open question.

## The three actors this must model

Done-ness signal **and** risk differ per source; classification is not cosmetic — it gates
what is eligible for the bulk action.

| Source | Detection signal | Typical done-ness | Auto-merge stance |
|---|---|---|---|
| **Bot** (dependabot / renovate) | branch prefix `dependabot/*`, `renovate/*`; author identity | single dep bump, usually CI-green | strongest candidate — but still CI-gated (INV-3) |
| **Human collaborator** | `origin/*` branch not authored by you, PR often open | varies | HITL only in v1 — never in bulk auto |
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
presence), is annotated as "in flight", not "forgotten" — the inbox is for genuinely
dormant work.

### Done-ness assessment (FR-5..7)

**FR-5 — Done-ness signal set.** For each candidate compute: ahead/behind base · PR open? ·
mergeable (no conflicts) · CI status (green/red/none) · age since last commit. This is the
**same signal set as SPEC-024**; this spec MUST consume SPEC-024's computation, not fork it.

**FR-6 — Done-ness verdict.** A deterministic rollup → { ready · needs-attention ·
stale/behind · conflicted }. `ready` requires: no conflicts **and** (CI green **or** no CI
configured) **and** not behind base by unmerged base commits that would silently drop.

**FR-7 — Dependabot fast-path.** A `dependabot/*` branch that is a single dep bump, ahead-only,
mergeable, CI-green → the canonical `ready` example and the strongest bulk-auto candidate —
but still subject to INV-3 (surfaced + CI-gated, never silent).

### Actions (FR-8..10) — two stakes, two gates

**FR-8 — Single-merge (cheap).** Merge one branch = a HITL toast over that branch's diff
summary (reuses existing approval UX). Low blast radius; one branch, visible, reversible-ish.

**FR-9 — "Merge all clean" (outward-facing, hard to reverse).** Bulk-merge every `ready`
candidate pushes `main`. This MUST:
- gate per the per-dev consequence-hybrid model (#183) — **never silent**;
- present the full manifest of what will merge (branch, source, done-ness, CI) **before** acting;
- delegate each individual merge's eligibility to SPEC-024's gate (no bypass);
- emit an **after-action audit record** of exactly what merged (auditable invariant), so a
  green-but-breaking bump is traceable.

**FR-10 — Future "auto in future" opt-in.** The user's "auto-merge all transparently in
future" is an **opt-in standing policy**, not a default. When armed, each run still produces
the FR-9 manifest + audit record; arming it does not remove the surface, only the per-run
prompt. Default = **off**.

### Surface (FR-11)

**FR-11 — Inbox surface + keyboard path.** The forgotten-merge inbox is a list surface
(candidate · source · done-ness · action). Per the global keyboard-over-mouse preference,
the frequent actions (open next candidate, single-merge, dismiss) MUST each have a two-key
path; rare bulk-arm may be menu-only.

## Invariants (T0 — tests before implementation)

- **INV-1 — Discovery is complete or honestly-partial.** Either `origin/*` was fetched and
  enumerated, or the result is explicitly labelled stale/partial. Never present a
  local-only scan as the full picture. (Root of the whole issue: forgotten = invisible.)
- **INV-2 — Classification + done-ness are Tier-0 pure functions.** No network, no LLM, no
  clock-nondeterminism in the verdict; identical inputs → identical verdict (testable,
  mirrors SPEC-024 predicate parity).
- **INV-3 — Transparent ≠ silent.** No branch reaches `main` via the bulk path without (a) a
  pre-action manifest, (b) a CI-green (or no-CI) minimum, and (c) an after-action audit
  record. A green dependabot bump can still break the build; the never-wrong/auditable
  invariant forbids merging without surfacing.
- **INV-4 — No new merge engine.** Merge eligibility is decided by SPEC-024's gate; this
  spec never introduces a second, divergent mergeability judgement (single source of truth).
- **INV-5 — Read-only until an explicit action.** Discovery + assessment mutate nothing
  (only `git fetch`). No branch is merged, deleted, or rebased as a side effect of *viewing*
  the inbox.

## Acceptance Criteria

1. A dependabot branch pushed only to `origin/*`, never checked out locally, **appears** in the inbox classified `bot / ready`.
2. A half-finished local branch behind base appears classified `your-own / stale` with a behind-warning, and is **excluded** from `ready`.
3. Offline (fetch fails) → inbox renders from cache **labelled stale**, and the bulk action is disabled or warns.
4. "Merge all clean" shows a manifest, refuses any branch SPEC-024's gate rejects, and writes an audit record naming every merged branch.
5. Classification + done-ness verdict functions pass unit tests with fixture branches for all three sources (no network in the test).
6. Viewing the inbox produces zero repo mutations beyond `git fetch` (INV-5 test).

## Open Questions (Clarify phase)

- **OQ-1 — Auto-arm scope.** Does "auto in future" (FR-10) apply per-repo, per-source (e.g. dependabot-only auto), or global? Default-off is settled; the granularity is not.
- **OQ-2 — Secondary remotes / forks.** v1 = `origin` only. Is collaborator-fork discovery in scope, or a follow-up?
- **OQ-3 — Human-collaborator bulk.** Should human-authored branches ever be bulk-auto-eligible, or forever HITL-only? (Leaning HITL-only — different consent than a bot bump.)
- **OQ-4 — Surface home.** Standalone inbox view vs a section of the signpost (SPEC-012 next-task) vs the presence surface (SPEC-026). Affects keyboard-path design (FR-11).
- **OQ-5 — Tier.** T4 asserted here for the main-pushing bulk action; the discovery-only core may warrant T3. Confirm at Clarify.

## Traceability

- **Issue:** [#276](https://github.com/harvest316/minspec/issues/276) (this spec materialises it).
- **Reuses:** [SPEC-024](../SPEC-024-auto-merge-eligibility/requirements.md) (eligibility/done-ness), [DR-033](../../../docs/decisions/DR-033.md) (auto-build gate placement).
- **Coordinates with:** [SPEC-026](../SPEC-026-session-presence/requirements.md) (presence — "in flight" annotation), [SPEC-027](../SPEC-027-inter-session-comms/requirements.md), [DR-051](../../../docs/decisions/DR-051.md).
- **Distinct from (not cleanup):** #168, #272, #177.
- **Follow-ups (tracked):** OQ-2 (fork discovery) and OQ-3 (human-collaborator bulk policy) become issues at Clarify if deferred; `None` otherwise.
