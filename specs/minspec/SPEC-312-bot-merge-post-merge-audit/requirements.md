---
id: SPEC-312
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - same epic as DR-112 (the bot-merge record whose Cost section this audit watches)
aspects: [merge, admin, bypass, bot, audit, fail-closed, governance, no-silent-gate, security]
depends_on: []
relates_to: ["#3039", "#1394", "#596", "#2870", "DR-112", "DR-119", "DR-111", "DR-086", "SPEC-287", "SPEC-296"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan. Expected surface:
  one new workflow under `.github/workflows/`, one audit script plus a pure judge under
  `scripts/` and `scripts/lib/`, and tests. None of it is claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-312: After every merge by the pipeline's bot, a check on `main` proves the merged head's checks were green or red only by design, and fails visibly when they were not

> **This is a SPECIFICATION ONLY.** Written for issue #3039 (post-merge audit of bot admin
> merges). Nothing is built until a human reads it, resolves
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.
>
> Design rests on **DR-112** (the bot merges once CI is green, a second independent AI review
> agrees, and the merge is pinned to the reviewed commit; `status: accepted` on `main` at
> `1b8bebe1`). This spec is the follow-up that DR-112's `## Follow-ups (tracked)` names for
> #3039. A choice that record makes is recorded here as decided and is not reopened. "The
> record's section N" means DR-112's. DR-119 (the delegated-approval merge lane) is the
> second producer of bot merges and is covered by the same audit.

## In plain terms

Once the founder adds the minspec-sdd GitHub App as a bypass actor on `main`'s ruleset, GitHub
lets the App merge any pull request past any rule, including a real failing check. DR-112 keeps
that bypass narrow, but only through the runner's merge helper; a session that calls `gh`
directly with a minted App token is not stopped by anything GitHub enforces (the record's Cost
section says so). This spec builds the watcher: after every merge the bot makes, a check
running from `main` reads the checks on the commit that was merged and goes red, and files an
issue, if any of them was failing outside the four self-certification gates, if a required
check never ran, or if a check had not finished when the merge happened. It does not prevent
a bad merge. It makes one impossible to miss.

## Measured state (this base, `1b8bebe1`, read-only, offline)

- **DR-112 is accepted** (`docs/decisions/DR-112.md:3`, `status: accepted`). Its section 4
  ("What is never bypassed") lists any failing check other than the four by-design states,
  and any missing required check, as never bypassed. Its Cost section names this audit as
  the bound on the gap.
- **The four by-design states are produced by `ai-review.yml`.** `machinery-review-required`
  is a check-run posted as `minspec-sdd[bot]` (`.github/workflows/ai-review.yml:1241-1289`);
  `ai-review/pass` is a commit status (`.github/workflows/ai-review.yml:1338-1388`). The
  `machinery-review-required` post can fail with only a `::warning`
  (`.github/workflows/ai-review.yml:1256,1283,1289`), so on a machinery pull request that check
  may be absent. DR-112 section 3, item 1 requires that it ran.
