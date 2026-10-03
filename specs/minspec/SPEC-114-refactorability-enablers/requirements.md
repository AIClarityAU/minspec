---
id: SPEC-114
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - "the methodology rules enforced by the extension rather than by convention" is this epic's Done line
aspects: [refactorability, contracts, invariants, dependency-budget, single-source, validator, advisory, tier-0, anti-debt]
goal: G-2  # Prevent tech debt
relates_to: [DR-029, DR-004, DR-064, DR-066, DR-074, SPEC-013, SPEC-010, SPEC-016, SPEC-038, SPEC-040, SPEC-006, "#133", "#125", "#132", "#23", "#52", "#121"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3). All
# four files are NEW and exist under every Clarify answer below: the one checker (FR-1), and
# the test files that pin it. Files this spec would MODIFY (spec-validator.ts, git-analyzer.ts,
# tool-detector.ts, config.ts) are deliberately not listed under `affects:` yet - they are hot
# shared files, and SPEC-013's own frontmatter records that an `affects:` entry freezes a file
# the same way `implements:` does. They are named in "Files this would touch" below and are
# promoted to `affects:` at Plan, the SPEC-040 precedent.
implements: [packages/minspec/src/lib/seam-check.ts, packages/minspec/tests/seam-check.test.ts, packages/minspec/tests/dependency-budget.test.ts, packages/minspec/tests/arch-tool-detect.test.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-114: Refactorability enablers - check contracts, invariant tests and dependency budget where a spec meets its code

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers the questions under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the
> normal spec-approval gate before any code changes. Every requirement below is written
> under each decision's recommended option; choosing a different option changes only the
> requirements that decision names.

Materializes **[#133](https://github.com/AIClarityAU/minspec/issues/133)** (refactorability
enablers at the spec-to-code seam).

**Date:** 2026-10-03 - read from `main` at `350c6fa4`.

## One-Sentence Scope

One offline checker compares what a spec already declares (its ranked seam list, its
contract files, its invariants) with the code on disk and the change being made, and
reports - as warnings, never as code-style rules - a seam with no contract, a contract
file that is still empty when building starts, a contract type defined a second time, and
more new packages than the change's tier allows; separately it notes, once, whether the
project already runs an import-boundary tool, and never runs or reimplements one.

## Context - what exists today (read, not inferred)

### The problem the issue names

The constitution's second-ranked goal, G-2 (Prevent tech debt), names the failure this is
for: debt "accreted through rework and scope creep (~3 days bugfixing per 1 day of new
function)" (`.minspec/constitution.md`, Goals). The issue's question is whether MinSpec
should enforce coding practice to protect future refactoring, and its own answer is a
boundary: check the things that *make* refactoring safe (a contract at each seam, a test
per invariant, few new dependencies, one implementation per contract) and leave code style
to the linters that already exist.

### Four neighbours already cover parts of this, and three of them are not merged

This is the fact that shapes the whole design. Each bullet in the issue lands next to a
spec that already claims the adjacent ground.

| Issue bullet | Neighbour | State observed | What the neighbour does NOT do |
|---|---|---|---|
| Contracts at seams | Contract-frontmatter spec for #23, on branch `agent/issue-23` | Unmerged, `status: specifying` | It adds optional `contracts:` / `invariant_tests:` / `file_allowlist:` fields and warns on a malformed or dangling entry. It has "No missing-direction check": a spec with no `contracts:` produces nothing (its FR-5). |
| Contracts-first, dependency budget, as *method rules* | Methodology guardrail spec for #125, on branch `agent/issue-125` | Unmerged, `status: specifying` | It checks *documents*. Its Out of Scope says: "Checking code or diffs against the method (for example counting new packages in a pull request). This spec checks documents." It treats contracts-first and dependency budget as judgement rules because "a spec has no field today that declares new dependencies or contracts". |
| Invariant tests | Test-completeness spec for #52, on branch `agent/issue-52` | Unmerged, `status: specifying` | It maps `FR-N` and `INV-N` to tests by literal citation and refuses the tasks-to-implement transition. Its FR-1 to FR-8 as read do not mention the `invariant_tests:` field or stub/hollow tests. |
| Arch tools | Import-boundaries spec SPEC-040 and its decision DR-064 (machine-enforce the layer-import contract) | `status: done`, `accepted` | They enforce *this repository's* layering with `eslint.config.mjs` and an in-repo cycle gate (`npm run check:cycles`). Nothing looks at whether an *adopter's* project has any such tool. |

