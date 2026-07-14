---
id: SPEC-037
type: requirements
status: implementing
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
relates_to: [DR-056, DR-012, DR-033, DR-034, SPEC-022]  # design authority (DR-056) · approval = explicit human act (DR-012) · reviewer allowlist this mirrors (DR-033) · canonical-hash approval (DR-034/SPEC-022)
---

# MinSpec — Agent-Proof Approver Identity (Requirements)

**Date:** 2026-07-14
**Status:** Implementing — code shipped ahead of this record; the DR is the design
authority (DR-056, accepted 2026-07-14). This spec captures the identity model as
DR-056's tracked Specify follow-up.
**Triggered by:** [#677](https://github.com/AIClarityAU/minspec/pull/677) — the
independent AI reviewer flagged agent-attributed approvals; investigation →
[DR-056](../../../docs/decisions/DR-056.md). Built under
[#716](https://github.com/AIClarityAU/minspec/issues/716).
**Epic:** [EPIC-006 Trust, Consent & Supply Chain](../../../docs/epics/EPIC-006-trust-and-supply-chain.md)

## Context

MinSpec records the approver of a spec as `approvedBy = git config user.email`,
captured offline at approval time (Tier-0, no network —
[`approval.ts`](../../../packages/minspec/src/lib/approval.ts) `gitConfigEmail`).
[DR-012](../../../docs/decisions/DR-012.md) defines approval as an **explicit human
act**; [DR-033](../../../docs/decisions/DR-033.md) §6 made the *reviewer* identity
trustworthy via the `AI_REVIEW_BOT_LOGINS` allowlist (only the bot may apply
`ai-review:*`). The *approver* identity had **no** equivalent guard.

A MinSpecPro-only repo-local `.git/config` override
(`user.email = claude@harvest316.com`) made every container/agent commit author as
`Paul Harvey <claude@…>` **and** — because `approvedBy` reads the same value — made
~22 committed approval sidecars record `approvedBy: claude@harvest316.com`,
indistinguishable from a deliberate human approval. Deriving the *human-approver*
identity from a settable value **shared with agent commit authoring** is
structurally unable to enforce DR-012. See DR-056 for the full root-cause analysis.

This spec is the identity model: (1) separate the agent/container commit identity
from the human, (2) an agent-proof approver gate, (3) a fix for the repo-local
override, and the human's in-container approve path that (3) requires.

## Functional Requirements

- **FR-1 — Deny-by-default approver gate.** MinSpec MUST refuse to record a spec
  approval when the captured approver identity is a known agent/bot identity or is
  absent (empty / the `unknown` sentinel). A refusal aborts *Approve Spec* with a
  message directing the user to approve under their human identity; it performs no
  status flip, baseline mint, or sidecar write.
  *(`checkApprover` / `assertHumanApprover` / `ApproverDeniedError` in `approval.ts`;
  enforced at the `approveSpec` lib boundary so every caller is gated.)*
- **FR-2 — Denylist mirrors the DR-033 allowlist, inverted.** The built-in denylist
  (`BUILTIN_AGENT_IDENTITIES` = `claude@harvest316.com`, the `minspec-sdd[bot]`
  noreply forms) is extensible at runtime via `MINSPEC_AGENT_IDENTITIES`, parsed with
  the same comma/whitespace grammar as `AI_REVIEW_BOT_LOGINS` (`parseAgentIdentities`).
  Matching is case-insensitive and trims surrounding whitespace.
- **FR-3 — Explicit human approver identity.** A user-scoped `minspec.approverEmail`
  setting supplies the human's explicit approver identity, used in preference to the
  ambient `git config user.email` when set. This lets a human approve from a checkout
  whose git identity is the bot (FR-5) without being denied, while still attributing
  `approvedBy` to the human. Unset → fall back to `git config user.email` (pre-DR-056
  behaviour).
- **FR-4 — Reconcile pre-gate approvals (downgrade only).**
  [`scripts/reconcile-approver-identity.mjs`](../../../scripts/reconcile-approver-identity.mjs)
  flags every committed approval sidecar whose `approvedBy` is an agent/absent
  identity as `migrated: true` — the existing "approval the human never verifiably
  performed, flagged" state. It MUST NEVER mint or upgrade a human approval, never
  touch a human-attributed record, and be idempotent. Clearing the flag
  (re-ratification) is a human act. *(Decision 4; re-ratification tracked separately.)*
- **FR-5 — Agent commit identity is the bot.** Agent/container commits author as
  `minspec-sdd[bot]` (App id 299695933), not `Paul Harvey <claude@…>`. Mechanism for
  this repo/container: the repo-local `.git/config` `user.email` is repointed from
  `claude@harvest316.com` to the bot noreply
  (`299695933+minspec-sdd[bot]@users.noreply.github.com`). *(A general
  per-commit/CI mechanism for other agent contexts is a deferred follow-up — OQ-1.)*

## Invariants

- **INV-1 — A recorded `approvedBy` is a provable human.** No agent/bot/absent
  identity can ever be written as an approver. (T0: `approver-identity.test.ts`.)
- **INV-2 — Deny is side-effect-free.** A refused approval mutates nothing on disk
  (no status flip, no sidecar). (T0.)
- **INV-3 — Reconcile is downgrade-only and non-destructive.** It can only make a
  record's provenance more honest (agent → `migrated:true`), never less; it never
  fabricates a human approval and never edits a human-attributed record.
- **INV-4 — Tier-0 / offline.** The gate and capture add no network or credential
  surface; identity is read from local git config only.

## Acceptance Criteria

- **AC-1** — `checkApprover` denies each `BUILTIN_AGENT_IDENTITIES` entry, `''`,
  whitespace, and `unknown` (case-insensitive); allows a human email. ✅ shipped/tested.
- **AC-2** — `approveSpec` throws `ApproverDeniedError` and writes no sidecar for a
  denied identity; records normally for a human. ✅ shipped/tested.
- **AC-3** — `MINSPEC_AGENT_IDENTITIES` extends the denylist. ✅ shipped/tested.
- **AC-4** — *Approve Spec* shows a modal refusal (not the success toast) and does not
  flip status when the resolved approver is denied. ✅ shipped (command pre-check).
- **AC-5** — With `minspec.approverEmail` set to a human email, approval succeeds and
  records that email even when the ambient git identity is the bot. ✅ shipped.
- **AC-6** — The reconcile script, run twice, leaves the 22 agent-attributed sidecars
  `migrated:true` and the 7 human sidecars untouched (idempotent). ✅ shipped/dry-run-verified.

## Open Questions

- **OQ-1** — General agent-commit-identity mechanism beyond this container (CI runners,
  other agent hosts): a per-commit `-c user.email=<bot>` wrapper, or the dispatch
  scripts setting the bot identity, so agent commits attribute to the bot without a
  repo-local override every clone must carry. Deferred; DR-056 Decision 1 mechanism note.
- **OQ-2** — Should a stronger (verified/cryptographic) human identity eventually
  supersede the offline denylist? DR-056 defers this as a Tier-0-conflicting, heavier
  option that the denylist can build on later.

## Traceability

- **Design authority:** [DR-056](../../../docs/decisions/DR-056.md) (Decisions 1–4).
- **Build:** [#716](https://github.com/AIClarityAU/minspec/issues/716) ·
  code in [`approval.ts`](../../../packages/minspec/src/lib/approval.ts),
  [`approve.ts`](../../../packages/minspec/src/commands/approve.ts),
  `package.json` (`minspec.approverEmail`),
  [`reconcile-approver-identity.mjs`](../../../scripts/reconcile-approver-identity.mjs).
- **Tests:** `packages/minspec/tests/approver-identity.test.ts` (T0 invariants).
- **Prior art mirrored:** [DR-033](../../../docs/decisions/DR-033.md) reviewer allowlist.
- **Reconcile re-ratification:** tracked issue (Decision 4 human act).
