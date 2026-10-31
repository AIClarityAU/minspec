---
id: SPEC-221
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - a sign-off must never silently attest to text nobody approved
aspects: [approval, gate-integrity, no-silent-gate, never-wrong, tier-0, offline]
relates_to: [DR-081, DR-029, DR-003, SPEC-069, SPEC-136, "#2017", "#1029"]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec - A PR that edits an approved spec must say it strands the sign-off (Requirements)

> Triggered by **[#2017](https://github.com/AIClarityAU/minspec/issues/2017)**. Rests on
> DR-081 (approval-record PRs settle by a deterministic witness) and DR-029 (editing an approved
> spec and re-approving is the normal workflow). No new DR: this adds a verdict to an existing
> check and reverses no decision.

## Problem

An approval hash-locks a spec in two directions. The sidecar's `specHash` must equal
`specHash(spec)` (`packages/shared/src/canonical.ts`; `status:`/`phases:` are stripped).

| the PR changes | effect | caught today |
|---|---|---|
| the **sidecar** to an older/forged `specHash` | re-locks the approval onto superseded text | yes (`approval-provenance.py` `VERDICT: MISMATCH`; `approval-integrity.ts` `hash-binding` / `approvable-unreviewed`) |
| the **approved spec**, sidecar untouched | sidecar stops matching the bytes it attests | **no** |

Cause (read from code, not inferred): both shipped witnesses are *sidecar-driven*.
`scripts/approval-integrity.ts` `evaluateApprovalIntegrity` computes `sidecars` from the changed
files and returns `[]` when there are none ("Not an approval-record PR ... Passing here is
correct"); `scripts/approval-provenance.py` `report_for` is called per changed sidecar. Neither
ever iterates *changed specs*. The file that goes stale is not in the PR's changed-files list, so
a reviewer cannot see it either. The chief-of-staff `cos.py approvals` tool (outside this repo)
has the same shape; it is the record, not a patch site here.

Live instance: `AIClarityAU/voip-sms-inbox#83` changes only `specs/SPEC-002-reply-seam.md`
while its `main` sidecar matched that spec exactly.

## Scope

In: a deterministic, offline "strands a live approval" check over **changed approvables**,
shipped in `scripts/approval-integrity.ts` (the copy adopters run) and, if the plan finds it
shares the verdict model, `scripts/approval-provenance.py`.
Out: blocking edits to approved specs (Alternative 2 in the issue, rejected: DR-029); changes to
`cos.py`; changes to the existing sidecar-direction checks.

## Functional requirements

- **FR-1 Reverse-direction enumeration.** For every changed path that is an approvable (a path
  for which `.minspec/approvals/<path>.json` exists **on the merge base**), the check evaluates
  the PR's version against that base sidecar. Enumeration is by changed *approvable*, not by
  changed sidecar.
- **FR-2 Verdicts.** Per such approvable, exactly one of:
  - `PRESERVES` - `specHash(head content)` equals the base sidecar's `specHash`
    (hash-neutral edit, e.g. `status:`/`phases:` flip, or no canonical change).
  - `STRANDS` - hashes differ **and** the PR does not also carry a sidecar for that approvable
    whose `specHash` equals `specHash(head content)` (i.e. not a same-PR re-approval).
  - `REAPPROVES` - hashes differ and the same PR carries a matching sidecar (the file-set /
    `hash-binding` rules of the existing check then judge that record as today).
  - `DELETED` - the approvable is removed while a base sidecar exists.
- **FR-3 Silence on no live approval.** An approvable with **no sidecar on the merge base**
  produces no output and no verdict. A sidecar that exists but is unreadable, or lacks a string
  `specHash`, is NOT "no approval": it is reported `UNREADABLE` and fails closed (invariant 2).
  "No approval" is established only by the base path being absent (git reports it missing), not
  by a read error.
- **FR-4 Exit semantics.** `STRANDS`/`DELETED`/`UNREADABLE` must be visible in the check's
  output and in the PR-facing signal. Whether they are exit-1 (blocking) or an annotated pass is
  a Clarify decision (D1); under either option the verdict line is always printed.
- **FR-5 Not an approval-record PR stays untouched.** A PR with no sidecar and no changed
  approved approvable behaves exactly as today (pass, same message). FR-1..4 add verdicts; they
  do not change any existing check's result.
- **FR-6 Fail closed.** If the base cannot be read (bad ref, git failure), the check errors
  visibly with a refusal; it never degrades to "no approvals found" (constitution invariant 2).
  Mirrors the existing CLI `try/catch` -> exit 1.
- **FR-7 Pure decision.** The verdict function takes `(rootDir, changed, readBase)` like
  `evaluateApprovalIntegrity` so the T0 suite drives it without building git history.
- **FR-8 Offline.** No network call (invariant 1); reads git only.

## Acceptance criteria

1. Spec edited (canonical change), approved on base, sidecar untouched -> `STRANDS`, named with
   spec path, base hash, head hash.
2. Spec with only `status:`/`phases:` change, approved on base -> `PRESERVES`, no warning.
3. Spec edited and sidecar re-minted to the head hash in the same PR -> `REAPPROVES`; existing
   checks still judge the record.
4. Spec edited, never approved (no base sidecar) -> silent: no verdict line at all.
5. Base sidecar present but malformed JSON / no `specHash` -> `UNREADABLE`, fail closed.
6. Approved spec deleted -> `DELETED`.
7. Batch of N edited specs: one verdict per spec; mixed approved/unapproved reports only the
   approved ones.
8. Unreadable base ref -> refusal, exit non-zero (not a pass).
9. Regression: every case the existing T0 suite covers produces identical results.
10. Distinguishing test per FR-2 verdict is red against the current `evaluateApprovalIntegrity`
    (which returns `[]` for criterion 1) and green after.

## Invariants this must not break

- Invariant 1 (offline) - FR-8.
- Invariant 2 (no silent gate) - FR-3 / FR-6: a missing or errored witness fails closed and
  visibly; "unreadable" is never conflated with "absent".
- DR-081 section 5 scope boundary: the approval-record exemption still covers only the record;
  this check adds scrutiny and exempts nothing.
- DR-029: re-approval workflow stays legal; `REAPPROVES` and `PRESERVES` are not failures.
- Invariant 3: only runs where `.minspec/approvals/` exists; a repo with no approvals dir sees
  no change.

## Decisions needed (Clarify)

All 3 decisions are answered, not ratified: an agent session selected, for each, the option this document
already recommended. No human chose them, and no delegation covers authoring Clarify answers
(DLG-001, DR-108, covers spec approval and engineering-DR acceptance only). This spec is
unapproved, so these answers bind nothing until a human or a covered delegation approves it.

- **D1 - blocking or advisory for `STRANDS`?**
  - (a) **Annotate, exit 0** (rec): print the verdict and surface it as a PR comment/summary
    line. Cost: it is a warning, so nothing stops a PR that strands a sign-off if nobody reads
    it - the same "ignored check looks like coverage" risk the issue names.
  - (b) Exit 1 unless the PR labels/declares intent to re-approve. Cost: needs an
    intent-declaration mechanism and blocks the routine "edit now, re-approve next" flow,
    inviting `--admin` bypass, which is the failure DR-081 was written against.
  **Recorded selection: Option (a),** annotate and exit 0; print the verdict and surface it as a PR comment or summary line. An agent session copied this document's (rec) option; no human chose this item.
- **D2 - where does the signal live?** (a) `approval-integrity.ts` only (rec: it is the shipped
  copy adopters run; cost: the LLM voters, fed by `approval-provenance.py`, do not see it).
  (b) Also add it to `approval-provenance.py` so voters see it; cost: two implementations of one
  predicate that can drift (the project's recurring duplicate-predicate failure) unless one
  calls the other.
  **Recorded selection: Option (a),** the signal lives in `approval-integrity.ts` only. An agent session copied this document's (rec) option; no human chose this item.
- **D3 - wiring.** `approval-integrity` is currently advisory, not in the required-check set
  (its own header). Should this verdict wait for that wiring, or ship ahead as advisory output
  on every PR? Rec: ship ahead as advisory output; cost: output on every PR touching an
  approved spec until the check is wired.
  **Recorded selection: ship ahead,** ship the verdict ahead of the wiring, as advisory output. An agent session copied this document's (rec) option; no human chose this item.
