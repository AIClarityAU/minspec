---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - an unmodeled gate dependency is a signpost that lies
aspects: [signpost, never-wrong, dependency-model, constitution, invariants, approval, staleness, completeness, tier-0]
depends_on: [SPEC-012, SPEC-041, DR-019, DR-062]  # SPEC-012 owns the resolver whose rules the matrix points at; SPEC-041 owns the upstream-stale machinery the invariant gate reuses; DR-019 the severity model; DR-062 the fingerprint-what-you-approved-against primitive
relates_to: [SPEC-025, DR-039, DR-041, DR-047, DR-053, "#270", "#269", "#803", "#804", "#182"]
# Ownership declared in Specify, before approval mints a hash. All paths are NEW. The
# matrix and its rule-id registry live in Tier-0 shared (no vscode, no network); the
# completeness test is the gate that keeps the matrix whole.
implements: [packages/shared/src/doc-type-dependencies.ts, packages/shared/src/resolver-rule-ids.ts, packages/shared/tests/doc-type-dependencies.test.ts, packages/minspec/tests/invariant-gate.test.ts]
# Modified, not owned. next-task.ts gains the invariant rules and imports the rule-id
# union; artifact-graph.ts feeds invariant fingerprints; constitution.ts parses stable
# INV-N ids; approval.ts / approval-store.ts snapshot the invariant fingerprints.
affects: [packages/shared/src/next-task.ts, packages/minspec/src/lib/artifact-graph.ts, packages/minspec/src/lib/constitution.ts, packages/minspec/src/lib/approval.ts, packages/minspec/src/lib/approval-store.ts, .minspec/constitution.md]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Every gate dependency between document types is modeled - an audited type matrix, a test that keeps it complete, and invariants wired in as the first missing gate

