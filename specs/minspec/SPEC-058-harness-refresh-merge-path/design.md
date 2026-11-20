---
id: SPEC-058
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-058 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-009  # Team Readiness - sibling of SPEC-039/SPEC-050's docs-lane ergonomics
relates_to: [SPEC-050, SPEC-039, SPEC-260, DR-078, DR-098, "#885", "#1115", "#1298", "#2371", "#2559"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-058 - Design: a harness-refresh commit reaches `main` through an opened pull request

Plan for [requirements.md](requirements.md). Citations of "today" are against `origin/main`
`6ebb4182`, the commit this plan was last re-checked against (it was first written on
`ef84097b`, before #3841 (scope the scaffold commit to its pathspecs) landed and changed the
commit behaviour P-7 and P-8 rest on). The requirements cite older line numbers; the ones below
were re-read. New code is named by symbol, because its line numbers will move.

## Approach in one paragraph

The branch arm of `offerScaffoldCommit` already moves the commit off the default branch and
then stops (`packages/minspec/src/commands/init.ts:431-451`). This spec adds one step after
that commit: resolve the existing `minspec.pushOnApprove` consent, prove the branch carries
only harness paths, push it with `pushApproval`, and open an unlabelled pull request with
`openPullRequest`. The consent surface is lifted out of the approval recovery path so both
callers share it, the network step goes into a vscode-free function, and `init.ts` keeps only
the toasts. No corpus, workflow or label changes: Clarify chose no auto-merge lane (D-1), so
FR-4 is inert and no task schedules it.

## Already settled by Clarify, not reopened here

requirements.md has no open question. D-1 (no auto-merge lane), D-2 (the #1146 untrack fix has
reached both consumer repos) and D-3 (the tier stays T4) were resolved there on 2026-08-14,
and this plan takes those answers as written. AC-4 is conditional on a widening option and so
has no task.

## Decisions

Clarify left the choices below to Plan. Each was chosen by the planning agent on its
recommendation; not a founder decision. Each can be undone in under a day.

| # | Question | Choice and reason | Rejected alternative |
|---|---|---|---|
| P-1 | FR-2 has two arms: which applies? | **The seam exists, so reuse it.** Since the requirements were written SPEC-050 (silent approval PR) shipped `openPullRequest` (`packages/minspec/src/lib/approval-pr.ts:830`). With `pushApproval` (`packages/minspec/src/lib/approve-push.ts:169`) that covers both steps, so the "build it directly and file a consolidation issue" arm does not apply | Calling `openApprovalPr` (`commit-on-approve.ts:804`): it reads an approval record, computes the `docs-lane` label and words its toast as "Approval pushed", and FR-3 rules out the label |
| P-2 | Where does the new code live? | **A vscode-free `publishHarnessBranch` in `lib/approval-pr.ts`, toasts in `init.ts`.** The approved `implements_reason` says this spec "Creates no new source file", and `approval-pr.ts` is already in `affects:` and already has the runner, `branchChangedPaths` and `openPullRequest` | A new `lib/harness-publish.ts`: tidier, but it contradicts that approved sentence |
| P-3 | How does `prompt` ask? | **A second toast after the commit**, as FR-1 orders it ("after the user accepts `BRANCH_COMMIT_ACTION`, it MUST offer"), with the same show-once "Always push from now on" action and the same project-local store as approvals (DR-078, the project-local push consent record). After that one answer the later refreshes ask nothing. Cost: under `prompt`, two clicks until "always" is chosen | A combined "Commit, push and open PR" action on the first toast: one click, but it reorders what FR-1 states and leaves a local-only choice beside it |
| P-4 | Does `minspec.approvalPr` apply? | **Not read on this path.** FR-1 is unconditional ("`always` ⇒ silent push + PR-open") and that setting's text is scoped to an approval commit (`packages/minspec/package.json:525-538`). Cost: someone who set `manual` for approvals still gets `gh pr create` on a refresh they consented to push | Honouring `manual` here: it breaks FR-1's sentence. SPEC-260 (refresh decides branch or direct, unapproved) proposes this for its own FR-6 and can add it if approved |
| P-5 | Which arms of the offer publish? | **Only the `BRANCH_COMMIT_ACTION` arm**, in both variants, as FR-1's "i.e." states. "Commit here anyway" and the ordinary feature-branch arm stay local | Also publishing from a feature branch: new scope, and that is the user's own work |
| P-6 | Does the checkout return to the default branch? | **No, unchanged.** `createBranch` still switches (`init.ts:323-325`, `git checkout -b`) and the checkout stays on the side branch, with the local branch kept. FR-1 asks for a push and a PR, not a restore. Cost: the parked checkout SPEC-260 FR-4 describes stays until that spec lands | Restoring it here: this is SPEC-260's scope, and its recorded (unratified) D4 selection sequences it after this transport |
| P-7 | Could the push carry something MinSpec did not write? | **Yes, through earlier commits, so prove the branch's diff first.** The commit itself is scoped: `commitOrWarn` calls `committer.commit(message, paths)` (`init.ts:564`), and the default committer runs `git commit -m <message> -- <paths>` over the existing `SCAFFOLD_PATHSPECS` minus ignored paths, refusing rather than falling back to the whole index (`init.ts:287-305`; contract at `init.ts:205-211`, #347 (scaffold commit swept the user's staged work)). So a file the user had staged stays in the index and never enters the commit. But `createBranch` branches from local `HEAD` (`init.ts:323-325`), and `branchChangedPaths` diffs `merge-base(base, HEAD)..HEAD` (`approval-pr.ts:705-741`), so an earlier unpushed local commit on the default branch rides the push. Today that stays local; after FR-1 it leaves the machine. The step takes `branchChangedPaths(run, cwd, 'origin/<default>', 'HEAD')` and refuses to push when any path is outside the allowed set or the range cannot be read, naming the paths. Local only, so it runs before any prompt. Cost: a repo with unpushed non-harness commits on its default branch gets an advisory instead of a push | Pushing only the new commit (for example cherry-picked onto `origin/<default>`): it needs the remote ref to be current and adds a rewrite step that can conflict, while the refusal is one advisory. Also no check at all: an unpushed local commit touching any file reaches the remote with no warning |
| P-8 | What is the allowed set? | **`SCAFFOLD_PATHSPECS` exactly** (a private const at `init.ts:101-143`), the same list the commit is scoped to. Every entry is a file, never a directory (its own comment at `init.ts:113-115` forbids directory entries), so the predicate is exact membership. Using the full static list, not the on-disk subset, also admits an earlier unpushed harness-only commit, such as a stranded "Commit here anyway" refresh, which this push then carries off the machine. Explicit lists only, in keeping with INV-2's spirit. Cost: a user who committed the #1146 (stop tracking machine-local manifests) untrack deletions locally and never pushed them gets an advisory, because those paths are outside the set | Adding `MINSPEC_GITIGNORE_ENTRIES` (`scaffold.ts:303`): the earlier reason, that the untrack deletions ride this commit, held only for a whole-index commit. Under the scoped commit they stay staged and are never committed here, so the entries would only admit paths this flow never writes. Also the on-disk `paths` the offer staged (`collectScaffoldPaths`, `init.ts:150`): it refuses an earlier harness commit that touched a file absent today |
| P-9 | What does `pushApproval` get as `protectedBranches`? | **`[]`.** The guard already chose this branch and MinSpec just created it, so `decidePushPlan` must take `push-current`. A remote that refuses is reported like any other push failure | The real setting: a wrong entry would route to `push-new-branch` and an `approvals/...` name for a harness commit |
| P-10 | How is the consent shared? | **Extract `resolvePushConsent` in `commit-on-approve.ts` from `recoverOnProtectedBranch`** (`:103-137`), with the message and lead action as arguments, and export it. Keeps DR-078 section 4's single accessor | Exporting the four private helpers, or copying them: a second consent copy is the disagreement DR-078 records fixing |
| P-11 | How many toasts? | **One result toast per event.** The branch arm commits quietly and then reports the result, instead of a "committed" toast followed by a second one. Under `prompt` the commit is reported in the prompt itself. #1700 records why two toasts for one event are a defect | Keeping `commitOrWarn`'s toast and adding another |
| P-12 | Can a PR already exist for this head? | **`adoptExisting: true`, no extra probe.** Adoption is what SPEC-050 uses. If a remote-only branch has the same name, the push is rejected and reported with the branch name | Checking the remote before choosing a name: a network call before consent, which breaks invariant 1 |

