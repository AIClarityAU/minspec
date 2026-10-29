---
id: SPEC-059
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-059 is T3.)
# phases mirror requirements.md. This file has no approval record of its own, so its
# status is what deriveStatus computes for an unsigned file with these phases.
status: specifying
product: minspec
epic: EPIC-002  # Signpost Integrity
relates_to: [SPEC-022, SPEC-061, SPEC-014, SPEC-018, DR-108, "#1807", "#1513"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-059 - Tasks

The order below is the order of work. Each task is one pull request, ends with the full
`packages/minspec` suite green plus `npm run validate`, `npm run lint` and
`npm run typecheck`, and names the requirement IDs it satisfies, the files it touches and the
test that proves it. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md), which no task edits.

Every backticked path in this file is a file a task edits or creates. Files a task only reads
are named in prose. No task touches `.github/`, so none is review machinery.

Tasks 1, 2 and 3 must merge in that order: task 2 calls task 1's helper, and task 3's AC-3
evidence is task 2's rule running on the uncorrected corpus.

## 1 - One derive-inputs helper for the signpost and the gate (FR-2, INV-2, R4; AC-4 groundwork)

Tier T1. One concern, one source file, one test file.

- [ ] **1.1** `packages/minspec/src/lib/artifact-graph.ts` - export
  `specDeriveInputs(rootDir, specFilePath, literalStatus)` returning
  `{ approvalState: getApprovalStatus(rootDir, specFilePath), explicitTerminal:
  explicitTerminalOf(literalStatus) }`, with a doc comment naming SPEC-059 FR-2 and saying it
  is the one place a spec file becomes `deriveStatus` inputs. Replace the two inline calls in
  `buildArtifactGraph`'s spec loop with it. No other behaviour change.
- [ ] **1.2** `packages/minspec/tests/artifact-graph-derive-inputs.test.ts` (new) - fixture
  tree under `os.tmpdir()` with `.minspec/config.json`, five specs and their sidecars
  (approved, stale, unsigned, `status: archived`, `status: superseded`); assert
  `specDeriveInputs` returns the same pair as calling `getApprovalStatus` and
  `explicitTerminalOf` directly, and that `buildArtifactGraph` reports the same derived status
  for each spec as `deriveStatus` called by hand.
  *Done when:* the new test is green, the existing artifact-graph tests are green unchanged,
  and `npx tsc --noEmit -p packages/minspec` passes.

## 2 - The corpus status-mirror rule with its drift count (FR-2, FR-3, FR-4, FR-5, INV-3, INV-4, INV-5; AC-3, AC-4, AC-5, AC-6, AC-7)

Tier T2. One concern (the rule), one source file, one test file. Depends on task 1.

- [ ] **2.1** `scripts/validate-frontmatter.ts` - append the rule after the last existing rule
  block (rules there are not in numeric order), numbered with the next free rule number, as design.md *The corpus rule* specifies: every `.md` under the
  specs dir with a frontmatter `id`, `specDeriveInputs` then `validateSpec`, keep only
  `status.mirror-drift`, `warn()` each as `status-mirror <path>: <message>`, never `fail()`.
  Then the one `console.log` summary line, printed even at zero. Failure handling exactly as
  the design's *Failure is visible* list: an unreadable or unparseable file is a named
  `warn()` and counted unchecked; an exception around the rule and a run that checked 0 spec
  files each `warn()` "validated NOTHING". Header comment in the Rule 13/15 style, citing
  SPEC-059 and #1807. No `|| true`, no swallowed `catch`.
- [ ] **2.2** `packages/minspec/tests/validate-frontmatter-status-mirror.test.ts` (new) -
  `spawnSync` the script on fixture roots, reusing the harness shape of
  `validate-frontmatter-known-limit.test.ts` (local `node_modules/.bin/tsx`, never `npx`).
  Cases:
  - a signed `requirements.md` with `status: implementing` and no `phases:` key prints a
    `status-mirror` line naming it and deriving `new` (AC-6, FR-4; the SPEC-014 shape);
  - an agreeing spec prints no `status-mirror` line;
  - an unsigned `design.md` shard with `status: planning` and a non-pending `phases:` block
    is reported and counted as a shard;
  - with only drift present, exit status is 0 and stdout ends with
    "Frontmatter validation passed." (AC-5);
  - the summary line carries the exact D, S, H and N for the fixture, including a zero-drift
    fixture printing `0 file(s) across 0 spec(s)` (AC-7);
  - an empty specs dir prints the "validated NOTHING" warning; a spec file made unreadable
    (`chmod 000`, skipped when running as root) prints its named warning and is counted
    unchecked (INV-3);
  - AC-4: for every fixture file, the set of drift messages the script prints equals what
    `validateSpec(parseSpec(...), loadConfig(root), specDeriveInputs(...))` returns when
    called in-process, filtered to `status.mirror-drift`.
  Each fixture must be one the rule's absence would fail: run the new file once against
  `origin/main`'s script and record that the drift cases fail there.
