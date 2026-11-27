---
id: SPEC-233
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-233 is T2.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology
relates_to: ["#2108", "#1317", "#1806", "#1543", DR-003, SPEC-038]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-233 - Design: `MinSpec: Validate` asks the question approval asks

Plan for [requirements.md](requirements.md), built under the recorded Clarify selections
(D1 option A: the command only; D2: the validator does not assert `implements:` at authoring
time; D3: the `slash-commands.ts` guidance is left as is). Citations of "today" are against
`origin/main` `9c84f799`, the commit this plan was written on. New code is cited by symbol,
because its line numbers move.

## Approach in one paragraph

`validateSpecCommand` (`packages/minspec/src/commands/validate.ts`) gains one call to the
existing `violationsIntroducedByApproval` (`packages/minspec/src/lib/spec-validator.ts:1210`),
made with exactly the input the approve guard gives it, inside its own `try`. Its result
joins the decision that today rests on `result.violations.length === 0` alone
(`validate.ts:80`): the `✓ <id> is complete` message now needs both sources empty and the
pre-check to have run. Anything the predicate returns is shown under its own label,
"Approval would be refused:", and counts as a blocker. A throw from the predicate is shown
as "approval pre-check could not run: <reason>" and also withholds the tick. Nothing else in
the extension changes: the guard, the approve command, and `validateSpec` keep their code.

## Re-measurement at 9c84f799 (the spec's diagnosis still holds)

| Claim in requirements.md | Checked at 9c84f799 |
|---|---|
| Validate never calls the predicate | `grep violationsIntroducedByApproval packages/minspec/src` hits `approve.ts` (comment), `ownership-advance-guard.ts`, `spec.ts` (comment), `approval.ts` (comment), `spec-validator.ts` (definition). Not `commands/validate.ts`. |
| The tick rests on `validateSpec` alone | `validate.ts:80`, `if (result.violations.length === 0)` then `✓ … is complete`. |
| Ownership rule is gated on `phases.plan` | `validateOwnership`, `spec-validator.ts:1010-1012`: fires only for a primary spec, tier T3 or above, `plan` `in-progress` or `done`. |
| Approval writes `plan: in-progress` | `phasesForApproval`, `lifecycle.ts:199`: marks specify and clarify done, then the first of plan, tasks, implement that is neither `done` nor `skipped` becomes `in-progress`. |
| The regression test does not exist | `packages/minspec/tests/validate-reports-approval-refusal.test.ts` is absent. |

## The one design decision: what input the predicate gets

`violationsIntroducedByApproval(spec, config, options)` runs `validateSpec` twice, once on the
spec and once on the spec with only its phase map advanced, and returns the error-severity
findings present on the advanced side only. Its verdict depends on `options`. Validate already
builds a richer options object for its own `validateSpec` call (`approvalState`,
`explicitTerminal`, `knownEpicRefs`, `siblingShardFiles`, `pathExists`, `taskTally`). The
approve guard passes `{ pathExists }` and nothing else (`ownership-advance-guard.ts:91`).

**Decision: pass `{ pathExists }` only, built from the same `rootDir` and `loadConfig(rootDir)`
Validate already uses.** Reasons:

1. **Equivalence (INV-4, AC-5).** The point of this spec is that Validate says "refused"
   exactly when approve refuses. Feeding the predicate a different options object makes that
   a coincidence instead of a construction.
2. **Some options do not cancel out of the diff.** The guard's own comment
   (`ownership-advance-guard.ts:75-82`) says the omitted options cancel because they do not
   depend on the phase map. That is true for the two it omits, and false for options Validate
   holds. `taskTally` (with `approvalState`) feeds the implement close-out rule
   (`implementCloseoutKind`, `spec-validator.ts:1136-1146`), which fires only when
   `phases.implement` is `in-progress`, a state the advance can create (a spec with plan and
   tasks done), and whose severity is `error` under `implementCloseout: 'error'`. Passing it
   would make Validate report a refusal the approve command never makes, the drifting second
   answer FR-2 forbids. `approvalState` also arms the status-mirror check
   (`spec-validator.ts:1326`), which compares the literal `status:` with the status derived
   from `phases`; that one is `warning` today and so filtered out by the predicate, but it is
   phase-dependent too, and would start leaking the moment its severity changed.

