---
id: SPEC-053
type: design
status: planning
product: minspec
epic: EPIC-002  # Signpost Integrity
relates_to: [SPEC-040, SPEC-017, DR-003, DR-023]
implements: none
implements_reason: Plan document. Ownership stays as the approved requirements.md declares it (`implements: none`, the modified files named in AC-5); a second declaration here could drift from the hash-locked one. No `tier:` here on purpose - only requirements.md carries the tier (the SPEC-044 design-frontmatter note).
---

# SPEC-053 - Design: product-nested specs in the trust chart and Migrate Layout (Plan)

**Reads:** [requirements.md](requirements.md) (traces to #877, `listSpecsShallow` misses nested
specs). It is approved and hash-locked and this Plan never edits it. FR-1..FR-5, AC-1..AC-6 and
the decisions D-1, DQ-NEW-A, DQ-NEW-B and D-2 are settled there. This document is HOW only.
**Base:** every `file:line` below is `origin/main` at `d43f235a`. Some citations in
requirements.md have drifted: `listSpecsShallow()` is now `spec-manager.ts:437` (was `:408`),
`migrateLayout()` is `:639` (was `:616`), and its `findSpecEntry` call is `:650` (was `:621`).
**Dependency budget:** zero new dependencies.

## Measured on a prototype

The contract below was applied to a throwaway copy of `d43f235a` (never committed), the existing
suites were repointed, and a probe test was added:

| Measurement | Result |
|---|---|
| `migrateLayout()` suite, `spec-manager.test.ts:769-906`, unmodified | 5 of 5 pass |
| All 16 `listSpecsShallow(...)` calls (12 in `spec-manager.test.ts`, 4 in `features.test.ts`) repointed at `listSpecs()`, expected values unchanged | pass; `spec-manager`, `features` and `spec-catalog` run 90 of 90, as before |
| Import-cycle gate `scripts/check-import-cycles.ts` on the patched tree | 0 runtime cycles, 109 modules |
| Nested `SPEC-NNN-*.md` and nested `SPEC-NNN-*/requirements.md`, flat to spec-kit to flat | byte-identical to the original |
| Trust model over a nested fixture | `rework` lists the nested ids; the shallow listing on main returned only the one top-level spec |

The same probe produced the five Plan Questions at the end; each quotes its measurement.

## Components and seams

| # | File | Change | Serves |
|---|---|---|---|
| 1 | `packages/minspec/src/views/spec-panel.ts` | `:7` becomes `import { listSpecs, type SpecSummary } from '../lib/spec-catalog'`; `:110` types `specs` as `SpecSummary[]`; `:112` calls `listSpecs(rootDir)`. Nothing else in `buildTrustModel()` (`:102-144`) changes. | FR-1, FR-2 |
| 2 | `packages/minspec/src/lib/spec-manager.ts` | Add `import { listSpecs } from './spec-catalog'` after the `./spec-layout` import (`:18-23`). Delete `listSpecsShallow()` (`:432-485`) and `SPEC_FILE_RE` (`:90`, read only at `:461`). Add the two private helpers in Contracts beside `entryDisplayPath` (`:281-283`). In `migrateLayout()`: `:645` lists with `listSpecs(rootDir)`; `:650-651` (`findSpecEntry`, then `continue`) become `const entry = entryFromSummaryPath(summary.filePath)`; `:659` and `:671` join onto `entryParentDir(entry)` instead of `specsDir`. Both collision guards (`:660-667`, `:672-679`) and write-all-then-delete (`:687-694`) are unchanged. | FR-1, FR-3, D-1, DQ-NEW-A, DQ-NEW-B |
| 3 | same file, comments | `:52-53` (`SpecSummary`) says the optional fields stay unset outside `listSpecs()`, e.g. by `getSpec()`'s `buildSummary` (`:501`), dropping the deleted name. The `migrateLayout()` doc (`:630-638`) gains one sentence: each spec is rewritten in the directory that already holds it. | AC-5a, AC-5 |
| 4 | `packages/minspec/src/lib/artifact-graph.ts:195-198` | Delete the "Beware the near-namesake" sentence; it exists only to name the deleted function. | AC-5a |
| 5 | `packages/minspec/src/lib/config.ts:30-34` | Add to the `SpecsLayout` doc: both values describe the per-spec representation, not the depth of the tree, and a spec may sit under a product directory (`specs/<product>/...`). | AC-5b |
| 6 | tests | See Tests. | FR-4, FR-5, AC-1..AC-4, AC-6 |

