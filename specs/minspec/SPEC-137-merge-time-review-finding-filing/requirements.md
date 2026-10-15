---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-010  # Reviewer Across All Approvables
aspects: [reviewer, traceability, no-silent-gate, offline, trust-boundary]
depends_on: [SPEC-031]
relates_to: [SPEC-054, DR-053, DR-033, DR-047, DR-023, "#465", "#698", "#342", "#362", "#627"]
implements: []  # Ownership is declared at Plan, once the producer/consumer split in FR-3/FR-8 is chosen.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: File unresolved non-blocking review findings as issues at merge time

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. A human reads
> it, answers **Decisions needed (Clarify)**, and approves it through the normal
> spec-approval gate before any code changes.

Materializes [#465](https://github.com/AIClarityAU/minspec/issues/465). The one-shot
backlog sweep is [#698](https://github.com/AIClarityAU/minspec/issues/698) and is out of
scope here; it reuses this spec's extractor (FR-4). Id scheme: DR-053 v2 (`RF` type code,
`proposed`).

## In plain terms

The independent reviewer lists non-blocking findings in its PR comment. Nothing reads them
again, so on merge they vanish. This spec adds one step when a PR merges: each finding that
is still open becomes an `inbox` issue carrying a stable id (`MIN/PR451/RF3`) and a link
back to the review comment. Findings fixed before merge file nothing.

## Root cause

`scripts/review-decide.sh` consumes only `verdict` and `blocking`. The `findings:` list is
rendered into the PR comment by `scripts/review-pr.sh` and has no consumer: no gate, issue
or label reads it. The gap is the missing consumer, not a data error.

## Functional requirements

- **FR-1 Stable ids, parent-stamped.** The credentialed parent (`review-pr.sh`) stamps each
  finding `RFn` when it renders the comment. The no-tools reviewer never allocates ids.
  `n` is per-PR, starting at 1, allocated once, never reused; a retracted finding leaves a
  gap (DR-053 §3.1). Re-reviews after a push continue the sequence from the highest `n`
  already present in that PR's review comments; a finding re-reported unchanged keeps its
  existing id (matched by location + problem text).
- **FR-2 Machine-readable record.** The rendered comment carries each finding as a
  parseable row: id, severity, location, problem. The extractor reads only comments authored
  by the review bot identity, never free text from other authors.
- **FR-3 Merge-time trigger.** A step runs when a PR is merged (not closed unmerged). It
  runs exactly once per merge; a re-run is a no-op (FR-6).
- **FR-4 Unresolved-only extraction.** A finding is *unresolved* if it is non-blocking and
  none of: its review thread is resolved, the location was changed by a later commit on the
  PR branch, or it is marked addressed (see Decisions needed D-2). The extractor is a pure
  function over (comments, threads, commits) so #698 can reuse it.
- **FR-5 Issue filing.** Each unresolved finding becomes one issue titled
  `[MIN/PR<n>/RF<m>] <problem, truncated>`, labelled `inbox` plus `bug` or `idea` by
  severity/shape, body linking the review comment, the PR and the location. Finding text is
  untrusted (derived from a diff): it is quoted in a code fence and never interpreted as
  instructions or labels.
- **FR-6 Idempotent.** Before filing, the step searches for an existing issue whose title
  carries the same id; if found, it skips. Two merges racing, or a retry, never duplicate.
- **FR-7 Fail visible, never silent (invariant 2).** If extraction or filing fails, the step
  exits non-zero and posts a visible comment on the merged PR naming the findings not filed.
  A missing or unparseable review comment on a PR that *had* a reviewer verdict is a failure,
  not "no findings". A PR with no review is a visible, distinct skip.
- **FR-8 Opt-in and offline.** The step runs only in repos with `.minspec/` at the root
  (invariant 3) and is a CI/dev-time script, never part of the Tier-0 extension (invariant 1).
- **FR-9 Volume bound.** At most N findings are filed per PR (default 10); the remainder
  are listed in one summary comment on the PR, so a noisy review cannot flood the tracker.
- **FR-10 Provenance.** The filed issue and the audit comment cite the same handle, so a
  fix commit can reference `MIN/PR451/RF3`.

## Acceptance criteria

- **AC-1** A merged PR with 3 unresolved findings yields 3 issues, each with the right id,
  labels and a working link to the review comment.
- **AC-2** A finding on a resolved thread, or on a line a later commit rewrote, files nothing.
- **AC-3** Running the step twice on the same PR creates no second issue (FR-6).
- **AC-4** Corrupting the findings block makes the step fail loudly with a PR comment; it
  does not report success with zero filed.
- **AC-5** A finding whose text contains `ai-review:pass` or a label directive changes no
  label and runs nothing.
- **AC-6** A PR closed without merging files nothing.
- **AC-7** The extractor is callable on a historical PR with no side effects (for #698).

## Invariants this must not break

- Offline core (1): no extension-side network call; the step is CI/dev tooling only.
- No silent gate (2): FR-7; no `|| true` on the filing path; an independent witness is the
  PR comment listing unfiled findings.
- Blast radius (3): gated on `.minspec/`.
- The deterministic review gate (`review-decide.sh`) is unchanged: filing never affects
  `ai-review:pass`/`changes`.

## Out of scope

Backfill of merged PRs (#698). Changing which findings the reviewer emits. Auto-fixing.

## Decisions needed (Clarify)

- **D-1 Where the step runs.** (a) **(rec)** GitHub Actions workflow on `pull_request: closed`
  with `merged == true`; runs for every merge path, cost: a new workflow (machinery PR,
  human `--admin` merge) and a token able to create issues. (b) Extend the merge script
  only; no new workflow, cost: misses merges done in the web UI.
- **D-2 What counts as "addressed".** (a) **(rec)** resolved thread OR later commit touched
  the location, cost: a touch-but-not-fixed edit suppresses a real finding. (b) Resolved
  thread only, cost: reviewer comments rendered as one PR comment have no threads, so
  everything would file. (c) Explicit author reply marker, cost: manual step per finding.
- **D-3 Severity filter.** (a) **(rec)** file every non-blocking finding, cost: some
  tracker noise, bounded by FR-9. (b) LOW and above only, cost: nits vanish again.
- **D-4 `RF` id dependency.** DR-053 `RF` is `proposed`. (a) **(rec)** build with the id
  now; if DR-053 rejects `RF`, the id is a local label and issues still file, cost: possible
  later rename. (b) Wait for DR-053 Accept, cost: the leak stays open meanwhile.
