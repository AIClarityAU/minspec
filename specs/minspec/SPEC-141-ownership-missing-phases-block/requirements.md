---
id: SPEC-141
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a validator that treats an absent field as "not yet" lets status lie
aspects: [validator, ownership, asymmetry, no-silent-gate]
depends_on: [SPEC-038]
relates_to: [SPEC-038, SPEC-056, SPEC-022, DR-003, "#1441", "#1440", "#1391", "#1179", "#137", "#1317"]
implements: [packages/minspec/src/lib/spec-validator.ts, packages/minspec/tests/ownership.test.ts]
---

# MinSpec — Ownership rule must not be disarmed by an absent `phases:` block (Requirements)

> Materializes **[#1441](https://github.com/AIClarityAU/minspec/issues/1441)** (Specify phase only). Amends SPEC-038 FR-3; does not replace it.

## Context

SPEC-038 FR-3 requires a T3/T4 spec "past Clarify" to declare `implements:` (or `implements: none` + reason). `validateOwnership` (`packages/minspec/src/lib/spec-validator.ts:987`) decides "past Clarify" **only** from `phases.plan` being `in-progress`/`done`.

`parseSpec` (`packages/minspec/src/lib/spec.ts:138-142, 325-329`) maps an absent `phases:` block — and every absent key — to `'pending'`. So a spec with no `phases:` block is indistinguishable from "all phases pending", `inBuildPath` is false, and the rule returns `[]` without reading `status:`. A T3 spec can sit at `status: implementing` with no ownership declaration and stay green (the validator-asymmetry class, #137: it validates a present value but never asserts one should exist).

Measured on this base (grep of `^phases:` and `^tier: T[34]` over `specs/*/SPEC-*/requirements.md`): **~22 T3/T4 requirements specs have no `phases:` block**, almost all `status: implementing`/`done`, and **~12 of them declare no `implements:`** (e.g. SPEC-018, 021, 023, 024, 028, 030, 032, 033, 037; agent-execute SPEC-016, 019). The fix therefore surfaces a real backlog; see Decisions needed.

The motivating instance, SPEC-056, is already `status: superseded` on this base with no approval sidecar, so the issue's item 3 (revert SPEC-056 / revoke its approval) is **moot here** and out of scope. Verify at plan time against `origin/main`; if #1440's state differs, reconcile there, not here.

## Functional requirements

- **FR-1 — Absent `phases:` is a fact the parser reports.** The parsed model MUST distinguish "no `phases:` block" from "block present, all pending" (e.g. a `phasesDeclared: boolean`), without changing the existing `phases` values consumers read.
- **FR-2 — Fallback "in build path".** When `phases:` is absent on a primary requirements spec of tier T3/T4, `validateOwnership` MUST treat the spec as in the build path iff its literal `status:` is `implementing` or `done` (the states unambiguously past Clarify). Literal `status:` is used here only because there is no phase data to derive from; where `phases:` is present, the existing `phases.plan` rule is unchanged.
- **FR-3 — Missing block is its own finding.** A primary T3/T4 requirements spec with no `phases:` block MUST yield a new violation `spec.phases.missing` when its literal `status:` is not `new`/`specifying` (i.e. it claims to have progressed). Severity follows the same `ownershipDeclaration` ratchet (`warn` default, `error` once the corpus is clean). Fix hint: add a `phases:` block.
- **FR-4 — No regression.** A spec with `phases.plan: pending` (block present) still yields no ownership finding. T1/T2 and non-primary specs are unaffected. `status: specifying`/`new` with no block yields neither finding (nothing claimed yet).
- **FR-5 — Two witnesses.** The shipped template port of the rule (`template-registry.ts` ~1765/1932, "line-for-line" with `validateOwnership`) MUST get the same change in the same PR, so CI and the extension agree (constitution invariant 2). Parity is pinned by test.

## Acceptance criteria

- **AC-1** `tier: T3`, `status: implementing`, no `phases:`, no `implements:` → `ownership.implements.missing`.
- **AC-2** `tier: T3`, `phases.plan: pending`, `status: specifying` → no ownership finding.
- **AC-3** `tier: T3`, `status: implementing`, no `phases:` → `spec.phases.missing`.
- **AC-4** Same spec with a valid `implements:` still yields `spec.phases.missing` (FR-3) but not the ownership finding.
- **AC-5** `tier: T2`, no `phases:`, `status: implementing` → no finding.
- **AC-6** The template port yields identical rule ids for AC-1..AC-5.
- **AC-7** A regression test fails on base (AC-1 returns `[]`) and passes on head.

## Invariants

- **INV-1** Severity default stays `warn` until the legacy backlog is resolved; this spec MUST NOT turn an existing green corpus red by itself (FR-7 ratchet).
- **INV-2** The rule asserts presence, not truth of the declared paths (unchanged from SPEC-038).
- **INV-3** Offline, no network (constitution invariant 1).

## Out of scope

- Reverting/revoking SPEC-056 (already superseded) and the SPEC-053/054/055/057 revert (#1440).
- Backfilling `phases:`/`implements:` onto the ~22 legacy specs (see Decision 1).
- The approval-past-Clarify guard itself (#1317).

## Decisions needed (Clarify)

### DQ-1 — Legacy specs with no `phases:` block (~22 specs)
- **(a) Warn now, backfill as separate issue(s), flip to error later (rec)** — consistent with the SPEC-038 FR-7 ratchet; cost: the warnings sit in the output until someone does the backfill, and a warning is the weakest form of the very gate this spec is about.
- **(b) Backfill in the same change** — corpus is clean at merge; cost: ~22 spec edits that each void their approval hash (SPEC-038 header) and need re-approval, a large human-review burden and far wider than "T3" scope.
- **(c) Grandfather list** — exempt named ids permanently; cost: a silent allow-list that rots, the shape invariant 2 warns against.

### DQ-2 — Is "literal `status:`" acceptable as the fallback?
`deriveStatus` (`lifecycle.ts:133`) says the gate must never read the literal `status:` line, because it is forgeable. With no phases there is nothing to derive from.
- **(a) Literal status, only when `phases:` is absent (rec)** — simplest, matches the issue; cost: forgeable in exactly one direction (writing `specifying` on an advanced spec hides it), though that spec is then visibly mislabelled.
- **(b) Treat any T3/T4 spec with no `phases:` as in the build path regardless of status** — cannot be dodged; cost: false positives on brand-new specs being drafted.

### DQ-3 — Severity of `spec.phases.missing` (FR-3)
Reuse the `ownershipDeclaration` ratchet (rec; one knob, cost: couples two rules) or add a separate setting (independent, cost: another config key to ratchet).

## Traceability

Issue #1441; amends SPEC-038 FR-3; sibling of #1391/#1179 (approve-past-Clarify); #137 (validator asymmetry). No DR: reversible in under a day.
