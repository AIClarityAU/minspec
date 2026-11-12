---
id: SPEC-291
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-291 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - reviewer prompts are part of the gate chain; a prompt change needs a regression score
relates_to: ["#2983", "#2850"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-291 - Tasks

The order below is the order of work. Five slices, one pull request each, each mergeable
on its own: the offline core (slice 1), replay through the production scripts (slice 2),
the drafter and promotion (slice 3), the seed set and first baseline (slice 4), the two
workflows (slice 5). Each task names the requirement IDs it satisfies, the files it
touches and the test that proves it. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md), which no task edits except the one `implements:`
line in task 1.0.

Shared rules for every task:

- Tests first. Each task's test is written and seen RED against `origin/main` (or the
  previous slice) before the code that turns it green.
- No task calls the model except 3.6, 4.2 and 4.3, which are on-demand runs with
  `--infer`. No test calls the model: every test that drives `review-branch.sh` uses a
  stub `claude` on `PATH`, as `packages/minspec/tests/review-branch-verdict-beats-quota.test.ts`
  does (INV-1).
- Slices 1 to 4 add files under `scripts/`, which the ai-review machinery gate treats as
  machinery; slice 5 adds `.github/workflows/`. Nothing under `.githooks/`, `.minspec/`
  or `packages/*/src/` changes.