## Flow

```text
branch arm: createBranch(name), then add + commit scoped to the paths (failure: warn and stop, as today)
  no .minspec/ at the root       -> stop after the commit, advisory (INV-3)
  effective mode
    never                        -> advisory, no action buttons, no network (AC-2)
  checkPublishScope (local)
    outside the set / unreadable -> advisory naming the paths, no network
  mode prompt -> resolvePushConsent
    declined                     -> advisory naming the branch and the push command
  pushApproval(protectedBranches: [])
    failed                       -> advisory with the error; the local branch is kept
  openPullRequest(labels: [], adoptExisting: true)
    gh-absent / gh-unauthenticated / offline / failed
                                 -> advisory: pushed, PR not opened, why, compare URL if known
    created / adopted            -> one toast with the URL, no action
```

The scope check runs before the prompt so nobody is asked to consent to a push that would then
be refused. Every arm ends in a visible message and none throws, keeping `offerScaffoldCommit`'s
never-throws contract (INV-1).

## Contracts

```ts
// lib/approval-pr.ts - vscode-free, never rejects
export type HarnessPublishOutcome =
  | 'pr-opened' // pushed, PR created or adopted; url set
  | 'out-of-scope' // nothing pushed; strayPaths set
  | 'scope-unproven' // nothing pushed; the diff range could not be read
  | 'push-failed' // nothing on the remote; error set
  | 'pr-failed'; // pushed, no PR; prOutcome and compareUrl set when known

export interface HarnessPublishRequest {
  readonly cwd: string;
  readonly branch: string;
  readonly baseBranch: string; // the default branch the offer resolved
  readonly subject: string; // the commit message, used as the PR title
  readonly isAllowedPath: (repoRelPath: string) => boolean;
  readonly run?: ExecRun;
  readonly gitRun?: GitRun;
}

export interface HarnessPublishResult {
  readonly outcome: HarnessPublishOutcome;
  readonly url?: string;
  readonly compareUrl?: string;
  readonly strayPaths?: readonly string[];
  readonly prOutcome?: OpenPrOutcome;
  readonly error?: string;
}

export function publishHarnessBranch(req: HarnessPublishRequest): Promise<HarnessPublishResult>;
export function buildHarnessPrBody(paths: readonly string[]): string; // never names docs-lane as a route

// commands/commit-on-approve.ts - never rejects
export type PushConsent = 'granted' | 'declined' | 'never';
export function effectivePushOnApproveMode(rootDir: string): Promise<PushOnApproveMode>;
export function resolvePushConsent(
  rootDir: string,
  prompt: { readonly message: string; readonly leadAction: string },
): Promise<PushConsent>;

// commands/init.ts - OfferScaffoldCommitDeps gains, for tests
//   publish?: typeof publishHarnessBranch
//   pushConsent?: typeof resolvePushConsent
//   pushMode?: typeof effectivePushOnApproveMode
export function isHarnessPublishablePath(repoRelPath: string): boolean;
```

