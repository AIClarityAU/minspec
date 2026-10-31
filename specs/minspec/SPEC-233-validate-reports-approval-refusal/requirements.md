---
id: SPEC-233
type: requirements
status: specifying
tier: T2
product: minspec
epic: EPIC-003  # SDD Core Methodology — the spec→code ownership contract
aspects: [validate, ownership, approval, no-silent-gate, authoring-time]
depends_on: []
relates_to: ["#2108", "#1317", "#1806", "#1543", DR-003, SPEC-038]
implements: [packages/minspec/tests/validate-reports-approval-refusal.test.ts]  # NEW — regression test this spec owns
affects: [packages/minspec/src/commands/validate.ts, packages/minspec/src/lib/spec-validator.ts]  # validate.ts gains one call; the predicate violationsIntroducedByApproval is reused, never re-implemented
phases:
  specify: in-progress
  clarify: done
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-233: `MinSpec: Validate` never reports "complete" for a spec that approval would refuse

> **This is a SPECIFICATION ONLY.** Written for issue #2108. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## One-sentence scope

`MinSpec: Validate` must surface the violations that approving the spec would introduce
(`violationsIntroducedByApproval`), so a spec that approval would refuse never shows `✓ complete`.

## Root-cause diagnosis (measured in issue #2108, re-checked against this base)

- `validateSpecCommand` (`packages/minspec/src/commands/validate.ts`) runs `validateSpec` only,
  then shows `✓ <id> is complete` when `result.violations.length === 0`. It never calls
  `violationsIntroducedByApproval`.
- `violationsIntroducedByApproval` (`spec-validator.ts`) is reached only through
  `assertOwnershipDeclaredForAdvance` (`ownership-advance-guard.ts`), which `approve.ts`,
  `approval.ts` and `spec.ts` call at the moment of approval.
