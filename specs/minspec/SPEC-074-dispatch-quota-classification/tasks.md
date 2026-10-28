---
id: SPEC-074
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-074 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline
relates_to: [SPEC-044, DR-063, DR-086, "#1347", "#1656", "#2233", "#2251", "#2421", "#3274"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-074 - Tasks

The order below is the order of work. Each task is one pull request, ends with the full
suite green, and names the requirement IDs it satisfies, the files it touches and the test
that proves it. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md), which no task edits.

Every backticked path in this file is a file a task edits or creates. Files a task only
reads are named in prose. Paths not in requirements.md's `implements:`/`affects:` are
listed with their reason in design.md, *Files*.

Shared rules for every task:

- The spec's test file is `packages/minspec/tests/dispatch-quota-classification.test.ts`.
  Task 1 creates it; each later task adds one `describe` block named for its task.
- Every positive assertion has a control in the same test that can go red (design.md,
  *Testing*). A #2233 shape is always paired with the same text plus the genuine wall.
- Shell functions are tested by running them, never by matching their source text, except
  where a task says a source assertion is the point (absence of a copy, AC-6).
- No comment between a `\` and its continuation line in any edited shell command
  (`dispatch-issue.sh`'s completion-path note says why).
- Run `npx vitest run packages/minspec/tests/dispatch-quota-classification.test.ts`, the
  tests named in the task, then the whole suite, `npm run lint`, `npm run typecheck` and
  `npm run validate` before calling a task done.

## 1 - One matcher, in its own library (FR-1, FR-6, INV-3, AC-6 first half)

- [ ] **1.1** `scripts/lib/quota-notice.sh` (new) - move `drain-inbox.sh:612-651` here byte
  for byte: `_quota_notice_forms`, `QUOTA_NOTICE_RE`, `quota_notice_lines`, `is_quota`, and
  the explanatory comment above them (anchor, fence pairing, honest limit). It defines and
  runs nothing else. Header comment: who sources it (drain, dispatcher) and that a widening
  happens here (INV-3).
- [ ] **1.2** `scripts/drain-inbox.sh` - replace the moved block with
  `source "${SCRIPT_DIR}/lib/quota-notice.sh"` (with the `# shellcheck source=` line the
  file's other sources carry), and rewrite the "departs from SPEC-074" paragraph at
  `:590-599` to say the dispatcher shares this matcher through the library. Commit trailer
  `Closes #2251`. Nothing else in the drain changes.
