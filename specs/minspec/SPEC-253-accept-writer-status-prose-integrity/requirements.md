---
id: SPEC-253
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a Status section that outlives the value it explains is a false signpost
aspects: [adr-manager, accept-writer, status-parity, signpost-integrity]
depends_on: []
relates_to: ["#2333", "#1879", "#1833", "#2180", "#1912", "#2021", "#626", "#2315", "#2316"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decision D1.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-253: Accepting a DR must not leave `## Status` prose that was written for `Proposed`

> **This is a SPECIFICATION ONLY.** Written for issue #2333. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

**MinSpec: Accept ADR** (`setAdrStatus`, `packages/minspec/src/lib/adr-manager.ts:705`) calls
`reconcileBodyStatus` (:674), which swaps only the status TOKEN on each `comparable` claim line
and leaves every other word. Prose that was written around the old value then describes the
new one falsely. Two real cases, accepted 2026-10-01:

- **DR-096** (#2316): `**Proposed**, born that way because DR-029's gate requires it: acceptance
  is a separate human act ...` became `**Accepted**, born that way ...`, asserting what it says is
  forbidden. Two later paragraphs of the same section still said acceptance was outstanding.
- **DR-095** (#2315): `**Proposed** 2026-09-25.` became `**Accepted** 2026-09-25.`; the proposal
  date now reads as the acceptance date (real: 2026-10-01 AEST).

The only guard, `statusProseWouldInvert` (:652, #1833, widened by #2180), refuses on NEGATION
of a status word only (its docblock calls this deliberate: mere mention fires on 9 of 27 DRs,
mostly benign history). Neither case negates. The #626 parity rule compares token to
frontmatter; both say `accepted`, so validate passes. No open issue tracks the prose half:
#1879 closed when the negation guard landed and #1912 carries only the frontmatter-comment half.

**Root cause (mechanism + missing gate):** the writer has no model of prose that depends on the
value it just changed (named in #1879), and no check reads a `## Status` section against its
NEW value. Both records were repaired by hand (`904fa885`, `c71dc8db`): a data fix only.

## Evidence

- Cited from the issue, read at the code: swap loop `adr-manager.ts:758-785`; guard `:652-731`
  (regex `NEGATED` over the claim paragraph only, via `claimParagraphText`); both live on `main`.
- Not re-measured here: how many existing DRs have a `## Status` section beyond a bare
  `**Proposed** <date>.` line. Plan must measure that count (it decides D1's refusal rate).

## Functional requirements

**FR-1. Acceptance never leaves a false Status section.** After `setAdrStatus(..., 'accepted')`
(and any other status write), the `## Status` section must make no claim that contradicts the
new status, or the write must refuse before touching the file (as #1833 does).

**FR-2. Date after a swapped token.** A date directly following a swapped token is either
replaced with the write date or kept and relabelled with the OLD status (`proposed <date>`);
never left to read as the new status's date. (Per D2.)

**FR-3. Whole-section scope.** The check reads the whole `## Status` section, not only the
claim paragraph, so prose in a sibling paragraph ("What is outstanding is the record's own
acceptance") is seen.

**FR-4. Visible refusal.** Any refusal names the DR, the line(s), and the reword needed, through
the same surface as the #1833 refusal. It never writes partially (INDEX and frontmatter stay
consistent with the body).

**FR-5. Parity reader unchanged in meaning.** If D1 = A, the reader (`inspectAllStatusClaims`)
treats the FIRST claim as authoritative; all existing single-claim records read identically.

**FR-6. Independent second witness.** A validate-time check (not only the writer) flags a DR
whose `## Status` section contradicts its status, so a hand edit or another writer cannot
reintroduce it silently (constitution invariant 2). Severity per D3.

**FR-7. Existing negation guard stays.** #1833/#2180 behaviour and tests are unchanged.

## Acceptance criteria

- AC-1. DR-096's pre-acceptance Status text (reconstructed as a fixture) accepted via the writer
  yields either a refusal (D1=B) or a section that is true after the write (D1=A); never the
  `**Accepted**, born that way because DR-029's gate requires it` text.
- AC-2. `**Proposed** 2026-09-25.` accepted on 2026-10-01 never yields `**Accepted** 2026-09-25.`
  alone.
- AC-3. A second paragraph saying acceptance is outstanding makes the post-write section fail
  (refuse or flagged) even when the claim line is a bare token.
- AC-4. A bare `**Proposed** <date>.` section still accepts cleanly.
- AC-5. A hand-edited DR with `status: accepted` and a Status section saying acceptance is
  outstanding is reported by `npm run validate` (FR-6).
- AC-6. Mutation check: dropping the section-scope read fails AC-3; red-then-green proven at
  Implement.
- AC-7. Existing #1833 / #2180 / #626 tests pass unchanged; `npm run validate` exits 0.

## Invariants the change must not break

- Invariant 1: pure local text handling, no network.
- Invariant 2: refusal and the validator finding are visible, never swallowed or best-effort.
- Invariant 3: only touches DRs in an opted-in repo.
- The writer stays conservative: `freeform` and `unparseable` claims are not reworded
  (silently rewriting hand-authored rationale is worse than a caught error).
- SPEC-095 line-ending round-trip (CRLF records) preserved.

## Out of scope

Frontmatter-comment staleness (#1912); INDEX cross-write (#2021). Both are separate issues.

## Decisions needed (Clarify)

**D1. How does the writer keep the section true?**
- **A. Prepend a new claim line `**Accepted** <today>.` and keep the old paragraph as history.**
  Prose written for `Proposed` becomes a true statement about the past. Cost: existing records
  gain a second status word; the parity reader must take the first claim as authoritative
  (FR-5), and a Status section grows on every transition. Prose such as "What is outstanding is
  acceptance" still sits under an Accepted line and reads as stale history unless dated.
- **B. Refuse unless `## Status` is exactly a bare `**Proposed** <date>.` line (rec).** Simple,
  catches all three failures in the issue, never edits prose. Cost: most hand-written Status
  sections are refused until a human rewords them first; the human work rises on acceptance,
  which is the one step that already needs a human.
- C. Keep the narrow negation guard and add a section-wide phrase heuristic (outstanding /
  not complete / born that way). Cost: a model-trusted phrase list that will drift; rejected
  unless the corpus count in Plan shows B refuses too many.

**D2. Date handling.** (rec) **Replace** the date after the swapped token with the write date
and, if the old date is meaningful history, move it to `proposed <date>`. Cost: depends on
recognising "date directly after the token" without false matches; the alternative (keep and
relabel only) costs less code but leaves the line reading `Accepted, proposed 2026-09-25`
with no acceptance date.

**D3. Severity of the FR-6 validator check.** (rec) `warn` first, then `error` once the
existing corpus is clean, matching how the signpost rules were rolled out (SPEC-240). Cost: a
visible warning window in which the defect can still merge. Alternative: `error` at once; cost:
could redden `main` on any pre-existing DR that already contradicts itself, which Plan must
measure first.
