---
id: SPEC-140
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination; the epic DR-065 (shared-checkout moves) belongs to
aspects: [approval, git-sync, shared-checkout, presence, consent, offline, fast-forward, no-silent-gate, blast-radius]
depends_on: [DR-065, SPEC-026, SPEC-050]  # DR-065 Amendment B (this spec's gate) must be accepted before build; FR-19 to FR-21 also need the DR-065 amendment issue 2992 asks for; SPEC-026 the presence records the gate reads; SPEC-050 owns the approval push whose success starts a follow
relates_to: [SPEC-022, SPEC-135, SPEC-060, SPEC-095, DR-051, DR-004, DR-086, "#1167", "#1163", "#1354", "#2021", "#2626", "#2628", "#2843", "#512", "#168", "#2974", "#2990", "#2992"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). The two NEW
# files are owned here: the follow pass (gate, staging, fast-forward, index restore) and
# its tests on real git fixtures. Modified, not owned: commit-on-approve.ts (SPEC-050's
# seam) gains one call that records what an approval push wrote; presence.ts (SPEC-026)
# gains a reader that excludes this window's own record; package.json gains the setting
# and the palette command. Amendment 2026-10-21 (issue 2974, pre-merge window): the one
# pending-approval record and its reader are owned here (approval-inflight.ts); the
# settle step lands in SPEC-050's recovery module, and the approval store, decision list
# and spec catalog gain the overlay read, all modified, not owned.
implements: [packages/minspec/src/lib/approval-follow.ts, packages/minspec/tests/approval-follow.test.ts, packages/minspec/src/lib/approval-inflight.ts, packages/minspec/tests/approval-inflight.test.ts]
affects: [packages/minspec/src/commands/commit-on-approve.ts, packages/minspec/src/lib/presence.ts, packages/minspec/package.json, packages/minspec/src/lib/approval-recover.ts, packages/minspec/src/lib/approval-store.ts, packages/minspec/src/lib/approval.ts, packages/minspec/src/lib/adr-manager.ts, packages/minspec/src/lib/spec-catalog.ts]
phases:
  specify: done
  clarify: done
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-140: After an approval's pull request merges, the editor moves its own checkout forward to main

## In plain terms

When you approve something with Alt+A in your MinSpecPro checkout, the extension pushes the
approval from a throwaway worktree, but the approved files stay in your checkout as
uncommitted copies. Nothing ever clears them, so you cannot pull, and the background drain
cannot move the checkout either.

With this spec, once main carries the exact bytes of your approval, MinSpec in your editor
moves your checkout to main by itself. It marks those files as matching main, then
fast-forwards. No file is deleted or rewritten, so the spec shows approved the whole time
and the copies end up clean. You say yes once (a setting, asked the first time) and it never
asks again.

Before that, as soon as the approval's pull request is open, the extension also takes back
the copies it left in your checkout, but only those whose bytes are exactly what it pushed.
A small record inside the `.git` folder keeps the item reading approved (or accepted) in
the editor until your checkout carries the approval itself. So your checkout is clean
while the pull request waits, not just after it merges. (Amended 2026-10-21, issue 2974:
primary left dirty after an approval.)

It refuses, names the file, and changes nothing if any other live session claims the
checkout, if you have local commits, or if any leftover differs from main by even one byte.
If it cannot read the session records clearly, it does not move.

This spec needs your acceptance of DR-065 Amendment B (the extension may move its own
checkout). Approving this spec does not accept that amendment; it is its own act.

## Context

**How the leftovers are made.** On a protected `main` the approval commit is refused, and
recovery copies the written files into a throwaway worktree and pushes from there
(`packages/minspec/src/commands/commit-on-approve.ts:214-252`,
`packages/minspec/src/lib/approval-recover.ts:14-25`). The checkout keeps its working-tree
copies. The comment that says a later `git pull --rebase` drops them "by patch-id"
(`packages/minspec/src/lib/approve-push.ts:20-26`) describes the older commit-on-main path;
under recovery no local commit exists, so nothing drops them. The same seam serves Approve
Spec, Accept ADR and Accept Epic (`commands/approve.ts`, `commands/adr.ts`,
`commands/epic.ts` all route through `commit-on-approve.ts`). Accept Epic writes no
approval sidecar, so it is out of this spec's scope (see Limitations).

**Why nothing clears them.** The drain's G2 (content-clean) skips any dirty checkout, and
its G3 (presence) skips any occupied one (DR-065 section 2). Your editor writes a live
presence record for the folder it has open (`packages/minspec/src/extension.ts:114-126`),
and any live record for the same checkout reads as occupied, with no exception for the
caller (`packages/minspec/src/lib/presence.ts:381-407`). So while your window is open the
drain can never move your checkout, whatever happens to G2. Measured 2026-10-17: the
primary's `.minspec/sessions/` held exactly one record.

