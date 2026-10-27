---
id: SPEC-232
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - concurrent multi-session coordination
aspects: [dispatch, auto-merge, shepherd, lease, no-silent-gate, observation-not-inference]
depends_on: []
relates_to: ["#2298", "#2300", "#2305", "#2132", "#2219", "#1708", "#2002", DR-061, DR-067, SPEC-044]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-232: The auto-merge gate reports "armed" only from an observed PR state, and a shepherd stand-down says which of its two causes fired

> **This is a SPECIFICATION ONLY.** Written for issue #2298 (https://github.com/AIClarityAU/minspec/issues/2298).
> Nothing is built until a human reads it, resolves
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

Two defects were filed together. One is still live; the other was mostly fixed after filing.

- **A (live).** After a PR is pushed, the dispatcher prints "Native auto-merge armed (DR-061) — not posting a HOLD; PR merges on ai-review:pass" whenever native auto-merge is *enabled for the project*. It never checks that auto-merge was *armed on this PR*. When the arm step WITHHELD or failed, the PR has no auto-merge request, the log line is false, and no hold comment is posted.
- **B (mostly fixed; residuals remain).** The claim-renew bug (`lease_renew` / `lease_release` used `.[][]` over unslurped `gh api --paginate` output, jq exit 5) was fixed by #2300 and its reporting by #2305. What remains is the second half of the issue's own ask: the stand-down message still says "reclaimed by another session" for the case where nobody reclaimed anything, and the fix was verified per unit, not by outcome.

## Verified state on current main (checked 2026-10-27, base `983e9107`)

