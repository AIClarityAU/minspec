---
id: SPEC-077
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-077 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination
relates_to: [SPEC-026, SPEC-027, DR-073, DR-086, "#1922", "#1914"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-077 - Tasks

The order below is the order of work. Each task is one pull request, ends with the full
suite green, and names the requirement IDs it satisfies, the acceptance criteria it proves,
the files it touches and the test that proves it. The plan is [design.md](design.md); the
contract is [requirements.md](requirements.md), which no task edits.

Every backticked path in this file is a file a task edits or creates. Files a task only
reads are named in prose. All four paths are in requirements.md's `implements:` or
`affects:`; no task touches any other file.

Shared rules for every task:

- **Strictly sequential.** Every task edits `scripts/hooks/cold-resume.py` and
  `packages/minspec/tests/cold-resume-hook.test.ts`, so never start one before the previous
  one has merged.
- **Machinery.** Every owned path starts with `scripts/`, so each pull request is review
  machinery (`MACHINERY_PATH_RE`, ai-review-guard.js): it merges by human `--admin` or by
  the bot under DR-112 (bot merges of machinery pull requests), never on ai-review alone.
- Tests run the real wrapper as a subprocess through the `runHook` helper (design.md,
  *Testing*). They never grep the hook's source, except AC-24's static allowlist.
- Every new check has a negative control in the same test that shows it can go red.
- No mode default changes: the committed registration stays `--part-a observe --part-b
  warn`. Switching to `enforce` or `block` is a later reviewed commit gated by FR-7 and
  FR-10, not a task here.
- Before calling a task done, run
  `npx vitest run packages/minspec/tests/cold-resume-hook.test.ts`, then the whole suite,
  `npm run lint`, `npm run typecheck`, `npm run validate`, and `npx tsc --noEmit` on the
  test file with the package's compiler options (tests/ is in no tsconfig `include`).
- The hook's Python imports stay inside the AC-24 allowlist from task 1; adding a module to
  it is a reviewed change to that test, never a quiet edit.

## 1 - Wrapper, state-store resolution and the boundary pins (FR-17, FR-18 python3 clause, INV-5, INV-6; AC-24, AC-25, AC-22 last clause)

- [ ] **1.1** `scripts/hooks/cold-resume.sh` - the wrapper exactly as design.md, *The
  wrapper*: `.minspec/` check, `python3`-missing `systemMessage` for `prompt` only, `exec
  python3 -I` with the subcommand and arguments; builtins only.
- [ ] **1.2** `scripts/hooks/cold-resume.py` - entry point parsing the subcommand and mode
  arguments, `resolve_common_dir(project_dir)` (directory, `gitdir:` file, `commondir`),
  `state_root()`, the atomic-write helper, and a `prompt` that reads its envelope, resolves
  the store and exits 0 with no output. Unknown subcommand or bad mode: exit 0, no output.
- [ ] **1.3** `packages/minspec/tests/cold-resume-hook.test.ts` - the shared helpers
  (`makeRepo` with plain, no-`.minspec/` and linked-worktree variants; `runHook`;
  `stateDir`) and the tests: AC-24 (import allowlist `json os sys time signal hashlib uuid
  re datetime errno`, no `subprocess`/`socket`/`urllib`/`http`; wrapper has no `curl wget gh
  nc ssh git`; controls: a planted `import subprocess` and a planted `git` line each fail
  the check, run on a copied string); AC-25 (empty `HOME` stays empty; envelope `cwd` in a
  second repo leaves its `.git` unchanged; no `.minspec/` writes nothing anywhere; the
  linked worktree resolves to the main repo's common directory; `template-registry.ts` and
  `claude-settings.ts` contain no `cold-resume`); AC-22's `python3`-absent clause (a `PATH`
  holding only a directory with a `bash` symlink: exit 0, a `systemMessage`, no
  `additionalContext`, no `decision`).
  *Done when:* those tests are green and each control is red.

## 2 - The read-only core: transcript reader, cold predicate, classifier, proven interactive (FR-13, FR-14 classes 1-4 and 6, FR-15, FR-3 test; AC-1, AC-2, AC-3, AC-4, AC-6, AC-23)