- Ownership rules (`ownership.implements.missing`) are gated on `phases.plan` being
  `in-progress`/`done`. Approval WRITES `plan: in-progress`, so a T4 spec at `plan: pending`
  with no `implements:` validates clean now and fails the instant it is approved. The
  requirement first appears as a modal refusal at the founder's approve keystroke, and a
  spec that lands advanced-but-undeclared reddens `main` (#1317: SPEC-051, SPEC-048/049).
- Mechanism: two consumers of one question ("is this spec OK?") with different inputs, the
  asymmetry DR-003 Phase 4 names. **Missing gate:** the authoring-time command does not ask
  the question approval asks. Prose guidance (`slash-commands.ts` "Do NOT write a comment
  deferring this to Plan") did not hold — SPEC-071 was a fourth instance — which is the
  "enforce, don't trust the model" failure mode.

## Scope boundary

In: the `MinSpec: Validate` result surface, and a test pinning it. Out:
- The refusal path itself (#1806 owns it; it is unchanged).
- Moving ownership out of the canonical hash (#1481 / #1800).
- Backfilling the ~16 specs currently approval-blocked (#1543 campaign).
- SPEC-071's own declaration: at this base `specs/minspec/SPEC-071-required-check-drift-witness/requirements.md`
  already carries `implements:` (3 paths), so issue Fix item 2 is satisfied; no edit here.

## Functional requirements

- **FR-1 — Validate runs the approval predicate.** After `validateSpec`, `validateSpecCommand`
  calls `violationsIntroducedByApproval` with the same config and the same `pathExists`
  resolver (`fs.existsSync` against the workspace root) the approve guard uses.
- **FR-2 — One predicate, one config.** The call goes through the existing shared function
  (directly or via a thin non-throwing sibling of `assertOwnershipDeclaredForAdvance`); no
  second implementation of "what does the advance introduce". Config-respecting (a repo on
  `ownershipDeclaration: 'warn'` is not told approval is refused) and diff-only (a spec
  already past the gate and already violating is not newly flagged), both inherited.
- **FR-3 — No false tick.** If the approval predicate returns ≥1 `error`-severity violation,
  the command MUST NOT show `✓ … is complete`. It shows the incomplete header, with the
  introduced violations listed under a distinct label (e.g. "Approval would be refused:")
  using each violation's message and fixHint.
- **FR-4 — Clean case unchanged.** No violations from either source → today's `✓ complete` message verbatim.
- **FR-5 — Warnings.** Introduced `warning`-severity items are listed but do not block the tick-or-not decision beyond what `validateSpec` warnings already do.
- **FR-6 — Fail visible, not open-silent.** If the predicate throws, the command says so
  in the result (e.g. "approval pre-check could not run: <reason>") and does not print a
  bare `✓ complete`. (The approve guard fails open by design because it must not make
  approval unavailable; Validate has no such constraint, and a silent skip here is the
  lie this spec removes. Constitution invariant 2.)
- **FR-7 — Already-approved/terminal specs.** Specs whose status is past the advance
  (building/done) or explicit terminals (`archived`, `superseded`) produce an empty
  introduced set by construction; no special casing, no message.
- **FR-8 — Offline.** No network call; Tier 0 (invariant 1).

## Acceptance criteria

- **AC-1** Fixture: T4 spec, `plan: pending`, no `implements:`, config `ownershipDeclaration: error`. `validateSpec(...).violations` is empty; running the command shows the incomplete header naming `ownership.implements.missing` / "does not declare its owned code", not `✓ complete`. (Fails on base: shows `✓`.)
- **AC-2** Same fixture with `implements:` declared → `✓ complete` (FR-4).
- **AC-3** Same fixture under default `ownershipDeclaration: 'warn'` → no "approval refused" claim (FR-2 config-respecting).
- **AC-4** Predicate throws (injected) → message states the pre-check could not run; no `✓` (FR-6).
- **AC-5** The set of messages shown for the fixture equals `violationsIntroducedByApproval`'s output for the same input (guards against a drifting second implementation).
- **AC-6** Test uses the real predicate (not a mock of it) for AC-1/2/3, so the test cannot pass vacuously.

## Invariants (must not break)

- **INV-1** `approve.ts` refusal behaviour and `assertOwnershipDeclaredForAdvance` semantics are unchanged.
- **INV-2** `validateSpec` stays filesystem-free; the `pathExists` resolver is injected by the command.
- **INV-3** No new dependency; no network call.
- **INV-4** Every spec the approve command would refuse is also not-complete under Validate (the equivalence this spec establishes) — pinned by AC-5.

## Decisions needed (Clarify)

All 3 decisions are answered, not ratified: an agent session selected, for each, the option this
document already recommended. No human chose them, and no delegation covers authoring Clarify
answers. Delegation DLG-001 (DR-108) made none of these selections and covers spec approval and
engineering-DR acceptance only. An agent-recorded selection carries no consent, whoever prompted
it. It is ratified only by approval of this spec, the founder's or the bot's under DLG-001, and
that approval may overturn it.

- **D1 — Should the same check also run for the Validate-all / tree decoration / CI path?**
  Options: (A) command only **(rec)** — smallest, fixes the reported surface; cost: other
  surfaces (status-bar tick, `npm run validate`) can still say "fine" for a spec approval would
  refuse (CI is deliberately state-based, so it cannot know the advance). (B) also the
  tree-view badge — closer to "at authoring time", but a wider blast radius and per-refresh cost.
  **Recorded selection: Option (A),** command only, the smallest change, which fixes the
  reported surface.
- **D2 — Should the validator itself assert `implements:` at authoring time** (e.g. a
  warning-level `ownership.implements.undeclared` for a T3/T4 spec at `plan: pending`) instead
  of, or in addition to, FR-1? Rec: **no, not now** — it changes `npm run validate` results for
  the ~16 un-backfilled specs and would collide with the #1543 backfill; cost: the requirement
  stays visible only to those who run `MinSpec: Validate` or approve.
  **Recorded selection: Option (no, not now),** the validator does not assert `implements:`
  at authoring time, so `npm run validate` results do not change for the un-backfilled specs.
- **D3 — Guidance prose.** Leave `slash-commands.ts` guidance as is (rec; the gate now enforces it) or tighten it to point at Validate. Cost of leaving: none beyond staleness risk.
  **Recorded selection: Option (leave),** leave the `slash-commands.ts` guidance as is,
  since the gate now enforces it.
