---
id: SPEC-064
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-064 is T3.)
# status and phases here carry the current phase state. requirements.md stays frozen at its
# approved hash (approval sidecar under .minspec/approvals/), so its own phases lag until
# task 6. This file has no approval record of its own, so its status is what deriveStatus
# computes for an unsigned file with these phases.
status: specifying
product: minspec
epic: EPIC-002  # Signpost Integrity - an approved-but-unbuilt spec must not read 'implementing'
relates_to: [DR-069, DR-003, DR-012, DR-031, SPEC-022, SPEC-059, "#886", "#898", "#899", "#1513"]
implements: none
implements_reason: Task list for a back-fill spec. Its tasks pin behaviour that shipped under DR-069 and correct two status literals, so it declares no code ownership, as design.md D2 decides.
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: pending
---

# SPEC-064 - Tasks

The order below is the order of work. Each task is one agent run and one pull request: one
concern, a few files, its own test. Each names the requirement IDs it satisfies, the files it
touches, its test and its prerequisites by task number. The plan is [design.md](design.md);
the contract is [requirements.md](requirements.md).

No file path in this file is backticked. The spec gate reads a backticked path to an existing
file in tasks.md as owned code, and design.md D2 decided that this spec owns nothing. That
keeps `owned_file_set()` for SPEC-064 at 0.

Rules for every task:

- The behaviour already shipped, so a new test is green on arrival and that proves little.
  Prove each test can fail: apply the named mutation to the source in the working tree, quote
  the red in the pull request, and revert the mutation before committing. Commit no source
  change.
- Run `npx vitest run` (what CI runs), `npm run validate`, `npm run lint` and
  `npm run typecheck` before calling a task done.
- No task edits the body of requirements.md. Only task 6 edits its frontmatter, and only the
  `status` and `phases` keys, which canonicalization strips from the hash.

## What is already built

This audit was read from origin/main at efaaa006 on 2026-10-31. It is why the list is short:
only the rows marked "gap" produce a task.

| Requirement | State | Evidence |
|---|---|---|
| FR-1, FR-2, INV-1, INV-2, INV-4, INV-5 derivation | built | deriveStatus in packages/minspec/src/lib/lifecycle.ts:133 |
| AC-1, AC-2 truth table | gap: task 1 | packages/minspec/tests/lifecycle.test.ts:556 has point cases on one plan-in-progress shape, not the table over every phase position and verdict that AC-1 specifies |
| FR-3 mapping | built | SPEC_STATUS_MAP in packages/minspec/src/lib/artifact-graph.ts:66 |
| AC-3 next-task output is byte-identical | gap: task 2 | packages/minspec/tests/artifact-graph-fidelity.test.ts:245 pins the mapped status only and never compares resolver output |
| FR-4 approval writer | built | approve-phase-sync.test.ts stamps `planning` |
| AC-4 zero mirror-drift findings | gap: task 3 | no test runs status.mirror-drift over a spec the approval path wrote; spec-validator.test.ts:1141 covers a hand-built literal |
| INV-3, AC-5 freeze-gate twins | not this list: #899 | design.md D2 leaves the parity test standalone. No test names phaseIntentStatus or phase_intent_status today, so AC-5 stays unmet until #899 (open, parity test for the three twins) lands |
| FR-5, AC-6 rank and vocabulary | built | spec-validator.test.ts:1277 pins the rank through monotonicity; spec-tree-provider.test.ts:107 pins the Planning lane; spec-completion-view.test.ts:308 and packages/minspec/src/lib/status-parity.ts:56 carry the word; the `satisfies Record<SpecStatus, ...>` sites compile |
| FR-6 allow-set | built | SPEC_DONE_OK in packages/minspec/src/lib/spec-validator.ts:1692 |
| AC-7 claim against a `planning` spec | gap: task 4 | spec-validator.test.ts:1519 covers `specifying`, `implementing` and `done`, and has no `planning` case |
| FR-7, AC-8 corpus, specs with phases | gap: task 5 | `npm run facts status` reports DRIFT on SPEC-041 and SPEC-044: approved, literal `implementing`, implement pending |
| FR-7, AC-8 corpus, phaseless specs | not this list: #898, #1513 | see below |

### What this list does not discharge

- **Phaseless approved specs.** 23 approved requirements.md files carry literal `implementing`
  with no `phases:` block, and `facts status` reports DRIFT on the 22 numbered specs measured
  (20 under specs/minspec, SPEC-016 and SPEC-019 under specs/agent-execute). The 23rd is
  specs/minspec/requirements.md. Whether each is pre-implement cannot be read from a block it
  does not have, so AC-8 cannot be proved for them by a mechanical edit. SPEC-059 task 3
  corrects SPEC-014 and SPEC-018. The rest stay with #898 and #1513. AC-8 is met only when
  those land.
- **The D1 sequence in design.md.** The corpus check is SPEC-059 FR-2 (planned, unbuilt).
  design.md names #1807 for the promotion to gating, but #1807 closed on 2026-10-29 pointing
  at SPEC-059 FR-2, and SPEC-059 FR-3 ships WARN only. The promotion criterion is SPEC-022
  FR-5. No task here builds any of it.

## 1 - Truth table for deriveStatus (FR-1, FR-2, INV-1, INV-2, INV-4, INV-5; AC-1, AC-2)

