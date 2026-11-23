---
id: SPEC-387
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline; the delegated-approval caller is drain Step 0b (scripts/drain-inbox.sh record_delegated_approvals)
aspects: [drain, delegation, approval, stale-pr, silent-gate, fail-closed, visibility]
depends_on: []
relates_to: ["#3932", "#3927", "#3800", "#3801", "#3697", "#3748", "#3069", "#2981", "#2323", "#1561", "DR-108", "DR-123", "SPEC-311", "SPEC-305"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan. Expected surface:
  `scripts/lib/delegated-approval-caller.ts` (the open-PR read and the in-open-pr skip),
  the record_delegated_approvals stage of `scripts/drain-inbox.sh` (the summary line), and
  `packages/minspec/tests/delegated-approval-caller.test.ts`. None of it is claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-387: The drain names a stale blocker pull request instead of holding its spec silently behind it

> **This is a SPECIFICATION ONLY.** Written for issue
> [#3932](https://github.com/AIClarityAU/minspec/issues/3932) (the in-open-pr skip holds a
> spec forever behind a stale BEHIND pull request). Nothing is built until this spec is
> approved, after [Decisions needed (Clarify)](#decisions-needed-clarify) are resolved.
>
> No decision record: every choice here is a reason string, a threshold and a log line in
> dev-time tooling, each undoable in well under a day (DR-359 ADR filter). The design rests
> on **DR-108** (agents may approve under a delegation the founder gives once), which owns
> the caller this spec changes.

## One-Sentence Scope

When the delegated-approval caller skips a spec because an open pull request touches it,
it reads that blocker's age and merge state from the open-PR list it already fetches, and
reports a blocker past a stated age as a distinct, visible `stale-blocker`, repeated every
drain cycle until the blocker merges or closes, without ever closing, updating, or
approving past the blocker itself.

## Context: what exists today, and the gap

Observed on this branch's base (`d97eeb49`), by reading the code:

- **The skip.** `scripts/lib/delegated-approval-caller.ts:466-475` skips any candidate whose
  artifact or sidecar path appears in `openPaths`, with reason `in-open-pr`. Since #3927 the
  `detail` names the blocking PR numbers. Nothing else about the blocker is consulted.
- **The read it rests on.** `delegated-approval-caller.ts:340-361` runs one
  `gh pr list --state open --limit 500 --json number,headRefName,files` and builds
  `openPaths` (path to PR numbers) and `openHeads`. No age, draft, or merge-state field is
  requested, so the caller cannot tell a PR opened an hour ago from one open for a week.
- **Where the skip goes.** The caller's JSON report is printed by
  `record_delegated_approvals` in `scripts/drain-inbox.sh:1579-1609`. Exit code 0 prints
  `delegated approval: done (outcomes in the report above)`. A skip is `outcome: 'skipped'`,
  so a held spec never changes the exit code and never produces a WARNING line. The hold is
  only visible to someone who reads every per-artifact row of the JSON every cycle.
- **Why the blocker never moves on its own.** `scripts/remediate-pr.sh:224-232` refreshes a
  BEHIND pull request only by `rebase-only`, and defers a BEHIND + `ai-review:pass` PR to
  its one-at-a-time merge turn (`skip-awaiting-merge-turn`, #3069). A spec PR that needs a
  human merge or approval never reaches a merge turn on its own, so a BEHIND spec PR can
  sit indefinitely. I believe this is the path #3800 is on, unverified: this dispatch makes
  no network call and did not read #3800's labels.

**The defect, stated as mechanism (RCDD, DR-003).** The skip asks one question ("does an
open PR touch this path?") and never asks whether that PR is still live, so it cannot
tell a pending change from an abandoned one. And no gate requires a held spec to show up
anywhere a reader is looking: the hold has no deadline and no escalation. The fix
therefore has two halves: a judgement (is the blocker stale?) and a surface (say so where
the shepherd reads).

**Why the skip itself stays.** Approving a spec while an open PR changes that spec or its
sidecar would race that PR. Either the approval records a hash the open PR is about to
invalidate, or the two PRs conflict on the sidecar. The skip is correct. It is the silence
that is the defect. This spec never weakens the hold. It only makes a long hold visible.

## Functional requirements

- **FR1: Read blocker facts in the same call.** The caller's single open-PR read adds the
  fields needed to judge a blocker: `createdAt`, `isDraft`, and `mergeStateStatus` (and
  `updatedAt` only if D1 picks it). It adds no second GitHub call per blocker, and the
  `OPEN_PR_LIMIT` truncation refusal stays as it is.
- **FR2: Judge each blocker.** For each blocking PR of an `in-open-pr` skip, the caller
  classifies the blocker as exactly one of:
  - `live`: its age (per D1) is under the stale threshold (per D2);
  - `stale`: its age is at or over the threshold;
  - `unjudged`: any fact FR2 needs is missing or unparseable (for example, `createdAt` is
    absent or not a valid timestamp).

  The classifier is a pure function of the PR row and `deps.today()` (or an injected
  clock), so the tests need no network.
- **FR3: Report a stale blocker distinctly.** When at least one blocker of a skipped
  artifact is `stale`, the skip's reason is `stale-blocker`, not `in-open-pr`. The `detail`
  names each stale blocker's number, its age in whole days, and its merge state as read
  (for example `#3800 open 5d, BEHIND`), plus any `live` blockers by number. The outcome
  stays `skipped`: the artifact is still not approved this cycle (FR6).
- **FR4: Unjudged is visible, never live.** A blocker FR2 cannot judge is reported with
  reason `in-open-pr-unjudged`, and the detail names the missing fact. It is never counted
  as live, which would hide it, and never as stale, which would claim an age nobody read
  (constitution invariant 2, no silent gate: a missing witness fails visibly).
- **FR5: Surface on the drain's own channel, every cycle.** `record_delegated_approvals`
  prints one WARNING line to stderr per cycle when the report holds any `stale-blocker` or
  `in-open-pr-unjudged` row. The line names every such spec and its blocker(s). It is
  printed whatever the caller's exit code, and is repeated every cycle until the condition
  clears, so the hold has a visible heartbeat (D3 decides whether anything beyond this
  line is added).
- **FR6: Never act on the blocker.** Nothing here closes, comments on, labels, updates,
  rebases or merges the blocking PR, and nothing approves the held spec past it. A stale
  blocker is a finding for the shepherd, not permission. (D4 records why auto-update is
  not taken.)
- **FR7: Live blockers are unchanged.** A skip whose blockers are all `live` keeps reason
  `in-open-pr` and today's detail text byte-for-byte, so existing log readers and tests
  that key on it do not break.
- **FR8: Threshold is configurable and validated.** The stale threshold comes from a
  default (D2) overridable by one environment variable or flag, following the existing
  `MINSPEC_DRAIN_DELEGATED_APPROVAL_MAX` pattern. A non-positive-integer value refuses the
  stage visibly, in the same shape as `drain-inbox.sh:1586-1589`. It never falls back
  silently to the default.

## Acceptance criteria

- **AC1** (FR2, FR3). A fixture blocker with `createdAt` at threshold+1 days and
  `mergeStateStatus: BEHIND` yields one `skipped` row with reason `stale-blocker`, whose
  detail contains the PR number, the age, and `BEHIND`.
- **AC2** (FR7). A fixture blocker opened today yields reason `in-open-pr` with the exact
  pre-change detail string.
- **AC3** (FR2 boundary). A blocker whose age is exactly the threshold is `stale`, and
  threshold-1 days is `live`. This is a test on both sides of the boundary, not one.
- **AC4** (FR4). A blocker row with no `createdAt`, and one with `createdAt: "garbage"`,
  each yield `in-open-pr-unjudged`, never `in-open-pr` and never `stale-blocker`.
- **AC5** (FR3, mixed). An artifact held by one live and one stale PR reports
  `stale-blocker` and names both, marking which is which.
- **AC6** (FR5). A drain-stage test with a stubbed caller report containing one
  `stale-blocker` row shows the WARNING line on stderr under exit code 0. The same report
  with only `in-open-pr` rows shows no such line.
- **AC7** (FR6). No new `gh` verb beyond `pr list` appears in the caller. A test asserts that
  the `deps.gh` calls made in a run holding a stale blocker are exactly the ones made in
  a run holding none (this proves the behaviour, not the source text).
- **AC8** (FR8). Threshold values `0`, `-1`, `abc` and an empty string each refuse the stage
  with a WARNING naming the bad value, and run no caller.
- **AC9** (regression, the issue's case). A fixture mirroring #3800 (open since
  2026-11-16, BEHIND, touching `specs/.../SPEC-311.../requirements.md`) with the clock at
  2026-11-21 reports `stale-blocker` for SPEC-311 under the D2 default.

## Invariants this change must not break

- **Constitution 1 (offline core).** All of this is dev-time tooling in `scripts/`, not
  shipped (DR-086 §5). The extension gains no network call.
- **Constitution 2 (no silent gate).** The change exists to remove a silent hold. FR4 and
  FR8 keep the new judgement fail-visible: an unreadable fact or a bad threshold is named,
  never defaulted.
- **Constitution 3 (blast radius).** Unchanged: the caller already refuses a repo without
  `.minspec/`, and nothing here writes outside this repo's own PR list.
- **The hold itself (race safety).** An artifact with any open blocker is never a
  candidate, stale or not (FR3, FR6).
- **Caller fail-closed contract** (`delegated-approval-caller.ts:22-29`). The run-level
  refusals, including `open-pr-read-truncated` and `open-pr-read-failed`, are unchanged.
- **Identity.** No write under any identity is added (FR6). The bot-token check stays as
  it is.

## Out of scope

- **The upstream producer (issue option 3).** The PR that recorded Clarify answers (#3697)
  left `phases.clarify: pending`, which spawned separate close-out PRs (#3800, #3801). That
  is a different producer with its own gate gap. D5 asks whether to track it separately.
- **#3801 / SPEC-305's missing `implements:`.** Tracked by #2323 / #1561.
- **Clearing the current holds.** Merging or closing #3800 and #3801 is a one-off operator
  act. This spec makes such holds visible. It does not resolve these two.

## Decisions needed (Clarify)

- **D1. What "age" means.**
  - (a) **(rec)** Time since `createdAt`. It is monotonic and read in the same call, and bot
    comments or label churn cannot reset it. Cost: a long-running but actively pushed spec
    PR is flagged stale, but flagging only adds a log line (FR6), so a false positive costs
    one line per cycle.
  - (b) Time since `updatedAt`. Cost: every ai-review comment, label flip or drain touch
    bumps it, so a dead PR that bots keep touching never goes stale. That is the exact
    silence this spec removes.
  - (c) Time since the last head push, or time BEHIND. Cost: GitHub reports neither in
    `pr list`. It needs a per-PR commits read (more calls, against FR1) or state kept
    between cycles (new persistence).

  **Recorded selection: the recommended option,** (a), age is the time since `createdAt`. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-22; sign-off ratifies it.

- **D2. Default threshold.**
  - (a) **(rec)** 3 days. #3800 had been open 5 days when #3932 was filed, so 3 days would
    have surfaced it two days earlier. Cost: a spec PR legitimately waiting on a weekend
    human read gets flagged on day 3.
  - (b) 7 days. Cost: a real hold sits silent for a week before anything shows.

  **Recorded selection: the recommended option,** (a), a default threshold of 3 days. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-22; sign-off ratifies it.

- **D3. Where the stale blocker is surfaced, beyond the report row.**
  - (a) **(rec)** The FR5 WARNING line on the drain's stderr, every cycle. Cost: it is
    still log-only. If nothing reads the drain log, the hold stays unseen, just more
    findable. It relies on the shepherd (chief-of-staff runner) reading drain WARNINGs.
  - (b) (a) plus one idempotent bot comment on the blocker PR naming the held spec. Cost:
    a GitHub write on a PR the caller does not own, a new write verb against FR6/AC7, and
    comment noise on human-held PRs.
  - (c) (a) plus one tracking issue per stale blocker. Cost: issue churn, and a dedup rule
    to build and keep right.

  **Recorded selection: the recommended option,** (a), the FR5 WARNING line on the drain's stderr, every cycle. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-22; sign-off ratifies it.

- **D4. Auto-update a BEHIND blocker (issue option 2).**
  - (a) **(rec)** No. Not taken here. `remediate-pr.sh` already owns BEHIND refreshes
    (`rebase-only`, and `skip-awaiting-merge-turn` under strict, #3069/#3748). A second
    updater in the caller would duplicate that predicate, and duplicated predicates drift.
    It would also not unstick a PR waiting on a human. Cost: a BEHIND blocker that only
    needs a rebase still waits for remediate-pr's own turn.
  - (b) Yes, the caller updates BEHIND blockers. Cost: as above, plus a new write verb from
    the approval caller.

  **Recorded selection: the recommended option,** (a), no: the caller does not auto-update a BEHIND blocker. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-22; sign-off ratifies it.

- **D5. The upstream producer (issue option 3).**
  - (a) **(rec)** Track it as its own issue: the Clarify-recording producer should set
    `phases.clarify` itself, so no close-out PR is spawned. Cost: it needs one more issue,
    filed by someone allowed to (this dispatch cannot), and until it lands more close-out
    PRs can be spawned. This spec at least makes each of them visible once it is past the
    threshold.
  - (b) Fold it into this spec. Cost: it widens a two-file reporting change into a
    second producer with its own phase-field semantics, and that question is still open
    in SPEC-320 (#3414).

  **Recorded selection: the recommended option,** (a), track the upstream producer as its own issue. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-22; sign-off ratifies it.

- **D6. Should a stale blocker ever escalate past a log line on its own (auto-close after
  M days)?**
  - (a) **(rec)** No. Closing someone else's spec PR is outward-facing and throws away
    review state, so it stays a human or shepherd act. Cost: the hold still has no hard
    deadline. Only its visibility grows.
  - (b) Auto-close after M days. Cost: it is irreversible in effect for a human-reviewed
    spec PR, and needs a DR.

  **Recorded selection: the recommended option,** (a), no: a stale blocker never escalates past a log line on its own. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-22; sign-off ratifies it.

## Follow-ups (tracked)

- D5(a), if chosen: an issue for the Clarify-recording producer setting `phases.clarify`
  itself. It is not filed yet, because this dispatch makes no network call. The dispatch
  summary asks for it to be filed.