`spec-catalog.ts:7` imports `SpecSummary` back from `spec-manager.ts` with `import type`, which
the cycle gate erases (`import-cycle-check.ts:243-274`). Seam 2's new import is therefore the only
runtime edge, and it stays inside `lib/` (SPEC-040 FR-1).

## Contracts

```ts
// packages/minspec/src/lib/spec-manager.ts - private, not exported.

/** DQ-NEW-A. The entry is the file listSpecs() reported, never re-resolved by id.
 *  Same classification listSpecs() itself makes (spec-catalog.ts:129-145): a spec.md
 *  whose directory passes isSpecKitDirEntry() is spec-kit; every other file is flat. */
function entryFromSummaryPath(filePath: string): SpecEntry;

/** DQ-NEW-B. The directory holding the entry: dirname of the file (flat) or of the
 *  directory (spec-kit). The new representation is written here, so a spec migrates
 *  in place. For an entry directly in specsDir this returns specsDir, which is
 *  today's path.join(specsDir, ...) exactly (FR-5). */
function entryParentDir(entry: SpecEntry): string;
```

Unchanged signatures: `migrateLayout(rootDir: string, target: SpecsLayout): MigrationResult`
(`spec-manager.ts:639`), `MigrationResult` (`:623-628`), `SpecEntry` (`:233-235`), and
`listSpecs(rootDir: string): SpecSummary[]` (`spec-catalog.ts:59`).

Where a spec lands (`s` is `slugify(title)`, as today):

