---
id: SPEC-384
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness — concurrent multi-session coordination (worktree reclaim built on the SPEC-044 claim/lease)
aspects: [dispatch, worktrees, drain, crash-recovery, invariant-2]
relates_to: ["#3909", "#3452", DR-066, SPEC-044]
implements: none
implements_reason: >-
  Specified, not built. No design.md/tasks.md exist; the Clarify choices below are unanswered.
---

# SPEC-384: Dispatch reclaims or defers when an old worktree still holds `agent/issue-N` (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads it,
> answers *Decisions needed (Clarify)*, and approves it before code changes.

Materializes #3909. Sibling: #3452 (stale
*branch* left behind; handled by `scripts/lib/issue-branch.sh`). This is the stale *worktree
registration* half. Claim/lease semantics: SPEC-044, DR-066.

## Problem and root cause (mechanism, not state)

Bad state: drain re-dispatch of a crashed issue dies with
`fatal: 'agent/issue-N' is already used by worktree at '/tmp/minspec-agent/issue-N-<sid>'` (rc=128);
4 hits over #1014/#2036/#2093 on 2026-11-20, one cycle failed all its dispatches.

- **Mechanism (unverified against a live repro; confirm in Plan).** `scripts/dispatch-issue.sh`
  (~L1470-1510) builds a claim-unique path `lease_worktree_path` = `${BASE}/issue-N-<this sid>`.
  The only cleanup (`[[ -d "$WORKTREE" ]]` → `worktree remove`) targets THIS session's own path,
  which by construction is fresh, so it never touches the crashed session's `issue-N-<old sid>`
  registration. `issue_branch_plan` then picks `existing`, and `git worktree add "$WORKTREE" "$BRANCH"`
  refuses because git allows one checkout per branch.
- **Missing gate.** Nothing between the claim and `worktree add` asks git which worktree (if any)
  already holds the branch, and nothing distinguishes *folder gone*, *folder present, owner dead*,
  and *owner alive*. The failure is counted as a dispatch failure, so three consecutive cycles trip
  the drain's own error limit. It healed only through an unrelated daily junk sweep.
- A data-only fix (deleting the worktree by hand) is the symptom fix; the gate is the defect.

## Functional requirements

- **FR-1 Detect.** Before `worktree add` for `agent/issue-N`, the dispatcher asks git
  (`git worktree list --porcelain`, run via the repo's pinned `launcher_git`) whether any worktree
  other than the one about to be created has that branch checked out. The check is a library
  function (alongside `scripts/lib/issue-branch.sh`) so it is unit-testable without a full dispatch.
- **FR-2 Folder gone → prune.** If the holder's path no longer exists on disk (git marks it
  `prunable`), run `git worktree prune` and proceed with the normal plan. No work is lost: nothing
  exists to lose; the branch itself is untouched (#3452 rule).
- **FR-3 Folder present, owner not alive → recover, never discard.** The holder is classified dead
  by the same liveness witness the claim lease uses (SPEC-044; the lease for that sid expired or is
  absent). The old worktree is then handled per the Clarify choice (D1). Under no option may
  uncommitted changes, untracked files, or unpushed commits be removed, reset, or force-pruned
  without being preserved first.
- **FR-4 Owner alive → defer, not fail.** If the holder's owning session is alive, the issue is
  skipped as in flight: exit the way a lost claim does today (`exit_declined`, exit 0, a stated
  reason), so it does not count toward the drain's consecutive-failure limit.
- **FR-5 Unknown liveness fails safe and visibly.** If liveness cannot be determined (lease read
  errors, no parsable sid in the path), treat as *alive*: defer with a visible warning naming the
  path. Never treat unknown as dead (invariant 2, no silent gate; never destroy possibly-live work).
- **FR-6 Single remaining failure class.** After FR-1..5, the only `worktree add` failure that
  reaches the drain as a failure is a genuine one; the message names the branch, holder path, and
  the classification reached, so the next occurrence is diagnosable from the log alone.
- **FR-7 Evidence.** Each outcome (pruned / recovered / deferred / unknown-deferred) emits one log
  line carrying issue, holder path, and classification.

## Acceptance criteria

- **AC-1 (T3 regression, red on base).** A test creates a real repo plus a registered worktree on
  `agent/issue-N` (sibling sid path), then runs the worktree-creation step. On current base it
  reproduces rc=128 with the exact git message; at head it succeeds or defers per below.
- **AC-2** Holder folder deleted after registration → prune, new worktree created, rc=0.
- **AC-3** Holder folder present, owner dead, dirty tree (modified + untracked file) → every byte of
  that dirty state still exists afterwards (in place or in the preserved copy/branch), and the new
  dispatch proceeds or declines per D1.
- **AC-4** Owner alive (live lease) → exit 0 via the declined path; no `worktree add`; not counted as
  a failure by the drain wrapper.
- **AC-5** Liveness unreadable → deferred with warning; nothing removed.
- **AC-6** No holder at all → behaviour byte-identical to today (`new` / `existing` / `track` modes).
- **AC-7** The branch is never deleted or reset in any path (#3452 invariant retained).

## Invariants this must not break

- Core invariant 2 (no silent gate): no `|| true` around the holder check; errors surface.
- Core invariant 3 / blast radius: only worktrees under the dispatcher's `WORKTREE_BASE` for this
  repo and `agent/issue-N` pattern are eligible; a worktree elsewhere (a human's checkout holding the
  branch) is deferred as in flight, never touched.
- SPEC-044 exactly-one-owner: the check runs AFTER the claim/flock is held, so two racers cannot both
  reclaim the same holder.
- #3452: branches are never deleted or reset to get past a conflict.
- Offline (invariant 1): detection uses local git only; no network call is added.

## Out of scope

Changing the daily junk sweep; general crash detection (`agent-crashed` labelling); changing
`lease_worktree_path` naming.

## Decisions needed (Clarify)

- **D1 — What to do with a dead owner's worktree that still exists.**
  - **(a) Reuse in place (rec):** continue the agent in the old folder (`existing` branch, dirty state
    intact). Cost: the new session runs in a path whose sid does not match its lease, so
    `lease_worktree_path`-keyed cleanup and the claim-unique-path invariant need an exception.
  - **(b) Salvage then remove:** commit dirty state to a `wip` commit on the branch (or copy to a
    side branch), `worktree remove`, then add fresh. Cost: auto-commits possibly half-written files
    onto the issue branch, and a failed commit must abort to deferral.
  - **(c) Defer to a human:** leave it, exit as declined, and label the issue. Cost: a crashed issue
    never self-heals, contradicting tenet 1 (smaller founder job).

  **Recorded selection: the recommended option,** (a), reuse the dead owner's worktree in place. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-22; sign-off ratifies it.

- **D2 — Liveness witness.** Reuse the SPEC-044 lease expiry (rec; one witness, already fail-closed;
  cost: a crashed session's lease must expire first, delaying recovery by up to one lease TTL) versus
  also checking the sid's process (faster, but a second producer that can disagree and is
  host-local).

  **Recorded selection: the recommended option,** reuse the SPEC-044 lease expiry as the one liveness witness. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-22; sign-off ratifies it.

- **D3 — Scope of "held by".** Treat a holder outside `WORKTREE_BASE` as in flight (rec; safest, cost:
  a human checkout holding the branch blocks dispatch until they release it) versus erroring loudly.

  **Recorded selection: the recommended option,** treat a holder outside `WORKTREE_BASE` as in flight. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-22; sign-off ratifies it.
