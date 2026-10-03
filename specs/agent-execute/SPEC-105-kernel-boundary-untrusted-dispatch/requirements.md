---
id: SPEC-105
type: requirements
status: specifying
tier: T4  # security-critical: this spec decides when the product may accept attacker-controlled input at all; the upward-only floor over the triage's T3/T4
product: agent-execute
epic: EPIC-007  # Agent Execute Extension - DR-017 (the substrate) and SPEC-019 (its requirements) live here
aspects: [security, sandbox, isolation, kernel-boundary, untrusted-input, attestation, no-silent-gate, blast-radius]
depends_on: [DR-017, DR-008, DR-015, DR-030, DR-004, DR-016, SPEC-019]  # DR-017 names this hardening path; DR-008 Layer 2; DR-015 the Execute extension; DR-030 untrusted-input-as-data; DR-004 tiering + air-gap; DR-016 detect-or-degrade; SPEC-019 the port, attestation and broker this builds on
relates_to: [SPEC-104, SPEC-016, DR-044, DR-046, DR-049, "#73", "#70", "#74", "#56"]  # SPEC-104 (#70) owns author-trust at the dev-time dispatch boundary; DR-044/DR-049 the SealBox repo split; #74 the broker-injection spike; #56 the parent Specify cycle
# No `implements:` / `affects:` yet. No `packages/agent-execute` exists in this repo
# (checked 2026-10-03: `ls packages` -> broker, extension-pack, minspec, shared), and the
# SPEC-019 Layer-2 code this builds on is unbuilt. File ownership is a Plan-phase
# declaration, made before approval mints a hash (SPEC-038).
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-105: Kernel-boundary sandbox adapter and the untrusted-dispatch gate

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers or accepts the questions under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the
> normal spec-approval gate before any code changes. Every requirement below is written
> under each decision's **recommended** option. Picking a different option changes only the
> requirements that decision names.