- [ ] **2.1** `scripts/hooks/cold-resume.py` - `read_records`, `cold_state`, `classify`
  (without the `scheduled` arm), `is_urgent`, `proven_interactive` with the `meta.json`
  cache, the `MINSPEC_HEADLESS_AGENT=1` early exit, the `MINSPEC_COLD_RESUME_NOW` clock, and
  the `explain` subcommand printing the JSON in design.md, *The command line of the hook*.
  `prompt` still emits nothing.
- [ ] **2.2** `packages/minspec/tests/cold-resume-hook.test.ts` - record builders and
  `trailing()` from design.md, *Testing*, and AC-1, AC-2 (including the block-record case),
  AC-3, AC-4, AC-23 (a >8 MiB transcript: same verdict as its tail, inside the budget), and
  AC-6 through `explain` plus `prompt` (all-`sdk` session: `interactive: false` and empty
  `prompt` output; marker set: empty output and no write). Also `is_urgent` cases from
  AC-10 via `explain`'s `would` field.
  *Done when:* green, with a control per predicate edge (one second either side, 149,999
  vs 150,000, sidechain vs main chain).

## 3 - Cost estimate and Part B `warn` (FR-8, FR-11, FR-16, FR-10 fire log; AC-17, AC-21)

- [ ] **3.1** `scripts/hooks/cold-resume.py` - the price table and `estimate(ctx, P, H,
  model, tier)` (clamp, label, unknown model), the warning text, the once-per-episode
  `warned` set in `meta.json`, the `fire` and `episode-prompt` log lines (append only;
  rotation comes in task 4), and the `prompt` output object with `systemMessage`.
- [ ] **3.2** `packages/minspec/tests/cold-resume-hook.test.ts` - AC-17 (content, no
  handoff-note request, second prompt in the episode silent, fire logged with
  `prompt_id` and `text_hash`) and AC-21 ($3.30 and $2.90 on `claude-opus-5`; a grid over
  `ctx`, `P`, `H` where the saving never exceeds the rewrite and vanishes when not positive;
  every dollar figure labelled; unknown model has no `$`).
  *Done when:* green; control: a saving above the rewrite in a hand-built output fails the
  grid check.

## 4 - The visible-failure path, counters and log rotation (FR-17 counters, FR-18; AC-22 except its mode clauses)

- [ ] **4.1** `scripts/hooks/cold-resume.py` - the 5-second budget (`signal.alarm` plus
  deadline checks), the single top-level handler that exits 0 with no decision, the
  once-per-session-per-kind visible line (`systemMessage` plus the relay
  `additionalContext` while design.md's P2 row is not `passed`), log-only in a session not
  proven interactive, the per-day counter, failed-write counting, rotation at 2 MiB keeping
  5 files with `rotation.json`, and `MINSPEC_COLD_RESUME_OFF=1` skipping every decision.
  The test-only budget override `MINSPEC_COLD_RESUME_BUDGET_MS` named in design.md, *The
  command line of the hook*.
- [ ] **4.2** `packages/minspec/tests/cold-resume-hook.test.ts` - AC-22: truncated tail
  line and exhausted budget each give exit 0, no block, one visible line the first time and
  none the second; the same in an `sdk` session prints nothing and logs; the counter
  increments per run; rotation keeps 5 files and records `dropped_through`;
  `MINSPEC_COLD_RESUME_OFF=1` with nothing parked prints nothing.
  *Done when:* green; control: removing the once-per-kind record makes the second-line
  assertion fail.

## 5 - Scheduled class, Part A `observe`, and registration (FR-14 class 5, FR-19, FR-7 log, FR-4; AC-5, AC-11 observe half, AC-16 first half, AC-26, AC-22 Stop clause)

- [ ] **5.1** `scripts/hooks/cold-resume.py` - the `stop` subcommand (records
  `session_crons` prompts; always exit 0, never a `decision`), the `scheduled` arm of
  `classify` (cron equality, the `… [+N chars]` prefix rule, the transcript
  `<command-name>`/`<command-args>` rebuild), and Part A `observe`: `would-defer` lines for
  `peer`, `notice` and `task` in a cold interactive session, with `sender` and `body300`.
- [ ] **5.2** `.claude/settings.json` - add `cold-resume.sh prompt --part-a observe
  --part-b warn` to `UserPromptSubmit` after the two existing entries, and a new `Stop` key
  with `cold-resume.sh stop`, both as `bash "$CLAUDE_PROJECT_DIR/scripts/hooks/cold-resume.sh" ...`.
  The `SessionEnd` registration waits for task 9. Edit as text, never by parse-and-dump,
  so no other byte of the file changes.
- [ ] **5.3** `packages/minspec/tests/cold-resume-hook.test.ts` - AC-5, the AC-22 `Stop`
  clause (malformed envelope: exit 0, no `decision`), AC-16's observe half (prompt passes
  unchanged, one log line), AC-11 for `observe` (human, scheduled and continuation never
  logged as would-defer; task logged by class), and AC-26 for the two entries added here
  (command paths, modes `observe` and `warn`, no `SessionStart` entry for this hook).
  *Done when:* green; `git diff .claude/settings.json` shows only the added lines.

