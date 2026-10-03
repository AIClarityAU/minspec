---
id: SPEC-112
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - "the methodology rules enforced by the extension rather than by convention" is this epic's Done line
aspects: [methodology, self-audit, constitution, validator, advisory, tier-0, contracts, anti-slop]
relates_to: [DR-029, DR-030, DR-004, DR-020, DR-026, DR-053, DR-066, DR-074, DR-086, SPEC-013, SPEC-016, SPEC-010, SPEC-025, "#125", "#127", "#91"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3). All four
# files are NEW and exist under every Clarify answer below: the contract plus pure reader
# (FR-2 to FR-4, FR-12), the Tier-0 checker (FR-5 to FR-10), and the two tests that pin them
# (AC-1 to AC-9).
implements: [packages/shared/src/methodology.ts, packages/minspec/src/lib/methodology-check.ts, packages/minspec/tests/methodology-rules.test.ts, packages/minspec/tests/methodology-check.test.ts]
# Modified, not owned. Each gains a call or an export, not a mechanism. constitution.md gains
# the section DQ-1 decides on; it is written by a human-reviewed change, never by the checker.
affects: [packages/minspec/src/lib/spec-validator.ts, packages/minspec/src/lib/slash-commands.ts, packages/shared/src/index.ts, scripts/validate-frontmatter.ts, .minspec/constitution.md]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-112: Methodology-deviation guardrail - flag where a spec or DR departs from the project's own method

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers the questions under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the
> normal spec-approval gate before any code changes. Every requirement below is written
> under each decision's recommended option; choosing a different option changes only the
> requirements that decision names. No selection has been recorded on the human's behalf.

Materializes **[#125](https://github.com/AIClarityAU/minspec/issues/125)** - *"feat:
methodology-deviation guardrail - flag SDD/CDD deviations in specs/DRs."* The issue was
parked from the review of [DR-029](../../../docs/decisions/DR-029.md) (the self-audit
appendix decision), where asking "in what ways does this deviate from our method?" by hand
surfaced seven real deviations. The request is for MinSpec to raise that question itself.

**Id note.** `SPEC-096` is the highest spec id on `main` (`350c6fa4`), but ids 097 to 111
are claimed by local agent branches not yet merged (111 by `agent/issue-114`,
`opt-in-difficulty-assessment`), read from the refs of the shared git directory on
2026-10-03. This spec takes the next one, 112. The read was offline: a spec claimed only in
an open pull request whose branch is not in this checkout is invisible to it, and another
dispatch minting in the same minute would pick the same number. If the id collides at
review time, renumber.

**Tier note.** Triage gave T3 (full spec cycle). The change adds two source modules and two
tests and touches five existing files across `packages/shared`, `packages/minspec` and
`scripts/`, which is one package boundary and well under the classifier's top-tier marks.
T3 stands.

## One-Sentence Scope

Let a project write its method as slug-named rules in one section of
`.minspec/constitution.md`, have every unapproved T3/T4 spec and DR state how it stands
against each rule in a `Methodology Fit / Deviations` section, and have the offline
validator report - as an advisory that never blocks - each rule the artifact left
unaddressed and each machine-checkable rule it breaks without saying so.

## Context - what exists today (read from `main` at `350c6fa4`, not inferred)

### The rules have no home in this repository

The issue lists six rules: ceremony proportional to tier, vertical slice, dependency budget,
contracts first, invariant tests first, and the reversibility filter for decision records.
It says they should "live in the constitution as the single source". Today they do not live
anywhere in this repository as rules:

| Rule | Where it is written today |
|---|---|
| Ceremony proportional to tier | As code: `packages/minspec/src/lib/config.ts:134-137` (tier to required phases). Checked for split-layout spec directories by validator Rule 7 (`scripts/validate-frontmatter.ts:242-273`, calling `validateSplitLayoutCoverage`). |
| Vertical slice | Nowhere in this repo as a rule. Named in DR-029 §8 and its deviation table. |
| Dependency budget | One line of role prose: `scripts/roles/dev.md:24` ("0-1 for simple, 2-3 for complex"). |
| Contracts first | Nowhere as a rule. Asserted in passing by SPEC-013 FR-12 (the parse contract). |
| Invariant tests first | One line of role prose: `scripts/roles/approvable-reviewer.md:56` ("T0-invariant-first ordering"). |
| Reversibility filter | CLAUDE.md prose and the architect role prompt. |

The constitution (`.minspec/constitution.md`) has Invariants, Principles, Constraints,
Goals, Phases and a Glossary, and no methodology section. Its reader extracts three sections
(`parseConstitution`, `packages/minspec/src/lib/constitution.ts:128-140`) and the proposer's
schema names four (`CONSTITUTION_SECTION_SCHEMA`,
`packages/minspec/src/lib/constitution-proposer.ts:46-48`).

The source text for five of the six rules is a decision in the **parent** register, outside
this repository: `DR-359` (Contract-Driven Development, in the mmo-platform decisions file,
entry dated 2026-05-26). It was read for this spec from the operator's machine. Its wording is
quoted where a rule below depends on it, because a link there resolves to nothing for a
reader of this repo alone.

### The mechanism the issue wants to extend is specified, not built

- **The self-audit section registry** belongs to SPEC-013 (self-audit section enforcement,
  FR-1). Its own frontmatter records that the registry, the shared section predicate, the
  per-requirement disposition check and the zone divider "have zero implementation"
  (`specs/minspec/SPEC-013-risk-section-policy/requirements.md:10-20`). A search of
  `packages/*/src` and `scripts/` for `self-audit`, `selfAudit`, `sectionRegistry` and
  `core-end` returned no file on this tree.
- **The reality-check reviewer** belongs to SPEC-016 (reality-check and round-table) in the
  agent-execute product. A search of `packages/` and `scripts/` for `reality-check` and
  `realityCheck` found two test files and no implementation. Agent-execute ships from a
  separate repository (`AIClarityAU/sealbox`), which was not read for this spec, so its
  state there is **unverified**.
- **An advisory surface at approval already exists.** Approve Spec runs `validateSpec`,
  keeps the warnings, and shows them in a non-modal toast after approving
  (`packages/minspec/src/commands/approve.ts:272-279`, `:419-423`). The corpus validator has
  a non-fatal `warn()` path used by several rules (`scripts/validate-frontmatter.ts:97`).
- **The deviation row already has an id code.** DR-053 (paragraph-addressable references)
  lists "Methodology-fit deviation" with code `DV` (`docs/decisions/DR-053.md:120`).
- **One worked example exists.** DR-029 carries a hand-written
  `## Methodology Fit / Deviations` table with seven rows and a closing "Consistent with"
  line (`docs/decisions/DR-029.md:245-260`). This spec turns that shape into a contract.

### What this means for the design

The issue's three placements (a self-audit section, a warning at approval, rules anchored in
the constitution) each lean on something unbuilt. The one piece that depends on nothing
unbuilt is: rules in the constitution, a section in the artifact, and a Tier-0 check that
compares the two. That is the slice this spec specifies. The registry entry and the
reviewer lens are attached to it as contracts for their owners, not built here.

