---
id: SPEC-335
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - the spec-to-code ownership contract (SPEC-038/SPEC-051/SPEC-081 follow-through)
aspects: [ownership, validator, gate-signal, fail-visible]
depends_on: []
relates_to: ["#3754", "#2323", "#1561", "#1521", "SPEC-051", "SPEC-324", "SPEC-081", "SPEC-038"]
implements: none
implements_reason: >-
  Specify phase only. Expected surface: validateOwnership in packages/minspec/src/lib/spec-validator.ts plus a backfill of existing spec frontmatter. Neither is built.
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-335: `implements: none` must not accept a deferral reason

Issue: #3754. Related: #2323 (specify-phase writer still says "leave implements for Plan"), #1561 (ownership enforced only at approval), #1521 (blanket `none` records a false claim), SPEC-051 (ownership before approval), SPEC-324 (backfill; FR-3 `none` only with evidence), SPEC-081 FR-8.

## Problem

`validateOwnership` (`packages/minspec/src/lib/spec-validator.ts:1025`) computes `validEscape = isNoneEscape && reason !== undefined`. Any present `implements_reason` satisfies it, including one that admits the spec will own code ("Specify phase only. Which files this spec will own is decided at Plan."). SPEC-051's approve-path guard (`assertOwnershipDeclaredForAdvance`, called from `approve.ts:318` and `spec.ts:784`, and reached from the drain via `specNotApprovable`) then passes the spec, so the escape is a placeholder that records a false "owns no code".

Measured 2026-11-15 on this worktree's base: `grep -lE "decided at Plan" specs/minspec/*/requirements.md` returns 64 files. The issue body said about 35 at f57cad61; the count has grown, and this is only the one phrasing. The backfill must count with the final matcher, not this grep. Includes SPEC-332's own "Specify phase only" reason, which shows this spec's template has the same flaw (see FR-6).

Root cause (mechanism plus missing gate): the escape check validates that a reason is present, never that it states an owns-nothing fact, and the specify-phase writer (#2323) still emits a deferral, so an agent refused by the guard satisfies it with the deferral. PR #3744 did exactly this on five specs; ai-review blocked it and the five were reverted (791abcfc).

## Functional requirements

- **FR-1 Deferral reason is not an escape.** `implements: none` with a reason that defers ownership is treated as no valid escape: `validateOwnership` emits `ownership.implements.missing` exactly as for an absent reason. The deferral matcher is a pure, exported function with a documented phrase list (at minimum: "decided at Plan", "deferred", "specify phase only", "to be decided", "TBD", "not yet built"), case-insensitive, matched against the folded (block-scalar-aware) reason text.
- **FR-2 Real escapes stay valid.** A reason that states an owns-nothing fact (for example "meta-spec: governs process, ships no code") is accepted. The matcher errs toward rejecting only the listed deferral phrases; it does not try to judge prose quality (that stays SPEC-324 FR-3's human/evidence job).
- **FR-3 Same verdict on every path.** The approve guard, the validator and the drain's `specNotApprovable` read one predicate; no second copy of the phrase list (duplicate predicates drift).
- **FR-4 Backfill before the rule bites.** Every spec the new rule would flag gets a real declaration per SPEC-324 FR-2/FR-3 (owned paths with evidence, or `none` with a true reason) in the same change, or the rule ships behind the existing `ownershipDeclaration: 'warn'` default and flips only when the flagged count is zero (SPEC-324 FR-7/FR-8 pattern). A merge that makes `npm run validate` red on any existing spec is refused.
- **FR-5 Zero re-approvals.** The backfill edits must not change `specHash()` of any approved spec (SPEC-324 FR-5 / SPEC-070): verify by computing hashes before and after, not by assumption.
- **FR-6 Writer side.** The specify-phase template/writer stops emitting a deferral reason. For a spec not yet in the build path it omits `implements` entirely (the validator already ignores specs before plan in-progress). This is the #2323 fix, in scope here so the matcher is not a perpetual refusal loop; if #2323 owns it, this spec cites it and sequences after it.
- **FR-7 Visible, not silent.** The fixHint for a rejected deferral names the reason as the cause ("`implements_reason` defers ownership; declare the owned paths, or state why none") so an agent does not re-submit another deferral (invariant 2).

## Acceptance criteria

- **AC-1** A T3 spec in the build path with `implements: none` and `implements_reason: Specify phase only. Which files this spec will own is decided at Plan.` yields `ownership.implements.missing`; today it yields none.
- **AC-2** The same spec with `implements_reason: Process-only spec; ships no code.` yields no ownership finding.
- **AC-3** Block-scalar (`>-`) deferral reasons are caught as well as inline ones.
- **AC-4** `assertOwnershipDeclaredForAdvance` refuses a deferral-reason spec at approval under `ownershipDeclaration: 'error'`, and warns under the default.
- **AC-5** After backfill, `npm run validate` reports zero `ownership.implements.missing` caused by deferral reasons, and no approved spec's hash changes.
- **AC-6** A one-sided test: a fixture with a deferral phrase NOT in the matcher list passes (documents the matcher's limit), so the list's boundary is visible.

## Invariants this must not break

- Invariant 2 (no silent gate): a rejected deferral is a visible finding, never swallowed or downgraded.
- SPEC-051 FR-1: ownership stays in the approved bytes (the rec keeps this).
- SPEC-038 FR-7 ratchet: default `warn` repos are not newly blocked.
- Offline, no network (invariant 1); `.minspec/` opt-in boundary unchanged (invariant 3).

## Decisions needed (Clarify)

Recorded selections: each of the 3 selections below is an agent pick of the option this document marks recommended, recorded on 2026-11-17 under the founder decision in queue item clarsel. Sign-off ratifies them and may change any of them.

1. **Reject deferral reasons vs move the guard.**
   - **(rec) Reject deferral reasons** as `ownership.implements.missing` and backfill the specs. Keeps SPEC-051 FR-1. Cost: reddens validate for every flagged spec until backfilled, so it must land with or after the backfill, and the backfill is real per-spec evidence work (64 specs and counting).
   - Accept the deferral as a recognised state and move the guard to the plan-to-tasks advance. Cost: reverses SPEC-051 FR-1 (ownership no longer in the approved bytes) and reintroduces the post-approval re-approval trap SPEC-051 removed.

   **Recorded selection: the recommended option,** reject deferral reasons as `ownership.implements.missing` and backfill the specs. Agent pick of the recommended option, founder decision queue item clarsel, recorded 2026-11-17; sign-off ratifies it.
2. **Matcher shape.** (rec) A short fixed phrase list (FR-1): cheap, deterministic, offline; cost: an agent can paraphrase a deferral past it, so it is a speed bump, not proof. Alternative: require `implements_reason` to cite a structural marker (for example an `owns-nothing:` prefix): stricter and not paraphrasable; cost: touches every legitimate `none` reason in the corpus.

   **Recorded selection: the recommended option,** a short fixed phrase list (FR-1). Agent pick of the recommended option, founder decision queue item clarsel, recorded 2026-11-17; sign-off ratifies it.
3. **Sequencing with #2323.** Land the writer fix first (rec; cost: delays the gate), or bundle both here (cost: larger T3 diff, two concerns in one PR).

   **Recorded selection: the recommended option,** land the writer fix (#2323) first. Agent pick of the recommended option, founder decision queue item clarsel, recorded 2026-11-17; sign-off ratifies it.
