---
id: SPEC-080
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness — shared/background automation over a committed, multi-checkout truth
relates_to: [SPEC-012, SPEC-076]  # SPEC-012 owns the resolver this sweep reuses (FR-4 composes, never re-derives); SPEC-076 is the read-only headless-CLI precedent this sweep's write-adjacent sibling follows for root/marker handling
depends_on: [DR-057]
phases:
  specify: in-progress
  plan: pending
  tasks: pending
  implement: pending
---

# Drain-sweep second trigger — deterministic phase-advance enqueue

> Materializes [#734](https://github.com/AIClarityAU/minspec/issues/734), one of nine
> components filed with [DR-057](../../../docs/decisions/DR-057.md) under the umbrella
> [#712](https://github.com/AIClarityAU/minspec/issues/712) ("drain actions approved-doc
> phase-advance"). This spec covers **only** #734: the background scan + enqueue. It does
> not redesign DR-057's five rulings; it encodes the one piece of ruling §3 ("two triggers,
> one request") that is not yet built — the sweep half.

## One-Sentence Scope

Add a deterministic, LLM-free scan to the background drain (`scripts/drain-inbox.sh`'s
`run_cycle`) that finds every spec whose upstream phase is approved and whose
tier-required `tasks.md` is still absent, and enqueues the **same** `PhaseAdvanceRequest`
the Alt-A toast already writes — so an approval made outside the IDE, or made before a
live consumer existed, is not silently un-actioned.

## Context

### What already exists (read before building; do not re-derive)

Two of DR-057 §3's three triggers are already shipped:

- **The queue primitive** (`#731`) —
  `packages/minspec/src/lib/phase-advance-queue.ts`. `enqueuePhaseAdvance(rootDir,
  specRelPath, source)` writes a path-keyed, gitignored `PhaseAdvanceRequest` JSON file
  under `.minspec/queue/`, idempotently overwriting any existing request for the same
  spec. `PhaseAdvanceSource` is currently a one-member union, `'alt-a-toast'`
  (`phase-advance-queue.ts:25`).
- **The Alt-A toast** (`#733`) — `packages/minspec/src/commands/approve.ts`. On every
  `approveSpecCommand` run it shows a follow-up toast (or, once
  `minspec.advancePhaseOnApprove` is set, enqueues silently) and calls
  `enqueuePhaseAdvanceSafely(rootDir, specRel)` →
  `enqueuePhaseAdvance(rootDir, specRel, 'alt-a-toast')` (`approve.ts:172-180,
  369-397`). This trigger fires only on an approval performed **through the extension
  command** — a sidecar written by direct git (a teammate's commit, a script, a merge)
  never runs this code path, so no request is ever enqueued for it. That gap is this
  spec's reason to exist.
- **The readiness predicate itself already exists** and must not be re-derived
  (explicit issue instruction, "do NOT hand-roll a present-vs-missing scan" — recurring
  validator-asymmetry class, DR-003 Phase 4). `packages/shared/src/next-task.ts`'s
  `phase-action` node generator already computes exactly "approved, tier-required
  `tasks.md` missing" as the `missing-tasks` hole kind:
  - `if (s.approvalState !== 'approved') continue;` (`next-task.ts:841`) — the SPEC-022
    sidecar-hash-backed approval state, not the hand-editable literal `status:` line.
  - `if (s.phase !== 'tasks' && s.phase !== 'implement') continue;` (`next-task.ts:848`)
    — `s.phase` is computed by the fs-adapter from the spec's `phases:` map, which only
    ever reaches `'tasks'` for a tier whose `requiredPhases` includes it (T3/T4,
    `packages/minspec/src/lib/config.ts:113-114`). A T1/T2 spec's phase never becomes
    `'tasks'`, so the tier-required condition is already structural here, not a
    predicate this spec needs to add.
  - `const hole = s.implementHole;` / `hole.kind === 'missing-tasks'`
    (`next-task.ts:849, 863`) — the "doc absent" signal, computed once by the fs-adapter
    (`artifact-graph.ts`) and only consumed here.
  - The node this produces carries `evidence.rule === 'pending.implement-missing-tasks'`
    (`next-task.ts:892`, with `cls` always `'pending'` for this hole kind) — **an
    internal string, not a published contract**. Anyone implementing this spec MUST
    re-read `next-task.ts` at implement time rather than trust this citation to still be
    byte-identical (Evidence Discipline, CLAUDE.md "Mechanism claims need the same bar").
  - `resolvePipeline(graph): NextTask[]` (`next-task.ts:1157`) is the **full ranked
    queue** (FR-6) — already sorted by the resolver's own severity/priority order. This
    spec needs the full array, not `resolveNextTask`'s single top pick
    (`next-task.ts:1174`), because more than one spec can be sweep-ready in one cycle and
    all of them need enqueuing, not just the global #1.
  - `artifactFileIndex(rootDir): Map<string, string>` (`artifact-graph.ts:475`) resolves
    a bare `targetId` ("SPEC-080") back to its `requirements.md` file path — the same
    lookup `packages/minspec/src/commands/next-task.ts:61` already uses to open the
    file for the signpost click-through.
- **The "stale" half of readiness is explicitly a different, later issue.** DR-057's
  Risks table assigns "stale generated doc after an upstream edit" its own dedup
  mechanism "keyed on spec-path + upstream specHash" to **#738**, not here — and no
  `ImplementHole` kind for "tasks.md exists but is stale" exists in `next-task.ts` today.
  This spec's "ready" is therefore **absence only**; staleness detection and
  regeneration re-enqueue are explicitly #738's scope (see Out of scope).

### Why a sweep, not just the toast

The toast fires once, at the moment of an in-IDE approval. Three ways a spec can become
sweep-ready **without that moment ever happening**: (1) a sidecar is committed directly
(no extension involved — a teammate, a script, a cherry-pick), (2) the toast's own
non-blocking enqueue write fails silently in a way the user dismisses without reading the
warning toast (`approve.ts:189-192`), (3) `tasks.md` is deleted or never generated after
an approval that predates `#733` shipping. The sweep is the backstop DR-057 §3 names for
exactly this: "nothing slips un-actioned."

Triggered by: [#734](https://github.com/AIClarityAU/minspec/issues/734) (component of
[#712](https://github.com/AIClarityAU/minspec/issues/712)).
Implements: [DR-057](../../../docs/decisions/DR-057.md) §3 (second trigger).

## Requirements

- **FR-1 (reuse, never re-derive, the readiness predicate).** The sweep MUST determine
  "ready to advance" by calling `buildArtifactGraph(rootDir)` +
  `resolvePipeline(graph)` from the existing SPEC-012 engine and filtering the
  returned `NextTask[]` for nodes that are the `missing-tasks` phase-action class
  (today identified via `kind === 'phase-action'` plus the `evidence.rule` carrying
  `implement-missing-tasks` — confirm the exact string against `next-task.ts` at
  implement time, per the Context note above). It MUST NOT re-implement any of the
  approval-state check, the phase check, or the present/missing file check — those
  stay owned by `next-task.ts`/`artifact-graph.ts`. A future change to what counts as
  "ready" (e.g. the tier table, the approval-state definition) therefore changes in
  exactly one place and both the signpost and the sweep see it identically, the same
  one-engine property SPEC-012 FR-11 already guarantees for every other consumer.
- **FR-2 (enqueue the same request shape, a new source).** For every node FR-1
  selects, the sweep MUST resolve `targetId` → file path via `artifactFileIndex` →
  `specRelPath(rootDir, filePath)`, then call
  `enqueuePhaseAdvance(rootDir, specRelPath, 'drain-sweep')`. `PhaseAdvanceSource`
  (`phase-advance-queue.ts:25`) gains exactly one new member, `'drain-sweep'` — the
  request's shape (`specPath`, `requestedAt`, `source`) is unchanged, so a downstream
  consumer (#732, not built by this spec) never has to special-case which trigger
  produced a given file; `source` is provenance only.
- **FR-3 (idempotent, cheap to repeat).** `enqueuePhaseAdvance` already overwrites any
  existing request for the same spec path (one pending request per spec,
  `phase-advance-queue.ts:42-46`). The sweep MUST rely on that — it re-enqueues every
  still-ready spec on every cycle rather than tracking "already queued" state itself.
  A request already dequeued/consumed by #732 and a spec that is no longer ready (its
  `tasks.md` now exists, or its approval was revoked) simply drops out of FR-1's
  filtered set and is not re-enqueued.
- **FR-4 (honor DAG priority — sibling to #420).** The sweep MUST enqueue in the order
  `resolvePipeline` returns (severity class, then `epic.order` / goal-rank / priority /
  artifact-id), never re-sorted by issue number, spec id, or filesystem walk order. If
  a future per-cycle cap on how many requests to enqueue is introduced (mirroring
  `run_cycle`'s existing dispatch cap, `drain-inbox.sh:1139-1143`), it MUST take the
  top-N of this same order — the DR-057-cited failure #420 is a drain that ignores DAG
  order, and this sweep must not repeat it. v1 ships with **no cap**: every ready node
  enqueues every cycle (bounded naturally by corpus size; each is one small JSON
  write).
- **FR-5 (runs inside `run_cycle`, alongside Step 1 — non-fatal on failure).** The scan
  is a new step in `scripts/drain-inbox.sh`'s `run_cycle` (`drain-inbox.sh:958`),
  positioned alongside the existing inbox→agent-ready stage (Step 1,
  `drain-inbox.sh:1006`). A failure of this step (resolver throws, corrupted
  frontmatter, `.minspec/` missing) MUST be reported loudly (constitution invariant
  2 — no silent gate) and MUST NOT abort the rest of the cycle or count toward
  `MAX_CONSEC_FAIL` — this step is a convenience backstop, not a load-bearing read the
  rest of the cycle depends on (the same non-fatal contract Step 1's own triage
  failure already has, `drain-inbox.sh:1007-1018`, as distinct from Step 2's
  ready-query failure, which is load-bearing and does return 1).
- **FR-6 (Tier-0 inputs, no new side channel).** The scan reads only
  filesystem + frontmatter (via the existing adapters) and writes only
  `.minspec/queue/` entries (via the existing, already-reviewed `enqueuePhaseAdvance`
  write path). It makes no network call and runs no LLM — consistent with DR-057 §2
  ("the drain DETECTS + ENQUEUES; generation runs in a CC-session/dispatch consumer")
  and constitution invariant 1.
- **FR-7 (one repo per invocation; honors the `.minspec/` marker).** The sweep
  operates on the repo it is invoked in (the drain's own checkout), not a list of
  roots — unlike SPEC-076's headless reader, this is a producer embedded in one
  repo's own `run_cycle`, not a multi-project CLI. It MUST still refuse (log + skip,
  not silently report "nothing ready") a root with no `.minspec/` directory, for the
  same reason SPEC-076 FR-2 refuses by name rather than reporting an empty graph as
  "clear" (`scripts/next-task.ts:23-32`).

## Invariants (must hold)

- **INV-1 (no duplicate predicate).** The "ready to advance" determination exists in
  exactly one place — `packages/shared/src/next-task.ts`'s phase-action/`missing-tasks`
  generator. Grep-verifiable: the sweep's implementation contains no independent
  `fs.existsSync(...tasks.md...)` / approval-hash check of its own.
  (FR-1; recurring validator-asymmetry class.)
- **INV-2 (request shape identity).** A `PhaseAdvanceRequest` written by the sweep is
  structurally identical (`specPath`, `requestedAt`, `source` — only `source` differs
  in value) to one written by the Alt-A toast; a consumer reading `.minspec/queue/`
  cannot and need not branch on which producer wrote a given file except by `source`.
  (FR-2.)
- **INV-3 (never the generation itself).** The sweep enqueues; it never runs `/tasks`,
  never shells out to an LLM, never writes `tasks.md` itself. (FR-6; DR-057 §2, the
  Tier-0 air-gap.)
- **INV-4 (sweep failure is visible, never silent, never cycle-fatal).** A failure
  inside the sweep step always prints a loud, distinguishable warning line (constitution
  invariant 2) and always lets `run_cycle` continue to its remaining steps. (FR-5.)
- **INV-5 (DAG order preserved end to end).** The order the sweep enqueues in is a
  stable function of `resolvePipeline`'s own order — no re-sort, no cap that picks
  outside that order. (FR-4.)

## Acceptance Criteria

- [ ] **(FR-1, INV-1)** Given a fixture tree with one spec `approved`, `phase: tasks`,
  no `tasks.md`, the sweep enqueues a request for it; given the same fixture with
  `tasks.md` present, it does not. Both cases are proved by calling the sweep's
  entry point against the fixture, never by a hand-rolled existence check in the
  test asserting the production code took the same shortcut. The fixture's `status`
  must land in the `implementing` band (`next-task.ts:837` gates on it before the
  approval/phase checks above; the fs-adapter folds the `planning` band into
  `implementing`, so `phase: tasks` alone does not guarantee this).
- [ ] **(FR-1)** A spec that is `phase: tasks` but **not** approved (approval-state
  `unapproved`/`stale`) is never enqueued by the sweep, matching `next-task.ts:841`.
- [ ] **(FR-1)** A T1/T2 spec (tier whose `requiredPhases` excludes `tasks`,
  `config.ts:111-112`) is never enqueued regardless of its other fields — its `phase`
  cannot reach `'tasks'` under the existing fs-adapter, proved by a T1 fixture that
  would otherwise match every other condition.
- [ ] **(FR-2, INV-2)** The sweep's enqueue call for a ready spec produces a sidecar
  identical in shape to the toast's, differing only in `source: 'drain-sweep'` and
  `requestedAt`: the same spec path, enqueued once with `source: 'alt-a-toast'` (an
  existing `phase-advance-queue.test.ts` case) and once via the drain-sweep path, both
  resolve to the identical `.minspec/queue/<spec-path>.json` request path.
- [ ] **(FR-3)** Running the sweep twice in a row against an unchanged fixture leaves
  exactly one request file per ready spec (overwritten, not duplicated), with
  `requestedAt` advancing.
- [ ] **(FR-4, INV-5)** A fixture with two simultaneously-ready specs under different
  `epic.order` values is enqueued in `resolvePipeline`'s order, proved by reading the
  mtime or an injected sequence marker across the two writes.
- [ ] **(FR-5, INV-4)** A fixture that makes the resolver throw (malformed
  frontmatter) is proved to (a) print a warning distinguishable from a normal "nothing
  ready" line and (b) not prevent a subsequent step of the same `run_cycle` invocation
  from running (asserted against the real `run_cycle` shape, not a stand-in that
  assumes non-fatal without exercising the call order).
- [ ] **(FR-6)** The sweep step makes no network call and spawns no `claude`/LLM
  process — asserted the same way existing Tier-0 tests in this repo assert it (no
  reachable `fetch`/`http`/`child_process` call to a network tool from the sweep's
  module).
- [ ] **(FR-7)** Invoked against a directory with no `.minspec/`, the sweep logs a
  refusal and enqueues nothing, rather than silently proceeding as if the graph were
  empty.

## Decisions needed (Clarify)

- **Where exactly does the scan run — a new standalone script, or a flag/mode on an
  existing one?** `scripts/next-task.ts` is explicitly documented as read-only
  ("creates, modifies and deletes nothing in any root it is pointed at",
  `scripts/next-task.ts:42`) — giving it a side-effecting mode would break that
  contract for every existing caller (SPEC-076, any supervisor already relying on its
  read-only guarantee). **Recommendation: a new script**, e.g.
  `scripts/drain-sweep.ts`, importing the same `buildArtifactGraph` /
  `resolvePipeline` / `artifactFileIndex` triple rather than shelling out to
  `next-task.ts` and re-parsing its JSON. Cost: one more small script to maintain,
  versus reusing `next-task.ts`'s stdout contract and accepting a read-only module
  gaining a write mode (rejected above) or spawning a subprocess and parsing its
  output (an indirection with no benefit here, since both would run in-process in the
  same Node/tsx invocation `run_cycle` already uses for `rank-issues.ts`).
- **Per-cycle cap.** FR-4 ships with no cap in v1. If the live corpus ever produces a
  burst of simultaneously-ready specs large enough to matter (write cost, log noise),
  a cap may be worth adding later, mirroring `_dispatch_cap`
  (`drain-inbox.sh:1139-1143`). **Recommendation: defer** — no evidence yet that
  corpus size makes this a real cost, and premature capping risks silently deferring
  a ready spec with no visible signal (the same failure mode FR-4 exists to avoid for
  ordering). Revisit if #737 (queue-depth visibility) surfaces a real burst.
- **Cadence.** Does the sweep run every `run_cycle` (same cadence as inbox triage), or
  on a slower interval (since `tasks.md` readiness changes far less often than the
  inbox)? **Recommendation: every cycle**, for simplicity and because FR-3's
  idempotent overwrite makes a redundant run cheap; a slower cadence is an
  optimization with no correctness benefit and one more interval constant to tune and
  explain. Cost: a few extra cheap resolver runs per hour on an otherwise-idle repo.

## Out of scope

- **The consumer that dequeues and generates `tasks.md`** — [#732](https://github.com/AIClarityAU/minspec/issues/732), the doc-phase generation role. This spec only produces requests; nothing in it runs `/tasks` or any LLM.
- **Staleness detection / regeneration re-enqueue** — [#738](https://github.com/AIClarityAU/minspec/issues/738). This spec's "ready" is absence-only, matching what the existing resolver already computes; detecting an upstream-hash change after `tasks.md` already exists is explicitly #738's mechanism (dedup keyed on spec-path + upstream `specHash`).
- **Queue-depth visibility** — [#737](https://github.com/AIClarityAU/minspec/issues/737) — kept as written in DR-057; not this spec's concern.
- **`design.md` generation / the promote-only demotion banner** — [#736](https://github.com/AIClarityAU/minspec/issues/736). DR-057 §4 defaults `design.md` to authored/main-direct; this sweep therefore only ever targets `tasks.md` readiness (the `missing-tasks` hole), never `design.md`, until a repo has explicitly promoted it (a #736 concern, not this one).
- **The doc-lane PR terminal** (auto-merge on `ai-review:pass` → Alt-A) — [#735](https://github.com/AIClarityAU/minspec/issues/735). What happens to a generated `tasks.md` once #732 produces it is that spec's concern.
- **Any change to the next-task resolver's ranking, severity classes, or hole-kind set** — owned by SPEC-012; this spec only consumes `resolvePipeline`'s existing output.

## Traceability

- **Triggered by** [#734](https://github.com/AIClarityAU/minspec/issues/734), filed with [DR-057](../../../docs/decisions/DR-057.md) under umbrella [#712](https://github.com/AIClarityAU/minspec/issues/712).
- **Implements** DR-057 §3's second trigger ("A background drain-sweep … enqueues the SAME request for approvals made via direct git or after 'Always' was set").
- **Depends on** [#731](https://github.com/AIClarityAU/minspec/issues/731) (queue primitive) and [#733](https://github.com/AIClarityAU/minspec/issues/733) (Alt-A toast) — both already merged; this spec extends their output union, not their mechanism.
- **Composes, does not duplicate,** [SPEC-012](../SPEC-012-next-task-resolver/requirements.md)'s resolver (FR-4 there; FR-1 here).
- **Precedent for root/marker handling:** [SPEC-076](../SPEC-076-headless-signpost-reader/requirements.md) (read-only sibling; this spec is the write-adjacent one — it enqueues, never generates).
- **Hands off to** #732 (consumer), #735 (PR terminal), #736 (`design.md` promotion), #737 (visibility), #738 (staleness) — each out of scope here, each already filed.
