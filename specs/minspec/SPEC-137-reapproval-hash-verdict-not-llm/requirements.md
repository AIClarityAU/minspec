---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — same epic as SPEC-069, the spec whose gap this closes
aspects: [ai-review, approval, gate-integrity, fail-closed, never-wrong, false-positive]
relates_to: [SPEC-069, SPEC-031, SPEC-050, DR-081, DR-079, DR-033, "#868", "#867", "#1017", "#1029", "#1654"]
implements: []
affects: [scripts/review-branch.sh, scripts/approval-provenance.py, scripts/review-decide.sh]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — A re-approval's hash validity is a deterministic verdict the LLM panel cannot overturn (Requirements)

> Triggered by **[#868](https://github.com/AIClarityAU/minspec/issues/868)** (observed on
> [#867](https://github.com/AIClarityAU/minspec/issues/867), the SPEC-021 re-approval). Builds on
> SPEC-069 (approval-record deterministic witness, DR-081) rather than restating it.

## Why this spec exists when SPEC-069 and #1017 already exist

#868's issue text says the reviewers "cannot compute canonical hashes". That is only half
right today, and the half that is wrong changes the fix:

- `scripts/review-branch.sh` already computes the sidecar-vs-tree verdict deterministically
  (`approval-provenance.py`, `VERDICT: MATCHES`/`MISMATCH`, re-approval vs forgery) and injects
  it into the prompt as a TRUSTED `<approval_provenance>` block (#1017). Reviewers also hold
  Read/Glob/Grep, so they can open the base spec.
- Yet #867's panel still called a MATCHING record forged. So the defect is not missing
  evidence; it is that the evidence is **advisory prompt text** and the panel's contrary
  inference still decides the verdict (`approval-provenance.py` `main()` always exits 0 and its
  output is consumed only as prompt text, per SPEC-069's evidence table).
- SPEC-069 is the structural cure (exempt the approval-record PR from the panel behind a
  deterministic `approval-integrity` check). It is staged (FR-10: advisory first, exemption armed
  last) and unbuilt, so every honest re-approval before that point is still exposed to the false
  block. SPEC-069's acceptance "#1029 does not recur" is the same property as #868.

This spec therefore does **not** re-specify the witness. It states the one property #868 needs
that SPEC-069 leaves implicit, and an interim guard that holds until SPEC-069 is armed.

No DR is minted: DR-081 is the in-force decision on the same question; nothing here is
irreversible within a day.

## One-Sentence Scope

When the deterministic provenance verdict for an approval-sidecar change is `MATCHES`, no
panel finding whose only basis is "the hash changed without a content change in this diff" may
block the PR.

## Functional Requirements

### FR-1 — The hash claim is decided by the tool, never by the LLM
For a changed sidecar, "does `record.specHash` equal the canonical hash of the approvable?" is
answered only by the existing canonical hasher (the Node or Python twin; no third hasher, per
SPEC-069 FR-4), evaluated against the tree at head — including content that landed on the base
branch in an earlier merge. The panel is never the asserting party in either direction.

### FR-2 — A MATCHES verdict suppresses the hash-only finding
If the provenance verdict for a sidecar is `MATCHES`, a reviewer finding that claims the record
is forged/mismatched solely from "hash changed, no spec change in this diff" is discarded by the
parent before the verdict is decided, with the discard stated in the posted review. Findings on
any other ground (approver identity, ride-along content, tier) are untouched.

### FR-3 — A MISMATCH verdict is still decided by the tool
A `MISMATCH` (or an indeterminate verdict) is not softened: it fails closed and visibly, naming
the sidecar and both hashes.

### FR-4 — Fail closed on a missing witness
If the provenance step errors, times out, or yields no verdict for a PR that changes a sidecar,
the PR is NOT treated as `MATCHES`; today's `|| true` swallow
(`review-branch.sh` provenance call) must become a visible degraded state (constitution
invariant 2).

### FR-5 — Retires itself under SPEC-069
Once SPEC-069 FR-5 arms the exemption, this guard applies only to non-exempt PRs that still
change a sidecar (e.g. sidecar plus other files). It must not create a second, divergent
predicate for "is an approval-record PR".

## Invariants (must not break)
- **INV-1** No silent gate: a missing or errored witness never reads as pass (constitution 2).
- **INV-2** Offline: no network call beyond the run's own GitHub API (constitution 1).
- **INV-3** Substance gate intact: a PR that edits spec body or other files still gets a full
  panel verdict; the suppression in FR-2 is scoped to the hash-only claim.
- **INV-4** One hasher: no new canonicalization implementation.
- **INV-5** Blast radius: changes only this repo's review machinery (constitution 3).

## Acceptance Criteria
- [ ] **#867 shape passes.** A sidecar-only PR whose `specHash` equals the canonical hash of the
      base-branch approvable, with the spec change on base, yields no blocking hash finding even
      if a voter raises one.
- [ ] **Forgery still blocks.** A sidecar with a hash that does not match any tree content is
      blocked, naming the mismatch.
- [ ] **Other grounds survive.** A MATCHES PR with a disallowed `approvedBy` is still blocked.
- [ ] **Witness failure is visible.** Forcing the provenance step to fail yields a visible
      degraded/blocked state, not a pass.
- [ ] **No second predicate.** Under SPEC-069's armed exemption, no code path decides
      "approval-record PR" differently.

## Decisions needed (Clarify)

- **D-1 — Separate spec, or fold into SPEC-069?**
  - (a) **Fold into SPEC-069** **(rec)** — one owner, one predicate. Cost: SPEC-069 is approved
    and hash-locked, so the edit voids its approval and needs re-approval; and it leaves
    #868 unfixed until SPEC-069's staged rollout completes.
  - (b) Keep this interim spec — fixes the false block now. Cost: a second mechanism that must
    be retired, and a risk of the two predicates drifting (FR-5).
- **D-2 — Where does FR-2's suppression live?** (a) in `review-decide.sh` (the deterministic
  fail-closed gate, **rec**; cost: it needs a machine-readable tag on findings the voters do not
  emit today, so it touches voter output schema, DR-079) or (b) a prompt edit telling voters the
  verdict is binding (cost: prose where a gate belongs — the failure mode the constitution names).
- **D-3 — Is FR-4 in scope here** or its own issue? Rec: here, since it is the same witness;
  cost: it widens the diff to a gate (`review-branch.sh`) classed as machinery needing human merge.

## Risks & Mitigations
- Suppressing a finding could hide a real forgery → FR-2 keys only on the tool's `MATCHES`, which
  recomputes the hash from the tree; FR-3 keeps `MISMATCH` fail-closed.
- Duplicate mechanism with SPEC-069 → FR-5 and D-1.

## Follow-ups (tracked)
- SPEC-069 staged rollout (arms the structural exemption): tracked under #1376.
- None otherwise.
