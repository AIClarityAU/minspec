---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: agent-execute
epic: EPIC-007  # Agent Execute Extension
depends_on: [SPEC-019, DR-046]  # SPEC-019 FR-13 owns base-freshness + pinned base; DR-046 is its rationale
relates_to: [SPEC-019, DR-046, DR-008, DR-004, "#463", "#404", "#429", "#430"]
---

# Dirty / unpushed primary-checkout detection at dispatch (SPEC-019 FR-13 refinement)

> Issue: [#463](https://github.com/AIClarityAU/minspec/issues/463). Refines
> [SPEC-019](../SPEC-019-execution-substrate/requirements.md) FR-13 (base-ref freshness +
> pinned base) and [DR-046](../../../docs/decisions/DR-046.md). **Specified, not built.**
> SPEC-019 is approved and hash-locked, so this refinement lives in its own spec rather than
> editing FR-13 in place (an edit would void SPEC-019's approval).

## One-Sentence Scope

Before the control plane creates an agent worktree off pinned `origin/main`, it inspects the
user's primary checkout for uncommitted changes and unpushed commits and, when found, surfaces
them (attended) or returns a typed fail-soft (unattended) instead of silently dispatching onto a
base that cannot see that work.

## Context

SPEC-019 FR-13 bases the agent on fetched `origin/main` at a pinned SHA in a worktree outside
every checkout. That is correct for isolation, but anything only in the primary checkout —
uncommitted edits, or commits not yet pushed — is invisible to the agent. If the task depends on
it, the agent emits factually wrong output. DR-046 covers a stale *committed* base (re-fetch +
reconcile) and bounds blast radius with the "tree pinned at `<sha>`" DATA caveat, but nothing
detects a dirty/unpushed *primary* at dispatch or tells the human. Observed 3x on 2026-07-04:
approvals stranded local-only (#404, fixed via #429), a born-stale spec, and a spec left
uncommitted. #430 (approve-lands-on-main) shrinks the source of the problem but does not remove it.

## Functional Requirements

- **FR-1 (probe, read-only, parent-side).** Immediately before worktree creation, the control
  plane runs, against the primary checkout only via `git -C <primary>`: `status --porcelain`
  (uncommitted: modified, staged, untracked) and a comparison of the local current branch against
  its fetched upstream (`origin/<branch>`; unpushed = commits in local not in origin). The probe
  never writes, stages, stashes, switches, or fetches into the primary's refs beyond the
  fetch FR-13 already performs.
- **FR-2 (path classification).** Findings are reported with their paths and split into
  *relevant surfaces* — `specs/**`, `.minspec/approvals/**`, `docs/**` — and *other*. The
  relevant-surface set is the default and is configurable; classification affects wording and
  prominence only, never whether a finding is reported (see D-1).
- **FR-3 (attended surface).** With a human present, dispatch pauses on a non-modal prompt over
  the findings: counts (N uncommitted files, M unpushed commits), the path list, and the choices
  *commit and push first* / *dispatch anyway* / *cancel*. "Dispatch anyway" is recorded on the
  run record (FR-6).
- **FR-4 (unattended fail-soft).** With no human present, dispatch returns
  `{ ok: false, reason: 'dirty-primary', uncommitted: <n>, unpushed: <m>, paths: [...] }`,
  creates no worktree, labels the issue for human attention, and leaves the queue item
  re-dispatchable. Never silently proceeds (constitution invariant 2).
- **FR-5 (typed reason registered).** `dirty-primary` is added to the SPEC-019 FR-11
  discriminated reason set and to the CL-5 rejectable set alongside `stale-base`.
- **FR-6 (record).** The OutcomeStore record carries the probe result (counts, paths,
  and the human's override if any), so a later reviewer can tell a run was dispatched knowingly
  over local-only work.
- **FR-7 (probe failure fails closed, visibly).** If the probe itself errors (not a git
  repo, lock contention, detached HEAD with no upstream), the result is a typed fail-soft
  (`git-lock-contention` where applicable, else `dirty-primary-probe-failed`), never a silent
  pass. A branch with no upstream is reported as "unpushed: unknown", not as clean.
- **FR-8 (offline).** The probe makes no network call of its own. Unpushed detection uses the
  remote-tracking ref as last fetched; if FR-13's parent-side fetch ran, it is fresh.
- **FR-9 (agent caveat).** When the human chose "dispatch anyway", the agent's untrusted-data
  caveat gains a line naming the count of local-only files the agent cannot see (counts only,
  not paths — paths are data the parent renders).

## Invariants (must not be broken)

- INV-1: the probe is read-only on the primary checkout (SPEC-019 cwd discipline: branch NAME and
  HEAD SHA unmoved before and after; `checkout-moved` still applies).
- INV-2: no silent gate — probe error or unknown state never reads as "clean".
- INV-3: the agent never holds credentials or sees primary-checkout content; only the parent
  inspects the primary.
- INV-4: opt-in blast radius — runs only in repos with `.minspec/`.
- INV-5: no network call without consent (FR-8).

## Decisions needed (Clarify)

- **D-1: Which findings block?** (a) Any dirty/unpushed state prompts or fails-soft —
  **recommended**; cost: noisy on a shared checkout where unrelated local edits are common, so
  unattended runs will often return `dirty-primary`. (b) Only relevant surfaces (FR-2) block,
  others merely logged; cost: misses dependencies on code files (a task depending on an
  uncommitted `packages/` change is the same defect class).
- **D-2: Unpushed-commit scope.** (a) Current branch vs its upstream only; cost: misses
  local `main` ahead of `origin/main` when the primary is on another branch. (b) Also local
  `main` vs `origin/main` — **recommended**, matches the issue text; cost: one extra ref compare.
- **D-3: Attended "dispatch anyway".** (a) Allowed, recorded — **recommended**; cost: a human can
  still produce a wrong-state run (but knowingly). (b) Not offered; cost: blocks tasks that
  legitimately don't depend on the local work.
- **D-4: Worktree-per-session reality.** Most sessions run in their own worktree, so the
  "primary" may be clean while a sibling worktree holds the work. Out of scope here unless the
  human wants sibling-worktree probing (`git worktree list`); cost of including: larger
  surface and false positives from other sessions' in-flight work.

## Acceptance Criteria

- AC-1: Primary with one uncommitted file under `specs/` → attended shows the path and counts;
  unattended returns `dirty-primary` and creates no worktree.
- AC-2: Primary with 2 unpushed commits → counted and reported; clean primary → dispatch
  proceeds with no prompt.
- AC-3: Branch with no upstream → reported as unknown, not clean.
- AC-4: Forced probe error (lock held) → typed fail-soft, no worktree.
- AC-5: Probe leaves primary branch name, HEAD SHA, index and worktree byte-identical.
- AC-6: "Dispatch anyway" is present on the OutcomeStore record and in the agent caveat count.
- AC-7: No network call is made by the probe (offline run passes).

## Risks

- R1: Noise fatigue leading humans to always override (mitigated by FR-2 wording and FR-6 audit).
- R2: Untracked build artefacts flagged as dirty (mitigate by honouring `.gitignore`, which
  `status --porcelain` already does).

## Follow-ups (tracked)

None beyond D-4, which awaits a decision.

## Traceability

Issue #463 · SPEC-019 FR-13 / FR-11 / CL-5 · DR-046 · #404/#429 (stranded approvals) · #430.
