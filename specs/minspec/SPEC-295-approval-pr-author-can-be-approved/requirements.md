---
id: SPEC-295
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - same epic as DR-082 (bot identity) and DR-050 (consented gh)
aspects: [approval, approval-pr, identity, rulesets, attribution, fail-closed, offline, blast-radius]
depends_on: []
relates_to: ["#2995", "#995", "#1355", "#2243", "SPEC-050", "SPEC-039", "#2978", "DR-050", "DR-074", "DR-082", "DR-098", "DR-108"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decisions
  D1-D4. Expected surface is listed under "Measured state", none of it claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-295: An approval pull request is opened by an identity the target repo lets the founder approve

> **This is a SPECIFICATION ONLY.** Written for issue
> [#2995](https://github.com/AIClarityAU/minspec/issues/2995). Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.
>
> Design rests on: **DR-050** (shelling the user's own `gh` on consent; its Amendment
> 2026-07-01 makes a read of the repo's own rulesets autonomous), **DR-082** (agent GitHub
> writes take the bot identity through a fail-closed wrapper; *dev-time only, nothing ships in
> the extension*), **DR-074** (blast radius), **DR-108** (bot acts under its own name, never
> the founder's).

## In plain terms

When the founder accepts a decision record or approves a spec in the editor, MinSpec commits,
pushes the approval branch and opens a pull request with the founder's own `gh` login. In a
repo whose ruleset requires an approving review from someone other than the PR author, and
which grants no bypass, that PR can never merge: GitHub does not let an author approve their
own PR. Seen 2026-10-21 on memory-fabric (PR 64, DR-001 acceptance), closed and re-opened as
bot PR 67 with the same commit (per the issue; not re-verified here).

## Measured state (this base, 118548be)

Line numbers rot; Plan re-reads them.

- The approval flow's only PR-opening path is `openPullRequest`
  (`packages/minspec/src/lib/approval-pr.ts:830`), called from
  `packages/minspec/src/commands/commit-on-approve.ts:843` (approval flow) and
  `packages/minspec/src/commands/push-docs-lane.ts:370` (SPEC-039 docs lane). It runs
  `gh pr create` (`approval-pr.ts:873`) under whatever identity the ambient `gh` holds. Its
  header (`approval-pr.ts:39-41`) states the act is "performed by the USER's own authenticated
  CLI" by design.
- `grep -rn "required_approving_review_count\|require_last_push_approval" packages scripts`
  (non-test) returns nothing. The only ruleset reader in the extension,
  `packages/minspec/src/lib/ruleset-advisor.ts`, reads required **status checks**; it mentions
  `bypass_actors` only to carry it through a PUT (`:656`, `:900`). Nothing reads the
  pull-request review rule, so nothing compares the PR author with it. This confirms the
  issue's stated root cause on this base.
- DR-082 Consequences: "Dev-time only. Nothing here ships in the extension (DR-074 blast
  radius, invariant 3)." The App private key and the installation-token broker live outside
  the extension.

## Root cause (mechanism)

PR authorship is inherited from the ambient `gh` login with no check against the target
repo's review rule. The missing gate: the flow never reads `pull_request` rule parameters
(`required_approving_review_count`, `require_last_push_approval`) or the bypass list before
choosing who opens the PR, so an unmergeable-by-construction PR is opened silently and only
discovered when merge is refused.

## Scope note: the push stays the founder's

The founder's accept/approve click is a human act. Its commit and its consented push may
correctly carry the founder's identity (DR-082 decision 6 makes the same call for
`approve-issue.sh`). What changes is only **who opens the PR** (and, where the ruleset
demands it, who makes the last push). This spec does not turn the founder's act into an
agent act, and does not let any identity approve on the founder's behalf.

## Functional requirements

- **FR-1 Read the review rule before opening.** Before `gh pr create`, the approval flow reads
  the rules that apply to the PR's base branch (`gh api repos/{owner}/{repo}/rules/branches/{base}`,
  the same autonomous read-only class DR-050 Amendment 2026-07-01 already authorises) and
  derives: required approving review count, `require_last_push_approval`, and whether the
  current `gh` identity can bypass. The read is a pure classifier over the JSON plus one
  `gh` call through the existing `ExecRun` seam, so it is unit-testable offline.
