---
id: SPEC-208
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - docs-lane push ergonomics; the epic DR-080, SPEC-039 and SPEC-050 belong to
aspects: [approval, protected-branch, recovery, docs-lane, worktree-transport, dedup, toctou, shared-checkout, no-silent-gate]
depends_on: [DR-080, SPEC-050, SPEC-039]  # DR-080 §5 is the loan this repays; SPEC-050 owns the PR seam recovery already uses; SPEC-039 owns the second copy of the transport
relates_to: [SPEC-140, SPEC-022, SPEC-051, DR-051, DR-065, DR-078, DR-012, "#1375", "#1115", "#1653", "#1224", "#1346", "#1354", "#1064", "#168"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038).
# implements: the shared transport module and its test are NET-NEW and owned here;
# approval-recover.ts is existing code owned by no spec's `implements:`, and SPEC-140
# (currently planning, in flight) already lists it under `affects:`
# (specs/minspec/SPEC-140-checkout-follows-approval/requirements.md:21). So this spec does
# NOT take primary ownership: it also declares it under `affects:` and the two specs share
# the file. Overlap to settle in Clarify/Plan: SPEC-140 changes what recovery leaves behind,
# this spec changes how it copies, commits and pushes; land them in an agreed order.
# affects: push-docs-lane.ts is SPEC-039's command and becomes the transport's second
# caller; commit-on-approve.ts is SPEC-050's seam and gains one argument (the bytes
# captured at approval time, FR-6); approval-pr.ts is SPEC-050's hash-locked runner, whose
# ExecRun call shape gains a per-call timeout option under D-4(a), so SPEC-050 needs
# re-approval for that signature change.
implements: [packages/minspec/src/lib/worktree-transport.ts, packages/minspec/tests/worktree-transport.test.ts]
affects: [packages/minspec/src/lib/approval-recover.ts, packages/minspec/src/lib/approval-pr.ts, packages/minspec/src/commands/push-docs-lane.ts, packages/minspec/src/commands/commit-on-approve.ts, packages/minspec/tests/approval-recover.test.ts, docs/decisions/DR-080.md]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-208: Repay DR-080's duplication loan with one worktree transport, and close the copy-time gap

