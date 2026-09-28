---
id: SPEC-077
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination. Part A governs delivery between sessions, next to the presence, mailbox and coordinated-session specs; DQ-5 states the cost of this fit
aspects: [session-economics, prompt-cache, hooks, inter-session-comms, cadence, dev-time, offline, blast-radius, no-silent-gate]
relates_to: [SPEC-026, SPEC-027, SPEC-044, DR-073, DR-086, DR-057]  # presence heartbeat (not reused) · pull-only session mailbox (conforms) · coordinated sessions and their proposed central driver · shipped-hook write contract (only if ever shipped) · autonomy axis (DQ-6) · .minspec/queue/ is already taken. Issue refs (#1922 trigger, #1923 parent design pass, #1914 headless marker) are in Context and Traceability.
implements: [scripts/hooks/cold-resume.sh, scripts/hooks/cold-resume.py, packages/minspec/tests/cold-resume-hook.test.ts]  # all NEW, all dev-time only and never shipped (INV-6). The .py split mirrors .claude/hooks/session-title.{sh,py}; if Plan picks another language, rename here BEFORE approval, since these paths are hashed
affects: [.claude/settings.json]  # owned by no spec today; this spec only adds hook registrations to it
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec - Stop automated wakes of idle sessions, and warn before a cold resume (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, hook or test is created by the
> dispatch that produced it. A human reads it, resolves
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before anything is built.

Materializes **#1922** (the cold-resume guard issue, AIClarityAU/minspec): *"cold-resume
guard - warn before a prompt re-bills an expired cache, and stop automated messages waking
idle sessions"*. #1922 is a checklist item in the slices list of **#1923** (the session
stop-conditions design pass), not a GitHub sub-issue. New analysis belongs in this spec or
in comments on #1922, never in its body: the triage verdict on #1922 carries a body hash,
and editing the body makes that verdict stale.

## One-Sentence Scope

In this repository's own Claude Code sessions (dev-time tooling, nothing shipped to
adopters), hold non-urgent automated messages that would wake a session whose prompt cache
has expired until that session's next turn that runs anyway, and warn the human (later, only if
a named measurement says it is safe, block once) before a prompt re-bills an expired cache,
without ever losing a message and without ever acting on a headless run.

## Context

### The mechanism

A Claude Code session caches its prompt prefix. The main conversation's cache lives one
hour on a subscription within plan usage, and five minutes otherwise, including once usage
credits are being drawn (Claude Code docs, prompt caching and the `promptCacheTtl` setting,
read 2026-09-29). Only those two lifetimes exist, so an hour of idle is a hard boundary no
setting can move outward.

The first turn after the cache expires rewrites the whole prefix at the cache-write rate:
2x base input for the one-hour tier (1.25x for the five-minute tier), where a warm turn
would have read it at 0.1x (0.05x on Opus 5.5) (Anthropic pricing page, fetched
2026-09-29). On Opus 5 list prices that is $10 per million tokens written against $0.50
read.

An idle session does not wait for its human. A cross-session message, a background task
notification, a scheduled `/loop` or cron fire, or a goal check-in starts a model turn at
once and sends the full context (Claude Code docs, cross-session messaging and costs pages).
The measured median from arrival to first response is about 15 to 20 seconds (the same
2026-09-29 research as M9 below).

The issue puts it in one line: *"Session lifetime is the token lever; scope is a quality
lever."*

### What has been measured, and what each figure measures

Every figure below is a measurement of the operator's own transcripts. Each row names its
numerator and denominator, because the rows do not all measure the same quantity.