- **FR-2 Classify self-approvability.** Result is exactly one of: `self-mergeable` (count 0,
  or the current identity can bypass), `needs-other-author` (count at least 1, no bypass
  for the current identity), `needs-other-pusher` (as previous, plus
  `require_last_push_approval`), or `unknown` (read failed, 403/404, offline, unparseable).
  Bypass that cannot be confirmed for the current identity counts as no bypass.
- **FR-3 `self-mergeable` is unchanged.** The flow opens the PR exactly as today, including
  SPEC-050 FR-6 adoption and #2243 label provisioning. No new prompt, no new network call
  beyond FR-1's read.
- **FR-4 `needs-other-author` never opens a founder-authored PR.** The flow does not run
  `gh pr create` under the founder's identity. It routes the already-pushed branch to the
  non-founder opener chosen in D1, and the toast states plainly: branch pushed, PR will be
  opened by `<opener>` because this repo requires a reviewer other than the author.
- **FR-5 `needs-other-pusher`.** As FR-4, and the hand-off states that the last push must
  also come from the other identity; an opener that cannot push (D1 option) refuses
  visibly rather than opening a PR the founder still cannot approve.
- **FR-6 `unknown` is visible, never silent** (constitution invariant 2). Behaviour per D2;
  whichever is chosen, the toast and PR body say the review rule could not be read and why.
- **FR-7 Hand-off is narrow** (applies if D1 picks a hand-off). A non-founder opener acts
  only on a branch that (a) matches the approval branch pattern minted by
  `approvalBranchName` (`packages/minspec/src/lib/approve-push.ts`), (b) whose diff against
  its base contains only approval-corpus paths (the approvable and its sidecar, the same
  predicate `laneLabelsFor` uses), and (c) whose head SHA equals the SHA the editor
  recorded. Any mismatch refuses visibly. This prevents the bot identity from becoming a way
  to launder an arbitrary founder-pushed branch into a bot-authored PR.
- **FR-8 Attribution in the body.** A PR opened by the non-founder opener says in its body
  that the approval act and push were the founder's (name the `approvedBy` from the record,
  read from the head commit, never retyped) and that the opener only opened the PR.
- **FR-9 No credential enters the extension.** No App private key, installation token, or
  token-minting code is added to `packages/minspec` or any shipped artifact, unless D1(b) is
  chosen, in which case a DR superseding DR-082's "dev-time only" consequence is a
  precondition of Plan.
- **FR-10 No fallback to the founder.** If the non-founder opener fails (missing key, broker
  down, mint failure), the flow does not fall back to opening the PR as the founder. The
  branch stays pushed, the failure is reported with its cause, and a retry path is named
  (DR-082 decision 3: falling back to ambient auth *is* the bug).

## Acceptance criteria

- **AC-1 (FR-1, FR-2)** Fixture rule JSON for each class (count 0; count 1 no bypass; count 1
  with `require_last_push_approval`; count 1 with a bypass actor matching the identity;
  count 1 with a bypass actor that cannot be matched) classifies as expected. A malformed
  body, a 403 and a network error each classify `unknown`.
- **AC-2 (FR-3)** With a `self-mergeable` stub, the argv passed to `gh pr create` is
  byte-identical to today's (existing `approval-pr` tests stay green unedited).
- **AC-3 (FR-4)** With a `needs-other-author` stub, the stub runner records zero
  `gh pr create` calls under the ambient identity, and the toast names the opener.
- **AC-4 (FR-7)** The opener refuses each of: a non-approval branch name, a branch whose diff
  includes a non-corpus path, a head SHA mismatch. A control branch meeting all three opens.
- **AC-5 (FR-10)** With the opener's credential absent, no PR is opened under any identity
  and the failure is visible; a test asserting "no `gh pr create` at all" fails if a
  fallback is added.
- **AC-6 (FR-9)** `tests/invariants.test.ts`'s child-process and network allowlists are
  unchanged by this spec's extension changes unless D1(b) is accepted; a grep of the built
  `.vsix` for the App id / key file name returns nothing.
- **AC-7 Mutation** Deleting the `needs-other-author` branch of the classifier (so it falls
  to `self-mergeable`) turns AC-3 red.
