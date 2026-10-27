---
id: SPEC-260
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - harness refresh is a core write path of the SDD scaffold
aspects: [harness-refresh, branch-or-direct, push-consent, no-nagging, opt-in]
depends_on: []
relates_to: ["#2559", "#1298", "#2371", "#2325", "#2326", SPEC-050, SPEC-068]
implements: none
implements_reason: >-
  Specify phase only. Files this spec will own are decided at Plan, after Decisions D1-D3 are resolved.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-260: Refresh Harness Files decides branch-or-direct itself, finishes the job, and leaves the checkout on the default branch

> **This is a SPECIFICATION ONLY.** Written for issue #2559. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

After **Refresh Harness Files**, MinSpec asks "commit on a new branch or here anyway?". Choosing
the branch switches the checkout to `chore/minspec-harness-refresh-<date>`, makes one commit, and
stops: not pushed, no pull request, checkout left parked on that branch (seen twice on
voip-sms-inbox, 2026-10-01 and 2026-10-04). This spec removes the question and finishes the job
the way approvals already do: decide from facts MinSpec can read, commit on a side branch, push it
and open the PR **only under the same consent as an approval push**, and never leave the checkout
anywhere but where it started.

## Evidence (code read, not inferred)

- The offer is `offerScaffoldCommit` in `packages/minspec/src/commands/init.ts` (~L366-440).
  "Default branch" there means `branch.current === branch.default` (`onDefaultBranch`); it does
  **not** read `minspec.protectedBranches`.
- The branch arm calls `committer.createBranch(name)` (which switches onto it), then
  `commitOrWarn`, then returns: no push, no PR, no switch back (`init.ts` ~L398-425).
- The approval flow already does the wanted transport: `recoverProtectedBranchApproval`
  (`lib/approval-recover.ts`), `pushApproval`/`decidePushPlan` (`lib/approve-push.ts`) and the PR
  finish in `commands/commit-on-approve.ts` (branch at the same commit, push, PR, checkout never
  switched). Consent is `minspec.pushOnApprove` (`never|prompt|always`) read via the single accessor
  noted at `commit-on-approve.ts` ~L96; PR opening is `minspec.approvalPr`.
- `minspec.protectedBranches` is the existing, no-network way to know a direct push would be refused
  (`packages/minspec/package.json`, setting description).

## Functional requirements

- **FR-1 Decide, never ask branch-vs-direct.** The branch-vs-direct prompt is removed. The choice
  is computed: current branch is protected (per `minspec.protectedBranches`, plus the existing
  `current === default` signal as the floor) -> **branch**; otherwise -> **direct** (subject to
  Decision D1). No per-refresh toast asks it.
- **FR-2 Config key as override.** A new setting (name decided at Plan; working name
  `minspec.harnessRefreshCommit`: `auto` (default) | `branch` | `direct` | `never`) lets a user pin
  the answer per workspace. `direct` on a protected branch is ignored with a visible note, since it
  could not be pushed (it degrades to `branch`, never to a silent unpushable commit).