- **A reader of the ruleset's required checks and a head-commit check reader already exist**
  in `scripts/alta-self-merge.ts:141-160` (`readRequiredChecks`, throws on empty or
  unreadable) and `scripts/alta-self-merge.ts:167-` (`failingRequiredChecks`, which honours a
  rule's `integration_id` so a same-named check from another App does not count). Plan
  decides whether to reuse or extract them; this spec requires the same producer-pinning
  property (FR-5).
- **The closest existing detector is `main-red-watch.yml`** (#1394): a `workflow_run`
  watcher on `main` that files one labelled issue per episode and turns its own run red if it
  cannot report. Its shape (App-token attribution, values passed through `env`, no `|| true`
  on the reporting path, a final `if: failure()` step) is the pattern this spec follows.
- **Not measured here, and needed at Plan:** the numeric user id of `minspec-sdd[bot]`
  (distinct from App id 4212099), whether the App installation can read the rule-suites
  (ruleset bypass) log, and whether a push to `main` made by an App-token merge triggers a
  `push` workflow on this repository. Each is stated below as an assumption to verify, not a
  fact. I believe the third is true (pushes made with an App installation token, unlike
  `GITHUB_TOKEN`, do trigger workflows), unverified.

## Functional requirements

- **FR-1 Which merges are audited.** Every pull request into `main` of AIClarityAU/minspec
  whose `merged_by` is the pipeline's bot account. The bot is identified by account id and
  type (`type: Bot` and the configured numeric user id), never by the bare login, per
  SPEC-287 (bot identity by account, not login). This covers merges through the runner's
  helper (DR-112), the delegated-approval lane (DR-119), the founder's-own-approval lane
  (DR-111), and any direct `gh` call with a minted token, because the audit reads who merged,
  not which path did it. Merges by any other account are counted in the summary (FR-9) and
  not judged.

- **FR-2 The commit judged is the head that was merged.** For each audited pull request, the
  audit judges the pull request's `head.sha` as recorded at merge (the commit the checks ran
  on), not the squash commit on `main`. A pull request whose head sha cannot be read is a
  failure (FR-7).

- **FR-3 What counts as a pass.** On the merged head, every check-run (latest per name and
  App) and every commit status (latest per context) must, **as of the merge time**
  (`merged_at`), be one of:
  - concluded SUCCESS, SKIPPED or NEUTRAL (record section 1(a)); or
  - one of the four self-certification gates in its by-design state - `ai-review` NEUTRAL,
    `machinery-review-required` ACTION_REQUIRED, `ready-to-merge` FAILURE, `ai-review/pass`
    FAILURE - **and only when the pull request is machinery**, proved by
    `machinery-review-required` having concluded ACTION_REQUIRED on that same head (record
    section 3, item 1).

  Anything else is a violation: a FAILURE, CANCELLED, TIMED_OUT, STALE, ACTION_REQUIRED or
  ERROR outside those four; a by-design state on a pull request that is not proved machinery;
  a check that was still queued or in progress at `merged_at`; or a check whose only
  completion is later than `merged_at` (a re-run that went green after the merge does not
  retroactively clear it). This applies to all checks, not only required ones, because the
  record's sections 1(a) and 4 say "every latest check" and "any failing required or
  non-required check" (the issue body says "required checks"; the accepted record is wider,
  and the record wins).

- **FR-4 Missing required checks.** Every check the ruleset requires on `main` must have a
  result on the merged head that completed at or before `merged_at`. A required check that
  never ran is a violation (record section 4: a missing witness fails closed), never read as
  passed. The required set is read from the ruleset at audit time (see D3 for the sweep's
  drift case).

- **FR-5 Producer pinning.** Where the ruleset pins a required check to an App
  (`integration_id`), only a result from that App counts toward FR-3 and FR-4; a same-named
  check or status from any other producer is ignored for the pass and reported in the
  issue. The four by-design states count only from their known producers
  (`machinery-review-required` from the minspec-sdd App; `ready-to-merge` and `ai-review/pass`
  as the ruleset scopes them). This is the property `failingRequiredChecks` already has
  (`scripts/alta-self-merge.ts:167-`), extended to the by-design states.

- **FR-6 Two triggers, two witnesses (constitution invariant 2).**
  - **(a) Per merge:** a `push` to `main` runs the audit for the pull request(s) associated
    with the pushed commit(s).
  - **(b) Scheduled sweep:** independently of (a), a scheduled run audits every bot-merged
    pull request whose `merged_at` falls in a lookback window (length: D2). So a merge whose
    push run never fired, was cancelled, or failed to report is still audited by a second
    producer; no single disabled trigger silences the property.
  - **(c) Bot push with no pull request.** A commit on `main` pushed by the bot account that
    maps to no merged pull request is a violation in its own right: the record's bypass mode
    is `pull_request`, so this can only happen if the bypass was widened. A commit with no
    pull request pushed by any other account is reported in the summary, not failed.

- **FR-7 Fail closed and loud.** An API error, a page that cannot be read, an unparseable
  response, an empty required-check set, or a bot account id that is not configured fails the
  run red with a message that names the input that could not be read. No `|| true` on any
  step that produces the verdict or the report. A run that cannot judge a pull request never
  reports it as clean.

