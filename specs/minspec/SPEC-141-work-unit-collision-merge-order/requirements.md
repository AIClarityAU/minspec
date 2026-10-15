---
id: SPEC-141
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - two open changes presented as independent when they collide is a signpost that lies by omission; cross-listed with EPIC-009 (Team Readiness, concurrent sessions)
aspects: [signpost, next-task, merge-order, file-overlap, worktree, pull-request, stacked-branch, dependency, tier-0, offline, determinism, never-wrong, no-silent-gate]
depends_on: [SPEC-012]  # SPEC-012 owns the next-task resolver whose edge model (depends_on gating + cycle detection) this extends from artifacts to in-flight changes
relates_to: [SPEC-044, SPEC-076, SPEC-085, SPEC-026, DR-019, DR-038, DR-085, DR-071, DR-050, DR-004, DR-046, "#304", "#283", "#280", "#181", "#168", "#176", "#182", "#265"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). All five files are
# NEW and needed under the recommended answer to every question below: the pure collision
# core and its test, the git adapter that builds its input and its test, and the headless
# report. If DQ-2 is answered (b) or (c), Plan adds the signpost files to `affects:` before
# approval rather than after.
implements: [packages/shared/src/work-overlap.ts, packages/shared/tests/work-overlap.test.ts, packages/minspec/src/lib/work-units.ts, packages/minspec/tests/work-units.test.ts, scripts/merge-order.ts]
# Modified, not owned: the shared barrel gains one export line; the root package.json gains
# one `merge-order` script line, the same shape as the existing `next-task` line.
affects: [packages/shared/src/index.ts, package.json]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-141: Open changes that edit the same file are shown as colliding, with a merge order, not as independent

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers or accepts the questions under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the
> normal spec-approval gate before any code changes. Every requirement below is written
> under each question's recommended option, so approving the spec as it stands accepts
> those recommendations. Choosing a different option changes only the requirements that
> question names.

