---
id: SPEC-044
type: tasks
status: implementing
# tier lives on requirements.md (the single tier-carrying approvable). A T3/T4 tier on
# a NON-approved sibling doc is treated by spec-gate.py as a second unapproved spec and
# can shadow the approved requirements.md — so this doc omits it. (SPEC-044 is T4.)
product: minspec
epic: EPIC-009
relates_to: [DR-067, DR-065, SPEC-026]
phases:
  specify: done
  clarify: done
  plan: done
  tasks: in-progress
  implement: in-progress
---

# MinSpec — Coordinated self-completing sessions (Tasks)

Materializes [DR-067](../../../docs/decisions/DR-067.md); tasks map to the FRs/INVs in
[requirements.md](./requirements.md) and the D1–D12 decisions in [design.md](./design.md).
**Four vertical slices; ordering is load-bearing** (Slices 2–4 consume Slice 1's
predicate + record shape).

Progress: **Slice 1 shipped** (#961), **Slice 2 shipped** (#975), **Slice 3a shipped**
(#1016). Remaining: **Slice 3b** — the D3 two-phase grace reaper (#1015) — and
**Slice 4** (auto-wrapup). Each slice below carries its landing PR, so this file states
what is BUILT rather than what was planned.

## Slice 1 — the lease seam + issue check-then-claim + same-host hard lock — SHIPPED (#961)

> The two unticked boxes below are tracked follow-up **issues** (#959, #958), not
> unbuilt slice work — the slice's own deliverables are complete and in production
> (`scripts/lib/issue-lease.sh`, and dispatch standing down on a lost claim).

Covers FR-1, FR-2, FR-3(seam), FR-3b, FR-7, FR-8, FR-9, FR-11, INV-1, INV-2, INV-6, INV-7.

### T0 — Invariants (first)
- [x] `tests/issue-lease-classify.test.ts` — the pure `--classify-claim` seam:
      **INV-1** exactly-one-owner across N racers (exactly one `own`); **FR-2/AC-9**
      winner truth table (earliest `serverOrder` → `sessionId`; `claimedAt` proven
      NEVER a key); **INV-6** `enum_complete=0` / unparseable ⇒ `stand-down`; and the
      `--is-live` predicate: live before TTL, reclaimable after (stale / same-machine
      dead pid), foreign-host TTL-alone, and **AC-3c** a live-but-hung owner past
      `ABS_MAX` force-expired despite a live pid.
- [x] `tests/claim-lease-parity.test.ts` — **AC-9** `pickClaimWinner` (substrate-specific,
      own test) + **AC-8/FR-10** the LIVENESS half of `presence.ts isClaimLive` agrees
      **byte-for-byte** with `issue-lease.sh --is-live` on the golden fixtures, plus the
      `LEASE_TTL_SECS=240` constant tie-back drift gate (ABS_MAX explicitly out of parity).
- [x] `tests/dispatch-claim-first-step.test.ts` — **FR-1** check-then-claim is the FIRST
      step (flock → D12 gate → acquire, all before `git worktree add`); each guard
      stands down cleanly (exit 0); **FR-9/DR-066** the `agent-running` label flip is a
      mirror applied AFTER the won claim; **D11/INV-7** the worktree path is
      claim-unique (`issue-N-<sessionId>`, two sessions get distinct paths — closes R7).
- [x] **INV-3** — `presence.ts` reaches no network: the existing `tier0-import-ban.test.ts`
      stays green (the additions import nothing new).

### Implementation
- [x] `scripts/lib/issue-lease.sh` (**new**) — the pure `--classify-claim` (with the
      `enum_complete` flag, D1/INV-6) and `--is-live` (with the `ABS_MAX` ceiling, D10)
      seams (D1/D2/D3), plus the credentialed `acquire` / `renew` / `verify-holds` /
      `release` / `release-all` / `reclaim?` / `worktree-path` ops, the per-item `flock`
      (D11), the open-issue + shipped-marker gate (D12), and the claim-unique worktree
      path (D11). Dual-mode: SOURCED (functions; the flock is held in the caller's
      process) or EXECUTED (the seams + subcommands). Named `LEASE_TTL/RENEW/ABS_MAX`
      constants with the presence.ts tie-back (only the liveness TTL is parity-shared).
- [x] `packages/minspec/src/lib/presence.ts` — Tier-0 naming of the lease primitive +
      the pure `isClaimLive` (parity-shared) and `pickClaimWinner` (own test) exports +
      the `WorkItemClaim` type + `LEASE_TTL_SECS`/`LEASE_RENEW_SECS`. No network, no
      behaviour change to existing exports (D7/INV-3).
- [x] `scripts/dispatch-issue.sh` — check-then-claim inserted as the FIRST step before
      the worktree: take the `flock`, gate on open+unshipped (D12), acquire the claim
      (stand down cleanly on a live non-self winner / incomplete read), switch the
      worktree path to the claim-unique `issue-N-<sessionId>` (D11), and move the
      `agent-running` label flip to AFTER the won claim (mirror only, D8). Kill-switch
      `MINSPEC_CLAIM_OFF=1`.
- [x] `.gitignore` — `.minspec/locks/` (per-item flock lockfiles + per-session
      claimed-items registry; machine-local, ephemeral).

### Verify
- [x] Full suite green (3407 passed, 2 skipped); lint + build + validate clean.
- [x] `bash -n` clean on `issue-lease.sh` + `dispatch-issue.sh`; pure seams smoke-tested
      (own/stand-down/claim, is-live TTL/pid/foreign/ABS_MAX).

### Deferred / follow-ups (tracked)
- [ ] [#959](https://github.com/AIClarityAU/minspec/issues/959) — mirror `.minspec/locks/`
      into `MINSPEC_GITIGNORE_ENTRIES` (`scaffold.ts`) so newly-scaffolded projects ignore
      it too (scaffold.ts is owned by another spec; a separate change).
- [ ] [#958](https://github.com/AIClarityAU/minspec/issues/958) — harden the `spec-gate.py`
      dedup-by-id over an unsorted glob so a stray T3/T4 tier on a non-approved sibling doc
      can never shadow the approved `requirements.md` (surfaced while unblocking this slice).

## Slice 2 — creator-owned PR shepherding (FR-4, FR-12, INV-5) — DONE (#975)
- [x] `scripts/lib/shepherd-pr.sh` — the pure `--decide` seam: what to DO with a
      `classify_pr` token (act / wait / stop), failing closed on anything unknown.
- [x] `scripts/dispatch-issue.sh` — parent-side renew ticker (D10) started at claim time
      and torn down in the same `EXIT` trap that releases the lease; build phase bounded
      by `ABS_MAX` with `timeout --kill-after` (FR-12); bounded shepherd loop reusing
      `remediate-pr.sh`'s `classify_pr` + the drain's own attempt marker (D4), each
      credentialed step gated by `verify-holds` (D3); conflicts surfaced; `ai-review:*`
      untouched.

  Two defects were caught in review and are worth recording, because both were
  ordering/wiring rather than logic:
  - the shepherd was invoked BEFORE the SPEC-024 merge actor, so a clean PR polled the
    whole ceiling, handed off as "no further automated attempts", and was then merged by
    the gate it had just given up on. It now runs after the merge actor, locked by a test
    asserting the call-site order.
  - `automerge_armed` read `.autoMergeRequest` from a `gh pr view --json` list that never
    requested it, so jq returned null forever and the wait-while-armed branch was dead
    code. Fixed, and gated by a test that every root field read from `$pr_json` is
    actually fetched.

## Slice 3a — drain demoted to orphan-fallback: the owner gate (FR-6, INV-4) — DONE (#1016)
- [x] `scripts/remediate-pr.sh` — `skip-live-owned` owner-gate in `classify_pr` (D5),
      ranked directly after the scope gate so ownership settles BEFORE any PR state is
      interpreted; optional 7th positional defaulting to `no` so the creator-shepherd's
      6-argument contract is unchanged; `live_nonself_claim` derived from
      `issue-lease.sh reclaim?`, treating BOTH "live claim" and "could not enumerate" as
      hands-off (fail closed, INV-4/INV-6).
- [x] The drain needed NO new wiring: it already routes every PR through
      `remediate-pr.sh`, so the gate applies automatically.
- [x] `ABS_MAX` force-expiry of a hung owner needed no code here — Slice 1's
      `is_claim_live` already applies the `claimedAt + LEASE_ABS_MAX_SECS` ceiling, so a
      wedged owner's claim stops being live and the drain adopts it as an orphan. Recorded
      explicitly because this bullet reads as unbuilt otherwise.

## Slice 3b — the two-phase grace reaper (D3) — PENDING (#1015)
- [ ] `scripts/lib/issue-lease.sh` — `lease_reclaim_q` currently reclaims a STALE claim
      immediately. D3 requires the post → wait one renew interval → re-read → back-off
      handshake, because the liveness predicate can misjudge a suspended-but-alive owner
      (laptop sleep, stalled renew, `SIGSTOP` — none bounded by any TTL).
- [ ] `scripts/drain-inbox.sh` — consume it in the dispatch loop / PR sweep.

## Slice 4 — auto-wrapup on exit (FR-5) — PENDING
- [ ] `scripts/drain-inbox.sh` + `scripts/dispatch-issue.sh` — parent `EXIT` trap:
      mechanical `release-all` + renew-ticker teardown + worktree-prune + push-committed
      FIRST and unconditionally, then best-effort cognitive `/wrapup` (clean exit only).
