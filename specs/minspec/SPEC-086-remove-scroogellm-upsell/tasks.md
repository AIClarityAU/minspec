---
id: SPEC-086
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-086 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: implementing
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
relates_to: [DR-075, DR-064, SPEC-042, SPEC-040, "#2205", "#2359"]
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: in-progress
---

# SPEC-086 - Tasks

The order below is the order of work. Each task names the file it changes and what an
outside observer checks to call it done. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md).

Every backticked path to a source file here is one the spec declares under `implements:` or
`affects:`. The spec gate reads such paths from this file as owned code, so the one source
file this change touches outside that list (task 6.3) is named in prose, and in full in the
plan. That keeps the ownership signal exactly as wide as the spec declared it.

## 1 - T0 invariant test, written before any source change

- [x] **1.1** `packages/minspec/tests/no-scroogellm-upsell.test.ts` (new, owned) - the
  reintroduction gate. Four surfaces: the manifest, the listing text, the bundled source,
  the extension pack's guard. Each check also runs against invented inputs that contain what
  it looks for. Covers FR-9, and pins FR-3, FR-4 and FR-8.
  *Done when:* it fails against the unchanged tree for the reasons the spec names, and not
  because of a missing symbol. Observed on 17ea58b9: 4 of 55 failed, listing the export
  command and both settings in the manifest, the extension id and Marketplace address in the
  bridge, eight strings the shipped code holds, and the pack's refusal text.

## 2 - Plan and task list

- [x] **2.1** Write design.md, with the ten findings Plan made that the spec did not have.
- [x] **2.2** Write this file.
- [x] **2.3** Advance the lifecycle mirrors in requirements.md frontmatter (`status` and
  `phases` only; the body is hash-bound to the founder's approval and is not touched).
  *Done when:* `npm run facts -- hash SPEC-086` still reports APPROVED with stored and
  computed hashes equal, and `npm run facts -- status SPEC-086` reports MATCH.

## 3 - Remove the upsell and the bridge from the extension

One commit. Callers and declarations go together, so that no commit has a contributed
command with no registration, or the reverse.

- [x] **3.1** `packages/minspec/src/extension.ts` - remove the bridge import, the
  `minspec.exportTraceability` registration, the conformance watcher block, the install-time
  and prompt calls, and the export handler with its doc comment (FR-1, FR-4, FR-5).
- [x] **3.2** `packages/minspec/package.json` - remove the export command and the two
  settings (FR-3, FR-4).
  *Done when:* the diff of that file shows those three entries and nothing else.
- [x] **3.3** Delete `packages/minspec/src/lib/bridge.ts` and
  `packages/minspec/src/lib/ai-usage-detector.ts` (FR-1, FR-2, FR-5, FR-6).
- [x] **3.4** Delete `packages/minspec/tests/bridge.test.ts` and
  `packages/minspec/tests/ai-usage-detector.test.ts` (FR-7).
- [x] **3.5** `packages/minspec/tests/extension-extra.test.ts` - drop the bridge mock, its
  imports and the seven cases that exercised it; keep every other case; add the six
  activation cases from the plan (FR-7, and FR-1 to FR-5 as behaviour).
  *Done when:* the file is green, and its five "old installation" cases fail when run
  against the unchanged tree.
- [x] **3.6** `packages/minspec/tests/import-boundaries.test.ts` - reduce the pinned list to
  the five files that remain and correct "seven" in the header, the list's comment and the
  test title. The assertion stays an exact comparison (FR-7).
  *Done when for 3.1 to 3.6:* the manifest and source groups of the gate are green, and
  lint, typecheck and build pass.

## 4 - Remove the shared contract

- [x] **4.1** Delete `packages/shared/src/contracts/conformance.ts` and remove its
  re-export from `packages/shared/src/index.ts` (FR-6).
  *Done when:* the shared package builds from an empty output folder, and the extension
  typechecks against the rebuilt package.

## 5 - The extension pack

- [x] **5.1** `packages/extension-pack/package.json` - the refusal says the pack is blocked
  because ScroogeLLM is shelved (scroogellm DR-021) and no longer says to remove the guard
  when the product is live. It still exits 1. Nothing else in the manifest changes (FR-8).
  *Done when:* the pack group of the gate is green, and `npm run package` in that folder
  exits non-zero with the new text.

## 6 - The record

- [x] **6.1** `packages/minspec/CHANGELOG.md` - one entry under Unreleased saying the
  prompt, the two settings and the export command are gone, and why (FR-10).
- [x] **6.2** `specs/minspec/tasks.md` - one line under "Post-Launch: ScroogeLLM Bridge"
  saying this spec removed that work, so the ticked boxes are not read as shipped features
  (FR-10).
- [x] **6.3** The doc comment on the non-interactive folder resolver, in the `lib/` folder's
  resolve-folder module - remove the clause that names the deleted watcher as a caller.
  Comment only; its own commit.

## 7 - Prove it and verify

- [x] **7.1** Reintroduction check. With the removal in place, put back one surface at a
  time, run the gate, restore the tree, and confirm the gate is green again.
  *Done when:* each kind of surface the gate covers has been shown to turn it red, and the
  results are recorded in the pull request. Observed: 27 changes tried, 25 reintroductions
  red, 2 controls green, the tree clean and the gate green after each restore.
- [x] **7.2** Run the final gate and the final activation suite against an export of the
  unchanged tree and record the failures, so the red evidence is for the tests as merged.
  Observed on 17ea58b9: 9 of 91 failed, 4 in the gate and 5 in the activation suite.
- [x] **7.3** Typecheck the new test file with `tsc` directly. No tsconfig in the
  repository includes the tests directory, so the suite passing says nothing about types.
- [x] **7.4** From the repository root, as CI runs it: build the shared package, the full
  vitest suite with coverage, lint, typecheck, the import-cycle check, build and validate.
  The end-to-end suite was also run in a real editor host from a scratch checkout: 37
  passing, 5 skipped for want of an image library, none failing.
- [x] **7.5** Confirm the mentions the spec says stay are still in the tree and the gate is
  green with them there.
- [x] **7.6** Re-run 2.3's check on the final tree: the approval still verifies.
- [ ] **7.7** Merge `main` into the branch immediately before opening the pull request, and
  repeat 7.3, 7.4 and 7.6 on the merged tree.

## Not in this change

- **Marking the spec done.** `implement` is left `in-progress` and `status` `implementing`.
  Recording completion is a lifecycle act for a human or the extension, never a line written
  by the change being judged.
- **Cleaning up stored state** (DQ-4), **retiring the pack** (DQ-3, issue #2359), **the root
  README** (issue #2360) and **SPEC-042, DR-014, DR-001 and the EPIC-006 summary** (DQ-6,
  issue #2361 for the first).
- **The other records that cite the deleted code** (issue #2490), **the CI workflow's
  comment** (issue #2488) and **the shared package's description** (issue #2489). Found
  while building this; none is needed for the requirements.
- **A rule that no shipped source reads the home directory** (issue #2491).
- **Notes on other pull requests.** Closing pull request #2275 (the pack's walkthrough) and
  the notes on pull requests #2381 and #2441 are done on GitHub and recorded in this
  change's pull request, not ticked here.
