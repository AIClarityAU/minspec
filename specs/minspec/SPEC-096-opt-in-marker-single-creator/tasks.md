---
id: SPEC-096
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-096 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: implementing
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
relates_to: [DR-074, DR-078, DR-066, DR-086, SPEC-026, SPEC-086, "#2364", "#2355", "#2365"]
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: in-progress
---

# SPEC-096 - Tasks

The order below is the order of work. Each task names the file it changes and what an
outside observer checks to call it done. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md).

Every backticked path in this file is a file this change edits or creates. Files it only
reads are named in prose, so that the spec gate's ownership signal stays as narrow as the
change.

## 1 - T0 invariant tests, written before any source change

- [x] **1.1** `packages/minspec/tests/opt-in-guard.test.ts` (new, owned) - the contract of
  the one directory operation on real temp directories: creation, the refusal with nothing
  created, the race, the empty root, the module's imports, the wording. Covers FR-11, FR-1,
  FR-2 and FR-8.
  *Done when:* it is red on the pre-change tree. Observed on a024a751: it cannot load,
  because the module it tests does not exist. That is the only red a contract test for a
  new module can have, and it is stated as such, not as a behavioural failure.
- [x] **1.2** `packages/minspec/tests/opt-in-writer-inventory.test.ts` (new, owned) - one
  declared inventory of direct directory-creating calls, checked in both directions against
  the parsed source; who calls the creator; and each store driven directly with and without
  a marker. Covers FR-9, FR-3 and FR-5.
  *Done when:* it fails on the pre-change tree because calls exist outside the inventory
  and stores create the marker, not because of a missing symbol. Observed on a024a751: 25
  of 60 fail. The inventory equality reports 20 of the 22 files; Refresh is listed as a
  caller of the creator; nine stores, `approveSpec` and `refreshHarnessFiles` create the
  marker. The 35 that pass are the scanner's own checks and every with-marker case.
- [x] **1.3** `packages/minspec/tests/commands-opt-in-invariant.test.ts` (new, owned) - the
  real `activate()`, all 44 contributed commands through the handlers it registers, in real
  folders with no marker, with every prompt answered. Covers FR-10, FR-6, FR-7 and FR-8.
  *Done when:* it fails on the pre-change tree because a command created the marker or did
  not show the refusal, and no handler rejects for want of something in the stand-in for
  the editor. Observed on a024a751, with the file as merged: 51 of 186 fail, none of them a
  rejected handler apart from the one the test expects (the auto-classify button, whose
  refusal had no handler). It was 51 of 182 when first committed; the four added since are
  the event sweep of 9.10, which passes on a024a751.

## 2 - Plan and task list

- [x] **2.1** Write design.md, with what Plan found that the spec did not have and the
  reconciliation against the 32 commits `main` gained since the spec was written.