## Functional Requirements

### The rules - one source, in the constitution

- **FR-1 - A `## Methodology` section in the constitution is the only source of rules.**
  The checker holds no rule text, no rule list and no threshold. Adding, removing, rewording
  or re-thresholding a rule is an edit to `.minspec/constitution.md` and to nothing else.
  (DQ-1.)

- **FR-2 - Rule grammar (contract, fixed here before implementation).** Each rule is one
  numbered list item in that section, in this form:

  ```
  1. **vertical-slice - Build one end-to-end slice before widening.** <statement, free prose>
     `check: judgement` `applies: spec, dr` `min-tier: T3`
  ```

  - **slug** - lowercase letters, digits and hyphens, unique within the section. The slug is
    the rule's identity; the list number is display only, so reordering never renames a rule.
  - **`check:`** - either `judgement`, or a deterministic check id with optional named
    parameters, for example `followup-count(max=5)`. Exactly one per rule.
  - **`applies:`** - `spec`, `dr`, or both. Default both.
  - **`min-tier:`** - `T1` to `T4`. Default `T3`.

  The list number, the bold lead and the three backticked tags are the whole grammar.
  Everything else in the item is prose for the human and the authoring model.

- **FR-3 - One pure reader, in `@aiclarity/shared`.** A single function takes the
  constitution text and returns the rule list plus a list of problems. It imports nothing
  from `vscode`, the filesystem or the network (constitution constraint 1). The Tier-0
  checker and any Tier-1 reviewer read rules through it and through nothing else. Contract:

  ```ts
  export type MethodologyCheck =
    | { kind: 'judgement' }
    | { kind: 'deterministic'; id: string; params: Readonly<Record<string, string>> };

  export interface MethodologyRule {
    slug: string;
    title: string;
    statement: string;
    check: MethodologyCheck;
    appliesTo: ReadonlyArray<'spec' | 'dr'>;
    minTier: 'T1' | 'T2' | 'T3' | 'T4';
    line: number;            // 1-based line in the constitution, for the finding's citation
  }

  export interface MethodologyRuleSet {
    rules: MethodologyRule[];
    problems: MethodologyFinding[];   // kind 'malformed-rule' only
  }
  ```