- **FR-3 Branch path finishes the job.** When the answer is branch: commit the harness paths on a
  new uniquely-named branch (reusing the #1298 free-name logic), then hand the result to the **same**
  push/PR transport as approvals (`pushApproval`/`recover` path and the PR finish), reusing it rather
  than re-implementing git/`gh` calls.
- **FR-4 Checkout left where it started.** On every outcome (committed, pushed, PR opened, push
  declined, push failed, PR failed) the checkout is on the branch it was on before the refresh, and
  the working tree holds no stray changes from the refresh. Preferred mechanism: build the branch at
  the commit without switching (as approvals do), so there is nothing to switch back. If a switch
  is unavoidable, it is restored in a `finally`.
- **FR-5 Nothing unpushed and unfindable.** If the push is not performed (consent `never`, prompt
  declined, offline, rejected), the local branch is kept and the result message **names the branch
  and the exact next step** (push it / open the PR). The checkout is still restored (FR-4). A refresh
  never leaves work that exists only in a parked checkout.
- **FR-6 Consent reuses the approval setting.** The push and PR are network actions (invariant 1)
  and are governed by `minspec.pushOnApprove` (`never` -> no push; `prompt` -> one prompt; `always`
  -> push) and `minspec.approvalPr` exactly as for approvals. **No new silent network path.**
  Persisted "always" answers share the existing store (no second consent store).
- **FR-7 One decision per repository, remembered.** Any question that remains (the push consent
  under `prompt`) is asked at most once per repository and remembered through the existing
  `pushOnApprove` persistence; a later refresh does not re-ask. No prompt per refresh.
- **FR-8 Opt-in only.** Nothing runs in a folder without `.minspec/` at the repo root (invariant 3).
  A refresh in a non-opted-in folder performs no commit, branch, push or PR.
- **FR-9 No docs-lane label for harness PRs.** The harness set includes workflow files and other
  non-docs paths. The PR is opened **without** the `docs-lane` auto-merge label (the label's docs-only
  proof fails for these paths, and it must not be forced). Whether such a PR can pass its own gate is
  #2371's problem and is out of scope here; this spec only requires the PR to open and be reported.
- **FR-10 Failure is visible.** Every failing step (branch create, commit, push, `gh`) produces a
  message naming the step, the error, and the state left behind (invariant 2). No swallowed errors.
- **FR-11 Same behaviour for init-scaffold.** Decision D2 governs whether the identical change applies
  to the post-`init` scaffold commit offer, which shares `offerScaffoldCommit`.

## Acceptance criteria

1. On `main` with `main` protected, refresh with `pushOnApprove: always`: a branch is pushed, a PR is
   opened without `docs-lane`, `git branch --show-current` is `main`, `git status` shows no refresh
   changes, and no prompt about branch-vs-direct appeared.
2. Same with `pushOnApprove: never`: local branch exists with one commit, nothing pushed, checkout on
   `main`, message names the branch and the push command.
3. Same with `prompt`: one push prompt; answering "always" persists it and the next refresh asks nothing.
4. On an unprotected, non-default feature branch with `auto`: committed directly, no prompt, no push
   (subject to D1).
5. Repeated refresh on the same day produces a distinct free branch name (no #1298 regression).
6. Detached HEAD, no `origin`, or non-git folder: no crash; visible message; checkout unchanged.
7. Folder without `.minspec/`: nothing is created, committed, pushed or opened.
8. A test fails on the old behaviour (checkout parked on the refresh branch, nothing pushed) and
   passes on the new; a second asserts no network call occurs when consent is `never`.

## Invariants this must not break

- **Offline core (1):** push/`gh` only after the approval-flow consent; default `prompt` sends nothing
  until a click.
- **No silent gate (2):** each failure surfaces; "committed but not pushed" is never reported as done.
- **Blast radius (3):** `.minspec/` opt-in marker checked before any write.
- Never stages user-authored files: keep the single-file-pathspec rule (#607).

## Out of scope

- Making harness-refresh PRs pass their gate (#2371); the other Refresh defects (#2325, #2326).
- Changing what files a refresh writes.

## Decisions needed (Clarify)

- **D1 - Unprotected branch: commit directly, or still branch?** (a) **Direct (rec)** matches the
  founder's "answer it on its own" and keeps feature-branch work simple; cost: it commits harness
  files onto whatever feature branch is checked out, mixing them into unrelated work. (b) Always
  branch: never mixes, but opens a PR on every refresh even for a repo that commits to its default
  branch directly; cost: more PRs.
- **D2 - Scope: refresh only, or also the post-init scaffold offer?** (a) **Both (rec)** - one code
  path, one behaviour; cost: widens the change to a first-run flow. (b) Refresh only; cost: the same
  parked-checkout defect remains on init and the two paths diverge.
- **D3 - Config key vs implicit memory.** (a) **Config key `auto|branch|direct|never` (rec)** -
  explicit, visible in settings; cost: one more setting. (b) Reuse only `pushOnApprove` with no new
  key; cost: no way to pin "always direct" or "never commit" for a repo.
