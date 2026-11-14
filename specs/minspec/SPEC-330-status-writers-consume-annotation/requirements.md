---
id: SPEC-330
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a status writer that leaves a comment describing the old value is a false signpost
aspects: [writer, frontmatter, status-annotation, signpost-integrity]
depends_on: []
relates_to: ["#1912", "#1879", "#1833", "#1900", "#1955", "#2149", "#152", "SPEC-240", "SPEC-038", "DR-003"]
implements: none
implements_reason: >-
  Specify phase only. Expected surface: `setSpecStatus` (`packages/minspec/src/lib/spec.ts`), `setEpicStatus`
  (`epic-manager.ts`), `setAdrStatus` (`adr-manager.ts`), one shared helper, tests, and three corpus edits.
  None of it is claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-330: The three status writers consume the status annotation they would otherwise orphan

> **This is a SPECIFICATION ONLY.** Written for issue #1912. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

Issue: #1912. Related: #1879 (closed; corpus half done), #1833 (inversion guard, DR writer only), #1900 (the convention), #1955 (validator half), SPEC-240 (validator reads the run above `status:`), DR-003 (RCDD).

## Problem

Convention (#1900): the `status:` line carries a value and nothing else. Two halves enforce it.

- **Validator half: shipped.** `validateStatusAnnotation` (`packages/minspec/src/lib/spec-validator.ts:~913`) emits `status.inline-comment` and `status.orphan-comment` at `warn` (`config.statusLineAnnotation`, default `warn`, `config.ts:176`) — read from the raw frontmatter. This spec does NOT re-specify it.
- **Writer half: not shipped.** All three writers still replace only the matched line with `/^status[ \t]*:[ \t]*.*$/m` (`spec.ts:606`, `epic-manager.ts:318`, `adr-manager.ts:841`; line numbers at base `81c97e9f`, re-measured, they moved from the issue's). `.*` never crosses a newline, so:
  - **A1** an inline `#` comment on the status line is silently destroyed on every write;
  - **A2** indented/adjacent `#` lines after it survive and describe a value that no longer holds (SPEC-062, #1879).
- **Latent sibling:** `setSpecStatus` interpolates `status` into the `String.replace` replacement unescaped (`spec.ts:608`), while `setEpicStatus` and `setAdrStatus` call `escapeReplacement` (#152). Unreachable today (status comes from a closed enum); same edit.
- The #1833 inversion guard (`statusProseWouldInvert`) runs on the DR writer only; not in scope here (see Decision D3).

Root cause (mechanism): the writers rebuild one line and have no notion that the run of comment lines directly beneath it belongs to that line, and no gate stops a writer leaving an adjacent comment. The validator now makes the bad state visible beforehand; the writers still create it. A corpus edit alone would leave the writer defect live (DR-003 asymmetry check).

## Corpus exposure (re-measured at base `81c97e9f`)

Scanned frontmatter of every `.md` under `specs/`, `docs/decisions/`, `docs/epics/` for a `status:` line with an inline ` #`:

- **A1: 3 files** — SPEC-004, SPEC-011, SPEC-015 `requirements.md`. (The issue counted nine; the three `design.md`/`tasks.md` files are not matched by this scan at this base. Plan must re-measure with the shipped predicate, not this awk.)
- **A2: not re-measured by me**; the issue reports 0 after #1895 and #1900. Unverified here.

## Functional requirements

- **FR-1 One shared helper.** A single function locates the top-level `status:` line in a raw frontmatter block and the run of comment lines directly beneath it (same adjacency rule as `validateStatusAnnotation`: contiguous `^[ \t]*#` lines, a blank or non-comment line ends the run), and returns the rewritten block. All three writers call it; no writer keeps its own copy of the regex.
- **FR-2 A2 consumed.** When rewriting the status line, the directly-following run is removed if it qualifies under the validator's own predicate (any indented `#` line in the run, or text matching `/status/i`). A free-standing column-0 run that does not name the status is left in place (it annotates the following key; see the validator docblock). The writer and validator MUST share that predicate (one definition, imported), so they cannot drift.
- **FR-3 A1 consumed.** The inline comment on the status line is dropped, as today. Rewritten line is `status: <value>` only.
- **FR-4 Removal is not silent.** When FR-2 or FR-3 removes text, the writer returns/reports it (the removed text and count) so the caller's command surfaces "removed N annotation line(s)". Exact surface per Decision D1.
- **FR-5 `$`-safety.** `setSpecStatus` escapes the value like the other two (or the helper uses a replacer function), so a literal `$` in a value is never read as a replacement pattern (#152).
- **FR-6 Same line as the validator.** The helper targets the column-0 `status:` only (#2149), identical to the validator, including a status line absent from the block (appended, as today).
- **FR-7 Corpus.** The A1 comments on the files the Plan re-measures are moved into body prose where they carry rationale, otherwise deleted. Verified claim to re-check at Plan: canonicalization strips the whole `status:` line, so approvals do not stale (issue verified on SPEC-004; mine unverified). Edits to approved specs go through the normal approve path, not here (this dispatch may not edit them).
- **FR-8 Validator severity unchanged.** No change to `statusLineAnnotation` default or to the rules; flipping to `error` is a separate decision after the corpus is clean (SPEC-038 FR-7), see D2.
- **FR-9 Line endings and body unaffected.** CRLF restoration, `FRONTMATTER_RE` handling, and `setBodyStatusToken` behaviour are unchanged.

## Acceptance criteria

- **AC-1** Given a spec whose frontmatter is `status: specifying  # waiting on approval`, when `setSpecStatus(…, 'approved')` runs, then the block contains `status: approved` and no `#` text on that line. Same for epic and ADR writers.
- **AC-2** Given `status: specifying` followed by `  # wrapped explanation` lines, after a write none of those lines remain, and the next key is untouched.
- **AC-3** Given a column-0 `# note about tier` run after `status:` that does not name status, after a write it is still present.
- **AC-4** Given an adjacent run that names status at column 0, it is removed (matches the validator).
- **AC-5** Given a value containing `$&`, `setSpecStatus` writes it literally.
- **AC-6** For every fixture above, `validateStatusAnnotation` on the writer's output returns no `status.*` finding (writer output always satisfies the validator).
- **AC-7** A writer call that removes text reports it (FR-4); one that removes nothing reports nothing.
- **AC-8** A parameterized test runs the same fixtures through all three writers, so a fourth copy of the regex fails a test (the "dup predicate drifts" class).
- **AC-9** `npm test`, `npm run validate`, `npm run lint` pass; `status.*` warning count on the corpus is not higher than before.

## Invariants this must not break

- Offline, no network (constitution invariant 1).
- No silent gate (invariant 2): the removal in FR-2/FR-3 must be visible (FR-4), not best-effort; this is why "writer only, quietly" is rejected.
- Blast radius (invariant 3): writers act only on files in an opted-in project (`.minspec/`); nothing outside frontmatter is touched.
- Approval hash: writers change only the `status:` line and its annotation run; canonicalization behaviour is not modified.

## Decisions needed (Clarify)

**D1 — How is a removed annotation surfaced? (FR-4)**
- (rec) Writer returns the removed lines; the approve/accept command shows a notification. Cost: touches each command's call site, a wider diff than one helper.
- Writer logs only. Cost: invisible in the editor; recreates the "silent loss" the issue itself names as the cost of shipping the writer alone.
- Writer refuses when an annotation is present. Cost: blocks approve on any annotated file (3 requirements files today); the issue rejected this.

**D2 — Ratchet validator to `error` in this change?**
- (rec) No: keep `warn`, ratchet in a follow-up once the corpus is clean. Cost: the warn window persists, so annotations written meanwhile are still removed on write (visibly, per D1).
- Yes, after the corpus edit lands in the same PR. Cost: couples a writer semantics change to a gate flip; any annotated file on another open branch then fails validate.

**D3 — Fold the #1833 inversion guard into the spec/epic writers?**
- (rec) No, separate issue. Cost: spec/epic writers keep no prose-inversion guard; this stays unguarded meanwhile. The issue did not ask for it, and it is scope expansion under the repo triage rules.
- Yes, one shared guard. Cost: larger T3 surface and its own false-positive risk on spec bodies.

**D4 — Which A1 files does Plan clean?** The issue says nine, this base measures three with a coarse scan. Plan must re-measure with the shipped predicate and clean whatever it reports; confirm no objection to deleting (not preserving) comments with no rationale.

## Rejected alternatives (DR-086 §4)

- *Writer preserves the inline comment.* Written about the old value; preserving it is the #1879 falsification relocated.
- *Writer refuses on annotated lines.* Blocks approve on existing files and turns a doc nit into a failed approval.
- *Validator only.* Already shipped; leaves A2 live for any annotation written before the author sees the warning.
