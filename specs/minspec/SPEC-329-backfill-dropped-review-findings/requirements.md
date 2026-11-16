---
id: SPEC-329
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - stops the ai-review gate silently discarding findings
aspects: [ai-review, backfill, traceability, no-silent-gate, offline]
depends_on: []
relates_to: ["#698", "#465", "#362", "#627", "DR-053", "DR-079", "SPEC-325"]
implements: none
implements_reason: >-
  Specify phase only. Expected surface: a dev-time, re-runnable sweep script under `scripts/`
  plus tests. Which files it owns, and whether it shares #465's extractor, is decided at Plan
  after the Clarify decisions below.
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-329: One-shot sweep of already-merged PRs for dropped non-blocking ai-review findings

> **This is a SPECIFICATION ONLY.** Written for issue #698. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.
> Design rests on DR-053 §3 (the `RF` type-code, `status: accepted`). No new decision record:
> every choice here is reversible in under a day.

## In plain terms

The ai-review reviewer lists non-blocking findings (`LOW`, `minor`, `nit`) in the
`findings:` list of its `## 🤖 AI review` comment. The merge gate (`scripts/review-decide.sh`)
reads only `verdict` and `blocking`, so those findings are never read again. Issue #465 will
file them for PRs merged *after* it ships. This spec covers the backlog: a one-shot,
re-runnable sweep over PRs already merged. It files only findings no later commit in that PR
fixed, and tags each with its `MIN/PRn/RFm` handle so a second run skips what is already filed.

Measured by the issue: 24 of 40 sampled merged PRs (60%) carried such a list, so roughly
100-120 PRs. The count of *unresolved* findings is not measured. Finding it out is the first
job of the dry run (FR-6).

## Scope

