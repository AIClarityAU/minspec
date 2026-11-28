---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - auditability of the review gate itself, and what secrets may leave the runner
aspects: [audit, ai-review, break-glass, admin-merge, quota-classifier, retry-cron, secret-egress, no-silent-gate, independence]
depends_on: [DR-033, DR-079]  # DR-033 section 6 defines the independent reviewer this audit stands in for; DR-079 is the later verdict-channel rewrite that changed most of the code under audit
relates_to: [DR-003, DR-086, "#524", "#486", "#487", "#488", "#519", "#344", "#349", "#1204"]
# This spec owns NO code. Its deliverable is an audit record and the issues it files.
# It names no `implements:`/`affects:` paths on purpose: any defect the audit confirms is
# fixed under its own issue, by its own author, with its own independent review.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Retroactive independent review of the three `--admin` break-glass merges to the AI-review machinery (#487, #488, #519)

Triggered by: #524 (audit: retroactive independent AI-review of the --admin break-glass merges).
Design rests on: DR-033 section 6 (the independent reviewer), DR-079 (the verdict travels out of band), DR-003 (root cause before fix).

## In plain terms

Three pull requests that changed the AI reviewer itself were merged by `--admin` on
2026-07-04 and 2026-07-05. Each one had to be: its own review ran the old, broken
reviewer from `main`. The author tested each one. Nobody else read them. That is the gap
the reviewer exists to close.

This spec sets out a one-time audit to close that gap. A reviewer with fresh context,
who did not write the code, reads all three merges. Each finding is then traced to
today's `main`: is it still live, fixed since, or in code that no longer exists? Live
defects get their own issues. The audit fixes nothing itself.

