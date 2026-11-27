---
id: SPEC-401
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness — concurrent multi-session coordination
relates_to: [SPEC-044, SPEC-032, SPEC-024, DR-033, DR-061]
implements: none
implements_reason: >-
  Documentation-only disposition spec: AC-3 says no packages/, scripts/ or tests/ file is
  touched by this spec or its approval, and DQ-1's recorded Option A closes #181 with no code change.
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# MinSpec — Keep auto-built PR branches mergeable as base advances (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this document. A
> human reads it, answers the question under **[Decisions needed
> (Clarify)](#decisions-needed-clarify)**, and approves it through the normal spec-approval
> gate before any code changes.

Materializes **[#181](https://github.com/AIClarityAU/minspec/issues/181)** —
*"the Merge Pull Request button didn't show at first — 'Update with Merge Commit' fixed it
— can't MinSpec do that for me already?"* (filed 2026-06-05, parked by Claude Code during a
PR review per DR-033/DR-360).

**Id note.** `SPEC-400` is the highest id on `origin/main` (read 2026-11-23, at 5ec29bac), so
this spec takes `SPEC-401`. It was first drafted as `SPEC-401` when `SPEC-096` was the highest id
on main; that id sat in a gap (`SPEC-122` and `SPEC-127` exist, `SPEC-401`-`SPEC-126` do not) and
was renumbered on review to the next id after main's maximum. Open pull requests are invisible
from a base checkout, so run `scripts/check-dr-id-collision.ts` / `scripts/next-spec-id.ts` at
review time and renumber again if a concurrent session claimed `SPEC-401` first.

**Citation re-check (2026-11-23).** Every `file:line` below was re-read against this worktree
(base 5ec29bac). Earlier citations in this spec were stale; the lines now cited were read, not
carried over. The only open item remains DQ-1 below.

## One-Sentence Scope

Before specifying a new mechanism, trace what the auto-build pipeline's existing shepherd
already does about a PR branch falling behind `main`, name the one real gap, and put the
single question that gap raises — ratify the already-drafted, not-yet-accepted fix now, or
close this issue against the baseline that already shipped — in front of a human, rather
than build a second implementation of the same behaviour.

## Context — what the code does today, read from the worktree's checkout

**Evidence Discipline (CLAUDE.md RCDD / DR-003):** every claim below cites `file:line` or a
spec's own frontmatter `status:`/`phases:`; none is inferred from an issue being open or a
PR title.

### The issue's literal ask is already shipped, for the common case

[SPEC-044](../SPEC-044-coordinated-self-completing-sessions/requirements.md) (`status:
implementing`, FR-4 `phases.specify/clarify/plan: done`) specifies — and the repository
already runs — a shepherd that detects a `BEHIND` auto-built PR branch and updates it
mechanically, no human click required:

- `scripts/lib/shepherd-pr.sh:85` — the pure decision seam `shepherd_decide` emits
  `do-rebase` for a PR classified `rebase-only` by `remediate-pr.sh`'s `--classify` seam
  (behind base, otherwise clean).
- `scripts/dispatch-issue.sh:2282-2291` (`shepherd_rebase`) — "Mechanical rebase onto
  `origin/main` — no agent, so no attempt is consumed," dispatched from `do-rebase` at
  `scripts/dispatch-issue.sh:2553-2554`.
- `scripts/remediate-pr.sh:1258-1260` (`rebase-only` action) — "Merge (not rebase) so we
  never rewrite the PR branch's published history," re-pushed as a fast-forward
  (`remediate-pr.sh:1265`, `:1432`).
- `scripts/drain-inbox.sh` carries the same recovery as orphan-fallback (SPEC-062 FR-4b,
  `specs/minspec/SPEC-062-autonomous-pr-drain/requirements.md:160-161`) for a PR whose
  creator session is gone.

So for a PR opened by the auto-build pipeline, with a live or recently-live shepherd, the
branch is already updated without the human clicking "Update with Merge Commit." The
2026-06-05 report predates this machinery (SPEC-044 was triggered by #912, dated
2026-07-25); re-checked against what ships today, the baseline complaint is resolved.

### SPEC-032 already named this spec's boundary, on 2026-07-06

[SPEC-032](../SPEC-032-forgotten-merge-discovery/requirements.md:44-47) lists this exact
issue while scoping *itself* out of it: "the done-ness half overlaps existing machinery,
but that machinery targets MinSpec's own auto-built PR branches, not arbitrary external
ones: ... [SPEC-024] ... [#181] — keep PR branches mergeable as base advances." That line
places #181 inside the SPEC-044 shepherd's territory, not SPEC-032's — this document
follows that pointer rather than re-deriving a third design.

### The one real gap, and it is not "no auto-update exists"

[SPEC-044 Amendment A](../SPEC-044-coordinated-self-completing-sessions/requirements.md#amendment-a-2026-09-05---proposed-not-accepted)
(dated 2026-09-05, **`PROPOSED, not accepted`**, triggered by a different issue,
`minspec #1750`) measured the actual failure mode on 2026-09-05: not "nothing updates the
branch" but (1) the shepherd is bounded to one hour and dies with its session
(`scripts/lib/shepherd-pr.sh:51`, `MINSPEC_SHEPHERD_MAX_SECS` default 3600) so a PR with no
live shepherd stays `BEHIND` indefinitely — 24 such PRs were observed, one five days
stale — and (2) under `strict_required_status_checks_policy` every independent `do-rebase`
after a merge to `main` invalidates every other open PR, so N independently-updating
shepherds burn **N²/2** CI runs where a single ordered updater would cost **N** — which is
exactly this issue's stretch goal ("do it just-in-time at review, not eagerly, avoid CI
churn"). Amendment A's proposed fix is to **remove** `do-rebase` from the shepherd's
vocabulary entirely and replace it with a single central driver that holds the queue view
and updates one branch at a time (`FR-4b`, same file, "The change" section) — this is also
the mechanism `CLAUDE.md`'s "Merge asks in THIS repo" funnel describes as already
operating convention, ahead of the code that would make it a gate rather than a rule.

Amendment A also names its own open, load-bearing question, unresolved at the time of this
document: whether a `machinery-review-required` PR (`ACTION_REQUIRED` by design) can enter
a merge queue at all, which bears on whether GitHub's native merge queue can stand in for a
custom driver.

## What this spec does and does not do

- **Does not re-specify the mechanism.** SPEC-044 FR-4 (shipped) and Amendment A
  (drafted) already cover, respectively, the baseline ask and the stretch ask. Minting a
  second design here would create two sources of truth for the same branch-update
  behaviour — the traceability convention this repository runs under (`CLAUDE.md`
  "Traceability Convention": "Don't consolidate — link, bidirectionally") exists precisely
  to prevent that.
- **Does** give #181 a citable, evidence-checked disposition, and surfaces the one
  decision that is genuinely still open — below.

## Decisions needed (Clarify)

- **DQ-1 — How does #181 close?**
  - **Option A — close #181 as resolved by the shipped baseline (rec).** FR-4's
    `do-rebase`/`rebase-only` path already keeps a shepherded PR's branch mergeable
    without a manual "Update with Merge Commit" click; that is the issue's literal ask.
    *Cost:* the stampede/no-live-shepherd gap Amendment A measured stays open, tracked
    under SPEC-044 (triggered by #1750) rather than this issue — a reader of #181 alone
    would not see that the fuller fix is still pending acceptance.
  - **Option B — keep #181 open and let it co-trigger ratification of SPEC-044 Amendment
    A.** *Cost:* Amendment A is a T4 change to an already-`implementing` spec (removes a
    capability from the shepherd's vocabulary, installs a new central-driver role) —
    accepting it on this issue's authority alone pulls a second, narrower issue into a
    decision that already has its own trigger and its own open sub-question (whether a
    machinery PR can enter a native merge queue at all). Duplicating the acceptance path
    risks the two tracks drifting if one is amended and not the other.
  - Recommended: **Option A**, with a comment on #181 linking this spec and naming
    Amendment A as where the remaining stretch goal is tracked, so the link is
    bidirectional (`CLAUDE.md` Traceability Convention) without a second ratification
    surface for the same amendment.

  **Recorded selection: the recommended option,** Option A, close #181 as resolved by the shipped baseline, with a comment on #181 linking this spec and naming SPEC-044 Amendment A as where the remaining stretch goal is tracked. Agent pick of the recommended option, no human chose it. Recorded by agent 2026-11-25 under founder decision, queue item clarsel (2026-11-17), DR-123; sign-off ratifies it.

- **DQ-2 — Does this spec need its own Decision Record?**
  - **Option A — no (rec).** No new mechanism, store, or consent surface is introduced;
    this document only traces existing code and existing spec text and asks the human to
    pick a disposition. The DR-359 ADR filter (can it be undone in under a day) is met
    trivially because nothing is built.
  - **Option B — yes, superseding nothing.** *Cost:* a DR that records "we decided to link
    an issue to an existing spec" is ceremony with no future reader value, and
    `docs/decisions/INDEX.md` already has no entry for this question to supersede.

  **Recorded selection: the recommended option,** Option A, no Decision Record for this spec. Agent pick of the recommended option, no human chose it. Recorded by agent 2026-11-25 under founder decision, queue item clarsel (2026-11-17), DR-123; sign-off ratifies it.

## Functional Requirements (conditional on DQ-1)

- **FR-1 (always).** This spec's Traceability section MUST be added as a bidirectional
  link: this document names #181 and SPEC-044/SPEC-032; a human-authored comment on #181
  MUST name this spec and SPEC-044 Amendment A in return (`CLAUDE.md` Traceability
  Convention — issues reference the DR/spec that carries the rationale).
- **FR-2 (if DQ-1 = Option A).** #181 is closed with a comment citing the FR-4 evidence
  above (file:line) and naming Amendment A as the tracked location for the stampede/
  no-live-shepherd gap. No code changes result from this spec.
- **FR-3 (if DQ-1 = Option B).** #181 stays open and is added to SPEC-044's Amendment A
  Traceability as a second triggering issue; Amendment A's own Clarify/Accept cycle (not a
  new one here) is what ratifies FR-4b. This spec is then superseded by that acceptance and
  should be marked `status: specifying` → closed-no-build once Amendment A's own spec
  records the merge.

## Acceptance Criteria

1. #181 carries a comment linking this spec (this document exists and is committed before
   the comment is posted — AC order matches `CLAUDE.md`'s "Never narrate an unrun action").
2. The disposition chosen at DQ-1 is recorded in this document's Traceability section
   before this spec's own status can move past `specifying`.
3. No `packages/`, `scripts/`, or `tests/` file is touched by this spec or its approval —
   verified by `git diff --name-only` against this spec's own commit (DR-359 filter: this
   is a documentation-only change).

## Invariants this must not break

- **Constitution invariant 2 (no silent gate).** This spec does not touch any gate; it
  only records a disposition. Not applicable as a build constraint, listed for
  completeness.
- **Constitution invariant 3 (blast radius).** Nothing here writes outside `specs/`.
- **Evidence Discipline (RCDD/DR-003).** Every "implemented" claim above cites `file:line`
  or a spec's own `status:`/`phases:` field, not an issue being open/closed or a PR title
  (the exact failure mode DR-003 was earned from).

## Why no new DR

See DQ-2. No store, setting, or consent surface is introduced; the reversibility filter
(undo in under a day) is met because this document, if wrong, is reverted by deleting it.

## Out of Scope

- **Re-litigating SPEC-044 Amendment A's own open question** (whether a
  `machinery-review-required` PR can enter a native merge queue) — that belongs to
  Amendment A's own Clarify/Accept cycle, not this spec.
- **Any code change to the shepherd, drain, or dispatch scripts.** Both the shipped
  baseline (FR-4) and the proposed stampede fix (Amendment A) already have a home; this
  spec does not add a third.

## Traceability

- **Issue:** [#181](https://github.com/AIClarityAU/minspec/issues/181) — "keep auto-built
  PR branches mergeable (auto-update when base advances)."
- **Resolves the baseline ask via:** [SPEC-044](../SPEC-044-coordinated-self-completing-sessions/requirements.md)
  FR-4 (`status: implementing`) — `scripts/lib/shepherd-pr.sh:85`,
  `scripts/dispatch-issue.sh:2282-2291`, `scripts/remediate-pr.sh:1258-1260`.
- **Tracks the stretch ask via:** [SPEC-044 Amendment A](../SPEC-044-coordinated-self-completing-sessions/requirements.md#amendment-a-2026-09-05---proposed-not-accepted)
  (`PROPOSED, not accepted`, triggered by `minspec #1750`).
- **Named as a boundary by:** [SPEC-032](../SPEC-032-forgotten-merge-discovery/requirements.md)
  (2026-07-06, `requirements.md:44-47`) — places #181 inside the shepherd's territory, not
  the forgotten-merge discoverer's.
- **Adjacent, not absorbed:** [SPEC-024](../SPEC-024-auto-merge-eligibility/requirements.md)
  (the done-ness/eligibility signal set SPEC-032 and the shepherd both reuse).
- **Governing decisions:** [DR-033](../../../docs/decisions/DR-033.md) (auto-triage/auto-build
  policy this issue was parked under), [DR-061](../../../docs/decisions/DR-061.md) (native
  GitHub auto-merge, the mechanism a behind-base branch is being kept eligible for).
- **DR for this spec:** none — see "Why no new DR."
