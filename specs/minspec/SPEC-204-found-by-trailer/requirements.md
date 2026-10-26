---
id: SPEC-204
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - RCDD is part of the methodology; this adds the field that lets its output be aggregated
aspects: [rcdd, commit-msg, metrics, facts, no-silent-gate, blast-radius]
depends_on: [SPEC-001, DR-003, DR-037, DR-074]  # DR-003 owns the Root cause: gate this extends; DR-037 the git hooks; DR-074 the blast-radius rule
relates_to: [DR-059, "#1293", "#1050", "#1758"]
# Ownership declared in Specify (SPEC-038). The first group is the repo's own hook and the
# facts oracle. The shipped-template change is NOT listed under implements: because whether
# it happens at all is Decision D1 below.
implements: [.githooks/commit-msg, scripts/facts.ts, scripts/lib/found-by.ts]
affects: [package.json]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-204: Found-by trailer on fix commits

Issue: #1293 (Found-by trailer on fix commits). Rationale rests on DR-003 (RCDD: every
`fix:` states a root cause) - this spec adds a second mandatory, closed-vocabulary field.
No new DR: the choice is reversible in under a day (one hook, one report).

## Problem

A merge-history audit measured 65% of machinery PRs followed within 14 days by a fix/revert
on the same file (36% non-machinery), and 46% of machinery PRs are themselves fixes. That
number mixes two things the data cannot separate today:

- **iteration** - the next slice of a feature being built corrects what the last slice did.
  Expected and healthy while machinery is the active build surface.
- **shipped defect** - merged behaviour, relied on, then found broken in use.

Only the second should drive gate-relaxation (auto-merge scope, HITL removal). Nothing in a
commit records which one a fix was.

## Scope sentence

Every `fix` commit made in this repo carries a `Found-by:` trailer from a closed vocabulary,
the commit-msg hook rejects a missing or unknown value, and `npm run facts -- defects`
reports the distribution per path class and time window.

## Functional requirements

- **FR-1** The `.githooks/commit-msg` gate, for a subject matching the existing fix pattern
  (`fix:`, `fix(scope):`, `fix!:`, `fix(scope)!:`), MUST require a `Found-by:` line in the
  body alongside `Root cause:`.
- **FR-2** The value MUST be exactly one of `usage`, `build`, `review`, `audit` (case-
  insensitive on the key; value compared lower-case after trimming). Meanings:
  `usage` broke in real use after merge (shipped defect); `build` found while building the
  next slice on top (iteration); `review` caught by ai-review or human review before it bit;
  `audit` found by a deliberate sweep, not by breakage.
- **FR-3** A missing key, an empty value, an unknown value, or more than one `Found-by:` line
  MUST reject the commit (exit 1) with a message naming the problem, the four allowed values
  and their meanings, and the `RCDD_GATE_OFF=1` escape. A missing `Root cause:` and a bad
  `Found-by:` are both reported in one run, not one per attempt.
- **FR-4** `RCDD_GATE_OFF=1` bypasses the new check exactly as it bypasses the root-cause
  check. The existing fail-open on an unreadable message file is unchanged.
- **FR-5** Non-`fix` subjects are unaffected; the existing chore/refactor advisory is
  unchanged. A `Found-by:` on a non-fix commit is allowed and not validated.
