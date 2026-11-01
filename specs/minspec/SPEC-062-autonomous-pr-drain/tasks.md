---
id: SPEC-062
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-062 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline (this is its scheduling + PR-completeness layer)
relates_to: [SPEC-044, SPEC-024, SPEC-012, DR-085, DR-111, DR-112, "#1608", "#3273"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-062 - Tasks

The order below is the order of work. Each task is one pull request, ends with the full
suite green, and names the requirement IDs it satisfies, the files it touches and the test
that proves it. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md), which no task edits.

Every backticked path in this file is a file a task edits or creates. Files a task only
reads are named in prose. Paths not in requirements.md's `implements:`/`affects:` are
listed with their reason in design.md, *Files*.

Shared rules for every task:

- No task runs an LLM, spawns `claude`, or imports from `packages/minspec/src/` into the
  extension bundle (INV-4, INV-5).
- No new file contains `--admin` or `|| true`. Every error path holds and says why.
- Every new check has a negative control in the same test that shows it can go red.
- Runner tests inject `gh` and record argv, as `packages/minspec/tests/alta-self-merge.test.ts`
  does; git reads use a real temporary repository. CI runs `npx vitest`, so nothing relies
  on a `pretest` step.
- Run `npx vitest run packages/minspec/tests/pr-drain` and then the whole suite,
  `npm run lint`, `npm run typecheck` and `npm run validate` before calling a task done.
- A task that touches `scripts/` or `.github/` is machinery: its pull request merges by the
  machinery path, not by `ai-review` alone.

## 1 - Measure the three platform facts (design.md, *Measurements*)

- [ ] **1.1** Take M1, M2 and M3 as design.md describes. For M3, the refused merge attempt
  uses a throwaway PR the task opens and closes itself; nothing is merged.
- [ ] **1.2** `specs/minspec/SPEC-062-autonomous-pr-drain/design.md` - add the results under
  *Measurements* with the date and the commands run. If M1 shows no push runs, file an
  `inbox` issue for the post-merge CI gap and cite it there. If M2 shows a required
  approving review or `github-actions` as a bypass actor, stop and file a `hold:human`
  issue: Tasks 5 to 8 cannot meet INV-2 as designed.
  *Done when:* the three rows have results and the decision each one drives is written down.

## 2 - The pure decision (FR-2, FR-6, INV-1, INV-7)

- [ ] **2.1** `scripts/lib/pr-drain-decide.ts` - `PrDrainFacts`, `PrDrainAction`,
  `HoldReason`, `classifyPr`, `isGovernancePath`, and `decidePrDrainAction` with the eight
  ordered checks in design.md, *The pure decision*. Machinery comes from `isBoundaryPath`
  (imported from `scripts/auto-merge-gate.ts`), `sites/**` and governance from
  `isGovernancePath`. No I/O.
- [ ] **2.2** `packages/minspec/tests/pr-drain-decide.test.ts` - one case per check; a
  property test over every combination of the enumerable fields asserting that any
  `*-error` input never yields `merge`, that a machinery or governance path never yields
  `merge`, and that `merge` requires orphan `yes`, `ready-to-merge` `success` and the class
  conjunct. Control: removing the machinery check makes the property fail.
  *Done when:* green, and the control is red.

## 3 - The runner, read-only (FR-1 groundwork, INV-3, INV-6)

- [ ] **3.1** `scripts/pr-drain.ts` - `main(argv, env, gh, git)`: list open PRs (fail closed
  at the list limit, as `sweep_open_prs` does), gather `PrDrainFacts` per PR (labels,
  `ready-to-merge` status on the head sha, changed paths, mergeable state, orphan via
  `scripts/lib/issue-lease.sh 'reclaim?'`), call `decidePrDrainAction`, and print one JSON
  line per PR. With no `--merge` it performs nothing. An API failure exits non-zero.
