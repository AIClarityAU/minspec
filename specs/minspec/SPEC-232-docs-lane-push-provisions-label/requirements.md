---
id: SPEC-232
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # docs-lane push ergonomics across adopter repositories
aspects: [docs-lane, consent, forge-write, blast-radius, adopter-parity]
relates_to: [SPEC-039, SPEC-050, DR-098, DR-071, "#2257", "#2243", "#2094"]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-232: "MinSpec: Push Docs Lane" lands in a repository that has no `docs-lane` label

Issue: #2257 (sibling of #2243, which fixed the approval path). Rests on DR-098 (approval flow may create the missing lane label).

## In plain terms

`gh pr create --label docs-lane` refuses outright in a repository without that label, so
**MinSpec: Push Docs Lane** (`minspec.pushDocsLane`, SPEC-039) fails there, and only after it
has already pushed its `docs-lane/<sha>-<n>` branch. #2243 taught the approval path to create the
label once; this command was left out because SPEC-050 AC-10 requires `push-docs-lane.test.ts`
to pass unchanged. This spec gives the command the same behaviour, under the same boundary,
without editing that test file.

## Context (read from code, 2026-10-27)

- `openPullRequest` (`packages/minspec/src/lib/approval-pr.ts`) has an opt-in
  `provisionLaneLabel` (default `false`); with it, a create refused for a missing `docs-lane`
  label triggers one `gh label create docs-lane` and one retry of the create.
- The approval caller opts in when it has labels AND `laneWorkflowPresent(rootDir)`
  (`commit-on-approve.ts:372`, `:841`). That helper is private to `commit-on-approve.ts`.
- `push-docs-lane.ts` (~`:370`) calls `openPullRequest` with `labels: [DOCS_LANE_LABEL]` and no
  opt-in. Its PR is created from a temp worktree `wt` off `origin/main`, with `cwd: wt`.
- DR-098 condition 6 states that SPEC-039's command "does not opt in; its classification is
  pinned by SPEC-050 AC-10, and #2257 tracks it". This spec supersedes that sentence.
- SPEC-050 AC-10 constrains the *tests*: SPEC-039's existing tests must pass unchanged. It
  does not forbid the command gaining a behaviour, provided those tests stay green and unedited.

## Functional requirements

- **FR-1** `minspec.pushDocsLane` opts in to `provisionLaneLabel` when, and only when, the
  lane workflow `.github/workflows/docs-lane.yml` is present (FR-2). Otherwise behaviour is
  exactly today's (default `false`), including the classification of a missing-label failure.
- **FR-2** Workflow presence is the same local, network-free file read the approval path uses,
  any error answering "no". The check is a single shared function used by both callers (no
  second copy that can drift), and is evaluated against the tree the PR is created from
  (see Decisions needed D-1).
- **FR-3** The boundary is DR-098's six conditions unchanged: label name is the constant
  `DOCS_LANE_LABEL` only; `gh label create` with no `--force` (an existing label is never
  edited); no `gh label list/view`; same `cwd`/`slug` as the PR create; at most one create and
  one retry per invocation.
- **FR-4** Consent: the label create happens only inside the PR-opening step, reachable only
  after the user invoked the command and confirmed the SPEC-039 FR-3 dialog. The dialog text
  names that a missing `docs-lane` label may be created in the target repository (disclosure
  before the network action, DR-071 condition 2).
- **FR-5** Never silent: on success the result surface states `created the missing docs-lane
  label`; on failure it names the label and says it could not be created. A concurrent
  "already exists" is treated as provisioned (inherited from `createLaneLabel`).
- **FR-6** Failure after push: when the label cannot be provisioned, the typed result is a
  PR-opening failure naming the missing label (not a generic "could not open PR"), and the
  already-pushed branch is reported so the user can open the PR by hand (see D-2 for cleanup).
- **FR-7** The unchanged invariants of SPEC-039 hold: docs corpus only, primary HEAD/index
  untouched, never throws, offline until consent.
- **FR-8** `push-docs-lane.test.ts` is not edited; new behaviour is covered by a new test file.

## Acceptance criteria

- **AC-1 (FR-1)** Repo with the lane workflow, gh refusing with `could not add label:
  'docs-lane' not found`: exactly one `gh label create docs-lane`, one retry, result `pushed`
  with the PR URL and the "created the missing docs-lane label" note.
- **AC-2 (FR-1)** Repo without `.github/workflows/docs-lane.yml`: no `gh label create` is ever
  run; the result is today's failure.
- **AC-3 (FR-3)** The label-create argv contains no `--force` and only `docs-lane`; a refusal
  naming a different label provisions nothing.
- **AC-4 (FR-3)** Label already exists (create reports "already exists"): retry proceeds, no
  error, no edit.
- **AC-5 (FR-5/6)** `gh label create` fails (e.g. no permission): result names the label and
  that it could not be created; no second create, no loop.
- **AC-6 (FR-4)** Declining the confirmation runs no `gh` command at all.
- **AC-7 (FR-8)** `git diff` of the change shows `push-docs-lane.test.ts` untouched and it
  passes; a guard (test) fails if the default-`false` path in `openPullRequest` gains a label call.
- **AC-8 (FR-2)** `laneWorkflowPresent` has one definition imported by both commands.

## Invariants the change must not break

- Constitution 1 (offline/consent): no network before the FR-3 confirmation.
- Constitution 2 (no silent gate): label failure is visible, never swallowed.
- Constitution 3 (blast radius): only the PR's own repository, only where `.minspec/`-installed
  lane workflow exists; no other label ever created or edited.
- SPEC-039 INV-1..4; SPEC-050 INV-1, INV-2 and AC-10; DR-098 conditions 1-5.

## Decisions needed (Clarify)

- **D-1 Which tree is checked for the workflow?** (a) **the temp worktree off `origin/main`
  (rec)** - it is the tree the PR targets, so "the lane is installed on the base" is what
  matters; cost: a user who has added the workflow locally but not yet merged it gets no label
  (safe direction, nothing written). (b) the primary checkout, matching the approval path;
  cost: may create a label for a lane the base branch does not have.
- **D-2 Orphan branch.** The failure happens after push. (a) **leave the branch and name it in
  the failure (rec)** - no new destructive git action, user can open the PR by hand; cost: a
  stray remote branch on failure. (b) preflight-create the label *before* pushing; cost: moves
  a forge write ahead of the push and reorders SPEC-039's pinned call sequence, which risks
  breaking its existing tests.
- **D-3 Amending DR-098 condition 6.** (a) **edit DR-098's sentence to point at SPEC-232
  (rec)** - keeps one authoritative record; cost: edits an accepted DR (a wording amendment,
  not a new decision). (b) leave it and rely on this spec; cost: DR-098 asserts something false.
- **D-4 Confirmation dialog wording (FR-4).** Adding a sentence changes a string the existing
  tests may match. (a) **append a separate sentence only when the lane workflow is present
  (rec)**; cost: dialog text varies. (b) no dialog change, rely on the command title and
  settings text; cost: weaker disclosure than the approval path.
