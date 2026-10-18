---
id: SPEC-141
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - the harness a shared repo carries, and who can land it
aspects: [harness-refresh, workflow-files, push-handoff, offline, no-silent-gate, blast-radius]
relates_to: [SPEC-033, DR-011, DR-092, "#1931", "#1554", "#1120", "#758", "#1298"]
# Ownership declared in Specify (SPEC-038). Nothing new is owned: the change lives in the
# existing commit offer and its tests. Modified, not owned.
affects: [packages/minspec/src/commands/init.ts, packages/minspec/tests/init-commit-offer.test.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-141: A harness refresh that changes a workflow file says plainly that a human must push it

Triggered by: #1931 (harness refresh can no longer be pushed by any agent).

## In plain terms

When MinSpec refreshes its harness files, some of them are GitHub Actions workflows under
`.github/workflows/`. Since 2026-09-11 no agent can push a change to those files: the bot's
GitHub App no longer has the `workflows` permission, on purpose. Today the refresh commits
them, says nothing about this, and the agent that tries to push is refused. The commit then
sits on a branch nobody is told to push.

With this spec, whenever the commit MinSpec offers includes a workflow file, the offer says
so before it commits, names the files, and gives the one push command for a person to run.
The same note is written into the commit message, so an agent reading the branch later sees
it before it tries to push. Nothing else about the refresh changes. MinSpec still never
pushes, and it never asks GitHub what permissions anyone has.

## Context

**What changed, and why it stays.** On 2026-09-11 the founder removed `workflows=write`
from the minspec-sdd GitHub App (host-side DR-079 in the founder's NixOS configuration, not
this repository's register). Together with `contents=write` on an all-repositories
installation, it amounted to running any code in GitHub Actions with repository secrets,
from a token that reads as a bot. This spec takes that removal as fixed. Re-granting it is
out of scope (see Alternatives).

**Measured refusal** (#1931, AIClarityAU/scroogellm, commit `c96ba6a` on
`chore/minspec-harness-refresh-2026-09-11`):

```
! [remote rejected] chore/minspec-harness-refresh-2026-09-11 -> chore/minspec-harness-refresh-2026-09-11
  (refusing to allow a GitHub App to create or update workflow `.github/workflows/ai-review.yml` without `workflows` permission)
```

**Where the refresh writes workflow files** (read 2026-10-18, base `1e877a4a`):

- The commit offer stages `SCAFFOLD_PATHSPECS`, which spreads every
  `MANAGED_REGION_TEMPLATES` output path (`packages/minspec/src/commands/init.ts:101-116`).
- `MANAGED_REGION_TEMPLATES` begins with `.github/workflows/minspec-validate.yml`
  (`packages/minspec/src/lib/template-registry.ts:2766-2771`); the AI-review stack adds
  `ai-review.yml`, `ready-to-merge.yml`, `ai-review-retry.yml`, `docs-lane.yml` and
  `secret-scan.yml` (`template-registry.ts:2586-2622`).
- After a refresh, `refreshHarnessFiles` calls `offerScaffoldCommit(folder, { variant:
  'refresh' })` (`init.ts:1538`). The offer commits on the current branch, or on a new
  `chore/minspec-harness-refresh[-YYYY-MM-DD[-N]]` branch when the current branch is the
  default (`init.ts:400-443`, `init.ts:530-532`). The same offer is reachable again from
  the recovery command (`init.ts:566-581`, #758).
- **MinSpec never pushes this commit.** No push appears in the offer or its committer
  (`init.ts:240-330`). The refused push in #1931 was an agent's, run from a shell after the
  extension's commit. So the defect is not a failing push inside MinSpec; it is that nothing
  MinSpec writes tells whoever comes next that this particular commit needs a person.

**What MinSpec can and cannot know.** It can see, offline, which paths it is about to
commit. It cannot know who will push, or with what credential, without asking GitHub
(constitution invariant 1). So every requirement below is driven by the paths alone, and
its wording must be true whoever pushes.

## Terms

- **The offer**: `offerScaffoldCommit` in either variant (init or refresh), including its
  re-run through the recovery command (#758).
- **The committed set**: the paths the offer stages, after its ignore filter
  (`init.ts:262-276`).
- **A workflow path**: any path in the committed set whose repository-relative form starts
  with `.github/workflows/`. Any file there, not only `*.yml`: the refusal is about the
  directory, not the extension (OQ-3).
- **The handoff**: the text FR-2 to FR-4 add.

## Requirements

### A. Detect

- **FR-1 - Classify by path, offline.** Before it shows its prompt, the offer computes the
  workflow paths in the committed set that are actually changed (the same `dirty()` result
  `collectDirtyScaffoldPaths` uses, `init.ts:175-190`). A path that exists but is already
  committed and unchanged is not a workflow path for this purpose, because the commit will
  not change it. This uses only the local repository: no network call, no `gh`, no read of
  any credential or token.

### B. Say so before committing

- **FR-2 - The prompt names the files.** When FR-1 finds at least one changed workflow path,
  the offer's prompt (both the default-branch prompt and the plain one) adds one sentence,
  in plain words: this commit changes the named workflow files, and on GitHub a push that
  changes a workflow file is refused for any credential without the `workflows` permission,
  which includes MinSpec's own bot, so a person should push it. It names each file, or the
  first three and a count when there are more. The prompt stays non-modal and does not take
  focus.
- **FR-3 - After the commit, the push command.** When the commit succeeds and FR-1 found a
  workflow path, the success message names the branch the commit landed on and offers a
  `Copy push command` button that copies exactly `git push -u origin <branch>` for that
  branch. The extension does not run it. If the repository's remote for the branch is not
  named `origin`, the command uses the name `git` reports for that branch's push remote, or
  `origin` when none is configured (OQ-4).
- **FR-4 - The note travels with the commit.** When FR-1 found a workflow path, the commit
  message gains a body (the subject line `REFRESH_COMMIT_MESSAGE` /
  `SCAFFOLD_COMMIT_MESSAGE`, `init.ts:62`, is unchanged) carrying one line per workflow path
  and one trailer:

  ```
  chore: refresh MinSpec harness files

  Changes workflow files:
  - .github/workflows/ai-review.yml

  Push-Requires: workflows permission (push by a person, not a GitHub App bot)
  ```

  The trailer key is fixed so a script or an agent can test for it with
  `git log --format=%(trailers:key=Push-Requires)`. A commit whose committed set holds no
  workflow path gets no body and no trailer, so its message is byte-identical to today's.

### C. Change nothing else

- **FR-5 - One commit, unchanged contents.** The offer still makes one commit holding the
  whole committed set. It does not split workflow files into a separate commit, defer them,
  or drop them (see Alternatives, "split").
- **FR-6 - No push, no probe.** The offer never pushes, never calls `gh`, never reads a
  remote's permissions, and never infers who will push. The handoff is shown whenever FR-1
  finds a workflow path, whether or not the eventual pusher could have pushed it.
- **FR-7 - Declining is unchanged.** Dismissing or declining the offer commits nothing and
  shows no handoff, exactly as today (`init.ts:432`, `init.ts:440`).
- **FR-8 - Blast radius.** The handoff appears only where the offer already runs: a folder
  with `.minspec/` at its root (constitution invariant 3). No adopter gets new behaviour
  outside a refresh or init it triggered.
- **FR-9 - Wording is conditional on GitHub.** The sentence in FR-2 says "on GitHub". It is
  shown for every remote, not only a GitHub one, because MinSpec scaffolds GitHub Actions
  workflows only and a repository carrying them is pushed to GitHub in every case seen;
  telling a non-GitHub user something conditional costs one sentence, whereas a missed
  GitHub case costs a stranded branch.

## Acceptance criteria

All through the existing stub-committer seam (`OfferScaffoldCommitDeps.makeCommitter`),
plus one real-git fixture for FR-4.

- **AC-1** Refresh variant, committed set holds a changed `.github/workflows/ai-review.yml`
  and a changed `CLAUDE.md`, on the default branch: the prompt text names
  `.github/workflows/ai-review.yml` and contains "workflows" permission wording; it does
  not name `CLAUDE.md` as a workflow file.
- **AC-2** Same set, not on the default branch: the plain prompt carries the same sentence.
- **AC-3** Committed set holds only non-workflow changes: prompt text, success text and the
  commit message are byte-identical to the pre-change strings (asserted against literal
  copies in the test, not the constants under change).
- **AC-4** A workflow file exists on disk but is not dirty: no handoff sentence, no body.
- **AC-5** After `Commit on a new branch` succeeds with a workflow path: the success message
  names the branch, and choosing `Copy push command` writes exactly
  `git push -u origin chore/minspec-harness-refresh` to the clipboard stub.
- **AC-6** Real-git fixture: after the commit, `git log -1 --format=%(trailers:key=Push-Requires,valueonly)`
  prints the FR-4 value, and the body lists every staged workflow path and no other.
- **AC-7** Five workflow paths: the prompt names three and says "and 2 more"; the commit
  body lists all five.
- **AC-8** No network: the test's command runner fails the test on any `gh` invocation or
  any `git push`, `git fetch` or `git ls-remote`.
- **AC-9** Declining or dismissing either prompt: no commit, no clipboard write, no handoff
  message.
- **AC-10** Mutation pairing: removing the workflow-path check from the message builder
  makes AC-1 and AC-6 fail.

## Invariants this must not break

- **Constitution 1 (offline).** FR-1 and FR-6: paths only, no network, no credential read.
- **Constitution 2 (no silent gate).** The handoff is not a gate and adds none; it makes a
  requirement a forge already enforces visible at the point the commit is made, instead of
  only at a refused push.
- **Constitution 3 (blast radius).** FR-8.
- **DR-011 / DR-073 managed-content rules.** File contents written by the refresh are
  untouched; only the commit offer's prompt, message and success text change.
- **DR-092 (refresh only moves forward).** Unaffected: this acts after the write.

## Limitations, stated plainly

- **The primary is still parked off main.** The offer still creates its branch in the
  checkout it runs in (`init.ts:421`, `git checkout -b`). After this spec the stranded
  branch at least says who must push it; moving the commit to a worktree is #1554's, not
  this spec's (OQ-1).
- **A dismissed toast is still lost.** FR-2 and FR-3 are toasts. FR-4's trailer is the
  durable part: it survives a dismissed toast and a reload, and an agent that reads
  `git log` before pushing sees it.
- **An agent that does not look still tries.** Nothing here stops a push attempt; GitHub
  does. This spec moves the information earlier; it does not add a gate (OQ-2).
- **Workflow files changed by hand are not covered.** Only the offer is changed. A user who
  commits a refresh by hand gets no trailer.

## Decisions needed (Clarify)

Each question names the option this document recommends and what that recommendation
costs. An agent wrote these recommendations under the repository's `act` autonomy
(DR-086 section 4); nothing here is ratified until the spec is approved.

### OQ-1 - Fold #1554 (refresh branches the primary in place) into this spec?

The issue's recommended option says the extension "commits on a worktree branch (never the
primary; see #1554)".

- **Option A - keep #1554 separate (rec).** This spec is the message; #1554 is where the
  commit lands. Each can be built and reviewed alone, and the message is correct under
  either landing place. *Cost:* until #1554 lands, a refresh still leaves the primary on a
  `chore/...` branch, now labelled as needing a person, but still off `main`.
- **Option B - fold it in.** One spec moves the commit to a worktree and adds the handoff.
  *Cost:* the worktree move needs its own design (where the worktree lives, how the editor's
  open files relate to it, cleanup), which this issue does not describe; it makes this a
  larger T3 and delays the message.

Under B, FR-3's command gains a `cd <worktree>` and a new FR family for the worktree.

### OQ-2 - Also add a rule to the managed agent prose?

Agents in adopting repositories read the managed section of `CLAUDE.md` / `AGENTS.md`.

- **Option A - trailer only, no new prose (rec).** The trailer is deterministic and sits on
  the exact commit concerned. *Cost:* an agent that pushes without reading `git log` still
  hits the refusal; the information is there, not pushed at it.
- **Option B - also add one managed line:** "A commit carrying `Push-Requires: workflows
  permission` is pushed by a person; do not push it as an agent." *Cost:* one more
  model-trusted prose rule shipped into every adopter, which the constitution names as the
  weak form; and every adopter's managed section changes on the next refresh.

Under B, the change touches `template-registry.ts`'s managed prose and SPEC-079's parity set.

### OQ-3 - What counts as a workflow path?

- **Option A - anything under `.github/workflows/` (rec).** Matches the directory the forge
  protects. *Cost:* a non-workflow file a user keeps there (a README) would also be named;
  MinSpec scaffolds none, so this only arises from paths MinSpec does not stage.
- **Option B - only `.github/workflows/*.yml` and `*.yaml`.** *Cost:* relies on the
  forge's rule being narrower than its message states, which is unverified.

### OQ-4 - The remote name in the push command

- **Option A - the branch's configured push remote, else `origin` (rec).** Read from local
  git config only. *Cost:* a fresh branch has no upstream yet, so this is `origin` in
  practice; a repository whose sole remote has another name gets a command that fails
  visibly with git's own message (the #1545 rename advisory already nudges toward `origin`).
- **Option B - always `origin`.** *Cost:* simplest; wrong in the same misnamed-remote case,
  with no attempt to be right.

### OQ-5 - The second surface: `gh pr update-branch` as the App (unverified)

The issue believes, unverified, that the App is also refused when updating a pull request
branch whose base gained workflow-file changes, because the merge commit it writes updates
workflow files. That is this repository's dev-time merge machinery, not the extension, and
nothing in this spec depends on it.

- **Option A - out of scope here; one measured probe first, filed as its own issue (rec).**
  *Cost:* until probed and filed, the merge funnel may hit an unexplained refusal on exactly
  the machinery pull requests it drives. ➡️ This needs a person to file the issue: an agent
  on this dispatch may not run `gh`.
- **Option B - specify a fallback now.** *Cost:* designs around an unmeasured claim, which
  the hard-data rule forbids.

## Alternatives considered (recorded because nobody saw them live, DR-086 section 4)

- **Split the refresh** (the issue's second option): agents push non-workflow files, a
  person pushes workflow files in a separate commit. Rejected: two pull requests per refresh
  per repository, and a harness that can sit half-applied between them, where the AI-review
  scripts and the workflow that runs them disagree.
- **Re-grant `workflows=write`.** Rejected: reverses host DR-079, the reason for the change.
- **Probe the credential before committing** (ask GitHub whether the pusher has the
  permission). Rejected: a network call MinSpec does not make (invariant 1), and MinSpec
  does not know who will push.
- **Refuse to commit workflow files at all.** Rejected: it leaves the harness stale, which
  is the failure DR-092 and #758 exist to prevent.

## Traceability

- Triggered by #1931. Related: #1554 (refresh branches the primary in place), #1120 (older
  permission premise, now true by design), #758 (recoverable commit offer), #1298 (unique
  refresh branch names).
- No decision record: every choice here is message text and a commit-message trailer,
  reversible in well under a day (the decision-record filter: a record is needed only for
  a choice that cannot be undone within a day). The design rests on host-side DR-079,
  which lives outside this repository.
