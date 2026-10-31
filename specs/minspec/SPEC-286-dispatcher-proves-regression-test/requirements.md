---
id: SPEC-286
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # no silent gate - a proof flag is observed by the gate, never self-reported
aspects: [dispatch, review-signals, regression-proof, no-silent-gate, offline]
depends_on: []
relates_to: [SPEC-254, "#2893", "#2891", "#180", "#256", "#1304"]
implements: none
implements_reason: >-
  Specify phase only. Files owned are decided at Plan, after Decisions D1-D4 are answered.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-286: The dispatcher proves the regression test red-then-green itself

> **This is a SPECIFICATION ONLY.** Written for issue #2893. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.
> This touches `scripts/`, so the eventual change is machinery and ends at the founder's merge.

## In plain terms

A fix PR shows "regression test proven red before, green after". Today that is two booleans
the fixing agent writes into `.review-signals.json`; the dispatcher copies them through.
Nobody runs the named test on the base commit, so a vacuous test (passes on base too) can
carry a green "proven" tick. The dispatcher already re-runs test/lint/build/validate itself;
this makes it run the one named test on base and on head and set the two flags from what it saw.

## Measured state (this base)

Read from code at this base (`bd2d754f`), not inferred:

- `scripts/dispatch-issue.sh:2415` derives `changedFiles` and, below it, `gate` by re-running
  `npm test|lint|build|validate` in the parent (`gate_status`, ends ~`:2505`; timeout reported
  as `timeout`, not `fail`, #1304). The comment at `:2402-2414` calls this "machine-truth".
- `scripts/dispatch-issue.sh:2514-2519`: `regressionTest`, `regressionProvenBaseRed`,
  `regressionProvenHeadGreen` are taken from the agent's file; `== true` coerces anything else
  to false. A missing/unparseable file defaults both to false (`:2523-2524`).
- `scripts/dispatch-issue.sh:2532` merges `$prose + {changedFiles, gate}`: derived keys win, but
  the two proof flags are in `$prose`, so they are self-reported.
- `scripts/dispatch-issue.sh:1441-1453` (agent prompt) and `scripts/roles/dev.md:62-64` tell the
  agent to set the flags "ONLY if" it ran the test. Nothing verifies that.
- The issue's quoted line numbers (2136-2150, 2247-2248) have moved; the mechanism is unchanged.
- The format of `regressionTest` ("fully-qualified name") is unspecified beyond that phrase;
  how to turn it into a runnable command is **not defined anywhere** (see D1).

## Root cause

Mechanism: the proof flags are a judgement field copied through the merge, so the only
witness for "red on base" is the agent that wrote the fix. Missing gate: no step executes the
named test against the base tree. (A pure prompt-wording change would restate the bad state;
the gate is the fix.)

## Functional requirements

- **FR-1 Observed, not reported.** When the agent's signals name a `regressionTest`, the
  dispatcher runs that single test on the base commit and on head, and sets
  `regressionProvenBaseRed` and `regressionProvenHeadGreen` from those runs. The agent's own
  values for both keys are discarded (the derived keys win in the merge, like `gate`).
- **FR-2 Base run is on a pristine base tree.** The base run executes in a separate checkout of
  the merge-base (`origin/main...HEAD` base), with the agent's test file(s) from head copied in
  (a test added by the fix does not exist on base). The agent worktree is never mutated.
- **FR-3 Result mapping.** `BaseRed` is true only if the test ran and FAILED on base (a test
  assertion failure, not a missing runner/syntax error/not-found - D2). `HeadGreen` is true
  only if the test ran and PASSED on head. A test that passes on base yields `BaseRed=false`
  (the vacuous case).
- **FR-4 Fail closed.** No `regressionTest`, a name that resolves to no runnable test, a runner
  error, or a timeout yields `false` for the affected flag AND a recorded reason string
  (`unproven: <reason>`), never `true`. The renderer shows UNVERIFIED, never a tick.
- **FR-5 Visible reason.** The PR review block carries the reason code (`no-test-named`,
  `unrunnable`, `passed-on-base`, `failed-on-head`, `timeout`, `flaky`), so a human sees why a
  proof is absent rather than a bare cross.
- **FR-6 Bounded.** Each run has a timeout (reuse the #1304 budget mechanism); a timeout is
  recorded as `timeout`, distinct from a failed assertion.
- **FR-7 Offline, no model tokens.** The check is CPU-only and makes no network call.
- **FR-8 Prompt/role text follows.** The prompt (`dispatch-issue.sh:1441-1453`) and
  `scripts/roles/dev.md:62-64` say the agent only NAMES the test; flags are set by the
  dispatcher. (Sweep the old wording when changed.)
- **FR-9 Spec-only and non-fix runs.** Dispatches with no `regressionTest` by design (specify
  phase, pure features) record `no-test-named` without error; nothing else changes for them.

## Acceptance criteria

- **AC-1** Fixture: named test passes on base and head -> `BaseRed=false`, reason `passed-on-base`.
- **AC-2** Fixture: named test fails on base, passes on head -> both true.
- **AC-3** Fixture: named test fails on head -> `HeadGreen=false`, reason `failed-on-head`.
- **AC-4** Fixture: agent file claims both flags true, test is vacuous -> output has `BaseRed=false`
  (agent value ignored).
- **AC-5** Missing, unresolvable, or timing-out test -> both false with a reason; dispatch still
  publishes (the block renders UNVERIFIED), it is not crashed.
- **AC-6** Test file added by the fix (absent on base) is runnable on base per FR-2 and reads red.
- **AC-7** Agent worktree `git status` is identical before and after the check.
- **AC-8** Mutation check: removing the derived override makes AC-4 fail.

## Invariants this change must not break

- No silent gate: an errored or missing witness yields a visible unproven, never a pass, and
  never stops the block rendering.
- Offline: no network call (constitution invariant 1).
- Blast radius: runs only in the dispatcher's own flow; nothing is written into adopter repos.
- The agent's judgement fields (`rootCause`, `rootCauseFiles`, `regressionTest`) stay agent-supplied.
- The parent holds no agent credentials; the test run is of untrusted agent code, so it must run
  under the same sandbox/env scrub as the existing `gate_status` runs.

## Out of scope

- Reviewer-only standards file (#2891).
- Judging whether the test is a GOOD test beyond red-then-green.
- Auto-retrying the fix or blocking publish on an unproven result (D3).

## Decisions needed (Clarify)

All 4 decisions are answered, not ratified: an agent session selected, for each, the option this document
already recommended. No human chose them, and no delegation covers authoring Clarify answers
(DLG-001, DR-108, covers spec approval and engineering-DR acceptance only). This spec is
unapproved, so these answers bind nothing until a human or a covered delegation approves it.

- **D1 - How is `regressionTest` turned into a command?** (a) **(rec)** vitest only: accept
  `path/to/file.test.ts` optionally with `-t "name"`; cost: other runners (shell tests, node
  scripts under `tests/`) are `unrunnable` until added. (b) Per-runner dispatch table; cost: more
  code and more places to drift. (c) Agent supplies a literal command; cost: executes agent-chosen
  shell, widening the attack surface.
  **Recorded selection: Option (a),** vitest only: `path/to/file.test.ts`, optionally with `-t "name"`. An agent session copied this document's (rec) option; no human chose this item.
- **D2 - Distinguishing "failed" from "could not run".** (a) **(rec)** parse the runner's JSON
  reporter and require at least one failed assertion for the named test; cost: couples to
  vitest's output shape. (b) non-zero exit only; cost: a typo or missing import reads as a
  "proven red", the exact false-proof this spec removes.
  **Recorded selection: Option (a),** parse the runner's JSON reporter and require at least one failed assertion for the named test. An agent session copied this document's (rec) option; no human chose this item.
- **D3 - Flaky tests.** (a) **(rec)** run head up to 3 times, require all-pass; run base once and
  record `flaky` if base is inconsistent across 2 runs; cost: minutes per fix and extra CPU.
  (b) single run; cost: a flaky test blocks or falsely credits a real fix. Neither blocks publish
  (see Out of scope); confirm that is wanted rather than gating the PR on it.
  **Recorded selection: Option (a),** run head up to 3 times and require all-pass; run base once and record `flaky` if base is inconsistent across 2 runs. An agent session copied this document's (rec) option; no human chose this item.
- **D4 - Evidence check before building.** The issue says to skip if past self-reported flags
  were always right. (a) **(rec)** sample past merged fix PRs (flag vs re-run) before Plan; cost:
  a small measurement task first. (b) build now; cost: ~1M tokens (~2% of a week) possibly
  spent for little gain.
  **Recorded selection: Option (a),** sample past merged fix PRs (flag against re-run) before Plan. An agent session copied this document's (rec) option; no human chose this item.

## Follow-ups (tracked)

- #2891 reviewer-only standards file (sibling token-saving item).
- backlog: none new.
