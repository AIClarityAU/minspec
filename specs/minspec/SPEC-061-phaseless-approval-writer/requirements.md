---
id: SPEC-061
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — an approved spec must be able to agree with itself
aspects: [validation, governance, tier-0, lifecycle]
depends_on: [SPEC-022]  # deriveStatus / phasesForApproval / the approval sidecar are SPEC-022's
relates_to: [SPEC-038, SPEC-059, DR-069, DR-034, DR-003]
implements: none
implements_reason: >-
  Creates no new source file. Every path is an existing module modified in place -
  `setSpecPhases`/`advanceSpecToImplementing` in spec.ts own the writer contract, and
  lifecycle.ts owns `deriveStatus`. Both are owned elsewhere, so the blast radius goes
  under `affects:`, matching how SPEC-051 and SPEC-059 classified the same
  modify-don't-own shape.
affects:
  - packages/minspec/src/lib/spec.ts
  - packages/minspec/src/lib/lifecycle.ts
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# MinSpec — A phaseless spec cannot agree with itself: fix the asymmetric approval writer (Requirements)

> Materializes **[#957](https://github.com/AIClarityAU/minspec/issues/957)**
> (`hold:specify`, dispatched Specify-only per DR-076/#1169). Measured while fixing
> **[#1513](https://github.com/AIClarityAU/minspec/issues/1513)** and
> **[#1543](https://github.com/AIClarityAU/minspec/issues/1543)**, which are this defect's
> two downstream consequences.

## One-Sentence Scope

Make the approval writer produce a spec that can reproduce its own literal status — by writing
the `phases:` block when it is absent instead of stamping a literal the file provably will not
re-derive — so that a missing frontmatter block can no longer silently disable the status
mirror, the ownership rule, and spec-gate arming at once.

## Context

Grounded in the current code, with `file:line` evidence.

### The writer pair is asymmetric

`setSpecStatus` **creates** its key when absent (`spec.ts:456-458`):

```ts
const newYaml = statusLineRe.test(yaml)
  ? yaml.replace(statusLineRe, `$1status: ${status}`)
  : `${yaml}\nstatus: ${status}`;      // <-- creates
```

`setSpecPhases` **returns early** when its block is absent (`spec.ts:482-483`):

```ts
const phasesIdx = lines.findIndex((l) => /^phases[ \t]*:/.test(l));
if (phasesIdx === -1) return;          // <-- no phases block -> nothing to rewrite
```

So an approval writes half the lifecycle state. `advanceSpecToImplementing` handles the gap by
short-circuiting (`spec.ts:555-557`):

```ts
if (!/^phases[ \t]*:/m.test(fmMatch[1])) {
  return setSpecStatus(filePath, 'implementing');
}
```

The inline comment already names this as the DR-069 residual and points at #957.

### The reader then contradicts the writer

`deriveStatus` tests `allPending` **before** the approval check (`lifecycle.ts:139-140`):

```ts
if (allPending(phases)) return 'new';
if (approvalState !== 'approved') return 'specifying';
```

`parseSpec` materializes every absent phase to `pending` (`spec.ts:246-252`, via `phaseStatusOf` at `:113-116`), so a phaseless
spec is always `allPending`. The writer stamps `implementing`; the reader returns `new`.

**A phaseless spec cannot agree with itself, whatever it was approved as.** Not a data
accident — a property of the current code.

### Measured consequence 1 — the status mirror

22 of 51 specs in this corpus were phaseless and drifting when this was written (#1513).
**Re-measured 2026-08-22: 27 of 58**, of which 23 are approved. `npm run validate` still passes
on every one — 140 non-fatal warnings, zero blocking errors, none about status drift. The claim
was right and the direction got worse.

### Measured consequence 2 — the ownership rule has never fired

`validateOwnership` arms only past Clarify (`spec-validator.ts:792-794`):

```ts
const inBuildPath = plan === 'in-progress' || plan === 'done';
```

A phaseless spec has `plan === 'pending'` forever, so the rule returns without looking. Giving
those specs a `phases:` block during the #1513 work armed it and produced **20 new blocking
errors on previously-clean main** (#1543) — all approved T3/T4 specs with no ownership
declaration.

Because the declaration is what arms the spec-gate for a spec's files
(`spec-validator.ts:816`, consumed at `scripts/hooks/spec-gate.py:350`), **file-ownership
protection has never been active for those twenty specs.**

### Why this survived

The absence of findings is indistinguishable from compliance. One missing frontmatter block
silently disables three things at once, and every surface reports success. Same family as the
inert `vi.setConfig` in a hook (#1399).

### The contract that is in the way is defended by one caller

`setSpecPhases`'s docstring states it "never invents one (its contract, preserving the file's
shape)". That contract has exactly **one** real consumer — `advanceSpecToImplementing`
(`spec.ts:566`). It is not a widely-relied-upon invariant; it is a local choice with a global
cost.

## Functional Requirements

- **FR-1 (write both halves, or neither).** The approval writer MUST persist a `phases:` block
  when the spec has none, so the written literal `status:` is one the persisted bytes
  re-derive. It MUST NOT stamp a literal the file cannot reproduce. *Rationale: removes the
  desync at its source rather than patching the branch.*
- **FR-2 (the created block is complete and ordered).** A created block MUST contain every
  phase in `PHASES` order, with values from `phasesForApproval` applied to the parsed
  (materialized-pending) map — the same computation the existing phases-block branch already
  uses (`spec.ts:559`). *Rationale: one code path decides phase values, not two.*
- **FR-3 (status is derived from persisted bytes, never the in-memory map).** After writing
  phases, the literal MUST be `deriveStatus(re-read phases, 'approved', explicitTerminal)`.
  This preserves the existing #148 discipline at `spec.ts:560-565` and extends it to the
  formerly-phaseless case. *Rationale: the property the current code protects for one branch
  must hold for both.*
- **FR-4 (hash-neutral by construction).** Creating the block MUST NOT change the spec's
  `specHash`. `canonical.ts` strips exactly `status` and `phases` (`canonical.ts:14-16`), so
  this holds if and only if the writer touches nothing else — no reflow, no reordering of
  other keys, no comment rewriting. *Rationale: an approval-time write that stales the very
  approval it is recording would be incoherent; verified in #1507 that the edit is free.*
- **FR-5 (idempotent).** Running the writer twice MUST produce byte-identical output the second
  time. *Rationale: approval is re-runnable (re-approval after staleness); a writer that
  appends on every run corrupts the file.*
- **FR-6 (do not silently widen `setSpecPhases`).** Either `setSpecPhases` gains an explicit,
  documented create-when-absent behaviour, or the creation lives in a separate function the
  approval path calls — Plan decides (DQ-1). Whichever is chosen, the shape-preserving contract
  MUST remain available to any future caller that needs it, and the docstring MUST stop
  describing a contract the code no longer has. *Rationale: the one thing that must not happen
  is prose and behaviour disagreeing again — that is the defect this spec exists to remove.*
- **FR-7 (no change to `deriveStatus` semantics).** This spec MUST NOT alter what `deriveStatus`
  computes, including the `allPending → new` ordering. Reordering the reader is the tempting
  alternative fix and is out of scope — see Out of Scope. *Rationale: keeps the blast radius on
  the writer, and preserves DR-069/#886 lifecycle meaning (INV-4 of SPEC-060's sibling
  reasoning).*
- **FR-8 (surface the coupling, do not auto-resolve it).** Fixing the writer will arm
  `validateOwnership` for any spec that subsequently gains a phases block. This spec MUST NOT
  auto-generate ownership declarations to keep the corpus green. *Rationale: #1521 — a blanket
  `implements: none` records false declarations and destroys the signal for specs that
  legitimately own nothing.*

## Acceptance Criteria

- **AC-1 (FR-1/FR-2).** Approving a fixture spec with no `phases:` block produces a file whose
  frontmatter contains a complete `phases:` block in `PHASES` order.
- **AC-2 (FR-1/FR-3).** For that same fixture, re-reading the persisted bytes and computing
  `deriveStatus(phases, 'approved', undefined)` equals the literal `status:` written — i.e. the
  file agrees with itself. Asserted on the bytes, not on the in-memory map.
- **AC-3 (FR-3, the regression).** The written literal for an approved, pre-implement, formerly
  phaseless spec is `planning` — **not** `implementing`. This is the exact #957 symptom.
- **AC-4 (FR-4).** `specHash(before) === specHash(after)` for the approval write, and the value
  still equals the stored sidecar hash when one exists.
- **AC-5 (FR-5).** A second approval run on the same file is a byte-for-byte no-op.
- **AC-6 (FR-2, degenerate block preserved) — AMENDED at Clarify 2026-08-22.** *As originally
  written this criterion could not pass:* it said a spec with a **partial** phases block that
  cannot realize the approval target still throws, and
  [approve-phase-sync.test.ts:229-255](../../../packages/minspec/tests/approve-phase-sync.test.ts#L229)
  feeds exactly that shape (`phases:` with only `specify: in-progress`) and asserts `planning`,
  green, no throw. After DR-069/#886 the target for a specify-only block **is** `planning`, which
  the persisted bytes reproduce, so `persistedStatus !== target` is false and the gate correctly
  stays silent. It also cited `spec.ts:517-521`, which is docstring prose, not the gate.
  **Amended criterion:** a spec whose `phases:` block contains no recognized phase child persists
  all-pending, derives `new` against a `planning` target, and therefore still throws at the
  degenerate-block gate — `spec.ts:591` (condition), `:592-598` (throw). That gate is not
  weakened by this change. **The test for this MUST also assert that the refused approval left
  the file byte-identical**, which it does not today: `advanceSpecToImplementing` writes phases
  (`spec.ts:566`) and the status line (`:575`) *before* the gate throws, with no rollback in
  `approve.ts` — an INV-1 half-write, tracked as
  [#1634](https://github.com/AIClarityAU/minspec/issues/1634).
- **AC-7 (FR-7).** `deriveStatus`'s truth table is unchanged: the existing `lifecycle.test.ts`
  cases pass untouched, including `allPending → new`.
- **AC-8 (FR-6).** A test asserts the documented behaviour of whichever function creates the
  block, so the docstring and the code cannot drift apart again.
- **AC-9 (FR-8).** No test fixture or migration in this spec's scope writes `implements:` or
  `implements: none` into any real corpus spec.

## Invariants

- **INV-1 (no silent gate — constitution #2).** After this change, a spec whose lifecycle state
  cannot be persisted fails loudly (the existing throw), never silently half-writes.
- **INV-2 (hash-neutral lifecycle writes — DR-034).** `status` and `phases` remain the only
  frontmatter the approval writer touches, so lifecycle transitions never void a content
  approval.
- **INV-3 (Tier-0/offline).** Pure `fs` + string transforms. No network, no new dependency.
- **INV-4 (writer/reader agreement is the property, not a special case).** The post-condition
  "the persisted bytes re-derive the written literal" must hold for **every** input shape, not
  only for specs that happened to arrive with a phases block.

## Out of Scope

- **Backfilling the drifting specs** (#1513) and **the missing ownership declarations**
  (#1543). This spec stops the source; the corpus cleanup is separate work with a separate
  human cost and must not be smuggled in behind a writer fix.
  **Correction (Clarify 2026-08-22) — the ordering in that sentence is backwards.** The
  ownership backfill is a **prerequisite** for FR-1 to reach anything, not a follow-on.
  `assertOwnershipDeclaredForAdvance` runs at `spec.ts:545`, **before** the phaseless
  short-circuit at `:555`, and it simulates the advance — `parseSpec` materializes absent phases
  to `pending`, `phasesForApproval` turns that into `plan: in-progress`, and `validateOwnership`
  fires. So an undeclared phaseless T3/T4 spec cannot be re-approved **today**, and never reaches
  the new write path. Measured 2026-08-22: of 27 phaseless T3/T4 specs, **4 declare ownership**
  (SPEC-025, SPEC-056, SPEC-062, SPEC-063) and **23 do not**. FR-1 can only ever fire on those 4
  plus specs written from here on. This spec is still worth shipping — it fixes the writer for
  every future spec and removes a live INV-1 defect — but it does not, on its own, resolve the
  corpus-wide drift its Context describes.
- **Reordering `deriveStatus`** so an approved phaseless spec derives `planning` instead of
  `new`. That removes the *visible* drift while leaving the ownership rule just as inert — it
  would make the corpus look correct without making it correct, which on a never-wrong posture
  is worse than doing nothing.
- **Requiring a `phases:` block at approval** (refusing instead of creating). Considered and
  rejected as the default: it converts a silent bug into a hard block for every existing
  phaseless spec, with no migration path. Recorded as DQ-2 in case Plan disagrees.
- **The `superseded` explicit-terminal resolver** (#1520) — adjacent status-derivation bug, its
  own fix.

## Decisions (Clarify — resolved 2026-08-22)

All three are answered. The original option lists are kept verbatim below, because two of the
three turned out not to be live forks at all, and a reader needs to see the option beside the
reason it was not a choice.

### DQ-1 → one function, with an **opt-in** `createIfAbsent` — not the unconditional widening this document recommends

`setSpecPhases(filePath, phases, { createIfAbsent })`, defaulting to today's shape-preserving
behaviour, with the approval path at `spec.ts:566` passing it.

**Why not plain Option A, which is this document's own recommended default: it contradicts this
document's own approved FR-6.** FR-6 says *"the shape-preserving contract MUST remain available
to any future caller that needs it."* Unconditional widening leaves no caller any way to obtain
it. The spec recommends an option that violates its own requirement, and that self-contradiction
is a larger finding than the A-versus-B choice — it survived authoring, review and approval.

**Why not Option B.** The duplication argument is measured, not rhetorical: `70d609f`
(`fix(#1520): one shared explicit-terminal resolver`) landed 2026-08-16 and collapsed three
hand-rolled copies of one mapping into `explicitTerminalOf`. That is this codebase drifting
duplicated logic, in this exact file pair, in the same week this spec was approved.

**What the recommendation's own evidence got wrong.** DQ-1 argues A is safe because "there is no
second caller today", making the risk hypothetical. There is no second *production* caller —
`spec.ts:566` is the only one, verified. But
[approve-phase-sync.test.ts:130-136](../../../packages/minspec/tests/approve-phase-sync.test.ts#L130)
is `it('is a no-op when there is no phases block')`, asserting the file is **byte-identical**
afterwards. Someone wrote a test specifically to pin the contract A inverts. Under the opt-in
form that test survives as the pinning test for the default, which is what AC-8 actually asks
for; under plain A it has to be deleted.

***Cost, stated plainly:*** a defaulted flag is a quiet failure mode. A future caller who forgets
`{ createIfAbsent: true }` silently reproduces the exact #957 half-write this spec exists to
remove, and nothing errors. Making the parameter required removes that hazard at the price of a
wider diff — the one production call site plus all three test call sites — and Plan should treat
"required or defaulted" as the one remaining sub-choice here.

### DQ-2 → A (create it). Not a live fork: approved FR-1 already mandates it.

FR-1 says the approval writer **MUST** persist a `phases:` block when the spec has none, and Out
of Scope already records refusing as *"considered and rejected as the default"*. Two approved
sections settle this, so DQ-2 was posing a question the document had already answered twice.

Creation is hash-free, measured twice: `614a569c` (#1507) added SPEC-059's block with its sidecar
hash unchanged, and inserting a full block plus `status: planning` into **this** spec reproduced
its stored hash exactly — which is how SPEC-061's own drift was repaired on 2026-08-22 at no
approval cost.

***Cost, corrected:*** the cost this document states — that 22 specs acquire machine-written
phase values a reader may mistake for authored ones — is real but describes a reach the writer
does not have. Per the Out of Scope correction above, FR-1 can only fire on the **4** phaseless
T3/T4 specs that declare ownership; the other **23** cannot be re-approved at all until someone
declares theirs. So the honest cost of A is the opposite of the one written: not too many specs
silently rewritten, but too few reached to fix the problem the Context describes.

### DQ-3 → delete the branch and its stale #957 comment. Control flow, not preference.

Not a judgement call. `advanceSpecToImplementing` tests the phaseless short-circuit at
`spec.ts:555` and `return`s at `:556`, so `:559-566` — where `phasesForApproval` runs and
`setSpecPhases` is called — is **never reached** for a phaseless spec. Whatever DQ-1 does to
`setSpecPhases`, leaving this branch means the creation code is never invoked on the only input
shape it exists for: FR-1 unmet, AC-1 and AC-3 fail. "Leave it unreachable" inverts which code
is unreachable.

Plan must also invert
[approve-phase-sync.test.ts:183-192](../../../packages/minspec/tests/approve-phase-sync.test.ts#L183),
which today asserts `implementing` and `not.toContain('phases:')` — the exact inverse of AC-1 and
AC-3 — and sweep `spec.ts:412`, whose comment documents `bodyStatusToken` as mirroring
*"`setSpecPhases` never adding"* and becomes false the moment FR-1 lands.

***Cost:*** deleting the branch removes the only path that produces a status-only flip, so
`advanceSpecToImplementing` gains a hard dependency on block creation succeeding for every input
shape. For frontmatter the corpus has not yet produced, approval will fail loudly rather than
half-write. That is the correct trade under constitution invariant 2, but it is a real behaviour
change: today a malformed spec still gets approved, afterwards it does not.

### The forks as originally posed


- **DQ-1 — Where does block creation live: widen `setSpecPhases`, or a new sibling?**
  - **Option A — widen `setSpecPhases` to create when absent (recommended default).** One
    function, one mental model, and its only real caller is the approval writer
    (`spec.ts:566`), so the blast radius is genuinely small.
    *Cost:* it silently changes the meaning of an exported function. Any future caller that
    wanted the shape-preserving behaviour would get creation instead, and the failure would be
    a surprise extra block rather than an error.
  - **Option B — a `setSpecPhasesCreating` sibling; the approval path calls it.** Preserves the
    existing contract untouched for anyone who wants it.
    *Cost:* two near-identical functions is exactly the duplication that produced #1520 — three
    hand-rolled copies of one mapping. The second function will drift from the first.
  - *Recommendation to confirm:* A, because the duplication risk in B is a defect this codebase
    has already been bitten by twice (#1520, #957), while A's risk is hypothetical — there is
    no second caller today.

- **DQ-2 — Create the block, or refuse to approve without one?**
  - **Option A — create it (recommended default).** No migration needed; existing phaseless
    specs become self-consistent the next time they are approved.
    *Cost:* it writes phase values the human never authored. They are computed by
    `phasesForApproval` from the approval act itself, so they are inferred-but-honest — yet a
    reader may later treat `plan: in-progress` as a statement someone made deliberately.
  - **Option B — refuse, and tell the author to add a phases block.** Nothing is inferred.
    *Cost:* every one of the 22 existing phaseless specs becomes un-re-approvable until hand
    edited, turning a silent bug into a hard block with no migration path.
  - *Recommendation to confirm:* A, with the created block carrying no comment claiming human
    authorship.

- **DQ-3 — Does this spec also delete the now-dead phaseless branch (`spec.ts:555-557`), or
  leave it unreachable?** Deleting it is cleaner and removes the stale DR-069-residual comment;
  leaving it is a smaller diff. *Recommendation to confirm:* delete, and remove the comment
  that points at #957 — a comment describing a residual that no longer exists is the same class
  of false signpost this spec is about.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Fixing the writer arms `validateOwnership` on any spec that gains a block, so future approvals of phaseless specs will start failing the ownership rule. | That is the gate working (#1543). FR-8 forbids auto-resolving it; the failure is loud and the fixHint names the remedy. |
| R2 | Widening `setSpecPhases` (DQ-1 A) surprises a future caller. | One caller today; FR-6 requires the docstring to state the new behaviour, and AC-8 pins it with a test. |
| R3 | A created block changes bytes and stales the approval being recorded. | FR-4 + AC-4. `canonical.ts` strips `status`/`phases`, and #1507 already demonstrated the edit is hash-free on a real spec. |
| R4 | The change silently weakens the degenerate-block throw (`spec.ts:591`, throw body `:592-598`; `:517-521` is the docstring describing it, not the gate). | AC-6 pins it explicitly, as amended. |
| R5 | Inferred phase values are later read as human-authored intent. | DQ-2's recommendation forbids a comment implying authorship; the values are exactly what approval means. |

## Traceability

- **Issue:** [#957](https://github.com/AIClarityAU/minspec/issues/957) — phaseless fallback stamps `implementing`.
- **Downstream consequence 1:** [#1513](https://github.com/AIClarityAU/minspec/issues/1513) — 26 of 51 specs drift; 22 are this shape.
- **Downstream consequence 2:** [#1543](https://github.com/AIClarityAU/minspec/issues/1543) — the ownership rule has never fired on 20 approved specs.
- **Precedent fix (data half):** [#1507](https://github.com/AIClarityAU/minspec/issues/1507) — SPEC-059's block reconstructed hash-neutrally.
- **Writer:** `packages/minspec/src/lib/spec.ts:445-463` (`setSpecStatus`), `:475-494` (`setSpecPhases`), `:528-566` (`advanceSpecToImplementing`).
- **Reader:** `packages/minspec/src/lib/lifecycle.ts:133-146` (`deriveStatus`), `:199-210` (`phasesForApproval`).
- **Hash boundary:** `packages/shared/src/canonical.ts:14-16`.
- **Method:** RCDD Phase 4 ([DR-003](../../../docs/decisions/DR-003.md)) — mechanism plus the gate that failed.
