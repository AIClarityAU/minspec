---
id: SPEC-077
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-077 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination
relates_to: [SPEC-026, SPEC-027, SPEC-044, DR-073, DR-086, DR-057, "#1922", "#1923", "#1914", "#2207", "#2208", "#2209", "#2210", "#2211"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-077 - Design: the cold-resume hook

Plan for [requirements.md](requirements.md), built under its recorded Clarify selections
(DQ-1 to DQ-8, all option A). The contract is that file; this one says how to build it.
Citations of "today" are against `origin/main` at `a799afcc`, the commit this plan was
written on. New code is named by symbol, because its line numbers will move. Where a fact
below was read from a transcript rather than a document, it says so, and the task that
relies on it pins it with a fixture.

## Approach in one paragraph

One Python module, `scripts/hooks/cold-resume.py`, behind a thin bash wrapper,
`scripts/hooks/cold-resume.sh`, the same split as `.claude/hooks/session-title.{sh,py}`. The
wrapper takes a subcommand (`prompt`, `stop`, `session-end`, `audit`, `explain`) and the two
committed modes as arguments, so the mode carrier is the hook's own registration line in
`.claude/settings.json` and every mode change is a reviewed commit there (FR-19). The module
is built from pure functions (transcript reader, cold predicate, classifier, cost estimate,
audit arithmetic) wrapped by a small side-effecting shell (state store, log, output). All
state lives under `<git common dir>/minspec/cold-resume/`, found from
`$CLAUDE_PROJECT_DIR` by reading files, never by running `git` (FR-17, INV-5). The tests in
`packages/minspec/tests/cold-resume-hook.test.ts` run the real wrapper as a subprocess
against a temporary git repository, a temporary `HOME` and synthetic transcripts built from
copied record shapes. The build order is a vertical slice that ends each step with a working
hook in the safe defaults: the read-only core and its `explain` view first, then Part B
`warn` and Part A `observe`, then registration, and only after that the custody, delivery,
report and audit machinery that `enforce` and `block` need. Switching either mode on is not
a task here: it is a later reviewed commit that FR-7 and FR-10 gate on audits and probes.

## What the plan relies on (read at a799afcc)

| Fact | Where |
|---|---|
| Wrapper-plus-module pattern, fail open on a missing `python3`, bounded 8 MiB tail read | `.claude/hooks/session-title.sh` (whole file); `MAX_TAIL_BYTES` and `read_tail` in `.claude/hooks/session-title.py:40`, `:68` |
| Existing `UserPromptSubmit` and `SessionEnd` registrations, each a `bash "$CLAUDE_PROJECT_DIR/..."` command; no `Stop` key today | `.claude/settings.json`, `hooks.UserPromptSubmit` (scope-check, session-title) and `hooks.SessionEnd` (session-end.sh) |
| Test-by-execution convention for hooks | `packages/minspec/tests/session-identity.test.ts`, `packages/minspec/tests/spec-gate.test.ts` |
| Test discovery | `vitest.config.*:29` includes `packages/*/tests/**/*.test.ts`; CI runs `npx vitest run`, so nothing may rely on a `pretest` step |
| Every file this spec owns is review machinery | `MACHINERY_PATH_RE` (`^scripts\/` among others), `.github/scripts/ai-review-guard.js:1162`, mirrored in `scripts/dispatch-issue.sh:302` |
| Spec gate owns `implements:`/`affects:` paths whether or not they exist yet | `owned_file_set` and its doc comment, `scripts/hooks/spec-gate.py:329-382` |

Transcript shapes, read from this machine's own transcripts on 2026-10-28 (observed, not
documented; each is pinned by a fixture in the task that relies on it):

- A main-chain injection is a record with `type: "attachment"`, `isSidechain: false`, and
  `attachment` = `{"type": "hook_additional_context", "content": [<string>, ...],
  "hookName": "UserPromptSubmit", "hookEvent": "UserPromptSubmit", "toolUseID": "hook-<uuid>"}`.
  It is written **before** the user record of the prompt that carried it, and that user
  record (and any `isMeta` user record expanded from it, such as a skill body) shares the
  same `promptId`.