Materializes **[#73](https://github.com/AIClarityAU/minspec/issues/73)** - *"microVM/gVisor
hardening path before untrusted issue dispatch"*. [DR-017](../../../docs/decisions/DR-017.md)
(accepted) builds the SealBox execution plane on docker, a **namespace-level** boundary, and
names a **kernel-level** boundary (microVM such as Firecracker, or gVisor) as the hardening
path required **before** non-self-authored issue bodies are dispatched unattended
(DR-017.md:69-71, :232-234, :258). [SPEC-019](../SPEC-019-execution-substrate/requirements.md)
carries that as OQ-2 / R2 and scopes v1 to trusted self-authored issues only (FR-15).

**Id note.** Seven of the eight ids after `SPEC-096` are already claimed by other branches
(read from local remote-tracking refs on 2026-10-03; no network check, and the one gap may
be claimed by a branch not fetched here). SPEC-104 is one of them, on the in-flight #70
branch, so it does not resolve on this base yet. That makes this `SPEC-105`. If the
id collides at review time, renumber it.

**Home note.** [DR-044](../../../docs/decisions/DR-044.md) moved SealBox to its own repo, but
its spec migration is still an open follow-up there, and the sealbox repo's own copy of the
substrate spec (SEA/SP2, under `specs/sealbox/` there) is marked
`status: superseded`, `superseded-by: MinSpecPro SPEC-019`. So SPEC-019 here is canonical, and
this spec sits beside it. It moves with SPEC-019 when DR-044's migration lands (DQ-7).

## One-Sentence Scope

Add a kernel-boundary `SandboxRunner` adapter behind SPEC-019's existing port, prove the
boundary class with two independent witnesses on every dispatch, and keep unattended
dispatch of untrusted issue bodies **closed** until an attested kernel-boundary box, the
untrusted-run output and exfiltration controls in this spec, and a recorded security review
all exist. A missing witness keeps the gate closed, visibly.

## Context: what exists today (read at this branch's base, not inferred)

- **No product code.** There is no `packages/agent-execute` in this repo
  (`ls packages` -> `broker`, `extension-pack`, `minspec`, `shared`; the `broker` package
  is the SPEC-034 OIDC review broker, a different broker). SPEC-019 is
  `status: implementing`, but its Layer-2 milestone (docker adapter, model broker,
  attestation) is explicitly gated and unbuilt (SPEC-019 Clarify, "v1 vs Layer-2 milestone
  split"). **This spec therefore depends on SPEC-019's Layer-2 milestone existing first.**
- **The port is designed.** SPEC-019 design.md:204-212 freezes
  `SandboxRunner { spawn, attest, run, collectDiff, teardown }`, with `run()` accepting
  only an `AttestedHandle` minted by `attestedHandle()` when `verdict()` is `PASS`.
  `AttestationVerdict` (design.md:298-304) carries `checks[]` and a `mode` of
  `'no-cred' | 'spawn-token-whitelisted'`. **Nothing in the type records the boundary
  class**, so today a namespace container and a kernel-boundary box produce
  indistinguishable `AttestedHandle`s.
- **Attestation is config-correctness only.** SPEC-019 FR-8 and DR-017.md:190-192 say the
  probe proves "as configured, this box cannot reach X" and does **not** prove absence of
  a kernel or container-escape 0-day. That residual is the subject of this spec.
- **Untrusted bodies are already framed as data** (SPEC-019 FR-15, DR-030), and SPEC-104
  (in flight, #70) adds an offline injection detector and author-trust filtering at the
  dev-time dispatch boundary. Data framing bounds *what the model is told*. It does not
  bound *what code the model's tools can run*, and an agent that runs the project's
  build/test executes arbitrary code by definition (DR-008's "unavoidable conclusion").

## Threat model this spec closes, and what it does not

**In scope.** An attacker who can file an issue, or edit an issue body, on a repo where
SealBox runs autonomous dispatch. Their body reaches the agent as DATA, but they can steer
the agent into writing and running code inside the execution plane. Against a namespace
boundary the steps after that are a shared-kernel exploit, then the host (the user's
credentials, other worktrees, the docker socket). The routes this spec closes:

| # | Route | Closed by |
|---|---|---|
| T-1 | Escape through the shared host kernel (namespace boundary) | Kernel-boundary adapter (FR-1 to FR-4) + boundary-class attestation (FR-5 to FR-8) |
| T-2 | Untrusted body dispatched into a namespace box because the boundary class was assumed, not measured | Trust-class / boundary-class pairing by construction (FR-9 to FR-11) |
| T-3 | Exfiltration through the one allowed seam: the model broker's server-side `web_fetch` / `web_search` (SPEC-019 FR-3) can carry repo contents to an attacker URL from Anthropic's servers | Broker-side tool policy for untrusted runs (FR-14) |
| T-4 | The kernel box is clean, but its **output** is not. A pushed diff that edits CI workflows, git hooks, package scripts or dependency manifests runs in CI *with repository secrets*, outside every sandbox | Untrusted-run output gate (FR-15, FR-16) |
| T-5 | The broker itself as the attack surface (malformed requests from a hostile box) | Broker input hardening for untrusted runs (FR-17) |

**Not closed (named residuals).**

- **A hypervisor or gVisor-Sentry 0-day.** A kernel boundary shrinks the attack surface;
  it does not prove escape-resistance either. The attestation claim stays honest about this
  (FR-8).
- **Degraded output.** Prompt injection still yields a bad advisory or a bad diff. That is
  a quality risk, held for a human by FR-15, never an integrity breach.
- **Resource abuse.** A hostile body can burn the dispatch's quota and wall-clock until the
  SPEC-019 FR-14 caps and timeouts stop it. That is a DoS/cost risk bounded by existing
  caps, not a new one.

## Requirements

### The kernel-boundary adapter

- **FR-1 (a new adapter behind the unchanged port).** A kernel-boundary `SandboxRunner`
  adapter implements SPEC-019's `spawn -> attest -> run -> collectDiff -> teardown`
  lifecycle with the **same method set and the same never-throw `Result<T>` contract**
  (SPEC-019 FR-2, FR-11). No control-plane caller changes to use it; the docker adapter
  stays available for trusted dispatch. Under **DQ-1's recommendation** the first adapter
  is **gVisor** (`runsc`), run as an OCI runtime under the same container engine the docker
  adapter already drives, so it reuses that adapter's mount, env and network plumbing.
  A microVM adapter (Firecracker or Kata) is the second adapter behind the same port, not
  part of this spec's first build.

- **FR-2 (every SPEC-019 invariant holds unchanged in the new box).** The new adapter
  satisfies every SPEC-019 invariant as written: no host credential, no egress except the
  broker seam, no host `$HOME`, no docker socket, not privileged, the dedicated-worktree
  rule (DR-046), diff handoff with no in-box push. Hardening the kernel boundary may not
  relax any namespace-level control to make the new runtime work (for example by adding a
  capability, a host mount, or host networking).

- **FR-3 (the broker seam crosses the kernel boundary without widening it).** The box
  reaches the host-side model broker (SPEC-019 FR-3) through **one** seam that the
  adapter configures at spawn and that is fixed for the run. In gVisor this is the same
  loopback/unix-socket seam the docker adapter uses; a microVM adapter uses a single vsock
  port. The seam carries model requests only. No other host service is reachable over it.

- **FR-4 (detect, never install; never touch machine-wide config).** SealBox **detects**
  whether a kernel-boundary runtime is available, mirroring SPEC-019 FR-11's
  detect-or-degrade probes, and returns a typed fallback when it is not
  (`{ ok: false, reason: 'no-kernel-runtime' }`, a new `RunnerFailure` member). SealBox
  **never installs** a runtime, guest kernel or image, and **never edits** machine-wide
  configuration such as the container engine's daemon config or runtime registry. Doing
  so would change behaviour for every other container on the machine, which constitution
  invariant 3 forbids. Install guidance is an affordance the user acts on.

- **FR-5 (pinned, verified execution artefacts; no network fetch at dispatch).** The
  sandbox image (and, for a microVM adapter, the guest kernel and root filesystem) is
  referenced by **content digest**, never by a mutable tag. A digest mismatch fails
  closed (`attest-failed`). Dispatch makes no network call to obtain an artefact;
  fetching one is a separate, user-initiated act (constitution invariant 1).

### Boundary-class attestation (two independent witnesses)

- **FR-6 (the boundary class is measured, never declared).** Attestation produces a
  `boundary` class of `'namespace' | 'kernel'` that is **derived from witnesses**, never
  read from the adapter's own claim about itself. An adapter that says "I am gVisor" proves
  nothing; the class is what the two witnesses in FR-7 jointly observe.

- **FR-7 (two independent witnesses must agree).** `boundary === 'kernel'` only when
  **both** of the following agree. Any disagreement, error, timeout or missing value
  yields `'namespace'` (fail closed). This is constitution invariant 2's independent second
  witness: one misconfigured producer cannot alone mint a kernel class.
  1. **Host-side witness.** The control plane asks the runtime, from outside the box, what
     isolation it used for **this** box id (for gVisor: the container's configured OCI
     runtime is the kernel-boundary runtime; for a microVM: a VMM process owns this box
     id). It reads this from the engine, not from anything inside the box.
  2. **In-box witness.** The attestation probe, running inside the box before any agent
     code (SPEC-019 FR-6's "attest the box you execute in"), reports a kernel identity
     that differs from the host's. **Candidate signal, unverified:** I believe the box's
     `/proc/sys/kernel/random/boot_id` differs from the host's under both gVisor and a
     microVM, and is identical under a plain namespace container because procfs comes from
     the shared kernel. Plan must confirm the exact signal empirically per runtime before
     it is relied on (Plan spike, see Follow-ups).

- **FR-8 (the witness must be shown to discriminate).** The boundary-class probe is
  validated against a **negative control** on every CI run of the substrate suite: the
  same probe run in a plain namespace container **must** report `'namespace'`. A probe
  that reports `'kernel'` for both boxes is broken and fails the suite. This is SPEC-019
  FR-7's positive-control rule applied to the new row: never infer the safe reading from a
  probe that has not been shown to say no.

- **FR-9 (scope honesty carries over).** The attestation report states that `'kernel'`
  means "this box runs on a kernel boundary of class X, configured as attested". It does
  not claim escape-resistance. User-facing text never says "escape-proof", "unbreakable"
  or equivalent.

- **FR-10 (the full SPEC-019 probe suite re-runs against the new adapter).** Every
  SPEC-019 FR-6 deny-check (egress, creds-env, creds-files, auth, push, fs-boundary,
  privilege) and its FR-7 positive control pass against the kernel-boundary adapter, in
  the same run as the FR-7 boundary-class row. Per SPEC-019 FR-8, this suite is both the
  per-dispatch runtime gate and the adapter's CI integration test.

### The untrusted-dispatch gate

- **FR-11 (trust class is computed host-side, fails closed).** Before dispatch, the
  control plane assigns each issue a trust class of `'trusted' | 'untrusted'`. Under
  **DQ-3's recommendation**: `'trusted'` only when the issue author **and** every editor
  of the body since triage are in the user's configured trusted-login set (default: the
  authenticated user alone, which is the literal meaning of "self-authored"), and the body
  hash still matches the one triaged. Any unknown, unreadable or changed value yields
  `'untrusted'`. The computation is shared with, not duplicated from, SPEC-104's
  author-trust check (DQ-3); there is one predicate.

- **FR-12 (untrusted input runs only in an attested kernel box, by construction).** An
  untrusted prompt can be passed only to a handle whose attested boundary is `'kernel'`.
  This is enforced by the type, in SPEC-019's "the only constructible state" style
  (design.md:39-42): the prompt carries its trust class, and the promotion function that
  mints a kernel-class handle is the only path to a handle that accepts an untrusted
  prompt. A namespace-class handle given an untrusted prompt is a **type error**, not a
  runtime check a caller can forget. Where the type change lands is DQ-6.

- **FR-13 (the gate stays closed until every unlock condition holds, and says why).**
  Unattended dispatch of an untrusted body is **blocked** unless **all** hold:
  (a) a kernel-boundary adapter is detected (FR-4);
  (b) this dispatch's attestation passed, including FR-7's boundary row (FR-10);
  (c) the untrusted-run controls FR-14 to FR-17 are active in this build;
  (d) a security-review record for the adapter exists (FR-18).
  When blocked, the issue is labelled for human review and the control plane shows
  **which** condition failed, by name. It never silently skips the issue, never degrades
  to the namespace adapter, and never degrades to Layer-1 manual for an untrusted body.
  (SPEC-019 FR-10's "degrade to Layer-1 manual" stays the rule for **trusted** bodies only;
  Layer-1 is permitted by DR-008 only for trusted, self-authored bodies.)

### Controls that apply to untrusted runs

- **FR-14 (no exfiltration through the broker's web tools).** For an untrusted run the
  **host-side broker** removes server-side `web_search` / `web_fetch` tool definitions from
  every model request before forwarding, and rejects a request that tries to re-add them
  (DQ-5). This is enforced at the broker, outside the box, because the box is assumed
  hostile. Trusted runs keep SPEC-019 FR-3's behaviour unchanged.

- **FR-15 (untrusted output is never auto-pushed).** An untrusted run's diff bundle is
  never pushed without a human act (DQ-4). The control plane shows the diff and
  `.agent-summary.md` for review; the push and comment happen only after a human accepts.
  This holds at every tier: SPEC-019 FR-12's T1-T2 auto-dispatch governs whether the run
  starts, not whether an untrusted run's output leaves the machine.

- **FR-16 (sensitive paths are flagged before the human sees the diff).** When an
  untrusted run's diff touches any path that executes outside the sandbox (CI workflow
  definitions, git hooks, package lifecycle scripts, dependency manifests and lockfiles,
  container or devcontainer definitions, and the repo's own agent or tool configuration),
  the review surface states so above the diff, naming each path. This is advisory text on
  top of FR-15's hold, not a substitute for it. The path list is a single declared
  constant, tested against fixtures (Plan).

- **FR-17 (broker input hardening for untrusted runs).** For an untrusted run the broker
  enforces a maximum request size, a request-rate ceiling, and a closed set of accepted
  endpoints and fields; anything else is rejected and logged with the run id. The broker
  never echoes the injected credential, or any header it added, back into a response the
  box can read.

### Security review record

- **FR-18 (the review is a recorded artefact, checked by the gate).** Condition FR-13(d) is
  satisfied by a security-review record for the specific adapter and version, committed to
  the repo and naming the reviewer, date, adapter version, findings and their disposition.
  The gate reads that record; a missing record keeps the gate closed. A review record is
  minted only by the human reviewer, never by an agent on the reviewer's behalf.

### Tier-0 and blast radius

- **FR-19 (nothing here reaches MinSpec core).** As SPEC-019 FR-16: no code path,
  dependency or contract introduced here makes `packages/minspec` or `packages/shared`
  depend on SealBox, a container or VM runtime, the broker, or any network module. If
  FR-11's trust predicate is shared with SPEC-104's Tier-0 detector, only the pure
  predicate and its types live in `packages/shared`.

## Invariants (must hold)

- **INV-1. No untrusted body executes outside an attested kernel boundary (T0).** No code
  path passes an untrusted prompt to a handle whose boundary was not measured as
  `'kernel'` on this dispatch (FR-6, FR-7, FR-12).
- **INV-2. The boundary class fails closed (T0).** Any missing, erroring or disagreeing
  witness yields `'namespace'`, never `'kernel'` (FR-7). A probe never shown to report
  `'namespace'` on a namespace box is broken (FR-8).
- **INV-3. Every SPEC-019 invariant is preserved (T0).** The kernel-boundary adapter
  relaxes none of them (FR-2), and the trusted path behaves exactly as SPEC-019 specifies.
- **INV-4. No silent gate (constitution invariant 2).** The untrusted-dispatch gate names
  the failed condition whenever it blocks; no gate signal is computed with a swallowed
  error (FR-13).
- **INV-5. Blast radius (constitution invariant 3).** SealBox never installs a runtime and
  never edits machine-wide engine or runtime config (FR-4).
- **INV-6. Offline core (constitution invariant 1).** Dispatch fetches no artefact over the
  network; artefacts are pinned by digest (FR-5).
- **INV-7. Untrusted output never leaves without a human (T0).** No untrusted run's diff is
  pushed, and no comment is posted, without a human acceptance (FR-15).

## Acceptance Criteria

*All unchecked: nothing here is built. Each item names the requirement it checks.*

- [ ] **(FR-1, FR-2, INV-3)** A control-plane test suite runs unchanged against the mock
  runner, the docker adapter and the kernel-boundary adapter; no caller file differs
  between them.
- [ ] **(FR-4, INV-5)** With no kernel-boundary runtime present, `spawn` for an untrusted
  dispatch returns `{ ok: false, reason: 'no-kernel-runtime' }`, logs it, and never throws.
  A test asserts the adapter's code contains no write to the engine's daemon or runtime
  config and no runtime install command.
- [ ] **(FR-5, INV-6)** A box spawned from an image whose digest differs from the pinned one
  fails attestation; a test asserts no network call is made during dispatch.
- [ ] **(FR-6, FR-7, INV-2)** Fixtures for each witness outcome (host says kernel / in-box
  says kernel / either errors / either times out / they disagree) produce `'kernel'` only
  for the both-agree case.
- [ ] **(FR-8)** The CI substrate suite runs the boundary-class probe in a plain namespace
  container and asserts `'namespace'`; a deliberately broken probe that always says
  `'kernel'` fails that suite (mutation check of the control itself).
- [ ] **(FR-9)** A test greps user-facing strings of the extension for "escape-proof",
  "unbreakable" and equivalents and finds none.
- [ ] **(FR-10)** Every SPEC-019 FR-6 row and its FR-7 control passes against the
  kernel-boundary adapter on a real runtime in CI.
- [ ] **(FR-11)** Fixtures: author outside the set; editor outside the set; body changed
  since triage; author lookup failing. Each yields `'untrusted'`.
- [ ] **(FR-12, INV-1)** A type-level test (compiled with `tsc`, not only run under vitest)
  shows that passing an untrusted prompt to a namespace-class handle does not compile.
- [ ] **(FR-13, INV-4)** For each of the four unlock conditions, a fixture where only that
  condition fails blocks the dispatch, labels the issue for review, and names that
  condition. No fixture falls back to the namespace adapter or to Layer-1.
- [ ] **(FR-14)** A broker test sends an untrusted-run request containing `web_fetch` and
  `web_search` tool definitions and asserts the forwarded request contains neither; a
  trusted-run request is forwarded unchanged.
- [ ] **(FR-15, INV-7)** An untrusted T1 run with a valid, test-passing diff ends in a
  held-for-review state; no push and no comment occur until a human acceptance is
  recorded.
- [ ] **(FR-16)** Fixtures touching each declared sensitive-path class produce a named
  warning above the diff; a fixture touching none produces none.
- [ ] **(FR-17)** Oversize, over-rate, and unknown-endpoint requests from an untrusted box are
  rejected and logged with the run id; no response contains the injected credential or an
  added header.
- [ ] **(FR-18)** With the review record absent the gate is closed and says so; with a record
  for a different adapter version it is still closed.
- [ ] **(FR-19)** SPEC-019's dependency-graph test still passes: `packages/minspec` and
  `packages/shared` import nothing from SealBox, a runtime, the broker or a network module.

## Risks & Mitigations

| # | Risk | Likelihood · Impact | Mitigation |
|---|---|---|---|
| R1 | **The in-box witness signal does not discriminate on some runtime** (the `boot_id` hypothesis in FR-7 is unverified). | Med · High | FR-8 negative control catches it in CI; FR-7 needs both witnesses, so a bad in-box signal can only make the class `'namespace'` (gate closed), never falsely `'kernel'`. Plan spike confirms the signal per runtime first. |
| R2 | **gVisor syscall coverage or performance breaks real build/test workloads.** I believe some toolchains hit unimplemented syscalls or run slower under gVisor (unverified). | Med · Med | The trusted path is unaffected (docker adapter). An untrusted run that fails for this reason is an infra failure (SPEC-019 CL-6), never a quality signal. DQ-1 option B (microVM) is the fallback adapter. |
| R3 | **Platform reach.** gVisor and Firecracker are Linux-host technologies; on macOS and Windows the container engine runs inside its own Linux VM. | High · Med | DQ-2: untrusted dispatch is offered only where FR-7 attests `'kernel'`. Elsewhere the gate stays closed and says why. Note: the engine's own VM is **not** treated as the kernel boundary, because by default it shares the host user's files into the VM, so escaping to it reaches the user's home directory (I believe this is the default for Docker Desktop's file sharing; unverified per engine). |
| R4 | **Exfiltration through a channel not listed in T-3** (for example, encoding data into model output that a human later copies). | Low · Med | FR-15 keeps a human on every untrusted output; FR-14 closes the only automated outbound channel (broker web tools). Residual named. |
| R5 | **The trust predicate drifts from SPEC-104's.** Two copies of "who is trusted" diverge and one fails open. | Med · High | FR-11: one shared predicate; DQ-3 fixes where it lives. A parity test asserts both call sites import the same function. |
| R6 | **A reviewer approves the adapter once and the gate stays open across upgrades.** | Med · High | FR-18 binds the review record to an adapter **version**; a version change closes the gate until re-reviewed. |
| R7 | **This spec is approved before SPEC-019's Layer-2 milestone exists.** | High · Low | Stated dependency (Context). Plan for this spec does not start until SPEC-019's docker adapter and attestation are built; until then the gate is trivially closed, which is the safe state. |

## Out of scope

- **The docker adapter, model broker and attestation themselves** - SPEC-019's Layer-2
  milestone. This spec extends them; it does not build them.
- **The subscription-oauth broker-injection question** - #74. FR-14 and FR-17 apply
  whichever credential mode the broker uses.
- **The dev-time `scripts/` dispatcher.** It is dev-tooling that ships in no `.vsix`
  (SPEC-019 Out of scope). Its own author-trust and injection checks are SPEC-104 (#70).
- **Remote/cloud sandboxes** - deferred by DR-017.
- **A third (microVM) adapter build.** Named as the second adapter in FR-1; specified here
  only to the extent that FR-3, FR-5 and FR-7 already describe it.

## Decisions needed (Clarify)

Each decision states the recommended option, marked **(rec)**, and the main cost of taking
it.

- **DQ-1 - Which kernel-boundary runtime is the first adapter.**
  - **A. gVisor (`runsc`) as an OCI runtime under the existing engine (rec).** Cost: a
    user-space kernel that intercepts system calls, which is a smaller attack surface but
    not a hardware-virtualisation boundary, and it is Linux-host only. Gain: it reuses
    nearly all of the docker adapter, so it is the cheapest path to a measured kernel
    boundary.
  - B. Firecracker microVM. Cost: needs KVM on a Linux host, a guest kernel and root
    filesystem to pin and ship, vsock plumbing for the broker, and a new lifecycle; the
    largest build. Gain: a hardware-virtualisation boundary.
  - C. Kata Containers (OCI runtime backed by a lightweight VM). Cost: another runtime to
    install and attest, with its own hypervisor dependency and Linux-host requirement.
    Gain: a VM boundary behind an OCI interface, so much of the docker adapter still
    applies.

  This is not a DR: DR-017's "Costly to Refactor" names the substrate choice as "genuinely
  cheap to change" behind the port (DR-017.md:285-287), so no decision record is minted.

- **DQ-2 - What happens on hosts where no kernel boundary can be attested.**
  - **A. Untrusted dispatch is unavailable there; the gate stays closed and names the
    reason (rec).** Cost: macOS and Windows users (and Linux users without the runtime)
    cannot dispatch untrusted issues at all.
  - B. Treat the container engine's own Linux VM as the kernel boundary on macOS/Windows.
    Cost: escaping the container reaches that VM, which by default shares the user's
    files, so the credentials the boundary exists to protect are one step away (see R3).

- **DQ-3 - What "trusted" means, and where the one predicate lives.**
  - **A. Trusted = author and every body editor since triage are in a configured
    trusted-login set (default: only the authenticated user), with the body hash
    unchanged; the pure predicate lives in Tier-0 `@aiclarity/shared` and SPEC-104 and
    this spec both call it (rec).** Cost: an issue filed by a teammate is untrusted until
    the user adds them, and the predicate must be agreed with SPEC-104 before either
    builds.
  - B. Trusted = GitHub's `OWNER` / `MEMBER` / `COLLABORATOR` author association.
    Cost: any collaborator account, including a compromised one, becomes trusted; and the
    association is a server-side claim the offline gate cannot recompute.
  - C. Trusted = a human applies a label per issue. Cost: a manual step per issue, and a
    label is another single producer (constitution invariant 2).

- **DQ-4 - Does an untrusted run's output ever push without a human.**
  - **A. Never; every untrusted diff is held for a human accept (rec).** Cost: untrusted
    issues get unattended *execution* but not unattended *delivery*, so throughput for
    them is bounded by human review.
  - B. Auto-push when FR-16 finds no sensitive path. Cost: the sensitive-path list must be
    complete for every ecosystem, and one omission runs attacker code in CI with
    repository secrets.

- **DQ-5 - Broker web tools for untrusted runs.**
  - **A. Strip server-side `web_search` / `web_fetch` for untrusted runs (rec).** Cost:
    untrusted issues that need web research cannot do it.
  - B. Allow them with a per-repo domain allowlist. Cost: an allowlisted domain that
    serves user content (a paste site, a code host, a search engine) is still an
    exfiltration channel.

- **DQ-6 - Where the trust-class / boundary-class pairing type lands.**
  - **A. A wrapper module owned by this spec, which mints the kernel-class handle and the
    trust-tagged prompt around SPEC-019's unchanged types (rec).** Cost: two places
    describe a handle's capabilities, so a reader must read both.
  - B. Amend SPEC-019's design.md types (`AttestationVerdict.boundary`, a trust-class type
    parameter on `AgentPrompt`). Cost: edits an approved, `implementing` spec, which
    re-opens its approval.

- **DQ-7 - Which repo this spec lives in.**
  - **A. Here, beside SPEC-019, and it moves with SPEC-019 under DR-044's migration (rec).**
    Cost: a SealBox spec stays in the MinSpec register a while longer.
  - B. Author it in the sealbox repo now. Cost: it would cite a spec (SPEC-019) that the
    sealbox repo itself marks as living here, so its cross-references point across repos
    until the migration.

## Follow-ups (tracked)

- **Plan spike: confirm the in-box kernel-identity signal per runtime** (FR-7 item 2, R1).
  Tracked here, in this spec's Plan phase, as a required precondition for FR-7; not a
  separate issue because it has no meaning outside this spec.
- **Trust predicate shared with SPEC-104** (DQ-3, R5) - tracked by SPEC-104 / #70, which is
  in flight; whichever lands second imports the first's predicate.
- **SPEC-019 Layer-2 milestone** (Context, R7) - tracked by SPEC-019 itself and #74.
- **Spec migration to the sealbox repo** (DQ-7) - tracked by DR-044's follow-up.
- **Closing #73** happens only when FR-1 to FR-19 are built and the FR-18 review record
  exists, not when this spec is approved.
