---
id: SPEC-052
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-052 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-009  # Team Readiness
relates_to: [SPEC-039, SPEC-026, SPEC-050, DR-065, "#1316", "#1370", "#1162"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-052 - Tasks

The order below is the order of work. Each task is one pull request, ends with the full
suite green, and names the requirement IDs it satisfies, the files it touches and the test
that proves it. The plan is [design.md](design.md), including its *Decisions taken*; the
contract is [requirements.md](requirements.md), which no task edits.

Rules for every task:

- Tasks 2-6 run in order: each builds on the symbols the one before it exported. Task 1 is
  independent and may run first or in parallel; no code task waits on its acceptance
  (design.md, OQ-4 row).
- Write the task's test first, run it against the unchanged code, and paste the red output
  into the pull request. A test that is green before the change is not done.
- All new code lives in `packages/minspec/src/commands/push-work-branch.ts` and all new
  tests in `packages/minspec/tests/push-work-branch.test.ts` (the spec's `implements:`).
  Helpers are exported from that module for the test; do not create a new `lib/` file.
- Reuse, never copy: `defaultExecRun`, `ExecRun`, `describeError`, `isEnoent`,
  `isNetworkError`, `slugFromOriginUrl`, `splitCommitMessage` and `openPullRequest` from
  `lib/approval-pr.ts`; `isDocsCorpusPath` from `lib/docs-corpus.ts`;
  `contendingLiveSessions` and `readAllRecords` from `lib/presence.ts`. Do not edit
  `push-docs-lane.ts`, `approval-pr.ts`, `presence.ts` or `tidy-primary.ts`.
- No test opens a network connection. `gh` is always a stub; `git push` targets a local
  bare repository.
- Run `npx vitest run` (what CI runs), `npm run typecheck` and `npm run validate` before
  calling a task done.

## 1 - Decision record: the boundary between the two routes off a shared checkout (OQ-4; #1370)

- [ ] **1.1** `docs/decisions/DR-NNN.md` (number from the collision gate,
  `scripts/check-dr-id-collision.ts`, never from the files on disk) and
  `docs/decisions/INDEX.md` - `status: proposed`, `Triggered by: #1370`. Before drafting,
  search `main` and open pull requests for a DR already recording this boundary; if one
  exists, stop and report it. Content: design.md, *The two sanctioned routes* - which work
  each route moves (committed vs never-committable), whether it touches the shared HEAD or
  index, how consent is given, how it lands, why two routes rather than one, and what
  neither may do (move the shared checkout's HEAD without the presence gate). Cite DR-065,
  SPEC-052, SPEC-039, SPEC-026, DR-051, #1316, #1162. `## Follow-ups (tracked)` lists #1316
  and #809.
  *Done when:* `npm run validate` passes and the record carries `## In plain terms`.

## 2 - Result type, pure helpers and the toast surface (FR-4, FR-9; INV-5; AC-5, AC-8, AC-9)

- [ ] **2.1** `packages/minspec/tests/push-work-branch.test.ts` (new) - vscode mocked as in
  `push-docs-lane.test.ts`. Cases:
  - `parseStatusZ`: NUL-separated input with `' M'`, `'M '`, `'A '`, `'??'`, `' D'`, `'D '`
    entries, including a path with a space, a leading space in the status column and a
    non-ASCII name; never trims the status; empty input gives `[]`.
  - `buildPickItems` (design.md, *Picker*): group order (differs, claimed, same as base,
    unmarked); every item `picked: false` for every input, including a second call with the
    same candidates (AC-8); with `presenceAvailable: false`, no item description mentions a
    session (AC-9); claimed paths are de-highlighted only when presence is available;
    `unsupported` candidates are not items and are counted in the title.
  - `slugify`: punctuation and case folded, runs collapsed, 40-character cap, `changes`
    for an empty or all-symbol subject.
  - `defaultCommitMessage`: one file, several files in one directory, several directories.
  - `allDocs(selection)`: true only when every path passes `isDocsCorpusPath`.
  - `surface`: one table row per `PushWorkOutcome` asserting which toast function was
    called and that the messages of the non-silent outcomes are pairwise distinct (AC-5);
    `cancelled`, `no-folder` and `redirected` show nothing; `pushed` offers **Open PR**; a
    `cleanupError` adds the worktree sentence; **Tidy landed files…** appears only when
    `landedCount > 0`, `onDefaultBranch` is true and the outcome is one of the four in
    design.md *Cleanup after merge*, and choosing it calls
    `executeCommand('minspec.tidyPrimary')`.
- [ ] **2.2** `packages/minspec/src/commands/push-work-branch.ts` (new) - `PushWorkOutcome`,
  `PushWorkResult`, `WorkCandidate`, `parseStatusZ`, `buildPickItems`, `slugify`,
  `defaultCommitMessage`, `allDocs`, `surface`, exactly as design.md *Result and toasts*.
  No command function yet, and nothing registered.
  *Done when:* 2.1 is green.

## 3 - Gather: local probes and candidates (FR-2, FR-4; INV-1, INV-3; AC-9, AC-10)

- [ ] **3.1** `packages/minspec/tests/push-work-branch.test.ts` - `gatherWork(folder, run,
  selfSessionId)` against a recording stub runner: the typed outcomes `not-a-repo`,
  `detached-head`, `no-origin`, `nothing-changed`; the status call carries `-z`,
  `--untracked-files=all` and `--no-renames`; default branch read from
  `refs/remotes/origin/HEAD`, falling back to `main`; an unresolvable base ref gives
  candidates with no `sameAsBase` marking and no error; base equality marks a path whose
  `hash-object` blob equals its `ls-tree` blob and a deletion absent from the base, and not
  a path that differs; every argv the stub saw is in the local-only allowlist of design.md
  *Testing approach*. Against real temp repositories: an untracked directory with two files
  yields two candidates, never the directory; a submodule-like nested repository is
  `unsupported`; a path named `a[b].txt` does not match `ab.txt`; a presence record dir that
  is unreadable or holds corrupt JSON yields `presenceAvailable: false` and no claimed
  paths; a live peer record listing a path yields that path as claimed.
- [ ] **3.2** `packages/minspec/src/commands/push-work-branch.ts` - `gatherWork` per
  design.md *Gather*, returning either a terminal `PushWorkResult` or `{ root, slug,
  defaultBranch, branch, onDefaultBranch, baseResolved, candidates, claimed,
  presenceAvailable }`. No network command, no write.
  *Done when:* 3.1 is green.

## 4 - Choose: picker, docs redirect, consent, message (FR-3, FR-5, FR-10, FR-11; INV-1; AC-2, AC-7, AC-8, AC-10)

- [ ] **4.1** `packages/minspec/tests/push-work-branch.test.ts` - `chooseWork(gathered)`
  with vscode mocked: Escape in the picker is `cancelled` and an empty pick
  `nothing-selected`; the picker receives `canPickMany: true` and no item pre-ticked, and a
  second call after a first selection is still all unticked (AC-8); an all-docs selection
  shows the redirect modal with both buttons, **Use docs lane** runs
  `executeCommand('minspec.pushDocsLane')` and returns `redirected` with no consent dialog,
  **Open a normal PR** continues to consent, dismiss is `cancelled` (AC-7); the consent
  modal's detail names every selected path, the `work/` branch pattern, the base and the
  network sentence, and on a non-default branch its first line names the branch and the
  direct-commit route (AC-10, FR-11); declining consent is `cancelled`; Escape in the
  message box is `cancelled`, a blank message uses the default. For AC-2: drive
  `gatherWork` then `chooseWork` with a recording runner, decline consent, and assert no
  `gh` call and no `fetch`, `push` or `worktree` argv was recorded.
- [ ] **4.2** `packages/minspec/src/commands/push-work-branch.ts` - `chooseWork` per
  design.md *Choose*, returning a terminal result or `{ selection, message }`.
  *Done when:* 4.1 is green.

## 5 - Push in a detached worktree, and the command end to end (FR-6, FR-7, FR-9; INV-2 to INV-6; AC-1, AC-3 to AC-6)

- [ ] **5.1** `packages/minspec/tests/push-work-branch.test.ts` - `pushWorkBranchCommand(folder,
  deps)` over a real temp repository whose `origin` is a local bare repository, real `git`
  through `defaultExecRun`, a `gh` stub recording argv (`auth status` succeeds, `pr create`
  prints a URL), and vscode mocked to pick and confirm:
  - AC-1, INV-2: with the primary on `main` and five dirty files (staged, unstaged,
    untracked), the primary's `rev-parse HEAD`, `status --porcelain`, `ls-files -s` and file
    bytes are identical before and after; `git branch --list` in the primary gains nothing.
  - AC-3, INV-3: picking two of the five, the pushed commit's `show --name-only` lists
    exactly those two; a picked deletion arrives as a deletion; a picked symlink arrives as
    a symlink.
  - AC-4, INV-4: the recorded `gh pr create` argv carries no `--label`, and no recorded
    call contains `merge` or `--auto`; the PR `--base` is the default branch and `--head`
    matches `^work/[a-z0-9-]{1,40}-[0-9a-f]{7,}$`.
  - AC-6, INV-6: a `pre-commit` hook that exits 1 gives `failed` with the hook's stderr, and
    afterwards `git worktree list --porcelain` names only the primary and the temp
    directory does not exist; with `worktree remove` stubbed to fail, the result carries
    `cleanupError` and the toast names the path.
  - FR-9, AC-5: `gh` ENOENT, `gh auth status` failing with and without a network message,
    `fetch` failing offline, the bare origin refusing the push (a `pre-receive` hook that
    exits 1) as `push-rejected`, `pr create` failing as `pr-refused`, and a selection equal
    to the base as `no-delta`; for each, one distinct outcome, one toast, and
    `await expect(pushWorkBranchCommand(...)).resolves` (no rejection escapes), including
    when the vscode mock itself throws.
- [ ] **5.2** `packages/minspec/src/commands/push-work-branch.ts` - `pushSelection` per
  design.md *Push* steps 1-10, and `pushWorkBranchCommand(folderArg?, deps?)` composing
  `resolveTargetFolder`, `gatherWork`, `chooseWork`, `pushSelection` and `surface` inside
  one outer `try`/`catch` (INV-5). `deps` is `{ run?: ExecRun; selfSessionId?: string }`.
  *Done when:* 5.1 is green.

## 6 - Register the command and its keybinding (FR-1)

- [ ] **6.1** Tests that already exist and must be updated before the change, each run red
  first: `packages/minspec/tests/commands-opt-in-invariant.test.ts` (a `no-marker-write`
  row for `minspec.pushWorkBranch`: "Works in a git worktree under the OS temp
  directory."); `packages/minspec/tests/opt-in-writer-inventory.test.ts` (rows for each
  filesystem writer it reports inside `pushWorkBranchCommand`). In
  `push-work-branch.test.ts`, a manifest case: `package.json` contributes
  `minspec.pushWorkBranch` titled `MinSpec: Push work via branch` and a keybinding
  `ctrl+k ctrl+b` / `mac: cmd+k cmd+b` with `when: workspaceFolderCount != 0`, and no other
  MinSpec keybinding uses that chord.
- [ ] **6.2** `packages/minspec/package.json` (command and keybinding beside
  `minspec.pushDocsLane`), `packages/minspec/src/extension.ts`
  (`registerCommand('minspec.pushWorkBranch', (folderArg?: string) =>
  pushWorkBranchCommand(folderArg, { selfSessionId: presence.sessionId }))`),
  `packages/minspec/README.md` (the network-actions row naming `gh auth status`,
  `git fetch`, `git push`, `gh pr create`; the shortcut row `Ctrl+K Ctrl+B` (`Cmd+K Cmd+B`
  on macOS); the commands row). Keybinding choice and the shadowed default: design.md
  *Keybinding*; state both in the pull request body.
  *Done when:* 6.1 is green, `readme-manifest-parity.test.ts`,
  `command-reference-gate.test.ts` and `manifest-no-internal-ids.test.ts` are green, and
  `npm run package` in `packages/minspec` builds the .vsix.