- Before calling a task done, run `npx vitest run packages/minspec/tests/review-eval` from
  the repo root (CI's shape: `npx vitest`, not `npm test`), then `npm run validate` and
  `npm run lint`. New test files are typechecked once with `npx tsc --noEmit` over the
  file, because `packages/minspec/tests/` sits outside every tsconfig include.
- No `|| true`, no empty `catch {}` around anything that decides a score or a gate
  (INV-2); `npm run check:swallowed-gate` stays green.

## 1 - Offline core: case format, score, gate (FR1, FR2, FR4, FR5, FR6, FR9; INV-2)

- [ ] **1.0** `specs/minspec/SPEC-291-reviewer-eval-set/requirements.md` - set
  `implements:` to the owned list in design.md, *Files* (every new path; not
  `package.json`), and drop `implements_reason`. Leave `phases.implement: pending`. This
  voids the DLG-001 approval (design.md P7); re-approve through the delegated approval
  path in this pull request. *Done when:* `npm run validate` is clean and the approval
  sidecar's hash matches the edited file.
- [ ] **1.1** `packages/minspec/tests/review-eval-case.test.ts` (new) - against
  `loadCases(dir)` on `fs.mkdtempSync` fixtures:
  - a valid `repeat-fix` case and a valid `clean-control` load, in id order;
  - each refusal in design.md, *Case format*, throws an error naming the case id and the
    field: unknown `kind`; `finding` without `file`; `clean-control` with a `finding`;
    `base` not 40 hex; `patchSha256` mismatch; `repeat-fix` without `fix.patch`;
    `expected.file` not in `changedFiles`; duplicate `id`;
  - an empty `cases/` directory returns `[]` (the floor refusal lives in the score, 1.3).
  *Done when:* RED on `origin/main` (no module).
- [ ] **1.2** `scripts/lib/review-eval/case.ts` (new) - `EvalCase` and `loadCases` exactly
  as design.md specifies. *Done when:* 1.1 is green.
- [ ] **1.3** `packages/minspec/tests/review-eval-score.test.ts` (new) - against
  `gradeRun`, `decideCase` and `aggregate`:
  - AC 1: defect case, label `pass` → `miss`; label `changes` with a location
    `<expected.file>:12` (fixture file `lib/a.sh`) → `hit`; `changes` citing
    only `other.ts` → `misattributed`, not a hit; a bare basename `a.sh` plus line is a hit
    only when `a.sh` is unique in `changedFiles`.
  - AC 1: control blocked → `false-block`; control passed → `pass`.
  - Majority over K = 3: `[hit, miss, hit]` → hit, not unanimous; `[hit, misattributed,
    miss]` → not a hit.
  - FR2: `aggregate` reports recall AND false-block rate; a set where every run is
    `changes` citing the right file scores recall 1 and false-block rate 1 (AC 4's shape),
    every run `pass` scores recall 0 and false-block rate 0 (AC 3's shape).
  - FR9 floor: 2 scored defect cases, or 1 scored control, → throws naming the floor.
  - FR8/D4: an `unreviewed` case is graded and reported but excluded from `aggregate`
    (AC 7).
  - FR5: `flipRate` = cases not unanimous / cases; K is in the result.
  *Done when:* RED on `origin/main`.
- [ ] **1.4** `scripts/lib/review-eval/score.ts` (new) - grading, majority, aggregates and
  `EvalResult` as design.md, *Grading and the score*. Pure: no fs, no git, no clock (the
  caller passes `at`). *Done when:* 1.3 is green.
- [ ] **1.5** `packages/minspec/tests/review-eval-gate.test.ts` (new) - against
  `writeBaseline` and `gate`:
  - AC 3: baseline hits 4/5, candidate 2/5, `recallTolerance` 1 → fail naming the voter
    and both counts; candidate 3/5 → pass.
  - AC 4: baseline 0/3 false blocks, candidate 1/3 → fail (tolerance 0).
  - `recallTolerance` = `max(1, ceil(flipRate × nDefect))`: flip 0 → 1; flip 0.4 with 5
    defects → 2.
  - Only common cases with equal `caseHash` count; a case new in the candidate is listed
    as "not in baseline" and does not change the verdict.
  - AC 5: missing baseline file, unparseable baseline, incomplete candidate, zero common
    cases → each throws a distinct named reason.
  - `writeBaseline` refuses an incomplete result, a `single`-coverage result, or one that
    omits a `scored` case.
  *Done when:* RED on `origin/main`.
- [ ] **1.6** `scripts/lib/review-eval/score.ts` - add `writeBaseline` and `gate` as
  design.md, *Baseline and gate*. *Done when:* 1.5 is green.
- [ ] **1.7** `packages/minspec/tests/review-eval-prompt-hash.test.ts` (new) - against
  `voterHash` / `promptHash` over a temp tree holding the four role files,
  `review-branch.sh` and a guard exporting `VERDICT_SCHEMA`: editing one role file
  changes that voter's hash only; editing `review-branch.sh` changes all four; reformatting
  the guard without changing the schema value changes none; a missing role file throws.
  *Done when:* RED on `origin/main`.
- [ ] **1.8** `scripts/lib/review-eval/prompt-hash.ts` (new) - as design.md, *Prompt
  revision hash*. *Done when:* 1.7 is green.
- [ ] **1.9** `packages/minspec/tests/review-eval-cli.test.ts` (new), driven through
  `packages/minspec/tests/helpers/run-tsx-cli.ts`:
  - `plan` over a two-case fixture dir prints the voter-run count and exits 0;
  - AC 5: `plan` over an empty cases dir exits non-zero naming "no cases";
  - `gate` with a missing baseline exits non-zero naming the path;
  - an unknown subcommand (including `run` and `promote`, which this slice does not
    register) exits non-zero listing the registered ones.
  *Done when:* RED on `origin/main`.
- [ ] **1.10** `scripts/review-eval.ts` (new) - the CLI with `plan`, `gate` and
  `write-baseline` only; `run` and `promote` are registered by the slices that build them
  (2.6, 3.5), so no slice ships a subcommand without a body. `package.json` - add the
  `review-eval` script. *Done when:* 1.9 is green.

## 2 - Replay through the production scripts (FR3, FR4, FR9; INV-1, INV-4)

- [ ] **2.1** `packages/minspec/tests/review-eval-replay.test.ts` (new) - against
  `replayVoter`, with a stub `claude` on `PATH` (copy the stub shape of
  `review-branch-verdict-beats-quota.test.ts`: it must answer `-p --help` with a line
  containing `--json-schema`) and a small real git repo as the source of `base`:
  - the standalone repo has no `.git` file pointing anywhere (it is a directory), its
    working tree equals `base`'s tree, and `head` is `base` plus the patch (design.md P2);
  - the stub receives `--allowedTools Read,Glob,Grep` and a prompt on stdin containing a
    line of the patch, and does NOT receive the case title (measured point 3);
  - stub returns a `changes` envelope with a finding at the fixture file, line 3 → `VoterRun`
    `{ label: 'changes', locations: [<that finding's location>] }` and parsed `usage`;
  - stub prints a `REVIEW_UNAVAILABLE` block twice → label `blocked`, one retry observed,
    then the unusable-run error naming case and voter;
  - a patch that does not apply → error naming the case;
  - hooks never run: a fixture `core.hooksPath` hook that writes a marker file leaves no
    marker.
  *Done when:* RED on slice 1's tip.
- [ ] **2.2** `scripts/lib/review-eval/replay.ts` (new) - `replayVoter` as design.md,
  *Replay*, steps 1 to 5, retry once after 60 s (the delay injectable for tests).
  *Done when:* 2.1 is green.
- [ ] **2.3** `packages/minspec/tests/review-eval-panel.test.ts` (new):
  - `requiredVoters`: all `.md` changed files → no `security`; one `.ts` → `security`;
    `single` coverage → no `architect` / `skeptic`;
  - parity: the test reads `.github/workflows/ai-review.yml` and asserts the
    `grep -qvE '\.md$'` line and the `ARCHITECT_REQUIRED=yes` / `SKEPTIC_REQUIRED=yes`
    lines under `if [ "$COVERAGE" = "panel" ]` are present verbatim, so a workflow change
    fails here first;
  - `combinePanel`: `pass,pass,pass,pass` → pass; any `changes` → changes; `blocked`
    with no `changes` → blocked; markers removed from a temp copy of the workflow → throws.
  *Done when:* RED on slice 1's tip.
- [ ] **2.4** `scripts/lib/review-eval/panel.ts` (new) - `requiredVoters` and
  `combinePanel` (verbatim-block execution) as design.md, *Voter selection and the panel*.
  *Done when:* 2.3 is green.
- [ ] **2.5** `packages/minspec/tests/review-eval-cli.test.ts` - add `run --infer` over a
  two-case fixture (one defect, one control; floor lowered by a test-only
  `--min-defect 1 --min-control 1`) with the stub `claude`:
  - AC 2: the output JSON has `recall`, `falseBlockRate`, N, K, `promptHash`, `spend`, and
    one new line is appended to the history file; `--no-history` appends none;
  - the stub writes the `cwd` it ran in; it is never inside the repo checkout;
  - concurrency: no more than 4 stub processes alive at once (the stub records
    start/end times);
  - AC 8: `run` without `--infer` exits non-zero, its message carries the plan estimate,
    and the stub is never started; `run --infer` above `--max-voter-runs` exits non-zero
    before any voter starts.
  *Done when:* RED on slice 1's tip.
- [ ] **2.6** `scripts/review-eval.ts` - `run` body: load cases, plan, replay with
  concurrency 4 and a 5 s stagger, grade, aggregate per voter and panel, write result,
  append history, print the one-line summary, exit non-zero on `incomplete`.
  *Done when:* 2.5 is green.

## 3 - Drafter and promotion (FR8; D2, D4; P6)

- [ ] **3.1** `packages/minspec/tests/review-eval-draft.test.ts` (new) - against
  `detectRepeatFix` on a real temp git repo built commit by commit, with squash-style
  subjects ending `(#N)`:
  - AC 6: a `Revert "feat: x"` commit whose body names a reachable sha → `revert` draft,
    `status: unreviewed`, both PR numbers in provenance, `fix.patch` present;
  - a `fix(#9): ...` commit whose removed lines were written by a commit 10 days earlier
    → `repeat-fix` with that commit as defect and the most-blamed file as
    `expected.file`;
  - the same, defect 61 days earlier → no draft (window 60, the imported `WINDOW_DAYS`);
  - a pure-addition fix → no draft;
  - a `chore:` commit → no draft (the subject test is `fixScopeIssues`, imported, so this
    also fails if a copy of the regex appears: assert the module imports it);
  - a defect patch over 1,500 changed lines → no draft, and the returned reason names it;
  - running twice → the second run writes nothing (idempotent).
  *Done when:* RED on slice 2's tip.
- [ ] **3.2** `scripts/lib/review-eval/draft.ts` (new) - `detectRepeatFix`, `writeDraft`
  and `findCleanControls` as design.md, *The drafter* and *Seed set*. Local git only.
  *Done when:* 3.1 is green.
- [ ] **3.3** `packages/minspec/tests/review-eval-promote.test.ts` (new) - against
  `promoteCase` with an injected replay function (no stub CLI needed):
  - fix patch applies on top of base plus defect, panel outcomes unanimous → `status:
    scored` and a `promotion` block with K, `unanimous: true`, the prompt hash;
  - unanimous `miss` → still promoted (design.md, *Promotion*: consistent, not correct);
  - not unanimous → stays `unreviewed`, reason named;
  - `fix.patch` missing or not applying → stays `unreviewed`, reason named;
  - a `clean-control` passed to `promote` → refused (controls are authored, not drafted).
  *Done when:* RED on slice 2's tip.
- [ ] **3.4** `scripts/lib/review-eval/score.ts` or a new `promote` export in
  `scripts/lib/review-eval/draft.ts` - `promoteCase`. *Done when:* 3.3 is green.
- [ ] **3.5** `scripts/review-eval.ts` - `draft` (`--commit`, `--since`,
  `--find-controls`) and `promote` bodies; `history.jsonl` lines carry
  `caseSourceCount: { revert, repeatFix, incident, cleanControl, unreviewed }` (P6).
  Extend `review-eval-cli.test.ts` with a `draft --commit` case over a temp repo, and
  `promote` without `--infer` exiting non-zero with the plan estimate (AC 8).
  *Done when:* the new CLI case is green.
- [ ] **3.6** Measurement, no code: run `npm run review-eval -- draft --commit <sha>` on
  this repository for each proof commit in design.md's seed table (`a14bd679`,
  `f340a972`, `683ef335`, `43c6f1ed`, `820388fd`). Each must produce the defect commit the
  table names. A mismatch is a drafter bug: fix it under RCDD before slice 4, do not
  hand-edit the case. *Done when:* five drafts match, listed in the slice 3 pull request.

## 4 - Seed set and first baseline (FR7, FR4, FR6; INV-5)

- [ ] **4.1** `tests/review-eval/cases/` - commit the five drafts from 3.6, and three
  controls chosen from `draft --find-controls` (the pull request body names each and why:
  size 20 to 300 lines, touches `.ts` or `.sh`, older than 60 days, nothing blamed). Each
  control's `case.json` is authored with `status: scored`, `expected: { verdict: 'pass' }`.
  Run `npm run review-eval -- plan` and record its estimate in the pull request.
  *Done when:* `plan` exits 0 and `npx vitest run packages/minspec/tests/review-eval`
  stays green; `git diff --stat` touches only `tests/review-eval/`.
- [ ] **4.2** On-demand, `--infer`: `npm run review-eval -- promote --infer <the five
  draft ids>`. Commit the promoted `case.json` files. A draft that does not promote
  stays `unreviewed`; if fewer than three promote, return to 3.6 for more proof commits
  rather than lowering the floor. *Done when:* at least 3 defect cases are `scored`.
- [ ] **4.3** On-demand, `--infer`: `npm run review-eval -- run --infer --out
  first-baseline.json` (full panel, K = 3), then `npm run review-eval -- write-baseline
  first-baseline.json`. Commit `tests/review-eval/baseline.json` and the new
  `history.jsonl` line. The pull request body states the run's measured voter-run count,
  notional `cost_usd` total and tokens, the measured flip rate, and the resulting
  `recallTolerance` per voter (D3, INV-5), and records R1 (whether the seed incidents
  were already known to the prompts) from the per-case results. *Done when:*
  `npm run review-eval -- gate first-baseline.json` exits 0 against the committed
  baseline.
- [ ] **4.4** AC 3 and AC 4 end to end, on-demand, `--infer`, one voter (`reviewer`), not
  committed: replace `scripts/roles/reviewer.md` in a scratch worktree with a prompt that
  says "always return pass", run `run --infer --voters reviewer`, then `gate` → fails
  on recall. Repeat with "always return changes" → fails on false blocks. Restore the
  file. Record both gate outputs in the slice 4 pull request. *Done when:* both fail as
  stated; the scratch worktree is removed.

## 5 - Workflows (D1, FR6, FR8; INV-2)

- [ ] **5.1** `.github/workflows/review-eval.yml` (new) - as design.md, *The gate job*:
  no `paths:` filter; BASE checkout with `fetch-depth: 0`; pinned action SHAs copied from
  `ai-review.yml`; the unchanged-hash pass with a notice; changed voters run with
  `--no-history`; artifact upload; job summary line; harness-change notice; no
  credential → fail. Test first:
  `packages/minspec/tests/review-eval-workflow.test.ts` (new) parses the YAML and asserts:
  the checkout ref is `github.event.pull_request.base.sha`; no `paths:` key; no step
  runs a file from the head ref other than `git show <head>:scripts/roles/*.md`; no
  `|| true` or `continue-on-error` on the run or gate steps; the no-credential branch
  exits non-zero. *Done when:* the test is RED before the file exists, green after.
- [ ] **5.2** `.github/workflows/review-eval-draft.yml` (new) - as design.md, *The draft
  job*: `push` to `main`, `fetch-depth: 0`, `draft --commit $GITHUB_SHA`, branch
  `review-eval/draft-<sha7>`, pull request opened with the App token from
  `actions/create-github-app-token` (SHA as pinned in `ai-review.yml`). Extend
  `review-eval-workflow.test.ts`: the job only `git add`s `tests/review-eval/cases/`;
  it opens no pull request when `draft` wrote nothing; the token step is the pinned SHA.
  *Done when:* the extended test is green.
- [ ] **5.3** After 5.2 merges, observe, no code: the next `fix` merge that blames inside
  the window yields a draft pull request with no human step (AC 6, live). Record its
  number, and whether ai-review blocked it as code (design.md R6). If it did, file the
  reviewer-prompt follow-up as an issue with the blocked comment quoted. *Done when:* one
  live draft pull request is observed and recorded on the spec's tracking issue.
- [ ] **5.4** After `review-eval` has run green on `main`, file an issue (bot-attributed,
  `inbox` label) asking for `review-eval` to be added to `main`'s required checks,
  naming the ruleset and that it needs the admin credential (design.md R5). Then set
  `phases.implement: done` in requirements.md and run `npm run validate`.
  *Done when:* the issue exists and `validate` is clean.
