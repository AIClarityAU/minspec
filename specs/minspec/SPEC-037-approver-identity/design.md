---
id: SPEC-037
type: design
status: implementing
tier: T3
product: minspec
epic: EPIC-006
relates_to: [DR-056]
---

# MinSpec — Agent-Proof Approver Identity (Design / Plan)

> The architectural decisions for this work are made and recorded in
> [DR-056](../../../docs/decisions/DR-056.md) (accepted 2026-07-14); this Plan is the
> thin implementation mapping. The DR is the authority for *why*; this is *where*.

## Approach

The gate mirrors [DR-033](../../../docs/decisions/DR-033.md)'s reviewer allowlist,
inverted to a **denylist**, and lives in the same Tier-0 module as the identity
capture it guards (`approval.ts`) so there is one home for "who may approve."

1. **Pure predicate, exhaustively testable.** `checkApprover(email, extraDenied)` is
   a pure input→output mapping (`{ok} | {ok:false, reason}`) — the security-critical
   decision is unit-tested without git/fs, exactly as `ai-review-guard.js` is.
2. **Authoritative guard at the lib boundary.** `approveSpec` calls
   `assertHumanApprover` **before any side effect**, so a denied identity cannot flip
   status, mint a baseline, or write a sidecar — and *every* caller (UI command,
   dispatch script, test harness) is gated, not just the UI.
3. **Friendly pre-check in the command.** `approveSpecCommand` resolves the approver
   (`minspec.approverEmail` setting || `gitConfigEmail`), checks it, and shows a modal
   refusal before the flip — the lib throw is the backstop, the pre-check is the UX.
4. **Explicit human identity decouples approve-from-container.** Repointing the repo
   git identity to the bot (FR-5) would otherwise deny the human's own approvals; the
   user-scoped `minspec.approverEmail` gives the human an explicit identity that wins
   over the ambient (bot) git email, so `approvedBy` stays the human while the commit
   that persists it is bot-authored tooling.
5. **Reconcile is a separate, downgrade-only pass.** A standalone `.mjs` script (no
   TS/build dependency) flips agent-attributed sidecars to `migrated:true`; it never
   fabricates or upgrades, so it can only increase honesty. Shipped un-run in the code
   change; applied in a separate labelled change (DR-056 "not bundled with feature").

## Why not

- **Inherit `github@` on the override fix** — rejected in DR-056: agent commits would
  masquerade as the human's *real* identity. The bot noreply is the correct target.
- **Gate only in the command** — insufficient: dispatch/scripts call the lib directly.
  Hence the lib is authoritative and the command is a friendlier duplicate.
- **Revoke the 22 pre-gate approvals** — would block 22 specs behind the spec-gate.
  `migrated:true` keeps them resolving `approved` while making the gap visible; the
  human re-ratifies at leisure.
