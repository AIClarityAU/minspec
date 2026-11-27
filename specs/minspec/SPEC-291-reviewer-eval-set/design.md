---
id: SPEC-291
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-291 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - reviewer prompts are part of the gate chain; a prompt change needs a regression score
relates_to: ["#2983", "#2850", "#3672", "SPEC-044", "DR-106", "DR-108"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-291 - Design: a reviewer eval set, scored on every reviewer-prompt change (Plan)

Plan for [requirements.md](requirements.md) (APPROVED by delegation DLG-001; read, never
edited by this Plan), built under the six recorded Clarify selections: D1 option A
(on-demand command plus a CI job for reviewer-prompt pull requests), D2 option A (a
`Revert` commit, or a `fix` commit whose removed lines blame to a pull request merged
inside a window), D3 option A (zero tolerance on false blocks, a small recall tolerance
set from the first baseline's flip rate), D4 option A (a deterministic promotion check),
D5 option A (fixtures in `tests/review-eval/`, runner under `scripts/`), D6 (no decision
record). Citations of "today" are against `origin/main` `e9924bf3`. New code is named by
symbol, because its line numbers will move. The task list is [tasks.md](tasks.md).

## Approach in one paragraph

A case is a directory under `tests/review-eval/cases/<id>/` holding `case.json` (kind,
expected verdict, provenance, base commit, status) and `defect.patch` (the diff the
reviewer is shown); repeat-fix and revert cases also hold `fix.patch` (the diff that
proved the defect). A runner, `scripts/review-eval.ts`, rebuilds each case as a two-commit
throwaway git repository (base tree, then base plus `defect.patch`), checks the BASE
commit out as the working tree exactly as `ai-review.yml` does, and calls the production
`scripts/review-branch.sh <base> <head> --role <voter>` from the checkout under test, so
the role prompts, prompt text and verdict schema that are scored are the ones production
loads, never a copy (FR3). Each voter's stdout goes through the production
`scripts/review-decide.sh`, and the panel verdict is computed by executing the verbatim
`verdict-combine` block of `ai-review.yml`, the same extraction the existing combine test
uses. Each case runs K = 3 times; the majority decides it. The score (recall on defect
cases, false-block rate on controls, both per voter and for the panel, N, K, flip rate,
prompt revision hash, measured token spend) is written as JSON, summarised on one line
and appended to `tests/review-eval/history.jsonl`. A gate compares a candidate score with
the committed `tests/review-eval/baseline.json` under D3 tolerances. A drafter,
fully offline over local git, turns each new `Revert` or repeat-`fix` commit on `main`
into an `unreviewed` draft case; a GitHub workflow runs it on every push to `main` and
opens a draft-case pull request as `minspec-sdd[bot]` (FR8). A second workflow runs the
gate on any pull request whose reviewer prompt set differs from the baseline's (D1).

## What Plan measured that the spec did not know

Each was read in code or computed at `e9924bf3`, not inferred.

1. **review-branch.sh takes its prompts from beside itself and its diff from the
   caller's directory.** `ROLE_FILE="${SCRIPT_DIR}/roles/${ROLE}.md"`
   (`scripts/review-branch.sh:82`) and `DIFF="$(git diff "${BASE}...${HEAD_REF}")"`
   (`:91`, run in `$PWD`). The guard that supplies `VERDICT_SCHEMA` is resolved from
   `SCRIPT_DIR` too (`:210`). So one checkout's prompts can review a second, separate
   repository by running the first checkout's script with the second as `cwd`. That is
   what makes FR3 ("the prompts production uses, not a copy") cheap: the runner never
   reads a role file itself.
2. **Production's reviewer reads the BASE tree, not the head tree.** `ai-review.yml`
   checks out `github.event.pull_request.base.sha` with `fetch-depth: 0`
   (`.github/workflows/ai-review.yml:280-287`) and feeds the head only as the diff. A
   faithful replay therefore checks out the case's base commit with the head commit
   present for the diff, not the post-change tree.
3. **Production feeds no pull request title or body.** The prompt embeds the defanged
   diff and the approval-provenance block only (`scripts/review-branch.sh`, the
   reviewable-input block after `:140`; `--print-input` at `:68` / `:157` prints it).
   FR1's "minimal context the reviewer receives in production" is therefore the base
   commit plus the patch; `case.json` keeps title and body as provenance for a human,
   and the runner never sends them.
4. **The gate's verdict is a panel, with per-voter rules.** Reviewer always; security
   unless every changed file is `.md` (`ai-review.yml:686`); architect and skeptic only
   when `AI_REVIEW_COVERAGE` is `panel`, the default (`:476-479`, `:694-698`). The
   combine precedence `changes > blocked/unreported > pass` lives in the bracketed
   `verdict-combine` block (`:846-873`), already executed verbatim by
   `packages/minspec/tests/ai-review-verdict-combine.test.ts`.
5. **A voter's verdict is a label from review-decide.sh.** `review-decide.sh` emits
   `ai-review:pass`, `ai-review:changes`, or `ai-review:blocked` for a
   `REVIEW_UNAVAILABLE` block (`scripts/review-decide.sh:71`, `:83`). Findings are
   rendered as `- <severity> <location> — <problem>` lines inside the block
   (`.github/scripts/ai-review-guard.js`, `renderVerdictBlock`, after `:76`), so "the
   reviewer blocked citing the right file" is decidable from the block text.
6. **Real spend per voter run, measured.** 22 voter runs across 6 successful
   `ai-review` runs (2026-11-12, `review-branch.sh: usage` lines, `:340`): median
   `cost_usd` 0.82, range 0.56 to 5.96 (the top four were one large diff with ~0.41M
   cache-write tokens each), median wall time about 2 minutes, all `claude-opus-4-8` on
   the subscription tier. `cost_usd` is the CLI's notional price, not a bill; it is the
   one cost figure the log carries.
7. **A repeat-fix producer already exists, with a different definition.**
   `scripts/lib/repeat-fix-share.ts` computes DR-108's tripwire share: a `fix(#N)` commit
   whose issue an earlier fix already cited, over a 60-day window (`WINDOW_DAYS`, `:39`;
   `fixScopeIssues`, `:66`). The spec's Background says the share "is the eval set's
   case-source count". It is not, today, and making it so would put a second producer
   behind one number. See decision P6.
8. **There are no revert commits on `main`.** `git log origin/main --no-merges` has no
   subject starting `Revert`. Every seed case is therefore a repeat-fix, found by blame.
9. **Seed candidates, blame-verified.** Blaming the lines each later `fix` commit removed
   (in its parent) names the commit that wrote them:

   | Defect commit | Proved by | Gap | Blamed lines |
   |---|---|---|---|
   | `468e3cd4` fix(#607) scope the scaffold commit offer | `a14bd679` fix(#607) also commit scaffold-authored config (an ai-review finding on #610) | 1 day | 19 |
   | `ba2d3df8` fix(#957) write both halves of the lifecycle state (#1651) | `f340a972` fix(#957) make `createIfAbsent` required (#1659) | same day | 12 of 17 |
   | `d1d97eff` fix(#1064) resolve the commit destination before writing (#1089) | `683ef335` fix(#1064) stop warning about a commit never going to happen (#1123) | 2 days | 8 |
   | `683ef335` (#1123) | `43c6f1ed` fix(#1064) pin the net-change probe's untracked mode (#1128) | same day | 2 |
   | `59bdb65d` feat(#1306) reconcile the label board (#1306) | `820388fd` fix(#1855) reconciler claimed "NO merged PR exists" on a failed lookup (#2047) | 37 days | 4 of 6 |

   One fix was rejected as a seed: `577da9b8` fix(#912) blames 170 lines across three
   unrelated older commits because it rewrote a generated, embedded template; that is
   the noise D2's blame rule produces and D4's promotion check must survive (R2).
10. **Ownership changes the approval.** The spec hash strips only `status` and `phases`
   (`packages/minspec/src/lib/approval.ts:6`), so writing `implements:` into
   requirements.md voids the DLG-001 approval. See decision P7.

## Architecture

### Files

| Path | Kind | Purpose |
|---|---|---|
| `scripts/lib/review-eval/case.ts` | new | Case schema, loader, validator (fs, no network, no git). |
| `scripts/lib/review-eval/score.ts` | new | Pure: grading a run, majority, aggregates, flip rate, gate comparison. |
| `scripts/lib/review-eval/replay.ts` | new | Builds the two-commit repository for a case and runs one voter through `review-branch.sh` and `review-decide.sh`. |
| `scripts/lib/review-eval/panel.ts` | new | Voter selection (FR3 parity with `ai-review.yml`) and the panel combine via the verbatim workflow block. |
| `scripts/lib/review-eval/draft.ts` | new | D2 detector and draft writer, local git only. |
| `scripts/lib/review-eval/prompt-hash.ts` | new | The prompt revision hash, per voter and for the set. |
| `scripts/review-eval.ts` | new | CLI: `plan`, `run`, `gate`, `write-baseline`, `draft`, `promote`. |
| `tests/review-eval/cases/<id>/` | new | `case.json`, `defect.patch`, `fix.patch` (repeat-fix and revert only). |
| `tests/review-eval/baseline.json` | new | The committed baseline (FR6). |
| `tests/review-eval/history.jsonl` | new | One result line per on-demand run (FR4). |
| `.github/workflows/review-eval.yml` | new | The D1 gate job. |
| `.github/workflows/review-eval-draft.yml` | new | The FR8 draft-filing job. |
| `package.json` | edit | `"review-eval": "npx tsx scripts/review-eval.ts"`. |
| `packages/minspec/tests/review-eval-*.test.ts` | new | Unit and stub-CLI tests (the repo's `vitest` include is `packages/*/tests/**`, so fixtures under `tests/` are never collected as tests). |

Nothing under `packages/*/src/`, `packages/minspec/templates/` or `.minspec/` changes, and
nothing is scaffolded into an adopter's repository (INV-3).

### Case format (FR1, FR2, FR7, FR10)

```ts
/** tests/review-eval/cases/<id>/case.json */
export interface EvalCase {
  readonly id: string;                 // directory name, kebab-case, unique
  readonly kind: 'revert' | 'repeat-fix' | 'incident' | 'clean-control';
  readonly status: 'unreviewed' | 'scored';   // FR8, D4: only 'scored' counts
  readonly expected:
    | { readonly verdict: 'finding'; readonly file: string; readonly defect: string }
    | { readonly verdict: 'pass' };
  readonly base: string;               // full 40-hex commit the patch applies to
  readonly patchSha256: string;        // sha256 of defect.patch bytes
  readonly changedFiles: readonly string[];   // from the patch; drives voter selection
  readonly provenance: {
    readonly defectCommit: string;     // full sha of the commit that introduced it
    readonly defectPr?: number;
    readonly proofCommit?: string;     // the fix or revert (absent for clean-control)
    readonly proofPr?: number;
    readonly title?: string;           // kept for humans; never sent to the reviewer
  };
  readonly injection?: boolean;        // FR10: the diff carries a prompt-injection attempt
  readonly promotion?: {               // written by `promote`, D4
    readonly at: string; readonly k: number; readonly unanimous: true;
    readonly promptHash: string;
  };
}
```

`loadCases(dir)` validates every field and fails the whole load, naming the case and the
field, on: an unknown `kind`, a `finding` without `file`, a `clean-control` with a
`finding`, a non-40-hex `base`, a `patchSha256` that does not match `defect.patch`, a
`repeat-fix` or `revert` without `fix.patch` and `proofCommit`, an `expected.file` absent
from `changedFiles`, or a duplicate `id`. No case is skipped silently; an invalid case is
an error, not a smaller set (FR9).

FR10: `defect.patch` is applied with `git apply`, committed with hooks disabled
(`-c core.hooksPath=/dev/null`, `--no-verify`) in a throwaway repository, and never
executed. The pre-commit gitleaks scan covers the fixture files when they are committed
to this repository. A case with `injection: true` is a normal case whose report line
says so.

### Replay (FR3, INV-4)

`replayVoter(c: EvalCase, voter: Voter, opts: { checkout: string; workRoot: string;
timeoutMs: number }): Promise<VoterRun>`:

1. Make `<workRoot>/<case>-<voter>-<k>/repo`, `git init`, then write the base tree into it
   with `git -C <checkout> archive <base> | tar -x`. Commit it as `base` with a fixed
   identity and hooks off. A standalone repository is used, not `git worktree add`,
   because a worktree's `.git` file points back at the checkout that holds the answer
   key (`case.json`, `fix.patch`); the reviewer has `Read` and `Glob`, and in `-p` mode
   those resolve absolute paths (R3).
2. `git apply --index <case>/defect.patch`; commit as `head`. A patch that does not apply
   is an error naming the case (FR9).
3. `git checkout --detach base`, so the working tree is the base tree and `head` is
   reachable for the diff, as production has it (measured point 2).
4. Run `bash <checkout>/scripts/review-branch.sh <base> <head> --role <voter>` with
   `cwd` = the repository, stdout and stderr captured to files, timeout `timeoutMs`
   (default 15 minutes). The runner adds no tool, flag or credential: the script's own
   `--allowedTools "Read,Glob,Grep"` and environment allowlist
   (`scripts/review-branch.sh:300`, `:319`, `scripts/lib/agent-context.sh`) apply
   unchanged (INV-4).
5. Pipe stdout through `bash <checkout>/scripts/review-decide.sh`; the label is the run's
   verdict. Parse the verdict block's `findings:` lines for locations. Parse the
   `review-branch.sh: usage` line from stderr for `in`, `cache_write`, `cache_read`,
   `out`, `cost_usd`, `duration_ms`.

```ts
export interface VoterRun {
  readonly label: 'pass' | 'changes' | 'blocked' | 'unreported';
  readonly locations: readonly string[];   // the text before " — " on each finding line
  readonly usage?: { in: number; cacheWrite: number; cacheRead: number; out: number;
                     costUsd: number; durationMs: number };
}
```

A `blocked` or `unreported` run is retried once after 60 seconds. Still unusable, it is
recorded as unusable and the whole run exits non-zero naming the case and voter (FR9);
the score is still printed, marked `incomplete`, and never written as a baseline or
counted as a gate pass.

Voters run with concurrency 4 and a 5-second stagger between starts, the production
stagger (`ai-review.yml`, `VOTER_STAGGER_SECS`), because simultaneous starts were
measured to draw burst-limit blocks (#1086).

### Voter selection and the panel (FR3)

`requiredVoters(c, coverage)` returns `reviewer`; `security` unless every entry of
`c.changedFiles` ends in `.md`; `architect` and `skeptic` when `coverage === 'panel'`.
That predicate is the one copy outside the workflow. A parity test reads
`ai-review.yml` and fails if the `grep -qvE '\.md$'` line or the `ARCHITECT_REQUIRED` /
`SKEPTIC_REQUIRED` panel lines change, so the two copies cannot drift silently.

`combinePanel(labels)` does not reimplement the precedence. It extracts the bracketed
`# >>> verdict-combine` / `# <<< verdict-combine` block from the checkout's
`ai-review.yml`, as `ai-review-verdict-combine.test.ts` does, runs it in `bash` with the
four label variables set, and reads `FINAL`. Missing markers throw.

### Grading and the score (FR2, FR4, FR5; D3)

Per run, `gradeRun(c, run)`:

- defect case (`expected.verdict === 'finding'`): `hit` when the label is `changes` and
  some location names `expected.file` (the full repo path, or its basename when that
  basename is unique among `c.changedFiles`); `misattributed` when `changes` cites
  nothing in `expected.file`; `miss` when `pass`.
- `clean-control`: `pass` when the label is `pass`, `false-block` when `changes`.

Per case and voter over K = 3 runs: the majority outcome (2 of 3) decides, with
`misattributed` counted as not-a-hit. `unanimous` is true when all K outcomes agree.
For the panel, each of the K repetitions combines the required voters' labels from that
repetition, then the same grading and majority apply (the panel's hit needs some
`changes` voter to cite the file).

```ts
export interface EvalResult {
  readonly schema: 1;
  readonly at: string;                   // ISO time, read from the clock at write
  readonly promptHash: string;           // set hash, see below
  readonly voterHashes: Readonly<Record<Voter, string>>;
  readonly k: number;
  readonly coverage: 'single' | 'panel';
  readonly cases: readonly { id: string; caseHash: string; kind: EvalCase['kind'];
    perVoter: Partial<Record<Voter | 'panel', { outcome: string; unanimous: boolean;
    runs: readonly string[] }>> }[];
  readonly aggregates: Partial<Record<Voter | 'panel', {
    nDefect: number; nControl: number; hits: number; falseBlocks: number;
    recall: number; falseBlockRate: number; flipRate: number }>>;
  readonly spend: { voterRuns: number; costUsd: number; tokens: number };
  readonly incomplete: boolean;
}
```

`caseHash` is sha256 over `case.json` plus `defect.patch`, so the gate compares a case
only against a baseline entry for the identical fixture. The one-line summary reads, for
example: `review-eval panel: recall 4/5 (0.80) · false-block 0/3 · N=8 K=3 flip 1/8 ·
prompts 3f9c1a2 · 96 voter runs · $79.10 notional`.

The score refuses (non-zero exit, named reason) when fewer than 3 scored defect cases or
2 scored controls are selected for any reported voter: FR7's floor, so a recall or a
false-block rate is never computed over too little to mean anything (FR2, FR9).

### Prompt revision hash

`voterHash(v)` = sha256 over the bytes of `scripts/roles/<v>.md`, then
`scripts/review-branch.sh`, then `JSON.stringify(VERDICT_SCHEMA)` from the guard.
`promptHash` = sha256 over the four voter hashes in fixed order. The schema is hashed by
value rather than the 2,000-line guard file by bytes, because the guard changes for many
reasons that do not reach the reviewer.

### Baseline and gate (FR6; D3)

`write-baseline <result.json>` writes `tests/review-eval/baseline.json` from a result
that is complete, ran every voter in `panel` coverage, and covers every `scored` case.
It records each voter's per-case outcome, `caseHash`, the voter hashes, K, and the
tolerance:

- `falseBlockTolerance` = 0 (D3).
- `recallTolerance` = `max(1, ceil(flipRate × nDefect))` defect cases, per voter, taken
  from that run's measured flip rate (D3: "set from measured flip rate at first
  baseline"). Stored as a case count, not a ratio, so it does not change meaning when
  cases are added.

Writing a baseline is the deliberate act FR6 names: it is a subcommand, never a side
effect of `run`, and it lands as a reviewed pull request.

`gate <candidate.json> --baseline <path>` compares only cases present in both with equal
`caseHash` (new cases are reported and do not count until the next baseline), only for
voters the candidate ran. For each such voter: fails if candidate false blocks exceed
baseline false blocks over the common controls; fails if baseline hits minus candidate
hits over the common defect cases exceed `recallTolerance`. The panel row is gated when
both sides have it. A missing or unreadable baseline, an incomplete candidate, or zero
common cases exits non-zero naming the reason (FR9, INV-2). No `|| true`, no
`catch {}` around the comparison.

Gating per voter is sufficient for the panel in the direction that matters: the panel
false-blocks a control when any voter does, so no voter's false blocks rising means the
panel's cannot rise from that voter; and a voter whose hits do not fall cannot take a
panel hit away.

### The CLI (D1, INV-1, INV-5)

```
npm run review-eval -- plan   [--voters reviewer,security] [--k 3]
npm run review-eval -- run    --infer [--voters ...] [--k 3] [--max-voter-runs 120] [--out <file>]
npm run review-eval -- gate   <candidate.json> [--baseline tests/review-eval/baseline.json]
npm run review-eval -- write-baseline <result.json>
npm run review-eval -- draft  [--commit <sha> | --since <sha>]
npm run review-eval -- promote --infer [<case-id> ...]
```

- `plan` validates every case, prints the voter-run count (cases × K × required voters)
  and an estimate from the median `cost_usd` and token count of the last 20 voter runs
  in `history.jsonl` (or "no measured history yet" on the first run), and exits 0. It
  makes no network call.
- `run` and `promote` call the model and refuse without `--infer`, exiting non-zero with
  the `plan` estimate in the message (AC 8, INV-1). They also refuse when the planned
  voter runs exceed `--max-voter-runs` (default 120). They are never invoked by
  `npm test`, activation, or any hook (INV-1).
- The runner itself opens no socket. The only egress is `claude -p` inside
  `review-branch.sh`, which is the configured inference endpoint (AC 8).
- `run` appends the result as one line to `tests/review-eval/history.jsonl` unless
  `--no-history` (the CI job passes it, because CI cannot commit).

### Spend (INV-5)

Measured unit (point 6): one voter run, median 0.82 notional USD, about 2 minutes.

| Run | Voter runs | Notional cost at median |
|---|---|---|
| Seed set, one voter (8 cases: 5 defect + 3 controls, K = 3) | 24 | about 20 USD |
| Seed set, full panel (security skips `.md`-only cases) | at most 96 | at most about 79 USD |
| Promotion of one draft (panel, K = 3) | at most 12 | at most about 10 USD |

The share of the weekly budget cannot be computed in this repository: the weekly cap
is read by the dev-time runner's own quota meter, which is not committed here, and
`cost_usd` is a notional price on a subscription. So the CLI prints the absolute
figures above from measured history, and the CI job (below) runs only the voters whose
prompts changed, which is the single-voter row for an ordinary prompt edit. Reviewer-
prompt pull requests are rare (D1's own premise). The full-panel baseline run is
on-demand, once per deliberate baseline update. Task 4.3 records the measured total of
the first baseline run in its pull request.

### The gate job: `.github/workflows/review-eval.yml` (D1, INV-2)

Trigger: `pull_request` on every pull request, with no `paths:` filter, so the check is
always reported rather than left pending. Steps:

1. Check out the PR's BASE commit with `fetch-depth: 0`, exactly as `ai-review.yml`
   does: the runner, the cases, the baseline and `review-branch.sh` all come from BASE.
   The head is fetched for its four role files only.
2. Compute `voterHashes` for HEAD's role files with BASE's harness (`git show
   <head>:scripts/roles/<v>.md`). Unchanged against `baseline.json` for every voter →
   the job passes with a notice naming the hash ("reviewer prompt set unchanged:
   <hash>"). That is a computed fact, not a skip.
3. Otherwise overwrite the changed voters' role files in the ephemeral BASE checkout with
   HEAD's, run `run --infer --voters <changed> --no-history --out result.json`, then
   `gate result.json`. Upload `result.json` as an artifact and write the one-line summary
   to the job summary. The job's conclusion is the gate's exit code.
4. When HEAD changes `scripts/review-branch.sh` or the guard's `VERDICT_SCHEMA`, CI
   still scores HEAD's role files on BASE's harness and says, in the summary, that the
   harness change itself was not executed. A head-controlled harness that executes with
   the inference credential could print any verdict it likes, including a forged hit on
   a case whose answer it can read; the repository's own rule is that a gate cannot
   certify a change to itself (`ai-review.yml`, the machinery notice at `:960`), and
   every such pull request is already held by `machinery-review-required`. The on-demand
   `run` scores a changed harness locally.
5. No inference credential configured → the job fails with "review-eval: no inference
   credential" (never passes). The secret names are the ones `ai-review.yml` already
   uses (`CLAUDE_CODE_OAUTH_TOKEN`, with `ANTHROPIC_API_KEY` and `AI_REVIEW_FAILOVER`
   for failover).

Making `review-eval` a REQUIRED check is a ruleset change, which needs an admin
credential the App does not hold. Task 5.4 files that as an issue once the check has run
green on `main`; until then a red `review-eval` is a failing check that a merge on green
CI does not pass, but it is not enforced by the ruleset (R5).

### The draft job: `.github/workflows/review-eval-draft.yml` (FR8; D2)

Trigger: `push` to `main`. Checks out `main` with `fetch-depth: 0`, runs
`npm run review-eval -- draft --commit $GITHUB_SHA`, and when that wrote any case
directory, commits them on `review-eval/draft-<sha7>` and opens a pull request as
`minspec-sdd[bot]` using `actions/create-github-app-token` pinned to the SHA
`ai-review.yml` pins (`:224`). The pull request touches only `tests/review-eval/cases/`,
so it is not machinery. No founder step.

### The drafter (FR8; D2)

`detectRepeatFix(commit, git)` over local git only:

1. Skip merge commits. A commit whose subject starts `Revert "` and whose body names
   `This reverts commit <sha>.` with `<sha>` reachable from `main` → kind `revert`,
   defect = `<sha>`, proof = the commit.
2. A commit whose subject is a conventional fix, by the existing
   `fixScopeIssues(subject) !== undefined` (`scripts/lib/repeat-fix-share.ts:66`; one
   predicate, reused, not copied) → for each file, the line ranges it removed or changed
   in its parent, `git blame -w --porcelain <commit>^ -L a,b -- <file>`. Exclude
   `package-lock.json` and any file whose patch exceeds 400 changed lines.
3. Keep blamed origin commits that are on `main`'s first-parent line, are not the commit
   itself, and were committed within `WINDOW_DAYS` (60, the same constant DR-108's
   share uses) before it. The defect commit is the origin owning the most blamed lines
   (ties: the most recent). None → not a repeat-fix.
4. Write `cases/<defect-sha7>-<kind>/`: `defect.patch` = `git diff <defect>^ <defect>`,
   `fix.patch` = `git diff <proof>^ <proof>`, `case.json` with `status: unreviewed`,
   `expected: { verdict: 'finding', file: <file with most blamed lines>, defect: <proof
   subject> }`, provenance with both PR numbers parsed from `(#NNN)` at the end of each
   subject. A defect patch over 1,500 changed lines is not drafted; the job log names it
   (INV-5: one case's cost stays bounded).
5. Idempotent: an existing case for the same defect commit is left untouched.

A pure addition fix (it removed no line) blames nothing and is never drafted. That is the
known false-negative of D2's rule, accepted.

### Promotion (D4)

`promote --infer <case-id>...` turns an `unreviewed` case into `scored` when, and only
when: `fix.patch` is present and applies cleanly on top of base plus `defect.patch` (the
proof is attached and links to the defect), and the panel's outcome is unanimous over
K = 3 runs with the current prompts. Unanimous means consistent, not correct: a defect
that every run misses is promoted, because a case the reviewer reliably misses is the
case the set exists to keep. It writes the `promotion` block into `case.json`. Promotion
is a reviewed pull request like any other change to the cases.

## Decisions (recorded alternatives)

- **P1 Replay through the production scripts, from the checkout under test.** Rejected: a
  runner that reads role files and calls `claude -p` itself. It would be a second copy of
  the prompt assembly, defanging and schema handling, which FR3 forbids and which would
  drift (the repo's own lesson: duplicated predicates drift).
- **P2 A standalone two-commit repository per run, base tree checked out.** Rejected:
  `git worktree add` (its `.git` file names the checkout holding the answer key, R3).
  Rejected: checking out the head tree (production reads base, point 2).
- **P3 Score per voter and for the panel; gate per voter.** Rejected: panel only. A
  prompt edit changes one voter, and re-running the other three spends about three
  quarters of the run on unchanged prompts. Rejected: reviewer role only. The gate the
  spec protects is the panel.
- **P4 K = 3, majority 2 of 3.** Rejected: K = 1 (FR5 needs a flip rate). Rejected:
  K = 5 (two thirds more spend for a finer flip estimate the first baseline does not
  need; raise it later if the measured flip rate makes 2-of-3 majority unstable).
- **P5 CI scores HEAD's role files on BASE's harness.** Rejected: running HEAD's
  `review-branch.sh` with the inference credential, which lets the change under test
  print its own score. Cost: a harness change is not scored in CI (R4).
- **P6 Do not turn the eval set into a second repeat-fix share producer.** The DR-108
  tripwire keeps its one producer, `scripts/lib/repeat-fix-share.ts`. The eval's
  `history.jsonl` reports drafted and scored case counts by `kind`, named "case-source
  count", next to that share, not instead of it. Rejected: redefining the tripwire share
  as blame-based repeats. It would change a number a live delegation reads (DLG-001
  suspends past 13%) as a side effect of a measurement spec. The spec's Follow-up asks to
  "wire #2850 at Plan"; this is the wiring: one definition, the second count beside it.
- **P7 Ownership is declared by the slice that creates the first owned file, with
  re-approval in that pull request.** `implements:` is in the spec hash (point 10), so
  setting it voids the DLG-001 approval; the delegated approval path re-approves it. The
  first build pull request (tasks slice 1) sets `implements:` to the full list in the
  Files table that exists by the end of the work, and keeps `phases.implement: pending`
  until the last slice lands, so `implement.claimed-without-evidence` does not fire on
  files later slices create. Rejected: keeping `implements: none` while code lands (a
  false signpost). Rejected: re-declaring per slice (five re-approvals).
- **P8 Draft filing by a push-to-main workflow that opens a pull request.** Rejected:
  hooking the drafter into the drain (host-only, silent while the host sleeps).
  Rejected: filing an issue instead of a case file (FR8 asks for a draft case file).

## Seed set (FR7)

Defect cases, all `repeat-fix`, from the measured table above: `468e3cd4` (#607),
`ba2d3df8` (#957), `d1d97eff` (#1064), `683ef335` (#1064), `59bdb65d` (#1855's
reconciler). They are produced by running the drafter on their proof commits, which
also proves the drafter, and then promoted by `promote` (D4).

Controls: three `feat` commits on `main` older than 60 days, 20 to 300 changed lines,
touching at least one `.ts` or `.sh` file, which no later fix commit's removed lines
blame to within 60 days. Selected by `draft --find-controls`, which runs the same blame
pass over history and lists commits outside the blamed set; the task names the three
chosen and why. A `clean-control` has `expected: { verdict: 'pass' }` and no
`fix.patch`.

Floor met: 5 defect and 3 controls, above FR7's 3 and 2.

## Risks

- **R1 Seed defects are older than the current prompts' knowledge.** The current
  reviewer may know of these exact incidents (the lessons were written into prompts).
  That inflates recall; it does not break the gate, which compares like with like.
  Measured at the first baseline, recorded in its pull request.
- **R2 Blame noise in drafts.** Point 9's `577da9b8` shows a fix that rewrote generated
  content blaming 170 unrelated lines. Drafts are unscored until promoted, and the
  400-line file cap and 1,500-line patch cap keep the worst out; a mislabelled draft that
  replays unanimously can still be promoted (the cost D4 option A accepted).
- **R3 The reviewer can read outside its working directory.** In `-p` mode `Read` and
  `Glob` resolve absolute paths. The answer key is in the checkout, at a path the prompt
  never names, and the standalone repository has no pointer to it. A reviewer that
  searched the filesystem for `case.json` would inflate its score. Residual, accepted;
  the CI job runs from a fresh runner where nothing else is on disk.
- **R4 A harness change is not scored by CI** (P5). It is scored by the on-demand `run`
  and is machinery-held for human review in any case.
- **R5 The check is not required until the ruleset says so.** Task 5.4 files it.
- **R6 Draft-case pull requests carry buggy code as fixture text.** ai-review reads a
  `.patch` that contains the very defect it should flag, and may block the draft pull
  request. Measured on the first draft pull requests (task 5.3); if it blocks, the
  follow-up is a reviewer-prompt rule for `tests/review-eval/cases/`, which is itself a
  prompt change this eval then scores. Out of this spec's scope ("changing reviewer
  behaviour itself").

## Follow-ups (tracked)

- Author-response tracking (fixed / disputed / ignored), named by the spec as a companion
  that would change the D4 rule: #3672.
- Making `review-eval` a required check: task 5.4 files it (it cannot be required before
  it exists).
- #2850, the tenet tie-break measurement: P6 keeps one repeat-fix producer and adds the
  case-source count beside it; no new issue.
