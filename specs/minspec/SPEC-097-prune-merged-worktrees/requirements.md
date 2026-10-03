---
id: SPEC-097
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness — session/worktree lifecycle (G-8, git transparency); sibling of DR-065 (presence-gated mutation) and SPEC-057 (stranded-branch detection)
aspects: [worktree, git-hygiene, consent, network, gh-cli, presence, silent-gate, tier-0]
relates_to: [DR-065, DR-050, DR-071, DR-004, DR-051, SPEC-026, SPEC-057, "#177", "#168"]
implements: [packages/minspec/src/lib/prune-worktrees.ts, packages/minspec/src/commands/prune-worktrees.ts, packages/minspec/tests/prune-worktrees.test.ts, packages/minspec/tests/prune-worktrees-gh-consent.test.ts]
affects: [packages/minspec/package.json, packages/minspec/src/extension.ts, packages/minspec/tests/invariants.test.ts, packages/minspec/README.md]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-097: MinSpec: Prune Merged Worktrees — squash-merge aware, never silent-delete

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, resolves the open questions under **Decisions needed (Clarify)**, and approves
> it through the normal spec-approval gate before any code changes.

Materializes **[#177](https://github.com/AIClarityAU/minspec/issues/177)** —
*"after merging spec/DR work, stale `agent-*` worktrees + merged branches accumulate ...
make MinSpec auto-prune merged trees."* Relates to **[#168](https://github.com/AIClarityAU/minspec/issues/168)**
(worktree-per-session — the rule that creates the worktrees this spec cleans up) and to
goal **G-8 — git transparency** (`.minspec/constitution.md:57`): *"MinSpec handles git for
the human."* Today that handling stops at creation — `scripts/new-worktree.sh`'s own header
comment names the cleanup step as a manual command the human runs by hand (`Cleanup: git
worktree remove ../.worktrees/<repo>/<name>   (after the branch is merged)`). This spec is
the editor-native half of that comment.

## One-Sentence Scope

Add a MinSpec command that enumerates non-primary git worktrees, classifies each one
against an explicit, auditable safety verdict (merged-how, clean?, unpushed?,
presence-occupied?), and lets the human remove — one worktree and its branch at a time —
only the ones every gate marks safe; it mutates nothing on its own and runs no network call
until the human invokes it.

## Context — what exists today, and the gap

- **Worktree creation is already a product feature; cleanup is not.** `scripts/new-worktree.sh`
  makes a worktree per session (#168, global CLAUDE.md rule #8) and names its own cleanup
  command in a comment a human must remember and run. Nothing in the extension or the
  dispatch scripts ever runs that command automatically, so completed worktrees accumulate
  (the issue's own observation). This is a **detection gap for a mechanical, low-risk-when-
  gated chore**, not a missing feature class — the project already ships exactly this shape
  of command (`tidyPrimary`, below) for the adjacent problem.

- **Git ancestry alone under-detects "merged" (the issue's core finding).**
  `git branch --merged <default>` (and `merge-base --is-ancestor`) only recognizes a branch
  as merged when its tip is reachable from the target — true for an ordinary merge commit,
  **false for a squash merge**, because GitHub's squash creates a brand-new commit on the
  default branch with different parents; the original branch tip is never an ancestor of it.
  The issue names a concrete pair from this repo's own history: a merge-commit PR shows
  merged by ancestry, a squash-merged PR does not. A command that classified "merged" by
  ancestry alone would therefore **never** mark a squash-merged worktree safe to prune —
  not a false positive, but a silent false negative that makes the feature not work for the
  repo's dominant merge style (this repo squash-merges by default per its PR tooling).
  Closing that gap needs the PR's own state from the forge (`gh pr view <branch> --json
  state`), which is a **network call** — the load-bearing design question this spec exists
  to answer (DQ discussion below).

- **The near-miss the issue cites is the one this design must survive.** Two commits
  (`fa5037f`/`a0bb9fd`) sat unpushed on a feature branch; a naive "looks mergeable → delete"
  would have destroyed them. The design below is built around **positive proof** of safety
  (merged, clean, no unpushed commits, not presence-occupied), mirroring the fail-safe
  posture [DR-065](../../../docs/decisions/DR-065.md) already established for mutating a
  shared checkout: *"any doubt discards nothing"* (DR-065 Amendment §bounds, item 2).

- **A mutation this shape has one directly-reusable precedent in this codebase.**
  `minspec.tidyPrimary` (`packages/minspec/src/commands/tidy-primary.ts`,
  `lib/tidy-primary.ts`) already does "classify read-only, show per-item verdicts, human
  confirms, re-classify immediately before acting, refuse on any peer/presence doubt" for a
  *different* mutation (discarding redundant dirty files in the **primary** checkout). This
  spec is the same shape applied to a *different* mutation (removing a whole **worktree** +
  its branch) on *non-primary* checkouts. It should reuse, not re-derive:
  - `listWorktreeRoots(primaryRoot)` (`packages/minspec/src/lib/presence.ts:342`) — the
    single enumeration already used by both the presence sync gate and `tidy-primary.ts`.
  - `isCheckoutOccupied(primaryRoot, worktreeRoot)` (`presence.ts:381`) — DR-065's G3
    predicate verbatim: **fail-safe to occupied** on any read/parse/kill error, true
    dormancy requires *positive* proof. This is the presence gate the issue's own three
    numbered conditions omit, and its absence is exactly the class of gap this repo's
    constitution invariant 2 warns about (a destructive action gated on fewer witnesses
    than the codebase already has available). **Added here as a fourth, mandatory gate.**
  - `sameCheckout` (`presence.ts:310`) — so the command refuses to list, or ever target,
    the worktree the command itself is running from (the open workspace root), independent
    of what any other gate says about it.

- **This is a genuinely new mutation class, not a widened instance of an existing
  sanction.** [DR-065](../../../docs/decisions/DR-065.md) §5 sanctions exactly one
  *automatic, unattended* operation (`merge --ff-only`, by drain/loop tooling, gated on
  G1–G4) and its 2026-08-30 amendment sanctions exactly one more (discarding a
  byte-identical dirty *file*, same unattended-tooling gating). Neither covers *this*
  command, but neither needs to be amended either: every mutation this spec proposes is a
  **human clicking a named button in the editor**, never something a drain/loop script runs
  on its own. DR-065 §5 is explicit that the extension side only ever offers "a
  consent-gated sync, never a silent one" — this command IS that consent gate, for a
  mutation DR-065 never attempted to cover (whole-worktree + branch removal). No DR
  amendment is proposed by this spec; Clarify should confirm that reading.

## Functional Requirements

- **FR-1 (enumeration).** List every worktree `git worktree list --porcelain` reports from
  the primary root via `listWorktreeRoots`, excluding: the primary itself; the worktree
  `sameCheckout` resolves as the one the command is running from; and any worktree git
  reports `locked` (an explicit human "don't touch this" signal — never listed as a
  candidate, not even as a red row).

- **FR-2 (four safety gates, ALL required for a green verdict).** For each remaining
  candidate, compute and display:
  1. **Clean** — `git status --porcelain` is empty in that worktree.
  2. **No unpushed commits** — the branch's upstream (if configured) has zero commits
     ahead (`rev-list --count @{u}..`); if no upstream is configured, the branch tip must
     be reachable from `origin/<default>` OR from the merge commit of a PR the forge
     reports as MERGED for this branch (reuses the FR-3 result — a branch with no upstream
     and no merged PR is never prune-safe).
  3. **Merged** — EITHER git ancestry (`merge-base --is-ancestor <tip> origin/<default>`,
     catches an ordinary merge commit, offline) OR the forge's own PR state is MERGED for
     this branch (FR-3, catches a squash merge). Neither alone is sufficient to call a
     branch NOT merged — the ancestry check misses squash merges by construction (Context),
     so "ancestry says no" must not short-circuit skipping the FR-3 lookup.
  4. **Not presence-occupied** — `isCheckoutOccupied(primaryRoot, worktreeRoot)` returns
     `false` (positive proof of dormancy). Any error, corrupt record, or ambiguous read
     returns `true` (occupied) per that function's own fail-safe contract, with the SAME
     effect here as elsewhere: not prune-safe.
  A candidate is **prune-safe (green)** only when all four hold. Any other combination is
  shown but never offered a remove action.

- **FR-3 (the network call, gesture-gated, not ambient).** Determining PR state for gate 2
  (merged-how) requires `gh pr view <branch> --json state,headRefOid,mergeCommit`, which
  reaches the network. This call runs **only** inside a run of this command that the user
  has explicitly invoked (command palette or a view's own button) — never on activation,
  on a timer, on window focus, or on any other ambient trigger, matching the DR-050/DR-071
  consent model already applied to the Backlog panel's `gh issue list`
  ([SPEC-085](../SPEC-085-backlog-fetch-consent/requirements.md)). If `gh` is unavailable
  or unauthenticated, the command still runs using the offline ancestry check alone, and
  EVERY candidate whose ancestry check fails is shown as **"not provably merged — gh
  unavailable, squash merges cannot be confirmed offline"** rather than being silently
  omitted or silently treated as "not merged, full stop" (constitution invariant 2: a
  missing witness fails visibly, never silently).

- **FR-4 (per-item verdict display, not a single rollup).** The command shows, per
  candidate: the worktree path, its branch, the merged-how result (`merge commit`,
  `squash via PR #N`, `not merged`, or `not provably merged — gh unavailable`), clean
  yes/no, unpushed commit count, and presence (live/dormant, and if live, which session).
  Matches the issue's own ask ("lists candidates with per-item safety verdict") and this
  repo's never-wrong stance — a human can see WHY a given worktree was or wasn't offered.

- **FR-5 (re-classify immediately before mutating — TOCTOU close).** Exactly like
  `tidyRedundantPaths`'s documented guarantee, re-run all four FR-2 gates for a candidate
  immediately before removing it. A candidate that stopped being green between the list
  render and the click (new commits landed, a session attached, the PR was reverted) is
  skipped, never force-removed on stale information.

- **FR-6 (removal is per-item and explicit; see DQ-1 for the all-green case).** Each green
  row carries its own remove action. Removal runs `git worktree remove <path>` (never
  `--force` — FR-2 gate 1 already proved the tree clean, so an ordinary remove succeeds or
  the re-check in FR-5 already caught the reason it wouldn't) followed by deleting the
  local branch. Because a squash-merged branch is never an ancestor of `origin/<default>`
  (Context), `git branch -d` — which git would otherwise correctly refuse — is not the
  right primitive here; the branch delete uses the force form (`-D`) **but only reaches it
  after FR-2/FR-5 have independently proven the branch's content is safe to lose**, which
  is the actual job `-d`'s ancestry check does for a merge-commit-shaped history. This
  substitution, and why it is still safe, MUST be stated in the command's own code comment
  (this repo's standing pattern of naming load-bearing substitutions where DR-065's own
  text would otherwise be searched for and not found).

- **FR-7 (never auto-runs, never runs unattended).** No activation hook, timer, or presence
  heartbeat tick ever calls the enumeration, the gh lookup, or the removal. The command
  exists only as a user-invoked palette/view entry (constitution principle: no silent gate,
  no rubber-stamp automation; DR-065 §5's "consent-gated, never silent" extension-side
  posture applies here even though this is a new mutation class, not a DR-065 widening).

- **FR-8 (consent-call inventory + allowlist comment).** `lib/prune-worktrees.ts`'s `gh`
  call is added to `CHILD_PROCESS_ALLOWLIST` in `packages/minspec/tests/invariants.test.ts`
  with a comment stating it reaches the network, under which consent clause, and from which
  gesture — following the `lib/backlog.ts` entry's own comment as the template (SPEC-085
  FR-10). The README's network-claims section (SPEC-085 FR-8/FR-9's inventory and pinning
  test) gains this command as one more row; `readme-network-claims.test.ts` must fail if it
  is omitted.

- **FR-9 (pinning tests).** `prune-worktrees.test.ts` drives the four-gate classifier
  against a real throwaway git fixture (ordinary merge, squash-style synthetic merge,
  dirty tree, unpushed branch, and a live-presence record) with the git/gh seams injected,
  asserting each gate's verdict independently and the AND-of-all-four green rule.
  `prune-worktrees-gh-consent.test.ts` asserts, at the child-process boundary (not by
  mocking the function that makes the call away, which is how a prior consent test in this
  repo came to cover an unreachable branch — SPEC-085 FR-7's own cautionary note): zero `gh`
  invocations before the command runs, and no invocation from activation, a presence tick,
  or any other ambient trigger.

## Acceptance Criteria

- [ ] Running the command in a repo with one ordinary-merge-commit worktree, one
      squash-merged worktree, one not-yet-merged worktree, one dirty worktree, and one
      worktree with unpushed commits shows five distinct verdicts, and only the first two
      offer a remove action (once also clean/pushed/dormant). (FR-1–FR-4)
- [ ] With `gh` unavailable, the squash-merged candidate shows "not provably merged — gh
      unavailable" rather than being hidden or marked "not merged". (FR-3)
- [ ] Activating the extension, letting it sit idle, and toggling any other MinSpec view
      starts zero `gh` processes; only invoking this command's own entry point does.
      (FR-3, FR-7, FR-9)
- [ ] A candidate with a live presence record pointing at its worktree root is never green,
      regardless of merge/clean/unpushed state. (FR-2 gate 4)
- [ ] Removing a green candidate re-classifies it first; a candidate that a concurrent
      session dirties between list and click is skipped with a stated reason, not removed.
      (FR-5)
- [ ] After removal, `git worktree list` no longer lists the path and the branch no longer
      exists locally; the primary checkout's HEAD and index are untouched. (FR-6)
- [ ] The current workspace's own worktree is never listed as a candidate, under any
      verdict. (FR-1)
- [ ] `invariants.test.ts`'s allowlist comment and `readme-network-claims.test.ts` both
      name this command's network call. (FR-8)

## Invariants (must not break)

- **INV-1 (constitution #1 — consent before network).** No network call before the user
  invokes this specific command; `gh` unavailable degrades to a visibly-labeled reduced
  check, never a silent one. (FR-3)
- **INV-2 (constitution #2 — no silent gate).** Every gate failure is shown with its
  reason; a missing or errored witness (gh absent, presence unreadable) fails the
  candidate closed (not prune-safe), never silently passes it. (FR-2, FR-3)
- **INV-3 (DR-065 fail-safe direction, reused not re-derived).** `isCheckoutOccupied`'s
  existing fail-to-occupied contract is consumed as-is; this spec does not reimplement or
  loosen it.
- **INV-4 (never touches the primary or the caller's own worktree).** `sameCheckout`
  excludes both from candidacy unconditionally, independent of every other gate.
- **INV-5 (no new unattended trigger).** Nothing in this feature runs from activation, a
  timer, or the SPEC-026 presence heartbeat (FR-7) — distinct from, and narrower than,
  DR-065 §5's drain/loop sanction, which this feature does not use or extend.

## Decisions needed (Clarify)

- **OQ-1 (one-click per worktree, or a single confirmation for all green rows at once?).**
  FR-6 specifies per-item removal. The issue's own phrasing — "one-click remove the green
  ones" — could also mean a single bulk action over every green row. Recommendation: ship
  per-item only in v1; a bulk action multiplies the blast radius of one click (N branches
  gone instead of one) for a chore that is not frequent enough to need it, and per-item
  is the same posture `tidyPrimary` already shipped. Trade-off: more clicks when several
  worktrees are prunable at once. A bulk "remove all green" can be added later behind its
  own explicit multi-item confirmation if the per-item flow proves tedious in practice.

- **OQ-2 (does the issue's "passive count badge" ship at all?).** A badge that shows
  "N merged worktrees prunable" without the user having invoked the command would need to
  run the `gh pr view` lookup ambiently to detect squash merges — exactly the ambient-fetch
  shape [SPEC-085](../SPEC-085-backlog-fetch-consent/requirements.md) removed from the
  Backlog panel. Recommendation: do not ship the badge in this spec. A badge counting only
  the ancestry-provable (fully offline) subset of candidates is possible without violating
  INV-1, but undercounts exactly the squash-merge case the issue was filed to fix, which
  would make the badge misleading about its own feature. Revisit as a separate, explicitly
  scoped follow-up if wanted (trade-off: either no badge, or a badge that is known to
  undercount).

- **OQ-3 (surface: QuickPick list, or a dedicated webview/tree view?).** A QuickPick is the
  smallest surface and matches `tidyPrimary`'s own UI choice; a tree view (like the Backlog
  panel) could stay open and refresh. Recommendation: QuickPick for v1 — this is an
  occasional chore, not a thing the user watches continuously, and it avoids adding a new
  always-registered view for a rarely-opened feature. Trade-off: no persistent "N
  prunable" visibility between runs (ties into OQ-2 — a persistent view is what a badge
  would live on).

- **OQ-4 (what identifies "the branch" when a worktree is on a detached HEAD or a branch
  name that collides with another remote's?).** `git worktree list --porcelain` reports
  `detached` for some worktrees; those have no branch to merge-check or delete, only a
  tree to remove (if clean/dormant) with nothing else to prune. Recommendation: list a
  detached-HEAD worktree with merged-how shown as "n/a (detached)", gated only on
  clean/presence (gates 1 and 4), offering worktree removal alone, never a branch
  deletion. Needs confirmation because it is a narrower contract than the issue's three
  numbered conditions describe (they assume every worktree has a branch).

## Out of scope

- Any change to `scripts/new-worktree.sh`, `scripts/drain-inbox.sh`, or other Tier-1
  dispatch tooling. This spec is the Tier-0 editor-native surface; a dispatch-side
  equivalent (cleaning worktrees created by `scripts/new-worktree.sh` or by agent dispatch
  under a non-interactive script) is a different product surface and, per this repo's
  triage rule 3, a separate work item if wanted.
- Remote branch deletion (`git push origin --delete <branch>`). FR-6 only ever deletes the
  LOCAL branch backing a now-removed worktree; the remote branch (if any) is left for
  whatever already cleans up remote branches on merge (many forges do this automatically
  on a PR's own merge button).
- Any auto-run / scheduled variant of this command. FR-7 is absolute for this spec; a
  future auto-trigger (e.g. "offer this after every successful merge detected by SPEC-057
  / SPEC-032") is new scope requiring its own spec and its own consent design, not an
  extension of this one.
