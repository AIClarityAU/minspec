---
id: SPEC-215
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-215 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-002  # Signpost Integrity - a harness mirror must not present a pending proposal as a binding rule
relates_to: [SPEC-025, SPEC-043, SPEC-095, "#1937", "#705", "#706", "#1697", "#2520"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-215 - Design: constitution mirrors leave out DRAFT entries

Plan for [requirements.md](requirements.md). That file is approved and hash-locked; this plan
never edits it. Its four Clarify questions (DQ-1 to DQ-4) are already recorded there and are
not reopened. Citations of "today" are against `origin/main` `989fdc61`. New code is named by
symbol, because line numbers move.

"Measured" below means a prototype of this design, built in a scratch copy of
`packages/minspec` and run against the real templates, the real `refreshHarnessFiles` and the
existing test files. None of that code is in this pull request.

## Approach in one paragraph

`constitution.ts` gains the one DRAFT predicate and every check delegates to it. The three
mirror templates stay on the same `invariants` and `principles` arrays and filter at render
time through new Handlebars helpers, so `constitution.md` and everything else reading those
arrays is untouched. `@index` still counts every item, which gives FR-5's ordinals with no
extra data. One thing the spec did not foresee blocks the end of the build: when a section
goes from a list on disk to nothing but the count line, the #706 list guard in `mergeFile`
keeps the old list, so FR-4 and AC-7 hold in `renderTemplate` but not through a real Refresh.
That needs a founder answer ([Founder question](#founder-question)). Everything before it can
be built and is safe to ship.

## Founder question

**FQ-1 - The all-DRAFT line cannot reach disk through Refresh while the merge rules stay as
they are.**

`mergeFile` opens with `hasAuthoredListItems(existingBody) &&
!hasAuthoredListItems(genSection.body)`, the INV-2 guard from #706. It keeps the body on disk
whenever the file has list items and the template has none. An all-DRAFT section renders only
the FR-3 line, which is a blockquote, so the guard fires. Measured:

- A fresh project: Initialize renders `.cursorrules` `## Principles` before it seeds, so disk
  holds the three default bullets while the constitution holds a DRAFT principle. Refresh renders
  the count line, and the guard keeps the bullets on every later Refresh, with no notice when a
  baseline exists. AC-7's new assertion fails.
- Existing tests fail for the same reason: `merge-refresh.test.ts` AC-17, AC-38, AC-39 and
  AC-40, the last being a principle a human adds that then never reaches `.cursorrules` on a
  machine with no baseline.
- An upgraded adopter whose invariants are all DRAFT keeps its old `1. DRAFT: ...` list, the
  exact defect this spec fixes.

Requirements conflict here: AC-3 and AC-7 need the line to land, FR-3 says it sits outside
the list, and INV-4 says the section-merge rules that protect human edits stay as they are.

- **(a) (rec)** Add one narrow exemption to the guard: a generated body carrying the FR-3 line
  is not an unfilled scaffold, so the section falls through to the ordinary baseline logic.
  Measured: AC-7 as amended, AC-17, AC-38, AC-39 and AC-40 all pass (159 of 159 tests in the
  five merge and template files). A human edit is still kept with a baseline, and still kept
  and reported without one. Cost: it changes a merge path that INV-4 can be read as freezing,
  in `merge-refresh.ts`, a file outside the spec's `affects:` list.
- (b) Render the line as a list item (`- 2 proposed invariants ...`) only when the section is
  all DRAFT. No merge code changes. Cost: contradicts FR-3's "sits outside the list", and puts
  a bullet that is not a rule under "These rules must never be violated".
- (c) Accept the hold and leave all-DRAFT sections as they are on disk. Cost: seeded DRAFT
  principles stay invisible behind default bullets with no count line, which is the silent
  loss INV-1 forbids, and AC-7 stays false.

Task 5 and task 6 in [tasks.md](tasks.md) wait for this answer. Tasks 1 to 4 do not.

## Decisions

Each choice below was chosen by the planning agent on its recommendation; not a founder
decision. Each can be undone in under a day.

**D-1 - FR-6's form: Handlebars helpers, not new context fields.** FR-6 leaves this to the
Plan phase. Helpers `isDraft`, `anyBinding`, `anyDraft` and `omittedDrafts` read the arrays
already in the context. Measured: `{{incremented @index}}` inside `{{#unless (isDraft this)}}`
keeps the constitution's ordinals, and the output for a DRAFT-free constitution is
byte-identical. *Rejected:* `bindingInvariants` plus `draftInvariantCount` on
`TemplateContext`. Tests build that context by hand in six places, and `tests/` is outside
every tsconfig include (requirements.md, Test plan), so a new field would go missing with no
type error and render as an empty list.

**D-2 - The predicate's shape.** `isDraftItem` matches
`/^\s*(?:\*\*DRAFT\??:\*\*|DRAFT\??:)/`, the four DQ-2 forms and no others. A sibling
`stripDraftPrefix(text)` removes the marker, in a loop, so `DRAFT: DRAFT: x` cannot survive
compaction and fail AC-6. Both live in `constitution.ts`, which imports only `text-io`, so the
callers gain no import cycle. `**DRAFT: Title.** rest` is not a DQ-2 form, stays listed, and
is the safe side of the error. Measured on the current memory-fabric constitution: 26
invariants with 17 recognised, and no item carrying `DRAFT` in a form the predicate misses.
*Rejected:* a new `constitution-draft.ts` module, because FR-1 names `constitution.ts`.

**D-3 - The wording of the FR-3 line.** It names its section and agrees in number:
`> 1 proposed invariant in .minspec/constitution.md is marked DRAFT and not listed here; it is
not binding until accepted.`, and `> N proposed invariants ... are marked ... they are not
binding ...`, with `principle` in the Principles list. The path is in backticks, as in the
surrounding template text. *Rejected:* FR-3's example word "entries" in every list. It is
marked as an example, and on the memory-fabric file above "17 proposed entries in
.minspec/constitution.md" would be false: that file holds 47 DRAFT entries.

**D-4 - One line per list.** `.cursorrules` renders up to two lines, one under each heading,
because FR-3 counts per list and AC-1 places the line after its list. *Rejected:* one combined
line at the end of the file, which would sit under an unrelated heading.

**D-5 - An all-DRAFT section drops its `> Summarized from` line.** It would introduce a list
that is not there. The section renders the FR-3 line alone. *Rejected:* keeping it, which
leaves a summary of nothing and a double blank line.

**D-6 - Principles' "same placeholder rule" (DQ-3).** Zero principles still renders the three
default bullets, which are that section's placeholder today. All-DRAFT principles render the
FR-3 line in their place. *Rejected:* defaults plus the line, which presents defaults as
adopted while the project's real proposals wait, and which DQ-3 and AC-7 do not describe.

**D-7 - FR-7 covers five sites, not the three it names.** `scanForHumanListItem` in
`constitution-nudge.ts` and `draftKey` in `constitution-proposer.ts` are further hand-written
copies on the same paths as `isAllTemplate` and `isDraftLine`. Leaving them defeats FR-7:
`draftKey` must strip the same markers, or a section holding `**DRAFT:** x` is no longer read
as human content and then gains a second copy of `x`. `DRAFT_MARKER` stays for the writer,
because `renderCandidate` emits `DRAFT:` and nothing else. *Rejected:* changing only the three
named functions. A consequence to note: a section holding only `DRAFT?:` or bold-marked items
no longer gates the seed, which may now append to it. That is additive, so SPEC-025 INV-2 holds.

**D-8 - AC-2's golden compares the sections, plus one full-file check at build time.** AC-2
says byte-identical to the output at `23a58c2f`. Measured: AGENTS.md and `.cursorrules` are
still identical to that commit in full, but CLAUDE.md differs on two lines, both `(#2684)`
suffixes merged since. So no test can hold that sentence literally for CLAUDE.md. The test pins
the sections this spec changes (CLAUDE.md `## Invariants`, AGENTS.md `## Constitution`,
`.cursorrules` `## Invariants` and `## Principles`), whose bytes have not moved since
`23a58c2f`. The build pull request also records a full-file before and after for all three.
*Rejected:* a whole-file golden, which every later template change would break for a reason
unrelated to this spec.

**D-9 - Build order puts the machinery file late and alone.** `template-registry.ts` is review
machinery and its pull requests never auto-merge. Tasks 1 to 3 touch only ordinary files, so
they land without waiting on it. *Rejected:* one pull request for the whole spec, which would
hold the predicate and compaction behind the machinery gate and FQ-1.

## Template shape

The CLAUDE.md block is below. AGENTS.md and `.cursorrules` differ only in their item line and
summary text, and AGENTS.md keeps its outer `{{#if invariants}}` with no placeholder branch.
Measured: Handlebars strips these standalone lines, so a DRAFT-free render is byte-identical.

```handlebars
{{#if invariants}}
{{#if (anyBinding invariants)}}
> Summarized from ...

{{#each invariants}}
{{#unless (isDraft this)}}
{{incremented @index}}. {{firstSentence this}}
{{/unless}}
{{/each}}
{{#if (anyDraft invariants)}}

{{/if}}
{{/if}}
{{#if (anyDraft invariants)}}
{{omittedDrafts invariants "invariant"}}
{{/if}}
{{else}}
<!-- Add project invariants here -->
{{/if}}
```

## Invariants, and where each is held

- **INV-1 (no silent promotion or loss).** AC-1 and AC-3 tests. AC-8's mutation run keeps them
  from passing vacuously. The all-DRAFT path through Refresh depends on FQ-1.
- **INV-2 (`constitution.md` never rewritten).** No change to `parseConstitution`, `buildContext`
  or the constitution template. AC-5 test. Measured byte-identical with DRAFT items present.
- **INV-3 (Tier-0).** Pure string logic in `constitution.ts` and template helpers.
- **INV-4 (blast radius).** Only MinSpec-managed mirror sections change. FQ-1 is the one open
  point against its second sentence.
- **INV-5 (Refresh fixed point).** AC-7 in task 6, and a repeat Refresh on the mixed case in
  task 4. Measured stable on the mixed case.

## Known limits

- **A reorder that keeps the same items does not renumber.** `contentItems` strips list
  numbers, so the re-render branch in `mergeFile` keeps the bytes on disk. Measured: moving a
  DRAFT entry from second to first leaves `1. A` on disk where the constitution now says A is
  second, so FR-5 lags until the next real content change. `merge-refresh.test.ts` AC-38 accepts
  this today as cosmetic, and FR-5 raises its cost a little. No change here, because INV-4 keeps
  that rule. Tracked by task 4's line in `docs/backlog.md`.
- **A machine with no baseline holds the mirror and says so.** `.minspec/generated-hashes.json`
  is machine-local. Measured: on such a machine the upgrade leaves the DRAFT lines in place and
  the Refresh notice names the files, so "the next Refresh applies the fix" (Out of Scope) holds
  only where a baseline exists. This is the #1697 fail-closed rule working, and it is not silent.
- **Gaps show only in raw text.** A markdown viewer renumbers `1.` then `3.` as 1 and 2. Agents
  read the raw file, and FR-5 is written for them.
- **Between task 4 and task 5**, a mixed list whose last binding item is deleted becomes
  all-DRAFT, and the guard keeps the deleted rule on disk. Today that case lands. Task 5 closes
  it, which is why it follows task 4 closely once FQ-1 is answered.

## Testing

Placement of requirements.md's test plan:

| Acceptance | Test | Task |
|---|---|---|
| AC-4 | `tests/constitution-draft-predicate.test.ts` | 1 |
| AC-6, AC-9 compaction half | `tests/constitution-compaction.test.ts` | 2 |
| FR-7 nudge and proposer | `tests/constitution-nudge.test.ts`, `tests/constitution-proposer.test.ts` | 3 |
| AC-1, AC-2, AC-3 render, AC-5, AC-8, AC-9 mirror half | `tests/constitution-mirrors-draft.test.ts` | 4 |
| AC-3 through Refresh | `tests/merge-refresh.test.ts` | 5 |
| AC-7, DQ-3 | `tests/refresh-constitution-draft-fixed-point.test.ts` | 6 |

AC-5's fixture is written inline with the #1937 counts (13 `DRAFT:`, 2 `DRAFT?:`, 10 plain). It
does not read another repository, and that file has moved on since #1937 was measured.

## Alternatives considered and rejected

The spec-level ones are in requirements.md. Each plan-level one sits with its decision above.
