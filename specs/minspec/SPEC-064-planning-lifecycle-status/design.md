---
id: SPEC-064
type: design
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — an approved-but-unbuilt spec must not read 'implementing'
relates_to: [DR-069, DR-034, DR-003, DR-012, DR-031, SPEC-022, SPEC-041, SPEC-038, SPEC-059]
implements: none
implements_reason: Plan document for a back-fill spec that builds nothing. requirements.md declares `implements: none` and this file does not change that - see D2 below, where declining to take code ownership is the decision.
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-064 - Plan: closing the three Clarify decisions (Design)

> **Why this file exists.** `requirements.md` carries a valid founder approval
> (`approvedAt: 2026-08-23`, verdict APPROVED). Recording these answers there would stale
> that signature and cost a re-approval keystroke for text that decides nothing about the
> already-shipped behaviour. This shard has no approval sidecar, so it is free to write.
> It also clears one of the two `split-coverage` WARNs `npm run validate` raises against
> this spec, which is at `plan: in-progress` and had no Plan document.
>
> Measured before writing: `owned_file_set()` for SPEC-064 computes **0** files, so nothing
> here freezes any path for a concurrent session.

## Clarify - resolved

All three questions in `requirements.md` §"Decisions needed (Clarify)" are answered below.
The original options and their authoring-time recommendations stay where they are; this
file records what was chosen, on what evidence, and what the choice costs. Two of the three
outcomes differ from the authoring-time recommendation, and one of the questions turned out
not to be a live fork at all.

### D1 - `implementing` must imply an active implement phase: ACCEPTED in principle, sequenced, and NOT discharged here

**Answer: Option A (a merge-gating validator rule), but it cannot land as a single step, and
SPEC-064 is not the spec that lands it.**

