---
id: SPEC-375
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-010  # Reviewer Across All Approvables - a deliberate quota pause is a distinct, visible review state
aspects: [ci, ai-review, quota, fail-closed, adopter-config]
depends_on: []
relates_to: ["#1060", "#609", "#1204", "#1086", "SPEC-078", "SPEC-074", "SPEC-334", "SPEC-237"]
implements: none
implements_reason: >-
  Specify phase only. Expected surface: a first step in .github/workflows/ai-review.yml, a pickup branch in
  .github/workflows/ai-review-retry.yml, and the matching scaffolded templates (ci-review-templates.ts). None is built.
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-375: `ai-review:paused` - a deliberate quota pause, distinct from `ai-review:blocked`

Issue: #1060 (sub-issue of #609 session-limit-aware autopause). Relates to the existing `blocked` path and its
`<!-- ai-review-reset: ISO -->` marker (#1204, `.github/workflows/ai-review.yml:943`, read at
`.github/workflows/ai-review-retry.yml:119`).

## Problem

`ai-review:blocked` means the reviewer **tried and could not run** (quota already gone). There is no way to say
the reviewer **chose not to run** so the human keeps interactive headroom. Reusing `blocked` conflates a failure
to observe with a deliberate policy choice, and a blocked round still spends a paid attempt.

CI runs on GitHub Actions runners and cannot read a local pause-signal file, so the pause must be a repo-side
value the local side sets and the workflow reads.

## Functional requirements

- **FR-1 Pause signal.** A repo Actions variable `AI_REVIEW_PAUSED_UNTIL` is the sole pause input. Value is an
  ISO-8601 UTC instant, or the sentinel for "paused, reset time unknown" (see Decision D1). Unset or empty means
  not paused. The workflow only reads it.
- **FR-2 Gate first.** The pause check is the first step of the review job in `ai-review.yml`, before any step that
  invokes Claude or mints a paid token. When paused, no voter runs.
- **FR-3 Paused outcome.** When paused (variable set and, if a timestamp, still in the future): clear any stale
  `ai-review:pass`/`carried`, apply `ai-review:paused`, post one comment, publish the `ai-review` check-run as a
  non-success conclusion, and end the job. `ai-review:paused` is mutually exclusive with `pending/pass/changes/blocked`.
- **FR-4 Observed reset only.** The comment names the reset time only when the variable carries a parseable
  timestamp that someone observed. Otherwise it reads "paused until the window resets" with no time. The workflow
  never computes or estimates a reset. The comment carries the existing `<!-- ai-review-reset: ISO -->` marker only
  in the known-time case.
- **FR-5 Never satisfies the gate.** The required `ai-review` check stays unsatisfied while paused (same posture
  as `blocked`; see D2 for pending vs failure). Un-reviewed code cannot land. Auto-merge, the carried-pass path
  (SPEC-334) and the machinery path must not treat `paused` as pass.
- **FR-6 Visible.** The pause is visible on the PR: the label, the comment and the check-run title all say "paused".
  A green or absent check is never the paused signal (constitution invariant 2).
- **FR-7 Label created defensively.** `ai-review:paused` is created with `gh label create ... || true`-free
  visible failure handling, alongside the existing labels (`ai-review.yml:256-266`), so a fresh repo has it.
- **FR-8 Retry pickup.** `ai-review-retry.yml` selects PRs labelled `ai-review:paused` as well as `blocked`. It
  skips while the reset (marker or variable) is in the future, and re-runs ai-review once it has passed. A missing
  time falls through to the normal cadence, never to "skip forever", matching #1204.
- **FR-9 Clear after reset.** The first successful post-reset run (verdict pass or changes, not paused/blocked)
  clears `AI_REVIEW_PAUSED_UNTIL`. A clearing failure is reported visibly, not swallowed; an expired timestamp
  already reads as not paused, so a failed clear cannot re-pause (FR-1).
