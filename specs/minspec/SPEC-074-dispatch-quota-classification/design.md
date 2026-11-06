---
id: SPEC-074
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-074 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous build/merge pipeline
relates_to: [SPEC-044, SPEC-062, DR-063, DR-084, DR-076, DR-086, "#1656", "#2233", "#2237", "#2239", "#2251", "#2421", "#2423", "#3274"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-074 - Design: one CLI-notice matcher, two readers

Plan for [requirements.md](requirements.md). That file is the contract; this one says how
to build it. Citations of "today" are against `origin/main` at `00f9ce35`, the commit this
plan was written on. The line numbers requirements.md cites for `dispatch-issue.sh` were
already wrong when it merged (#2423 tracks that), so the table below gives the current
ones. New code is named by symbol, because its line numbers will move.

## Approach in one paragraph

Move the drain's CLI-notice matcher (the pattern list, the compiled regex, the fence
filter and `is_quota`) out of `scripts/drain-inbox.sh` into one new sourced library,
`scripts/lib/quota-notice.sh`, which the drain and the dispatcher both source. The drain's
behaviour and its `--is-quota` seam do not change. The dispatcher gains three pure
functions over that library (classify a crash log, recover the reset instant from the
matched lines only, render the issue comment) and one side-effecting function that writes
the `agent-blocked-quota` outcome. That function is spliced into the top of the existing
crash `else`, ahead of today's `agent-escalated,needs-human-review` write, which stays as
the fallback. The countermand list gains the new label, and the two scripts that must stay
aligned with that list (re-triage and approve-issue) gain it too, so a human who re-triages
after the reset is not vetoed forever. Every behaviour is tested by running the real
scripts with stub `gh` and `claude`, using the harness the dispatch tests already share.

## What the plan relies on (read at 00f9ce35)

| Fact | Where |
|---|---|
| The launch, its `tee "$LOG"` and `set -euo pipefail` | `dispatch-issue.sh:2321-2327`; `:18`. With `pipefail`, a non-zero `claude` exit reaches the crash `else` even though `tee` succeeds |
| `$LOG` | `dispatch-issue.sh:1470` (`${WORKTREE}/.agent.log`), overwritten by each loop iteration, so it holds only the latest run |
| The `ESCALATE:` branch and its final label write | `:2328-2359`; the pure decision `escalate_next_action` at `:2243` |
| The crash `else` (#1307) | `:2794-2810`; the loop's `break` at `:2815` |
| The CLI-notice matcher | `drain-inbox.sh:612-651` (`_quota_notice_forms`, `QUOTA_NOTICE_RE`, `quota_notice_lines`, `is_quota`); the comment above it at `:590-611` says it "departs from SPEC-074" (#2251) |
| Its readers in the drain | `classify_dispatch` at `drain-inbox.sh:1995-1999`; the `--is-quota` seam at `:3501-3504` |
| The drain's reset parse | `quota_publish_wall` at `drain-inbox.sh:3204-3230`: `node -e` requiring `parseResetInstant` from `$GUARD` (`drain-inbox.sh:189`, `.github/scripts/ai-review-guard.js`), any failure read as "no reset time" |
| Libraries the dispatcher already sources | `dispatch-issue.sh:184-226`, `:878-880`, all as `source "${SCRIPT_DIR}/lib/<name>.sh"` |
| The countermand list | `dispatch-ready-check.sh:685` (`for gate in ...`), comment at `:666-684` |
| Lists held aligned with it | `approve-issue.sh:274` and `:281` (`CLEAR_LABELS`), pinned to the countermand list by `approve-issue-countermanding-labels.test.ts`; `triage-inbox.sh:288-289` (`SUPERSEDED`), pinned by the #1347 block in `label-lifecycle.test.ts:283` |
| The reported wall reached the crash path | `packages/minspec/tests/fixtures/drain-quota-signal/1785-dispatch-capture-0733.txt:12-14`: the wall line, then `Agent CRASHED on issue #1785`. So the CLI exited non-zero on that wall |
| The #2233 fixtures | `packages/minspec/tests/fixtures/drain-quota-signal/` (three false-pause captures, the #1785 agent log and capture) |
| A real-dispatcher harness | `runDispatch` and `dispatchSandbox` in `packages/minspec/tests/helpers/agent-launch-harness.ts:673`, `:773`: the real script top to bottom with stub `gh`/`claude`, claim won. The `claude` stub can fail a start (`launch-fail.N`, stderr, exit 1) but cannot yet print prose and then fail; the `gh` stub logs a write's verb, not its labels |
| A real-drain harness | `runOnce` in `packages/minspec/tests/helpers/drain-harness.ts:489`; the drain honours `MINSPEC_DRAIN_DISPATCH` (`drain-inbox.sh:206`) |

## Decisions

### D1 - The matcher moves to `scripts/lib/quota-notice.sh` (FR-1, FR-2, INV-3, AC-6)

FR-1 leaves the Plan two ways in: the drain's seam, or one shared `scripts/lib` file. FR-2
then needs the *matched lines*, not a yes/no, so the seam alone does not serve.

- **Chosen: the shared library.** `scripts/lib/quota-notice.sh` holds the block now at
  `drain-inbox.sh:612-651`, moved byte for byte: `_quota_notice_forms`, `QUOTA_NOTICE_RE`,
  `quota_notice_lines`, `is_quota`, and the comment that explains the anchor, the fence
  pairing and the honest limit. It defines functions and one variable and runs nothing.
  `drain-inbox.sh` sources it where the matcher stood, so every name its callers use
  (`classify_dispatch`, `--is-quota`) is unchanged and what the matcher matches is
  unchanged (FR-6). The "departs from SPEC-074" comment is rewritten to say the dispatcher
  now shares this matcher, which closes #2251.
- **Rejected: a sibling seam on the drain** (`drain-inbox.sh --quota-notice-lines`). Each
  dispatch crash would start a 3,700-line script that sources `gh-bot.sh` and
  `agent-worktree.sh` and runs its top-level setup just to grep a log, and the dispatcher
  would depend on the drain's argument parser staying stable. Cost of the chosen option:
  one more file to source, and a drain that now reads its matcher from somewhere else.
- **Rejected: a copy of the patterns in the dispatcher.** INV-3 forbids it.

The drain's run directory is a full checkout reset to `origin/main`
(`drain-inbox.sh:992`), so `scripts/lib/` travels with it. No change to the run-dir
provisioning is needed.

### D2 - Three pure functions in the dispatcher (FR-1, FR-2, FR-4)

Next to `escalate_next_action`, in the same "pure, unit-tested" style, each extractable
from the script by the `^name\(\) \{ ... ^\}` pattern `dispatch-escalate-retry.test.ts`
already uses:

- `crash_class <log-path>` echoes `quota` when `quota_notice_lines < "$log"` finds a line,
  else `crash`. It always exits 0: an unreadable log is `crash`, which keeps today's human
  hold, so a classifier failure can never lower the gate (INV-1).
- `quota_reset_iso <now-ms>` reads the matched notice lines on stdin and echoes the ISO
  instant `parseResetInstant` returns, or nothing. It calls node the way
  `quota_publish_wall` does (`require(process.env.GUARD)`, `GUARD` set to
  `${SCRIPT_DIR}/../.github/scripts/ai-review-guard.js`), and any failure (no node, no
  file, a throw, `null`) is an empty answer with exit 0. Only the notice lines go in,
  never the whole `$LOG` (FR-2).
- `quota_blocked_comment <iso-or-empty>` reads the notice lines on stdin and prints the
  issue comment (D4).

### D3 - The splice (FR-3, FR-5, INV-2)

The crash `else` becomes:

```bash
else
  if [[ "$(crash_class "$LOG")" == "quota" ]]; then
    hold_quota_blocked
  else
    # #1307 comment, unchanged
    gh issue edit ... --add-label "agent-escalated,needs-human-review" ...   # unchanged
    echo "Agent CRASHED ..."                                                 # unchanged
  fi
fi
```

`hold_quota_blocked` (side effects, beside the other `hold_*`/`quarantine_*` writers):
creates the label best-effort (`gh label create agent-blocked-quota`, as the neighbouring
writers create theirs), then runs
`gh issue edit --remove-label "agent-running,agent-ready" --add-label "agent-blocked-quota"`,
then posts the D4 comment, then prints one stdout line. Each of the two writes ends
`|| echo "WARNING: ..." >&2` rather than a bare `|| true`, so a failed write is visible in
the drain's capture (INV-1, constitution invariant 2). It never adds `needs-human-review`
and never adds `agent-ready`. The comment rule from the completion path applies: no
comment between a `\` and its continuation line.

The `ESCALATE:` branch is not touched. It is reached only when the pipeline exits 0, the
crash `else` only when it does not, so an opus retry that hits the wall lands in the quota
branch on its own iteration with a fresh `$LOG`.

The stdout line (`Agent QUOTA-BLOCKED on issue #N ... Review: $LOG`) starts with `Agent`
and so can never match a notice form at column 0. The CLI's own line still reaches the
drain through `tee "$LOG"` untouched: nothing here prefixes, indents or fences it (FR-6,
AC-7).

### D4 - The comment (FR-4, AC-4)

```
## ⏸ Not built - provider quota exhausted

This issue was not dispatched to completion: the Claude CLI reported a usage limit, so the
build agent stopped before doing any work. Nothing needs reviewing.

The CLI said:
    <each matched notice line, indented four spaces>

Reset: <ISO instant> (parsed from the line above)
   or: reset time not stated in the CLI output

Labelled `agent-blocked-quota` (not `agent-escalated`), and `agent-ready` removed so the
queue does not retry it blindly. After the reset, re-triage it (`scripts/triage-inbox.sh N`):
that clears this label and makes it dispatchable again.
```

The notice lines are indented, so the comment is legible as a quote; it goes to GitHub,
not to stdout, so it cannot reach the drain's matcher either way. The release instruction
is true only after D5's re-triage change, which is why D5 lands first.

### D5 - The countermand list and the two lists aligned with it (FR-3, AC-5)

`agent-blocked-quota` joins the `for gate in` list at `dispatch-ready-check.sh:685` with a
comment line naming #1656 and SPEC-074. Two other files must follow, though
requirements.md's `affects:` does not name them, because without them the change breaks a
standing test or strands the issue:

- `approve-issue.sh` `CLEAR_LABELS` and its retry loop. `approve-issue-countermanding-labels.test.ts`
  fails if that list and the countermand list differ by anything except
  `agent-quarantined`. A human approving the issue is that human having looked, which is
  the same reason the file gives for clearing `agent-escalated`.
- `triage-inbox.sh` `SUPERSEDED` for `agent-ready` and `agent-ready-specify`. Without it a
  re-triage after the reset leaves the label on, and the gate refuses
  `[countermanded]` forever, which is the #1347 class (`label-lifecycle.test.ts:283`).
  This is a human or triage-driven re-ready, not the bounded auto-reconsideration DQ-1
  split out to #2421.

Rejected: leave those two files alone and tell the human in the comment to remove the
label by hand first. Cost of that: the existing alignment test goes red, and the release
step grows back to two manual edits, the step #1656 set out to remove.

## Not in this plan

- Re-dispatching after the reset on its own: DQ-1, split to #2421.
- The creator-shepherd's fix agent (`shepherd_fix`, `dispatch-issue.sh:2032-2038`): DQ-2.
- A wall on which the CLI exits 0. Not observed: the reported case (#1785) exited non-zero
  and reached the crash path (table above). If one does, the run takes the publish path,
  which FR-1 does not cover; no task here changes that.
- The drain's own detection, backoff and meter check (FR-6): untouched beyond D1's move.

## Files

| File | Task | Why |
|---|---|---|
| `scripts/lib/quota-notice.sh` (new) | 1 | D1 |
| `scripts/drain-inbox.sh` | 1 | D1: source the library, remove the moved block, rewrite the #2251 comment. In `affects:` |
| `scripts/dispatch-ready-check.sh` | 2 | D5. In `affects:` |
| `scripts/approve-issue.sh` | 2 | D5; not in `affects:`, kept aligned by its existing test |
| `scripts/triage-inbox.sh` | 2 | D5; not in `affects:`, #1347 alignment |
| `packages/minspec/tests/label-lifecycle.test.ts` | 2 | D5: add the new label to the #1347 loop |
| `scripts/dispatch-issue.sh` | 3, 4 | D2, D3. In `affects:` |
| `packages/minspec/tests/helpers/agent-launch-harness.ts` | 4 | Two additive stub features (see task 4); not in `affects:`, test-only |
| `packages/minspec/tests/dispatch-quota-classification.test.ts` (new) | 1-5 | The spec's own test (`implements:`) |

## Testing

All in `packages/minspec/tests/dispatch-quota-classification.test.ts` unless stated, one
`describe` block per task. Every positive case has a control that can go red: a #2233
shape with the genuine wall appended must classify as quota, so a matcher that matches
nothing cannot pass (the pattern of `drain-continuous.test.ts:161`). CI runs `npx vitest`,
not `npm test`, so nothing relies on a `pretest` step. `drain-continuous.test.ts`'s #2233
block is not edited and must stay green through task 1; it is the proof that the move
changed nothing the drain matches.

| AC | How it is observed |
|---|---|
| AC-1 | Task 4: `runDispatch` with the stub `claude` printing the #1785 wall and exiting 1; the recorded `issue edit` adds `agent-blocked-quota`, removes `agent-ready`, and no write adds `agent-escalated`, `needs-human-review` or `agent-ready` |
| AC-2 | Task 4: `runDispatch` with the stub printing `ESCALATE: x` and exiting 0 on both starts; two launches, the second `--model opus`, final labels `agent-escalated,needs-human-review`. `dispatch-escalate-retry.test.ts` stays green |
| AC-3 | Task 3 (pure `crash_class` over each #2233 fixture, a fenced wall, an indented wall, prose saying `quota` and `too many requests`, each with its wall-appended control) and task 4 (one prose-only crash through `runDispatch` ends `agent-escalated,needs-human-review`) |
| AC-4 | Task 3: `quota_reset_iso` with a fixed `now`, comparing against `parseResetInstant` run directly on the wall line alone; the wall plus prose `resets in 25 minutes` gives the wall's instant; the bare `You've hit your session limit` gives empty and a comment saying "reset time not stated". Task 4: the posted comment contains it |
| AC-5 | Task 2: the real `dispatch-ready-check.sh` refuses `[countermanded]` for `agent-ready,agent-blocked-quota`; control without the label does not refuse as countermanded |
| AC-6 | Task 1: the pattern list and `QUOTA_NOTICE_RE` are defined in exactly one file under `scripts/` (counted with the definition's own regex, and the count must be exactly 1, never 0). Task 3: `dispatch-issue.sh` contains no `isQuotaExhaustion`, sources `lib/quota-notice.sh`, and `crash_class` agrees with `drain-inbox.sh --is-quota` on every fixture |
| AC-7 | Task 5: the real drain (`runOnce`) with `MINSPEC_DRAIN_DISPATCH` pointing at a wrapper that runs the real dispatcher in a `dispatchSandbox` whose `claude` prints the wall; the cycle returns its quota pause. The sleep length is not asserted |
