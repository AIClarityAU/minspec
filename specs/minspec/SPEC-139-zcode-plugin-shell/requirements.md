---
id: SPEC-139
type: requirements
status: planning
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology - the same phase commands and checks, reachable from inside ZCode
aspects: [zcode, plugin, hooks, slash-commands, tool-server, local-page, approval, vm-boundary, tier-0, offline, no-silent-gate, blast-radius]
depends_on: [SPEC-136, DR-074, DR-004]  # SPEC-136 is the headless core this wraps and the VM boundary it inherits; DR-074 the blast-radius rule a user-wide plugin must obey; DR-004 the network tiers the loopback page must stay inside
relates_to: [SPEC-001, SPEC-076, SPEC-038, DR-014, DR-073, DR-084, "#2702", "#2703", "#2704", "#37", "#531", "#2708", "#2725", "#2726", "#2727"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). Every path is
# NEW: the one table the plugin is generated from, the generator, the opt-in gate every
# entry point passes through, the session-start hook, the prompt hook that carries the
# person-only commands, the page process, and the four tests that pin the properties this
# spec promises. Three are conditional: `page/server.ts` and `page-loopback.test.ts` go if
# the page is dropped (FR-24), and `prompt-commands.ts` goes if OQ-M4 fails and OQ-2 is
# answered D; dropping a declared path before approval is a free edit.
# The plugin folder itself (manifest, commands, hooks file, tool-server file) is BUILD
# OUTPUT of `build.ts`; where it is kept is OQ-3, so it is not listed as owned source.
implements: [packages/zcode-plugin/src/plugin-table.ts, packages/zcode-plugin/src/build.ts, packages/zcode-plugin/src/opt-in-gate.ts, packages/zcode-plugin/src/hooks/session-start.ts, packages/zcode-plugin/src/hooks/prompt-commands.ts, packages/zcode-plugin/src/page/server.ts, packages/zcode-plugin/tests/command-parity.test.ts, packages/zcode-plugin/tests/opt-in-scope.test.ts, packages/zcode-plugin/tests/no-model-approval.test.ts, packages/zcode-plugin/tests/page-loopback.test.ts]
# Modified, not owned. `package.json` gains the workspace. Nothing in
# `packages/minspec/src/` changes: the generator imports `buildClaudeShim` and
# `SPEC_KIT_COMMANDS` from `slash-commands.ts`, which are already exported and import no
# editor API (`packages/minspec/src/lib/slash-commands.ts:1-7`, `:42`, `:192`).
affects: [package.json]
phases:
  specify: done
  clarify: in-progress
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-139: MinSpec inside ZCode as a plugin - the phase commands, a next-action hook, the checks as tools and a read-only local page, all wrapped around the headless core

## In plain terms

