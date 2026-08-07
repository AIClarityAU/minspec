---
id: SPEC-051
type: design
status: planning
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology — the spec→code ownership contract (SPEC-038's sibling)
relates_to: [SPEC-038, SPEC-022, DR-012, DR-034, DR-069, DR-078, DR-051, DR-003]
implements: none
implements_reason: Plan document. Ownership for the implementation is declared in requirements.md (currently `none` pending this Plan); this file replaces that placeholder with the concrete paths below at Tasks.
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-051 — Design: ownership declared before approval

> **Why the Clarify answers live here and not in `requirements.md`.** DQ-1..DQ-4 were
> answered by the founder on 2026-08-07. Recording them in `requirements.md` would change
> its bytes and stale its human approval — *the exact trap this spec exists to close*.
> Writing them into this new file records the decisions at zero cost to the sign-off. That
> asymmetry is itself evidence for FR-1: a lifecycle that cannot absorb its own Clarify
> answers without voiding a signature is the defect.

## Resolved decisions (Clarify)

| # | Decision | Chosen |
|---|---|---|
| **DQ-1** | What enforces "ownership before approval" | **A + C** — the template solicits `implements:` at Specify/Clarify (C), *and* the approve path refuses a T3/T4 primary spec that still has not declared it (A). Ownership stays **content**, so the hash keeps its re-review property (INV-2). |
| **DQ-2** | Where the Plan-crossing pre-check lives | **Shared guard.** Every actor that writes `plan → in-progress` calls one function. Fixes the class, not today's actor. |
| **DQ-3** | Specs already caught in the trap | **(a) + non-blocking surfacing.** Normal human re-approval; never an auto re-approve (FR-5). Plus a detector so trap-staled specs are visible rather than silently stranded. |
| **DQ-4** | Tier / DR needed | **T3 work, no new DR.** A+C leaves `canonical.ts` untouched, so DR-034's hash contract is unchanged. Option B (the only one needing a DR) was rejected. |

## The ordering constraint that drives the design

`approveSpec` writes three side effects in sequence — status flip, baseline mint, sidecar
write (`packages/minspec/src/lib/approval.ts:512-556`). `advanceSpecToImplementing`
(`packages/minspec/src/lib/spec.ts:568`) runs *after* it, from the command layer.

So a guard placed **only** at the Plan flip is too late: the approval sidecar is already on
disk when the refusal fires, leaving exactly the half-written state FR-3 forbids. The check
must run **before any side effect**, in the same position and spirit as the DR-056 approver
gate that already sits at the top of the same function:

```
assertHumanApprover(email);            // DR-056 — deny before any side effect
assertOwnershipDeclared(raw, config);  // SPEC-051 — same discipline, same position
```

That comment at `approval.ts:519-522` states the principle explicitly ("deny BEFORE any
side effect ... so a denied identity never mints, mutates, or half-writes a record"). This
design reuses it rather than inventing a second convention.

## Components

### 1. `assertOwnershipDeclared` — the shared guard (Tier-0, pure)

A single exported predicate + throwing assert, extracted from the *missing-direction* half
of `validateOwnership` (`packages/minspec/src/lib/spec-validator.ts:791-809`) so the
validator and the guard cannot drift (INV-5 — one matcher). Signature shape:

- `ownershipDeclared(raw, tier, specType, phases): boolean` — pure, no fs.
- `assertOwnershipDeclared(...)` — throws `OwnershipUndeclaredError` carrying the same
  `fixHint` string the validator already emits, so the human sees one wording everywhere.

It reuses `isValidOwnedPath` (`packages/minspec/src/lib/ownership-path-rules.ts:44`)
verbatim — the parity-pinned matcher the spec-gate consumes — and honours the same
`implements: none` + `implements_reason:` escape (FR-4).

**Scope gate, identical to the validator's** (AC-7): primary spec, `TIER_RANK >= 3`. Note
one deliberate difference — `validateOwnership` fires only once `phases.plan` is
`in-progress|done`; the guard must fire *before* that flip, so it keys on **"is about to
enter the build band"**, not on already being in it.

### 2. Call sites

| Caller | Why |
|---|---|
| `approveSpec` (`approval.ts:512`) | Option A. Top of function, beside `assertHumanApprover`, before the first side effect. |
| `advanceSpecToImplementing` (`spec.ts:568`) | DQ-2's shared guard. This is the single function that writes `plan → in-progress` via `phasesForApproval`, and it has four callers — guarding here covers every current actor and any future one (DR-057's drain consumers, the phase-advance queue) without each having to remember. |

Both, not either: `approveSpec` gives the early, friendly refusal; `advanceSpecToImplementing`
makes the *class* safe. A future actor that flips the band without going through approval
still cannot strand a spec.

### 3. Template prompt (Option C)

The spec scaffold gains an `implements:` line with the `none`-escape documented inline, so
ownership is authored at Specify by construction and the refusal in (2) becomes a backstop
that rarely fires. Managed-region template change only — no new gate.

### 4. Trap-staled detector (DQ-3)

A non-blocking surfacing that lists specs which are **approved-but-stale where the only
delta is an ownership field**. Deliberately *not* an auto re-approve (FR-5). Cheap
formulation: for each stale record, canonically hash the approved baseline with
`implements:`/`implements_reason:`/`affects:` stripped and compare — equal ⇒ the staleness
was ownership-only ⇒ report it as "trap-staled, re-approve" rather than "content changed".
Reuses the recovered baseline `recoverBaseline` already provides.

## Test plan — T0 invariants first

`validateOwnership` currently has **no covering tests** (codegraph blast radius, 2026-08-07)
despite being an `error`-severity gate. This spec adds them as a precondition, not an
afterthought.

| Tier | Test | Asserts |
|---|---|---|
| T0 | approve refuses undeclared T3/T4 primary | **no sidecar is written, no status flip, no baseline minted** — assert absence of side effects, not just the throw |
| T0 | `implements: none` + reason approves cleanly | FR-4 escape reachable pre-approval |
| T0 | T1/T2 and non-primary specs approve unguarded | AC-7 scope, no regression |
| T0 | guard and `validateOwnership` agree on a shared fixture table | INV-5 single-matcher parity — the R5 drift risk |
| T0 | `advanceSpecToImplementing` refuses undeclared, leaves phases untouched | DQ-2 class fix; no half-advance |
| T1 | greenfield path (not yet on disk) satisfies the guard | SPEC-038 FR-4 — `isValidOwnedPath` excludes existence |
| T3 | regression: the four red-mains of 2026-08-07 | SPEC-051/048/049 shapes cannot recur |

The parity test (row 4) is the mitigation for R5 and is the same shape DR-077 sanctions for
a deliberately duplicated rule.

## Files

- `packages/minspec/src/lib/ownership-path-rules.ts` — host the extracted predicate (it
  already owns the matcher; SPEC-038 owns this file, so this is an `affects:`, not a claim).
- `packages/minspec/src/lib/spec-validator.ts` — `validateOwnership` delegates to the
  shared predicate instead of holding its own copy.
- `packages/minspec/src/lib/approval.ts` — guard call in `approveSpec`.
- `packages/minspec/src/lib/spec.ts` — guard call in `advanceSpecToImplementing`.
- `packages/minspec/src/commands/approve.ts` — surface the refusal as an actionable toast
  naming the exact line to add (the command layer already pre-checks the approver for a
  friendlier message; mirror that).
- template registry — the Specify-phase `implements:` prompt.
- tests — the table above.

Final `implements:` for `requirements.md` is settled at Tasks, once the extraction target
is fixed; today's `implements: none` placeholder is replaced then.

## Risks carried forward

R1 (refusal frustrates a human mid-approval) is materially reduced by C: the field is
solicited at Specify, so by approval time it is normally already there. R3 (shared guard
regresses other advance callers) is bounded by keeping the scope gate byte-identical to
`validateOwnership`'s and by the parity test. R4 is satisfied by construction — the guard
**never authors ownership**, it refuses and names the fix.

## Open for Tasks

- Exact home for the extracted predicate (`ownership-path-rules.ts` vs a new sibling) —
  affects whether SPEC-051 declares real `implements:` paths or stays `none`.
- Whether the detector (4) ships in this slice or as a follow-up; it is independent of the
  guard and could land second without weakening the fix.
