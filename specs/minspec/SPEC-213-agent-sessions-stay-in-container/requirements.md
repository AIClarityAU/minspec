---
id: SPEC-213
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - the same domain as SPEC-037 (approver identity) and the human-decision-witness draft
aspects: [security, identity, credential-boundary, host-vs-container, fail-closed, no-silent-gate, blast-radius, never-wrong]
relates_to: [DR-086, DR-087, DR-105, SPEC-037, SPEC-069, "#1816", "#1872", "#1927", "#2048", "#2172", "#2691", "#2871", "#1614"]
# Ownership declared in Specify, per SPEC-038 FR-3 (requirements.md:45-51: authored BEFORE
# approval, because `implements:` is inside the canonical hash and `canonical.ts` strips only
# `status:` and `phases:`, so adding it later stales the approval). An earlier draft deferred
# it to Clarify on a misreading of SPEC-071's precedent; SPEC-071 itself declares in Specify.
# `implements:` lists only files this spec CREATES (greenfield paths are valid by design):
# the FR-1/FR-2 location probe under D-2 (a)'s recommendation, and its fixture tests (AC-1).
# Revisable at no cost until approval, which is when the set is first hashed; if D-2 resolves
# to (b) the probe entry is dropped. `affects:` lists the existing files FR-3..FR-6 edit but
# do not own.
implements: [scripts/lib/agent-location.sh, packages/minspec/tests/agent-location.test.ts]
affects: [scripts/hooks/host-write-guard.py, packages/minspec/tests/host-write-guard.test.ts, scripts/drain-inbox.sh, scripts/dispatch-issue.sh, scripts/remediate-pr.sh, scripts/triage-inbox.sh, scripts/push-docs.sh, scripts/check-gh-bot-attribution.sh, scripts/lib/gh-bot.sh]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-213: An agent session that is not provably inside the agent container cannot act on GitHub as the founder

