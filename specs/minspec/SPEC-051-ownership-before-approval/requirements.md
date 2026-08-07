---
id: SPEC-051
type: requirements
# 🔒 Once approved, hash-locked: approved bytes recorded in the per-file sidecar
# .minspec/approvals/specs/minspec/SPEC-051-ownership-before-approval/requirements.md.json (.specHash).
# `status`/`phases` are tool-written lifecycle mirrors (canonical.ts strips them from the hash);
# never hand-write either. Read the sidecar, never this prose, for the current state.
status: planning
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology — the spec→code ownership contract (SPEC-038's sibling)
aspects: [approval, ownership, spec-gate, lifecycle, docs-lane, hitl, tier-0, validation]
relates_to: [SPEC-038, SPEC-022, DR-012, DR-034, DR-069, DR-078, DR-051, DR-003]
# Ownership declared 2026-08-07 to clear a RED `main` (#1323): approving this spec (#1300)
# flipped `phases.plan` to `in-progress`, which armed SPEC-038 FR-3 at `error` and failed
# `npm run validate` corpus-wide, blocking every open PR. The prior note here ("no
# `implements:` yet — this spec is `specifying`") described the pre-approval state and was
# stale the moment approval landed. Adding this field changes the approved bytes and stales
# the human approval (canonical.ts strips only `status`/`phases`) — the exact trap §"Hash
# semantics" below documents, now hit for real. Re-approval is a human act (FR-5): never
# minted by an agent.
implements: none
implements_reason: modifies the existing approve/advance actors (approve.ts, spec.ts) and reuses SPEC-038's `ownership-path-rules` per FR-6; creates no new source file. FR-1 leaves the enforcement mechanism to Clarify/Plan — if Plan chooses a new module, replace this with that path.
affects: [packages/minspec/src/commands/approve.ts, packages/minspec/src/lib/spec.ts, packages/minspec/src/lib/spec-validator.ts, packages/minspec/src/commands/commit-on-approve.ts]  # all owned elsewhere (approve.ts via SPEC-042/SPEC-046 affects:, ownership rules via SPEC-038 implements:) — this spec modifies, never owns
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# MinSpec — Declare code ownership before approval, so advancing into Plan can't strand an uncommittable state (Requirements)

> Materializes **[#874](https://github.com/AIClarityAU/minspec/issues/874)** (role:architect). Filed per RCDD Phase 4 ([DR-003](../../../docs/decisions/DR-003.md)) + fold-faults-into-ext. Sits at the seam between the **spec→code ownership contract** ([SPEC-038](../SPEC-038-spec-code-ownership/requirements.md) / [#460](https://github.com/AIClarityAU/minspec/issues/460)) and the **approval foundation** ([SPEC-022](../SPEC-022-approval-foundation/requirements.md), [DR-012](../../../docs/decisions/DR-012.md) / [DR-034](../../../docs/decisions/DR-034.md)).

## One-Sentence Scope

Approving a T3/T4 spec must never manufacture a state that its own validate/commit gate then rejects: the `implements:` ownership declaration ([SPEC-038](../SPEC-038-spec-code-ownership/requirements.md) FR-3) must be settled **before** the approval hash is minted (never added after, where it stales the human's just-recorded approval), and the act that crosses a spec into the Plan build-band must pre-check that ownership and refuse — loudly and actionably — rather than write a half-committed, gate-illegal state onto the shared working tree.

## Context

Grounded in the current code, with `file:line` evidence. **The issue was filed against the 0.1.x build of 2026-07-22; the mechanism has since moved, and this Context describes the code as it stands today** — the defect is still live, but its shape differs from the issue's original two-step framing, and the spec must fix what exists, not what was.

### The ownership gate fires exactly at the Plan boundary

`validateOwnership` ([spec-validator.ts:780-828](../../../packages/minspec/src/lib/spec-validator.ts#L780)) raises `ownership.implements.missing` when a spec is **primary, tier ≥ T3, and `phases.plan` is `in-progress` or `done`** and it declares neither a real owned path nor the `implements: none` + `implements_reason:` escape. Below that boundary (`plan: pending`) the check returns `[]` — so a pre-Plan spec validates and can be approved with no `implements:` at all.

**In this repo the check is at `error`, not `warn`.** `.minspec/config.json:54` sets `"ownershipDeclaration": "error"` (the SPEC-038 FR-7 ratchet has flipped here), and the severity is `config.ownershipDeclaration === 'error' ? 'error' : 'warning'` ([spec-validator.ts:804](../../../packages/minspec/src/lib/spec-validator.ts#L804)). So a missing `implements:` past the Plan boundary **fails `npm run validate`** — it is a hard block, not an advisory.

### Approval itself crosses that boundary

`approveSpec` flips a pre-implementation spec into the build-band **at approval time**: `advanceSpecToImplementing` runs when `status` is `new`/`specifying` ([approve.ts:257-265](../../../packages/minspec/src/commands/approve.ts#L257)), and it writes `phasesForApproval(...)` which sets `plan → in-progress` (the derived status becomes `planning` per [DR-069](../../../docs/decisions/DR-069.md), [spec.ts:587-593](../../../packages/minspec/src/lib/spec.ts#L587)). So the moment a `specifying` T3/T4 spec is approved, `phases.plan` becomes `in-progress` and `validateOwnership` starts firing at `error`.

> The issue's "Accept the *advance to next stage* popup (Clarify→Plan)" step reflects the older build. Today the Plan flip happens **inside approval**, and the follow-up "Advance to next phase" toast merely enqueues an LLM-free request into the gitignored `.minspec/queue/` ([approve.ts:299-319](../../../packages/minspec/src/commands/approve.ts#L299), [phase-advance-queue.ts](../../../packages/minspec/src/lib/phase-advance-queue.ts)) — it does **not** edit frontmatter. The stranding-into-an-illegal-state defect is therefore now a property of **approval**, and of any future actor that flips `plan → in-progress`.

### The hash makes the only available fix void the approval

The canonical approval hash strips **exactly** `status` and `phases` and keeps every other frontmatter field verbatim as content ([canonical.ts:12-26](../../../packages/shared/src/canonical.ts#L12), `stripLifecycle` at [:60](../../../packages/shared/src/canonical.ts#L60)) — the semantics the issue cites as `approval.ts:6-8`. `implements:` is **content**, not lifecycle. So the only way to satisfy the freshly-armed FR-3 error — adding `implements:` — **changes the approved bytes and stales the human's just-minted approval** (`approved → stale`), and re-approval is a human-only act ([DR-012](../../../docs/decisions/DR-012.md); the forged-sign-off class of [#1025](https://github.com/AIClarityAU/minspec/issues/1025)). The approve step thus produces a state that:

1. its own `npm run validate` rejects (missing `implements:` at `plan:in-progress`, error), and
2. cannot be made gate-legal without voiding the human approval it just recorded.

**This is the core defect (one sentence): the ownership contract is required at a boundary that approval itself crosses, but ownership is authored as post-Clarify content that only becomes editable after approval — and editing it destroys the approval.**

### Defect (a) — the uncommitted write — is mostly, but not provably fully, closed

The issue's defect (a) ("approval sidecar + lifecycle edit written to the shared tree and never committed") has since been addressed for the **approve** path: `commitApprovalIfEnabled` is default-on ([commit-on-approve.ts:14-15](../../../packages/minspec/src/commands/commit-on-approve.ts#L14), SPEC-022 FR-1, [#576](https://github.com/AIClarityAU/minspec/issues/576)) and folds the doc + sidecar into one commit ([approve.ts:277-283](../../../packages/minspec/src/commands/approve.ts#L277)), with the [DR-078](../../../docs/decisions/DR-078.md) `resolveBranchDestination` guard refusing a push-protected-branch strand up front. The phase-advance **queue** write is gitignored, so it strands nothing. What remains **unverified** and in scope for Clarify/Plan: whether every write on the approve→advance path is either committed or fails loud (INV-3), and whether a human who *does* re-author `implements:` after the trap is left with an uncommitted, gate-red working tree.

## Functional Requirements

- **FR-1 (ownership settled before the hash is minted).** The `implements:` ownership declaration (or the `implements: none` + `implements_reason:` escape) for a T3/T4 primary spec MUST be part of the **approved bytes** — present at the moment the approval hash is computed — so that entering the Plan build-band never requires a post-approval content edit. Whether this is enforced by a pre-approval precondition, by moving ownership authoring earlier in the lifecycle, or by both is a **Clarify decision** (see Decisions needed). *Rationale: the only durable fix for a stale-on-advance trap is to bake the contract into what was signed.*

- **FR-2 (pre-check at the Plan-crossing act, refuse rather than strand).** The act that flips a T3/T4 spec's `phases.plan` to `in-progress` — today that is `approveSpec`/`advanceSpecToImplementing`, and any future advance actor — MUST run the SPEC-038 FR-3 ownership check **before** performing the flip. If ownership is undeclared, it MUST refuse the flip and surface an actionable prompt to declare ownership first (while the spec is still pre-Plan, so the declaration lands in the approved hash), instead of writing a `plan:in-progress` state that `validateOwnership` will immediately reject. *Rationale: mirror the validate gate at the transition, not only downstream at commit — the issue's fix #1.*

- **FR-3 (no silent stranded write; atomic-or-loud).** Every write the approve/advance path makes to the shared working tree (lifecycle edit + approval sidecar) MUST be committed via the docs-lane, or surface a loud, actionable error — never left as a silent uncommitted change on the shared tree. The `commitOnApprove` guarantee ([#576](https://github.com/AIClarityAU/minspec/issues/576)) MUST extend to whatever new declare-ownership step FR-1/FR-2 introduce, so the fix cannot itself create a fresh strand. *Rationale: the issue's fix #2; constitution invariant #2 (no silent gate) and the main-divergence/docs-lane stranding class ([#575](https://github.com/AIClarityAU/minspec/issues/575)).*

- **FR-4 (the `none` escape stays reachable pre-approval).** A T3/T4 spec that genuinely owns no code MUST be able to satisfy FR-1 with `implements: none` + `implements_reason:` (SPEC-038 FR-5) **before** approval, so a policy/docs-only spec is never forced to invent a path nor pushed into the trap. *Rationale: keep the requirement satisfiable for the code-less specs SPEC-038 FR-5 exists for.*

- **FR-5 (no new approval author / no borrowed sign-off).** Nothing in this change may mint, re-mint, or refresh a human approval on the human's behalf. If the trap is already-live for an existing approved spec (recovery path), the fix surfaces the needed human re-approval; it never writes `approvedBy` or a sidecar to paper over a staled hash. *Rationale: [DR-012](../../../docs/decisions/DR-012.md), [DR-056](../../../docs/decisions/DR-056.md), the no-borrowed-identity rule ([#1025](https://github.com/AIClarityAU/minspec/issues/1025)).*

- **FR-6 (Tier-0 / offline).** All new checks are pure frontmatter + filesystem validation reusing SPEC-038's `ownership-path-rules`; no network, no LLM, no `vscode`-only logic in the shared validator. *Rationale: constitution invariant #1; SPEC-038 INV-1/INV-3.*

## Acceptance Criteria

- **AC-1 (FR-2).** Approving (or otherwise advancing) a T3/T4 primary spec that has no `implements:` and no valid escape is **refused before** `phases.plan` is flipped; the spec is left at its pre-Plan phase, unstaled, with a prompt naming the fix. Asserted on the persisted frontmatter (plan unchanged) and the absence of an approval sidecar.
- **AC-2 (FR-1).** A T3/T4 spec that declares `implements:` (or `implements: none` + reason) **before** approval approves cleanly, crosses into `plan:in-progress`, and **`npm run validate` is green immediately after** — no post-approval edit is needed and the approval is `approved`, not `stale`.
- **AC-3 (regression — the exact trap).** A test reproduces the SPEC-040 scenario: approve a T3/T4 spec with no `implements:`, then attempt to add `implements:` — and asserts the pre-fix behaviour (approval mints, then `validate` errors, then adding `implements:` stales the hash) FAILS to occur under the fix. This is the red→green negative proof; it must fail on the base and pass on head.
- **AC-4 (FR-4).** A policy/docs-only T3/T4 spec with `implements: none` + `implements_reason:` set pre-approval approves cleanly and validates green at `plan:in-progress`.
- **AC-5 (FR-3, INV-3).** After a successful approve+advance, there is **no** uncommitted lifecycle edit or untracked approval sidecar left on the shared tree; if the commit cannot happen (e.g. protected branch, offline), the user is told loudly and the path does not silently succeed. Asserted on `git status` porcelain in a fixture repo, and on the error surface for the fail path.
- **AC-6 (FR-5).** No path in this change writes `approvedBy`, a `status:` mirror as a human sign-off, or a sidecar that was not produced by the human **MinSpec: Approve Spec** act. Asserted structurally on the recorded writes.
- **AC-7 (FR-2 scope).** A T1/T2 spec, and a non-primary spec, advance/approve with no ownership pre-check (unchanged behaviour) — the new refusal is scoped to T3/T4 primary specs, matching `validateOwnership`'s own gate ([spec-validator.ts:783-785](../../../packages/minspec/src/lib/spec-validator.ts#L783)).
- **AC-8 (FR-6).** The new check imports no `vscode` and makes no network/LLM call; it reuses `isValidOwnedPath`/`isEscapingPath` from `ownership-path-rules` so the pre-check and the validator agree by construction (no second, divergent ownership matcher).

## Invariants

- **INV-1 (no silent gate — constitution #2).** The pre-check must fail **visibly and closed**: an undeclared-ownership advance is refused with an actionable message, never advanced-then-swallowed and never `|| true`'d. A missing/errored ownership signal fails the transition closed.
- **INV-2 (approval integrity — the hash still re-reviews real content).** This spec must NOT weaken the property that editing substantive spec content voids approval. If a Clarify option chooses to exclude `implements:` from the canonical hash (Option B below), that is a change to the [DR-034](../../../docs/decisions/DR-034.md) hashing contract and requires its own DR and explicit human sign-off — it is called out precisely because it trades approval-integrity for convenience and must not be smuggled in.
- **INV-3 (never a silent stranded write — G-8 git transparency).** No lifecycle edit or sidecar is left uncommitted on the shared working tree without a loud, actionable signal; the docs-lane commit guarantee ([#576](https://github.com/AIClarityAU/minspec/issues/576) / SPEC-022 FR-1 / [DR-078](../../../docs/decisions/DR-078.md)) extends to any new declare-ownership write.
- **INV-4 (never move the primary checkout).** No `checkout`/`switch`/`merge`/`rebase`/`reset` on the developer's working tree ([DR-046](../../../docs/decisions/DR-046.md) / rule #8).
- **INV-5 (one ownership matcher).** The pre-check and `validateOwnership` MUST derive "is ownership declared?" from the **same** `ownership-path-rules` predicates, so the transition can never permit a state the validator later rejects (that divergence is the whole bug). SPEC-038's INV-2 symmetry lesson ([#137](https://github.com/AIClarityAU/minspec/issues/137)) applies: two checks of the same rule must not drift.

## Decisions needed (Clarify)

These are genuine forks a human must pick before Plan. Each changes what is irreversible, so none is guessed here.

- **DQ-1 — Where does ownership get authored, and what enforces "before approval"?**
  - **Option A — pre-approval precondition (recommended default).** `approveSpec` refuses to approve a T3/T4 primary spec that has not declared ownership (or the `none` escape), prompting the human to add `implements:` first. Ownership stays *content* (still hash-bound, INV-2 intact). Cost: adds one authoring step before approval; a spec that truly cannot name its files yet must use `implements: none` or enumerate greenfield paths (SPEC-038 FR-4 already allows not-yet-existing paths).
  - **Option B — exclude `implements:`/`affects:` from the canonical hash.** Treat ownership like `status`/`phases` so it can be added post-approval without staling. Cost: **weakens approval integrity** — the spec-gate's owned-file block-set could then change after sign-off without re-review, a real governance hole. Requires a DR amending [DR-034](../../../docs/decisions/DR-034.md). Surfaced for completeness; likely rejected.
  - **Option C — treat `implements:` as a specify/clarify-phase field with its own scaffold prompt.** The spec template solicits ownership at Specify/Clarify (the issue's "Consider" #3), so it is present long before approval by construction; combine with Option A's refusal as a backstop. Cost: template + guidance change; strongest guarantee.
  - *Trade-off:* A/C preserve the hash's re-review property (INV-2) and differ mainly in *when* the human is nudged; B is the only option that changes hash semantics and the only one needing a new DR.

- **DQ-2 — Does the Plan-crossing pre-check live only in `approveSpec`, or in a shared `advanceToBuildBand` guard all actors call?**
  - Today only approval flips `plan → in-progress`, but DR-057's drain/agent-execute consumers and the phase-advance queue are designed to advance phases later. Putting the pre-check **only** in `approveSpec` fixes today's actor; a **shared guard** every `plan → in-progress` writer must call fixes the class. *Recommendation to confirm:* shared guard (prevents the next actor re-opening the same hole), but it is more surface than a point-fix.

- **DQ-3 — Recovery for specs already caught in the trap.** SPEC-040 (and any spec approved pre-fix without `implements:`) is already `stale` after ownership was added. Does this spec (a) leave those to the normal human re-approval flow (FR-5 — no borrowed sign-off), or (b) additionally ship a one-time detector that surfaces "these approved specs are trap-staled, re-approve" so they are not silently stranded? *Recommendation to confirm:* (a) for correctness + a non-blocking surfacing, never an auto re-approve.

- **DQ-4 — Tier of the fix / need for a DR at Plan.** If Clarify picks Option A/C, the change is validator + approve-path wiring (likely T3, no hash-contract DR). If it picks Option B, a DR amending DR-034 is mandatory and the tier is T4. Confirm the option so Plan knows whether a DR must be minted.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | A pre-approval refusal (Option A) frustrates a human who "just wants to approve" and doesn't yet know the owned files. | `implements: none` + reason and greenfield paths (SPEC-038 FR-4) both satisfy it; the prompt names the exact fix; the step is one line, authored once. |
| R2 | Option B silently widens the spec-gate's block-set post-approval (approval-integrity hole). | INV-2 forces a DR + explicit sign-off for B; it is surfaced as the disfavoured option, not the default. |
| R3 | A shared advance-guard (DQ-2) is more surface and could regress other advance callers. | Reuse the one `ownership-path-rules` matcher (INV-5); scope strictly to T3/T4 primary (AC-7); gate on SPEC-038's existing tests. |
| R4 | The fix introduces its own uncommitted write when it adds `implements:` on the human's behalf. | It does **not** author ownership for the human (FR-5); it prompts. Any write it does make is committed-or-loud (FR-3 / INV-3). |
| R5 | Pre-check and validator drift, re-opening the exact gap. | INV-5: single matcher; a parity test in the SPEC-137 spirit. |

## Out of Scope

- **Changing SPEC-038 FR-3's boundary or the `warn`/`error` ratchet** — this spec fixes the *ordering* around that gate, not the gate's own threshold ([SPEC-038](../SPEC-038-spec-code-ownership/requirements.md) owns that).
- **Drift detection** (a declared `implements:` path vanishing after a refactor) — SPEC-038 out-of-scope / [#643](https://github.com/AIClarityAU/minspec/issues/643).
- **The phase-advance queue's downstream consumer** (DR-057 drain / agent-execute) — this spec only guards the `plan → in-progress` flip, not the LLM generation the queue feeds.
- **Any change to the docs-lane workflow or push mechanics** — reused as-is (SPEC-039/SPEC-050).

## Traceability

- **Issue:** [#874](https://github.com/AIClarityAU/minspec/issues/874) — approve + advance strands an uncommittable state (no commit; no FR-3 pre-check at Clarify→Plan).
- **Gate that fired (correctly):** [SPEC-038](../SPEC-038-spec-code-ownership/requirements.md) FR-3 (spec→code ownership, [#460](https://github.com/AIClarityAU/minspec/issues/460)).
- **Hash semantics:** `packages/shared/src/canonical.ts:12-26` (strips only `status`/`phases`); the approval store is [SPEC-022](../SPEC-022-approval-foundation/requirements.md) / [DR-012](../../../docs/decisions/DR-012.md) / [DR-034](../../../docs/decisions/DR-034.md).
- **Approval flips Plan:** `packages/minspec/src/commands/approve.ts:257-265` → `advanceSpecToImplementing` (`packages/minspec/src/lib/spec.ts:568-603`), status per [DR-069](../../../docs/decisions/DR-069.md).
- **Commit-on-approve:** [#576](https://github.com/AIClarityAU/minspec/issues/576) / SPEC-022 FR-1 / [DR-078](../../../docs/decisions/DR-078.md) (`resolveBranchDestination` strand-refusal).
- **Sibling stranding class:** main-divergence / docs-lane ([#575](https://github.com/AIClarityAU/minspec/issues/575)).
- **Method:** RCDD Phase 4 ([DR-003](../../../docs/decisions/DR-003.md)) — mechanism + missing gate; fold-faults-into-ext.
