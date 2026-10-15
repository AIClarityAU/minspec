---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - the harness MinSpec writes is how the model finds the methodology's tools; this makes the rest of the roster findable the same way
aspects: [harness, skills, agents, hooks, tool-search, defer-not-strip, compliance-nudge, tier-0, offline, blast-radius, signpost]
depends_on: [DR-073, DR-074]  # DR-073 the additive never-clobber merge any settings write must use; DR-074 the blast-radius rule that decides where the index and the hook may live
relates_to: [SPEC-038, DR-066, DR-086, "#638", "SCR#50", "SCR#49"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). These are the
# files under the RECOMMENDED answers to OQ-1 (home) and OQ-3 (matching). A different
# answer to OQ-1 moves the hook and generator entry point into the shipped harness
# (`hook-templates.ts`, `scaffold.ts`), and this list is rewritten before approval.
implements: [packages/shared/src/capability-index.ts, packages/shared/tests/capability-index.test.ts, scripts/capability-index.ts, scripts/hooks/compliance-nudge.sh, scripts/tests/compliance-nudge.test.ts, .claude/skills/search-capabilities/SKILL.md, .claude/skills/search-capabilities/index.md]
# Modified, not owned. `index.ts` re-exports the pure generator; `.claude/settings.json`
# gains one UserPromptSubmit entry, written by DR-073's additive merge.
affects: [packages/shared/src/index.ts, .claude/settings.json]
phases:
  specify: in-progress
---

# SPEC-137: A capability index the model reads on demand - the whole skill and agent roster is findable without loading it, and nothing is hidden from the model

