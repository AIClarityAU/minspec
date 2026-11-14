---
id: SPEC-061
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-061 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-002  # Signpost Integrity - an approved spec must be able to agree with itself
relates_to: [SPEC-022, SPEC-038, SPEC-059, SPEC-095, DR-003, DR-034, DR-069, "#957", "#1634", "#1651", "#1659", "#2180", "#3258"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-061 - Design: a phaseless spec can agree with itself, and a refused approval writes nothing

Plan for [requirements.md](requirements.md). The contract is that file; this one says how to
finish building it. Citations of "today" are against `origin/main` at `a799afcc`, the commit
this plan was written on. New code is named by symbol, because its line numbers will move.

## Most of this spec is already built

The build issue (#3258) says no code writes a missing `phases:` block at approval. That is
not the state of `main`. Two merged pull requests built most of the spec before its Plan
phase was recorded:

- **#1651** `fix(#957): write both halves of the lifecycle state` - FR-1 to FR-5, DQ-2 and
  DQ-3: `setSpecPhases` creates the block when asked, and the phaseless short-circuit in
  `advanceSpecToImplementing` is gone.
- **#1659** `fix(#957): make setSpecPhases' createIfAbsent required` - DQ-1 and its
  sub-choice: the option is required, with a runtime guard for callers no tsconfig covers.

Evidence, read from the code and run (`npx vitest run` over the two test files below:
92 passed, 0 failed, at `a799afcc`):

| Requirement | Built where | Pinned by |
|---|---|---|
| FR-1, FR-2, AC-1 | `setSpecPhases`, the `phasesIdx === -1` branch writes every phase in `PHASES` order (spec.ts:697-714); `advanceSpecToImplementing` passes `{ createIfAbsent: true }` (spec.ts:802) | approve-phase-sync.test.ts, "creates a complete phases block, in PHASES order" |
| FR-3, AC-2 | status derived from the re-read bytes (spec.ts:806-811), then a post-write equality assert (spec.ts:812-822) | "leaves the file agreeing with itself: literal === derived from the bytes" |
| AC-3 | `deriveStatus(newPhases, 'approved', undefined)` gives `planning` for a pre-implement spec | "stamps planning, not implementing, for an approved pre-implement spec" |
| FR-4, AC-4 | only `status`/`phases` lines are written; `canonical.ts` strips exactly those two keys | "does not change the canonical hash" |
| FR-5, AC-5 | the second run rewrites the existing block in place | "is idempotent - a second advance is a byte-for-byte no-op" |
| FR-6, AC-8 | `SetSpecPhasesOptions.createIfAbsent` required, runtime guard (spec.ts:681-688), docstring states both kinds of absence | "createIfAbsent is required (SPEC-061 DQ-1)" describe block; "is a no-op when there is no phases block" |
| FR-7, AC-7 | `lifecycle.ts` not touched by either PR; `allPending` still tested first (lifecycle.ts:139) | lifecycle.test.ts, unchanged and green |
| FR-8, AC-9 | no code path writes `implements:`; every fixture is a temp file | by construction (no test writes under `specs/`) |
| DQ-3 | the phaseless branch and its #957 comment are deleted; the comment block at spec.ts:786-795 records why | "pre-fix shape is genuinely gone: the bytes no longer derive new" |

What is **not** built is the half of AC-6 that INV-1 rests on, and two comments DQ-3 asked
to be swept. The rest of this design is about those.

## What is left, measured

### Finding 1 - a refused approval still writes the file (AC-6, INV-1, #1634)

AC-6 as amended at Clarify requires the degenerate-block test to assert that the refused
approval left the file byte-identical. The test exists (approve-phase-sync.test.ts, "still
throws on a degenerate block (%s)") but asserts only the throw. The order in
`advanceSpecToImplementing` is write phases (spec.ts:802), write status (spec.ts:811),
then gate (spec.ts:825-834). Measured on a spec whose block is `phases:` with only
`tasks: pending`: the call throws `Cannot advance ...`, and the file's `status:` has moved
from `specifying` to `new`.

### Finding 2 - a second refusal path, not named by the requirements, leaves the file self-contradicting

`setSpecStatus` refuses before its own write when the body's `**Status:**` prose negates a
status word (#2180, spec.ts:590-598). But `advanceSpecToImplementing` calls it **after**
`setSpecPhases` has already written. Measured on a spec with a full `phases:` block and the
body line `**Status:** Specifying, pending review this record is not yet planning and must
not be used.`: the call throws `Refusing to set ... negates a status word`, and the file is
left with `plan: in-progress` under `status: specifying`. The persisted phases derive
`planning`, the literal says `specifying` - the exact #148 desync this function exists to
prevent, and INV-4's post-condition broken on an input shape the corpus can produce. The
post-write equality assert at spec.ts:812-822 never runs, because the throw comes first.

Both findings have one root cause, the one #1634 names: the function writes, then decides.
Every refusal must be decided before the first byte is written.

### Finding 3 - two stale signposts

- `setBodyStatusToken`'s docstring (spec.ts:532-546) says it "mirrors `setSpecPhases` never
  adding a phase line that was absent". Since #1651, `setSpecPhases` adds a whole block when
  asked. DQ-3 named this comment for the sweep; it was not swept.
- `approveSpecCommand`'s comment (approve.ts:382-383) says `advanceSpecToImplementing`
  "advances the `phases:` map (when present)". Since #1651 it creates the map when absent.

## Key decisions

**D1 - decide every refusal from the content in memory, then write.** Implements #1634's
recommended option (1).

1. Extract the text transform out of `setSpecPhases` into a pure exported function,
   `applySpecPhasesText` (contract below). `setSpecPhases` becomes read, transform, write,
   with identical output for every input.
2. In `advanceSpecToImplementing`, after the ownership guard (which already throws before
   any write), compute `prospective = applySpecPhasesText(content, newPhases, { createIfAbsent: true })`
   and `persistedStatus = deriveStatus(parseSpec(prospective).frontmatter.phases, 'approved', undefined)`.
3. Run both refusals against memory, before any write: the degenerate-block gate
   (`persistedStatus !== target`, same message as today), then
   `specStatusProseWouldInvert(content)` with `setSpecStatus`'s message.
4. Only then write: `setSpecPhases(...)`, then `setSpecStatus(filePath, persistedStatus)`.
5. Keep the post-write equality assert as defense-in-depth.

This keeps the #148 property the requirements name in FR-3: the status is derived from the
exact bytes that are written, because `prospective` is the output of the same function
`setSpecPhases` writes. It is no longer derived by re-reading, but by construction.

*Rejected: capture the original bytes and restore them in a `catch`.* Cost: the ordering
bug stays, the refusal still happens after a write, and a process killed between the write
and the restore leaves the half-written file. #1634 ranks it below (1) for these reasons.
*Rejected: collapse both writes into one `fs.writeFileSync`.* Cost: `setSpecStatus` also
rewrites the body `**Status:**` token through `setBodyStatusToken`, so a single write
means restructuring three writers, not one. AC-6 and INV-1 are about refusals; once every
refusal runs before the first write, a refused approval writes nothing. The success path
still makes two writes (see *What this design does not do*).

**D2 - the pure transform carries the option guard.** `applySpecPhasesText` validates
`opts` exactly as `setSpecPhases` does today, and `setSpecPhases` stops validating on its
own. One guard, one message, so the DQ-1 behaviour cannot drift between two copies.

**D3 - the refusal messages do not change.** Existing tests match `/Cannot advance/i` and
`/negates a status word/`, and users may have seen them. Only their timing moves.

## Contract

```ts
// packages/minspec/src/lib/spec.ts - pure, no fs.

/**
 * The text transform setSpecPhases writes. `content` is LF text (as readDocument returns
 * it); the result is LF text. Rewrites only phase lines that already exist under
 * `phases:`; when there is no block, returns `content` unchanged unless
 * `opts.createIfAbsent`, in which case the block is appended with every phase in
 * PHASES order (unsupplied phases written `pending`).
 * Throws when `content` has no frontmatter block, and when `opts` is missing or
 * `opts.createIfAbsent` is not a boolean (SPEC-061 DQ-1).
 */
export function applySpecPhasesText(
  content: string,
  phases: Partial<Record<Phase, PhaseStatus>>,
  opts: SetSpecPhasesOptions,
): string;
```

`setSpecPhases(filePath, phases, opts)` keeps its signature and behaviour: it reads with
`readDocument`, calls `applySpecPhasesText`, and writes only when the result differs from the
input, restoring line endings with `restoreLineEndings` (SPEC-095).

The no-op case must stay a no-op on disk: today, with `{ createIfAbsent: false }` and no
block, the function returns before writing, and the test "is a no-op when there is no phases
block" asserts byte identity. Writing only on a changed result preserves that.

## Files

| File | Change | Why it is in scope |
|---|---|---|
| `packages/minspec/src/lib/spec.ts` | `applySpecPhasesText` extracted; `advanceSpecToImplementing` reordered; two docstrings swept | named in requirements.md `affects:` |
| `packages/minspec/tests/approve-phase-sync.test.ts` | new and widened cases | the test file AC-6 names |
| `packages/minspec/src/commands/approve.ts` | one comment, no code | not in `affects:`; the stale comment documents `advanceSpecToImplementing`, which this spec changes (Finding 3) |

`lifecycle.ts` is in `affects:` but nothing here changes it (FR-7). `canonical.ts` is not
touched (FR-4).

## Tests

All in `packages/minspec/tests/approve-phase-sync.test.ts`. Each new check has its control
in the same test.

- **T0, AC-6 and INV-1 (Finding 1).** Widen the existing degenerate-block `it.each` (three
  shapes) to read the file before the call and assert it is byte-identical after the throw.
  Red on `a799afcc` for all three shapes; green after D1.
- **T0, INV-1 and INV-4 (Finding 2).** A spec with a full `phases:` block and the #2180
  negating body line (the fixture shape in spec.test.ts, "#2180 - a spec Status line whose
  prose negates a status word"): `advanceSpecToImplementing` throws `/negates a status word/`
  and the file is byte-identical. Control: the same spec with a benign status line
  advances to `planning`. Red on `a799afcc`; green after D1.
- **T1, the contract.** `applySpecPhasesText` against the shapes the `setSpecPhases` tests
  already use (block present, no block with `false`, no block with `true`, a block missing
  individual lines): the returned text equals what `setSpecPhases` writes for the same file,
  and calling it touches no file (a temp directory's listing and mtimes are unchanged). The
  option guard throws the DQ-1 message for a missing and an empty options object.
- Every existing case in the file stays green unchanged, including the `{ createIfAbsent }`
  guard tests and "is a no-op when there is no phases block".

## Invariants

- **INV-1 (no silent gate).** After D1, every refusal in the approval writer throws before
  the first write. Pinned by the two T0 tests above.
- **INV-2 (hash-neutral lifecycle writes).** D1 changes when the writes happen, not what
  they write. The existing hash test stays green.
- **INV-3 (Tier-0).** `applySpecPhasesText` is a string function; no new dependency.
- **INV-4 (writer and reader agree for every input).** Finding 2's input is the shape that
  broke it; its test pins it.

## What this design does not do

- **Make the success path atomic.** A successful approval still writes the phases, then the
  status line, then the body status token, as three writes. A process killed between them
  leaves a half-written file. That is an I/O failure, not a refusal, and neither AC-6 nor
  INV-1 covers it. Not filed: it bears on no decision in the next 30 days.
- **Backfill phases blocks or ownership declarations** (#1513, #1543) - out of scope per the
  requirements.
- **Change `deriveStatus`** (FR-7).
- **Typecheck the test tree** (#1660, open).
