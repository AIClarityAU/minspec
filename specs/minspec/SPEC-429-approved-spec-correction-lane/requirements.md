---
id: SPEC-429
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - same epic as SPEC-221; a sign-off must never be left attesting to text main no longer holds
aspects: [approval, gate-integrity, never-wrong, signpost, no-silent-gate, tier-0, offline]
relates_to: [SPEC-022, SPEC-221, SPEC-031, SPEC-050, DR-029, DR-034, DR-047, DR-069, DR-081, DR-111, "#1079", "#1072", "#898", "#1064", "#1022", "#700"]  # SPEC-022 deriveStatus/FR-4 · SPEC-221 reports a PR that strands an approval (this spec supplies the path that does not) · DR-047 review runs before human approval · DR-081 §5 record-vs-approvable boundary · DR-111 Alt-A-only self-merge
implements: none
implements_reason: >-
  Specify phase only. Owned files are decided at Plan. Expected surface, none claimed yet:
  scripts/approval-integrity.ts (FR-4), the approve command's commit path
  (packages/minspec/src/commands/approve.ts, packages/minspec/src/lib/approve-commit.ts) for
  FR-3/FR-5, and the two corrected spec bodies (SPEC-031, SPEC-022) as the acceptance run.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Correct an approved spec and re-approve it in one merge (Requirements)

