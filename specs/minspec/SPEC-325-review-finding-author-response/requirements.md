---
id: SPEC-325
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - measures whether the ai-review gate's findings were right
aspects: [ai-review, eval, measurement, no-silent-gate, offline]
depends_on: []
relates_to: ["#3672", "#2983", "SPEC-291", "SPEC-044", "DR-060", "DR-079", "DR-104"]
implements: none
implements_reason: >-
  Specify phase only. Expected surface: a read-only outcome reader under `scripts/` (sibling
  of `scripts/review-churn-report.sh`), a hook into SPEC-291's drafter and `promote` step, and
  tests. Which files it owns is decided at Plan, after the Clarify decisions below.
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-325: Record what happened to each ai-review finding (fixed, disputed, ignored) and feed it to the reviewer eval set

> **This is a SPECIFICATION ONLY.** Written for issue #3672 (author-response tracking per
> reviewer finding). Nothing is built until a human reads it, resolves
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.
> No decision record: every choice here is reversible in under a day (see D6).

## In plain terms

The ai-review reviewer posts findings on a pull request. Nothing records what happened to
each one afterwards: did the author change the code it pointed at, argue it was wrong, or
leave it alone? That outcome is the only signal that says whether a finding was right. This
spec adds a read-only reader that labels every finding **fixed**, **disputed** or **ignored**,
then uses the labels in two places in SPEC-291 (the reviewer eval set): as a new source of
draft cases, and as a veto in its promotion rule (SPEC-291 decision D4, how a draft case
becomes scored).

## Background (verified at spec time, 2026-11-13, against `origin/main`)

- **A finding is structured, but has no identity.** The reviewer returns
  `findings: [{severity, location, problem}]` through a JSON schema
  (`.github/scripts/ai-review-guard.js`, `VERDICT_SCHEMA`, line 76), and the parent
  renders it as `- <severity> <location> — <problem>` lines in the PR comment and in the
  `ai-review` check-run summary. No finding carries an id, so "the same finding in the next
  round" is not defined anywhere today.
- **A pull request has several review rounds.** One per head commit, plus carried rounds
  where a prior pass is reused without the voters running (`.github/workflows/ai-review.yml`
  around lines 107-124 and 306-389; DR-104 verdict carry). `scripts/review-churn-report.sh`
  already reads rounds back from check-runs with `filter=all`, read-only.
- **Most "authors" answering findings are agents.** The drain hands `ai-review:changes`
  findings to a dev agent that addresses them and re-pushes (`scripts/remediate-pr.sh`,
  header lines 14 onward; DR-060). I found no channel through which that agent, or a human,
  can say a finding is wrong: grepping `disput` across `scripts/` and `.github/` finds only
  unrelated hits (unverified beyond that grep: a free-text "this is not a defect" comment may
  exist on some PRs, but nothing machine-readable does).
- **SPEC-291's Plan** (design.md on the in-flight branch `cos/plan-next-1113d`, not on main
  yet) promotes a draft when its proof patch applies and K = 3 panel runs agree. Unanimous
  means consistent, not correct (its *Promotion (D4)* section). Author responses are the missing correctness
  signal.

## Functional requirements

- **FR1 - Finding identity.** Every finding of every completed (not carried) ai-review round
  gets a stable id derived from data already posted: the round's head commit, the voter
  role, and the finding's ordinal in that voter's list (scheme: D3). The same inputs always
  give the same id. A finding whose round cannot be read fully (pagination refused,
  truncated summary, unparseable line) gets no id and is counted as `unreadable`, never
  dropped silently.
- **FR2 - Location resolution.** A finding's `location` text is resolved to a repo path and,
  where present, a line or line range. A location that names no file in the round's diff
  is `unresolved`. Outcomes in FR3 that need a path are not assigned to an unresolved
  finding; it is counted under its own name.
- **FR3 - Outcome per finding.** Once the pull request is closed (merged or not), each
  identified finding gets exactly one outcome:
  - `fixed` - a later commit on the same pull request, before it closed, changed the
    finding's resolved path within the line window set at Plan (default: the cited lines
    plus or minus 10).
  - `disputed` - the author recorded a dispute of that finding through the channel D2
    picks, before the pull request closed, and did not also fix it. A finding both
    disputed and fixed is `fixed`, with the dispute kept in the record.
  - `ignored` - neither of the above, and the pull request merged.
  - `abandoned` - the pull request closed unmerged with the finding neither fixed nor
    disputed. Kept separate so an abandoned PR is not read as the author ignoring a
    finding.
  A finding raised again in a later round of the same PR is one finding (the later round's
  copy links to the first by the D3 matching rule), not two.
