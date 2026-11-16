---
id: SPEC-239
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination; a branch measured against a gate set main has since outgrown is a many-sessions problem
aspects: [verification, merged-tree, gate-inventory, stale-branch, no-silent-gate, offline, dev-tooling]
depends_on: [DR-066]  # fail-closed gates: an unverifiable probe must never read as green
relates_to: [SPEC-227, SPEC-228, "#2151", "#1955", "#2103", "#2009", "#2389"]
# Ownership is not claimed in Specify: whether the probe ships as a dev-time script in
# this repo or as an extension feature is DQ-3, and the hook it attaches to is DQ-2.
# Declared at Plan once those resolve (SPEC-038 FR-3 allows `affects:` before then).
implements: none
implements_reason: >-
  The file that owns the probe depends on DQ-3 (dev-time script vs shipped feature) and the
  attachment point on DQ-2 (pre-push hook, review-signals, both). Ownership is declared at
  Plan, after Clarify.
affects: [.githooks/pre-push, package.json, scripts/dispatch-issue.sh, packages/shared/src/review-signals.ts]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-239: "The branch is green" is measured on the tree that will merge, not the tree that was cut

Triggered by: [#2151](https://github.com/AIClarityAU/minspec/issues/2151) (a behind
branch's full suite is green against its own gate set, not main's). No DR is minted: every
choice below is a script or a hook line that can be reverted in under a day (the
ADR filter: a decision record only for a choice that cannot be undone in under a day).

> **SPECIFICATION ONLY.** The dispatch that wrote this created no code, script, hook,
> workflow or test. A human reads it, settles the questions under
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before anything is built.

## In plain terms

When a branch falls behind `main`, its test suite is a copy of `main`'s checks *as they
were on the day the branch was cut*. Any check that has landed on `main` since is missing
from the branch, so a full local run can be completely green while the same commit, merged
with `main`, is red. CI does not have this blind spot because CI tests the merge. The blind
spot is local, and local is where a session decides it is finished.

This spec adds one local command that answers the question CI answers: it builds the merge
of this branch and `main` in a throwaway folder, runs the suite there, and reports the
result, naming any check that exists on `main` but not on the branch. A cheap warning,
fired without anyone choosing to run it, points at that command whenever the branch is
behind. Riskiest assumption: that the probe can get a working `node_modules` in the
throwaway folder quickly and without the network (FR-5, AC-6).

## One-Sentence Scope

Add an offline, side-effect-free "merged-tree probe" that runs the suite on
`HEAD` merged with the local `origin/main` ref and reports green only when that merged run
is green, plus an always-on advisory that tells a behind branch its local green is
measured against an older gate set.

## Context - what is true today (read at `origin/main` `4012113d`, 2026-10-26)

### Root cause

The mechanism is that a working tree's test suite is the gate set of *that tree*.
`vitest.config.ts:28` discovers tests by the glob `packages/*/tests/**/*.test.ts` evaluated
over the checkout being run, so a test file that exists only on `main` is not discovered,
not run, and not reported as missing. Nothing local compares the branch's gate set with
`main`'s, so "full suite, 0 failures" carries no statement about which gate set it was.

The **missing gate** is local: no step a session runs before calling a branch done
measures the merged tree. CI does (`ci.yml` triggers on `pull_request`, which checks out
the merge ref, then runs `npx vitest run --coverage …` at `.github/workflows/ci.yml:184`),
which is why the defect in #1955 was caught there and nowhere earlier.

### The measured instance (#1955, from the issue)

