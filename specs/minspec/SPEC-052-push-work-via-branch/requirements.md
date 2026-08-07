---
id: SPEC-052
type: requirements
title: "Push work via branch" — land non-docs changes from a dirty primary checkout
# `status`/`phases` are tool-written lifecycle mirrors (canonical.ts strips them from the
# hash); once "MinSpec: Approve Spec" has run, never hand-write either.
#
# `specifying` alongside `clarify: done` is CORRECT, not drift: deriveStatus returns
# 'specifying' for ANY unapproved spec regardless of how far its phases have advanced
# (lifecycle.ts:115, INV-1 — "unapproved cannot pass"). It becomes 'planning' only once an
# approval sidecar exists. An ai-review pass on PR #1318 read the pair as a misleading
# signpost; it is the derived value. Left here so the next reader does not re-flag it.
status: planning
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness — docs-lane push ergonomics; grain (c), the non-docs sibling of SPEC-039's grain (a)
aspects: [pull-request, consent, tier-1, hitl, g8-git-transparency, worktree, session-coordination]
relates_to: [SPEC-039, SPEC-026, SPEC-050, DR-051, DR-065]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-052 — "Push work via branch" command

## Context

Two guards close in from opposite sides on a primary checkout that is dirty with
**non-docs** work:

- The primary-checkout guard refuses `git switch -c` there, because concurrent
  sessions share that HEAD and moving it rewrites the working tree under them
  (the problem SPEC-026 exists for, and global rule #8).
- The generated `.minspec/hooks/pre-commit` branch guard refuses a commit on the
  default branch, because a commit there cannot be pushed and strands the work.

Both guards are correct. Together they leave **no one-step path** for changes
that are already sitting dirty in the primary checkout. SPEC-039 solved exactly
this for the docs corpus — *MinSpec: Push docs via lane* (`Ctrl+K Ctrl+P`) copies
the changed docs into a throwaway worktree off `origin/main`, commits there,
and opens the labelled PR without ever moving the primary's HEAD or index. Its
corpus predicate deliberately refuses everything else, so code and harness
changes have no equivalent.

Today the workaround is a four-step manual sequence — export the diff, add a
worktree, apply it there, commit — which a maintainer has to remember and type
correctly under exactly the conditions (a dirty tree, a blocked commit) where
mistakes are most expensive. It was performed by hand on 2026-08-06 to rescue a
stuck harness refresh (AIClarityAU/scroogellm#134).

This spec is grain (c) of the same ergonomics: the **general** case, gated by a
normal PR rather than by auto-merge.

## Non-goals

- **Not an auto-merge lane.** Code must never ride `docs-lane`; that is enforced
  server-side and this command must not attempt it. A PR opened here carries the
  ordinary required checks, including `ai-review`.
- **Not a replacement for the harness commit offer.** Harness output already has
  its own offer (and *MinSpec: Commit harness refresh* to recover a missed one).
  This is for everything else.
- **Not a sweep.** It never decides on the user's behalf which dirty files belong
  together — see FR-3.

## Functional Requirements

- **FR-1** Command `minspec.pushWorkBranch`, titled *MinSpec: Push work via
  branch*, in the Command Palette, with a two-key chord keybinding displayed
  alongside it. Proposed chord `Ctrl+K Ctrl+B` / `Cmd+K Cmd+B`, to sit beside
  SPEC-039's `Ctrl+K Ctrl+P`; the Clarify phase confirms it does not collide with
  a VS Code default or another contributed binding.

- **FR-2** On invoke, gather the working tree's changed paths — staged, unstaged
  and untracked alike, since a blocked commit leaves work in any of the three.

- **FR-3** **The user chooses what travels.** Present the changed paths in a
  multi-select QuickPick, all deselected by default, and copy only what is
  selected. A shared checkout routinely holds more than one session's work
  (SPEC-026's premise), so a whole-tree sweep would bundle a stranger's
  in-progress edits into this PR. This is the load-bearing difference from
  SPEC-039, whose corpus predicate is itself the filter.

- **FR-4** Offer a sensible default selection *without applying it*: paths that
  differ from `origin/main` and are not claimed by another session's presence
  record (SPEC-026) are pre-highlighted in the picker, not pre-ticked.

- **FR-5** Before any network call, a confirmation surfaces (a) the exact file
  list, (b) the branch name, (c) that this opens a pull request, which is a
  network action. No wire traffic before that consent.

- **FR-6** On confirm: create a temporary worktree off `origin/main`, copy the
  selected files into it, commit with a prompted message (default derived from
  the selection), push branch `work/<slug>-<shortsha>`, and open a normal PR —
  **no** `docs-lane` label, **no** auto-merge. Remove the worktree in a `finally`.
  Success toast shows the PR URL and can open it.

- **FR-7** The primary checkout is left exactly as found: the selected files stay
  dirty there. Landing the PR and pulling is what cleans them, and a tree whose
  content already matches the merged commit goes clean on its own. The command
  never restores, resets, stashes, or unstages anything.

- **FR-8** Offer, but never perform by default, a follow-up "clean up the copied
  files in my working tree" action once the PR has merged. Destructive, so it is
  opt-in per invocation and never remembered.

- **FR-9** Graceful degrade to a typed advisory toast, never a thrown exception:
  not a repo, detached HEAD, no `origin`, nothing changed, nothing selected, `gh`
  absent, `gh` unauthenticated, offline, push rejected, PR creation refused.

- **FR-10** When every selected path is inside the docs corpus, say so and point
  at *MinSpec: Push docs via lane* instead — that route auto-merges and this one
  does not, so silently opening the slower PR would be a worse outcome the user
  never asked for. Offer to switch; never switch silently.

## Invariants (T0 — tests first)

- **INV-1 (constitution #1 — offline/consent).** No network call happens until the
  user has both invoked the command and confirmed FR-5. Every pre-confirm probe
  (`rev-parse`, `symbolic-ref`, `status --porcelain`, `remote get-url`) is local.

- **INV-2 (primary untouched).** No `checkout`, `switch`, `commit`, `reset`,
  `stash`, `add`, or `restore` ever runs in the primary checkout. Permitted there:
  read-only probes, `fetch` (updates a remote-tracking ref, not HEAD or the index),
  and `worktree add` / `worktree remove` (separate directory, separate index).
  This is SPEC-039 INV-3, restated because it is the whole reason the command can
  exist at all next to the primary-checkout guard.

- **INV-3 (selection is authoritative).** Exactly the selected paths are copied and
  committed. Never a superset — no glob expansion, no "and its directory", no
  sibling file dragged in by a copy helper.

- **INV-4 (never the docs lane).** The `docs-lane` label is never applied and
  auto-merge is never enabled by this command, whatever the selection contains.

- **INV-5 (never throws).** The whole body is wrapped; every failure degrades to a
  typed result surfaced as a toast.

- **INV-6 (worktree always reclaimed).** The temporary worktree is removed on every
  exit path, including failure and cancellation, and its removal failure is
  reported rather than swallowed.

## Acceptance Criteria

- **AC-1** With a dirty primary checkout on the default branch and a selection
  made, the command opens a PR whose diff is exactly the selected files, and
  `git rev-parse HEAD` in the primary checkout is unchanged before and after.
- **AC-2** Cancelling at the FR-5 confirmation performs zero network calls
  (asserted against an injected command runner, not by observation).
- **AC-3** A selection of two files out of five dirty ones produces a PR touching
  two files.
- **AC-4** No invocation ever produces a PR carrying the `docs-lane` label or with
  auto-merge enabled.
- **AC-5** Every failure mode in FR-9 produces a distinct typed outcome and a
  toast, and the test suite asserts no rejected promise escapes.
- **AC-6** After a failure injected mid-commit, no worktree remains under the
  worktrees root.
- **AC-7** An all-docs selection surfaces the FR-10 redirect and does not open a
  PR unless the user declines the redirect.
- **AC-8** Invoking twice in one session presents an all-deselected picker the
  second time (OQ-2): a path deselected in run 1 is not pre-ticked in run 2.
- **AC-9** With no SPEC-026 presence data available, the picker still renders and
  highlights `origin/main` differences, and no label asserts session ownership
  (OQ-3's degraded mode is a supported state, not a failure).
- **AC-10** Invoked from a non-default branch, the confirmation names that fact
  (FR-11) and the command still completes on confirm.

## Resolved Questions (Clarify, 2026-08-07)

- **OQ-1 — off-default-branch: stay available. RESOLVED.** The peel-a-subset case
  is real (you are on a feature branch and want to split unrelated work out), and
  every guard rail is identical there: explicit selection, worktree isolation,
  primary untouched. Refusing would make availability depend on repo state the
  user has to reason about before invoking, and the cost of allowing it is one
  extra branch and PR — benign and self-evident. **FR-11 added:** when HEAD is not
  the default branch, the FR-5 confirmation says so, since a user who could simply
  commit should be told that is the cheaper route before consenting to a PR.

- **OQ-2 — do not persist the selection. RESOLVED.** The costs are asymmetric.
  Re-ticking a few boxes after an interruption is small and bounded; silently
  re-applying a remembered selection re-includes work the user deliberately
  excluded — the exact failure FR-3 exists to prevent — and does it without the
  user re-reading the list. A deselection is a deliberate act about *someone
  else's* work, so it must not survive as invisible state. What may persist is the
  picker's ordering and FR-4 highlighting, which are free and carry no decision.

- **OQ-3 — ship FR-4 without SPEC-026's presence records. RESOLVED.** FR-4 only
  *highlights*; FR-3 alone governs what travels, so the filter's absence cannot
  produce a wrong commit — only a less helpful picker. Blocking a self-contained
  command on an unrelated multi-session feature would be a dependency bought for
  nothing. **FR-4 restated below** to make the degraded mode explicit rather than
  implied: with no presence records, highlight means "differs from `origin/main`",
  and the command must never imply it knows more than that.

- **OQ-4 — yes, a short DR, written at Plan. RESOLVED.** Not for the command,
  which is additive and reversible well inside a day, but for the *precedent*:
  this establishes a **second** sanctioned route for moving work off a shared
  checkout, and DR-065 governs the first. Without a record of where the boundary
  sits, the next reader of DR-065 concludes presence-gated fast-forward is the
  only sanctioned mechanism, and then either duplicates it or contradicts it. The
  DR's subject is that boundary, not this command's design — so it belongs at
  Plan, once the mechanism is settled. Tracked as a follow-up below.

## Clarified Requirements

These supersede the same-numbered items above.

- **FR-1 (keybinding narrowed).** `Ctrl+K Ctrl+B` / `Cmd+K Cmd+B` is free of any
  MinSpec-contributed binding — the extension contributes exactly three
  (`alt+a` approveActive, `alt+n` nextTask, `ctrl+k ctrl+p` pushDocsLane), verified
  in `packages/minspec/package.json`. It sits deliberately beside `Ctrl+K Ctrl+P`,
  so the two lane commands share a prefix. **Not** verified against VS Code's own
  defaults or another extension's bindings, which needs a running editor —
  Plan must check *Preferences: Open Keyboard Shortcuts* for a conflict and, if
  found, fall back to `Ctrl+K Ctrl+W` (work) before implementation.

- **FR-4 (degraded mode made explicit).** Pre-highlight paths that differ from
  `origin/main`. When SPEC-026 presence records are available, additionally
  de-highlight paths another session has claimed. Neither signal ever ticks a box.
  Where presence data is absent the picker must not imply it knows who owns what —
  no "yours"/"theirs" labelling, only the plain `origin/main` difference.

- **FR-11 (new).** When HEAD is not the repo's default branch, the FR-5
  confirmation states that plainly and notes that committing directly is available
  — the command still proceeds if the user confirms. Informative, never a refusal.

## Follow-ups (tracked)

- **#1316** — this spec's tracking issue.
- **#809** — sweeps stranded *committed* work on primary main. Complementary, not
  overlapping: that issue is about commits that already exist and cannot push,
  this spec is about work that was never committable in the first place. Neither
  subsumes the other, and both should land before the shared-checkout story is
  whole.
- **#1370** — the OQ-4 decision record, to be written at Plan: the boundary
  between this command and DR-065's presence-gated fast-forward. Filed rather than
  left as prose so the obligation is materialized (DR-023 forward rule).
