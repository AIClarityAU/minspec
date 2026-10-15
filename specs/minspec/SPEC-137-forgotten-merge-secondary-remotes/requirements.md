---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness — concurrent multi-session coordination
relates_to: [SPEC-032, SPEC-028, SPEC-024, SPEC-012]  # discovery being extended · action layer (consumes verdicts) · done-ness signal set · signpost surface
---

# MinSpec — Forgotten-Merge Discovery: Secondary Remotes & Forks (Requirements)

**Date:** 2026-10-16
**Status:** Specifying (awaiting human read of the Clarify decisions below)
**Issue:** [#550](https://github.com/AIClarityAU/minspec/issues/550) — parked from SPEC-028 Clarify OQ-2 (2026-07-06).
**Extends:** [SPEC-032](../SPEC-032-forgotten-merge-discovery/requirements.md) FR-1 / FR-2 (discovery). SPEC-032 stays the owner of v1 (`origin`-only); this spec is purely additive and changes nothing for a repo with a single remote.
**Design rests on:** no DR yet; none needed unless Decision D3 is answered "auto-fetch".

## Context

SPEC-032 FR-1/FR-2 enumerate local branches plus `origin/*` only; Non-Goals excluded other remotes. A dev working from a fork has `origin` = their fork and `upstream` = the canonical repo; a maintainer may have a collaborator's fork added as a remote. Branches that exist only there are invisible to the inbox, which is the very failure SPEC-032 INV-1 exists to prevent ("forgotten = invisible"). This spec widens the candidate set to **already-configured** secondary remotes.

## Non-Goals

- **Adding remotes.** Only remotes already in the user's git config are considered; MinSpec never runs `git remote add` (constitution invariant 3 — blast radius; INV-3 read-only).
- **Discovering forks via a forge API** (listing a repo's forks on GitHub). Needs network + credentials beyond `git fetch`; invariant 1.
- **Acting on secondary-remote branches** (merge/delete/rebase) — still SPEC-028's concern, and see FR-6.
- Changing v1 behaviour for a repo whose only remote is `origin`.

## Requirements

**FR-1 — Remote set.** Discovery computes the remote set from `git remote` (local config, no network). Default set = `{origin}` (v1 behaviour, unchanged). A secondary remote is included only if it passes the opt-in rule in Decision D1.

**FR-2 — Fetch each included remote.** For every included remote run `git fetch --prune <remote>` (SPEC-032 FR-1 semantics per remote). Fetch is the only mutation (SPEC-032 INV-3). Remotes are fetched independently: one failing remote must not block or hide the others.

**FR-3 — Enumerate the union.** Candidate set = SPEC-032 FR-2 union extended with `<remote>/*` tracking refs for each included remote, minus current branch, minus anything merged into the default base, minus each remote's `HEAD` symref.

**FR-4 — Per-remote honesty (extends SPEC-032 INV-1).** Each candidate carries its remote. A remote whose fetch failed, was never fetched, or was skipped is listed explicitly as stale/partial/skipped with the reason; the result is never presented as complete while any included remote is stale. A configured-but-excluded remote is reported as "not scanned" (never silently omitted).

**FR-5 — De-duplication across remotes.** The same commit tip reachable on several remotes (e.g. `origin/feat` and `upstream/feat`) yields ONE candidate listing all remotes; a same-named branch with a different tip yields separate candidates labelled by remote. De-duplication is a pure function of (ref name, tip SHA).

**FR-6 — Classification and done-ness unchanged in kind.** SPEC-032 FR-3 classification and FR-5/6 done-ness apply as-is, with the remote added as a classifier input: a branch on a non-`origin` remote is never classified `your-own` by name alone (author identity must match). PR/CI signals (SPEC-024) are looked up against the repo that owns the remote; where that cannot be resolved offline, signals are `none`/unknown and the verdict cannot be `ready` (fail toward `needs-attention`, not toward merge).

**FR-7 — Surface.** The signpost section (SPEC-032 FR-8) shows the remote on each row and a one-line scan summary ("scanned: origin, upstream · not scanned: alice-fork"). Keyboard paths are unchanged.

**FR-8 — Action gate.** Merge actions in SPEC-028 on a candidate whose only remote is non-`origin` MUST be single-merge only (never in "merge all clean"), pending Decision D2.

## Invariants

- **INV-1 — Read-only.** The only mutation is `git fetch` of an already-configured remote. No remote is added, edited, or removed.
- **INV-2 — Offline-safe, opt-in network.** No network call to a remote the user has not opted into (constitution invariant 1).
- **INV-3 — Single-remote repos are byte-identical to v1.** Same candidates, same labels, same fetch commands.
- **INV-4 — No silent partial.** Per-remote staleness/skip is always visible (SPEC-032 INV-1; constitution invariant 2).
- **INV-5 — Pure core.** Remote selection, de-dup and classification are Tier-0 pure functions of their inputs.

## Acceptance Criteria

1. Repo with `origin` + `upstream`; a branch exists only on `upstream` and the user opted in → it appears, labelled `upstream`.
2. Same tip on `origin` and `upstream` → one row listing both remotes.
3. `upstream` fetch fails (offline/auth) → `origin` results still shown; `upstream` listed stale/failed; result flagged partial.
4. Configured remote not opted in → not fetched (assert no fetch command issued), listed "not scanned".
5. Repo with only `origin` → output and git commands identical to SPEC-032 (regression test).
6. Non-`origin`-only candidate is excluded from "merge all clean" (pending D2).
7. Viewing the surface adds/edits no remote and mutates nothing beyond `git fetch`.

## Decisions needed (Clarify)

**D1 — Which secondary remotes are scanned by default?**
- (a) **Explicit allowlist in `.minspec/config.json`** *(recommended)* — default none, so v1 behaviour is unchanged and no surprise network traffic. Cost: a fork-based dev must configure once or sees only `origin` (mitigated by FR-4's "not scanned" line naming the exact setting).
- (b) All configured remotes by default — zero setup, but fetches from every remote someone ever added (including stale personal forks, possibly credentialed), violating the spirit of invariants 1 and 3.
- (c) Only remotes named `upstream` by convention — fewer surprises, but a naming heuristic that misses real setups.

**D2 — May non-`origin` branches be bulk-merged?**
- (a) **No — single-merge only** *(recommended)*; reflects that a fork's branch is another party's code with weaker provenance. Cost: slower for a maintainer merging many fork PRs.
- (b) Yes under the same SPEC-028 gates — consistent, but extends outward-facing bulk action to less-trusted sources without a separate approval.

**D3 — Fetch trigger.**
- (a) **Fetch only the allowlisted remotes when the inbox is opened/refreshed** *(recommended)* — same trigger as v1. Cost: a slow remote slows refresh (mitigate with a per-remote timeout showing stale).
- (b) Background periodic fetch — fresher, but network activity the user did not trigger; would need a DR and consent UX.

**D4 — PR/CI signals for fork remotes.** Resolved against the remote's own repo URL via the forge (needs credentials/network) or left `unknown` offline? Recommendation: `unknown` unless the user already has forge access configured for SPEC-024 — Cost: fork branches rarely reach `ready`, acceptable given FR-6's fail-safe.

## Traceability

- **Issue:** [#550](https://github.com/AIClarityAU/minspec/issues/550). **Parent:** SPEC-032 OQ-2 (resolved: follow-up). **Action layer:** [SPEC-028](../SPEC-028-forgotten-merge-inbox/requirements.md).
- **Sequencing:** implement only after SPEC-032 v1 ships (its status is `implementing` at this writing).
- **Follow-ups (tracked):** None.
