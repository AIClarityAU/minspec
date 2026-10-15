---
id: SPEC-137
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - the merge gate's provenance story is this epic's domain
aspects: [governance, hitl, branch-protection, ai-review, ready-to-merge, provenance, machinery, no-silent-gate]
relates_to: [SPEC-065, SPEC-024, SPEC-038, SPEC-051, DR-033, DR-047, DR-054, DR-056, DR-066, DR-072, DR-076, "#509", "#458", "#425", "#397", "#452", "#466", "#810", "#1870", "#2056"]
# Ownership is NOT finalised here, on purpose. Which files this spec creates depends on
# DQ-1 (which witness carries the human's approval) and DQ-3 (where it is evaluated), and
# SPEC-051 forbids adding `implements:` after approval because that stales the hash. So the
# rule is the SPEC-065 DQ-4 rule: the Clarify edit that answers DQ-1/DQ-3 MUST replace this
# block with the concrete list, in the same edit, before the founder approves.
implements: none
implements_reason: Specify-phase draft. The owned files depend on DQ-1 and DQ-3 (Clarify); the answering edit must declare them before approval (SPEC-051). See "Ownership by outcome" below.
affects: [.github/workflows/ready-to-merge.yml, .github/scripts/ai-review-guard.js]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: A scoped human merge path for machinery pull requests

Tracking issue: #509 (harden: give machinery PRs a scoped merge path, not `--admin`).

## One-Sentence Scope

Give a pull request that touches the review machinery (`.github/**`, `scripts/**`) a way to
reach a green `ready-to-merge` on a **verified, commit-bound human approval**, so it merges
without `gh pr merge --admin` and so every other required check (`lint`, `test`, `build`,
`MinSpec SDD validation`) still has to pass.

## Context

### The block

`ready-to-merge` is a required check on `main`. It goes green only on a *verified*
`ai-review:pass` (`.github/workflows/ready-to-merge.yml:1-17`). A machinery pull request can
never get one:

- the reviewer marks every machinery PR as exempt and never certifies it:
  `decideReviewCheck` returns `neutral` for `isMachineryPr` (`.github/scripts/ai-review-guard.js:1761-1777`),
  and that check's own summary text says "a human must still review and approve it before
  merging";
- a human who applies `ai-review:pass` by hand has it reverted, because only the
  allowlisted reviewer identity `minspec-sdd[bot]` may apply it (#397, #425;
  `verifyPassProvenance`, `ai-review-guard.js:1369`).

So `ready-to-merge` stays red, and the only way to merge is `--admin`. `--admin` skips
**every** required check, not just the one that is red. A routine change to a workflow can
therefore land with `test` or `build` red and nothing stops it.

### How this relates to SPEC-065 (solo mode)

SPEC-065 FR-2 names #509 as its tracking issue and gives machinery PRs an **unattended**
path: a `workflow_run` witness, read from the default branch, that certifies a machinery PR
when the review ran on code identical to the base (SPEC-065 design §2-3). The founder chose
that design in SPEC-065 DQ-2 (2026-08-21). This spec does **not** reopen it.

SPEC-065 still leaves several classes on `--admin`, by design:

1. **The witness self set.** A PR that changes the witness mechanism itself "must still stop
   for a human" (SPEC-065 DQ-2 residual). Its design gives that stop no path other than
   `--admin`.
2. **`mode: team`.** SPEC-065's witness posts nothing under `team`
   (SPEC-065 design AC-3 row), so under `team` every machinery PR is back on `--admin`.
3. **Paths outside `.github/**` and `scripts/**`.** SPEC-065 OQ-15's recommended option
   keeps `.githooks/`, the template generators and the other broad-set paths on `--admin`.
4. **The first release.** SPEC-065 OQ-4's candidate first release certifies nothing until
   the self set has a maintainer.
5. **Until SPEC-065 ships.** It is at Plan, with several founder decisions open. Every
   machinery PR uses `--admin` today.

In all five cases a human reads the diff and then has no way to say "I approved this
commit" that the gate accepts, so they bypass the gate entirely. This spec gives that human
a way to do it. It is the human half of #509. SPEC-065 FR-2 is the unattended half.
**DQ-5** asks whether this belongs in its own spec or inside SPEC-065.

### Threat model: what a machinery PR can already do (measured from the tree, not runtime)

This shapes every requirement below, so it is stated first.