The premise held and understated the gap. `status.mirror-drift` is `severity: 'warning'`
([`spec-validator.ts:979`](../../../packages/minspec/src/lib/spec-validator.ts#L979)) as the
question says - but it is not merely non-gating. It never runs over the corpus at all:
`scripts/validate-frontmatter.ts` never calls `validateSpec` and never supplies an
`approvalState`, and the rule is guarded by `if (approvalState !== undefined)`. So
`npm run validate` cannot emit a `status.mirror-drift` finding under any input. The
question's framing ("caught by the model/human, not by a gate") is right about the outcome
and wrong about the mechanism: there is no WARN to promote, because the WARN does not fire.

**Blast radius, measured 2026-09-18 on `main`** with `npm run facts status` over every
tracked spec file:

| | count |
|---|---|
| spec files scanned | 101 |
| literal `status:` disagrees with derived | **66** |
| of those, no `phases:` block (derive `new`) | 58 |
| of those, has a `phases:` block | 8 |
| control - files carrying a `phases:` block at all | 42 |

The control matters. An earlier pass of this measurement put all 66 in the phaseless bucket
because its frontmatter reader errored on every row, and a uniform wrong answer is
indistinguishable from a clean one. The 42/101 control is what establishes the classifier
discriminates.

A second trap, recorded so the next reader does not fall in it:
`npm run validate | grep mirror-drift` returns **2 hits on a clean corpus**. Both are the
substring inside `SPEC-059-status-mirror-drift-gate`'s own directory name. The honest count
from that command is zero, and that zero is vacuous - it measures a rule that never ran.

**Why Option A cannot land in one step.** Made merge-gating today, the rule fails 66 of 101
files. That is a flag day, and constitution invariant 2 forbids softening it with a
best-effort escape. The sequence is therefore:

1. **Backfill the 66** - tracked as **#898**. Free: `canonical.ts` strips `status` and
   `phases` from the hashed bytes, so rewriting these literals stales no approval. Must walk
   **shards**, not specs: 39 of the 66 are `design.md`/`tasks.md` files, so a per-spec
   migration that rewrites only `requirements.md` leaves two of three still lying.
2. **Wire the corpus check as WARN** - **SPEC-059 FR-2**, unbuilt. Until this exists there
   is no instrument that can report the drift count, which is why D1 could not be answered
   on measured evidence when it was written.
3. **Promote to gating** - tracked as **#1807** (*"`status.mirror-drift` is defined but runs
   on NO merge-gating surface"*), which is D1's finding already filed as an issue.

**What the producer fix already covers, so the gate is not sized for it.** #957 is CLOSED /
COMPLETED (2026-08-23). `advanceSpecToImplementing` no longer has a phaseless branch, calls
`setSpecPhases(..., { createIfAbsent: true })`, and throws if the persisted `status:` does
not re-derive from the persisted `phases:`
([`spec.ts:625-660`](../../../packages/minspec/src/lib/spec.ts#L625-L660)). The tool can no
longer write this drift. A gate added now defends only against **hand-edits and foreign
producers** - still worth having under *enforce, don't trust the model*, but a smaller claim
than the question assumed.

**Cost of this answer, stated plainly.** D1 closes as *decided, deferred*: SPEC-064 declares
`implements: none` and owns none of the three steps, so its Clarify pass closes on a
conclusion it cannot itself discharge. If the #898 backfill slips, step 3 never becomes
safe, the WARN stays invisible, and the corpus arrives at Option B (status quo) by a longer
road while believing it chose Option A. The mitigation is that each step is filed and
numbered rather than left as prose.

**Rejected: Option B (status quo - corrected derivation plus WARN only).** Rejected because
the WARN it relies on does not execute, so "corrected derivation plus WARN" is really
"corrected derivation plus nothing". The derivation fix is genuine and load-bearing, but it
constrains only the tool path, which #957 already closed by construction.

**Rejected: adopting Option A as an immediate blocking rule.** It is the authoring-time
recommendation read literally, and it fails 66 files on the first run.

### D2 - the freeze-gate-twin parity test: LEAVE STANDALONE as #899

**Answer: Option B - this spec records INV-3 and does not absorb #899. This reverses the
authoring-time recommendation, which was Option A.**

**#899 is OPEN** (verified 2026-09-18), so unlike D3 this is a live fork.

The authoring-time case for Option A is real and is not disputed here: an invariant whose
only guard is a prose comment at each of three twins is the model-trusted drift class the
constitution warns about, and it is INV-3's own failure mode. What defeats it is what
pulling #899 in would cost *this* spec:

- SPEC-064 is a **back-fill requirements spec that builds nothing** and declares
  `implements: none` with an `implements_reason` saying so. Absorbing #899 gives it code
  ownership for the first time.
- Declaring `implements:` on an **already-approved** spec is exactly the trap SPEC-051
  records: `canonicalizeSpec` strips only `status:` and `phases:`, so an `implements:` edit
  voids the founder signature. The declaration would have to be written *before* approval,
  and approval has already happened.
- The ownership machinery would not reliably carry it anyway: **#1633** - block-form
  `implements:`/`affects:` parses as a single path, dropping 41 of 48 declared paths
  corpus-wide.

So Option A trades a live founder approval for an ownership declaration that is currently
mis-parsed, in a spec whose whole premise is that it owns nothing.

**Cost of this answer.** INV-3 stays guarded only by the "do not align" prose comments at
the three twins for as long as #899 is unscheduled. Choosing Option B does not shrink that
hole and does not schedule the test - it only declines to widen this spec to cover it. If
the twins drift before #899 lands, the freeze-gate hole DR-031 closed can reopen silently,
and nothing here would catch it. That risk is accepted, named, and belongs to #899.

### D3 - the phaseless-spec residual: RESOLVED BY IMPLEMENTATION, and by neither option offered

**Answer: the question is no longer a live fork. The shipped code chose a third option.**

D3 asked whether a phaseless spec should default to `planning` at approval (Option A) or
whether approval should require a `phases:` block (Option B). What shipped does neither:
`advanceSpecToImplementing` **creates** the block at approval -
`setSpecPhases(filePath, newPhases, { createIfAbsent: true })` - then derives the status
from the persisted bytes and throws if the two disagree
([`spec.ts:625-660`](../../../packages/minspec/src/lib/spec.ts#L625-L660)).

That reaches Option B's goal - the ambiguous shape is eliminated, not given a lossy default
- without paying Option B's stated costs, which were a new approval precondition and a
migration of existing phaseless specs. Neither was needed, because the writer creates what
was missing instead of refusing the input. The in-code comment states the principle
directly: the post-condition *"the persisted bytes re-derive the written literal"* is a
property of the function, not a property of specs that happened to arrive with a block.

Tracked as **#957**, CLOSED / COMPLETED 2026-08-23, delivered under SPEC-061.

**The caveat this answer must carry, or it becomes a false signpost.** The shape is
eliminated only for approvals **from now on**. The 58 already-phaseless files measured under
D1 were never backfilled, so the corpus still carries the exact state D3 was about. Writing
"D3 resolved" without that sentence would claim the corpus is clean when 58 files say
otherwise. The backfill is #898, and it is the same step 1 that D1 depends on.

## Consequences for this spec's frontmatter

- `implements: none` is **confirmed by D2**, not merely inherited. It is now a decision with
  a reason rather than a placeholder awaiting Plan.
- No re-approval of `requirements.md` is owed: nothing above edits it, and this shard has no
  sidecar of its own.
- `phases.plan` can move to `done` once this file is reviewed; `tasks` stays `pending`
  because D1's three steps are owned by #898, SPEC-059 FR-2 and #1807 rather than by a task
  list here.

## Traceability

- **Decisions answered:** `requirements.md` §"Decisions needed (Clarify)" D1, D2, D3.
- **Open items D1 depends on:** [#898](https://github.com/AIClarityAU/minspec/issues/898)
  (backfill), SPEC-059 FR-2 (corpus check, unbuilt),
  [#1807](https://github.com/AIClarityAU/minspec/issues/1807) (promote to gating).
- **Open item D2 defers to:** [#899](https://github.com/AIClarityAU/minspec/issues/899).
- **Closed items relied on as evidence:**
  [#957](https://github.com/AIClarityAU/minspec/issues/957) (phaseless writer fix),
  [#886](https://github.com/AIClarityAU/minspec/issues/886) (the DR-069 trigger).
- **Measurement of record:** [#1513](https://github.com/AIClarityAU/minspec/issues/1513),
  re-measured 2026-09-18 from 26 to 66 files once the scan included shards and
  `specs/agent-execute/`.
- **Interacts with:** [#1633](https://github.com/AIClarityAU/minspec/issues/1633)
  (block-form ownership parsing), which is why D2's cost is higher than it looks.
