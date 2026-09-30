---
id: SPEC-080
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — `agent-running` with no agent running is the pipeline's own signpost lying, same family as SPEC-073/SPEC-066
aspects: [agent-dispatch, labeling, no-silent-gate, worktree, tier-0]
relates_to: [DR-066, SPEC-044, SPEC-057, SPEC-073, SPEC-074, DR-076]
implements: [packages/minspec/tests/dispatch-abort-label-unwind.test.ts]  # NEW — the T3 regression test this spec owns
affects: [scripts/dispatch-issue.sh]  # OWNED by SPEC-044 via its own `implements:`; this spec modifies the pre-worktree abort path, never takes over the file
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-080: An abort before the worktree exists must never leave `agent-running` standing (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch
> that produced it. A human reads this spec, resolves the
> **[Decisions needed (Clarify)](#decisions-needed-clarify)** section, and approves it
> through the normal spec-approval gate before anything is built.

Materializes **[#1652](https://github.com/AIClarityAU/minspec/issues/1652)** — *"a failed
worktree provision strands the issue at `agent-running` with `agent-ready` removed, so
nothing ever retries it."* Named by **[#1674](https://github.com/AIClarityAU/minspec/issues/1674)**
as one of "three ways an issue leaves the pipeline in a state its labels misdescribe",
alongside its siblings **[#1656](https://github.com/AIClarityAU/minspec/issues/1656)**
(→ [SPEC-074](../SPEC-074-dispatch-quota-classification/requirements.md)) and #1674 itself
(→ [SPEC-073](../SPEC-073-dispatch-completion-requires-commit/requirements.md)). Each
sibling is its own dispatch; this spec covers #1652 only.

## One-Sentence Scope

Make the interval between `scripts/dispatch-issue.sh` marking an issue `agent-running`
(current: `:669-672`) and the worktree actually existing (current: `git worktree add`
`:703`) abort-safe, so that any failure in between — today, specifically a leftover
`agent/issue-N` branch from a prior killed run — restores `agent-ready` (and
`agent-ready-specify`, if that was the label removed) and clears `agent-running`, instead
of leaving the issue labelled busy with no agent, no worktree, and no branch, invisible to
both the drain (which enumerates `agent-ready`) and a human reading the board (who sees
"busy").

## Context (grounded, with `file:line` evidence)

- **Current line numbers, re-measured against this checkout** (the issue body's own
  citations — `:534`, `:565`, `:508` — are from an earlier revision of the file; `git log
  --oneline -- scripts/dispatch-issue.sh | wc -l` shows extensive churn since, most
  recently SPEC-074's quota-classification work). The mechanism the issue describes is
  unchanged; only the line numbers moved:
  - Label edit: [`gh issue edit … --remove-label "agent-ready" --remove-label
    "agent-ready-specify" --add-label "agent-running"`](../../../scripts/dispatch-issue.sh#L669-L672).
  - Worktree creation: [`git worktree add -b "$BRANCH" "$WORKTREE"
    origin/main`](../../../scripts/dispatch-issue.sh#L703).
  - The EXIT trap: [`trap 'lease_stop_renew_ticker; lease_release_all >/dev/null 2>&1 ||
    true' EXIT`](../../../scripts/dispatch-issue.sh#L646), installed only inside the
    `MINSPEC_CLAIM_OFF != 1` branch, i.e. on every normal (non-kill-switch) run.
  - `set -euo pipefail` ([`:18`](../../../scripts/dispatch-issue.sh#L18)) means any
    non-zero exit between `:672` and `:703` — `gh label create`, `gh issue edit` itself
    (both already `|| true`-guarded and so cannot trigger this), `git fetch origin main -q`
    (`:695`, unguarded), or `git worktree add` (`:703`, unguarded) — aborts the script at
    that point and runs only the EXIT trap.
- **The branch name is repo-global, not per-session; the worktree path is not.**
  [`lease_worktree_path`](../../../scripts/dispatch-issue.sh#L672) (called at `:672`,
  used to compute `$WORKTREE`) returns a claim-unique path
  (`${BASE}/issue-N-<sessionId>`, per SPEC-044 D11/INV-7) specifically so two same-host
  racers never collide on a directory. `BRANCH="agent/issue-${ISSUE}"`
  ([`:614`](../../../scripts/dispatch-issue.sh#L614)) carries no such session suffix — it
  is the same ref for every dispatch of the same issue, forever. The existing pre-`git
  worktree add` cleanup at [`:673-677`](../../../scripts/dispatch-issue.sh#L673-L677)
  (`if [[ -d "$WORKTREE" ]]; then … git branch -D "$BRANCH" …`) only fires when *this
  session's own* worktree directory already exists — it does not, and structurally
  cannot, catch a same-named branch left over by a *different* session's worktree path
  that no longer exists on disk. That is exactly #1544's observed second hit: `ls -d
  …issue-1544-*` found nothing, `git branch --list agent/issue-1544` would have found the
  leftover ref, and `git worktree add -b agent/issue-1544 …` failed with "a branch named
  … already exists" before reaching that ref.
- **The EXIT trap only unwinds the lease.** `lease_stop_renew_ticker; lease_release_all`
  is the correct and sufficient unwind for the *authority* (SPEC-044's flock + claim
  record). It has no label-editing code in it and none is expected to be added to it
  generically, since the trap fires on every exit path, including the many *successful*
  ones that set their own final label further down the file
  ([`:1172`](../../../scripts/dispatch-issue.sh#L1172),
  [`:1208`](../../../scripts/dispatch-issue.sh#L1208),
  [`:1583`](../../../scripts/dispatch-issue.sh#L1583),
  [`:1619`](../../../scripts/dispatch-issue.sh#L1619),
  [`:2008`](../../../scripts/dispatch-issue.sh#L2008),
  [`:2041`](../../../scripts/dispatch-issue.sh#L2041)) — an EXIT trap that unconditionally
  rewrote labels would race or double-write those.
- **This repo's own comment already states the intended relationship, unimplemented for
  this path.** [`:614`](../../../scripts/dispatch-issue.sh#L614): "DR-066: the
  agent-running label is a cosmetic mirror, never the authority." The lease (authority)
  unwinds correctly here; the label (mirror) does not, which is precisely the state DR-066
  says must not happen — a mirror asserting something the authority denies.
- **Self-perpetuating precondition.** A run killed between `git worktree add` succeeding
  and the dispatch completing leaves `agent/issue-N` behind with no live worktree
  referencing it (the worktree dir itself may also be gone, e.g. via `/tmp` cleanup, a
  manual `rm -rf`, or a later `git worktree prune`). The next dispatch of that same issue
  then hits this exact `:703` failure — how #1544 hit it twice in one session per the
  issue's own report.
- **No existing spec covers this state.** SPEC-057 detects a *protected* branch (`main`)
  sitting ahead of its pushed upstream on the *primary* checkout — a different branch, a
  different failure shape, and it is a detection/advisory feature, not a dispatcher abort
  path. SPEC-073 covers the *opposite* end of the same file (a dispatch that reaches
  completion having produced zero commits); SPEC-074 covers the crash-classification
  branch (`claude -p` dying mid-build). Neither touches the pre-worktree window this spec
  covers.

**Core gap (one sentence):** between `agent-running` going on and the worktree actually
existing, an abort leaves the mirror (`agent-running`) standing while the drain's own
enumeration key (`agent-ready`) has already been stripped, so the issue is invisible to
both the automated retry path and a label-reading human until someone notices by hand.

## Functional Requirements

- **FR-1 (label edit moves after the worktree exists).** Reorder so `gh issue edit …
  --add-label "agent-running"` (and the paired `--remove-label` calls) runs only once
  `git worktree add` (`:703`) has returned success — i.e. once a real worktree and branch
  exist for this dispatch. A script that aborts anywhere before that point never applies
  `agent-running` and never removes `agent-ready`/`agent-ready-specify` in the first
  place, so there is nothing to unwind. This is Option 1 from the issue body, and per its
  own framing ("cheapest and most direct") is this spec's primary mechanism.
- **FR-2 (belt-and-braces EXIT-trap restoration, independent of FR-1).** Regardless of
  where the label edit ends up sitting, extend the existing EXIT trap
  (`:646`) so that if the script exits (any cause: `set -e` abort, signal, explicit
  early `exit` other than the standing-down `exit 0`s at `:623`/`:627`/`:631`, which never
  reach the label edit at all) **before** a script-level "worktree confirmed to exist"
  marker is set, it removes `agent-running` and restores whichever ready label(s) it
  removed, recorded at removal time. FR-1 and FR-2 are deliberately not either/or: FR-1
  removes the common trigger (a same-day-reversible reorder), FR-2 is the independent
  second witness constitution invariant #2 asks for — a future edit that reintroduces an
  early label write, or a new failure mode this spec's authors did not enumerate, still
  unwinds correctly under FR-2 alone.
- **FR-3 (stale-branch tolerance, from the issue's Option 3).** Before `git worktree add`,
  if `agent/issue-${ISSUE}` already exists as a local ref, check `git rev-list --count
  origin/main..agent/issue-${ISSUE}`:
  - `0` (no commits ahead of `origin/main`) ⇒ it is leftover scaffolding from a run that
    never produced work; delete it (`git branch -D`) and proceed with a fresh `git
    worktree add -b`.
  - nonzero ⇒ **do not delete it.** That is unlanded work sitting on a branch with no
    open PR (or an already-superseded one) referencing it. Fail loudly — the same
    "stand down / surface to a human" shape already used elsewhere in this file
    (`:623-631`), not a silent skip and not a silent overwrite.
  This removes the *most common trigger* named in the issue (a stale empty branch from a
  previously killed run) without ever discarding real, unpushed commits.
- **FR-4 (which ready label(s) to restore is exact, not a guess).** The removal at
  `:670-671` unconditionally attempts both `agent-ready` and `agent-ready-specify`
  (`gh issue edit --remove-label` on a label the issue never wore is a harmless no-op per
  the existing comment at `:665-667`). Restoration must not therefore blindly re-add both
  — that would hand a T1/T2 issue an incorrect `agent-ready-specify`, or vice versa.
  Read which one(s) the issue actually carried **before** removing them (a `gh issue view
  --json labels` immediately preceding the edit, or reuse of whatever the caller already
  resolved earlier in the file — see Decisions needed, DQ-1) and restore exactly that set
  on the abort path.

## Invariants

- **INV-1 (DR-066 — label is a mirror, never the authority).** This spec changes *when*
  and *whether* the mirror is written; it never makes the label load-bearing for any
  ownership decision. The flock (`lease_flock`) and claim record remain the sole
  authority, unchanged by this spec.
- **INV-2 (constitution #2 — no silent gate / independent second witness).** FR-1 alone
  (reorder) is a single producer — a future refactor could reintroduce an early write and
  silently regress. FR-2 (trap-level restoration) is required, not optional, specifically
  so the property holds even if FR-1's ordering is later violated by an unrelated change.
- **INV-3 (never deletes unlanded work — the issue's own Option 3 caveat).** FR-3's
  branch reuse is gated strictly on `rev-list --count origin/main..<branch>` being
  exactly `0`. Any nonzero count fails loudly; nothing under this spec ever runs `git
  branch -D` or `--force` against a branch carrying commits `origin/main` does not have.
- **INV-4 (successful-completion label paths are untouched).** Every existing
  `--remove-label "agent-running"` call on a genuine completion/escalation path
  (`:1172`, `:1208`, `:1583`, `:1619`, `:2008`, `:2041`) keeps writing its own final label
  exactly as today. FR-2's trap-level restoration only fires for an abort that occurs
  before the "worktree confirmed to exist" marker — it must not race or double-write any
  of those six existing call sites, all of which run well after that marker is set.
- **INV-5 (idempotent under repeat aborts).** A second, third, … dispatch of the same
  stranded issue, each hitting the same `:703` failure before FR-1/FR-3 land, still ends
  with `agent-ready` present and `agent-running` absent — not a growing set of duplicate
  labels or comments. (Once FR-1/FR-3 land, the failure this spec was written for cannot
  recur for the *branch-reuse* trigger; INV-5 covers any *other* future pre-worktree
  abort.)

### Decisions needed (Clarify)

- **DQ-1 (how FR-4 learns which ready label(s) were removed).** Two shapes are plausible:
  (a) query `gh issue view --json labels` immediately before the `--remove-label` calls
  and capture the intersection with `{agent-ready, agent-ready-specify}` into a shell
  variable the EXIT trap can read; or (b) infer it from which triage path dispatched this
  run — `dispatch-issue.sh` already knows whether it was invoked for a plain build or a
  specify-only T3/T4 build (the `agent-ready-specify` label-create block at `:664-667`
  runs unconditionally, but the decision of *which* label this issue actually wore is
  presumably already available earlier in the file's triage-reading logic). Recommendation:
  (a) — a fresh read at the point of removal is strictly correct regardless of how the
  caller got here, versus (b)'s risk of silently drifting from whatever
  `dispatch-ready-check.sh` actually decided. Cost: one extra `gh issue view` API call per
  dispatch, on a path that already makes several. Needs a human's read because FR-4's
  correctness depends entirely on this choice and Plan-phase code structure should not
  guess at it.
- **DQ-2 (does FR-2's trap-level restoration re-run the label restore, or does FR-1 make
  it unreachable in practice and FR-2 exist only for defense-in-depth)?** Once FR-1 lands,
  the label write happens strictly after `git worktree add` succeeds, so FR-2's "abort
  before worktree exists" condition and "label was already written" become mutually
  exclusive in the reordered script — FR-2 would then be dead code in the sense that it
  never fires under FR-1's own ordering, only under a future regression of FR-1.
  Recommendation: build FR-2 anyway and cover it with the T3 regression test's negative
  case (simulate an abort *as if* the old ordering were still in effect, e.g. by testing
  the trap's restoration function in isolation rather than only end-to-end) — the point of
  INV-2 is that it protects against exactly the reordering being undone later, so a test
  that only proves it via FR-1's current ordering would not prove INV-2 at all. Cost: the
  trap-restoration function needs to be structured as an independently-testable pure(ish)
  step (a function taking "which labels were removed" and "did the worktree get
  confirmed" and returning the label-edit command), adding a small amount of surface
  versus inlining it in the trap. Needs a human's read because it is a Plan-phase
  structural choice, not obviously determined by the FRs alone.
- **DQ-3 (FR-3's "existing branch, zero commits ahead" check — does it also need to
  confirm no OPEN PR references the branch, or is `rev-list --count` against
  `origin/main` sufficient)?** A branch with zero commits ahead of `origin/main` cannot
  carry a meaningful open PR (nothing to review), so this is likely already covered by
  construction, but SPEC-044's D12 sequential-guard precedent (`lease_gate_open_unshipped`,
  `:625-627`) already does an issue-level "closed or already shipped" check earlier in the
  same file, and it's worth confirming this doesn't need a parallel PR-level check to be
  strictly correct. Recommendation: no additional check — zero-commits-ahead is sufficient
  by construction (a PR with a base and head at the same commit has nothing to merge and
  GitHub does not permit opening one) — but flagging since Plan-phase is the right place to
  double-check this reasoning against `gh pr list --head` before committing to "no check
  needed" in code.

## Out of scope (tracked elsewhere)

- **#1674's own defect (a completed dispatch with zero commits reads as "done")** — covered
  by [SPEC-073](../SPEC-073-dispatch-completion-requires-commit/requirements.md). Different
  end of the same file; not re-litigated here.
- **#1656's quota-vs-escalation misclassification** — covered by
  [SPEC-074](../SPEC-074-dispatch-quota-classification/requirements.md).
- **Any abort occurring AFTER the worktree is confirmed to exist** — the six existing
  completion/escalation label-edit call sites already handle their own labelling
  (INV-4); this spec's FR-2 restoration only applies before that marker.
- **A general "any git ref could be stale" detector** — FR-3 is scoped to exactly the
  `agent/issue-${ISSUE}` branch this dispatcher itself creates and names; it is not a
  general stranded-branch scanner (that is SPEC-057's, and a different branch: `main`, not
  an agent branch).

## Acceptance Criteria

- **AC-1 (FR-1).** Static/structural assertion against `scripts/dispatch-issue.sh`: the
  line number of the `--add-label "agent-running"` edit is strictly greater than the line
  number of `git worktree add -b "$BRANCH"` — proving the reorder happened, mirroring the
  sibling dispatch tests' existing "grep the script, assert relative position" style
  (e.g. `dispatch-claim-first-step.test.ts`).
- **AC-2 (FR-3, INV-3, T3 regression — positive).** With `agent/issue-N` pre-created at
  the same SHA as `origin/main` (zero commits ahead) and no live worktree referencing it,
  dispatching issue `N` does not fail at the worktree-creation step; the stale branch is
  removed and a fresh one is created; the issue ends labelled `agent-running` with
  `agent-ready` (or `agent-ready-specify`, matching whichever it wore) removed — a genuine
  live dispatch, not a stranded one.
- **AC-3 (FR-3, INV-3, T3 regression — negative).** With `agent/issue-N` pre-created
  carrying one or more commits `origin/main` does not have, dispatching issue `N` fails
  loudly (non-zero exit, or the same "stand down" shape used at `:623-631`) and does
  **not** delete the branch — asserted by the branch still existing, with its commits
  intact, after the run.
- **AC-4 (FR-1/FR-2, INV-1, INV-2, the issue's own regression case).** Simulate an abort
  between label-write-would-happen and worktree-confirmed (e.g. by forcing `git worktree
  add` to fail via a pre-existing branch that FR-3 cannot cure — a directory collision, an
  out-of-disk condition, or by directly exercising the trap-restoration function per DQ-2)
  and assert: `agent-running` is NOT present on the issue afterward, and whichever
  `agent-ready`/`agent-ready-specify` label was removed IS present — the exact failure
  #1544 exhibited, now closed.
- **AC-5 (INV-4).** Each of the six existing completion/escalation label-edit call sites
  (`:1172`, `:1208`, `:1583`, `:1619`, `:2008`, `:2041`) still fires exactly once per its
  own successful/failed run, with the same final label set as before this spec — a
  before/after diff of a full successful dispatch shows no change to its labels.
- **AC-6 (INV-5).** Two consecutive dispatch attempts against the same stranded
  precondition (AC-4's scenario, repeated) both end with `agent-ready` present and
  `agent-running` absent — no duplicate comments, no accumulating label state.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | FR-3's `rev-list --count origin/main..agent/issue-N` reads a stale local `origin/main` if run before the file's own `git fetch origin main -q` (`:695`) | Sequence FR-3's check to run AFTER `:695`'s fetch, not before — consistent with how SPEC-073's R1 already resolved the identical staleness question for the same file |
| R2 | DQ-1 resolving to option (a) (a fresh `gh issue view` read) adds one more GitHub API call to every dispatch, on a script already rate-limit-conscious per SPEC-074's context | Bounded and one-time per dispatch, not per retry; acceptable per DQ-1's own recommendation, flagged for Plan-phase confirmation against current call volume |
| R3 | A future contributor re-adds an early label write "for visibility" ahead of the worktree step, reintroducing the exact bug this spec closes | INV-2 / FR-2's independent trap-level restoration is specifically the defense against this — AC-4 exercises it directly rather than only through FR-1's current ordering (see DQ-2) |

## Traceability

- **Issue:** [#1652](https://github.com/AIClarityAU/minspec/issues/1652) — this spec's
  trigger, found while re-dispatching #1544 after a previous run was killed mid-flight.
- **Siblings named by #1674 (each its own spec/dispatch):**
  [#1656](https://github.com/AIClarityAU/minspec/issues/1656) →
  [SPEC-074](../SPEC-074-dispatch-quota-classification/requirements.md); #1674 itself →
  [SPEC-073](../SPEC-073-dispatch-completion-requires-commit/requirements.md).
- **Cited comment this spec fulfils:** DR-066's "cosmetic mirror, never the authority"
  framing, already present at [`:614`](../../../scripts/dispatch-issue.sh#L614) but
  unenforced for this particular abort window.
- **Owning umbrella:** [SPEC-044](../SPEC-044-coordinated-self-completing-sessions/requirements.md)
  (declared owner of `scripts/dispatch-issue.sh` via its own `implements:`; this spec
  modifies the pre-worktree abort path, it does not take over ownership of the file —
  same relationship SPEC-073/SPEC-074 already have to it).
- **Related detection feature, different branch/shape:**
  [SPEC-057](../SPEC-057-stranded-branch-detection/requirements.md) (protected `main`
  branch on the primary checkout, not an agent branch on a worktree).
- **Constitution:** invariant #2 (no silent gate / no single disableable witness) is this
  spec's core rationale (INV-2, FR-2), directly parallel to how SPEC-057's Context cites
  the same invariant for a different mechanism.
- **No DR filed.** Per the DR-359 (parent register, mmo-platform) ADR filter, FR-1/FR-2/FR-3
  are same-day-reversible changes to one script (`scripts/dispatch-issue.sh`'s ordering and
  a new pre-check), not an irreversible architectural commitment — consistent with
  SPEC-073/SPEC-074's own "no DR filed" precedent for the same file.
