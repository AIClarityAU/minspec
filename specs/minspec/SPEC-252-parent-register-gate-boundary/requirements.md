---
id: SPEC-252
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - gate-signal integrity; a T0 gate that reds on correct work and is also the last witness for a defect class
aspects: [decision-register, gate, leak-detection, no-silent-gate, offline, dr-053]
depends_on: []
relates_to: ["#2148", "#3140", "#2051", "#41", "#160", "#179", "#1979", "#2307", "#679", "#681", DR-053, DR-027, DR-032, SPEC-021, SPEC-214]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decisions D1-D4.
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-252: A separate structural check keeps catching leaked parent-register numbers, now that #3140 fixed the prose-ref boundary

> **This is a SPECIFICATION ONLY.** Written for issue #2148, re-grounded on `84acc8a2` (which
> contains fix #3140). Nothing is built until a human reads it, resolves
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it. No decision record
> is minted: every choice is a change to test and validator code and can be undone in under a
> day (DR-359 ADR filter, a parent register rule). DR-053 already decides that a bare local id
> means this repo's.

## In plain terms

The gate `packages/minspec/tests/parent-register-refs.test.ts` used to treat any decision id
of one hundred or more as a parent `mmo-platform` ref, so correct work at DR-100 went red.
**That half is already fixed** by #3140 (`289dfdbd`): a `DR-NNN` token of one hundred or more
is exempt when `docs/decisions/DR-NNN.md` exists and NNN is below `PARENT_FLOOR = 200`
(`parent-register-refs.test.ts:72`, `unresolvedParentRefs` at `:75-82`).

What #3140 did not do, and this spec covers:

