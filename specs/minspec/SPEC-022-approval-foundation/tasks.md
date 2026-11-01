---
id: SPEC-022
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-022 is T3.)
# status and phases here carry the current phase state. requirements.md stays frozen at its
# approved hash (approval sidecar under .minspec/approvals/), so its own phases lag. This file
# has no approval record of its own, so its status is what deriveStatus computes for an
# unsigned file with these phases.
status: specifying
product: minspec
epic: EPIC-002  # Signpost Integrity
relates_to: [DR-034, DR-069, DR-088, SPEC-059, SPEC-070, "#95", "#116", "#898", "#1513", "#1668"]
phases:
  specify: done
  plan: done
  tasks: done
  implement: in-progress
---

# SPEC-022 - Tasks

The order below is the order of work. Each task is one agent run and one pull request: one
concern, a few files, its own test. Each names the requirement IDs it satisfies, the files it
touches, its test and its prerequisites by task number. The plan is [design.md](design.md);
the contract is [requirements.md](requirements.md).

Every backticked path in this file is a file a task edits or creates. Files a task only reads,
and the evidence paths in the audit below, are written without backticks, so the spec gate's
ownership signal stays as narrow as the change.

Rules for every task:

- Write the test first, run it against the unchanged code, and quote the red in the pull
  request (AC-10). A test that is green before the fix is not done.
- Run `npx vitest run` (what CI runs), `npm run validate`, `npm run lint` and
  `npm run typecheck` before calling a task done.
- `scripts/` is in MACHINERY_DIR_PREFIXES, so a task touching it should expect machinery
  review. The machinery-review-required check decides, not this file.
- No task edits the body of requirements.md. Only task 8 edits its frontmatter, and only after
  those keys have left the hash.

## What is already built

Most of this spec reached main before this file existed, through earlier pull requests.
This audit was read from origin/main at 5c213300 on 2026-10-31. It is why the list below is
short: only the rows marked "gap" produce a task.

| Requirement | State | Evidence |
|---|---|---|
| FR-1, AC-1, AC-2 sidecars | built, git behaviour unproven (gap: task 4) | packages/minspec/src/lib/approval-store.ts; 97 committed sidecars; .gitignore keeps only the legacy store ignored |
| FR-2, AC-3 attributed record | built | ApprovalRecord in packages/minspec/src/lib/approval.ts; approval-store and approver-identity tests |
| FR-3, INV-3, AC-4 canonical hash | built | packages/shared/src/canonical.ts; packages/minspec/tests/canonical.test.ts; .gitattributes |
| INV-2, AC-5 Node and Python agree | built, with two holes (gap: tasks 1, 2) | scripts/hooks/canonical.py; canonical-parity and canonical-golden-python tests |
| FR-4, INV-1, AC-6 derived status | built | deriveStatus in packages/minspec/src/lib/lifecycle.ts:133; the INV-1 block in packages/minspec/tests/lifecycle.test.ts. deriveStatus cannot return implementing or done without an approved verdict, and takes no literal status argument |
| INV-4, AC-7 mirror warning | built on the interactive surface; the corpus surface is SPEC-059 (corpus status-mirror gate), not this list | status.mirror-drift in packages/minspec/src/lib/spec-validator.ts:1251 |
| INV-5 unique keys | built | INV-5 block in packages/minspec/tests/approval-store.test.ts |
| INV-6, AC-8 terminal honesty | built in Node, wrong in the gate (gap: task 3) | explicitTerminalOf in lifecycle.ts handles both terminals; scripts/hooks/spec-gate.py handles only `archived` |
| FR-5 step 1, step 2 migration | script built and run (0 `migrated:true` sidecars today); the validator half of "valid-but-flagged" is missing (gap: task 5) | scripts/migrate-approvals.ts; only the gate and `npm run facts` read `migrated` |
| FR-5 step 3 promotion | not built (gap: tasks 6, 7) | no corpus checker exists; the gate's WARN path is at scripts/hooks/spec-gate.py:613 |

