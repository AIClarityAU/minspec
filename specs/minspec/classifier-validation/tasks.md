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

## Findings

### Run A — size-based labels (n=24)
Exact 95.8%, adjacent 100%. High — but labels followed the size rubric, which
correlates with the size-based classifier by construction. Circular; not a real test.

### Run B — semantic labels (n=50, 10 repos) — THE REAL TEST
Labels assigned from `problem_statement` difficulty, independent of diff size.

- **Exact 18%, adjacent 80%.** Classifier predicted **T1 for 42 of 50** instances.
- Confusion (rows=expected, cols=predicted):
  ```
          T1   T2   T3   T4
   T1      4    0    0    0
   T2     28    4    0    0
   T3     10    3    1    0
  ```
- **10 outliers, all T3→T1**: subtle bugs (nested CompoundModel separability,
  GFK+UUID prefetch, tz reverse-conversion, ConditionSet subs, …) shipped as small
  gold patches → classifier calls them T1.

### Root cause (not a bug, a design limit)
Every signal is size/blast-radius (file count, line count, cross-dir, file-types,
new-files, deps). **Semantic difficulty is orthogonal to diff size.**
`astropy-12907` (T3, +1/-1) and `django-11790` (T1, +3/-1) are size-identical →
both T1. No threshold setting separates them. **Tuning thresholds cannot fix this**;
it would only inflate the genuine T1s. The classifier measures *mechanical scope*,
not *cognitive difficulty*, and systematically **under-tiers subtle small fixes** —
recommending one-sentence-spec (T1) ceremony for changes that demand deep
understanding (T3).

### Implications (for user decision — NOT actioned)
1. **Reframe (cheapest):** document tier = mechanical/blast-radius scope; rely on the
   existing user-override + calibration path to bump subtle work up. Honest about scope.
2. **Augment signals (real work):** add non-AI difficulty proxies (AST cyclomatic
   complexity of changed hunks, symbol count, nesting depth) via the existing
   ast-analyzer. Limited gain — subtle fixes often have low *local* complexity too.
3. **NLP difficulty scoring:** highest signal, but reads issue text → near invariant
   #1 (no AI). Out unless reframed as opt-in.

Park (2) and (3) as issues; (1) is a doc change pending user call.
