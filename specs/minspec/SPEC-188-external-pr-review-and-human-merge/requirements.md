---
id: SPEC-188
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - who may land code in a public repo, and what they must pass first
aspects: [ai-review, external-contributor, fork-pr, pull-request, auto-merge, hitl, github-actions, prompt-injection, supply-chain, no-silent-gate, blast-radius]
depends_on: [SPEC-024, SPEC-062]  # SPEC-024 owns the auto-merge eligibility decision this spec must exclude external PRs from; SPEC-062 owns the drain that merges green PRs unattended
relates_to: [SPEC-031, SPEC-045, SPEC-065, SPEC-069, SPEC-078, DR-027, DR-029, DR-054, DR-072, DR-076, DR-104, "#543", "#1688", "#1870"]
# Ownership declared in Specify (SPEC-038). Both files are NEW. Plan may rename them; it
# may not drop the separation between the classifier (pure, testable) and the workflow
# (credentialed, thin).
implements: [.github/workflows/external-pr-intake.yml, .github/scripts/external-pr.js]
affects: [.github/workflows/ai-review.yml, .github/workflows/ready-to-merge.yml, .github/scripts/ai-review-guard.js, .github/workflows/docs-lane.yml, scripts/roles/security.md, scripts/auto-merge-gate.ts, scripts/drain-inbox.sh]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec - Full adversarial review and founder-only merge for external pull requests (Requirements)

> **This is a SPECIFICATION ONLY.** Nothing in `.github/`, `scripts/` or `packages/` is
> changed by the dispatch that wrote it. The founder reads it, answers
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it before any of it
> is built.

**Issue:** #543 (feat: full adversarial-panel ai-review + human-merge assignment for external PRs)
**Epic:** [EPIC-006 Trust, Consent & Supply Chain](../../../docs/epics/EPIC-006-trust-and-supply-chain.md)

## In plain terms

The repo is public (DR-027, which keeps the MinSpec monorepo public), so anyone can open a
pull request. Today such a pull request, opened from a fork, gets **no AI review at all**:
the reviewer workflow skips itself because GitHub withholds secrets from fork runs. Nothing
lands it either, because the merge gate stays red without a review. So the PR just sits
there, unreviewed and unassigned, and nobody is told it exists.

This spec makes three things happen to every pull request from someone outside the trusted
list:

1. It is **recognised as external**, by two independent checks, and when in doubt it is
   treated as external.
2. It gets the **full adversarial panel**: all four voters, every round, with an extra
   brief for threats specific to outsiders. Nothing can turn that down: not the repo's
   coverage dial, not a docs-only diff, not a carried verdict.
3. It is **assigned to the founder**, and **no automation can merge it**, whatever the
   panel says. Only the founder lands it.

## Why now, given the issue said to wait

The issue was parked "until scrooge v1 is shipped, to economise token spend". ScroogeLLM
has since been shelved as a product (scrooge DR-021, accepted 2026-08-01, per this repo's
CLAUDE.md), so that condition will never be met as written. The triage gate dispatched the
Specify phase anyway. Writing the spec costs one agent run. The spend the founder was
guarding against is the **review runs** on external PRs, and FR-6 and decision D2 keep
that spend under the founder's control. Whether to *build* it now is still his call, made
when he approves the spec.

## Context - measured on main at 5f792386 (2026-10-16)

