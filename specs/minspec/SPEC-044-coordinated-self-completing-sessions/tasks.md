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
predicate + record shape). This document tracks **Slice 1 only**; Slices 2–4 are listed
as pending so the chain is visible.

## Slice 1 — the lease seam + issue check-then-claim + same-host hard lock — IN PROGRESS

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

## Slice 2 — creator-owned PR shepherding (FR-4, FR-12, INV-5) — PENDING
- [ ] `scripts/dispatch-issue.sh` — after opening the PR: acquire the PR-claim, start the
      parent-side renew ticker (D10), a bounded shepherd loop reusing `remediate-pr.sh`'s
      `classify_pr` + caps (D4), each credentialed step gated by `verify-holds` (D3);
      build phase bounded by `ABS_MAX` (FR-12); conflicts surfaced; `ai-review:*` untouched.

## Slice 3 — drain demoted to orphan-fallback (FR-6, INV-4) — PENDING
- [ ] `scripts/remediate-pr.sh` — add the `skip-live-owned` owner-gate to `classify_pr`
      (D5) + the extra positional; derive `live_nonself_claim` from `issue-lease.sh reclaim?`.
- [ ] `scripts/drain-inbox.sh` — claim-aware dispatch loop + PR sweep; expired-lease
      reaper via the two-phase grace handshake (D3); `ABS_MAX` force-expiry of a hung owner.

## Slice 4 — auto-wrapup on exit (FR-5) — PENDING
- [ ] `scripts/drain-inbox.sh` + `scripts/dispatch-issue.sh` — parent `EXIT` trap:
      mechanical `release-all` + renew-ticker teardown + worktree-prune + push-committed
      FIRST and unconditionally, then best-effort cognitive `/wrapup` (clean exit only).
