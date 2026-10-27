---
id: SPEC-253
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute — the dev-time autonomous build/merge pipeline (same epic as SPEC-074, whose matcher this reuses)
aspects: [agent-dispatch, quota, creator-shepherd, no-silent-gate, tier-0]
relates_to: [SPEC-074, SPEC-044, DR-063, DR-084, DR-076]
affects: [scripts/dispatch-issue.sh]  # OWNED by SPEC-044 via implements: — this spec modifies the creator-shepherd's fix launch and its caller, never owns the file. The matcher is SPEC-074's; this spec adds no pattern anywhere.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Classify a provider quota wall in the creator-shepherd's fix agent (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch
> that produced it. A human reads this spec, resolves the questions under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the
> normal spec-approval gate before anything is built.

Materializes **#2422** — *"a quota wall in the creator-shepherd's fix agent hands the PR
to a human as 'no publishable change'."* It is the sibling that **SPEC-074** DQ-2 parked
(SPEC-074 §"Clarify selections", DQ-2, Option A, recorded by an agent 2026-10-01). It
fixes the same class of false summons as **#1656** (the main launch), at the second
`claude -p` call site.

## One-Sentence Scope

When the fix agent that the creator-shepherd (`shepherd_fix` in `scripts/dispatch-issue.sh`)
launches into a pull request's warm worktree dies on the provider's quota wall, the pull
request is NOT handed to a human as "an automated fix attempt did not produce a publishable
change" — the wall is recognised with SPEC-074's single matcher and surfaced as what it is,
a condition only time resolves.

## Status of the claim — read, not reproduced

Everything under "Context" is **read from the code at `6e09caed`** (this worktree's base). It
has **not been reproduced by running it**, and no real occurrence has been found. A stub
`claude` that prints the CLI's wall line is the reproduction harness (AC-1, and the same
shape SPEC-074 AC-7 uses). Until that harness runs red against today's script, the root
cause below is a hypothesis with strong textual support, not an observation. Plan step 1
MUST run it before any fix is written, and this spec is wrong if it passes.

## Context

### The path, as read (line numbers are this base's; see `git blame` for drift)

- `shepherd_fix()` (`scripts/dispatch-issue.sh:1937`) first posts the
  "Creator-shepherd automated attempt" comment (`:1941-1943`), which is the attempt
  counter: a crashed attempt consumes budget by design.
- It then launches a **second** `claude -p` (`:2007-2012`) piped through `tee -a "$LOG"`
  inside a subshell followed by `|| true`, so the launch's exit status is discarded.
- The only test afterwards is whether `HEAD` moved (`:2013-2018`). A fix agent that dies on
  the CLI's limit notice commits nothing, so the function prints "Fix agent produced no
  commit" and `return 1`.
- The caller (`:2185`) maps any non-zero return to
  `shepherd_hand_off "$pr_num" "an automated fix attempt did not produce a publishable change"`.
- `shepherd_hand_off()` (`:1865-1877`) adds `needs-human-review` to the PR and posts the
  "Creator-shepherd handed off" comment once (marker `SHEPHERD_HANDOFF_MARKER`), then the
  loop returns — the creator makes **no further attempt**.

So a quota wall during shepherding is indistinguishable, in label and in comment, from the
fix agent genuinely failing to produce a change. A human is summoned for a condition no
human can act on.

### Why it is worse than the main-launch case

1. **The hand-off is terminal for the shepherd.** `shepherd_own_pr` returns after
   `shepherd_hand_off`; unlike an issue label the PR carries no `agent-ready` to restore,
   and the attempt budget (`SHEPHERD_MAX_ATTEMPTS`, default 2) was already spent by the
   pre-launch comment. One wall can therefore cost the whole PR its automation.
2. **`$LOG` is shared and appended.** The fix launch uses `tee -a "$LOG"` onto the SAME
   file the main build launch wrote. By the time the shepherd runs, `$LOG` may already hold
   a CLI limit notice from an earlier, *recovered* stage (or SPEC-074's own classification
   of the main launch), plus any earlier fix attempt's output. Classifying the whole file
   after the fix launch would attribute an old wall to this attempt, or a wall in attempt 1
   to attempt 2. The classification must read **only what this launch wrote** (FR-1).
