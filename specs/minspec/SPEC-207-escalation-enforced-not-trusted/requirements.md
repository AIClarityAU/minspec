---
id: SPEC-207
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute — the dev-time autonomous build/merge pipeline (dispatch-issue.sh's run-outcome handling lives here)
aspects: [agent-dispatch, escalation, no-silent-gate, measurement, autonomous-pipeline]
relates_to: [SPEC-044, SPEC-062, SPEC-073, SPEC-074, DR-003, DR-033, DR-076]
affects: [scripts/dispatch-issue.sh, scripts/remediate-pr.sh, scripts/drain-inbox.sh]  # dispatch-issue.sh and drain-inbox.sh are OWNED by SPEC-044 via implements: - this spec modifies them, never owns them (INV: one owner per file). Files this spec will own are named in Plan, not guessed here.
phases:
  specify: in-progress
  clarify: done
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Escalation enforced, not trusted: a stalled run and a false success must be detected by the parent, not confessed by the agent (Requirements)

> Materializes **[#1336](https://github.com/AIClarityAU/minspec/issues/1336)** —
> *"ESCALATE is unenforced prose: a stuck loop or a confident false success never fires
> it."* No DR underlies this design and none is minted by it: per the MMO/DR359 (parent
> register, mmo-platform) ADR filter, every choice below is a same-day-reversible change to
> dev-time scripts, not an irreversible commitment. One choice comes closest — the outcome
> record's schema (D3), which becomes a dataset a later comparison relies on — and is
> flagged there so the human can call it DR-worthy if they disagree.

## One-Sentence Scope

Give the dispatcher three parent-side witnesses that do not depend on the agent's own
honesty: a **no-progress watchdog** that ends a run producing neither commits nor
state-advancing tool calls within a bounded window, a **repeated-call stall detector** that
ends a run issuing N identical consecutive tool calls, and a **per-run outcome record** that
joins "the agent claimed success" with "its PR was later accepted without a human" — so the
pipeline's false-success rate becomes a measured number instead of an unstateable one.

## Context (grounded, with `file:line` evidence)

- **`ESCALATE:` is detected by grepping the agent's free text.** The build agent runs as
  `claude -p … --output-format text 2>&1 | tee "$LOG"`
  ([`scripts/dispatch-issue.sh:2109-2115`](../../../scripts/dispatch-issue.sh#L2109)); the
  only escalation detector is `grep -q '^ESCALATE:' "$LOG"`
  ([`:2116`](../../../scripts/dispatch-issue.sh#L2116)). The comment above it says why:
  `claude -p` "exits 0 even when the agent self-escalates". So escalation fires only if the
  model writes the token — the trust-the-model shape the constitution's "enforce, don't trust
  the model" principle names.
- **The only time bound is wall-clock, from the claim, and is two hours.**
  `BUILD_TIMEOUT_ARGS=(timeout --kill-after=30s "${BUILD_REMAINING}s")`
  ([`:2097`](../../../scripts/dispatch-issue.sh#L2097)) is computed from
  `BUILD_DEADLINE = claim time + LEASE_ABS_MAX_SECS`
  ([`:1036`](../../../scripts/dispatch-issue.sh#L1036)), and
  `LEASE_ABS_MAX_SECS=7200` ([`scripts/lib/issue-lease.sh:57`](../../../scripts/lib/issue-lease.sh#L57)).
  SPEC-044 FR-12 chose this absolute cap and explicitly named the alternative it did not
  build: *"Equivalently a progress-coupled liveness signal — last-commit / agent-heartbeat —
  would achieve the same; the absolute cap is the chosen mechanism"*
  ([SPEC-044 requirements, FR-12](../SPEC-044-coordinated-self-completing-sessions/requirements.md)).
  A run looping on one failing call therefore burns up to two hours before anything ends it.
- **What the ceiling does on expiry is a different path from an escalation.** A non-zero
  exit from the `timeout`-wrapped pipeline (including a kill at the ceiling) lands in the
  `else` crash branch, labelled `agent-escalated,needs-human-review` with the message
  "Agent CRASHED" ([`:2582-2597`](../../../scripts/dispatch-issue.sh#L2582)) — I believe,
  unverified, that a ceiling kill is reported as a *crash*, not as a timeout, because the
  branch does not inspect the exit status (124/137). That reading is to be confirmed in Plan;
  it matters because FR-1's outcome must be named distinctly (INV-5).
- **The log cannot show tool calls today.** `--output-format text` emits only the final
  assistant text, so `.agent.log` ([`:1267`](../../../scripts/dispatch-issue.sh#L1267)) carries
  no record of which tools were called or how often. Loop detection (FR-3) is impossible on
  the current log format; this is why D1 exists.
- **Success is likewise self-declared.** The "Agent completed" line and `agent-done` label
  ([`:2563-2564`](../../../scripts/dispatch-issue.sh#L2563)) follow from the agent exiting 0
  without the token. SPEC-073 (status `planning`) adds one parent-side check on that path —
  *the branch gained a commit* — which catches the empty-success case. It does not catch the
  non-empty wrong one, which is this spec's FR-5 to FR-7.
- **Two other agent launch sites share the shape.** The creator-shepherd fix agent
  ([`:1829-1835`](../../../scripts/dispatch-issue.sh#L1829), `--output-format text … | tee -a
  "$LOG") || true`) and `remediate-pr.sh`
  ([`scripts/remediate-pr.sh:893`](../../../scripts/remediate-pr.sh#L893)) launch `claude -p`
  the same way and have the same blindness. Whether they are in scope is D4.
- **Nothing records run outcomes today.** A grep of `scripts/dispatch-issue.sh` for
  `jsonl`, `telemetry`, `metrics` and `outcome` finds no run-outcome record (the `outcome`
  hits are comments about gate decisions). The rate #1336 asks for cannot be computed from
  any existing artifact; labels are overwritten as an issue moves, so they are not a history.

## Definitions

- **Run** — one `claude -p` invocation by the dispatcher. An MMO/DR355 (parent register) opus
  retry is a second run of the same dispatch, linked to the first.
- **Progress event** — any of: (a) a new commit on the run's branch
  (`git rev-list --count origin/main..HEAD` increases); (b) a tool call whose
  (tool name, normalised input) pair has not been seen earlier in this run; (c) a change to
  the worktree's tracked or untracked file set or contents (`git status --porcelain` plus
  content hash differs from the last sample). Wall-clock time, log bytes and assistant text
  are **not** progress events: an agent can print indefinitely without advancing state.
- **Normalised input** — the tool input with whitespace collapsed and keys sorted, hashed.
  Two calls are *identical* when tool name and normalised-input hash are equal. ("Near-
  identical" beyond this is out of scope for v1 — see R3.)
- **Claimed success** — the run reached the clean-publish path (pushed and opened a PR)
  without an `ESCALATE:` line.
- **Unassisted acceptance** — a claimed-success PR that reached merge with (i) its first
  ai-review verdict `ai-review:pass`, (ii) required checks green, and (iii) no commit on the
  PR branch authored outside the dispatch pipeline's own identities, and with no
  `needs-human-review` label applied at any point before merge. Exact "human intervention"
  boundary is D2.
- **False-success** — a claimed-success run whose PR is *not* unassisted-accepted once it
  reaches a terminal state (merged with assistance, closed unmerged, or later reverted).

## Functional Requirements

### Silence is a failure — the no-progress watchdog

- **FR-1 (bounded no-progress window).** While a run is live, the parent samples progress
  events (Definitions) and ends the run when none has occurred for a window `W`
  (default D5). Ending means SIGTERM, then SIGKILL after a grace, the same
  `--kill-after` shape as the existing ceiling ([`:2097`](../../../scripts/dispatch-issue.sh#L2097)).
  The window resets on every progress event, so a slow but advancing run is never ended by
  FR-1; only the absolute ceiling bounds that one.
- **FR-2 (named outcome, not a crash).** A run ended by FR-1 is recorded as
  `stall: no-progress` — in the issue comment, the stderr log, and the outcome record
  (FR-5) — and labelled `agent-escalated,needs-human-review`, the same pair every other
  terminal-failure path writes ([`:2146`](../../../scripts/dispatch-issue.sh#L2146),
  [`:2596`](../../../scripts/dispatch-issue.sh#L2596)). It is never reported as "CRASHED"
  and never left `agent-running`. Whether it is first eligible for the one MMO/DR355 opus retry
  is D6.

### Loop detection — the repeated-call stall detector

- **FR-3 (N identical consecutive calls).** The parent counts consecutive identical tool
  calls (Definitions). On the `N`th (default D5) the run is ended as in FR-1 and recorded as
  `stall: repeated-call`, carrying the tool name, the count, and the first 200 characters of
  the repeated input (passed through the existing egress scan before it is written to the
  issue, as every other agent-derived publish already is). Identical calls never count as
  progress events (Definitions (b) already excludes them).
- **FR-4 (the witness failing is itself visible — invariant 2).** If the observer that
  feeds FR-1/FR-3 cannot run (the event stream is unparseable, the sampler exits, the
  progress probe errors), the parent writes a visible `watchdog-unavailable: <reason>` line
  to the log and the outcome record, and the run continues under the absolute ceiling alone.
  The run is never silently treated as progressing, and the outcome record for that run is
  marked so it is excluded from rate denominators rather than counted as a clean run.

### Instrument the false-success rate — the outcome record

- **FR-5 (one record per run, written at run end).** Every run appends one record to a
  local, append-only outcome ledger (location and format D3) with at minimum: issue number,
  role, tier, model, run index (first run, or the MMO/DR355 retry), start and end time, terminal reason
  (`escalated` / `stall: no-progress` / `stall: repeated-call` / `crashed` / `ceiling` /
  `claimed-success` / `quarantined` / `scope-held` / `no-commit`), commit count, branch, PR
  number if any, and whether the watchdog was available (FR-4). A failed append is reported
  on stderr and in the issue comment; it is never `|| true` (invariant 2).
- **FR-6 (outcome resolution — a later, separate join).** A deterministic reporter reads the
  ledger, and for each `claimed-success` record whose PR has reached a terminal state, resolves
  it to `unassisted-accepted` or `false-success` per Definitions, writing the resolution as a
  new appended record (never editing the original). Records whose PR is still open stay
  `pending` and are excluded from the ratio, not counted either way.
- **FR-7 (the rate, with its denominator named).** The reporter prints, per model and per
  role and overall, over a stated window: claimed-success count, resolved count,
  false-success count, and the ratio — always alongside the counts it was computed over and
  the date range, never a bare percentage. It also prints stall counts (FR-2/FR-3) and
  watchdog-unavailable counts (FR-4). The output names its own limit: ai-review and T0 are
  themselves fallible (#1336's own "not a proof" section), so the figure is a **lower bound
  on false success**, and the reporter says so in its output.

### Surface it — the drain log

- **FR-8 (visible in the drain).** Each drain cycle in `scripts/drain-inbox.sh` prints one
  line summarising the FR-7 rate over the trailing window, with its counts, and a second line
  naming any stall in that cycle. Whether a rise past a threshold should do more than print
  is out of scope (a gate on the rate is a later decision once a baseline exists).

## Invariants (must not be broken)

- **INV-1 (offline core — constitution #1).** Nothing here ships in the extension. The
  watchdog, detector and ledger writer are local-only; the only network use is FR-6's PR-state
  lookup, which reuses the `gh` reads the dev-time pipeline already makes and runs only in the
  dispatcher/reporter, never in `packages/`.
- **INV-2 (no silent gate — constitution #2).** No new failure ends silently: a stall is a
  named, labelled outcome (FR-2/FR-3); a dead watchdog is a visible line, not an implicit
  pass (FR-4); a failed ledger write is reported (FR-5). No new load-bearing write uses
  `|| true`.
- **INV-3 (blast radius — constitution #3).** `scripts/` is this repo's dev-time machinery
  and is not scaffolded into adopters; nothing in this spec adds to the templates MinSpec
  ships. The ledger lives inside this repo's dispatch working area (D3), never in a
  user-global location.
- **INV-4 (ESCALATE still works).** The `^ESCALATE:` detector, its reason extraction and the
  MMO/DR355 single opus retry ([`:2116-2147`](../../../scripts/dispatch-issue.sh#L2116)) behave
  exactly as today. If D1 changes the log format, a plain-text rendering of the assistant
  output must still be grepped by the unchanged pattern, and a fixture proves it.
- **INV-5 (a stall is not a crash, a crash is not a stall).** The four non-success ends —
  agent escalation, stall, ceiling, crash — are distinguishable in the outcome record and the
  issue comment. Conflating them would make FR-7's counts lie.
- **INV-6 (a healthy run is unaffected).** A run that advances and finishes inside every
  bound behaves byte-identically to today apart from one appended ledger record: same push,
  same PR, same labels, same "Agent completed" line.
- **INV-7 (the ceiling stays).** FR-1 adds a tighter, progress-coupled bound; it does not
  replace SPEC-044 FR-12's absolute cap, which remains the backstop when the watchdog is
  unavailable (FR-4).

## Decisions needed (Clarify)

All 6 decisions are resolved: an agent session recorded each option this document
already recommended, on 2026-10-18 (recorded earlier, not today). No human chose them; they
are ratified only by approval of this spec.

D1 to D6 each carry a **Recorded selection** line naming the option this document already
recommended. An agent session wrote those lines on 2026-10-18, and no human chose them. This
repository runs with `"autonomy": "act"` (`.minspec/config.json:58`), under which an agent
proceeds on a stated recommendation and leaves the options it did not take on record (DR-086
§2 and §4), which is why the options stay below with their costs. Approving a T3 spec is on
that section's stop list, so nothing here stands in for that approval: the lines propose, and
approving this spec is what ratifies them. The requirements above assume the recommended
option in every case. A question in this section with no **Recorded selection** line is still
open.

- **D1 — How does the parent observe tool calls?**
  - **Option A (rec) — switch the agent launch to `--output-format stream-json`**, tee the
    raw event stream to a sidecar log, and render a plain-text `.agent.log` from it so the
    `ESCALATE:` grep (INV-4) is unchanged. *Pro:* gives FR-3 an exact per-call record and FR-1
    criterion (b); the record is also the evidence a human reads after a stall. *Cost:* every
    consumer of `.agent.log` must be checked for the format change, and the stream schema is
    the CLI's, not ours — a CLI update that changes it trips FR-4 (visible, not silent, but a
    lost witness until fixed).
  - **Option B — no stream; observe only the worktree** (commits plus file-set changes,
    criteria (a) and (c)). *Pro:* no log-format change at all. *Cost:* FR-3 cannot be built —
    a loop of read-only calls changes nothing on disk and is indistinguishable from thinking
    — so #1336's item 3 is dropped, and FR-1's window has to be longer to avoid ending runs
    that are legitimately reading.
  - **Recorded selection: Option A.** Option B is not taken, so #1336's item 3 stays in scope.
- **D2 — Where is the "human intervention" line for unassisted acceptance?** Options:
  **(a, rec)** strict — any non-pipeline commit, any `needs-human-review`, any first verdict
  other than `ai-review:pass`, or a pipeline fix-agent cycle all count as assisted. *Cost:*
  inflates false success with runs that were nearly right and needed one automated fix, so the
  figure reads worse than the human experience. **(b)** lenient — only human commits or
  human-applied labels count; automated fix cycles are "unassisted". *Cost:* hides exactly the
  wasted cycles #1336 wants visible. Recording the raw signals (first verdict, fix-cycle
  count, human commits) lets either be computed later; the decision is which one the headline
  ratio uses. **Recorded selection: (a)** strict. (b) is not taken.
- **D3 — Where and in what shape is the outcome ledger?** **(a, rec)** an append-only JSONL
  file under the dispatch working base (`MINSPEC_LEASE_WORKTREE_BASE`, default
  `/tmp/minspec-agent`, [`issue-lease.sh:45`](../../../scripts/lib/issue-lease.sh#L45)) plus
  a durable copy location chosen in Plan. *Cost:* `/tmp` does not survive a container rebuild,
  so a baseline can be lost — the durable copy is not optional, only its place is open.
  **(b)** a marker comment on each issue (like the claim marker,
  [`issue-lease.sh:61`](../../../scripts/lib/issue-lease.sh#L61)). *Pro:* survives anything,
  visible on the issue. *Cost:* a network write per run and a slow, paginated read for every
  report. **(c)** a committed file on a dedicated branch. *Cost:* concurrent writers from
  ~15 sessions collide on push. The schema, whichever home, is the near-irreversible part:
  once a baseline is collected under it, changing field meanings breaks comparability — the
  human may want this one recorded as a DR.
  **Recorded selection: (a)** JSONL under the dispatch working base; the durable-copy
  location stays open for Plan, and no DR is written here. (b) and (c) are not taken.
- **D4 — Which launch sites?** **(a, rec)** all three (`dispatch-issue.sh` build agent,
  its shepherd fix agent at `:1829`, and `remediate-pr.sh:893`) through one shared launcher
  wrapper. *Cost:* wider change across two files, one of them a remediation path with its own
  tests. **(b)** build agent only. *Cost:* fix agents, which run on the same models, stay
  unwatched, and their cycles never reach the rate. **Recorded selection: (a)** all three
  launch sites through one shared wrapper. (b) is not taken.
- **D5 — Thresholds.** `W` (no-progress window) and `N` (identical calls). Rec: `W` = 15
  minutes, `N` = 8. *Cost:* both are guesses — no measured base rate exists, which is FR-5's
  point. 15 minutes is long enough for a full `npm test` (I believe, unverified; Plan should
  measure the slowest legitimate silent step, since a test run emits no tool call while it
  runs and only criterion (c) can see it); 8 is far below the 137 #1336 cites and above the
  small retry loops an agent legitimately makes. Both should be env-overridable and printed
  in the outcome record so a later re-tune can compare like with like. **Recorded selection:**
  `W` = 15 minutes, `N` = 8, both env-overridable; Plan measures the slowest silent step.
- **D6 — Does a stall earn the MMO/DR355 opus retry?** **(a, rec)** yes, a stall on a
  lower-tier model routes through the same `escalate_next_action` as an `ESCALATE:`, sharing
  the one-retry flag and the claim ceiling. *Cost:* the retry may stall the same way,
  spending up to one more `W` before a human sees it. **(b)** no, stalls go straight to a
  human. *Cost:* a sonnet loop that opus would have finished costs a human look. **Recorded selection: (a)** yes, stalls share the one-retry
  path. (b) is not taken.

## Acceptance Criteria

- **AC-1 (FR-1, FR-2).** A stub agent that starts, emits text periodically but makes no tool
  call, commit or file change is ended within `W` + grace; the issue gets
  `agent-escalated,needs-human-review`, the comment and the ledger say `stall: no-progress`,
  and the word "CRASHED" does not appear.
- **AC-2 (FR-1 negative).** A stub agent that makes a distinct tool call, or changes a file,
  every `W`/2 for 3·`W` is not ended by the watchdog.
- **AC-3 (FR-3).** A stub agent issuing the same tool call with the same input `N` times in a
  row is ended at the `N`th, recorded `stall: repeated-call` with tool name and count; the same
  stub alternating two distinct calls is not.
- **AC-4 (FR-4).** With the event observer forced to fail (unparseable stream / killed
  sampler), the log and ledger carry `watchdog-unavailable`, the run is still bounded by the
  ceiling, and the record is excluded from FR-7's denominator.
- **AC-5 (FR-5, INV-6).** A normal successful stub run produces exactly one ledger record
  with terminal reason `claimed-success` and otherwise the same labels, push and PR calls
  (stubbed `gh`/`git`) as today. A forced ledger-write failure is visible on stderr.
- **AC-6 (FR-6, FR-7).** Given a fixture ledger plus stubbed PR states (first-pass merged,
  merged after fix cycle, closed unmerged, still open), the reporter resolves each per D2's
  chosen rule, excludes the open one, and prints counts, date range, ratio and the
  lower-bound caveat.
- **AC-7 (INV-4).** The existing `ESCALATE:` fixtures (reason extraction, one opus retry,
  surface-to-human) pass unchanged under the D1 log format.
- **AC-8 (INV-5).** Four fixtures — escalate, stall, ceiling kill, crash — produce four
  distinct terminal reasons in the ledger.
- **AC-9 (FR-8).** A drain cycle over the AC-6 fixture ledger prints the rate line with its
  counts.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | `W` ends a legitimate long silent step (a full test suite, a large build) | Criterion (c) sees file writes during a build; D5 asks Plan to measure the slowest legitimate step before fixing `W`; env override; outcome record logs the `W` used |
| R2 | ai-review and T0 pass a wrong change, so "unassisted acceptance" overcounts real success | Named as a lower bound in FR-7's output; revert detection in FR-6 catches some of the tail |
| R3 | Exact-match loop detection misses a loop that varies one argument (a counter, a timestamp) | Accepted for v1; the ledger keeps per-run call counts so a near-identical rule can be designed later on observed data, not guessed now |
| R4 | The D1 stream format changes under a CLI update | FR-4 makes the loss visible; the absolute ceiling still bounds the run |
| R5 | A watchdog kill leaves partial uncommitted work | The worktree is preserved exactly as the existing escalation and crash paths preserve it; the comment names the worktree |

## Traceability

- **Issue:** [#1336](https://github.com/AIClarityAU/minspec/issues/1336) — filed from the
  GLM/z.ai dispatch evaluation; provider-independent.
- **Complements, does not overlap:** [SPEC-073 dispatch completion requires a commit](../SPEC-073-dispatch-completion-requires-commit/requirements.md)
  (catches the *empty* false success; this spec measures the *non-empty* one and adds
  `no-commit` as a ledger reason).
- **Extends:** [SPEC-044](../SPEC-044-coordinated-self-completing-sessions/requirements.md)
  FR-12 — builds the progress-coupled liveness signal that FR-12 named and deferred, leaving
  its absolute cap in place (INV-7).
- **Sibling pipeline specs:** [SPEC-062 autonomous PR drain](../SPEC-062-autonomous-pr-drain/requirements.md)
  (FR-8's drain line), [SPEC-074 dispatch quota classification](../SPEC-074-dispatch-quota-classification/requirements.md)
  (another terminal-reason classifier on the same crash branch — Plan must keep the two
  classifications consistent).
- **Constitution:** invariant 2 (no silent gate) for FR-2/FR-4/FR-5; the "enforce, don't
  trust the model" principle for the spec as a whole.
- **No DR filed** — see the note under the title; D3's schema is the candidate if the human
  judges it DR-worthy.
