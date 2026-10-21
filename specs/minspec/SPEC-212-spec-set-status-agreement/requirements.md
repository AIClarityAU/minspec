---
id: SPEC-212
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - a cross-file agreement check on the spec-set is part of the methodology's validator
aspects: [validator, status, signpost, spec-set, no-silent-gate]
depends_on: [SPEC-001]
relates_to: [SPEC-040, SPEC-041, SPEC-042, SPEC-043, SPEC-044, SPEC-046, DR-003, SPEC-059, "#277", "#972", "#971", "#918"]
---

# SPEC-212: One status per spec-set - sibling docs must not lag requirements.md

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers the Clarify questions, and approves it through the normal spec-approval gate
> before any code changes.

Materializes **#972** - *"sibling spec docs advertise `status: specifying` under an approved
requirements.md."* Id `SPEC-212` is the collision-gate shape: one above the highest `SPEC-NNN` on `origin/main` at
revision b6ec4ff6 (`SPEC-211-shipped-guard-test-parity`), not a gap-fill below it. Open
pull requests are not visible offline, so renumber if it still collides.

## Problem

`status` is a signpost. Inside one spec-set (`specs/<product>/SPEC-NNN-<slug>/`) it is authored
per file, and the approve command writes the new status to the approved artifact
(`requirements.md`) only. Siblings keep whatever they were drafted with, so each approval
opens a gap and the answer to "may work proceed?" depends on which file you open.

**Measured on this worktree's base** (first `status:` line of each file; the issue's table is
partly stale, so the rows below replace it):

| Spec | requirements.md | design.md | tasks.md |
|---|---|---|---|
| SPEC-041 | implementing | specifying | - |
| SPEC-042 | planning | specifying | specifying |
| SPEC-043 | implementing | specifying | implementing |
| SPEC-046 | planning | specifying | - |
| SPEC-040 | done | done | done (no gap now; the issue listed it) |
| SPEC-044 | implementing | implementing | implementing (agrees) |

Note SPEC-042 and SPEC-046 are `planning` on requirements while design is `specifying`: the
issue called them "approved/implementing", but a `planning` requirements with a still-drafting
design is also a lag by FR-2's ordering.

**Mechanism:** status is hand-authored per file; only one file is written on approval.
**Missing gate:** `spec-validator.ts` checks each file's frontmatter presence and validity
(`status` is a required field per file, `spec-validator.ts:540`). One adjacent cross-file check
already exists: `validateStatusMonotonicity` (#277, `spec-validator.ts:1467-1583`) asserts the
parent requirements status is >= its design/tasks children, using the same `LIFECYCLE_RANK`
order as FR-2. It does NOT cover this defect, for two measurable reasons:

- **Different input.** #277 compares DERIVED status (`deriveStatus`, `spec-validator.ts:1478-1479`
  comment: "never the literal `status:` line"), deliberately so a stale mirror cannot produce a
  false warning. This defect IS the stale literal: a reader opening `design.md` sees the
  literal line, and derived status is blind to it.
- **Opposite direction.** #277 flags parent BEHIND child. SPEC-212 flags sibling BEHIND parent
  (the shape every approval creates). The two are mirror images and do not overlap.

SPEC-059 (`status.mirror-drift`, literal vs derived status for ONE file) is also adjacent; it
checks a single file against its own derivation, not one file against its siblings. The Plan
phase must confirm no overlap by reading both rules, not by assumption.

## Functional requirements

- **FR-1 Spec-set grouping.** The validator groups artifacts by their `SPEC-NNN-*/` directory.
  Single-file specs and sets without a `requirements.md` are out of scope and never flagged.