- **AC-8 Regression replay** The memory-fabric case (count 1, no bypass, founder identity)
  reproduces PR 64's shape on the pre-change code in a test and the new outcome after.

## Invariants this must not break

1. **Offline core (invariant 1).** The only new network act is FR-1's read-only rules GET,
   reached only inside the already-consented push-and-open step. No new socket.
2. **No silent gate (invariant 2).** `unknown`, opener failure and hand-off refusal are each
   visible; none passes as success; no founder fallback.
3. **Blast radius (invariant 3, DR-074).** The bot opener acts only in repos with `.minspec/`
   at the root and where the dev-time runner is installed; an adopter's editor never
   reaches the AIClarity App.
4. **No borrowed identity (DR-108).** The bot never approves, and never records an approval;
   the founder's review stays the merge gate. The record's `approvedBy` is unchanged.
5. **One `gh pr create`** (SPEC-050 FR-4). Any opener the extension invokes reuses
   `openPullRequest`; a runner-side opener is outside the extension and is the one documented
   exception.
6. **Approval never lost** (SPEC-050 INV-5). Whatever the class, the commit and push already
   done are kept and reported.

## Decisions needed (Clarify)

- **D1 Who opens the PR when the founder cannot be its author.**
  - (a) **(rec)** The extension pushes and stops; the dev-time runner (already holding the
    bot identity via DR-082's wrapper) opens the PR for branches that pass FR-7. The
    extension writes nothing secret, only the branch, base and head SHA to a local hand-off
    file under `.minspec/` (Plan picks the path). Cost: PR opening depends on the runner being
    alive, so it is slower and, in an adopter repo without the runner, the founder gets a
    message and must open the PR from another account himself.
  - (b) The extension mints an installation token itself. Cost: puts an App private key or a
    token broker into a Tier-0 shipped extension, reverses DR-082's "dev-time only"
    consequence, needs a superseding DR and a keychain-only storage design; largest attack
    surface.
  - (c) Founder opens the PR as today and the bot leaves an approving review. Rejected
    recommendation: any founder-authored PR gains a bot rubber stamp, which defeats the
    ruleset's purpose and conflicts with DR-108 (no approval on the founder's behalf).
  - (d) Ask the founder to add a bypass or lower the count on each such repo. Cost: weakens
    the repo's protection and is a per-repo manual step; MinSpec cannot do it for him.
- **D2 `unknown` behaviour.** (a) **(rec)** Open as the founder (today's behaviour) with a
  visible warning in the toast and PR body that the review rule could not be read. Cost: a
  failed probe on memory-fabric reproduces PR 64 once more, but visibly. (b) Fail closed:
  push only, open nothing, until the rule can be read. Cost: an offline or 403 probe leaves a
  pushed branch with no PR on every repo, including ones that would have merged fine.
- **D3 `require_last_push_approval`.** Whether the bot opener also re-pushes (needs a new
  commit, since re-pushing the same SHA is not a new push; this changes the head SHA the
  founder approved and so must preserve the approved bytes exactly). (a) **(rec)** Refuse
  visibly and tell the founder the repo needs a non-founder pusher; cost: that repo class
  stays manual. (b) Bot makes an empty commit on top; cost: adds a non-founder commit to
  every approval branch and complicates the hash-to-commit binding. The issue does not say
  whether memory-fabric sets this flag (unverified).
- **D4 Scope of callers.** Whether `push-docs-lane.ts` (SPEC-039) also gets FR-1 to FR-10.
  (a) **(rec)** Yes, both callers of `openPullRequest`; cost: SPEC-039's preflight ordering
  (`approval-pr.ts:816-824`) must be kept, so the probe runs before its worktree mutation.
  (b) Approval flow only; cost: docs-lane PRs on such repos keep the defect.

## Out of scope

- Changing how the founder's push is authenticated.
- Rewriting the memory-fabric ruleset.
- Delegated (bot-performed) approvals; covered by DR-108 and the in-flight #2978 spec.

## Follow-ups (tracked)

- None beyond this spec until D1 is resolved; if D1(b) is chosen, a superseding DR for
  DR-082's dev-time-only consequence is a Plan precondition (FR-9).
