---
id: SPEC-423
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-004  # Classifier Validation
relates_to: [SPEC-004, SPEC-023, DR-009, DR-021, DR-022, DR-024]
---

# MinSpec — Consequence-Axis Validation (re-scope of the classifier study) (Requirements)

**Date:** 2026-11-27
**Status:** Specifying — spec only; nothing built.
**Triggered by:** [#91](https://github.com/AIClarityAU/minspec/issues/91) — re-scope classifier validation to the consequence axis (amend SPEC-004 / DR-009).
**Decision basis:** [DR-022](../../../docs/decisions/DR-022.md) *Consequences* (validation re-scope; status `superseded`, reach parts "proposed, gated on #91") and [DR-024](../../../docs/decisions/DR-024.md) (gates the reach model on a validation study "comparable to the size study's").
**Depends on:** the consequence screen — [SPEC-023](../SPEC-023-consequence-screen/requirements.md) (#88 "Tier-0 consequence-screen analyzers"). This is the `#SCREEN` the issue names. SPEC-023 status is `implementing`; this spec was not checked against built code (see Assumptions).
**Amends in intent:** [SPEC-004](../SPEC-004-classifier-validation/requirements.md) / [DR-009](../../../docs/decisions/DR-009.md) — *how* is Decision D1 below.
**Unchanged:** the difficulty axis stays per [DR-021](../../../docs/decisions/DR-021.md) (opt-in semantic layer, not validated here).

---

## Problem

[SPEC-004](../SPEC-004-classifier-validation/requirements.md) validated the **diff-size** classifier
(n=120, 11 repos, Fleiss κ=0.80) and found it measures mechanical scope, not difficulty.
[DR-022](../../../docs/decisions/DR-022.md) then added a second, orthogonal axis —
**consequence / blast radius** (impact-reach, public-API delta, irreversibility,
sensitive-sink reach, concurrency) — which [SPEC-023](../SPEC-023-consequence-screen/requirements.md)
implements as Tier-0 analyzers. That axis is **unvalidated**, and the SPEC-004 corpus
cannot validate it:

1. **Wrong label.** `labels.json` holds *difficulty-flavoured tier* labels (size-blind
   consensus of "how much ceremony does this problem deserve"). SWE-bench-Verified gold
   patches carry **no consequence label** — nothing says "this change is high blast radius".
2. **Wrong population.** SWE-bench-Verified is single-PR bug fixes; consequence-heavy
   changes (deletions, migrations, public-API breaks, sensitive sinks) are rare, so most
   consequence analyzers would fire on few or zero instances (SPEC-004 NFR-2 already records
   the zero-T4 gap).
3. **Wrong question.** SPEC-004 asks "does the predicted tier match the expected tier?".
   The consequence axis must answer "when the screen fires, was it right to — and what does
   it miss?" (precision per analyzer, recall against a consequence ground truth).

DR-024 makes this study the gate for un-gating reach (#88 follow-up index, #89 risk→phase
catalog, #90 frontmatter migration, #86 positioning). Without it those stay blocked.

## Goal

A repeatable, offline-by-default **consequence-axis validation harness and corpus** that
produces decision-grade evidence — per-analyzer precision/recall and a stated pass/fail
bar — on whether the SPEC-023 consequence screen deserves to be un-gated. It **measures**;
it does not mutate the classifier (same posture as SPEC-004).

## Scope

- A consequence-labelled corpus and labelling protocol (the changed label + corpus per the issue).
- A harness that runs the **real** SPEC-023 analyzers over that corpus and reports.
- Acceptance thresholds for un-gating (proposed here, ratified via Clarify D3).
- Recording the SPEC-004 / DR-009 reframe (mechanism per D1).

## Out of Scope

- Difficulty / likelihood axis — remains DR-021's opt-in layer; untouched.
- Re-validating the diff-size classifier — SPEC-004's result stands (SPEC-004 harness keeps running as-is).
- Building the real cross-file reference index for impact-reach (SPEC-023 follow-up). Until it exists impact-reach is `degraded` and is **reported as degraded, not scored** (FR-6).
- Un-gating #88 / #89 / #90 / #86 — this study produces the evidence; the un-gate is a separate human act per DR-024.
- Tuning analyzer thresholds in response to findings (separate issue per finding).

## Functional Requirements

- **FR-1 — Consequence ground-truth label.** Each corpus instance carries a
  `consequence` label, independent of diff size and of the SPEC-004 tier label: a
  per-analyzer boolean set (`reach`, `apiSurface`, `irreversible`, `sensitiveSink`,
  `concurrency`) saying whether a competent reviewer would call that dimension *materially
  at stake*, plus an overall `consequenceTier` (T1–T4 blast radius: "if wrong, how bad?").
- **FR-2 — Blind labelling protocol.** Labels are produced **size-blind and screen-blind**:
  raters see the problem statement / change description and the pre-change context, never
  the diff line counts and never the analyzer output (circularity guard — SPEC-004 Run A
  scored 95.8% by being circular). Majority of 3 independent raters + a human on the
  overlap; **Fleiss κ reported per label dimension**. A dimension with κ below the floor
  chosen in D4 is reported as "label unreliable" and excluded from pass/fail.
- **FR-3 — Corpus that contains consequence.** The corpus MUST include a stratum of
  consequence-positive changes (not only SWE-bench bug fixes). Source and minimum
  per-analyzer positive count are Decision D2. Every instance records its provenance
  (source, commit/PR id, licence) in a committed manifest; patches themselves remain
  out-of-tree and gitignored as in SPEC-004 FR-1.
- **FR-4 — Real-path reuse.** The harness calls the shipped SPEC-023 analyzers and
  `classify()` — no forked copy of analyzer logic (SPEC-004 FR-3 seam, carried over).
- **FR-5 — Report.** Per analyzer: TP/FP/FN/TN, precision, recall, and the overall
  predicted-tier vs `consequenceTier` confusion matrix. Also reports the *incremental*
  effect over size-only: instances where a consequence signal raised the tier, split into
  correct raise (label says high consequence) vs over-raise.
- **FR-6 — Degraded is a first-class outcome.** Signals carrying `degraded: true`
  (SPEC-023 FR-1/FR-2/FR-4) are tallied separately and **never counted as hits or
  misses**. Impact-reach (degraded in v1) is reported as `0 scored / N degraded` with an
  explicit "NOT VALIDATED" verdict, not a silent pass (constitution invariant 2 — no silent
  gate).
- **FR-7 — Verdict, fail-closed.** The report emits a per-analyzer verdict
  `PASS | FAIL | INSUFFICIENT_EVIDENCE | NOT_VALIDATED`. Too few positives, unreliable
  labels, or a missing/errored corpus yield `INSUFFICIENT_EVIDENCE`, never `PASS`.
  Thresholds come from D3.
- **FR-8 — Upward-only re-check.** Re-assert SPEC-023 INV-3: every tier shift from enabling
  consequence analyzers (vs size-only) is upward. A downward shift is a harness failure.
- **FR-9 — Offline graceful skip.** If the gitignored data dir or committed labels are
  absent, the harness test skips rather than fails (SPEC-004 FR-5 carried over); skipping
  is announced in the test output, not silent, and the verdict becomes `INSUFFICIENT_EVIDENCE`.
- **FR-10 — Reframe recorded.** SPEC-004 and DR-009 each gain a visible note that the
  size-axis study is *one of two* axis validations and that consequence validation lives
  here (mechanism per D1). The note must not alter either document's measured findings.

## Non-Functional Requirements

- **NFR-1 — Determinism.** Same corpus + labels + analyzer version → same report.
- **NFR-2 — Proportional ceremony.** Corpus sized to the smallest n that yields a
  meaningful per-analyzer interval (D2), not a benchmark-scale effort.
- **NFR-3 — Reproducible labelling cost.** Label rubric and rater prompts are committed so
  a re-label is a re-run, not a re-design.

## Acceptance Criteria

- **AC-1 (FR-1, FR-2)** — Given the committed labels, every instance has all five
  dimension booleans and a `consequenceTier`; κ per dimension is printed.
- **AC-2 (FR-2)** — The labelling inputs for any instance contain no diff size figures and
  no analyzer output (checked by a fixture-shape assertion on the rater input file).
- **AC-3 (FR-3)** — Manifest lists provenance for every instance; each non-degraded
  analyzer has ≥ the D2 minimum positives, or its verdict is `INSUFFICIENT_EVIDENCE`.
- **AC-4 (FR-4)** — Harness imports analyzers/`classify()` from the shipped module path;
  no duplicated signal math (import-graph assertion).
- **AC-5 (FR-5)** — Report prints per-analyzer precision/recall and the confusion matrix.
- **AC-6 (FR-6)** — An instance whose only relevant signal is `degraded: true` is counted
  in the degraded tally and in neither hits nor misses.
- **AC-7 (FR-7)** — With the corpus removed, the verdict is `INSUFFICIENT_EVIDENCE` (not
  `PASS`, not a crash with no verdict).
- **AC-8 (FR-8)** — A synthetic downward shift makes the harness fail.
- **AC-9 (FR-9)** — Fresh clone, no `.data/`: `npm test` stays green and the skip reason is printed.
- **AC-10 (FR-10)** — SPEC-004 and DR-009 contain a link to this spec; their findings text is byte-unchanged outside the added note.

## Invariants the change must not break

- **#1 Offline core** — harness is Tier 0, no network at run time; only a separate out-of-tree fetch script may touch the network (as SPEC-004 FR-1). LLM labelling is a **one-off, out-of-tree, user-consented** step; its outputs are committed static files. No AI call in `packages/`.
- **#2 No silent gate** — degraded, unreliable, missing-corpus and too-few-positives outcomes all surface as explicit non-`PASS` verdicts (FR-6, FR-7, FR-9).
- **#3 Blast radius = opted-in project** — nothing here ships to adopters or changes behaviour in other repos; it is a dev-time harness in this monorepo.
- **SPEC-023 INV-3 (upward-only ratchet)** — re-checked by FR-8.
- **DR-021** — difficulty stays opt-in and out of this study.

## Risks & Mitigations

| # | Risk | Likelihood · Impact | Mitigation |
|---|------|---------------------|------------|
| 1 | **Circular labels** — raters influenced by the diff/analyzer output reproduce the analyzers' own verdicts. | Med · High | FR-2 size-blind + screen-blind; AC-2 checks rater inputs. |
| 2 | **Too few positives** — consequence-heavy changes are rare, so per-analyzer precision/recall has huge intervals. | High · High | FR-3 stratified corpus; FR-7 `INSUFFICIENT_EVIDENCE` instead of a false pass; D2 sets minimums. |
| 3 | **Impact-reach cannot be scored** (degraded in v1) and the flagship axis looks validated by omission. | High · High | FR-6 explicit `NOT_VALIDATED`; reach follow-up index stays gated. |
| 4 | **Label subjectivity** — "material consequence" is judgement-heavy; κ may be low. | Med · Med | κ per dimension; unreliable dimensions excluded and named (FR-2). |
| 5 | **Corpus provenance / licence** — mined public repos carry licences. | Low · Med | FR-3 manifest records licence; patches stay out-of-tree. |
| 6 | **Goalpost drift** — thresholds chosen after seeing results. | Med · High | D3 thresholds ratified by a human *before* the first scored run and committed. |
| 7 | **Amending SPEC-004 voids its approval / disturbs a finished study.** | Med · Low | D1 recommends a new spec plus a pointer note, not a rewrite. |

## Assumptions (unverified — check at Plan)

- SPEC-023 analyzers are built enough to be invoked from a harness
  ([consequence-analyzers.ts](../../../packages/minspec/src/lib/consequence-analyzers.ts) exists; I did not read it for this spec, so signal names/shape are taken from SPEC-023 prose).
- A consequence-labelled corpus can be assembled from public history within a proportional budget (D2).
- Raters can judge consequence from the change description plus pre-change context alone.

## Decisions needed (Clarify)

**D1 — How to "amend SPEC-004 / DR-009".** The issue says amend.
- **(rec) New spec (this one) + a short pointer note in SPEC-004 and DR-009.** SPEC-004 is `implementing` with an approval hash; this keeps its measured findings untouched and gives the new study its own approvable. *Cost:* two documents describe validation, so readers must follow a link; the SPEC-004 edit still voids its approval and needs re-approval.
- Rewrite SPEC-004 in place to cover both axes. *Cost:* mixes a finished, measured study with an unbuilt one; risks muddying the κ=0.80 findings.
- New spec only, no edits to SPEC-004/DR-009. *Cost:* the issue explicitly asked to note the DR-009 reframe; the old docs would not point at the new one. (DR-009 edits may also warrant a new superseding/reframing DR rather than a note; only if you judge the reframe irreversible-in-a-day.)

**D2 — Corpus source and size.**
- **(rec) Mine consequence-positive commits from this monorepo's and a few public repos' history (deletions, migrations, export removals, auth/crypto paths, concurrency primitives) plus a negative sample from SWE-bench; target ≥ 20 positives per scored analyzer, ~150–200 total.** *Cost:* mined history has no issue→PR statement, so rater input is a commit message/PR description (weaker than SWE-bench problem statements) and labelling effort roughly doubles SPEC-004's.
- Synthetic injected changes (apply known-risky edits to SWE-bench base repos). *Cost:* cheap and controllable, but measures the analyzers on cases we invented — recall is inflated by construction.
- SWE-bench only, accept low positives. *Cost:* most analyzers land `INSUFFICIENT_EVIDENCE`; study cannot un-gate anything.

**D3 — Pass bar for un-gating.** DR-024 only says "comparable to the size study's".
- **(rec) Per scored analyzer: precision ≥ 0.80 (the screen can only raise ceremony, so false alarms are the cost) and recall reported but not gated for v1, with ≥ 20 positives and κ ≥ D4 floor.** *Cost:* an analyzer with high precision but poor recall passes while still missing real blast radius; the "never wrong by omission" claim stays unproven.
- Gate on both precision ≥ 0.80 and recall ≥ 0.60. *Cost:* may fail every analyzer on a small corpus and stall un-gating.
- Defer thresholds until a pilot run. *Cost:* invites goalpost drift (Risk 6) unless the pilot is held out from the scored run.

**D4 — κ reliability floor.** **(rec) 0.60** ("substantial" band; below it the dimension is excluded). *Cost:* below SPEC-004's 0.80, so a weaker label can reach a verdict; alternative 0.80 may exclude subjective dimensions like `reach` entirely.

**D5 — Who labels the human overlap, and is the LLM-labelling spend OK?** A human reads the overlap sample (SPEC-004 precedent, ~1 human on overlap) and the blind LLM runs consume tokens. **(rec) Same protocol as SPEC-004 (3 blind LLM raters + 1 human on a ~25% overlap).** *Cost:* human reading time on the founder/PO; skipping the human leg drops the κ anchor.

## Coverage Map

| Concern | FR / invariant |
|---|---|
| Consequence ground truth, independent of size | FR-1, FR-2 |
| Corpus actually contains consequence | FR-3, D2 |
| No forked analyzer logic | FR-4 |
| Precision / recall / incremental effect | FR-5 |
| Degraded never scored as hit/miss | FR-6, invariant #2 |
| Fail-closed verdict | FR-7, FR-9 |
| Upward-only ratchet | FR-8 |
| Reframe of SPEC-004 / DR-009 | FR-10, D1 |

## Consequences

**Positive:** gives DR-024's gate an evidence path; impact-reach's validation status becomes explicit rather than assumed; the label/corpus change the issue calls for is specified before any labelling spend.

**Negative:** a second labelled corpus to maintain; per-analyzer results on small n are wide-interval and may mostly say `INSUFFICIENT_EVIDENCE`; impact-reach cannot be validated until the reference index exists.

## Failure-Modes / Edge-Cases

- Analyzer emits only `degraded` markers for an instance → degraded tally only (FR-6).
- Label dimension with zero positives → `INSUFFICIENT_EVIDENCE` for that analyzer.
- Rater disagreement splits 1/1/1 → recorded as split vote, resolved by the human overlap, counted in κ.
- Instance patch fails to apply → `skipped` tally, surfaced, not dropped (SPEC-004 precedent).
- A signal fires on an instance labelled low-consequence → counted FP and listed for review; not auto-suppressed.
