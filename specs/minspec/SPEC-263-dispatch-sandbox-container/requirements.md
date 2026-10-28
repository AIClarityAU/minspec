---
id: SPEC-263
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline (this is its execution boundary)
aspects: [dispatch, security, trust-boundary, credentials, container, no-silent-gate, fail-closed]
depends_on: [DR-008, DR-105]  # DR-008 Layer 2 (no-credential execution before unattended dispatch); DR-105 the environment allowlist this builds on, and whose residual risk names #2691
relates_to: [SPEC-019, SPEC-254, "#2913", "#2691", "#2871", "#2693", "#2692", "#2698", "#2114"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own (scripts/, the host unit, the sandbox
  image) is decided at Plan, after Decisions D1-D7 are answered.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-263: Drain-dispatched agents run in a second container that holds no GitHub token and no host credential

> **This is a SPECIFICATION ONLY.** Written for issue #2913 (build: run drain-dispatched
> agents in a second container), which records the founder's 2026-10-18 answer on #2691 (a
> boundary of its own for code an agent runs). Nothing is built until a human reads it,
> resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.
>
> **On this spec's number.** SPEC-263 is the highest id on disk at this base plus one. Open
> pull requests were not visible to the agent that wrote this (no network), so the spec-id
> collision gate's report on the PR is the authority; renumber if it says the id is taken.

## In plain terms

Today an agent the drain starts runs in the same container as the drain itself. DR-105 made
sure the agent's own process is not *handed* a GitHub token, but the agent is still a
process of the same user in the same container, so it can *take* one three ways. The
founder chose to close all three with a second container: agents run there, and that
container has no way to reach a GitHub token. The drain, which stays where it is, keeps
doing every `git push` and every `gh` call. If the second container is missing or broken,
dispatch stops and says so; it never quietly falls back to running agents the old way.

## Measured state (this base)

Read from the code at this base, not inferred:

- **Agents already do not push.** Every dispatch prompt forbids `git push`/`gh`
  (`scripts/dispatch-issue.sh:1399`, `:1458`, `:2028`); the launcher pushes the agent's
  branch itself (`scripts/dispatch-issue.sh:1939-1941`, `:2366`). FR-2 of this spec
  therefore *keeps* a split that exists; what changes is that the agent can no longer
  bypass it.
- **The launcher's token is in its environment.** `scripts/lib/gh-bot.sh:124` does
  `export GH_TOKEN="$tok"` in the drain's shell, so every same-user process can read it from
  `/proc/<pid>/environ` of the drain, the dispatcher, or any `gh`/`git push` child. This is
  route 1 of the three in #2913.
- **The broker is a socket in `/tmp`.** The broker client in the container user's HOME (not in this repo; `gh-app-token.sh`, line 6) uses
  `SOCK="/tmp/gh-app-token.sock"`; anything in the container that can open it can mint an
  installation token. Route 2.
- **HOME is passed through.** `scripts/lib/agent-context.sh:310` lists `HOME` in
  `AGENT_ENV_ALLOW`, and the CLI's own login lives under it (`:221`). Under HOME also sit
  `~/.claude/scripts/` (the broker client), `~/.config/gh`, and other repositories under
  `~/code` (the container mounts `~/code`, `scripts/drain-service/README.md:38`). Route 3.
- **DR-105 names this gap as its residual risk.** `docs/decisions/DR-105.md:48-52` and
  `:292-296`: the allowlist is a statement about the agent's process, "not a boundary";
  closing it is #2691.
