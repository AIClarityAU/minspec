---
id: SPEC-323
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - the approval/acceptance flow this arms
aspects: [approval, acceptance, auto-merge, consent, founder-credential, fail-visible]
depends_on: []
relates_to: ["#3515", "#2852", "SPEC-050", "SPEC-296", "DR-112", "DR-119", "DR-078"]
implements: none
implements_reason: >-
  Specify phase only. Expected surface: `packages/minspec/src/commands/commit-on-approve.ts`
  (`openApprovalPr`, line 804 at the time of writing) plus one small arm seam and tests. None of it is claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-323: A founder acceptance arms its own pull request under the founder's credential

Issue: #3515 (a founder acceptance stops at an open PR, so it waits hours for a second keystroke).
Rests on DR-112 (bot-merge record, section 2: `.minspec/approvals/` and an added `status: accepted` stay the founder's) and DR-078 section 4 (one consent accessor per act).

## Problem

When the founder accepts a decision record or approves a spec in the editor, `openApprovalPr` (`commit-on-approve.ts`) ends at an open pull request. The bot may not merge that class (DR-112 section 2), so landing needs a second founder keystroke to arm auto-merge. Measured by job rcdd-accept-landing-1101 (2026-11-01): DR-114 (#3395) waited 5h40m for the arm; DR-119 (#3499) waited 27h51m and had not landed. His primary checkout stays dirty until then.

Root cause (mechanism): nothing after PR creation arms the PR, and the only actor that may without breaking DR-112 is the founder's own credential. This spec adds that step in the same act as the acceptance.

## Functional requirements

- **FR-1 Arm after create.** After the editor successfully creates a status-transition pull request (spec approval or DR acceptance, via `openApprovalPr`), it runs `gh pr merge <url> --auto --squash --match-head-commit <sha>` against that PR (`<sha>` = the head the editor just pushed), in the same act, with no further keystroke. The pin is DR-112 section 1(c)'s mechanism: a push after the arm changes the head, so GitHub refuses the merge instead of landing unreviewed commits.
- **FR-2 Founder credential only.** The arm runs only under the founder's own `gh` credential, as the editor already runs `gh pr create`. If the active identity is a bot/app token (e.g. `GH_TOKEN` of an installation, or the identity probe says non-user), the arm is skipped and reported (FR-5). It never mints or borrows a credential.
- **FR-3 Consent once, then stands.** Before the first arm, one consent prompt names what will happen from now on: "MinSpec will arm auto-merge (squash) on every acceptance/approval PR you open from this editor." It carries the risk: the arm is pinned to the head commit it was armed on, so a later push blocks the merge until the founder re-arms. Choosing yes stores a standing consent; later acceptances do not re-prompt. Declining stores nothing that arms, and the PR is left open as today.
- **FR-4 No arm without consent.** With consent absent, withheld, or the prompt dismissed, no `gh pr merge` call is made. Consent is read through the single accessor pattern of DR-078 section 4 (project-local preference first, then the VS Code setting) so two surfaces cannot disagree. A revoked setting wins over a stored yes.
- **FR-5 A failed arm is visible.** If the arm fails (non-zero exit, auto-merge disabled on the repo, missing permission, identity refused, gh absent), the editor says so in a notification naming the PR and the reason, and the PR stays open. The success toast must not claim "landed" or "will land" on a failed arm. The text distinguishes "armed" (waits on checks) from "merged".
- **FR-6 Never rejects.** The arm step never throws out of `openApprovalPr`; a failure degrades to FR-5 and the approval itself is unaffected (same contract as `openApprovalPr` today).
- **FR-7 Scope.** Only PRs this editor just created from a status transition. A pre-existing/adopted PR (the FR-6 adopt path of SPEC-050) and manual-mode PRs are not armed by this step.
- **FR-8 Offline default.** With `pushOnApprove` = never, or PR mode manual, no network call is made (constitution invariant 1).

## Acceptance criteria

- **AC-1** Given consent and a created PR, exactly one `gh pr merge <url> --auto --squash --match-head-commit <sha>` is attempted, with `<sha>` the pushed head.
- **AC-2** Given a non-zero exit from the arm, a failure notification naming the PR is shown, no success/landed wording is shown, and `openApprovalPr` still resolves.
- **AC-3** Given no stored consent and a dismissed or declined prompt, zero arm calls occur.
- **AC-4** Given a bot/app-token identity, zero arm calls occur and the skip is reported.
- **AC-5** Given stored consent, a second acceptance prompts nothing and arms.
- **AC-6** Tests assert AC-1..AC-5 by observing the injected `run` seam, not source text.

## Invariants (must not break)

- **INV-1** No silent gate: a failed arm is shown, never swallowed (constitution invariant 2).
- **INV-2** DR-112 stands: the bot never arms; no bot token path reaches the arm.
- **INV-3** Offline and consent-gated (constitution invariant 1); blast radius limited to a repo with `.minspec/` (invariant 3).
- **INV-4** Approval correctness is unaffected: the arm happens after the approval commit and PR exist, and cannot change what was approved.
- **INV-6** Governing records: DR-112 (section 1(c) and rejected alternatives), DR-119 (approval lane: "never auto-merge", line 170; rejected alternative, line 269) and the approval-only self-merge record reject arming native auto-merge because it stays armed across later pushes. This spec is lawful only with (i) the head-commit pin of FR-1 and (ii) the DR amendment of Decision 4; without both it contradicts those records and must not proceed past Clarify.
- **INV-5** The arm adds no merge path beyond what the required checks and ruleset already allow; native auto-merge still waits on them.

## Out of scope

Ranking founder-authored PRs first in `cos.py pr-drive` (host patch, tracked by the runner). #2852 (new approvables reach him as PRs) is about drafts, not landing.

## Decisions needed (Clarify)

1. **Where consent lives.** (a) Reuse `minspec.pushOnApprove` `always`/project-local preference as the consent **(rec)**: one surface, matches DR-078; cost: a user who allowed push now also allows arming, which is a wider grant than they gave. (b) New dedicated setting `minspec.armOnApprove`: exact consent; cost: a second surface that can disagree with the first.
2. **Push-after-arm risk.** An armed PR stays armed across later pushes (the reason DR-112 refuses a bot arm). Options: (a) pass `--match-head-commit <sha>` so a push after the arm blocks the merge **(rec)**, matching DR-112 section 1(c); cost: I believe, unverified, that `gh pr merge --auto` accepts this flag together (Clarify must confirm it), and a rebase on the base branch needs a re-arm; (b) accept and state it in the consent text, as the issue asks, cost: a later push by anyone with write access can land unreviewed within the required checks, which is the exact hazard DR-112 and DR-119 reject.
3. **Repo without auto-merge enabled.** The arm fails (FR-5). Options: (a) report and stop **(rec)**, cost: founder still arms by hand there; (b) fall back to a direct squash merge when checks are already green, cost: a new merge path that needs its own review under DR-112.
4. **Does DR-112 need an amendment?** DR-112 (section 1(c), lines 80-82, 202-204), DR-119 (lines 170, 269) and the approval-only self-merge record reject arming native auto-merge on actor-independent grounds (it stays armed across pushes), and DR-119 forbids auto-merge in the approval lane, where these status-transition PRs sit. The issue's claim that a founder-credential arm is outside that rejection is therefore not licensed. Options: (a) amend DR-112 section 2 and DR-119 to permit a founder-credential, head-pinned arm for status-transition PRs **(rec)**, cost: a human-approved edit to two accepted records; (b) drop the arm and instead keep the founder's second keystroke, cost: the multi-hour wait of the Problem section stays.
