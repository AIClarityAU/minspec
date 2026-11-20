---
id: SPEC-341
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute Extension (Autopilot Mode, DR-036)
aspects: [validator, fail-closed, no-silent-gate, config, autopilot]
depends_on: []
relates_to: ["#237", "DR-036", "DR-003", "SPEC-038"]
implements: none
implements_reason: >-
  Specify phase only. Nothing is built yet; the seam, the startup hook and the T0 tests are all
  planned (#237).
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-341: A per-repo seam elevates validator warnings to errors, so a spec missing tier, epic, acceptance or aspect-artifact is incomplete in Autopilot Mode

Issue: #237 (Autopilot prerequisite A5, "symmetric primitive never errors"). Design rests on DR-036 (Autopilot Mode, accepted) and `docs/autopilot-mode-design.md` (A5, firewall paragraph).

## Problem

With zero human reads in Autopilot Mode, a warning nobody reads is a silent lie (constitution invariant 2). Today `validateSpec` (`packages/minspec/src/lib/spec-validator.ts:1241`) computes `complete = !violations.some(v => v.severity === 'error')` (`:1424`), and the closed-set / reference rules are hardcoded `severity: 'warning'`:

- `frontmatter.<key>.missing` / `.unresolved` / `.unknown` (`:596`, `:612`, `:622`) - includes `tier` (required on primary specs, `:545`).
- `epic.missing` / `epic.unresolved` (`:1285`, `:1293`).
- `status.mirror-drift` (`:1338`), `status.cross-artifact.regression` (`:1662`), `status-claim.contradicted` (`:1852`), `park-ref.dangling` (`:1412`), `split-coverage.<type>.missing` (`:1540`).

So a spec with no `tier:` or no `epic:` returns `complete:true`, and every "elevate to error" gate DR-036 relies on is inert. Observed already-error rules (not part of this gap, stated so the spec does not over-claim): `acceptance.missing` is `error` at T3/T4 only (`:688`, via `requiresAcceptanceCriteria` `:387`) and aspect-artifact rules are `error` at T3/T4, `warning` at T2, ignored at T1 (`aspectSeverity` `:379`). A T1/T2 spec missing acceptance criteria therefore stays `complete:true` today.

Root cause (mechanism + missing gate): severity is a constant at each emit site; there is no per-repo input that can raise a class, so no repo can opt a warning class into a gate.

## Functional requirements

- **FR-1 Config key.** `MinspecConfig` gains an optional key (name decided in Clarify Q1) that lists warning classes to elevate to `error`. Absent or empty = today's behaviour exactly (precedent: `ownershipDeclaration` / `implementCloseout`, default `'warn'`, `config.ts:60,78,172-174`).
- **FR-2 One elevation point.** Elevation is applied in a single place over the final violation list in `validateSpec`, before `complete` is computed, not by editing each emit site. A rule id matching an elevated class has its severity set to `error`; rules already `error` are untouched; elevation never lowers severity.
- **FR-3 Class vocabulary.** Classes name the symmetric-primitive family: `closed-set` (`frontmatter.*.missing|unknown`), `reference` (`*.unresolved`, `epic.*`), `coverage` (`split-coverage.*`, acceptance, aspect-artifact), plus a catch-all. Exact mapping from rule ids to classes is a single table with a test that every emitted rule id is mapped or explicitly listed as non-elevatable (so a new warning rule cannot silently escape, INV-2).
- **FR-4 Acceptance and aspect-artifact at every tier.** When the elevation covers `coverage`, `acceptance.missing` fires as `error` for T1/T2 as well, and aspect-artifact rules are `error` at T2 (T1 stays exempt unless Clarify Q2 says otherwise).
- **FR-5 Autopilot startup sets it.** Autopilot Mode startup writes/enables the elevation for the active repo only (the opt-in marker is `.minspec/` at the repo root, invariant 3). The config file is protected from agent edits per DR-036 A3 (owned by #235, not this spec).
- **FR-6 Visible, fail-closed.** If the elevation config is present but malformed (unknown class, wrong type), validation reports an `error` violation naming the key; it never falls back silently to warning-only (invariant 2).
- **FR-7 Message honesty.** An elevated violation keeps its rule id and fixHint and states it was elevated by repo config, so a reader can tell it from a native error.
- **FR-8 Core unchanged.** A repo without the key, including this repo by default, sees byte-identical `validateSpec` results (invariant 3; DR-036 firewall "never hardcoded").

## Acceptance criteria

- [ ] **Config key** - a per-repo key elevates named warning classes to error. (FR-1, FR-3)
- [ ] **Startup sets it** - Autopilot Mode startup enables the elevation for the active repo and no other. (FR-5)
- [ ] **Missing tier** - T0 test: a primary spec with no `tier:`, validated with elevation on, returns `complete:false`; with elevation off, `complete:true` as today. (FR-2, FR-8)
- [ ] **Missing epic** - T0 test: no `epic:` in a repo with registered epics returns `complete:false` with elevation on. (FR-2)
- [ ] **Missing acceptance** - T0 test: a T1/T2 spec with no acceptance criteria returns `complete:false` with elevation on (it is already false at T3/T4). (FR-4)
- [ ] **Missing aspect-artifact** - T0 test: a T2 spec declaring an aspect with no artifact returns `complete:false` with elevation on. (FR-4)
- [ ] **No-escape table** - test fails if any emitted rule id is neither mapped to a class nor listed non-elevatable. (FR-3)
- [ ] **Malformed config fails closed** - a bad value yields an error violation, not warning-only. (FR-6)
- [ ] **Default identical** - golden test: no key = same violations and `complete` as before. (FR-8)

## Invariants this change must not break

- **INV-1** Offline, Tier 0: pure logic, no network (invariant 1).
- **INV-2** No silent gate: no rule may bypass the elevation point; malformed config fails visibly (invariant 2).
- **INV-3** Blast radius: nothing changes for a repo without `.minspec/` opt-in and the key (invariant 3).
- **INV-4** Elevation only raises severity, never lowers; native errors unchanged.

## Out of scope

Deliverable registry (#233), pipeline-state file (#234), forged-approval guard and config protection (#235), digest (#236), git-identity guard (#238). Whether Autopilot Mode's startup code exists at all: no Autopilot code was found under `packages/` (only `docs/autopilot-mode-design.md`), so FR-5 may need the startup entry point to be defined first (see Q3).

## Decisions needed (Clarify)

Recorded selections: each of the 3 selections below is an agent pick of the option this document marks recommended, recorded on 2026-11-17 under the founder decision in queue item clarsel. Sign-off ratifies them and may change any of them.

- **Q1 Config shape.** (a) `severityElevation: { classes: string[] }` generic list **(rec)** - one key, extensible; cost: a free-form list needs validation (FR-6). (b) A single boolean `autopilotStrict` - simplest to set at startup; cost: all-or-nothing, cannot ratchet one class and invites mode-coupling in core. (c) Per-rule keys like `ownershipDeclaration` - matches precedent; cost: a new key per rule, which is the sprawl this seam avoids.

  **Recorded selection: the recommended option,** option (a), `severityElevation: { classes: string[] }`. Agent pick of the recommended option, founder decision queue item clarsel, recorded 2026-11-17; sign-off ratifies it.
- **Q2 Tier floor.** Should elevated coverage also fail T1 specs (no acceptance/aspect at T1)? (a) No, T1 stays exempt **(rec)** - matches the tier ceremony table; cost: a T1 spec with nothing still builds. (b) Yes - strictest; cost: forces ceremony on one-sentence specs, against tenet 2.

  **Recorded selection: the recommended option,** option (a), no, T1 stays exempt. Agent pick of the recommended option, founder decision queue item clarsel, recorded 2026-11-17; sign-off ratifies it.
- **Q3 Where startup lives.** No Autopilot startup code exists yet. (a) This spec only ships the seam plus a pure helper that returns the elevation config; startup wiring lands with the Autopilot runner **(rec)** - keeps scope small; cost: the "startup sets it" criterion is verified at the helper, not end to end. (b) Build a minimal startup entry here - end-to-end proof; cost: scope expansion into the runner (#234/#235 territory).

  **Recorded selection: the recommended option,** option (a), ship only the seam plus a pure helper, and startup wiring lands with the Autopilot runner. Agent pick of the recommended option, founder decision queue item clarsel, recorded 2026-11-17; sign-off ratifies it.
