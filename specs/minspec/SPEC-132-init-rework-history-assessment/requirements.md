---
id: SPEC-132
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - Initialize lives here; this adds one read-only measurement of an existing project to it
goal: G-2  # Prevent tech debt - "rebuild-not-patch" is the goal's own wording
aspects: [init, onboarding, brownfield, rework, git-history, rebuild, tier-0, nagging, evidence]
relates_to: [DR-004, DR-006, DR-015, DR-036, DR-052, DR-074, DR-075, DR-078, SPEC-086, SPEC-096, "#242", "#691", "#205"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1/FR-2). All four
# files are NEW and are needed under every answer in "Decisions needed (Clarify)": the
# measurement core, the two commands, and the tests that pin them.
implements: [packages/minspec/src/lib/rework-assessment.ts, packages/minspec/src/commands/assess-rework.ts, packages/minspec/tests/rework-assessment.test.ts, packages/minspec/tests/assess-rework-command.test.ts]
# Modified, not owned. init.ts gains one first-init step; extension.ts and package.json register
# the commands; fix-feat-tripwire.ts is reused and may need its parser exported differently;
# preferences.ts records the one answer; config.ts gains the optional thresholds key; the two
# test files are existing inventories that every new process-spawning module and every new
# command must be added to.
affects: [packages/minspec/src/commands/init.ts, packages/minspec/src/extension.ts, packages/minspec/package.json, packages/minspec/src/lib/fix-feat-tripwire.ts, packages/minspec/src/lib/preferences.ts, packages/minspec/src/lib/config.ts, packages/minspec/tests/invariants.test.ts, packages/minspec/tests/commands-opt-in-invariant.test.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-132: Initialize measures how much of an existing project's history was rework, and offers to draft a rebuild spec when it is heavy

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers the six questions under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the normal
> spec-approval gate before any code changes. Every requirement below is written under each
> question's recommended option, so approving the spec as it stands accepts those
> recommendations. Choosing a different option changes only the requirements that question
> names.

Materializes **[#242](https://github.com/AIClarityAU/minspec/issues/242)** - *"tech-debt
detector on init - offer rebuild vs spec, estimate cost."* The issue came from a
reverse-engineering session on another project, where five months of changing scope had left
enough dead structure that a rewrite was judged the right call. (That description is the
issue's; the project is not in this repository and was not inspected for this spec.) The
issue asks MinSpec to notice that situation at Initialize instead of relying on the person
having already decided.

It serves constitution goal G-2 (prevent tech debt), whose text already says
"Rebuild-not-patch" and cites the same three-days-fixing-per-one-day-building observation
(`.minspec/constitution.md:41`).

**Id note.** Spec ids 097 to 131 each appear as a spec directory on at least one ref
visible from this worktree (local branches, 303 remote-tracking refs, and the sibling dispatch
worktrees under `/tmp/minspec-agent/`, read on 2026-10-04). `SPEC-132` is the first id none of
them uses. Open pull requests could not be listed from here (no network on this dispatch), so
if the id collides at review time, renumber.

**Tier note.** T3 (full spec cycle). The change adds one library module, two commands and one
step in Initialize. It reads git history and writes at most one draft spec; it does not touch
approvals, gates or the harness. The predicted tier is an upward-only floor.

## One-Sentence Scope

On the first Initialize of a project that already has git history (and later by command),
MinSpec computes a small fixed set of rework measurements from that history, shows them with
their limits stated, and, only when they cross a declared threshold, offers to create an
ordinary draft spec for a rebuild that carries those measurements as its evidence.

## Reality-check - what the issue assumes, checked against this repository

Read at `origin/main` a482aee6. Every "nothing found" below names the terms searched.

| # | The issue says | What is there today | Consequence for this spec |
|---|---|---|---|
| 1 | Detect the bugfix-to-feature commit ratio. | Half built, and not in the product. `packages/minspec/src/lib/fix-feat-tripwire.ts` is a pure core that parses `git log --numstat` output (`:53-63`, `:91-126`), groups by month (`:161-222`) and evaluates a threshold (`:253-288`). Its only importer is the developer script `scripts/fix-feat-tripwire.ts:34`; nothing under `packages/minspec/src` imports it (searched for `fix-feat-tripwire`). | Reuse the parser and the month grouping; do not write a second one (FR-3). |
| 2 | The same, on "pre-MinSpec projects". | The existing classifier recognises only conventional-commit prefixes: a subject must match `^(\w+)(\([^)]*\))?!?:` and the type must be exactly `fix` or `feat` (`fix-feat-tripwire.ts:65-75`). A project that never used MinSpec usually has no such prefixes, so nearly every commit would be `other` and the ratio would be undefined. | The target population is the one the existing classifier cannot read. DQ-2; and "could not measure" must be its own visible result (FR-5). |
| 3 | The observed ratio is 3:1. | The observation is in **days** ("3:1 day ratio"; the constitution says "~3 days bugfixing per 1 day of new function"). The existing tripwire counts **commits** and defaults its ceiling to 1.0, not 3.0 (`fix-feat-tripwire.ts:230-233`). Its own header records that on this repository the commit-count ratio rose from 0.56 to 1.52 while the line-churn ratio stayed near 0.22 (`:4-7`): the units disagree on the same history. | Which unit carries the threshold is a real choice. DQ-3. |
| 4 | Detect "repeated scope drift" and "no stable interfaces". | Neither is recorded in git. A commit log shows what changed, not that the requirement behind it changed, and an interface is a language-level idea that a language-neutral scan cannot see. | This spec measures **proxies** (repeated rewriting of the same files, total lines written against lines that survive) and the report says they are proxies (FR-2, INV-5). Dead-code detection is out of scope. |
| 5 | Scan "chat history". | MinSpec reads no chat history. Searching `packages/minspec/src` for `transcript`, `.claude/projects` and `chat history` (case-insensitive) finds nothing. Assistant transcripts live outside the project folder, in per-user directories whose format belongs to each tool. | DQ-1. |
| 6 | Offer "Spec the rebuild - guided SDD flow". | There is no command that creates a spec. `createSpec` exists (`packages/minspec/src/lib/spec-manager.ts:356`) and has no caller in `packages/minspec/src` (searched for `createSpec(`); the palette's nearest entry is "MinSpec: Generate Example Spec" (`packages/minspec/package.json:138`). | "Spec the rebuild" has to create the spec itself, through that existing function (FR-9). |
| 7 | Offer "Autopilot rebuild - full autonomous rebuild". | Decided, not built. [DR-036](../../../docs/decisions/DR-036.md) (accepted) greenlit Autopilot Mode for one trial repository. Searching `packages/minspec/src` and `packages/minspec/package.json` for `blueprint` and `autopilot` (case-insensitive) finds nothing. [DR-015](../../../docs/decisions/DR-015.md) (accepted) puts agent dispatch in a separate extension, not in MinSpec. | An offer for it would be a button that does nothing. DQ-4. |
| 8 | Estimate the rebuild cost "tokens x model rate", needing ScroogeLLM. | ScroogeLLM is shelved as a product and goal G-5 is retired (`.minspec/constitution.md:48-52`, [DR-075](../../../docs/decisions/DR-075.md)). `packages/minspec/tests/no-scroogellm-upsell.test.ts:87` fails the build if that product's name appears in shipped strings ([SPEC-086](../SPEC-086-remove-scroogellm-upsell/requirements.md)). [DR-052](../../../docs/decisions/DR-052.md) makes subscription sign-in the default billing mode, where no per-call dollar amount exists. | A dollar figure has no source MinSpec can stand behind. DQ-5. |
| 9 | Do this "on init". | `initCommand` (`packages/minspec/src/commands/init.ts:1230`) is re-runnable and already distinguishes the first run (`isFirstInit`, `:1243`). On a first run it shows, in sequence, a coverage prompt and a pull-request-extension advisory (`:1276-1282`), then a commit offer, a remote-rename advisory and a ruleset advisory (`:1283-1297`). An unmerged spec on branch `agent/issue-205` (the brownfield document audit, #205) would add one more. | One more prompt in that sequence is a cost under constitution principle 4 (avoid nagging). FR-6, FR-7, DQ-6. |

## Definitions

- **Rework measurements** - the four numbers in FR-2. They describe how a history was spent.
  They are not a measurement of technical debt, and this spec never calls them one in
  user-visible text (INV-5).
- **Classifiable commit** - a non-merge commit whose subject the classifier (FR-4) assigns
  to *fix* or *feature*. Every other commit is *unclassified* and enters no ratio.
- **Active month** - a calendar month containing at least five non-merge commits.
- **Measured window** - the commits the scan actually read, after the bounds in FR-1.
- **Result** - exactly one of *heavy rework*, *not heavy*, *could not measure* (FR-5).

## Functional Requirements

### The scan

- **FR-1 - Local, read-only, bounded.** The scan reads the project's git history through
  the locally installed `git` and the files tracked at `HEAD`. It MUST NOT fetch, contact a
  remote, call a model, or write anywhere. It MUST be bounded by a commit cap and a
  wall-clock budget (defaults fixed in Plan and stated in the report); when either bound
  cuts the history short, the report says how many commits were read out of how many, and
  the dates they span. It MUST run without blocking Initialize's other steps or the editor
  (constitution constraint 3), and MUST be cancellable. When the workspace folder is a
  subdirectory of a larger repository, the scan is limited to that subdirectory's paths.

- **FR-2 - Four measurements, each with its unit.** Over the measured window, excluding
  merge commits, binary files and the excluded paths of FR-2a:
  - **M1 - fix-to-feature ratio.** Fix commits divided by feature commits among classifiable
    commits, plus the same ratio counted in distinct calendar days on which each kind
    occurred. Undefined (not zero) when there are no feature commits.
  - **M2 - active months.** The number of active months, and the first and last of them.
  - **M3 - written-to-surviving ratio.** Total lines added across the window divided by
    lines present at `HEAD`, over the same file set. A value of 6 reads as "this code has
    been written about six times over".
  - **M4 - repeatedly rewritten files.** The share of files present at `HEAD` whose
    cumulative changed lines are at least five times their present length, and the ten
    highest such files by name.

  M3 and M4 are the proxies for the issue's "scope drift" and "no stable interfaces"
  (Reality-check row 4) and the report labels them as proxies.

  - **FR-2a - Exclusions are fixed and shown.** A default list (dependency lockfiles,
    vendored and generated directories, minified files) is excluded from M3 and M4, may be
    extended by the optional config key in the Contract, and is printed in the report. A
    renamed file may be counted as two files; the report states this limit, as
    `fix-feat-tripwire.ts:15-18` already does for its own output.

- **FR-3 - One parser.** The scan MUST use the existing `git log` argument builder, parser
  and month grouping in `fix-feat-tripwire.ts`. It MUST NOT use that module's
  `classifyArea` (`:78-83`), which hard-codes this repository's own directory layout
  (`packages/`, `scripts/`, `sites/`) and means nothing in an adopter's project.

- **FR-4 - Classifying commits that have no convention (DQ-2).** A subject is classified by
  its conventional-commit prefix when it has one. Otherwise it is classified by a short
  fixed keyword list matched against the first word of the subject (for example `fix`,
  `bugfix`, `hotfix`, `patch` for *fix*; `add`, `feat`, `feature`, `implement` for
  *feature*); the exact list is fixed in Plan and pinned by test. The report states what
  share of commits each method classified and what share stayed unclassified.

- **FR-5 - Three results, never conflated.**
  - **Could not measure**, with the reason, when any of these holds: the folder is not a git
    repository; `git` is missing or failed; there are no commits; the clone is shallow;
    fewer than 30 commits are classifiable; or fewer than half of non-merge commits are
    classifiable. A bound from FR-1 cutting the history short is not by itself a reason, but
    the truncation is reported.
  - **Heavy rework** when the threshold rule of FR-5a is met.
  - **Not heavy** otherwise.

  A failed or under-evidenced scan MUST NOT be shown or recorded as *not heavy*: absence of
  a finding from a scan that could not see is not a clean bill.

  - **FR-5a - The threshold rule (DQ-3).** *Heavy rework* means M1 by commit count is at
    least 3.0 over the measured window **and** M2 is at least 5. Both numbers are the
    issue's own. M1 by days, M3 and M4 are reported and do not enter the rule until they
    have been calibrated against real projects. The two thresholds are readable from the
    optional config key in the Contract; the defaults apply when it is absent.

### Showing the result

- **FR-6 - On first Initialize, only a heavy result speaks.** The scan runs once, on the
  first Initialize of a folder (`isFirstInit`), after the scaffold has succeeded. If the
  result is *heavy rework*, MinSpec shows one non-modal notification, after Initialize's
  existing prompts have finished, that states the two triggering numbers in plain words and
  offers **Show measurements** and **Not now**. For *not heavy* and *could not measure*
  Initialize shows nothing extra. A failure anywhere in the scan MUST NOT fail or delay
  Initialize.

- **FR-7 - Asked once.** The answer to FR-6's notification is recorded in
  `.minspec/preferences.json` (the store [DR-078](../../../docs/decisions/DR-078.md) names),
  and the notification is not shown again for that project by Initialize, a harness refresh
  or activation. There is no recurring check and no status-bar item.

- **FR-8 - The report, by command at any time.** A palette command, **MinSpec: Assess
  Rework History**, runs the scan and opens the report for all three results. The report is
  an unsaved document: nothing is written to the project, so the command is safe in a folder
  that has not opted in and creates no `.minspec/` ([SPEC-096](../SPEC-096-opt-in-marker-single-creator/requirements.md)).
  The report contains, in this order: the result and the rule that produced it; each
  measurement with its unit; the measured window (commit count, date range, the commit hash
  measured at, and any truncation); classification coverage (FR-4); the exclusions (FR-2a);
  a fixed "what these numbers cannot tell you" section (INV-5); and, for a *heavy rework*
  result in an opted-in folder, the name of the command in FR-9.

### Acting on it

- **FR-9 - Draft a rebuild spec.** A second palette command, **MinSpec: Draft Rebuild
  Spec**, creates one new spec through the existing `createSpec` path, so it takes the next
  id and the project's layout like any other spec. It is created at `status: specifying`,
  tier T4, never approved, and its body carries: a snapshot of the report (with the commit
  hash and date it was measured at, marked as a snapshot that will age); and empty,
  headed sections for what the rebuild must keep, what it drops, and how the old and new
  versions coexist until cutover. MinSpec fills in none of those three: which behaviour is
  worth keeping is the person's judgement. The command opens the new file.
  - It requires an opted-in folder and refuses elsewhere with the standard not-opted-in
    message.
  - It is available for any result, since a person may decide to rebuild on grounds the
    scan cannot see; for a result other than *heavy rework* the snapshot says so plainly.
  - If a spec created by this command already exists and is not archived, the command opens
    it instead of creating a second.

- **FR-10 - No autonomous rebuild path (DQ-4).** This spec adds no "autopilot" option, no
  disabled placeholder for one, and no text promising one. The rebuild spec of FR-9 is an
  ordinary spec, so any autonomous execution that later exists can take it up with no
  change here.

- **FR-11 - No cost figure (DQ-5).** The report shows no token count and no money amount.
  It does show the two size figures any later estimate would start from (tracked source
  files and lines at `HEAD`, after exclusions), labelled as size.

### Unchanged behaviour

- **FR-12.** Initialize in a folder with no git history, or with a history that is *not
  heavy* or *could not measure*, shows exactly the prompts it shows today. Activation runs
  no scan. `scripts/fix-feat-tripwire.ts` produces the same output for the same input.

## Contract (for the Plan phase to place; not code)

```ts
/** Why a scan produced no verdict. One value per FR-5 reason. */
type NotMeasurableReason =
  | 'not-a-git-repo' | 'git-unavailable' | 'no-commits' | 'shallow-clone'
  | 'too-few-classifiable-commits' | 'classification-coverage-too-low';

interface ReworkMeasurements {
  fixToFeature: {
    byCommits: number | null;      // null = no feature commits (undefined, not zero)
    byDays: number | null;
    fixCommits: number; featureCommits: number; unclassifiedCommits: number;
    classifiedByPrefix: number; classifiedByKeyword: number;
  };
  activeMonths: { count: number; first: string | null; last: string | null }; // YYYY-MM
  writtenToSurviving: number | null; // null = no surviving lines in scope
  rewrittenFiles: { share: number; top: ReadonlyArray<{ path: string; times: number }> };
  size: { files: number; lines: number };
}

interface MeasuredWindow {
  headSha: string; commitsRead: number; commitsTotal: number;
  firstDate: string; lastDate: string; truncatedBy: 'commit-cap' | 'time-budget' | null;
}

type ReworkAssessment =
  | { result: 'heavy'; measurements: ReworkMeasurements; window: MeasuredWindow; rule: string }
  | { result: 'not-heavy'; measurements: ReworkMeasurements; window: MeasuredWindow; rule: string }
  | { result: 'not-measurable'; reason: NotMeasurableReason; detail: string;
      measurements?: ReworkMeasurements; window?: MeasuredWindow };

/** Optional key in `.minspec/config.json`. Absent = the defaults below. */
interface ReworkAssessmentConfig {
  onInit?: boolean;              // default true
  fixToFeatureThreshold?: number; // default 3.0
  activeMonthsThreshold?: number; // default 5
  excludePaths?: string[];        // added to the built-in list
}
```

The measurement core takes captured `git` output and a file listing as plain values and
returns a `ReworkAssessment`; it imports neither `vscode` nor a process API, in the same
split `fix-feat-tripwire.ts` uses. The union makes "not measurable" a separate shape, so a
caller cannot read a threshold result out of a scan that produced none.

## Acceptance Criteria

- **AC-1 (FR-1).** With a stubbed process runner, the scan issues only `git` subcommands
  from a read-only set (`log`, `rev-parse`, `ls-files`, and file reads at `HEAD`); a test
  fails on `fetch`, `pull`, `push`, `remote` or any non-`git` process. The new module is
  listed in the process-spawn inventory in `packages/minspec/tests/invariants.test.ts` and is
  not on its network-consent list.
- **AC-2 (FR-1).** A history longer than the commit cap yields a report naming commits read
  and total, with `truncatedBy: 'commit-cap'`. A scan exceeding the time budget ends with
  `truncatedBy: 'time-budget'` and Initialize has already completed.
- **AC-3 (FR-2).** A fixture history with known counts yields the expected M1 (both units),
  M2, M3 and M4 to two decimal places; a history with zero feature commits yields `null`
  for M1, never `0` and never `Infinity`.
- **AC-4 (FR-2a).** Adding a 50,000-line lockfile to the fixture changes neither M3 nor M4.
- **AC-5 (FR-3).** `scripts/fix-feat-tripwire.ts` output on a fixed fixture is byte-identical
  before and after the change, and the new module contains no second `git log` parser.
- **AC-6 (FR-4).** A fixture with no conventional prefixes and first-word keywords is
  classified by keyword, and the report states the prefix, keyword and unclassified shares,
  which sum to all non-merge commits.
- **AC-7 (FR-5).** Each of the six reasons produces `not-measurable` with that reason, and
  for each one FR-6 shows no notification and FR-8's report states the reason. No input
  produces `not-heavy` when a `not-measurable` condition holds.
- **AC-8 (FR-5a).** M1 of 3.0 with 5 active months is *heavy*; 2.99 with 5 is not; 3.0 with
  4 is not. Changing the two config thresholds moves both boundaries.
- **AC-9 (FR-6, FR-12).** First Initialize on a *heavy* fixture shows exactly one additional
  notification, after the existing ones. On *not heavy*, *could not measure*, and a
  non-git folder, the set of prompts is identical to today's. A scan that throws leaves
  Initialize's success message and prompts unchanged.
- **AC-10 (FR-7).** After either answer, a second Initialize, a harness refresh and a
  window reload show no rework notification. The answer is in `.minspec/preferences.json`
  and in no user-level or machine-level setting.
- **AC-11 (FR-8).** Running the report command in a folder without `.minspec/` shows the
  report and leaves the folder byte-identical (no `.minspec/`, no new file). The command is
  added to the inventory in `packages/minspec/tests/commands-opt-in-invariant.test.ts`.
- **AC-12 (FR-8, INV-5).** The report text for every result contains the "cannot tell you"
  section, and no user-visible string from this feature contains "cheaper", "should
  rebuild", "tech debt" or a currency symbol (pinned by a string test over the module's
  literals).
- **AC-13 (FR-9).** The draft command creates exactly one spec at `status: specifying` with
  no approval record, containing the snapshot and the three empty sections; a second run
  opens the same file; in a folder that has not opted in it writes nothing.
- **AC-14 (FR-10, FR-11).** No contributed command, notification or report string names an
  autonomous rebuild, a token count or a price.

## Invariants (must not break)

- **INV-1 - Constitution invariant 1 (offline).** The scan makes no network call and needs
  no consent prompt because it has nothing to consent to: local `git` reads only (AC-1).
- **INV-2 - Constitution invariant 3 and SPEC-096 (opt-in marker).** Nothing in this
  feature creates `.minspec/`. The only writes are the one preference (FR-7) and the draft
  spec (FR-9), both inside a folder that has already opted in.
- **INV-3 - A scan that could not see is never reported as clean (FR-5).** This is the
  advisory-surface form of constitution invariant 2: this feature gates nothing, and it
  still must not turn an error into a reassurance.
- **INV-4 - Constraint 3 and principle 4.** No scan on activation; Initialize is never
  blocked or failed by it; at most one notification, once per project.
- **INV-5 - The report states measurements, not a verdict on what to do.** It never says a
  rebuild is cheaper, better or recommended. Its fixed "cannot tell you" section says: that
  these are counts over commit history; that a high fix ratio also describes a mature
  product in maintenance; that commit messages are self-reported; that M3 and M4 stand in
  for scope change and cannot see it; and that nothing here estimates what a rebuild costs
  or whether it would end up in the same state.
- **INV-6 - Principle 2 (no rubber-stamping).** The notification's actions are *Show
  measurements* and *Not now*. Drafting a rebuild spec is never a one-click action from a
  notification; it is reached after the measurements are on screen.
- **INV-7 - Determinism (G-6).** The same history and config produce byte-identical report
  text. The report carries no run timestamp; its only dates are those of the commits it
  read.

## Decisions needed (Clarify)

Six questions. Each names the recommended option and what that option costs.

### DQ-1 - Is assistant chat history an input?

The issue lists it beside code and commit history.

- **Option A (rec)** - no. The scan reads git only. **Cost:** the richest evidence of
  changing requirements (the conversations where scope was renegotiated) is ignored, so the
  feature can only infer scope change from proxies M3 and M4.
- **Option B** - yes, on an explicit per-run gesture where the person picks the transcript
  folder. The files sit outside the project in per-user directories; their format is each
  tool's private detail; and finding "rescoping" in prose needs a model, which ends the
  Tier-0 and determinism properties of the scan. I believe constitution invariant 3 covers
  writes and behaviour changes rather than reads (inferred from its text, not from a
  ruling), so this is permitted in principle, but it would need its own decision record
  before Plan.

Changes FR-1 and the scope sentence.

### DQ-2 - How are commits without a convention classified?

- **Option A (rec)** - conventional prefix first, then a fixed first-word keyword list,
  with coverage reported (FR-4). **Cost:** keyword matching is wrong on some subjects
  ("Fix typo in README" counts as a fix; "Update parser" counts as nothing), so M1 on such
  a project is rougher than the two-decimal figure looks.
- **Option B** - conventional prefixes only. Exact where it applies; on the projects the
  issue targets it will mostly answer *could not measure*, and the feature will rarely
  speak.
- **Option C** - classify by what each commit touched (for example, tests changed with
  source) instead of by its message. Independent of message habits; needs per-language
  knowledge of what a test file is and has no evidence behind it yet.

Changes FR-4, AC-6 and how often FR-5 returns *could not measure*.

### DQ-3 - What makes a result "heavy"?

- **Option A (rec)** - commit-count fix-to-feature ratio of at least 3.0 **and** at least
  5 active months (FR-5a). Both numbers come from the issue. **Cost:** the 3:1 figure was
  observed in days, not commits, and Reality-check row 3 shows the two units diverging on
  this repository's own history; the rule is uncalibrated and may stay silent on a project
  the founder would call heavy, or speak on one that is merely in maintenance.
- **Option B** - the same rule on the day-count ratio. Matches the unit of the original
  observation; a single day often holds both kinds of commit, which pulls the ratio toward
  1 and makes 3.0 very hard to reach.
- **Option C** - no rule. Initialize always offers the report on a project with five or
  more active months and lets the numbers speak. Nothing uncalibrated is asserted; every
  established project gets the prompt, which is the nagging principle 4 warns about.
- **Option D** - hold the feature until M1 to M4 have been measured on a handful of real
  projects (the ones named in the issue and constitution) and set thresholds from that.
  The only option that rests on measured data; nothing ships until someone runs it.

Changes FR-5a and AC-8.

### DQ-4 - What happens to the "Autopilot rebuild" path?

- **Option A (rec)** - leave it out entirely (FR-10). **Cost:** half of the issue's
  proposed two-path offer is not delivered, and nothing in the product points at it.
- **Option B** - show it as unavailable with a pointer to DR-036. Keeps the idea visible;
  ships a control that does nothing, in a product whose signpost is meant never to mislead.
- **Option C** - make this spec depend on Autopilot Mode being built. Delivers the issue as
  written; blocks a small read-only feature on a large one that lives in another extension
  ([DR-015](../../../docs/decisions/DR-015.md)).

Changes FR-10 and AC-14.

### DQ-5 - Is there a cost estimate?

- **Option A (rec)** - none; show size only (FR-11). **Cost:** the issue's headline claim,
  that MinSpec can say what a rebuild costs before committing to one, is not delivered.
- **Option B** - a token estimate with no money: lines at `HEAD` times a tokens-per-line
  constant times a rebuild multiplier. Gives a number to plan with; both constants would be
  invented, and a figure printed by a tool reads as measured.
- **Option C** - tokens times a price table, as the issue proposes. Needs a price table
  that goes stale with every provider change, shows dollars that do not exist under
  subscription billing ([DR-052](../../../docs/decisions/DR-052.md)), and the product the
  issue names as the source is shelved.

Changes FR-11 and AC-14. A separate issue for a calibrated estimate is listed under
Traceability as not yet filed.

### DQ-6 - Does the scan run inside Initialize at all?

- **Option A (rec)** - yes, once, on first Initialize, speaking only on a heavy result
  (FR-6). **Cost:** a sixth possible prompt in Initialize's first-run sequence
  (Reality-check row 9), and a seventh if the brownfield document audit (#205) is approved
  as drafted; the two specs would need one agreed order at Plan.
- **Option B** - command only. Initialize is unchanged; the person has to know the command
  exists and already suspect the problem, which is the situation the issue set out to
  remove.
- **Option C** - fold the result into one combined "existing project" summary shared with
  the document audit. One prompt instead of two; couples this spec to another that is
  neither approved nor merged.

Changes FR-6, FR-7, AC-9 and AC-10.

## Why no new DR

Nothing here is hard to reverse. The scan is read-only, the thresholds are config with
defaults, the one stored answer is a preference key, and the draft spec is an ordinary file
the person can delete. Removing the feature removes two commands and one call in
Initialize. `docs/decisions/INDEX.md` was searched for `tech debt`, `rebuild`, `brownfield`
and `churn` and holds no decision on this subject. Two answers would change that and need a
record before Plan: DQ-1 Option B (MinSpec reading files outside the project) and DQ-5
Option C (MinSpec publishing a price).

## Out of Scope

- Detecting dead code, unstable interfaces or changed requirements directly.
- Any claim, in the product or its listing, that MinSpec knows when a rebuild is cheaper
  than continued patching. These measurements cannot support it (INV-5).
- Autonomous rebuild execution (DQ-4) and cost estimation (DQ-5).
- Reading chat history (DQ-1).
- A recurring or scheduled check. The monthly tripwire of #691 remains a developer script
  for this repository; wiring it into CI or the editor is not part of this spec.
- Guidance on how to carry out a rebuild beyond the three empty sections of FR-9.

## Alternatives considered and rejected

- **Widen `fix-feat-tripwire.ts` in place and ship it as the feature.** Its area split and
  its ceiling default encode this repository's layout and history; changing them would
  alter the developer script's output (FR-12). The parser is shared and the adopter-facing
  rules live in a new module.
- **Write the report to `.minspec/` as a file.** A saved report ages silently and would be
  read later as current. The only persisted copy is the snapshot inside the rebuild spec,
  which is dated and labelled as a snapshot.
- **A single 0-100 "debt score".** It hides four different units behind one number and
  invites the verdict INV-5 forbids.
- **Run on every activation until answered.** Breaks constraint 3 and principle 4.

## Risks & Mitigations

| Risk | Mechanism | Mitigation |
|---|---|---|
| The rule fires on a healthy project in maintenance | A mature product legitimately has more fixes than features | Requires both conditions; report says so in its fixed limits section; one prompt, once; DQ-3 Option D if the founder wants calibration first |
| The rule stays silent on a project that is in trouble | Unconventional commit messages, squash-merged history, thresholds uncalibrated | *Could not measure* is reported honestly by the command; classification coverage is shown; thresholds are config |
| A large history slows Initialize | `git log --numstat` over many thousands of commits | Bounded, off the Initialize path, cancellable, truncation reported (FR-1, AC-2) |
| The numbers are read as a recommendation | A tool-printed figure carries authority | INV-5, INV-6, AC-12; the draft spec leaves keep, drop and cutover to the person |
| Prompt pile-up with the document audit (#205) | Two specs each add a first-init step | DQ-6; whichever lands second states the order in its plan |
| The snapshot in a rebuild spec goes stale | History keeps moving after the spec is drafted | Snapshot carries commit hash and date and is labelled as a snapshot (FR-9) |

## Test plan (for the Plan phase to place)

- Unit tests over the pure core with captured `git log` fixtures: each measurement, each
  *could not measure* reason, both threshold boundaries, exclusions, keyword classification.
- A command test with a stubbed process runner asserting the read-only subcommand set.
- An Initialize test asserting the prompt sequence for each of the three results and for a
  throwing scan.
- The two existing inventories (process spawn, command opt-in) extended and passing.
- A string test over the feature's literals for the forbidden wording of AC-12 and AC-14.

## Traceability

- Issue: [#242](https://github.com/AIClarityAU/minspec/issues/242).
- Goal: G-2 (prevent tech debt), `.minspec/constitution.md:41`.
- Existing code reused: `packages/minspec/src/lib/fix-feat-tripwire.ts` (#691 monthly
  fix-to-feature tripwire).
- Decisions this design rests on: [DR-004](../../../docs/decisions/DR-004.md) (tiered
  network consent; this is Tier 0), [DR-006](../../../docs/decisions/DR-006.md)
  (first-class onboarding), [DR-015](../../../docs/decisions/DR-015.md) and
  [DR-036](../../../docs/decisions/DR-036.md) (where autonomous execution lives and its
  state), [DR-052](../../../docs/decisions/DR-052.md) (subscription billing default),
  [DR-074](../../../docs/decisions/DR-074.md) (blast radius and the opt-in marker),
  [DR-075](../../../docs/decisions/DR-075.md) (ScroogeLLM funnel retired),
  [DR-078](../../../docs/decisions/DR-078.md) (the preferences file).
- Neighbouring specs: [SPEC-086](../SPEC-086-remove-scroogellm-upsell/requirements.md),
  [SPEC-096](../SPEC-096-opt-in-marker-single-creator/requirements.md); the brownfield
  document audit for #205 (unmerged, on branch `agent/issue-205`).
- **Follow-ups not yet filed.** This dispatch has no network access and could not create
  issues. Two are needed if the recommended options are accepted, so the deferred halves of
  the issue are not lost: (1) a calibrated rebuild-effort estimate (DQ-5); (2) an
  autonomous rebuild path once Autopilot Mode exists (DQ-4). A third if DQ-3 Option A is
  accepted: measure M1 to M4 on real projects and set the thresholds from data.