- **The PR's own workflows run with repository secrets.** `ai-review.yml` and
  `ready-to-merge.yml` trigger on `pull_request` (`ready-to-merge.yml:88-96`), so GitHub
  takes the workflow **file** from the PR head, even though `ready-to-merge` pins its
  *checkout* to the base (`ready-to-merge.yml:66-77`). The reviewer App's credentials are
  plain repository secrets (`MINSPEC_APP_ID`, `MINSPEC_APP_PRIVATE_KEY`, read at
  `ai-review.yml:208-209`). A same-repo branch's `pull_request` workflows can read those.
  So a machinery PR can add or edit a workflow that acts as `minspec-sdd[bot]`, or as
  `github-actions`, and post any status, check run or label those identities can post.
- **So a check or status written during the PR's own CI cannot be the trust anchor for a
  machinery PR.** That is true of today's `ready-to-merge` too. I believe, without having
  tested it at runtime, that a machinery PR which edits `ready-to-merge.yml` can post its own
  green `ready-to-merge` status. That status is bound to integration 15368 (GitHub Actions,
  SPEC-065 DQ-1 witness), and a head-sourced workflow's `GITHUB_TOKEN` is also that
  integration. The founder's `--admin` habit currently hides this, because nobody relies on
  that status for machinery PRs. **A human-approval path changes that: once it exists, a
  green `ready-to-merge` on a machinery PR means something.** That is why FR-4 exists.
- **What the PR head cannot forge:** GitHub's own record of *which authenticated user* did
  something. That covers the `actor` on a `labeled` issue event, and the `user` and
  `commit_id` on a pull-request review. A human's login can be forged only by someone
  holding that human's token, and the dispatch container holds none (session identity
  check: "no GitHub user credential reachable").

The trust anchor for this spec is therefore **a GitHub-recorded act by an allowlisted human,
bound to the exact head commit, evaluated by code the PR cannot have edited.**

## Functional Requirements

- **FR-1 (a human approval satisfies the review half of the gate, for machinery PRs only).**
  `ready-to-merge` MUST accept a *verified human machinery approval* (FR-2) in place of a
  verified `ai-review:pass` **only** when the PR is a machinery PR under the same classifier
  the reviewer uses. One definition of "machinery" MUST be shared by the reviewer and the
  gate. The two copies drifting apart is the #1758 class SPEC-065 already records. For a
  non-machinery PR, a human approval MUST NOT turn `ready-to-merge` green. *Rationale: the
  issue's scope is "for `.github/`/`scripts/`-touching PRs only". Outside that scope a human
  approval would be a second, weaker road around the AI reviewer that DR-033 and DR-047 make
  the gate.*

- **FR-2 (what counts as a verified human machinery approval).** An approval verifies only
  when ALL of these hold, each checked by the gate at decision time against GitHub's
  record, never against the presence of a label:
  1. **Identity.** The approver's login is on a dedicated **human approver allowlist**. This
     list is separate from `AI_REVIEW_BOT_LOGINS` and contains no bot or App login. A human
     login on the bot list, or a bot login on the human list, MUST make the gate fail closed
     with a message that names the misconfiguration (`ready-to-merge.yml:52-55` already
     warns why the two must never mix).
  2. **Commit binding.** The approval is bound to the **exact current head SHA**, by a field
     GitHub records, and not by comparing timestamps. `verifyPassProvenance` uses a
     timestamp comparison and itself says "a committer can backdate" the head commit date
     (`ai-review-guard.js:1365-1368`). That gap must not be copied into a path that only a
     human uses.
  3. **Not the author's own approval.** The approver is not the account that authored the
     PR's head commits or opened the PR. *Rationale: a self-approved machinery change is the
     self-certification the #458 guard exists to prevent, moved from the bot to a person.*
  4. **Not revoked.** No later act by an allowlisted approver withdraws it (a removed label,
     a dismissed review, or a `changes requested`).
  5. **Not held.** No `hold:*` label is present. This keeps #1870 / DR-072 §3 unchanged.

- **FR-3 (all other required checks still apply).** The human approval satisfies the
  review requirement only. `lint`, `test`, `build`, `MinSpec SDD validation`, and the
  `ai-review` check itself (which stays `neutral` for machinery) MUST still be green,
  enforced by branch protection exactly as today. No part of this path may use
  `--admin`, a ruleset bypass actor, or a change to the required-check set. *Rationale: this
  is the whole point of #509. A path that skips `test` is `--admin` with a different
  name.*

