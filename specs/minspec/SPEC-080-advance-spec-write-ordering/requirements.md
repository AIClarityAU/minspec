---
id: SPEC-080
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a refused advance that mutates the file anyway is the writer lying about its own outcome
aspects: [validation, governance, tier-0, lifecycle]
depends_on: []
relates_to: [SPEC-061, SPEC-022, DR-003]
implements: none
implements_reason: >-
  Creates no new source file. `advanceSpecToImplementing` and `setSpecPhases` in
  packages/minspec/src/lib/spec.ts are owned elsewhere (SPEC-061 is the spec that most
  recently modified them), so the blast radius goes under `affects:`, matching how
  SPEC-061 and SPEC-059 classified the same modify-don't-own shape.
affects:
  - packages/minspec/src/lib/spec.ts
  - packages/minspec/src/commands/approve.ts
  - packages/minspec/tests/approve-phase-sync.test.ts
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — A refused approval must not mutate the spec file (Requirements)

> Materializes **[#1634](https://github.com/AIClarityAU/minspec/issues/1634)**
> (`hold:specify`, dispatched Specify-only per DR-076/#1169). Named as a known
> follow-up inside [SPEC-061](../SPEC-061-phaseless-approval-writer/requirements.md)'s
> AC-6 (amended 2026-08-22): *"The test for this MUST also assert that the refused
> approval left the file byte-identical, which it does not today ... an INV-1
> half-write, tracked as #1634."* Distinct from SPEC-061 itself: SPEC-061 is about the
> writer producing a self-contradicting *persisted* state (a prose/behaviour gap that
> is still open in that spec's own Plan phase); this spec is about the writer mutating
> the file on a path that is supposed to leave it untouched — live behaviour in
> already-shipped code, not a decision SPEC-061 still has open.

## One-Sentence Scope

Make `advanceSpecToImplementing` validate the whole advance in memory before it writes
anything, so a refused approval (the degenerate-phases-block gate) leaves the spec file
byte-identical and records no approval — instead of today's two real writes followed by
a throw that nothing rolls back.

## Context

Grounded in the current code, with `file:line` evidence (as shipped on `main` at the time
of filing; exact line numbers may have drifted slightly by the time this is read, but the
ordering described has not — verify against the live file before building).

### The write-then-verify ordering

`advanceSpecToImplementing` (`packages/minspec/src/lib/spec.ts:657-727`) does, in order:

1. `:685-691` — compute `newPhases` and `target` from the **in-memory** parsed frontmatter
   (no write yet).
2. `:692` — `setSpecPhases(filePath, newPhases, { createIfAbsent: true })` — **writes the
   `phases:` block to disk.**
3. `:696-701` — re-read the file and `setSpecStatus(filePath, persistedStatus)` — **writes
   the `status:` line to disk.**
4. `:707-713` — re-read again and assert the persisted status agrees with what the
   persisted phases derive (an internal-consistency check the docstring calls
   "should be impossible" — a defense-in-depth assertion, not the gate this issue is
   about).
5. `:717-725` — **the degenerate-block gate**: `if (persistedStatus !== target) throw`.

Steps 2 and 3 are real filesystem writes. Step 5 is the gate the function's own docstring
(`:644-650`) describes as rejecting the advance: *"the advance is REJECTED with a throw
rather than silently under-advanced."* But the throw runs **after** both writes landed —
so a "rejected" advance has, in fact, already been performed. Verification placed after
mutation can only ever report; it cannot prevent.

### No recovery in the caller

`packages/minspec/src/commands/approve.ts` calls `advanceSpecToImplementing` at `:345` and
`recordApproval` (the approval-sidecar writer) at `:346` — the very next line, inside the
same `try`. A throw at spec.ts step 5 skips `:346` entirely and lands in the `catch` at
`:414-418`, which only shows an error toast. `grep -niE 'rollback|restore|backup'` over
`approve.ts` returns zero hits — there is no code path that restores the file steps 2–3
already wrote.

### Net effect of a refused approval, observed

- the spec file **is** modified: `phases:` written, `status:` flipped (e.g. dropping
  `specifying` → `new` on a degenerate block, per the `it.each` fixtures at
  `approve-phase-sync.test.ts:433-443`),
- no approval record is written (`recordApproval` never runs),
- the user is told via the error toast that the advance was rejected.

The docstring's own words — *"the advance is REJECTED"* — describe the end state as if
nothing happened. Two of three steps landed. That is prose and behaviour disagreeing,
which this repo's Evidence Discipline names as the worst class of defect for a
"never-wrong" posture, and which SPEC-061's FR-6 rationale calls "the one thing that must
not happen."

### Why this has gone unnoticed

It is hash-harmless: `canonical.ts:51-74` (`stripLifecycle`) removes exactly `status` and
`phases` from the bytes a `specHash` is computed over, so a stale approval is never
created by this bug — the approval sidecar's hash still matches. That is precisely why it
survived: the one signal this repo already checks for lifecycle-field writes (hash drift)
cannot see this one, because the two fields this bug writes are the two fields the hash
deliberately ignores. It is still a real, uncommitted-by-anyone mutation of a tracked
file on a path documented to reject.

### The gate that failed

Nothing today asserts that a **failed** advance leaves the file untouched.
`packages/minspec/tests/approve-phase-sync.test.ts`'s `it.each` block at `:433-443`
(`'still throws on a degenerate block ... that cannot realize the target'`) asserts the
**throw** (`toThrow(/Cannot advance/i)`) but never reads the file back afterward. Per
RCDD (DR-003), the missing gate is the root cause alongside the ordering — a data/mechanism
fix without a test that would have caught the original defect just reproduces the same
class of unverified claim this repo's Evidence Discipline exists to prevent.

## Functional Requirements

- **FR-1 (compute and validate before any write).** `advanceSpecToImplementing` MUST
  determine, from data already available in memory (the parsed input frontmatter plus the
  same derivation `phasesForApproval`/`deriveStatus` already perform), whether the advance
  can be realized — i.e. whether the status the persisted bytes would derive equals the
  approval target — **before** calling `setSpecPhases` or `setSpecStatus`. If it cannot be
  realized, the function MUST throw the existing `Cannot advance ...` error and MUST NOT
  have written anything. *Rationale: removes the failure window at its source, per the
  issue's recommended fix (1), rather than compensating for it after the fact.*
- **FR-2 (a refused advance leaves the file byte-identical).** When FR-1's pre-write check
  fails, the spec file on disk MUST be byte-for-byte identical to its state immediately
  before the call. *Rationale: the throw is supposed to mean "nothing happened"; this makes
  that true rather than merely stated.*
- **FR-3 (no approval record on a refused advance).** `approve.ts`'s existing control flow
  already guarantees `recordApproval` never runs when `advanceSpecToImplementing` throws (a
  throw skips the next line in the same `try`). This spec MUST NOT weaken that guarantee —
  no change to `approve.ts` is required unless Plan finds the restructuring in FR-1 needs
  one. *Rationale: names the invariant explicitly so a future refactor of `approve.ts`
  cannot reintroduce a call to `recordApproval` that survives the throw.*
- **FR-4 (a successful advance is unchanged in outcome).** For every input shape that
  advances successfully today (a real `phases:` block, a phaseless spec via
  `createIfAbsent: true`, a skipped-phase spec, etc. — the existing passing cases in
  `approve-phase-sync.test.ts`), the persisted bytes, the returned status, and the body
  `**Status:**` line sync (`#667`) MUST be identical to today's behaviour. *Rationale: this
  is an ordering fix, not a behaviour change for the happy path — SPEC-061's already-landed
  FR-1/FR-2/FR-3/FR-7 contracts must survive untouched.*
- **FR-5 (the internal-consistency assertion at `:707-713` keeps its meaning).** That
  assertion is defense-in-depth against a "should be impossible" desync and is not the gate
  this issue is about (the degenerate-block gate at `:717-725` is). FR-1 MUST NOT remove or
  weaken the `:707-713` assertion; if the restructuring makes it genuinely unreachable
  (because the same check now runs pre-write), Plan decides whether to keep it as a
  belt-and-suspenders runtime check or fold it into the single pre-write validation —
  either way the property it guards (persisted status == persisted-phases-derived status)
  MUST still be asserted somewhere reachable. *Rationale: FR-1 must not trade one
  loud-throw safety net for a silently-removed one.*
- **FR-6 (hash-neutral, unchanged).** This spec touches only write **ordering**, not which
  frontmatter keys are written. `canonical.ts`'s `status`/`phases` stripping continues to
  apply unchanged; no new field is written, no existing field's final value differs for any
  input that advances successfully (FR-4). *Rationale: inherits SPEC-061 INV-2 unchanged —
  this is not a re-litigation of what gets written, only of when.*

## Acceptance Criteria

- **AC-1 (FR-1/FR-2, the regression — this is the test the issue asks for).** For each
  degenerate-block fixture already covered by `approve-phase-sync.test.ts:433-443`
  (`it.each`: no recognized child / only `implement:` / only `tasks:`), calling
  `advanceSpecToImplementing` on a copy of the file: (a) still throws
  `/Cannot advance/i`, and (b) the file's bytes after the throw are identical to its bytes
  before the call. Today (b) is untested and fails once asserted.
- **AC-2 (FR-3).** A test at the `approve.ts` level (or an equivalent unit test around the
  same call sequence) confirms that when `advanceSpecToImplementing` throws, no approval
  sidecar file is created/modified for that spec.
- **AC-3 (FR-4, no regression on the happy paths).** Every existing passing case in
  `approve-phase-sync.test.ts` (fresh spec, phaseless spec via `createIfAbsent`, skipped
  phase, `#667` body-status sync) still passes unmodified, with identical expected values.
- **AC-4 (FR-5).** A test (existing or new) still exercises the `:707-713`
  internal-consistency assertion's reachability/meaning after the restructuring — i.e. the
  property it guards is not silently dropped from test coverage even if its code shape
  moves.
- **AC-5 (FR-6).** `specHash(before) === specHash(after)` continues to hold for every
  successful advance, matching SPEC-061 AC-4's existing coverage.

## Invariants

- **INV-1 (no silent gate — constitution #2).** A refused advance fails **visibly** (the
  existing throw, message unchanged in substance) and **without a partial write** — never a
  silent half-write, and never a loud message describing a rollback that did not happen.
  This is the constitution invariant the issue cites directly: verification after mutation
  can only report, never prevent; FR-1 moves the check to where it can prevent.
- **INV-2 (hash-neutral lifecycle writes — inherited from SPEC-061 INV-2 / DR-034).**
  `status` and `phases` remain the only frontmatter this writer touches, and only on a
  successful advance.
- **INV-3 (Tier-0/offline).** Pure `fs` + string/frontmatter transforms, same as today. No
  network, no new dependency.
- **INV-4 (RCDD — mechanism plus the missing gate, DR-003).** The fix MUST pair the
  ordering change (the mechanism) with AC-1 (the gate that should have caught the original
  defect and did not). A restructuring without a test reading the file back after a refusal
  repeats the exact "data fix without the gate" pattern DR-003's addendum already names as
  insufficient.

## Decisions needed (Clarify)

- **How much of `advanceSpecToImplementing` gets restructured to satisfy FR-1.** The issue
  names two shapes and recommends the first:
  - **Option 1 (rec) — single-write restructure.** Compute the new frontmatter bytes (phases
    block + status line) entirely in memory, derive `persistedStatus` from those in-memory
    bytes rather than from a re-read, compare to `target`, throw if they disagree — and only
    call into the filesystem once both writes are known to be correct. *Cost:* this touches
    the one property the docstring at `:568-575`/`:694-696` calls out as deliberate —
    deriving status from what was **actually persisted** rather than the in-memory map,
    which exists (per #148) specifically to stop the two representations from diverging. A
    single-write version has to preserve "derived from what will actually be on disk" by
    construction (e.g. by serializing to a string and parsing that string back, never by
    trusting the in-memory map directly) rather than by re-reading the real file, which is
    the harder half of this change and exactly where a regression would hide unnoticed.
  - **Option 2 — write-to-temp-then-rename, or capture-original-and-restore-in-catch.**
    Strictly smaller diff; keeps today's write-then-verify order intact and compensates for
    it instead of removing it. The issue's own text calls this "strictly worse than (1)
    because they leave the ordering bug in place" — i.e. it fixes the symptom (bytes don't
    end up wrong) without removing the mechanism (a throw can still fire after a write),
    which is the shape DR-003's RCDD addendum flags as a data fix without a gate.
  - *Recommendation: Option 1, matching the issue's own — the higher up-front cost buys a
    function that cannot reintroduce this class of bug, rather than one where a future edit
    could again slip a throw in after a write.* Plan should confirm this before implementing;
    if Plan instead prefers Option 2 for a smaller diff, it should say so explicitly and
    accept that INV-1 is then satisfied by compensation, not by removing the failure window —
    a real difference in what the fix guarantees, not just in diff size.

## Out of Scope

- **Any change to what gets written on a *successful* advance.** FR-4/FR-6 pin this. SPEC-061
  owns the question of what values are computed; this spec owns only when they are
  committed to disk.
- **The internal-consistency assertion's message or the degenerate-block error message's
  wording.** Unchanged in substance; FR-1 only changes when the check that produces them
  runs, not what they say.
- **`recordApproval` / the approval sidecar's own atomicity.** Out of scope — this spec is
  about `advanceSpecToImplementing` not writing when it is going to refuse, not about making
  the sidecar writer itself transactional.
- **SPEC-061's own open Plan-phase work** (the `createIfAbsent`/`setSpecPhases` contract,
  corpus backfill, etc.). This spec depends on none of it landing first — the bug described
  here is present in the function as it ships today, independent of SPEC-061's own Plan
  phase completing.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Deriving status from in-memory bytes instead of a re-read (Option 1) quietly reintroduces the #148 divergence (persisted bytes disagree with what was validated) if the in-memory-to-disk serialization isn't exactly what `setSpecPhases`/`setSpecStatus` would have produced. | AC-3/AC-5 pin byte-identical happy-path output against the current passing test suite; FR-5 keeps the `:707-713`-style consistency assertion reachable as a defense-in-depth backstop. |
| R2 | A restructuring large enough to satisfy FR-1 touches the three call sites `setSpecPhases`/`setSpecStatus` share with other paths (e.g. the interactive "Advance Phase" command), risking an unrelated regression. | FR-4 requires every existing `approve-phase-sync.test.ts` case to still pass unmodified; AC-3 makes this a build gate, not a claim. |
| R3 | The fix stops at "throws earlier" without AC-1's byte-identity check, so the underlying claim ("nothing happened") stays unverified even after the reorder. | INV-4 / AC-1 make the byte-identity read-back a required test, not optional coverage — this is the gate DR-003 says must accompany the mechanism fix. |

## Traceability

- **Issue:** [#1634](https://github.com/AIClarityAU/minspec/issues/1634) — a refused
  approval still mutates the spec file.
- **Named by:** [SPEC-061](../SPEC-061-phaseless-approval-writer/requirements.md) AC-6
  (amended 2026-08-22) — flags this exact gap as "tracked as #1634" while fixing an
  adjacent-but-distinct defect (the writer producing a self-contradicting persisted state).
- **Writer:** `packages/minspec/src/lib/spec.ts:657-727` (`advanceSpecToImplementing`),
  `:570-620` (`setSpecPhases`), `:445-515` (`setSpecStatus`, exact range approximate —
  verify against the live file).
- **Caller:** `packages/minspec/src/commands/approve.ts:332-366` (`approveSpecCommand`'s
  `try` block — `advanceSpecToImplementing` at `:345`, `recordApproval` at `:346`, `catch`
  at `:414-418`).
- **Hash boundary:** `packages/shared/src/canonical.ts:51-74` (`stripLifecycle`) — why the
  bug is hash-harmless and therefore went undetected by the one drift signal this repo
  already has for lifecycle fields.
- **Existing regression coverage (throw only, not byte-identity):**
  `packages/minspec/tests/approve-phase-sync.test.ts:433-443`.
- **Method:** RCDD Phase 4 ([DR-003](../../../docs/decisions/DR-003.md)) — mechanism plus
  the gate that failed.
