---
id: SPEC-125
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-004  # Classifier Validation - same epic as SPEC-023, whose deferred FR-1 this completes
aspects: [classifier, consequence-axis, impact-reach, reference-index, tier-0, offline, performance, validation-gated]
relates_to: [SPEC-023, SPEC-024, SPEC-004, SPEC-040, DR-021, DR-022, DR-024, DR-033, DR-058, DR-064, DR-066, "#195", "#91", "#88", "#90"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3). All
# five files are NEW. Names are the Specify-phase proposal; Plan may rename them, which is an
# edit made before approval of design.md, not after approval of this file.
implements: [packages/minspec/src/lib/reference-index.ts, packages/minspec/src/lib/reference-index-loader.ts, packages/minspec/tests/reference-index.test.ts, packages/minspec/tests/reference-index-loader.test.ts, packages/minspec/tests/impact-reach.test.ts]
# Modified, not owned. No spec lists any of these under `implements:` (grepped across
# specs/*/SPEC-*/requirements.md on 2026-10-03). packages/minspec/package.json is touched only
# under DQ-1 Option B or C (a shipped parser dependency); scripts/auto-merge-gate.ts only under
# DQ-4 Option B.
affects: [packages/minspec/src/lib/consequence-analyzers.ts, packages/minspec/src/lib/git-analyzer.ts, packages/minspec/src/lib/auto-merge.ts, packages/minspec/src/lib/config.ts, packages/minspec/src/commands/classify.ts, packages/minspec/tests/consequence-analyzers.test.ts, packages/minspec/tests/signal-names-parity.test.ts, packages/minspec/tests/classifier-validation.test.ts, packages/minspec/package.json]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-125: A real cross-file reference index for impact-reach

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. It is the
> Specify-phase artifact for [#195](https://github.com/AIClarityAU/minspec/issues/195),
> which triage held at T3/T4 (full ceremony). A human reads it, answers the five questions
> under [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the
> normal spec-approval gate before any code changes. Every requirement below is written
> under each decision's recommended option, so approving the spec as it stands accepts those
> recommendations. Choosing a different option changes only the requirements that decision
> names.

Materializes **[#195](https://github.com/AIClarityAU/minspec/issues/195)** - *"real
cross-file reference/call-graph index for impact-reach (SPEC-023 FR-1 full form)"*. It is
the follow-up that [SPEC-023](../SPEC-023-consequence-screen/requirements.md) (consequence
screen) deferred in its Clarification C2 and listed under its Follow-ups.

**Rests on:** [DR-022](../../../docs/decisions/DR-022.md) §1 (the always-on consequence
axis; status `proposed`), [DR-024](../../../docs/decisions/DR-024.md) Decision point 2 (the
reach model is gated on the reach-validation study,
[#91](https://github.com/AIClarityAU/minspec/issues/91)),
[DR-021](../../../docs/decisions/DR-021.md) (the tier is an upward-only floor), and
[DR-066](../../../docs/decisions/DR-066.md) (no silent gate).

**Id note.** 124 was the highest spec number on any remote-tracking branch or local
worktree when this was written (2026-10-03, checked across 294 remote refs and 363
worktrees from local refs only; this dispatch has no network, so pull requests opened since
the last fetch are not visible). If `SPEC-125` collides at review time, renumber.

**Tier note.** T4 (complete ceremony), matching SPEC-023. The change adds two modules,
alters what the classifier core can output, and under the recommended engine adds a shipped
runtime dependency.

## One-Sentence Scope

Build a bounded, cached, offline index of which modules import which exported symbols, feed
it to the impact-reach analyzer as `ConsequenceInput.refIndex`, and have that analyzer
report a measured count instead of the `reach_unavailable` marker - **off by default until
#91 (reach validation) passes**.

## Context - what the code does today

Read from this branch at `350c6fa4`, not inferred.

- **The contract exists and has no implementation.** `ReferenceIndex` is declared with three
  methods - `callerCount`, `reachCount`, `exportedSymbolsOf`
  (`packages/minspec/src/lib/consequence-analyzers.ts:39`). Nothing implements it: the only
  values ever assigned to `refIndex` in source are `null`
  (`packages/minspec/src/lib/git-analyzer.ts:310`, `:386`;
  `scripts/auto-merge-gate.ts:1007`), and the only test that passes one defaults it to `null`
  (`packages/minspec/tests/consequence-analyzers.test.ts:42`).
- **The analyzer has an empty real branch.** `impactReachAnalyzer` emits
  `reach_unavailable` (degraded, `T1`) when `refIndex === null` and returns `[]` otherwise
  (`consequence-analyzers.ts:112`). So handing it a real index today would make the reach
  signal *disappear*, not become real.
- **A second analyzer keys its honesty on the same field.** `sensitiveSinkAnalyzer` sets
  `degraded: input.refIndex === null` (`consequence-analyzers.ts:476`) and words its
  `explain` to match. It performs no transitive analysis in either case. The moment a
  non-null index is supplied, that signal would stop saying "direct match only" while still
  being a direct match only. See FR-14.
- **The editor path** builds the input and runs the analyzers at
  `packages/minspec/src/commands/classify.ts:90`. A failure anywhere in that block is
  swallowed and size signals classify alone (`classify.ts:95`).
- **The merge gate reads the same vocabulary.** `auto-merge.ts` recognises
  `reach_unavailable` by name (`packages/minspec/src/lib/auto-merge.ts:159`), treats every
  unrecognised signal name as high blast, and has `reachKnownLow` hard-wired to `false`
  (`auto-merge.ts:299`). A T0 test binds every name the analyzers emit to that recognised
  set (`packages/minspec/tests/signal-names-parity.test.ts`). A new signal name is therefore
  a cross-module contract change, not a local one.
- **An import-graph builder already exists, as dev tooling.**
  `packages/minspec/src/lib/import-cycle-check.ts:553` (`buildValueImportGraph`, SPEC-040
  FR-2) parses every module with `ts.createSourceFile` (`:561`), resolves specifiers, and
  throws rather than returning a partial graph. Its header states that nothing in the
  extension's runtime graph imports it, "so the `typescript` dependency never reaches the
  packaged VSIX". The extension ships three runtime dependencies today
  (`packages/minspec/package.json:634`: `@aiclarity/shared`, `handlebars`, `simple-git`).

### Reality-check - three premises in #195 that need correcting

1. **"Call-graph" overstates what a cheap engine can measure.** Counting *call sites* needs
   type-aware resolution (which `foo` is this `foo()`?). Counting *importing modules* does
   not. This spec defines the metric as importing modules (FR-4) and requires the wording
   shown to the user to say so (FR-13). The contract's method name `callerCount` is kept for
   continuity; its meaning is pinned in FR-4. DQ-1 Option C is the only engine that could
   count call sites.
2. **The existing validation corpus cannot measure this index.** #195 says to validate
   reach "as diff-size was". The diff-size study's corpus
   (`scripts/classifier-validation/labels.json`) is 120 instances across 11 repositories,
   **every one of them Python** (django 58, sympy 13, sphinx 11, scikit-learn 8, matplotlib
   8, astropy 6, xarray 5, pytest 5, pylint 3, requests 2, seaborn 1 - counted from the
   file). Each instance carries only a patch, not the surrounding repository
   (`scripts/classifier-validation/fetch-swebench.mjs:94`). The shipped content analyzers
   cover JavaScript and TypeScript only (`consequence-analyzers.ts:83`). So a JS/TS index
   scores zero on that corpus for two independent reasons: wrong language, and no tree to
   index. #91 cannot pass by re-running the existing harness. See DQ-2.
3. **"Do NOT enable real reach until #91 passes" needs the index to exist first.** #91
   validates a measurement; the measurement has to be producible before it can be validated.
   The gate is therefore on the *default*, not on the build (FR-11, DQ-3).

## Definitions

- **Module** - one source file inside the index's language scope and file universe (FR-8).
- **Symbol** - one exported binding of a module, addressed as `SymbolRef { name, filePath }`
  (`consequence-analyzers.ts:29`). A default export has the name `default`.
- **Importer of a symbol** - a module other than the declaring one that imports that symbol
  by name, or imports the declaring module in a form whose bindings cannot be attributed to
  individual symbols (FR-5). Re-exports are transparent: a module importing the symbol
  through a re-exporting module is an importer of the original symbol.
- **Direct count** (`callerCount`) - the number of distinct importers of a symbol.
- **Transitive count** (`reachCount`) - the number of distinct modules in the reverse
  closure: the importers, plus every module that imports any module already in the set,
  followed at module granularity.
- **Coverage** - the index's own account of what it could not see (FR-6).

## Scope

### In scope

- A pure index builder and an IO loader with bounds, caching and coalescing (FR-1 to FR-10).
- The on/off switch, default off, pinned by a test (FR-11).
- Wiring the index into `buildConsequenceInput` and the classify command (FR-12).
- The real branch of `impactReachAnalyzer` (FR-13).
- Keeping `sensitiveSinkAnalyzer` honest once `refIndex` is non-null (FR-14).
- Registering the new signal names with the auto-merge recogniser, with eligibility
  unchanged (FR-15).
- Letting the validation harness obtain reach measurements (FR-16).

### Out of scope

- **Turning reach on by default.** Owned by #91 passing; a separate, deliberate change.
- **The acceptance thresholds for the reach model.** Owned by #91. This spec ships
  placeholder values only so the opt-in path functions (FR-13).
- **Widening auto-merge.** `reachKnownLow` stays `false`; no change makes a pull request
  eligible that is not eligible today (FR-15, DQ-4).
- **Transitive sensitive-sink reach** (SPEC-023 FR-4's indexed form). FR-14 only stops the
  existing signal from overstating itself.
- **A persistent on-disk cache.** The cache is in-memory (FR-9).
- **Languages other than JavaScript and TypeScript** (DQ-2).
- **The `tier` to risk-profile data-model migration**
  ([#90](https://github.com/AIClarityAU/minspec/issues/90)).
- **Moving `classify()` or the analyzers into `packages/shared`** (SPEC-023 C1 stands).

## Functional Requirements

### The index

- **FR-1 Pure builder.** A single function builds an immutable index from in-memory data:
  a list of `{ path, content }` modules plus resolution inputs (FR-3). It imports no
  `vscode`, performs no disk, git or network IO, and invokes no AI. Given the same inputs in
  any order it returns an index that answers every query identically.
- **FR-2 Module scanning.** For each module the builder extracts, at minimum: named exports,
  the default export, named re-exports (`export { a } from`), wildcard re-exports
  (`export * from`), named imports, default imports, namespace imports (`import * as`),
  side-effect imports, type-only imports and exports, `require()` and dynamic `import()`
  calls whose specifier is a string literal. Type-only edges **are** counted (a signature
  change reaches a module that imports only the type); this differs deliberately from the
  SPEC-040 cycle gate, which counts runtime edges only. Scanning sits behind a per-language
  seam so a second language can be added without changing the builder or its consumers.
- **FR-3 Specifier resolution.** Resolved in-repo: relative specifiers with extension and
  directory-index probing, and workspace-package specifiers matched by the `name` of a
  `package.json` inside the file universe. A specifier that names no in-repo module and is
  a bare package name is **external** and contributes nothing. Every other specifier that
  fails to resolve is recorded as **unresolved** with its file and specifier - never
  dropped (FR-6). Whether `tsconfig` `paths`/`baseUrl` aliases are resolved or left to fall
  into "unresolved" is a Plan-phase choice; either is acceptable because both are honest.
- **FR-4 Metrics.** `callerCount(symbol)` returns the direct count and `reachCount(symbol)`
  the transitive count, exactly as defined above. Both follow re-export chains
  transparently, both exclude the declaring module itself, and both terminate on cyclic
  import graphs. `exportedSymbolsOf(filePath)` returns the module's own exported symbols in
  a stable order. For every symbol, `callerCount` is at most `reachCount`.
- **FR-5 Unattributable imports count conservatively.** A namespace import, a side-effect
  import, a `require()` or dynamic `import()` of a module, and a wildcard re-export each
  count as an import of **every** exported symbol of the target module. The index may
  over-count; it must not under-count through a form it recognised but could not attribute.
- **FR-6 The index reports its own blind spots.** The index exposes a coverage record: the
  number of modules indexed, the modules skipped and why (FR-7), the unresolved specifiers
  (FR-3), and the modules that failed to parse. It exposes a single `complete` boolean that
  is `true` only when all three lists are empty. A query for a symbol or file the index does
  not contain returns "unknown", distinguishable from zero - it never returns `0`. (This
  revises the SPEC-023 sketch, where the methods return a bare `number`; the interface has no
  implementer, so the revision breaks nothing. See Contract.)
- **FR-7 Bounded.** The build is bounded on four axes, each a named constant: maximum module
  count, maximum bytes per module, maximum total bytes, and a wall-clock budget. Exceeding
  the module-count, total-bytes or wall-clock bound aborts the build and yields **no index**
  (the caller degrades, FR-13); exceeding the per-module bound skips that module and records
  it in coverage. Closure traversal is iterative with a visited set. Proposed starting
  values, **unmeasured** and to be replaced in Plan by figures measured on this repository
  (504 tracked `.ts`/`.tsx` files) and one larger one: 5,000 modules, 1 MB per module, 5 s
  cold build.

### Loading, caching, coalescing

- **FR-8 File universe and view.** The loader - the only place this feature touches disk or
  git - enumerates modules from the repository's tracked files plus any untracked files
  present in the diff being classified, filtered to the language scope. Ignored and
  untracked-but-unrelated files (dependencies, build output) are thereby excluded without a
  hand-kept exclusion list. Content is read from the same view the classification uses
  (staged or working tree, `classify.ts:69`). Modules the diff **deletes or renames** are
  measured at their pre-change path, so that importers still pointing at the old path are
  counted rather than landing in "unresolved".
- **FR-9 Cached in memory, invalidated by content.** Within one extension session the
  loader keeps the last index and reuses per-module scan results whose content is unchanged
  (compared by content, not by timestamp alone). A change to any resolution input (FR-3)
  discards the whole cache. Nothing is written to disk: no cache file, and in particular
  nothing under `.minspec/` (constitution invariant 3; SPEC-096's single-creator rule is not
  engaged because there is no write).
- **FR-10 Coalesced and off the activation path.** No index work happens at extension
  activation (constitution constraint 3). The first build is triggered by the first
  classification that needs it. Concurrent requests share one in-flight build rather than
  starting a second. A build that is still running when its wall-clock budget expires is
  abandoned and that classification degrades (FR-13); it does not block the status-bar
  result of the on-commit classification.

### Gating and wiring

- **FR-11 Off by default, pinned.** One configuration switch, read from
  `.minspec/config.json`, with two values: off and on. The default is **off**. With the
  switch off, no index is built, `refIndex` is `null`, and every output of the classify
  command and of `runConsequenceAnalyzers` is byte-identical to today's. A T0 test asserts
  the default is off and names #91 in its failure message, so flipping the default requires
  editing that test in the same change - a deliberate, reviewable act rather than a drifted
  constant.
- **FR-12 Wiring.** With the switch on, `buildConsequenceInput` obtains the index from the
  loader and places it in `ConsequenceInput.refIndex`. The analyzers stay pure: they receive
  the index as data and never trigger a build. The merge-gate script continues to pass
  `refIndex: null` (DQ-4).
- **FR-13 The impact-reach analyzer measures or says it could not.** With a non-null index:
  1. *Which symbols changed.* For each changed module in language scope, the analyzer
     determines the exported symbols whose declaration text differs between `oldContent`
     and `content`. When it cannot attribute the change to specific exported symbols (a
     change to a non-exported helper, missing `oldContent`, an engine that cannot delimit
     declarations), it treats **every** exported symbol of that module as changed. The
     fallback is an upper bound on the attributed result, never a lower one.
  2. *What it emits.* Exactly one signal named `impact_reach`, `axis: 'consequence'`, whose
     `value` is the largest direct count among the changed symbols and whose `explain`
     names that symbol, its direct count and its transitive count, in the words "imported
     by N modules" - never "N callers".
  3. *Tier contribution.* Taken from one exported threshold table mapping direct count to a
     tier. The table's values are **placeholders owned by #91**; the proposed placeholders
     are no floor below 5 importers, `T2` from 5, `T3` from 20, `T4` from 50 (DQ-5). A count
     below the lowest threshold contributes `T1`, which cannot raise a tier.
  4. *Partial knowledge is marked.* When the index's coverage is not `complete`, or a
     changed symbol is "unknown" to it, the signal carries `degraded: true` and its
     `explain` says what was missing. The count is still reported; it is labelled a lower
     bound.
  5. *No measurement, no number.* When the index is `null` for any reason - switch off,
     bound exceeded, build failure, or every changed module is outside language scope while
     code files in an unsupported language changed - the analyzer emits today's
     `reach_unavailable` marker with an `explain` naming the reason. It never emits a
     fabricated count, and it never emits nothing where code changed.
  6. *Nothing to measure.* When the index is present and no changed module exports
     anything, the analyzer emits no signal.
- **FR-14 The sensitive-sink signal stays honest.** `sensitiveSinkAnalyzer` must continue
  to mark its signal `degraded` and say "direct match only" for as long as it performs no
  transitive analysis, whether or not `refIndex` is non-null. Its honesty must key on what
  it did, not on the presence of a field another analyzer consumes.
- **FR-15 Signal vocabulary, with auto-merge unchanged.** `impact_reach` is added to the
  recognised set in `auto-merge.ts` as a name that is neither high-blast nor
  affirmative-low, alongside `reach_unavailable`. `reachKnownLow` continues to return
  `false`. For every input in the existing SPEC-024 test matrix, `decideAutoMerge` returns
  the same `eligible`, `blast` and `failed` with the reach switch on as with it off.
- **FR-16 The validation harness can obtain measurements.** The builder is callable from
  `classifier-validation.test.ts` given a module list, without the editor, so that #91's
  study can record a direct and a transitive count per instance once it has repository
  snapshots to index (DQ-2). This spec adds the call path and reports the numbers; it
  asserts no acceptance threshold.
- **FR-17 The decision this spec forces is recorded before Plan.** The engine chosen under
  DQ-1 is written up as a decision record before design work starts (see
  [Why no decision record yet](#why-no-decision-record-yet)).

## Contract (TypeScript sketch - finalised in Plan)

```ts
/** "unknown" is not zero: the index has no entry for this symbol or file. */
type Measured = number | undefined;

interface IndexCoverage {
  readonly modulesIndexed: number;
  readonly skipped: ReadonlyArray<{ path: string; reason: 'too-large' | 'unparseable' }>;
  readonly unresolved: ReadonlyArray<{ file: string; specifier: string }>;
  readonly complete: boolean; // true only when skipped and unresolved are both empty
}

interface ReferenceIndex {
  callerCount(symbol: SymbolRef): Measured; // direct importers (FR-4)
  reachCount(symbol: SymbolRef): Measured;  // reverse transitive closure (FR-4)
  exportedSymbolsOf(filePath: string): SymbolRef[] | undefined;
  readonly coverage: IndexCoverage;
}

/** Pure. No fs, no git, no vscode. (FR-1) */
function buildReferenceIndex(
  modules: ReadonlyArray<{ path: string; content: string }>,
  resolution: ResolutionInputs,
  bounds: IndexBounds,
): { index: ReferenceIndex } | { index: null; reason: IndexUnavailableReason };

type IndexUnavailableReason =
  | 'switched-off' | 'module-cap' | 'byte-cap' | 'time-budget'
  | 'build-failed' | 'language-out-of-scope';
```

`ConsequenceInput.refIndex` keeps its existing type, `ReferenceIndex | null`. The reason for
a `null` reaches the analyzer through one additive optional field on `ConsequenceInput`, so
existing callers that construct the input by hand stay valid.

## Acceptance Criteria

Each is a checkable pass/fail condition on the built code, written before any code exists.

### A. Index correctness

- **AC-1 Named import counted.** Given module `a` exporting `f` and modules `b`, `c`
  importing `f` from `a`, `callerCount(f)` is 2. *(FR-2, FR-4)*
- **AC-2 Re-export is transparent.** Given `a` exporting `f`, a barrel re-exporting it, and
  ten modules importing `f` from the barrel, `callerCount(f)` is 11 or 10 as the Plan fixes
  the barrel's own membership, and is never 1. *(FR-4)*
- **AC-3 Unattributable import counts for every symbol.** Given `a` exporting `f` and `g`
  and module `b` with `import * as x from a`, both `callerCount(f)` and `callerCount(g)`
  include `b`. Same for a side-effect import, a literal `require`, a literal dynamic
  `import()` and `export *`. *(FR-5)*
- **AC-4 Type-only import counted.** `import type { T }` from `a` makes the importer count
  toward `T`. *(FR-2)*
- **AC-5 Transitive closure terminates on a cycle** and `callerCount` is at most
  `reachCount` for every symbol, checked as a property over generated graphs. *(FR-4)*
- **AC-6 Unknown is not zero.** A query for a symbol absent from the index returns
  "unknown", and the analyzer given that answer emits a `degraded` signal, not a `T1`
  measured one. *(FR-6, FR-13.4)*
- **AC-7 Unresolved specifier is visible.** A relative import of a path with no module is
  listed in `coverage.unresolved`, `coverage.complete` is `false`, and the resulting
  `impact_reach` signal is `degraded`. *(FR-3, FR-6, FR-13.4)*
- **AC-8 Order independence.** Shuffling the input module list changes no query result.
  *(FR-1)*

### B. Bounds, cache, coalescing

- **AC-9 Each bound degrades visibly.** For each of module cap, byte cap and time budget, a
  fixture exceeding it yields `index: null` with the matching reason, and the analyzer emits
  `reach_unavailable` whose `explain` names that reason. *(FR-7, FR-13.5)*
- **AC-10 Oversized module is skipped, not silently dropped.** It appears in
  `coverage.skipped` and `complete` is `false`. *(FR-7, FR-6)*
- **AC-11 Warm rebuild rescans only what changed.** After one module's content changes, the
  scan function is invoked for that module alone, and every query answers as a cold build
  over the same content would. *(FR-9)*
- **AC-12 Resolution-input change discards the cache.** *(FR-9)*
- **AC-13 No disk write.** A build over a fixture repository leaves the fixture's file list
  and contents unchanged, and creates no `.minspec/` directory where none existed. *(FR-9)*
- **AC-14 Concurrent requests share one build.** Two overlapping requests cause one build.
  *(FR-10)*
- **AC-15 Nothing runs at activation.** Activating the extension with the switch on invokes
  the loader zero times. *(FR-10)*
- **AC-16 Deleted module's importers are counted.** A diff deleting `a` while `b` still
  imports it yields a direct count of at least 1 for `a`'s exports, and `b`'s import is not
  in `coverage.unresolved`. *(FR-8)*

### C. Gating and the analyzer

- **AC-17 Off is byte-identical.** With the switch off, `runConsequenceAnalyzers` output over
  the existing `consequence-analyzers.test.ts` fixtures is deep-equal to the output before
  this change, and the loader is never invoked. *(FR-11)*
- **AC-18 Default is off and pinned.** The T0 test fails, naming #91, if the default
  changes. *(FR-11)*
- **AC-19 The canonical case floors up.** With the switch on, a two-line body change to an
  exported function imported by 200 modules yields an `impact_reach` signal with value 200
  and a tier above what the size signals alone give. *(FR-13; DR-022's motivating case)*
- **AC-20 Attribution fallback is an upper bound.** For a module with exports `f` (many
  importers) and `g` (none): a change inside `g` attributed precisely reports `g`'s count;
  the same change with `oldContent` withheld reports `f`'s. *(FR-13.1)*
- **AC-21 Wording.** No `explain` produced by the analyzer contains the word "caller".
  *(FR-13.2)*
- **AC-22 Upward only.** Adding the reach signal to any signal set never lowers
  `classify()`'s result (the existing SPEC-023 INV-3 property test, extended to the new
  name). *(INV-3)*
- **AC-23 Analyzers stay pure.** The analyzer module still imports no `vscode`, no
  `simple-git`, no `fs`; the pure builder module imports no `vscode`, no `fs`, no
  `simple-git`. *(INV-1, FR-1)*
- **AC-24 Sensitive-sink stays degraded with an index present.** *(FR-14)*
- **AC-25 Parity test passes** with `impact_reach` emitted and recognised. *(FR-15)*
- **AC-26 Auto-merge is unchanged.** The SPEC-024 decision matrix yields identical
  `eligible`, `blast` and `failed` with the switch on and off; `reachKnownLow` returns
  `false` for a set containing a non-degraded low `impact_reach`. *(FR-15)*
- **AC-27 Harness reports, does not assert.** With repository snapshots absent the harness
  suite skips as it does today; with them present it records counts and enforces no
  threshold. *(FR-16)*

## Invariants (must not break)

- **INV-1 Tier-0** (SPEC-023 INV-1; constitution invariant 1). No network, no AI, no
  `vscode` in the analyzers or the builder. IO only in the loader.
- **INV-2 `classify()` stays pure** (SPEC-023 INV-2). Its existing T0 tests pass verbatim.
- **INV-3 Upward-only ratchet** (DR-021, SPEC-023 INV-3). Reach can raise a tier, never
  lower one, and can never be the reason a change is treated as *safer*.
- **INV-4 Honest degrade, never silent** (SPEC-023 INV-4; constitution invariant 2). No
  count is presented as complete when the index knows it is not. No failure path yields a
  missing signal where code changed. Note the existing swallow at `classify.ts:95`: a throw
  from the loader must be converted to a `reach_unavailable` marker *inside* the input
  builder, so that this catch never becomes the place a reach failure vanishes.
- **INV-5 Not on by default before #91** (DR-024 Decision point 2).
- **INV-6 Auto-merge eligibility is unchanged by this spec** (SPEC-024 INV-2, DR-058).
- **INV-7 The opt-in marker.** The feature writes nothing, so it cannot create `.minspec/`
  (constitution invariant 3).
- **INV-8 Activation stays cheap** (constitution constraint 3).
- **INV-9 Determinism** (goal G-6). The same tree and diff give the same counts on any
  machine; no result depends on file-system enumeration order, timestamps, or whether an
  editor language server happens to be running.

## Decisions needed (Clarify)

Five questions. Each names a recommended option `(rec)` and what that recommendation costs.

### DQ-1 - Which engine extracts imports and exports?

Deferred here by SPEC-023 Clarification C2.

- **Option A - hand-written lexical scan (regular expressions).** No new dependency. It can
  count importers per module, but it cannot reliably delimit a declaration, so FR-13.1
  always takes the whole-module fallback and AC-20's precise half does not hold. More
  importantly it cannot know what it failed to match: an import form the patterns miss is
  an **under-count with no marker**, which is the one failure INV-4 forbids.
- **Option B - the TypeScript parser, syntax only `(rec)`.** `ts.createSourceFile` per
  module, no `Program`, no type checker - the approach `import-cycle-check.ts` already uses
  and tests as dev tooling. Parses JavaScript and TypeScript, reports parse failures (so
  coverage is truthful), and delimits declarations (so FR-13.1 can attribute). **Cost:**
  `typescript` becomes a fourth shipped runtime dependency, bundled into the VSIX. The size
  increase is several megabytes - I have not measured it; this worktree has no installed
  dependencies, and Plan must measure the bundle before and after. It also reverses, for
  the shipped extension, the property DR-064 §1 preserved when it kept `typescript` out of
  the VSIX, and it must be loaded lazily to respect activation cost (INV-8).
- **Option C - full type-checked program (TypeScript `Program`, or `ts-morph`).** The only
  option that counts call sites and resolves aliases exactly. Cold start measured in
  seconds to tens of seconds and memory in the hundreds of megabytes on a mid-sized
  repository - a widely reported characteristic I have not measured here. SPEC-023 C2
  already rejected this weight for v1.
- **Option D - the editor's own reference provider.** No dependency and exact, but it needs
  `vscode`, is unavailable to any headless consumer, and its answer depends on language
  server state. It breaks INV-1 and INV-9. Listed for completeness; not recommended under
  any answer to the other questions.

Under Option A: FR-13.1 reduces to its fallback, AC-20 is dropped, and FR-6's "failed to
parse" list is always empty, which must then be stated as a known blind spot in `explain`.
Under Option C: FR-4's direct count may be redefined as call sites, FR-7's proposed bounds
need re-measuring, and `packages/minspec/package.json` changes as under B.

### DQ-2 - Language scope, given that the existing validation corpus is all Python

- **Option A - JavaScript and TypeScript only, behind a per-language seam `(rec)`.**
  Matches every other content analyzer in the module. **Cost:** #91 cannot reuse the 120
  labelled instances. It needs a new labelled JS/TS corpus *with repository snapshots*
  before it can pass, so real reach stays off for longer than #195's wording suggests, and
  that corpus is unscoped work that belongs to #91.
- **Option B - add a Python scanner now** so the existing labels can be reused. A lexical
  Python import scanner is the DQ-1 Option A engine with the same silent under-count
  problem, and the corpus still lacks repository snapshots, so the fetch script would have
  to check out each of 120 base commits. Validates the model on a language MinSpec's other
  analyzers do not read.
- **Option C - defer this spec until #91 defines its corpus.** No wasted build; but #91 has
  nothing to measure with, so the two issues block each other.

Under Option B: FR-2's language scope widens, a second scanner is added to `implements:`,
and FR-16 gains a snapshot-fetch step that must stay out-of-tree and consented (SPEC-004
FR-1 precedent).

### DQ-3 - May a user turn reach on before #91 passes?

- **Option A - yes, by explicit configuration `(rec)`.** Default off; a project sets the
  switch on in `.minspec/config.json`. This is how the index gets dogfooded and how
  measurements for #91 are gathered on real work. **Cost:** an opted-in project gets tier
  floors from placeholder thresholds nobody has validated. They are upward-only, so the
  harm is unearned ceremony, never a missed one - but DR-021 found that over-tiering
  erodes trust, and this is a way to produce it.
- **Option B - no user-facing switch; harness only.** The index is reachable from tests and
  the validation harness alone until #91 passes. Strictest reading of "do NOT enable".
  Nothing is dogfooded, and FR-11 to FR-13's editor path ships dark and unexercised.

Under Option B: FR-11's switch becomes a build-time constant, FR-12 is deferred to the
change that follows #91, and AC-15, AC-17 and AC-19 move to that change.

### DQ-4 - Does the merge gate get the index in this spec?

- **Option A - no; the gate keeps `refIndex: null` `(rec)`.** SPEC-024 owns eligibility;
  DR-058 made it deny-by-default; this spec leaves both untouched (FR-15, INV-6). **Cost:**
  the editor and the gate see different reach until a follow-up lands, which sits
  awkwardly with goal G-6 (the same rule everywhere), and auto-merge gains nothing from
  this work yet - DR-061 notes the designed gate holds everything while reach is absent,
  and it will keep doing so.
- **Option B - wire the gate too, still with `reachKnownLow` false.** One code path
  everywhere. But it edits `scripts/auto-merge-gate.ts`, which is merge machinery, and adds
  an index build to every gate run for no change in outcome.

Neither option lets reach make a pull request eligible. That step is a SPEC-024 change
gated on #91 and is listed under Follow-ups.

### DQ-5 - Which count drives the tier, and on what scale?

- **Option A - the direct count, absolute thresholds `(rec)`.** Tier from importing-module
  count (placeholders 5 / 20 / 50); the transitive count is reported in `explain` and
  recorded for #91. **Cost:** it misses fan-out through a wrapper - `f` imported only by
  `g`, `g` imported by 200 modules, scores 1. I believe the transitive count saturates in a
  layered codebase (a change low in the stack reaches most of the tree) and so
  discriminates poorly; that belief is unverified and is exactly what #91 should measure.
- **Option B - the transitive count.** Catches the wrapper case. If the saturation belief
  is right, nearly every change to a shared module floors to the top tier.
- **Option C - a fraction of the repository's modules** rather than an absolute count.
  Scales across repository sizes; on a 30-module project a fraction is noisy, and it makes
  the same change score differently as unrelated files are added.

Whatever is chosen is a placeholder until #91 reports. The requirement that survives every
option is FR-13.3: one exported table, one place to change.

## Why no decision record yet

Checked `docs/decisions/INDEX.md` for an existing record on the engine choice (searched:
"reach", "call-graph", "reference index", "ts-morph", "#195", "#91"). DR-022 (consequence
axis), DR-024 (reach gated on validation) and DR-064 §1 (in-repo import graph, `typescript`
kept out of the VSIX) are adjacent; none decides the engine - SPEC-023 C2 explicitly
deferred it to this issue.

The engine choice does meet the bar for a record: it sets what ships in the VSIX, and once
#91 validates numbers produced by one engine, swapping engines invalidates that study. But
it is DQ-1, and it is not made until a human answers it. Minting a record now would record
an agent's recommendation as a decision. FR-17 requires the record before Plan; its number
comes from the collision gate (`scripts/check-dr-id-collision.ts`), which needs the network
this dispatch does not have. Everything else here - the switch, the bounds, the in-memory
cache, the signal name - is reversible in under a day while the default is off.

## Alternatives considered and rejected

- **Reuse `buildValueImportGraph` as-is.** It reads the file system itself, counts runtime
  edges only, tracks modules not symbols, and throws on any gap. Right for a CI gate that
  must fail closed; wrong for an editor feature that must degrade and carry on. Its resolver
  and its fail-visible discipline are worth lifting in Plan; the function is not the index.
- **Revive `ast-analyzer.ts`.** DR-021 Decision 4 forbids wiring it into classification,
  and it measures local complexity, not cross-file reach.
- **Persist the index under `.minspec/`.** Faster cold start, at the price of a
  stale-cache correctness risk and a new writer subject to invariant 3. Not needed to meet
  FR-7's budget on the evidence available; revisit only if Plan's measurements say so.
- **A file watcher that keeps the index live.** More machinery on the activation path for a
  result needed only when a classification runs. Content comparison at request time (FR-9)
  gives the same answer without it.
- **Emit one signal per changed symbol** (SPEC-023's sketch says "per-symbol reach
  signals"). `classify()` takes the maximum, so the extra signals change no outcome and
  flood the four-signal summary the command shows (`classify.ts:109`).
- **Flip `reachKnownLow` here.** That is the step that lets reach widen auto-merge. It is
  the highest-consequence use of an unvalidated number and belongs behind #91.

## Test plan (for the Plan phase to place)

- **T0 (invariants):** default-off pin (AC-18); off is byte-identical (AC-17); purity scans
  of the analyzer and builder modules (AC-23); monotonicity property (AC-22); no disk write
  (AC-13); no activation work (AC-15); parity test (AC-25); auto-merge unchanged (AC-26).
- **T1 (contract):** index correctness over small synthetic module sets (AC-1 to AC-8);
  bounds (AC-9, AC-10); cache and coalescing with an instrumented scan function (AC-11,
  AC-12, AC-14); deleted-module view (AC-16); analyzer behaviour (AC-19 to AC-21, AC-24).
- **T2 (integration):** the loader over a fixture git repository in both staged and
  working-tree views; the classify command path with the switch on.
- **Measurement (reported, not asserted):** cold and warm build time and peak memory on
  this repository, recorded in Plan to set FR-7's constants; VSIX size before and after
  under DQ-1 Option B.
- **Guard against vacuous green.** The bound and degrade tests must each show the opposite
  outcome on a control fixture just inside the bound, so a broken fixture cannot pass them.

## Risks

- **Degraded flagship reads as "done", round two.** A measured number looks authoritative.
  Mitigation: FR-13.2's wording, FR-13.4's lower-bound marking, placeholder thresholds
  labelled as such, default off.
- **Silent under-count.** The failure that matters: reach says 3, truth is 200, tier stays
  low. Mitigation: FR-5 (over-count what cannot be attributed), FR-6 (unknown is not zero,
  coverage is exposed), DQ-1's recommendation of an engine that can report what it could
  not parse.
- **Editor latency.** An index build on the first classification of a session.
  Mitigation: FR-7 budget, FR-10 coalescing, degrade rather than wait.
- **#91 stalls and this ships dark indefinitely.** DQ-2 shows #91 needs a corpus that does
  not exist. Mitigation: none inside this spec - it is named so the human can weigh it
  before approving the build.
- **Vocabulary drift into the merge gate.** Mitigation: FR-15 and the existing parity test.

## Follow-ups (tracked)

- **Reach validation and thresholds** - [#91](https://github.com/AIClarityAU/minspec/issues/91).
  Owns the default flip and replaces FR-13.3's placeholders.
- **`tier` to risk-profile migration** - [#90](https://github.com/AIClarityAU/minspec/issues/90).
- **Not yet filed** (this dispatch has no network access; each needs an issue before this
  spec is approved, per DR-023's forward rule):
  - #91 needs a JS/TS corpus with repository snapshots, or a decision to validate on Python
    (DQ-2). Belongs on #91 as a comment or as its own issue.
  - Let measured reach satisfy `reachKnownLow` and wire the index into the merge gate - a
    SPEC-024 change, gated on #91 (DQ-4).
  - Transitive sensitive-sink reach using the index (SPEC-023 FR-4's indexed form; FR-14
    here only prevents the overstatement).
  - The engine decision record (FR-17).

## Traceability

| Item | Where |
|---|---|
| Triggering issue | [#195](https://github.com/AIClarityAU/minspec/issues/195) |
| Parent spec | [SPEC-023](../SPEC-023-consequence-screen/requirements.md) FR-1, Clarification C2, Follow-ups |
| Validation gate | [#91](https://github.com/AIClarityAU/minspec/issues/91); [DR-024](../../../docs/decisions/DR-024.md) Decision point 2 |
| Consequence axis | [DR-022](../../../docs/decisions/DR-022.md) §1, risk R7 |
| Upward-only floor | [DR-021](../../../docs/decisions/DR-021.md) |
| Merge-gate consumer | [SPEC-024](../SPEC-024-auto-merge-eligibility/requirements.md) FR-4, FR-5; [DR-058](../../../docs/decisions/DR-058.md) |
| Existing import graph | [SPEC-040](../SPEC-040-import-boundaries/requirements.md) FR-2; [DR-064](../../../docs/decisions/DR-064.md) §1 |
| Validation harness | [SPEC-004](../SPEC-004-classifier-validation/requirements.md) |
