---
id: SPEC-212
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the dev-time autonomous pipeline; this protects the diagnostic channel readers use to judge the drain
aspects: [drain, tests, diagnostics, no-silent-gate, evidence-discipline, tier-0, offline]
relates_to: ["#2012", "SPEC-062", "#1855", "#2003", "#2006"]
implements: none
implements_reason: >-
  Changes land in existing files (scripts/drain-inbox.sh, the drain test suites, one new guard test)
  that no spec owns; the shipped drain script is owned by no single defect spec.
---

# SPEC-212: The test suite must not write into the live drain's log

Issue: #2012 (bug: the test suite writes into the live drain's log, so two sessions diagnosed a dead drain from test output).

## Scope

Running `npm test` must never append to the drain's real diagnostic log, and a reader of that log must be able to tell a real cycle from a driven one. Nothing else about the drain's behaviour changes.

## Problem (measured, not inferred)

`scripts/drain-inbox.sh:188` defaults `LOG="${MINSPEC_DRAIN_LOG:-/tmp/minspec-drain-inbox.log}"`. Of the suites that run the real script, only five set `MINSPEC_DRAIN_LOG` (`drain-argparse`, `drain-concurrency`, `drain-cycle-all-failed`, `drain-quota-preflight`, `drain-quota-signal-loop`). About twenty others reference `drain-inbox` without setting it, among them `drain-query-failure`, `dispatch-specify-only`, `drain-continuous`, `drain-selfheal`, `drain-queue-cap`, `drain-reconcile` (checked by grepping `packages/minspec/tests/*.test.ts` for the variable; some of those only read the script's text and never execute it, so the exact set to wire is FR-1's job to compute). Test output, designed to look like authentic failures (401s, `HOLDING: ... FAILED`), lands in the same file as genuine cycles. Two sessions read it and diagnosed a dead drain. The failure is specifically hard to catch: the content is plausible, and two readers of the same file corroborate each other.

Root cause (mechanism plus missing gate): the log path is an env seam with a production default, and nothing makes a suite that forgets the seam fail. The existing per-suite wiring is opt-in, so every new suite is contaminating by default.

## Functional requirements

- **FR-1 Every executing suite isolates its log.** Each test that executes `drain-inbox.sh` (not merely reads its source) sets `MINSPEC_DRAIN_LOG` to a file under that test's own tmpdir. The list of suites to wire is derived by the implementer from the suites that spawn the script; the spec does not hard-code it.
- **FR-2 Default is never written during a test run (the gate).** A guard test (T0, offline) fails when the default log path was created or modified during the run. It is the check that keeps FR-1 from rotting: a new suite that forgets the seam turns it red. Mechanism choice is a Decision (D-1).
- **FR-3 One source for the default path.** The default literal is defined once and imported by both `drain-inbox.sh` and the guard, so they cannot drift. Mechanism is a Decision (D-2).
- **FR-4 Provenance stamp.** Each cycle's first log line names the run dir (or its short head) and the invoking pid, so a reader can tell at a glance which process and checkout wrote it. The stamp is in every cycle, not only under test, and does not alter any existing line the other drain tests assert on.
- **FR-5 Lock is considered.** `MINSPEC_DRAIN_LOCK` (`scripts/drain-inbox.sh:187`) has the same shape: a production default under `/tmp` and an env seam. The guard (FR-2) must either cover the lock path too or the spec records why not (D-3).

## Acceptance criteria

- AC-1 With the default log removed, a full `npm test` leaves `/tmp/minspec-drain-inbox.log` absent (or unchanged in mtime and size if a live drain owns it).
- AC-2 Reverting any one suite's `MINSPEC_DRAIN_LOG` wiring makes the FR-2 guard fail, naming the default path (a mutation check, run, not assumed).
- AC-3 A cycle log begins with a stamp carrying pid and run dir; a test asserts the stamp format.
- AC-4 The default literal appears once in the repo outside tests' own tmpdirs (grep proves it).
- AC-5 `npm test`, `npm run validate`, `npm run lint` pass.

## Invariants the change must not break

- INV-1 Offline: no network call is added (constitution invariant 1).
- INV-2 No silent gate: the guard fails visibly and closed. A missing or unreadable default path is a defined state, not a pass-by-swallow (constitution invariant 2).
- INV-3 Blast radius: the change touches only this repo's drain and tests (constitution invariant 3).
- INV-4 Production behaviour of the drain is unchanged except the added stamp (FR-4).
- INV-5 The guard must not fail because a genuine live drain legitimately writes the default log while tests run. See D-1.

## Decisions needed (Clarify)

- **D-1 How the guard detects a write to the default path.**
  - (a) **(rec)** Run the suite with `MINSPEC_DRAIN_LOG` set globally (vitest setup/env) to a sentinel path that must stay absent or empty; any suite that spawns the script without its own override then writes to the sentinel and the guard fails. Immune to a live drain writing the real file (INV-5). Cost: it does not literally watch `/tmp/minspec-drain-inbox.log`, so a suite that explicitly unsets the variable escapes.
  - (b) Compare mtime/size of the real default path before and after the run. Literal, but gives false failures when a live drain writes concurrently (the exact environment where this bug bites).
  - (c) Make the script refuse the default path when a test marker is set (the issue's alternative). Cheapest, but puts test-awareness in production code.
- **D-2 Where the default lives.** (a) **(rec)** a small sourced shell file under `scripts/` read by the script and parsed by the guard; one definition, cost: a new sourced file on the drain's startup path. (b) A constant exported from a TS module and passed to the script as env by the drain launcher; cost: the script then depends on the caller for its own default. (c) Accept the duplicated literal plus an equality test; cost: still two copies, drift is caught only when the test runs.
- **D-3 Cover the lock.** (a) **(rec)** Yes, same global-sentinel treatment, cost: slightly wider change and possible interaction with `drain-concurrency`, which deliberately contends on a lock. (b) Log only, file the lock as a follow-up.
- **D-4 Stamp placement.** (a) **(rec)** One line at cycle start; cost: any test asserting the first log line must be updated. (b) Prefix every line; cost: touches every assertion on log text.

## Out of scope

- The standing drain faults (#1855 swallowed query, #2006 run-dir freshness guard) and relaunching the dead drain. They stand on their own.
- Rotating or cleaning the already-contaminated `/tmp` log.

## Follow-ups (tracked)

None beyond the issues above.
