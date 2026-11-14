---
id: SPEC-269
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-269 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - whether the per-tier ceremony pays for itself
relates_to: ["#2987", "#2850", "#2854", "#2597", "DR-003", "DR-086", "DR-106", "DR-108"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-269 - Design: gate payoff by tier (Plan)

Plan for [requirements.md](requirements.md) (APPROVED under DLG-001; read, never edited by
this Plan), built under the five recorded Clarify selections: D1 (a) tier made local by a
`Tier:` trailer plus a one-off opt-in backfill, D2 (a) same-origin-issue OR `Root cause:`
citation, D3 (a) 60-day window with a 30-day follow-up horizon, D4 (a) 80% coverage and
n >= 20, D5 (a) an append-only, gitignored JSONL ledger under `.minspec/state/` plus a CI
artifact copy. Citations
of "today" are against `origin/main` `8b3c0017` (2026-11-13). New code is named by symbol,
because its line numbers will move. The task list is [tasks.md](tasks.md).

## Approach in one paragraph

A pure core, `scripts/lib/gate-payoff.ts`, takes already-read inputs (first-parent merged
pull requests with their squash bodies, a PR-to-tier lookup, and ceremony cost records) and
returns one reading: per tier T1-T4 plus `unknown`, the PR count, the PRs that drew a
repeat fix within 30 days, the share (or `undefined` with a reason), and the ceremony cost.
A reader, `scripts/lib/gate-payoff-reader.ts`, does the local I/O (git, the committed
lookup file, the cost ledger) and never touches the network. A CLI, `scripts/gate-payoff.ts`,
prints the reading as deterministic JSON beside the existing repo-wide
`readRepeatFixShare`, and exits non-zero when any tier is unknown. It refuses to print any
reading at all (exit 2, named reason, empty stdout) unless the caller states the weekly cap
in tokens and names its base (FR-2). Two writers make the
inputs exist going forward: a zero-dependency ledger module,
`scripts/lib/ceremony-cost-ledger.mjs`, called from `review-branch.sh` and
`dispatch-issue.sh` with the usage the CLI already returns; and a `Tier: Tn` trailer that
`dispatch-issue.sh` adds to the agent's tip commit before the first push. Two opt-in
`--online` scripts fill the past: one backfills a committed PR-to-issue-to-tier lookup from
triage verdict records, one copies CI ledger artifacts into the local ledger. The first
reading is committed under `docs/research/gate-payoff/`.

## What Plan measured that the spec did not know

Each was run against `8b3c0017`, not inferred.

1. **A squash body is the branch's commit messages, not the PR body.** `gh api
   repos/AIClarityAU/minspec` reports `squash_merge_commit_message: COMMIT_MESSAGES`,
   `squash_merge_commit_title: COMMIT_OR_PR_TITLE`. So D1's trailer only reaches `main` if
   it is in a branch COMMIT message; a line in the PR description is lost at merge. This
   decides where the trailer is written (design decision P1).
2. **No PR on `main` carries a tier today.** `git log origin/main --first-parent
   --since=2026-08-16 --until=2026-10-14 --format=%B | grep -cE '^Tier: T[1-4]'` is 0 over
   378 first-parent commits. The first window is classified by the backfill alone.
3. **The review usage line is younger than the first window.** `emit_usage_line` landed in
   `75cbe2b9` (#2814, 2026-10-16). The first D3 window (60 days ending 2026-10-14) predates
   it, so no ai-review cost exists for any PR in it, from logs or anywhere else. The first
   reading's cost side is `unknown` for every tier, and says so (FR-4, AC-5). This is the
   cost D5 (a) named, now with a date on it.
4. **`dispatch-issue.sh` throws its usage away.** Both agent runs (the build at
   `claude -p "$RUN_PROMPT" ... --output-format text`, and the fix round at
   `claude -p "$fix_prompt" ... --output-format text`) ask for text, which carries no usage.
   `--output-format json` returns the same final text in `.result` beside `usage` and
   `total_cost_usd` (the envelope `emit_usage_line` already parses).
5. **Session transcripts repeat message ids.** A local transcript held 2 assistant lines
   with 1 repeated `message.id`. Reading usage from transcripts would need de-duplication
   and carries no `total_cost_usd`; this is why P3 uses the JSON envelope instead.
6. **The tier is in hand at dispatch time, then deleted.** `dispatch-issue.sh` writes the
   trusted comment bodies to `$VERDICT_SRC` and removes it right after
   `dispatch-ready-check.sh` reads it. `dispatch-ready-check.sh --newest-record` already
   selects the winning record block from that input, and the record carries `tier:` (the
   `--render-record` writer).
7. **Git supports `commit --amend --trailer`** (container git 2.43.0; the flag exists since
   2.32).
8. **Baseline readings.** `npx tsx scripts/lib/repeat-fix-share.ts --ref origin/main` is
   the repo-wide number FR-5 must leave unchanged; task 6.1 records its before/after bytes.

## Design decisions (recorded alternatives, DR-086 section 4)

- **P1 - Trailer goes in the agent's tip commit, amended by the dispatcher before the first
  push.** Because of measurement 1. Rejected: the PR body (dropped at squash); an extra
  empty commit carrying only the trailer (adds noise to every PR, and whether GitHub lists
  an empty commit's message in `COMMIT_MESSAGES` was not verified); a commit-msg hook
  (`.githooks/`, a machinery path, and the hook cannot know the tier offline). Only
  dispatched work gets a trailer; hand-made PRs resolve through the lookup (P2) or land in
  `unknown`, loudly.
- **P2 - The lookup is keyed by PR and is re-runnable.** `scripts/backfill-pr-tier.ts
  --online` writes `docs/research/gate-payoff/pr-tier-lookup.json`: one entry per merged
  PR in a range, `{ pr, issue, tier, source }`, where `issue` is GitHub's
  `closingIssuesReferences` (raises the 63% offline issue link) and `tier` comes from the
  issue's newest TRUSTED triage verdict record, selected by `dispatch-ready-check.sh
  --trusted-comment-bodies` then `--newest-record` (one parser, not a second copy;
  constitution "enforce, don't trust"). Rejected: spec frontmatter `tier:` (D1 (c), no T1
  and heuristic links).
- **P3 - Usage comes from the CLI's JSON envelope, not transcripts.** Because of
  measurements 4 and 5. `dispatch-issue.sh` switches both runs to `--output-format json`
  and pipes the output through `ceremony-cost-ledger.mjs filter`, which prints the
  envelope's `.result` (the bytes text mode printed) and passes every non-envelope line
  through verbatim, so the log, the `ESCALATE:` grep and the crash diagnostics read as
  before.
- **P4 - The local ledger lives under `.minspec/state/` of the MAIN worktree (D5 (a)).**
  Default path `<main worktree root>/.minspec/state/ceremony-cost.jsonl`, where the main
  worktree root is the path on the first `worktree` line of `git worktree list
  --porcelain` (correct from any linked worktree, and with a separate git dir). Resolving
  to the main worktree, not the current one, keeps D5's location while surviving the
  removal of the throwaway worktrees dispatch builds in: every worktree of a clone appends
  to the one file. `.gitignore` gains `.minspec/state/` (task 3.2), and the writer checks
  `git check-ignore -q --no-index <path>` before every append and refuses, with its named
  stderr line, when the path is not ignored, so "gitignored" is enforced rather than
  assumed (a tracked ledger would dirty the primary checkout and churn `main`, D5 (b)'s
  cost). `MINSPEC_COST_LEDGER` overrides the path (CI sets it under `$RUNNER_TEMP`; the
  ignore check is skipped for an explicit override outside any repo). Rejected:
  `.minspec/state/` of the CURRENT worktree (a dispatch worktree's copy is deleted with the
  worktree, losing the records); the git common dir (`.git/minspec/`), which the first
  Plan draft chose, because it departs from the recorded D5 selection without a
  requirements change.
- **P5 - The coverage floor is applied per tier (FR-3, D4 (a)), counting every unknown PR
  against each tier.** An unclassified PR could belong to any tier, so the only per-tier
  coverage that never overstates is the worst case: tier T's classified coverage =
  `prs(T) / (prs(T) + |unknown|)`. Below 0.8 that tier's share is `undefined` with a
  reason naming both counts; tiers above it still report. n >= 20 is also per tier.
  Rejected: one window-wide coverage figure (classified / all PRs), which the first Plan
  draft used and which does not meet FR-3's "a tier whose classified coverage is below
  the floor"; and apportioning unknowns to tiers in proportion to their classified counts,
  which algebraically reduces every tier's coverage to the window-wide figure and so is
  the same rejected rule in disguise. Cost: a small tier needs four classified PRs per
  unknown one, so T1 or T4 can read `undefined` while T3 reports (Risks). A second,
  separate floor is window-wide by necessity and is not D4's: fix PRs in the horizon that
  cite no origin issue and no `Root cause:` reference cannot be linked to any unit, so they
  cannot be assigned a tier and their repeats are invisible to every tier; below 80%
  linkable, every share is `undefined` (mirrors `MIN_ATTRIBUTION`; it only ever withholds
  a number, never adds one).
- **P6 - Ceremony is not the build.** Stages `specify`, `review`, `security-review` and
  `fix-round` sum to ceremony cost. `build` is recorded and printed as work cost, never
  added to ceremony (the implementation would be paid with or without a gate).
- **P7 - The cost base is tokens (FR-2), one named formula.** Every record keeps the four
  raw token classes and the model. Ceremony cost is counted in tokens under formula
  `tokens-sum/1`: input + cache-write + cache-read + output tokens, unweighted. The weekly
  share divides that count by a cap the caller states in the same formula
  (`--weekly-cap-tokens <n> --cap-base "<name>"`, where the name says which weekly cap and
  where the figure came from). The reading prints `cost.formula`, `cost.base` and
  `cost.weeklyCapTokens` beside every share. `total_cost_usd` is kept and printed as an
  additional column (`costUsd`, `meanCostUsdPerPr`), never divided by the cap and never the
  base. A cap figure in any other unit (dollars, a weighted token index) is converted onto
  `tokens-sum/1` by whoever supplies it, before it is passed; the CLI never mixes units
  (memory: a ratio across two formulas gave a 5x wrong claim). Rejected: USD as the base
  (the first Plan draft; FR-2 names tokens); a price-weighted token index (no weights are
  recorded in this repo, so it would be a second, unnamed formula). Cost: the unweighted
  sum counts a cache-read token the same as an output token, so a cache-heavy stage reads
  larger than its price; listed in `bias`.

## Contracts

### Cost record (one JSONL line, `ceremony-cost/1`)

```ts
export type CostStage = 'specify' | 'review' | 'security-review' | 'fix-round' | 'build';
export interface CostRecord {
  readonly v: 'ceremony-cost/1';
  /** Dedup key. CI: `gh-<run_id>-<attempt>-<role>-<n>`; local: crypto.randomUUID(). */
  readonly runId: string;
  readonly at: string;            // ISO-8601 UTC, when the record was written
  readonly stage: CostStage;
  readonly pr?: number;           // when the writer knows it (review, fix-round)
  readonly issue?: number;        // when the writer knows it (dispatch)
  readonly headSha?: string;      // review only
  readonly source: 'review-branch.sh' | 'dispatch-issue.sh';
  readonly model: string;         // same safe-charset rule as emit_usage_line, else 'unknown'
  readonly inputTokens: number;
  readonly cacheWriteTokens: number;
  readonly cacheReadTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number | null; // null when the envelope had no finite total_cost_usd
  readonly turns: number;
  readonly durationMs: number;
}
```

Every numeric field is re-typed as `emit_usage_line` does (finite number, else 0). The
envelope's `result` prose is untrusted and is never copied into a record. A record must be
under 4096 bytes so an `O_APPEND` write of one line is atomic across concurrent writers;
the writer refuses (stderr, exit 3) rather than write a longer line.

### Ledger module (`scripts/lib/ceremony-cost-ledger.mjs`, node only, no dependencies)

- `ledgerPath(env, cwd)` - `MINSPEC_COST_LEDGER`, else
  `<main worktree root>/.minspec/state/ceremony-cost.jsonl` (P4).
- `recordFromEnvelope(envelope, meta) -> CostRecord | undefined` - pure.
- `appendRecord(path, record)` - when `path` is inside a git working tree, first
  `git check-ignore -q --no-index <path>`; not ignored -> refuse (reason `ledger path not
  gitignored`), nothing written. Then `mkdir -p` the parent, one `appendFileSync` with
  flag `a`.
- CLI `append --stage S --source X [--pr N] [--issue N] [--head SHA] [--run-id ID]`:
  envelope on stdin, writes one record, prints nothing on stdout. Any failure prints one
  stderr line `ceremony-cost: no record for <stage> <pr|issue>: <reason>` and exits
  non-zero; callers do not let that exit change their own result (FR-4, AC-6).
- CLI `filter --stage S --source X [--issue N] [--pr N]`: stdin is the CLI's stdout+stderr.
  Lines that are not the result envelope pass through verbatim; the envelope line is
  replaced by its `.result` text plus a newline, and its record is appended. No envelope
  seen -> stderr line naming the run, no record, and the passed-through bytes unchanged.
- Opt-in marker (invariant 3): the module writes only when `MINSPEC_COST_LEDGER` is set or
  the repo root holds `.minspec/`. `review-branch.sh` is mirrored to adopters by
  `gen-ci-templates.mjs`; an adopter's opted-in repo writes into its own
  `.minspec/state/`, nothing machine-wide, and only if that repo ignores the path (else
  the named stderr line and no record; the adopter scaffold's ignore list is not changed
  by this spec).

### Lookup file (`docs/research/gate-payoff/pr-tier-lookup.json`)

```ts
export interface PrTierLookup {
  readonly v: 'pr-tier-lookup/1';
  readonly repo: string;          // 'AIClarityAU/minspec'
  readonly entries: readonly {
    readonly pr: number;
    readonly issue: number | null;           // closingIssuesReferences, lowest number
    readonly tier: 'T1' | 'T2' | 'T3' | 'T4' | null;
    readonly source: 'triage-record' | 'no-issue' | 'no-record' | 'bad-tier';
  }[];                            // sorted by pr ascending, one entry per pr
}
```

No `fetchedAt` field, so a re-run over unchanged GitHub state produces identical bytes.

### Reading (CLI stdout, `gate-payoff/1`)

```ts
export type Tier = 'T1' | 'T2' | 'T3' | 'T4';
export interface GatePayoffReading {
  readonly definition: 'gate-payoff/1';
  readonly ref: string; readonly sha: string;
  readonly windowStart: string; readonly windowEnd: string;  // YYYY-MM-DD UTC, inclusive
  readonly horizonDays: 30; readonly today: string;
  readonly floors: { readonly coverage: 0.8; readonly minPrs: 20; readonly linkable: 0.8 };
  readonly coverage: { readonly classified: number; readonly total: number };
  readonly linkableFixes: { readonly linked: number; readonly total: number };
  readonly tiers: Readonly<Record<Tier, TierReading>>;
  readonly unknown: { readonly prs: readonly number[]; readonly reasons: Readonly<Record<string, number>> };
  readonly conflicts: readonly { pr: number; trailer: Tier; lookup: Tier }[];
  readonly cost: {
    readonly formula: 'tokens-sum/1';      // P7: input + cacheWrite + cacheRead + output
    readonly base: string;                 // which weekly cap, and its source; never empty
    readonly weeklyCapTokens: number;      // finite, > 0, same formula
    readonly ledgerRecords: number; readonly reason?: string;
  };
  readonly repoWide: RepeatFixMeasure;      // readRepeatFixShare, unchanged (FR-5)
  readonly bias: readonly string[];         // fixed sentences, e.g. D2's prose-only miss
}
export interface TierReading {
  readonly prs: number; readonly repeats: number;
  readonly share: number | undefined; readonly reason?: string;
  readonly repeatPrs: readonly number[];
  readonly ceremony: CostSummary; readonly work: CostSummary;
}
export interface CostSummary {
  readonly prsWithRecords: number; readonly prsWithoutRecords: number;
  readonly tokens: { readonly input: number; readonly cacheWrite: number; readonly cacheRead: number; readonly output: number };
  readonly totalTokens: number;                  // tokens-sum/1 over joined records
  readonly meanTokensPerPr: number | undefined;  // over prsWithRecords; undefined when 0
  readonly weeklyShareMean: number | undefined;  // meanTokensPerPr / weeklyCapTokens
  readonly weeklyShareTotal: number | undefined; // totalTokens / weeklyCapTokens
  // Additional column only (P7): never divided by the cap, never the base.
  readonly costUsd: number | undefined;          // undefined when any joined record has costUsd null
  readonly meanCostUsdPerPr: number | undefined; // over prsWithRecords
  readonly reason?: string;                      // why any of the above is undefined
}
```

There is no reading without a cost base: `cost.base` and `cost.weeklyCapTokens` are
required fields, and the CLI refuses before computing when either flag is missing or
invalid (*The CLI*). A JSON document on stdout therefore always carries ref, SHA, window,
horizon, definition and cost base (FR-2).

`JSON.stringify` drops `undefined`, so the CLI serialises through a replacer that writes
`undefined` numbers as the string `"undefined"`. The literal `0%`, or a numeric `0` share,
is never printed for a tier with `prs: 0` (AC-3).

## The pure core (`scripts/lib/gate-payoff.ts`)

Inputs: `units: MergedPr[]` (every first-parent commit up to the end of `today`, each
`{ sha, date, pr, subject, body }`), `lookup: PrTierLookup | undefined`,
`records: CostRecord[]`, `today`, `cap: { tokens, base }` (required; the core also
returns a refusal, not a reading, when `cap.tokens` is not a finite number > 0 or
`cap.base` is blank, so a caller other than the CLI cannot get a base-less reading either).

1. **Units.** A first-parent commit is a merged PR when its subject ends `(#N)` or starts
   `Merge pull request #N `. Others are skipped (direct pushes). Window by committer
   date: `windowEnd = today - 30 days`, `windowStart = windowEnd - 59 days` (D3 (a)).
   Unreadable `today` or commit date -> whole reading undefined with the reason, as
   `measureRepeatFixShare` does.
2. **Origin issue.** First `#N` in the subject's conventional scope `type(#N)`, else the
   lowest `#N` in a `^(Closes|Fixes|Resolves) #N` body line (case-insensitive), else the
   lookup's `issue`. None -> no origin issue.
3. **Tier.** Every body line matching `^Tier:[ \t]*(T[1-4])[ \t]*$`. One distinct value ->
   that tier; two distinct -> `unknown` (reason `conflicting-trailers`). No trailer -> the
   lookup entry's tier. Both present and different -> trailer wins, entry in `conflicts`.
   Nothing -> `unknown` with reason `no-trailer-no-lookup` / `lookup-null` / `no-pr-entry`.
4. **Fix PR.** A unit is a fix PR when its subject matches `repeat-fix-share`'s
   `FIX_SUBJECT`, or its body has a squash commit header line `^\* fix(\([^)]*\))?!?:`, or
   a `^Root cause:` line (the RCDD gate makes every `fix` commit carry one). Reuse
   `fixScopeIssues`; do not copy the regex.
5. **Repeat (D2 (a)).** Unit U (any type, in the window) drew a repeat when a later fix PR
   F (merged after U, at most 30 days after U, F != U) either has U's origin issue as its
   own origin issue, or has a `Root cause:` line citing `#<U.pr>`, `#<U.origin issue>` or
   a 7+ hex prefix of U's squash SHA. Fixes up to `today` are searched; `windowEnd` is 30
   days before `today`, so every unit has its full horizon.
6. **Linkable fixes (P5).** Over fix PRs merged in `[windowStart, today]`: linked = has an
   origin issue or a `Root cause:` line citing any `#N` or SHA.
7. **Shares.** For each tier: `prs = 0` -> `share: undefined`, reason `n=0`;
   the tier's own coverage `prs / (prs + |unknown|)` `< 0.8` (P5) -> undefined, reason
   `coverage <prs>/<prs + unknown> < 0.8 (unknown PRs counted against this tier)`;
   window-wide linkable `< 0.8` ->
   undefined, reason names linked/total; `prs < 20` -> undefined, reason `n=<prs> < 20`;
   else `repeats / prs`. Order of checks fixed so the reason is deterministic.
8. **Cost.** A record joins a unit when `record.pr === unit.pr`, or
   `record.issue === unit.originIssue` (dispatch records carry only the issue). One record
   joins at most one unit: if an issue maps to several units in the window, the record goes
   to the earliest and the reading's `bias` says so. Records are de-duplicated by `runId`
   (last wins). Ceremony stages sum to `ceremony`, `build` to `work` (P6). Token sums and
   `totalTokens` (formula `tokens-sum/1`) are numbers over the records that joined;
   `meanTokensPerPr` and both weekly shares are undefined when no record joined (reason
   names the missing count) or when the reader marked the ledger incomplete (*The
   reader*). Weekly shares are `meanTokensPerPr / cap.tokens` and `totalTokens /
   cap.tokens`. A joined record whose `costUsd` is null makes the tier's USD columns
   undefined and leaves the token shares numeric (USD is not the base, P7).
9. **Ordering.** Every list sorted ascending; object keys emitted in a fixed order, so
   identical inputs give identical bytes (FR-7).

## The reader (`scripts/lib/gate-payoff-reader.ts`)

- `readUnits(repoRoot, ref, git)`: refuses on a shallow clone (`rev-parse
  --is-shallow-repository`), verifies `ref`, then `git log --first-parent
  --format=%H%x1f%cI%x1f%s%x1f%B%x1e ref`. Record separator `\x1e`, field separator
  `\x1f`: bodies contain tabs and newlines. Any git failure -> the reading's top-level
  reason, never a throw (same contract as `readRepeatFixShare`).
- `readLookup(path)`: absent file -> `undefined` (every unit falls to trailer-or-unknown).
  Present but unparseable, or wrong `v` -> a reason; the CLI exits 1 and prints it. A
  silently ignored corrupt lookup would turn into a wall of `unknown` that looks like data.
- `readLedger(paths[])`: each line parsed; a malformed line is counted
  (`cost.reason: "<k> malformed ledger lines skipped"`) and the cost side of the whole
  reading reports incomplete (AC-4). Missing ledger file = zero records, cost `unknown`.
- No `fetch`, no `gh`, no `https` import (AC-8; asserted by a source-text test plus a
  run with `PATH` stripped of `gh`).

## The CLI (`scripts/gate-payoff.ts`)

`npx tsx scripts/gate-payoff.ts [--repo-root D] [--ref R] [--today YYYY-MM-DD]
[--lookup P] [--ledger P]... --weekly-cap-tokens N --cap-base "<name>"`. Defaults: ref
`origin/main`, lookup at the committed path, ledger at `ledgerPath()`. The two cap flags
are required: either missing, `N` not a finite number > 0, or a blank name -> nothing on
stdout, one stderr line `gate-payoff: refusing to emit: no cost base (<which flag and
why>); FR-2 requires the weekly cap in tokens and its name`, exit 2, checked before any
git read. Otherwise prints one JSON document. Exit 0 when all four tiers have a share; 1
when any is undefined (FR-3) or the lookup is unreadable; 2 on bad or missing arguments,
including the cost base. npm script `measure:gate-payoff`. It is not wired
into `lint`, `pretest` or CI: it is a measurement, not a gate (constitution invariant 2
applies the day something gates on it, which is a separate decision).

## The writers

- **`review-branch.sh`.** Beside `emit_usage_line` (which stays byte-identical), a new
  `record_cost` pipes `$AGENT_OUT` to `node "$SCRIPT_DIR/lib/ceremony-cost-ledger.mjs"
  append --stage <review|security-review> --source review-branch.sh --pr "${PR_NUMBER:-}"
  --head "$HEAD_REF"`. A non-zero exit prints its stderr line and is otherwise ignored, with
  a `# swallow-ok:` annotation naming why (observability, the verdict must not change).
  The verdict path never reads the ledger. Roles other than reviewer and security map to
  `review` (they are review voters).
- **`ai-review.yml`** (machinery). Sets `MINSPEC_COST_LEDGER: ${{ runner.temp
  }}/ceremony-cost.jsonl` on the voter steps and adds one `actions/upload-artifact` step,
  `if: always()`, name `ceremony-cost-${{ github.event.pull_request.number }}-${{
  github.run_id }}-${{ github.run_attempt }}`, `if-no-files-found: warn` (a missing ledger
  is visible, never an error that changes the review). `gen-ci-templates.mjs` re-run so the
  template mirror matches.
- **`dispatch-issue.sh`** (machinery by the gate's own reading, task 4 checks).
  (a) Before `$VERDICT_SRC` is removed, `TRIAGE_TIER` is read from
  `dispatch-ready-check.sh --newest-record`'s `tier:` field and kept only if it matches
  `^T[1-4]$`. (b) After a successful, non-escalated agent run and BEFORE the egress guard,
  `add_tier_trailer` runs `git commit --amend --no-edit --trailer "Tier: $TRIAGE_TIER"` on
  the branch tip, only when the tip is a commit the agent made in this run (tip differs
  from the base SHA) and the message has no `Tier:` line yet. A failure prints one line
  naming the step and the state (no trailer; the PR still opens and its tier resolves via
  the lookup or `unknown`). Placing it before the egress guard keeps "scan, then push" as
  the last two steps. (c) Both `claude -p` runs switch to `--output-format json` piped
  through `ledger filter --stage "$COST_STAGE" --source dispatch-issue.sh --issue
  "$ISSUE" [--pr N]`, before the existing `tee`. The stage is chosen by one function,
  `cost_stage_for_run <run> <specify_only>`: the fix-round run is always `fix-round`; the
  first (agent) run is `specify` when `SPECIFY_ONLY` is `1` and `build` when it is `0`.
  `SPECIFY_ONLY` is the dispatcher's existing mode switch, set from the dispatch gate's
  `ready` / `ready-specify` answer (an unrecognised affirmative already falls to `1`, the
  restrictive reading), so the label follows the mode the run actually executed, never
  the issue's labels. Any other `SPECIFY_ONLY` value prints a named stderr line and the
  run records no cost (no guess between ceremony and work).

## The opt-in online scripts (dev-time, `scripts/`, DR-086 section 5)

- `scripts/backfill-pr-tier.ts --online --from YYYY-MM-DD [--to YYYY-MM-DD]`. Refuses
  without `--online` (exit 2, no network). Enumerates merged PRs from local first-parent
  history (no list call), then per PR one GraphQL read for `closingIssuesReferences` and
  the closing issue's comments (author login and body), fed to the
  `dispatch-ready-check.sh` selectors. Merges into the existing lookup by `pr` (a re-run
  replaces an entry, never duplicates). Token via the caller's `GH_TOKEN`; never printed.
- `scripts/fetch-ceremony-cost.ts --online [--since YYYY-MM-DD]`. Lists ai-review runs'
  artifacts named `ceremony-cost-*`, downloads each, appends lines whose `runId` the local
  ledger does not already hold. Prints counts: fetched, appended, duplicate, malformed.

## FR-6 first reading

`docs/research/gate-payoff/<YYYY-MM-DD>-reading.md`: the command line, the full JSON, the
`unknown` PR list, and a per-gate table for spec, plan, tasks, Clarify human read,
ai-review panel and founder approval. Each row: which tiers the gate applies to (from the
CLAUDE.md tier table), the arithmetic `expected avoided fix cost = (share of the tier
below - share of this tier) x mean tokens of a repeat fix` against `mean ceremony tokens
per PR of this tier`, each also shown as a share of the named weekly cap (`tokens-sum/1`,
P7), and a verdict keep / remove / insufficient data. By measurement 3, every
cost term in the first window is undefined, so the first reading's verdicts are
"insufficient data" on the cost side for every gate, with the date at which a re-run
first can carry a cost term: 2026-11-15, when `windowEnd` (today minus 30 days) first
reaches 2026-10-16, the merge date of the first PR with a review usage line. A window full
of cost data needs a further 60 days (2027-01-14). A
remove verdict is phrased as a proposal to the founder, never an act (requirements,
invariants).

## Invariants

- **Offline (1).** The producer, reader and CLI make no network call. Only the two
  `--online` scripts do, and only with the flag. The ledger writer is local file I/O.
- **No silent gate (2).** Every unknown is `undefined` + reason + exit 1, never 0 or 0%.
  Cost-record failures print a named stderr line; the one deliberate ignore of its exit
  status carries `# swallow-ok:` with the reason, because the reading is not a gate today
  and the verdict must not depend on it.
- **No number without its base (FR-2).** No cap in tokens with a named base -> no
  reading on stdout, exit 2.
- **Blast radius (3).** Ledger under the clone's own gitignored `.minspec/state/` or the
  CI runner temp dir;
  lookup and readings in this repo's `docs/research/`. The writer is inert without
  `.minspec/` or an explicit ledger path.
- **DR-108 tripwire (FR-5).** `scripts/lib/repeat-fix-share.ts` and its five readers are
  not edited. Task 6.1 diffs its output before and after.
- **No borrowed identity.** Nothing edits `.minspec/delegations.json` or autonomy config.

## Risks

- **Coverage may stay under 80%.** Hand-made PRs (planner and CoS sessions like this one)
  carry no trailer, and their issues often have no triage record. If the backfill shows
  coverage under the floor, every share is `undefined` and the reading says why. The
  remedy (a trailer writer for non-dispatched PRs) is a decision the first reading informs;
  task 7.2 files it as an issue only if the first reading's coverage is below the floor.
  Because P5 counts every unknown PR against each tier, a small tier hits the floor first
  (it needs four classified PRs per unknown one).
- **No cap figure in tokens.** If the only weekly-cap figure available is in another unit,
  task 7.1 stops rather than emit (FR-2); converting it onto `tokens-sum/1` is the
  supplier's step, recorded in the `--cap-base` name.
- **The amend touches the agent's commit.** It reruns the repo's commit hooks on an
  unchanged tree. A hook failure leaves the commit unamended (P1 fallback), never blocks
  the publish.
- **`--output-format json` holds the text until exit.** Text mode does too (it prints only
  the final result), so the log's timing does not change. The filter is tested to pass
  stderr lines and a crashed run's partial output through byte for byte.
- **Squash SHA citations need 7+ hex.** Shorter SHAs in `Root cause:` lines are not
  matched; listed in `bias`.

## Follow-ups (tracked)

- Trailer writer for non-dispatched PRs: filed by task 7.2 only if the first reading's
  coverage is under the floor (it then changes the next decision about the reading).
- Re-reading once the window is full of cost data (2027-01-14): task 7.2 adds one dated
  line to `docs/backlog.md` (it bears on no decision inside 30 days, so no issue).
- Triage-run cost (stage `triage`) is not recorded: task 7.2 adds the backlog line
  "SPEC-269 records no triage-run cost; add a `triage` stage if a reading shows triage
  dominates ceremony".
