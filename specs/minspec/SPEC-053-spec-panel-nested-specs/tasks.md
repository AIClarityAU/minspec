---
id: SPEC-053
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-053 is T3.)
# status and phases here carry the current phase state. requirements.md stays frozen at its
# approved hash (approval sidecar under .minspec/approvals/), so its own phases lag. This file
# has no approval record of its own: these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-002  # Signpost Integrity
relates_to: [SPEC-040, SPEC-017, DR-003, DR-023, "#877", "#3255"]
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: pending
---

# SPEC-053 - Tasks

The order below is the order of work. Each task is one agent run and one pull request: one
concern, a few files, its own test. It names the requirement IDs it satisfies, the files it
touches, its prerequisites, and what an outside observer checks to call it done. The plan is
[design.md](design.md), whose Decisions section answers PQ1 to PQ7; the contract is
[requirements.md](requirements.md).

Every backticked path in this file is a file this change edits. No task creates a file:
requirements.md's `implements: none` rests on that, so every test goes in an existing suite. Files
a task only reads are named in prose, so the spec gate's ownership signal stays as narrow as the
change.

Tests key on symbols and paths, never on line numbers. Each test is written red first, then made
green in the same run, and the run's pull request quotes the red. All tasks are agent-landable and
none touches `.github/`. They run in sequence: tasks 3.1 and 4.1 share a test file.

## 1 - The listing key

- [ ] **1.1** (FR-1, AC-6, PQ1) `packages/minspec/src/lib/spec-catalog.ts`,
  `packages/minspec/tests/spec-catalog.test.ts` - in `listSpecs()`, key `byId` and `rolesById` on
  the id plus the location segment: the first path segment under `specsDir` of the entry's own
  location (the file for a flat entry, the directory for a spec-kit one), and none when that
  location sits directly in `specsDir`. Break sort ties on `filePath`.
  Test: `specs/a/SPEC-001-x/requirements.md` and `specs/b/SPEC-001-y/requirements.md` both listed,
  each with its own `filePath`; `requirements.md`, `design.md` and `tasks.md` in one directory stay
  one entry with both role flags true; a nested spec-kit directory stays one entry; top-level
  `SPEC-001-a.md` and `SPEC-001-b.md` stay one entry.
  *Prerequisites:* none.
  *Done when:* green, and the callers' suites (`spec-tree-provider`, `approve`, `validate`) pass
  unchanged.

## 2 - Trust chart

- [ ] **2.1** (FR-1, FR-2, FR-4b, AC-2, AC-6, SPEC-017 FR-11, PQ3) `packages/minspec/src/views/spec-panel.ts`,
  `packages/minspec/tests/trust-nondestructive.test.ts` - `buildTrustModel()` lists with
  `listSpecs(rootDir)`, importing it and `SpecSummary` from `lib/spec-catalog`. The label code is
  not touched. Add the `vi.mock('vscode')` and `vi.mock('../src/views/spec-panel-html')` shapes from
  design.md's Tests section.
  Test: on FR-4's fixture, `new SpecPanel().show(fixture)` gives `rework` an entry with the nested
  id, and a `status: superseded` nested fixture gets a `wasted` bar whose label starts with that id;
  the two-product fixture gives two `rework` entries; fixture bytes are unchanged.
  *Prerequisites:* 1.1.
  *Done when:* red on the prerequisite's base for the nested and two-product cases, green after, and
  the suite's existing cases pass unchanged.

## 3 - Migration

- [ ] **3.1** (FR-1, FR-3, FR-4c, FR-5, AC-3, AC-4, AC-5b, AC-6, INV-2, DQ-NEW-A, DQ-NEW-B, PQ2, PQ6)
  `packages/minspec/src/lib/spec-manager.ts`, `packages/minspec/src/lib/config.ts`,
  `packages/minspec/tests/spec-manager.test.ts` - add the private helpers `entryFromSummaryPath` and
  `entryParentDir` per design.md's Contracts. In `migrateLayout()`, list with `listSpecs(rootDir)`,
  take the entry from `summary.filePath` instead of `findSpecEntry()`, and join both target paths
  onto `entryParentDir(entry)`. Both collision guards and write-all-then-delete stay. Its doc comment
  gains the in-place sentence, and the `SpecsLayout` doc in `config.ts` gains AC-5b's wording.
  Test, in new `describe` blocks: for `specs/p/SPEC-NNN-x.md` and `specs/p/SPEC-NNN-x/requirements.md`,
  spec-kit counts the spec, the new representation is under `specs/p/`, `specs/` still lists only
  `p`, then flat gives back the frontmatter and every section byte-for-byte; the two-product fixture
  returns `migrated: 2` with each landing under its own product; a split spec migrates into a new directory inside its feature
  directory, leaves `design.md` and `tasks.md` unchanged, and `listSpecs()` still reports one entry with both role flags; a nested target
  that already exists returns `success: false`; top-level `SPEC-001-a.md` and `SPEC-001-b.md` return
  `success: false, migrated: 1` and warning `Target directory already exists: <dirName>`, the same
  result as on main, with the other file byte-identical at its path (PQ6(b); pins FR-5). After a flat
  entry is written for spec-kit, `migrateLayout()` checks the entry's own directory for another
  `SPEC-NNN-*.md` file with the same `id` and returns that result.
  *Prerequisites:* 1.1.
  *Done when:* green; the existing `migrateLayout()` suite passes with no edit to its lines;
  `scripts/check-import-cycles.ts` reports 0 runtime cycles; and the pull request body carries "re-run
  *Migrate Layout* if you ran it before this fix" (D-2).

## 4 - Deleting the shallow walk

- [ ] **4.1** (FR-1, FR-4a, FR-5, AC-1, AC-4, AC-5a, D-1, PQ5) `packages/minspec/src/lib/spec-manager.ts`,
  `packages/minspec/src/lib/artifact-graph.ts`, `packages/minspec/tests/spec-manager.test.ts`,
  `packages/minspec/tests/features.test.ts` - delete `listSpecsShallow()` (`SPEC_FILE_RE` stays, read by task 3.1's same-id check); sweep
  the `SpecSummary` doc comment and the near-namesake sentence in `artifact-graph.ts`. Repoint all 16
  test calls at `listSpecs()`, the four with a `filter` argument becoming `.filter(...)` with the
  same predicate and expected values, and rename the titles and the comment naming the dead function.
  Add AC-1's case: FR-4's fixture is in `listSpecs()`. It is green before and after (PQ5); tasks 2.1
  and 3.1 carry the red-to-green pair.
  *Prerequisites:* 2.1, 3.1.
  *Done when:* a search for `listSpecsShallow` under `packages/minspec/src` and `packages/minspec/tests`
  finds nothing; no assertion is removed or weakened, which the diff shows; and `npm test`, `npm run
  lint` and `npm run typecheck` pass.