- **FR-4 - A missing section means the guardrail is off, and that is not a finding.** A
  project whose constitution has no `## Methodology` section gets no methodology finding of
  any kind, on any surface. Writing the section is how a project opts in (constitution
  invariant 3, principle 4). A section that is present but holds a malformed item is
  different: see FR-10.

### The declaration - a section in the artifact

- **FR-5 - Section and row grammar (contract).** The section heading is
  `## Methodology Fit / Deviations`. It holds a table and one closing line, the shape DR-029
  already uses:

  ```
  | # | Rule | Deviation | Disposition |
  |---|---|---|---|
  | DV-1 | vertical-slice | Designs all three surfaces at once | Resolved - FR-13 slices the build |
  | DV-2 | contracts-first | Verdict shape not fixed here | Deferred - #NNN |

  Consistent with: ceremony-tier, adr-filter.
  ```

  - The **Rule** cell holds exactly one slug from the constitution.
  - The **Disposition** cell starts with one word from a closed set: `Resolved`,
    `Mitigated`, `Deferred`, `Accepted`, `Open`.
  - `Consistent with:` lists the slugs the author claims no deviation from.
  - `DV-n` is the DR-053 code for these rows; the checker reads the slug, not the number.

- **FR-6 - Every applicable rule gets an explicit disposition.** For an in-scope artifact
  (FR-11), each rule that applies to it by kind and tier must appear either in a table row
  or in the `Consistent with:` line. A rule appearing in neither is a finding of kind
  `rule-unaddressed`, naming the rule. A slug appearing in both is `rule-contradicted`. This
  is the per-requirement disposition idea from SPEC-013 FR-3 turned on the rule list: it
  cannot tell whether the author thought well, but it can tell that no rule was skipped, and
  a wall of rules under "Consistent with" is visible at a glance.

- **FR-7 - A `Deferred` or `Open` row names where the work is tracked.** Such a row whose
  Disposition cell carries no issue number, `SPEC-NNN` or `DR-NNN` is a finding of kind
  `deferral-untracked`. (The traceability convention in CLAUDE.md calls a prose-only
  follow-up a leak; this is that rule, checked.)

- **FR-8 - A row naming a slug the constitution does not define is `unknown-rule`.** It is
  never dropped silently and never treated as satisfying any rule.

### The check - Tier-0, offline, advisory

- **FR-9 - Deterministic checks are a closed set of ids in code; rules select and
  parameterise them.** v1 ships three:

  | Check id | What it measures | Limit, stated |
  |---|---|---|
  | `ceremony-coverage` | The existing `validateSplitLayoutCoverage` result for the spec's directory. Called, not reimplemented. | Specs only; says nothing about a DR. |
  | `followup-count(max=N)` | Number of list items under the artifact's `## Follow-ups (tracked)` heading; violated when above `N`. | Counts items, not their size. |
  | `phase-in-lifecycle` | Every key under frontmatter `phases:` is a member of `PHASES` (`packages/minspec/src/lib/config.ts:11`), read at run time, never copied. | Sees frontmatter only. A phase introduced in prose, as DR-029 introduced `cross-checks`, is not seen. |

  For a deterministic rule, the checker compares its own result with the artifact's
  declaration:

  | Check says | Artifact says | Finding |
  |---|---|---|
  | violated | a row for that slug | `deviation-declared` - listed, not a warning |
  | violated | `Consistent with`, or nothing | `deviation-undeclared` - advisory warning, with the measured value |
  | not violated | anything | none from this check |

  Plan must confirm that no existing validator rule already reports an unknown `phases:`
  key before adding `phase-in-lifecycle`. A search of `spec-validator.ts` and `lifecycle.ts`
  for such a check found none, but that search was by name and is **not** proof of absence.

- **FR-10 - Nothing about the rules fails quietly (constitution invariant 2 in spirit; this
  is an advisory, not a gate).** With the section present:
  - an item that does not parse is `malformed-rule`, citing the constitution line;
  - a `check:` id the running build does not implement is `check-unavailable`, naming the
    rule, and the rule is then treated as a judgement rule for FR-6 rather than skipped;
  - a parameter that is missing or not a number where one is required is `malformed-rule`.

  Each is reported once per validator run, not once per artifact.