- A typed prompt's user record carries `turnOrigin: "human"`, `origin: {"kind": "human"}`,
  `promptId`; a `-p` prompt's carries `turnOrigin: "sdk"` and no `origin`.
- An assistant record's `message.usage.cache_creation` holds `ephemeral_1h_input_tokens`
  and `ephemeral_5m_input_tokens`; the tier of a write is whichever is non-zero.

## Files

| File | Owned by | Role |
|---|---|---|
| `scripts/hooks/cold-resume.sh` | this spec (`implements:`) | wrapper: opt-in check, kill switch, `python3`-missing line, `exec python3` |
| `scripts/hooks/cold-resume.py` | this spec (`implements:`) | everything else |
| `packages/minspec/tests/cold-resume-hook.test.ts` | this spec (`implements:`) | every automated AC, by subprocess |
| `.claude/settings.json` | no spec (`affects:`) | three registrations, carrying the modes |

No other file changes. Nothing is added to `template-registry.ts`, the hook templates or
`claude-settings.ts` (FR-19, INV-6); AC-25's pin checks it. Because every owned path starts
with `scripts/`, each implementation pull request is review machinery: it merges by a human
`--admin` keystroke or by the bot under DR-112 (bot merges of machinery pull requests),
never on ai-review alone. That is a reason to keep the task count low where tasks share a
file; see *Build order*.

## The command line of the hook

```
cold-resume.sh prompt  --part-a <off|observe|enforce> --part-b <off|warn|block>   # UserPromptSubmit
cold-resume.sh stop                                                               # Stop
cold-resume.sh session-end                                                        # SessionEnd, matcher clear
cold-resume.sh audit   --part <a|b> --window-days <N> [--mark-human <prompt_id>...] # run by hand
cold-resume.sh explain                                                            # run by hand or by tests
```

- `prompt`, `stop` and `session-end` read the harness envelope on stdin. `audit` and
  `explain` are for people and tests; neither is registered.
- `explain` reads an envelope on stdin and prints one JSON object - `{class, interactive,
  cold, gap, ttl, ctx, episode_key, in_flight, model, would}` where `would` is the action
  `prompt` would take under the given modes - and writes nothing to the state store. It is
  how tests observe the pure core before any output path exists, and how a person debugs a
  verdict.
- A missing or unknown mode argument is an FR-18 error (`bad-mode`), which fails open: the
  run behaves as `observe`/`warn`, never stricter.
- The registered modes are `--part-a observe --part-b warn` (AC-26). `audit` reads the
  committed Part B mode by parsing the same registration line out of
  `$CLAUDE_PROJECT_DIR/.claude/settings.json` (a local file read).
- Test clock: when `MINSPEC_COLD_RESUME_NOW` holds an ISO-8601 instant, the module uses it
  as "now". It is the only seam, it can only move the cold verdict, and it is named here so
  a reviewer sees it. It is read only by the module, so a session cannot set it by accident
  through `settings.json`. `MINSPEC_COLD_RESUME_BUDGET_MS` likewise overrides the
  5-second budget, so a test can exhaust it (AC-22); it can only make the hook fail open
  sooner.

## The wrapper

In order, using only bash builtins and `python3` (AC-24 forbids `curl`, `wget`, `gh`, `nc`,
`ssh`, `git`; the wrapper also avoids `dirname` so that a `PATH` without `python3` still
works, by resolving `HERE` with `${BASH_SOURCE[0]%/*}`):

1. If `$CLAUDE_PROJECT_DIR` is set and has no `.minspec/` at its root, exit 0 with no
   output (FR-17, INV-6). An unset variable falls through to the module, which reports it
   as an FR-18 error.
