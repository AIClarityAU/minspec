---
id: SPEC-095
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-095 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: implementing
product: minspec
epic: EPIC-002  # Signpost Integrity
relates_to: [SPEC-022, SPEC-043, SPEC-096, DR-003, DR-066, DR-074, "#2397", "#2404"]
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: in-progress
---

# SPEC-095 - Tasks

The order below is the order of work. Each task names the file it changes and what an
outside observer checks to call it done. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md). Sections 1 to 5 are Slice 1 (a default Git for Windows
checkout works), delivered in one pull request; section 6 is Slice 2 (the property is
pinned), which no part of this change starts.

Every backticked path in this file is a file this change edits or creates. Files it only
reads, and the files Slice 2 will change, are named in prose, so that the spec gate's
ownership signal stays as narrow as the change.

## 1 - T0 tests, written before any source change

- [ ] **1.1** `packages/minspec/tests/text-round-trip.test.ts` (new, owned) - FR-9's behaviour
  test with the Slice 1 rows: every function in the four tables against the CRLF and mixed
  variants, each with its LF control; the three symptoms #2397 names; AC-2's signpost; the
  named cases for FR-5, FR-7 and FR-8; the `core.autocrlf=true` end-to-end case; T1 cases for
  the module, loaded at run time.
  *Done when:* on 350c6fa4 every CRLF row is red, pair by pair, and every control is green.

## 2 - Plan and task list

- [ ] **2.1** `specs/minspec/SPEC-095-crlf-text-round-trip/design.md` (new) - the plan for both
  slices, with the nine findings Plan made that the spec did not have.
- [ ] **2.2** `specs/minspec/SPEC-095-crlf-text-round-trip/tasks.md` (new) - this file.
- [ ] **2.3** `specs/minspec/SPEC-095-crlf-text-round-trip/requirements.md` - advance the
  lifecycle mirrors (`status` and `phases` only; the body is hash-bound to the founder's
  approval and is not touched).
  *Done when:* `npm run facts -- hash SPEC-095` still reports APPROVED with stored and
  computed hashes equal, and `npm run facts -- status SPEC-095` reports MATCH.

## 3 - The module

- [ ] **3.1** `packages/minspec/src/lib/text-io.ts` (new, owned) - preparing, detecting and
  restoring (FR-1 without its mark step, FR-4), and the read and write wrappers.
  *Done when:* the T1 cases are green.

## 4 - Readers and writers behind the four tables

- [ ] **4.1** `packages/minspec/src/lib/adr-manager.ts` - reads through the module in
  `listAdrs`, `adrHasFrontmatter`, `validateDrIndexStatus`, `validateDrAmendments` and the
  record read behind the INDEX summary; `extractExistingSummary` and `mergeDrIndex` prepare
  at entry and `mergeDrIndex` restores; `setAdrStatus` and `regenerateDrIndex` restore.
- [ ] **4.2** `packages/minspec/src/lib/epic-manager.ts` - `listEpics`, `readArtifactEpic`;
  `setArtifactEpic`, `setEpicStatus`, `setEpicOrder`, `writeEpicIndex` restore;
  `mergeEpicIndex` prepares and restores.
- [ ] **4.3** `packages/minspec/src/lib/status-parity.ts` - `inspectStatusLine` and
  `inspectAllStatusClaims` prepare at entry, which covers `checkStatusParity`.
- [ ] **4.4** `packages/minspec/src/lib/merge-refresh.ts` - `parseSections` prepares,
  `hashSection` hashes the LF form (FR-7), `mergeFile` prepares and restores.
- [ ] **4.5** `packages/minspec/src/lib/constitution.ts`,
  `packages/minspec/src/lib/constitution-compaction.ts`,
  `packages/minspec/src/lib/constitution-proposer.ts` - `parseConstitution` prepares;
  `compactConstitution` and `integrateProposal` prepare and restore.
- [ ] **4.6** `packages/minspec/src/lib/scaffold.ts` - `seedConstitution`,
  `buildTasksMdContent`, `scaffoldTasksMd`, `findSpecDirsMissingTasksMd`,
  `ensureGitattributesEntries`, `ensureGitignoreEntries`,
  `migrateLegacyClaudeSlashCommandShims`, `refreshManagedRegionTemplates` and
  `checkManagedRegionMarkers`; and `isLfPinnedPath`, which writes a pinned managed file LF
  throughout (FR-5(c)).
