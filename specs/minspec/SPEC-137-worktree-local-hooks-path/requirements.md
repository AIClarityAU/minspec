---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - session coordination / git transparency; worktree-per-session (#168) is the convention this makes honest
aspects: [git-hooks, worktree, core-hooksPath, silent-gate, verification-loop]
depends_on: [DR-037, DR-066]
relates_to: ["#1277", "#1263", "#168", "#2671", "#2406", SPEC-057]
---

# SPEC-137: Worktree-local git hooks path

Issue: #1277 (absolute `core.hooksPath` makes every worktree run the primary's hooks).
Design rationale: DR-037 (the git hooks), DR-066 (no silent gate). No new DR is proposed:
every choice below is reversible in under a day (a one-line config value).

## In plain terms

Git config is shared by all worktrees of a repo. If `core.hooksPath` holds an absolute path
to the primary checkout, a worktree that edits `.githooks/*` still runs the primary's copy,
so the edit cannot be exercised by committing or pushing from that worktree. This happened
live on #1263: a fixed `pre-push` sat in the worktree while the old buggy copy refused the
push. The primary's working tree also becomes load-bearing for every concurrent session.

## What was measured (read from the repo, 2026-10-16)

- The repo already tries to install the RELATIVE value: `scripts/prepare.mjs` runs
  `git config core.hooksPath .githooks`; `CLAUDE.md` (Pre-Commit Checks, rule 3) and
  `.githooks/pre-push:20` say the same. So the absolute value reported in #1277 is
  **configuration drift written by some other producer**, not what `prepare` writes. The
  producer is not identified by this spec - finding it is Plan-phase work (FR-5).
- `scripts/hooks/session-hooks-path.sh` (#2671) already compares the value to `.githooks`
  at session start and prints a warning when it differs. It does not repair, it is
  advisory and non-fatal, and nothing at commit or push time checks the value.
- Option 3 of the issue is partly done: `pre-push-range.test.ts` (#1263) and, since
  `pre-commit-hook-behaviour.test.ts` (header cites #1277 option 3) drive the hook files directly.
  `commit-msg` has no equivalent direct behaviour test that I found (unverified beyond a
  filename search - Plan must confirm).
- I believe git resolves a relative `core.hooksPath` against the directory the hook runs
  in (the worktree top level for a linked worktree), per git-config(1). Unverified here;
  FR-6 makes it a measured acceptance check rather than an assumption.

## One-Sentence Scope

Make each worktree run its own `.githooks/*`, by detecting and repairing an absolute or
foreign `core.hooksPath`, and prove it with a test that exercises a real linked worktree.

## Functional Requirements

- **FR-1 (relative is the contract).** The supported value of `core.hooksPath` for this
  repo is the relative string `.githooks`. `prepare` already writes it; that stays.
- **FR-2 (repair).** `npm run prepare` rewrites any other value (absolute path, path into
  another checkout) to `.githooks`, and prints what it replaced. A failed write exits
  non-zero (existing behaviour, `scripts/prepare.mjs`; do not weaken).
- **FR-3 (second witness stays independent).** The session-start witness
  (`session-hooks-path.sh`) keeps reading the live config, and its message distinguishes
  "unset" from "absolute / points at another checkout", naming the worktree-shadowing
  consequence. It remains non-fatal to session start but never silent (invariant 2).
- **FR-4 (commit-time witness).** A hook-side check, not only a session-start one, fails
  visibly when the effective hooks path resolves outside the current worktree's own
  `.githooks`, with the repair command in the message. Whether this is a refusal or a loud
  warning is Decision D-1.
- **FR-5 (find the producer).** Plan identifies what writes the absolute value (worktree
  creation script, session bootstrap, a tool) and fixes that producer, so FR-2 is not the
  only line of defence. Per the RCDD rule, a data repair without the producer fix is not
  accepted as done.
- **FR-6 (linked-worktree proof).** A test creates a real repo plus a linked worktree
  (`git worktree add`), sets `core.hooksPath=.githooks`, places a distinguishable hook in
  each tree, and asserts that a commit from the worktree runs the WORKTREE's hook. A
  control case sets the absolute primary path and asserts the primary's hook runs, so the
  test fails when the property is absent (not vacuous).
- **FR-7 (direct hook tests complete).** Every file in `.githooks/` has a direct
  behaviour test that invokes the file in a temp repo. Gap to close: `commit-msg` if Plan
  confirms it has none. This is the durable part regardless of FR-1 to FR-4 (issue option 3).
- **FR-8 (document the residual).** `CLAUDE.md` Pre-Commit Checks states that hook edits
  must be verified by invoking the hook directly OR from a worktree whose path is
  relative, and names the failure mode. (Doc edit lands in the implement PR, not this one.)

## Acceptance Criteria

- AC-1: In a linked worktree with `core.hooksPath=.githooks`, an edited hook runs, the
  primary's does not (FR-6 test, red on the absolute control).
- AC-2: `npm run prepare` on a clone with an absolute value leaves `.githooks` and reports
  the change; with a read-only config it exits non-zero (FR-2).
- AC-3: The session-start message differs for unset vs absolute (FR-3), asserted by test.
- AC-4: A commit/push attempt under an absolute foreign hooks path produces the FR-4
  outcome chosen in D-1, with the repair command shown.
- AC-5: Every `.githooks/*` file is named by a test that executes it directly (FR-7).
- AC-6: `npm test`, `npm run validate`, `npm run lint` pass.

## Invariants (must not break)

1. Invariant 2 (no silent gate): no repair or check swallows an error with `|| true`; a
   missing or errored witness fails visibly. The checks in FR-3 and FR-4 are two
   independent producers.
2. Invariant 3 (blast radius): changes touch only this repo's own config and hooks. No
   machine-wide or global git config is written; `--global`/`--system` are out of scope.
3. Invariant 1 (offline): nothing here makes a network call.
4. `agent-worktree.sh` keeps forcing its trusted hooks path for agent launches
   (`scripts/lib/agent-worktree.sh:87`); this spec must not change that trust boundary.

## Decisions needed (Clarify)

- **D-1: what FR-4 does on a foreign hooks path.**
  - Option A **(rec)**: refuse the commit/push with the repair command. Cost: it is itself
    a hook, so it only runs if the hooks path resolves to a copy that contains it; when the
    path points at a stale primary the check may be absent, so FR-3's session witness
    remains the real backstop, and a false refusal blocks work (the #1263 failure shape).
  - Option B: loud warning only. Cost: a warning is the "trust the model to read it" shape
    the constitution distrusts; the drift persists until someone acts.
- **D-2: per-worktree config vs relative value.** Option A **(rec)**: relative `.githooks`
  in shared config (simplest, matches existing `prepare`). Cost: relies on git's relative
  resolution for linked worktrees, which FR-6 must confirm first. Option B:
  `extensions.worktreeConfig` with a per-worktree value. Cost: a new git feature that every
  tool and older git must support, and more state to drift.
- **D-3: scope of FR-5.** Fix the producer in this spec (rec, otherwise FR-2 is whack-a-mole;
  cost: the producer may live outside this repo, in the operator's host setup, and then is
  only documentable here) or file it separately.

## Out of Scope

- Changing hook behaviour itself (#1263 is done); hooks for adopter repos (DR-077's
  generated `.minspec/hooks/*`, DR-100 / #2406 own those).
- Any global or system git config.

## Risks

- A repair in `prepare` only runs on `npm install`; a worktree that skipped it is covered
  only by FR-3/FR-4, hence two witnesses.
- FR-6 depends on a real `git worktree` in tests; slow-process timeouts follow the repo's
  `useShellTimeout` convention.