2. If `python3` is not on `PATH`: for `prompt`, print `{"systemMessage": "cold-resume:
   python3 not found; the cold-resume guard is off for this session"}` and exit 0; for any
   other subcommand, print nothing. Never `additionalContext`, never a decision (FR-18,
   AC-22).
3. `exec python3 -I "$HERE/cold-resume.py" "$@"`. `-I` keeps the hook's own directory and
   the user's site-packages out of the import path.

`MINSPEC_COLD_RESUME_OFF=1` is handled in the module, not the wrapper, because the module
must still deliver and confirm parked messages when it is set (FR-18).

## State store (FR-17)

Resolution, with no subprocess: read `$CLAUDE_PROJECT_DIR/.git`. A directory is the common
directory. A file holding `gitdir: <path>` leads to a linked worktree's git directory; if
that directory holds a `commondir` file, its content (relative to that directory) names the
common directory. Anything else is the FR-18 error `no-common-dir`. Every path is made
absolute; nothing reads the envelope's `cwd`.

Root: `<common>/minspec/cold-resume/`. It sits beside the existing
`<common>/worktrees/<name>/minspec/` session-scope files, survives worktree removal, and is
never tracked.

```
cold-resume/
  sessions/<session_id>/
    meta.json            interactive flag, warned episode keys, error kinds already shown,
                         recorded cron prompts (from `stop`)
    parked/<arrival_ns>-<prompt_id>.json      FR-2 custody records
    delivered/<arrival_ns>-<prompt_id>.json   FR-5: same record plus delivery_id,
                                              injected_at, injected_transcript, injected_prompt_id
  reports/<report_id>.json      FR-6 report: emitted_at, prompt_id, transcript_path, covered message paths
  carryover/<link_key>.json     FR-6 path 2: old session_id, written_at
  log/events.jsonl              observe/warn log; rotated to events.<n>.jsonl
  log/rotation.json             {dropped_through: <ts>} - newest timestamp ever deleted by rotation
  counters/<YYYY-MM-DD>.json    {runs, failed_log_writes}
  verdict-b.json                latest Part B audit verdict and its date (FR-10)
```

- Every write is a temporary file in the same directory plus `os.replace`. A move between
  `parked/` and `delivered/`, and a carry-over move between session directories, is one
  `os.rename`; a `FileNotFoundError` means another run already moved it and is not an error.
  That is the whole concurrency story: prompts in one session are serial, and the only
  cross-session writers are the FR-6 sweep and carry-over, both of which act by rename.
- A custody record is `{"v": 1, "class", "arrived_at", "prompt_id", "session_id",
  "transcript_path", "sender", "prompt"}` with `prompt` the exact input string. AC-7 checks
  byte identity by comparing the parsed `prompt` with the input; the record is written with
  `ensure_ascii=False` so the file is also readable as text.
- Sender name: the `from` attribute of the `<cross-session-message ...>` opening tag when
  present, else `null`. Plan reads it from the tag only; a missing attribute is not an
  error.
- Cap: a session's `parked/` holds at most 100 files; the 101st message is delivered and
  logged as `cap` (FR-2, AC-9).

## Reading the transcript (FR-13)

