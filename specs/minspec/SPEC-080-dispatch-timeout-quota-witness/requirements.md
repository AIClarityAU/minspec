---
id: SPEC-080
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute — the dev-time autonomous build/merge pipeline (dispatch-issue.sh's own crash-classification lives here)
aspects: [agent-dispatch, quota, timeout, labeling, no-silent-gate, tier-0]
relates_to: [SPEC-074, SPEC-078, DR-093, "#1670", "#1676", "#1713"]
implements: [packages/minspec/tests/dispatch-build-timeout-quota-witness.test.ts]  # NEW — the T3 regression test this spec owns
affects: [scripts/dispatch-issue.sh]  # dispatch-issue.sh is OWNED by SPEC-044 via implements: — this spec modifies its crash branch, never owns the file (INV: one owner per file, same discipline SPEC-074 already follows on this file).
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — A build-leg timeout with no log evidence must consult the quota meter before it is filed as a crash (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch
> that produced it. A human reads this spec, resolves the
> **[Decisions needed (Clarify)](#decisions-needed-clarify)** section, and approves it
> through the normal spec-approval gate before anything is built.

Materializes **#1713** — *"a quota-induced dispatch timeout is classified as a code
failure and can stop the drain."* Sibling of **SPEC-074** (#1656, "provider quota
exhaustion is recorded as agent-escalated") and **SPEC-078** (#2178, "ai-review-retry
declines to retry a quota-blocked PR whose run log contains the quota diagnostic") — all
three are instances of the same family (a genuine, time-bounded quota pause getting
mis-filed as a permanent, human-needed dead end), diagnosed and fixed at three different
producers in this repo's agent/review pipeline.

## One-Sentence Scope

When `scripts/dispatch-issue.sh`'s build leg (`claude -p`, wrapped in
`BUILD_TIMEOUT_ARGS`) is killed by its own wall-clock ceiling and the captured log
carries no quota diagnostic text at all, consult the independent quota-meter reading
(the same one `scripts/drain-inbox.sh`'s `quota_gate`/`quota_health` already read) as a
second witness before deciding the issue is a genuine crash, and never silently
misreport "no evidence either way" as "quota."

## Context

### What #1713 got right, verified against the code

`scripts/dispatch-issue.sh`'s build launch (`:1595-1600`) and its crash `else` branch
(`:2027-2043`) — current line numbers, condensed into one excerpt with the ~430 lines of
success-path handling between them elided — are:

```
if (cd "$WORKTREE" && "${BUILD_TIMEOUT_ARGS[@]}" "${AGENT_ENV_SCRUB[@]}" claude -p "$RUN_PROMPT" \
      ... --output-format text 2>&1 | tee "$LOG"); then
  ...
else
  # #1307 — a CRASH raises the human gate ...
  gh issue edit "$ISSUE" --repo "$REPO" \
    --remove-label "agent-running,agent-ready" --add-label "agent-escalated,needs-human-review" 2>/dev/null || true
fi
```

`BUILD_TIMEOUT_ARGS` (`:1575-1589`) wraps the launch in
`timeout --kill-after=30s "${BUILD_REMAINING}s"` whenever a claim-lease deadline is in
force. `set -o pipefail` is active (`dispatch-issue.sh:18`), so when `timeout` kills
`claude`, the `if` condition is false (the killed command's non-zero status — 124 on a
clean SIGTERM, 137 if `--kill-after`'s SIGKILL was needed — propagates through the pipe
even though `tee` itself exits 0), and the `else` branch above runs. That branch applies
the SAME label pair as any other unrecognised crash, with **no exit-code distinction
from an ordinary bug** (contrast `gate_status()`, `:1744-1766`, which already gives a
timed-out gate check its own `timeout` outcome, quoted verbatim in the issue). If the
CLI itself is ever waiting out a usage limit rather than erroring at it — the binary
strings the issue quotes, not yet observed firing in this repo's headless path — the
killed process emits no quota text at all, so even a future SPEC-074 (which classifies
`$LOG`'s *text*) has nothing to classify. This is the gap #1713 names, and it is real:
confirmed by reading the exact branch, not inferred.

### One correction to the issue's own causal chain (read from code, not carried over)

The issue's Context asserts the dead end propagates further: *"The cycle is then
counted as a generic cycle error... Three consecutive ones hit `MAX_CONSEC_FAIL`."*
Tracing that path in `scripts/drain-inbox.sh` does not bear it out as stated:

- `classify_dispatch` (`:1127-1145`) receives the dispatch's own exit code (`drc`) and
  only ever *logs* a warning when it is non-zero (`:1139`) — it does not feed `drc` into
  the thrash breaker, the quota verdict, or `run_cycle`'s return value. Those are driven
  solely by `$out` (the captured text) and the breaker's own state.
- `dispatch-issue.sh` has exactly one `exit 1` in its entire body (`:412`, an early
  argument-validation failure) and otherwise always falls through to the end of its
  `while true` loop, which has no trailing `exit`. The crash `else` branch (`:2027-2043`
  above) ends in a `gh issue edit ... || true` and an `echo`, both zero-status, so the
  script's own process exit code is **0** even on this path — matching
  `classify_dispatch`'s own comment (`:1125-1126`): *"dispatch-issue.sh exits 0 even on
  a quota-blocked claude run."*
- `run_cycle` (`:949-1285`) returns non-zero only from the `agent-ready` query failing
  (`:1039`, `return 1`) or a quota-text hit (`:1247`/`:1278`, `return 42`, which
  `run_loop` treats as a pause, never a failure, `:1724-1734`). A single dispatch's crash
  branch is not one of those.

So, as verified today, a build-leg timeout with no quota text does **not** itself drive
`run_loop`'s `consec` counter (`:1737`) or stop the drain via `MAX_CONSEC_FAIL`
(`:1739-1741`) — that specific downstream consequence in the issue's write-up is not
reproducible from the code as it stands, and this spec does not carry it forward as a
premise. **What the code does confirm, unchanged from the issue's core complaint:** the
*issue itself* still gets mislabeled `agent-escalated,needs-human-review` — a
human-needed dead end stamped on a condition that may be nothing but a closed quota
window — exactly the three-way collapse SPEC-074's Context describes for the
text-evidenced case, now for the text-*less* case. That mislabeling, not a drain-halting
side effect, is this spec's scope. (Per CLAUDE.md's Evidence Discipline: the `consec`
finding above is this spec's own read of the cited line ranges, not exhaustively proven
against every call path in a 2000-line file; Plan should re-check it before design
leans further on it.)

### The independent witness already exists and is exactly what the issue proposes reusing

`scripts/drain-inbox.sh` already maintains a quota **meter** independent of any single
dispatch's output text: `quota_gate()` (`:1417-1459`) and `quota_health()`
(`:1593-1615`) read `_quota_read()`'s `(percentage, resets_at, observed_at,
weekly_percentage, weekly_resets_at)` tuple from `$QUOTA_FILE`, admit/defer against
`QUOTA_ADMIT_PCT` / `QUOTA_ADMIT_PCT_7D`, and — load-bearing for this spec — **fail
closed on a stale or absent reading** rather than guessing (`:1431-1434`,
`:1606-1608`), the exact discipline DR-093 exists to state as policy after the 49-hour-
stale incident (#1859). This is the "consult the quota reading... before incrementing
MAX_CONSEC_FAIL" half of the issue's proposal, and it is a `drain-inbox.sh` concern, not
a `dispatch-issue.sh` one today — `dispatch-issue.sh` has no existing call into it.

## Functional Requirements

- **FR-1 (the build leg's own timeout is a distinct outcome, not a crash).** The build
  launch at `dispatch-issue.sh:1595` MUST capture its exit code in the `else` branch
  (`rc=$?` as the branch's first statement — safe under `set -e`, since nothing runs
  between the failed `if` condition and the `else` block) and classify `124`/`137` as
  `timeout`, distinct from any other non-zero code, mirroring `gate_status()`'s existing
  `case "$rc" in 0) pass;; 124|137) timeout;; *) fail;; esac` shape (`:1752-1765`)
  rather than inventing a second rule.
  *Rationale: reuse, not a parallel classifier — the exact discipline #1713 asks for.*

- **FR-2 (text evidence still wins, and is checked first).** On a `timeout` outcome,
  `$LOG` MUST still be checked for quota text using the same classifier SPEC-074
  specifies (`isQuotaExhaustion`, `.github/scripts/ai-review-guard.js`) — a killed
  process can still have printed a quota notice before it was terminated. A match takes
  whatever labeling path SPEC-074 defines (or, if SPEC-074 has not yet landed when this
  ships, this spec's own FR-4 fallback labeling — see DQ-2). This ordering means FR-3
  (the meter witness) only has to cover the case text evidence already ruled out, not
  duplicate it.

- **FR-3 (the meter is a second witness for the silent-wait case).** On a `timeout`
  outcome where FR-2 finds no quota text, `dispatch-issue.sh` MUST consult the same
  quota-meter reading `drain-inbox.sh`'s `quota_gate`/`quota_health` read (the shell
  functions MUST be sourced/reused from `drain-inbox.sh`, or factored into a shared
  helper both scripts source — never a second hand-maintained reader of `$QUOTA_FILE`,
  matching SPEC-074's INV-3 single-source-of-truth shape).
  - **Reuse the reader, not the admission gate.** The shared piece is `_quota_read()`
    (`drain-inbox.sh:1336`) plus the `QUOTA_STALE_SEC` freshness rule. `quota_gate()`
    itself MUST NOT be called for this diagnostic: it has side effects (it runs
    `_quota_try_refresh`, `:1419`, and on a missing reading it *consumes* a bootstrap
    admit and answers `open:bootstrap`, `:1421-1426`). A diagnostic read that spent
    the drain's bootstrap allowance, or read "open" as a verdict about the past, would
    be wrong in both directions.
  - **Two readings, both taken by `dispatch-issue.sh`.** A snapshot immediately before
    the launch (`build_start`) and one immediately after the timeout (`build_end`).
    A reading counts **only if it is fresh** (`now - observed_at <= QUOTA_STALE_SEC`
    at the moment it is taken).
  - **What counts as evidence (spent-window witness).** The fresh `build_end` reading
    shows the 5h window (`percentage`) or the 7d window (`weekly_percentage`) at or
    above the "spent" threshold DQ-4 fixes. That means the window is closed now, so the
    silent wait #1713 describes is the likeliest thing the build was doing when it was
    killed.
  - **Why the post-build `resets_at` alone cannot be the test.** Once a window resets,
    the next reading carries the NEXT reset time, so a fresh post-build reading can
    never show a `resets_at` that lies inside `[build_start, build_end]`. The case where
    the window closed *and reset again* during a long build is observable only through
    the `build_start` snapshot. Whether that case counts as evidence is DQ-4, not
    decided here.
  - A missing, stale, or inconclusive reading MUST NOT be treated as quota evidence.
    Absence of a meter reading is absence of evidence, never evidence of quota. This
    is the fail-closed shape DR-093 set for the admission gate, applied here to a
    diagnostic read instead of an admission decision.

- **FR-4 (labeling on an FR-3 match).** When FR-3 finds meter evidence, the issue MUST
  receive the quota-pause label (DQ-2 decides whether this is SPEC-074's
  `agent-blocked-quota` or a distinct label) in place of `agent-escalated`;
  `needs-human-review` MUST NOT be applied; `agent-running`/`agent-ready` MUST still be
  removed, unchanged from today's crash branch (preserving #1112's no-silent-requeue
  protection). A comment MUST be posted stating plainly that the build was killed by its
  own wall-clock ceiling with no diagnostic text, that the local quota meter showed the
  window spent when the build was killed, and the reading it was based on (which window,
  its percentage, its reset time, and how old the reading was)
  — so a human who does look never has to reverse-engineer the inference.

- **FR-5 (no match, no guess — today's behaviour is the honest fallback).** When FR-1
  finds a `timeout` but neither FR-2 nor FR-3 produces evidence, OR when the exit code is
  a non-timeout crash, the existing `else` branch behaviour (`agent-
  escalated,needs-human-review`, `:2040-2041`) is UNCHANGED. A ceiling hit with no
  witness of any kind is not proof of a code bug either — it is simply unclassifiable,
  and today's label is the correct honest default for "don't know," not a claim that
  needs correcting. *This is the constitution's no-silent-gate invariant applied in the
  other direction: guessing "quota" without a witness would be exactly as dishonest as
  guessing "crash" is today — this spec adds a witnessed third path, not a biased
  reclassification of the unwitnessed case.*

- **FR-6 (countermand list, if FR-4's label is new).** If DQ-2 resolves to a label not
  already in `scripts/dispatch-ready-check.sh`'s countermand list (`:635`), this spec
  MUST add it there, exactly as SPEC-074 FR-3 requires for `agent-blocked-quota` — a
  label that removes `agent-ready` but can be silently outvoted by a stale one repeats
  the #1068/#1112 bug that list exists to prevent.

- **FR-7 (ordering independence from SPEC-074).** This spec's FR-1/FR-3 MUST be
  implementable and correct regardless of whether SPEC-074 has shipped yet (see DQ-2)
  — FR-3 is a *meter* witness, wholly independent of SPEC-074's *text* classifier — but
  MUST collapse onto SPEC-074's taxonomy (shared label, shared countermand entry, shared
  comment shape) once both exist, never maintain two competing "this was quota" concepts
  long-term.

## Acceptance Criteria

- **AC-1 (FR-1, the timeout/crash split).** A stubbed build leg that `timeout` kills
  with SIGTERM (rc 124) and one that requires `--kill-after`'s SIGKILL (rc 137) both
  classify as `timeout`, not a generic crash. A stubbed build leg that exits 1 for an
  unrelated reason still classifies as a generic crash (unchanged).
- **AC-2 (FR-2, text still wins).** A `timeout`-classified run whose `$LOG` nonetheless
  contains a quota-notice line (printed before the kill) takes SPEC-074's path (or this
  spec's DQ-2 fallback), never FR-3's meter check and never the AC-4 generic-crash path.
- **AC-3 (FR-3, the reported case: the window is spent when the build is killed).**
  Fixture: a fresh `build_end` reading whose 5h `percentage` (and, as a separate case,
  whose `weekly_percentage`) is at or above the DQ-4 spent threshold; `$LOG` carries no
  quota text. Expected: the quota-pause label (FR-4), not
  `agent-escalated`/`needs-human-review`; `agent-ready` not restored.
- **AC-3b (FR-3, no side effects).** With no `$QUOTA_FILE` at all, the FR-3 read
  leaves the drain's bootstrap-allowance counter unchanged and never answers "open".
- **AC-4 (FR-3 negative, fail-closed — the DR-093 shape).** Same fixture, but
  `$QUOTA_FILE` is missing, unparseable, or older than `QUOTA_STALE_SEC`. Expected:
  today's unchanged `agent-escalated,needs-human-review` (FR-5) — never a quota label
  minted from an absent witness.
- **AC-5 (FR-3 negative, meter fresh but inconclusive).** Same fixture, but the fresh
  `build_end` reading shows both windows well below the spent threshold (and, unless DQ-4
  resolves to Option B, the `build_start` snapshot is ignored), so nothing shows the
  window was closed. Expected: `agent-escalated,needs-human-review` (FR-5) — a timeout with a healthy
  quota reading is still an unexplained crash, not a quota pause.
- **AC-6 (FR-4, legible).** On an AC-3 match, the posted comment names the reading used
  (percentage and/or reset time) and states plainly that no diagnostic text was present
  — distinguishable from SPEC-074's text-evidenced comment by a reader who wants to know
  which witness fired.
- **AC-7 (FR-6).** If DQ-2 introduces a new label, `dispatch-ready-check.sh` refuses to
  re-ready an issue carrying it while `agent-ready` is also stale-present, mirroring the
  existing rows.
- **AC-8 (no drift, FR-3's single-source rule).** A test fails if `dispatch-issue.sh`
  ever reads `$QUOTA_FILE` (or re-derives percentage/reset math) other than through the
  shared reader `drain-inbox.sh` already defines.
- **AC-9 (the issue's second acceptance line, pinned as a regression guard).** A drain
  cycle whose only dispatch is a build-leg timeout with no quota text returns from
  `run_cycle` with a status that `run_loop` does NOT count toward `MAX_CONSEC_FAIL`
  (today: 0, per the Context correction above). Three such cycles in a row do not stop the
  loop. This is already true by this spec's read of the code; the test exists so that any
  future change making `dispatch-issue.sh` exit non-zero on the FR-1 `timeout` path, or
  making `classify_dispatch` act on `drc`, cannot silently reintroduce the drain-stopping
  consequence #1713 describes.

## Invariants

- **INV-1 (constitution #2, no silent gate).** A timeout that reaches neither FR-3's
  positive case nor SPEC-074's text case stays exactly as visible as it is today
  (`agent-escalated,needs-human-review`) — this spec only adds a MORE correct label when
  it has independent evidence; it never removes or muffles the existing fallback
  signal. Constitution invariant 2's "independent second witness" clause is FR-3 itself:
  the meter is a second witness to the same event the log would otherwise be the sole
  producer of.
- **INV-2 (#1112, no silent requeue).** `agent-ready` is never restored by any path this
  spec adds or touches.
- **INV-3 (single source of truth).** No second reader/parser of `$QUOTA_FILE` may exist
  in `dispatch-issue.sh`; it calls into the same functions `drain-inbox.sh` already
  defines and tests, or both source a common helper. The same rule SPEC-074 states for
  the text classifier, applied here to the meter reader.
- **INV-4 (DR-093, fail-closed witness).** An absent or stale meter reading is read as
  "no evidence," never coerced into either a false positive ("must be quota") or used to
  suppress the existing honest-unknown fallback.
- **INV-5 (constitution #3, blast radius).** Dev-tooling only; no network call beyond
  what `dispatch-issue.sh` already makes (`gh`), no behaviour change outside this repo's
  own dispatch pipeline.

## Decisions needed (Clarify)

### DQ-1 (scope) — does FR-3's meter check also need to run for the `--decide`/gate-check timeout path, or only the build leg?

The issue names the build leg specifically (`:1373` in the issue's own numbering, the
`BUILD_TIMEOUT_ARGS` launch). `gate_status()` (`:1744-1766`) already reports `timeout`
distinctly and its caller (the post-build signals renderer) never turns a gate timeout
into `agent-escalated` — a gate timeout renders as `⚠️ UNVERIFIED` in the review-signals
block (#180/#256), not as a crash label. So the three-way collapse FR-1–FR-5 fixes does
not currently reach the gate-check path at all.

- **Option A — build leg only (rec).** Scope stays exactly what #1713 named. *Cost:*
  if a future change ever makes a gate-check timeout drive a crash label the way the
  build leg does today, that path would need its own, separate fix.
- **Option B — extend FR-3's meter witness to gate-check timeouts too**, on the theory
  that the same silent-quota-wait binary behaviour could someday affect `npm test`/
  `lint`/`build`/`validate` if any of them ever shelled out to a `claude`-backed tool.
  *Cost:* speculative — no current gate check invokes `claude`; widens this spec past
  the reported defect with nothing to fix today.

Recommendation: **Option A**, per this repo's own triage rule (detection ≠ integration;
don't silently expand). Revisit only if a gate check starts invoking an LLM CLI.

### DQ-2 (design) — which label does FR-4 apply, given SPEC-074 has not shipped yet?

SPEC-074 (status: `planning`, implement `pending`) proposes `agent-blocked-quota` for
its text-evidenced case. This spec's FR-3 is independent of SPEC-074 landing, but FR-4
needs a concrete label to ship with.

- **Option A — this spec mints `agent-blocked-quota` itself if SPEC-074 hasn't landed
  first, and SPEC-074 is updated (on whichever lands second) to reuse the existing label
  rather than mint a duplicate (rec).** *Cost:* whichever spec implements second must
  remember to check for the other's label before creating it — a small cross-spec
  coordination cost, flagged here so Plan/Tasks for both carries it forward rather than
  each independently creating the same label and silently duplicating GitHub's label
  registry.
- **Option B — this spec mints a distinct `agent-blocked-quota-timeout` label**, keeping
  the two evidentiary bases (text vs. meter) separately auditable forever. *Cost:* one
  more label for `dispatch-ready-check.sh`'s countermand list and for a human to learn;
  duplicates the "don't requeue, this is a self-healing wait" meaning SPEC-074 already
  carries, just split by which witness fired — a distinction useful for debugging THIS
  fix, of unclear value to a human triaging months later.

Recommendation: **Option A.** The two specs describe the same downstream state (issue
is paused on quota, not dead) reached by two different witnesses; collapsing them keeps
`dispatch-ready-check.sh`'s countermand list, the human-facing vocabulary, and any
future reconsideration logic (SPEC-074's own DQ-1) single-sourced. The label's technical
implementation is one `gh label create` call, revertible without cost either way.

### DQ-3 (design) — which launch does the `build_start` snapshot belong to?

FR-3's `build_start` snapshot (a timestamp plus a `_quota_read` result) must belong to a
specific launch. The build launch runs inside a `while true` loop that can run twice
(the DR-355 opus retry `continue`s back to it, `:1612`), and the FR-12 claim lease
(`:1571-1589`) measures from the CLAIM, not from this launch.

- **Option A — take the snapshot immediately before each pass's launch at `:1595`, so
  every launch overwrites it (rec).** *Cost:* one more clock read and one file read per
  launch; the snapshot is not persisted, so a crash of `dispatch-issue.sh` itself
  (as opposed to its `claude` child) leaves nothing to inspect.
- **Option B — derive the start time from the claim-lease bookkeeping** that already
  exists. *Cost:* it covers the WHOLE claim, including an earlier sonnet pass that
  escalated, so a quota event during that earlier pass would be credited to the opus
  launch that timed out. That is a looser bound than the evidence FR-4's comment
  claims to a human.

Recommendation: **Option A.** It is precise to the launch being classified, and the
extra read is negligible.

### DQ-4 (design) — what threshold means "spent", and does a window that closed then reset mid-build count?

FR-3's positive witness is a fresh `build_end` reading showing a window spent. Two
things need a human call:

1. **The threshold.** `QUOTA_ADMIT_PCT` / `QUOTA_ADMIT_PCT_7D` are *admission*
   ceilings, deliberately set below 100 so a cycle is not started near the wall.
   Reusing them as "spent" would call a 90%-used window a quota wall.
2. **The closed-then-reset case.** A build long enough to span a whole reset shows a
   healthy `build_end` reading even if it spent an hour silently waiting. Only the
   `build_start` snapshot can see that: its `resets_at` falls inside
   `[build_start, build_end]` and its percentage was already high.

- **Option A — "spent" means `>= 100` on either window at `build_end`; the
  closed-then-reset case is NOT evidence and falls to FR-5's honest fallback (rec).**
  *Cost:* a build that waited out a full reset and was then killed still gets
  `agent-escalated,needs-human-review`, which is the #1713 symptom in its rarest
  form. It stays visible and correctable by a human; it is just not auto-classified.
- **Option B — Option A, plus the closed-then-reset case counts when the
  `build_start` snapshot was fresh, its `resets_at` lies inside the build window, and
  its percentage was at or above `QUOTA_ADMIT_PCT`.** *Cost:* a window that was high
  but never reached 100% and simply rolled over during the build would be labelled a
  quota pause. That is an inference from "was near the wall", not an observation of the
  wall, which is the plausible-inference-versus-observation trap CLAUDE.md's Evidence
  Discipline names.
- **Option C — "spent" means `>= QUOTA_ADMIT_PCT`.** *Cost:* the problem described in
  point 1 above. Listed for completeness, not recommended.

Recommendation: **Option A.** It is the only option where every quota label is backed by
an observed spent window, and the cases it leaves out still surface to a human.

## Why no new DR

DR-359's filter asks whether the choice costs more than a day to undo. Every change here
is a revertible diff to `dispatch-issue.sh` (a new `rc` capture, a call into
`drain-inbox.sh`'s already-tested meter reader, a label that is one `gh label create`
away from removal) reusing two precedents this repo has already accepted as policy:
`gate_status()`'s exit-code-based timeout/fail split (this file, unreviewed-as-a-DR
precedent already in production) and DR-093's fail-closed-witness rule (directly
applied, not revised, by FR-3/INV-4). No DR is proposed; `docs/decisions/INDEX.md` has
no entry for this narrower question, and DQ-2's label choice is exactly the kind of
cheap, revertible decision DR-093's own commentary and SPEC-074's "why no new DR"
section already treat as sub-DR.

## Out of scope

- Any change to `gate_status()` itself (`:1744-1766`) — it already reports `timeout`
  correctly; DQ-1 declines to widen this spec to that call site.
- SPEC-074's and SPEC-078's own text-classifier fixes — this spec consumes SPEC-074's
  classifier (FR-2) and taxonomy (DQ-2) but does not implement or re-litigate them.
- Any change to `quota_gate`'s admission thresholds, `QUOTA_ADMIT_PCT`, or the
  bootstrap-allowance mechanics (`drain-inbox.sh:1288-1330`) — FR-3 reads the existing
  meter, it does not change what the meter admits.
- SPEC-074's DQ-1 (bounded auto-reconsideration once a reset passes) — orthogonal,
  already flagged there as a follow-up, not reopened here.

## Test plan (for the Plan phase to place)

1. AC-1/AC-2: fixture harness around the build-launch branch with a stubbed `claude`
   replaced by a script that either sleeps past a short `timeout` (proving 124/137
   classify as `timeout`) or exits 1 immediately (proving the generic-crash path is
   unchanged). SPEC-074's own test plan specifies a stubbed-`claude` harness for this
   same `else` branch; that test file does not exist yet (SPEC-074 is `planning`), so
   whichever spec implements first builds the harness and the second reuses it.
2. AC-3/AC-3b/AC-4/AC-5: fixture `$QUOTA_FILE` contents (fresh+spent 5h, fresh+spent
   7d, missing, stale, fresh+healthy), plus an assertion that the bootstrap counter file
   is untouched on the missing case, paired with a no-quota-text `$LOG`, asserting the resulting
   label set and that `agent-ready` is never restored.
3. AC-6: assert the posted comment body names the reading it used.
4. AC-7: extend `dispatch-ready-check.sh`'s existing countermand-list test with the new
   row, mirroring SPEC-074's AC-5.
5. AC-8: a single-reader assertion — e.g. `dispatch-issue.sh`'s quota-meter call resolves
   to the same `source`/`require` target as `drain-inbox.sh`'s own `quota_gate`/
   `quota_health`, SPEC-074's AC-6 shape.

New test file (owned by this spec):
`packages/minspec/tests/dispatch-build-timeout-quota-witness.test.ts`.