The three unmerged specs are read from the remote-tracking refs present in this worktree;
this dispatch has no network, so that is a snapshot, not a live reading. They are cited by
issue and branch, not by spec number, on purpose: their numbers are not final until they
merge (several open branches in that snapshot claim the same number), and this spec's own
id, 114, is one above the highest number visible across those refs (113), for the same
reason.

So #133 is not a fresh mechanism. Its distinct contribution is the one thing none of the
four does: **join a spec's declarations to the code** - the missing direction (a seam with
no contract), the phase boundary (a contract still empty when Implement starts), the
duplicate (a contract type defined twice), and the count (new packages against a budget).

### What the code has today

- **Seams are prose only.** The ranked seam list is the `## Costly to Refactor` section
  (SPEC-013 risk-section policy, FR-1; resolves #132 seams-first). The only code that
  mentions it writes the heading: `slash-commands.ts:136` (authoring guidance) and
  `adr-manager.ts:566` (DR template). Nothing parses it. SPEC-013's own frontmatter
  records its section registry as having "zero implementation".
- **Corpus numbers** (76 `requirements.md` files on `main`): 20 have a
  `## Costly to Refactor` section; 17 of those cite at least one `FR-N` inside it; **0**
  declare `contracts:` and **0** declare `invariant_tests:`. Of the 17, 4 are T3 or T4
  (full or complete ceremony) with `plan` in progress or done.
- **Dependency change is a boolean, and an over-reporting one.**
  `git-analyzer.ts:190-210` sets `hasNewDependencies` when the diff of any `package.json`
  contains an added line shaped `"name": "value"`; a version bump adds exactly such a line,
  so a bump reads as a new dependency. A failed diff is caught and read as "no new
  dependencies" (`git-analyzer.ts:206-209`). The signal it feeds, `dependency_change`
  (`git-analyzer.ts:256-263`), carries no count.
- **The budget figure is prose in one role file.** `scripts/roles/dev.md:24`: "MUST NOT
  introduce new dependencies without checking dependency budget (0-1 for simple, 2-3 for
  complex)". Nothing counts.
- **A lexical, Tier-0 scanner precedent exists.** `test-scanner.ts:504` `scanTestSource`
  finds stub and hollow tests by string analysis with comments and string literals
  stripped, "no TypeScript AST dependency, no AI, no network" (its header). The checker
  here follows that shape.
- **Tool detection today is about AI harness files only.** `tool-detector.ts:28`
  `detectTools` checks six filenames (`CLAUDE.md`, `.cursorrules`, ...). No code looks for
  an architecture tool.
- **A warn-to-error ratchet precedent exists.** `config.ts:60` and `:140`
  `ownershipDeclaration: 'warn' | 'error'`, read at `spec-validator.ts:820`.
- **A "say it once" memory exists.** `preferences.ts:51-58` `answeredSignatures`, keyed by
  prompt and state signature.

## Functional Requirements

### One checker

- **FR-1 - One module owns every check in this spec.** A single Tier-0 module,
  `packages/minspec/src/lib/seam-check.ts`, exports pure functions that take file contents
  and parsed frontmatter as data and return findings (FR-12). It imports no `vscode`, no
  git library and no network client; disk and git reads stay in the caller and are passed
  in, the pattern `consequence-analyzers.ts` documents in its header. No check in this spec
  may be implemented a second time elsewhere (the issue's own single-source rule, applied
  to itself).

### Contracts at seams

- **FR-2 - What a seam is (parse contract).** A spec's seams are the list items of its
  `## Costly to Refactor` section. A **seam FR** is an `FR-N` id cited, as a word-boundary
  literal, inside such an item. The section ends at the next `## ` heading. A section whose
  only content is a `Low - <reason>` line (SPEC-013 FR-1 allows it) has no seams.
- **FR-3 - A seam with no contract is reported (the missing direction).** For a primary
  requirements spec that is T3 or T4 with `plan` in progress or done - the same trigger
  `validateOwnership` uses (`spec-validator.ts:799-803`) - that has at least one seam FR
  and declares no `contracts:` entry, the checker reports one `seam-without-contract`
  finding naming the seam FR ids. One finding per spec, not per seam (DQ-1).
- **FR-4 - Declaring "no code contract" is a valid, visible answer.** `contracts: none`
  together with a non-empty `contracts_reason:` satisfies FR-3. It mirrors the existing
  `implements: none` plus `implements_reason:` escape (`spec-validator.ts:808-814`). Many
  seams are not code - a file grammar, a section order - and a warning with no honest way
  to answer it trains people to ignore it. This shape has to be admitted by the
  contract-frontmatter spec for #23, which owns the field (DQ-2).
- **FR-5 - A contract file that defines nothing is reported once building starts.** For
  each declared `contracts[].path` that exists on disk, when the spec's `implement` phase
  is in progress or done, the file must export at least one type-level or schema
  declaration: `export interface`, `export type`, `export enum`, or an exported `const`
  initialised from a `z.` call. Otherwise: one `contract-empty` finding naming the path.
  Matching is lexical with comments and strings stripped, as in `test-scanner.ts`. A path
  that does *not* exist is **not** reported here - that dangling-path warning belongs to
  the contract-frontmatter spec (its FR-5) and is not duplicated.
- **FR-6 - What is not claimed: order.** The checker verifies that a contract *exists and
  is non-empty at the Implement boundary*. It does not verify that the contract was written
  *before* the implementation; files at rest carry no order. Any message or doc for this
  check says "has a contract", never "contract-first verified".

### Single source

- **FR-7 - A contract type defined a second time is reported.** For each identifier
  exported by a declared contract file under FR-5's four forms, the checker scans the files
  the same spec lists under `implements:` and `affects:` (source files only, tests
  excluded) for a second declaration of that identifier - `interface X`, `type X =`,
  `enum X`, or `const X = z.` - exported or not. Each hit is one `contract-redeclared`
  finding naming the identifier, the contract file and the second location. An `import` or
  re-export of the identifier is not a declaration and is not reported.
- **FR-8 - Scope and suppression of FR-7.** The scan is bounded to the declaring spec's own
  owned and affected files; it is not a repository-wide duplicate detector (DQ-4). A line
  comment `minspec-contract-ok: <reason>` on or directly above the second declaration
  suppresses that one finding; a suppression with no reason text does not suppress. This
  marker is new - no suppression marker of this kind exists in `packages/minspec/src`
  today.

### Invariant tests

- **FR-9 - This spec builds no invariant-to-test matcher.** Mapping each `INV-N` to a test
  that cites it is the test-completeness spec for #52's requirement (its FR-2, FR-4, FR-6).
  Building a second matcher here would be the duplicate implementation this spec exists to
  flag. This spec contributes two inputs to that matcher and nothing else (DQ-3):
  - **(a) scope** - files listed under `invariant_tests:` join the set of test files it
    scans;
  - **(b) a citing test must be real** - a test that cites an invariant id but is reported
    `stub` or `hollow` by `scanTestSource` (`test-scanner.ts:504`) does not count as
    covering it.
- **FR-10 - Until that matcher exists, invariant coverage is reported as not checked.** No
  surface in this spec may show invariant tests as covered, green or passing while FR-9's
  owner is unbuilt. Where findings are summarised (FR-13), the summary line states which
  checks ran and names invariant coverage as "not checked" - a missing witness is said out
  loud, not rendered as a pass.

### Dependency budget

- **FR-11 - New packages are counted, not guessed.** For a change that touches one or more
  `package.json` files, the caller passes each file's content before and after. The checker
  parses both as JSON and counts the **distinct package names present after and absent
  before** across `dependencies`, `devDependencies`, `optionalDependencies` and
  `peerDependencies`, over all touched manifests, excluding any name that is the `name` of
  a package inside the repository's own workspaces. A version change to an existing name
  counts as zero. The result is compared with a budget keyed by the change's classified
  tier: **1** for T1 and T2 (one-sentence spec; spec plus plan), **3** for T3 and T4 (full
  cycle; complete ceremony) - the upper bounds of `dev.md:24`'s "0-1 for simple, 2-3 for
  complex" (DQ-5). Over budget produces one `dependency-over-budget` finding carrying the
  count, the budget and the names. The budget is read from `.minspec/config.json`
  (`dependencyBudget: { simple, complex }`), defaulting to 1 and 3.
- **FR-11a - An uncountable change says so.** If either side of a manifest fails to parse,
  or the change touches a recognised non-npm manifest (`requirements.txt`,
  `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`, `pom.xml`), the checker returns a
  `dependency-not-measured` finding naming the file and the reason. It never returns "zero
  new dependencies" for input it could not read - the opposite of today's
  `git-analyzer.ts:206-209`, which this spec does not change (Out of Scope).
- **FR-11b - The count does not move the tier.** The existing `dependency_change` signal
  and its T2/T3 contribution (`git-analyzer.ts:256-263`) are untouched. The budget finding
  is displayed beside the classification; it is not a classification input.

### Findings and surfaces

- **FR-12 - Finding contract.** One shape for every check:

  ```ts
  type SeamFindingKind =
    | 'seam-without-contract'    // FR-3
    | 'contract-empty'           // FR-5
    | 'contract-redeclared'      // FR-7
    | 'dependency-over-budget'   // FR-11
    | 'dependency-not-measured'  // FR-11a
    | 'check-not-run';           // FR-10, FR-17: a named check that could not run, and why

  interface SeamFinding {
    readonly kind: SeamFindingKind;
    readonly specId?: string;        // absent for change-level findings (FR-11)
    readonly path?: string;          // repo-relative file the finding is about
    readonly line?: number;
    readonly subjects: readonly string[];  // FR ids, identifiers, or package names
    readonly message: string;        // one sentence, no bare reference (project label rule)
    readonly fixHint: string;        // the one action that clears it, including the FR-4/FR-8 escape
  }
  ```

  The kind list is closed. Adding a kind is a spec change.
- **FR-13 - Two existing surfaces, no new one.** (a) The spec-at-rest findings (FR-3, FR-5,
  FR-7) are emitted through the existing validator as `warning`-severity
  `ValidationViolation`s (`spec-validator.ts:38`), so they appear wherever validator
  warnings already appear, including `npm run validate`. (b) The change-level findings
  (FR-11, FR-11a) are shown in the output of the existing classify command, next to the
  signals it already lists. No new command, view, status-bar item or notification.
- **FR-14 - Advisory by default, with a ratchet for one check.** Every finding is a
  warning and none changes an exit code or blocks an approval, a commit or a merge. One
  config key, `seamContract: 'warn' | 'error'` (default `warn`), raises
  `seam-without-contract` alone to `error`, mirroring `ownershipDeclaration`
  (`config.ts:60`). No other finding has a ratchet in this spec (DQ-6).
- **FR-15 - Specs that predate this are not chased.** FR-3, FR-5 and FR-7 apply only to a
  spec whose approval is not yet recorded or whose `implement` phase is not `done`.
  A finished spec is never newly warned about, so landing this cannot turn the existing
  corpus yellow.

### Detect existing architecture tools - and stop there

- **FR-16 - Detection is a closed list of file-level signals.** Extending
  `tool-detector.ts`, a pure function reports which import-boundary tooling a project
  shows, from files only:
  - a dependency named `dependency-cruiser`, `eslint-plugin-boundaries` or `tsarch` in any
    workspace manifest (the third is the package name I believe the issue's "ts-arch"
    refers to - unverified, this dispatch has no network; confirm at Plan);
  - a `.dependency-cruiser.*` config file at the repository root;
  - the literal `no-restricted-imports` or `boundaries/` in a root ESLint config file.

  The result is `{ present: string[] }` naming each signal found. MinSpec never executes,
  installs, configures or reads the output of any of these tools.
- **FR-17 - One quiet note, then silence.** When the list is empty **and** the repository
  has more than one workspace package, MinSpec shows one advisory line - on the classify
  output of FR-13(b), not a popup - saying no import-boundary tool was detected and naming
  the three as examples. Dismissal is remembered through `answeredSignatures`
  (`preferences.ts:58`) keyed on the detection result, so it reappears only if the result
  changes. When the list is non-empty nothing is shown. A single-package project is never
  nudged (DQ-7).
- **FR-18 - This repository must detect as covered.** `eslint.config.mjs` carries
  `no-restricted-imports` (DR-064), so FR-16 returns a non-empty list here and FR-17 stays
  silent. A detector that nudged the repository that wrote it would be wrong on first run.

### The judgement half - named, not built

- **FR-19 - Coupling, god-object and circular-dependency review get no verdict here.**
  They are judgement, and judgement is the reality-check agent's (SPEC-016, in the
  agent-execute epic EPIC-007), a separate Tier-1 extension. This spec's only obligation is
  that FR-12's findings are exported so that lens can read them as input. No prompt, no
  model call and no lens definition is specified here.