| # | Figure | What it measures | Date and source | Status |
|---|---|---|---|---|
| M1 | 98.0% (383 of 391) vs 1.31% (196 of 14,998) | Share of main-loop turns that rewrote the prefix, after a gap over 1h vs under 1h. 2,453 transcripts; detector not published | 2026-09-11, #1922 body | Over-1h rate re-derived 2026-09-29 on a 61-file sample with a different rewrite rule: 95.1% (154 of 162) vs 0.28% (21 of 7,596). The under-1h rate depends on the rewrite definition |
| M2 | about 16-18% (floor 16.3%, detector recall about 65%) | Idle-resume rewrites as a share of **total list-price spend** (all token types, dollars), 2,453 transcripts including workflow-agent transcripts | 2026-09-11, #1922 body | Not reproduced; source analysis not found |
| M3 | 64.1% (199.9M of 311.8M) | Full-prefix-rewrite tokens as a share of **raw cache-creation tokens** (not dollars, no input, output or reads) in 486 top-level interactive session files; subagent and headless transcripts excluded | 2026-09-28, chief-of-staff comment on #1922 | Arithmetic checks; share not re-derived (it swings 60-86% by sample) |
| M4 | 75.2% vs 26.7% | On the 61-file sample: rewrites were 75.2% of cache-creation tokens but 26.7% of total list-price spend, because cache writes were 35.3% of spend | 2026-09-29 re-derivation | Sample |
| M5 | 5.1% carry 86.6% | Events over 30k tokens are 5.1% of cache-creation events and carry 86.6% of **cache-creation tokens** (the comment says "of spend"; the underlying table measures tokens) | 2026-09-28 | Shape reproduced on the sample (3.3% carry 80.2%) |
| M6 | 81.3%; 85.5%; 9.4%; 3.8% | Shares of interactive cache-creation tokens: the top 15 session files; the MinSpecPro project; voip-sms-inbox; memory-fabric | 2026-09-28 | Not re-derived |
| M7 | 330k tokens, about $3.30 | Median rewrite window, priced at the Opus 5 one-hour write rate (estimated; about $2.64 on Opus 5.5) | 2026-09-11 (#1922 says ~$3.33); the 2026-09-28 median rewrite event is 301,619 tokens | Estimate |
| M8 | 23-26% (87-98 of 383) | Share of idle rewrites woken by an automated message | 2026-09-11 only | Conflicts with a 2026-09-29 sample: 57% of 154 idle rewrites automated, or 36% if cross-session socket deliveries (some of which relay the founder's own instructions) are excluded. One sample |
| M9 | see right | Cold wakes (gap over 3600s since the last main-chain response; rewrite = cache creation over 50% of input and over 20k) over 577 main-session transcripts: cross-session message 199 events / 63.8M tokens (median 302,677); task notification 51 / 21.2M (median 400,008); scheduled fire (2.1.278+) 49 / 16.3M; older cron 37 / 11.1M; human 449 / 149.2M. Since 2026-09-15: automated 156 events / 48.8M, human 105 / 32.6M | 2026-09-29 harness research | Measured, scratch analysis |
| M10 | 0 of 2,408 | Headless-dispatch cache-creation events that were expiry rewrites | 2026-09-28 | Not re-run |
| M11 | median 37,952 | First-turn context (the boot prelude) across 475 top-level interactive files; the headless boot median is 38,734. The "~70k prelude" in #1922 is roughly the 75th percentile of VS Code sessions, not the median | 2026-09-29 | Measured |
| M12 | 85.9% | On the sample, the trigger "gap over 1h AND previous context at least 150k" catches 138 of 175 full-prefix rewrites, carrying 85.9% of rewrite tokens (89.0% at 100k, 83.0% at 200k) | 2026-09-29 | Sample |
| M13 | 89.2% / 10.8% | Share of rewrite tokens that followed a gap over 1h vs a gap of 1h or less (cause of the short-gap ones unknown; all on one model, so not model switches) | 2026-09-29 | Sample |

**M2 and M3 are different quantities and must never be read as one.** M2 is a share of
total spend in dollars; M3 is a share of cache-creation tokens. Converting M3 through M4's
ratio (64.1% of cache-creation tokens, times cache writes being about 35% of spend) gives
roughly a quarter of total spend, which is the same order as M2. That conversion is an
estimate. When this spec needs one "share of spend" number it says *about a quarter of
total spend (estimated)* and cites both methods.

Where the evidence lives: the 2026-09-11 analysis's source was not found; the 2026-09-28
tables are in a machine-local file outside every repository; the 2026-09-29
re-derivations were scratch analyses, not committed. The figures are therefore quoted here
rather than linked, for the reason this repo's CLAUDE.md gives when citing #2056 (an in-repo
home for the merge-funnel rule): a link to a machine-local file resolves to nothing for
every reader but the operator.

### Why the ranking inverts

The issue ranked the human-facing warning first. The 2026-09-28 comment reversed it:
*"warning a human is the smaller half; stopping automated wakes of idle sessions is the
larger half"*, because *"cost is driven by polling cadence, not work done: a session woken
every ~90 min is near worst case and looks idle while expensive."* M9 agrees for the period
since
2026-09-15: automated cold wakes (48.8M tokens) outweigh human ones (32.6M). This spec
orders its parts that way: Part A (automated wakes), then Part B (the human warning), then
Part C (recycling guidance).

### What the harness provides (verified on Claude Code 2.1.283, 2026-09-29)

- The `UserPromptSubmit` hook fires on every prompt source tested: typed prompts, `-p`
  prompts, cross-session messages, background task notifications, `/loop` and `CronCreate`
  fires, cross-session idle notices, and (from about 2.1.260) messages queued mid-turn.
- Its stdin envelope carries `cwd`, `hook_event_name`, `permission_mode`, `prompt`,
  `prompt_id`, `session_id` and `transcript_path` (`scratchpad_dir` optionally). There is no
  field for the prompt's origin and none marking a headless run.
- The prompt text itself identifies three machine classes by prefix: `<cross-session-message`
  (a peer message), `<task-notification>` (a background task finished), and `[Cross-session `
  (the harness's cross-session notices). A scheduled fire is the bare command text, for
  example `/chief-of-staff`, identical to what a human types.
- The current prompt's own transcript record is not yet on disk when the hook runs. Records
  from earlier turns are.
- Blocking (exit 2, or `decision: "block"`) erases the prompt and stops the model request.
  Verified for a task notification: no assistant record, no cache write, and the last
  assistant `message.id` unchanged. In `-p` mode the block text replaces the run's final
  result. Exit 1 does not block. The default timeout is 30s; a timed-out hook's output is
  discarded and the prompt proceeds, silently.
- `additionalContext` (or plain stdout) is injected for the model, capped at 10,000 characters
  per field (overflow is saved to a file and replaced by a 2,000-character preview).
  `systemMessage` is shown to the user. A hook cannot rewrite the prompt and cannot trigger
  `/clear` or `/compact`.
- A `Stop` hook receives `session_crons`, including each cron's prompt text.
- Earlier user records in the transcript carry `turnOrigin` (`human`, `peer`,
  `task_notification`, `scheduled`, `sdk`) from 2.1.278. A typed prompt is `origin.kind:
  "human"`; a headless `-p` prompt is `turnOrigin: "sdk"` with no `origin`.
- There is no native headless marker: a `-p` run and the fleet's VS Code-hosted sessions
  both show entrypoint `sdk-cli` and registry kind `interactive`.
- Senders cannot see a recipient's idle time. `ListAgents` shows idle or busy and start time
  only; `SendMessage` has no urgent, defer or deliver-if-warm option.
- The native receiver-side hold (`crossSessionInbound: "hold"`) starts no turn, but it
  releases held messages only when an `accept` setting later applies, not on the next human
  prompt, and it is scoped to a settings file rather than a session. It cannot implement
  "deliver at this session's next turn".
- The status line receives rich cache fields, but the status-line probe in PR #1670 measured
  that it never runs in VS Code panel sessions. VS Code has its own prompt-cache clock.
- `/clear` costs nothing. `/compact` on a cold cache reprocesses the whole history uncached,
  its most expensive case.

**Not known (never probed):** what a block of a cross-session message does on the sender's
side; how VS Code displays a block reason or a `systemMessage`, and whether the blocked
prompt text is restored to the input box; how self-paced `ScheduleWakeup` fires arrive.
Every requirement below that depends on one of these is gated on a named probe (FR-7, FR-10).

### Who wakes sessions

- **Inside this repository:** no tracked file sends a cross-session message (no
  `SendMessage`, `notify_when_idle` or socket use anywhere). The launchers
  (`scripts/dispatch-issue.sh`, `scripts/remediate-pr.sh`, the `review-*.sh` family,
  `scripts/triage-inbox.sh`) start fresh `claude -p` runs, and the drain's loop writes to its
  own log. So the only in-repo wakes are harness task notifications for background tasks a
  session launched, plus the SPEC-027 inter-session mailbox, which is specified but not built.
- **Outside this repository:** the operator's chief-of-staff skill and its `cos.py` helper,
  in the operator's own Claude configuration. They `SendMessage` idle peers (the skill
  records *"a peer idle 25h woke and replied in 23s"*), arm `notify_when_idle`
  subscriptions, and run a loop whose cadence ladder is 15, 30 and 60 minutes. A founder
  rule in that skill (2026-09-25) reads *"The default is awake... Anything else idle is a
  defect... wake it."* The queue-proxy skill also messages the chief-of-staff session. That
  session itself runs in this repository's primary checkout, so this repository's hooks run
  inside it.

This spec cannot bind the out-of-repo senders (constitution invariant 3, blast radius). It
names them, conflicts with the founder rule openly (DQ-1), and carries their change as a
follow-up, not a requirement.

### Prior art in this repository

- `.claude/hooks/session-title.py` reads `transcript_path` bounded to the last 8 MiB
  (`MAX_TAIL_BYTES`) and fails open on every error. It is the only Claude Code hook MinSpec
  ships; DR-073 (writing a foreign `.claude/settings.json`) governs it.
- `scripts/hooks/scope-check.sh` is this repo's existing `UserPromptSubmit` hook. #1914
  (the headless-marker and scope-check issue) names two defects in it: a relative state path,
  so its verdict depends on the shell's cwd, and one state file per checkout rather than per
  session. This spec avoids both (FR-17).
- `scripts/hooks/*.sh` are dev-time only: registered in this repo's committed
  `.claude/settings.json`, absent from the template registry, never scaffolded into an
  adopter repo.
- `.minspec/queue/` is already DR-057's phase-advance request queue, so it is not reused.
- No code in this repository parses cache usage or tracks conversational idle time. The
  cost estimator and the gap detector are new.

### Related specs, and what this spec does not reuse

- **SPEC-026 (session presence).** Its liveness is an extension-host heartbeat (30s beat,
  120s stale). A session idle for an hour still heartbeats, and its session id is the
  extension's own id, not Claude Code's `session_id`. Its liveness predicate is not reused;
  this spec defines idleness as time since the last assistant turn (FR-13).
- **SPEC-027 (inter-session mailbox).** Specified, not built. Its recipient checks the inbox
  once at turn start with *"no new timer, no continuous polling"*, so by construction it
  cannot wake an idle session. It already conforms to Part A, and INV-9 keeps it that way.
- **SPEC-044 (coordinated self-completing sessions).** Its PR shepherd polls in shell and
  never starts a model turn. Its proposed Amendment A adds a single central merge-ordering
  driver (FR-4b there); in practice the chief-of-staff loop plays that role and is the
  high-cadence waker. Amendment A's own first open question ("Where does the driver live?")
  is the natural home for a cache-aware cadence.
- **DR-086 (autonomy as a second axis).** This repository runs with autonomy `act`, so a
  session may continue on its own after a background task finishes. That shapes DQ-2.
  #1923 asks whether Parts A and B need a DR-086 amendment (DQ-6).
- **#1914 (headless marker).** Open and quarantined; the proposed launcher marker exists on
  no branch. This spec does not depend on it (FR-15).

## Functional Requirements

Ordered by the inverted ranking. Part A and Part B both use the shared mechanics in FR-13
to FR-19, which are stated once at the end.

### Part A - stop automated messages waking a cold session (the larger half)

- **FR-1 (defer a non-urgent automated wake of a cold session).** When Part A is in
  `enforce` mode and a prompt classified as a peer message or a cross-session notice (FR-14)
  arrives in a session that is proven interactive (FR-15) and cold (FR-13), and the message
  does not carry the urgent marker (FR-3), the hook takes custody of it (FR-2) and then
  blocks it, so no model turn starts and no cache is rewritten. The block reason names the
  class, the sender's name when the envelope carries one, the idle time, and states that the
  message will be delivered with the session's next turn that runs. Task notifications
  follow DQ-2 (recommended: delivered, and logged by class). Possibly-scheduled and
  presumed-human prompts are never deferred (FR-4).

- **FR-2 (custody before block, at-least-once).** Before the hook emits any block for a
  deferred message it MUST have durably written the full prompt text, byte-identical, with
  its class, arrival time, `prompt_id`, `session_id` and sender name, to the parking store
  (FR-17), using a temporary file and an atomic rename. If any part of that write fails, the
  hook MUST NOT block: the prompt is delivered unchanged (the rewrite is paid) and the
  failure is logged and surfaced per FR-18. A session holds at most 100 parked messages (the
  native hold's own cap); any message beyond the cap is delivered, never dropped.

- **FR-3 (the urgent marker).** Because `SendMessage` has no urgency flag, urgency is a text
  convention: a peer message whose body's first non-whitespace token is `[urgent]`
  (case-insensitive) is delivered at once, whatever the cache state. The marker is the only
  per-message way out of deferral. The hook never infers urgency from wording.

- **FR-4 (never defer what cannot be identified).** Deferral applies only to classes the
  harness itself labels with a prompt-text prefix (FR-14). A presumed-human prompt or a
  possibly-scheduled prompt is never deferred.

- **FR-5 (delivery at the next turn that runs).** On the next prompt in the same session that
  the hook lets through to a model turn (a human prompt, an urgent message, a task
  notification, a scheduled fire, or any prompt once the session is warm), the hook injects
  every parked message for that session as `additionalContext`, in arrival order, under a
  header stating how many were deferred, when each arrived, and that they were held because
  the cache was cold. It removes them from the store only after that output is written. A
  body that would push the injection past the 10,000-character field cap is truncated in the
  injection and carries the absolute path of its parked file, which the model can read. While
  Part B blocks a prompt (FR-9), parked messages stay parked until a prompt passes.

- **FR-6 (visible expiry, never silent loss).** At `SessionEnd`, any message still parked
  for that session moves to an expired list. The next `SessionStart` in any checkout of this
  repository reports one line per expired message (class, sender, arrival time, file path)
  and a count, both as a user-visible message and as context for the model. Expired messages
  stay on disk until a human deletes them. The hook never deletes a parked message except
  after delivering it.

- **FR-7 (observe first; the would-defer audit decides enforcement).** Part A starts in
  `observe` mode: it logs each would-defer event (class, sender, arrival time, idle seconds,
  context size, and the first 300 characters of the body) and delivers the prompt
  unchanged. Task notifications are logged the same way even though DQ-2 recommends
  delivering them. An `audit` mode of the hook reads the log and the transcripts and reports,
  per class, the event count and the cache-creation tokens that the next assistant record
  actually wrote, which is the saving `enforce` would have produced.
  Part A moves to `enforce` only by a reviewed commit (FR-19), and only when all of these
  hold:
  1. probe P1 (what a blocked cross-session message does on the sender's side) and probe P2
     (how VS Code shows a block reason) have been run and their results recorded;
  2. DQ-1 is decided;
  3. the founder has reviewed a would-defer audit covering at least 7 consecutive days, and
     every would-defer message marked "needed before I returned" either carried the urgent
     marker or came from a sender that has since adopted it.

### Part B - warn the human before a cold resume (the smaller half)

- **FR-8 (warn on a cold human resume).** When a presumed-human prompt (FR-14) arrives in a
  proven-interactive (FR-15), cold (FR-13) session, the hook lets the prompt proceed and
  emits a warning (a `systemMessage`; the carrier is decided in DQ-3). The warning states:
  the idle time; that this turn rewrites about `ctx` tokens (FR-13); the estimated
  list-price equivalent (FR-16); and, for next time, that `/clear` with a short handoff note
  or a fresh session is cheaper, with the estimated restart saving (FR-11), and that
  `/compact` is not cheaper on a cold cache. The warning fires at most once per idle
  episode, keyed on `session_id` plus the last main-chain assistant `message.id`.
  A warning saves nothing on the turn it fires on, because the rewrite is already under way.
  Warn mode exists to measure (FR-10) and to tell the human what just happened.

- **FR-9 (block mode, off until FR-10 allows it).** In Part B `block` mode, the first
  presumed-human prompt of a cold episode is blocked. The reason carries the FR-8 content
  plus *"send it again to continue"*. Any later prompt in the same episode passes (the key is
  stable across a block, verified). `suppressOriginalPrompt` is not set, so the block
  message shows the original text for copying. Block mode never blocks: a machine-injected
  prompt, a possibly-scheduled prompt, a prompt in a session not proven interactive, or any
  prompt when the hook itself errors.

- **FR-10 (the cold-fire audit decides whether block mode turns on).** Definitions, fixed
  here so the 2%-35% false-positive spread in #1922 (which came from varying the rewrite
  definition) cannot recur:
  - A **fire** is a prompt that met FR-8's condition, logged with its episode key, context
    size, gap, model and `prompt_id`.
  - A fire is **determinable** when the transcript later holds a new, deduplicated
    main-chain assistant record after it.
  - A **true positive** is a determinable fire whose first such record is a full-prefix
    rewrite: `cache_read_input_tokens` below 0.5 x the previous context, AND
    `cache_creation_input_tokens` at least 0.3 x (previous context minus
    `cache_read_input_tokens`). This is the rule of the 2026-09-28 analysis, re-derived on
    2026-09-29 (M1).
  - A **false positive** is a determinable fire that is not a true positive.
  - A **misclassified machine prompt** is a fire whose prompt's own user record, read
    afterwards (matched by `prompt_id` where the transcript carries it, otherwise the first
    user record after the fire), has `turnOrigin` other than `human` or `origin.kind` other
    than `human`.
  - **Precision** is true positives divided by determinable fires.

  Block mode may be switched on (a reviewed commit, FR-19) only when every condition holds:
  a window of at least 7 days holds at least 30 determinable fires; precision is at least
  0.95; misclassified machine prompts are 0; and probe P2 (VS Code display) has passed. If
  fewer than 30 determinable fires accrue within 28 days, block mode does not turn on, and
  this spec is amended to record that the lever is below noise here. After block mode is on,
  the audit also reports how many blocks were followed by a resend of the same text (hash
  equal) in the same episode. If at least 90% of at least 30 blocks were resends, block mode
  reverts to warn, because it adds friction without changing a decision.

### Part C - recycling guidance

- **FR-11 (restart saving in the warning).** The estimated saving from restarting instead
  of continuing, on the resume turn, is `2 x (ctx - P) - H` cache-write-equivalent tokens,
  where `P` is this session's boot size (the first main-chain assistant record's context when
  it is inside the bounded tail, otherwise the measured median of 38,000 from M11) and `H`
  is a handoff-note allowance (Plan fixes the default). It is shown only when positive. On a
  cold cache, restarting wins on tokens whenever `ctx` exceeds `P + H`. The 150,000
  threshold (FR-13) is therefore a policy choice about interruption and lost context, not a
  token break-even (DQ-4).

- **FR-12 (the warm-recycling rule, recorded with corrected parameters).** For a warm
  session between tasks, recycling pays off once the context carried beyond boot exceeds
  `R(N) = w x B / (r x N)`, with `w = 2` (one-hour write), `r = 0.1` (0.05 on Opus 5.5),
  `B` about 38,700 (M11 headless boot median) and `N` the number of deduplicated API calls
  the next task will take. That gives about 64,600 at N=12, about 27,700 at N=28 and about
  7,700 at N=100. This rule applies only to warm sessions; a cold resume uses FR-11. The
  figure *"about 17,000 tokens beyond boot at the median 28 turns per task, falling to
  roughly 4,800 at 100 turns"* from the 2026-09-28 comment reproduces arithmetically but
  must not be cited: it used the five-minute write weight (1.25x) where this corpus writes
  at the one-hour tier (2x), it counted transcript lines (about 2.15 per API call) rather
  than API calls, and it assumed warm reads. This spec builds no warm-session nudge (DQ-8);
  FR-12 is guidance for the warning text, for the chief-of-staff follow-up, and for any later
  spec.

### Shared mechanics (used by Parts A, B and C)

- **FR-13 (the cold predicate).** From the transcript at `transcript_path`, read only the
  last 8 MiB (as `session-title.py` does). Take the last main-chain assistant record (not a
  sidechain record), deduplicated by `message.id`. Let `gap` be now minus its timestamp and
  `ctx` be its `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. The
  cache lifetime `TTL` is 300s when the most recent recorded cache write is in the
  five-minute tier, and 3600s otherwise (including when no tier is recorded). A session is
  **cold** when `gap > TTL` and `ctx` is at least 150,000. A transcript with no main-chain
  assistant record is never cold. A session with a turn in flight is never cold: when the
  last main-chain record in the tail is not an assistant record that ended its turn (for
  example an assistant `tool_use` still awaiting its result, or a tool result newer than the
  last assistant record, as when a foreground subagent runs for over an hour), the predicate
  is false, because the turn will run whatever the hook does. Reading "ended its turn" from
  the deduplicated record's `stop_reason` is inferred, not verified; Plan confirms the field
  and pins it by fixture.

- **FR-14 (prompt classification).** Every prompt falls in exactly one class, tested in this
  order:
  1. **peer message**: the prompt, after leading whitespace, begins `<cross-session-message`;
  2. **cross-session notice**: it begins `[Cross-session `;
  3. **task notification**: it begins `<task-notification>`;
  4. **possibly scheduled**: its text equals a cron prompt recorded for this `session_id` by
     the `Stop` hook from `session_crons`, or equals the text of an earlier user record in
     the tail whose `turnOrigin` is `scheduled`;
  5. **presumed human**: anything else.

  Classes 1 to 4 are **machine-injected**. Matching is by prefix or exact equality, never by
  substring, so a human prompt that quotes a tag mid-text stays presumed human. The
  classifier is a pure function, tested against synthetic fixtures shaped like real
  envelopes.

- **FR-15 (proven interactive; headless runs are never acted on).** The hook blocks,
  defers or warns only in a session proven interactive: an earlier user record in the
  transcript carries `turnOrigin: "human"` or `origin.kind: "human"`. Once seen, that fact is
  cached per `session_id` in the state store, so a long session whose last human record has
  left the 8 MiB tail stays proven. A session never proven interactive is logged at most and
  otherwise untouched. This needs no launcher marker: a fresh `claude -p` run has no earlier
  assistant turn and no human-origin record. If #1914 later adds a launcher marker, the hook
  also honours it as a second skip, but nothing here depends on it.

- **FR-16 (the cost estimate).** The model comes from the last assistant record's
  `message.model`. A local table, with no network lookup, holds each known model's base
  input price and the tier multipliers from the 2026-09-29 pricing page (Opus 5: $5 base, $10
  one-hour write; Opus 5.5: $4 and $8; Sonnet 5: $2 and $4; five-minute write is 1.25x
  base). The estimate is labelled *estimated list-price equivalent; on a subscription this is
  drawn from plan usage, not billed*. For a model not in the table the warning states tokens
  only and no dollar figure.

- **FR-17 (state location and keys).** All state lives under this repository's git common
  directory (`git rev-parse --git-common-dir`, resolved from the envelope's `cwd`), in one
  subdirectory for this hook. That location survives removal of a linked worktree, is never
  tracked, and is never under `~/.claude`. It holds: the parking store and expired list per
  `session_id`; episode keys; the cached interactive flag; the cron prompts recorded by the
  `Stop` hook; and the observe/warn log, which is size-bounded and rotated. Every path is
  absolute. Nothing is keyed per checkout, and nothing depends on the shell's cwd (the two
  #1914 defects).

- **FR-18 (bounded, fails visibly, never blocks on its own error).** The hook enforces an
  internal time budget (default 5s), well under the harness's 30s timeout, whose own expiry
  is silent. On any internal error, or when the budget runs out, the hook exits 0, blocks
  nothing, defers nothing (a message is delivered), appends the error to the log, and emits
  one visible line (a `systemMessage`) at most once per session per error kind. If
  `python3` is missing, the shell wrapper does the same. `MINSPEC_COLD_RESUME_OFF=1` turns
  the hook into a silent no-op for that session.

- **FR-19 (registration and modes).** The hook is registered in this repository's
  committed `.claude/settings.json` on `UserPromptSubmit` (next to `scope-check.sh` and
  `session-title.sh`), on `Stop` (to record cron prompts), on `SessionEnd` (FR-6 expiry) and
  on `SessionStart` (FR-6 report). Each command path is built from `$CLAUDE_PROJECT_DIR`.
  The `Stop`, `SessionEnd` and `SessionStart` entries never emit a decision: in particular
  the `Stop` entry must never prevent a turn from ending.
  Part A's mode is `off`, `observe` or `enforce` (default `observe`); Part B's is `off`,
  `warn` or `block` (default `warn`). Both mode values are committed in this repository
  (Plan picks the carrier), so every switch is a reviewed commit. Nothing is added to the
  template registry, the generated hook templates or `claude-settings.ts`.

## Acceptance Criteria

All automated criteria run the real hook as a subprocess, piping a synthetic envelope and a
synthetic transcript, in `packages/minspec/tests/cold-resume-hook.test.ts`.

- **AC-1 (FR-13, boundaries).** With a last main-chain assistant record at time T and
  context 200,000: a prompt at T+3601s is cold; at T+3599s it is not. With context 149,999 at
  T+3601s it is not cold. A transcript with no assistant record is not cold.
- **AC-2 (FR-13, dedup, sidechain, turn in flight).** Three copies of one `message.id` give
  the same result as one copy. A later sidechain assistant record does not reset the gap. A
  last main-chain assistant record that is a `tool_use` awaiting its result, over an hour
  old, is not cold.
- **AC-3 (FR-13, tier).** When the most recent cache write is in the five-minute tier, a
  prompt 301s after the last record with context 200,000 is cold.
- **AC-4 (FR-14, prefixes).** One fixture per class yields that class. A human prompt that
  contains `<task-notification>` after other text is presumed human.
- **AC-5 (FR-14, scheduled).** A prompt equal to a cron prompt the `Stop` hook recorded for
  this session is possibly scheduled; the same text in another session is presumed human. A
  prompt equal to an earlier `turnOrigin: "scheduled"` record's text is possibly scheduled.
- **AC-6 (FR-15, INV-4, headless).** In a cold session whose user records all carry
  `turnOrigin: "sdk"`, no mode of either part produces a block, a deferral or a
  `systemMessage`, for any prompt class.
- **AC-7 (FR-1, FR-2, custody).** Part A `enforce`, cold interactive session, peer message
  without the marker: the output is a block, and a parked file already holds the prompt
  text byte-identical to the input.
- **AC-8 (FR-2, custody failure).** Same as AC-7 with an unwritable store: no block, the
  prompt passes, and one visible line reports the failure.
- **AC-9 (FR-2, cap).** With 100 messages already parked, the 101st is delivered, not
  blocked, and nothing is dropped.
- **AC-10 (FR-3).** Same as AC-7 with the body starting `[URGENT]`: no block, nothing
  parked.
- **AC-11 (FR-4, DQ-2).** In `enforce`, a presumed-human prompt and a possibly-scheduled
  prompt are never deferred. A task notification is delivered and logged by class (under the
  DQ-2 recommendation).
- **AC-12 (FR-5, delivery).** After two messages are parked, the next presumed-human prompt
  (Part B in `warn`) receives `additionalContext` containing both bodies in arrival order
  under the header; the store is empty afterwards; the prompt after that receives no
  re-delivery. With Part B in `block`, the blocked prompt receives nothing and the messages
  stay parked until the resend passes.
- **AC-13 (FR-6, expiry).** A `SessionEnd` envelope with one parked message moves it to
  expired; a later `SessionStart` envelope from a different checkout of the same repository
  prints its line and count; the file still exists.
- **AC-14 (FR-7, observe).** In `observe`, a would-defer message passes unchanged and one
  log line records it. The audit mode, fed that log and a transcript with the next
  assistant record, reports the class, the count and that record's cache-creation tokens.
- **AC-15 (FR-8, warn).** Part B `warn`, cold interactive session, presumed-human prompt:
  no block; one `systemMessage` naming idle time, token count, dollar estimate, `/clear`,
  a fresh session, and that `/compact` is not cheaper. A second prompt in the same episode
  gets no warning.
- **AC-16 (FR-9, block).** Part B `block`: the first presumed-human prompt of an episode is
  blocked, with the FR-8 content in the reason and `suppressOriginalPrompt` absent from the
  output; the second passes. A peer
  message, a task notification and a possibly-scheduled prompt in the same cold state are
  never blocked by Part B.
- **AC-17 (FR-10, audit).** Given a fixture log of fires and transcripts with known next
  records, the audit reports determinable fires, true and false positives, misclassified
  machine prompts and precision exactly as defined, and a verdict of "block may turn on"
  only for the fixture that meets every condition. A fixture with 29 determinable fires
  yields "not enough data".
- **AC-18 (FR-16).** A cold resume on `claude-opus-5` with context 330,000 shows about $3.30;
  on an unknown model id it shows the token count and no dollar sign.
- **AC-19 (FR-18, errors).** A truncated JSON line at the tail, a missing transcript file,
  and an exhausted time budget each give exit 0, no block, no deferral, one visible line for
  the first occurrence in a session and none for the second. With
  `MINSPEC_COLD_RESUME_OFF=1` the hook prints nothing.
- **AC-20 (FR-13, FR-18, bounded read).** A transcript larger than 8 MiB whose last record
  is cold completes inside the time budget and returns the same verdict as its tail alone.
- **AC-21 (INV-5, offline).** The hook's module imports match an explicit allowlist that
  contains no network module; adding any import fails the test. (A static check stands in
  for a runtime one because CI cannot drop network access per process.)
- **AC-22 (INV-6, blast radius).** Run with `HOME` pointed at an empty temporary directory,
  the hook leaves it empty and writes only under the fixture repository's git common
  directory. The template registry and the managed-region enumeration pin are unchanged by
  this spec's diff.
- **AC-23 (FR-19).** `.claude/settings.json` registers the hook on the four events with
  `$CLAUDE_PROJECT_DIR`-based paths, and both default modes (`observe`, `warn`) are the
  committed values.
- **AC-24 (probes, manual, before any mode switch).** Before Part A `enforce` or Part B
  `block` is committed, these live probes are run and their results recorded in this spec's
  design at Plan: **P1**, block a cross-session message between two sessions and record what
  the sender sees; **P2**, in a VS Code-hosted session, record whether a block reason and a
  `systemMessage` are visible and whether the blocked text is restored to the input box;
  **P3**, confirm that `/loop` and `CronCreate` fires both appear in the `Stop` hook's
  `session_crons`, and record how a self-paced `ScheduleWakeup` fire arrives. If P3 fails for
  `/loop` or `ScheduleWakeup`, FR-14 falls back to the earlier-record match alone, and Part B
  `block` stays off in any session whose transcript tail shows that tool or command in use.

## Invariants

- **INV-1 (no machine-injected prompt is ever discarded).** Deferral with custody (FR-1,
  FR-2) is the only way this spec holds a machine-injected prompt, and it is not a block in
  #1922's sense: the text is stored first and delivered later. Part B never blocks a
  machine-injected or possibly-scheduled prompt, preserving #1922's rule *"never block a
  machine-injected prompt"* exactly.
- **INV-2 (at-least-once delivery; a lost message is worse than a paid rewrite).** A parked
  message is delivered at the next turn that runs, or expires visibly (FR-6). Whenever the
  hook is unsure, it delivers now. The accepted failure mode is a duplicate (a crash between
  custody and block delivers the message and also keeps the parked copy), never a loss.
- **INV-3 (the urgent path is explicit).** A message carrying the marker is never deferred,
  and the hook never guesses urgency.
- **INV-4 (headless runs are untouched).** No block, deferral or warning in a session not
  proven interactive. A block in `-p` mode would replace the run's result, which dispatch
  scripts parse.
- **INV-5 (offline, constitution invariant 1).** The hook reads only the local transcript,
  its local state and its local price table. It makes no network call, and nothing it logs
  leaves the machine.
- **INV-6 (blast radius, constitution invariant 3).** Parts A, B and C are all dev-time
  only, for this repository. The hook is registered only in this repository's committed
  `.claude/settings.json`, is absent from the template registry, writes nothing under
  `~/.claude`, and writes nothing outside this repository's git common directory. Shipping
  it to adopter repositories is a separate spec that would need a `.minspec/`-presence gate
  and a persistent per-project opt-out, because under DR-073's 2026-08-05 correction
  deleting a shipped hook is undone by the next Refresh.
- **INV-7 (no silent gate, constitution invariant 2).** The guard is advisory. It is not a
  merge gate or a required check, so failing open on its own error is correct. But it never
  fails silently (FR-18), and it never blocks or defers because of its own error. The one
  residual silent path, the harness's own 30s timeout, is kept out of reach by FR-18's
  internal budget.
- **INV-8 (never a wrong number).** Every cost shown is labelled as an estimate; an unknown
  model gets no dollar figure. Every figure in this spec carries its definition, date and
  source.
- **INV-9 (the SPEC-027 mailbox stays pull-only).** The SPEC-027 mailbox must never gain a
  transport that starts a turn in an idle session. If it needs urgency, that is a new
  message field mirroring FR-3 (adding fields is allowed by its own costly-to-refactor
  note). Recording this inside SPEC-027 is a follow-up.

## Out of scope (non-goals), each with its measured reason

- **Clearing the context every turn.** The 2026-09-28 comment designs against it because
  per-turn clearing makes cost worse: it forces a full rebuild every turn, about 38,000
  boot tokens (M11) written at 2x, where a warm turn reads them at 0.1x.
- **Trimming the boot payload.** Cold start is about 0.7% of raw tokens and about 2.7% of
  weighted cost per headless dispatch (medians, 2026-09-28, weighted figure corrected
  2026-09-29), and about 5% of interactive cache-creation tokens. Rewrites dominate (M3).
- **Dropping the one-hour cache lifetime.** The one-hour tier costs about a 10.9% premium
  and saves about twice that (2026-09-11, #1922). No longer lifetime exists, so the boundary
  cannot move outward either.
- **Cutting the number of sessions.** 239 of 242 zero-tool sessions are automated triage, at
  1.24% of spend (2026-09-11). Lifetime is the lever, not count.
- **Binding senders outside this repository.** The chief-of-staff skill, `cos.py` and the
  queue-proxy skill live in the operator's configuration. Constitution invariant 3 forbids
  this spec from changing them; their change is a follow-up.
- **Shipping to adopter repositories** (INV-6, DQ-7).
- **A status-line warning.** The status line never runs in VS Code panel sessions (PR
  #1670), which is where this fleet runs.
- **Rewrites that expiry does not explain.** About 10.8% of rewrite tokens on the sample
  followed a gap of an hour or less (M13), cause unknown. The gap trigger cannot catch them;
  diagnosing them is a follow-up.
- **Changing the harness,** including asking for a native "skip this wake if the cache is
  cold" option.

## Decisions needed (Clarify)

### DQ-1 - the founder's "wake everything" rule vs Part A

The chief-of-staff skill's founder rule (2026-09-25) says an idle session is a defect to be
woken. Part A holds non-urgent peer messages and notices to a cold session until its next
running turn. Both cannot hold at once for cold sessions.

- **Option A (rec).** Adopt Part A for non-urgent peer messages and cross-session notices,
  observe first (FR-7), and file the chief-of-staff change (cache-aware cadence, and
  `[urgent]` on relayed founder instructions). *Cost:* until the chief-of-staff adopts the
  marker, a founder instruction it relays to a cold session waits for that session's next
  running turn; an idle notice to a cold chief-of-staff waits for its next loop tick (within
  60 minutes on the current ladder, while the loop is running).
- **Option B.** Always deliver peer messages; defer only harness notices. *Cost:* forgoes
  the largest measured class (cross-session messages, 63.8M of about 112M automated
  cold-rewrite tokens in M9, older cron fires included).
- **Option C.** Observe only, never enforce. *Cost:* saves nothing; the measurement just
  confirms the size.

### DQ-2 - task notifications: defer or deliver?

A task notification means a background task the session itself launched has finished.
Under autonomy `act` (DR-086), continuing on it is often the point.

- **Option A (rec).** Deliver task notifications, log them by class in observe mode, and
  revisit with data. *Cost:* forgoes that class's saving for now (51 events and 21.2M tokens
  in M9; the largest automated class, 46 of 88, in the 2026-09-29 sample).
- **Option B.** Defer them like peer messages. *Cost:* stalls self-completing sessions
  (SPEC-044's auto-wrapup) until the human returns.

### DQ-3 - the warning's carrier in VS Code

Whether VS Code shows a `systemMessage` is unknown until probe P2.

- **Option A (rec).** Use `systemMessage`; if P2 shows it is invisible in VS Code, fall back
  to `additionalContext` asking the model to state the cost in one line. *Cost:* the
  fallback relies on the model relaying it (constitution principle 8, enforce rather than
  trust) and adds about 100 tokens per fire; fires are a few per day.
- **Option B.** Always use `additionalContext`. *Cost:* the same model reliance even where a
  direct surface works.

### DQ-4 - the context threshold

- **Option A (rec).** 150,000. *Cost:* catches 85.9% of rewrite tokens on the sample
  against 89.0% at 100,000 (M12), so about 3 points of coverage are left in exchange for
  fewer interruptions.
- **Option B.** 100,000. *Cost:* more fires, each saving less, which raises the nag rate
  (constitution principle 4, avoid nagging).

### DQ-5 - the epic

- **Option A (rec).** EPIC-009 (Team Readiness), next to SPEC-026, SPEC-027 and SPEC-044.
  *Cost:* Part B is single-session economics and fits EPIC-009's "more than one actor" test
  loosely.
- **Option B.** EPIC-007 (Agent Execute, the dev-time pipeline). *Cost:* separates Part A
  from the SPEC-027 mailbox it constrains (INV-9).

### DQ-6 - is a decision record needed?

The parent design pass (#1923) asks whether Parts A and B need a DR-086 amendment.

- **Option A (rec).** No decision record. Every mode switch is a one-line reviewed commit,
  undoable in minutes, and Part A changes when a session hears from peers, not what an
  autonomous session may do, so DR-086's stop list is untouched. *Cost:* the delivery policy
  lives in a spec and a committed mode value, so a reader of DR-086 will not find it (the
  `relates_to` link is the only pointer).
- **Option B.** Write a DR now. *Cost:* register weight and a founder read for a dev-time
  hook that is reversible the same day.

### DQ-7 - the operator's other repositories

The hook covers sessions in this repository only (M6: the MinSpecPro project's sessions
carried 85.5% of measured cache-creation tokens). voip-sms-inbox (9.4%) and memory-fabric
(3.8%) are not covered.

- **Option A (rec).** Stay dev-time here; ship later as its own spec if the audits show the
  saving. *Cost:* about 14% of measured cache-creation tokens stay uncovered meanwhile.
- **Option B.** The operator installs the hook in their own global configuration by hand.
  *Cost:* outside MinSpec, so MinSpec cannot own or test it, and invariant 3 forbids MinSpec
  doing it for them.

### DQ-8 - a warm-session recycling nudge

- **Option A (rec).** Do not build one now. FR-12's rule depends on `N`, the next task's
  call count, which the hook cannot know. *Cost:* warm sessions keep carrying context past
  the break-even with nothing to prompt a recycle.
- **Option B.** Nudge at an assumed `N`. *Cost:* a guessed input produces a confident
  number, and a nudge on every long warm session runs against principle 4 (avoid nagging).

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | A harness update changes a prompt prefix or a transcript label, so a machine prompt reads as presumed human | Classification is fixture-pinned (AC-4, AC-5); the audit keeps reporting misclassified machine prompts; any non-zero count reverts Part B to `warn` |
| R2 | On the five-minute tier (usage credits), every pause over 5 minutes is cold, so fires become frequent | Once per episode (FR-8); the audit reports fires by tier |
| R3 | A founder instruction relayed by the chief-of-staff to a cold session waits | DQ-1; observe first; the urgent marker; the follow-up to the chief-of-staff |
| R4 | A sender that expects a reply gets none while its message is parked, and may not learn why (P1 unknown) | P1 before `enforce`; the block reason is recorded in the recipient's transcript |
| R5 | A long session whose human records have left the 8 MiB tail is never proven interactive | The flag is cached once seen (FR-15); a miss is the safe direction (the rewrite is paid) |
| R6 | The estimate is a list-price equivalent, while a subscription draws plan usage whose weighting of cache writes is not published | Labelled estimated (FR-16, INV-8) |
| R7 | The chief-of-staff session runs in this repository, so Part B could fire on its scheduled ticks | FR-14's possibly-scheduled class and P3; Part B never blocks that class |

## Test

New test file owned by this spec: `packages/minspec/tests/cold-resume-hook.test.ts`, run by
CI's `npx vitest run`. It executes the real `scripts/hooks/cold-resume.sh` as a subprocess
(the test-by-execution convention of `session-identity.test.ts` and `spec-gate.test.ts`), never
greps the hook's source except for AC-21's import allowlist. Transcripts and envelopes are
synthetic: they copy the key shapes of real records, never real content. The probes in
AC-24 are manual and recorded at Plan.

## Follow-ups (to file)

Listed for the caller to file. None was filed by this dispatch.

1. **Chief-of-staff cadence and wake policy** (AIClarityAU/minspec, for tracking; the change
   lands in the operator's own configuration, not in this repository). Before messaging a
   peer, read the recipient transcript's last assistant timestamp and hold or mark
   `[urgent]` when it is cold; prefix relayed founder instructions with `[urgent]`; check
   whether the 60-minute rung straddles the one-hour cache lifetime (inferred, not
   measured); reconcile the "wake everything" rule with the DQ-1 outcome. Relates to
   SPEC-044 Amendment A's open question on where the central driver lives.
2. **Record INV-9 in SPEC-027** (the inter-session mailbox): no wake transport, and an
   optional urgency field that mirrors FR-3.
3. **Re-measure the automated-wake share** on the full corpus with `origin.kind` and
   `origin.from`, resolving the M8 conflict (23-26% vs 57%), with a stated rule on whether a
   relayed founder instruction counts as automated.
4. **Diagnose the short-gap rewrites** (M13: 10.8% of rewrite tokens after a gap of an hour
   or less).
5. **Ship the guard to adopter repositories as its own spec,** only if DQ-7 chooses it:
   template registry, generated hook templates, validator Rule 12 (generated-template
   staleness), the enumeration pin,
   generalising `claude-settings.ts` beyond one hook, a `.minspec/` gate, and a persistent
   opt-out.
6. **A comment on #1914** noting that this spec treats its launcher marker as a second skip
   only, not a dependency.

## Traceability

- **Triggered by:** #1922 (the cold-resume guard issue; triaged T3 (full spec cycle),
  specify phase only).
- **Parent design pass:** #1923 (session stop conditions), which lists #1922 as a slice and
  asks the DR-086 question answered in DQ-6.
- **Related specs:** SPEC-026 (session presence, not reused), SPEC-027 (inter-session
  mailbox, conforms, INV-9), SPEC-044 (coordinated self-completing sessions; its Amendment A
  central driver).
- **Decisions:** DR-073 (the shipped-hook write contract; only relevant if shipped),
  DR-086 (autonomy as a second axis), DR-057 (owns `.minspec/queue/`).
- **Constitution:** invariant 1 (INV-5), invariant 2 (INV-7), invariant 3 (INV-6);
  principles 4 (avoid nagging) and 8 (enforce, do not trust the model).
- **Prior art:** `.claude/hooks/session-title.py` (bounded tail read, fail open);
  `scripts/hooks/scope-check.sh` and #1914 (the defects FR-17 avoids).
