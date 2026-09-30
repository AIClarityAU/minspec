---
id: SPEC-074
type: requirements
status: specifying   # DERIVED, not a regression: the 2026-09-30 amendment (#2237) stales the approval that landed in #2077, and deriveStatus returns 'specifying' whenever approvalState !== 'approved' (SPEC-022 INV-1, not this spec's INV-1). Re-approval flips this back to 'planning'.
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute — the dev-time autonomous build/merge pipeline (dispatch-issue.sh's own crash-classification lives here)
aspects: [agent-dispatch, quota, labeling, no-silent-gate, tier-0]
relates_to: [SPEC-044, SPEC-062, DR-063, DR-084, DR-076]
implements: [packages/minspec/tests/dispatch-quota-classification.test.ts]  # NEW — the T3 regression test this spec owns
affects: [scripts/dispatch-issue.sh, scripts/dispatch-ready-check.sh, scripts/drain-inbox.sh]  # dispatch-issue.sh is OWNED by SPEC-044 via implements: — this spec modifies its crash branch, never owns the file (INV: one owner per file). dispatch-ready-check.sh is currently unowned by any spec; this spec adds one line (the countermand list) without claiming ownership of the file. drain-inbox.sh is also OWNED by SPEC-044; since the 2026-09-30 amendment this spec may expose its existing CLI-notice matcher to dispatch (FR-1/FR-2), never change what it matches or how the drain backs off (FR-6).
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# MinSpec — Distinguish provider-quota exhaustion from a genuine dispatch dead end (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch
> that produced it. A human reads this spec, resolves the
> **[Decisions needed (Clarify)](#decisions-needed-clarify)** section, and approves it
> through the normal spec-approval gate before anything is built.

Materializes **#1656** — *"provider quota exhaustion is recorded as agent-escalated, so a
wait-for-reset is indistinguishable from a genuine dead end."* Sibling of **#1652** ("the
other way an issue leaves the queue in a state nothing retries" — not read for this spec;
flagged only so a reviewer doesn't conflate the two).

## Amendment (2026-09-30) – the drain's CLI-notice matcher, not `isQuotaExhaustion`

The approval that landed in #2077 rested on two premises that no longer hold. The first,
that `$LOG` is harness-only text, was refuted by **#2233** (drain paused on the word
"quota"): `$LOG` is written by `claude -p ... --output-format text 2>&1 | tee "$LOG"`, so it
holds the agent's final message as well as any CLI notice. The second, that `drain-inbox.sh`
classifies the same stream with `isQuotaExhaustion` from
`.github/scripts/ai-review-guard.js`, stopped being true when **#2239** (the drain's
CLI-notice matcher) merged on 2026-09-30. Built as approved, this spec would stamp
`agent-blocked-quota` on a genuine crash whenever the agent's prose discussed quotas, and
AC-6 would pin dispatch to a predicate the drain no longer uses. **#2237** (SPEC-074 rests
on a refuted premise) tracks this amendment.

Amended, each marked inline: FR-1, FR-2, FR-6, AC-3, AC-4, AC-6, AC-7, INV-3, the three
Context passages that named the classifier, Why no new DR, Test items 3 and 5, and
`affects:` (FR-2 needs the matched lines, so the drain's matcher must be exposed to
dispatch). Unchanged: the scope, FR-3 to FR-5, AC-1, AC-2, AC-5, the other invariants and
both Clarify decisions. This edit stales the approval, so the spec derives `specifying`
until the founder re-approves it.

## One-Sentence Scope

When the build agent `scripts/dispatch-issue.sh` launches via `claude -p` dies because the
underlying subscription/session quota is exhausted, label and comment the issue distinctly
from a genuine agent-escalated dead end or an unrecognised crash, without restoring
`agent-ready` — so a human is never summoned to adjudicate a condition that only time can
resolve.

## Context

### The three-way collapse (the defect)

`scripts/dispatch-issue.sh` currently has exactly one terminal state for three causally
different events, all reached through the same `else` branch of the top-level launch
`if` (current line numbers; see `git blame` for drift):

1. **Genuine dead end** — the agent itself emits `ESCALATE:` (detected at `dispatch-issue.
   sh:1579`), the one allowed DR-355 opus retry has already run (`escalate_next_action`,
   `:1505-1598`), and a human's judgement is the only way forward. Correctly labeled
   `agent-escalated,needs-human-review` at `:1594-1598`.