- `scripts/dispatch-issue.sh:2713-2714` still prints "Native auto-merge armed (DR-061)" from `native_automerge_enabled` (policy only; function at `:220`). Not fixed.
- The arm step (`:1660-1745`) has outcomes armed, WITHHELD (4 reasons: enumeration failed, empty enumeration, autonomy verdict, unconfirmed `Closes` link) and could-not-arm. Each is an `echo`; none is carried to `:2713`.
- `lease_renew` now goes through `lease_read_claims` (`scripts/lib/issue-lease.sh`, comment above `lease_renew` cites #2298); `lease_release` reads via `lease_read_claims` too (`:353`). Fixed by #2300; tests in `packages/minspec/tests/issue-lease-renew-release.test.ts`.
- `scripts/dispatch-issue.sh:2132` still prints "Claim on #$ISSUE was reclaimed by another session" for every `stand-down`; `shepherd_decide` returns `stand-down` for any `holds != yes` (`scripts/lib/shepherd-pr.sh:68-70`), which does not distinguish "own claim expired" from "a live other owner".
- I believe, unverified, that no test executes the HOLD-suppression branch at `:2713` (the issue reports no match for the strings; not re-grepped here).

## Root cause (for A)

The HOLD-suppression premise ("if native auto-merge is armed on this PR") is decided from project policy, not from the PR. The arm step's outcome is not carried to the gate and the gate never reads the PR's `autoMergeRequest`. WITHHELD (#834) and could-not-arm arrived or stayed unhandled after the suppression (#782). Missing gate: nothing checks that the stated premise holds.

## Functional requirements

**FR-1. Observe, don't infer.** Before printing any "auto-merge armed" line or suppressing the hold, the gate reads the PR's real `autoMergeRequest`. Suppress the HOLD only when it is non-null.

**FR-2. Fail toward the hold.** If the read errors, times out, or returns unparsable output, the gate posts the hold (and prints that the state is unknown). It never suppresses on a failed read (invariant 2).

**FR-3. Honest reason.** When `autoMergeRequest` is null under native mode, the hold comment's reason is the arm outcome (which WITHHELD reason, or "arm failed"), carried from the arm step to the gate. It is not the existing `HOLD_WHY`, which would say "auto-merge off (mode=...)" and be false under native mode.

**FR-4. The WITHHELD reason reaches the PR.** A WITHHELD or could-not-arm outcome is visible on the PR (comment plus the existing `needs-human-review` label), not only in the drain log. The could-not-arm path, which today applies no label, gets a human signal.

**FR-5. No false merge promise.** The text "merges on ai-review:pass" is printed only when FR-1 observed an armed request.

**FR-6. Stand-down names its cause.** The shepherd's stand-down line distinguishes (i) own claim expired / no live owner (`classify_claim` = `claim`) from (ii) a live owner that is not this session. "Reclaimed by another session" is printed only for (ii).

**FR-7. Outcome-level lease verification.** One test exercises the outcome, not the unit: a claim with `claimedAt` 300 s old and `lastRenewed` 30 s old keeps `lease_verify_holds` true, with the claim on page 1 and on page 2 of paginated output (the page axis varied).

## Invariants (must not break)

1. Offline: no new network call beyond the single `gh pr view` read FR-1 adds to an already-networked dispatch (invariant 1).
2. No silent gate: a failed read posts the hold; no `|| true` on the read that decides suppression (invariant 2).
3. Blast radius: change is confined to the dispatcher's own PR handling; no behaviour change in a repo without `.minspec/` (invariant 3).
4. Native auto-merge policy gating (`native_automerge_enabled`) stays the arm step's guard and stays deny-by-default.
5. The `needs-human-skim` label and hold comment are not posted for a PR where auto-merge IS observed armed.

## Acceptance criteria

- AC-1 (regression, fails today): gate run under a fake `gh` with `MINSPEC_AUTOMERGE_NATIVE=1` and `gh pr view` answering `{"autoMergeRequest":null}`: output lacks `Native auto-merge armed`; a `gh pr comment` call is recorded.
- AC-2: `autoMergeRequest` non-null: output has the armed line, no `gh pr comment`, no `needs-human-skim`.
- AC-3: `gh pr view` exits non-zero: hold comment posted, output says state unknown.
- AC-4: each arm outcome (WITHHELD x4, could-not-arm) yields a hold comment naming that outcome's reason.
- AC-5: a wiring check proves the gate calls the decision seam (not only that the seam is correct). If the harness is too heavy, a pure seam in the style of `--check-native-automerge` (`:236-240`): `native:on` + `autoMergeRequest:null` yields `post-hold`.
- AC-6: stand-down message differs for own-claim-expired vs foreign live owner.
- AC-7: FR-7 outcome test passes for 1-page and 2-page claim output.

## Decisions needed (Clarify)

**D1. How does the gate learn the arm outcome (FR-3)?**
- (a) Read `autoMergeRequest` for the yes/no, and carry the arm step's `hold_why` via a variable **(rec)**: observation decides, the variable only supplies the reason text. Cost: the reason is still an inference about our own write; if the two disagree the comment may name the wrong reason (mitigate: print both).
- (b) Variable only, no read. Cost: repeats the defect, an inference about our write rather than an observation of the PR.
- (c) Read only, and a generic reason. Cost: the founder loses the WITHHELD reason on the PR, which is what FR-4 exists for.

**D2. Stand-down split (FR-6): where?**
- (a) Add a distinct `shepherd_decide` token (`stand-down-expired` vs `stand-down-foreign`) **(rec)**: testable in the existing `shepherd-decide` suite. Cost: callers matching on `stand-down` must be audited and updated.
- (b) Keep one token; compute the wording at the call site from `classify_claim`. Cost: the distinction is untested by the pure decider.

**D3. Should an expired own claim stand the shepherd down at all?**
- (a) Keep: stand down (status quo, D3/INV-5 re-verify before credentialed steps) **(rec)**. Cost: a long-but-live build still loses the shepherd if renewal genuinely fails; the renew-failure log (#2305) is the only witness.
- (b) Re-claim once if no other claim exists. Cost: new write path in a lease protocol, wider diff and more risk; widens scope beyond this issue.

## Out of scope

- Drain PR-sweep starvation (#1708).
- `claim_applied_at` per-page reduce in `drain-inbox.sh` (#2002).
- Errored classifier becoming skip-clean (#1729 / #2249).
- The renew filter itself (fixed, #2300).

## Follow-ups (tracked)

- #1708 drain PR sweep starved (the fallback that would pick up withheld PRs).
- #2002 same `--paginate` + jq hazard in `drain-inbox.sh`.