**The cost, measured.** Issue 1167 (G2 deadlock) records the shape five times: 7 of 8 dirty
paths byte-identical to `origin/main` on 2026-07-31; DR-078 and `INDEX.md` after an Accept
ADR run; dispatch refusing on a 7-behind primary on 2026-08-19; 10 dirty paths, all
Alt+A leftovers, on 2026-10-01 ("couldn't pull git"). Today each approval costs one
hand-run clean-up command.

**What the issue's comments proposed, and where each lands.**

- *Fix the source* (issue body option 2, the 2026-08-05 comment, and the 2026-10-01
  "producer-side" fix: return the working tree to `HEAD` for exactly the paths written).
  This is the option the founder declined as `revert` in queue item d1167: the spec would
  read unapproved in the editor until a manual pull, which is the 2026-10-09 confusion.
  **Taken after all, by the 2026-10-21 amendment, because that reason no longer holds.**
  The decline was about what the editor shows, not about the files: restoring them made
  the approval disappear from view. The amendment keeps the approval in view without the
  files (drafted in PR 2990, in-flight approval record, open and held until this
  amendment is approved): before restoring anything the extension writes the pending-approval
  record (FR-4), and the approval panel, the decision list and the spec list read that
  record (FR-20) until the checkout's `HEAD` carries the approval. So the item reads
  approved while the checkout is clean. What is restored is also narrower than the
  declined form: only a path whose working bytes equal the blob just pushed, only once the
  pull request is open, and never the index or `HEAD` (FR-19). Issue 1163 (Accept ADR lands
  its own output) stays open on its own terms.
- *The sync path clears residue already on origin* (issue body option 1, the 2026-10-01
  "sync-side" fix, and the 2026-08-30 DR-065 amendment). Taken in a narrower form: the
  actor is the editor, not the drain, because the drain cannot pass G3 while the window is
  open; and residue is staged, never discarded, using the technique SPEC-135
  (self-installing build) FR-21 and FR-22 already specify
  (`specs/minspec/SPEC-135-self-installing-build/requirements.md:376-394`). The 2026-08-30
  discard amendment is withdrawn in the same change as this spec.
- *The 2026-10-01 note that bytes may be "on main, or the approval branch".* Taken by
  the 2026-10-21 amendment: once the approval's pull request is open, FR-19 retires every
  leftover proven equal to the approval branch's blob; once main carries the approval, the
  follow pass (FR-5 to FR-14) moves the checkout. Leftovers FR-19 cannot prove stay until
  the merge; see Limitations.
- *Surface, do not act* (issue body option 3). Kept as the refusal path: every refusal names
  the file and the reason.

**Verified on a real git fixture, 2026-10-17** (a scratch repository, not this one).
Leftovers byte-identical to the target, one of them untracked: a plain
`git merge --ff-only` refuses ("Your local changes ... would be overwritten"). After staging
each path with `git update-index --add --cacheinfo <mode>,<target blob>,<path>`, the same
fast-forward lands and `git status --porcelain` is empty. With one leftover differing, git
refuses the fast-forward but leaves the identical path staged, which is why FR-11 restores
the index and FR-8 checks every path before staging any.

## Terms

- **The checkout**: the working tree of the workspace folder this editor window's presence
  record names (`extension.ts:107-127`, the activation-time root). In a window with several
  folders open, the other folders are not the checkout (OQ-4).
- **This window**: the extension instance whose SPEC-026 presence record carries its own
  `sessionId` (`presence.ts:515`).
- **The default branch**: the base branch a pending approval records (FR-4), which is the
  branch the approval's recovery pushed against (OQ-1).
- **The target**: the commit `origin/<default branch>` points at after this pass's fetch,
  pinned by its object id for the rest of the pass.
- **A leftover**: any path `git status --porcelain --untracked-files=all` reports: modified,
  staged, deleted, or untracked and not ignored.
- **A pending approval**: the one record FR-4 keeps for one successful approval push. It
  serves both the pre-merge overlay (FR-20) and the follow pass (FR-6); there is no second
  record for the same state.
- **The approval landed**: the checkout's `HEAD` holds the approval's sidecar with the
  same `specHash` the record carries. `specHash` is the hash field of the approval
  sidecar that Approve Spec (`lib/approval.ts:597`) and Accept ADR (`commands/adr.ts:289`)
  write under the same name, so this test and FR-6's trigger read the same field for both.
  Accept Epic (`commands/epic.ts:17-52`) writes no sidecar and no `specHash`; it flips the
  epic's status and commits the epic file and its index, so "the approval landed" is not
  defined for it and epics are out of scope (Limitations).

