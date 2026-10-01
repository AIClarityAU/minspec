---
id: SPEC-080
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-002  # Signpost Integrity
depends_on: [SPEC-012]
relates_to: [SPEC-014]
---

# MinSpec — `issue-triage` Next-Task Node Kind (Requirements)

**Date:** 2026-10-01
**Status:** Specifying (SDD Specify phase)
**Amends:** [SPEC-012 Next-Task Resolver](../SPEC-012-next-task-resolver/requirements.md)
(state model, node-kind set) — NOT a new engine; this spec is an addendum to an
`implementing`-status T4 spec, carrying its own id per this repo's "amend via a
new spec, never edit the approved one in place" convention (see e.g. SPEC-041,
SPEC-059 amending earlier specs).
**Triggered by:** [#92](https://github.com/AIClarityAU/minspec/issues/92), filed from
SPEC-014's own `Follow-ups` section while specifying the prettified review webview.
**Decision:** [DR-019](../../../docs/decisions/DR-019.md) (determinism/Tier-0 rules
this amendment must keep satisfying) and [DR-004](../../../docs/decisions/DR-004.md)
(Tier-1 `gh` CLI delegation model this amendment must fit inside, rather than
re-litigate).
**Epic:** [EPIC-002 Signpost Integrity](../../../docs/epics/EPIC-002-signpost-integrity.md)

---

## Context

[SPEC-012](../SPEC-012-next-task-resolver/requirements.md) unifies every pending
**human** decision — `epic-promote`, `spec-approve`, `adr-accept`, `phase-action`
(and, live in code but not yet in that spec's own state-model table,
`answer-OQ` — `packages/shared/src/next-task.ts:152`) — into one deterministic
next-task signpost. It explicitly excludes the agent/dispatch queue by
construction (INV — Two Queues) and, until now, has never modelled **GitHub
issues** at all: an issue sitting in `inbox` awaiting human triage is invisible
to the resolver.

[SPEC-014](../SPEC-014-review-webview/requirements.md) (prettified review
webview) wants its scroll-bottom **Approve** chain to walk "whatever the
SPEC-012 signpost points to," and the session that specified it asked that the
chain "probably include gh issues too" (SPEC-014 §Dependencies, §Follow-ups).
SPEC-014 is explicit that this is **not its own concern** — it consumes
whatever node kinds the resolver emits and adds no ordering of its own
(SPEC-014 FR-12) — so the node kind itself belongs here, in SPEC-012's state
model.

### A pure resolver cannot read GitHub itself

SPEC-012 FR-11 / DR-019 §6 require the resolver to be **one Tier-0 pure
function** in `packages/shared` — no `vscode`, no network, no filesystem reads
of its own. It never reads specs/epics/ADRs directly either: a separate
Tier-1 **fs adapter**, `packages/minspec/src/lib/artifact-graph.ts`, reads the
real workspace and maps it onto the resolver's `ArtifactGraph` shape
(`buildArtifactGraph`), which the pure function then ranks. GitHub issue state
is further out than the filesystem — it requires shelling out to the `gh` CLI
(DR-004 Tier-1: "GitHub integration via `gh` CLI … Extension delegates to
locally-installed CLI tools — no network code in the extension itself"), which
this repo already does for the parking-lot feature
(`packages/minspec/src/lib/parking-lot.ts:57`, `github.ts:11`
`isGhAvailable()`).

So `issue-triage` is not a new architectural pattern — it is the **same
adapter split SPEC-012 already uses for the filesystem**, applied to a second,
Tier-1 data source:

```
gh CLI (Tier-1, optional)
  └─ issue-adapter (new, Tier-1, packages/minspec)   — reads `inbox`-labelled issues
       └─ ArtifactGraph.issues[]  (new field, plain data, no gh/vscode inside it)
            └─ resolveNextTask()  (Tier-0, packages/shared — UNCHANGED purity)
```

The resolver stays exactly as pure as it is today; it only gains one more
array to rank over, fed by an adapter that is allowed to not-have-`gh` and
degrade, exactly as `buildArtifactGraph` already degrades on a missing/empty
workspace (INV-DEGRADE, `artifact-graph.ts:17-18`).

### The real triage label vocabulary, not the issue's guess

The triggering issue's body describes clearing as "triage promote (inbox →
P1/P2/P3)." That vocabulary does not exist in this repo. The actual pipeline
(`scripts/triage-inbox.sh`, `scripts/approve-issue.sh`,
`scripts/dispatch-ready-check.sh`) removes `inbox` and lands on one of
`agent-ready`, `agent-ready-specify` (#1169, DR-076), `needs-review`,
`needs-info`, or `needs-human-review`, each backed by a machine-readable
verdict record, not a bare label stamp (#983). This spec defines "cleared" in
terms of the **real** label set, not the issue's paraphrase — see FR-2.

The issue text also cites "DR-360" for the triage gate. DR-360 does not exist
in this repo — DR-004 and this repo's own `docs/decisions/INDEX.md` show the
local register runs DR-001…DR-098. `DR-360` is the **parent register**
(`~/code/mmo-platform/docs/decisions.md`) entry that authorized the `gh`
CLI parking-lot shell-out in the first place (cited, correctly, in DR-004's own
Context: "the `gh` CLI parking-lot shell-out (DR-360, parent register,
mmo-platform)"). It documents *that MinSpec may shell to `gh` at all*, not the
triage-label state machine. The real authority for "an issue carries `inbox`
until a human triages it" is `scripts/triage-inbox.sh`'s own header comment
and DR-072 (hold-label semantics) — there is no in-repo DR to cite for the
triage flow itself, and this spec does not mint one (no new architectural
choice here, see Decisions needed).

## State model addition

Extends the SPEC-012 table (state model section) with one row:

| Node kind | Pending when | Cleared by |
|---|---|---|
| `issue-triage` *(new)* | open GitHub issue carries label `inbox` | triage removes `inbox` and lands one of `agent-ready`, `agent-ready-specify`, `needs-review`, `needs-info`, `needs-human-review` (`scripts/triage-inbox.sh`) |

Severity class: **`pending`** (SPEC-012 FR-2's lowest/last class), never
`gate-violation`/`blocked-ready`/`promote-parent` — an untriaged issue has no
SDD-tree parent to be ahead of or gated by (it is not an epic member, not a
spec, not an ADR), so none of the other three classes' predicates can fire for
it. See **OQ1** (Decisions needed) for whether a future `epic:` field on an
issue should promote it into `blocked-ready`.

## Requirements

- **FR-1 (new `NodeKind` member, additive).** `packages/shared`'s `NodeKind`
  union (`next-task.ts:152`) gains `'issue-triage'` alongside the existing five
  (`epic-promote`, `spec-approve`, `adr-accept`, `phase-action`, `answer-OQ`).
  Additive only — no existing member is removed or renamed, so no consumer of
  the current five kinds needs to change to keep compiling.
- **FR-2 (pending predicate — label-driven, not status-driven).** An
  `issue-triage` node is pending for exactly the issues carrying the `inbox`
  label (GitHub issue, not a MinSpec `status:` frontmatter field — issues have
  no frontmatter). It clears when `inbox` is removed by the real triage
  pipeline (`scripts/triage-inbox.sh` / `scripts/approve-issue.sh` /
  `scripts/approve-on-label.sh`) landing one of `agent-ready`,
  `agent-ready-specify`, `needs-review`, `needs-info`, `needs-human-review` —
  **not** the "P1/P2/P3" vocabulary the triggering issue assumed (Context).
  `agent-quarantined` (security quarantine, #1xxx egress guard) is excluded
  from both the pending and cleared sets — a quarantined issue is neither
  "awaiting triage" nor "triaged," it is held outside the triage flow entirely
  and MUST NOT appear as a human next task.
- **FR-3 (Tier-0 purity is unchanged — new data, not new capability).** The
  `packages/shared` resolver gains a new input array
  (`ArtifactGraph.issues?: IssueNode[]`, plain data: issue id, labels, title,
  url — no `gh`, no `vscode`, no network reachable from inside
  `packages/shared`) and a ranking rule for it. It MUST NOT gain a `gh`
  invocation, an `execFile`/`child_process` import, or any I/O of its own.
  SPEC-012 FR-11 / DR-019 §6 (single Tier-0 pure function) and DR-004's Tier
  boundary (Tier-1 code may shell to `gh`; Tier-0 code never does) both hold
  unchanged. A T0 import-boundary test (mirroring SPEC-040's existing
  import-boundary gate) MUST assert `packages/shared` still has zero
  `child_process`/`gh` references after this lands.
- **FR-4 (Tier-1 issue adapter, new, `packages/minspec`).** A new Tier-1
  adapter (alongside `artifact-graph.ts`, not inside it — see **OQ2**) is
  responsible for all `gh` I/O: listing open issues labelled `inbox` (the same
  `gh issue list --json number,title,labels,url --label inbox` shape the
  existing `findExistingIssue` call already uses one variant of,
  `parking-lot.ts:57-75`) and mapping each to an `IssueNode`. This adapter is
  the ONLY place in the new surface that imports `child_process`/shells to
  `gh`.
- **FR-5 (graceful degrade when `gh` is absent — DR-004 Tier-1 contract).**
  Before listing issues, the adapter MUST probe availability via the
  already-existing `isGhAvailable()` (`packages/minspec/src/lib/github.ts:11`).
  When `gh` is absent, unauthenticated, or the call errors/times out, the
  adapter MUST return an empty `issues: []` — never throw, never block the
  rest of the signpost (mirrors `buildArtifactGraph`'s INV-DEGRADE for a
  missing/empty workspace, `artifact-graph.ts:17-18`, and DR-004's Negative
  consequence "Tier 1 features carry a permanent UX tax: each must probe CLI
  availability at activation and degrade gracefully"). The rest of the
  resolver (epics/specs/ADRs) MUST still resolve normally when `gh` is
  unavailable — a missing `gh` degrades only the `issue-triage` node source,
  never the whole signpost (same shape as SPEC-012 R5, "a single bad node must
  not blank the whole signpost").
- **FR-6 (no network call from the extension process — DR-004 Tier-1, not
  Tier-0).** `gh` itself makes the network call; the MinSpec extension process
  never does (DR-004: "zero outbound connections from the extension
  process itself"). This is explicitly a **Tier-1** feature, opt-in by the
  presence of `gh` on the machine — it does NOT change `packages/minspec`'s
  Tier-0 claims for every *other* feature, and it MUST NOT be reachable from
  any code path that currently has no network dependency (e.g. it must not be
  invoked from the status-bar signpost's hot/synchronous path if that path is
  otherwise instant — see **OQ3**, latency/caching is a plan-phase concern).
- **FR-7 (stays on the human queue — INV — Two Queues, unchanged).** An
  `issue-triage` node is a **human decision** (triage the issue), never agent
  dispatch work. It MUST NOT be confused with, or feed, the separate
  `agent-ready`-driven dispatch queue (`scripts/dispatch-issue.sh`) — that
  queue decides what an *agent* builds next; this node decides what a *human*
  must label next. SPEC-012's existing INV — Two Queues test suite gains a
  fixture proving an `issue-triage` node is never emitted as, or alongside, an
  agent-dispatch item.
- **FR-8 (evidence — SPEC-012 FR-7, unchanged shape).** An emitted
  `issue-triage` next task MUST carry the same `Evidence` shape every other
  node kind carries (`severityClass`, `rule`, `explanation`, `refs`) — e.g.
  `rule: 'issue.inbox'`, `explanation: "#<N> '<title>' carries inbox — triage
  it"`, `refs: ['ISSUE-<N>']` — diagnosable to the artifact + rule exactly like
  every other SPEC-012 FR-7 case.
- **FR-9 (consumed, not duplicated, by SPEC-014).** SPEC-014's webview renders
  whatever this node kind looks like once it exists, per its own
  `decision-only` mode row already reserved for `issue-triage`
  (SPEC-014 state table, §Surfaces). This spec does not define webview
  behaviour (out of scope) — it only emits the node.
- **FR-10 (corruption stays structural-only — SPEC-012 FR-15, unchanged
  scope).** A malformed/unreachable issue response (bad JSON from `gh`, a
  issue number that doesn't parse) is an adapter-level degrade (FR-5: treat as
  "couldn't list, so empty"), not a new corruption class fed into the
  resolver's cycle/dangling-ref detection — `issue-triage` nodes carry no
  `depends_on`/`supersedes`/`relates_to` edges in this slice (see **OQ4**), so
  FR-13's edge machinery is untouched by this amendment.

## Acceptance Criteria

- [ ] **(FR-1)** `packages/shared`'s `NodeKind` union includes `'issue-triage'`
      alongside the existing five members; no existing member is removed or
      renamed.
- [ ] **(FR-2)** A fixture issue carrying `inbox` yields a pending
      `issue-triage` node; a fixture issue carrying any of `agent-ready` /
      `agent-ready-specify` / `needs-review` / `needs-info` /
      `needs-human-review` (and no `inbox`) yields none; a fixture issue
      carrying `agent-quarantined` yields none either way.
- [ ] **(FR-3, INV — Tier boundary)** A static import-boundary check (mirroring
      SPEC-040) asserts `packages/shared` has zero `child_process`/`gh`
      references after this change lands.
- [ ] **(FR-4, FR-5)** With `gh` unavailable (mocked `isGhAvailable()` →
      `false`), the adapter returns `issues: []` and the rest of the resolved
      graph (epics/specs/ADRs) still resolves normally — a single fixture
      proves the rest of the signpost is unaffected.
- [ ] **(FR-7, INV — Two Queues)** A fixture seeded with both an `inbox` issue
      and an `agent-ready` dispatch-queue item proves the `issue-triage` node
      is emitted on the human queue only, never alongside or as a dispatch
      item.
- [ ] **(FR-8)** An emitted `issue-triage` next task's `Evidence` carries
      `severityClass`, `rule`, `explanation`, and `refs` in the same shape as
      every other node kind — verified by output-shape assertion.
- [ ] **(Regression, INV — Additive node set)** The existing SPEC-012 T0
      fixture suite passes unmodified after this change (no re-ranking of any
      non-issue fixture).

## Invariants (must hold)

- **INV — Tier boundary (DR-004, unchanged).** `packages/shared` (Tier-0)
  never imports `child_process`, never shells to `gh`, never reaches the
  network, directly or transitively, after this change (FR-3). All `gh` I/O
  lives in the new Tier-1 adapter (FR-4) in `packages/minspec`.
- **INV — Two Queues (SPEC-012, unchanged).** `issue-triage` is a human-queue
  node only; it is never emitted as, derived from, or confused with an
  agent/dispatch work item (FR-7).
- **INV — Honest degrade (DR-004 / SPEC-012 FR-10, unchanged).** `gh` absent,
  unauthenticated, rate-limited, or erroring degrades the `issue-triage`
  source to empty — never a thrown error, never a fabricated node, never a
  blocked signpost for the *other* node kinds (FR-5).
- **INV — Additive node set (new, scoped to this amendment).** Adding
  `issue-triage` MUST NOT change the ranking, severity class, or emitted
  evidence of any existing `epic-promote` / `spec-approve` / `adr-accept` /
  `phase-action` / `answer-OQ` node for any fixture that does not itself
  introduce an issue (regression-tested against the existing SPEC-012 T0
  fixture suite, which must still pass unmodified).

## Decisions needed (Clarify)

- **OQ1 — Does an issue ever outrank `pending`?** Today's FR-2 fixes
  `issue-triage` at the lowest severity class (`pending`) because issues carry
  no epic membership today. If a future issue gained a machine-readable
  `epic:`/`depends_on` link (there is no such convention yet), should it be
  promotable to `blocked-ready`? **Recommendation: no, not in this slice** —
  ship `issue-triage` as flat `pending` first (matches the issue's own "simple
  Tier-1 node" framing) and revisit only if real usage shows untriaged issues
  getting buried under epic work; a tie-break more elaborate than needed is
  itself a Costly-to-Refactor risk (SPEC-012 Zone A #3). **Cost of the
  recommendation:** an `inbox` issue tied to an active epic's blocked work will
  not visibly outrank unrelated pending work until a human notices it by
  reading the issue, not the signpost.
- **OQ2 — One adapter or two?** Should the `gh` issue-listing code live as a
  new file (`issue-adapter.ts`) or as an added function inside the existing
  `artifact-graph.ts`? **Recommendation: a new file**, because
  `artifact-graph.ts`'s own header (`:1-23`) declares it a **pure mapping
  layer over the filesystem** that "NEVER imports `vscode`" but says nothing
  about `gh`/network — folding a `child_process` shell-out into the same file
  that's documented and tested as the fs-only adapter blurs a boundary a
  future reader (or the SPEC-040 import-boundary gate) would have to
  re-discover by reading code instead of a doc comment. **Cost:** two small
  adapter files to keep in sync (`buildArtifactGraph` must call both and merge
  their outputs into one `ArtifactGraph`) instead of one.
- **OQ3 — Where does `gh` get called from, and how often?** The status-bar
  signpost recomputes on a debounce (`commands/next-task.ts`, per the
  `next-task.ts` header). Shelling to `gh issue list` on every recompute would
  add real latency (and, per `github.ts:26`, a 5s timeout) to a currently-pure
  filesystem read. **Not resolved here** — plan phase must pick a caching /
  explicit-refresh strategy (e.g. only poll `gh` on manual refresh or a longer
  interval, never on the fs-watch-triggered debounce path) so a slow/offline
  `gh` can't make the whole signpost feel hung. Flagged, not answered, because
  it is a plan-phase performance design, not a requirements question.
- **OQ4 — Which repo(s)?** `scripts/triage-inbox.sh` hard-codes
  `REPO="AIClarityAU/minspec"`. Is `issue-triage` scoped to that one repo only
  in v1, or should it be configurable (e.g. for a user running MinSpec against
  their own project's issue tracker)? **Recommendation: hard-code to the
  current workspace's `origin` remote** (reusing
  `getRepoFromRemote()`, already exported from `github.ts`/`parking-lot.ts`)
  rather than a MinSpec-repo-specific constant — this is a generic feature for
  any adopter, not a MinSpec-dev-only tool. **Cost:** needs a workspace with a
  GitHub `origin` remote and `gh` auth scoped to *that* repo's issues, which a
  solo adopter without GitHub Issues enabled simply degrades out of (FR-5).

## Dependencies & Blast-Radius

**Declared dependencies:**
- [SPEC-012](../SPEC-012-next-task-resolver/requirements.md) — the state model
  and `NodeKind` union this amends (FR-1, FR-2).
- [SPEC-014](../SPEC-014-review-webview/requirements.md) — the consumer that
  surfaced this need; already reserves a `decision-only` row for
  `issue-triage` and degrades to "shown, not approvable" if this node kind
  doesn't exist yet (SPEC-014 FR-13 / Failure-Modes).
- [DR-004](../../../docs/decisions/DR-004.md) — the Tier-1 `gh` delegation
  model this amendment must fit inside (FR-3, FR-4, FR-5, FR-6).
- [DR-019](../../../docs/decisions/DR-019.md) — the Tier-0 purity / determinism
  rules the resolver core must keep satisfying (FR-3).
- `packages/minspec/src/lib/github.ts` (`isGhAvailable`, the exec wrapper) and
  `packages/minspec/src/lib/parking-lot.ts` (`findExistingIssue`'s
  `gh issue list --json` call shape) — reused primitives, not reimplemented
  (FR-4, FR-5).

**Blast-radius:**
- `packages/shared/src/next-task.ts` — `NodeKind`, `ArtifactGraph`,
  `AnyNode`/`naturalKind`/`buildIndex` all gain an `issue-triage` arm. Every
  place that exhaustively switches over `NodeKind` (if any; none confirmed
  outside `next-task.ts` as of this writing) must be re-checked for an
  unhandled-case fallthrough.
- `packages/minspec/src/lib/artifact-graph.ts` and/or a new adapter file
  (OQ2) — `buildArtifactGraph`'s return shape grows an `issues` field;
  callers that destructure `ArtifactGraph` positionally (none known; it's a
  named-field interface) are unaffected.
- `packages/minspec/src/commands/next-task.ts` and the status-bar signpost —
  must tolerate the new node kind's evidence/imperative shape without a
  separate code change (FR-8 keeps the `Evidence` shape uniform specifically
  so consumers don't need a kind-specific branch).
- SPEC-012's own T0 fixture suite (`packages/shared/tests`) — gains
  `issue-triage` fixtures; must not perturb any existing fixture's expected
  output (INV — Additive node set).

## Out of scope

- **SPEC-014's webview rendering of `issue-triage`** — SPEC-014 already
  reserves the `decision-only` interaction mode and its own FRs for that
  surface; this spec only makes the node exist for it to consume (FR-9).
- **A new `MILESTONE`-style first-class artifact kind for issues** — issues
  stay GitHub-native; this does not mint a parallel MinSpec-local artifact
  registry for them.
- **Writing to GitHub** (changing labels, commenting) from the resolver or its
  adapter — the adapter is **read-only** (lists issues); the actual label
  mutation continues to run through the existing triage scripts
  (`scripts/triage-inbox.sh` et al.), which already have their own
  untrusted-input / bot-identity security model documented in their headers.
  This spec's adapter must not duplicate or bypass that model.
- **Caching/performance strategy for the `gh` call** — flagged as OQ3, resolved
  at plan time.
- **Any change to `scripts/triage-inbox.sh` or the dispatch pipeline** — this
  spec only *reads* the label state that pipeline already produces; it does
  not change triage ceremony or labels.

## Follow-ups (tracked)

- None beyond OQ1–OQ4 above, which are plan-phase questions, not new tracked
  work items.
