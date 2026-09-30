---
id: SPEC-080
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — same epic as SPEC-010/SPEC-012/DR-085; the promise this spec keeps honest is the same "never-wrong" signpost
aspects: [signpost, next-task, ownership, approval, tier-0, never-wrong, gate-integrity]
relates_to: [SPEC-012, SPEC-010, SPEC-038, SPEC-051, DR-085, DR-019, DR-003, DR-004]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-080: The signpost must never tell a human to Approve a spec the approve gate will refuse

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch
> that produced it. A human reads this spec, resolves
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before anything is built.

Materializes **[#1603](https://github.com/AIClarityAU/minspec/issues/1603)** — measured
against the live corpus (`ownershipDeclaration: "error"`), 3 of 6 pending `spec-approve`
signpost nodes (SPEC-062, SPEC-063, SPEC-064) advertised "Approve" for a spec the approve
command actually refuses, because it has no `implements:` declaration. Pressing Alt+A on
one of those three does nothing but produce a refusal modal.

## One-Sentence Scope

Give the Tier-0 next-task resolver (`@aiclarity/shared`) an approval-legality input it
does not compute itself — mirroring how it already consumes `implementHole` rather than
re-deriving implement-phase coverage — so a `spec-approve` node is never rendered as a
plain, actionable "Approve SPEC-N" for a spec the approve command would refuse, while
staying on the human-facing signpost as a **named, blocked** item rather than
disappearing or turning into an authoring node.

## Context

### The mechanism, verified against this repo's current `HEAD`

Two predicates decide "can this spec be approved", and until now nothing asserted they
agree:

- **The signpost.** `resolvePipeline`'s spec loop emits a `spec-approve` node on
  structural state alone — `s.approvalState === 'unapproved' || s.approvalState ===
  'stale'` plus epic/status gating
  (`packages/shared/src/next-task.ts:743-778`, node literal at `:764`). It has no notion
  of approval *legality*, only of approval *state*.
- **The approve command.** `approveSpecCommand` refuses on **two** spec-content checks,
  in order, before any write:
  1. **Current-state completeness** — `validateSpec(parsed, config, { knownEpicRefs,
     siblingShardFiles })` (`approve.ts:244-249`); any error-severity violation
     (`!result.complete`) refuses in a modal (`approve.ts:253-266`).
  2. **Introduced-by-approval** — `violationsIntroducedByApproval(parsed, config, {...})`
     (`approve.ts:274-277`); any returned error refuses in a modal
     (`approve.ts:278-296`).

  The issue names only check 2, because that is the one its measured corpus tripped.
  Check 1 is the same bug class — a spec with a current error (say, a diverging shard
  id, #439) also gets a plain "Approve" from the signpost and a refusal from the
  command — so this spec covers **both**. (A third refusal, DR-056's approver-identity
  gate further down `approveSpecCommand`, depends on *who* is approving, not on the
  spec's content; it is out of scope, see Out of Scope.) `violationsIntroducedByApproval`
  (`spec-validator.ts:868-897`) simulates the phase map `approveSpec` would write
  (`phasesForApproval`) and re-validates — so a spec that is legal *now* can be illegal
  the instant it is approved, because approval advances `phases.plan` to `in-progress`,
  which is exactly the state that arms `validateOwnership`'s
  `ownership.implements.missing` rule at `error` (`spec-validator.ts:791-828`,
  `.minspec/config.json`'s `ownershipDeclaration: "error"`).

`violationsIntroducedByApproval` already has **two** call sites that agree by
construction — `approve.ts:274` (the VS Code command) and
`ownership-advance-guard.ts:75` (the lib-boundary guard SPEC-051 added for every
non-UI caller, `packages/minspec/src/lib/ownership-advance-guard.ts:1-17` explains why it
is a separate module rather than a second copy). Note that the guard runs only check 2,
not check 1, and it **fails open**: if evaluation throws it logs a warning and lets the
advance proceed (`ownership-advance-guard.ts:76-82`). That is acceptable there because
`npm run validate` backstops it; it is **not** acceptable for the signpost (FR-7).

The resolver in `@aiclarity/shared` is Tier-0 and must not import any of this: the
validator belongs to the extension package, and `@aiclarity/shared` is the Tier-0 layer
that carries no `vscode`, filesystem, or network dependency (constitution invariant 1;
[DR-004](../../../docs/decisions/DR-004.md) tier model).
That import boundary is the structural reason the signpost's predicate and the approve
gate's predicate drifted, not an oversight: nobody wired a **third**, Tier-0-safe path for
the legality *answer* (not the check itself) to reach the resolver.

No test asserts *"every `spec-approve` node the resolver emits is one the approve command
would accept."* The refusal shipped in #1317 with no matching resolver-side check, so
arming `ownershipDeclaration` at `error` (#829) silently made a slice of the signpost
wrong — exactly the asymmetry class SPEC-038's own INV-2 (`#137`) already names and
guards against for the *validator's* two directions; this spec closes the same asymmetry
one layer up, between the validator and its *consumer*.

### Correction to the issue's own proposed fix — DR-085 already decided step 3

The issue's "Proposed fix" step 3 suggests the resolver emit "instead of `Approve
SPEC-062`, a `phase-action`-style node naming the real blocker" — i.e., replace the
approval node with an authoring node. **[DR-085](../../../docs/decisions/DR-085.md)**
(accepted the same day as this issue, and which names this exact issue by number) already
settles that question differently, and this spec follows DR-085, not the issue's original
step 3:

- DR-085 §1 restricts the human signpost to nodes the human can discharge **from the
  editor, without delegating**. `phase-action` (authoring work) is being *removed* from
  that surface, not added to — so a design that introduces a *new* authoring-shaped node
  for this case would create the exact problem DR-085 exists to close, on day one.
- DR-085 §5, verbatim (`docs/decisions/DR-085.md:113-117`): *"An approval the gate would
  refuse (#1603 - a spec with no `implements:` declaration) decomposes into authoring
  work plus an approval. The authoring half moves to the agent surface under §1, but the
  **approval must remain visible as blocked**, with its blocker named. It must not
  silently vanish from the human queue merely because its blocker is someone else's job.
  This is the one place the two surfaces must cross-reference."*

So the fix this spec specifies is: keep the `spec-approve` node (never substitute a
`phase-action` node, never drop the spec from the ranked output), and change what it
*says* and how it is evidenced when the approve gate would refuse it. The authoring work
itself (declaring `implements:`) is out of this spec's scope — DR-085 routes it to the
agent-queue surface (`#1005`, not yet built), which this spec does not depend on: a
blocked node can be rendered correctly on the signpost whether or not that second surface
exists yet.

### Where the new data lives, by analogy to `implementHole`

`SpecNode.implementHole` (`next-task.ts:107`) is the precedent for exactly this shape: a
fact only the filesystem-reading fs-adapter can compute, travelling to the Tier-0
resolver as inert data it *consumes but never re-derives*
(`artifact-graph.ts:277`, `:550`). This spec's new field follows the identical
contract: the fs-adapter (`packages/minspec/src/lib/artifact-graph.ts`, Tier-1) computes
legality with the **same** predicate the approve command refuses on, and hands the
resolver the answer, not the means of computing it.

**Correction to the issue's premise.** The issue says the fs-adapter "already imports the
validator". It does not: `artifact-graph.ts`'s imports (lines 25-47) are `config`,
`epic-manager`, `adr-manager`, `spec`, `lifecycle` and `approval`, with no
`spec-validator`. The layering still holds, because both are in the Tier-1 extension
package, but this is a **new import edge**. `ownership-advance-guard.ts:62-72` records
that a nearby edge once created import cycles (measured "3 cycles with them, 0
without"), so the plan must measure this edge with the repo's cycle check rather than
assume it is free (AC-5).

## Functional Requirements

- **FR-1 (one refusal predicate, shared by the command and the signpost).** The set of
  spec-content reasons the approve command refuses on (check 1, current-state errors,
  plus check 2, errors introduced by approval, see Context) MUST be computed by **one**
  lib-level function that both `approveSpecCommand` and the fs-adapter call. Neither may
  keep a private copy of the combination. `violationsIntroducedByApproval` stays the one
  implementation of check 2, and `validateSpec` stays the one implementation of check 1;
  what is added is a single place that combines them in the command's order. A
  second, independently written predicate anywhere, such as a hand-rolled
  `implements:`-present test in the fs-adapter, is forbidden. *Rationale: the bug is two
  predicates for one question; SPEC-038 INV-2 (#137) and SPEC-051 INV-5 already set "one
  matcher, many callers" as this codebase's answer. Calling only
  `violationsIntroducedByApproval`, as the issue proposes, would leave check 1's refusals
  still advertised as "Approve".*

- **FR-1a (same inputs as the command).** The fs-adapter MUST evaluate the predicate with
  the same validation context the command passes: the loaded config, `knownEpicRefs`
  from the epic registry, and `siblingShardFiles` for the spec's directory
  (`approve.ts:244-249`, `:274-277`). The omission that is safe inside
  `ownership-advance-guard.ts` (options cancel out of check 2's before/after diff,
  `ownership-advance-guard.ts:64-67`) does **not** carry over, because check 1 is an
  absolute set and its result depends on those options. *Rationale: same function with
  different inputs is still two predicates.*

- **FR-2 (the fact travels as inert data, Tier-0 stays pure).** `SpecNode` gains a new
  optional field carrying the fs-adapter's computed legality result for specs that are
  `unapproved` or `stale` (mirroring `implementHole`'s optionality and its "absent ⇒ no
  gate" default). The Tier-0 resolver in `@aiclarity/shared` MUST NOT gain any new
  import (no `spec-validator`, no `fs`, no `vscode`) — it only reads the field, exactly
  as it already reads `implementHole` and `hasUnresolvedOpenQuestions`. *Rationale:
  constitution invariant 1 (offline core); the resolver's existing Tier-0/Tier-1 boundary
  (`artifact-graph.ts:272-280`'s comment states the same contract for `implementHole`).*
  The field MUST carry a **tri-state**, not a bare boolean: *legal*, *blocked* (with the
  refusing violations), or *unknown* (the predicate could not be evaluated, with the
  reason). An absent field keeps today's behaviour, so a graph built by any other
  producer (tests, future adapters) is unaffected.

- **FR-3 (a blocked spec never renders a plain "Approve").** When the fs-adapter's
  computed legality for a pending spec carries one or more blocking violations, the
  resolver's `spec-approve` node for that spec MUST NOT use the unqualified `Approve
  SPEC-N` imperative. It MUST instead name the real, actionable-by-someone blocker (e.g.
  "SPEC-N cannot be approved yet — declare its owned code (`implements:`) first"),
  drawn from the same violation data the approve command's refusal modal already shows
  (`message`/`fixHint` on `ValidationViolation`), so the two surfaces state the identical
  reason in the identical words wherever practical. *Rationale: the issue's core
  complaint — a never-wrong surface telling the human to do something the product
  itself blocks.*

- **FR-4 (stays a human-signpost item; no authoring-node substitution).** Per DR-085 §5,
  a blocked spec's node MUST remain `kind: 'spec-approve'` on the ranked output — never
  converted to `phase-action` or any other kind, and never silently omitted from
  `resolvePipeline`'s output. The signpost's "clear" state must not become true merely
  because the only spec left is blocked-but-unfixed. *Rationale: DR-085 §5 names this
  exact scenario; §1's dischargeable-only membership test forbids introducing a new
  authoring-shaped node here as an alternative.*

- **FR-5 (distinguishable evidence, not just a different string).** The blocked node's
  `evidence.rule` MUST differ from the unblocked cases' `gate.spec-approve` /
  `pending.spec-approve` (e.g. a new rule id such as `ownership.spec-approve.blocked`),
  so a consumer (status bar, tests, the planned DAG-viz) can distinguish "ready to
  approve" from "blocked, needs authoring first" without string-matching the imperative.
  *Rationale: DR-019's severity-class machinery already keys behaviour off `rule`/
  `severityClass`; a blocked approval must be mechanically distinguishable, not just
  differently worded.*

- **FR-6 (parity test, both directions, fixture-driven).** A test over a fixture corpus,
  run through the real fs-adapter and then the resolver, asserts for every pending spec:
  a plain "Approve" `spec-approve` node is emitted **iff** the FR-1 predicate on that
  spec returns no refusal, and the blocked variant is emitted **iff** it returns one or
  more. Both directions, so the asymmetry cannot silently return (the #137 / SPEC-038
  INV-2 pattern). The fixture MUST include at least one spec per refusal source: check 1
  only, check 2 only, both, and neither. *Rationale: a one-direction test, or one that
  only exercises `ownership.implements.missing`, would pass today on the input the
  issue measured and prove nothing about the next rule armed at `error`.*

- **FR-7 (fail closed and visibly when legality cannot be computed).** If evaluating the
  predicate for a spec throws (unreadable file, config error, a validator bug), the
  fs-adapter MUST record *unknown* with the reason, and the resolver MUST NOT render the
  plain `Approve SPEC-N` for that spec. It renders a variant that says the approval's
  legality could not be checked and why, with its own distinguishable `evidence.rule`.
  The fs-adapter MUST NOT copy `ownership-advance-guard.ts`'s swallow-and-proceed
  behaviour. *Rationale: constitution invariant 2, "a missing or errored witness fails
  the gate closed and visibly". Defaulting to "legal" on error would bring back exactly
  the wrong "Approve" this spec removes, silently.*

- **FR-8 (no change to the act itself).** Activating a blocked or unknown node still runs
  the existing approve command, which re-evaluates and refuses on its own. This spec
  changes what the signpost *claims* before the click, never the command's refusal.

## Acceptance Criteria

- [ ] **AC-1 (FR-3).** Run against a fixture reproducing the corpus in the issue's table:
      SPEC-062/063/064-shaped specs (T3/T4, no `implements:`, pending approval) each emit
      a blocked node naming the ownership gap; SPEC-053/055/057-shaped specs (declared
      `implements:` or a valid `none` + reason) each emit the plain "Approve" node
      unchanged.
- [ ] **AC-2 (FR-4).** The blocked node's `kind` is asserted to be `'spec-approve'` in
      the fixture test — never `'phase-action'` or any other kind — and the spec is
      present in `resolvePipeline`'s output (not silently dropped).
- [ ] **AC-3 (FR-5).** The blocked node's `evidence.rule` differs from both
      `gate.spec-approve` and `pending.spec-approve`; a snapshot/shape test pins the new
      rule id.
- [ ] **AC-4 (FR-1).** `approveSpecCommand` and the fs-adapter both call the one FR-1
      function, and neither contains its own `validateSpec` + `violationsIntroducedByApproval`
      combination. A test proves the two agree: for each fixture spec, the command's
      refusal decision (with `vscode` stubbed) and the fs-adapter's recorded legality are
      the same. Grep alone does not count, because a textual check passes on a renamed
      copy.
- [ ] **AC-4a (FR-1a).** A fixture spec whose only error depends on validation context,
      a diverging sibling shard id (#439), is reported *blocked* by the fs-adapter. It
      would read *legal* if the context were omitted.
- [ ] **AC-5 (FR-2, INV-3).** The existing Tier-0 source-scan test
      (`packages/shared/tests/next-task.test.ts`, `INV-DET-2`) passes unchanged, and no
      new import is added to any file under `packages/shared/src`. `npm run check:cycles`
      passes with the new `artifact-graph` to validator edge in place.
- [ ] **AC-6 (FR-6).** The new parity test fails against the pre-fix resolver (a blocked
      spec gets the plain "Approve") and passes on the fix, in both directions. The
      implementer records that both runs were made.
- [ ] **AC-7 (FR-7).** A fixture where the predicate throws for one spec yields the
      *unknown* variant for that spec, with its own `evidence.rule`, never the plain
      "Approve". The other specs in the same graph are resolved normally, so one bad spec
      does not blank the signpost.
- [ ] **AC-8 (FR-8, regression).** Activating a blocked node still runs the existing
      approve command, which still refuses (`approve.ts:253-296`). No behaviour of
      `approve.ts` changes except that it calls the shared FR-1 function.

## Invariants (must not break)

- **INV-1 (never-wrong signpost).** No node the resolver emits may direct the human to an
  act the product itself will refuse. This is the invariant the bug report is about;
  every other invariant here is in service of it.
- **INV-2 (one refusal predicate, following the SPEC-038 INV-2 / SPEC-051 INV-5 pattern).**
  The fs-adapter's legality computation and the approve command's refusal MUST come from
  the same FR-1 function with the same inputs, never from two independently maintained
  predicates that can drift. That drift is the failure this spec exists to close.
- **INV-3 (Tier-0 offline core — constitution invariant 1).** `packages/shared` gains no
  new filesystem, `vscode`, or network import. The resolver consumes a fact; it never
  computes one requiring the filesystem.
- **INV-4 (DR-085 compliance — signpost carries only dischargeable acts).** This spec
  does not add a `phase-action` (or other authoring-class) node to the human signpost.
  The authoring half of a blocked approval stays out of scope here, routed to DR-085's
  agent-queue surface (`#1005`) when that lands.
- **INV-5 (no silent gate — constitution invariant 2).** A blocked or unknown spec is
  never dropped from `resolvePipeline`'s output, the "clear" state is never reported
  true while one exists in the graph, and a legality evaluation that errors never
  defaults to "legal" (FR-7).
- **INV-6 (the approve command's own safety is untouched).** The command keeps refusing
  independently of anything the signpost says. The signpost's legality field is
  advisory display data and is never consulted as an authorisation.
- **INV-7 (deterministic resolver).** The resolver stays a pure function of its graph
  (SPEC-012 `INV-DET`). The new field is plain data, so the same graph must still
  produce identical output.

## Decisions needed (Clarify)

- **DQ-1 — Does a blocked node's `severityClass` stay `blocked-ready` under an active
  epic, or is it forced to `pending` regardless of epic status?** Today,
  `blockedOrPending()` (`next-task.ts:575-583`) gives a pending approval `blocked-ready`
  — meaning "worth doing right now" — whenever its epic is active, which is also how it
  wins tie-breaks to the top of the queue (`CLASS_RANK`, `next-task.ts:550-555`). A
  blocked spec is, definitionally, *not* actionable right now by the human reading the
  signpost.
  - **Option A — force `pending` for any blocked node, regardless of epic status
    (recommended).** Keeps the signpost's top slot honestly reserved for something the
    human can actually finish by pressing a key. *Cost:* a small, spec-approve-specific
    branch in what is currently one shared `blockedOrPending()` helper used by three
    loops (`spec-approve`, `adr-accept`, `answer-OQ`) — Plan must decide whether that is
    a parameter, a wrapper, or a genuine fork.
  - **Option B — leave `severityClass` computation unchanged; rely on the new `rule` id
    (FR-5) and imperative text alone to signal "blocked."** *Cost:* a blocked node can
    still rank as `blocked-ready` and sit at the top of the queue ahead of specs the
    human actually can approve right now — the exact ordering complaint DR-085 raised
    for `phase-action`, recurring here in miniature.
  - *Trade-off:* Option A costs a small refactor to a shared helper; Option B is free to
    implement but reopens a smaller version of the ordering problem DR-085 just closed.

- **DQ-2 — Single reason or the full violation list on `SpecNode`?**
  `violationsIntroducedByApproval` can return more than one violation for a spec (e.g.
  ownership plus an unrelated newly-armed rule). Does the new field carry the full
  `ValidationViolation[]` (richer, lets Plan decide how much detail the tooltip shows) or
  a single summarized reason (simpler node shape, matching `implementHole`'s single-cause
  design)?
  - *Recommendation:* carry the full list — collapsing to one reason risks silently
    hiding a second blocker from the human the way the bug itself hid the *first* one.
    *Cost:* a slightly richer `SpecNode` shape and evidence formatting to decide at Plan
    (how multiple violations render in one imperative line vs. the explanation/tooltip).

- **DQ-3 — Exact new `evidence.rule` id and imperative wording.** FR-5 requires
  *distinguishable*, not a specific string. Plan should settle the literal id (e.g.
  `ownership.spec-approve.blocked` vs. reusing `ownership.implements.missing` directly on
  the node) and whether the imperative echoes `fixHint` verbatim or is composed
  specifically for the signpost's character budget, the way `phase-action`'s imperative
  is already shortened relative to its `explanation` field (the `phase-action` node at
  `next-task.ts:884`). *Recommendation:* a short, composed imperative for the label, with
  the full violation `message`/`fixHint` text in `evidence.explanation`. That matches the
  existing `phase-action` split and keeps this spec from pinning exact prose. *Cost:* the
  label and the approve modal will not use identical words, so FR-3's "identical words"
  holds only for the explanation.

- **DQ-4 — Where does the combined FR-1 function live, and does check 1 run first?**
  - **Option A (rec):** a new function in `spec-validator.ts` (or a sibling lib module)
    returning check 1's errors if any, otherwise check 2's, which mirrors the command's
    order so the signpost names the same first reason the modal would. *Cost:* the
    signpost may show one layer of blockers at a time, so fixing check 1 can reveal a
    check 2 blocker next.
  - **Option B:** return both sets together. *Cost:* it can name a check 2 violation the
    command would never reach while check 1 still refuses, and some check 2 results may
    be artefacts of check 1's errors. It also diverges from the modal's wording.

- **DQ-5 — Should the unknown variant (FR-7) rank like a blocked node or like a
  gate-violation?** An unevaluable spec could mean a corrupt file, which is arguably
  more urgent than a missing `implements:`.
  - **Option A (rec):** rank it like a blocked node (per DQ-1), with its own rule id.
    *Cost:* a corrupted spec may sit below ready approvals until someone reads the node.
  - **Option B:** force it to `gate-violation`. *Cost:* a transient failure such as a
    config parse error would push every pending spec to the top at once, crowding out
    real work.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | A hand-rolled second ownership check creeps into the fs-adapter instead of reusing `violationsIntroducedByApproval`, reopening exactly this drift one layer down. | INV-2 / FR-1 / AC-4 pin the single call site. |
| R2 | DQ-1 resolves to Option B and a blocked node keeps outranking approvable specs, reproducing DR-085's ordering complaint in miniature. | DQ-1 recommends Option A; flagged explicitly rather than defaulted silently. |
| R3 | The new field creeps `packages/shared` toward importing validator logic directly (a Tier-0 boundary violation) as a shortcut during Plan/implement. | INV-3 / FR-2 / AC-5 make this a tested boundary, not just a stated one. |
| R4 | Multiple simultaneous violations on one spec get collapsed to a single displayed reason, hiding a second blocker. | DQ-2 recommends preserving the full list. |
| R5 | The new `artifact-graph` to `spec-validator` import closes an import cycle, as a neighbouring edge once did (`ownership-advance-guard.ts:69-71`). | AC-5 requires `check:cycles` to pass. If it fails, the FR-1 function moves to a leaf module (the `ownership-advance-guard.ts` precedent). |
| R6 | Validating every pending spec on each signpost refresh adds cost. The validator runs on specs already parsed for the graph, so it should be cheap, but this is unmeasured. | The plan measures the refresh time on the live corpus before and after, and memoises only if the measurement shows a need. |
| R7 | The fs-adapter swallows a predicate error the way the guard does, and quietly shows "Approve". | FR-7 / AC-7 / INV-5. |

## Out of Scope

- **Building DR-085's agent-queue surface (`#1005`)** or the "declare ownership" act
  itself. This spec only makes the *approval* node honest; the authoring half is
  DR-085's, not this spec's.
- **Changing `ownershipDeclaration`'s `warn`/`error` severity or `validateOwnership`'s
  own boundary conditions** (SPEC-038 owns that).
- **Changing DR-019's DAG ranking algorithm, `CLASS_RANK`, or the tie-break dials**
  beyond the narrow `blockedOrPending()` question in DQ-1.
- **Any change to `approve.ts`'s own refusal behavior.** It already refuses correctly
  (AC-8). The only edit there is routing its two checks through the shared FR-1
  function, with identical outcomes.
- **DR-056's approver-identity refusal.** It depends on who is running the command (an
  agent identity is refused), not on the spec. The signpost is shown to the human in the
  editor, so that refusal does not make a spec-level "Approve" wrong.
- **Authoring the missing `implements:` on SPEC-062, SPEC-063 and SPEC-064.** This is
  corpus data work the issue lists separately. It is outside this dispatch's allowlist
  and belongs with those specs' owners. Doing it would also remove the live
  reproduction before the parity test exists.
- **The Specs tree view's approve affordance.** Whether that surface should mirror the
  blocked state is a separate surface decision. This spec covers the next-task
  resolver and the signpost it drives.

## Alternatives considered and rejected

Recorded because the session ran under autonomy `act`, where nobody sees the rejected
options live (DR-086 §4).

- **Implementing the issue's original step 3 literally (substitute a `phase-action`
  node).** Rejected on evidence: DR-085, accepted the same day and naming this issue by
  number in its own §5, explicitly requires the opposite — the approval stays visible as
  a blocked `spec-approve` node, and no new authoring-shaped node is added to the human
  signpost. Following the issue's original prose here would ship a design its own cited
  DR already overrode.
- **Letting `packages/shared` import `spec-validator` directly.** Rejected — crosses the
  Tier-0/Tier-1 boundary (constitution invariant 1, DR-004); the existing
  `implementHole`/`ownership-advance-guard.ts` precedent for "compute in Tier-1, consume
  in Tier-0" is the established pattern and this spec follows it rather than opening a
  new import edge.
- **Calling only `violationsIntroducedByApproval`, as the issue proposes.** Rejected
  because the command also refuses on current-state errors (check 1,
  `approve.ts:253-266`). Covering only check 2 would leave that half of the signpost
  still wrong, with a parity test that is green only because it never exercises
  check 1.
- **A bare boolean `approvalBlocked` field.** Rejected because it cannot express
  "could not evaluate", so an error would have to collapse to either legal (a silent
  wrong "Approve") or blocked (a misleading reason). FR-7 needs the third state.
- **Silently dropping a blocked spec from the ranked output instead of flagging it.**
  Rejected — reproduces constitution invariant 2 (no silent gate) at a new layer: a
  blocked-but-invisible spec is worse than a mis-labeled one, because nothing tells the
  human it exists at all.

## Traceability

- **Issue:** [#1603](https://github.com/AIClarityAU/minspec/issues/1603) — "'Approve
  SPEC-N' is emitted for specs the approve gate refuses - resolver has no
  approval-legality input."
- **Governing design decision, accepted the same day, names this issue by number:**
  [DR-085](../../../docs/decisions/DR-085.md) §5 — "A blocked approval stays on the human
  queue."
- **Predicates this spec reuses (never re-derives):** `validateSpec` (check 1, call at
  `packages/minspec/src/commands/approve.ts:244`) and `violationsIntroducedByApproval`
  (check 2, `packages/minspec/src/lib/spec-validator.ts:868-897`, called at
  `approve.ts:274` and `packages/minspec/src/lib/ownership-advance-guard.ts:75`, the
  lib-boundary guard from SPEC-051).
- **Ownership gate that fires (correctly) once a spec crosses the Plan boundary:**
  [SPEC-038](../SPEC-038-spec-code-ownership/requirements.md) `ownership.implements.missing`,
  `packages/minspec/src/lib/spec-validator.ts:791-828`.
- **Precedent for the "fs-adapter computes, Tier-0 resolver only consumes" shape:**
  `SpecNode.implementHole`, `packages/shared/src/next-task.ts:85-107`,
  `packages/minspec/src/lib/artifact-graph.ts:272-280,550` (`#1436`).
- **Sibling asymmetry-gate pattern this spec follows:** SPEC-038 INV-2 /
  [#137](https://github.com/AIClarityAU/minspec/issues/137) — a check's two directions
  must not drift, restated here one layer up (validator vs. its consumer).
- **Related, not absorbed:** [#1391](https://github.com/AIClarityAU/minspec/issues/1391)
  (pre-#1317 framing of the same seam), [#1380](https://github.com/AIClarityAU/minspec/issues/1380)
  (moving the check to the lib boundary — delivered as SPEC-051/`ownership-advance-guard.ts`),
  [SPEC-051](../SPEC-051-ownership-before-approval/requirements.md) (ownership-before-approval
  on the *approve* side; has no signpost scope, confirmed by this spec's own grep of its
  requirements.md returning zero matches for "signpost").
- **Tier-0 offline core:** constitution invariant 1, [DR-004](../../../docs/decisions/DR-004.md)
  (tiered network-consent model).
- **Fail-closed witness:** constitution invariant 2 (no silent gate), which FR-7 applies.
- **DR:** none minted. This spec follows DR-085 §5 and makes no hard-to-reverse choice of
  its own. The new `SpecNode` field is an internal, optional contract that can be
  removed in under a day.
- **RCDD method:** [DR-003](../../../docs/decisions/DR-003.md) — mechanism + missing gate,
  not a bad-state restatement; this spec's "gate" half is FR-6/AC-6's fixture-driven
  parity test.