- [ ] **1.3** Test, block "the matcher has one home": across every file under `scripts/`,
  the definitions `_quota_notice_forms=(` and `QUOTA_NOTICE_RE=` each occur in exactly one
  file, and that file is `scripts/lib/quota-notice.sh` (assert the count is 1, so a renamed
  definition that matches 0 fails). Then source the library in bash and check
  `quota_notice_lines` against `drain-inbox.sh --is-quota` on every file in
  `tests/fixtures/drain-quota-signal/`: the same verdict from both.
  *Done when:* this block and `drain-continuous.test.ts` (its #2233 block unedited) are
  green.

## 2 - The countermand list, and the two lists that follow it (FR-3, AC-5, INV-2)

Lands before the label is ever written, so no issue can carry it while the gate ignores it.

- [ ] **2.1** `scripts/dispatch-ready-check.sh` - add `agent-blocked-quota` to the
  `for gate in` list (`:685`) and one line to the comment above it naming #1656 and
  SPEC-074.
- [ ] **2.2** `scripts/approve-issue.sh` - add `agent-blocked-quota` to `CLEAR_LABELS`
  (`:274`) and to the singly-retried list (`:281`), with one comment line giving the same
  reason the file gives for `agent-escalated`.
- [ ] **2.3** `scripts/triage-inbox.sh` - add `agent-blocked-quota` to `SUPERSEDED` for
  `agent-ready` and `agent-ready-specify` (`:288-289`), and to the comment above them.
- [ ] **2.4** `packages/minspec/tests/label-lifecycle.test.ts` - add `agent-blocked-quota`
  to the stamp list in the #1347 loop.
- [ ] **2.5** Test, block "AC-5": the real `dispatch-ready-check.sh` given labels
  `agent-ready,agent-blocked-quota` refuses with `[countermanded]` naming the label;
  control, `agent-ready` alone refuses for some other reason or admits, never
  `[countermanded]`. Build the call the way `label-lifecycle.test.ts`'s `readyCheck` does.
  *Done when:* this block, `label-lifecycle.test.ts` and
  `approve-issue-countermanding-labels.test.ts` are green.

## 3 - The dispatcher's pure functions (FR-1, FR-2, FR-4, AC-3, AC-4, AC-6 second half)

- [ ] **3.1** `scripts/dispatch-issue.sh` - source `lib/quota-notice.sh` beside the other
  libraries (`:184-226`), and add `crash_class`, `quota_reset_iso` and
  `quota_blocked_comment` next to `escalate_next_action`, as design.md D2 and D4 define
  them. Each closes with a lone `}` at column 0 so the test can extract it. Each exits 0 on
  every input; `crash_class` answers `crash` on an unreadable log. Not called yet.
- [ ] **3.2** Test, block "classification": extract the three functions plus the library
  into a bash process and run them.
  - AC-3: `crash_class` is `crash` for each #2233 capture, prose with `quota` and
    `too many requests`, the wall line inside a closed fence, and the wall line indented
    four spaces; each control (the same text plus the #1785 wall at column 0) is `quota`.
    An absent log path is `crash`.
  - AC-4: with a fixed `now`, `quota_reset_iso` on the #1785 wall equals
    `parseResetInstant` run directly on that line; on the AC-1 wall plus a prose line
    `resets in 25 minutes`, fed only the notice lines `quota_notice_lines` selects, it still
    equals the wall's instant; on bare `You've hit your session limit` it is empty, exit 0;
    with `GUARD` pointing at a missing file it is empty, exit 0.
  - `quota_blocked_comment` with an instant prints it, and with none prints
    `reset time not stated in the CLI output`; both print the notice line indented.
  - AC-6: `crash_class` agrees with `drain-inbox.sh --is-quota` on every case above;
    `dispatch-issue.sh` contains no `isQuotaExhaustion` and no `_quota_notice_forms`.
  *Done when:* the block is green.

## 4 - The quota branch in the crash path (FR-3, FR-4, FR-5, AC-1, AC-2, AC-3, INV-1, INV-2)

- [ ] **4.1** `packages/minspec/tests/helpers/agent-launch-harness.ts` - two additive
  stub features, defaults unchanged so every current caller behaves as before: the `claude`
  stub exits with the code in `launch-exit.N` after printing `agent-out.txt` when that file
  exists (prose then a crash, which `launch-fail.N` cannot stage); the `gh` stub appends
  the `--add-label` and `--remove-label` values of each `issue edit` to `issue-edits.log`,
  exposed on `Recorded` as `issueEdits`. Say both in the file's header comment.
- [ ] **4.2** `scripts/dispatch-issue.sh` - add `hold_quota_blocked` beside
  `quarantine_publish` and `hold_specify_scope`, and splice it into the crash `else`
  (`:2794-2810`) as design.md D3 shows. Today's crash write and its #1307 comment move
  into the inner `else` unchanged.
- [ ] **4.3** Test, block "the crash path, run for real" (`runDispatch`):
  - AC-1: stub prints the #1785 wall and exits 1. `issueEdits` adds `agent-blocked-quota`
    and removes `agent-running,agent-ready`; no edit adds `agent-escalated`,
    `needs-human-review` or `agent-ready`; one posted comment contains the D4 heading and
    the parsed reset. Stdout carries `Agent QUOTA-BLOCKED`.
  - AC-3: stub prints prose with `too many requests` and exits 1. Labels are
    `agent-escalated,needs-human-review`, `agent-ready` removed. Control: the same prose
    plus the wall gives AC-1's labels.
  - AC-2: stub prints `ESCALATE: fixture` and exits 0 on both starts. Two launches, the
    second with `--model opus`; final edit adds `agent-escalated,needs-human-review`.
  - Escalation then wall: start 0 prints `ESCALATE: fixture`, exit 0; start 1 prints the
    wall, exit 1. Final labels are AC-1's.
  *Done when:* this block, `dispatch-escalate-retry.test.ts`, `dispatch-outcome-status.test.ts`
  and every other test that uses `agent-launch-harness.ts` are green.

## 5 - The drain still pauses on a real dispatch (FR-6, AC-7)

- [ ] **5.1** Test, block "AC-7": run the real drain once (`runOnce` from
  `helpers/drain-harness.ts`, set up the way `drain-quota-signal-loop.test.ts` stages a
  dispatch) with `MINSPEC_DRAIN_DISPATCH` pointing at a generated wrapper that execs the
  real `dispatch-issue.sh` inside a `dispatchSandbox` whose `claude` prints the #1785 wall
  and exits 1. Assert the cycle took its quota pause (the drain's own pause log line or
  recorded cause, whichever `drain-quota-signal-loop.test.ts` reads), and the dispatcher
  wrote `agent-blocked-quota`. Control: the same run with prose that mentions
  `too many requests` and no wall takes no quota pause. Do not assert the sleep length.
  If the two harnesses cannot be composed without editing the drain, stop and escalate:
  feeding the drain a captured string does not satisfy AC-7.
  *Done when:* the block is green with its control.
