---
id: SPEC-071
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-071 is T4.)
# status and phases here carry the current phase state. requirements.md stays frozen at its
# approved hash (approval sidecar under .minspec/approvals/), so its own phases lag. This file
# has no approval record of its own: these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
relates_to: [DR-066, DR-074, DR-050, DR-063, DR-090, DR-112, SPEC-054, "#1782", "#3249", "#3433"]
phases:
  specify: done
  clarify: done
  plan: in-progress  # the own-repo landing is planned; the scaffold landing waits on DQ-7's record
  tasks: done
  implement: pending
---

# SPEC-071 - Design: a shipped gate must prove it is still a required check

Plan for [requirements.md](requirements.md). Citations of "today" are against `origin/main`
`ef84097b`, the commit this plan was written on. Nothing is built: all three `implements:` files
are absent, and no merged pull request builds them (build request #3249 is open and parked).
New code is cited by symbol, because its line numbers will move.

The plan has two landings. The **own-repo landing** puts the witness on `AIClarityAU/minspec`
and needs no new decision. The **scaffold landing** ships it to adopter repos and needs its own
decision record first (DQ-7 below), so it does not start until that exists.

## Decisions

Each entry was **chosen by the planning agent on its recommendation; not a founder decision.**
Requirements.md records these questions with recommendations and no recorded selection, so they
are answered here. Each can be undone in under a day: only DQ-5's ruleset write touches live
state, and the founder can reverse it the same day. None contradicts an approved sentence. The scaffold half of DQ-4, DQ-5 and DQ-7 is **not** decided here; see "Left
for the founder".

- **DQ-1, witness shape: (A) a witness workflow.** A scheduled and per-`pull_request` job. It is
  the only option that sees an unattended repo, and #1782's write came from an issue body that
  no repo lint can reach. *Rejected:* (B) the extension as witness, which fires only when someone
  opens the editor (it stays a possible later addition, with no task here); (C) hardening the
  advisor alone, which could not have caught this incident.
- **DQ-2, endpoint: `GET /repos/{owner}/{repo}/rules/branches/{branch}`; no new App permission.**
  Probed live with the App token on 2026-10-31: HTTP 200, response header
  `x-accepted-github-permissions: metadata=read`, one `required_status_checks` rule from ruleset
  18352261 listing `lint`, `test`, `MinSpec SDD validation`, `ai-review`, `ready-to-merge`,
  `build`. This resolves the spec's "unverified" belief. It answers what gates the branch, with
  no selection loop to re-implement. *Rejected:* `GET .../rulesets`, which is SPEC-054's route
  and carries its accepted drift risk (its design's R6); agreement between two different read
  paths is also worth more than one path read twice. Unproven until first CI run: that the
  job's `github.token` behaves as the App token did. A 403 there is reported, never answered by
  widening permissions in the same run.
- **DQ-3, whose manifest: extend SPEC-054's `scripts/lib/gate-manifest.ts`, and sequence behind
  it.** One declaration, as FR-1 and INV-5 demand. The spec's stated cost has shrunk since it was
  written: SPEC-054 now has merged tasks, its manifest task is open as #3433 (conflicting at this
  commit, needs a rebase) and its types are exported for this purpose. *Rejected:* a second,
  narrower declaration owned here, which ships sooner and creates the duplicate source of truth
  FR-1 forbids. Accepted cost: groups 2 to 4 wait on SPEC-054; group 1 (FR-9) does not.
- **DQ-4, rollout (own-repo half): this repo first, as a separate landing.** The first run proves
  the read, the token and the freshness window where a mistake costs only this repo. *Rejected:*
  every `.minspec/` repo from day one, which ships an unproven gate into other people's merge
  paths. Accepted cost: the other four managed repos, memory-fabric included, stay unwatched in
  the gap.
- **DQ-5, required status (own-repo half): required in this repo.** A witness that can itself
  be demoted silently reproduces the defect, and FR-6 needs it on the required list to pass.
  *Rejected:* advisory here, which makes FR-6 permanently red or forces an exemption.
  The founder performs the write (task 4.1), because the App has no administration write and
  INV-4 keeps this feature from writing a ruleset.
- **DQ-6, separate spec or fold: separate.** SPEC-054 is hash-locked and scoped this watcher out
  on purpose. *Rejected:* folding, which stales that signature. The seam is the manifest (DQ-3)
  and the shared self-membership rule (design decision D-3).
- **DQ-7, own-repo half: no DR needed for the own-repo landing.** Recorded so the absence is a
  decision. The spec's condition is DQ-1 (A) and either scaffolding or a new App permission; the
  own-repo landing does neither (DQ-2 measured no new permission; `actions: read` below is a
  job-token scope, not an App grant). *Rejected:* a DR now covering both landings, which spends
  a founder acceptance on a landing that does not need it.

The design choices below are not spec questions, and carry the same wording: chosen by the
planning agent on its recommendation; not a founder decision.

- **D-1, one workflow file with two jobs.** `implements:` names one file, and adding a second
  would stale the approval. Each lane has its own trigger and its own job, and neither `needs:`
  the other. Disabling the whole file is covered another way: `required-check-drift` is required,
  so no report leaves every pull request visibly waiting. *Rejected:* a lane inside `ci.yml`,
  which puts the witness in the file most often edited and a failure of `ci.yml`'s own setup
  would take both down; a second workflow file, for the stale above.
- **D-2, hourly cron, 24-hour freshness window, set from measurement.** GitHub's schedule is far
  looser than its cron text on this repo. Measured 2026-10-31 over the last 100 runs of each:
  `ai-review-retry.yml` (`17 * * * *`) fired about every 4 to 7 hours, longest gap 9.5 hours over
  20 days; `supply-chain-daily.yml` (`0 6 * * *`) fired 4 to 6 hours late, longest gap 34.6 hours.
  So: cron hourly, window 24 hours, about 2.5 times the longest measured gap. *Rejected:* daily
  cron, whose gap needs a window near 48 hours and leaves drift unseen for days. Twenty days is
  a short sample; the window is one constant, so widening it is a one-line change.
- **D-3, FR-6 shares SPEC-054's rule.** FR-6 requires one statement of the property. The checker
  imports `evaluateWitnesses` from `scripts/audit-gate-witnesses.ts` and keeps only its
  `not a required context` findings, passing its own context as `self`. It does not edit that
  file, which SPEC-054 owns. The "own name is in the declaration" half is new and lives here.
  *Rejected:* a third copy of the comparison in the checker, which is the divergence FR-6 names.
- **D-4, a manifest entry not on the required list is a finding here, a notice in SPEC-054.** The
  two directions are complementary. SPEC-054 asks whether every required context has witnesses;
  this spec asks whether every shipped context is still required. *Rejected:* a new manifest
  field, which SPEC-054's design leaves to this spec and which nothing needs yet.
- **D-5, checker tests get their own file.** `packages/minspec/tests/check-required-checks.test.ts`
  is outside `implements:`, which approval froze as the three files above. The union test named
  there stays FR-9's only. *Rejected:* packing the checker's tests into a file named for the union
  property, which misleads the next reader.
- **D-6, the alert uses `github.token`, not the App.** `issues: write` on the watch job only, the
  pattern `supply-chain-daily.yml` already uses. An expired App secret must not silence the alarm.
  *Rejected:* the App token that `main-red-watch.yml` mints, which adds a credential dependency
  to the one path that must survive failures.

## Left for the founder

Neither item blocks groups 1 to 4.

- **The scaffold landing's decision record (DQ-7, with the scaffold halves of DQ-4 and DQ-5).**
  Requirements.md requires a DR when DQ-1 is (A) and a scaffold ships; shipping a gate into other
  repos cannot be undone in under a day. Options: (a) **recommended:** land the own-repo witness
  first, then draft a proposed DR (task 5.1) carrying its evidence for the founder to accept;
  *cost:* four managed repos stay unwatched until then. (b) Accept a DR before any build; *cost:*
  it asks for a decision without the first real run. (c) Never scaffold; *cost:* memory-fabric,
  the repo that actually drifted, is never watched. The DR also settles whether adopters get
  advisory-but-loud (the spec's recommendation), and that asymmetry must be documented at the
  scaffold site. Group 5 stays blocked until it is accepted, and memory-fabric's standing hold
  applies on top.

## Components

| File | Owner | Role |
|---|---|---|
| `scripts/check-required-checks.ts` | this spec | Pure parse and evaluate, injected read, IO entry (FR-2, 3, 5, 6, 7, 8) |
| `.github/workflows/required-check-drift.yml` | this spec | The two lanes (FR-4) |
| `packages/minspec/tests/ruleset-union-property.test.ts` | this spec | FR-9 |
| `packages/minspec/tests/check-required-checks.test.ts` | D-5 | Checker and workflow-shape tests |
| `scripts/lib/gate-manifest.ts` | SPEC-054 (affected here) | The expected set; gains one entry |
| `packages/minspec/src/lib/ruleset-advisor.ts` | none (affected here) | FR-9's seed comment |

## The check

**Expected.** Every `context` in `GATE_MANIFEST`, never a default constant (INV-5). The manifest
is this repo's declaration. Each entry already binds its context to a workflow and job, which is
FR-1's binding. How an adopter declares its own set is for the scaffold DR, because that file does
not ship today.

**Actual.** `gh api repos/{repo}` for `default_branch`, then `gh api
repos/{repo}/rules/branches/{default_branch}`, both through an injected `CommandRunner`, so every
branch is tested offline. `{repo}` comes from `GITHUB_REPOSITORY` only, with no `--repo` flag, which
is how FR-8 holds. A failed or unparseable first read is case (a) or (c), never a guessed `main`. Contexts are unioned
across every `required_status_checks` rule. The rule's `ruleset_id` and `ruleset_source` are kept
for FR-7. The endpoint returns no ruleset version, so none is printed.

The checker must not import `listRequiredCheckContexts` (FR-3). `readRequiredChecks` in
`scripts/alta-self-merge.ts` reads the same endpoint but throws one error class for empty and
unreadable, so it is not reused either.

**Outcomes.** Each message is distinct. Exit 2 is could-not-run; exit 1 is a finding.

| FR-3 case | Trigger | Exit |
|---|---|---|
| (a) read failure | `gh` non-zero, no 403/404 in stderr | 2 |
| (b) permission | `gh` non-zero, stderr holds `HTTP 403` or `HTTP 404`; says it may be permission, visibility or rate limit | 2 |
| (c) unparseable | stdout not JSON, not an array, or a malformed rule | 2 |
| (d) zero required | Parsed cleanly with no contexts; `200 []` lands here | 1 |
| (e) drift | A manifest context absent from the list | 1 |
| FR-5 stale | No success within the window, or none at all (`unknown-and-failing`) | 1 |
| FR-6 self | Own context missing from the manifest or the list | 1 |

A failed runs read for FR-5 is case (a), never "stale" and never clean.

**Lane modes.** `--lane=per-change` runs the drift, self and freshness checks. `--lane=out-of-band`
runs drift and self only. Without this split the scheduled job would assert its own freshness: one
missed window would fail it, and a failing job can never record the success that clears the
window. No flag is exit 2, so no default lane can hide the freshness check.

**Freshness read.** `actions/workflows/required-check-drift.yml/runs` with `status=success` and
the default branch, once for `event=schedule` and once for `event=workflow_dispatch`; the newest
`updated_at` counts. Measured on a sibling workflow: `actions=read`. Pull-request runs share this
workflow file, so the event filter is load-bearing. Counting `workflow_dispatch` gives a recovery
path that needs no founder: the App has held `actions: write` since 2026-08-07 (re-runs verified;
dispatch itself is unverified, and task 4.2 is its first use).

**Finding text (FR-7).** Missing contexts, the observed list verbatim, the expected list and
`scripts/lib/gate-manifest.ts` as its source, the ruleset id and source, then: "Nothing was
repaired. Add the context through the union path (`updateRulesetRequiredChecks`), never a
hand-written PUT."

## The workflow

Triggers: `pull_request`, `schedule` (hourly), `workflow_dispatch`. No `paths:` filter, because a
required check behind one waits forever. Top-level `permissions: contents: read, actions: read`.
Actions SHA-pinned as `ai-review.yml` does. No `continue-on-error`, no `|| true` on any path (INV-1).

- **`required-check-drift`** (job id and name; this is the required context). Only on
  `pull_request`. Runs `npm ci`, then `npm run audit:required-checks -- --lane=per-change`. Its alarm is the failed
  check on the change itself.
- **`required-check-drift-watch`.** Only on `schedule` and `workflow_dispatch`, plus
  `issues: write`. Runs the same with `--lane=out-of-band`. On failure, a step under `if: failure()` files or
  comments on one open issue with a fixed title, label `inbox`, body from a file. If that step
  fails too, the run is already red. Its alarm reaches someone with no pull request open. It never
  closes the issue: that would be a self-healing silence.

Lane independence (FR-4): remove either trigger and the other job still runs and fails on drift.
The test proves it from the workflow shape (separate `if:`, no `needs:`) plus both modes exiting 1
on the #1782 fixture. No live ruleset is mutated to demonstrate it (INV-4).

## Landing order

The workflow cannot land first, and neither can the ruleset entry; the order is the same as
SPEC-054's group 5 and 6, and for the same reason.

1. **SPEC-054 task 1.2, then 3.3,** give this checker its manifest and shared rule.
2. **SPEC-054 task 6.1 before task 3.1 here.** `GATE_MANIFEST` carries `gate-witnesses`, which is
   not required until that task runs, and this check would correctly report it as drift on every
   pull request.
3. **Machinery pull request (group 3).** `.github/` and `scripts/` match the machinery path rule
   (`ai-review-guard.js`, the machinery-path regex), and the App has no `workflows` scope, so the
   founder pushes this one. It is red on `required-check-drift` until step 4: expected, and
   not blocking, since it is not yet required.
4. **Founder adds the context (task 4.1),** then the agent dispatches the watch job (task 4.2) so
   a first success exists. Adding it earlier would block every open pull request on a job their
   base lacks. Until the next push, already-open pull requests show it as "Expected", the normal
   cost of any new required context.

Groups 1 and 2 land independently of that. Group 2 changes `scripts/`, so it takes the machinery
route too, without a founder push: the bot can merge those under DR-112 (bot merges of machinery
pull requests).

## Invariants, and where each is held

- **INV-1** The verdict path has no swallowed result; a test greps the workflow and checker.
- **INV-2 / FR-8** No `--repo`; a fake runner asserts every call starts `repos/{GITHUB_REPOSITORY}/`.
- **INV-3** Nothing here lands in the extension's runtime path; the one advisor edit is a comment.
- **INV-4** No write verb anywhere in the checker; a test asserts every call is a read.
- **INV-5** Expected comes from `GATE_MANIFEST`; a test asserts the checker never imports
  `DEFAULT_REQUIRED_CHECK_CONTEXTS`.
- **INV-6** No new App permission (DQ-2).

## Risks

| # | Risk | Handling |
|---|---|---|
| R1 | Actions cron slips past 24 hours and every merge blocks on a required check. | Accepted, since fail-closed is the requirement. Recovery is a bot dispatch; widening is one constant. |
| R2 | The per-change lane runs the pull request's own manifest, so a pull request dropping an entry passes itself. | `scripts/` changes take the machinery route, so that edit never self-merges, and the watch lane then reads it from `main`. Accepted, visible in the diff. |
| R3 | A GitHub API outage reds every merge with no sanctioned escape. | Same accepted cost as SPEC-054's DQ-4. |
| R4 | The endpoint may hide or include a ruleset in `evaluate` mode. Its docs say "active" rules; not probed, and I believe that mode needs a higher plan (unverified). If included, a demotion to evaluate would go unseen. | Not fixable offline. A live probe belongs in a repo with that mode available. |
| R5 | The endpoint does not report classic branch protection, as far as I know (unverified), so a classic-protected adopter reads as zero required. | Harmless here, since minspec uses rulesets. Task 5.3 words that message and the DR weighs it. |
| R6 | The alert lands in `inbox`, and the founder does not triage issues. | The runner reads that queue. The red run is the second signal. |
| R7 | A rate-limit 403 is reported as (b). | The message names all three causes rather than claim one. |

## Rejected alternatives (DR-086 section 4)

Each decision above names its own. Additionally rejected: having the checker also read
`integration_id` pins and approval counts, which requirements.md puts out of scope; and re-using
`main-red-watch.yml` as the out-of-band lane, whose header says it is never a gate and which fires
only on another workflow's failure.

## Follow-ups (tracked)

- Scaffold landing: group 5 of [tasks.md](tasks.md), behind its DR.
- Memory-fabric's ruleset repair: out of scope per requirements.md, tracked there on #1782.
- Extension surface (DQ-1 option B): no task. Promote only if the workflow proves insufficient.