Triggered by: #638 (search_capabilities index skill - defer, never strip).
Rests on: DR-073 (additive, never-clobbering writes into a foreign tool's config), DR-074
(blast radius is the project with `.minspec/` at its root). No new decision record yet - see
"Decision records" below.

## In plain terms

A large set of specialist skills and agents is useful only if the model knows they exist.
Today each one either costs context in every session (its listing is always loaded) or is
invisible (it is not installed, or the human must remember to summon it). This spec adds
**one small, always-present skill** whose job is to point at a **table of every
capability**, kept in a file the model reads only when it needs it. The model searches the
table by what it is trying to do, then loads the capability it picked through the normal
Skill or Task route.

Two rules carry the design:

- **Defer, never strip.** Nothing in this spec removes a capability from what the model
  can see. It only adds a cheaper way to find capabilities. A component that silently
  drops a capability before the model sees it is banned (INV-1).
- **Nudge, never load.** A deterministic hook may *remind* the model to look in the index
  when a prompt plainly mentions compliance terms (GDPR, HIPAA, PCI, PII). It never loads
  anything itself and never blocks the prompt.

## One-Sentence Scope

Generate a deterministic, offline capability index of the project's skills and agents,
expose it through one always-loaded `search-capabilities` skill that tells the model to
check it before concluding a capability is missing, and add an advisory
`UserPromptSubmit` nudge for explicit compliance terms - all inside the project that opted
in with `.minspec/`.

## Context - what the harness already does (read, partly unverified)

- **Skill bodies are already deferred.** I believe, from Anthropic's Claude Code
  documentation and not measured here, that Claude Code loads only each skill's `name` and
  `description` into context at session start and loads the body when the Skill tool is
  invoked. So the issue's "no native defer for skills" is half true: the *body* is
  deferred natively; the *listing* is not, and its cost grows with the roster. The listing
  in this very session (dispatch of #638) shows ~20 skills and ~5 agent types, each with a
  full description, before any work starts.
- **Uninstalled capabilities are invisible.** A vendored roster such as
  `scripts/roles/vendor/agency-agents/` (MIT, pinned by
  `scripts/roles/vendor/agency-agents.lock.json`) is on disk but is not a skill or agent the
  harness lists. Nothing tells the model it exists. This is the gap the index is for.
- **Tools and MCP servers have a native route.** The Anthropic API offers a Tool Search
  tool with `defer_loading: true` on tool definitions, and Claude Code exposes an MCP tool
  search setting. I have not verified the exact Claude Code setting name or its default in
  the version in use; Plan must read the current docs before writing any config (FR-11).
- **This repo already runs `UserPromptSubmit` hooks** - `.claude/settings.json:25-29`
  (`scope-check.sh`, `session-title.sh`). DR-073 is the record that governs adding one.
- **Measurement is pending.** SCR#49 (context-bloat measurement, scroogellm repo) is the
  instrument that says how many tokens the listing costs today. Its number is not in hand;
  FR-14 makes the benefit a measured claim rather than an assumed one.

## Terms

| Term | Meaning |
|---|---|
| **Capability** | A skill, an agent type, or an MCP tool the model could use. |
| **Roster** | Every capability the generator is configured to index, installed or not. |
| **Index** | The generated table (`index.md`) - one row per capability. Read on demand, never always-loaded. |
| **Index skill** | The `search-capabilities` skill. Only its name and description are always loaded. |
| **Defer** | Keep a name stub visible and load the body only when the model chooses. |
| **Strip** | Remove a capability from the model's view before it can choose. Banned. |
| **Nudge** | Extra context a hook adds to a prompt, telling the model to look at the index. |

## Contract

The generator is pure and Tier-0 (no `vscode`, no network; constitution constraint 1), so
it lives in `@aiclarity/shared`:

```ts
export type CapabilityKind = 'skill' | 'agent' | 'mcp-tool';

export interface CapabilityRow {
  name: string;          // invocation name, unique within kind
  kind: CapabilityKind;
  summary: string;       // one line, no newline, <= SUMMARY_MAX chars (FR-3)
  invoke: string;        // exact route, e.g. "Skill: minspec-plan" or "Task: subagent_type=Explore"
  tags: string[];        // lower-case intent words; 'compliance' is a reserved tag (FR-9)
  source: string;        // repo-root-relative path the row was read from
  installed: boolean;    // false = on disk but not loadable without an install step (OQ-2)
}

export interface CapabilityIndex {
  rows: CapabilityRow[];       // sorted by kind, then name - byte-stable output
  sourceDigest: string;        // hash over every source file read, for staleness (FR-6)
}

export function buildCapabilityIndex(sources: ReadonlyArray<{ path: string; text: string }>): CapabilityIndex;
export function renderIndexMarkdown(index: CapabilityIndex): string;
export function findCapabilities(index: CapabilityIndex, query: string): CapabilityRow[]; // FR-8
```

## Functional Requirements

### A. The index

- **FR-1** A generator builds the index from the roster sources configured for the project
  (default under OQ-1 recommendation: `.claude/skills/*/SKILL.md`, `.claude/commands/*.md`,
  `.claude/agents/*.md`, and `scripts/roles/*.md` plus `scripts/roles/vendor/**/*.md`).
  It reads files only; it makes no network call (constitution invariant 1).
- **FR-2** Each row's `name`, `summary` and `tags` come from the source's frontmatter
  (`name`, `description`, and a `tags:` list if present). A source with no usable name is
  **reported** by the generator, with its path, and left out of the index - never dropped
  silently (constitution invariant 2's spirit; the generator's report is the visible
  witness).
- **FR-3** `summary` is the first sentence of `description`, cut at `SUMMARY_MAX`
  characters (Plan picks the value; a starting point is 120). A cut summary ends with an
  ellipsis so the row never reads as complete when it is not.
- **FR-4** Output is deterministic: same sources, same bytes. Rows are sorted by kind then
  name; no timestamps in the body.
- **FR-5** Two rows with the same `kind` and `name` are a generator error naming both
  source paths. The generator does not pick one.
- **FR-6** The rendered index carries `sourceDigest` in a comment line. A check (part of
  `npm run validate` in this repo) regenerates the digest and fails, naming the changed
  sources, when the committed index is stale. A stale index is a signpost that lies; it
  must fail visibly.

### B. The index skill

- **FR-7** One skill, `search-capabilities`, is written at
  `.claude/skills/search-capabilities/SKILL.md`. Its always-loaded `description` carries
  the standing instruction, in one sentence: *before concluding you lack a capability,
  check the capability index*. Its body tells the model where the index is and how to
  search it (FR-8). Its description is the only part that costs context every session.
- **FR-8** Searching is deterministic: a case-insensitive word match of the query against
  `name`, `summary` and `tags`, ranked by match count then name (`findCapabilities`). The
  model can use the same rule by grepping `index.md`; the skill body says so. No model call
  ranks results (constitution principle 8; OQ-3 records the rejected semantic option).
- **FR-9** The skill body contains the compliance sentence: *if a request has compliance,
  legal, PII or data-retention implications, search the index for `compliance`*. Rows
  tagged `compliance` are what that search returns.
- **FR-10** Loading stays the model's choice. The skill body names the route for each kind
  (`Skill`, `Task` with `subagent_type`, or the MCP tool name) and never loads one itself.
  For a row with `installed: false`, the body states the row cannot be invoked directly and
  what happens instead, per OQ-2's answer - never a route that would fail.

### C. Tools and MCP servers

- **FR-11** Where the harness supports deferred MCP tool loading, the project may enable it
  by config alone. Any such write goes to the **project's** `.claude/settings.json` through
  DR-073's additive, idempotent, never-clobbering merge - never to `~/.claude/**`
  (constitution invariant 3). Plan verifies the current setting name against Anthropic's
  docs before writing it; an unverified key is not written.

### D. The compliance nudge

- **FR-12** A `UserPromptSubmit` hook matches the prompt text against a fixed, committed
  list of explicit patterns (starting set: `PII`, `GDPR`, `HIPAA`, `PCI[- ]DSS`, `PCI`,
  `CCPA`, `data retention`, `personal data`), whole-word and case-insensitive so `pciutils`
  does not match. On a match it adds one line of context naming the matched term and
  telling the model to search the index for `compliance`. It never loads a skill, never
  blocks the prompt, and always exits 0.
- **FR-13** The nudge fires only when it can be true: if the index has no row tagged
  `compliance`, the hook says nothing, because pointing the model at an empty search is a
  wrong signpost. It runs only in a project with `.minspec/` at its root (DR-074). It is
  advisory by design - not a gate - so a hook failure is logged to stderr and the prompt
  proceeds; the spec states this so no reader mistakes it for a check (constitution
  invariant 2 governs gates; this is not one).

### E. Proving the benefit

- **FR-14** Before the index skill replaces anything, Plan records two measured numbers
  for this repo: the tokens the current always-loaded listing costs, and the tokens the
  index skill's description costs. The comparison goes in the spec's plan, with how it was
  measured (SCR#49's instrument if available). This spec claims "roster findable without
  loading it"; it does **not** claim a token saving until FR-14 measures one.

## Invariants (must not break)

- **INV-1 Defer, never strip.** No component this spec adds removes, hides, filters or
  rewrites a capability that the harness would otherwise show the model. The index is
  additive. Any later change that shrinks the always-loaded listing must keep a name stub
  for every capability visible to the model and is a separate spec.
- **INV-2 Nudge, never load.** The hook adds context only. It does not invoke the Skill or
  Task tool, write files, or change the prompt's text.
- **INV-3 Blast radius** (constitution invariant 3, DR-074). The index, the skill and the
  hook are written into the project only; nothing is written to `~/.claude/**` or any
  machine-wide file. The hook is inert outside a `.minspec/` project.
- **INV-4 Offline** (constitution invariant 1). Generator, search and hook make no network
  call.
- **INV-5 Never wrong.** The index never lists a capability that is not on disk, never
  shows a route that cannot work (FR-10), and fails visibly when stale (FR-6).

## Acceptance Criteria

- **AC-1** Generating twice from unchanged sources gives byte-identical `index.md` (FR-4).
- **AC-2** A fixture roster with a skill, a command, an agent and a vendored role produces
  four rows with the expected `kind`, `invoke` and `source` (FR-1, FR-2).
- **AC-3** A source with no name is reported by path and absent from the rows; a duplicate
  name fails the run naming both paths (FR-2, FR-5).
- **AC-4** Editing any source's description without regenerating makes the staleness check
  fail and name that source (FR-6). A mutation that removes the digest comparison makes
  AC-4's test fail (proving the test is not vacuous).
- **AC-5** `findCapabilities(index, 'compliance')` returns exactly the rows tagged or
  described with `compliance`; an unrelated query returns none (FR-8).
- **AC-6** The hook, given "store the customer's PII for 7 years", emits one nudge line and
  exits 0; given "install pciutils", emits nothing; given a matching prompt in a directory
  with no `.minspec/`, emits nothing; given a matching prompt and an index with no
  `compliance` row, emits nothing (FR-12, FR-13, INV-3).
- **AC-7** No file under `$HOME` changes when the generator and hook run (INV-3), checked
  with a temporary `HOME`.
- **AC-8** The always-loaded skill listing after the change contains every capability it
  contained before (INV-1): a test diffs the set of skill and agent names the harness would
  list, before and after.
- **AC-9** FR-14's two numbers are recorded in the plan with their method.

## Decisions needed (Clarify)

### OQ-1 - Where does this live?

- **A (rec) - this repo's harness first, generator in `@aiclarity/shared`.** The pure
  generator is reusable; the skill, index and hook are written into this repo (like
  `session-title`, DR-073). Ship to adopters later, only if FR-14 shows a benefit. *Cost:*
  adopters get nothing yet, and promotion to the shipped harness is a second change
  (template + scaffold) later.
- **B - shipped harness template from the start.** Scaffold writes the skill, index and
  hook into every MinSpec project. *Cost:* commits every adopter to an unmeasured feature;
  the hook becomes review machinery (`template-registry.ts`, human merge), and the roster
  default must suit projects we have not seen.
- **C - user-level `~/.claude`.** Rejected unless the founder overrides: constitution
  invariant 3 forbids a per-project write there, and a user-level index would need its own
  `.minspec/` scope gate in its text.

### OQ-2 - What does an `installed: false` row lead to?

- **A (rec) - read-as-instructions.** The row's route is "Read `<source>` and follow it as
  instructions for this task". Works today with no install. *Cost:* the vendored file runs
  as untrusted-ish prompt text inside the session; it is pinned and MIT-licensed, but a
  sync could change what it says.
- **B - confirm-install** (as `skillless` does). The model asks the human to install it as a
  skill. *Cost:* a human step per first use - the "human must remember" problem the issue
  set out to remove, moved one step later.
- **C - index installed capabilities only.** *Cost:* the vendored roster stays invisible,
  which is most of the issue's point.

### OQ-3 - How does the model match intent to a row?

- **A (rec) - deterministic word and tag match** (FR-8). Tier-0, testable, explainable.
  *Cost:* misses synonyms ("privacy" will not find a row tagged only `gdpr`) unless tags
  are written well.
- **B - the model reads the whole index and judges.** *Cost:* the index becomes context
  every time the skill is used, which grows with the roster and erodes the saving.
- **C - embedding search.** Rejected: needs a model or a network call for an offline,
  Tier-0 path.

### OQ-4 - Should "defer, never strip" become a constitution invariant?

The issue asks for it as a Tier-0 rule. This spec makes it INV-1 here. Raising it to
the constitution binds every future MinSpec feature (and the shelved Scrooge proxy idea in
SCR#50). **Rec: keep it a spec invariant now; propose a constitution amendment only when a
second spec needs it.** *Cost:* until then, a different feature could strip without
tripping any recorded rule.

### OQ-5 - How often may the nudge fire?

- **A (rec) - every matching prompt, one line.** Simple, stateless. *Cost:* in a long
  compliance-heavy session it repeats - principle 4 (avoid nagging).
- **B - once per session per term.** Needs session state in the hook. *Cost:* a second
  relevant prompt later in the session gets no reminder, and per-session state is a new
  surface to keep correct.

## Decision records

None minted. Under the recommended answers every choice here can be undone in under a
day (delete the skill, the index and one settings entry). OQ-1 B (shipping to adopters) or
OQ-4 (a constitution amendment) would each need a DR before Plan; the dedup check found no
existing DR on capability indexes, tool search, deferral or prompt nudges
(`docs/decisions/INDEX.md`, searched for skill, defer, strip, tool search, roster,
compliance, UserPromptSubmit).

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | The model ignores the standing instruction and never checks the index. | FR-14 and a manual trial in Plan: give five tasks a vendored role suits and count how often the index is consulted. If rare, the fix is the description wording, not a stronger hook (INV-2). |
| R2 | Tags are thin, so deterministic search misses. | Generator reports rows with no tags; the vendored sync can add tags. |
| R3 | Index goes stale after a vendor sync. | FR-6 check fails visibly in `npm run validate`. |
| R4 | The nudge's patterns over-match ordinary words. | Whole-word match; AC-6 includes a near-miss; the list is committed and reviewable. |
| R5 | A vendored role read as instructions (OQ-2 A) carries text that conflicts with this repo's rules. | Pinned by lock file; the skill body says repo instructions win on conflict. |

## Out of Scope

- Shrinking or rewriting the harness's own skill or agent listing (INV-1; a separate spec).
- Any proxy that edits what the model is sent (banned by INV-1, and the shelved Scrooge
  product, SCR#50).
- Auto-loading any skill from the hook (INV-2).
- Compliance content itself - this spec routes to compliance capabilities; it does not
  write them.
- The scroogellm context-bloat instrument (SCR#49) - used, not built, here.

## Alternatives considered and rejected

- **Strip the roster from context and let a router re-add it** - violates INV-1; the model
  can no longer see what it is choosing between.
- **A router skill that picks for the model** (the `superpowers` pattern, as the issue
  notes) - adopted only for its "always check first" instruction (FR-7), not as a router.
- **An MCP server exposing `search_capabilities(query)`** - a real tool call is tidier, but
  adds a process the harness must start in every session and a second install path; a
  file plus grep does the same offline with nothing running. Revisit if OQ-3 moves to B.
- **Hook that loads the compliance skill directly** - violates INV-2 and takes the choice
  from the model.

## Traceability

- Issue: #638. Cross-project: SCR#50 (narrowed router idea), SCR#49 (measurement).
- Reference designs named in the issue, not read for this spec: `0oooooooo0/skillless`,
  `lamb92009/claude-skill-loader`, `superpowers`. Plan reads them before choosing OQ-2.
