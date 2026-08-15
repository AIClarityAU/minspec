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
| **DQ-4** | Tier / DR needed | **No new DR.** A+C leaves `canonical.ts` untouched, so DR-034's hash contract is unchanged; only Option B would have required a DR amending it, and it was rejected. *The spec stays **T4*** (as `requirements.md` declares) — DQ-4 asked whether the *hash contract* forced T4 ceremony, and it does not; it did not propose re-tiering the spec. |

## The ordering constraint that drives the design

> **Corrected 2026-08-07.** An earlier version of this section stated the call order
> **backwards** — it claimed `approveSpec` writes first and `advanceSpecToImplementing`
> runs after. The opposite is true, and the correction inverts which call site is the
> load-bearing one. The error was caught by a drift audit, not by review of the code it
> cited. What follows is the verified order.

The command layer runs, in this order (`packages/minspec/src/commands/approve.ts`):

| # | call (grep this, not the line) | writes |
|---|---|---|
| 1 | `checkApprover(` | nothing — pre-check, refuses early |
| **2** | **`advanceSpecToImplementing(spec.filePath)`** | **`phases:` + `status:` to the spec file on disk** |
| 3 | `recordApproval(` (= `approveSpec`) | baseline blob + approval sidecar |
| 4 | `commitApprovalIfEnabled(` | the commit |

> **Cite the ordering, not the coordinates.** As of `ae26100` those sit at `:260`, `:296`,
> `:297`, `:307` — but that quadruple has already been wrong once in this very document. An
> earlier revision cited `:229/:265/:266/:276`, which were correct when read and became stale
> ~31 lines later the same day when the `#1317` block landed; the doc then shipped asserting
> "verified" against anchors that had since moved, and `:265` now points into an unrelated
> error toast. **The load-bearing fact is the relative order — 2 before 3 — which is stable;
> the line numbers are not.** Re-derive them with
> `grep -nE 'checkApprover\(|advanceSpecToImplementing\(spec|recordApproval\(|commitApprovalIfEnabled\(' packages/minspec/src/commands/approve.ts`
> rather than trusting any number written here. (This is the line-level citation rot that
> [#1252](https://github.com/AIClarityAU/minspec/issues/1252) exists to catch.)

So the **Plan flip is the FIRST write**, not the last. Two consequences, both opposite to
what the earlier draft said:

1. **A guard placed only inside `approveSpec` is too late.** By the time it runs, step 2
   has already flipped `phases.plan` to `in-progress` and persisted it — precisely the
   half-written, gate-illegal state FR-3 forbids, and exactly the shape that took `main`
   red four times on 2026-08-06/07.
2. **`advanceSpecToImplementing` is the earliest point that can refuse before any byte is
   written**, which makes it the primary guard site rather than the class-safety extra.

The precedent to mirror is therefore **`checkApprover` (step 1)** — a command-layer
pre-check that runs *before* the flip — not the lib-level `assertHumanApprover`. Note that
`approval.ts:519-522` describes its own gate as denying "BEFORE any side effect (status
flip, ...)"; that is true of everything `approveSpec` itself does, but the status flip
happens in its **caller**, one line earlier, so the lib assert cannot protect it. The
command's `checkApprover` pre-check (step 1) is what actually keeps a denied approver from
mutating the file today.

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
| **`approve.ts` command, before the `advanceSpecToImplementing` call** | **Primary.** The only point that precedes every write, mirroring the `checkApprover` pre-check. Gives Option A's friendly, actionable refusal with nothing yet mutated. |
| `approveSpec` (`approval.ts:512`) | Defence in depth at the lib boundary, for any caller that reaches `approveSpec` without going through the command. It cannot prevent the `advanceSpecToImplementing` flip, so it is a backstop — not the primary gate the earlier draft claimed. |
| `advanceSpecToImplementing` (`spec.ts:568`) | DQ-2's shared guard. This is the single function that writes `plan → in-progress` via `phasesForApproval`. It has exactly **one production call site today** — in `packages/minspec/src/commands/approve.ts` — so guarding it adds no coverage *now*; its whole value is that any **future** actor (DR-057's drain consumers, the phase-advance queue) inherits the check without having to remember it. That is DQ-2's stated rationale — fix the class, not today's actor — and it should be justified on those terms, not on a caller count. |

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

`validateOwnership` is **already well covered**: `packages/minspec/tests/ownership.test.ts`
holds 14 tests spanning AC-1..AC-7, the plan-boundary trigger (`plan: pending` exempt vs
`in-progress` required), the `none`-escape including the reason requirement, greenfield
paths, and two false-positive regressions. So this spec **extends an existing suite** rather
than founding one, and the extraction in (1) must keep every one of those 14 green — they
are the de facto contract for the matcher being shared.

> *Corrected 2026-08-07: an earlier draft of this Plan claimed `validateOwnership` had no
> covering tests, taking a codegraph "no covering tests found" blast-radius line at face
> value instead of grepping `packages/minspec/tests/`. It was wrong, and it mattered — it
> would have justified work already done and mis-stated the risk of the extraction.*

New tests are needed for the **guard** (which genuinely has none, since it does not exist
yet) and for guard↔validator parity.

| Tier | Test | Asserts |
|---|---|---|
| T0 | approve refuses undeclared T3/T4 primary | **no sidecar is written, no status flip, no baseline minted** — assert absence of side effects, not just the throw |
| T0 | `implements: none` + reason approves cleanly | FR-4 escape reachable pre-approval |
| T0 | T1/T2 and non-primary specs approve unguarded | AC-7 scope, no regression |
| T0 | guard and `validateOwnership` agree on a shared fixture table | INV-5 single-matcher parity — the R5 drift risk |
| T0 | the 14 existing `ownership.test.ts` cases stay green after extraction | the extraction is behaviour-preserving; those cases are the matcher's real contract |
| T0 | `advanceSpecToImplementing` refuses undeclared, leaves phases untouched | DQ-2 class fix; no half-advance |
| T1 | greenfield path (not yet on disk) satisfies the guard | SPEC-038 FR-4 — `isValidOwnedPath` excludes existence |
| T3 | regression: the four ownership-trap red-mains of 2026-08-06/07 | SPEC-051, SPEC-048, SPEC-049, SPEC-035 shapes cannot recur (DR-015's red-main that night was a separate Rule-16 mechanism) |

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
