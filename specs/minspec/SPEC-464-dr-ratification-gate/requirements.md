---
id: SPEC-464
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - code-change safety
aspects: [validation, decision-register, lifecycle, tier-0]
relates_to: [DR-064, DR-069, DR-003, "#1081", "#1066", "#137"]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-464: Gate DR ratification against the specs implementing it

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through
> the normal spec-approval gate. Requirements are written under each question's recommended option.

Materializes **#1081** (*gate DR ratification against the specs implementing it*).

## Problem

Code shipped under a `proposed` decision record twice in one week: DR-064 (eslint layer rules and
the cycle gate failing builds, #1009, while `proposed` until #1063) and DR-069 (`deriveStatus`
returning `planning`, `lifecycle.ts:120-145`, while `proposed` until #1080). Both were found by
eye. The register said "suggested, not adopted" while the decision was already enforcing behaviour.

**Root cause (mechanism + missing gate).** A DR authorises work; the work ships under a spec;
ratification is a separate human keystroke that no phase transition requires and no gate checks.
`scripts/validate-frontmatter.ts` verifies that a `relates_to`/`depends_on` reference *resolves*;
it never compares the referenced artifact's **state** with the referrer's. Same validator-asymmetry
class as #137. Related but distinct: #1066 (acceptance leaves no provenance) - this spec makes
ratification *happen on time*, #1066 makes it *evidenced*.

**Measured baseline (this dispatch, local worktree).** 1 DR on disk has `status: proposed`; no
spec's `depends_on`/`relates_to` cites it, so the ERROR tier introduces no existing failures and
needs no backfill. (Re-measure at plan time; the corpus moves.)

## Functional requirements

- **FR-1 - Implementing-reference resolution.** For each spec, compute the set of DRs it
  *implements* per the answer to Decision 1 (recommended: an explicit `implements_dr:` list).
- **FR-2 - WARN at implementation.** When a spec's `phases.implement` is `in-progress` and an
  implemented DR has `status: proposed`, `validate` emits a `warn()` naming both ids and the
  remedy: *"SPEC-NNN is implementing DR-NNN, which is still `proposed` - ratify it or record why
  implementation precedes ratification."*
- **FR-3 - ERROR at done.** When a spec's `phases.implement` is `done` and an implemented DR has
  `status: proposed`, `validate` calls `fail()` (fatal, non-zero exit) naming both ids.
- **FR-4 - Recorded exception.** A spec may carry `implements_dr_waiver: "<reason>"` (Decision 3)
  to silence the WARN of FR-2 only. It never silences FR-3.
- **FR-5 - Fail closed on a missing witness.** A cited DR id that does not resolve to a DR file,
  or a DR file whose `status` cannot be parsed, is an ERROR under this rule, never a silent skip
  (constitution invariant 2). A scan that finds 0 specs or 0 DRs warns loudly, matching the
  zero-scan guard of Rules 17/18.
- **FR-6 - Which statuses block.** Only `proposed` triggers FR-2/FR-3. `accepted`, `superseded`,
  `rejected`/`deprecated` do not (a superseded or rejected DR is a different defect, out of scope).
- **FR-7 - Offline, deterministic.** Pure file reads and string comparison; no network, no model
  call (invariant 1). Pure logic lives in a `packages/minspec/src/lib/` helper called from the
  script, with unit tests, following the existing Rule 17/18 pattern.
- **FR-8 - Traceability.** The message and the script comment cite #1081, DR-064, DR-069 as the
  earning incidents.

## Acceptance criteria

- **AC-1.** Fixture: spec with `implement: in-progress` implementing a `proposed` DR -> warning
  with both ids, exit 0.
- **AC-2.** Same fixture with `implement: done` -> fatal, exit non-zero.
- **AC-3.** Same fixtures with the DR `accepted` -> no output.
- **AC-4.** Spec at `implement: pending` or earlier citing a `proposed` DR -> no output (planning
  against a proposal is the normal path).
- **AC-5.** Spec citing a nonexistent DR id, or a DR with unparseable status -> fatal (FR-5).
- **AC-6.** Spec with a waiver and `implement: in-progress` -> no warning; with `done` -> still fatal.
- **AC-7.** Spec that merely `relates_to` a `proposed` DR (not in the implementing set) -> no output.
- **AC-8.** `npm run validate` is green on `main` after the rule lands (no backfill needed per the
  baseline), and the rule is exercised by tests that fail on a base without it.

## Invariants this change must not break

- **INV-1** Offline, no network (constitution invariant 1).
- **INV-2** No silent gate: missing/unparseable witness fails closed and visibly (invariant 2); the
  rule runs inside `validate`, which CI already requires, so no single optional producer carries it.
- **INV-3** Blast radius is the installed project (invariant 3): the rule runs only where
  `.minspec/` and `docs/decisions/` exist; a repo with no DR register is a no-op, not an error.
- **INV-4** Existing validate output and exit codes for unaffected specs are unchanged.
- **INV-5** Does not alter how acceptance is recorded (that is #1066).

## Out of scope

Provenance of acceptance (#1066); the commit-stranding of accept (#1064); auto-ratifying a DR;
checking DR-to-DR state; a spec-phase transition hook in the editor (the gate lives in `validate`).

## Decisions needed (Clarify)

1. **Which reference counts as "implements"?**
   - **(a) New explicit `implements_dr:` frontmatter list (rec)** - exact, no false positives, so
     safe for the ERROR tier. Cost: a new frontmatter key to document and teach the scaffold, and
     existing specs must opt in (SPEC-040 would add `implements_dr: [DR-064]`); an unmigrated spec
     is silently outside the gate.
   - **(b) Reuse `depends_on` only** - no schema change and covers SPEC-040 today. Cost: false
     positives for DRs a spec merely depends on, which is unacceptable at ERROR, so FR-3 would
     have to downgrade to WARN and the issue's ERROR tier is lost.
   - **(c) Any `relates_to`/`depends_on` DR** - widest net. Cost: SPEC-040 would flag DR-014 it
     does not implement; noisy, adds to the ~100 existing warnings nobody reads.

   *Recorded selection: (a). An agent copied the (rec) option; no human chose it.*
2. **Should ERROR also apply at `implement: in-progress` after N days?** Options: **no, keep the
   issue's two tiers (rec)** - simple; cost: a long-running spec can sit at WARN indefinitely.
   Or add an age cap - closes that hole but needs a date source the spec lacks today.
   *Recorded selection: no age cap. An agent copied the (rec) option; no human chose it.*
3. **Waiver mechanism.** **`implements_dr_waiver:` string, WARN-only (rec)** - gives "record why
   implementation precedes ratification" a machine-readable home; cost: one more key and a
   free-text reason nobody audits. Alternative: prose in the spec body, unchecked, which fails
   the "no silent gate" intent.
   *Recorded selection: waiver key. An agent copied the (rec) option; no human chose it.*
4. **Gate location.** **A `validate-frontmatter.ts` rule (rec)** - runs in CI and pre-merge already;
   cost: it fires at PR time, not at the moment the phase flips in the editor. Alternative: also a
   phase-transition check in the extension (later spec; larger blast radius).
   *Recorded selection: validate rule only. An agent copied the (rec) option; no human chose it.*
