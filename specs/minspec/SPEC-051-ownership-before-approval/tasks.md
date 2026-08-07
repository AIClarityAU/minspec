---
id: SPEC-051
type: tasks
status: planning
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology — the spec→code ownership contract (SPEC-038's sibling)
relates_to: [SPEC-038, SPEC-022, DR-012, DR-034, DR-069, DR-078, DR-051, DR-003]
implements: none
implements_reason: Task list. The implementation's owned paths are settled by T1 below (the extraction target); requirements.md's `implements:` placeholder is replaced at that point, in the same commit.
phases:
  specify: done
  clarify: done
  plan: done
  tasks: in-progress
  implement: pending
---

# SPEC-051 — Tasks

Ordered. T0 invariant tests land **before** the behaviour they protect (project rule: T0
first). Each task names its acceptance signal so "done" is checkable, not asserted.

## T1 — Settle the extraction target (blocks everything; also unblocks `implements:`)

- [ ] **T1.1** Decide where the shared predicate lives: extend
      `packages/minspec/src/lib/ownership-path-rules.ts` (SPEC-038 owns it — this becomes an
      `affects:` for us) **or** a new sibling module (which SPEC-051 would then own via
      `implements:`). Record the choice and the reason in this file.
- [ ] **T1.2** Replace `implements: none` in `requirements.md` **and** in this file with the
      real path if T1.1 chose a new module. ⚠️ Editing `requirements.md` stales its human
      approval (hash is content-bound) — batch this with any other requirements edit so the
      re-stamp is paid **once**, and say so in the PR body.

> T1.2 is the trap this spec exists to remove, hit one last time by the fix itself. Flag it
> in the PR rather than letting the maintainer discover a staled approval.

## T2 — T0 tests (before any behaviour change)

- [ ] **T2.1** `ownership-guard.test.ts` — approve refuses an undeclared T3/T4 primary spec.
      Assert **absence of every side effect**: no sidecar written, no `status:` flip, no
      baseline blob minted, no ref created. *(Not just "it threw" — the whole point is that
      nothing is half-written.)*
- [ ] **T2.2** `implements: none` + `implements_reason` approves cleanly (FR-4 escape
      reachable pre-approval).
- [ ] **T2.3** T1/T2 tiers and non-primary specs approve unguarded (AC-7 scope; no regression).
- [ ] **T2.4** Greenfield path (declared, not on disk) satisfies the guard — mirrors the
      existing `ownership.test.ts` "AC-3 greenfield" case, which proves `isValidOwnedPath`
      excludes existence.
- [ ] **T2.5** **Parity table** — guard and `validateOwnership` return the same verdict over
      one shared fixture list (INV-5, risk R5). Both must import the same matcher; the test
      fails if either grows a private rule. This is DR-077's sanctioned shape for a rule with
      two call sites.
- [ ] **T2.6** `advanceSpecToImplementing` refuses an undeclared spec and leaves `phases`
      **byte-unchanged** (DQ-2 class fix; no half-advance).

## T3 — Extract the shared predicate (behaviour-preserving)

- [ ] **T3.1** Extract the missing-direction logic from `validateOwnership`
      (`packages/minspec/src/lib/spec-validator.ts:791-809`) into
      `ownershipDeclared(...)` + `assertOwnershipDeclared(...)`. Pure, no `fs`, Tier-0.
      Reuse `isValidOwnedPath` (`ownership-path-rules.ts:44`) verbatim.
- [ ] **T3.2** `validateOwnership` delegates to it — one matcher, no copy.
- [ ] **T3.3** **All 14 existing `ownership.test.ts` cases stay green**, unchanged. They are
      the de facto contract for this matcher; any edit to them means the extraction changed
      behaviour and is wrong.
- [ ] **T3.4** The guard keys on *about to enter the build band*, not *already in it* — the
      one deliberate difference from `validateOwnership`, which fires on
      `plan: in-progress|done`. Cover both sides in T2.6.

## T4 — Wire the two call sites

- [ ] **T4.1** `approveSpec` (`packages/minspec/src/lib/approval.ts:512`): call the assert
      immediately after `assertHumanApprover(email)`, **before** the first read/hash/mint/
      write. Same position and rationale as the DR-056 gate documented at `approval.ts:519-522`.
- [ ] **T4.2** `advanceSpecToImplementing` (`packages/minspec/src/lib/spec.ts:568`): call it
      before `phasesForApproval` mutates anything — the shared guard for the class (DQ-2),
      covering all four of its callers and any future advance actor.
- [ ] **T4.3** `packages/minspec/src/commands/approve.ts`: surface the refusal as an
      actionable message naming the exact frontmatter line to add, mirroring how the command
      layer already pre-checks the approver for a friendlier message than the lib throw.

## T5 — Template prompt (DQ-1 Option C)

- [ ] **T5.1** Spec scaffold emits a commented `implements:` line at Specify, documenting the
      `none` + `implements_reason` escape inline, so ownership is authored long before
      approval and T4's refusal becomes a rarely-fired backstop.
- [ ] **T5.2** Managed-region template change only — no new gate, no behaviour in the
      validator. Confirm harness-refresh re-scaffolds it without clobbering user edits.

## T6 — Trap-staled detector (DQ-3, non-blocking)

- [ ] **T6.1** Detect approved-but-stale records whose **only** delta is an ownership field:
      canonically hash the recovered baseline with `implements:` / `implements_reason:` /
      `affects:` stripped and compare to the current canonical hash. Equal ⇒ trap-staled.
- [ ] **T6.2** Surface as "trap-staled — re-approve", never an auto re-approve (FR-5).
      Non-blocking: it reports, it does not gate.
- [ ] **T6.3** Regression fixture from today's real instances (SPEC-051, SPEC-048, SPEC-049,
      SPEC-035) so the detector is proven against shapes that actually occurred.

> T6 may ship as a second slice — it is independent of T2–T4 and does not weaken the fix.
> Decide at implementation; if split, file the follow-up issue rather than leaving it prose.

## T7 — Close out

- [ ] **T7.1** T3 regression: the five red-mains of 2026-08-06/07 cannot recur — approving
      each of those spec shapes now refuses instead of turning `main` red.
- [ ] **T7.2** Full suite + `npm run validate` green.
- [ ] **T7.3** Update `requirements.md`'s "Decisions needed (Clarify)" to point at
      `design.md`'s resolved table. ⚠️ Stales the approval — batch with T1.2, pay the
      re-stamp once.
- [ ] **T7.4** Verify the trap is actually closed by the only test that matters: create a
      throwaway T4 spec with no `implements:`, approve it, and confirm the approval is
      **refused** and `main` stays green — rather than inferring it from unit tests.

## Not doing

- Option B (excluding `implements:` from the canonical hash). Rejected at DQ-1: it would let
  the spec-gate's owned-file block-set change after sign-off with no re-review, and needs a
  DR amending DR-034.
- Auto-authoring ownership on the human's behalf (FR-5 / R4). The guard refuses and names
  the fix; it never writes the field.
