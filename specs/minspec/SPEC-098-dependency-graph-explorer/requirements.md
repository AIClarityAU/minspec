---
id: SPEC-098
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-001  # Explorer Epic Grouping - a visual cross-artifact map is the natural extension of "everything under one epic visible in one place"
aspects: [ux, traceability, data]
depends_on: [DR-013]
relates_to: [SPEC-012, DR-100, "#182", "#211"]
# No `implements:` yet. DQ-1 to DQ-3 below are unresolved, and the file list a Clarify
# answer produces is what `implements:` binds (SPEC-038 FR-1 to FR-3) — binding it to a
# guess now would stale on the first DQ a human answers differently from the recommendation.
# The "Requirements (drafted under the recommended options)" note under each FR says which
# option it assumes; `implements:` is left for Plan, once Clarify records real answers.
# No `affects:` either: every file this spec's FRs name below
# (`artifact-graph.ts`, `epic-manager.ts`, `adr-manager.ts`, `spec.ts`) is read, not
# modified — FR-4 is explicit that this spec must not add exports or fields to them. A
# read-only dependency is not a touched file.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-098: Dependency-graph explorer — specs/DRs/epics as clickable, colour-coded nodes

> **SPECIFICATION ONLY.** This dispatch (issue #48, tier T3 under DR-076's tier-gated
> HITL dispatch) is authorised for the Specify phase alone. Nothing is built from this
> document until a human reads it, answers the three open Clarify decisions below (or
> accepts the recommended option on each by approving this spec unchanged), and approves
> it through the normal spec-approval gate.

