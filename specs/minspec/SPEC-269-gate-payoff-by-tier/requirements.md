---
id: SPEC-269
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - whether the per-tier ceremony pays for itself
aspects: [measurement, tiers, ceremony-cost, repeat-fix, no-silent-gate, offline]
depends_on: []
relates_to: ["#2987", "#2850", "#2854", "#2813", "DR-003", "DR-106", "DR-108", "DR-086"]
implements: none
implements_reason: >-
  Specify phase only. The files this spec will own are decided at Plan, after Decisions D1-D5.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-269: Measure whether each tier's gates pay - repeat-fix share per tier against that tier's ceremony cost

> **This is a SPECIFICATION ONLY.** Written for issue #2987 (queue item cl1). Nothing is
> built until a human reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify),
> and approves it.

## In plain terms

Tenet 2 of the constitution says: spend on specs, gates and review only where that is
cheaper than the expected fix, and "measure both sides (repeat-fix share against ceremony
cost) and re-tune" (`.minspec/constitution.md:11-13`). Today only one side is measured, and
only as a single repo-wide number. This spec adds a producer that splits the repeat-fix
share by spec tier (T1 one-sentence spec ... T4 complete ceremony) and sets it beside what
each tier's ceremony cost, so a gate can be kept or removed on evidence. The founder
accepted up front that the reading may say some gates should go; that is the purpose.

## Measured state (this base, 2026-10-28, HEAD `118548be`)

Every number below was computed in this worktree; none is inherited from prose.

