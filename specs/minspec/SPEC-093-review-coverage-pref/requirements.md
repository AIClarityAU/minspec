---
id: SPEC-093
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-010  # Reviewer Across All Approvables - its "Done" definition names the per-dev coverage setting this spec finishes
aspects: [reviewer, ai-review, coverage, panel, dispatch, no-silent-gate, machine-local-pref]
relates_to: [SPEC-031, SPEC-033, SPEC-044, DR-047, DR-033, DR-063, DR-079, DR-097, "#453", "#600", "#1234"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 ownership-declaration
# rule). Both files are NEW. Their names are this spec's proposal; Plan may rename them, which
# is an amendment to this line and nothing else.
implements: [scripts/lib/review-coverage.sh, packages/minspec/tests/review-coverage.test.ts]
# Modified, not owned. review-pr.sh is owned by SPEC-031 (reviewer across all approvables) and
# dispatch-issue.sh by SPEC-044 (coordinated self-completing sessions) via their `implements:`
# lines. ci-review-templates.ts is regenerated because review-pr.sh is a drift-gated source
# (scripts/gen-ci-templates.mjs:96). The #600 label test is touched only under DQ-3 option a.
# .github/workflows/ai-review.yml is deliberately ABSENT - see INV-6.
affects: [scripts/review-pr.sh, scripts/dispatch-issue.sh, .gitignore, packages/minspec/src/lib/ci-review-templates.ts, packages/minspec/tests/dispatch-no-local-ai-review-label.test.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-093: A per-developer review-coverage preference for the local review runners

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves
> it through the normal spec-approval gate before anything is built from it.

Materializes **[#453](https://github.com/AIClarityAU/minspec/issues/453)** (per-dev ai-review
coverage pref plus the adversarial panel), the follow-up that
[DR-047](../../../docs/decisions/DR-047.md) (independent AI review across every approvable)
Decision 6 names at `DR-047.md:369-370`.

> **On the number.** `main` holds specs up to SPEC-086. Local branches in this checkout
> already carry directories numbered 087 to 092 (092 three times over), so highest-on-main
> plus one would collide. 093 is the lowest number that neither `main` nor any locally
> visible branch claims. Open pull requests on the forge were **not** checked - this dispatch
> has no network - so 093 is inferred free, not verified free. The spec-id collision gate
> (`scripts/lib/spec-id-collision.ts`) is the authority once this is pushed.

## Read this first - most of #453 already shipped

The issue was written on 2026-07-04. Two of its commits landed shortly after
(`3b2e64df` the skeptic role, `8d653f99` the panel wiring, merged as `9763f1df`), and the
issue stayed open. Read against `main` at `8bfc5cc5`, its five work items stand like this:

| Issue item | State on `main` | Evidence |
|---|---|---|
| 1. Per-dev pref `none / single / panel` in a gitignored file | **Not built.** | No file, script or ignore rule mentions `review-coverage`; the only hits for the string are prose. CI has a *repo-level* variable instead, with two levels and no `none`: `.github/workflows/ai-review.yml:299-300`. |
| 2. Panel voters reviewer + security + architect + skeptic | **Built, in CI only.** | Voters required at `ai-review.yml:422-436`, launched at `:475-486`; `scripts/review-branch.sh:55-58` accepts all four roles. |
| 3. New `scripts/roles/skeptic.md` | **Built.** | The file exists (67 lines) and is scaffolded to adopters (`scripts/gen-ci-templates.mjs:161`). |
| 4. Fail-closed merge rule across N verdicts | **Built, in CI only, and stricter than the issue asked.** | `ai-review.yml:583-610`. It has three outcomes, not two - see "The combine rule moved on" below. |
| 5. Wire `review-pr.sh` to the pref and dispatch 1 or 4 voters | **Not built.** | `scripts/review-pr.sh:186-190` runs one voter, always `reviewer.md`. The dispatch-time stage runs at most two (`scripts/dispatch-issue.sh:949`, `:957`). |

So this spec covers the remainder: the preference itself (item 1) and the two **local**
runners that should obey it (item 5). It does not re-specify the skeptic role or the CI
panel, and it changes neither.

## One-Sentence Scope

Give each developer a machine-local, never-committed preference - `none`, `single` or
`panel` - that decides how many independent voters the two local review runners
(`scripts/review-pr.sh` and the dispatch-time reviewer stage in `scripts/dispatch-issue.sh`)
spend on a diff, using the same voter roster and the same verdict-combining rule the CI panel
already uses, and saying in every output which level ran and why.

## Context - what the code does today

### Three review surfaces, three different voter rules

| Surface | Who runs | Voters today | Writes the gating label? |
|---|---|---|---|
| **CI** - `.github/workflows/ai-review.yml` | every pull request | reviewer always; security when any changed file is not Markdown (`:422-424`); architect and skeptic when coverage is `panel` (`:431-436`) | Yes - the only authorized writer |
| **Dispatch stage** - `run_reviewer_stage`, `scripts/dispatch-issue.sh:941` | every agent dispatch, after the push | reviewer always (`:949`); security only when the diff touches `packages/` (`:956-957`) | No - comment only, pinned by a test (`dispatch-no-local-ai-review-label.test.ts`, the #600 no-local-label rule) |
| **Manual runner** - `scripts/review-pr.sh` | a developer, by hand; no script or workflow calls it | reviewer only (`:186-190`), with no tools, over a diff truncated at 180000 bytes (`:113-124`) | **Yes** (`:246-248`) |

Three things in that table are defects this spec has to deal with, because a preference
layered on top would otherwise mean something different on each surface:

1. **The security predicate drifted.** CI widened it from "touches `packages/`" to "any
   non-Markdown file" in commit `a43b825e`. The dispatch stage still uses the old one
   (`dispatch-issue.sh:956`), so a dispatch that changes only `scripts/` or `.github/` gets
   no local security read, while CI gives it one.
2. **The dispatch stage has no "could not run" outcome.** Its combine is "pass only if every
   voter passed, otherwise changes" (`dispatch-issue.sh:966-970`). A voter that died on a
   quota limit therefore posts `--request-changes` on the pull request (`:1123-1129`) - an
   objection nobody made. CI fixed exactly this as #1234 (absent voter read as an objection).
   With up to four local voters instead of two, the local copy of the defect gets more
   likely, not less.
3. **The manual runner writes the merge-gating label.** #600 established that only CI
   applies `ai-review:*`, because two writers raced on one label and produced a
   pass-revert-pass churn (`dispatch-issue.sh:1106-1114`). The test that pins it scans only
   `dispatch-issue.sh`. `review-pr.sh` still removes `ai-review:changes` and adds its own
   verdict (`:246-248`). Reading `decideStatus` (`.github/scripts/ai-review-guard.js:1047-1064`),
   I believe a locally applied `pass` cannot turn the merge gate green on its own, because the
   gate also needs a head-bound witness that only CI posts, while a locally applied `changes`
   **can** turn it red. That is read from the code, not exercised.

### The combine rule moved on since the issue was written

The issue asks for "fail-closed OR - any voter's `blocking > 0` gives `ai-review:changes`".
CI now implements a three-outcome rule with a fixed precedence (`ai-review.yml:583-610`):

- any required voter said **changes** - result `ai-review:changes`;
- otherwise any required voter was **blocked** (could not run) or **did not report** -
  result `ai-review:blocked`, which is retry-able and is not an opinion about the code;
- otherwise - `ai-review:pass`.

A real objection still wins over an outage, so this is no weaker than the issue's rule. It
adds only that an outage is not reported as an objection. This spec adopts the shipped rule.

### Why a machine-local file cannot be the CI setting

`.minspec/review-coverage` is to be gitignored, so a CI runner never sees it. CI's depth is
the repository variable `AI_REVIEW_COVERAGE`, and it accepts only `single` and `panel`; any
other value, `none` included, resolves to `panel` (`ai-review.yml:300`). That is the correct
behaviour under constitution invariant 2 (no silent gate): `ai-review` is a required,
merge-gating check, and a per-developer file must not be able to switch it off.

The consequence is the single largest reinterpretation of the issue in this spec, and it is
put to the human as DQ-1: **`none` means "this machine spends nothing on a local advisory
review". It does not mean, and cannot mean, "this pull request is not AI-reviewed".**

### The preference file has to be found from a linked worktree

The precedent is `.minspec/auto-drain`: gitignored (`.gitignore:119`), one word of content,
written by a script flag (`scripts/drain-inbox.sh:1922`) and read by comparing the whole file
to a literal (`:1935`). That script finds the file relative to its own location (`:123`).

That is not enough here. An ignored file exists only in the working tree where it was
written. A dispatch runs from a linked worktree, and the drain can run `dispatch-issue.sh`
from its self-synced run directory (`drain-inbox.sh:644-646`, default
`/tmp/minspec-drain-run`). Resolved relative to the script, the preference would be absent in
both, and every dispatch would silently fall back to the default whatever the developer set.
The auto-drain file already had a silent path-drift bug of this family
(`drain-inbox.sh:1830-1833`).

### Why no new DR

The filter for a decision record is a choice that cannot be undone in under a day. Nothing
here meets it: a preference file, a helper the two runners call, and a changed default are
each reverted by one commit. The governing decisions already exist and are not contradicted:
DR-047 Decision 6 (per-dev coverage is config, surfaced, never silently changed), DR-033
section 6 (the independent reviewer), DR-079 (the verdict travels out of band), and DR-063
(the `blocked` class). `docs/decisions/INDEX.md` was searched for "coverage", "panel" and
"skeptic" before concluding this; the hits are DR-047, DR-079 and DR-097 (per-voter reuse),
none of which decides the local preference. One point does differ from DR-047's wording and
is surfaced rather than buried: DR-047 Decision 6 says the dogfood default is maximum
coverage, and DQ-2 recommends a local default of `single`.

## Functional Requirements

### The preference

- **FR-1 - Three levels.** The preference has exactly three values: `none`, `single`,
  `panel`. They are lowercase and compared after trimming surrounding whitespace.
- **FR-2 - One file, at the primary working tree.** The value is the whole content of
  `.minspec/review-coverage`, located at the root of the repository's **primary** working
  tree - the one that owns the shared git directory - not relative to the running script and
  not relative to the current directory. Every linked worktree of one clone, including a
  dispatch worktree and the drain's run directory, therefore resolves the same file.
- **FR-3 - Never committed.** `.minspec/review-coverage` is listed in `.gitignore`, in the
  same block and with the same "machine-local, never inherited by teammates" rationale as
  `.minspec/auto-drain`. It is not a key in `.minspec/config.json`, which is shared and
  committed.
- **FR-4 - One resolver.** A single resolver returns two things: the level, and where it came
  from - one of `file`, `default` (no file), or `invalid` (a file that is empty, unreadable,
  or holds anything other than the three values). Both runners call it; neither parses the
  file itself.
- **FR-5 - Absent means the default; invalid never means `none`.** With no file, the level
  is the default chosen in DQ-2. With an invalid file, the level is `panel` and the resolver
  prints a warning to stderr naming the file and the rejected content - the same
  "unknown value fails toward coverage" rule CI applies at `ai-review.yml:300`. A typo must
  never reduce review.
- **FR-6 - Set and show.** There is a documented way to set the level that refuses anything
  other than the three values, so a typo is caught when written rather than when read, and a
  way to print the resolved level together with its source and the path it was read from.
  Setting the level writes only this one file.

### The roster - which voters a level means

- **FR-7 - One roster definition.** A single function maps (level, list of changed files) to
  the set of required voters. Both local runners use it. Under DQ-4 option a (recommended) it
  is exactly CI's rule:
  - `none` - no voters;
  - `single` - `reviewer`, plus `security` when at least one changed file is not Markdown;
  - `panel` - the `single` set, plus `architect` and `skeptic`.
- **FR-8 - Unknown file list fails toward coverage.** When the list of changed files cannot
  be determined, `security` is required at `single` and `panel`. The local roster must not
  drop a voter because an enumeration failed.
- **FR-9 - Equivalence with CI is tested, not asserted.** A test runs the CI roster block
  (`ai-review.yml:422-436`) and the local roster over one shared table of (coverage, changed
  files) rows and fails on any difference at `single` and `panel`. This is the same
  executed-verbatim technique `ai-review-verdict-combine.test.ts` already uses on the combine
  block, and it is what stops the security predicate drifting a second time.

### The combine - how N verdicts become one

- **FR-10 - One local combine, CI's precedence.** A single function maps the required voters'
  labels to one result under the three-outcome rule above: changes beats blocked beats pass,
  and an empty or unrecognised label from a required voter counts as blocked, never as pass
  and never as changes. Each voter's label still comes from `scripts/review-decide.sh`,
  unchanged.
- **FR-11 - Equivalence with CI is tested.** A test runs the CI combine block
  (`ai-review.yml:583-610`) and the local combine over one shared table and fails on any
  difference.
- **FR-12 - An empty roster is not a pass.** Combining zero voters yields no verdict at all.
  The `none` level never produces `ai-review:pass`; it produces a statement that no review
  ran (FR-13, FR-17).

### The dispatch-time reviewer stage

- **FR-13 - `none` skips the voters and nothing else.** `run_reviewer_stage` also ensures the
  labels exist, ensures the pull request exists, and applies the native auto-merge policy
  (`dispatch-issue.sh:1010-1090`). Under `none` all of that still runs; only the voter calls
  and the advisory post are skipped, and the stage prints one line saying the local advisory
  review was skipped by preference, with the file path.
- **FR-14 - `single` and `panel` run the roster.** The stage runs every voter FR-7 requires,
  through `scripts/review-branch.sh --role <role>` as today. Voters run concurrently with
  staggered starts, as CI does (`ai-review.yml:467-486`), so wall-clock is the slowest voter
  and not the sum.
- **FR-15 - `blocked` is posted as what it is.** When the combined result is `blocked`, the
  stage posts a plain comment saying the local review could not run and that CI's review is
  unaffected. It does not post `--request-changes`. `pass` and `changes` post as today.
- **FR-16 - The advisory body names every required voter.** One section per voter that was
  required, in a fixed order, each showing that voter's rendered verdict block or the reason
  it has none. The existing pre-publish egress scan (`dispatch-issue.sh:983-1003`) covers the
  whole body, all voters included, and still withholds on any hit or scan failure.

### The manual runner

- **FR-17 - `none` runs nothing.** `review-pr.sh` prints that coverage is `none`, where that
  came from, and that no review ran, then exits zero. It calls no model, posts no comment and
  changes no label.
- **FR-18 - `single` and `panel` run the roster over one diff.** Every required voter gets
  the same pull-request context and the same (possibly truncated) diff text; only the role
  file differs. Each returns its verdict as the schema-validated object DR-079 requires, and
  each is decided by `review-decide.sh` separately before the combine.
- **FR-19 - Voters here hold no tools.** `review-pr.sh` reviews a diff fetched from the forge
  and has no checkout of the pull request. Every voter it launches therefore keeps the
  runner's existing `--tools ""`, and the prompt says so. A voter must not be handed
  file-reading tools over whatever branch the developer happens to have checked out: the
  skeptic would then "verify" a claim against a different tree from the one under review.
- **FR-20 - Truncation still wins.** The deterministic truncation backstop
  (`review-pr.sh:33-40`, `:215`) applies to the combined result: a truncated diff yields
  `ai-review:changes` whatever the voters said, at every level above `none`.
- **FR-21 - One comment, every voter.** The runner posts a single findings comment carrying
  each required voter's block. Whether it also writes the label is DQ-3.

### Disclosure

- **FR-22 - Every output says what ran.** Each comment a local runner posts, and the
  runner's own terminal output, states: the level; its source (`file`, `default` or
  `invalid`); the voters that ran; and each voter that did not run with the reason
  (docs-only change, or reduced coverage). When the level is below `panel`, the comment says
  in words that this is reduced coverage and that CI's review is the one that gates the
  merge. This mirrors CI's disclosure block (`ai-review.yml:747-781`).
- **FR-23 - A comment never overstates its roster.** Fixed footer text that describes the
  reviewer as a single agent, or as a panel, is replaced by text generated from the roster
  that actually ran.

## Acceptance Criteria

Each is a test the Plan phase must place. "Runs" below means the stubbed `claude` binary was
invoked, counted by the test, not that a real model was called.

- **AC-1 (FR-1, FR-4)** - For file contents `none`, `single`, `panel`, each with and without
  a trailing newline and surrounding spaces, the resolver returns that level with source
  `file`.
- **AC-2 (FR-5)** - With no file, the resolver returns the DQ-2 default with source
  `default` and prints no warning.
- **AC-3 (FR-5)** - For an empty file, `Panel`, `off`, `single panel`, and a file made
  unreadable, the resolver returns `panel` with source `invalid` and prints a warning naming
  the path. No input in this table returns `none`.
- **AC-4 (FR-2)** - In a fixture clone with one linked worktree, a preference written at the
  primary root is resolved identically when the resolver is run from the primary, from the
  linked worktree, and from a copy of the scripts directory that lives in the linked
  worktree. A file written only inside the linked worktree is **not** read.
- **AC-5 (FR-3)** - `git check-ignore --no-index .minspec/review-coverage` succeeds, and a
  test fails if the path is tracked.
- **AC-6 (FR-6)** - Setting `panel` then showing reports `panel`, `file`, and the path.
  Setting `loud` exits non-zero and leaves an existing file byte-identical.
- **AC-7 (FR-7, FR-8)** - Roster table: `none` with any files gives no voters; `single` with
  only Markdown gives reviewer; `single` with one non-Markdown file gives reviewer and
  security; `panel` with only Markdown gives reviewer, architect, skeptic; `panel` with code
  gives all four; an undeterminable file list at `single` gives reviewer and security. (Rows
  change if DQ-4 option b is chosen.)
- **AC-8 (FR-9)** - The roster-equivalence test passes on `main`'s workflow, and fails when
  either copy's security predicate is mutated back to `^packages/`.
- **AC-9 (FR-10, FR-12)** - Combine table: all pass gives pass; one changes with the rest
  pass gives changes; one blocked with the rest pass gives blocked; one changes and one
  blocked gives changes; one empty label with the rest pass gives blocked; one unrecognised
  label gives blocked; zero voters gives no verdict and not pass.
- **AC-10 (FR-11)** - The combine-equivalence test passes on `main`'s workflow, and fails
  when the local combine is mutated to treat an empty label as changes.
- **AC-11 (FR-13)** - Dispatch stage at `none`: zero voter runs; the pull-request-ensure and
  auto-merge-policy steps are still reached; no advisory review or comment is posted; the
  skip line is printed.
- **AC-12 (FR-14)** - Dispatch stage on a diff touching `scripts/` only: `single` runs
  reviewer and security; `panel` runs all four. On a Markdown-only diff: `single` runs
  reviewer alone; `panel` runs reviewer, architect, skeptic.
- **AC-13 (FR-15)** - Dispatch stage with one voter stubbed to emit the unavailable marker
  and the rest passing: a plain comment is posted and `--request-changes` is not invoked.
  With one voter stubbed to request changes and another unavailable: `--request-changes` is
  invoked.
- **AC-14 (FR-16)** - With a secret-shaped string in the architect voter's stubbed output,
  the posted body is the withheld notice, not the voters' text.
- **AC-15 (FR-17)** - `review-pr.sh` at `none`: zero voter runs, zero `gh` write calls, exit
  status zero, and the output contains the level and its source.
- **AC-16 (FR-18, FR-19)** - `review-pr.sh` at `panel` on a code diff: four voter runs, each
  with a different role file, each with `--tools ""`, each receiving a byte-identical prompt
  body.
- **AC-17 (FR-20)** - `review-pr.sh` at `panel` with a diff over the cap and every voter
  stubbed to pass: the result is `ai-review:changes`.
- **AC-18 (FR-21, FR-22, FR-23)** - The posted comment at `single` on a code diff names the
  level, its source, reviewer and security as having run, architect and skeptic as not run
  because of reduced coverage, and contains the reduced-coverage sentence. At `panel` on a
  Markdown-only diff it names security as not run because the change is docs-only and does
  not contain the reduced-coverage sentence.
- **AC-19 (INV-1)** - With the preference set to `none`, the CI roster block run with
  `AI_REVIEW_COVERAGE=none` still requires reviewer, architect and skeptic. (This pins
  shipped behaviour so a later edit cannot quietly add a `none` arm to CI.)
- **AC-20 (INV-5, under DQ-3 option a)** - The #600 no-local-label test covers
  `scripts/review-pr.sh` as well as `scripts/dispatch-issue.sh`, and fails on `main`'s
  current `review-pr.sh:246-248`.

## Invariants (must not break)

- **INV-1 - CI cannot be switched off from a developer's machine.** Nothing in this spec
  gives `.github/workflows/ai-review.yml` a `none` level or makes it read the preference
  file. The required `ai-review` check and the `ready-to-merge` gate behave exactly as before
  on every pull request (constitution invariant 2, no silent gate).
- **INV-2 - A reduction is always visible.** No level below `panel` runs without saying so
  in the runner's output and in any comment it posts (FR-22). `none` never produces a pass
  (FR-12).
- **INV-3 - Failure resolves toward more review.** An invalid preference, an undeterminable
  file list, and an unreported voter each resolve to more coverage or to `blocked`, never to
  `none` and never to `pass`.
- **INV-4 - The reviewer stays credential-free and the diff stays untrusted.** Voters gain no
  tools, credentials or network beyond what `review-branch.sh` and `review-pr.sh` grant
  today. Every credentialed write is still the parent's, after the voters exit, and every
  verdict still passes through `review-decide.sh` (DR-033 section 6, DR-079).
- **INV-5 - The dispatch stage never writes `ai-review:*`.** The #600 rule and its test are
  unchanged for `dispatch-issue.sh`. DQ-3 decides whether `review-pr.sh` joins it.
- **INV-6 - The CI workflow file is not edited.** Equivalence with CI is obtained by testing
  the local seam against the workflow's own blocks (FR-9, FR-11), not by moving those blocks.
  The workflow is scaffolded into adopter repositories; leaving it alone keeps this change
  inside this repository (constitution invariant 3, blast radius is the opted-in project).
- **INV-7 - Offline behaviour is unchanged.** Resolving, setting and showing the preference
  touch only the local filesystem. No new network call is introduced; the runners' existing
  model and forge calls happen only when a developer or a dispatch invokes them
  (constitution invariant 1).
- **INV-8 - The dispatch stage never throws.** Any failure in resolving the level, building
  the roster, or running a voter degrades to a warning and a fail-closed result, and never
  blocks the labelling and issue-comment steps that follow (the existing never-throw rule at
  `dispatch-issue.sh:897-898`).
- **INV-9 - The generated template mirror stays in step.** `review-pr.sh` is a drift-gated
  source; the same change regenerates `packages/minspec/src/lib/ci-review-templates.ts`.

## Decisions needed (Clarify)

Five decisions. Each names the recommended option and what that recommendation costs.

### DQ-1 - Is `none` local-only?

The issue says `none` should "skip `ai-review:*` entirely". A gitignored file cannot reach
CI, and CI's review is a required merge gate.

- **a. Local-only (rec).** `none` stops this machine spending on local advisory reviews; CI
  reviews every pull request regardless. *Cost:* a developer who wants no AI review at all
  does not get it from this preference - they would have to change the repository's required
  checks, which is a governance act this spec does not offer.
- **b. Also add a `none` level to the repository variable.** A repository could then turn
  the CI review off. *Cost:* it makes a merge gate switchable by one variable, with no second
  witness, which is the shape constitution invariant 2 forbids; it would need its own
  decision record and is outside this issue.

### DQ-2 - What is the level when no file exists?

- **a. `single` (rec).** Matches what both local runners do today, so nobody's behaviour
  changes until they set a preference. *Cost:* every dispatch keeps paying for a local
  reviewer whose verdict CI then repeats with the full panel; and it reads against DR-047
  Decision 6's "dogfood default is maximum coverage" - defensible because CI, the enforcing
  surface, already defaults to `panel`, but it is a deviation in wording.
- **b. `none`.** Stops the duplicated spend by default. *Cost:* dispatched pull requests lose
  the pre-CI advisory comment unless a developer opts in.
- **c. `panel`.** Matches DR-047's wording literally. *Cost:* up to four more opus reviews on
  every dispatch on top of CI's four, drawn from the subscription quota whose exhaustion
  #1656 (quota recorded as an escalation) and #2142 (a dead voter discards three verdicts)
  already document.

### DQ-3 - Does `review-pr.sh` keep writing the `ai-review:*` label?

Today it does (`review-pr.sh:246-248`), which the #600 rule forbids for the dispatch path.
Once a preference exists, a `single`-level local run could put its label on a pull request
that CI reviewed at `panel`.

- **a. Comment only, and extend the #600 test to cover it (rec).** One writer of the gating
  label, everywhere. *Cost:* it changes existing behaviour of `review-pr.sh` that the issue
  did not ask to change, and a repository with no CI review workflow loses the only thing
  that labelled its pull requests.
- **b. Keep writing the label; rely on FR-22's disclosure.** No behaviour change. *Cost:* two
  writers of one merge-gating label remain, and a local `changes` from a reduced roster can
  turn the gate red against a CI `pass` (see Context, item 3).

### DQ-4 - Does `single` include the security voter on a code change?

The issue defines `single` as "one `reviewer` voter". CI's `single` runs reviewer plus
security whenever a non-Markdown file changed.

- **a. Follow CI (rec).** One roster rule on all three surfaces (FR-7 as written). *Cost:*
  `single` is up to two voters, so the name understates it, and the dispatch stage starts
  running security on `scripts/` and `.github/` changes it skips today.
- **b. Exactly one voter.** Cheapest, and matches the issue's text. *Cost:* the dispatch
  stage loses the security read it has today on `packages/` changes, and "single" means
  different things locally and in CI - the drift FR-9 exists to prevent.

### DQ-5 - Does this file also set the depth of the document reviewer?

SPEC-031 (reviewer across all approvables) FR-7 describes a per-dev depth slider for
`scripts/review-approvable.sh` and calls it unbuilt, citing both #527 (per-type runners) and
#453. The issue itself puts per-type reviewers out of scope.

- **a. No - this file governs the two pull-request-diff runners only (rec).** SPEC-031 keeps
  its own setting and its own storage decision. *Cost:* a developer may end up with two
  preference files, and SPEC-031's citation of #453 for that slider is left pointing at an
  issue that will close without delivering it - SPEC-031 would need a one-line correction.
- **b. Yes - `review-approvable.sh` reads the same level.** One knob. *Cost:* it pulls a
  SPEC-031 surface into this spec, contradicts SPEC-031's "two surfaces, two independent
  depths" rule, and SPEC-031's dogfood default (depth `single`) would then be forced equal
  to whatever DQ-2 picks.

## Out of Scope

- **The skeptic role file and the CI panel** - shipped (`3b2e64df`, `8d653f99`); not changed.
- **CI's `AI_REVIEW_COVERAGE` variable** - its levels, default and disclosure are unchanged.
- **Per-type reviewers for Spec, Plan, DR, Epic and Issue** - #527, under SPEC-031.
- **The agency-agents sync mechanism** - #230; the issue names it as unrelated.
- **Per-voter verdict reuse across re-runs** - DR-097 covers CI check-runs bound to a head
  SHA; local runs have no such record and reuse nothing.
- **A per-invocation override** (a flag or environment variable that beats the file) - not
  asked for; the file is the single source so that "show" is always the truth.
- **Per-project code-surface detection.** `ai-review.yml:420-421` and SPEC-069 (approval
  record deterministic witness) both attribute "durable code-surface detection" to #453. The
  issue body contains no such item; the nearest owner is SPEC-033 (repo governance
  provisioning) decision D-4. This spec does not build it, and the two citations are left as
  they are because correcting them means editing a workflow file (INV-6) and another spec.
  No issue tracks the correction - this dispatch could not file one - so it is listed in the
  dispatch summary for a human to file.
- **Scaffolding the preference into adopter repositories** - `dispatch-issue.sh` is not
  scaffolded (SPEC-033 FR-6 is the open work) and `review-pr.sh` is drift-gated but not
  scaffolded (`gen-ci-templates.mjs:90-97`), so no adopter runs a consumer of this file.

## Alternatives considered and rejected

- **Store the level in `.minspec/config.json`.** Rejected: that file is committed and shared,
  so one developer's latency choice would become everyone's. The issue rules it out too.
- **Resolve the file relative to the script, as auto-drain does.** Rejected: silently wrong
  from a linked worktree and from the drain's run directory, which is where dispatches run
  (Context, "found from a linked worktree").
- **Invalid content falls back to the default, or aborts.** Rejected: falling back to a
  default of `single` or `none` lets a typo reduce review; aborting would break the dispatch
  stage's never-throw rule. `panel` with a warning is loud, safe, and the rule CI already uses.
- **Move CI's roster and combine blocks into a shared script that all three surfaces call.**
  Rejected for this spec: it edits a scaffolded workflow and adds a scaffolded dependency,
  spreading a local-preference change into every adopter repository. Tested equivalence gets
  the same guarantee with the workflow untouched. The repository already uses pinned
  hand-copies where a workflow cannot import a module (`ai-review.yml:395-403`).
- **Give `review-pr.sh` voters file tools by pointing them at the current checkout.**
  Rejected: the checkout is not the reviewed tree (FR-19).
- **Run local panel voters one after another.** Rejected: CI measured ten minutes for a
  three-line change that way (`ai-review.yml:438-446`).
- **The issue's two-outcome merge rule.** Superseded by the shipped three-outcome rule, which
  blocks in every case the issue's rule blocks and additionally keeps an outage retry-able.

## Test plan (for the Plan phase to place)

1. Resolver unit table (AC-1 to AC-3, AC-6), run against a temporary repository root so the
   developer's real preference is never read or written by the suite.
2. Linked-worktree fixture (AC-4). This is the test most likely to pass vacuously: it must
   include the negative row (a file only in the linked worktree is not read).
3. Ignore and not-tracked checks (AC-5).
4. Roster and combine tables, plus the two equivalence tests with their mutants
   (AC-7 to AC-10, AC-19). The mutants must be shown to land on the line intended.
5. Dispatch-stage tests with a stubbed `claude` and `gh` (AC-11 to AC-14).
6. Manual-runner tests with the same stubs (AC-15 to AC-18), extending
   `review-pr-truncation.test.ts`.
7. The #600 label test extension (AC-20), only under DQ-3 option a.
8. The generated-template drift gate passes after regeneration (INV-9).

CI runs `npx vitest`, not `npm test`, so none of these may depend on a `pretest` hook.

## Traceability

- **Issue:** [#453](https://github.com/AIClarityAU/minspec/issues/453) - per-dev ai-review
  coverage pref and adversarial panel.
- **Decisions rested on:** [DR-047](../../../docs/decisions/DR-047.md) Decision 6 (coverage
  is per-dev config) · [DR-033](../../../docs/decisions/DR-033.md) section 6 (independent
  reviewer) · [DR-079](../../../docs/decisions/DR-079.md) (out-of-band verdict) ·
  [DR-063](../../../docs/decisions/DR-063.md) (the `blocked` class).
- **Sibling specs:** SPEC-031 (reviewer across all approvables; owns `review-pr.sh`) ·
  SPEC-044 (coordinated self-completing sessions; owns `dispatch-issue.sh`) · SPEC-033
  (repo governance provisioning; decision D-4).
- **Epic:** [EPIC-010](../../../docs/epics/EPIC-010-reviewer-all-approvables.md) - Reviewer
  Across All Approvables.
- **Already-landed commits for this issue:** `3b2e64df` (skeptic role), `8d653f99` (CI panel
  wiring), merge `9763f1df`.
