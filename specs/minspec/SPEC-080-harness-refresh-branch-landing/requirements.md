---
id: SPEC-080
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness — git transparency (G-8), sibling of SPEC-057/SPEC-058's harness-refresh work
aspects: [git-transparency, harness-refresh, tier-0, consent, ux, g8]
relates_to: [SPEC-058, SPEC-057, SPEC-042, SPEC-043, DR-050, DR-078, DR-051, "#758", "#1298", "#885"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1/FR-2 pattern,
# repeated by SPEC-068/SPEC-078). NEW, not yet created: the pinning-test file FR-1..FR-4
# require. The production change lands inside `commands/init.ts`, which no spec `implements:`
# today (SPEC-042/SPEC-058/SPEC-068 all touch it under `affects:` only — a modify-don't-own
# file per SPEC-038's classification) — this spec follows the same pattern rather than
# claiming single ownership of a file four other specs already share.
implements: [packages/minspec/tests/harness-refresh-branch-landing.test.ts]
affects: [packages/minspec/src/commands/init.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Finish the job a harness-refresh branch starts (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers **Decisions needed (Clarify)**, and approves it through the normal
> spec-approval gate before any code changes.

Materializes **[#1554](https://github.com/AIClarityAU/minspec/issues/1554)** — *"harness-refresh
commits to a new branch that is never pushed, merged, or mentioned again."*

**Id note.** `SPEC-072` and `SPEC-077` do not exist on disk at Specify time (gap, not a
reservation this spec can see); the highest id on disk is `SPEC-079`, so this is `SPEC-080`.
No spec-id collision gate exists in this repo today (only `scripts/check-dr-id-collision.ts`,
scoped to Decision Records) — if `SPEC-080` is already claimed on another open branch at
review time, renumber per this repo's own convention for `DR-NNN` collisions, applied by
analogy.

## One-Sentence Scope

Make the harness-refresh branch-commit path (`offerScaffoldCommit`'s `onDefaultBranch` case,
`packages/minspec/src/commands/init.ts:396-424`) finish visibly instead of stopping at a
local, unpushed commit — close the checkout-state silence and the recovery-command blind
spot #1554 reports — while leaving the push/PR-open mechanism itself to
**[SPEC-058](../SPEC-058-harness-refresh-merge-path/requirements.md)**, which already
specifies it for this exact commit path and must not be re-specified here.

## Context — what #1554 reports, and which part is already spoken for

Grounded in the current code, with `file:line` evidence.

- **The branch-commit path, as it stands today.** `offerScaffoldCommit`
  ([init.ts:359-437](../../../packages/minspec/src/commands/init.ts#L359)) detects
  `onDefaultBranch` ([:394](../../../packages/minspec/src/commands/init.ts#L394)) and, on
  accept, resolves a free name via `safeUniqueBranchName`/`uniqueBranchName`
  ([:407](../../../packages/minspec/src/commands/init.ts#L407),
  [:481-520](../../../packages/minspec/src/commands/init.ts#L481)), creates it with
  `createBranch`, which runs **`git checkout -b <name>`**
  ([:295-296](../../../packages/minspec/src/commands/init.ts#L295) — create-and-switch, not
  create-only), commits via `commitOrWarn`
  ([:422](../../../packages/minspec/src/commands/init.ts#L422)), and returns
  ([:423](../../../packages/minspec/src/commands/init.ts#L423)). Nothing after that point
  reads the current branch again, pushes, or reports it. The function's only remaining output
  is `commitOrWarn`'s own toast: *"MinSpec: committed … on 'chore/minspec-harness-refresh'
  (…)."* — the branch name appears once, in a toast that then scrolls away, and HEAD stays on
  that branch for every git operation the user performs next.
- **`safeUniqueBranchName` already avoids one failure mode and, by design, creates another.**
  Per its own docstring ([:463-480](../../../packages/minspec/src/commands/init.ts#L463)),
  the first branch in the `base → base-YYYY-MM-DD → base-YYYY-MM-DD-N` family that is free is
  used — added for **#1298** so a second refresh never collides with the first's branch. The
  side effect #1554 reports is exactly what that design implies: a repo that refreshes
  repeatedly accumulates one unpushed branch **per refresh**, each correctly non-colliding
  and each equally invisible once its toast scrolls away.
- **The recovery command (#758) cannot see this state.**
  `commitHarnessRefreshCommand` ([:558-574](../../../packages/minspec/src/commands/init.ts#L558))
  — the existing "missed the toast" affordance — calls `collectDirtyScaffoldPaths`
  ([:168-183](../../../packages/minspec/src/commands/init.ts#L168)), which asks only "is a
  scaffolded path currently uncommitted on disk." A harness branch that was **already
  committed** (on a branch the user is no longer standing on) presents a perfectly clean
  working tree on whatever branch the user is currently on — `collectDirtyScaffoldPaths`
  returns `[]`, and `commitHarnessRefreshCommand` reports *"no uncommitted harness/scaffold
  output to commit"* ([:566-570](../../../packages/minspec/src/commands/init.ts#L566)), which
  is true of the working tree and false of the repo's actual state. The one command built to
  answer "did I miss something?" cannot see the thing #1554 reports.
- **Part of #1554's ask is already specified elsewhere and must not be duplicated here.**
  [SPEC-058](../SPEC-058-harness-refresh-merge-path/requirements.md) FR-1 already requires
  exactly #1554's ask #1 — a `minspec.pushOnApprove`-gated offer to push the branch and open a
  PR, raised at the same `offerScaffoldCommit` branch-commit site, reusing the same consent
  model `commit-on-approve.ts`'s `RECOVER_ACTION`/`OPEN_PR_ACTION` already use for approvals.
  SPEC-058 is `phases.specify: done`, `phases.clarify: done`, approved and hash-locked
  (`.minspec/approvals/specs/minspec/SPEC-058-harness-refresh-merge-path/requirements.md.json`),
  with only Plan left to run. Re-specifying FR-1 here would mint a second, divergent
  requirement for the same mechanism — this spec's FR-2 instead **extends** SPEC-058's offer to
  a second call site (the recovery command) rather than restating it.
- **The one-sentence root cause.** `offerScaffoldCommit`'s branch-offer solved "a commit that
  can never be pushed" by moving the commit to a branch — but never asked afterward whether
  that branch went anywhere, and never told the user it had changed where they were standing.
  Two independent silences, not one: the **checkout state** (ask #2) and the **recovery
  command's blind spot** (ask #3) are both consequences of the same unfinished function, and
  SPEC-058's FR-1 closes neither — it only offers to push the branch **at the moment of
  creation**, inside the same toast flow. If the user declines (a legitimate answer — "Stay
  local" per #1554's own ask), both of this spec's gaps remain exactly as live as they are
  today.

## Functional Requirements

- **FR-1 (the checkout state is never silent).** After `offerScaffoldCommit`'s branch-commit
  path completes — including after SPEC-058 FR-1's push/PR-open offer resolves, whatever the
  user chose — the extension MUST NOT leave the workspace on the newly created branch without
  saying so in the same notification flow. The mechanism (return automatically vs. state
  plainly) is **DQ-1**.
- **FR-2 (the recovery command learns to see this state).** `commitHarnessRefreshCommand`
  (#758) MUST, in addition to its existing `collectDirtyScaffoldPaths` check, detect: a local
  branch in the harness-branch family (naming per **DQ-2**) exists, carries at least one
  commit the resolved default branch does not have, and has no configured upstream — and when
  found, offer the **same** push+PR-open action SPEC-058 FR-1 defines, by calling that
  primitive (or, if SPEC-058's implementation has not landed by the time this spec reaches
  Plan, the minimal version built directly against `approve-push.ts`, with consolidation
  tracked as a follow-up — mirroring the exact reuse-or-build-minimal rule SPEC-058 FR-2
  already applies to its own relationship with SPEC-050). This closes ask #3 even when the
  working tree is completely clean, which per FR-1/DQ-1 may now be the **normal** post-refresh
  state rather than an edge case.
- **FR-3 (additive, not a replacement).** FR-2's new check runs alongside, never instead of,
  the existing dirty-scaffold-paths check. Both conditions are independent (a dirty tree today
  and a stranded branch from a prior refresh can coexist) and both must be surfaced when both
  are true.
- **FR-4 (the "nothing outstanding" message becomes accurate).** `commitHarnessRefreshCommand`
  keeps reporting "no uncommitted harness/scaffold output to commit" when neither check finds
  anything — but after FR-2 ships, that message is no longer reachable while a MinSpec-created,
  unpushed, unmerged harness branch exists, closing the issue's "Missing gate" observation that
  *"a repo can refresh repeatedly, strand each attempt, and still report drift forever."*
- **FR-5 (Tier 0 — detection introduces no network).** FR-2's probe (branch list, ahead-count,
  upstream presence) is a local git read, exactly like `safeBranchInfo`
  ([:440-448](../../../packages/minspec/src/commands/init.ts#L440)) and SPEC-057's probe. The
  only network act anywhere in this spec's scope is the push+PR-open action it reuses from
  SPEC-058, already gated on `minspec.pushOnApprove` / DR-050's click-is-consent model. This
  spec introduces no new consent surface.
- **FR-6 (blast radius).** Nothing in this spec changes behavior for a repo without its own
  `.minspec/` — both touched commands are already repo-opt-in MinSpec surfaces (constitution
  invariant 3).

## Invariants

- **INV-1 (no silent branch move — FR-1).** Any HEAD change this spec's FR-1 performs is
  reported in the same notification that reports the commit outcome; a move that fails is
  reported as a failure that names the branch the user is actually left on. Silence is never
  an acceptable outcome of this code path, mirroring this repo's general "no silent gate"
  posture (constitution invariant 2) even though FR-1 itself is advisory, not a gate.
- **INV-2 (detection is read-only).** FR-2's probe never pushes, commits, or switches branches
  by itself — only the human's click on the resulting offer does, exactly as SPEC-058 FR-1
  specifies for the original toast.
- **INV-3 (one push+PR-open primitive, not two).** FR-2 calls the same implementation SPEC-058
  FR-1 defines (or its documented minimal stand-in). No second, independently-maintained
  push/PR-open code path may exist between the two call sites.
- **INV-4 (Tier 0).** No network call anywhere in this spec's scope outside the single,
  already-consent-gated push+PR-open action (constitution invariant 1, DR-050).
- **INV-5 (blast radius).** Constitution invariant 3, as FR-6.
- **INV-6 (never a false "nothing outstanding").** `commitHarnessRefreshCommand` must not
  report that there is nothing to commit/push while a MinSpec-created harness branch sits
  unpushed and unmerged ahead of the default branch (FR-4).

## Acceptance Criteria

- **AC-1 (FR-1, DQ-1-dependent).** After committing on a newly created harness branch from a
  clean, previously-checked-out default branch, the end state and the notification both match
  whatever DQ-1 selects — asserted against a fake committer/git-runner recording every
  `checkout`/`branch` call, never by inspecting prose alone.
- **AC-2 (FR-1 failure path).** If DQ-1 selects auto-return and the return step fails (fake
  checkout throws — e.g. a conflicting dirty file), the user sees an explicit message naming
  the harness branch they are now left on. Never silence, never a swallowed error.
- **AC-3 (FR-2, the issue's own regression case).** Fixture: a local branch
  `chore/minspec-harness-refresh`, one commit ahead of `main`, no upstream, current branch is
  `main`, working tree clean — reproducing the `scroogellm` state #1554 reports. Running
  `commitHarnessRefreshCommand` offers push+PR-open for that branch. Proven red on today's
  code (which reports "no uncommitted harness/scaffold output to commit") and green after the
  fix.
- **AC-4 (FR-2, the dated-sibling case).** Same fixture shape with
  `chore/harness-refresh-2026-08-14` (the `uniqueBranchName` dated form) ahead of default, no
  upstream — same detection, proving the family match isn't hardcoded to the undated name
  alone (DQ-2 Option A) and covers the second `scroogellm` branch #1554's own table lists.
- **AC-5 (FR-3, both-true case).** Fixture with both a dirty scaffold path on disk AND an
  unrelated, already-committed, unpushed harness branch from a prior refresh — both are
  surfaced in the same invocation; neither suppresses the other.
- **AC-6 (FR-2 boundary — mirrors SPEC-057 AC-7).** An ordinary feature branch with unrelated
  commits ahead of its own upstream is never flagged by this detection, keeping this spec's
  narrow, name-scoped probe distinct from SPEC-057's deliberately broader (and
  protected-branch-only) ahead-of-upstream probe — the two must not converge into one noisy
  surface.
- **AC-7 (FR-4).** With neither check finding anything, the command's existing "nothing
  outstanding" message is unchanged, word for word.
- **AC-8 (INV-3).** A single shared push+PR-open implementation is exercised by both SPEC-058's
  FR-1 call site and this spec's FR-2 call site in the test suite — not two independently
  stubbed code paths that merely look alike.

## Decisions needed (Clarify)

### DQ-1 — Return to the previous branch automatically, or stay and say so plainly?

#1554's own ask treats these as equally legitimate ("Either … or …").

- **Option A — auto-return (rec).** After the commit (and after SPEC-058 FR-1's push/PR offer
  resolves, whatever was chosen), run a `git checkout <branch the user was on before>` back to
  the prior branch, reporting the harness branch's name and its outcome (pushed / PR opened /
  left local) in the same notification. *Cost:* an implicit git operation runs on every
  refresh that didn't exist before; a user who deliberately wanted to keep working on the new
  branch (e.g., to inspect the diff before deciding whether to push) is moved off it without
  being asked — mitigated by naming the branch in the notification either way, but this is a
  judgment call about what "finish the job" means for this specific feature. Directly closes
  the issue's named compounding effect #1 ("subsequent unrelated work silently lands there
  too … that is how one stranded branch becomes a habit") **by construction**, not by hoping
  the user reads a toast.
- **Option B — stay, state plainly.** Never switch branches automatically; the notification
  always names the branch the user is now on and offers no silent default. *Cost:* a user who
  doesn't read or act on the toast reproduces the exact compounding effect #1554 reports —
  this option closes the *visibility* gap but not the *habit* gap, and #1554's Context section
  frames the habit gap as the more consequential of the two.

### DQ-2 — Which branches does FR-2's detection match?

- **Option A — the deterministic family only (rec).** Match `harnessBranchName(refresh)`
  ([init.ts:522-525](../../../packages/minspec/src/commands/init.ts#L522)) plus its
  `uniqueBranchName` dated/numbered siblings — reusing the exact same naming function
  `offerScaffoldCommit` already calls to create them, so detection can never drift from
  creation. *Cost:* a branch a user manually renamed away from the family becomes invisible to
  the recovery command — acceptable, since a deliberate rename already signals the user has
  taken ownership of that branch.
- **Option B — any local branch ahead of its upstream (or default, if none), regardless of
  name.** Reuses SPEC-057's broader probe. *Cost:* this is SPEC-057's own territory by design
  — its OQ-2 scopes it to "protected default branch only," so a generic probe here would
  either duplicate SPEC-057's detection for the harness case or widen SPEC-057 to a mandate it
  explicitly declined, flagging ordinary feature-branch WIP as if it were a stranded harness
  branch (the exact noise SPEC-057 AC-7 exists to rule out).

### DQ-3 — Is branch reuse (#1554's optional ask #4 — "reuse the existing harness branch
instead of a dated sibling") in this spec's scope?

- **Option A — defer, out of scope here (rec).** #1554 itself calls this "optional, and the
  real fix for the accumulation … only matters once a repo has already accumulated several."
  Reuse would change `uniqueBranchName`'s collision contract (built for **#1298** specifically
  to avoid colliding with an existing branch), which no open spec owns today and deserves its
  own Specify pass rather than riding in in this one's Plan phase. *Cost:* orphaned branches
  keep accumulating one-per-refresh until a follow-up ships — but FR-1 (visible landing) and
  FR-2 (always-discoverable later) together mean an orphan is no longer **silent or
  invisible**, only **present**, which is a materially smaller problem than the one #1554
  reports.
- **Option B — build it here.** Couples this spec to #1298's collision contract and to
  SPEC-058's push mechanics in one Plan phase, raising this spec's effective tier and delaying
  the two higher-value closes (FR-1, FR-2) behind a lower-value one.

## Out of Scope

- **The push/PR-open mechanism itself** (#1554 ask #1) — fully owned by
  [SPEC-058](../SPEC-058-harness-refresh-merge-path/requirements.md) FR-1, approved and
  pending Plan. This spec's FR-2 calls that mechanism; it does not redesign it.
- **Branch reuse** (#1554 ask #4) — see DQ-3. If Clarify selects Option A (recommended), file
  a follow-up issue before Plan closes this spec's traceability; this dispatch has no network
  access to file it directly.
- **SPEC-057's generic protected-default-branch-ahead detection** — a different trigger
  (commits landing directly on the default branch itself, not on a branch created to avoid
  that) and a different, already-specified probe. See DQ-2.
- **Any change to how `offerScaffoldCommit` decides whether to offer a branch at all**, or to
  `uniqueBranchName`'s collision-avoidance algorithm (#1298) — unchanged by this spec.

## Risks

| Risk | Mechanism | Mitigation |
|---|---|---|
| FR-1's auto-return (if DQ-1 selects Option A) surprises a user mid-inspection of the new branch | The return runs immediately after the commit/push flow with no separate confirmation | The notification always names the branch and its outcome, so the state is never ambiguous even when the move itself wasn't asked for (INV-1) |
| FR-2's detection drifts from the names `offerScaffoldCommit` actually creates | A hand-maintained second list of branch-name patterns | DQ-2 Option A reuses `harnessBranchName`/`uniqueBranchName` directly rather than re-deriving a pattern |
| FR-2 forks a second push/PR-open implementation alongside SPEC-058's | Two call sites, written at different times, by different Plan passes | INV-3 + AC-8 bind both call sites to one shared implementation under test |
| This spec ships before SPEC-058's Plan extracts a reusable primitive | FR-2 depends on FR-1 of a sibling spec that hasn't reached Plan yet | FR-2's reuse-or-build-minimal clause (mirroring SPEC-058 FR-2's own rule for SPEC-050) lets this spec proceed independently, with consolidation as a tracked follow-up |

## Traceability

- **Issue:** [#1554](https://github.com/AIClarityAU/minspec/issues/1554) — this spec's
  trigger, for the parts not already specified by SPEC-058.
- **Sibling, same commit path, FR-1 already specified there:**
  [SPEC-058](../SPEC-058-harness-refresh-merge-path/requirements.md) (push + PR-open at the
  moment of creation).
- **Sibling, different trigger, same epic:**
  [SPEC-057](../SPEC-057-stranded-branch-detection/requirements.md) (a commit landing directly
  on the protected default branch itself — the complementary, already-covered case).
- **Collision handling whose correct behaviour this spec's FR-2 must stay compatible with:**
  [#1298](https://github.com/AIClarityAU/minspec/issues/1298).
- **Related, named in the issue, not pulled in here:** #533 (onboarding checklist — a "harness
  branch not landed" item would belong there, per the issue's own "Related" section).
- **Goal:** constitution G-8 — git transparency: *"a non-git-literate dev never has to
  understand or resolve branches, rebases, stranded approvals, or push rejections."*
