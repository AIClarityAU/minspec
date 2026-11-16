# AI review panel disagreement - AIClarityAU/minspec

Sample window: 200 most recent PRs (by number) with >=1 AI-review comment: PR #2522 to #2849; run comments dated 2026-10-03T01:42:36Z to 2026-10-17T03:17:05Z. Of the 400 PRs listed (#2188-#2849), 398 had a review comment; the 200 newest were used.

Totals: 331 review comments; 29 are 'carried forward' (no voters ran, excluded from all metrics); 1 parse failures (excluded from metrics, listed in runs.jsonl with parse_ok=false: PRs [2721]); 301 runs analysed. PRs by class: {'spec': 156, 'machinery': 24, 'code': 14, 'docs': 6}. Runs by class (before excluding the one parse failure, which is a spec run): {'spec': 211, 'code': 24, 'machinery': 57, 'docs': 10}.

## Method
- Source: bot comments starting '## 🤖 AI review'; fetched via issues/<n>/comments (paginated). Label from header; each voter's `verdict:`/`blocking:` parsed from its REVIEW_VERDICT block; voters-that-ran from the footer and cross-checked against sections present (mismatch = parse failure).
- Class from `gh pr list` files: machinery (.github/, scripts/, .githooks/) beats spec (specs/); else docs if all .md; else code.
- Disagreement = multi-voter run with not all verdicts equal. Sole-blocker = label not-pass and exactly one voter non-pass. One-voter miss for V = share of not-pass runs where V ran and returned pass.
- PR level uses each PR's first non-carried run only.

## Caveats
- Sample is small for non-pass runs; per-class percentages rest on tiny denominators (see the counts).
- Class is by current PR file list (gh may cap files per PR; empty list classed as code). PRs can change files between pushes, so early runs may be classed by the final file set.
- Voter sets vary: Security runs only when code changed, so its miss rate has a different population; a voter that ran only on harder PRs is not comparable. Security is never present in docs/spec runs.
- 'Best single voter' picks the lowest miss share and can be a small-n artifact.
- Panel voters see the same diff and may be correlated; verdicts are only `pass`/`changes` in this sample. Later runs on a PR follow fixes of earlier findings, so run-level rates mix first reviews with re-reviews.
- The 'changes' fail-closed label case is treated as not-pass.

## Run level (all runs)

**Overall**

| Metric | Value |
|---|---|
| Runs (parsed, non-carried) | 301 |
| Runs with >=2 voters | 301 |
| Disagreement rate | 39/301 = 13.0% |
| Not-pass runs | 43 |
| Sole-blocker rate | 31/43 = 72.1% |
| Sole blocker by voter | {'architect': 13, 'skeptic': 6, 'reviewer': 12} |
| Not-pass runs where no voter returned non-pass (label/verdict mismatch) | 0 |
| One-voter miss: reviewer | 21/43 = 48.8% (not-pass runs where it ran) |
| One-voter miss: architect | 22/43 = 51.2% (not-pass runs where it ran) |
| One-voter miss: skeptic | 29/43 = 67.4% (not-pass runs where it ran) |
| One-voter miss: security | 10/13 = 76.9% (not-pass runs where it ran) |
| Best single voter (lowest miss, n>=1) | reviewer 21/43 = 48.8% |

**spec**

| Metric | Value |
|---|---|
| Runs (parsed, non-carried) | 210 |
| Runs with >=2 voters | 210 |
| Disagreement rate | 25/210 = 11.9% |
| Not-pass runs | 25 |
| Sole-blocker rate | 21/25 = 84.0% |
| Sole blocker by voter | {'skeptic': 5, 'architect': 9, 'reviewer': 7} |
| Not-pass runs where no voter returned non-pass (label/verdict mismatch) | 0 |
| One-voter miss: reviewer | 15/25 = 60.0% (not-pass runs where it ran) |
| One-voter miss: architect | 14/25 = 56.0% (not-pass runs where it ran) |
| One-voter miss: skeptic | 17/25 = 68.0% (not-pass runs where it ran) |
| One-voter miss: security | n/a (0) (not-pass runs where it ran) |
| Best single voter (lowest miss, n>=1) | architect 14/25 = 56.0% |

**machinery**

| Metric | Value |
|---|---|
| Runs (parsed, non-carried) | 57 |
| Runs with >=2 voters | 57 |
| Disagreement rate | 12/57 = 21.1% |
| Not-pass runs | 12 |
| Sole-blocker rate | 8/12 = 66.7% |
| Sole blocker by voter | {'architect': 3, 'skeptic': 1, 'reviewer': 4} |
| Not-pass runs where no voter returned non-pass (label/verdict mismatch) | 0 |
| One-voter miss: reviewer | 5/12 = 41.7% (not-pass runs where it ran) |
| One-voter miss: architect | 7/12 = 58.3% (not-pass runs where it ran) |
| One-voter miss: skeptic | 10/12 = 83.3% (not-pass runs where it ran) |
| One-voter miss: security | 9/12 = 75.0% (not-pass runs where it ran) |
| Best single voter (lowest miss, n>=1) | reviewer 5/12 = 41.7% |

**docs**

| Metric | Value |
|---|---|
| Runs (parsed, non-carried) | 10 |
| Runs with >=2 voters | 10 |
| Disagreement rate | 1/10 = 10.0% |
| Not-pass runs | 5 |
| Sole-blocker rate | 1/5 = 20.0% |
| Sole blocker by voter | {'reviewer': 1} |
| Not-pass runs where no voter returned non-pass (label/verdict mismatch) | 0 |
| One-voter miss: reviewer | 0/5 = 0.0% (not-pass runs where it ran) |
| One-voter miss: architect | 1/5 = 20.0% (not-pass runs where it ran) |
| One-voter miss: skeptic | 1/5 = 20.0% (not-pass runs where it ran) |
| One-voter miss: security | n/a (0) (not-pass runs where it ran) |
| Best single voter (lowest miss, n>=1) | reviewer 0/5 = 0.0% |