| Fact | Where |
|---|---|
| `ai-review-runner` triggers on `pull_request` only, not `pull_request_target`. | `.github/workflows/ai-review.yml:177-179`, rationale at `:55-58` |
| A fork PR gets empty secrets, so the guard step emits a NOTICE ("this is NOT a failure") and every later step is skipped. **No voter runs, no label and no comment are written.** | `.github/workflows/ai-review.yml:196-214` |
| On a fork PR `ready-to-merge` cannot post green either: the built-in token is read-only. | `.github/workflows/ready-to-merge.yml:82-84` |
| The coverage dial defaults to `panel` (reviewer, security, architect, skeptic), but the repo variable `AI_REVIEW_COVERAGE=single` reduces it to one voter. | `.github/workflows/ai-review.yml:473-479` |
| The security voter runs only when code changed. Architect and skeptic run only under `panel`. | `.github/workflows/ai-review.yml:762` |
| A pass can be **carried** across a push without any voter running (#1688, DR-104 "a pass is carried across a push that changes nothing the voters are given"). | `.github/workflows/ai-review.yml:96-128` |
| A `hold:*` label keeps `ready-to-merge` red. It is anchored `^hold:`, and docs-lane keys off the same pattern (#1870, DR-072 "the human-approval exit from a triage hold"). | `.github/scripts/ai-review-guard.js:1575-1586` |
| Unattended merge paths: docs-lane arms `gh pr merge --auto` for a PR labelled `docs-lane`; the dispatcher's `auto-merge-gate.ts` handles agent branches; the drain merges any PR with green `ready-to-merge` and no `needs-human-review` (SPEC-062 FR-2). | `.github/workflows/docs-lane.yml:296`, `scripts/auto-merge-gate.ts`, `specs/minspec/SPEC-062-autonomous-pr-drain/requirements.md:136-143` |
| Trusted identity is decided by **account kind and number**, never by login, collaborator status or write access. The current list is `Bot:299695933` (the `minspec-sdd` App) and `User:4125483` (`harvest316`). | `scripts/lib/dispatch-author-gate.sh:46-66` |

**The consequence.** Nothing can auto-merge an external PR today, but only by accident.
The reviewer is missing, so the gate has no witness and stays red. Once this spec gives
external PRs a review, a clean panel posts a pass witness, `ready-to-merge` goes green, and
the drain (SPEC-062 FR-2) would merge the PR unattended. **FR-4 must therefore land with or
before FR-3.** Building only the review half would open a hole that does not exist today.

## One-Sentence Scope

Recognise every pull request whose opener is not on the trusted-identity list, or whose
head is in another repository. Give each one the full four-voter panel plus an
outsider-threat brief on every round. Assign it to the founder. Make every unattended
merge path refuse it, enforced by two independent witnesses.

## Terms

- **Trusted identity list.** The `<kind>:<databaseId>` list in
  `scripts/lib/dispatch-author-gate.sh`. This spec **reuses** that list. It does not start a
  second one (see INV-5).
- **Internal PR.** A PR whose head repository is the base repository **and** whose opener
  is on the trusted identity list.
- **External PR.** Every other PR, including any PR whose classification could not be
  computed.
- **Full panel.** The reviewer, security, architect and skeptic voters, all run fresh on the
  current head commit.

## Functional Requirements

### A. Classification

- **FR-1 (classify every PR, fail toward external).** On every `opened`, `reopened`,
  `synchronize` and `ready_for_review` event, the PR is classified as internal or external
  by a pure function in `.github/scripts/external-pr.js`. It takes three inputs: the head
  repository id, the base repository id, and the opener's `__typename` and `databaseId`.
  A PR is internal only if both conditions in *Terms* hold. A missing, malformed or errored
  input makes it **external**.
  - Fork **or** untrusted opener is enough to make a PR external. The founder opening a PR
    from a fork is still external under this rule, and D4 asks whether that is wanted.
  - An App or bot not on the list (for example a future Dependabot or Renovate) is external.
  - `author_association` (`CONTRIBUTOR`, `COLLABORATOR`, ...) is **not** an input. It is
    granted, and changes, for unrelated reasons. `dispatch-author-gate.sh:46-50` rejects
    "is a collaborator" for the same reason.
- **FR-2 (visible marker).** An external PR carries a label `external-pr`, written by the
  `minspec-sdd` App. Its first classification also gets one comment explaining what happens
  next: a full review, a founder merge, and no auto-merge. If the label write fails, the
  intake check fails visibly. It is never `|| true` (constitution invariant 2).

### B. Review

- **FR-3 (full panel on every round of an external PR).** For an external PR, the reviewer
  workflow MUST:
  - (a) run all four voters, whatever `AI_REVIEW_COVERAGE` says. Reduced coverage is not
    allowed for this class;
  - (b) run the security voter even when the diff is docs or prose only (see FR-5 for why);
  - (c) **never carry a verdict** (DR-104 / #1688). Every round runs the voters on the
    current head;
  - (d) say in the posted verdict comment that this was an external-PR full-panel round.
    The existing coverage-disclosure line (`ai-review.yml:957-991`) is where this goes.
- **FR-4 (fork PRs can actually be reviewed).** A fork PR must reach the review in FR-3,
  rather than the current silent skip. The mechanism is decision **D1**. Whichever option
  is chosen MUST keep the properties `ai-review.yml` already holds:
  - the reviewer scripts and roles come from the **base** commit;
  - head content is seen only as diff data and is never checked out or executed;
  - the review agent holds no tool that can use a credential;
  - the verdict text is redacted before it is posted.
- **FR-5 (outsider-threat brief).** For external PRs the security voter is given a
  supplementary brief, added in `scripts/roles/security.md` or a sibling file chosen in
  Plan. The brief covers:
  - obfuscated or encoded payloads;
  - new or changed dependencies and lockfile entries (typosquats, install scripts);
  - CI and workflow edits, and changes to the review machinery itself;
  - **prompt injection planted in prose that agents later read**: `CLAUDE.md`,
    `scripts/roles/**`, specs, DRs, issue templates and the constitution. A docs-only
    external PR is still an attack on the agent fleet. This is why FR-3(b) runs the
    security voter on prose;
  - secrets or high-entropy strings;
  - changes to the trusted identity list or to the classifier in this spec.

  This brief is **in addition to** the existing security voter's checks and never replaces
  them.
- **FR-6 (spend is bounded and visible).** A review round on an external PR costs Opus
  tokens on the founder's subscription. That PR is under the control of a stranger, who can
  push as often as they like. When a round is triggered is decision **D2**. Whichever is
  chosen, the PR MUST show which state it is in: "awaiting review trigger", "under review"
  or "reviewed at <sha>". It MUST never show nothing (constitution invariant 2: no silent
  skip).

### C. Assignment and merge

- **FR-7 (assign to the founder).** An external PR is assigned to `User:4125483`, resolved
  by id and not hard-coded by login. A review request to the same account is added where
  GitHub allows it. If the assignment fails, the intake check goes red and names the
  failure.
- **FR-8 (no unattended merge, by two independent witnesses).** An external PR MUST NOT be
  merged by any automation, whatever its `ai-review` verdict. Two independent witnesses
  enforce this:
  - **Witness 1 (intake).** The intake workflow applies `hold:external` and
    `needs-human-review`. Through the existing `HOLD_RE` path this alone makes
    `ready-to-merge` red, stops docs-lane arming, and makes the drain (SPEC-062 FR-2) skip
    the PR.
  - **Witness 2 (gate).** `ready-to-merge`'s guard recomputes the classification itself,
    with the same pure function, from the event payload. It does not read the label. For an
    external PR it stays red unless the merge exit in D3 is satisfied.

  A label removed by someone with write access therefore lifts nothing: Witness 2 does not
  read labels.
- **FR-9 (every unattended path excludes the class).** `auto-merge-gate.ts` (SPEC-024),
  the drain (SPEC-062) and docs-lane each refuse an external PR. Each one checks the class
  directly, and none relies only on the other two. If any of them already disarms on red
  `ready-to-merge` and that covers the case, Plan records the citation instead of adding
  code.
- **FR-10 (the merge exit).** How the founder lands a reviewed external PR is decision
  **D3**. Whatever the answer, the exit MUST be bound to the head SHA: a push after the
  founder's act voids it. It MUST also be performable only by `User:4125483`, and never by
  the App or an agent token (memory rule: no borrowed-identity approval).

### D. Boundaries

- **FR-11 (internal PRs unchanged).** For an internal PR, every behaviour of
  `ai-review.yml`, `ready-to-merge.yml`, docs-lane, the drain and the dispatcher is
  byte-for-byte what it is today. This includes coverage dial, carry, and auto-merge
  eligibility.
- **FR-12 (this repo only).** The new workflow and the guard change apply to this
  repository's own `.github/` files. If any of them is also a template that MinSpec
  scaffolds into adopters, the external-PR behaviour MUST be opt-in there (constitution
  invariant 3). Plan checks the template registry and states the answer, with `file:line`.

## Acceptance Criteria

- **AC-1 (FR-1).** Unit tests of the pure classifier cover each case and give the expected
  class:

  | Case | Expected |
  |---|---|
  | Same-repo PR, `User:4125483` | internal |
  | Same-repo PR, `Bot:299695933` | internal |
  | Fork PR, unlisted user | external |
  | Fork PR, `User:4125483` | external, unless D4 says otherwise |
  | Same-repo PR, unlisted user with write access | external |
  | Unlisted App | external |
  | Missing head repo (deleted fork) | external |
  | Payload missing `databaseId` | external |
  | Matching login, different id (rename/squat) | external |

- **AC-2 (FR-3).** On an external PR with `AI_REVIEW_COVERAGE=single` set and a docs-only
  diff, the posted round shows all four voters ran, and the comment names the external
  full-panel mode. A second push of an unchanged tree runs the voters again, and the
  carried label does not appear.
- **AC-3 (FR-4).** A real fork PR, opened from a throwaway account, receives a verdict
  comment from `minspec-sdd[bot]`. The run log shows that no head file was checked out into
  the workspace. A planted `.github/workflows/*.yml` or `scripts/review-decide.sh` edit in
  that fork PR does not change what executed.
- **AC-4 (FR-8, FR-9: both witnesses).** On an external PR with a genuine `ai-review:pass`:
  - (i) `ready-to-merge` is red;
  - (ii) removing `hold:external` by hand leaves it red;
  - (iii) adding `docs-lane` does not arm auto-merge;
  - (iv) a drain pass leaves it open;
  - (v) `auto-merge-gate.ts` reports not eligible.

  Each point is shown with a **control**: the same steps on an internal PR do merge or arm.
  Without the control, a red result proves nothing.
- **AC-5 (FR-7).** The founder is the PR's assignee after intake. With the App's
  `issues: write` permission revoked in a test repo, the intake check is red and names the
  failed write.
- **AC-6 (FR-10).** After the founder's D3 act on head A, pushing head B makes the exit
  unsatisfied again. The same act performed by the App identity does not satisfy it.
- **AC-7 (FR-11).** On an internal PR, the posted verdict, the labels and the
  `ready-to-merge` result are identical before and after this change. This is checked
  against a recorded internal PR run.
- **AC-8 (FR-6).** An external PR waiting on a trigger shows the "awaiting review trigger"
  state on the PR itself, not only in an Actions log notice.

## Invariants (must not break)

- **INV-1 (constitution 2: no silent gate).** Every step that writes a classification,
  label, assignment or hold fails visibly on error. An uncomputable class means external.
  FR-8 has two witnesses so that no single permission gap disables the hold.
- **INV-2 (constitution 3: blast radius).** No behaviour changes in an adopter repo that
  did not opt in (FR-12).
- **INV-3 (constitution 1: offline).** The extension makes no new network call. Everything
  here runs in GitHub Actions.
- **INV-4 (untrusted code never runs with a credential).** No head-side file is executed or
  sourced in any job that holds a secret or a write-scoped token. This holds whatever D1
  decides.
- **INV-5 (one trusted list).** The classifier reads the same `<kind>:<id>` list as
  `dispatch-author-gate.sh`. A second list drifts from the first. If the shell list cannot
  be read from JavaScript, Plan extracts it to one data file that both read.
- **INV-6 (founder-only landing).** No App, bot or agent token can satisfy FR-10.
- **INV-7 (internal path untouched).** FR-11.

## Decisions needed (Clarify)

### D1 - How does a fork PR get reviewed, given that `pull_request` withholds secrets?

- **(a) `pull_request_target`, base checkout only (rec).** The job runs the **base**
  workflow, which also closes the self-edit residual `ai-review.yml:30-35` describes. It
  fetches the head only as git objects for `git diff`, as it does today. Cost: this trigger
  hands secrets to a job started by a stranger. It is the well-known exfiltration shape
  `ai-review.yml:55` warns against, and it is safe only while no step ever checks out or
  runs head content. One careless future edit (`actions/checkout` with `ref: head`) turns
  it into a credential leak. It therefore needs its own guard: a lint that fails CI if any
  `pull_request_target` job checks out the head ref.
- **(b) Two stages with `workflow_run`.** The unprivileged `pull_request` run uploads the
  diff as an artifact, and a privileged `workflow_run` job reviews it. Cost: more moving
  parts. The artifact itself is attacker-controlled input to a privileged job, and
  `workflow_run` runs report against the default branch, not the PR, so the verdict has to
  be re-bound to the head SHA by hand.
- **(c) No CI review for forks; the founder runs `scripts/review-branch.sh` locally.**
  Cost: no secret is ever exposed to a fork run, but the review depends on the founder
  remembering to run it, and the verdict has no bot provenance. `ready-to-merge` cannot
  verify it.

A DR is warranted only if (a) or (b) is chosen and the choice is judged hard to undo. A
workflow trigger can be reverted in under a day, so this spec does not mint one (the
ADR filter from the parent mmo-platform register: record only choices that take more than
a day to undo).

### D2 - When does a review round run on an external PR (spend control)?

- **(a) Only when a maintainer applies a `review:external` label; each label buys one round
  on that head, and the label is removed when the round starts (rec).** Cost: every round
  needs a founder or session action, so an outside contributor waits on him. Under
  autonomy=act, sessions could apply the label. Plan must decide whether they may, since
  letting them reopens the spend question.
- **(b) Automatically on every push.** Cost: a stranger can trigger unbounded Opus spend by
  pushing repeatedly, which is exactly what the issue's deferral was guarding against.
- **(c) Automatically on the first round, then label-gated.** Cost: one free round per PR,
  so a stranger can still spend by opening many PRs.

GitHub's own "require approval for workflows from outside collaborators" setting is a
related lever. Its current value on this repo is **unverified**: it is a repository
setting that cannot be seen from a checkout. Plan reads it.

### D3 - What lets the founder land a reviewed external PR?

- **(a) A GitHub "Approve" review from `User:4125483`, submitted after the current head
  commit, turns `ready-to-merge` green for that head. The founder then clicks merge himself
  (rec).** No `--admin` is needed, and the gate stays meaningful. Cost: once the gate is
  green, an unattended path could merge in the window between his approval and his click.
  FR-9 must therefore exclude the class *independently* of `ready-to-merge`, not merely
  through it.
- **(b) `ready-to-merge` stays red forever for external PRs; the founder merges with
  `--admin`.** Cost: `--admin` also skips every *other* required check. A red build or test
  on the external PR would be bypassed in the same keystroke, which is the opposite of
  "full review".

### D4 - Is a fork PR opened by the founder himself external?

- **(a) Yes: fork means external, whoever opened it (rec).** Simplest rule, and a fork can
  carry commits from others. Cost: the founder pays a full panel and a manual merge on his
  own fork PRs, which should be rare because he works on branches.
- **(b) No: only the opener counts.** Cost: commits pulled into the founder's fork from an
  outside source are reviewed on the internal, auto-mergeable path.

## Out of Scope

- Changing who is on the trusted identity list.
- Contributor-facing documentation (CONTRIBUTING.md, issue/PR templates). Plan files a
  separate issue if one is wanted.
- External **issues**. `dispatch-author-gate.sh` already keeps them from starting agents.
- Rate-limiting or blocking spammy accounts at the GitHub level.

## Risks

- **R-1.** D1(a) is a standing credential-exposure shape, so its safety rests on a lint
  (see D1).
- **R-2.** The outsider-threat brief (FR-5) is itself prose read by a model, so a
  sufficiently crafted injection can still sway a voter. FR-10's human merge is the backstop
  that does not depend on the model.
- **R-3.** Residual (stated, not closed): a same-repo push by an account the founder later
  grants write access to, onto an internal PR's branch, keeps that PR internal, because
  classification uses the opener and not every pusher. Closing this needs push-actor
  auditing, which belongs to a separate issue if the founder wants it.

## Traceability

- Issue: #543. Related machinery: #1688 / DR-104 (verdict carry), #1870 / DR-072 (`hold:*`
  gating), DR-054 (one shared reviewer App), DR-029 (untrusted prose reaching a model),
  SPEC-024 (auto-merge eligibility), SPEC-062 (drain).
