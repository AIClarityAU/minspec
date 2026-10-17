---
id: SPEC-136
type: requirements
status: planning
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology - the checks are the methodology; this makes them reachable where no editor runs
aspects: [headless, core, validator, tool-server, github-actions, zcode, container-boundary, plugin, tier-0, offline, no-silent-gate, blast-radius]
depends_on: [SPEC-001, DR-004, DR-014, DR-037, DR-074]  # SPEC-001 owns the checks being exposed; DR-004 the network tiers the core must stay inside; DR-014 the package map that says where process-spawning code may live; DR-037 the git hooks and the validator package it already names; DR-074 the blast-radius rule
relates_to: [SPEC-076, SPEC-038, DR-015, DR-050, DR-056, DR-066, DR-081, DR-084, DR-087, "#2153", "#14", "#37", "#54", "#248", "#531", "#562", "#2263", "#2297", "#2702", "#2703", "#2708"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). All eight files
# are NEW and are needed under every answer to the open questions below: the one table of
# operations, the two ways in (command line, tool server), and the five tests that pin
# the editor-free property, the sameness of the two ways in, the read-only rule, the
# boundary and the rule that an approval made in the VM stays in its project.
implements: [packages/core/src/operations.ts, packages/core/src/cli.ts, packages/core/src/tool-server.ts, packages/core/tests/no-editor-import.test.ts, packages/core/tests/operations-parity.test.ts, packages/core/tests/read-only.test.ts, packages/core/tests/boundary.test.ts, packages/core/tests/vm-approval.test.ts]
# Modified, not owned. The validate workflow template already names a validator package
# in its third branch; `scaffold.ts` holds the hook-activation step this spec exposes;
# `package.json` gains the workspace. `template-registry.ts` is review machinery, so that
# change needs a human merge. `approval-integrity.ts` is no longer changed: an approval
# made in the VM counts only inside its ZCode project (BND-4, FR-22), so no check on
# approval records is added.
affects: [packages/minspec/src/lib/template-registry.ts, packages/minspec/src/lib/scaffold.ts, package.json]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-136: MinSpec's checks run without the editor - one headless core that works inside the ZCode container, in GitHub Actions and behind any agent

## In plain terms

