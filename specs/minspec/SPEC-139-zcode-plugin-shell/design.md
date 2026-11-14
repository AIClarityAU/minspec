---
id: SPEC-139
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-139 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - the same phase commands and checks, reachable from inside ZCode
relates_to: [SPEC-136, SPEC-076, DR-004, DR-074, DR-116, DR-117, "#37", "#2702", "#2703", "#2708", "#2725", "#2726", "#2736", "#3262", "#3261"]
phases:
  specify: done
  clarify: in-progress
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-139 - Design: the ZCode plugin, a generated folder around the headless core

Plan for [requirements.md](requirements.md). The contract is that file; this one says how to
build it. Citations of "today" are against `origin/main` at `989fdc61`. New code is named by
symbol, because its line numbers will move. Everything about ZCode here is still a reading of
its source at `aac47556` (CLI 0.16.9), never a run, and says so where it matters.

## Approach in one paragraph

A new private workspace package, `packages/zcode-plugin`, holds one table (`plugin-table.ts`)
and one generator (`build.ts`). The generator writes a plugin folder: the eight phase commands
rendered from `SPEC_KIT_COMMANDS` and `buildClaudeShim`, a hooks file, a tool-server file, a
manifest, a copy of the core bundle from SPEC-136's `buildCore`, and three small bundled
programs (session-start hook, prompt hook, page). Every program finds the core by its own
location, never on the path, and passes one opt-in gate first. Tests build the folder into a
temp directory and drive the programs as child processes, feeding them the JSON and environment
ZCode's source says a hook gets. No test claims ZCode behaves that way: that is what the trial
is for. Parts whose code stands under every trial answer are built now. Parts a failed probe
would delete or make unsafe (the prompt hook, approval, the page) wait for the trial.

## What the plan relies on (read at 989fdc61)

| Fact | Where |
|---|---|
| Phase commands and their renderer | `SPEC_KIT_COMMANDS` and `buildClaudeShim` - `packages/minspec/src/lib/slash-commands.ts:42`, `:192` |
| The four `CLAUDE.md` sentences FR-5 substitutes | `slash-commands.ts:139`, `:155`, `:171`, `:180` (FR-5 cites `:154`, `:170`, `:179`; the lines have moved by one) |
| Two more `CLAUDE.md` mentions, not in FR-5 | `slash-commands.ts:125`, `:131` already say `CLAUDE.md` / `AGENTS.md`. A blanket replace would turn them into `AGENTS.md` / `AGENTS.md` and break FR-5's "no other" |
| Opt-in marker | `hasOptInMarker` - `packages/minspec/src/lib/opt-in.ts:57`; the file imports only `fs` and `path` |
| Core bundle | `buildCore` - `packages/core/build.mjs`; CommonJS, `target: 'node20'`, version stamp `<version>+<short sha>` with `-dirty` |
| Core operations on main today | `hash` only, plus `--version` and `--list` (`packages/core/src/operations.ts`) |
| Next-action kinds | `NodeKind` includes `spec-approve` and `adr-accept` - `packages/shared/src/next-task.ts:169` |
| A path adopters already ignore | `.minspec/locks/` in `MINSPEC_GITIGNORE_ENTRIES` - `packages/minspec/src/lib/scaffold.ts` |
| Test discovery | `packages/*/tests/**/*.test.ts` is already included; `packages/core/tests/helpers.ts` shows the child-process pattern |
| This repository is public | `gh repo view AIClarityAU/minspec` returned `PUBLIC` on 2026-10-31 |

### How much of SPEC-136 exists (it decides the order)