- **A repeat-fix producer already exists**: `scripts/lib/repeat-fix-share.ts` (#2854 item 2),
  read by the DR-108 delegation tripwire (`.minspec/delegations.json:15`, max 0.13) via
  `scripts/lib/autonomy.ts:433`. Its definition (`repeat-fix-share.ts:10-19`): 60-day
  window by committer date, merges excluded; a fix is a `fix:`/`fix(...)`/`fix!:` subject; a
  REPEAT is a fix whose scope cites an issue `#N` that an earlier fix already cited. It is
  repo-wide, has no tier dimension, and fails closed (`share: undefined`) below 80%
  attribution or on a shallow clone. Running it now:
  `{"share":0.0581,"fixes":172,"repeats":10,"attributed":163,"windowStart":"2026-08-30","windowEnd":"2026-10-28"}`.
- **Merged PRs are enumerable offline.** `main` is squash-merged: 493 of 494 first-parent
  commits in the last 60 days end in `(#PR)`.
- **Linking a merged PR to its issue offline is incomplete.** Only 313 of those 494
  first-parent commits cite an issue in a `type(#N)` scope or a `Closes/Fixes/Resolves #N`
  line in the squash body (63%). Many subjects are issue titles (`bug: ...`) with no id.
- **Tier is not recorded offline for most work.** Tier lives in two places:
  - the triage verdict record, a GitHub issue comment written by
    `scripts/dispatch-ready-check.sh --render-record` (`tier: T1|T2|T3|T4`, line 567) -
    every triaged issue has one, but reading it is a network call;
  - spec frontmatter `tier:` - present for T2-T4 only (143 specs: 8 T2, 104 T3, 31 T4;
    **zero T1 specs**, since T1 is a one-sentence spec that lives in the issue).
  A rough grep linked only 60 of the 186 issues cited by `fix(#N)`/`feat(#N)` commits in the
  window to a spec file (heuristic match, precision not checked).
- **Ceremony cost is emitted but not kept.** `scripts/review-branch.sh:340-366` prints a
  `usage` line (input, cache, output tokens, `cost_usd`, turns) to stderr per ai-review run.
  Nothing persists it, and dispatch/spec/triage runs have no equivalent ledger that I found
  (searched `scripts/` for `total_cost_usd`, `cost_usd`, `input_tokens`, `cache_read`:
  only `review-branch.sh` matched). Note the name clash: that line's `tier=` field means
  subscription-vs-PAYG billing, not spec tier.
- **The 2% tie-break is also unmeasured** (DR-106 §3, "a starting value"; #2850 measures it).
  This spec feeds #2850 a cost-per-tier figure; it does not re-tune the 2% itself.

## Root cause (mechanism)

The tier is decided at triage and stored only on the git host, while every existing
measurement reads local git; and ceremony token usage is printed to a CI log instead of a
record. So no local reader can join "which tier" to "was it fixed again" to "what did it
cost", and tenet 2's "measure both sides" has no producer for its cost side at all.

## Definitions (proposed, final wording after Clarify)

- **Unit**: a merged PR - a first-parent commit on the measured ref whose subject ends `(#PR)`.
- **Origin issue**: the issue a merged PR delivers, from the `type(#N)` scope, else a
  `Closes/Fixes/Resolves #N` line in the squash body.
- **Tier of a PR**: the tier of its origin issue (source per D1).
- **Repeat fix**: per D2. Baseline: a later `fix` PR that cites the same origin issue, or
  whose RCDD `Root cause:` line cites the earlier PR or issue.
- **Repeat-fix share for tier T** = PRs of tier T in the window that drew at least one repeat
  fix within the follow-up horizon (D3) / PRs of tier T in the window.
- **Ceremony cost for tier T**: mean and total tokens spent on the gates applied to tier T
  work (spec authoring, Clarify, review voters, re-review rounds, fix rounds), reported as a
  share of the weekly quota cap with the base named (constitution tenet text; memory rule
  "token costs need a %").

## Functional requirements

- **FR-1 Producer.** A pure function plus a thin CLI in `scripts/` (not shipped, like
  `repeat-fix-share.ts`, DR-086 §5) computes, per tier T1-T4 plus an explicit `unknown`
  bucket: merged PR count, repeat count, repeat-fix share, and ceremony cost. Pure core takes
  already-read inputs; I/O lives in a separate reader so the core is unit-testable.
- **FR-2 Window and base are in the output.** Every reading carries the measured ref and its
  SHA, the window start and end (`YYYY-MM-DD`, UTC), the follow-up horizon, the definition
  version, and the cost base (which weekly cap, in tokens). A number without these is not
  emitted.
- **FR-3 Unclassifiable is loud, never 0%.** A PR whose tier or origin issue cannot be
  determined goes to the `unknown` bucket and is counted and listed (PR numbers), never
  dropped. A tier whose classified coverage is below the floor (D4), or whose sample is
  below the minimum n (D4), reports `share: undefined` with a `reason`, and the CLI exits
  non-zero. An empty tier prints `n=0, share: undefined`, never `0%`. Same fail-closed shape
  as `readRepeatFixShare` (shallow clone, git error, unparseable date all yield undefined).
- **FR-4 Cost side is recorded where it is produced.** The ceremony runs that already compute
  usage (at least `review-branch.sh`'s usage line; dispatch and spec runs per D5) write one
  durable record per run keyed by PR or issue number and stage (`spec`, `clarify`, `review`,
  `fix-round`, ...). Writing it must not change any verdict: a failed write is reported
  (stderr line naming the run) and the cost reading for that PR is marked incomplete, not
  zero. A PR with no cost record counts as `cost: unknown` in its tier, never as free.
- **FR-5 Does not disturb the tripwire.** `repeat-fix-share.ts`'s definition and its readers
  (`autonomy.ts`, `delegated-approval*.ts`, `delegated-merge.ts`, `approval-integrity.ts`)
  are unchanged. If the per-tier definition differs from the repo-wide one, the output says
  so and both are printed side by side; the tripwire keeps reading the existing producer
  until a separate decision moves it.
- **FR-6 First reading recorded.** One reading over the window per D3 is committed as a
  dated research note under `docs/research/`, with the full CLI output, the `unknown` list,
  and a per-gate note: for each gate the tier table applies (spec, plan, tasks, Clarify human
  read, ai-review panel, founder approval), whether the reading suggests keep, remove, or
  "insufficient data", with the arithmetic shown (expected fix cost avoided vs ceremony cost).
  A recommendation to remove a founder-facing gate is a proposal to the founder, not an act.
- **FR-7 Re-runnable.** The same CLI over the same ref and window gives the same bytes
  (deterministic ordering, `--today` override as in `repeat-fix-share.ts`), so a later
  reading can be diffed against the first.

## Acceptance criteria

- **AC-1** Fixture history with PRs of each tier, some re-fixed, yields the hand-computed
  per-tier counts and shares; the output contains ref, SHA, window, horizon, cost base.
- **AC-2** A fixture PR with no derivable tier appears in `unknown` by number; with coverage
  forced below the floor the tier's share is `undefined`, a reason is printed, and exit is
  non-zero. Mutation check: deleting the `unknown` bucket or defaulting it to a tier makes
  AC-2 fail.
- **AC-3** A tier with zero PRs prints `share: undefined` and the string `0%` does not appear
  for it.
- **AC-4** Shallow clone, missing git, unreadable date, unreadable cost record each yield an
  undefined reading with a reason, never a number.
- **AC-5** A PR with no cost record reads `cost: unknown`; the tier's cost line says
  incomplete with the count missing.
- **AC-6** Forcing the cost-record write to fail leaves the ai-review verdict byte-identical
  and prints a stderr line naming the run.
- **AC-7** `repeat-fix-share.ts` output on HEAD is unchanged by the change (before/after diff).
- **AC-8** No network call from the producer unless D1 picks the network reader, and then
  only behind an explicit flag; the default run reads local data only.
- **AC-9** The first reading (FR-6) exists, names its base and window, and its per-gate note
  carries arithmetic, not adjectives.

## Invariants this must not break

- **Constitution 1 (offline).** The default producer path reads local git and local files.
  Any GitHub read is opt-in by flag and sits in `scripts/` (dev-time tooling, not the shipped
  extension).
- **Constitution 2 (no silent gate).** The producer is not itself a gate today, but its
  output may become a witness for one (as `repeat-fix-share.ts` became for DR-108). So it
  never emits a number it cannot stand behind: unknown is `undefined` plus a reason plus a
  non-zero exit, never 0%. Cost-record writes may not be `|| true`-swallowed silently: a
  failure prints.
- **Constitution 3 (blast radius).** Records are written inside this repo only (or in a
  location D5 picks under the repo); nothing machine-wide.
- **DR-108 tripwire** keeps its producer and definition (FR-5).
- **No borrowed identity.** The reading may recommend removing a founder gate; it never
  enacts that removal or edits `.minspec/delegations.json`/`autonomy` (DR-086 §2 stop class).

## Decisions needed (Clarify)

All 5 decisions are answered, not ratified: an agent session selected, for each, the option this document
already recommended. No human chose them, and no delegation covers authoring Clarify answers
(DLG-001, DR-108, covers spec approval and engineering-DR acceptance only). This spec is
unapproved, so these answers bind nothing until a human or a covered delegation approves it.

- **D1 - Where the producer reads a PR's tier from.**
  - (a) **(rec)** Make tier local going forward: triage or the PR flow writes the triaged
    tier into the squash commit body as a trailer (`Tier: T2`), and the producer reads git
    only. Backfill the existing window once with a separate opt-in script that reads triage
    verdict records from GitHub and writes a committed lookup file. *Cost:* touches the
    merge/PR-body path (machinery review), and the first reading waits on the backfill.
  - (b) Read the triage verdict record from GitHub at measurement time behind a `--online`
    flag. *Cost:* the measurement needs network and a working token (the app-token broker
    has six known failure modes), and the reading cannot be reproduced offline.
  - (c) Spec frontmatter only. *Cost:* no T1 data at all and roughly a third of issues
    linked; the T1-vs-T3 contrast the issue asks for cannot be read.
  **Recorded selection: Option (a),** tier is made local: a `Tier: T2` trailer in the squash commit body, with a one-off opt-in backfill script. An agent session copied this document's (rec) option; no human chose this item.
- **D2 - What counts as a repeat fix.**
  - (a) **(rec)** Same origin issue cited by a later `fix` PR, OR the later fix's RCDD
    `Root cause:` line cites the earlier PR/issue/SHA. *Cost:* the second arm depends on
    authors citing the cause; a regression filed as a new issue with a prose-only root cause
    is missed, so the share reads low. The output states this bias.
  - (b) Same-issue only, as `repeat-fix-share.ts` does today. *Cost:* misses most real
    regressions, which are filed as new issues; reads low, more so than (a).
  - (c) File-overlap: a later fix touching lines the PR introduced (blame-based). *Cost:*
    much higher compute and false positives from refactors; harder to explain.
  **Recorded selection: Option (a),** a repeat fix is the same origin issue cited by a later `fix` PR, or a later fix whose RCDD `Root cause:` line cites the earlier PR, issue or SHA. An agent session copied this document's (rec) option; no human chose this item.
- **D3 - Window and follow-up horizon.**
  - (a) **(rec)** PRs merged in a 60-day window (matches the existing producer), each
    followed for 30 days after merge, so the window ends 30 days before today. *Cost:* the
    reading lags a month; the newest work is not in it.
  - (b) 90-day window, 30-day horizon. *Cost:* larger samples, but folds in older process
    rules that have since changed.
  **Recorded selection: Option (a),** a 60-day window of merged PRs, each followed for 30 days. An agent session copied this document's (rec) option; no human chose this item.
- **D4 - Floors.** Classified-coverage floor per tier and minimum PRs per tier before a
  share is reported.
  - (a) **(rec)** 80% coverage (same as `MIN_ATTRIBUTION`) and n >= 20. *Cost:* T1 or T4 may
    read `undefined` in the first window; the first reading may say "insufficient data" for
    some gates, which is an honest answer but not a decision.
  - (b) 60% and n >= 10. *Cost:* produces numbers sooner, noisier; a gate could be removed
    on a few PRs.
  **Recorded selection: Option (a),** 80% classified coverage and n >= 20. An agent session copied this document's (rec) option; no human chose this item.
- **D5 - Where cost records live and which runs write them.**
  - (a) **(rec)** An append-only JSONL under the repo (gitignored, e.g. `.minspec/state/`)
    written by review, dispatch (spec and implement) and fix-round runs, plus a CI artifact
    copy for CI-side runs. *Cost:* local-only records do not survive a fresh clone, so the
    cost side of old PRs is permanently `unknown`; the first reading's cost side starts thin.
  - (b) Committed records (one line per run in a tracked file). *Cost:* a commit per run
    from many concurrent sessions - merge conflicts and churn on `main`.
  - (c) Cost side read from a measurement instrument in the scroogellm repo (tee-proxy).
    *Cost:* a cross-repo dependency on a shelved product; the instrument is live but its
    output is outside this repo's blast radius.
  **Recorded selection: Option (a),** an append-only gitignored JSONL under `.minspec/state/`, plus a CI artifact copy for CI-side runs. An agent session copied this document's (rec) option; no human chose this item.

## Out of scope

- Re-tuning the 2% tie-break (#2850 owns it; this spec supplies one input).
- Removing or adding any gate. FR-6 recommends; each removal is its own change with its own
  record.
- Changing the DR-108 tripwire's metric (FR-5).
- Shipping the producer in the extension (DR-086 §5 keeps it in `scripts/`).
- The outside evidence cited in the issue (one vendor benchmark, Uvik, 50 Python tickets) is
  context, not a target the reading must reproduce.

## Follow-ups (tracked)

None filed yet. Plan decides whether the D1 trailer and the D5 cost records are tasks inside
this spec or separate issues; a deferred one gets an issue before this spec leaves Plan.
