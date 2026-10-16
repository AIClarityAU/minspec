---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity
relates_to: [SPEC-010, SPEC-012, SPEC-076, DR-019, "#1213", "#581", "#886"]
implements: none
implements_reason: Specified, not built.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137 — Signpost reads remote truth, not a stale working tree

Issue: #1213 (Next-Task points at already-accepted DR-072). Same class as #581 (INDEX regeneration reads DR frontmatter from the working tree). Surface: SPEC-012 / DR-019 resolver, SPEC-010 graph.

## Scope sentence

The Next-Task signpost must never name an item that is already resolved on `origin/main`, and must say so out loud when it cannot know.

## Background (verified against code)

- `computeNextTask` and `nextTaskCommand` (`packages/minspec/src/commands/next-task.ts`) call `resolveNextTask(buildArtifactGraph(workspaceRoot))`.
- `buildArtifactGraph` (`packages/minspec/src/lib/artifact-graph.ts`, `fs.readFileSync` at lines ~158, 257, 412, 513, 566) reads specs, DRs and tasks from the **working tree**. So the signpost's answer is a function of local `HEAD` plus uncommitted edits.
- Root cause is therefore confirmed as the mechanism (a local read treated as authoritative for a fact owned by the remote), but the **missing gate** is the finding: nothing compares the reading to `origin/main`, so a stale reading is indistinguishable from a fresh one. I have not yet run the observed repro (7 commits behind) end to end; the reproduction is AC-1.

## Functional requirements

- **FR-1 Behind detection.** Before resolving, compute how far `HEAD` is behind the base ref (`origin/main`) using only local refs (`git rev-list --count HEAD..origin/main`); no fetch, no network (invariant 1).
- **FR-2 Honest staleness.** When behind by N>0, every signpost surface (status bar, toast, tree) states "reading is N commits behind origin/main" next to the answer. Silence is not permitted when N>0.
- **FR-3 Unknown fails visible.** If the base ref is missing, git is unavailable, or the count errors, the signpost shows "freshness unknown" rather than presenting the reading as current (invariant 2, no silent gate). The Tier-0 resolver itself stays pure and unchanged.
- **FR-4 Remote-truth status (the removal, see Decision D1).** Approvable status (`status:` of DRs/specs) used by the resolver is read from the base ref (`git show origin/main:<path>`) when that ref resolves, so an item accepted upstream is never named as outstanding.
- **FR-5 Local work still counts.** Items that exist only locally (new uncommitted/unpushed spec or DR, branch work) are still surfaced from the working tree; remote truth overrides only the *status of items that exist on the base ref*.
- **FR-6 Offline.** All of the above uses locally cached refs only. Refreshing `origin/main` is the user's act (or an existing opted-in fetch), never done silently by the signpost.
- **FR-7 Degrade.** Any failure in FR-1/FR-4 degrades to the working-tree reading plus the FR-3 notice; it must not throw (INV-DEGRADE from SPEC-012).
- **FR-8 Shared path.** Command, status bar and the headless reader (SPEC-076) all go through one function so they cannot disagree.

## Acceptance criteria

- **AC-1 (repro).** Fixture: working tree has `DR-072` `status: proposed`; `origin/main` has it `accepted`; HEAD behind by 7. The signpost does not name DR-072 and shows the behind notice.
- **AC-2.** Same fixture with option D1=B (notice only): signpost may name DR-072 but MUST include "7 commits behind".
- **AC-3.** No `origin/main` ref: signpost shows "freshness unknown", does not throw.
- **AC-4.** Item present only in the working tree (not on base) is still surfaced.
- **AC-5.** Up to date (N=0): output identical to today (no new text).
- **AC-6.** Test binds the source of truth at the T0 level: given a tree behind its base, the signpost never names an item resolved upstream. The test must fail on the current code (red-first).
- **AC-7.** No network call is made (spy on spawned git args: only `rev-list`, `show`, `rev-parse`).

## Invariants this must not break

1. Offline core; no network without consent (FR-6, AC-7).
2. No silent gate: stale or unknown never reads as current (FR-2, FR-3).
3. Blast radius: behaviour only inside a `.minspec/` repo; no machine-wide config.
- Tier-0 purity of `resolveNextTask` in `@aiclarity/shared` (no git/vscode in it); the git read lives in the extension layer.
- INV-DEGRADE (SPEC-012): never crash the thread.

## Decisions needed (Clarify)

- **D1 — How far to go.**
  - **A (rec): both.** FR-1..FR-4: remote-truth status plus the behind notice. Removes the lie and shows the staleness. Cost: a second read path (git-show per approvable) with a merge rule (FR-5) that has to be exactly right; a slow `git show` on big registers.
  - **B: notice only (issue option 2).** Cheap, small. Cost: the signpost still names finished work; it is honest, not correct. The issue itself says this is insufficient alone.
  - **C: remote-only.** Ignore the working tree entirely. Cost: hides local, unpushed work — wrong for a branch session.
- **D2 — Base ref.** Hard-coded `origin/main`, or the repo's default branch via `origin/HEAD`/config? Rec: resolve `origin/HEAD` with `origin/main` fallback; cost: a repo with no `origin/HEAD` falls to the fallback silently unless FR-3 shows it.
- **D3 — Fetch.** Never fetch (rec, keeps offline; cost: a checkout with a stale `origin/main` ref is still stale, only fixed by the user fetching) vs. opt-in background fetch (cost: new network surface needing consent UI).
- **D4 — Scope of "status".** Only DR/spec `status:` (the observed case), or also approval/phase state (`approvals.json`, `phases:`) which #886 shows is a related mis-derivation? Rec: DR/spec `status:` here, file #886 separately; cost: approval-state staleness remains.

## Out of scope

Fixing #581 (INDEX regeneration) and #886 (`deriveStatus`); they are the same class, tracked separately.