3. **Same prose hazard as #2233.** `$LOG` holds the agent's final message as well as any
   CLI notice, so a content predicate would misfire on a fix agent whose prose merely
   discusses quotas. SPEC-074 INV-3 already rules this out; this spec inherits it.

### Prior art this spec must reuse, not duplicate

- **SPEC-074 FR-1/FR-2/INV-3** define the single matcher (the drain's CLI-notice matcher,
  `_quota_notice_forms` → `QUOTA_NOTICE_RE`, filtered by `quota_notice_lines`, reached via
  `drain-inbox.sh --is-quota` or one shared `scripts/lib` file) and the reset-instant
  recovery (`parseResetInstant` over the matched lines only). **At this base SPEC-074 is
  not built** (`status: planning`; `grep -n 'quota' scripts/dispatch-issue.sh` finds no
  detection), so this spec cannot land first: see FR-7 and Decision DQ-A.
- **`shepherd_hand_off`** is the existing visible-dead-end seam (idempotent via its
  marker). This spec adds a sibling outcome; it does not weaken the hand-off for genuine
  failures (FR-5).
- **`scripts/drain-inbox.sh`'s cycle-level pause** already sees the CLI's line pass through
  `tee` at column 0 and rests the drain. The shepherd runs inside `dispatch-issue.sh`, so
  that layer is an independent second witness to the same event, exactly as SPEC-074 FR-6
  describes. It must keep working (FR-6).

### Why no new DR

DR-359's filter (costly-to-reverse in under a day) does not apply: this reuses an
existing matcher (SPEC-074), adds at most one PR label or comment shape (revertible by
deleting it), and changes one function's post-launch branch. DR-063 (split an overloaded
outcome) and DR-084 (the pipeline can jam on shared quota) are the governing precedents;
this applies them. `docs/decisions/INDEX.md` has no entry on this narrower question. No DR
is proposed.

## Functional Requirements

- **FR-1 (classify only this launch's output, with the single matcher).** After the fix
  launch returns and before the no-commit outcome is mapped to a hand-off reason, the text
  **this launch** wrote MUST be tested with the SAME matcher SPEC-074 FR-1 uses (CLI
  limit-notice lines, column 0, outside fenced code). "This launch's text" is the bytes
  appended to `$LOG` since the launch began — captured by a byte offset taken before the
  launch, or a per-launch temp file that is then appended to `$LOG` — never the whole file.
  No new regex in `dispatch-issue.sh`; no `isQuotaExhaustion`/`isQuotaExhaustionStrict`
  (SPEC-074 INV-3).
- **FR-2 (commit beats classification).** If `HEAD` moved, the existing publish path runs
  unchanged **even when** the launch's text also matches the wall (an agent can commit and
  *then* hit the limit; the commit is real work to publish). Classification applies only
  to the no-commit outcome.
- **FR-3 (distinct return, not a failure).** `shepherd_fix` MUST return a status distinct
  from "no commit" when FR-1 matches on a no-commit launch (e.g. a dedicated non-zero
  code, a named variable, or a sentinel — a Plan decision), and the caller at `:2185` MUST
  branch on it. The wall MUST NOT reach `shepherd_hand_off` with the reason "an automated
  fix attempt did not produce a publishable change".
- **FR-4 (legible, once).** On the FR-3 outcome the PR MUST receive a comment stating
  plainly that the fix attempt was stopped by provider quota exhaustion, not by a failure
  to produce a change, and naming the reset time when SPEC-074 FR-2's parse over the matched
  lines yields one, or the explicit text "reset time not stated in the CLI output" when not.
  The comment MUST be idempotent per PR in the way `SHEPHERD_HANDOFF_MARKER` is (its own
  marker), so the poll loop cannot repeat it. **What else happens to the PR (label, deferral,
  retry) is Decision DQ-A.**
