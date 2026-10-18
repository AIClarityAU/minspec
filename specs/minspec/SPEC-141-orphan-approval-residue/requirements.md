---
id: SPEC-141
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination (same epic as SPEC-140, its sibling)
aspects: [approval, protected-branch, shared-checkout, no-silent-gate, stranded-write, fast-forward]
depends_on: [SPEC-050, SPEC-051]
relates_to: [SPEC-140, SPEC-135, SPEC-039, SPEC-052, DR-065, DR-080, DR-051, "#1354", "#1064", "#1115", "#1346"]
---

# SPEC-141: A declined approval commit never leaves unnamed residue that later blocks a fast-forward

Issue: [#1354](https://github.com/AIClarityAU/minspec/issues/1354). Governing decisions: [DR-080](../../../docs/decisions/DR-080.md) (protected-branch recovery in a throwaway worktree), [DR-065](../../../docs/decisions/DR-065.md) (presence-gated fast-forward).

## In plain terms

Approve a spec on `main` and the extension writes the approval record (the `.json` sidecar) into your checkout, then refuses to commit it, because a commit on `main` can never be pushed. That refusal is right. But the record stays behind as an **untracked** file that nothing owns. Once the same record reaches `main` another way, the untracked copy collides with the tracked one and every later `git merge --ff-only` stops with "untracked working tree files would be overwritten". The leftover is usually byte-identical to what is arriving, so nothing is at risk, but you cannot tell that without comparing by hand. Worse, the message at approval time reads like a failure, so people approve again and make a second copy.

This spec closes the parts of that which [SPEC-140](../SPEC-140-checkout-follows-approval/requirements.md) does not.

## Context (measured against the code, not the issue prose)

- The issue's option (a), "ferry the sidecar through the docs-lane", **already exists** for the consent-given case: on `protected-branch`, `commands/commit-on-approve.ts:231-243` calls `recoverOnProtectedBranch`, which copies the files into a throwaway worktree and pushes (`lib/approval-recover.ts`, DR-080). It deliberately leaves the primary checkout untouched (INV-1 there), so **the original copies stay untracked in the primary even on success**. SPEC-140 removes exactly those, but only for approvals this editor window recorded, only after the PR merges, and only when its gate (presence, consent, byte-identity) passes.
- Where recovery is **not** performed, the residue is permanent and the message is weak: consent withheld or recovery failed falls to the warning at `commit-on-approve.ts:250-264`, "Approval written but NOT committed ... commit them on a branch to keep them", and the `declined` arm returns only a status-bar suffix. Neither says the approval **was recorded**, which file is left behind, or that re-approving is pointless.
- Residue not recorded by SPEC-140 (another session's approval, an earlier window, a pre-SPEC-140 leftover) has no handler at all.

## Requirements

- **FR-1 - Honest message on every non-committing arm.** When approval writes a sidecar and the commit does not happen for any reason (`protected-branch` with recovery declined or failed, `detached-head`, `merge-in-progress`, `failed`), the message MUST say: the approval **was recorded and is valid**; it is **not committed**; the exact repo-relative path(s) left in the working tree; and one concrete action to land them. It MUST NOT read as a failed approval and MUST say re-approving is unnecessary.
- **FR-2 - Re-approve does not multiply residue.** If the approval being written has the same `specHash` as an existing untracked sidecar for that file, the writer MUST NOT leave a second differing copy (a fresh `approvedAt`); it keeps the existing record and reports it as already recorded. A different `specHash` is a genuine new approval and proceeds as today.
- **FR-3 - Classify untracked collisions.** A helper (deterministic, offline, read-only by default) takes the incoming ref (default `origin/<default>`) and lists each untracked path that the incoming tree also tracks, labelling each **identical** (same bytes) or **different**. It reports paths only; it never guesses.
- **FR-4 - Remove only identical residue.** An explicit mode of the helper MAY delete a path labelled identical, and only when it is untracked, inside `.minspec/approvals/`, and byte-equal to the incoming blob. Any **different** path is left untouched and the helper exits non-zero, naming it and showing the diff command. Nothing is deleted on a partial or errored comparison.
- **FR-5 - Fails closed and visibly.** An unreadable incoming ref, a failed blob read, or a missing fetch is an error exit with a stated reason - never "no collisions". Stated in the output as the control: the count of paths compared.
- **FR-6 - Boundary.** Nothing here runs a `checkout`, `reset`, `merge` or `rebase`, stages anything, or touches a repo without `.minspec/` at its root (constitution invariant 3). No network call except an explicit fetch the user asked for (invariant 1).

## Acceptance criteria

- **AC-1** On `main` with recovery declined, the toast and the status suffix both contain "recorded", the sidecar path, and "no need to approve again"; the text contains neither "failed" nor "NOT approved". (FR-1)
- **AC-2** Same assertion for each of `detached-head`, `merge-in-progress`, `failed`. (FR-1)
- **AC-3** Approving the same unchanged spec twice leaves one sidecar with the first `approvedAt`; changing the spec body then approving writes the new hash. (FR-2)
- **AC-4** Fixture: untracked sidecar byte-identical to `origin/main`'s -> labelled identical; one differing by a single byte -> labelled different; helper deletes only the first and exits non-zero. (FR-3, FR-4)
- **AC-5** Fixture: incoming ref missing -> non-zero exit with a reason, nothing deleted, never an empty "ok". A control case with a known collision proves the comparison ran. (FR-5)
- **AC-6** After the helper removes identical residue, `git merge --ff-only origin/main` succeeds on the fixture checkout. (goal)

## Invariants this must not break

- Protected-branch refusal stays (#1064): nothing is committed on the default branch.
- DR-080 INV-1: recovery still never moves the shared checkout's HEAD or index.
- Approval records are never minted or edited by a recovery or cleanup path (DR-012, #1025); FR-2 only declines to write a duplicate.
- SPEC-051 FR-3: no silent stranded write - every arm in FR-1 is loud.
- Constitution invariant 2 (no silent gate): FR-5. Invariant 3: FR-6.

## Out of scope

Moving the checkout after an approval PR merges (SPEC-140). The other approve-path hazard of #1346. Changing the protected-branch refusal.

## Decisions needed (Clarify)

1. **Overlap with SPEC-140.** SPEC-140 already removes this editor's own residue after merge. Options: **(rec) keep this spec narrow as written** (messages, de-dup, classifier for everything SPEC-140 does not record) - costs two cleanup paths that must agree on "identical"; or **fold FR-3/4 into SPEC-140's gate** - one mechanism, but SPEC-140 is already `planning` and approved, so editing it stales that approval.
2. **Where the helper lives.** **(rec) a `scripts/` helper** run by hand or by the drain, as the issue suggests - costs: operators must know to run it; or a function in `packages/minspec` surfaced as a palette command - discoverable, but the drain and the container cannot call it.
3. **FR-2 scope.** **(rec) keep the existing record** on same-hash re-approval - costs that `approvedAt` no longer reflects the latest click; or let it overwrite - simpler, but is the exact accumulation the issue observed.
4. **Automatic invocation.** Should the helper run itself before the drain's fast-forward? **(rec) no, manual and reported first** - costs the drain still stalls until someone runs it; yes would self-heal but adds a deletion step to an unattended path, which wants its own consent decision (DR-065 Amendment B territory).
