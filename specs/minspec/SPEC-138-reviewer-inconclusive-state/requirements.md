---
id: SPEC-138
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — ai-review gate incidents
aspects: [ci, gates, ai-review, silent-failure, no-silent-gate, reviewer]
relates_to: [DR-079, DR-066, SPEC-031, "#535", "#519", "#1131", "#1204", "#1165"]
implements: [scripts/review-branch.sh, scripts/review-decide.sh, .github/scripts/ai-review-guard.js]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Reviewer "ran but returned no verdict" is its own state (Requirements)

> Materializes **[#535](https://github.com/AIClarityAU/minspec/issues/535)**: on a large diff the
> `security` role of `review-branch.sh` produced no verdict on every run while the `reviewer` role
> in the same run passed. Rests on [DR-079](../../../docs/decisions/DR-079.md) (verdict carried
> out of band as schema-validated structured output) and constitution invariant #2 (no silent gate).

## One-Sentence Scope

When the reviewer agent ran but returned no schema-valid verdict and the cause is not quota, the
gate must say so explicitly — a distinct, retry-able **inconclusive** state naming the cause —
instead of the same silent `ai-review:changes` a real "changes requested" produces; and a large
diff must not be what starves the verdict.

## Background (verified against code on this branch)

- A verdict is accepted only if the CLI envelope carries a schema-valid `structured_output`
  (`parseCliVerdict`, `.github/scripts/ai-review-guard.js:172-182`); `is_error: true` or a missing
  object yields empty (`:180-181`).
- `review-branch.sh` then asks `quota_failure` (`:~417`); if not quota it takes branch 3
  (`:~460-465`): prints the output to **stderr only**, emits **no verdict**, and
  `review-decide.sh` maps "no block" to `ai-review:changes` (the `-z "$BLOCK"` branch).
- So "agent hit its turn/budget limit", "malformed output", "CLI crash" and "reviewed and
  wants changes" all reach the PR as `ai-review:changes`, and the cause lives only in a CI log.
- The full diff is embedded in the prompt with no size cap (`REVIEW_INPUT`, `:152-154`), and the
  role is allowed to Read/Glob/Grep — so a large diff plus exploratory reading is the plausible
  way to exhaust the budget. *I believe* the failing runs hit a turn limit; this is **unverified**
  (no captured envelope) — see FR-1 and Decision D1.

## Functional requirements

- **FR-1 — Capture the cause.** In the non-quota no-verdict path, `review-branch.sh` records the
  envelope's `subtype`/`is_error`/`num_turns` (when parseable) and byte counts of stdout/stderr and
  of the diff, and includes them in the emitted marker (FR-2). Parsing is via the tested guard,
  not ad-hoc shell.
- **FR-2 — Distinct inconclusive state.** That path emits a marker
  `REVIEW_UNAVAILABLE_BEGIN … reason: inconclusive …` (same wrapper as the quota case, with a
  different `reason:`), which `review-decide.sh` labels `ai-review:blocked`-family retry-able,
  never `ai-review:changes`. Decision D2 fixes whether this reuses `ai-review:blocked` or adds a
  sibling label.
- **FR-3 — Never a pass.** An inconclusive result keeps merge-gating red (invariant #2): it fails
  the required check visibly, with the reason string on the PR, and cannot satisfy `ready-to-merge`.
- **FR-4 — Bounded retry.** Inconclusive is retried at most N times (default 1, configurable) with
  a reduced-scope prompt (FR-5); after N it stays inconclusive and surfaces to a human. It must
  not loop indefinitely the way an unbounded `blocked` retry could.
- **FR-5 — Diff-size handling.** Above a byte threshold the diff in the prompt is truncated by
  whole-file hunks with an explicit trailer naming the omitted files ("diff truncated; N files
  omitted — read them with Read/Grep"), so the verdict is not starved. Truncation is announced in
  the rendered verdict summary so a pass over a truncated diff is never read as a full review.
- **FR-6 — Verdict-first contract.** The prompt instructs the agent to decide the verdict early and
  to stop exploring with enough turns left to return it; the role's turn budget is stated in the
  prompt. (A prompt hint is advisory only — FR-1..FR-4 are the enforced part.)
- **FR-7 — Role parity.** Behaviour is identical for `reviewer|security|architect|skeptic`; a role
  that routinely ends inconclusive is visible in the marker's `role:` field.

## Acceptance criteria

- **AC-1** Envelope `{is_error:true, subtype:"error_max_turns"}` with no quota phrasing → marker with
  `reason: inconclusive` and the subtype; `review-decide.sh` ⇒ blocked-family, not `changes`.
- **AC-2** Valid `structured_output` with `verdict: changes` → still `ai-review:changes` (unchanged).
- **AC-3** Quota phrasing → still `reason: quota` (unchanged); the two reasons are distinguishable.
- **AC-4** Empty/garbage stdout, empty stderr → inconclusive with byte counts, not silent.
- **AC-5** Diff over threshold → prompt contains the truncation trailer; under threshold → byte-identical prompt to today.
- **AC-6** Inconclusive never produces `ai-review:pass`; after N retries it stays non-pass and non-silent.
- **AC-7** A reviewer's prose quoting `REVIEW_UNAVAILABLE_BEGIN` cannot forge the state (reuse the
  line-anchored patterns; DR-079 / #1165 forgery class).

## Invariants this must not break

- **INV-1** Fail closed: no outcome of this change can turn a missing verdict into a pass.
- **INV-2** No silent gate (constitution #2): the new state is visible on the PR, not only in CI logs.
- **INV-3** Quota classification (#519/#1131/#1204) is unchanged and runs first.
- **INV-4** Verdict stays out-of-band structured output (DR-079); no verdict parsed from prose.
- **INV-5** Offline Tier 0: no new network calls; no new dependencies.

## Out of scope

Changing role prompts' review criteria; raising model budgets globally; the PAYG failover path.

## Decisions needed (Clarify)

- **D1 — Confirm the cause before designing around it.** Options: (a) **(rec)** ship FR-1 first and
  design FR-5/FR-6 from a captured envelope — costs one extra cycle before the size fix; (b) ship
  all now on the budget-starvation hypothesis — risks a threshold that fixes nothing if the cause
  is e.g. schema rejection.
- **D2 — Label.** (a) **(rec)** reuse `ai-review:blocked` with `reason: inconclusive` — no new label
  or workflow edits, but a human scanning labels cannot tell outage from inconclusive without
  opening the comment; (b) new `ai-review:inconclusive` — clearer, but touches label appliers and
  the retry workflow (machinery, needs human `--admin`).
- **D3 — Truncation threshold and N.** Proposed 200 KB diff and N=1; needs a measured figure from
  #479's diff (which is not in this spec's evidence).
- **D4 — Does a pass on a truncated diff count?** (a) **(rec)** pass allowed but labelled
  "partial review" in the summary — costs a weaker guarantee on huge PRs; (b) truncated ⇒ never
  pass, human must review — strictest, but large machinery PRs would then never auto-pass.
