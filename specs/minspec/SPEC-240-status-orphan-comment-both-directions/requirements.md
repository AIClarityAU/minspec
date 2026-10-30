---
id: SPEC-240
type: requirements
status: specifying
tier: T2
product: minspec
epic: EPIC-002  # Signpost Integrity - a status comment that outlives the value it explains is a false signpost
aspects: [validator, frontmatter, status-annotation, signpost-integrity]
depends_on: []
relates_to: ["#2152", "#1879", "#1912", "#1955"]
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

# SPEC-240: `status.orphan-comment` reads the comment run on both sides of `status:`

> **This is a SPECIFICATION ONLY.** Written for issue #2152. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

`validateStatusAnnotation` (`packages/minspec/src/lib/spec-validator.ts:913`) looks for `#`
comments only on the lines AFTER `status:` (`let n = idx + 1; while (...) n++`, :953-955).
A comment directly BEFORE the key survives a status write identically (the writers replace
only the `status:` line) and goes stale identically, but is never examined. The rule's own
docblock (:885-887) argues "indentation says nothing about survival"; that argument applies
unchanged one line up, and the `fixHint` (:966) wrongly names only "the line below".

## Evidence (cited; re-measured 2026-10-27 at this branch's base)

- Issue #2152 measured history: 31 blocks with a status-naming run directly above vs 3 below.
  Not re-run here (history walk); taken from the issue, marked unverified by me.
- Re-measured on the current tree with the proposed predicate (run directly above `status:`,
  indented anywhere in the run OR text matching `/status/i`): **19 files** match, not the
  issue's 8: SPEC-095, 085, 086, 096, 211 (design.md + tasks.md each), SPEC-050 (requirements,
  tasks), SPEC-042 (all three), SPEC-060, 051, 069, 052 (requirements). The count differs from
  the issue because the tree has moved and because my predicate counts the whole contiguous
  run; Plan must re-measure with the shipped predicate before relying on 19.
- `SPEC-052/requirements.md` is a realized orphan: its comment says `specifying` is correct
  "because no approval sidecar exists"; the sidecar
  `.minspec/approvals/specs/minspec/SPEC-052-push-work-via-branch/requirements.md.json`
  exists. No finding fires today.
- Severity is bounded: `config.statusLineAnnotation` defaults to `warn`; no gate verdict changes.

## Functional requirements

**FR-1. Upward run.** The rule reads the contiguous run of `#` comment lines directly ABOVE
the column-0 `status:` line, in addition to the existing run below. A blank line or a
non-comment line ends the run (same adjacency rule as below).

**FR-2. Same asymmetry, both sides.** An indented `#` run on either side is a wrapped
continuation and always flagged. A column-0 run on either side is flagged only when its text
names the status (`/status/i`).

**FR-3. One finding per side.** Emit `status.orphan-comment` once for the run below and once
for the run above, so a file with both reports both. The message states which side
("preceded by" / "followed by" N comment line(s)).

**FR-4. fixHint is side-neutral.** It no longer says "not onto the line below"; it says an
adjacent comment on either side survives the write and goes stale.

**FR-5. Docblock matches behaviour.** The `validateStatusAnnotation` docblock (rationale,
REJECTED list, KNOWN FALSE NEGATIVE) is updated for both directions, including the corpus
count that justifies the content gate on the upward side.

**FR-6. Severity unchanged.** Same `config.statusLineAnnotation` severity; no new config key,
no change to `status.inline-comment`, no change to the `status:` line selection.

**FR-7. Corpus handling (per D1).** The existing live files that newly match are resolved
before the FR-7 flip of this rule family to `error`, by the option chosen in D1.

## Acceptance criteria

- AC-1. Frontmatter `# status note` directly above `status:` yields one `status.orphan-comment` (warning at default).
- AC-2. Indented `#` run above `status:` yields a finding even if it never says "status".
- AC-3. Column-0 run above that does not mention status (e.g. a note about `tier:` above `status:`) yields none.
- AC-4. Blank line between run and `status:` yields none.
- AC-5. Runs both above and below yield two findings.
- AC-6. Existing downward tests in `packages/minspec/tests/status-annotation.test.ts` pass unchanged.
- AC-7. A mutation check: removing the upward scan fails AC-1 and AC-2 (red-then-green proven at Implement).
- AC-8. `npm run validate` exits 0 on the repo (warnings allowed) after D1 is applied.

## Invariants the change must not break

- Invariant 2 (no silent gate): the new finding is visible, never swallowed; the validator
  still never throws on a frontmatter lacking `status:`.
- Invariant 1: pure text scan, no network. Invariant 3: runs only on files already validated.
- Canonicalization is untouched: no approval hash changes from the rule itself. D1 edits to
  approved specs may.

## Decisions needed (Clarify)

**D1. What happens to the already-matching live files?**
- (rec) **A. Land the rule at `warn`, migrate the comments into body prose in a follow-up,
  before the `error` flip.** Cost: warnings sit visible in the corpus for a period; each
  migration edits a spec whose approval state must be checked first (edits to an approved
  spec stale its sidecar if the body changes; frontmatter comment edits do not, per
  canonicalization, but verify with `specHash()`).
- B. Migrate in the same PR. Cost: touches ~19 files, many approved, mixes validator and
  corpus changes in one review.
- C. Skip the upward direction and delete the "indentation says nothing about survival"
  premise from the docblock. Cost: none now; the rule keeps covering the rarer position
  (3 vs 31 blocks per the issue) while its rationale argues for both.

**D2. Should many matching files be exempted when the comment is a deliberate
"derived status" note (e.g. SPEC-052's)?** Option (rec) none: such a note is exactly what
goes stale; moving it to body prose is the fix. Cost: converts accurate notes into noise
until migrated. Alternative: a marker comment form the rule ignores. Cost: a new
convention that itself can rot, and a hole in the gate.