- [ ] **1.1** packages/minspec/tests/lifecycle-planning-truth-table.test.ts (new) - one table
  over every phase position (each of specify, clarify, plan, tasks, implement as the current
  phase; implement `done` with an earlier phase incomplete; implement `skipped`; all done; all
  pending), crossed with the three verdicts `approved`, `stale`, `unapproved`, and with both
  explicit terminals.
  Expected values follow the FR-2 guard order. All-pending derives `new` under every verdict
  because that guard precedes INV-1, so AC-2's "every unapproved input" is asserted for every
  input with a started phase, and the all-pending row is asserted as `new` with a comment
  citing FR-2.
  *Done when:* the table passes, and two mutations each turn it red: returning `implementing`
  in place of `planning`, and moving the INV-1 guard below the `implementing` guard. Assert the
  row count against the product of the axes, so a dropped row fails.
  *Prerequisites:* none.

## 2 - Next-task output is byte-identical at `planning` (FR-3, INV-5; AC-3)

The obvious test is vacuous. buildArtifactGraph applies SPEC_STATUS_MAP before the resolver
runs, so a graph edited to say `implementing` is the graph it already had. The comparison has
to be forced at deriveStatus, upstream of the map.

- [ ] **2.1** packages/minspec/tests/next-task-planning-neutral.test.ts (new) - a temporary
  workspace with one approved spec at implement pending that has an open question, plus a
  sibling that produces a gate violation. Build the graph three times with `vi.mock` over
  deriveStatus in lifecycle: unchanged (returns `planning`), forced to `implementing`, and
  forced to `specifying` as the control. Compare `JSON.stringify(resolvePipeline(graph))`.
  Assert the first run's spec really derived `planning`.
  *Done when:* the first two outputs are byte-identical, the control differs from them (a
  control that matches means the fixture cannot see the status), and changing `planning:
  'implementing'` to `planning: 'specifying'` in SPEC_STATUS_MAP turns it red.
  *Prerequisites:* none.

## 3 - The approval path produces no mirror-drift finding (FR-4; AC-4)

- [ ] **3.1** packages/minspec/tests/approve-phase-sync.test.ts (extend) - approve a spec
  whose implement phase is pending through the real approval writer, read the written file
  back, and run validateSpec over those bytes with the approval state it now has. Assert the
  literal is `status: planning` and that zero findings have the rule `status.mirror-drift`.
  Also assert the rule is live on that input: the same bytes with the literal rewritten to
  `implementing` must produce exactly one such finding, so the zero is not vacuous.
  *Done when:* it passes, and making the writer stamp `getSpecStatus` in place of the
  approval-aware derivation turns it red.
  *Prerequisites:* none.

## 4 - A done claim against a `planning` spec warns (FR-6; AC-7)

- [ ] **4.1** packages/minspec/tests/spec-validator.test.ts (extend the status-claim block at
  line 1519) - `validateStatusClaims` on "SPEC-014 is implemented" with a status map of
  `planning` yields one `status-claim.contradicted` warning naming `planning`. Add a case that
  pins SPEC_DONE_OK's other two members still pass.
  *Done when:* it passes, and adding `planning` to SPEC_DONE_OK turns it red.
  *Prerequisites:* none.

## 5 - Correct SPEC-041 and SPEC-044 (FR-7, INV-5; AC-8 for specs with phases)

**Waits on #898.** That issue has the same migration parked under `hold:human`, pending #1106
(dispute a triage classification), and DR-072 section 3 says no approval lifts that hold. Its
last comment argues the verdict looks wrong, since #1047 and #1072 made this same edit as
ordinary commits. This plan does not decide that. The task's issue must cite #898 and state
the hold, and must not be reworded to pass triage. Tasks 1 to 4 do not depend on it.

- [ ] **5.1** The frontmatter `status:` line of
  specs/minspec/SPEC-041-cross-artifact-staleness/requirements.md and
  specs/minspec/SPEC-044-coordinated-self-completing-sessions/requirements.md changes from
  `implementing` to `planning`. Nothing else in either file changes. Neither carries a body
  status line, so the #898 concern about staling the hash does not arise for these two.
  Re-measure first: if either has since started its implement phase, or has gained a body
  status line, that spec is out and the task says so.
  *Done when:* `npm run facts -- hash SPEC-041` and the same for SPEC-044 report APPROVED with
  stored and computed hashes equal, before and after, and `npm run facts -- status` reports
  MATCH for both.
- [ ] **5.2** packages/minspec/tests/planning-corpus-literals.test.ts (new) - walk every
  tracked requirements.md, and fail naming the file if one has a `phases:` block, an approved
  verdict, a literal `implementing` and implement pending. Assert the walk visited more than
  100 files and more than 0 with a `phases:` block, so an empty walk cannot pass. Phaseless
  files are skipped, and the test comment cites #898 and #1513 for them.
  *Done when:* it fails on the tree before 5.1, naming exactly those two files, and passes
  after.
  *Prerequisites:* #898's hold resolved.

## 6 - Close the spec out (all FRs)

- [ ] **6.1** specs/minspec/SPEC-064-planning-lifecycle-status/requirements.md, design.md and
  this file - advance `status` and `phases` through the lifecycle writers, tick the tasks
  above, and record in this file's audit which rows moved. requirements.md stays `planning`
  until its implement phase starts; it reaches `done` only when #899 and the phaseless half of
  #898 have landed, since AC-5 and AC-8 depend on them. Until then the spec reads
  `implementing`, which is the honest state.
  *Done when:* `npm run facts -- hash SPEC-064` reports APPROVED with the hash unchanged,
  `npm run facts -- status SPEC-064` reports MATCH, and `npm run validate` reports no new
  finding for this spec.
  *Prerequisites:* 1, 2, 3, 4.
