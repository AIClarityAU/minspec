---
id: SPEC-275
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - the bytes MinSpec writes into every adopter's repository change with no spec saying what they may contain
aspects: [managed-files, template-registry, harness, ownership, contract, spec-gate, no-silent-gate, tier-0, offline]
depends_on: [SPEC-038]  # SPEC-038 owns the `implements:`/`affects:` convention this spec applies
relates_to: [SPEC-038, SPEC-066, SPEC-070, SPEC-075, SPEC-079, SPEC-215, SPEC-228, SPEC-247, DR-011, DR-037, DR-073, DR-089, DR-090, DR-092, "#2680", "#2675", "#247", "#1486"]
# Ownership is the subject of this spec, so it is NOT claimed during Specify: which of the five
# files this spec owns, and how, is Decision D1 below. Claiming now would arm SPEC-038/spec-gate
# on template-registry.ts the moment this spec enters the Plan band unapproved, freezing it for
# every other in-flight change (scripts/hooks/spec-gate.py:556-586, the SPEC-215 concern).
implements: none
implements_reason: >-
  Clarify answers are recorded but not ratified (D1-D3 option (a), D4 no). D1(a) gives this spec
  implements: for template-registry.ts, template-engine.ts and slash-commands.ts, but those are
  existing shared files, and claiming them before approval would freeze them for every other
  change (see the note above), so implements stays none until Plan.
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-275: The managed-file set has an owning spec that states its contract, and a change to that contract cannot ship without one

> **This is a SPECIFICATION ONLY.** Written for issue #2680 (part of #2675, the RCDD on values
> baked into managed files). Nothing is built until a human reads it, resolves
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

MinSpec writes 36 files into every repository that turns it on: 5 rendered harness files
(CLAUDE.md and friends) and 31 marker-bounded "managed regions" (CI workflows, git hooks, the
validator, review scripts, slash-command shims). What those files contain is decided by five
source files in `packages/minspec/src/lib/`. No spec owns any of them. Ten specs say they
*modify* the registry; none says what the registry *promises*. So a change to what every
adopter receives needs no Specify phase, and there is no written rule saying which parts of
a managed file an adopter's project is allowed to differ in.

This spec (1) writes that contract down, as a table the code is checked against, and
(2) makes a change to the contract's shape fail a check until the owning spec is updated,
which re-opens the spec's approval and so forces a human read.

It also corrects one inference in the issue: giving these files an `implements:` owner does
**not** by itself force a Specify phase for later changes (see Measured state, point 4).
Something else has to do that, and FR-5 is that something.

## Measured state (base `804a899d`)

1. **No owner.** No spec's `implements:` line names `template-registry.ts`,
   `ci-review-templates.ts`, `hook-templates.ts`, `template-engine.ts` or `slash-commands.ts`.
   Checked by grepping every `implements:` value under `specs/`; the only hits for these names
   inside `implements:` blocks are YAML comments (e.g. SPEC-215 `requirements.md:11-17`).
