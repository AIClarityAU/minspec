---
id: SPEC-139
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-139 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - the same phase commands and checks, reachable from inside ZCode
relates_to: [SPEC-136, DR-074, DR-116, DR-117, "#37", "#2702", "#2703", "#2726", "#3261", "#3262"]
phases:
  specify: done
  clarify: in-progress
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-139 - Tasks

The order below is the order of work. Each task is one pull request, ends with the full suite
green, and names the requirement IDs it satisfies, the files it touches, the test that proves it
and the tasks it needs first. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md), which no task edits.

Every backticked path in this file is a file a task edits or creates. Files a task only reads are
named in prose. Paths not in requirements.md's `implements:`/`affects:` are listed with their
reason in design.md, *Files*.

Shared rules for every task:

- The plugin holds no rule of its own (FR-1). If the core lacks something, the task stops and
  reports; it does not write the rule here.
- Tests build the plugin themselves with `buildPlugin` into a temp directory. CI runs
  `npx vitest`, so nothing may rely on a `pretest` build.
- Every new check has a negative control in the same test that shows it can go red.
- A passing test here never proves ZCode behaves as its source reads. A requirement marked
  unmeasured in requirements.md is not met until its probe passes (task 18).
- Run `npx vitest run packages/zcode-plugin` and then the whole suite, `npm run lint`,
  `npm run typecheck` and `npm run validate` before calling a task done.

Prerequisites written "FOUNDER OQ-n" are answers design.md, *Left open*, does not choose. Those
tasks do not start until the answer exists.

## 1 - Add the probes to the trial (the #2726 ask)

- [ ] **1.1** No repository file: one bot-attributed comment on #2703 with paste-ready blocks for
  OQ-M1, M3, M4, M5, M6, M7, M8, M10, M11 and M12, from requirements.md's text. OQ-M2 and OQ-M9
  are left out, and the skill half of OQ-M5, per design.md D1 to D3. Correct what the 2026-10-16
  trial showed: `zcode` does not expand in a non-interactive shell, so give
  `node /opt/zcode/app/resources/glm/zcode.cjs`. Use the plugin layout from design.md,
  *Architecture*. Include a small stdio server for OQ-M6, so no core is needed. The OQ-M1 and
  OQ-M4 probes log the hook's whole stdin. Mark each probe "a person types this" (OQ-M4, OQ-M8)
  or "a ZCode agent can run this", so one person does as little as possible.
  *Requirements:* FR-2, FR-5, FR-7, FR-8, FR-9, FR-11, FR-12, FR-15, FR-17, FR-20, FR-24, FR-25,
  FR-27. *Prerequisites:* none. *Test:* none, it is a comment; a reader finds all ten probes and
  a results template.

## 2 - The trial itself (founder only)

- [ ] **2.1** No repository file. The founder runs task 1's blocks in the ZCode container and
  passes back the output, about twenty minutes (requirements.md, *What this costs*). No agent can
  do this (SPEC-136 BND-5). *Requirements:* as task 1. *Prerequisites:* 1. *Test:* none. Tasks
  that wait on a probe say so.

## 3 - Record the results

- [ ] **3.1** `specs/minspec/SPEC-139-zcode-plugin-shell/design.md` - add *Results* under
  *Measurements*, with `zcode --version`, one line per probe, and the table's consequence applied.
  If a result removes a task or drops a declared path, say so there and report it; do not edit
  requirements.md. *Requirements:* as task 1. *Prerequisites:* 2. *Test:* `npm run validate`.

## 4 - The package, the table and the gate (FR-2, INV-3)

- [ ] **4.1** `packages/zcode-plugin/package.json` (private, no `dependencies`),
  `packages/zcode-plugin/tsconfig.json`, and `package.json` (root) - add its `tsc --noEmit` to
  `typecheck`.
- [ ] **4.2** `packages/zcode-plugin/src/plugin-table.ts` - the eight phase commands from
  `SPEC_KIT_COMMANDS`, the three hook-carried names, and the absent-check names FR-8 lists.
  `packages/zcode-plugin/src/opt-in-gate.ts` - per design.md, *The opt-in gate*.
- [ ] **4.3** `packages/zcode-plugin/tests/opt-in-scope.test.ts` - the gate over a folder with
  `.minspec/`, without it, and with `.minspec` as a plain file; `ZCODE_PROJECT_DIR` wins over the
  working directory; no upward search; no child process started.
  *Prerequisites:* none. *Done when:* green, control red, `npm run typecheck` passes.