## Requirements

### A. One consent, asked once

- **FR-1 - The setting.** A setting `minspec.followMergedApprovals` with values `ask`
  (default), `on` and `off`. `on` is the consent for FR-5's fetch and FR-10's move; `off`
  means no follow pass ever runs; `ask` means none runs until answered. The setting is
  declared with `application` scope, so only the user's own settings can hold it and no
  file committed to a repository can turn it on (OQ-2).
- **FR-2 - Asked once.** The first time an approval push succeeds through the
  protected-branch recovery path (the only path that leaves copies in the checkout, OQ-3)
  while the setting is `ask`, the extension shows one non-modal notification that does not take focus. It says,
  in plain words, what will happen from then on: while an approval is waiting to land, the
  extension fetches `origin`'s default branch; once main carries the approval's exact
  bytes, it moves this checkout forward to main by fast-forward; it never deletes, rewrites,
  commits or pushes anything, and it refuses and names the file whenever anything would be
  at risk. Two buttons, `Turn on` and `Not now`, plus a link to the setting. `Turn on`
  writes `on`, `Not now` writes `off`. Either answer is final and the question is never
  shown again; changing it later is a settings edit.
- **FR-3 - An unanswered question.** If the notification is dismissed without an answer the
  setting stays `ask`, nothing moves, and the question is shown again at most once per
  editor window, at the next successful approval push through that path. It is never shown
  on a timer.
- **FR-4 - Record what the push wrote.** After every successful approval push through
  the protected-branch recovery arm of `commit-on-approve.ts` (Approve Spec, Accept ADR),
  the extension records a pending approval: each written path with its
  object id and mode, the approval commit, the base branch the recovery pushed against,
  the branch it was pushed to, the sidecar's path and contents (its `specHash` among
  them, the hash FR-6 and FR-21 compare), and the time; plus, when
  FR-19 restores the approved document, the hash of the restored bytes and the pushed
  document's frontmatter. A push from the `committed` arm leaves no copies, so it records
  nothing (OQ-3). The record is one file per approved document in the checkout's own git
  directory (`git rev-parse --git-dir`, per worktree, not the shared common directory),
  named `minspec-inflight-<encoded document path>.json`. Being inside the git directory it
  is never a working-tree path, so recording it can never create a leftover, and being per
  worktree it names its checkout without storing a root. It is recorded whatever the
  setting says, so an answer of `on` given later still follows approvals made earlier in
  that checkout. This record replaces the one first drafted here in the editor's workspace
  storage; the approval store, the decision list and the spec catalog read it without the
  editor API, which workspace storage would not allow (FR-20). Its field list above is the
  requirement; the plan pins it as one typed contract that the writer and all three
  readers import, so the format has a single definition.

### B. When a pass runs

- **FR-5 - Fetch only while something is waiting.** With the setting `on` and at least one
  pending approval, the extension fetches `origin`'s default branch when the window gains
  focus and every five minutes, and at no other time. With no pending approval, or the
  setting not `on`, it makes no network call (constitution invariant 1). A fetch never moves
  `HEAD` and never touches the working tree or the index. It uses the user's own git and
  credentials; it never pushes.
- **FR-6 - The trigger.** A pass proceeds to the gate only when the target holds at
  least one pending approval's sidecar with the recorded `specHash`. The gate (C7) then
  checks every leftover byte for byte, so a path the target holds differently, such as a
  regenerated decision index, refuses there and is named. A pending approval that has
  already landed (the user pulled by hand) is cleared without a move (FR-21).
- **FR-7 - On demand.** A palette command, *MinSpec: Follow Main Now*, runs the same pass
  immediately with the same gate. It is reachable from the keyboard; if a keybinding is
  assigned it is shown with the command. Under `ask` it shows FR-2's question first; under
  `off` it says the setting is off and does nothing.

### C. The gate - every condition is checked before anything changes

- **FR-8 - All or nothing.** The pass MUST evaluate every condition in FR-9 against the
  pinned target before it changes the index. If any one fails, it changes nothing: no index
  entry, no working-tree file, no `HEAD`. It reports per FR-13.