- **FR-10 Precedence.** Combined verdict precedence is `changes > blocked > paused > pass`. A real verdict is never
  masked by a pause. Since the pause gate short-circuits before voters, this only matters for a re-run that started
  before the pause was set: if any voter produced `changes` or `blocked`, that label wins.
- **FR-11 Parity.** The scaffolded adopter templates (`ci-review-templates.ts`) and the dogfood workflows stay
  byte-aligned, and the existing parity tests cover the new step. A fresh adopter gets a pause that does nothing
  until its variable is set (constitution invariant 3: no behaviour change in a repo that has not opted in).

## Acceptance criteria

- [ ] AC-1 `ai-review:paused` is created alongside the existing labels (FR-7).
- [ ] AC-2 The pause gate precedes every Claude-invoking and token-minting step; a paused run spends no quota (FR-2).
- [ ] AC-3 Known reset: comment names it plus the marker. Unknown or unparseable: no time, no marker (FR-4).
- [ ] AC-4 Paused PR: required `ai-review` check not success; `ai-review:pass` removed (FR-3, FR-5).
- [ ] AC-5 Retry picks up `paused`, skips before reset, re-runs after, clears the variable once (FR-8, FR-9).
- [ ] AC-6 Precedence table test: every `changes/blocked/paused/pass` combination (FR-10).
- [ ] AC-7 Variable unset: behaviour byte-identical to today (FR-11).
- [ ] AC-8 Expired timestamp reads as not paused (FR-1, FR-9).

## Invariants this must not break

1. No silent gate: paused is visible and never a green check; an unreadable variable fails closed visibly
   (treated as paused-unknown or as blocked, see D3), never as not paused silently.
2. Offline core / no network without consent: this is CI-side only; MinSpec's extension makes no new call.
3. Blast radius: only repos with the opt-in marker and the variable set change behaviour.
4. Never estimate: no guessed reset time anywhere.

## Out of scope

The local side that decides to pause and sets the variable (rest of #609). This spec defines only the
repo-side contract the local side writes to.

## Decisions needed (Clarify)

- **D1 Unknown-reset sentinel.** The variable must express "paused, time unknown".
  (a) **(rec)** a literal value `unknown` alongside ISO timestamps: one variable, explicit; cost: a second value
  shape the parser and local writer must agree on, and an unknown pause has no expiry so a forgotten one pauses
  reviews until a human clears it (mitigated by FR-4 visible comment on every PR).
  (b) a second variable `AI_REVIEW_PAUSED` boolean plus the timestamp variable; cost: two writes can diverge.
  **Recorded selection: the recommended option,** (a), a literal value `unknown` alongside ISO timestamps. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
- **D2 Check conclusion while paused.** (a) **(rec)** `failure`-class like `blocked`, so the required check is
  plainly red and reads as unmet; cost: red CI noise on every open PR during a pause. (b) `neutral`/pending;
  cost: some branch-protection setups treat neutral as passing, the exact silent-green this must avoid, and it
  would need verifying against the repo's ruleset first.
  **Recorded selection: the recommended option,** (a), `failure`-class like `blocked`. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
- **D3 Unreadable variable.** If the variable API call fails (permission, outage): (a) **(rec)** proceed as not
  paused and review normally; cost: a pause can be silently ignored for that run and quota spent, though no
  unreviewed code lands. (b) fail closed to `blocked`; cost: an outage of the variables API halts all reviews.
  Note the token needs `actions: read`/variables read; confirm the reviewer App has it.
  **Recorded selection: the recommended option,** (a), proceed as not paused and review normally. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
- **D4 Who clears the variable.** (a) **(rec)** the retry workflow after the first successful post-reset run
  (as the issue states); cost: it needs variable-write permission, which the App token may lack (to verify at plan
  time). (b) never clear; rely on timestamp expiry only; cost: unknown-reset pauses (D1a) never self-clear.
  **Recorded selection: the recommended option,** (a), the retry workflow clears the variable after the first successful post-reset run. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
