---
id: SPEC-134
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-134 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - when a spec may be written, what its frontmatter must state, and the gates that check both
relates_to: [SPEC-012, SPEC-038, SPEC-076, SPEC-085, DR-019, DR-066, DR-069, "#2584", "#3252"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-134 - Tasks

The order below is the order of work. Each task is one agent run: one concern, a few files,
its own test, and green on landing, so no task leaves a red required check on `main`. The
plan is [design.md](design.md); the contract is [requirements.md](requirements.md) and the
data shapes in the design's "Data shapes" section.

Every backticked path in this file is a file this change edits or creates. Files it only
reads (lifecycle, approval, canonical, the existing next-task headless script) are named in
prose, so the spec gate's ownership signal stays as narrow as the change.

Common to every task: tests run through `npx vitest run`, as CI runs them; each T0 suite is
shown red on the tree before its implementation and the output is quoted in the pull request
body; no task contacts the network or adds work at activation (INV-1, INV-8). Tasks marked
"Machinery path" (4.2, 8.4 and group 9) edit review or dispatch machinery under `scripts/` or
`.github/`, so their pull requests take the machinery merge path; any task that edits a
shipped source re-runs `node scripts/gen-ci-templates.mjs` in the same commit.

## 1 - T0 and T1: the pure modules (no caller yet)

- [ ] **1.1** `packages/shared/src/specify-ready.ts` (new, owned) - the `DependencyStatement`
  and `BackfillEntry` types, `readSpecStatement(fmBlock)` and `readBackfillList(json)` per the
  design's "Dependency statements" section; export from `packages/shared/src/index.ts`. No
  `fs`, `vscode`, `child_process` or network import. Satisfies FR-1, FR-5 (the reading), FR-6
  (the list's shape), INV-9.
  Test: `packages/shared/tests/specify-ready.test.ts` (new, owned) - `[]` is `none`; an inline
  list with a trailing comment is `targets`; no key is `not-stated`; a block-form list, a bare
  word and an unclosed bracket are each `unreadable` with the raw value; a malformed backfill
  JSON, a non-array and an entry missing a field are each rejected by name.
  *Done when:* those cases pass and an import-boundary case asserts the module's imports.
- [ ] **1.2** `packages/shared/src/specify-ready.ts`, `scripts/lib/issue-rank.ts` - move
  `parseDeclaredBlockers`, `explicitLinks` and their private helpers into the shared module
  byte for byte; `issue-rank.ts` re-exports them. Add `readIssueStatement(body,
  nativeBlockedBy)` with the `Depends on: none` / `Blocked by: none` line form. Satisfies FR-7
  (the grammar), INV-4.
  Test: the existing `packages/minspec/tests/issue-rank.test.ts` and
  `packages/minspec/tests/drain-issue-rank.test.ts` pass unchanged; new cases in
  `packages/shared/tests/specify-ready.test.ts`: none line, none inside a fence (not-stated),
  blockers plus none (targets), native relation only (targets), empty body (not-stated).
  *Done when:* both existing suites pass with no edit to them and the new cases pass.
- [ ] **1.3** `packages/shared/src/specify-ready.ts` - `computeSpecifyReady` with the closed
  reason and note lists, the four conditions, the pin, FR-10's satisfaction table, the three
  counts with their population, and `currentEpic` including the exhausted case. Satisfies
  FR-8, FR-9, FR-10, FR-11.
  Test: `packages/shared/tests/specify-ready.test.ts` - one case per acceptance criterion
  that names FR-7 to FR-11 in requirements.md (second-lowest epic, pinned, `planning` versus
  `implementing` versus phaseless dependency, queue at five pinned and unpinned, counts never
  summed), every reason returned together when several apply, an unknown target is never
  satisfied, a non-whole limit reads as 0, and an exhausted epic names the act and does not
  advance.
  *Done when:* those cases pass; deleting each condition in turn in a scratch copy turns at
  least one case red, beside a clean control, and the results are in the pull request body.
- [ ] **1.4** `packages/shared/src/spec-freshness.ts` (new, owned) - `assessFreshness` per the
  design's data shape; export from `packages/shared/src/index.ts`. Satisfies FR-16, INV-2.
  Test: `packages/shared/tests/spec-freshness.test.ts` (new, owned) - an owned file changed is
  stale and listed; a target hash changed is stale and listed; a target new since baseline is
  stale; nothing changed is fresh; each null input and each `unknownWhy` is unknown with the
  reason; a derived baseline is reported as derived; no input combination with a null yields
  `fresh` (an exhaustive loop over the null positions).
  *Done when:* those cases pass and the import-boundary case from 1.1 covers this module.

## 2 - The settings and the adapter

- [ ] **2.1** `packages/minspec/src/lib/config.ts` - `dependencyStatement` (default `warn`)
  and `specifyReady` (`pinLabel` `specify-now`, `approvalQueueLimit` 5, `unbuiltPileLimit` 5),
  with a non-whole limit normalised to 0. Satisfies FR-3 (the setting), FR-9 (the pin label
  from config), FR-11 (the limits).
  Test: `packages/minspec/tests/config.test.ts` - defaults with the keys absent, an override
  of each, and `"5x"`, `-1` and `2.5` each read as 0.
  *Done when:* those cases pass and `.minspec/config.json` is not edited (the flip is 6.3).
- [ ] **2.2** `packages/minspec/src/lib/artifact-graph.ts` - expose each spec's
  `DependencyStatement` (frontmatter merged with the backfill list) and a `readinessInputs(
  rootDir)` function that builds `ReadyInput.specs`, `.epics` and `.adrs` with the derived
  status read before `SPEC_STATUS_MAP`. `parseEdgeArray` and the resolver input are unchanged.
  Satisfies FR-5, FR-10 (reading the derived status), INV-6.
  Test: `packages/minspec/tests/artifact-graph-fidelity.test.ts` - a fixture with one spec in
  each of the four statement states; a `planning` spec is `planning` in `readinessInputs` and
  `implementing` in the resolver graph; and `packages/minspec/tests/artifact-graph-realdata.test.ts`
  - the edge list for the live corpus equals the list `parseEdgeArray` produced before the
  change (snapshot taken in the same commit).
  *Done when:* both suites pass and `resolveNextTask` on the live corpus is unchanged.

## 3 - The gates, at `warn`

- [ ] **3.1** `packages/minspec/src/lib/spec-validator.ts` - `checkDependencyStatement` with
  the six rule ids in the design's table and the `backfill-unreadable` case, called from
  `validateSpec`; `packages/minspec/src/commands/approve.ts` and
  `packages/minspec/src/commands/validate.ts` pass the known refs, backfill entry and the two
  hashes. Replace the "depends_on ... not validated here" comment. Satisfies FR-1, FR-2, FR-3
  (severity mapping), FR-6 (the three list checks).
  Test: `packages/minspec/tests/dependency-statement-gate.test.ts` (new, owned) - each rule id
  fires on its fixture and nothing fires on `depends_on: []`; severity is warning with the
  setting absent and error with it set; a backfill entry whose hash matches the spec and its
  sidecar satisfies the gate, and one whose hash differs from either is `backfill-unapproved`;
  run once against today's corpus, it reports `dependency.missing` (the red-before).
  *Done when:* those cases pass.
- [ ] **3.2** `scripts/validate-frontmatter.ts` - one rule calling `checkDependencyStatement`
  for every primary spec, never for sibling `design.md`/`tasks.md`, with the "validated
  nothing" message on an exception. Satisfies FR-2 (second surface, no silent gate), INV-2.
  Test: `packages/minspec/tests/dependency-statement-gate.test.ts` - through the run-tsx-cli
  helper the acceptance-criteria validator test uses: the same fixture gives the same rule id
  and words from the script as from `validateSpec`; a sibling `design.md` with no statement is
  not reported; a thrown reader prints "validated nothing".
  *Done when:* those cases pass and `npm run validate` on `main` is still exit 0 (warnings
  only).
- [ ] **3.3** `packages/minspec/src/lib/spec-validator.ts`, `scripts/validate-frontmatter.ts`
  - `checkSpecOpening` with the four `opening.*` findings, called from both places at
  `dependencyStatement` severity, skipped for a spec with a current approval. Satisfies FR-20.
  Test: `packages/minspec/tests/spec-opening-rule.test.ts` (new, owned) - an unapproved T4
  spec with no opening, with the opening second, with 121 words, and with `Cost:` empty each
  get the matching finding; 120 words with links counted by their text passes;
  requirements.md of SPEC-134 itself passes; the same spec approved is not reported; a T2 spec
  is not reported.
  *Done when:* those cases pass and `npm run validate` on `main` is exit 0.

## 4 - The producers

- [ ] **4.1** `packages/minspec/src/lib/slash-commands.ts`, `packages/minspec/src/lib/spec-manager.ts`,
  `packages/minspec/src/commands/example.ts` - `FRONTMATTER_GUIDANCE` instructs the
  dependency statement with `[]` for "nothing", the "In plain terms" opening with its three
  labels, and the `.minspec/freshness/<id>.json` record; `createSpec` writes `depends_on: []`
  with a replace-me comment and an opening stub with empty labels; the example spec carries
  both. Satisfies FR-4, FR-15 (instructing the record), FR-21.
  Test: `packages/minspec/tests/spec-producer-inventory.test.ts` (new, owned) - holds the
  producer list as data (these three now; 4.2 adds the fourth), reads each one's text, and
  fails when any instruction is missing or the list resolves to no producer; plus
  `packages/minspec/tests/spec-manager.test.ts` - a created spec has the key and the stub, and
  `checkSpecOpening` reports the stub's empty labels.
  *Done when:* those suites pass; removing one instruction from one producer in a scratch
  copy turns the inventory test red.
- [ ] **4.2** `scripts/dispatch-issue.sh` - the spec-writing prompt's frontmatter list adds
  `depends_on:` (with `[]` named), the opening section, and the freshness record written
  against `origin/main`'s sha. Satisfies FR-4, FR-15, FR-21 (the drain's producer).
  Test: `packages/minspec/tests/spec-producer-inventory.test.ts` - the dispatch prompt joins
  the producer list; `packages/minspec/tests/dispatch-specify-only.test.ts` still passes.
  *Done when:* both pass. Machinery path.

## 5 - The openings, still at `warn`

- [ ] **5.1** The first half by id of the unapproved T3/T4 specs whose first section is not
  "In plain terms" (17 at c2f53d74, listed in the design's re-measurement) - write each
  one's opening from its own body: what changes for the reader, `Cost:`, `Left out:`,
  `Riskiest assumption:`, at most 120 words. Confirm each is unapproved before editing.
  Satisfies FR-20 (corpus). Lands before the flip in 6.3, which makes the opening rule an error here.
  Test: `packages/minspec/tests/spec-opening-rule.test.ts` gains a live-corpus case listing
  the specs done so far, none reported.
  *Done when:* that passes; each opening's claims are each traceable to a sentence of its
  body, quoted in the pull request body.
- [ ] **5.2** The second half, same procedure. Satisfies FR-20.
  Test: the live-corpus case covers every unapproved T3/T4 spec: no `opening.*` finding.
  *Done when:* that passes.

## 6 - The backfill, and the flip with its last batch

Each batch re-measures first: the spec list moves as specs merge, so the batch boundary is by
id range, not by a list frozen here. Each statement carries its evidence line (design,
"The backfill list"). Each batch's pull request body carries the `specHash` comparison of
every approved spec before and after, compared whole (INV-5).

- [ ] **6.1** The unapproved specs on `main` with no `depends_on:` (16 at c2f53d74, listed in
  the design's re-measurement) - add the key to each spec's own frontmatter. Their
  `requirements.md` files are unapproved, so nothing is voided; confirm each with
  `npm run facts -- status <id>` before editing. Satisfies FR-6 (frontmatter half).
  Test: `npm run validate` reports no `dependency.missing` for any unapproved spec, and
  `packages/minspec/tests/dependency-statement-gate.test.ts` gains a live-corpus case asserting
  that.
  *Done when:* both hold and no approved spec's file is in the diff.
- [ ] **6.2** `.minspec/dependency-backfill.json` (new) - entries for the approved specs with
  no `depends_on:` from SPEC-001 to SPEC-079 and the core spec. Satisfies FR-6 (list half),
  INV-5.
  Test: the live-corpus case from 6.1 extended: no `dependency.missing` and no
  `dependency.backfill-*` finding for any spec in this range.
  *Done when:* that passes, and the before/after `specHash` comparison shows no change.
- [ ] **6.3** `.minspec/dependency-backfill.json`, `.minspec/config.json` - the approved
  specs with no `depends_on:` from SPEC-080 upward, and in the same commit set
  `dependencyStatement` to `error`, as FR-3 requires (the flip lands with the backfill).
  Satisfies FR-3 (this repository at `error`), FR-6, INV-5.
  Test: the live-corpus case covers every spec: no `dependency.missing` anywhere;
  `packages/minspec/tests/dependency-statement-gate.test.ts` gains a case asserting this
  repository's setting is `error` and the live corpus has no dependency or opening finding;
  `npm run validate` is exit 0 on the parent commit and on this commit, both outputs quoted.
  *Done when:* those hold and the `specHash` comparison shows no change. If a spec without a
  statement or opening merged since 6.2 or 5.2, fix it in this same change.

## 7 - Editor surfaces and the headless script

- [ ] **7.1** `scripts/specify-ready.ts` (new, owned) - the headless entry point per the
  design: `--root`, `--issues`, `--open-pr-drafts`, `--freshness`, `--issue-statement`; refuses
  a root with no `.minspec/` by name; stable key order; no network. Satisfies FR-13.
  Test: `packages/minspec/tests/headless-signpost.test.ts` style, in a new describe of
  `packages/minspec/tests/dependency-statement-gate.test.ts`: refusal by name, byte-identical
  output for the same inputs twice, the agreement fixture's answer equals
  `computeSpecifyReady` over `readinessInputs`.
  *Done when:* those pass.
- [ ] **7.2** `packages/minspec/src/views/spec-tree-provider.ts`,
  `packages/minspec/src/commands/validate.ts`, `packages/minspec/src/commands/approve.ts`,
  `scripts/validate-frontmatter.ts` - "written early" on unapproved specs for the four early
  reasons only, as a description and tooltip, a `specify.written-early` warning from Check
  Spec Completeness and the corpus validator, and a non-modal note in the approve flow.
  Satisfies FR-12 (Specs pane, validators, approve), INV-7.
  Test: `packages/minspec/tests/spec-tree-provider.test.ts` - an early spec shows the marker
  and reasons, an approved one and a queue-full-only one do not; the validator emits a
  warning at `error` setting, never an error; the approve test asserts the call is not modal
  and the approval proceeds.
  *Done when:* those pass.
- [ ] **7.3** `packages/minspec/src/commands/status.ts` - the "Spec piles" section with the
  three counts, limits and population on separate lines. Satisfies FR-11 (shown), FR-12.
  Test: `packages/minspec/tests/commands.test.ts` - the status output has three separate
  count lines and no line containing their sum.
  *Done when:* that passes.
- [ ] **7.4** `packages/minspec/src/lib/backlog.ts`, `packages/minspec/src/views/backlog-view.ts`
  - fetch `body`, read the pin's applier for pinned issues within the consented load, mark
  each issue `ready` or its reasons; nothing about readiness before the load. Satisfies FR-9
  (naming the pin), FR-12 (Backlog).
  Test: `packages/minspec/tests/backlog-view.test.ts` and
  `packages/minspec/tests/backlog-consent.test.ts` - before load no readiness text; after load
  with a stubbed fetch, one ready and one `no-dependency-statement` issue; a pinned issue whose
  applier read fails shows "pin ignored" and is not ready on the pin.
  *Done when:* those pass and the consent suite's no-fetch-before-consent cases still pass.

## 8 - Freshness

- [ ] **8.1** `packages/shared/src/next-task.ts` - `SpecNode.freshness`; in the implement-hole
  loop, a `stale` spec emits the refresh imperative with rule `pending.freshness-stale` in
  place of the implement imperative, an `unknown` one the check imperative with rule
  `pending.freshness-unknown`, and a `planning` spec with no hole emits either when present.
  Ranking unchanged. Satisfies FR-17 (resolver half), INV-6.
  Test: `packages/shared/tests/next-task.test.ts` - stale replaces, never adds beside; unknown
  says why; absent freshness gives today's output exactly; the node kind is `phase-action`.
  *Done when:* those pass.
- [ ] **8.2** `packages/minspec/src/lib/artifact-graph.ts`, `packages/minspec/src/commands/next-task.ts`,
  `packages/minspec/src/extension.ts` - the git freshness reader (record in
  `.minspec/freshness/<id>.json`, the derived-baseline walk, the diff, target hashes, the
  shallow and missing-commit cases, the per-HEAD cache) behind an optional reader argument;
  the activation call passes none and gets "not checked yet"; the command and the debounced
  recompute pass it. Satisfies FR-15 (derived baseline), FR-16 (inputs), FR-17 (adapter half,
  no git at activation).
  Test: `packages/minspec/tests/artifact-graph-fidelity.test.ts` - in a temp git repo, an
  `affects:` file change makes the spec read stale naming the file; a lifecycle-only commit
  does not move the derived baseline; a shallow clone reads unknown; and
  `packages/minspec/tests/next-task-command.test.ts` - the activation path spawns no process
  (spy on `child_process`).
  *Done when:* those pass.
- [ ] **8.3** `scripts/validate-frontmatter.ts` - rule `freshness.record` checking each
  `.minspec/freshness/*.json` file's shape and that its `reasons` cover exactly the changed
  items between `from` and `to`. Satisfies FR-19.
  Test: `packages/minspec/tests/dependency-statement-gate.test.ts`, a freshness describe: a
  valid no-change refresh passes and leaves the approval record byte-identical; a missing
  reason, an extra reason and an unknown `to` commit each fail by name; a shallow clone is a
  named warning.
  *Done when:* those pass.
- [ ] **8.4** `scripts/validate-frontmatter.ts`, `.github/workflows/ci.yml` - rule
  `freshness.build-started-stale` comparing to `MINSPEC_VALIDATE_PARENT` (default `HEAD`), and
  the validate job's `fetch-depth: 2` plus `MINSPEC_VALIDATE_PARENT: HEAD^1`; with `CI` set and
  the variable absent, or the parent missing, it says the check did not run. Satisfies FR-18
  (validators).
  Test: `packages/minspec/tests/dependency-statement-gate.test.ts` - in a temp repo, moving a
  stale spec's `phases.implement` to `in-progress` is reported with the spec id and file;
  after a recorded refresh it is not; a spec already started at the parent is not examined;
  `CI=1` without the variable prints "did not run".
  *Done when:* those pass. Machinery path.

## 9 - Machinery: triage, drain, panel

- [ ] **9.1** `scripts/triage-decide.sh`, `scripts/triage-inbox.sh`, `scripts/roles/triage.md`
  - the `--dependency-statement` argument, rule 3's precondition, fail-closed on absent or
  garbled, and the prompt line asking for `Depends on: none`. Satisfies FR-7 (gate).
  Test: `packages/minspec/tests/triage-decide.test.ts` - T3 agent-ready with `targets` and
  with `none` gives `agent-ready-specify`; with `not-stated`, absent and garbled gives
  `needs-info`; every other rule's existing case unchanged.
  *Done when:* those pass. Machinery path.
- [ ] **9.2** `scripts/drain-inbox.sh` - spec writing only for issues `scripts/specify-ready.ts`
  calls ready, counting open pull requests that add a primary spec file, asking again after
  each dispatch, a per-reason held count each cycle, "waiting by design" wording, no spec
  written on a failed or incomplete answer, and reopening a parked draft instead of claiming
  a second id. Runs after the existing `MINSPEC_DRAIN_SPECIFY_MAX_HELD` brake. Satisfies
  FR-14, INV-7.
  Test: a new describe in `packages/minspec/tests/drain-specify-backpressure.test.ts` with `gh`
  and the script stubbed: a full queue writes nothing and prints waiting by design with
  counts; a failed call writes nothing and says so; two ready issues with a limit of one
  dispatch one; a parked draft is reopened; and the agreement fixture's drain decision equals
  7.1's output.
  *Done when:* those pass and `packages/minspec/tests/drain-specify-switch.test.ts` still
  passes. Machinery path.
- [ ] **9.3** `scripts/drain-inbox.sh` - the build hold: an `agent-ready` issue whose linked
  spec derives `planning` and reads `stale` or `unknown`, or whose check fails, is not
  dispatched, with the reason printed. Satisfies FR-18 (drain).
  Test: same suite - stale held, unknown held, failed check held, fresh dispatched, an
  implementing spec's issue not examined.
  *Done when:* those pass. Lands after 8.3, so every held spec has a recorded way to clear.
  Machinery path.
- [ ] **9.4** `scripts/roles/approvable-reviewer.md`, then regenerate
  `packages/minspec/src/lib/ci-review-templates.ts` - the reviewer returns a blocking finding
  when a spec's opening omits something its body requires of the reader, or contradicts the
  body. Satisfies FR-22.
  Test: `node scripts/gen-ci-templates.mjs --check` and `npm run validate` exit 0; a case in
  `packages/minspec/tests/spec-producer-inventory.test.ts` asserts the role prompt and its
  generated copy both carry the duty.
  *Done when:* those pass. Machinery path.

## 10 - Closing

- [ ] **10.1** The agreement test: one describe in
  `packages/minspec/tests/dependency-statement-gate.test.ts` that runs one fixture through the
  editor path, `scripts/specify-ready.ts` and the drain helper and asserts one answer, plus
  the source scan for reason ids outside message tables in the five consumer files named in
  the design. Then walk every acceptance criterion in requirements.md and quote the evidence
  for each in the pull request body. Satisfies INV-4 and the acceptance criteria.
  *Done when:* the test passes and every criterion has quoted evidence. Set
  `phases.implement` to `done` only after that pull request's checks are green.
