---
id: SPEC-469
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology (dev-infrastructure hygiene)
aspects: [worktrees, dispatch, infra, hygiene]
relates_to: ["#1397", "#1393"]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-469: One worktree root, off `/tmp`, with a guarded sweep

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads it, answers [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the normal spec-approval gate before any code changes.

Materializes **#1397** (49 registered worktrees across two case-variant roots; 14 in container-internal `/tmp`).

## Problem (measured in #1397, 2026-08-07, not re-measured here)

49 registered worktrees: 15 under `~/code/.worktrees/minspec`, 12 under `~/code/.worktrees/MinSpecPro` (the standard), 14 under `/tmp/minspec-agent`, 6 under `.claude/worktrees`, 2 elsewhere. `git worktree prune --dry-run` is empty, so all exist today.

Mechanisms (read from code):
- `scripts/new-worktree.sh:28-31` derives the root from `basename` of the main checkout, so the root name follows whatever the clone directory is called. A clone named `minspec` yields `.worktrees/minspec`; one named `MinSpecPro` yields `.worktrees/MinSpecPro`. Nothing canonicalises the name, which is how two case variants of one repository arose.
- `scripts/dispatch-issue.sh:22` hard-codes `WORKTREE_BASE="/tmp/minspec-agent"` and `scripts/lib/issue-lease.sh:47` defaults `MINSPEC_LEASE_WORKTREE_BASE` to the same path. `/tmp` is container-internal and does not survive a restart, so each registration there becomes dangling on the next boot.
- No gate or sweep reports duplicate roots or `/tmp` registrations; the condition is only visible by running `git worktree list` by hand.

## Scope

In: worktree root naming in `scripts/new-worktree.sh`; the dispatch base path; a read-only audit; a guarded sweep. Out: `.claude/worktrees` (harness-owned, auto-removed); deleting any worktree without the guard in FR-5; changing worktree-per-session policy.

## Functional requirements

1. **FR-1 Canonical root name.** `new-worktree.sh` MUST resolve one repo-name segment that is independent of the clone directory's spelling (see Decision 1), so two case variants never yield two roots. Existing roots are not moved by this FR.
2. **FR-2 Dispatch off `/tmp`.** The dispatch worktree base (`dispatch-issue.sh`, `issue-lease.sh` default) MUST default to a path under the standard root that survives a restart (see Decision 2). The environment override `MINSPEC_LEASE_WORKTREE_BASE` keeps working; both scripts MUST read the same single definition so they cannot drift.
3. **FR-3 Read-only audit.** A command MUST list registered worktrees grouped by root and flag: (a) roots that differ only by case, (b) registrations under `/tmp`, (c) registrations whose path is missing on disk. It MUST NOT modify anything and MUST exit non-zero when (a) or (b) is found, so the signal is not silent (invariant 2).
4. **FR-4 Safe relocation.** Moving a lowercase-root worktree to the standard root MUST use `git worktree move`, never `mv`, and MUST refuse a tree with a live session lease (`issue-lease.sh`) or an existing destination.
5. **FR-5 Guarded sweep.** Removal of a worktree MUST require all of: `git status --short` empty (including untracked and staged), tip reachable from `origin/main` (content identity checked, not just `cherry`), no live lease, and not the caller's own tree. Any check that errors counts as a failure of that check and the tree is kept, with the reason printed. Default is dry-run; deletion needs an explicit flag.
6. **FR-6 Case-insensitive safety.** The audit and relocation MUST compare paths case-folded, so behaviour on a case-insensitive filesystem equals behaviour here.

## Acceptance criteria

- AC-1: two clones of one repo named `minspec` and `MinSpecPro` produce the same worktree root from `new-worktree.sh`.
- AC-2: with no env override, dispatch creates its worktree outside `/tmp` and under the standard root; with the override set, the override wins.
- AC-3: audit against a fixture with case-variant roots and a `/tmp` entry exits non-zero and names each; against a clean fixture exits 0.
- AC-4: sweep dry-run on a fixture with one dirty, one unmerged, one leased, one clean-merged tree lists exactly the last as removable and removes nothing; with the flag removes only it.
- AC-5: a tree 0 commits ahead of main but holding untracked files is kept.
- AC-6: a tree whose status check errors is kept and reported, not removed.

## Invariants the change must not break

- Offline: no network call (constitution invariant 1).
- No silent gate: audit failures and errored checks are visible and fail closed (invariant 2).
- Blast radius: touches only this repo's scripts and `.worktrees/` layout; nothing machine-wide (invariant 3).
- Never delete or move a worktree owned by a live concurrent session (worktree-per-session rule).

## Decisions needed (Clarify)

1. **Canonical root name.**
   - (a) **Fixed literal from `.minspec/` config, falling back to the lowercased basename** (rec): deterministic across clones. Cost: one more config key, and existing `MinSpecPro` worktrees need relocating to match.
   - (b) Keep `basename` of the checkout, but lowercase it. Simpler, but a rename of the clone silently forks the root again.
   - (c) Keep current behaviour and only audit. Leaves the ambiguity to regenerate.
   Note: the issue calls `MinSpecPro` "the standard"; (a)/(b) would make lowercase canonical instead, or the literal can be set to `MinSpecPro`. Which spelling wins is yours.
2. **Dispatch base location.**
   - (a) **`~/code/.worktrees/<root>/agent/`** (rec): survives restart, same place humans look. Cost: agent trees mix with human trees in one directory tree, and the container must have that path mounted writable (unverified here).
   - (b) A separate persistent dir such as `~/code/.worktrees-agent/`. Cleaner split, one more root to audit.
3. **Delivery order.** Issue recommends dispatch path first, then relocation when quiet. (rec) Ship FR-1/FR-2 first, FR-3 audit second, FR-4/FR-5 sweep last, run only when few sessions are live. Cost: the 41 existing entries stay until the sweep runs.
4. **Where the audit lives.** (rec) Extend `scripts/check-primaries-clean.sh` neighbours as a new standalone script; alternative is folding it into an existing check. Cost of rec: one more script to keep in step.