- **FR-9 - The conditions.**

  | # | Condition | Fails when |
  |---|---|---|
  | C1 | The checkout is on its default branch | Another branch, or detached `HEAD`; or the pending approvals that triggered the pass record different base branches |
  | C2 | No local commits: `HEAD` is an ancestor of the target | `HEAD` is ahead of, or has diverged from, the target |
  | C3 | No operation in progress | A merge, rebase, cherry-pick, revert or bisect is in progress, or the index lock exists |
  | C4 | No live session other than this window claims the checkout | Any live SPEC-026 record whose `worktreeRoot` is this checkout and whose `sessionId` is not this window's |
  | C5 | The presence records are readable and unambiguous | Any record in any worktree's sessions directory is unreadable, corrupt or malformed; this window's own record is missing, stale, or carries a PID other than this extension host's; or two records carry this window's `sessionId` |
  | C6 | No other mover owns this checkout | The SPEC-135 consent record is present for this checkout (SPEC-135 FR-23, one mover) |
  | C7 | Every leftover is byte-identical to the target | Any leftover whose working-tree bytes differ from the target's blob by one byte, whose mode differs, which is absent from the target, or which the target holds and the working tree lacks |
  | C8 | The comparison is exact | Any leftover that is not a regular file or symlink (a submodule, a directory entry), or that has a clean, smudge, text or end-of-line conversion configured, so raw bytes and blob bytes need not agree (SPEC-095) |
  | C9 | Staged state agrees | Any index entry for a leftover that differs from both `HEAD` and the target |

  C4 and C5 keep DR-065 section 1's fail direction: any doubt about who is in the tree
  means no move. C5 also covers DR-065's condition (a), "presence is demonstrably running":
  this window's own live record is that demonstration.
- **FR-10 - No other operation.** The only operations a pass may perform on the checkout
  are: fetch (FR-5); staging, by object id, each leftover C7 verified, and only those; and
  `git merge --ff-only <target object id>`. It MUST NOT stash or autostash, rebase, reset
  `HEAD`, check out or restore a working-tree path, clean, delete a file, commit, push, or
  create a merge commit. Staging uses the verified object ids, never a fresh read of the
  working tree, so a change that races in after the check is never staged and git's own
  fast-forward refusal protects it.

### D. The move

- **FR-11 - Restore the index if the move does not happen.** If the fast-forward does not
  complete, the pass MUST return every index entry it changed to its exact prior state
  (removing from the index, never from disk, any entry it added for an untracked path),
  leave the working tree as found, and report per FR-13 with git's own message.
- **FR-12 - After the move.** After a completed fast-forward the pass checks that `HEAD`
  equals the target and that no leftover it staged is still reported by `git status`. It
  clears every pending approval that has now landed (FR-21). Because no working-tree byte changes,
  an approved spec's hash matches throughout and its derived status reads approved before,
  during and after the move.

### E. Nothing fails quietly

- **FR-13 - Every refusal is named.** A refusal names the failed condition and every path
  or record it concerns, in plain words, for example "Not moved: `docs/decisions/INDEX.md`
  differs from main". It is written to the MinSpec output channel on every pass, and shown
  as a non-modal notification once per distinct set of condition and paths, not on every
  pass, so a standing refusal is visible without nagging.
- **FR-14 - Every move is reported.** A completed move shows one non-modal message naming
  the new commit and how many leftovers ended clean, and writes the same line to the output
  channel.
- **FR-15 - A pending approval that cannot land is visible.** A pending approval older than
  seven days that main still does not carry, or one FR-21 finds dead, is reported once (it
  may have been closed unmerged or changed in review), with *MinSpec: Follow Main Now* and
  the setting named. It is kept, not cleared, so nothing is dropped silently; with its
  branch deleted it may be the only remaining copy of the approval.

### F. Boundaries

- **FR-16 - Blast radius.** No pass, record, fetch or notification happens in a folder
  without `.minspec/` at its root (constitution invariant 3).
- **FR-17 - The drain is unchanged.** `sync_shared_checkouts` and DR-065's guards G1 to G4
  are untouched by this spec. A checkout the drain cannot move stays unmovable by the
  drain.
- **FR-18 - Only this window's checkout.** A pass acts only on the checkout this window's
  presence record names. It never moves another worktree or another repository. A pending
  approval belongs to the checkout whose git directory holds its file (FR-4), so the
  record needs no stored root: the pass reads only the presence-named checkout's own git
  directory. In a window with several folders open, a pending approval found in the git
  directory of another open folder is never followed by this window; it is reported once,
  naming the folder, through the same output channel and once-per-distinct-set
  notification FR-13 uses for a refusal (OQ-4). A worktree not open in the window is never
  read, so its records are neither followed nor reported. The overlay (FR-20) is per folder
  in the same way: each open folder's readers see only the records in that folder's git
  directory.