Two as-built facts this plan takes as settled, so no task reopens them:

- **The `planning` status.** deriveStatus returns `planning` for an approved spec whose
  implement phase has not started. FR-4's table has no such row. DR-069 (the planning-status
  decision, accepted) made that change and deferred the table edit to #898 (migrate approved
  pre-implement specs). The code follows DR-069.
- **The gate's phase test.** The gate decides "is this spec gated" with phase_intent_status,
  never with deriveStatus, because deriveStatus returns `specifying` for an unapproved spec and
  the gate would never fire (DR-069 section 3). It reads phases plus the approval verdict, and
  reads the literal line only to spot a terminal, which is what FR-4 asks for.

**The specs that depend on this one wait on nothing here.** SPEC-026, 029, 041, 045, 046, 059,
061 and 067 cite the sidecar store, the canonical hash or deriveStatus, and all three exist.
No task below changes one of those signatures. (Read from their `depends_on` lines and the
SPEC-022 passages they cite, not from running their builds.)

## 1 - The corpus parity test fails when Python is missing (FR-3, INV-2, AC-5)

Tier T1. One concern, one test file. No prerequisites.

`canonical-parity.test.ts` calls `it.skip` when python3 cannot run, so losing the interpreter on
CI turns the INV-2 witness off and leaves the job green (constitution invariant 2, no silent
gate). Its sibling canonical-golden-python.test.ts already fails closed.

- [ ] **1.1** `packages/minspec/tests/canonical-parity.test.ts` - remove `python3Available` and
  the skip branch. When python3 cannot be spawned, throw a named error, in the wording the
  golden-fixture sibling uses. Update the header comment, which currently promises the skip.

*Test:* the file itself. *Done when:* the normal run stays green, and a run with python3 off
`PATH` fails naming python3. Quote both outputs in the pull request, the second as the red.

## 2 - The two canonicalizers strip the same trailing characters (FR-3, INV-2, AC-5; #1668)

Tier T1. One concern, one source file, one fixture. No prerequisites; touches a different file
from task 1.

canonical.ts strips with JavaScript's `\s`, and canonical.py with `str.rstrip()`, whose sets
differ. Computed for this plan: Python alone strips U+001C to U+001F and U+0085; JavaScript alone
strips U+FEFF. A trailing one of these gives two hashes for one spec. No spec in the corpus hits
it today (the parity test is green), so a fix changes no existing hash.

- [ ] **2.1** `scripts/hooks/canonical.py` - replace the bare `rstrip()` with `rstrip(CHARS)`,
  where `CHARS` is a named constant listing exactly JavaScript's `\s` set. The TypeScript side
  defines the contract because the extension writes the sidecars. Correct the source comment
  claiming byte parity if it still overstates.
- [ ] **2.2** `packages/minspec/tests/fixtures/canonical/trailing-codepoints.input` and
  `packages/minspec/tests/fixtures/canonical/trailing-codepoints.expected` (new), in the shape the
  fixtures README describes. One line per divergent codepoint.
  `packages/shared/tests/canonical.test.ts` and `scripts/hooks/test_canonical.py` both assert it.

*Test:* the golden fixture, red in Python first. *Done when:* both golden suites and the corpus
parity test are green and #1668 is closed by the pull request. If SPEC-070 (ownership keys leave
the hash) has landed first, rebase; its change is to the strip set, a different step.

## 3 - The gate treats `superseded` as terminal, like `archived` (FR-4, INV-6, AC-8)

Tier T2. One concern, two source files, two test files. No prerequisites.

Reproduced for this plan: a T3 spec with `status: superseded`, `implement: in-progress`,
`implements: [src/x.ts]` and no record gets `deny` on an edit to src/x.ts, and the same file with
`status: archived` gets `allow`. A superseded spec therefore freezes code it no longer speaks for.
The Node mapping was fixed in explicitTerminalOf, and the two other twins were not.

- [ ] **3.1** `scripts/hooks/spec-gate.py` - the `explicit_terminal` assignment recognises both
  `archived` and `superseded`. Update the nearby comments that name only `archived`.
