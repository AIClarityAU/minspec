---
id: SPEC-136
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - the harness files are how the methodology reaches the agent; this adds a second agent they reach
aspects: [harness, scaffold, agents-md, slash-commands, hooks, zcode, agent-agnostic, tier-0, offline, no-silent-gate, blast-radius]
depends_on: [SPEC-001, SPEC-043, DR-073, DR-074]  # SPEC-001 owns harness generation (FR-4) and agent-agnostic integration (FR-6); SPEC-043 the refresh manifest new harness files must join; DR-073 the contract for writing beside a foreign tool's files; DR-074 the blast-radius rule
relates_to: [SPEC-063, SPEC-096, DR-037, DR-054, DR-084, "#14", "#37", "#531", "#1996", "#2682"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). All four files
# are NEW and are needed under every answer to the open questions below: the one module
# that says which agents a project targets and what each cannot carry, and the three
# tests that pin the target choice, the ZCode command files and the AGENTS.md coverage.
implements: [packages/minspec/src/lib/harness-targets.ts, packages/minspec/tests/harness-targets.test.ts, packages/minspec/tests/zcode-harness.test.ts, packages/minspec/tests/agents-md-coverage.test.ts]
# Modified, not owned. Each has an owner already or is shared; this spec changes them and
# claims none.
affects: [packages/minspec/src/lib/tool-detector.ts, packages/minspec/src/lib/slash-commands.ts, packages/minspec/src/lib/template-registry.ts, packages/minspec/src/lib/scaffold.ts, packages/minspec/src/lib/config.ts, packages/minspec/src/commands/init.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-136: MinSpec works with ZCode - the rules and the phase commands reach Z.ai's agent, and what cannot be carried is shown

## In plain terms

ZCode is Z.ai's free desktop coding agent. It reads `AGENTS.md`, not `CLAUDE.md`, and
looks for commands in its own folder, so today a ZCode user of a MinSpec project gets a
thin rule sheet and no phase commands. After this, a project that says it uses ZCode
gets the eight phase commands where ZCode reads them and the full rule set in
`AGENTS.md`. Cost: `AGENTS.md` grows about fivefold. Left out: MinSpec's panels inside
ZCode (you keep VS Code open beside it), hooks, and the review and backfill steps that
call the `claude` program. Riskiest assumption: ZCode's published documentation matches
the copy on your machine; one ten-minute check by you settles it before any design.

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. A human reads
> it, answers or accepts the four questions under
> **[Open questions for the founder](#open-questions-for-the-founder)**, and approves it
> through the normal spec-approval gate before any design or code. Every requirement
> below is written under each question's recommended answer.

**Where this came from.** The founder, 2026-10-12, verbatim: "also make a spec to adapt
minspec to zcode in the next week." Asked which product: "zcode is by z.ai". Nothing
else was given, so the product and the gap were both established by reading, and every
fact below carries its source.

**Id note.** `SPEC-136` is the highest claimed id plus one. Read 2026-10-11 20:40 UTC:
`origin/main` at `41f41571` (highest: 135), the changed files, titles and branch names
of all 43 open pull requests (highest: 130, in #2565), remote branch names (none above
135), and the spec folders of the worktrees on disk (none above 135). Remote branch
contents were not searched, only their names. No gate checks spec ids across pull
requests (#2055, the id allocator is blind to unmerged branches). If it collides at
review time, renumber.

**Tier note.** T3 (full spec cycle), on mechanical scope: four new files and six
modified ones, inside the 6-to-15 band the classifier maps to T3
(`packages/minspec/src/lib/git-analyzer.ts:34-39`). It stays at T3 because tier follows
scope, not difficulty.

## One-Sentence Scope

A MinSpec project that declares ZCode as one of its agents gets the eight phase commands
as files ZCode loads and the same rules in `AGENTS.md` that a Claude Code user gets in
`CLAUDE.md`, and every MinSpec behaviour ZCode cannot carry is named to the user instead
of being quietly absent.

## Context - what ZCode is (read from Z.ai's own pages, 2026-10-11)

Every statement here is from a public page and is untested on a real installation. The
full source list is in the pull request description.

- **The product.** ZCode is "an Agentic Development Environment (ADE)" built around a
  first-party "ZCode Agent" (https://zcode.z.ai/en/docs/welcome). Z.ai's own Coding Plan
  page names it and sends readers to the same site to install it
  (https://docs.z.ai/devpack/tool/zcode.md). It is a desktop app for macOS, Windows and
  Linux; the download page showed version 3.14.5 (https://zcode.z.ai/en/docs/install).
- **A second form.** A repository, https://github.com/zai-org/ZCode (Apache-2.0),
  describes the same product as a desktop app, a browser interface and a terminal
  agent started with `zcode`. The documentation pages read do not link to it, so I
  believe it is Z.ai's own repository, unverified.
- **It is not a VS Code host.** Nothing in the documentation says ZCode can run a VS
  Code extension; its own extension unit is a "plugin" bundling skills, commands,
  subagents, hooks and tool servers (https://zcode.z.ai/en/docs/plugin). So MinSpec, a
  VS Code extension, runs in VS Code or VSCodium beside ZCode and the two meet only
  through files in the repository. Unverified on an installed copy.
- **Instructions.** "ZCode currently reads two sources": `~/.zcode/AGENTS.md` and
  "`AGENTS.md` in the current Workspace". "CLAUDE.md is not continuously read by ZCode
  Agent at runtime"; onboarding may copy it into `AGENTS.md` once. It "does not merge
  multiple AGENTS.md files across directory levels" and does not "expand @import"
  (https://zcode.z.ai/en/docs/agents).
- **Commands.** Typed as `/name`, stored as `.md` files; "workspace-level commands live
  in the project directory" (https://zcode.z.ai/en/docs/commands). The documented fields
  are `description` and `argument-hint` among others, the body receives `$ARGUMENTS`,
  and the name must match `^[a-z0-9][a-z0-9_:-]{0,63}$`
  (https://zcode.z.ai/en/docs/plugin). The exact workspace folders,
  `<repo>/.zcode/commands/` and `<repo>/.agents/commands/`, come from the guide bundled
  in the repository
  (https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/zcode-guide-plugin/skills/zcode-configuration-guide/SKILL.md),
  not from the documentation page. Commands kept for Claude Code are brought in only by
  a manual "Import commands from external Agent" step.
- **Hooks.** Seven events, with input that carries "Claude Code snake_case aliases".
  Hooks run from the user's own `~/.zcode/cli/config.json` or from an installed plugin.
  `.claude/settings.json` is "Read-only display, not executed", and "Project-level hooks
  are not executed in the current version" (https://zcode.z.ai/en/docs/hooks). **Z.ai's
  sources disagree here:** the repository's bundled guide says workspace hooks "run
  unconditionally" once enabled, and its command line has a `zcode hooks trust` command
  (https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/zcode-guide-plugin/skills/diagnosing-hooks/SKILL.md,
  https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/cli/src/hooks-trust-command.ts).
  Which holds on a given version is not established.
- **Skills, subagents, tool servers.** Skills are `SKILL.md` folders called with
  `$name` (https://zcode.z.ai/en/docs/skill). Custom subagents are in Beta and
  "User-level only" (https://zcode.z.ai/en/docs/subagents). Tool servers declared in a
  project's `.zcode/config.json` "connect automatically at session start"
  (https://zcode.z.ai/en/docs/mcp-services).
- **Permissions.** Four modes; "Ask before changes" is the default
  (https://zcode.z.ai/en/docs/safety-confirm).
- **Running without a window.** The product documentation describes none. The
  repository's command line has `-p, --prompt <text>  Run a single prompt without
  opening the TUI`, whose permission mode is "default: yolo for --prompt"
  (https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/i18n/src/locales/en-US.ts).
- **Other model providers.** ZCode can add "any model service compatible with the
  Anthropic / OpenAI protocols", Anthropic's own endpoint included
  (https://zcode.z.ai/en/docs/configuration). That is ZCode calling other models; it is
  not Claude Code running inside ZCode.

## Context - where MinSpec assumes Claude Code (read from `origin/main` 41f41571, not inferred)

"ZCode has" is from the pages above. "Works today" means the code path exists; none of
it was run against ZCode.

| # | What MinSpec ships | Where | ZCode has | Result for a ZCode user today |
|---|---|---|---|---|
| 1 | The full rule sheet, `CLAUDE.md`, 447 lines: session scope, evidence discipline, traceability, decision register, pre-commit checks | `packages/minspec/src/lib/template-registry.ts:178-624` | An equivalent file, `AGENTS.md`; `CLAUDE.md` is not read | **Partial.** MinSpec does write `AGENTS.md`, but as an 85-line subset (`template-registry.ts:626-710`) without those five sections |
| 2 | Eight phase commands, `.claude/commands/minspec-<name>.md` | `template-registry.ts:2251`, `:2308-2320`; built at `packages/minspec/src/lib/slash-commands.ts:192-202` | The same idea in a different folder | **None.** The files are written only for Claude Code (`template-registry.ts:2319`), and the command table MinSpec puts in `AGENTS.md` points the reader at `.claude/commands/` (`slash-commands.ts:270`) |
| 3 | The text inside those commands tells the agent to read `CLAUDE.md` | `slash-commands.ts:131`, `:139`, `:154`, `:170`, `:179` | Reads `AGENTS.md` | **Wrong pointer** once the commands exist |
| 4 | A session-title hook, registered in `.claude/settings.json` | `template-registry.ts:2401-2419`; `packages/minspec/src/lib/claude-settings.ts:37-57`, `:146` | The same event, but no documented title field, and project hooks are documented as not run | **None.** The hook answers with `sessionTitle` (`.claude/hooks/session-title.py:168-170`), a field ZCode's hook page does not list |
| 5 | Git hooks and the validate workflow | `template-registry.ts:2744-2773`; `packages/minspec/src/lib/scaffold.ts:1626` | Not agent-specific | **Works today**, I believe: these are git's and GitHub's, not the agent's. Unverified through ZCode's Git panel |
| 6 | Active-spec context written into every detected agent file | `packages/minspec/src/lib/tool-detector.ts:15-22`; `packages/minspec/src/extension.ts:949-958` | Reads `AGENTS.md` | **Works today** for `AGENTS.md` |
| 7 | The AI review check, which runs `claude -p` in GitHub Actions | `scripts/review-branch.sh:292-295`; `.github/workflows/ai-review.yml:261`; shipped to every project at `template-registry.ts:2775` | A one-prompt mode in the repository only, with different switches | **Unchanged.** It needs an Anthropic credential whatever agent you type into; without one it skips with a notice (`ai-review.yml:172-185`) |
| 8 | The optional AI pass of epic backfill, which runs your own `claude` program | `packages/minspec/src/lib/epic-backfill.ts:170-172`, `:683-684`, `:856` | As row 7 | **Unchanged.** With no `claude` program it falls back to the offline heuristic (`epic-backfill.ts:26-27`) |
| 9 | Which agents a project uses, decided by which files exist | `tool-detector.ts:5-12`, `:28-37` | A `.zcode/` folder in the project | **No ZCode signal.** And `init` writes `CLAUDE.md`, `AGENTS.md` and `.cursorrules` into every project (`template-registry.ts:62-68`; `scaffold.ts:1576-1589`), so "Claude Code detected" is true in all of them after init (`scaffold.ts:1613`) |
| 10 | Skills, subagents, tool servers | none shipped: no `.claude/skills` path appears under `packages/minspec/src/lib/` | all three | **Nothing to port** |

Two smaller readers of `CLAUDE.md` matter only if it were ever left out of a project:
the recorded project name is read back from its first heading
(`packages/minspec/src/lib/template-engine.ts:57-70`), and its presence is a signal to
the constitution proposer (`packages/minspec/src/lib/constitution-context.ts:218`,
`:275-280`). Under the recommended answer to OQ-2 neither changes.

### What already exists and is built on

Searched: `specs/` and `docs/decisions/` for agent-agnostic, harness adapter,
tool-agnostic, other agents, multi-agent harness, zcode, z.ai, opencode, gemini, codex;
and open issues and pull requests for the same terms plus Cursor and `AGENTS.md`.

- **SPEC-001 (the base MinSpec spec), FR-4 and FR-6** already require an `AGENTS.md`
  and "Agent-Agnostic Integration" (`specs/minspec/requirements.md:90-125`). This spec
  is one more agent under that requirement, not a new direction.
- **Per-agent gating exists.** Each harness file carries a condition on the detected
  agents (`template-registry.ts:2319`, `:2332`, `:2409`). ZCode becomes one more
  condition, not a new mechanism.
- **#14 (deeper integration with detected AI tools)** is the open umbrella; this is its
  first concrete slice. **#531 (port the VS Code-only interface to other editors)**
  covers MinSpec's panels, which this spec leaves out.
- **#1996 (Claude Code reads `AGENTS.md` when no `CLAUDE.md` exists)** bears on OQ-2.
- **#37 (ship the write-time spec gate as a hook)** is not shipped to adopters; when it
  is, the hook gap in row 4 stops being cosmetic. See OQ-3.
- **#2682 (shipped command text names default folders)** edits the same command text as
  FR-5; the two should land in one order, not race.
- **DR-084 (the shadow harness talks HTTP, not `claude -p`)** measured that pointing
  `claude -p` at Z.ai failed three ways (`docs/decisions/DR-084.md:25-40`). It is the
  reason this spec does not suggest running Claude Code against Z.ai's endpoint as a
  shortcut.
- No open pull request touches this; no spec or decision names ZCode.

## Terms

- **Target.** An agent a project says it uses. A project may have several.
- **Phase commands.** The eight commands `minspec-constitution`, `-specify`,
  `-clarify`, `-plan`, `-tasks`, `-analyze`, `-implement`, `-checklist`
  (`slash-commands.ts:31-60`).
- **Not carried.** A MinSpec behaviour that exists for Claude Code and has no ZCode
  form in this spec.

## Functional Requirements

### A. Saying a project uses ZCode

- **FR-1 - An explicit, project-local choice.** Whether a project targets ZCode MUST be
  recorded in that project's `.minspec/config.json` and nowhere else. The presence of a
  `.zcode/` folder at the project root MAY be offered as a suggestion; `AGENTS.md`
  alone MUST NOT count, because MinSpec writes that file into every project
  (`template-registry.ts:62-68`).
- **FR-2 - Asked once.** When MinSpec sees a `.zcode/` folder in an initialised project
  that has recorded no choice, it MUST ask once, and the answer, yes or no, MUST be
  saved so the question is not repeated. With no `.zcode/` folder and no recorded
  choice it MUST NOT ask and MUST NOT write any ZCode file.
- **FR-3 - Existing projects are untouched until they choose.** A project with no
  recorded ZCode choice MUST get byte-identical output from init and refresh before and
  after this change, except as FR-7 states.

### B. The phase commands

- **FR-4 - Eight files ZCode loads.** For a ZCode target MinSpec MUST write one file
  per phase command into the project's workspace command folder for ZCode, named
  `minspec-<name>.md`, each inside the same marked region the Claude Code files use, so
  refresh updates MinSpec's part and nothing else.
- **FR-5 - Same guidance, right pointers.** Each file's guidance MUST come from the one
  source the Claude Code files are built from (`slash-commands.ts:192-202`), so the two
  cannot drift. The ZCode files MUST use only header fields ZCode documents, and MUST
  NOT contain the strings `CLAUDE.md` or `.claude/`; where the Claude Code text names
  `CLAUDE.md`, the ZCode text names `AGENTS.md`.
- **FR-6 - Never over a user's file.** If a file of the same name exists without
  MinSpec's markers, MinSpec MUST leave it as it is and name it in the report of FR-12.

### C. The rules

- **FR-7 - `AGENTS.md` carries what `CLAUDE.md` carries.** Every section of the
  `CLAUDE.md` template MUST either appear in the `AGENTS.md` template or appear in one
  list of deliberate omissions, each with a written reason. A test MUST fail when a
  section is added to one template and is in neither the other nor that list. The
  content is inline in the root `AGENTS.md`, because ZCode neither merges nested files
  nor follows imports.
- **FR-8 - The command table tells the truth.** The command table MinSpec writes into
  `AGENTS.md` (`slash-commands.ts:250-273`) MUST name, for each target the project has,
  the folder that target's command files are in, and MUST NOT name a folder for a
  target the project does not have.

### D. What is not carried, and how the user finds out

- **FR-9 - No ZCode hook is written.** MinSpec MUST NOT write hook configuration for
  ZCode in this spec: not into the project's `.zcode/config.json` or `zcode.json`, and
  never into `~/.zcode/`. The session-title hook is not carried.
- **FR-10 - One file MinSpec never writes.** MinSpec MUST NOT create or edit
  `.zcode/config.json`. That file holds tool servers ZCode connects to on opening the
  project, so a write there could start a program on the user's machine.
- **FR-11 - The AI steps stay as they are.** The AI review check and the epic backfill
  AI pass keep running the `claude` program. With a ZCode target their wording MUST
  still say "Claude Code" by name, and they MUST behave exactly as they do today when
  that program or its credential is absent.
- **FR-12 - Shown, never silent.** Whenever init or refresh writes for a ZCode target,
  the user MUST be shown: the files written; any file left alone under FR-6; and the
  not-carried list (session-title hook; any hook-delivered check; the AI review and
  backfill steps still need Claude Code; MinSpec's panels are in VS Code, not ZCode).
  The same list MUST be readable later on demand without re-running init. A not-carried
  item MUST NOT be presented as present, and MUST NOT be dropped from the list without
  a code change that carries it.
- **FR-13 - One place holds the list.** The targets and the not-carried list MUST be
  one data structure that the scaffold, the report and the tests all read, so the
  report cannot claim more than the scaffold writes.

### E. Housekeeping

- **FR-14 - New files join every existing list of harness outputs.** The ZCode command
  files MUST be covered by refresh, by the refresh manifest (SPEC-043, harness refresh
  manifest consistency) and by clean uninstall (SPEC-063). Which lists those are in
  code is for Plan to enumerate; I have not read them all.
- **FR-15 - Offline.** Everything here is file reading and writing inside the project.
  The extension MUST NOT start the `zcode` program or make a network call for any of
  it.
- **FR-16 - Documented version on record.** The ZCode version whose documentation the
  file formats were taken from MUST be recorded beside the code that writes them, so a
  later mismatch can be traced to a date.

### F. A check on a real installation, before design

- **FR-17 - Six facts, measured once.** Before Plan fixes any path, these MUST be
  measured on an installed ZCode and written into this spec's design notes with the
  version number: (1) a command file in `<repo>/.zcode/commands/` appears under `/`;
  (2) the same for `<repo>/.agents/commands/`; (3) the root `AGENTS.md` reaches the
  agent; (4) whether a hook in the project's `.zcode/config.json` runs; (5) what
  first-run onboarding does to an existing `AGENTS.md` when `CLAUDE.md` is also
  present; (6) whether a commit made by ZCode's agent runs the project's git hooks. No
  agent session can do this: ZCode is a desktop app on the founder's machine. If (1)
  fails and (2) passes, FR-4 uses the second folder; if both fail, this spec stops and
  is revised.

## Costly to Refactor

1. **The name and place of the target setting.** Why costly: once projects record it,
   renaming it means migrating their config. What to check: one setting that can hold
   several agents, not a ZCode-only switch.
2. **A fuller `AGENTS.md` for everyone (OQ-1).** Why costly: it lands in every adopter's
   repository at their next refresh and cannot be recalled. What to check: the omission
   list of FR-7 is reviewed line by line before the first release that carries it.
3. **The command folder (FR-4).** Low - files MinSpec owns inside markers; moving them
   is a refresh.

## Acceptance Criteria

- [ ] **Commands appear** - in a project that chose ZCode, the eight phase commands
      exist in the folder FR-17 confirmed, and typing `/minspec-specify` in ZCode finds
      one. (FR-4, FR-17)
- [ ] **No stale pointer** - none of the eight ZCode files contains `CLAUDE.md` or
      `.claude/`, and their guidance text is otherwise identical to the Claude Code
      files. (FR-5)
- [ ] **Rules reach ZCode** - every `CLAUDE.md` template section is in `AGENTS.md` or in
      the omission list, and the test fails when a section is added to neither. (FR-7)
- [ ] **Unchosen projects unchanged** - a project with no recorded choice and no
      `.zcode/` folder gets no ZCode file and is never asked. (FR-2, FR-3)
- [ ] **Asked once** - a project with a `.zcode/` folder is asked once; either answer is
      saved; a second refresh asks nothing. (FR-2)
- [ ] **User files survive** - a hand-written `minspec-plan.md` in the ZCode command
      folder is byte-identical after refresh and is named in the report. (FR-6, FR-12)
- [ ] **Nothing outside the project** - after init and refresh with a ZCode target,
      nothing under the home directory has changed and `.zcode/config.json` is
      untouched or absent. (FR-9, FR-10, INV-3)
- [ ] **The gaps are shown** - the report lists every not-carried item, the list is
      readable later, and it comes from the same structure the scaffold reads. (FR-12,
      FR-13)
- [ ] **No network, no process** - the whole path runs with the network off and starts
      no child process. (FR-15, INV-1)

## Invariants (must not break)

- **INV-1 - Offline core** (constitution invariant 1). Scaffolding for ZCode is file
  reading and writing only. FR-15.
- **INV-2 - No silent gate** (constitution invariant 2). The hook-delivered behaviour
  ZCode lacks is not a required check today: the checks that gate a commit or a merge
  are git hooks and workflows, which do not depend on the agent (context row 5).
  Whatever ZCode cannot carry is named to the user (FR-12), never presented as present.
  If a future hook becomes a gate for Claude Code, its absence under ZCode must fail
  visibly at that point; #37 is where that lands.
- **INV-3 - Blast radius** (constitution invariant 3, DR-074). MinSpec writes only
  inside a project that has `.minspec/`. ZCode's hooks run only from `~/.zcode/` or an
  installed plugin, and `~/.zcode/` is a machine-wide surface, so that route is closed
  by this invariant, exactly as DR-073 (writing into a foreign tool's config) closed
  the global install for Claude Code. FR-9, FR-10.
- **INV-4 - Foreign files** (DR-073). MinSpec's ZCode files are its own, inside
  markers. It edits no file ZCode or the user owns. FR-6, FR-10.

## Open questions for the founder

Each carries a recommendation and what that recommendation costs. The requirements
above assume the recommended answers; approving the spec as it stands accepts them.

### OQ-1 - Does the fuller `AGENTS.md` go to every project, or only to ZCode projects?

- **Option A - every project (rec).** One `AGENTS.md`, the same everywhere; FR-7 as
  written. *Cost:* every existing adopter's `AGENTS.md` grows from about 85 lines to
  several hundred at their next refresh, whether or not they use ZCode, and an agent
  that reads both files sees the rules twice (#1996 suggests Claude Code can; the
  both-files rule is unverified there).
- **Option B - only when ZCode is chosen.** *Cost:* two shapes of `AGENTS.md` to
  maintain and test, and other `AGENTS.md` readers stay on the thin sheet.

### OQ-2 - In a project that uses ZCode, does MinSpec still write the Claude Code files?

- **Option A - yes, add and never remove (rec).** `CLAUDE.md` and `.claude/` are
  written as today; ZCode files are added beside them. Suits a repository worked on
  from both agents, which is how this one would be used. *Cost:* a ZCode-only project
  carries Claude Code files nothing reads, and ZCode's onboarding offers to copy
  `CLAUDE.md` into `AGENTS.md`; what that does to a managed `AGENTS.md` is unmeasured
  (FR-17, fact 5).
- **Option B - each project gets only its chosen agents' files.** *Cost:* init stops
  writing `CLAUDE.md` in some projects, which touches two more readers
  (`template-engine.ts:57-70`, `constitution-context.ts:218`) and widens this spec.

### OQ-3 - Is "no hooks under ZCode" acceptable for now?

Today the only hook MinSpec ships is the session title, which ZCode has no field for.
The one route that stays inside the project is a ZCode plugin kept in the repository,
which you would add and enable once per machine.

- **Option A - accept it, show it, build no plugin now (rec).** *Cost:* when the
  write-time spec gate (#37) ships for Claude Code, a ZCode session will not have it
  until a plugin exists; the commit-time and merge-time checks still apply.
- **Option B - build the plugin now.** *Cost:* a second packaging format and a
  per-machine enable step, to carry a hook that currently has nothing portable in it.

### OQ-4 - Separate question, not this spec: should the dev-time agent scripts start ZCode?

This is about building MinSpec, not about what an adopter gets. The scripts that start
unattended agents are written around `claude -p` (`scripts/lib/agent-context.sh:4-8`).
ZCode's one-prompt mode is described only in its repository, differs in its switches,
and defaults to its least restricted permission mode.

- **Option A - not now; decide after one measured trial, as its own spec (rec).**
  *Cost:* no relief on Claude quota from Z.ai's plan for the unattended fleet this
  month.
- **Option B - specify it now.** *Cost:* the scripts' login, permission and
  output handling would be redesigned against a mode not yet run here once.

## What is not carried, in one place

| MinSpec behaviour | Under ZCode | What the user sees |
|---|---|---|
| Session title from the active spec | Not carried | Named in the report (FR-12) |
| Any future hook-delivered check | Not carried until a plugin exists (OQ-3) | Named in the report |
| AI review check | Still needs Claude Code and an Anthropic credential | Named in the report; the workflow's own notice when unconfigured |
| Epic backfill AI pass | Still needs the `claude` program | Named in the report; the offline heuristic runs instead |
| MinSpec's panels, approval views and signpost | VS Code only | Named in the report; #531 tracks other editors |
| Skills, subagents, tool servers | Nothing shipped to carry | Not listed |

## Risks

1. **The documentation and the installed app differ.** Z.ai's own sources already
   disagree on project hooks, and the app moved from 3.14.5 to 3.15.1 while this was
   written. Mitigation: FR-17 before design, FR-16 after.
2. **ZCode changes its folders.** It is three months old (released 2026-07-02 per
   https://en.wikipedia.org/wiki/Z.ai, a secondary source). Mitigation: one module
   holds the paths (FR-13).
3. **A fivefold `AGENTS.md` crowds other agents' context.** Unmeasured. Mitigation: the
   omission list of FR-7 is the lever.
4. **Onboarding rewrites `AGENTS.md`.** If ZCode's one-time copy of `CLAUDE.md` lands
   inside MinSpec's managed sections, refresh may see user edits. Mitigation: FR-17
   fact 5 decides whether a requirement is needed.
5. **"Next week" and a human check.** FR-17 needs about ten minutes of the founder at a
   machine with ZCode; design waits on it.

## Out of Scope

- MinSpec's interface inside ZCode (#531).
- A ZCode plugin, marketplace entry, skills, subagents or tool servers (OQ-3).
- Moving the AI review check or the epic backfill AI pass off the `claude` program.
- The dev-time agent scripts (OQ-4).
- Improvements for Cursor, Codex, Gemini or other agents beyond what a fuller
  `AGENTS.md` gives them for free.
- Removing `CLAUDE.md` or `.claude/` from any project (OQ-2).

## What this costs

Four new files and six changed ones in the extension; no new dependency; no change to
any check that gates a commit or a merge. One ten-minute measurement by the founder.
A larger `AGENTS.md` in every adopter's repository under OQ-1 Option A.

## Alternatives considered and rejected

- **Tell ZCode users to press "Import commands from external Agent".** Rejected: a
  manual step per machine that copies once and never follows a refresh.
- **Write hooks into `~/.zcode/cli/config.json`.** Rejected: machine-wide, closed by
  constitution invariant 3.
- **Use Claude Code pointed at Z.ai's endpoint and change nothing.** Rejected as an
  answer to this request: it is a different product from the one named, and DR-084
  measured that route failing here.
- **Put the commands in `.agents/commands/` for every agent that follows that
  convention.** Not rejected, deferred to FR-17: the folder is named only in the
  repository's guide, and ZCode's own folder is read first.

## Traceability

- Request: founder, 2026-10-12, quoted above.
- Builds on: SPEC-001 FR-4 and FR-6; SPEC-043; DR-073; DR-074.
- Related open work: #14, #37, #531, #1996, #2682.
