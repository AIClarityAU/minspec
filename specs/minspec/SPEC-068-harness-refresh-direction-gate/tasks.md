---
id: SPEC-068
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-068 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - "marker-bounded updates that never surprise-write"
relates_to: [DR-092, DR-089, DR-066, SPEC-043, SPEC-063, "#1095", "#3269"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-068 - Tasks

The order below is the order of work. Each task is one pull request, ends with the full
suite green, and names the requirement IDs it satisfies, the files it touches and the test
that proves it. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md), which no task edits.

Every backticked path in this file is a file a task edits or creates. Files a task only
reads are named in prose. Paths not in requirements.md's `implements:`/`affects:` are
listed with their reason in design.md, *Files*.

Shared rules for every task:

- Write the test first and see it red against the code before the task's change (T0 before
  implementation). Quote the red output in the pull request body.
- Every new check has a negative control in the same test that shows it can go red.
- No rule is restated. A second call site calls the function named in design.md; it never
  copies its body.
- Run the task's test file, then `npx vitest run`, `npm run lint`, `npm run typecheck` and
  `npm run validate` before calling a task done. CI runs `npx vitest`, never `npm test`, so
  nothing may rely on a `pretest` hook.
- A task that touches `.github/` is review machinery: its pull request needs a human or
  DR-112 bot merge, not auto-merge.

## 1 - The constants and the corpus digest (FR-1, FR-9)

- [ ] **1.1** `packages/minspec/src/lib/harness-provenance.ts` - `TEMPLATE_EPOCH = 1`,
  `TEMPLATE_EPOCH_DIGEST`, `TemplateCorpus`, `liveTemplateCorpus()`,
  `templateCorpusDigest()` and `checkTemplateEpoch()` exactly as design.md, *The constants
  and the digest*. The digest value is computed by running the function, never typed.
- [ ] **1.2** `packages/minspec/tests/harness-provenance.test.ts` - the live corpus passes;
  a corpus with one Markdown section hash changed fails with a message naming both digests
  and `TEMPLATE_EPOCH + 1`; the same for one managed-region entry and for the AGENTS slash
  section; reordering object keys does not change the digest; the layout case (each
  constant alone on one line in `export const NAME = value;` form, adjacent) reads the
  module's source text.
  *Done when:* every case is green, and each failing-corpus case is red when its mutation is
  removed from the fixture (proving the fixture, not the default, drives it).

## 2 - The validate gate (FR-2, INV-4)

- [ ] **2.1** `scripts/validate-frontmatter.ts` - Rule 25: call `checkTemplateEpoch()` and
  `fail()` with its message when `!ok`. A thrown error is reported as a failure naming the
  rule, never caught silently (the Rule 12 shape).
  *Done when:* `npm run validate` passes on the branch; in a scratch copy of the worktree,
  editing one line of `CLAUDE_MD_TEMPLATE` in `template-registry.ts` makes `npm run
  validate` exit non-zero with the Rule 25 message, and the pull request quotes that output.
  The vitest case from 1.2 is the second required-check witness (CI `test` job); `lint`
  runs this rule.

## 3 - The record and the verdict (FR-3, FR-4, INV-2, INV-6)

- [ ] **3.1** `packages/minspec/src/lib/harness-provenance.ts` - `HarnessProvenance`,
  `ProvenanceRead`, `readHarnessProvenance`, `writeHarnessProvenance`, `DirectionVerdict`,
  `decideDirection`, `holdsWrites`, per design.md, *The record* and *The verdict*.
- [ ] **3.2** `packages/minspec/tests/harness-provenance.test.ts` - the verdict table
  (ahead, level, behind; unknown for absent, invalid JSON, a JSON array, `templateEpoch`
  as a string, `0`, `-1`, `1.5`, `2**53`); a record lacking `writtenBy` is still `present`;
  `writeHarnessProvenance` round-trips through `readHarnessProvenance`; it throws
  `NotOptedInError` and writes nothing in a folder with no `.minspec/`; and
  `.minspec/harness-provenance.json` is in neither `MINSPEC_GITIGNORE_ENTRIES` nor the set
  `untrackDeclaredMachineLocalPaths` removes.
  *Done when:* all green.

## 4 - The merge hold (FR-4, FR-8, INV-1, INV-3)

- [ ] **4.1** `packages/minspec/src/lib/merge-refresh.ts` - `mergeFile` gains
  `options?: { holdReplacements?: boolean }`, default `false`. With it set, the
  "Section proven unmodified" branch keeps the existing body when the template body
  differs and adds the heading to a new `MergeResult.directionHeld: readonly string[]`
  (empty when not held). No other branch changes.
