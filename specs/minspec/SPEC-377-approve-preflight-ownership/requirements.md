---
id: SPEC-377
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - an approval that cannot land is a false signpost
aspects: [approval, validator, preflight, ownership, silent-gate, tier-0]
relates_to: ["#1179", "#1177", "#1064", "#1115", "#137", "#1806", SPEC-038, SPEC-051, SPEC-022, SPEC-045, SPEC-371, DR-003]
---

# SPEC-377: Approve Spec past-Clarify ownership pre-flight - residual gaps after the shipped guard (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers *Decisions needed (Clarify)*, and approves it before code changes.

Materializes [#1179](https://github.com/AIClarityAU/minspec/issues/1179): approving T3 SPEC-045
succeeded, then CI rejected it (`ownership.implements.missing`), and the only fix (adding
`implements:`) voids the approval just given.

## Root cause (mechanism + gate status)

- **Mechanism.** `approveSpec` calls `advanceSpecToImplementing` for a `new`/`specifying` spec, writing
  `status: planning` and `phases.plan: in-progress`. `validateOwnership`
  (`packages/minspec/src/lib/spec-validator.ts`, ~line 989-1034) fires only when `phases.plan` is
  `in-progress`/`done`, so **the act of approving is what arms the rule**.
- **The pre-flight gate already ships (corrected; an earlier draft claimed it was missing).**
  `packages/minspec/src/commands/approve.ts:317-330` calls `assertOwnershipDeclaredForAdvance`
  (`packages/minspec/src/lib/ownership-advance-guard.ts:66`) BEFORE any write; it delegates to
  `violationsIntroducedByApproval` (`spec-validator.ts:1210`), which re-runs `validateSpec` on the
  post-advance phase map and returns only newly-introduced `error`-severity violations. It was added in
  #1806 / SPEC-051 for the same bug class (#1300, #1348). `approval.ts` and `spec.ts` reach the same
  guard, so there is one enforcement point.
- **Why #1179 happened anyway (not re-verified against the pre-#1806 tree; treat as inferred).** The
  report predates the shared guard. Two residual mechanisms remain, and they are all this spec now
  covers:
  1. **Config ratchet.** `ownership.implements.missing` is `error` only when
     `ownershipDeclaration === 'error'` (`spec-validator.ts:1031`; default `'warn'`,
     `config.ts:179`), and the guard filters to `error` severity (`spec-validator.ts:1220`). A repo on
     the default is never refused at approve time. This repo is on `error` (`.minspec/config.json:57`).
  2. **Fail-open guard.** On an evaluation error the guard `console.warn`s and lets the advance
     proceed (`ownership-advance-guard.ts:96-101`), relying on CI as the backstop.
- **Hash void-on-edit trap (unchanged, still true).** `stripLifecycle` (`packages/shared/src/canonical.ts:60`)
  drops only `status:` and `phases:`; `implements:`/`affects:` are hashed, so adding them after approval
  makes `resolveStatus` return `stale`. The guard prevents reaching that state for error-severity rules;
  it does not remove the trap.

## Functional requirements

Already shipped (do NOT re-specify; Plan must verify with tests, not rebuild): pre-flight before the
write, single source of truth via `violationsIntroducedByApproval`, refuse-without-writing, and the
refusal modal with "Open Spec" (`approve.ts:317-330`). Remaining scope:

1. **FR-1 Audit existing coverage.** Confirm by test that, under `ownershipDeclaration: 'error'`, a T3
   spec with no `implements:` / no valid `none` + `implements_reason:` is refused with no file change,
   sidecar, or commit (AC-1), and that the verdict equals `validateSpec` on the post-advance file.
   Add only the tests missing from the existing guard suite.
2. **FR-2 Decide the fail-open/fail-closed tension (Decision 2).** Constitution invariant 2 says a
   missing or errored witness fails closed and visibly; the guard is deliberately and test-pinned
   fail-open. Either amend the guard to refuse on infrastructure error, or record in a DR why the
   announced degrade plus CI backstop satisfies invariant 2.
3. **FR-3 Decide the warn-config gap (Decision 1).** Under `ownershipDeclaration: 'warn'`, approval can
   still mint a state that later needs a hashed edit. Decide whether to leave it (warnings never gate
   approval) or surface the pending warning at approve time without blocking.
4. **FR-4 Hash trap (Decision 3).** Decide whether `implements:`/`affects:` should be lifecycle fields.
5. **FR-5 No-op elsewhere.** T1/T2, already-declared specs, and re-approval of an advanced spec behave as
   today.
6. **FR-6 Offline and opt-in.** No network call (invariant 1); runs only under the `.minspec/` marker
   (invariant 3).

## Acceptance criteria

- AC-1: Under `ownershipDeclaration: 'error'`, approving a T3 spec with no ownership declaration leaves
  the file byte-identical, creates no sidecar or commit, and shows the validator's own message (test
  exists or is added).
- AC-2: After adding a valid `implements:` and re-running Approve, approval succeeds and
  `npm run validate` passes on the result with no further edit.
- AC-3: Each Clarify decision below is answered, and a DR is filed for any behaviour change to the
  fail-open guard or the hashed-field set.
- AC-4: A T1/T2 spec approves exactly as before.

## Invariants the change must not break

- Approval hash semantics (SPEC-022): the canonical form and `stripLifecycle` are unchanged unless the
  Clarify decision below picks Option B.
- DR-056 approver gate and the SPEC-096 opt-in-marker check keep their order; the pre-flight runs before
  any status flip.
- Warnings never gate approval (existing HITL rule); only rules that the post-advance validator reports as
  errors block.
- No silent gate: no `|| true`/swallowed error in the pre-flight path.

## Decisions needed (Clarify)

1. **Warn-config gap.** Under the default `ownershipDeclaration: 'warn'`, should Approve surface the
   pending `ownership.implements.missing` warning (non-blocking)? **(rec) Surface, non-blocking.** Cost:
   one more prompt for repos that opted into warn; warnings never gate approval, so no deadlock.
   Alternative: leave as is (no cost, gap remains).
2. **Guard fail-open vs invariant 2.** **(rec) Keep fail-open, record the reasoning in a DR** (the
   degrade is announced and CI is the independent second witness). Cost: an approval can still land
   unchecked when the guard itself breaks. Alternative: fail closed; cost: a guard bug makes approval
   unavailable, and the existing tests pinning fail-open must change.
3. **Strip `implements:`/`affects:` from the hash?** **(rec) No (option A, status quo).** Cost: the human
   must declare ownership before approving. Option B removes the void-on-edit trap but lets an
   arming claim change without re-approval, changes every existing approval hash, and needs its own DR
   plus a sidecar migration plan.

## Follow-ups (tracked)

- DR for Decision 1, only if Option B is chosen (changes hashed-field set; hard to undo): to be filed by
  the Plan phase if so.
- Repair of SPEC-045 (add `implements:` while unapproved, re-approve): tracked in #1179 impact section.