2. **An unrecognised crash** — the `claude -p` pipeline itself exits non-zero for an
   unknown reason. Handled by the `else` at `:2005-2021`, which stamps the SAME
   `agent-escalated,needs-human-review` pair and removes `agent-ready` — added by #1307
   specifically because a crash is "at least as strong a reason to stop as an agent's own
   admission that it cannot proceed" (comment at `:2006-2014`, citing #1112's two-round
   silent-requeue-then-crash-again loop).
3. **Provider quota exhaustion** — the CLI's own subscription/session-limit message (e.g.
   `You've hit your session limit · resets 1pm (Australia/Sydney)`), which is neither an
   agent judgement nor an unknown failure: it is a stated, time-bounded, self-healing
   condition. It currently falls into path 2 — `grep -niE 'session limit|quota|rate.?
   limit|resets'` over `dispatch-issue.sh` returns no detection for it (the only hit is an
   unrelated comment at `:119`, part of the machinery-witness prose, not dispatch logic).

Only case 3 needs nothing but time. Cases 1 and 2 need a human. Collapsing them means a
human is summoned for a condition no human can act on, and — per the issue report — three
dispatch attempts in one session (#1506 twice, #1504 once) each required a full manual
recovery cycle (notice the labels, re-triage to clear `needs-human-review`/`agent-
escalated`, restore `agent-ready`, re-dispatch) that produced zero commits, because the
quota had not actually reset.

It also degrades the signal `agent-escalated` exists to carry. DR-063 already made this
exact move once, for the AI-reviewer's own label (`ai-review:changes` was overloaded
between "reviewer read the code and wants fixes" and "review could not produce a
trustworthy verdict" — DR-063 split out a `blocked` class and the `isQuotaExhaustion`/
`isQuotaExhaustionStrict` predicates in `.github/scripts/ai-review-guard.js` to tell the
two apart without a human). This spec applies the same split to the *dispatch* label
family, but not with DR-063's content predicates: `$LOG` carries the agent's prose, so the
classifier is the drain's CLI-notice matcher — see FR-1 (amended 2026-09-30).

### Prior art already in this repo that this spec must reuse, not duplicate

- **`.github/scripts/ai-review-guard.js`** exports `isQuotaExhaustion(text)` (loose,
  correct for harness/CLI diagnostic text), `isQuotaExhaustionStrict(text)` (tight, meant
  for agent-authored prose that might merely *discuss* quotas – narrower, not exact: it
  still matches `too many requests` and `429`), and
  `parseResetInstant(text, nowMs)` (extracts an ISO-8601 reset instant from either a
  relative "`resets in 25 minutes`" or absolute "`resets 1pm (Australia/Sydney)`"
  phrasing, or returns `null` — which callers MUST read as "retry on the normal cadence",
  never as "never retry"). All three are already unit-tested
  (`.github/scripts/ai-review-guard.test.js`). *Amended 2026-09-30:* the quota predicates
  are consumed by the review path (`scripts/review-branch.sh`,
  `scripts/review-approvable.sh` and `scripts/review-decide.sh`), which keeps them, because
  it can still judge the reviewer's stderr (harness text) loosely and fall back to the
  strict variant on its stdout (model text) only when stderr is silent (`quota_failure` in
  `review-branch.sh`). `scripts/drain-inbox.sh` was a consumer until #2239 (the drain's
  CLI-notice matcher): it receives one merged stream and cannot make that split.
  `scripts/dispatch-issue.sh` does not yet call into this module; after this spec it calls
  `parseResetInstant` (FR-2) and never the quota predicates (FR-1).
