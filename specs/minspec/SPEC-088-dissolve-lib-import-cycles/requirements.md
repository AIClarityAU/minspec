---
id: SPEC-088
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology — code-change safety, sibling of SPEC-040's layering gate
aspects: [architecture, tier-0, refactor, import-cycles, maintainability]
relates_to: [SPEC-040, DR-064, "#988", "#1446", "#830", "#877"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1/FR-2
# precedent, same reasoning SPEC-078/SPEC-079 record). `approval.ts` is already OWNED
# (implements:) by SPEC-041, so it is declared `affects:` here, never `implements:` —
# this spec modifies, it does not own (one owner per file). The new pinning test is
# the only NEW file, so it is the only `implements:` entry.
implements: [packages/minspec/tests/import-cycle-dissolution.test.ts]
affects:
  - packages/minspec/src/lib/approval.ts        # FR-2 — ApprovalRecord moves OUT (owned by SPEC-041)
  - packages/minspec/src/lib/approval-store.ts  # FR-2 — ApprovalRecord moves IN; drops its only import of ./approval
  - packages/minspec/src/lib/spec.ts            # FR-3 — PhaseStatus moves OUT, re-exported (same shape as the #1446 SpecStatus move already in this file)
  - packages/minspec/src/lib/lifecycle.ts       # FR-3 — reads PhaseStatus/SpecStatus from spec-vocabulary; drops its only import of ./spec
  - packages/minspec/src/lib/spec-vocabulary.ts # FR-3 — new home for PhaseStatus, beside the existing SpecStatus
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Dissolve the `lib` import cycles the runtime gate cannot see (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch
> that produced it. A human reads this spec, resolves
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before anything is built.

Materializes **[#988](https://github.com/AIClarityAU/minspec/issues/988)** — SPEC-040
FR-6, deferred in four places (requirements FR-6, requirements §Out of Scope, design
§FR-6, tasks §Out of scope) and, unlike its siblings #830 and #877, carried no issue
number until #988 filed it. Rests on **[DR-064](../../../docs/decisions/DR-064.md)**,
which recorded why the acyclicity gate (`npm run check:cycles`,
`packages/minspec/src/lib/import-cycle-check.ts`) checks only **value**-import edges:
a type-only edge is erased at compile time and creates no runtime require cycle, so
gating it would be gating something that cannot actually happen. FR-6 is the opposite
concern — not "is the gate wrong", but "is the *code* one careless edit away from
tripping the gate it correctly ships".

**Id note.** The highest `SPEC-NNN` claimed across every local branch and remote ref in
this checkout (`origin/*`, `bundle/*`, and local `agent/issue-*` branches) is `SPEC-087`;
this is `SPEC-088`. Those refs may be stale; if the id collides at review time, renumber.

## One-Sentence Scope

Relocate the one type belonging to each side of the **two** import cycles that still
exist in `packages/minspec/src/lib` (`approval` ↔ `approval-store`, `spec` ↔
`lifecycle`) into the module that already owns the data it describes, so each pair
becomes genuinely **one-directional** — no edge back, of any kind, not merely a
type-only edge the compiler happens to erase today.

## Context — re-verified from code, not taken from the issue as given

The issue names **three** cycles. Reading the current tree (not the issue text, per
CLAUDE.md's *plausible-inference ≠ observation* rule) shows only **two** still exist;
the third was already dissolved by a prior fix. All three claims below are checked
against `main` at the time of writing, file:line cited:

- **`approval` ↔ `approval-store` — still live.** `approval.ts` value-imports
  `{readRecord, writeRecord, removeRecord, listRecords, toPosixRel}` from
  `./approval-store` (`approval.ts:30-36`). `approval-store.ts` type-imports
  `ApprovalRecord` from `./approval` (`approval-store.ts:22`) — the sole edge closing
  the loop, and the sole reason `approval-store.ts` imports from `./approval` at all.
- **`spec` ↔ `lifecycle` — still live.** `spec.ts` value-imports `{deriveStatus,
  phasesForApproval}` from `./lifecycle` (`spec.ts:8`). `lifecycle.ts` type-imports
  `{PhaseStatus, SpecStatus}` from `./spec` (`lifecycle.ts:13`) — again the sole edge
  closing the loop, and the sole reason `lifecycle.ts` imports from `./spec` at all
  (its other import, `ApprovalStatus` from `./approval`, is a tree edge, not part of
  either cycle).
- **The 4-node `epic-manager` loop — already dissolved, verified NOT present.** The
  issue describes `epic-manager → spec-layout → spec-validator → epic-manager →
  spec-manager`, closed by `epic-manager.ts:4`'s value-import of `slugify` from
  `./spec-manager`. That value edge still exists today, but the edge that closed the
  loop back onto `epic-manager` is gone: `spec-validator.ts` no longer imports
  `epic-manager` at all (confirmed by grep — zero references). It was moved in
  **fix(#1446): break the spec-validator→spec cycle, and guard the phase writer**
  (`d1a285b7`/`3de18d7f`), which relocated `epicRefValue` out of `epic-manager.ts` into
  the zero-import leaf `spec-vocabulary.ts` for exactly this reason — the module's own
  comment says so (`spec-vocabulary.ts:122-125`). `epic-manager.ts:4`'s `slugify`
  import is today an ordinary tree edge (nothing re-imports `epic-manager` from that
  cluster), not a cycle member. **This FR needs no work here — it is a no-op**, and
  this spec says so explicitly rather than silently re-doing a shipped fix or silently
  dropping a third of the issue's stated scope without comment (CLAUDE.md evidence
  discipline: an unverified "did we already do this" is exactly the plausible-inference
  trap).
- **Baseline, re-measured.** `npm run check:cycles` → *"Import cycle check passed — 110
  modules scanned, 0 runtime import cycles."* (today's module count; the issue's "95
  modules" is from SPEC-040's authoring time and has since grown — cited for
  provenance, not re-asserted as current).

### The fix each pair needs, cited from the file that already proves the pattern works

**`approval` ↔ `approval-store` (FR-2).** `approval-store.ts`'s only use of
`ApprovalRecord` is the type it stores (`normalizeRecord`, `readRecord`, `writeRecord`,
`listRecords` — `approval-store.ts:115-181`), and its own docblock already says it
*"[o]wns the on-disk shape; `approval.ts` delegates its read/write to this module"*
(`approval.ts:10-11`). The interface is misplaced relative to that stated ownership.
Moving `ApprovalRecord` into `approval-store.ts` and having `approval.ts` import it
(type-only) back needs **zero new edges**: `approval.ts` already value-imports from
`./approval-store`, so the type import rides the same specifier. `approval-store.ts`
is left importing nothing from `./approval` — the pair becomes one-directional.

**`spec` ↔ `lifecycle` (FR-3).** This is not a new idea — it is the **same fix #1446
already applied one type over**, visible in `spec.ts:14-29` today: `SPEC_STATUSES` /
`SpecStatus` / `SPEC_TYPES` were moved to the zero-import leaf `spec-vocabulary.ts` so
that modules needing them (`spec-validator.ts`, now `lifecycle.ts` too) don't have to
value- or type-import `spec.ts`, and `spec.ts` re-exports them so no external `from
'./spec'` import site had to change. `PhaseStatus` (`spec.ts:12`) is the one sibling
type that move did not cover, and it is the literal cause of `lifecycle.ts`'s back-edge.
Moving it to `spec-vocabulary.ts` alongside `SpecStatus`, with `spec.ts` re-exporting it
exactly as it already re-exports `SpecStatus`, and pointing `lifecycle.ts` at
`spec-vocabulary.ts` for **both** types, removes `lifecycle.ts`'s only import of
`./spec` — again a relocation plus a re-export, not a behaviour change.

## Functional Requirements

- **FR-1 (re-verify before touching code).** Before any edit, `npm run check:cycles`
  MUST be run and its "0 runtime import cycles" result recorded, and the three cycles
  the issue names MUST each be independently confirmed present/absent by reading
  current imports (not assumed from the issue body or from SPEC-040/DR-064, both of
  which predate several since-merged fixes). This spec's own Context section already
  did this once; Plan/Implement MUST re-run it against the tree they actually edit, in
  case another in-flight PR has moved these files meanwhile (#168 — many concurrent
  worktrees on this repo).
- **FR-2 (dissolve `approval` ↔ `approval-store`).** Move the `ApprovalRecord`
  interface (`approval.ts:60-69`) into `approval-store.ts`. `approval.ts` imports it
  back type-only from `./approval-store`. After the move, `approval-store.ts` MUST
  import nothing — value or type — from `./approval`.
- **FR-3 (dissolve `spec` ↔ `lifecycle`).** Move the `PhaseStatus` type alias
  (`spec.ts:12`) into `spec-vocabulary.ts`, beside `SpecStatus`. `spec.ts` re-exports
  it exactly as it already re-exports `SpecStatus`/`SPEC_STATUSES`/`SPEC_TYPES`
  (`spec.ts:23-29`), so no external `from './spec'` import site changes. `lifecycle.ts`
  imports both `PhaseStatus` and `SpecStatus` type-only from `./spec-vocabulary`
  instead of `./spec`. After the move, `lifecycle.ts` MUST import nothing — value or
  type — from `./spec`.
- **FR-4 (the `epic-manager` cycle is a documented no-op, not silent scope-drop).**
  No code change is required for the third cycle the issue names; this spec's Context
  section is the record of why, with the commit that already fixed it
  (`fix(#1446)`). Plan/Implement MUST re-confirm the no-op (re-run the same grep) and
  must not close this FR as "done" without that re-check, per the no-op still being a
  claim subject to CLAUDE.md's evidence-discipline rule.
- **FR-5 (pinning tests, one per dissolved pair).** A new test file (declared under
  `implements:`) asserts, by reading each file's import specifiers (not by running
  `check:cycles`, which only ever sees the value-import graph and could not have
  caught either cycle before today — see DQ-1): `approval-store.ts` imports nothing
  from `./approval`; `lifecycle.ts` imports nothing from `./spec`. Each assertion is
  red against the pre-fix module and green after.
- **FR-6 (behaviour-preserving).** Both moves are pure relocations plus re-exports.
  No function signature, runtime value, or public import path for an existing
  `from './spec'` or `from './approval'` consumer changes. The full existing test
  suite is the guardrail (AC-4).

## Acceptance Criteria

- **AC-1 (FR-2).** `packages/minspec/src/lib/approval-store.ts` contains no import —
  value or type — naming `./approval`. `ApprovalRecord` is defined in
  `approval-store.ts` and re-exported (type-only) from `approval.ts`.
- **AC-2 (FR-3).** `packages/minspec/src/lib/lifecycle.ts` contains no import — value
  or type — naming `./spec`. `PhaseStatus` is defined in `spec-vocabulary.ts` and
  re-exported (type-only) from `spec.ts`, alongside the existing `SpecStatus`
  re-export.
- **AC-3 (FR-4, no-op recorded).** The PR body or commit message for this spec's
  Implement phase states, with a fresh grep's output, that `spec-validator.ts` imports
  nothing from `./epic-manager` (i.e., the third cycle needed no code change) — not
  merely citing this spec's Context section as of today.
- **AC-4 (FR-6, full suite).** `npm test` and `npm run check:cycles` are green on the
  post-refactor tree. `npm run check:cycles`'s own module/edge count may change
  (modules are the same, only internal edges move) but must still report **0 runtime
  import cycles** — it already does today, so this AC is a non-regression check, not a
  new pass.
- **AC-5 (FR-5, pinning).** The new test fails on the pre-fix tree (both assertions
  red) and passes after FR-2/FR-3 land.
- **AC-6 (no widening).** No file outside this spec's `affects:`/`implements:` list is
  modified. In particular, neither the 7 vscode-coupled `lib/` files (#830) nor the
  `lib/spec-manager.ts` → `lib/spec-layout.ts` → `lib/spec.ts` chain (unrelated tree
  edges, not a cycle) are touched.

## Invariants

- **INV-1 (constitution 1 — offline).** No network call, no new dependency; this is an
  in-repo type relocation.
- **INV-2 (behaviour-preserving, SPEC-040 AC-7's precedent).** The full suite stays
  green across both moves; a test that breaks on a pure relocation signals real
  coupling this spec did not expect, not an acceptable cost.
- **INV-3 (no regression on the shipped gate).** `npm run check:cycles` reports 0
  runtime cycles before AND after — this spec must not be the PR that silently turns a
  latent trap into a live one while "fixing" it.
- **INV-4 (one owner per file, SPEC-038 convention).** `approval.ts` stays owned by
  SPEC-041; this spec declares it `affects:`, never re-claims `implements:`.

## Decisions needed (Clarify)

### DQ-1 — Pin only the two specific edges, or generalize the cycle gate to see type edges too?

The existing CI gate (`check-import-cycles.ts`) deliberately scans only the
**value**-import graph (DR-064 §1) — gating type edges was explicitly out of scope
there, because a type-only cycle cannot fail at runtime. FR-5 above pins the two
specific edges this spec removes with direct, narrow tests. A broader question this
issue's own framing raises but does not resolve: should MinSpec also gain a
**permanent**, type-aware check that fails CI the moment *any* new type-only cycle
appears anywhere in `lib` (not just these two pairs), so the next "one edit away"
trap is caught at creation instead of waiting for someone to notice it the way #988
did?

- **Option A — narrow pinning tests only (rec).** FR-5 as written: two direct,
  cheap tests naming the two specific edges. Matches the issue's own framing of FR-6
  as *"fragility-reduction… NOT a blocker"*, keeps this a same-day, low-risk refactor
  PR, and does not reopen DR-064's scope. *Cost:* a brand-new type-only cycle forming
  somewhere else in `lib` next month is not caught until it goes runtime and trips the
  existing FR-2-equivalent gate (SPEC-040) — which is that gate's documented job, so
  this is not a coverage regression, just not a coverage *expansion* either.
- **Option B — generalize `import-cycle-check.ts` to optionally build a
  type-inclusive graph and gate on it repo-wide.** Converts "we happened to notice two
  more traps" into "no new trap can land undetected, ever." *Cost:* materially larger
  — a new CI step, a baseline/allowlist design question (who approves it, does it
  apply to `views`/`commands` too, does it supersede or sit beside DR-064 §1's
  deliberate value-only scope), and is itself new scope under CLAUDE.md's Triage Rule
  2 ("expand to X" — expanding a shipped, deliberately-scoped gate is exactly the
  trigger that rule names). Better suited to its own issue/spec if wanted, not bundled
  silently into a refactor whose issue explicitly called itself non-blocking.

Recommendation: **Option A.** If the human wants Option B, it should be filed as its
own issue referencing this one and DR-064, not folded into FR-5 here.

## Why no new DR

The DR-359 filter asks whether a choice costs more than a day to undo. Both moves here
are revertible in minutes (move a type declaration back, re-point two import
specifiers) and reuse `docs/decisions/DR-064.md`'s already-accepted reasoning (type
edges are erased, value-import direction is what matters) without changing it.
`docs/decisions/INDEX.md` has no entry for "where small shared types live within
`lib`", and this spec does not establish one — it applies the #1446 pattern a second
time, it does not generalize it (that generalization, if wanted, is DQ-1 Option B's
own future DR to write, not this one's).

## Out of scope

- **DQ-1 Option B** — a permanent type-aware cycle gate. Separate issue if approved.
- **Relocating the 7 vscode-coupled `lib/` files** — #830; untouched by this spec.
- **Any behavior change to approval, spec-status, or phase-transition logic** — every
  edit here is a pure relocation plus re-export; see INV-2/AC-4.
- **The `epic-manager` → `spec-manager` `slugify` tree edge** — not part of any cycle
  today (FR-4); left as-is.

## Risks & Mitigations

| # | Risk | L·I | Mitigation |
|---|---|---|---|
| R1 | A relocation misses a re-export, breaking an external `from './spec'` or `from './approval'` import site. | Low·Med | AC-4's full suite; `tsc`/`npm run build` as part of `npm run validate` catches a missing re-export at compile time, not runtime. |
| R2 | Another in-flight PR touches the same four files concurrently (#168 — many parallel worktrees on this repo). | Med·Low | FR-1 requires re-verifying the baseline at Plan/Implement time against the tree actually being edited, not this spec's authoring-time snapshot. |
| R3 | FR-4's "no-op" claim is itself stale by the time Implement runs (another fix moves things again). | Low·Low | AC-3 requires a fresh grep at Implement time, not a citation of this spec's Context section. |

## Dependencies

- **[#988](https://github.com/AIClarityAU/minspec/issues/988)** — this spec's source issue.
- **SPEC-040 / [DR-064](../../../docs/decisions/DR-064.md)** — the gate this spec
  reduces fragility around, without changing.
- **`fix(#1446)`** (`d1a285b7`/`3de18d7f`) — the precedent pattern FR-3 repeats, and the
  fix that already dissolved the third cycle (FR-4).
- **SPEC-041** — owns `approval.ts` (`implements:`); this spec `affects:` it.

## Test plan (for the Plan phase to place)

1. FR-5/AC-5: new file `packages/minspec/tests/import-cycle-dissolution.test.ts` —
   reads `approval-store.ts` and `lifecycle.ts` source text (or their parsed import
   specifiers, reusing `import-cycle-check.ts`'s own specifier-extraction helpers if
   Plan finds them reusable) and asserts neither names `./approval` /
   `./spec` respectively. Run once before the refactor (both assertions fail) and once
   after (both pass) — the red/green pair is the evidence FR-5 requires.
2. AC-1/AC-2: direct read of the post-refactor files (covered by the same test as #1,
   plus a compile check that `ApprovalRecord`/`PhaseStatus` are still resolvable from
   their original import paths via the re-exports).
3. AC-3/FR-4: `grep -n "epic-manager" packages/minspec/src/lib/spec-validator.ts`
   returns nothing, captured in the Implement-phase commit or PR body verbatim.
4. AC-4: `npm test` and `npm run check:cycles`, both green, run after FR-2/FR-3 land.
5. AC-6: `git diff --name-only` against this spec's `affects:`/`implements:` list —
   no extra file.
