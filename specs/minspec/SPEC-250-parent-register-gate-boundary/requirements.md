---
id: SPEC-250
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - gate-signal integrity; a T0 gate that reds on correct work and is also the last witness for a defect class
aspects: [decision-register, gate, leak-detection, no-silent-gate, offline, dr-053]
depends_on: []
relates_to: ["#2148", "#2051", "#41", "#160", "#179", "#1979", "#2307", "#679", "#681", DR-053, DR-027, DR-032, SPEC-021, SPEC-214]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decisions D1-D4.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-250: The parent-register gate stops reading local decision ids of one hundred and above as parent refs, and a separate structural check keeps catching leaked parent-register numbers

> **This is a SPECIFICATION ONLY.** Written for issue #2148. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.
> No decision record is minted: every choice here is a change to test and validator code
> and can be undone in under a day (DR-359 ADR filter, a parent register rule). DR-053
> (cross-project and paragraph refs) already decides that a bare local id means this repo's.

## In plain terms

A T0 test (`packages/minspec/tests/parent-register-refs.test.ts`) treats any decision id of
one hundred or more as a reference to the parent `mmo-platform` register. It assumed this
repo's own register would stay below one hundred. It no longer does: this repo has local
records up to the one hundred and twelfth. The test never went red because the authors of
those records worked around it. That workaround has a cost and has weakened the test.