- [ ] **4.7** `packages/minspec/src/lib/epic-backfill.ts` - the two reads behind
  `collectArtifacts`. `applyBackfill` is fixed by 4.2.
- [ ] **4.8** `packages/minspec/src/lib/spec.ts`, `packages/minspec/src/lib/spec-layout.ts`,
  `packages/minspec/src/lib/spec-manager.ts`, `packages/minspec/src/views/spec-panel.ts` -
  `parseSpec` calls the module and records `source`; `setSpecStatus`, `setSpecPhases` and
  `advanceSpecToImplementing` read through the module and restore; `writeSpecFile`, the
  panel's checkbox write, `writeSpecKitDir` and `migrateLayout` restore (FR-5(a) for a
  migration).
- [ ] **4.9** `packages/minspec/src/lib/slash-commands.ts`,
  `packages/minspec/src/lib/context-injector.ts`, `packages/minspec/src/lib/parking-lot.ts` -
  `injectAgentsSlashSection`, `injectContext` and `removeContext` prepare and restore;
  `appendToParkingLotFile` restores.
- [ ] **4.10** `packages/minspec/CHANGELOG.md` - one Unreleased entry.
  *Done when, for 4.1 to 4.9:* every row of the behaviour test is green.

## 5 - Prove it and verify

- [ ] **5.1** Mutation check: with the fix in place, break the restoring step and confirm the
  writer rows go red; restore it.
- [ ] **5.2** Mutation check: revert one converted reader to a bare split on `\n` and confirm
  its rows go red; restore it.
- [ ] **5.3** Run the final test file against an export of the pre-change tree and record the
  failures, so the red evidence is for the tests as merged.
- [ ] **5.4** Typecheck the new test file with `tsc` directly: no tsconfig includes the tests
  directory, so a green run says nothing about types.
- [ ] **5.5** From the repository root: the suite the way CI runs it, lint, build, typecheck,
  validate.
- [ ] **5.6** The approval verdict of every approvable on `main`, before and after, with the
  repository's own `npm run facts`: identical.
- [ ] **5.7** Merge `origin/main` into the branch before opening the pull request and repeat
  5.4 to 5.6 on the merged tree.

## 6 - Slice 2 (not in this change)

None of these is started here; they are listed so the slice has its task list.

- [ ] **6.1** Adopt the #2404 commit (`814ce538`, a leading byte order mark) as the slice's
  first commit if it has not merged, then move its mark strip from parseSpec into the
  module's preparing step unchanged, and put a mark back on restore without ever adding one
  (DQ-3, DQ-8).
- [ ] **6.2** Add the lone-CR row and the two mark rows to the variant table of the
  behaviour test, and show each pairing the Context shows going wrong red on the code before
  it.
- [ ] **6.3** Route the reads of the five DQ-10 files through the module: artifact-graph.ts,
  auto-bootstrap.ts, constitution-nudge.ts, reference-checker.ts and template-engine.ts; and
  the survive-CRLF readers that still read raw text in files Slice 1 touched
  (fileEntryExists in parking-lot.ts, the spec id sniff behind nextSpecId in
  spec-manager.ts) and the two #2481 detectors (design finding 2).
- [ ] **6.4** FR-6: setAdrStatus decides by the record's first non-blank line, and the Accept
  and Set Decision Status path in the decision commands shows that error with no offer to add
  frontmatter.
- [ ] **6.5** FR-10: the inventory test, text-io-inventory.test.ts, with its two pins, shown
  to fail on the code before it.
- [ ] **6.6** AC-1, AC-5, AC-11, AC-14, AC-18 and the rest of AC-17.

## Not in this change

- **Marking the spec done.** `implement` is left `in-progress` and `status` `implementing`;
  Slice 2 is still owed, and recording completion is a lifecycle act for a human or the
  extension, never a line written by the change being judged.
- **One Refresh that is not a fixed point** (design finding 7). Pre-existing and not about
  line endings; filed as its own issue.
- **#2465, #2466, #2467, #2468, #2472, #2474, #2477**, as the spec lists.
