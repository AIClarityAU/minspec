---
id: SPEC-427
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness: concurrent writers on one checkout, same class as SPEC-026
relates_to: [SPEC-026, SPEC-369, DR-051, DR-065, DR-003, "#592", "#168"]  # SPEC-026 concurrent-edit guard (session-keyed; this spec covers writers that are not sessions) · SPEC-369 sibling "local snapshot is stale" signal · DR-051 approvables edited in the shared checkout · DR-065 never move a shared HEAD · DR-003 RCDD (gate, not data fix)
implements: none
implements_reason: >-
  Specify phase only. Nothing is built. Which files carry the work is decided at Plan; the
  likely candidates are a detector module in packages/minspec/src/lib/, the pre-commit hook
  twins (.githooks/pre-commit and the generated hook in
  packages/minspec/src/lib/template-registry.ts), scripts/facts.ts and
  scripts/hooks/session-start.sh. None has a stale-revert check today.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-427: Detect a tracked file silently reverted to an older committed version

> **SPECIFICATION ONLY.** A Specify-only dispatch wrote this (DR-076/#1169). Nothing gets
> built until a human resolves **Decisions needed (Clarify)** and approves the spec.

Issue: [#592](https://github.com/AIClarityAU/minspec/issues/592). Class: concurrent writers on
one shared checkout (#168, global rule #8). Sibling specs:
[SPEC-026](../SPEC-026-session-presence/requirements.md) (session presence and the
concurrent-edit guard) and
[SPEC-369](../SPEC-369-checkout-staleness-signal/requirements.md) (a checkout that is behind
its upstream). No new DR: every choice below can be undone in less than a day (a hook block
and a read-only command). If Clarify picks shipping the check to adopters (decision 1), Plan
must check whether that choice needs a DR.

## One-sentence scope

Add an offline, read-only detector that notices when a tracked file in the working tree or
index has been changed to match an **older committed version of that same path** (not HEAD,
and not a plausible edit), and report it at the points where that matters: before a commit,
at session start, and on demand.

## Problem

Issue #592 reports this incident, from 2026-07-07, in the shared primary checkout on `main`:

- `docs/decisions/DR-047.md` on disk was byte-identical to its version in the parent of PR
  #536's merge (`git diff 89ce606^ -- docs/decisions/DR-047.md` gave 0 lines), while HEAD held
  the merged version.
- `specs/minspec/SPEC-031-reviewer-all-approvables/requirements.md`, which only that merge
  added, was missing from disk (` D` in `git status`).
- HEAD and `origin/main` both contained the merge. There was no stash, no revert commit and no
  reset. The history was correct; the working tree had been partly rolled back.

**Root cause (mechanism).** Some process wrote stale bytes straight to disk, without going
through git. The issue suggests an editor buffer opened before the merge, a backup or sync
restore, or another session. **Which writer did it is unverified.** Nothing in the issue
identifies it, and this spec does not depend on knowing.

**The missing gate.** Nothing compares a dirty tracked path against that path's own history.
Git shows `M` or `D` the same way for a real edit and for a rollback to an old snapshot. The
existing guards do not cover this writer:

- Rule #8 and worktree-per-session only bind git-aware sessions.
- SPEC-026's pre-commit backstop (FR-12) looks for conflicts with a live peer's claimed
  files, using presence records. A stale editor buffer or a sync tool writes no presence
  record, so that backstop never sees it.

So the failure stays silent until a person notices. The two outcomes the issue names:

1. **Misread as data loss**, as here: SPEC-031 seemed to have vanished.
2. **Worse: committed.** A later `git add -A` or `commit -a` seals the rollback on top of
   newer work, and history then records the regression as a deliberate edit.

The detector has to work **whoever the writer was**, because the writer is unknown and
cannot be enumerated. Telling every editor and tool to respect worktree-per-session (the
issue's process option) cannot be enforced against a non-git writer, so it is not a gate
(constitution: enforce, don't trust).

## Definitions

- **Candidate path.** A tracked path whose working-tree or staged content differs from HEAD:
  status `M` or `D` in either column of `git status --porcelain`.
- **Content id.** The git blob id of the content as git would store it, which means after
  clean filters and line-ending conversion (`git hash-object --path=<p>` semantics), so a
  CRLF checkout does not cause a false miss.
- **History window.** The last *K* commits on HEAD's history that changed the path. *K* is
  bounded; see Clarify decision 3.
- **Stale-revert signature (modified).** The candidate's content id equals the blob of that
  path at some commit in the history window, AND it differs from HEAD's blob, AND (during a
  merge) it differs from `MERGE_HEAD`'s blob. The match names the commit **C** whose blob it
  equals. The rollback undoes every later commit to the path up to HEAD.
- **Stale-revert signature (deleted).** A candidate deleted from the working tree or index
  whose path a commit in the history window **added**. See Clarify decision 2 for whether
  this signature alone is enough to report.
- **Correlated rollback.** Two or more signatures whose matched or introducing commits are
  consistent with one snapshot point (for example, every flagged path matches the parent of
  the same commit, as with #536 in the incident). This is reported as one event: "the working
  tree looks partly rolled back to `<C>`".

## Functional requirements

- **FR-1 Detector (pure, offline, read-only).** One function takes a repo root and returns
  `{ findings: StaleRevertFinding[] } | { unknown: true, reason: string }`. Each finding
  carries: path, kind (`modified` | `deleted`), side (`worktree` | `index`), matched commit
  (short SHA and subject), HEAD's commit for the path, and the count of later commits the
  content would undo. It runs only local read-only git plumbing (`status --porcelain`,
  `hash-object` without `-w`, `log`, `rev-parse`, `ls-tree`). It MUST NOT write objects,
  refs, the index or the working tree, and MUST NOT run `fetch`, `pull`, `ls-remote` or any
  other network command.
- **FR-2 Cost bound.** The detector inspects only candidate paths (FR-1 never walks clean
  files) and at most *K* history entries per path. A clean tree costs one `git status` call.
- **FR-3 Correlation.** Findings that share a snapshot point are grouped (Definitions,
  correlated rollback), and the group is reported first, with the commit it points to.
- **FR-4 Exemptions (legitimate rollbacks).** No finding is raised while one of these is in
  progress: a `git revert` or `cherry-pick` (`REVERT_HEAD` / `CHERRY_PICK_HEAD` present), or a
  merge where the staged content equals `MERGE_HEAD`'s blob for that path. A deliberate restore
  by hand (`git checkout <old> -- <path>`) is NOT exempt by state; it uses the FR-6 bypass.
  *Unverified:* whether `REVERT_HEAD` exists while the pre-commit hook runs for a clean,
  non-conflicting `git revert`. Plan must test this on the git version CI uses before relying
  on it.
- **FR-5 Pre-commit gate (the outcome-2 guard).** The pre-commit hook runs the detector on the
  **index** side. If a staged path carries a stale-revert signature, the hook refuses the
  commit. The message names each path, the commit its content matches, the number of newer
  commits it would undo, the one-line restore command (`git restore --source=HEAD --staged
  --worktree -- <path>`, printed, never run), and the bypass. Clarify decision 4 settles
  whether the gate blocks or only warns.
- **FR-6 Scoped bypass.** `STALE_REVERT_GATE_OFF=1 git commit …` disables only this block,
  following the per-block bypass convention in `.githooks/pre-commit` (#1040/#1043). It is
  never a whole-hook `exit 0`, so it cannot switch off any other gate.
- **FR-7 Errored witness fails visibly.** If the detector returns `unknown` (git missing,
  unreadable object, detached or unborn HEAD, shallow history that does not reach the window),
  the pre-commit block reports the reason and refuses the commit. It does not pass silently
  (constitution invariant 2). The FR-6 bypass still works. Unborn HEAD (the repo's first
  commit) is not an error: there is no history to roll back to, so it returns zero findings.
- **FR-8 Session-start report (the outcome-1 guard).** The session-start hook runs the
  detector on the **working-tree** side and prints any findings as one warning line per group,
  with the restore command. With no findings it prints nothing (no noise line). It never
  blocks a session and never restores anything.
- **FR-9 On-demand command.** `npm run facts` gains a read-only `stale-revert` command that
  prints every finding on both sides, or "none", or `unknown: <reason>`. Its exit semantics
  match the other `facts` commands. It is the command a person runs when a file "vanished".
- **FR-10 No automatic repair.** No surface restores, stages, stashes or commits anything. A
  match is strong evidence, not proof: the person decides, and the printed restore command is
  the only remedy offered.
- **FR-11 Opt-in boundary.** Every surface applies only in a repository with `.minspec/` at
  its root (constitution invariant 3). Whether the pre-commit block also goes into the
  generated adopter hook is Clarify decision 1.

## Acceptance criteria

- **AC-1 (incident replay).** In a fixture repo, commit file `A` as v1 on a base commit, then
  merge a commit that changes `A` to v2 and adds `B`. Write v1's bytes back to `A` on disk and
  delete `B`. The detector reports one correlated group pointing at the base commit, with both
  `A` (modified, matches base) and `B` (deleted, added by the merge).
- **AC-2 (real edit is silent).** Editing `A` to new content that matches no commit in its
  window produces zero findings on both sides.
- **AC-3 (pre-commit refuses).** Staging the AC-1 rollback and running `git commit` exits
  non-zero, and stderr names `A`, the matched commit, the undo count and the bypass variable.
  The same commit with `STALE_REVERT_GATE_OFF=1` succeeds, and every other pre-commit block
  still runs (asserted with a second gate that must still fire under the bypass).
- **AC-4 (exemptions).** A `git revert` of the v2 commit, and a merge whose staged blob equals
  `MERGE_HEAD`'s, produce no finding and do not block. Each is tested on its own fixture.
- **AC-5 (unknown fails visibly).** With git's object store made unreadable for the matched
  blob (or with a stubbed runner that errors), the pre-commit block refuses and prints
  `unknown: <reason>`. It never exits 0 without saying so.
- **AC-6 (offline and read-only).** A stubbed git runner fails the test if any command other
  than the FR-1 allowlist runs. `rev-parse HEAD`, `git status --porcelain` and the object
  count match before and after a detector run.
- **AC-7 (line endings).** With `core.autocrlf=true`, a working file that is the CRLF checkout
  of an older blob is still matched (content-id semantics).
- **AC-8 (clean tree cost).** On a clean tree the detector runs exactly one git command
  (asserted by the stubbed runner's call count).
- **AC-9 (session start).** With findings present, the session-start output contains one
  warning per group. With none, it contains no stale-revert text.
- **AC-10 (opt-in).** In a fixture repo with no `.minspec/` directory, no surface runs the
  detector.

## Invariants this change must not break

- **INV-1 Offline (constitution invariant 1).** Only local git plumbing runs. No fetch.
- **INV-2 No silent gate (constitution invariant 2).** An `unknown` result is reported, never
  read as "no findings" (FR-7). The bypass is scoped to this one block (FR-6).
- **INV-3 Blast radius (constitution invariant 3).** Nothing runs without `.minspec/` at the
  repo root (FR-11).
- **INV-4 Never move HEAD or touch the tree (DR-065, rule #8).** The detector and every
  surface are read-only (FR-1, FR-10).
- **INV-5 Hook twins stay in step.** If the pre-commit block ships to adopters, the
  `.githooks/pre-commit` copy and the generated template carry the same decisive lines, and the
  existing twin-parity test covers them (the same pattern as the protected-branch guard).
- **INV-6 SPEC-026 unchanged.** This spec adds an independent block. It does not change the
  presence records or the FR-12 contention backstop.

## Out of scope

- Identifying or stopping the stale writer (editor hot-exit, sync tool). The detector does not
  depend on knowing the writer. If the writer is later identified, fixing it is a separate
  issue.
- Detecting stale content that matches **no** committed blob, for example an old buffer that
  also has unsaved hand edits. That case cannot be told apart from a real edit without a
  heuristic this spec declines to add (the issue itself flags that heuristic as noisy).
- A live file-watcher in the extension. SPEC-026 FR-7 already owns `fs.watch`. Adding this
  detector there is a possible follow-up after Clarify, not part of this spec.

## Decisions needed (Clarify)

1. **Where does the pre-commit block ship?** (a) This repo's `.githooks/pre-commit` plus the
   generated adopter hook, kept as twins under INV-5 **(rec)**. It costs a template change
   that every adopter receives on refresh, plus a new block an adopter's unusual workflow
   might trip; adopters get the FR-6 bypass. (b) This repo only. Cheaper, but MinSpec would
   ship without a guard it relies on itself, the same dogfood gap the secret-scan block's
   comment describes.
2. **Does a deletion count without a modified-file match?** (a) Report a deleted-file
   signature only when it belongs to a correlated group (a modified path in the same rollback
   matches the parent of the commit that added the deleted file) **(rec)**. Cost: a rollback
   that only deletes recently added files is missed. (b) Report every deletion of a file added
   inside the window. Cost: every deliberate `git rm` of a recent file trips the gate and needs
   the bypass.
3. **History window size *K*.** (a) The last 20 commits that touched the path **(rec)**. Cost:
   a buffer open across more than 20 changes to one file slips past. (b) Unbounded. Cost:
   `git log` over the full path history on every commit, which is slow on hot files. (c) A
   time bound (commits from the last 30 days). Cost: depends on clock and commit dates, which
   rebases rewrite.
4. **Block or warn at pre-commit?** (a) Block, with the scoped bypass **(rec)**. Outcome 2
   (sealing a rollback into history) is the expensive one, and an exact blob match rarely
   means anything else. Cost: someone deliberately restoring an old version by hand has to
   type the bypass. (b) Warn and continue. Cost: an agent running a non-interactive commit
   never sees the warning, so outcome 2 stays possible, and a gate that only warns hides the
   failure.
