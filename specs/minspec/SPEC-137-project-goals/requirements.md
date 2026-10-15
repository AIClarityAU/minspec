---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - goals are the thematic half of the human priority dial (DR-039)
aspects: [goals, constitution, frontmatter, priority, signpost, determinism, validator, tier-0, offline]
depends_on: [DR-039, DR-019, DR-013]  # DR-039 is the decision this spec materialises; DR-019 the deterministic resolver it feeds; DR-013 the `epic:` ref convention `goal:` copies
relates_to: [SPEC-012, SPEC-022, DR-003, DR-075, "#259", "#260", "#261", "#262"]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Project Goals - the constitution `## Goals` list, the `goal:` ref, and one parser every surface shares

Originating issue: [#259](https://github.com/AIClarityAU/minspec/issues/259).
Design rationale: [DR-039 (goals drive priority)](../../../docs/decisions/DR-039.md) - accepted
2026-08-05. This spec adds no new decision; it turns DR-039 Decision §1 and §2 into
checkable requirements and records what is already built.

## In plain terms

You rank a handful of project goals once, in the constitution. A spec, decision or epic
says which goal it serves with one line, `goal: G-2`, the same way it already says
`epic:`. MinSpec reads that line and never guesses it. The resolver then uses the goal's
rank to break ties between equally urgent work.

Most of the plumbing already exists. What is missing is the part that keeps it honest: a
typo like `goal: G-22` is silently treated as "no goal" today, a new project's
constitution template has no goal ids at all so the feature does nothing for adopters,
issues have no way to carry a goal, and the retired goal G-5 still outranks G-6, G-7 and
G-8. This spec closes those gaps. Five questions need your call (see Clarify).

## Current state (verified 2026-10-15 against `5f792386`)

Recorded so the plan does not rebuild what exists (Evidence Discipline, DR-003).

| Piece | State | Evidence |
|---|---|---|
| `## Goals` with stable `G-N` ids, ranked by order | **Present** in this repo's constitution | `.minspec/constitution.md:32-74` (G-1 … G-8, G-5 marked RETIRED) |
| Constitution `## Goals` → `G-N → rank` map | **Built**, private to the graph adapter | `packages/minspec/src/lib/artifact-graph.ts:150-179` (`buildGoalRankMap`; rank = the list item's leading `N.`) |
| `goal:` frontmatter reader | **Built**, private, regex on raw frontmatter | `artifact-graph.ts:133-137` (`goalRefOf`) |
| goal-rank fed to epics, specs, ADRs | **Built** | `artifact-graph.ts:522, 546, 575` |
| Resolver tie-break `(epicOrder, goalRank, priority, id)` | **Built** (this is #260's half) | `packages/shared/src/next-task.ts:605-611, 1021` |
| Same tie-break for issue ranking | **Built** for specs/epics only; issues contribute `goalRank: INF` | `scripts/lib/issue-rank.ts:461-471` |
| Fidelity test for goal-rank resolution | **Built** | `packages/minspec/tests/artifact-graph-fidelity.test.ts:270-274` |
| Artifacts carrying `goal:` | **None** - zero matches for `^goal:` under `specs/` and `docs/` | grep, 2026-10-15 |
| Validation of `goal:` refs (dangling / malformed) | **Missing** - `scripts/validate-frontmatter.ts` has no `goal` rule; the extension has none | grep `goal` in both |
| Adopter constitution template with `G-N` ids | **Missing** - template example is `1. Ship a frictionless …` with no id, which `GOAL_ID_IN_GOALS_RE` cannot match, so every adopter's goal map is empty | `packages/minspec/src/lib/template-registry.ts:838-844` |
| `goal` on `SpecFrontmatter` type | **Missing** | `packages/minspec/src/lib/spec.ts:46` |
| Goal ref on GitHub issues | **Missing** | `issue-rank.ts` reads `epic:` labels (`:311`) but no goal label |
| Retired-goal handling | **Missing** - G-5 resolves to rank 5 and outranks G-6..G-8 | `buildGoalRankMap` reads every numbered `G-N` item |
| Approval hash vs `goal:` | Adding `goal:` to an **approved** spec changes its canonical hash and stales the approval: `canonicalizeSpec` strips only `status` and `phases` | `packages/shared/src/canonical.ts:14-15, 60` |

## Scope

In scope: the goal-list format, the `goal:` ref grammar, one shared Tier-0 parser,
validation of refs on every surface that already validates `epic:`, the adopter template,
and the issue-side ref. Out of scope: the resolver tie-break itself (#260, already built),
drag-and-drop reordering (#261), auto-derived WSJF (#262), and any LLM involvement in
choosing a goal (DR-039 forbids it in the engine).

## Functional requirements

### Goal list (the source of truth)

- **FR-1 Location.** Goals live only in the `## Goals` H2 of `.minspec/constitution.md`.
  No second goals file (DR-039 Alternatives - rejected `docs/core-values.md`).
- **FR-2 Item grammar.** A goal is a numbered Markdown list item whose text begins with a
  bold run opening with a stable id: `N. **G-K — <title>.** <description>`. The id
  pattern is `G-` followed by one or more digits, no leading zeros. Text after the id is
  free prose and never parsed for meaning.
- **FR-3 Rank.** A goal's rank is its 1-based position in the list, read from the item's
  leading number, as today (`artifact-graph.ts:142-145`). The id never implies rank:
  `G-7` may be rank 2.
- **FR-4 Id stability.** An id, once written, is never reused for a different goal.
  Retiring a goal keeps its id in the list (as G-5 does) so existing refs still resolve.
  How a retired goal ranks is Clarify **CQ1**.
- **FR-5 Retired marker.** A goal is retired when its bold title run is exactly
  `G-K — RETIRED` (optionally followed by a parenthesised reason inside or after the bold
  run, as G-5 does today). The parser exposes `retired: true` for it.
- **FR-6 Section bounds.** The section ends at the next H2. H3 sub-headings and
  non-list prose inside `## Goals` are ignored. A numbered item without a `G-K` id is
  ignored by the parser and reported by validation (FR-12).

### The `goal:` ref

- **FR-7 Carriers.** A spec (`requirements.md` / single-file spec), DR, or epic may carry
  `goal:` in its YAML frontmatter, exactly as it carries `epic:` (DR-013).
- **FR-8 Grammar.** `goal: G-K`, optionally followed by an inline `# comment` (the same
  inline-title convention as `epic: EPIC-002  # Signpost Integrity`). Exactly one goal
  per artifact in v1; whether a list is allowed is Clarify **CQ2**.
- **FR-9 Never inferred.** No code path writes, defaults, or infers a `goal:` value.
  Absent stays absent. An assistant may *suggest* a ref in chat or a quick-pick for a
  human to accept (DR-039 R2), but the engine never reads a suggestion.
- **FR-10 Issues.** A GitHub issue maps to a goal with a `goal:G-K` label, mirroring the
  existing `epic:<id>` label convention (`scripts/lib/issue-rank.ts:311`).
  `issue-rank` gives such an issue that goal's rank instead of `INF`. Whether an issue
  that is linked to a spec inherits the spec's goal instead is Clarify **CQ3**.

### One parser

- **FR-11 Shared Tier-0 module.** A single pure function set in `@aiclarity/shared`
  (no `vscode`, no `fs`, no network - Constraint 1) owns the grammar:
  - `parseGoals(constitutionText) → { goals: Goal[]; problems: GoalProblem[] }` where
    `Goal = { id, rank, title, retired }`;
  - `parseGoalRef(frontmatterBlock) → string | null` (FR-8, comment-stripped);
  - `goalRankOf(ref, goals) → number | undefined` applying the CQ1 retired rule.
  `artifact-graph.ts` and `scripts/lib/issue-rank.ts` consume it; their private copies
  (`goalRefOf`, `buildGoalRankMap`, `GOAL_ID_IN_GOALS_RE`) are removed, so the rule is
  identical on editor, commit and CI surfaces (G-6) and cannot drift (the
  `shared-convention-parity` class).
- **FR-12 Validation findings.** The parser reports, and every validation surface shows:
  - **dangling ref** - `goal: G-K` where no `G-K` exists in `## Goals`;
  - **malformed ref** - a `goal:` value not matching FR-8;
  - **retired ref** - `goal:` pointing at a retired goal (advisory, never blocking);
  - **duplicate id** - the same `G-K` on two list items;
  - **unnumbered or id-less item** - a numbered item in `## Goals` with no `G-K` id;
  - **rank gap or repeat** - list numbers that are not `1..n` in order (Markdown would
    render them renumbered, so the rank a reader sees differs from the rank the parser
    reads).
  Severity per surface is Clarify **CQ4**.
- **FR-13 Surfaces.** The findings in FR-12 run in (a) `scripts/validate-frontmatter.ts`
  (`npm run validate`, the CI frontmatter gate) beside the existing `epic:` dangling-ref
  check, and (b) the extension's existing frontmatter diagnostics, beside its `epic:`
  check. Both call FR-11; neither reimplements it.
- **FR-14 Type.** `SpecFrontmatter` (`packages/minspec/src/lib/spec.ts`) gains an
  optional `goal?: string`, and the epic/ADR readers expose the same field, so callers
  stop re-reading raw frontmatter for it.

### Adopters

- **FR-15 Template.** The scaffolded constitution template's `## Goals` section
  (`template-registry.ts`) shows the `N. **G-K — title.** description` form and one
  sentence on rank = order and on `goal:` refs, so a new project's goals are parseable
  from the first edit. This changes review machinery (template-registry), so its PR
  needs a human merge.
- **FR-16 Degrade.** No constitution, no `## Goals`, or a `## Goals` with no parseable
  items yields an empty goal list and no findings other than dangling refs - never a
  throw, never a blocked command. An absent `goal:` simply drops that tie-break term
  (DR-039 Consequences).

## Acceptance criteria

- **AC-1** Given this repo's constitution, `parseGoals` returns eight goals G-1..G-8 with
  ranks 1..8, `G-5.retired === true`, and no problems.
- **AC-2** A fixture spec with `goal: G-2  # Prevent tech debt` resolves to `G-2`; the
  graph adapter's `goalRank` for it equals the value `goalRankOf('G-2', goals)` returns
  (the existing assertion at `artifact-graph-fidelity.test.ts:273` keeps passing).
- **AC-3** A fixture spec with `goal: G-22` produces exactly one dangling-ref finding
  naming the file and `G-22` from `npm run validate`, and the same finding from the
  extension diagnostic, from the same shared function (a parity test asserts both
  surfaces call FR-11).
- **AC-4** `goal: g2`, `goal: G-02`, `goal: [G-1]` (if CQ2 = single) each produce a
  malformed-ref finding.
- **AC-5** A constitution with two `G-3` items, or with list numbers `1, 2, 2, 4`,
  produces a duplicate-id or rank finding respectively.
- **AC-6** `issue-rank` gives an issue labelled `goal:G-1` rank 1 in the goal term, and
  an unlabelled issue `INF` (unchanged).
- **AC-7** A freshly scaffolded project's constitution, with its template example goals
  uncommented, parses to at least one goal with an id.
- **AC-8** No source file other than the FR-11 module contains a `G-\d+` goal-id regex
  (a grep-based guard test, same shape as the existing convention-parity tests).
- **AC-9** With no `.minspec/constitution.md`, next-task, issue-rank and validate all
  complete and report no goal problems except dangling refs.
- **AC-10** A mutation that swaps the order of two goals in the fixture constitution
  changes the resolver's pick between two otherwise-tied specs (proves rank is read,
  not decorative - guards against a vacuous pass).

## Invariants this change must not break

- **INV-1 Offline (constitution invariant 1).** Parsing and validation read local files
  only; no network call on any path.
- **INV-2 No silent gate (invariant 2).** A dangling `goal:` ref is reported visibly on
  every surface that runs; the parser never swallows a malformed constitution into a
  silently empty map without a finding when a `## Goals` section is present but
  unparseable.
- **INV-3 Blast radius (invariant 3).** Goal parsing activates only inside a repo with
  `.minspec/`. The template change affects only newly scaffolded or refreshed projects
  under the existing merge-refresh rules, never an unopted repo.
- **INV-4 Gates dominate value (DR-039 §3, R1).** goal-rank remains a tie-break inside a
  severity class; nothing in this spec changes resolver class order.
- **INV-5 Never LLM-scored (DR-039 §2, DR-019).** No model output is an input to
  `goal`, rank, or any ordering.
- **INV-6 Tier-0 shared (Constraint 1).** The FR-11 module imports neither `vscode` nor
  `fs`.
- **INV-7 Human content untouched.** No MinSpec code rewrites the constitution's
  `## Goals` body or any artifact's `goal:` line.

## Decisions needed (Clarify)

- **CQ1 - How does a retired goal rank?** G-5 is retired but today resolves to rank 5,
  so `goal: G-5` work outranks G-6, G-7 and G-8 work.
  - `a` **(rec)** Retired resolves to `undefined` (same as no goal - lowest in that term)
    and validation flags the ref as advisory. Cost: a retired goal's artifacts silently
    drop below every un-goaled-but-epic-ordered peer in the tie-break; that is the point,
    but it is a behaviour change for any existing G-5 refs (there are none today).
  - `b` Keep list position (status quo). Cost: retired work keeps outranking live goals,
    the exact mis-rank DR-039 R2 warns about.
  - `c` Require retired goals to move to the bottom of the list. Cost: renumbering the
    list is a human edit every retirement, and moving G-5 now reorders the visible
    constitution.
- **CQ2 - One goal per artifact, or a list?** DR-039 §2 says "`goal: G-2`" (singular).
  - `a` **(rec)** Exactly one in v1. Cost: work that genuinely serves two goals must pick
    one; the second is lost from ranking.
  - `b` Allow `goal: [G-1, G-4]` ranked by the best (lowest) rank. Cost: invites the
    "tag everything G-1" box-ticking DR-039 R4 names, and complicates the grammar.
- **CQ3 - Where does an issue's goal come from?**
  - `a` **(rec)** Its own `goal:G-K` label only (FR-10). Cost: a label per issue is
    ceremony most issues will not get, so most issues stay `INF`.
  - `b` Inherit from the spec or epic the issue links to, label overrides. Cost: needs a
    deterministic issue-to-artifact link that `issue-rank` does not have today; larger
    scope.
- **CQ4 - Severity of a dangling or malformed `goal:` ref.**
  - `a` **(rec)** Error in this repo's `npm run validate` (same as the `epic:` gate, a
    project-policy gate here) and warning in the shipped extension (same as shipped
    `epic:` behaviour). Cost: a typo in `goal:` now fails CI in this repo.
  - `b` Warning everywhere. Cost: a dangling ref silently mis-ranks, the DR-003 asymmetry
    that stranded SPEC-004's `epic:`.
- **CQ5 - Should `goal:` be excluded from the approval hash?** Today adding `goal:` to an
  approved spec stales its approval (`canonical.ts` strips only `status`/`phases`), so
  back-filling goals onto approved specs costs one re-approval each.
  - `a` **(rec)** Keep it in the hash (no change). Cost: back-filling goals onto approved
    specs needs re-approval, so in practice goals land on new specs first. It keeps the
    canonicalization rule small and means a goal change is a reviewed change, which fits
    "never wrong".
  - `b` Strip `goal:` like a lifecycle key. Cost: widens SPEC-022's canonical-hash rule,
    which every approval record depends on, and lets priority-affecting edits land with
    no review. Changing the hash rule is not reversible in under a day and would need its
    own DR.

## Follow-ups (tracked)

- [#260](https://github.com/AIClarityAU/minspec/issues/260) - resolver tie-break; already
  built (`next-task.ts:1021`); this spec only changes where the rank comes from.
- [#261](https://github.com/AIClarityAU/minspec/issues/261) - drag-and-drop reorder of the
  goal list.
- [#262](https://github.com/AIClarityAU/minspec/issues/262) - auto-derived WSJF using
  goal-rank as the value input.

Not a follow-up: back-filling `goal:` refs onto existing artifacts is human curation
(FR-9), not engineering work, so no issue is filed for it.
