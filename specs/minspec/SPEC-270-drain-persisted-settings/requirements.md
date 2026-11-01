---
id: SPEC-270
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a founder decision about the drain must not live where the next launcher cannot see it
aspects: [drain, config, no-silent-gate, offline, headless]
depends_on: []
relates_to: ["#2605", "#2584", "#2587", "#2586", "#2573", "#2599", "#2939", "#415", "SPEC-062"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decisions D1-D4.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-270: The drain's settings are persisted on disk, read by the drain itself, and shown in force

> **This is a SPECIFICATION ONLY.** Written for issue #2605. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

The drain's behaviour is chosen by environment variables on the process that launched it.
The session-start hook launches a new drain with none of them, so two founder decisions revert
silently at every session change: spec writing back on (`MINSPEC_DRAIN_SPECIFY` defaults to `1`,
`scripts/drain-inbox.sh`, the `DRAIN_SPECIFY=` line) and the pull request sweep back on
(`MINSPEC_DRAIN_REMEDIATE_PRS` defaults to on, the `!= "0"` test in the sweep). Nothing on disk
records either decision, so only a model remembering to re-tie the drain stood between the
decision and its reversal. The constitution says not to rely on that.

This spec puts the settings in one file that `drain-inbox.sh` reads itself, so the hook and a
hand relaunch behave identically, and makes the settings in force visible in the first lines a
new session reads.

## Problem (verified from code)

- Knobs are read straight from the process environment with in-script defaults
  (`MINSPEC_DRAIN_SPECIFY:-1`, `MINSPEC_DRAIN_REMEDIATE_PRS:-1`, `MINSPEC_DRAIN_QUEUE_LIMIT:-30`,
  `MINSPEC_DRAIN_CONCURRENCY:-1`, `MINSPEC_DRAIN_SPECIFY_MAX_HELD:-10`, ...).
- The only on-disk drain state is the opt-in pref (`.minspec/auto-drain`, located by
  `--pref-path`) and the pause file (`.minspec/drain-pause`). Neither carries the knobs.
- `scripts/hooks/session-start.sh` runs `"$DRAIN" --auto` with no knobs, after asking `--pref-path`.
- The drain has no `--status` mode today (the argument loop has `--pref-path`, `--quota-*`,
  `--concurrency`, ...), and the session banner prints only a pending count.
- The `SPECIFY_MAX_HELD` comment (#2939) already names this failure for one knob: "lives in a
  launcher's environment, so every restart of the drain turned spec-writing back on".

Root cause (mechanism plus missing gate): there is no persisted drain configuration. A relaunch
command line is the only place a setting can live, the automatic launcher reads none, and nothing
compares the settings a replacement drain starts with against the previous drain's. A decision is
recorded where the next launcher cannot see it.

## Functional requirements

- **FR1 - One settings file.** `drain-inbox.sh` reads a settings file at start of every process
  (and per cycle, see FR5). Its location is derived inside `drain-inbox.sh` from the same
  root as `PREF_FILE`/`PAUSE_FILE` (never recomputed by the hook, per #415), and a
  `--settings-path` seam prints it.
- **FR2 - Covered knobs.** At minimum: spec writing (`MINSPEC_DRAIN_SPECIFY`), pull request sweep
  (`MINSPEC_DRAIN_REMEDIATE_PRS`), dispatch cap (`MINSPEC_DRAIN_QUEUE_LIMIT`), concurrency
  (`MINSPEC_DRAIN_CONCURRENCY`), and the spec-held cap (`MINSPEC_DRAIN_SPECIFY_MAX_HELD`). The
  exact list is the set of knobs whose default is a spend decision; Plan enumerates it.
- **FR3 - Precedence.** Explicit environment variable, then settings file, then in-script default.
  Rationale: tests and one-off hand runs already rely on env overrides. See D1.
- **FR4 - Fail safe on unreadable settings.** A settings file that exists but cannot be parsed,
  or holds a value outside a knob's domain, must not silently fall to the spending default. The
  affected knob takes its non-spending reading (as `DRAIN_SPECIFY` already reads a non-0/1 value
  as 0) and the cycle log names the file, the key, and the value (invariant 2). A missing file
  is not an error: defaults apply and `--status` says "no settings file".
- **FR5 - A change is picked up without a restart.** The file is re-read each cycle so a founder
  edit takes effect without relaunching, and a cycle logs when a value differs from the previous
  cycle's. (Whether it is re-read per cycle or only at start is D2.)
- **FR6 - Settings in force are visible.** New `drain-inbox.sh --status` prints, for each covered
  knob, its effective value and its source (`env`, `settings file`, or `default`), plus the
  settings file path and whether a drain is running. The session-start banner prints the same
  summary line on both the `--auto` path and the dry-run path, so a reverted setting is in the
  first lines a new session reads. The status is read from `drain-inbox.sh`, not recomputed in the hook.
- **FR7 - Launch logs the settings.** Each drain start logs the effective settings and sources
  once, so the log answers "what was this drain running with".
- **FR8 - Writer.** A way to set a value that does not hand-edit the file (a `--set key=value`
  seam) that validates the key and domain and writes atomically. Optional if D3 picks hand-edit only.
- **FR9 - Offline.** Reading and writing settings makes no network call (invariant 1).
- **FR10 - Scope.** The file lives under the repo's `.minspec/` (the opt-in marker, invariant 3)
  and is only read by the drain of that checkout. Nothing is written to a repo without `.minspec/`.

## Acceptance criteria

- AC1 (maps FR1, FR3): With a settings file holding `specify=0` and `remediate_prs=0`, and no env
  vars, `drain-inbox.sh --status` reports both as 0 with source `settings file`. With the env var
  set to `1`, status reports `1` with source `env`.
- AC2 (the issue's suggested test, FR1): Launch through the hook's own launch line
  (`session-start.sh` with the pref `on`), a settings file present and no knob env vars; assert
  the spec queue is left alone and the sweep does not run, using the existing hermetic stubs
  (`MINSPEC_DRAIN_DISPATCH`, `MINSPEC_DRAIN_REMEDIATE`, ...). The test must fail on a tree where
  the drain ignores the file (red on base, green on head).
- AC3 (FR4): A garbled settings file yields the non-spending reading for the affected knob and a
  log line naming file, key and value; a drain that cannot read it does not exit 0 silently.
- AC4 (FR6): The session-start banner output contains the settings summary line in both the
  opted-in and opted-out cases.
- AC5 (FR5): Changing the file between two cycles changes behaviour in the second and logs the change.
- AC6 (FR10): With no `.minspec/` at the repo root nothing is created.

## Invariants this must not break

- Invariant 1: no network call to read or write settings.
- Invariant 2: no silent gate. A settings read failure is visible and fails to the non-spending
  value, never to the default that spends. The file must not be written with a swallowed error.
- Invariant 3: blast radius is the installed project; the file sits under `.minspec/` and is read
  only when the checkout opted in.
- Existing env overrides keep working (FR3), so current hermetic tests are unchanged.
- The quota gate and its caps are not relaxed by anything in the file (a settings value can only
  narrow what the gate admits, never widen past it).

## Out of scope (tracked elsewhere)

- #2587 (sweep never asks the quota gate) and #2586 (a cap of 0 is not a complete pause): other
  ways a limited drain can still spend. This spec makes the decision durable; it does not make the
  sweep honour the gate.
- SPEC-062 (the autonomous drain spec): what runs the loop when no session is alive.
- #2939 backpressure itself: unchanged; only its cap becomes a persistable value.

## Decisions needed (Clarify)

All 5 decisions are answered, not ratified: an agent session selected, for each, the option this
document already recommended. No human chose them, and no delegation covers authoring Clarify
answers (DLG-001, DR-108, covers spec approval and engineering-DR acceptance only). This spec is
unapproved, so these answers bind nothing until a human or a covered delegation approves it.

- **D1 - Recorded selection: Option (a),** env beats file; FR6 shows the source of each value.
- **D2 - Recorded selection: Option (a),** re-read the settings file every cycle.
- **D3 - Recorded selection: Option (a),** a validated, atomic `--set key=value` writer.
- **D4 - Recorded selection: Option (a),** `KEY=value` lines in `.minspec/drain-settings`,
  gitignored like `auto-drain`.
- **D5 - Recorded selection: no default flip,** keep the in-script defaults and rely on FR6
  visibility.

- **D1 - Precedence of env vs file.** (a) env beats file (rec): keeps tests and one-off runs
  working; cost: a stray exported env var in a launcher can silently override a founder decision,
  which is the very failure here, so FR6 must show the source. (b) file beats env: decision always
  wins; cost: breaks every test and hand run that sets env, and a one-off cannot override.
- **D2 - Re-read cadence.** (a) per cycle (rec): an edit applies at once; cost: a half-written
  file read mid-cycle, mitigated by atomic write, and behaviour can change mid-run. (b) at start
  only: simpler and predictable; cost: an edit needs a relaunch, so the founder can believe a
  setting is live when it is not.
- **D3 - Writer.** (a) `--set key=value` seam (rec): validated, atomic, testable; cost: more
  surface to build and keep in step with the knob list. (b) hand-edit only: smallest build; cost: a typo
  is caught only at read time (FR4 limits the damage).
- **D4 - File format and tracking.** (a) `KEY=value` lines under `.minspec/drain-settings`,
  gitignored like `auto-drain` (rec): trivially parsed in bash, matches the pref and pause files; cost: per-machine,
  not shared, so a second machine drains with defaults. (b) committed JSON: shared and reviewable;
  cost: needs a parser in a bash script, and a founder spend decision becomes a repo change that
  goes through a pull request.
- **D5 - Default flip.** Should the in-script default for spec writing and the sweep change to
  off when no settings file exists? Yes would close the gap with no file at all; cost: it changes
  behaviour for every existing adopter, and a founder decision (2026-10-06 park) is not obviously
  a permanent project default. Rec: no, keep defaults, rely on FR6 visibility.
