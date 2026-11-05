---
id: SPEC-291
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - reviewer prompts are part of the gate chain; a prompt change needs a regression score
aspects: [ai-review, eval, measurement, no-silent-gate, offline]
depends_on: []
relates_to: ["#2983", "#2850", "SPEC-044", "DR-106", "DR-104", "DR-086"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decisions D1-D5.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-291: A reviewer eval set built from reverts and repeat-fixes, scored on every reviewer-prompt change

> **This is a SPECIFICATION ONLY.** Written for issue #2983. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

The ai-review reviewer (`.github/workflows/ai-review.yml`, `scripts/review-branch.sh`,
`scripts/roles/reviewer.md` and siblings) gates merges, yet nothing measures whether it is any
good, or whether a prompt edit made it better or worse. This spec adds a **fixture-driven eval
set**: each case is a real diff from a past revert or repeat-fix, plus the verdict a correct
reviewer should give. A runner replays the reviewer prompts over the cases and prints a score.
A prompt change is kept only if the score does not drop. Repeat-fixes are turned into cases
automatically, so the set grows without founder attention (tenet 1).

## Background (from the issue; claims here are about the issue, not verified code)

- Issue #2983 cites Anthropic's code-review post: every incident or revert becomes an eval
  case; the reviewer is scored daily. The post reports reverts down over 40% relative and
  publishes no scores. I have not re-read the post; this is the issue's account.
- Issue states no reviewer eval or score tracking exists. At spec time I confirmed only that
  `scripts/review-churn-report.sh` measures re-review churn (not reviewer quality) and no file
  named like an eval harness sits under `scripts/review-*` or `.github/workflows/ai-review*`.
- The repeat-fix share feeds the tenet-2 tripwire (#2850, "measure the 2% tripwire"; cited in
  DR-106). That share is the eval set's case-source count, so this spec makes it measurable.

## Functional requirements

- **FR1 - Case format.** A case is a directory/file of fixtures holding: the PR diff (a patch
  file), minimal context the reviewer receives in production (changed-file list, PR title/body),
  `expected` = `finding` (with the file and a short defect description) or `pass`, provenance
  (source PR/commit, the fix or revert that proved it), and a `kind` (`revert`, `repeat-fix`,
  `incident`, `clean-control`).
- **FR2 - Controls.** The set MUST include `clean-control` cases (diffs a correct reviewer
  passes), so a prompt that blocks everything cannot score well. Score reports recall on
  defect cases AND false-block rate on controls, never one alone.
- **FR3 - Runner.** One command replays every case through the same reviewer entry point and
  role prompts production uses (the BASE-version prompts `ai-review.yml` loads, not a copy),
  parses the verdict, and compares to `expected`.
- **FR4 - Score.** Output is a machine-readable result (per-case pass/fail, aggregate recall,
  false-block rate, N cases, prompt revision hash) and a one-line human summary. Results are
  appendable to a history file so drift over time is visible.
- **FR5 - Non-determinism handling.** The reviewer is an LLM. Each case runs K times (K set
  at Plan); a case counts as passed on a stated majority rule. The score reports K and the
  observed per-case flip rate, so noise is not read as signal.
- **FR6 - Prompt-change gate.** A change to the reviewer prompt set (the files the reviewer
  loads, per FR3) is accepted only if the score does not drop versus the recorded baseline
  beyond a stated tolerance (D3). The baseline is a committed artefact, updated only by a
  deliberate act.
- **FR7 - Seed.** Ship with the first few known reverts / repeat-fix PRs (count and selection
  at Plan; floor: at least 3 defect cases and 2 controls), each with verified provenance.
- **FR8 - Auto-filing.** Every repeat-fix (a fix to code a prior merged PR in this repo
  changed, or a revert of a merged PR) is detected and a draft case is filed without founder
  action. Detection rule and trigger are D2. A draft case carries `status: unreviewed` and
  does not count in the score until promoted (D4).
- **FR9 - Fail visibly.** An unrunnable harness, missing baseline, zero cases, or a runner
  error exits non-zero with a named reason. It never reports a passing score from an empty or
  errored run (invariant 2).
- **FR10 - Privacy of fixtures.** Fixtures contain only content already in this public/private
  repo's history; no secrets (the gitleaks pre-commit applies). Fixture diffs that themselves
  contain prompt-injection attempts are labelled and kept as cases, never executed.

## Out of scope

- Author-response tracking (fixed / disputed / ignored per finding). The issue calls it a
  companion that "feeds this set"; it is a separate measurement. Park as its own issue at Plan.
- Scoring non-reviewer agents (dev, triage). Changing reviewer behaviour itself.

## Acceptance criteria

- [ ] A case with a known defect diff is graded a miss when the reviewer passes it, and a hit
      when it blocks citing the right file; a clean-control that is blocked counts as a false block.
- [ ] Run against the current prompts, the runner emits recall, false-block rate, N, K and the
      prompt revision hash, and appends to the history file.
- [ ] Editing a prompt file so it passes everything makes recall fall and the gate (FR6) fail.
- [ ] Editing a prompt so it blocks everything makes false-block rate rise and the gate fail.
- [ ] Removing every case, or deleting the baseline, exits non-zero with a named reason.
- [ ] A merged revert PR produces a draft case file with provenance, no human step.
- [ ] A draft case is excluded from the score until promoted.
- [ ] The runner makes no network call except to the configured inference endpoint, and
      refuses to run without the explicit opt-in (D1).

## Invariants this must not break

- **INV-1 (offline by default, constitution 1).** Scoring calls an LLM, so it is never part of
  `npm test`, activation, or any default path; it runs only on explicit invocation or CI opt-in.
- **INV-2 (no silent gate, constitution 2).** FR6 is a gate: a missing/errored baseline or
  runner fails closed and visibly. It is not best-effort and has no `|| true`.
- **INV-3 (blast radius, constitution 3).** Dev-time tooling for this monorepo only; nothing
  ships into an adopter's repo, which has no `.minspec/` opt-in for it.
- **INV-4 (reviewer isolation).** Replaying a diff must preserve ai-review's trust model: the
  reviewer runs with read-only tools and no credential; fixture diffs are untrusted data.
- **INV-5 (tenet 2).** Cost of a scoring run is bounded and stated (cases x K x per-run
  tokens), expressed as a share of weekly budget before it is scheduled.

## Decisions needed (Clarify)

All 6 decisions are answered, not ratified: an agent session selected, for each, the option this document
already recommended. No human chose them, and no delegation covers authoring Clarify answers
(DLG-001, DR-108, covers spec approval and engineering-DR acceptance only). This spec is
unapproved, so these answers bind nothing until a human or a covered delegation approves it.

- **D1 - How is a scoring run triggered?**
  - **Option A (rec): on-demand command plus a CI job that runs only when a PR touches the
    reviewer prompt files.** *Cost:* each such PR spends tokens (cases x K) and CI needs the
    inference secret; reviewer-prompt PRs are rare, so spend is small.
  - Option B: daily scheduled run, as the post describes. *Cost:* recurring spend with no
    change to score unless prompts changed; mostly measures LLM noise.
  - Option C: on-demand only. *Cost:* the "kept only if score does not drop" rule becomes
    a human remembering, i.e. prose-trust (the failure the constitution warns of).
  **Recorded selection: Option A,** an on-demand command plus a CI job that runs only when a PR touches the reviewer prompt files. An agent session copied this document's (rec) option; no human chose this item.
- **D2 - What counts as a repeat-fix, and what triggers filing?**
  - **Option A (rec): GitHub-side signals only - a `Revert` PR, or a `fix` PR whose changed
    lines blame to a PR merged within a window (window at Plan).** *Cost:* blame heuristics
    produce false repeat-fixes; mitigated by drafts being unscored until promoted (D4).
  - Option B: revert PRs only. *Cost:* cheap and precise but misses most repeat-fixes, the
    case the issue names first.
  - Option C: manual labelling. *Cost:* reintroduces founder attention the issue forbids.
  **Recorded selection: Option A,** GitHub-side signals only: a `Revert` PR, or a `fix` PR whose changed lines blame to a PR merged within a window (window set at Plan). An agent session copied this document's (rec) option; no human chose this item.
- **D3 - Score-drop tolerance.** Option A (rec): zero tolerance on false-block rate and a
  fixed small tolerance on recall, set from measured flip rate at first baseline. *Cost:*
  the tolerance is a guess until the first baseline is measured. Option B: strict no-drop on
  both. *Cost:* LLM noise makes it flap and train people to bypass it.
  **Recorded selection: Option A,** zero tolerance on false-block rate and a fixed small tolerance on recall, set from the measured flip rate at the first baseline. An agent session copied this document's (rec) option; no human chose this item.
- **D4 - Who promotes a draft case to scored?** Option A (rec): a deterministic check - the
  draft's expected verdict is accepted when the proving fix/revert diff itself is attached
  and the case replays consistently over K runs. *Cost:* a mislabelled case can enter
  silently. Option B: founder approves each case. *Cost:* the attention tenet 1 retires.
  **Recorded selection: Option A,** a deterministic check promotes a draft case to scored. An agent session copied this document's (rec) option; no human chose this item.
- **D5 - Where do cases live?** Option A (rec): `tests/review-eval/` (fixtures) with the
  runner under `scripts/`. *Cost:* the allowlist for dev agents covers it, but large diffs
  bloat the repo. Option B: a separate private repo. *Cost:* the BASE-prompts coupling in
  FR3 spans two repos and fixtures drift from the code they test.
  **Recorded selection: Option A,** cases live in `tests/review-eval/` with the runner under `scripts/`. An agent session copied this document's (rec) option; no human chose this item.
- **D6 - Does this need a decision record?** The case format and baseline-gate semantics are
  reversible in under a day, so I recommend no DR unless D1 picks a scheduled run with
  recurring spend. *Cost:* if wrong, the spend commitment lands undocumented.
  **Recorded selection: no DR,** no decision record is needed unless D1 picks a scheduled run with recurring spend. An agent session copied this document's (rec) option; no human chose this item.

## Follow-ups (tracked)

- #2850 - repeat-fix share (tenet-2 tripwire) is read from this set's case-source counts; wire
  at Plan.
- Author-response tracking (fixed / disputed / ignored) - not yet filed; to be filed as its own
  issue when this spec is approved, since it would change the D4 promotion rule.