- **FR-11 - In scope: unapproved artifacts only.** The checker reports on a spec that has no
  current approval and on a DR whose status is `proposed`. An approved spec or an accepted
  DR is hash-locked: a finding there has no remedy that does not void the sign-off, so it is
  noise (constitution principle 4). Approval state is taken from the existing resolver in
  `packages/minspec/src/lib/approval.ts`, not re-derived. Within scope, a rule applies when
  the artifact's kind is in `applies:` and its tier is at or above `min-tier:`. An artifact
  with no readable tier is checked against no rule and produces one `tier-unreadable`
  finding. (DQ-3.)

- **FR-12 - Finding contract.** One shape for every source, exported from
  `@aiclarity/shared`:

  ```ts
  export type MethodologyFindingKind =
    | 'rule-unaddressed' | 'rule-contradicted' | 'unknown-rule'
    | 'deferral-untracked' | 'deviation-undeclared' | 'deviation-declared'
    | 'malformed-rule' | 'check-unavailable' | 'tier-unreadable'
    | 'judgement-deviation';            // Tier-1 only (FR-15)

  export interface MethodologyFinding {
    kind: MethodologyFindingKind;
    rule: string | null;                // slug; null only for tier-unreadable
    artifact: string | null;            // SPEC-NNN / DR-NNN; null for constitution problems
    path: string;                       // repo-relative file the finding points at
    line: number | null;
    evidence: string;                   // the measured value or quoted text - never empty
    remedy: string;                     // one line
    source: 'tier-0' | 'tier-1';
    advisory: true;                     // literal: no consumer may treat a finding as blocking
  }
  ```

- **FR-13 - Two surfaces in v1, both existing.**
  1. `npm run validate` prints each finding except `deviation-declared` through the
     existing non-fatal `warn()` path. This rule MUST NOT make the validator exit non-zero.
  2. Approve Spec shows them through the existing `validateSpec` warning path and its
     existing toast. No new dialog, no new click, no change to what blocks approval.

  Whether Accept ADR has an equivalent advisory path was not established for this spec
  (`packages/minspec/src/commands/adr.ts` shows input validation only, **unverified** beyond
  that). If it has none, DRs are covered by surface 1 alone in v1 and the gap is a named
  follow-up, not a silently narrower scope. (DQ-4.)

- **FR-14 - The authoring guidance asks for the section, and only when rules exist.** The
  shipped Specify guidance (`packages/minspec/src/lib/slash-commands.ts`) and the DR
  template guidance tell the authoring model to write `## Methodology Fit / Deviations`
  against the constitution's rules when the section in FR-1 exists. No scaffold emits an
  empty stub of it (SPEC-013 FR-5: empty self-audit stubs are the approval-time flood).

### The reviewer half - a contract for its owner, not built here

- **FR-15 - Judgement rules get no Tier-0 verdict.** For a `check: judgement` rule the core
  checks only FR-6 to FR-8: that the artifact addressed it. Whether a "Consistent with"
  claim is true is a question for a reasoning reviewer. That reviewer is a lens of the
  reality-check agent, lives in agent-execute, and is specified there (DQ-5). This spec
  fixes only what crosses the boundary:
  - **in:** the `MethodologyRuleSet` from FR-3 and the Tier-0 findings, passed as
    exclusions ("already reported, do not repeat" - SPEC-016 FR-2);
  - **out:** `MethodologyFinding[]` with `source: 'tier-1'` and kind
    `judgement-deviation`; a finding whose `evidence` quotes nothing from the artifact is
    dropped by the consumer (DR-029 risk R2, evidence or dropped);
  - artifact text reaches the model as untrusted data under DR-030 (reality-check
    isolation), unchanged.

  No model call, socket or child process is added to `packages/minspec` or
  `packages/shared` (constitution invariant 1).

