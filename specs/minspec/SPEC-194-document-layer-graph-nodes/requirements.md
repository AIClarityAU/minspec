---
id: SPEC-194
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - the graph the signpost reasons over gains its document layer
aspects: [signpost, dag, artifact-graph, approvable, node-kinds, tier-0, offline, never-wrong]
depends_on: [SPEC-012, DR-038]  # SPEC-012 owns the resolver and the fs adapter this extends; DR-038 (amended 2026-07-14) is the decision this materialises
relates_to: [DR-041, DR-053, DR-068, DR-085, SPEC-038, SPEC-046, SPEC-064, "#742", "#48", "#92", "#182", "#227", "#579", "#630", "#631"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). The two files
# below are NEW and are needed under every answer to the open questions: one pins the
# adapter's document nodes against a real-shaped fixture, the other pins that the
# resolver's answer does not move when the document layer is added.
implements: [packages/minspec/tests/artifact-graph-document-nodes.test.ts, packages/shared/tests/next-task-document-layer-inert.test.ts]
# Modified, not owned. Both files are owned by SPEC-012 (its `implements:` list); this
# spec adds an optional field to the contract and a third section to the adapter.
affects: [packages/shared/src/next-task.ts, packages/minspec/src/lib/artifact-graph.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-194: The signpost graph shows every approvable document as its own node - plan, tasks and the constitution join epics, specs and decision records

## In plain terms

The graph behind the signpost has three kinds of node today: epics, specs and decision
records. A spec's `design.md` (its plan) and `tasks.md` are folded into the spec, and the
constitution is not in the graph at all. You decided on 2026-07-14 (#742) that every
approvable document should be its own node. This spec adds the three missing kinds -
plan, tasks, constitution - to the graph data. It does **not** change what the signpost
tells you to do next, and it does not build the drawing of the graph (that is #48).

One thing changed since you filed #742, and it shapes this spec: **today a plan or a task
list cannot be approved.** The approval code accepts only `requirements.md` and `spec.md`
(`packages/minspec/src/lib/approvable.ts:26`), and #630 turned the old `design.md` /
`tasks.md` approval records into orphans (`packages/minspec/src/lib/approval-store.ts:221-226`).
So a plan node has no approval state to show. This spec makes the node say so plainly
rather than invent one. Whether plans and task lists should become approvable again is
your call. It is OQ-1 below.

> Traces to **[#742](https://github.com/AIClarityAU/minspec/issues/742)**. Materialises
> **[DR-038](../../../docs/decisions/DR-038.md)**, Amendment (2026-07-14), point 2 (*"the
> resolver's `ArtifactGraph` gains document-layer node kinds for plan, tasks, and
> constitution"*). The other half of #742, which was to reconcile DR-038's self-contradiction,
> is already done in that amendment. DR-038 is `accepted`.

## One-Sentence Scope

Add a `documents` layer of plan, tasks and constitution nodes to the resolver's
`ArtifactGraph` input. Each node carries the state it really has, and the resolver's
next-task answer stays exactly the same.

## Context - what exists today (measured 2026-10-16 on `origin/main`)

| Fact | Evidence |
|---|---|
| The resolver input has three node arrays: `epics`, `specs`, `adrs`, plus optional `edges`. | `packages/shared/src/next-task.ts:156-162` |
| The resolver's output node kinds are `epic-promote`, `spec-approve`, `adr-accept`, `phase-action`, `answer-OQ`. These are *task* kinds, not graph node kinds. | `packages/shared/src/next-task.ts:169` |
| The fs adapter dedupes a split-layout spec's `requirements.md` / `design.md` / `tasks.md` into ONE spec node by shared `id:`, preferring `requirements.md`. | `packages/minspec/src/lib/artifact-graph.ts:201-220` |
| The adapter reads `tasks.md` only to compute the spec's `implementHole` and never surfaces it as a node. `design.md` is not read at all. | `packages/minspec/src/lib/artifact-graph.ts:395-460` |
| The adapter reads the constitution only for its `## Goals` rank map. | `packages/minspec/src/lib/artifact-graph.ts:149-160` |
| Approvable files are `DR-*.md`, `EPIC-*.md`, `requirements.md`, `spec.md`. `design.md` / `tasks.md` / the constitution are not approvable. | `packages/minspec/src/lib/approvable.ts:15-44` |
| Approval records for `design.md` / `tasks.md` are reported as **orphaned** (#630). Three such files sit in this repo's `.minspec/approvals/`. | `packages/minspec/src/lib/approval-store.ts:214-250` |
| No module under `packages/minspec/src/lib/` gives the constitution an approval hash or sidecar. *(Checked by grep for `constitution` alongside `approv`/`hash` in `lib/`. Every hit was an invariant citation in a comment.)* | grep, 2026-10-16 |
| The adapter's only non-test caller is the next-task command, which consumes `buildArtifactGraph` and `artifactFileIndex` (an id → file map). | `packages/minspec/src/commands/next-task.ts:15,26,44,61` |

**Approvable is defined three ways.** That disagreement is OQ-3. [DR-041](../../../docs/decisions/DR-041.md)
(accepted) says `Approvable = Spec | DR | PR | Epic | Issue`. DR-038's 2026-07-14 amendment
(accepted) says the approvables are the hash-approved *documents*, and that issues and PRs are a
separate work-item class. The code's `ApprovableKind` is `'spec' | 'adr' | 'epic'`. This spec
uses DR-038's amended meaning, because that is the decision it materialises. It needs neither
of the other two to change before it can be built.

## Terms

- **Document node**: one node per approvable-class document file that the resolver
  input does not already represent. That means a plan (`design.md`), a task list
  (`tasks.md`) and the constitution (`.minspec/constitution.md`). Epics, specs (via
  `requirements.md` / `spec.md`) and decision records are already nodes and are unchanged.
- **Document layer**: the set of all document nodes, carried in `ArtifactGraph.documents`.
- **Not approvable**: the honest approval state of a document that no approval mechanism
  covers today. It is distinct from `unapproved`, which claims an approval is possible and
  absent.

## Contract (the cross-boundary shape - Tier-0, `@aiclarity/shared`)

```ts
// packages/shared/src/next-task.ts (additive; every existing type unchanged)
export type DocumentKind = 'plan' | 'tasks' | 'constitution';

/** An approval state, or the explicit statement that none can exist for this document today. */
export type DocumentApproval = ApprovalState | 'not-approvable';

export interface DocumentNode {
  /** Stable node id. Form is OQ-2; the recommended form is the repo-relative POSIX path. */
  id: string;
  kind: DocumentKind;
  /** SPEC-NNN the plan/task list belongs to. Absent for the constitution. */
  parent?: string;
  /** The parent spec's `phases.plan` / `phases.tasks` value. Absent for the constitution. */
  phaseStatus?: PhaseStatus;
  approval: DocumentApproval;
}

export interface ArtifactGraph {
  epics: EpicNode[];
  specs: SpecNode[];
  adrs: AdrNode[];
  edges?: Edge[];
  /** Document layer (SPEC-194). Optional: absent ≡ empty, so every existing producer stays valid. */
  documents?: DocumentNode[];
}
```

The `parent` link is structural, so it is a field and **not** an `Edge`. `EdgeKind` stays
`depends_on | supersedes | relates_to`. Those are the frontmatter edges the resolver checks
for danglers and cycles. Putting structural links into that set would let a missing plan
file show up as corruption.

## Functional Requirements

### A. Contract

- **FR-1** `@aiclarity/shared` exports `DocumentKind`, `DocumentApproval` and `DocumentNode`
  exactly as in the Contract section, and `ArtifactGraph` gains the optional `documents`
  field. No existing exported type changes shape. `NodeKind` (the resolver's *task* kinds)
  does not change.
- **FR-2** The shared module stays Tier-0. It has no `fs`, no `vscode` and no network
  import, per the layering rules SPEC-012 already enforces.

### B. Adapter - emitting the document layer

- **FR-3** `buildArtifactGraph(rootDir)` emits one `plan` node for every `design.md` that
  sits in the same directory as a discovered spec's canonical file (`requirements.md` /
  `spec.md`). It emits one `tasks` node for every such `tasks.md`. `parent` is that
  spec's id.
- **FR-4** A single-file spec (`spec.md` holding every phase inline, with no sibling
  `design.md` / `tasks.md`) emits **no** plan or tasks node. Its plan and tasks are not
  separate documents, and inventing a node for them would show the human a file that does
  not exist.
- **FR-5** `phaseStatus` is the parent spec's `phases.plan` (for plan) or `phases.tasks`
  (for tasks) value as parsed by `parseSpec`. If that phase key is absent, `phaseStatus` is
  absent rather than defaulted, because a default would claim a state nobody recorded.
- **FR-6** `buildArtifactGraph` emits exactly one `constitution` node when
  `.minspec/constitution.md` exists. It emits none when the file is absent, and that
  absence is not an error.
- **FR-7** `approval` is derived from the **same classifier the approve commands use**
  (`classifyApprovablePath`) and the **same status reader** (`getApprovalStatus`). For a
  path the classifier does not accept, `approval` is `'not-approvable'`, and **any sidecar
  on disk for that path is ignored**. A sidecar the approval system itself calls orphaned
  (#630) must never surface as `approved`. If OQ-1 makes plans approvable, this FR changes
  nothing. The classifier then accepts the path, and the real state flows through.
- **FR-8** The existing `epics`, `specs` and `adrs` arrays, and `edges`, are byte-for-byte
  identical to what the adapter emits today for any workspace. The split-layout dedup in
  FR-3's context still yields one spec node, keyed to `requirements.md`.
- **FR-9** `artifactFileIndex` (id → file, used to open the signpost's target) keeps
  returning the canonical spec file for a `SPEC-NNN` id. Document nodes must not overwrite
  or shadow that entry. (A plan shares its spec's `id:`, so a naive id-keyed insert would
  make "open the next task" open `design.md`.)
- **FR-10** Degradation follows the adapter's existing INV-DEGRADE. An unreadable
  `design.md`, `tasks.md` or constitution still yields its node, with `phaseStatus` and
  `approval` computed from what *is* readable. An unreadable approval sidecar is treated
  however `getApprovalStatus` already treats it for specs. *I believe that is
  `unapproved`, but I have not checked it.* Plan confirms it, and the two kinds must not
  diverge. Nothing throws.
- **FR-11** No network call, child process or git invocation is added. `getApprovalStatus`
  already reads committed sidecars locally.

### C. Resolver - inert to the new layer

- **FR-12** `resolveNextTask` (and every other resolver export) returns a result
  deep-equal to its result for the same graph with `documents` removed. The document layer
  is data for the graph surface (#48 / DR-038), not new signpost work. Adding signpost
  tasks for plans (for example a `plan-approve` kind) would need OQ-1 answered *and*
  DR-085's dischargeable-act test applied. It is out of scope here.
- **FR-13** The resolver does not dangler-check or cycle-check `documents`. A plan whose
  `parent` resolves to no spec cannot arise from FR-3. If a hand-built graph has one, it
  is passed through untouched.

### D. Same-file hygiene named in #742

- **FR-14** `packages/minspec/src/lib/artifact-graph.ts` typechecks clean under the
  package's `tsc --noEmit`. #742 cites #579 for "unguarded tsc errors" in this file. *I
  could not check whether those errors are still present, because this worktree has no
  installed dependencies.* The Plan phase must run tsc first. If the file is already
  clean, it records that against #579 and does nothing more for this FR.
- **FR-15** The header comments of both `affects:` files name the document layer and stop
  describing the adapter as epics/specs/ADRs only. The `DEFERRED` block in
  `packages/shared/src/next-task.ts:30` is re-read against the code as it stands then, and
  any line that is no longer deferred is corrected (#631).

## Acceptance Criteria

- **AC-1** (FR-3, FR-5, FR-7) A fixture spec directory with `requirements.md`,
  `design.md`, `tasks.md` and `phases: {plan: done, tasks: in-progress}` yields exactly
  one spec node, one `plan` node (`parent` = the spec id, `phaseStatus: 'done'`,
  `approval: 'not-approvable'`) and one `tasks` node (`phaseStatus: 'in-progress'`).
- **AC-2** (FR-7) Adding a well-formed `design.md.json` approval record whose hash matches
  the fixture's `design.md` leaves that plan node at `'not-approvable'`. This is the
  orphan-sidecar control. Without it the test passes even if the adapter reads the sidecar
  directly.
- **AC-3** (FR-4) A single-file `spec.md` fixture yields zero document nodes.
- **AC-4** (FR-6) A workspace with `.minspec/constitution.md` yields exactly one
  `constitution` node with no `parent` and no `phaseStatus`. Removing the file yields zero,
  with no throw.
- **AC-5** (FR-8) For this repository's own corpus, `epics`/`specs`/`adrs`/`edges` from the
  new adapter deep-equal those from the pre-change adapter. This is a real-data golden in
  the style of `artifact-graph-realdata.test.ts`, not a toy fixture, so that it covers
  nested specs and the root-level `specs/minspec/design.md`.
- **AC-6** (FR-9) In the AC-1 fixture, `artifactFileIndex(root).get('SPEC-…')` ends in
  `requirements.md`.
- **AC-7** (FR-12) A property test applies `resolveNextTask` to graphs from the existing
  resolver test corpus, each paired with a randomly generated `documents` array, and
  asserts deep-equality with the result for the same graph without `documents`. The
  generator varies count (0, 1, many), every `DocumentKind`, every `DocumentApproval`
  value, and parents that do and do not match a spec. A fixed-size generator would leave
  the count axis untested.
- **AC-8** (FR-10) Making `design.md` unreadable (chmod 000 or equivalent) still yields
  the plan node and does not throw.
- **AC-9** (FR-14) `tsc --noEmit` over `packages/minspec` reports zero diagnostics in
  `artifact-graph.ts`.
- **AC-10** (FR-1) A type-level test shows that an `ArtifactGraph` literal with no
  `documents` field still compiles. Existing producers and test fixtures stay valid.

## Invariants (must not break)

- **INV-1 Offline (constitution invariant 1).** No network, no `gh`, no git subprocess
  is added to the adapter or the resolver.
- **INV-2 Signpost answer unchanged.** For every workspace, the next human task is
  identical before and after this change (FR-12, AC-7). DR-085's membership test and
  SPEC-012's severity ordering are untouched.
- **INV-3 Never claim an approval that cannot exist.** No document node shows `approved`,
  `stale` or `unapproved` for a file that the approve commands would refuse to approve
  (FR-7, AC-2). Without this, a stranded #630 sidecar would show as a live approval.
- **INV-4 Derive, never trust the literal (SPEC-012 INV-FIDELITY).** Spec status keeps
  coming from `deriveStatus`. `phaseStatus` comes from the parsed `phases:` map, which is
  the input to that derivation, and never from a document's own `status:` line.
- **INV-5 Tier-0 layering.** `@aiclarity/shared` gains types only. Every filesystem read
  stays in the adapter.
- **INV-6 Degrade, never throw (SPEC-012 INV-DEGRADE).**
- **INV-7 Blast radius (constitution invariant 3).** The adapter reads only paths inside
  the workspace it is given.

## Decisions needed (Clarify)

### OQ-1 - Should a plan (`design.md`) and a task list (`tasks.md`) be approvable again?

#742 wants their approval state visible, on the premise that they "get their own approval
sidecars". That premise no longer holds. #630 narrowed the approvable set to
`requirements.md` / `spec.md`, and DR-068 / SPEC-046 treat the engineering documents as
auto-approved in PO-only mode.

- **(a) (rec) Keep them non-approvable. Show phase status plus `not-approvable`.** This is
  what FR-7 builds. The node is honest today and needs no new approval surface. *Cost:* the
  graph will not show the per-plan sign-off you asked for in #742. A plan reads "plan: done
  · not approvable", which may feel like the feature you asked for is missing.
- **(b) Re-widen the approvable classifier to include `design.md` / `tasks.md`.** *Cost:*
  every plan and task list becomes a human gate again. That reverses #630, conflicts with
  DR-068's PO-only auto-approve, and needs its own DR. FR-7 already handles this answer
  with no change here.

### OQ-2 - What is a document node's id?

A plan shares its spec's `id:`, so the spec id alone cannot name it.

- **(a) (rec) The repo-relative POSIX path, for example
  `specs/minspec/SPEC-012-next-task-resolver/design.md`.** It is unique, it is already the
  key approval records use, and it needs no grammar change. *Cost:* it is long and not
  typeable, and renaming the folder changes the id. The graph surface would have to show a
  short label (for example "SPEC-012 · plan") built from `kind` + `parent`.
- **(b) A DR-053-style short id such as `SP12/plan`.** *Cost:* DR-053 v2 reserves the third
  segment for paragraph type codes (`FR`, `AC`, …), and DR-056 (the paragraph layer) is
  meant to live *below* this one. Using that slot for documents needs a DR-053 amendment,
  and #679 / #681 have not shipped the v2 grammar yet.

### OQ-3 - Which definition of "Approvable" governs?

DR-041 lists Spec, DR, PR, Epic and Issue. DR-038's amendment says documents, with
issues/PRs as work items. The code says spec, adr, epic. Both DRs are `accepted`, so the
register contradicts itself. This spec does not depend on the answer, but the graph
surface's labels (#48) will.

- **(a) (rec) Amend DR-041 to DR-038's meaning.** Approvables are hash-approvable documents,
  and issues and PRs are work items. Do it as a separate decision-record pull request,
  because editing an accepted DR is your act. *Cost:* DR-041's onboarding copy ("Specs, DRs,
  PRs, Epics, and Issues are all Approvables") must be rewritten. The `Approvable` union type
  DR-041 names was never built (no match in `packages/shared/src`), so no code changes.
- **(b) Keep DR-041 and narrow DR-038's wording instead.** *Cost:* it reverses your
  2026-07-14 decision recorded in #742.

### OQ-4 - Does the issue / PR work-item class belong in this spec?

DR-038's amendment says the resolver gains "a separate issue/PR work-item kind (tracked in
#742; overlaps #92 issue-nodes and #182 PR-nodes)".

- **(a) (rec) No. Leave it to #92 and #182.** Issue and PR data comes from GitHub. Reading
  it is a network call and needs consent (constitution invariant 1, DR-050), which is a
  different design problem from reading local files. *Cost:* DR-038's "tracked in #742"
  pointer for work-item nodes moves to #92 / #182. Those issues need a line saying they now
  own it.
- **(b) Yes. Add an empty `workItems?: WorkItemNode[]` now.** *Cost:* it is a contract
  field with no producer, a stub that #92 / #182 would probably reshape anyway.

## Out of Scope

- Drawing the graph, layout, the "+N" rollups and click-through. That is #48 under DR-038 §3.
- Any new signpost task kind, such as approving a plan (FR-12, OQ-1).
- Issue and PR nodes (OQ-4, #92, #182).
- Paragraph and code nodes below each document. That is the layer below, under DR-038's
  amendment point 1 and DR-053.
- Constitution approval. No mechanism exists. Adding one is a separate decision.
- Cleaning up the three orphaned `design.md.json` / `tasks.md.json` records in this repo.
  #630's orphan report already surfaces them.

## Costly to Refactor

Cheap while nothing consumes `documents`. The field is optional and the resolver ignores
it. Once #48 renders it, the **node id form (OQ-2)** becomes the expensive part, because
saved views, links and any persisted layout key on it. That is why OQ-2 is asked now
rather than in Plan. No decision record is minted. Every choice here can be undone in
under a day until a consumer ships (the decision-record filter). If OQ-1 (b) or OQ-3 (a) is chosen,
*that* answer needs its own DR.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | The document layer starts changing the signpost's answer, for example through a future edit that walks `documents` in ranking. | FR-12 + AC-7 property test pins inertness across count/kind/approval axes. |
| R2 | A stranded #630 sidecar shows a plan as approved. | FR-7 routes through the approve commands' own classifier. AC-2 is the control with a matching-hash sidecar present. |
| R3 | A plan's shared id overwrites the spec's entry in the file index, so "open next task" opens `design.md`. | FR-9 + AC-6. |
| R4 | The golden test passes vacuously on a toy fixture. | AC-5 runs on this repo's real corpus, which includes the nested and root-level split layouts. |

## Traceability

- Issue: [#742](https://github.com/AIClarityAU/minspec/issues/742) (founder decision 2026-07-14).
- Decision: [DR-038](../../../docs/decisions/DR-038.md), Amendment (2026-07-14) point 2. No new DR.
- Builds on: [SPEC-012](../SPEC-012-next-task-resolver/requirements.md) (resolver + fs adapter, owner of both `affects:` files).
- Consumer (future): #48 unified graph surface.
- Neighbours: #92 (issue nodes), #182 (PR nodes), #227 (pre-phase gate nodes), #630 (orphaned plan/tasks sidecars), #579 / #631 (same-file hygiene).

## Follow-ups (tracked)

- OQ-1 (b) or OQ-3 (a), if chosen, gets its own decision record. Its issue is filed at Clarify, when the answer exists.
- Work-item nodes go to #92 / #182 (OQ-4 a).
- The graph surface goes to #48.
