---
id: SPEC-332
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline; same epic as SPEC-062 (the PR drain)
aspects: [drain, triage, tasks-md, fail-visible]
depends_on: []
relates_to: ["#3412", "#3376", "#3326", "#3296", "#2980", "SPEC-062", "SPEC-136", "SPEC-321"]
implements: none
implements_reason: >-
  Specify phase only. Expected surface: one drain step plus a pure tasks.md parser under scripts/. Neither is built.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-332: A merged tasks.md fans out into per-task issues

Issue: #3412. Related: #3376 (`hold:built-spec`), #3326 (blockers read from issue bodies), #3296 to #3312 (SPEC-136's one-off per-task issues).

## Problem

Nothing in `scripts/` turns a merged `tasks.md` into per-task issues. The only producer so far was a one-off runner job (SPEC-136, #3296 to #3312). Since #3376, triage refuses a `build: SPEC-NNN` issue for a spec at planning, implementing or done with `hold:built-spec`, and says "the fix is to file per-task issues": a step no machine performs. Measured on `origin/main` 5d524f96 (2026-10-31, from the issue): 8 specs hold unticked tasks with no open task issue (SPEC-018, 019, 051, 054, 078, 079, 095, 211), and about 21 more join as their plan PRs land (#2980). Their whole-spec issues cannot dispatch: `scripts/dispatch-ready-check.sh` refuses `agent-ready` without a verdict record, and a triage re-run ends at `needs-review` + `hold:built-spec`, a lane nobody works (inferred from code in the issue, not run).

Root cause (mechanism plus missing gate): the per-task fan-out lives only in runner prose ("the runner does that once the plan merges"), and no check notices a planned spec with tasks and no task issues.

## Functional requirements

- **FR-1 Parser.** A pure function reads a `tasks.md` and returns an ordered list of tasks: id, heading, verbatim body text, and declared dependencies. A *task* is one `## N - title` heading section (SPEC-136's shape: one task = one pull request); its `- [ ] **N.M**` lines are the task's steps and stay inside its body. A task whose steps are all ticked is not returned.
- **FR-2 Refuse, report, never guess.** A `tasks.md` that does not match the shape (no headings, duplicate ids, a dependency naming an unknown task, a dependency cycle) files nothing from that spec and emits a visible report naming the spec and the reason. It never files a partial set (invariant 2).
- **FR-3 Fan-out step.** A drain step, for each spec whose `requirements.md` status is `planning` or `implementing` and whose `tasks.md` has unticked tasks, files one issue per unfiled task. The task text is copied verbatim.
- **FR-4 Edges.** Each task issue carries `Part of #<build issue>` and one `Blocked by #N` line per dependency, in the form `parseDeclaredBlockers` (`scripts/lib/issue-rank.ts`) reads, so `scripts/open-blockers.ts` sees them. Dependencies are filed first (topological order) so the numbers exist. The text `Depends on task(s): 4` is never emitted: the parser ignores it (#3326).
- **FR-5 Idempotent.** Each task issue embeds a stable marker (`<!-- tasks-md: SPEC-NNN task N -->`). The step looks for an existing issue (open or closed) with the marker before filing, so a rerun or a crash mid-fan-out files nothing twice and resumes the rest.
- **FR-6 Whole-spec issue retired.** Once every task is filed, the spec's whole-spec `build:` issue gets a comment listing the task issues and is closed as superseded, so triage no longer re-routes it to `hold:built-spec`. It is not closed while any task failed to file.
- **FR-7 Normal triage.** Task issues enter the ordinary inbox: triage classifies each, the tier gate applies, the drain dispatches them. The step grants no verdict, label or lane itself.
- **FR-8 Bounded.** At most N task issues are filed per run (value in plan; compatible with SPEC-321 build back-pressure), so one 53-task spec cannot flood the queue. The remainder is filed on later runs.
- **FR-9 Visible failure.** A `gh` failure while filing or reading existing issues stops that spec, is reported with its cause, and exits non-zero. It is never swallowed or read as "none exist".

## Acceptance criteria

- AC-1 (FR-1) Given a SPEC-136-shaped fixture, the parser returns each `##` section with verbatim body; a fully ticked section is omitted.
- AC-2 (FR-2) Fixtures with duplicate ids, an unknown dependency, a cycle and a headingless file each file zero issues and report the reason.
- AC-3 (FR-3, FR-4) A fixture with a dependency chain files in dependency order; the filed bodies, fed to `parseDeclaredBlockers`, return the right numbers.
- AC-4 (FR-5) Running the step twice, and running it after a simulated crash after task 2 of 5, yields exactly 5 issues.
- AC-5 (FR-6) The whole-spec issue closes only after all tasks are filed.
- AC-6 (FR-9) A failing `gh` call yields a non-zero exit and a report; negative control: the same fixture with a working `gh` passes.
- AC-7 (measured) Run read-only against current `main`, the step's dry-run lists the 8 specs above, or states for each why it was refused.

## Invariants this must not break

- Invariant 1: offline core. This is dev-time drain machinery under `scripts/`, not the extension; the parser makes no network call, only the filing step does.
- Invariant 2: no silent gate. FR-2, FR-6 and FR-9 fail visibly and closed.
- Invariant 3: acts only in repos with `.minspec/`.
- No spec, `tasks.md` or approval record is edited by the step; it only reads them.

## Out of scope

Rewriting older `tasks.md` files into the canonical shape (refused and reported only); changing triage tiers; the 21 specs without a merged plan yet.

## Decisions needed (Clarify)

1. **Where the step runs.** (rec) A drain step, visible in the drain log and covered by tests. Cost: new drain code to maintain. Alternative: keep it a runner job after each plan merge; it stays invisible when the runner does not run it, which is the current failure.
2. **Task granularity.** (rec) One issue per `## N - title` section, matching "one task = one pull request" in SPEC-136. Cost: sections can be large for a Sonnet-class agent. Alternative: one per `- [ ] **N.M**` step; much finer, but the 53-task SPEC-018 becomes hundreds of issues and each is not independently mergeable.
3. **Fate of the whole-spec issue.** (rec) Close as superseded (FR-6). Cost: loses its comment history from the open list. Alternative: leave it open as an epic tracker, but triage must then stop re-routing it, which is a second change.
4. **Older `tasks.md` files that do not match.** (rec) Refuse and report (FR-2). Cost: some of the 8 specs wait for a manual reshape. Alternative: heuristic parsing, which risks filing wrong tasks that agents then build.
5. **Trigger.** (rec) Scan every drain cycle for planned specs lacking task issues (self-healing, catches the 8 existing). Cost: one more scan per cycle. Alternative: fire only on a plan-PR merge event, which misses the existing backlog.