- [ ] **4.2** `packages/minspec/tests/harness-refresh-direction.test.ts` - with the option
  set, a proven-unmodified section whose template differs is kept and reported; a heading
  absent from disk is still appended (FR-8); a property case over the `merge-refresh.test.ts`
  fixtures: the held output differs from `existing` only by appended headings. With the
  option unset, every fixture's output is byte-identical to today's.
  *Done when:* all green, and `merge-refresh.test.ts`, `merge-refresh-706.test.ts` and
  `merge-refresh-890.test.ts` pass unchanged.

## 5 - The hold in refresh, managed regions first (FR-4, FR-5, INV-1, INV-3)

- [ ] **5.1** `packages/minspec/tests/harness-refresh-direction.test.ts` - the sealbox
  regression first: a temp project, scaffolded, then a managed region on disk given an extra
  block the running template lacks and a record at `TEMPLATE_EPOCH + 1`; after
  `refreshHarnessFiles`, every managed file is byte-identical. Run it against unchanged code
  and quote the red.
- [ ] **5.2** `packages/minspec/src/lib/scaffold.ts` - `RefreshOptions`; compute the verdict
  once after `assertOptedIn`; pass `holdReplacements` into `mergeFile`; skip the
  managed-region splice write under hold; collect hold targets; return the one
  `direction-held` notice first, with the message text in design.md, *The notice*. Add the
  `'direction-held'` kind and optional `direction` field to `ManagedRegionWarning`.
- [ ] **5.3** Same test file - behind and unknown each hold, with the notice naming every
  held target, both epochs (or the unknown reason), and the action; a run with zero held
  targets returns no `direction-held` notice; ahead and level refresh produce the same files
  as today on the DR-089 preservation fixtures (INV-3); a missing managed file and a missing
  Markdown file are still created under hold (FR-8); the marker auto-heal still runs under
  hold.
  *Done when:* 5.1 is green and all of 5.3 is green.

## 6 - The AGENTS slash section and the re-scaffold action (FR-4, INV-1)

- [ ] **6.1** `packages/minspec/src/lib/scaffold.ts` - under hold, when AGENTS.md exists and
  `injectAgentsSlashSection(existing) !== existing`, call `generateSlashCommandShims` with
  `agents: false` and add the target `AGENTS.md#minspec:agents-slash-section`;
  `rescaffoldManagedRegionFile` returns `false` under hold.
- [ ] **6.2** `packages/minspec/src/commands/init.ts` - when `rescaffoldManagedRegionFile`
  refuses, show the hold message rather than the success toast.
- [ ] **6.3** `packages/minspec/tests/harness-refresh-direction.test.ts` - AGENTS.md with a
  changed slash section is untouched under hold and rewritten under ahead; a missing
  AGENTS.md is still created under hold; re-scaffold refuses under behind and unknown and
  writes under ahead.
  *Done when:* all green.

## 7 - The record after a refresh and at Initialize (FR-3, FR-8, DQ-2)

- [ ] **7.1** `packages/minspec/src/lib/scaffold.ts` - write the record last per the table
  in design.md, *The record write after a refresh*; `generateHarnessFiles` writes it only
  when no record exists and every target was created by this run.
- [ ] **7.2** `packages/minspec/tests/harness-refresh-direction.test.ts` - first adoption
  (empty folder, Initialize) writes every harness file with no hold and a record at
  `TEMPLATE_EPOCH`; Initialize over existing harness files writes no record; ahead stamps the
  bundle epoch; level, behind and held unknown leave the record byte-identical; a throw
  injected before the record write leaves the old record.
  *Done when:* all green.

## 8 - The hold stays visible (FR-7)

- [ ] **8.1** `packages/minspec/src/lib/scaffold.ts` - overlay `HELD_BASELINE_SENTINEL` for
  each held target onto `computeTemplateBaseline()` before `saveTemplateBaseline`. Export the
  sentinel from `harness-provenance.ts`.
- [ ] **8.2** `packages/minspec/src/lib/auto-bootstrap.ts` - `baselineHasHeldEntry`;
  `hasHarnessDrift` returns true when it does; `harnessDriftSignature` adds one line for the
  held target set.
