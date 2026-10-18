---
id: SPEC-141
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination (shared-checkout hazard #168)
aspects: [approval, commit-on-approve, shared-checkout, toctou, no-silent-gate, hash-lock]
relates_to: [SPEC-022, SPEC-050, SPEC-140, DR-051, DR-012, DR-056, "#1346", "#168", "#576", "#1262", "#1064"]
implements: []
affects: [packages/minspec/src/lib/approve-commit.ts, packages/minspec/src/commands/commit-on-approve.ts, packages/minspec/src/commands/approve.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-141: Approval refuses to sign bytes the approver did not review

Tracks #1346 (bug: commit-on-approve sweeps unrelated uncommitted edits into the approval commit).

## In plain terms

When a human approves a spec, the approval record stores a hash of the spec file as it is
on disk. If another session left an uncommitted edit in that same file (the shared primary
checkout, #168 / DR-051 §4a), the hash and the commit cover that edit too. The human's
sign-off then certifies bytes they never saw. This spec makes approval refuse, visibly,
before it writes or stages anything, when the spec file holds changes the approval flow did
not itself make.

## Root cause (mechanism, not state)

`commitApprovalIfEnabled` commits the spec document plus its sidecar (SPEC-022 FR-1, #576)
from the working tree, and `specHash` is computed from the same on-disk read. Nothing
compares "the bytes the human was shown" with "the bytes being hashed and committed". The
existing up-front refusals (`protected-branch`, `merge-in-progress`, `detached-head` in
`approve-commit.ts`) cover where the commit lands, none covers what it contains. The missing
gate is a content-provenance check on the approved document.

## Functional requirements

- **FR-1 Dirty-file refusal (primary gate).** Before the approval flow writes any lifecycle
  field, hash, or sidecar, it checks whether the spec document differs from `HEAD`
  (unstaged OR staged changes, or untracked-but-new file excluded, see FR-5). If it does,
  approval is refused and nothing is written, staged, or committed.
- **FR-2 Actionable, visible message.** The refusal names the file and says to review,
  commit, or stash the unrelated changes and retry. It is surfaced as an error, never a
  silent no-op (constitution invariant 2).
- **FR-3 Check precedes mutation.** The check runs before any write by this flow, so "dirty"
  means "someone else's change" with no need to separate out lifecycle fields the flow
  itself wrote. Same ordering discipline as the `protected-branch` up-front refusal.
- **FR-4 Second witness (TOCTOU).** The flow captures a hash of the document bytes it read
  and validated. Immediately before the hash is minted and again before staging, it re-reads
  the file; if the bytes differ from the captured read (other than by this flow's own
  lifecycle write), it refuses. Closes the window between FR-1's check and the commit
  (sibling of #1262). See Decisions needed D-1.
- **FR-5 Scope.** The check covers the spec document being approved. Sidecar-path files and
  other documents are unaffected. A spec file not yet tracked by git (new file, nothing in
  `HEAD`) has no baseline and is not refused by FR-1; FR-4 still applies.
- **FR-6 Fail closed on an errored witness.** If git cannot answer (status errors, timeout),
  approval is refused with the cause shown, except when rootDir is not a git repo, where
  commit-on-approve is already inapplicable and behaviour is unchanged.
- **FR-7 Opt-out parity.** With commit-on-approve disabled, the on-disk hash problem still
  exists, so FR-1 and FR-4 apply regardless of that setting. See D-2.
- **FR-8 Typed outcome.** `CommitApprovalOutcome` gains a distinct member (working name
  `'dirty-spec'`) carrying the path, so the command layer words the refusal precisely
  instead of degrading to `'failed'`.

## Acceptance criteria

- **AC-1** Given an uncommitted edit to `requirements.md` and an approve attempt, no
  sidecar is written, no lifecycle field changes, nothing is staged, no commit is made, and
  an error names the file. (Real-git fixture; assert index and working tree unchanged.)
- **AC-2** Given a clean spec file, approval behaves exactly as before (one commit holding
  document + sidecar).
- **AC-3** Given a staged-but-uncommitted edit, approval is refused (FR-1 covers the index).
- **AC-4** Given the file changed between the validate read and hash mint, approval is
  refused (FR-4); the test mutates the file via an injected hook between the two reads.
- **AC-5** Given a git status failure, approval is refused with a visible cause (FR-6).
- **AC-6** Given an uncommitted edit in a DIFFERENT file in the spec directory, approval of
  this document proceeds (no over-refusal).
- **AC-7** The refusal fires on exactly the dirty cases: a mutation test removing the check
  turns AC-1 red.

## Invariants the change must not break

- Offline: only local git calls, no network (constitution 1).
- No silent gate: refusal is visible; an errored git witness refuses, never passes (2).
- Blast radius: behaviour is limited to repos with `.minspec/` (3).
- Hash lock semantics of SPEC-022 unchanged: the hash still covers the whole canonical
  document; this spec only adds a precondition.
- Existing commit-on-approve guarantees (no stranded staging, no commit in detached HEAD)
  are untouched.

## Out of scope

Path-scoped partial staging (issue option 3: git stages whole files). Detecting concurrent
edits made AFTER the commit. Any change to the sidecar format.

## Decisions needed (Clarify)

- **D-1 How rigorous: FR-1 only, or FR-1 plus FR-4?**
  - (a) **FR-1 + FR-4 (rec):** two independent witnesses, closes the TOCTOU window
    (invariant 2 asks for a second witness). Cost: more code and one more re-read per
    approval, and a rare false refusal if an editor autosaves mid-approve.
  - (b) FR-1 only: cheap and covers the reported incident. Cost: a concurrent session can
    still edit between check and commit.
- **D-2 Does the check apply when commit-on-approve is off?**
  - (a) **Yes (rec):** the signed-unseen-bytes defect is in the hash, not the commit. Cost:
    users with the commit disabled get a new refusal they did not have before.
  - (b) Only when committing: smaller blast radius. Cost: the hash still certifies unseen
    bytes for those users.
- **D-3 Staged-only changes.** Refuse (rec, FR-1 as written; cost: a user who deliberately
  staged their own edit must commit it first) or allow when the index equals the working
  tree.
