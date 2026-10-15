---
id: SPEC-137
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - the merge gate's own integrity
aspects: [ci, gates, required-checks, rulesets, provenance, github-app, secrets, workflows, machinery, no-silent-gate, blast-radius]
depends_on: [DR-054, DR-066]  # DR-054 the reviewer identity as a product constant; DR-066 the no-silent-gate rule this spec applies to the gate's own producer
relates_to: [SPEC-034, SPEC-065, SPEC-071, SPEC-033, SPEC-024, DR-050, "#417", "#410", "#397", "#359", "#350", "#342", "#560", "#810", "#1688", "#1870"]
# Ownership declared in Specify (SPEC-038 FR-3). The one piece needed under EVERY answer to
# the Clarify questions below is the witness of FR-1 to FR-3: a pure decision core plus its
# test. Both are NEW files. Whatever the producer change turns out to be (DQ-1), it lands in
# the files listed under `affects:`, which this spec modifies but does not own.
implements: [packages/minspec/src/lib/gate-forge-audit.ts, packages/minspec/tests/gate-forge-audit.test.ts]
# Modified, not owned. The workflow files are review machinery, so any change to them needs
# a human merge. The existing pin-audit script gains the new findings rather than a second CLI.
affects: [scripts/audit-ruleset-integration-ids.ts, .github/workflows/ready-to-merge.yml, .github/workflows/ai-review.yml]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Only the real gate can turn the merge gate green - not a pull request that edits a workflow

Triggered by: [#417](https://github.com/AIClarityAU/minspec/issues/417) (the residual
flagged in the #410 label-integrity re-review). Builds on DR-054 (the reviewer identity
is a fixed product value) and DR-066 (no silent gate). No new decision record yet: the
choice that is hard to undo is DQ-1 below, and a DR is written in Plan once the founder
has answered it.

## In plain terms

`main` will only merge a pull request when two required checks are green: `ai-review` and
`ready-to-merge`. #417 says any account that can write to the repo can fake
`ready-to-merge`. Part of that is already fixed. The ruleset now says which app must post
each check, so a status posted by hand with a personal token no longer counts. Two holes
are still open, and one is bigger than the issue says:

1. **Any workflow in this repo counts as the right app for `ready-to-merge`.** A pull
   request that edits or adds a workflow file gets that edited workflow run on its own
   commits. It can post a green `ready-to-merge` for itself.
2. **The reviewer App's private key can be read by any workflow that a pull request can
   edit.** A workflow can use that key to act as the reviewer. It can post a passing
   `ai-review`, add the `ai-review:pass` label, and turn every gate green at once. It
   could also copy the key out.

Today only someone allowed to push workflow files can use either hole. The bot that
agents push with is not allowed to. So this is a hardening, not an incident. But it means
the rule "a pull request that changes the gates needs a human to merge it" is held by a
GitHub permission setting. No check watches that setting.

This spec asks for three things. A witness that measures these holes and fails while
they are open. A fix so that no file a pull request controls can produce the
`ready-to-merge` signal. And a decision from you on which fix to use (DQ-1).

## One-Sentence Scope

Make the producer of each required merge check an identity that no workflow file a pull
request controls can act as, and add a witness that fails visibly while that is untrue.

## Context - what is true today (measured from this repo, 2026-10-15, at `5f792386`)

- **The gate is posted with the built-in Actions token from a `pull_request` workflow.**
  `.github/workflows/ready-to-merge.yml:88-96` (trigger `pull_request`),
  `:116` (`statuses: write`), `:156` (`GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`).
- **The guard module is pinned to the base commit, but the workflow file is not.**
  `:143-150` checks out `pull_request.base.sha` so a pull request cannot edit
  `.github/scripts/ai-review-guard.js` to rule in its own favour. The YAML that runs that
  step is a different matter. For `pull_request` events GitHub runs the workflow file from
  the pull request's own merge ref. A pull request that rewrites `ready-to-merge.yml` runs
  its rewrite. *I believe this from GitHub's documented `pull_request` behaviour. It is
  not reproduced here (a reproduction needs a push and a run).*