## 5 - The generator and the eight commands (FR-5, FR-6, INV-5)

- [ ] **5.1** `packages/zcode-plugin/src/build.ts` - `buildPlugin({ outDir })` writes
  `commands/minspec-<phase>.md` from `buildClaudeShim`, with the four-fragment table from
  design.md, *The commands*. A fragment that matches nothing throws. Commands only (D3).
- [ ] **5.2** `packages/zcode-plugin/tests/command-parity.test.ts` - each command equals its
  Claude Code shim after the table and no other change; lines 125 and 131's `CLAUDE.md` /
  `AGENTS.md` wording survives; exactly eight files; no skills folder. Controls: a planted edit
  to one command fails; a fragment removed from the table fails the build.
  *Prerequisites:* 4. *Done when:* green, controls red. OQ-M5 remains open.

## 6 - The carried core and one version (FR-26, FR-1)

- [ ] **6.1** `packages/zcode-plugin/src/build.ts` - copy a `buildCore` bundle to
  `core/minspec-core.cjs`; write `.zcode-plugin/plugin.json` with `name`, `version` and
  `minspecCoreVersion`, read from the bundle's `--version`.
- [ ] **6.2** `packages/zcode-plugin/src/core-call.ts` - runs the core by a path derived from its
  own location, never the path, with a 45 s kill, returning the envelope or a named failure.
- [ ] **6.3** `packages/zcode-plugin/tests/command-parity.test.ts` - the manifest version equals
  the bundle's; a different `minspec-core` placed first on `PATH` is never run; FR-1: each
  runtime program's metafile reaches no validator, lifecycle or approval module, and `build.ts`'s
  only such import is `slash-commands.ts`. Control: a planted import of `approval.ts` fails.
  *Prerequisites:* 5; SPEC-136 tasks 3 and 4 (merged). *Done when:* green, controls red.

## 7 - The session-start hook (FR-8, FR-9, FR-11, FR-2, FR-10)

- [ ] **7.1** `packages/zcode-plugin/src/hook-runner.sh` and
  `packages/zcode-plugin/src/hooks/session-start.ts` - per design.md, *The hooks*: `next` word for
  word, both versions, the absent checks by name, the fixed sentence when `next` is a person's act.
- [ ] **7.2** `packages/zcode-plugin/src/build.ts` - bundle the hook; write `hooks/hooks.json`
  with `SessionStart` only. Read the format from ZCode's source when building, and cite the commit.