- **FR-2 Lag rule.** Within a set, a sibling (`design.md`, `tasks.md`) whose `status` ranks
  strictly below `requirements.md`'s on the lifecycle order `new < specifying < planning <
  implementing < done` is a violation. Terminal statuses `archived` and `superseded` on
  `requirements.md` require siblings to carry the same status. A sibling ranked above is not a
  violation under this spec (see Decision DQ-2).
- **FR-3 Visible, never silent.** A violation names the sibling file, both status values and
  the fix ("set `status:` to X, or see DQ-1"). Severity per DQ-3. A sibling whose `status`
  cannot be parsed is reported, not skipped (a missing witness fails visibly).
- **FR-4 Backfill.** The rows above that violate FR-2 are corrected in the same change that
  lands the rule, so the rule ships green on `main`. Edits that touch an approved file go
  through the lifecycle-field exclusion in the canonical hash (`approval.ts:6`) - status edits
  must not stale an approval; the Plan phase confirms this by computing `specHash()` before
  and after, not by assumption.
- **FR-5 Same lens everywhere.** The check lives in the one validator module that both the
  extension's validate command and the headless/CI path import, so no consumer sees a different
  answer. It is a separate rule from #277's `status.cross-artifact.regression`, named for what
  it reads: it compares LITERAL `status:` lines (the signpost), where #277 compares derived
  status. The rule's doc comment must state this split so the two models of "status" are
  never conflated.

## Acceptance criteria

- **AC-1** A fixture set with `requirements.md: implementing` and `design.md: specifying`
  fails validation, naming `design.md` (T0 test, written first, shown red on base).
- **AC-2** A fixture set where all files carry the same status passes.
- **AC-3** A fixture set with `requirements.md: planning` and `tasks.md: new` fails.
- **AC-4** A single-file spec and a set with no `requirements.md` produce no finding.
- **AC-5** A sibling with an unparseable or absent status is reported (not skipped).
- **AC-6** `npm run validate` on the repo passes after FR-4's backfill; computing `specHash()`
  for each backfilled approved file gives the pre-edit value.

## Invariants this must not break

- Invariant 2 (no silent gate): a missing/unparseable sibling status fails visibly, and the
  check is deterministic code, not a prose rule.
- Invariant 1 (offline): purely local file reads.
- `status` is excluded from the approval hash, so correcting it must never void an approval.
- Existing per-file frontmatter validation is unchanged in behaviour.

## Decisions needed (Clarify)

**DQ-1 Police the field, or remove it from siblings?**
- **Option A (rec): police agreement (FR-2).** Keeps `status` on every file. Cost: the field
  can still drift between approvals until the validator catches it; each approval needs a
  sibling bump (or a follow-up that automates it).
- Option B: siblings omit `status` (the issue's "(1)-strict", mirroring `tier`). Removes the
  drifting field. Cost: `status` is required per file today (`spec-validator.ts:540`;
  the "21/21 present" comment at line 535 sits on the `id` entry), the parser coerces absent to `new`, and an unknown number of consumers
  (status views, parity checks, lifecycle writers for design/tasks) read sibling status. That
  consumer audit is unmeasured; adopting B means a larger, riskier change than a validator
  rule. `tier` was easy because it was already `requiredWhen` primary.

The issue prefers B "if it does not break the approval sidecar lookup". Not verified here: the
sidecar keys on the spec id and canonical hash, but sibling-status readers were not audited.
Recommendation is A now; B can follow as its own spec once the audit exists.

**DQ-2 Is a sibling AHEAD of requirements a violation?** (e.g. `tasks: implementing` under
`requirements: planning`.) Option A (rec): not flagged - it can be legitimate mid-flight and
the issue concerns lag. Cost: a skewed set going the other way passes. Option B: require exact
equality. Cost: any phase where a sibling is genuinely drafted ahead warns.

**DQ-3 Severity.** The sibling #277 check is deliberately a WARNING because a transient
mid-authoring lag is legitimate. The case here is likewise normal mid-authoring: approving
`requirements.md` writes only that file, so the lag appears at every approval until the
siblings are bumped, and an error would red-gate that branch.
- Option A (rec): warning, matching #277, with FR-4's backfill so `main` starts clean. Cost:
  a warning can be ignored, which is the failure the issue describes; mitigated by the
  backfill leaving zero standing warnings, so any new one is visible signal. Escalation to
  error is a follow-up once the approve command bumps siblings automatically (Out of scope).
- Option B: error now. Cost: every approval, and any in-flight branch whose set lags, fails
  until the sibling is hand-bumped.

## Out of scope

Automating the sibling bump on approval (would belong in the approve command; file separately
if wanted). Cross-spec status checks. Changing the lifecycle vocabulary.
