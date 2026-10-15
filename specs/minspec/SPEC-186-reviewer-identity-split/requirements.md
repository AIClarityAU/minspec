---
id: SPEC-186
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - who may write the verdict that gates a merge
aspects: [reviewer, identity, github-app, provenance, ai-review, ready-to-merge, native-review, credentials, no-silent-gate, dev-time]
depends_on: [DR-033, DR-054, DR-082, DR-104]  # DR-033 §6 the reviewer-provenance model; DR-054 the shipped reviewer identity; DR-082 the agent bot identity; DR-104 the verdict carry the native approval must follow
relates_to: [SPEC-034, SPEC-031, SPEC-065, SPEC-071, DR-056, DR-061, DR-066, DR-103, "#464", "#2589", "#459", "#397", "#342", "#1355", "#560", "#810", "#1688"]
# Ownership is not declared yet, on purpose. Which files change depends on DQ-1 (which App
# keeps the reviewer role): under the recommended option the work is mostly in the agent-side
# credential path (scripts/lib/gh-bot.sh, the host token broker outside this repo) and in
# .github/workflows/ai-review.yml; under the other option it moves to the shipped templates
# and the ruleset. Plan declares `implements:` once DQ-1 is answered, BEFORE approval of the
# Plan mints a hash (SPEC-038).
implements: none
implements_reason: Specify-phase only; the owned file set depends on DQ-1 (which App keeps the reviewer role) and is declared at Plan
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-186: The reviewer is an identity no agent session can obtain, and it posts a real GitHub approval

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers or accepts its Clarify questions, and approves it through the normal
> spec-approval gate before anything changes. Every requirement below is written under each
> question's recommended option, so approving the spec as it stands accepts those
> recommendations. Choosing a different option changes only the requirements that question
> names.