- [ ] **7.3** `packages/zcode-plugin/tests/opt-in-scope.test.ts` - without `.minspec/`: exit 0, no
  output. With it: `next` unchanged. Core removed, erroring and hanging, and node off the path:
  each a named message, exit 0, never empty. Output over the cap says it was cut. `run.sh`'s check
  and the gate agree on every fixture. `hooks.json` has no `PreToolUse` (FR-10).
  *Prerequisites:* 6; SPEC-136 task 5 (#3300). OQ-M1, M3 and M12 remain open.
  *Done when:* green, controls red.

## 8 - The tool-server file (FR-12, FR-13, FR-15)

- [ ] **8.1** `packages/zcode-plugin/src/build.ts` - write `.mcp.json` naming the carried core with
  `serve`, stdio only, working folder `${ZCODE_PROJECT_DIR}`.
- [ ] **8.2** `packages/zcode-plugin/tests/no-model-approval.test.ts` - drive the built server over
  pipes: `tools/list` has no `approve`, and nothing that records an approval; `validate`, `hash`,
  `status` and `next` are read-only; `activate` is destructive; `.mcp.json` names no `http` or
  `sse`. Also search every generated file for the core's approve entry and for instructions to
  approve (FR-16), skipping `core/minspec-core.cjs` (design.md, *Invariants*). Control: a planted `approve` tool and a planted instruction each fail.
  *Prerequisites:* 6; SPEC-136 task 11 (#3306). OQ-M6 and M7 remain open.
  *Done when:* green, controls red.

## 9 - The boundary, every entry point (FR-2, FR-3, FR-4, FR-28, FR-29)

- [ ] **9.1** `packages/zcode-plugin/tests/opt-in-scope.test.ts` - with SPEC-136's trap (no copy:
  if it is not exported, move it to a shared helper in `packages/core/tests/helpers.ts`), run the
  hook and the tool server through a full session, in and out of a MinSpec project, with `HOME` an
  empty temp directory: no network, no child process but `git` and the carried core, `HOME` still
  empty, a project-tree snapshot unchanged, no session, presence, heartbeat or queue path. Later
  tasks add their entry points to this same run. Controls: a planted `fetch`, `spawn('gh')` and
  write to `HOME`.
  *Prerequisites:* 7, 8; SPEC-136 task 12 (#3307). *Done when:* green, each control red.

## 10 - The README, all but installation (FR-15, FR-27)

- [ ] **10.1** `packages/zcode-plugin/README.md`, copied by `packages/zcode-plugin/src/build.ts` -
  what the plugin does; that each tool call asks in `build` mode; the one allow rule a person can
  add, for the four read-only tools only; which checks are absent. Installation is task 16's.
- [ ] **10.2** `packages/zcode-plugin/tests/command-parity.test.ts` - the README's rule names
  exactly those four tools and never `activate`. Control: a planted fifth tool fails.
  *Prerequisites:* 8. *Done when:* green, control red.

## 11 - The prompt hook and `/minspec-next` (FR-7, FR-2 exception)

- [ ] **11.1** `packages/zcode-plugin/src/hooks/prompt-commands.ts`,
  `packages/zcode-plugin/src/hook-runner.sh`, `packages/zcode-plugin/src/plugin-table.ts` and
  `packages/zcode-plugin/src/build.ts` - add `UserPromptSubmit`; on `/minspec-next` block with the
  core's `next` and both versions; outside a MinSpec project, block with "not a MinSpec project"
  for all three hook-carried names; any other prompt exits with no output. Use the input field and
  the command-file answer OQ-M4 gave. If OQ-M4 failed, write instead the fallback command FR-7
  names, which says it is a fallback.
- [ ] **11.2** `packages/zcode-plugin/tests/opt-in-scope.test.ts` - feed the hook logged-shape
  input: `next` unchanged; other prompts silent, including `/minspec-nextish` and a prompt that
  mentions the command mid-sentence; node off the path blocks a hook-carried command and passes
  anything else.
  *Prerequisites:* 3 (OQ-M1, M4, M12), 7. *Done when:* green, controls red.

## 12 - Decision record: the approval route and where the plugin is kept (OQ-2, OQ-3)

- [ ] **12.1** `docs/decisions/DR-NNN.md` (number from the collision gate,
  scripts/check-dr-id-collision.ts, never from the files on disk) and `docs/decisions/INDEX.md` -
  record the founder's two answers, verbatim, and OQ-M4's result. Born `proposed`.
  *Requirements:* FR-17, FR-25. *Prerequisites:* 3 (OQ-M4); FOUNDER OQ-2; FOUNDER OQ-3. *Test:* `npm run validate`; the record
  carries `## In plain terms`.

## 13 - `/minspec-approve` (FR-16, FR-17, FR-18, FR-19, INV-6)

Written for OQ-2 answer A. Any other answer replaces this task, and answer D removes it.

- [ ] **13.1** `packages/zcode-plugin/src/hooks/prompt-commands.ts` - per design.md, *Approval*:
  run the core's `approve` with the id as one argv item, show the outcome, and stop the prompt.
  Every core refusal is shown as it is. No commit.
- [ ] **13.2** `packages/zcode-plugin/src/build.ts` - if OQ-M4 calls for `commands/minspec-approve.md`,
  its body says only that the approval hook did not run and nothing is to be approved.
- [ ] **13.3** `packages/zcode-plugin/tests/no-model-approval.test.ts` - in a fixture repo with a
  human `user.email`: one prompt approves, the output has no continuation for the model, and the
  changed paths are the core's allowed set. A bot address and a bad id are refused with no write.
  A hook failure leaves nothing the model can act on. The search from 8.2 allows the core's
  approve entry only in the hook's own source. Control: a planted instruction in a command file.
  *Prerequisites:* 11, 12; SPEC-136 task 13 (#3308). If OQ-M4's failure probes let the typed text
  reach the model, stop: FR-17 says no approval entry point ships. *Done when:* green, controls
  red. The limit in FR-18 is stated in the README.

## 14 - The page process (FR-20 binding, FR-21, FR-22, FR-23)

- [ ] **14.1** `packages/zcode-plugin/src/page/server.ts` - per design.md, *The page*: `next` and
  `status` with both versions and the read time; the two other panes named as not yet available; no write
  route; the 30-minute idle stop. `packages/zcode-plugin/src/build.ts` - bundle it.
- [ ] **14.2** `packages/zcode-plugin/tests/page-loopback.test.ts` - binds `127.0.0.1` only; refuses
  no secret, a wrong secret and a wrong `Host`; no `Access-Control-*` header; escapes a planted
  `<script>` title; any non-GET method is refused and the project tree is unchanged; idle stop with
  a test-only short time. Control: a planted `0.0.0.0` bind fails.
  *Prerequisites:* 3 (OQ-M4, M8, M12); 6; SPEC-136 task 5 (#3300). If OQ-M4 or OQ-M8 fails, FR-24
  drops the page: this and task 15 do not start, and that is reported.
  *Done when:* green, control red.

## 15 - `/minspec-page`, start and stop (FR-20, FR-24, FR-29)

- [ ] **15.1** `packages/zcode-plugin/src/hooks/prompt-commands.ts` - start the page detached with
  stdio closed, show the link to the person by FR-7's route, write
  `.minspec/locks/zcode-page.pid`; `stop` ends it and removes the file. A second start reports the
  running one. A pid file git does not ignore: refuse and say why.
- [ ] **15.2** `packages/zcode-plugin/tests/page-loopback.test.ts` - the started process outlives
  the hook; `stop` ends it; `git check-ignore` passes on a scaffolded fixture and the refusal
  fires on a bare one; a stale pid file does not end an unrelated process. Add this entry point to
  task 9's run.
  *Prerequisites:* 11, 14. *Done when:* green, control red.

## 16 - The folder other machines install (FR-25)

Written for OQ-3 answer A. Any other answer replaces this task.

- [ ] **16.1** The built folder and the marketplace file, at the path the answer and the record
  name; `packages/zcode-plugin/src/build.ts` writes them. `packages/zcode-plugin/README.md` gains
  the add-once and enable-once steps, nothing asked again.
- [ ] **16.2** `packages/zcode-plugin/tests/command-parity.test.ts` - the committed folder equals a
  fresh build, with the rule the record sets for the core's stamp and bundle (design.md, *Left
  open*). Control: a planted edit fails.
  *Prerequisites:* 12, 7, 8, 10; FOUNDER OQ-3. *Done when:* green, control red.

## 17 - The built folder against the boundary (FR-1, FR-2, FR-3, FR-4, FR-28, FR-29)

- [ ] **17.1** `packages/zcode-plugin/tests/opt-in-scope.test.ts` - run task 9's harness over the
  built folder as committed, with every entry point that shipped, with the network off.
  *Prerequisites:* 16, and 13, 15 where they
  shipped. *Done when:* green, controls red.

## 18 - The real plugin in ZCode (FR-27, the open acceptance criteria) (founder only, then recorded)

- [ ] **18.1** The founder adds the plugin in the container from GitHub, and repeats OQ-M1, M3, M5,
  M6, M7, M10 and M11 on it, in the app and the command line. No agent can do this (SPEC-136 BND-5).
- [ ] **18.2** `specs/minspec/SPEC-139-zcode-plugin-shell/design.md` - record the results.
  `packages/zcode-plugin/README.md` and `packages/zcode-plugin/src/hooks/session-start.ts` - name
  any place the app and the command line differ (FR-27), with the matching test in
  `packages/zcode-plugin/tests/opt-in-scope.test.ts`.
  *Prerequisites:* 16, 17. *Done when:* each acceptance criterion in requirements.md is ticked or
  named as not holding.

## 19 - The write-time gate (FR-10) - not started, waits for #37

- [ ] **19.1** Blocked by #37, which is on hold for its own spec. No group here depends on this
  task, and nothing starts it until #37 specifies the Claude Code gate. When it does:
  `packages/zcode-plugin/src/hooks/` gains the `PreToolUse` hook calling the same core operation;
  a core error or an unreadable result denies the write with a message; 7.3's "no `PreToolUse`"
  assertion changes with it. *Requirements:* FR-10. *Test:* a planted core error denies the write.
