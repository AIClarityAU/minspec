---
id: SPEC-470
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - the scaffolded harness (CLAUDE.md + pre-commit hook) is the SDD scaffold
aspects: [protected-branch-guard, scaffold, templates, branch-lifecycle, guidance, tier-0]
relates_to: ["#1563", "#1041", "#1064", "#1115", DR-080, SPEC-057, SPEC-032, SPEC-260]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-470: The protected-branch guard says what happens after the refusal - the branch is expected to land

> **SPECIFICATION ONLY.** Written for [#1563](https://github.com/AIClarityAU/minspec/issues/1563)
> by a Specify-phase dispatch. Nothing is built from it until a human reads it, answers
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the normal
> spec-approval gate. No DR: every change here is shipped prose and one hook message, which
> can be reverted in well under a day (the DR-359 ADR filter).

## In plain terms

MinSpec ships a guard that refuses a commit on the default branch. It tells you how to get
onto a branch, and how to bypass it. It never tells you that the branch is meant to be merged
back. So a project can do what the guard asked - make one branch - and then live on it for
good, with `main` frozen at the scaffold commit. This spec adds the missing sentence in the
two places a person or agent meets the guard: the refusal message, and the scaffolded
`CLAUDE.md` section that documents the guard.

## One-Sentence Scope

Add descriptive branch-lifecycle guidance (the branch is expected to be landed on the default
branch and then left, and concurrent sessions each need their own working copy) to the
protected-branch guard's refusal message and to the scaffolded `CLAUDE.md`'s guard section,
and defer the staleness detector (issue ask 2) to a decision below.

## Context

Grounded in the code on this branch (base `origin/main`, the worktree for #1563).

- **The refusal stops at "not here".** The shipped hook's refusal text is the pre-commit hook template's
  `minspec_branch_guard()` in `packages/minspec/src/lib/template-registry.ts:1390-1404`.
  It names the default branch, says the commit could not be pushed, gives
  `git switch -c <branch-name>`, gives the "already committed" rewind recipe, and names both
  bypasses (`MINSPEC_ALLOW_MAIN=1`, `git config minspec.allowCommitOnDefaultBranch true`).
  It says nothing about what to do with the branch afterwards.
- **The scaffolded `CLAUDE.md` documents the guard, not the branch.** The template
  (`template-registry.ts:178`, `CLAUDE_MD_TEMPLATE`) has a `Pre-Commit Checks` section
  (`:440`) with a gate table (`:456`) and a `### Protected-branch guard` subsection
  (`:467-494`). That subsection explains why the guard exists, when it is silent, and how to
  turn it off. It does not say the branch should be landed.
- **"worktree" appears twice in `template-registry.ts`** (`:522`, `:1425`), both in the
  author-identity gate's note that `git config` covers every worktree. Neither is
  branch-lifecycle guidance. The issue body says zero times; the count is two, but the
  conclusion stands: there is no guidance on concurrent sessions or on landing a branch.
- **The extension's refusal arms do not carry the switch-a-branch guidance at all.**
  `commit-on-approve.ts:260` (`protected-branch` on Approve) now auto-recovers into a
  throwaway worktree (DR-080), so it never leaves the user on a long-lived branch.
  `commit-on-approve.ts:1124` (born commit) only `console.warn`s. The stranding in #1563
  came from the hook path, where a human or agent commits from a terminal.
- **Neighbouring specs and what they do not cover.**
  - [SPEC-057](../SPEC-057-stranded-branch-detection/requirements.md) detects the default
    branch being *ahead of its upstream* (unpushed commits on `main`). #1563 is the opposite
    shape: `main` has nothing new and the work is on another branch that is never merged.
    SPEC-057 OQ-2 deliberately excludes feature branches.
  - [SPEC-032](../SPEC-032-forgotten-merge-discovery/requirements.md) (`status: implementing`,
    no code found: `grep -rli forgotten packages/minspec/src` returns no discovery module)
    enumerates local and `origin/*` branches not merged into the default and rates them
    `stale/behind`. Its candidate set already includes the #1563 branch. But its FR-1 starts
    with `git fetch --prune`, which is a network call, and it says nothing about a branch
    with no upstream.
  - [SPEC-260](../SPEC-260-harness-refresh-decides-branch-and-finishes-pr/requirements.md)
    fixes the same create-without-landing shape for the harness-refresh branch. This spec
    does not touch that path.

**Core gap (one sentence):** a person or agent meeting the guard learns how to leave the
default branch, but nothing they read says the branch is supposed to come back.

## Functional Requirements

- **FR-1 (refusal names the next step).** The shipped pre-commit hook's protected-branch
  refusal gains a short block, after the `git switch -c` recipe and before the bypass lines,
  stating that the branch is expected to be landed on `<default>` (by pull request or merge)
  and then left, and that a long-lived branch leaves `<default>` stale. `<default>` is the
  resolved default branch name the message already prints (`$guard_current`). At most three
  added lines.
- **FR-2 (refusal still refuses).** FR-1 changes text only. The guard's exit status, its
  silence conditions (merge/cherry-pick/revert/rebase in progress, detached HEAD, no remote,
  unknown default) and its bypasses are unchanged. `approve-commit-hook-parity.test.ts`
  continues to pass unmodified in its scenario table.
- **FR-3 (scaffolded CLAUDE.md: landing the branch).** The `### Protected-branch guard`
  subsection of `CLAUDE_MD_TEMPLATE` gains a short paragraph (budget: at most 10 lines of
  rendered prose) that says, descriptively:
  1. the guard expects work to happen on a branch that is then landed on the default branch,
     however this project lands work (pull request, merge, rebase);
  2. after landing, return to the default branch and start the next piece of work from it;
  3. the guard is not a reason to live on one branch, and a default branch that never
     advances means landed work has stopped happening;
  4. concurrent sessions (two editors, or a person and an agent) committing in one checkout
     will disturb each other's branch and index, so each needs its own working copy;
     `git worktree add` is one way to get one. Phrasing per Clarify D2.
- **FR-4 (no new top-level section).** FR-3 lands inside the existing guard subsection, not
  as a new `##` section, so the scaffolded file's outline does not grow (the issue's stated
  cost: a CLAUDE.md that is already growing).
- **FR-5 (reaches existing adopters).** The change reaches already-scaffolded projects
  through the same path the guard subsection already uses (*MinSpec: Refresh Harness Files*).
  Plan must confirm which mechanism carries `CLAUDE_MD_TEMPLATE`'s guard subsection to an
  existing repo (a `minspec:managed:` region, per `template-registry.ts:938-942`, or a
  whole-file template), and state it with a `file:line`. Unverified at Specify: I have not
  traced whether that subsection sits inside a managed region.
- **FR-6 (both messages agree).** The hook text (FR-1) and the CLAUDE.md paragraph (FR-3)
  state the same expectation. A test asserts both rendered outputs contain the same landing
  statement, so one cannot be edited without the other failing (the "duplicated predicates
  drift" class).

## Invariants

- **INV-1 (offline - constitution invariant 1).** Nothing here adds a git command, network
  call or forge lookup. FR-1 is `echo` lines in an existing refusal branch; FR-3 is template
  prose.
- **INV-2 (no silent gate - constitution invariant 2).** The guard still fails closed and
  visibly on the default branch. No added line may be written so that a failure in it (for
  example an unset variable under `set -u`) changes the guard's exit status or suppresses the
  refusal.
- **INV-3 (blast radius - constitution invariant 3).** The guidance is scaffolded only into
  a repo that has opted in (has `.minspec/`), as the rest of `CLAUDE_MD_TEMPLATE` is. It is
  descriptive: it says what the guard expects, and does not instruct a project to adopt a
  branching model, a worktree layout, or a merge strategy.
- **INV-4 (hook and extension guard parity).** No change to `resolveBranchDestination`
  (`approve-commit.ts:340`) or `minspec_branch_guard`'s decision logic. Only the refusal
  wording changes.

## Acceptance Criteria

- **AC-1 (FR-1).** Running the scaffolded pre-commit hook on the default branch, with a
  remote and no bypass, prints the landing block naming the actual default branch, and exits
  non-zero. Asserted on captured stderr and the exit code.
- **AC-2 (FR-2, INV-2, INV-4).** `approve-commit-hook-parity.test.ts` passes with its
  scenario table unchanged; every silent case still exits 0 and prints nothing.
- **AC-3 (FR-3, FR-4).** The rendered `CLAUDE.md` from a fresh scaffold contains the landing
  paragraph inside `### Protected-branch guard`, adds no new `##` heading, and the paragraph
  is at most 10 lines.
- **AC-4 (FR-6).** A test extracts the landing statement from both the rendered hook and the
  rendered `CLAUDE.md` and asserts they match; mutating either one fails the test (checked by
  a deliberate mutant, not by inspection).
- **AC-5 (FR-5).** On a fixture repo scaffolded from the current template, *Refresh Harness
  Files* brings in the new paragraph, or Plan records with a citation why it cannot and what
  carries it instead.
- **AC-6 (INV-3).** Reviewer check: the added prose contains no imperative to use worktrees,
  a specific merge strategy, or a branching model. The worktree mention is framed as one way
  to give each concurrent session its own working copy.

## Decisions needed (Clarify)

- **D1 - Staleness detector (issue ask 2): where does it live?**
  - **(a) (rec)** Not in this spec. Hand it to SPEC-032 as a Clarify amendment there: an
    offline, local-refs-only mode (no `git fetch`) that reports a local branch with commits
    not on the default branch, and a branch with no upstream. SPEC-032 already enumerates
    exactly this candidate set and owns the signpost section for it. *Cost:* SPEC-032 has no
    code yet, so the signal in #1563 stays unbuilt until SPEC-032 is built; and SPEC-032's
    fetch-first design has to accept an offline mode, which is a change to an approved spec.
  - **(b)** Add an FR here for a small offline check (local branch ahead of default, no
    upstream) shown in the signpost. *Cost:* a third branch-state detector beside SPEC-057
    and SPEC-032, with its own nag rules to keep in step with theirs.
  - **(c)** Drop it. *Cost:* the guidance in FR-1/FR-3 is prose, which drifts and is read
    once; nothing would catch the #1563 state if the prose is ignored.
- **D2 - How the worktree point is worded in FR-3.**
  - **(a) (rec)** Descriptive: concurrent sessions in one checkout disturb each other, so
    each needs its own working copy, and `git worktree add` is one way. *Cost:* softer; a
    reader who skims may still share one checkout.
  - **(b)** Prescriptive: "one session, one worktree". *Cost:* dictates a version-control
    practice to a repo that installed a spec tool (the issue's own invariant-3 concern), and
    is wrong for stash-based or single-branch workflows.
  - **(c)** Leave concurrency out and say only "land the branch". *Cost:* leaves the
    one-session-one-worktree knowledge undocumented in any shipped artifact, which the issue
    names as a gap.
- **D3 - The audit gap the issue names (conventions held only in personal config).** The
  self-hosting drift audit compares this repo's artifacts with the shipped templates, so it
  cannot see a convention written down in neither place. That is a change to a different
  audit, not to the guard.
  - **(a) (rec)** Track it as its own issue, outside this spec. *Cost:* someone has to file
    it; this dispatch has no tracker access, so it stays unfiled until the human (or the
    publishing step) does.
  - **(b)** Add it to this spec. *Cost:* widens a prose-and-message change into an audit
    redesign, the scope creep CLAUDE.md triage rule 2 warns about.

## Out of scope

- The staleness detector itself (D1).
- Changes to the extension's Approve-path refusal and recovery (`commit-on-approve.ts:260`,
  DR-080): that path already recovers into a throwaway worktree and does not strand work on
  a branch.
- The harness-refresh branch landing (SPEC-260).
- The self-hosting drift audit's blind spot (D3).
- This repo's own `CLAUDE.md`: it is not the scaffolded template, and its worktree rule is
  a separate, project-local convention.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Shipped prose reads as MinSpec dictating git workflow (invariant 3) | INV-3, AC-6, D2 descriptive wording |
| R2 | The CLAUDE.md template keeps growing | FR-4 (no new section), FR-3 10-line budget |
| R3 | Hook text and CLAUDE.md text drift apart | FR-6 / AC-4 matching test with a mutant |
| R4 | Prose alone does not stop the #1563 state recurring | Named honestly; D1 decides the detector that would |

## Traceability

- **Issue:** [#1563](https://github.com/AIClarityAU/minspec/issues/1563).
- **Guard history:** #1041 (pre-commit protected-branch guard), #1064 (extension-side
  refusal), #1115 / [DR-080](../../../docs/decisions/DR-080.md) (Approve-path recovery).
- **Related specs:** [SPEC-057](../SPEC-057-stranded-branch-detection/requirements.md)
  (default branch ahead of upstream), [SPEC-032](../SPEC-032-forgotten-merge-discovery/requirements.md)
  (unmerged-branch discovery; D1 target), [SPEC-260](../SPEC-260-harness-refresh-decides-branch-and-finishes-pr/requirements.md)
  (harness-refresh branch landing).
- **Follow-ups (tracked):** D1 and D3 are recorded here as Clarify decisions; whichever
  option is chosen is materialized at Clarify (an amendment to SPEC-032 for D1a, an issue for
  D3a).