- [ ] **3.2** `packages/minspec/tests/pr-drain-runner.test.ts` - injected `gh` table for a
  machinery PR, a docs-lane PR, a live-claim PR and an API error; asserts the JSON lines,
  the non-zero exit on error, and that the recorded argv holds no write call and no
  `checkout`/`switch`/`merge`/`rebase`/`reset`.
  *Done when:* green.

## 4 - The workflow, dry run (FR-1, D4, INV-2, INV-4)

- [ ] **4.1** `.github/workflows/drain.yml` - triggers and concurrency from design.md,
  *Triggers and cadence*; one `merge` job with `GITHUB_TOKEN` and the permissions named in
  design.md, checking out the base sha, `npm ci`, then `npx tsx scripts/pr-drain.ts --repo
  ${{ github.repository }}` (no `--merge` yet). Every `uses:` pinned by sha. The run summary
  lists each PR's action, and every `defer: llm-rework` PR under "left for a session".
- [ ] **4.2** `packages/minspec/tests/pr-drain-workflow.test.ts` - parse the YAML: no
  `pull_request` or `pull_request_target` trigger; cron minutes not `0`; the merge job
  references no `secrets.`; `--repo` is `${{ github.repository }}`; every `uses:` has a
  40-hex sha. Control: a fixture with `pull_request:` fails.
  *Done when:* green, actionlint passes, and one `workflow_dispatch` run after merge
  shows the summary with no write.

## 5 - Merge docs-lane PRs (FR-2 docs, AC-2)

- [ ] **5.1** `scripts/pr-drain.ts` - with `--merge`, perform `merge` as
  `gh pr merge <n> --squash --match-head-commit <sha>`; on refusal, log and leave the PR
  (no retry in the same run). Only the `docs` class can reach `merge` in this task; CODE
  and approval stay `defer: pending` until Tasks 7 and 8.
