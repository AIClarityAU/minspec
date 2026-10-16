---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - a measured dispatch-health signal instead of a hand-derived one
aspects: [dispatch, observability, thrash, circuit-breaker, read-only, offline, no-silent-gate]
depends_on: [SPEC-062]  # SPEC-062 owns the autonomous drain whose breaker this spec re-keys
relates_to: [SPEC-073, SPEC-074, SPEC-078, "#1238", "#912", "#1203", "#1202", "#1050"]
implements: [scripts/thrash.ts, scripts/lib/thrash.ts, tests/thrash.test.ts]
affects: [scripts/drain-inbox.sh, package.json]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Dispatch thrash oracle (`npm run thrash`) and a rate-keyed breaker

Issue: #1238 (harden(detect): no thrash metric). Related: #912, #1203 (the breaker's origin), #1202, #1050 (`npm run facts`, the model for this tool).

## Scope sentence

A read-only command reports the context-thrash rate of recent dispatched-agent runs from their transcripts, and the drain's autocompact breaker additionally trips on that rate, so a 30-40% failure mode is visible and acts without waiting for a total outage.

## Problem

The only detector is `_breaker_decide` in `scripts/drain-inbox.sh` (about line 382): "the last N completions were all thrash" (default N=3). It is a tripwire for near-total outage. A steady ~32% thrash rate never produces three in a row often enough to trip it, so it ran for weeks. Nothing answers "what is the rate now, is it rising, did the fix help, what filled the context". The analysis was re-derived by hand five times and two false root causes survived because of it.

## Functional requirements

- **FR-1 Command.** `npm run thrash` (script `scripts/thrash.ts`, wired in `package.json` beside `facts`) prints a thrash report from the dispatched-agent transcripts. No flags are needed to answer "is dispatch healthy?": the default prints the headline rate and a verdict line.
- **FR-2 Source.** Transcripts are read from `~/.claude/projects/-tmp-minspec-agent-issue-*/*.jsonl` by default; a `--dir <glob-root>` option and `MINSPEC_THRASH_TRANSCRIPTS` override it (tests use fixtures). Runs are ordered by transcript start time.
- **FR-3 Thrash definition.** A run is *thrashed* iff its transcript carries the same signature the drain greps for (`MINSPEC_DISPATCH_AUTOCOMPACT_SIG`, default `Autocompact is thrashing`). The oracle and the breaker MUST share one definition: the signature constant lives in one place and both read it.
- **FR-4 Rate.** Report thrash rate over the last N runs (`--runs N`, default 50) and over a time window (`--since <duration>`, default 24h), each as `thrashed/total` and a percentage, plus the rate for the preceding equal span so a rise is visible.
- **FR-5 Per-run detail** (`--per-run`): run id (issue number from the directory name), thrashed yes/no, compact count, roster bytes (size of the system/agent-roster content injected at start), the largest tool results (top 3, tool name and bytes), and the biggest repeated payload (identical content seen more than once, bytes times repeats).
- **FR-6 Top consumers.** Aggregate across the selected runs the top context consumers by category (roster, tool-result by tool name, repeated payload), ranked by bytes and by share of thrashed runs' context, so the next cause is visible without forensics.
- **FR-7 Read-only, offline.** The command never writes to a transcript, makes no network call, and spawns no agent. Tests assert the transcript directory is byte-identical before and after.
- **FR-8 Fail visibly.** An unreadable or unparseable transcript is counted and listed in the report ("N transcripts skipped: reasons"), never silently dropped. Zero readable transcripts is a non-zero exit with an explicit message, not a 0% rate (an empty set is not a healthy one).
- **FR-9 Verdict and exit code.** The report ends with `HEALTHY` or `DEGRADED` against the rate threshold of FR-10, and `--check` exits non-zero on `DEGRADED`, so the same verdict can gate a script.
- **FR-10 Rate-keyed breaker.** `_breaker_decide` gains a second trip condition: over the last W completions (default 20) with at least M recorded (default 10, so a small sample cannot trip it), if thrashed/W exceeds R (default 25%), the verdict is `halt`. The existing "last N all thrash" condition is kept unchanged. Environment knobs follow the existing `MINSPEC_DRAIN_*` naming; `0` disables the rate condition independently of the consecutive one. The drain already holds the per-completion outcomes csv, so the rate path needs no transcript read.
- **FR-11 Breaker message.** A rate halt names the rate, window and threshold in the drain log and points at `npm run thrash`, so the operator goes straight to the oracle.
- **FR-12 Pure and tested.** The rate computation is a pure function in `scripts/lib/thrash.ts` (given parsed runs, returns the report data). Both the shell breaker rule and the TypeScript rate share fixtures that include a 32% sequence with no three-in-a-row, which must trip the rate path and not the consecutive path.

## Acceptance criteria

- AC-1 One command, `npm run thrash`, prints the rate and a verdict with no hand-written analysis.
- AC-2 A fixture of 100 runs with 32 thrashed and never three consecutive reports `DEGRADED`; `_breaker_decide` on the same outcomes returns `halt` via the rate path, and returns `continue` on the old rule alone (proves the blind spot is closed).
- AC-3 A fixture with 5 of 100 thrashed reports `HEALTHY`.
- AC-4 Fewer than M completions never trip the rate path.
- AC-5 Empty or all-unreadable transcript set exits non-zero with a message.
- AC-6 Transcript fixtures are unchanged after a run (FR-7).
- AC-7 A mutated threshold or an off-by-one in the window fails a test (the fixtures sit just above and just below R).

## Invariants this must not break

- Constitution invariant 1 (offline): no network call.
- Invariant 2 (no silent gate): skipped transcripts are reported, empty input fails closed, the new breaker condition halts visibly and is not wrapped in `|| true`. The oracle is a second witness to the breaker, since it reads transcripts independently of the drain's outcome list.
- Invariant 3 (blast radius): all changes live in this repo's `scripts/`; nothing is shipped to adopters.
- The existing consecutive-N breaker semantics (including the `halt=0` disable and width-1 equivalence) are unchanged.

## Out of scope

Fixing any particular cause of thrash (#912, #1203, #1202); a dashboard or persisted history store; changing the thrash signature itself.

## Decisions needed (Clarify)

1. **Breaker default threshold.** Options: (a) rate > 25% over the last 20 completions, min 10 **(rec)** since it would have caught the 32% baseline; cost: a bad streak of three thrashes in ten completions is already 30% and could halt a drain over normal noise, wasting a cycle. (b) 40% over 20, fewer false halts but the issue's own 32% baseline would still hide. (c) report-only, no breaker change; cheapest, but leaves the blind spot that motivated the issue.
2. **How the oracle knows "roster bytes" and "compact count".** Transcript format is not a stable contract. Options: (a) parse best-effort and show `n/a` for fields not found, listing the count of runs lacking them **(rec)**, resilient but a format change degrades the detail quietly (the rate itself stays correct, as it keys only on the signature); (b) fail on unknown format, loud but brittle.
3. **Spec number.** SPEC-137 was the next unused id on this branch's base; open PRs are not visible offline, so confirm it does not collide.