Materializes **[#464](https://github.com/AIClarityAU/minspec/issues/464)** (*reviewer
bot/App identity so ai-review can post a true GitHub-native approval*) and the sharper,
later statement of the same gap, **[#2589](https://github.com/AIClarityAU/minspec/issues/2589)**
(*the review verdict is trusted by an identity every agent session can obtain*), filed with
[DR-103](../../../docs/decisions/DR-103.md) as its precondition P1.

**Id note.** Spec numbers 142 and 182 to 185 are claimed on open agent branches
(checked across every `refs/remotes/*` in this checkout on 2026-10-16; open pull requests
were not visible from here). So this is `SPEC-186`. If the id collides at review time,
renumber.

## In plain terms

#464 was filed when the reviewer ran under the founder's own account, so GitHub refused to
let it approve the founder's pull requests. That part has since changed: the reviewer now
posts as the `minspec-sdd[bot]` GitHub App. But the same App is also the identity every
agent session uses to open pull requests, comment and label (DR-082). Two things follow:

1. **The reviewer still cannot approve most pull requests.** Agent pull requests are opened
   by `minspec-sdd[bot]`, and GitHub refuses a review from a pull request's own author. So
   the GitHub-native "Approved" state #464 asked for still does not exist on them, and
   `ai-review.yml` does not even try - it posts a comment, a label, a status and a check-run.
2. **The verdict can be written by the agents it checks.** Any process in the agent
   container can get a token for that App, and the gate trusts that App's label, status
   and check-run. So the "dedicated identity that only the reviewer pipeline ever uses"
   #464 asked for does not exist either. DR-103 records this as the reason automatic
   publishing stays off.

This spec gives the reviewer its **own** identity, held only by GitHub Actions, and has it
post a real GitHub approval that follows the verdict exactly.

## One-Sentence Scope

Separate the reviewer's GitHub identity from the agents' so that no agent session can
obtain it, make the merge gate trust only that identity, and have the reviewer post a
GitHub-native review whose state always matches the verdict on the current head commit.

## Context - what the code does today (read from this checkout, based on `origin/main`)

### The reviewer posts as the shared App

- `.github/workflows/ai-review.yml:220-227` mints an installation token for the App from the
  `MINSPEC_APP_ID` / `MINSPEC_APP_PRIVATE_KEY` repository secrets
  (`actions/create-github-app-token`). Every post, label, commit status and check-run in that
  workflow uses it (`ai-review.yml:181-183`).
- It posts the verdict as a **comment** (`ai-review.yml:1277`, `gh pr comment`), a label
  (`:1358`), the `ai-review/pass` commit status (`:1331`) and the `ai-review` check-run
  (`:1167`, `:1235`). There is no call that submits a pull request review
  (`grep -n "pr review\|/reviews" .github/workflows/ai-review.yml` matches only prose).

### The agents post as the same App

- `scripts/lib/gh-bot.sh:1-60` wraps `gh` so every agent write mints a token for the App
  through the host broker script `$HOME/.claude/scripts/gh-app-token.sh`
  (`gh-bot.sh:60`). DR-082 made that mandatory.
- `scripts/dispatch-issue.sh:176` arms that wrapper, and `:1372` opens the agent's pull
  request with it, so agent pull requests are **authored by the App**.
- `scripts/dispatch-issue.sh:1255-1258` states the consequence in its own comment: the
  advisory review falls back to a comment "on a self-authored PR: PRs here are opened by the
  bot, and GitHub refuses a review from the PR's own author".
- DR-103 (`docs/decisions/DR-103.md:274-283`) records, from the host register, that any
  process in the agent container can obtain a token for that App, and that the token
  carries `checks`, `statuses`, `issues`, `contents`, `pull_requests` and `actions` write.
  That was read there, not measured again here.

### The gate trusts that App

- `.github/workflows/ready-to-merge.yml:166` defaults the allowlist to `minspec-sdd[bot]`.
  `ready-to-merge.yml:48-58` already says the allowlisted identity "MUST be a dedicated
  reviewer identity", because otherwise a hand-applied pass "is indistinguishable from a real
  review and the guarantee collapses". Today the allowlisted identity is shared with every
  agent session, which is the same collapse one step removed.
- The guard reads the check-run's `app.slug`, which GitHub assigns
  (`.github/scripts/ai-review-guard.js:1472`, `:1525`), and the label/status actor
  (`verifyPassProvenance`, `:1369`). Both are server-attested, so they do identify the App
  correctly. The weakness is not in the guard; it is that the App it names is not
  dedicated.

### Other users of the same App

- `approve-on-label.yml` and `main-red-watch.yml` also mint tokens from
  `MINSPEC_APP_ID` / `MINSPEC_APP_PRIVATE_KEY`.
- The shipped templates default adopters' allowlist to `minspec-sdd[bot]`
  (`packages/minspec/src/lib/ci-review-templates.ts`, pinned by
  `packages/minspec/tests/bot-logins-default.test.ts`, per DR-054).
- `scripts/dispatch-ready-check.sh:197-206` trusts verdict **records** (triage, not review)
  from the App by account number via `scripts/lib/dispatch-author-gate.sh`.

### What branch protection requires

SPEC-065 measured on 2026-08-19 that `required_approving_review_count` is `null` on `main`'s
ruleset, and DR-047 says the ruleset has no `pull_request` rule. So no GitHub approval is
required today. This spec does not change that (DQ-4).

## Terms

- **Reviewer App** - the GitHub App whose actions the merge gate trusts as the review.
- **Agent App** - the GitHub App agent sessions use for every other GitHub write (DR-082).
- **Verdict witnesses** - the `ai-review:pass` label, the `ai-review/pass` commit status and
  the `ai-review` check-run, as read by `ready-to-merge`.
- **Native review** - a pull request review submitted through GitHub's reviews API, whose
  state is `APPROVED`, `CHANGES_REQUESTED` or `COMMENTED`.

## Functional Requirements

### Separate identities

- **FR-1 - Two Apps, two roles.** The reviewer role and the agent role are held by two
  different GitHub Apps. No identity holds both. Under DQ-1's recommendation the existing
  `minspec-sdd` App keeps the reviewer role and a new Agent App takes the agent role.
- **FR-2 - The reviewer key lives only in GitHub Actions.** The Reviewer App's private key
  exists only as a GitHub Actions secret of this repository (or of its organisation, scoped
  to this repository). It is not held by the host token broker, the agent container, any
  file in this repository, or any local machine after it has been stored as a secret.
- **FR-3 - The reviewer key is rotated at cutover.** Because the current key has been
  reachable through the host broker, the Reviewer App gets a newly generated private key at
  cutover and every earlier key of that App is deleted. Tokens minted before deletion expire
  within an hour; the cutover is complete only after that hour has passed.
- **FR-4 - Agents use the Agent App only.** `scripts/lib/gh-bot.sh` and the host broker it
  calls mint tokens for the Agent App only. Agent commit identity (DR-056) and the
  bot-identity checks that deny bots as approvers (`dispatch-ready-check.sh
  --is-bot-identity`, `approve-issue.sh:182`) recognise both Apps as bots.
- **FR-5 - The reviewer does review only.** The Reviewer App never opens pull requests,
  pushes commits or files issues. It is used only by `ai-review.yml` (and its retry
  workflow, if that one posts verdicts). `approve-on-label.yml` and `main-red-watch.yml`
  move to the Agent App or to a third identity, decided at Plan, never the Reviewer App.
- **FR-6 - Least privilege for the Reviewer App.** Repository permissions: `pull_requests:
  write`, `issues: write`, `checks: write`, `statuses: write`, `contents: read`,
  `metadata: read`. Not `contents: write`, `actions`, `workflows`, `administration`, or any
  organisation permission.
- **FR-7 - The Agent App can never push workflow files.** The Agent App does not hold the
  `workflows` permission. Its permission set is recorded in Plan with a witness that reports
  visibly if `workflows` (or `administration`) ever appears on it. This is what keeps the
  reviewer key out of reach of a pull request that edits `ai-review.yml` (DQ-3).

### The gate trusts only the reviewer

- **FR-8 - The allowlist names the Reviewer App only.** `AI_REVIEW_BOT_LOGINS` (and its
  default in `ready-to-merge.yml` and the shipped templates) names the Reviewer App and
  nothing else. The required `ai-review` check context in the ruleset is pinned to the
  Reviewer App's id (the #560 failure was a pin to the wrong id).
- **FR-9 - Agent-written witnesses are rejected.** A label, commit status or check-run
  written by the Agent App is treated exactly like one written by a human: not a witness.
  The existing guard does this by allowlist already; this requirement adds a test that
  feeds it an Agent App witness and expects red.
- **FR-10 - Cutover keeps the gate satisfiable and closed.** The order is: create and
  install the new App; store its secret; switch its consumers; verify one real run of each
  consumer; only then remove the old binding. At no step is the allowlist empty-by-mistake
  (the gate would be unsatisfiable, the #810 shape), and at no step does it name an
  identity an agent can obtain once FR-3's hour has passed. Each step has a check whose
  failure is visible (constitution invariant 2).

### A real GitHub approval that follows the verdict

- **FR-11 - Pass submits an approval bound to the reviewed commit.** When the verdict on a
  non-machinery pull request is `ai-review:pass`, the reviewer submits a native review with
  state `APPROVED` and `commit_id` set to the head SHA it reviewed. The body links the
  verdict comment; it does not repeat it.
- **FR-12 - No approval outlives its commit.** At the start of every review run (the step
  that already marks `ai-review:pending`, `ai-review.yml:229-275`), the reviewer dismisses
  every `APPROVED` review it has standing on the pull request. So a push never leaves an
  approval from an older head in place, whatever the ruleset's dismiss-stale setting is.
- **FR-13 - Any non-pass leaves no approval.** A substantive `ai-review:changes`, a
  fail-closed `ai-review:changes` (workflow error, garbled verdict), `ai-review:blocked`, and
  a cancelled or skipped run all end with no standing `APPROVED` review from the reviewer.
  A substantive `changes` verdict submits a `CHANGES_REQUESTED` native review (DQ-2).
- **FR-14 - A carried verdict carries the approval.** When a pass is carried to a new head
  under DR-104, the reviewer submits a fresh `APPROVED` review bound to the new head, so the
  native state and the witnesses agree on every head.
- **FR-15 - Machinery pull requests get no approval.** A pull request the workflow treats as
  machinery (its `ai-review` check concludes `neutral`) gets a `COMMENTED` native review,
  never `APPROVED`, whatever the verdict. A gate cannot certify a change to itself, and the
  founder's merge stays the only release for machinery.
- **FR-16 - The native review is never a gate input in this spec.** `ready-to-merge` keeps
  its two witnesses (status, check-run) and does not read native reviews. A failure to
  submit or dismiss a native review is reported visibly - an Actions error annotation and
  one line in the verdict comment naming the failed call - and does not change the verdict
  or its witnesses. A failure to **dismiss** a stale approval (FR-12) fails the run, because
  a standing approval on an unreviewed head is a false signal.
- **FR-17 - Every author class can be approved.** Because the Reviewer App is neither the
  Agent App nor any human, FR-11 succeeds on pull requests authored by the Agent App, by the
  founder, and by any other human contributor.

### Records

- **FR-18 - Record the decision.** Once DQ-1 is answered, Plan writes a decision record for
  the identity split (DR-103 lists the reviewer identity as costly to refactor), and amends
  DR-054's statement of which App is the shipped reviewer identity if DQ-1 option `b` is
  chosen.
- **FR-19 - Update the stale prose.** The header comments of `ai-review.yml`,
  `ready-to-merge.yml` and `gh-bot.sh`, and the comment at `dispatch-issue.sh:1255-1258`,
  are rewritten to say which App does what. #2589 and DR-103's precondition P1 are updated
  when this ships.

## Acceptance Criteria

- **AC-1 (FR-1, FR-4, FR-5).** After cutover, a token minted through
  `$HOME/.claude/scripts/gh-app-token.sh` in the agent container reports, from
  `GET /installation/repositories` and the app slug, the Agent App - not the Reviewer App.
- **AC-2 (FR-2, FR-3).** The Reviewer App's settings page lists exactly one private key,
  created on or after the cutover date. This is a check the founder reads; nothing in this
  repository can read an App's key list without that App's own key, so it is stated as a
  human-verified criterion, not a test.
- **AC-3 (FR-9).** A guard unit test: a pass label, `ai-review/pass` status and `ai-review`
  check-run each posted by the Agent App's login or slug make `ready-to-merge` fail with a
  reason naming the identity. The same inputs from the Reviewer App pass.
- **AC-4 (FR-8, FR-10).** After cutover the ruleset's required `ai-review` context names the
  Reviewer App's id, and the drift witness from SPEC-071 (if built) reports no drift.
- **AC-5 (FR-11, FR-17).** On one agent-authored and one founder-authored non-machinery pull
  request that pass review, GitHub shows an `APPROVED` review from the Reviewer App whose
  `commit_id` equals the head SHA.
- **AC-6 (FR-12).** Pushing a commit to a pull request with a standing approval leaves no
  `APPROVED` review from the Reviewer App once the new run's pending step has finished.
- **AC-7 (FR-13).** A pull request reviewed as `changes`, and one whose run fails
  fail-closed, each end with no `APPROVED` review from the Reviewer App; the `changes` one
  carries a `CHANGES_REQUESTED` review.
- **AC-8 (FR-14).** A push that DR-104 carries ends with an `APPROVED` review bound to the
  new head.
- **AC-9 (FR-15).** A machinery pull request with a pass verdict shows a `COMMENTED` review
  and no `APPROVED` review from the Reviewer App.
- **AC-10 (FR-16).** With the review-submit call forced to fail (test double), the verdict
  witnesses are unchanged and the run log carries the error annotation; with the dismiss
  call forced to fail, the run fails.
- **AC-11 (FR-7).** The witness from FR-7 runs and reports red when given a permission set
  containing `workflows`.

## Invariants (must not break)

- **Constitution invariant 1 - offline core.** Nothing here touches the extension's
  runtime. The only shipped change is a default identity string in a template (and only
  under DQ-1 option `b`).
- **Constitution invariant 2 - no silent gate.** The gate keeps two independent witnesses
  (#810). Cutover never leaves the allowlist empty by mistake or naming an obtainable
  identity. A failed dismissal of a stale approval fails visibly (FR-16).
- **Constitution invariant 3 - blast radius.** Adopters' repositories are not changed by
  this spec under the recommended DQ-1 option. Under option `b`, the new default reaches an
  adopter only when they regenerate their workflows, and their own `AI_REVIEW_BOT_LOGINS`
  override still wins.
- **DR-082.** Every agent GitHub write keeps a bot identity and fails closed when none can
  be minted; it is only a different bot.
- **DR-033 §6 / DR-061.** Merging stays gated on the provenance-verified pass; nothing here
  makes the gate easier to satisfy.
- **The founder's `--admin` merge stays the only release for machinery** (DR-076 solo-mode
  cuts, `ready-to-merge.yml` machinery handling).

## Decisions needed (Clarify)

Each question has a recommendation, marked **(rec)**, with the main cost of choosing it.
The requirements above are written under every recommendation.

- **DQ-1 - Which App keeps the reviewer role?**
  - **a (rec) - `minspec-sdd` stays the reviewer; create a new Agent App for agents.**
    The shipped default (DR-054), the templates, `AI_REVIEW_BOT_LOGINS`, and the ruleset's
    pinned `ai-review` app id all stay as they are, so adopters are untouched.
    *Cost:* every agent-side consumer moves - the host broker (outside this repo, a
    founder/host change), `gh-bot.sh`, DR-056's agent commit identity, the account list in
    `dispatch-author-gate.sh` (which must keep trusting old triage records written by
    `minspec-sdd`), and the noreply email on agent commits. Agent-authored history before
    and after cutover shows two different bot names.
  - **b - `minspec-sdd` stays the agent; create a new Reviewer App.** Agents are untouched.
    *Cost:* the ruleset pin, the allowlist default, the shipped templates, the
    `bot-logins-default` test and DR-054's product constant all change, and adopters get a
    new default the next time they regenerate their workflows.
- **DQ-2 - What native review does a substantive `changes` verdict submit?**
  - **a (rec) - `CHANGES_REQUESTED`.** The pull request page then says plainly that the
    reviewer wants changes. *Cost:* it stays visible until the next pass replaces it, and
    if branch protection ever requires approvals, a lingering request blocks the merge
    until the reviewer approves (which is the intended behaviour, but is one more state).
  - **b - `COMMENTED`.** Lighter, never blocks. *Cost:* the native state then says less
    than the label does.
- **DQ-3 - Does this spec also close the "a pull request that edits `ai-review.yml` can
  read the reviewer key" path?** `ai-review.yml` runs on `pull_request`, so it executes the
  pull request's own copy of the workflow file, with the repository's secrets, for a
  same-repository pull request.
  - **a (rec) - No; rely on FR-7 and say so.** Only a credential that can push workflow
    files can use this path. The Agent App cannot (FR-7). The founder's token can, and it
    can already merge with `--admin`, which bypasses the review entirely, so the key would
    give it nothing new. *Cost:* the "only the reviewer pipeline can act as the reviewer"
    property holds only against identities that cannot push workflow files; a future
    identity with `workflows` permission and without admin would reopen it, and only FR-7's
    witness would notice.
  - **b - Split the workflow.** An unprivileged `pull_request` job produces the verdict as an
    artifact; a `workflow_run` job, which always runs the default branch's definition, holds
    the reviewer key and posts. *Cost:* a restructure of the repository's largest workflow,
    roughly a minute of added latency per review, an artifact that must be parsed as
    untrusted data and bound to the head SHA, and an explicit refusal for fork pull requests
    (which `workflow_run` would otherwise serve with secrets).
- **DQ-4 - Should `main`'s ruleset start requiring one approving review?**
  - **a (rec) - Not in this spec.** The native approval is built and observed first; making
    it required is a separate decision once it has been reliable. *Cost:* until then the
    native approval is informative only - the merge still rests on the status and the
    check-run, as today.
  - **b - Yes, at cutover.** *Cost:* GitHub's rules cannot say which approvers count, so an
    Agent App approval on a founder-authored pull request would also count unless the Agent
    App lacks `pull_requests: write` (it needs it to open pull requests). Whether a GitHub
    App's approval counts toward a required review count is also not verified here
    (I believe it does, unverified). Both would need measuring first.

## Costly to Refactor

- **Which App name is the reviewer** (DQ-1). After cutover, history, the ruleset pin and
  (under option `b`) adopters' templates carry it. Changing it again is another cutover.
- **The key's location.** Moving the reviewer key back into any place an agent can reach
  undoes the whole spec; FR-2 is the line that must not move.
- Cheap: the native review's body text, and DQ-2's choice.

## Risks

| Risk | Mechanism | Mitigation |
|---|---|---|
| Cutover leaves the gate unsatisfiable | Allowlist or ruleset pin switched before the new identity has posted once - the #810 / #560 shape | FR-10's order, with a verified run before each removal. |
| The old key keeps working | A copy of the current key outside GitHub survives the split | FR-3 rotates it and deletes every earlier key. |
| A stale approval reads as a pass | GitHub keeps an approval across a push unless told otherwise | FR-12 dismisses at run start; a failed dismissal fails the run (FR-16). |
| Native state and witnesses disagree | The approval is posted or removed on a different path from the label and status | FR-11 to FR-15 tie it to the same verdict and head SHA; AC-5 to AC-9 test each case. |
| The agent side breaks at cutover | A consumer still asks the broker for the old App | FR-4 lists the consumers; `check-gh-bot-attribution.sh` already fails CI when a write is not wrapped. |
| Triage verdict records stop being trusted | `dispatch-author-gate.sh` trusts the App by account number | Plan keeps the old account on that list for records written before cutover (DQ-1 cost). |
| The workflow-edit path is used | A credential that can push workflow files edits `ai-review.yml` in a pull request | DQ-3; FR-7's witness. |

## Out of Scope

- The customer-facing broker for adopters (SPEC-034). This spec is about this repository's
  own reviewer.
- The same weakness in **triage** verdict records, which the Agent App will still be able to
  write after this spec (`dispatch-ready-check.sh:197-206`). It is a separate gate with its
  own decision and needs its own issue.
- Hardening the reviewer's prompt against injected verdict markers (#1470).
- Making a native approval required by branch protection (DQ-4).
- Any change to which pull requests count as machinery.

## Alternatives considered and rejected

- **A dedicated machine-user account instead of a second App.** It needs a seat, a
  password and 2FA held by a person, which is exactly "a human authenticates as it", and its
  token is a long-lived personal access token. An App's identity is server-attested
  (`app.slug`) and its tokens expire in an hour.
- **Keep one App, and make the broker refuse to mint for review.** The broker hands out an
  installation token, and an installation token's permissions are the App's. A token that
  can open pull requests can also write labels and statuses. The split has to be in the
  identity, not in the broker's intent.
- **Have the reviewer use the workflow's own `GITHUB_TOKEN`.** Then the witnesses are
  written by `github-actions[bot]`, which any workflow in the repository can also write as,
  including one an agent's pull request adds. Weaker than today.
- **Fix only the approval (#464 item 1), not the shared identity.** The approval would
  still fail on every agent-authored pull request, because the author and the reviewer
  would still be the same App.

## Test plan (for the Plan phase to place)

- Guard tests for AC-3 in `.github/scripts/ai-review-guard.test.js` (machinery - founder
  merge).
- Workflow-level tests for the native-review step's decision table (FR-11 to FR-16): one
  pure function from (verdict, machinery, carried, standing reviews) to the calls to make,
  tested exhaustively, so the workflow only executes its output.
- A post-cutover checklist run once, recording AC-1, AC-2, AC-4 and AC-5 to AC-9 against real
  pull requests, with links in the pull request that ships the change.

## What the founder does (once, at cutover)

These are founder-only acts; the spec cannot do them:

- Create the new App (DQ-1 decides which role it takes), set FR-6's permissions, install it
  on this repository only.
- Generate the Reviewer App's new key, store it as the Actions secret, and delete every
  other key of that App (FR-3).
- Point the host broker at the Agent App (outside this repository).
- Re-pin the ruleset's `ai-review` context if DQ-1 option `b` is chosen.

## Traceability

- Issue: [#464](https://github.com/AIClarityAU/minspec/issues/464); same gap, sharper:
  [#2589](https://github.com/AIClarityAU/minspec/issues/2589).
- Rests on: [DR-033](../../../docs/decisions/DR-033.md) §6 (reviewer provenance),
  [DR-054](../../../docs/decisions/DR-054.md) (shipped reviewer identity),
  [DR-082](../../../docs/decisions/DR-082.md) (agent bot identity),
  [DR-104](../../../docs/decisions/DR-104.md) (verdict carry).
- Unblocks: [DR-103](../../../docs/decisions/DR-103.md) precondition P1 (automatic
  pre-release publishing).
- Sibling for adopters: [SPEC-034](../SPEC-034-oidc-review-broker/requirements.md).