- **The ruleset pins both required checks to an app.** SPEC-065's witness of ruleset
  `18352261`, applied 2026-08-22
  (`specs/minspec/SPEC-065-solo-mode-ceremony-cut/requirements.md:236-249`):
  `ai-review` → `integration_id` 4212099 (the `minspec-sdd` App), `ready-to-merge` →
  15368 (GitHub Actions). So #417's premise, "matches by context string only", is out of
  date. A status posted with a personal token or with the reviewer App's token does not
  satisfy `ready-to-merge`. *I have not re-read the live ruleset this session (no network).
  Re-reading it is FR-1's job.*
- **The pin does not narrow it to one workflow.** 15368 is every workflow in the repo that
  holds a token able to write statuses, plus any workflow a pull request adds. The pin
  rules out other apps and humans. It does not rule out other workflows.
- **The reviewer App's key is in repo secrets read by a `pull_request` workflow.**
  `.github/workflows/ai-review.yml:208-209` and `:226-227` read `MINSPEC_APP_ID` /
  `MINSPEC_APP_PRIVATE_KEY` into a `pull_request` job. Same-repo pull requests get
  secrets (`:55-58` says so). `ai-review.yml` runs from the pull request's head (`:38`).
  `approve-on-label.yml:70-71,148-149` and `main-red-watch.yml:56-57` also read the key.
- **A machinery pull request is held by `ready-to-merge` alone.** A pull request that
  touches `.github/` or `scripts/` gets an `ai-review` check-run of `neutral`
  (`ai-review.yml:40-50`, `:171`). GitHub counts `neutral` as passing for a required
  check (`ai-review.yml:1002-1004`). `machinery-review-required` is `action_required`, but
  it is not in the ruleset's required list above. So the only required check keeping a
  machinery pull request red is `ready-to-merge`. That is why a machinery pull request
  needs a human `--admin` merge.
- **What stops this today is a permission, not a gate.** Pushing a change to
  `.github/workflows/**` needs the `workflows` permission. According to the operator's
  records, the founder removed `workflows=write` from the `minspec-sdd` App on purpose.
  GitHub then rejects a workflow-file push from that App with "refusing to allow a GitHub
  App to create or update workflow … without workflows permission". *This is from the
  operator's notes, outside this repo. Nothing in this repo checks it.* No check fails if
  that permission is given back.
- **The existing pin audit cannot see this.** `ruleset-integration-audit.ts:42` has the
  statuses `ok | mismatch | unobserved | unpinned`, and only `mismatch` fails (`:192`).
  An `unpinned` required check passes. Nothing checks who else can produce as the pinned
  app. The script is not wired into any workflow (SPEC-071 `:101-104`).

## The holes, as failure scenarios

- **R1 - a workflow edit fakes `ready-to-merge`.** Someone with workflow-push rights opens
  a pull request that changes `.github/scripts/x.js` and also adds `.github/workflows/z.yml`.
  On `pull_request`, `z.yml` posts `ready-to-merge: success` on the head commit with the
  built-in token. `ai-review` is `neutral` (machinery), and that passes. Every required
  check is now green, so the pull request can merge without `--admin`. Anything that
  merges on green alone (the auto-merge lane, the single-funnel driver) will merge it.
  Variant: a `push`-triggered workflow on any branch posts the status on *another* pull
  request's head commit.
- **R2 - a workflow edit borrows the reviewer.** The same pull request's `z.yml` mints a
  `minspec-sdd` token from `MINSPEC_APP_PRIVATE_KEY`. It posts `ai-review: success`, which
  satisfies the 4212099 pin. It adds `ai-review:pass` as `minspec-sdd[bot]`, which
  satisfies the provenance allowlist (`ready-to-merge.yml:166`). It posts the
  `ai-review/pass` witness. The base-pinned guard then honestly computes **green**,
  because every input to it is forged. The key can also be sent out of the run, which
  makes the forge permanent and possible from outside the repo.
- **R3 - the author is the reviewer (to measure, not assumed).** Dispatched agents
  authenticate through `scripts/lib/gh-bot.sh:60` (`~/.claude/scripts/gh-app-token.sh`).
  If that mints a token for the same App as the reviewer (4212099), an agent can post
  `ai-review` and the label directly, with no workflow edit. *Unverified. I could not
  tell from this container which App that script mints for.* If it is the same App, the
  fix belongs to SPEC-034 (OIDC review broker, a separate reviewer). It is recorded here
  so that it is not lost.