- Branch alone, 27 commits behind `main`: `npx vitest run` - 307 files, 6223 passed, 0 failed.
- Same commit merged with `main`: 1 failure, `orphaned-docstring.test.ts > passes on the real tree`.
- The gate arrived on `main` in `c3424dee` (#2103), after the branch was cut.

### A correction to the issue's premise

The issue says a test-file count "breaks the first time a gate ships inside an existing
file, which is exactly how #2103's test arrived." Read from git, that is not how it
arrived: `git show --stat c3424dee` lists `packages/minspec/tests/orphaned-docstring.test.ts`
as a **new** file (+116 lines), with `scripts/check-orphaned-docstring.ts`,
`scripts/lib/orphaned-docstring.ts` and one `package.json` script line. The general concern
still holds, and this spec designs for it: a new `it(…)` inside an existing test file, a
tightened assertion, or a changed fixture is a gate change that no file inventory sees.

### Gates are not only vitest

CI's merge-ref run also executes `npm run lint`, `npm run validate`, `npm run check:cycles`,
`npm run typecheck` and several `node --test` files (`ci.yml:83-131`). A branch can be
behind on any of these. Which of them the probe runs is DQ-4.

### Why the issue's recommendation (an inventory diff) is not the core here

The issue recommends comparing a branch's "gate inventory" with `main`'s and names the
cost itself: the inventory must be derived from something authoritative or the check
reports clean by omission. Every candidate inventory is a proxy for the one authoritative
answer, which is *run the gates of the merged tree on the merged tree*. A file list misses
in-file gates; a test-id list (`vitest list`) misses non-vitest CI steps and assertion
changes inside an existing test; a path-delta filter misses semantic conflicts, where
`main` changed production code the branch's own tests depend on. The probe has none of
these gaps for what it runs, because it does not model the gate set - it executes it.
So this spec makes the probe the verdict and keeps an inventory difference only as an
**explanation** printed beside a probe result (FR-6), where a gap in it cannot turn red
into green.

Rejected alternatives are recorded under [Alternatives considered](#alternatives-considered).

## Functional Requirements

**FR-1 - Merged-tree probe, one command.** A single command (name fixed at Plan; shape
`npm run verify:merged`) builds the merge of `HEAD` and the local `origin/main` ref in a
fresh temporary worktree and runs the suite there with the same invocation CI uses
(`npx vitest run`, not `npm test` - CI does not fire `pretest` hooks). It exits 0 only when
that merged run completes and every test passes.

**FR-2 - Never touches the caller's checkout.** The probe creates its worktree with
`git worktree add --detach` in a fresh `mktemp -d` directory, addresses it only by
absolute path (`git -C <probe>`), never `cd`s the caller's shell, never runs `reset`,
`checkout`, `stash` or `clean` against the caller's tree, and removes its worktree and
temporary directory on every exit path (success, failure, interrupt). The caller's `HEAD`,
index, working-tree status and stash list are byte-identical before and after.

**FR-3 - Distinct, visible outcomes; nothing unverified reads as green.** The probe reports
exactly one of:

| Outcome | Exit | Meaning |
|---|---|---|
| `GREEN` | 0 | merged tree built, suite ran, 0 failures |
| `RED` | 1 | merged tree built, suite ran, at least one failure |
| `UNVERIFIED: <reason>` | 2 | the merged tree could not be measured |

`UNVERIFIED` reasons include at least: no `origin/main` ref; merge conflict (with the
conflicting paths listed); worktree creation failed; dependencies unavailable or mismatched
(FR-5); the suite process crashed or was killed. `UNVERIFIED` is never folded into `GREEN`
or `RED`, and its reason is printed on standard error and in the summary line (invariant 2).

**FR-4 - Offline by default, and honest about staleness.** The probe reads only local refs;
it does not `git fetch`. Its report states the `origin/main` SHA it merged, that ref's commit
date, and when the ref was last updated locally (the reflog entry or `FETCH_HEAD` mtime), so
a reader can see "green against main as of 3 hours ago". Whether an explicit `--fetch` flag
is offered is DQ-5.

**FR-5 - Dependencies are matched, not assumed.** If `package-lock.json` is identical between
`HEAD` and the merged tree, the probe may reuse the caller's installed dependencies (mechanism
fixed at Plan, e.g. a read-only `node_modules` link). If the lockfile differs, the probe
either installs from the merged lockfile offline (`npm ci --offline` or equivalent) or
reports `UNVERIFIED: dependencies changed on main` - it never runs the merged suite on the
branch's dependency set and calls the result green.

**FR-6 - The report names gates the branch did not have.** Beside the outcome, the probe
prints the gate difference between `HEAD` and the merged tree as an explanation:
(a) test files the merged tree discovers that `HEAD` does not (added on `main`);
(b) test files present in both whose content `main` changed since the merge-base. On `RED`,
each failing test is tagged `new on main`, `changed on main`, or `branch's own`, so the
reader can tell "you broke a gate you never had" from "you broke your own test". This list
is explanatory only: the outcome (FR-3) never depends on it.

**FR-7 - Cheap always-on advisory.** At the attachment point chosen in DQ-2, a check that
costs only local git operations (no test run, no network) prints, when `origin/main` has
commits not reachable from `HEAD`:

```
note: branch is N commit(s) behind origin/main (ref updated <age> ago).
      A local green here is measured against the gates as of <merge-base short sha>.
      main has since changed M test file(s): <up to 5 paths> [...]
      Run `npm run verify:merged` before calling this branch green.
```

The advisory is non-blocking. When the behind count is zero it prints nothing. When it
cannot compute (no `origin/main`, detached oddity), it prints one line saying so - never
silence that reads as "not behind".

**FR-8 - Trigger is "behind", not "behind on gates".** The advisory fires on any non-zero
behind count. The M-count of changed test files is information, not the trigger, because a
path filter cannot see a semantic conflict in production code. (This is the decision the
issue's cost paragraph asks for; see Alternatives.)

**FR-9 - The interim convention is written where sessions read it.** Until FR-1..FR-8 ship,
the convention "a branch behind `origin/main` is not called green until the suite has run on
the merged tree" is recorded in `docs/claude-md-details.md` (a pointer, not a new CLAUDE.md
section) with the manual recipe. When FR-1 ships, the recipe is replaced by the command.
*(Placement is a docs change; it is listed here so it is tracked, and is done at implement,
not by this Specify dispatch.)*

**FR-10 - Agent completion records which tree it measured (conditional on DQ-6).** If DQ-6
is accepted, `.review-signals.json` gains an optional field recording the probe outcome and
the `origin/main` SHA it merged, and the dispatcher's completion step runs the probe when the
agent's branch is behind; an absent field means "not measured on a merged tree", never
"merged tree green".

## Acceptance Criteria

Fixtures are throwaway git repos built in a temp dir, so no AC depends on this repo's real
history or on the network.

- **AC-1 (the #1955 shape, red).** Fixture: `main` gains a new test file after the branch is
  cut; that test fails against a change the branch makes. Branch-alone suite: green. Probe:
  `RED`, exit 1, and the failing test is tagged `new on main` with its path listed under
  FR-6(a).
- **AC-2 (in-file gate).** Fixture: `main` adds an `it(…)` to a test file that exists on both
  sides, and that new test fails against the branch. Probe: `RED`; the file is listed under
  FR-6(b) and the failure tagged `changed on main`. (Guards the issue's "gate inside an
  existing file" case.)
- **AC-3 (semantic conflict).** Fixture: `main` changes a production function's behaviour;
  the branch's own pre-existing test depends on the old behaviour; no test file changed on
  `main`. Probe: `RED`, tagged `branch's own`; advisory (FR-7) still fires with M = 0.
- **AC-4 (control, green).** Fixture: branch behind `main`, merged tree passes. Probe:
  `GREEN`, exit 0. A probe that always returns `RED` fails this AC.
- **AC-5 (conflict).** Fixture: branch and `main` edit the same line. Probe:
  `UNVERIFIED: merge conflict`, exit 2, conflicting path printed; caller tree unchanged.
- **AC-6 (deps changed).** Fixture: `main` changes `package-lock.json`. Probe never reports
  `GREEN` using the branch's dependency set: it is either `GREEN`/`RED` after an offline
  install from the merged lockfile, or `UNVERIFIED: dependencies changed on main`.
- **AC-7 (no origin/main).** Fixture without the ref. Probe: `UNVERIFIED`, exit 2; advisory
  prints its cannot-compute line, not nothing.
- **AC-8 (caller untouched).** For every AC above, `git rev-parse HEAD`,
  `git status --porcelain=v1`, `git stash list` and the worktree list of the caller are
  identical before and after, and no probe directory remains under the temp root.
  Includes a run killed mid-suite (SIGINT).
- **AC-9 (offline).** The probe and advisory run with networking disabled (or with
  `GIT_ALLOW_PROTOCOL=` and an unreachable npm registry) and still produce AC-1..AC-7's
  results; no `fetch` appears in a traced git command log.
- **AC-10 (not behind).** Branch at `origin/main`: advisory prints nothing; probe runs and
  reports normally (merged tree equals `HEAD`).
- **AC-11 (real regression check).** Against this repo: a worktree at the #1955 branch's
  pre-fix commit with `origin/main` at or after `c3424dee` reports `RED` naming
  `orphaned-docstring.test.ts` as `new on main`. Run once at implement as evidence; not a CI
  test (it needs real history).

## Invariants this change must not break

- **Invariant 1 (offline).** Neither probe nor advisory makes a network call by default
  (FR-4, AC-9). Any `--fetch` (DQ-5) is explicit, per invocation.
- **Invariant 2 (no silent gate).** An unmeasurable merged tree is `UNVERIFIED`, never green
  (FR-3); the advisory never goes silent on a computation it could not do (FR-7, AC-7); no
  probe signal is written with a swallowed error (`|| true` on the suite or merge exit is
  forbidden). The advisory itself is not a required check and does not claim to be one.
- **Invariant 3 (blast radius).** Everything lands in this repo's `.githooks/`, `scripts/`
  and `package.json` unless DQ-3 chooses to ship it; if shipped, it activates only in a repo
  with `.minspec/` at its root and changes nothing in a repo that did not opt in.
- **Existing pre-push guard.** `.githooks/pre-push` fails open by design for its workflow
  check (#1120, header lines 15-18). If the advisory joins that hook, it must not change the
  workflow guard's exit behaviour, and must not make a push slower than local git operations
  (no suite run in pre-push).
- **Caller-tree safety** (FR-2, AC-8).

## Decisions needed (Clarify)

All 6 decisions are answered, not ratified: an agent session selected, for each, the option this
document already recommended. No human chose them, and no delegation covers authoring Clarify
answers. Delegation DLG-001 (DR-108) made none of these selections and covers spec approval and
engineering-DR acceptance only. An agent-recorded selection carries no consent, whoever prompted
it. It is ratified only by approval of this spec, the founder's or the bot's under DLG-001, and
that approval may overturn it.

**DQ-1 - Is the probe the verdict, with the inventory diff only as explanation?**

**Recorded selection: Option (a),** yes: the probe decides `GREEN/RED/UNVERIFIED`, and the
FR-6 inventory is printed beside it.

- `a` **(rec)** Yes: probe decides `GREEN/RED/UNVERIFIED`; FR-6 inventory is printed beside
  it. Cost: a probe costs one more full suite run (on #1955's branch, ~6.2k tests) each time
  a behind branch wants to be called green - minutes of wall-clock, little token spend.
- `b` Inventory diff is the gate (the issue's rec): compare test ids/files and warn on gates
  main has that the branch lacks; no extra suite run. Cost: reports clean by omission on
  semantic conflicts (AC-3) and on any gate kind the inventory does not model.

**DQ-2 - Where does the always-on advisory (FR-7) attach?**

**Recorded selection: Option (a),** `.githooks/pre-push` (warning only) and `npm run facts`
(on demand).

- `a` **(rec)** `.githooks/pre-push` (warning only) **and** `npm run facts` (on demand). Fires
  exactly when work is about to leave the machine. Cost: one more message in a hook whose
  header promises "never a new obstacle" - it must stay non-blocking and fast, and a reader
  may learn to skim it.
- `b` Session start (`scripts/hooks/session-start.sh`). Cost: fires at the wrong moment - a
  fresh session's branch is usually not behind yet; drift accrues during the session.
- `c` Both. Cost: duplicate noise.

**DQ-3 - Dev-time tool for this repo, or a shipped MinSpec feature?**

**Recorded selection: Option (a),** dev-time only (`scripts/` + `.githooks/`), like
`check-dr-id-collision.ts`.

- `a` **(rec)** Dev-time only (`scripts/` + `.githooks/`), like `check-dr-id-collision.ts`.
  Cost: adopters keep the blind spot until a later spec productizes it.
- `b` Ship in the extension / adopter hooks. Cost: new adopter surface, Tier-0 constraints
  on spawning a suite run, invariant-3 review; larger than this issue.

**DQ-4 - Which gates does the probe run?**

**Recorded selection: Option (a),** `npx vitest run` only, with the report stating plainly
which gates it does not run.

- `a` **(rec)** `npx vitest run` only, with the report stating plainly "covers vitest; lint,
  validate, typecheck, check:cycles not run". Cost: a branch behind on a non-vitest CI step
  still reads `GREEN` from the probe (the label says so, but it is a narrower green).
- `b` vitest plus `npm run validate` and `npm run typecheck` (the cheap, offline CI steps).
  Cost: the list of steps is retyped from `ci.yml` and can drift from it - the exact defect
  SPEC-228 fixes elsewhere - unless Plan derives it from the workflow file.

**DQ-5 - Offer `--fetch`?**

**Recorded selection: Option (a),** yes, an opt-in `--fetch` flag that runs
`git fetch origin main` first; the default stays offline.

- `a` **(rec)** Yes, opt-in flag that runs `git fetch origin main` first; default stays
  offline. Cost: one network path in a dev script, needs the credential the session has.
- `b` No; the report's ref-age line (FR-4) is enough. Cost: a stale `origin/main` gives a
  stale green, visible only if the reader reads the age.

**DQ-6 - Do agent dispatches record and run the probe (FR-10)?**

**Recorded selection: Option (b),** not in this spec; dispatch worktrees are cut from
`origin/main` at start, so they lag only by their own run time.

- `a` Yes, now. Cost: every behind agent completion pays a second suite run; touches
  `dispatch-issue.sh` and `review-signals.ts`, owned by other specs.
- `b` **(rec)** Not in this spec; dispatch worktrees are cut from `origin/main` at start
  (`dispatch-issue.sh:1271`), so they lag only by their own run time. Track as a follow-up
  if a dispatched branch is ever caught by this class. Cost: an agent on a long run can still
  report a stale green.

## Alternatives considered

- **Inventory comparison as the gate (issue's option 2).** Rejected as the verdict (DQ-1):
  every inventory definition - file list, `vitest list` test ids, path-delta over a gate
  surface - is a proxy with a known omission class (in-file gates, non-vitest steps, semantic
  conflicts). Kept as FR-6 explanation, where an omission cannot produce a false green.
- **Prose convention only (issue's option 1).** Rejected as the end state: model-trusted, and
  this repo's own constitution says enforce, don't trust. Kept as the interim (FR-9).
- **Filter the advisory to "behind on gate paths".** Rejected (FR-8): quieter, but silent on
  AC-3, and the path list is retyped surface that drifts.
- **Run the suite in pre-push.** Rejected: makes every push minutes long and contradicts the
  pre-push hook's "never a new obstacle" contract.
- **Rebase automatically before testing.** Rejected: rewrites the caller's branch, a write
  the session did not ask for (FR-2).

## Follow-ups (tracked)

- DQ-6 `b`, if chosen: backlog: 2026-10-27 - SPEC-239 FR-10 - agent completion records whether its suite ran on the merged tree; revisit if a dispatched branch reports a stale green.
- DQ-3 `b` (productize for adopters): backlog: 2026-10-27 - SPEC-239 - ship the merged-tree probe to adopters behind `.minspec/`; revisit after the dev-time tool has run for a month.
- Both lines are added to `docs/backlog.md` at implement, not by this Specify dispatch
  (its allowlist is `specs/**`).
