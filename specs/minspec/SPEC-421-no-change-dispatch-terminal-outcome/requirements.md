---
id: SPEC-421
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - a dispatch that spends tokens must leave a state the ranker can act on
relates_to: [SPEC-419, DR-003, DR-076, "#4093", "#734", "#738", "#530", "#527", "#1305", "#3326", "#3348"]
implements: none
implements_reason: >-
  Specify phase only. Which files carry the work is decided at Plan; the candidates are
  scripts/dispatch-issue.sh (the post-agent arm), scripts/dispatch-ready-check.sh and the
  blocker reader it calls (open-blockers.ts).
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — A "no change needed" dispatch must end in a terminal or non-ready state (Requirements)

> **SPECIFICATION ONLY.** Written by a Specify-only dispatch (DR-076/#1169). Nothing is built until a human resolves **Decisions needed (Clarify)** and approves it.

> Materializes [#4093](https://github.com/AIClarityAU/minspec/issues/4093). Trigger: drain cycles on 2026-11-26 ended `NOTHING DISPATCHED: 1 issue ready, 1 refused by the dispatcher`. #738 was refused because its blocker #734 was still open, although #734 had been dispatched and reported "no change: already built". #527 (duplicate spec) and #530 (covered by SPEC-031 FR-3) ended the same way.

## One-Sentence Scope

When a dispatch ends because the work is already done (already built, duplicate, covered elsewhere), the issue must leave the ready queue in a state a person or the ranker can read, and the issues that wait on it must stop being refused.

## Current behaviour (cited; mechanism unverified where marked)

- Blocked dependents are refused while the blocker is **open**: `scripts/dispatch-ready-check.sh:845-848` (`refuse blocked "declared blocker(s) still open"`, #3326). The drain log shows it for #738 / #734 at `/tmp/minspec-drain-inbox.log` lines 1584, 2243, 2960, 3497, 4951, 5475. So a blocker that is never closed blocks its dependents indefinitely.
- After the agent exits without `ESCALATE:`, `scripts/dispatch-issue.sh` goes straight to publish (about line 2751 onward). Completion then stamps `agent-done` and drops `agent-ready` (about lines 3209-3212), but nothing closes the issue. Closing today depends only on a closing keyword in a merged PR body (#1322 comment). A dispatch that made **no commit** has no PR, so no closing keyword ever fires.
- The agent's "no change" is free prose in the log (examples at log lines 4763, 5546, 5779: "I made no changes"). No code reads it, so it is not an outcome the dispatcher or ranker can see.
- I believe, **unverified**, that the issue's readiness and the dependents' refusal differ on which label or state they read (`agent-done` countermands readiness at `dispatch-ready-check.sh:315`, yet the blocker reader looks at open/closed). The Plan must confirm which arm #734 actually took by reading its label history before choosing the fix site.
- No test asserts that a no-change dispatch leaves the issue non-ready or closed.

## Functional Requirements

- **FR-1 Detect, deterministically.** The dispatcher decides "no change" from the worktree, not from the agent's prose: the branch has no commit ahead of `origin/main` and no uncommitted change. It never trusts a self-reported "already built".
- **FR-2 Agent states the evidence.** A no-change run must name what already covers the issue (commit, spec id, or issue/PR number) in a machine-readable line. The dispatcher parses it; the exact line shape is settled at Plan.
- **FR-3 Verify the evidence.** The dispatcher checks the named evidence resolves (the commit is reachable from `origin/main`, the spec file exists, the issue/PR exists) before treating it as strong. Unresolvable or missing evidence is weak, never strong.
- **FR-4 Strong evidence closes.** Strong evidence: the dispatcher closes the issue as completed, with a comment that cites the evidence. That closes the blocker, so dependents unblock on the next cycle with no extra step.
- **FR-5 Weak evidence leaves ready.** Weak or absent evidence: the dispatcher removes `agent-ready` and `agent-running`, adds `needs-human-review`, and comments why. The issue is not closed, and its dependents stay refused, visibly (see DQ-1).
- **FR-6 Never re-dispatched.** After either outcome the issue is not eligible for another dispatch without a human action. The existing `agent-done` countermand is not the mechanism for this, since a no-change run has no PR to reconcile.
- **FR-7 No silent gate** (constitution inv. 2). Any failure to close, relabel, or comment surfaces on stderr and in the issue; none is swallowed with `|| true`. If the dispatcher cannot tell whether the run changed anything, it takes the FR-5 path (fail closed to a human), never the close path.
- **FR-8 Specify-only runs.** A specify-only dispatch (#3348) that finds the spec already exists, and writes no new commit, follows the same rule. The issue is left with `awaiting-spec-signoff` pointing at the existing spec; it is not closed, because the issue still carries the build.
- **FR-9 Settle the three stuck issues.** Once the rule ships, #734, #530 and #527 are settled by the rule or by hand, which unblocks #738. This is data work on those issues and is tracked there, not a code change.

## Acceptance Criteria

- **AC-1** Fixture: agent exits 0, no commit, evidence names a commit reachable from main → issue closed with a comment citing it; no `agent-ready` remains (FR-1, FR-3, FR-4).
- **AC-2** Fixture: same but the named commit does not exist → issue not closed, `needs-human-review` added, `agent-ready` removed (FR-3, FR-5).
- **AC-3** Fixture: no commit and no evidence line → FR-5 path (FR-2, FR-5).
- **AC-4** Fixture: agent prose says "already built" but the worktree has a commit → treated as a normal completion, not no-change (FR-1).
- **AC-5** Ranker fixture: #738 with blocker #734 closed by FR-4 is dispatchable on the next cycle (FR-4).
- **AC-6** A failing `gh issue close` or label edit exits non-zero or comments, and does not report success (FR-7).
- **AC-7** A no-change issue is not offered a second dispatch in a following cycle (FR-6).
- **AC-8** Specify-only run with an existing spec and no new commit leaves the issue open with `awaiting-spec-signoff` (FR-8).
- **AC-9 (regression, written first at Implement)** The headline test: after a no-change dispatch the issue is never both open and `agent-ready`.

## Invariants this must not break

- **No silent gate** (constitution inv. 2): fail closed to a human, never to "closed".
- **Offline Tier-0** (inv. 1): evidence checks read local git and the issue API the dispatcher already uses; no new network surface.
- **Enforce, don't trust the model:** closure rests on dispatcher-verified evidence, not on the agent's sentence.
- Real completions (a commit and a PR) behave exactly as today.

## Decisions needed (Clarify)

- **DQ-1 What do dependents do when the blocker is weak-evidence held?** (a) leave them refused until a human settles the blocker **(rec)** - safe, but the pipeline stays stalled until someone looks; (b) treat `needs-human-review` blockers as non-blocking - unblocks sooner but may build on work that does not exist.
- **DQ-2 Who closes on strong evidence?** (a) the dispatcher closes it **(rec)** - the whole point is removing a human step (tenet 1), but a wrong close hides real work, which FR-3 narrows but cannot rule out; (b) always label for review - never wrong, but it keeps the human in the loop for what is mostly rubber-stamping.
- **DQ-3 What counts as strong?** Candidate: a commit reachable from `origin/main` that touches the issue's named paths, or a merged PR / existing spec that references the issue. Options: strict (commit or merged PR only) **(rec)**, which misses "covered by SPEC-031 FR-3" style cases and sends them to review; or loose (any resolvable reference), which closes more but trusts a citation that need not prove coverage.