## Terms

- **Producer** - the identity GitHub records as the author of a status or check-run.
- **PR-controlled YAML** - any workflow file whose contents a pull request can choose for
  its own run. Today that means every workflow triggered by `pull_request`, or by `push`
  on a branch that is not the default branch.
- **Machinery** - the path set in `packages/minspec/src/lib/machinery-paths.ts` (the
  canonical source per `ai-review.yml:574`).

## Functional Requirements

### A. Witness first (needed under every answer to DQ-1)

- **FR-1 (pin witness).** A read-only audit reports, for each required check on `main`,
  which app it is pinned to. For `ready-to-merge` and `ai-review` it reports `unpinned`
  as a **failure**, not a pass. It extends the existing `auditRequiredCheckPins` rather
  than adding a second reader.
- **FR-2 (producer-reach witness).** The same audit reads the default branch's
  `.github/workflows/*.yml` and reports every place where a required check's pinned
  producer can be acted as from PR-controlled YAML:
  (a) the pinned app is GitHub Actions (15368) and any workflow on a PR-controlled trigger
  has `statuses: write` or `checks: write`, or writes by default;
  (b) any workflow on a PR-controlled trigger reads a secret the operator has listed as
  the key of a pinned producer (today `MINSPEC_APP_PRIVATE_KEY`).
  Each finding names the file, the line, the trigger and the check it reaches.
- **FR-3 (fail closed and visible - constitution invariant 2).** If the audit cannot read
  the ruleset or a workflow file, or cannot parse one, it exits non-zero and says what it
  could not read. "Cannot read" never counts as "no findings". The pure decision core
  takes parsed data only, so it can be tested offline. All network access stays in the
  script layer, as it does today (`audit-ruleset-integration-ids.ts` header).
- **FR-4 (wired, with a second witness).** The audit runs on a schedule and on every pull
  request that touches machinery. A failure is visible as a red check or an issue, never
  only as a log line. It cannot be the only witness for itself. If that workflow is
  deleted or skipped, something else must notice: SPEC-071's drift witness, or a second
  trigger chosen in Plan. Plan names which.

### B. Close the holes (shape depends on DQ-1)

- **FR-5 (R1 closed).** No PR-controlled YAML can produce a `ready-to-merge` status or
  check that satisfies the ruleset. After the change, the R1 scenario leaves the forged
  signal ignored by branch protection, and the pull request stays blocked.
- **FR-6 (R2 closed).** The private key of any app that a required check is pinned to is
  not readable from PR-controlled YAML. The reviewer may still review pull request heads,
  but the step that holds the key runs from YAML on the default branch only, for example
  a `workflow_run` stage or an environment limited to `main`. It treats the pull
  request's output as data. This is the "two-stage trusted/untrusted split" SPEC-065 DQ-2
  already names.
- **FR-7 (key rotation).** Once FR-6 is in place, the reviewer App's private key is
  rotated. Until then it has been readable by PR-controlled YAML, so it must be treated
  as possibly exposed. Rotation is a human act in the App's settings. The spec records it
  as a required step and does not claim it is done.
- **FR-8 (machinery stays human).** After the change, a machinery pull request still
  cannot merge without a human keystroke. This must be shown with an R1-style scenario
  against the new producer, not argued from the design.
