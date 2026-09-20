---
id: SPEC-051
type: design
status: planning
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology — the spec→code ownership contract (SPEC-038's sibling)
relates_to: [SPEC-038, SPEC-022, DR-012, DR-034, DR-069, DR-077, DR-078, DR-088, DR-051, DR-003]
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

> **Two of these four were overtaken and are corrected below the table (checked 2026-09-12).**
> The 2026-08-07 answers are kept verbatim because they were correct when given; what changed
> is the world, not the reasoning. DQ-1 and DQ-4 both turned on "ownership stays inside the
> hash", and the founder reversed that on 2026-08-23.

| # | Decision | Chosen |
|---|---|---|
| **DQ-1** | What enforces "ownership before approval" | **A + C** — the template solicits `implements:` at Specify/Clarify (C), *and* the approve path refuses a T3/T4 primary spec that still has not declared it (A). Ownership stays **content**, so the hash keeps its re-review property (INV-2). |
| **DQ-2** | Where the Plan-crossing pre-check lives | **Shared guard.** Every actor that writes `plan → in-progress` calls one function. Fixes the class, not today's actor. |
| **DQ-3** | Specs already caught in the trap | **(a) + non-blocking surfacing.** Normal human re-approval; never an auto re-approve (FR-5). Plus a detector so trap-staled specs are visible rather than silently stranded. |
| **DQ-4** | Tier / DR needed | **No new DR.** A+C leaves `canonical.ts` untouched, so DR-034's hash contract is unchanged; only Option B would have required a DR amending it, and it was rejected. *The spec stays **T4*** (as `requirements.md` declares) — DQ-4 asked whether the *hash contract* forced T4 ceremony, and it does not; it did not propose re-tiering the spec. |

### DQ-1 — SUPERSEDED 2026-08-23. Ownership leaves the hash after all.

The table above says ownership stays **content**, and that Option B "was rejected". The founder
reversed that on 2026-08-23 answering
[#1481](https://github.com/AIClarityAU/minspec/issues/1481): `implements:`, `affects:` and
`implements_reason:` come **out** of the canonical approval hash. That is Option B, on exactly
DQ-1's question. It is recorded and ratified as
[DR-088](../../../docs/decisions/DR-088.md) — **`status: accepted`**, verified 2026-09-12.

Nothing here relitigates that. What it changes for this design:

- **The A-half survives, the reason for it does not.** The approve-path refusal is still
  wanted, but it is no longer justified by "the hash keeps its re-review property", because
  the hash no longer carries ownership. It has to stand on its own: an undeclared spec cannot
  arm the spec-gate, so the refusal is what makes the declaration happen at all.
- **§1 is not built.** `grep -c 'implements\|affects' packages/shared/src/canonical.ts` returns
  **0** (2026-09-12) — the strip is designed, not shipped.
- **And it must not ship first.** DR-088 rates "§1 lands before §2 is built" **High/High** and
  records a binding precondition: the `ownedAtApproval` snapshot must be **written and read**
  before ownership leaves the hash. Otherwise git history can no longer resolve what was
  approved, because every commit differing only in `implements:` hash-matches. §2 was itself
  open until **2026-09-05**, when it was decided as: snapshot the owned **set** at approve
  time and freeze on the **union** of the approved and current sets. That control is tracked
  as [#1800](https://github.com/AIClarityAU/minspec/issues/1800) and is **unbuilt**.

### DQ-4 — half superseded. The DR exists, and the chain worked.

"No new DR" was right on 2026-08-07 and stopped being right on 2026-08-23: choosing Option B
crossed the hash contract, approved INV-2 fired exactly as designed, and DR-088 was minted.
That is the invariant working, not a gap in it.

The tier half is unchanged and was never a live fork — `requirements.md` declares `tier: T4` in
frontmatter and separately declines to re-tier, on the grounds that re-tiering is itself a
re-stamp.

## Citation correction — `resolveBranchDestination` is DR-077, not DR-078

`requirements.md` attributes the `resolveBranchDestination` strand-refusal to **DR-078** in
four places, including INV-3 and Traceability. Measured 2026-09-12:
`grep -ln resolveBranchDestination docs/decisions/DR-0*.md` returns **only `DR-077.md`**.

- **DR-077** — *"The commit-destination rule has two implementations (a shell pre-commit hook
  and a TS guard) bound by a behavioral parity test"*. This is the record that owns the
  mechanism.
- **DR-078** — *"Standing push consent lives in the project's own gitignored preferences
  file"*. A different subject entirely.

The **claim** in `requirements.md` is true; only the record number is wrong. It is not
corrected there because doing so would change the approved bytes and stale a live human
sign-off for a citation fix — the same asymmetry this file exists to route around. Corrected
here, and in this file's `relates_to`, so the trail resolves.

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

> **What actually shipped differs from this design, and one half of it is inert.**
> Measured 2026-09-12; tracked as
> [#1806](https://github.com/AIClarityAU/minspec/issues/1806).
>
> - **The primary call site was never wired.** `commands/approve.ts` does **not** call the
>   shared guard. It inlines `violationsIntroducedByApproval` itself, so the actor a human
>   drives runs a second, independent copy of the refusal rather than the single function
>   DQ-2 chose. `grep -rn assertOwnershipDeclaredForAdvance packages/minspec/src` returns
>   exactly two production callers, `lib/approval.ts` and `lib/spec.ts` — neither is the
>   command.
> - **The `approveSpec` backstop is inert by ordering.** In `commands/approve.ts`,
>   `advanceSpecToImplementing` runs **before** `recordApproval`, and it writes
>   `phases.plan: in-progress` to disk. `violationsIntroducedByApproval` returns the *diff*
>   an approval would introduce, and `phasesForApproval` is idempotent on an already-advanced
>   map — so by the time the guard runs the diff is empty. It is reached, it runs, and it
>   passes. That is worse than not being called, because it emits a green signal.
> - **The `advanceSpecToImplementing` site is correctly placed** (before any write in that
>   function), which is why the defect is invisible from the guard's own tests: they exercise
>   it directly, with pre-advance bytes. Both halves pass; the composition does not.
>
> The row above argues this guard "adds no coverage *now*" and is justified by future actors.
> That was true of the design. As shipped it is the opposite: it is the only correctly-ordered
> call site, and the one the design called **Primary** is the copy.

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