### Sequencing

- **FR-20 - Three slices, each usable alone.**
  1. **The dependency-count slice** (FR-11, FR-11a, FR-11b, FR-13b) and
     **the tool-detection slice** (FR-16 to FR-18). Neither depends on any unmerged spec.
  2. **The seam-contract slice** (FR-2 to FR-8, FR-13a, FR-14, FR-15). Needs the
     `contracts:` field, so it must not enter Plan until the contract-frontmatter spec for
     #23 is approved.
  3. **The invariant-input slice** (FR-9). Needs the matcher from the test-completeness
     spec for #52; until then FR-10 holds.

## Costly to Refactor

Ranked most to least costly.

1. **The `contracts: none` plus `contracts_reason:` escape (FR-4).** A frontmatter shape
   that specs adopt and another spec's validator must admit. Changing it later means
   editing every spec that used it, and each edit voids that spec's approval. *Check: you
   accept this shape, and that it is settled with the #23 spec before either is built.*
2. **Seam = an FR id cited in the Costly to Refactor section (FR-2).** Every spec's
   existing seam list becomes checker input. Redefining a seam later changes which specs
   are warned. *Check: the 17-of-20 corpus count above is the population you expect.*
3. **Finding contract (FR-12).** Read by the validator, the classify output and, later, the
   reality-check lens. *Check: the six kinds.*