- **FR4 - Later evidence.** For merged pull requests, the reader also records, within the
  window SPEC-291's D2 detector uses (its Plan says 60 days), whether the finding's resolved
  location was later reverted or changed by a `fix` commit (SPEC-291's repeat-fix
  definition, reused, not re-implemented). This yields two derived labels:
  - `ignored-then-fixed` - `ignored` or `disputed`, then a later revert or repeat-fix of
    that location. Evidence the finding was right.
  - `disputed-and-held` - `disputed`, the window has fully elapsed, and no later revert or
    repeat-fix touched the location. Evidence the finding was wrong.
  A finding whose window has not elapsed is `pending`, never `held`.
- **FR5 - Output.** The reader prints one machine-readable record per finding (id, PR,
  round head, voter, severity, resolved path and lines, outcome, derived label, the commit
  or comment that proved it) and a one-line summary with counts per outcome, per voter,
  plus `unreadable`, `unresolved` and `pending`. Storage and cadence: D4.
- **FR6 - Draft source for SPEC-291.** Two derived labels become SPEC-291 draft cases
  (`status: unreviewed`), written through SPEC-291's drafter, not a second writer:
  - `ignored-then-fixed` → a defect case (`kind: incident`), `expected.verdict: finding`,
    `expected.file` = the finding's resolved path, provenance = the PR, the round head and
    the proving later commit. The finding's location supplies the file, so this case does
    not depend on SPEC-291's blame heuristic.
  - `disputed-and-held` → a `clean-control` case, **only when every finding of every voter
    in that round is `disputed-and-held`**. A round with any other finding is not a clean
    diff, so it cannot be a control; it is counted as `held, not a control`.
- **FR7 - Promotion veto (changes SPEC-291 D4).** SPEC-291's `promote` step additionally
  refuses a draft whose expected verdict is contradicted by author-response evidence for the
  same diff: a `finding` case whose location's finding is `disputed-and-held`, or a
  `clean-control` whose round has a finding later `ignored-then-fixed`. The refusal names the
  case and the contradicting finding id. Author responses veto only; they never promote on
  their own (D5). Where no author-response record exists for a case, promotion proceeds
  under SPEC-291's rule unchanged.
- **FR8 - Fail visibly.** An API error, an expired token, a rate limit, a pagination limit
  hit, or zero rounds read on a PR known to have an ai-review check exits non-zero with a
  named reason. The reader never prints "no findings" for a run that could not read
  (invariant 2; the same failure `scripts/review-churn-report.sh` header point 3 records).
- **FR9 - Read-only on GitHub.** The reader writes nothing to GitHub: no comment, label,
  check-run or status. Any file it writes is local (D4).

## Acceptance criteria

- [ ] A fixture PR where a later commit edits the cited lines labels that finding `fixed`;
      one where a later commit edits a different file labels it `ignored` (merged) or
      `abandoned` (closed unmerged).
- [ ] The same finding raised in rounds 1 and 2 of one PR is reported once, with both
      rounds linked.
- [ ] A recorded dispute (D2 channel) with no later edit to the location labels the finding
      `disputed`; with an edit, `fixed`, dispute retained.
- [ ] A merged `disputed` finding whose location is reverted inside the window is
      `ignored-then-fixed`; one whose window elapsed untouched is `disputed-and-held`; one
      whose window has not elapsed is `pending`.
- [ ] An `ignored-then-fixed` finding produces an `unreviewed` SPEC-291 draft with
      `expected.file` = its resolved path and provenance naming the proving commit.
- [ ] A round where one finding is `disputed-and-held` and another is `fixed` produces no
      `clean-control` draft and is counted `held, not a control`.
- [ ] `promote` refuses a `finding` draft contradicted by a `disputed-and-held` record and
      names both; a draft with no record promotes exactly as under SPEC-291 alone.
- [ ] A stubbed API error, a truncated round summary and a pagination limit each exit
      non-zero with a named reason; none prints an all-zero summary.
- [ ] A carried round contributes no new finding ids.
- [ ] Run against a recorded fixture set, the reader issues no write call (asserted on the
      stub transport).

## Invariants this must not break

- **INV-1 (offline by default, constitution 1).** The reader reads GitHub, so it runs only
  on explicit invocation or in this repo's CI. It is never part of `npm test`, extension
  activation, or any default path; its tests run against recorded fixtures with no network.
- **INV-2 (no silent gate, constitution 2).** FR7 changes a gate (SPEC-291 promotion). A
  reader error during `promote` fails promotion closed and visibly; it never falls back to
  "no evidence, promote". An absent record (the reader ran, found nothing for that diff) is
  distinct from a failed read.
- **INV-3 (blast radius, constitution 3).** Dev-time tooling for this monorepo only. Nothing
  ships to an adopter repo or changes any repo without `.minspec/`.