- **The launcher already distrusts the worktree.** `scripts/lib/agent-worktree.sh:16-26`
  lists three ways an agent-edited worktree ran code as the launcher (in-tree hooks, a
  rewritten `.git` file, the worktree's own `npm` scripts) and pins hooks and the git
  directory (`:87`, `:181-185`). This spec must not reopen any of the three.
- **Agent launch sites.** Files that start the CLI through `$AGENT_LAUNCH_ENV`:
  `scripts/dispatch-issue.sh`, `scripts/remediate-pr.sh`, `scripts/triage-inbox.sh`,
  `scripts/review-branch.sh`, `scripts/review-pr.sh`, `scripts/review-approvable.sh`,
  `scripts/tooling-radar/run-radar.sh`. Which of these "the drain dispatches" is D1.
- **The drain runs inside the `claude-agent` container,** reached by `docker exec` from a
  host user unit, and refuses to run anywhere whose pid 1 is not `docker-init`
  (`scripts/drain-service/README.md:3-10`).
- **Not verified here:** what #2871 adds beyond #2691 (no network access from this agent);
  whether the `claude-agent` container has access to a Docker socket today; how the host
  starts that container.

## Functional requirements

- **FR-1 A second container.** Every agent run covered by D1 executes in a container
  separate from the `claude-agent` container (the *sandbox*). The sandbox:
  - (a) does not mount `/tmp/gh-app-token.sock`, nor `/tmp` as a whole, nor any directory
    that contains the socket;
  - (b) does not mount the founder's HOME, `~/.claude`, `~/.config`, `~/.ssh`, `~/code`, or
    any path of the host or of the `claude-agent` container other than the per-run paths
    FR-3 names. Its HOME is its own, created fresh or from a sandbox-only image;
  - (c) shares no PID namespace with the `claude-agent` container or the host (no
    `--pid=host`, no `--pid=container:…`), so no launcher process is visible in its `/proc`;
  - (d) receives no SSH agent socket, git credential helper, Docker socket, or
    `GH_TOKEN`/`GITHUB_TOKEN`/`GH_ENTERPRISE_TOKEN` value, by any channel (environment,
    file, mount, argument);
  - (e) runs as a non-root user without added capabilities and with `no-new-privileges`.
- **FR-2 The launcher pushes; the sandbox commits.** All `git push`, `git fetch` against
  `origin`, and `gh` calls for a sandboxed run are made by the launcher in the
  `claude-agent` container, after the agent exits. The sandbox makes local commits only.
  The existing egress scan (`scripts/lib/agent-egress.sh`) still runs on what the launcher
  publishes.
- **FR-3 How work crosses the boundary.** The only things the sandbox can write that the
  launcher later reads are (i) the commits of the run and (ii) the run's declared output
  files (`.agent-summary.md`, `.review-signals.json`, the agent's stdout/exit code). The
  transfer must not let the sandbox choose any git configuration, hook, alternate, or
  program that the launcher's git then reads or runs (the `agent-worktree.sh` threat list,
  extended across the new boundary). The mechanism is D2.
- **FR-4 One host command.** Every step that only the founder can run on the host
  (building or pulling the sandbox image, installing a unit, granting the launcher the
  ability to start sandbox runs) is collapsed into ONE command, written out verbatim in
  the implementing PR's body and in `scripts/drain-service/README.md`. It is idempotent:
  run twice, it changes nothing the second time and says so. It is opt-in: nothing in it
  touches a machine that did not run it (invariant 3).
- **FR-5 No fallback; fail loudly.** Before each agent run, the launcher proves the
  sandbox is usable (FR-6). If it is absent, unreachable, misconfigured, or fails the
  probe, the launcher:
  - (a) does NOT start the agent in the `claude-agent` container or anywhere else;
  - (b) exits non-zero with a message naming which check failed and the FR-4 command;
  - (c) leaves the issue/PR in a state the drain will retry later, not marked failed or
    consumed (no lease burned, no `agent-failed` label from this cause);
  - (d) is visible to the founder beyond the drain log; how is D4.
  There is no environment variable, flag, or config key that re-enables in-container
  dispatch. Reverting to it is a code change, reviewed (the DR-105 reasoning about
  switches, `docs/decisions/DR-105.md:278-281`).
- **FR-6 A capability probe, not a path check.** The pre-run probe executes INSIDE the
  sandbox, with the same image, mounts and user as the agent will get, and attempts each
  route rather than checking that a path is absent:
  - (a) route 1: scans every readable `/proc/*/environ` and every readable file under the
    mounted paths for a canary value the launcher places in its own environment for that
    run, and for any `GH_TOKEN`/`ghs_`/`ghp_`/`github_pat_`-shaped value;
  - (b) route 2: tries to connect to `/tmp/gh-app-token.sock` and runs the broker client
    if one is present on its PATH;
  - (c) route 3: tries `gh auth token`, `git credential fill` for `github.com`, and reads of
    the paths FR-1(b) forbids;
  - (d) reports each result separately; any success, and any probe that could not run,
    fails the gate (an errored witness fails closed, invariant 2).
- **FR-7 Second witness.** The property in FR-1 is also asserted by a test that runs
  without the live drain (a container-level integration test or a static check of the
  sandbox's run specification: mounts, PID mode, env, user, capabilities), so a probe that
  was edited to always pass does not leave the property unwitnessed. Which form is D5.
- **FR-8 Model login.** The sandbox needs a model credential for the CLI to run. It is
  handed exactly one, by name, as today (`AGENT_MODEL_LOGINS`,
  `scripts/lib/agent-context.sh:302-305`), or none at all if D3 chooses a proxy. It is
  never a GitHub credential, and the spec does not claim the model login is unreadable by
  the agent (residual risk R-1).
- **FR-9 Same behaviour otherwise.** A sandboxed run produces the same branch, commits,
  summary and signals as an in-container run of the same prompt would, so the drain's
  downstream steps (egress scan, push, PR, review, shepherd) need no per-run change. The
  agent's worktree checks (`npm test`/`lint`/`build`/`validate`) run inside the sandbox.
- **FR-10 Cleanup.** A sandbox run's container and scratch state are removed when the run
  ends, including on timeout or kill; a leftover from a crashed run is reaped by the next
  run and logged, not reused.
- **FR-11 Concurrency.** The drain's parallel dispatch (`MINSPEC_DRAIN_CONCURRENCY`, up to 8)
  gets one sandbox per agent run; two runs never share a sandbox, a HOME, or a worktree.
- **FR-12 DR-105 controls stay.** The environment allowlist, the author gate, the pinned
  hooks and the pinned git directory remain in force for sandboxed runs. This spec adds a
  boundary; it removes none of the controls behind it (`docs/decisions/DR-105.md:285-288`).

## Acceptance criteria

- **AC-1** With the sandbox installed, the FR-6 probe run inside it reports all three routes
  closed, and a canary placed in the launcher's environment is not found by the probe.
- **AC-2** Negative control for each route, one at a time: mounting the broker socket,
  mounting the founder's HOME, and running with `--pid=container:<claude-agent>` each make
  the probe FAIL and dispatch refuse. (Proves the probe can see each route; without this,
  AC-1 can pass vacuously.)
- **AC-3** Removing or stopping the sandbox prerequisite makes the next dispatch exit
  non-zero with the FR-5(b) message; no `claude -p` process starts in the `claude-agent`
  container (checked by process listing during the attempt); the issue is retried on a
  later cycle once the sandbox is restored.
- **AC-4** A dispatched T1 issue end-to-end: agent commits in the sandbox, the launcher
  pushes, a PR opens, and the PR's commits match the sandbox commits byte for byte.
- **AC-5** An agent that writes a hostile `.git/config` (`core.fsmonitor`, `core.sshCommand`,
  `core.hooksPath`), a `.githooks/pre-push`, and a git alternate in its output causes none
  of them to run or be read by the launcher's push (a marker file the hostile program would
  write does not appear).
- **AC-6** Running the FR-4 command twice reports "already installed" the second time and
  changes no file.
- **AC-7** Eight concurrent dispatches get eight distinct sandboxes, and after they finish
  no sandbox container or scratch directory remains.
- **AC-8** A grep over `scripts/` finds no code path that starts an agent covered by D1
  outside the sandbox launcher (a launch-site test, extending
  `agent-launch-sites.test.ts`).

## Invariants this change must not break

- Constitution invariant 2 (no silent gate): the sandbox check fails closed and visibly;
  no `|| true` on the probe, no fallback dispatch, no probe whose error reads as a pass.
  FR-7 is the independent second witness the invariant requires.
- Constitution invariant 3 (blast radius): the host command is opt-in and touches only
  what it installs; nothing here changes a machine that did not run it.
- Constitution invariant 1 (offline): unaffected; this is dev-time `scripts/` machinery and
  ships in no extension.
- DR-008 Layer 2: this is the dev-time instance of "clean-env container"; it must not be
  described as satisfying DR-008 for the productized `agent-execute` path (SPEC-019 owns
  that).
- DR-105: every control it set stays (FR-12).
- The founder's GitHub identity is never reachable from either container (the drain's
  refusal to run on the host, `scripts/drain-service/README.md:8-10`, stays).

