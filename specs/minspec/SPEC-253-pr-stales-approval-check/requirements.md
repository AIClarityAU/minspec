---
id: SPEC-253
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - a founder sign-off must not be staled by a model-trusted signal
aspects: [approval, gate, no-silent-gate, offline, pull-request]
depends_on: []
relates_to: ["#2352", "#2347", "#1079", SPEC-022, SPEC-029, DR-012, DR-081, DR-066]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decisions D1-D3.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-253: A pull request that stales a founder approval is flagged by a deterministic check, not by which reviewer run you get

> **This is a SPECIFICATION ONLY.** Written for issue #2352. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.
> No decision record is minted: the design adds a check and a status line, both undone in
> under a day (DR-359 ADR filter). The hash lock itself is already decided by DR-012.

## In plain terms

A pull request that edits the body of an approved spec changes its canonical hash. The
sidecar on the base branch records the old hash, so on merge the spec silently moves from
`approved` to `stale`. Today nothing deterministic says so. On #2347 (head `7c527a45`) two
`ai-review` runs on the same spec content, about three minutes apart, disagreed: the first
(`changes`) computed both hashes and blocked, the second (`pass`) never mentioned the approval.
Every check was green, including `MinSpec SDD validation`, and the PR carried `ai-review:pass`
and `awaiting-approval`.

The comparison is pure and offline: `specHash(head)` against the `specHash` recorded in the
base sidecar. It should be a check, not a reviewer's judgement.

## Root-cause diagnosis (reported on #2352; to re-measure at Plan)

**Mechanism.** The only thing that notices a hash mismatch on a PR is the reviewer model. The
`MinSpec SDD validation` job runs `npm run validate` (`.github/workflows/minspec-validate.yml`),
which validates the tree as it stands; "stale" is a legitimate state of a tree (an edit before
re-approval), so it is not a validation failure. The PR-relative question, "does this change
turn an approved base artifact stale?", needs the base ref and is asked by nothing.

**Missing gate.** A check with the base ref in hand. `scripts/approval-integrity.ts` already
reads base-side witnesses (`baseWitnesses`, `:332`), but it judges approval-record PRs (DR-081
§4), not content PRs.

**Not yet verified (do at Plan).** I have not re-run the hash comparison on #2347 and have not
confirmed that no existing job already covers this; the issue states this as unread too.

## Functional requirements

- **FR-1 Detect.** For every approvable file changed by a PR (specs `requirements.md` /
  `design.md` / `tasks.md`; the exact set is whatever the existing approval reader treats as
  hash-locked, per D1) that has a sidecar on the BASE ref, compute `specHash(head content)`
  with `packages/shared/src/canonical.ts` and compare with the base sidecar's recorded
  `specHash`. Apply `resolveStatus` semantics (`packages/minspec/src/lib/approval.ts:483`).
- **FR-2 Matching re-approval.** The PR is clean for that file when the head tree carries a
  sidecar whose recorded `specHash` equals `specHash(head content)`. Anything else is a staled
  approval. (A canonicalization-neutral edit, such as a `status:` flip, does not change the
  hash and is therefore not flagged.)
- **FR-3 Report visibly.** A staled approval is reported as a named check result listing each
  file, the base hash, the head hash, and the one-line remedy (re-approve via the normal
  approval flow, or revert the body edit). Per D2 it is a failing check or an advisory one.
- **FR-4 Fail closed.** If the base ref, a base sidecar, or the head file cannot be read or
  parsed, the check reports an error naming what was missing. It never reports pass on a
  witness it could not obtain (constitution invariant 2).
- **FR-5 Offline, deterministic.** Git object reads and `specHash` only. No network call, no
  model call (constitution invariant 1).
- **FR-6 Independent of the reviewer.** The result does not depend on any `ai-review` verdict,
  and neither reads the other. This is the second witness; the reviewer remains a third.
- **FR-7 Scope.** Files with no base sidecar (unapproved, new, or renamed away) are not flagged.
  A deleted approvable that had a sidecar is reported as informational, not as a stale.
- **FR-8 Repo opt-in.** Runs only where `.minspec/` exists at the repo root (constitution
  invariant 3).

## Acceptance criteria

- **AC-1** Given a base spec with a matching sidecar and a PR that edits its body without
  touching the sidecar, the check reports that file stale with both hashes. (#2347 shape.)
- **AC-2** Same PR plus a head sidecar whose hash equals `specHash(head)`: clean.
- **AC-3** A PR that changes only the `status:` line: clean (hash unchanged by canonicalization).
- **AC-4** A PR touching an unapproved spec, or a spec with no base sidecar: clean.
- **AC-5** Unreadable base ref or malformed sidecar: the check errors; it does not pass.
- **AC-6** Two runs on identical inputs give identical output, with no reviewer involved.
- **AC-7** The fixture for AC-1 is red against a tree without the check and green with it
  (distinguishing test, not a source-text assertion).

## Invariants this change must not break

1. Offline, no network call (constitution invariant 1).
2. No silent gate: no swallowed errors, missing witness fails closed (invariant 2).
3. Blast radius is `.minspec/` repos only (invariant 3).
4. The hash lock and `specHash` canonicalization (DR-012, SPEC-022) are read, never changed.
5. The record-PR gate (`approval-integrity`, DR-081) keeps its meaning; this check is for
   content PRs and must not weaken it.

## Out of scope

- Landing a body correction and its re-approval in one PR (#1079): this spec only makes the
  stale visible. Whether FR-2 can ever be satisfied by one PR depends on how #1079 resolves.
- Changing what `ai-review` is told about approvals.

## Decisions needed (Clarify)

- **D1 Which files count as approvable.** (a) Specs only, `requirements.md`/`design.md`/
  `tasks.md` **(rec)**: matches the reported failure; cost: DRs and epics with sidecars can
  still be staled unflagged. (b) Everything with a sidecar under `.minspec/approvals/`: closes
  the class; cost: needs the sidecar-to-artifact path map to be exact, and any mismatch is a
  false red.
- **D2 Blocking or advisory.** (a) Required check **(rec)**: a model-trusted gate is the
  defect, and a required deterministic one is the fix; cost: it blocks a PR that stales
  deliberately until the re-approval lands, which today needs two PRs (#1079), so legitimate
  body fixes to approved specs get slower. (b) Advisory first, required later: no workflow
  friction now; cost: another signal a merger can ignore, the shape DR-081 warns of.
- **D3 Where it runs.** (a) A new step in `ci.yml` beside the frontmatter validate **(rec)**:
  one place, reuses installed deps; cost: if a path filter skips that job on spec-only PRs the
  check goes silently unrun, so Plan must prove it runs on exactly those PRs. (b) Extend
  `scripts/approval-integrity.ts`: reuses base-ref plumbing; cost: conflates two PR kinds in
  a gate whose contract is the record PR.