- **`scripts/drain-inbox.sh`** already classifies dispatch-issue.sh's *combined stdout*
  with `is_quota()` (`classify_dispatch`) and, on a hit, pauses the whole drain **cycle**
  (`return 42`). *Amended 2026-09-30:* since #2239 (the drain's CLI-notice matcher),
  `is_quota()` matches only the Claude CLI's own limit-notice lines: a closed list of forms
  (`_quota_notice_forms`, compiled to `QUOTA_NOTICE_RE`), anchored at column 0, and read
  outside paired markdown code fences (`quota_notice_lines`). So an issue title, a commit
  subject or the agent's prose that merely mentions a limit is not a signal. It is exposed as
  the pure seam `scripts/drain-inbox.sh --is-quota` and pinned by the #2233 T3 regression
  block in `packages/minspec/tests/drain-continuous.test.ts`. Only the matched lines reach
  the drain's own reset parser (`quota_publish_notice`). And after a signal that only a
  child's text raised, the drain refreshes the meter before any long sleep: a fresh reading
  with headroom in every window it can see contradicts the signal, so the drain rests a
  brief backoff instead of sleeping to the published reset (`quota_signal_sleep_decision`),
  a veto capped at `MINSPEC_QUOTA_CONTRADICT_MAX` signals in a row, after which it fails
  closed to the reset. All of this is orchestrator-level throttling. It does not touch the
  per-issue GitHub labels dispatch-issue.sh itself writes, which is exactly the gap #1656
  reports. The two are complementary, not overlapping: this spec's
  fix makes the *label* correct; drain-inbox.sh's existing gate makes the *next dispatch
  attempt* wait. Both should keep working after this change (AC-7).
- **`scripts/dispatch-ready-check.sh:635`** already carries a "countermand list" — labels
  that must block re-readying an issue even if a stale `agent-ready` lingers — specifically
  because of the #1068/#1112 defense-in-depth lesson (comment at `:616-634`): a single
  missed label write must not reopen the hole. A new label that removes `agent-ready` but
  is absent from this list repeats exactly the bug that list exists to prevent.

### Why no new DR

DR-359's filter (costly-to-reverse in under a day) doesn't apply: this reuses an existing,
already-tested classifier, adds one new GitHub label (revertible by deleting it), and
changes one script's branch ordering (since the 2026-09-30 amendment, also exposing the
drain's existing matcher to it, an equally reversible seam or shared file). DR-063 and DR-084 already establish the governing
precedents (split an overloaded label; the pipeline can jam on shared quota) — this spec
applies them, it doesn't set new policy. No DR is proposed; `docs/decisions/INDEX.md` has
no existing entry for this narrower question either.

## Functional Requirements

