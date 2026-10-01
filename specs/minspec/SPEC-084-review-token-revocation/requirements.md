---
id: SPEC-084
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness — same epic as SPEC-034 (the review broker) and DR-094 (its one-hour token), which this narrows
aspects: [ci, ai-review, broker, github-app, credentials, revocation, silent-gate, accepted-risk]
depends_on: [SPEC-034, DR-094]
relates_to: [DR-054, DR-066, DR-023, DR-033, SPEC-054, "#2335", "#2314", "#2114", "#1869"]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Revoke the review job's installation token when the run ends (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and
> approves it through the normal spec-approval gate before any code changes.

Materializes **[#2335](https://github.com/AIClarityAU/minspec/issues/2335)** — the
follow-up that [DR-094](../../../docs/decisions/DR-094.md) (one-hour review broker tokens)
promised under `## Follow-ups (tracked)` and never linked (`DR-094.md:122-123`), flagged as
a DR-023 (decisions materialize their follow-ups) leak by the Architect voter on #2314.
It builds on [SPEC-034](../SPEC-034-oidc-review-broker/requirements.md) (the OIDC review
token-broker) and changes none of that spec's approved requirements.

**Tier — T3 (full spec cycle).** The mechanical scope is small: one workflow step, its
byte-exact shipped copy, and one broker property test. It is not T1/T2 because the step
handles a live bearer credential inside the workflow that gates every merge, and that
workflow is scaffolded verbatim into adopter repos
(`packages/minspec/src/lib/ci-review-templates.ts:1-21`).

**Id note.** `SPEC-080` through `SPEC-083` are claimed by other branches in this
checkout's refs (`SPEC-080` by seventeen of them), so this takes `SPEC-084`, the first id
no visible ref uses. Open pull requests are not visible from here; if the id collides at
review time, renumber.

## One-Sentence Scope

Make the job that holds a review installation token revoke it with
`DELETE /installation/token` as its last act on every terminal path, and make every
outcome other than a proven revocation visible, so the one-hour exposure DR-094 accepted
is cut to the run's duration without ever reading as mitigated when it is not.

## Context

### What DR-094 accepted, and what it deferred

SPEC-034's broker returns a GitHub App installation token that GitHub keeps valid for one
hour; no shorter lifetime can be requested (`packages/broker/src/mint.ts:33-51`). DR-094
therefore accepts that *"a broker-minted token is usable for up to an hour after the
workflow that requested it finishes"* (`DR-094.md:78-79`) and names revocation at run end
as *"the option most likely to be right later"*, rejected for slice 1 (happy-path seam)
only as out of scope, with one named trap: *"a revocation that silently fails would leave
the full-hour exposure while reading as mitigated"* (`DR-094.md:104-109`).

### State of the code this spec lands on (read from the checkout, not inferred)

- **The broker path has no consuming workflow yet.** SPEC-034 task 1.4b (workflow broker
  path plus end-to-end observation) is unticked and blocked on a human `wrangler login`
  (#1869) and on a repo that does not hold the App key
  (`specs/minspec/SPEC-034-oidc-review-broker/tasks.md:32`). There is no step today that
  requests an OIDC token or calls the broker.
- **This repo mints natively, never through the broker.** `ai-review.yml:189-195` uses
  `actions/create-github-app-token` (pinned at v1.9.0) with the repo's own App secrets.
  `tasks.md:32` states the consequence: *"This repo cannot exercise the broker path at
  all."* A revocation step that only runs on the broker path would therefore be unexercised
  in this repo's own CI. DQ-3 turns on this.
- **The token is minted first and used last.** The mint is the second step of the `runner`
  job (`ai-review.yml:189`), before the base checkout (`:244`) and before the reviewer
  runs. Its last consumer is the fail-closed backstop, an `if: failure()` step that posts
  `ai-review:changes` as the bot (`:1207-1256`). Two other consumers run under
  `if: always()` (`:828`, `:937`).
- **Runs are cancelled routinely.** `concurrency.cancel-in-progress: true`
  (`ai-review.yml:156-158`) cancels the in-flight review on every new push to the PR, so
  "the run ends" includes cancellation as an ordinary path, not an edge case.
- **The workflow's own token is read-only.** `permissions: contents: read`
  (`ai-review.yml:152-153`). Nothing in the job can post to the PR except the App token.
- **Token freshness in the broker is incidental today.** `createAppAuth` is constructed
  inside `makeInstallationTokenFactory` (`packages/broker/src/app-auth.ts:52`), which the
  handler calls once per request (`packages/broker/src/index.ts:175`). No test asserts that
  two exchanges receive two different tokens. FR-11 explains why revocation makes that
  load-bearing.
- **The workflow file ships to adopters byte-exact.** `ci-review-templates.ts` embeds
  `.github/workflows/ai-review.yml` verbatim and `npm run validate` fails if the embedded
  copy drifts (`ci-review-templates.ts:17-20`).

### Platform facts this spec rests on — and which are not yet observed

This dispatch ran with no network access. The rows below are recalled from GitHub's and the
libraries' documentation, **not observed**, and each is marked so. FR-13 makes observing
them a precondition of building on them (CLAUDE.md, *plausible-inference is not
observation*).

| # | Claim | Status |
|---|---|---|
| P-1 | `DELETE /installation/token` authenticates with the installation token itself and returns `204`; no App key or other credential is needed. | Recalled, unverified here |
| P-2 | It revokes only the token that made the call; other tokens for the same installation keep working. | Recalled, unverified here |
| P-3 | After revocation the token gets `401` on any call, with no meaningful delay. | Recalled, unverified here |
| P-4 | Labels, comments, check-runs and statuses already written with the token persist, still attributed to the bot, after it is revoked. | Recalled, unverified here |
| P-5 | A step with `if: always()` runs when the run is cancelled; it does not run if the runner is lost or the cancellation grace period is exceeded. | Recalled, unverified here |
| P-6 | `actions/create-github-app-token` at the pinned v1.9.0 revokes its token in a post-job step unless `skip-token-revoke` is set, and a failure there is logged as a warning without failing the job. | Recalled, unverified here; the package is not vendored in this checkout |
| P-7 | `@octokit/auth-app` keeps an in-memory installation-token cache per `createAppAuth` instance and returns a cached token for an identical installation, repository and permission set. | Recalled, unverified here; `node_modules/@octokit` is not installed in this checkout |

If P-1 is false the design in this spec does not stand and Clarify must reopen DQ-1. If
P-2 is false, revocation is unsafe to ship at all (one run would end another's token).

## Functional Requirements

"The token" below means the installation token the review job obtained. Under DQ-3's
recommended answer that covers both mint sources; under its alternative, the broker-minted
token only.

- **FR-1 — Revoke on every terminal path.** The job that obtained the token MUST call
  `DELETE /installation/token`, authenticated with that token, on success, on failure, and
  on cancellation. The step runs under `always()`.
- **FR-2 — Last consumer.** The revocation step MUST come after every step that uses the
  token, including the `if: failure()` fail-closed backstop and both `if: always()` posting
  steps. A structural test MUST fail if any step that references the token appears after
  it. Revoking before the backstop would remove the only identity that can post
  `ai-review:changes` on an errored run.
- **FR-3 — Fixed target, credential in a header.** The request MUST go to the
  runner-provided API base (`GITHUB_API_URL`) and to nothing derived from the PR, a repo
  file, a workflow input, or a broker response. The token MUST reach the step through
  `env:`, never through `${{ }}` interpolation into the script text, and MUST travel only
  in the `Authorization` header. A step that sends a bearer credential to a URL an author
  can influence is an exfiltration primitive.
- **FR-4 — One of four outcomes, never a blend.** The step MUST end in exactly one of:
  - `revoked` — per FR-5.
  - `nothing-to-revoke` — the mint step did not succeed, so no token exists. Permitted
    only under FR-7.
  - `expired` — the revocation call was refused as unauthenticated **and** the token's
    stated expiry had already passed. The step MUST say that no reduction was achieved:
    the token lived its full hour.
  - `failed` — everything else, including a network error, a timeout, any unexpected
    status, an unauthenticated refusal *before* the stated expiry, and a probe that still
    succeeds after a `204`.
- **FR-5 — `revoked` is an observation, not a status code.** `revoked` MUST be reported
  only when the revocation call returned `204` **and** a following call with the same
  token was refused as unauthenticated. A `204` followed by a call that still succeeds is
  `failed`.
- **FR-6 — A failure is loud and does not claim mitigation.** On `failed` the step MUST
  exit non-zero, emit an error annotation, and write a job-summary line stating that the
  token was **not** revoked and the latest time it can remain valid. The step MUST NOT
  carry `continue-on-error`, and the revocation call's result MUST NOT be discarded
  (`|| true`, `2>/dev/null` on the load-bearing call, or an unchecked exit code) — the
  shape SPEC-054 (gate signal linter) exists to reject.
- **FR-7 — An empty token is not a skip when the mint succeeded.** If the mint step's
  outcome is success and the step receives an empty token, the outcome is `failed`, not
  `nothing-to-revoke`. Otherwise a renamed step id or output would make every run report
  "nothing to revoke" indefinitely while reading as healthy, which is the exact trap
  DR-094 names.
- **FR-8 — A receipt, and no unconditional claim.** Every run in which the step executed
  MUST leave one job-summary line naming the outcome. The absence of a receipt means
  *not revoked*. No shipped text (workflow comment, scaffolded file, README, DR, spec)
  may state that review tokens "are revoked at run end" without the qualifier that this
  holds only when the step ran and reported `revoked`.
- **FR-9 — Bounded.** Each request has a timeout; retries are limited to transport
  errors, `429`, and `5xx`, never an authentication refusal; and the step has a total time
  budget the Plan sets (a suggested ceiling is 60 seconds). An `always()` step that can
  hang holds the concurrency group and delays the next review.
- **FR-10 — Independent of the checkout.** The token is minted before the base checkout
  (`ai-review.yml:189` against `:244`). The revocation MUST be attempted whenever a token
  exists, including when the checkout failed, so its logic MUST NOT depend on a file from
  the workspace. The Plan chooses how to keep that testable; the existing
  `# >>> backstop-verdict-clear` region markers (`ai-review.yml:1234-1241`) are the
  in-repo precedent for testing inline workflow logic.
- **FR-11 — One exchange, one token (broker).** Each successful broker exchange MUST
  return a token minted for that exchange alone; the Worker MUST NOT serve a token it has
  returned before. A test MUST fail if two exchanges for the same repository can receive
  the same token. Today this holds only because of where `createAppAuth` is constructed
  (`app-auth.ts:52`); if P-7 is right, hoisting that one line to module scope would hand
  two concurrent PR runs in one repository the same token, and the first run to finish
  would revoke the second run's credential mid-flight. Without revocation that is a
  weakness; with it, it is a cross-run failure.
- **FR-12 — The step leaks nothing.** No shell tracing, no verbose client output, no
  logging of request or response headers. The token MUST already be masked in logs when
  the step runs; for a broker-minted token that means the step which receives the broker
  response registers the mask, which belongs to SPEC-034 task 1.4b and is stated here as a
  precondition, not re-specified.
- **FR-13 — Observe before relying.** P-1 through P-5 (and P-6, P-7 where the chosen
  answers depend on them) MUST each be observed against the live platform or the pinned
  package source, and recorded with what was run and what came back, before the code that
  relies on them merges. P-2 is observed with two concurrently valid tokens: revoke one,
  confirm the other still authenticates.
- **FR-14 — Shipped copy stays in step.** The scaffolded `ai-review.yml` adopters receive
  MUST carry the same step; the embedded template is regenerated and the existing
  byte-equality check stays green.
- **FR-15 — Close the traceability leak the issue reports.** The implementing change MUST
  link #2335 and this spec from DR-094's `## Follow-ups (tracked)` entry. DR-094's
  "Accepted risk" wording is narrowed only **after** AC-9's live observation exists, never
  before, and keeps the residual stated in [Residual risk](#residual-risk-stated-plainly).

## Acceptance Criteria

- **AC-1 (FR-1, FR-2)** — a structural test over `ai-review.yml` finds exactly one
  revocation step, conditioned on `always()`, positioned after every step that references
  the token, and fails when a token-using step is moved below it.
- **AC-2 (FR-4, FR-5)** — with the HTTP edge stubbed: `204` then `401` yields `revoked`;
  `204` then `200` yields `failed`; a transport error on every attempt yields `failed`;
  `401` before the stated expiry yields `failed`; `401` after it yields `expired`.
- **AC-3 (FR-6)** — every `failed` case in AC-2 exits non-zero, emits an error annotation,
  and writes a summary line containing "not revoked" and a time; none of them emits the
  word "revoked" unqualified. The step has no `continue-on-error`, and the repo's
  swallowed-gate-signal check passes over it.
- **AC-4 (FR-7)** — mint outcome success with an empty token yields `failed`; mint outcome
  failure or skipped yields `nothing-to-revoke` and exit zero.
- **AC-5 (FR-3, FR-12)** — a test asserts the step's script contains no `${{ }}`
  expression, takes the token from the environment, targets only `GITHUB_API_URL`, and
  enables neither shell tracing nor verbose client output.
- **AC-6 (FR-9)** — with the edge stubbed to hang, the step ends as `failed` inside the
  budget; an authentication refusal is never retried.
- **AC-7 (FR-11)** — a broker test performs two exchanges for the same repository and
  asserts two distinct tokens and two mint calls; it is shown red against a deliberately
  module-scoped `createAppAuth` before it is accepted (a test that cannot fail proves
  nothing).
- **AC-8 (FR-14)** — the template byte-equality check passes with the new step present in
  both the workflow and its embedded copy.
- **AC-9 (FR-1, FR-5, FR-13; live)** — on one real run each of: success, a deliberately
  failed review, and a run cancelled by a superseding push, the job summary reads
  `revoked` and a call made afterwards with that run's token is refused. The verdict
  label's sender is still the bot and `ready-to-merge` is unchanged by the revocation
  (SPEC-034 AC-8 not regressed). The recorded observations for P-1 to P-5 are attached to
  the implementing pull request.
- **AC-10 (FR-8, FR-15)** — DR-094's follow-up entry links #2335; a search of the tree
  finds no unqualified claim that review tokens are revoked.

## Invariants (must not break)

- **INV-1 (constitution 2, no silent gate).** No outcome other than `revoked` may be
  presented as one. An errored or missing witness is reported as not revoked.
- **INV-2 (SPEC-034 FR-5, key custody).** Revocation uses the token itself. Nothing here
  may require the App private key outside the broker's secret store.
- **INV-3 (SPEC-034 FR-6, statelessness).** The broker stores no token and, under DQ-1's
  recommended answer, never receives one back.
- **INV-4 (SPEC-034 FR-9 and AC-8, fail closed and provenance).** A revocation failure
  never produces, upgrades, or preserves a pass that would not otherwise exist, and
  `ai-review-guard.js` is unchanged. By FR-2 the revocation step cannot trigger the
  `failure()` backstop, so it cannot flip a genuine pass to `ai-review:changes` either.
- **INV-5 (least privilege).** The workflow's `permissions:` block gains nothing for this
  step, and the broker's `review` permission profile is unchanged.
- **INV-6 (constitution 3, blast radius).** The step acts only on the token of the repo
  it runs in, and reaches adopters only through the scaffold they opted into.
- **INV-7 (constitution 1, offline).** No network call is added to the MinSpec extension.
  The only new call is from a CI job to the git host it already talks to.
- **INV-8 (DR-094, honest signpost).** Nothing may understate how long a credential can
  remain valid.

## Residual risk, stated plainly

Revocation at run end narrows DR-094's accepted risk; it does not remove it.

- **During the run** the token is as exposed as it is today. Because the mint is the
  second step, "the run's duration" is the whole review, not the few seconds of posting.
- **A step that never runs revokes nothing.** A lost runner or a hard kill leaves the
  token valid for the rest of its hour, and nothing inside the job can report that. The
  failed job is visible; an explicit "token may still be valid" line is not (DQ-5).
- **A same-repo author with write access can edit the workflow in their own pull
  request**, including removing this step for that run. That is the existing trust
  boundary the workflow header already scopes (`ai-review.yml:30-32`): such an author can
  already read the token, so this is not a new exposure.
- **Revocation undoes nothing.** Writes made with a leaked token before revocation stand.

## Decisions needed (Clarify)

### DQ-1 — Who calls GitHub: the job directly, or the broker on the job's behalf?

DR-094 says revocation needs "a revocation endpoint". If P-1 holds, GitHub's own endpoint
is that endpoint and the broker need not be involved.

- **Option A — the job revokes directly (rec).** No broker change, no new route on a
  key-custody service, and the credential makes no extra hop. *Cost:* the broker's
  content-free audit record (SPEC-034 task 5.2) never learns whether a token was revoked,
  so the "legitimate use against post-run use" distinction DR-094 expects from that trail
  cannot be keyed on revocation.
- **Option B — a new broker route receives the token and revokes it.** Gives the vendor a
  revocation record. *Cost:* the broker starts accepting credentials as input, which
  SPEC-034 FR-6 forbids as written and so re-opens an approved, hash-locked spec; adds
  the broker's availability to the revocation path; and is a new endpoint that would
  warrant its own DR.

### DQ-2 — What does a `failed` revocation do to the run and to the merge?

- **Option A — red job, annotation and summary; the verdict stands (rec).** The review of
  the code is no less valid because a credential outlived it. *Cost:* a red
  `ai-review-runner` job beside a green verdict is easy to ignore, and nobody can act on
  it anyway (no one else can revoke that token). Whether `ai-review-runner` is in any
  repo's required-check set is forge configuration this checkout cannot show; where it
  is, this option blocks the merge in effect, and the Plan must check.
- **Option B — Option A plus a PR comment as the bot.** Possible because a token that was
  not revoked usually still works. *Cost:* uses the very credential that should be dead,
  cannot post when the cause is an API outage, and adds a comment on a non-actionable
  event.
- **Option C — withdraw the pass; revocation becomes merge-gating.** Strongest signal.
  *Cost:* a GitHub API blip blocks merges and a code verdict is reversed for a reason
  unrelated to the code.

### DQ-3 — Does the step also cover the natively minted token, or the broker's only?

The issue asks about the broker's token. The step itself does not care where an
installation token came from.

- **Option A — both mint sources, one explicit step (rec).** The native action's own
  post-job revocation is switched off so there is exactly one revocation with one
  classification. This repo's CI then exercises the step on every pull request; under
  Option B it never would (`tasks.md:32`). *Cost:* this widens the issue as filed, which
  is why it is put here and not assumed; it replaces an upstream-maintained behaviour
  with one this repo owns; and it changes this repo's live merge gate before the broker
  path exists, in a machinery pull request that needs a human `--admin` merge.
- **Option B — broker-minted token only.** Matches the issue exactly. *Cost:* the step is
  dead code in this repo until SPEC-034 task 1.4b lands, verified only on a dogfood repo;
  and if P-6 is right, the native path keeps a revocation whose failure is a warning
  nobody reads. Under this option that gap needs its own issue, which this dispatch could
  not file.

### DQ-4 — Is revocation a precondition for the broker path's first outside repo?

- **Option A — yes: it joins SPEC-034 task 6.2 (security review before any customer repo
  authenticates) as a gate (rec).** No adopter ever runs the broker path with the full
  one-hour window. *Cost:* one more item on a path already blocked on two human steps.
- **Option B — follows later.** Unblocks the broker path sooner. *Cost:* the first
  adopters run with DR-094's full accepted risk, and the pre-GA security review assesses
  a design that is about to change.

### DQ-5 — An outside witness for the case where the step never ran?

- **Option A — none; a missing receipt means not revoked (rec).** *Cost:* after a lost
  runner the only signal is the dead job itself; a reader must infer that the token may
  still be valid.
- **Option B — a second job that reports a missing receipt.** Makes that case explicit.
  *Cost:* an extra job on every review in every adopter repo, for an alert nobody can act
  on, since the token cannot be revoked without the token.

## Alternatives considered and rejected

- **Proxy every review write through the Worker.** Already rejected in DR-094 as a much
  larger design; unchanged here.
- **Have the broker remember tokens and revoke them itself.** Breaks SPEC-034 FR-6
  statelessness and creates a store of live credentials next to the App key.
- **A third-party or new composite action for revocation.** A new supply-chain dependency
  holding a bearer credential, for what is one HTTP call.
- **`continue-on-error` so revocation can never red the job.** This is the trap DR-094
  names, built deliberately.
- **Mint late, or mint twice, to shorten the in-run window.** A real further reduction,
  but a different change to the workflow's structure; not asked for by #2335 and left out.

## Why no new DR

The DR-359 filter asks whether the choice costs more than a day to undo. Under the
recommended answers this is one workflow step and one test, reverted in minutes; DR-094
remains the governing record and its decision is unchanged. `docs/decisions/INDEX.md` has
no record on token revocation. If Clarify picks DQ-1 Option B (a credential-accepting route
on the broker), that is a new decision and needs its own record before Plan.

## Out of Scope

- Building SPEC-034 task 1.4b (the broker-calling workflow path). This spec constrains
  where the revocation step sits once that path exists; it does not specify the path.
- The host App-token broker's cached token (#2114) — a different broker.
- Other workflows that mint App tokens (`approve-on-label.yml`, `main-red-watch.yml`).
- Abuse monitoring and broker-side revocation on misuse (SPEC-034 OQ-2, parked).

## Test plan (for the Plan phase to place)

1. AC-1, AC-5: structural assertions over the parsed workflow, in the style of the
   existing `broker-audience-parity.test.ts`, each with a self-check that the detector
   detects.
2. AC-2, AC-3, AC-4, AC-6: the step's logic extracted by region markers and run against a
   stubbed HTTP edge.
3. AC-7: broker test with an injected double, shown red first.
4. AC-9: live observation on a real run; it cannot be a unit test and must not be reported
   as one.

## Traceability

- Issue: #2335 · triggering review: #2314 (DR-094 acceptance)
- Decision: [DR-094](../../../docs/decisions/DR-094.md) · parent identity decision
  [DR-054](../../../docs/decisions/DR-054.md) · no-silent-gate
  [DR-066](../../../docs/decisions/DR-066.md) · follow-up materialization
  [DR-023](../../../docs/decisions/DR-023.md)
- Builds on: [SPEC-034](../SPEC-034-oidc-review-broker/requirements.md) (not edited)