- [ ] **8.3** `packages/minspec/tests/harness-refresh-direction.test.ts` - after a held
  refresh, `hasHarnessDrift` is true for a held Markdown heading, a held managed file and
  the held AGENTS section, each alone; after an ahead refresh it is false; the signature is
  stable across two identical held runs and changes when the held set changes. Control: with
  the overlay removed, the first case reads false.
  *Done when:* all green, and `auto-bootstrap.test.ts` passes unchanged.

## 9 - The override, interactive only (FR-6, DQ-2, INV-2)

- [ ] **9.1** `packages/minspec/src/lib/scaffold.ts` - the `dryRun` pass and the
  `overrideUnknown` acceptance rule (verdict still unknown and the dry target set equals
  `confirmedTargets`); a mismatch holds with the "list changed" message.
- [ ] **9.2** `packages/minspec/src/commands/init.ts` - `refreshSummaryMessage` branch for a
  `direction-held` notice; the output-channel list and non-modal warning with `Review and
  write` / `Keep files`, per design.md, *The override*; pass `writtenByVersion` from the
  extension's `packageJSON.version`; add `origin?: 'auto-bootstrap'` to `deps`.
- [ ] **9.3** `packages/minspec/tests/harness-refresh-direction.test.ts` - with the
  `vscode` mock `init-command.test.ts` uses: unknown, `Review and write` writes the listed
  files and the record, and a second refresh is quiet; `Keep files` writes nothing; behind
  never shows `Review and write`; a target set that changed between list and confirm holds.
  *Done when:* all green, and `init-command.test.ts` and `commands.test.ts` pass unchanged.

## 10 - Auto-bootstrap cannot override (FR-6)

- [ ] **10.1** `packages/minspec/src/lib/auto-bootstrap.ts` - the refresh step gains
  `commandArg: { origin: 'auto-bootstrap' }`.
- [ ] **10.2** `packages/minspec/tests/harness-refresh-direction.test.ts` - the bootstrap
  refresh path on an unknown project shows the hold notice, offers no `Review and write`,
  and writes nothing; a direct check that `BOOTSTRAP_STEPS`' refresh step carries the
  origin.
  *Done when:* all green, and `auto-bootstrap.test.ts` passes unchanged.

## 11 - Tier 0 on the whole path (FR-9, INV-5)

- [ ] **11.1** `packages/minspec/tests/harness-provenance.test.ts` - mock `child_process`,
  `http`, `https`, `net` and `dns` so every export throws; run `checkTemplateEpoch`,
  `readHarnessProvenance` plus `decideDirection`, and a held `refreshHarnessFiles` in a temp
  folder with no `.git`, with `ensureHooksPath`, `recordExecutableBitInIndex` and the
  untrack step stubbed to throw. Verdict and hold are unchanged.
  Control: a deliberate `execFileSync` call added in a scratch copy makes the test red.
  *Done when:* green, and the control result is quoted in the pull request.

## 12 - The package gate (DQ-1)

- [ ] **12.1** `scripts/check-template-epoch.ts` - default mode calls `checkTemplateEpoch()`,
  prints its message and exits 1 when `!ok`, 0 otherwise.
- [ ] **12.2** `packages/minspec/package.json` - `prepackage` runs
  `npm run supply-chain:check && npx tsx ../../scripts/check-template-epoch.ts`.
  *Done when:* the script exits 0 on the branch; in a scratch copy with one template line
  edited it exits 1 with the remedy text, quoted in the pull request.

## 13 - The merge-order check (Risks row 2, DR-092 section 2)

- [ ] **13.1** `scripts/check-template-epoch.ts` - `--base <ref>` mode per design.md, *The
  epoch gate on every surface*; exits 0 when the base file and head file carry the same
  constants.
- [ ] **13.2** `.github/workflows/template-epoch-order.yml` - on `pull_request` to `main`,
  no `paths:` filter, fetch the base ref, run the script in `--base` mode. Header states it
  is advisory until added to the `main` ruleset, as `dr-id-collision.yml` does.
- [ ] **13.3** `packages/minspec/tests/harness-provenance.test.ts` - the base comparison as
  a pure function over two source texts: same digest passes; new digest with epoch + 1
  passes; new digest with the same epoch fails; new digest with epoch + 2 fails; epoch
  lowered fails.
  *Done when:* all green, and `actionlint` passes on the workflow.

## 14 - Close

- [ ] **14.1** Run every acceptance criterion in requirements.md against `main` after the
  last task merges and quote each result in the closing pull request. Set
  `phases.implement` to `done` in all three files of this spec only after that pull
  request's checks are green.