### G. Before the merge (amendment 2026-10-21, issue 2974)

FR-19 rewrites working-tree files in the shared checkout, which DR-065 Amendment B does not
authorise (`docs/decisions/DR-065.md:251`, `:289-290`) and which the withdrawn 2026-08-30
amendment shows needs its own sanction under DR-065 section 5 (scope of the exception).
FR-19 to FR-21 are therefore not built until a DR-065 amendment sanctioning exactly
FR-19's retire step and bounds is accepted (issue 2992). FR-1 to FR-18 keep Amendment B as
their gate.

- **FR-19 - Retire proven copies once the pull request is open.** After FR-4's record is
  written and the approval's pull request is open (created or adopted), the extension
  restores each transported path in the checkout's working tree from the index, or
  removes a sidecar that is new to the branch, only when all of these hold for that path,
  checked immediately before it is touched: its working bytes (`git hash-object`) equal
  the blob in the approval commit; its index entry equals `HEAD`'s; and, for the approved
  document, it is on `HEAD` and differs from `HEAD` only in lifecycle (frontmatter
  `status:` and `phases:`, and the body's status word, compared in the approval hash's
  canonical form). The sidecar goes first: if it cannot be proven or retired, nothing is
  touched and the record is removed, so the approval is never recorded nowhere. An
  untracked document is never removed. The step never changes the index or `HEAD`, makes
  no network call, and runs whatever FR-1's setting says, because it only takes back the
  extension's own output and only where the remote already holds the same bytes. Every
  path it keeps is named with its reason, in the approval's completion message and the
  output channel. With no pull request open, nothing is retired: the dirty files are the
  visible prompt to open one.
- **FR-20 - The record keeps the item reading as approved.** While a pending approval is
  live, the approval panel, the decision list and the spec list read its sidecar in place
  of the restored working-tree one, so the item reads approved or accepted exactly as it
  did before FR-19 ran. The lifecycle part (`status`, `phases`) is overlaid only while the
  document's bytes still hash to the recorded restored hash; an edit by the founder ends
  the overlay for that document, so it never covers real work. A pending approval is
  live while the remote-tracking ref of its branch exists, or `origin/<base>` already
  carries its sidecar; reading this is local and offline. Any git error reads as not live,
  which shows what the checkout's own files say.
- **FR-21 - When the record ends.** A pending approval is cleared (its file deleted) when
  the approval has landed; this is the only clear. It is dead, but kept, when its branch's
  remote-tracking ref is gone and `origin/<base>` does not carry its sidecar (a pull
  request closed unmerged, seen after a pruning fetch); a dead record is ignored by FR-20,
  so the item reads as main says, and is reported per FR-15. FR-5's fetch, when it runs,
  also updates the remote-tracking refs of every pending approval's branch, removing those
  deleted on origin, so a closed pull request is seen without a manual fetch.

## Acceptance criteria

All on real git fixtures (a bare origin and a clone), not stubbed git.

- **AC-1** With the setting `ask`, a successful approval push through the protected-branch
  recovery arm shows FR-2's question once; answering either way never shows it again in
  that workspace, including after a reload. A successful push through the `committed` arm
  shows no question and records no pending approval (OQ-3).
- **AC-2** With the setting `off` or `ask`, or with no pending approval, a pass makes no
  network call (asserted by a git stub that fails the test on `fetch`).
- **AC-3** Leftovers from one approval, one tracked-modified and one untracked sidecar, both
  byte-identical to the target: the pass moves `HEAD` to the target, `git status
  --porcelain` is empty, and every leftover file's bytes and mtime are unchanged by the
  pass.
- **AC-4** The same, with one leftover differing by a single byte: no index entry, file or
  `HEAD` changes (index file hash identical before and after), and the refusal names that
  path.
- **AC-5** Local commit ahead of the target, or diverged: no change, refusal names C2.
- **AC-6** Presence: (a) only this window's live record: moves; (b) plus one live record
  for the same checkout with another `sessionId`: no change, names that session; (c) one
  corrupt record anywhere: no change; (d) this window's record missing or stale: no change;
  (e) two records with this window's `sessionId`: no change; (f) a live record for a
  different worktree only: moves.
- **AC-7** The SPEC-135 consent record present: no change, names C6.
- **AC-8** A leftover with an end-of-line conversion attribute: no change, names C8.
- **AC-9** A file modified between the check and the staging (injected through the test
  seam): it is not staged with its new bytes, the fast-forward is refused or leaves it
  modified, and after FR-11 the index equals its pre-pass state.
