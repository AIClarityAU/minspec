---
id: SPEC-324
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology — the spec→code ownership contract (SPEC-038/SPEC-081 follow-through)
aspects: [ownership, corpus-backfill, ratchet, no-silent-gate, tier-0]
depends_on: [SPEC-081, SPEC-070]  # SPEC-081 ships the findings + FR-6 count; SPEC-070 (DR-088) makes a declaration cost no re-approval
relates_to: [SPEC-038, SPEC-051, SPEC-022, DR-088, DR-076, "#3650", "#1543", "#1521"]
# Owns the three files it edits: its deliverables are a severity change there plus backfill edits to other specs' frontmatter.
implements: [scripts/validate-frontmatter.ts, packages/minspec/src/lib/template-registry.ts, packages/minspec/src/lib/spec-validator.ts]
affects: [packages/minspec/src/lib/spec-validator.ts, packages/minspec/src/lib/template-registry.ts, scripts/validate-frontmatter.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Declare the 12 phaseless specs' ownership, then join the fallback findings to the `ownershipDeclaration` dial (Requirements)

> Materializes **[#3650](https://github.com/AIClarityAU/minspec/issues/3650)**, the two follow-ups
> SPEC-081 deliberately deferred (its DQ-2 option (a) and DQ-4 option (a)). Dispatched
> Specify-only per DR-076 / #1169. No DR is needed: every choice here is cheap to reverse
> (a frontmatter line, a severity constant). Rationale already lives in SPEC-081, SPEC-038 FR-7
> and DR-088.

## One-Sentence Scope

Once SPEC-070's basis change is on `main`, author a reasoned `implements:` declaration for each of
the 12 phaseless approved T3/T4 specs that declare none, then flip SPEC-081's fallback-armed
findings from `warning` to the `ownershipDeclaration` dial once its printed count reads zero.

## Context

- SPEC-081 (#1543) arms the ownership rule on phaseless approved specs but ships the new
  findings as warnings (its DQ-2a) so `main` does not go red. Its FR-6 prints the count of
  fallback-armed and `signal-absent` specs on every `npm run validate`.
- The 12 specs (measured at `ff613c62`, per #3650): SPEC-001, SPEC-016, SPEC-018, SPEC-019,
  SPEC-021, SPEC-023, SPEC-024, SPEC-028, SPEC-030, SPEC-032, SPEC-033, SPEC-037. Paths
  verified at this spec's writing: SPEC-001 is the root `specs/minspec/{requirements,design,tasks}.md`;
  SPEC-016 and SPEC-019 live under `specs/agent-execute/`; the rest under `specs/minspec/`.
  All are `status: implementing`; T3 or T4.
- Before SPEC-070, adding `implements:` to an approved spec changes its hash and stales the
  approval (SPEC-051's trap); with FR-5 of SPEC-081 it would also immediately freeze the newly
  declared files. After SPEC-070 (ownership leaves the hash, DR-088) a declaration costs zero
  re-approvals. **State at writing:** SPEC-070 is `status: planning` (not built); SPEC-081 is
  `planning`. This spec is therefore not actionable yet — see FR-1.
- A blanket `implements: none` is not a fix (#1521, SPEC-081 FR-8): it records a false
  declaration for any spec that genuinely owns code, and destroys the signal.

## Functional Requirements

- **FR-1 — Trigger gate, checked not assumed.** Work under this spec MUST NOT start until
  (a) SPEC-070's basis-change slice is on `main` — evidenced by the code (the hash
  canonicalization strips ownership keys; cite `file:line`) and SPEC-070's `status`, not by an
  issue being closed — and (b) SPEC-081's implementation is on `main` such that
  `npm run validate` prints the FR-6 counts. The implementing PR body states both observations.
- **FR-2 — One reasoned declaration per spec.** For each of the 12 specs, determine from the
  spec's own tasks and the code it produced which files it *created* (`implements:`), which it
  only modified (`affects:`), or that it owns nothing (`implements: none`). Each choice cites
  its evidence in the PR body (one line per spec: id → decision → how determined). No batch
  default.
- **FR-3 — `none` only with evidence.** `implements: none` is permitted for a spec only when its
  tasks/code show it created no file. The PR body lists every `none` separately for the reviewer.
- **FR-4 — Inline list form.** Declarations use inline `[a, b]` form, never block-form YAML
  (#1961: both twins truncate a block list to its first item).
- **FR-5 — Zero re-approvals, verified.** After the edits, `specHash()` for each of the 12 is
  unchanged versus its committed sidecar (no approval goes stale). If any hash changes, SPEC-070
  is not in effect: stop and report (do not re-approve as a workaround).
- **FR-6 — Declared files must resolve and be reviewable in small batches.** Every declared
  path exists on `main`. Declarations land in batches of at most 4 specs per PR so a reviewer can
  check each against the code. (Batch size is DQ-1.)
- **FR-7 — Join the dial at zero.** When FR-6's printed fallback-armed-undeclared count is `0`,
  change the severity of the fallback-armed `ownership.implements.missing` and of
  `ownership.arming.signal-absent` from fixed `warning` to follow `ownershipDeclaration`, in
  `spec-validator.ts` and its adopter twin emitted by `template-registry.ts` (`validate.py`).
  The change is one severity expression per site, with the parity test of SPEC-081 FR-4 extended
  to cover it.
- **FR-8 — The flip is refused while the count is nonzero.** The FR-7 change MUST NOT merge
  while the printed count is nonzero; the PR body quotes the measured zero. Adopters stay at
  their own dial value (default `warn`), so the flip never pushes an adopter red (SPEC-081 INV-3).
- **FR-9 — Stale prose swept.** Comments that describe the fallback findings as
  warning-only/rollout-state are updated in the FR-7 change, and a grep for the old wording
  is run and cited.

## Acceptance Criteria

- [ ] **AC-1 (FR-1).** The implementing PR cites the SPEC-070 canonicalization `file:line` and
  both specs' `status`, and a pasted `npm run validate` run shows the FR-6 counts.
- [ ] **AC-2 (FR-2/3).** The PR body has 12 lines, one per spec, each with an evidence note;
  `none` entries are listed apart. Every spec's `implements:`/`affects:` is present.
- [ ] **AC-3 (FR-4/6).** No block-form lists; each declared path exists; no PR touches more
  than 4 specs.
- [ ] **AC-4 (FR-5).** Hash-before equals hash-after for all 12, and `git diff` of those files
  shows only the frontmatter declaration lines.
- [ ] **AC-5 (FR-7/8).** After the backfill, `npm run validate` prints fallback-armed
  undeclared count `0`; the flip PR's diff is one severity expression per site; with
  `ownershipDeclaration: "error"` a fixture phaseless-undeclared spec fails, with `warn` it warns,
  identically in TS and Python.
- [ ] **AC-6 (FR-9).** The old-wording grep returns nothing in the touched files.

## Invariants

- **INV-1 (no silent gate).** The flip is gated on a *printed measured* zero, not on memory.
  A missing count line means "did not run" and blocks the flip (constitution invariant 2).
- **INV-2 (blast radius).** The adopter twin follows the adopter's own dial; nothing changes in
  a repo whose dial is not `error` (constitution invariant 3).
- **INV-3 (no re-approval churn).** No approval is re-minted to land a declaration.
- **INV-4 (no mint of consent).** This work never approves a spec on anyone's behalf.
- **INV-5 (offline).** No network call (constitution invariant 1).

## Out of Scope

- Changing SPEC-081's arming predicate or severity of anything other than the two named findings.
- Declaring ownership for specs other than the 12 (they are not fallback-armed).
- Building SPEC-070 or SPEC-081.

## Decisions needed (Clarify)

Recorded selections: each of the 3 selections below is the option this document marks recommended, copied by the runner's agent on 2026-11-13. These are not human choices and no delegation made them; the approver confirms or changes each.

### DQ-1 — Batch size and shape of the backfill

- **(a) (rec) Up to 4 specs per PR, grouped by area** (agent-execute: 016, 019; approval/merge
  inbox: 023, 024, 028, 030, 032; governance/identity: 033, 037; editor/refs: 018, 021;
  root: 001). **Cost:** about 4 PRs and 4 reviews rather than one.
- **(b) One PR of all 12.** **Cost:** a reviewer cannot realistically check 12 evidence lines
  against code; the bulk-sign-off shape #1543 warns against.

**Recorded selection: Option (a),** up to 4 specs per PR, grouped by area. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.

### DQ-2 — Who decides each declaration

- **(a) (rec) An agent proposes with evidence; a human or ai-review reads the PR.** Matches
  DR-076 (model-defending gates; HITL only for spec reading and irreversible acts).
  **Cost:** an agent may mis-attribute ownership of a file; the evidence line is the only check.
- **(b) The founder authors all 12 by hand.** **Cost:** directly contradicts tenet 1 for a
  reversible frontmatter edit.

**Recorded selection: Option (a),** an agent proposes each declaration with evidence; a human or ai-review reads the PR. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.

### DQ-3 — Does the flip wait for every spec, or only the fallback count?

- **(a) (rec) Only FR-6's fallback-armed count must be zero** — exactly the grandfather
  criterion SPEC-038 FR-7 and SPEC-081 DQ-2 set. **Cost:** none new.
- **(b) Also require a clean count of `signal-absent`.** **Cost:** couples this flip to specs
  that merely lack a phases block, which SPEC-081 treats as a separate remedy (add a block via the tool).

**Recorded selection: Option (a),** only FR-6's fallback-armed count must be zero. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Started before SPEC-070 ships; each declaration stales an approval. | FR-1 evidence gate, FR-5 hash check. |
| R2 | Declared files immediately freeze (SPEC-081 FR-5) against a stale sidecar. | Check each spec's sidecar state first; report, do not re-approve (INV-4). |
| R3 | Count reaches zero by `implements: none` spam, hollowing the signal. | FR-3 evidence rule; `none` listed separately. |
| R4 | Flip PR lands while a new phaseless spec appears. | FR-8: count measured at merge, not at authoring. |

## Follow-ups (tracked)

- None new. The only trigger is FR-1, visible on every `npm run validate` run.

## Traceability

- **Issue:** #3650. **Parents:** SPEC-081 (DQ-2a, DQ-4a), SPEC-038 FR-7, SPEC-070 / DR-088,
  SPEC-051, #1521, #1543, #1961.
