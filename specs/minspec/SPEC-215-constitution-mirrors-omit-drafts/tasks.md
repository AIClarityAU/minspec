---
id: SPEC-215
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-215 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-002  # Signpost Integrity - a harness mirror must not present a pending proposal as a binding rule
relates_to: [SPEC-025, "#1937", "#706", "#2520"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-215 - Tasks

The order below is the order of work. Each task is one pull request and names the requirement
IDs it satisfies, the files it touches, the test that proves it and the tasks it needs first.
The plan is [design.md](design.md) (decisions D-1 to D-9 and founder question FQ-1 are cited by
id); the contract is [requirements.md](requirements.md), which no task edits.

Every backticked path in a task's checklist is a file that task edits or creates. Paths are
relative to `packages/minspec` unless they start at the repo root.

Rules for every task:

- Write the task's test first, run it against the unchanged code, and paste the red output into
  the pull request body. Then make it green.
- End with the full `packages/minspec` suite green, plus `npm run validate`, `npm run lint` and
  `npm run typecheck`. Run `tsc` on any new test file, because `tests/` sits outside every
  tsconfig include.
- `constitution.md`'s data path does not change (FR-6, INV-2): no edit to `parseConstitution`, to
  `buildContext` or to the constitution template.

Tasks 1 to 4 can start now. **Tasks 5 and 6 do not start until FQ-1 is answered** (design.md,
*Founder question*). Tasks 2, 3 and 4 need task 1 and do not need each other.

## 1 - One DRAFT predicate (FR-1; AC-4)

Tier T1. One source file, one test file. Prerequisites: none.

- [ ] **1.1** `src/lib/constitution.ts` - export `isDraftItem(text)` and `stripDraftPrefix(text)`
  as D-2 specifies, with a doc comment naming SPEC-215 FR-1 and SPEC-025 as the owner of the
  convention.
- [ ] **1.2** `tests/constitution-draft-predicate.test.ts` (new) - AC-4's table. True for `DRAFT: x`,
  `  DRAFT: x`, `DRAFT?: x`, `**DRAFT:** x` and `**DRAFT?:** x`. False for `x DRAFT: y`,
  `Draft: x`, `DRAFTING the API`, `DRAFTS: x` and the empty string. `stripDraftPrefix` on every
  true case, and on `DRAFT: DRAFT: x`, returns text for which `isDraftItem` is false.
  *Done when:* the new test is green. Nothing calls the predicate yet.

## 2 - Compaction strips every marker the mirrors hide (FR-7 compaction part, FR-8; AC-6, AC-9 compaction half)

Tier T1. One source file, one test file. Prerequisites: task 1.

- [ ] **2.1** `src/lib/constitution-compaction.ts` - `stripDraftMarker` keeps its own line framing
  (indent plus bullet or number) and delegates the marker test and removal to `isDraftItem` and
  `stripDraftPrefix`. `strippedDraftMarkers` counts one per line. The human confirmation in the
  Compact Constitution command does not change (SPEC-025 FR-8).
- [ ] **2.2** `tests/constitution-compaction.test.ts` - add a constitution holding all four forms,
  plus `- DRAFT: DRAFT: x` and `* x DRAFT: y`. After compaction `parseConstitution` returns no item
  for which `isDraftItem` is true, `x DRAFT: y` is untouched, and CRLF input behaves the same and
  keeps its line endings (AC-9). A DRAFT-free input still reports `unchanged: true`.
  *Done when:* the new cases are green and every existing case is green unchanged.

## 3 - The nudge and the proposer use the one predicate (FR-7; D-7)

Tier T1. Two source files, two test files, one concern. Prerequisites: task 1.

- [ ] **3.1** `src/lib/constitution-nudge.ts` - `isAllTemplate` and `scanForHumanListItem` call
  `isDraftItem`.
- [ ] **3.2** `src/lib/constitution-proposer.ts` - `isDraftLine` keeps its list-line framing and
  calls `isDraftItem`. `draftKey` uses `stripDraftPrefix`. `DRAFT_MARKER` stays for
  `renderCandidate`, the writer.
- [ ] **3.3** `tests/constitution-nudge.test.ts` - a constitution of only `DRAFT?:` and bold-marked
  items reads as all-template.
- [ ] **3.4** `tests/constitution-proposer.test.ts` - `sectionHasHumanContent` is false for a section
  holding only `**DRAFT:** x`, and `integrateProposal` given a candidate with text `x` leaves one
  copy of `x` in that section, with a second run changing nothing (D-7's duplicate case).
  *Done when:* the new cases are green and every existing case is green unchanged.

## 4 - The invariants lists leave out DRAFT entries, in all three mirrors (FR-2 invariants part, FR-3, FR-4 render, FR-5, FR-6; AC-1, AC-2, AC-3 render, AC-5, AC-8, AC-9 mirror half)

Tier T2. Machinery: this pull request touches `template-registry.ts`, so it never auto-merges.
Prerequisites: task 1. Not blocked by FQ-1, and it stays additive to what task 5 needs.

- [ ] **4.1** `src/lib/constitution.ts` - export `omittedDraftsLine(items, noun)`, returning the D-3
  text.
- [ ] **4.2** `src/lib/template-engine.ts` - register the D-1 helpers `isDraft`, `anyBinding`,
  `anyDraft` and `omittedDrafts`.
- [ ] **4.3** `src/lib/template-registry.ts` - the CLAUDE.md, AGENTS.md and `.cursorrules` invariants
  blocks take design.md's *Template shape*, with D-3, D-4 and D-5. The `.cursorrules` Principles
  block does not change here (task 6).
- [ ] **4.4** `tests/constitution-mirrors-draft.test.ts` (new), through `renderTemplate`:
  - AC-1: `[A, DRAFT: B, C]` gives CLAUDE.md `1. A` and `3. C` then one line with count 1, and
    AGENTS.md and `.cursorrules` list `A` and `C` then one line with count 1.
  - AC-2 per D-8: golden strings for the sections D-8 names, taken from rendering the `23a58c2f`
    template with DRAFT-free contexts, including zero invariants.
  - AC-3 render: all-DRAFT gives the line and no placeholder, and no `> Summarized from` (D-5).
    Zero invariants still gives the placeholder.
  - AC-5: the #1937-shaped fixture (design.md, *Testing*) parses to 25 items with markers kept,
    and the `constitution.md` template renders them unchanged.
  - AC-9: CRLF constitution text through `parseConstitution` gives AC-1's output.
  - Repeat Refresh on a real scaffold with a mixed list leaves every mirror byte-identical (INV-5).
- [ ] **4.5** `docs/backlog.md` (repo root) - one dated line for the first known limit in design.md
  (a same-items reorder does not renumber).
- [ ] **4.6** Record in the pull request body: AC-8's mutation run, where `isDraftItem` always false
  fails AC-1 and always true fails AC-2, and the full-file before and after for all three mirrors
  on a DRAFT-free constitution (D-8). Rebuild the .vsix.
  *Done when:* the new test is green, all existing tests are green unchanged, and
  `refresh-constitution-draft-fixed-point.test.ts` still passes as written, because Principles
  have not changed yet.

## 5 - The all-DRAFT line reaches disk through Refresh (FR-4, INV-1; AC-3 through Refresh)

Tier T2. Prerequisites: task 4, and **BLOCKED by FQ-1**. As written for FQ-1 option (a), the
recommendation. Under option (b) this task instead changes the line's rendering in
`template-registry.ts` and is machinery. Under option (c) it is dropped and task 6 changes shape.

- [ ] **5.1** `src/lib/constitution.ts` - export a test for "this body carries the FR-3 line", next
  to `omittedDraftsLine`, so the wording has one owner.
- [ ] **5.2** `src/lib/merge-refresh.ts` - the #706 guard in `mergeFile` does not fire when the
  generated body carries that line. No other branch changes. This file is outside the spec's
  `affects:` list, which FQ-1 option (a) accepts.
- [ ] **5.3** `tests/merge-refresh.test.ts` - with a baseline, a list on disk and an all-DRAFT
  template land the line. A human edit is kept with a baseline, and kept and reported without one.
  A scaffold with no FR-3 line still holds a populated list (the #706 case). A mixed list whose
  last binding item is deleted drops that item.
  *Done when:* the new cases and the existing AC-17, AC-38, AC-39 and AC-40 are green.

## 6 - `.cursorrules` Principles follow the same rule (DQ-3, FR-2 Principles part, FR-3, FR-4; AC-7, INV-5)

Tier T2. Machinery: touches `template-registry.ts`, so it never auto-merges. Prerequisites: task 4
and task 5, and through task 5 **BLOCKED by FQ-1**. Without task 5, this change fails AC-7 and the
existing `merge-refresh.test.ts` AC-17, AC-38, AC-39 and AC-40 (measured).

- [ ] **6.1** `src/lib/template-registry.ts` - the `.cursorrules` Principles block filters through the
  same helpers with noun `principle`, and renders the D-6 placeholder rule.
- [ ] **6.2** `tests/constitution-mirrors-draft.test.ts` - mixed principles give the kept items then
  one line. All-DRAFT principles give the line and no default bullets. Zero principles give the
  default bullets. With `[A, DRAFT: B]` invariants as well, `.cursorrules` holds one line per list
  (D-4).
- [ ] **6.3** `tests/refresh-constitution-draft-fixed-point.test.ts` - AC-7: after Refresh 1 the seeded
  principle's text is absent from `.cursorrules` and the FR-3 line with its count is present.
  Refresh 2 stays byte-identical.
  *Done when:* the updated test and the full suite are green. Rebuild the .vsix.
