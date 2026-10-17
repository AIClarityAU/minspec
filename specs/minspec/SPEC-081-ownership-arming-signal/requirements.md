---
id: SPEC-081
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology — the spec→code ownership contract (SPEC-038's sibling)
aspects: [ownership, spec-gate, validation, no-silent-gate, lifecycle, tier-0]
depends_on: [SPEC-038]  # validateOwnership, its adopter twin, and the spec-gate's owned-set are SPEC-038's
relates_to: [SPEC-038, SPEC-061, SPEC-059, SPEC-070, SPEC-051, SPEC-022, DR-088, DR-069, DR-034, DR-012, DR-003]
# Ownership declared during Specify, BEFORE any approval mints a hash (the SPEC-051 trap:
# declaring after approval stales the signature the human just gave). The only file this
# spec CREATES is its parity/behaviour suite; every production path is modified in place
# and owned elsewhere, so it goes under `affects:`. Inline form, not block form (#1961).
implements: [packages/minspec/tests/ownership-arming-signal.test.ts]
affects: [packages/minspec/src/lib/spec-validator.ts, packages/minspec/src/lib/template-registry.ts, scripts/hooks/spec-gate.py, scripts/validate-frontmatter.ts]
---

# MinSpec — An absent `plan` phase must not silently disarm SPEC-038's ownership rule or the spec-gate (Requirements)

> Materializes **[#1543](https://github.com/AIClarityAU/minspec/issues/1543)** (the
> ownership rule never fires on phaseless approved T3/T4 specs). Dispatched Specify-only
> per DR-076 / #1169. The writer that *produced* phaseless approved specs is
> **SPEC-061** (#957); the status-mirror consequence is **SPEC-059** / #1513. This spec is
> the **reader and gate** half that neither of those covers.
>
> **No new DR.** Every choice below is a validator/hook predicate that can be reverted in
> under a day (the architect role's "cannot be undone in <1 day" ADR filter). The design rests on existing records: SPEC-038 FR-3/FR-6
> (the rule), DR-069 §3 (the gate's freeze band), DR-034 (sidecar ground truth), DR-088
> (ownership leaves the hash — changes the cost of the corpus backfill, see DQ-4).

## One-Sentence Scope

When a primary T3/T4 spec carries no authored `plan` phase value, the three places that
decide "is this spec past Clarify?" for ownership (the TS validator, its shipped adopter
twin, and the spec-gate) must stop reading that absence as `pending` and silently
exempting the spec — they must either arm on the approval record or say, visibly, that
they cannot decide.

## Context

### The arming predicate reads a defaulted value as an authored one

`validateOwnership` arms only when `phases.plan` is `in-progress` or `done`
(`packages/minspec/src/lib/spec-validator.ts:799-803`). `phaseStatusOf` defaults any
missing phase to `pending` (`packages/minspec/src/lib/spec.ts:114-118`). So a spec with **no
`phases:` block** has `plan === 'pending'` indistinguishably from a spec whose author
wrote `plan: pending` — and the rule returns `[]` for both. The same predicate is
duplicated in two more places, each with the same default:

| Site | Predicate | Absent block reads as |
|---|---|---|
| `spec-validator.ts:799-803` (in-extension + corpus via `scripts/validate-frontmatter.ts:632`) | `plan === 'in-progress' \|\| plan === 'done'` | `pending` → exempt |
| `template-registry.ts:1962-1970` (the `validate.py` shipped to adopters, #2250) | `plan not in ("in-progress", "done")` → return | `"pending"` → exempt |
| `scripts/hooks/spec-gate.py:565-567` (`phase_intent_status` → `_all_pending`) | `intended not in ("implementing", "done")` → `continue` | `new` → **not gated at all** |

The third row is broader than the issue states. The spec-gate `continue`s **before**
`owned_file_set` is computed, so for a phaseless spec even a *present, correct*
`implements:` declaration freezes nothing. The gate's own docstring already admits this
(`spec-gate.py:59-62`: "a spec carrying no `phases:` block never reaches the owned-set
computation at all … its declaration arms nothing").

### Measured on this branch's base (`a23393b6`), not on the issue's `479f2f8`

The corpus has moved since the issue was filed: ownership batches #1821 and #1849 landed,
and phases batch 1 (#1661) landed. A phases batch 3 for 11 specs exists on
`fix/1513-phases-backfill` (commit `e1a7d5b2`) but is **not on main**.

A frontmatter scan of every `specs/**/*.md` on `a23393b6` for a primary (`type:
requirements` or absent) T3/T4 spec with **no `phases:` key**:

- **24** such specs. 23 have a committed approval sidecar under `.minspec/approvals/`
  (existence checked; hash freshness **not** checked — some are known stale, see below).
  The 24th, SPEC-056, is `status: superseded` with no sidecar.
- **12** of the 23 declare no `implements:` at all: SPEC-001 (`specs/minspec/requirements.md`),
  SPEC-016 and SPEC-019 (`specs/agent-execute/`), SPEC-018, 021, 023, 024, 028, 030, 032,
  033, 037. The issue's list of 20 did not include SPEC-001, SPEC-016 or SPEC-019 —
  it was drawn from the #1513 backfill set, not from the corpus — which is itself the
  argument for FR-5's computed count over any hand-kept list.
- **11** of the 23 declare ownership (SPEC-004, 005, 006, 007, 010, 011, 012, 013, 014,
  017, 063) and are still **un-gated** by the spec-gate, because they are phaseless.

Every one of these reports clean under `npm run validate` today. That is the defect:
absence of findings reads exactly like compliance.

### The source is already stopped; this is the residue plus the silent reader

SPEC-061's writer fix is on main: `advanceSpecToImplementing` no longer short-circuits a
phaseless spec and calls `setSpecPhases(…, { createIfAbsent: true })`
(`spec.ts:676-690`). New specs are also scaffolded with a `phases:` block
(`spec.ts:328`). So new phaseless approved specs should no longer be *produced* by the
tool. What remains is (a) a reader/gate that still treats "absent" as "pending", which a
hand-authored or legacy spec will keep hitting, and (b) the existing corpus residue above.

### A second silent path on the same rule

The corpus pass wraps the whole ownership loop in `try { … } catch { /* stay silent */ }`
(`scripts/validate-frontmatter.ts:630-643`). One unreadable or unparseable spec aborts the
loop for **every** remaining file with no output — the same "silence indistinguishable
from success" property, on the same rule. Constitution invariant 2 (no silent gate).

## Functional Requirements

- **FR-1 — Distinguish an authored `plan` value from a defaulted one.** The ownership
  arming decision MUST be able to tell "the spec's frontmatter states `plan: pending`" apart
  from "the spec's frontmatter carries no `plan` value" (no `phases:` key, or a `phases:`
  block with no `plan` line, or an unrecognised value). The existing `phaseStatusOf`
  collapse to `pending` MAY remain for every other consumer; only the ownership arming
  decision needs the distinction. An explicit `plan: pending` keeps today's behaviour
  (not armed) — the SPEC-026/027/031/034 lesson recorded at `spec-validator.ts:795-798`
  stands.

- **FR-2 — An absent `plan` signal arms on the approval record (validator).** When the
  `plan` signal is absent (FR-1) for a primary T3/T4 spec, `validateOwnership` MUST treat
  the spec as past Clarify **if a committed approval record exists for that spec file**
  (the SPEC-022 path-keyed sidecar, `approved` **or** `stale`). Rationale: approval is
  what *creates* `plan: in-progress` (`phasesForApproval`; see the comment at
  `spec-validator.ts:849-857`), so an approval record is direct evidence the spec was
  taken past Clarify, whatever its frontmatter lost. The decision on which evidence arms
  is DQ-1.

- **FR-3 — An absent signal with no approval evidence is reported, not exempted.** When
  the `plan` signal is absent and **no** approval record exists, the rule MUST NOT return
  silently. It MUST emit a distinct, named finding (working name
  `ownership.arming.signal-absent`) stating that the rule could not determine whether the
  spec is past Clarify and naming the remedy (add a `phases:` block via the tool). Its
  severity is DQ-2. A spec whose literal `status:` is terminal-and-inert (`archived`,
  `superseded`) is exempt from this finding only — never from FR-2.

- **FR-4 — Same predicate in all three sites, pinned by a parity test.** The arming
  decision of FR-1–FR-3 MUST be implemented identically in (a) `spec-validator.ts`, (b)
  the adopter `validate.py` emitted by `template-registry.ts`, and (c)
  `scripts/hooks/spec-gate.py`'s decision to compute an owned set. A test MUST run one
  shared fixture table (authored-pending, authored-in-progress, block-without-plan-line,
  no-block + approved sidecar, no-block + stale sidecar, no-block + no sidecar,
  no-block + archived) through all three and assert identical arm/no-arm outcomes. A
  divergence is a test failure, not a comment.

- **FR-5 — Spec-gate gates an approval-evidenced phaseless spec.** In
  `spec-gate.py`, a primary T3/T4 spec whose `plan` signal is absent but which has an
  approval record MUST be treated as in the implementation band for gating purposes, so
  its declared `implements:`/`affects:` set is computed and the existing approval verdict
  (approved → allow; stale/unapproved → deny) decides. This MUST NOT narrow DR-069 §3's
  freeze band for any spec that *does* carry a phases block. Rollout consequence is DQ-3.

- **FR-6 — Visible count on the corpus surface.** `npm run validate` MUST print, on every
  run, the number of primary T3/T4 specs whose ownership arming came from the FR-2
  fallback and the number that hit FR-3, and list them by id. Zero is printed as zero
  (so "the check ran and found none" is distinguishable from "the check did not run").
  Mirrors SPEC-059 FR-5.

- **FR-7 — The corpus ownership pass fails visibly on its own errors.** In
  `scripts/validate-frontmatter.ts`, a read or parse failure on one spec during the
  ownership pass MUST be reported against that file and MUST NOT stop evaluation of the
  remaining files. A missing `specs/` directory MAY remain silent (nothing to validate).
  Failure to read an approval sidecar for FR-2 MUST be reported, never treated as "no
  record" silently (constitution invariant 2).

- **FR-8 — Never auto-resolve the finding.** Nothing built under this spec (code, migration,
  fixture touching real corpus files, or quick-fix) may write `implements:` or
  `implements: none` into a real spec. Each declaration is a per-spec judgement
  (#1521: a blanket `none` records false declarations and destroys the signal for specs
  that genuinely own nothing). The fixHint MAY name the remedy; it MUST NOT apply it.

- **FR-9 — Stale prose swept.** The comments/docstrings that describe the phaseless gap
  as the current state (`spec-gate.py:24-25`, `:59-62`, `:340-343`; the
  `validateOwnership` JSDoc; the adopter `ownership_violations` docstring) MUST be
  updated in the same change to describe the new predicate, so no signpost keeps
  asserting the old behaviour.

## Acceptance Criteria

- [ ] **AC-1 (FR-1).** Two fixtures identical except that one has `plan: pending` and
  the other has no `phases:` block, both with an approval sidecar: the first produces no
  ownership finding; the second is armed. Proves the distinction exists.
- [ ] **AC-2 (FR-2).** A primary T3 fixture with no `phases:` block, no `implements:`,
  and a committed approval sidecar yields `ownership.implements.missing` from
  `validateOwnership`. Repeated with a **stale** sidecar: same result.
- [ ] **AC-3 (FR-3).** A primary T4 fixture with no `phases:` block and no sidecar yields
  `ownership.arming.signal-absent` (or the name chosen at Plan), not `[]`. With
  `status: archived`, yields nothing.
- [ ] **AC-4 (FR-1, regression guard).** A T3 fixture with an explicit `phases:` block at
  `plan: pending` and no `implements:` still yields no finding, with or without a sidecar.
- [ ] **AC-5 (FR-4).** The parity test runs the shared fixture table through the TS
  validator, the generated adopter `validate.py`, and `spec-gate.py`, and all three agree
  on every row. Mutation check: flipping the fallback in any single site makes the test
  fail (run and recorded in the PR, not asserted in prose).
- [ ] **AC-6 (FR-5).** A phaseless T3 fixture spec declaring
  `implements: [src/owned.ts]` with a **stale** sidecar: a `Write` to `src/owned.ts` is
  denied by `spec-gate.py`. With an approved sidecar: allowed. A file not in the set:
  allowed (DR-047 §3 fail-open for unrelated files preserved).
- [ ] **AC-7 (FR-5, band not narrowed).** The existing spec-gate suite passes unchanged —
  no spec that carries a phases block changes gated/not-gated status.
- [ ] **AC-8 (FR-6).** `npm run validate` on the corpus prints both counts and the ids,
  and prints `0` explicitly when a fixture corpus has none.
- [ ] **AC-9 (FR-7).** A fixture corpus with one unparseable spec placed **first** in glob
  order and one undeclared phaseless approved spec after it: validate reports the
  unparseable file **and** the ownership finding for the second (probe position matters —
  the failure must be tested where it would shadow others).
- [ ] **AC-10 (FR-8).** `git diff` of the implementing PR touches no file under `specs/`
  other than fixtures under the test tree; grep of the diff for `implements:` additions
  under `specs/` is empty.
- [ ] **AC-11 (corpus honesty).** The implementing PR body states the FR-6 counts measured
  on its own base commit (named by full SHA), and lists which specs start being gated
  by FR-5 with a **stale** approval (i.e. whose owned files become frozen on merge).

## Invariants

- **INV-1 (no silent gate — constitution #2).** After this change there is no input shape
  for which the ownership rule, its adopter twin, or the spec-gate's arming decision
  returns "nothing to report" without having decided. Absent evidence is a finding;
  unreadable evidence is a finding.
- **INV-2 (Tier-0 / offline — constitution #1).** Approval evidence is read from committed
  sidecars on the local filesystem. No network call, no git-host API.
- **INV-3 (blast radius — constitution #3).** The adopter `validate.py` change is shipped
  only through the existing harness-refresh path to repos that carry `.minspec/`; it does
  not change behaviour anywhere else. An adopter at `ownershipDeclaration: warn` is not
  pushed to red by this change.
- **INV-4 (hash-neutral).** Nothing here edits hashed spec content; no approval is staled
  by shipping this spec. (Adding `phases:` to a spec is hash-neutral — `canonical.ts`
  strips `status`/`phases`; adding `implements:` is **not**, until SPEC-070 lands.)
- **INV-5 (DR-069 §3 freeze band).** The spec-gate's band for specs *with* a phases block is
  unchanged; this spec only stops phaseless specs falling out of it.
- **INV-6 (one rule, three realisations).** The three sites cannot drift silently; FR-4's
  parity test is the enforcement, not this sentence.

## Out of Scope

- **Authoring `implements:` for the 12 undeclared specs.** Per-spec human judgement
  (FR-8, #1521). This spec makes them visible and gated; declaring them is separate work,
  sequenced by DQ-4.
- **Adding `phases:` blocks to the corpus** (#1513, the unmerged `fix/1513-phases-backfill`
  branch). Independent of this spec: FR-2 arms on the approval record whether or not the
  block is later backfilled, and a backfilled block simply becomes the authoritative signal.
- **The approval writer** (SPEC-061, #957). Already fixed on main for the phaseless path.
- **The literal/derived status mirror** (SPEC-059). Different rule, different finding.
- **Promoting FR-3's finding to `error`.** Decided by DQ-2's ratchet criterion, executed
  later as a one-line change, the same way SPEC-038 FR-7 flipped its own dial.

## Decisions needed (Clarify)

### DQ-1 — What evidence arms the rule when `plan` is absent?

- **(a) (rec) A committed approval record exists (approved or stale).** Approval is the act
  that creates `plan: in-progress`, so it is direct evidence of "past Clarify", it is
  already read by the spec-gate, and it is a committed, offline file.
  **Cost:** a validator that today is a pure function of one spec's text gains a
  filesystem input (sidecar path), so `validateOwnership`'s signature and its two callers
  change; and a spec whose sidecar was never committed (a local-only approval) stays
  un-armed — it falls through to FR-3's finding instead, which is visible but not a gate.
- **(b) The literal `status:` is `planning`/`implementing`/`done`.** Zero new inputs.
  **Cost:** trusts a tool-written mirror that SPEC-065 already showed can be a pre-#1651
  default stamp, not evidence of progress; a hand-edited literal would arm or disarm the
  rule.
- **(c) Arm every phaseless primary T3/T4 spec unconditionally.** Simplest; no inputs.
  **Cost:** re-introduces the false flag the current trigger was narrowed to avoid
  (SPEC-026/027/031/034 — drafts parked in Specify), for any hand-authored draft without
  a block.

### DQ-2 — Severity of the newly-armed findings during rollout

This repo is at `ownershipDeclaration: "error"`. Shipping FR-2 under that dial turns the 12
undeclared specs into 12 errors and a red `main` for every open pull request.

- **(a) (rec) Fallback-armed `ownership.implements.missing` and FR-3's
  `signal-absent` both ship as `warning` with FR-6's count, and join the
  `ownershipDeclaration` dial once the count reaches zero** (SPEC-038 FR-7's
  "grandfather ratchet, never a flag day"; SPEC-059 FR-3/FR-5 precedent). Makes the
  absence visible on day one, which is the defect #1543 names.
  **Cost:** a warning is ignorable; the 12 undeclared specs stay without a gate-armed
  declaration until someone authors one, and there is no forcing function beyond the
  printed count.
- **(b) Ship straight under the existing dial.** Immediate enforcement.
  **Cost:** a flag day — `main` goes red until 12 per-spec declarations land, and before
  SPEC-070 each declaration stales its approval (12 re-approvals in one sitting — the
  bulk-approval shape #1543 warns against).
- **(c) Hold this spec until the corpus is clean, then ship under the dial.**
  **Cost:** the issue's own first option — an unbounded wait during which the rule stays
  silently inert.

### DQ-3 — Does FR-5 freeze stale-approved phaseless specs immediately?

FR-5 makes the spec-gate compute owned sets for 23 phaseless approved specs. Those with a
**stale** approval and a declaration start denying edits to their owned files on merge.
The #1513 batch-3 commit message reports SPEC-011, 012, 013 and 014 as already stale on
an unmodified tree (claim from that commit, not re-measured here).

- **(a) (rec) Yes — gate them on merge, with AC-11's list in the PR body.** A stale approval
  freezing owned code is exactly the protection SPEC-038 exists to give; exempting it is
  the silent hole this spec closes.
  **Cost:** real edits to files like SPEC-011's `epic-backfill.ts` are blocked until a
  human re-approves those specs; sessions working there will hit a deny they never saw
  before.
- **(b) Gate them in the gate's existing WARN mode** (the `migrated` path: allowed, but
  noted) for one release, then deny.
  **Cost:** a second temporary code path in the gate that has to be remembered and removed —
  a rule that relies on someone remembering is the shape the constitution names as the
  failure mode.

### DQ-4 — When should the 12 missing declarations be authored?

Not built by this spec (FR-8), but its cost depends on ordering.

- **(a) (rec) After SPEC-070 (DR-088: ownership leaves the hash) is implemented.** Each
  declaration then costs zero re-approvals, so they can land in small, reviewable batches
  without generating approval churn.
  **Cost:** SPEC-070 is `planning`; until it ships, those 12 specs are visible (DQ-2a) but
  still own nothing the gate can freeze.
- **(b) Now, in batches of ≤5, accepting a re-approval per spec.**
  **Cost:** up to 12 human re-approvals, and — with DQ-3a — each declaration stales an
  approval and immediately freezes the newly declared files until that re-approval.

## Risks

| # | Risk | L·I | Mitigation |
|---|---|---|---|
| R1 | The three predicate copies are updated unevenly and drift again. | Med·High | FR-4 parity test with a mutation check (AC-5). |
| R2 | FR-5 freezes files that active sessions are editing, read as a gate regression. | Med·Med | AC-11 names the newly-frozen set in the PR body; the deny message names the stale spec. |
| R3 | The fallback count is ignored indefinitely under DQ-2a. | Med·Med | FR-6 prints it on every run; the ratchet promotion is a one-line change once it hits 0. |
| R4 | Adopter repos with phaseless approved specs see new warnings after harness refresh. | Low·Low | Warnings only (DQ-2a); INV-3 forbids pushing an adopter to red. `ownership-ratchet.ts`'s scaffold seed consults only error-severity findings, so seeding is unchanged under DQ-2a (to verify at Plan). |
| R5 | Reading sidecars from the validator couples it to the approval store's path layout. | Low·Med | Reuse the existing SPEC-022 path-keyed resolver; no second path computation. |

## Traceability

- **Issue:** [#1543](https://github.com/AIClarityAU/minspec/issues/1543).
- **Related issues:** #957 (writer — SPEC-061), #1513 (status drift — SPEC-059), #1521
  (why blanket `implements: none` is not a fix), #1649 (named alongside #1543 in the
  spec-gate docstring as the phases backfill), #1821 / #1849 (ownership batches already
  landed), #2250 (ownership rule shipped to adopters).
- **Specs:** SPEC-038 FR-3/FR-6/FR-7 (the rule and its ratchet), SPEC-061 (writer),
  SPEC-059 FR-4/FR-5 (missing-signal precedent), SPEC-070 (ownership leaves the hash —
  DQ-4), SPEC-051 (declare before approval), SPEC-022 (sidecars, derived status).
- **Decisions:** DR-069 §3 (freeze band), DR-034 (sidecar ground truth), DR-088
  (ownership out of the hash), DR-012 (hash lock), DR-003 (root cause = mechanism + gate).
