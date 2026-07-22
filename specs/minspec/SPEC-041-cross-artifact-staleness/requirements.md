---
id: SPEC-041
type: requirements
# 🔒 Once approved, hash-locked: approved bytes recorded in .minspec/approvals.json[SPEC-041].specHash. ANY edit voids approval (hash → stale) — re-run "MinSpec: Approve Spec". DR-012.
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — approval validity
aspects: [approval, staleness, tier-0, hitl, never-wrong]
depends_on: [SPEC-022, SPEC-012]
relates_to: [SPEC-029, DR-062, DR-034, DR-012]
phases:
  specify: done
  clarify: done   # FR-OQ1/OQ2 resolved (proposed defaults), OQ3/OQ4 confirmed — drafted by Claude (agent) 2026-07-17 per maintainer "you draft"; human ratifies at Approve
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Cross-artifact approval staleness (Requirements)

> Traces to **[DR-062](../../../docs/decisions/DR-062.md)** (accepted) — *approval validity becomes graph-aware*. This spec carries DR-062 **§1 (upstream fingerprints + `upstream-stale`)** and **§2 (ADR/epic hash-locked records)**. DR-062 **§3 (commit/CI actor-agnostic implement-gate)** and **§6 (section/paragraph anchors)** are deliberately **separate follow-on specs** to keep this one's blast radius at T3. Legs B (code↔spec, [#643](https://github.com/AIClarityAU/minspec/issues/643)) and C (corpus sweep, [#804](https://github.com/AIClarityAU/minspec/issues/804)) are out of scope.

## One-Sentence Scope

Make an approved approvable read `approved` **only while the upstream content it was signed off against is unchanged** — by snapshotting each `depends_on` target's canonical hash into the approval record at approve time, deriving a new `upstream-stale` state on read, giving ADRs and epics the same hash-locked records specs already have, and surfacing affected dependents to the human (reverse index + non-modal toast + one-key re-ack) — all deterministic, offline, and **without ever mutating a committed sign-off**.

## Context

Established by the DR-062 audit, with `file:line` evidence:

