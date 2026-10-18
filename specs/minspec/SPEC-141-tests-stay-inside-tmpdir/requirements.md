---
id: SPEC-141
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # unverified placeholder: reviewer to confirm the right epic for test-hermeticity work
aspects: [tests, hermeticity, no-silent-gate, blast-radius, offline]
depends_on: []
relates_to: ["#1924", "#2355", "#2506", "#1355", SPEC-050]
affects: [packages/minspec/tests/approve-push.test.ts, packages/minspec/tests/approve-push-wiring.test.ts, packages/minspec/tests/approval-pr.test.ts, vitest.setup.ts, vitest.config.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-141: Tests stay inside their tmpdir

Issue: #1924 (a fake `/repo` root reaches `savePreferences` and writes to the real filesystem when `/` is writable). No DR yet; see Decisions needed.

## Scope sentence

No test may create or modify a file outside `os.tmpdir()` or its package's own fixture directories, and a test that does fails loudly on every host instead of depending on whether `/` happens to be writable.

## Observed

On 2026-09-11 a real `/repo/.minspec/preferences.json` (`{"answeredSignatures":{"pushAlwaysOffer":"offered"}}`) appeared on a dev machine whose `/` is a user-writable tmpfs. The only producer of `pushAlwaysOffer` is `recordPushAlwaysOfferMade` in `packages/minspec/src/commands/commit-on-approve.ts` (~L433-440), calling `savePreferences`. Tests pass the literal `'/repo'` as root (`approve-push.test.ts` L146-243; also `approve-push-wiring`, `approval-pr`, `approval-pr-lane-label`, `governance-lane-eligibility`, `broker-app-auth`).

## Root-cause correction (verified in code, not inferred)

The issue's hypothesis was "`mkdir /repo` fails with EACCES and the writer swallows it." That is not what the code does:

- `savePreferences` (`packages/minspec/src/lib/preferences.ts:174-187`) never calls `mkdir`. It first checks `hasOptInMarker(rootDir)` and throws `NotOptedInError` if `/repo/.minspec` does not exist, then `writeFileSync`.
- So the leaked file means `/repo/.minspec/` ALREADY existed when the write ran. On a host where `/repo` does not exist, the same test is inert because of the opt-in gate (#2355), not because of root permissions.
- Therefore a SECOND, unidentified step created `/repo/.minspec` (or `/repo`) on this host, earlier or in the same run. The first leak is that creator, and it is not yet found. Fixing only the `savePreferences` caller would leave it.

Mechanism plus missing gate: the mechanism is a test-supplied absolute path outside tmpdir reaching a real fs writer; the missing gate is that nothing asserts tests stay inside tmpdir. Both must be fixed (CLAUDE.md RCDD: a data-only fix is a tell the gate is missing).

## Functional requirements

- **FR-1 Pin the leak.** Before fixing, reproduce with a writable fake root (or an fs spy recording every write/mkdir whose resolved path is outside tmpdir) and name each test and each producer that creates `/repo`, `/repo/.minspec`, and `/repo/.minspec/preferences.json`. The names go in the PR description.
- **FR-2 No literal `/repo` reaches a real writer.** Each offending test uses an `mkdtemp` root (cleaned in `afterEach`) or injects the preferences writer. Tests that need only a path string for a pure function may keep it only if no real fs call can receive it (checked by FR-3, not by review).
- **FR-3 Containment gate.** A vitest setup/global-setup hook detects any file or directory created or modified outside the allowlist (`os.tmpdir()`, the repo's own fixture dirs, and an explicit short list) during the run, and FAILS the run, naming the path and, where determinable, the test. It must work when `/` is writable AND when it is not (a denied attempt is also reported, since the attempt is the defect).
- **FR-4 Fail closed and visibly.** A gate that cannot initialise (cannot patch, cannot snapshot) fails the run; it never degrades to a skip (constitution invariant 2). No `|| true`, no swallowed error in the gate itself.
- **FR-5 Gate is itself tested.** A test proves the gate trips on a deliberate out-of-tmpdir write (using a sentinel path under a controlled test-owned dir that is treated as outside the allowlist), and does not trip on a tmpdir write.
- **FR-6 Cleanup of the existing stray** is out of scope for code (host state); the PR notes the human should remove `/repo` from affected machines.
- **FR-7 CI parity.** The gate runs under `npx vitest` (what CI runs), not only `npm test` hooks.

## Acceptance criteria

- AC-1: With `/repo/.minspec` pre-created and writable, the full suite leaves `/repo` untouched (verified by listing before/after).
- AC-2: With `/` read-only, the suite passes and the gate reports nothing.
- AC-3: Reintroducing a test that writes under `/repo` (or any non-allowlisted path) fails the run with the offending path in the message, on both a writable and read-only `/`.
- AC-4: The producers named by FR-1 are each covered by a regression test that fails on the pre-fix code.

## Invariants the change must not break

- Invariant 1 (offline): the gate makes no network call.
- Invariant 2 (no silent gate): FR-4.
- Invariant 3 (blast radius): test tooling ships only in this repo's dev setup; nothing is added to the shipped extension, and `savePreferences` behaviour (opt-in refusal, #2355) is unchanged.
- `recordPushAlwaysOfferMade` keeps surfacing write failures to the user (#2506); do not make it throw or go silent to satisfy a test.

## Decisions needed (Clarify)

1. **How to detect out-of-tmpdir writes.**
   - (a) Patch `node:fs` write/mkdir/rename/etc. in a setup file (**rec**): catches the attempt even when denied and names the caller; cost: misses writes by child processes and native code, and ESM namespace patching can be fragile.
   - (b) Before/after snapshot of watched roots (`/`, `/repo`, cwd): simple, covers children; cost: only sees what lands, so a read-only `/` hides the attempt, and snapshotting `/` is slow and noisy.
   - (c) Both; cost: two mechanisms to maintain.
2. **Allowlist shape.** Fixed list in config vs. per-test opt-out helper. Recommend fixed list only (a per-test opt-out becomes the next silent hole); cost: occasional legitimate writes (e.g. coverage output, `.vitest` cache) need a config edit.
3. **Who creates `/repo/.minspec`?** Unknown until FR-1 runs. If it turns out to be non-test code (e.g. a harness or fixture script), the scope may widen beyond `packages/minspec/tests`; confirm whether to fold it here or split a follow-up issue.
4. **DR needed?** Recommend no DR (reversible in under a day, fails the DR-359 filter); cost: the allowlist policy has no durable rationale record beyond this spec.
5. **Epic placement** (`epic:` above is a placeholder).