## Residual risk (stated, not closed by this spec)

- **R-1 The model login is readable by the agent.** Whatever credential lets the CLI call
  the model is inside the sandbox (unless D3 picks the proxy). An agent can exfiltrate it.
- **R-2 Network egress.** Unless D6 restricts it, the sandbox can reach the internet: it
  can exfiltrate source, its model login, and anything else in its mounts. It holds no
  GitHub write credential, so it cannot push, comment, or merge.
- **R-3 The launcher still runs agent-written content as data.** The commits it pushes and
  the summary it posts are the agent's; the egress scan, the reviewers and the merge gate
  remain the controls on content (unchanged).
- **R-4 The launcher's own token stays broad** until #2693 narrows it.
- **R-5 Whatever can start sandbox runs is a new privilege.** If D4 gives the
  `claude-agent` container a Docker socket, every process in it (founder sessions
  included) gains root-equivalent access to the host. D4 (a), the recommended option, avoids that by
  default.

## Out of scope

- Narrowing the launcher's token (#2693); relayed text and identity (#2692); the items in
  #2698.
- The productized `agent-execute` sandbox (SPEC-019 / DR-017).
- Sandboxing the founder's interactive sessions or the drain itself.

## Decisions needed (Clarify)

**D1 - Which agent runs move into the sandbox?**
- (a) **(rec)** Every `claude -p` the drain starts: dispatch, remediation/shepherd fix
  agents, triage, and the reviewers it calls. Cost: reviewers need an API-key login inside
  the sandbox too (`review-branch.sh:292-317`), and more runs pay container start-up time.
