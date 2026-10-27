---
id: SPEC-251
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - a human act needs a witness the agent cannot forge
aspects: [approval, dr-acceptance, ai-review, no-silent-gate, enforce-dont-trust]
relates_to: [SPEC-225, SPEC-041, DR-081, DR-056, DR-108, DR-003, "#2153", "#1066", "#2810"]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-251: A DR flipped to `accepted` must carry a verified acceptance record, or the merge gate says so

Issue: #2153 (DR acceptance has no deterministic witness, so ai-review blocks every human acceptance).

## In plain terms

#2153 asked for a hash-locked approval record for DR acceptance, written by **MinSpec: Accept
ADR** and read by `ai-review` instead of the git author line. **Most of that is already on
`main`** (landed after the issue was filed, #2810 / #1066). What is still missing is the half
the issue's last paragraph names: nothing *requires* the record. A DR can still flip to
`accepted` with no record, and the only consequence is an `UNVERIFIED` fact line fed to a
model reviewer. That is the SPEC-004 asymmetry again: the check validates the field that
exists and never asserts that one should.

## Context (verified against `origin/main` at fa5d7f1d, 2026-10-27)

| Claim | Evidence |
|---|---|
| Accept ADR writes a record, hashed after the flip, committed with the DR and INDEX | `packages/minspec/src/commands/adr.ts:291-337` |
| Record shape is the spec `ApprovalRecord` (`approvedBy`, `approvedAt`, `specHash`) at `.minspec/approvals/docs/decisions/DR-NNN.md.json` | same; `git ls-tree origin/main .minspec/approvals/docs` lists DR-102, DR-107..DR-112 |
| `ai-review` reads it: VERIFIED needs record present, hash matches DR as merged, not `migrated`, non-agent approver | `scripts/approval-provenance.py:345-356` (`dr_accept_report`) |
| A record that IS present is integrity-checked (path-derived approvable, hash neutrality, approver allowlist) | `scripts/approval-integrity.ts:128-300` |
| DR-092 and DR-093 are on `main` as `accepted` with **no** record | `.minspec/approvals/docs/` has 7 records against 112 DRs (counted from `git ls-tree`, not re-derived per DR) |
| No deterministic check fails a change that flips a DR to `accepted` without a record | `approval-integrity.ts` returns `[]` when no sidecar changed (line 282); I found no other consumer, unverified beyond grep of `scripts/` and `.github/` |

So the original block is closed for acceptances made with the current command. Two holes remain:
(1) a flip made any other way (hand edit, **Set Status**, an older build, an agent) carries no
record and nothing deterministic refuses it; (2) the ~105 DRs accepted before the writer
existed have no record, so any later re-flip or review of them reads `UNVERIFIED`.

## Requirements

- **FR-1 - Flip without record is refused.** A change that takes a DR from any non-`accepted`
  status (or absent) to `accepted` and does not carry that DR's record
  (`.minspec/approvals/docs/decisions/DR-NNN.md.json`) in the same change fails a deterministic
  check, naming the DR and the missing record path. The check derives the DR set from the
  diff (base vs head frontmatter `status`), not from the PR title or branch name.
- **FR-2 - The record must verify, not merely exist.** Where the record is present, the check
  requires it to pass the same tests `dr_accept_report` applies (hash matches the DR bytes at
  head, `migrated` false, `approvedBy` a non-agent allowlisted identity), so the deterministic
  gate and the reviewer's fact line cannot disagree.
- **FR-3 - Fails closed and visibly.** If the base, head, DR, or record cannot be read, the
  check fails and says why. No `|| true`, no swallowed parse error (constitution invariant 2).
- **FR-4 - Independent second witness.** The result is surfaced both as its own check and in the
  `ai-review` prompt facts, so neither a missing check run nor a missing reviewer silently
  passes an unwitnessed acceptance.
- **FR-5 - Refusal message is actionable.** It names the supported route (**MinSpec: Accept
  ADR**) and states that a git author line is not accepted as proof.
- **FR-6 - Pre-writer acceptances are not retro-failed.** A DR already `accepted` at base is
  outside FR-1. How the ~105 legacy DRs are treated on a later edit is a decision (D2).
- **FR-7 - Manual Set Status cannot route around it.** **Set Status -> accepted** either
  writes the record or is refused in the same way as FR-1 (D3).

## Acceptance criteria

1. A fixture change flipping `proposed` -> `accepted` with no record fails, naming the DR.
2. The same change plus a valid record from an allowlisted human passes.
3. Record with stale hash, `migrated: true`, or an agent `approvedBy` fails (each separately).
4. Unreadable base blob or malformed record JSON fails closed with a reason.
5. A DR already `accepted` at base and edited without a status change is not flagged.
6. `dr_accept_report` and the new check agree on every fixture in 1-4 (shared test table).

## Invariants this change must not break

- Invariant 1: pure local file and git reads; no network call.
- Invariant 2: no swallowed error; second witness per FR-4.
- Invariant 3: acts only in repos with `.minspec/`.
- Spec approval flow and `approval-integrity` scope boundary (DR-081 section 5) unchanged.

## Out of scope

Changing who may approve (DR-056 / DR-108 own that); bulk back-filling legacy records unless D2
chooses it; amendment acceptance inside an accepted DR (#3016, already reported separately).

## Decisions needed (Clarify)

- **D1 - Where the gate lives.**
  (a) Extend `scripts/approval-integrity.ts` with a "flip requires record" rule **(rec)**:
  reuses base/head plumbing and approver checks; cost: that file is explicitly scoped to
  approval-record PRs (DR-081 section 5), so widening it needs a scope amendment.
  (b) New standalone script and check: clean scope; cost: a second copy of the record
  predicate that can drift from `dr_accept_report` (mitigated by the FR-6 shared table).
- **D2 - Legacy DRs without a record.**
  (a) Grandfather: no record needed unless status changes again **(rec)**: zero churn; cost:
  `UNVERIFIED` stays on ~105 DRs forever.
  (b) Back-fill `migrated: true` records: uniform tree; cost: a bulk write that manufactures
  sign-off records no human made at that moment, which sits badly with "never mint human
  approval". Not recommended.
- **D3 - Set Status -> accepted.**
  (a) Refuse it, direct to Accept ADR **(rec)**: one route, one witness; cost: a command
  behaviour change for users who use Set Status as a shortcut.
  (b) Make it write the record: keeps the shortcut; cost: two write paths to keep in step.
- **D4 - Advisory first or gating at once.** DR-081 ran its check advisory before gating.
  (a) Advisory one week then required **(rec)**: catches false positives cheaply; cost: a
  week where an unwitnessed flip can merge. (b) Required immediately: no window; cost: a
  false positive blocks every DR acceptance, the exact failure #2153 reported.