Tracks [#1375](https://github.com/AIClarityAU/minspec/issues/1375), the live tracker for the
loan [DR-080](../../../docs/decisions/DR-080.md) §5 booked (DR-080 says recovery is owned by
the refusal that triggers it). The tracker it replaces, #1115, had already closed when DR-080
was accepted.

## In plain terms

If you approve a spec while on `main`, MinSpec cannot commit there. It copies the approved
files into a temporary second checkout, commits them on a new branch, pushes, and opens a pull
request. The "Save it on a branch" button you click covers that whole sequence.

Two parts of the code do that same copy, commit and push sequence: approval recovery and
the *MinSpec: Push docs-lane* command. DR-080 accepted the second copy on condition it was
paid back later. This spec pays it back: there will be one shared sequence, and both
features use it.

It also closes a gap found while tracing the two hazards #1375 raises. When you click "Save it
on a branch", MinSpec copies the spec file *as it is on disk at that moment*. That moment is
after your click, not when you approved. If another session edited the file in between, its
edit would go out under your approval. After this spec, the copy is checked against what you
approved, and recovery refuses if they differ.

What you see does not change on a normal approval. The spec still reads approved, your
checkout is not moved, and the leftover copies are handled exactly as today (see "Where the
two hazards land").

## Context (measured against the code on 2026-10-18, base `e5795e69`)

**Half of the loan is already repaid, though no artifact says so.** DR-080 §5 named the
repayment event "when #1224 lands, `approval-recover.ts` moves onto that seam, and the
`recovered` outcome becomes its PR-opening call site". Both have happened. #1224 landed
SPEC-050's seam (`packages/minspec/src/lib/approval-pr.ts:1-30`, "the ONE place MinSpec
opens a GitHub pull request"). #1653 (merged as `b24f2df8`, "finish a recovered approval into
a PR") made `recovered` its call site:
`packages/minspec/src/commands/commit-on-approve.ts:166` calls `openApprovalPr` with the
recovery's `branch`, `paths` and `sha`. The module header records the same fact
(`packages/minspec/src/lib/approval-recover.ts:40-46`). So #1115's requirement 2, "open the
PR via SPEC-050's seam", is **done**. DR-080's Follow-ups section still calls it "still owed".

**What is still duplicated is the transport, and SPEC-050's seam does not contain one.**
SPEC-050 FR-4 covers PR *creation* only: "No second `gh pr create` implementation"
(`specs/minspec/SPEC-050-silent-approval-pr/requirements.md:71`). The branch, commit and push
sequence that DR-080 §5 calls "the git-runner/error-classification/worktree-transport pattern"
exists twice, step for step, with no shared module:

| step | `lib/approval-recover.ts` | `commands/push-docs-lane.ts` (SPEC-039) |
|---|---|---|
| fetch base | `:202` `fetch origin <base>` | `:265` `fetch origin main` (hard-coded) |
| throwaway worktree | `:216` `worktree add -q -b <br> <wt> origin/<base>` | `:278` same, `origin/main` |
| copy from primary working tree | `:227` `copyFileSync` | `:287` `copyFileSync` |
| stage exactly the paths | `:236` `add -- <paths>` | `:294` `add -- <paths>`, plus `rm --ignore-unmatch` for deletions `:305` |
| empty-delta check | `:246` `diff --cached --quiet` | `:315` same |
| commit with only the validate step off | `:259` `DR_INDEX_GATE_OFF=1` | `:331` same |
| push | `:277` `push -q -u origin <br>` | `:340` same |
| cleanup | `:293` `worktree remove --force` | `:391` same |

The runner and error classification are duplicated too. `approval-recover.ts:97-135` carries its own
`GitRun`, `defaultGitRun`, `describeError` and `isNetworkError`. `approval-pr.ts:118-163`
carries `ExecRun`, `defaultExecRun`, `describeError` and `isNetworkError`, and
`push-docs-lane.ts` already uses those (`push-docs-lane.ts:47-65`). The two `isNetworkError`
regexes match byte for byte today. Nothing keeps them that way. The per-call timeouts already
differ: `approval-recover.ts:59` uses 60 s and `approval-pr.ts:95` uses 30 s. Which means the
honest reading of "route recovery through SPEC-050's seam" is: extract the *transport* into a
shared seam beside SPEC-050's PR seam, and have both transport callers use it. This spec
specifies that. Moving the transport into `approval-pr.ts` itself is the rejected alternative
(see Alternatives).

**The copy-time gap (#1346 on the recovery path).** In `prompt` mode, recovery waits for a
click (`commit-on-approve.ts:104-118`) and only then copies the files from the primary working
tree (`approval-recover.ts:221-228`). The approval record's `specHash` was minted from the
bytes read *before* that wait. A concurrent session (#168 / DR-051 §4a) that edits the spec
document during the wait has its edit committed and pushed under the approval. The in-flight
spec for #1346 (branch `agent/issue-1346`, "Approval refuses to sign bytes the approver did
not review", also numbered SPEC-141) adds a dirty-file refusal before any write (its FR-1)
and a re-read "immediately before the hash is minted and again before staging" (its FR-4).
On the recovery path nothing is staged in the primary checkout. The read that matters is the
copy into the throwaway worktree, which comes after the consent wait. That spec's text does
not name it, and its `affects:` does not list `approval-recover.ts`. This spec owns that read
(FR-6 to FR-8).

## Where the two hazards land (the ownership decision #1375 asks for)

#1375 says neither hazard sits on either side of DR-080's boundary. Traced to the specs in
flight on 2026-10-18:

- **Hazard 1, "recovery copies rather than moves" (#1354's residue).** Copying rather than
  moving is a decision the founder made, not an oversight. SPEC-140's Context records the
  "fix the source" option (return the working tree to `HEAD` for the paths written) as
  declined by the founder in queue item d1167, because the spec would then read unapproved
  in the editor until a manual pull
  (`specs/minspec/SPEC-140-checkout-follows-approval/requirements.md:77-80`). The residue is
  cleared downstream instead. Once the approval reaches `main`, SPEC-140 fast-forwards the
  editor's own checkout (status `planning`). The in-flight spec for #1354 (branch
  `agent/issue-1354`, also numbered SPEC-141) owns the message on declined or failed arms,
  re-approve de-duplication, and residue that SPEC-140 does not record. **This spec owns
  only the transport, which must keep copying** (INV-4). Nothing here moves, deletes or
  restores a primary-checkout file.
- **Hazard 2, foreign bytes swept into the approval commit (#1346).** The approval-time
  check (dirty document, re-read before minting the hash) belongs to #1346's spec, and the
  recovery path inherits it by construction because it runs before `commitApproval` refuses.
  **The copy-time check belongs here**, because the transport is the step that reads the bytes.

Both in-flight specs claim the id SPEC-141. That collision belongs to them; it is recorded
here only so a reader of either can find this one.

## Terms

- **The transport**: fetch a base ref, add a throwaway worktree off `origin/<base>` on a new
  branch, place a set of files in it, stage exactly those paths (and remove exactly the
  deletion paths), skip an empty delta, commit, read the commit's id, push, and remove the
  worktree.
- **The primary checkout**: the working tree the caller passes as `rootDir`. The transport
  must never change its `HEAD`, index or files.
- **Captured bytes**: for each approval path, the exact file contents (or their SHA-256) that
  the approval flow read when it minted the record, held in memory from approval to
  transport.

## Functional requirements

### A. One transport (the loan)

- **FR-1 - One module.** A new vscode-free module `packages/minspec/src/lib/worktree-transport.ts`
  performs the transport. It is the only place in `packages/minspec/src` that runs
  `git worktree add` to send files to a remote branch. An offline test greps `src/` for
  `'worktree', 'add'` and asserts the module is the only hit (AC-1).
- **FR-2 - Two callers.** `approval-recover.ts` (DR-080 recovery) and `push-docs-lane.ts`
  (SPEC-039) both perform their transport through FR-1's module. Each keeps its own pre-flight
  and surfacing: recovery's consent split (DR-080 §4, `approval-recover.ts:33-38`), and
  docs-lane's corpus filter and confirm prompt (`push-docs-lane.ts:225`, `:412`).
- **FR-3 - One runner and one classifier.** The transport uses SPEC-050's `ExecRun`,
  `describeError` and `isNetworkError` from `approval-pr.ts`, and no copy of them.
  `approval-recover.ts` deletes its own `GitRun`, `defaultGitRun`, `describeError` and
  `isNetworkError` (`:97-135`). `approve-push.ts`'s copies are **out of scope**: its
  push-current path is not a worktree transport. It is listed under Follow-ups so the
  remaining duplication is visible.
- **FR-4 - Base branch is a parameter.** The transport takes the base branch as an argument.
  Recovery keeps passing the branch the guard actually refused (`commit-on-approve.ts:124-131`,
  the #1255 fix for `master`/`trunk` repos). Docs-lane keeps passing `main` unless Clarify
  D-3 decides otherwise. This spec changes no caller's base.
- **FR-5 - Typed outcome, never throws.** The transport returns a typed result. Its outcomes
  are a superset of today's `RecoverOutcome` (`approval-recover.ts:62-67`) and of docs-lane's
  outcomes, plus FR-7's `content-changed`. Every failure (no remote, offline, hook rejection,
  timeout, unreadable file, non-`Error` throw) is a result, never an exception. This is
  DR-080's INV-2 (never throws), carried over. Worktree cleanup stays best-effort and never
  changes the result, as at `approval-recover.ts:290-302`.

### B. The copy-time gap (hazard 2 on the recovery path)

- **FR-6 - Recovery carries what was approved.** `commit-on-approve.ts` passes recovery the
  captured bytes of every approval path. These are the bytes the approval flow wrote and
  hashed, captured before the consent prompt. Recovery hands them to the transport.
- **FR-7 - Verify before staging, refuse on mismatch.** For a caller that supplies captured
  bytes, the transport compares each file it places in the throwaway worktree with the
  captured bytes. It does this after placing the file and before `git add`. If any file
  differs, the transport stages nothing, commits nothing and pushes nothing, and returns
  outcome `content-changed` with the differing path. The fetch has already run by then; the
  push never happens. See Clarify D-2 for the alternative of writing the captured bytes
  directly instead of copying and comparing.
- **FR-8 - Loud refusal.** On `content-changed`, the command layer shows a warning naming the
  file. It says the file changed after approval, that nothing was pushed, and that the
  approval record is still in the working tree. The status suffix carries the same state.
  It never falls through to the generic "NOT committed" text, and it never reports the
  approval as saved (constitution invariant 2; SPEC-051 FR-3, no silent stranded write).
- **FR-9 - Fail closed on an unreadable witness.** If a captured-bytes entry is missing for a
  path recovery is about to transport, or a placed file cannot be read back, the transport
  returns `content-changed` (or `failed` with the cause). It never skips the comparison for
  that path.
- **FR-10 - Docs-lane is unaffected by B.** `push-docs-lane` sends whatever docs the user
  confirmed in its prompt, and supplies no captured bytes. FR-7 does not apply to it, and its
  behaviour does not change (AC-7).

### C. Recording the repayment

- **FR-11 - Amend DR-080 in the implementing PR.** The PR that lands A must also update
  DR-080's `## Follow-ups (tracked)` section. It records that the PR-seam half was repaid by
  #1653, that the transport half was repaid by that PR, and where the two hazards were
  assigned (the section above). DR-080 has no approval sidecar (#1375's cost note:
  `.minspec/approvals/` holds spec records only). So this is a docs-lane edit, not a
  re-stamp. Its `status:` stays `accepted`.

## Acceptance criteria

- **AC-1 (FR-1)** An offline test lists every `src/**/*.ts` file whose text contains the
  argv fragment `'worktree', 'add'`, and asserts the list is exactly
  `[lib/worktree-transport.ts]`. As a control, the same scan over the pre-change tree finds
  two files, so the scan is known to see them.
- **AC-2 (FR-2, FR-3)** `approval-recover.ts` declares no `execFile` import, no
  `describeError` and no `isNetworkError`. `push-docs-lane.ts` and `approval-recover.ts` both
  import the transport. Checked by the existing import-boundary test pattern
  (`tests/import-boundaries.test.ts`), not by reading the source text alone.
- **AC-3 (behaviour preserved)** `tests/approval-recover.test.ts` and
  `tests/push-docs-lane.test.ts` still pass. Their recorded-argv INV-1 assertions
  (`approval-recover.test.ts:21-22`, `:99`, `:117`, `:135`) still hold: the
  `HEAD_MOVING` list never appears with `cwd` equal to the primary checkout, and only the
  named paths are staged. Any argv change is listed in the PR body and agreed in review. It
  is never edited into the fixtures without comment.
- **AC-4 (FR-7)** On a real-git fixture: approve with the recovery path. Between capture and
  transport, an injected hook appends one byte to the spec document. The outcome is
  `content-changed` naming that file. No branch exists on the fixture's bare remote, and the
  primary's `HEAD`, index and working tree are unchanged byte for byte.
- **AC-5 (FR-7, control)** The same fixture with no mutation gives `recovered`, and the pushed
  blob for the spec document equals the captured bytes. A mutation test that removes FR-7's
  comparison turns AC-4 red.
- **AC-6 (FR-9)** If one approval path has no captured-bytes entry, the outcome is not
  `recovered` and nothing is pushed.
- **AC-7 (FR-10)** `push-docs-lane` on a fixture with a docs file edited during its confirm
  prompt still pushes that file's current bytes, as today. Its outcome set adds no
  `content-changed`.
- **AC-8 (FR-8)** A command-layer test drives `content-changed` and asserts both the toast
  and the suffix name the path and contain "nothing was pushed". Neither contains "saved"
  or "recovered".
- **AC-9 (FR-5)** For each injected failure (no origin, fetch network error, worktree-add
  error, unreadable source file, hook rejection on commit, push network error, a non-`Error`
  throw from the runner), the transport resolves a typed outcome. The test never sees a
  rejection.
- **AC-10 (FR-11)** After the implementing PR, DR-080's Follow-ups no longer say "still owed"
  for the PR-seam half, and cite #1653 and this spec.

## Invariants this must not break

- **DR-080 INV-1 / rule #8 / DR-051 §4a.** The transport never runs `checkout`, `switch`,
  `merge`, `rebase`, `reset` or `cherry-pick` against the primary checkout, and never stages
  into its index. This is asserted on recorded argv (AC-3).
- **INV-4 (this spec) - copy, never move.** Nothing in this spec deletes, restores or rewrites a
  primary-checkout file. The founder declined that in queue item d1167 (SPEC-140 Context).
  Residue stays SPEC-140's and #1354's to clear.
- **DR-080 §4 / DR-078 - one consent.** The transport makes network calls only when invoked.
  Consent stays with the callers (`minspec.pushOnApprove` for recovery, the confirm prompt for
  docs-lane). No new setting or prompt is added.
- **SPEC-050 FR-4 - one `gh pr create`.** The transport opens no PR. Recovery's PR stays on
  `openApprovalPr` (`commit-on-approve.ts:166`).
- **SPEC-050 INV-2 / docs-lane INV-2 - corpus-only label.** Unchanged. The transport does not
  mint labels.
- **DR-012 / #1025 - never mint or edit an approval record.** The transport carries files and
  compares bytes. It writes no `status:`, sidecar or `approvedBy`.
- **Constitution 1 (offline).** Only the two existing network steps (fetch, push) exist, and
  both sit behind the callers' consent. AC-1 and AC-2 run offline.
- **Constitution 2 (no silent gate).** FR-7 to FR-9 fail closed and visibly. Cleanup is best-effort, but
  it is not a gate signal.
- **Constitution 3 (blast radius).** No new hook, workflow or setting. Behaviour changes only
  in a repo where the extension already runs.

## Alternatives considered

- **Close #1375 as repaid by #1653 and amend DR-080 only.** This is cheapest. It is rejected
  as the recommendation because DR-080 §5 names the *transport* copy ("a third copy of the
  git-runner/error-classification/worktree-transport pattern"), not only the PR step. And
  the copy-time gap stays open. It is offered as Clarify D-1 option (b).
- **Put the transport inside `approval-pr.ts`.** Rejected. `approval-pr.ts` is the module
  hash-locked SPEC-050 declares in `implements:`, and its header defines it as "the ONE place
  MinSpec opens a GitHub pull request". Adding a second responsibility there widens SPEC-050's
  owned surface without its re-approval (#1179). A sibling module that imports its runner
  keeps one runner without that cost.
- **Write captured bytes into the worktree instead of copying and comparing.** This is
  simpler and has no mismatch outcome: the approved bytes always ship. It is not
  recommended because it ships bytes that may no longer be on disk anywhere. The pushed
  commit and the working tree then disagree, and SPEC-140's byte-identical follow pass
  refuses that checkout until a human acts. See D-2.
- **Fold `approve-push.ts`'s runner in as well.** Deferred. Its push-current path is a
  different operation, and widening the scope would hold up the loan. Listed under
  Follow-ups.

## Decisions needed (Clarify)

- **D-1 How much of the loan to repay.**
  - (a) **(rec) Extract the transport (A), close the copy-time gap (B), record it (C).** This
    removes the duplication DR-080 §5 actually names, and the TOCTOU (check then later use)
    hole on the path the loan created. Cost: it is a T3 refactor of two working,
    well-tested paths (recovery and docs-lane). A regression would strand approvals again,
    which is the failure DR-080 exists to stop. AC-3's preserved argv tests are the guard.
  - (b) Declare the loan repaid by #1653, amend DR-080 only (C), and close #1375. Cost: two
    transport copies remain with diverging timeouts, and the foreign-bytes window on
    recovery stays open with no owner.
  - (c) B and C only, no extraction. Cost: it closes the security-relevant gap but leaves the
    debt DR-080 promised to repay, so #1375 stays open.
- **D-2 How FR-7 closes the gap.**
  - (a) **(rec) Copy from disk, compare with the captured bytes, refuse on mismatch.** What
    ships is both what was approved and what is on disk. Cost: a user whose file was edited
    by another session during the prompt gets a refusal and must re-approve.
  - (b) Write the captured bytes directly. This never refuses. Cost: the pushed bytes can
    differ from the working tree, which leaves residue SPEC-140 will not clear, and it hides
    the fact that a concurrent edit happened.
- **D-3 Docs-lane's base branch.** Docs-lane hard-codes `main` (`push-docs-lane.ts:265`,
  `:278`), while recovery uses the guard's resolved default branch.
  - (a) **(rec) Leave it as is in this spec.** No behaviour change in the refactor. Cost:
    docs-lane stays broken on `master`/`trunk`-default repos, the same class #1255 fixed for
    recovery. File it as an issue.
  - (b) Pass the resolved default branch in the same PR. Cost: a behaviour change rides
    inside a refactor, which makes AC-3's "behaviour preserved" claim harder to review.
- **D-4 Timeout for the transport's network steps.** Recovery uses 60 s today and the shared
  runner uses 30 s.
  - (a) **(rec) The transport passes 60 s for fetch and push, and the runner default for
    everything else.** No caller's network budget gets shorter. Cost: the `ExecRun` call
    shape gains a per-call timeout option, which changes SPEC-050's hash-locked runner
    signature (`approval-pr.ts`, now in `affects:`) and so needs SPEC-050 re-approval.
  - (b) Use 30 s everywhere. Cost: recovery's push budget halves, and a slow link that
    recovers today would time out to `offline`.
  **Recorded selection: Option (a), the transport passes 60 s for fetch and push and the runner default for everything else.** Selected by the founder, 2026-10-26 (queue item clr1027, answer 'all rec' relayed by the chief-of-staff proxy).

## Out of scope

- Moving, restoring or cleaning primary-checkout residue (SPEC-140, and #1354's spec).
- The approval-time dirty-document refusal and re-read before minting the hash (#1346's
  spec).
- PR opening (SPEC-050, already reached by recovery since #1653).
- `approve-push.ts`'s push-current transport and its runner copy.
- Resolving the SPEC-141 id collision between the two in-flight specs.

## Follow-ups (tracked)

- [#1375](https://github.com/AIClarityAU/minspec/issues/1375) - this spec's tracker. It closes
  when FR-11 lands.
- [#1346](https://github.com/AIClarityAU/minspec/issues/1346) and
  [#1354](https://github.com/AIClarityAU/minspec/issues/1354) - the sibling owners named in
  "Where the two hazards land".
- `approve-push.ts` runner duplication (FR-3, out of scope): to be filed as an issue by the
  implementing PR, or noted in `docs/backlog.md` per DR-023 if it would not change a decision
  within 30 days. Not filed by this Specify dispatch, which may not create issues.
- D-3 option (a), docs-lane hard-coding `main`: same handling as the previous item.
