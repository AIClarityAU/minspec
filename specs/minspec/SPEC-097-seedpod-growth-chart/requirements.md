---
id: SPEC-097
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-002  # Signpost Integrity — visualizes the same spec-before-code thesis the signpost enforces; a chart that misstates "approved"/"tested" is a false signpost in a different shape
aspects: [ux, data]
relates_to: [DR-038, DR-039, SPEC-012, SPEC-014, SPEC-010, SPEC-096, "#99"]
implements: none
implements_reason: >-
  Specified, not built. No webview, command, or data module for this feature exists today:
  zero hits for "seedpod" or "pod chart" anywhere in packages/minspec/src, the only
  createWebviewPanel caller is the pre-existing spec-panel.ts (which SPEC-014's own Context
  section already distinguishes from a new surface), and git-analyzer.ts's line-count helpers
  measure one diff (current staged/working change), not a historical time series. This is the
  Specify-phase artifact for #99; Plan will declare the owned files once DQ-1/DQ-3 below are
  answered, since the answer changes which files this spec would own.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Seedpod chart: doc scope vs. tested-code growth over time (Requirements)

> **This is a SPECIFICATION ONLY.** No webview, command, chart library, or data module is
> created by this document. It is the Specify-phase artifact for
> [#99](https://github.com/AIClarityAU/minspec/issues/99), which the deterministic triage
> gate classified **T3/T4** (DR-076 / #1169) — Specify is the authorised phase, the spec is
> the gate, nothing is built from it until a human reads and approves it.

## One-Sentence Scope

Add a webview chart, opened by an explicit MinSpec command, that plots cumulative
documentation lines (the top edge) against cumulative tested-code lines (the bottom edge)
over the project's git history from a shared zero point, so the shape of the two curves —
and how far apart they still are — reads as a visual proxy for how close the project is to
"spec led, code caught up."

## Context

### The request, verbatim (issue #99)

> it would be nice to have a "seedpod" shaped chart that shows scope (lines of documentation
> in the project) growing over time (the top edge of the seedpod), with another line (the
> bottom edge) starting at the same zeropoint, showing the implementation (lines of tested
> code in the project) growing to meet it. a completed project shows the doco growing fast at
> the start
>
> perhaps if we can also show the amount of approved doco and code by changing each arc into
> a thin bendy bar-graph, green for the amount approved/tested, orange for the amount
> unapproved

### Why this belongs in EPIC-002, not a new epic

EPIC-002's goal is that MinSpec's signpost "always tells the developer ... the single next
SDD action" and is "never wrong"
(`docs/epics/EPIC-002-signpost-integrity.md:12-16`). This chart is not the signpost itself —
it answers a different question ("how is this project tracking, overall, over time?" vs. the
signpost's "what do I do right now?") — but it draws on the exact same ground-truth sources
SPEC-010/SPEC-012 already treat as authoritative (spec status, approval records), and it is
explicitly a visualization of the methodology's own thesis: spec precedes code, and a healthy
project's code grows to close the gap. A chart that overstates "approved" or "tested" would
be a false signpost in a different shape, so it inherits EPIC-002's never-wrong discipline
even though it is not itself a gate. [SPEC-014](../SPEC-014-review-webview/requirements.md)
(the only other webview this product ships) lives in the same epic for the same reason: it is
a *surface*, not a new source of truth.

### What already exists that this spec can reuse — and what it cannot

Read at `origin/main` (worktree HEAD) on 2026-10-03, not inferred:

- **Git access.** `simple-git` is already a dependency, used today for per-diff line/file
  counts in the tier classifier (`packages/minspec/src/lib/git-analyzer.ts:14-47`). Those
  helpers measure one change (staged or working tree) — nothing in the repo walks commit
  history to build a time series. This spec would be the first consumer that does.
- **"Approved" ground truth.** `packages/minspec/src/lib/approval-store.ts` already holds a
  deterministic, hash-pinned record of when a spec/DR was approved — the same ground truth
  `resolveStatus` and the approve gate already trust (`approval.ts`, `spec-validator.ts`).
  This is a real signal for "approved doc," not a heuristic that would need inventing.
- **"Tested" ground truth exists, but only for *now*, not history.** `@vitest/coverage-v8` is
  already wired: CI runs `npx vitest run --coverage --coverage.reporter=json-summary`
  (`.github/workflows/ci.yml:184`) and reads `coverage/coverage-summary.json`
  (`.github/workflows/ci.yml:191`), gated against a configured minimum
  (`.minspec/config.json`'s `coverage.minimumPercentage`, read at `vitest.config.ts:11`).
  That gives a real, per-file coverage percentage **at HEAD**. It gives nothing for any
  earlier commit: coverage reports are not committed or archived anywhere, so a historical
  point on the bottom edge cannot read "X% covered at commit Y" without re-deriving it.
- **No whole-tree historical snapshot exists.** The only git objects MinSpec pins today are
  per-spec approval baseline blobs under `refs/minspec/snapshots/*`
  (`approval.ts:120-170`, carried into this repo's convention by SPEC-096's trace) — one
  spec's body, not a whole-tree line count, and not something this chart can read as a
  repo-wide series.

So the top edge (documentation lines) has a cheap, accurate historical source (`git log` +
line counts, no execution needed). The bottom edge (*tested* code lines, historically) does
not — re-deriving true historical coverage means re-running the test suite at every sampled
historical commit, which is exactly the kind of expensive, unbounded background computation
the constitution's "no new work at activation" principle and this spec's own performance
requirement (FR-8) rule out as a default. That asymmetry is the spec's central design
question and drives DQ-3 below.

### Tier-0 reframe

Nothing about this feature needs a network call. All of git history, all of coverage, and all
of approval state live in the local checkout. If a charting library is added, it MUST ship
bundled with the extension (no CDN `<script src>`), exactly as the existing webview
(`spec-panel-html.ts`) already does. This is constitution invariant 1 applied to a new
surface, not a new boundary.

## Functional Requirements

- **FR-1 (documentation time series).** The feature MUST compute cumulative lines of
  documentation — files under the configured `specsDir` and `decisionsDir`
  (`.minspec/config.json`, the same keys SPEC-075 reads) — at a bounded set of sampled points
  across the default branch's git history, using local `git log`/`git show` only. No test
  execution and no network call is required or permitted for this edge.

- **FR-2 (tested-code time series, signal TBD by DQ-3).** The feature MUST compute a "tested
  code" metric at the same sampled points, using whichever signal DQ-3 selects. Whichever
  signal is chosen MUST be computable without re-running the test suite at each historical
  sample (ruled out by the cost note in DQ-3 and by FR-8). A sampled point for which the
  signal cannot be computed (e.g., the test runner or coverage format did not exist at that
  commit) MUST render as a visible gap, never an interpolated or repeated guess — the chart
  must not assert data it does not have.

- **FR-3 (shared zero point, converging read).** Both edges MUST originate from one shared t0
  (the earliest sampled commit, or the repository's root commit). The chart MUST let a reader
  see the two edges converge as code catches up to doc, without the chart itself asserting a
  numeric "% complete" — the underlying signals (line counts, not semantic completeness)
  cannot support that claim, and asserting it would be exactly the false-precision defect
  `.minspec/constitution.md` invariant 2's spirit and DR-087's forbidden-claim-word gate both
  exist to catch in other surfaces.

- **FR-4 (approval/test-state overlay — the "bendy bar" variant).** When enabled (default
  decided by DQ-5), each edge MUST render as a variable-thickness band: thickness encodes
  cumulative line volume, color encodes state — green for lines covered by the "approved"
  (doc) / "tested" (code) definition FR-1/FR-2 establish, orange for everything else. An
  ambiguous or unknown state MUST render orange, never green — the chart must never show more
  certainty than the underlying data supports.

- **FR-5 (surface and trigger).** The chart MUST ship as a VS Code webview panel, opened only
  by an explicit MinSpec command (exact placement decided by DQ-6) — never opened
  automatically at activation or on a timer (constitution principle against nagging, the same
  rule SPEC-014's panel already follows).

- **FR-6 (scope — whole-project vs. per-package).** The feature MUST key its directory
  boundaries off the same `specsDir`/`decisionsDir`/package layout the rest of the extension
  already uses — no new directory-naming convention. Whether the first increment aggregates
  the whole project or breaks out by package is decided by DQ-6.

- **FR-7 (Tier-0, offline, no new network surface).** The entire computation path (git walk,
  line counting, coverage-signal read, rendering) MUST execute with zero network calls and
  introduce no new entry to `CHILD_PROCESS_ALLOWLIST` beyond `git` itself, which is already
  allowlisted. Any charting library added MUST be bundled with the extension, never fetched
  from a CDN at render time (constitution invariant 1).

- **FR-8 (performance bound, no unbounded background work).** The data computation MUST NOT
  run at activation and MUST NOT block the editor. It MUST be cached and recomputed only via
  an explicit user action (a refresh command/button) or a stated bounded staleness window —
  never silently on every save. The sampling strategy (how many historical points, how they
  are chosen) MUST carry a stated wall-clock budget, decided by DQ-4.

- **FR-9 (blast radius).** Any cache file this feature writes MUST live under `.minspec/` in
  a project that has already opted in (constitution invariant 3, SPEC-096's opt-in-marker
  rule), MUST be safe to delete at any time (purely derived, recomputable from git + coverage,
  never the sole copy of anything), and MUST NOT be created by any code path that runs before
  the project has opted in.

## Acceptance Criteria

- [ ] The documentation-lines series (FR-1) is computed from local git history only, with no
      process spawned other than `git`. (FR-1, FR-7)
- [ ] The tested-code series (FR-2) never re-executes the test suite at a historical sample
      point, and a sample it cannot compute renders as a visible gap, not an interpolated
      value. (FR-2, FR-8)
- [ ] Both edges render from one shared zero point, and no numeric "% complete" label appears
      anywhere on the chart. (FR-3)
- [ ] With the bendy-bar overlay enabled, a line whose state cannot be determined renders
      orange, never green. (FR-4)
- [ ] The chart's webview is never opened except in direct response to the command named by
      DQ-6; it does not open at activation, on a timer, or as a side effect of any other
      command. (FR-5)
- [ ] No network call occurs anywhere on the command's path, and no charting dependency is
      loaded from a remote URL at render time. (FR-7)
- [ ] Recomputing the chart twice in a row without new commits does not re-walk git history
      the second time — the cached result is served, visibly labelled with when it was last
      computed. (FR-8)
- [ ] Any file this feature writes lives under `.minspec/`, only in a project where
      `.minspec/` already exists, and deleting it causes no error on the next chart open (just
      a recompute). (FR-9)

## Invariants (must not break)

- **INV-1 (offline core, constitution invariant 1).** No network call anywhere in this
  feature's path; no new child process beyond `git`.
- **INV-2 (honest degradation).** A sample point this feature cannot compute is shown as a
  gap. It is never guessed, interpolated, or silently dropped in a way that makes the series
  look more complete than it is.
- **INV-3 (blast radius, constitution invariant 3).** Any new file this feature writes is
  under `.minspec/`, in an opted-in project only, and never required for anything else to
  function.
- **INV-4 (no nagging, constitution principle).** The chart is opened only on explicit user
  request; it never appears unprompted.
- **INV-5 (no false precision).** The chart does not assert "approved"/"tested" for a line it
  cannot actually attribute to the FR-1/FR-2/DQ-3 ground truth, and it does not render a
  completion percentage the underlying line-count signals cannot support.

## Decisions needed (Clarify)

Each decision below names the option this spec recommends and its cost, per CLAUDE.md's
decision convention. None is answered by guessing; Plan should not start until each has a
recorded selection.

### DQ-1 — Data source for the time axis

- **Option A — walk git history directly at sampled points (`git log`/`git show`), computed
  on demand and cached (rec).** No new persistent store, no new `.minspec/` writer, reuses
  the already-present `simple-git` dependency. *Cost:* a large repo's full history makes the
  sampling strategy (DQ-4) load-bearing, and tracking a file through renames
  (`git log --follow`) has known gaps when authorship/attribution tools disagree on a rename.
- **Option B — an event-sourced snapshot log, appended to at each commit or approval event.**
  Cheaper to read once built. *Cost:* a brand-new append-only store under `.minspec/` is a
  new writer that SPEC-096's opt-in-marker rule and inventory test would need to account for,
  needs its own schema/migration story, and still has nothing for history that predates its
  own adoption — so Option A's walk is needed anyway to backfill it. This option would also
  need its own DR (see "Why no new DR" below).

### DQ-2 — "Approved doc" signal

- **Option A — reuse `approval-store.ts`'s existing hash-pinned approval records (rec).**
  Same ground truth `resolveStatus` and the approve gate already trust; no second approval
  concept invented. *Cost:* only covers specs/DRs that go through the approval flow — a bare
  prose file under `docs/` with no approval sidecar has no signal and must read as "unknown,"
  not quietly folded into either "approved" or "unapproved."
- **Option B — a text-match heuristic against frontmatter `status:` alone.** Simpler to
  compute. *Cost:* this is exactly the stale-status-without-hash-check failure class
  CLAUDE.md's Evidence Discipline section exists to prevent (a spec's content can change after
  `status:` was last written); not recommended.

### DQ-3 — "Tested code" signal (the hardest question; no existing historical infra)

- **Option A — `coverage/coverage-summary.json` (already produced by CI, FR-2's "now" point)
  for the current sample, paired with a cheaper file-existence proxy for every historical
  sample — "does a mapped test file exist for this source file at this commit," answerable
  via `git show <sha>:<path>` with no test execution (rec).** *Cost:* the two ends of the
  series are not apples-to-apples (today = a real percentage, history = a coarser presence
  heuristic); the chart's own legend/tooltip MUST say which kind of "tested" applies at each
  point, so the asymmetry is visible rather than hidden (ties to INV-5).
- **Option B — re-run the full test suite with coverage at every sampled historical commit.**
  Most accurate. *Cost:* for N sampled points this is N full checkout-and-test cycles; on this
  repo's own history that is minutes-to-hours per run, explicitly in conflict with FR-8's
  performance bound. Ruled out as a default; could exist later as an explicit, clearly-slow
  "deep recompute" action, never the normal path.
- **Option C — one consistent file-level heuristic (lines in files with ≥1 mapped test file)
  used at every point, current and historical alike, dropping true coverage percentage
  entirely.** *Cost:* coarser than real coverage everywhere (a file can have a test and still
  be mostly untested), but internally consistent across the whole series, which may matter
  more for a shape chart than for point accuracy.

### DQ-4 — Sampling budget and performance

- **Option A — a fixed, bounded sample count (e.g., weekly or every Nth commit, with a stated
  wall-clock ceiling per computation), cached under `.minspec/` and refreshed only by explicit
  action (rec).** *Cost:* a sample bucket can land on a messy mid-feature commit, hiding
  short-lived spikes within that bucket — acceptable for a shape chart, not for point
  precision.
- **Option B — incremental background computation on editor idle, extending the series one
  point at a time.** *Cost:* a background walker is a bigger surface to get wrong than an
  explicit command, and conflicts with the constitution's "no new work at activation"
  principle and INV-4's no-nagging rule.

### DQ-5 — Ship the bendy-bar/color overlay (FR-4) now or later

- **Option A — out of scope for the first increment; ship the plain two-edge pod chart
  (FR-1–FR-3) first, track FR-4 as a numbered follow-up issue once DQ-2/DQ-3's signals are
  proven (rec).** *Cost:* the issue's most visually distinctive idea — the thing that makes
  this a "seedpod" rather than a generic two-line chart — ships later.
- **Option B — build both in the same Plan/Tasks cycle.** *Cost:* couples two open signal
  questions (DQ-2, DQ-3) and a new rendering mode into one change, which is already T4-sized
  before FR-4, and delays any shippable version behind this spec's hardest open question
  (DQ-3).

### DQ-6 — Placement and per-package granularity

- **Option A — a standalone command-opened webview panel, whole-project aggregate first; a
  per-package breakdown is a follow-up once the aggregate view is validated (rec).** *Cost:* a
  monorepo adopter who wants one package's shape specifically (e.g., `packages/minspec` vs.
  `packages/shared`) does not get that view in the first increment.
- **Option B — embed it as a companion inside the existing next-task signpost surface from
  the first increment**, as the issue itself suggests. *Cost:* couples this feature's approval
  and build schedule to SPEC-012/SPEC-014's signpost surface, and the signpost is held to
  EPIC-002's "never wrong" bar — this chart's necessarily-approximate historical signal
  (DQ-3) may not meet that bar on day one.

## Why no new DR

The recommended options (DQ-1 Option A, DQ-2 Option A) reuse existing primitives — local git
history and the existing approval ground truth — and introduce no new store, no new network
posture, and no new consent surface. That is a revertible diff (undoable in under a day), so
no DR is needed under those selections. **If DQ-1 resolves to Option B** (a new persistent
snapshot log under `.minspec/`), a DR becomes necessary: it would be a new `.minspec/` writer
in the sense SPEC-096 just finished auditing, and a new durable schema is exactly the
hard-to-reverse-in-a-day class the DR filter exists for. Plan must not proceed on DQ-1 Option
B without one.

## Out of Scope

- **The bendy-bar/approval-color overlay as a first-increment requirement.** FR-4 exists as a
  requirement for when it ships, but DQ-5's recommended option defers it.
- **Per-package breakdown as a first-increment requirement.** DQ-6.
- **Exact, re-executed historical test coverage.** DQ-3 Option B — ruled out as a default path
  by FR-8.
- **Exporting or sharing chart data outside the local machine.** No sync, no upload, no
  telemetry; this spec adds no network surface (FR-7, INV-1).
- **ScroogeLLM's own cost/usage trend charts**, if any exist or are proposed — a different
  product, different repo (DR-027).

## Traceability

- **Issue:** [#99](https://github.com/AIClarityAU/minspec/issues/99).
- **Epic:** [EPIC-002 Signpost Integrity](../../../docs/epics/EPIC-002-signpost-integrity.md).
- **Related specs:** [SPEC-012 Next-Task Resolver](../SPEC-012-next-task-resolver/requirements.md)
  (the signpost priority DAG this chart visualizes a project-wide view alongside, DQ-6),
  [SPEC-014 Prettified Spec-Review Webview](../SPEC-014-review-webview/requirements.md) (the
  only other webview panel in the product — its Tier-0/no-auto-open precedent is reused here),
  [SPEC-010 Signpost Correctness](../SPEC-010-signpost-correctness/requirements.md) (the
  never-wrong framing this chart inherits even though it is not itself a gate),
  [SPEC-096](../SPEC-096-opt-in-marker-single-creator/requirements.md) (the opt-in-marker rule
  any cache file this feature writes must respect, FR-9).
- **Governing decisions:** [DR-038](../../../docs/decisions/DR-038.md) (unified next-task
  graph surface — the precedent for a single visual surface over DAG-derived state),
  [DR-039](../../../docs/decisions/DR-039.md) (goals/priority as a human dial, relevant if a
  per-package view is later prioritized by goal-rank).
- **DR for this spec:** none, by design — see "Why no new DR" for the one condition (DQ-1
  Option B) that would require one.

## Id note

`SPEC-097` was checked against `origin/main` (`350c6fa4`) and every packed remote-tracking
ref available in this worktree on 2026-10-03 — no spec directory or branch claims `SPEC-097`
or higher. This agent has no network access to re-fetch or query open pull requests directly;
per `scripts/check-dr-id-collision.ts`'s sibling-gate convention, if this id collides with a
pull request opened after this check, renumber at review time.
