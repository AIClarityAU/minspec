---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — status must never lie in either direction
aspects: [status, signpost, never-wrong, validator, evidence-discipline, acceptance-criteria]
relates_to: [DR-003, DR-069, SPEC-064, SPEC-038, SPEC-022, SPEC-024, "#692", "#116", "#460", "#137", "#1751"]
implements: [packages/minspec/tests/status-lane-code-symmetry.test.ts]
affects: [packages/minspec/src/lib/spec-validator.ts, packages/minspec/src/lib/lifecycle.ts]
---

# SPEC-137: Status lane symmetry — status is checked against code, both directions

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers the Clarify questions, and approves it before any code changes.
> Issue: #692 (status-lane asymmetry). Rationale: DR-003 (Evidence Discipline / RCDD).

## Problem

Issue #692 (2026-07-13 audit) names three holes that let the status lane lie. Several
mechanisms have moved since the audit, so the **first Plan task is to re-measure each hole
at current `main`** (Evidence Discipline: cite `file:line` or a computed value, never the
audit's numbers). State at spec time, read from the code:

| Hole | Audit claim | Observed now |
|---|---|---|
| H1 claim gate | `'implementing'` satisfies an "implemented/done/built/shipped" claim | Still true: `SPEC_DONE_OK = new Set(['implementing','done'])`, `spec-validator.ts:1692`, consumed at `:1773`. |
| H1 precondition | Approve mints `implementing` with zero code | Partly addressed: SPEC-064 / DR-069 introduced `planning` for approved-but-unbuilt. Whether `implementing` can still be reached with zero code is **to be measured**. |
| H2 forward | `implementing` specs with zero discoverable code | Partly addressed: `implement.claimed-without-evidence` (#1751, `spec-validator.ts:1097`) checks declared `implements:` paths once `phases.implement` is active/done. It needs `pathExists` and a declared `implements:`. Corpus count **to be measured**. |
| H2 reverse | Code merged and running while spec reads `specifying` (SPEC-024) | SPEC-024 now reads `implementing` with a body note that it was never approved; the derived status floors at `specifying`. The *record* is still inconsistent. No rule detects "owned code exists on main, spec unapproved". |
| H3 | `done` requires no checked ACs | Unchanged: the validator checks only that an acceptance section exists. |

**Root cause (mechanism, proposed — verify in Plan):** status is minted by approval and
phase bookkeeping, then validated only prose-against-field. No rule compares the field
against code, in either direction, and the claim gate's "satisfying set" was sized to what
Approve emits rather than to what evidence proves. The gate that should have rejected the
bad state (a code-existence cross-check, an AC-evidence check) is missing — the recurring
validator-asymmetry class (#137, DR-003 Phase 4).

## Scope

One sentence: make the validator check spec status against code existence in both
directions, stop `implementing` satisfying a completion claim, and require evidence for
`done`. In scope: `validateStatusClaims`, a forward and a reverse ownership-vs-code rule,
a `done`-needs-checked-ACs rule, and reconciling SPEC-024's record. Out of scope: deriving
status wholesale (#116), changing `deriveStatus` semantics (SPEC-064 owns it), authoring
`implements:` for specs that lack it (SPEC-038's backfill).

## Functional requirements

- **FR-1 — claim gate sized to evidence.** `implementing` no longer satisfies an
  implemented/done/built/shipped claim about a SPEC. Satisfied set becomes `done` only —
  or `implementing` **when** the referenced spec's declared `implements:` paths all exist
  (see DQ-1). The DR claim set is unchanged.
- **FR-2 — forward rule: implementing with no code.** A spec at `implementing` or
  `done` whose `implements:` list is non-empty and has **no** existing path is flagged
  (extends, does not duplicate, `implement.claimed-without-evidence`; reuse its `pathExists`
  seam). A spec with `implements: none` + `implements_reason:` is exempt.
- **FR-3 — age threshold.** An `implementing` spec with zero existing owned paths flags only
  after N days since approval (value and clock source: DQ-2). Tier-0, offline: age is read
  from the approval sidecar's recorded date, never from the network.
- **FR-4 — reverse rule: code without approval.** A spec whose declared `implements:` paths
  exist on the base branch but whose derived status is `specifying` (unapproved) is flagged
  as a record lie. The finding names the spec, the existing paths, and the two ways out
  (approve, or drop/correct the `implements:` declaration).
- **FR-5 — `done` requires evidence.** A spec at `done` must have every acceptance
  criterion checked, **or** each unchecked one carries an explicit waiver reference
  (DQ-3). Each checked AC must cite an existing test file path (DQ-4 decides whether this
  half is gating or advisory). A missing/empty acceptance section is already caught and is
  unchanged.
- **FR-6 — fail closed and visible.** Any rule above that cannot run (no `pathExists`,
  unreadable sidecar, unparseable AC block) emits an explicit "check skipped: reason"
  finding in strict/gating contexts, never a silent pass (constitution invariant 2). The
  no-false-positive omit-the-seam behaviour remains only for callers that are documented as
  non-gating (editor lint).
- **FR-7 — severity and rollout.** New rules ship as warnings first with a corpus
  baseline, then promote to errors via the existing severity-promotion mechanism (see
  DQ-5) so the known-bad corpus does not turn CI red on landing.
- **FR-8 — reconcile SPEC-024.** Make SPEC-024's record agree with reality by one of the
  two honest routes in DQ-6. This is a spec/status edit performed by a human-approved
  change, not by the validator.
- **FR-9 — corpus reconciliation list.** Plan produces, from the rules themselves, the
  list of specs each rule flags at landing (the audit named SPEC-018/021/026/027/028/030/
  032/034 and SPEC-007/012 — re-derive, do not copy), each with a disposition
  (re-status, declare ownership, or accept-with-reason).

## Acceptance criteria

- [ ] **AC-1 (FR-1).** A doc claiming "SPEC-X implemented" where SPEC-X is `implementing`
  with no existing owned path is flagged; the same doc with SPEC-X `done` is not.
- [ ] **AC-2 (FR-2).** Fixture: `implementing`, `implements: [missing.ts]` → flagged;
  `implements: none` + reason → not flagged; owned path present → not flagged.
- [ ] **AC-3 (FR-3).** An `implementing` spec zero-code inside the threshold is not flagged;
  past it is. Age comes from the approval record (test uses an injected clock).
- [ ] **AC-4 (FR-4).** Fixture: unapproved spec whose `implements:` file exists → flagged;
  same spec once approved → not flagged by this rule.
- [ ] **AC-5 (FR-5).** `done` with an unchecked, unwaived AC → flagged; all checked → clean;
  checked AC citing a nonexistent test path → flagged (if DQ-4 = gating).
- [ ] **AC-6 (FR-6).** With the existence seam omitted in a gating invocation, the rule
  reports "skipped", asserted by test — a skipped check is never indistinguishable from a
  pass. A mutation that swallows the missing-seam case fails this test.
- [ ] **AC-7 (FR-7).** Landing the rules leaves `npm run validate` green on `main` and a
  documented baseline count per rule.
- [ ] **AC-8 (FR-8).** SPEC-024's status line, body note and sidecar state agree.
- [ ] **AC-9 (FR-9).** The reconciliation list is generated by running the rules, and its
  counts match the validator's output at the landing commit.

## Invariants the change must not break

- **INV-1 (SPEC-022).** Unapproved ⇒ `specifying`, regardless of code state. FR-4 reports
  the inconsistency; it never raises an unapproved spec's derived status.
- **INV-2.** Tier-0 / offline (constitution invariant 1): existence checks read the local
  tree and local approval sidecar only.
- **INV-3.** No silent gate (constitution invariant 2): see FR-6.
- **INV-4.** Blast radius (constitution invariant 3): rules run only in a repo with
  `.minspec/`; nothing here writes outside it.
- **INV-5.** Approval hashes are unchanged: no rule edits spec bytes covered by the
  canonical hash; FR-8 is a human-approved edit with its own re-approval.

## Decisions needed (Clarify)

- **DQ-1 — does `implementing` ever satisfy a completion claim?**
  (a) Never; claims need `done` — simplest, but a legitimately built spec that is not yet
  marked `done` cannot be cited as "implemented" in prose. **(rec)** Costs: forces
  `done` to be marked promptly, and adds friction to docs written mid-implementation.
  (b) Only when all declared `implements:` paths exist — more accurate, but ties the claim
  gate to the filesystem seam and to every spec having ownership declared.
- **DQ-2 — N days, and which clock?** (a) 14 days from approval date in the sidecar
  **(rec)** — deterministic and offline; costs: an arbitrary number, and a spec approved
  long ago then idle looks the same as one never started. (b) No age gate, flag
  immediately — strictest, but flags specs that are legitimately in their first hours.
- **DQ-3 — unchecked ACs at `done`.** (a) Hard requirement: all checked **(rec)** — real
  evidence; costs: the audit's ~52% unchecked corpus must be walked before promotion to
  error. (b) Allow a per-AC `waived: #N` marker — cheaper to land; costs: a waiver
  becomes the new rubber stamp.
- **DQ-4 — are test-file citations on checked ACs gating?** (a) Advisory warning only
  **(rec)** — citation shape is not yet a corpus convention; costs: a checked box can still
  lie. (b) Gating — closes the "checked but unproven" gap; costs: needs a citation
  convention first and a big corpus rewrite.
- **DQ-5 — rollout.** (a) Warning first, promote after the baseline is clean **(rec)**;
  costs: a window in which the lie is flagged but not blocked. (b) Error on day one with
  the reconciliation in the same change; costs: a very large first PR.
- **DQ-6 — SPEC-024 reconciliation.** (a) Run it through the real Approve step
  (human read, T4) — makes `implementing` true. (b) Re-status honestly as unapproved
  `specifying` with a note that the gate shipped ahead of its approval **(rec)**; costs:
  the record then says a running gate is "specifying", which is accurate but jarring.
  The founder's solo-mode ceremony rules (DR-075/DR-076) make this a human call.

## Open questions

None beyond the Decisions above. Plan must re-measure H1-H3 at current `main` first; if
`implementing` is no longer reachable with zero code, FR-1 still stands (the claim gate's
set is wrong regardless of what Approve emits).

## Follow-ups (tracked)

- #116 (derive status deterministically) — the long-run replacement for FR-2/FR-4; this
  spec is the interim symmetric check.
- #460 / SPEC-038 — `implements:`/`affects:` is the declaration all code checks depend on.
