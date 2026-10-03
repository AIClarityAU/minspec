---
id: SPEC-097
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-004  # Classifier Validation
relates_to: [DR-009, DR-021, DR-022, DR-024, SPEC-004, SPEC-023, "#91", "#88", "#195"]
---

# MinSpec — Consequence-Axis Validation (amends SPEC-004 / DR-009) (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks the Clarify questions below, and approves it through the normal
> spec-approval gate before any code changes. Approving mints the hash; editing after
> that voids the approval (standard MinSpec lock).

**Date:** 2026-10-03
**Status:** Specifying
**Triggered by:** [#91](https://github.com/AIClarityAU/minspec/issues/91) — re-scope
classifier validation to the consequence axis, the follow-up [DR-022](../../../docs/decisions/DR-022.md)
Follow-ups filed verbatim as "Validation re-scope (SPEC-004 / DR-009 consequence axis)".
**Decision basis:** [DR-022](../../../docs/decisions/DR-022.md) §1 (the consequence axis
exists and is Tier-0/always-on) and [DR-024](../../../docs/decisions/DR-024.md) (the
accepted Fork-B direction DR-022 itself now lives under). [DR-021](../../../docs/decisions/DR-021.md)
(difficulty deferred to opt-in) is **inherited unchanged** — see Out of Scope.
**Amends:** [SPEC-004](../SPEC-004-classifier-validation/requirements.md) (the diff-size
validation harness) and notes a reframe of [DR-009](../../../docs/decisions/DR-009.md)
(see "DR-009 reframe" below). Does not supersede either — both stand as the record of
the size-axis study (κ=0.80, n=120); this spec is the size axis's sibling for the
orthogonal consequence axis, run over the same out-of-tree fixture model.
**Depends on:** [SPEC-023](../SPEC-023-consequence-screen/requirements.md) (the
consequence screen / "#SCREEN" in the issue body — filed as
[#88](https://github.com/AIClarityAU/minspec/issues/88), status `implementing`). Its
four non-reach analyzers (FR-2..FR-5 below) are live in
[consequence-analyzers.ts](../../../packages/minspec/src/lib/consequence-analyzers.ts)
today, so this spec's FR-2/FR-3 dependency is **already satisfied** for those four; only
the flagship reach analyzer (SPEC-023 FR-1) is still a `degraded` placeholder pending
[#195](https://github.com/AIClarityAU/minspec/issues/195), which is itself gated on this
spec per SPEC-023's own Follow-ups ("#91 — validation acceptance thresholds for the
reach model (owns FR-8's pass/fail)").

---

## Problem

[SPEC-004](../SPEC-004-classifier-validation/requirements.md) / [DR-009](../../../docs/decisions/DR-009.md)
validated exactly one axis: the **diff-size** tier classifier, against SWE-bench-Verified
gold patches with **size-blind consensus tier labels** (κ=0.80, n=120). That study answers
"does predicted tier track mechanical scope?" — it was never designed to, and cannot,
answer a different question: "does the **consequence** axis's analyzers correctly detect
blast radius?"

[SPEC-023](../SPEC-023-consequence-screen/requirements.md) (DR-022 §1) shipped four live,
deterministic Tier-0 analyzers — public-API surface delta (FR-2), irreversibility (FR-3),
sensitive-sink reach (FR-4), concurrency (FR-5) — plus a flagship impact-reach analyzer
(FR-1) that in v1 emits only a `degraded: true` / `reach_unavailable` marker (no call-graph
index exists yet). SPEC-023's own FR-8 and Test Plan explicitly punt two questions to this
issue:

1. **What counts as ground truth, and where does it come from?** The committed
   [labels.json](../../../scripts/classifier-validation/labels.json) carries one label per
   instance: a size-blind *tier*. It says nothing about whether that instance's patch
   touches a sensitive sink, deletes a migration, changes a public export, or introduces
   concurrency — the four things the consequence analyzers actually detect. **SWE-bench
   gold patches don't carry consequence labels** (issue body) — a new label file, and
   possibly a new corpus, is needed.
2. **What is the pass/fail bar?** SPEC-023 FR-8 asks for an ON-vs-OFF shift report
   ("every shift MUST be upward") but explicitly defers the acceptance threshold:
   *"Numbers are reported, not hard-asserted (#91 owns thresholds)."*

### DR-009 reframe

DR-009's Decision scoped the out-of-tree fixture harness to validating **the tier
thresholds** (file count / line count / file-type diversity) against a size-blind label.
That scope stands unchanged for the size axis — the fixture model (gitignored patches,
committed labels, real-path reuse via `analyzeGitDiff()` → `classify()`, skip-not-fail
offline) is **reused verbatim**, not redesigned, by this spec. What DR-009 did not and
could not anticipate is a *second*, orthogonal signal family (consequence) sharing the
same harness. This spec is the record of that reframe: DR-009's harness is the
**substrate** both axes validate through; it is not a decision that itself needs
re-litigating or a new DR (see "Why no new DR" below).

## Goal

Extend the existing SPEC-004 harness with a second, independent validation pass that:

1. Scores each of the four **live** consequence analyzers (public-API delta,
   irreversibility, sensitive-sink, concurrency) against hand-labelled per-instance ground
   truth, reporting precision/recall **per analyzer** (not blended — they detect orthogonal
   things, and a blended number would hide one bad analyzer behind three good ones).
2. Produces the ON-vs-OFF tier-shift report SPEC-023 FR-8 asks for, and gives it the
   acceptance bar FR-8 deferred to this issue.
3. States plainly, rather than silently omits, that the flagship reach analyzer (FR-1) is
   **not** numerically validated here — it has no predicted value to score while degraded.

## Functional Requirements

- **FR-1 — Consequence ground-truth labels.** A new committed label file,
  `scripts/classifier-validation/consequence-labels.json`, keyed by the **same
  `instanceId`s** already fetched/labelled for SPEC-004 (reuses DR-009's out-of-tree
  fixture dir — no second fetch script, no new network surface). Each entry carries one
  boolean/severity field per live analyzer: `publicApiDelta` (`none|additive|breaking`),
  `irreversible` (bool), `sensitiveSink` (bool), `concurrency` (bool). Labelling reads the
  **diff content itself** (ground truth is a property of what the patch touches, not of
  problem-statement difficulty) — this is a *different* question from SPEC-004 FR-2's
  circularity trap (labelling tier *from diff size* is circular against a size-based
  classifier; labelling "does this patch touch a migration file" from the diff is not
  circular against anything, there is no size-based proxy for it).
- **FR-2 — Per-analyzer precision/recall.** Reusing SPEC-004 FR-3's real-path-reuse seam
  (apply patch to temp repo, stage, call the real analyzer — no reimplementation), run the
  four live consequence analyzers over every FR-1-labelled instance and report, **per
  analyzer**: true/false positive/negative counts, precision, recall. No single blended
  "consequence accuracy" number (Goal §1).
- **FR-3 — Degraded-reach honesty check.** Separately from FR-2 (FR-1 the analyzer has no
  predicted value to score), assert every instance's impact-reach signal is the
  well-formed `degraded: true` / `name: "reach_unavailable"` marker SPEC-023 FR-1
  specifies, and that **no instance ever carries a fabricated reach number**. Reported as
  its own line, not folded into or omitted from FR-2's report.
- **FR-4 — ON/OFF shift-direction report (discharges SPEC-023 FR-8).** Re-run the SPEC-004
  harness's existing `expectedTier` corpus twice — size-signals-only (the existing
  baseline) and size-plus-consequence-signals — and report, per instance, whether the
  predicted tier moved and in which direction. Needs **no new labels** (reuses the
  existing `labels.json` + the monotonicity property SPEC-023 already asserts in code);
  this FR can land and run independently of FR-1/FR-2.
- **FR-5 — Acceptance bar for FR-4 (discharges SPEC-023 FR-8's deferred threshold).**
  **Zero downward shifts** is a hard, non-negotiable assertion (DR-021's upward-only
  ratchet; a single downward shift is a regression, not a tuning question). The *count* of
  upward shifts, and the re-measured over-tiering rate, are **reported**, not
  hard-asserted — see Clarify DQ-3 for whether a future spec should promote them to a gate.
- **FR-6 — Report shape.** A single `ConsequenceValidationReport` (design-phase contract)
  carrying: the FR-2 per-analyzer precision/recall table, the FR-3 degraded-honesty
  assertion result, and the FR-4 shift table + FR-5 pass/fail. Committed as a run artifact
  alongside the existing SPEC-004 `tasks.md#findings` convention — same place a human
  already looks for this harness's evidence.

## Non-Functional Requirements

- **NFR-1 — Same offline/determinism posture as SPEC-004.** No network at run time
  (FR-1's labels are hand-authored and committed, same as the existing tier labels); same
  instance patches, already gitignored by DR-009, are reused — no second gitignored
  directory, no second fetch script.
- **NFR-2 — Corpus-sparsity honesty.** SWE-bench-Verified is single-PR bug fixes; some
  consequence categories (migrations/schema deletes, sensitive-sink touches) may be rare
  in that corpus, mirroring the T3/T4-sparsity caveat SPEC-004 NFR-2 already recorded for
  tier. If a category's positive count is too small to support a precision/recall claim,
  FR-6's report MUST say so per-category rather than publish a number computed over (e.g.)
  two positives.

## Invariants Preserved

- **#1 No AI dependency** — labelling (FR-1) is hand-authored; the analyzers under test are
  the existing zero-AI deterministic analyzers (SPEC-023 FR-6's additive contract).
- **#2 Tiered network consent** — no new network surface; reuses DR-009's existing
  out-of-tree fetch boundary unchanged.
- **#3 No lock-in** — `consequence-labels.json` is plain JSON, same convention as
  `labels.json`.
- **SPEC-023 INV-3 (upward-only monotonicity)** — FR-5's zero-downward-shift bar is this
  spec's concrete discharge of that invariant against real data, not just the unit-level
  property test SPEC-023 already ships.

## Decisions needed (Clarify)

- **DQ-1 — Labelling corpus: reuse the existing 120, or curate a targeted subset?**
  - **Option A (rec)** — reuse the same 120 SWE-bench-Verified instances SPEC-004 already
    fetched and tier-labelled; just add the FR-1 consequence labels on top. Cheap (no new
    fetch/licensing work), and keeps one corpus for both axes so a reader cross-references
    tier and consequence findings on the same instance IDs. **Cost:** some consequence
    categories (irreversibility, sensitive-sink) may land with very few true positives in a
    bug-fix-only corpus — NFR-2 forces an honest "sample too small" caveat rather than a
    firm precision number for those categories, mirroring SPEC-004's own T3/T4 gap.
  - **Option B** — curate a second, smaller corpus deliberately chosen to contain
    consequence-positive examples (a migration-deleting PR, a public-API-breaking PR,
    etc.). Gets a denser positive sample per category. **Cost:** new sourcing/licensing
    review, a second out-of-tree fixture set, and a corpus that no longer shares instance
    IDs with the tier study — loses the single-corpus cross-reference Option A keeps.
- **DQ-2 — Who labels consequence ground truth, and how rigorously?**
  - **Option A (rec)** — a single human rater per instance, reading the diff directly
    against a written rubric (one line per analyzer: "does this patch delete a file /
    touch `migrations/` / match the C4 sink catalog / add `Promise.all`"). Cheap, and the
    four questions are closer to mechanically-checkable facts about the diff than to the
    difficulty judgment call SPEC-004 FR-2's multi-rater protocol existed to average out.
    **Cost:** no measured inter-rater agreement (no κ) — if the rubric turns out to be
    ambiguous on some instances, that surfaces only on review, not from a disagreement
    statistic the way SPEC-004's κ=0.80 caught it.
  - **Option B** — the full SPEC-004 FR-2 protocol: 3 blind raters + 1 human overlap + a
    reported Fleiss κ, per analyzer. More rigorous, directly comparable to the tier study's
    evidentiary bar. **Cost:** 4x the labelling work for 4 analyzers instead of one tier
    label, on a T3 chore whose own issue frames it as a re-scope, not a from-scratch study.
- **DQ-3 — Does FR-5's reported upward-shift count get a hard acceptance threshold now, or
  stay report-only until a follow-up spec sets one from this run's baseline?**
  - **Option A (rec)** — report-only for this first run (mirrors the posture SPEC-004 took
    before DR-021 decided direction from real numbers rather than a guessed threshold).
    **Cost:** no CI gate exists yet, so a future analyzer change that quietly degrades
    shift quality (while still honoring the zero-downward-shift hard bar) won't trip
    anything until a follow-up spec sets a number from this baseline.
  - **Option B** — pick a threshold now (e.g. "at least N% of true-consequence instances
    shift upward") sight-unseen, before the first run's numbers exist. **Cost:** a threshold
    chosen without data is a guess, and DR-021's own history is a documented example of a
    guessed threshold ("tune the thresholds") being the wrong fix for this exact class of
    problem.

## Out of Scope

- **Real impact-reach measurement.** The call-graph index that would let FR-1 (SPEC-023)
  emit a real number instead of `degraded: true` is [#195](https://github.com/AIClarityAU/minspec/issues/195),
  a separate, already-filed follow-up. This spec validates the four analyzers that exist;
  it does not build the one that doesn't.
- **DR-021's opt-in semantic difficulty layer.** Unchanged by this spec (issue body: "Difficulty
  axis stays per DR-021, unchanged"). Nothing here reads problem-statement text or touches
  invariant #1.
- **Re-litigating the size-axis result.** SPEC-004's κ=0.80 / 34.2%-exact / 86.7%-adjacent
  study and DR-021's upward-only-ratchet decision are not reopened; this spec adds a sibling
  study for a different axis over the same harness.
- **Auto-tuning analyzer thresholds from this run's results.** Same posture as SPEC-004's
  Out of Scope: this harness measures; it does not mutate `consequence-analyzers.ts`.
- **The risk→phase catalog** ([#89](https://github.com/AIClarityAU/minspec/issues/89)) and
  the frontmatter `tier → profile` migration ([#90](https://github.com/AIClarityAU/minspec/issues/90)).
  Both consume this spec's eventual evidence; neither is built or amended here.

## Why no new DR

DR-022 already decided that a consequence axis exists and is Tier-0/always-on (§1), and
DR-024 already carries the accepted Fork-B contract direction. This spec does not choose
between live alternatives at the T4 "costly to walk back" bar the DR-359 ADR filter sets —
it materializes a validation **method** (which corpus, which rater protocol, which
threshold posture) for a decision already made elsewhere. Clarify DQ-1/DQ-2/DQ-3 are real
trade-offs, but all three are cheap to revisit within a day (re-label a JSON file, re-run a
script) if the chosen option turns out wrong — the DR-359 filter's own bar for "skip the
DR." DR-009 and DR-022 are referenced, not amended in place or superseded, per "Amends"
above.

## Follow-ups (tracked)

- **[#195](https://github.com/AIClarityAU/minspec/issues/195)** — real call-graph impact-reach
  index; ungated once this spec's acceptance posture (FR-5/DQ-3) ships.
- **[#89](https://github.com/AIClarityAU/minspec/issues/89)** — risk→phase catalog; a future
  consumer of this spec's per-analyzer precision/recall numbers (a catalog entry keyed to an
  unreliable analyzer is a worse idea than one keyed to a validated one).
- **[#86](https://github.com/AIClarityAU/minspec/issues/86)** — positioning (site/marketplace
  copy); not triggered by this spec, listed in DR-022 Follow-ups for completeness only.

## Alternatives Considered

- **Fold this into SPEC-004 in place (rewrite its existing requirements.md).** Rejected:
  SPEC-004 is approval-hash-locked (`.minspec/approvals/specs/minspec/SPEC-004-classifier-validation/`)
  and its content is the historical evidentiary record of the κ=0.80 size-axis study
  (Outcome blockquote, Follow-ups already pointing to "#91 ... NOT resolved"). Rewriting it
  to carry a second, unrelated labelling protocol would mix two studies' acceptance criteria
  in one file and force an unrelated re-approval of settled size-axis content. A sibling
  spec that references SPEC-004 (as DR-022/SPEC-023 already do) matches the repo's existing
  pattern for this exact fork.
- **Skip labelling, validate only the ON/OFF shift direction (FR-4/FR-5).** Rejected as the
  *whole* answer: it discharges SPEC-023 FR-8, but leaves "do the analyzers actually detect
  what they claim to detect" (FR-2) unanswered — the harder half of the issue body's ask
  ("the consequence axis ... needs its own validation").
- **Validate impact-reach now anyway, using the degraded marker as a stand-in signal.**
  Rejected: the degraded marker carries no measurement to score against ground truth (it
  is deliberately the same value on every instance); scoring it would produce a number
  that looks like evidence and is not — exactly the false-signpost failure mode the
  Evidence Discipline rule in this repo's CLAUDE.md exists to prevent.

## Acceptance Criteria

- [ ] **Consequence labels committed** — `scripts/classifier-validation/consequence-labels.json`
  exists, is keyed by the same `instanceId`s as the existing tier `labels.json`, and carries
  all four FR-1 fields for every labelled instance. (FR-1)
- [ ] **Per-analyzer precision/recall reported, not blended** — the report (FR-6) carries
  four independent precision/recall pairs, one per live analyzer, never a single combined
  "consequence accuracy" figure. (FR-2)
- [ ] **Degraded-reach honesty holds** — every instance's impact-reach signal is the
  well-formed degraded marker; zero instances carry a fabricated reach number. (FR-3)
- [ ] **Shift-direction report exists and the zero-downward-shift bar holds** — the
  ON/OFF report (FR-4) runs over the full existing tier corpus and FR-5's hard
  zero-downward-shift assertion passes (a single downward shift is a failing run, not a
  reported number). (FR-4, FR-5)
- [ ] **NFR-2 sparsity caveat is explicit** — any consequence category whose positive count
  in the chosen corpus (Clarify DQ-1) is too small to support a precision/recall claim is
  named as such in the report, not silently averaged into a confident-looking number.
  (NFR-2)
- [ ] **No new network surface** — the consequence-label harness reuses DR-009's existing
  out-of-tree fetch boundary; no new `http`/`https`/`fetch` import anywhere in
  `packages/minspec` or `packages/shared`. (NFR-1, invariant #2)
