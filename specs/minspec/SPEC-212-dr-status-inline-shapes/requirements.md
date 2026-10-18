---
id: SPEC-212
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a DR's three statuses must not contradict each other silently
aspects: [adr, status-parity, no-silent-gate, tier-0, offline]
relates_to: ["#2016", "#1624", "#1223", "#626", "#1833", "#2180", SPEC-095, DR-003]
implements: none
implements_reason: >-
  Every change lands in existing files no spec owns (status-parity.ts, adr-manager.ts);
  owning a shared parity module from a defect spec would freeze it for later changes.
affects: [packages/minspec/src/lib/status-parity.ts, packages/minspec/src/lib/adr-manager.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-212: DR status reader must see the list-item and bare-bold shapes

Issue: #2016. Specify phase only - nothing here is built.

## Problem

Accepting a DR whose body writes its status as `- **Status:** proposed` (or a bare
`**Status:** proposed` line) rewrites the frontmatter and `INDEX.md` but leaves the body
saying `proposed`. Nothing errors. Observed in AIClarityAU/voip-sms-inbox DR-008, caught
only because that repo had a local parity test.

## Root cause (mechanism + missing gate)

Mechanism: `reconcileBodyStatus` (`adr-manager.ts:737`) targets only claims returned by
`inspectAllStatusClaims(content, 'dr')` (`status-parity.ts:300`). For `dr` that reader
recognises (a) the first non-empty line after a `## Status` heading, and (b) a head
blockquote `> **Status: ...**` (`headBlockquoteStatus`). A list-item or bare `**Status:**`
line is neither, so it yields zero claims and the writer returns the content unchanged.
This is the writer-narrower-than-reader class its own comment warns about, except here the
READER is narrower than the intent ("the body is the third place this status lives").

Missing gate: the same blind spot disables the #626/#1223 parity validator (Rule 11) for
these DRs - it compares nothing and passes in silence. So the defect is a read gap shared by
writer and gate, not a writer bug. Fixing only the writer's targeting would leave the gate
blind; fixing the shared reader repairs both.

Correction to the issue text: `statusProseWouldInvert` does not define what a claim is; it
re-strips a prefix (`^>`, `Status:`, leading emphasis) from lines the reader already found.
Its strip regex `^[*_]{0,2}Status:` does not match `**Status:**` (colon inside the bold)
and must be updated in step with the reader, or the #1833 negation guard sees the wrong
"first word" on newly visible lines.

Second defect (same issue): `setAdrStatus(file, s)` on a file already at `s` reconciles the
body only through the same write path; the issue reports it produces no diff. Not verified
here beyond the issue's statement; the implementer must reproduce before relying on it.

## Functional requirements

- **FR-1** For `kind 'dr'`, `inspectAllStatusClaims` returns a claim for a line shaped
  `- **Status:** <word>` or `* **Status:** <word>` (optional indentation), and for a line
  shaped `**Status:** <word>` at column 0. Token classification reuses `classify`
  (comparable / freeform / unparseable); the recognised-word guard is unchanged.
- **FR-2** The shapes are recognised in the SAME module and by the SAME mechanism as the
  existing head-blockquote fallback (one definition of "a status claim"); no second
  matcher in `adr-manager.ts`.
- **FR-3** The text after `**Status:**` is read past the closing emphasis (`** proposed`
  yields token `proposed`, not an unparseable `**`). `Status:` inside bold with the colon
  outside (`**Status**: proposed`) is covered by the same rule or listed as out of scope
  (see DQ-2).
- **FR-4** `reconcileBodyStatus` rewrites the token on those newly visible lines, mirroring
  capitalisation, and leaves `freeform` / `unparseable` lines untouched as today.
- **FR-5** `statusProseWouldInvert` strips the bullet and `**Status:**` prefix so the first
  word is the status token and the negation test runs on the real remainder, including the
  wrapped-paragraph behaviour from #2180. `- **Status:** Proposed. Not accepted yet.`
  still refuses.
- **FR-6** The parity validator (Rule 11) compares the new claims against frontmatter and
  reports a disagreement exactly as it does for existing shapes (no new severity).
- **FR-7** Only claims at the document's status position are read, not any bullet that
  mentions status. A bullet like `- **Status:** see DR-010` is `freeform`, never rewritten.
  Occurrences inside fenced code blocks are not claims (see DQ-3).
- **FR-8** (conditional on DQ-1) `setAdrStatus` reconciles the body even when frontmatter
  already equals the target, so re-running repairs drift. A no-drift file produces a
  byte-identical result.

## Acceptance criteria

- **AC-1** Table-driven test: `- **Status:** proposed`, `* **Status:** proposed`,
  `**Status:** proposed` each yield one `comparable` claim with the right line; the
  `## Status` form still yields one; the three together in one DR yield all of them.
- **AC-2** `setAdrStatus(file, 'accepted')` on a DR with a list-item body status
  `proposed` leaves frontmatter, and the body line, `accepted` (distinguishing test:
  fails on current main, passes after).
- **AC-3** Negation case `- **Status:** Proposed. Not accepted.` makes `setAdrStatus`
  throw before any write, file unchanged (#1833 preserved).
- **AC-4** `- **Status:** see DR-010` and a fenced-code example are not rewritten.
- **AC-5** Corpus check: run the extended reader over every `docs/decisions/DR-*.md`;
  the PR records how many files gain a new claim and that none newly FAIL Rule 11. Any file
  that would newly fail is fixed in the same PR or listed under DQ-4.
- **AC-6** CRLF input behaves identically (SPEC-095 `prepareText`).
- **AC-7** (conditional on DQ-1) Idempotence test: second `setAdrStatus` call with the
  same status repairs a stale body and is a no-op on a clean file.

## Invariants this change must not break

- INV-1 Offline, no network (constitution inv. 1).
- INV-2 No silent gate (inv. 2): the change widens what the gate reads; it must not turn a
  previously visible failure into a pass, and a read the writer cannot rewrite must
  surface as `unparseable`, not be skipped.
- INV-3 Widening what can be READ never widens what counts as a status: the
  recognised-word guard stays.
- INV-4 #1833 negation guard and #2180 paragraph handling apply to every shape.
- INV-5 Existing shapes (`## Status`, head blockquote) behave byte-for-byte as today.

## Decisions needed (Clarify)

- **DQ-1 Should `setAdrStatus` repair drift when frontmatter already equals the target?**
  (a) Yes **(rec)** - the command becomes the repair path, matching the reader's
  expectation; cost: a call meant as a no-op can now modify the body, and callers that
  rely on "no diff" need a check. (b) No - keep prevention-only; cost: stale bodies stay
  hand-fix only, which is how #2016 persisted.
- **DQ-2 Which spellings count?** (a) Only `**Status:**` and `Status:` inside bold
  **(rec)** - matches the observed corpus shape; cost: `**Status**:` and plain `Status:`
  lists stay invisible. (b) Also those spellings; cost: higher false-positive risk on
  prose lines.
- **DQ-3 Fenced code and nested bullets.** (a) Skip fenced blocks, accept any indent
  **(rec)** - cost: a new fence-tracking pass in a small module. (b) Column-0 bullets only,
  no fence tracking; cost: indented claims are missed.
- **DQ-4 Newly-visible existing DRs that disagree.** (a) Fix them in the implementing PR
  **(rec)** - cost: a docs sweep inside a code PR. (b) Land reader first as a warning,
  sweep after; cost: a window where the gate is knowingly soft (inv. 2 tension).
- **DQ-5 ADR needed?** Believed not: reversible in under a day (DR filter). Unverified
  against `docs/decisions/INDEX.md`.