- (b) Only the agents that edit a worktree (dispatch, remediation fix). Cost: triage and
  reviewers also read untrusted text and would keep all three routes open.

**D2 - How do commits cross the boundary (FR-3)?**
- (a) **(rec)** The sandbox works in its own clone and hands back a `git bundle` file; the
  launcher verifies and fetches from the bundle into the pinned git directory. A bundle is
  data, so no sandbox-side config, hook or alternate is read. Cost: an extra clone per run
  (seconds; object sharing via a read-only reference is possible) and a bundle-verify step
  to build.
- (b) Bind-mount the existing worktree and its git directory read-write into the sandbox.
  Cheapest. Cost: the sandbox can then write the shared git directory's `config` and
  `hooks`, which the launcher's git reads on push - this reopens the `agent-worktree.sh`
  threat class across the new boundary and needs its own hardening.

**D3 - Which model credential does the sandbox hold (FR-8)?**
- (a) **(rec)** One login passed by name, as `--model-login` does today. Cost: R-1 stays
  open - an agent can read and leak the model login.
- (b) No login in the sandbox; the CLI's `ANTHROPIC_BASE_URL` points at a launcher-side
  proxy that injects it. Cost: a new long-lived proxy to build and keep alive, and the
  subscription login may not be usable through a proxy (unverified).

**D4 - How does the launcher start a sandbox run without becoming host-root (R-5)?**
- (a) **(rec)** A sandbox runner started by the host (installed by the FR-4 command) that
  takes jobs from a shared spool directory; the `claude-agent` container gets no Docker
  socket. Cost: a small job protocol plus a liveness witness the probe must check.
- (b) Mount the Docker socket into the `claude-agent` container and `docker run` per job.
  Simplest. Cost: every process in that container, including founder sessions, gains host
  root.
- (c) Rootless Podman inside the `claude-agent` container. Cost: nested containers need
  extra privileges on the outer container, and a nested sandbox may share more with its
  parent than a sibling would (unverified).

**D5 - How is the failure made visible beyond the log (FR-5(d)), and what form does the
second witness take (FR-7)?**
- (a) **(rec)** The drain pauses agent dispatch (other drain work continues), writes the
  existing pause marker with the reason, and the session-start banner shows it; FR-7 is a
  static test over the sandbox run specification in `scripts/` plus the AC-2 negative
  controls run in CI where Docker is available. Cost: a paused dispatch waits for a human
  to rerun the host command.
- (b) File/refresh one GitHub issue per outage. Cost: a network write on the failure path,
  which can itself fail.

**D6 - Network egress from the sandbox (R-2).**
- (a) **(rec)** Leave egress open in this spec; file the allowlist (model API, npm
  registry) as its own follow-up. Cost: R-2 stays open until then.
- (b) Restrict egress now. Cost: `npm install` and other tool fetches break until each
  host is listed, and the list needs an owner.

**D7 - Does this need its own DR?** The boundary is a trust-boundary choice that is not
undone in a day, which by DR-105's precedent wants a record.
- (a) **(rec)** Yes: write it at Plan, numbered by the DR collision gate, amending DR-008's
  Layer 2 for the dev-time path and closing DR-105's #2691 follow-up. Cost: one more record
  for the founder to accept.
- (b) No: this spec plus #2913 is the record. Cost: DR-105's residual-risk section keeps
  pointing at an open #2691 with no decision record of how it closed.

## Follow-ups (tracked)

- #2691 - the boundary decision; this spec builds it.
- #2871 - cited by #2913 as a source for the three routes; content not read by this agent.
- #2693 - narrow the launcher's token (R-4).
- #2692 - relayed text filed under the pipeline's identity (R-3 adjacent).
- Egress allowlist (D6 (a)) and the model-login proxy (D3 (b)), if chosen: to be filed at
  Clarify, once the decision is made; not filed by this specify-only run.
