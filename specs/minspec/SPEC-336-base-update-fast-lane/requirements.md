---
id: SPEC-336
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology - the ai-review merge gate and the landing path (same epic as SPEC-293 and SPEC-322)
aspects: [merge, ai-review, verdict-carry, pr-drive, strict, throughput, fail-visible, measurement]
depends_on: []
relates_to: ["#1394", "DR-104", "DR-110", "DR-097", "SPEC-322", "SPEC-321", "SPEC-293", "#1688", "#2635", "#2636", "#3069", "#3748"]
implements: none
implements_reason: >-
  Specify phase only. The verdict carry (half one of the founder's decision) is already wired in
  .github/workflows/ai-review.yml; the branch-update trigger (half two) lives in the
  chief-of-staff runner (cos.py pr-drive), outside this repository. Which files this repository
  owns is decided at Plan, after Clarify Q1 picks where the trigger lives.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-336: A base-only update costs one CI run, and the next one starts when a pull request lands

> **This is a SPECIFICATION ONLY.** Written for issue #1394 (strict required checks serialise the
> landing queue: 21% of merged pull requests needed repeated base updates). Nothing is built
> until this spec is approved and the [Decisions needed (Clarify)](#decisions-needed-clarify) are
> resolved. T4 (complete ceremony: every phase), so the founder reads it.

## In plain terms

`main` requires a pull request to be up to date before it merges, so every landing makes every
other open pull request out of date (`BEHIND`). Each one then needs a branch update, and each
update used to re-run the four-reviewer AI panel and the full CI. While that ran, something else
landed, and the pull request was out of date again.

The founder chose two fixes on 2026-11-12 (queue item mt1394, re-confirmed 2026-11-16, queue item
t1394), and ruled out two others:

1. **Keep the review verdict across a base-only update.** If the pull request's own change did
   not move, the panel does not run again.
2. **Start the next branch update the moment a pull request lands,** instead of on the
   chief-of-staff runner's next turn.
3. **No GitHub merge queue.** The 2026-08-12 decision against one stands.
4. **No ruleset change.** `strict` stays on.

**Half one is already built and wired.** DR-104 (accepted 2026-10-13) and DR-110 (accepted
2026-10-20) decided it, and `.github/workflows/ai-review.yml` calls it (see Context). This spec
does not rebuild it. It specifies how to find out whether it actually fires on the updates that
matter, and closes the gaps that measurement shows. **Half two is not built.** It is most of
the new work here.

## Status of the claims

Read from the code at worktree base `19da1839` (2026-11-16) unless marked. This dispatch made no
network call, so every count below is the issue's or another spec's, not re-measured here.

- **Read:** the verdict-carry step is wired (`.github/workflows/ai-review.yml:332-433`, the step
  "Carry the last verdict forward if nothing reviewable changed", calling `planVerdictCarry` at
  `:403`). It logs one line per run: `ai-review verdict carry: YES - <reason>` or
  `no - <reason>` (`:427`).
- **Read:** the branch updater is `cos.py pr-drive` in the chief-of-staff (CoS) runner
  (`~/.claude/scripts/cos.py`, `cmd_prdrive`; the `gh pr update-branch` call is at `:4547`). It
  updates **one** pull request per invocation and holds that slot until the update settles or
  90 minutes pass (`PRDRIVE_OWN_INFLIGHT_SECS`, `:3742`).
- **Read:** the drain sweep deliberately leaves a `BEHIND` + `ai-review:pass` pull request alone
  for its "one-at-a-time merge-time refresh" (`scripts/remediate-pr.sh:225-231`, #3069). So
  pr-drive is the producer that refresh relies on. The direct-merge seams hold a `BEHIND`
  pull request for that same turn (`scripts/lib/delegated-merge.ts:451-460`,
  `scripts/dispatch-issue.sh:923-925`, #3748).
- **From SPEC-322 (unverified here):** pr-drive runs once per CoS run, and the loop falls back to
  a 2 hour heartbeat while the quota cap reads `closed`.
- **From SPEC-321 (unverified here):** one update holds about 9 minutes of CI. The chance that
  `main` does not move during that slot was 40% over a 6 hour window and 30% over 1.5 hours.
- **From the issue (unverified here):** 8 of 39 pull requests merged in the 7 days to
  2026-09-06 needed more than one base update. That window **predates the carry going live**
  (DR-104 was accepted 2026-10-13), so the 21% is not today's figure. FR-1 re-measures it.
- **I believe, unverified:** most repeated updates now come from other pull requests landing
  during the CI slot, not from the panel re-running. If FR-1 shows that, half one is already
  mostly done and half two carries the saving.

## Context

### Half one - what the carry already does (DR-104, DR-110)

On a `synchronize` push, first workflow attempt, the trusted base guard carries the previous
head's **pass** to the new head when all of these hold (DR-104 Decision, 2):

- the previous head has a completed, allowlisted `ai-review` round that recorded a pass;
- that round was found in a check-run listing proven complete (not a cut-off page);
- the hash of the text the voters would be given is unchanged. Since DR-110 this hash ignores
  blob ids and hunk start line numbers inside text hunks. Every added, removed and context line
  still counts byte for byte;
- the hash of the reviewer's own files at the base is unchanged.

Anything else runs the full panel and logs why. A carried verdict is disclosed (comment, the
`ai-review:carried` label, check run, commit status). Only a pass is ever carried.

What the carry still re-reviews on an update from `main`, with the pull request's own change
unchanged:

- **G1. Context lines moved.** `main` edited a line within the 3 context lines around one of
  the pull request's hunks. Every added and removed line is the same, but the voters' text is
  not. By design under DR-110.
- **G2. Previous round never completed.** The prior push's review was cancelled
  (`cancel-in-progress: true`, `ai-review.yml:190`) or is still running, so there is no recorded
  pass on the commit the push replaced. Tracked as #2635 ("walk back past the previous head").
- **G3. The reviewer changed.** `main` changed the workflow, the guard, a review script or a
  role prompt. By design: a changed reviewer must review again (DR-104 Decision, 3).
- **G4. A re-run, or an opened or reopened pull request.** Always a fresh review, by design: a
  re-run is how a person asks for fresh eyes.

Nobody has measured how often each of these happens. #2636 (measure the carry once live) is
open for that.

### Half two - why an update waits

After a landing, the next update starts when pr-drive next runs. That is the next CoS run, or
up to 2 hours while the quota cap is closed (SPEC-322). Every minute between a landing and the
next update is a minute nothing is moving toward the next landing.

Under `strict`, a pull request is updated, waits about 9 minutes for CI, and lands only if
nothing else lands first. pr-drive serialises its own updates (one slot). Other things also
land, though: founder `--admin` merges, the delegated-approval lane (SPEC-296), the drain's
direct merges, and sessions driving their own pull requests. Each of those landings makes
pr-drive's in-flight pull request `BEHIND` again.

### Root cause (mechanism plus missing gate)

- **Mechanism.** `strict` turns every landing into an invalidation of every other open pull
  request. The thing that makes a `BEHIND` pull request current again runs on a timer that does
  not know a landing happened. Before 2026-10-13, every update also re-ran the full panel.
- **Missing gate.** Nothing measures base updates per landed pull request, so nobody can see
  this cost. The issue's 21% was counted by hand. Nobody knows whether the carry, live for a
  month, has changed it.

## Functional requirements

### Measurement first

- **FR-1 Baseline, on today's code.** Before anything in FR-6 to FR-10 is built, measure, over
  the pull requests merged into `main` in the latest 7 full days:
  - (a) base updates per merged pull request, as a distribution with the issue's buckets (0, 1,
    2, 3, 4, more). A base update is any commit on the pull request branch whose parents include
    a commit already on `main` at the time, and any push recorded as `gh pr update-branch`. A
    rebased branch counts as one update per force-push that changed the base. The issue's count
    missed rebases; this one does not.
  - (b) for each update, whether the `ai-review` run on the new head carried or ran the panel,
    and, when it ran, which refusal reason was logged (read from the carry step's run-log line,
    `ai-review.yml:427`). Bucket the reasons into G1 to G4 above, plus "other".
  - (c) for each update after which the pull request was `BEHIND` again before it landed, what
    landed in between, by producer (pr-drive's own pull request, founder, delegated lane, drain
    direct merge, session).
  - (d) the time from each landing on `main` to the start of the next branch update.
  The figures go in the Plan with their window, their source, and the panel cost as a share of
  the weekly budget (base named).
- **FR-2 A reusable instrument.** The FR-1 measurement is a script that can be re-run (no
  hand-count), with its inputs and window as arguments. Read-only: it never pushes, labels or
  merges. It runs on the runner or a developer machine, never inside the shipped extension
  (invariant 1).
- **FR-3 A failed read is not a zero.** If the instrument cannot read a pull request, a run log
  or a check-run listing, it reports that pull request as unread, with a count. It never folds an
  unread one into "0 updates" or "carried" (invariant 2 spirit: an unread witness fails
  visibly).

### Half one - keep the verdict across a base-only update

- **FR-4 No change to what a carried pass means.** DR-104's contract stands: only a pass is
  carried; it is carried only on byte-identical input (as DR-110 normalises it) under an
  unchanged reviewer; it is always disclosed. Nothing in this spec carries `changes` or
  `blocked`, or carries anything across a re-run or a reopened pull request.
- **FR-5 Close only the gaps FR-1 shows are worth closing.** For each of G1 and G2, the Plan
  states FR-1's count and panel cost for it and either specifies a change or records "not
  worth it" with the figure. Defaults until Clarify answers:
  - **G2 (previous round never completed):** close it. When the replaced head has no completed
    round, look back along the pull request's earlier heads to the newest one that has a
    completed, allowlisted pass round, and carry from it under every other DR-104 condition
    unchanged. The comparison is still between that round's recorded input hash and the input
    at the new head, so this does not widen what "unchanged" means. This is #2635's second
    shape.
  - **G1 (context lines moved):** do **not** widen by default. It would change DR-110's
    identity, which is Clarify Q2.
  - **G3 and G4 stay re-reviews.** They are the design, not gaps.
- **FR-6 Carry is a refusal-first optimisation.** Any new lookback (FR-5) inherits DR-104's
  failure rule. Any read that fails, any listing that cannot be proven complete, or any record
  that does not parse runs the full panel and logs why. It never carries on a partial read
  (invariant 2).

### Half two - start the next update when a pull request lands

- **FR-7 A landing triggers the next update.** When a pull request lands on `main`, the next
  branch update starts within the bound chosen in Clarify Q3 (default: 2 minutes). It does not
  wait for the CoS run or for its 2 hour closed-cap heartbeat. "Lands" means `main`'s head moved
  to a new commit, whoever caused it.
- **FR-8 One selection rule, one slot.** The trigger does not choose which pull request to
  update. It calls pr-drive (or whatever owns pr-drive's selection by then), so the order
  (founder's armed pull requests, pipeline blockers, the try limit, the human-turn slot) is
  defined in exactly one place. It uses pr-drive's existing serialisation: the same lock or
  mark, so a triggered run and a scheduled run never update two branches at once and never
  write interleaved output. This is the same constraint as SPEC-322 FR-2, and the two share one
  mechanism.
- **FR-9 Re-take the slot when it is lost.** If pr-drive's in-flight pull request is made
  `BEHIND` by someone else's landing, the triggered run updates that same pull request again
  straight away. It does not wait out `PRDRIVE_OWN_INFLIGHT_SECS`. This applies only while that
  pull request has no red check, a pass verdict and no conflict, and still counts against
  `PRDRIVE_PRIORITY_MAX_TRIES`, so one pull request cannot hold the slot for ever.
- **FR-10 Nothing new is decided here.** The trigger updates branches only. It never arms
  auto-merge, merges, approves, labels, edits a pull request, or changes the ruleset. It never
  updates a pull request pr-drive would not have updated on its own turn.
- **FR-11 A dead trigger is visible.** The trigger writes a heartbeat (last seen `main` head,
  last trigger time, last outcome). If `main` moved and no update followed within the bound
  while an eligible pull request existed, that is reported where the runner's other failures
  are and in the CoS digest. A trigger that silently stops must not look like a quiet week.
- **FR-12 The scheduled path stays.** The existing pr-drive call on each CoS run (and
  SPEC-322's closed-cap timer, if it ships) keeps running as the backstop. The trigger makes
  updates sooner and does not replace the scheduled path. If the trigger is down, behaviour
  falls back to today's.

### Proof

- **FR-13 Re-measure after shipping.** Seven full days after FR-7 to FR-11 are live, re-run
  the FR-2 instrument and record the before/after for FR-1 (a), (b) and (d) in a comment on
  #1394 and in the Plan's outcome section.

## Acceptance criteria

- **AC-1** The Plan contains the FR-1 baseline: the update distribution, the carry-or-panel
  split with refusal reasons bucketed G1 to G4, landings-between by producer, and
  landing-to-next-update latency, each with its window and source, and the panel cost as a
  share of the named weekly budget.
- **AC-2** The FR-2 instrument, given a fixture of merged pull requests including one rebased
  branch, counts the rebase as an update. Given a fixture with one unreadable pull request, it
  reports that pull request as unread and does not add it to the "0" bucket (FR-3). A mutant
  that maps unread to 0 fails a test.
- **AC-3** No test that pins DR-104's carry conditions is weakened or deleted. A carried round
  still never follows a re-run, an opened or reopened event, a `changes` round, or a changed
  reviewer key (FR-4).
- **AC-4** If FR-5's G2 lookback is built: given earlier heads where the newest completed pass
  round has an equal input hash, the verdict carries and the disclosure names the commit the
  voters actually read. Given an unreadable or incomplete earlier-head listing, the full panel
  runs and the log names why (FR-6). Each condition has a mutant that fails a test.
- **AC-5** With the trigger live, a landing on `main` while an eligible `BEHIND` pull request
  exists is followed by a `gh pr update-branch` (or equivalent) within the Clarify Q3 bound, in
  the trigger's log (FR-7).
- **AC-6** A triggered run and a scheduled pr-drive run started together: one updates, the
  other waits or skips, and the output is not interleaved (FR-8). The order of updates for a
  fixed set of pull requests is identical whether the trigger or the schedule fired.
- **AC-7** When another producer lands while pr-drive's pull request is in CI, the triggered run
  re-updates that same pull request, and its try count goes up (FR-9).
- **AC-8** With the trigger stopped, `main` moved and an eligible pull request waiting past the
  bound, the CoS digest reports it (FR-11). With the trigger stopped, the scheduled path still
  updates on its next run (FR-12).
- **AC-9** The FR-13 before/after is posted on #1394.

## Invariants this must not break

- **Invariant 1 (offline core).** Nothing here enters the shipped extension. The instrument
  (FR-2) and the trigger (FR-7) run on the runner or in CI, never in MinSpec itself.
- **Invariant 2 (no silent gate).** The carry stays refusal-first (FR-6). The trigger is not a
  gate, but its failure is visible (FR-11). The instrument never reads an unread pull request
  as clean (FR-3). Nothing here adds a required check, so no required check gains a single
  producer.
- **Invariant 3 (blast radius).** The trigger acts only on repositories pr-drive already acts on
  (AIClarityAU repositories with `.minspec/`). No machine-wide or org-wide setting changes.
- **DR-104 and DR-110 stand as accepted.** Changing the carry identity (Clarify Q2, if answered
  "widen") needs a decision record that amends DR-110 before any code lands, the way DR-110 itself
  amended DR-104.
- **The founder's exclusions.** No merge queue. No ruleset change. `strict` stays `true`.
- **DR-086 / DR-112 merge authority.** The trigger never merges, so it cannot widen what the
  runner may merge.

## Out of scope

- A GitHub merge queue, and any change to `main`'s ruleset (the founder's decision).
- Coordinating the other branch updaters (sessions driving their own pull requests, the drain's
  `rebase-only` path for non-pass pull requests, the delegated lane) into pr-drive's single
  slot. FR-1 (c) measures how much they cost. If they dominate, that is a new decision for the
  founder, not something this spec decides.
- SPEC-322's closed-cap timer. It is a separate trigger (time, not landings) with its own open
  Clarify questions. FR-8 makes them share one lock.
- A post-merge `main` watch (the original issue's option 3). It already exists
  (`.github/workflows/main-red-watch.yml`).
- Making lint, test or build faster. The CI slot length is what remains after this spec. Its
  docs-only skip (#1728) already exists.

## Decisions needed (Clarify)

Recorded selections: each of the 4 selections below is the option this document marks recommended, copied by the runner's agent on 2026-11-16. These are not human choices and no delegation made them; the approver confirms or changes each. The founder's 2026-11-12 decision (queue item mt1394, summarised in "In plain terms" above) fixes what is built, but does not pick among the options of any question below.

1. **Where does the landing trigger live?**
   - (a) **In the CoS runner (rec):** a light watcher compares `main`'s head (one
     `git ls-remote` per poll, no API quota and no model) and runs pr-drive when it moves.
     It keeps one selection rule and one lock (FR-8), needs no workflow-file edit, and adds no
     new producer on GitHub. **Cost:** it is only as alive as the host. A suspended or asleep
     host starts no updates, and the scheduled backstop is no better then. Latency is the poll
     interval, not zero.
   - (b) A GitHub workflow on `push` to `main` that updates the next pull request. This is
     truly event-driven and works while the host is asleep. **Cost:** it needs pr-drive's
     ordering rewritten in a second place, and duplicated selection rules have drifted here
     before. It also becomes a second updater racing pr-drive's slot. The App token cannot
     update a branch when `main`'s new commits touch a workflow file. And editing a workflow
     file is a founder push.
   - (c) A workflow on `push` that only wakes the host runner. **Cost:** no inbound channel to
     the host exists. Building one is a new network surface for the runner.

   **Recorded selection: Option (a),** the landing trigger lives in the CoS runner as a `git ls-remote` watcher that runs pr-drive when `main`'s head moves. Recorded by the runner's agent on 2026-11-16 as the document's (rec) option; the approver may change it.
2. **Should the carry also ignore context lines that `main` moved (G1)?**
   - (a) **No, keep DR-110's identity (rec).** Decide on FR-1's count instead. **Cost:** those
     updates keep paying a full panel. Its size is unknown until FR-1. DR-104 estimated
     moved-hunk rounds at about 1.4% of quota on a sample of 7, and DR-110 has since absorbed
     part of that.
   - (b) Widen: carry when every added and removed line is byte-identical, whatever the context
     lines say. **Cost:** a context line is part of what a reviewer reads. A change on `main`
     next to the pull request's change is exactly where an interaction defect can hide, and the
     panel would no longer look. Needs a decision record amending DR-110.

   **Recorded selection: Option (a),** keep DR-110's identity and decide on FR-1's count. The founder's decision keeps the verdict across a base-only update; it does not say whether an update that moves context lines counts, so this selection does not read it as settling the question. Recorded by the runner's agent on 2026-11-16 as the document's (rec) option; the approver may change it.
3. **What is the landing-to-update bound (FR-7)?**
   - (a) **2 minutes (rec).** A 60-second poll plus slack. Small against a 9-minute CI slot.
     **Cost:** about 1,440 `git ls-remote` calls a day per watched repository. That is cheap,
     but not free on a metered host link.
   - (b) 30 seconds. **Cost:** about 4 times the polls, to save under a minute per landing.
   - (c) 5 minutes. **Cost:** gives back about half of what an immediate start wins, against
     a 9-minute slot.

   **Recorded selection: Option (a),** a 2-minute landing-to-update bound (60-second poll plus slack). Recorded by the runner's agent on 2026-11-16 as the document's (rec) option; the approver may change it.
4. **Build G2's lookback (FR-5) now, or only if FR-1 shows it matters?**
   - (a) **Only if FR-1 shows at least 5% of base updates refused for it (rec).** **Cost:**
     the build waits a week on measurement.
   - (b) Build it now. **Cost:** it adds a new paged read on a merge gate's input, built before
     anyone knows it pays.

   **Recorded selection: Option (a),** build G2's lookback only if FR-1 shows at least 5% of base updates refused for it. Recorded by the runner's agent on 2026-11-16 as the document's (rec) option; the approver may change it.

## Decision record

No new decision record. Half one already rests on DR-104 and DR-110, both accepted, and
FR-4 keeps them intact. The trigger (FR-7 to FR-12) can be undone in under a day by removing
the watcher, and the scheduled path is unchanged. A record is required only if Clarify Q2 is
answered (b), and then before code lands.

## Alternatives rejected

Recorded per DR-086 section 4: under `autonomy: act` nobody sees these live.

- **A GitHub merge queue.** It is what the issue recommended, and the founder ruled it out
  (2026-08-12, re-confirmed 2026-11-12). `main-red-watch.yml`'s header also records why it does
  not fit: `ai-review` reads `github.event.pull_request` and cannot run for a `merge_group`.
- **`strict = false`.** Re-opens the original defect (two green pull requests reddening
  `main`, `fcce76b`). The founder ruled out any ruleset change.
- **Updating every `BEHIND` pull request on each landing.** Under `strict`, the first to land
  makes all the others `BEHIND` again. This is the CI churn #3069 removed.
- **Re-specifying the carry from scratch.** It is accepted, wired and tested. Doing that again
  would spend a full spec cycle on something that already exists.

## Noticed, not changed

- `.github/workflows/main-red-watch.yml`'s header still says `strict` is `false`. The issue's
  2026-09-06 reading says `true`. Stale comment, outside this dispatch's allowlist. Fix it in
  the Plan's first pull request that touches workflows.
