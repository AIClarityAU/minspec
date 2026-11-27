---
id: SPEC-073
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-073 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-002  # Signpost Integrity - "agent completed" over a repo the agent never changed is the pipeline's own signpost lying
relates_to: [DR-003, DR-033, DR-076, SPEC-044, SPEC-062, "#1674", "#3386", "#3452"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-073 - Tasks

The order below is the order of work. Each task is one pull request, fits one agent run and ends
with the full suite green. Each names the requirement ids it satisfies, its files, its test and the
tasks it needs first. The plan is [design.md](design.md) (D1, D2, P1 to P7 and its findings are cited
by those names); the contract is [requirements.md](requirements.md), which no task edits.

Every backticked path in this file is a file a task edits or creates. Files a task only reads are named
in prose, so that the spec gate's ownership signal stays as narrow as the change.

Shared rules for every task:

- **Invariant tests first.** Write the task's tests before the code and show them red against the
  pre-change code in the pull request body, except task 1, whose test is a baseline and starts green.
- Tests run the real dispatcher or the real function out of it, never a match on source text alone. The
  one exception is AC-7, which reads comment-stripped source because its subject is code structure.
- Comments go above a multi-line `gh` command, never between a backslash and its continuation
  (the note in the dispatcher's completion path says why).
- Every new check has a negative control in the same test that shows it can go red.
- Run the task's test file, then `npx vitest run` (CI runs vitest directly, never `npm test`),
  `npm run lint` and `npm run validate`. Test files are outside every tsconfig, so also typecheck a new
  test file directly.
- The task's pull request says `Refs #3386` (build carrier for this spec) and closes it only on task 5.

## 1 - Harness and the normal-run baseline

- [ ] **1.1** `packages/minspec/tests/helpers/agent-worktree-harness.ts`,
  `packages/minspec/tests/helpers/agent-launch-harness.ts`, `packages/minspec/tests/dispatch-commit-gate.test.ts` (new) -
  add to the fixture agent an option to make no commit and an option to leave an uncommitted change; add to
  the stub `gh` a fixture answer for `pr list` and a `pr create` that fails with given stderr; add the AC-2
  baseline.
  - *Requirements:* AC-2, INV-4.
  - *Test:* a run whose agent commits pushes to the fixture origin, records `pr create`, applies `agent-done`
    and prints "Agent completed". A second case records today's defect: with the no-commit option the same
    run also pushes and prints "Agent completed", and the PR body quotes that output as the red-before for
    task 3.1. Task 3.1 replaces that case.
  - *Prerequisites:* none.
  - *Done when:* the baseline is green on the unchanged dispatcher. It changes no production file.

## 2 - The report function, not yet wired

- [ ] **2.1** `scripts/dispatch-issue.sh`, `packages/minspec/tests/dispatch-commit-gate-report.test.ts` (new) -
  add `commit_gate_report` beside `specify_scope_report`, with the outcomes in design.md P2, using
  `agent_worktree_git` (P3). Returns 0 and prints the cause when publish must stop, 1 when it may go on.
  - *Requirements:* FR-1 (the count), FR-3, INV-3, INV-5.
  - *Test:* the function taken out of the script and run on a real repository with a pinned worktree, one
    case per row of the P2 table. Also: `.agent.log`, `.agent-summary.md` and `.review-signals.json` present
    still reads clean (finding 6); `origin/main` advanced after the agent ran changes no result (finding 8);
    `.git` rewritten to a copy holding extra commits still reads zero (P3).
  - *Prerequisites:* none.
  - *Done when:* mutants fail: count measured with `|| echo 0`, `git -C` in place of the pin, and a status
    error reported as clean.

## 3 - The guard in the chain

- [ ] **3.1** `scripts/dispatch-issue.sh`, `packages/minspec/tests/dispatch-commit-gate.test.ts`,
  `packages/minspec/tests/dispatch-env-allowlist.test.ts`, `packages/minspec/tests/dispatch-author-gate.test.ts`,
  `packages/minspec/tests/agent-launch-sites.test.ts` - add `hold_no_commit` beside `hold_specify_scope` (D1 and D2
  for the labels, P4 for the comment, P5 for the refresh and the failed-write warnings) and the `elif` between the
  egress guard and the scope guard (P1), replacing task 1.1's defect case with AC-1. In the last three test files,
  edit only what finding 9 turns up: read each test whose stub agent commits nothing, and where it meant a completed
  run, give the stub a commit, with the reason in the pull request body.
  - *Requirements:* FR-1, FR-2, FR-3, FR-4, INV-1, INV-2, INV-4, INV-5, D1, D2; AC-1, AC-3, AC-4, AC-7.
  - *Test:* the real dispatcher with the no-commit option: nothing reaches the origin, `pr create` is never
    recorded, `agent-done` and "Agent completed" are absent, and the `gh` writes are exactly the label create,
    the label edit and the comment beyond the claim. Dirty and clean produce different text naming their case.
    The edit removes `agent-running` and `agent-ready` and adds `needs-human-review`. The worktree still exists.
    The comment holds no file name from the dirty fixture (P4) and no "re-triage to try again" without the
    removal steps. A specify-only run with no commit reports this cause, not the scope guard's (finding 3). A
    zero-commit run with a scan-stopped summary is still quarantined (P1). A failed comment still leaves a WARNING
    naming the issue and the cause (P5). AC-7 on comment-stripped source: the guard is an `elif` of the chain.
  - *Prerequisites:* 1.1, 2.1. Before starting, read the current state of #3452 (branch collision on re-dispatch),
    because P4's retry text depends on it.
  - *Done when:* mutants fail: the `elif` turned into a separate `if`, and the guard moved after the scope
    guard. The 600-character check in the specify-only dispatch test is green unwidened, and no assertion in the
    three existing files is deleted or loosened to go green.

## 4 - The real reason on a failed `gh pr create`

- [ ] **4.1** `scripts/dispatch-issue.sh`, `packages/minspec/tests/dispatch-commit-gate.test.ts` - capture exit
  status and stderr as design.md P6 sets out, and replace the guess.
  - *Requirements:* FR-5; AC-5.
  - *Test:* with one commit and a stub `pr create` failing with given text, the warning holds that text and the
    exit status and lacks `(create failed?)`. With `pr create` succeeding and the lookup empty, the warning says
    so. That text appears in no posted comment (P6).
  - *Prerequisites:* 1.1.
  - *Done when:* a mutant that puts `2>/dev/null` back fails.

## 5 - A computed verdict reaches the issue

- [ ] **5.1** `scripts/dispatch-issue.sh`, `packages/minspec/tests/dispatch-commit-gate.test.ts` - when `pr_num` is
  empty, post as design.md P7 sets out.
  - *Requirements:* FR-6, INV-1, INV-5, R3; AC-6.
  - *Test:* one commit, no pull request, a stubbed verdict: the verdict text is in a recorded issue comment. A
    verdict holding a line the egress scan stops: the comment holds the neutral withheld notice and not that line.
    A failed post: the WARNING still names the verdict and `(not posted)`, and the run ends normally.
  - *Prerequisites:* 4.1, which changes the same lines.
  - *Done when:* a mutant that posts the unscanned text fails, and this pull request says `Closes #3386`.
