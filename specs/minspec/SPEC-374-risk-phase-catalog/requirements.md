---
id: SPEC-374
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology
aspects: [risk-profile, ceremony, consequence-screen, catalog, tier-0, upward-only-ratchet]
relates_to: ["#89", "#88", "#90", "#91", DR-022, DR-024, DR-021, DR-020, SPEC-023, SPEC-013, SPEC-004]
implements: none
implements_reason: >-
  Specified, not built. No design.md/tasks.md exist. The catalog is gated on reach
  validation (#91) per DR-024, and the questions under "Decisions needed (Clarify)" are
  unanswered.
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-374: Risk→phase catalog — map tripped consequence risks to required ceremony (Requirements)

> **SPECIFICATION ONLY.** The dispatch that wrote this built nothing. A human reads it,
> answers *Decisions needed (Clarify)*, and approves it before anything is built. Approving
> the spec does **not** lift the [DR-024](../../../docs/decisions/DR-024.md) gate:
> **enforcing** this catalog still waits for reach validation ([#91](https://github.com/AIClarityAU/minspec/issues/91)).
> See DQ-1.

**Triggered by:** [#89](https://github.com/AIClarityAU/minspec/issues/89): "risk→phase catalog
— map tripped risks to required phases (the load-bearing design surface)".
**Decision:** [DR-022](../../../docs/decisions/DR-022.md) §2 (risk profile → required phases).
DR-022 is `superseded`. Its operative part, the Fork B contract direction, lives in
[DR-024](../../../docs/decisions/DR-024.md), which also lists **the catalog (#89) among the
items gated on #91** (DR-024 Decision point 2).
**Epic:** [EPIC-003 SDD Core Methodology](../../../docs/epics/EPIC-003-sdd-core.md)
**Input contract:** [SPEC-023](../SPEC-023-consequence-screen/requirements.md), the consequence
screen (#88). Its signals are this catalog's only input.

## One-sentence scope

Define a small (at most 5 risks), closed, Tier-0 catalog that turns the consequence signals
SPEC-023's analyzers already emit into a deterministic set of extra ceremony obligations
(threat model, migration + rollback, contract + consumer review, and so on). The obligations
are the union over tripped risks and are only ever **added** on top of what the tier already
requires.

## Reality-check (premises in #89 checked against the code)

1. **"Depends on the consequence screen's output shape (#SCREEN)."** `#SCREEN` is an
   unsubstituted placeholder. The screen is #88 / SPEC-023 (`status: implementing`). Its
   output shape exists in code: `ClassificationSignal[]` carrying `axis: 'consequence'`,
   produced by `runConsequenceAnalyzers` (`packages/minspec/src/lib/consequence-analyzers.ts:571`)
   and already wired into the classify command (`packages/minspec/src/commands/classify.ts:93-94`).
   So the dependency is **met for shape**. It is not met for *validation*: #91 is still open.
2. **The phases #89 names do not exist.** The phase vocabulary is closed:
   `type Phase = 'specify' | 'clarify' | 'plan' | 'tasks' | 'implement'`
   (`packages/minspec/src/lib/config.ts:8`, duplicated at `packages/shared/src/next-task.ts:57`).
   "Threat-model", "migration+rollback" and "contract+consumer review" are not phases. Both
   that type and the `phaseMappings` consumers (`classifier.ts:140`, `spec-catalog.ts:23`,
   `spec-progress.ts:82`, `spec-manager.ts:304,454`, `scaffold.ts`, the frontmatter validator)
   key off it. Whether the catalog adds new phases or something lighter is the central open
   question. See **DQ-2**.
3. **The signal vocabulary is concrete and small.** In v1 the analyzers emit exactly ten
   signal names (`consequence-analyzers.ts`): `reach_unavailable`, `manifest_changed`,
   `public_api_removed`, `public_api_changed`, `public_api_added`, `irreversible_deletion`,
   `irreversible_migration`, `destructive_schema_op`, `sensitive_sink`, `concurrency`.
   The catalog keys off these names. It does not key off DR-022's prose categories.
4. **There is no risk-profile container yet.** The `RiskProfile` type (#90) is specified
   only on the unmerged branch `agent/issue-90`. That branch reuses the id **SPEC-097**,
   which `specs/minspec/SPEC-097-watcher-config-source/` already holds on main (a
   collision for #90 to resolve, not this spec). So this spec takes
   `ClassificationSignal[]` as input and does **not** depend on `RiskProfile` (FR-1). When
   #90 adds `RiskProfile.signals`, it feeds the same function.

## Context

DR-022 §2: "The screen emits a risk profile (tripped signals + severities). A catalog maps
each risk to the phase(s) it demands … Required ceremony = the union. A consequence-heavy
*but tiny* change can require a threat model **without** a full task breakdown, which the
T1–T4 ladder structurally cannot express." DR-022 R2 rates the catalog's ballooning risk
*High · Med*. The mitigation it gives is "v1 catalog ≤5 risks; … scoped to its own bounded
spec (#89)". This is that spec.

Today SPEC-023's signals affect only the **tier**: `classify()` takes the maximum
`tierContribution`, and the tier picks the phase set from `phaseMappings`. The tier is a
coarse proxy. A `sensitive_sink` hit (`tierContribution: 'T3'`) adds `tasks` and `implement`
phases that do nothing about the actual risk, and it adds no threat-model obligation. The
catalog is the missing link from *what tripped* to *what that trip demands*.

## Functional Requirements

- **FR-1: Pure catalog function, Tier-0.** Provide a pure function
  `requiredObligations(signals: readonly ClassificationSignal[]): ObligationSet`. It considers
  only signals with `axis === 'consequence'` and ignores all others. It imports no `vscode`,
  makes no network, disk or AI call, and is deterministic: the same multiset of signals in
  any order yields a byte-identical result, with obligations sorted by catalog order.
- **FR-2: v1 catalog: at most 5 risk entries, closed.** The catalog is one static table.
  Each entry is `{ riskKey, tripsOn: signalName[], obligation, landsIn: Phase, rationale }`.
  The proposed v1 content is below. DQ-3 owns the final mapping.

  | # | riskKey | Trips on (SPEC-023 signal names) | Obligation demanded | Lands in phase |
  |---|---|---|---|---|
  | 1 | `public-api-break` | `public_api_removed`, `public_api_changed`, `manifest_changed` | **Contract + consumer review.** Name the changed contract and every known consumer, and state the compatibility or versioning stance. | `plan` |
  | 2 | `irreversible` | `irreversible_deletion`, `irreversible_migration`, `destructive_schema_op` | **Migration + rollback.** State the forward migration, the undo mechanism, and the answer to the DR-359 ADR filter (can this be undone in under a day?). | `plan` |
  | 3 | `sensitive-sink` | `sensitive_sink` | **Threat model.** Name the assets touched, the trust boundary crossed, and at least one abuse case with its mitigation. | `plan` |
  | 4 | `concurrency` | `concurrency` | **Interleaving / failure-modes analysis.** Name the shared state, the possible orderings, and the failure under each. | `plan` |
  | 5 | `impact-reach` | *(none in v1)* | **Reserved.** No signal trips it until the #91-gated reference index emits a real reach signal. | n/a |

  `public_api_added` and `reach_unavailable` are deliberately mapped to **no obligation**
  (see FR-4). Growing the table beyond 5 entries is a deliberate edit to this spec, not
  configuration drift (DR-022 R2, same discipline as SPEC-023 C4).
- **FR-3: Union, upward-only.** The required ceremony for a change is the tier's
  `phaseMappings[tier].requiredPhases` **plus** the union of the obligations from FR-2. The
  catalog never removes a phase or an obligation the tier already requires, and never lowers
  the tier. This keeps DR-021's upward-only ratchet and SPEC-023 INV-3. Two signals tripping
  the same risk yield **one** obligation, not two.
- **FR-4: Every emitted signal name has an explicit disposition.** Each signal name a
  consequence analyzer can emit is listed exactly once: either in some entry's `tripsOn`, or
  in an explicit `noObligation` list with a one-line reason. In v1 that list is
  `public_api_added` (additive, non-breaking) and `reach_unavailable` (a degrade marker, not a
  trip; mapping it would put an obligation on every change). A consequence signal whose name
  is in **neither** list must not be silently dropped. The result reports it as
  `unmapped: [name, …]`, and the coverage test in AC-5 fails the build. This applies
  *enforce, don't trust* to the "remember to update the catalog when you add an analyzer"
  step.
- **FR-5: Obligations are scoped to what tripped.** Each obligation in the result carries the
  `explain` strings of the signals that tripped it (for example, "public manifest
  package.json changed"). The prompt is then specific ("touches auth in `src/login.ts`: state
  the threat model") rather than a blank page (DR-022 §3). Explains are de-duplicated and
  kept in input order.
- **FR-6: Degrade is visible.** If any tripping signal carries `degraded: true`, the
  obligation still trips (inclusion-biased: over-requiring is the safe failure) and is
  marked `degraded: true`, with the degraded signals' explains attached. A degraded trip
  must never render as a clean result, and a missing input must never render as "no
  obligations" (SPEC-023 INV-4; constitution invariant 2, no silent gate).
- **FR-7: Clean is "structurally clear", not "safe".** When no obligation trips, the result
  says *structurally clear*, never *safe* or *no risk* (DR-022 §3 / R3). Difficulty and
  semantic risk are outside this catalog (DR-021).
- **FR-8: Gate mode follows DR-024.** The catalog has two modes, and only one of them is
  allowed before #91 clears:
  - **advisory**: the result is computed and shown alongside the classify output
    ("this change also calls for: threat model"). It does not add a required phase, does
    not block approval, and is not labelled "required".
  - **enforcing**: obligations become required. Spec progress counts them as missing until
    satisfied, and the frontmatter validator reports an unsatisfied one.

  Until #91 clears, only **advisory** may ship. Turning on **enforcing** needs #91 to clear
  **and** DR-022 §2 to be re-accepted. DQ-1 decides whether advisory ships before #91 at all.
- **FR-9: Satisfaction is structural.** The way an obligation is satisfied depends on DQ-2.
  Under the recommended option it is a required section, checked by SPEC-013's single
  `hasSection(artifact, heading)` predicate (SPEC-013 FR-2): no second predicate, presence
  and shape only, never a quality judgement (SPEC-013 R4). That predicate is **not built**:
  SPEC-013 is `implements: none`, and the `hasSection` that does exist
  (`packages/minspec/src/lib/spec-validator.ts:222`) is a different, narrower predicate over
  mockup/API/acceptance-criteria names. Under DQ-2(a), enforcing mode (FR-8) therefore cannot
  ship until SPEC-013 FR-2 is built. Advisory mode does not depend on it, because advisory
  checks no satisfaction.

## Acceptance Criteria

- **AC-1: Purity.** The catalog module imports no `vscode`, `simple-git`, `fs` or network
  module. A static-import test asserts this. *(FR-1, INV-1)*
- **AC-2: Order independence.** For a fixed set of signals, every permutation produces a
  deep-equal `ObligationSet`, with obligations in catalog order. *(FR-1)*
- **AC-3: Each v1 risk trips independently.** A fixture carrying only `sensitive_sink`
  yields exactly {threat model}. Only `destructive_schema_op` yields exactly
  {migration + rollback}. Only `public_api_removed` yields exactly
  {contract + consumer review}. Only `concurrency` yields exactly {interleaving analysis}.
  *(FR-2)*
- **AC-4: Union de-duplicates.** `irreversible_deletion` + `irreversible_migration` +
  `destructive_schema_op` together yield **one** migration + rollback obligation carrying
  all three explains. `sensitive_sink` + `public_api_changed` yield exactly two obligations.
  *(FR-3, FR-5)*
- **AC-5: Disposition coverage.** A test collects every signal name the consequence
  analyzers can emit: the `name` of each `ClassificationSignal` they push, or an exported
  list of those names. It does **not** grep every literal `name:` in
  `consequence-analyzers.ts`, because the pattern tables there (`SENSITIVE_REGEXES`,
  `CONCURRENCY_PATTERNS`, lines 437-513) also use `name:` for pattern labels such as
  `'Promise.all'` and `'timer'`, which are not signal names. The test fails if any signal
  name is absent from both the catalog's `tripsOn` lists and its `noObligation` list, or
  appears in both. Mutation control: deleting `concurrency`
  from the table makes the test fail. *(FR-4)*
- **AC-6: An unknown name is reported, not dropped.** A consequence signal named
  `future_signal_x` appears in `unmapped` and the result is not *structurally clear*.
  *(FR-4, INV-3)*
- **AC-7: The degrade marker trips nothing.** A signal set containing only
  `reach_unavailable` (`degraded: true`) yields zero obligations and is reported
  *structurally clear*, with a note that the reach analyzer is degraded. It is not
  reported *clean*. *(FR-4, FR-6, FR-7)*
- **AC-8: A degraded trip stays visible.** A degraded `public_api_removed` (old content
  absent) still yields contract + consumer review, marked `degraded: true`. *(FR-6)*
- **AC-9: Upward-only property.** For any tier `t` and any signal set, the required phase
  set of the result is a superset of `phaseMappings[t].requiredPhases`, and the tier from
  `classify()` is unchanged by the catalog. Checked as a property test. *(FR-3, INV-2)*
- **AC-10: Advisory never gates.** In advisory mode, with every risk tripped, approval,
  spec progress and the frontmatter validator all behave exactly as they do with the
  catalog absent. A snapshot test compares the two. *(FR-8)*
- **AC-11: Size cap.** A test asserts the catalog table has at most 5 entries. *(FR-2,
  DR-022 R2)*

## Invariants (must not break)

- **INV-1: Tier-0, offline.** Constitution invariant 1. The catalog is pure data plus a pure
  function. No AI pass feeds it in v1. The opt-in difficulty layer (DR-021) is out of scope.
- **INV-2: Upward-only ratchet.** The catalog only adds ceremony. It never lowers a tier,
  removes a tier-required phase, or marks a tripped risk satisfied on its own.
- **INV-3: No silent gate.** Constitution invariant 2. Unmapped names, degraded trips and
  missing input are all visible. In enforcing mode, an obligation the validator cannot
  evaluate fails closed. It never passes.
- **INV-4: `classify()` stays pure and unchanged.** The catalog runs *after* `classify()`
  on the same signal array. `classify()`'s contract and T0 suite pass verbatim (SPEC-023
  INV-2).
- **INV-5: Blast radius.** Constitution invariant 3. The catalog's effect is limited to the
  artifacts of a repo that has `.minspec/`.
- **INV-6: DR-024 gate.** No enforcing behaviour reaches users before #91 clears (FR-8).

## Decisions needed (Clarify)

### DQ-1: Ship advisory mode before #91, or hold the whole catalog behind #91?

DR-024 Decision point 2 puts "the risk→phase catalog (#89)" behind #91. The four graph-free
analyzers that feed it are already **on** (SPEC-023 C3). Their safety argument is the
upward-only ratchet, which this catalog keeps.

- **(a) Advisory now, enforcing after #91 (rec).** Build FR-1 to FR-8 with only advisory
  mode reachable. This gets real-world data on how often each obligation trips, which #91
  can use. *Cost:* DR-024 listed the catalog as gated without distinguishing modes, so this
  reads DR-024 as "do not *enforce* before #91". A human must confirm that reading. Advisory
  hints can also train people to ignore them before enforcement arrives.
- **(b) Hold everything until #91.** Approve this spec and do not plan or build it.
  *Cost:* #91 then has no trip-frequency data, and the catalog's design gets no field
  contact until after validation.

**Recorded selection: (a), advisory now,** build advisory mode now and enforce only after #91.
Source: the answer to task-queue item cq374, 2026-11-24 ("1 Advisory now (Recommended) = build
advisory mode now, enforce only after #91"), an answer the queue attributes to the founder. A
queue answer is not consent (DR-108 section 4), so this selection is unverified. Option (a) needs
a human to confirm the DR-024 reading ("do not *enforce* before #91"), so it binds only if the
founder approves this spec's text with it in place. A delegated approval does not supply that
confirmation, and until the founder approves, the reading stays unconfirmed.

### DQ-2: What is an "obligation": a new lifecycle phase, or a required section?

- **(a) A required section inside an existing phase, via SPEC-013's section registry
  (rec).** Each obligation is a registry entry, `{ heading, appliesTo: on-trip, shape }`,
  satisfied by SPEC-013's single `hasSection` predicate in the phase artifact named by
  `landsIn` (in v1, `design.md`, the plan phase). SPEC-013's registry already has "Rollback
  / Reversibility" and "Dependencies & Blast-Radius" (both `minTier: T4`), so a trip
  effectively lowers their tier floor. "Threat Model" and an interleaving section would be
  new registry entries. This is DR-022 §3's "Risks section scoped to what tripped". *Cost:*
  the check is structural only, so an obligation can be met with thin prose. It also couples
  this spec to SPEC-013, which itself waits on DR-022 acceptance to re-scope.
- **(b) New `Phase` values** (`threat-model`, `migration`, `contract-review`). This matches
  #89's wording and gives each obligation its own artifact. *Cost:* it widens a closed union
  declared in two packages (`packages/minspec/src/lib/config.ts:8`, `packages/shared/src/next-task.ts:57`) and touches every
  `phaseMappings` consumer, the lifecycle state machine and the sidebar. That is a contract
  change of the kind the DR-359 ADR filter flags, and it would need its own DR.

**Recorded selection: the recommended option,** (a), an obligation is a required section inside an existing phase, via SPEC-013's section registry. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-22; sign-off ratifies it.

### DQ-3: Confirm the v1 mapping in FR-2.

The judgement calls, each with the recommended option first:

- `manifest_changed` trips **contract + consumer review** **(rec)**. *Cost:* every
  `package.json` dependency bump asks for a consumer review, which is noisy. The
  alternative is to map it to `noObligation` and accept that a removed `exports`/`bin`
  entry goes unflagged.
- `concurrency` is a catalog entry **(rec)**. *Cost:* SPEC-023's concurrency regex
  (`setTimeout`, `Promise.all`) is broad, so this is the noisiest trip. The alternative is
  to drop it to `noObligation` in v1 and leave entry 4 reserved.
- Every obligation lands in `plan` **(rec)**, because that is where design reasoning lives.
  *Cost:* a T1 change has no plan phase. A trip on a T1 therefore implicitly *adds* the
  plan phase, which is exactly the "tiny but consequential" case DR-022 §2 wants to express,
  but it is still a heavier result than "add one section to the spec". The alternative is
  to land T1/T2 obligations in `specify`.

**Recorded selection: the recommended option,** the FR-2 v1 mapping as written, with each judgement call's recommended option: `manifest_changed` trips contract + consumer review, `concurrency` is a catalog entry, and every obligation lands in `plan`. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-22; sign-off ratifies it.

## Out of scope

- The analyzers themselves (SPEC-023 / #88), and the real reach index (#195, gated on #91).
- The `RiskProfile` container and frontmatter migration (#90). FR-1's input is chosen so this
  spec does not depend on it.
- Reach validation and its acceptance thresholds (#91).
- Re-scoping SPEC-013 to screen-gated risks sections (needs DR-022 to be re-accepted).
- The opt-in semantic / difficulty layer (DR-021).
- Positioning changes (#86).
- User-configurable catalog entries in `.minspec/config.json`. v1 is a closed table, and an
  override surface is a later decision.

## Alternatives considered

- **Key the catalog on tier, not signals.** Rejected: that is the T1–T4 ladder DR-022 §2
  exists to escape. It cannot express "tiny but needs a threat model".
- **Key on DR-022's prose categories, with a free-text risk taxonomy.** Rejected: there is
  no producer for those categories. The ten SPEC-023 signal names are the real vocabulary,
  and keying on them makes coverage mechanically checkable (FR-4 / AC-5).
- **Map `reach_unavailable` to a generic "review blast radius" obligation.** Rejected: it
  fires on every change. That is the DR-020 R1 rubber stamp, an obligation nobody reads.
- **Wait for #90's `RiskProfile` and take it as input.** Rejected: it is unmerged and has an
  id collision. `ClassificationSignal[]` is what `RiskProfile.signals` would carry anyway.
- **Mint a DR for this spec now.** Not done. The one hard-to-reverse choice here is DQ-2(b),
  new `Phase` values, and it is put to the human rather than decided. If DQ-2 resolves to
  (b), a DR is required before Plan. Under (a) the catalog is a code table that can be
  reverted in under a day.

## Risks & Mitigations

| # | Risk | Likelihood · Impact | Mitigation |
|---|---|---|---|
| R1 | The catalog grows past 5 entries (DR-022 R2). | High · Med | AC-11 caps it, and growth requires editing this spec. |
| R2 | Noisy trips (`concurrency`, `manifest_changed`) turn obligations into rubber stamps. | High · Med | Advisory mode first (DQ-1a) measures trip rates before enforcement. DQ-3 offers dropping either entry. |
| R3 | A new analyzer signal is added without a catalog disposition and its risk goes unasked. | Med · High | FR-4 `unmapped` reporting plus the AC-5 coverage test with a mutation control. |
| R4 | Advisory output is read as a required gate, or enforcement ships before #91. | Med · High | FR-8 wording rule ("not labelled required"), the AC-10 snapshot, and INV-6. |
| R5 | A degraded input reads as clean. | Med · High | FR-6 / FR-7 and AC-7 / AC-8. |

## Follow-ups (tracked)

- Reach validation: [#91](https://github.com/AIClarityAU/minspec/issues/91). It gates
  enforcing mode and entry 5.
- Real reach signal for entry 5: [#195](https://github.com/AIClarityAU/minspec/issues/195).
- `RiskProfile.signals` as a second caller of FR-1:
  [#90](https://github.com/AIClarityAU/minspec/issues/90). The SPEC-097 id collision on
  branch `agent/issue-90` belongs to #90.
- A DR on new `Phase` values: only if DQ-2 resolves to (b). Otherwise none.
- SPEC-013 FR-2's shared `hasSection` predicate:
  [SPEC-013](../SPEC-013-risk-section-policy/requirements.md). Under DQ-2(a) it blocks
  enforcing mode (FR-9).