> **SPECIFICATION ONLY.** Written by a Specify-only dispatch (DR-076/#1169). Nothing is built
> until a human answers **Decisions needed (Clarify)** and approves this spec.
>
> Materializes [#1079](https://github.com/AIClarityAU/minspec/issues/1079) (split out of #898
> after #1072's review). Rests on DR-047 (AI review runs before the human approval gate opens),
> DR-081 §5 (an approval PR may exempt the *record*, never the *approvable*), DR-034/DR-069
> (derived status) and DR-029 (editing an approved spec and re-approving it is the normal
> workflow). **No new decision record** under the recommended answers: every requirement below
> is a procedure plus small, reversible code changes. Choosing DQ-1 (b) would need DR-047
> amended (see DQ-1).

## One-Sentence Scope

A correction to an approved spec's body and its re-approval reach `main` in the same merge, with
AI review of the corrected text still happening before the human re-approves, so `main` never
holds a spec whose derived status contradicts its own frontmatter because of a correction.

## In plain terms

Fixing a wrong line in an approved spec currently makes things worse for a while. The edit
invalidates the approval, so the tools start calling the spec "specifying" while its frontmatter
still says "planning". That lasts until someone re-approves it, which today means a second pull
request after the first one merges. This spec closes that gap. The correction goes on a branch
and gets its normal AI review. You then re-approve it **on that same branch**, and the
correction and the approval merge together. `main` goes straight from "old text, approved" to
"new text, approved" without the gap in between.

## Problem (measured on this base, `8c9e9871`)

All read from code or files in this checkout, not inferred from spec prose.

1. **The stale window is real.** `deriveStatus`
   (`packages/minspec/src/lib/lifecycle.ts:133-146`) returns `specifying` for any spec whose
   approval is not `approved` (`:140`, INV-1). A hash-relevant body edit stales the approval
   (`specHash`, `packages/shared/src/canonical.ts`; only `status:`/`phases:` are stripped). So
   after a body correction lands on `main` without its re-approval, the derived status is
   `specifying` while the literal `status:` still says `planning`. Issue #1079 reports
   `npm run validate` exits 0 in that state (reported in the issue; not re-measured here).
2. **Both known corrections are still pending on this base.**
   - `specs/minspec/SPEC-031-reviewer-all-approvables/requirements.md:23` still reads
     *"Clarify complete — awaiting human Approve Spec before Plan"*. Its sidecar records approval
     on `2026-07-22T06:58:50Z`
     (`.minspec/approvals/specs/minspec/SPEC-031-reviewer-all-approvables/requirements.md.json`).
   - `specs/minspec/SPEC-022-approval-foundation/requirements.md:157-163` (the FR-4 table) has
     no `planning` row, but `deriveStatus` returns `planning` at `lifecycle.ts:145` (DR-069).
3. **Most of the mechanism already exists.** Approve commits the spec file **and** its sidecar in
   one pathspec commit (`packages/minspec/src/commands/approve.ts:401-407`). The commit is
   refused only on the default branch (`approve-commit.ts:245-247`, `protected-branch`). On any
   other branch `pushApproval` takes the `push-current` plan and pushes to that same branch
   (`packages/minspec/src/lib/approve-push.ts`, `decidePushPlan`). So Alt+A run with a correction
   branch checked out already adds the approval to that branch's pull request. Nothing names
   this as the way to land a correction, and three things work against it (items 4-6).
4. **The issue's option 1, "edit and approve in one commit", conflicts with an accepted DR.**
   DR-047 (decision text, "For human-gated types the review runs before the human approval gate
   opens") requires AI review of an approvable's content **before** the human approves it.
   Today, if the body edit is still uncommitted when Alt+A runs, the approve commit takes it in
   silently, because the pathspec includes the spec file (`approve.ts:405`). The human has then
   approved text no reviewer has seen. The re-run of ai-review after the push reviews it
   afterwards, which is the order DR-047 rules out.
5. **The written approval witness would refuse the combined PR.** `scripts/approval-integrity.ts:198-214`
   fails `approvable-unreviewed` whenever a PR that changes a sidecar also changes the
   approvable's canonical hash. That rule is correct for DR-081 §3 *record* PRs, which skip
   ai-review. Applied to a correction PR, which gets a full ai-review, it refuses exactly the
   shape this spec needs. A grep of `.github/workflows/` found no workflow that runs
   `approval-integrity`, so I believe it is not wired in today (unverified beyond that grep;
   the file's header says it is deliberately not yet required). The conflict is latent and
   becomes live the day it is wired in.
6. **DR-111's self-merge correctly declines a correction PR.** `alta-self-merge` merges only
   PRs whose spec diff is limited to `status:`/`phases:` (`.github/workflows/alta-self-merge.yml`
   header). A correction changes body bytes, so a human merges it. This is intended and stays.

**Root cause (mechanism plus missing piece).** Correcting and re-approving are two human acts.
The only documented route places a merge to `main` between them, and nothing in the tooling
names or supports the alternative: re-approving on the correction's own branch after its review.
Item 5 would also block that alternative once wired in. The validator's literal-vs-derived check
does not keep the stale state off `main` (issue #1079: exits 0).

## Functional Requirements

- **FR-1 The correction lane.** A hash-relevant edit to an approvable whose approval is current
  on the base lands as follows, and this is the only route MinSpec documents and supports for
  it:
  1. The edit is committed on a non-default branch and opened as a pull request (the *correction
     PR*).
  2. ai-review runs on the correction PR as on any content PR (DR-047, DR-081 §5). The
     approvable gets **no** exemption.
  3. After the correction PR shows `ai-review:pass`, a permitted human re-approves the
     approvable **on that PR's head**: Alt+A with the branch checked out (existing behaviour,
     Problem item 3), or any other approval ingress that writes the sidecar onto the same branch.
  4. The approval commit is pushed to the same branch, so it lands in the same pull request. No
     second PR is opened.
  5. The pull request merges with the body change and the refreshed sidecar together.
  `main` therefore never holds the corrected text under a stale approval.
- **FR-2 Same PR, never a second one.** When Approve runs on a non-default branch, it commits
  to that branch and pushes to it. It never creates a separate approval branch or PR for an
  approvable already changed on the current branch. Plan verifies the current `decidePushPlan`
  behaviour against this and adds a test that fixes it in place; it changes code only if the
  verification fails.
- **FR-3 The approval commit is hash-neutral.** The commit Approve creates must not change the
  approvable's canonical hash (`specHash`) relative to its parent, so the human approves exactly
  the text that was reviewed and committed. If the approvable has hash-relevant uncommitted
  changes when Approve runs, Approve does not fold them in silently. What it does instead is
  DQ-1.
- **FR-4 The approval witness tells a correction PR from a record PR.** `approval-integrity`'s
  `approvable-unreviewed` rule (DR-081 §5) applies to PRs that claim the DR-081 §3 record
  exemption. A correction PR does not claim it and is ai-reviewed. On a correction PR the witness
  still enforces hash-binding (the sidecar's `specHash` equals `specHash` of the approvable at
  head) and the approver checks, and it does not fail `approvable-unreviewed`. The way a PR is
  classified must be structural (from paths and hashes), never from its title (DR-081 §3). If
  classification cannot be determined, the witness fails closed and visibly (invariant 2).
  How a correction PR is told apart is DQ-2.
- **FR-5 The window on the branch is named, not silent.** Between the correction commit and the
  approval commit, Check Spec on the branch reports that the approvable's approval is stale and
  that re-approving on this branch before merge is the next step. The wording names the
  correction lane. Reports are advisory: this does **not** block editing an approved spec
  (DR-029).
- **FR-6 A correction PR merged without its re-approval is visible.** If a correction PR reaches
  merge without the approval commit, the PR is flagged as stranding the approval. SPEC-221
  owns that check; this spec depends on it and does not duplicate it. Whether that flag should
  also hold the merge is DQ-3.
- **FR-7 Land the two known corrections through the lane.** As the acceptance run, the SPEC-031
  body `**Status:**` line and the missing `planning` row in SPEC-022's FR-4 table are each
  corrected through FR-1. Each correction plus its re-approval lands in one merge. This spec
  does not make those edits; they belong to the implementing change.

## Invariants (must hold)

- **INV-1 Review before approval (DR-047).** No step in this spec lets a human approval attest
  to approvable text that the approvable's ai-review has not yet seen, unless DQ-1 (b) is chosen
  and DR-047 is amended first.
- **INV-2 Record ≠ approvable (DR-081 §5).** The ai-review exemption for approval-record PRs is
  not widened. A PR that changes approvable body bytes never self-exempts from ai-review.
- **INV-3 The hash is not weakened.** The canonicalization strip list (`status:`/`phases:`) is
  unchanged. Option 3 in #1079, stripping body `**Status:**` lines, is out of scope (#700's
  territory).
- **INV-4 Derived status stays authoritative (DR-034, SPEC-022 FR-4).** `deriveStatus` and its
  INV-1 rule (`lifecycle.ts:140`) are unchanged. The fix keeps stale states off `main`; it does
  not reinterpret them.
- **INV-5 Human approval stays human (DR-056, DR-012).** Only a permitted human identity, or a
  live delegation under DR-119, records the re-approval. Nothing here mints an approval on the
  human's behalf.
- **INV-6 No silent gate (constitution invariant 2).** Any witness changed by FR-4 fails closed
  and visibly on an unreadable input or an undetermined classification.
- **INV-7 Offline (constitution invariant 1).** The Tier-0 extension's part (FR-3, FR-5) makes
  no network call beyond the existing, consented approval push.
- **INV-8 Self-merge scope unchanged (DR-111).** `alta-self-merge` still declines any PR with
  body changes; a correction PR is merged by a human.

## Acceptance Criteria

- [ ] **AC-1 (FR-1, FR-2).** On a fixture repo: approve a spec on `main`, branch, change one body
  line, commit, then run Approve with the branch checked out. The branch gains exactly one
  commit, touching only the sidecar plus that spec's `status:`/`phases:` lines. The push goes to
  the same branch, and no new branch or PR is created.
- [ ] **AC-2 (FR-3).** With a hash-relevant uncommitted body edit present, Approve does not
  produce a commit that changes the approvable's `specHash` relative to its parent. The outcome
  matches the DQ-1 answer and is stated in the toast.
- [ ] **AC-3 (FR-3, mutation).** Reverting FR-3's guard makes AC-2's test fail. The test checks
  the resulting commit's hash delta, not message text.
- [ ] **AC-4 (FR-4).** `approval-integrity` on a correction-PR fixture (body change plus a
  sidecar whose `specHash` matches head) reports no `approvable-unreviewed` failure. On a
  record-PR fixture with the same body change it still fails `approvable-unreviewed`. A stale
  sidecar on the correction PR still fails `hash-binding`.
- [ ] **AC-5 (FR-4, INV-6).** An input that cannot be classified fails the witness with a
  visible reason, never a pass.
- [ ] **AC-6 (FR-5).** Check Spec on a branch where an approved spec has a hash-relevant change
  and no refreshed sidecar shows the correction-lane next step. Check Spec on `main` with a
  current approval does not.
- [ ] **AC-7 (FR-7).** After the acceptance run, on `main`: SPEC-031 has no body line saying it
  awaits approval, SPEC-022's FR-4 table has a `planning` row matching `lifecycle.ts`, and both
  specs derive to their literal `status:` with a current approval. No commit on `main` between
  the two states leaves either spec stale.
- [ ] **AC-8 (INV-2, INV-3, INV-8).** The ai-review exemption rule, the canonical strip list and
  `alta-self-merge`'s eligibility predicate show no diff in the implementing change.

## Out of scope

- Widening the canonical hash strip list (#1079 option 3; #700).
- Any ai-review exemption for a PR that changes approvable body bytes.
- Blocking edits to approved specs (DR-029). FR-6's merge hold, if chosen, holds only the merge
  of a PR that strands an approval. It does not block the edit.
- The strand/recovery path for approvals made on `main` (#1064, #1022, #1115). FR-1 avoids that
  path; it does not change it.
- Wiring `approval-integrity` into CI or the ruleset (DR-081's staged follow-up #1376). FR-4 only
  fixes the rule so the wiring cannot later refuse a correction PR.
- A one-command "correct and re-approve" affordance (#1079 option 2), unless DQ-4 chooses it.

## Decisions needed (Clarify)

- **DQ-1 What does Approve do when the approvable has hash-relevant uncommitted changes (FR-3)?**
  (a) **(rec)** Refuse. Explain that the change must be committed and reviewed first, and name
  the correction lane. Cost: one extra step, committing and pushing the edit, before the
  approval keystroke, and a wait for ai-review. That wait is the point of DR-047.
  (b) Fold the edit into the approval commit, as #1079 option 1 proposes. Cost: the human
  approves text no reviewer has seen, so DR-047's ordering must be amended (a new or amending
  DR). The re-run of ai-review after the push would review it only after approval.
  (c) Commit the edit and the approval as two separate commits in the same push. Cost: still
  approval before review (the same DR-047 conflict as b), with only cosmetic separation.
- **DQ-2 How does `approval-integrity` tell a correction PR from a record PR (FR-4)?**
  (a) **(rec)** By the approvable's canonical hash: unchanged base-to-head means a record PR and
  the existing rules apply; changed means a correction PR, which is ai-reviewed and does not
  get `approvable-unreviewed`. Cost: the witness now depends on the ai-review exemption (DR-081
  §3, not yet built) also using the same hash test. If the two were ever built with different
  predicates, a body-changing PR could be both exempt and unchecked. Plan must make them share
  one predicate, or the exemption must stay unbuilt.
  (b) Drop `approvable-unreviewed` and rely on ai-review alone. Cost: removes the only
  deterministic witness of DR-081 §5 and leaves it trusted to the exemption logic.
- **DQ-3 Does a correction PR without its re-approval get held from merge (FR-6)?**
  (a) **(rec)** Flag only, through SPEC-221's verdict. Cost: the founder can still merge it
  and reopen the stale window on `main`, but now with a visible statement that it does so.
  (b) Hold the merge (for example a `hold:` label or a `ready-to-merge` condition) until the
  sidecar matches. Cost: a new merge-gating surface. It also reads against SPEC-221's
  out-of-scope line and DR-029's "editing then re-approving is normal". It needs SPEC-221
  amended and probably a DR, and it blocks a legitimate "merge the correction, re-approve
  later" choice.
- **DQ-4 Is a dedicated "Correct and re-approve" command needed (#1079 option 2)?**
  (a) **(rec)** No. FR-1 with the existing Alt+A plus FR-5's guidance is enough for now. Cost:
  the founder must have the correction branch checked out to press Alt+A, which is awkward when
  he works from a `main` checkout.
  (b) Yes, a command that, from `main`, checks out (or creates a worktree for) the correction
  PR's branch, approves and pushes. Cost: a new command with worktree and branch side effects,
  and more surface to keep offline-safe and pathspec-safe.

## Test Plan

Unit tests on fixture repos under the existing approve-commit and approval-integrity suites:
AC-1 to AC-6. AC-3 is a mutation check on the FR-3 guard. AC-7 is checked on `main` after the
acceptance run, with the derived status computed by `deriveStatus`, not read from prose.

## Risks

- **Two predicates drift (DQ-2 a).** The integrity witness and a future ai-review exemption
  could classify a PR differently. Mitigation: one shared predicate, plus a test that runs both
  on the same fixtures.
- **Founder friction.** Approving on a branch means switching checkouts. If that proves costly,
  DQ-4 (b) is the fallback.
- **Push voids the verdict.** The approval push makes ai-review re-run on the combined head.
  Fine for correctness, but it costs one extra review run per correction. In this repo the
  founder merges every PR anyway (merge funnel), so the re-run adds latency, not a human step.

## Follow-ups (tracked)

- SPEC-221 — the stranding verdict FR-6 depends on.
- #1376 — wiring `approval-integrity` (DR-081 §4). FR-4 must land before or with it.
- #700 — canonical hash scope (option 3), deliberately not taken here.