Materializes **[#48](https://github.com/AIClarityAU/minspec/issues/48)** — *"an
on-the-fly clickable animated dependency map ... a minimap with just clickable document
ids (colour coded by status), with an expand button to show a bigger version with extra
detail in each node, like title, epic, status."* The issue's title claims this subsumes
**[#182](https://github.com/AIClarityAU/minspec/issues/182)** and
**[#211](https://github.com/AIClarityAU/minspec/issues/211)**; this dispatch ran with no
network access and could not read either issue to check that claim, so it is relayed
here unverified (Evidence Discipline) rather than asserted. **Before closing #182/#211 as
duplicates, read them and confirm they describe the same surface** — if either asks for
something this spec's scope (§Out of Scope) excludes, it should stay open or be narrowed,
not closed.

## One-Sentence Scope

Add a read-only, offline, additive MinSpec explorer surface — a compact "minimap" tree of
Epic/Spec/DR nodes colour-coded by status plus an expand command that opens an animated
graph webview showing each node's id, title, epic and status, with every node linked by
existing frontmatter edges (`epic:`, `depends_on`, `relates_to`, a resolvable
`triggered_by`) and clickable to open the underlying file — with no new node kind, no new
network call, and no change to any existing pane's behaviour.

## Context

### What already exists — this is a decoration layer, not a new graph engine

[DR-013](../../../docs/decisions/DR-013.md) registered Epics as a grouping dimension and
added `epic:` frontmatter to specs and DRs. [SPEC-012](../SPEC-012-next-task-resolver/requirements.md)
then built the thing this spec's edges are read from:
[`buildArtifactGraph`](../../../packages/minspec/src/lib/artifact-graph.ts#L490) walks the
workspace and returns an `ArtifactGraph` — `EpicNode[]`, `SpecNode[]`, `AdrNode[]`, and an
`Edge[]` built from the `depends_on` / `supersedes` / `relates_to` frontmatter arrays
(`artifact-graph.ts:102`, `:115-120`), with every status derived through the project's own
`deriveStatus` rather than trusted off the literal frontmatter line
(`artifact-graph.ts:12-16`, INV-FIDELITY). That graph already exists, is already tested,
and is the right source for this pane's edges and statuses — **this spec must not
reimplement frontmatter-edge parsing** (FR-4).

It is not, by itself, enough to render: `EpicNode` / `SpecNode` / `AdrNode`
(`packages/shared/src/next-task.ts:78-154`) carry `id`, `status`, `tier`, `epic`,
ranking dials — no `title`. That is deliberate, not an oversight: SPEC-012's own
frontmatter note records "`explorer decoration`" as explicitly "out of this slice."
Titles already exist elsewhere and are already parsed — `ParsedSpec.title`
(`packages/minspec/src/lib/spec.ts:47`, derived from the spec's H1 when no frontmatter
`title:` is set, `:292-294`), `EpicSummary.title` (`epic-manager.ts:15`, `:147-148`), and
`AdrSummary.title` (`adr-manager.ts:18`, `:28`) via `listEpics` / `listAdrs` / `parseSpec`.
This spec's job is to join the two: resolver-shaped graph (edges + derived status) plus
the human-facing readers (titles), into a display model neither one is today.

**No node kind exists yet for issues or pull requests**, despite the issue's title asking
for them. Issues are fetched separately, over the network, through `fetchIssues`
(`packages/minspec/src/lib/backlog.ts`) — a call the Backlog pane already makes with no
consent gate in front of it. That gap is a named, open, release-blocking defect: DR-100 §P2
records it as "open" against constitution invariant 1 and names
[SPEC-085](../SPEC-085-backlog-fetch-consent/requirements.md) (`status: specifying`, not
built) as the fix in flight. There is no pull-request data source in the extension at all
today (searched `packages/minspec/src` for a PR fetch; none exists). Adding issue or PR
nodes to a new pane now would add a second unconsented-network surface on top of one the
project already has open as a release blocker. §Decisions needed DQ-1 addresses this
directly.

### This is named, explicitly, as Phase 2 work

The constitution's Phase 1 line (`.minspec/constitution.md:88-98`) lists what must be true
before Phase-1 work stops outranking Phase-2 work, and its very next line
(`:97-98`) names **"DAG-viz polish"** as one of the items **explicitly out of Phase 1**,
alongside Marketplace publish and public onboarding. This issue is exactly that item.
[DR-100](../../../docs/decisions/DR-100.md) — accepted the day before this dispatch —
is the record of the founder asking for the Marketplace preview "just before the
visualiser work," naming this as the next thing in the queue, not something to build
ahead of it. Writing the spec now (this dispatch) does not displace Phase-1 work; building
from it would, unless Phase 1's checklist is complete or the founder explicitly sequences
it the way DR-100 already does for the publish. §Decisions needed DQ-4 states this as a
sequencing question for the human approving this spec, not a technical one for Plan.

### Prior art for the two surfaces this pane needs

- **A tree-based pane with click-to-open.** `spec-tree-provider.ts:211` and
  `adr-tree-provider.ts:70` both resolve a tree item's click to the built-in
  `vscode.open` command against the artifact's file — the pattern FR-5 reuses rather
  than inventing a new navigation mechanism.
- **A custom webview panel.** `spec-panel.ts` / `spec-panel-html.ts` already host a
  richer HTML/CSS/JS surface than a TreeView can (SPEC-017's trust charts live there
  too) — the pattern the expanded graph view (FR-7) would follow if DQ-2 resolves to a
  webview for the expanded form.
- **Existing status vocabularies**, already rendered as icons today: spec statuses
  (`spec-tree-provider.ts` `statusIcon`, `:96-`), ADR statuses (`adr-tree-provider.ts`),
  epic statuses (`proposed | active | done | abandoned`, DR-013). FR-3 reuses these
  taxonomies; it does not invent a fourth one.

## Functional Requirements

Each FR is written under the **recommended** option of the Clarify decision it depends
on (§Decisions needed). Approving this spec unchanged accepts those recommendations.

- **FR-1 — Node scope is Epic / Spec / DR only, v1.** *(DQ-1, Option A)* The graph's nodes
  are drawn only from `EPIC-NNN`, `SPEC-NNN` and `DR-NNN` artifacts already on disk. No
  issue node, no pull-request node, and no network call of any kind. This is a hard
  requirement, not a starting guess: a later spec may extend the node-kind set once
  SPEC-085's consent gate exists (FR-9 keeps the shape open for that).

- **FR-2 — A minimap pane in the MinSpec explorer group.** A new view (view id
  `minspecGraph`, alongside the existing `minspecStatus` / `minspecAdrs` / `minspecBacklog`
  entries, `package.json:288-300`) lists every in-scope node. Each entry shows the
  artifact id and is colour-coded by status (FR-3). It is read-only: no edit, no delete,
  no drag target (distinct from `epic-dnd-controller.ts`, which this spec does not touch).

- **FR-3 — One status colour mapping across all three artifact kinds.** The three kinds
  use different status vocabularies (spec: `new|specifying|planning|implementing|done|
  archived|superseded`; DR: `proposed|accepted|deprecated|superseded`; epic:
  `proposed|active|done|abandoned`). This spec MUST define one documented mapping from
  every value in all three vocabularies onto a small shared set of semantic buckets (e.g.
  draft / in-progress / done / inactive — the exact bucket names and colours are a Plan-phase
  design-token choice, not fixed here) so a node's colour means the same thing regardless
  of artifact kind. A status value absent from the mapping MUST render in an explicit
  "unknown" colour and MUST NOT silently fall back to any real bucket — a wrong guess at a
  node's colour is a false signpost (constitution G-4, never a list, never wrong) applied
  to a map instead of a list.

- **FR-4 — Edges and statuses are read from the existing graph, never re-derived.** The
  node set's status MUST come from `deriveStatus` via `buildArtifactGraph` /
  `listEpics` / `listAdrs` (the same functions SPEC-012 and the existing explorer panes
  already call), not from a second parse of the literal `status:` frontmatter line
  (INV-FIDELITY, carried over from `artifact-graph.ts:12-16`). Edges MUST come from the
  same `depends_on` / `supersedes` / `relates_to` arrays `artifact-graph.ts` already
  parses (`EDGE_KINDS`, `:102`), plus one this spec adds: an epic-membership edge from
  each spec/DR's `epic:` field to its `EPIC-NNN` (already resolved by `resolveEpic` /
  `epicRefValue` in `epic-manager.ts`), and a `triggered_by` edge **only** when that
  field's value is itself a bare `#NNN` or a `.../issues/NNN` URL — a prose value (e.g.
  DR-100's own `"Founder, 2026-10-01: ..."`) produces no edge, never a guessed one. This
  spec MUST NOT add a field, export, or edge kind to `artifact-graph.ts`,
  `packages/shared/src/next-task.ts`, `epic-manager.ts` or `adr-manager.ts` — it reads
  them as they stand (ownership stays with SPEC-012 / DR-013; see the frontmatter note on
  why no `affects:` is declared).

- **FR-5 — Click a node to open its file.** Clicking a node (minimap or expanded view)
  opens the underlying Markdown file in the editor, the same `vscode.open` pattern the
  Specs and Decisions panes already use (`spec-tree-provider.ts:211`,
  `adr-tree-provider.ts:70`). No preview-only mode, no custom editor.

- **FR-6 — An expand command, not a second standing pane.** A command (and a toolbar
  button on the minimap's view header, the `view/title` pattern `package.json` already
  uses for the other panes) opens the larger graph view. It is opened on demand, never
  shown at activation (constitution principle 2 / 4, no nagging — `INV-6` precedent in
  SPEC-096's own invariants).

- **FR-7 — The expanded view shows id, title, epic and status per node, with an
  animated layout.** *(DQ-2, Option A; DQ-3, Option A)* The expanded view is a webview
  panel (`spec-panel.ts` / `spec-panel-html.ts` pattern). Each node renders its id, title
  (from `ParsedSpec.title` / `EpicSummary.title` / `AdrSummary.title`), its epic (if any)
  and its status colour (FR-3). The layout MUST be computed, not hand-placed (an animated
  force-directed or layered layout is what the issue asks for), and MUST respect the
  OS/editor's reduced-motion preference (the webview's `prefers-reduced-motion` media
  query) by freezing to its settled positions with no animation when that preference is
  set. The minimap (FR-2) stays a plain VS Code TreeView — no animation, no webview — and
  is not required to render title/epic text, only id and colour, per DQ-2.

- **FR-8 — Degrades, never hangs or crashes, on the corpus's real size.** Measured on
  this repository (`find specs -name 'SPEC-*' -type d`, `docs/decisions/*.md`): roughly
  100 specs and 100 decision records today, growing. The pane MUST remain responsive
  (no UI-thread block perceptible as a hang) at that scale, and above a stated node-count
  threshold (a Plan-phase measurement, not guessed here) MUST offer a way to narrow the
  view (e.g. by epic or status) rather than silently rendering slower and slower or
  silently dropping nodes. An empty workspace (no specs/DRs/epics at all) renders an
  empty, well-formed graph — never a throw (mirrors `artifact-graph.ts`'s own
  INV-DEGRADE for the same reason).

- **FR-9 — The node/edge shape stays extensible for the deferred kinds.** Because FR-1
  excludes issues and pull requests from v1 by decision (not by accident), the internal
  node type this spec introduces MUST be a discriminated union keyed by kind (`'epic' |
  'spec' | 'adr'`) rather than three unrelated shapes, so that a future spec can add
  `'issue' | 'pr'` kinds — gated behind SPEC-085's consent flow once it exists — without
  rewriting the renderer. This is a shape requirement for Plan, not a promise that the
  future kinds will be built here.

- **FR-10 — This pane is not a second signpost.** It MUST NOT compute or imply a
  priority ordering ("do this one next") distinct from the Next-Task Resolver
  (SPEC-012, `packages/shared/src/next-task.ts`). If a later iteration wants to
  highlight "the next task" node, it MUST call the resolver's own output rather than
  re-scoring artifacts — two independent rankings that can disagree is exactly the
  failure class EPIC-002 (Signpost Integrity) exists to prevent.

- **FR-11 — Purely additive.** No existing view, command, or stored file changes
  behaviour. No `.minspec/` file is read or written by this pane (it reads
  `specs/`, `docs/decisions/`, `docs/epics/` directly, as the existing panes already do);
  no setting changes its default; no command fires automatically at activation.

## Acceptance Criteria

- [ ] The `minspecGraph` minimap view appears in the MinSpec explorer group, lists every
      spec/DR/epic in the workspace, and each entry is colour-coded per FR-3's mapping.
      (FR-1, FR-2, FR-3)
- [ ] A status value not covered by the mapping renders in the explicit "unknown" colour,
      not in any real bucket's colour. (FR-3)
- [ ] Clicking a minimap entry opens that artifact's file via `vscode.open`. (FR-5)
- [ ] The expand command opens a webview graph showing every in-scope node's id, title,
      epic and status, connected by `depends_on` / `supersedes` / `relates_to` / epic-
      membership / resolvable-`triggered_by` edges — and no edge for a `triggered_by`
      value that is prose rather than an issue reference. (FR-4, FR-7)
- [ ] With the OS/editor reduced-motion preference set, the expanded view renders with no
      animation. (FR-7)
- [ ] Clicking a node in the expanded view opens its file, same as the minimap. (FR-5)
- [ ] No node for a GitHub issue or pull request appears anywhere in either view. (FR-1)
- [ ] In an empty workspace, both views render empty with no error. (FR-8)
- [ ] At the repository's current scale (~100 specs, ~100 DRs), opening the expanded view
      does not perceptibly hang the editor. (FR-8)
- [ ] No new network call is made by either view (a test asserts the module tree reachable
      from both views makes no `fetch`/`https`/`gh`/`git fetch` call). (FR-1, INV-1)
- [ ] `artifact-graph.ts`, `next-task.ts`, `epic-manager.ts` and `adr-manager.ts` are
      byte-identical before and after this change lands (no export, field, or edge kind
      added to any of them). (FR-4)

## Invariants (must not break)

- **INV-1 — Offline core (constitution invariant 1).** Zero network calls anywhere in
  this pane's v1 scope. Not "no new unconsented call" — none at all, full stop, since
  there is nothing in scope (FR-1) that would need one.
- **INV-2 — No fabricated edges or colours.** An edge is drawn only when its source
  frontmatter unambiguously resolves to it (FR-4); a status is coloured only per a
  declared mapping entry, never guessed (FR-3). Both failure directions read as the same
  false-signpost risk the never-wrong principle (G-4) already names for the list-shaped
  signpost, applied here to a graph-shaped one.
- **INV-3 — Blast radius (constitution invariant 3).** This pane writes nothing — no new
  `.minspec/` file, no new setting default, no telemetry, no remote content loaded into
  the webview (CSP restricted to the extension's own bundled assets, mirroring whatever
  `spec-panel-html.ts` already does for its webview).
- **INV-4 — Single source of truth for priority (FR-10).** No second ranking of "what to
  do next" is introduced.
- **INV-5 — SPEC-012 / DR-013 ownership is undisturbed.** No file any other spec's
  `implements:` names is modified by this one (FR-4's closing sentence).
- **INV-6 — No nagging.** The expanded view opens only on explicit command/button, never
  at activation, never repeating (constitution principles 2 and 4).

## Decisions needed (Clarify)

Every decision below carries a recommended option and its cost, per the project's
decision-shaped-gate convention. The FRs above are written assuming every recommendation
is taken; approving this spec unchanged ratifies all four. A different choice on any one
changes only the FRs that name it.

### DQ-1 — Does v1 include issue and/or pull-request nodes, as the issue's title literally asks?

- **Option A — no; Epic/Spec/DR only, fully offline (rec).** FR-1, FR-9. Ships the part
  of the ask that needs no new consent surface, and keeps the node/edge shape open for
  issues/PRs once SPEC-085 lands. *Cost:* does not fully satisfy issue #48's title on the
  first pass, and #182/#211 may only be partially subsumed — whoever triages those after
  this spec is approved should check, not assume (see the unverified-claim note above).
- **Option B — include issue nodes now, behind their own new consent prompt in this
  pane.** *Cost:* a second, independently-built consent UX sitting next to SPEC-085's
  (not yet built) one for the same underlying `gh`/network call — two gates for one
  decision, which is itself the kind of inconsistency invariant 2 (no silent gate) warns
  about when one of the two can be satisfied without the other.
- **Option C — wait for SPEC-085 to land, then build this spec as one unit including
  issues/PRs.** *Cost:* this spec cannot proceed to Plan until an unrelated spec, not
  currently in progress, ships first — an open-ended wait with no date, for a feature
  already named Phase 2.

### DQ-2 — What renders the minimap, and what renders the expanded view?

- **Option A — native TreeView minimap; webview only for the expanded view (rec).** FR-2,
  FR-6, FR-7. Reuses the existing pane pattern for the always-visible surface (cheapest,
  most consistent, no CSP/bundle concern in the sidebar) and reserves the richer,
  heavier webview for the on-demand expanded view. *Cost:* the minimap itself is not
  animated and shows id + colour only, less visually rich than the issue's sketch
  describes for the compact form.
- **Option B — a webview for both.** *Cost:* an always-present webview in the sidebar
  (content-security-policy surface, bundle size, no native TreeView affordances like
  multi-select or the editor's built-in filter) for a view that is open far more of the
  time than the expanded one.

### DQ-3 — What computes the animated layout?

- **Option A — hand-rolled layout, zero new dependencies (rec).** FR-7. At this
  repository's scale (FR-8: ~100-200 nodes) a simple layered or force-directed layout is
  a bounded, testable amount of code, and keeps the T3 dependency budget (0-1 simple
  dependency) at zero. *Cost:* lower layout quality than a mature library, and more
  first-party code to maintain and test.
- **Option B — adopt a vetted graph-layout library (e.g. a force-simulation package).**
  *Cost:* one new dependency MinSpec ships to every adopter, which — per DR-100 §P6's
  precedent for the Marketplace preview — needs a supply-chain catalog check before
  release and adds to the webview bundle every install carries, for a feature named
  explicitly out of Phase 1.

### DQ-4 — When does Plan start, given the constitution names this item Phase 2?

- **Option A — approve the spec now; hold Plan/Tasks/Implement until Phase 1's exit
  checklist is met, or the founder explicitly sequences this item ahead of it the way
  DR-100 already sequenced the Marketplace preview (rec).** *Cost:* an approved spec that
  sits unbuilt for an unknown stretch — ordinary for backlog, but worth naming so
  approval is not read as "build this next."
  - **Note for the human on this line (not a Clarify option, since it is the human's own
    sequencing act, not a design choice):** DR-100 already names "the visualiser work" as
    following the Marketplace preview "about a week out," so the gap this spec expects
    may already be short, if the founder intends #48 to be that visualiser.
- **Option B — treat this as incremental Phase-2 polish the constitution allows
  ("as long as no Phase-2 item displaces an unmet Phase-1 item") and schedule Plan
  immediately.** *Cost:* requires arguing, each time, that this specific item does not
  displace a specific unmet Phase-1 item, rather than holding the line the constitution's
  own checklist draws.

## Why no new DR

Every recommended option above is additive and fully revertable inside a day: new files,
no schema change, no migration, one dependency at most (and the recommended DQ-3 option
takes zero). None crosses the reversibility filter. A DR becomes necessary only if DQ-3
resolves to Option B (a new third-party dependency shipped in the extension bundle to
every adopter is the kind of supply-chain-relevant choice DR-100 §P6 already treats as
needing a recorded check) — Plan must not proceed on that option without one.

## Out of Scope

- **Issue and pull-request nodes.** DQ-1. Tracked as a follow-up once SPEC-085 lands;
  not filed as a separate issue here because DQ-1's own options already carry it.
- **Editing anything from the graph.** No drag-to-reorder, no inline status change, no
  delete. Read-only navigation only (FR-2).
- **A second "next task" computation.** FR-10 / INV-4. This pane shows the whole graph;
  it never replaces or duplicates the resolver's single answer.
- **The Backlog pane's existing unconsented `fetchIssues` call.** Already tracked as
  DR-100 §P2 / SPEC-085; this spec does not touch `backlog.ts` or `backlog-view.ts`.
- **Deciding #182 / #211's fate.** Noted above as unverified; left to whoever reviews
  this spec with network access.

## Alternatives considered and rejected

Recorded because this spec was written without a live conversation (DR-086 §4).

- **Extending `ArtifactGraph` (`next-task.ts`) with a `title` field directly.** Rejected:
  that type is consumed by the Tier-0 resolver and owned by SPEC-012; widening it for a
  display concern SPEC-012's own frontmatter note calls "out of this slice" would freeze
  a file this spec does not own and couple the resolver's contract to a UI pane's needs.
- **Building issue/PR support first, visualisation second.** Rejected: the issue's own
  idea is the visual map; the issue/PR data source is a separate, already-tracked gap
  (SPEC-085) with its own consent design still open. Sequencing the map behind it (DQ-1
  Option C) was considered and rejected as an open-ended wait on unrelated work.
- **A single webview for both the minimap and the expanded view (DQ-2 Option B).**
  Considered for visual consistency with the issue's sketch; rejected as the
  recommendation because the minimap is visible far more often than the expanded view,
  and a TreeView costs nothing extra the project does not already pay for the other two
  panes.

## Traceability

- **Issue:** [#48](https://github.com/AIClarityAU/minspec/issues/48).
- **Claimed duplicates, unverified (no network this dispatch):**
  [#182](https://github.com/AIClarityAU/minspec/issues/182),
  [#211](https://github.com/AIClarityAU/minspec/issues/211).
- **Governing decisions:** [DR-013](../../../docs/decisions/DR-013.md) (epic registry,
  the grouping dimension this pane renders), [DR-100](../../../docs/decisions/DR-100.md)
  (names this as "the visualiser work" following the Marketplace preview, and is the
  source for DQ-4's sequencing note).
- **Specs this reads from (not modifies):**
  [SPEC-012](../SPEC-012-next-task-resolver/requirements.md) (`artifact-graph.ts`, the
  edge/status source, FR-4), [SPEC-017](../SPEC-017-trust-dashboard/requirements.md) (the
  webview-host pattern FR-7 follows), [SPEC-085](../SPEC-085-backlog-fetch-consent/requirements.md)
  (the consent gate DQ-1 defers issue/PR nodes behind).
- **Epic:** [EPIC-001](../../../docs/epics/EPIC-001-epic-grouping.md).
- **Constitution:** `.minspec/constitution.md:88-98` (Phase 1 exit checklist and the
  explicit "DAG-viz polish" Phase-2 listing, DQ-4); invariants 1-3 (INV-1 to INV-3 above).
- **DR for this spec:** none; see "Why no new DR" for the one condition that would
  require it.
