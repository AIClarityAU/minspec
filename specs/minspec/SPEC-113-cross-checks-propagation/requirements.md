---
id: SPEC-113
type: requirements
status: specifying
tier: T4  # cross-package contract (packages/shared + packages/minspec), a new sidecar store, 3 consumer surfaces + their tests — comparable shape to SPEC-012/SPEC-013 (both T4)
product: minspec
epic: EPIC-003  # SDD Core Methodology — materializes a DR-029 follow-up; also touches EPIC-002 (Signpost Integrity) surfaces, named in relates_to
depends_on: [DR-029, SPEC-013, DR-012, SPEC-022, SPEC-012, SPEC-015]
relates_to: [SPEC-010, SPEC-029, "#131"]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# Cross-Checks Phase Propagation — Lifecycle Lanes, Classifier, Signpost

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks its Clarify questions, and approves it through the normal spec-approval
> gate before any code changes. Each question carries an agent-recorded selection under
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**; the human answers by
> approving this spec with those in place, or by changing them first. Requirements below
> are written under each decision's recommended option, so approving the spec as it stands
> accepts those recommendations and leaves no question open.

Materializes **[#131](https://github.com/AIClarityAU/minspec/issues/131)**, itself the
literal text of [DR-029](../../../docs/decisions/DR-029.md)'s own
**Methodology Fit deviation #5** ("new `cross-checks` phase not propagated to SPEC-015
lanes + classifier + signpost = inconsistent") and [SPEC-013](../SPEC-013-risk-section-policy/requirements.md)'s
**Dependencies & Blast-Radius** entry ("SPEC-015 lanes + classifier + signpost (FR-13) — the
new `cross-checks` phase must propagate to all three; a miss strands T3/T4 specs
mid-lifecycle") and its **Follow-ups** entry of the same name.

## One-Sentence Scope

Give the T3/T4-only `core-signoff → cross-checks → final-approve` lifecycle
([DR-029](../../../docs/decisions/DR-029.md) §4, [SPEC-013](../SPEC-013-risk-section-policy/requirements.md)
FR-13) a visible lane in the SPECS pane, a tier predicate the classifier exposes, and a
signpost next-task node — as an **additive, orthogonal** axis that touches none of the
three surfaces' existing contracts.

## Context — what exists today (read from the worktree, not inferred)

**What SPEC-013 owns and has not built.** DR-029 §4 and SPEC-013 FR-13 define the
lifecycle (`specify → core-signoff → cross-checks → final-approve → done`, T3/T4 only) and
FR-8/FR-10 define `coreHash` conceptually (a hash over Zone-A bytes, up to a
`<!-- minspec:core-end -->` divider). None of it exists in code: `core-end`, `coreHash`,
`SECTION_REGISTRY` return zero hits across `packages/shared/src` and `packages/minspec/src`
(confirmed by `grep`; SPEC-013's own `implements_reason` says the same). **This spec does
not build or redefine that mechanism** — it defines how the three *consumer* surfaces named
in the issue represent the lifecycle once SPEC-013 ships it, and the one piece of plumbing
(the sign-off sidecar) that is this spec's own, by the same split DR-012/SPEC-022 already
use (DR-012 owns *what* `specHash` means; SPEC-022 owns *where* the approval record lives
and who may write it).

**The precedent this spec reuses, not invents, three times over:**

1. **An orthogonal, additive sidecar store — SPEC-022/DR-034.** `.minspec/approvals/<repo-
   relative-path>.json` (`packages/minspec/src/lib/approval-store.ts:1-24`), one committed
   file per spec, attributed via `git config user.email` captured offline and refused for a
   non-human identity (DR-056). `ApprovalRecord` (`packages/minspec/src/lib/approval.ts:61-70`)
   is `{ specPath, specHash, approvedAt, approvedBy, tier, migrated, baselineBlob }`.
2. **An orthogonal, additive tree-view group — SPEC-029.** The "Needs Re-Approval" group
   (`packages/minspec/src/views/spec-tree-provider.ts:453-475`) is pinned into
   `rootChildren` (`:420-429`) **alongside**, not inside, `STATUS_GROUPS` — its own
   comment names this "INV — Orthogonal axes — no `SpecStatus` value is added, `STATUS_GROUPS`
   is untouched" (`:454-456`). It is non-empty-only (`:468`) and excludes terminal specs
   (`:465-466`, `:457-462`).
3. **An orthogonal, additive node field and node kind — SPEC-012.** `SpecNode`
   (`packages/shared/src/next-task.ts:85-124`) already carries `tier`, `approvalState`,
   `implementHole`, `hasUnresolvedOpenQuestions` and `literalStatusTerminal` as optional
   fields computed by the fs-adapter (`artifact-graph.ts`) and only *consumed* in
   `next-task.ts` — the same comment names the Tier-0 boundary each field respects
   (`:101-107`, `:108-124`). `NodeKind` (`:169`) is a five-member closed union
   (`'epic-promote' | 'spec-approve' | 'adr-accept' | 'phase-action' | 'answer-OQ'`); its own
   comment states the Two-Queues rule by name (`:166-168`): a node that is authoring work,
   not an approval, is **forbidden** from rendering with an Approve control.

**What the issue's four bullets map onto, concretely:**

- "SPEC-015 lifecycle lanes" — `STATUS_GROUPS` (`spec-tree-provider.ts:36-48`) is a **total,
  disjoint** partition of the `SpecStatus` enum (SPEC-015 INV-1/INV-2, still enforced by its
  own T0 test). `cross-checks` state is not a `SpecStatus` value and must not become one — a
  T3/T4 spec mid-cross-checks is still, correctly, `specifying` or `planning` by every
  existing rule; the gap is that nothing *shows* it is mid-cross-checks rather than merely
  unapproved.
- "Classifier — core-signoff is the T3/T4 trigger... reflect the phase in tier→phase
  routing" — `phaseMappings` (`packages/minspec/src/lib/config.ts:16-20`, `:134-137`) maps
  each `Tier` to its required/optional members of the five-value `Phase` union
  (`config.ts:8`, `:11`): `specify | clarify | plan | tasks | implement`. Core-signoff /
  cross-checks / final-approve are not phase-ladder steps in that sense (DR-029 §4 never
  calls them a `Phase`); "reflect... in tier→phase routing" is read here as *a tier
  predicate next to `phaseMappings`*, not a sixth `Phase` value (see DQ-1).
- "Signpost / next-task — surface 'cross-checks pending' as a next HUMAN/LLM step" —
  `next-task.ts`'s `NodeKind` and `SpecNode` (above). The human/LLM split in that phrase is
  exactly SPEC-012's existing Two-Queues invariant: the human core-signoff act is a next-task
  candidate; the LLM's authoring of the appendix is not (`next-task.ts:166-168`).
- "`coreHash` companion to the DR-012 `specHash`" — a sidecar, shaped like
  `approval-store.ts`'s, that records the human core-signoff act. What bytes `coreHash`
  covers is SPEC-013's to define (FR-8/FR-10); this spec defines where the signed-off value
  is stored and who may write it.

## Functional Requirements

- **FR-1 (a new orthogonal status, not a new `Phase` or `SpecStatus` value).**
  `packages/shared/src` gains a pure type, e.g. `CrossChecksStatus`:
  `'none' | 'awaiting-core-signoff' | 'awaiting-cross-checks' | 'awaiting-final-approve' |
  'done'`. `'none'` for every T1/T2 spec, always (FR-6). For T3/T4: `'awaiting-core-signoff'`
  while no fresh coreHash sign-off record exists for the spec's current Zone-A bytes;
  `'awaiting-cross-checks'` once core-signoff is fresh but SPEC-013's floor has not cleared
  Zone B; `'awaiting-final-approve'` once the floor is clean but DR-012's `specHash`
  approval is missing/stale; `'done'` once both are fresh. A pure function of frontmatter +
  the two sidecars (FR-2, DR-012's existing `approval-store.ts`) — DR-019/DR-004 determinism,
  no AI, no network, mirroring `deriveStatus`'s own "one place, total function" shape
  (`packages/minspec/src/lib/lifecycle.ts`).
- **FR-2 (coreHash sidecar — storage + attribution only, mirrors SPEC-022's split from
  DR-012).** A new store, shaped exactly like `approval-store.ts`:
  `.minspec/core-signoffs/<repo-relative-path>.json`, one committed file per spec, holding
  `{ specPath, coreHash, signedOffAt, signedOffBy, tier }`. `signedOffBy` is captured and
  gated the same way `approvedBy` already is (DR-056: refuse a bot/agent identity). This FR
  defines the record's **shape and write-path gate only** — what bytes feed `coreHash` is
  SPEC-013 FR-8/FR-10's definition, consumed, not redefined, here (DQ-3).
- **FR-3 (SPEC-015 surface — an additive group, not a sixth lane).** `STATUS_GROUPS`
  (`spec-tree-provider.ts:36-48`) is unchanged — no new entry, no `SpecStatus` value. A new
  cross-cutting group, built the same way as `getNeedsReapprovalGroup`
  (`spec-tree-provider.ts:464-475`) and pinned into `rootChildren` the same way
  (`:420-429`), renders every non-terminal T3/T4 spec whose `CrossChecksStatus` (FR-1) is
  `awaiting-core-signoff` or `awaiting-cross-checks`. Non-empty-only (mirrors `:468`);
  excludes terminal specs (mirrors `:457-462`, `:465-466`); renders regardless of
  epic-grouping mode (mirrors `:415-418`).
- **FR-4 (classifier tier predicate, not a `Phase` member).** `packages/minspec/src/lib/
  config.ts` gains a pure predicate next to `phaseMappings` (`:134-137`), e.g.
  `requiresCrossChecks(tier: Tier): boolean`, true for `T3`/`T4`, false for `T1`/`T2` — the
  single place every consumer (FR-3's group, FR-5's node, the eventual core-signoff command)
  asks "does this tier even have this lifecycle." The `Phase` union (`config.ts:8`) and
  `PHASES` array (`:11`) are **not** extended with `core-signoff` / `cross-checks` /
  `final-approve` (DQ-1).
- **FR-5 (signpost node — human act only, never the LLM-authoring step).** `next-task.ts`
  gains one `NodeKind` member, `'core-signoff'`, alongside the existing five (`:169`), and
  `SpecNode` (`:85-124`) gains an optional `crossChecksState?: CrossChecksStatus` field,
  computed by the fs-adapter (`artifact-graph.ts`) exactly as `implementHole` and
  `hasUnresolvedOpenQuestions` already are (`:101-107`, `:108-124`) — consumed in
  `next-task.ts`, computed nowhere near it (INV Tier-0, SPEC-012's existing boundary). A
  T3/T4 spec with `crossChecksState === 'awaiting-core-signoff'` produces exactly one
  `core-signoff` next-task node, severity `blocked-ready` (SPEC-012 FR-2.2), imperative
  "Core-sign-off SPEC-NNN". A spec in `'awaiting-cross-checks'` produces **no** next-task
  node of its own (the pending step is the LLM's, forbidden from the human queue by
  `next-task.ts:166-168`'s own rule) — its visibility is FR-3's group row, not the signpost
  (DQ-2). A spec in `'awaiting-final-approve'` continues to produce the existing
  `spec-approve` node, unchanged (FR-6 below).
- **FR-6 (final-approve stays the sole blocking gate — resolved, not reopened).** Per
  DR-029 §4 ("No deterministic layer blocks final-approve... the reality-check verdict is
  pure advisory"), `CrossChecksStatus` is never a precondition the `spec-approve` node or
  the DR-012 gate itself checks. A human can final-approve a T3/T4 spec whose
  `CrossChecksStatus` is anything short of `'done'`; this spec adds *visibility*, never a
  second block. This FR exists so Plan does not reopen DR-029's own resolved question.
- **FR-7 (tier boundary — zero new surface area below T3).** `requiresCrossChecks('T1'|'T2')`
  is `false` (FR-4); `CrossChecksStatus` for a T1/T2 spec is always `'none'` (FR-1); such a
  spec never enters FR-3's group and never produces an FR-5 node. Mirrors SPEC-013 FR-13
  ("T1/T2 have no core-signoff, no cross-checks phase, no second approval") and DR-012's
  existing tier gate.
- **FR-8 (honest degradation until SPEC-013 ships).** `'awaiting-cross-checks'` and
  `'awaiting-final-approve'` are only distinguishable once SPEC-013 ships the Zone-A/Zone-B
  divider and its floor verdict. Until then, FR-1's deriver MUST NOT fabricate that
  distinction: a T3/T4 spec with a fresh core-signoff and no DR-012 approval degrades to a
  single `'awaiting-cross-checks'` reading (the floor is assumed clean because it cannot yet
  be read) rather than a confidently-wrong `'awaiting-final-approve'` — mirrors SPEC-010
  FR-6 / SPEC-012 FR-10's existing "say unclear, never guess" pattern. This is what makes
  this spec buildable without waiting on SPEC-013 (DQ-4).

## Acceptance Criteria

- [ ] (FR-1) A T0 fixture suite in `packages/shared/tests` drives every
      `(tier, coreHash-sidecar state, floor state, specHash state)` combination through the
      `CrossChecksStatus` deriver and asserts the expected value, including the FR-8
      degrade case.
- [ ] (FR-1, FR-7) A T1/T2 fixture of any sidecar/approval state always derives `'none'`.
- [ ] (FR-2) The sidecar is written only for a human identity (a fixture asserting a bot/
      agent `signedOffBy` is refused, mirroring the existing `approval-store.ts` /
      `approval.ts` DR-056 fixture) and is a single committed file keyed by the spec's
      repo-relative path.
- [ ] (FR-3) A fixture with one T3/T4 spec in `'awaiting-core-signoff'`, one in
      `'awaiting-cross-checks'`, one `'done'`, and one terminal (`archived`) T3/T4 spec in
      `'awaiting-core-signoff'` yields a "Cross-Checks Pending" group containing exactly the
      first two; the group is absent when no spec qualifies; `STATUS_GROUPS` and its
      existing INV-1/INV-2 tests are unchanged.
- [ ] (FR-4, FR-7) `requiresCrossChecks('T3')` and `('T4')` are `true`; `('T1')` and `('T2')`
      are `false`; `Phase`/`PHASES` are unchanged (a test asserts their length/members are
      unchanged from today).
- [ ] (FR-5) A `core-signoff`-state fixture produces exactly one `core-signoff` node, severity
      `blocked-ready`; an `awaiting-cross-checks` fixture produces zero next-task nodes for
      that spec; a dispatch/agent-queue fixture still produces zero nodes (SPEC-012's
      existing Two-Queues test, unregressed).
- [ ] (FR-6) A fixture T3/T4 spec with `CrossChecksStatus !== 'done'` still passes the DR-012
      approval path unchanged — no new refusal, no new precondition.
- [ ] (FR-8) A fixture with a fresh core-signoff, no SPEC-013 floor verdict available, and no
      `specHash` approval derives `'awaiting-cross-checks'`, never `'awaiting-final-approve'`.

## Invariants (must not break)

- **INV-1 (tier gating).** No new surface — group row, node kind, predicate value — is ever
  produced for T1/T2 (FR-7; constitution ceremony-proportional-to-complexity; DR-012).
- **INV-2 (no new blocking gate).** `specHash`/DR-012 remains the sole blocking gate; this
  spec's additions are advisory/visibility-only everywhere (FR-6; DR-029 §4).
- **INV-3 (Two Queues, SPEC-012).** The LLM-authoring step of cross-checks never appears as
  a human next-task node (`next-task.ts:166-168`); only the human core-signoff act does (FR-5).
- **INV-4 (determinism, Tier-0, DR-004/DR-019).** `CrossChecksStatus`, the new group and the
  new node kind are pure functions of frontmatter + the two sidecars; no AI, no network is
  reachable from any of the three paths.
- **INV-5 (one engine, every surface, SPEC-012 FR-11's own rule extended).** `CrossChecksStatus`
  is computed once, in `packages/shared`; the SPEC-015 group, the classifier predicate's
  callers and the signpost node all read the same value — never three independent
  re-derivations that could disagree (the exact failure DR-029's Methodology Fit #5 warns
  against: each surface finding out about the phase differently, or not at all).
- **INV-6 (`SpecStatus`/`STATUS_GROUPS`/`Phase`/`PHASES` untouched).** This spec adds no
  enum value and no union member to any of the four (DQ-1, DQ-2); SPEC-015's own INV-1/INV-2
  totality tests and `lifecycle.ts`'s phase-ladder contract are unaffected.

## Decisions needed (Clarify)

Each decision below carries a recommendation and its cost (CLAUDE.md "decisions need rec +
cost"). The requirements above are written under the recommended option in every case; this
repository runs with `"autonomy": "act"` (`.minspec/config.json`), under which a dispatch
proceeds on its stated recommendation and records the rejected alternatives here rather than
asking first (DR-086 §2/§4) — approving this T4 spec is still a human act (DR-012), and that
approval is what ratifies the selections below, not this agent run.

### DQ-1 — Does the lifecycle become new `Phase` values, or an orthogonal type?

**Recommended: Option B** (adopted in FR-1/FR-4/FR-5 above).

- **Option A — add `'core-signoff' | 'cross-checks' | 'final-approve'` to the `Phase`
  union and `PHASES` array (`config.ts:8`, `:11`).** Reuses the existing `PhaseState`/
  `getCurrentPhase`/`advancePhase` machinery (`lifecycle.ts`) instead of a new type. *Cost:*
  `Phase`/`PHASES` is read uniformly across **every** tier today (`phaseMappings`,
  `deriveStatus`, `getSpecStatus`, `phasesForApproval`, the status-bar); three new members
  that only ever apply to T3/T4 would force every one of those call sites to special-case
  tier, and `deriveStatus`'s `allRequiredDone`/`allPending` helpers (`lifecycle.ts:67-77`)
  would need to learn that the new members are sometimes absent by design (T1/T2) — not
  sometimes-skipped like `clarify` is today, but *never present*. This is exactly SPEC-013's
  own "Costly to Refactor #4" class of change (a structural contract every doc/surface
  adopts) for a net-new axis, not the hash/delimiter SPEC-013 already costs that way.
- **Option B — a new `CrossChecksStatus` type in `packages/shared`, consumed, never folded
  into `Phase`/`SpecStatus` (rec).** Mirrors `ApprovalStatus`'s existing relationship to
  `SpecStatus` (orthogonal, read by callers that need it, invisible to callers that don't).
  *Cost:* a fourth status-shaped axis for a newcomer to learn (`SpecStatus`, `ApprovalStatus`,
  `Phase`/`PhaseState`, now `CrossChecksStatus`) — more concepts, but each stays small and
  none of the existing three's tests or call sites change.

### DQ-2 — Does SPEC-015 gain a sixth lane, or an additive group?

**Recommended: Option B** (adopted in FR-3).

- **Option A — a sixth `STATUS_GROUPS` entry, e.g. "Cross-Checks."** Visible at the same
  glance as the other five lifecycle lanes. *Cost:* `cross-checks` is not a `SpecStatus`
  value and was explicitly rejected as one in SPEC-015's own Context ("approval is an
  orthogonal axis... folding it into the status lanes would cross axes and make a spec's
  lane ambiguous") for the *approval* axis; the same reasoning applies here — a lane
  requires a `SpecStatus` member (SPEC-015 INV-1 is a total-coverage invariant over that
  enum), so this option needs a new `SpecStatus` value too, reopening INV-1/INV-2's test
  suite and `deriveStatus` for an axis that is not actually about status.
- **Option B — an additive cross-cutting group, built like `getNeedsReapprovalGroup` (rec).**
  Zero change to `STATUS_GROUPS`, `SpecStatus`, or SPEC-015's own tests. *Cost:* a spec
  mid-cross-checks appears in **two** places at once (its ordinary lifecycle lane, and the
  new pinned group) rather than one unambiguous lane — the same trade SPEC-029 already made
  for staleness, and already shipped.

### DQ-3 — Who defines what bytes `coreHash` covers?

**Recommended: Option B** (adopted in FR-2).

- **Option A — this spec defines the Zone-A byte range and canonicalization itself,**
  since SPEC-013 has not built it yet and this spec needs *something* to hash now. *Cost:*
  two specs would each own a definition of the same hash's input, and SPEC-013's FR-8/FR-10
  (not yet built, still `specifying`-equivalent in practice) would have to be reconciled
  with — or would silently override — whatever this spec ships first. Exactly the
  "two implementations = permanent drift" risk SPEC-013 itself names for its own
  `hasSection` predicate (SPEC-013 Costly to Refactor #1), applied to `coreHash`.
- **Option B — this spec owns the sidecar's shape and write-gate only; the byte range is
  SPEC-013's, consumed when it ships (rec).** Mirrors the existing DR-012/SPEC-022 split
  exactly (DR-012 says `specHash` is a human-bound hash; SPEC-022 says where the record
  lives and who may write it). *Cost:* FR-2 cannot be fully implemented — only scaffolded
  with a placeholder hash function — until SPEC-013 ships; Plan must sequence accordingly
  (DQ-4).

### DQ-4 — Build now with a degrade, or wait for SPEC-013?

**Recommended: Option A** (adopted in FR-8).

- **Option A — build the contract now with the FR-8 honest degrade; swap in SPEC-013's real
  floor verdict and byte range when it ships (rec).** Closes DR-029's own Methodology Fit
  gap (the three surfaces knowing the phase exists) without waiting on an unbuilt
  dependency, the same way SPEC-013 itself ships FR-9 L0–L3 "independently of" the SPEC-006/
  SPEC-010 layers it is sequenced behind (SPEC-013 Open Questions). *Cost:* until SPEC-013
  ships, every T3/T4 spec that has a fresh core-signoff reads as `'awaiting-cross-checks'`
  even once a human has also cleared `specHash` approval the ordinary DR-012 way (FR-8's
  degrade cannot yet see that the floor would have been satisfied) — a cosmetic
  over-reporting of "pending," never a wrong block (FR-6).
- **Option B — sequence this spec strictly after SPEC-013 lands.** *Cost:* DR-029's own
  named gap (three surfaces blind to a phase that already exists once SPEC-013 ships) stays
  open for the full duration of SPEC-013's build, which is itself `tier: T4` and still at
  "zero implementation" — an unbounded wait for a fix this issue exists specifically to not
  defer further.

## Why no new DR

Every recommended option above is additive and reversible in well under a day: a new
`packages/shared` type with no existing caller to migrate (DQ-1), a new tree-view group
alongside an existing one of the same shape (DQ-2), a sidecar store whose own precedent
(`approval-store.ts`) is already documented as reversible by deleting the module and its
call-sites, and a degrade path that narrows automatically once SPEC-013 ships (DQ-4) rather
than needing to be unwound. None of them touch `SpecStatus`, `STATUS_GROUPS`, `Phase`,
`PHASES`, or DR-012's blocking-gate contract (INV-6, FR-6). A DR becomes necessary only if
Plan or review selects **Option A on DQ-1** (a `Phase`/`PHASES` enum change — SPEC-013's own
"Costly to Refactor" class) or **Option A on DQ-3** (this spec, not SPEC-013, defining
`coreHash`'s byte range) — either reopens a corpus-wide contract and should not proceed to
Plan without one.

## Out of Scope

- **SPEC-013's own mechanism** — the Zone-A/Zone-B divider, the deterministic floor layers
  (L0–L4), `coreHash`'s precise canonicalization. Owned there (FR-8/FR-9/FR-10); this spec
  consumes, never redefines (DQ-3).
- **The command(s) that perform the human core-signoff act and the LLM cross-checks-
  authoring trigger.** This spec defines the *state* (FR-1, FR-2) and its *visibility*
  (FR-3, FR-5) — not a "MinSpec: Core-Sign-Off Spec" command's UX/copy. File as a follow-up
  once SPEC-013 ships, if no spec already covers it.
- **EPIC-007 reality-check / round-table (Tier-1).** Already out of SPEC-013's own scope;
  stays out here too.
- **The skim/trust claim (#127) and its telemetry (#128).** Unrelated axis — DR-029 §6.
- **Whether final-approve should ever block on cross-checks state.** Resolved by DR-029 §4
  (never); restated as INV-2/FR-6, not reopened here.

## Alternatives considered and rejected

- **An LLM-computed `CrossChecksStatus`.** Rejected: Tier-0/determinism (DR-004, DR-019) —
  the whole point of a signpost/lane/predicate the human trusts at a glance is that it is
  derived, never guessed.
- **Folding core-signoff into the existing `spec-approve` node with a sub-flag** instead of
  a new `NodeKind`. Rejected: conflates two distinct human acts (freeze-the-FRs sign-off vs.
  skim-and-final-approve) into one node, which breaks SPEC-012 FR-7's "show the evidence" —
  a human who clears the node cannot tell which of the two gates they just cleared.
- **A second, cross-checks-specific next-task resolver** instead of extending the existing
  one. Rejected: reintroduces the exact "surfaces disagree" risk (SPEC-012 R3) that FR-11
  (one `packages/shared` engine) exists to prevent.

## Test plan (for the Plan phase to place)

- **T0:** the `CrossChecksStatus` deriver — every state combination (FR-1 Acceptance
  Criteria), the T1/T2 always-`'none'` fixture (FR-7), the FR-8 degrade fixture, and the
  DR-056 bot-identity refusal on the new sidecar (FR-2).
- **T1/T2:** `spec-tree-provider.test.ts` — the new group's membership, non-empty-only, and
  terminal-exclusion fixtures (FR-3), alongside the existing SPEC-015/SPEC-029 fixtures,
  unregressed.
- **T0:** `next-task` fixtures — the new node kind's severity and imperative text, the
  zero-nodes-for-`awaiting-cross-checks` fixture, and the existing Two-Queues fixture,
  unregressed (FR-5, INV-3).
- **Not vacuous:** each new fixture is paired with a mutant (flip the predicate, drop the
  tier guard, remove the terminal exclusion) shown to turn the corresponding test red.

## Traceability

- **Issue:** [#131](https://github.com/AIClarityAU/minspec/issues/131).
- **Decision:** [DR-029](../../../docs/decisions/DR-029.md) §4 (lifecycle), §Methodology Fit
  deviation #5 (this spec's whole reason to exist).
- **Depends on / consumes:** [SPEC-013](../SPEC-013-risk-section-policy/requirements.md)
  FR-8/FR-9/FR-10/FR-13 (floor + divider + coreHash definition, unbuilt — DQ-3/DQ-4);
  [DR-012](../../../docs/decisions/DR-012.md) (sole blocking gate, unchanged — FR-6);
  [SPEC-022](../SPEC-022-approval-foundation/requirements.md) (the sidecar-store precedent
  FR-2 mirrors).
- **Propagation targets (the issue's three named surfaces):**
  [SPEC-015](../SPEC-015-status-lanes/requirements.md) (FR-3, DQ-2),
  `packages/minspec/src/lib/config.ts` classifier config (FR-4, DQ-1),
  [SPEC-012](../SPEC-012-next-task-resolver/requirements.md) next-task resolver (FR-5, DQ-1).
- **Precedent reused:** [SPEC-029](../SPEC-029-approval-staleness-ux/requirements.md) (the
  additive-group pattern, DQ-2).
