---
id: SPEC-414
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - "the methodology rules enforced by the extension rather than by convention" is this epic's Done line
aspects: [dependency-budget, single-source, config, drift-gate, methodology, tier-0]
goal: G-2  # Prevent tech debt
relates_to: [SPEC-114, SPEC-109, DR-023, DR-066, DR-074, DR-004, DR-123, "#4021", "#133", "#125"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3). The one
# NEW file is the drift gate (FR-8). Files this would MODIFY are listed under `affects:`:
# each gains a type, a reader, or loses a restated number - none gains a mechanism.
implements: [packages/minspec/tests/dependency-budget-home.test.ts]
affects: [packages/minspec/src/lib/config.ts, packages/minspec/src/lib/slash-commands.ts, .claude/commands/minspec-plan.md, scripts/roles/dev.md, specs/minspec/SPEC-114-refactorability-enablers/requirements.md]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-414: One home for the dependency-budget number, shared by SPEC-114 and the methodology guardrail spec for #125

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks the recorded selections under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the
> normal spec-approval gate before any code changes. Every requirement is written under
> each decision's recommended option; choosing another option changes only the
> requirements that decision names.

Materializes **[#4021](https://github.com/AIClarityAU/minspec/issues/4021)**, filed as
SPEC-114 (refactorability enablers) Follow-ups item 5. DR-023's 30-day rule makes it a
pre-approval condition of SPEC-114.

**Date:** 2026-11-24, read from `main` at `2e3dcd29`. The methodology guardrail spec for #125
is read from the local remote-tracking ref `origin/agent/issue-125` at `a15ed42a` (unmerged,
`status: specifying`; its spec number on that branch is not final until it
merges, so it is cited here by issue and branch). This dispatch makes no network call; that
is a snapshot.

## One-Sentence Scope

The dependency budget (how many new packages a change may add, by tier) is defined in
exactly one place - a `dependencyBudget` key in `.minspec/config.json` with its default
declared once as `DEFAULT_DEPENDENCY_BUDGET` in `config.ts` - read through one function, cited (never restated) by
SPEC-114, the #125 spec and every shipped prose surface, and guarded by a test that fails
when a number reappears anywhere else.

## Context - what exists today (read, not inferred)

### Five copies of the number, three different values

| # | Where | What it says | Kind |
|---|---|---|---|
| 1 | SPEC-114 FR-11 (`specs/minspec/SPEC-114-refactorability-enablers/requirements.md`, "Dependency budget") | 1 for T1/T2, 3 for T3/T4, read from `.minspec/config.json` `dependencyBudget: { simple, complex }`, defaulting to 1 and 3 | Spec (unbuilt; recorded selection DQ-5 Option A) |
| 2 | #125 spec, "Proposed initial rule set", row `dependency-budget` (branch `agent/issue-125`) | "More than two new dependencies means infrastructure, not a feature." `check: judgement`. Its FR-1 places every rule *and threshold* in the constitution's `## Methodology` section; its INV-single-source says thresholds exist there only | Spec (unmerged) |
| 3 | `scripts/roles/dev.md:24` | "0-1 for simple, 2-3 for complex" | Dev-time role prose |
| 4 | `packages/minspec/src/lib/slash-commands.ts:155` | "Honour the dependency budget recorded in `CLAUDE.md` (0-1 for simple, 2-3 for complex)" | **Shipped** to adopters (Plan command guidance) |
| 5 | `.claude/commands/minspec-plan.md:20` | Same sentence as row 4 | Generated from row 4 |

Two observations from that table:

- **Row 4 cites a home that does not exist.** No `CLAUDE.md` records a dependency budget:
  a search of this repository for `0-1 for simple`, `2-3 for complex`, `more than two new`
  and `>2 new dep` (all `.md`, `.ts`, `.json`, excluding `node_modules`) returns only rows
  3 to 5 above and SPEC-114 itself. The shipped guidance points the authoring model at a
  file that is silent on the subject.
- **The values disagree today.** Rows 3 to 5 are ranges whose upper bounds are SPEC-114's 1
  and 3; row 2 is a single threshold of 2 for every tier. SPEC-114 DQ-5 already recorded
  Option A (1 for T1/T2, 3 for T3/T4, configurable); this spec carries that value and does
  not re-decide it.

### Why the two specs cannot just "cite each other"

They name different homes. SPEC-114 FR-11 says config; the #125 spec's FR-1 says the
constitution, as the *only* source, and its own Out of Scope says it never checks code or
diffs ("This spec checks documents"), so its `dependency-budget` row is a `judgement` rule
nothing counts. Only SPEC-114 counts. One of the two homes has to give way - that is
DQ-1.

### What the code has today

- **No `dependencyBudget` key exists.** `MinspecConfig` (`packages/minspec/src/lib/config.ts:42`
  onward) and `DEFAULT_CONFIG` (`config.ts:166-185`) carry no such field. The closest
  precedent for an optional key with a default is `ownershipDeclaration`
  (`config.ts:60`, default at `config.ts:179`).
- **`loadConfig` merges, and swallows a parse error.** `loadConfig` (`config.ts:222-235`)
  deep-merges the user's object over `DEFAULT_CONFIG` (`deepMerge`, `config.ts:188-201`), so
  a partial user object such as `{ "simple": 1 }` would come back completed from the
  default if the default sat in `DEFAULT_CONFIG`; and invalid JSON returns `DEFAULT_CONFIG`
  (`config.ts:232-234`). FR-1 keeps the default out of `DEFAULT_CONFIG` for that reason. A
  key absent from the defaults passes through `deepMerge` untouched (the `else` branch,
  `config.ts:195-197`), so the user's raw value reaches the reader.
- **Nothing counts dependencies.** `git-analyzer.ts:188-210` sets a boolean
  `hasNewDependencies`; SPEC-114 FR-11 specifies the counter. Neither reads a budget.

## Functional Requirements

### The home

- **FR-1 - One home: `dependencyBudget` in `.minspec/config.json` (DQ-1).** The project's
  budget is the value of that key. MinSpec's default is declared once, as an exported
  `DEFAULT_DEPENDENCY_BUDGET` constant in `packages/minspec/src/lib/config.ts` - deliberately
  **not** an entry of `DEFAULT_CONFIG`, because `loadConfig`'s deep merge would complete a
  partial user value from it and FR-4 could never see the partial value. No
  other file in the repository - code, shipped prose, role prose, constitution - states a
  budget number (FR-7, FR-8). Specs and decision records may *quote* a number as history
  (SPEC-114 DQ-5, the #125 spec's Source column); requirement text cites FR-1 instead.

- **FR-2 - Contract (fixed here, before implementation).**

  ```ts
  /** New-package budget per change, by tier band. Both are non-negative integers. */
  export interface DependencyBudget {
    readonly simple: number;   // T1 and T2 (one-sentence spec; spec plus plan)
    readonly complex: number;  // T3 and T4 (full cycle; complete ceremony)
  }

  export type DependencyBudgetResolution =
    | { readonly ok: true; readonly budget: DependencyBudget; readonly source: 'config' | 'default' }
    | { readonly ok: false; readonly reason: string };  // names the key and the offending value

  export const DEFAULT_DEPENDENCY_BUDGET: DependencyBudget;

  /** Pure: no fs, no vscode, no network. Takes the already-loaded config; validates the
   *  user's value as written, because the key is absent from DEFAULT_CONFIG. */
  export function resolveDependencyBudget(config: MinspecConfig): DependencyBudgetResolution;

  /** The one tier-to-band mapping. */
  export function budgetForTier(budget: DependencyBudget, tier: Tier): number;
  ```

  `MinspecConfig` gains `readonly dependencyBudget?: unknown` - typed `unknown` because it
  is the user's unvalidated value; only the reader's `ok: true` arm carries a
  `DependencyBudget`. Both functions live
  in `config.ts` beside the type, so the key, its default, its validation and its tier
  mapping sit in one file.

- **FR-3 - Absent means default, said out loud.** A config with no `dependencyBudget` key
  resolves to `DEFAULT_DEPENDENCY_BUDGET` with `source: 'default'`. Every surface that shows a
  budget result (SPEC-114 FR-13) shows the source, so "using MinSpec's default" is visible,
  not implied.

- **FR-4 - Invalid means not run, never a silent fallback (constitution invariant 2).** A
  `dependencyBudget` that is not an object with both `simple` and `complex` as non-negative
  integers resolves to `ok: false` with a reason naming the key and the value. SPEC-114's
  checker then emits its existing `check-not-run` finding (SPEC-114 FR-12) carrying that
  reason, and emits no `dependency-over-budget` finding. It never substitutes the default
  for a value the user wrote and the reader could not use.

- **FR-5 - Scaffold does not write the key.** `scaffold()` leaves `dependencyBudget` out of
  a new `.minspec/config.json`. Writing it would copy the default into every adopter's
  config, a second home that silently stops tracking a changed default.

### The consumers cite it

- **FR-6 - Every reader goes through `resolveDependencyBudget`.**
  - **SPEC-114 FR-11** is amended (this spec's Implement, in the same pull request as
    FR-1) to drop its restated defaults and the config-key description and to read:
    "compared with `budgetForTier(resolveDependencyBudget(config).budget, tier)`
    (SPEC-414 FR-1 to FR-4)". SPEC-114 DQ-5's text and recorded selection stay as the
    history of how the values were chosen.
  - **The #125 spec's `dependency-budget` row** states no number. Its statement becomes:
    "A change adds no more new packages than the project's dependency budget
    (`dependencyBudget` in `.minspec/config.json`, SPEC-414)." Its check stays `judgement`
    (DQ-2). Its FR-1 and INV-single-source gain one named exception: "except the dependency
    budget, whose number lives in config per SPEC-414; the rule's text lives here." The
    Source column keeps the DR-359 quote as provenance. That spec is unmerged and is
    edited on its own branch, not by this spec's Implement: whichever of the two reaches
    `main` second applies the edit, and FR-8 refuses the constitution text if the old
    "more than two" wording is copied into it.

- **FR-7 - Prose surfaces name the home, never a number.**
  - `slash-commands.ts:155` becomes: "Honour the project's dependency budget
    (`dependencyBudget` in `.minspec/config.json`; MinSpec's default applies when the key
    is absent)." This also removes the false claim that `CLAUDE.md` records it.
  - `.claude/commands/minspec-plan.md` is regenerated from it, not hand-edited.
  - `scripts/roles/dev.md:24` becomes: "MUST NOT introduce new dependencies beyond the
    dependency budget (`dependencyBudget` in `.minspec/config.json`, default
    `DEFAULT_DEPENDENCY_BUDGET` in `packages/minspec/src/lib/config.ts`)."
  - `slash-commands.ts:172` and `:180` already mention the budget without a number and are
    unchanged.

### The gate

- **FR-8 - A drift gate fails when a budget number reappears outside its home.** A new test,
  `packages/minspec/tests/dependency-budget-home.test.ts`, reads a fixed list of surfaces -
  every `*.ts` under `packages/*/src`, every file under `scripts/roles/` and
  `.claude/commands/`, `CLAUDE.md`, and `.minspec/constitution.md` - and fails, naming file
  and line, on any match of a budget-number phrasing: a range or count followed by "for
  simple" / "for complex", or "more than N" / ">N" followed by "new dep" (case-insensitive,
  N a digit or a number word). The test also asserts the scanned-file count is above zero for each listed root, so
  a moved directory fails the gate rather than passing it on an empty set (constitution
  invariant 2; "empty output is not absence"). Specs and decision records are not scanned:
  they record history (FR-1).

- **FR-9 - Mutation witness.** The same test file holds a fixture case per phrasing that
  FR-8 must catch (the five rows of the Context table, verbatim) and two that it must not
  ("the dependency budget", "budget 2% of the weekly budget"), so the pattern is pinned by
  both directions rather than by a green run over a clean tree.

## Acceptance Criteria

- **AC-1.** With no `dependencyBudget` key, `resolveDependencyBudget` returns `ok: true`,
  `source: 'default'`, and `DEFAULT_DEPENDENCY_BUDGET`; `budgetForTier` returns the
  `simple` value for T1 and T2 and the `complex` value for T3 and T4.
- **AC-2.** With `dependencyBudget: { simple: 0, complex: 5 }`, the result is `source:
  'config'` with those values, and SPEC-114's checker (once built) reports a T1 change
  adding one new package as over budget with budget 0.
- **AC-3.** Each of `{ simple: -1, complex: 3 }`, `{ simple: 1 }`, `{ simple: 1.5, complex: 3 }`,
  `"3"` and `[1, 3]` resolves to `ok: false`, including when it is read through
  `loadConfig` from a real `.minspec/config.json` (so the partial object is not completed by
  the merge), with a reason naming `dependencyBudget`; SPEC-114's
  checker emits `check-not-run` and no `dependency-over-budget` finding.
- **AC-4.** A config created by `scaffold()` has no `dependencyBudget` key.
- **AC-5.** On the tree after Implement, FR-8's gate passes; re-inserting any one of the five
  Context-table sentences into any scanned surface makes it fail, naming that file and line.
- **AC-6.** `DEFAULT_DEPENDENCY_BUDGET` is declared once; `slash-commands.ts`,
  `.claude/commands/minspec-plan.md` and `scripts/roles/dev.md` contain no budget number.
- **AC-7.** SPEC-114 FR-11's text contains no budget number and cites SPEC-414.

## Invariants

- **INV-1 - Offline (constitution invariant 1, DR-004).** The reader is pure over an
  already-loaded config; no network call, no model call, no new package.
- **INV-2 - No silent gate (constitution invariant 2, DR-066).** An unreadable budget
  produces a visible `check-not-run`, never a default and never "within budget" (FR-4). The
  drift gate fails on an empty scan (FR-8).
- **INV-3 - Blast radius (constitution invariant 3, DR-074).** The key is read only from the
  opted-in project's own `.minspec/config.json`; scaffold writes nothing new (FR-5).
- **INV-4 - Classification untouched.** Nothing here changes `git-analyzer.ts`'s
  `dependency_change` signal or any tier outcome (SPEC-114 FR-11b).
- **INV-5 - One number, one home.** After Implement, the budget value is declared once in
  code (FR-1). FR-8 enforces this for prose phrasings on the scanned surfaces; a bare numeric
  literal in code that duplicates the default is not detectable lexically and is left to
  the rule that every reader calls `resolveDependencyBudget` (FR-6), which SPEC-114's own
  tests exercise.

## Decisions needed (Clarify)

### DQ-1 - Where does the number live?

- **Option A - the constitution's `## Methodology` section**, as `check:` parameters on the
  `dependency-budget` row (for example `dependency-count(simple=1, complex=3)`), read by the
  #125 spec's shared reader; SPEC-114 reads it through that reader and drops its config key.
  Matches the #125 issue's ask ("live in the constitution as the single source") and that
  spec's FR-1, where every other threshold (`followup-count(max=5)`) already lives.
  *Cost:* SPEC-114's budget slice cannot be built until the #125 spec is approved and its
  reader ships - that spec has been unmerged since 2026-10-03; the #125 checker must learn a
  check id it does not run (its Out of Scope excludes diffs); and tuning a number DQ-5 calls
  unmeasured becomes a constitution edit.
- **Option B - `.minspec/config.json` `dependencyBudget`, default in `DEFAULT_DEPENDENCY_BUDGET`; the
  #125 rule keeps its text in the constitution and cites the key (rec).** The only home that
  depends on nothing unbuilt; the key has a typed reader and the `ownershipDeclaration`
  precedent; the unmeasured numbers are cheap to tune. *Cost:* the #125 spec's FR-1 and
  INV-single-source gain one named exception, so a reader of the constitution alone sees the
  rule but not its number, and the #125 issue's "constitution as single source" is narrowed
  for this one threshold.
- **Option C - a code constant only, no override.** Simplest; nothing to validate. *Cost:*
  contradicts SPEC-114 DQ-5's recorded "configurable" and leaves adopters no way to tune a
  number nobody has measured.

**Recorded selection: the recommended option,** Option B, the budget lives in
`.minspec/config.json` `dependencyBudget` with its default in `DEFAULT_DEPENDENCY_BUDGET`, and the #125
rule cites it. Agent pick of the recommended option, no human chose it; founder decision,
queue item clarsel (2026-11-17), DR-123, recorded 2026-11-24; sign-off ratifies it.

### DQ-2 - What happens to the #125 spec's `dependency-budget` row?

- **Option A - keep it as a `judgement` rule that cites the key and states no number
  (rec).** The authoring model and any Tier-1 reviewer are still prompted about dependencies
  at spec and plan time, before any package is added; SPEC-114 counts them at change time.
  *Cost:* two artifacts still mention the budget (one counts, one prompts), so the rule text
  can drift in wording even though FR-8 stops it drifting in number.
- **Option B - remove the row; SPEC-114's count is the whole guardrail.** One mention, no
  wording drift. *Cost:* nothing raises dependencies at spec time; the first signal arrives
  after the packages are already in the diff.

**Recorded selection: the recommended option,** Option A, the #125 row stays a `judgement`
rule citing `dependencyBudget` and states no number. Agent pick of the recommended option,
no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded
2026-11-24; sign-off ratifies it.

## Out of Scope

- **The budget values themselves.** Settled by SPEC-114 DQ-5 (1 for T1/T2, 3 for T3/T4).
- **Counting packages.** SPEC-114 FR-11 and FR-11a.
- **The `hasNewDependencies` heuristic** (`git-analyzer.ts:188-210`). SPEC-114 Follow-ups
  item 4, tracked in `docs/backlog.md`.
- **Moving `config.ts` or the reader into `@aiclarity/shared`.** Only `packages/minspec`
  reads the budget today; a move is cheap later if a second package needs it.
- **Any other methodology threshold** (for example `followup-count(max=5)`). They stay in the
  constitution per the #125 spec.

## Costly to Refactor

1. **FR-2's `DependencyBudget` shape and config key name.** Once adopters write the key,
   renaming it or changing `simple`/`complex` to per-tier fields needs a migration.
   Everything else here (prose wording, gate patterns, the default values) is a one-line
   change.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| The #125 spec merges with its old "more than two" row and copies it into the constitution. | FR-8 scans `.minspec/constitution.md` and fails on that phrasing. |
| A new phrasing slips past FR-8's patterns. | FR-9's fixtures pin the known phrasings; a new one is added as a fixture when found. |
| The gate's file list goes stale (a directory moves). | FR-8 fails on a zero-file scan per root. |
| Adopters never set the key, so the default is everyone's budget. | Intended; FR-3 shows `source: 'default'` so it is never mistaken for a chosen value. |
| A `.minspec/config.json` that is not valid JSON makes `loadConfig` return defaults for every key (`config.ts:232-234`), so a budget the user did write is silently replaced. | Pre-existing behaviour for every config key, not changed here. FR-3's visible `source: 'default'` is the signal: a user who set the key and sees "default" has a broken config file. |

## Decision record

None. Moving the number between config, constitution and a constant is a one-file change
plus the gate's list, undoable in under a day (DR-359 ADR filter); `docs/decisions/INDEX.md`
holds no decision on the dependency budget (searched for "budget" and "single source":
the only hit is DR-106's weekly-token budget, unrelated). FR-2's shape is the one costly
item and is fixed by this spec's approval.

## Follow-ups (tracked)

None. The #125 spec's row edit is FR-6 (applied by whichever spec reaches `main` second,
backstopped by FR-8); SPEC-114's FR-11 edit is part of this spec's Implement.

## Traceability

- Issue: [#4021](https://github.com/AIClarityAU/minspec/issues/4021).
- Parent: SPEC-114 (refactorability enablers) Follow-ups item 5 and DQ-5; issue #133.
- Sibling: the methodology guardrail spec for #125 (branch `agent/issue-125`).
- Decisions rested on: DR-023 (follow-ups materialize), DR-066 (no silent gate), DR-074
  (blast radius), DR-004 (Tier 0), DR-123 (who closes Clarify on a T3 spec).