- **FR-6** The vocabulary, the parser and the path-class mapping live in one TypeScript module
  (`scripts/lib/found-by.ts`). The shell hook carries a hand-copied vocabulary, and a test
  pins the copy to the module (the #1758 pattern: a shell file cannot import).
- **FR-7** `npm run facts -- defects [--since <date>] [--window <days>]` reads `git log` and
  reports, for fix commits that carry a valid `Found-by:`, counts per value per path class,
  per time window (default: 30-day windows, newest first). Path classes: `gate-critical`,
  `operational-machinery`, `packages`, `docs`, `other`. A commit touching several classes
  counts once in each class it touches, and the report states that.
- **FR-8** Fix commits with NO valid `Found-by:` (everything before this lands, and bypassed
  commits) are reported as a separate `unlabelled` count per class, never folded into any
  value and never backfilled. The report prints the `usage` rate per class as
  `usage / labelled`, with the labelled count beside it, so a rate over a handful of commits
  is visibly thin.
- **FR-9** `defects` is strictly read-only (same rule as every other `facts` command) and
  Tier-0: git and fs only, no network (invariant 1).
- **FR-10** Reverts (`revert:` / `Revert "..."` subjects) are out of the vocabulary and out of
  the report; they are not `fix` commits. See D3.

## Non-goals

- No backfill of history (the metric starts at the day this lands).
- No gate or merge decision consumes `Found-by:` in this spec. It steers attention only.
- No change to ai-review, dispatch, or auto-merge-gate.

## Acceptance criteria

- **AC-1** `fix(x): y` with `Root cause:` but no `Found-by:` -> hook exits 1, message lists the
  four values.
- **AC-2** Same with `Found-by: usage` -> exit 0. Same for each of the other three values.
- **AC-3** `Found-by: other`, `Found-by:` (empty), and two `Found-by:` lines -> exit 1 each.
- **AC-4** `RCDD_GATE_OFF=1` with no trailer -> exit 0.
- **AC-5** `feat:` / `chore:` without the trailer -> exit 0, unchanged advisory behaviour.
- **AC-6** A test drives the real hook script against a temp message file for AC-1..AC-5, and
  asserts the hook's vocabulary equals the module's (FR-6).
- **AC-7** `facts defects` on a fixture repo with fix commits across two path classes and two
  windows prints the expected per-class, per-value, per-window counts, an `unlabelled` count,
  and the `usage` rate with its denominator.
- **AC-8** `facts defects` on a repo with zero labelled fixes prints all-zero counts and the
  unlabelled total, exits 0, and does not print a rate of NaN.
- **AC-9** The audit's churn stat can be recomputed decomposed once data accrues: the report
  output includes, per class, `usage` (shipped) vs `build` (iteration) side by side.

## Invariants this must not break

- **Invariant 1 (offline).** Hook and report make no network call.
- **Invariant 2 (no silent gate).** The hook rejects visibly. The existing fail-open on an
  unreadable message file is kept as-is (not widened). A `git log` failure in `facts defects`
  prints an error and exits non-zero rather than printing an empty, healthy-looking report.
- **Invariant 3 (blast radius).** See D1: nothing shipped to a repo that did not opt in may
  change. A repo-local `.githooks/commit-msg` edit affects only this repo.
- **Self-report caveat (stated up front).** The author sets the trailer, so it is model-trusted
  prose in the enforce-don't-trust sense. The hook makes it present and well-formed, not
  true. Acceptable only because it gates nothing; if any gate ever reads it, that gate needs
  an independent witness first (constitution invariant 2). The `defects` output header
  states "self-reported" so the number is not read as measured.

## Decisions needed (Clarify)

3 of 4 decisions are resolved: an agent session recorded each option this document already
recommended, under delegation DLG-001 (DR-108, the delegated-approval record). No human
chose them; they are ratified only by approval of this spec. D4 names no
recommended option, so it stays open for Clarify.

- **D1 - Repo-only, or also the hook MinSpec scaffolds into adopters?**
  `packages/minspec/src/lib/template-registry.ts` ships its own `commit-msg` hook (the
  `Root cause:` gate, lines ~587 and ~1659) to adopter repos.
  - **(a) This repo only (rec)** - edit `.githooks/commit-msg`; leave the template alone. Cost:
    adopters get no `Found-by:` metric, and the repo hook and the shipped hook diverge further.
    Honours invariant 3 trivially and avoids touching `template-registry.ts`, which is review
    machinery needing a human merge.
  - (b) Also the shipped template, opt-in via a `.minspec/config.json` key defaulting off.
    Cost: new config surface, a second hand-copied vocabulary to keep pinned, and a machinery PR.
  - (c) Also the shipped template, on by default. Rejected: it changes behaviour for existing
    adopters on re-scaffold (constitution invariant 3).
  **Recorded selection: Option (a),** this repo only: edit `.githooks/commit-msg` and leave the
  shipped template alone, so existing adopters see no change (invariant 3).
- **D2 - Is `usage` rate worth a path-class mapping of its own, or reuse the existing set?**
  The classes `gate-critical` / `operational-machinery` come from the issue; the repo has one
  canonical machinery set (`packages/minspec/src/lib/machinery-paths.ts`, #1758).
  - **(a) Reuse it (rec)** - `operational-machinery` = machinery set minus the gate-critical
    subset; the subset is a short explicit list in `found-by.ts`. Cost: the gate-critical list is
    a judgement call that needs the founder's eye once (proposed: `.githooks/`,
    `.github/workflows/`, `.github/scripts/`, `scripts/auto-merge-gate.ts`, the machinery-paths
    module itself).
  - (b) Define classes by top-level directory only. Cost: cannot separate the gate itself from
    dispatch plumbing, which is the distinction relaxation decisions turn on.
  **Recorded selection: Option (a),** reuse the canonical machinery set, with the gate-critical
  subset as a short explicit list in `found-by.ts`, so the gate stays separable from dispatch
  plumbing.
- **D3 - Should `revert` commits be countable?** A revert is strong evidence of a shipped
  defect but carries no root cause today.
  - **(a) Out of scope (rec)** - keep the vocabulary on `fix` only. Cost: reverts, plausibly the
    clearest `usage` signal, are invisible to this metric.
  - (b) Treat `Revert` subjects as `fix`-like and require the trailer. Cost: a hook change on a
    subject pattern git generates automatically, so the trailer would have to be added by hand
    after every `git revert`.
  **Recorded selection: Option (a),** out of scope; the vocabulary stays on `fix` only.
- **D4 - Value semantics for a fix to a fix found while iterating.** `build` vs `usage` is the
  author's call. Proposed rule, for the hook's help text: if the defect was visible to someone
  other than the author before the fix was started, it is `usage`. Founder to confirm or
  reword; the rule lives in the help text only and is not enforced.
