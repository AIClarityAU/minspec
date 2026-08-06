---
id: SPEC-052
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — an approved-but-unbuilt spec must not read 'implementing'
aspects: [lifecycle, status, signpost, never-wrong, tier-0, validator]
relates_to: [DR-069, DR-034, DR-003, DR-012, DR-031, SPEC-022, SPEC-041, SPEC-038]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — The `planning` lifecycle status: approved-but-pre-implementation is not `implementing` (Requirements)

> Traces to **[DR-069](../../../docs/decisions/DR-069.md)** — *accepted 2026-07-24* — which
> makes the whole status-model decision this spec contracts. Triggered by
> **[#886](https://github.com/AIClarityAU/minspec/issues/886)** (the false-signpost bug),
> surfaced by PR [#879](https://github.com/AIClarityAU/minspec/pull/879) / SPEC-040 and latent
> for [SPEC-041](../SPEC-041-cross-artifact-staleness/requirements.md).

## Implementation status — read this first (evidence discipline, DR-003)

**This is a back-fill requirements spec: the behaviour below is ALREADY SHIPPED on `main`
under DR-069.** It exists because the fix went DR + code and never got a formal SDD
requirements artifact; SPEC-022's FR-4 table and DR-069 both reference #886 with no spec to
point at. Writing the requirements down now (a) gives the shipped behaviour a testable
contract and (b) is the vehicle for the **one genuinely-open decision** — the deterministic
gate and the phaseless-spec residual — under *Decisions needed (Clarify)*.

Per DR-003, the "shipped" claims are cited to code, not to prose:

| Requirement | Shipped at |
|---|---|
| fifth status `planning` in the closed enum | [`spec.ts:16`](../../../packages/minspec/src/lib/spec.ts#L16) (`SPEC_STATUSES`) |
| approved + pre-implement derives `planning`, not `implementing` | [`lifecycle.ts:119-120`](../../../packages/minspec/src/lib/lifecycle.ts#L119); rules table at [`:102`](../../../packages/minspec/src/lib/lifecycle.ts#L102) |
| `planning` → resolver `implementing` (behaviour-neutral next-task) | [`artifact-graph.ts:71`](../../../packages/minspec/src/lib/artifact-graph.ts#L71) |
| approval writer stamps `planning` (no mirror-drift) | [`spec.ts:588-593`](../../../packages/minspec/src/lib/spec.ts#L588) |
| lifecycle rank `…specifying < planning < implementing < done` | [`spec-validator.ts:1157`](../../../packages/minspec/src/lib/spec-validator.ts#L1157) |
| body↔frontmatter parity vocabulary | [`status-parity.ts:52`](../../../packages/minspec/src/lib/status-parity.ts#L52) |
| active-spec treats `planning` as in-flight | [`active-spec.ts:53`](../../../packages/minspec/src/lib/active-spec.ts#L53) |
| corpus migration of approved-pre-implement specs | [#898](https://github.com/AIClarityAU/minspec/issues/898) → [#1047](https://github.com/AIClarityAU/minspec/pull/1047), [#1072](https://github.com/AIClarityAU/minspec/pull/1072) |

Because this spec is unapproved, its **own** lifecycle status is `specifying` (INV-1); that is a
fact about *this artifact*, not a claim that the feature is unbuilt. To avoid re-asserting
ownership of files already owned by SPEC-022 (SPEC-038), this spec deliberately declares no
`implements:`/`affects:` — ownership is unchanged; the citations above are evidence, not a
claim.

## One-Sentence Scope

Give MinSpec a fifth lifecycle status, `planning` — "approved; in Plan/Tasks; the implement
phase has not started" — so that `deriveStatus` returns `implementing` **only** once the
implement phase is actually active, and an approved-but-unbuilt spec reads `planning` (honest)
instead of `implementing` (a DR-003 false signpost) — **without** narrowing the phase-position
freeze-gate twins that keep unapproved plan/tasks specs in the freeze range (DR-012).

## Context — the bug and its mechanism (RCDD)

Before DR-069, [`deriveStatus`](../../../packages/minspec/src/lib/lifecycle.ts#L108) collapsed
every approved-but-not-all-done spec to `implementing`:

```
if (approvalState !== 'approved') return 'specifying';  // INV-1: unapproved cannot pass
if (allRequiredDone(phases))      return 'done';
return 'implementing';                                   // approved + ANY incomplete phase
```

- **Mechanism.** Approval sets the first build-band phase (`plan`) to `in-progress`
  (`phasesForApproval`), so a spec approved while still at **Plan/Tasks — implement pending,
  zero code** derived `implementing`. The signpost claimed code was being written when none
  existed — the project's stated worst defect ([DR-003](../../../docs/decisions/DR-003.md)).
- **The code was broader than its own documented rule.** The FR-4 comment said "approved +
  **implement** in progress → implementing"; the code fired on `plan`/`tasks` too.
- **No vocabulary for "approved, not yet building."** Between `specifying` (= *unapproved*,
  INV-1 — it cannot be reused) and `implementing` (should mean *code being written*) there was
  no status for the interval in between.
- **Missing gate.** The deterministic literal-vs-derived parity check could not catch it —
  literal `implementing` == derived `implementing`. Only the AI-review panel caught the
  semantic falseness (#879).
- **The trap that keeps re-triggering it.** [#829](https://github.com/AIClarityAU/minspec/issues/829)/SPEC-038
  requires `implements:` past Clarify; `implements:` is inside the canonical hash, so adding it
  **stales** the prior approval; re-approving mid-Plan re-flips to the false `implementing`.
  SPEC-040 hit this (#879); SPEC-041 nearly did.

## Functional Requirements

- **FR-1 (fifth status).** `SpecStatus` gains `planning`, positioned in the closed enum between
  `specifying` and `implementing`. It means exactly: *approved; a Plan or Tasks phase is
  in-progress; the implement phase has not started.*
- **FR-2 (narrowed derivation).** `deriveStatus(phases, approval, terminal)` returns
  `implementing` **only** when `phases.implement` is `in-progress` or `done`. An approved spec
  whose implement phase is still `pending` (i.e. it is in Plan/Tasks) derives `planning`.
  Ordering of the guards is fixed: explicit terminal → `new` (all pending) → `specifying`
  (unapproved, INV-1) → `done` (all done) → `implementing` (implement started) → `planning`.
- **FR-3 (behaviour-neutral resolver mapping).** The next-task resolver keys on its own
  `ResolverSpecStatus`; `planning` maps to the resolver's `implementing` via `SPEC_STATUS_MAP`
  (`satisfies Record<SpecStatus, ResolverSpecStatus>`, compile-forced). Consequence: every
  resolver seam (answer-OQ surfacing, `isAdvancing`, spec-ahead-of-epic, flooring, gate
  violations) sees an approved-planning spec **exactly as before** — zero change to next-task
  behaviour, zero risk of dropping an open-question node or a gate violation. `planning` is
  confined to the human/UI/validator surface.
- **FR-4 (literal writer moves in lockstep).** The approval path writes the literal `status:`
  line from the approval-aware `deriveStatus`, not the phases-only `getSpecStatus`, so a
  freshly-approved pre-implement spec is stamped `status: planning` and produces **no**
  `status.mirror-drift` finding.
- **FR-5 (rank + vocabulary wiring).** `planning` is threaded through every enum-driven site:
  `SPEC_STATUSES`; `SPEC_STATUS_MAP`; `LIFECYCLE_RANK` (`specifying < planning < implementing`,
  pinned by monotonicity tests); `SPEC_STATUS_WORDS`; the body↔frontmatter parity vocabulary
  (`status-parity.ts`); active-spec detection; frontmatter-completion; `statusIcon`; and a new
  **Planning** tree lane.
- **FR-6 (SPEC_DONE_OK unchanged).** The "SPEC-X implemented/done" prose-claim allow-set stays
  `{implementing, done}` — a "done/implemented" claim against a `planning` spec correctly WARNs.
- **FR-7 (corpus migration).** Every already-approved-pre-implement spec is migrated from a
  stale literal `status: implementing` to `status: planning`, done deliberately (not as a
  hash-staling side effect). Tracked and delivered under #898 / #1047 / #1072.

## Invariants (must not be broken)

- **INV-1 (unapproved ⇒ specifying).** An unapproved spec derives `specifying` regardless of
  phase. `planning` requires an `approved` verdict. `specifying` is never overloaded to mean
  "approved, pre-implement."
- **INV-2 (explicit terminal wins).** `archived`/`superseded` are human acts, decided before
  any phase/approval derivation (INV-6 of SPEC-022). `planning` never displaces a terminal.
- **INV-3 (DO NOT narrow the freeze-gate twins — DR-012/DR-031).** The three phase-position
  twins — `getSpecStatus`, `phaseIntentStatus` (migrate-approvals), and `phase_intent_status`
  ([`spec-gate.py`](../../../scripts/hooks/spec-gate.py)) — **MUST** keep *any* current phase in
  {plan, tasks, implement} in the `implementing` band. The `planning` split lives **only** in
  `deriveStatus` (the signpost). Narrowing a twin to return `planning` for plan/tasks would drop
  unapproved plan/tasks specs out of the freeze range, making their impl code editable and
  silently reopening the freeze hole DR-012/DR-031 close. Each twin carries a forbidding comment;
  there is currently **no parity test** binding them (see Decisions D2 / #899).
- **INV-4 (Tier-0, offline, deterministic).** `deriveStatus` is a pure function of
  `(phases, approvalState, terminal)` — no filesystem, no network, no LLM. Same inputs → same
  status.
- **INV-5 (never a false signpost — DR-003).** No derived status may claim more progress than
  the phases + approval evidence support. `implementing` asserts the implement phase is active;
  `done` asserts every required phase is complete.

## Decisions needed (Clarify)

These are the parts DR-069 left open. Each is a real trade-off; none should be guessed.

- **D1 — Should `implementing ⟺ implement-phase-active` become a *deterministic, merge-gating*
  assertion (the issue's Option 3)?**
  DR-069 fixed the **derivation** (`deriveStatus` can no longer *produce* a false
  `implementing`), and the body↔frontmatter parity check would flag a hand-written literal
  `status: implementing` on a plan/tasks spec — **but only as a non-fatal WARN, never CI-gating**
  ([`status-parity.ts:41`](../../../packages/minspec/src/lib/status-parity.ts#L41)). So a
  producer that writes `implementing` directly (a script, a manual edit, a future code path) is
  caught by the model/human, not by a gate. The issue's root cause explicitly names this:
  *"There is no deterministic gate asserting `implementing` requires the implement phase active."*
  - **Option A — add a merge-gating validator rule** ("a spec whose derived/literal status is
    `implementing` must have `phases.implement ∈ {in-progress, done}`"). *Pro:* the false
    signpost can never re-enter through any producer; aligns with constitution invariant #2
    (no silent gate) and "enforce, don't trust the model." *Con:* one more blocking gate to
    maintain; risk of a false-block if a legitimate producer lags a phase update.
  - **Option B — status quo (corrected derivation + WARN only).** *Pro:* minimal surface; the
    derivation is already correct so the common path can't lie. *Con:* the only backstop against
    a mis-writing producer is the WARN + the AI panel — exactly the "LLM has to catch it"
    situation #886 was filed to remove.
  **Recommendation:** Option A, scoped to a *validator rule* (not a new hook), because the whole
  point of #886 was to stop relying on the panel. Downside to accept: a new blocking check that
  must be conservative enough never to false-block.

- **D2 — Build the freeze-gate-twin parity test now, or keep it as tracked follow-up #899?**
  INV-3 is currently guarded only by hand-written "do not align" comments at each of the three
  twins — a model-trusted rule with no enforcement, i.e. exactly the drift class the constitution
  warns about. [#899](https://github.com/AIClarityAU/minspec/issues/899) tracks the missing
  parity test binding `getSpecStatus` ⇄ `phaseIntentStatus` ⇄ `phase_intent_status`.
  - **Option A — pull #899 into this spec's scope** so the invariant ships with its enforcement.
  - **Option B — leave it as the standalone follow-up** it already is; this spec only records
    INV-3.
  **Recommendation:** Option A — an invariant whose only guard is a prose comment is a latent
  silent-drift hole (INV-3's own failure mode). Downside: widens this spec's blast radius.

- **D3 — The phaseless-spec residual (#957): should a phaseless spec default to `planning` at
  approval, or should approval require a `phases:` block?**
  A spec with **no** `phases:` block has no phase signal, so the approval writer still
  hard-stamps `implementing` ([`spec.ts:583-584`](../../../packages/minspec/src/lib/spec.ts#L583))
  — the one shape where the #886 fix cannot apply, so the false signpost survives there.
  Tracked as [#957](https://github.com/AIClarityAU/minspec/issues/957).
  - **Option A — default phaseless approvals to `planning`.** Honest, but `planning` for a spec
    that may already be mid-implementation could itself under-claim.
  - **Option B — require a `phases:` block before a spec can be approved.** Removes the
    ambiguous shape entirely; costs a small friction at approval and a migration for existing
    phaseless specs.
  **Recommendation:** Option B — eliminate the shape rather than pick a lossy default for it.
  Downside: a one-off migration + a new approval precondition.

## Acceptance Criteria

- **AC-1 (FR-1, FR-2).** `deriveStatus` returns `planning` for `(approved, implement:pending,
  plan|tasks:in-progress)` and `implementing` for `(approved, implement:in-progress|done)`;
  covered by a truth-table test over every `(phase-position × approval)` combination.
- **AC-2 (INV-1).** `deriveStatus` returns `specifying` for every unapproved input, including
  plan/tasks/implement in-progress — no phase position promotes an unapproved spec.
- **AC-3 (FR-3).** `SPEC_STATUS_MAP` maps `planning → implementing`; a test asserts next-task
  output is byte-identical for a spec at `planning` vs the same spec forced to `implementing`
  (behaviour-neutral).
- **AC-4 (FR-4).** Approving a spec whose implement phase is `pending` writes literal
  `status: planning` and produces zero `status.mirror-drift` findings.
- **AC-5 (INV-3).** A test (or, per D2, the #899 parity test) asserts each phase-position twin
  still maps plan/tasks to the `implementing` band — i.e. an unapproved plan/tasks spec remains
  in the freeze range and still blocks its declared impl files.
- **AC-6 (FR-5).** `LIFECYCLE_RANK` monotonicity test asserts `specifying < planning <
  implementing`; the closed-enum exhaustiveness checks (`satisfies Record<SpecStatus, …>`)
  compile with `planning` present at every site.
- **AC-7 (FR-6).** A "SPEC-X implemented" prose claim against a `planning` spec WARNs;
  `SPEC_DONE_OK` remains `{implementing, done}`.
- **AC-8 (FR-7).** No approved-pre-implement spec is left carrying a literal
  `status: implementing` that disagrees with its derived status.

## Traceability

- **Decision:** [DR-069](../../../docs/decisions/DR-069.md) (accepted) — this spec is the
  requirements contract that decision discharges.
- **Triggered by:** [#886](https://github.com/AIClarityAU/minspec/issues/886).
- **Builds on:** [SPEC-022](../SPEC-022-approval-foundation/requirements.md) (the `deriveStatus`
  single-source-of-truth + FR-4 rules table it extends).
- **Interacts with:** [SPEC-038](../SPEC-038-spec-code-ownership/requirements.md) /
  [#829](https://github.com/AIClarityAU/minspec/issues/829) (the `implements:`-past-Clarify
  staling that re-triggers the flip); [SPEC-041](../SPEC-041-cross-artifact-staleness/requirements.md)
  / [DR-062](../../../docs/decisions/DR-062.md) (upstream-stale re-approval interaction).
- **Guards:** [DR-012](../../../docs/decisions/DR-012.md), [DR-031](../../../docs/decisions/DR-031.md)
  (the freeze-gate hole INV-3 must not reopen); [DR-003](../../../docs/decisions/DR-003.md)
  (the false-signpost class this closes).
- **Open follow-ups referenced:** [#899](https://github.com/AIClarityAU/minspec/issues/899)
  (parity test — D2), [#957](https://github.com/AIClarityAU/minspec/issues/957) (phaseless
  residual — D3).
