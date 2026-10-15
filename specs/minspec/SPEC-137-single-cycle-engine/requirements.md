---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - one cycle engine instead of two copies of the same mechanism
aspects: [architecture, tier-0, shared, duplication, invariant-guard]
depends_on: [SPEC-040]  # SPEC-040 FR-2 introduced the second copy this spec removes
relates_to: [SPEC-001, DR-014, DR-064, "#993"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). The new shared
# module and its test are NEW; the three modified files are listed under `affects`.
implements: [packages/shared/src/graph-cycles.ts, packages/shared/tests/graph-cycles.test.ts]
affects: [packages/shared/src/next-task.ts, packages/shared/src/index.ts, packages/minspec/src/lib/import-cycle-check.ts, packages/minspec/tests/invariants.test.ts]
phases:
  specify: done
---

# SPEC-137: One cycle engine in `@aiclarity/shared`, consumed by both graph checkers

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers the Clarify questions, and approves it through the spec-approval gate first.

Materializes **[#993](https://github.com/AIClarityAU/minspec/issues/993)** - *"refactor:
extract the iterative three-color cycle DFS into @aiclarity/shared"*. Found by adversarial
review of SPEC-040 FR-2. Duplication-of-mechanism cleanup, **not a defect**: both copies are
correct and tested.

## Problem

`INV-CONSUME` (`packages/minspec/tests/invariants.test.ts:934`) bans the substrings
`detectCycles`, `detectIncoherence`, `compareRanked`, `gateCleared` (and two rule ids) from
any `.ts` file under `packages/minspec/src`, comments included. Its intent: the next-task
resolver is consumed from `@aiclarity/shared`, never re-implemented in the extension.

SPEC-040 FR-2 required porting the artifact-graph cycle pass into an import-graph checker.
The port was satisfied by naming it `detectImportCycles`
(`packages/minspec/src/lib/import-cycle-check.ts:589`). The guard passes, but its concern is
now literally breached: two iterative three-colour DFS loops exist -
`detectCycles` at `packages/shared/src/next-task.ts:385` and `detectImportCycles` above. The
guard was satisfied by a rename, not by structure. Second, the guard is a blunt token match
over prose, so the ported function cannot even be cited by name in a comment.

The two copies differ only in (a) where nodes/adjacency come from, (b) the comparator
(`compareIds` numeric-aware vs `compareFiles` lexical), and (c) what is reported per cycle
(sorted members as a `Corruption` vs traversal-order members as an `ImportCycle`).

## Functional requirements

- **FR-1 - One graph-agnostic engine.** `@aiclarity/shared` exports
  `findCyclesInAdjacency(nodes, adj, compare): string[][]` from a new module
  `packages/shared/src/graph-cycles.ts`, re-exported by `packages/shared/src/index.ts`.
  It is pure (no fs, no vscode, no network - Tier 0), iterative with an explicit stack (no
  recursion), and O(V+E).
- **FR-2 - Deterministic.** Roots and each node's neighbours are visited in `compare` order
  (the engine sorts a copy; it never mutates the caller's input). Identical input yields
  byte-identical output.
- **FR-3 - Result shape.** Each cycle is returned as its members in **traversal order**
  (the path slice from the re-entered gray node). A cycle reached from a different entry
  point is reported once, deduplicated on the sorted member set.
- **FR-4 - Edges to unknown nodes.** An adjacency target absent from `nodes` is skipped, not
  followed and not thrown on (callers report dangling edges as their own class).
- **FR-5 - Both callers consume it.** `detectCycles` in `next-task.ts` and
  `detectImportCycles` in `import-cycle-check.ts` each delete their local DFS and call the
  engine. `detectCycles` maps members to its sorted-members `Corruption` exactly as today;
  `detectImportCycles` maps them to `ImportCycle { members }` exactly as today. Neither
  caller's exported signature, rule id, message text, or output ordering changes.
- **FR-6 - No second DFS.** After this change exactly one WHITE/GRAY/BLACK traversal exists
  in the monorepo's `packages/*/src`. A test enforces it (see AC-4).
- **FR-7 - The guard states its intent structurally.** `INV-CONSUME` keeps every existing
  needle and keeps passing, and gains a structural assertion that `import-cycle-check.ts`
  imports `findCyclesInAdjacency` from `@aiclarity/shared`. Whether the substring check
  itself is narrowed is Clarify question DQ-1.

## Acceptance criteria

- **AC-1.** `graph-cycles.test.ts` covers: empty graph; DAG; self-loop; two-node cycle;
  disjoint cycles; two cycles sharing a node; a cycle reachable from several roots (reported
  once); a back-edge to a non-node (FR-4); a 50 000-node chain (no stack overflow); and
  determinism under permuted `nodes`/`adj` input order.
- **AC-2.** The existing `next-task.test.ts` cycle cases and the 27 `import-cycle-check`
  tests pass **unmodified** (byte-identical expected outputs), proving FR-5.
- **AC-3.** `npm run check:cycles` over the real tree still reports the same result as
  before the change (zero runtime cycles), and a planted two-file cycle is still reported -
  the "0 cycles over a smaller input" failure SPEC-040 guards against does not reappear.
- **AC-4.** A repo test greps `packages/*/src` for the traversal's colour-state signature
  and finds it only in `graph-cycles.ts` (FR-6); mutating either caller back to a local DFS
  turns it red.
- **AC-5.** `npm test`, `npm run validate`, `npm run lint`, `npm run build` pass.

## Invariants this change must not break

- **INV-CONSUME** (`invariants.test.ts:934`) - still green with every current needle; no
  needle removed or weakened by this spec unless DQ-1 selects Option B.
- **Tier 0 / offline** (constitution invariant 1) - the engine does no I/O.
- **INV-ACYCLIC** - `relates_to` stays exempt; only the caller builds adjacency, so edge
  selection is untouched.
- **SPEC-040 FR-2 / DR-064 §1** - the import gate remains in-repo, fails loudly on an
  unscannable tree, and its public API is unchanged.
- **Package boundary (DR-014)** - `packages/shared` imports nothing from `packages/minspec`.
- **No silent gate** (constitution invariant 2) - the refactor must not turn a thrown or
  reported cycle into a swallowed one.

## Non-goals

- No change to which edges count as gating, to rule ids, or to message text.
- No new dependency.
- Not moving the rest of the classifier or resolver (tracked separately, #54).

## Decisions needed (Clarify)

**DQ-1 - Fix the blunt substring guard now, or leave it?** The issue's "secondary" item.
- **Option A (rec) - leave the needle list alone; add only the structural import assertion
  (FR-7).** Smallest change and zero risk of loosening a guard. Cost: the comment-citation
  limitation persists, so provenance comments still cannot name the shared function.
- **Option B - replace the token match with a signature check** (a local function with
  the DFS shape and no corresponding shared import). Fixes the comment problem. Cost: a
  shape heuristic is easier to evade and harder to read than a literal, so the guard can
  silently weaken; it needs its own mutation tests, and it relaxes a guard the constitution
  says to keep.
- **Option C - strip comments before matching, keep the literals.** Allows citing names in
  prose, keeps the literal check on code. Cost: needs a comment stripper that must not
  mis-handle strings/template literals, else it hides real code.

**DQ-2 - Engine signature.** (rec) `(nodes: Iterable<string>, adj: ReadonlyMap<string,
readonly string[]>, compare)`, returning `string[][]` as the issue sketches; cost: each
caller keeps its own mapping of members to its report type. Alternative: a callback-based
`neighbours(id)` avoiding building a map; cost: callers lose the pre-sorted-adjacency
simplicity and the engine re-sorts per call.

**DQ-3 - Where traversal-order vs sorted members is decided.** (rec) Engine returns
traversal order; `detectCycles` sorts. Cost: one sort stays duplicated in the caller.
Alternative: return both; cost: a wider API for one caller's need.