- [x] **2.2** Write this file.
- [x] **2.3** Advance the lifecycle mirrors in requirements.md frontmatter (`status` and
  `phases` only; the body is hash-bound to the founder's approval and is not touched).
  *Done when:* `npm run facts -- hash SPEC-096` still reports APPROVED with stored and
  computed hashes equal, and `npm run facts -- status SPEC-096` reports MATCH. Observed:
  both, stored and computed `1b3c314a`.

## 3 - The guard (FR-1, FR-2)

- [x] **3.1** `packages/minspec/src/lib/opt-in.ts` (new, owned) - the predicate, the refusal
  error, its wording, `assertOptedIn` and `ensureDirectory`. Imports `fs` and `path` only.
  *Done when:* the guard test is green. Observed: all of it, 59 tests after 9.3 added two.
- [x] **3.2** `packages/minspec/src/lib/preferences.ts` - the predicate and the error move
  out and are re-exported from here, and `savePreferences` passes its own clause to the
  refusal.
  *Done when:* the two existing opt-in invariant suites (the bootstrap toast and the
  presence heartbeat) pass with no edit made to either file. Observed: both pass, and
  neither file is in this change.

## 4 - The stores (FR-5, FR-4)

- [x] **4.1** Replace the store's own `mkdir` with the guard in
  `packages/minspec/src/lib/session.ts`, `packages/minspec/src/lib/classifier.ts`,
  `packages/minspec/src/lib/parking-lot.ts`, `packages/minspec/src/lib/approval-store.ts`,
  `packages/minspec/src/lib/phase-advance-queue.ts`,
  `packages/minspec/src/lib/traceability.ts` and `packages/minspec/src/lib/merge-refresh.ts`.
- [x] **4.2** `packages/minspec/src/lib/approval.ts` - the gzip fallback through the guard,
  and `approveSpec` refuses itself before its first side effect (the git blob and ref).
- [x] **4.3** The two already behind the predicate: `packages/minspec/src/lib/auto-bootstrap.ts`
  and `packages/minspec/src/lib/presence.ts`.
  *Done when, for 4.1 to 4.3:* every store case in the inventory test is green, with the
  marker absent, present, and present holding only `preferences.json`. Observed: all green.
- [x] **4.4** Fixtures of existing tests that leaned on a store or a command creating the
  marker.
  *Done when:* the list is measured by running the suite, recorded in design.md with a
  reason per file, and no assertion in any of them was weakened or removed where a
  precondition is enough. Observed: 32 files, 226 lines added and 9 removed. The 9 are five
  test titles and the two lines each of the two tests that asserted the defect on a bare
  folder and are inverted in place. Both the list and the five are in design.md under
  "Existing tests that change".

## 5 - Refresh is not a second Initialize (FR-3)

- [x] **5.1** `packages/minspec/src/lib/scaffold.ts` - split what `scaffold()` writes beside
  the marker from the call that creates it; `refreshHarnessFiles` refuses with no marker and
  never calls the creator; the three template and managed-file writes go through the guard.
- [x] **5.2** `packages/minspec/src/commands/init.ts` - `initRefreshCommand` checks before
  calling it and shows the refusal.
  *Done when, for 5.1 and 5.2:* the inventory test's caller pin and Refresh cases are green,
  and Refresh in an empty folder leaves it empty. Observed: green. On a024a751 the same
  call left 59 files and directories.

## 6 - Artifact and tool directories (FR-4, DQ-4)

- [x] **6.1** `packages/minspec/src/lib/adr-manager.ts`,
  `packages/minspec/src/lib/epic-manager.ts`, `packages/minspec/src/lib/spec-manager.ts`,
  `packages/minspec/src/lib/spec-layout.ts` and `packages/minspec/src/commands/example.ts`.
- [x] **6.2** `packages/minspec/src/lib/claude-settings.ts`,
  `packages/minspec/src/lib/slash-commands.ts` and
  `packages/minspec/src/lib/context-injector.ts`.
  *Done when, for 6.1 and 6.2:* the inventory equality is green (five files, and nothing
  else), and Generate Example Spec with `minspec.specsDir` inside `.minspec/` shows the
  refusal and creates nothing. Observed: both, once 7.3 converted the last direct call.

## 7 - The commands (FR-6, FR-7, FR-8)

- [x] **7.1** `packages/minspec/src/commands/session.ts` - check before the questions; show
  a refusal from the save.
- [x] **7.2** `packages/minspec/src/views/codelens-provider.ts` - the same for Link Code.
- [x] **7.3** `packages/minspec/src/commands/constitution.ts` - check before anything; the
  draft's directory through the guard.
- [x] **7.4** `packages/minspec/src/commands/approve.ts` - check when the folder is known
  and again before the status flip.
- [x] **7.5** `packages/minspec/src/commands/park.ts` - before opt-in: refuse before the
  first question when only the local file is left; hand the typed topic back when issue
  creation fails after the questions.
- [x] **7.6** `packages/minspec/src/commands/classify.ts` - show a refusal from either
  persisting button.
- [x] **7.7** `packages/minspec/src/extension.ts` - show a refusal from either drift-warning
  action; correct the comment that says Refresh can run before opt-in.
  *Done when, for 7.1 to 7.7:* the command test is green end to end. Observed: all of it,
  186 tests once 9.10 added four.

## 8 - The words follow the code (FR-12)

- [x] **8.1** The eight comments FR-12 names, corrected in the commit that changes the code
  beside each.
- [x] **8.2** `packages/minspec/README.md` - the one sentence about the Park Topic fallback.
  *Done when:* the README claims test and every other test that reads the README still
  pass. Observed: the three suites that read it pass. The repository has no README parity
  test on `main` yet; the one that pins the command table is in an open pull request.
- [x] **8.3** `packages/minspec/CHANGELOG.md` - one Unreleased entry naming the changes a
  user can notice.

## 9 - Prove it and verify

- [x] **9.1** Mutation check: remove the guard from one converted writer and confirm a
  test goes red; restore and confirm green. Observed: `saveSession` back to `mkdir -p`
  fails 5 tests, in the inventory, the store's own cases and two command cases.
- [x] **9.2** Mutation check: add a new `mkdir` of a `.minspec/` path outside the guard and
  confirm a test goes red; restore and confirm green. Observed: red both times it was
  tried, in a library module (the inventory) and in a command with no check (the inventory
  and the command sweep in all three folders).
- [x] **9.3** Remove each command check and each store refusal in turn, one at a time.
  Observed: 41 mutants in all, with a clean control run before and after. 40 turn the
  suite red. The one that does not is equivalent (Propose Constitution's command check,
  whose guarded write refuses with the same message); removing both is among the 40.
  Running them is also what showed two outcomes of the guard that had no test (losing the
  race to another creator of the same directory, and finding something that is not a
  directory in the way), so two cases were added. The run was repeated on the final test
  files, and again on the tree with `main` merged in, with the same result each time.
- [x] **9.4** Run the final versions of the three T0 files against an export of a024a751
  and record the failures, so the red evidence is for the tests as merged. Observed: the
  guard test cannot load, 25 of 60 fail in the inventory test, 51 of 186 in the command
  test. Repeated against an export of 360818bc, where `main` stood when the pull request
  opened: the same 76 tests fail.
- [x] **9.5** Typecheck the three new test files with `tsc` directly. No tsconfig in the
  repository includes the tests directory, so the suite passing says nothing about types.
  Observed: clean under the root compiler options, and the same command reports an
  injected error.
- [x] **9.6** From the repository root: the full vitest suite as CI runs it, lint, build,
  typecheck, import cycles and validate. Observed on be31c689, the head with `main` merged
  in: all 348 files pass, 7525 tests, with coverage at 94.38 percent of statements; lint
  has no errors and the five warnings `main` has; validate passes with 181 warnings, two
  fewer than `main`. None of the suite's 2 skipped and 3 expected-fail tests is added by
  this change. An earlier full run, on a machine under load, timed out three tests of a
  suite this change does not touch; 9.11 is what followed from it.
- [x] **9.7** Re-run 2.3's check on the final tree: the approval still verifies. Observed:
  APPROVED, stored and computed both `1b3c314a`; status MATCH.
- [x] **9.8** Merge `main` into the branch immediately before the pull request opens, and
  repeat 9.4 to 9.7 on the merged tree. Observed: `main` had moved by one commit, 360818bc
  (9.12). It merged with no textual conflict, as a merge and not a rebase. On the merged
  tree: the three T0 files fail on an export of 360818bc exactly as on a024a751 (9.4), they
  typecheck (9.5), the full verification passes on be31c689 (9.6), and the approval still
  verifies there, APPROVED with stored and computed both `1b3c314a`, status MATCH (9.7).
  `main` was fetched again after that run and had not moved. The commit that carries this
  tick changes only this file and the plan beside it.
- [x] **9.9** Clean-runner check. A stray `/tmp/ws/.minspec` on the build machine makes a
  fake test root read as opted in. Run throwaway copies of the 13 suites that use that
  root, pointed at a path that does not exist. Observed: 48 failures in four suites before
  their precondition was stated, none after. Repeated on the final tests with the two
  further suites that only name document paths under that root: 242 of 242 pass, and 243
  of 243 once `main` was merged in and brought one more test.
- [x] **9.10** Fire every event `activate()` subscribes to, in each folder with no marker,
  with the debounced work run; and the same in a folder that has opted in, as the control.
  Added to the command test. Observed: the folder is byte-identical each time, and the
  control's decisions index is written. Removing the decisions watcher's opt-in gate turns
  it red.
- [x] **9.11** Stop the three new test files being judged by a 5 s clock under load. The
  command test and the inventory test run real local git in most cases, so they raise their
  timeout at module scope with the repository's helper for suites that shell out; the guard
  test gives its one whole-tree parse a timeout of its own.
  *Done when:* a throwaway 6 s test passes in a file that calls the helper and times out in
  one that does not. Observed: it passes in the two that call it, and times out at 5000 ms
  in the guard file, whose other tests stay on the default.
- [x] **9.12** Reconcile with what landed on `main` during the build: 360818bc, the fix for
  #2506 (three "Always" buttons silently not remembered), pull request #2509. Merged, with
  no textual conflict. Four comments it added rest on Approve Spec's own sidecar write
  creating the marker, which this change removes, so they are corrected:
  `packages/minspec/src/commands/approve.ts`,
  `packages/minspec/src/commands/backfill-epics.ts`,
  `packages/minspec/tests/approve-action.test.ts` and
  `packages/minspec/tests/backfill-epics-command.test.ts`. The last three are outside the
  spec's file list and change by comment lines only. The race case in
  `packages/minspec/tests/commands-opt-in-invariant.test.ts` for Approve's follow-up toast
  also asserts the warning that fix added.
  *Done when:* that assertion fails with the warning removed and passes with it restored.
  Observed: it does.

## Not in this change

- **Marking the spec done.** `implement` is left `in-progress` and `status` `implementing`.
  Recording completion is a lifecycle act for a human or the extension, never a line
  written by the change being judged.
- **Folders an earlier build marked by accident.** #2365, held for a human decision. A
  `.minspec/` holding only `preferences.json` is opted in here, as it is today.
- **Writes outside `.minspec/` before opt-in.** #2462, as DQ-5 records.
- **Where the marker is looked for.** #2464.
- **Hiding the refusing commands from the palette.** The spec's Out of Scope; now tracked
  as #2508.
- **Three "Always" buttons that are not remembered in a folder that has not opted in.**
  Filed as #2506. Fixed on `main` by pull request #2509 while this was being built, and
  merged in: each now shows a warning.
- **The wording of the refusal inside Create ADR and Regenerate Decision Register INDEX.**
  #2507. Their file is outside this spec's list.