In: enumerate merged PRs, extract findings, filter to unresolved, file issues, dedup.
Out: the merge-time forward mechanism (#465); changing `review-pr.sh` output format;
re-reviewing PRs (#362); approvable defects (#627); the sealbox variant (#455).

## Functional requirements

- **FR-1 Enumerate.** The sweep lists merged PRs oldest-first (`gh pr list --state merged`,
  paginated past the 100-row default) and processes each independently. A PR with no
  `## 🤖 AI review` comment is skipped and counted, not an error.
- **FR-2 Extract.** From the review comment's verdict fence, parse the `findings:` list into
  `{severity, location, problem}` rows. If the PR has several review comments (re-reviews), use
  the one that governed the merge (see D2). A comment whose fence cannot be parsed is reported
  by PR number in the run summary and never counted as "no findings" (invariant 2).
- **FR-3 Non-blocking only.** Rows with a blocking severity are not filed; they stopped, or
  were overridden at, the merge and belong to the gate, not the backlog. The severity set that
  counts as non-blocking is decided in D3.
- **FR-4 Unresolved-only.** A finding is dropped when a commit in the same PR, authored
  after the review comment, touches the file named in its `location` (D1 fixes the exact
  rule). Findings with no parseable file in `location` cannot be judged resolved and are kept,
  marked `resolution: unknown` in the issue body.
- **FR-5 Stable handle.** Each surviving finding gets `MIN/PR<n>/RF<m>`, where `m` is the
  1-based position in the **full** parsed list of the chosen comment, before any filtering, so
  dropping a resolved finding never renumbers its neighbours. The handle appears in the issue
  title and body.
- **FR-6 Dry run is the default.** With no flag the sweep makes no write: it prints, per PR,
  findings parsed / dropped as resolved / would-file, plus totals. Filing needs an explicit
  flag. This is also how the unmeasured unresolved count is established before any filing.
- **FR-7 File.** Each survivor becomes one issue labelled `inbox` plus `bug` or `idea`. The
  split rule is in D4. The body links the source PR and the review comment, quotes severity,
  location and problem verbatim (as untrusted text, fenced), and states the sweep run date.
- **FR-8 Dedup / re-runnable.** Before filing, the sweep looks up existing issues by handle
  (open and closed). A handle with any issue is skipped. Two consecutive runs file nothing the
  second time. The lookup failing (network, auth, rate limit) aborts that PR visibly; it never
  falls through to filing, because that would duplicate.
- **FR-9 Rate and volume.** Filing is paced under the GitHub secondary rate limit and takes a
  `--max-issues N` cap, so a bad parse cannot create hundreds of issues in one run.
  Stopping at the cap is reported and resumable by FR-8.
- **FR-10 Visible failure.** Every skip, parse failure and API error is listed in the summary
  with its PR number. Exit status is non-zero if any PR failed to be evaluated, so a partial
  sweep cannot read as a complete one.
- **FR-11 Shared extractor.** The parser and the unresolved filter are one module that #465 can
  consume, not two copies (D5). A fixture-based test runs both callers against the same
  comment samples.

## Acceptance criteria

1. Given a merged PR whose review comment lists three non-blocking findings, one of whose
   `location` file was changed by a later commit, a filing run creates exactly two issues,
   whose handles keep their original positions: if the fixed one was the first, the survivors
   are `RF2` and `RF3`, not `RF1` and `RF2`.
2. A second run over the same PRs files zero issues.
3. A dry run (no flag) performs zero writes, proven by a stubbed `gh` that fails on any
   mutating call.
4. A comment whose fence is malformed appears in the summary and makes the exit status
   non-zero; it does not file and is not counted as "no findings".
5. A finding whose text contains issue-markdown or `@name` mentions is quoted inside a fence
   in the issue body and notifies nobody.
6. A dedup lookup error stops that PR's filing and is reported; nothing is filed for it.
7. `--max-issues 5` stops after five and the next run continues from where it stopped.
8. A PR with a blocking-severity row files only its non-blocking rows.

## Invariants the change must not break

- **Offline core (constitution invariant 1).** The sweep is a dev-time script under
  `scripts/`, run on explicit invocation. It adds no network call to the shipped extension and
  no scheduled or automatic run.
- **No silent gate (invariant 2).** No `|| true` around a lookup or a write; a parse or API
  failure is visible and fails the run (FR-8, FR-10).
- **Blast radius (invariant 3).** It touches only this repo's issues. Nothing ships to
  adopters; nothing is gated on `.minspec/`-less repos.
- **Untrusted input.** Review comments and findings are model output derived from PR content.
  They are quoted, never executed, never interpolated into a shell or `gh` argument unquoted
  (cf. DR-079 out-of-band verdict).
- **Signal over noise (G-4).** Nothing is bulk-filed blind; FR-4 and FR-6 are the guard.
- **Issue-body tokens.** The sweep must not manufacture labels such as `agent-ready` that
  would auto-dispatch work; backfilled issues land in `inbox` only.

## Decisions needed (Clarify)

**D1 - What counts as "resolved"?**
(a) **(rec)** A later commit in the PR touches the file in `location`. Cheap, deterministic,
offline-checkable. Cost: over-drops when the later commit touched the file for an unrelated
reason, so some real findings are lost; under-counts nothing.
(b) File plus line proximity (changed hunk within N lines of the cited line). Fewer false
drops; cost: line numbers in `location` are model-written and often wrong or stale, so it adds
a parser that fails often.
(c) Ask a model to judge each finding against later diffs. Best accuracy; cost: spends tokens
on ~100 PRs, is non-deterministic, and re-opens the model-trust problem the gate avoids.

**D2 - Which comment when a PR has several reviews?**
(a) **(rec)** The last review comment posted before merge, since that verdict governed the
merge. Cost: findings only in earlier rounds are dropped, though the later round probably
re-raised any that mattered.
(b) Union of all rounds, deduplicated by text. Loses nothing; cost: `RF` positions have no
single list to index, so handles need a different scheme.

**D3 - Which severities are in scope?**
The issue names `LOW`/`minor`/`nit`. The reviewer prompt does not fix a vocabulary (see
`scripts/review-pr.sh` "Fields"), so real comments may use others.
(a) **(rec)** Run the dry run first, list the distinct severity strings seen, then fix an
allowlist from that. Cost: one extra step before filing.
(b) File everything that is not literally blocking. Cost: unknown-severity rows may include
real defects filed as low-priority noise.

**D4 - `bug` vs `idea` rule.**
(a) **(rec)** Every backfilled issue is `idea,inbox`; the human or triage reclassifies. Cost:
a real defect waits as an idea until triaged.
(b) Keyword rule on the problem text. Cost: a heuristic that will misclassify and cannot be
checked offline.

**D5 - Who builds the extractor, #465 or this?**
`specs/` holds no spec for #465 and no extractor exists on main, as far as I could check.
(a) **(rec)** Build it here as a standalone module with a stable interface and have #465
consume it (the issue's own second option). Cost: #465's design is constrained by an
interface chosen before its spec is written.
(b) Wait for #465. Cost: this backfill is blocked on work with no spec yet.

**D6 - Backfill depth.** (a) **(rec)** All merged PRs once the dry-run total is known to be
small enough to triage. Cost: if the unresolved count is in the hundreds, inbox flooding.
(b) Only the last N days. Cost: older findings stay lost, which is the very leak being fixed.

## Follow-ups (tracked)

- #465 - forward mechanism; consumes the shared extractor (D5).
- Handle storage: this spec relies on the handle in issue title/body as the dedup key. If the
  DR-053 trace graph needs a machine index, that is a separate issue, not filed here.
