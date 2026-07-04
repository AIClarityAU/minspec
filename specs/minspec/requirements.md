---
epic: EPIC-003  # SDD Core Methodology
id: SPEC-001
type: requirements
# Editing voids approval (hash in .minspec/approvals.json → stale); re-run "MinSpec: Approve Spec". DR-012
status: implementing
tier: T4
product: minspec
---

# MinSpec — Requirements Specification

> **⏳ Tier model under revision — review T1–T4 as provisional.** Fork B is accepted
> ([DR-024](../../docs/decisions/DR-024.md)): the unit of ceremony becomes a **risk
> profile** and `tier` (T1–T4) becomes a **derived/display label**; the tier→phase
> ladder will be replaced by risk→phase. Migration is **deferred until reach
> validation [#91](https://github.com/harvest316/minspec/issues/91) clears** (then
> [#90](https://github.com/harvest316/minspec/issues/90)). The T1–T4 content below is
> the live, operative model until then — not final.

**Date:** 2026-05-26
**Status:** Implementing
**Scope:** VS Code extension providing intelligent spec-driven development with complexity-adaptive ceremony.

---

## One-Sentence Scope

A free, agent-agnostic VS Code extension that classifies change complexity and applies proportional SDD ceremony — solving the #1 SDD adoption barrier (overhead) while capturing marketplace position in the 9-month-old, 32K-install, no-dominant-player SDD extension market.

---

## Problem Statement

Every current SDD tool applies uniform ceremony regardless of change size. Martin Fowler documented Kiro generating 16 acceptance criteria for a simple bug fix. HN's top SDD criticism (225pts, 191 comments) is "waterfall with AI." Developers try SDD, hit overhead on small changes, abandon it. No extension adapts.

---

## Target Users

1. **Primary:** Individual developers using AI coding tools (Claude Code, Copilot, Cursor, Cline) who want development discipline without bureaucracy.
2. **Secondary:** Engineering leads mandating SDD adoption who need a tool their team won't revolt against.
3. **Tertiary:** Developers currently using Spec Kit CLI who want a visual layer with intelligent phase-skipping.

---

## Functional Requirements

### FR-1: Change Complexity Classifier

The extension MUST classify every proposed change into one of four complexity tiers before any SDD phases execute.

| Tier | Label | Heuristic signals | Example |
|------|-------|-------------------|---------|
| T1 | Trivial | Single file, <50 lines changed, no new exports, no schema changes, no new dependencies | Fix typo, update constant, tweak CSS |
| T2 | Standard | 2-5 files, <200 lines, no cross-boundary changes, no new public APIs | Add validation, refactor function, fix bug |
| T3 | Complex | 6+ files OR new public APIs OR schema migration OR new dependency | New feature endpoint, DB migration, new package |
| T4 | Architectural | Cross-project impact OR new service OR breaking API change OR new infrastructure | New microservice, auth system rewrite, API v2 |

**Classifier inputs:**
- Git diff analysis (files changed, lines added/removed, file types)
- AST-level analysis where available (new exports, new classes, schema changes)
- User override (always available — classifier suggests, human decides)
- Historical calibration (learn from user's override patterns over time)

### FR-2: Adaptive Phase Selection

Based on complexity tier, the extension MUST select which SDD phases to execute.

| Phase | T1 Trivial | T2 Standard | T3 Complex | T4 Architectural |
|-------|-----------|-------------|------------|------------------|
| **Constitution** | Skip (use project default) | Skip (use project default) | Reference | Create/update |
| **Specify** | One-liner requirement | Requirements list | Full requirements + acceptance criteria | Full + cross-system impact |
| **Clarify** | Skip | Optional (flag ambiguities only) | Required | Required + stakeholder review |
| **Plan** | Skip | Lightweight (approach sentence) | Design document | Full design + ADR entry |
| **Tasks** | Auto-generate single task | Task list | Task DAG with dependencies | Task DAG + milestone gates |
| **Implement** | Direct implementation | Guided implementation | Phase-gated implementation | Phase-gated + review checkpoints |

User can always escalate tier (treat T1 as T2) or skip phases manually. Extension warns but doesn't block.

### FR-3: Spec Kit Compatibility

- MUST read and write Spec Kit's directory structure (`.spec-kit/` or configurable)
- MUST support Spec Kit's four phases (specify, plan, tasks, implement) as a subset of our six-phase model
- MUST interoperate with Spec Kit CLI — files created by either tool are valid in both
- MAY extend Spec Kit file format with optional frontmatter fields (tier, skipped-phases, classifier-confidence)
- MUST NOT require Spec Kit to be installed. Stand-alone operation is default.

### FR-4: Harness File Generation

`minspec init` MUST generate project harness files from templates:

| File | Purpose | Customizable? |
|------|---------|---------------|
| `CLAUDE.md` | Claude Code project instructions | Yes — template + user edits preserved on regenerate |
| `AGENTS.md` | Cross-tool agent instructions (Codex, Copilot) | Yes |
| `.cursorrules` | Cursor-specific rules | Yes |
| `DESIGN.md` | Google Stitch design doc | Yes |
| `.minspec/config.json` | Extension settings (tier thresholds, phase mappings, templates) | Yes |
| `.minspec/constitution.md` | Project constitution (invariants, principles, constraints) | Yes |

Templates are opinionated defaults. User overrides persist across `minspec init --refresh`.

### FR-5: SDD Lifecycle UI

VS Code sidebar panel with:

1. **Spec Tree View** — Hierarchical list of all specs in project, grouped by status (draft / in-review / approved / implementing / done / archived)
2. **Active Spec Panel** — Current spec's phases as a vertical stepper. Completed phases collapsed. Active phase expanded with editor.
3. **Tier Badge** — Complexity tier displayed on each spec. Click to override.
4. **Phase Skip Indicators** — Skipped phases shown as greyed-out steps with "skipped (T1)" label. Click to unskip.
5. **CodeLens Traceability** — Inline annotations in source files showing which spec requirement each function/test implements. Bidirectional: click annotation → jump to spec line. Click spec line → jump to code.

### FR-6: Agent-Agnostic Integration

Extension MUST work with any AI coding tool without requiring that tool's API or subscription:

| Integration | Mechanism |
|---|---|
| Claude Code | Inject spec context into CLAUDE.md. Hooks for session discipline. |
| GitHub Copilot | Inject spec context into workspace instructions. Copilot Chat participant (`@minspec`). |
| Cursor | Inject into .cursorrules. Composer context via workspace files. |
| Cline | Inject into .clinerules or workspace context. |
| Aider | Inject into .aider.conf.yml conventions. |
| Windsurf | Inject into .windsurfrules. |
| Generic | Spec files are plain markdown — any tool can read them from the file system. |

No AI tool dependency. Extension provides structure; AI tool provides generation.

### FR-7: Session Discipline

- MUST enforce session scope declaration before any spec work begins
- MUST detect topic drift (changes to files outside current spec's scope) and prompt parking-lot action
- MUST support GitHub issue creation for parked topics
- Session scope persists across VS Code restarts (stored in `.minspec/session.json`)

### FR-8: Architecture Decision Records

- MUST support `docs/decisions/DR-NNN.md` file format
- Auto-detect when a change is architectural (T4) and prompt for ADR creation
- ADR template includes: context, decision, status, consequences, implementation ref
- Sequential numbering with collision detection

### FR-9: Backlog Management

- MUST support WSJF scoring (Cost of Delay / Job Duration)
- Issue lifecycle: inbox → triaged → agent-ready → wip → done
- GitHub Issues as backing store (not a separate database)
- Label-based filtering and priority views in sidebar

---

## Costly to Refactor (Zone A)

Seams where a wrong early choice is expensive to undo, ranked by reversal cost. Each is FR-anchored.

| # | Seam | FR(s) | Why expensive to reverse |
|---|---|---|---|
| 1 | **Tier taxonomy (T1–T4) as the unit of ceremony** | FR-1, FR-2 | Every downstream artifact (frontmatter `tier:`, phase-mapping tables in FR-2, Tier Badge in FR-5, the SPEC-013 section registry) keys off these four labels. DR-024 already proves the cost: migrating the unit to a *risk profile* is deferred behind reach validation (#91) precisely because re-founding it touches every spec and UI surface. |
| 2 | **Spec Kit file-format compatibility contract** | FR-3 | "Files created by either tool are valid in both" is a published interop promise. Once users hold Spec-Kit-compatible artifacts, changing the on-disk shape breaks the no-lock-in invariant (Invariant 3) and the migration burden lands on users, not us. |
| 3 | **`.minspec/` filesystem layout as the database** | FR-4, FR-7, NFR-2 | `config.json`, `constitution.md`, `session.json` paths are referenced by name across FRs. Because there is *no backend* (NFR-2), the on-disk layout *is* the schema — renaming or restructuring it strands every existing project directory with no server-side migration path. |
| 4 | **Tier-0 air-gap boundary (no network imports)** | Invariant 2 (DR-004) | The "no `http`/`https`/`fetch` in `packages/minspec` or `packages/shared`" line is a load-bearing trust claim. Once shipped and audited, retrofitting a network call would void the Tier-0 guarantee and force the dispatch/Pro features back out into separate extensions (DR-015) — a structural, not cosmetic, change. |
| 5 | **Harness-merge semantics (preserve user edits on refresh)** | FR-4, Invariant 6 | `minspec init --refresh` must merge templates without clobbering user customizations. The merge strategy chosen now (marker regions vs. three-way) determines whether future template changes are deliverable at all; a wrong choice means every refresh risks data loss in user-owned `CLAUDE.md`/`AGENTS.md`. |

---

## Non-Functional Requirements

### NFR-1: Performance
- Complexity classification MUST complete in <500ms for repos up to 100K files
- Sidebar tree view MUST render in <200ms with up to 500 specs
- CodeLens annotations MUST not add >100ms to editor open time

### NFR-2: Zero Backend
- Extension MUST operate entirely locally. No account, no server, no telemetry.
- All data stored in project directory (`.minspec/`) and user settings.

### NFR-3: Marketplace Standards
- Extension size MUST be <5MB packaged
- MUST score 4+ on VS Code extension quality checklist
- MUST include walkthrough (VS Code Getting Started API) for onboarding

### NFR-4: Extensibility
- Phase definitions MUST be configurable (add/remove/reorder phases via config)
- Tier thresholds MUST be tunable per project
- Templates MUST support user overrides without losing defaults on update

---

## Invariants

These rules MUST NOT be violated by any implementation:

1. **No AI dependency.** Extension works with zero AI tools installed. Specs are plain markdown.
2. **Tiered network consent (DR-004).** Tier 0 (core): zero network calls, fully offline, no accounts, no telemetry. Tier 1 (opt-in): delegates to local CLI tools (`gh`, `claude`), no network code in extension. Tier 2 (MinSpec Pro): network services with explicit consent. No `http`/`https`/`fetch` imports in `packages/minspec` or `packages/shared`. Productized agent dispatch is Tier 1 but ships as a separate "Execute" extension, never inside `packages/minspec` (DR-015).
3. **No lock-in.** Spec files are Spec Kit-compatible markdown. User can delete extension and keep all artifacts.
4. **Ceremony proportional to complexity.** T1 changes MUST NOT require more than one sentence of specification. Enforcement via automated tests.
5. **User override always wins.** Classifier suggests, human decides. No phase is mandatory. No gate blocks without explicit user opt-in.
6. **Harness file regeneration preserves user edits.** `minspec init --refresh` MUST NOT overwrite user customizations in CLAUDE.md, AGENTS.md, etc.

---

## Acceptance Criteria (Zone A)

Definition-of-done, each tracing the FR/invariant it satisfies. A check is met only when the cited code path exists and is tested.

- [ ] **Classifier emits one of T1–T4 before any phase runs** (FR-1, Invariant 4) — given a git diff, `classify` returns a tier + confidence and no Specify/Plan step executes ahead of it.
- [ ] **User override always overrides the suggested tier** (FR-1 "User override", Invariant 5) — overriding T1→T2 changes the active phase set; no gate blocks without explicit opt-in.
- [ ] **Phase set matches the FR-2 table for each tier** (FR-2) — T1 yields a one-liner + direct implement; T4 yields full Specify + Clarify + Plan + ADR + gated implement.
- [ ] **A spec file written by MinSpec round-trips through Spec Kit unchanged** (FR-3, Invariant 3) — open with Spec Kit CLI, re-save, byte-diff is empty modulo intended fields.
- [ ] **`minspec init` produces all FR-4 harness files; `--refresh` preserves user edits** (FR-4, Invariant 6) — a sentinel edit in `CLAUDE.md` survives a refresh.
- [ ] **No `http`/`https`/`fetch` import resolves inside `packages/minspec` or `packages/shared`** (Invariant 2, DR-004) — automated import-scan test passes; Tier-0 air-gap holds.
- [ ] **Session scope must be declared before spec work and survives restart** (FR-7) — `.minspec/session.json` persists scope; drift to out-of-scope files prompts a parking-lot action.
- [ ] **T4 change auto-prompts ADR creation with sequential, collision-checked numbering** (FR-8) — DR-NNN file written, number = max+1, duplicate number rejected.
- [ ] **Classification completes <500ms on a 100K-file repo; tree renders <200ms at 500 specs** (NFR-1) — perf assertions in the benchmark suite.

---

## Success Metrics

| Metric | Target | Timeframe |
|--------|--------|-----------|
| Marketplace installs | 5,000 | 90 days post-launch |
| Marketplace rating | 4.5+ stars | 90 days |
| Weekly active users | 1,500 | 90 days |
| ScroogeLLM extension installs (bridge conversion) | 500 | 90 days post-ScroogeLLM launch |
| Spec Kit compatibility issues reported | <5 | 90 days |

---

## Out of Scope (Phase 1)

- Spec conformance checking (Phase 3 — requires the Tier-1 AI layer: agent-execute / `claude -p`, DR-015/017; semantic, so out of MinSpec's Tier-0 core. ScroogeLLM optional — only to cost-optimize those calls, not required.)
- Proxy integration or ANTHROPIC_BASE_URL injection
- Cost tracking or savings estimation (ScroogeLLM extension's job)
- Paid features or licensing
- Multi-user collaboration features
- CI/CD integration (future: GitHub Actions for spec-gated merges)

---

## Dependencies

| Dependency | Type | Risk |
|---|---|---|
| VS Code Extension API | Runtime | Low — stable API, well-documented |
| Spec Kit file format | Compatibility | Medium — Spec Kit is <1 year old, format may evolve |
| tree-sitter (for AST classification) | Optional runtime | Low — WASM build, widely used in VS Code extensions |
| Git CLI | Runtime | Low — present on all dev machines |

---

## Competitive Positioning

> **⏳ Angle evolving (held, [#86](https://github.com/harvest316/minspec/issues/86)).**
> The current tagline below is operative. The angle is shifting toward **"Just Enough
> _Review_; Always Enough _Consideration_"** (ceremony scales with *risk*, not size;
> consideration is always-on) per [DR-022](../../docs/decisions/DR-022.md). That copy
> change is **held until reach validation [#91](https://github.com/harvest316/minspec/issues/91)
> clears** ([DR-024](../../docs/decisions/DR-024.md) §4) — do not adopt it as final
> until then.

See [vscode-sdd-competitive-landscape-2026-05-26.md](../research/vscode-sdd-competitive-landscape-2026-05-26.md) Section 7 for full two-extension strategy.

**MinSpec's unique angle:** "Just enough spec. Never too much." No other SDD tool adapts ceremony to complexity. This directly addresses the #1 adoption barrier documented across HN discussions, Martin Fowler's analysis, and community feedback.

---

## Risks & Mitigations

Requirements/product-level risks (the *bets* this spec makes). Design/implementation
risks live in [the design doc](design.md). Per DR-020 (interim; screen-gated under DR-022).

| # | Risk | Likelihood · Impact | Mitigation |
|---|---|---|---|
| R1 | **Core adoption thesis unvalidated** — the spec bets that "proportional ceremony solves the #1 barrier (overhead-driven abandonment)." That overhead *is* #1, and that adapting ceremony fixes *retention*, are hypotheses, not measured. | Med · High | Anti-slop/never-wrong positioning leads (#59); classifier measured (κ=0.80, DR-009). The retention claim itself stays unproven — instrument adoption/retention before leaning on it in copy. |
| R2 | **Proportionality mechanism re-founded mid-flight** — this doc frames ceremony ∝ *size/complexity*, but DR-022/DR-024 move the unit to a *risk profile* (consequence axis). The spec's central mechanism is changing under it. | High · Med | Tier banner flags the provisional content; migration sequenced (#90) and gated on reach validation (#91). Update this doc's mechanism framing when #91 clears. |
| R3 | **Classifier over-promises "complexity"** — "classifies change complexity" reads as difficulty detection; the classifier measures *mechanical scope*, under-tiering subtle small fixes (κ=0.80). | Med · Med | DR-021: reframe to *scope, not difficulty* + upward-only ratchet (100%-precise floor); difficulty deferred to opt-in semantic. Fix the copy that implies difficulty detection. |
| R4 | **Spec Kit compatibility dependency** — adoption leans on Spec-Kit-compatible format; if Spec Kit's format diverges, compatibility (a stated selling point) breaks. | Low · Med | Plain Markdown + YAML frontmatter (FR-3 — format-stable, no binary container); the round-trip test (Acceptance Criteria / Test-Strategy FR-3 byte-diff) is the gate, and the "<5 compat issues / 90 days" metric (Success Metrics) is the early-warning. The Dependencies table already rates this Medium because Spec Kit is <1 year old. |
| R5 | **Conformance value depends on a second extension + AI** — the conformance/Phase-3 value prop needs the Tier-1 AI layer (agent-execute / `claude -p`, DR-015/017); if that slips, conformance is delayed. (Also: this doc mis-coupled it to ScroogeLLM — corrected at "Out of Scope".) | Med · Med | Conformance is explicitly **Phase 3 / out of scope for Phase 1**, so it never blocks launch; decoupled from ScroogeLLM (optional cost-optimizer, not required). |
| R6 | **First-mover marketplace bet** — "9-month-old, 32K-install, no-dominant-player market" assumes the window stays open; a dominant SDD extension could emerge first. | Med · Med | The defensible differentiator is the adaptive-ceremony mechanism (FR-1+FR-2) — "no other SDD tool adapts ceremony to complexity" (Competitive Positioning); hit the install/WAU targets (Success Metrics: 5,000 installs / 1,500 WAU @ 90 days) before a competitor founds the niche; anti-slop positioning copy (#59) defends it. |

---

## Assumptions

- The **overhead of uniform ceremony is the #1 SDD adoption barrier** (Problem Statement / FR-2). The product's whole adaptive-ceremony bet rests on this; it is asserted from Fowler/HN evidence, not yet measured here (see R1).
- **`tier` (T1–T4) remains the operative ceremony unit** until reach validation (#91) clears, after which DR-024's risk-profile model supersedes it. FR-1/FR-2 are written against the tier model on that basis.
- **Spec Kit's on-disk format stays plain Markdown + YAML frontmatter** (FR-3, Dependencies table) — the compatibility promise assumes no binary/proprietary container appears.
- **Git CLI and a filesystem-writable project root are present** (FR-1 diff analysis, NFR-2 local-only storage) — the extension never falls back to a server.

## Test-thought

Verified by the Acceptance Criteria checklist above plus the import-scan invariant test for Tier-0 (Invariant 2): classifier tier output is checked against the FR-2 phase table, harness refresh is checked with a sentinel-edit survival test (FR-4/Invariant 6), and Spec Kit round-trip is a byte-diff test (FR-3).

## Consequences

**Positive:**
- Adaptive ceremony (FR-1+FR-2) removes the overhead that drives abandonment, the documented #1 barrier — the spec's core value.
- Tier-0 air-gap (Invariant 2 / DR-004) makes the extension auditable and trust-buildable: a clean import scan is a provable claim, not marketing.
- Spec Kit compatibility (FR-3) + no-lock-in (Invariant 3) lower switching cost both ways, widening the addressable user base.

**Negative:**
- The four-tier taxonomy is a hard commitment that DR-024 is already unwinding; carrying both the tier model and the incoming risk model imposes dual-maintenance until #91/#90 land.
- "Classifies change *complexity*" (FR-1 wording) over-promises difficulty detection while the classifier measures mechanical scope (R3, DR-021) — a copy/expectation liability.
- Zero backend (NFR-2) forecloses server-side migrations, making the `.minspec/` layout (Costly-to-Refactor #3) effectively permanent once shipped.

## Failure-Modes / Edge-Cases

- **Classifier under-tiers a subtle one-line fix** (FR-1) — small mechanical scope, high real risk; κ=0.80 leaves a residual. Mitigated by upward-only ratchet + user override (Invariant 5); never silently blocks.
- **`minspec init --refresh` over a hand-edited harness file** (FR-4, Invariant 6) — naive overwrite would destroy user edits; merge must preserve them or the invariant fails.
- **Spec Kit writes a frontmatter field MinSpec doesn't recognize** (FR-3) — must round-trip the unknown field untouched, not drop it, or no-lock-in (Invariant 3) breaks.
- **ADR number collision under concurrent T4 changes** (FR-8) — two specs racing for the next DR-NNN; collision detection must reject the duplicate, not silently co-number.
- **Repo exceeds the NFR-1 envelope (>100K files / >500 specs)** — classification/tree render may breach the <500ms/<200ms budgets. No over-envelope degradation strategy is specified here (out of NFR-1's stated bound); accepted because the classify path runs on the git diff (FR-1 inputs), not full-repo scan, so file count past 100K does not linearly inflate it — the residual is the >500-spec tree render, deferred to the design doc rather than promised in this requirements doc.

## Coverage Map

Traceability cross-check: every concern/mechanism this spec addresses → the FR/NFR/invariant id(s) that own it. Read as "nothing dropped" — each requirement above appears at least once below.

| Concern / mechanism | Owning FR / NFR / Invariant |
|---|---|
| Classify change into a tier before any phase runs | FR-1; Invariant 4 |
| User can override the suggested tier (classifier suggests, human decides) | FR-1 ("User override"); Invariant 5 |
| Historical calibration of overrides | FR-1 ("Historical calibration") |
| Map tier → which SDD phases execute | FR-2 |
| Manual tier escalation / phase skip (warn, don't block) | FR-2; Invariant 5 |
| Spec Kit directory + four-phase read/write | FR-3 |
| Round-trip interop / files valid in both tools | FR-3; Invariant 3 |
| Stand-alone operation (Spec Kit not required) | FR-3; Invariant 1 |
| Generate harness files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `DESIGN.md`, configs) | FR-4 |
| Preserve user edits on `init --refresh` | FR-4; Invariant 6; NFR-4 |
| Sidebar spec tree / active-spec stepper | FR-5 |
| Tier badge + phase-skip indicators on specs | FR-5; FR-2 |
| Bidirectional CodeLens spec↔code traceability | FR-5 |
| Agent-agnostic injection (Claude/Copilot/Cursor/Cline/Aider/Windsurf/generic) | FR-6; Invariant 1 |
| Session scope declaration + persistence | FR-7 |
| Topic-drift detection + parking-lot / GitHub issue | FR-7 |
| `DR-NNN.md` ADR format + T4 auto-prompt | FR-8 |
| Sequential ADR numbering with collision detection | FR-8 |
| WSJF backlog scoring + GitHub-Issues-backed lifecycle | FR-9 |
| Classification / tree-render / CodeLens latency budgets | NFR-1 |
| Zero backend — no account/server/telemetry, all data in `.minspec/` | NFR-2; Invariant 2 |
| Packaged size / marketplace quality / walkthrough | NFR-3 |
| Configurable phases + tunable tier thresholds | NFR-4; FR-2; FR-1 |
| Tier-0 air-gap — no `http`/`https`/`fetch` in `packages/minspec` / `packages/shared` | Invariant 2 (DR-004); FR-6 |
| No AI dependency — specs are plain markdown | Invariant 1; FR-6 |

Coverage gaps (honest): FR-9 (Backlog Management) has no Acceptance-Criteria or Test/Verification-Strategy row above — it is mapped here for completeness but untested in this doc; surface as a test-strategy gap, not a silent omission.

## Alternatives Considered

Design choices this spec implicitly rejected. (Distinct from Competitive Positioning, which is about *market rivals*; this is about *our own* roads not taken.) Each names one alternative + a concrete why-not anchored in this spec.

| Alternative | Why rejected (anchor) |
|---|---|
| **CLI-only tool** (like Spec Kit CLI) instead of a VS Code extension | The product's value is *visual* phase-skipping over an existing CLI — FR-5 (tree view, tier badge, CodeLens) and the Target-Users tertiary ("Spec Kit CLI users who want a visual layer") only exist inside an editor. A CLI would forfeit FR-5 entirely. We instead *interoperate* with the CLI (FR-3), not replace the editor. |
| **Uniform/fixed ceremony** (one SDD process for all changes) | This is the documented #1 abandonment cause (Problem Statement; Fowler's 16-criteria-for-a-bugfix example). Invariant 4 ("T1 MUST NOT require more than one sentence") and FR-2's per-tier phase table exist *specifically* to reject it. Adopting it would delete the product's reason to exist. |
| **AI-judged completeness / semantic conformance** as the core gate | Rejected for the Tier-0 core: it requires the AI layer, violating Invariant 2 (no network) and Invariant 1 (no AI dependency). Deferred to a separate Tier-1 "Execute" extension (DR-015) and listed in Out of Scope (Phase 1). The core stays deterministic (classifier + FR-2 table), air-gapped, and auditable. |
| **Bundling ScroogeLLM / cost-tracking into MinSpec** | Cost tracking and proxy integration are explicitly Out of Scope (Phase 1) and split into a separate extension (DR-027 / Out-of-Scope). Bundling would pull network code into the Tier-0 core, breaking Invariant 2; the split keeps MinSpec air-gapped and free (no "Paid features" — Out of Scope). |
| **Opinionated framework with a hidden state DB** (own format + backend) | Rejected by NFR-2 (zero backend) and Invariant 3 (no lock-in): a proprietary format/DB would strand users on uninstall and foreclose the Spec-Kit round-trip (FR-3). We instead make the `.minspec/` filesystem layout *be* the schema (Costly-to-Refactor #3) and keep specs as plain markdown. |
| **Difficulty-detecting classifier** (judge how *hard* a change is) | Rejected as undeliverable deterministically: the classifier measures *mechanical scope*, not difficulty (R3; DR-021), and difficulty detection would again need the semantic/AI layer barred by Invariant 2. FR-1 is scoped to git-diff/AST signals + an upward-only ratchet instead. |
| **Block on gates** (hard-stop the user at phase boundaries) | Rejected by Invariant 5 ("User override always wins … No gate blocks without explicit user opt-in") and FR-2 ("Extension warns but doesn't block"). A blocking design would reproduce the bureaucracy the product is built to remove. |

## Test / Verification Strategy

Per-FR test tier (T0 = invariant, T1 = contract, T2 = feature, T3 = regression, T4 = coverage) with a one-line assertion sketch.

| FR / Invariant | Tier | Assertion sketch |
|---|---|---|
| Invariant 2 (DR-004) no network imports | T0 | Import-scan over `packages/minspec` + `packages/shared` finds zero `http`/`https`/`fetch`. |
| Invariant 4 ceremony-proportional | T0 | A T1 change requires ≤1 sentence of spec; assert phase set has no Plan/Clarify. |
| Invariant 5 user override wins | T0 | Override of suggested tier mutates active phase set; no blocking gate fires. |
| FR-1 classifier | T1 | `classify(diff)` returns a tier ∈ {T1..T4} + confidence ∈ [0,1] deterministically. |
| FR-2 phase selection | T2 | For each tier, selected phases equal the FR-2 table row. |
| FR-3 Spec Kit round-trip | T1 | Write→read via Spec Kit CLI yields byte-identical file modulo intended fields. |
| FR-4 harness refresh | T2 | Sentinel edit in `CLAUDE.md` survives `init --refresh`. |
| FR-7 session discipline | T2 | Scope persists across restart via `.minspec/session.json`; out-of-scope edit prompts parking. |
| FR-8 ADR numbering | T2 | Next DR = max+1; duplicate number rejected. |
| NFR-1 performance | T2 | Classify <500ms @100K files; tree <200ms @500 specs (benchmark). |
| R3 under-tiering regression | T3 | Known subtle-fix sample classifies ≥ its true tier after the upward-only ratchet. |

## Dependencies & Blast-Radius

Builds on the **Dependencies** table above (VS Code API, Spec Kit format, tree-sitter, Git CLI). Blast radius if these change:

- **Tier taxonomy (FR-1/FR-2)** — consumed by FR-5 Tier Badge, frontmatter `tier:`, and the SPEC-013 section registry. Changing it ripples to every spec file and the sidebar; this is why DR-024's migration is staged behind #91/#90.
- **`packages/shared` (contract types + classifier engine, DR-014)** — consumed by `packages/minspec`, `packages/extension-pack`, and the prospective `aiclarity.agent-execute` (DR-015). A breaking change to its tier/contract types breaks all three callers.
- **Spec Kit format (FR-3)** — a divergence breaks the interop selling point and the no-lock-in invariant (Invariant 3); early-warning is the "<5 compat issues / 90 days" metric.
- **`.minspec/` layout (FR-4/FR-7, NFR-2)** — every existing project directory depends on these paths; no backend means no migration path (Costly-to-Refactor #3).

## Rollback / Reversibility

- **Per-feature:** FR-5 UI, FR-7 session discipline, FR-8 ADR prompting are additive and individually reversible by feature-flagging or removing the contributing command — low blast radius, undoable in <1 day.
- **Not cheaply reversible:** the tier taxonomy (Costly-to-Refactor #1), Spec Kit format contract (#2), `.minspec/` layout (#3), and the Tier-0 air-gap boundary (#4). These are the foundational seams; reversing any requires a user-facing migration. The tier-model rollback is *already* an ADR-tracked program (DR-024), gated on #91 then #90 — not a code revert.
- **ADR-filter (DR-003):** Can this spec's core be undone in <1 day? **No** — it defines the methodology primitive (the tier model) and a published file-format contract. Foundational; the governing decisions are recorded as DR-004, DR-012, DR-014, DR-015, DR-021, DR-022, DR-024.

## Follow-ups (tracked)

- Re-found ceremony unit on risk profile, deprecate tier→phase ladder — DR-024; sequenced #90, gated on reach validation #91.
- Reframe FR-1 "complexity" → "scope, not difficulty" + upward-only ratchet — DR-021 (addresses R3).
- Adopt the "Just Enough Review; Always Enough Consideration" positioning — held, #86; gated on #91.
- Instrument adoption/retention to validate the #1-barrier thesis (R1) — #91 (reach validation).
- Lead anti-slop / never-wrong positioning copy — #59.