| SPEC-136 task | What SPEC-139 needs from it | State on main |
|---|---|---|
| 1, 2 | The command-line and boundary records (DR-116, DR-117) | Merged |
| 3, 4 | `buildCore`, `--version`, the envelope, `hash` | Merged (#3317, #3405) |
| 5 | `status`, `next` | Open, #3300 |
| 11 | The tool server and its annotations (SPEC-136 FR-26) | Open, #3306 |
| 12 | The boundary trap harness | Open, #3307 |
| 13 | `approve` | Open, #3308 |
| 16 | The release asset | Open, #3343. Not needed: FR-26 here carries the core inside the plugin |

So the first build slice (package, gate, commands, manifest) can start today. Everything after
it names its SPEC-136 task as a prerequisite. SPEC-136's design says "the plugin (SPEC-139)
fetches it from GitHub"; FR-4 here forbids a network call from any entry point, so the plugin
never fetches. The core arrives inside the plugin folder, and the folder arrives from GitHub
when the person adds it (FR-25).

## Decisions

Queue item s139 (2026-10-21) moved SPEC-139's five open decisions and twelve measurements to
planning. Three of the five are settled below. Each is chosen by the planning agent on its
recommendation; not a founder decision. Each can be undone in under a day, because nothing has
been installed anywhere yet and the only place to change is one ZCode container.

- **D1 - OQ-1, how hooks are delivered: A, installed and enabled once per machine, every hook
  checking `.minspec/` itself.** Chosen because it is one act per machine and writes no file
  into any project, and it is the route FR-11 and FR-2 are already written for. Rejected: **B**,
  workspace hooks, which ask for trust again on every hook change, and which the source admits
  only through the desktop app's protocol server. **C**, a plugin folder per project, which
  makes ZCode run a project's code when it is opened (the #2708 class, Risk 8). **D**, enabling
  per project, which writes a committable file that enables the plugin for everyone who opens
  the project. Cost: a bug in the gate reaches projects that never opted in, so FR-2's test runs
  every entry point without `.minspec/`, and the gate is built first (task 4). It does not
  settle OQ-M1: if plugin hooks do not run, FR-8, FR-10 and FR-17 fall away (Risk 1), and
  turning to B then needs the decision record requirements.md names.
- **D2 - OQ-4, can the page write: A, read-only first.** Chosen because FR-22 already says
  read-only for the first release, and a write needs a core operation SPEC-136 does not have.
  Rejected: **B**, toggling tasks from the page, which adds to SPEC-136's table and opens a
  write path around ZCode's permission screen. Cost: tasks are toggled in the editor or by the
  agent, not by a click.
- **D3 - OQ-5, skills as well as commands: A, commands only.** Chosen because a second copy of
  the text gains nothing until a person has asked for it, and the person invokes phases by
  command in Claude Code today. Rejected: **B**, also as skills, which is a second copy for the
  parity test to cover, in a format not yet measured. Cost: the agent does not pick up phase
  guidance by itself.

These answers end two measurements and part of a third. **OQ-M2** was "only if OQ-1 is B",
**OQ-M9** was "only if OQ-4 is B", and the skill half of **OQ-M5** was "if OQ-5 is B". Ten
measurements remain.

### Left open: these two are not chosen here

requirements.md, *Costly to Refactor* 2 and 3, and *Decision records*, rank **OQ-2** (how the
person approves) and **OQ-3** (where the plugin is kept) as hard to undo, and say the record
covering them follows the founder's answers. This plan therefore picks neither. That section's
heading also places the record before Plan; it cannot come first here, because the answers
moved to planning. It keeps its purpose by coming before any task it guards: task 12 is the
record, and tasks 13 and 16 (and 17 and 18, which follow 16) cannot start without it. No other
task depends on either answer: the generator writes to any folder it is given, and nothing here commits that folder.

Two facts for whoever answers OQ-3, neither of which requirements.md records:

- The core's version stamp holds a commit sha (`build.mjs`), and a committed file cannot hold
  the sha of its own commit. So a test that compares a committed bundle with a fresh build can
  never pass as written; it would have to ignore the stamp.
- Any change to `packages/minspec/src/lib` changes the bundle. If each such pull request also
  has to regenerate a committed bundle, parallel pull requests collide on one minified file.
  Keeping the freshness test to the generated text files, and refreshing the bundle at a
  stated point, avoids that; the plugin's core then lags `main`.

## Architecture

```
packages/zcode-plugin/
  package.json             @aiclarity/minspec-zcode-plugin, private, no runtime dependencies
  tsconfig.json            noEmit typecheck; includes src/, tests/
  README.md                the person-facing text; copied into the built folder
  src/plugin-table.ts      every command, hook, tool-server entry and program, in one table
  src/build.ts             buildPlugin({ outDir }) renders the table into a folder
  src/opt-in-gate.ts       the one gate (FR-2)
  src/core-call.ts         runs the carried core with a timeout and reads its envelope
  src/hook-runner.sh       what ZCode starts; handles a missing node (FR-9)
  src/hooks/session-start.ts
  src/hooks/prompt-commands.ts
  src/page/server.ts
  tests/*.test.ts          the four owned tests
```

The built folder, as the source reading describes a plugin. Its layout is what OQ-M1, OQ-M5 and
OQ-M6 measure, so the trial's probe plugin uses the same layout:

```
<out>/
  .zcode-plugin/plugin.json     name, version, minspecCoreVersion
  commands/minspec-<phase>.md   the eight (plus any FR-16 / FR-7 command file OQ-M4 calls for)
  hooks/hooks.json              SessionStart and UserPromptSubmit; never PreToolUse (FR-10)
  hooks/run.sh                  src/hook-runner.sh
  hooks/session-start.cjs       bundled
  hooks/prompt-commands.cjs     bundled
  page/server.cjs               bundled
  core/minspec-core.cjs         from buildCore; the only core the plugin runs (FR-26)
  .mcp.json                     stdio, node ${ZCODE_PLUGIN_ROOT}/core/minspec-core.cjs serve
  README.md
```

### The opt-in gate (FR-2, INV-3)

`opt-in-gate.ts` imports `hasOptInMarker` and takes the root from `ZCODE_PROJECT_DIR`, else the
working directory. It starts no child process: it runs on every prompt in every project on the
machine, so it must cost a file check and nothing more. The core's own refusal stays as the
second layer for tools. The root is never searched upwards, as in SPEC-136.

### The commands (FR-5)

The substitution is a table of exactly four sentence fragments, each a `from` and a `to`:
"invariants in `CLAUDE.md`", "recorded in `CLAUDE.md`", "invariants from `CLAUDE.md`" and
"escalate per `CLAUDE.md`". `build.ts` throws when a fragment matches no phase, so a reword in
`slash-commands.ts` stops the build instead of quietly letting `CLAUDE.md` through. The parity
test applies the same table to `buildClaudeShim`'s output and compares bytes.

Known limit, not widened here: FR-5 says `AGENTS.md` carries the same invariants, and it does.
A grep of `packages/minspec/src/lib` finds "dependency budget" in no scaffolded template, for
`CLAUDE.md` or `AGENTS.md`, so that sentence points at text an adopter's file may not have. The
same is true in Claude Code today.

### The hooks (FR-7 to FR-11, FR-17)

`hooks.json` starts `sh ${ZCODE_PLUGIN_ROOT}/hooks/run.sh <program>`. The shell step exists
because FR-9 includes "Node absent", and a Node program cannot report that Node is absent.

- **Node present:** `run.sh` starts the bundled program with stdin passed through.
- **Node absent, session start:** in a project with `.minspec/` it prints an `additionalContext`
  naming the missing program; elsewhere it prints nothing (FR-2).
- **Node absent, prompt:** if the prompt begins with a hook-carried command, it blocks with a
  message (outside a MinSpec project, FR-2's "not a MinSpec project"); anything else passes in
  silence. This fails closed for FR-17.

`run.sh` holds a second copy of the `.minspec/` check, because the gate cannot run without Node.
Two predicates can drift, so `opt-in-scope.test.ts` runs both over the same folders and fails if
they disagree.

**Session-start context (FR-8).** Fixed order: the core's `next` result, unchanged; the core's
version and the plugin's; the absent checks by name, from `plugin-table.ts`. It closes with one
fixed sentence whenever `next` is a person's act (`spec-approve`, `adr-accept`): the agent does
not do this step; the person does. FR-8 hands the agent `next`, and `next` can read "approve
SPEC-NNN", while FR-16 forbids hook output telling the model to approve. The core's text stays
word for word and the sentence makes it not an instruction.

**Limits.** The source reading gives hooks a 60 s default and 32,768 bytes of output.
`core-call.ts` kills the core at 45 s and reports that as a core failure (FR-9). Output near the
cap is cut with a line saying it was cut, never in silence (invariant 2).

**Prompt hook.** It acts only on a prompt that, after trimming, begins with `/minspec-approve`,
`/minspec-next` or `/minspec-page`. Everything else exits at once with no output. An argument
must match `SPEC-\d+` (or `stop` for the page) and reaches the core as one argv item, never
through a shell. The name of the prompt field in the hook's input is not in the spec's reading,
so the trial's probe logs the whole input and task 11 reads the field from that log.

### The tool server (FR-12 to FR-15)

`.mcp.json` names the carried core with `serve`, and no HTTP or SSE form exists to name. The
plugin adds nothing to tool results: FR-14 and FR-15's declarations are the core's (SPEC-136
FR-16, FR-18, FR-26). FR-13's test reads both the built `.mcp.json` and the live `tools/list`.

### Approval (FR-16 to FR-19), if OQ-2 is answered A

The hook runs `core approve --spec <id>` and shows the envelope's outcome and message as the
`stopReason`. **It does not commit**, the choice SPEC-136's design left to this spec. Chosen by
the planning agent on its recommendation; not a founder decision. Committing would put a second
policy (which paths, which author) in the plugin and write history from a hook; rejected. Cost:
the approval sits in the working tree until a later commit, so the result text says that.

### The page (FR-20 to FR-24)

`page/server.ts` uses Node's `http` and binds `127.0.0.1` on port 0. The secret is 32 random
bytes in the link's path, compared in constant time. A request without it, or with a `Host`
other than `127.0.0.1:<port>`, is refused. Every response sends `Cache-Control: no-store`,
`Referrer-Policy: no-referrer` and `Content-Security-Policy: default-src 'none'; style-src
'unsafe-inline'`, with no `Access-Control-*` header. It runs no script. All text is escaped,
because spec titles are repository content.

Each page load runs the carried core's `next` and `status` and shows both versions (FR-26) and
the read time. The decision list and the active spec's tasks are named as not yet available
(FR-21), as the queue answer on #2736 point 5 left them. The process stops after **30 idle
minutes**, a value chosen by the planning agent on its recommendation (long enough for a
reading break, short enough not to linger; FR-20 asks for a stated time and names none), and on
`/minspec-page stop`. It starts detached with stdio closed, so the hook that started it can
exit. Its process id goes in `.minspec/locks/zcode-page.pid`: scaffolded projects already ignore
that folder, so FR-29 needs no scaffold change. If `git check-ignore` says the file is not
ignored, the page refuses to start and says why.

## Files

Owned by this spec (`implements:`): `plugin-table.ts`, `build.ts`, `opt-in-gate.ts`,
`hooks/session-start.ts`, `hooks/prompt-commands.ts`, `page/server.ts` and the four tests.
Modified, owned elsewhere (`affects:`): root `package.json`.

Not declared in requirements.md, and why each is still needed:

| File | Task | Why |
|---|---|---|
| `packages/zcode-plugin/package.json`, `tsconfig.json` | 4 | A workspace package needs a manifest and a typecheck config |
| `packages/zcode-plugin/src/core-call.ts` | 6 | One place that runs the carried core, so FR-9's failure text and FR-26's path rule are not written three times |
| `packages/zcode-plugin/src/hook-runner.sh` | 7 | FR-9's "Node absent" cannot be reported by a Node program |
| `packages/core/tests/helpers.ts` | 9 | Only if SPEC-136's trap is not exported by then: one shared trap, never a copy |
| `packages/zcode-plugin/README.md` | 10 | FR-15, FR-25 and FR-27 each require text in "the plugin's README" |
| `docs/decisions/DR-NNN.md`, `docs/decisions/INDEX.md` | 12 | The record requirements.md says is owed for OQ-2 and OQ-3 |
| The built folder and marketplace file | 16 | Their location is OQ-3's answer |

If a probe drops the page or the prompt hook (FR-24, FR-17), the matching `implements:` paths
will never exist, and removing them from requirements.md needs a fresh approval. The task that
hits this reports it rather than editing the file.

## Invariants, and how each is tested

| Invariant | Test | How |
|---|---|---|
| INV-1 offline (FR-4) | `opt-in-scope.test.ts` | Every entry point runs under SPEC-136's trap with the network modules and non-`git`, non-`node` child processes recorded. Only the page binds, and only when started |
| INV-2 no silent gate (FR-2, FR-9, FR-10) | `opt-in-scope.test.ts` | Core removed, core erroring, core hanging and node off the path each give a named message. A refusal is never empty. `hooks.json` has no `PreToolUse` until #37 |
| INV-3 blast radius (FR-2, FR-3) | `opt-in-scope.test.ts` | Every entry point against a folder without `.minspec/`, with `HOME` an empty temp directory that stays empty |
| INV-4 the boundary (FR-12, FR-20, FR-25, FR-28, FR-29) | `opt-in-scope.test.ts`, `page-loopback.test.ts` | A snapshot of the project tree allows only the named writes; no session, presence or queue path; the page binds `127.0.0.1` only |
| INV-5 one copy of the rules (FR-1, FR-5) | `command-parity.test.ts` | Byte parity with the Claude Code shims. The bundle metafile of each runtime program reaches no validator, lifecycle or approval module |
| INV-6 the model never approves by accident (FR-13, FR-16, FR-17) | `no-model-approval.test.ts` | The built folder is searched, and `tools/list` is read. FR-16's search allows a hit only in the prompt hook; the carried `core/minspec-core.cjs` is also skipped, because it is the core itself (it must hold `approve`, FR-17) and not plugin text. `tools/list` is what proves the model is not offered it |

Each check has a negative control in the same file: a planted extra command body, a planted
`approve` tool, a planted instruction in a command file, a planted `0.0.0.0` bind. A test that
cannot go red proves nothing.

The requirements let Plan place two checks. **FR-1's import check goes in `command-parity`**,
because it reads the same build metafile. **FR-9's missing-core message goes in `opt-in-scope`**,
because it already drives every hook. `build.ts` imports `slash-commands.ts`, which itself
imports `spec-validator` (`slash-commands.ts:4`). That is build time only, so FR-1's check reads
what each shipped program bundles, and separately allows `build.ts` that one direct import.

## Measurements

Task 1 posts the probes, task 2 is the person's run, and task 3 records the results here under a
new *Results* heading with the ZCode version. None is answered yet. Two pieces of evidence narrow
two of them without answering them:

- **OQ-M12:** on 2026-10-16 a ZCode agent in the container ran
  `node /opt/zcode/app/resources/glm/zcode.cjs` (#2703), so `node` was on that agent's path. Its
  version was not recorded, and a hook's path may differ.
- **OQ-M10:** the repository is public (see the table above). Whether ZCode's marketplace needs a
  login for it is still the probe's question.

What each result changes:

| Probe | If it fails | Tasks that wait on it |
|---|---|---|
| OQ-M1 plugin hooks run | FR-8, FR-10 and FR-17 fall away; commands and tools only (Risk 1) | 11, 13, 15 (task 7 is removed) |
| OQ-M3 `additionalContext` reaches the agent | FR-8 has no route; task 7 is removed and the README says so | 18 |
| OQ-M4 a prompt hook answers without the model, and fails closed | `/minspec-next` takes its fallback; no approval entry point; the page is dropped | 11, 13, 14, 15 |
| OQ-M5 plugin commands keep their names and `$ARGUMENTS` | The generator's output changes; the parity test stands | 18 |
| OQ-M6 a plugin's stdio server starts | FR-12 has no route; prose and commands only | 18 |
| OQ-M7 tools in each mode | The README's text changes | 18 |
| OQ-M8 the link opens in a browser inside the container, and a hook-started process lives on | The page is dropped (FR-24) | 14, 15 |
| OQ-M10 install from this repository | Delivery needs another route: back to OQ-3 | 16, 18 |
| OQ-M11 app and command line agree | The README and the session-start text name the difference (FR-27) | 18 |
| OQ-M12 node on the hook's path | `run.sh` reports it; FR-7, FR-12, FR-17 and FR-20 cannot run | 11, 13, 14 |

## Build order

The rule: a task waits for a probe when a failed probe would delete it **and** leave something
unsafe or misleading behind (approval, the listener), or when the probe decides what the task
writes (the prompt hook). Other tasks go ahead, because requirements.md says everything unmeasured
"is checked by the VM trial, not by a test in this repository": building them assumes nothing,
and no requirement counts as met until its probe passes. Chosen by the planning agent on its
recommendation; not a founder decision. Rejected: holding all code until the trial, which leaves
the plugin waiting on one person's twenty minutes while the commands and tools would stand under
every answer. Cost: if OQ-M1 fails, task 7 is about one program and one shell script thrown away.

1. The trial (tasks 1 to 3), alongside everything else.
2. The gate first, then commands, core and manifest (tasks 4 to 6). No SPEC-136 task still open.
3. Session-start hook (7, after SPEC-136 task 5), tool-server file (8, after SPEC-136 task 11),
   the boundary run (9, after SPEC-136 task 12), README (10).
4. The prompt hook with `/minspec-next` (11), which waits on the trial.
5. The record (12), which waits on the OQ-2 and OQ-3 answers, then approval (13).
6. The page (14, 15), which waits on the trial.
7. Delivery and the run on the real plugin (16 to 18).
8. The write-time gate (19), which waits for #37.

## Design decisions and the rejected alternatives

Each is chosen by the planning agent on its recommendation; not a founder decision.

- **The gate imports `hasOptInMarker`, not the core.** Starting the core on every prompt in every
  project is a Node start for nothing. Rejected: asking the core. Cost: the package imports one
  library file directly, which FR-1 allows because `opt-in.ts` is not a validator, lifecycle or
  approval module.
- **A shell step in front of the hooks.** Rejected: a Node-only hook, which prints nothing when
  Node is absent, the case FR-9 forbids. Cost: a second `.minspec/` check, pinned by a test.
- **Exact sentence fragments for the substitution.** Rejected: replacing every `CLAUDE.md`, which
  corrupts lines 125 and 131. Cost: a reword in `slash-commands.ts` stops the plugin build until
  the table is updated, which is the point.
- **Each page load calls the core.** Rejected: caching, which would need a rule for when it goes
  stale. Cost: two child processes per load, on a page one person opens.

## Follow-ups (tracked)

- The probes joining the trial: #2726, done by task 1.
- SPEC-136's wording points, unchanged by this plan: #2725.
- The page's two other panes, which need new SPEC-136 read operations: #2736 point 5.
- The write-time gate: #37, task 19.
- Files that execute on the machine that pulls them: #2708.
- The record for OQ-2 and OQ-3: task 12.
- Also scaffolding phase commands to `.agents/commands/`: #2727.
- The build tracker for this spec: #3262.
