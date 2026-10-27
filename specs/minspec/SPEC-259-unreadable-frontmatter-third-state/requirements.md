---
id: SPEC-259
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a decision or epic whose frontmatter block cannot be parsed reads as `proposed`, so the signpost names an accepted decision as the next task
aspects: [frontmatter, unreadable-state, overloaded-null, adr, epic, artifact-graph, silent-gate, tier-0]
relates_to: [SPEC-095, DR-003, "#2468", "#2397", "#2404", "#968"]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-259: A frontmatter block that cannot be read is reported as unreadable, never as `proposed` (Requirements)

> **This is a SPECIFICATION ONLY.** No code or test is created by the dispatch that produced
> it. A human reads it, resolves **Decisions needed (Clarify)**, and approves it through the
> normal spec-approval gate before anything is built.

Materializes **[#2468](https://github.com/AIClarityAU/minspec/issues/2468)** - *"decision and
epic lists read a frontmatter block they cannot parse as no frontmatter, and report the
record as proposed."* Found while specifying SPEC-095 (CRLF text round-trip, for #2397), which
removes the two largest causes (CRLF, and with #2404 a leading byte order mark) but
deliberately leaves what the readers show for a block that is *still* unreadable, because that
needs a new visible state.

## One-Sentence Scope

`listAdrs` and `listEpics` distinguish "this file has no frontmatter" (a hand-written record
that predates MinSpec; keep today's filename-derived `proposed`) from "this file has a
frontmatter block I could not read" (a new `unreadable` state carrying a reason), and every
consumer treats the second as never-acceptable and never a next task.

## Context - the defect, measured

Issue-reported, Linux, `origin/main` `ff968418`, LF files, a record saying `status: accepted`,
`title: Real title`, `date: 2026-10-01`:

| Input | `listAdrs` reports |
|---|---|
| Well-formed | `accepted`, "Real title", the date |
| One blank line before the opening `---` | `proposed`, title from file name, no date |
| No closing `---` | `proposed`, title from file name, no date |

Mechanism (cited from the issue, to be re-verified in Plan):

- `packages/minspec/src/lib/adr-manager.ts:1424-1442` - `FRONTMATTER_RE` (`:65`,
  `/^---\n([\s\S]*?)\n---/`) not matching means "derive from file name, status `proposed`".
- `packages/minspec/src/lib/epic-manager.ts:118-140` - same shape for epics, order 999.
- Both feed `packages/minspec/src/lib/artifact-graph.ts:563-577` (`ADR_STATUS_MAP[a.status]`),
  so the false status reaches the signpost.

**Root cause (mechanism plus missing gate).** One value, "no frontmatter match", stands for two
different facts: a legitimate file with no block, and a file with a block the regex cannot
read. The first-line test that tells them apart (`---` as the first non-blank line) is never
made. This is the overloaded-null shape the status parity module was changed to avoid (#968).
Nothing rejects the second case, so the tree offers to accept an already-accepted decision.

## Functional Requirements

- **FR-1 Classify before defaulting.** Both readers decide, from the file text, among three
  outcomes: *well-formed* (block parsed), *no frontmatter* (no line of the file's first
  non-blank content is `---`), and *unreadable* (first non-blank line is `---` but the block
  does not parse: unterminated, or content before the opening fence that the parser refuses).
  One shared predicate serves both readers, so the two cannot drift.
- **FR-2 No-frontmatter unchanged.** Files in the *no frontmatter* class keep exactly today's
  output (filename-derived title, `proposed`, empty date; epics order 999).
- **FR-3 Unreadable state carries a reason.** An unreadable record is returned with a distinct
  status value and a short human-readable reason (for example "no closing `---`", "text before
  the opening `---`"). It keeps the id and filename-derived title so it stays findable.
- **FR-4 Never offered for acceptance.** No command or tree item offers Accept / Approve /
  status-change on an unreadable record; the action it does offer is to open the file.
- **FR-5 Never a next task.** The artifact graph maps an unreadable record to a state the
  signpost never selects as a proposed or next item, and surfaces the unreadable record
  visibly (it is not silently dropped). Fails closed and visibly (constitution invariant 2).
- **FR-6 Every consumer handled exhaustively.** Each consumer of the status type (ADR tree,
  epic grouping, picker commands, `approve-active`, backlog view, `artifact-graph`) handles
  the new value; the compiler enforces it (exhaustive switch / `Record` over the union), so a
  consumer cannot be forgotten.
- **FR-7 Offline.** No network call (invariant 1).

## Acceptance Criteria

- AC-1 The two measured inputs above (blank line before `---`; no closing `---`) yield
  *unreadable* with a reason, not `proposed`, for both decisions and epics.
- AC-2 A well-formed record and a file with no `---` at all yield the same output as before.
- AC-3 The ADR tree shows the unreadable record with the reason and no acceptance action.
- AC-4 The signpost never names an unreadable decision as the next task, and shows it as a
  problem.
- AC-5 A test per consumer fails if that consumer treats `unreadable` as `proposed`.
- AC-6 `npm test`, `npm run validate`, `npm run lint` pass.

## Invariants (must not break)

- INV-1 Invariant 2 (no silent gate): an unreadable block never degrades silently to a default.
- INV-2 Invariant 1: no network calls.
- INV-3 SPEC-095 behaviour (CRLF and byte order mark tolerance) is unchanged; this spec only
  changes what is shown for a block still unreadable after those fixes.
- INV-4 Existing persisted status values and `AdrStatus` strings written to files are
  unchanged; `unreadable` is a read-side state, never written to a record.

## Out of Scope

- Repairing damaged files (reporting only).
- Spec readers (`spec.ts`); a separate surface, track separately if wanted.
- The decision writer refusing a second block (done in SPEC-095).

## Decisions needed (Clarify)

### DQ-1 - How is the third state represented?

- **Option A - new status value `unreadable` on `AdrStatus` / epic status (rec).** One field,
  exhaustive checks find every consumer. *Cost:* widens a type that file-facing code also uses
  (INV-4 must be enforced so it is never written), and every consumer changes.
- **Option B - keep status, add `readError?: string` beside it.** Smaller diff. *Cost:* a
  consumer that ignores the new field still reads `proposed`, which is the very defect; the
  compiler does not force handling.

### DQ-2 - Tolerate leading blank lines as well?

- **Option A - no; a blank line before `---` is unreadable (rec).** Keeps "what parses" single
  and equal to every other consumer of the block (spec gate, validators). *Cost:* a harmless
  file stays flagged until fixed.
- **Option B - also accept leading blank lines in the readers.** *Cost:* fixes one input only
  and makes these readers disagree with the other parsers of the same block.

## Traceability

Issue #2468. Related: SPEC-095 (CRLF text round-trip), #2397, #2404, #968, DR-003 (RCDD).
No new DR: the choice is reversible in under a day (read-side status value).