- **AC-10** After a move, the approved spec's derived status is approved, and it was
  approved when sampled between staging and the fast-forward.
- **AC-11** A pending approval whose paths `HEAD` already holds is cleared with no move and
  no network call beyond the pass's fetch.
- **AC-12** In a folder without `.minspec/`, no pass, record, fetch or notification occurs.
- **AC-13** A source-level test asserts the pass never invokes `stash`, `reset`, `rebase`,
  `checkout`, `restore`, `clean`, `rm` (other than `--cached` in FR-11's restore),
  `commit` or `push`; it is paired with a mutation that adds one and makes it fail.
- **AC-14** After a recovery push with its pull request open: every transported path
  whose bytes equal the pushed blob is gone from `git status`, the index and `HEAD` are
  unchanged, and the approved item reads approved in the approval store, the decision
  list and the spec catalog.
- **AC-15** The same with one path edited after the push, or with a staged change: that
  path is kept and named, its bytes unchanged; with the sidecar unprovable, nothing is
  touched and no record remains.
- **AC-16** One record only: after a recovery push, exactly one pending-approval file
  exists for the document, in the per-worktree git directory, and the follow pass (FR-6)
  and the overlay (FR-20) both read that file; a sibling worktree of the same repository
  sees no overlay. In a window with a second folder open, a record in that folder's git
  directory is reported once, naming the folder, and never followed.
- **AC-17** Clear and dead: once `HEAD` carries the sidecar with the same `specHash`, the
  record is deleted; with the branch's remote-tracking ref removed and the base not
  carrying the sidecar, the item reads unapproved and the record file still exists.

## Limitations, stated plainly

- **Terminal agent sessions are invisible to C4.** Claude Code sessions do not write
  SPEC-026 presence records; the primary held only the editor's record when measured on
  2026-10-17. An agent working in the checkout from a terminal is therefore not seen by the
  presence condition. What keeps its work safe is C7 and FR-10, not C4: any uncommitted
  edit it has made is a leftover that differs from the target, so the pass refuses; and git
  refuses a fast-forward over a change that races in. What is not prevented: an agent that
  is only reading sees files change under it, exactly as if the user ran `git pull`.
  Tracked as issue 2843 (terminal agent sessions write no presence record).
- **Before the merge, only proven copies go.** FR-19 retires what it can prove once the
  pull request is open. A document edited beyond lifecycle, an untracked document, or a
  path with staged changes stays until the merge, and the follow pass handles it then.
- **A closed pull request is seen only after a pruning fetch.** With the setting `off` or
  `ask`, nothing fetches, so a record whose pull request was closed unmerged keeps the item
  reading approved until the user's own fetch prunes the branch's remote-tracking ref.
  The overlay can then overstate the approval, the opposite of the 2026-10-09 error, for
  as long as no fetch happens.
- **A regenerated index can block a follow.** Accept ADR writes the whole regenerated
  `docs/decisions/INDEX.md` (issue 2021). If another decision merges before this one, main's
  index differs from the leftover by more than this approval, C7 fails, and the refusal
  names `INDEX.md`. When FR-19 has already retired the leftover index (its bytes matched
  the pushed blob), there is no leftover and this case does not arise. The one clean-up
  command stays the fallback otherwise; issue 2021 is the producer-side fix.
- **Accept Epic is not covered.** It writes no approval sidecar, so there is no
  `specHash` for FR-4 to record or for the landed test to compare, and a leftover epic file
  from a protected-branch accept is not followed. Covering it needs the producer to write a
  sidecar (new behaviour in `commands/epic.ts`) or a different landed test; neither is
  specified here. Tracked as issue 2993 (Accept Epic writes no approval sidecar).
- **Two approvals in flight.** Leftovers from an approval that has not merged differ from
  main, so a merged approval's follow waits until both have landed.
- **The move brings in all of main, code included.** The stale-build warning (SPEC-060) can
  show after a move until SPEC-135 (self-installing build) lands.

## Decisions recorded by an agent (ratified only by approval of this spec)

Under the session's `act` autonomy the agent chose these; the rejected alternatives are
recorded here because nobody saw them live (DR-086 section 4).

1. **A new spec, not an amendment.** SPEC-050 (approval pull request) owns the push seam
   but is approved and states it only reads `approve-push.ts`; amending it would stale an
   approval for a different concern. SPEC-135 (self-installing build) owns a host updater
   with its own consent record, and SPEC-026 (session presence) owns the records. The move
   belongs to none of them, so it is its own spec that names each as a dependency.
2. **`Not now` is final (FR-2).** Rejected: asking again on every approval, which breaks the
   once-for-always rule; and a silent default of `off`, which hides the feature.
3. **Defer to SPEC-135 when its consent record exists (C6).** Rejected: two movers
   coordinating, which re-creates the race SPEC-135 FR-23 removed.
4. **Refuse on any conversion attribute (C8).** Rejected: comparing after git's clean
   filter, which is no longer the founder's "one byte" test.
5. **Fetch on focus and every five minutes, only while pending (FR-5).** Matches SPEC-135
   FR-19's cadence. Rejected: fetching only on demand, which leaves the founder's checkout
   stale until someone remembers.
6. **One record, in the per-worktree git directory (FR-4, amendment 2026-10-21).** The
   readers that must see it (approval store, decision list, spec catalog) are plain
   library code with no editor API, and per worktree means a sibling worktree never
   inherits the overlay. Rejected: the editor's workspace storage as first drafted, which
   those readers cannot reach and which is lost when the same checkout is opened through a
   different workspace file; and keeping both records, which is two answers to one
   question that can disagree.
7. **Clear on the landed sidecar, not on every path's bytes (FR-6, FR-21).** Rejected:
   clearing only when `HEAD` holds every recorded path's exact blob, which never happens
   when another decision regenerates the index first (issue 2021), so the record would
   never end.
8. **Retire whatever the setting says (FR-19).** Local, byte-proven, and only the
   extension's own output. Rejected: gating it on FR-1's consent, which leaves the default
   (`ask`) checkout dirty for the whole pull request, the issue 2974 problem.

## Clarify (recommended answers recorded by an agent 2026-10-17; ratified only by approval of this spec)

Each question carries a **Recorded selection** line naming the option this document
recommends. An agent session wrote those lines; the founder has not chosen them. This
repository runs with `"autonomy": "act"` (`.minspec/config.json`), under which an agent
proceeds on a stated recommendation and leaves the options it did not take on record
(DR-086 section 4). Approving a T3 spec is on that record's stop list, so nothing here
stands in for the approval: the lines propose, and approving this spec ratifies them. The
requirements above already read as the recorded selections; each question names what
changes under the other options. None of the four is outward-facing, irreversible or a
spend: each changes code that is not yet written.

`phases.clarify: done` says the Clarify work is finished, not that its answers are
ratified. `status:` stays `specifying` on purpose: an unapproved spec derives `specifying`
whatever its phases say (`packages/minspec/src/lib/lifecycle.ts:140`, INV-1), and SPEC-136
(headless core) carried this same shape, `specify: done`, `clarify: done`, `status:
specifying`, until its approval (`d63edcf5`).

### OQ-1 - Which branch is "the default branch" when `origin/HEAD` is not set?

`origin/HEAD` is often absent: the approve gate's own comment records it was "absent in both
repos this guard was written for" (`packages/minspec/src/lib/approve-commit.ts:324-330`),
and the gate falls back to the current branch's name. Recovery then pushes from a worktree
off `origin/<base>` (`packages/minspec/src/lib/approval-recover.ts:213-216`).

**Recorded selection: Option A,** the base the recovery used, recorded with the approval.

- **Option A - record the base in FR-4 and follow `origin/<base>` (rec).** The pass uses
  the same answer the approval path already acted on, with no new rule to keep in step.
  *Cost:* if the repository's default branch is renamed between the approval and its
  merge, C1 refuses (named) and that approval needs the manual clean-up once.
- **Option B - require `origin/HEAD`, refuse when absent.** *Cost:* on repositories set up
  like the two the gate was written for, the feature never fires, and every pass is a
  standing refusal.
- **Option C - run `git remote set-head origin --auto` to learn it.** *Cost:* a second
  network call and a ref write the user did not ask for, outside FR-10's operation list.

Under B, the Terms entry and C1 read `origin/HEAD`, and FR-4 records no base. Under C,
FR-10 gains an operation and FR-5 a second network call.

### OQ-2 - Where does the consent live?

A committed `.vscode/settings.json` outranks the user's own settings for any setting that
allows workspace scope, and writing one into the checkout would itself be a leftover that
fails C7. `minspec.approverEmail` already uses `application` scope for a personal choice
(`packages/minspec/package.json:537-541`).

**Recorded selection: Option A,** user settings only.

- **Option A - `application` scope, written to user settings (rec).** One answer covers
  every window and every worktree of every MinSpec repository on this machine, which is the
  once-for-always rule; and a repository cannot grant itself consent to move a checkout.
  *Cost:* the consent is not per-repository: `on` applies to every folder with `.minspec/`
  this user opens (FR-16 still keeps it out of every folder without one). A user who wants
  it in one repository and not another cannot say so.
- **Option B - workspace scope, written to `.vscode/settings.json`.** *Cost:* the write
  dirties the checkout and blocks the very move it consents to; a committed `on` would
  switch the feature on for everyone who clones the repository.
- **Option C - kept in the editor's workspace storage, not a setting.** *Cost:* invisible
  in the settings editor, so FR-2's "changing it later is a settings edit" fails; it would
  need its own reset command.

Under B or C, FR-1's last sentence changes, and under C so does FR-2's last sentence.

### OQ-3 - Which approvals trigger the question and get recorded?

Only the `protected-branch` arm of `commit-on-approve.ts` leaves copies in the checkout
(`packages/minspec/src/commands/commit-on-approve.ts:214-252`). The `committed` arm commits
on the current branch first, so its push leaves the tree clean.

**Recorded selection: Option A,** the recovery arm only.

- **Option A - only a successful recovery push asks and records (rec).** A user whose
  default branch is not protected is never asked about a feature that cannot act for them.
  *Cost:* such a user who later protects the branch is first asked at that later approval,
  and approvals made before then are not followed (they left no copies, so there is
  nothing to follow).
- **Option B - every successful approval push asks and records, as first drafted.**
  *Cost:* adopters on an unprotected branch get a consent question, and a five-minute fetch
  once they answer `on`, for records FR-6 then clears without a move.

Under B, FR-2, FR-3 and FR-4 drop the recovery-path wording.

### OQ-4 - A window with several folders open

The presence record is written for one folder per window, the activation-time root
(`packages/minspec/src/extension.ts:107-127`). The founder's workspace file opens several
repositories in one window. An approval made in a folder other than that root has no
record of this window in it, so C5 would fail there for as long as the window is open.

**Recorded selection: Option A,** follow only the presence root; name the rest.

- **Option A - act only on the checkout this window's presence record names; report a
  pending approval found in any other open folder's git directory once, naming the
  folder (rec).** No change to SPEC-026, and
  C5's fail direction holds. *Cost:* an approval made in a second folder of a multi-root
  window is never followed by that window; it needs the manual clean-up, or a window opened
  on that folder alone.
- **Option B - extend presence to write one record per opted-in folder in the window.**
  *Cost:* changes SPEC-026's approved behaviour (an amendment and a second sign-off) and
  makes the drain see every such folder as occupied, so the drain stops moving checkouts it
  moves today.
- **Option C - follow any folder in the window, skipping C5 for folders without this
  window's record.** *Cost:* removes the demonstration DR-065 condition (a) requires, so a
  pass could move a checkout whose presence it never proved.

Under B, SPEC-026 is amended and FR-18 widens. C is not buildable under DR-065 as it stands.

## Alternatives considered (the queue item d1167 options)

- **drain** - widen the drain's G2 to accept identical leftovers. Rejected: the drain never
  passes G3 while the editor is open, which is exactly when the founder approves.
- **updater** - wait for SPEC-135's host updater. Not rejected so much as slower: planning,
  a host service and two more sign-offs. C6 makes the two compatible.
- **revert** - restore the paths after the push. Rejected by the founder in queue item
  d1167: unapproved in the editor until a manual pull. Adopted in a narrower form by the
  2026-10-21 amendment (FR-19 to FR-21), with the record that keeps the item approved in
  view; see Context.
- **Discard identical leftovers** (the 2026-08-30 DR-065 amendment). Withdrawn: staging
  reaches a clean checkout without deleting a file.
- **Stash and pop.** Rejected for the same reason autostash is off on this checkout: a pop
  that conflicts strands work (`SPEC-135 requirements.md:743-746`).

## Depends on

- **DR-065 Amendment B** (the extension may move its own checkout) must be accepted before
  any of this is built. Approving this spec does not accept it.

## Traceability

- Triggered by issue 1167 (G2 deadlock), founder answer `follow` to queue item d1167,
  2026-10-17.
- Gate: DR-065 Amendment B for FR-1 to FR-18; FR-19 to FR-21 wait on the further DR-065
  amendment issue 2992 asks for. Presence: SPEC-026. Staging technique: SPEC-135 FR-21, FR-22.
- Amended 2026-10-21 for issue 2974 (primary left dirty after an approval): the pre-merge
  window and the single pending-approval record, drafted in PR 2990 (in-flight approval
  record), which is open and held until this amendment is approved and issue 2992's
  amendment is accepted.
- Related producers: issue 1354 (approve leaves an untracked sidecar), issue 2021 (accept
  commits the whole regenerated index), issue 1163 (Accept ADR lands its own output).