## 6 - Custody and `enforce` deferral (FR-1, FR-2, FR-3, FR-4; AC-7, AC-8, AC-9, AC-10, AC-11 enforce half)

- [ ] **6.1** `scripts/hooks/cold-resume.py` - the custody record (design.md, *State
  store*), write-then-block ordering, the block reason (class, sender, idle time, "will be
  delivered with this session's next turn that runs"), the 100-file cap, the
  `custody-failed` path that delivers instead, and `deferred` and `cap` log lines.
- [ ] **6.2** `packages/minspec/tests/cold-resume-hook.test.ts` - AC-7 (byte-identical
  parked text before the block; a second message in the same episode, with the block
  record in the tail, also deferred), AC-8 (read-only store directory: no block, one visible
  line), AC-9, AC-10, AC-11 under `--part-a enforce`.
  *Done when:* green; control: swapping write and block order is caught by a test that
  makes the write fail after a block would have been printed.

## 7 - Delivery and confirmation at the next turn that runs (FR-5, FR-19 every-mode clause; AC-12, AC-13, AC-22 mode clauses)

- [ ] **7.1** `scripts/hooks/cold-resume.py` - `deliver` (move to `delivered/`, mint a
  delivery id per injection, header first, arrival order, 10,000-character cap with 2,000
  reserved, truncation with the absolute path and `truncated: true`), `confirmed()` per
  design.md, *Delivery and its confirmation*, release on confirmation, re-injection of
  unconfirmed records, nothing injected into a blocked prompt, and delivery running under
  every mode and under `MINSPEC_COLD_RESUME_OFF=1`.
- [ ] **7.2** `packages/minspec/tests/cold-resume-hook.test.ts` - AC-12 (including the
  synthetic-only and missing-attachment re-delivery cases; its `block` case is task 12's),
  AC-13, and AC-22's mode clauses
  (`OFF` with a message parked delivers it and does nothing else; Part A `off` still
  delivers). The attachment fixture is the shape quoted in design.md.
  *Done when:* green; control: an attachment carrying a different delivery id does not
  confirm.

## 8 - The 24-hour sweep and report (FR-6 path 1; AC-14)

- [ ] **8.1** `scripts/hooks/cold-resume.py` - the sweep and report in design.md, *Report
  and sweep*: confirm-then-release across sessions with the 5-transcript cap, the report
  record and id, the one-hour repeat, confirmation requiring a human-origin carrying record,
  report-record cleanup, and the restriction to `human` prompts in interactive sessions.
- [ ] **8.2** `packages/minspec/tests/cold-resume-hook.test.ts` - every bullet of AC-14,
  plus the AC-6 clause about another session's old message (an `sdk` session gets no
  report).
  *Done when:* green; control: a carrying record with `turnOrigin: "sdk"` leaves the
  report unconfirmed.

## 9 - Carry-over across `/clear` (FR-6 path 2, FR-19 SessionEnd; AC-15, AC-26 SessionEnd clause)

Blocked until design.md's P4 row reads `passed`. If P4 fails, this task is not built and
AC-15 is removed by an amendment to requirements.md, which is a fresh approval and so not
this task's to make.

- [ ] **9.1** `scripts/hooks/cold-resume.py` - the `/proc` link key, the `session-end`
  subcommand (writes the carry-over record, prints nothing), and the first-prompt move by
  rename with the one-hour freshness limit.
- [ ] **9.2** `.claude/settings.json` - a `SessionEnd` entry with `"matcher": "clear"` and
  `"timeout": 10` running `cold-resume.sh session-end`, beside the existing `session-end.sh`
  entry, which keeps its default. Text edit only.
- [ ] **9.3** `packages/minspec/tests/cold-resume-hook.test.ts` - AC-15 (the key comes
  from `/proc`: two runs spawned directly by the test share the test process as their
  ancestor and so one key; S3 is spawned through an intermediate `node -e` child, which
  gives it a different key), and
  AC-26's `SessionEnd` clause.
  *Done when:* green; control: a different link key leaves the message in the old store.

## 10 - Part A audit and the shared completeness check (FR-7 audit, FR-20; AC-16 second half, AC-20)

- [ ] **10.1** `scripts/hooks/cold-resume.py` - `audit --part a`: covered span, rotation,
  counters, the transcript-replay second witness, per-class counts and next-record
  cache-creation tokens, failed deferrals after `enforce`, and a `not enough data` verdict
  on any gap.
- [ ] **10.2** `packages/minspec/tests/cold-resume-hook.test.ts` - AC-16's audit half and
  all five AC-20 fixtures for Part A.
  *Done when:* green; control: each AC-20 fixture with its defect removed returns a
  complete verdict.

## 11 - Part B audit and the stored verdict (FR-10; AC-19, AC-20 for Part B)

- [ ] **11.1** `scripts/hooks/cold-resume.py` - `audit --part b`: the FR-10 definitions as
  design.md, *Audits*, lists them; resend attribution for blocked fires by episode, hash and
  `prompt_id`; unattributed blocks with `body300` and `--mark-human`; the before and after
  verdict rules including sticky `revert to warn`; reading P2 and P5 from design.md's probe
  table; writing `verdict-b.json` atomically.
- [ ] **11.2** `packages/minspec/tests/cold-resume-hook.test.ts` - every case in AC-19,
  and the five AC-20 fixtures run for Part B before and after block mode.
  *Done when:* green; control: 30 determinable fires at precision 0.95 with P2 `not run`
  returns no switch-on verdict.

## 12 - Part B `block`, gated on a fresh verdict (FR-9, FR-10 hook-side suspension, AC-27 fallbacks; AC-18)

- [ ] **12.1** `scripts/hooks/cold-resume.py` - under `--part-b block`, block the first
  `human` prompt of a cold episode only while `verdict-b.json` allows it and is under 7
  days old, and only when the tail shows no `/loop`, `ScheduleWakeup`, `CronCreate` or
  `/goal` use not covered by a `passed` P3 row; otherwise warn with the suspension line.
  Later prompts in the episode pass; classes other than `human` are never blocked.
- [ ] **12.2** `packages/minspec/tests/cold-resume-hook.test.ts` - every case in AC-18,
  and the `block` case of AC-12 (blocked prompt gets nothing; messages stay parked until
  the resend passes).
  *Done when:* green; control: a verdict dated 8 days ago suspends block mode.

## Not tasks here

- **The probes (AC-27, P1 to P4) and P5.** Manual, in VS Code, recorded by editing
  design.md's *Probe record* table. None is needed for the defaults; P4 unblocks task 9,
  and the others gate the mode switches.
- **Switching Part A to `enforce` or Part B to `block`.** A one-line reviewed commit to
  `.claude/settings.json`, allowed only when FR-7 or FR-10 says so.
