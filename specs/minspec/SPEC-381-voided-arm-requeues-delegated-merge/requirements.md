---
id: SPEC-381
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline; the delegated merge lane is part of the drain
aspects: [drain, delegated-merge, fail-closed, recovery]
depends_on: []
relates_to: ["#3012", "#2997", "#2981", "#816", "#3179", "DR-108", "DR-119", "DR-121", "SPEC-296", "SPEC-333"]
implements: none
implements_reason: >-
  Specify phase only. Expected surface: the `--delegated-spec-merge ... --arm` seam in
  scripts/dispatch-issue.sh (label removal after arming) and `arm_delegated_spec_merges` in
  scripts/drain-inbox.sh (candidate selection). None of it is changed.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-381: A delegated-merge arm that GitHub voids returns the pull request to the drain

> **SPECIFICATION ONLY.** Written for issue #3012 (found while the runner drove #2997, the
> DLG-001 delegated merge). Nothing is built until this spec is approved and the
> [Decisions needed (Clarify)](#decisions-needed-clarify) are resolved.
> Design rests on DR-108 (delegation), DR-119 (delegated-approval merge lane), DR-121 (plan merge).

## Problem

After the delegated-merge seam arms native auto-merge it removes the `needs-human-review` label
(`scripts/dispatch-issue.sh:961-964`, "once armed the hold is false"). The drain finds
candidates by reading open PRs per hold label (`needs-human-review`, `awaiting-approval`) and
keeping only those with `autoMergeRequest == null` (`scripts/drain-inbox.sh`,
`arm_delegated_spec_merges`). GitHub voids an arm when the head moves or the base changes
(the seam's own audit comment says "a new push voids the arm"). A voided PR then has no
label, no arm, and is not merged: no drain read selects it, so it strands silently.

Root cause (mechanism + missing gate): the label is the drain's only durable "this PR is a
candidate" witness, and the seam deletes it on the strength of a state (the arm) that GitHub
may revoke afterwards, with no second witness and no sweep for the state "was armed, now
isn't". (Invariant 2: no silent gate.)

## Functional requirements

- **FR-1** A PR whose delegated arm was voided (open, not draft, not merged, no
  `autoMergeRequest`) MUST become a drain candidate again within one drain cycle, without a
  human action.
- **FR-2** The mechanism MUST NOT admit any PR the delegation judge would not otherwise
  admit: re-queueing only makes the PR re-judged by the existing seam, on its CURRENT head
  (DR-108: an agent may tighten, never widen; arm stays bound to `--match-head-commit`).
- **FR-3** A PR that was never held or armed by the lane (a human's own PR, a PR a human
  deliberately un-held) MUST NOT be pulled into the lane by this change.
- **FR-4** A PR that is merged, closed, or draft MUST NOT be re-queued; a merged PR needs no
  recovery.
- **FR-5** The recovery MUST be visible: each re-queue prints one drain line naming the PR and
  the reason ("arm voided"), and a failure to read the state prints loudly on stderr and is
  never read as "nothing stranded" (invariant 2).
- **FR-6** The existing per-cycle cap and rotating cursor MUST still bound judgement work; a
  re-queued PR takes a slot like any candidate.
- **FR-7** A regression test MUST cover a voided arm: a PR armed by the seam, then with the
  arm removed (head push or base change), is a candidate again on the next cycle; the test MUST
  fail on current code. Negative cases: FR-3 and FR-4.

## Acceptance criteria

1. Fixture: seam arms PR → arm voided → next `arm_delegated_spec_merges` pass judges it (FR-1, FR-7).
2. Fixture: unlabelled, unarmed, never-armed spec PR is not judged (FR-3).
3. Fixture: merged/closed/draft voided PR is skipped (FR-4).
4. Fixture: unreadable PR state → stderr WARNING, non-silent (FR-5).
5. A PR that is armed and healthy is neither re-judged nor relabelled (no churn).

## Invariants the change must not break

- Offline-first / no new network surface beyond the `gh` reads the drain already makes (1).
- No silent gate: no `|| true` on the new read; an errored witness fails closed and visibly (2).
- Blast radius: acts only on repos with `.minspec/`; adds no CI workflow (3).
- DR-108 section 4: the bot never arms before the judge admits; no `--admin`, no merge of its own.
- The #816 meaning of `needs-human-review` ("a human is the next actor") stays true wherever it
  is present; shepherd's #3179 "human-held" reading must not misfire on armed PRs.

## Out of scope

The governance question on #2997's `changes` verdict (pre-merge arming authority, DR-108
section 4) is separate and untouched.

## Decisions needed (Clarify)

**D1 - How does a voided arm get back to the drain?**

- **A. Keep `needs-human-review` until the merge lands.** Simplest to reason about; the
  existing reads keep working (the `autoMergeRequest == null` filter already excludes healthy
  armed PRs). Cost: the label lies while armed (#816: it says a human is next), and the
  shepherd's "human-held" logic (#3179) and any dashboard reading the label would treat armed
  PRs as human-held; the label must then be removed on merge by something else, or left stale.
- **B. Sweep for "no label, no arm, not merged" PRs that carry the lane's audit marker.**
  The seam's "Delegated merge armed" comment (or a dedicated label such as `dlg-armed`) is
  the marker that makes FR-3 checkable; the drain re-judges marked PRs with no active arm.
  Keeps the label honest. Cost: one extra `gh` read per cycle plus a comment-parsing or
  new-label dependency; a deleted marker comment strands the PR again.
- **C. Replace the label with a dedicated `dlg-armed` label at arm time (rec)** and treat
  `dlg-armed` + no arm as the re-queue state. Same as B with a durable, queryable marker and no
  comment parsing. Cost: new label to create and document, and a second hold-like label for
  the shepherd to learn about.

Recommendation: **C**. Primary downside of C: a new label is a new piece of state that can
itself be stripped by a human or another session.

**Recorded selection (founder):** option C, a new `dlg-armed` label. Chosen by the founder, not an agent pick; founder decision 2026-11-22, queue item c381d1 ("c option C - new dlg-armed label (Recommended)"). Resolves the earlier mismatch between the option list and the prose recommendation.
Rejected alternatives (DR-086 section 4): relabelling `needs-human-review` on detection of a
void (hands the PR to the founder for a state the lane can resolve itself, against tenet 1).

**D2 - Re-queue on every void, or cap it?** A PR whose head keeps moving could be re-judged
each cycle. Recommend relying on FR-6's cap and cursor with no extra counter (rec); cost: a
churning PR spends judge runs until its author stops pushing.

**Recorded selection: the recommended option,** rely on FR-6's cap and cursor with no extra counter. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
