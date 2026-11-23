---
id: SPEC-409
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - the checks are the methodology; this closes the "no fourth validator" gap SPEC-136 left open
aspects: [validator, core, headless, corpus-rules, no-silent-gate]
depends_on: [SPEC-136]
relates_to: ["#3921", "#3871", "#1595", "#3463", "#1641", "#1812", "#396", "SPEC-001"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan. Expected surface:
  packages/core/src/corpus-rules.ts, packages/core/src/operations.ts (the validate
  operation's validateSpec options) and their tests; possibly a move of
  scripts/lib/dr-closed-set.ts and scripts/lib/epic-id-collision.ts. None is claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-409: Port validator rules 24-28 into the SPEC-136 validation core

> **This is a SPECIFICATION ONLY.** Written for issue
> [#3921](https://github.com/AIClarityAU/minspec/issues/3921). Nothing is built until it is
> approved, after [Decisions needed (Clarify)](#decisions-needed-clarify) are resolved.
>
> No decision record: porting a check into the core is undoable in well under a day
> (DR-359 ADR filter). Claims about the code below were read on this branch's base; each cites
> a path. Where I only inferred, I say so.

## One-Sentence Scope

Every validator rule that SPEC-136's design.md currently marks "Left out in this pull request"
(rules 24 implement close-out, 25, 26, 27, 28) is either run by the core's `validate`
operation or recorded in design.md as left out for good with a reason, so the core and the
script `scripts/validate-frontmatter.ts` cannot disagree silently.

## Context: what exists today

From SPEC-136 `design.md` (corpus-rules table, rows at roughly lines 189-193) and the code:

| Rule | Implementation | Editor-free? | Reached by core today |
|---|---|---|---|
| 24 implement close-out (#1595) | `validateImplementCloseout`, called inside `validateSpec` only when options carry `taskTally` | yes | **No** - `operations.ts` validate builds `validateSpec` options without `taskTally`, so the finding never appears |
| 25 delegation authority citation (FATAL, #3463) | inline in `scripts/validate-frontmatter.ts` (~line 1390), `findWrongDelegationCitations` against `.minspec/delegations.json`; fails closed on a read error | the finder is called from the script; whether it is importable without the script is unchecked | No |
| 26 DR frontmatter closed set (FATAL, #1641) | `checkDrFrontmatterClosedSet`, `scripts/lib/dr-closed-set.ts` | yes (pure) | No |
| 27 decision status contradiction (#1812) | `findDecisionContradictions`, `scripts/lib/decision-status-contradiction.ts` (pure text predicate) | yes | No |
| 28 epic id uniqueness (FATAL, #396) | `checkDeclaredEpicIds`, `scripts/lib/epic-id-collision.ts` | yes (pure) | No |

`packages/core/src/corpus-rules.ts` imports most checks from `packages/minspec/src/lib/*`, and
already imports five from `scripts/lib/` (read at lines 28-32: `corpus-walk`,
`dr-required-sections`, `dr-id-collision` for `checkDeclaredDrIds`, `spec-id-collision` for
`checkDeclaredSpecIds`, `domain-doc-rules`). So calling a `scripts/lib/` function is a boundary
the core already crosses (see D2).

**The defect, stated as mechanism (RCDD, DR-003).** The core's FR-3 promise ("the same checks
the script runs") is held by a table in prose, and the table's own "left out" rows keep FR-3
open instead of failing anything. Nothing compares the set of script rules to the set the core
runs, so a rule can exist in the script, be absent from the core, and still pass every gate.
Rule 24 is the sharpest case: the check exists inside `validateSpec` and is dark only because
one option is not passed. This spec ports the rules; FR5 adds the missing comparison gate.

## Functional requirements

- **FR1: Rules 26 and 28 run in the core's `validate`.** `corpus-rules.ts` calls
  `checkDrFrontmatterClosedSet` and `checkDeclaredEpicIds` and reports each defect at the
  script's severity (FATAL becomes `error`). No rule text is redefined in the core (SPEC-136 FR-2).
- **FR2: Rule 24 runs in the core's `validate`.** The `validateSpec` options assembled in
  `operations.ts` include `taskTally` read with `readSpecTaskTally`, the same reader
  `commands/validate.ts` and the script use, so the close-out finding appears.
- **FR3: Rules 25 and 27 each get an explicit outcome.** Per D1, each is either ported under
  the same conditions as FR1, or its design.md row says "Left out for good" with a reason.
  Neither stays "left out in this pull request".
- **FR4: Fixtures that trip each ported rule.** Each ported rule has a fixture on which it
  reports its finding and a clean fixture on which it is silent. A rule whose fixture is only
  clean is not covered (the #3871 gap: no fixture trips them).
- **FR5: A parity gate.** A test enumerates the rule numbers in the script and requires each
  to be either run by the core or listed in design.md as left out for good with a reason. An
  unlisted rule fails the test visibly (invariant 2, no silent gate).
- **FR6: design.md is updated, not the intent.** The corpus-rules table rows for the ported
  rules change from "Left out in this pull request" to "Yes"; rows for rules left out for good
  carry the reason. SPEC-136's FR-3 text is not edited by this spec.
- **FR7: Blast radius.** Rule 25 reads `.minspec/delegations.json`. In a project without
  that file it is silent, not an error (invariant 3; the file is this repo's opt-in
  artifact). A present-but-unreadable file fails closed and visibly, as the script does
  (invariant 2).
- **FR8: Offline and editor-free.** No ported rule imports `vscode` or makes a network call
  (invariant 1; SPEC-136's no-editor-import test must still pass).

## Acceptance criteria

- **AC1** (FR2). A spec fixture whose `implement` phase is marked done with open tasks makes
  the core's `validate` report the close-out finding. Red on base (no `taskTally`), green after.
- **AC2** (FR1). A DR fixture with a status outside the closed set (or an aliased field name)
  yields a rule 26 error from `validate`; two epic files declaring the same id yield a rule 28 error.
- **AC3** (FR4). The matching clean fixtures yield none of the above.
- **AC4** (FR3, FR6). No design.md row for rules 24-28 contains "in this pull request".
- **AC5** (FR5). Removing a rule's port (or its design.md row) makes the parity test fail.
- **AC6** (FR7). A project with no `delegations.json` reports no rule 25 finding; one with
  malformed JSON reports an error, not silence.
- **AC7** (FR8). `no-editor-import.test.ts` and the core's boundary test stay green.

## Invariants this change must not break

1. Offline core, no network (constitution invariant 1).
2. No silent gate: a missing or unreadable witness fails closed and visibly; the parity gate
   (FR5) is the second witness for "core matches script" (invariant 2).
3. Blast radius is the opted-in project, marker `.minspec/` (invariant 3).
4. The core defines no rule of its own; it only calls the existing functions (SPEC-136 FR-2).
5. Severity of each finding equals the script's severity.

## Decisions needed (Clarify)

**D1. Rules 24, 25, 27: port or leave out for good?** (Issue asks 26 and 28 first; those are
settled by FR1 and are not a decision.)

- **(rec) a - Port all three.** Rule 24 needs only the `taskTally` option (FR2). Rule 27 is a
  pure text predicate. Closes the "no fourth validator" intent fully. Cost: rule 27 is advisory
  by its own comment ("deliberately NOT a general consistency checker") and rule 25 reads a
  repo-specific file, so the core carries two checks that mostly matter to this repository,
  and more core surface to keep green.
- **b - Port 24 and 27, leave 25 out for good.** Reason: `delegations.json` is this repo's
  governance artifact (inference from the path and #3463, unverified for adopters). Cost: the
  core's verdict on a repo that has a delegations file can differ from CI's.
- **c - Port 24 only; leave 25 and 27 out for good.** Smallest change; rule 24 is the one
  currently dark by omission. Cost: two script rules stay permanently absent from the core,
  and FR5 must carry the reason text for each.

**Recorded selection: the recommended option,** a, port all three (rules 24, 25 and 27). Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-24; sign-off ratifies it.

**D2. Where do the rule 26 and 28 functions live for the core to call them?**

- **(rec) a - Import from `scripts/lib/` directly.** Matches the precedent in
  `corpus-rules.ts:28-32`, where the core already imports `checkDeclaredDrIds`,
  `checkDeclaredSpecIds` and others from `scripts/lib/`. Smallest diff; no script or test
  import paths change. Cost: the core keeps depending on a dev-time scripts directory, a
  dependency it already carries, so this adds no new packaging risk but does not retire the
  existing one (whether `scripts/` ships in a packaged install is unverified).
- **b - Move them into `packages/minspec/src/lib/`** (script re-imports from there). Cleaner
  boundary for these two. Cost: touches the script and its two existing test files' import
  paths, and leaves the core inconsistent with its five existing `scripts/lib/` imports.

**Recorded selection: the recommended option,** a, import from `scripts/lib/` directly. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-24; sign-off ratifies it.

**D3. Does one pull request carry all ports, or split 24 (needs wiring) from 26/28 (call-only)?**
(rec) one pull request: the parity gate (FR5) must see a consistent table. Cost: a rule that
turns out hard (25) holds the others; the split avoids that at the price of an interim state
where FR5 lists rules as pending.

**Recorded selection: the recommended option,** one pull request carries all ports. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-24; sign-off ratifies it.
