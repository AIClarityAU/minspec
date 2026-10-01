---
id: SPEC-085
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-085 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: implementing
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
relates_to: [DR-004, DR-050, DR-071, DR-066, DR-074, "#2329", "#2247"]
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: in-progress
---

# SPEC-085 - Tasks

The order below is the order of work. Each task names the file it changes and what an
outside observer checks to call it done. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md).

Every backticked path in this file is a file this change itself edits or creates. Files it
only reads are named in prose, so that the spec gate's ownership signal stays exactly as
wide as the change.

## 1 - T0 invariant tests, written before any source change

- [x] **1.1** `packages/minspec/tests/backlog-consent.test.ts` (new, owned) - drive the real
  provider with only `child_process` and `vscode` stubbed, across seven answers `gh` could
  give. Covers FR-1, FR-2, FR-4, FR-5, FR-6 and FR-7, plus the wiring pins.
  *Done when:* it fails against the pre-fix code because processes were started, not
  because of a missing symbol. Observed on 5f679727: 68 of 77 failed, and the first failure
  lists `gh auth status` and `gh issue list` started by a render.
- [x] **1.2** `packages/minspec/tests/readme-network-claims.test.ts` (new, owned) - one
  inventory of every module that can start a process, checked against the spawn allowlist
  and against the code, and the README section checked against the inventory. Covers FR-9
  and FR-10.
  *Done when:* on the pre-fix documents the classification half passes (the inventory is
  complete) and the README half fails (features unlisted, retired phrases present).

## 2 - Plan and task list

- [x] **2.1** Write design.md, with the six findings Plan made that the spec did not have.
- [x] **2.2** Write this file.
- [x] **2.3** Advance the lifecycle mirrors in requirements.md frontmatter (`status` and
  `phases` only; the body is hash-bound to the founder's approval and is not touched).
  *Done when:* `npm run facts -- hash SPEC-085` still reports APPROVED with stored and
  computed hashes equal, and `npm run facts -- status SPEC-085` reports MATCH.

## 3 - Adopt the #2247 fix (DQ-5)

- [x] **3.1** Cherry-pick commit 460166a8 from the `agent/issue-2247` branch, unmodified, as
  its own commit. It changes `packages/minspec/src/lib/backlog.ts`,
  `packages/minspec/src/commands/backlog.ts`, `packages/minspec/src/views/backlog-view.ts`,
  `packages/minspec/tests/backlog-view.test.ts`,
  `packages/minspec/tests/backlog-async.test.ts` and
  `packages/minspec/tests/commands.test.ts`.
  *Done when:* the pick applies with no conflict, those three test files pass, and the FR-6
  group of the consent test goes green while the FR-1 group stays red (the swallow is gone,
  the unprompted fetch is not).

## 4 - The consent gate

- [x] **4.1** `packages/minspec/src/views/backlog-view.ts` - hold one of four states, make
  `getChildren` draw the held state and nothing else, run the fetch only from
  `refresh({ contactGitHub: true })`, add the not-loaded, loaded-at, zero and could-not-load
  rows, and drop the `gh auth status` probe (FR-1 to FR-5, DQ-1, DQ-2).
  *Done when:* every provider-level group of the consent test is green.
- [x] **4.2** `packages/minspec/src/extension.ts` - pass the gesture argument at the
  `minspec.refreshBacklog` registration and nowhere else, and correct the comments that
  describe a fetch on visibility, focus and folder change (FR-1, FR-2, FR-4).
  *Done when:* the syntax-tree pin in the consent test is green, and the two activation
  suites (the extension and extension-extra tests) pass without being edited.
- [x] **4.3** `packages/minspec/package.json` - the Refresh Backlog title says it contacts
  GitHub through the user's `gh` CLI (FR-2).
  *Done when:* the title pin in the consent test is green.
- [x] **4.4** `packages/minspec/tests/backlog-view.test.ts` - rewrite the root-rendering
  tests, which assumed a render fetches, around the four states (T2).
  *Done when:* the file is green and no test in it expects a render to call `fetchIssues`.

## 5 - Published statements

- [x] **5.1** `packages/minspec/README.md` - rewrite "What MinSpec Does on Your Network" as
  three lists, one per kind of consent; make the FAQ answer and the Privacy section point at
  it; give the command table the new title (FR-8).
- [x] **5.2** `packages/minspec/media/walkthrough/welcome.md` - replace "No network calls."
  with the true claims and a link to the section (FR-8).
- [x] **5.3** `sites/minspec.dev/index.html` - the feature card says the same and links to
  the section (FR-8, DQ-3).
- [x] **5.4** `packages/minspec/tests/invariants.test.ts` - the `lib/backlog.ts` allowlist
  entry gets a consent-clause comment in the form the approve-push entry uses (FR-10).
  *Done when, for 5.1 to 5.4:* the README claims test is green end to end.

## 6 - Prove it and verify

- [x] **6.1** Mutation check. With the fix in place, make the render fetch again and
  confirm the consent test goes red; restore and confirm it goes green.
  *Done when:* both observations are recorded in the pull request.
- [x] **6.2** Run the final versions of both T0 files against an export of the pre-fix tree
  and record the failures, so the red evidence is for the tests as merged and not for an
  earlier draft of them.
- [x] **6.3** Typecheck the two new test files with `tsc` directly. No tsconfig in the
  repository includes the tests directory, so the suite passing says nothing about types.
- [x] **6.4** From the repository root: the full vitest suite, lint, build, typecheck and
  validate.
- [x] **6.5** Re-run 2.3's check on the final tree: the approval still verifies.

## Not in this change

- **Publishing the site.** Nothing here deploys. The site deploys itself when a change
  under `sites/` reaches `main`, so merging this change is what publishes the card (design
  finding 4).
- **Marking the spec done.** `implement` is left `in-progress` and `status` `implementing`.
  Recording completion is a lifecycle act for a human or the extension, never a line
  written by the change being judged.
- **#2455, #2456, #2457.** Filed while building this; none is needed for the requirements.
- **#2246** (truncation at 100 issues), **#573** (multi-root) and **#645** (positioning),
  as the spec lists.
