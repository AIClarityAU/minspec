---
id: SPEC-263
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a finished dispatch must never be reported done when its work was never published
aspects: [dispatch, no-silent-gate, spec-id, drain]
depends_on: []
relates_to: ["#2794", "#735", "#847", "#1418", "#1226", "#1120", "#1305"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decisions D1-D3.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-263: A rejected drain push is diagnosed, never reported as done, and a new spec never reuses a taken id

> **This is a SPECIFICATION ONLY.** Written for issue #2794. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.
> If another open PR already holds `SPEC-263`, renumber to the max across base and every open
> PR plus one (the same rule DR ids follow) and update `id:` and the directory name together.

## In plain terms

During the 2026-10-15 drain, two specify-only dispatches (#735, #847) finished, but the parent's
`git push` was refused with `! [remote rejected] agent/issue-N -> agent/issue-N (failed)` and
no reason. About 20 other pushes in the same cycles succeeded. Both rejected commits add one new
spec and both declared `SPEC-137`. The dispatcher printed `WARNING: push failed ... review
worktree manually`, then went on to mark the issue `agent-done` anyway. The work lives only in
`/tmp/minspec-agent/issue-N-*`, which is deleted on cleanup. So a failed publish looks like a
completed one and the work is silently lost.

## Evidence (what was checked, and what was not)

Checked in this repo at `804a899d`:

- **No push-time spec-id rule exists in this repository.** The only spec-id uniqueness check is
  `checkDeclaredSpecIds` in `scripts/lib/spec-id-collision.ts`, run by `validate-frontmatter.ts`
  (CI / `npm run validate`). It runs after a push, never as a server-side hook. Nothing under
  `.github/workflows/` rejects a ref update. So the issue's hypothesis ("a push-time rule rejects
  a taken spec id") is **not supported by anything in the repo**. A GitHub ruleset could still do
  it; rulesets live on the host, not in the tree (unverified, see FR-1).
- **`SPEC-137` is not an id on `main` now.** `specs/minspec/` holds `SPEC-136`, `SPEC-139`, with
  no `SPEC-137` directory. The only other mention of the string is a prose reference in
  `SPEC-051`. Two in-flight branches picking the same free number is the lost-update class
  `scripts/lib/spec-id-collision.ts` already documents for #1418, so the shared id is real, but
  being a duplicate is not shown to be why the push was refused: duplicates were opened as PRs
  elsewhere without a push rejection (the gate catches them in CI instead).
- **`(failed)` is not a rule message.** A refusal by a ruleset, a protected ref or the
  `workflows` permission prints a reason (the #1120 case: a `.github/workflows` push by the App
  is refused with a named permission error and `85bed5708` made that a local pre-check). A bare
  `(failed)` is what git prints when the remote returned no per-ref reason, so the cause is not
  recoverable from the captured line alone.
- **The silent-loss path is in the code.** `scripts/dispatch-issue.sh:2366` pushes; the `else`
  at `:2749-2751` only echoes `WARNING: push failed`. Control then falls to `:2765`, which
  removes `agent-ready` and adds `agent-done` unconditionally (its `|| true` swallows errors).
  The summary comment and PR are never created, and nothing re-queues the issue. This breaks
  the no-silent-gate invariant (constitution invariant 2).
- **Not checked, so not claimed:** the actual remote reason, whether `agent/issue-735` /
  `agent/issue-847` already existed on the remote (a pre-existing diverged branch is a candidate
  cause), the host rulesets, and transient GitHub-side failure. The drain log of that run was not
  available to this dispatch. FR-1 exists to close this gap.

## Functional requirements

- **FR-1 Diagnose before fixing.** Before any behavioural change is built, the cause of the two
  rejections is established from evidence and written into this spec's Plan: the stranded
  worktrees (if still present), the drain log for PID 17642, `git ls-remote origin
  'refs/heads/agent/issue-735' 'refs/heads/agent/issue-847'`, and the host rulesets
  (`/rules/branches/...`, not classic protection). The result names exactly one of: pre-existing
  remote branch, host ruleset, App permission gap, transient server error, other. If the worktrees
  are gone, that is recorded and the cause stays "unknown" rather than guessed.
- **FR-2 A failed publish is a visible failure, not a completion.** When the parent's push of an
  agent branch fails, the dispatcher MUST NOT add `agent-done` or remove `agent-ready`/
  `agent-running` as though the work shipped. It leaves the issue in a state that is re-visible
  to the founder (Decision D1 names the state) and records why.
- **FR-3 The refusal reason is captured and surfaced.** The push's combined output is kept (not
  only echoed to a log that can scroll away), the `! [remote rejected] ... (reason)` line is
  extracted, and it is posted on the issue. When the remote gives no reason (`(failed)`), the
  dispatcher says so explicitly and attaches the context it can compute locally: whether the
  remote branch already exists and whether it is an ancestor of the local tip, the files in the
  diff, and whether any path is under `.github/workflows/`.
- **FR-4 The work survives cleanup.** Before a failed-push worktree can be removed, its commits
  are preserved somewhere that outlives `/tmp/minspec-agent` cleanup (Decision D2), or the
  worktree is excluded from cleanup until the issue is resolved. The cleanup path is checked
  so a failed push cannot be followed by deletion of the only copy.
- **FR-5 A transient failure is retried once; a deterministic one is not.** A bounded retry
  (not more than one) with the same commit is allowed only when the captured output matches no
  known deterministic refusal. A retry never uses `--force`.
- **FR-6 New spec ids are allocated against everything in flight.** The spec-id the dispatcher
  hands a specify dispatch is `max(spec numbers on the base branch and in every open PR) + 1`,
  the same shape as `decideDrIdCollision` / `nextFreeId`
  (`scripts/lib/dr-id-collision.ts:324,389`), not the local checkout's `max+1`. The dispatch
  prompt (`scripts/dispatch-issue.sh:1374-1377`, "the next unused number") states the id
  explicitly rather than leaving the model to count. It keys on directory names, as the existing
  check does, because a PR's frontmatter is not cheaply readable across all open PRs.
- **FR-7 Allocation failure degrades visibly.** If the open-PR list cannot be read, the
  dispatcher falls back to the local `max+1`, says so in the dispatch log and the PR body, and
  does not pretend the id was checked. The existing CI duplicate check remains the second
  witness.
- **FR-8 Offline core is untouched.** All of the above lives in dev-time dispatch scripts and a
  pure helper. Nothing is added to the extension, and no network call is added to Tier-0 code.

## Acceptance criteria

- **AC-1 (FR-1)** The Plan names one cause with a quoted piece of evidence for it, or states
  "unknown, worktrees gone" and chooses D3 on that basis.
- **AC-2 (FR-2)** A test forcing `git push` to fail in the dispatcher path asserts the issue
  does not receive `agent-done`, and does receive the Decision D1 state. It is red on current
  `main` (which adds `agent-done`) and green after.
- **AC-3 (FR-3)** A test with a push stub that prints `! [remote rejected] x -> x (failed)` and
  one printing a named reason checks both the extracted text and the "no reason given" wording,
  and that the posted comment includes the local-context facts.
- **AC-4 (FR-4)** A test shows the failed-push branch is preserved (per D2) after the worktree is
  removed.
- **AC-5 (FR-5)** The stub succeeding on the second attempt yields a normal completion; a stub
  printing a named refusal triggers no retry; no call uses `--force`.
- **AC-6 (FR-6)** Given base specs up to 262 and open PR directories `SPEC-263-a` and
  `SPEC-264-b`, the allocator returns `SPEC-265`. Two simultaneous callers that read the same
  state are shown to need the CI check as the backstop (documented, not claimed to be solved).
- **AC-7 (FR-7)** With the PR list unreadable the output contains the "not checked against open
  PRs" notice and the local-max id.
- **AC-8** Tests are added to the vitest run that CI executes, and each new test is
  mutation-checked (flip the guarded condition, see it fail).

## Invariants this must not break

- Constitution invariant 1: core functionality works offline. No extension code gains a network
  call.
- Constitution invariant 2: no silent gate. The entire defect is a swallowed push failure
  followed by a success label. The fix must not reintroduce `|| true` on any signal it writes
  (the existing label edit at `:2765` is the model of what not to copy for the new state), and
  an unreadable PR list must fail visible (FR-7), not pass.
- Constitution invariant 3: blast radius. Changes are limited to this repo's dev-time scripts;
  nothing is shipped to adopters.
- The specify-only scope guard (#1169) and egress guard (#358) keep running before any push.
- The agent still holds no credentials and never runs `git push` itself; the parent publishes.

## Out of scope

- Changing host rulesets or App permissions. If FR-1 finds the cause there, that is a
  separate human action, filed as its own issue.
- Recovering the two stranded worktrees' content beyond the diagnosis in FR-1 (a human or a
  follow-up dispatch re-runs #735 and #847 once ids are allocated correctly).
- Making `validate` reject a duplicate spec id earlier than CI; it already does at `npm run validate`.

## Decisions needed (Clarify)

- **D1 — what state does a failed publish leave the issue in?**
  - (a) Keep `agent-ready`, drop `agent-running`, add `needs-human-review` plus a comment
    **(rec)**. The issue is visible to the founder and the next drain cycle can retry. Cost: the
    drain could re-dispatch the same issue repeatedly and burn tokens if the cause is
    deterministic, so it needs an attempt cap (a counter label or comment marker).
  - (b) New label `agent-push-failed`, excluded from the queue. Safest against loops. Cost: a
    new label and one more queue exclusion to keep in step with `dispatch-ready-check.sh`
    (duplicate predicates drift).
  - (c) Reuse the escalation labels (`agent-escalated` + `needs-human-review`). No new state.
    Cost: conflates "the model gave up" with "the plumbing failed", which mislabels the metric.
- **D2 — where do the unpublished commits survive?**
  - (a) Push to a differently named rescue ref under the same remote (e.g. `agent-rescue/issue-N`)
    **(rec)**. Survives cleanup and machine loss. Cost: it is itself a push and may be refused
    for the same reason, so it needs a fallback.
  - (b) `git bundle` written to a durable local directory outside `/tmp/minspec-agent`. Works
    offline. Cost: still lost if the machine is.
  - (c) Exempt the worktree from cleanup. Simplest. Cost: relies on cleanup code being right and
    leaves disk growth unbounded.
- **D3 — scope when the cause stays unknown.** If FR-1 cannot recover the cause,
  - (a) ship FR-2, FR-3, FR-4 now (they are cause-independent) and FR-6/FR-7 as the id fix
    **(rec)**. Cost: FR-6 may not address the real cause, so the original reports could recur.
  - (b) wait until the next occurrence is captured with FR-3. Cost: leaves the silent loss live
    in the meantime.
- **D4 — allocator inputs.** Use the GitHub open-PR file list (as the DR gate does) **(rec)**, or
  also scan remote `agent/issue-*` branches that have no PR yet. Cost of the second: more calls,
  and it closes the window where a pushed-but-unopened branch holds an id.

## Follow-ups (tracked)

None filed yet. Plan opens a follow-up issue for any host-ruleset or App-permission finding from
FR-1.
