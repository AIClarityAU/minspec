---
id: SPEC-315
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - same epic as SPEC-136, whose headless core is the next caller of these sequences
aspects: [refactor, approve, validate, headless, core, drift, one-predicate, offline, no-silent-gate]
depends_on: []
relates_to: [SPEC-136, SPEC-277, SPEC-051, SPEC-096, SPEC-022, DR-014, DR-056, DR-081, DR-119, "#3291", "#1520", "#1595", "#1806", "#3301"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec owns is decided at Plan. Expected surface: one new
  editor-free module under packages/minspec/src/lib/ and its tests, with call-site edits in
  packages/minspec/src/commands/validate.ts, packages/minspec/src/commands/approve.ts,
  packages/core/src/operations.ts (owned by SPEC-136), and, per the Clarify answers,
  scripts/validate-frontmatter.ts and scripts/lib/delegated-approval.ts. None of it is claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-315: Validate and approve each run one editor-free sequence that the commands, the headless core and the repository scripts all call

> **This is a SPECIFICATION ONLY.** Written for issue #3291 (one editor-free orchestration
> for validate and approve). Nothing is built until a human approves this spec, after the
> [Decisions needed (Clarify)](#decisions-needed-clarify) are answered. No decision record
> is owed: every choice here is a refactor that can be undone in under a day (the decision-record filter in the architect role).

## In plain terms

The steps for checking a spec, and the steps for approving one, are written out by hand in
several places: the editor's two commands, the new headless core (SPEC-136), and two
repository scripts. They have already drifted. Three days after the core copied the
editor's check options, the editor gained one more and the core did not, so the core now
skips a rule the editor runs. This spec puts each sequence in one function with no editor
code in it, and has every caller use that function. The editor keeps its pickers, dialogs,
commit and toasts; only the steps underneath move. A test then fails if anyone writes the
sequence out by hand again.

## Measured state (this base, `origin/main` at `1b8bebe1`)

All read from code on this branch's base; none of it is inferred from spec prose.

**Per-spec check options - four hand-written copies, already divergent.**

| Caller | Options passed to `validateSpec` |
|---|---|
| `packages/minspec/src/commands/validate.ts:59-72` (editor *Check Spec*) | `knownEpicRefs`, `approvalState`, `explicitTerminal`, `siblingShardFiles`, `pathExists`, `taskTally` |
| `packages/core/src/operations.ts:189-195` (core `validate`, SPEC-136 task 6) | the same **minus `taskTally`** |
| `packages/minspec/src/commands/approve.ts:274-282` (editor *Approve Spec*) | `knownEpicRefs`, `siblingShardFiles`, `pathExists` |
| `scripts/lib/delegated-approval.ts:597-601` (`specNotApprovable`, the bot's delegated approval, DR-119) | `knownEpicRefs`, `siblingShardFiles`, `pathExists` |

The core's missing `taskTally` is live drift of the #1520 shape: the core's copy landed on
2026-11-02 (`55b106f9`, #3301); the editor gained `taskTally` for the #1595 close-out rule
on 2026-11-05 (`abfbe350`, `validate.ts:70-71`). Without it, `validateImplementCloseout`
returns nothing (`spec-validator.ts:1142`), so the core never reports
`implement.finished-not-closed` or `implement.phantom-hole`. SPEC-136's own design table
(design.md, *Per-spec validation*) still lists five options, so the plan carried the stale
list too.

**Approve sequence - two copies today, a third planned.**

- Editor: `packages/minspec/src/commands/approve.ts:222-392` - opt-in (`hasOptInMarker`), picker filter
  (`status !== 'approved' && !isTerminalSpecStatus`), read, `validateSpec`,
  `assertOwnershipDeclaredForAdvance`, `checkApprover(resolveApproverEmail(root), …)`,
  opt-in again, `advanceSpecToImplementing` when the literal status is `new`/`specifying`,
  `approveSpec` (imported as `recordApproval`), then commit-on-approve, tree refresh and the
  phase-advance toast.
- Delegated approval: `scripts/lib/delegated-approval.ts:574-611` (`specNotApprovable`) -
  terminal check, a body-status hash-neutral check of its own, `validateSpec`,
  `assertOwnershipDeclaredForAdvance`. Its comment says it mirrors the editor's refusals;
  nothing enforces that. No approver check: the bot is the recorder under DR-081/DR-119.
- Core: SPEC-136 task 13 (not built) repeats the editor's seven steps (design.md, *approve*).

`approveSpec` (`approval.ts:523`) already re-runs the approver gate, the opt-in gate and the
ownership guard at the library boundary. What is not shared is everything a caller does
before it: the candidate filter, the completeness check and its options, and the order.

**Corpus rules - two lists.** `scripts/validate-frontmatter.ts` calls each corpus rule
function inline (`checkAcceptanceCriteria`, `validateOwnership`, `validateImplementEvidence`,
`validateImplementCloseout` with its own `taskTally`/`pathExists`/`approvalState` at
`:989-993`, and so on). SPEC-136 task 7 plans the core to call the "Yes" rows of the same
list again (design.md, *corpus rules*).

## Root cause (mechanism)

The sequences are composed at each call site, from library functions whose options are all
optional and degrade silently: `validateSpec` skips a rule whose input is missing
(`spec-validator.ts:704-749`, the "no false positive" pattern). So a caller that forgets an
option gets a quieter result, not an error, and no gate compares callers. The missing gate
is a check that there is exactly one composition.

## Functional requirements

- **FR-1 One per-spec option assembly.** One editor-free function builds the complete
  `ValidateSpecOptions` for a spec file under a root: `knownEpicRefs`, `approvalState`,
  `explicitTerminal`, `siblingShardFiles`, `pathExists`, `taskTally`. It accepts a
  precomputed per-root context (at least the epic ref set) so a corpus loop does not
  recompute it per spec. Every caller that runs `validateSpec` on a real file uses it.
- **FR-2 One approvability check.** One editor-free function answers "may this spec be
  approved, and if not, why", with no write: opt-in marker, candidate filter (already
  approved, terminal status), readable and parseable, complete under FR-1's options, and
  `assertOwnershipDeclaredForAdvance`. It returns a typed refusal or nothing. It does
  **not** check the approver's identity (FR-3 does), so the delegated path (D2) can use it.
- **FR-3 One approve act.** One editor-free function runs FR-2, then
  `checkApprover(email, parseAgentIdentities(env))`, then `advanceSpecToImplementing` when
  the literal status is `new` or `specifying`, then `approveSpec`, and returns either the
  record and new status, or the refusal. The approver email is a parameter: resolving it
  (the editor's `minspec.approverEmail` setting, else git config; the core's git config) is
  the caller's job. It does not commit, enqueue a phase advance, or touch any UI.
- **FR-4 Typed refusals.** Refusals are a discriminated union with the codes SPEC-136 task 13
  names - `not-a-minspec-project`, `already-approved`, `terminal-status`, `incomplete`,
  `not-ready-for-advance`, `approver-denied` - plus `unreadable`. `incomplete` carries the
  error violations (message and fix hint); the others carry the message the library raised.
  This is the contract both the editor and the core render from.
- **FR-5 One candidate predicate.** The picker's `include:` filter and FR-2's candidate step
  are the same exported predicate. A spec handed in from a Specs-tree node still bypasses
  it, as today (`approve.ts:244-257`); the bypass is an explicit argument, never a default.
- **FR-6 The editor keeps its UI, unchanged.** `commands/validate.ts` and
  `commands/approve.ts` keep the folder pick, spec picker, modal errors with *Open Spec*,
  commit-on-approve, tree refresh and phase-advance toast, and map each refusal code to the
  message they show today, word for word.
- **FR-7 The core calls the same functions.** SPEC-136's core `validate` uses FR-1 (which
  restores `taskTally`), and its `approve` (task 13) uses FR-3. No operation in
  `packages/core/` composes these sequences itself.
- **FR-8 Corpus rules (scope per D1).** If D1 is (a): one editor-free function returns the
  corpus-rule findings, each with its rule id and severity, for the rules SPEC-136 marks
  "Yes"; `scripts/validate-frontmatter.ts` and the core both call it, and the script adds
  its repository-only rules (epic gate as fatal, forbidden integrity words, generated CI
  templates, known limit in product source) after it.
- **FR-9 Delegated approval (scope per D2).** If D2 is (a): `specNotApprovable` calls FR-2 for
  the shared steps and keeps its own body-status hash-neutral check, which only it needs.
- **FR-10 The one-composition gate.** A test fails if any non-test file outside the module
  that holds FR-1 and `spec-validator.ts` itself calls `validateSpec(`, or if any file in the
  in-scope caller set calls `approveSpec(` other than through FR-3 (allowlist named in the
  test, each entry with its reason). It has a negative control that goes red on a planted
  direct call. Without this gate the spec only moves the copy problem.
- **FR-11 Editor-free and offline.** The new module imports no `vscode`, opens no socket and
  makes no network call; the only process it may spawn is `git`, through functions that
  already do (`approveSpec`'s baseline mint). SPEC-136's `no-editor-import.test.ts` keeps
  passing with the core bundling it.
- **FR-12 Placement.** The module lives under `packages/minspec/src/lib/`, where every
  function it composes lives and where the core and the scripts already import from. It is
  not moved into `packages/shared` (DR-014's move is `proposed`, not executed, #54).

## Behaviour changes, stated

Unifying the options changes what the approve paths validate. From the code, I believe the
change is warnings only, but it is unverified until AC-6 runs:

- Approve gains `approvalState` and `explicitTerminal`, which enable only
  `status.mirror-drift`, a warning (`spec-validator.ts:1318-1340`). Warnings never block approval.
- Approve gains `taskTally`. The close-out rule fires only when `approvalState` is
  `approved` (`spec-validator.ts:1145`). A picker candidate is never `approved`, so it cannot
  fire there. It **can** fire on a tree-node re-approval of an already-approved spec whose
  build is finished, and if the project sets `implementCloseout: error` it would then refuse.
  D3 decides whether that is wanted.
- Core `validate` gains `taskTally`, so it starts reporting the two close-out findings the
  editor already reports. That is the fix, not a regression.

## Acceptance criteria

- **AC-1** For a fixture corpus covering every option (an epic ref, an approval sidecar in
  each of `approved`/`stale`/`unapproved`, an `archived` spec, sibling shards with a divergent
  id, an `implements:` path present and absent, a tasks file with all ticked and none ticked),
  editor *Check Spec* (driven through its command test harness) and core `validate` report
  the same violations per spec.
- **AC-2** Before the change, AC-1 is red on the close-out fixture (core silent, editor
  reports); after, green. The red run is recorded in the pull request.
- **AC-3** For each refusal code in FR-4, one fixture makes FR-3 refuse with that code, and
  the spec file, `.minspec/approvals/` and `refs/minspec/snapshots/*` are byte-identical
  afterwards.
- **AC-4** Every existing test under `packages/minspec/tests/approve-*.test.ts` and the
  validate command tests passes unchanged, which pins FR-6's messages.
- **AC-5** FR-10's gate is green on the change, and red when a direct `validateSpec(` call is
  planted in `commands/approve.ts` (negative control, recorded in the pull request).
- **AC-6** A table test runs FR-2 on each approve fixture with the old three-option set and
  the new full set, and asserts the error-severity results are identical except for the D3
  case; the D3 case asserts whichever outcome D3 chose.
- **AC-7** `npm run validate` on this repository prints the same output before and after (if
  D1 is (a)), compared as text in the pull request.
- **AC-8** If D2 is (a): the delegated-approval tests pass unchanged, and a spec refused by
  the editor for `incomplete` or `not-ready-for-advance` is refused by `specNotApprovable`
  with the same cause.

## Invariants this change must not break

- **INV-1 Offline (constitution invariant 1).** No network call is added; FR-11.
- **INV-2 No silent gate (invariant 2).** No refusal becomes a skip: an unreadable spec stays
  an error finding in validate and a refusal in approve; the approver gate stays at the
  library boundary (`approveSpec`) as well as in FR-3; FR-10 fails closed on a planted copy.
- **INV-3 Blast radius (invariant 3).** The opt-in check stays the first step of approve, and
  `approveSpec` keeps its own (`approval.ts:543`).
- **INV-4 Refuse before write (SPEC-051, SPEC-096 FR-6).** Every refusal precedes the status
  flip, the baseline mint and the sidecar write.
- **INV-5 Human approver (DR-056).** The editor still prefers `minspec.approverEmail`; the
  library still denies bots and listed agent identities. Moving resolution to the caller
  must not let any path reach `approveSpec` with an unchecked address.
- **INV-6 Editor-free core (SPEC-136 FR-1, INV-5).** Nothing that imports `vscode` enters the
  core's bundle.

## Sequencing and ownership

- `packages/core/src/operations.ts` is owned by SPEC-136 (`implements:`); this spec edits it
  and will declare it under `affects:` at Plan. Landing this before SPEC-136 task 13
  (`approve`) means task 13 calls FR-3 instead of writing a copy; landing after means task 13's
  copy is replaced here. Before is cheaper.
- SPEC-277 (approve refuses an open Clarify question and an uncleared dependency) adds two
  refusals to the approve sequence. Whichever of the two specs lands second puts its
  refusals into FR-2's function, so they reach the editor, the core and (per D2) the
  delegated path at once. SPEC-277's FR-6 ("single enforcement point") already asks for that.
- `scripts/lib/delegated-approval.ts` is approval machinery; a pull request touching it needs
  a human merge.

## Decisions needed (Clarify)

- **D1 - Is the corpus-rule list (`scripts/validate-frontmatter.ts`) in scope?**
  (a) **(rec)** Yes, as the last task, with AC-7 as its proof. The issue names it, and SPEC-136
  task 7 is about to write the second list. Cost: it edits the repository's own required
  gate, a long script, and needs a byte-equal output check to be safe.
  (b) No - per-spec and approve only; file a separate issue for the corpus list. Cost: task 7
  lands a second hand-written list now, and FR-10 cannot cover it.
- **D2 - Does `specNotApprovable` (the delegated approval path, found while writing this
  spec, not named in the issue) call FR-2?**
  (a) **(rec)** Yes. It is the same refusal sequence and already uses the narrower option set,
  so a refusal added to the editor (SPEC-277's, say) would not reach it. Cost: it is
  approval machinery, so its pull request waits for a human merge.
  (b) No - leave it and file an issue. Cost: a fourth copy stays, outside FR-10's allowlist
  by exception.
- **D3 - On a tree-node re-approval of an already-approved spec with a finished build and
  `implementCloseout: error`, should approve refuse?**
  (a) **(rec)** Yes - one option set everywhere, so approve sees what *Check Spec* sees, and a
  finished build should be closed, not re-approved. Cost: a refusal that does not happen
  today, on a rare path, in projects that opted into the error severity.
  (b) No - FR-1 takes a purpose argument and approve omits `taskTally`. Cost: the divergence
  stays, though now in one function and named.

## Out of scope

- Moving any library function into `packages/shared` (DR-014, #54).
- Changing what any rule checks, or any rule's severity.
- The editor's commit-on-approve, phase-advance queue and their preferences.
- The Python validator (`VALIDATE_PY`); SPEC-136 task 8 owns its parity.
- Revoke approval and DR acceptance sequences.

## Follow-ups (tracked)

- SPEC-136 design.md's *Per-spec validation* row and *approve* section should point at this
  spec's functions once they exist; that edit belongs to SPEC-136's Plan, made when task 13
  is picked up.
- None other.