Inside the ZCode VM you add MinSpec as a plugin once, from GitHub. After that, in any
project with `.minspec/`, ZCode's agent starts each session already told the next step
and which MinSpec checks are not active there; you get the same eight
`/minspec-<phase>` commands as in Claude Code; the agent can call validate, hash,
status and next as tools; and `/minspec-page` gives you a link to a read-only page in a
browser with the signpost, the spec and decision lists and the active spec's tasks.
You approve a spec by typing `/minspec-approve SPEC-NNN` yourself; the agent has no
tool for it. In a project without `.minspec/` the plugin does nothing. Cost: almost
every piece depends on ZCode behaviour nobody has run yet, so this spec carries twelve
probes for your VM trial before Plan; and in ZCode's default mode each tool call will
likely ask you first. Left out: a panel, the write-time spec gate (waits for #37),
toggling tasks from the page. Riskiest assumption: that plugin hooks run at all - ZCode's
code says yes, with no trust step, and its README says they are ignored.

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. A human reads
> it and approves it through the normal spec-approval gate before any design or code.
> Five decisions and twelve measurements are open under
> **[Open questions](#open-questions)**. Every requirement that rests on a ZCode
> behaviour not yet measured names the measurement it waits for; none of them is
> assumed.

**Where this came from.** SPEC-136 (the headless core, requirements merged as #2704)
names this as its second spec: "the ZCode plugin shell (commands, skills, hooks, the
tool-server wiring, optionally a panel), is tracked as #2702". Then three facts recorded
on #2702 on 2026-10-13 and 2026-10-15:

1. **No panel.** The founder asked ZCode's own `/plugin-creator` and pasted its reply: a
   plugin manifest (`.zcode-plugin/plugin.json`) declares four component types only -
   skills, slash commands, hooks and MCP servers - and no UI surface. That is ZCode's
   agent describing its format, not an observed failed attempt. (The source has a
   desktop-only `ui` field; see the context below. It changes nothing here.)
2. **A local page instead.** The founder, 2026-10-13, relayed verbatim: "the browser page
   workaround is fine." The page carries what the panel would have: the next-action
   signpost, spec and decision lists, and the active spec's phases and tasks.
3. **Project hooks wait for trust.** A source reading of ZCode's CLI (posted on #2702,
   2026-10-15) found that workspace hooks exist but each is refused with
   `workspace_hooks_pending_trust` until a person trusts that exact declaration, per
   workspace, and that trust is lost when the declaration changes. Reading, not a run.
   The wider reading done for this spec found that plugin hooks are not behind that
   gate at all (see the context below).

And the findings on #2703 (2026-10-15) about ZCode's one-prompt mode, which bear on this
spec in three ways: `zcode -p` defaults to the `yolo` permission mode, has no tool
allow-list (a deny-list only), and loads `AGENTS.md` automatically; it has no
JSON-schema output and no system-prompt option. The recommendation there was no spec for
one-prompt use yet, and this spec does not use one-prompt mode for anything.

**Id note.** `SPEC-139` is the highest claimed id plus one, read 2026-10-15 11:31 UTC
across `origin/main` at `5f792386` (highest `SPEC-136`), every remote branch (highest id
138, on the branches of #2716, #2717 and #2720) and the open pull requests. No
gate checks spec ids across pull requests (#2055). If it collides at review time,
renumber.

**Tier note.** T4 (complete ceremony). By file count this is about twelve files, which
the classifier maps to T3. It is raised because it adds a package, a second distributed
artifact other machines install, and a new place where a person approves a spec. The
predicted tier is a floor.

**Code read from** `origin/main` at `5f792386`.

## One-Sentence Scope

Wrap SPEC-136's headless core in a ZCode plugin - the eight phase commands generated
from the same source as the Claude Code ones, a session-start hook that hands the agent
the next action and names the checks that are absent, the core's read-only operations as
tools, a person-typed approval command, and a read-only page on a loopback link - so
that a project with `.minspec/` gets MinSpec inside the ZCode VM, and every other project
is untouched.

## What this inherits from SPEC-136, and three places where SPEC-136's text needs this spec to differ

**Inherited unchanged.** The boundary BND-1 to BND-5 (one bridge through GitHub, no
listener on the host, the VM is not the gate, an approval made in the VM counts only
inside that ZCode project, no supervision reaches in). The operation table (validate,
hash, status, next, activate, approve) and its rules: the plugin adds no check of its own
(SPEC-136 FR-2), `approve` is never a model tool (SPEC-136 FR-20), every result from
the VM is advice (SPEC-136 FR-18).

**Where SPEC-136's text assumed something a plugin cannot provide.** Recorded here so
the reader is not surprised; the SPEC-136 text is not edited by this pull request
(follow-up filed, see Traceability).

1. **The panel.** SPEC-136's context says "It can have a panel", citing the
   repository's `UI_PLUGIN.en.md`, and its measurement 7 asks whether a plugin page
   opens as a side panel. Fact 1 above says the manifest has no UI component; the source
   has a desktop-only `ui` field. The founder chose the browser page either way. This
   spec assumes no panel. If measurement 7 ever shows one, a later spec can add it;
   nothing here depends on it.
2. **"A button the model cannot press".** SPEC-136 FR-20 says `approve` is reachable "in
   the second spec, from a button the model cannot press". A plugin has no buttons. The
   nearest equivalent is a command only the person types, read by a hook before the
   model sees it (FR-17 below, OQ-2).
3. **The tool server binds no socket.** SPEC-136 FR-10 says a test fails if the tool
   server binds a socket. The founder's page needs a listener. So the page is a separate
   process the person starts, not the core's tool server, and SPEC-136 FR-10 stays true
   as written (FR-20 below).

## Context - what a ZCode plugin is (read, never run)

Provenance is marked on each line: **[doc]** Z.ai's documentation site, **[repo]** a
prose file in `zai-org/ZCode`, **[src]** ZCode's source at commit `aac47556` (2026-10-10,
CLI 0.16.9), read for this spec on 2026-10-15, **[founder]** the `/plugin-creator` reply he
pasted. Source paths are relative to `apps/zcode-cli/packages/` unless they start with
`packages/` or `docs/`. **Nothing here was observed running.** Where the documentation and
the code disagree, the code is quoted and the disagreement named. A claim marked "by
search" rests on not finding something, which is weaker than finding it.

- **Manifest.** Looked up as `.zcode-plugin/plugin.json`, then `.claude-plugin/plugin.json`,
  then `.codex-plugin/plugin.json`. Only `name` is validated
  (`^[a-z0-9][a-z0-9._-]{0,127}$`); a bad manifest skips the plugin with an error
  diagnostic [src, `adapters/src/plugins/index.ts` lines 105-111, 935-960]. Supported
  components: skills, commands, hooks, MCP servers, and agents from `agents/*.md` [src,
  `contracts/src/plugins/index.ts` lines 142-162; doc].
- **A UI field exists in the code, desktop only.** The manifest type has a `ui` field
  [src, `contracts/src/plugins/index.ts` lines 142-162], and the repository's guide says plugin
  pages "currently run in local workspaces in ZCode Desktop" [repo, `UI_PLUGIN.en.md:32`].
  The `/plugin-creator` reply said there is no UI component [founder]. The two do not
  quite agree. This spec follows the founder's decision ("the browser page workaround is
  fine") and depends on neither; SPEC-136 measurement 7 remains the way to know.
- **Installation.** `zcode plugins marketplace add <source> [--scope <scope>] [--sparse
  <path>]`, then `zcode plugins install <plugin>[@marketplace] [-s <scope>]` and `enable`;
  scopes `user` (default) and `project` [src, `cli/src/plugins-command.ts` lines 41-58].
  Marketplace sources: an https or git URL, GitHub `owner/repo`, a local file or folder;
  npm is refused as unsupported [src, `adapters/src/plugins/marketplace.ts` lines 79-87,
  291-338, 1804]. Installed plugins live under `~/.zcode/cli/plugins/` and the
  user-wide enable state in `~/.zcode/cli/config.json` [src design doc,
  `docs/design/v2/plugin-compat.md` lines 50-119]. So a plugin can enter the VM from GitHub with
  nothing shared with the host.
- **Trust.** The documentation: "Enabling a plugin grants code-execution trust" [doc]. The
  code: no trust prompt on install or enable was found (by search), and plugin hooks are
  always allowed to run (`canRunPluginHooks` returns true) [src,
  `adapters/src/plugins/index.ts` lines 371-376].
- **A project can load a plugin with no prompt.** A project's own `.zcode/config.json` (or
  `zcode.json`) can list `plugins.dirs`, each loaded as an inline plugin enabled by default,
  and can set `plugins.enabledPlugins`; `enable -s project` writes there [src,
  `adapters/src/config/config-merger.ts` lines 76-99, `adapters/src/plugins/index.ts` lines 244-250,
  `bootstrap/src/plugins.ts` lines 1298-1312]. Project tool servers also connect with no trust
  step [src, `bootstrap/src/app/runtime-config.ts` line 110], against ZCode's own design doc
  (`docs/design/v2/mcp.md` line 161). This matters for OQ-1, and it is a risk of ZCode, not of
  MinSpec (Risk 8).
- **Hooks.** Seven events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`,
  `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `Stop` [src,
  `contracts/src/hooks/index.ts` lines 7-15]. A hook gets JSON on standard input with Claude-style
  aliases (`hook_event_name`, `session_id`, `tool_name`, `tool_input`, ...) and the
  environment variables `ZCODE_PLUGIN_ROOT` and `ZCODE_PROJECT_DIR` (and `CLAUDE_*` forms)
  [src, `core/src/hooks/configured-runner-input.ts` lines 14-98]. Outputs: `additionalContext`
  for `SessionStart`, `UserPromptSubmit` and `PostToolUse`; allow, ask or deny for
  `PreToolUse`; `continue: false` (or exit code 2) blocks, with a `stopReason` [src,
  `core/src/hooks/output.ts` lines 11-65, 118-143;
  `core/src/hooks/configured-runner-callback.ts` lines 123-140]. Where a `stopReason` is shown,
  and to whom, was not traced. Default timeout 60 s, output capped at 32,768 bytes [src,
  `contracts/src/hooks/index.ts` lines 426-431].
- **Plugin hooks versus workspace hooks.** The documentation says plugin hooks run and
  project hooks do not [doc, https://zcode.z.ai/en/docs/hooks]; the CLI README says Claude
  plugin `hooks` are "ignored with diagnostics rather than executed" [repo]. The code runs
  plugin hooks with no trust gate (forced `enabled: true`) [src,
  `bootstrap/src/app/runtime-config.ts` lines 249-280; `core/src/hooks/configured-runner.ts` lines 74-101].
  Workspace hooks are off by default (`hooks.enabled` false); each needs trust by its
  declaration's digest, stored machine-wide in
  `~/.zcode/security/workspace-hook-trust-v1.json`; and the feature flag that admits them
  is set only by the protocol server the desktop app uses, with no setter found in the
  command line (by search), so there a trusted project hook may still be skipped [src,
  `core/src/hooks/workspace-hook-runtime-admission.ts` lines 116-191,
  `adapters/src/storage/workspace-hook-trust-store.ts` lines 20-21,
  `bootstrap/src/app/workspace-hook-trust.ts` line 104,
  `bootstrap/src/zcode-protocol/server-operations.ts` line 3447]. Three sources, three answers;
  this is the riskiest assumption in the spec.
- **Commands.** Markdown with frontmatter (`description`, `argument-hint`, `allowed-tools`,
  `model`, ...). `$ARGUMENTS`, `$1`, `$2` are filled in. The `` !`cmd` `` form, which runs a
  shell command inside a command file, is refused as unsupported. A plugin command is
  invoked as `/<file name>` with no plugin prefix [src,
  `adapters/src/commands/index.ts` lines 27-32, 271-274; `cli/src/custom-command-expand.ts` lines 17-45].
  Project commands are read from `.zcode/commands` and `.agents/commands`;
  `.claude/commands` and `.claude/skills` are not read (by search) [src,
  `adapters/src/commands/roots.ts` lines 99-105, `adapters/src/skills/roots.ts` line 99]. So the
  Claude Code shims MinSpec already scaffolds are invisible to ZCode today.
- **Tool servers.** A plugin's `.mcp.json` (or manifest `mcpServers`); stdio is inferred
  for a server with a `command`; `${ZCODE_PLUGIN_ROOT}` and `${ZCODE_PROJECT_DIR}` are
  filled in [src, `adapters/src/plugins/mcp.ts` lines 18-29, 121-140, 300-345]. **Every
  tool-server tool is marked as needing approval**, so in `build` mode each call asks unless
  an allow rule or `permission.allowedTools` covers it; `plan` mode allows any tool not
  marked destructive [src, `core/src/mcp/index.ts` lines 129-153,
  `core/src/permission/service.ts` lines 451-467, 498-537].
- **Permission modes.** `build`, `plan`, `edit`, `yolo`, `guarded` (and an `auto` stub).
  The runtime default and the desktop app's default is `build`; one-prompt mode defaults
  to `yolo` [src, `contracts/src/config/index.ts` line 295,
  `packages/ui/src/v4/composer/newTaskDraft.ts` line 21; #2703].
- **App and command line share one runtime.** The desktop app starts the command-line
  bundle as `app-server --stdio`, so plugins, hooks and tool servers are the same code in
  both; panels are the desktop-only part [src, `docs/electron/desktop-bundle.md`,
  `packages/desktop/src/host/storagePreparationProcesses.ts` line 131]. One difference is
  already visible: the workspace-hook flag above.
- **Project instructions.** `AGENTS.md` is read from the working directory upward and from
  `~/.zcode/AGENTS.md`; `CLAUDE.md` is never read (by search) [src,
  `adapters/src/context/index.ts` line 24, 233-240]. MinSpec already scaffolds `AGENTS.md`
  with a slash-command section (`packages/minspec/src/lib/slash-commands.ts:251`, `:329`),
  so a ZCode agent in a MinSpec project already gets MinSpec's prose with no plugin. That
  is the baseline this spec improves on.

## Context - what MinSpec gives Claude Code today (measured in this repository)

- **Eight phase commands from one table.** `SPEC_KIT_COMMANDS`
  (`packages/minspec/src/lib/slash-commands.ts:42-51`) and one guidance record per
  command; `buildClaudeShim` (`:192`) renders `.claude/commands/minspec-<phase>.md`.
  The file imports no editor API (`:1-7`).
- **One shipped Claude Code hook.** The session title, a `UserPromptSubmit` hook
  (`packages/minspec/src/lib/template-registry.ts:2405-2441`). ZCode's hook page lists no
  title field, so it has no ZCode counterpart and is out of scope.
- **The write-time spec gate is not shipped.** The `PreToolUse` gate this repository runs
  on itself (`.claude/settings.json:3-9`, `scripts/hooks/spec-gate.sh`) is dev-time
  only. Shipping it to adopters is #37, which is on hold for its own spec. A ZCode
  counterpart cannot be specified before the Claude Code one.
- **The signpost has a headless path.** SPEC-076 made `next` callable with no editor
  (`scripts/next-task.ts`), by the same `buildArtifactGraph` + `resolveNextTask` pair the
  palette uses; SPEC-136 makes it a core operation.

## Terms

- **Core.** SPEC-136's editor-free program: a command line and a stdio tool server over
  one operation table.
- **Plugin.** The folder ZCode installs: manifest, commands, hooks file, tool-server
  file, the core's single-file build, and the page process.
- **MinSpec project.** A project with `.minspec/` at its root (constitution invariant 3).
- **Person-only command.** A command the plugin acts on only when a person typed it as
  their prompt, before the model receives it (FR-17).
- **Page.** A local web page served by the page process on `127.0.0.1` inside the VM.
- **VM trial.** The founder's run of probes inside the ZCode VM, started as #2703
  section E ("The measured trial, inside the VM"). This spec adds its own probes to it
  (see [Measurements](#measurements-for-the-vm-trial-2703-section-e)).

## Functional Requirements

### A. Scope and shape

- **FR-1 - No rule of its own.** Every check, status, hash, next action and approval the
  plugin shows or performs MUST come from a SPEC-136 core operation. No plugin file may
  contain a MinSpec rule. A test MUST fail if the plugin's code imports a validator,
  lifecycle or approval module other than through the core.
- **FR-2 - Inert outside a MinSpec project.** Under OQ-1's recommendation the plugin is
  enabled once per user, so its hooks run in every ZCode project on the machine (source
  reading; OQ-M1). Under every other answer the gate below is still the backstop. In a project without `.minspec/` at its
  root: every hook MUST exit with success, print nothing and change nothing, with one
  exception - when the person's prompt is one of the plugin's own hook-carried commands
  (`/minspec-approve`, `/minspec-next`, `/minspec-page`), the prompt hook stops the
  prompt and says this is not a MinSpec project, so the command never reaches the model.
  Every other command and every tool MUST say plainly that this is not a MinSpec project
  and stop, and MUST NOT report the project as having nothing wrong (SPEC-136 FR-8). One
  shared gate decides this (`opt-in-gate.ts`), and a test MUST run every entry point
  against a folder without `.minspec/` (constitution invariant 3, DR-074).
- **FR-3 - Writes nothing machine-wide.** Nothing the plugin runs may write under
  `~/.zcode`, `~/.claude` or any other location outside the current project. Adding the
  marketplace and enabling the plugin are the person's own acts in ZCode; the plugin
  only tells them how (FR-25). A test MUST compare the home directory before and after
  every entry point.
- **FR-4 - Offline.** No plugin entry point makes a network call or starts `gh`,
  `claude` or `zcode`. The page's loopback listener (section F) is the one exception,
  bound to `127.0.0.1` inside the VM and started only by the person (constitution
  invariant 1).

### B. Commands

- **FR-5 - The same eight phase commands, from the same source.** The plugin carries
  `minspec-constitution`, `minspec-specify`, `minspec-clarify`, `minspec-plan`,
  `minspec-tasks`, `minspec-analyze`, `minspec-implement` and `minspec-checklist`, each
  generated by the build from `SPEC_KIT_COMMANDS` and `buildClaudeShim`, with one named
  substitution: the shared guidance points the agent at `CLAUDE.md` for invariants, the
  dependency budget and escalation (`packages/minspec/src/lib/slash-commands.ts:139`,
  `:154`, `:170`, `:179`), and ZCode never reads `CLAUDE.md` (source reading), so the
  build points those at `AGENTS.md`, which MinSpec scaffolds with the same invariants.
  A test MUST fail when a plugin command's body differs from the Claude Code shim's body
  for the same phase after that substitution and no other. (The alternative, changing the
  shared text to name both files, changes every adopter's Claude Code shims and is not
  this spec's to make.) The source reading says ZCode takes the same markdown-with-`description`
  format, fills in `$ARGUMENTS`, and names a plugin command by its file name with no
  prefix, and that it does not read `.claude/commands/` at all, so the plugin is the only
  way these commands reach ZCode. All of that is **unmeasured: OQ-M5**. Which command
  wins when two enabled plugins ship the same name is also unmeasured; the `minspec-`
  prefix (`slash-commands.ts:60`) keeps that unlikely.
- **FR-6 - Skills only where they add something.** The phase guidance ships as commands.
  It ships as skills too only if OQ-5 says so and OQ-M5 shows ZCode's skill format; in
  that case the skill text comes from the same source and the parity test covers it.
- **FR-7 - The next action, word for word.** `/minspec-next` shows the person the core's
  `next` result exactly as the core produced it, with the core's version. It MUST NOT
  rely on the model to restate it, because the signpost's promise is that it is never
  wrong (EPIC-002) and a restatement can be. ZCode refuses the `` !`cmd` `` form that
  would put a command's output straight into a command file (source reading), so the
  route is a `UserPromptSubmit` hook that blocks the typed prompt with the result as its
  `stopReason`. Whether that reason is shown to the person, unchanged, is **unmeasured:
  OQ-M4**. If it is not, `/minspec-next` falls back to a command whose text tells the
  model to call the `next` tool and quote its result verbatim, and the command says that
  it is a fallback. Node on the path is **unmeasured: OQ-M12**.

### C. Hooks

- **FR-8 - The session starts told.** In a MinSpec project, a session-start hook hands
  the agent three things: the core's `next` result; the core's version and the plugin's;
  and the MinSpec checks that are **not** active in this ZCode session, by name (today:
  the write-time spec gate, #37, and the merge gates, which run on GitHub only per
  SPEC-136 BND-3). This answers #2702's ask, "how its absence is made visible": the
  agent is told at the start of every session, not left to discover a missing check.
  The source reading gives `SessionStart` with an `additionalContext` output; that it
  reaches the agent is **unmeasured: OQ-M3**. Whether plugin hooks run at all is
  **unmeasured: OQ-M1**.
- **FR-9 - A missing core is said, not hidden.** If the hook cannot run the core (Node
  absent, the core file missing, the core erroring), the session-start hook MUST say so
  in the context it hands the agent and exit with success. It MUST NOT print nothing,
  because nothing reads as "nothing to do" (constitution invariant 2). Node on the VM's
  path is **unmeasured: OQ-M12** (SPEC-136 measurement 1).
- **FR-10 - The write-time gate waits for #37.** The plugin ships no `PreToolUse` gate
  until #37 specifies the write-time spec gate for Claude Code. When it does, the ZCode
  hook MUST call the same core operation, and if that operation errors or its result
  cannot be read, the hook MUST deny the write with a message naming the failure, never
  allow it silently (constitution invariant 2). Inside the VM that gate is still advice
  (SPEC-136 BND-3). Until then FR-8 names its absence.
- **FR-11 - One delivery route for hooks.** Hooks ship as plugin hooks of a plugin
  enabled once per machine, not as workspace hooks and not through any file MinSpec
  writes into the project (**OQ-1**, recommendation). The plugin route needs plugin hooks
  to run (**OQ-M1**); the workspace route needs the trust step read from ZCode's source
  (**OQ-M2**).

### D. The tool server

- **FR-12 - The core's tool server, launched by the plugin.** The plugin's tool-server
  file starts the core's stdio tool server from the core build the plugin carries, with
  the project root as its working folder. It MUST NOT name an HTTP or SSE form (SPEC-136
  FR-10, BND-2). The source reading says a plugin's `.mcp.json` starts a stdio server and
  fills in `${ZCODE_PLUGIN_ROOT}` and `${ZCODE_PROJECT_DIR}`; that it does so is
  **unmeasured: OQ-M6** (SPEC-136 measurement 4 covers only a server added in Settings).
- **FR-13 - No approval tool, anywhere in the plugin.** The tool list the model sees MUST
  NOT contain `approve` or anything that records an approval, advances a phase or edits
  an approval record (SPEC-136 FR-7, FR-20). A test MUST read the plugin's built
  tool-server file and the core's tool list and fail if one appears.
- **FR-14 - Results say they are advice.** Every tool result names the core's version
  and states that a pass inside the VM is not the merge gate (SPEC-136 FR-16, FR-18).
- **FR-15 - Usable in each mode, with the prompt cost said.** The four read-only tools
  (`validate`, `hash`, `status`, `next`) MUST be declared read-only and not destructive,
  so that a session in `plan` mode can call them, and `activate`, which writes the
  clone's git configuration, MUST be declared destructive, so `plan` mode refuses it and
  no allow rule covers it. Those declarations are made by the core's tool server, which
  SPEC-136 does not yet require; the plugin cannot add them without code of its own
  (FR-1), so they are an amendment to SPEC-136, listed on #2725. Per the source reading, ZCode marks
  every tool-server tool as needing approval, so in `build` mode, the default, each call
  asks the person unless an allow rule covers it. The plugin MUST NOT write that allow
  rule itself (it would live in a ZCode config file, FR-3); its README names the rule a
  person can add once, for these four tools only, never for a tool that writes. Both
  behaviours are **unmeasured: OQ-M7**.

### E. Approving a spec inside ZCode

SPEC-136 section F decides what an approval made in the VM is worth: it counts only
inside that ZCode project, and the host never reads, trusts or builds on it. This
section only decides how the person reaches it.

- **FR-16 - The model is never the one who approves.** No command text, skill text, hook
  output or tool description in the plugin may ask or tell the model to approve a spec,
  run the core's `approve`, or edit an approval record. A test MUST search every
  generated plugin file for the core's approve entry and for instructions to approve,
  and fail on a hit anywhere except the prompt hook's own source. If OQ-M4 shows that a
  `commands/minspec-approve.md` file is needed for ZCode to accept the typed command,
  that file's body MUST say only that the approval hook did not run and that nothing is
  to be approved, and the test covers that too: if ZCode ever sends the file to the
  model, the model reads a refusal, not an instruction.
- **FR-17 - One act by the person.** The person types `/minspec-approve SPEC-NNN` as
  their prompt. A prompt hook reads it before the model does, runs the core's `approve`
  with every refusal that operation makes, shows the person the result, and stops the
  prompt from reaching the model (**OQ-2**, recommendation). Nothing further is asked
  (SPEC-136: "One act in ZCode. Nothing further"). Whether ZCode has a prompt hook that
  can read a typed prompt, stop it, and show text to the person is **unmeasured:
  OQ-M4**. If it cannot, no approval entry point ships in the plugin and the plugin says
  so (OQ-2 names the alternatives); approval is not moved onto the model instead.
  The route must fail closed: if the hook errors, times out or does not run, the typed
  command must not become a request the model acts on. What ZCode does with a prompt
  when its hook fails, and whether the hook also fires for prompts no person typed (a
  subagent's), is **unmeasured: OQ-M4** (its error, timeout and subagent probes).
- **FR-18 - What FR-17 does not stop, said in the spec.** It stops an agent approving by
  accident or by habit: the model has no tool for it and no text telling it to. It does
  not stop a session that sets out to approve. That session has a shell and can run the
  core's command line, and it can start a nested one-prompt run (`zcode -p`, whose
  default mode is `yolo`, per #2703) whose prompt is `/minspec-approve`. This is the same
  limit SPEC-136 FR-20 states, and SPEC-136 section F's separation is what keeps it
  inside the ZCode project.
- **FR-19 - No approval ask of the plugin's own.** The plugin raises no approval request.
  Any "approve SPEC-NNN" the person sees is the core's `next` result, so SPEC-136 FR-23
  (AI review before he is asked, or straight after) governs it, not this spec.

### F. The local page

- **FR-20 - A separate process the person starts.** The page is served by a process the
  person starts with `/minspec-page`, not by the core's tool server, so SPEC-136 FR-10
  (the tool server binds no socket) stays true. Starting it is the person's consent to
  the listener (constitution invariant 1). It binds `127.0.0.1` inside the VM on a port
  chosen at start, never `0.0.0.0` and never a host address (SPEC-136 BND-2). It stops
  after a stated idle time and when the person types `/minspec-page stop`; ZCode has no
  session-end hook event (source reading), so it cannot be tied to the session. A test
  MUST fail if it binds any address other than `127.0.0.1`. The process is started by the
  prompt hook of FR-17's route; whether a process a hook starts outlives the hook (whose
  default timeout is 60 s) is **unmeasured: OQ-M8**.
- **FR-21 - What it shows.** In the first release, the next action (`next`) and the spec
  list with each spec's derived status (`status`), each rendered from a core operation
  result with the core's version and the time it was read. No rule of its own (FR-1).
  The founder also asked for the decision list and the active spec's phases and tasks.
  SPEC-136's table has no operation for either, and "active spec" today is read through
  the editor (`packages/minspec/src/lib/active-spec.ts:1` imports the editor API), so
  those two panes wait for read operations added to SPEC-136 (listed on #2725); until
  then the page names them as not yet available.
- **FR-22 - Read-only in the first release.** The page writes nothing (**OQ-4**,
  recommendation). Toggling a task from the page needs a core operation for it, which
  SPEC-136's table does not have, and a measured answer on whether a write from the page
  meets a permission prompt (**OQ-M9**). The page has no approve control: anything in
  the VM that the person's browser can reach on `127.0.0.1`, the agent can reach too
  (it has a shell, and it is the one that hands over the link), so a page button is not
  a person-only act.
- **FR-23 - Closed to other pages.** The link carries a secret made at start, and the
  page process refuses a request without it, refuses a `Host` header other than
  `127.0.0.1:<port>`, and sends no header that lets another origin read its responses.
  Purpose, stated so nobody over-reads it: this keeps out other web pages open in the
  same browser, not the agent, which already holds the link.
- **FR-24 - The link is shown to the person, in a browser inside the VM.**
  `/minspec-page` shows the link to the person (by the same route as FR-7). The browser
  that opens it MUST run inside the VM. If ZCode hands a `127.0.0.1` link to a browser on
  the host through a port forward, that is a failure, not a success: it is a VM port
  reachable from the host (SPEC-136 BND-2) and the host reading what the VM wrote
  (SPEC-136 BND-1). Where the link opens is **unmeasured: OQ-M8**. The page is dropped
  from the first release, and nothing else changes, if OQ-M8 finds no browser inside the
  VM, or if OQ-M4 shows the prompt hook that starts it cannot work.

### G. Getting it into the VM

- **FR-25 - From GitHub only, added once.** The plugin MUST be obtainable inside the VM
  from GitHub alone, with no folder the host and the VM both see (SPEC-136 BND-1 and
  SPEC-136 FR-14). The person adds it once per machine and enables it once; the plugin never asks
  again (once-for-always). Where it is kept and how it is versioned is **OQ-3**.
  Whether ZCode installs a plugin from a git address pointing at this public repository
  is **unmeasured: OQ-M10**.
- **FR-26 - One version, carried together.** The plugin MUST carry the core build it was
  made with and record that core's version in its own manifest. The surfaces the plugin
  renders itself (FR-7, FR-8, FR-21) show both versions; tool results come straight from
  the core and show the core's version (SPEC-136 FR-16). A plugin MUST NOT run a core
  of another version that happens to be on the path.
- **FR-27 - The same in the app and the command line, or said.** ZCode has a desktop app
  and a command line. Each requirement above holds in both, or the plugin's README and
  the session-start context name the one where it does not. The source reading says the
  app starts the command-line bundle, so the runtime is shared, with one difference
  already visible (workspace hooks are admitted only through the app's protocol server).
  That they behave alike is **unmeasured: OQ-M11**.

### H. Boundary

- **FR-28 - Nothing reports to the host.** No plugin entry point writes a session,
  presence, heartbeat or queue record, or opens a channel to the host (SPEC-136 BND-5 and
  SPEC-136 FR-25).
- **FR-29 - Stays in the project.** Every plugin entry point writes only inside the
  project root, and reads only inside the project root and the plugin's own folder
  (which ZCode keeps under `~/.zcode/cli/plugins/`, so it is read, never written,
  FR-3), other than what `git` reads (SPEC-136 FR-17). The page process keeps its process
  id in one file under the project's `.minspec/`, ignored by git, so `/minspec-page stop`
  can find it; nothing else is written.

## Costly to Refactor

1. **Command names.** Why costly: people type them and the session-start text names
   them; renaming breaks habit and any notes. What to check: OQ-M5 settles how ZCode
   names a plugin command before the names are frozen.
2. **Where the plugin is kept (OQ-3).** Why costly: a marketplace address, once added in
   the VM, is what every later update comes from; moving it means each machine re-adds
   it. What to check: the address is decided before the first install.
3. **The person-only approval route (OQ-2).** Why costly: once the founder approves this
   way, changing the route changes a habit tied to an approval. What to check: OQ-M4 is
   measured first.
4. **The page process.** Low - read-only and started on demand; it can be dropped or
   replaced without touching anything else.
5. **The package boundary.** Low - the generator imports two exports from
   `slash-commands.ts` and the core build; moving it is internal.

## Acceptance Criteria

- [ ] **Nothing of its own** - the plugin's code reaches validators, lifecycle and
      approval only through the core, and the import test fails when a direct import is
      added. (FR-1)
- [ ] **Untouched elsewhere** - in a folder without `.minspec/` every hook exits with
      success and prints nothing, every command and tool says it is not a MinSpec
      project, and nothing in the home directory changes. (FR-2, FR-3)
- [ ] **Same commands as Claude Code** - each of the eight plugin commands has the same
      body as its Claude Code shim, and the parity test fails when one drifts. (FR-5)
- [ ] **Signpost word for word** - `/minspec-next` shows the core's `next` result
      unchanged, or says it is the fallback. (FR-7)
- [ ] **Session starts told** - in a MinSpec project a new ZCode session's agent has the
      next action, both versions and the names of the absent checks before the first
      prompt; with the core removed it is told the core is missing. (FR-8, FR-9)
- [ ] **No silent gate** - when the write-time gate ships, a core error denies the write
      with a message. (FR-10)
- [ ] **The checks as tools** - ZCode's agent calls `validate` on the project through the
      plugin's tool server, in default mode and in plan mode. (FR-12, FR-15)
- [ ] **Model cannot approve** - no tool, command, skill or hook output offers or
      instructs approval, and the test fails when one does. (FR-13, FR-16)
- [ ] **One act to approve** - typing `/minspec-approve SPEC-NNN` records the approval
      through the core, shows the result, and the model never receives the prompt.
      (FR-17)
- [ ] **Page on loopback only** - `/minspec-page` gives a link that opens the read-only
      page in the founder's browser; the process binds `127.0.0.1` only and refuses a
      request without its secret. (FR-20 to FR-24)
- [ ] **From GitHub, once** - in the VM, with nothing shared from the host, the plugin
      is added from GitHub and enabled once, and is not asked about again. (FR-25)
- [ ] **One version** - the plugin's manifest records the version of the core build it
      carries, the plugin runs only that build, and the surfaces it renders show both.
      (FR-26)
- [ ] **No network, no stray program** - with the network off every entry point works,
      and none starts `gh`, `claude` or `zcode`. (FR-4)
- [ ] **Advice, said** - every tool result names the core's version and says a pass in
      the VM is not the merge gate. (FR-14)
- [ ] **App and command line** - each criterion above holds in both, or the README and
      the session-start context name where it does not. (FR-27)
- [ ] **No report home, no stray write** - no entry point writes a session, presence or
      queue record, and nothing is written outside the project. (FR-28,
      FR-29)

## Invariants (must not break)

- **INV-1 - Offline** (constitution invariant 1). FR-4; the page's listener is loopback
  only and started by the person (FR-20).
- **INV-2 - No silent gate** (constitution invariant 2). FR-9 (a missing core is said),
  FR-10 (a gate that errors denies), FR-2 (a refusal is never an empty pass).
- **INV-3 - Blast radius** (constitution invariant 3, DR-074). FR-2 and FR-3: a
  user-wide plugin is inert outside `.minspec/` and writes nothing machine-wide.
- **INV-4 - The VM boundary** (SPEC-136 BND-1 to BND-5). FR-12, FR-20, FR-25, FR-28,
  FR-29.
- **INV-5 - One copy of the rules** (SPEC-136 FR-2). FR-1, FR-5.
- **INV-6 - The model never approves by accident** (SPEC-136 FR-20). FR-13, FR-16,
  FR-17, with the limit stated in FR-18.

## Open questions

### Decisions for the founder

Each has a recommendation and the cost of taking it.

- **OQ-1 - How hooks are delivered.**
  - **A - installed and enabled once per machine, every hook checking for `.minspec/`
    itself (rec).** One act per machine; no file written into adopter projects. *Cost:*
    the hooks run, briefly, in every ZCode project on the machine and must stay silent
    outside MinSpec ones, so a bug in the gate reaches projects that never opted in
    (FR-2); and it depends on plugin hooks running at all, where the code says yes and
    the README says no (OQ-M1).
  - **B - as workspace hooks written into each MinSpec project.** Scoped to the project
    by construction. *Cost:* MinSpec writes a new ZCode config file into adopter
    projects, a file that runs on the machine that pulls it (#2708); and per the source
    reading each hook must be trusted per workspace and loses trust whenever its
    declaration changes, so every MinSpec update that touches a hook asks again; the
    trust is stored machine-wide; and the source admits them only through the desktop
    app's protocol server, so they may never run from the command line (OQ-M2).
  - **C - a plugin folder inside each MinSpec project, loaded through that project's
    `.zcode/config.json` (`plugins.dirs`).** Scoped to the project and, per the source,
    enabled with no prompt. *Cost:* that is the defect, not the feature: the project
    makes ZCode run its code the moment it is opened, with nobody asked, which is the
    file-that-runs-on-the-pulling-machine class #2708 tracks; and every adopter project
    carries its own copy of the plugin to keep in step.
  - **D - installed once per machine, enabled per project (`enable -s project`).**
    *Cost:* one act per project, and the enable is written into the project's
    `.zcode/config.json`, a file that can be committed and then enables the plugin for
    everyone who opens the project. FR-2's gate is still needed as a backstop.

- **OQ-2 - How the person approves.**
  - **A - a typed `/minspec-approve SPEC-NNN`, read by a prompt hook before the model
    (rec).** One act; the model has no tool and no text for it. *Cost:* depends on a
    prompt hook that can stop a prompt and show text (OQ-M4); and a session that sets
    out to approve can still start a nested `zcode -p` with that prompt (FR-18).
  - **B - an Approve button on the local page.** *Cost:* not person-only: the agent can
    reach the same `127.0.0.1` address with the link it handed over (FR-22).
  - **C - the person types the core's command in a VM terminal.** *Cost:* SPEC-136 FR-12
    says no MinSpec text tells a person to type the command line; this would need
    SPEC-136 amended, and it is a second, unfamiliar act.
  - **D - no approval entry point in the plugin's first release.** *Cost:* the founder
    cannot approve in ZCode, which he asked for (SPEC-136, 2026-10-13: "i should be able
    to approve specs for the current project in zcode").
- **OQ-3 - Where the plugin is kept.**
  - **A - a built plugin folder and a marketplace file committed in this repository,
    regenerated by the build and checked by a test (rec).** The VM adds this public
    repository once as a marketplace by git address; updates arrive with `main`.
    *Cost:* generated files live in the repository and can drift (a test must compare
    them with a fresh build), and the plugin follows `main`, not a release.
  - **B - a build attached to a GitHub release of this repository, like SPEC-136's
    core.** *Cost:* each update is a manual download in the VM unless ZCode's
    marketplace can point at a release file (unmeasured).
  - **C - a separate repository for the plugin.** *Cost:* a second repository to keep in
    step with the core, the drift SPEC-136 was written to avoid.
- **OQ-4 - Can the page write?**
  - **A - read-only first (rec).** *Cost:* tasks are toggled in the editor or by the
    agent, not by a click on the page.
  - **B - toggle tasks from the page now.** *Cost:* a new write operation in SPEC-136's
    table (an amendment to an unapproved spec), and an in-VM write path that bypasses
    ZCode's permission screen by design.
- **OQ-5 - Skills as well as commands?**
  - **A - commands only (rec).** *Cost:* the agent does not pick up phase guidance on its
    own; the person invokes it, as in Claude Code today.
  - **B - also as skills.** *Cost:* a second copy of the text the parity test must cover,
    and the format is unmeasured (OQ-M5).

### Measurements for the VM trial (#2703 section E)

No agent session can reach the VM (SPEC-136 BND-5). #2703 section E ("The measured trial,
inside the VM") is the founder's trial and today holds four one-prompt probes; the probes
below are added to it (follow-up filed, see Traceability). Each result goes into the
design notes with the ZCode version (`zcode --version`, the first line of section E).
Each names the requirements that wait on it. The commands are taken from ZCode's own
usage text (`cli/src/plugins-command.ts` lines 41-58) and have not been run; a probe plugin is a
throwaway folder with a manifest and one file, made in the VM, not something MinSpec
ships.

- **OQ-M1 - Do plugin hooks run?** A throwaway plugin whose one `SessionStart` hook
  appends a line to a file in `/tmp`, added with `zcode plugins marketplace add <local
  folder>`, installed and enabled. Start a session in the app and one with `zcode -p`.
  Does the line appear each time? Was any trust step asked? (FR-2, FR-8, FR-10, FR-11,
  FR-17; SPEC-136 measurement 5.)
- **OQ-M2 - Workspace-hook trust, measured.** Only if OQ-1 is B. A trivial project hook:
  run once (expect `Workspace Hooks skipped`), `zcode hooks trust grant` it, run again, in
  the app and with `zcode -p`; change it, run again. (FR-11.)
- **OQ-M3 - Session-start context.** Make the OQ-M1 hook print
  `{"additionalContext":"The probe word is heron."}` (the parser takes a top-level
  `additionalContext`, `core/src/hooks/output.ts` line 49) and ask the agent for the probe word.
  (FR-8, FR-9.)
- **OQ-M4 - A prompt hook that answers without the model.** A `UserPromptSubmit` hook
  that, for a prompt starting `probe` or `/probe`, prints `{"continue":false,"stopReason":"probe
  answered by hook"}`. Type `probe`, then `/probe` (no such command exists), then
  `/probe` again after adding a `commands/probe.md` to the plugin. Each time: is "probe
  answered by hook" shown, unchanged, and did the model reply at all? The three forms
  tell whether ZCode resolves a slash command before the hook sees it, which decides
  whether `/minspec-approve` and `/minspec-next` also need a command file. Then three
  failure probes, because the approval route must fail closed: make the hook exit
  non-zero, then make it sleep past its timeout, then have the agent start a subagent
  whose prompt is `probe`. Each time: did the typed text reach the model, and did the
  hook fire for the subagent's prompt? (FR-2, FR-7, FR-17, FR-24.)
- **OQ-M5 - Plugin commands.** Put an unmodified MinSpec Claude Code shim
  (`.claude/commands/minspec-specify.md` from any MinSpec project) in the probe plugin's
  `commands/`. Does `/minspec-specify` appear under that exact name, and does `$ARGUMENTS`
  fill in? And the skill format, if OQ-5 is B. (FR-5, FR-6.)
- **OQ-M6 - A plugin's stdio tool server.** A probe `.mcp.json` naming a stdio server under
  `${ZCODE_PLUGIN_ROOT}` (any small stdio MCP server; once SPEC-136's core exists, that).
  Does it start and offer its tools? (FR-12; SPEC-136 measurement 4 covers only Settings.)
- **OQ-M7 - Tools in each mode.** Call that tool in `build` mode: is the person asked each
  time? Then in `plan` mode, with the tool not marked destructive: is it allowed without a
  prompt? (FR-15.)
- **OQ-M8 - The loopback link.** In the VM, `python3 -m http.server 8765 --bind
  127.0.0.1`, then have the agent print `http://127.0.0.1:8765/`. Does it open in a browser
  you can see, from the app and from a terminal session? Record **where that browser
  runs**: inside the VM is a pass; a browser on the host reached through a port forward
  is a failure that drops the page (FR-24). Then have the OQ-M4 hook start
  the same server in the background and check a minute later that it is still running.
  (FR-20, FR-24.)
- **OQ-M9 - A write from the page.** Only if OQ-4 is B. Does a write made by a process the
  session started meet any ZCode permission prompt? (FR-22.)
- **OQ-M10 - Install from this repository.** Once a plugin folder exists here (OQ-3):
  `zcode plugins marketplace add AIClarityAU/minspec --sparse <folder>` with no credential.
  Does it add? Until then, the same with any small public repository answers whether a
  public GitHub source needs a login. (FR-25.)
- **OQ-M11 - App and command line.** Repeat OQ-M1 and OQ-M6 in both. Same result? (FR-27.)
- **OQ-M12 - Node on the path.** `command -v node; node --version`, and the same from
  inside a hook (the OQ-M1 hook can write it). (FR-7, FR-9, FR-12, FR-17, FR-20;
  SPEC-136 measurement 1.)

## Decision records

- **A record for the approval route, before Plan.** Costly to Refactor ranks the
  person-only approval route (OQ-2) and the marketplace address (OQ-3) as hard to undo,
  and the project's rule is that a change not undoable in a day gets a record. The
  recommendation is one decision record covering both once the founder answers OQ-2 and
  OQ-3. Not written here.
- **Otherwise none new**, on the reading that a plugin is a shell of the
  core SPEC-136 already decided and the VM boundary is SPEC-136's. If OQ-1 is answered B,
  C or D (a ZCode config file in adopter projects, written by MinSpec or by the person's
  project-scoped enable), that is a new harness file under DR-073 §3's contract and
  needs a record before Plan.
- **DR-074** (blast radius) is relied on, not amended: FR-2 and FR-3.
- **DR-004** (network tiers) is relied on: the page listener is loopback-only, started by
  the person, and opens no outbound connection.

## Risks

1. **Plugin hooks may not run.** Z.ai's documentation, its README and its source give
   three answers. If they do not run, FR-8, FR-10 and FR-17 fall away and the plugin is
   commands and tools only. OQ-M1.
2. **No way to answer a command without the model.** Then the signpost reaches the
   person only through the model (FR-7 fallback) and approval has no entry point (FR-17,
   OQ-2 D). OQ-M4.
3. **Everything about ZCode here is read, not run.** Twelve measurements exist for this.
4. **A user-wide plugin in every project.** A bug in the opt-in gate would change
   behaviour in projects that never opted in. FR-2's test runs every entry point without
   `.minspec/`.
5. **The page is reachable by the agent.** Stated, not solved; the page is read-only
   and has no approve control for this reason (FR-22, FR-23).
6. **ZCode changes under us.** The readings are of one commit (`aac47556`). FR-26's
   versions and the trial's recorded ZCode version are how a later break is told apart.
7. **Generated plugin files drift** (if OQ-3 is A). The parity tests compare with a
   fresh build.
8. **ZCode runs a project's own plugins and tool servers with no prompt** (source
   reading: `plugins.dirs` and project tool servers). Any repository opened in ZCode can
   run code in the VM. That is ZCode's risk, not MinSpec's, and it is why OQ-1 C is not
   recommended: MinSpec must not add to it. It also bears on SPEC-136 BND-3 (the VM is
   not the gate).
9. **Every tool call asks in the default mode** (source reading). If the founder finds
   the prompts tiresome, the pull is toward a broad allow rule; FR-15 keeps any rule to
   the four read-only tools and leaves writing it to the person.

## Out of Scope

- A panel or any in-app UI (fact 1; the desktop-only `ui` field in ZCode's source is not
  used).
- The write-time spec gate itself (#37); this spec only reserves its place (FR-10).
- Toggling tasks or any other write from the page (OQ-4).
- The session-title hook (no ZCode counterpart).
- ZCode's one-prompt mode for reviews or dispatch (#2703, recommendation: no spec yet).
- Any change to SPEC-136's operations or boundary.
- Plugins for other products (#531).
- Publishing to any marketplace other than this repository on GitHub.

## What this costs

About ten new source and test files and one changed file; no new dependency beyond what
SPEC-136 adds (the page process uses Node's own HTTP server). One new distributed
artifact to keep in step with the core. About twenty minutes added to the founder's VM
trial. No change to any model credential, any workflow or any review machinery.

## Alternatives considered and rejected

- **A ZCode plugin with its own checks, ahead of the core.** Rejected: a fourth
  validator (SPEC-136 risk 3).
- **Serving the page from the core's tool server.** Rejected: SPEC-136 FR-10 forbids the
  tool server a socket, and a test enforces it.
- **The page on a port the host can reach.** Rejected: SPEC-136 BND-2.
- **An `approve` tool behind a confirmation prompt.** Rejected: SPEC-136 FR-20, and in
  `yolo` mode every prompt is skipped (#2703).
- **A slash command whose text asks the model to approve.** Rejected: that is the model
  approving (FR-16).
- **Writing hooks into `~/.zcode/cli/config.json`.** Rejected: a machine-wide surface
  (constitution invariant 3).
- **Prose only (commands plus `AGENTS.md`), no hooks or tools.** Not chosen as the
  target: the founder chose core first so the plugin can carry checks; it remains the
  fallback if OQ-M1 and OQ-M6 both fail.
- **Commands as project files instead of a plugin** (`.agents/commands/` or
  `.zcode/commands/`, which ZCode reads per the source). Not chosen here: MinSpec writes
  those files from the editor's scaffold, and a ZCode project is never opened in the
  host's editor (SPEC-136 terms), so nothing would write them; it is also a new harness
  location for every adopter. Filed as a separate idea (see Traceability), since
  `.agents/commands/` may serve other agents too.

## Test plan (for the Plan phase to place)

The four owned tests cover: `command-parity` (FR-5, FR-6, FR-26's manifest version, and
the built folder against a fresh build if OQ-3 is A); `opt-in-scope` (FR-2, FR-3,
FR-28, FR-29, and every entry point run with the network off and its child processes
recorded, for FR-4); `no-model-approval` (FR-13, FR-16); `page-loopback` (FR-20,
FR-23). FR-1's import check and FR-9's missing-core message join `command-parity` or
`opt-in-scope` at Plan's choice. FR-14 is the core's output and is tested under
SPEC-136. Everything marked unmeasured is checked by the VM trial, not by a test in
this repository.

## Traceability

- Requested by: SPEC-136 (second spec), tracked as #2702; scope facts on #2702 of
  2026-10-13 and 2026-10-15.
- Builds on: SPEC-136 (the core and the VM boundary), SPEC-076 (headless signpost),
  DR-074.
- Measurements: #2703 section E, extended by this spec.
- Waits for: #37 (write-time spec gate).
- Related: #531 (MinSpec panels elsewhere), #2708 (files that execute on the pulling
  machine).
- Follow-ups filed from this spec: #2725 (three SPEC-136 wording points: the panel, the
  approve button, project config that runs code), #2726 (add these probes to the VM
  trial in #2703 section E), #2727 (also scaffold phase commands to `.agents/commands/`).