## Where the requirements' frontmatter and text have aged

requirements.md is hash-locked and no task edits it. A builder should read these as corrections:

- `affects:` names `docs-corpus.ts` and `docs-lane.yml`, and neither changes, because FR-4 is
  inert. It omits `packages/minspec/src/commands/init.ts`, the file where FR-1 lands, though
  the FRs name its functions.
- Context says SPEC-050 is unbuilt. Its tasks.md is reconciled against shipped code and
  `openPullRequest` is on `main`.
- `offerScaffoldCommit` is now `init.ts:387-465`, not `:360-431`.
- Context and D-1 place `commit(message)` at `init.ts:308-310` and call it a whole-index commit.
  Since #3841 the committer's `commit(message, paths)` is scoped (`init.ts:287-305`) and
  `commitOrWarn` passes the paths (`init.ts:564`). D-1's verdict still stands, since a refresh
  commit still carries machinery paths, but its rebuttal of Option C now holds for a different
  reason: the untrack deletions do not ride this commit at all.

## Risks

| Risk | Handling |
|---|---|
| FR-1 opens the PR but it still cannot merge: open bug #2371 (harness refresh ships voter-reuse code without its tests) says every adopter's refresh PR is blocked at `ai-review:changes` | Not fixed here. FR-1 ends at the opened PR and AC-1 asserts that. #2371 decides whether the PR is mergeable, and the PR body (task 3) states that a human merges it |
| `origin/<default>` is stale or missing | A stale ref still gives the merge base with `HEAD`, so at worst it reports commits that are not on the stale ref as strays and refuses. A missing ref gives `scope-unproven`, visibly, and nothing is pushed |
| SPEC-260 later changes this same arm | Its recorded D4 selection sequences it after this transport, and `publishHarnessBranch` takes the branch by name, so it does not depend on the checkout position |
| Open PR #3316 (SPEC-068 plan, refresh direction gate) also plans `init.ts` edits | Its plan touches the override flow and summary toast, not `offerScaffoldCommit`; a textual conflict at most |

## Decision record

None needed. Every choice above can be undone in under a day, and the network act reuses the
consent DR-078 and FR-1 already govern. The dependency budget is 0 new packages.

## Follow-ups (tracked)

None. FR-2's consolidation issue applies only to the arm P-1 did not take.
