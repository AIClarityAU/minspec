---
id: SPEC-136
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology - the checks are the methodology; this makes them reachable where no editor runs
aspects: [headless, core, validator, tool-server, github-actions, zcode, vm-boundary, plugin, tier-0, offline, no-silent-gate, blast-radius]
depends_on: [SPEC-001, DR-004, DR-014, DR-037, DR-074]  # SPEC-001 owns the checks being exposed; DR-004 the network tiers the core must stay inside; DR-014 the package map that says where process-spawning code may live; DR-037 the git hooks and the validator package it already names; DR-074 the blast-radius rule
relates_to: [SPEC-076, SPEC-038, DR-015, DR-050, DR-066, DR-084, DR-087, "#14", "#37", "#54", "#248", "#531", "#562", "#2263", "#2297", "#2702", "#2703", "#2708"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). All seven files
# are NEW and are needed under every answer to the open questions below: the one table of
# operations, the two ways in (command line, tool server), and the four tests that pin
# the editor-free property, the sameness of the two ways in, the read-only rule and the
# boundary.
implements: [packages/core/src/operations.ts, packages/core/src/cli.ts, packages/core/src/tool-server.ts, packages/core/tests/no-editor-import.test.ts, packages/core/tests/operations-parity.test.ts, packages/core/tests/read-only.test.ts, packages/core/tests/boundary.test.ts]
# Modified, not owned. The validate workflow template already names a validator package
# in its third branch; `scaffold.ts` holds the hook-activation step this spec exposes;
# `package.json` gains the workspace. `template-registry.ts` is review machinery, so that
# change needs a human merge.
affects: [packages/minspec/src/lib/template-registry.ts, packages/minspec/src/lib/scaffold.ts, package.json]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-136: MinSpec's checks run without the editor - one headless core that works inside the ZCode VM, in GitHub Actions and behind any agent

## In plain terms