| Entry | Target | Lands at |
|---|---|---|
| `specs/<p>/SPEC-NNN-x.md` | spec-kit | `specs/<p>/NNN-s/` |
| `specs/<p>/NNN-x/spec.md` | flat | `specs/<p>/SPEC-NNN-s.md` |
| `specs/<p>/SPEC-NNN-x/requirements.md` (FR-4's fixture) | spec-kit | `specs/<p>/SPEC-NNN-x/NNN-s/` (siblings: PQ2) |
| `specs/<p>/SPEC-NNN-x/requirements.md` | flat | skipped, already flat by shape (`:652`) |
| any entry directly in `specs/` | either | where it lands today |

## Tests

The T0 and T3 tests land first, in the same PR, before the implementation commit.

**New file `packages/minspec/tests/spec053-nested-specs.test.ts`** (named like
`spec016-links.test.ts`). Real fs under `os.tmpdir()`. `vi.mock('vscode')` supplies
`window.createWebviewPanel` and `workspace.getWorkspaceFolder` (read by `folderForFile`,
`resolve-folder.ts:119-124`); `vi.mock('../src/views/spec-panel-html')` captures `getHtml`'s third
argument, the `TrustChartModel` (`spec-panel.ts:85-87`). `spec-panel-class.test.ts` cannot host
these cases because it mocks `fs` wholesale (`:63-65`).

| Case | Asserts | For | Red on main |
|---|---|---|---|
| listing | FR-4's fixture `specs/p/SPEC-007-x/requirements.md` is in `listSpecs()` | AC-1 | no, see PQ5 |
| trust chart | `new SpecPanel().show(fixture)` gives `rework` an entry `SPEC-007`; a `status: superseded` nested fixture gets a `wasted` bar (label: PQ3); fixture bytes unchanged | AC-2, SPEC-017 FR-11 | yes |
| migration | for both nested shapes, `migrateLayout(root, 'spec-kit')` counts the spec, the new representation is under `specs/p/`, and `specs/` still lists only `p`; then `'flat'` gives back the frontmatter and every section byte-for-byte | AC-3, INV-2 | yes |
| duplicate id | `specs/a/SPEC-001-*/requirements.md` and `specs/b/SPEC-001-*/requirements.md`, through the trust chart and migration | AC-6 | expected outcome: PQ1 |

**Repoints.** In `spec-manager.test.ts`, the 12 calls (`:290`, `:298`, `:311`, `:315`, `:325`,
`:334`, `:345`, `:356`, `:370`, `:610`, `:690`, `:720`) call `listSpecs(x)`. The four that pass a
`filter` argument (`:311`, `:315`, `:325`, `:334`) become `listSpecs(x).filter(...)` with the same
predicate and the same expected values, because D-1 deletes the `filter` parameter. Titles and the
comment naming the dead function (`:278`, `:357`, `:687`, `:696`) name `listSpecs()` instead. The
`migrateLayout()` suite is not edited (AC-4). `features.test.ts` (`:21`, `:117`, `:155`, `:165`,
`:169`) gets the same treatment: FR-5 does not name it, but it imports the deleted function, so
AC-5a requires it.

## Invariants

- **Offline (constitution 1).** Filesystem only; the one new import is `lib` to `lib`.
- **No silent gate (constitution 2).** Both collision guards stay and now test the in-place
  target, so a nested spec whose target already exists still returns `success: false` with a
  warning.
- **Lossless migration (INV-2).** Re-proved on both nested shapes by the migration case, not
  inherited.
- **Non-destructive trust chart (SPEC-017 FR-11).** `buildTrustModel()` changes only its listing
  call; the trust-chart case asserts the fixture bytes are unchanged.
- **`lib` layering (SPEC-040 FR-1).** See the cycle-gate note under Components.

## Build order

1. The nested-coverage tests commit (red on main for the trust-chart and migration cases).
2. The listing-swap commit: seams 1 to 5 and the repoints. Both callers move in the commit that
   deletes `listSpecsShallow()`, because splitting them leaves the tree uncompilable.
3. The duplicate-id case lands once PQ1 is answered, and any sibling handling once PQ2 is.
4. The PR body carries D-2's line: "re-run *Migrate Layout* if you ran it before this fix".

## Plan Questions

Each one is **NOT decided - needs the founder via Clarify.**

**PQ1 - AC-6's test-only branch cannot pass, so how should the collapse be keyed?** Measured: with
`specs/a/SPEC-001-x/requirements.md` and `specs/b/SPEC-001-y/requirements.md`, `listSpecs()`
returns only the `a` file (the tie at `spec-catalog.ts:106` keeps the first one seen), and
`migrateLayout(root, 'spec-kit')` returns `success: true, migrated: 1` with `b` untouched. A test
pinning that neither is dropped is red against the unchanged `listSpecs()`. Only AC-6's second
branch can turn it green, and that branch changes `listSpecs()` (the Out-of-scope exception).
- (a) **(rec)** Key `byId` (`spec-catalog.ts:68`) and `rolesById` (`:82`) on the id plus the path
  half of `collectSpecs`'s product rule, computed from the entry's own location (the file for a
  flat entry, the directory for a spec-kit one): the first segment under `specsDir` when nested,
  none when directly in it (`spec-manager.ts:135`, `:158`). Siblings share a directory, so one
  spec never splits, and entries directly in `specsDir` key on the id alone, as today. Cost:
  `listSpecs()` changes for its five other callers (`approve.ts:58`, `approve-active.ts:121`,
  `validate.ts:34`, `spec-tree-provider.ts:416`, `extension.ts:784`), which would show two
  `SPEC-001` rows where they show one today. No such duplicate exists in this repo, so the change
  is latent.
- (b) Key on `collectSpecs`'s full rule, `product:` frontmatter first (`spec-manager.ts:121-136`).
  Cost: a `requirements.md` whose `product:` differs from its directory splits from its own
  `design.md`, and the `design.md` files of SPEC-039 and SPEC-050 already carry no `product:`.
- (c) Amend AC-6 to pin the drop instead. Cost: it keeps the silent-omission path AC-6 exists to
  close.

**PQ2 - What happens to a feature directory's `design.md` and `tasks.md` when its
`requirements.md` migrates?** Measured: `specs/p/SPEC-010-split/{requirements,design,tasks}.md`
migrated to spec-kit returns `success: true, migrated: 1` and leaves `design.md` and `tasks.md`
beside the new `SPEC-010-split/010-split/`. `listSpecs()` then reports the spec at the new
`spec.md`, because `spec-catalog.ts:69-73` ranks `spec.md` above `design.md`. Nothing is deleted,
but the spec now spans two representations. This repo uses exactly this layout, and D-1's listing
change is what first lets `migrateLayout()` reach it. DQ-NEW-B settled where the spec lands, not
what happens to its siblings. The contract as written is (a).
- (a) **(rec)** Leave the siblings in place. Cost: a spec-kit migration of a split-layout tree
  leaves each spec divided between its new directory and its old `design.md` and `tasks.md`.
- (b) Refuse visibly: a directory holding a same-id `design.md` or `tasks.md` is not migrated,
  and `migrateLayout()` returns `success: false` naming it. Cost: a refusal the requirements do
  not name, and this repo's own tree would refuse. AC-3's fixture, a `requirements.md` alone,
  still migrates.
- (c) Fold the siblings in (`design.md` to `plan.md`, `tasks.md` to `tasks.md`). Cost: a new
  conversion outside SPEC-040's round-trip invariant, which needs its own lossless proof.

**PQ3 - AC-2's `wasted` entry is labelled by path, not by spec id.** `spec-panel.ts:134-137`
labels each bar with the first path segment matching `/^SPEC-\d/`, else the last segment, and
`renderTrustChart` prints that label (`packages/shared/src/trust-model.ts:182`). Measured labels:
top-level flat `SPEC-001-flat.md`, nested split `SPEC-008-old`, nested spec-kit `spec.md`. After
the swap the nested spec's bar is present, but its label is never its id, while AC-2 asks for "an
entry for the nested spec's id".
- (a) **(rec)** Leave the label code alone, and have the test find the nested bar by its path
  label. Cost: AC-2's `wasted` half is read as "an entry for the nested spec", and every spec-kit
  bar still reads `spec.md` (pre-existing).
- (b) Label each bar with its spec's id, mapping `specPath` back through the `specs` list already
  in hand. Cost: flat-layout charts change label (`SPEC-001-flat.md` to `SPEC-001`), which FR-5
  forbids, so FR-5 would need amending.

**PQ4 - FR-5's "identical" does not hold for two top-level shapes.** Measured on a top-level tree
of `SPEC-001-legacy.md`, `002-kit/` and `requirements.md` (`id: SPEC-003`): the shallow listing on
main returns `[SPEC-002, SPEC-001]`, and `listSpecs()` returns `[SPEC-001, SPEC-002, SPEC-003]`.
`listSpecs()` admits any `.md` carrying an `id:` where the shallow walk required a `SPEC-NNN-*.md`
name (`spec-manager.ts:461`), and it sorts by id (`spec-catalog.ts:161`) where the shallow walk
sorted directory entries (`spec-manager.ts:444`). Pure flat and pure spec-kit trees are
unaffected: every repointed assertion and the `migrateLayout()` suite pass unchanged.
- (a) **(rec)** Accept it: FR-2 requires parity with `listSpecs()`, and D-1 chose it. Cost: a
  top-level tree mixing flat and spec-kit specs sees its bars reordered, and a top-level spec file
  not named `SPEC-NNN-*.md` newly appears in the chart and is newly migrated.
- (b) Reproduce the shallow selection and order at the two call sites. Cost: a second selection
  rule, the two-implementations shape D-1 rejected.

**PQ5 - AC-1's "red on main" cannot come from a `listSpecs()` test.** `listSpecs()` already
recurses on main (`spec-catalog.ts:146-147`), and `spec-catalog.test.ts:75-84` already pins a
nested spec, so any test calling it is green on main.
- (a) **(rec)** Keep AC-1's assertion as a `listSpecs()` case on FR-4's fixture, and let the
  trust-chart and migration cases carry the red-on-main, green-after pair. Those cases go through
  the two repointed callers and are red on main (measured: the shallow listing returned only the
  top-level spec of the trust-chart fixture). Cost: AC-1's own case proves coverage, not the fix.
- (b) Add a case asserting that `spec-manager.ts` no longer exports `listSpecsShallow`. Cost: a
  source-shape assertion, which stays green if a caller regains a shallow walk under another name.

## What this design does not do

- Touch `findSpecEntry()` or `getSpec()`. They are out of scope, tracked as #1452 (`getSpec`
  blind to product-nested specs).
- Change `lib/spec-catalog.ts`, unless PQ1 is answered (a) or (b).
- Change `commands/migrate.ts`. Its QuickPick examples (`specs/SPEC-NNN-slug.md`) show the
  per-spec shape, which is the reading AC-5b gives `flat`.
- Edit DR-064 or SPEC-040's documents, which still mention `listSpecsShallow`. They record what
  was true, they are not comments or exported surface, and SPEC-040's approved files are
  hash-locked.
- Change CI, merge gates, `.github/`, `scripts/`, `.githooks/`, `.minspec/`, any config key, or
  any other spec's approved behaviour.
