---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a green CI run that the editor would flag is a false signpost
aspects: [validator, frontmatter, parity, ci-gate, silent-gate, tier-0]
relates_to: ["#1033", "#972", "#137", "#1027", DR-003, SPEC-075]
---

# SPEC-137: The CI frontmatter gate and the in-extension validator enforce one required-field schema (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers the questions under *Decisions needed (Clarify)*, and approves it before code
> changes.

Materializes [#1033](https://github.com/AIClarityAU/minspec/issues/1033): removing a
required `status:` from SPEC-042's `design.md` and `tasks.md` gave a clean `npm run validate`,
while the editor flags the same files.

## Root cause (measured, not inferred)

- The schema is stated once, in `CLOSED_SET_FIELDS`
  (`packages/minspec/src/lib/spec-validator.ts:534`); `status` is `required: true` (line 536).
- It is enforced only inside `validateSpec` (line 1157), via `checkClosedSetField` (line 575),
  which is **not exported**.
- `scripts/validate-frontmatter.ts` never calls `validateSpec` and cannot reach
  `checkClosedSetField`. Its spec loop (Rule 2 + 5, around line 194) checks `id` and `epic`
  only, with its own hand-written logic. So `status`, `tier` (primary specs) and
  `superseded-by` presence are never evaluated in CI.
- This is a field-agnostic hole, not a `status` hole: any field added to `CLOSED_SET_FIELDS`
  is invisible to CI until someone copies its rule across by hand.
- **Missing gate:** no test asserts the two paths agree, so they drift silently in either
  direction (the #137 asymmetry class, one level up).

Baseline: at the commit this spec was written against, no file under `specs/` lacks a
`status:` line near the top (checked by scanning every `*.md`), so enforcing presence in CI
breaks nothing today. The Plan phase must re-measure on the then-current corpus.

## Functional requirements

- **FR-1 — One implementation of the presence/value rules.** The closed-set field rules
  (`missing`, `unknown`, `unresolved`) are exposed from `spec-validator.ts` as a single
  exported function that both `validateSpec` and `validate-frontmatter.ts` call. CI must not
  re-implement a subset. The schema stays stated once, in `CLOSED_SET_FIELDS`.
- **FR-2 — CI evaluates every spec file, split-layout siblings included.** For each
  `specs/**/*.md`, `validate-frontmatter.ts` applies the FR-1 function with that file's own
  `type` (so `requiredWhen: isPrimarySpec` still lets `design`/`tasks` omit `tier`).
- **FR-3 — Severity follows a declared policy.** Each finding is emitted as `fail` or `warn`
  per the decision under Clarify (DQ-1), never silently dropped.
- **FR-4 — Fail visibly when the rule cannot run.** If a spec file cannot be read or parsed,
  the new rule reports that it validated nothing (invariant 2), in the manner of Rules 17-19.
  It does not pass quietly and does not stop evaluating the remaining files.
- **FR-5 — Parity test.** A test runs `validateSpec` and the CI path over the real
  `specs/**` corpus and asserts that the set of closed-set-field findings (rule id + file)
  is identical. A rule present in one and absent in the other fails the build. The test
  must also include a self-check proving it can fail: a mutation of the CI path that drops
  one field makes it red (a parity test that cannot go red is a vacuous witness).
- **FR-6 — Fixture test for the reported hole.** A split-layout fixture whose `design.md`
  (and, separately, `tasks.md`) omits `status` must be flagged by the CI path. A fixture
  whose `design.md` omits `tier` must NOT be flagged (type-conditional rule preserved).
- **FR-7 — Land together with #972.** If [#972](https://github.com/AIClarityAU/minspec/issues/972)
  changes `status` to `requiredWhen: isPrimarySpec`, it lands in the same change as the parity
  test so both paths move together. See DQ-2.

## Acceptance criteria

- **AC-1.** Deleting `status:` from any `specs/**/*.md` file makes `npm run validate` report
  a `frontmatter.status.missing` finding for that file (warning or failure per DQ-1).
- **AC-2.** The parity test passes on the current corpus and fails when either path's
  handling of any `CLOSED_SET_FIELDS` entry is altered.
- **AC-3.** `grep` finds exactly one place that decides whether a closed-set field is
  missing: the FR-1 function. `validate-frontmatter.ts` contains no per-field presence logic
  for these fields.
- **AC-4.** An unreadable spec file produces a visible "validated NOTHING" message, not a
  clean pass.
- **AC-5.** `npm test`, `npm run validate`, and `npm run lint` pass on the corpus.

## Invariants this change must not break

- **Invariant 2 (no silent gate):** FR-4 and the self-failing parity test exist for this.
  The change must not add a swallowed error around the new rule.
- **Invariant 1:** pure local file reads; no network.
- **Invariant 3:** no behaviour change in repos without `.minspec/`; the shipped extension's
  validator output for existing callers is unchanged (it still returns warnings for these
  rules).
- The in-extension validator stays warn-level for these rules ("WARN, never block",
  `spec-validator.ts` step 0b comment); only the CI side may differ, and only per DQ-1.

## Out of scope

- Epic/`id` rules already enforced by Rule 2 + 5 (they may later fold into FR-1; not now).
- Parity for non-closed-set `validateSpec` checks (ownership, acceptance criteria, etc.);
  Rules 13, 15, 22, 23 already call the shared functions. A full-`validateSpec` parity
  harness is a possible follow-up, not this spec.

## Decisions needed (Clarify)

- **DQ-1 — CI severity for a missing required field.**
  - **A (rec): `fail` (fatal) for `*.missing`, `warn` for `*.unknown` / `*.unresolved`.**
    Matches the issue's complaint (a green run must mean valid) and the existing fatal
    `id`/`epic` rules. Cost: a stray hand-edit now blocks a commit, where the editor only
    warns; the CI and editor severities deliberately differ.
  - **B: `warn` for everything.** Same severity as the editor, so parity is literally
    identical. Cost: the warning count (107 today) already hides new warnings; the exact
    failure the issue reports ("a green run") recurs in practice.
- **DQ-2 — Does #972 (`status` becomes `requiredWhen: isPrimarySpec`) ride in this change?**
  - **A (rec): No; keep `status` unconditionally required here, land #972 separately but
    gated on the parity test.** Smaller blast radius. Cost: #972 stays open and a second
    edit to the same schema line follows.
  - **B: Yes, bundle.** Matches the issue's "land together" wording. Cost: this spec then
    depends on #972's own undecided design, and a schema-meaning change rides with a
    plumbing fix.
- **DQ-3 — How to share the rule.**
  - **A (rec): export `checkClosedSetField` (or a thin `validateClosedSetFields(raw, type)`
    wrapper) from `spec-validator.ts`.** Smallest change; CI keeps its own loop. Cost: CI
    still hand-builds the input, so a future non-closed-set rule can still diverge.
  - **B: have CI call full `validateSpec` per file.** Strongest "single source". Cost: needs
    config, approval state and registry context CI does not currently assemble, and surfaces
    many unrelated warnings, so it is a larger T3 change with noisy first output.