ZCode now lives in a VM, and this editor must never read what ZCode wrote. So MinSpec
cannot reach ZCode through shared folders. This spec builds the piece every route you
named needs first: MinSpec's checks as one small program that runs with no editor, as a
command and as a local tool server. The ZCode plugin, written next as its own spec,
wraps it. The only bridge between VM and host is git through GitHub, where the checks
that count already run, and the AI review there already uses your Claude subscription.
Cost: a second published surface to keep stable. Left out: the plugin itself, panels,
approvals from inside the VM. Riskiest assumption: checks inside the VM are a help, not
a gate.

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. A human reads
> it, answers or accepts the five questions under
> **[Open questions for the founder](#open-questions-for-the-founder)**, and approves it
> through the normal spec-approval gate before any design or code. Every requirement
> below is written under each question's recommended answer.

**Where this came from.** The founder, 2026-10-12, verbatim: "also make a spec to adapt
minspec to zcode in the next week." and "zcode is by z.ai". Then, 2026-10-13, after
reading the first draft, verbatim:

> zcode. we just moved zcode into a VM and decided that it's safer for this (here) codium
> instance should not be able to be "infected" by reading from folders written to by
> zcode.  would a local MCP endpoint help?  or perhaps moving more of minspec into github
> actions?  but we still want to use the Claude Max subscription not PAYG API tokens.  i
> see that zcode allows custom plugins so perhaps it's best to ship a variant of minspec
> as a zcode plugin.  (we will eventually want to ship plugins for all the IDEs.)

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

**Tier note.** T4 (complete ceremony). By file count this is about ten files, which the
classifier maps to T3 (`packages/minspec/src/lib/git-analyzer.ts:34-39`). It is raised
to T4 because it adds a package, a published contract other programs will depend on,
and a change to a review-machinery template. The predicted tier is a floor.

**Code read from** `origin/main` at `41f41571`. `main` had moved to `28b247e9` by the
time this was rewritten; the cited lines were not re-read against it.

## One-Sentence Scope

Package the checks MinSpec already has (validate, hash, status, next action, hook
activation) as one editor-free Node program with two ways in, a command line and a
local stdio tool server, so that the same code can run inside the ZCode VM, in GitHub
Actions and behind any agent, without the host ever reading what the VM wrote.

## The boundary (set by the founder 2026-10-13; an invariant of this spec)

- **BND-1 - One bridge.** Nothing on the host reads a file ZCode wrote, except content
  that arrived through git by way of GitHub. No shared folder, no mounted drive, no
  copied directory.
- **BND-2 - No listener.** Nothing MinSpec ships opens a network port on the host for
  the VM to call, and nothing in the VM is given a port on the host.
- **BND-3 - The VM is not the gate.** A check that runs inside the VM is help for the
  agent working there. Whatever is being kept out of the host can switch it off. The
  checks that decide a merge run on GitHub.
- **BND-4 - Approvals are made on the host.** Nothing running in the VM records a
  human approval.

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

- *(d) second editor in the VM* is better if next week matters more than the boundary
  around approvals: it costs nothing to build beyond the first draft's file work, but
  approvals would be recorded inside the VM (against BND-4).
- *(c) Actions alone* is better if ZCode sessions do not need MinSpec's commands or
  write-time checks at all, only a verdict on what they push.
- *(a) plugin first, prose only* is better if a visible ZCode result next week matters
  more than checks: commands and rules need no core. See OQ-4.

## Terms

- **Core.** The new package: MinSpec's existing checks, callable with no editor.
- **Operation.** One thing the core does: validate, hash, status, next, activate.
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

- **FR-5 - Five, to start.** `validate` (the project's specs and decisions pass or
  fail, with each finding); `hash` (the approval hash of one spec, as
  `packages/shared/src/canonical.ts:126` computes it); `status` (each spec's derived
  status, as `packages/minspec/src/lib/lifecycle.ts:133` derives it); `next` (the one
  next human action, by the same pair SPEC-076 uses); `activate` (point this clone's git
  at the project's scaffolded hooks, as `packages/minspec/src/lib/scaffold.ts:986` does
  today from inside the editor).
- **FR-6 - Read-only, with one named exception.** Four operations MUST NOT write
  anything. `activate` writes one value in the clone's own git configuration and
  nothing else. A test MUST compare the project tree before and after every operation.
- **FR-7 - No approval, ever.** The core MUST NOT offer any operation that records an
  approval, advances a phase, or edits an approval record (BND-4). A test MUST fail if
  an operation with that effect is added to the table.
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
  Command Palette entry. See OQ-5.

### D. Getting it into the VM and onto GitHub

- **FR-13 - One file, nothing to install beside it.** The built core MUST be a single
  file that needs only Node, so a plugin or a workflow can carry it without a
  dependency install.
- **FR-14 - Reaches the VM without the host.** The core MUST be obtainable inside the
  VM from GitHub alone. No step may involve a folder the host and the VM both see
  (BND-1). See OQ-3 for where it is published.
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

## Costly to Refactor

1. **The names and result shapes of the five operations.** Why costly: a plugin, a
   workflow and other agents will call them; changing one breaks callers MinSpec does
   not ship with. What to check: results are versioned (FR-16) and the first release is
   marked unstable.
2. **A command line existing at all.** Why costly: the project's own instructions say
   MinSpec is "a VS Code extension, not a CLI", and goal G-7 names a separate CLI as the
   thing MinSpec is not. Once shipped, adopters will script against it. What to check:
   OQ-5 is answered and recorded as a decision before Plan.
3. **Where the core is published (OQ-3).** Why costly: a public package name cannot be
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
- [ ] **No approval path** - the operation table contains nothing that records an
      approval, and the test that guards this fails when one is added. (FR-7, BND-4)
- [ ] **Refuses the un-opted** - a folder without `.minspec/` gets a refusal and a
      non-zero exit, not an empty pass. (FR-8)
- [ ] **Two ways, one set** - the command line and the tool server offer exactly the
      same operations. (FR-11)
- [ ] **No port** - the tool server binds no socket. (FR-10, BND-2)
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
- **INV-4 - The VM boundary** (BND-1 to BND-4 above). FR-7, FR-10, FR-14, FR-18.
- **INV-5 - Tier map** (DR-014). Code that starts a process stays out of
  `packages/shared`; the core is its own package.

## Open questions for the founder

Each carries a recommendation and what that recommendation costs. The requirements
above assume the recommended answers; approving the spec as it stands accepts them.

### OQ-1 - What does "infected" cover: files that run, or also text that agents read?

- **Option A - files that run are the hard line; text is reviewed data (rec).** The
  host may pull merged work; anything that executes on the host must force a human
  look first. *Cost:* text written by a misbehaving ZCode session (a spec, an issue, a
  code comment) can still carry instructions that a Claude session on the host later
  reads; the AI review and your own read are the only filter. And the hard line is not
  fully drawn today (#2708).
- **Option B - nothing ZCode wrote is ever opened on the host.** *Cost:* ZCode's work
  could not be merged into a repository this editor has open, so ZCode would need its
  own repositories.

### OQ-2 - Where are approvals made?

- **Option A - on the host only (rec, BND-4).** *Cost:* each approval of ZCode's work is
  a round trip: the VM pushes, you approve here, the VM pulls. Slower than approving
  where the agent is.
- **Option B - also inside the VM.** *Cost:* the approval record is written in the
  place you chose not to trust, and a hash shows what was approved, not who approved it
  (DR-087).

### OQ-3 - Where is the core published?

- **Option A - as a build attached to this repository on GitHub, no public package yet
  (rec).** *Cost:* installing it is a download or a git address, not one short command,
  and the workflow branch that expects a package name (#248) stays unused until a later
  decision.
- **Option B - as a public npm package now.** *Cost:* a public release with a name that
  cannot be recalled, before the contract has been used once.

### OQ-4 - Does anything for ZCode ship before the core?

- **Option A - core first; the plugin spec may start its prose-only part in parallel
  (rec).** Commands and rules in a plugin need no core, so that slice can begin once
  #2702 is specified. *Cost:* two specs for you to read instead of one, and nothing
  ZCode-visible from this one by itself.
- **Option B - prose-only plugin next week, core afterwards.** *Cost:* ZCode sessions
  would follow MinSpec's process on trust, with no check until they push.
- **Option C - a second editor inside the VM as a stopgap** (route d). *Cost:* approvals
  inside the VM, and work that the plugin later replaces.

### OQ-5 - MinSpec gains a command line. Is that allowed?

The constitution's goal G-7 calls MinSpec "Editor-native", "not bolted on as a separate
CLI", and the project instructions say it is "a VS Code extension, not a CLI".

- **Option A - yes, as a machine-facing surface only, recorded in a decision record
  before Plan (rec, FR-12).** The editor stays the place a person works; hooks,
  workflows and agents get the command. *Cost:* the "not a CLI" wording must be
  reworded everywhere it appears, and people will use the command by hand anyway.
- **Option B - no command line; the tool server is the only way in.** *Cost:* git hooks
  and workflows cannot speak to a tool server, so adopters' CI stays on the Python
  subset.

## To measure inside the VM before Plan (only the founder can)

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

## Decision records

- **A new record is needed before Plan** for OQ-5: MinSpec has a machine-facing command
  line. Not written here.
- **DR-014** (shared-code boundary) is relied on, not amended.
- **The VM boundary itself** (BND-1 to BND-4) is a founder decision that outlives this
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
6. **Node may be absent in the VM.** Then the core cannot run there and the plugin
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
- Moving library files into `packages/shared` (#54 tracks the classifier move).

## What this costs

About seven new files and three changed ones; at most one new dependency (a protocol
library for the tool server), none if Plan writes the small protocol by hand. One
change to a review-machinery template, which needs a human merge. A decision record. A
new contract to keep stable. About fifteen minutes of measurement inside the VM. No
change to which model credential anything uses.

## Alternatives considered and rejected

- **MinSpec in the host editor, meeting ZCode through project files** (the first
  draft). Rejected by the founder's boundary.
- **A tool server on the host for the VM to call.** Rejected: BND-2.
- **The plugin first, with its own copy of the checks.** Rejected: a fourth validator.
- **Moving the library into `packages/shared` first.** Rejected: DR-014 bars process
  spawning there, and the measured coupling does not require a move.
- **Porting the checks to Python for the VM**, since a Python validator already ships.
  Rejected: it is the subset whose drift #2297 tracks.
- **Running Claude Code against Z.ai's endpoint instead of ZCode.** Rejected: a
  different product from the one named, and DR-084 measured that route failing here.

## Test plan (for the Plan phase to place)

The four owned tests in the frontmatter cover FR-1 (no editor import), FR-2 and FR-11
(parity of verdicts and of the two ways in), FR-6 and FR-7 (read-only, no approval),
and FR-4, FR-8, FR-10 and FR-17 (network off, refusal, no socket, stays in the
project). FR-3's corpus comparison and FR-15's workflow behaviour need a place; Plan
decides whether they join these files or the existing workflow tests.

## Traceability

- Request: founder, 2026-10-12 and 2026-10-13, quoted above.
- Builds on: SPEC-001 (the checks), SPEC-076 (the first headless reader), DR-014,
  DR-037 (which names the validator package), DR-074.
- Second spec: #2702 (the ZCode plugin shell).
- Follow-ups filed from this spec: #2703 (measure ZCode's one-prompt mode), #2708
  (files that execute on the pulling machine are not in the machinery set).
- Related open work: #14, #37, #54, #248, #531, #562, #2263, #2297.