- [ ] **3.2** `scripts/migrate-approvals.ts` - the phase-intent twin returns the terminal for
  both values, so a superseded spec is never backfilled with a `migrated:true` record.
- [ ] **3.3** `packages/minspec/tests/spec-gate.test.ts` - the reproduction above as a case, plus
  the `archived` control. `packages/minspec/tests/migrate-approvals.test.ts` - a superseded spec
  gets no sidecar.
- [ ] **3.4** `packages/minspec/tests/lifecycle.test.ts` - the INV-6 block also asserts
  `deriveStatus(phases, verdict, 'superseded')` returns `superseded`, and that no phase shape
  yields it with `explicitTerminal` unset. It covers only `archived` today.

*Done when:* the new gate case is red before 3.1 and green after, and the `archived` control is
green throughout.

## 4 - Prove the sidecar store's git behaviour with real git (FR-1, INV-5, AC-1, AC-2)

Tier T1. One new test file, no source change. No prerequisites.

The current INV-5 test proves sidecarPath is a pure function, which only implies the merge
behaviour AC-2 states. Nothing proves AC-1's "present after a fresh git clone", and a tracked-file
or ignore-rule regression would be silent.

- [ ] **4.1** `packages/minspec/tests/approval-sidecar-git.test.ts` (new) - in a temporary repo
  under `os.tmpdir()`, carrying this repo's .gitignore, using writeRecord and readRecord:
  - a sidecar is not ignored (`git check-ignore --no-index` exits 1);
  - after commit and `git clone`, readRecord in the clone returns the record;
  - two branches approving different specs merge with no conflict;
  - two branches approving the same spec with different hashes conflict, on that one file.

*Done when:* green, and each of the four cases fails under a mutation quoted in the pull request
(ignore the tree; collapse sidecarPath to one file). The feature is already built, so mutation is
the red here. AC-10's "fails against pre-change code" can no longer be run for shipped behaviour.

## 5 - The validator flags a migrated record (FR-5 step 2, AC-9)

Tier T2. One concern (the flag), three source files, two test files. No prerequisites.

FR-5 says the gate and the validator both treat a migrated record as valid but flagged. The gate
does. Neither validateSpec nor the corpus validator reads the field, so a migrated record is
invisible unless someone runs `npm run facts` on that spec. No sidecar is migrated today, so
nothing would warn yet, which is exactly when an absent check goes unnoticed.

- [ ] **5.1** `packages/minspec/src/lib/spec-validator.ts` - add an optional `approvalMigrated`
  option to ValidateSpecOptions. When true, push rule `approval.migrated`, severity warning, with
  the message "approval migrated, not a recorded human act - re-approve to clear". Absent means no
  check, the same pattern as `approvalState`.
- [ ] **5.2** `packages/minspec/src/commands/validate.ts` - read the spec's record and pass the
  option. `scripts/validate-frontmatter.ts` - a new rule with the next free number, calling
  validateSpec for that rule only over each file with an id, and `warn()` per hit. It reports its
  count even at zero, and follows the Rule 17/18/24 pattern of failing visibly when it cannot run.
- [ ] **5.3** `packages/minspec/tests/spec-validator.test.ts` - flagged, unflagged and absent cases.
  `packages/minspec/tests/validate-frontmatter-migrated.test.ts` (new) - `spawnSync` on fixture
  roots, on the harness shape of validate-frontmatter-known-limit.test.ts: a migrated sidecar warns
  and exits 0; a clean tree prints zero; an unreadable sidecar directory prints the visible warning.

*Done when:* the new tests are green and `npm run validate` on this repo reports zero migrated.

## 6 - One command answers "may the gate promote yet?" (FR-5 step 3, AC-9)

Tier T2. One new script, one new test file. Prerequisites: task 5, and SPEC-059 task 1 (the
specDeriveInputs helper).

