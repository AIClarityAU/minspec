---
id: SPEC-059
type: requirements
status: implementing
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity
aspects: [validation, governance, tier-0, spec-gate]
depends_on: [SPEC-022]  # uses deriveStatus + the status.mirror-drift rule SPEC-022/DR-034 already built
relates_to: [SPEC-014, SPEC-018, SPEC-010, DR-003, DR-034]
implements: none
implements_reason: >-
  Creates no new source file. FR-2 wires the ALREADY-BUILT `status.mirror-drift` rule
  (SPEC-022/DR-034, living in spec-validator.ts) onto the corpus surface in
  validate-frontmatter.ts; FR-1 corrects two `status:` literals, which are spec data,
  not owned code. Every path this spec touches is modified, never created, and is
  owned elsewhere — so `implements: none` with the blast radius under `affects:`,
  matching how sibling SPEC-051 classified the same modify-don't-own shape.
affects:
  - packages/minspec/src/lib/spec-validator.ts
  - scripts/validate-frontmatter.ts
  - packages/minspec/src/lib/artifact-graph.ts
---

# MinSpec — Corpus-wide literal/derived status-mirror gate (Requirements)

> Traces to **[#917](https://github.com/AIClarityAU/minspec/issues/917)** (filed by Claude
> Code during the #914 ground-truth audit). Surfaced by [#914](https://github.com/AIClarityAU/minspec/issues/914)/[#916](https://github.com/AIClarityAU/minspec/issues/916)
> (Explain-affordance draft touched SPEC-014/SPEC-018 and re-read their frontmatter).
> Composes the accepted design [DR-034](../../../docs/decisions/DR-034.md) and its spec
> [SPEC-022](../SPEC-022-approval-foundation/requirements.md) (FR-4 derived status, INV-4
> mirror consistency) — this spec does **not** re-litigate that design, it closes a gap in
> where it is *enforced*.

## One-Sentence Scope

Correct the two named `status:` literals (SPEC-014, SPEC-018) that currently claim
`implementing` with zero implementing code, and wire the already-built
`status.mirror-drift` check onto the corpus-wide commit/CI validator surface it is
currently absent from, so a future instance of this exact drift is caught automatically
instead of by a human ground-truth audit.

## Context

### The two named instances (verified 2026-08-06, file:line)

- **SPEC-014** ([requirements.md:4](../SPEC-014-review-webview/requirements.md#L4)) —
  `status: implementing`. The spec directory holds **only** `requirements.md` — no
  `design.md`, no `tasks.md` (confirmed: `ls specs/minspec/SPEC-014-review-webview/`). Its
  own **Open questions** section (FR-OQ1, FR-OQ2) is still marked "Open — plan phase" — the
  spec has not even cleared Clarify, let alone Plan/Tasks/Implement. No implementing code
  exists for any of its FR-1…FR-18 ([spec-validator.ts:1342-1345](../../../packages/minspec/src/lib/spec-validator.ts#L1342)
  already records a prior false "Review Webview implemented" overclaim of the same
  artifact).
- **SPEC-018** (`requirements.md`, `design.md`, `tasks.md` — all three shard files) —
  every shard's literal `status:` line reads `implementing`, but `tasks.md` has **0 of 53**
  checked task items (confirmed: `grep -c '\[x\]' tasks.md` → 0) and no
  `contributes.customEditors` / `CustomTextEditorProvider` exists anywhere in
  `packages/minspec/src`.
- **Neither spec's `requirements.md` carries a `phases:` frontmatter block at all** — the
  structured signal `deriveStatus` needs is simply absent, not merely stale. Both files
  *do* have a real (non-migrated) approval record for their `requirements.md` content
  (`.minspec/approvals/specs/minspec/SPEC-014-review-webview/requirements.md.json`,
  `…/SPEC-018-spec-custom-editor/requirements.md.json`, both `approvedBy:
  github@harvest316.com`, `migrated: false`) — the requirements draft itself is genuinely
  approved. The literal status conflates "requirements approved" with "implementing",
  which are different rungs of the same ladder ([lifecycle.ts:119](../../../packages/minspec/src/lib/lifecycle.ts#L119):
  `implementing` requires `phases.implement` to be `in-progress`/`done`, not merely an
  approval).

### The mechanism (how the literal came to lie)

`git log` on SPEC-014's directory shows the literal was hand-set by
[`85d0173` "chore(#252): correct status of 6 re-approved specs (specifying →
implementing)"](../../../): its own message says *"These 6 carry valid human approvals
… restores status to implementing to match the approval."* That commit's mental model —
**approved ⇒ implementing** — was already wrong the day it was written; SPEC-022's own
`deriveStatus` table ([lifecycle.ts:108-124](../../../packages/minspec/src/lib/lifecycle.ts#L108))
requires *approved AND `implement` phase in progress*, not approval alone. This is the
**mechanism**: the literal `status:` line is a hand-authored belief about approval state,
not a value computed by `deriveStatus`.

### The missing gate (why nothing caught it)

SPEC-022 already built the fix for exactly this: `deriveStatus(phases, approvalState,
explicitTerminal)` ([lifecycle.ts:108](../../../packages/minspec/src/lib/lifecycle.ts#L108))
and a literal-vs-derived check, rule `status.mirror-drift`
([spec-validator.ts:898-923](../../../packages/minspec/src/lib/spec-validator.ts#L898-L923)),
which WARNs when the literal disagrees with the derived value. **But that check only
runs from the interactive per-spec VS Code command**
([`validateSpecCommand`](../../../packages/minspec/src/commands/validate.ts#L44-L60), which
supplies the `approvalState` the check needs) **and from unit tests**
(`spec-validator.test.ts:1123-1162`). It is never invoked from the corpus-wide commit/CI
script, `scripts/validate-frontmatter.ts` — grepping that file for `mirror-drift` or
`deriveStatus` returns nothing. So the rule that would have flagged both instances exists,
but nothing runs it against the whole corpus on every commit; a human ground-truth audit
(#914) found what the gate should have found automatically.

This is the **exact same shape** as two gaps this project has already closed the same way:
Rule 13 ([scripts/validate-frontmatter.ts:496-511](../../../scripts/validate-frontmatter.ts#L496),
`#654`) wired `checkAcceptanceCriteria` — previously enforced only by the in-extension
approve gate — onto the commit/CI path; Rule 15
([scripts/validate-frontmatter.ts:517-531](../../../scripts/validate-frontmatter.ts#L517),
`#460`/SPEC-038) did the same for `validateOwnership`. Both reused the *same* function the
interactive gate already calls, ships as **warn** first, and later ratchets to error once
the corpus is clean. `status.mirror-drift` is the next instance of that pattern, not a new
design — SPEC-022 FR-5 already specifies "the gate ships WARN, and promotes to ERROR only
once the corpus is clean" but nothing today measures corpus cleanliness anywhere but the
interactive command, so the promotion criterion is currently unobservable.

The corpus-wide derived-status computation itself is **not** new work: `buildArtifactGraph`
([artifact-graph.ts:334-354](../../../packages/minspec/src/lib/artifact-graph.ts#L334-L354))
already calls `getApprovalStatus` + `deriveStatus` for every spec `discoverSpecs` finds, to
drive the status-bar/resolver signpost. This spec's systemic fix is to feed the *same*
per-spec `(phases, approvalState, explicitTerminal)` triple into the *same*
`status.mirror-drift` check, from the commit/CI surface — not a third implementation.

## Functional Requirements

- **FR-1 (correct the two named instances, via the tool, not a hand-edit).** SPEC-014 and
  SPEC-018 MUST have accurate `phases:` frontmatter reflecting their actual phase state, and
  a literal `status:` line that agrees with `deriveStatus(phases, approvalState,
  explicitTerminal)` computed from that phases map and their real approval record. The fix
  MUST be produced by the existing lifecycle write path (the same mechanism `setSpecStatus`
  /"Approve Spec"/"Advance Phase" use), not a second hand-authored literal — hand-editing
  only the word (as `#252` did) is the exact mechanism this spec exists to stop repeating
  (DR-003 Phase-4: a data-only edit without fixing/using the gate is a tell, not a fix). If
  the two specs still lack a `design.md`/completed `tasks.md`, their honestly-derived status
  is expected to be `specifying` per the issue's own evidence, but the **authoritative**
  value is whatever the tool computes — see Decisions needed.
- **FR-2 (wire `status.mirror-drift` onto the commit/CI corpus path).** `scripts/
  validate-frontmatter.ts` MUST run the existing `status.mirror-drift` rule
  (`spec-validator.ts`'s `validateSpec`, fed `approvalState`/`explicitTerminal` per spec) over
  every spec `glob(specsDir, '.md')` discovers, mirroring Rule 13 (#654) / Rule 15 (#460):
  the **same** `deriveStatus`/`status.mirror-drift` code the interactive command already
  calls, not a reimplementation. Per-spec `approvalState` MUST come from the same resolver
  `artifact-graph.ts` already uses (`getApprovalStatus`), so split-layout/multi-file specs
  are handled identically to the status-bar signpost — this spec does not invent a second
  aggregation rule for split-layout phases.
- **FR-3 (ships WARN, not ERROR).** The corpus-wide check added by FR-2 MUST warn, never
  fail the build, on drift — consistent with SPEC-022 FR-5's warn-first ratchet and Rule
  13/15's staged-introduction precedent. Promoting this specific rule to error is out of
  scope here (SPEC-022 FR-5 already owns the promotion criterion; see Decisions needed for
  how this spec's corpus-wide visibility feeds it).
- **FR-4 (missing-signal case is itself flagged, not silently skipped).** A spec claiming
  `implementing`/`done` with **no `phases:` frontmatter at all** (the exact shape both named
  instances had) MUST NOT be silently exempted from FR-2's check by treating an absent
  `phases:` as "nothing to compare" — the corpus check MUST feed the same fallback/derivation
  the interactive path uses (Context, `resolvePhaseStatus`) so a spec with no structured
  phase signal is derived and compared like any other, not skipped.
- **FR-5 (visible warning count, not just pass/fail).** The corpus-wide run MUST report how
  many specs currently disagree (a count), not merely a boolean, so "zero drift" (SPEC-022
  FR-5's promotion gate) becomes an observable number over time rather than something only
  discoverable by re-running a human audit.

## Acceptance Criteria

- [ ] **AC-1 (FR-1).** SPEC-014's and SPEC-018's `requirements.md` (and SPEC-018's
  `design.md`/`tasks.md`) carry a `phases:` block, and their literal `status:` equals
  `deriveStatus(...)` computed from that block + the real approval record — verified by
  running the corpus check from FR-2 against the corrected files and seeing zero
  `status.mirror-drift` violations for these two specs.
- [ ] **AC-2 (FR-1, mechanism not restatement).** The fix commit is produced by the
  lifecycle write path (e.g. re-running "Advance Phase"/an equivalent script), not a
  hand-typed `status:` value — the commit body names the mechanism used, per this repo's
  RCDD discipline.
- [ ] **AC-3 (FR-2).** `npm run validate` on the current corpus (pre-fix) surfaces
  `status.mirror-drift` warnings for SPEC-014 and SPEC-018 — proving the wired check
  actually catches the instance the issue was filed about, not just a synthetic fixture.
- [ ] **AC-4 (FR-2, no reimplementation).** A test/inspection confirms the corpus check
  calls the **same** exported `deriveStatus` / `status.mirror-drift`-producing code path
  `validateSpecCommand` calls — not a second parser or a copied rule.
- [ ] **AC-5 (FR-3).** The corpus check exits non-fatally on drift (warn), matching Rule
  13/15's severity convention at introduction; `npm run validate`'s exit code is unaffected
  by `status.mirror-drift` warnings alone.
- [ ] **AC-6 (FR-4).** A fixture spec with `status: implementing` and **no** `phases:` key
  is included in the corpus check's test coverage and is not silently skipped.
- [ ] **AC-7 (FR-5).** The `npm run validate` output includes a total drift count across
  the corpus (e.g. "N specs with status/derived-status mismatch"), not only pass/fail.

## Clarify — resolved

Each decision below was answered by **running the tool**, not by reasoning about it. The
original open questions and their recommendations are kept verbatim underneath, so the
reasoning that produced each answer stays auditable.

- **CQ-1 (scope) — RESOLVED: two named specs only.** Recommendation accepted as written.
  FR-3 already ships the corpus check as WARN, not ERROR, so bounding the *data* fix
  costs nothing: the gate still surfaces every other instance the moment it lands, and
  the true corpus scope becomes measured rather than guessed. Broadening here would be
  the scope-expansion this project's triage rules ask to confirm rather than assume.

- **CQ-2 (what `deriveStatus` computes) — RESOLVED by measurement, and it is neither
  answer offered.** This question recorded that the tool "has not been executed/observed
  as part of this Specify pass". It has now been. `npm run facts status`, 2026-08-07:

  | spec | frontmatter `status:` | derived | approval | verdict |
  |---|---|---|---|---|
  | SPEC-014 | `implementing` | **`new`** | approved | **DRIFT** |
  | SPEC-018 | `implementing` | **`new`** | approved | **DRIFT** |

  Not `specifying` (the issue's expectation) and not `planning` (this question's
  hypothesis) — **`new`**, for both. Per the recorded recommendation the tool's output
  wins, so FR-1's honest literal is `new`. That the derived value is the *lowest*
  possible state while the literal claims the *build* state makes the drift wider than
  the issue assumed, which strengthens FR-2 rather than changing it.

  **The correction is free.** `packages/shared/src/canonical.ts:14` removes exactly the
  lifecycle keys `status` and `phases` from the hashed bytes, so rewriting `status:` on
  these two **approved** specs does not stale either approval. FR-1 therefore costs no
  re-approval — worth stating explicitly, because the opposite assumption would have
  made this spec look far more expensive than it is.

- **CQ-3 (SPEC-018 shards) — RESOLVED by inspection: all three shards carry the lying
  literal, none carries `phases:`.** Measured on `main`:

  | file | `status:` | `phases:` block |
  |---|---|---|
  | `requirements.md` | `implementing` | none |
  | `design.md` | `implementing` | none |
  | `tasks.md` | `implementing` | none |

  So the drift is replicated across all three files, and no shard is phase-bearing
  today. FR-1 must correct **all three** literals for SPEC-018, not just
  `requirements.md`, or the spec would leave two of the three still lying. Whether the
  shards *should* gain their own `phases:` stays a Plan question against
  `discoverSpecs`/`buildArtifactGraph`, per the original recommendation — but it is no
  longer load-bearing for FR-1, which is about the literals that exist now.

<details>
<summary>Original open questions and recommendations (kept verbatim)</summary>

## Decisions needed (Clarify)

- **Scope of "fix" — two named specs only, or the whole corpus?** The issue's Fix
  direction says "per-instance: fix SPEC-014/SPEC-018" and treats the systemic fix
  (SPEC-022) as separate. Wiring FR-2's corpus-wide check will almost certainly surface
  *other* specs with `status: implementing`/`done` that also disagree once compared (this
  repo has ~35 files carrying `status: implementing` today; how many are genuinely
  backed by phases+approval vs. also drifted is unknown without running the check). Per
  this project's own triage rule ("expand to X" needs confirmation, not silent action):
  should this spec's Acceptance Criteria require only SPEC-014/SPEC-018 to be
  drift-free (FR-2 surfaces the rest as warnings for later, separate cleanup), or should
  it require the **whole corpus** to be warning-clean before merge? *Recommendation:
  two named specs only — treat every other warning FR-2 surfaces as expected, useful
  backlog signal (tracked as a follow-up issue at Plan/Implement), not a blocker for
  this spec. Broadening to a full-corpus backfill here would be exactly the
  scope-expansion this repo's triage rules ask to confirm rather than assume.*
- **What does `deriveStatus` actually compute for these two specs once `phases:` is
  added?** The issue asserts the honest literal is `specifying`. But `resolvePhaseStatus`
  ([spec.ts:224-238](../../../packages/minspec/src/lib/spec.ts#L224-L238)) has a
  body-content fallback (infers a phase as `in-progress`/`done` from non-empty body /
  checked tasks when `phases:` is silent on that phase) whose exact behavior against
  these two files' actual prose has not been executed/observed as part of this Specify
  pass (implementation is out of scope for this dispatch). If the tool, once run,
  computes something other than `specifying` (e.g. `planning` for SPEC-014, whose
  content is fully drafted and approved), which wins: the issue's stated expectation, or
  the tool's actual output? *Recommendation: the tool's actual output wins — if it
  disagrees with intuition, that is itself a `resolvePhaseStatus` fallback-accuracy bug
  worth its own issue, not something to override by hand in this fix (repeating the
  `#252` mechanism this spec exists to stop).*
- **Do SPEC-018's `design.md`/`tasks.md` shards need their own `phases:`, or does only
  the primary `requirements.md` carry lifecycle frontmatter for a split-layout T4
  spec?** Today none of the three shard files has a `phases:` block; only
  `requirements.md` plausibly should own it (design.md/tasks.md carry no `tier:` either).
  *Recommendation: confirm at Plan against how `discoverSpecs`/`buildArtifactGraph`
  already resolve split-layout specs (Context) — reuse that answer rather than
  re-deciding it here.*

</details>

## Invariants (must hold)

- **INV-1 (RCDD — mechanism, not restatement).** The fix to SPEC-014/SPEC-018 is produced
  by the same tool that will keep them honest going forward, not a one-off hand-edit
  (FR-1, AC-2).
- **INV-2 (no gate reimplementation).** The corpus-wide check added by this spec calls the
  exact `deriveStatus` / `status.mirror-drift` code the interactive gate already calls —
  never a second parser that can drift from it (FR-2, AC-4; the Rule 13/15 "one rule,
  enforced identically on every surface" discipline, Goal G-6).
- **INV-3 (no silent gate, constitution #2).** The corpus check MUST NOT swallow errors
  (no `|| true`) and MUST NOT skip a spec merely because it lacks a `phases:` block (FR-4)
  — a missing structured signal is exactly the failure mode being gated, not an exemption
  from it.
- **INV-4 (Tier-0, constitution #1).** The corpus check is pure frontmatter + filesystem
  reads; no network call. Runs inside the existing offline `npm run validate`.
- **INV-5 (warn-first, no flag day).** This spec does not flip any existing WARN to ERROR;
  promotion criteria remain SPEC-022 FR-5's, now made observable (FR-5) rather than changed.

## Risks & Mitigations

| # | Risk | L·I | Mitigation |
|---|---|---|---|
| R1 | Wiring FR-2 floods `npm run validate` output with many warnings across the corpus, drowning the two instances this issue is actually about. | Med·Med | FR-5's count-not-just-boolean output; treat the rest as backlog (Decisions needed), not a blocker. |
| R2 | The tool-computed derived status for SPEC-014/SPEC-018 (once `phases:` is added and the write path is actually run) does not match the issue's assumed `specifying`, due to the `resolvePhaseStatus` body-content fallback. | Med·Med | AC-1/AC-2 require running the real tool and accepting its output; if it disagrees, file that as a separate `resolvePhaseStatus` accuracy issue rather than overriding by hand (Decisions needed). |
| R3 | A future contributor re-introduces the `#252` mechanism (hand-flip status to "match" an approval) because it is faster than running the tool. | Low·Med | FR-2's corpus WARN now catches this on the very next commit/CI run, closing the detection gap this spec exists for. |
| R4 | Split-layout (`design.md`/`tasks.md`) phases aggregation for FR-2 diverges from what `buildArtifactGraph` already does for the same specs, producing two disagreeing derived-status answers across surfaces. | Low·High | FR-2 explicitly requires reusing `getApprovalStatus`/`deriveStatus` the same way `artifact-graph.ts` already does — no new aggregation logic (INV-2). |

## Out of scope

- **Promoting `status.mirror-drift` (or any rule) from WARN to ERROR.** Owned by SPEC-022
  FR-5's own criterion; this spec only makes that criterion observable corpus-wide (FR-5).
- **Auditing/fixing every other spec's literal/derived drift beyond SPEC-014/SPEC-018.**
  Deliberately deferred — see Decisions needed.
- **Any change to the approval sidecar schema, `deriveStatus`'s rule table, or
  `resolvePhaseStatus`'s body-inference fallback.** This spec consumes those as built;
  changing them is SPEC-022's (or a new issue's) concern.
- **Any change to `spec-gate.py`'s enforcement behaviour.** Unaffected — it already reads
  derived status, never the literal line (SPEC-022 FR-4).

## Dependencies

- **[SPEC-022](../SPEC-022-approval-foundation/requirements.md)** (FR-4, INV-4) — this
  spec consumes its already-built `deriveStatus`/`status.mirror-drift` contract; it does
  not modify it.
- **[DR-034](../../../docs/decisions/DR-034.md)** — the accepted design SPEC-022
  implements; this spec completes one enforcement-surface gap in it.
- **`#654` / `#460`** — the precedent pattern (Rule 13 / Rule 15 in
  `scripts/validate-frontmatter.ts`) this spec's FR-2 follows.
- **SPEC-014, SPEC-018** — the two artifacts corrected by FR-1; no functional change to
  either spec's requirements, only their lifecycle frontmatter.
