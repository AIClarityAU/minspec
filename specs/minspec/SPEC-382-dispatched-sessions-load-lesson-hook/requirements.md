---
id: SPEC-382
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute — the dev-time autonomous build/merge pipeline
aspects: [dispatch, lesson-hook, setting-sources, agent-context, coverage-proof]
relates_to: ["#3082", "#3086", SPEC-074]
implements: none
implements_reason: >-
  Specified, not built by this dispatch. A partial fix already merged (#3086, commit d851c7442)
  covering only the in-repo launcher and only ten lessons; the remaining requirements are unbuilt.
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-382: Dispatched agent sessions load the lesson hook (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers *Decisions needed (Clarify)*, and approves it before code changes.

Issue: #3082 (bug: dispatched agent sessions never load the lesson hook).

## Problem

Launchers start Claude with `--setting-sources project,local` (`scripts/lib/agent-context.sh`, the
`MINSPEC_AGENT_SETTING_SOURCES` default), which omits the user settings where the global
`~/.claude/hooks/lesson-hook.py` PreToolUse hook is wired. Runner job `lhs-pilot-1025`
(2026-10-25) measured 0 of 155 trigger events for the ten pilot lessons delivered in dispatched
sessions; the 97% delivery figure from the 2026-10-18 shadow run came from primary-checkout
sessions only.

## Current state (verified against the tree, not the issue)

- `scripts/lib/agent-context.sh` already appends an inline `--settings` JSON carrying the hook,
  limited by `LESSON_ONLY=<ten filenames>`, with kill-switch `MINSPEC_LESSON_HOOK=off`, skipped
  when the hook file is absent or `user` scope is restored (landed by #3086). Test:
  `packages/minspec/tests/lesson-hook-wiring.test.ts`.
- NOT covered: the host-owned `~/.claude/scripts/cos-runner/cos-runner-job.sh:269` (outside this
  repo); the `LESSON_ONLY` allowlist means the other lessons still never reach dispatched
  sessions; the archived-lesson defect (hook takes text from `MEMORY.md`, `lesson-hook.py:123-129`)
  is separate and out of this repo; no end-to-end proof that delivery now works in a real dispatched
  session (the pilot's coverage proof, >95% of triggers, PREREG PC1-PC3).

## Functional requirements

- **FR1.** Every in-repo launcher that passes `--setting-sources` without `user` MUST also receive the
  lesson hook via `AGENT_CONTEXT_ARGS`; a launcher that builds its own `--settings` MUST merge the hook
  entry (a second `--settings` replaces the first).
- **FR2.** The hook wiring MUST NOT load any other user-level setting (no widening to `user` scope).
- **FR3.** The wiring MUST be a no-op when the hook file is absent, so CI and adopters are unaffected,
  and MUST be switchable off with `MINSPEC_LESSON_HOOK=off`.
- **FR4.** A mechanical test MUST fail if a new in-repo launcher uses `--setting-sources` without the
  agent-context library (enforce, don't trust).
- **FR5.** A delivery check MUST run a dispatched-shaped session and observe at least one pilot
  trigger delivered, producing the evidence the pilot's coverage proof consumes. A missing or errored
  hook MUST be visible in that check (constitution invariant 2: no silent gate).
- **FR6.** The host-owned runner launcher (`cos-runner-job.sh`) is outside this repo; this spec
  records the same requirement for it as a hand-off, not a change here.

## Acceptance criteria

1. With the hook file present, `AGENT_CONTEXT_ARGS` contains `--settings` with a PreToolUse hook entry
   and `--setting-sources project,local` (existing test, kept green).
2. With `MINSPEC_LESSON_HOOK=off`, or the hook file absent, or `user` in the sources: no `--settings`.
3. FR4 test: grep of `scripts/` finds no `--setting-sources` outside `agent-context.sh`.
4. FR5: delivery-check output names trigger count and delivered count for a dispatched session.

## Invariants the change must not break

- Invariant 1 (offline): the hook is a local Python script; no network call is added.
- Invariant 2 (no silent gate): hook absence in a context that expects it fails visibly.
- Invariant 3 (blast radius): behaviour changes only for dispatched sessions of this repo, gated by the
  hook file's presence; nothing is written to user-global config.

## Decisions needed (Clarify)

1. **Scope of lessons delivered.** (a) Keep the ten-lesson `LESSON_ONLY` allowlist **(rec)** — keeps the
   pilot's control arm intact; cost: the other lessons stay undelivered to dispatched sessions.
   (b) Drop `LESSON_ONLY` after the pilot — full coverage; cost: more injected tokens per session
   (tenet 2) and the pilot's control comparison is lost.
   **Recorded selection: the recommended option,** (a), keep the ten-lesson `LESSON_ONLY` allowlist. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
2. **Inline `--settings` vs. a project `.claude/settings.json` hook entry.** Inline **(rec)** (already
   built; no hook in checked-in config for adopters of this repo's `.claude/`); cost: a launcher with its
   own `--settings` must remember to merge. Project entry is visible in the repo but fires for
   interactive sessions too, double-delivering with the user-level hook.
   **Recorded selection: the recommended option,** inline `--settings`. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
3. **Close #3082 on this spec's FR1-FR5, or keep it open for FR6?** Rec: close, file the host handoff
   separately; cost: the runner gap is tracked only by that handoff issue.
   **Recorded selection: the recommended option,** close #3082 on FR1-FR5 and file the host handoff separately. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.

## Follow-ups (tracked)

- Archived lessons go silent (hook reads `MEMORY.md`): host-side, `PROPOSED-lesson-hook.diff` in the
  pilot folder; tracked by #3082's pilot, not this repo.
