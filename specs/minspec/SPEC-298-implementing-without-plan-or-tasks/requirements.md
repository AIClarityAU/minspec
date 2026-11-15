---
id: SPEC-298
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - the status signpost must not lie (RCDD / DR-003)
aspects: [lifecycle, status, validator, signpost, audit]
depends_on: []
relates_to: ["#3413", "#917", "#2175", "#1441", "#2221", "#3352", "#1876", "#886", "DR-069", "DR-003", "DR-076"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decisions D1-D3.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-298: A spec at `implementing` must have evidence of a build, or be moved off it

> **This is a SPECIFICATION ONLY.** Written for issue
> [#3413](https://github.com/AIClarityAU/minspec/issues/3413). Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.
>
> Design rests on: **DR-069** (`planning` status: approved but implement phase not started),
> **DR-003** (RCDD: a status signpost must not lie).

## In plain terms

16 specs say `status: implementing` but have no `design.md` and no `tasks.md`, so nothing can
build them, nothing can close them, and nobody can tell whether they are built. The status was
set by approval (or a bulk correction) before the `planning` status existed, and no gate has
asked them for evidence since. This spec does two things: **(A)** a one-off audit that moves
each of the 16 to its honest status, and **(B)** a standing check so the state cannot return
unseen.

## Measured state (issue's base `5d524f96`, 2026-10-31; this worktree re-read 2026-11-12)

Line numbers rot; Plan re-reads them. Figures below are the issue's, except where marked.

- The 16: SPEC-005, 006, 010, 011, 012, 013, 014, 021, 023, 025, 028, 030, 032, 033, 063 (all
  under `specs/minspec/`) and **SPEC-016, which lives under `specs/agent-execute/`**
  (SPEC-016-reality-check) - a per-product scan must cover both products.
  (Verified here: all 15 minspec specs still read `status: implementing` and hold only
  `requirements.md`. SPEC-016's directory not inspected here.)
- 15 of 16 have no `phases:` block (all but SPEC-025) - per the issue, not re-verified here.
- Producers (issue's belief, SPEC-005 history only): `advanceSpecToImplementing`
  (`packages/minspec/src/commands/approve.ts:388`) and bulk correction commit 85d01734.
- `deriveStatus` (`packages/minspec/src/lib/lifecycle.ts:134-146`) yields `planning` vs
  `implementing` only from a `phases:` map; a spec with no map is outside it.
- Built-or-not is **unknown** for all 16 (issue did not read the code). #917 and #2175 report
  SPEC-014 and SPEC-063 as having no code, so at least some `implementing` values are false.
- SPEC-011 carries an inline note ("built: epic-backfill.ts ... 40 tests pass") on its status
  line - an unverified assertion, to be checked like the others.

## Functional requirements

- **FR1 - Audit.** For each of the 16, every numbered requirement is checked against the code
  and given a verdict (met / not met / not applicable) with a `file:line` citation (or the
  explicit statement that none exists). A requirement without a citation counts as not met.
- **FR2 - Verdict to status.** Spec with every requirement met -> `status: done`. Otherwise ->
  `status: planning`, with a gap list (one line per unmet requirement) recorded in the spec
  body under a `## Gaps found by audit` heading, and nothing else in the body changed.
- **FR3 - Approval survives.** Status is stripped before hashing, so no approval should go
  stale. For each spec, `specHash()` is computed before and after and the two must be equal; any
  difference blocks that spec's change and is reported.
- **FR4 - Read-only audit.** The audit makes no code change and no network call; its only
  output is the status edits and gap sections of FR2, in one pull request.
- **FR5 - Standing check.** The spec validator (`validateSpec`, `spec-validator.ts`) emits a
  **warning** (not an error) for a spec whose status is `implementing` and which has no
  `tasks.md` in its directory. The message names the spec and says to run the audit or move it
  to `planning`.
- **FR6 - Check is visible, not silent.** The warning appears in `npm run validate` output and
  the editor's validation panel like other warnings (invariant 2: no silent gate). A validator
  error while reading the directory is reported, never treated as "has tasks.md".
- **FR7 - Opt-in scope.** The check runs only in a repo with `.minspec/` at its root
  (invariant 3).

## Acceptance criteria

- AC1: after the audit pull request, none of the 16 reads `implementing` without a `tasks.md`.
- AC2: each changed spec has per-requirement citations in the PR body or the spec's gap list.
- AC3: `specHash()` before == after for all 16 (FR3), shown in the PR body.
- AC4: a fixture spec at `implementing` with no `tasks.md` produces the FR5 warning; the same
  spec with a `tasks.md`, or at `planning`/`done`/`specifying`, produces none.
- AC5: the check works with no network (invariant 1).

## Invariants this must not break

1. Offline: no network calls (constitution invariant 1).
2. No silent gate: the check warns visibly and fails visibly on read errors (invariant 2).
3. Blast radius: only a repo with `.minspec/` is affected (invariant 3).
4. A status change never stales an approval (FR3 proves it per spec).
5. Evidence discipline: no spec moves to `done` on a plausible inference - only on a cited line.

## Out of scope

- Writing `design.md`/`tasks.md` for the specs that land at `planning` (the plan writers,
  #1876, pick them up once they read `planning`).
- Closing finished specs from `tasks.md` (#3352) and planning-spec shipped detection (#2221).
- Closing the broader escape for specs with no `phases:` map (#1441) - this spec only adds the
  warning for the `implementing` case.

## Decisions needed (Clarify)

- **D1 - Who audits, and how.** (a) **(rec)** one read-only audit job on a capable model,
  16 specs, one PR. Cost: ~16 spec reads, and the verdict on an old spec can be arguable.
  (b) Leave them as they are. Cost: the tally keeps overstating work in progress and any real
  gap stays invisible. (c) Bulk-set all 16 to `planning` with no code reading. Cost: cheap, but
  a built spec is then mis-reported as unbuilt and nothing is learned.
- **D2 - Severity of the standing check.** (a) **(rec)** warning, per the issue. Cost: a
  warning can be ignored. (b) error once the audit has landed. Cost: any legitimately
  `implementing` spec whose tasks live elsewhere breaks `npm run validate` until migrated.
- **D3 - Where the check lives.** (a) **(rec)** in `validateSpec`, beside the other spec
  warnings. Cost: it needs the spec's directory, which `validateSpec` may only see as text -
  Plan must confirm. (b) a separate `scripts/` validator run from `npm run validate`. Cost: a
  second predicate that can drift from the lifecycle rules.
- **D4 - Specs with a `phases:` block but no `tasks.md`** (e.g. SPEC-025). The warning should
  fire on status alone; confirm that is wanted rather than only on map-less specs.