- **FR-4 (the evaluator cannot be the thing under review).** The code that decides FR-2 MUST
  come from a source the PR head cannot change. That means either a workflow GitHub always
  takes from the default branch (`workflow_run`, the trust root SPEC-065 design §2 uses), or
  an equivalent DQ-3 chooses. The green status it writes MUST come from an identity, or
  through a channel, that a head-sourced `pull_request` workflow cannot use, given the
  threat model above. If the evaluator cannot establish this, it MUST fail closed.
  *Rationale: without this, FR-1 adds a green signal to a gate a machinery PR can already
  forge for itself, and a human who sees green would trust it more than they should.*

- **FR-5 (the human reviews the gate change too, and that is the point).** A machinery PR
  that edits the gate, the evaluator, or the approver allowlist MAY merge on this path,
  because a human reviewed it. But the approval MUST be bound to the head SHA (FR-2.2), so a
  push after the approval voids it. The PR can never approve *itself*: the #458 self-edit
  guard stays exactly as it is, the bot still cannot certify a machinery PR, and no
  automated actor is added to the human allowlist. *Rationale: the issue says "Keep the
  self-edit guard (a PR editing the gate still can't self-auto-approve)."*

- **FR-6 (failure is visible and machine-distinguishable).** Each FR-2 failure MUST produce
  a `ready-to-merge` failure whose description names the condition that failed:
  not-allowlisted, stale-SHA, self-approval, revoked, held, or allowlist-unset or
  misconfigured. This follows the existing `decideStatus` reason pattern. An unset human
  allowlist MUST mean "no human approval ever verifies", never "any approval verifies".
  Errors reading the timeline or reviews MUST fail closed, never get swallowed
  (constitution invariant 2).

- **FR-7 (it works under both profiles).** The path MUST work under `mode: team` and
  `mode: solo` (SPEC-065 FR-1). Under `solo` it covers SPEC-065's residual classes (Context
  items 1, 3, 4 and 5). Under `team` it is the normal machinery path. It MUST NOT depend on
  SPEC-065 having shipped.

- **FR-8 (`--admin` stays, as break-glass only).** `--admin` is not removed. It is recorded
  as the break-glass path for a gate that is itself broken, and is no longer the routine
  path for machinery. Documentation that currently tells a reader to `--admin` a machinery
  PR MUST be updated to name this path first. *Rationale: removing the human's last
  resort is irreversible in practice. If the gate wedges, nothing else lands the fix.*

## Acceptance Criteria

Each criterion is red-then-green and is asserted by **executing** the decision function or
workflow logic, not by grepping source text (memory: tests can pass vacuously).

- **AC-1 (FR-1, FR-3).** A machinery PR with a verified human approval on its head SHA, and
  every other required check green, gets `ready-to-merge` = success and merges **without
  `--admin`**. Observed once at T2 on a real machinery PR after landing. The decision is
  pinned at T0.
- **AC-2 (FR-1, negative).** The same approval on a **non-machinery** PR leaves
  `ready-to-merge` exactly as the AI-review path alone would set it.
- **AC-3 (FR-3, negative).** A machinery PR with a verified human approval but a red
  `test` cannot be merged without `--admin`. This shows the human path does not widen what
  `--admin` skips.
- **AC-4 (FR-2.1).** An approval by a login not on the human allowlist does not verify. An
  approval by `minspec-sdd[bot]` does not verify. An unset allowlist verifies nothing. A
  login that appears on both lists fails closed with the misconfiguration reason.
- **AC-5 (FR-2.2, FR-5).** Approve at SHA *A*, push *B*: the gate is red at *B* with
  reason stale-SHA. This holds even when *B*'s committer date is set **earlier** than the
  approval (the backdating case the timestamp check misses).
- **AC-6 (FR-2.3).** An allowlisted human approving a PR they authored does not verify.
- **AC-7 (FR-2.4, FR-2.5).** Approve, then revoke: red with reason revoked. Approve, then
  add `hold:x`: red with reason held.
- **AC-8 (FR-4).** A machinery PR that edits the evaluator so it always returns success,
  and has no human approval, is **not** green. This is shown by running the default-branch
  evaluator against that PR. If DQ-3 chooses a design where this cannot be asserted at T0,
  the Plan must say so and name the T2 observation instead. It must not claim this
  criterion is covered.
- **AC-9 (FR-6).** Each FR-2 failure reason shows up in the status description. A simulated
  API error on the timeline or reviews read produces a failure, not a skip.