- **FR-1 (single-sourced detection, no new regex) – amended 2026-09-30 (#2237).** Before
  the existing generic-crash branch (`dispatch-issue.sh`'s `else` at `:2005`) applies any
  label, the captured `$LOG` MUST be tested with the SAME matcher `drain-inbox.sh`'s
  `is_quota()` uses: the Claude CLI's own limit-notice lines (`_quota_notice_forms` →
  `QUOTA_NOTICE_RE`, filtered by `quota_notice_lines`), anchored at column 0 and read
  outside paired markdown code fences. Dispatch reaches it either through the drain's pure
  seam `scripts/drain-inbox.sh --is-quota` or through one shared `scripts/lib` file that
  both scripts source; which one is a Plan decision (FR-2 bears on it). NOT
  `isQuotaExhaustion`, loose or strict: `$LOG` is written by `claude -p ... --output-format
  text 2>&1 | tee "$LOG"`, so it holds the agent's final message as well as any CLI notice,
  and a content predicate reads that prose as a signal. #2233 measured exactly this in the
  drain: on 2026-09-30 an issue title, a commit subject and an agent quoting `too many
  requests` in a dispatch's output paused it three times while the meter read 5h 0%. The
  strict variant is no answer: it still matches `too many requests`.
  *Rationale: a second, hand-rolled regex in dispatch-issue.sh would drift from the
  tested one the instant either changes — the exact class of bug DR-063 exists to prevent —
  and the per-issue label and the drain's cycle pause read the same text, so they must
  agree on what in it is a wall.* *Honest limit, inherited with the matcher:* an unfenced
  column-0 copy of a CLI limit line in the agent's own output still matches. The drain has
  the meter as a second witness for that residue (see Context); the per-issue label has
  none under this spec. Hitting that residue takes a crash whose own output reproduces a
  wall line exactly that way.

- **FR-2 (reset time, best-effort) – amended 2026-09-30 (#2237).** When FR-1 matches, the
  notice lines it matched, not the whole `$LOG`, MUST be run through `parseResetInstant`
  from `.github/scripts/ai-review-guard.js` to recover a reset instant. Over the whole
  `$LOG`, the agent's prose could displace or null out the CLI's stated reset:
  `parseResetInstant` prefers the first relative phrase (`resets in 25 minutes`) anywhere
  in its input over any absolute one, and returns `null` when the first absolute phrase it
  finds carries no zone. The drain feeds its own reset parser only the notice lines for the
  same reason (`quota_publish_notice`, #2239). `--is-quota` answers only yes or no, so the
  Plan MUST give dispatch the matched lines through the same single source as FR-1 (a
  sibling pure seam on `drain-inbox.sh`, or the shared `scripts/lib` file), never through a
  second pattern (INV-3). A `null` result (no reset time stated, or unparseable) MUST be
  treated as "reset time not stated" in the posted comment (FR-4) — never as grounds to
  skip the quota classification or to imply "never retry."

- **FR-3 (distinct label, no requeue).** On an FR-1 match, the issue MUST receive a new
  label `agent-blocked-quota` in place of `agent-escalated`. `needs-human-review` MUST NOT
  be applied. `agent-running` and `agent-ready` MUST still be removed, exactly as the
  existing crash branch does today — preserving the #1112 no-silent-requeue protection
  without change. `agent-blocked-quota` MUST be added to `scripts/dispatch-ready-check.sh`
  `:635`'s countermand list, so a stale `agent-ready` cannot outvote it (the same
  defense-in-depth the comment at `:616-634` already documents for `agent-quarantined`,
  `agent-done`, and `agent-escalated`).

- **FR-4 (legible, not just labeled).** On an FR-1 match, dispatch-issue.sh MUST post an
  issue comment stating plainly that the issue was NOT dispatched because of provider quota
  exhaustion, and MUST include the reset time from FR-2 when known ("resets 1pm (Australia/
  Sydney)") or an explicit "reset time not stated in the CLI output" when not. *Rationale
  (the issue's own words): "A human then knows there is nothing to review."*

- **FR-5 (the other two paths are unchanged).** The `ESCALATE:` path (`:1579-1598`,
  including the DR-355 opus retry) and the generic-crash path for anything FR-1 does NOT
  match MUST behave exactly as they do today: same labels, same retry behaviour. FR-1's
  check is a new, narrower branch spliced in ahead of the generic crash handling, not a
  replacement for it.

- **FR-6 (drain-orchestrated runs are not double-counted incorrectly) – amended 2026-09-30
  (#2237).** When dispatch-issue.sh is launched by `drain-inbox.sh`'s fan-out,
  `drain-inbox.sh`'s own `classify_dispatch`/`is_quota` reads dispatch-issue.sh's *entire*
  stdout. What it detects there is the CLI's own limit line, which `tee "$LOG"` passes
  through unprefixed at column 0, not the FR-4 comment-echo, so it continues to detect the
  outage and pause the drain cycle, unchanged. The implementation MUST keep that
  passthrough as it is (no prefix, no indent, no fence around the CLI's output): the drain's
  matcher depends on it, and AC-7 pins it. This spec MUST NOT alter drain-inbox.sh's own
  detection or backoff, including the meter check before a long sleep; exposing the
  existing matcher to dispatch (FR-1/FR-2) is the only drain-side change it permits, and it
  must leave what the matcher matches unchanged. The two layers (per-issue label, per-cycle
  pause) are independent witnesses to the same event, not a hand-off (constitution
  invariant 2 — an independent second witness is a feature here, not redundancy to
  remove).

## Acceptance Criteria

- **AC-1 (FR-1/FR-3, the reported case).** A fixture `$LOG` containing the session-limit
  signature (`You've hit your session limit · resets 1pm (Australia/Sydney)`) produces
  `agent-blocked-quota`, and NEITHER `agent-escalated` NOR `needs-human-review`. `agent-
  ready` is not present afterward (removed, never restored).
- **AC-2 (FR-5, negative — escalation unchanged).** A fixture `$LOG` containing `ESCALATE:
  <reason>` still takes the existing escalation path, including the one DR-355 opus retry
  when eligible, and still ends in `agent-escalated,needs-human-review` when the retry
  budget is spent. Asserted by execution against `escalate_next_action`, not by reading
  source text.
- **AC-3 (FR-5, negative — unknown crash unchanged) – amended 2026-09-30 (#2237).** A
  fixture `$LOG` that is a crash but matches neither `ESCALATE:` nor the FR-1 matcher still
  takes today's `:2005-2021` path unchanged: `agent-escalated,needs-human-review`,
  `agent-ready` removed. The fixtures MUST include the #2233 shapes, crashes whose `$LOG`
  only *mentions* a limit: agent prose quoting `too many requests` or saying `quota`, and a
  wall line quoted inside a code fence or indented. Each is paired with a control that
  appends the genuine CLI wall line and must then classify as quota, so a matcher that
  matched nothing cannot pass (the pattern of the #2233 block in `drain-continuous.test.ts`).
- **AC-4 (FR-2/FR-4) – amended 2026-09-30 (#2237).** A `$LOG` with an absolute reset phrase
  produces a posted comment that states the parsed instant/time; a `$LOG` that matches FR-1
  but carries no parseable reset phrase (e.g. the bare CLI line `You've hit your session
  limit`, with no `· resets …` suffix) still produces `agent-blocked-quota` and a comment
  that explicitly says the reset time is not stated — never a thrown error, never a silently
  skipped comment. A `$LOG` whose agent prose carries a different reset phrase (`resets in
  25 minutes`) beside the AC-1 wall line produces a comment stating the wall line's reset
  (1pm Australia/Sydney), not the prose's.
- **AC-5 (FR-3, countermand list).** With `agent-blocked-quota` present and a stale
  `agent-ready` also present, `scripts/dispatch-ready-check.sh` refuses (does not admit the
  issue as ready), mirroring the existing `agent-quarantined`/`agent-done`/`agent-escalated`
  rows in the same list.
- **AC-6 (FR-1, no drift) – amended 2026-09-30 (#2237).** dispatch-issue.sh's quota check
  and `drain-inbox.sh`'s `is_quota()` resolve to the SAME matcher, one pattern list and one
  fence filter defined in ONE file (`drain-inbox.sh` itself, reached through `--is-quota`,
  or the shared `scripts/lib` file both source). Asserted by a test that would fail if
  dispatch-issue.sh ever inlined its own copy of the patterns or called `isQuotaExhaustion`
  or `isQuotaExhaustionStrict`, and that runs the AC-1 wall and the AC-3 fixtures through
  both scripts and gets the same verdict from each.
- **AC-7 (FR-6, non-regression) – amended 2026-09-30 (#2237).** With drain-inbox.sh
  orchestrating a dispatch that hits the AC-1 fixture, drain-inbox.sh's own cycle-level
  pause (`return 42`) still fires, unchanged by this spec. This is the contract test between
  the two scripts: the drain's matcher relies on the CLI's line reaching its capture at
  column 0 through dispatch-issue.sh's `tee "$LOG"`, an assumption #2239's review flagged as
  load-bearing and that only fixtures pin today. So the test MUST drive dispatch-issue.sh's
  real output path (a stub `claude` that prints the AC-1 wall line), not feed the drain a
  fixture string. It asserts that the pause fires; how long the drain then rests is its
  meter check's call (a fresh reading with headroom shortens it), which this spec leaves
  alone.

## Invariants

- **INV-1 (constitution #2, no silent gate).** The quota branch changes *which* label is
  applied, never *whether* the outcome is visible: `agent-blocked-quota` plus the FR-4
  comment is at least as visible as today's `agent-escalated,needs-human-review`, just
  correctly classified. A quota hit must never fall through to silence.
- **INV-2 (#1112, no silent requeue).** `agent-ready` is never restored by this change,
  under any of the three paths. This is the property #1307 added for crashes generally and
  this spec must not weaken it for the quota subclass.
- **INV-3 (single source of truth) – amended 2026-09-30 (#2237).** No second,
  hand-maintained quota-detection regex may exist in `scripts/dispatch-issue.sh`, and it
  may not classify with `isQuotaExhaustion`/`isQuotaExhaustionStrict` either (those stay
  the review path's). If the CLI-notice matcher (`_quota_notice_forms` in
  `scripts/drain-inbox.sh`, or the shared `scripts/lib` file if the Plan moves it there)
  ever needs widening for this call site, it is widened THERE, where the #2233 regression
  tests pin it, not forked.
- **INV-4 (constitution #3, blast radius).** This change is internal dev-tooling for this
  repo's own dispatch pipeline; it introduces no network call, no new external dependency,
  and no behaviour reachable outside a repo that opts in via `.minspec/`.

## Decisions needed (Clarify)

### DQ-1 (scope) — bounded auto-reconsideration after the reset passes

The issue's step 4 proposes, as an explicit **optional** extra: letting the drain
reconsider an `agent-blocked-quota` issue once the recorded reset timestamp has passed,
capped at a small attempt count and logged each time.

- **Option A — split out (rec).** Ship FR-1 through FR-6 now (detection, labeling,
  comment, countermand-list fix) as this spec's whole scope; file a follow-up issue for
  reconsideration. *Cost:* an issue correctly diagnosed as "just wait" still needs a human
  (or a future session) to notice the reset has passed and manually restore `agent-ready` —
  the exact manual step the issue is trying to eliminate, just narrowed to "restore one
  label" instead of "diagnose, then clear two labels, then restore one."
- **Option B — build it now.** Add reconsideration logic to this spec. *Cost:* real new
  design surface this issue explicitly declined to specify — where the attempt counter
  lives (a label-encoded count? a sidecar file, matching this repo's existing sidecar-hash
  pattern? an issue-comment marker the countermand-list check would then need to parse?),
  how it composes with `drain-inbox.sh`'s OWN `quota_gate`/backoff cadence (which may
  already re-admit the whole `agent-ready` queue once its local `quota.json` reading shows
  the window reopened, in which case FR-6-style reconsideration might be solving a problem
  the drain's cycle-level gate already solves for free — unconfirmed, needs a read of
  `quota_gate`'s admit path against this specific scenario before designing on top of it).

Recommendation: **Option A.** The measured cost in the issue (three manual recovery
cycles) is eliminated by FR-1–FR-6 alone — the human no longer has to *diagnose* anything,
only to glance at a self-explanatory label once. Reconsideration is a genuine convenience
feature layered on top, not the fix for the reported defect, and bundling it risks
delaying the narrower, clearly-scoped fix on unresolved design questions.

### DQ-2 (scope boundary) — the creator-shepherd's own fix-agent call site

`shepherd_own_pr`'s fix-agent invocation (`scripts/dispatch-issue.sh:1762`, a SEPARATE
`claude -p` launch used to repair an already-opened PR's failing gate) has a structurally
similar shape — a `claude -p` call whose failure is handled generically — but it is not
named in #1656 and is not covered by this spec's FR/AC set.

- **Option A — out of scope (rec).** This spec's blast radius stays exactly what #1656
  named: the main build-dispatch crash branch. *Cost:* if the shepherd's fix-agent can also
  crash on quota (unconfirmed — not investigated for this spec), that call site keeps
  today's behaviour until a sibling issue covers it.
- **Option B — extend this spec** to cover the shepherd call site too. *Cost:* widens a T3
  spec answering a specifically-scoped bug report into a broader audit, without first
  confirming the shepherd path actually exhibits the same defect.

Recommendation: **Option A**, per this repo's own triage rule (CLAUDE.md: "detection ≠
integration," confirm-or-park rather than silently expand). If a human confirms the same
defect there, park it as a follow-up issue referencing this spec.

## Test

Matches the issue's own T3 regression spec:

1. A fixture log containing the session-limit line produces `agent-blocked-quota` and
   neither `agent-escalated` nor `needs-human-review`, and does not restore `agent-ready`
   (AC-1).
2. Negative: a log with `ESCALATE:` still takes the escalation path, including the DR-355
   opus retry (AC-2).
3. Negative: an unrecognised crash still takes the existing `:2005-2021` hold, unchanged,
   including a crash whose `$LOG` only mentions a limit (the #2233 shapes), each with its
   wall-appended control (AC-3; amended 2026-09-30).
4. `dispatch-ready-check.sh` refuses re-readying an issue carrying `agent-blocked-quota`
   (AC-5).
5. A single shared-classifier assertion (AC-6) — dispatch-issue.sh's quota check goes
   through `drain-inbox.sh --is-quota` (or sources the same `scripts/lib` file the drain
   does), carries no pattern of its own and no `isQuotaExhaustion` call, and returns the
   drain's verdict on the same fixtures — so the two can never silently diverge (amended
   2026-09-30).

New test file (owned by this spec):
`packages/minspec/tests/dispatch-quota-classification.test.ts`.
