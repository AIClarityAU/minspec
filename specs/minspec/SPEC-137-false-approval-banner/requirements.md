---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a lock icon that says the wrong thing is a false signpost
aspects: [approval, hash, prose-claims, validator, signpost, no-silent-gate, tier-0]
relates_to: [SPEC-070, SPEC-022, DR-012, DR-003, "#1049", "#974", "#700", "#898", "#137", "#1510"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). `spec-validator.ts`
# is modified, not owned by a new file; the one NEW file is the test pinning the rule.
implements: [packages/minspec/tests/approval-banner-claims.test.ts]
affects: [packages/minspec/src/lib/spec-validator.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Correct the false approval banner in approved specs

Issue: #1049 (bug: the lock-icon banner on 12 specs is false).

## In plain terms

Twelve spec files open with a frontmatter comment that says "ANY edit voids approval" and
points at `.minspec/approvals.json`. Both halves are wrong. This spec corrects the text,
decides who pays the re-approval cost, and adds a narrow check so the wrong path cannot
be written again.

## One-Sentence Scope

Replace the false hash-lock banner in the 12 affected specs with a true one, split by
whether the edit changes the approval hash, and reject a spec that cites the gitignored
`.minspec/approvals.json` as the approval record.

## Context (measured, with sources)

- **The generator is already fixed; only the copies remain.** `packages/minspec/src/lib/spec.ts:401-404`
  records that the "Editing voids approval" line was removed from `writeSpec` after SPEC-022.
  So the issue's step 3 ("fix it at whatever writes new specs") is **already done in
  `spec.ts`**; the open work is the 12 copies and a gate. I did not find a second writer
  under `packages/*/src` or `scripts` (grep for `hash-locked`, `voids approval`, `Once approved`
  hit only comments and tests); the `spec.test.ts:608` fixture still contains the old text
  as test data (it tests comment preservation, not the claim).
- **Defect 1 is real.** `canonicalizeSpec` (`packages/shared/src/canonical.ts:89`) strips
  lifecycle keys (`status`, `phases`) before hashing, so editing them is hash-neutral.
- **Defect 2 is real.** `.gitignore:115` ignores `.minspec/approvals.json`; the tracked
  record is the per-file sidecar `.minspec/approvals/<spec path>.json`
  (`approval-store.ts:7`, `:77`).
- **A frontmatter comment is hashed content.** SPEC-070 measured that a full-line `#`
  comment survives `canonicalizeSpec`, so correcting the banner on an **approved** spec
  stales that approval.
- **SPEC-070 already owns the ordering decision for this class of edit.** SPEC-070 FR-10 and
  OQ-4 cover correcting prose that the hash change makes false across 23 files / 19 approved,
  and SPEC-070 also changes the strip set (adds ownership keys). The banner text written here
  must therefore describe the strip set that is true **at the time it lands**.
  (Counts there were stated by that spec; I have not re-derived them.)

## Functional Requirements

- **FR-1 (true wording).** The replacement banner states: the approved bytes are recorded in
  the sidecar `.minspec/approvals/**/requirements.md.json` (`.specHash`); editing the file
  voids the approval **except** for the keys canonicalization strips; re-run MinSpec: Approve
  Spec; DR-012. It must **not** hard-code a list that SPEC-070 is about to change: it names the
  mechanism ("lifecycle keys that `canonicalizeSpec` strips") and points at
  `packages/shared/src/canonical.ts`, so it stays true when the strip set changes.
- **FR-2 (per-spec hash split).** For each of the 12 files, compute `specHash()` of the
  current bytes and of the corrected bytes. A comment line is hashed, so expect **every**
  approved file to change hash. Record the table in the implementing PR. Files whose
  record is not `approved` (never hash-locked) land freely.
- **FR-3 (approved files are not silently re-stamped).** For an approved spec, the corrected
  banner lands only together with a human re-approval through the normal gate. No script may
  rewrite a sidecar `specHash` to cover the edit (that launders text the human never signed).
  Ordering relative to SPEC-070's migration is decided at Decision D1.
- **FR-4 (no new writer to fix).** Confirm, by grep with the terms named above, that no
  scaffold path emits the old banner; if one is found, change it in the same PR.
- **FR-5 (gate: gitignored approval path).** `spec-validator.ts` gains a rule: a spec whose
  frontmatter comments or body assert `.minspec/approvals.json` as the approval record
  reports a finding. Narrow on purpose: it matches that literal path only, and does not try
  to judge hashing prose in general. Severity (warn vs error) is Decision D2.
- **FR-6 (fails visible).** If the rule cannot read a spec, it reports an error for that file;
  it never skips silently (constitution invariant 2).
- **FR-7 (self-exemption).** SPEC-070 and this spec legitimately *quote* the old text and the
  legacy path as the thing being corrected. The rule exempts fenced code blocks and quoted
  lines, and the test pins that exemption so it is not a blanket allow-list.

## Acceptance Criteria

- **AC-1.** `grep -rl "ANY edit voids approval" specs` returns no file under `specs/**/requirements.md`
  except lines inside a quotation or fence (SPEC-070, this spec).
- **AC-2.** `grep -rl "approvals.json\[" specs` returns none for the 11 citing files.
- **AC-3.** For each of the 12 files the PR body shows before/after `specHash` and the
  approval state; no sidecar `specHash` is edited by the PR except through Approve Spec.
- **AC-4.** The new test fails on a fixture spec citing `.minspec/approvals.json` and passes
  on one citing the sidecar path; it also passes on a fenced quotation.
- **AC-5.** `npm test`, `npm run validate`, `npm run lint` pass.

## Invariants (must not break)

- Approval hashes: the text of an approved spec is never changed without the human approval
  gate (no laundering).
- Constitution 2 (no silent gate): FR-6.
- Constitution 3 (blast radius): the rule only inspects specs in a repo with `.minspec/`.
- Canonicalization is not changed by this spec (that is SPEC-070's scope).

## Decisions needed (Clarify)

- **D1 - Ordering against SPEC-070.** Correcting 11 approved files stales 11 approvals, and
  SPEC-070 will re-stamp the corpus under a new hash basis.
  - **(a) Correct after SPEC-070's migration (rec)**, one re-approval per file against the final
    basis, and the banner can cite the final strip set. Cost: the false banner stays live for
    as long as SPEC-070 (status `planning`) takes.
  - (b) Correct now. Cost: a second re-approval of the same files when SPEC-070 migrates.
  - (c) Correct only hash-neutral files now. Cost: none are hash-neutral (a comment is hashed),
    so this is equivalent to deferring everything; listed for completeness.
- **D2 - Severity of FR-5.** (a) **error (rec)**: the cited path never exists in a clone,
  so a hit is always wrong. Cost: it fails validate on the 11 approved files until they are
  corrected, so it must land with, or after, the corrections (see D1). (b) warning: lands
  independently, but a warning is the shape the constitution calls best-effort.
- **D3 - Should new specs get a generated banner at all?** `spec.ts:401` removed it; the
  issue wants the true one *put back*. (a) **Do not emit one (rec)**: no comment to go stale,
  and the Approve button already shows state. Cost: an author reading raw markdown gets no
  lock reminder. (b) Emit the FR-1 text from one constant, which SPEC-070's `hashLockReminder`
  appears to be (unverified here). Cost: a banner is again copy-able prose that can drift.

## Out of Scope

- Changing what canonicalization strips (SPEC-070).
- A general validator that checks prose claims against behaviour (#137 class); only the
  one literal-path rule is in scope.
- Other doc claims about hashing in body prose (SPEC-070 FR-10 owns the stripped-key claims).

## Follow-ups (tracked)

- Prose-claim validation in general: #137 (validator asymmetry).
- Ordering of corrections against the hash migration: SPEC-070 OQ-4.
