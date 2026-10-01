---
id: SPEC-094
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time dispatch pipeline lives here; EPIC-009 (Team Readiness) lists #3 as "related, stays in its home epic" (docs/epics/EPIC-009-team-readiness.md:58-64)
aspects: [agent-dispatch, ci, github-actions, credential-separation, no-silent-gate, blast-radius, team]
relates_to: [DR-008, DR-015, DR-033, DR-044, DR-052, DR-075, DR-076, DR-082, SPEC-019, SPEC-034, SPEC-044, SPEC-074, "#3", "#251"]
# Ownership declared in Specify, before any approval mints a hash (SPEC-038 FR-1/FR-2).
# All three files are NEW. They exist only if DQ-1 resolves to "build"; under the recommended
# "park" nothing is created and this list is the claim the build would start from.
implements: [.github/workflows/agent-triage.yml, .github/workflows/agent-dispatch.yml, packages/minspec/tests/ci-dispatch-lane.test.ts]
# Modified, never owned. dispatch-issue.sh is owned by SPEC-044 and SPEC-073 through their
# `implements:` lines; the other three are claimed by no spec today (grepped `^implements:`
# across specs/**/requirements.md) and stay unowned rather than being claimed by this one.
affects: [scripts/dispatch-issue.sh, scripts/triage-inbox.sh, scripts/dispatch-ready-check.sh, scripts/lib/gh-bot.sh]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-094: A CI lane for agent triage and dispatch (GitHub Actions)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this document: no
> workflow, script, or test. A human reads it, answers the questions under
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before anything is built from it. The requirements are written
> under each decision's recommended option. No option has been selected on the human's
> behalf.
>
> **Read DQ-1 first.** Its recommendation is to leave this spec unapproved and the work
> parked. The rest of the document is the design that would be built if that changes.