Cost: one fresh-context review session, plus triage of what it finds. Riskiest part: about
960 commits have landed since #519. The verdict-channel rewrite (DR-079) and the quota
reset-time work (#1204) replaced much of this code. An audit of the old diffs alone would
mostly report dead code. An audit of today's code alone would not show whether the
unreviewed merges let anything through in the meantime. FR-3 requires both.

## One-Sentence Scope

Independently review the merged diffs of #487, #488 and #519. Classify every finding
against current `main` as live, fixed since, or gone. File one issue per live defect,
and record the full result on #524. Fix nothing.

## Context - what was merged, measured from git

| PR | Merge commit | Date | Files | What it did (from the commit message, not yet independently verified) |
|---|---|---|---|---|
| #487 | `edf6c5df` | 2026-07-04 | `.github/workflows/ai-review.yml` (+3/-1) | Fixed a `startup_failure`: a literal `${{ }}` in a `run:` comment |
| #488 | `2d940f3d` | 2026-07-04 | `.github/workflows/ci.yml` (+21) | Added an `actionlint` gate on workflows |
| #519 | `ca49f94c` | 2026-07-05 | 7 files, +358/-58: `ai-review-guard.js` (+test), `ai-review-retry.yml` (new), `ai-review.yml`, `review-branch.sh`, `review-decide.sh`, `review-decide.test.ts` | Passed the verdict check-run BODY as an env var. Added `isQuotaExhaustion`, the `ai-review:blocked` label and `action_required` check, the hourly retry cron, and the PAYG failover |

`git log --oneline ca49f94c..HEAD | wc -l` gives 961 commits at the time of writing.

### The four focus areas named by #524, mapped to code

These are my reading of the issue's terms, checked against the diffs. FR-2 has the auditor
confirm the mapping.

1. **Quota classifier.** `isQuotaExhaustion` in `.github/scripts/ai-review-guard.js`. At
   #519, `review-branch.sh` called it through `is_quota()` on the **combined
   stdout+stderr** of a reviewer run that produced no verdict. On today's `main` the same
   regex is still at `ai-review-guard.js:314-324`. A narrower `isQuotaExhaustionStrict`
   now sits beside it (`:343-348`).
2. **Blocked combine and label logic.** At #519: `review-decide.sh` maps
   `REVIEW_UNAVAILABLE` to `ai-review:blocked`, and that check comes **first**.
   `decideReviewCheck` maps `blocked` to `action_required`. `ai-review.yml` applies the
   label and posts the comment. On `main`, `review-decide.sh` now matches an anchored
   `REVIEW_UNAVAILABLE_BEGIN` line (`review-decide.sh:71`).
3. **Retry cron auth.** `.github/workflows/ai-review-retry.yml` holds
   `permissions: actions: write` and finds runs to re-run with
   `gh run list --workflow ai-review.yml --branch "$branch"`, where `$branch` is the PR's
   `headRefName`. On `main` it still selects runs that way (`ai-review-retry.yml:130-131`).
   It has since gained `pull-requests: write` (`:35`).
4. **Egress guard.** I believe this means the `redact()` filter in `ai-review.yml`. It
   scrubs `sk-ant-*`, the literal OAuth token, and the literal `ANTHROPIC_API_KEY` from
   reviewer text before it reaches a PR comment (`ai-review.yml:497-520` on `main`).
   #519 opened a **new path out**: it posts the `REVIEW_UNAVAILABLE` detail, taken from raw
   reviewer output, to the PR comment. It also added a second secret (the PAYG
   `ANTHROPIC_API_KEY`) to the job env. This reading is unverified; see OQ-1.

### Hypotheses to test (from reading the diffs - NOT findings)

These come from the author of this spec, who is not independent of the audit. They are a
starting checklist and must not be copied into the audit result unverified (FR-5). The
auditor must still review the full diffs, not just these points (FR-4).

- **H1 (classifier over-match).** At #519 the classifier read the reviewer's **own prose**,
  not just harness errors. A no-verdict run on a PR that discusses quotas, which #519
  itself does, would match `quota` or `rate limit` and be labelled `blocked`, not
  `changes`. A PR author could also do this on purpose: a diff that coaxes the reviewer to
  write no verdict and mention "rate limit" turns a fail-closed `changes` into `blocked`.
  `blocked` still stops the merge, so this is not a bypass. The harm is that it hides the
  real cause and loops the retry cron. The later `Strict` variant suggests this was found
  and fixed; the audit must check that, not assume it.
- **H2 (classifier under-match).** The loose regex wraps `insufficient (quota|credit)` in
  `\b...\b`, so `insufficient credits` does not match. I ran it locally on `main` at the
  time of writing: `isQuotaExhaustion` returns `false` for `"insufficient credits"`,
  `"Your credit balance is too low"`, `"overloaded_error"` and `"529"`. Whether the real
  CLI prints these strings is not verified. A miss sends a transient outage down the
  fail-closed `changes` path. That is safe, but it is the very confusion #519 set out to
  remove.
- **H3 (unanchored marker).** At #519, `review-decide.sh` ran `grep -q 'REVIEW_UNAVAILABLE'`
  over all of its input before any verdict check. A reviewer that quoted the token, for
  example while reviewing #519, would turn a real verdict into `blocked`.
- **H4 (retry run selection).** The run to re-run is chosen by branch name alone, so two
  open PRs with the same `headRefName` (a fork's `main`, say) could re-run the wrong
  PR's review. Re-running a fork PR's `pull_request` run: what token and what secrets does
  it get? The token is `actions: write`, and failures are swallowed with
  `2>/dev/null || true`. The retry is not itself a merge gate, so invariant 2 (no silent
  gate) may or may not apply; the auditor decides and gives the reason.
- **H5 (redaction).** `awk -v tok=...` treats backslashes in the value as escape
  sequences, so a secret containing `\` would not match literally. The secret also sits in
  `awk`'s argv for the life of that process. And the new detail path in #519 runs
  `redact` on the extracted block; the auditor checks whether any path posts reviewer
  output without it.
- **H6 (#487/#488).** Does the actionlint gate added in #488 fail closed? A missing or
  errored `actionlint` must fail the job, not pass it. Is its download pinned by version
  and checksum (supply chain)?

## Terms

- **Break-glass merge.** A merge done with `gh pr merge --admin`, which bypasses the
  ruleset's required checks.
- **Independent reviewer.** An agent session that did not author, co-author or review the
  PR under audit. It has no access to the authoring session's transcript. It reads only
  the diff, the code it touches, and the repo as it was at the merge commit and as it is on
  `main` now.
- **Live / fixed-since / gone.** How a finding stands on current `main`. Live: the
  defective behaviour still happens. Fixed-since: the behaviour has changed, and the
  commit that changed it is named. Gone: the code no longer exists. All three need a
  `file:line` citation or a commit SHA.

## Functional Requirements

- **FR-1 Independence.** The audit is done by a reviewer that meets the *Independent
  reviewer* definition. The record names the model and how it was launched, and states
  that it had no access to the #487/#488/#519 authoring transcripts or PR conversations.
  It may read the PR bodies only after recording its own first-pass findings. This stops
  the author's framing from anchoring the review.
- **FR-2 Scope.** The audit covers every changed line in the three merge commits
  (`edf6c5df`, `2d940f3d`, `ca49f94c`), not just the four focus areas. Each focus area
  (the classifier, blocked combine/label, retry cron auth, egress guard) gets an explicit
  section in the result, even if that section says "no findings". The auditor confirms or
  corrects the focus-area mapping in *Context* above.
- **FR-3 Two passes.** (a) **As-merged pass:** review each diff against the repo at its
  merge commit. (b) **Forward pass:** classify each as-merged finding as live,
  fixed-since or gone on current `main` (FR terms). Separately, check the **current**
  descendants of the four focus areas for defects of the same class, even if the as-merged
  code was clean.
- **FR-4 Security checklist.** Evaluate each diff against the OWASP Top 10 and the CI
  threats that apply here, and record each item as covered or n/a with a reason:
  - injection: shell, `${{ }}` expression, and prompt injection from PR content into the
    reviewer
  - broken access control: token scopes, label authority, which runs can be re-run by
    whom
  - secret exposure: the egress paths
  - fail-open error handling (constitution invariant 2)
  - supply chain: any action or binary fetched, and how it is pinned
- **FR-5 Evidence bar.** Every finding has: severity (CRITICAL / HIGH / MEDIUM / LOW /
  INFO), `file:line` as merged and as on `main`, a concrete failure scenario (input or
  state, then wrong outcome), and a recommendation. Where it can be shown without network
  access, it is shown: for a classifier finding, the exact input string and the
  function's actual return value. A finding not reproduced is labelled "inferred,
  unverified" in the same sentence (CLAUDE.md, *Mechanism claims*). No hypothesis from
  *Hypotheses to test* enters the result without this evidence.
- **FR-6 No fixes.** The audit changes no file outside its own record. Each live defect
  becomes one GitHub issue, which links #524 and this spec and carries the FR-5 fields and
  a root cause in the DR-003 sense: the mechanism, plus the gate that should have caught
  it. Fixed-since and gone findings are recorded on #524 only.
- **FR-7 Result record.** A single comment on #524 (or a file under `specs/`; see OQ-2)
  lists, for each PR and focus area: the findings, their live/fixed-since/gone state, and
  the issue numbers filed. It also states the review scope: commits, files and the
  checklist covered. If nothing is found, it says "no issues found" and gives that same
  scope, so an empty result cannot be read as "not looked at".
- **FR-8 Calibration.** The record says whether the three break-glass merges let in any
  defect that was live on `main` at any point, and if so, which. This is the measured
  answer to "did skipping independent review cost anything here?", which OQ-3 needs.

## Acceptance Criteria

- **AC-1.** The result record exists and names all three merge SHAs. It covers every
  file in each diff (7 for #519, 1 each for #487 and #488) and has a section for each of
  the four focus areas.
- **AC-2.** Each of H1-H6 is marked confirmed (with an issue number if live), refuted
  (with the evidence), or not applicable (with a reason). None is left silent.
- **AC-3.** Each classifier finding includes at least one literal input string and the
  observed `isQuotaExhaustion` / `isQuotaExhaustionStrict` return value, run locally
  against the cited revision.
- **AC-4.** Each live finding has its own open issue with the FR-5 fields and a
  `Root cause:` line, and each issue links back to #524.
- **AC-5.** The record has the FR-1 independence statement and the FR-4 checklist with
  each item marked covered or n/a.
- **AC-6.** `git diff --name-only` for the audit's own commits touches nothing outside
  `specs/**` (FR-6).

## Invariants (must not break)

- **Constitution 1 (offline).** The audit runs the classifier and parsers locally. It
  makes no call to Anthropic or any other endpoint to "test" quota behaviour. GitHub API
  reads and the issue/comment writes are the only network use, and they happen inside the
  dispatcher's normal publish path.
- **Constitution 2 (no silent gate).** The audit itself must not be a silent pass. A
  focus area that could not be checked is reported as "not checked: <reason>", never left
  out (FR-7).
- **Constitution 3 (blast radius).** No finding's recommendation may propose a change
  that alters behaviour outside this repo.
- **Inv-10 / no secret material.** The record and the issues quote secret **names** and
  redaction **mechanisms** only. They never quote a token value, even a partial one, and
  never quote raw runner output that has not been through `redact()`.
- **DR-033 section 6.** The audit result is a review, never an approval. It does not
  apply or change any `ai-review:*` label on any PR.

## Decisions needed (Clarify)

- **OQ-1 What does "egress-guard changes" mean in #524?** The two #519 diffs I read
  contain no change that names an "egress guard".
  - `a` **(rec)** Treat it as the `redact()` secret-scrub filter plus the new output path
    to the PR comment and the new PAYG secret in the job env (focus area 4 as written).
    Cost: if the founder meant something else, such as a network egress allow-list on the
    runner, that is missed until someone notices.
  - `b` The founder names the intended code before the audit starts. Cost: one more round
    trip before the work can begin.
- **OQ-2 Where does the audit record live?**
  - `a` **(rec)** A comment on #524, with live defects as their own issues. This matches
    the earlier merged-audit sweep (#344-#349). Cost: a comment is not under version
    control or covered by the frontmatter gate, so it can be edited after the fact with no
    trace in git.
  - `b` A committed `specs/minspec/SPEC-137-.../audit.md`. Cost: it needs a PR and goes
    through the reviewer it is auditing, which is circular for a review of the reviewer.
- **OQ-3 One-off audit, or also a standing rule?** The root cause in the DR-003 sense is
  not these three PRs. It is that a break-glass `--admin` merge has no gate that schedules
  the independent review it skipped. That review happened here only because someone
  remembered to file #524 (the constitution's "enforce, don't trust the model").
  - `a` **(rec)** Keep this spec to the one-off audit, and file a separate issue for the
    standing mechanism: every `--admin` merge of a PR without `ai-review:pass` auto-files a
    retroactive-review issue. Cost: until that issue is built, the next break-glass merge
    has the same gap. FR-8's result shows how much that matters.
  - `b` Widen this spec to include the mechanism. Cost: it turns an audit into a
    machinery change (a T4-sized workflow edit that itself needs `--admin`) and delays the
    audit behind it. This is the "and X" scope expansion that CLAUDE.md's triage rules say
    to confirm first.
- **OQ-4 Which model does the audit?**
  - `a` **(rec)** A different model family or version from the one that wrote the three
    PRs (Claude Opus 4.8, according to their co-author trailers). Cost: a weaker model may
    find less.
  - `b` The same model in fresh context. Cost: shared blind spots. The memory note
    *Review own diff adversarially* records a converging panel that passed two defects.

## Risks

- **Dead-code noise.** Most #519 code has been rewritten. Mitigated by FR-3(b): only live
  findings become issues.
- **Anchoring on this spec's hypotheses.** The author of this spec is not independent.
  Mitigated by FR-1 (first pass before reading framing) and FR-2 (full diff, not just the
  H-list).
- **Spec id collision.** `SPEC-137` is max-on-disk + 1. An open PR may hold the same id.
  If the collision check reports one, renumber.

## Out of Scope

- Fixing any finding (FR-6).
- Re-auditing other `--admin` merges. If OQ-3 `a` is chosen, the standing mechanism
  covers future ones. A sweep of all past break-glass merges is a separate issue.
- Testing quota behaviour against live Anthropic endpoints (Constitution 1).

## Traceability

- Issue: #524 (this audit). Parent incident: #486 (ai-review `startup_failure`).
- Merges under audit: #487 `edf6c5df`, #488 `2d940f3d`, #519 `ca49f94c`.
- Earlier precedent: the merged-audit sweep that filed #344-#349.
- Later code changes to trace forward through: DR-079 (verdict channel), #1204 (reset-instant extraction).
