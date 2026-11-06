---
id: SPEC-062
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-062 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline (this is its scheduling + PR-completeness layer)
relates_to: [SPEC-044, SPEC-024, SPEC-050, SPEC-012, DR-057, DR-061, DR-067, DR-076, DR-085, DR-111, DR-112, "#888", "#1608", "#1709", "#3273"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-062 - Design: a scheduled, LLM-free PR drain

Plan for [requirements.md](requirements.md). The contract is that file; this one says how
to build it. Citations of "today" are against `origin/main` at `00f9ce35`, the commit this
plan was written on. New code is named by symbol, because its line numbers will move.
Where a statement below was read from code or docs rather than run, it says so, and the
task that depends on it checks it first.

The requirements' *Context* section was written against an older drain and some of its
`file:line` citations no longer resolve (#1709, open). This plan does not repeat them; the
table below is the current reading.

## Approach in one paragraph

A new workflow, `.github/workflows/drain.yml`, runs on `workflow_run` (CI and
`ready-to-merge` completed), on `push` to `main`, and on a slow non-round cron (D4). It
checks out the **base** commit only, installs this repository's own dependencies, and
runs one TypeScript program, `scripts/pr-drain.ts`. That program reads every open pull
request through the GitHub API, fetches each head as git objects (data, never executed),
and asks one pure function, `decidePrDrainAction` in `scripts/lib/pr-drain-decide.ts`,
what to do: merge, hold, defer to a session, or skip. Merges go through
`gh pr merge --squash --match-head-commit <judged sha>` with the workflow's default
`GITHUB_TOKEN` (D2) and never `--admin`. Approval pull requests are merged only after an
independent recomputation of the sidecar `specHash` (FR-3), reusing
`evaluateApprovalIntegrity`. Machinery and governance changes are always held (FR-6). The
LLM rework the drain cannot do here (`ai-review:changes`, red CI) is listed in the run
summary as deferred to the session-piggybacked drain (D1 Option A, R3). Nothing in this
spec runs an LLM, and nothing runs inside the extension.

## What the plan relies on (read at 00f9ce35)

| Fact | Where |
|---|---|
| Host drain's PR sweep | `sweep_open_prs` - `scripts/drain-inbox.sh:1416`; hands each PR to `scripts/remediate-pr.sh`. The drain itself never merges (comment above `arm_delegated_spec_merges`, `:1328`) |
| Merges that already happen | `dispatch-issue.sh:1732` arms native auto-merge after the SPEC-024 gate; `:2711` merges directly when `ready-to-merge` is green and autonomy allows; `:736` arms delegated spec merges pinned with `--match-head-commit`; `docs-lane.yml:296` arms auto-merge with `github.token` (`:41`) |
| CODE eligibility | `decideAutoMerge` - `packages/minspec/src/lib/auto-merge.ts:402` (pure); its impure caller `scripts/auto-merge-gate.ts` runs the PR's own tests to prove the regression (`proveRegression`, `:313`) and writes its audit to a file inside the worktree (`appendAudit`, `:978`) |
| Machinery / boundary matcher | `isBoundaryPath` - `scripts/auto-merge-gate.ts:709`, built from `MACHINERY_DIR_PREFIXES` / `MACHINERY_SINGLE_FILES` / `MACHINERY_CARVE_OUTS` in `packages/minspec/src/lib/machinery-paths.ts` (`isMachineryPath`, `:259`), plus governance paths and build config |
| Independent merge gate | `.github/workflows/ready-to-merge.yml`, single writer of the `ready-to-merge` status (`:463-465`); green only for a verified, non-stale `ai-review:pass`, no `ai-review:changes`, no `hold:*` |
| Sidecar hash witness | `evaluateApprovalIntegrity` - `scripts/approval-integrity.ts:269`; its `hash-binding` check recomputes `specHash` from the artifact bytes (`:179-187`). Advisory today, run by no workflow |
| Founder Alt-A self-merge | `scripts/alta-self-merge.ts` + `.github/workflows/alta-self-merge.yml` (DR-111) merge founder approval-only PRs with an App token, pinned to the judged sha; `judgeApprovalOnly` - `scripts/lib/alta-approval-only.ts:274` |
| Orphan test | `issue-lease.sh 'reclaim?' <item>` - called at `scripts/remediate-pr.sh:761`; claims are GitHub comments, so they are readable from a workflow |
| Behind-base and conflicts | `remediate-pr.sh` `rebase-only` arm (`:959-977`) does `git merge origin/main`; a conflict aborts at `:972` with `merge --abort 2>/dev/null \|\| true` |
| Signpost | `resolveNextTask` - `packages/shared/src/next-task.ts:1196` reads only the artifact graph; it has no PR, label or hold input. #1608 (the DR-085 human/agent queue split) is open |
| Scheduled workflows | only `ai-review-retry.yml` (`17 * * * *`) and `supply-chain-daily.yml`; no drain workflow exists |
| Approval branches | Alt-A pushes `approvals/*` branches (`packages/minspec/src/commands/commit-on-approve.ts`, comment near `:156`) |
| Test pattern | `packages/minspec/tests/alta-self-merge.test.ts`: an injected `gh` function records every argv; `git` is a real temporary repository |

## Architecture

```
drain.yml (workflow_run | push main | cron | workflow_dispatch)
  job merge      permissions: contents/pull-requests write, checks/statuses read
                 token: GITHUB_TOKEN only - no secrets.* in this job
    checkout BASE sha -> npm ci -> tsx scripts/pr-drain.ts --repo $REPO --merge
  job land       (Task 9 / 10, conditional on Measurement M3)
                 token: App token minted with pull-requests:write only
    tsx scripts/pr-drain.ts --repo $REPO --land-stranded --update-behind

scripts/pr-drain.ts            impure: API reads, git object fetch, writes
  gatherFacts(pr) -> PrDrainFacts
  decidePrDrainAction(facts) -> PrDrainAction        (scripts/lib/pr-drain-decide.ts, pure)
  perform(action)  merge | hold | defer | skip | land | update
```

### The pure decision (`scripts/lib/pr-drain-decide.ts`)

```ts
type PrClass = 'code' | 'docs' | 'approval';

interface PrDrainFacts {
  number: number;
  headSha: string;
  changedPaths: readonly string[];
  labels: readonly string[];
  readyToMerge: 'success' | 'failure' | 'pending' | 'absent' | 'error';
  orphan: 'yes' | 'no' | 'error';             // issue-lease reclaim?, fail closed
  mergeable: 'clean' | 'behind' | 'conflict' | 'unknown';
  gateRecord?: GateRecord;                     // CODE only; see "CODE eligibility"
  approvalWitness?: ApprovalWitness;           // approval only; see FR-3
}

type PrDrainAction =
  | { kind: 'merge'; sha: string; reason: string }
  | { kind: 'hold'; reason: HoldReason; detail: string }
  | { kind: 'defer'; why: 'llm-rework' | 'live-claim' | 'stale-gate-record' | 'pending' }
  | { kind: 'update-behind'; sha: string };
```

Order of the checks, first match wins, so a hold can never be followed by a merge:

1. `orphan !== 'yes'` -> `defer: live-claim` when `no`; `hold` when `error` (INV-7, fails closed).
2. Any changed path is machinery or governance -> `hold: machinery` / `hold: governance` (FR-6).
3. `mergeable === 'conflict'` -> `hold: conflict` (surfaced, never resolved).
4. `ai-review:changes` label or a red required check -> `defer: llm-rework` (D1 Option A).
5. `needs-human-review` or any `hold:*` label -> skip (already held; no second entry).
6. `mergeable === 'behind'` -> `update-behind` (only acted on when the land job exists; else `defer`).
7. Class conjunct: approval -> FR-3 witness must be `match`; CODE -> the gate record must
   say eligible for exactly `headSha`; docs -> the `docs-lane` label must be present.
8. `readyToMerge === 'success'` -> `merge` with `sha: headSha`. Anything else -> `defer: pending`.

`HoldReason` is a closed union (`machinery`, `governance`, `conflict`, `stale-approval`,
`witness-error`, `lease-error`, `gate-error`). Each reason carries one sentence that the
hold comment prints, so the comment never disagrees with the decision.

**Class.** A PR is `approval` when it touches `.minspec/approvals/**`; `docs` when it
carries the `docs-lane` label (docs-lane.yml already enforces its path rules, so this spec
adds no second docs classifier); otherwise `code`.

**Governance.** `docs/decisions/**`, `docs/epics/**`, `.minspec/constitution.md`,
`.minspec/delegations.json`, and any `status:` line change in a `specs/**` file that is not
covered by an approval sidecar in the same PR. The machinery half is `isBoundaryPath`, the
SPEC-024 matcher the requirements name; nothing is copied, the module is imported.
`sites/**` is also held: merging there is publishing (dispatch already holds it, #981),
and a `GITHUB_TOKEN` merge may not fire `deploy-sites.yml` (Measurement M1).

### CODE eligibility without running PR code

`decideAutoMerge` needs the regression proof, and the proof runs the PR's own tests. A job
holding a write token must not run code from a pull request (a PR could rewrite its tests
to exfiltrate the token or forge the result). So `drain.yml` never calls the gate. Instead
the dispatch path, which already runs the gate on the host (`dispatch-issue.sh`, around
`:2633`), posts one bot-authored comment carrying the decision bound to the head sha:

```
<!-- minspec-gate-decision {"sha":"<40 hex>","eligible":true,"blast":"low","mode":"consequence-hybrid"} -->
```

`parseGateRecord` accepts a record only when the comment author is `minspec-sdd[bot]` and
the payload parses; `decidePrDrainAction` uses it only when `sha === headSha`. A record for
an older sha is `defer: stale-gate-record`, never a merge. The agent that wrote the PR is
credential-free, so it cannot post as the bot.

Most eligible CODE PRs already merge through the auto-merge armed at `dispatch-issue.sh:1732`.
The workflow's CODE role is the fallback for one whose arm was dropped or never set; it
adds no new way for a CODE PR to qualify.

### FR-3 - the approval witness

`approvalWitness` is computed by `scripts/pr-drain.ts` at the merge boundary: it fetches
`refs/pull/<n>/head` and the base tip as objects, and calls `evaluateApprovalIntegrity`
against them (the same function the advisory CLI uses). Result:

- `match` - every sidecar's `specHash` equals `specHash()` of the artifact at head;
- `mismatch` - any failure with `check: 'hash-binding'` -> `hold: stale-approval`;
- `error` - the call threw or returned nothing -> `hold: witness-error`.

The witness reads no label and no PR body, and writes nothing (INV-6). A founder Alt-A PR
can also be merged by `alta-self-merge` (DR-111). Both merges are pinned to the judged sha,
so whichever runs second is refused by GitHub; neither can land a different commit.

### Holds (FR-5)

A hold adds `needs-human-review` and upserts one comment marked
`<!-- spec062-hold -->` (edited in place, never duplicated) naming the reason. That label
is the existing hold signal the drain, dispatch and remediation already write, so this is
not a new surface. Routing holds into the SPEC-012 resolver, split by DR-085 into the
human and agent queues, is D3's deferred mechanism and waits on #1608 (Task 13).

Every `HoldReason` above is human-dischargeable, so all of them go to the human side once
#1608 lands. `defer` outcomes are not holds: they are listed in the run summary and left
for the session drain, which is where agent-waiting work already sits.

### Triggers and cadence (D4)

`workflow_run` on `[CI, ready-to-merge]` completion, `push` to `main` (a merge can make
others behind), `schedule: '7,27,47 * * * *'` (20-minute floor, never `:00`), and
`workflow_dispatch`. `concurrency: { group: pr-drain, cancel-in-progress: false }`.

`pull_request` is deliberately not a trigger, a refinement of D4's "`pull_request`/`push`":
a `pull_request` run executes the workflow file as it is on the PR's head, so a PR could
edit `drain.yml` and run it with a write token. `workflow_run` runs the default branch's
copy, the pattern `alta-self-merge.yml` already uses. Promptness is unchanged, because
`ready-to-merge` finishing is the moment a PR can first become mergeable.

### Recovery (FR-4)

- **Behind base, in the workflow.** `update-behind` calls the update-branch API. Pushes by
  `GITHUB_TOKEN` start no workflows, so a head updated that way would never get CI or a
  review and would wait forever. The land job therefore uses an App token downscoped at
  mint time to `pull-requests: write`, which (believed, unverified - Measurement M3) can
  open a PR and update a branch but cannot merge. If M3 refutes that, Tasks 9 and 10
  are not built; behind-base stays with `remediate-pr.sh` on the host and the summary
  says so (the same posture D1 accepts for rework).
- **Stranded approvals (FR-4a).** `findStrandedApprovalBranches(branches, openPrHeads)`
  lists `approvals/*` branches ahead of `main` with no open PR. The land job opens one
  docs-lane PR per branch, searching by head first so a re-run opens nothing new. It
  never touches a working tree: the workflow has none of the developer's, and the program
  calls no `checkout`/`switch`/`merge`/`rebase`/`reset` (asserted on argv, INV-3).
- **Interrupted git states (FR-4b), on the host.** A crashed agent leaves its state in
  the remediation worktree, not on GitHub. `remediate-pr.sh` gains a check for
  `rebase-merge`/`rebase-apply`/`MERGE_HEAD` in that worktree, aborts it, and logs the
  recovery. The existing `merge --abort 2>/dev/null || true` at `:972` becomes a checked
  call whose failure is logged and labels the PR (invariant 2).

### Tokens (D2, INV-2)

The merge job's only credential is `GITHUB_TOKEN`. A structural test asserts the merge job
references no `secrets.*`, that no file this spec adds contains `--admin`, and that every
recorded merge argv has `--match-head-commit`. Whether `GITHUB_TOKEN` can get past
`main`'s ruleset is a property of the ruleset, not of this code, so Measurement M2 reads
the ruleset's bypass list (`github-actions` must not be on it) and Task 12 proves it live.
DR-112 lets the bot use `--admin` through `cos-runner-gh.sh` for machinery PRs. This
workflow never does: it holds machinery, and DR-112's path stays the one that merges it.

## Measurements (to take in Task 1, before code)

| # | Question | How | Decides |
|---|---|---|---|
| M1 | Do merges armed by `docs-lane.yml` with `github.token` start the `push`-to-`main` runs of `ci.yml`, `deploy-sites.yml`, `minspec-validate.yml` and `secret-scan.yml`? | list runs for the merge commit of two recent docs-lane merges | if not, file an issue for the post-merge CI gap (this spec already holds `sites/**`) |
| M2 | `main`'s ruleset: required checks, required reviews, bypass actors | `GET /repos/AIClarityAU/minspec/rules/branches/main` and the ruleset by id | a required approving review would make every `GITHUB_TOKEN` merge fail; `github-actions` as a bypass actor would break INV-2 |
| M3 | Can an App token minted with only `pull-requests: write` open a PR and call update-branch, and is it refused by the merge endpoint? | GitHub's per-endpoint permission tables, then one refused merge attempt on a throwaway PR | whether Tasks 9 and 10 are built |

## Files

| File | Change | Owner |
|---|---|---|
| `.github/workflows/drain.yml` | new | SPEC-062 (`implements:`) |
| `scripts/lib/pr-drain-decide.ts` | new, pure | this plan; not in `implements:` because adding it would edit the signed requirements |
| `scripts/pr-drain.ts` | new, impure runner | as above |
| `scripts/dispatch-issue.sh` | post the gate-decision record | SPEC-044 owns it; this spec `affects:` it |
| `scripts/remediate-pr.sh` | interrupted-state recovery, checked abort | SPEC-044 owns it; `affects:` |
| `packages/minspec/tests/pr-drain-*.test.ts` | new | tests |

`scripts/drain-inbox.sh` and `scripts/auto-merge-gate.ts` are in `affects:` but this plan
needs no change to either: `isBoundaryPath` is already exported. Every task that edits
`scripts/` or `.github/` is a machinery pull request and merges by the machinery path,
not by `ai-review` alone.

## Invariants, and how each is tested

| Invariant | Test |
|---|---|
| INV-1 no silent gate | every `*-error` input yields `hold`, never `merge` or `skip` (property test over the decide function); the runner exits non-zero on an API failure; no `\|\| true` in the new files (grep test) |
| INV-2 no bypass | merge argv recorded: never `--admin`, always `--match-head-commit`; `drain.yml` merge job has no `secrets.*`; M2 + Task 12 |
| INV-3 no primary checkout | runner argv recorded: no `checkout`/`switch`/`merge`/`rebase`/`reset` |
| INV-4 blast radius | workflow test: `--repo ${{ github.repository }}` only; nothing under `packages/minspec/src/` imports the new files |
| INV-5 no LLM | the new files spawn no `claude` and no agent script (argv + import scan) |
| INV-6 no approval writes | the runner never writes `.minspec/approvals/**` or a `status:` line (argv + fs spy) |
| INV-7 orphan-only | `orphan: 'no'` -> `defer`, `'error'` -> `hold`, never `merge` |

## Testing

Pure function first: `pr-drain-decide.test.ts` covers each check in order and a
property test that, for every combination of the enumerable fields, a `hold` outcome
never coexists with a merge, and a merge requires every conjunct. The runner is tested
like `alta-self-merge.test.ts`: `main(argv, env, gh, git)` with an injected `gh` that
answers from a table and records argv, and a real temporary git repository for object
reads. The workflow is tested by parsing the YAML. Each new check gets a negative control
in the same test that turns it red. CI runs `npx vitest`, so nothing relies on a
`pretest` step.

## Build order

A vertical slice first: the pure decision, then the runner's read-only dry run, then the
workflow in dry-run mode, then turning on merges for docs-lane PRs, then CODE (gate
record), then approval PRs (witness), then the land job, then host-side recovery, then the
live checks, and last the signpost source once #1608 lands.

## Design decisions and the rejected alternatives

- **Workflow never runs the SPEC-024 gate.** Rejected: running `auto-merge-gate.ts` in
  the workflow (executes PR code next to a write token); running it in an unprivileged job
  and passing the result as an artifact (the PR's code shares that job and could forge the
  artifact). Cost accepted: a CODE PR whose head moved after the gate ran waits for the
  host to re-run it.
- **`workflow_run`, not `pull_request`.** Rejected `pull_request` for the reason above,
  and `pull_request_target` (same token, more foot-guns, no gain over `workflow_run`).
- **One shared hold label plus one comment.** Rejected a new `held:*` label family now:
  D3 deferred the representation to #1608, and inventing it here is what D3 forbade.
- **Downscoped App token only for writes that must start CI.** Rejected using the App
  token for merges (D2 rejected it) and rejected `GITHUB_TOKEN` for PR creation and
  branch updates (they would never get CI). Cost: a second credential in the workflow,
  confined to a job with no merge step; dropped entirely if M3 refutes the downscope.
- **Reuse `evaluateApprovalIntegrity`, not `judgeApprovalOnly`.** The latter also
  requires founder authorship, which FR-3 does not; the former is the bare hash check.

## Follow-ups (tracked)

- D3 mechanism: #1608 (open) - Task 13 waits on it.
- Stale Context citations in requirements.md: #1709 (open) - a requirements edit, not this plan's.
- Post-merge CI gap if M1 shows one: Task 1 files it.
- Build issue: #3273.