## Invariants

- **INV-1 (constitution 2, no silent gate).** Every load-bearing read fails closed and
  visibly. No `|| true` on a gate signal. A missing witness is red.
- **INV-2 (constitution 3, blast radius).** This changes **this repo's** gate. If any part
  ships into the templates MinSpec scaffolds (`ready-to-merge.yml` is a template, see
  `template-registry.ts`), it MUST be inert in a repo whose human allowlist is unset. That
  repo's behaviour today, all-red for machinery, must not change without opt-in.
- **INV-3 (no borrowed identity, DR-056).** No agent, App or workflow may apply,
  impersonate or mint the human approval. The approval is a human act or it is nothing.
- **INV-4 (#458 self-edit guard).** The reviewer's machinery self-exemption and its refusal
  to certify machinery PRs are unchanged.
- **INV-5 (#397 bot-only pass).** `ai-review:pass` stays bot-only. This spec adds a
  **different** signal and does not widen who may apply the existing one.
- **INV-6 (required set unchanged).** The six required checks and their `integration_id`
  bindings (SPEC-065 DQ-1 witness) are not edited by this spec. If DQ-3 needs a
  ruleset change, that is a founder act (the App has `admin=false`), done separately.

## Decisions needed (Clarify)

### DQ-1 - Which GitHub act carries the human approval?

- **(a) A native pull-request review, "Approve", from an allowlisted human (rec).**
  GitHub records `user.login`, `state: APPROVED` and **`commit_id`** on each review. That
  gives FR-2.1 and FR-2.2 directly from data the PR head cannot write. A review on an older
  commit is visibly stale. GitHub already refuses to let an author approve their own PR,
  which gives FR-2.3. *Cost:* the founder cannot approve a machinery PR **he authored
  himself**, so those still need `--admin`. Agent PRs are authored by the bot (SPEC-065
  DQ-3), so I believe that case is rare, but I have not measured it. There is also a small
  vocabulary cost: "approve" then means two things in this repo, approving a spec (DR-056)
  and approving a review.
- **(b) A `human-approved` label, verified from the label timeline (the issue's own
  suggestion).** This matches the existing `ai-review:pass` provenance pattern and is one
  click. *Cost:* a label carries **no commit**, so binding it to a SHA needs either the
  timestamp comparison FR-2.2 rejects, or a second artifact written by the evaluator. Under
  the threat model, that second artifact is forgeable unless FR-4 is solved first. It also
  needs its own revocation rules, which (a) gets from review dismissal.
- **(c) A ruleset "required reviewers" rule scoped to the machinery paths.** GitHub's native
  path-scoped review requirement. *Cost:* it is enforced by GitHub itself, so it is very
  strong. But it is a ruleset edit, which only the founder can make, it needs a team as
  the reviewer, and as an additive rule it does not by itself make `ready-to-merge` green.
  It **adds** a requirement rather than replacing the red one, so `ready-to-merge` still
  needs FR-1. I have not checked whether this rule is available on this repo's plan.

### DQ-2 - Who is on the human approver allowlist, and where does it live?

- **(a) A repository Actions variable, e.g. `MACHINERY_APPROVER_LOGINS`, holding the
  founder's login (rec).** This mirrors `AI_REVIEW_BOT_LOGINS`. *Cost:* any repo admin can
  edit it without review. That is acceptable in a solo repo, but it is a gate setting that
  lives outside version control.
- **(b) A committed file such as `CODEOWNERS` or `.minspec/config.json`.** *Cost:* changing
  it is itself a machinery-class change. If the evaluator reads it from the **base**, an
  added approver takes effect only after merge. That is correct, but the file has to be
  classified as machinery or a non-machinery PR could add an approver. That is the
  OQ-9-shaped problem SPEC-065 already has with `machinery-paths.ts`.

### DQ-3 - Where is FR-2 evaluated, so that FR-4 holds?

- **(a) A `workflow_run` job from the default branch, sharing SPEC-065's machinery-witness
  trust root, that re-runs `ready-to-merge` once the approval exists (rec).** One trust
  root for both halves of #509. *Cost:* it couples to SPEC-065's Plan, which has open
  founder decisions. It also does not by itself stop a head-edited `ready-to-merge.yml`
  from posting green (see the threat model), so it needs (c) or a ruleset change as well.
- **(b) A `pull_request_review` trigger.** *Cost:* that workflow file is head-sourced, so
  it is forgeable, which is exactly what FR-4 forbids. Listed only so the rejection is on
  record.
- **(c) Move the App's credentials into a deployment environment that only `main` may use,
  so head-sourced workflows cannot mint the App token, and have only a default-branch job
  post the witness as the App.** *Cost:* this touches the credential layout that
  `ai-review.yml` depends on (`ai-review.yml:208-209`, `:226-227`), which is a wider change.
  It is also the only option here that closes the self-forge hole for **every** machinery
  PR, not just this path. That arguably makes it a separate hardening issue that this spec
  should depend on rather than contain. See DQ-4.

### DQ-4 - Is the pre-existing self-forge exposure in scope here?

The threat model says, as an unverified belief, that a machinery PR can post its own green
`ready-to-merge` today. **(a) Split it into its own issue and make this spec depend on it
(rec).** It exists with or without this spec, and its fix (DQ-3 (c), or rebinding the
required check) is a ruleset or credential change on its own schedule. *Cost:* this spec
cannot ship until that issue lands, so #509 waits longer. **(b) Fix it inside this spec.**
*Cost:* the scope grows to include credential and ruleset work. The founder must file or
approve the split. Agents running under this dispatch may not file issues.

### DQ-5 - Own spec, or fold into SPEC-065?

**(a) Keep SPEC-137 separate (rec).** It works without SPEC-065 shipping (FR-7) and covers
`team`, which SPEC-065 parks. *Cost:* two specs claim #509, so #509's body should name both,
SPEC-065 FR-2 as the unattended half and SPEC-137 as the human half. Until it does, a reader
of #509 sees one. **(b) Fold it into SPEC-065 as a new FR.** *Cost:* SPEC-065's
requirements are approved, so adding an FR stales that approval and needs it signed again.

### Ownership by outcome (SPEC-051: settle before approval)

- Always **affected**: `.github/workflows/ready-to-merge.yml` and
  `.github/scripts/ai-review-guard.js` (the new verifier sits next to
  `verifyPassProvenance`), plus the guard's test file.
- DQ-3 (a) **creates** a default-branch workflow plus its test, or **affects** SPEC-065's
  `machinery-witness.yml` if that has landed.
- DQ-2 (b) **affects** the chosen committed file and the machinery classifier.
- INV-2 **affects** `packages/minspec/src/lib/template-registry.ts` if the template
  copy changes. That is review machinery and needs a human merge.

## Risks

- **False confidence.** A green `ready-to-merge` on a machinery PR starts to *mean*
  something once this path exists. If FR-4 is not met, that meaning is forgeable. That is
  why FR-4 is a requirement here and not a nice-to-have.
- **Rubber-stamping.** DR-076 notes that human gates in a solo repo decay into stamps. This
  path makes the stamp cheaper than `--admin`. The mitigation is that it is cheaper only for
  machinery PRs, and that it no longer skips `test` and `build`, which `--admin` does.
- **Allowlist misconfiguration.** A human added to the bot allowlist collapses the
  guarantee (`ready-to-merge.yml:52-55`). FR-2.1 and AC-4 make that state fail closed
  instead of silently granting.

## Out of Scope

- The unattended machinery witness (SPEC-065 FR-2).
- Changing which paths are machinery (SPEC-065 OQ-9 and OQ-15).
- Any ruleset or credential edit itself. Those are founder acts (INV-6). This spec only
  states the requirement they would satisfy.
- Removing `--admin` (FR-8).

## Traceability

- **Issue:** #509. **Refs from the issue:** #458 (self-edit guard), #425 (bot-only
  allowlist), #397 (provenance guard), #452 (the reviewer). **Also:** #466 and #810 (SHA-bound
  witnesses), #1870 (`hold:*`), #2056 (in-repo home for the single merge funnel rule).
- **Specs:** SPEC-065 (solo mode; FR-2 is the unattended half of #509), SPEC-024 (auto-merge
  gate), SPEC-038 and SPEC-051 (ownership before approval).
- **Decisions:** DR-033 and DR-047 (AI review gates merge), DR-054 (reviewer identity),
  DR-056 (no borrowed-identity approval), DR-066 (fail-closed required checks), DR-072 §3
  (`hold:*`), DR-076 (solo keep/kill list).
- **No new DR.** The irreversible choices here (DQ-1, DQ-3) are open for Clarify. If the
  answer to DQ-3 is (c), the credential relocation is a decision that cannot be undone in a
  day and should get a DR at that point.