2. **Ten specs list `template-registry.ts` under `affects:` only**: SPEC-063, -066, -075, -079,
   -080, -081, -136, -215, -228, -247. Two of them carry a comment asserting the gap this spec
   closes: SPEC-075 `requirements.md:11` and SPEC-080 `requirements.md:11` ("claimed by no
   spec's implements:"). `ci-review-templates.ts` is under `affects:` of SPEC-066, -134, -216,
   -217, -222, -237, -241.
3. **The validator's corpus folder list entered with no spec.** Commit `8d471a19` (#247, PR
   #319) added 398 lines to `template-registry.ts`, including the shipped `validate.py`, which
   hard-codes `specs` and `docs/decisions` (`template-registry.ts:2150`, `:2176`) while the
   rendered harness text already admits a project may relocate `{{decisionsDir}}`
   (`template-registry.ts:569`). That is one instance of the #2675 class: a value a project may
   vary, baked into a byte-pinned managed region. SPEC-075 (status `planning`) specifies the
   repair for that one value; nothing states the rule for the class.
4. **An `implements:` owner does not force a Specify phase on later edits.** The spec-gate
   blocks an edit to a file only while the file sits in the owned set of a T3/T4 spec whose
   phases put it in the implementation band **and** whose approval is missing or stale
   (`scripts/hooks/spec-gate.py:556-586`). Once the owner is approved and its hash current, an
   edit to the owned file passes with no spec touched. `affects:` freezes exactly as hard as
   `implements:` (`spec-gate.py:382-384`), so moving a path between the keys changes the
   ownership graph, not the gate.
5. **What does gate these files today is the machinery check, and it covers two of five.**
   `template-registry.ts` and `ci-review-templates.ts` match the machinery regex
   (`scripts/dispatch-issue.sh:302`, `.github/scripts/ai-review-guard.js:1163`,
   `.github/workflows/ai-review.yml:635`; canonical source `machinery-paths.ts`), so their PRs
   need a human `--admin` merge. `template-engine.ts`, `slash-commands.ts` and
   `hook-templates.ts` do not match it. The machinery check forces a human merge keystroke, not
   a spec.
6. **Two of the five are generated.** `ci-review-templates.ts` and `hook-templates.ts` are
   base64 copies of this repo's own working files, regenerated by
   `node scripts/gen-ci-templates.mjs`; `npm run validate` fails when they are stale
   (`ci-review-templates.ts:1-15`, `hook-templates.ts:1-19`). Their real source is the files
   under `.github/`, `scripts/` and `.claude/hooks/`. Declaring a generated file under either
   key would make the spec-gate block the regeneration other specs require (the SPEC-070
   frontmatter records the same reasoning).
7. **The contract exists only in scattered prose.** DR-011 (marker-bounded refresh), DR-037
   (tool-independent gate harness), DR-073 (foreign-config merge), DR-089 (manifest records
   authorship), DR-090 (managed prose judged from the consumer's vantage), DR-092 (refresh
   only moves forward), and the `ManagedRegionTemplate` docstring ("project-independent and
   pinned so the region stays byte-stable across projects", `template-registry.ts:978-982`).
   DR-090 §4's `localize` registry field is not built: the one localisation is applied inline
   (`template-registry.ts:2597`) and no template object carries a `localize` key (computed over
   `MANAGED_REGION_TEMPLATES`, 31 entries, 0 with the key).

## The managed-file contract (as it stands at this base)

This section is the contract. FR-4 makes the code checkable against it; FR-5 makes a change
to it fail until this section is updated.

### C-1. The managed set

Two families, and membership in them is exactly "scaffolded and refresh-managed":

**Rendered harness files** (`TEMPLATE_NAMES`, `template-registry.ts:59-77`), Handlebars-rendered
by `template-engine.ts`, refreshed section-by-section against `.minspec/generated-hashes.json`
(DR-011, DR-089):

| Name | Output path |
|---|---|
| CLAUDE.md | `CLAUDE.md` |
| AGENTS.md | `AGENTS.md` |
| .cursorrules | `.cursorrules` |
| constitution.md | `.minspec/constitution.md` |
| labels.md | `.minspec/labels.md` |

**Managed-region files** (`MANAGED_REGION_TEMPLATES`, `template-registry.ts:2774`), written
byte-for-byte between start/end markers; a refresh replaces the region and preserves
everything outside it (DR-011, DR-037). Columns: comment style, executable bit, preamble,
tool-conditional, self-hosted (its source is this repo's own working file).

| Name | Output path | Style | Exec | Preamble | Cond | Self-hosted |
|---|---|---|---|---|---|---|
| validate-workflow | `.github/workflows/minspec-validate.yml` | hash | | | | |
| pre-commit-hook | `.minspec/hooks/pre-commit` | hash | yes | sh | | |
| commit-msg-hook | `.minspec/hooks/commit-msg` | hash | yes | sh | | |
| validate-py | `.minspec/hooks/validate.py` | hash | yes | python3 | | |
| ai-review-workflow | `.github/workflows/ai-review.yml` | hash | | | | yes (localised) |
| ready-to-merge-workflow | `.github/workflows/ready-to-merge.yml` | hash | | | | yes |
| ai-review-retry-workflow | `.github/workflows/ai-review-retry.yml` | hash | | | | yes |
| docs-lane-workflow | `.github/workflows/docs-lane.yml` | hash | | | | yes |
| secret-scan-workflow | `.github/workflows/secret-scan.yml` | hash | | | | yes |
| review-branch-script | `scripts/review-branch.sh` | hash | yes | bash | | yes |
| review-decide-script | `scripts/review-decide.sh` | hash | yes | bash | | yes |
| agent-context-lib | `scripts/lib/agent-context.sh` | hash | | bash | | yes |
| approval-provenance-script | `scripts/approval-provenance.py` | hash | yes | python3 | | yes |
| canonical-hasher-python | `scripts/hooks/canonical.py` | hash | yes | python3 | | yes |
| review-role-reviewer | `scripts/roles/reviewer.md` | html | | | | yes |
| review-role-security | `scripts/roles/security.md` | html | | | | yes |
| review-role-architect | `scripts/roles/architect.md` | html | | | | yes |
| review-role-skeptic | `scripts/roles/skeptic.md` | html | | | | yes |
| ai-review-guard | `.github/scripts/ai-review-guard.js` | slash | | | | yes |
| ai-review-guard-test | `.github/scripts/ai-review-guard.test.js` | slash | | | | yes |
| session-title-hook-wrapper | `.claude/hooks/session-title.sh` | hash | yes | bash | yes | yes |
| session-title-hook | `.claude/hooks/session-title.py` | hash | yes | python3 | yes | yes |
| slash-claude-constitution | `.claude/commands/minspec-constitution.md` | html | | frontmatter | yes | |
| slash-claude-specify | `.claude/commands/minspec-specify.md` | html | | frontmatter | yes | |
| slash-claude-clarify | `.claude/commands/minspec-clarify.md` | html | | frontmatter | yes | |
| slash-claude-plan | `.claude/commands/minspec-plan.md` | html | | frontmatter | yes | |
| slash-claude-tasks | `.claude/commands/minspec-tasks.md` | html | | frontmatter | yes | |
| slash-claude-analyze | `.claude/commands/minspec-analyze.md` | html | | frontmatter | yes | |
| slash-claude-implement | `.claude/commands/minspec-implement.md` | html | | frontmatter | yes | |
| slash-claude-checklist | `.claude/commands/minspec-checklist.md` | html | | frontmatter | yes | |
| slash-cursor | `.cursor/rules/spec-kit-commands.mdc` | html | | frontmatter | yes | |

(Extracted by importing `MANAGED_REGION_TEMPLATES` / `TEMPLATE_NAMES` at `804a899d`, not
transcribed from prose.)

### C-2. What a project may vary, and through which channel only

A project may differ from another project in exactly these ways. Anything not listed is
identical across every adopter.

| Variation point | Channel | Where |
|---|---|---|
| V-1 Project name, specs dir, decisions dir | Handlebars context at render time | `TemplateContext`, `template-engine.ts:19-26` |
| V-2 Constitution invariants, principles, constraints (lead sentences) | Handlebars context, from `.minspec/constitution.md` | same; `firstSentence` helper `template-engine.ts:35` |
| V-3 Which tool-specific files exist | `condition(detectedTools)` on the template | `ManagedRegionTemplate.condition`, `template-registry.ts:1003-1011` |
| V-4 Everything outside a managed region's markers | preserved by refresh | `spliceManagedRegion`; DR-011 |
| V-5 Edited sections of a rendered harness file | preserved by the hash-baseline refresh | DR-089, DR-092 |
| V-6 A setting a shipped script reads | `.minspec/config.json`, read **at run time** by the script, never baked into its bytes | e.g. `ownershipDeclaration`, `template-registry.ts:1944-1959` |

### C-3. Rules the managed bytes obey

- **R-1 Byte-pinned regions.** Managed-region content is not templated: identical bytes in
  every adopter (`template-registry.ts:978-982`). A value an adopter may need to differ goes
  through V-6, never into the region's bytes. The `validate.py` folder list
  (Measured state 3) currently breaks this rule; repairing it is SPEC-075's scope.
- **R-2 Consumer vantage.** Every factual claim in shipped bytes holds in the receiving repo,
  or names the minspec repo as its subject (DR-090).
- **R-3 Self-hosted parity.** A self-hosted template's content equals this repo's own working
  file (or, for `ai-review-workflow`, its localised form), enforced by the portability suite
  and `checkCiReviewTemplatesFresh` (DR-090 Context; `template-registry.ts:2748-2760`).
- **R-4 Forward-only refresh.** A refresh never moves a project backward (DR-092).
- **R-5 Blast radius.** Nothing in the set is written into a repository without `.minspec/`
  at its root (constitution invariant 3).

## Root cause (mechanism)

Ownership is declared per spec through `implements:`, and no rule requires a file whose
output ships into every adopter's repository to have an owner. Separately, and more
importantly for the issue's goal, **no gate ties a change in the managed set's shape to a
spec at all**: the spec-gate only holds owned files while their owner is unapproved
(Measured state 4), and the machinery check forces a human merge on two of the five files
without asking for a spec (Measured state 5). The missing gate is the second one; the
missing owner is the first.

## Functional requirements

- **FR-1 Contract lives here.** The [contract section](#the-managed-file-contract-as-it-stands-at-this-base)
  of this spec is the single written statement of the managed set (C-1), its variation points
  (C-2) and its rules (C-3). Any other spec that changes the managed set cites it.
- **FR-2 Ownership declared.** This spec carries the ownership chosen in D1, declared during
  Clarify (before approval mints a hash, SPEC-038 FR-3 / SPEC-070). A generated file
  (`ci-review-templates.ts`, `hook-templates.ts`) is never placed under `implements:` or
  `affects:` (Measured state 6); its contract coverage comes through C-1's self-hosted column
  and R-3.
- **FR-3 Owner required.** The dev validator (`scripts/validate-frontmatter.ts`) fails when a
  file in the producer set (scope per D3) is named by no spec's `implements:` and is not a
  declared generated file. It also fails when one is named by two specs' `implements:`.
  It fails visibly with the file and the missing or duplicate owner, and prints a warning
  that it validated nothing if the producer set resolves to zero files.
- **FR-4 Code equals contract.** A deterministic, offline check derives the contract surface
  from code (every `TEMPLATE_NAMES` entry with its output path and the `TemplateContext` keys;
  every `MANAGED_REGION_TEMPLATES` entry with name, output path, comment style, executable,
  preamble first line, has-condition, self-hosted) and compares it with the C-1 and C-2 tables
  parsed from this spec. Any difference fails, naming each differing row and which side holds
  which value.
- **FR-5 Contract change forces a spec change.** Because FR-4 reads the tables from this spec,
  a change to the surface that is not mirrored in this spec fails FR-4; mirroring it edits
  this spec, which stales its approval (canonical hash over the body), which puts the change
  in front of a human through the normal approval gate. Content-byte changes to a region that
  keep its row identical are **not** contract changes and are not caught here (they stay
  governed by R-2/R-3 gates and the machinery check).
- **FR-6 Stale gap comments swept.** The comments in SPEC-075 and SPEC-080 frontmatter that
  assert no spec claims `template-registry.ts` become false once FR-2 lands. The implementing
  change corrects them **only** where doing so does not stale an existing approval (verify
  with `npm run facts -- approval SPEC-NNN` before and after); where it would, it files an
  issue instead of editing.
- **FR-7 Dev-only.** FR-3 and FR-4 run in this repository's own validator and test suite. They
  are not added to any managed file: adopters have no `template-registry.ts` to check
  (constitution invariant 3).

## Acceptance criteria

- **AC-1** At the implementing commit, FR-4 passes on the unchanged code: the surface derived
  from code equals the C-1/C-2 tables exactly (36 rows: 5 rendered, 31 managed-region).
- **AC-2** A test fixture that adds a 32nd `MANAGED_REGION_TEMPLATES` entry with no table row
  fails FR-4, and the message names the new row's `name`.
- **AC-3** A fixture that changes one existing row's `outputPath` (or `executable`, or
  `commentStyle`) fails FR-4 naming that row and both values. Each of the seven columns is
  varied by at least one fixture (the unvaried-axis lesson: one column untested is one column
  unguarded).
- **AC-4** A fixture that changes only a region's content bytes, row unchanged, passes FR-4.
- **AC-5** A fixture that removes the `implements:` owner from a producer-set file fails FR-3
  naming the file; a fixture with two `implements:` owners fails naming both specs.
- **AC-6** A fixture in which the producer set resolves to zero files makes FR-3 print its
  "validated nothing" warning (constitution invariant 2).
- **AC-7** The rendered managed set is byte-identical before and after the implementing change
  (this spec changes gates and frontmatter, not shipped bytes).
- **AC-8** `npm run validate` and the full test suite pass with no network access.

## Invariants this change must not break

- **INV-1 Offline (constitution invariant 1).** FR-3 and FR-4 read only the working tree.
- **INV-2 No silent gate (constitution invariant 2).** Both checks fail closed and visibly; a
  parse failure of the C-1/C-2 tables fails FR-4, never skips it.
- **INV-3 Blast radius (constitution invariant 3).** No managed file gains or loses bytes
  (AC-7); the new checks never ship (FR-7).
- **INV-4 Regeneration is never frozen.** Neither generated file appears under `implements:`
  or `affects:` of any spec (FR-2), so `gen-ci-templates.mjs` stays runnable while this spec
  is in any phase.
- **INV-5 No approval stales as a side effect.** FR-6 edits no approved spec's hashed bytes.

## Out of scope

- Detecting a project-variable value baked into managed bytes (the R-1 breach class). That
  detector is #2675's scope; this spec supplies the variation-point table (C-2) it checks
  against. The one known instance is SPEC-075's.
- Building DR-090 §4's `localize` registry field (SPEC-066's scope).
- `scaffold.ts`, `merge-refresh.ts`, `adr-manager.ts`: they write or merge managed bytes but
  do not decide them. D3 option (b) would pull them in.
- Changing which paths the machinery check covers. D2 option (b) names that alternative.

## Decisions needed (Clarify)

All 4 decisions are answered, not ratified: an agent session selected, for each, the option this document
already recommended. No human chose them, and no delegation covers authoring Clarify answers
(DLG-001, DR-108, covers spec approval and engineering-DR acceptance only). This spec is
unapproved, so these answers bind nothing until a human or a covered delegation approves it.

- **D1 - Recorded selection: Option (a),** this spec takes `implements:` for
  `template-registry.ts`, `template-engine.ts` and `slash-commands.ts`; the two generated files
  are owned by nobody and covered through C-1/R-3 (FR-2).
- **D2 - Recorded selection: Option (a),** FR-4/FR-5 check the code against this spec's tables, so
  a change to the managed set's shape cannot merge without editing and re-approving this spec.
- **D3 - Recorded selection: Option (a),** the producer set is the five files named in #2680, in
  one constant next to FR-3's check, and FR-4 also fails when `template-registry.ts` imports a
  template-content string from a module outside that constant.
- **D4 - Recorded selection: no decision record,** D1(a) and D2(a) are both reversible in under a
  day, so the decision-record filter does not require one.

**D1 - What ownership do the five files get?**
- (a) **(rec)** This spec takes `implements:` for `template-registry.ts`, `template-engine.ts`
  and `slash-commands.ts`; the two generated files are owned by nobody and covered through
  C-1/R-3 (FR-2). Cost: while this spec is in the Plan/Tasks/Implement band and unapproved
  or stale, the spec-gate freezes those three files for every other change (the reason
  SPEC-215 refused to own them); every future edit to this spec, including the FR-5 contract
  update, re-freezes them until re-approved.
- (b) `implements: none` with this spec as a contract-only document. Cost: the issue's literal
  ask (an owner) is unmet; file-to-spec lookup still returns nothing for these files, and FR-3
  has no owner to require.
- (c) Record (in a DR) why they stay unowned, and rely on the machinery check. Cost: no
  Specify phase is ever forced; the contract stays in scattered prose.

**D2 - What forces a Specify phase for a change to what ships?**
- (a) **(rec)** FR-4/FR-5: the code is checked against the tables in this spec, so a change
  to the managed set's shape (a file added, removed, moved, re-moded, made conditional) cannot
  merge without editing this spec and re-approving it. Cost: content-byte changes inside an
  existing region are not caught, and the #2675 class (a baked value) is exactly such a
  change, so this does not by itself close the parent issue.
- (b) Extend the machinery path set to all five files and accept a human `--admin` merge as
  the gate. Cost: forces a merge keystroke, not a spec; the contract stays unwritten.
- (c) A fingerprint of the full rendered bytes recorded in this spec. Cost: every regeneration
  of the CI-review stack (frequent) would require a spec edit and a human re-approval, a
  ceremony cost tenet 2 does not justify for byte changes the R-3 parity gate already covers.

**D3 - Which files are the "producer set" FR-3 requires an owner for?**
- (a) **(rec)** The five named in #2680, enumerated in one constant next to FR-3's check, and
  FR-4 additionally fails when `template-registry.ts` imports a module outside that constant
  that exports a string placed in a template's `content`. Cost: the import rule is a
  heuristic; a producer reached indirectly (two imports deep) is missed.
- (b) Also include the writers (`scaffold.ts`, `merge-refresh.ts`, `adr-manager.ts`). Cost:
  these files are touched by many unrelated specs; owning them multiplies the D1(a) freeze.

**D4 - Does this decision need a DR?** Recommended **no** if D1(a)/D2(a) are chosen: both
are reversible in under a day (a frontmatter edit and a check removal), so the
under-a-day reversibility filter for decision records does not require one. Choosing D1(c) is itself a recorded decision and needs one.

## Follow-ups (tracked)

- The baked-value detector (R-1 breaches): #2675.
- The `validate.py` folder list instance: SPEC-075.
- DR-090 §4 `localize` field: SPEC-066.
- None other.
