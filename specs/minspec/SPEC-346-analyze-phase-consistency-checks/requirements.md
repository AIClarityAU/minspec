---
id: SPEC-346
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — see Decisions needed D5 (epic fit unverified)
aspects: [lifecycle, analyze, tier-0, static-check, diagnostics]
relates_to: [SPEC-012, SPEC-054, SPEC-041, DR-004, DR-001]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan. Expected surface: a new analyzer module under `packages/minspec/src/lib/` (Decision D3) and an `analyze` member of the phase enum in `config.ts` (owned elsewhere).
---

# MinSpec — `/analyze` phase: static cross-artifact consistency checks (Requirements)

> Tracks issue [#18](https://github.com/AIClarityAU/minspec/issues/18). Rests on DR-004 (tier model, Tier 0 = offline) and DR-001 (SDD adoption). No new DR is proposed: every choice below is reversible in under a day.

## One-Sentence Scope

Add a deterministic, offline **analyze** phase between `tasks` and `implement` that parses a spec's `requirements.md` / `design.md` / `tasks.md` and reports structural traceability gaps (task↔requirement, requirement↔task, plan↔requirement-section, orphan acceptance criteria) as inline findings in the spec panel and as VS Code diagnostics — with no AI and no network.

## Context (verified against the tree, 2026-11-16)

- The phase enum is `'specify' | 'clarify' | 'plan' | 'tasks' | 'implement'` (`packages/minspec/src/lib/config.ts:8`); `PHASES` is the ordered list (`config.ts:11`). There is **no** `analyze` member.
- Tier→phase mapping lives at `config.ts:166-169`: T1 `[specify]`; T2 `[specify, plan]` (+optional `clarify`); T3 `[specify, plan, tasks, implement]` (+optional `clarify`); T4 all but with `clarify` required.
- `analyze` **already exists only as a prompt**: slash-command `/minspec-analyze` (`.claude/commands/minspec-analyze.md`, `packages/minspec/src/lib/slash-commands.ts:37,48,164`) tells the model to review consistency. That is model-trusted prose — nothing is computed, nothing is gated, nothing is shown in the panel. This spec supplies the deterministic counterpart.
- Spec Kit canon ends `… tasks → analyze → implement`; the issue notes deferral to ScroogeLLM conformance, which is shelved (CLAUDE.md, scrooge DR-021), so the structural subset is MinSpec's to own.

**Core gap (one sentence):** nothing computes whether tasks, plan, requirements and acceptance criteria actually reference one another, so an untraced requirement or an orphan task reaches `implement` unnoticed.

## Functional requirements

- **FR-1 — Phase.** `analyze` is added to the `Phase` union and to `PHASES`, ordered after `tasks` and before `implement`. All consumers that enumerate phases (frontmatter `phases:` map, lifecycle, spec tree/panel, next-task resolver, validators) accept it; a spec without an `analyze:` key reads as `pending`/not-applicable per FR-2, never as an error (existing specs must not break).
- **FR-2 — Tier mapping.** T1: analyze skipped (not listed). T2: optional. T3 and T4: required. `analyze` is placed in `requiredPhases`/`optionalPhases` accordingly in `config.ts`.
- **FR-3 — Pure analyzer.** A pure function `analyzeSpec(inputs) → Finding[]` takes the markdown text of the spec's requirements/design/tasks and returns findings. No `vscode`, no `fs`, no network, no clock (so it can live in `@aiclarity/shared` Tier-0 or `packages/minspec/src/lib/` and is unit-testable). Same input ⇒ byte-identical output ordering.
- **FR-4 — Checks.** Each is an error-level finding unless noted:
  1. **task-untraced** — a task in `tasks.md` cites no requirement id (`FR-n`, `AC-n`, etc.).
  2. **requirement-untasked** — a requirement id defined in `requirements.md` is cited by no task.
  3. **plan-gap** — a requirement section (heading or FR id) in `requirements.md` is not referenced from `design.md`.
  4. **ac-orphan** — an acceptance criterion cites no existing requirement id, or a requirement has no acceptance criterion (warning).
  5. **dangling-ref** — a task/plan/AC cites a requirement id that is not defined (error).
- **FR-5 — Finding shape.** `{ code, severity: 'error'|'warning', file, line, id?, message }`. Line numbers are 1-based into the source file so they map to diagnostics.
- **FR-6 — Surfaces.** Findings render (a) inline in the active spec panel under an "Analyze" group with counts, and (b) as VS Code diagnostics on the offending markdown line (diagnostic source `minspec-analyze`), cleared when the finding is fixed.
- **FR-7 — Gating posture.** A required-phase analyze with ≥1 error-level finding keeps the `analyze` phase `in-progress` and is shown visibly (invariant 2); it does not silently pass. Whether it *blocks* entering `implement` is Decision D1.
- **FR-8 — Fail visibly.** If a required input file is missing or unparsable, the analyzer emits an explicit `input-missing` error finding; it never returns an empty (clean) result on a read failure.
- **FR-9 — Command.** A palette entry "MinSpec: Analyze Spec" runs the analyzer on the active spec. The existing `/minspec-analyze` slash prompt is updated to instruct the model to run/read the deterministic findings first and only add judgement on top (prompt text only, via the managed region).
- **FR-10 — Opt-in boundary.** Runs only in a repo with `.minspec/` at root (constitution invariant 3).

## Acceptance criteria

- **AC-1** (FR-1, FR-2): `PHASES` order is `specify, clarify, plan, tasks, analyze, implement`; tier mapping yields analyze absent for T1, optional for T2, required for T3/T4 (unit test on `config.ts`).
- **AC-2** (FR-3): analyzer imports nothing from `vscode`, `fs`, `http(s)`, `net`; a repo-level import-boundary test (cf. SPEC-040) covers the file.
- **AC-3** (FR-4.1): a fixture task with no requirement ref yields exactly one `task-untraced` finding at that task's line.
- **AC-4** (FR-4.2): a fixture with `FR-3` defined and cited nowhere yields one `requirement-untasked` finding for `FR-3`.
- **AC-5** (FR-4.3): a requirement section absent from `design.md` yields `plan-gap`.
- **AC-6** (FR-4.4/4.5): an AC citing `FR-9` where only FR-1..FR-3 exist yields `dangling-ref`; an AC with no cite yields `ac-orphan`.
- **AC-7** (FR-3): a fully traced fixture yields `[]`; running twice yields identical arrays.
- **AC-8** (FR-8): deleting `tasks.md` from the fixture yields an `input-missing` error, not `[]`.
- **AC-9** (FR-6): findings appear as diagnostics at the reported line and disappear after the line is fixed (test with the extension's diagnostics collection mocked).
- **AC-10** (FR-1): every currently committed spec still parses/validates with the new phase (`npm run validate` green with no spec edits forced).
- **AC-11** (FR-4, corpus): running the analyzer over `specs/` yields a measured finding count recorded in the PR (false-positive rate on existing specs is the readiness evidence for D1).

## Invariants the change must not break

1. Offline: no network call (constitution invariant 1; DR-004 Tier 0).
2. No silent gate: missing inputs or parse errors surface as findings (invariant 2); no `|| true` on the gate signal.
3. Blast radius: nothing runs or writes in a repo lacking `.minspec/` (invariant 3).
4. No AI dependency; pure markdown parse + structural diff.
5. Approved specs stay approved: adding the phase must not alter any existing spec's canonical hash or approval state (canonicalisation already ignores `status:`; confirm `phases:` handling before touching it — unverified here).
6. Back-compat: specs without an `analyze:` phase key remain valid.

## Non-goals

- Semantic/AI conformance, style or grammar critique (ScroogeLLM / model territory).
- A `constitution` phase (the issue's other gap) — separate work.
- Auto-fixing findings.
- Cross-spec analysis (that is SPEC-041's graph work).

## Decisions needed (Clarify)

- **D1 — Does an error finding block `implement`?**
  (a) **Advisory only (rec)** — show and diagnose, never block; cheapest, no false-block risk while the heuristics are unproven on the corpus. Cost: a T3/T4 spec can still enter implement with gaps, so "required" means "must be run", not "must be clean".
  (b) Block until clean or explicitly waived — real gate, but regex-level traceability will produce false positives that stall agents and the founder.
  **Recorded selection: the recommended option,** (a), advisory only. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
- **D2 — Id convention for traceability.** (a) **Require explicit `FR-n`/`AC-n` ids cited in task text (rec)** — deterministic; cost: existing specs/tasks that cite by prose or `SPEC/FR3` form will report gaps until migrated (see CLAUDE.md DR-053 id grammar; the analyzer should accept both `FR-3` and `FR3`). (b) Heading-text matching — tolerant but ambiguous and brittle.
  **Recorded selection: the recommended option,** (a), require explicit `FR-n`/`AC-n` ids cited in task text, accepting both `FR-3` and `FR3`. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
- **D3 — Where the analyzer lives.** (a) **`packages/minspec/src/lib/` (rec)** — nearest to lifecycle; cost: not reusable by headless CI/agents. (b) `@aiclarity/shared` — reusable by dispatch scripts and a CI check, at the cost of widening the shared surface.
  **Recorded selection: the recommended option,** (a), `packages/minspec/src/lib/`. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
- **D4 — Existing specs' `phases:` map.** (a) **Treat missing `analyze` as not-applicable until the spec next reaches tasks-done (rec)** — no mass edit. (b) Backfill `analyze: pending` into all specs — noisy and would touch hash-locked files.
  **Recorded selection: the recommended option,** (a), treat missing `analyze` as not-applicable until the spec next reaches tasks-done. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
- **D5 — Epic.** Epic fit (EPIC-002 "Signpost Integrity") is a guess; reviewer to confirm or name the right epic.
  **Recommended (agent, 2026-11-17):** EPIC-003 (SDD Core Methodology), whose Goal names "the phase
  model (specify → clarify → plan → tasks → implement)" and the gates "that make a spec safe to
  implement against" (`docs/epics/EPIC-003-sdd-core.md`); this spec's defining change is a new
  member of that phase enum (`packages/minspec/src/lib/config.ts:8`) - cost: it then sits apart
  from SPEC-012 and SPEC-041, the cross-artifact checks filed under EPIC-002, whose Goal
  ("deterministic completeness predicates") also fits the analyzer itself. A genuine fit
  judgement, so not recorded.
  **Recorded selection: the recommended option,** EPIC-003 (SDD Core Methodology); the "not recorded" note above predates DR-123. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
- **D6 — Tier of this spec.** Issue estimates T3; it changes the phase enum used by many consumers — confirm T3 vs T4.
  **Recommended (agent, 2026-11-17):** T4. The `Phase` type and `PHASES` list
  (`packages/minspec/src/lib/config.ts:8-11`) are consumed by 13 non-test source files under
  `packages/minspec/src` and `packages/shared/src`, and specs persist a `phases:` map in their
  frontmatter, so this changes a cross-boundary contract - cost: T4 makes Clarify required
  (`config.ts:176`) and takes the spec out of the T3 lane where an agent pick closes Clarify. The
  tier decides the approval class, so it is the founder's.
  **Open, reserved for the founder:** the tier decides the approval class, so no agent pick is recorded (founder decision, queue item clarsel, exception for questions a spec reserves). Asked as queue item q346d6, 2026-11-23.
