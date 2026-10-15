---
id: SPEC-196
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-010  # Reviewer Across All Approvables - this is the subtractive half of SPEC-031 FR-9 (the review verdict's human-facing labels)
aspects: [ai-review, labels, remediation, human-gate, liveness, no-silent-gate, blast-radius]
depends_on: [SPEC-031, DR-060, DR-061, DR-063]  # SPEC-031 FR-9c names this as its follow-up; DR-060/061 are the remediation loop the retirement hands work to; DR-063 is the awaiting-approval decision that superseded the eager label
relates_to: [SPEC-062, SPEC-065, SPEC-044, "#816", "#938", "#1073", "#596", "#782", "#817", "#1894"]
# Ownership is declared at Clarify, not here: which files change depends on OQ-1 (a rename
# touches about fifteen scripts and fourteen test files; keeping the name touches two files).
# Under every answer the files below are MODIFIED, not owned.
affects: [.github/scripts/ai-review-guard.js, .github/scripts/ai-review-guard.test.js, .github/workflows/ai-review.yml, packages/minspec/src/lib/ci-review-templates.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-196: `needs-human-review` is applied only when a human really is the next actor

Tracks issue [#816](https://github.com/AIClarityAU/minspec/issues/816). Design rationale:
DR-063 §5 (the `awaiting-approval` decision that superseded the eager label) and DR-060 /
DR-061 (the remediation loop the retirement hands work to). No new decision record: nothing
this spec decides on its own is costly to undo (see *Costly to Refactor*). If the founder
picks a rename in OQ-1, that choice IS costly to undo in adopter repos and gets a DR at Plan.

## In plain terms

Issue #816 asked for three things. Two of them are already built. The third is a naming
choice that only you can make.

1. **Built (#938).** The AI reviewer no longer adds `needs-human-review` the moment it says
   `ai-review:changes` on an ordinary pull request. The remediation script tries to fix it
   first and adds the label itself only when it gives up.
2. **Built (#938, #1073).** The label now means "a human is the next actor". Where no
   remediation script exists (adopter repos), the reviewer still adds it at once, so a
   pull request is never handed to nobody.
3. **Not built: the rename to `needs-human-fix`.** This is OQ-1 below.

Reading the shipped code turned up two gaps that #816 did not name. In both, a pull request
can now sit at `ai-review:changes` with no label and nobody working on it:

- **The check asks the wrong question.** The reviewer skips the summon when the file
  `scripts/remediate-pr.sh` exists in the repo. But that script only takes branches
  named `agent/…`, `fix/…` or `feat/…`, and never takes forks. A `spec/…`, `docs/…` or
  `chore/…` pull request gets neither the label nor a fix attempt. FR-4 fixes this.
- **Remediation only runs when someone runs the drain.** `remediate-pr.sh` is called from
  `scripts/drain-inbox.sh`, which runs on a workstation and is off unless you turn it on.
  Even an `agent/…` pull request waits with no label until a drain happens to run. OQ-2
  asks how long that wait may be.

## One-Sentence Scope

Make `needs-human-review` appear on a pull request exactly when a human is the next actor:
suppress it at review time only for pull requests the remediation lane will actually take,
put a time limit on that suppression, and settle the label's name.

## Context - what is already built (measured 2026-10-16 on `agent/issue-816`)

| #816 item | State | Evidence |
|---|---|---|
| 1. Stop the eager label on `ai-review:changes` | **Built**, #938 (`05950055`) | `shouldSummonHumanReview`, `.github/scripts/ai-review-guard.js:1863-1881`; the summon step in `.github/workflows/ai-review.yml` (comment opening "Summon a human ONLY when a human is GENUINELY the next actor (#816)") |
| 2. Label means "automation exhausted" | **Built, with a wider meaning**: "a human is the next actor" | Label description in the summon step and at `scripts/remediate-pr.sh:631-632`; machinery pull requests are summoned on `pass` as well as on `changes` (`ai-review-guard.js:1865`) |
| Fallback where no remediator exists | **Built**, #1073 (`0553c5b2`) | `ai-review-guard.js:1878`, deny-by-default; tests at `.github/scripts/ai-review-guard.test.js:705-727` |
| 3. Rename to `needs-human-fix` | **Not built** | No occurrence of `needs-human-fix` anywhere in the tree |

Places that still apply `needs-human-review` (all of them are a human-next state):

- `ai-review.yml`, summon step: machinery pull request (any verdict), or `ai-review:changes`
  where `scripts/remediate-pr.sh` is absent.
- `ai-review.yml`, fail-closed backstop: the workflow errored before giving any verdict.
  Kept eager on purpose, because there is no review for automation to fix from.
- `ai-review-retry.yml:102-106`: a quota block that the retry cannot clear.
- `remediate-pr.sh`: conflict (`:624-633`), attempt cap (`:716-724`), escalate (`:891-893`),
  quarantine (`:913-915`).
- `drain-inbox.sh:1085`: on **issues**, not pull requests. `dispatch-ready-check.sh:685` and
  `approve-on-label.sh:296-298` read it on issues. So the label name is shared between pull
  requests and issues.

Where the code and the docs disagree (for Plan to fix, FR-6):

- SPEC-031 INV-8 (`requirements.md:125`) and FR-9c (`:246`) still describe the retirement as
  future work, and give the meaning as "automation exhausted → human fix".
- DR-063 §5 and *Follow-ups* say the same. DR-063 *Consequences* also says machinery pull
  requests are forced to `ai-review:changes`. #596 removed that: the verdict on a machinery
  pull request is now reported as it is (`ai-review.yml`, the "not masked as
  `ai-review:changes` (#596)" sentence).

## The two gaps (measured)

**G1 - the summon is suppressed for every pull request, but remediation takes only some.**
The summon step sets `REMEDIATION_AVAILABLE=true` when `${GITHUB_WORKSPACE}/scripts/remediate-pr.sh`
exists. That is a fact about the repo. Whether `remediate-pr.sh` will take a given pull
request is a fact about that pull request:

- `classify_pr` returns `skip-not-automation` for any branch outside
  `AUTOMATION_BRANCH_RE='^(agent|fix|feat)[/-]'` (`remediate-pr.sh:120`, `:151-152`), with no
  label and no comment.
- A fork pull request exits 0 at `remediate-pr.sh:515-519` ("Leaving for a human") with no
  label.

So in this repo a non-machinery `ai-review:changes` pull request on a `spec/…`, `docs/…`,
`chore/…`, `preserve/…` or fork branch is routed to nobody. That is the shape #1073 was
written to prevent (`ai-review-guard.js:1867-1873`). It is reached through the pull request's
branch instead of through the repo. `ready-to-merge` still holds such a pull request red, so
nothing merges early. The loss is liveness, not safety.

**G2 - nothing bounds how long the suppression lasts.** `remediate-pr.sh` runs only from
`drain-inbox.sh`'s `sweep_open_prs` (`drain-inbox.sh:166`, `:1099-1125`) and from the
creator session's own shepherding (`dispatch-issue.sh:1859`). No workflow runs it. Auto-drain
is opt-in and local to one machine (`.minspec/auto-drain`, `drain-inbox.sh:108-110`, `:167`).
If neither a drain nor a live creator reaches an `agent/…` pull request, it carries
`ai-review:changes` and no human signal for as long as that lasts. A pull request held by a
live claim (`skip-live-owned`, `remediate-pr.sh:159-161`) is fine: its creator is the next
actor and is working on it.

## Terms

- **Human-next state.** A pull request where no automated actor will move it forward without
  a human. This is the meaning `needs-human-review` carries today. The label's description
  already reads "A human is the next actor — auto-merge withheld".
- **Remediable pull request.** A pull request that `remediate-pr.sh`'s own scope rules would
  take: same repo as the base, branch matches `AUTOMATION_BRANCH_RE`, and not a draft.
- **Suppression window.** The time between a non-machinery `ai-review:changes` verdict whose
  summon was skipped and the first point where either remediation acts on the pull request
  or a human is summoned.

## Functional Requirements

### A. Already built - keep them (regression contract)

- **FR-1 - No summon at review time for a remediable `changes`.** A non-machinery pull request
  that is remediable (FR-4) and gets `ai-review:changes` is NOT labelled `needs-human-review`
  by `ai-review.yml`. *Built (#938) at repo granularity; FR-4 narrows it to the pull request.*
- **FR-2 - Deny by default.** If the caller cannot prove the pull request is remediable (no
  remediator present, the scope check errors or is not passed), the summon happens.
  `shouldSummonHumanReview` keeps `undefined` → summon. *Built (#1073).*
- **FR-3 - The always-summon cases stay as they are.** Machinery pull request on any verdict;
  the fail-closed backstop; the quota-retry give-up; `remediate-pr.sh`'s conflict, cap,
  escalate and quarantine. A retry-able `ai-review:blocked` never summons. *Built.*

### B. New

- **FR-4 - Decide per pull request, not per repo (closes G1).** The summon step asks whether
  remediation will take this pull request, not whether the remediation script exists. The
  pull request counts as remediable only when all hold:
  (a) `scripts/remediate-pr.sh` exists (today's check, kept);
  (b) the head branch matches the same branch pattern `remediate-pr.sh` uses;
  (c) the head repo is the base repo;
  (d) the pull request is not a draft.
  Otherwise FR-2 applies and the human is summoned at once.
  - **FR-4a - One definition of the pattern.** `AUTOMATION_BRANCH_RE` and the CI-side copy
    must not drift apart. Either both read one source, or a test fails when the two differ.
    The choice between those belongs to Plan. A copy with no test is not allowed: a drifted
    copy re-opens G1 with nothing showing it.
- **FR-5 - Put a time limit on the suppression (closes G2).** A pull request whose summon FR-1
  suppressed must not stay without `needs-human-review` past a limit unless remediation has
  visibly acted on it. *How the limit is set and enforced is OQ-2; this requirement exists
  under every option except OQ-2 (d).*
- **FR-6 - Make the docs match the code.** At Implement, the stale wording listed in
  *Context* is corrected: SPEC-031 INV-8 and FR-9c, and DR-063 §5, *Consequences* and
  *Follow-ups*. They must give the meaning this spec settles (human-next state, or the
  split chosen in OQ-1) and record #816 as built.
  SPEC-031 is past Specify, so its edit goes through that spec's own re-approval. It is not
  bundled silently.
- **FR-7 - The label's name.** Settled by OQ-1. Whatever the answer, every place that applies
  the label (listed in *Context*), every place that reads it
  (`dispatch-ready-check.sh:685`, `approve-on-label.sh:296-298`, `shepherd-pr.sh`,
  `drain-inbox.sh`) and the label-lifecycle tests end up using the same name(s) in the same
  change.

## Acceptance Criteria

- **AC-1 (FR-4)** `shouldSummonHumanReview` (or its successor) returns `true` for a
  non-machinery `ai-review:changes` pull request on each of: branch `spec/x`, branch
  `docs/x`, a fork head, a draft. It returns `false` for `agent/x`, `fix/x` and `feat/x`
  from the same repo with the remediator present. These are unit tests in
  `.github/scripts/ai-review-guard.test.js`.
- **AC-2 (FR-4a)** Change `AUTOMATION_BRANCH_RE` in `remediate-pr.sh` and leave the CI side
  alone: a test fails, or the CI side follows the change. A mutation run shows which.
- **AC-3 (FR-2)** Call the predicate without the new fields: the result is `true` (summon).
  This extends the existing deny-by-default test at `ai-review-guard.test.js:727`.
- **AC-4 (FR-3)** The existing machinery, `blocked` and backstop tests stay green and are not
  edited, except to add the new arguments.
- **AC-5 (FR-5)** Under the option chosen in OQ-2, a fixture pull request at
  `ai-review:changes` with no remediation marker and an age past the limit ends up labelled
  `needs-human-review`. The same pull request with a remediation marker newer than the limit
  does not.
- **AC-6 (FR-6)** A grep of `specs/` and `docs/decisions/` finds no sentence that describes
  the #816 retirement as future work or says machinery pull requests are forced to
  `ai-review:changes`.
- **AC-7 (FR-7)** A grep over `.github/`, `scripts/` and `packages/minspec/tests/` finds only
  the label name(s) chosen in OQ-1.
- **AC-8 (shipped copy)** `ci-stack-portability`'s byte-equality test passes: the template
  copy in `ci-review-templates.ts` matches the edited `ai-review.yml` and `ai-review-guard.js`.

## Invariants (must not break)

- **INV-1 - Merge safety never depends on this label.** `ready-to-merge` stays red on its own
  for every pull request that has not passed and every machinery pull request. Nothing in
  this spec loosens it. The label is advisory. (DR-063; constitution invariant 2.)
- **INV-2 - No pull request is routed to nobody.** Every non-passed pull request has a next
  actor: remediation that will take it, a live creator claim, a scheduled retry
  (`blocked`), or a summoned human. G1 and G2 break this today.
- **INV-3 - Fail closed and visibly.** An error while deciding remediability means summon,
  never skip. The summon calls stay best-effort only because the verdict label and
  `ready-to-merge` carry the gate. No new `|| true` may guard a signal the gate reads.
  (Constitution invariant 2.)
- **INV-4 - `awaiting-approval` and `needs-human-review` keep their separate jobs.**
  `awaiting-approval` stays the only "your keystroke approves it" signal for a green
  pull request (SPEC-031 INV-8). This spec does not apply it and does not remove it.
- **INV-5 - Blast radius.** `ai-review.yml` and `ai-review-guard.js` ship to adopter repos
  (`template-registry.ts:2385-2387`) while `remediate-pr.sh` does not. An adopter without
  the remediator must keep the eager summon, as #1073 does today. A label rename must not
  leave an adopter's existing labelled pull requests or issues invisible to their own
  gates. (Constitution invariant 3.)
- **INV-6 - Offline core.** Nothing here adds a network call to the extension. All of it
  runs in CI or in dev-time scripts. (Constitution invariant 1.)

## Decisions needed (Clarify)

### OQ-1 - Rename the label?

#816 suggests `needs-human-fix`. Since #938 the label has meant "a human is the next actor",
which covers two jobs: fixing (cap, conflict, quarantine, workflow error, quota give-up,
stranded `changes`) and approving a machinery pull request whose code verdict is `pass`.
A machinery pull request never gets `awaiting-approval`, because that label needs a green
`ready-to-merge` (`shouldAwaitApproval`, `ai-review-guard.js:1678-1682`, called at
`ready-to-merge.yml:472-477`) and a machinery pull request is red there by
design. So `needs-human-fix` would be wrong for machinery-pass pull requests.

- **(a) Keep `needs-human-review`; its meaning is "a human is the next actor" - (rec).**
  Only docs change (FR-6). The queue filter `awaiting-approval` OR `needs-human-review`
  shows every pull request waiting on you, and none that robots are fixing. Cost: the
  label alone does not say whether you are being asked to fix or to approve. You have to
  look at `machinery-review-required` or the verdict label to tell.
- **(b) Split it: `needs-human-fix` for the fixing jobs, and machinery-pass gets
  `awaiting-approval`.** This changes SPEC-031's predicate for machinery pull requests.
  Cost: about fifteen scripts and fourteen test files change together. Adopter repos keep
  open pull requests and issues under the old name, which their updated gates would no
  longer read, so a migration step is needed (INV-5). The issue-side readers
  (`dispatch-ready-check.sh`) need their own decision. It also needs a DR.
- **(c) Rename wholesale to `needs-human-fix` and change nothing else.** Same cost as (b),
  and the name is wrong for machinery-pass pull requests. Not recommended.

### OQ-2 - How long may a suppressed summon last (FR-5)?

- **(a) Add a staleness sweep to the existing hourly `ai-review-retry.yml` schedule - (rec).**
  It already runs on `cron: '17 * * * *'` and already applies `needs-human-review`. It would
  summon any non-machinery `ai-review:changes` pull request older than N hours (proposed
  N = 24) that has no `remediate-pr.sh` attempt marker newer than N and no live claim.
  Cost: it edits a workflow that ships to adopters (machinery, so a human `--admin` merge).
  It also needs the attempt marker and the claim to be readable from CI. Plan must check
  that before relying on it, and if they are not readable it falls back to age alone.
- **(b) Have the drain do it.** `sweep_open_prs` summons when it finds an old suppressed pull
  request. Cost: it does nothing while no drain runs, which is exactly the G2 case.
- **(c) Put the eager summon back for every non-machinery `changes`, and let remediation
  remove the label when it starts work.** Cost: brings back the queue pollution #816 was
  filed to remove, for the time before a drain runs.
- **(d) Accept the gap: a creator session shepherds its own pull request.** Cost: a pull
  request whose creator session died and that no drain reaches stays unlabelled for an
  unknown time. That is the case INV-2 forbids.

## Costly to Refactor

**No, except OQ-1 (b) or (c).** FR-4 and FR-5 are one pure predicate, a few lines in one
workflow step and a staleness check. Reverting them takes less than a day. A label rename
is the exception: adopter repos would carry open items under both names, and undoing it
means a second migration. If the founder picks (b) or (c), Plan records a DR first
(the rule that any choice which cannot be undone in under a day needs a decision record).

## Alternatives considered and rejected

- **Make `remediate-pr.sh` label every pull request it skips as out of scope.** Rejected: it
  only runs when a drain runs (G2), so the label would still be missing in the case that
  matters. Deciding in CI at review time is the one place that always runs.
- **Widen `AUTOMATION_BRANCH_RE` to cover every branch.** Rejected: that pattern keeps the
  drain to "automation-branch prefixes this sweep is allowed to touch" and off human
  branches (`remediate-pr.sh:115-120`). Widening it would let an
  agent push to a person's branch.
- **Re-open the whole eager behaviour (undo #938).** Rejected: this is OQ-2 (c). It brings
  back the pollution #816 removed to fix a gap that FR-4 and FR-5 close more narrowly.

## Out of scope

- The `ai-review:unreadable` label's consumer. That is SPEC-065 OQ-12, which already plans
  to route it through `shouldSummonHumanReview`. FR-4 must not block it.
- `awaiting-approval` on doc approvables (SPEC-031 FR-9b, #527).
- The funnel that merges pull requests in this repo (SPEC-044 FR-4b).

## Test plan (for Plan to place)

- Pure-predicate unit tests for AC-1 to AC-4 in `ai-review-guard.test.js`.
- A parity test for FR-4a, placed beside the existing `remediate-pr-classify.test.ts`.
- A fixture-driven test for the OQ-2 sweep (AC-5). The age and marker must vary across the
  limit, not sit at a single point.
- The label-name grep (AC-7) as a test rather than a one-off. Otherwise a later script
  could bring the old name back.

## Traceability

- **Issue:** #816 (this spec). Built portions: #938, #1073.
- **Specs:** SPEC-031 (INV-8, FR-9c, the additive half), SPEC-062 (autonomous PR drain, the
  remediation caller), SPEC-065 OQ-12 (`unreadable` routing), SPEC-044 FR-6 (live-claim
  owner gate).
- **Decisions:** DR-063 (`awaiting-approval`), DR-060 / DR-061 (pipeline and remediation
  loop).
- **Specimen:** PR #782 (machinery pull request carrying the eager label).