- **FR-9 (existing guards kept).** Every threat `ready-to-merge.yml` closes today stays
  closed: stale pass on a new push (#359, #1688), hand-applied pass label (#397),
  SHA-bound second witness (#810), `hold:*` labels (#1870), and a single writer with no
  cancelled run leaving the status unposted (#1973). The guard's decision logic in
  `ai-review-guard.js` does not move or change, unless DQ-1 requires it.
- **FR-10 (header tells the truth).** The `ready-to-merge.yml` header's "REQUIRED MANUAL
  STEP 2" (`:61-65`) says only to require the check by name. It is updated to require the
  check **pinned to its producer**, and to name what the pin does not cover.

### C. Measure R3

- **FR-11 (author/reviewer identity).** Plan's first task records which App
  `gh-app-token.sh` mints for, compared with 4212099, as a measured value. If they match,
  a linked issue is filed against SPEC-034 and R3 is listed as open in this spec's
  Traceability. This spec does not close R3.

## Acceptance Criteria

- [ ] **AC-1 (FR-1).** Given a ruleset fixture where `ready-to-merge` has
  `integration_id: null`, the audit exits non-zero and names `ready-to-merge` as
  `unpinned`. Given the 2026-08-22 ruleset (both pinned), it reports no pin finding.
- [ ] **AC-2 (FR-2a).** Given the current `ready-to-merge.yml`, the audit reports it as a
  producer reach for `ready-to-merge` (`pull_request` trigger, `statuses: write`). Given
  a fixture where the only status writer runs from YAML on the default branch, it does not.
- [ ] **AC-3 (FR-2b).** Given the current `ai-review.yml`, the audit reports
  `MINSPEC_APP_PRIVATE_KEY` read under a `pull_request` trigger and names the lines.
- [ ] **AC-4 (FR-3).** Given an unreadable or unparseable workflow file, or an error
  reading the ruleset, the audit exits non-zero with a message naming what failed. It
  never exits 0. A mutation test that turns "read error" into "empty list" makes this AC
  fail.
- [ ] **AC-5 (FR-5, FR-8).** A pull request on a throwaway branch adds a workflow that
  posts `ready-to-merge: success` on its own head, and it also touches a machinery path.
  The branch is pushed by a human who has the `workflows` permission. It stays blocked:
  the merge box shows `ready-to-merge` as not satisfied. The PR number and a screenshot
  or API dump go in the Plan's evidence. This is a human-run test, because agents cannot
  push workflow files.
- [ ] **AC-6 (FR-6).** After the change, the audit's FR-2b finding list is empty on the
  default branch. A test pull request that runs `echo "${#KEY}"` on
  `secrets.MINSPEC_APP_PRIVATE_KEY` from a `pull_request` workflow prints `0`.
- [ ] **AC-7 (FR-7).** The App's settings page shows a key created after the FR-6 change
  merged, and the old key is deleted. The founder confirms this. No agent may claim it.
- [ ] **AC-8 (FR-9).** The existing `ai-review-guard.test.js` suite passes unchanged.
  Each of #359, #397, #810, #1870 and #1973 has a scenario that still produces red.
- [ ] **AC-9 (FR-4).** Deleting or disabling the audit workflow on a test branch is
  caught by the second witness Plan named.

## Invariants (must not break)

- **Constitution invariant 1 (offline core).** Nothing here enters the VS Code extension's
  runtime. The audit is dev-time and CI tooling that uses the operator's own `gh` for
  network access. The pure core in `packages/minspec/src/lib/` makes no network call.
- **Constitution invariant 2 (no silent gate).** The audit fails closed (FR-3) and has a
  second witness (FR-4). The gate itself still writes a status on every run. A missing
  producer means pending, which blocks. It never means green.
- **Constitution invariant 3 (blast radius).** Changes to this repo's own workflows and
  ruleset affect this repo only. If any of this is later shipped as an adopter template
  (`template-registry.ts`), it goes through SPEC-033's governance provisioning and
  applies only where `.minspec/` exists. Creating or editing rulesets and Apps is never
  done silently for an adopter.
- **The reviewer App cannot rewrite its own protection.** The App stays `admin=false`
  (SPEC-065 `:253-256`). No fix here may give any automated identity the right to edit
  the ruleset or to push workflow files.
- **No borrowed identity.** No step mints or posts a human's approval or review on the
  human's behalf.

## Decisions needed (Clarify)

### DQ-1 - Which mechanism closes R1?

- **(a) CODEOWNERS + "require code-owner review" on `.github/**` and `scripts/**`.**
  Cheapest. A forged status is no longer enough, because a human review is also required
  and a workflow token cannot fake one. Cost: in a solo repo the founder cannot approve
  his own pull requests. Every machinery pull request he writes would then need a bypass,
  and `--admin` bypasses the code-owner rule as well. So for his own pull requests this
  adds a step and no protection. It also closes nothing in R2.
- **(b) A dedicated gate identity, posted from default-branch YAML (rec).** A second,
  narrow GitHub App (only `checks: write` and read access) posts `ready-to-merge` as a
  **check-run**. The ruleset pins `ready-to-merge` to that App. Its key lives in an
  Actions environment that only `main` may use, and the job that holds it is triggered by
  `workflow_run` / `pull_request_target`, so its YAML always comes from the default
  branch. It does not check out or run anything from the pull request. This is the
  Checks API route #417 suggests, done with a key a pull request cannot reach. Cost: a
  new App to create and install, which is a human step. A `pull_request_target` /
  `workflow_run` job is the most commonly misused trigger on GitHub. One mistake that
  checks out the head commit is worse than today. The trusted stage must stay data-only,
  and a test must enforce that.
- **(c) Wait for SPEC-034 (OIDC review broker).** Keys live outside GitHub, and tokens are
  given out only to a workflow run whose `job_workflow_ref` is on `main`. This is the
  strongest option and is already specified (`status: planning`, `implements: none`, not
  built). Cost: a Cloudflare Worker and network setup that do not exist yet. R1 and R2
  stay open until it ships.

Recommendation: **(b)**, with the FR-1 to FR-4 witness shipped first and on its own,
because it is needed under every option. The cost of (b): one more App to look after and
a trigger that is safe only if the trusted stage never runs pull request code.

### DQ-2 - Is R2 (reviewer key exposure) in this spec or a separate issue?

- **(a) In this spec (rec).** Under (b), pinning to an App whose key PR-controlled YAML
  can read gains nothing. R1 and R2 are the same hole with two producers. Cost: the spec
  grows to cover `ai-review.yml`, which is the largest machinery file, so the change is
  bigger to review.
- **(b) Split it into its own issue.** Smaller pull requests. Cost: R1's fix can merge and
  look complete while the same forge is still open through R2.

### DQ-3 - Is the workflow-push permission enough for now?

Today only a human with `workflows` rights can use R1 or R2. Is that enough to leave the
holes open until DQ-1 ships, as long as FR-1 to FR-4 report them?
- **(a) Yes, with the witness live (rec).** Cost: protection still rests on one App
  permission setting. The witness turns red if a workflow reaches the producer, but it
  cannot see the App's permission list, so it would not notice `workflows=write` coming
  back.
- **(b) No, rotate the key and move it to a `main`-only environment now, before Plan.**
  Cost: `ai-review.yml` reads the key from `pull_request` jobs, so moving it stops the
  reviewer on every pull request until FR-6's two-stage split exists.

### DQ-4 - Does anything merge on green alone?

R1's harm depends on whether any automated path merges a pull request once all required
checks are green, without a human keystroke: the auto-merge lane (SPEC-024), docs-lane,
or the drain. If none do for machinery pull requests, R1 lowers the bar from "`--admin`"
to "an ordinary merge click". That is still a human, but now without the deliberate
override. Plan measures this. The answer changes urgency, not the requirements.

## Risks

- **The trusted stage pulls in pull request code.** This is the classic
  `pull_request_target` hole. Plan must include a test that fails if any trusted-stage job
  checks out or runs a head ref.
- **The pin changes and machinery merges stop.** When the ruleset pin moves from 15368 to
  a new App, all open pull requests show `ready-to-merge` as missing until the new
  producer posts. Plan sequences it: the new producer posts first, then the pin moves,
  then the old writer is removed.
- **A ruleset `PUT` drops other pins.** Rebuilding the rules array has dropped required
  checks before (SPEC-065 `:248-250`). The FR-1 audit is run right after the human edits
  the ruleset.

## Out of Scope

- R3 (the author and reviewer may be the same identity). It is measured here (FR-11) and
  fixed in SPEC-034.
- Adopter-repo provisioning of any of this. That belongs to SPEC-033.
- The `ai-review:changes` label. Faking it can only make the gate stricter
  (`ready-to-merge.yml:44-45`).

## Traceability

- Issue: #417. Parent residual: #410 (label integrity). Related: #350, #342, #359, #397,
  #560 (pin audit), #810, #1688, #1870, #1973.
- Specs: SPEC-034 (broker), SPEC-065 (ruleset witness, DQ-2 two-stage split), SPEC-071
  (required-check drift witness), SPEC-033 (governance provisioning), SPEC-024
  (auto-merge eligibility).
- Decisions: DR-054, DR-066. A new DR is written in Plan for the DQ-1 answer.
