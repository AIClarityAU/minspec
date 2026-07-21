---
id: SPEC-042
title: PO-only mode — per-audience approval policy (auto-approve)
type: requirements
status: specifying
tier: T3
product: minspec
created: 2026-07-21
epic: EPIC-002  # Signpost Integrity
depends_on: [DR-066, SPEC-022, DR-056]
relates_to: [SPEC-023, SPEC-024, SPEC-041]
phases:
  specify: in-progress
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-042: PO-only mode — per-audience approval policy (auto-approve)

## Summary

Let a solo builder say "I only want to sign off on *what we're building and why* — not the
technical detail." MinSpec then approves the technical parts automatically, but records
that honestly ("approved by a standing rule, no person reviewed this"), and still runs all
its automatic safety checks. It never pretends a person reviewed something they didn't.

## Context

DR-066 (decision 4) adds a per-project setting so a developer upgrading from vibe-coding
can be PO-only: technical approvables auto-pass so they are not forced to review the *how*.
This collides with DR-056 (approver must be human) and the never-wrong signpost, so the
auto path must be an honest, first-class record — not a synthetic human approval.

## Requirements

- **FR-1 (policy config).** `.minspec/config.json` gains a per-audience approval policy:
  `audiences: { <audience>: { approval: "human" | "auto" } }`, default `human`, loaded by
  `loadConfig`, closed-set validated.
- **FR-2 (auto satisfies the gate).** When an audience's policy is `auto`, its approvables
  are satisfied by an auto-approval record instead of requiring a human approver.
- **FR-3 (distinct honest record).** The auto record is an explicitly-typed variant —
  `kind: "auto"` on a discriminated `ApprovalRecord` (vs `kind: "human"`) — carrying the
  policy reference, policy **version**, and the `enabledBy` human identity (who committed
  the policy) + `enabledAt`. It MUST NOT populate a human `approvedBy`.
- **FR-4 (DR-056 not laundered).** The human-not-bot gate stays strict on the human path;
  the auto record is admitted only via a separate policy branch that never calls
  `assertHumanApprover`. A bot can never mint a `kind:"human"` record.
- **FR-5 (waives review, not gates).** Auto-approval waives *human review only*. The
  deterministic gates still run on auto-approved approvables — `validate`, the SPEC-023
  consequence screen, and SPEC-024 auto-merge eligibility — exactly as for human approvals.
- **FR-6 (honest display).** Any surface rendering approval state shows an auto record
  distinctly — e.g. "auto-approved (no `<audience>` approver)". No code path renders or
  serializes an auto record as a human approval.
- **FR-7 (policy transitions).** Flipping an audience `auto` → `human` withdraws the standing
  waiver: existing auto records for that audience become unapproved (require fresh human
  approval). `human` → `auto` leaves existing human records intact (they are stronger).
- **FR-8 (offline).** Local config + local record write; no network (Tier-0).

## Invariants (T0 — tests before implementation)

- **INV-1.** No `kind:"auto"` record is ever displayed or serialized as a human approval.
- **INV-2.** The human approval path is unreachable by a non-human identity (DR-056 held).
- **INV-3.** Machine gates run regardless of approval policy.

## Acceptance Criteria

- [ ] **AC-1 (FR-3).** With engineering `approval: auto`, the approval flow for `design.md`
      yields a `kind:"auto"` sidecar naming the policy + `enabledBy`, with no human `approvedBy`.
- [ ] **AC-2 (INV-2).** A bot identity cannot produce a `kind:"human"` record (the human
      path throws for a bot).
- [ ] **AC-3 (FR-5).** An auto-approved `design.md` that fails `validate`/SPEC-023/SPEC-024
      is still blocked by those gates.
- [ ] **AC-4 (INV-1).** No code path maps an auto record to "approved by `<email>`" (test).
- [ ] **AC-5 (FR-7).** Flipping engineering to `human` invalidates prior auto records;
      flipping to `auto` preserves prior human records.
- [ ] **AC-6 (FR-1).** An unknown policy value validates to `human` (deny toward more review).

## Open Questions

> These two are the load-bearing forks identified in the DR-066 design discussion.

- **OQ-1 (status vocabulary).** Distinct derived status (`approved-auto`) — honest at the
  headline signal but rippling through `SPEC_STATUSES`, the validator, and the Python twin —
  vs the same `approved` with `kind` only in the sidecar (honesty burden shifts wholly to UI).
- **OQ-2 (freshness).** Is an auto record **hash-bound** (re-stamped on every content change
  → a bot rewrite per push) or **policy-bound** (valid while the policy is in effect, giving
  `resolveStatus` a policy branch)? Policy-bound is preferred; confirm.
- **OQ-3 (containment).** An explicit invariant that `auto` is only a human-configured
  standing waiver of one audience — never a general "the tool approved it" (no
  agent-authored auto-approvals).

## Costly to Refactor

The auto record schema + provenance is a committed, cross-language (Node + Python twin)
contract the moment specs are auto-approved under it; its shape and freshness semantics
must be fixed before the first auto record is written.

## Out of scope

- Approval routing (SPEC-041); teams multi-role policies beyond `human`|`auto` (future).

## Traceability

DR-066 (decision 4, R2/R7); SPEC-022 (record); SPEC-023, SPEC-024 (machine gates); DR-056
(human gate); EPIC-002.