- **FR-5 (everything else unchanged).** A no-commit launch that does NOT match FR-1, a
  non-zero rebase failure, the wall-clock ceiling, and every other `shepherd_hand_off` call
  keep today's label, comment text and attempt accounting exactly.
- **FR-6 (no change to the cycle-level witness).** The fix launch's piping through
  `tee -a "$LOG"` MUST keep the CLI's output reaching stdout unprefixed, unindented and
  unfenced, so `drain-inbox.sh`'s own matcher still sees the wall. This spec does not alter
  the drain's detection or backoff (SPEC-074 FR-6, inherited).
- **FR-7 (ordering with SPEC-074).** This spec MUST NOT introduce, copy or fork the matcher.
  If SPEC-074 is not yet built when this one is planned, the Plan either sequences after it
  or lands the shared seam itself under SPEC-074's INV-3 (one definition, one file) — see
  DQ-B. It MUST NOT ship an interim private pattern.

## Acceptance Criteria

- **AC-1 (FR-1/FR-3, the reported case, by execution).** With a stub `claude` that prints
  the session-limit line (`You've hit your session limit · resets 1pm (Australia/Sydney)`)
  and exits non-zero without committing, driving `shepherd_fix` ends in the FR-3 outcome:
  `shepherd_hand_off` is NOT called with the "did not produce a publishable change" reason.
  Run against today's script this test MUST fail (base-red proof); that run is the
  reproduction the "Status of the claim" section requires.
- **AC-2 (FR-5, negative — genuine no-commit unchanged).** A stub that exits 0 with prose
  and no commit, and a stub that exits non-zero with prose and no commit, both still end in
  `shepherd_hand_off` with the existing reason.
- **AC-3 (FR-1, prose is not a signal — the #2233 shapes).** A no-commit stub whose output
  only *mentions* a limit (prose quoting `too many requests` or `quota`; a wall line inside
  a code fence; an indented wall line) still hands off with the existing reason. Each is
  paired with a control appending the genuine wall line that must classify as quota, so a
  matcher that matched nothing cannot pass.
- **AC-4 (FR-1, scope of the read).** With `$LOG` pre-seeded with a genuine wall line from
  an earlier stage, a fix launch that fails for an unrelated reason (no wall in its own
  output) hands off with the existing reason, NOT the FR-3 outcome; and the inverse — a
  clean `$LOG` and a wall in this launch's output — gets FR-3. Both directions, so a
  whole-file read fails one and a launch-only read passes both.
- **AC-5 (FR-2).** A stub that commits and then prints the wall line publishes via
  `shepherd_publish` (stubbed) and does not take the FR-3 outcome.
- **AC-6 (FR-4).** The FR-3 outcome posts exactly one comment containing the parsed reset
  time when the wall line carries one, and the explicit "not stated" text when it does not
  (bare `You've hit your session limit`); a second pass of the poll loop over the same PR
  posts no second comment. A different reset phrase in the agent's prose beside the wall
  line does not displace the wall line's reset (SPEC-074 AC-4's third case).
- **AC-7 (FR-7, no drift).** A test fails if `dispatch-issue.sh` contains its own copy of
  the notice patterns or calls `isQuotaExhaustion`/`isQuotaExhaustionStrict`, and runs the
  AC-1 and AC-3 fixtures through both this call site and `drain-inbox.sh --is-quota` (or the
  shared lib) to get the same verdict from each. May share SPEC-074 AC-6's test.
- **AC-8 (FR-6).** Driving `dispatch-issue.sh`'s real output path with the AC-1 stub, the
  wall line reaches stdout at column 0 and the drain's matcher fires on it.

## Invariants

