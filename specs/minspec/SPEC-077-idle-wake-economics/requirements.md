---
id: SPEC-077
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination. Part A governs delivery between sessions, next to the presence, mailbox and coordinated-session specs; DQ-5 states the cost of this fit
aspects: [session-economics, prompt-cache, hooks, inter-session-comms, cadence, dev-time, offline, blast-radius, no-silent-gate]
relates_to: [SPEC-026, SPEC-027, SPEC-044, DR-073, DR-086, DR-057]  # presence heartbeat (not reused) · pull-only session mailbox (conforms; its constraint is Follow-up 2, not an invariant here) · coordinated sessions and their proposed central driver · shipped-hook write contract (only if ever shipped) · autonomy axis (DQ-2, DQ-6) · .minspec/queue/ is already taken. Issue refs (#1922 trigger, #1923 parent design pass, #1914 headless marker) are in Context and Traceability.
implements: [scripts/hooks/cold-resume.sh, scripts/hooks/cold-resume.py, packages/minspec/tests/cold-resume-hook.test.ts]  # all NEW, all dev-time only and never shipped (INV-6). The .py split mirrors .claude/hooks/session-title.{sh,py}; if Plan picks another language, rename here BEFORE approval, since these paths are hashed
affects: [.claude/settings.json]  # owned by no spec today; this spec only adds hook registrations to it
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# MinSpec - Stop automated wakes of idle sessions, and warn before a cold resume (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, hook or test is created by the
> dispatch that produced it. A human reads it, resolves its Clarify questions, and approves
> it through the normal spec-approval gate before anything is built. Each question carries
> an agent-recorded selection under
> **[Clarify selections](#clarify-selections-recorded-by-an-agent-2026-10-02-ratified-only-by-approval-of-this-spec)**;
> the human resolves them by approving this spec with those in place, or by changing them
> first.

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
without ever deleting an undelivered message and without ever acting on a fresh headless run.

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
once and sends the full context (Claude Code docs, cross-session messaging, costs and goal
pages). The measured median from arrival to first response is about 15 to 20 seconds (the
same 2026-09-29 research as M9 below).

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
| M4 | 75.6% of cache-write dollars vs 26.7% of total spend | On the 61-file sample: rewrites were 75.2% of cache-creation tokens and 75.6% of cache-write dollars, but only 26.7% of total list-price spend (75.6% x 35.3%), because cache writes were 35.3% of spend | 2026-09-29 re-derivation | Sample |
| M5 | 5.1% carry 86.6% | Events over 30k tokens are 5.1% of cache-creation events and carry 86.6% of **cache-creation tokens** (the comment says "of spend"; the underlying table measures tokens) | 2026-09-28 | Shape reproduced on the sample (3.3% carry 80.2%) |
| M6 | 81.3%; 85.5%; 9.4%; 3.8% | Shares of interactive cache-creation tokens: the top 15 session files; the MinSpecPro project; voip-sms-inbox; memory-fabric | 2026-09-28 | Not re-derived |
| M7 | 330k tokens, about $3.30 | Median rewrite window, priced at the Opus 5 one-hour write rate (estimated; about $2.64 on Opus 5.5) | 2026-09-11 (#1922 says ~$3.33); the 2026-09-28 median rewrite event is 301,619 tokens | Estimate |
| M8 | 23-26% (87-98 of 383) | Share of idle rewrites woken by an automated message | 2026-09-11 only | Conflicts with a 2026-09-29 sample: 57% of 154 idle rewrites automated, or 36% if cross-session socket deliveries (some of which relay the founder's own instructions) are excluded. One sample; re-measuring is #2208 |
| M9 | see right | Cold wakes (gap over 3600s since the last main-chain response; rewrite = cache creation over 50% of input and over 20k) over 577 main-session transcripts: cross-session message 199 events / 63.8M tokens (median 302,677); task notification 51 / 21.2M (median 400,008); scheduled fire (2.1.278+) 49 / 16.3M; older cron 37 / 11.1M; human 449 / 149.2M. Since 2026-09-15: automated 156 events / 48.8M, human 105 / 32.6M | 2026-09-29 harness research | Measured, scratch analysis |
| M10 | 0 of 2,408 | Headless-dispatch cache-creation events that were expiry rewrites | 2026-09-28 | Not re-run |
| M11 | median 37,952 | First-turn context (the boot prelude) across 475 top-level interactive files; the headless boot median is 38,734. The "~70k prelude" in #1922 is roughly the 75th percentile of VS Code sessions, not the median | 2026-09-29 | Measured |
| M12 | 85.9% | On the sample, the trigger "gap over 1h AND previous context at least 150k" catches 138 of 175 full-prefix rewrites, carrying 85.9% of rewrite tokens (89.0% at 100k, 83.0% at 200k) | 2026-09-29 | Sample |
| M13 | 89.2% / 10.8% | Share of rewrite tokens that followed a gap over 1h vs a gap of 1h or less. Cause of the short-gap ones unknown; on the sample they were all on claude-opus-5, so model switches are unlikely (inferred, not checked) | 2026-09-29 | Sample |

**M2 and M3 are different quantities and must never be read as one.** M2 is a share of
total spend in dollars; M3 is a share of cache-creation tokens. Multiplying M3's 64.1% (the
486-file corpus, 2026-09-28) by the sample's 35.3% cache-write share of spend (M4, a
different 61-file sample, 2026-09-29) gives about 23% of total spend. That is an estimate
that mixes two bases, and it lands in the same order as M2 (whose 16.3% floor, adjusted for
its detector's recall of about 65%, is about 25%, also an estimate). When this spec needs
one "share of spend" number it says *roughly a quarter of total spend (estimated)* and cites
both methods.

Where the evidence lives: the 2026-09-11 analysis's source was not found; the 2026-09-28
tables are in a machine-local file outside every repository; the 2026-09-29 and 2026-09-30
re-derivations were scratch analyses, not committed. The figures are therefore quoted here
rather than linked, for the reason this repo's CLAUDE.md gives when citing #2056 (an in-repo
home for the merge-funnel rule): a link to a machine-local file resolves to nothing for
every reader but the operator.

### Why the ranking inverts

The issue ranked the human-facing warning first. The 2026-09-28 comment reversed it:
*"warning a human is the smaller half; stopping automated wakes of idle sessions is the
larger half"*, because *"cost is driven by polling cadence, not work done: a session woken
every ~90 min is near worst case and looks idle while expensive."* M9 agrees for the period
since 2026-09-15: automated cold wakes (48.8M tokens) outweigh human ones (32.6M). This spec
orders its parts that way: Part A (automated wakes), then Part B (the human warning), then
Part C (recycling guidance).

### What the harness provides (Claude Code 2.1.283, researched 2026-09-29 and 2026-09-30)

Each item is verified (docs, a live probe, or a transcript count) unless it says inferred.

- The `UserPromptSubmit` hook fires on every prompt source tested: typed prompts, `-p`
  prompts, cross-session messages, background task notifications, `/loop` and `CronCreate`
  fires, and cross-session idle notices. It also fires when a message queued mid-turn is
  consumed, from about 2.1.260 (inferred from a version cross-tab of transcripts; the
  changelog does not mention it).
- Its stdin envelope carries `cwd`, `hook_event_name`, `permission_mode`, `prompt`,
  `prompt_id`, `session_id` and `transcript_path` (`scratchpad_dir` optionally). There is no
  field for the prompt's origin and none marking a headless run. `cwd` follows the model's
  `cd` and worktree changes, while `$CLAUDE_PROJECT_DIR` stays at the root where the session
  started (hooks docs).
- How the prompt text identifies machine prompts at the hook:
  - Verified in a log of the hook's own `prompt` field: a peer message begins
    `<cross-session-message` and a task notification begins `<task-notification>`. The
    transcript stores the peer message differently, as `Another Claude session sent a
    message:` followed by the tag.
  - The harness's cross-session notices begin `[Cross-session ` in transcript content, where
    they carry `turnOrigin: "system"`. That the hook's `prompt` begins the same way is
    inferred; probe P1 confirms it.
  - The harness's interrupted-turn continuation is the text `Continue from where you left
    off.`, the default of `CLAUDE_CODE_RESUME_PROMPT` (env-vars docs). Its transcript record
    is `isMeta: true` with no `turnOrigin` and no `origin`, even on 2.1.278 (118 such user
    records across `~/.claude/projects`, 20 of them on 2.1.278, counted 2026-09-30).
  - A scheduled fire of a slash command is the bare command text at the hook, for example
    `/chief-of-staff`, identical to what a human types. Its later transcript record is
    different: `<command-message>chief-of-staff</command-message>` then
    `<command-name>/chief-of-staff</command-name>`, with `turnOrigin: "scheduled"` (all 190
    such records in the corpus, 2026-09-30). A compaction summary can also carry
    `turnOrigin: "scheduled"`.
  - A goal idle check-in's prompt text has never been observed.
- The current prompt's own user record is not yet on disk when the hook runs; its
  `queue-operation` enqueue record may be. Records from earlier turns are on disk.
- After an assistant record ends a turn, the transcript routinely carries further main-chain
  records that are not messages: a `system` `stop_hook_summary` (after 85 of 126 turn ends
  in one sampled transcript), hook attachments, `queue-operation` enqueue and dequeue,
  `custom-title` and `agent-name`. In a 2026-09-30 review tally over the 15 largest
  MinSpecPro transcripts, the last main-chain record before a prompt arriving over an hour
  after the last assistant record was itself an assistant record in only 125 of 619 cases.
- The harness also writes synthetic assistant records (model `<synthetic>`, every usage
  field zero, stop reason `stop_sequence`), such as "No response requested." and usage-limit
  or authentication notices. All 495 `stop_sequence` records in those 15 transcripts were
  synthetic (2026-09-30). They make no API request.
- Blocking (exit 2, or `decision: "block"`) erases the prompt and stops the model request.
  Verified for a task notification in `-p` mode only: no assistant record, no cache write,
  no user record, and the last assistant `message.id` unchanged; the harness records the
  block as a `system` record ("UserPromptSubmit operation blocked by hook") whose content
  repeats the blocked prompt after `Original prompt:` and which carries no `turnOrigin`,
  `origin` or `promptId`. In `-p` mode the block text replaces the run's final result.
  Exit 1 does not block.
- The default `UserPromptSubmit` timeout is 30s. A hook that reaches it is cancelled and its
  output, including any block decision or `additionalContext`, is discarded; the prompt
  proceeds, and the transcript shows a notice naming the hook and the timeout (hooks docs).
- `additionalContext` (or plain stdout) is injected for the model, capped at 10,000 characters
  per field (overflow is saved to a file and replaced by a 2,000-character preview).
  `systemMessage` is shown to the user. A hook cannot rewrite the prompt and cannot trigger
  `/clear` or `/compact`. The transcript records each injection as a main-chain
  `hook_additional_context` attachment carrying the injected text (observed; the record
  format is undocumented).
- A `Stop` hook receives `session_crons`, sourced from `CronCreate`, `ScheduleWakeup` and
  `/loop`, each with its prompt capped at 1,000 characters behind a `… [+N chars]` marker.
- `SessionEnd` runs with reason `clear`, `resume`, `logout`, `prompt_input_exit` or `other`.
  A process killed outright (for example `SIGKILL` or an out-of-memory kill) cannot run it
  (inferred). Its hooks share a 1.5s default budget that only a per-hook `timeout` raises,
  and their `systemMessage` is discarded. `/clear` starts a new session and the old
  conversation stays resumable (hooks and sessions docs); that the new session gets a new
  `session_id` is inferred from this, and probe P4 confirms it.
- Earlier user records in the transcript carry `turnOrigin` (`human`, `peer`,
  `task_notification`, `scheduled`, `system`, `sdk`) from 2.1.278. A typed prompt is
  `origin.kind: "human"`; a headless `-p` prompt is `turnOrigin: "sdk"` with no `origin`.
- There is no native headless marker: a `-p` run and the fleet's VS Code-hosted sessions
  both show entrypoint `sdk-cli` and registry kind `interactive`. `claude -p --resume
  <session-id>` sends a headless prompt into an existing session (sessions docs), so an
  interactive session's transcript can host a headless run. No launcher in this repository
  or in the chief-of-staff helper uses `--resume` today (grep, 2026-09-30).
- The native messaging tools expose no idle time: `ListAgents` shows idle or busy and start
  time only, and `SendMessage` has no urgent, defer or deliver-if-warm option. A sender on
  the same machine can still estimate it, by reading the recipient transcript's last
  assistant timestamp or the undocumented `~/.claude/sessions/<pid>.json` registry (whose
  status timestamp's meaning is inferred), or from
  a `notify_when_idle` notice's "finished a turn at HH:MM" (local time, no date), which
  itself wakes an idle asker.
- The native receiver-side hold (`crossSessionInbound: "hold"`) starts no turn, but it
  releases held messages only when an `accept` setting later applies, not on the next human
  prompt, and it is scoped to a settings file rather than a session. It cannot implement
  "deliver at this session's next turn".
- The status line receives rich cache fields, but the status-line probe in PR #1670 measured
  that it never runs in VS Code panel sessions. VS Code has its own prompt-cache clock.
- `/clear` costs nothing. `/compact` on a cold cache reprocesses the whole history uncached,
  its most expensive case.

**Not known (never probed):** what a block of a cross-session message or a cross-session
notice does on the sender's side, and whether the recipient's harness re-delivers it (only a
task-notification block was tested); how VS Code displays a block reason or a
`systemMessage`, whether the blocked prompt text is restored to the input box, and whether
the episode key stays stable across a human-prompt block there; how self-paced
`ScheduleWakeup` fires and goal idle check-ins arrive at the hook; whether a VS Code `/clear`
fires `SessionEnd`, and what key links the old session to its replacement. Every requirement
below that depends on one of these is gated on a named probe (AC-27).

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
  subscriptions, and run a loop whose cadence ladder is 15, 30 and 60 minutes. The founder's
  instruction of 2026-09-25, quoted verbatim in that skill, reads *"make sure cos skill
  includes waking up all sessions that cos didn't intentionally pause"*; the skill glosses it
  as *"The default is awake... Anything else idle is a defect the supervisor owns, and the
  remedy is to wake it."* The queue-proxy skill also messages the chief-of-staff session.
  That session itself runs in this repository's primary checkout, so this repository's hooks
  run inside it.

This spec cannot bind the out-of-repo senders (constitution invariant 3, blast radius). It
names them, conflicts with the founder's instruction openly (DQ-1), and carries their change
as a follow-up (#2211, the chief-of-staff wake policy), not a requirement.

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
  adopter repo. `scripts/hooks/session-end.sh` is already registered on `SessionEnd`.
- `.minspec/queue/` is already DR-057's phase-advance request queue, so it is not reused.
- No code in this repository parses cache usage or tracks conversational idle time. The
  cost estimator and the gap detector are new.

### Related specs and issues, and what this spec does not reuse

- **SPEC-026 (session presence).** Its liveness is an extension-host heartbeat (30s beat,
  120s stale). A session idle for an hour still heartbeats, and its session id is the
  extension's own id, not Claude Code's `session_id`. Its liveness predicate is not reused;
  this spec defines idleness as time since the last real assistant response (FR-13).
- **SPEC-027 (inter-session mailbox).** Specified, not built. Its recipient checks the inbox
  once at turn start with *"no new timer, no continuous polling"* (its FR-3), so by
  construction it cannot wake an idle session, and it already conforms to Part A. Keeping it
  that way is a constraint for SPEC-027 to adopt (Follow-up 2, #2209), not an invariant of
  this spec, because nothing this spec builds can enforce it.
- **SPEC-044 (coordinated self-completing sessions).** Its PR shepherd never messages or
  wakes another session: it polls in shell, and its fixes run as fresh headless `claude -p`
  runs (`scripts/dispatch-issue.sh`, the `do-fix` step). Its proposed Amendment A adds a
  single central merge-ordering driver (FR-4b there); in practice the chief-of-staff loop
  plays that role and is the high-cadence waker. Amendment A's own first open question
  ("Where does the driver live?") is the natural home for a cache-aware cadence.
- **DR-086 (autonomy as a second axis).** This repository runs with autonomy `act`, so a
  session may continue on its own after a background task finishes. That shapes DQ-2.
- **#1923 (the session stop-conditions design pass).** Lists #1922 as a slice. Its own open
  question, whether its Parts 1 and 2 (the done-condition, and routing mid-flight
  discoveries through DR-086's stop classes) warrant a DR, concerns that work, not this
  spec; it stays open on #1923. DQ-6 asks this spec's own, analogous question.
- **#1914 (headless marker).** Open and quarantined. Its launcher marker,
  `MINSPEC_HEADLESS_AGENT=1` exported from `scripts/lib/agent-context.sh`, exists only on an
  unpushed local branch (`agent/issue-1914`, commit ff5f6031) with no PR. This spec does not
  need it to skip fresh headless runs (FR-15), but it is the only way to close the
  `claude -p --resume` gap (INV-4), so Part A `enforce` and Part B `block` wait on it or on a
  recorded absence of such launchers (FR-7, FR-10).

## Functional Requirements

Ordered by the inverted ranking. Part A and Part B both use the shared mechanics in FR-13
to FR-20, which are stated once at the end.

### Part A - stop automated messages waking a cold session (the larger half)

- **FR-1 (defer a non-urgent automated wake of a cold session).** When Part A is in
  `enforce` mode and a prompt classified as a peer message or a cross-session notice (FR-14)
  arrives in a session that is proven interactive (FR-15) and cold (FR-13), and the message
  does not carry the urgent marker (FR-3), the hook takes custody of it (FR-2) and then
  blocks it, so no model turn starts and no cache is rewritten (verified for a
  task-notification block only; probe P1 confirms it for these two classes before `enforce`,
  FR-7). The block reason names the class, the sender's name when the prompt carries one,
  the idle time, and states that the message will be delivered with the session's next turn
  that runs. A second automated message in the same cold episode is deferred the same way:
  the harness's own record of the first block is not a message record, so it does not warm
  the session (FR-13). Task notifications follow DQ-2 (recommended: delivered, and logged by
  class).

- **FR-2 (custody before block, at-least-once).** Before the hook emits any block for a
  deferred message it MUST have durably written the full prompt text, byte-identical, with
  its class, arrival time, `prompt_id`, `session_id`, `transcript_path` and sender name, to
  the parking store (FR-17), using a temporary file and an atomic rename. If any part of that
  write fails, the hook MUST NOT block: the prompt is delivered unchanged (the rewrite is
  paid) and the failure is logged and surfaced per FR-18. Because custody precedes the block,
  a block the harness later discards (its 30s timeout) leaves a delivered prompt and a parked
  copy: a duplicate, never a loss. A session holds at most 100 parked messages (the native
  hold's own cap); any message beyond the cap is delivered, never dropped.

- **FR-3 (the urgent marker).** Because `SendMessage` has no urgency flag, urgency is a text
  convention: a peer message whose body's first non-whitespace token is `[urgent]`
  (case-insensitive) is delivered at once, whatever the cache state. The marker is the only
  per-message way out of deferral. The hook never infers urgency from wording, so `URGENT:`
  without brackets, or `[urgent]` anywhere but the start of the body, is not the marker.

- **FR-4 (defer only what Part A names).** Part A defers only peer messages and cross-session
  notices (FR-14 classes 1 and 2), plus task notifications if DQ-2 chooses that. A harness
  continuation, a possibly-scheduled prompt and a presumed-human prompt are never deferred.

- **FR-5 (delivery at the next turn that runs, confirmed before release).** On the next
  prompt in the same session that the hook lets through to a model turn (a human prompt, an
  urgent message, a task notification, a scheduled fire, or any prompt once the session is
  warm), the hook injects every parked message for that session as `additionalContext`, in
  arrival order, under a header that states how many were deferred, when each arrived, that
  they were held because the cache was cold, and a delivery id. The header comes first, so it
  survives the harness's 2,000-character preview if the field ever overflows. Delivery does
  not require the session to be proven interactive (FR-15): only a proven-interactive session
  ever parks, so a store holds only messages addressed to its own session, or, after FR-6
  carry-over, to the session it replaced. The injection is
  kept under the 10,000-character field cap: a body that would push it past the cap is
  truncated in the injection, which then names the absolute path of that message's file.
  - Writing the output is not proof of delivery: the harness discards it on its 30s timeout,
    and a sibling `UserPromptSubmit` hook (the enabled security-guidance plugin registers
    one) may block the same prompt. So delivered messages move from the parking store to a
    delivered state rather than being deleted.
  - A delivery is confirmed when the transcript it was injected into holds a main-chain
    `hook_additional_context` attachment carrying its delivery id, followed by a real
    (FR-13) main-chain assistant record with no other prompt's user record between them. A
    synthetic record does not confirm it, because it makes no model request. A later hook
    run in that session applies this test, and so does the FR-6 sweep from any
    proven-interactive session, reading the transcript path stored with the delivery,
    because a session's last delivery has no later run of its own to confirm it. Until
    confirmed, the messages are injected again at the next turn that runs in their session;
    a duplicate is the accepted failure (INV-2). The attachment format is observed, not
    documented; Plan pins it by a fixture copied from a real record.
  - Once confirmed, a message delivered in full has its file removed. A message whose body
    was truncated keeps its file, which only a human deletes, because the model was pointed
    at it.
  - While Part B blocks a prompt (FR-9), parked messages stay parked until a prompt passes.

- **FR-6 (no stranded message).** A message is **unconfirmed** from its arrival until FR-5
  confirms its delivery, whether it is still parked or has been injected and moved to the
  delivered state. The hook never deletes an unconfirmed message, and it does not rely on
  `SessionEnd`, which cannot run when a process is killed outright and whose output is
  discarded. A session's last delivery has no later run of its own to confirm it, and a
  delivery whose output the harness discarded is never confirmed, so both states are
  covered. Two paths keep an unconfirmed message in view:
  1. **Report until a human turn has seen it.** At each presumed-human prompt (FR-14) that
     the hook lets through to a model turn in a proven-interactive session (FR-15):
     - The hook first applies FR-5's confirmation test to each delivered message, in any
       session's store, that is still unconfirmed 24 hours after its arrival (Plan may
       change the default), reading the transcript stored with it. A message that passes is
       released as FR-5 releases it. Plan bounds how many transcripts one run reads, so the
       sweep stays inside the FR-18 budget; a delivered message left unswept is neither
       released nor reported in that run, and waits for a later one.
     - It then reports every message, in any session's store, that is still unconfirmed 24
       hours after its arrival and is not covered by a report that is confirmed or less than
       an hour old (Plan may change the default): one line each (class, sender, arrival
       time, state, which is parked, or delivered but unconfirmed with the time of its last
       injection, owning `session_id`, file path) and a count, as a `systemMessage` and as
       `additionalContext` headed by a report id.
     - A report is confirmed by FR-5's test applied to its report id, and only when the user
       record of the prompt that carried it (matched by `prompt_id` as FR-10 matches a
       fire's own record) carries `turnOrigin: "human"` or `origin.kind: "human"`. An
       unconfirmed report is repeated once it is an hour old; a message covered by a
       confirmed report is not reported again.
     - The message stays where it is: a parked message is still delivered, and a delivered
       one still re-injected, if its own session runs another turn.
     - The report never goes to a session not proven interactive, so a fresh headless run
       neither sees nor consumes it. A `claude -p --resume` run of a proven session (the
       FR-15 known gap) can see it but never confirms it, because that turn's own user
       record carries no human origin (a `-p` prompt's is `turnOrigin: "sdk"`), so the
       report is repeated to a human turn.
  2. **Carry over a `/clear`.** `/clear` starts a new session (with a new `session_id`,
     inferred; P4 confirms), and the FR-8 warning recommends `/clear`, so parked messages
     would otherwise strand under the old id. On `SessionEnd` with reason `clear`, the hook records the old `session_id` with a
     key that links it to the session replacing it in the same Claude Code process. At that
     new session's first `UserPromptSubmit`, the hook moves the old session's parked messages
     into the new session's store, and FR-5 delivers them. Plan picks the key and probe P4
     confirms it. If no reliable key exists, carry-over is not built, AC-15 is removed by
     amendment, and path 1 reports the messages instead.

- **FR-7 (observe first; the would-defer audit decides enforcement).** Part A starts in
  `observe` mode: it logs each would-defer event (class, sender, arrival time, idle seconds,
  context size, and the first 300 characters of the body) and delivers the prompt
  unchanged. Task notifications are logged the same way even though DQ-2 recommends
  delivering them. An `audit` mode of the hook reads the log and the transcripts and reports,
  per class, the event count and the cache-creation tokens that the next assistant record
  actually wrote, which is the saving `enforce` would have produced. It applies the
  completeness rules of FR-20. After `enforce` is on, the audit also reports, per deferred
  message, whether any main-chain assistant record appeared between its deferral and its
  delivery; there should be none, and each one found is listed as a failed deferral with its
  cache-creation tokens.
  Part A moves to `enforce` only by a reviewed commit (FR-19), and only when all of these
  hold:
  1. probe P1 (a blocked cross-session message and notice, on both the sender's and the
     recipient's side) and probe P2 (how VS Code shows a block reason) have been run and
     their results recorded;
  2. DQ-1 is decided;
  3. the founder has reviewed a would-defer audit whose verdict is complete (FR-20) over at
     least 7 consecutive days, and every would-defer message marked "needed before I
     returned" either carried the urgent marker or came from a sender that has since
     adopted it;
  4. the `claude -p --resume` gap (FR-15) is closed on FR-10's terms, because a deferral is
     a block, and a block in `-p` mode replaces the run's result (INV-4).

### Part B - warn the human before a cold resume (the smaller half)

- **FR-8 (warn on a cold human resume).** When a presumed-human prompt (FR-14) arrives in a
  proven-interactive (FR-15), cold (FR-13) session, the hook lets the prompt proceed and
  emits a warning (a `systemMessage`; the carrier is decided in DQ-3). The warning states:
  the idle time; that this turn rewrites about `ctx` tokens (FR-13); the estimated
  list-price equivalent (FR-16); for next time, that `/clear` or a fresh session, with a
  handoff note the human writes (or one written before the session went idle), is cheaper,
  with the estimated restart saving (FR-11); and that `/compact` is not cheaper on a cold
  cache. It never suggests asking the cold session to write the handoff note, because that
  request is itself a turn on a cold cache and pays the full rewrite first. The warning fires
  at most once per idle episode, keyed on `session_id` plus the episode key (FR-13).
  A warning saves nothing on the turn it fires on, because the rewrite is already under way.
  Warn mode exists to measure (FR-10) and to tell the human what just happened.

- **FR-9 (block mode, off until FR-10 allows it).** In Part B `block` mode, the first
  presumed-human prompt of a cold episode is blocked. The reason carries the FR-8 content
  plus *"send it again to continue"*. Any later prompt in the same episode passes: the
  episode key is stable across a block, because the harness writes no user record for a
  blocked prompt and FR-13 ignores the `system` record it writes instead (verified for a
  task-notification block in `-p` mode; probe P2 confirms it for a human prompt in VS Code).
  `suppressOriginalPrompt` is not set, so the block message shows the original text for
  copying. Block mode never blocks a machine-injected prompt (FR-14 classes 1 to 5), a
  prompt in a session not proven interactive, a prompt while the #1914 marker is set
  (FR-15), any prompt while no current audit verdict allows block mode (FR-10), or any
  prompt when the hook itself errors. It also stays off in any session whose
  transcript tail shows a tool or command whose fires the classifier cannot yet identify
  (the AC-27 fallbacks for P3).

- **FR-10 (the cold-fire audit decides whether block mode turns on and stays on).**
  Definitions, fixed here so the 2%-35% false-positive spread in #1922 (which came from
  varying the rewrite definition) cannot recur:
  - A **fire** is a prompt that met FR-8's condition, logged with its episode key, context
    size, gap, model, `prompt_id` and a hash of its text. Each later presumed-human prompt in
    the same episode is logged with its `prompt_id` and text hash too, so a resend can be
    found.
  - A fire is **determinable** when the transcript later holds a new, deduplicated, real
    main-chain assistant record after it.
  - A **true positive** is a determinable fire whose first such record is a full-prefix
    rewrite: `cache_read_input_tokens` below 0.5 x the previous context, AND
    `cache_creation_input_tokens` at least 0.3 x (previous context minus
    `cache_read_input_tokens`). This is the rule of the 2026-09-28 analysis, re-derived on
    2026-09-29 (M1).
  - A **false positive** is a determinable fire that is not a true positive.
  - A **misclassified machine prompt** is a fire whose own user record, read afterwards
    (matched by `prompt_id` where the transcript carries it, otherwise the first main-chain
    user record after the fire that is not a tool result), lacks positive human evidence:
    it counts as misclassified unless that record has `turnOrigin: "human"` or `origin.kind:
    "human"`, and a record with `isMeta: true` always counts as machine. A record with no
    origin label at all (for example the harness continuation) is therefore misclassified,
    and so is a fire whose own record cannot be found: the gate fails closed.
  - A **blocked fire** (Part B `block`, FR-9) has no user record of its own. The harness
    writes only a `system` record whose content repeats the prompt text after `Original
    prompt:` and which carries no origin label (observed in the 2026-09-28 task-notification
    probe; P2 records the shape for a human prompt in VS Code). So for a blocked fire, the
    record read above is that of its **resend**, the first later prompt in the same episode
    with the same text hash, matched by the resend's `prompt_id`: the blocked fire is
    misclassified exactly when that record is. The first-later-record fallback never applies
    to a blocked fire, so a later prompt with other text never vouches for it. A blocked
    fire with no resend in its episode is **unattributed**: nothing on disk records its
    origin, so it counts as misclassified unless the founder marks it human in the audit,
    which lists each one with the first 300 characters of its text (read from the harness's
    block record). Keeping block mode on therefore costs a founder review of every block
    that was not resent.
  - **Precision** is true positives divided by determinable fires.

  Block mode may be switched on (a reviewed commit, FR-19) only when every condition holds:
  a window of at least 7 days holds at least 30 determinable fires; the audit's verdict for
  that window is complete (FR-20); precision is at least 0.95; misclassified machine prompts
  are 0; probe P2 (VS Code display) has passed; and the `claude -p --resume` gap (INV-4) is
  closed, either because #1914's marker has landed and every launcher exports it, or because
  the switching commit records a grep showing that no launcher in this repository or in the
  chief-of-staff helper runs `claude -p --resume`. If fewer than 30 determinable fires accrue
  within 28 days, block mode does not turn on, and this spec is amended to record that the
  lever is below noise here.

  After block mode is on, each audit's window runs from the end of the previous audit's
  window (or from the switch), so no stretch goes unaudited. Its verdict is "revert to warn"
  when misclassified machine prompts, unattributed blocks included, are not 0; when the
  window's evidence is incomplete in any way FR-20 names, which before the switch would
  read "not enough data"; or when at least 90% of at least 30 blocks were followed by a
  resend in the same episode, because block mode then adds friction without changing a
  decision. Otherwise it is "block may stay on". The audit writes each verdict to the state
  store (FR-17), and the hook enforces the revert itself rather than waiting for a commit:
  it blocks only while that store holds a "block may turn on" or "block may stay on"
  verdict less than 7 days old (Plan may change the default). With none, including when no
  audit has been run, it behaves as in `warn`, and its FR-8 warning adds one line saying
  block mode is suspended and why. A "revert to warn" verdict is sticky: every later audit
  returns it too, until one returns "block may turn on" under every switch-on condition
  above. A reviewed commit then sets the committed mode back to `warn` (FR-19).

### Part C - recycling guidance

- **FR-11 (restart saving in the warning).** Continuing a cold session writes `ctx` tokens
  at the cache-write rate; restarting writes only the boot `P` plus a handoff note `H`. The
  estimated saving on the resume turn is therefore `(ctx - P - H)` tokens priced at the
  cache-write rate of the tier in use, which on the one-hour tier is `2 x (ctx - P - H)`
  base-input-equivalent tokens. `P` is this session's boot size (the first real main-chain
  assistant record's context when it is inside the bounded tail, otherwise the measured
  median of 38,000 from M11) and `H` is a handoff-note allowance (Plan fixes the default).
  - The saving applies to a fresh session, or to `/clear`, with a note the human writes or
    one written before the session went idle; asking the cold session for a note pays the
    full rewrite first (FR-8).
  - It is shown only when positive, and it never exceeds the rewrite cost shown beside it,
    since `P` and `H` are never negative. Worked example (AC-21): `ctx` 330,000, `P` 38,000
    and `H` 2,000 on claude-opus-5 give a rewrite of about $3.30 and a saving of about $2.90.
  - It counts the resume turn only. Every later warm turn also reads `ctx - P` fewer tokens,
    which the warning does not claim. It is a lower bound in another way too: a fresh session
    in the same directory may read part of its boot from a parallel session's cache (docs;
    inferred to apply here).
  - On tokens alone, restarting wins whenever `ctx` exceeds `P + H`. The 150,000 threshold
    (FR-13) is therefore a policy choice about interruption and lost context, not a token
    break-even (DQ-4).

- **FR-12 (the warm-recycling rule, recorded with corrected parameters).** For a warm
  session between tasks, recycling pays off once the context carried beyond boot exceeds
  `R(N) = w x B / (r x N)`, with `w = 2` (one-hour write), `r = 0.1` (0.05 on Opus 5.5),
  `B` = 38,734 (M11 headless boot median) and `N` the number of deduplicated API calls
  the next task will take. That gives about 64,600 at N=12, about 27,700 at N=28 and about
  7,700 at N=100. This rule applies only to warm sessions; a cold resume uses FR-11. The
  figure *"about 17,000 tokens beyond boot at the median 28 turns per task, falling to
  roughly 4,800 at 100 turns"* from the 2026-09-28 comment reproduces arithmetically but
  must not be cited: it used the five-minute write weight (1.25x) where this corpus writes
  at the one-hour tier (2x), it counted transcript lines (about 2.15 per API call) rather
  than API calls, and it assumed warm reads. This spec builds no warm-session nudge (DQ-8);
  FR-12 is guidance for the warning text, for the chief-of-staff follow-up (#2211), and for
  any later spec.

### Shared mechanics (used by Parts A, B and C)

- **FR-13 (the cold predicate).** From the transcript at `transcript_path`, read only the
  last 8 MiB (as `session-title.py` does).
  - **Message records only.** Consider only main-chain (`isSidechain` false) records of type
    `assistant`, and main-chain records of type `user` whose content carries a `tool_result`
    block. Ignore every other record, whatever its type, including the ones the harness adds
    after a turn ends or while a prompt is queued: `system` (`stop_hook_summary`,
    `api_error`, `compact_boundary`, and the harness's own record of a hook block),
    `attachment` (`hook_success`, `hook_additional_context`), `queue-operation`,
    `custom-title`, `agent-name`, `last-prompt`, `mode`, `pr-link`, user text records
    (typed prompts, `isMeta` records, interruption notes), and any record type a later
    harness version adds. The rule is an allowlist, so a new record type cannot switch the
    guard off.
  - **Deduplication.** Deduplicate assistant records by `message.id`, keeping the copy with
    the largest `output_tokens` (the last such copy on a tie).
  - **Real records.** An assistant record is **real** unless its `message.model` is
    `<synthetic>`. Synthetic records make no API request and carry zero usage, so they
    neither refresh the cache nor measure its size.
  - **Gap, context and episode key.** `gap` is now minus the timestamp of the last real
    main-chain assistant record. `ctx` is that record's `input_tokens +
    cache_read_input_tokens + cache_creation_input_tokens`. Its `message.id`, with the
    `session_id`, is the **episode key** used by FR-8 and FR-9.
  - **Lifetime.** `TTL` is 300s when the most recent real record that records a cache-write
    tier used the five-minute tier, and 3600s otherwise (including when no tier is
    recorded).
  - **Turn in flight.** A turn is in flight when the latest message record (real or
    synthetic) is a `tool_result` user record, or an assistant record whose `stop_reason` is
    `tool_use` or absent. Any other stop reason (`end_turn`, `stop_sequence`, `max_tokens`,
    `refusal`) ends the turn. An in-flight turn runs whatever the hook does, so the session
    is not cold. An interrupted tool also leaves a `tool_result` record, so an interrupted,
    idle session reads as in flight; that errs toward not cold, which only forgoes a saving.
  - **Cold.** A session is **cold** when no turn is in flight, `gap > TTL`, and `ctx` is at
    least 150,000.
  - **Nothing to read.** A missing transcript, an empty one, or one with no real main-chain
    assistant record is never cold, and none of these is an error: a session's first prompt
    normally meets them.

  The allowlist, the deduplication rule and the stop-reason reading are inferred from real
  transcripts (2026-09-30), not documented. Plan pins each with a fixture copied from a real
  record sequence (AC-1, AC-2).

- **FR-14 (prompt classification).** Every prompt falls in exactly one class, tested in this
  order, after trimming leading and trailing whitespace:
  1. **peer message**: the prompt begins `<cross-session-message`;
  2. **cross-session notice**: it begins `[Cross-session ` (the hook-side prefix is
     inferred; P1 confirms it);
  3. **task notification**: it begins `<task-notification>`;
  4. **harness continuation**: it equals the value of `CLAUDE_CODE_RESUME_PROMPT` in the
     hook's environment when that is set and non-empty, and `Continue from where you left
     off.` otherwise;
  5. **possibly scheduled**: either
     - it equals a cron prompt the `Stop` hook recorded for this `session_id` from
       `session_crons`, or, when the recorded prompt ends in the harness's `… [+N chars]`
       truncation marker, it begins with the recorded text before the marker; or
     - it equals the prompt rebuilt from an earlier main-chain user record in the tail whose
       `turnOrigin` is `scheduled`: for a slash-command fire, the record's `<command-name>`
       value, followed by a space and its `<command-args>` value when present (the record's
       content is never the bare text the hook receives); for a plain-text record, its text.
       A scheduled record with neither (for example a compaction summary) contributes
       nothing;
  6. **presumed human**: anything else.

  Classes 1 to 5 are **machine-injected**. Matching is by prefix or exact equality, never by
  substring, so a human prompt that quotes a tag mid-text stays presumed human. The
  undocumented `content` field of the current prompt's `queue-operation` enqueue record is
  not used. A machine prompt that carries no identifying text (a goal idle check-in until P3
  records its text, or any future harness prompt) falls into presumed human; FR-10 counts
  every such case, and Part B `block` depends on that count being 0. The classifier is a pure
  function, tested against fixtures copied from real prompt and record shapes.

- **FR-15 (proven interactive; fresh headless runs are never acted on).** The hook blocks,
  defers, warns or reports only in a session proven interactive: an earlier main-chain user
  record in the transcript carries `turnOrigin: "human"` or `origin.kind: "human"`. Once
  seen, that fact is cached per `session_id` in the state store, so a long session whose last
  human record has left the 8 MiB tail stays proven. A session never proven interactive is
  logged at most and otherwise untouched; the one exception is FR-5 delivery of parked
  messages in its own store, which can only have been parked by a proven session (directly,
  or before an FR-6 carry-over). A fresh `claude -p` run is never
  proven, because it has no earlier human-origin record, so this needs no launcher marker.
  - **Known gap.** `claude -p --resume <session-id>` of an interactive session runs headless
    inside a transcript that is already proven, and at hook time the current prompt's own
    record, which would carry `turnOrigin: "sdk"`, is not yet on disk. The hook cannot tell
    that run apart, so it treats it as the proven session it resumes. No launcher does this
    today (Context). What such a run can receive, and what holds each:
    - a Part A deferral or a Part B block, either of which would replace the `-p` result:
      neither mode can be switched on until the gap is closed (FR-7, FR-10);
    - an FR-6 report: seen, but never confirmed by that run, because confirmation needs a
      human-origin user record, so the report is repeated to a human turn (AC-14);
    - an FR-5 delivery of that session's parked messages: counted as delivered, because the
      messages enter that session's conversation;
    - an FR-8 warning or an FR-18 error line: not held. Each adds at most a `systemMessage`
      and, until P2 settles DQ-3, a one-line `additionalContext` instruction.

    When the #1914 marker is set, the hook skips such a run entirely (below, AC-6). INV-4
    names the gap.
  - **The #1914 marker.** The hook treats `MINSPEC_HEADLESS_AGENT=1` in its environment (the
    name on #1914's unpushed branch) as a skip in every mode, whenever it is set. If #1914
    lands under another name, this spec is amended to match.

- **FR-16 (the cost estimate).** The model comes from the last real assistant record's
  `message.model`. A local table, with no network lookup, holds each known model's base
  input price and the tier multipliers from the 2026-09-29 pricing page (Opus 5: $5 base, $10
  one-hour write; Opus 5.5: $4 and $8; Sonnet 5: $2 and $4; five-minute write is 1.25x
  base). Every cost shown is labelled *estimated list-price equivalent; on a subscription
  this is drawn from plan usage, not billed*. For a model not in the table the warning states
  tokens only and no dollar figure.

- **FR-17 (state location and keys).** All state lives under this repository's git common
  directory, found from `$CLAUDE_PROJECT_DIR` (the root where the session started, which
  stays put), never from the envelope's `cwd`, which follows the model's `cd` and worktree
  changes and could point into another repository.
  - **Resolution.** The hook reads `$CLAUDE_PROJECT_DIR/.git` directly: a directory is the
    common directory; a `gitdir:` file leads to the linked worktree's git directory, whose
    `commondir` file names the common directory. No subprocess is needed (AC-24).
  - **Out of scope, or unresolvable.** If `$CLAUDE_PROJECT_DIR` has no `.minspec/` at its
    root, the hook does nothing and writes nothing, because that repository did not opt in
    (constitution invariant 3). If the variable is unset or the common directory cannot be
    resolved, that is an error under FR-18.
  - **Contents.** Everything lives in one subdirectory for this hook, which survives removal
    of a linked worktree, is never tracked, and is never under `~/.claude`. It holds: per
    `session_id`, the parking store and the delivered state, with each message's arrival
    time and transcript path, and for a delivered message its delivery id, the time of its
    last injection and the transcript path it was injected into; the FR-6 report records
    (report id, time emitted, the carrying prompt's `prompt_id` and transcript path, and the
    messages each covers); the `/clear` carry-over records (FR-6); episode keys; the cached
    interactive flag; the cron prompts recorded by the `Stop` hook; the observe/warn log,
    which is size-bounded and rotated; a per-day counter of hook runs and failed log writes
    (FR-20); and the latest Part B audit verdict with its date (FR-10).
  - **No per-checkout or cwd dependence.** Every path is absolute. Nothing is keyed per
    checkout, and nothing depends on the shell's or the envelope's `cwd` (the two #1914
    defects).

- **FR-18 (bounded, fails visibly, never blocks on its own error).** The hook enforces an
  internal time budget (default 5s), well under the harness's 30s `UserPromptSubmit` timeout.
  That timeout is not silent (the transcript shows a notice naming the hook), but it discards
  the hook's output, including a block, a custody decision or a delivery; the internal budget
  exists so that no decision is lost that way. Custody precedes any block (FR-2), delivered
  messages are released only after confirmation (FR-5), and a message still unconfirmed a
  day after its arrival is reported until a human turn has seen the report (FR-6). So a
  discarded output leaves a duplicate or a late delivery, and the message stays on disk
  until its delivery is confirmed or a human deletes it.
  - On any internal error, or when the budget runs out, the hook exits 0, blocks nothing,
    defers nothing (a message is delivered), and appends the error to the log; if that log
    write itself fails, it counts the failure in the FR-17 counter.
  - In a proven-interactive session it also emits one visible line, at most once per session
    per error kind. The line goes out as a `systemMessage` and, until probe P2 records that
    VS Code displays a `systemMessage`, also as `additionalContext` asking the model to relay
    it in one line (DQ-3). In a session not proven interactive, an error goes to the log
    only (INV-4).
  - If `python3` is missing, the shell wrapper exits 0 and emits only a `systemMessage`
    (never `additionalContext`, never a decision), because it cannot run the interactive
    test. That output adds nothing to the model's context (inferred for `-p` runs; AC-22
    pins its shape).
  - `MINSPEC_COLD_RESUME_OFF=1` stops the hook from classifying, deferring, warning,
    reporting or blocking in that session. It still delivers and confirms messages already
    parked for that session (FR-5), so switching the hook off never strands one.

- **FR-19 (registration and modes).** The hook is registered in this repository's
  committed `.claude/settings.json`, each command path built from `$CLAUDE_PROJECT_DIR`:
  - on `UserPromptSubmit` (next to `scope-check.sh` and `session-title.sh`);
  - on `Stop`, to record cron prompts. It always exits 0 and never emits a `decision` field,
    even on its own error, because a `Stop` hook that blocks makes the model keep going;
  - on `SessionEnd` with matcher `clear` (FR-6 carry-over), with an explicit per-hook
    `timeout` (Plan fixes it, at least 5s), because `SessionEnd` hooks otherwise share a 1.5s
    budget. It emits nothing, since the harness discards `SessionEnd` output. Other
    `SessionEnd` hooks, such as `session-end.sh`, keep their own default.

  There is no `SessionStart` registration: the FR-6 report goes through `UserPromptSubmit`
  and only to a proven-interactive session, so it never reaches a fresh headless run; a
  `claude -p --resume` run can receive it but never confirms it (FR-6, the FR-15 known gap).
  Part A's mode is `off`, `observe` or `enforce` (default `observe`); Part B's is `off`,
  `warn` or `block` (default `warn`). Both mode values are committed in this repository
  (Plan picks the carrier), so every change of a mode value is a reviewed commit. FR-10's
  suspension never changes the value; it only makes a committed `block` behave as `warn`. A
  mode governs only what is newly deferred, warned about or blocked: in every mode, `off`
  included, the hook still delivers and confirms parked messages (FR-5) and runs both FR-6
  paths, so no mode switch strands a message. Nothing is added to the template registry,
  the generated hook templates or `claude-settings.ts`.

- **FR-20 (audit completeness: a missing witness fails closed).** Every audit mode (FR-7,
  FR-10) reports the time span its log actually covers, the number of rotations inside the
  window, and the FR-17 per-day counter of hook runs and failed log writes. As an
  independent second witness, it recomputes from the transcripts of every session named in
  the log the events it would have logged in the window (would-defer events for FR-7, fires
  for FR-10), and counts those the log lacks. Its verdict is "not enough data" whenever the
  covered span is shorter than the window, a rotation dropped entries inside it, the counter
  shows a failed write, the counter is missing for a day on which those transcripts show a
  prompt, or the transcripts show an event the log lacks. An audit never returns a
  switch-on verdict on missing evidence, and once Part B is in `block`, missing evidence
  returns "revert to warn" instead (FR-10) (constitution invariant 2).

## Acceptance Criteria

All automated criteria run the real hook as a subprocess, piping a synthetic envelope and a
synthetic transcript, in `packages/minspec/tests/cold-resume-hook.test.ts`. Unless a
criterion says otherwise, a fixture's last real assistant record is followed by the trailing
sequence copied from a real idle transcript: a `system` `stop_hook_summary`, an `attachment`
`hook_success`, the current prompt's `queue-operation` enqueue and dequeue, a `custom-title`
and an `agent-name` record.

- **AC-1 (FR-13, boundaries).** With the last real main-chain assistant record at time T
  (`stop_reason` `end_turn`, context 200,000) and the trailing sequence after it: a prompt at
  T+3601s is cold; at T+3599s it is not. With context 149,999 at T+3601s it is not cold. A
  missing transcript, an empty transcript, and a transcript with no real assistant record
  are not cold and produce no visible line.
- **AC-2 (FR-13, deduplication, sidechain, synthetic, turn in flight).** Three copies of one
  `message.id` (one partial with no `stop_reason`, two with `end_turn`) give the same result
  as one copy. A later sidechain assistant record does not reset the gap. A later synthetic
  assistant record ("No response requested.", model `<synthetic>`, zero usage, `stop_sequence`)
  neither resets the gap nor zeroes `ctx`, so the prompt is still cold. A last message record
  that is an assistant `tool_use`, over an hour old, is not cold, and neither is a
  `tool_result` user record newer than the last assistant record. After a prior deferral,
  with the harness's block record ("UserPromptSubmit operation blocked by hook") now last,
  the session is still cold and has the same episode key.
- **AC-3 (FR-13, tier).** When the most recent cache write is in the five-minute tier, a
  prompt 301s after the last record with context 200,000 is cold.
- **AC-4 (FR-14, prefixes and continuation).** One fixture per class, with the real prompt
  shapes, yields that class, including the harness continuation both with the default text
  and with `CLAUDE_CODE_RESUME_PROMPT` set to another text. A human prompt that contains
  `<task-notification>` after other text, and a human prompt that begins `Continue from where
  you left off.` and goes on, are presumed human.
- **AC-5 (FR-14, scheduled).** A prompt equal to a cron prompt the `Stop` hook recorded for
  this session is possibly scheduled; the same text in another session is presumed human. A
  recorded prompt ending in `… [+120 chars]` matches a prompt that begins with its text
  before the marker. With an earlier `turnOrigin: "scheduled"` record copied from a real one
  (`<command-message>chief-of-staff</command-message>` then
  `<command-name>/chief-of-staff</command-name>`), the prompt `/chief-of-staff` is possibly
  scheduled. A `turnOrigin: "scheduled"` compaction summary contributes nothing.
- **AC-6 (FR-15, INV-4, headless).** In a cold session whose user records all carry
  `turnOrigin: "sdk"`, no mode of either part produces a block, a deferral, a
  `systemMessage` or `additionalContext`, for any prompt class. That holds even when another
  session's store holds a message old enough to report, and no report covers it. With
  `MINSPEC_HEADLESS_AGENT=1` in the environment, a cold, proven-interactive session gets the
  same nothing.
- **AC-7 (FR-1, FR-2, custody).** Part A `enforce`, cold interactive session, peer message
  without the marker: the output is a block, and a parked file already holds the prompt
  text byte-identical to the input. A second peer message in the same cold episode, with the
  first block's `system` record now in the tail, is also deferred.
- **AC-8 (FR-2, custody failure).** Same as AC-7 with an unwritable store: no block, the
  prompt passes, and one visible line reports the failure.
- **AC-9 (FR-2, cap).** With 100 messages already parked, the 101st is delivered, not
  blocked, and nothing is dropped.
- **AC-10 (FR-3, INV-3).** Same as AC-7 with the body starting `[URGENT]`: no block, nothing
  parked. A body starting `URGENT:` without brackets, and a body with `[urgent]` in the
  middle, are deferred like any other message.
- **AC-11 (FR-4, DQ-2).** In `enforce`, a presumed-human prompt, a possibly-scheduled prompt
  and a harness continuation are never deferred. A task notification is delivered and logged
  by class (under the DQ-2 recommendation).
- **AC-12 (FR-5, delivery and confirmation).** After two messages are parked, the next
  presumed-human prompt (Part B in `warn`) receives `additionalContext` with both bodies in
  arrival order under a header that begins with its delivery id, and the messages leave the
  parking store. If the transcript then holds no attachment for that delivery id, the next
  turn that runs re-delivers them; the same holds when the only assistant record after the
  attachment is synthetic. Once the transcript holds a main-chain `hook_additional_context`
  attachment carrying the delivery id followed by a real assistant record, the next prompt
  receives no re-delivery and the files are gone. With Part B in `block`, the blocked prompt
  receives nothing and the messages stay parked until the resend passes.
- **AC-13 (FR-5, truncation).** A parked body that would push the injection past 10,000
  characters is truncated in the injection, which names its absolute file path, and the
  whole injection stays under the cap. After the delivery is confirmed, that path still
  exists.
- **AC-14 (FR-5, FR-6, INV-2, INV-4, report).**
  - A message has been parked for 25 hours in session S1's store, and no `SessionEnd` ever
    ran for S1. A presumed-human prompt in proven-interactive session S2 receives one report
    line naming its class, sender, arrival time, state, S1's `session_id` and file path,
    plus a count, as a `systemMessage` and as `additionalContext` headed by a report id. The
    file still exists and is still in S1's store. A message parked for 23 hours is not
    reported, and a task notification arriving in S2 carries no report.
  - A presumed-human prompt in another proven session S3 less than an hour later gets no
    report of it. Once S2's transcript holds the report's attachment followed by a real
    assistant record, and the carrying prompt's user record has `origin.kind: "human"`, no
    later prompt anywhere reports the message. If that user record instead carries
    `turnOrigin: "sdk"` (the `claude -p --resume` shape), or no assistant record follows the
    attachment, a presumed-human prompt in S3 more than an hour later reports it again.
  - A message that arrived 25 hours ago was delivered into S1, and S1 never ran again. With
    no attachment for its delivery id in S1's transcript, the prompt in S2 reports it as
    delivered but unconfirmed, with the time of its injection. With that attachment followed
    by a real assistant record, the prompt in S2 releases it as FR-5 does and reports
    nothing.
- **AC-15 (FR-6, carry-over).** `SessionEnd` with reason `clear` for S1, which holds a parked
  message, emits no output. The first prompt of the replacement session S1', which shares
  S1's link key, receives the message through FR-5. A first prompt in S3, with a different
  key, does not receive it, and the message stays in S1's store. (This criterion is removed
  by amendment if P4 finds no reliable key.)
- **AC-16 (FR-7, observe and audit).** In `observe`, a would-defer message passes unchanged
  and one log line records it. The audit mode, fed that log and a transcript with the next
  assistant record, reports the class, the count and that record's cache-creation tokens. Fed
  an `enforce` log with an assistant record between a deferral and its delivery, it lists
  one failed deferral.
- **AC-17 (FR-8, FR-16, INV-8, warn).** Part B `warn`, cold interactive session,
  presumed-human prompt: no block; one `systemMessage` naming the idle time, the token count,
  the dollar estimate with its "estimated list-price equivalent" label, `/clear`, a fresh
  session and that `/compact` is not cheaper, and not suggesting that the session be asked
  for a handoff note. A second prompt in the same episode gets no warning.
- **AC-18 (FR-9, INV-1, block).** Part B `block`, with a "block may stay on" verdict less
  than 7 days old in the state store: the first presumed-human prompt of an episode is
  blocked, with the FR-8 content in the reason and `suppressOriginalPrompt` absent from the
  output; the second passes. A peer message, a cross-session notice, a task
  notification, a harness continuation and a possibly-scheduled prompt in the same cold
  state are never blocked by Part B. With `MINSPEC_HEADLESS_AGENT=1` set, nothing is blocked.
  With the verdict missing, older than 7 days, or "revert to warn", the first presumed-human
  prompt of a cold episode is not blocked; it gets the FR-8 warning with a line saying block
  mode is suspended and why.
- **AC-19 (FR-10, INV-1, audit).** Given a fixture log of fires and transcripts with known
  next records, the audit reports determinable fires, true and false positives,
  misclassified machine prompts and precision exactly as defined, and a verdict of "block
  may turn on" only for the fixture that meets every condition. A fixture with 29
  determinable fires yields "not enough data". A fire whose own record is `isMeta` with no
  `turnOrigin` and no `origin` (the continuation shape), and a fire whose own record cannot
  be found, each count as misclassified. With block mode on, one misclassified fire makes the
  verdict "revert to warn". With block mode on, and each blocked fire represented by a copy
  of the harness's block record from the 2026-09-28 probe: a blocked fire whose resend in
  the same episode has `origin.kind: "human"` counts as human; one whose resend lacks human
  evidence counts as misclassified; one with no resend, followed by a human prompt with
  other text, is listed as unattributed and counts as misclassified until marked human. Any
  AC-20 fixture run with block mode on yields "revert to warn", not "not enough data", and
  so does a window in which 27 of 30 blocks were resent by a human and the other 3 are
  marked human. After a "revert to warn", an audit over a clean post-switch window still
  returns "revert to warn"; only one that meets every switch-on condition returns "block may
  turn on".
- **AC-20 (FR-20, INV-7, completeness).** Each of these yields "not enough data" even when
  the remaining entries would pass: a log whose covered span is shorter than the window; a
  log whose rotation dropped entries inside the window; a counter showing a failed write; a
  counter missing for a day on which the transcripts show a prompt; and a transcript showing
  a fire the log lacks.
- **AC-21 (FR-11, FR-16, INV-8, cost).** A cold resume on `claude-opus-5` with context
  330,000 shows a rewrite of about $3.30; with `P` 38,000 and `H` 2,000 it shows a saving of
  about $2.90. Over a grid of `ctx`, `P` and `H` values, the saving shown never exceeds the
  rewrite cost shown and is omitted when not positive. Every dollar figure carries the
  estimate label. On an unknown model id the warning shows the token count and no dollar
  sign.
- **AC-22 (FR-18, FR-19, INV-7, errors).** In a proven-interactive session, a truncated JSON
  line at the tail and an exhausted time budget each give exit 0, no block, no deferral, and
  one visible line (a `systemMessage`, plus `additionalContext` while P2 is unrecorded) for
  the first occurrence in a session and none for the second. The same errors in a session
  not proven interactive print nothing and are logged. The `Stop` entry, fed a malformed
  envelope, exits 0 with no `decision` field. With `MINSPEC_COLD_RESUME_OFF=1` and nothing
  parked, the hook prints nothing; with a message parked, it delivers it and does nothing
  else. With Part A's committed mode `off` and a message parked, the next prompt that runs
  delivers it. With `python3` absent from `PATH`, the wrapper exits 0 and its output has no
  `additionalContext` and no decision.
- **AC-23 (FR-13, FR-18, bounded read).** A transcript larger than 8 MiB whose last record
  is cold completes inside the time budget and returns the same verdict as its tail alone.
- **AC-24 (INV-5, offline).** The Python module's imports match an explicit allowlist that
  contains no network module and no subprocess module, and the shell wrapper contains no
  invocation of `curl`, `wget`, `gh`, `nc`, `ssh` or `git`. Adding any of them fails the
  test. (A static check stands in for a runtime one because CI cannot drop network access
  per process.)
- **AC-25 (INV-6, FR-17, blast radius).** Run with `HOME` pointed at an empty temporary
  directory, the hook leaves it empty and writes only under the fixture repository's git
  common directory. With the envelope's `cwd` set to a second, unrelated git repository
  (and `$CLAUDE_PROJECT_DIR` at the fixture repository), that repository's `.git` is
  unchanged, and a message parked in that state is delivered at the next prompt whose `cwd`
  is the fixture repository's root. With `$CLAUDE_PROJECT_DIR` at a git repository that has
  no `.minspec/`, the hook writes nothing anywhere. The template registry and the
  managed-region enumeration pin are unchanged by this spec's diff.
- **AC-26 (FR-19).** `.claude/settings.json` registers the hook on `UserPromptSubmit`, on
  `Stop`, and on `SessionEnd` with matcher `clear` and an explicit `timeout`, all with
  `$CLAUDE_PROJECT_DIR`-based paths, and on no `SessionStart` event. Both default modes
  (`observe`, `warn`) are the committed values.
- **AC-27 (probes, manual, before any mode switch).** Before Part A `enforce` or Part B
  `block` is committed, these live probes are run and their results recorded in this spec's
  design at Plan:
  - **P1.** Between two VS Code sessions, block a cross-session message and a cross-session
    notice arriving in a cold recipient. Record what the sender sees. On the recipient side,
    record that no assistant record and no cache write follow, that the harness does not
    re-deliver, that the last `message.id` is unchanged, and the notice's prompt prefix as
    the hook receives it.
  - **P2.** In a VS Code-hosted session, record whether a block reason and a `systemMessage`
    are visible, whether the blocked text is restored to the input box, whether the episode
    key stays the same across a human-prompt block, and whether the harness's block record
    for a human prompt repeats its text and carries no origin label, as it does for a task
    notification (FR-10).
  - **P3.** Confirm that `/loop`, `CronCreate` and `ScheduleWakeup` prompts appear in the
    `Stop` hook's `session_crons`, and record the prompt text and `turnOrigin` of a
    self-paced `ScheduleWakeup` fire and of a `/goal` idle check-in.
  - **P4.** In VS Code, run `/clear` in a session and record whether `SessionEnd` fires with
    reason `clear`, whether the replacement session has a new `session_id`, and which key
    links the old session to the replacement session's first prompt.

  Fallbacks: if P3 fails for `/loop` or `ScheduleWakeup`, FR-14 falls back to the transcript
  arm of class 5 alone, and Part B `block` stays off in any session whose transcript tail
  shows that tool or command in use. Until P3 records a goal check-in's text, Part B `block`
  stays off in any session whose tail shows `/goal` in use. If P4 finds no reliable key,
  FR-6 carry-over is not built.

## Invariants

- **INV-1 (no prompt classified machine-injected is ever discarded or blocked).** Deferral
  with custody (FR-1, FR-2) is the only way this spec holds a machine-injected prompt, and it
  is not a block in #1922's sense: the text is stored first and delivered later. Part B
  never blocks a prompt in FR-14 classes 1 to 5. A machine prompt that carries no
  identifying text lands in presumed human, where Part B could block it. That is why FR-10
  measures misclassification with positive human evidence and keeps block mode off unless
  the count is 0. Once block mode is on, a blocked prompt leaves no user record, so FR-10
  attributes it only through a resend of the same text in the same episode, and counts an
  unresent one as misclassified unless the founder marks it human. Any misclassified block,
  or an audit whose evidence is incomplete, makes the verdict "revert to warn", which only a
  fresh switch-on verdict undoes. The hook itself suspends block mode whenever no audit less
  than 7 days old allows it, so the revert does not depend on anyone remembering to run the
  audit or commit it. This is the strongest form of #1922's
  rule *"never block a machine-injected prompt"* the classifier can guarantee, not the rule
  itself: a misclassified prompt can still be blocked before the next audit finds it
  (AC-18, AC-19).
- **INV-2 (at-least-once delivery; a lost message is worse than a paid rewrite).** A parked
  message is delivered at the next turn that runs in its session (or, after a `/clear`, in
  the session that replaced it, where FR-6 carry-over is built), and its file is released
  only after the transcript confirms the delivery (FR-5). A message whose delivery is still
  unconfirmed 24 hours after its arrival, whether it is parked or was delivered without
  confirmation, is reported visibly at a human turn in a proven-interactive session; the
  report is repeated until a human turn has seen it, and the message stays on disk (FR-6).
  Delivery, confirmation and the report run in every mode (FR-19). Whenever the hook is
  unsure, it delivers now. The accepted failures are a duplicate and a late delivery: no
  message is deleted before its delivery is confirmed, and every message still unconfirmed
  a day after its arrival is reported at a later human turn in a proven-interactive session
  (AC-7, AC-8, AC-9, AC-12, AC-13, AC-14, AC-15, AC-22).
- **INV-3 (the urgent path is explicit).** A message carrying the marker is never deferred,
  and the hook never guesses urgency (AC-10).
- **INV-4 (fresh headless runs are untouched).** No block, deferral, warning or report in a
  session not proven interactive, or while the #1914 marker is set. A block in `-p` mode
  would replace the run's result, which dispatch scripts parse. Two outputs are exempt:
  FR-5 delivery of parked messages, which a fresh headless run never holds because only a
  proven-interactive session parks (directly, or before an FR-6 carry-over); and FR-18's
  `python3`-missing line, a `systemMessage` that adds no model context and no decision. The
  one headless shape the hook cannot detect is `claude -p --resume` of an interactive
  session (the FR-15 known gap): such a run can receive a warning, a report, an error line
  or its own session's delivery, and it never confirms a report (FR-6). No launcher uses it
  today, and the two outputs that would replace its result, a Part A deferral and a Part B
  block, stay off until the gap is closed or its absence is recorded (FR-7, FR-10) (AC-6,
  AC-14, AC-18).
- **INV-5 (offline, constitution invariant 1).** The hook reads only the local transcript,
  its local state and its local price table. It makes no network call, its Python module
  starts no subprocess, its shell wrapper runs nothing but `python3`, and nothing it logs
  leaves the machine (AC-24).
- **INV-6 (blast radius, constitution invariant 3).** Parts A, B and C are all dev-time
  only, for this repository. The hook is registered only in this repository's committed
  `.claude/settings.json`, is absent from the template registry, writes nothing under
  `~/.claude`, writes nothing outside this repository's git common directory (found from
  `$CLAUDE_PROJECT_DIR`, never the envelope's `cwd`), and does nothing where `.minspec/` is
  absent. Shipping it to adopter repositories is a separate spec (#2210) that would need a
  `.minspec/`-presence gate and a persistent per-project opt-out, because under DR-073's
  2026-08-05 correction deleting a shipped hook is undone by the next Refresh (AC-25).
- **INV-7 (no silent gate, constitution invariant 2).** The guard is advisory. It is not a
  merge gate or a required check, so failing open on its own error is correct, and it never
  blocks or defers because of its own error. Its errors are logged and, in a
  proven-interactive session, shown on two surfaces until P2 proves one is enough (FR-18).
  The audits that decide every mode switch fail closed on missing evidence (FR-20), and
  once Part B is in `block`, a missing, stale or incomplete audit suspends it (FR-10). The
  harness's own 30s timeout discards the hook's output but shows a notice; FR-18's internal
  budget keeps decisions out of its reach (AC-20, AC-22).
- **INV-8 (never a wrong number).** Every cost shown is labelled as an estimate, an unknown
  model gets no dollar figure, and a saving shown never exceeds the rewrite shown beside it.
  Every figure in this spec carries its definition, date and source (AC-17, AC-21).

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
  this spec from changing them; their change is tracked as #2211 (the chief-of-staff wake
  policy).
- **Enforcing anything inside SPEC-027 (the inter-session mailbox).** It is specified, not
  built, and already pull-only. That it must never gain a transport that starts a turn in an
  idle session, and that any urgency it needs should be a message field mirroring FR-3
  (adding fields is allowed by its own costly-to-refactor note), is a constraint for
  SPEC-027 to adopt (Follow-up 2, #2209). Nothing this spec builds can check it, so it is not
  an invariant here.
- **Shipping to adopter repositories** (INV-6, DQ-7, #2210).
- **A status-line warning.** The status line never runs in VS Code panel sessions (PR
  #1670), which is where this fleet runs.
- **Rewrites that expiry does not explain.** About 10.8% of rewrite tokens on the sample
  followed a gap of an hour or less (M13), cause unknown. The gap trigger cannot catch them;
  diagnosing them is tracked as #2207 (the short-gap rewrites).
- **Changing the harness,** including asking for a native "skip this wake if the cache is
  cold" option.

## Clarify selections (recorded by an agent 2026-10-02; ratified only by approval of this spec)

DQ-1 to DQ-8 each carry a **Recorded selection** line naming the option this document
already recommended. An agent session wrote those lines on 2026-10-02, and no human chose
them. This repository runs with `"autonomy": "act"` (`.minspec/config.json:58`), under which
an agent proceeds on a stated recommendation and leaves the options it did not take on
record (DR-086 §2 and §4), which is why the options stay below with their costs. Approving a
T3 spec is the second class on that section's stop list (`scripts/lib/autonomy.ts:68-70`),
so nothing here stands in for that approval: the lines propose, and approving this spec is
what ratifies them. An approval records a canonical hash that covers this body
(`packages/minspec/src/lib/approval.ts:4-8`) and reads as stale once the hash stops matching
(`resolveStatus`, `:483-490`), so an approval of this text covers these selections and
changing one afterwards voids it. When the lines were written this spec had not landed on
`main` and no approval of it existed there (`status: specifying`, `clarify: pending`). A
question in this section with no **Recorded selection** line is still open.

### DQ-1 - the founder's "wake everything" instruction vs Part A

**Recorded selection: Option A,** adopt Part A for non-urgent peer messages and
cross-session notices, observe first (FR-7), with the chief-of-staff change tracked as #2211
(the chief-of-staff wake policy). This is the option that puts Part A ahead of the founder's
2026-09-25 "wake everything" instruction where the two conflict, which is a non-urgent peer
message or notice reaching a cold session. Nothing is held while Part A is in `observe`, the
default FR-19 gives it. FR-7 lists "DQ-1 is decided" among the conditions for switching to
`enforce`, and it is approval of this spec that decides it, not this line.

The founder's instruction of 2026-09-25 to the chief-of-staff skill reads *"make sure cos
skill includes waking up all sessions that cos didn't intentionally pause"*, and the skill
treats any other idle session as a defect to wake. Part A holds non-urgent peer messages and
notices to a cold session until its next running turn. Both cannot hold at once for cold
sessions.

- **Option A (rec).** Adopt Part A for non-urgent peer messages and cross-session notices,
  observe first (FR-7), and make the chief-of-staff change (cache-aware cadence, and
  `[urgent]` on relayed founder instructions), tracked as #2211. *Cost:* until the
  chief-of-staff adopts the marker, a founder instruction it relays to a cold session waits
  for that session's next running turn; an idle notice to a cold chief-of-staff waits for
  its next loop tick (within 60 minutes on the current ladder, while the loop is running).
- **Option B.** Always deliver peer messages; defer only harness notices. *Cost:* forgoes
  the largest measured class (cross-session messages, 63.8M of about 112M automated
  cold-rewrite tokens in M9, older cron fires included).
- **Option C.** Observe only, never enforce. *Cost:* saves nothing; the measurement just
  confirms the size.

### DQ-2 - task notifications: defer or deliver?

**Recorded selection: Option A,** task notifications are delivered, logged by class in
observe mode, and revisited once that log has data. FR-1, FR-4 and AC-11 are already written
this way.

A task notification means a background task the session itself launched has finished.
Under autonomy `act` (DR-086), continuing on it is often the point.

- **Option A (rec).** Deliver task notifications, log them by class in observe mode, and
  revisit with data. *Cost:* forgoes that class's saving for now (51 events and 21.2M tokens
  in M9; the largest automated class, 46 of 88, in the 2026-09-29 sample).
- **Option B.** Defer them like peer messages. *Cost:* stalls self-completing sessions
  (SPEC-044's auto-wrapup) until the human returns.

### DQ-3 - the warning's carrier in VS Code

**Recorded selection: Option A,** the warning is a `systemMessage`, with `additionalContext`
as the fallback only if probe P2 shows that VS Code does not display it. FR-8 and AC-17 are
already written this way.

Whether VS Code shows a `systemMessage` is unknown until probe P2. The same question decides
how FR-18's error lines reach the human; until P2 is recorded, those lines go out on both
surfaces regardless of this choice.

- **Option A (rec).** Use `systemMessage`; if P2 shows it is invisible in VS Code, fall back
  to `additionalContext` asking the model to state the cost in one line. *Cost:* the
  fallback relies on the model relaying it (constitution principle 8, enforce rather than
  trust) and adds a one-line instruction per fire (under 100 tokens, estimated). Fires are at
  most about 7 a day: M9 counts 105 human cold wakes in the 14 days from 2026-09-15, across
  all projects and before the 150,000 filter (estimated).
- **Option B.** Always use `additionalContext`. *Cost:* the same model reliance even where a
  direct surface works.

### DQ-4 - the context threshold

**Recorded selection: Option A,** 150,000 tokens, the threshold FR-13's cold predicate
already uses.

- **Option A (rec).** 150,000. *Cost:* catches 85.9% of rewrite tokens on the sample
  against 89.0% at 100,000 (M12), so about 3 points of coverage are left in exchange for
  fewer interruptions.
- **Option B.** 100,000. *Cost:* more fires, each saving less, which raises the nag rate
  (constitution principle 4, avoid nagging).

### DQ-5 - the epic

**Recorded selection: Option A,** EPIC-009 (Team Readiness), the `epic:` this spec's
frontmatter already carries.

- **Option A (rec).** EPIC-009 (Team Readiness), next to SPEC-026, SPEC-027 and SPEC-044.
  *Cost:* Part B is single-session economics and fits EPIC-009's "more than one actor" test
  loosely.
- **Option B.** EPIC-007 (Agent Execute, the dev-time pipeline). *Cost:* separates Part A
  from the SPEC-027 mailbox whose constraint it hands over (Follow-up 2, #2209).

### DQ-6 - does this spec's delivery policy need a decision record?

**Recorded selection: Option A,** no decision record. Option B is not taken, so none is
written with this spec.

This is this spec's own question. It is analogous to, but separate from, #1923's open
question about its own Parts 1 and 2, which this spec does not answer.

- **Option A (rec).** No decision record. Every mode switch is a one-line reviewed commit,
  undoable in minutes, and Part A changes when a session hears from peers, not what an
  autonomous session may do, so DR-086's stop list is untouched. *Cost:* the delivery policy
  lives in a spec and a committed mode value, so a reader of DR-086 will not find it (the
  `relates_to` link is the only pointer).
- **Option B.** Write a DR now. *Cost:* register weight and a founder read for a dev-time
  hook that is reversible the same day.

### DQ-7 - the operator's other repositories

**Recorded selection: Option A,** the hook stays dev-time, in this repository only (INV-6).
The operator's other repositories stay uncovered until the guard ships as its own spec,
tracked as #2210 (ship the guard to adopter repositories), and that only if the audits show
the saving.

The hook covers sessions in this repository only (M6: the MinSpecPro project's sessions
carried 85.5% of measured cache-creation tokens). voip-sms-inbox (9.4%) and memory-fabric
(3.8%) are not covered.

- **Option A (rec).** Stay dev-time here; ship later as its own spec (#2210) if the audits
  show the saving. *Cost:* about 14% of measured cache-creation tokens stay uncovered
  meanwhile.
- **Option B.** The operator installs the hook in their own global configuration by hand.
  *Cost:* outside MinSpec, so MinSpec cannot own or test it, and invariant 3 forbids MinSpec
  doing it for them.

### DQ-8 - a warm-session recycling nudge

**Recorded selection: Option A,** no warm-session recycling nudge is built now. FR-12
already says this spec builds none.

- **Option A (rec).** Do not build one now. FR-12's rule depends on `N`, the next task's
  call count, which the hook cannot know. *Cost:* warm sessions keep carrying context past
  the break-even with nothing to prompt a recycle.
- **Option B.** Nudge at an assumed `N`. *Cost:* a guessed input produces a confident
  number, and a nudge on every long warm session runs against principle 4 (avoid nagging).

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | A harness update changes a prompt prefix or a transcript label, or adds an unlabelled machine prompt, so a machine prompt reads as presumed human | Classification is fixture-pinned (AC-4, AC-5); the audit counts any fire whose own record lacks positive human evidence as misclassified (FR-10); any non-zero count keeps or reverts Part B to `warn`, and block mode is suspended whenever no audit less than 7 days old allows it (FR-10) |
| R2 | On the five-minute tier (usage credits), every pause over 5 minutes is cold, so fires become frequent | Once per episode (FR-8); the audit reports fires by tier |
| R3 | A founder instruction relayed by the chief-of-staff to a cold session waits | DQ-1; observe first; the urgent marker; the chief-of-staff follow-up (#2211) |
| R4 | A sender that expects a reply gets none while its message is parked, and may not learn why; or the recipient's harness re-delivers a blocked message | P1 on both sides before `enforce`; the block reason is recorded in the recipient's transcript; the post-`enforce` audit lists failed deferrals (FR-7) |
| R5 | A long session whose human records have left the 8 MiB tail is never proven interactive | The flag is cached once seen (FR-15); a miss is the safe direction (the rewrite is paid) |
| R6 | The estimate is a list-price equivalent, while a subscription draws plan usage whose weighting of cache writes is not published | Labelled estimated (FR-16, INV-8) |
| R7 | The chief-of-staff session runs in this repository, so Part B could fire on its scheduled ticks | FR-14 class 5 matches both the `Stop` hook's cron list and the real `<command-name>` shape of earlier scheduled records; P3; Part B never blocks that class |
| R8 | A future launcher runs `claude -p --resume` into an interactive session, which the hook treats as interactive | INV-4 names the gap; the #1914 marker is honoured whenever set; Part A `enforce` and Part B `block` wait on the gap (FR-7, FR-10); a report such a run receives is never confirmed by it (FR-6) |
| R9 | The transcript record shapes this spec reads (the non-message records FR-13 ignores, the synthetic model marker, the `hook_additional_context` attachment) are undocumented and may change | FR-13 is an allowlist, so an unknown record type is ignored rather than switching the guard off; each shape is pinned by a fixture copied from a real record; every misreading errs toward not cold or toward re-delivery |
| R10 | A `/clear` in a session holding parked messages strands them under the old `session_id` | FR-6 carry-over where P4 finds a key; otherwise the 24-hour report names them |

## Test

New test file owned by this spec: `packages/minspec/tests/cold-resume-hook.test.ts`, run by
CI's `npx vitest run`. It executes the real `scripts/hooks/cold-resume.sh` as a subprocess
(the test-by-execution convention of `session-identity.test.ts` and `spec-gate.test.ts`), never
greps the hook's source except for AC-24's import and command allowlist. Transcripts and
envelopes are synthetic: they copy the key shapes and record sequences of real records,
including the trailing non-message records after a turn ends, never real content. The
probes in AC-27 are manual and recorded at Plan.

## Follow-ups (tracked)

Each item carries the issue that tracks it (DR-023: a DR's or spec's follow-ups are
materialized, never prose only).

1. **Chief-of-staff cadence and wake policy** - #2211 (AIClarityAU/minspec, for tracking;
   the change lands in the operator's own configuration, not in this repository). Before
   messaging a peer, read the recipient transcript's last assistant timestamp and hold or mark
   `[urgent]` when it is cold; prefix relayed founder instructions with `[urgent]`; check
   whether the 60-minute rung straddles the one-hour cache lifetime (inferred, not
   measured); reconcile the "wake everything" instruction with the DQ-1 outcome. Relates to
   SPEC-044 Amendment A's open question on where the central driver lives.
2. **Record the pull-only constraint in SPEC-027** (the inter-session mailbox) - #2209: no
   transport that starts a turn in an idle session, and an optional urgency field that
   mirrors FR-3.
3. **Re-measure the automated-wake share** - #2208: on the full corpus with `origin.kind`
   and `origin.from`, resolving the M8 conflict (23-26% vs 57%), with a stated rule on
   whether a relayed founder instruction counts as automated.
4. **Diagnose the short-gap rewrites** - #2207 (M13: 10.8% of rewrite tokens after a gap of
   an hour or less).
5. **Ship the guard to adopter repositories as its own spec** - #2210, only if DQ-7 chooses
   it: template registry, generated hook templates, validator Rule 12 (generated-template
   staleness), the enumeration pin, generalising `claude-settings.ts` beyond one hook, a
   `.minspec/` gate, and a persistent opt-out.
6. **A comment on #1914** (the headless-marker issue) - posted there, noting that this spec
   honours its launcher marker as a skip, that the marker is the only way to close the
   `claude -p --resume` gap, and that Part B `block` waits on it or on a recorded absence of
   such launchers. A second comment there adds that Part A `enforce` now waits on the same
   condition (FR-7).

## Traceability

- **Triggered by:** #1922 (the cold-resume guard issue; triaged T3 (full spec cycle),
  specify phase only).
- **Parent design pass:** #1923 (session stop conditions), which lists #1922 as a slice. Its
  own open DR question concerns its Parts 1 and 2 and is not answered here; DQ-6 is this
  spec's own DR question.
- **Related specs:** SPEC-026 (session presence, not reused), SPEC-027 (inter-session
  mailbox; conforms, with its constraint handed over as Follow-up 2, #2209), SPEC-044
  (coordinated self-completing sessions; its Amendment A central driver).
- **Decisions:** DR-073 (the shipped-hook write contract; only relevant if shipped),
  DR-086 (autonomy as a second axis), DR-057 (owns `.minspec/queue/`).
- **Constitution:** invariant 1 (INV-5), invariant 2 (INV-7, FR-20), invariant 3 (INV-6);
  principles 4 (avoid nagging) and 8 (enforce, do not trust the model).
- **Prior art:** `.claude/hooks/session-title.py` (bounded tail read, fail open);
  `scripts/hooks/scope-check.sh` and #1914 (the defects FR-17 avoids).
