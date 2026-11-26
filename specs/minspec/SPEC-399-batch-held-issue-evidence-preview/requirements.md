---
id: SPEC-399
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline; the held-issue queue is its human-facing backlog
aspects: [backlog, hold-reason, evidence-preview, visibility, offline, silent-gate]
depends_on: []
relates_to: ["#1004", "#1002", "#783", "DR-070", "SPEC-387"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan. Expected surface: a pure
  renderer under `scripts/lib/`, a thin producer script under `scripts/`, an optional command in
  `packages/minspec/src/` that opens the generated file, and tests. None of it is claimed yet.
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-399: One read of a generated evidence list replaces N per-issue adjudications of held issues

> **This is a SPECIFICATION ONLY.** Written for issue
> [#1004](https://github.com/AIClarityAU/minspec/issues/1004). Nothing is built until it is
> approved, after [Decisions needed (Clarify)](#decisions-needed-clarify) are resolved.
>
> No new decision record: the design rests on **DR-070** (standing dispatch policy; its §7
> and Follow-ups name this preview as the standalone keystroke-removal lever). Every choice
> below is a column, a file path or a threshold in dev-time tooling, each undoable in well
> under a day (DR-359 ADR filter).

## One-Sentence Scope

Given the set of open issues held for a human (`needs-review`), generate one read-only,
deterministic evidence list with, per issue, its id, title, hold reason, tier, owning
spec/DR and predicted changed paths, so the human reads once instead of opening each issue.

## Context

- DR-070 (§7, "Anti-rubber-stamp") calls the evidence preview "the real keystroke-removal
  idea" that "works standalone": it attacks the human's per-item cost directly and adds no
  auto-dispatch, so it carries none of the safety surface of a dispatch relaxation.
- It also makes the >50-queue notification (DR-070 §7) actionable: the toast's primary
  button is the evidence button.
- It rests on a machine-readable hold reason. DR-070 §1 / **#1002** supplies `hold:human`,
  `hold:tier`, `hold:info`, `hold:unknown` labels and a persisted verdict block. I believe
  `hold:*` labels are already consumed in `scripts/dispatch-issue.sh` and
  `scripts/approve-on-label.sh` (grep hit on `hold:tier`), but I did not verify that #1002's
  persisted verdict block (`tier`, `bodyHash`, `verdictAt`) is shipped. Stated as an open
  dependency, not a fact.

## Functional Requirements

- **FR-1 Batch selection.** The producer takes a batch: by default every open issue
  carrying `needs-review`; optionally filtered by hold reason (`--hold tier`), by tier, or
  by an explicit issue-id list. An empty batch yields an explicit "0 held issues" document,
  never an empty file or silence.
- **FR-2 Row content.** Each row carries: issue number and title; hold reason
  (`human | tier | info | unknown`); tier; owning spec and/or DR; changed-path prediction;
  verdict age (when the verdict was recorded).
- **FR-3 Hold reason source.** Hold reason is read only from the machine-readable record
  from #1002 (`hold:*` label and/or the verdict block). A missing, duplicated or garbled
  record renders the hold reason as `unknown` with the cause named, never as a guess and
  never as a blank. The preview never infers a hold reason from prose.
- **FR-4 Owning spec/DR.** Resolved from explicit references in the issue (frontmatter
  `relates_to`/issue body links to `SPEC-NNN` / `DR-NNN`), checked against files on disk.
  A reference that does not resolve is shown as `unresolved: <ref>`; no reference shows
  `none found` (a stated absence, not a blank).
- **FR-5 Path prediction is labelled a prediction.** Every predicted path set is rendered
  with its provenance (`from spec implements`, `from issue body`, or `none`) and the
  heading "prediction, not a claim". The preview never states paths as fact (CLAUDE.md
  mechanism-claims rule).
- **FR-6 Grouping and order.** Rows are grouped by hold reason, then ordered by a stable
  key (issue number ascending) so two runs over the same input produce a byte-identical
  document. Per-group counts are printed at the top.
- **FR-7 Read-only and outward-inert.** Generation writes one gitignored local file and
  nothing else: no label change, no comment, no `agent-ready`, no dispatch, no config
  write. The document states that reading it authorises nothing and that PRs still need
  the human's merge.
- **FR-8 Fail visibly.** If the issue list, or any per-issue read, fails, the document
  says so in a banner and lists the affected ids; the producer exits non-zero. A partial
  list is never presented as the whole queue (constitution invariant 2).
- **FR-9 Offline split.** The network read (the issue list) happens only in the dev-time
  producer under `scripts/`, as the drain does today. Anything shipped in the extension
  reads the generated file and makes no network call (invariant 1; DR-070 §7 producer /
  consumer split).
- **FR-10 Staleness shown.** The document header carries the generation time and the
  base commit it was computed against; a consumer shows how old the file is.
- **FR-11 Standalone.** The preview works with auto-dispatch off and does not require, read
  or alter `dispatch.preApproval`.

## Acceptance Criteria

- AC-1: Given 3 held issues with `hold:tier`, `hold:human`, no hold label, the output has
  two groups and an `unknown` row naming "no hold label", counts `1/1/1`.
- AC-2: Same input twice gives byte-identical output (modulo the header timestamp line,
  which is the only non-deterministic line and is isolated).
- AC-3: Issue list fetch fails: non-zero exit, banner present, no file claims completeness.
- AC-4: A row with an unresolvable `SPEC-999` reference shows `unresolved: SPEC-999`.
- AC-5: Running the producer changes no label, comment or config (checked by a test that
  stubs the forge client and asserts zero write calls).
- AC-6: Extension-side code that opens the file contains no network call.
- AC-7: A repo without `.minspec/` at root is untouched (invariant 3).

## Invariants This Change Must Not Break

1. Offline core (invariant 1): no network call in anything the extension ships.
2. No silent gate (invariant 2): errors surface (FR-8); unknown stays `unknown`.
3. Blast radius (invariant 3): inert without `.minspec/`; writes only under `.minspec/`.
4. The preview confers no approval and lifts no hold (DR-070 anti-rubber-stamp: evidence
   button enables nothing).

## Out of Scope

Any dispatch relaxation or standing policy (DR-070 §2-§6); the #1002 label/verdict work
itself; the threshold toast and its cooldown state (DR-070 §7 trigger/anti-nag); editing
issues from the preview.

## Decisions needed (Clarify)

1. **Delivery surface.**
   - (a) **(rec)** Generated markdown file at `.minspec/held-preview.md` (gitignored)
     opened by a palette command. Cheapest, diffable, no UI code; cost: no per-row
     interaction.
   - (b) Webview with per-row links. Richer; cost: more code, and a UI surface to keep
     fail-visible.

   **Recorded selection: the recommended option,** (a), a generated markdown file at `.minspec/held-preview.md` (gitignored), opened by a palette command. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-23; sign-off ratifies it.
2. **Source for tier and hold reason: depend on #1002 or fall back.**
   - (a) **(rec)** Block until #1002's verdict block ships; rows without it show
     `unknown`. Honest and simple; cost: the preview is useless on un-backfilled issues.
   - (b) Fall back to re-running `triage-decide.sh` per issue at preview time. Works
     sooner; cost: reintroduces the run-to-run tier flap DR-070 §1 warns about and a
     second source of truth.

   **Recorded selection: the recommended option,** (a), block until #1002's verdict block ships; rows without it show `unknown`. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-23; sign-off ratifies it.
3. **Path prediction method.**
   - (a) **(rec)** Only explicit sources (owning spec's `implements`, paths named in the
     issue body). Never wrong-by-inference; cost: many rows show `none`.
   - (b) Heuristic from title/keywords. More coverage; cost: plausible-but-wrong paths,
     which the evidence rules forbid presenting as fact.

   **Recorded selection: the recommended option,** (a), only explicit sources (the owning spec's `implements`, paths named in the issue body). Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-23; sign-off ratifies it.
4. **Where the producer runs.** (a) **(rec)** On demand from the palette/script, plus a
   refresh each drain cycle that already lists issues; cost: slightly stale between
   cycles (age shown per FR-10). (b) Drain-only; cost: no way to refresh when the human
   sits down.

   **Recorded selection: the recommended option,** (a), on demand from the palette/script, plus a refresh each drain cycle. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-23; sign-off ratifies it.

Items 1 to 4 each carry an agent-recorded selection on the DR-123 recorded-pick path (recorded
2026-11-23); no human chose any of them.

## Follow-ups (tracked)

- #1002 hold-reason recording: prerequisite, tracked there.
- Toast wiring to this preview (DR-070 §7 `Show me the N`): tracked by DR-070 §7; not
  this spec.