**code**

| Metric | Value |
|---|---|
| Runs (parsed, non-carried) | 24 |
| Runs with >=2 voters | 24 |
| Disagreement rate | 1/24 = 4.2% |
| Not-pass runs | 1 |
| Sole-blocker rate | 1/1 = 100.0% |
| Sole blocker by voter | {'architect': 1} |
| Not-pass runs where no voter returned non-pass (label/verdict mismatch) | 0 |
| One-voter miss: reviewer | 1/1 = 100.0% (not-pass runs where it ran) |
| One-voter miss: architect | 0/1 = 0.0% (not-pass runs where it ran) |
| One-voter miss: skeptic | 1/1 = 100.0% (not-pass runs where it ran) |
| One-voter miss: security | 1/1 = 100.0% (not-pass runs where it ran) |
| Best single voter (lowest miss, n>=1) | architect 0/1 = 0.0% |

## PR level (first non-carried run per PR)

**Overall**

| Metric | Value |
|---|---|
| Runs (parsed, non-carried) | 200 |
| Runs with >=2 voters | 200 |
| Disagreement rate | 25/200 = 12.5% |
| Not-pass runs | 28 |
| Sole-blocker rate | 19/28 = 67.9% |
| Sole blocker by voter | {'architect': 7, 'skeptic': 3, 'reviewer': 9} |
| Not-pass runs where no voter returned non-pass (label/verdict mismatch) | 0 |
| One-voter miss: reviewer | 11/28 = 39.3% (not-pass runs where it ran) |
| One-voter miss: architect | 16/28 = 57.1% (not-pass runs where it ran) |
| One-voter miss: skeptic | 18/28 = 64.3% (not-pass runs where it ran) |
| One-voter miss: security | 6/7 = 85.7% (not-pass runs where it ran) |
| Best single voter (lowest miss, n>=1) | reviewer 11/28 = 39.3% |

**spec**

| Metric | Value |
|---|---|
| Runs (parsed, non-carried) | 156 |
| Runs with >=2 voters | 156 |
| Disagreement rate | 17/156 = 10.9% |
| Not-pass runs | 17 |
| Sole-blocker rate | 13/17 = 76.5% |
| Sole blocker by voter | {'skeptic': 3, 'architect': 4, 'reviewer': 6} |
| Not-pass runs where no voter returned non-pass (label/verdict mismatch) | 0 |
| One-voter miss: reviewer | 8/17 = 47.1% (not-pass runs where it ran) |
| One-voter miss: architect | 11/17 = 64.7% (not-pass runs where it ran) |
| One-voter miss: skeptic | 11/17 = 64.7% (not-pass runs where it ran) |
| One-voter miss: security | n/a (0) (not-pass runs where it ran) |
| Best single voter (lowest miss, n>=1) | reviewer 8/17 = 47.1% |

**machinery**

| Metric | Value |
|---|---|
| Runs (parsed, non-carried) | 24 |
| Runs with >=2 voters | 24 |
| Disagreement rate | 6/24 = 25.0% |
| Not-pass runs | 6 |
| Sole-blocker rate | 4/6 = 66.7% |
| Sole blocker by voter | {'architect': 2, 'reviewer': 2} |
| Not-pass runs where no voter returned non-pass (label/verdict mismatch) | 0 |
| One-voter miss: reviewer | 2/6 = 33.3% (not-pass runs where it ran) |
| One-voter miss: architect | 4/6 = 66.7% (not-pass runs where it ran) |
| One-voter miss: skeptic | 5/6 = 83.3% (not-pass runs where it ran) |
| One-voter miss: security | 5/6 = 83.3% (not-pass runs where it ran) |
| Best single voter (lowest miss, n>=1) | reviewer 2/6 = 33.3% |

**docs**

| Metric | Value |
|---|---|
| Runs (parsed, non-carried) | 6 |
| Runs with >=2 voters | 6 |
| Disagreement rate | 1/6 = 16.7% |
| Not-pass runs | 4 |
| Sole-blocker rate | 1/4 = 25.0% |
| Sole blocker by voter | {'reviewer': 1} |
| Not-pass runs where no voter returned non-pass (label/verdict mismatch) | 0 |
| One-voter miss: reviewer | 0/4 = 0.0% (not-pass runs where it ran) |
| One-voter miss: architect | 1/4 = 25.0% (not-pass runs where it ran) |
| One-voter miss: skeptic | 1/4 = 25.0% (not-pass runs where it ran) |
| One-voter miss: security | n/a (0) (not-pass runs where it ran) |
| Best single voter (lowest miss, n>=1) | reviewer 0/4 = 0.0% |

**code**

| Metric | Value |
|---|---|
| Runs (parsed, non-carried) | 14 |
| Runs with >=2 voters | 14 |
| Disagreement rate | 1/14 = 7.1% |
| Not-pass runs | 1 |
| Sole-blocker rate | 1/1 = 100.0% |
| Sole blocker by voter | {'architect': 1} |
| Not-pass runs where no voter returned non-pass (label/verdict mismatch) | 0 |
| One-voter miss: reviewer | 1/1 = 100.0% (not-pass runs where it ran) |
| One-voter miss: architect | 0/1 = 0.0% (not-pass runs where it ran) |
| One-voter miss: skeptic | 1/1 = 100.0% (not-pass runs where it ran) |
| One-voter miss: security | 1/1 = 100.0% (not-pass runs where it ran) |
| Best single voter (lowest miss, n>=1) | architect 0/1 = 0.0% |