The same test is also, since #2051, the only thing that notices when a parent-register
number is minted into the local register by mistake (the #41 leak). So the fix cannot just
raise the threshold. This spec splits the two jobs:

- **Prose refs:** a token that a local decision file claims is local. It never needs
  attribution, whatever its size.
- **Leaks:** a separate check looks at the decision **files** and flags any id that sits far
  above the rest of the register. That check reads numbers, not line text, so a leaked
  record's title cannot hide it.

## Root-cause diagnosis (measured 2026-10-27, worktree at `7a200191`)

**Mechanism.** `PARENT_DR = /DR-([1-9]\d{2,})/g` (`parent-register-refs.test.ts:61`) is a
fixed floor. The header (`:7-9`) and the predicate comment (`:41-60`) assume the local
register stays below one hundred. The register grew past the floor, and nothing ties the
floor to the register.

**Missing gate.** No check ties the "parent range" to what the local register actually
holds. Since #2051 removed Rule 6's `gap` warning (`scripts/validate-frontmatter.ts:321-328`),
no check reads the decision files' ids for leaked parent numbers either. The id-collision
gate cannot help: a leaked number is free, not duplicated.

**Measured state, which differs from the issue body.** The issue predicts a red at the first
local id of one hundred. That red never happened, because authors avoided spelling the ids:

| Measurement | Value |
|---|---|
| Local decision files on disk | ids 1-100 and 102-112 (the gap at 101 is the id #2307 held, per the note in `docs/decisions/DR-100.md:19-28`) |
| Records whose prose does not spell their own id, so the gate stays green | the records numbered 100, 104, 106, 107, 108, 109, 110 (each has an "On this record's number/id" note citing #2148) |
| Lines that cite a local id of one hundred or more and pass only because they contain the phrase "a local record, not a parent register one" | 5 lines: `DR-070.md:262,267,283`, `DR-086.md:92`, `DR-104.md:234` |
| Parent-register numbers cited in the scan scope | 172, 306, 307, 333, 355, 359, 360, 362. The lowest, **172**, is 60 above the local max |
| Unclaimed (dangling) bare ids below one hundred in the scan scope | 0 |

Two consequences follow:

1. **Correct work costs a workaround every time.** Every new record and every amendment
   note in this range has to avoid writing a local id, or write a phrase that names the
   parent register to deny it.
2. **The attribution check now passes its own negation.** `ATTRIBUTION`
   (`parent-register-refs.test.ts:68-69`) matches the words "parent register". The phrase
   "not a parent register one" therefore counts as attribution. This is the same weakness
   the issue measured for the bare word `global`: the predicate reads line text, so any
   line can satisfy it.

## Existing handling in this repo (cited)

- `parent-register-refs.test.ts:30` scans `docs`, `README.md`, `CLAUDE.md`. `:40` excludes the
  generated `docs/decisions/INDEX.md`. `:89-98` strips frontmatter. `specs/` is excluded by
  design (bodies are approval-hash-bound).
- `scripts/lib/dr-id-collision.ts` already holds the offline DR-id helpers: `drNumberFromPath`
  (`:94`), `declaredIdFromContent` (`:108`), `checkDeclaredDrIds` (`:182`, the duplicate and
  filename-mismatch defects behind validator Rule 17).
- `scripts/validate-frontmatter.ts:333-340` (Rule 6) swallows an unreadable decisions
  directory with an empty `catch`. That is acceptable for a warning. It is **not** acceptable
  for the check this spec adds (Invariant 2).
- SPEC-021 and DR-032 guard the other direction (local ids leaking outward). SPEC-214 covers
  how reviewers read DR ids that are reserved by open pull requests.

## Functional requirements

**Prose-ref predicate (job 1)**

- **FR-1. A locally claimed id never offends.** A `DR-NNN` token in the scan scope whose number
  matches a decision file in `docs/decisions/` (by filename number or declared `id:`) is local
  and passes, whether or not the line has attribution and whatever the number's size.
- **FR-2. The in-flight window passes.** An unclaimed token whose number is at or below
  `localMax + M` passes. `localMax` is the highest locally claimed id, excluding ids that FR-5
  flags as outliers. `M` is the margin from D2. This covers ids held by open pull requests,
  which an offline run cannot see (#2051), including gaps below `localMax`, such as the id
  #2307 held.
- **FR-3. Only a far-out unclaimed, unattributed token offends.** A token offends only if it is
  unclaimed, above `localMax + M`, and on a line without parent-register attribution. The
  failure message names the file, the line, the token, the computed `localMax`, and the
  margin, so the reader can see why the token counts as parent-range.
- **FR-4. No fixed floor remains.** The literal `100` boundary and the header claim "currently
  topping out below 100" are removed. The header states the new rule and points to FR-5 as
  the leak witness.

**Leak-outlier check (job 2)**

- **FR-5. Outlier ids fail.** Sort the ids of decision files in `docs/decisions/`, taken from
  the filename and the declared `id:`, ascending. If the step from one id to the next exceeds
  `M`, that next id **and every id above it** is reported as a suspected parent-register leak.
  A leaked `DR-362` above a local max of 112 is a step of 250. A cluster of two leaks
  (`DR-360` and `DR-362`) is caught, because the step above 112 flags both.
- **FR-6. The check reads numbers, not text.** FR-5 does not read titles, headings or bodies.
  No word in a leaked record can exempt it.
- **FR-7. It fails visibly.** An FR-5 finding is fatal. The message names the file, its id, the
  next-lower local id, the step, `M`, and the remedy: take the next free id from
  `scripts/check-dr-id-collision.ts` and renumber, as the CLAUDE.md Decision Register section
  says.
- **FR-8. It fails closed on missing input.** If `docs/decisions/` is missing or unreadable, or
  holds no `DR-NNN.md` file, the check fails with a message saying so. It never passes
  silently and never stops evaluating with an empty `catch`.
- **FR-9. One shared margin.** FR-2 and FR-5 read `M` from a single exported constant, so the
  two jobs cannot drift apart. The constant's comment states what it trades off (D2).
- **FR-10. Pure and offline.** The FR-5 predicate is a pure function over `{ path, content }`
  records, in the same module as the existing DR-id helpers (placement per D3). It makes no
  network call and no git call.

## Invariants (must not break)

- **Invariant 1 (offline).** Both predicates read only the working tree, with no network and no
  `gh`.
- **Invariant 2 (no silent gate).** The FR-5 check is fatal, fails closed (FR-8), and is not
  wrapped in `|| true` or an empty `catch`. The leak class keeps at least the one witness it
  has today. It is not removed as a side effect of clearing a red.
- **Invariant 3 (blast radius).** Both checks are repo-internal tests or validator rules.
  Nothing ships to adopters.
- **The #2051 boundary.** Neither check reports an id because it is merely **absent**. FR-2
  passes every unclaimed id up to `localMax + M`. FR-5 fires only on a file that **exists**.
- **`specs/` stays out of scope** for the prose gate, which leaves approval hashes untouched.

## Acceptance criteria

Each criterion is a fixture-driven unit test over the pure predicates. Fixtures vary
**register size and id positions**, not only line text (the unvaried-axis lesson).

- **AC-1.** A register of ids 1-112 plus a doc line `see DR-112` with no attribution yields
  **no** prose offender. (Today this line is an offender.)
- **AC-2.** The same register plus `see DR-360` with no attribution yields one offender. With
  `see DR-360 (parent register)` it yields none.
- **AC-3.** A register with a gap (1-100 and 102-112) plus `see DR-101` yields no offender.
  A line citing `DR-115` with `M = 20` yields no offender (in flight).
- **AC-4.** A register 1-112 plus a file `DR-362.md` titled `Some leaked global-register
  number` yields one FR-5 finding for 362, even though the title contains `global`. The same
  register plus `DR-360.md` and `DR-362.md` yields two findings.
- **AC-5.** A register 1-112 plus `DR-117.md` (step 5) yields no FR-5 finding. A step of
  exactly `M` yields none, and a step of `M + 1` yields one (boundary pinned).
- **AC-6.** A file `DR-362.md` does not raise `localMax` for FR-2. In a register 1-112 plus a
  leaked `DR-362.md`, a bare doc line `DR-340` is still a prose offender.
- **AC-7.** A missing decisions directory, and an empty one, each fail FR-5 with a message
  that names the cause (FR-8).
- **AC-8.** Run against the real repo at merge time, both checks are green, and the seven
  workaround records and five negation-phrase lines are no longer **needed** for green.
  Shown by a fixture that spells each such id bare.
- **AC-9.** A mutation that replaces the FR-5 comparison with `false`, and one that drops the
  outlier exclusion from `localMax`, each turn at least one AC red.

## Decisions needed (Clarify)

**D1. Which design. (rec) Option A: split the jobs as written above.** Cost: the most work of
the four options. FR-5 is a heuristic, not a proof: a deliberate jump of more than `M` in
local numbering would trip it. Rejected alternatives:

- **Raise the floor** (for example `DR-([3-9]\d{2})`). This is a one-line change. It drops leak
  coverage for any leaked number below the new floor, which includes the cited parent number
  172. It also re-creates a dated expiry.
- **Derive the boundary from the register alone.** This is FR-1 without FR-5. Leak coverage
  goes to zero, because a leaked `DR-362.md` is a local file claiming its number.
- **Bump the floor and record the loss.** Honest and cheapest, but the #41 defect would return
  undetected.

**D2. The margin `M`. (rec) 20.** On disk, the largest step between local ids is 2 (the id
#2307 held). The largest in-flight batch seen is four consecutive records (the queue item ctg
set, `DR-106.md:20-27`). The nearest cited parent number, 172, is 60 above the local max.
Cost: once the local register comes within `M` of a parent number, FR-5 cannot detect a leak
of that number, and FR-2 passes a bare, unattributed ref to it as in flight. The register
grew from about 93 to 112 in roughly a month (the issue's figure, unverified as a rate). At
that pace the 172 margin closes in about three months, and after that only DR-053 v2
prefixed refs (`MMO/DR172`, #679 / #681) can disambiguate. A larger `M`, such as 50, absorbs
bigger in-flight batches but loses the 172 coverage sooner.

**D3. Where FR-5 runs. (rec) A pure function in `scripts/lib/dr-id-collision.ts`, called as a
new fatal rule in `scripts/validate-frontmatter.ts`, and unit-tested.** It sits next to Rule 17,
which already reads the same files. Cost: `npm run validate` gains a fatal rule, so a leak
blocks local validation as well as CI. That is intended, but it is a new way for validation
to stop. Alternative: keep it inside the T0 vitest file. That is less visible locally, and it
couples two jobs in one test again, which is how this gap arose.

**D4. The workaround notes in accepted records. (rec) Leave the bodies untouched in the
implementing PR, and add the FR-4 header text explaining that the notes are historical.**
Cost: seven "On this record's number" notes and five "not a parent register one" phrases will
describe a gate behaviour that no longer exists, a stale signpost until someone edits them.
The alternative is to restore the spelled ids and drop the notes in the same PR. That touches
accepted DR bodies, which may engage the amendment gate (#3110 is a defect on that path),
and it widens the PR's scope.

## Alternatives rejected

- **A frontmatter escape hatch** (for example `id_jump_reason:`) for deliberate jumps above `M`.
  Any agent could write it to bypass FR-5. A deliberate jump is rare and can change `M` in one
  reviewed line instead.
- **Folding FR-5 into the id-collision workflow.** That gate is advisory, not required. Placing
  the only leak witness there would make the leak class non-gating.
- **Requiring DR-053 v2 prefixed parent refs now.** That is the durable answer to
  convergence, but #679 / #681 own the grammar migration. Adding it here widens scope.

## Follow-ups (tracked)

- Register convergence with parent numbers: owned by #679 / #681 (DR-053 v2 migration). No
  new item.
- D4's stale notes: decided at Clarify. If the rec is taken, the Plan phase files one issue
  for the body clean-up, because it would change decisions within 30 days.