- [ ] **2.3** Pull request body (AC-3): run `npm run validate` on the branch and quote the
  `status-mirror` lines for `specs/minspec/SPEC-014-review-webview/requirements.md` and the
  three SPEC-018 files, plus the summary line, and state the exit code. Reference #1807 with
  `Closes #1807` only if the summary line and both specs appear; otherwise `Refs`.
  *Done when:* 2.2 is green, the suite is green, `npm run validate` exits as it did on the
  base (the new rule adds warnings only), and the body carries the quoted output.

## 3 - Correct SPEC-014 and SPEC-018 through the lifecycle writers (FR-1, INV-1; AC-1, AC-2)

Tier T2. One concern (the two named instances), four spec files, one test file. Depends on
task 2 having merged. The commit is a `fix(#1807):` commit, so its body carries a
`Root cause:` line (the `.githooks/commit-msg` RCDD gate): the literal was hand-set by
`85d0173` on an "approved means implementing" model, and no commit/CI surface ran
`status.mirror-drift` to reject it.

- [ ] **3.1** `specs/minspec/SPEC-018-spec-custom-editor/requirements.md` - add
  `implements: none` and a one-paragraph `implements_reason:` after `relates_to:`, stating the
  facts re-verified at the time of writing (no `CustomTextEditorProvider` and no
  `customEditors` contribution under `packages/minspec`, 0 of 53 boxes checked in its
  `tasks.md`), in the shape SPEC-014's `implements_reason:` uses. Without it, `plan:
  in-progress` arms Rule 15, which is an error in this repo (design.md, *SPEC-018 also needs
  an ownership declaration*).
- [ ] **3.2** Run the writers once through `npx tsx -e` on
  `specs/minspec/SPEC-014-review-webview/requirements.md`,
  `specs/minspec/SPEC-018-spec-custom-editor/requirements.md`,
  `specs/minspec/SPEC-018-spec-custom-editor/design.md` and
  `specs/minspec/SPEC-018-spec-custom-editor/tasks.md`: `setSpecPhases(file, <the design's
  phases table row>, { createIfAbsent: true })`, then the settle loop from design.md
  (re-read, `deriveStatus` with `getApprovalStatus` and `explicitTerminalOf`,
  `setSpecStatus` to the derived value, at most three passes, throw if unsettled). Before
  writing, run `findOpenClarify` from `scripts/lib/clarify-open.ts` on each
  `requirements.md`; if it reports an open decision, write `clarify: in-progress` for that
  spec. Paste the exact snippet into the commit body (AC-2). Never type a `status:` value
  by hand.
- [ ] **3.3** Same four files - replace the body parenthetical "(SDD Implement phase)" after
  the `**Status:**` word with "(not built; corrected by SPEC-059)". Prose only; the status
  word itself stays as the writer left it.
- [ ] **3.4** `packages/minspec/tests/spec-059-status-corrections.test.ts` (new) - for each of
  the four files on the real corpus: a `phases:` block is present in the raw frontmatter, and
  the literal `status:` equals `deriveStatus(parsed phases, getApprovalStatus(repoRoot,
  file), explicitTerminalOf(literal))`. Computed live, never a hard-coded status word, so it
  stays green after the delegated re-approval rewrites the literal to `planning`.
  *Done when:* the test is red on task 2's merge commit and green on this branch;
  `npm run facts status SPEC-014` and `... SPEC-018` both print `verdict: MATCH`;
  `npm run validate` shows no `status-mirror` line for the four files and its summary count
  dropped by four from task 2's quoted figure (AC-1); Rule 11 and Rule 15 are clean for them.
- [ ] **3.5** Pull request body: the settle-loop snippet and its printed output, the
  before/after `facts status` lines, and one plain paragraph saying this voids the founder
  approvals of SPEC-014 and SPEC-018 `requirements.md` (the body status token is hashed), that
  both now read `stale` and derive `specifying` with matching literals, and that the
  post-merge delegated-approval lane (DLG-001, DR-108) is expected to re-record them as the
  bot, landing at `planning`. No step asks the founder.
  State also that this reverses `requirements.md` CQ-2's "the correction is free" claim
  (design.md, re-measurement point 4) and cite #3337, which tracks amending that locked text.