**Triggered by:** [#270](https://github.com/AIClarityAU/minspec/issues/270) - "doc-type
dependency completeness - audit the type matrix for unmodeled GATE deps (invariants →
spec/DR is the first)".
**Design rests on:** [DR-019](../../../docs/decisions/DR-019.md) (next task is a
deterministic DAG; §2 severity classes, §5 coherence, §7 edges, §8 structure-only
corruption), [DR-062](../../../docs/decisions/DR-062.md) (approval validity is
graph-aware: fingerprint what an approval was made against, derive staleness on read),
[DR-041](../../../docs/decisions/DR-041.md) amendment (a constitution invariant is a
human-gated Approvable).
**Sequel to:** [SPEC-025](../SPEC-025-constitution-proposer/requirements.md) (Constitution
Proposer), whose INV-3 says "populate, do not enforce" and hands both invariant
enforcement and the constitution's deliberate-edit checkpoint to #270.

## In plain terms

MinSpec's signpost tells you the one next thing to do. It can only be right if it knows
every rule of the form "X must happen before Y". Today those rules were added one at a
time, as each was noticed. Nobody has ever listed every pair of document types
(constitution, goal, epic, decision record, spec, plan, tasks, issue, pull request) and
asked of each pair: *is there an ordering rule here, and does the signpost know it?*

This spec does that audit once, writes the answer down as data the code can check, and
adds a test that fails if a new document type or a new gate is ever added without a
matching rule. The first hole the audit finds is the biggest one: the constitution's
invariants - the "never violate" rules - have no connection to the signpost or the
validator at all. Changing an invariant today leaves every approved spec looking fine,
even though none of them was checked against the new rule.

## One-Sentence Scope

Add a Tier-0, machine-checked matrix of document-type dependencies (each cell is a gate,
an ordering dial, informational, or none, and each gate cell names the resolver or
validator rule that enforces it or the tracked issue that will), a completeness test that
fails on any unclassified cell or any gate with no enforcing rule, and wire the first
unmodeled gate - constitution invariants → every approvable - through stable `INV-N` ids,
an invariant-change approval checkpoint, and DR-062 upstream fingerprints, so an invariant
change reaches the signpost.

## Terms

- **Document type** - one kind of artifact: `invariant` (one constitution invariant),
  `goal` (one constitution goal, `G-N`), `epic`, `dr`, `spec` (requirements.md), `plan`
  (plan.md / design.md), `tasks` (tasks.md), `issue`, `pr`. The set is a closed union in
  code (FR-1).
- **Dependency class** - every ordered pair of document types gets exactly one:
  - **gate** - "the downstream must not proceed until the upstream is in a given state".
    Unmodeled ⇒ the signpost can say "do X" while X is invalid. This is the class the
    issue's discriminator is about.
  - **dial** - affects order between otherwise-independent work, never whether work may
    proceed (e.g. `goal:` rank, `epic.order`). Unmodeled ⇒ a mis-rank, not a lie.
  - **informational** - a link with no order impact (`relates_to`).
  - **none** - no relationship; still declared, with a one-line reason, so "not looked
    at" and "looked at, nothing there" are different values.
- **Enforcing rule** - a rule id the resolver (`packages/shared/src/next-task.ts`) or the
  validator can actually emit, e.g. `depends_on.uncleared`,
  `coherence.spec-ahead-of-epic`.

## Context - the audit, measured on `main` at 5f792386

What the resolver models today (all cited from code; "absent" claims name the terms
searched):

| Upstream → downstream | Class | State today | Evidence |
|---|---|---|---|
| epic → spec (membership `epic:`) | gate | **modeled** | `coherence.spec-ahead-of-epic`, `next-task.ts` `detectIncoherence` (line 495) |
| epic → dr (membership `epic:`) | gate | **modeled** | `coherence.adr-ahead-of-epic`, `next-task.ts` (line 524) |
| spec (own approval) → its implementation | gate | **modeled** | `coherence.implementing-unapproved`, `next-task.ts` (line 484) |
| any approvable → any (`depends_on`) | gate | **modeled** | `depends_on.uncleared`, `next-task.ts` line 694; `gateCleared` line 271 (dr cleared iff `accepted`) |
| any → any (`supersedes`) | gate (pruning) | **modeled** | `computeSuperseded`, Step 1 |
| any → any (`relates_to`) | informational | **modeled** as soft | `next-task.ts` line 349 (#893, non-gating, exempt from acyclicity) |
| spec → plan → tasks (phase chain) | gate | **modeled** | fixed phase DAG + `implementHole` (`SpecNode`) |
| goal → any (`goal:`) | dial | **modeled** | `artifact-graph.ts` `goalRankOf` line 182; DR-039 tie-break |
| **invariant → every approvable** | **gate** | **UNMODELED** | `ArtifactGraph` carries only `epics`/`specs`/`adrs`/`edges` (`next-task.ts` line 156); `Constitution` exposes invariants as bare `string[]` with no ids (`constitution.ts` line 10); grep of `packages/*/src` for `ConstitutionInvariant`, `upstreamDeps`, `upstream-stale` returns nothing |
| **dr (proposed) → spec that rests on it, linked only in prose** | gate | **partial** | gates iff the link is a `depends_on` edge (`depends_on.uncleared`); a prose "See DR-NNN" or a `relates_to` link does not gate, by design |
| approvable → pr touching its code | gate | **outside the resolver** | session `PreToolUse` spec-gate today; DR-062 §3 commit/CI gate carried by SPEC-041 |
| issue → anything | informational | not a node | DR-041 amendment: an Issue is AI-reviewed, never human-gated |
| pr → anything | gate (review) | **UNMODELED, tracked** | PR-review nodes are #182 (named deferred in the `next-task.ts` header) |
| constitution Phases ("Phase-1 always outranks Phase-2") | dial | **UNMODELED** | the constitution calls it "a priority signal for the next-task resolver"; grep of `next-task.ts` and `artifact-graph.ts` for `Phase-1`, `phaseRank`, `releasePhase` returns nothing |
| goal → any, ref to an unknown `G-N` | dial (dangling) | **silent** | `goalRankOf` returns `undefined` for an unknown ref; grep of `spec-validator.ts` for `goal` returns nothing (I believe no other validator flags it - unverified beyond that file) |

The audit's verdict, as the issue predicted: **one high-severity gate is wholly unmodeled
(invariants)**, one gate is modeled only when authors use the right edge (proposed DR →
spec), and two dials are unmodeled or silent. Those dials mis-rank but cannot make the
signpost name an invalid action, so they are recorded and tracked (FR-11), not fixed here.

**Why "check compliance" cannot be the invariant gate.** Whether a spec's content
*violates* an invariant is a semantic judgment, and DR-019 §8 rules that semantics has no
programmatic oracle. What *is* structural and deterministic is: **was this approval made
against the current invariants?** That is exactly DR-062's primitive (fingerprint what X
was approved against; derive staleness on read), applied with the constitution as the
upstream. The judgment of whether a changed invariant matters stays with the human (one
re-acknowledge keystroke, DR-062 §4), and AI review (DR-047) stays advisory.

## Functional Requirements

### Part A - the matrix and the completeness gate

- **FR-1 - Closed document-type union.** `packages/shared` exports
  `DocType = 'invariant' | 'goal' | 'epic' | 'dr' | 'spec' | 'plan' | 'tasks' | 'issue' | 'pr'`
  as a closed string union with a runtime array of all members. Tier-0: no `vscode`, no
  `fs`, no network.
- **FR-2 - Rule-id registry.** Every rule id the resolver can emit (today the literal
  strings passed as `rule:` in `next-task.ts`, e.g. `cycle.depends-on`,
  `depends_on.uncleared`, `coherence.*`) is declared once in an exported const union
  `ResolverRuleId`, and `next-task.ts` types its `rule` field against it, so an emitted
  rule that is not registered, or a registered rule that does not exist, fails `tsc`.
  Validator rule ids that a matrix cell cites are registered the same way.
- **FR-3 - The matrix as data.** `packages/shared` exports `DOC_TYPE_DEPENDENCIES`: one
  entry per **ordered** pair of `DocType` (including self-pairs such as spec → spec via
  `depends_on`), each with:
  `{ upstream, downstream, edge: <the frontmatter field or structural relation, or null>,
  class: 'gate' | 'dial' | 'informational' | 'none', severity?: SeverityClass,
  enforcedBy: ResolverRuleId[], gap?: { tracked: '#NNN' }, reason: string }`.
  The initial content is the audit table above, extended to every pair.
- **FR-4 - Completeness test (the gate).** A test fails, naming the offending cell, when
  any of these holds:
  1. an ordered pair of `DocType` has no entry, or has more than one;
  2. a `gate` cell has neither a non-empty `enforcedBy` nor a `gap.tracked` issue ref;
  3. a `gate` cell has no `severity`;
  4. a `none` or `informational` cell has an empty `reason`;
  5. a `gap` is present on a cell whose `enforcedBy` is non-empty (a stale gap marker).
- **FR-5 - Liveness of every enforcing rule.** For every rule id cited in `enforcedBy`,
  the test builds a minimal `ArtifactGraph` fixture that violates the cell and asserts
  the resolver emits a `NextTask` (or `Corruption`) carrying that exact rule id at the
  cell's declared `severity`. A cell may not satisfy FR-4.2 with a rule that never fires
  for it. (Without this, FR-4 passes on the strength of a string being present - the
  vacuous-pass failure mode.)
- **FR-6 - Adding a document type forces a decision.** Because FR-4.1 enumerates the
  runtime array from FR-1, adding a member to `DocType` turns the test red until a row
  **and** a column for it are declared. This is the prevention the issue asks for: a
  completeness critic over the meta-model, distinct from `/analyze` (which checks one
  feature's spec ↔ plan ↔ tasks).

### Part B - invariants → approvables, the first missing gate

- **FR-7 - Stable invariant ids.** Each constitution invariant carries a stable id
  `INV-N`, written in the constitution the same way goals carry `G-N` (DR-039).
  `parseConstitution` returns `{ id, text }` per invariant. An id is never reused or
  renumbered; a retired invariant keeps its id with a retired marker, as G-5 does. The
  validator reports a duplicate or missing invariant id as an error (it is structural).
- **FR-8 - Invariant fingerprints.** The fs-adapter (`artifact-graph.ts`) computes, per
  invariant, a canonical hash of its text (the same canonical-hash primitive approvals
  use; whitespace/wrap changes do not change it) and exposes the full set to the
  resolver as `ArtifactGraph.invariants: { id, hash, retired }[]`.
- **FR-9 - Approvals snapshot the invariants they were made against.** When a human
  approves a spec, or accepts a DR or epic (once SPEC-041 Slice 1 gives DRs and epics
  hash-locked records), the approval record stores the current invariant fingerprints in
  `upstreamDeps` (the DR-062 / SPEC-041 field) as refs `INV-N`. This is an **implicit**
  edge from every invariant to every approvable - no author writes it, so no author can
  forget it.
- **FR-10 - Invariant change ⇒ `upstream-stale`, surfaced as a gate.** On read, an
  approval whose recorded `INV-N` set differs from the current set (an invariant added,
  changed, or retired) derives `upstream-stale` with the reason naming the invariant(s).
  Through SPEC-041's existing rules this clears `gateCleared` for that artifact: an
  `implementing` artifact becomes a `gate-violation`, and a merely approved one floors
  its dependents. The signpost imperative names the invariant: *"INV-2 changed since
  SPEC-041 was approved - re-check it (Alt+A if immaterial)"*. Rule id:
  `invariant.changed-since-approval`.
- **FR-11 - Invariant changes need their own approval.** Editing the constitution's
  `## Invariants` section is a deliberate act, so the invariant set gets a hash-locked
  approval record (the DR-041 "constitution invariant" Approvable; the checkpoint SPEC-025
  deferred to #270). While the current invariant set does not match its approved hash,
  the resolver emits one `gate-violation` node, rule `invariant.unapproved-change`,
  targeting the constitution, ranked **above** every FR-10 node - re-checking specs
  against an invariant nobody approved yet is wasted work. A first-ever approval on an
  existing project is an ordinary pending task, not a gate-violation, so installing this
  feature does not flood the signpost.
- **FR-12 - Approvals made before this feature.** An approval record with no `INV-N`
  entries in `upstreamDeps` (every record that exists today) is **not** stale on that
  account. It is reported once, in the pipeline expansion (SPEC-012 FR-6), as "approved
  before invariant tracking" - an honest state, not a false stale and not a silent pass.
  (Decision D-3 below confirms this.)
- **FR-13 - Matrix rows for Part B.** The `invariant → spec`, `invariant → dr`,
  `invariant → epic` and `invariant → plan` cells cite `invariant.changed-since-approval`;
  the FR-11 checkpoint is cited on the `invariant → invariant` cell. FR-5's liveness test
  covers both rules.

### Part C - the other findings

- **FR-14 - Proposed DR → spec stays edge-gated, and the gap is made visible.** No new
  gate is added for prose-only DR links (DR-019 §7: real dependencies must be edges). The
  matrix records `dr → spec` as `gate`, enforced by `depends_on.uncleared`, with `reason`
  stating that a prose or `relates_to` link is informational by design. Whether to add a
  validator advisory for "body says the design rests on DR-NNN but frontmatter has no
  `depends_on` to it" is decision D-4.
- **FR-15 - Tracked gaps, never prose-only.** Every cell the audit leaves unenforced
  (`pr → *` via #182; the constitution Phases dial; dangling `goal:` refs; and any further
  cell the full-matrix pass in FR-3 surfaces) carries a `gap.tracked` issue number before
  the implementation merges. FR-4.2 makes a gate cell without one fail; for dial cells the
  same field is required by the test.

## Acceptance Criteria

- **AC-1 (FR-1, FR-3, FR-4.1).** The test enumerates `DocType` × `DocType` (81 ordered
  pairs) and finds exactly one matrix entry for each. Removing any entry turns it red with
  the pair named.
- **AC-2 (FR-4.2, FR-5).** Mutation check: deleting the emission of
  `coherence.spec-ahead-of-epic` from `next-task.ts` turns the liveness test red on the
  `epic → spec` cell; deleting that cell's `enforcedBy` turns FR-4.2 red. Both are run
  and recorded in the implementation PR.
- **AC-3 (FR-6).** Adding a tenth member to `DocType` with no other change fails the test
  and names every missing pair.
- **AC-4 (FR-2).** Changing one `rule:` literal in `next-task.ts` to an unregistered
  string fails `tsc` on `packages/shared`.
- **AC-5 (FR-7).** `parseConstitution` on this repo's constitution returns `INV-1`..`INV-3`
  with their full wrapped text; a constitution with two `INV-2` entries is a validator
  error naming both lines.
- **AC-6 (FR-9, FR-10).** Fixture: approve SPEC-A (records `INV-1..3` hashes); edit the
  text of INV-2; the resolver derives SPEC-A `upstream-stale` naming INV-2, and if SPEC-A
  is `implementing` the top task is a `gate-violation` with rule
  `invariant.changed-since-approval`. Re-wrapping INV-2's lines without changing words
  does **not** stale it. SPEC-A's approval sidecar bytes are identical before and after
  (DR-062 INV-1: derived, never mutating a sign-off).
- **AC-7 (FR-10).** Adding a new INV-4 stales every non-terminal approval made before it;
  retiring INV-3 does the same. A `done`/`archived`/`superseded` spec is not staled
  (see D-2).
- **AC-8 (FR-11).** Fixture: an approved invariant set, then an edit to INV-1 with no
  re-approval: the top task is `invariant.unapproved-change` targeting the constitution,
  ranked above every `invariant.changed-since-approval` node. A project with invariants
  but no invariant-approval record ever gets a `pending` node, not a gate-violation.
- **AC-9 (FR-12).** An approval record with no `INV-N` entries is not `upstream-stale`,
  and appears in the pipeline expansion as "approved before invariant tracking".
- **AC-10 (Tier-0, determinism).** No network or LLM call is reachable from
  `doc-type-dependencies.ts`, the invariant fingerprinting, or the resolver path; same
  fixture → byte-identical `NextTask` across repeated runs.
- **AC-11 (FR-15).** Every `gap` in the merged matrix carries a `#NNN` that resolves to an
  existing issue at merge time (checked by the reviewer; the test checks the shape).

## Invariants (must not break)

- **Constitution INV-1 (offline).** All matrix checks, fingerprinting and staleness are
  pure filesystem + frontmatter; nothing here calls the network.
- **Constitution INV-2 (no silent gate).** A gate cell with no live enforcing rule fails
  the test visibly (FR-4, FR-5); an unreadable constitution makes the invariant gate fail
  closed and visible ("state unclear - constitution unreadable"), never silently "no
  invariants".
- **Constitution INV-3 (blast radius).** Nothing here writes outside the project's own
  `.minspec/` store and spec/DR files.
- **DR-019 §1 / §6 - deterministic, one engine.** The matrix and both new rules are pure
  functions in `packages/shared`; no LLM judges whether an invariant is violated.
- **DR-019 §8 - structure only.** This spec gates on *approved against a changed
  invariant*, never on *content violates an invariant*. The semantic question stays with
  the human and advisory AI review.
- **DR-062 §4 - never mutate a sign-off.** Invariant staleness is derived on read; only a
  human re-acknowledge or re-approval writes a record.
- **SPEC-025 INV-2 - never overwrite human content.** Adding `INV-N` ids to an existing
  constitution is offered, confirmed, and additive; it never reorders or rewrites the
  invariant text.

## Decisions needed (Clarify)

- **D-1 - Severity placement of invariant gates.** DR-019 §2's total order is
  `(severity class, epic.order, goal-rank, priority, id)`; inside `gate-violation`, an
  invariant node could lose to an ordinary `depends_on.uncleared` on a better-ranked epic.
  - `a` **(rec)** Add a rule-severity sub-key as the first key *inside* `gate-violation`
    (invariant rules first, then the rest in today's order). Keeps four classes and every
    existing ordering outside that class. Cost: it amends DR-019 §2's tuple, so it needs a
    DR addendum and touches the resolver's sort, which every signpost test exercises.
  - `b` A fifth class `invariant-violation` above `gate-violation`. Clearest to read.
    Cost: every consumer that switches on `SeverityClass` (status bar, explorer, CI text)
    must learn a new member; a larger DR-019 change.
  - `c` No change; invariant nodes compete inside `gate-violation` on the existing dials.
    Cost: contradicts the issue's "top gate-violation class" and can rank a constitution
    change below routine work.
- **D-2 - Which approvals an invariant change stales.**
  - `a` **(rec)** Every non-terminal approval (specs not done/archived/superseded; DRs
    `accepted`; epics `active`). Invariants apply to everything, so a narrower set would be
    a silent pass. Cost: one invariant edit can stale dozens of artifacts at once; it rests
    on DR-062's bulk re-acknowledge being cheap.
  - `b` Only approvables that list the invariant in an explicit `invariants:` field.
    Cheap and quiet. Cost: model-trusted - an author who forgets the field is never
    re-checked, the exact "trust the model" shape constitution principle 8 rejects.
  - Terminal artifacts are excluded under either option; re-checking shipped work against
    a new invariant is the standing-set sweep, leg C, #804.
- **D-3 - Approvals made before invariant tracking.**
  - `a` **(rec)** Not stale; listed once as "approved before invariant tracking" (FR-12).
    Cost: those approvals were never checked against today's invariants either, and this
    accepts that until they are next re-approved.
  - `b` Treat as stale. Honest in the strict sense. Cost: on install, every approved
    artifact in the repo turns stale at once - a flood that trains rubber-stamping
    (constitution principle 2).
- **D-4 - Prose-only DR links.** Add a validator advisory when a spec's body says it
  rests on / implements DR-NNN but its frontmatter has no `depends_on` to it?
  - `a` **(rec)** Yes, advisory only, folded into #803's symmetric prose-link linter rather
    than a new linter. Cost: it inherits #803's timing, so the gap stays open until #803
    ships.
  - `b` Not in scope at all; the matrix `reason` documents the rule and that is enough.
    Cost: the partial gate stays partial, invisible to an author who used `relates_to`.
- **D-5 - Record the taxonomy as a DR.** The gate/dial/informational/none taxonomy and the
  rule "every gate cell names a live enforcing rule or a tracked gap" amend DR-019.
  - `a` **(rec)** A new DR amending DR-019 §2 (and recording D-1's outcome), authored in
    Plan with its id taken from `scripts/check-dr-id-collision.ts`, the way DR-039 amended
    DR-019. Cost: one more DR to read before Plan.
  - `b` No DR; this spec is the record. Cost: the severity-model change in D-1 would live
    only in a spec, which DR-019 §2 readers will not find.
- **D-6 - Is Part B (invariants) in this spec, or split?** Part A (matrix + test) is
  useful alone and ships no new staleness.
  - `a` **(rec)** Keep both in one spec, delivered as two slices: Part A first (it is the
    gate that keeps Part B's cells honest), Part B after SPEC-041 Slice 1 lands. Cost:
    this spec stays open until SPEC-041 ships, which it depends on.
  - `b` Split Part B into its own spec. Cost: two specs, and the matrix ships with its
    most important cell marked as a tracked gap.

## Vertical slices (ordering is load-bearing)

1. **Part A** - `DocType`, `ResolverRuleId`, `DOC_TYPE_DEPENDENCIES` with every cell
   classified, the FR-4/FR-5 completeness test, and the gap issues filed (FR-15). Ships no
   behaviour change to the signpost. The invariant cells are `gap` until slice 3.
2. **Stable `INV-N` ids** (FR-7) - parser, validator, and an offered additive migration of
   this repo's constitution.
3. **Part B** (FR-8 - FR-13) - needs SPEC-041 Slice 1 (ADR/epic hash records) and its
   `upstreamDeps` field. Turns the invariant cells from `gap` to `enforcedBy`.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | The completeness test passes vacuously: a string in `enforcedBy` that the resolver never emits for that cell | FR-5 liveness fixtures per cited rule; AC-2 mutation check recorded in the PR |
| R2 | An invariant edit floods the signpost with re-checks | FR-11 puts one constitution node first; DR-062 bulk Alt+A; D-2 states the cost |
| R3 | 81 cells is too many for a human to judge, so most are filled `none` carelessly | `reason` is mandatory on `none`; the AI review (DR-047) of the implementation PR reads the matrix; most cells are genuinely `none` and say why in a phrase |
| R4 | Part B depends on SPEC-041, which is `implementing` with `implement: pending` | Slices: Part A ships alone; Part B cells stay tracked `gap`s until then, which FR-4 accepts |
| R5 | `INV-N` ids collide with DR-053's `INV` paragraph code (an approvable's own invariants, e.g. SPEC-041 INV-1) | A bare `INV-N` inside a spec keeps meaning that spec's own invariant; every resolver imperative, validator message and `upstreamDeps` display says "constitution INV-N". How DR-053's grammar addresses a constitution paragraph is left to #679 |

## Out of scope

- Judging whether content violates an invariant (DR-019 §8 - no oracle; AI review stays
  advisory).
- Re-checking terminal artifacts against a new invariant - leg C standing-set sweep,
  [#804](https://github.com/AIClarityAU/minspec/issues/804).
- PR-review nodes in the resolver - [#182](https://github.com/AIClarityAU/minspec/issues/182);
  recorded as a tracked gap in the matrix, not built here.
- Building the `upstreamDeps` field or `upstream-stale` state - SPEC-041 owns them; this
  spec adds invariants as one more upstream.
- Fixing the constitution Phases dial and dangling `goal:` refs - recorded as tracked gaps
  (FR-15); they mis-rank but cannot make the signpost name an invalid action.
- Principles and constraints. They are "should" rules (principles may be bent with
  justification), so they are dials at most; the matrix may classify them in a later
  extension of `DocType`.

## Traceability

- Issue: [#270](https://github.com/AIClarityAU/minspec/issues/270); predecessor
  [#269](https://github.com/AIClarityAU/minspec/issues/269) / SPEC-025.
- Decisions: DR-019 (severity model, §2/§5/§7/§8), DR-062 (graph-aware approval validity),
  DR-041 amendment (constitution invariant is a human-gated Approvable), DR-039 (stable
  `G-N` ids, the pattern FR-7 copies), DR-047 (AI review is advisory), DR-053 (paragraph
  codes, R5). A DR amending DR-019 is proposed under D-5; none is minted by this spec.
- Depends on: SPEC-012 (resolver), SPEC-041 (`upstreamDeps`, `upstream-stale`).
