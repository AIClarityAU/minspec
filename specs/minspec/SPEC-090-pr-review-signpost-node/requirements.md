---
id: SPEC-090
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — same epic as SPEC-012, which this spec extends
depends_on: [SPEC-012]
relates_to: [SPEC-024, SPEC-030, SPEC-028, SPEC-032, DR-033, DR-004, DR-014, DR-057, "#182", "#183", "#172"]
# Ownership declared in Specify (SPEC-038 FR-1/FR-2), before approval mints a hash.
# NEW, not yet created — owned by this spec once it implements:
implements:
  - packages/shared/src/pr-review-node.ts
  - packages/shared/tests/pr-review-node.test.ts
# Modified, not owned (one owner per file) — SPEC-012 owns these; this spec adds a
# node source and a new ArtifactGraph field, it does not take over the resolver.
affects:
  - packages/shared/src/next-task.ts
  - packages/minspec/src/lib/artifact-graph.ts
  - packages/minspec/src/commands/next-task.ts
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — PR-Review Tasks in the Next-Task Signpost (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers **Decisions needed (Clarify)**, and approves it through the normal
> spec-approval gate before any code changes.

**Date:** 2026-10-01
**Triggered by:** [#182](https://github.com/AIClarityAU/minspec/issues/182) — *"if the
user chooses to approve via PRs, then ensure that PR approval tasks are included in
MinSpec's 'next human task' signpost."* Parked 2026-06-05 during the gate-placement
discussion ([DR-033](../../../docs/decisions/DR-033.md) §3, [#183](https://github.com/AIClarityAU/minspec/issues/183)).
**Epic:** [EPIC-002 Signpost Integrity](../../../docs/epics/EPIC-002-signpost-integrity.md)
**Extends:** [SPEC-012 Next-Task Resolver](../SPEC-012-next-task-resolver/requirements.md) —
this spec adds one node kind to that resolver's state model; it does not change the
engine's ranking rules or packaging.

## One-sentence scope

When the project's auto-merge gate mode holds a PR for a human (`pr-gate`, or a
`consequence-hybrid` PR the eligibility gate did not clear to merge unseen), the
Next-Task Resolver (SPEC-012) MUST be able to surface **"review PR #N"** as a
first-class human-task node — not only spec/plan/ADR approvals — so the signpost
never tells the human "nothing to do" while an agent-authored PR sits unreviewed.

## Context

### What already exists (read from code, not inferred)

- `packages/shared/src/next-task.ts:38-40` names this exact gap in its own header:
  *"FR-3b milestones, FR-15 LLM repair-escalation, **PR-review nodes (#182)**,
  analyze-gate / review-gate (#227) ... are out of this slice."* SPEC-012 shipped
  `epic-promote` / `spec-approve` / `adr-accept` / `phase-action` / `answer-OQ`
  (`NodeKind`, `next-task.ts:152`) and explicitly deferred the PR node kind to this
  issue. This spec is that deferred slice, not a new idea.
- The gate this issue calls "gate = PR" is, concretely, `AutoMergeMode` —
  `'pr-gate' | 'consequence-hybrid'` (`packages/minspec/src/lib/auto-merge.ts:60`).
  `pr-gate` means **every** PR holds for a human skim regardless of blast
  (`auto-merge.ts:419-425`, DR-033 C4 kill-switch); `consequence-hybrid` auto-merges
  **low-blast** PRs and still holds **high-blast** ones for the human (DR-033 §3). A
  third mode, `plan-gate`, is named in [#183](https://github.com/AIClarityAU/minspec/issues/183)
  but deferred — `SPEC-030:61` confirms it is not implemented. The issue's "gate =
  plan-approval + auto-merge" phrasing predates this vocabulary; DQ-1 below maps it
  onto the real enum rather than guessing a new one.
- SPEC-012's resolver is a **Tier-0, no-network pure function**
  (`next-task.ts:1-17`, FR-11, FR-1) consumed identically by the status-bar signpost,
  explorer rollup, and CI/`npm run validate`. Open-PR state (review decision,
  mergeable, checks, draft) exists **only on the git host** — it cannot be read by a
  pure filesystem+frontmatter function. This is almost certainly *why* SPEC-012
  deferred it rather than an oversight, and it is the central design problem this
  spec has to solve (see FR-2).

### Why this isn't a SPEC-012 rewrite

SPEC-012's own "Costly to Refactor" list (`requirements.md` #3) names the severity-class
set/order and (#4) the `packages/shared` pure-function signature as expensive-to-move
seams. Adding a **new node kind** that plugs into the existing `SeverityClass` /
`ArtifactGraph` shape is cheap (SPEC-012's own text: *"adding a new edge/node kind
later is cheap; changing an existing one is a corpus migration"* — said of FR-13's
edge vocabulary, the same shape of claim applies to `NodeKind`, an open string union
already grown once for `answer-OQ` per `next-task.ts:152`'s comment trail). This spec
is additive to SPEC-012, not a revision of it.

## Functional Requirements

- **FR-1 (new node kind: `pr-review`).** `NodeKind` gains `'pr-review'`
  (`next-task.ts:152`). A `pr-review` node is pending when all of: the PR was opened
  by the dispatch/agent-executor identity (DQ-3), the PR is not a draft, the PR is
  still open, and DQ-2's "does this PR need a human eyeball" predicate is true for
  the project's resolved `AutoMergeMode` (DQ-1). It is cleared when the PR's review
  decision resolves (approved / changes-requested is itself the "task done" signal —
  per CLAUDE.md's repo-local funnel note, clearing is *leaving a review decision*,
  never *merging*; the merge keystroke is a separate, often gated, concern — DR-061,
  this repo's own PR funnel) or the PR closes.

- **FR-2 (PR state enters through a cached witness, never a live call inside the
  resolver).** The resolver itself MUST remain Tier-0 / no-network (SPEC-012 FR-1,
  FR-11; constitution invariant 1). Open-PR data is produced by a separate,
  **consent-gated** harvester (out of this spec's `implements:` — a follow-up, see
  Out of scope) that writes a local, versioned-away-from-git cache (shape: PR number,
  title, author, `isDraft`, review decision, mergeable, checks status, head branch,
  `fetchedAt`). `packages/minspec/src/lib/artifact-graph.ts` reads that cache the same
  way it reads frontmatter today, and hands the resolver a plain `PrReviewCandidate[]`
  on `ArtifactGraph` — the resolver only ever sees already-fetched data. This mirrors
  SPEC-032's `git fetch`-then-pure-classify split (`SPEC-032:75-88`): the network step
  is isolated and consent-gated; everything downstream is a pure function of what it
  fetched.

- **FR-3 (missing or stale witness fails visibly, never silently — constitution
  invariant 2).** If the PR-state cache is absent, unreadable, or older than a
  plan-time threshold, the resolver MUST NOT report "nothing pending" for PR review —
  that would be exactly the silent-gate shape the project's invariant 2 forbids (a
  broken harvester making the signpost say "all clear" while PRs rot unreviewed). It
  MUST instead route through SPEC-012 FR-10's honest-degradation path ("state unclear
  — PR data stale/missing, last fetched <time>") whenever `AutoMergeMode` resolves to
  a mode that has any pending agent-authored PR obligation at all. A correctly
  fetched **empty** list (zero open agent PRs) is the distinct, legitimate "nothing
  pending" case (SPEC-012 Failure-Mode #3) — the two must not be conflated.

- **FR-4 (severity class: `blocked-ready`).** A pending `pr-review` node ranks as
  **blocked-ready** (SPEC-012 FR-2 class 2) — structurally the same shape as
  `spec-approve`: a gate whose clearance unblocks the next phase (the branch's
  merge), with no further SDD-tree work implied. It is never a `gate-violation`
  purely for existing (an unreviewed PR is expected, ordinary pending work, not an
  invariant breach); within-class ordering follows the usual
  `(epic.order, goal-rank, priority, artifact-id)` tie-break (FR-5).

- **FR-5 (weight dials inherited, PR number as the tie-break id).** A PR rarely
  carries its own `epic.order`/`priority` frontmatter. The node's weight dials MUST be
  inherited from the issue or spec the PR's branch name / body references (the
  existing `agent/issue-N` branch convention, `scripts/dispatch-issue.sh`), falling
  back to the project default when no traceable link exists. The `artifact-id` used
  for FR-14's deterministic tie-break is `PR#<number>` (e.g. `PR#1234`), which sorts
  by number exactly like SPEC/DR ids sort by theirs.

- **FR-6 (derivation, FR-7's evidence contract).** A `pr-review` next-task MUST carry
  the same `Evidence` shape every other node does (`next-task.ts:154-162`): `rule`
  (e.g. `'pr-review.awaiting-human'`), a human-readable `explanation` ("PR #1234
  (feat(#977): …) is open, checks green, awaiting your review — gate mode: pr-gate"),
  and `refs` naming the PR and, when traceable, the issue/spec it implements.

- **FR-7 (two queues preserved — SPEC-012 INV, FR-8).** A `pr-review` node is a
  **human** task (the human must leave a review decision) even though the PR itself
  was agent-authored. It MUST NOT be confused with, or replace, any agent/dispatch
  work-queue entry — the PR's existence is agent output; the pending *decision* on it
  is human input. No test may assert a `pr-review` node disappears merely because the
  dispatch pipeline is "working on" the branch.

- **FR-8 (no-op when nothing is held for a human).** When `AutoMergeMode` resolves
  such that DQ-2's predicate is false for every open agent PR (e.g. all are low-blast
  under `consequence-hybrid` and already eligible), the resolver emits zero
  `pr-review` nodes — a legitimate empty set (FR-3's second case), not a degraded
  state.

## Acceptance Criteria

- **AC-1.** Fixture: one open, non-draft, agent-authored PR, no review decision yet,
  `AutoMergeMode = 'pr-gate'`, fresh PR-state cache. Resolver emits a `pr-review`
  next-task naming that PR, class `blocked-ready`, imperative "Review PR #N". (FR-1,
  FR-4, FR-6)
- **AC-2.** Same PR, but `isDraft: true`. No `pr-review` node is emitted for it.
  (FR-1)
- **AC-3.** PR-state cache missing entirely, `AutoMergeMode = 'pr-gate'`. Resolver
  emits SPEC-012 FR-10's "state unclear" result, not an empty/clean signpost. (FR-3)
- **AC-4.** PR-state cache present but `fetchedAt` older than the plan-time
  staleness threshold. Same "state unclear" result as AC-3, naming the stale witness.
  (FR-3)
- **AC-5.** Zero open agent-authored PRs, cache fresh and well-formed. Resolver
  reports the legitimate empty case — distinct from AC-3/AC-4 — and, if no other node
  is pending anywhere in the graph, SPEC-012's clean "nothing pending" result. (FR-3,
  FR-8)
- **AC-6.** Two fixtures differing only in `AutoMergeMode`
  (`'pr-gate'` vs `'consequence-hybrid'`) over the same low-blast-eligible PR: under
  `pr-gate` a `pr-review` node is emitted; under `consequence-hybrid` with the PR
  eligibility-gate-cleared, it is not (per DQ-2's chosen answer — this AC's expected
  output is pinned once DQ-2 resolves). (FR-1, FR-8)
- **AC-7.** A human-authored PR (not opened by the dispatch identity) with no review
  decision. No `pr-review` node is emitted for it under the v1 scope (DQ-3). (FR-1)
- **AC-8 (regression, SPEC-012 FR-8).** A fixture graph with one `pr-review` node and
  one unrelated agent-dispatch-queue item (if such a fixture type exists in the
  shared test harness) proves the dispatch item is never emitted as a next-task —
  INV — Two Queues holds with the new node kind present.
- **AC-9.** A fixture where the resolved `artifact-id` for the PR ties with another
  node's priority band: the deterministic-arbitrary pick (FR-14) uses `PR#<number>`
  exactly as it uses `SPEC-NNN`/`DR-NNN` — no special-casing that breaks the existing
  tie-break comparator.

## Invariants (must hold)

- **INV-1 (reuses SPEC-012 INV — Determinism / Tier-0).** The resolver's own code
  path makes no network call; all PR data arrives pre-fetched via the FR-2 cache.
- **INV-2 (constitution invariant 1 — consent).** The network call that populates the
  PR-state cache requires the same kind of explicit, already-established consent the
  project uses elsewhere for git-host calls (`gh` auth, the dispatch pipeline's
  existing credentials) — this spec introduces no new *unconsented* network surface.
- **INV-3 (constitution invariant 2 — no silent gate, FR-3).** A missing/stale/errored
  PR-state witness fails the "nothing pending" read closed, not open.
- **INV-4 (reuses SPEC-012 INV — Two Queues, FR-7).** The human task is "review this
  PR"; the agent task "write/update this PR" remains a separate, un-conflated queue.
- **INV-5 (reuses SPEC-012 INV #5 — override wins).** A human may dismiss a
  `pr-review` next-task exactly like any other; the dismissal sticks until PR state
  changes (new commit, new review request, etc.).

## Decisions needed (Clarify)

### DQ-1 — Which config value is "gate = PR"?

The issue was written before `AutoMergeMode` existed; it says "gate = PR" vs
"gate = plan-approval + auto-merge."

- **Option A — reuse `AutoMergeMode` verbatim (rec).** One setting drives both
  "does this PR auto-merge" (SPEC-024/030, already shipped) and "does this PR owe a
  human a signpost entry" (this spec). *Cost:* couples the signpost to a setting
  that today is resolved per-CLI-invocation (`scripts/auto-merge-gate.ts --mode`,
  `:62`) rather than as one persisted, extension-readable project value; the
  read path the VS Code extension uses must be defined at Plan, and if the two
  call sites (gate script vs. extension) ever resolve the value differently, the
  signpost and the merge gate could disagree about which PRs are "pr-gate".
- **Option B — a new, independent `signpost.prReviewGate` setting.** Decoupled from
  auto-merge entirely. *Cost:* two settings that answer overlapping questions can
  drift (a user sets one and not the other, and the signpost disagrees with what
  actually happens on merge) — the exact "surfaces disagree" risk SPEC-012 R3 names
  for the resolver itself, just moved one layer out.

### DQ-2 — Does `consequence-hybrid` ever still need a `pr-review` node?

DR-033 §3 holds **high-blast** PRs for a human even under `consequence-hybrid`; only
**low-blast** PRs auto-merge unseen. The issue's literal text ("no-op when gate =
plan-approval + auto-merge") reads as "never surface under hybrid," which would hide
exactly the high-blast PR DR-033 commits to showing a human.

- **Option A — surface whenever the auto-merge **eligibility** gate (SPEC-024) did
  not clear the PR to merge unseen (rec).** Correct to DR-033's actual behavior
  under both modes. *Cost:* this spec's resolver input must also read SPEC-024's
  eligibility verdict (another witness, another FR-3-shaped staleness question) —
  more surface than the issue asked for.
- **Option B — the issue's literal reading: no-op under `consequence-hybrid`
  regardless of blast.** Simpler, one input (`AutoMergeMode` alone). *Cost:*
  reproduces the "signpost says nothing to do" failure for high-blast
  `consequence-hybrid` PRs that DR-033 explicitly intended a human to see — the
  same class of bug the issue itself is filed to prevent, just relocated.

### DQ-3 — Which PRs count as "authored by the auto-build loop"?

- **Option A — filter by the dispatch bot/agent identity only (rec, matches the
  issue's wording exactly).** A human's own PR is out of v1 scope — consistent with
  SPEC-028 OQ-3's ruling that human-authored branches get different (forever-HITL)
  treatment, not this resolver's job. *Cost:* a human working their own PR gets no
  signpost help from this feature (arguably fine — they already know their PR
  exists).
- **Option B — every open PR regardless of author.** More complete signpost
  coverage. *Cost:* widens scope beyond what #182 asked for, and risks surfacing a
  human's own in-progress PR as a "task" before they're ready for review — noisy.

### DQ-4 — Where does the consent-gated PR-state harvester live, and its refresh cadence?

Not this spec's `implements:` (see Out of scope) but the contract (FR-2/FR-3) is
unusable without naming an owner.

- **Option A — an explicit, on-demand "MinSpec: Refresh PR State" command (rec).**
  Matches the project's existing consent pattern for other network-adjacent features
  (SPEC-057's prompt/always consent model). *Cost:* a dev who never runs it gets a
  permanently stale — but per FR-3, visibly stale, never silently wrong — cache.
- **Option B — a scheduled GitHub Action writes the cache into the repo /
  workflow artifact.** Always fresh without a manual step. *Cost:* a new CI
  surface + schedule to maintain, and the local VS Code extension then needs a way
  to read a CI-produced artifact rather than a local file — more moving parts.

## Why no new DR

The DR-359 filter: can this be undone in under a day? The new `NodeKind` member and
`ArtifactGraph` field are an additive, revertable code change (delete the field +
call-sites). The Tier boundary this spec relies on — Tier-0 resolver stays
network-free, a separate consent-gated step owns the network call — is not a new
architectural choice; it is DR-004/DR-014's tier map and DR-057's "no network/LLM
inside Tier-0" precedent, applied to a new input, not revised. No existing DR
addresses PR data as a resolver input, so there is nothing to amend either.
`docs/decisions/INDEX.md` has no entry for this; if Clarify's DQ-1/DQ-2 answers turn
out to require a genuinely new, hard-to-reverse setting shape, revisit this section.

## Out of scope

- **Building the PR-state harvester** (DQ-4) — a separate follow-up; file a GitHub
  issue on `AIClarityAU/minspec` once Clarify answers DQ-4 (not yet filed by this
  dispatch — no network available to this dispatch to create it).
- **Changing `AutoMergeMode` / SPEC-024's eligibility gate themselves** — this spec
  only *reads* their resolved values (DQ-1/DQ-2); it does not alter merge behavior.
- **The `plan-gate` mode** named in #183 — deferred with SPEC-030, not implemented;
  this spec's FRs are written against `pr-gate` / `consequence-hybrid` only and will
  need a follow-up once `plan-gate` ships.
- **Rendering/UX** of the `pr-review` entry in the status-bar signpost or explorer
  rollup — SPEC-012's own "Out of scope" already reserves visual design for a
  downstream UX spec; this spec hands it one more node kind to render, nothing more.
- **This repo's own merge-funnel convention** (CLAUDE.md "Merge asks in THIS repo") —
  a prose rule for sessions reporting PR state in chat, unrelated to what the
  Tier-0 resolver computes or emits.

## Dependencies & Blast-Radius

**Consumes:** [SPEC-012](../SPEC-012-next-task-resolver/requirements.md) — the
`NodeKind`/`ArtifactGraph`/`Evidence` shapes and the ranking engine (FR-2, FR-14,
FR-15) this spec plugs a new node source into, without reimplementing them (mirrors
SPEC-012 FR-4's own rule against duplicating SPEC-010). [SPEC-024](../SPEC-024-auto-merge-eligibility/requirements.md)
and [SPEC-030](../SPEC-030-automerge-default/requirements.md) — the `AutoMergeMode`
value and (if DQ-2 picks Option A) the eligibility verdict this spec reads.

**Blast-radius:** Adding a `NodeKind` member and an `ArtifactGraph` field is additive
to SPEC-012's shape — existing consumers that do not know about `'pr-review'` keep
working (an unhandled union member they don't pattern-match on simply never appears
in their output) **provided** the resolver's internal switch/exhaustiveness checks
are updated everywhere SPEC-012's "Costly to Refactor #4" names (`packages/shared`
signature, all 4 consumers) — a missed call-site would mean `pr-review` nodes
silently never rank, which is itself the FR-3 failure shape. Plan phase MUST
enumerate every exhaustive switch over `NodeKind`/`SeverityClass` in `next-task.ts`
and `artifact-graph.ts` as a checklist.

## Rollback / Reversibility

Fully additive and reversible in under a day: delete the `'pr-review'` `NodeKind`
member, the `ArtifactGraph.pullRequests` field (name TBD at Plan), and their
call-sites; SPEC-012's existing four node kinds are untouched. The FR-2 cache file,
if the harvester (DQ-4) already exists, is inert extra data with no other reader —
removing the resolver's consumption of it does not require deleting the file.

## Test plan (for the Plan phase to place)

1. AC-1/AC-2/AC-5/AC-6/AC-7: fixture `ArtifactGraph` + `PrReviewCandidate[]` inputs
   to the pure resolver, in `packages/shared/tests/pr-review-node.test.ts` —
   SPEC-012's existing fixture-in/expected-out style (T0).
2. AC-3/AC-4: fixture with a missing/stale cache timestamp, asserting the FR-10
   "state unclear" path is taken, reusing SPEC-012's existing degradation test
   shape rather than inventing a second one.
3. AC-8: extend SPEC-012's existing Two-Queues fixture (wherever it lives today)
   with a `pr-review` node alongside a dispatch-queue item.
4. AC-9: extend SPEC-012's existing FR-14 tie-break fixture with a `PR#` id in the
   mix.
Every test is run against the pre-feature code first to confirm it is red (no
`pr-review` kind exists yet), per this project's general pinning-test convention.