- [ ] **5.2** `.github/workflows/drain.yml` - pass `--merge`.
- [ ] **5.3** `packages/minspec/tests/pr-drain-runner.test.ts` - an eligible docs-lane PR
  records exactly one merge argv with `--match-head-commit` and no `--admin`; a PR missing
  any one conjunct records none (AC-2's "missing any one conjunct" over each conjunct).
  *Done when:* green.

## 6 - Dispatch posts the gate decision bound to the head sha (FR-2 CODE)

- [ ] **6.1** `scripts/dispatch-issue.sh` - after the SPEC-024 gate returns (the
  `DECISION=` call near `:2633`), post one bot-authored comment
  `<!-- minspec-gate-decision {...} -->` with `sha`, `eligible`, `blast`, `mode`, through
  the existing bot `gh`. A failed post is logged and the decision is treated as a hold for
  the workflow's purposes (no record means no workflow merge).
- [ ] **6.2** `scripts/lib/pr-drain-decide.ts` - `parseGateRecord(comments)`: accepts only
  author `minspec-sdd[bot]` and a parsable payload; the latest record wins.
- [ ] **6.3** `packages/minspec/tests/pr-drain-gate-record.test.ts` - a forged record by
  another author is ignored; a record for a different sha gives `defer: stale-gate-record`;
  a dispatch test (the existing stubbed-`gh` drain harness) shows the comment argv.
  *Done when:* green.

## 7 - Merge CODE PRs on a current gate record (FR-2 CODE, AC-2)

- [ ] **7.1** `scripts/pr-drain.ts` - fetch PR comments, set `gateRecord`, and let the
  `code` class reach `merge`.
- [ ] **7.2** `packages/minspec/tests/pr-drain-runner.test.ts` - eligible record on the
  head sha merges; eligible record on an older sha does not; `eligible: false` does not;
  no record does not.
  *Done when:* green.

## 8 - The approval witness (FR-3, AC-3, INV-1, INV-6)

- [ ] **8.1** `scripts/pr-drain.ts` - for the `approval` class, fetch the base tip and
  `refs/pull/<n>/head` as objects and call `evaluateApprovalIntegrity` (from
  `scripts/approval-integrity.ts`) against them; map to `match` / `mismatch` / `error` as
  design.md, *FR-3*, says. On `hold`, add `needs-human-review` and upsert the
  `<!-- spec062-hold -->` comment.
- [ ] **8.2** `packages/minspec/tests/pr-drain-approval.test.ts` - a real temporary repo
  with a matching sidecar merges; a mismatched one holds and labels; an injected throw
  from the witness holds with `witness-error` and never merges; the runner never writes a
  sidecar or a `status:` line (fs spy).
  *Done when:* green, with the injected-error case shown red when the error branch is
  changed to `skip`.

## 9 - Land stranded approvals (FR-4a, AC-4, INV-3) - only if M3 holds

- [ ] **9.1** `scripts/lib/pr-drain-decide.ts` - `findStrandedApprovalBranches(branches,
  openPrHeads, aheadOfMain)`.
- [ ] **9.2** `scripts/pr-drain.ts` - `--land-stranded`: for each stranded branch, search
  open PRs by head first, then `gh pr create --label docs-lane` if none.
- [ ] **9.3** `.github/workflows/drain.yml` - a `land` job, separate from `merge`, minting
  the App token with only `pull-requests: write` (the mint step `alta-self-merge.yml`
  uses, with its permission inputs), running `--land-stranded`. No merge step in this job.
- [ ] **9.4** `packages/minspec/tests/pr-drain-land.test.ts` - two runs over the same
  stranded branch record one `pr create`; argv has no `checkout`/`switch`/`merge`/
  `rebase`/`reset`; the workflow test asserts the `land` job has no `pr merge`.
  *Done when:* green.

## 10 - Update behind-base PRs from the workflow (FR-4b, AC-5) - only if M3 holds

- [ ] **10.1** `scripts/pr-drain.ts` - `--update-behind`: perform `update-behind` through
  the update-branch API with `expected_head_sha`; a conflict response holds with
  `conflict` and labels; every attempt is logged in the summary.
- [ ] **10.2** `.github/workflows/drain.yml` - add `--update-behind` to the `land` job.
- [ ] **10.3** `packages/minspec/tests/pr-drain-land.test.ts` - a behind PR records one
  update call with the expected sha; a conflict holds; an API error holds and exits
  non-zero.
  *Done when:* green.

## 11 - Host-side recovery of interrupted git states (FR-4b, AC-5)

- [ ] **11.1** `scripts/remediate-pr.sh` - before any work in the remediation worktree,
  detect `rebase-merge`, `rebase-apply` or `MERGE_HEAD`, abort the operation and log it;
  replace the unchecked `merge --abort 2>/dev/null || true` in the `rebase-only` arm with a
  checked call whose failure is logged and labels the PR `needs-human-review`.
- [ ] **11.2** `packages/minspec/tests/remediate-pr-recovery.test.ts` - a temporary repo
  left mid-rebase is recovered and the log line names it; a failing abort labels the PR
  and the script exits non-zero for that PR. Control: restoring `|| true` turns the
  second case red.
  *Done when:* green.

## 12 - Live proof (AC-1, D2's required test)

- [ ] **12.1** With no Claude session running, trigger `drain.yml` by `workflow_dispatch`
  and record the run link and the summary in the build issue (#3273).
- [ ] **12.2** On a throwaway PR whose required check is red, run the merge step's command
  with the workflow's `GITHUB_TOKEN` and record GitHub's refusal. The PR is named by a
  `workflow_dispatch` input that `.github/workflows/drain.yml` gains in this task and that
  `scripts/pr-drain.ts` accepts as `--only <n>`. This is the test D2 requires; it is live because the property
  lives in the ruleset, not in code.
  *Done when:* both records are on the issue and the throwaway PR is closed unmerged.

## 13 - Held items reach the signpost (FR-5, AC-6) - waits on #1608

- [ ] **13.1** Do not start until #1608 (the DR-085 human/agent queue split) has merged.
  Then add the hold source to the human queue it defines, reading the
  `<!-- spec062-hold -->` comments or whatever representation #1608 chose, so each held
  PR is exactly one entry. Files are named by that design, not here.
  *Done when:* a held PR appears once on the human queue and a `defer` PR does not.
