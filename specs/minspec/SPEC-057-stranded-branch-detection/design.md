---
id: SPEC-057
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-057 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-009  # Team Readiness - session coordination / git transparency (G-8)
relates_to: [DR-071, DR-078, DR-080, SPEC-026, SPEC-050, "#1021", "#1064", "#1115", "#1224", "#1111"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-057 - Design: a second witness for commits stranded on the protected branch

Plan for [requirements.md](requirements.md). Citations of "today" are against `origin/main`
ef84097b, the commit this plan was written on. New code is cited by symbol, because its line
numbers move. Nothing here is built: `packages/minspec/src/lib/stranded-branch.ts` does not
exist on that commit.

## Approach in one paragraph

A pure function, `probeStrandedBranch`, takes an injected git runner, re-reads git state, and
returns either the count and leading commits on the protected branch or "no signal". A small
command-layer class calls it once at activation and again on each SPEC-026 heartbeat tick,
and shows one error-severity notification per distinct stranded state. The notification's
button re-probes, then calls the existing `pushApproval`, which creates a branch at HEAD and
pushes it. No new polling loop, setting, consent surface, push code or `child_process` import.

## Decisions

Chosen by the planning agent on its recommendation; not a founder decision. Each can be undone
by a normal pull request in under a day, and none contradicts an approved sentence. D1 to D4
are the spec's own open questions. D5 to D9 are questions the code raised that the spec did
not ask.

### D1 - OQ-1: the recovery stops at the compare URL and opens no pull request

Chosen by the planning agent on its recommendation; not a founder decision.

**Why.** requirements.md "Out of scope" already excludes "Auto-opening a PR for the recovered
branch", and that is an approved sentence this plan keeps. One premise in OQ-1 has aged: #1224
merged on 2026-08-07, so `approval-pr.ts` is no longer an unmerged draft and approval recovery
now opens pull requests through it (`packages/minspec/src/commands/commit-on-approve.ts:183`).
The reason to stop here survives that. That path applies a merge label from what it knows about
an approval commit, and FR-6 makes this feature carry arbitrary commits, which have no such
subject or path list. So this feature must call `pushApproval` directly and never
`pushApprovalIfEnabled`, whose `pushed-branch` arm opens a pull request.

**Rejected: open a PR through `openApprovalPr`.** It saves one click, but it is excluded by the
approved text, and it would raise a pull request for commits nobody chose to propose.

### D2 - OQ-2: fire on the resolved protected default branch only

Chosen by the planning agent on its recommendation; not a founder decision.

**Why.** FR-1, "Out of scope" and AC-7 all say this. A feature branch ahead of its upstream is
ordinary work in progress.

**Rejected: any branch ahead of upstream.** That is per-branch noise, and AC-7 forbids it.

### D3 - OQ-3: reuse the SPEC-026 heartbeat tick, with an in-flight guard

Chosen by the planning agent on its recommendation; not a founder decision.

**Why.** OQ-3 asks two things, and both have an answer. First, whether the heartbeat is
documented as reading nothing beyond its own file: it is not. SPEC-026's record already carries
`branch` and `worktreeRoot` from git at each heartbeat
(`specs/minspec/SPEC-026-session-presence/requirements.md:112-113`), and the code runs both
reads every 30 seconds (`packages/minspec/src/lib/presence.ts:721-722`). Second, the cost: five
git commands of the kind the probe runs (upstream, count, log, two branch reads) took 20 ms in one
run on this repository (1,843 commits, nothing ahead). That is a single measurement on one repository, not a profile, and R1's
large-repository case stays unmeasured. It matters less because the probe runs on async
`execFile` and does not join the tick's synchronous work. A slow repository costs a skipped
tick, since the guard drops a tick while the previous probe is still running (each git call can
take up to 30 seconds, `GIT_TIMEOUT_MS`).

**Rejected: a second, slower timer.** It adds a polling loop for a cost nobody has observed, and
AC-2 requires a run on each heartbeat tick.

### D4 - OQ-4: extension only; no agent-side detector and no issue filed

Chosen by the planning agent on its recommendation; not a founder decision.

**Why.** "Out of scope" excludes it, and OQ-4 only asks for an issue if one is wanted. Agent
sessions already get a partial witness: `scripts/hooks/session-end.sh:12` prints
`origin/main..HEAD` at session end. It would not change a decision within 30 days.

**Rejected: fold it in here.** It is another product surface, and triage rule 3 keeps detection
and integration apart.

### D5 - The probe does not stop at the documented bypasses

Chosen by the planning agent on its recommendation; not a founder decision.

`resolveBranchDestination` returns `null` under `MINSPEC_GATE_OFF=1`, `MINSPEC_ALLOW_MAIN=1`,
`minspec.allowCommitOnDefaultBranch=true` and any in-progress operation
(`packages/minspec/src/lib/approve-commit.ts:354-373`). Called as it stands, the probe would go
silent in exactly the cases Context lists as the reason this witness exists, and a persistent
git config value would disable both witnesses. That is the single-producer shape constitution
invariant 2 forbids.

**Choice.** Extract clauses 5 to 7 (current branch, `origin/HEAD`, protected-name fallback) into
an exported `resolveProtectedBranchIdentity(run)`. `resolveBranchDestination` keeps clauses 1 to
4 and delegates the rest, so its behaviour does not change and the two still cannot disagree on
which branch is protected (FR-1(a), R3). The probe calls only the extracted function. R2 already
expects the advisory during a sanctioned bypass. In-progress operations do not silence the probe
either: the commits are just as stranded, and the recovery touches neither HEAD nor the index.

**Rejected: call `resolveBranchDestination` as is.** It is one line shorter and leaves the hole
above. **Rejected: re-derive the branch logic in the probe.** R3 forbids it.

### D6 - `always` never pushes on its own; the button is the trigger in every pushing mode

Chosen by the planning agent on its recommendation; not a founder decision.

FR-5 and AC-4 can be read as `always` pushing with no click. Accepted DR-071 condition 4 rules
that out: standing consent "never authorises background or ambient traffic", and it names
"nothing on a timer, on startup, or on file-watch" (`docs/decisions/DR-071.md:125-127`). FR-5 itself says the advisory
"offers" the action and that "no new consent surface is introduced", so the reading that agrees
with both is this: `prompt` and `always` both show the button, one click runs it, and neither asks
again. `never` shows no pushing button. In practice `prompt` and `always` behave the same here,
and that is stated rather than hidden.

DR-071 asks each new use to state its conditions. Condition 1: the default stays `prompt`.
Condition 2: task 6 adds this action to the setting's description. Condition 3: only `origin`.
Condition 4: a click. Condition 5: a failed push shows an error message.

**Rejected: `always` pushes when the probe fires.** It needs a DR-071 amendment that only the
founder can accept. It would also send any commit to the remote without a look, possibly seconds
after it was made. If it is ever wanted, it is a small change once that amendment exists.

### D7 - The notification is error severity, with at least one button

Chosen by the planning agent on its recommendation; not a founder decision.

FR-4 requires a notification that does not auto-dismiss, and the extension API has no sticky
option. In VS Code's source, a notification stays only when it is explicitly sticky, or is an
error with actions, or is expanded with no actions, or has running progress
(`src/vs/workbench/common/notifications.ts`, `get sticky()`, read on microsoft/vscode `main`
2026-10-31). So a warning with buttons is purged on a timeout, which is the failure FR-4 names.
Use `showErrorMessage`. Under `never`, the one button is "Copy push commands", which only writes
to the clipboard, so that mode stays network-free and still sticks.

**Rejected: a warning toast.** It disappears. **Rejected: a status bar item.** It is a second
surface and a new command that FR-4 does not ask for. **Rejected: a never-ending progress
notification.** It misstates what is happening. The cost of the choice is a red icon on something
that is an advisory, not a failure. This rests on VS Code internals rather than a documented
promise, so the task's test asserts the call and its buttons, and a change upstream would not be
caught by it.

### D8 - Re-probe on click, and do not offer a second push of what is already saved

Chosen by the planning agent on its recommendation; not a founder decision.

The notification can sit open for hours, and `pushApproval` reads the branch at call time. If the
checkout has since moved to a feature branch, `decidePushPlan` returns `push-current` and would
push that branch. So the click re-runs the probe, and with no signal it reports that and pushes
nothing. `protectedBranches` is passed as the single name the probe resolved, not the VS Code
setting, which is a separate list that can disagree (#1111).

Recovery leaves the local commit in place (INV-1), so FR-7's next-session re-show still fires, and
another click would make a duplicate remote branch, the harm DR-071 records (three duplicate
recovery pull requests). Before showing the push button, a local read lists
`refs/remotes/origin` refs that contain HEAD (`git for-each-ref --contains HEAD`). If there is
one, the advisory still appears, as FR-7 requires, but it names that ref and offers its compare
URL instead of another push.

**Rejected: suppress the advisory once saved.** FR-7 says an unresolved stranding never goes
permanently silent, and saved on a side branch is not yet landed.

### D9 - Reuse the helpers as they are, including the `approvals/` branch prefix

Chosen by the planning agent on its recommendation; not a founder decision.

The slug is `stranded-<short sha>`, which gives `approvals/stranded-<sha>-<stamp>`. Mode comes
from `effectivePushOnApproveMode` (`packages/minspec/src/commands/commit-on-approve.ts`), exported
for this, because DR-078 section 4 makes it the single accessor. No workflow or script keys on
the branch prefix; only the `.minspec/approvals/` path. The cost is a misleading prefix when the
commit is not an approval.

**Rejected: a new branch prefix option.** R4 asks for a straight call to existing code, and a
better name is not worth widening that signature.

## Contracts

```ts
// packages/minspec/src/lib/approve-commit.ts
export async function resolveProtectedBranchIdentity(
  run: GitRun,
): Promise<{ current: string; default: string } | null>;

// packages/minspec/src/lib/stranded-branch.ts - vscode-free, never throws
export type StrandedProbeResult =
  | { readonly kind: 'no-signal' }
  | {
      readonly kind: 'stranded';
      readonly branch: string;
      readonly sha: string;
      readonly ahead: number; // positive integer; anything else is no-signal
      readonly commits: ReadonlyArray<{ sha: string; subject: string }>; // newest first, at most 5
      readonly savedOn?: string; // first origin ref containing HEAD (D8)
    };
export async function probeStrandedBranch(run: GitRun): Promise<StrandedProbeResult>;

// packages/minspec/src/lib/presence.ts - a throwing listener cannot stop the tick's other work
onHeartbeat(listener: () => void): { dispose(): void };
```

## The probe, in order

1. `resolveProtectedBranchIdentity(run)`. `null`, or `current !== default`: no signal.
2. Base: `@{u}` if `rev-parse --abbrev-ref --symbolic-full-name @{u}` succeeds, else
   `refs/remotes/origin/<default>` if `rev-parse --verify -q` finds it, else no signal.
3. `rev-list --count <base>..HEAD`. Not a positive integer: no signal.
4. `rev-parse HEAD`, `log -5 --format=%h%x09%s <base>..HEAD`, and the D8 ref read. A failure of
   that ref read leaves `savedOn` unset rather than dropping the signal.

All of it is local (INV-2), and any throw yields no signal (INV-3). It reads no state from the
commit-time guard (INV-4).

## Not nagging (FR-7)

The state is an in-memory key of `<sha>:<count>` per window, so a new session starts clean. It is
set before the toast shows, so a tick cannot stack a second one for the same state, and it clears
when the probe returns no signal. The count is in the key because FR-7 re-shows on a count change,
including one where HEAD stays still and a fetch moves the upstream. The in-flight guard covers the
probe only: the toast's promise can stay pending for hours and is not awaited by `check()`.

## Requirements, and where each lands

| Requirement | Decision | Task |
|---|---|---|
| FR-1 probe | D2, D5 | 1.1, 2.1 |
| FR-2 independent witness | D5 | 1.1, 2.1 |
| FR-3 triggers | D3 | 3.1, 5.1 |
| FR-4 persistent advisory | D7 | 4.1 |
| FR-5 recovery | D1, D6, D8, D9 | 6.1, 7.1 |
| FR-6 any commit | - | 2.1 |
| FR-7 idempotent | D8 | 4.1, 7.1 |

## Files

| File | Change |
|---|---|
| `packages/minspec/src/lib/approve-commit.ts` | Extract `resolveProtectedBranchIdentity` (D5) |
| `packages/minspec/src/lib/stranded-branch.ts` | New: the probe |
| `packages/minspec/src/lib/presence.ts` | `onHeartbeat` |
| `packages/minspec/src/commands/stranded-branch-advisory.ts` | New: opt-in gate, in-flight guard, FR-7 key, notification, recovery |
| `packages/minspec/src/commands/commit-on-approve.ts` | Export `effectivePushOnApproveMode` |
| `packages/minspec/src/extension.ts` | Construct, run once, subscribe to ticks |
| `packages/minspec/package.json` | `pushOnApprove` description names this action |

`hasOptInMarker` is checked on each run, because the heartbeat timer is armed in folders that have
not opted in (`packages/minspec/src/lib/presence.ts:591-595`) and constitution invariant 3 keeps
this out of them. With no folder open, there is no run at all.

## Invariants, and where each is held

| Invariant | Held by | Proved by |
|---|---|---|
| INV-1 HEAD never moves | Only `pushApproval` writes refs, and it runs no HEAD-moving command | Recorded argv in task 6 |
| INV-2 detection is local | The probe has no network verb; `never` offers no push | Recorded argv in tasks 2 and 5 |
| INV-3 never throws or blocks | Probe catches all; activation does not await; tick listener is guarded | Tasks 2, 3, 5 |
| INV-4 independent producer | The probe reads git only, and ignores the bypass switches | Tasks 1 and 2 |
| INV-5 no approval record | Nothing writes `status:`, a sidecar or `approvedBy` | Recovery touches git refs only |

## Not in this plan

- Automatic pull requests (D1), and an agent-side detector (D4).
- Reconciling the local commit after recovery. A later `git pull --rebase` drops it by patch-id
  when the pull request lands as one commit (`packages/minspec/src/lib/approve-push.ts:24-26`). A
  squash of several commits will not match, and the developer resolves that by hand. The advisory
  keeps reporting until the branch catches up, which is correct.
- Unifying the two `protectedBranches` lists (#1111).

## Risks

| Risk | Mitigation |
|---|---|
| R1 (I/O on large repositories) stays unmeasured | In-flight guard; async git; D3 |
| R2 (noise during a sanctioned bypass) | FR-7 shows it once per state; it never blocks |
| Error severity reads as a failure | The text says "not on origin yet" and names the action (D7) |
| VS Code changes when notifications stick | Accepted; D7 says no test catches it |