4. **What "new dependency" counts (FR-11).** The four manifest fields and the workspace
   exclusion decide every count. *Check: dev dependencies are in.*
5. **Cheap to reverse:** both budget numbers, the ratchet default, the tool list, the
   suppression marker, and the whole feature - every check is a warning, so removing the
   module and its call sites restores today's behaviour.

## Acceptance Criteria

- **AC-1.** A T3 spec with `plan: done`, a Costly to Refactor item citing `FR-2`, and no
  `contracts:` produces exactly one `seam-without-contract` warning naming `FR-2`;
  `npm run validate` still exits zero. (FR-2, FR-3, FR-14)
- **AC-2.** The same spec with `contracts: none` and a `contracts_reason:` produces none;
  with `contracts: none` and no reason it produces the warning. (FR-4)
- **AC-3.** The same spec at T2, or at T3 with `plan: pending`, or whose Costly to Refactor
  section is a single `Low - <reason>` line, produces none. (FR-2, FR-3)
- **AC-4.** A declared contract file containing only comments and an import, on a spec
  with `implement: in-progress`, produces one `contract-empty`; with `implement: pending`
  it produces none; a declared path that does not exist produces no finding from this
  checker. (FR-5)
- **AC-5.** A contract exporting `interface Order`, with a file under `implements:` that
  declares `interface Order`, produces one `contract-redeclared`; the same file importing
  `Order` produces none; a declaration inside a comment or a string produces none; the
  marker `minspec-contract-ok: legacy adapter` suppresses it and a bare
  `minspec-contract-ok` does not. (FR-7, FR-8)
