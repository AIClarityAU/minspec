---
id: SPEC-097
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology — DR-022/DR-024/DR-020/DR-014 all live here
relates_to: [DR-022, DR-024, DR-014, DR-021, DR-020, SPEC-004, SPEC-013, SPEC-023, "#90", "#91", "#89", "#88", "#86"]
---

# MinSpec — Risk-Profile Frontmatter Contract (Fork B materialization) — Requirements

> **SPECIFICATION ONLY — do not start Plan.** This dispatch is authorized for the
> Specify phase and nothing else. Nothing below is built by the agent that wrote this
> file. A human reads it, resolves the Clarify questions, and approves it through the
> normal spec-approval gate before any Plan/Tasks/Implement work begins — and even
> then, **FR-1 through FR-5 (the migration itself) MUST NOT advance to Plan until
> [#91](https://github.com/AIClarityAU/minspec/issues/91) (reach validation) clears**,
> per [DR-024](../../../docs/decisions/DR-024.md) Decision point 1 and the standing
> banner on [`specs/minspec/requirements.md`](../requirements.md#L13-L19). That gate is
> not this spec's to lift; see *Decisions needed (Clarify)*, DQ-1.

**Date:** 2026-10-03
**Status:** Specifying
**Triggered by:** [#90](https://github.com/AIClarityAU/minspec/issues/90) — "frontmatter contract migration — risk-profile/required-phase set replaces scalar tier (+calibration reset)."
**Decision:** [DR-024](../../../docs/decisions/DR-024.md) Decision point 1 (accepts the Fork-B contract *direction*; sequences this migration post-#91, pre-ship) — superseding [DR-022](../../../docs/decisions/DR-022.md) §4-5, which issue #90 cites directly but which is itself `status: superseded` by DR-024 (see Reality-check, R1).
**Relates:** [DR-014](../../../docs/decisions/DR-014.md) (Tier-0 shared-contract boundary), [DR-021](../../../docs/decisions/DR-021.md) (removed the EMA/weight-tuning machinery this issue's calibration ask assumes still exists — see R2), [DR-020](../../../docs/decisions/DR-020.md) (the interim risks policy this migration does not touch), [SPEC-004](../SPEC-004-classifier-validation/requirements.md) (the κ=0.80 size-tier study `tier` is validated against today), [SPEC-013](../SPEC-013-risk-section-policy/requirements.md) and [SPEC-023](../SPEC-023-consequence-screen/requirements.md) (both already carry the identical #91-gated banner pattern this spec reuses).

---

## Reality-check (premises in #90 the corpus contradicts — resolved below)

Per CLAUDE.md's Evidence Discipline: the issue's three cited premises were checked
against code and the decision register, not taken on the issue's word.

1. **"Implements DR-022" is stale.** `docs/decisions/DR-022.md` frontmatter reads
   `status: superseded`. Its own banner (added 2026-08-06) says only the Fork-B
   *contract direction* survived, inside **DR-024**; the frontmatter migration
   (this spec) is explicitly **not** part of what DR-022 itself authorizes doing now.
   This spec implements **DR-024** Decision point 1, and treats DR-022 §4-5 as the
   *model of record* DR-024 defers to, not as a currently-accepted instruction.
2. **The calibration "EMA reset" premise no longer has a referent.** Issue #90 says
   "Reset `.minspec/calibration.json` (EMA was trained on size-tiers → basis invalid)."
   `packages/minspec/src/lib/classifier.ts:44-58` shows DR-021 already removed the
   EMA/weight-adjustment machinery (`recalculateWeights`/`applyCalibration`/
   `weightAdjustments`) before DR-022 was even written; `CalibrationData` today is
   `{ overrides: CalibrationOverride[] }` — a **retained override event log**, not a
   trained model. There is no EMA basis left to invalidate. See FR-6 for what a
   "reset" can honestly mean here.
3. **"The catalog (#CATALOG)" is an unfilled placeholder.** The issue body contains
   the literal unsubstituted token `#CATALOG`. Read against
   [DR-024](../../../docs/decisions/DR-024.md) Context ("the risk→phase catalog
   (#89)"), the intended reference is **#89**. No spec exists for #89 (searched
   `specs/` for "catalog", "risk→phase" — zero hits besides DR prose), and #89 is
   itself gated on #91 per DR-024 Decision point 2. This spec does **not** depend on
   #89 existing — DR-024's R3 explicitly designed the profile container to hold just
   `{ tier }` if the catalog/reach model never materializes (Costly to Refactor,
   DR-024). Confirmed by grep, not inferred; flagged here because #90's own wording
   asserted a hard dependency that the governing DR denies.

## One-Sentence Scope

Define the risk-profile frontmatter + approval-record container that DR-024 already
decided is the contract's *shape* (a strict superset of today's scalar `tier`, which it
holds verbatim as `{ tier }` until #91/#89 land real risk signals), specify the
mechanical ~20-spec frontmatter migration and the `tier` derivation that keeps every
existing consumer working unchanged, and correct the calibration-reset ask to the one
thing that is actually invalidated by this change (an engine/schema version stamp) —
all without touching the size-tier classifier `classify()` computes today.

## Context

### What reads and writes `tier` today (traced, not inferred)

`Tier` and `Phase` are declared in `packages/minspec/src/lib/config.ts` (not
`@aiclarity/shared` — DR-014's clause-2 relocation is `status: proposed`, unexecuted,
tracked at [#54](https://github.com/AIClarityAU/minspec/issues/54); this spec does not
touch that). `TierPhaseMapping` (`config.ts:18`) and the concrete `phaseMappings` table
(`config.ts:133-137`) are the T1-T4 → required/optional-phases map FR-2 of the top-level
product spec describes.

Consumers that read a spec's or approval's `tier` value directly:

| File | What it does with `tier` |
|---|---|
| `classifier.ts:36-41`, `:93-150`, `:191-209` | Computes it (`classify`, `applyFloor`, override path); emits `ClassificationResult.tier` and `suggestedPhases` from `config.phaseMappings[tier]` |
| `config.ts:49`, `:133-137` | Declares and seeds the `Tier → TierPhaseMapping` table every lookup below keys off |
| `approval.ts:66` | `ApprovalRecord.tier: Tier` — written into every approval sidecar at `approve.ts` time |
| `approval-store.ts` (imports `Tier` from `config`) | Serializes/deserializes the sidecar's `tier` field |
| `scaffold.ts:196`, `:217`, `:251` | Decides whether to scaffold `tasks.md` from `config.phaseMappings[tier]?.requiredPhases.includes('tasks')` |
| `spec-catalog.ts:23`, `:95` | Derives "required phases" for sidebar progress from `config.phaseMappings[fm.tier]?.requiredPhases` |
| `active-spec.ts:70`, `:93` | Surfaces `tier` in the active-spec status bar model |
| `artifact-graph.ts:542` | Carries `tier` into the dependency-graph node shape |
| `context-injector.ts:11` | Carries `tier` into the slash-command context payload |
| `slash-commands.ts:84`, `:132` | Hard-codes the four-label text ("one of `T1`, `T2`, `T3`, `T4`") in `/minspec-specify` guidance |
| `scripts/validate-frontmatter.ts:260-262` | Validates `tier:` against `/^T[1-4]$/` and (around `:244`) checks phase-file completeness against `config.phaseMappings[tier].requiredPhases` |

That is at least ten non-test files plus the validator — consistent with the dispatcher's
T3/T4 classification and with DR-022's own "HIGHEST... breaking data-model migration"
rating (`docs/decisions/DR-022.md:148`).

### What DR-024 actually decided (the operative contract)

[DR-024](../../../docs/decisions/DR-024.md) Decision point 1: **"ACCEPT (here): Fork B
as the contract *direction*."** The unit of ceremony becomes a risk-profile container;
`tier` becomes a derived field. Justified because the container is a strict superset of
a scalar (R3: "Container is a superset; holding `{tier}` is strictly ≥ a scalar"), so
choosing the shape now is low-regret **independent of whether the reach model is any
good**. But the same clause sequences *this migration* "pre-first-ship, after reach
validates — it is **not** performed now." The product spec's own banner
(`specs/minspec/requirements.md:13-19`) and Costly-to-Refactor #1
(`requirements.md:159`) both restate the same order: **#91 then #90**, not the reverse.

### The calibration file does not exist in this repo

`.minspec/calibration.json` is a per-installation runtime artifact
(`classifier.ts:214-262`, `CALIBRATION_FILE = 'calibration.json'`), not a committed
file — `find . -name calibration.json` under this checkout returns nothing. "Reset" can
only mean something this extension does the next time it *writes* that file in an
adopter's `.minspec/`, not an edit this PR makes to a file in the repo.

## Functional Requirements

- **FR-1 — `RiskProfile` container type, Tier-0.** Add a `RiskProfile` interface
  holding `{ readonly tier: Tier }` in v1 (DQ-2 decides which module). It MUST be a
  strict superset-compatible shape: adding a later `signals: TrippedRisk[]` field (fed
  by #88's analyzers through #89's catalog, both still gated on #91) MUST NOT require
  changing any v1 consumer that reads only `.tier`. No signal field is added by this
  spec — v1 ships `{ tier }` only, exactly DR-024 R3's fallback case.

- **FR-2 — `tier` becomes computed, never hand-authored, with byte-identical output.**
  A pure function `deriveTier(profile: RiskProfile): Tier` MUST exist and, for every
  v1 profile, return `profile.tier` unchanged (trivial in v1, because the profile holds
  nothing else yet). Every one of the ten consumer files in Context MUST read `tier`
  through this function (or an equivalent single call site) rather than destructuring
  frontmatter's `tier:` key directly, so that when #89/#91 later populate `signals`,
  the derivation changes in one place. This spec does **not** change what any of those
  ten files outputs today — same tier in, same tier out.

- **FR-3 — Frontmatter keeps `tier:` as the authored/back-compat field; no new
  required key.** Per the issue's own framing ("keep `tier` as a derived field for
  back-compat") and DR-024's superset guarantee, existing frontmatter is NOT required
  to gain a new `riskProfile:` block. `tier:` continues to satisfy
  `scripts/validate-frontmatter.ts:260-262`'s `/^T[1-4]$/` check unchanged.
  `deriveTier({ tier: fm.tier })` MUST round-trip to the same value the file already
  declares, so the "~20 existing spec frontmatters" migration (issue #90) is a
  **no-byte-change** mechanical pass in v1: it adds no field, because there is no
  signal data yet to carry. (DQ-3 covers whether that makes the migration a no-op
  worth shipping now at all.)

- **FR-4 — `ApprovalRecord.tier` keeps writing the same value, through the same
  function.** `approval.ts:66` and `approval-store.ts` MUST continue to persist
  `tier: Tier` in the sidecar, computed via `deriveTier` at approval time
  (`approve.ts`'s existing call site), so no approval-record schema version bump is
  needed in v1 and no existing sidecar file requires rewriting.

- **FR-5 — A test pins "same tier in, same tier out."** A new test MUST classify a
  representative sample (one T1, one T2, one T3, one T4 fixture, plus the override
  path of `classifier.ts:191-209`) before and after routing through
  `RiskProfile`/`deriveTier`, and assert the emitted `tier` and `suggestedPhases` are
  byte-identical. It MUST fail if any of the ten consumer files in Context is left
  reading frontmatter's `tier:` directly instead of through `deriveTier` (a
  grep-based inventory test, the same shape `opt-in-writer-inventory.test.ts`
  (SPEC-096 FR-9) uses for its population check).

- **FR-6 — Calibration: stamp an engine/contract version, not an "EMA reset."**
  Per the Reality-check, there is no trained model to invalidate. What this change
  *does* alter is the shape `CalibrationData` sits beside (a new `RiskProfile` type
  entering the same module). DR-014 §4 already calls for "stamp an engine/contract
  version field... so a skew is detected and surfaced, not silent." This spec
  specifies that stamp for calibration specifically: `CalibrationData` gains an
  optional `schemaVersion?: number` field; `loadCalibration` (`classifier.ts:227`)
  MUST treat a missing or lower `schemaVersion` as valid (no data loss — the override
  log is still useful raw signal per the comment at `classifier.ts:52-54`) and MUST
  NOT delete or rewrite existing overrides. "Reset" in v1 means: the *next* file this
  extension writes carries the current `schemaVersion`; no in-place destructive reset
  of a user's file is performed by this change, because nothing in it is wrong today.

- **FR-7 — Documentation corrections ride with the code change.** The banner on
  `specs/minspec/requirements.md:13-19` and its Costly-to-Refactor #1
  (`requirements.md:159`) and Assumptions (`requirements.md:288`) entries MUST be
  updated to say the Fork-B *shape* has shipped (post-#91 clearance; see DQ-1) rather
  than "migration deferred," once FR-1 through FR-5 land. Not performed by this spec;
  recorded so the Plan phase that eventually executes this does not miss it (DR-023's
  no-orphan-consequences rule).

## Acceptance Criteria

- [ ] `RiskProfile` type exists, holds exactly `{ tier: Tier }` in v1, and is documented
      as extensible without a breaking change to v1 consumers. (FR-1)
- [ ] `deriveTier` exists, is pure, and every one of the ten files in the Context table
      calls it instead of reading `tier` from frontmatter/the sidecar directly. (FR-2)
- [ ] All ~20 existing spec frontmatters pass `npm run validate` unchanged — zero byte
      diff beyond what the mechanical pass intentionally touches. (FR-3)
- [ ] Existing `.minspec/approvals/**/*.json` sidecars remain valid; no rewrite is
      required for already-approved specs. (FR-4)
- [ ] The FR-5 pinning test exists, passes, and is shown red if any consumer bypasses
      `deriveTier`. (FR-5)
- [ ] `CalibrationData.schemaVersion` is optional, old files without it still load, and
      no override entry is deleted or mutated by this change. (FR-6)
- [ ] `npm run validate`, `npm test`, and `npm run lint` all pass with no `tier:`
      value anywhere in the corpus changing. (FR-2, FR-3)

## Invariants (must not break)

- **INV-1 — Offline core (constitution invariant 1, DR-004).** No network call is
  added; `RiskProfile`/`deriveTier` are pure, Tier-0 functions.
- **INV-2 — No silent gate (constitution invariant 2).** `deriveTier` must not swallow
  an unrecognized `tier` value — it fails the same way `validate-frontmatter.ts:261`'s
  regex check does today (undefined/flagged), never defaulting silently.
- **INV-3 — Blast radius (constitution invariant 3).** This spec changes code under
  `packages/minspec/` and `packages/shared/` only (per DQ-2) and specs' own
  frontmatter; nothing it ships writes to a repo that has not opted in (`.minspec/`
  marker, unrelated to this change).
- **INV-4 — Upward-only ratchet is unaffected (DR-021 Decision 1).** `applyFloor`
  (`classifier.ts:93-96`) is untouched; FR-2's byte-identical requirement covers it.
- **INV-5 — No change ships ahead of #91 (DR-024 Decision point 1).** Nothing in this
  spec's FRs may reach `main` via Plan/Tasks/Implement before
  [#91](https://github.com/AIClarityAU/minspec/issues/91) clears, independent of how
  low-regret the shape is. See DQ-1.

## Decisions needed (Clarify)

Each carries a recommendation and its cost (this repo's `autonomy: act`,
`.minspec/config.json:58`, means a recorded recommendation stands as the working
answer until a human changes it — DR-086 §2/§4). No option below has been ratified by
a human; approving this spec at these recommendations is what would ratify them.

### DQ-1 — Does writing this spec now, pre-#91, contradict DR-024?

**Recorded selection: Option A.**

- **Option A — Specify now; hard-block Plan/Tasks/Implement on #91 (rec).** DR-024's
  own Follow-ups list *this issue* (#90) as tracked work, sequenced "post-#91,
  pre-ship" — i.e. DR-024 expects #90 to exist and be ready, not to be built early.
  Issue #90 itself argues for doing the *mechanical* part "while only proposed specs
  exist (cheap)," which is a Specify-phase argument, not a license to implement.
  INV-5 encodes the stop point explicitly so a future Plan-phase session cannot miss
  it by only reading the FRs. *Cost:* this spec sits in `specifying` indefinitely with
  no date, and a reviewer must remember to re-check #91's status before ever approving
  it into Plan — a prose-enforced gate (CLAUDE.md's own "enforce, don't trust the
  model" principle applies against this spec too).
- **Option B — Do not write this spec until #91 clears.** *Cost:* the dispatcher
  already authorized and ran this Specify-phase dispatch; declining to produce
  anything spends the dispatch for nothing and leaves #90 with no documented target
  shape for whenever #91 does clear.

### DQ-2 — Where does `RiskProfile` live: `packages/shared` or `packages/minspec/src/lib`?

**Recorded selection: Option A.**

- **Option A — Redeclare a minimal Tier-0 copy in `@aiclarity/shared`, mirroring the
  `next-task.ts:57` precedent (rec).** `packages/shared/src/next-task.ts:52-57`
  already redeclares `Phase` locally rather than importing it from
  `packages/minspec`, with the comment "mirror packages/minspec source-of-truth,
  redeclared Tier-0-locally" — precisely to avoid dragging `packages/minspec`'s
  non-Tier-0 surface into `shared`. `RiskProfile` (and later, ScroogeLLM's interest in
  the same vocabulary per DR-014 §2) follows that same pattern: a redeclared,
  barrel-exported type, not a module move. *Cost:* two declarations of overlapping
  shape exist (`config.ts`'s `Tier` and `shared`'s `RiskProfile.tier: Tier`) until a
  real engine-version check (DR-014 §4, still unbuilt per DR-014's clause-state table)
  catches drift between them.
- **Option B — Keep it local to `packages/minspec/src/lib/classifier.ts`, next to
  `Tier`/`Phase`.** What [SPEC-023](../SPEC-023-consequence-screen/requirements.md)
  Clarification C1 chose for its analyzers, for the same reason: moving to `shared`
  "would touch the `@aiclarity/shared` contract that ScroogeLLM also consumes —
  out-of-scope blast." *Cost:* the issue's own framing ("Tier-0 **shared** contract
  (DR-014)") goes unmet in code, even though DR-014's clause-2 relocation remains
  unexecuted regardless (#54) — so this option arguably matches the *actual* unexecuted
  state of DR-014 better than Option A does.

### DQ-3 — Is a byte-identical, no-new-field v1 worth shipping at all?

**Recorded selection: Option A.**

- **Option A — Yes; ship the type + derivation function now, defer the frontmatter
  field (rec).** The value is the *seam* (FR-1/FR-2: one function every consumer calls
  through), not a frontmatter byte change — so that when #89's catalog and #91's
  validated signals exist, populating `RiskProfile.signals` touches one function body,
  not ten files. This is exactly DR-022's own point 5 ("the engine barely changes...
  we add consequence analyzers and demote the size signals") applied to the *data
  model* instead of the engine. *Cost:* reviewers must be told explicitly that "the
  frontmatter migration" ships no visible frontmatter change in v1, which reads as
  surprising against the issue title.
- **Option B — Wait for #89/#91 and ship the seam and the field together.** *Cost:*
  reintroduces exactly the "double re-pour" DR-022's Context section says Fork
  A-then-B forces — the whole argument for deciding the contract direction early is
  lost if its first real implementation also waits for the catalog.

## Out of Scope

- **The actual consequence/reach signals.** [#88](https://github.com/AIClarityAU/minspec/issues/88),
  gated on #91.
- **The risk→phase catalog.** [#89](https://github.com/AIClarityAU/minspec/issues/89),
  gated on #91; this spec's container is designed to not need it (DQ-3).
- **DR-014 clause 2 (classifier engine relocation to `packages/shared`).** Tracked at
  [#54](https://github.com/AIClarityAU/minspec/issues/54); DQ-2 Option A adds a type to
  `shared` without moving `classify()`.
- **Positioning / marketplace copy.** [#86](https://github.com/AIClarityAU/minspec/issues/86),
  held pending #91 (DR-024 Decision point 4) — untouched by this spec.
- **Any change to `DR-020`'s tier-proportional Risks & Mitigations policy.** Stays in
  force per DR-024 Decision point 3; this migration does not touch
  [SPEC-013](../SPEC-013-risk-section-policy/requirements.md).
- **Rewriting a user's existing `.minspec/calibration.json`.** FR-6 stamps future
  writes only; no destructive migration of a file nothing is wrong with.

## Alternatives considered and rejected

Recorded because this spec was written without a live conversation (DR-086 §4).

- **Implement the full migration now, including the new frontmatter field.**
  Rejected: directly contradicts DR-024's explicit sequencing ("not performed now")
  and this dispatch's own Specify-only authorization.
- **Drop the calibration FR entirely since the issue's premise is false.** Rejected:
  the premise is false but the underlying DR-014 §4 obligation (stamp an
  engine/contract version so skew is detected, not silent) is real and adjacent —
  FR-6 answers the question the issue meant to ask, honestly, rather than silently
  dropping the whole bullet.
- **Treat `#CATALOG` as a genuinely open reference and ask the human to supply it.**
  Rejected in favor of resolving it to #89 from DR-024's own Context prose — the
  inference is cited and marked (Reality-check #3), not silently assumed, and DQ-3
  already structures this spec to not depend on #89's existence either way.

## Traceability

- **Issue:** [#90](https://github.com/AIClarityAU/minspec/issues/90).
- **Governing decisions:** [DR-024](../../../docs/decisions/DR-024.md) (operative;
  Decision point 1), [DR-022](../../../docs/decisions/DR-022.md) (superseded model of
  record for the eventual risk→phase mechanism), [DR-014](../../../docs/decisions/DR-014.md)
  (Tier-0 shared-contract boundary; §4 engine-version stamping cited by FR-6),
  [DR-021](../../../docs/decisions/DR-021.md) (removed the EMA machinery the issue
  assumed still existed), [DR-020](../../../docs/decisions/DR-020.md) (interim risks
  policy, untouched).
- **Blocking gate:** [#91](https://github.com/AIClarityAU/minspec/issues/91) (reach
  validation) — re-check its status before this spec is ever advanced past Specify.
- **Adjacent, not absorbed:** [#88](https://github.com/AIClarityAU/minspec/issues/88)
  (consequence analyzers), [#89](https://github.com/AIClarityAU/minspec/issues/89)
  (risk→phase catalog), [#86](https://github.com/AIClarityAU/minspec/issues/86)
  (positioning, held), [#54](https://github.com/AIClarityAU/minspec/issues/54) (DR-014
  clause-2 engine relocation).
- **Specs this touches when eventually built:** [SPEC-004](../SPEC-004-classifier-validation/requirements.md)
  (re-run to confirm byte-identical tier output, FR-5), [SPEC-023](../SPEC-023-consequence-screen/requirements.md)
  (the eventual consumer of `RiskProfile.signals`), [SPEC-013](../SPEC-013-risk-section-policy/requirements.md)
  (explicitly not re-scoped by this spec — stays DR-020-governed).
- **DR for this spec:** none. DR-024 already made the one decision this spec needed
  (the contract *direction*); this document specifies its *shape and sequencing*, which
  is implementation detail the ADR filter (reversible in under a day — it is an
  additive type with no consumer behavior change, FR-2/FR-5) does not require a new
  record for.
