---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - one definition of "boundary" so the two gates that enforce it cannot drift
aspects: [boundary, auto-merge, dispatch, shared, tier-0, no-silent-gate, blast-radius, agreement-test]
depends_on: [DR-070, DR-074]  # DR-070 names this promotion as a follow-up and as the deny set its P6 predicate imports; DR-074 the blast-radius rule
relates_to: [DR-066, DR-086, SPEC-044, "#1003", "#981", "#1001", "#1758", "#1264", "#422", "#490", "#1614"]
# Ownership declared in Specify (SPEC-038). New: the shared module and the agreement test.
# Modified, not owned: the merge-side gate that imports it, and the two bash/TS definitions it retires.
implements: [packages/shared/src/boundary-paths.ts, packages/shared/tests/boundary-agreement.test.ts]
affects: [packages/shared/src/index.ts, scripts/auto-merge-gate.ts, scripts/dispatch-issue.sh]
---

# SPEC-137: One boundary catalog, two gates, one agreement test

Issue: #1003 (promote the boundary-path catalog to `@aiclarity/shared`). Rationale: DR-070
(its "Promote the boundary catalog" follow-up, and P6's "imported, not re-listed" deny set).
Related: #981 (`sites/**` missing from the merge-side withhold), #1001 (outward-facing `.md`
certified low-blast).

**Scope sentence.** Move the boundary-path catalog out of `scripts/auto-merge-gate.ts` into one
Tier-0 module in `@aiclarity/shared`, make every consumer read it, and add a deterministic test that
fails when the dispatch-side withhold and the merge-side gate disagree on any catalogued path.

## Current state (verified against `origin/main` at 5f792386)