- **Leak witness.** The test is still, since #2051, the only thing that notices a parent number
  minted into the local register (the #41 leak), and it notices only when some prose *cites*
  the leaked id. A leaked `docs/decisions/DR-362.md` that nothing cites passes. A separate check
  reads the decision **files** and flags any id far above the rest of the register, from
  numbers alone.
- **Stale signposts.** The header comment (`parent-register-refs.test.ts:9`) still says the
  register tops out "below 100". Its highest id is 113.
- **A second fixed floor.** `PARENT_FLOOR = 200` is a new dated expiry: the local register tops out at
  113, 87 below the floor (D1).

## Root-cause diagnosis (measured 2026-10-27, tree at `84acc8a2`)

**Mechanism of the original red.** A fixed floor of 100 (`/DR-([1-9]\d{2,})/`, now `:61`)
tied to nothing in the register. #3140 resolved it against local records, with a floor of 200.

**Remaining missing gate.** No check reads the decision files' ids for leaked parent numbers.
Since #2051 removed Rule 6's `gap` warning (`scripts/validate-frontmatter.ts:321-328`), the
prose scan is the only witness, and it is blind to an uncited leaked file. The id-collision
gate cannot help: a leaked number is free, not duplicated.

**Measured state (re-measured at `84acc8a2`):**

| Measurement | Value |
|---|---|
| Local decision files on disk | ids 1-100 and 102-113 (112 files; the gap at 101 is the id #2307 held, per `docs/decisions/DR-100.md:19-28`) |
| Largest step between adjacent local ids | 2 |
| Parent-register numbers cited in the scan scope | 172, 306, 307, 333, 355, 359, 360, 362. Lowest, **172**, is 59 above the local max of 113 |

**Weakness left unchanged by #3140.** `ATTRIBUTION` (`parent-register-refs.test.ts:100-101`)
matches the words "parent register" and `global`, so a negation such as "a local record, not a
parent register one" counts as attribution. This only matters for tokens that are not
resolvable locally, so it is noted here and not fixed (see Alternatives rejected).

## Existing handling in this repo (cited)

- `parent-register-refs.test.ts:30` scans `docs`, `README.md`, `CLAUDE.md`; `:40` excludes the
  generated `docs/decisions/INDEX.md`; `bodyLines` (`:125-133`) strips frontmatter. `specs/` is
  excluded by design (bodies are approval-hash-bound).
- `scripts/lib/dr-id-collision.ts` holds the offline DR-id helpers: `drNumberFromPath` (`:94`),
  `declaredIdFromContent` (`:108`), `checkDeclaredDrIds` (`:182`, behind validator Rule 17).
- `scripts/validate-frontmatter.ts:333-340` (Rule 6) swallows an unreadable decisions directory
  with an empty `catch`. Acceptable for a warning, **not** for the check this spec adds
  (Invariant 2).
- SPEC-021 and DR-032 guard the other direction (local ids leaking outward). SPEC-214 covers
  reviewers reading DR ids reserved by open pull requests.

## Functional requirements

**Header (job 1, remainder)**

- **FR-1. Already delivered.** The prose-ref exemption for locally claimed ids below the floor
  is #3140's, pinned by its tests. This spec does not re-specify or change it.
- **FR-4. No stale claim remains.** The header sentence "currently topping out below 100" in
  `parent-register-refs.test.ts` is replaced by a statement of the #3140 rule and a pointer to
  FR-5 as the leak witness. (FR-2 and FR-3 were retired with the pre-#3140 design; numbers are
  kept so existing citations stay valid.)

**Leak-outlier check (job 2)**

- **FR-5. Outlier ids fail.** Sort the ids of decision files in `docs/decisions/`, taken from
  the filename and the declared `id:`, ascending. If the step from one id to the next exceeds
  `M`, that next id **and every id above it** is reported as a suspected parent-register leak.
  A leaked `DR-362` above a local max of 113 is a step of 249. A cluster of two leaks
  (`DR-360` and `DR-362`) is caught, because the step above 113 flags both.
- **FR-6. The check reads numbers, not text.** FR-5 does not read titles, headings or bodies.
  No word in a leaked record can exempt it.
- **FR-7. It fails visibly.** An FR-5 finding is fatal. The message names the file, its id, the
  next-lower local id, the step, `M`, and the remedy: take the next free id from
  `scripts/check-dr-id-collision.ts` and renumber, as the CLAUDE.md Decision Register section
  says.
- **FR-8. It fails closed on missing input.** If `docs/decisions/` is missing or unreadable, or
  holds no `DR-NNN.md` file, the check fails with a message saying so. It never passes
  silently and never stops evaluating with an empty `catch`.
- **FR-9. One named margin.** `M` is a single exported constant whose comment states what it
  trades off (D2).
- **FR-10. Pure and offline.** The FR-5 predicate is a pure function over `{ path, content }`
  records, in the same module as the existing DR-id helpers (placement per D3). It makes no
  network call and no git call.

## Invariants (must not break)

- **Invariant 1 (offline).** The FR-5 predicate reads only the working tree, with no network and no
  `gh`.
- **Invariant 2 (no silent gate).** The FR-5 check is fatal, fails closed (FR-8), and is not
  wrapped in `|| true` or an empty `catch`. The leak class keeps at least the one witness it
  has today. It is not removed as a side effect of clearing a red.
- **Invariant 3 (blast radius).** The check is a repo-internal validator rule.
  Nothing ships to adopters.
- **The #2051 boundary.** FR-5 never reports an id because it is merely **absent**; it fires
  only on a file that **exists**.
- **`specs/` stays out of scope** for the prose gate, which leaves approval hashes untouched.

## Acceptance criteria

Each criterion is a fixture-driven unit test over the pure predicates. Fixtures vary
**register size and id positions**, not only line text (the unvaried-axis lesson).

- **AC-1.** (Pinned by #3140's tests, not re-specified.) `see DR-112` resolves locally.
- **AC-4.** A register 1-112 plus a file `DR-362.md` titled `Some leaked global-register
  number` yields one FR-5 finding for 362, even though the title contains `global`. The same
  register plus `DR-360.md` and `DR-362.md` yields two findings.
- **AC-5.** A register 1-112 plus `DR-117.md` (step 5) yields no FR-5 finding. A step of
  exactly `M` yields none, and a step of `M + 1` yields one (boundary pinned).
- **AC-7.** A missing decisions directory, and an empty one, each fail FR-5 with a message
  that names the cause (FR-8).
- **AC-8.** Run against the real repo at merge time, FR-5 is green.
- **AC-9.** A mutation that replaces the FR-5 comparison with `false` turns at least one AC red.

## Decisions needed (Clarify)

All 3 decisions are resolved: an agent session recorded each option this document already
recommended, under delegation DLG-001 (DR-108, the delegated-approval record). No human
chose them; they are ratified only by approval of this spec.

**D1. Scope. (rec) Build FR-5 and the FR-4 header fix only.** Cost: `PARENT_FLOOR = 200` stays
a fixed floor that expires when the register nears 200 (87 away at highest id 113). Rejected:
re-deriving the boundary from the register, which #3140 already settled differently and which
alone gives zero leak coverage, because a leaked `DR-362.md` is a local file claiming its number.

**Recorded selection: Option (FR-5 and the FR-4 header fix only),** build FR-5 and the FR-4
header fix only, leaving `PARENT_FLOOR = 200` as a fixed floor.

**D2. The margin `M`. (rec) 20.** The largest step on disk is 2; the largest in-flight batch
seen is four consecutive records (`DR-106.md:20-27`); the nearest cited parent number, 172, is
59 above the local max. Cost: once the local register comes within `M` of a parent number,
FR-5 cannot detect a leak of that number. A larger `M`, such as 50, absorbs bigger batches but
loses the 172 coverage sooner; only DR-053 v2 prefixed refs (#679 / #681) disambiguate after.

**Recorded selection: Option (20),** the margin `M` is 20.

**D3. Where FR-5 runs. (rec) A pure function in `scripts/lib/dr-id-collision.ts`, called as a
new fatal rule in `scripts/validate-frontmatter.ts`, and unit-tested.** It sits next to Rule 17,
which already reads the same files. Cost: `npm run validate` gains a fatal rule, so a leak
blocks local validation as well as CI. That is intended, but it is a new way for validation
to stop. Alternative: keep it inside the T0 vitest file. That is less visible locally, and it
couples two jobs in one test again, which is how this gap arose.

**Recorded selection: Option (pure function),** a pure function in
`scripts/lib/dr-id-collision.ts`, called as a new fatal rule in
`scripts/validate-frontmatter.ts`, and unit-tested.

## Alternatives rejected

- **Tightening `ATTRIBUTION` against negation phrases.** It only affects tokens not resolvable
  locally, so it guards little after #3140; widening scope.
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
- Raising `PARENT_FLOOR` before the register nears 200: decided when D1 is resolved at Clarify.
