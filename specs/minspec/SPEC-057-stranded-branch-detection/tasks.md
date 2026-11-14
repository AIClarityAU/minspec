---
id: SPEC-057
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-057 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-009  # Team Readiness - session coordination / git transparency (G-8)
relates_to: [DR-071, DR-078, SPEC-026, "#1021", "#1111"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-057 - Tasks

The order below is the order of work. Each task is one pull request, ends with the full suite
green, and names the requirement ids it satisfies, the files it touches, the test that proves it
and the tasks it waits for. The plan is [design.md](design.md), including its *Decisions*; the
contract is [requirements.md](requirements.md), which no task edits.

No founder decision blocks any task. Rules for every task:

- Write the test first, run it against the unchanged code, and paste the red output into the
  pull request. A test that is green before the change is not done.
- Run `npx vitest run` (what CI runs), `npm run typecheck` and `npm run validate` before calling a
  task done. Run `tsc` on any new test file too, because `tests/` is outside every tsconfig.
- No `checkout`, `switch`, `merge`, `rebase` or `reset` in any code path (INV-1). No new
  `child_process` import: git goes through the injected `GitRun`.
- requirements.md's `implements:` lists only the probe and its test. The other paths below are
  ordinary edits; never touch requirements.md to add them, because that voids its approval.

## 1 - Extract the branch identity resolver

- [ ] **1.1** `packages/minspec/src/lib/approve-commit.ts` - extract clauses 5 to 7 of
  `resolveBranchDestination` into exported `resolveProtectedBranchIdentity(run)`; the old function
  keeps clauses 1 to 4 and delegates (design D5).
  *Requirements:* FR-1(a), INV-4, R3.
  *Test:* `packages/minspec/tests/approve-commit-identity.test.ts` (new) - under each of the three
  bypasses and an in-progress merge, the new function still returns the identity and
  `resolveBranchDestination` still returns `null`. It also covers detached HEAD, no origin/HEAD with
  no remote, and a name outside the protected list, each `null` from both.
  `packages/minspec/tests/approve-commit-hook-parity.test.ts` stays unchanged and green.
  *Prerequisites:* none.

## 2 - The probe

- [ ] **2.1** `packages/minspec/src/lib/stranded-branch.ts` (new, owned) - `probeStrandedBranch`, per
  design "The probe, in order", without the `savedOn` read.
  *Requirements:* FR-1, FR-2, FR-6, INV-2, INV-3, INV-4; AC-1, AC-5, AC-6, AC-7.
  *Test:* `packages/minspec/tests/stranded-branch.test.ts` (new, owned), with a stub runner plus one
  real-git temp repository: N ahead of `@{u}`; fallback to `origin/<default>`; more than 5 commits gives
  5; zero ahead; feature branch; detached HEAD; no upstream and no origin; a non-numeric count; a runner
  that throws; a non-approval subject; a bypass set, still detected; recorded argv holds no network verb.
  *Prerequisites:* 1.1.

## 3 - The heartbeat seam

- [ ] **3.1** `packages/minspec/src/lib/presence.ts` - add `onHeartbeat(listener)`, called at the end of
  each interval tick, each listener in its own `try`/`catch`; the disposable removes it.
  *Requirements:* FR-3, INV-3; AC-2 (tick half).
  *Test:* `packages/minspec/tests/presence.test.ts` - with fake timers, a listener fires once per tick,
  a throwing listener does not stop `writeHeartbeat` or a second listener, and none fires after dispose
  or with no folder open. `packages/minspec/tests/presence-opt-in-invariant.test.ts` stays green.
  *Prerequisites:* none.

## 4 - The advisory, no network

- [ ] **4.1** `packages/minspec/src/commands/stranded-branch-advisory.ts` (new) - a class with `check()`:
  `hasOptInMarker` gate, in-flight guard, probe, FR-7 key `<sha>:<count>`, and `showErrorMessage` naming
  the branch, count and leading subjects, with a "Copy push commands" button. It offers no push yet.
  *Requirements:* FR-4, FR-7, INV-3; AC-3; design D3, D7.
  *Test:* `packages/minspec/tests/stranded-branch-advisory.test.ts` (new), with a mocked `vscode` - one
  message per state; same state on a later check shows none; new SHA or new count shows again; no signal
  clears the key, so a recurrence shows; not opted in runs no git; a check during a pending probe is
  dropped; severity is error with at least one button.
  *Prerequisites:* 2.1.

## 5 - Wire it in

- [ ] **5.1** `packages/minspec/src/extension.ts` - after `presence.start()`, construct the advisory, run
  `check()` once without awaiting it, subscribe it to `presence.onHeartbeat`, and push both disposables.
  *Requirements:* FR-3, INV-2, INV-3; AC-2 (activation half). This is the first usable slice: visibility
  under every setting.
  *Test:* `packages/minspec/tests/stranded-branch-wiring.test.ts` (new) - drive the real `activate()` the
  way `packages/minspec/tests/extension.test.ts` does, with fake timers: one probe at activation, one per
  tick; activation returns with a probe that never resolves; a probe that rejects leaves it working;
  recorded argv holds no network verb. Assert behaviour, not source text.
  *Prerequisites:* 3.1, 4.1.

## 6 - The recovery action

- [ ] **6.1** `packages/minspec/src/commands/stranded-branch-advisory.ts`,
  `packages/minspec/src/commands/commit-on-approve.ts` (export `effectivePushOnApproveMode`) and
  `packages/minspec/package.json` (one sentence in `minspec.pushOnApprove`'s description, naming this
  action). Under `prompt` and `always`, a "Save on a branch and push" button; `never` keeps task 4's button.
  The click re-probes, then calls `pushApproval` with `protectedBranches: [branch]` and slug
  `stranded-<short sha>`, and reports the compare URL or the failure. It never calls
  `pushApprovalIfEnabled` or opens a pull request. Under `always`, nothing pushes without the click.
  *Requirements:* FR-5, INV-1, INV-2, INV-5; AC-4; design D1, D6, D8, D9.
  *Test:* `packages/minspec/tests/stranded-branch-advisory.test.ts` - recorded argv after a click shows
  `branch <new> HEAD` and `push -u origin <new>:<new>` and none of `checkout`, `switch`, `merge`, `rebase`,
  `reset`; `never` shows no pushing button and zero network calls; `always` with no click, across ticks,
  makes zero pushes; click after moving to a feature branch pushes nothing; a failed push shows an error;
  the project-local preference outranks the VS Code setting.
  *Prerequisites:* 5.1.

## 7 - Saved already

- [ ] **7.1** `packages/minspec/src/lib/stranded-branch.ts` and
  `packages/minspec/src/commands/stranded-branch-advisory.ts` - add the `savedOn` read, and when it is set,
  name that ref and offer its compare URL instead of another push.
  *Requirements:* FR-5, FR-7; design D8.
  *Test:* `packages/minspec/tests/stranded-branch.test.ts` and
  `packages/minspec/tests/stranded-branch-advisory.test.ts` - after a real-git push to a `file://` remote,
  `savedOn` names the ref and the count is unchanged; a failing ref read still returns the signal; the
  advisory still appears in a new session, with no push button.
  *Prerequisites:* 6.1.

When task 7 lands, rebuild the `.vsix` (`npm run package` in `packages/minspec`).