- `scripts/auto-merge-gate.ts` holds `MANIFEST_BASENAMES` (line 499), `BOUNDARY_ROOT_BASENAMES`
  (581), `BOUNDARY_CONFIG_BASENAMES` (654), plus unexported `BOUNDARY_GOVERNANCE_PATHS` and the
  `tsconfig*.json` rule, and exports `isBoundaryPath` (675). `BOUNDARY_DIR_PREFIXES` /
  `BOUNDARY_SINGLE_FILES` are already derived from `packages/minspec/src/lib/machinery-paths.ts`
  (#1758).
- `scripts/dispatch-issue.sh` (`paths_have_approvable_doc`, ~line 330) is a **bash regex**
  union of `DOCS_CORPUS_RE`, `.minspec/`, `.cursorrules`, `PUBLISH_PATH_RE`, `MACHINERY_PATH_RE`.
  It cannot import TypeScript; `MACHINERY_PATH_RE` is a hand copy pinned by
  `packages/minspec/tests/machinery-paths.test.ts`. Nothing pins the rest of the withhold
  against `isBoundaryPath`.
- `packages/shared` has no boundary module (barrel: canonical, rework, trust-model,
  review-signals, next-task, project-prefix).
- DR-070's text predates #1758: the machinery half of the catalog is already shared **inside
  `packages/minspec`**; what remains unshared is the manifest / root-basename / config-basename /
  governance / tsconfig half, and `isBoundaryPath` itself.

## Functional requirements

- **FR-1 One module.** `packages/shared/src/boundary-paths.ts` exports `isBoundaryPath`,
  `MANIFEST_BASENAMES`, `BOUNDARY_ROOT_BASENAMES`, `BOUNDARY_CONFIG_BASENAMES`, and the
  governance-path set and `tsconfig*.json` rule `isBoundaryPath` needs, re-exported from the
  `@aiclarity/shared` barrel. Pure, no `vscode`, no `node:fs`, no network (invariant 1; shared is Tier 0).
- **FR-2 Machinery inputs come from one place.** The module must not re-list the machinery
  directory prefixes / single files. Either `machinery-paths.ts` moves into shared too, or shared
  receives them without a back-edge to `packages/minspec` (shared must not depend on the extension).
  Which of the two is open question Q1.
- **FR-3 Behaviour-preserving move.** `isBoundaryPath` returns the same result as today for every path
  in the existing tests (`auto-merge-gate.test.ts`, `autonomy-setting-boundary.test.ts`,
  `machinery-paths.test.ts`). No path changes class in this spec's move.
- **FR-4 Consumers import, do not copy.** `scripts/auto-merge-gate.ts` imports the module and
  deletes its local definitions. Anything else that wants "is this a boundary path" (DR-070 P6's
  `auto-dispatch-check`) imports the same symbol.
- **FR-5 Dispatch-side withhold is derived or pinned, never independent.** `dispatch-issue.sh` cannot
  import TS, so its withhold regex must be either (a) generated from the shared catalog and checked
  in, with a test pinning it byte-for-byte (the #1758 pattern), or (b) replaced by a call into a
  small TS entry point the script shells out to. Open question Q2.
- **FR-6 Agreement test (T0).** `packages/shared/tests/boundary-agreement.test.ts` builds the
  catalogued path list from the shared module itself (every directory prefix, single file,
  basename, governance path, a `tsconfig*.json` sample, plus nested-occurrence variants such as
  `packages/x/package.json`) and asserts, for each path, that the pre-dispatch withhold
  (`dispatch-issue.sh --paths-have-approvable-doc`) answers hold whenever `isBoundaryPath` is true.
  Direction and exceptions are Q3. A path that is boundary on one side only fails with the path named.
- **FR-7 Fails closed and visibly.** The test must fail when the catalog is empty, when the bash
  seam cannot be run, or when it returns neither `hold` nor `arm` (a missing witness is a failure,
  never a skip; constitution invariant 2). A control case proves the test can go red: a deliberately
  uncatalogued path must classify non-boundary on both sides.
- **FR-8 Close the two named holes as inputs, not scope.** #981 (`sites/**`) and #1001
  (outward-facing `.md`) are separate fixes; this spec only guarantees that once either lands in
  the catalog, the agreement test covers it automatically (no second list to forget).

## Acceptance criteria

- AC-1: `grep -n "MANIFEST_BASENAMES\|BOUNDARY_ROOT_BASENAMES\|BOUNDARY_CONFIG_BASENAMES" scripts/`
  shows only imports, no definitions.
- AC-2: Adding a basename to the shared catalog without updating the dispatch side turns the
  agreement test red, naming the path.
- AC-3: Removing a path from the dispatch regex only turns the agreement test red.
- AC-4: Existing `auto-merge-gate`, `autonomy-setting-boundary`, `machinery-paths` and
  `dispatch-automerge-*-exclusion` tests pass unchanged.
- AC-5: `@aiclarity/shared` builds with no import from `packages/minspec` and no Node-only API
  beyond `path`-free string handling (basename done by string split, not `node:path`, unless Q4 allows).
- AC-6: `npm test`, `npm run validate`, `npm run lint` pass.

## Invariants this change must not break

- Constitution 1 (offline): no network in the module or test.
- Constitution 2 (no silent gate): the second witness (dispatch withhold) stays independent of
  ai-review; this spec adds a third check that they agree, it must not make the withhold depend on
  the merge-side gate at runtime.
- Constitution 3 (blast radius): nothing here changes behaviour in an adopter repo; the catalog is
  this repo's, and the shipped `machinery-paths` generator paths are unchanged.
- Deny-by-default (#422/#490): erring toward boundary stays the rule; the move must not narrow any set.
- `isBoundaryPath` stays pure and synchronous.

## Out of scope

Adding `sites/**` or outward-facing docs to the catalog (#981, #1001); the DR-070 §2
`auto-dispatch-check.sh` predicate; changing `DOCS_CORPUS_RE` ownership; any DR.

## Decisions needed (Clarify)

- **Q1: where do the machinery prefixes live?**
  (a) Move `machinery-paths.ts` into `@aiclarity/shared` and re-export from minspec **(rec)** —
  one definition and no back-edge; cost: touches a file the ai-review self-edit guard lists as
  machinery context, so the PR needs human `--admin` merge.
  (b) Shared takes them as a parameter — no move, but every caller must pass them, which is a
  second place to forget.
- **Q2: how does the bash side stay in step?**
  (a) Generated regex checked in + byte-for-byte pin **(rec)** — proven pattern (#1758), stays offline and
  fast; cost: still a hand-copy a human can edit, caught only by the test.
  (b) `dispatch-issue.sh` shells to `npx tsx` for the answer — truly one definition; cost: a
  Node startup on a path that runs on every dispatch, and a new failure mode that must fail closed.
- **Q3: what does "agree" mean?** Issue says "identically". The dispatch withhold is deliberately
  a **superset** (docs corpus, `.minspec/`, publish paths are withheld but not `isBoundaryPath`).
  (a) One-way: every boundary path is withheld **(rec)** — matches the documented superset; cost:
  a bash-only extra is not checked against anything.
  (b) Exact equality — needs the extras split into a separately named set on the merge side; cost:
  larger change, may alter merge-side behaviour (violates FR-3).
- **Q4: `node:path` in shared?** shared is Tier 0 but other modules may use it. Allow `node:path`
  **(rec)** for fidelity with today's `path.basename`; cost: weakens a "pure string" shared guarantee
  if shared is ever bundled for a webview.