Rejected alternatives (recorded per DR-086 section 4, since nobody sees them live):

- **Reuse Validate's full options object.** Shorter, but breaks equivalence for the two
  reasons above.
- **Add a non-throwing sibling of `assertOwnershipDeclaredForAdvance` in
  `ownership-advance-guard.ts` and call it from both places.** This would make the input
  identical by sharing code, including the guard's own root derivation (`repoRootFor`, which
  walks up to the directory holding `.minspec`). FR-2 allows it. Not chosen because it edits a
  file outside the spec's declared `affects:` and touches the guard INV-1 freezes, for a gain a
  test can pin instead (task 2.2 asserts the options object is exactly `{ pathExists }`). The
  remaining difference, Validate's root being the VS Code workspace folder rather than the
  nearest `.minspec` ancestor, only matters for a spec in a nested MinSpec project inside a
  larger workspace folder; there Validate already reads that outer folder's config for its own
  checks, so the pre-check follows the same config the rest of the report uses.
- **Call `assertOwnershipDeclaredForAdvance` and catch its throw.** Rejected: it swallows its
  own infrastructure failures with a `console.warn` and returns (fail-open by design,
  `ownership-advance-guard.ts:94-100`), so Validate could not tell "clean" from "could not
  run", which is exactly the silent skip FR-6 removes.

## The result surface

Inputs to the decision, all computed before any message is shown:

- `result` from `validateSpec`, unchanged.
- `introduced`, the predicate's array, or `undefined` when the predicate threw.
- `precheckError`, the thrown value's message when it threw.

| Case | Shown |
|---|---|
| `result.violations` empty, `introduced` empty | Today's `✓ <id> is complete…` text, verbatim (FR-4). |
| `result.complete`, only warnings, `introduced` empty | Today's modal, `<id>: complete, N warning(s)`, unchanged. |
| Any validator error, or `introduced` has an error | Modal, header `<id>: incomplete — N blocker(s), M warning(s)`, where N counts validator errors plus introduced errors. Detail lists the validator findings as today, then a block headed `Approval would be refused:` listing each introduced finding as `✗ <message>` with `↳ <fixHint>` (FR-3). |
| Predicate threw | Modal, never the `✓`. Header `<id>: not confirmed — approval pre-check could not run`. Detail opens with `Approval pre-check could not run: <reason>`, then any validator findings as today (FR-6). |

Notes on the table:

- **FR-5, warnings.** The predicate filters to `severity === 'error'` before diffing
  (`spec-validator.ts:1219-1220`), so today it never returns a warning. The command still
  partitions what it gets by severity: an introduced warning is listed under the same label
  with `⚠` and counted in M, never in N, so a future change to the predicate cannot turn a
  warning into a withheld tick without this table changing too.
- **A thrown pre-check over a spec that also has validator errors** uses the not-confirmed
  header, because the extra fact (the check did not run) is the one a reader would otherwise
  miss; the blocker count still appears in the detail lines.
- **FR-7, already-advanced and terminal specs.** No special case. For a spec whose phases are
  already past the advance, `phasesForApproval` changes nothing that matters to a rule, so
  the diff is empty. The command does not inspect `status:` to decide whether to call the
  predicate.
- **D1 option A.** Only `validateSpecCommand` changes. The tree badge, the status bar and
  `npm run validate` are untouched.

## Code shape

```
validateSpecCommand(node)
  rootDir, spec                         (unchanged)
  try { parsed, result = validateSpec(...) }   (unchanged; read failure still returns early)
  config = loadConfig(rootDir)          (hoisted so both calls share one load)
  introduced / precheckError = precheckApproval(parsed, config, rootDir)
  render(result, introduced, precheckError)
```