- **AC-6.** Manifest before/after pairs: adding two new names to a T2 change produces
  `dependency-over-budget` with count 2 and budget 1; bumping one existing version produces
  nothing; adding the repository's own workspace package produces nothing; the same name
  added in two manifests counts once. (FR-11)
- **AC-7.** An unparseable manifest, and a change touching `go.mod`, each produce
  `dependency-not-measured` and never a zero count. (FR-11a)
- **AC-8.** For a fixed set of changes, the classified tier is identical with the checker
  present and absent. (FR-11b)
- **AC-9.** With `seamContract: error`, AC-1's fixture fails validation; no other finding
  kind changes severity. (FR-14)
- **AC-10.** Run against this repository at the commit that lands the seam-contract slice,
  the validator's warning count for specs whose `implement` phase is `done` is unchanged.
  (FR-15)
- **AC-11.** Tool detection returns a non-empty list for this repository; an empty list
  for a two-package fixture with none of the signals, which shows the note once and not
  again after dismissal; and no note for a single-package fixture. (FR-16 to FR-18)
- **AC-12 - not vacuous.** Each check in FR-3, FR-5, FR-7, FR-11 and FR-11a is removed one
  at a time and the suite goes red each time, and each removal is confirmed to have edited
  the line it meant to.
- **AC-13.** `seam-check.ts` imports nothing from `vscode`, `simple-git`, `child_process`,
  `http`, `https` or `net`, pinned by a test that reads its import specifiers. (FR-1)
- **AC-14.** Any summary of findings names invariant coverage as "not checked" while the
  matcher of FR-9 is absent. (FR-10)

## Invariants (must not break)

- **INV-1 - Offline core (constitution invariant 1).** Every check reads local files and
  data handed in by the caller. No network call, no model call.
- **INV-2 - No silent gate (constitution invariant 2).** A check that cannot run reports
  `dependency-not-measured` or `check-not-run`; it never returns an empty, passing result
  for input it could not read. While everything is advisory this spec adds no load-bearing
  gate; turning the FR-14 ratchet to `error` makes one, and from that point a thrown error
  inside the check must fail validation visibly rather than be caught and dropped.