- **FR-8 Visible violation.** A violation (a) fails the workflow run red, and (b) files or
  updates exactly one issue per audited pull request and head, labelled `bot-merge-audit`,
  naming the pull request number, the merged head sha, the merger's account, and a table of
  every offending check (name, producer, state, completed-at vs `merged_at`). Deduplication
  uses a hidden marker carrying the pull request number and head sha, searched across open
  **and closed** issues, so a later sweep never reopens or re-files an issue a human has
  closed. If the issue cannot be filed, the run stays red with an `::error` saying the
  absence of an issue does not mean the merge was clean (as `main-red-watch.yml` does).

- **FR-9 Count what was judged.** Every run writes a job summary: the window or commits it
  covered, how many merged pull requests it found, how many were bot-merged, how many passed,
  how many violated, and how many were skipped and why. A run that found zero bot merges says
  so with the window it searched, so an empty result can be told apart from a query that
  matched nothing by mistake.

- **FR-10 Trust boundary.** Both triggers run the workflow file and the audit script from the
  default branch. Nothing from an audited pull request is checked out or executed; its data
  is read only through the API. Values from the API reach any shell only through `env`, never
  by interpolation into a script body. The workflow's default token has `contents: read`;
  issue writes use the App installation token, minted the same way `main-red-watch.yml` mints
  it.

- **FR-11 Not a gate.** The audit is never a required check and never blocks a merge (it runs
  after the merge). Invariant 2 still binds its reporting path (FR-7, FR-8), as it does
  `main-red-watch.yml`.

- **FR-12 Pure judge, tested.** The decision "does this head, with these checks, these
  required contexts and this merge time, pass?" is a pure function with no I/O, so each rule
  in FR-3 to FR-6(c) is covered by a fixture test that varies one input at a time.

## Acceptance criteria

- **AC-1** A machinery pull request whose head has exactly the four gates in their by-design
  states, `machinery-review-required` ACTION_REQUIRED from the minspec-sdd App, and every
  other check SUCCESS, SKIPPED or NEUTRAL before `merged_at`, passes.
- **AC-2** The same head with one non-required check FAILURE fails, and the issue names that
  check. The same with one required check FAILURE fails.
- **AC-3** A non-machinery pull request (no `machinery-review-required` on the head) with
  `ready-to-merge` FAILURE fails.
- **AC-4** A pull request with `ready-to-merge` FAILURE and `ai-review` NEUTRAL but no
  `machinery-review-required` result at all (the warning-only path at
  `.github/workflows/ai-review.yml:1256`) fails.
- **AC-5** A required check absent from the head fails (FR-4); a required check present only
  from a different App than the ruleset's `integration_id` fails (FR-5).
- **AC-6** A check in progress at `merged_at`, or one whose only SUCCESS completed after
  `merged_at`, fails (FR-3).
- **AC-7** A pull request merged by an account whose login is `minspec-sdd` but whose id or
  type differs is not treated as the bot (FR-1, SPEC-287); a bot-merged one with a different
  display login is.
- **AC-8** An API error on any read fails the run red with the input named, and files no
  "clean" summary (FR-7). Verified by a fixture whose reader throws.
- **AC-9** Running the sweep twice over the same violating pull request produces one issue;
  after that issue is closed, a third run files nothing new (FR-8).
- **AC-10** A bot-pushed commit on `main` with no associated pull request fails (FR-6(c)).
- **AC-11** The job summary of a run over a window with no bot merges states the window and a
  count of zero (FR-9).
- **AC-12** Each rule in FR-3 to FR-6(c) has a test that goes red when that rule's branch is
  removed from the judge (a mutant per rule, not only line coverage).

## Invariants this change must not break

- **Invariant 1 (offline core).** Untouched: this is CI on the repository's own forge, not
  shipped extension code. Nothing is added to `packages/`.
- **Invariant 2 (no silent gate).** FR-6 gives two independent producers; FR-7 and FR-8 keep
  the reporting path fail-closed and visible.
- **Invariant 3 (blast radius).** The workflow lives in this repository only and acts only on
  this repository. It is not scaffolded into adopters (D4).
- **DR-112 section 4.** The audit must not widen what counts as acceptable: it never accepts a
  state the record does not list.

## Decisions needed (Clarify)

- **D1 Who pushes the workflow file.** A new file under `.github/workflows/` needs a push with
  workflow scope. I believe the bot App is not granted that on this repository (runner
  memory, unverified here).
  - **(a) (rec)** The implementing pull request carries the workflow; the founder pushes or
    merges it once. Cost: one founder act on a machinery pull request.
  - (b) Run the audit from the runner's tick instead, outside this repository. Cost: it is
    then convention again, the very thing this spec turns into a machine-watched property, and
    it stops when the runner stops.

