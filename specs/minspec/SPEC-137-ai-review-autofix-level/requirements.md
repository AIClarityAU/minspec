---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - the review gate's findings become fixes, not only a verdict
aspects: [ai-review, auto-fix, severity, config, bounded-loop, hitl, no-silent-gate, blast-radius]
depends_on: [DR-033, DR-061, DR-074]  # DR-033 §6 owns the bounded request-changes -> dev loop this generalises; DR-061 owns merge-on-pass (never touched here); DR-074 the blast-radius rule
relates_to: ["#503", "#342", "#479", "#180", "#1169"]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Per-project AI-review auto-fix level

Source: issue #503. Specify phase only - nothing here is built.

**Scope sentence.** When a pull request gets `ai-review:changes`, a bounded fixer agent addresses the reviewer's findings at or above a per-project severity level (`major`, `moderate` default, `all`), commits to the PR branch, and is re-reviewed; it never merges.

## Background (verified against the repo)

- The reviewer emits a verdict block with `verdict`, `blocking`, `summary` and `findings: [{ severity, location, problem }]` (`scripts/review-pr.sh:170-176`, same shape in `scripts/review-branch.sh:193`). `severity` is free text today; the prompt does not fix a vocabulary.
- `scripts/review-decide.sh` is the pure fail-closed gate over that block (`blocking` + `verdict`, `review-decide.sh:212`).
- DR-033 §6 already specifies a `request-changes` -> dev auto-loop, bounded to 2 cycles (`docs/decisions/DR-033.md:109-113`), but it covers only auto-dispatched PRs.
- No `aiReview` key exists in `.minspec/config.json` handling today (grep of `packages/*/src` and `scripts` finds only `aiReviewWorkflowScaffolded` in `init.ts`).

## Functional requirements

- **FR-1 Config key.** `.minspec/config.json` accepts `aiReview.autoFixLevel` with values `major` | `moderate` | `all`. Absent -> `moderate`.
- **FR-2 Invalid value fails visibly.** An unknown value is reported as a config error naming the key and the allowed values, and no fixer is dispatched. It is never coerced silently to the default (invariant 2).
- **FR-3 Severity taxonomy.** One table maps reviewer severity tokens (case-insensitive) to a rank: `CRITICAL`, `HIGH`, `MAJOR`, `BLOCKING` -> major; `MEDIUM`, `MODERATE` -> moderate; `LOW`, `MINOR`, `NIT` -> low. Levels select: `major` = major only; `moderate` = major + moderate; `all` = everything.
- **FR-4 Unknown severity is not dropped.** A finding whose token is missing or unrecognised is treated as `major` (fail toward fixing/visibility) and the comment (FR-9) lists it as "unclassified".
- **FR-5 Reviewer vocabulary pinned.** The reviewer prompt names the allowed severity tokens so the filter and the producer share one list (single source of truth for the taxonomy; a test pins prompt and table together).
- **FR-6 Blocking findings always qualify.** Any finding counted in `blocking` is major regardless of its printed token.
- **FR-7 Filtered fixer input.** The fixer receives only findings at/above the level, the PR's changed-file list, and the instruction to edit only those files. The filter is deterministic code, not a prompt instruction.
- **FR-8 Bounded.** At most 2 fix rounds per PR (reusing DR-033 §6's bound); each round is followed by a re-review. After the bound with `ai-review:changes` still standing, the PR is escalated to the human (`agent-escalated`), never looped further.
- **FR-9 Below-level findings recorded.** Findings under the level are left unfixed and listed in one PR comment per round, with counts per severity.
- **FR-10 Scope.** The loop applies to any PR carrying `ai-review:changes`, not only auto-dispatched ones (extends DR-033 §6).
- **FR-11 Never merges.** The fixer only pushes commits to the PR branch. It holds no merge capability; merge stays with the existing DR-061 path on `ai-review:pass`.
- **FR-12 Self-edit-guarded paths.** If the fix touches `.github/` or `scripts/` machinery paths, the PR still requires human review/merge as before; the fixer cannot clear that requirement.
- **FR-13 Opt-in only.** Nothing runs in a repo without `.minspec/` (invariant 3). Whether the loop is on at all needs Clarify (see Decisions).
- **FR-14 Offline core.** Parsing config and filtering findings makes no network call (invariant 1); only dispatch and posting use the existing credentialed runner.

## Acceptance criteria

- **AC-1** Config absent -> level `moderate`; each of the three values parses; `"extreme"` yields a visible error and no dispatch.
- **AC-2** Given findings `[HIGH, MEDIUM, LOW]`: `major` -> {HIGH}; `moderate` -> {HIGH, MEDIUM}; `all` -> all three. Case variants (`High`, `low`) classify identically.
- **AC-3** A finding with severity `weird` or none is passed to the fixer at every level and listed as unclassified.
- **AC-4** With `blocking: 1` and its finding tagged `LOW`, the finding is still fixed at `major`.
- **AC-5** After 2 rounds with `ai-review:changes` still present, the PR gets `agent-escalated` and no third fixer starts.
- **AC-6** A below-level finding appears in the round comment and not in the fixer's prompt.
- **AC-7** No code path in the loop invokes merge or auto-merge enablement.
- **AC-8** A PR with no findings block (verdict `changes`, empty `findings`) dispatches no fixer and escalates (nothing to filter on).

## Invariants this must not break

- **INV-1** Offline core (constitution 1): filtering is pure local code.
- **INV-2** No silent gate (constitution 2): bad config, unparseable findings block, or a fixer that fails to push each produce a visible signal and leave the PR at `ai-review:changes`; none is treated as pass.
- **INV-3** Blast radius (constitution 3): nothing ships active in a repo without `.minspec/`.
- **INV-4** The review verdict stays fail-closed: the fixer cannot alter `review-decide.sh` behaviour or write the `ai-review:pass` label; only a fresh independent review can.
- **INV-5** Independence: the re-review runs in fresh context, not by the fixer.

## Decisions needed (Clarify)

1. **Default on or off?** The issue sets `moderate` as the default level but does not say whether the loop is enabled by default.
   - (a) Loop on for every project with `.minspec/` **(rec for issue intent)** - matches "default moderate"; cost: commits land on PR branches nobody asked for, and fixer spend appears with no opt-in.
   - (b) Add `aiReview.autoFix: true|false`, default false - safe under invariant 3; cost: an extra key and the feature is invisible until enabled.
2. **Where does the loop live?** Extend the dispatch chain only (local, today's DR-033 §6 location) vs. also a GitHub Action reacting to the label. The Action is the only way to cover human-authored PRs; cost: credentialed fixer on CI is a larger security surface (DR-008) and likely T4.
3. **Fixer on fork/human-authored PR branches.** Pushing to a human's branch may collide with their in-flight commits. Options: only PRs whose head branch is agent-owned (`agent/*`) **(rec)** - cost: human PRs get no auto-fix; or any branch with a force-push-free rebase check.
4. **Does a fix round consume the DR-033 §6 dev-cycle budget or have its own 2?** Separate budget **(rec)** keeps each loop's bound independent; cost: worst case 4 review cycles per PR.
5. **DR needed?** Extending DR-033 §6 beyond auto-dispatched PRs changes a recorded decision; recommend a short amending DR at Plan (not written here).

## Out of scope

Auto-merge changes (DR-061), reviewer prompt quality, per-severity custom thresholds beyond the three levels, team-mode profiles.
