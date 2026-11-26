---
id: SPEC-268
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-268 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-009  # Team Readiness - guardrails a repo must carry, provisionable without hand-set secrets
relates_to: ["#2982", "#1567", "#559", "#397", "#810", "#1973", "DR-054", "DR-115", "DR-123"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-268 - Design: the review stack runs with only the Claude secret (Plan)

Contract: [requirements.md](requirements.md). Decisions D1-D3 are closed there: D1
`workflow_run` and D3 DR-115 (recommended picks, DR-123), and D2 option (b), re-evaluate in
both arms (the founder's choice on 2026-11-27, replacing the earlier agent pick of an early
exit). The reason is R3: an early exit is unsound once the trigger shares the per-PR
concurrency group FR7 requires. Requirements D2 and AC2 are amended to match in a separate founder-approved change (the
approval is his act, so it lands through his editor, not in this pull request).

## R1 - Identity mode, decided once per run

| App secrets present | `identity` | Extra |
|---|---|---|
| both | `app` | none |
| neither | `actions` | none |
| exactly one | `actions` | `::warning` naming the missing secret |

Decided in two places that cannot share code, because one is a bash step in
`ai-review.yml` and the other runs before the trusted guard module is checked out in
`ready-to-merge.yml`:

- `ai-review.yml` step `guard` (bash) emits `configured` (Claude secret only, FR1) and
  `identity`.
- `ready-to-merge.yml` step `ctx` (github-script) emits `identity` from two booleans
  (`secrets.X != ''`), so no secret value enters the step.

A parity test (T0) executes both steps over all four secret states and asserts the same
`identity`. The duplicated rule is therefore bound by a test, not by a comment.

## R2 - Token selection in `ai-review.yml` (FR2-FR4)

Every write step reads its token through ONE expression, textually identical everywhere:

```
${{ steps.guard.outputs.identity == 'actions' && github.token || steps.app-token.outputs.token }}
```

- `identity == 'actions'`: `github.token`, never empty.
- otherwise: the App token exactly as today. If the mint failed the value is empty, as
  today, and each step's existing `-z GH_TOKEN` handling is unchanged. The App arm never
  silently downgrades to `github.token`.

A test asserts every `steps.app-token.outputs.token` reference in the workflow sits inside
that exact expression. The mint step runs only when `identity == 'app'`. Workflow-level
`permissions:` widen to the FR4 set (`contents: read`, `pull-requests: write`,
`issues: write`, `checks: write`, `statuses: write`). The inference step still receives no
GitHub token.

## R3 - `ready-to-merge.yml` (FR5-FR7)

New trigger `workflow_run: { workflows: [ai-review-runner], types: [completed] }` (D1).
Concurrency group becomes
`ready-to-merge-${{ github.event.pull_request.number || github.event.workflow_run.pull_requests[0].number || github.run_id }}`:
the same per-PR group whenever a PR is known (#1973); the run-id fallback is only reached
when no PR is named, and that run posts nothing.

New first step `ctx` (github-script, GITHUB_TOKEN):

1. Decide `identity` (R1).
2. `pull_request` event: `proceed=true`, `pr_number` and `base_sha` from the payload.
3. `workflow_run` event:
   - Both arms re-evaluate (D2 option b, not the recorded pick a). GitHub's concurrency
     keeps one running and one PENDING run per group and cancels the older pending run
     when a newer one queues. The review's completion arrives seconds after its label
     (App arm: a `labeled` run) or after a push cancelled it (a `synchronize` run). A
     `workflow_run` run that exited without writing would cancel that queued run and post
     nothing, leaving the head with no `ready-to-merge` status, which breaks the #1973
     property "the latest-started evaluation writes last". Re-evaluating from fresh API
     state keeps that property: the run that displaced the queued one evaluates a state at
     least as new. Outcomes in the App arm are the ones the `labeled` run would post (same
     allowlist, same witnesses); the visible difference is one more status write.
   - no PR in `workflow_run.pull_requests` (fork run, or a run not tied to a PR): NOTICE,
     `proceed=false`. The PR's last status stands; `opened`/`synchronize` already posted
     `failure`, so it reads red, never pending.
   - otherwise read the PR from the API. A read that fails: post `failure` on
     `workflow_run.head_sha` naming the reason, then fail the step (visible red run). A PR
     that is closed or from a fork: NOTICE, `proceed=false`.
   - `proceed=true`, `base_sha` = the PR's CURRENT base SHA from that read.

Every later step runs only when `proceed == 'true'`. The checkout pins `base_sha`. The gate
script loads the PR from the payload (`pull_request`) or freshly from the API
(`workflow_run`, so it evaluates the current head, FR7), and uses `action = 'reevaluate'` for
`workflow_run`, which no provenance-revert or staleness rule matches.

Allowlist (FR5, FR6) - computed by a new pure guard function `effectiveAllowlist`:

```
base   = parseAllowlist(AI_REVIEW_BOT_LOGINS)          // unchanged default line
widen  = identity == 'actions'
         && AI_REVIEW_BOT_LOGINS variable is unset      // operator's explicit list wins
         && PR head repo == base repo                   // never on a fork
         && touchesMachinery === false                  // FR6; unknown => no widening
result = widen ? base + ['github-actions[bot]'] : base
```

`touchesMachinery` comes from a new guard function `pathsTouchMachinery(paths)` using the
SAME `MACHINERY_PATH_RE` as `inputTouchesMachinery` (one source). It fails toward `true`
on an empty, missing or truncated list (fewer files listed than `pr.changed_files`). The
gate reads the file list only in the Actions arm. A base guard that predates this change
has no `effectiveAllowlist`, so the gate falls back to the unwidened list: strict, never
loose.

`github-actions[bot]` matches all three witnesses unchanged: label actor and status creator
by login, check-run by `app.slug` + `[bot]` (`verifyHeadPassCheckRun`).

## R4 - Probe and report (FR8)

- `REVIEWER_SECRETS = ['CLAUDE_CODE_OAUTH_TOKEN']`; new `REVIEWER_IDENTITY_SECRETS =
  ['MINSPEC_APP_ID', 'MINSPEC_APP_PRIVATE_KEY']`. The anti-drift test binds every
  `secrets.*` in `ai-review.yml` to the union of the three constants.
- New `probeReviewerIdentity(owner, repo, run)` returns `{ configured, identity, missing,
  sentence }` from ONE secrets read. `probeReviewerConfigured` becomes a thin wrapper, so
  the #559 guard keeps one source.
- `init.ts` prints the sentence in the reviewer advisory for each of the three states.

## R5 - Recurrence gate

`packages/minspec/tests/adopter-secret-allowlist.test.ts` fails when:

1. any `secrets.<NAME>` in any SCAFFOLDED workflow (the template registry's list) is not in
   `ADOPTER_REQUIRED_SECRETS` (`CLAUDE_CODE_OAUTH_TOKEN`) or the declared optional sets;
2. `REVIEWER_SECRETS` holds anything outside `ADOPTER_REQUIRED_SECRETS`;
3. the scaffolded `ai-review.yml` guard skips on any secret other than the Claude one
   (executed, not grepped: the guard runs with only the Claude secret and must emit
   `configured=true`).

## R6 - Accepted residuals

- `GITHUB_TOKEN` re-runs from `ai-review-retry.yml` may not fire `workflow_run` (GitHub's
  rule on token-created events; unverified for re-runs). If not, the gate keeps its last
  posted status (red), never a false green; the next push re-evaluates.
- The very first PR that installs the scaffold cannot self-trigger `workflow_run` (the
  workflow must be on the default branch). Its gate stays red; merge as a machinery PR.
- The widened `GITHUB_TOKEN` (both arms, FR4) is persisted by the base checkout into
  `.git/config`, where the read-only voters could read it. Not a new capability: under the
  `pull_request` trigger a same-repo PR author already runs their own copy of this
  workflow with this token, and fork runs get a read-only token and skip for want of the
  Claude secret. Hardening (`persist-credentials: false`, then authenticating the head
  fetch explicitly) is left out because it changes the App arm's fetch path.
- The forge DR-115 accepts (a same-repo PR editing a non-machinery path cannot post as
  `github-actions` without touching `.github/`, so FR6 closes the workflow route).

## Rejected alternatives (DR-086 section 4)

- Step output carrying the selected token: rejected, a token in a step output risks being
  dropped or logged; the single inline expression avoids it.
- Load the guard module before PR resolution to keep one identity implementation:
  rejected, the trusted base is unknown until the PR is resolved; the parity test binds the
  two copies instead.
- D2 option a (App arm exits without writing): rejected at Plan, see R3; it loses a
  queued gate run under GitHub's pending-run cancellation.
- Job-level concurrency keyed on a `ctx` job's output, so an App-arm `workflow_run` never
  joins the group: rejected, gate jobs would queue in `ctx` completion order rather than
  event order, and a `pull_request` gate reads its PR from the event payload, so an older
  event could write last (a #1973 regression in the App arm).
- Scaffold-time rewrite of the templates (leave this repo's workflows untouched): rejected,
  it breaks the byte-identity the portability test proves (#564) and AC7.
