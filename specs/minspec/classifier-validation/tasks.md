---
id: SPEC-004
type: tasks
status: implementing
product: minspec
---

# MinSpec — Classifier Validation Harness (Tasks)

**Requirements:** [requirements.md](requirements.md) · **Design:** [design.md](design.md) · **Decision:** [DR-009](../../../docs/decisions/DR-009.md)

---

## T0 — Invariants (before implementation)
- [x] Test: harness file imports no network module (only fs/child_process/simple-git + analyzer/classifier). (AC-3)
- [x] Test: harness `describe.skipIf`s when `.data/` absent — green offline. (AC-1, FR-5)

## Phase 1 — Out-of-tree fetch (FR-1)
- [x] `.gitignore`: add `scripts/classifier-validation/.data/`
- [x] `scripts/classifier-validation/fetch-swebench.mjs` — fetch subset → `.data/instances.json` `{instanceId, repo, patch, problemStatement}[]`
- [x] Script header documents it is the only network component (DR-009 / invariant #2)
- [x] Stride-sample across the dataset (not first-N) for repo/size diversity

## Phase 2 — Labels (FR-2)
- [x] `scripts/classifier-validation/labels.json` — `{instanceId: Tier}` map + rubric header
- [~] Hand-label instances per rubric — 24 labelled (9 repos). Expand toward ~50 + add T4 examples.

## Phase 3 — Harness (FR-3, FR-4)
- [x] Patch application: parse unified diff → feed real `analyzeGitDiff` via injectable git seam; count unparseable as `skipped`
- [x] Per-instance: `analyzeGitDiff` → `classify` → `ValidationResult`
- [x] Aggregate: accuracy, adjacent accuracy, confusion matrix, outliers
- [x] Write `report.json` + print summary

## Phase 4 — Wire-up
- [x] `npm run validate:classifier` script (runs harness against `.data/` if present)
- [x] Confirm `npm test` green on fresh offline clone (AC-1) — 987 pass, harness skips
- [x] Run end-to-end after fetch+label; record baseline (AC-2, AC-4)

## Findings (baseline, n=24)
- Exact accuracy 95.8%, adjacent 100%. One disagreement: `sphinx-doc__sphinx-8120`
  predicted T2 vs labelled T1 — `cross_directory` signal counts a parent dir + its
  child subdir (`sphinx/` + `sphinx/locale/`) as 2-dir spread, inflating a 9-line
  fix. Candidate threshold-tuning target.
- **Caveat:** labels follow the size-based rubric, which correlates with the
  size-based classifier → high agreement is partly structural. To stress-test
  semantic complexity, a future pass should label from `problem_statement`
  difficulty independent of diff size, and include genuine T3/T4 (16+ file / 500+
  line) instances — the current strided subset is small-fix-skewed (dataset reality).