- `precheckApproval` is a small module-private function in `validate.ts`: it calls
  `violationsIntroducedByApproval(parsed, config, { pathExists: (rel) => fs.existsSync(path.join(rootDir, rel)) })`
  inside `try`, and returns `{ introduced }` or `{ error: <message> }`. It never throws.
- The `pathExists` closure is the same expression Validate already passes to `validateSpec`;
  hoist it into one `const` so both calls use one resolver (FR-1), rather than two copies.
- `parsed` must be in scope after the existing `try`; today it is declared inside it. Move the
  declaration out, keeping the read-failure path (`showErrorMessage` and return) unchanged.
- `validateSpec` stays filesystem-free (INV-2): the resolver lives in the command.
- No new import beyond `violationsIntroducedByApproval` from `../lib/spec-validator`, which
  `validate.ts` already imports from. No new dependency, no network call (INV-3, FR-8).

`spec-validator.ts` is listed in the spec's `affects:` as the home of the reused predicate. This
plan expects no edit there; if one turns out to be needed, it is a `DEEPER:` stop, because any
change to the predicate changes approve's refusal too (INV-1).

## Tests

One new file owns the behaviour, `packages/minspec/tests/validate-reports-approval-refusal.test.ts`
(the spec's `implements:` entry). It drives the real command over a real temporary repository,
following the pattern of `packages/minspec/tests/approve-command-ownership-guard.test.ts`:
only `vscode` is mocked, plus `spec-validator` wrapped so the predicate delegates to the real
implementation by default and can be made to throw for one call (AC-4). Every other MinSpec
module is real, so the test cannot pass on a stubbed answer (AC-6).

Fixture: `.minspec/config.json` with `ownershipDeclaration: 'error'`, a T4 requirements spec
with `specify` and `clarify` done, `plan` `pending`, no `implements:`, and a body complete
enough that `validateSpec` reports nothing. The first assertion of AC-1 is that precondition
(`validateSpec(...).violations` is empty), so a fixture that drifts out of "clean" fails
loudly instead of passing for the wrong reason.

| Case | Asserts | Red on base? |
|---|---|---|
| AC-1 | No `✓`; header says incomplete; detail contains `Approval would be refused:` and the `does not declare its owned code` message. | Yes: base shows `✓`. |
| AC-2 | Same fixture with an `implements:` path that exists on disk shows today's `✓` text verbatim. | No (guards FR-4). |
| AC-3 | Same fixture under `ownershipDeclaration: 'warn'` shows `✓`, and the detail, if any, never contains `Approval would be refused`. | No (guards FR-2). |
| AC-4 | Predicate made to throw `boom` for one call: no `✓`; text contains `approval pre-check could not run` and `boom`. | Yes: base never calls it. |
| AC-5 | The set of `✗` lines under the refusal label equals the messages of `violationsIntroducedByApproval(readSpecFile(f), loadConfig(root), { pathExists })` called directly in the test. | Yes. |
| FR-7 | A copy of the fixture already at `plan: in-progress` with `implements:` present shows `✓`. | No. |

The existing `packages/minspec/tests/validate-command.test.ts` mocks the predicate to return
`[]` (its `vi.mock('../src/lib/spec-validator', …)`), so its cases stay green unchanged. It
gains one case: the predicate is called once per command run with an options object whose
keys are exactly `['pathExists']`. That pins the design decision above, so a later "tidy-up"
that passes Validate's full options fails a named test.

## Out of scope (from requirements.md, unchanged)

The refusal path (#1806), moving ownership out of the canonical hash (#1481 / #1800), the
backfill of approval-blocked specs (#1543), SPEC-071's declaration, other Validate surfaces
(D1), a validator rule (D2), and the guidance prose (D3).

## Follow-ups (tracked)

None. The two surfaces D1 option A leaves out (tree badge, `npm run validate`) are a recorded
Clarify choice, not a deferral.
