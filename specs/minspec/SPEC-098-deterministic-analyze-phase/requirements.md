---
id: SPEC-098
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology — this extends the phase model (specify → clarify → plan → tasks → implement) the epic names as its own scope (docs/epics/EPIC-003-sdd-core.md:13)
aspects: [sdd-phases, analyze, lifecycle, tier-0, static-analysis, validator, spec-panel, diagnostics, migration, spec-kit-parity]
relates_to: [DR-055, SPEC-012, SPEC-038, "#18", "#763", "#766"]
# Ownership declared in Specify (SPEC-038 FR-1 to FR-3). The static-check engine and its
# tests are NEW and are this spec's to own under every Decisions-needed option below — no
# existing spec's `implements:` claims either path.
implements: [packages/minspec/src/lib/analyze.ts, packages/minspec/tests/analyze.test.ts]
# Modified, not owned. `config.ts`/`lifecycle.ts` are claimed by no spec's `implements:`
# (grepped across every file in specs/); the rest belong to the specs named per file below.
# spec.ts, spec-manager.ts → SPEC-038 (ownership/approval plumbing). spec-layout.ts,
# spec-progress.ts → no owning spec found; following SPEC-066/SPEC-075/SPEC-080's
# precedent of `affects:`-only for a shared file nobody's `implements:` claims.
# views/spec-panel-html.ts, views/frontmatter-completion.ts → SPEC-014 (review webview)
# territory but not in its `implements:` list either. `.claude/commands/minspec-analyze.md`
# is the existing AI-prompt shim this spec's Decision 2 may rename or narrow.
affects: [packages/minspec/src/lib/config.ts, packages/minspec/src/lib/lifecycle.ts, packages/minspec/src/lib/spec.ts, packages/minspec/src/lib/spec-manager.ts, packages/minspec/src/lib/spec-progress.ts, packages/minspec/src/lib/spec-layout.ts, packages/minspec/src/lib/spec-validator.ts, packages/minspec/src/lib/spec-catalog.ts, packages/minspec/src/lib/slash-commands.ts, packages/minspec/src/views/spec-panel-html.ts, packages/minspec/src/views/frontmatter-completion.ts, packages/minspec/src/commands/example.ts, .claude/commands/minspec-analyze.md, packages/minspec/README.md, packages/minspec/CHANGELOG.md]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-098: A deterministic, zero-AI Analyze phase sits between Tasks and Implement — tier-gated, surfaced in the spec panel, and reconciled with the AI-prompt command of the same name that already ships (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, resolves the questions under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the
> normal spec-approval gate before any code changes. This spec states a recommended option
> for each question and the requirements below are written against those recommendations —
> approving as-is accepts them; picking a different option changes only the requirements
> that decision names.

Materializes **[#18](https://github.com/AIClarityAU/minspec/issues/18)** —
*"MinSpec implements 5 of Spec Kit's 7 canonical phases (no `constitution`, no
`analyze`); add a deterministic, offline `analyze` phase between `tasks` and
`implement`."*

## One-Sentence Scope

Add `analyze` as a sixth entry in MinSpec's phase model — a Tier-0, no-AI, no-network
structural-consistency pass between `tasks` and `implement`, required for T3/T4,
optional for T2, absent for T1 — wired into the same engine (`config.ts` / `lifecycle.ts`
/ `spec-validator.ts`) that already enforces `specify`/`clarify`/`plan`/`tasks`/`implement`,
and surfaced both in the spec panel and as a section inside the spec's own markdown.

## Context — what exists today

**The phase model is a five-entry array, not a markdown convention.** `PHASES` in
`packages/minspec/src/lib/config.ts:11` is
`['specify', 'clarify', 'plan', 'tasks', 'implement']` and the `Phase` type
(`config.ts:8`) is its literal union. Every piece of lifecycle enforcement reads this one
array — `lifecycle.ts`'s phase-advance state machine, `spec.ts`'s section parser/writer,
`spec-manager.ts`, `spec-progress.ts`'s percentage-complete bar, `spec-layout.ts`'s
split-file resolver, `spec-validator.ts`'s required-section check, and
`spec-panel-html.ts`'s rendered phase stepper. `config.ts:131-138`'s
`DEFAULT_CONFIG.phaseMappings` then says which of those five phases each tier requires:
T1 → `specify` only; T2 → `specify`,`plan` required, `clarify` optional; T3 →
`specify`,`plan`,`tasks`,`implement` required, `clarify` optional; T4 → all five
required. This project's own `CLAUDE.md` tier table is the human-readable mirror of that
same mapping.

**`analyze` already exists — but only as an AI-driven prompt, not an engine phase.**
`.claude/commands/minspec-analyze.md` ships today (landed in #763/#766, per
[DR-055](../../../docs/decisions/DR-055.md)'s Spec-Kit command-parity bucket) and is
listed in this session's own available-skills surface as `minspec-analyze`. Its body:
*"MinSpec's native phase list ends at `implement`; treat Analyze as a review pass over
the active spec"* — i.e. it already documents, in its own prose, the exact gap this
issue names, and hands the four checks to an LLM reading the spec rather than to
deterministic code. It is not in `PHASES`, carries no tier requirement, writes nothing
back to the spec's frontmatter `phases:` block, and is invisible to
`spec-validator.ts`/`spec-progress.ts`/the spec panel. `README.md:90` documents it
alongside the other seven `.claude/commands/minspec-*.md` shims as command-surface
*parity*, not as a lifecycle gate.

**This is a different capability from the "conformance" ScroogeLLM deferred to Phase 3,
despite sharing a neighbourhood in `design.md`.** The issue cites
`specs/minspec/design.md` L267-276 as evidence `analyze` is deferred; that range is the
File System Layout section and does not mention `analyze` or conformance at all — the
actual deferral is `design.md:300-307`: *"MinSpec Phase 1 lays groundwork for ScroogeLLM
conformance integration… Spec file format includes machine-readable acceptance criteria
that conformance checker validates against… No MinSpec code changes needed for Phase
3."* That conformance pass validates **AI output against spec requirements** — it needs
an LLM (`design.md:347`, risk R5/R7) and is explicitly Tier-1. The `analyze` phase this
issue asks for checks the **spec's own artifacts against each other** (does every task
cite a requirement, does every requirement have a task) with a markdown parse and a
structural diff — no model call, Tier-0, same invariant-1 footing as the classifier. The
two are easy to conflate because both use the word "analysis"; this spec treats them as
unrelated and does not touch the ScroogeLLM conformance deferral.

**Traceability already has the vocabulary this phase would check.** A `tasks.md`
slice heading already carries a `Covers FR-1, FR-2, … INV-1, …` line (convention visible
across every multi-slice `tasks.md`, e.g.
`specs/minspec/SPEC-044-coordinated-self-completing-sessions/tasks.md:26`) and an
Acceptance Criteria item already cites its owning requirement in parens (e.g. `(FR-6)`,
the format `checkAcceptanceCriteria` — `spec-validator.ts:678` — already expects for the
"has acceptance criteria" check). `analyze`'s checks read these two conventions; it does
not invent a new citation grammar.

**Retroactive blast radius is large and concrete.** Across `specs/minspec/*/requirements.md`
today: 71 specs are tier T3 or T4 (25 T3 planning, 16 T3 implementing, 2 T3 done, 1 T3
specifying, 1 T3 superseded, 12 T4 planning, 10 T4 implementing, 2 T4 specifying, 2 T4
done — counted 2026-10-02 from frontmatter `tier:`/`status:`). `spec-validator.ts:1003-1018`
runs its required-section check against **every** spec of a tier, regardless of
`status:` — there is no carve-out for a spec that finished `implement` before a phase
existed. If `analyze` is added to T3/T4's `requiredPhases` with no further change, all 71
specs start failing `npm run validate` the moment this ships, because none of them carries
a `## Analyze` section. [Decision 1](#decisions-needed-clarify) is this, stated as a
choice rather than left implicit.

## Functional Requirements

- **FR-1 (phase added to the model, ordered between `tasks` and `implement`).**
  `Phase` (`config.ts:8`) MUST gain the literal `'analyze'` and `PHASES` (`config.ts:11`)
  MUST become `['specify', 'clarify', 'plan', 'tasks', 'analyze', 'implement']`. Every
  consumer that iterates `PHASES` for ordering, validation, or UI (`lifecycle.ts`,
  `spec.ts`, `spec-manager.ts`, `spec-progress.ts`, `spec-layout.ts`,
  `spec-panel-html.ts`, `frontmatter-completion.ts`) picks the new position up without a
  second enumeration to keep in sync — this is the reason the Phase/PHASES change is one
  edit and not six.

- **FR-2 (tier mapping per the issue, recorded as the default).** `DEFAULT_CONFIG.phaseMappings`
  (`config.ts:131-138`) MUST set: T1 — `analyze` absent from both `requiredPhases` and
  `optionalPhases` (skipped entirely, matching T1's existing one-phase minimalism); T2 —
  `optionalPhases` gains `analyze`; T3 and T4 — `requiredPhases` gains `analyze`, inserted
  between `tasks` and `implement`. This is the issue's own tier table ("skip T1, optional
  T2, required T3/T4") and requires no new config shape — `TierPhaseMapping`
  (`config.ts:17-20`) already supports it.

- **FR-3 (the four checks are static markdown/frontmatter analysis — no AI, no network,
  constitution invariant 1).** The new module (`lib/analyze.ts`) MUST implement exactly
  the four checks #18 names, each a pure function over already-parsed spec data (the
  `ParsedSpec` shape `spec-validator.ts` already builds — no new parser):
  1. every `tasks.md` task/slice references at least one requirement id (the existing
     `Covers FR-…` convention, [Context](#context--what-exists-today));
  2. every requirement (`FR-N`/`INV-N` heading in `requirements.md`) is referenced by at
     least one task;
  3. `design.md`'s sections cover every `requirements.md` section that structurally
     demands a design answer (exact coverage predicate is a Plan-phase decision — this
     FR fixes only the check's *inputs*, not its matching rule, to avoid guessing an
     algorithm a Plan hasn't sized);
  4. every Acceptance Criteria item's `(FR-N)`/`(INV-N)` citation resolves to a
     requirement that exists (an "orphan" AC cites a dead or renumbered id).
  None of the four reads network, a model, or anything outside the spec's own files —
  matching the classifier's existing Tier-0 posture (`README.md:134-136`).

- **FR-4 (findings are visible, never a silent pass — constitution invariant 2).** A
  violation any of the four checks finds MUST be reported, not swallowed: as a
  `ValidationViolation` from `spec-validator.ts` (so `npm run validate` and the CI gate
  see it) AND inline in the spec panel (FR-6). A checker that cannot run (e.g. a
  `tasks.md` the split-layout resolver cannot locate) MUST report that as a finding,
  not as a silent empty-result pass — the same fail-closed posture
  `check-dr-id-collision.ts`'s header documents for its own network half.

- **FR-5 (severity matches the existing required-section pattern, not a new scale).**
  For T3/T4 (`requiredPhases` per FR-2), an `analyze` finding is `severity: 'error'`,
  matching `spec-validator.ts:1012`'s existing `TIER_RANK[tier] >= 3 ? 'error' :
  'warning'` rule for every other required-phase section — `analyze` does not invent a
  fifth severity tier. For T2 (`optionalPhases`), a finding is `severity: 'warning'`,
  matching `clarify`'s existing optional-phase treatment at T2/T3.

- **FR-6 (surfaced in the spec panel as a phase step).** `spec-panel-html.ts`'s phase
  stepper (`spec-panel-html.ts:93`, iterating `PHASES`) MUST render `analyze` like any
  other phase (its status pill, its position in the stepper) with no analyze-specific
  branch — this falls out of FR-1 if the stepper genuinely has no hardcoded phase list
  elsewhere; FR-6 exists to make that assumption an explicit, checkable requirement
  rather than a hope.

- **FR-7 (findings also land as a markdown section, like every other phase).**
  Running Analyze MUST write or refresh a `## Analyze` section in the spec's markdown
  (single-file layout) or in the `tasks`-sibling file (split layout, mirroring
  `spec-layout.ts`'s existing per-phase file routing) — a checkbox or bullet list, one
  line per finding, each citing the FR/task/AC id it concerns. This satisfies the
  "diagnostics in spec markdown" half of #18's ask and gives `spec-validator.ts`'s
  required-section check (FR-5) something to read: an empty or missing `## Analyze`
  section on a T3/T4 spec is itself the `section.analyze.empty` violation, exactly
  parallel to every existing required phase.

- **FR-8 (idempotent and re-runnable, never destructive).** Re-running Analyze
  overwrites only the managed `## Analyze` section (or its sibling-file equivalent),
  the same convention `generated-hashes.json`-backed managed regions already use
  elsewhere in this codebase — it MUST NOT touch any other section, and MUST NOT require
  the spec to be in any particular phase state to run (a spec still mid-`tasks` can run
  Analyze early to see where it stands; FR-5's gating is about what's *required* to
  advance, not about when the check may be *run*).

- **FR-9 (command surface; relationship to the existing AI prompt — see Decision 2).**
  A deterministic entry point (command palette action and/or `spec-manager.ts` function,
  Plan phase to size) MUST exist to run Analyze outside of just "advance past tasks".
  Whether `.claude/commands/minspec-analyze.md` is kept as a separate, narrower
  AI-assisted pass, folded to delegate its structural checks to this engine, or renamed
  to avoid the two sharing the name "Analyze" for materially different guarantees
  (deterministic vs. LLM-judged) is [Decision 2](#decisions-needed-clarify) — this FR
  only fixes that a deterministic entry point must exist; it does not resolve the
  prompt file's fate.

## Acceptance Criteria

- **AC-1.** A T3 spec with a `tasks.md` slice carrying no `Covers FR-…` line: running
  Analyze (or `npm run validate`) reports a `task.uncovered-requirement`-class finding
  naming that slice; the finding appears in both the CLI/CI output and the spec panel.
  (FR-3.1, FR-4)
- **AC-2.** A T3 spec with a requirement (`FR-4`, say) cited by no task anywhere in
  `tasks.md`: Analyze reports a `requirement.unimplemented`-class finding naming `FR-4`.
  (FR-3.2, FR-4)
- **AC-3.** A spec whose Acceptance Criteria includes `(FR-9)` but whose
  `requirements.md` has no `FR-9`: Analyze reports an orphan-AC finding naming the AC
  text and the dangling id. (FR-3.4, FR-4)
- **AC-4.** A T1 spec: Analyze is never required to advance past `tasks`, and the spec
  panel does not show `analyze` as blocking. (FR-2)
- **AC-5.** A T2 spec with no `## Analyze` section: `npm run validate` reports a
  `warning`, not an `error`, and does not fail CI by itself. (FR-2, FR-5)
- **AC-6.** A T4 spec with a clean `## Analyze` section (all four checks pass, written
  by a prior run): `npm run validate` reports no `analyze`-related violation. (FR-5, FR-7)
- **AC-7.** Re-running Analyze on a spec twice in a row with no intervening edits
  produces byte-identical `## Analyze` section content both times (idempotent). (FR-8)
- **AC-8.** Running Analyze performs no network call and adds no new runtime dependency
  to `packages/minspec/package.json` (verified the same way SPEC-080 AC pins its own
  offline checks — process-level network assertion in the test). (FR-3, INV-1)
- **AC-9.** [Decision 1](#decisions-needed-clarify)'s chosen migration path has at least
  one test pinning it: either "a pre-existing T3/T4 spec with `status: done` and no
  `## Analyze` section does not newly fail `npm run validate`" (grandfather options) or
  "running the one-time backfill script against the current 71-spec corpus leaves
  `npm run validate` green" (backfill option).

## Invariants

- **INV-1 (Tier-0, constitution invariant 1).** No `analyze` check reads the network or
  calls a model. Unlike the ScroogeLLM conformance pass this is adjacent to but distinct
  from ([Context](#context--what-exists-today)), `analyze` ships inside MinSpec's
  air-gapped core, not behind a Tier-1/consent gate.
- **INV-2 (no silent gate, constitution invariant 2).** An `analyze` finding is always
  visible (FR-4); a checker that cannot run fails as a finding, not as a quiet empty
  pass; no `analyze` result is produced by a path with a swallowed error.
- **INV-3 (blast radius, constitution invariant 3).** `analyze` ships only inside
  MinSpec's own managed regions and this repo's own corpus; it does not run, write, or
  gate anything in a project without `.minspec/` at its root.
- **INV-4 (one phase model, no shadow enumeration).** `PHASES` (`config.ts:11`) remains
  the single source of phase order; this spec adds no second list of phase names that
  could drift from it (FR-1).
- **INV-5 (existing phases' behaviour is unchanged).** Nothing about how `specify`,
  `clarify`, `plan`, `tasks`, or `implement` validate, render, or advance changes for any
  tier — `analyze` is an insertion, not a rewrite of the surrounding state machine.
- **INV-6 (the 71-spec corpus does not go red without a named decision).** Shipping this
  spec's default `phaseMappings` (FR-2) MUST NOT, by itself and with no further action,
  flip `npm run validate` from green to red for the existing corpus — that transition is
  gated on [Decision 1](#decisions-needed-clarify) being resolved and its chosen option
  implemented (AC-9), not an accepted side effect of landing FR-2.

## Decisions needed (Clarify)

- **Decision 1 — migration for the 71 existing T3/T4 specs that predate `analyze`.**
  [Context](#context--what-exists-today) counts 71 T3/T4 specs on disk today, none
  carrying a `## Analyze` section. Options:
  - **(rec) Option A — grandfather by a cutover marker.** `requiredPhases` for `analyze`
    applies only to a spec whose `phases:` frontmatter was created on or after this
    spec's own implementation lands (a `createdAt`-style marker, or simply: a spec with
    no `analyze: …` key in `phases:` at all is read as "predates this feature" and
    exempted, while a spec that *has* the key — even `pending` — is held to it). Cost:
    a temporal/presence branch in `spec-validator.ts`'s required-section check that the
    other four phases have never needed, and a second code path to keep correct as the
    corpus ages.
  - **Option B — one-time backfill script.** Write a `## Analyze: not evaluated —
    predates this phase` section into all 71 specs mechanically, then run `analyze` for
    real going forward. Cost: a 71-file mechanical edit in one PR, and per DR-096's
    precedent for exactly this shape of change (a new structural expectation landing
    under specs minted before it existed), every one of those 71 specs' approval hash
    — where one exists — goes stale and needs re-approval; a T3/T4 spec with
    `status: done` already shipped code, so re-approving it is pure ceremony with no
    gate value.
  - **Option C — ship `analyze` optional (not required) for T3/T4 at launch.** Defer
    Decision 1 itself: `analyze` starts in every tier's `optionalPhases`, and a later DR
    promotes it to required for T3/T4 once the corpus is backfilled or has aged out.
    Cost: #18's own ask ("required T3/T4") is not delivered by this spec; needs a
    follow-up issue to carry the promotion, which is a second review cycle before the
    issue is actually satisfied.

- **Decision 2 — what happens to `.claude/commands/minspec-analyze.md`.** The AI-prompt
  shim already named "Analyze" ships today ([Context](#context--what-exists-today)).
  Options:
  - **(rec) Option A — narrow the prompt, delegate structure to the engine.** Rewrite
    the shim's body to say the four structural checks now run deterministically
    (pointing at the new command/`## Analyze` section) and reserve the AI pass for
    judgement calls a parser cannot make (e.g. "does this plan decision actually address
    this requirement's *intent*, not just cite its id"). Cost: the shim's prose is now
    coupled to this spec's command name and must be kept in sync if the deterministic
    command is renamed later.
  - **Option B — rename the shim** (e.g. `/minspec-deep-analyze`) and leave its prompt
    unchanged, so "Analyze" unambiguously means the deterministic phase everywhere.
    Cost: breaks an existing, already-documented (`README.md:90`) command name for
    anyone who has it muscle-memorised; needs a managed-region rename across
    `.claude/commands/`, `.cursor/rules/spec-kit-commands.mdc`, and the skill list.
  - **Option C — leave the shim exactly as-is, accept the name collision.** Cost: two
    things named "Analyze" with different guarantees (deterministic vs. LLM-judged) is
    the exact kind of claim this project's own Evidence Discipline section warns about —
    a user running `/minspec-analyze` would have no way to tell, from the name alone,
    which one they got.

- **Decision 3 — diagnostics surface: markdown section, VS Code Problems panel, or
  both.** #18 asks for both ("inline in active spec panel + as diagnostics in spec
  markdown"). FR-6/FR-7 above spec the spec-panel-stepper and markdown-section halves,
  which reuse existing managed-region and phase-render machinery. A true VS Code
  `vscode.languages.createDiagnosticCollection` integration (squiggles in the editor
  gutter on the markdown file itself) is a third, separate surface with its own
  activation/update lifecycle not covered by FR-6/FR-7.
  - **(rec) Option A — ship FR-6 + FR-7 only (panel + in-markdown section) for v1**,
    track the editor-diagnostics surface as a follow-up issue. Cost: "diagnostics in
    spec markdown" reads as the in-file section rather than live editor squiggles,
    which is a narrower reading of #18's phrase than it may have intended.
  - **Option B — build the `DiagnosticCollection` integration now.** Cost: new
    extension-activation surface, a third place findings can go stale relative to the
    markdown they describe, and no existing `spec-panel.ts` precedent to follow (the
    panel is a webview, not a language-server diagnostic).

## Out of Scope

- Semantic or AI-judged conformance checking (plan-decision-matches-requirement-*intent*,
  not just id-citation) — that is the ScroogeLLM Phase 3 conformance integration
  (`design.md:300-307`), Tier-1, and explicitly not touched by this spec
  ([Context](#context--what-exists-today)).
- Style or grammar critique of requirement/plan prose (#18's own Non-Goals).
- The `constitution` phase Spec Kit also has that MinSpec lacks (#18's "Gap" paragraph
  names it but the issue's Scope section does not ask for it; a separate issue if wanted).
- Deciding `analyze`'s exact design-coverage matching algorithm (FR-3.3) — sized at Plan.
- Resolving Decisions 1-3 — this spec states the options; a human picks.

## Why no new DR

Every choice this design makes that is hard to reverse (the 71-spec migration path, the
existing AI-prompt shim's fate, the diagnostics surface) is left open under
[Decisions needed (Clarify)](#decisions-needed-clarify) rather than decided here — so
there is no decision yet for a DR to record. Once Clarify resolves these, the chosen
options may warrant one (Decision 1 in particular changes validator behaviour for every
tier-3/4 spec in the repo); that is this spec's Clarify-phase output, not Specify's.

## Traceability

- Issue: [#18](https://github.com/AIClarityAU/minspec/issues/18)
- Decision record: [DR-055](../../../docs/decisions/DR-055.md) (Spec-Kit command-surface
  parity — the bucket that shipped the existing `.claude/commands/minspec-analyze.md`
  this spec reconciles with)
- Epic: [EPIC-003](../../../docs/epics/EPIC-003-sdd-core.md) (SDD Core Methodology — the
  phase model this spec extends)
- Related spec: SPEC-012 (next-task resolver / dependency DAG — not modified, but the
  same `requirements.md`/`tasks.md` id vocabulary `analyze`'s checks read)