`read_records(path)` opens the file, seeks to `size - 8 MiB` when larger, and drops the first
(possibly cut) line only when it seeked. Every other line must parse as JSON; one that does
not is the FR-18 error `transcript-parse` (AC-22's truncated tail line), which fails open.

`cold_state(records, now, session_id)` is pure:

1. Keep message records only: main-chain (`isSidechain` false) `assistant` records, and
   main-chain `user` records whose `message.content` holds a `tool_result` block. Every
   other record is ignored by construction (an allowlist, R9).
2. Deduplicate assistant records by `message.id`, keeping the copy with the largest
   `usage.output_tokens`, the later one on a tie, at the position of the kept copy.
3. Real = `message.model != "<synthetic>"`.
4. In flight: the latest kept message record (real or synthetic) is a `tool_result` user
   record, or an assistant record whose `stop_reason` is `tool_use` or absent.
5. From the last real assistant record: `gap = now - timestamp`, `ctx = input_tokens +
   cache_read_input_tokens + cache_creation_input_tokens`, `episode_key =
   f"{session_id}:{message.id}"`, `model = message.model`.
6. TTL: walk real records backwards to the first whose `usage.cache_creation` has a non-zero
   tier field; 300 when that is `ephemeral_5m_input_tokens` and the 1h field is zero, else
   3600 (also when none is found).
7. `cold = not in_flight and gap > ttl and ctx >= 150_000` (DQ-4). No real assistant record,
   an empty file or a missing file gives `cold = False` with no error.

Because the harness writes no user record for a blocked prompt and its `system` block record
is not a message record, an earlier deferral or block leaves the episode key unchanged
(AC-2, FR-9).

## Classifying a prompt (FR-14)

`classify(prompt, env, records, crons)` is pure and returns one of `peer`, `notice`,
`task`, `continuation`, `scheduled`, `human`, tested in that order on `prompt.strip()`:

| Class | Test |
|---|---|
| `peer` | starts with `<cross-session-message` |
| `notice` | starts with `[Cross-session ` (P1 confirms the hook-side prefix) |
| `task` | starts with `<task-notification>` |
| `continuation` | equals `env["CLAUDE_CODE_RESUME_PROMPT"]` when set and non-empty, else `Continue from where you left off.` |
| `scheduled` | equals a cron prompt recorded for this `session_id`; or the recorded prompt ends in `… [+N chars]` and the prompt starts with the text before that marker; or equals the prompt rebuilt from an earlier main-chain user record with `turnOrigin: "scheduled"` in the tail (`<command-name>` value, plus a space and `<command-args>` when present; or the plain text of a plain-text record; a record with neither contributes nothing) |
| `human` | anything else |

Prefix or equality only, never substring. The urgent marker (FR-3) is a separate pure test
on a `peer` prompt: strip the opening tag, then the first non-whitespace token of the body,
case-folded, equals `[urgent]`.

`stop` records crons: from the `Stop` envelope's `session_crons`, it stores each entry's
prompt text in that session's `meta.json`, replacing the previous list. It always exits 0
and never prints a `decision` field, even on a malformed envelope (FR-19, AC-22).

## Proven interactive (FR-15)

A session is proven when any earlier main-chain user record in the tail has
`turnOrigin == "human"` or `origin.kind == "human"`, or when `meta.json` already says so.
The first proof is written to `meta.json` and never unset. `MINSPEC_HEADLESS_AGENT=1` makes
`prompt` exit 0 with no output and no write before anything else is read (AC-6), in every
mode.

## What one `prompt` run does

The run starts a 5-second budget (`signal.alarm(5)` as the hard stop, plus a deadline the
loops check), and counts itself in today's counter. Then, in order:

1. Headless marker set: exit 0, no output.
2. Resolve the store (FR-17). Read the transcript, load `meta.json`, compute
   `interactive`, `cold_state`, and the class.
3. **Confirm own deliveries** (FR-5): for each record in this session's `delivered/`, apply
   the confirmation test below to its `injected_transcript`; release a confirmed one.
4. **Decide** (skipped entirely when `MINSPEC_COLD_RESUME_OFF=1`):
   - Part A: if the class is `peer` or `notice`, the session is interactive and cold, the
     message is not urgent, and the session has fewer than 100 parked: under `observe`, log
     `would-defer`; under `enforce`, write custody (step 5), then block. A `task` is logged
     `would-defer` under both modes (DQ-2) and passes.
   - Part B: if the class is `human`, the session is interactive and cold, and the episode
     key is not in `warned`: under `warn`, add the FR-8 warning and log a `fire`; under
     `block`, block when `verdict-b.json` holds `block may turn on` or `block may stay on`
     less than 7 days old and the tail shows none of `/loop`, `ScheduleWakeup`, `CronCreate`
     or `/goal` in use without a P3 record that covers it (AC-27 fallbacks); otherwise warn
     with the line "block mode is suspended: <reason>". Every later `human` prompt in the
     same episode is logged with its `prompt_id` and text hash (for FR-10 resend matching)
     and passes.
5. **Custody** (enforce only): write the custody record; on any failure do not block, log
   the error, and emit the FR-18 line `custody-failed` (AC-8).
6. If the run blocks: print `{"decision": "block", "reason": ...}` and stop. Nothing is
   injected into a blocked prompt (FR-5's last bullet). `suppressOriginalPrompt` is never
   set.
7. **Deliver** (FR-5), in every mode: move this session's `parked/` records to
   `delivered/` with a fresh delivery id, and re-inject every `delivered/` record still
   unconfirmed.
8. **Sweep and report** (FR-6 path 1), only for a `human` prompt in an interactive session:
   confirm-then-report over every session's store, below.
9. Print one JSON object with `systemMessage` (warning, report summary, error line) and
   `hookSpecificOutput.additionalContext` (delivery, report, error relay), each omitted when
   empty. Exit 0.

Any exception or the alarm, at any step, goes to the FR-18 path: exit 0, no decision, no
deferral, the error appended to the log (or counted as a failed write), and in an
interactive session one visible line per error kind per session (recorded in `meta.json`),
as a `systemMessage` plus, until P2 is recorded below, an `additionalContext` line asking
the model to relay it. A custody record already written stays: a parked copy of a prompt
that also passed is the accepted duplicate.

## Delivery and its confirmation (FR-5)

- Delivery id `crd-<12 hex>` from `uuid.uuid4()`. The injection starts with the header
  `[cold-resume delivery crd-...] <n> message(s) were held because this session's prompt
  cache was cold:` and then, per message in arrival order, `--- <class> from <sender> at
  <arrival time UTC> ---` and the body.
- The whole `additionalContext` stays under 10,000 characters. The delivery gets what is
  left after reserving 2,000 for the report and error lines. A body that does not fit is
  cut and followed by `[truncated; full text: <absolute path of its record>]`; such a record
  is flagged `truncated: true` and its file is never removed by the hook (AC-13).
- Confirmation test `confirmed(transcript, delivery_id, prompt_id)`: in the tail, find a
  main-chain `attachment` record with `attachment.type == "hook_additional_context"` whose
  `content` strings contain the delivery id; after it, the next main-chain message record
  that is not a user record with the stored `prompt_id` (the carrying prompt's own records
  share it) must be a real assistant record. A synthetic one, or another prompt's user
  record first, fails. A missing transcript fails.
- Released = the record file is deleted, unless it is `truncated`.
- Each injection, first or repeated, mints a new delivery id, and the record keeps every id
  it was injected under (with the `prompt_id` and transcript of each), so a late attachment
  of an older id still confirms it.

## Report and sweep (FR-6 path 1)

Defaults fixed by this plan: "old" means 24 hours after arrival; a report covers a message
for 1 hour unless confirmed; one run reads at most 5 foreign transcripts, oldest message
first, the rest wait for a later run.

1. For every `delivered/` record in any session older than 24 hours, within the transcript
   cap: apply the confirmation test to its `injected_transcript`; release if confirmed.
2. For every record still `parked/` or `delivered/` and older than 24 hours: skip it when a
   report covering it is confirmed, or was emitted less than an hour ago. Report the rest.
3. A report has id `crr-<12 hex>`, one line per message (class, sender, arrival time,
   state with last injection time when delivered, owning `session_id`, file path) and a
   count, sent as `systemMessage` and as `additionalContext` headed by the id. It is stored
   in `reports/` with the carrying `prompt_id` and transcript path.
4. A report is confirmed by the delivery test applied to its id, plus the carrying
   prompt's user record (matched by `prompt_id`) having human origin. A `-p --resume` run's
   record has `turnOrigin: "sdk"`, so it never confirms one (AC-14). A report record older
   than 7 days whose messages are all released is deleted.

## Carry-over across `/clear` (FR-6 path 2), gated on P4

`session-end` (matcher `clear`) writes `carryover/<link_key>.json` = `{old_session_id,
written_at}` and prints nothing. The first `prompt` of a session whose `sessions/` directory
does not exist yet computes its own link key, and if a carry-over record with that key
exists and is less than 1 hour old, renames each of the old session's `parked/` and
`delivered/` files into its own directories, then deletes the carry-over record.

Link key, chosen here and confirmed by P4: the identity of the Claude Code process that ran
the hook, `<pid>-<starttime>`, found by walking `/proc/<pid>/stat` parent links upward from
the hook process past every `bash`, `sh` and `python3` ancestor (field 22 of `stat` is the
start time, which makes a reused pid a different key). `/clear` keeps the same process, so
the old session's `session-end` and the new session's first `prompt` compute the same key; a
different window is a different process. No `/proc` (not Linux), or a walk that finds no
such ancestor, gives no key: no carry-over record is written, and path 1 reports the
messages instead. Rejected alternative: `~/.claude/sessions/<pid>.json`, undocumented, and a
read under `~/.claude` that INV-6 does not forbid but this plan has no need of.

If P4 finds that `/clear` in VS Code does not fire `SessionEnd`, or changes the process, task
9 is not built and AC-15 is removed by amendment, as FR-6 says.

## Logs, counters, rotation (FR-7, FR-10, FR-17, FR-20)

- `log/events.jsonl` lines: `{ts, kind, session_id, transcript_path, prompt_id, class,
  episode_key, gap, ctx, model, text_hash, sender, body300, mode_a, mode_b}`; `kind` is one
  of `would-defer`, `deferred`, `delivered`, `fire`, `episode-prompt`, `cap`, `error`.
  `text_hash` is SHA-256 of the stripped prompt; `body300` the first 300 characters (FR-7).
- Rotation at 2 MiB, keeping 5 files. Before deleting the oldest, its newest timestamp is
  written to `rotation.json` as `dropped_through` (kept as the maximum ever dropped).
- `counters/<UTC date>.json`: `runs` incremented at the start of every `prompt` run;
  `failed_log_writes` incremented when a log append fails. A failure to write the counter is
  itself swallowed (it is what the audit reads as "missing for a day").

## Cost (FR-11, FR-16)

A local table keyed by model id (a trailing `-YYYYMMDD` date is stripped before lookup):

| Model | Base input $/M | 1h write $/M | 5m write $/M |
|---|---|---|---|
| `claude-opus-5` | 5 | 10 | 6.25 |
| `claude-opus-5-5` | 4 | 8 | 5 |
| `claude-sonnet-5` | 2 | 4 | 2.5 |

`rewrite = ctx x write rate of the tier`; `saving = (ctx - P - H) x the same rate`, shown
only when positive and clamped to `rewrite`. `P` is the context of the first real main-chain
assistant record when it is in the tail, else 38,000 (M11); `H` is 2,000. AC-21's example:
330,000 on `claude-opus-5` gives $3.30 and a saving of $2.90. Dollar figures round to cents
and every one carries "estimated list-price equivalent; on a subscription this is drawn from
plan usage, not billed". An unknown model shows tokens only.

The warning text (FR-8): idle time, "this turn rewrites about <ctx> tokens", the estimate,
"next time `/clear` or a fresh session with a handoff note you write (or one written before
the session went idle) saves about <saving>", and "`/compact` is not cheaper on a cold
cache". It never suggests asking this session for a note.

## Audits (FR-7, FR-10, FR-20)

`audit --part a|b --window-days N` prints a human-readable report and, for Part B, writes
`verdict-b.json`. Both share one completeness check:

- **Covered span**: from the earliest retained log line (or `dropped_through` when later) to
  now; shorter than the window is incomplete. A `dropped_through` inside the window is
  incomplete.
- **Counters**: any `failed_log_writes > 0` in the window is incomplete; a day with no
  counter file on which a named transcript holds a prompt record is incomplete.
- **Second witness**: for every session named in the log, re-read its whole transcript (not
  just the tail; audits are not under the hook's budget), replay `cold_state` and `classify`
  at each main-chain user prompt record in the window using that record's timestamp as
  "now", and list the would-defer events (Part A) or fires (Part B) the log lacks. Any one is
  incomplete. Replay sees only records already on disk, so a replayed `scheduled` match uses
  only the transcript arm.

Part A reports, per class, the event count and the `cache_creation_input_tokens` of the
next real assistant record after each event, and after `enforce` lists each failed deferral
(a real assistant record between a deferral and its delivery).

Part B applies FR-10's definitions literally - determinable, true positive (`cache_read <
0.5 x prev ctx` and `cache_creation >= 0.3 x (prev ctx - cache_read)`), false positive,
misclassified (own record by `prompt_id`, else the first later non-tool-result user record;
`isMeta` always machine; no human evidence or no record = misclassified), blocked fires
attributed only through a same-episode, same-hash resend by `prompt_id`, unattributed
blocks listed with `body300` and counted misclassified unless named by `--mark-human` -
then the verdict:

- Before block mode (committed `--part-b` is not `block`): `block may turn on` only with a
  window of at least 7 days, at least 30 determinable fires, complete evidence, precision
  at least 0.95, zero misclassified, P2 passed (read from this file's *Probe record*, which
  the audit parses), and the resume gap closed (P5 below); else `not enough data` or `stay
  in warn` with the failing condition named.
- After: window from the previous verdict's end; `revert to warn` on any misclassified, on
  incomplete evidence, on at least 90% of at least 30 blocks resent, or when the previous
  stored verdict was `revert to warn` and this window does not meet every switch-on
  condition; else `block may stay on`.

## Probe record (AC-27)

Defaults (`observe`, `warn`) need none of these. They gate the mode switches and, for P4,
task 9. A probe is recorded by editing this table in a reviewed commit; the audit parses the
`Result` column for P2 and P5, and only the exact word `passed` counts.

| Probe | What it records | Result |
|---|---|---|
| P1 | A blocked cross-session message and notice in a cold VS Code recipient: what the sender sees; no assistant record or cache write follows; no re-delivery; last `message.id` unchanged; the notice's hook-side prefix | not run |
| P2 | In VS Code: block reason and `systemMessage` visible; blocked text restored to the input; episode key stable across a human-prompt block; the block record repeats the text with no origin label | not run |
| P3 | `/loop`, `CronCreate`, `ScheduleWakeup` in `session_crons`; text and `turnOrigin` of a self-paced `ScheduleWakeup` fire and a `/goal` check-in | not run |
| P4 | `/clear` in VS Code: `SessionEnd` fires with reason `clear`; new `session_id`; the link key above matches across it | not run |
| P5 | The `claude -p --resume` gap: #1914's marker landed and exported by every launcher, or a recorded grep of this repo and the chief-of-staff helper showing no `--resume` launcher | not run |

P5 is not one of AC-27's probes; it is FR-7 condition 4 and FR-10's resume-gap condition,
recorded in the same table so the audit can read it.

## Invariants, and how each is tested

| Invariant | Held by | Tested by |
|---|---|---|
| INV-1 machine prompts never blocked | Part B acts on class `human` only; audit fails closed | AC-18, AC-19 (task 11, 12) |
| INV-2 at-least-once | custody before block; rename-only moves; release only on confirmation; report sweep in every mode | AC-7 to AC-9, AC-12 to AC-15, AC-22 (tasks 6 to 9) |
| INV-3 explicit urgency | `is_urgent` prefix test | AC-10 (task 6) |
| INV-4 headless untouched | proven-interactive gate; marker exits first | AC-6, AC-14, AC-18 (tasks 2, 8, 12) |
| INV-5 offline | import allowlist; wrapper command list | AC-24 (task 1) |
| INV-6 blast radius | `.minspec/` check; common-dir store; no registry change | AC-25 (task 1) |
| INV-7 no silent gate | FR-18 path; FR-20 completeness | AC-20, AC-22 (tasks 4, 10, 11) |
| INV-8 never a wrong number | cost table, clamp, label | AC-17, AC-21 (task 3) |

## Testing

`packages/minspec/tests/cold-resume-hook.test.ts` holds every automated AC. Shared helpers
at its top (added in task 1, extended as tasks need them):

- `makeRepo()`: a temp directory with `git init` run by the **test** (the hook never runs
  git) and a `.minspec/` directory; also a variant without `.minspec/` and a linked worktree
  variant, so FR-17's `gitdir:`/`commondir` path is exercised.
- `runHook(sub, envelope, {env, args})`: spawns `bash scripts/hooks/cold-resume.sh` with
  `HOME` at an empty temp directory, `CLAUDE_PROJECT_DIR` at the fixture repo and
  `MINSPEC_COLD_RESUME_NOW` fixed; returns `{code, stdout, json}`.
- Record builders copied from the shapes in *What the plan relies on*: `assistant({id,
  model, stop, usage, ts, sidechain})`, `synthetic(...)`, `toolResult(...)`,
  `userPrompt({origin, promptId, isMeta})`, `scheduledCommand(name, args)`,
  `hookContext(text, ...)`, `blockRecord(text)`, and `trailing()` - the six-record sequence
  the AC preamble names.
- `stateDir(repo)` to read what the hook wrote.

Every new check carries a negative control in the same test. Each task runs
`npx vitest run packages/minspec/tests/cold-resume-hook.test.ts`, then the full suite,
`npm run lint`, `npm run typecheck` and `npm run validate`. The test file is under `tests/`,
which no tsconfig includes, so each task also runs `npx tsc --noEmit` on it with the
package's options.

## Build order

Every task edits the same two or three files, so the tasks are strictly sequential: no two
run in parallel. The order:

1. Wrapper, store resolution, opt-in, offline and blast-radius pins (no behaviour yet).
2. Reader, cold predicate, classifier classes 1-4 and 6, proven interactive, `explain`.
3. Cost and Part B `warn`, with the `fire` log.
4. FR-18 error path, counters, log rotation, budget.
5. `stop` and the scheduled class; Part A `observe`; registration in `.claude/settings.json`.
   After this task the hook is live in its defaults.
6. Custody and `enforce` deferral (reachable only by argument until a mode commit).
7. Delivery and confirmation.
8. Sweep and report.
9. Carry-over (after P4).
10. Part A audit and the shared completeness check.
11. Part B audit and `verdict-b.json`.
12. Part B `block`, gated on the verdict.

## Design decisions and the rejected alternatives

DR-086 §4 asks that options not taken stay on record.

- **Mode carrier: arguments on the registration line.** Rejected: a committed JSON file
  under `.minspec/` (a new path outside `implements:`/`affects:`, which would need a spec
  amendment and so a fresh approval); an `env` entry in `settings.json` (it leaks into every
  child process of the session, including headless runs it launches).
- **One Python module, not a package.** `implements:` names one `.py`; a helper module
  would be an unowned path. Size is managed by keeping pure functions separate and testing
  through `explain`.
- **Store under the git common directory.** Rejected: under `~/.claude` (INV-6); per
  checkout (the #1914 defect).
- **Link key from `/proc`.** Rejected: `~/.claude/sessions/<pid>.json` (undocumented
  format), and the transcript directory (shared by every session in the project).
- **Test clock by environment variable.** Rejected: relative-to-real-now fixtures, which
  make AC-1's one-second boundaries flaky on a loaded runner.

## Follow-ups (tracked)

None new. The spec's own follow-ups stand: #2211 (the chief-of-staff wake policy), #2209
(SPEC-027 pull-only constraint), #2208 (re-measure the automated-wake share), #2207 (the
short-gap rewrites), #2210 (ship to adopters), and the #1914 comments.
