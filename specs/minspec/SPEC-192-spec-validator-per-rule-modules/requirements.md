---
id: SPEC-192
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - the validator is the methodology's completeness gate; this makes it cheap to change safely
depends_on: [SPEC-040, DR-012, DR-064]  # SPEC-040 owns the import-cycle gate this spec must keep green; DR-012 the tier-aware completeness validator being split; DR-064 the Tier-0 layer rules the new modules sit under
relates_to: [SPEC-038, SPEC-134, SPEC-136, SPEC-047, SPEC-051, SPEC-046, DR-066, "#693", "#137", "#651", "#153", "#108", "#1446"]
# Ownership (SPEC-038) is deliberately NOT declared yet: the file layout is Clarify
# question CQ-1 below, and every path depends on its answer. Plan declares
# `implements:`/`affects:` once CQ-1 is settled.
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-192: Split the spec validator into one small module per rule, and test its guessing rules against a committed set of example specs

## In plain terms

The spec checker is one 1,777-line file. Every new check edits it, and the checks that
guess at prose (does this spec describe a page? an API?) have been fixed by shipping and
re-fixing, six times in one day. This splits each check into its own small file behind
the same public functions, and adds a folder of example specs, each marked "this check
must fire" or "must stay quiet", that CI runs. Cost: about 25 new files, and a merge
clash with four approved specs that also edit this file. Left out: changing what any
check reports. Riskiest assumption: every check can move with byte-identical output.

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. A human reads
> it and approves it through the normal spec-approval gate before any design or code.
> The questions under [Decisions needed (Clarify)](#decisions-needed-clarify) are the
> reason for the read.

**Origin.** Issue #693 (2026-07-13 malleability audit). Baseline: written against
`origin/main` `5f792386` (2026-10-15).

## One-Sentence Scope

Restructure `packages/minspec/src/lib/spec-validator.ts` into a thin public façade over
one Tier-0 module per validation rule plus separate heuristic-detector modules, with
**no change to any violation it reports**; add a committed fire/quiet fixture corpus run
by CI for every heuristic rule; and move `slugify` out of `spec-manager.ts` into a leaf
util so `epic-manager`/`adr-manager`/`epic-backfill` stop importing the spec manager.

## Context - what the code does today (read at `5f792386`, not inferred)

The issue's figures are from July and have moved. Current state:

- **Size.** `spec-validator.ts` is **1,777 lines** (issue said 1,303). `validateSpec`
  starts at `spec-validator.ts:1157` and runs to about `:1384` (~228 lines). The file
  exports 25 symbols. 38 commits have touched it since 2026-04-01.
- **Fix-thrash, confirmed.** `git log` shows on 2026-06-04/05: `61a47bba` ('rest' false
  positive, #108), `9c1ec7b3` (markdown table mistaken for an ascii box, #153),
  `f11f1415` (api/data over-match on polysemous prose, #153), `b2aed646`, `e58a1f09`
  (ux over-detection, #153), `7ee64d61` (unrecognised status/tier coerced, #115). Each
  over-match was found after shipping; none had a committed counter-example first.
- **Rules in the file.** Rule ids emitted today (the public contract — consumers match on
  them, e.g. `ownership-ratchet.ts:66` tests `v.rule === 'ownership.implements.missing'`):
  `acceptance.missing`, `aspect.{ux,api,data,architecture}.no-*`, `epic.missing`,
  `epic.unresolved`, `frontmatter.<field>.{missing,unknown,unresolved}`,
  `frontmatter.prose-line`, `implement.claimed-without-evidence`,
  `ownership.implements.{missing,invalid}`, `park-ref.dangling`, `section.<phase>.empty`,
  `shard-id.mismatch`, `status-claim.contradicted`, `status.cross-artifact.regression`,
  `status.inline-comment`, `status.mirror-drift`, `status.orphan-comment`,
  `split-coverage.<type>.missing`.
- **Two kinds of entry point.** Per-spec: `validateSpec` (orchestrates the rest) plus the
  separately-exported `validateOwnership`, `validateStatusAnnotation`,
  `validateFrontmatterProse`, `validateImplementEvidence`, `checkAcceptanceCriteria`,
  `violationsIntroducedByApproval`. Corpus-level (take many files):
  `validateSplitLayoutCoverage`, `validateStatusMonotonicity`,
  `validateShardIdConsistency`, `validateStatusClaims`. The CI/commit path
  (`scripts/validate-frontmatter.ts`) imports several of these directly so the editor
  and CI cannot drift (#654); that sharing MUST survive.
- **Heuristic code.** Aspect detection (`detectsUx`/`detectsApi`/`detectsData`,
  keyword lists at `:97`–`:123`, `stripCodeSpans`, `wordBoundaryRe`), mockup detection
  (`MARKDOWN_TABLE_RE`, `BOX_GLYPH_RE`, `PLUS_FRAME_RE`, `markdownTableLineSet`,
  `:224`–`:313`), frontmatter prose counting (`countFrontmatterProseLines`, `:794`),
  park-claim detection (`PARK_CLAIM_RE`, `:643`) and done-claim detection
  (`claimRegex`, `CLAIM_WINDOW`, `:1698`–`:1718`). These are the ones that over-match.
- **The import cycle in the issue no longer exists as written.** `spec-validator.ts`
  imports nothing from `epic-manager` today (its imports are `spec`, `spec-vocabulary`,
  `config`, `lifecycle`, `approval`, `ownership-path-rules`, `:13`–`:29`), and
  `epicRefValue` already lives in `spec-vocabulary` (`epic-manager.ts:183` re-exports
  it). `spec-layout.ts:8` → `spec-validator` is `import type` only. What remains is the
  value edge `epic-manager.ts:4` → `spec-manager` for `slugify` (also
  `adr-manager.ts:5`, `epic-backfill.ts:10`), which SPEC-040 FR-6 names as
  "one-edit-away" fragility and defers. Verified: `npm run check:cycles` (SPEC-040
  FR-2) at `5f792386` prints "110 modules scanned, 0 runtime import cycles". So Part C
  below removes fragility; it does not break a live cycle.
- **Coverage.** `packages/minspec/tests/spec-validator.test.ts` is 1,587 lines; at least
  12 other test files and two src callers import from `spec-validator`.

## Functional Requirements

### A. One module per rule, behind an unchanged public surface

- **FR-1 - Public surface unchanged.** Every symbol `spec-validator.ts` exports today
  MUST remain importable from the same specifier (`./spec-validator`,
  `../src/lib/spec-validator`, `../packages/minspec/src/lib/spec-validator`) with the
  same name, signature and types. No caller or existing test file is edited to follow a
  move (a test MAY be added; an existing assertion MUST NOT be changed).
- **FR-2 - The rule contract.** A per-spec rule is a value of one exported interface,
  defined once in a Tier-0 module:

  ```ts
  /** Everything a per-spec rule may read. Computed once by the orchestrator. */
  export interface SpecRuleContext {
    readonly spec: ParsedSpec;
    readonly config: MinspecConfig;
    readonly raw: string;             // spec.raw
    readonly specType: string;        // lowercased frontmatter `type`, '' for single-file
    readonly isSplitLayout: boolean;
    readonly tier: Tier;
    readonly effectiveAspects: readonly Aspect[];
    readonly options: ValidateSpecOptions;
  }

  export interface SpecRule {
    /** Stable id, or id family for templated ids (e.g. 'section.*.empty'). */
    readonly id: string;
    /** True when the rule's verdict rests on a prose heuristic (FR-9 applies). */
    readonly heuristic: boolean;
    /** Pure: no fs, no vscode, no network, no clock, no mutation of ctx. */
    check(ctx: SpecRuleContext): readonly ValidationViolation[];
  }
  ```

  Plan MAY add fields; it MUST NOT give `check` any input outside `ctx`.
- **FR-3 - One file per rule.** Each per-spec rule currently inlined in `validateSpec`
  (epic ref, closed-set frontmatter, status mirror drift, phase sections, acceptance
  criteria, aspect artifacts, park-ref, and the already-separate ownership / status
  annotation / frontmatter prose / implement evidence) lives in its own module exporting
  one `SpecRule`. A rule's module holds its own constants, regexes and helpers unless
  another rule shares them (then FR-5).
- **FR-4 - An ordered registry, written by hand.** One module exports
  `SPEC_RULES: readonly SpecRule[]` listing every per-spec rule in the order
  `validateSpec` evaluates them today. `validateSpec` becomes: build the context, run
  each rule in registry order, concatenate, compute `complete`. Adding a rule is one new
  file plus one registry line. Discovery by filesystem scan is not allowed (it would put
  `fs` in a Tier-0 module and make order depend on the directory listing).
- **FR-5 - Heuristic detectors are their own modules.** Aspect detection, mockup /
  ascii-box / markdown-table detection, frontmatter prose counting, park-claim detection
  and done-claim detection each move to a detector module with a pure exported function
  (string in, verdict out). Rules call detectors; detectors know nothing about rules.
  This is the seam the fixture corpus (Part B) also tests directly.
- **FR-6 - Corpus-level validators move too.** `validateSplitLayoutCoverage`,
  `validateStatusMonotonicity`, `validateShardIdConsistency` and
  `validateStatusClaims` each move to their own module and are re-exported by the
  façade (FR-1). They do not join `SPEC_RULES` (different input shape).
- **FR-7 - Byte-identical output.** For any input, every exported function MUST return
  the same value after the change as before: same violations, same order, same
  `rule`, `severity`, `message` and `fixHint` strings, same `detectedAspects` /
  `declaredAspects` / `effectiveAspects`. This is a pure move; any behaviour fix found
  on the way is filed as its own issue and not folded in.
- **FR-8 - Tier-0 purity of every new module.** No rule, detector or registry module may
  import `fs`, `path`, `child_process`, `vscode`, any network module, or any module that
  does (DR-064; constitution invariant 1). The fs lookups that today live in callers
  (`pathExists`, `siblingShardFiles`, `knownEpicRefs`) stay in callers.

### B. A committed fixture corpus for the guessing rules

- **FR-9 - Corpus shape.** A committed directory of example spec files, one
  sub-directory per rule id (or detector), each holding `fires/` and `quiet/` example
  files. A file under `fires/` asserts that rule's id appears in the result; a file under
  `quiet/` asserts it does not. Each fixture opens with a one-line comment naming the
  over-match class or issue it pins (e.g. `#108 the English word "rest"`).
- **FR-10 - One harness test, run by CI.** One vitest file under
  `packages/minspec/tests/` walks the corpus, runs each fixture through `validateSpec`
  (with a fixed `DEFAULT_CONFIG`-based config and a tier taken from the fixture's own
  frontmatter), and reports one test case per fixture, named by its path. It runs under
  `npx vitest` as CI invokes it, not via an npm `pretest` hook.
- **FR-11 - Fails closed, never vacuously (invariant 2, DR-066).** The harness MUST fail
  when: the corpus root is missing or unreadable; it finds fewer fixtures than a
  committed floor (same pattern as `MIN_SCANNED_MODULES` in
  `scripts/check-import-cycles.ts`); a sub-directory names a rule id no registered rule
  emits; a fixture sits outside `fires/`/`quiet/`; or a rule marked `heuristic: true`
  in `SPEC_RULES` has no `fires/` fixture or no `quiet/` fixture. The last check reads
  the registry, so a new heuristic rule cannot land without examples.
- **FR-12 - Seeded with every known over-match.** On landing, the corpus holds at least
  one `quiet/` fixture for each historical false positive recoverable from git history
  of this file, at minimum: the word "rest" (#108); a markdown table read as an ascii
  box (#153, `9c1ec7b3`); api/data words used in ordinary prose (#153, `f11f1415`); ux
  over-detection (#153, `e58a1f09`); a quoted enum scalar in frontmatter; an
  unrecognised status/tier value (#115) as a `fires/` case. Plan lists the full set by
  walking `git log -- packages/minspec/src/lib/spec-validator.ts` for `fix(` commits.
- **FR-13 - Fixtures are inert to the repo's own gates.** Fixture files MUST NOT be read
  as real specs by `npm run validate`, the spec tree, the approval gate or the
  `id:`-uniqueness check: they live outside `specs/`, and any `id:` they carry uses a
  range or prefix Plan shows no corpus walker parses as a real spec id.

### C. Re-home `slugify`

- **FR-14 - A leaf util.** `slugify` moves to a new Tier-0 module with no imports of its
  own. `spec-manager.ts` keeps exporting `slugify` (re-export) so FR-1-style callers
  outside `lib` do not change. `epic-manager.ts`, `adr-manager.ts` and
  `epic-backfill.ts` import it from the new module, so none of the three imports
  `spec-manager` for it. Behaviour is unchanged (the 50-character cap and trimming at
  `spec-manager.ts:75`–`:87` included).
- **FR-15 - The cycle gate stays green and gains nothing to waive.** `npm run
  check:cycles` passes after the change, and the value edge
  `epic-manager → spec-manager` no longer exists. Whether a residual cycle exists today
  was checked at Specify (none; see Context) and is re-checked by the gate on the PR.

## Acceptance Criteria

- [ ] AC-1 (FR-1): every existing test file passes unedited; `git diff` over
      `packages/minspec/tests/` shows additions only.
- [ ] AC-2 (FR-7): a characterisation run, made once before and once after the change,
      feeds every `specs/**/*.md` on the baseline commit plus every corpus fixture
      through `validateSpec` and the four corpus-level validators and compares the full
      serialised results; zero differences. The run's command and both result counts are
      recorded in the implementing PR body (non-zero counts, so an empty run cannot pass).
- [ ] AC-3 (FR-3/FR-4): `validateSpec`'s body is the orchestration only - no rule-specific
      regex or constant remains in it; `spec-validator.ts` holds re-exports, types and
      the orchestrator. Plan sets a concrete line ceiling for the façade.
- [ ] AC-4 (FR-4): a test asserts `SPEC_RULES` order equals the pre-change evaluation
      order (pinned as a literal id list), so a reordering is a red test, not a silent
      change in violation order.
- [ ] AC-5 (FR-8): a test, using the gate's own import parser rather than a text grep,
      asserts no rule/detector/registry module reaches `fs`, `path`, `child_process` or
      `vscode` at runtime.
- [ ] AC-6 (FR-11): the harness is shown to fail, in the implementing PR, for each of:
      corpus root removed; corpus below the floor; an unknown rule-id directory; a
      `heuristic: true` rule with no `quiet/` fixture. Each is a mutation run whose red
      output is quoted.
- [ ] AC-7 (FR-12): reverting any one seeded over-match fix (e.g. re-adding `rest` to the
      api keyword set) turns at least one corpus fixture red. Demonstrated for at least
      three of the seeded classes.
- [ ] AC-8 (FR-13): `npm run validate` output is identical with and without the corpus
      present (no new warnings, no duplicate-id finding).
- [ ] AC-9 (FR-14/FR-15): `npm run check:cycles` passes; no file in `lib/` imports
      `slugify` from `./spec-manager`.
- [ ] AC-10: `npm test`, `npm run lint` and `npm run validate` pass.

## Invariants (must not break)

- **INV-1 - Offline (constitution invariant 1).** No new module makes or enables a
  network call; the harness reads only committed files.
- **INV-2 - No silent gate (constitution invariant 2, DR-066).** The validator is a
  merge-gating check through `scripts/validate-frontmatter.ts`. Splitting it MUST NOT
  introduce a path where a rule throws and is swallowed, or is skipped because it was
  left out of the registry: a rule module that exists but is not registered is a red
  test (Plan: compare registry against the rules directory listing in the test, where
  `fs` is allowed).
- **INV-3 - Blast radius (constitution invariant 3).** Nothing here changes what an
  adopter's validator reports; FR-7 makes that checkable.
- **INV-4 - Editor and CI share one implementation (#654).** The functions
  `scripts/validate-frontmatter.ts` imports remain the same functions `validateSpec`
  calls - re-exported, never copied.
- **INV-5 - TS↔Python ownership parity (SPEC-038, `ownership-path-parity.test.ts`,
  `ownership-list-parity.test.ts`).** `validateOwnership` and `isValidOwnedPath`
  semantics unchanged; the parity tests pass unedited.
- **INV-6 - Rule ids are a contract.** No rule id is renamed, merged or split.

## Decisions needed (Clarify)

- **CQ-1 - Where the modules live.**
  - **a (rec)** keep `lib/spec-validator.ts` as the façade and put modules in a sibling
    directory `lib/spec-rules/` (rules) and `lib/spec-rules/detect/` (detectors). Every
    import specifier and every approved spec's `affects:` line naming
    `spec-validator.ts` (SPEC-134, SPEC-046, SPEC-051, SPEC-047, all `planning`) stays
    valid. Cost: those specs' `affects:` will then point at a façade while the code
    they plan to change sits in `spec-rules/`, so each will need an ownership update when
    it is built.
  - **b** replace the file with a directory `lib/spec-validator/index.ts`. Specifiers
    still resolve, but the path `spec-validator.ts` vanishes, which breaks the `affects:`
    of four approved specs and needs their re-approval.
- **CQ-2 - What a fixture asserts.**
  - **a (rec)** presence / absence of one rule id per fixture (FR-9). Cost: does not
    catch a change in message wording or severity; FR-7's one-off characterisation run
    covers that only at refactor time.
  - **b** a full expected-violations sidecar per fixture. Catches wording changes, but
    every message edit then rewrites many sidecars, which is the churn this spec is
    trying to remove.
- **CQ-3 - Is the characterisation run (AC-2) committed?**
  - **a (rec)** run once, recorded in the PR, not committed. Cost: it cannot be re-run
    later to prove a future refactor is a pure move.
  - **b** commit a golden snapshot of the real corpus. Re-runnable, but every spec edit in
    the repo changes it, so it goes stale daily or becomes a rubber-stamped update.
- **CQ-4 - Order against the in-flight rule additions.** SPEC-134 (FR-2, FR-20) and
  others add new rules to this file and are approved (`planning`).
  - **a (rec)** land this decomposition first, so those specs add a rule file rather
    than edit the hotspot. Cost: their Plans, written against the single file, need a
    small update, and any of them already in a PR will conflict.
  - **b** let them land first, then decompose. No rework for them, but the hotspot grows
    first and this refactor rebases over each.
- **CQ-5 - Ship as one PR or slices?**
  - **a (rec)** three PRs in order: Part C (slugify, tiny), Part A (the split, behaviour
    proven by AC-2), Part B (corpus + harness). Cost: the corpus lands last, so the
    split itself is guarded only by the existing tests plus AC-2.
  - **b** corpus first, then split. Better guarded, but the corpus would be written
    against the old internals and the `heuristic` flag check (FR-11) cannot exist until
    the registry does.

## Out of Scope

- Changing any rule's behaviour, severity, message, or id (FR-7, INV-6), including fixing
  a false positive found while seeding the corpus - file it.
- Moving the validator to `@aiclarity/shared` or to SPEC-136's headless core. The
  façade makes that move easier; it is not made here.
- Corpus-level fixtures for the four multi-file validators (their inputs are file sets,
  not one spec); a follow-up if they prove heuristic-prone.
- Re-homing other lib helpers or dissolving the other type-only-held cycles SPEC-040
  lists (`approval→approval-store`, `spec→lifecycle`).

## Risks

- **Pure-move drift.** A regex moved with a different flag, or a constant evaluated in a
  different order, changes output silently. Mitigation: AC-2 over the full real corpus
  plus fixtures, with counts.
- **Vacuous harness.** A corpus walker that reads nothing passes. Mitigation: FR-11
  floor and AC-6 mutation runs.
- **Fixtures parsed as specs.** Mitigation: FR-13, AC-8.
- **Merge collision with concurrent work.** The file is the repo's top-churn file and
  about fifteen sessions run concurrently. Mitigation: CQ-4, CQ-5, and a short-lived
  branch for Part A.

## Alternatives considered and rejected

- **Leave the file whole, add only the fixture corpus.** Ends the ship-and-refix loop
  for heuristics, but every new rule still edits the hotspot and conflicts with every
  other rule in flight. Kept as the fallback if CQ-4 cannot be settled.
- **Auto-discovered rule files (glob at runtime or build time).** Removes the registry
  line, but puts `fs` or a build step into a Tier-0 module and makes evaluation order
  depend on file names. Rejected (FR-4).
- **A class hierarchy (`abstract class Rule`).** No behaviour to inherit; a plain
  interface plus functions matches the rest of `lib/`.

## Decision records

None minted. Every choice here is a code layout that can be undone in under a day (the
decision-record filter in the architect role); the design rests on DR-012 (the validator), DR-064 (Tier-0 layering and
the cycle gate) and DR-066 (no silent gate).

## Follow-ups (tracked)

- None beyond this spec's own Plan. Any behaviour defect found while seeding the corpus is
  filed as its own issue at that time (FR-7).

## Traceability

- Issue: #693 (this spec).
- Seam named in the issue: #137 (symmetric closed-set primitive) becomes one rule module.
- Prior step: #651 / `21eaf6b4` (options object).
- Cycle work this continues: SPEC-040 FR-6, #1446 (`d1a285b7`).