Materializes **[#3](https://github.com/AIClarityAU/minspec/issues/3)** - *"CI-based agent
dispatch for teams (GitHub Actions)"*.

## One-Sentence Scope

Let triage and dispatch of a GitHub issue run in a GitHub Actions runner instead of on one
developer's machine, as a second lane over the existing dispatcher's gates, with the agent
that executes code separated from every credential that can write to GitHub.

## Context

### What exists today

Dispatch is local. `scripts/triage-inbox.sh` runs a triage agent that emits a verdict and
nothing else; the parent script feeds the verdict through the pure gate
`scripts/triage-decide.sh` and applies labels itself (`scripts/triage-inbox.sh:14-19`).
`scripts/dispatch-issue.sh` re-checks readiness, claims the issue, launches `claude -p` in a
worktree, and publishes after the agent exits. The pieces this spec reuses:

| Piece | Where | What it guarantees |
|---|---|---|
| Verdict record | `scripts/dispatch-ready-check.sh:1-56`, `:432` | A label never authorises dispatch. A body-hash-bound record from a trusted author does, and the gate prints which mode it authorised: `ready` (full build) or `ready-specify` (write the spec, then stop) (`:132-137`). |
| Agent tool allowlist | `scripts/dispatch-issue.sh:883` | File tools, fixed `npm` subcommands, local-only git. No `gh`, no `git push`. |
| Claim before work | `scripts/dispatch-issue.sh:635` (`lease_acquire`), SPEC-044 FR-1 to FR-3 | One owner per issue, with the pull-request-per-branch rule as the hard backstop. |
| Egress scan | `scripts/dispatch-issue.sh:1154` (`agent_egress_scan`) | The parent scans the agent's commits before publishing and quarantines on a hit. |
| Specify-only scope guard | `scripts/dispatch-issue.sh:1203` | A spec-only dispatch that commits an out-of-corpus path publishes nothing. |
| Bot identity | `scripts/lib/gh-bot.sh:1-40`, DR-082 | Agent writes carry the App's identity; the token is minted lazily on the first write. |

One CI workflow already runs Claude: `.github/workflows/ai-review.yml`. It installs the
genuine CLI at an exact version (`:261`), pins every third-party action to a full commit SHA
(`:192`, `:244`, `:251`), and keeps the App token out of the step that runs the model
(`:59-66`). That separation is sufficient there because the review agent holds read-only
tools and so has nothing that can use a credential. A build agent runs the project's own
tests, which is arbitrary code, so the same step-level separation is not sufficient for it
(DR-008 Context: "a tool allowlist cannot sandbox a dev agent").

### What the issue asks for, and where it meets decisions already in force

The issue asks for two workflows (`agent-triage.yml`, `agent-dispatch.yml`), self-hosted
runner support, and `anthropics/claude-code-action@v1` with API tokens, for teams. Four
accepted decisions bear on that, and each one is put to the human below rather than
resolved here.

| The issue says | In-force decision | Consequence | Decision |
|---|---|---|---|
| "Teams need CI-based dispatch" | DR-075 §4: "Team mode is parked, not deleted... no team is asking." DR-076 (`:97-98`, `:142-143`) parks the `mode: solo \| team` profile itself. The constitution removes team mode from Phase 2 (Public-ready - polish) (`.minspec/constitution.md:100-110`). | There is no team to build this for, and no profile to put it behind. | DQ-1 |
| A feature teams adopt | DR-015, as amended by DR-044: productized dispatch ships as a separate extension (SealBox, its own repository), never inside MinSpec; `scripts/` stays the dev-time path. DR-075 §2: "Sealbox stays shelved". | A workflow in this repository is dev-time tooling for this repository. Shipping it to adopters would put dispatch inside MinSpec. | DQ-2 |
| Run the agent in a CI runner | DR-008 Layer 2 (the isolation boundary required before unattended dispatch): no host credentials, egress denied by default, the branch leaves as a bundle, a credentialed process publishes it. DR-033 relaxes this only for "trusted, self-authored issues" at dev time. SPEC-019 lists a "remote/cloud sandbox substrate" as out of scope because it "reintroduces network + a credential-handoff surface". | With a team, issues are no longer self-authored, so DR-033's relaxation does not obviously apply and Layer 2 is the bar as written. | DQ-3 |
| `claude-code-action@v1` with API tokens | DR-008 Layer 1 (defence in depth, applied today): "credentialed and network operations removed from the agent entirely". DR-052 §5: never the Agent SDK with a subscription token; §6: one subscription shared by many users is out. | The dispatcher's gates live in `scripts/`. A packaged action is a second dispatcher that does not run them. | DQ-4 |

### What changes when the runner is not the developer's machine

1. **An issue event runs with secrets no matter who opened the issue.** This repository is
   public (`scripts/dispatch-ready-check.sh:39`). A workflow triggered by an issue event
   runs the default branch's workflow file with the repository's secrets, so a stranger
   opening an issue would start a credentialed run. The trigger therefore cannot be the
   authority (FR-4, FR-5). *(Platform behaviour, believed and not verified from this offline
   dispatch - see [Platform assumptions](#platform-assumptions-unverified).)*
2. **Steps in one job share a filesystem and a process space.** An agent that runs code can
   rewrite a script a later step in the same job executes, so the build agent and the
   publish step cannot share a job (FR-6).
3. **The inference credential sits where the agent runs.** The CLI needs it. Code the agent
   runs can read it, and a hosted runner's network is open by default. This is the one
   exposure the job split does not remove (FR-8, DQ-3).
4. **No machine is watching.** Locally a stalled drain is at least on someone's screen. In
   CI a run that never starts produces nothing at all, which is the shape constitution
   invariant 2 (no silent gate) forbids (FR-18, FR-19).

## Design

Two workflows. Triage keeps the shape `ai-review.yml` already uses, because the triage agent
holds read-only tools. Dispatch is split into three jobs so that no job both runs
agent-influenced code and holds a GitHub write credential.

```
agent-dispatch.yml

  gate job (credentialed, runs no agent)
    lane on?  ->  dispatch-ready-check  ->  claim the issue  ->  emit ticket
        |
        v   ticket passed as a job output, never through an artifact
  agent job (one secret: the inference credential; no GitHub write token)
    checkout base SHA -> install deps -> close the boundary -> claude -p -> upload handoff
        |
        v   handoff artifact = DATA
  publish job (credentialed, executes nothing the agent wrote)
    fresh checkout of base -> verify bundle -> scope guard -> egress scan -> push -> open PR
    -> write the outcome on the issue -> release the claim
```

### Contracts

Type shapes only. Field names are fixed by this spec; serialisation is a Plan-phase choice.

```ts
/** Emitted by the gate job as a job output. The publish job reads THIS copy. */
interface DispatchTicket {
  schema: 1;
  issue: number;
  mode: 'ready' | 'ready-specify';   // verbatim stdout of dispatch-ready-check.sh
  role: 'dev' | 'architect' | 'security' | 'reviewer';
  baseSha: string;                    // full 40-character SHA of the base branch at claim time
  branch: string;                     // always `agent/issue-<issue>`
  claimId: string;                    // the SPEC-044 claim this run holds
  runUrl: string;                     // the workflow run, for the audit trail
}

/** Uploaded by the agent job. Every field is untrusted. */
interface AgentHandoff {
  schema: 1;
  issue: number;                      // compared against the ticket; a mismatch refuses
  outcome: 'committed' | 'no-commit' | 'escalated' | 'quota' | 'crashed';
  bundle: string | null;              // git bundle holding exactly one ref, or null
  bundleSha256: string | null;
  summaryFile: string | null;         // .agent-summary.md, rendered as text, never executed
  signalsFile: string | null;         // .review-signals.json
  cliExitCode: number;
  quotaNoticeLines: string[];         // empty unless outcome is 'quota' (SPEC-074 FR-2)
}
```

Lane configuration, all repository-level, none committed:

| Name | Kind | Meaning | Default |
|---|---|---|---|
| `MINSPEC_CI_DISPATCH` | variable | `on` enables the lane. Any other value, or absence, disables it. | absent (off) |
| `MINSPEC_CI_DISPATCH_AUTH` | variable | `api-key` or `subscription` (FR-14). | none; the lane refuses to run unset |
| `MINSPEC_CI_DISPATCH_MAX_PER_DAY` | variable | Daily cap on agent jobs (FR-17). | Plan phase sets it |
| `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` | secret | The inference credential. Exactly one reaches the agent job. | - |
| `MINSPEC_APP_ID`, `MINSPEC_APP_PRIVATE_KEY` | secret | The App identity, as `ai-review.yml:176-177` uses it. Never reaches the agent job. | - |

## Functional Requirements

### The lane and its opt-in

- **FR-1 (off unless opted in).** Every job in both workflows first checks that
  `MINSPEC_CI_DISPATCH` is `on` and that `.minspec/` exists at the repository root
  (constitution invariant 3 names it as the opt-in marker). If either is false, no agent is
  launched, no label or comment is written, and the run summary says the lane is off.
- **FR-2 (one dispatcher, two lanes).** The CI lane calls the same gate code as the local
  lane: `triage-decide.sh`, `dispatch-ready-check.sh`, the SPEC-044 claim, the specify-only
  scope guard and the egress scan. No gate's logic is restated in workflow YAML. Where a
  script assumes the local lane (for example `REPO` and `WORKTREE_BASE` are literals at
  `scripts/dispatch-issue.sh:22-23`), the script gains a parameter; it is not forked.
- **FR-3 (triggers).** Triage runs on `issues` events (`opened`, and `labeled` with `inbox`)
  and on `workflow_dispatch`. Dispatch runs on `issues` `labeled` with `agent-ready` or
  `agent-ready-specify`, on `workflow_dispatch` with an issue number, and on a `schedule`
  (FR-19). Neither workflow uses `pull_request_target` or `issue_comment` as a trigger.
- **FR-4 (the trigger wakes the lane; it authorises nothing).** The gate job runs
  `dispatch-ready-check.sh` against the issue's current state and proceeds only on exit 0,
  passing the printed mode into the ticket verbatim. A `not-ready` result ends the run with
  the gate's own one-line reason in the run summary.
- **FR-5 (who can cause an agent to run).** The triage agent is launched only when the
  issue's author association is `OWNER`, `MEMBER` or `COLLABORATOR`, or when the `inbox`
  label was applied by an actor with one of those associations. This is the same boundary
  `dispatch-ready-check.sh --trusted-comment-bodies` draws (`:432`). For any other issue the
  lane launches nothing and writes nothing to the issue.

### Credential separation

- **FR-6 (three jobs, two kinds of trust).** Dispatch runs as the gate, agent and publish
  jobs shown under Design. The gate and publish jobs hold the App token and execute only
  files from the base branch. The agent job executes agent-influenced code and holds no
  credential that can write to GitHub.
- **FR-7 (the agent job holds one secret).** The agent job's environment contains the
  inference credential selected by FR-14 and no other secret. It declares no `id-token`
  permission and no write permission, checks out without persisting a git credential, and
  is not given the App id or key.
- **FR-8 (the isolation boundary - under DQ-3's recommended option).** Inside the agent job,
  the agent and everything it spawns run in an unprivileged container whose network egress
  is limited to the inference endpoint. Dependencies are installed from the base commit's
  lockfile before the boundary closes. Before the agent starts, a probe proves both that a
  destination outside the allowlist is refused and that the inference endpoint is reachable;
  if either half fails the job fails red and no agent runs (SPEC-019 FR-7: a dead probe is
  never read as "secure").
- **FR-9 (the handoff is a bundle plus a manifest).** The agent job uploads one artifact
  holding the `AgentHandoff` manifest, the bundle, and the two report files. It pushes
  nothing and calls no GitHub API.
- **FR-10 (the publish job treats the handoff as data).** The publish job checks out the
  base branch fresh and takes its scripts from there. It takes the ticket from the gate
  job's output, never from the artifact. Before it pushes, it verifies that the bundle's
  checksum matches the manifest, that the bundle holds exactly one ref and that ref is the
  ticket's branch, that every new commit descends from the ticket's `baseSha`, and that the
  bundle is under a size cap. It fetches with git hooks disabled and runs no `npm`, `node`
  or shell file from the agent's tree. It then runs the egress scan, and in `ready-specify`
  mode the scope guard, and publishes only if both pass.
- **FR-11 (bot identity, and why chaining depends on it).** Every label, comment, push and
  pull request is written with the App installation token (DR-082), minted in the gate and
  publish jobs only. The triage workflow applies `agent-ready` with that token, not with the
  workflow's built-in token, because the dispatch workflow must be woken by that label
  event (see Platform assumptions, row 2).
- **FR-12 (workflow files are refused).** A bundle whose diff touches `.github/workflows/`
  is not pushed. The issue receives `needs-human-review` and a comment naming the paths.
  This is unconditional in the CI lane, where the local lane probes the App's permission
  (`scripts/lib/workflow-paths.sh:1-20`): a lane that can rewrite the workflow that runs it
  has no boundary.

### Tier gating and inference

- **FR-13 (the mode is honoured, never widened).** A `ready-specify` ticket yields the
  spec-only prompt and the scope guard. A `ready` ticket yields the full build. Nothing in
  the CI lane can turn the first into the second. Building from a T3 (full spec cycle) or T4
  (complete ceremony) spec still waits on the human's spec approval, exactly as locally.
- **FR-14 (genuine CLI, pinned, with a declared billing mode - under DQ-4's recommended
  option).** The agent job installs the genuine `claude` CLI at an exact version and runs
  `claude -p` with the allowlist at `scripts/dispatch-issue.sh:883`. Every third-party
  action is pinned to a full commit SHA. `MINSPEC_CI_DISPATCH_AUTH` selects the credential:
  `api-key` passes `ANTHROPIC_API_KEY`; `subscription` passes `CLAUDE_CODE_OAUTH_TOKEN` and
  is permitted only where one person's issues are dispatched on that person's own
  subscription (DR-052 §2 and §6). The lane cannot verify whose subscription a token belongs
  to, so that condition is an operator obligation stated in the workflow header, not a gate.
- **FR-15 (the triage workflow).** The triage agent runs with read-only tools in a step that
  holds no write credential, as `ai-review.yml:59-66` does for review. A later step runs
  `triage-decide.sh` on its output and applies the result. The verdict record is posted
  before the labels, preserving the ordering `scripts/triage-inbox.sh:31-35` requires.

### Coordination

- **FR-16 (claim first, and stay claimed).** The gate job performs the SPEC-044
  check-then-claim before the agent job starts, recording the workflow run as the owner. The
  claim stays live for the whole agent job without any credential in that job. Plan chooses
  the mechanism (a claim lifetime sized to the job timeout, or a separate credentialed
  heartbeat job). The dispatch workflow also sets a `concurrency` group keyed by issue
  number that queues rather than cancels.
- **FR-17 (caps).** The lane enforces a maximum number of concurrent agent jobs (default
  one), a per-job timeout, and a daily cap on agent jobs. Reaching a cap leaves the issue's
  labels untouched and is reported in the run summary; the scheduled run (FR-19) picks the
  issue up later. A money cap in `api-key` mode is set at the provider and is outside what
  the lane can measure; the workflow header says so.

### Visible outcomes (constitution invariant 2)

- **FR-18 (every terminal state is written on the issue).** A run that passed the gate ends
  in exactly one of: a pull request link; the SPEC-074 quota label and comment; the
  escalation labels the local lane uses; `agent-quarantined`; or a crash comment with the
  run link. The step that writes the outcome carries no swallowed error: if the write fails,
  the job fails red. If the publish job itself never starts or dies, the claim expires and
  FR-19 reports the issue.
- **FR-19 (a second witness for a missed wake).** The scheduled dispatch run lists open
  issues that carry a ready label, pass `dispatch-ready-check.sh`, and have neither a live
  claim nor an open pull request. Within the caps it dispatches them; beyond the caps it
  lists them in its run summary. A missing or unusable credential fails this run red rather
  than skipping.
- **FR-20 (audit trail).** The claim comment and the pull request body each carry the
  workflow run link, mode, role, model id, CLI version and base SHA. The agent's transcript
  is uploaded only after the inference credential's literal value and any `sk-ant-` string
  have been redacted from it.

### Boundaries of the lane

- **FR-21 (hosted runners only - under DQ-5's recommended option).** Every job runs on a
  GitHub-hosted runner. `runs-on` is a literal, not a variable.
- **FR-22 (dev-time only - under DQ-2's recommended option).** The two workflows are not
  added to `SOURCES` in `scripts/gen-ci-templates.mjs`, are not embedded in the extension,
  and are not scaffolded into any other repository.
- **FR-23 (the lane does not merge).** Auto-merge arming, review, and merge ordering are
  unchanged and belong to the existing gates and to SPEC-044 FR-4b's single driver.

## Acceptance Criteria

Each is a behavioural check unless it says otherwise. A source-text assertion over workflow
YAML is acceptable only where the criterion says "pinned".

- **AC-1.** With `MINSPEC_CI_DISPATCH` unset, a label event produces no agent launch, no
  label write and no comment, and the run summary states the lane is off. (FR-1)
- **AC-2.** An `agent-ready` label with no verdict record behind it produces no agent job;
  the gate's `not-ready` line appears in the run summary. (FR-4)
- **AC-3.** An issue opened by an author with no association produces no triage agent launch
  and no write to the issue. (FR-5)
- **AC-4.** The agent job's resolved environment contains exactly one secret and no App
  credential; a fixture that adds a second secret to that job fails the test. (FR-7)
- **AC-5.** Inside the boundary, a request to a host off the allowlist fails and a request
  to the inference endpoint succeeds; with the allowlist removed, the probe fails the job
  before any agent runs. (FR-8)
- **AC-6.** A handoff whose bundle contains a second ref, a commit not descended from
  `baseSha`, a checksum mismatch, or an `issue` that differs from the ticket is refused,
  each case separately, with nothing pushed. (FR-10)
- **AC-7.** A handoff whose tree contains a git hook and an edited `package.json` script is
  published without either being executed by the publish job. (FR-10)
- **AC-8.** A `ready-specify` handoff with one path outside the spec corpus publishes
  nothing and labels the issue for a human. (FR-10, FR-13)
- **AC-9.** A handoff touching `.github/workflows/` is not pushed and the issue names the
  paths. (FR-12)
- **AC-10.** Two dispatch triggers for one issue yield one agent job; a local dispatcher
  holding a live claim causes the gate job to stop. (FR-16)
- **AC-11.** With the daily cap reached, a further trigger launches no agent and leaves
  labels unchanged; the next scheduled run after the window dispatches it. (FR-17, FR-19)
- **AC-12.** For each outcome in `AgentHandoff.outcome`, the issue ends with the matching
  visible state; a forced failure of the outcome write turns the job red. (FR-18)
- **AC-13.** The CLI version and every third-party action reference are pinned (exact
  version; full SHA). `runs-on` is a hosted-runner literal in every job. (FR-14, FR-21)
- **AC-14.** `scripts/gen-ci-templates.mjs` `SOURCES` contains neither workflow. (FR-22)
- **AC-15.** The local lane's existing dispatch and triage test suites pass unchanged after
  the scripts are parameterised. (FR-2)

## Invariants (must not break)

- **INV-1.** No job both executes agent-influenced code and holds a credential that can
  write to GitHub. (DR-008)
- **INV-2.** A label, a comment, or a trigger event is never the authority for a dispatch;
  the verdict record is. (`scripts/dispatch-ready-check.sh:11-31`)
- **INV-3.** MinSpec core stays offline: nothing in `packages/minspec/src` or
  `packages/shared` gains a network call or a dependency on these workflows. (Constitution
  invariant 1; SPEC-019 FR-16)
- **INV-4.** No lane outcome is written with a swallowed error, and a missing credential
  fails visibly. (Constitution invariant 2)
- **INV-5.** The workflows change behaviour only in a repository that has `.minspec/` at its
  root and has set the opt-in variable, and are shipped to no other repository.
  (Constitution invariant 3)
- **INV-6.** The local lane keeps working with the CI lane off, and with it on. (Issue #3:
  "Local dispatch stays primary for solo dev.")
- **INV-7.** One owner per issue across both lanes, by the SPEC-044 claim and the
  pull-request-per-branch rule, never by configuration alone.
- **INV-8.** A consumer subscription credential is never used to run work on behalf of more
  than one person. (DR-052 §6)

## Platform assumptions (unverified)

This dispatch had no network access, so none of these was checked against GitHub's or
Anthropic's documentation. Each is believed true. Plan must confirm each one and cite the
source, because the requirement beside it rests on it.

| # | Assumption | Rests on it |
|---|---|---|
| 1 | A workflow triggered by an `issues` event runs the default branch's workflow file with repository secrets available, whoever opened the issue. | FR-4, FR-5 |
| 2 | An event caused by the workflow's built-in token does not start another workflow; an event caused by an App installation token does. | FR-11 |
| 3 | The runner user on a GitHub-hosted runner can gain root without a password, so a firewall rule set by an earlier step in the same job can be removed by code the agent runs. | FR-8 (why the boundary is a container and not a host rule) |
| 4 | `anthropics/claude-code-action` performs its own GitHub writes with a token passed into the process that runs the model, and is built on the Agent SDK. | DQ-4 |
| 5 | Workflow logs and artifacts on a public repository are readable by any signed-in user. | FR-20 |

## Decisions needed (Clarify)

Each question names a recommended option and what that option costs. The requirements above
assume the recommended option in every case.

### DQ-1 - Build this now, or leave it parked?

DR-075 §4 parks team mode because no team is asking, and the issue itself calls this "lower
priority". The spec exists because triage classified the issue as dispatchable for the
Specify phase, not because the park was lifted.

- **(a) Park (rec).** Do not approve this spec. It stays `specifying` as the recorded design
  and #3 stays open. *Cost:* the design ages against `scripts/dispatch-issue.sh`, which is
  2,049 lines and took seven commits in the 30 days to 2026-10-02, so reviving it means re-verifying every citation here. I
  also found no spec status that means "parked" (searched `parked` and `deferred` in
  `scripts/validate-frontmatter.ts`), so an unapproved spec is the only expression of it I
  can point to, and I believe, without having verified it, that it will keep appearing as a
  pending item.
- **(b) Build it now for this repository.** Approve, with DQ-2 to DQ-5 answered. *Cost:* a
  second unattended lane that holds an inference credential and the App key in CI, three new
  machinery files that each need a human merge, and FR-8's container boundary to build
  first. The benefit to a single maintainer is dispatch that runs while the local machine is
  off.
- **(c) Close #3 and delete this spec.** *Cost:* the analysis of how the issue meets DR-008,
  DR-015 and DR-052 is lost, and would be redone if a team ever appears.

### DQ-2 - Where does the CI lane live?

- **(a) Dev-time, in this repository only (rec).** Consistent with DR-015: `scripts/` and
  this repository's workflows are dev tooling and ship in no extension. *Cost:* it serves a
  team only if that team works on this repository. Nobody adopting MinSpec gets it.
- **(b) Scaffolded into adopters by the MinSpec extension**, as the review stack is today
  (`scripts/gen-ci-templates.mjs`). *Cost:* MinSpec would then ship agent dispatch, which
  DR-015 decided against. That needs a decision record superseding DR-015 in part before
  Plan.
- **(c) In SealBox.** The home DR-015 and DR-044 name for productized dispatch. *Cost:*
  SealBox is shelved (DR-075 §2), so this is a decision not to build until it is not.

### DQ-3 - How strong is the boundary around the agent job?

- **(a) Unprivileged container with an egress allowlist (rec).** DR-008 Layer 2 as written.
  It is the only option that needs no change to a decision in force. *Cost:* the largest
  build of the three, and it duplicates sandbox work SPEC-019 already specifies for SealBox.
- **(b) Job split and trusted authors only, open egress.** FR-8 is dropped. Extends DR-033's
  dev-time relaxation from "self-authored" to "authored by a collaborator". *Cost:* injected
  code can send the inference credential anywhere. The mitigations are a dedicated,
  revocable key and a provider-side spend cap. DR-008 and DR-033 must be amended first.
- **(c) No code-executing agent in CI.** The lane runs triage and spec-only dispatch with
  file tools and no `Bash`; validation runs in the publish job from the base branch's
  scripts. *Cost:* the CI lane never builds code, so T1 (one-sentence spec) and T2 (spec and
  plan) issues still need a local machine. It is the cheapest option and FR-6 collapses to
  the step-level separation `ai-review.yml` already has.

### DQ-4 - The genuine CLI, or `claude-code-action`?

- **(a) The genuine CLI, driven by the existing scripts (rec).** One dispatcher, every gate
  in FR-2 applies. *Cost:* departs from the issue's stated scope, and this repository owns
  more workflow YAML than the packaged action would need.
- **(b) `anthropics/claude-code-action@v1`.** As the issue asks. *Cost:* if assumption 4
  holds, a write token sits in the agent's process, which breaks INV-1, and the verdict
  record, claim, scope guard and egress scan would each have to be rebuilt around the
  action. It is also `api-key` only under DR-052 §5.

### DQ-5 - Self-hosted runners?

- **(a) Hosted runners only in the first version (rec).** *Cost:* drops a scope item the
  issue lists, and every run pays a cold install of the dev environment.
- **(b) Self-hosted, ephemeral only.** One job per runner, destroyed afterwards. *Cost:*
  someone operates the runner fleet, and the runner's host network and credentials become
  part of the threat model.
- **(c) Self-hosted, persistent.** *Cost:* an agent that runs injected code on a persistent
  runner can leave something behind for the next job. On a public repository I would not
  recommend this under any answer to DQ-3.

## Why no new DR

Every recommended option sits inside a decision already in force: DR-075 and DR-076 (park),
DR-015 and DR-044 (dev-time here, product elsewhere), DR-008 (Layer 2 as written), DR-052
(billing modes), DR-082 (bot identity). `docs/decisions/INDEX.md` was searched for an
existing record on CI dispatch before concluding this; none exists, and none is needed while
the recommendations stand. Three non-recommended options would each need a record before
Plan: DQ-2 (b) supersedes DR-015 in part; DQ-3 (b) amends DR-008 and DR-033; DQ-5 (b) or (c)
adds a runner trust model no record covers.

## Out of Scope

- The `mode: solo | team` profile (parked by DR-076).
- A productized, adopter-facing dispatch feature (SealBox; DR-015, DR-044).
- Team-safe auto-drain across several developers' machines
  ([#251](https://github.com/AIClarityAU/minspec/issues/251)).
- Who may approve (reviewer authority,
  [#207](https://github.com/AIClarityAU/minspec/issues/207)).
- The OIDC token broker (SPEC-034, `status: planning`, not built). This lane uses the App
  key as a repository secret, as `ai-review.yml` does.
- Any change to review, auto-merge, or merge ordering.
- Dispatch of issues from authors outside the repository (SPEC-019 keeps this out of scope
  too, pending a stronger boundary).

## Alternatives considered and rejected

- **One job with step-level credential separation for the build agent.** Rejected: steps
  share a filesystem, so the agent can rewrite what a later credentialed step runs. It is
  sufficient only for an agent with no code-executing tool, which is DQ-3 (c).
- **Trust the label event because only collaborators can apply labels.** Rejected:
  `scripts/dispatch-ready-check.sh:11-23` records five hand-applied labels that dispatched
  without ever passing the gate. The label is a stamp, and the CI lane inherits that rule.
- **Restate the gates in workflow YAML to avoid touching the scripts.** Rejected: two copies
  of a gate drift, and the copy in YAML cannot be unit-tested as the scripts' pure seams
  are.
- **Let the agent job push its own branch with a narrowly scoped token.** Rejected: DR-008
  Layer 1 removes credentialed operations from the agent entirely, and a push token in a job
  that runs arbitrary code is the exposure that decision closed.

## Risks

| Risk | Mechanism | Mitigation |
|---|---|---|
| The inference credential leaks | It is in the agent job by necessity; code the agent runs can read it | FR-8 egress allowlist; FR-20 redaction; a dedicated revocable key in `api-key` mode |
| The lane is dead and looks quiet | Actions disabled, a secret expired, or the schedule not firing | FR-18 and FR-19 fail red on a missing credential. Residual: if Actions itself is off, nothing inside the repository can report it |
| Token spend from a flood of issues | Each trusted issue can start an agent | FR-5 limits who can start one; FR-17 caps how many |
| The handoff is used to attack the publish job | The artifact is written by agent-influenced code | FR-10 verifies shape and executes nothing from it |
| Two lanes build the same issue | Local drain and CI both see `agent-ready` | FR-16; SPEC-044's claim and the pull-request-per-branch rule |

## Test plan (for the Plan phase to place)

1. Pure seams first: bundle verification, ticket-versus-handoff comparison, the trust
   predicate, and cap arithmetic are each a function testable without a runner.
2. Each refusal in AC-6 gets its own fixture, and each fixture is checked with the guard
   removed to prove the test fails without it.
3. AC-5's probe is tested both ways: boundary present, and boundary deliberately absent.
4. Source-text assertions are limited to AC-13 and AC-14.
5. The existing local dispatch suites run unchanged (AC-15).

## Follow-ups (tracked)

This dispatch could not call the issue tracker, so none of these is filed yet. Each needs an
issue before this spec is approved; until then they are listed here so they are not lost.

- Confirm the five platform assumptions against primary documentation (Plan-phase task of
  this spec; no separate issue needed if DQ-1 stays at park).
- If DQ-2 resolves to (c): an issue on `AIClarityAU/sealbox` linking this spec.
- If DQ-3 resolves to (b): an issue to amend DR-008 and DR-033.
- A way to mark a spec as parked that the validator and signpost understand, if DQ-1's
  recommended option is taken and the pending item proves noisy.

## Traceability

- **Issue:** [#3](https://github.com/AIClarityAU/minspec/issues/3).
- **Epic:** [EPIC-007 Agent Execute](../../../docs/epics/EPIC-007-agent-execute.md); listed
  as related under [EPIC-009 Team Readiness](../../../docs/epics/EPIC-009-team-readiness.md).
- **Governing decisions:** [DR-008](../../../docs/decisions/DR-008.md) (execution isolation
  before unattended dispatch), [DR-015](../../../docs/decisions/DR-015.md) and
  [DR-044](../../../docs/decisions/DR-044.md) (where dispatch ships),
  [DR-033](../../../docs/decisions/DR-033.md) (dev-time auto-build on trusted issues),
  [DR-052](../../../docs/decisions/DR-052.md) (billing modes),
  [DR-075](../../../docs/decisions/DR-075.md) and
  [DR-076](../../../docs/decisions/DR-076.md) (solo-first; team mode parked),
  [DR-082](../../../docs/decisions/DR-082.md) (bot identity).
- **Related specs:**
  [SPEC-019](../../agent-execute/SPEC-019-execution-substrate/requirements.md) (the sandbox
  substrate; this repository's copy, which may trail SealBox's own),
  [SPEC-044](../SPEC-044-coordinated-self-completing-sessions/requirements.md) (claims),
  [SPEC-074](../SPEC-074-dispatch-quota-classification/requirements.md) (quota labels),
  [SPEC-034](../SPEC-034-oidc-review-broker/requirements.md) (token broker, not built).
- **DR for this spec:** none; see "Why no new DR" for the three options that would need one.
- **Spec id:** 094 is one above the highest id found across every locally known branch
  (093) at authoring time. Open pull requests not fetched into this checkout are invisible
  to that count, so the id may need renumbering if another spec claims it first.