- **Approval validity is per-artifact-content only.** A spec's approval binds a canonical hash of *its own* content ([approval.ts:306-313](../../../packages/minspec/src/lib/approval.ts#L306)). `depends_on`/`relates_to`/`supersedes` edges are walked **only** for corruption detection and priority ordering ([next-task.ts:262-395](../../../packages/shared/src/next-task.ts#L262)) — never as an input to approval validity. So when an upstream approvable changes, the dependent stays `approved`, signed off against content that no longer exists. The one incidental effect (editing A re-floors an *advancing* dependent B) leaves B's record untouched and lets B silently re-clear the instant A is re-approved.
- **Two divergent approval mechanisms.** Specs get a committed, attributed, hash-locked sidecar ([DR-034](../../../docs/decisions/DR-034.md)); ADRs/epics get a one-way frontmatter status flip with **no record, no hash, no staleness** ([adr-manager.ts:381-411](../../../packages/minspec/src/lib/adr-manager.ts#L381), [epic-manager.ts:305-323](../../../packages/minspec/src/lib/epic-manager.ts#L305)). Since **DR targets dominate `depends_on`**, most real dependencies carry nothing to fingerprint — so ADR/epic records are a **prerequisite** here, not a follow-up.
- **The staleness UX already exists for the self case.** [SPEC-029](../SPEC-029-approval-staleness-ux/requirements.md) ships the "Needs Re-Approval" group + a what-changed diff against a per-spec baseline — but both are **self-scoped**. This spec lifts that surface to the graph.

**Core gap (one sentence):** dependency edges carry no content fingerprint and no reverse index, so an upstream edit can never invalidate the downstream approvals signed off against its *old* content — "approved" silently lies the moment an upstream artifact drifts.

## Design spine (never-wrong)

Staleness is **DERIVED on read, never an event that mutates a committed sign-off.** The human who approves B snapshots *what B was approved against*; drift is computed on read — the exact lazy model already used for self-staleness ([resolveStatus](../../../packages/minspec/src/lib/approval.ts#L306)), lifted to the graph. Auto-rewriting a dependent's attributed record on an upstream edit would forge a human decision (violates the never-wrong invariant and [DR-062](../../../docs/decisions/DR-062.md) §4). Hash drift is a **fact**; whether it **matters** is a human judgment (FR-7).

## Functional Requirements

- **FR-1 (upstream fingerprints).** The approval record gains an optional `upstreamDeps: [{ ref, hash }]`. At approve time the tool snapshots the current canonical hash (reuse [canonical.ts](../../../packages/shared/src/canonical.ts) — EOL-normalized, link-collapsed, lifecycle-stripped) of every `depends_on` target. Absent ⇒ today's behaviour (backward-compatible). Written **once, by the human approving that artifact**; never mutated by an upstream edit.
- **FR-2 (ADR/epic records).** Accepting an ADR or epic mints a committed, attributed, canonical-hash-locked record in the same path-keyed store as specs (extend [DR-034](../../../docs/decisions/DR-034.md)'s store to all three approvable kinds). Editing an accepted DR/epic derives `stale`, symmetric with specs; a tool-driven status flip does **not**. Prerequisite of FR-1's propagation (DR targets dominate).
- **FR-3 (`upstream-stale` derived state).** `resolveStatus` gains a second dimension: an artifact is `upstream-stale` when any recorded `upstreamDeps[i].hash` ≠ the target's current canonical hash. Distinct from self-`stale` (own content drift); both mean "needs re-approval" but are UI-distinguishable. Pure function of `(record, current graph)` — no LLM, no network.
- **FR-4 (propagation reuses existing machinery).** `upstream-stale` joins the resolver's `gateCleared`-false set ([next-task.ts:216-229](../../../packages/shared/src/next-task.ts#L216)) alongside `unapproved`/`stale`, so an `upstream-stale` B floors its dependents and an *advancing* `upstream-stale` B becomes a gate-violation exactly like `implementing-unapproved`. **No new DAG edge type** (projection onto the existing `depends_on` set).
- **FR-5 (reverse-dependency index).** A new pure function keyed by `edge.to` (the missing inverse of the current forward blockers map) answers "which approved artifacts recorded a now-stale hash for X" given an edit to X.
- **FR-6 (surfacing — extends SPEC-029).** On the debounced save-recompute ([extension.ts:197,205](../../../packages/minspec/src/extension.ts#L197)), affected approved dependents surface via a **non-modal toast** over the visible artifact (never focus-stealing, per the HITL-UX rule) — *"DR-019 changed — N approved artifacts depend on it. **Alt+R** to review."* — opening a "Needs Re-Approval — upstream changed" group (extend [SPEC-029](../SPEC-029-approval-staleness-ux/requirements.md)'s group), each entry showing a whole-doc diff of the changed upstream vs the approved-against hash.
- **FR-7 (one-key human re-ack).** **Alt+A** on a dependent = "immaterial" → re-snapshot that upstream hash to current, clearing `upstream-stale`; an attributed human ack committed via the existing commit-on-approve path. The tool **never** LLM-judges materiality and **never** auto-acks. Alternatively the human edits to accommodate, then approves normally.
- **FR-8 (migration).** Existing accepted ADRs/epics are backfilled with a record (`migrated: true`), mirroring the FR-5 spec backfill of [DR-034](../../../docs/decisions/DR-034.md)/SPEC-022. No accepted decision is left recordless.

## Invariants

- **INV-1 (derived, never mutating a sign-off).** The staleness recompute performs **zero writes** to any approval record. `upstreamDeps` hashes are written once, by the human approving that artifact. A background rewrite of an attributed record is forbidden (never-wrong; [no-self-approval-under-borrowed-identity]).
- **INV-2 (deterministic, Tier-0).** `upstream-stale` is a pure function of `(record.upstreamDeps, current canonical hashes)`. No LLM, no network reachable from the resolve/derive path. Same inputs → same verdict.
- **INV-3 (attributed human ack).** Clearing `upstream-stale` (FR-7) writes an attributed, committed record via commit-on-approve; no automated path clears it.
- **INV-4 (one hash primitive).** ADR/epic records use the **same** canonical-hash primitive as specs — tool status/phase flips don't void; content edits do.
- **INV-5 (offline).** All staleness computation is pure filesystem + frontmatter (constitution invariant: core works offline, no network).

## Vertical slices (thinnest-first; ordering is load-bearing)

1. **Slice 1 — ADR/epic hash-locked records (FR-2, FR-8).** Extend the record store + acceptance path to all three kinds; backfill accepted ADRs/epics. Delivers immediate value (editing an accepted DR/epic now derives `stale`) and is the **prerequisite** for Slice 2 (DR targets dominate `depends_on`; without records they carry no hash — Slice 2 would fire on almost nothing).
2. **Slice 2 — `upstreamDeps` + `upstream-stale` (FR-1, FR-3, FR-4).** Snapshot on approve; derive on read; wire into `gateCleared` so propagation cascades through existing flooring.
3. **Slice 3 — reverse index + HITL (FR-5, FR-6, FR-7).** The "who depends on X" query, the toast, the Alt-R group (extending SPEC-029), and the Alt-A re-ack.

## Out of scope (tracked elsewhere)

- **Commit/CI actor-agnostic implement-gate** (DR-062 §3, [#861](https://github.com/AIClarityAU/minspec/issues/861)) — a *separate* follow-on spec; it reads these records to block non-CC/CI edits to an unapproved-or-stale approvable's impl code.
- **Section/paragraph anchors** (DR-062 §6, [#862](https://github.com/AIClarityAU/minspec/issues/862)) — later refinement; whole-doc fingerprints ship first. Hand-authored anchors rot like every optional edge; defer to an auto-derived scheme anchored on SPEC-012 R2.
- **Trustworthy edges** — [#803](https://github.com/AIClarityAU/minspec/issues/803) (symmetric prose-link linter + edge provenance) is the **precondition** for *trusting* bulk-approved `depends_on` edges (see R1); this spec builds on the existing edge set and does not re-implement the linter.
- Legs B ([#643](https://github.com/AIClarityAU/minspec/issues/643)) and C ([#804](https://github.com/AIClarityAU/minspec/issues/804)).

## Open Questions

- **FR-OQ1 (dirty upstream at approve time).** When B `depends_on` A and A is itself `unapproved`/`stale`/`upstream-stale` at B's approve time, which hash does FR-1 snapshot? *Proposed:* snapshot A's current canonical hash regardless — drift is measured from that snapshot; `upstream-stale` fires only if A's content later changes. (Alternative: block B's approval until A is clean — rejected as over-coupling.) Resolve in Clarify.
- **FR-OQ2 (which edge kinds fingerprint).** `depends_on` only, or also `relates_to`/`supersedes`? *Proposed:* `depends_on` only (blocking edges); `relates_to` is advisory and must not produce a re-approval demand. Resolve in Clarify.
- **FR-OQ3 (baseline portability).** Confirm `upstreamDeps` hashes live in the committed sidecar (portable across clones), unlike the per-machine body baseline (`refs/minspec/snapshots/*`). *Proposed:* yes — hashes are small and belong in the committed record.
- **FR-OQ4 (scope of the demand).** Does `upstream-stale` affect only the derived status + resolver + UI here, or also gate commits? *Proposed:* only status/resolver/UI in this spec; the commit/CI gate is DR-062 §3's separate spec.

## Clarify

*Resolutions drafted by Claude (agent) 2026-07-17 as engineering defaults, per the maintainer's "you draft" instruction. Each is the proposed default from Open Questions, chosen with rationale. **These are confirm-or-redirect drafts — the human ratifies them at Approve Spec** (the hash-lock gate); nothing here is a human sign-off.*

- **FR-OQ1 — dirty upstream at approve time → RESOLVED: snapshot the target's current canonical hash regardless of the target's approval state; do NOT block B's approval.**
  The fingerprint measures *drift from the content B's approver actually saw*, which is well-defined whatever A's status is. Blocking B until every upstream is clean over-couples the graph (mutual-dependency deadlock; perpetual-churn starvation). And an unapproved upstream A is *already* surfaced independently — A is not `gateCleared`, so the resolver already floors B / raises a gate-violation via the existing `depends_on` path (FR-4). No second mechanism needed.

- **FR-OQ2 — which edge kinds fingerprint → RESOLVED: `depends_on` only.**
  `depends_on` is the blocking, semantic-dependency edge. `relates_to` is advisory (tie-clustering only, never gates); emitting a re-approval demand from a `relates_to` edit would break its advisory contract and generate noise. `supersedes` is a pruning edge — the target is being *replaced*, so its content drift is irrelevant. A genuine content dependency must therefore be authored as `depends_on` (which [#803](https://github.com/AIClarityAU/minspec/issues/803)'s symmetric linter helps enforce), not smuggled through `relates_to`.

- **FR-OQ3 — baseline portability → CONFIRMED: `upstreamDeps` (ref + hash) lives in the committed, path-keyed sidecar.**
  It travels with the repo — a fresh clone, CI, or a teammate all compute the identical `upstream-stale` verdict. Unlike the per-machine body baseline (`refs/minspec/snapshots/*`, un-pushed), the hashes are small strings and belong in the committed record. This is what makes `upstream-stale` a *portable, CI-checkable* fact — a precondition for the future commit/CI gate ([#861](https://github.com/AIClarityAU/minspec/issues/861)). Promoted from open question to stated design fact.

- **FR-OQ4 — scope of the demand → CONFIRMED: in SPEC-041, `upstream-stale` affects only derived status + resolver ordering + signpost/UI (advisory). It does NOT block commits.**
  The hard gate that blocks impl edits when an approvable is `upstream-stale` is DR-062 §3 / [#861](https://github.com/AIClarityAU/minspec/issues/861) — a separate spec with its own review. Keeping SPEC-041 advisory matches the never-wrong posture (surface the fact; the human decides) and avoids coupling a schema + propagation change to a new enforcement gate in one spec.

No follow-up tasks generated — all four resolve to a stated default; none blocks the Plan phase. FR-OQ1's optional `refState` field (record the target's derived status at snapshot time, to enrich the diff UI) is noted as a Plan-phase nice-to-have, not a requirement.

## Acceptance Criteria

- **AC-1 (FR-2).** Accepting a DR mints a path-keyed sidecar carrying a canonical hash; editing the DR body then derives `stale`; a tool status-flip (proposed→accepted or a phase change) does **not** void it. Same for an epic.
- **AC-2 (FR-1, FR-3).** Approving B snapshots each `depends_on` target's canonical hash into `record.upstreamDeps`; editing an upstream A flips B to `upstream-stale` (not self-`stale`); B's own sidecar bytes are byte-identical before and after (INV-1).
- **AC-3 (FR-4).** An `upstream-stale` B floors its pending dependents and escalates an *advancing* dependent to a gate-violation, using the existing flooring code (no new edge type).
- **AC-4 (FR-5).** Given an edit to X, the reverse index returns exactly the set of approved artifacts whose recorded hash for X no longer matches — no more, no fewer.
- **AC-5 (FR-7, INV-3).** Alt-A re-ack clears `upstream-stale` by re-snapshotting to current, writes an attributed record, and commits it via commit-on-approve; a test asserts no background/automated path ever clears it.
- **AC-6 (INV-1, INV-2, INV-5).** A test asserts the staleness recompute performs zero writes to any approval sidecar and that no network/LLM call is reachable from the derive/resolve path; byte-identical verdict across N runs on a fixed fixture.
- **AC-7 (FR-8).** Migration backfills a record with `migrated: true` for every already-accepted ADR and epic; none is left recordless.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | **Bulk-approved false `depends_on` edge → spurious `upstream-stale`.** LLM-suggested edges are human-bulk-approved (SPEC-012 R2 / DR-019); a plausible-but-wrong edge would raise a false re-approval demand. | Precondition [#803](https://github.com/AIClarityAU/minspec/issues/803) (symmetric prose-link linter catches edge-without-prose + edge provenance). Blast radius is small — ordering + one Alt-A keystroke, never data loss. |
| R2 | **Slice mis-order fires on nothing.** DR targets dominate `depends_on`; Slice 2 before Slice 1 (ADR/epic records) would exercise almost no real edges. | Slice 1 (ADR/epic records) **must** precede Slice 2 — encoded as a sequencing invariant in the plan. |
| R3 | **Staleness fatigue.** A high-churn upstream (e.g. a frequently-edited DR) re-stales many dependents. | `upstream-stale` is advisory (signpost + toast), not a hard block here; Alt-A is one key; the commit/CI gate that *would* block is a separate, later spec. |

## Traceability

- **Decision:** [DR-062](../../../docs/decisions/DR-062.md) (this spec is the contract that decision's §1+§2 govern).
- **Depends on:** [SPEC-022](../SPEC-022-approval-foundation/requirements.md) (record store), [SPEC-012](../SPEC-012-next-task-resolver/requirements.md) (resolver / `gateCleared` / flooring).
- **Extends:** [SPEC-029](../SPEC-029-approval-staleness-ux/requirements.md) (self-staleness UX → graph).
- **Precondition issue:** [#803](https://github.com/AIClarityAU/minspec/issues/803). **Siblings:** [#643](https://github.com/AIClarityAU/minspec/issues/643) (leg B), [#804](https://github.com/AIClarityAU/minspec/issues/804) (leg C).
