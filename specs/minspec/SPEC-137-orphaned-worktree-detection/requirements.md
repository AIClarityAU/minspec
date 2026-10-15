---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - a worktree nobody owns is lost work the methodology cannot see
aspects: [worktree, orphan-detection, session-presence, footer, tier-0, offline, advisory, no-silent-gate, blast-radius]
depends_on: [SPEC-026, DR-004, DR-046]  # SPEC-026 owns the presence record this reads; DR-004 the offline tier; DR-046 the worktree-per-session rule
relates_to: [SPEC-044, SPEC-136, "#272", "#168"]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Orphaned-worktree detection + open-worktree surfacing

Tracks **[#272](https://github.com/AIClarityAU/minspec/issues/272)**. Related: #168 (concurrent-session/worktree corruption guardrail), SPEC-026 (session presence), SPEC-044 (its auto-wrapup prunes merged worktrees only; this spec covers the unmerged ones it leaves alone).

## Scope sentence

Cross-check `git worktree list` against live session presence records and report every worktree with no live owner (an **orphan**) with its branch and unmerged state, offline and advisory-only; separately, name the session's own open worktree in a one-line response footer. The session-title icon is split out (see Decisions needed).

## Context

On 2026-06-23 PR #192's worktree (`spec-022-approval-foundation`) was left by a session that looked finished but was not (Specify+Plan+Implement done, never merged). A new session on `main` could not see the unmerged branch and nearly duplicated the whole spec, colliding a spec number. Nothing in the repo compared worktrees to sessions.

## Existing building blocks (verified in code)

- `SessionPresenceRecord` already carries `branch`, `worktreeRoot`, `pid`, `lastSeen` ([presence.ts:56-67](../../../packages/minspec/src/lib/presence.ts#L56)); a record is live iff `lastSeen` is within `STALE_SECS` and the pid is alive ([presence.ts:32-33](../../../packages/minspec/src/lib/presence.ts#L32)). No new liveness primitive is needed.
- Worktrees live at `~/code/.worktrees/<repo>/<name>/` ([scripts/new-worktree.sh](../../../scripts/new-worktree.sh)); headless dispatch worktrees live elsewhere (e.g. `/tmp/minspec-agent/...`), so the standard location cannot be the orphan test.
- A session-title hook exists (`.claude/hooks/session-title.sh`); not read in depth for this spec, so FR-9 is held to Clarify.

## Functional requirements

- **FR-1 (inventory).** A pure function takes the parsed output of `git worktree list --porcelain` and the set of presence records, and returns one row per worktree: path, branch (or detached HEAD), `live` owner session id or none. Matching key is the worktree root path, compared after realpath normalisation (reuse the same-checkout comparison in presence.ts, `SameCheckoutDeps`).
- **FR-2 (orphan = no live owner).** A worktree is an orphan iff it is not the primary checkout, and no presence record for it is live under SPEC-026's predicate. A worktree whose only record is stale or dead-pid is an orphan. A worktree with a live record is never reported.
- **FR-3 (state per orphan).** Each orphan row reports, from local git only: commits ahead of the base branch, uncommitted changes (dirty), and whether its branch is merged into the base. Rows are classed `finished` (clean, merged), `unmerged-work` (ahead and/or dirty), or `unknown` (git failed).
- **FR-4 (PR state is optional and consented).** PR number/state is shown only if already present in local refs/config without a network call; fetching it from GitHub is a networked, consent-gated enhancement and is not part of the Tier-0 core (invariant 1).
- **FR-5 (surface).** Orphans are surfaced on demand through a Command Palette entry ("MinSpec: Show Orphaned Worktrees") and once at session start as a single advisory line when at least one `unmerged-work` orphan exists. Zero orphans prints nothing.
- **FR-6 (offer, never act).** For each orphan the UI offers resume (open it), inspect, or remove. Remove is offered only for `finished` rows and requires an explicit confirmation; MinSpec never deletes a worktree, branch, or file on its own. `unmerged-work` rows offer no remove action.
- **FR-7 (fail visibly).** If `git worktree list` fails or a presence record is unreadable, the report states which input failed and lists nothing as clean. An unreadable record is treated as "owner unknown", not as "no owner", so a live worktree is not mislabelled orphan on a read error.
- **FR-8 (response footer).** When the current session's working directory is a non-primary worktree, a one-line footer names the worktree and branch, in the same italic advisory form as the Scrooge model-fit line in CLAUDE.md. Outside a worktree nothing is emitted. Advisory only, never blocks.
- **FR-9 (session-title icon).** Held for Clarify: whether and how an icon marks the session title (see Decisions needed). If adopted, the same glyph is used in the FR-8 footer.
- **FR-10 (opt-in boundary).** Everything above runs only in a repo with `.minspec/` at its root (invariant 3). Nothing writes to user-level or other repos' config, and the session-start line and footer are absent in a non-opted-in repo.

## Acceptance criteria

- **AC-1.** Given a worktree whose presence record is live, FR-2 reports no orphan for it; given the same record with `lastSeen` older than `STALE_SECS`, it reports one.
- **AC-2.** The #192 shape (a worktree with unmerged commits and no record) is classed `unmerged-work`, appears in the session-start line, and offers no remove action.
- **AC-3.** A merged, clean, ownerless worktree is classed `finished` and offers remove only after confirmation.
- **AC-4.** With `git` failing, the report shows a failure message and zero "clean" rows (FR-7).
- **AC-5.** The module imports no `http`/`https`/`fetch`/`net` (the Tier-0 import-ban test passes).
- **AC-6.** In a repo without `.minspec/`, no command, line, or footer is produced.
- **AC-7.** The footer appears only inside a non-primary worktree and names its branch.

## Invariants this change must not break

1. Offline: detection uses local git and local presence files only; no network call without consent (invariant 1).
2. No silent gate: a failed or unreadable input fails visibly and never reads as "no orphans" (invariant 2, FR-7). This feature is advisory and gates nothing.
3. Blast radius: runs only where `.minspec/` exists and touches nothing outside the project (invariant 3, FR-10).
4. Never destructive: no automatic removal, reset, or checkout; a worktree with unmerged work is never offered for deletion (DR-046, #168).

## Out of scope

Auto-finishing or auto-merging an orphan's work; networked PR lookup (FR-4 follow-up); coordinating who resumes an orphan (SPEC-044's lease owns that).

## Decisions needed (Clarify)

1. **Where the footer is emitted.** (a) **(rec)** a Claude Code hook that appends the line, deterministic and enforced, but the cost is a new harness hook surface to ship and keep in sync; (b) a CLAUDE.md prose rule like the Scrooge advisory, cheap, but model-trusted and will drift (constitution: enforce, don't trust the model).
2. **Session-title icon (FR-9).** (a) **(rec)** defer to a separate spec once the existing title hook is read and shown able to carry a glyph, the cost being that the issue's second ask ships later; (b) build it here, but I have not verified the Claude Code title can be set per-session from a hook.
3. **Orphan session-start line: warn on every start or once per orphan?** (a) **(rec)** every start while an `unmerged-work` orphan exists, so it cannot be forgotten, at the cost of nagging; (b) once per orphan, quieter, but a dismissed warning can hide lost work again.
4. **Headless dispatch worktrees (`/tmp/minspec-agent/...`).** (a) **(rec)** include them, since a crashed dispatch is a real orphan, at the cost of noise from in-flight dispatches whose records are briefly stale; (b) exclude paths outside `~/code/.worktrees/`, quieter but misses crashed dispatches.
