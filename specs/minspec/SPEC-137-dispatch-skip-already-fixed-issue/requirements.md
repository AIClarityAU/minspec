---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — dispatching an issue that already has a fix wastes an agent run and leaves a conflicting duplicate PR
relates_to: [SPEC-044, SPEC-073, DR-066, DR-076, "#726", "#705", "#707", "#708", "#359", "#397", "#409", "#410"]
implements: [scripts/dispatch-issue.sh, scripts/lib/issue-lease.sh]
---

# MinSpec — Dispatch skips an issue that already has an open or merged fix (Requirements)

> Materializes **[#726](https://github.com/AIClarityAU/minspec/issues/726)**. No DR is minted:
> every choice below is a same-day-reversible change to dispatch scripts (DR-359 ADR filter).
> Rests on SPEC-044 (check-then-claim lease) and DR-066 (no silent gate).

## One-Sentence Scope

Before `scripts/dispatch-issue.sh` builds a worktree, and again before it publishes a PR, it
must refuse (visibly, as a declined dispatch) any issue that already has an OPEN pull request
referencing it or a MERGED pull request that closes it — so a second equivalent fix (#708
for already-fixed #705) is never produced.

## Context (grounded)

- #705 was fixed by PR #707 (merged); the dispatcher also produced PR #708 (`agent/issue-705`),
  an equivalent duplicate that went CONFLICTING and needed manual triage.
- **Already covered by SPEC-044 (do not redo):** the closed-issue and shipped-marker refusal
  (`lease_gate_open_unshipped`, `scripts/lib/issue-lease.sh:199`, called at
  `scripts/dispatch-issue.sh` before `lease_acquire`), the same-host per-item `flock`
  (`lease_flock`), and the soft claim re-read-to-exhaustion (`lease_acquire`). Concurrent
  dispatches of one issue therefore already no-op via the claim; the issue's third bullet
  ("make the claim atomic enough") is satisfied by SPEC-044 FR-1/FR-3b/FR-11 and is out of scope
  here, apart from verifying it still holds (AC-5).
- **The gap (my reading of the code, to be re-verified in Plan):** `lease_gate_open_unshipped`
  reads only the issue's own `state` and a `minspec-shipped` comment marker. Nothing looks at
  pull requests. An issue that is still OPEN while a human- or agent-authored PR from a
  *different head branch* (`fix/705-invariant-mirror`) is open or merged-but-not-yet-closing is
  not refused. SPEC-044 FR-3's one-PR-per-head CAS only collapses PRs with the *same* head
  (`agent/issue-N`), so it cannot catch #707-vs-#708.
- **Window 2:** a fix can land *while the agent runs* (the issue says "a human fix landing as
  #707 while the agent worked"). A claim-time check alone cannot see it; the publish step can.

## Functional Requirements

- **FR-1 (open-PR gate at claim time).** After the existing open/unshipped gate and before
  `lease_acquire` / worktree creation, dispatch queries pull requests that reference the issue.
  If any OPEN PR other than one whose head is this dispatcher's own `agent/issue-N` references
  it, dispatch declines (`exit_declined`, nothing started) and says which PR.
- **FR-2 (merged-fix gate).** If a MERGED PR closes or references the issue (closing keyword or
  `closingIssuesReferences`) and the issue is still OPEN, dispatch declines the same way and
  names the PR — the case where merge has not yet closed the issue or the close was reverted.
- **FR-3 (what counts as "references").** Defined by one pure, unit-testable classifier taking
  the issue number and a PR list (number, state, headRefName, body, closingIssuesReferences)
  and returning `proceed` | `decline:<pr>`. A PR references the issue if its
  `closingIssuesReferences` contains N, or its body carries `Closes|Fixes|Resolves #N`, or its
  head branch matches `(^|/)issue-N($|[^0-9])` or `(^|/)N-`. A bare `#N` mention in prose does
  NOT count (a PR that merely cites the issue is not a fix).
- **FR-4 (fail closed and visibly).** If the PR enumeration errors, is truncated, or returns
  unparseable output, dispatch declines with the reason on stderr and in the drain log — it
  never proceeds as if no PR existed and never swallows the error (constitution invariant 2).
- **FR-5 (publish-time recheck).** After the agent exits and before `git push` / `gh pr create`,
  run the FR-1/FR-2 check again. If a referencing PR now exists, publish nothing, retain the
  branch locally, and post a comment on the issue naming the PR and the branch. This reuses the
  "publish nothing, say so" shape of SPEC-073.
- **FR-6 (human override).** A `MINSPEC_ALLOW_DUP_PR=1` environment switch (and nothing an
  issue author can set from the issue body or labels) bypasses FR-1/FR-2, because a human may
  deliberately want a competing fix. The bypass is logged when used.
- **FR-7 (labels are not the authority).** The gate decision never reads `agent-running` /
  `agent-done` (DR-066: cosmetic mirrors).
- **FR-8 (declined is not a dispatch).** A decline here uses the same `exit_declined` path as
  the other stand-downs (#2641) so it does not consume a drain slot or recur-count as work.

## Acceptance Criteria

- **AC-1.** Fixture: issue N OPEN, an OPEN PR with head `fix/N-slug` and `Closes #N` → classifier
  returns `decline:<pr>`; dispatch exits declined before any worktree exists.
- **AC-2.** Fixture: issue N OPEN, a MERGED PR with `closingIssuesReferences=[N]` → decline.
- **AC-3.** Fixture: only a PR that mentions `#N` in prose, or a CLOSED-unmerged PR → `proceed`.
- **AC-4.** Fixture: the dispatcher's own OPEN `agent/issue-N` PR (a retry/escalation) → `proceed`.
- **AC-5.** Regression: closed issue and shipped-marker refusals, and the second-concurrent-claim
  stand-down, behave as before.
- **AC-6.** `gh pr list` failing (non-zero exit), returning invalid JSON, or hitting the page
  cap → decline with a visible reason; never proceed.
- **AC-7.** Publish-time: a referencing PR appearing between claim and publish → no push, no PR,
  a comment on the issue.
- **AC-8.** With `MINSPEC_ALLOW_DUP_PR=1` the FR-1/FR-2 gate is skipped and logs that it was.

## Invariants (must not break)

- Constitution 1 (offline core): the check lives in dev-time dispatch scripts, never in the
  shipped extension; no new network path in `packages/`.
- Constitution 2 (no silent gate): FR-4 — an erroring witness declines, visibly.
- Constitution 3 (blast radius): scripts run only where dispatch is used; nothing ships to adopters.
- SPEC-044 INV-1/INV-6: the soft claim stays advisory; hard layers are unchanged.

## Decisions needed (Clarify)

1. **Open-PR match breadth.** (a) *Strict (rec)* — closing refs, closing keywords, or branch
   pattern only (FR-3). Cost: a duplicate fix whose PR cites the issue only loosely (e.g.
   "see #N") is missed. (b) *Broad* — any PR whose body mentions `#N`. Cost: false declines on
   PRs that merely reference the issue, which silently starve legitimate dispatches.
2. **Decline vs hold-for-human.** The issue says "skip (or hold for human)". (a) *Decline with
   an issue comment (rec)* — cheap, reversible by `MINSPEC_ALLOW_DUP_PR=1`. Cost: a human who
   wanted the second fix must notice the comment. (b) *Add `needs-human-review` label too* —
   more visible; cost: adds a label producer and a way for the queue to stall on stale PRs.
3. **Publish-time recheck (FR-5) in scope?** (a) *Yes (rec)* — it is the only check that closes
   the "fix landed while the agent worked" window. Cost: a second `gh` call per publish and
   the agent's work is discarded when it trips. (b) *Claim-time only* — simpler; cost: the
   #707/#708 race as described in the issue can still recur.
4. **Merged-but-issue-open (FR-2) policy.** (a) *Decline (rec)* — assumes the merge fixed it.
   Cost: a merged *partial* fix that deliberately left the issue open is never re-dispatched
   without the override. (b) *Decline only if the PR carries a closing reference.* Cost: misses
   fixes that merged without a closing keyword.
