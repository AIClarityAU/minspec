---
id: SPEC-037
type: tasks
status: implementing
tier: T3
product: minspec
epic: EPIC-006
relates_to: [DR-056]
---

# MinSpec — Agent-Proof Approver Identity (Tasks)

Built under [#716](https://github.com/AIClarityAU/minspec/issues/716) on branch
`fix/dr-056-approver-gate` (commit 03b5c15). Tasks map to FRs in
[requirements.md](./requirements.md).

## T0 — Invariants (first)
- [x] `tests/approver-identity.test.ts` — `checkApprover` allow/deny (built-ins, empty,
      `unknown`, case-insensitive, whitespace), `parseAgentIdentities` grammar,
      `assertHumanApprover` throws typed error, `approveSpec` no-side-effect-on-deny. *(INV-1..4)*

## Implementation
- [x] FR-1/FR-2 — `checkApprover`, `BUILTIN_AGENT_IDENTITIES`, `parseAgentIdentities`,
      `assertHumanApprover`, `ApproverDeniedError` in `approval.ts`; enforced in `approveSpec`.
- [x] FR-1 (UX) — command pre-check + modal refusal in `approve.ts` before the status flip.
- [x] FR-3 — `minspec.approverEmail` setting (`package.json`) + `resolveApproverEmail` in `approve.ts`.
- [x] FR-4 — `scripts/reconcile-approver-identity.mjs` (downgrade-only, idempotent).
- [x] FR-5 — repo-local `.git/config` `user.email` repointed `claude@` → bot noreply
      (config, not tracked).

## Verify
- [x] Full suite green (2842 passed, 0 failed); typecheck + lint clean.
- [x] Reconcile dry-run: 22 agent-attributed flagged, 7 human kept.
- [x] Adversarial multi-lens verification (gate-bypass / reconcile-safety / completeness /
      correctness) — see #716.

## Deferred (tracked)
- [ ] OQ-1 — general agent-commit-identity mechanism for CI/other hosts (DR-056 Decision 1).
- [ ] FR-4 apply + re-ratification of the 22 — separate labelled change + human act (Decision 4).