- **INV-3 - Blast radius (constitution invariant 3).** Nothing is written outside the
  project. The only write is the FR-17 dismissal, into the project's own preferences file.
  No file belonging to a third-party tool is created or edited.
- **INV-4 - Not a linter.** No finding concerns naming, formatting, complexity, function
  length or any property of code that is not one of: a contract's existence, a contract's
  duplication, or a manifest's package names. Adding such a check requires a new spec.
- **INV-5 - Single implementation.** Each of the following has exactly one implementation
  and this spec adds no second: dangling-path detection for `contracts:` (the #23 spec),
  invariant-to-test matching (the #52 spec), stub/hollow test detection
  (`test-scanner.ts`), import-cycle detection (`import-cycle-check.ts`, SPEC-040).
- **INV-6 - Classification unchanged.** Tiers produced by `classify()` do not change.
- **INV-7 - Absent declarations cost nothing outside the trigger.** A T1 or T2 spec, a spec
  not yet planned, and a spec with no Costly to Refactor section are unaffected.
- **INV-8 - Detection is not integration.** Tool detection reads file names and literal
  strings. MinSpec does not parse a third-party tool's rules, run it, or report its results.

## Files this would touch (for Plan to confirm; not yet `affects:`)

New: the four under `implements:`. Modified, each gaining a call or a field rather than a
mechanism: `packages/minspec/src/lib/spec-validator.ts` (call FR-3/5/7),
`packages/minspec/src/lib/git-analyzer.ts` (hand manifest before/after to FR-11),
`packages/minspec/src/lib/tool-detector.ts` (FR-16), `packages/minspec/src/lib/config.ts`
(two keys), the classify command (FR-13b), `scripts/validate-frontmatter.ts` if the
validator call is not already reached from it.

## Decisions needed (Clarify)

Each question names a recommended option and what that recommendation costs.

### DQ-1 - How is "a seam that needs a contract" identified?

- **Option A - any FR cited in the Costly to Refactor section; one finding per spec;
  answered by a contract or by `contracts: none` plus a reason (rec).** Uses a section 20
  specs already have and needs no new markup. *Cost:* many seams are not code (a grammar, a
  section order), so a real share of specs will answer with `none` plus a reason - the
  check then proves that someone *considered* a contract, not that one exists.
- **Option B - an explicit marker on the seam item (for example a trailing `[contract]`).**
  Precise: only marked seams are checked. *Cost:* a new piece of grammar in an
  LLM-authored section, and an unmarked seam is silently unchecked - the missing direction
  comes back.
- **Option C - infer from code: a spec whose `implements:` spans two packages or touches
  `packages/shared`.** No authoring burden. *Cost:* a heuristic about paths, wrong for a
  single-package adopter, and it ignores the seam list the human actually ranked.

### DQ-2 - This spec leans on an unapproved field. How is that sequenced?

`contracts:` and `invariant_tests:` exist only in the contract-frontmatter spec for #23,
which is unmerged, and FR-4's `contracts: none` shape is one that spec's validator would
today warn about as malformed.

- **Option A - keep the two specs separate; amend the #23 spec to admit `contracts: none`
  plus `contracts_reason:` before it is approved; the seam-contract slice waits for it
  (rec).** One owner per field. *Cost:* the most valuable slice here is blocked on another
  approval, and someone has to carry the amendment across - it is not made by this
  dispatch, which may only write this spec.
- **Option B - fold the field definitions into this spec and retire the #23 spec.** One
  approval. *Cost:* discards a spec that also covers panel links and a CodeLens this spec
  does not want, and re-opens its Clarify answers.
- **Option C - use a different key here (for example `seam_contracts:`).** No coordination.
  *Cost:* two fields naming contract files - the second implementation this issue is
  against.

### DQ-3 - Who owns invariant-to-test matching?

- **Option A - the test-completeness spec for #52 owns it; this spec adds the two inputs in
  FR-9 and reports "not checked" until it exists (rec).** One matcher. *Cost:* the issue's
  second bullet ("each invariant has a test") is delivered by another spec's approval, not
  this one's; if that spec stalls, so does the bullet.
- **Option B - build the matcher here.** Self-contained. *Cost:* two specs specifying the
  same literal-citation matcher, to be reconciled later.
- **Option C - move the invariant row out of the #52 spec into this one, leaving that spec
  with `FR-N` rows only.** Groups "refactor safety net" in one place. *Cost:* splits one
  matcher's two row types across two specs and edits a spec this dispatch cannot touch.

A related fact for whichever option: 61 of 76 requirement files use numbered `INV-N` ids
and 9 use a worded form such as `INV-single-predicate`; a worded or unnumbered invariant
can only be matched if the matcher accepts those ids.

### DQ-4 - How wide is the duplicate-contract scan?

- **Option A - only the declaring spec's `implements:` and `affects:` files (rec).** Cheap,
  and every hit is inside the change being built. *Cost:* a duplicate in a file no spec
  declares is not found; this is not a repository-wide guarantee and must not be described
  as one.
- **Option B - every source file in the repository.** Finds more. *Cost:* common type names
  (`Options`, `Config`, `Result`) collide across unrelated modules, so the first run is
  mostly noise, and scan time grows with the repository.

### DQ-5 - What does the budget count, and what are the numbers?

Three figures are written down: the issue and `dev.md:24` say "0-1 simple / 2-3 complex";
the methodology guardrail spec for #125 quotes the parent register's "more than two new
dependencies means infrastructure, not a feature".

- **Option A - distinct new package names across all four manifest fields, workspace
  packages excluded; budget 1 for T1/T2 and 3 for T3/T4; configurable (rec).** Matches the
  one figure written in this repository. *Cost:* dev dependencies count the same as runtime
  ones, so a tooling change can trip it; and neither number has a measurement behind it -
  expect to move them after first contact with real changes.
- **Option B - runtime `dependencies` only.** Counts what ships. *Cost:* a new build or
  test tool - a real refactoring burden - is invisible.
- **Option C - a single threshold of 2 for every tier, matching the parent register's
  wording.** One number. *Cost:* drops the simple/complex distinction the issue asks for.

Whichever is chosen: if the #125 spec is approved, its `dependency-budget` rule text states
a number in the constitution while this checker reads one from config. Two places for one
number will drift; the follow-up below asks for one to cite the other.

### DQ-6 - Advisory, or blocking?

The issue's title says "enforce"; constitution principle 8 says "Don't hope an LLM will
follow rules - enforce it via code"; principle 4 says "Avoid nagging".

- **Option A - everything a warning; one opt-in ratchet to `error` for
  `seam-without-contract` only (rec).** Lands without turning any spec red, and gives a
  path to real enforcement once the corpus has contracts. *Cost:* on the day it ships it
  enforces nothing - a warning can be ignored, which is the "trust the model" shape the
  constitution warns about, until someone flips the key.
- **Option B - `seam-without-contract` is an error for T3/T4 from the start.** Real
  enforcement. *Cost:* 4 in-build specs on `main` cite a seam FR and 0 declare a contract,
  so each goes red on landing and needs an edit, and an edit to an approved spec voids its
  approval.
- **Option C - all findings blocking.** *Cost:* blocks merges on lexical heuristics
  (FR-5, FR-7) that have never run against a real project.

Choosing B or C makes a merge-gating check and needs a decision record first (see below).

### DQ-7 - Should MinSpec name third-party tools at all?

- **Option A - detect a closed list; when nothing is found in a multi-package project show
  one dismissible line naming the three as examples (rec).** Does what the issue asks.
  *Cost:* a shipped list of other people's tools goes stale, and naming them reads as
  endorsement of tools MinSpec does not test against.
- **Option B - detect only; say "no import-boundary tool detected" with no names.** Nothing
  to maintain. *Cost:* tells the user something is missing without saying what would fill
  it.
- **Option C - drop detection from this spec.** Smallest. *Cost:* the issue's fifth bullet
  is not delivered.

## Why no new DR

`docs/decisions/INDEX.md` was searched for an existing decision on contract, invariant-test,
dependency-budget or architecture-tool checking (terms: seam, contract, refactor,
dependency, invariant, guardrail). DR-029 (self-audit family, advisory, deterministic floor
in core and judgement in agent-execute) and DR-064 (this repository's own import boundaries)
are the adjacent ones; neither decides this. Under the recommended options nothing here is
hard to undo: every finding is a warning, no file format is introduced beyond one optional
frontmatter escape, and deleting the module and its call sites restores today's behaviour
inside a day. A decision record becomes necessary, and this spec must not proceed to Plan
without one, if DQ-6 resolves to B or C (a new blocking gate), if DQ-2 resolves to B or C
(this spec defines frontmatter fields), or if MinSpec is ever asked to run or configure a
third-party tool (INV-8).

## Out of Scope

- **Any code-style, formatting, naming or complexity rule.** INV-4. The issue's non-goals.
- **Reimplementing dependency-cruiser, ESLint boundaries or ts-arch**, or running them, or
  reading their reports. INV-8.
- **Checking that a contract was written before its implementation.** FR-6.
- **Checking that an implementation *conforms* to its contract.** That is the type
  checker's and the contract tests' job.
- **Coupling, god-object and circular-dependency judgement.** FR-19; reality-check lens.
- **Fixing the existing `hasNewDependencies` heuristic or its swallowed failure**
  (`git-analyzer.ts:190-210`). Observed and recorded here; changing it would change
  classification (INV-6). Follow-up below.
- **Non-npm ecosystems in the dependency count.** Reported as not measured (FR-11a).
- **The method-rule declarations in documents** (the `contracts-first` and
  `dependency-budget` rows). The methodology guardrail spec for #125.
- **Panel links, CodeLens and `file_allowlist:`.** The contract-frontmatter spec for #23.
- **Backfilling `contracts:` into existing specs.** FR-15.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `contracts: none` becomes the reflex answer and the check proves nothing. | The reason is mandatory and visible in the spec a human approves (FR-4); the count of `none` answers is a cheap measurement to take after the first ten specs (follow-up). |
| Lexical matching misreads code (generics, multi-line declarations, a `z` that is not Zod). | Comment and string stripping as in `test-scanner.ts`; findings are warnings; per-line suppression with a reason (FR-8); AC-5 fixtures include the false-positive cases. |
| Three unmerged specs change under this one. | FR-20 isolates the two slices with no such dependency; the other two cannot enter Plan before their prerequisite is approved. |
| The budget numbers are wrong. | Config keys, not constants (FR-11); named as unmeasured in DQ-5. |
| A warning nobody reads. | FR-14's ratchet is the route to enforcement; DQ-6 states plainly that the default enforces nothing. |
| The tool list goes stale. | Closed list in one place (FR-16); note shown once (FR-17); DQ-7 offers the no-names option. |

## Alternatives considered and rejected

- **A general "architecture lint" inside MinSpec.** Rejected: the issue's own non-goal, and
  DR-064 already chose existing ESLint rules over a bespoke tool for this repository.
- **Git-history ordering to prove contract-first.** Rejected: history order is rewritten by
  squash merges (I believe this repository squash-merges - not verified in this dispatch),
  and it would put git plumbing in a Tier-0 pure module.
- **A new `new_dependencies:` frontmatter field for the spec to declare its budget use.**
  Rejected: the manifest already says what was added; a declared number is a second source
  that can disagree with it.
- **Using the TypeScript compiler API for FR-5 and FR-7.** Rejected for v1: `test-scanner.ts`
  chose lexical analysis to stay dependency-free, and `ast-analyzer.ts` records AST
  augmentation as a parked dead end for classification. Revisit if AC-5's false-positive
  fixtures cannot be made to pass lexically.
- **A new command or view for these findings.** Rejected: two surfaces already show
  warnings and signals (FR-13).

## Follow-ups (not yet filed - this dispatch has no network access)

To be filed as issues by whoever publishes this spec; each is outside this spec's scope.

1. Amend the contract-frontmatter spec for #23 to admit `contracts: none` plus
   `contracts_reason:` (DQ-2 Option A).
2. Add the two FR-9 inputs to the test-completeness spec for #52 (DQ-3 Option A).
3. `git-analyzer.ts:190-210` reads a version bump as a new dependency and reads a failed
   diff as "none"; decide whether classification should use FR-11's count instead.
4. One home for the dependency-budget number, shared with the methodology guardrail spec
   for #125 (DQ-5).
5. After ten specs have passed through FR-3, measure how many answered `contracts: none`.

## Traceability

- Issue: [#133](https://github.com/AIClarityAU/minspec/issues/133).
- Related issues: #125 (methodology guardrail), #132 (seams-first, resolved into SPEC-013),
  #23 (contract frontmatter), #52 (test completeness), #121 (signpost coverage).
- Decisions rested on: DR-029 (advisory self-audit; judgement belongs to agent-execute),
  DR-004 (tier model - this is Tier 0), DR-064 (use existing boundary tooling), DR-066 (no
  silent gate), DR-074 (blast radius).
- "DR-359 CDD" in the issue is a parent-register record (mmo-platform), not readable from
  this checkout; nothing here asserts its text beyond what the issue and `dev.md:24` quote.