- **FR-16 - The label says what ran.** Where findings are shown, the summary line states
  which half produced them: "machine-checked: N rules; self-declared only: M rules" when no
  reviewer verdict is present. It never says or implies "verified" (DR-029 §6: no trust
  claim before the validation study, tracked as #127).

### Sequencing

- **FR-17 - Built as three slices, each usable alone.**
  1. **Rules and reader** - FR-1 to FR-4, FR-10, FR-12. Visible result: the validator
     reports a malformed rule.
  2. **Declaration and checks** - FR-5 to FR-9, FR-11, FR-13, FR-14, FR-16. Visible result:
     the DR-029 backtest (AC-7).
  3. **Registry entry** - when SPEC-013's section registry exists, `Methodology Fit /
     Deviations` is added to it as one entry (specs and DRs, `min-tier` T3, cross-cutting,
     Zone B), and this spec's presence check is replaced by the registry's shared predicate
     so that two predicates never coexist (SPEC-013's single-predicate invariant). Until
     then slice 2 stands on its own. Slice 3 is a follow-up, not part of this spec's Done.

- **FR-18 - Turning the rules on here carries its measurement.** The change that adds
  `## Methodology` to this repository's constitution states, in its pull request body, the
  number of findings per rule on the then-current set of in-scope artifacts. A threshold
  chosen with no count behind it is the failure this guards against (DQ-2).

## Proposed initial rule set (what DQ-1 and DQ-2 ask the human to accept or change)

Approving this spec with DQ-1 Option A approves these seven as the text to place in the
constitution. Statements are drawn from the sources cited; where a source is the parent
register it is quoted.

| Slug | Statement | Source | v1 check |
|---|---|---|---|
| `ceremony-tier` | Ceremony follows the tier: the phases a tier requires are present, and a small change is not buried in a large one's ceremony. | `config.ts:134-137`; CLAUDE.md tier table | `ceremony-coverage` |
| `vertical-slice` | Build one thin end-to-end slice before widening; do not design the whole system at once. | DR-359 practice 2: "walking skeleton (one entity end-to-end) → flesh out stage by stage" | `judgement` |
| `dependency-budget` | More than two new dependencies means infrastructure, not a feature. | DR-359 practice 4: ">2 new deps = infrastructure not feature" | `judgement` |
| `scope-budget` | One decision or spec does not spawn more follow-up work items than the budget. | DR-029 deviation 3 ("one DR spawns ~7 work items") | `followup-count(max=5)` |
| `contracts-first` | A change that crosses a package or project boundary defines its contract before its implementation. | DR-359 practice 1 and 3 | `judgement` |
| `invariant-tests-first` | Invariant tests are written before the code they constrain. | DR-359 practice 1: "invariant tests before code" | `judgement` |
| `adr-filter` | A choice that cannot be undone in under a day has a decision record; one that can, does not. | DR-359 practice 7 | `judgement` |

`phase-in-lifecycle` ships as an available check id (FR-9) with no rule selecting it in this
proposal, because "a new phase must be propagated to every consumer" is not written as a
rule in any source read for this spec. DQ-1 covers adding it.

**What this does and does not deliver against the issue's own list.** The issue names three
deviations as deterministic: dependency count, contracts before implementation, and a new
phase missing from the lifecycle. v1 machine-checks follow-up count and frontmatter phases,
and treats dependency count and contracts-first as judgement rules, for stated reasons: a
spec has no field today that declares new dependencies or contracts. A `contracts:`
frontmatter field is specified by a spec still in flight on `agent/issue-23`
(`cdd-contract-frontmatter`, unmerged and unapproved); when it lands, `contracts-first` can
move to a deterministic check by a constitution edit plus one new check id.

## Acceptance Criteria

- **AC-1.** With no `## Methodology` section in the constitution, the validator's output
  and exit code on the corpus are byte-identical to the build before this change.
- **AC-2.** Changing `max=5` to `max=1` in the constitution changes which artifacts get
  `deviation-undeclared`, with no source file edited.
- **AC-3.** A rule item with a missing `check:` tag produces exactly one `malformed-rule`
  finding citing its constitution line, and the other rules still run.
- **AC-4.** A rule with `check: no-such-check` produces one `check-unavailable` finding and
  is still demanded under FR-6.
- **AC-5.** An in-scope T3 spec with no `Methodology Fit / Deviations` section produces one
  `rule-unaddressed` finding per applicable rule; the same spec at T2 produces none.
- **AC-6.** An approved spec and an accepted DR produce no methodology finding, whatever
  they contain.
- **AC-7 - DR-029 backtest.** A fixture holding DR-029's body with status `proposed`, once
  with its methodology section removed and once intact, is run against the proposed rule
  set. The expected finding list for both runs is written into the test before the checker
  exists and is shown red first. The author of this spec **believes, unverified**, that the
  stripped run yields seven `rule-unaddressed` findings and one `deviation-undeclared` for
  `scope-budget`; Plan replaces that belief with the measured list.
- **AC-8.** With every finding kind present on one artifact, `npm run validate` exits zero
  if it exited zero without them, and Approve Spec approves with the same clicks as before.
- **AC-9 - not vacuous.** Each check in FR-6 to FR-10 is removed one at a time and the
  suite is shown to turn red, with a clean control run.
- **AC-10.** `packages/shared/src/methodology.ts` imports nothing outside the package, and
  neither new module adds an entry to the child-process allowlist.
- **AC-11.** This spec's own `Methodology Fit / Deviations` section (below) parses under
  FR-5 and produces no `rule-unaddressed` finding against the proposed rule set.

## Costly to Refactor

Ranked most to least costly.

1. **Rule grammar in the constitution (FR-2).** Every project that writes the section
   adopts it. Changing it later means rewriting those sections and, if shipped to adopters,
   a migration. *Check: the three tags and the slug rule are what you want.*
2. **Slug as identity (FR-2, FR-5).** Artifacts cite rules by slug. Renaming a slug orphans
   every row that names it (they become `unknown-rule`, visibly). *Check: the seven slugs.*
3. **Finding contract (FR-12).** It crosses to agent-execute. *Check: the kind list.*
4. **Section and row shape (FR-5).** Lives in LLM-authored appendix text, so re-authoring
   is cheap; the closed disposition vocabulary is the part that bites.
5. **Cheap to reverse:** thresholds, which rule uses which check, `min-tier`, and the whole
   guardrail (delete the constitution section, FR-4).

## Invariants (must not break)

- **INV-offline (constitution invariant 1, DR-004).** No network call, model call or new
  child process in `packages/minspec` or `packages/shared`.
- **INV-advisory (DR-029 §4, DR-026).** No finding blocks an edit, a commit, a validator
  run or an approval. Approval by content hash (DR-012) stays the only blocking gate.
- **INV-never-writes.** The checker never writes to an artifact or to the constitution.
  Section content is written by the artifact's author.
- **INV-visible (constitution invariant 2).** A rule the build cannot check, or cannot
  parse, is reported; it is never skipped in silence and never counted as satisfied.
- **INV-opt-in (constitution invariant 3).** No behaviour change in a project whose
  constitution lacks the section; nothing is written outside the project.
- **INV-single-source.** Rule text and thresholds exist in the constitution only. A rule
  name or number appearing in checker source is a defect.
- **INV-no-nag (constitution principles 2 and 4).** No finding on an artifact that cannot
  be changed without voiding a sign-off; no toast at activation; none repeats unprompted.
- **INV-no-claim (DR-029 §6).** No surface describes an artifact as verified or
  methodology-compliant.
- **INV-boundaries (constitution constraints 1 to 3).** `@aiclarity/shared` stays free of
  editor and network imports; activation does no new work.

## Decisions needed (Clarify)

Each carries a recommendation and its cost. None has been selected for the human.

### DQ-1 - Where do the rules live, and is this the rule set?

- **Option A - a `## Methodology` section in `.minspec/constitution.md`, holding the seven
  proposed rules (rec).** What the issue asks for; one file a human already reads. *Cost:*
  the constitution grows by a section whose items carry machine tags, the proposer's
  four-section schema and the harness merge for that file must tolerate a fifth section
  (Plan must show they do), and five of the seven statements restate a parent-register
  decision locally, so the two can drift.
- **Option B - a separate `.minspec/methodology.md`.** Keeps the constitution prose-only.
  *Cost:* a second file to find, and it contradicts the issue's "single source"; a new
  project file is a format commitment that would need a decision record.
- **Option C - Option A with a different rule list.** Edit the table above before approving.
  Adding a `phase-propagation` rule selecting `phase-in-lifecycle` belongs here. *Cost:* a
  rule with no written source is one the reviewer lens has nothing to check against.

### DQ-2 - What does "dependency budget" count, and what are the numbers?

The phrase has two meanings in the sources. DR-359 means new package dependencies ("more
than two"). DR-029's deviation table used it for work items spawned by one decision
("about seven"). `scripts/roles/dev.md:24` gives a third figure.

- **Option A - two rules: `dependency-budget` (new packages, max two, judgement in v1) and
  `scope-budget` (follow-up items, `max=5`, machine-checked) (rec).** Each meaning keeps its
  own name. *Cost:* the 5 has no evidence behind it yet; FR-18 makes the enabling change
  report the count, and the number may need to move on first contact with the corpus.
- **Option B - one rule, new packages only.** Faithful to the one written source. *Cost:*
  nothing in v1 is machine-checked for budget, and the DR-029 deviation that prompted the
  issue would not be caught.
- **Option C - one rule counting `depends_on:` entries.** Measurable today. *Cost:* no
  source defines that as a budget, and 28 of 76 spec requirement files use the field at all.

### DQ-3 - Which artifacts are asked for the section?

- **Option A - unapproved specs and proposed DRs at T3 or T4 (rec).** Matches where human
  reading is already spent. 85 of 100 decision records carry a `tier:` field. *Cost:* a
  small change that breaks the method (the size-is-not-difficulty pocket DR-029 names as
  risk R6) is not asked, and a DR with no tier gets one `tier-unreadable` advisory.
- **Option B - every unapproved spec and DR.** *Cost:* a seven-rule table on a one-sentence
  T1 spec is the ceremony creep DR-029 risk R7 warns about.
- **Option C - T2 and up, one line allowed.** *Cost:* needs a second, shorter grammar.

### DQ-4 - Which surfaces in v1?

- **Option A - validator output and the existing approval toast only (rec).** Both exist.
  *Cost:* nothing appears while writing; the signpost note, a classifier flag and a CI soft
  rule the issue lists under "other places" wait for follow-ups.
- **Option B - also a signpost note.** *Cost:* the signpost shows one next human task; an
  advisory there competes with it, and its spec is approved and would need re-approval.

### DQ-5 - Who specifies the reviewer lens?

- **Option A - a new spec in the agent-execute product, written after this one is approved;
  this spec fixes only the FR-15 contract (rec).** *Cost:* until it exists, judgement rules
  are self-declared only, which is five of the seven, and FR-16's label says so every time.
- **Option B - amend SPEC-016.** *Cost:* it is approved and hash-locked, so the amendment
  voids its approval and re-opens review of an unrelated body.
- **Option C - put the lens in this spec.** *Cost:* it would specify code for another
  repository from a spec that cannot own it.

### DQ-6 - Ship the section in the template every new project gets?

- **Option A - no, not in this spec; this repository adds it to its own constitution and
  runs with it first (rec).** *Cost:* adopters get an inert feature until a follow-up.
- **Option B - yes, with the seven rules.** *Cost:* a template change is machinery, imposes
  a method on projects that chose only spec-driven development, and ships thresholds no
  corpus has tested.

## Why no new DR

Under the recommended options this applies decisions already in force: DR-029 (self-audit
family, advisory only, deterministic floor in core and judgement in agent-execute), DR-026
(offer, never silent write), DR-030 (untrusted input), DR-053 (the `DV` row code) and
constitution invariants 1 to 3. `docs/decisions/INDEX.md` was searched for an existing
decision on methodology checking; DR-029 is the one that covers it. Everything is undone by
deleting one constitution section (FR-4), inside a day. A decision record becomes necessary
if DQ-1 resolves to Option B (a new project file), if any finding is ever made blocking
(DR-029 rejected exactly that), or if rule ids move from slugs to a new DR-053 type code.
The spec must not proceed to Plan on any of those without one.

## Out of Scope

- **Building the section registry, zone divider or cross-checks lifecycle.** SPEC-013.
- **Building or prompting the reviewer lens.** Agent-execute; see DQ-5.
- **A signpost note, a classifier or triage flag, a CI soft rule.** The issue's "other
  places to consider"; follow-ups below.
- **Checking code or diffs against the method** (for example counting new packages in a
  pull request). This spec checks documents.
- **Re-checking approved or accepted artifacts**, including backfilling the section into
  the existing corpus.
- **Activating any "verified" wording.** #127 (trust claim on study threshold).
- **Scoring difficulty.** #91 and the in-flight `opt-in-difficulty-assessment` spec.
- **A structural analyze phase.** The in-flight `deterministic-analyze-phase` spec on
  `agent/issue-18` may later be a natural place to run this check; nothing here depends on
  it.

## Risks & Mitigations

| # | Risk | Likelihood · Impact | Mitigation |
|---|---|---|---|
| R1 | **"Consistent with: everything."** The author lists every rule as fine; FR-6 is satisfied and nothing was considered. | High · Med | Named, not hidden. Machine-checked rules contradict a false claim (FR-9); judgement rules wait for the lens (FR-15); FR-16's label never calls it verified. Residual until the lens exists. |
| R2 | **Advisory flood.** A threshold set too low fires on most of the corpus and trains the reader to ignore the line. | Med · High | Unapproved artifacts only (FR-11), count reported when rules are enabled (FR-18), threshold is a one-line edit (AC-2). |
| R3 | **Drift from the parent register.** The local statements and DR-359 diverge. | Med · Low | The constitution is the single source for this project (FR-1); the statements cite their origin. |
| R4 | **Two section predicates.** Slice 2's presence check and SPEC-013's future predicate coexist. | Med · Med | FR-17 slice 3 replaces, never adds; tracked as a follow-up. |
| R5 | **The constitution proposer or harness merge mangles a fifth section.** | Low · High | Plan shows a round trip of the file through both before any rule is added; AC-1 pins the no-section case. |
| R6 | **Id collision** with a concurrently written spec. | Med · Low | Id note; renumber at review. |
| R7 | **Sibling in-flight specs change `PHASES` or add frontmatter fields.** | High · Low | `phase-in-lifecycle` reads `PHASES` at run time; no field of theirs is required here. |

## Methodology Fit / Deviations

This spec checked against the rule set it proposes.

| # | Rule | Deviation | Disposition |
|---|---|---|---|
| DV-1 | contracts-first | The reviewer lens's prompt and its place in the reality-check verdict are not fixed here, only the finding shape that crosses the boundary. | Deferred - follow-up F-1, to be filed on approval; not yet an issue number |
| DV-2 | scope-budget | Six follow-ups against a proposed budget of five. | Accepted - five of the six are the issue's own "other places", listed so they are not lost, not work this spec creates |
| DV-3 | invariant-tests-first | The spec names its tests (AC-7, AC-9) but orders nothing; ordering is a tasks-phase matter. | Deferred - this spec's own tasks phase |

Consistent with: ceremony-tier, vertical-slice, dependency-budget, adr-filter.

DV-1 would itself draw a `deferral-untracked` finding under FR-7 until F-1 has a number.
That is the checker working as specified, and the reason is stated under Traceability.

## Alternatives considered and rejected

Recorded because this spec was written without a live conversation (DR-086 §4).

- **Rule text in the checker, constitution as documentation.** Rejected: the issue's point
  is that editing the rules is editing the constitution; two copies drift.
- **Wait for SPEC-013's registry and add one entry.** Rejected as the whole answer: the
  registry is unbuilt with no date, and the rule reader and deterministic checks do not
  need it. Kept as slice 3.
- **Make an undeclared deviation block approval.** Rejected: DR-029 rejected blocking by
  deterministic layers, and a judgement the tool cannot verify must not gate.
- **Report on the whole corpus, approved artifacts included.** Rejected: no remedy without
  voiding sign-offs.
- **Number the rules (`MR-1`) instead of slugs.** Rejected for now: `M` is taken in DR-053
  (Metric), a new code amends an accepted decision, and a number is renamed by reordering.
- **Infer deviations from prose with pattern matching** (for example flagging the word
  "phase" near a new term). Rejected: false positives with no evidence value; that is the
  reviewer lens's job.
- **Heuristic deterministic checks for `adr-filter` and `invariant-tests-first`.** Rejected
  in v1: neither tasks files nor reversibility statements have a grammar to read.

## Test plan (for the Plan phase to place)

- **Before implementation:** `methodology-rules.test.ts` (FR-2 to FR-4, FR-10) and
  `methodology-check.test.ts` (FR-5 to FR-9, FR-11), including the AC-7 backtest with its
  expected list written first and shown red.
- **Fixtures vary more than the code path:** zero, one and many rules; zero, one and many
  rows; a section with a table but no closing line and the reverse.
- **Not vacuous:** AC-9's one-at-a-time removals, each confirmed to land on the line meant.
- **Run the way CI runs it:** the suite under `npx vitest`, and the type check over the two
  new test files explicitly, since tests sit outside the compiler's include list.

## Traceability

- **Issue:** [#125](https://github.com/AIClarityAU/minspec/issues/125).
- **Governing decisions:** [DR-029](../../../docs/decisions/DR-029.md) (self-audit family
  and trust stack), [DR-030](../../../docs/decisions/DR-030.md) (reviewer isolation),
  [DR-004](../../../docs/decisions/DR-004.md) (tier model),
  [DR-026](../../../docs/decisions/DR-026.md) (offer, never silent),
  [DR-053](../../../docs/decisions/DR-053.md) (reference grammar),
  [DR-086](../../../docs/decisions/DR-086.md) (recording what was not taken).
- **Specs this leans on:**
  [SPEC-013](../SPEC-013-risk-section-policy/requirements.md) (section registry, unbuilt),
  [SPEC-016](../../agent-execute/SPEC-016-reality-check/requirements.md) (reality-check
  reviewer), [SPEC-025](../SPEC-025-constitution-proposer/requirements.md) (constitution
  proposer, whose schema the new section sits beside).
- **DR for this spec:** none; see "Why no new DR" for the conditions that would require one.
- **Follow-ups, NOT yet filed.** The dispatch that wrote this spec had no network access,
  so none of these has an issue number. They are to be filed when the spec is approved, and
  until then they are prose only, which the traceability convention calls a leak:
  - **F-1** - agent-execute spec for the methodology-fit reviewer lens (DQ-5).
  - **F-2** - registry entry and predicate swap once SPEC-013's registry exists (FR-17).
  - **F-3** - signpost note for an undeclared deviation (issue, "other places").
  - **F-4** - classifier or triage flag when scope exceeds the tier's ceremony budget.
  - **F-5** - the deterministic subset as a CI soft rule for adopters, and the template
    question (DQ-6).
  - **F-6** - move `contracts-first` and `dependency-budget` to deterministic checks once a
    frontmatter field for each exists; advisory path for Accept ADR if FR-13 finds none.