- **D2 Sweep cadence and lookback.**
  - **(a) (rec)** Daily, with an 8-day lookback, so one missed day or a week-long Actions
    outage is still covered and dedup (FR-8) keeps overlap free. Cost: up to about a day's
    latency when the push trigger failed; a few dozen API calls a day.
  - (b) Hourly, 48-hour lookback. Cost: about 24 times the calls, for latency that matters only
    when trigger (a) already failed.

- **D3 Required-check drift in the sweep.** The ruleset read at audit time may differ from the
  one in force at merge time.
  - **(a) (rec)** Use the current ruleset and print it in the issue. Cost: a check added to the
    ruleset after a merge flags older merges in the lookback window as missing it; at most one
    false issue per such merge, closable, and never re-filed.
  - (b) Judge only against checks present on the head. Cost: a required check that never ran
    is invisible, which defeats FR-4.

- **D4 Adopters.** **(a) (rec)** This repository only; not a MinSpec template. Cost: an adopter
  who adds a bypass actor gets no audit until a later spec ships one. (b) Scaffold it. Cost:
  ships a GitHub-specific bot-merge assumption to repositories that did not adopt DR-112.

- **D5 Ruleset bypass log as an extra witness.** GitHub's rule-suites log records
  evaluations whose result was a bypass. Reading it would let the audit flag any bypassed merge
  regardless of who merged.
  - **(a) (rec)** Not in this spec; record the option. Cost: a merge by a different bypass
    actor is not audited here. Whether the App can read that log is unverified, and it likely
    needs a repository administration permission the App was deliberately not given.
  - (b) Include it. Cost: a permission grant to the App, which widens what a minted token can
    do, the opposite of this spec's purpose.

- **D6 The record's section 2 kept classes.** A bot merge that touched a kept path is as
  much a breach as a red check, but is not what #3039 asks for.
  - **(a) (rec)** Keep it out of this spec; file it as its own issue, since it bears on how
    far the founder can trust the bot-merge record. Cost: until it ships, a bot merge of a kept
    path is caught only by the helper's own refusal, not by a watcher.
  - (b) Add it here as an FR. Cost: widens a T3 spec past its issue (scope-expansion rule), and
    the kept-path list lives in `~/.claude`, outside this repository.

## Rejected alternatives (DR-086 section 4)

- **Prevent rather than detect** (a pre-merge required check that blocks a bot `--admin` with a
  real red). Rejected: a required check is exactly what `--admin` bypasses, so it cannot bound
  the bypass.
- **Audit only `--admin` merges.** Rejected: GitHub does not mark a merge as bypassed on the
  pull request, and a plain bot merge past a red non-required check also breaks record section
  1(a). Auditing every bot merge needs no bypass detector.
- **Key the bot on the login string.** Rejected per SPEC-287: a squatter or a bare-login
  GraphQL response could pass or dodge the audit.
- **Read check state now rather than at `merged_at`.** Rejected: a re-run after merge would
  hide a red merge (AC-6).
- **One issue per run** (as `main-red-watch.yml` does per episode). Rejected: each bad merge is
  its own event needing its own look; one issue per pull request and head keeps them
  separately closable.

## Out of scope

- Re-checking DR-112 conditions (b) and (c): the second verdict's independence and the
  `--match-head-commit` pin. They are not readable from check state; the record names (b) as
  process, not proof.
- Auditing the record's section 2 kept classes (a bot merge touching the constitution,
  `.minspec/approvals/` outside the DR-119 lane, memory-fabric, deploys). A path-based audit is
  a separate property; whether it is tracked is D6.
- Auto-reverting a violating merge. Revert is an outward act and stays a human decision.
- memory-fabric and any repository other than AIClarityAU/minspec.

## Follow-ups (tracked)

- D1(a), if chosen: the founder's push of the workflow file, recorded in the implementing pull
  request. A founder act, not an issue.
- The section 2 kept-class audit: tracked per the answer to D6 (an issue or a `docs/backlog.md`
  line, materialised by whoever records that answer; this dispatch may write neither).
