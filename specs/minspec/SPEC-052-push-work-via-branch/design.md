---
id: SPEC-052
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-052 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-009  # Team Readiness
relates_to: [SPEC-039, SPEC-026, SPEC-050, DR-051, DR-065, "#1316", "#1370", "#1162", "#809"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-052 - Design: "Push work via branch"

Plan for [requirements.md](requirements.md). Citations of "today" are against `origin/main`
`8e0ef20d`, the commit this plan was written on. New code is named by symbol, because its
line numbers will move.

## Decisions taken

requirements.md is hash-locked by its approval (2026-08-07) and is not edited to record
these; this section is the record. OQ-1 to OQ-4 were settled at Clarify and are restated
only where the design depends on them.

| Question | Answer | Source |
|---|---|---|
| OQ-1 off the default branch | Command stays available; the confirmation names the branch and says a plain commit is the cheaper route (FR-11) | requirements, Resolved Questions |
| OQ-2 persist the selection | No. Every run opens an all-deselected picker; only ordering and highlighting are recomputed | requirements, Resolved Questions |
| OQ-3 presence dependency | Ship without it. Presence data only ever de-highlights; its absence produces the plain `origin/main` view | requirements, Resolved Questions |
| OQ-4 the boundary DR | Drafted by task 1 as `status: proposed`; its content is *The two sanctioned routes* below. No code task waits on its acceptance, because the requirements give the DR the precedent, not the command | requirements, Resolved Questions; #1370 |
| FR-1 keybinding | **`Ctrl+K Ctrl+B` / `Cmd+K Cmd+B`, kept.** See *Keybinding* below: the check Clarify asked Plan to run found a conflict on both the proposed chord and its fallback, and the fallback's is the worse one | this plan, from VS Code source; recorded so a reviewer can overrule it in one line of `package.json` |
| FR-8 what "clean up" runs | It hands off to the existing **MinSpec: Tidy primary checkout** (`minspec.tidyPrimary`, #1162) and never discards anything itself | this plan; see *Cleanup after merge* |

### Keybinding

Clarified FR-1 asks Plan to check `Ctrl+K Ctrl+B` against VS Code's defaults and fall back
to `Ctrl+K Ctrl+W` on a conflict. Checked on 2026-10-29 against VS Code's own sources:

- `Ctrl+K Ctrl+B` is **Set Selection Anchor**: `KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK,
  KeyMod.CtrlCmd | KeyCode.KeyB)`, `when: editorTextFocus`, weight `EditorContrib`, in
  `src/vs/editor/contrib/anchorSelect/browser/anchorSelect.ts` (microsoft/vscode `main`).
- `Ctrl+K Ctrl+W` is **Close All Editors** (`workbench.action.closeAllEditors`), listed in
  the default-keybindings example of `docs/configure/keybindings.md` (microsoft/vscode-docs
  `main`), with no `when` clause.

An extension's contributed keybinding outranks a built-in one on the same chord, so either
choice shadows a default. Set Selection Anchor is a rarely used selection helper that still
works from the Command Palette; Close All Editors is a common window-management chord that
users reach for by muscle memory. Applying the fallback literally would trade a small
conflict for a large one, which is the opposite of what the Clarify check was for, so this
plan keeps the proposed chord. Rejected: `Ctrl+K Ctrl+W` (the larger shadow above); a third,
unlisted chord (no requirement names one and it would need its own conflict search); a
`!editorTextFocus` guard (the command would then not fire from the editor, where the user
is when a commit is refused). The chord is one `package.json` entry, so overruling this
costs one line.

## Approach in one paragraph

One new module, `packages/minspec/src/commands/push-work-branch.ts`, built as the
general-case sibling of `push-docs-lane.ts` and sharing its seams rather than copying them:
the bounded runner (`defaultExecRun`, `ExecRun`), the error classifiers and the single
`gh pr create` path (`openPullRequest`) from `lib/approval-pr.ts`, the corpus predicate
from `lib/docs-corpus.ts`, and the live-session reader from `lib/presence.ts`. The command
runs in three phases with a hard line between them. **Gather** is local only: probes, then
every changed path with its status and whether its bytes already equal the base branch's
copy. **Choose** is UI only: the picker, the docs-lane redirect, the consent dialog and the
message prompt. **Push** starts only after consent: `gh auth status`, `git fetch`, a
detached temporary worktree off `origin/<default>`, a copy of exactly the selected paths, one
commit, a push to a new remote branch, and a plain pull request with no labels. The primary
checkout is only ever read, plus `fetch` and `worktree add`/`remove`. Every exit, success or
not, is one typed result folded into one toast.

## The two sanctioned routes (content for the OQ-4 decision record)

Task 1 writes this as the DR. It records a boundary, not this command's design.

| | DR-065 presence-gated fast-forward | This spec: push work via branch |
|---|---|---|
| Moves | **Committed** work: the shared checkout's HEAD fast-forwards to its upstream | **Never-committable** work: dirty files a guard refused to commit where they sit |
| Touches the shared checkout's HEAD or index | Yes, which is why it is presence-gated (an occupied checkout is never moved) | Never (INV-2); the copy is committed in a separate worktree |
| Consent | The presence gate decides; no per-file choice | The human picks every file (FR-3) and confirms (FR-5) |
| Lands via | The upstream already has the commits | A normal pull request with the ordinary required checks |

Why two routes rather than one: committed work already has an identity (a commit) that
can be moved by ref; uncommitted work has none, and giving it one in the shared checkout
is exactly what the two guards forbid. Neither route may move the shared checkout's HEAD
without the presence gate. After this command's pull request merges, the copied files go
clean through the first route or through **Tidy primary checkout**, never through this
command (*Cleanup after merge*).

## Gather (local only - INV-1)

Probes, in order, each failure a typed outcome:

1. `git rev-parse --is-inside-work-tree` - else `not-a-repo`.
2. `git symbolic-ref -q HEAD` - empty or failed is `detached-head`. The current branch name
   is kept for FR-11.
3. `git rev-parse --show-toplevel` - the root every path is relative to (the same #1715
   lesson `tidy-primary.ts` documents: a workspace folder may be a subfolder).
4. `git remote get-url origin` - else `no-origin`; `slugFromOriginUrl` for `--repo`.
5. The default branch: `git symbolic-ref --short refs/remotes/origin/HEAD`, stripping
   `origin/`; on failure, `main`. The base ref is `origin/<default>`. If
   `git rev-parse --verify -q <base>` fails, the run continues with no highlighting
   (every path is shown unmarked) and the confirmation says the base is unknown until
   the consented fetch; the worktree step after the fetch then decides.
6. `git -c core.quotePath=false status --porcelain=v1 -z --untracked-files=all --no-renames`.
   - `-z`: NUL-separated, so no quoting or ` -> ` parsing, and nothing is ever trimmed
     from the two-column status (column 1 is often a space).
   - `--untracked-files=all`: an untracked directory is listed file by file. Without it
     porcelain reports `?? dir/` and a copy would carry the whole directory (INV-3).
   - `--no-renames`: a rename arrives as a deletion plus an addition, so both halves can be
     chosen and both travel; the default would hide the old path.
   Each entry becomes a `WorkCandidate { path, status, kind }` where `kind` is `deleted`
   (`' D'` or `'D '`), `present`, or `unsupported`. `unsupported` is a path that is a
   directory on disk after `-uall` (a submodule or nested repository): it is shown in the
   picker title count, never offered, because copying it would be a directory copy.
   Empty list: `nothing-changed`.
7. Base equality, batched, for every `present` and `deleted` candidate when the base ref
   resolved: `git ls-tree -z <base> -- <paths>` gives each path's blob on the base, and
   `git hash-object -- <present paths>` gives the working copy's (arguments, not
   `--stdin-paths`: `ExecRun` has no stdin). Equal blobs, or a deletion
   of a path the base does not have, mark the candidate `sameAsBase`. This is the same
   REDUNDANT rule `lib/tidy-primary.ts` applies, computed through the injected runner so
   it is testable and works off the default branch too. Paths go as arguments after `--`,
   and the runner sets `GIT_LITERAL_PATHSPECS=1`, so a `[` or `*` in a name never matches a
   sibling (INV-3).
8. Presence: `contendingLiveSessions(root, root, paths, selfSessionId)` from
   `lib/presence.ts`, wrapped so a throw or an unreadable record dir means "no presence
   data", never "claimed". The result is the set of paths another live session lists.
   `presenceAvailable` is true only when `readAllRecords(root)` returned at least one
   parseable record.

## Choose (UI only - FR-3, FR-4, FR-5, FR-10, FR-11)

**Picker.** `vscode.window.showQuickPick(items, { canPickMany: true, ignoreFocusOut: true })`
where every item has `picked: false`, unconditionally (FR-3, AC-8): the item list is built
fresh from Gather on every invocation and no module-level or `workspaceState` value holds a
previous selection. Ordering and marking (FR-4, AC-9), computed by a pure
`buildPickItems(candidates, claimed, presenceAvailable)`:

- First, paths that differ from the base and are not claimed: icon `$(arrow-up)`,
  description `differs from origin/<default>`.
- Then claimed paths, only when `presenceAvailable`: description `listed by another live
  session`. That is the whole claim it makes; no "yours" or "theirs".
- Then `sameAsBase` paths: description `same as origin/<default> - nothing to push`.
- Then, with no base ref, every path unmarked in status order.

Within a group, paths sort by repository path. `unsupported` paths are not items; the
picker title reads `Choose files to push (N not offered: submodule or nested repository)`
when N > 0. Escape is `cancelled`; an empty pick is `nothing-selected`.

**Docs redirect (FR-10, AC-7).** When `isDocsCorpusPath` holds for every selected path, a
modal asks: "These are all documentation files. Push docs via lane auto-merges once green;
this command opens a normal pull request that waits for review." Buttons **Use docs lane**
and **Open a normal PR**; dismiss is `cancelled`. **Use docs lane** runs
`vscode.commands.executeCommand('minspec.pushDocsLane')` and returns `redirected`; the
modal's detail line says the docs lane gathers all changed docs and lists them in its own
confirmation, because that command takes no selection and this spec does not edit it. It
never switches silently.

**Consent (FR-5, FR-11, INV-1).** A modal warning, the last step before any network call:
title `MinSpec: push N file(s) to a new branch and open a pull request?`; detail lists every
selected path, the branch name pattern `work/<slug>-<sha>` (the sha is the new commit's,
known only after the commit), the base `origin/<default>`, and the sentence "This pushes
to origin and opens a pull request on GitHub (network actions). Your working tree is left
as it is." When the current branch is not the default branch, a first line reads "You are
on '<branch>', not <default>: committing here directly is the cheaper route." Button
**Push and open PR**; anything else is `cancelled`.

**Message.** `showInputBox` pre-filled with `defaultCommitMessage(selection)`:
`chore: update <file>` for one path, `chore: update <n> files in <dir>` when all share a
directory, else `chore: update <n> files`. Escape is `cancelled`; blank uses the default.

## Push (after consent - FR-6, FR-7, INV-2 to INV-4, INV-6)

1. `gh auth status` - ENOENT `gh-absent`, network message `offline`, otherwise
   `gh-unauthenticated`. Before any git write, so nothing needs undoing.
2. `git fetch origin <default>` - `offline` or `failed`.
3. `mkdtempSync(os.tmpdir()/minspec-work-branch-)`; `git worktree add -q --detach <wt>
   origin/<default>`. **Detached**, so no local branch is created in the shared repository:
   a left-over local branch would make the next run's `-b` fail, and deleting one is not
   on INV-2's permitted list.
4. Copy each selected `present` path from the primary into the worktree, creating parent
   directories inside the worktree only. A symlink (`lstatSync`) is recreated with
   `symlinkSync(readlinkSync(src))`, never followed. Each `deleted` path is
   `git rm -q --ignore-unmatch -- <paths>` in the worktree.
5. `git add -- <present paths>` in the worktree: exact paths, never `-A`.
6. `git diff --cached --quiet` succeeds means nothing differs from the base: `no-delta`.
7. `git commit -m <message>` in the worktree with `DR_INDEX_GATE_OFF=1`, for the reason
   `push-docs-lane.ts` documents at its commit step (the throwaway worktree has no
   `node_modules`; CI re-runs the skipped step and requires it). Every other hook runs; a
   rejection is `failed` carrying the hook's stderr.
8. Branch `work/<slug>-<sha7>`: `slug` is `slugify(subject)` (lowercase ASCII letters,
   digits and `-`, runs collapsed, at most 40 characters, `changes` when empty) and `sha7`
   the new commit's short sha, so two runs never collide. `git push -q origin
   HEAD:refs/heads/<branch>`, never `--force`. A non-fast-forward or `rejected` stderr is
   `push-rejected`; a network message is `offline`; else `failed`.
9. `openPullRequest({ run, cwd: wt, slug, base: <default>, head: <branch>, title, body,
   labels: [] })` with `splitCommitMessage(message)` for title and body. No
   `adoptExisting`, no `provisionLaneLabel`, and no `gh pr merge` anywhere in the module
   (INV-4). The body ends with the selected file list and "Opened by MinSpec: Push work via
   branch. Not a docs-lane PR: it waits for the ordinary required checks." `created` is
   `pushed`; `failed` is `pr-refused` (FR-9 "PR creation refused") with gh's stderr; the
   other outcomes map one to one.
10. `finally`: `git worktree remove --force <wt>` from the root, then `rmSync(tmpBase)`.
    Unlike `push-docs-lane.ts`, a failure here is **not** swallowed (INV-6): it is recorded
    as `cleanupError` on the result, and the toast adds "The temporary worktree at <path>
    could not be removed: <first stderr line>." The primary checkout is never restored,
    reset, stashed or unstaged (FR-7).

## Result and toasts (FR-9, INV-5)

```ts
export type PushWorkOutcome =
  | 'pushed' | 'no-folder' | 'not-a-repo' | 'detached-head' | 'no-origin'
  | 'nothing-changed' | 'nothing-selected' | 'cancelled' | 'redirected' | 'no-delta'
  | 'gh-absent' | 'gh-unauthenticated' | 'offline' | 'push-rejected' | 'pr-refused'
  | 'failed';

export interface PushWorkResult {
  readonly outcome: PushWorkOutcome;
  readonly prUrl?: string;
  readonly branch?: string;
  readonly files?: readonly string[];
  readonly error?: string;
  readonly cleanupError?: string;
  /** Paths whose bytes equal the base, counted at Gather; drives the FR-8 offer. */
  readonly landedCount?: number;
  /** HEAD was on the default branch at Gather (Tidy only works there). */
  readonly onDefaultBranch?: boolean;
}
```

The outer body is one `try`/`catch` whose catch returns `failed` (INV-5); every step's own
`try` maps to a specific outcome first. `surface(result)` is the only function that shows a
message. `pushed` shows the PR URL with **Open PR**; `cancelled`, `no-folder` and
`redirected` are silent (the user acted, or another command speaks); each other outcome has
its own sentence, so AC-5's "distinct typed outcome and a toast" is one table test.

## Cleanup after merge (FR-8)

The command never deletes, restores or resets a file in the primary checkout. When a run
ends `nothing-changed`, `nothing-selected`, `no-delta` or `pushed` with `landedCount > 0`
and `onDefaultBranch`, its toast carries a second button, **Tidy landed files…**, which runs
`minspec.tidyPrimary`. That command already lists the exact paths, asks for confirmation,
refuses while another live session shares the checkout, and discards only paths
byte-identical to `origin/<default>`. The offer is per toast and never remembered. Off the
default branch the button is not shown, because Tidy declines there. Base equality is
against the local `origin/<default>` ref, which the user's own fetch (or this command's
consented one) updates; MinSpec never fetches to make the offer.

## What changes outside the owned module

`implements:` owns the command and its test. Registering a command needs these existing
files; each change is the same shape as `minspec.pushDocsLane`'s entry:

- `packages/minspec/package.json`: the command (`MinSpec: Push work via branch`) and the
  keybinding (`ctrl+k ctrl+b`, `mac: cmd+k cmd+b`, `when: workspaceFolderCount != 0`).
- `packages/minspec/src/extension.ts`: `registerCommand('minspec.pushWorkBranch', ...)`
  passing `presence.sessionId` for the self-exclusion in Gather step 8.
- `packages/minspec/README.md`: the network-actions table, the shortcuts table and the
  commands table (`tests/readme-manifest-parity.test.ts` fails without them).
- `packages/minspec/tests/commands-opt-in-invariant.test.ts`: a `no-marker-write`
  classification row.
- `packages/minspec/tests/opt-in-writer-inventory.test.ts`: one row per filesystem writer
  that test reports inside `pushWorkBranchCommand` (at least `mkdtempSync` and
  `mkdirSync`, as for `pushDocsLaneCommand`).

## Testing approach

- **Unit, pure:** status parsing, `buildPickItems`, `slugify`, `defaultCommitMessage`, the
  docs-redirect predicate and `surface` (vscode mocked, as in `push-docs-lane.test.ts`).
- **Choose and consent:** vscode mocked, runner a recording stub; every command the stub
  saw before the consent button is asserted to be in a local-only allowlist
  (`rev-parse`, `symbolic-ref`, `remote get-url`, `status`, `ls-tree`, `hash-object`), so
  AC-2 is an assertion on argv, not an observation.
- **Push, end to end:** a real temp repository with a bare repository as `origin`
  (a file path, no network), real `git` through `defaultExecRun`, and `gh` replaced by a
  stub that records argv and returns a URL. AC-1 compares the primary's `rev-parse HEAD`,
  `git status --porcelain` and index (`git ls-files -s`) before and after; AC-3 and INV-3
  read the pushed commit's `git show --name-only`; AC-6 injects a hook that rejects the
  commit and then asserts `git worktree list --porcelain` names only the primary and the
  temp directory is gone.
- No test opens a network connection; the opt-in invariant tests stay green.