Materializes **[#304](https://github.com/AIClarityAU/minspec/issues/304)**. Design rests
on **[DR-019](../../../docs/decisions/DR-019.md)** (priority is a deterministic DAG, never
an LLM judgement), **[DR-038](../../../docs/decisions/DR-038.md)** (pull requests are
first-class nodes of the one graph, absorbing #182), and
**[DR-085](../../../docs/decisions/DR-085.md)** (the signpost carries only acts the human
can discharge). No new decision record is minted at Specify: the only choice here that
could not be undone in a day is opening a network lane, and that is held open as DQ-1
for the human, with the recommended option opening none.

## In plain terms

Two pieces of work in flight at once can each be fine on their own and still collide
when the second one merges, because they changed the same file. MinSpec does not notice
this today. It knows that one spec depends on another, but it knows nothing about
branches, worktrees or pull requests stepping on each other. On this repo, #283 and #280
both edited `scripts/validate-frontmatter.ts`; the clash was found only by someone
partitioning the batch by hand.

This spec adds three things. First, a check that lists the files each open change
touches and reports every pair that share a file. Second, a merge order: which changes
can go in first without touching each other, and which ones will need a rebase after,
and on which files. Third, ordering that follows from how branches were made: if B was
branched from A, B must not go in before A. It also reads an ordering the author states
on purpose.

By default it reads only what is already on this machine: your worktrees and your git
history. It makes no network call. It never says two changes are safe together. It can
only say they touch no common file, and it says when it could not find out.

## One-Sentence Scope

Add a deterministic, offline, pure core that takes the set of in-flight changes (each
with a base, a head and its changed-path set) and returns their file-overlap pairs,
their forced orderings (stacked branches and declared dependencies, with cycles
reported) and a batched merge order with per-change rebase warnings, plus a git adapter
that builds that input from the local worktrees and a headless `npm run merge-order`
report. It does not add a merge node to the next-task signpost's ranking (DQ-2) and does
not add any network fetch (DQ-1).

## Context - what exists today (read from this worktree's base, not inferred)

- **The resolver models artifact edges only.** `packages/shared/src/next-task.ts:61`
  declares `EdgeKind = 'depends_on' | 'supersedes' | 'relates_to'`, edges whose ends are
  artifact ids. Cycle detection walks only the gating kinds (`next-task.ts:395`,
  `depends_on` and `supersedes`). `ArtifactGraph` (`next-task.ts:156`) holds epics,
  specs and ADRs, and has no node for a branch, a worktree or a pull request.
- **PR nodes are deferred by name.** The resolver's own header lists "PR-review nodes
  (#182)" as out of its slice (`next-task.ts:39-41`). DR-038 §1 absorbs #182 into the
  unified graph as a node kind, but that graph is not built.
- **The signpost's membership rule.** DR-085 §1 admits a node only if the human can
  complete it from the editor without delegating. Its §3 keeps DR-019's ranking intact
  and changes only which nodes enter.
- **Worktree enumeration already exists, offline.** `listWorktreeRoots`
  (`packages/minspec/src/lib/presence.ts:342`) runs `git worktree list --porcelain` and
  falls back to the primary root on any git failure. That fallback suits presence, but
  is the wrong failure direction for this spec (FR-9).
- **The only network seam is `gh`.** `packages/minspec/src/lib/github.ts:11-26` runs the
  `gh` CLI. Listing open pull requests needs it. Under DR-050 and DR-071 that is a
  consent-gated network action (constitution invariant 1), and SPEC-085 had to
  retrofit consent onto a panel that called `gh` without asking.
- **The consumer that sequences merges here is SPEC-044 FR-4b.**
  `specs/minspec/SPEC-044-coordinated-self-completing-sessions/requirements.md:229`
  gives one driver branch updates and merge confirmation, and its open question 2 asks
  for a priority function "computable without an LLM". Today the batch's
  path-disjointness is checked by hand (CLAUDE.md, *Merge asks in THIS repo*). This spec
  supplies that computation as an input. It does not edit SPEC-044, which is approved
  and hash-locked; any edit would stale its approval.

## Terms

- **Work unit** - one in-flight change: a git worktree's checked-out branch (default
  source), a local branch, or (only under DQ-1 (b)) an open pull request. Identified by
  a stable string id (`worktree:<abs-path>`, `branch:<name>`, `pr:<number>`).
- **Changed-path set** - the paths a work unit changes relative to the point where it
  left its base: `git diff --name-only --no-renames <base>...<head>`. `--no-renames` makes
  a rename list both the old and the new path, so a rename on one side and an edit on
  the other still collide.
- **Overlap** - two work units on the same base whose changed-path sets share at least
  one path. This is a *conflict risk*, not a confirmed conflict.
- **Stacked** - unit B's head contains unit A's head, and A's head is not yet in the
  base, so B carries A's commits.
- **Declared dependency** - an ordering the author states on purpose (format: DQ-3).
- **Batch** - a set of work units with no overlap among them and no forced ordering
  among them.

## Contract (Tier-0 core, `packages/shared/src/work-overlap.ts`)

Plan may rename fields. It must keep the shape: the input carries "unknown" explicitly,
and the output never folds unknown into disjoint.

```ts
export type WorkUnitKind = 'worktree' | 'branch' | 'pr';

export interface WorkUnit {
  id: string;                    // 'worktree:/abs/path' | 'branch:agent/issue-283' | 'pr:283'
  kind: WorkUnitKind;
  base: string;                  // base ref name the unit targets, e.g. 'main'
  baseCommit: string;            // the base commit measured against (named in every report)
  headCommit: string;
  /** null = could not be computed; NEVER treated as the empty set. */
  changedPaths: string[] | null;
  /** Paths dirty in the worktree but not committed (worktree units only). */
  uncommittedPaths?: string[];
  /** Ids of other units whose head is an ancestor of this unit's head (adapter-computed). */
  stackedOn?: string[];
  /** Ids this unit declares it must merge after (DQ-3 format, adapter-parsed). */
  declaredAfter?: string[];
  /** undefined = readiness unknown (offline default); never assumed true. */
  ready?: boolean;
}

export type CollisionEdge =
  | { kind: 'overlaps'; a: string; b: string; paths: string[]; uncommittedOnly: boolean }
  | { kind: 'stacked_on'; from: string; to: string }        // from must merge after to
  | { kind: 'declared_after'; from: string; to: string };   // from must merge after to

export interface MergePlan {
  batches: string[][];                       // batch 0 merges first
  rebaseAfter: Record<string, { after: string[]; paths: string[] }>;
  unknown: string[];                         // units whose changedPaths was null
  cycles: string[][];                        // forced-order cycles; members get no position
  measuredAgainst: Record<string, string>;   // base -> baseCommit
}

export function computeCollisions(units: WorkUnit[]): CollisionEdge[];
export function planMergeOrder(units: WorkUnit[]): MergePlan;
```

## Functional Requirements

### Detection (issue ask 1)

- **FR-1 - Pure core.** `computeCollisions` and `planMergeOrder` MUST be pure functions
  of their input, held to the same rule as `next-task.ts`: no `vscode`, no `fs`, no
  `child_process`, no network, no `Date`, no `Math.random`, no LLM. The same input,
  presented in any order, MUST give the same output. Every output array is sorted by id
  or by path.
- **FR-2 - Overlap edges.** For every pair of units with the same `base` and with both
  `changedPaths` non-null, the core MUST emit one `overlaps` edge when the two sets share
  a path. The edge MUST carry the shared paths, sorted. A pair with different bases is
  never compared. A pair already linked by `stacked_on` gets no `overlaps` edge, because
  the stacking already explains the shared paths and already fixes the order.
- **FR-3 - Conservative path comparison.** Two paths MUST count as shared when they are
  byte-equal, when they differ only in letter case (they collide on a case-insensitive
  checkout), and when one is a directory prefix of the other, as in `a/b` against
  `a/b/c` (one side adds a file where the other has a directory). Over-reporting here
  costs one extra warning. Under-reporting is the defect this spec exists to remove.
- **FR-4 - Uncommitted paths.** When a worktree unit has `uncommittedPaths`, they MUST
  join the comparison. An edge produced only by uncommitted paths MUST be marked
  `uncommittedOnly: true` and worded as "work in progress may collide", never as a
  merge conflict.
- **FR-5 - Unknown is never disjoint.** A unit whose `changedPaths` is `null` MUST
  appear in `MergePlan.unknown`, MUST NOT appear in any batch, and MUST NOT be reported
  as free of overlap with anything. The report says it could not be measured, and why
  (FR-9).

### Merge order (issue ask 2)

- **FR-6 - Forced orderings first.** `stacked_on` and `declared_after` edges are gating,
  like `depends_on` in `next-task.ts`. A unit MUST NOT be placed in a batch before or
  alongside any unit it must follow. A cycle among forced orderings MUST be reported in
  `MergePlan.cycles` with its members named. It is detected with the same
  non-recursive three-colour walk `next-task.ts` uses (detect only, never repaired), and
  cycle members get no batch.
- **FR-7 - Batching rule.** Batches MUST be built greedily: from the units whose forced
  predecessors are all already placed, pick a batch with no overlap inside it, choosing
  in the order (1) `ready === true` before unknown or false, (2) fewer overlap partners
  first, (3) id ascending. Repeat until every unit not unknown and not in a cycle is
  placed. Rule (2) exists because merging the change that overlaps the most others
  first forces every one of them to rebase. Merging its partners first forces one
  rebase, its own. The report MUST call this a heuristic that reduces rebases, and MUST
  NOT claim the order is optimal.
- **FR-8 - Rebase warnings, honestly worded.** For each unit in a later batch that
  overlaps a unit in an earlier batch, `rebaseAfter` MUST name those earlier units and
  the shared paths, rendered as "merging A first means B needs a rebase on: p1, p2". The
  report MUST also say that units in one batch share no *file*, and nothing more. They
  can still break each other semantically, and if the base requires branches to be up
  to date, each later merge still needs a branch update. The words "safe",
  "independent" and "conflict-free" MUST NOT appear in any output.

### Inputs (the adapter, `packages/minspec/src/lib/work-units.ts`)

- **FR-9 - Build units from local git only, failing visibly.** The adapter MUST build
  one unit per worktree from `git worktree list --porcelain`, skipping detached heads
  and the base branch itself, using only local git commands: `diff --name-only
  --no-renames`, `merge-base --is-ancestor`, and `status --porcelain` for uncommitted
  paths. It MUST NOT reuse `listWorktreeRoots`' silent fallback to the primary root. If
  enumeration fails, the report says so and exits non-zero. A per-unit git failure sets
  that unit's `changedPaths` to `null` with the error text kept for the report (FR-5).
  It never drops the unit.
- **FR-10 - Base resolution.** Each unit's base MUST default to the repo's default
  branch, read locally from `refs/remotes/<remote>/HEAD`, falling back to the local
  `main`. The base commit MUST be printed in every report ("measured against main @
  abc1234"). A stale local base still gives each unit's own changes correctly, because
  the three-dot diff starts at the fork point. But a unit already merged upstream and
  not yet fetched will still appear in-flight, and the report MUST say that it reflects
  the last fetch, which it did not perform.
- **FR-11 - Stacked inference (issue ask 3, inferred half).** For each ordered pair
  (A, B), the adapter MUST set B `stackedOn` A when A's head is an ancestor of B's head
  and A's head is not an ancestor of the base. This needs only local
  `merge-base --is-ancestor`.
- **FR-12 - Declared dependency (issue ask 3, declared half).** The adapter MUST parse
  the declaration format chosen in DQ-3 into `declaredAfter`. A declaration naming no
  known unit is reported as a dangling reference and has no effect on order. This is the
  same detect-only rule `next-task.ts` applies to a dangling `depends_on`.

### Surface

- **FR-13 - Headless report.** `npm run merge-order` (`scripts/merge-order.ts`, the same
  shape as SPEC-076's `npm run next-task`) MUST print the plan as human-readable text by
  default and as JSON under `--json`. It MUST refuse a root with no `.minspec/` marker
  (constitution invariant 3, as SPEC-076 does). It MUST exit non-zero when enumeration
  failed or when any unit is unknown, so a caller using it as a gate fails closed
  (invariant 2). It MUST exit zero otherwise, overlaps included, because an overlap is
  information, not an error.
- **FR-14 - No signpost ranking change.** Under DQ-2 (a), `next-task.ts`'s `EdgeKind`,
  `NodeKind`, severity classes and `ArtifactGraph` MUST be left unchanged. Collision
  edges live in the new module's own types, so SPEC-012's contract and its cycle
  detection cannot be disturbed by a branch-level edge.

## Acceptance Criteria

- [ ] Two units on `main` changing `scripts/validate-frontmatter.ts` (the #283/#280
      shape) yield one `overlaps` edge naming that path, and land in different batches
      with a `rebaseAfter` warning naming the path. (FR-2, FR-7, FR-8)
- [ ] A rename of `x.ts` to `y.ts` in A against an edit of `x.ts` in B overlaps. (Terms,
      FR-2)
- [ ] `Docs/A.md` against `docs/a.md`, and `a/b` against `a/b/c`, both overlap. (FR-3)
- [ ] A star (hub H overlapping disjoint L1..L3) batches L1..L3 first and H second, with
      one rebase warning on H. (FR-7)
- [ ] B branched from A gets `stacked_on`, no `overlaps` edge, and a later batch than A.
      (FR-2, FR-6, FR-11)
- [ ] A declared cycle (A after B, B after A) is reported with both members, and neither
      is batched. (FR-6)
- [ ] A unit whose diff fails is in `unknown`, in no batch, and the report exits
      non-zero. (FR-5, FR-9, FR-13)
- [ ] Shuffling the input order gives byte-identical JSON. (FR-1)
- [ ] The core module has no import of `fs`, `child_process`, `vscode` or any network
      module, checked by the same kind of import test as `next-task.ts`'s Tier-0 test.
      (FR-1)
- [ ] With the network disabled, `npm run merge-order` completes and starts no `gh`
      process. (FR-9, invariant 1)
- [ ] No output string contains "safe", "independent" or "conflict-free". (FR-8)
- [ ] `next-task.ts` is byte-unchanged by the implementing PR. (FR-14)

## Invariants (must not break)

- **INV-1 Offline (constitution invariant 1).** The default path makes no network call.
  Any network source is gated by DQ-1 and by DR-050/DR-071 consent. It is never added
  silently.
- **INV-2 No silent gate (constitution invariant 2).** Unknown is never reported as
  disjoint (FR-5). Enumeration failure is never swallowed (FR-9). The report's exit code
  is a fail-closed witness (FR-13).
- **INV-3 Blast radius (constitution invariant 3).** It reads only the repository it
  runs in, and its own worktrees, and only where `.minspec/` exists. It writes nothing.
- **INV-4 Determinism (DR-019).** The core is a pure function, so the same input gives
  the same plan on every surface.
- **INV-5 Never wrong.** It never claims safety it cannot observe (FR-8), and every
  report names the base commit it measured against (FR-10).
- **INV-6 Single-task primacy and Two Queues (DR-038 §3, DR-085).** Nothing here adds a
  list to the signpost or a node the human cannot discharge.
- **INV-7 SPEC-012 and SPEC-044 untouched.** Neither approved spec is edited. Adoption
  by SPEC-044's driver is that spec's own amendment.

## Decisions needed (Clarify)

**DQ-1 - Where does the set of in-flight changes come from?**
- (a) **(rec)** Local only: worktrees, plus local branches if DQ-4 asks for them. Zero
  network and no consent prompt. *Cost:* a pull request with no worktree on this
  machine is invisible: one opened by another contributor or another machine, or one
  whose worktree was already pruned. The report says plainly that it covers local work
  only.
- (b) Add open pull requests via `gh pr list`, behind a named standing-consent setting
  of DR-071's shape. That gives the exact set plus readiness (`ready`). *Cost:* a new
  network lane, a consent surface and a README inventory line (the SPEC-085 pattern),
  and it probably needs a DR amending DR-071's list of lanes. It also cannot run offline.
- (c) Read local remote-tracking refs (`refs/remotes/origin/*`) as a proxy for open PRs.
  *Cost:* squash-merged branches never look merged, so stale refs produce permanent
  false overlaps. This checkout holds 276 remote-tracking refs. I have not measured how
  many of them belong to already-merged branches. Not recommended.

**DQ-2 - Where is the merge order shown?**
- (a) **(rec)** The headless report only (FR-13), as a pure core that SPEC-044's merge
  driver and, later, DR-038's graph (#182, #265) consume. *Cost:* nothing new appears in
  the editor's status-bar signpost now, which is narrower than the issue's "in the
  signpost" wording.
- (b) Also add a `merge-pr` node kind to SPEC-012's resolver. *Cost:* it amends an
  approved spec's ranking contract (severity class, DR-085 membership). Without DQ-1 (b)
  it has no readiness to rank by, so it would rank merges it cannot see are green.
- (c) Annotate only: when the signpost's current target spec has a worktree overlapping
  another, add one evidence line. *Cost:* a new fs-adapter input to the signpost, for a
  case that is rare under single-task primacy.

**DQ-3 - How does an author declare "B merges after A"?**
- (a) **(rec)** A commit trailer on the dependent branch, `Merge-After: <branch-name>`.
  It is read locally from `git log <base>..<head>` and travels with the branch. *Cost:*
  it is invisible in the pull request's web view, and authors must learn one more
  trailer.
- (b) A `Depends on #N` line in the PR body. *Cost:* reading it needs the network (DQ-1
  (b)), and the body can be edited without leaving a trace in git.
- (c) No declaration in v1, only stacked inference (FR-11). *Cost:* "B needs A's change
  but was not branched from it" cannot be expressed, which is part of issue ask 3.

**DQ-4 - Include local branches that have no worktree?**
- (a) **(rec)** No. Worktrees only. *Cost:* a branch parked without a worktree is not
  seen.
- (b) Yes, every local branch not merged into base. *Cost:* squash-merged local branches
  produce the same permanent false overlaps as DQ-1 (c).

**DQ-5 - Confirm real conflicts with `git merge-tree --write-tree`?**
- (a) **(rec)** Not in v1. Report file overlap as risk only. *Cost:* the same file edited
  in different hunks is flagged though git would merge it cleanly. That gives false
  warnings, never false all-clears.
- (b) Yes. For each overlapping pair, run `merge-tree` locally (git 2.38 or later; this
  container has 2.43.0) and mark the pair confirmed-conflict or file-overlap-only.
  *Cost:* N-squared merges on large batches, a git-version floor, and a fallback path
  that must stay honest when git is older.

## Out of Scope

- Any CI check or merge block based on this plan. `.github/` is outside this spec, and
  a required check is a separate decision under invariant 2. Not planned. File an issue
  if it is wanted.
- Semantic conflicts with no shared file. These are undetectable here, and FR-8 forbids
  implying otherwise.
- Keeping branches up to date, which is #181. Running branch updates or merges, which is
  SPEC-044 FR-4b's driver.
- Worktree guardrails and session claims, which are #168 and SPEC-044 FR-1 to FR-3.

## Alternatives considered and rejected

- **Extend `EdgeKind` in `next-task.ts` with `overlaps`.** Rejected (FR-14). `overlaps` is
  symmetric and branch-level, while every existing edge is directed and artifact-level.
  Every consumer of `Edge` would have to learn to skip it, and a missed skip in the
  cycle walk would be a false corruption report on the signpost.
- **Have an LLM judge merge order.** Rejected by DR-019 §1. It is not reproducible.
- **Treat file-disjoint as "safe to merge in parallel".** Rejected (FR-8). It is false
  under semantic coupling and under strict up-to-date base rules.

## Traceability

- Issue: [#304](https://github.com/AIClarityAU/minspec/issues/304), triggered by the
  #283/#280 collision on `scripts/validate-frontmatter.ts`.
- Builds on: SPEC-012 (resolver), DR-019, DR-038 (#182 PR nodes, #265 graph), DR-085.
- Feeds: SPEC-044 FR-4b open question 2 (a computable merge-priority input).
- Consent model if DQ-1 (b): DR-050, DR-071, with SPEC-085 as precedent.