- [ ] **6.1** `scripts/check-approval-corpus.ts` (new) - counts sidecars with `migrated: true`
  through listRecords, and status.mirror-drift hits through validateSpec fed by specDeriveInputs:
  the same functions the validators call, so there is no second predicate to drift. Prints one line
  with both counts and the files checked. Exits 0 only when both are zero and at least one file was
  checked, 1 when not clean, and 2 when it could not check, naming why. Scanning zero files is 2.
- [ ] **6.2** `packages/minspec/tests/check-approval-corpus.test.ts` (new) - one fixture root per
  exit: clean; one migrated; one drifted; empty specs dir; unreadable spec.

*Done when:* green, and the pull request quotes the command's output on this repo. Measured for
this plan with the same validateSpec call on 2026-10-31: 249 files, 0 migrated, 89 drifted (27
`requirements.md`, 62 `design.md` or `tasks.md` shards), so it should exit 1 today.

## 7 - Promote the gate from WARN to ERROR (FR-5 step 3, AC-9)

Tier T1. One concern, one source file, one validator rule, their tests. Prerequisite: task 6 **and
task 6's command exiting 0 on main**. Do not start before that. It is the no-flag-day condition,
and promoting early denies edits across the repo.

What has to land first, none of it in this list: SPEC-059 task 3 (corrects SPEC-014 and SPEC-018),
#1513 (the corpus backfill of literal status) and SPEC-212 (one status per spec set), which is where
how a shard derives gets settled. SPEC-059's design records that tension. It holds about two thirds of today's
drift, and this plan does not pick an answer for it.

- [ ] **7.1** `scripts/hooks/spec-gate.py` - a `migrated:true` record joins the blocking set rather
  than the WARN list, with the "re-approve to clear" message kept. Stale and unapproved already
  deny. Correct the "WARN phase" passages in the module docstring.
- [ ] **7.2** `scripts/validate-frontmatter.ts` - task 5's rule moves from `warn()` to `fail()`.
  status.mirror-drift stays a warning: INV-4 and FR-4 both specify a warning, and the promotion
  FR-5 describes is the gate's.
- [ ] **7.3** `packages/minspec/tests/spec-gate.test.ts` - the existing migrated WARN case becomes
  a deny. `packages/minspec/tests/validate-frontmatter-migrated.test.ts` - the migrated case exits
  non-zero.

*Done when:* green, and the pull request quotes task 6's command exiting 0 on the base commit.

## 8 - Close the spec out through the lifecycle writers (FR-4, INV-4; closes this plan)

Tier T1. Spec files only. Prerequisites: tasks 1 to 7, and SPEC-070's canonicalizer change on main.

requirements.md has no `implements:` key, and `ownershipDeclaration` is `error` in this repo, so
advancing its `plan` phase fails validation (Rule 15). Today adding the key would void the approval.
DR-088 (ownership keys leave the hash, accepted) removes that cost once SPEC-070 builds it, so no
re-approval is needed if this task waits for it.

- [ ] **8.1** Run `npm run facts approval SPEC-022` and record `approved`. Add to
  `specs/minspec/SPEC-022-approval-foundation/requirements.md` only keys the canonicalizer now
  strips: `implements:` for the files this spec created (canonical.ts, canonical.py,
  approval-store.ts, migrate-approvals.ts, check-approval-corpus.ts) and `affects:` for those it
  modified. A path another spec owns goes under `affects:`.
- [ ] **8.2** Advance phases with setSpecPhases and settle the literal with setSpecStatus, never by
  hand, on `requirements.md`, `specs/minspec/SPEC-022-approval-foundation/design.md` and
  `specs/minspec/SPEC-022-approval-foundation/tasks.md`.
- [ ] **8.3** Run the facts command again. If it does not say `approved`, stop and revert: the
  strip set is not what this task assumed, and a founder approval must never be voided by a phase
  update.

*Test:* the two facts outputs and `npm run validate`, quoted in the pull request. Acceptance-criteria
checkboxes in requirements.md stay unticked, since the body is hashed; this file's audit and the
tests are the record. #116 stays open for `done`-from-task-completion, which FR-4 defers. The FR-4
`planning` row stays with #898.