- **INV-4 (reviewer trust model, DR-079).** The reader parses the rendered verdict block
  and comments as untrusted text. A finding's `problem` text, a PR comment, or a dispute
  body never becomes a command, path outside the repo, or verdict. Nothing here changes what
  the reviewer sees or how a verdict is decided.
- **INV-5 (no new merge gate).** An outcome never blocks or unblocks a merge, and never
  changes an `ai-review:*` label. This is a measurement, not a gate on PRs.
- **INV-6 (tenet 2).** The reader makes no model call. Its cost is API reads, stated per run
  (PRs x rounds x pages) at Plan.

## Out of scope

- Changing reviewer prompts or behaviour, or scoring reviewers (SPEC-291 owns that).
- Changing the remediation agent's behaviour, except as D2 explicitly decides. If D2 picks
  an explicit dispute channel, teaching the dev and remediation agents to use it is a
  separate issue filed at Plan.
- Backfilling outcomes for every historical PR. A bounded backfill (window at Plan) is in
  scope only as far as FR4's window needs.
- Any author-facing UI or dashboard.

## Decisions needed (Clarify)

Each item gives a recommendation and the cost of taking it.

- **D1 - How is `fixed` decided?**
  - **Option A (rec): deterministic - a later commit on the PR edits the cited path within
    a line window.** *Cost:* an edit near the line for another reason counts as a fix, and
    a fix made elsewhere (a caller, a test) counts as ignored. Drafts stay unscored until
    promoted, which absorbs some of the noise.
  - Option B: an LLM judges whether the later commit addresses the finding. *Cost:* a model
    call per finding (tenet 2), non-determinism in a measurement that then vetoes a gate.
  - Option C: path-only (any edit to the file counts). *Cost:* far more false `fixed`,
    especially on large files.
- **D2 - What is a dispute? Today there is no channel for one.**
  - **Option A (rec): an explicit, machine-readable marker in a PR comment by the PR's
    author or the remediation agent, naming the finding id (the reader would print ids
    so they can be quoted).** *Cost:* until agents are taught to write it (separate issue),
    `disputed` is near zero, so FR6's `clean-control` source stays dry; the marker is also a
    new string other tooling must not confuse with protocol tokens.
  - Option B: infer from free-text author comments (keyword or LLM). *Cost:* keyword
    matching is unreliable; an LLM adds spend and a second untrusted-text surface.
  - Option C: drop `disputed`; track only fixed / ignored. *Cost:* loses the only route to
    reviewer false-positive cases, half of what the issue asks for.
- **D3 - Finding identity and cross-round matching.**
  - **Option A (rec): id = round head commit + voter + ordinal, computed by the reader from
    what is already posted; a later round's finding matches an earlier one when voter,
    resolved path and normalised `problem` text agree.** *Cost:* no change to the ai-review
    workflow, but a reworded repeat of the same finding is counted twice.
  - Option B: ai-review renders an id next to each finding. *Cost:* edits
    `ai-review.yml` and the guard, which is merge-gating machinery needing founder review
    (`machinery-review-required`); gives authors a stable handle for D2.
- **D4 - Where do outcomes live, and when does the reader run?**
  - **Option A (rec): on demand plus as a step of SPEC-291's draft job; output is printed
    and handed to the drafter, with no committed outcome store.** *Cost:* the
    `disputed-and-held` window must be recomputed each run (API reads), and there is no
    history of outcome counts over time.
  - Option B: also append a JSONL history under `tests/review-eval/`. *Cost:* repo growth
    and a second history file to keep consistent with SPEC-291's.
- **D5 - How much weight do author responses get in promotion?**
  - **Option A (rec): veto only (FR7).** *Cost:* a case the author evidence strongly
    supports still needs SPEC-291's consistency check to promote. Reason for the
    recommendation: most authors here are agents that fix whatever they are told, so
    `fixed` is weak evidence the finding was right; only the later-window labels are strong.
  - Option B: `ignored-then-fixed` and `disputed-and-held` promote without the K-run
    check. *Cost:* skips the noise measurement, so a case that flips run to run enters
    the score.
- **D6 - Decision record?** I recommend none: the outcome rules, storage and veto are each
  reversible in under a day (the decision-record filter: only a choice that cannot be undone in under a day needs one). *Cost:* if D2 or D3 picks a protocol change to
  ai-review comments, that change is harder to undo once adopters of the marker exist, and
  should then get a DR at Plan.

## Follow-ups (tracked)

- SPEC-291 - FR6 and FR7 amend its drafter and promotion rule; its Plan (design.md) must be
  updated at this spec's Plan to cite them.
- Teaching the dev and remediation agents to write the D2 dispute marker - filed as its own
  issue at Plan, only if D2 picks Option A.
