---
id: SPEC-377
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - an approval that cannot land is a false signpost
aspects: [approval, validator, preflight, ownership, silent-gate, tier-0]
relates_to: ["#1179", "#1177", "#1064", "#1115", "#137", SPEC-038, SPEC-022, SPEC-045, SPEC-371, DR-003]
---

# SPEC-377: Approve Spec pre-flights the past-Clarify ownership rule before it advances the phase (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers *Decisions needed (Clarify)*, and approves it before code changes.

Materializes [#1179](https://github.com/AIClarityAU/minspec/issues/1179): approving T3 SPEC-045
succeeded, then CI rejected it (`ownership.implements.missing`), and the only fix (adding
`implements:`) voids the approval just given.

## Root cause (mechanism + missing gate)

- **Mechanism.** `approveSpec` (`packages/minspec/src/commands/approve.ts`, the `try` block after the
  approver check) calls `advanceSpecToImplementing` for a `new`/`specifying` spec. That writes
  `status: planning` and `phases.plan: in-progress`.
- `validateOwnership` (`packages/minspec/src/lib/spec-validator.ts`, ~line 989-1034) fires only when
  `phases.plan` is `in-progress` or `done` (`inBuildPath`), on a T3+ primary spec. So **the act of
  approving is what arms the rule**; it is evaluated only afterwards, in CI.
- The fix is not free: `stripLifecycle` (`packages/shared/src/canonical.ts:60`) drops only `status:` and
  `phases:`. `implements:`/`affects:` are hashed, so adding them after approval makes
  `resolveStatus` return `stale`.
- **Missing gate.** The approve command has no mirror of the validator's past-Clarify rules, so it can
  mint a state that is approved and unlandable. Same asymmetry class as #137 and the SPEC-004 `epic:`
  defect. Contrast `resolveBranchDestination` (`approve-commit.ts`), which mirrors the pre-commit hook so
  the command refuses before acting.

## Functional requirements

1. **FR-1 Pre-flight before the write.** For a spec that Approve would advance (the `wasPreImpl` case),
   the command evaluates the validator rules that the advance would newly arm, against the spec as it
   would look after the advance, BEFORE `advanceSpecToImplementing` and `recordApproval`. At minimum:
   `ownership.implements.missing` and `ownership.implements.invalid`.
2. **FR-2 One source of truth.** The pre-flight calls the validator's own rule function (or a shared,
   exported predicate it also uses) and shows the validator's own message. No second hand-written copy of
   the rule (duplicate predicates drift; cf. SPEC-371).
3. **FR-3 Refuse, don't half-act.** On a violation the command writes nothing: no phase advance, no
   sidecar, no commit. The refusal names the rule and the exact fix.
4. **FR-4 Offer the free edit.** The refusal offers to add the missing field while the spec is still
   unapproved (editing is free then): open the spec at the frontmatter with an `implements:` stub, or
   offer the `implements: none` + `implements_reason:` escape. After the human saves, re-running Approve
   proceeds. The command never invents the owned-path list itself.
5. **FR-5 No-op when armed rules are already satisfied.** T1/T2 specs, specs that already declare valid
   ownership, and re-approval of an already-advanced spec (not `wasPreImpl`) are unaffected: no new
   prompt, same behaviour as today.
6. **FR-6 Parity test.** A test asserts that for every spec shape (T1-T4, with/without `implements:`,
   `none` with/without reason, invalid token), the pre-flight verdict equals the verdict of
   `validateSpec` run on the post-advance file. The test must fail if a rule is added to the
   post-advance validator set but not to the pre-flight.
7. **FR-7 Fail closed, visibly.** If the pre-flight itself errors (unreadable file, parse failure), the
   command refuses with that error; it never proceeds as if the check passed (constitution invariant 2).
8. **FR-8 Offline.** No network call (invariant 1); runs only under the `.minspec/` opt-in marker
   (invariant 3).

## Acceptance criteria

- AC-1: Approving a T3 spec with no `implements:` and no `none` escape leaves the spec file byte-identical,
  creates no sidecar and no commit, and shows the validator's `ownership.implements.missing` message
  (FR-1, FR-3).
- AC-2: After adding `implements: [<valid path>]` and re-running Approve, the approval succeeds and
  `npm run validate` passes on the result with no further edit; the hash recorded equals the hash of the
  landed file (FR-1, FR-4).
- AC-3: `implements: none` without `implements_reason:` is refused; with a reason it is accepted (FR-2).
- AC-4: A T1/T2 spec approves exactly as before (FR-5).
- AC-5: The FR-6 parity test exists and goes red when the pre-flight omits a rule the validator applies
  post-advance.
- AC-6: Reproduction of #1177: SPEC-045 as it stood (T3, no `implements:`) is refused, not approved.

## Invariants the change must not break

- Approval hash semantics (SPEC-022): the canonical form and `stripLifecycle` are unchanged unless the
  Clarify decision below picks Option B.
- DR-056 approver gate and the SPEC-096 opt-in-marker check keep their order; the pre-flight runs before
  any status flip.
- Warnings never gate approval (existing HITL rule); only rules that the post-advance validator reports as
  errors block.
- No silent gate: no `|| true`/swallowed error in the pre-flight path.

## Decisions needed (Clarify)

1. **Should `implements:`/`affects:` be lifecycle (stripped from the hash) instead?**
   - **A. Pre-flight only (rec).** Smallest blast radius; closes the deadlock for every future spec;
     the ownership claim stays part of what the human signed. Cost: the human must declare ownership
     before approving, even for a spec whose code list is still uncertain.
   - **B. Also strip `implements:`/`affects:` in `stripLifecycle`.** Removes the void-on-edit trap
     generally. Cost: an ownership claim (which arms the spec-gate) becomes changeable without
     re-approval, and every existing approval hash changes, so all sidecars would need migration; needs
     its own DR and a hash-migration plan. Could follow A later if the trap recurs.
   - **C. Neither**: keep today's behaviour. Not recommended; the deadlock stays.
2. **Which rules does the pre-flight cover?** (rec) Every rule `validateSpec` would report as an error
   on the post-advance file (generic), not only ownership. Cost: more refusals at approve time, though
   each is a defect CI would already reject. Alternative: ownership rules only; cheaper, but leaves the
   same asymmetry for the next rule that keys off `phases.plan`.
3. **Escape-hatch UX.** (rec) Refusal modal with "Open spec" action that inserts an `implements:` stub.
   Cost: touches the spec file before approval. Alternative: message only.

## Follow-ups (tracked)

- DR for Decision 1, only if Option B is chosen (changes hashed-field set; hard to undo): to be filed by
  the Plan phase if so.
- Repair of SPEC-045 (add `implements:` while unapproved, re-approve): tracked in #1179 impact section.