ZCode now runs as an AppImage in its own docker container on this machine (the NixOS
host), and this editor must never read what ZCode wrote. So MinSpec cannot reach ZCode
through shared folders. (When this was first written ZCode ran in a VM; older text and
your recorded answers below still say "the VM", which now means ZCode's container. See
[Terms](#terms).) This spec builds the piece every route you
named needs first: MinSpec's checks as one small program that runs with no editor, as a
command and as a local tool server. The ZCode plugin, written next as its own spec,
wraps it. You can approve a spec inside ZCode in one step, and work there proceeds at
once, but that approval counts only inside that ZCode project: the host never reads,
trusts or builds on it, and never builds a ZCode project. Cost: a second published
surface, and inside a ZCode project nothing proves an approval was yours. Left out: the
plugin, panels. Riskiest assumption: ZCode's GitHub link can be limited to ZCode projects
only (unmeasured).

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. A human reads
> it, and approves it through the normal spec-approval gate before any design or code.
> Every question under
> **[Open questions for the founder](#open-questions-for-the-founder)** is answered and
> recorded there: four of the five earlier questions as recommended, the fifth reversed
> by the founder and rewritten as section F, and what an approval made in ZCode is worth
> on the host (OQ-1) and what to do if the GitHub link cannot be limited (OQ-2) on
> 2026-10-13.

**Where this came from.** The founder, 2026-10-12, verbatim: "also make a spec to adapt
minspec to zcode in the next week." and "zcode is by z.ai". Then, 2026-10-13, after
reading the first draft, verbatim:

> zcode. we just moved zcode into a VM and decided that it's safer for this (here) codium
> instance should not be able to be "infected" by reading from folders written to by
> zcode.  would a local MCP endpoint help?  or perhaps moving more of minspec into github
> actions?  but we still want to use the Claude Max subscription not PAYG API tokens.  i
> see that zcode allows custom plugins so perhaps it's best to ship a variant of minspec
> as a zcode plugin.  (we will eventually want to ship plugins for all the IDEs.)

**Answers received.** The founder, 2026-10-13, verbatim: "zcode: do as recommended,
except for where approvals are made.  i should be able to approve specs for the current
project in zcode.  unrelated: i don't expect COS to see inside zcode." ("COS" is the
supervising chief-of-staff loop on the host.)

**Further facts from the founder, 2026-10-13, verbatim** (these replace the earlier
assumption that no login of his exists in the VM):

> regardless of whether its in codium, zcode or whatever, i don't want to be ever
> presented with an approval request that hasn't been AI-reviewed, oh, but it's the other
> way round, Alt-A > PR > ai-review, which is just as good. isn't that the same for zcode?

> i dont plan on opening the zcode projects in codium, and they're blocked from your
> sight, actually, eg: ~/code/Lovefest is a zcode project.

> you know i'm gonna rubber-stamp the specs anyway after the first few look good

> i already linked github into zcode but i should at least limit the oauth to certain
> projects.

**What changed from the first draft.** The first draft had MinSpec stay in the editor
and meet ZCode through files in the project. That is the thing now ruled out. Its four
open questions are withdrawn. This document replaces it under the same id and pull
request.

**This is the first of two specs.** The three routes he named all need the same thing
underneath, so it is specified first, here. The second, **the ZCode plugin shell**
(commands, skills, hooks, the tool-server wiring, optionally a panel), is tracked as
#2702 and is not written yet.

**Id note.** `SPEC-136` was the highest claimed id plus one when first taken (read
2026-10-11 20:40 UTC across `origin/main` at `41f41571`, the 43 open pull requests and
remote branch names). No gate checks spec ids across pull requests (#2055). If it
collides at review time, renumber.

**Tier note.** T4 (complete ceremony). By file count this is about twelve files, which the
classifier maps to T3 (`packages/minspec/src/lib/git-analyzer.ts:34-39`). It is raised
to T4 because it adds a package, a published contract other programs will depend on,
and a change to a review-machinery template. The predicted tier is a floor.

**Code read from** `origin/main` at `41f41571`. `main` had moved to `28b247e9` by the
time this was rewritten; the cited lines were not re-read against it.

## One-Sentence Scope

Package the checks MinSpec already has (validate, hash, status, next action, hook
activation) and the approval act as one editor-free Node program with two ways in, a command line and a
local stdio tool server, so that the same code can run inside the ZCode container, in GitHub
Actions and behind any agent, without the host ever reading what the VM wrote.

## The boundary (set by the founder 2026-10-13; an invariant of this spec)

- **BND-1 - One bridge.** Nothing on the host reads a file ZCode wrote, except content
  that arrived through git by way of GitHub. No shared folder, no mounted drive, no
  copied directory. With ZCode in a docker container this means: ZCode's working trees
  live only in the container's own storage (its filesystem or a docker-managed volume),
  never in a host bind mount; no host path is mounted into the container, read-only or
  otherwise; and no display, clipboard or audio socket of the host (X11, Wayland,
  PulseAudio, PipeWire) is shared with it. If the AppImage needs a display, it gets one
  that lives inside the container or is reached only through a viewer that passes no files.
- **BND-2 - No listener.** Nothing MinSpec ships opens a network port on the host for
  the VM to call, and nothing in the VM is given a port on the host. ZCode's container
  does not use the host network (`--network host` is forbidden) and publishes no ports
  (no `-p` or `--publish`), so nothing in it can reach a service that listens only on the
  host's loopback address, and nothing on the host is reachable through it.
- **BND-3 - The VM is not the gate.** A check that runs inside the VM is help for the
  agent working there. Whatever is being kept out of the host can switch it off. The
  checks that decide a merge run on GitHub.
- **BND-4 - An approval made in the VM counts only inside that ZCode project.** An
  approval made inside the VM takes effect inside that project at once. The host never
  reads, trusts or builds on an approval that originated in the VM, and never builds a
  ZCode project. The VM's GitHub grant is a fine-grained personal access token that reaches
  ZCode repositories only (stated by the founder, not measured), never MinSpec and
  never any repository a host builder acts on, so an approval made in the VM has no path
  into a repository the host trusts. (Founder, 2026-10-13: "i should be able to approve
  specs for the current project in zcode." This replaces the earlier wording, which
  barred any approval in the VM, and the wording after it, which let an approval cross
  to main after an outside review. The outside review is kept as a rejected-for-now
  alternative, OQ-1.)
- **BND-5 - No supervision reaches in.** Nothing on the host watches, lists, messages
  or steers sessions inside the VM, and nothing MinSpec runs in the VM reports to the
  host. The host learns of VM work only from GitHub. (Founder, 2026-10-13: "i don't
  expect COS to see inside zcode.")
- **BND-6 - Container confinement.** ZCode's container cannot act as the host. It is
  not given the docker socket (`/var/run/docker.sock` or a rootless equivalent), since
  anything holding that socket can start a container with the host's filesystem mounted;
  it is not run `--privileged`; it has no added capabilities (no `--cap-add`) and no
  security profile switched off (no `seccomp=unconfined`, `apparmor=unconfined` or
  `label=disable`); it shares no PID or IPC namespace with the host (no `--pid host`, no
  `--ipc host`); and root inside it is not root on the host (rootless docker or a user
  namespace remap; a non-root user inside is not enough on its own, because anything that
  becomes root inside a rootful container is then root on the host). Together with BND-1 this is what keeps the
  host's credentials (`~/.claude`, `~/.ssh`, the founder's GitHub login, every `.env`)
  out of the container's reach. This is a property of how the founder starts the
  container, not of MinSpec's code: nothing MinSpec ships can check it from inside, and
  measurement 12 records it. **Leftover risk, stated plainly:** a container shares the
  host's kernel. A kernel exploit run inside the container escapes it, and then BND-1 to
  BND-6 all fail at once. A VM did not share the kernel; this move accepts that risk.

**Why git through GitHub is the bridge, and its limit.** It is the one channel where
every change is a reviewable diff and passes checks the VM cannot turn off: all 19
workflow jobs in this repository run on `ubuntu-latest`, GitHub's machines, not the
host. Its limit: a pull brings files onto the host, and some files run there. The set of
paths that forces a human look today is six folders and two files
(`packages/minspec/src/lib/machinery-paths.ts:52-59`, `:75-78`); `.claude/`, `.vscode/`
and a project's `.minspec/hooks/` are not in it. That gap is filed as #2708 (files that
execute on the machine that pulls them are not in the machinery set) and is the main
risk to BND-1.

## Context - what a ZCode plugin can do (Z.ai's own pages, read 2026-10-11 to 2026-10-13, untested here)

- **What it bundles.** "A single plugin can bundle skills, commands, subagents, and MCP
  servers", plus hooks (https://zcode.z.ai/en/docs/plugin). The layout is a folder with
  `.zcode-plugin/plugin.json`, then `commands/`, `skills/`, `agents/`,
  `hooks/hooks.json`, `.mcp.json`. A `.claude-plugin/plugin.json` manifest is also
  accepted (same page).
- **Its hooks do run.** The hook sources that execute are the user's
  `~/.zcode/cli/config.json` and "Plugin hooks/hooks.json ... Auto-discovered at the
  standard location, follows the plugin's enable state"; "Project-level hooks are not
  executed in the current version" (https://zcode.z.ai/en/docs/hooks). Seven events
  exist; `PreToolUse` can "Allow, ask, or deny the tool", and `Stop` can send the agent
  back to work up to three times. A different Z.ai page disagrees for one case: the
  repository's command-line README says "Unsupported Claude plugin fields are ignored
  with diagnostics rather than executed. This includes `hooks`, `agents`"
  (https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/README.md). Not resolved.
- **What it can read and run.** "Enabling a plugin grants code-execution trust. Enabled
  third-party marketplace plugins can run local processes and read the inherited Agent
  environment variables" (https://zcode.z.ai/en/docs/plugin). Hook scripts in the
  examples rely "on node being available on the system PATH"
  (https://zcode.z.ai/en/docs/hooks).
- **How it is installed.** Through a "marketplace", which can be "A GitHub repository",
  "A Git URL" or "A local marketplace file or directory"; an entry can also name an npm
  package (https://zcode.z.ai/en/docs/plugin). So a plugin can enter the VM from GitHub
  with no host folder involved.
- **It can have a panel.** "A UI Plugin adds an interactive page to an ordinary plugin
  ... The page communicates with the host through MCP Apps; the plugin's MCP server
  manages application data." Pages "currently run in local workspaces in ZCode Desktop"
  only (https://github.com/zai-org/ZCode/blob/main/UI_PLUGIN.en.md). This is in the
  repository, not on the documentation site.
- **Tool servers (MCP).** Supported as local `stdio` commands and as remote `HTTP` or
  `SSE` services. Configured per user in `~/.zcode/cli/config.json`, per project in
  `<project root>/.zcode/config.json`, or inside a plugin's `.mcp.json`; project
  servers "connect automatically at session start"
  (https://zcode.z.ai/en/docs/mcp-services).

## Context - where MinSpec's checks live, and how tied they are to the editor (measured)

- **The stated home holds a fraction.** `packages/shared` is 7 files and 2,306 lines:
  the hash (`packages/shared/src/canonical.ts:126`), the next-action resolver, the
  reference parser and three small models. The validator, the lifecycle and the
  scaffold are not there.
- **The real core is the extension's library, and it is almost editor-free already.**
  `packages/minspec/src/lib/` is 78 files and 38,411 lines. Six import the editor API
  (`active-adr.ts`, `active-spec.ts`, `approval-diff.ts`, `diagnostics.ts`,
  `presence.ts`, `resolve-folder.ts`) and one more reaches one of those through a
  sibling import (`tidy-primary.ts`). The other 71 do neither. Method: a text search for
  `from 'vscode'` and for `./` imports between those files; not a compiler pass.
- **The editor-bound part is separate.** 20 command files, 11 view files and
  `extension.ts`, 11,037 lines, all on the editor API. This is the interface, and no
  route below carries it.
- **Headless use already happens, by script.** `scripts/facts.ts:54-69` and
  `scripts/next-task.ts:48-53` import the library and `packages/shared` and run under
  Node with no editor. SPEC-076 (headless signpost reader) made one check reachable
  this way. They run from this repository's source with a TypeScript runner; nothing is
  packaged, and there is no `bin` entry anywhere.
- **It cannot simply move into `packages/shared`.** DR-014 (shared-code boundary) bars
  `child-process spawn` from that package (`docs/decisions/DR-014.md:53`), and 17 of the
  library files start a process (`git`, `gh`, `claude`). A separate package is the
  shape that decision already asks for.
- **There are three validators today, not one.** The extension's
  (`packages/minspec/src/lib/spec-validator.ts:1157`); this repository's own script
  (`scripts/validate-frontmatter.ts`, 971 lines, with rules that exist only there); and
  a Python one shipped to adopters (`packages/minspec/src/lib/template-registry.ts:1782`)
  whose own header says it is "not an exact twin of the Node validator" (#2297). The
  shipped validate workflow already has a branch for a Node package,
  `@aiclarity/minspec-validator` (`.github/workflows/minspec-validate.yml:41-43`), which
  has never been published (#248).

## Context - GitHub Actions and the Claude subscription (read from the workflows)

- **Which steps need a model at all.** Two. The AI review of a pull request
  (`scripts/review-branch.sh:292-295`) and the optional AI pass of epic backfill
  (`packages/minspec/src/lib/epic-backfill.ts:683-684`), which runs in the editor.
- **The AI review already runs in Actions on the subscription.** Its credential is
  `CLAUDE_CODE_OAUTH_TOKEN`, made by `claude setup-token`, described in the workflow as
  "a genuine-CLI subscription OAuth token" (`.github/workflows/ai-review.yml:101-102`)
  and passed at `:282`. Pay-as-you-go is a second, optional path that is used only when
  a repository variable is set to `payg` and a key is present (`:269-270`, `:283-284`).
  So the constraint he stated is met today and nothing here changes it.
- **Everything else needs no model.** Validation (`minspec-validate.yml:34-43`), the
  secret scan, the merge-readiness and docs-lane workflows, and the git hooks.

## The routes

"Crosses" means what passes between VM and host, and which way.

| | (a) ZCode plugin in the VM | (b) Local tool server (MCP) | (c) More in GitHub Actions | (d) A second editor in the VM |
|---|---|---|---|---|
| What it is | A plugin carrying commands, skills, hooks and a tool server | A server exposing validate, hash, status and next action to any agent | The checks run on GitHub when the VM pushes | VSCodium plus MinSpec installed beside ZCode inside the VM |
| Crosses | In: the plugin, from GitHub. Out: git push to GitHub. Host reads nothing | **On the host:** the VM calls the host, so the host parses what ZCode sent. Breaks BND-2. **In the VM:** as (a) | Out: git push. Host reads results from GitHub, and files only after merge | In: the extension file. Out: git push |
| Carries | Whatever the 71 editor-free files do, once something headless exists to call. No panels unless rebuilt as plugin pages | The same, but only when the agent chooses to call a tool. Advice, not a gate | Everything with no model, plus the AI review. No help while writing, no commands | All of MinSpec, panels included |
| Needs first | The headless core | The headless core | The headless core, for adopters to run the full validator instead of the Python subset | The file-based work of this spec's first draft |
| Serves other IDEs | Only ZCode and, by manifest, Claude Code | Yes: tool servers are configured the same way across agents | Yes: agent-independent | No |
| Best if | You want commands and write-time checks inside ZCode | You accept advice with no enforcement | You accept feedback only at push time | You want it this week and accept approvals made inside the VM |

**Recommendation: the plugin is the right shell and the wrong first step.** All three
routes he named are thin layers over one thing that does not exist yet: MinSpec's
checks as a program that runs with no editor. Build that once, then the plugin (a) is
mostly manifest and prose, the tool server (b) is one of its two ways in, and Actions
(c) can run the full validator for adopters. The code supports this: 71 of 78 library
files are already editor-free, so it is packaging, not a rewrite.

**Testing his lean toward the plugin.** Two findings cut against making the plugin the
whole answer.

1. *A plugin cannot be the gate.* It runs inside the VM, which is the thing being kept
   at arm's length (BND-3). The gate is on GitHub and mostly exists. The plugin is worth
   building for speed and guidance, not for safety.
2. *A plugin format is per product.* A tool server is not. If "plugins for all the
   IDEs" is the destination, the durable part is the core with a tool-server way in;
   each IDE then needs only a small wrapper. The "one shared core, thin shells" shape
   holds against the code, with one correction: the core is not `packages/shared`, it is
   the extension's library, and it needs Node on the machine.

**A local tool server on the host is rejected outright.** It answers "would a local MCP
endpoint help?" with: yes inside the VM, no across the boundary. Run on the host for
the VM to call, it would have the host parse requests written by ZCode's agent, and it
would need the project files, which are in the VM.

**What would make each other route the better choice.**

- *(d) second editor in the VM* is better if next week matters more than building anything:
  it costs nothing beyond the first draft's file work, and approvals made there would
  cross under the same rule as section F.
- *(c) Actions alone* is better if ZCode sessions do not need MinSpec's commands or
  write-time checks at all, only a verdict on what they push.
- *(a) plugin first, prose only* is better if a visible ZCode result next week matters
  more than checks: commands and rules need no core. He chose core first (answered 2026-10-13).

## Terms

- **Core.** The new package: MinSpec's existing checks, callable with no editor.
- **Operation.** One thing the core does: validate, hash, status, next, activate,
  approve.
- **ZCode container.** The docker container on the host in which ZCode runs as an
  AppImage. Where this document, including the founder's recorded answers, says "the VM",
  it means this container: ZCode ran in a VM when those words were written, and the move
  to a container changes the boundary only as BND-1, BND-2 and BND-6 now state.
- **Host.** The NixOS machine ZCode's container runs on, and every other container on
  it. Anything outside ZCode's container is the host.
- **ZCode project.** A project opened in ZCode whose working tree exists only inside
  ZCode's container (for example `~/code/Lovefest`). The host does not read it and does not build it.
- **Host-built repository.** Any repository the host's builders, sessions or checks act
  on, MinSpec itself included.
- **Tool server.** A local program an agent talks to over standard input and output
  using the Model Context Protocol (MCP).
- **Shell.** A per-product wrapper around the core: the VS Code extension today, the
  ZCode plugin next.

## Functional Requirements

### A. One core, no editor, no second copy of the rules

- **FR-1 - Starts with no editor.** The core MUST load and run under plain Node with
  the editor API absent. A test MUST fail if any file reachable from the core's entry
  imports the editor API, directly or through another file.
- **FR-2 - Calls the existing code.** Every operation MUST call the same function the
  extension calls for that check. The core MUST NOT contain a rule of its own. A test
  MUST show that for a fixture project the core and the extension's function return the
  same verdicts.
- **FR-3 - No fourth validator.** The core's `validate` MUST run at least every check
  the shipped Python validator runs, shown by one fixture corpus run through both. Which
  rules of `scripts/validate-frontmatter.ts` move behind it is for Plan to list; each
  one left out MUST be named with a reason, because that script holds rules that exist
  nowhere else.
- **FR-4 - Offline and quiet.** No operation makes a network call, and none starts any
  program except `git`. In particular none starts `gh` or `claude`. A test MUST run
  every operation with the network unavailable.

### B. The operations

- **FR-5 - Five checks, to start (the approval act is section F).** `validate` (the project's specs and decisions pass or
  fail, with each finding); `hash` (the approval hash of one spec, as
  `packages/shared/src/canonical.ts:126` computes it); `status` (each spec's derived
  status, as `packages/minspec/src/lib/lifecycle.ts:133` derives it); `next` (the one
  next human action, by the same pair SPEC-076 uses); `activate` (point this clone's git
  at the project's scaffolded hooks, as `packages/minspec/src/lib/scaffold.ts:986` does
  today from inside the editor).
- **FR-6 - Read-only, with two named exceptions.** `validate`, `hash`, `status` and
  `next` MUST NOT write anything. `activate` writes one value in the clone's own git
  configuration and nothing else. `approve` writes what section F says and nothing
  else. A test MUST compare the project tree before and after every operation.
- **FR-7 - Nothing else changes approval state.** No operation other than `approve`
  may record an approval, advance a phase or edit an approval record. A test MUST fail
  if a second operation with that effect is added to the table.
- **FR-8 - Refuses a project that did not opt in.** Given a folder without `.minspec/`
  at its root, every operation MUST refuse with a message that says so, and MUST NOT
  report it as having nothing wrong (the rule SPEC-076 already applies).

### C. Two ways in, one table

- **FR-9 - A command line.** Each operation is callable as a command that prints a
  machine-readable result and exits non-zero on a failed check, on a refusal, and on
  any error. Unreadable input is a failure, never a pass (constitution invariant 2).
- **FR-10 - A local tool server.** The same operations are offered as tools over
  standard input and output only. The server MUST NOT open a network port and MUST NOT
  offer an HTTP or SSE form (BND-2). A test MUST fail if the server binds a socket.
- **FR-11 - One table drives both.** The command line and the tool server MUST be
  generated from one list of operations, and a test MUST fail when an operation is
  reachable one way and not the other.
- **FR-12 - Not a user command.** The command line is for hooks, workflows and agents.
  No MinSpec document, prompt or shipped rule may tell a person to type it in place of a
  Command Palette entry (answered 2026-10-13).
- **FR-26 - The tool server declares what each tool does to the project (added
  2026-10-16, #2736 point 4).** The tool server MUST declare `validate`, `hash`, `status`
  and `next` as read-only and not destructive, and MUST declare `activate`, which writes
  git configuration (FR-6), as destructive. The declarations come from the same table as
  the operations (FR-11), so a tool cannot be offered without one. A test MUST fail when
  a listed tool has no declaration, or when a tool FR-6 lets write is declared read-only.
  This is what lets an agent host that restricts a planning mode to read-only tools, such
  as ZCode's `plan` mode, allow the four checks and still stop `activate`.

### D. Getting it into the VM and onto GitHub

- **FR-13 - One file, nothing to install beside it.** The built core MUST be a single
  file that needs only Node, so a plugin or a workflow can carry it without a
  dependency install.
- **FR-14 - Reaches the VM without the host.** The core MUST be obtainable inside the
  VM from GitHub alone. No step may involve a folder the host and the VM both see
  (BND-1). It is published as a build on GitHub (answered 2026-10-13).
- **FR-15 - The validate workflow uses it.** The Node-package branch that already
  exists in the shipped workflow (`minspec-validate.yml:41-43`) MUST resolve to this
  core or be changed to. #562 and #2263, both about that fallback chain, are read
  before the change. The job MUST still fail when no validator ran.
- **FR-16 - Version on record.** Every result MUST carry the core's version, so a
  verdict from the VM and one from GitHub can be told apart when they disagree.

### E. Boundary

- **FR-17 - Stays inside the project.** Given a project root, the core MUST NOT read
  or write outside it, other than what `git` itself reads. It MUST NOT touch `~/.zcode`,
  `~/.claude` or any other machine-wide location (constitution invariant 3).
- **FR-18 - Says what it is.** Every result from the core running in the VM is advice
  (BND-3). No MinSpec surface may present a pass from inside the VM as the pass that
  permits a merge; that comes only from the checks on GitHub.

### F. Approving a spec inside ZCode

What an approval is today, from the code: a record whose approver is "git config
user.email at approval time" (`packages/minspec/src/lib/approval.ts:65`, `:357-360`),
refused when that address is a known agent's (`:447`). The check that re-verifies a
record on GitHub exists and is advisory, not required
(`scripts/approval-integrity.ts:17-21`). So even on the host the proof that a person
approved is an address anyone with a shell can set; #2153 (decision-record acceptance
has no deterministic witness) is the same gap for decision records. Inside the VM the
agent has a shell. No rule in this section pretends otherwise.

- **FR-19 - One step in the VM.** The core's `approve` operation records an approval
  for a spec in the project it is run in, by calling the function the extension calls
  (`approval.ts:523`), with every refusal that function already makes. Inside the VM
  that approval is effective at once, in that ZCode project only: the next phase may
  start there.
- **FR-20 - A person's entry point, not a tool.** `approve` MUST NOT appear in the
  tool server's list of tools the model can call. It is reachable from the command
  line and, in the second spec, from a button the model cannot press. This stops an
  agent approving by accident or by habit. It does not stop a session that sets out to:
  that session has a shell.
- **FR-21 - The VM's GitHub grant excludes every host-built repository.** The grant the
  VM holds on GitHub MUST be limited to ZCode projects. It MUST NOT reach MinSpec or any
  repository a host builder acts on. ZCode's GitHub access is a fine-grained personal
  access token that reaches the founder's ZCode repositories only; the earlier OAuth
  link is removed and he reports no other login of his in the VM (founder, 2026-10-13:
  "i gave it a fine grained PAT instead." and "zcode repos only, oauth removed, no other
  logins"). This is stated by the founder, **not measured** (measurement 8). The earlier
  rule "no credential able to act as the founder inside the VM" is withdrawn; this limit
  replaces it. If measurement 8 shows the token reaches more than ZCode repositories,
  the limit of this requirement is not met and the recommendation of OQ-1 falls back to
  its outside-review alternative.
- **FR-22 - The host never trusts a VM approval and never builds a ZCode project.**
  Host tooling MUST NOT read, count or build on an approval record that originated in the
  VM, and no host builder, session or check may act on a ZCode project. The protection is
  the separation itself, not a mark on the record: a mark written inside the VM would be
  written by whatever the VM runs (see the rejected per-side record kind). No check is
  added to `scripts/approval-integrity.ts`. The earlier design (a check that failed a
  pull request adding an approval record without an outside review) is dropped here; it
  also collided with that script's existing refusal of a pull request that both
  introduces and approves a spec (`scripts/approval-integrity.ts:185-191`).
- **FR-23 - AI review before he is asked, or straight after.** In ZCode he MUST NOT be
  presented with an approval request for a spec that has not been AI-reviewed, OR the
  pull request that carries the approval MUST be AI-reviewed straight after (he accepts
  either order; on the host the order is review first, then the ask, then a small
  approval pull request: `docs/decisions/DR-081.md:109-114`, `DR-063.md:50`). Whether
  ZCode-project repositories run the AI review at all is **unmeasured** (measurement 11).
  If they do not, this requirement cannot be met there, and that is reported, not hidden.
- **FR-24 - The host reads approvals from main only, so the host changes nothing.**
  Host tooling keeps reading approval records from the checkout as it does today. It MUST
  NOT read an approval from a branch, a pull request, a ZCode project or any place other
  than what the host pulled from main.
- **FR-25 - No reporting to the host.** The core in the VM MUST NOT write session,
  presence, heartbeat or queue records, and MUST NOT open any channel to the host
  (BND-5).

**What this guarantees.** Host-built repositories never carry an approval that was made
in the VM, provided the VM's GitHub grant excludes them (FR-21) and the host builds no
ZCode project (FR-22), and the container cannot read host credentials (BND-6). The
guarantee rests on that separation and on nothing else.

**What it does not guarantee.** Anything inside a ZCode project. There, nothing proves an
approval was his: the agent has a shell and can set the author address (FR-19 note), and
the VM holds a GitHub token of his (limited to ZCode repositories), so even an approving
review from his account would prove nothing for any repository that token reaches. A session in a ZCode project can
build on a spec it approved itself. That he read the spec: no mechanism proves attention,
and he has said he will rubber-stamp specs once the first few look good. The protection
is also gone the day the host starts building a ZCode project, or the VM's grant reaches
a host-built repository. ZCode's built-in browser can import "cookies and local storage
from your most recently used Chrome profile" and the agent can drive that browser
(https://zcode.z.ai/en/docs/browser-use), so a signed-in browser in the VM acts as him
wherever his login reaches.

**What a compromised ZCode session could still do.** Approve its own spec and build it,
inside the VM, in ZCode projects. What stops that reaching the host: the VM's grant does
not reach host-built repositories (FR-21); the host builds no ZCode project and trusts no
VM approval (FR-22); and the host reads approvals from main only (FR-24). What does not
stop it: a grant that turns out wider than intended (measurement 8).

**His effort per approval.** One act in ZCode. Nothing further: no second tap, no hardware
key, no outside review for approvals in ZCode projects.

## Costly to Refactor

1. **The names and result shapes of the operations.** Why costly: a plugin, a
   workflow and other agents will call them; changing one breaks callers MinSpec does
   not ship with. What to check: results are versioned (FR-16) and the first release is
   marked unstable.
2. **A command line existing at all.** Why costly: the project's own instructions say
   MinSpec is "a VS Code extension, not a CLI", and goal G-7 names a separate CLI as the
   thing MinSpec is not. Once shipped, adopters will script against it. What to check:
   the answer of 2026-10-13 is recorded as a decision before Plan.
3. **Where the core is published.** Why costly: a public package name cannot be
   taken back.
4. **The package boundary.** Low - the core imports the library where it sits; moving
   files later is internal.

## Acceptance Criteria

- [ ] **Runs with no editor** - every operation completes under plain Node on a machine
      with no editor installed, and the import test fails when an editor import is
      introduced. (FR-1)
- [ ] **Same verdicts** - for the fixture project the core's results equal the
      extension function's, and the core's `validate` finds everything the Python
      validator finds. (FR-2, FR-3)
- [ ] **Nothing leaves the machine** - all operations pass with the network off, and
      the only child process is `git`. (FR-4)
- [ ] **Nothing is written** - the project tree is byte-identical after `validate`,
      `hash`, `status` and `next`; `activate` changes one git setting. (FR-6)
- [ ] **One approval path** - only `approve` changes approval state, and the test that
      guards this fails when a second such operation is added. (FR-7)
- [ ] **Approve in ZCode, one step** - inside the VM one act records the approval and
      the spec's next phase can start there at once, in that ZCode project, with nothing
      further asked. (FR-19)
- [ ] **Not callable by the model** - the tool server's list of tools has no `approve`.
      (FR-20)
- [ ] **The VM cannot reach a host-built repository** - the VM's GitHub grant, as
      measured, reaches ZCode projects only; a push from the VM to MinSpec is refused.
      (FR-21)
- [ ] **The host ignores a VM approval** - host tooling reads approval records only from
      what it pulled from main, and no host builder acts on a ZCode project. (FR-22,
      FR-24)
- [ ] **AI review is not skipped in ZCode** - he is not asked to approve a spec that has
      not been AI-reviewed, or the approval's pull request is AI-reviewed straight after.
      (FR-23)
- [ ] **No reach in** - nothing the core writes in the VM is a session, presence or
      queue record. (FR-25, BND-5)
- [ ] **Refuses the un-opted** - a folder without `.minspec/` gets a refusal and a
      non-zero exit, not an empty pass. (FR-8)
- [ ] **Two ways, one set** - the command line and the tool server offer exactly the
      same operations. (FR-11)
- [ ] **No port** - the tool server binds no socket. (FR-10, BND-2)
- [ ] **Tools say what they do** - the tool server's list declares `validate`, `hash`,
      `status` and `next` read-only and `activate` destructive, and no listed tool lacks
      a declaration. (FR-26)
- [ ] **Fails loudly** - a spec that cannot be read makes `validate` exit non-zero with
      the file named. (FR-9)
- [ ] **Usable in the VM** - inside the VM, with nothing shared from the host, the core
      is fetched from GitHub, `activate` is run on a clone, a commit triggers the git
      hooks, and ZCode calls `validate` as a tool. (FR-13, FR-14, the measurements below)
- [ ] **Adopter CI runs it** - a scaffolded project's validate workflow runs the core
      and still fails when no validator is present. (FR-15)

## Invariants (must not break)

- **INV-1 - Offline core** (constitution invariant 1). FR-4.
- **INV-2 - No silent gate** (constitution invariant 2). The core fails closed (FR-9),
  the workflow still fails when no validator ran (FR-15), and a pass inside the VM is
  never shown as the merge gate (FR-18).
- **INV-3 - Blast radius** (constitution invariant 3, DR-074). The core acts only on a
  project with `.minspec/` (FR-8) and touches nothing machine-wide (FR-17).
- **INV-4 - The VM boundary** (BND-1 to BND-6 above). FR-10, FR-14, FR-18, FR-19 to
  FR-25. An approval made in the VM stays in its project (BND-4, FR-22).
- **INV-5 - Tier map** (DR-014). Code that starts a process stays out of
  `packages/shared`; the core is its own package.

## Open questions for the founder

### Answered 2026-10-13

The founder, verbatim: "zcode: do as recommended, except for where approvals are made.
i should be able to approve specs for the current project in zcode."

- **What "infected" covers - answered: as recommended.** Files that run on the host
  are the hard line; text is reviewed data that arrives through GitHub. Accepted cost:
  text written by a misbehaving ZCode session can still be read by a host agent after
  merge, and the hard line is not fully drawn until #2708 is done.
- **Where approvals are made - answered: reversed.** "i should be able to approve
  specs for the current project in zcode." Section F and BND-4 are the result. One
  question about it remains, below.
- **Where the core is published - answered: as recommended.** A build attached to this
  repository on GitHub; no public package yet. Accepted cost: installing is a download
  or a git address, and #248 stays open.
- **What ships first - answered: as recommended.** The core first; the plugin spec
  (#2702) may start its prose-only part in parallel.
- **A command line - answered: as recommended.** Allowed, machine-facing only (FR-12).
  The decision record is still owed before Plan.

### OQ-1 - What may the host take on trust from an approval made in ZCode?

**Answered 2026-10-13: Option A.** The founder did not overrule the recommendation. His
words, 2026-10-13: "zcode: do as recommended, except for where approvals are made. i
should be able to approve specs for the current project in zcode." An approval made in
ZCode counts only inside that ZCode project; the host never trusts or builds on one.

The question as asked: he said he should be able to approve in ZCode, that he does not plan to open ZCode
projects on the host, and that he will rubber-stamp specs after the first few look good.
The options differ in what a misbehaving ZCode session can get into a host-built
repository and in what each approval costs him. **This is a recommendation; the founder
has been told and may still overrule it.**

- **Option A - the approval counts only inside that ZCode project; the host never trusts
  or builds it (rec; section F as written).** No extra tap, no hardware key, no outside
  review. *Cost:* inside a ZCode project nothing proves an approval was his, and a
  session there can build on a spec it approved itself; the protection depends on the
  VM's GitHub grant excluding every host-built repository (FR-21, unmeasured), and is
  gone the day the host starts building a ZCode project.
- **Option B - one approving review on GitHub, outside the VM, before an approval lands
  on main (the earlier recommendation).** *Cost:* one approving review per pull request
  that carries approvals; a one-time change by him to make a check required; a GitHub
  identity for the VM that is not his; and, with his token held in the VM, the review
  proves nothing for any repository that token reaches. Given that he will rubber-stamp,
  the tap adds little. Kept as the fallback if the grant cannot be limited (OQ-2).
- **Option C - nothing more: the hash and the author address are checked, as on the host
  today.** *Cost:* no extra effort, and a ZCode session that sets its own author address
  can approve its own spec and have it land on main, where the host's unattended builders
  treat an approved spec as work to start. Only safe together with Option A's separation.
- **Option D - a hardware key touched inside the VM to sign each approval.** *Cost:* a
  touch per approval and a key passed through to the VM. It looks stronger than B and is
  weaker in the way that matters: the screen showing what he is signing belongs to the
  VM, so a touch proves he was present, not what he approved.

### OQ-2 - What if ZCode's GitHub link cannot be limited to chosen projects?

**Answered 2026-10-13: closed by the facts, not by a choice.** The founder, 2026-10-13:
"i gave it a fine grained PAT instead." and "zcode repos only, oauth removed, no other
logins". ZCode's GitHub access is now a fine-grained personal access token that reaches
his ZCode repositories only, so the link can be limited and is. This is stated by the
founder, **not measured**: no host session can see the VM. If measurement 8 shows the
token reaches more than ZCode repositories, FR-21 is not met and the stated fallback is
Option B of OQ-1.

## To measure before Plan (only the founder can)

No agent session can reach the VM. Each result goes into the design notes with the
ZCode version.

1. Is `node` on the path inside the VM, and which version?
2. Can the VM reach GitHub, and with which identity does it push: yours, or one of its
   own?
3. Is anything shared between host and VM today (folders, clipboard, drives)? BND-1
   assumes nothing is.
4. Does a `stdio` tool server added under Settings, MCP Servers connect, and can the
   agent call its tools?
5. Does a `PreToolUse` hook in a plugin added from a git address run and block a tool?
   (Z.ai's pages disagree on plugin hooks in one case.)
6. Does a commit made by ZCode's agent run the hooks that `core.hooksPath` points at?
7. For the second spec: does a plugin page open as a side panel on this version?
8. Which repositories can the fine-grained personal access token in ZCode reach? The
   founder states ZCode repositories only (OAuth removed, no other logins); confirm that
   it excludes MinSpec and every other host-built repository. FR-21 depends on the
   answer.
9. Only if OQ-1 is answered B: can you approve a pull request review from your phone or
   the host browser on a pull request the VM's identity opened?
10. Only if OQ-1 is answered D: does a hardware key passed through to the VM sign a git
    commit, with a touch each time?
11. Do ZCode-project repositories run the AI review at all? If not, FR-23 cannot be met
    there.
12. Run on the host: `docker inspect` of ZCode's container, recording its mounts
    (`Mounts`, every bind and volume), `HostConfig.NetworkMode` and
    `HostConfig.PortBindings`, `HostConfig.Privileged`, `HostConfig.CapAdd`,
    `HostConfig.SecurityOpt`, `HostConfig.PidMode` and `HostConfig.IpcMode`,
    `Config.User` and `HostConfig.UsernsMode`, whether docker itself runs rootful or
    rootless (`docker info`, `SecurityOptions`), and whether any X11 or Wayland socket or
    audio socket is mounted in. BND-1, BND-2 and BND-6 depend on the answer.

## Decision records

- **A new record is needed before Plan**: MinSpec has a machine-facing command
  line. Not written here.
- **DR-014** (shared-code boundary) is relied on, not amended.
- **DR-056** (agent-proof approver identity) and **DR-081** (the approval-integrity
  check, advisory first) are relied on, not amended: the VM boundary keeps VM approvals
  out of the repositories they govern (BND-4, FR-22). If OQ-1 is answered B, they are
  extended and a decision record must say how.
- **The VM boundary itself** (BND-1 to BND-6) is a founder decision that outlives this
  spec and belongs in a decision record or the constitution. Not written here.

## Risks

1. **The bridge carries files that run** (#2708). Until the machinery set covers them,
   BND-1 depends on review, not on a gate.
2. **Everything about ZCode is from reading.** Nothing was run. The measurements above
   exist for this.
3. **Three validators become four** if FR-2 and FR-3 are not held. They are tests, not
   intentions.
4. **The seven editor-bound library files may not be the whole coupling.** The count is
   a text search. FR-1's test is the real measure.
5. **A contract used before it is stable.** Mitigation: versioned results, first
   release marked unstable.
6. **Inside a ZCode project nothing proves an approval was his.** A session there can
   build on a spec it approved itself, and the protection is gone the day the host starts
   building a ZCode project. The VM's GitHub grant is a fine-grained token he says
   reaches ZCode repositories only (stated, not measured); if measurement 8 shows it
   reaches host-built repositories, the separation fails; OQ-2.
7. **ZCode projects may not run the AI review.** Then he could be asked to approve an
   unreviewed spec (FR-23). Measurement 11.
8. **Approvals will be rubber-stamped.** He has said so. The design does not claim to fix
   that, and this is why no outside tap is added for ZCode projects.
9. **Node may be absent in the VM.** Then the core cannot run there and the plugin
   falls back to prose. Measurement 1.

## Out of Scope

- The ZCode plugin shell: commands, skills, hooks, tool-server wiring, a panel (#2702,
  the second spec).
- MinSpec's panels in any other product (#531).
- Headless init and refresh of a project. The VM receives projects from GitHub already
  set up; `activate` is the only setup step exposed.
- Moving any model step. The AI review stays where it is, on the subscription.
- Having the dev-time agent scripts start ZCode (#2703).
- Extending the machinery path set (#2708).
- A deterministic witness for decision-record acceptance (#2153). This spec covers spec
  approvals only.
- Any supervision of the VM from the host (BND-5).
- The button or command in ZCode that calls `approve` (#2702, the second spec).
- Moving library files into `packages/shared` (#54 tracks the classifier move).

## What this costs

About eight new files and four changed ones; at most one new dependency (a protocol
library for the tool server), none if Plan writes the small protocol by hand. One
change to a review-machinery template, which needs a human merge. A decision record. A
new contract to keep stable. About twenty minutes of measurement inside the VM. A limit on
the VM's GitHub grant, by the founder (measurement 8). No extra tap per approval. No
change to which model credential anything uses.

## Alternatives considered and rejected

- **MinSpec in the host editor, meeting ZCode through project files** (the first
  draft). Rejected by the founder's boundary.
- **A tool server on the host for the VM to call.** Rejected: BND-2.
- **The plugin first, with its own copy of the checks.** Rejected: a fourth validator.
- **Moving the library into `packages/shared` first.** Rejected: DR-014 bars process
  spawning there, and the measured coupling does not require a move.
- **Approvals on the host only.** Rejected by the founder, 2026-10-13.
- **Approvals made in the VM that bind only the VM's own work, with a separate record
  kind per side.** Rejected: the mark saying which side made a record would be written
  inside the VM, so a misbehaving session would simply write the other one. The same
  effect is reached without a new record kind by keeping the VM out of host-built
  repositories (FR-21, FR-22).
- **An approval from the VM that lands on main only after an outside approving review.**
  Not chosen as the recommendation (OQ-1 Option B): the review proves nothing for any
  repository the VM's token reaches, and he will rubber-stamp it anyway. Kept as the fallback if the grant cannot be limited.
- **A hash check only, as on the host today.** Not chosen alone (OQ-1 Option C): a VM
  session can set its own author address.
- **A signed commit as the proof of a person.** Rejected as the main proof: a key on
  the VM's disk is within the agent's reach, and a hardware key proves presence, not
  what was shown (OQ-1 Option D).
- **GitHub's own web editor as the approval act.** Rejected: it is not "in ZCode", and
  done in ZCode's built-in browser it is an act the agent can perform.
- **Porting the checks to Python for the VM**, since a Python validator already ships.
  Rejected: it is the subset whose drift #2297 tracks.
- **Running Claude Code against Z.ai's endpoint instead of ZCode.** Rejected: a
  different product from the one named, and DR-084 measured that route failing here.

## Test plan (for the Plan phase to place)

The first four owned tests in the frontmatter cover FR-1 (no editor import), FR-2 and FR-11
(parity of verdicts and of the two ways in), FR-6 and FR-7 (read-only, one approval path),
and FR-4, FR-8, FR-10 and FR-17 (network off, refusal, no socket, stays in the
project). The fifth covers FR-19, FR-20 and FR-25 (and the host-side half of FR-22, FR-24). FR-21 to FR-24 are properties of the VM's grant and of how the host is run, not of the
core; their checks are the measurements below and a host-side test that approval records
are read from main only. FR-23's ordering needs the measurement-11 answer first. FR-3's corpus comparison and
FR-15's workflow behaviour need a place; Plan
decides whether they join these files or the existing workflow tests.

## Traceability

- Request and answers: founder, 2026-10-12 and 2026-10-13 (twice), quoted above.
- Builds on: SPEC-001 (the checks), SPEC-076 (the first headless reader), DR-014,
  DR-037 (which names the validator package), DR-074.
- Second spec: #2702 (the ZCode plugin shell).
- Follow-ups filed from this spec: #2703 (measure ZCode's one-prompt mode), #2708
  (files that execute on the pulling machine are not in the machinery set).
- Related open work: #14, #37, #54, #248, #531, #562, #2263, #2297.