- **INV-1 (constitution #2, no silent gate).** The wall changes *which* outcome is recorded,
  never *whether* it is visible: the FR-4 comment is at least as visible as today's
  `needs-human-review` hand-off. A wall must never fall through to silence, and a failure to
  *read* the launch's text (unreadable log, matcher seam erroring) MUST fail toward today's
  hand-off, visibly — never toward "assume it was quota", never swallowed.
- **INV-2 (attempt accounting is not weakened).** The attempt comment is still posted before
  the launch, so a wedging failure cannot retry forever. Whether a quota-stopped attempt
  *refunds* its budget is DQ-A, not an incidental side effect.
- **INV-3 (single source of truth).** SPEC-074 INV-3 applies verbatim: no second matcher,
  widened in the one place it lives if widened at all.
- **INV-4 (no automated action a human did not authorize).** The classification may avoid a
  false summons; it MUST NOT mint approval, merge, relabel `ai-review:*` (CI owns those,
  #600), or publish anything the existing path would not.
- **INV-5 (constitution #3, blast radius).** Internal dev-tooling for this repo's own
  dispatch pipeline; no network call added, no new dependency, nothing reachable outside a
  repo that opts in via `.minspec/`.

## Decisions needed (Clarify)

### DQ-A — what a quota-stopped fix attempt leaves behind on the PR

The issue lists three candidates and does not choose.

- **Option 1 — comment only; no `needs-human-review`, shepherd stops (rec).** Post the FR-4
  comment, do not label the PR, return from the loop. *Cost:* the PR is left un-shepherded
  with a comment that says "wait"; nothing re-engages it, so a human (or the drain's
  existing PR remediation, `remediate-pr.sh`, if it picks the PR up — unverified, not read
  for this spec) must notice the reset has passed. It removes the false summons but not the
  stall.
- **Option 2 — a distinct PR label (e.g. `agent-blocked-quota`, mirroring SPEC-074 FR-3),
  shepherd stops.** *Cost:* a new label on PRs as well as issues, which the countermand
  and any PR-label consumers must learn about (a missed consumer repeats the #1068 lesson),
  and the label still needs something to clear it.
- **Option 3 — deferred retry within the shepherd's own ceiling.** Sleep until the parsed
  reset (bounded by the remaining `SHEPHERD_MAX_SECS`, falling back to the ordinary poll
  when no reset is stated) and re-enter the loop, refunding the attempt. *Cost:* the
  largest design surface (a sleep in a 3600 s ceiling that a typical reset — hours — will
  exceed, a refund rule that must not become an unbounded retry loop, interaction with the
  drain's own rest), and it is bounded-auto-reconsideration, the thing SPEC-074 DQ-1 split
  out as #2421. Building it here pre-empts that decision.

Recommendation: **Option 1**, because it removes the false summons (the reported defect)
with the smallest surface and leaves the reconsideration design to #2421 where the drain's
re-admit path is being decided; its cost is the stall above, which a later spec can close.
Option 2 is the right upgrade if a PR-level label is wanted for queries.

### DQ-B — sequencing against SPEC-074

SPEC-074 is `planning` and its matcher seam does not exist in this tree.

- **Option 1 — land after SPEC-074's slice that exposes the seam (rec).** *Cost:* this fix
  waits on an unrelated spec's build; the false summons continues meanwhile.
- **Option 2 — this spec's Plan builds the shared seam first, under SPEC-074's INV-3.**
  *Cost:* two specs claim the same seam (one owner per file would be violated unless
  SPEC-074's `affects:` is amended), and a seam built here could diverge from SPEC-074's
  Plan choice between `--is-quota` and a `scripts/lib` file.

Recommendation: **Option 1**; the cost is delay on a defect not yet seen in practice.

### DQ-C — is the claim true at all?

This is read, not reproduced, and no occurrence was found. Option 1: approve now and let the
Plan's first step be the AC-1 base-red run (rec; cost: a spec approved on a hypothesis that
the harness may refute, wasting one human read). Option 2: build the harness first and spec
only if red (cost: the harness is implementation work this dispatch forbids, and delays the
spec by a session). The recommendation holds only because AC-1 is defined as a refutation
test.

## Test

1. The stub-`claude` harness for AC-1, AC-3, AC-4, AC-5 (execution, not source-text
   assertion), written to be red on the base.
2. AC-6 against a stubbed `gh` that records comments.
3. AC-7 as a drift guard shared with SPEC-074 AC-6.
4. Mutation check: delete the FR-1 call; AC-1 must go red. Narrow the read to the whole of
   `$LOG`; AC-4 must go red.
