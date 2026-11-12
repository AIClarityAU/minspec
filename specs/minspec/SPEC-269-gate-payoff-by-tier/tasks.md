---
id: SPEC-269
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-269 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - whether the per-tier ceremony pays for itself
relates_to: ["#2987", "#2854", "#2597", "DR-086", "DR-108"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-269 - Tasks

The order below is the order of work. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md), which no task edits. Each task names the requirement
IDs it satisfies, the files it touches and the test that proves it.

Pull requests, so the measurement lands without waiting on machinery review:

- **The producer PR** (groups 1-3 and 6): `scripts/lib/`, `scripts/*.ts`, `package.json`,
  tests. No machinery path.
- **The writers PR** (group 4): touches `scripts/review-branch.sh`,
  `scripts/dispatch-issue.sh` and `.github/workflows/ai-review.yml`, so it needs the
  machinery merge. Before opening it, read what `machinery-review-required` says about the
  branch rather than guessing from paths.
- **The backfill PR** (group 5) and **the reading PR** (group 7), in that order.

Shared rules for every task:

- Tests first. Each task's test is written and seen RED against `origin/main` before the
  code that turns it green.
- Tests live in `packages/minspec/tests/` (where `repeat-fix-share.test.ts` lives). Run
  `npx vitest run packages/minspec/tests/<file>` from the repo root (CI's shape), then
  `npm run validate` and `npm run lint` before calling a task done. Typecheck each new test
  file with `npx tsc --noEmit -p packages/minspec` or a direct `tsc` on the file: tests are
  outside the include globs.
- `scripts/lib/repeat-fix-share.ts` is imported, never edited (FR-5).
- No network in any test. The two `--online` scripts are tested through injected runners.
- Every "unknown" assertion checks three things: the value is `undefined` (or the string
  `"undefined"` in CLI output), a `reason` is present, and the CLI exit is 1.

## 1 - The pure core (FR-1, FR-2, FR-3, FR-7; AC-1 to AC-3)

- [ ] **1.1** `packages/minspec/tests/gate-payoff.test.ts` (new) - T0 cases against
  `computeGatePayoff` from in-memory `MergedPr` fixtures (helper `pr(n, date, subject,
  body)`), `today` fixed:
  - AC-1: 25 PRs of each tier in the window, hand-picked so T1 has 5 repeats, T2 3, T3 2,
    T4 1, assert exact `prs`, `repeats`, `share`, `repeatPrs`, and that the reading holds
    `ref`, `sha`, `windowStart`, `windowEnd`, `horizonDays: 30`, `definition`.
  - Window arithmetic: `today=2026-11-13` -> `windowEnd=2026-10-14`,
    `windowStart=2026-08-16`; a PR merged 2026-10-15 is not a unit.
  - Repeat arms (D2): same origin issue; `Root cause:` citing `#<pr>`; citing
    `#<origin issue>`; citing a 7-hex SHA prefix. Each alone yields one repeat. Negative
    controls: a fix 31 days later; a fix that is the unit itself; a 6-hex SHA; a feat (not
    fix) PR on the same issue.
  - Fix PR detection: subject `fix(#9): x`; subject `bug: x` with body line
    `* fix(#9): x`; subject `bug: x` with a `Root cause:` line; subject `feat: x` with none
    -> not a fix.
  - Tier precedence: trailer only; lookup only; both agree; both differ (trailer wins,
    entry in `conflicts`); two different trailers -> `unknown`, reason
    `conflicting-trailers`; a prose line `see Tier: T2 above` -> not a trailer.
  - Origin issue precedence: scope beats `Closes`; lowest `Closes` id; lookup fallback.
  - AC-2: one PR with no tier -> listed in `unknown.prs`. Coverage forced to 79% -> every
    tier `share: undefined` with a reason naming classified/total. Linkable fixes at 79%
    -> same, reason names linked/total. 19 PRs in a tier -> `undefined`, reason
    `n=19 < 20`.
  - AC-3: a tier with zero PRs -> `share: undefined`, reason `n=0`.
  - FR-7: shuffle the input array, the output is deep-equal and `JSON.stringify` equal.
  - Unreadable `today` or commit date -> top-level reason, no tier has a number.
  *Done when:* RED on `origin/main` (missing module), observed once before 1.2.
- [ ] **1.2** `scripts/lib/gate-payoff.ts` (new) - types and `computeGatePayoff` exactly
  as design.md, *The pure core*, steps 1-7 and 9. Import `fixScopeIssues` from
  `./repeat-fix-share`. Export the floors as constants beside `WINDOW_DAYS`-style names
  (`HORIZON_DAYS = 30`, `MIN_COVERAGE = 0.8`, `MIN_TIER_PRS = 20`, `MIN_LINKABLE = 0.8`).
  *Done when:* 1.1 is green.
- [ ] **1.3** Mutation check (AC-2): in a scratch copy, (a) delete the `unknown` bucket
  push, (b) default an untiered PR to `T3`, (c) drop the coverage floor. Run 1.1 against
  each; each must fail. Record the three failing test names in the PR body. Revert.

## 2 - Cost join (FR-4; AC-5)

- [ ] **2.1** `packages/minspec/tests/gate-payoff.test.ts` - a `describe('cost')`:
  - records joined by `pr`; by `issue` to the unit whose origin issue matches; an issue
    shared by two units joins the earlier and adds the `bias` sentence;
  - duplicate `runId` counted once (last wins);
  - `build` sums into `work`, never `ceremony` (P6);
  - a unit with no record counts in `prsWithoutRecords`; the tier's `reason` says
    incomplete with that count (AC-5);
  - one joined record with `costUsd: null` -> tier `costUsd: undefined` with reason, token
    sums still present;
  - no `cap` -> `weeklyShareMean` and `weeklyShareTotal` undefined, reason names the two
    flags; with `cap {usd: 1000, base: 'x'}` -> exact arithmetic.
  *Done when:* RED before 2.2.
- [ ] **2.2** `scripts/lib/gate-payoff.ts` - step 8 of the design. *Done when:* 2.1 green.

## 3 - Ledger module (FR-4; AC-6 groundwork)

- [ ] **3.1** `packages/minspec/tests/ceremony-cost-ledger.test.ts` (new):
  - `recordFromEnvelope` on a real-shaped envelope (copy the field names
    `emit_usage_line` reads) -> exact record; `result` prose never appears in the record;
    a non-finite token -> 0; a model id outside the safe charset -> `'unknown'`; no
    `total_cost_usd` -> `costUsd: null`.
  - `ledgerPath`: env override wins; otherwise `<git common dir>/minspec/ceremony-cost.jsonl`
    in a temp repo, and the same path from a linked worktree of that repo.
  - `append` CLI (subprocess, `node scripts/lib/ceremony-cost-ledger.mjs`): writes one
    line; second call appends; with no `.minspec/` and no env var -> writes nothing, exit
    0 with a stderr line saying it is inert; unparseable stdin -> exit non-zero, stderr
    names stage and pr/issue; a record over 4096 bytes -> exit 3, nothing written.
  - `filter` CLI: input `noise line\n<envelope>\nstderr line\n` -> stdout is
    `noise line\n<.result>\nstderr line\n` and one record appended; input with no envelope
    -> stdout byte-identical to input, a stderr line, no record; an envelope whose
    `.result` contains `ESCALATE: x` -> that line is on stdout (the dispatcher's grep still
    sees it).
  - Concurrency: 20 parallel `append` subprocesses -> 20 parseable lines.
  *Done when:* RED before 3.2.
- [ ] **3.2** `scripts/lib/ceremony-cost-ledger.mjs` (new, node built-ins only) - as
  design.md, *Ledger module*. *Done when:* 3.1 green.

## 4 - Writers (FR-4, D1 trailer; AC-6) - the writers PR, machinery

- [ ] **4.1** `packages/minspec/tests/review-branch-cost-record.test.ts` (new) - source the
  `record_cost` function out of `scripts/review-branch.sh` (the pattern
  `dispatch-escalate-retry.test.ts` uses) with `AGENT_OUT` set to a fixture envelope and
  `MINSPEC_COST_LEDGER` at a temp path: one record with `stage: 'review'`, `pr` from
  `PR_NUMBER`. AC-6: point `MINSPEC_COST_LEDGER` at an unwritable path; `record_cost`
  returns 0, stderr holds the `ceremony-cost:` line, and the verdict block rendered from
  the same `AGENT_OUT` is byte-identical to a run with a writable ledger. Assert
  `emit_usage_line`'s output is unchanged by the change (before/after on the fixture).
- [ ] **4.2** `scripts/review-branch.sh` - add `record_cost` and call it after
  `emit_usage_line`, as design.md, *The writers*. The ignored exit carries a
  `# swallow-ok:` note naming why. *Done when:* 4.1 green and
  `npm run check:swallowed-gate` stays green.
- [ ] **4.3** `packages/minspec/tests/dispatch-tier-trailer.test.ts` (new):
  - `triage_tier_from_verdict` (sourced out of `dispatch-issue.sh`) on a verdict-source
    fixture with two records -> the newest record's tier; on `tier: T9` or no record ->
    empty.
  - `add_tier_trailer` in a temp repo: tip made after the base SHA, no `Tier:` line ->
    amended, message ends `Tier: T3`, tree SHA unchanged; tip equals base -> no amend; a
    message already holding `Tier: T2` -> no amend; a failing commit-msg hook -> commit
    unchanged, one stderr line naming the step, return 0.
  - Wiring (source text, with a behavioural partner above): `add_tier_trailer` is called
    before `run_egress_guard` on the completion path; both `claude -p` calls pass
    `--output-format json` and pipe through `ceremony-cost-ledger.mjs filter` before
    `tee`, with stages `build`/`specify` and `fix-round`.
- [ ] **4.4** `scripts/dispatch-issue.sh` - (a) read `TRIAGE_TIER` before `$VERDICT_SRC`
  is removed; (b) `add_tier_trailer`; (c) the two `--output-format json | filter` changes.
  Re-run `dispatch-escalate-retry.test.ts` and every `dispatch-*.test.ts` unchanged.
  *Done when:* 4.3 green and the full `packages/minspec/tests` suite is green.
- [ ] **4.5** `.github/workflows/ai-review.yml` - `MINSPEC_COST_LEDGER` on the voter steps
  and the `upload-artifact` step (design.md, *The writers*); then
  `node scripts/gen-ci-templates.mjs` so the template mirror matches. Test: extend
  `packages/minspec/tests/` with an assertion that the workflow sets the variable and
  uploads `ceremony-cost-*` with `if: always()` and `if-no-files-found: warn`, and that the
  template drift check passes.

## 5 - Backfill and fetch (D1 (a) backfill, D5 (a) CI copy; AC-8)

- [ ] **5.1** `packages/minspec/tests/backfill-pr-tier.test.ts` (new): without `--online`
  -> exit 2 and the injected runner was never called; with it, an injected GraphQL runner
  returning a closing issue whose newest TRUSTED record says `tier: T2` -> entry
  `{pr, issue, tier: 'T2', source: 'triage-record'}`; an untrusted author's newer record
  -> ignored (the selector is `dispatch-ready-check.sh`'s, invoked for real); no closing
  issue -> `source: 'no-issue'`; a re-run merges by `pr` and the file bytes are identical
  for identical inputs.
- [ ] **5.2** `scripts/backfill-pr-tier.ts` (new) - as design.md. *Done when:* 5.1 green.
- [ ] **5.3** `packages/minspec/tests/fetch-ceremony-cost.test.ts` (new): injected runner
  with two artifacts, one holding a `runId` already in the local ledger -> counts
  `fetched 2, appended 1, duplicate 1, malformed 0`; without `--online` -> exit 2, no call.
- [ ] **5.4** `scripts/fetch-ceremony-cost.ts` (new). *Done when:* 5.3 green.

## 6 - Reader and CLI (FR-2, FR-3, FR-5, FR-7; AC-4, AC-7, AC-8)

- [ ] **6.1** `packages/minspec/tests/gate-payoff-cli.test.ts` (new), subprocess against a
  temp repo built with real `git commit`s (subjects ending `(#N)`, bodies with trailers):
  - output carries ref, sha, window, horizon, definition, cost base (AC-1 end to end);
  - AC-4: a `git clone --depth 1` copy -> undefined reading, reason names the shallow
    clone, exit 1; `--today 2026-13-40` -> reason, exit 1; a corrupt lookup -> reason,
    exit 1; a ledger with one malformed line -> cost reason counts it;
  - AC-3: a tier with no PRs prints no `0%` and no numeric `0` share;
  - AC-7: `npx tsx scripts/lib/repeat-fix-share.ts --ref <fixture HEAD> --today <d>`
    output equals the CLI's `repoWide` field, and running it on `origin/main` before and
    after this branch gives identical bytes (record both in the PR body);
  - AC-8: the CLI run with `PATH` holding only `node` and `git` succeeds (no `gh` reached);
    `gate-payoff.ts` and `gate-payoff-reader.ts` source has no `fetch(`, `https`,
    `child_process` call naming `gh`;
  - FR-7: two runs, identical stdout bytes.
- [ ] **6.2** `scripts/lib/gate-payoff-reader.ts` and `scripts/gate-payoff.ts` (new);
  `package.json` adds `"measure:gate-payoff": "npx tsx scripts/gate-payoff.ts"` and no
  other script references it. *Done when:* 6.1 green.

## 7 - First reading (FR-6; AC-9)

- [ ] **7.1** Run `scripts/backfill-pr-tier.ts --online --from <windowStart>` with an App
  token, commit `docs/research/gate-payoff/pr-tier-lookup.json`. Then run
  `npm run measure:gate-payoff -- --weekly-cap-usd <n> --cap-base "<name>"` with the cap
  figure and its source taken from the runner's latest measurement (or without the flags,
  in which case the reading says the weekly share is undefined and why). Commit
  `docs/research/gate-payoff/<date>-reading.md`: command, full JSON, `unknown` list, and
  the per-gate table with arithmetic per design.md, *FR-6 first reading*. Any "remove"
  verdict is worded as a proposal to the founder. *Done when:* `npm run validate` green and
  a grep of the note finds a number or "insufficient data" in every verdict cell (AC-9).
- [ ] **7.2** Follow-ups from the reading: if coverage is under 80%, file one issue
  (`inbox`) for a trailer writer on non-dispatched PRs, citing the reading's numbers; add
  the two dated `docs/backlog.md` lines named in design.md, *Follow-ups (tracked)*.
  requirements.md (and its `implements:` field) is not edited by any task here.