> **Specification only.** Nothing is built by the session that wrote this. The founder
> resolves [Decisions needed (Clarify)](#decisions-needed-clarify) and approves the spec
> through the normal approval gate before anything is built. No design.md or tasks.md is
> written for founder sign-off.

## In plain terms

Agent sessions are meant to run in the `claude-agent` container, where no founder credential
can be reached. They can also start on the host machine, where `gh`, the git credential store
and SSH all belong to the founder by design. An agent there can write to GitHub as the founder,
and every signal GitHub exposes reads it as a genuine human act. This has happened: on
2026-09-11 three agent writes were recorded under `harvest316` from panels the editor had
relaunched on the host, and a host-launched session restarted the autonomous drain on the host.

The fix is not to take the founder's credentials off the founder's own machine. It is to make
sure an agent session either runs in the container, or, when it does not, cannot use those
credentials through any path MinSpecPro's own machinery provides, and says so loudly.

One limit governs everything below and is stated first so nothing here is read as stronger than
it is: **on the host, agent code and the launcher run as the same operating-system user as the
founder's credentials.** No check inside that user can stop a process that has decided to reach
them. What this spec can do is close the honest and accidental paths (which is what both
measured incidents were), make every unattended loop refuse to start off-container, and keep the
route into the container witnessed. A true boundary on the host needs a sandbox or a separate
user, and that is named as a decision, not claimed.

## Evidence - what is true today (verified 2026-10-18 on `origin/main` 1b4cf1ad, cited)

**The route into the container.** The editor's Claude Code extension starts its child process
through `claudeCode.claudeProcessWrapper`, which routes by working directory: under
`/home/jason/code` it execs `docker exec -i -u jason -w "$PWD" claude-agent .../claude`, and it
never falls back to the host binary for a `~/code` cwd (host register DR-079,
`/etc/nixos/docs/decisions/DR-079.md:148-158`). That setting lives in the editor's
SyncThing-synced `settings.json`, which DR-079 calls "the single largest residual: a settings
sync from another machine silently returns `~/code` sessions to founder identity"
(`DR-079.md:283-285`). Two more routes bypass it: a host terminal `claude` in `~/code`
(`DR-079.md:316-318`) and any panel started in the window between an editor switch and the
wrapper being set (`DR-079.md:307-310`, the 09:04-09:33 window on 2026-09-11).

**The location witnesses.** `~/.claude/scripts/identity-boundary-check.sh --location` reads two
kernel-provided values: the root mount in `/proc/self/mountinfo` must be a container-runtime
overlay, and `/proc/1/comm` (`docker-init` in this container, measured 2026-10-18) must not be a
host init. Both must agree, else the answer is unknown and the exit code is 2
(`identity-boundary-check.sh:202-234`). It explicitly rejects `/.dockerenv` as a witness,
because on the host `/` is a user-writable tmpfs and a red-team run left a real `/.dockerenv`
there that fooled every check trusting it (`:18-19`, and #1816's 2026-09-11 comment). Note the
pid-1 rule is a denylist: any `comm` other than `systemd|init|runit|s6-svscan|launchd` counts as
container (`:210-214`). The script lives outside this repository, so it is outside this repo's
CI and review, and `host-write-guard.py:50-55` records that its contract "is not
version-controlled here".

**What refuses today.** `scripts/hooks/host-write-guard.py` (#2172) is a `PreToolUse` deny on
`Bash` (`.claude/settings.json:11-15`). Off-container it refuses a simple command whose command
word is `gh` without an explicit `GH_TOKEN=`, and any `git push`, with no in-command remedy for
the push (`host-write-guard.py:116-128`). It calls the location probe live per invocation, not a
cached verdict (`:96-113`), and treats a missing, failing or timed-out probe as host. Its own
docstring states its limit: it reads command text, so writing the call into a script and running
that, or calling the API from Python, evades it (`:26-33`). One fail-open remains:
an unreadable hook envelope returns `allow` before location is consulted (`:131-135`).

**What only reports.** `scripts/hooks/session-identity.sh` (#1927) prints the session's location
and the age of the last full check. It has no refusing exit (`exit 0` at `:41` and `:128`), and
`scripts/hooks/session-start.sh:51` invokes it as `... || true` under the comment "Never fatal".

**Unattended loops do not check where they are.** `scripts/drain-inbox.sh`,
`scripts/dispatch-issue.sh` and `scripts/remediate-pr.sh` contain no call to the location probe
(grep for `identity-boundary`, `--location` and `host-write` returns nothing in all three). Their
`gh` writes are bot-attributed through `scripts/lib/gh-bot.sh`, but that file scopes `git push`
out: "push identity comes from git credentials and commit authorship, not from `gh`. Out of
scope" (`gh-bot.sh:44-45`). The pushes run through `agent_worktree_git push`
(`dispatch-issue.sh:1735`, `:1737`, `:2160`; `remediate-pr.sh:794`, `:945`) and
`git -C "$wt" push` (`push-docs.sh:157`), and so take whatever credential helper the machine
has. In the container that is the DR-079 broker, which returns App tokens only. On the host it is
`credential.helper = store` first, which is the founder (`DR-079.md:319-321`). On 2026-09-11 a
compaction of a host session re-ran `session-start.sh`, which started `drain-inbox.sh --auto` on
the host; it was stopped by PID before it reached a push (#1816, 2026-09-11T04:51Z comment).

**The bot-attribution gate covers `gh`, not push.** `scripts/check-gh-bot-attribution.sh` fails
CI when a script under `scripts/` contains a `gh` write verb without sourcing `gh-bot.sh` and
calling `gh_bot_init` (its header, run from `.github/workflows/ci.yml:124`). It does not look at
`git push`.

**The host-side detector.** `/etc/nixos/tests/agent-container-no-user-credential.sh` Layer 2b
counts host `claude` processes with a `~/code` cwd, classified by cgroup because `/proc/<pid>/ns`
is unreadable under yama (`:1034-1075`). It is the only witness for the wrapper silently
reverting. It runs on the host and lives in the founder's host register, not here.

## One-sentence scope

Every MinSpecPro path that can write to GitHub, interactive or unattended, refuses to run
unless it is provably inside the agent container or has named the bot identity explicitly, and
the location it relies on comes from kernel witnesses tested in this repo's CI.

## Out of scope

- **A witness for human decisions** (acceptance, ratification, a close of a `hold:human` issue).
  That is the other half of #1816, drafted on branch `spec/1816-typed-witness` as
  "SPEC-076-human-decision-witness" (430 lines, never opened as a pull request). Its id is now
  taken on `main` by `SPEC-076-headless-signpost-reader`, so it needs a fresh id before it can
  be proposed. The panel on #1816 (2026-09-26) sequenced it after this work: until a host session
  cannot write as the founder, any witness is a rate-limiter.
- **Same-user routes inside the container** (the broker socket, credential helpers,
  `/proc/<pid>/environ`): #2871, owned by #2691.
- **Coverage of the credential detector** (a path list reports PASS for paths it knows): #2048.
- **The `!gh auth git-credential` fallback in repo-local git config**: #1872.
- **Re-installing the `minspec-sdd` App on `harvest316`** for the twelve harvest316-owned MinSpec
  repos. An account act recorded in host DR-079 (`:293-303`), not a repository change.
- **Writing the editor's settings or any `~/.claude` file.** Constitution invariant 3: MinSpec
  must not change machine-wide config. Where the wrapper setting comes from is a founder host
  act (D-3), recorded here as a dependency only.
- **Other MinSpec repositories.** The guard is wired by this repo's `.claude/settings.json`;
  sessions in other `~/code` repos are covered only by the host detector.

## Functional Requirements

### FR-1 - Location is positive, from kernel witnesses only

A gate in this repo treats a session as "in the agent container" only when **both** hold: the
root mount in `/proc/self/mountinfo` is a container-runtime overlay, and `/proc/1/comm` is in a
**positive allowlist** of container init names (today exactly `docker-init`). Any other value,
an unreadable field, disagreement between the two, or a probe that errors or times out is
`unknown`, and `unknown` is treated as host.

Never a witness: `/.dockerenv`, the hostname, any environment variable, any file an agent can
create, and any cached verdict. The pid-1 denylist at `identity-boundary-check.sh:210-214`
inverts to an allowlist for this repo's gates.

### FR-2 - The probe the gates rely on is under this repo's tests

The location answer every FR here consumes comes from a probe whose behaviour is tested in this
repo's CI: container, host and each `unknown` shape, driven by fixture `mountinfo` and `comm`
inputs, never by the live machine. Where that probe lives is D-2.

### FR-3 - The interactive guard has no fail-open path

`host-write-guard.py` keeps its current rule and closes its one fail-open: an unreadable or
malformed envelope consults location first. In the container it is allowed, as now. Anywhere
else it is denied, with a reason saying the envelope could not be read. The container path's
behaviour does not change at all (INV-4).

### FR-4 - How much a host session may do

A session whose location is not `container`, in a repository with `.minspec/` at its root,
is refused at least every `gh` call without an explicit `GH_TOKEN=` and every `git push`
(today's rule). Whether it is refused more than that is D-1.

### FR-5 - Unattended loops refuse to start off-container, on two witnesses

`drain-inbox.sh`, `dispatch-issue.sh`, `remediate-pr.sh`, `triage-inbox.sh` and `push-docs.sh`
check, before any claim, label, worktree or agent start:

1. **location** (FR-1) is `container`, and
2. **the push credential** git would use for `https://github.com` does not resolve to a GitHub
   account of type `User`, established by asking the API with that credential (`curl` against
   `/user`), never by reading the username field (`x-access-token` is also what a `gho_` token
   is stored under) and never through `gh` (inside a MinSpec repo the wrapper substitutes its
   own token and answers for the bot whatever is passed; #1816, 2026-09-06T20:19Z comment).

Either witness failing, or either being unknown, refuses the start with one visible line naming
which witness failed. Two witnesses because invariant 2 forbids a required check that one
config gap can disable: a wrong location answer alone, or a misconfigured helper alone, must not
let a loop push as the founder. No token value is printed, logged or written to disk.

`session-start.sh` still invokes the drain; the drain refusing is what makes a host compaction
harmless, so the hook needs no location logic of its own.

### FR-6 - A scripted push names its identity

Every `git push` in a file under `scripts/` runs with an identity that does not depend on the
machine's ambient git configuration. How is D-4. `check-gh-bot-attribution.sh` (or a sibling
gate) fails CI on a push site that does not, so the property cannot regress silently. This
retires the "out of scope" note at `gh-bot.sh:44-45`.

### FR-7 - The route into the container is named, never written

MinSpec does not write `claudeCode.claudeProcessWrapper` or any editor or `~/.claude` setting
(invariant 3). Every refusal from FR-3, FR-4 and FR-5, and the session-start banner, names the
remedy: relaunch the panel in the container, or open the `agent (container)` terminal profile.
They never offer an in-session workaround that would leave the session on the host. The witness
for silent reversion of the wrapper stays the host detector's Layer 2b.

### FR-8 - Every artifact states the limit

The guard's deny text, the banner and any doc this work touches say what the control is: a guard
against accidental and honest writes from a same-user process, not a defence against an agent
that has decided to forge. No artifact may describe a host session as "protected" or the boundary
as "enforced on the host". This is the evidence-discipline rule applied to a security claim; a
false all-clear here is the failure #1816 recorded five times.

### FR-9 - Closure is a property, not a point measurement

#1816's host-launch half is closed only by: the CI tests in the ACs below passing, and a
location-stamped `IDENTITY-BOUNDARY [container ...]: PASS` from the host detector after the
founder's D-3 act. A single green probe, a closed issue or an empty file is not evidence
(#1816's thread retracted four all-clears made that way).

## Invariants (must not break)

- **INV-1 (constitution 1, offline).** The location probe is local `/proc` reads, no network.
  The FR-5 credential check makes a network call and exists only in Tier-1 dev scripts that
  already call GitHub; nothing in the extension's Tier-0 core gains a network call.
- **INV-2 (constitution 2, no silent gate).** Every unknown is host; every refusal is visible
  with its reason; no `|| true` on a refusal path; FR-5 has two independent witnesses.
- **INV-3 (constitution 3, blast radius).** Nothing here ships to adopters or writes outside
  this repository. The guard, probe and loop gates are this repo's dev machinery; the editor
  setting and `~/.claude` are never written.
- **INV-4.** In the container, nothing that is allowed today becomes denied. This is the common
  path, and a false deny there stops all work.
- **INV-5.** No token value reaches stdout, stderr, a log, a transcript or a file.
- **INV-6.** No shipped path posts or pushes as the founder. `--admin` stays human-only and
  nothing here grants, eases or wraps it.

## Acceptance Criteria

- **AC-1.** The probe, run against fixture inputs: overlay root plus `docker-init` is container;
  host root plus `systemd` is host; overlay root plus `bash`, host root plus `docker-init`, an
  empty `comm`, an unreadable `mountinfo`, a probe timeout and a present `/.dockerenv` on a host
  root are each `unknown` or host, never container. (FR-1, FR-2)
- **AC-2.** `host-write-guard.py` run as a process with a malformed envelope: allowed with the
  probe stubbed to container, denied with it stubbed to host and to unknown. Every existing case
  in `host-write-guard.test.ts` still passes. (FR-3, INV-4)
- **AC-3.** Each FR-5 script, run with the probe stubbed to host, exits non-zero before any stub
  `gh` write, stub `git push` or stub `claude` is invoked, and prints which witness failed. With
  location stubbed to container but a stub API answering `type: User` for the push credential,
  the same holds. With both clean it proceeds. (FR-5)
- **AC-4.** The CI gate fails on a fixture script containing a `git push` that does not name its
  identity per D-4, and passes on the current `scripts/` tree once FR-6 is built. (FR-6)
- **AC-5.** Across AC-1 to AC-4, a planted fake token never appears in captured output. (INV-5)
- **AC-6.** Every refusal text names a container relaunch as the remedy and contains no claim that
  the host is protected. (FR-7, FR-8)

## Decisions needed (Clarify)

**D-1 - How much may a host session do in a MinSpec repo?**
- (a) Writes only, as today: refuse ambient `gh` and `git push` by command text. Cost: evaded by
  writing the call into a script, so it stops only the accidental path.
- (b) **(rec)** Refuse every `Bash` call when location is not `container`. Read, search and edit
  tools keep working, so a mis-launched session can still explain itself, but it cannot execute
  anything, which removes the script-file evasion for the Bash tool. Cost: the founder cannot use
  a Claude session on the host inside a MinSpec repo for anything that runs a command, including
  legitimate maintenance; that work moves to the container or to the founder's own terminal. It
  still does not stop other execution routes (an edited git hook that the founder's own later
  `git` runs, for example), which is why FR-8 holds either way.
- (c) Run host sessions under Claude Code's own sandbox. Unverified whether that isolates the
  keyring D-Bus socket, the gpg-agent SSH socket and `~/.git-credentials`; not recommended until
  measured.

**D-2 - Where does the location probe live?**
- (a) **(rec)** A small probe in this repo (`scripts/lib/`), used by the guard and the loops and
  tested in CI; `~/.claude/scripts/identity-boundary-check.sh` stays the full credential check
  for every repo. Cost: two implementations of one question that can drift, and the outside one
  cannot be parity-tested from this repo's CI.
- (b) Keep calling the outside script. Cost: the gate's deciding input stays outside review and
  CI, which is how its pid-1 denylist went unexamined.

**D-3 - Where does the editor's wrapper setting come from? (founder host act, not a repo change)**
- (a) **(rec)** Generated from the host's `home.nix`, as DR-079 already lists. Cost: an evening
  of host configuration, and the setting then cannot be changed from the editor UI.
- (b) Leave it in the synced `settings.json` and rely on the host detector. Cost: a sync from
  another machine silently returns `~/code` sessions to the founder's identity until the next
  detector run notices.

**D-4 - How does a scripted push name its identity?**
- (a) **(rec)** Each push site clears the ambient helpers and supplies the bot broker explicitly
  (`-c credential.helper= -c credential.helper=<broker>`), so the push is the bot's wherever it
  runs. Cost: every push site changes, and a broker outage fails the push (already true in the
  container).
- (b) Rely on the FR-5 start gate alone. Cost: one gate per loop; a push site added outside those
  five scripts is uncovered.

**D-5 - Is there an opt-out for a host session?**
- (a) **(rec)** None. The founder's own GitHub acts never need to go through a Claude session.
  Cost: no escape hatch when the container is down; work waits for the container, or the founder
  acts in their own terminal.
- (b) A launch-time environment variable. Cost: an agent can start a nested session with it set,
  so it is a bypass with a name, the shape #1816's panel rejected for `WITNESS_OFF=1`.

## Alternatives considered and rejected

- **`/.dockerenv` or hostname as the witness.** Any process on the host can create the file, and
  one did.
- **Removing the founder's credentials from the host.** They are the founder's own tooling on the
  founder's own machine; the defect is the agent's location, not the credential's existence.
- **Refusing at SessionStart.** I believe a SessionStart hook cannot stop a session from
  continuing (unverified). Either way, a refusal at the first tool call is the same outcome
  without depending on that.
- **Trusting `session-identity.sh`'s cached verdict.** It attests to a past measurement, up to 30
  minutes old, never to the act being gated.
- **MinSpec writing the wrapper setting.** Changes machine-wide config, against invariant 3.
- **Mounting the docker socket to let the container manage launches.** Rootful daemon, so host
  root (DR-079 "Rejected").

## Risks and mitigations

- **A container runtime change misreads as host** (a restart without `--init` changes pid 1 from
  `docker-init`; a move to podman changes the overlay path). Result: every gated call denies, which
  fails closed and visibly. Mitigation: the deny text prints the observed `comm` and mount, so the
  allowlist fix is one line.
- **D-1(b) strands a session the founder meant to use on the host.** Mitigation: read and edit
  tools keep working, and the refusal names the relaunch.
- **The FR-5 credential check costs one API call per loop start.** Negligible against a drain cycle.

## Follow-ups (tracked)

- Human-decision witness: the draft on `spec/1816-typed-witness`, needing a fresh id, tracked on #1816.
- Same-user routes inside the container: #2871, #2691.
- Credential-detector coverage: #2048.
- Repo-local `!gh auth git-credential` fallback: #1872.
- App re-install on `harvest316` and the wrapper's `home.nix` source: host DR-079 (founder register).
