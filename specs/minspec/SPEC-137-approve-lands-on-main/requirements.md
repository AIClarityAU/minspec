---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - an approval that never reaches main is a signpost that lies to every other branch
aspects: [approval, landing, stranded-approval, born-stale, pull-request, g8-git-transparency]
relates_to: [SPEC-050, SPEC-039, SPEC-029, SPEC-022, DR-034, DR-012, DR-071, DR-078, "#430", "#404", "#429"]
---

# MinSpec - Approve Spec lands on main (Requirements)

> Materializes **[#430](https://github.com/AIClarityAU/minspec/issues/430)** ("Approve Spec should also land the doc + sidecar on main"). Evidence trace: the SPEC-026/027 approvals sat local-only and re-blocked [#404](https://github.com/AIClarityAU/minspec/issues/404) until hand-landed via [#429](https://github.com/AIClarityAU/minspec/pull/429). Rests on [DR-034](../../../docs/decisions/DR-034.md) (committed sidecars are ground truth) and extends [SPEC-050](../SPEC-050-silent-approval-pr/requirements.md). Serves constitution goal G-8 (git transparency: no stranded approvals).

## One-Sentence Scope

Make an approval reach `main` by default without the human remembering a manual step, by closing the **gaps SPEC-050 and the existing commit/push settings leave open** - not by building a second landing path.

## Context (verified against code, not issue prose)

The issue proposes behaviour that is **largely already built**. Read before duplicating it:

- **Commit-on-approve exists and is on by default.** `minspec.commitOnApprove` defaults `true` (`packages/minspec/package.json:481-484`) and commits only the approval's own files, pathspec-safe (`packages/minspec/src/commands/commit-on-approve.ts`). The issue's "pathspec, never sweep the dirty checkout" requirement is already met.
- **Push-on-approve exists** (`minspec.pushOnApprove`, default `prompt`, `package.json:486-499`). On a protected branch it pushes a side branch at the same commit instead of attempting a rejected direct push.
- **PR-open-on-approve exists** (SPEC-050, `minspec.approvalPr`, default `auto`): `gh pr create --label docs-lane`, which the docs-lane workflow turns into an auto-merge. SPEC-050 frontmatter still reads `status: planning`; whether it is fully shipped must be confirmed in Plan (see Q-1), not assumed here.

So "Approve also lands on main" is **already the designed behaviour** whenever the human has answered `Push` and the docs-lane PR merges. Stranding therefore survives only through the residual paths below. I found no code (grep of `approve.ts`, `approve-commit.ts`, `approve-push.ts` for `origin/main`, `behind`, `stale`) implementing the issue's second proposal, the pre-mint freshness guard - stated as "found none by that vocabulary", not "does not exist".

**Residual gaps that still strand an approval:**

1. **G-1, the default is `prompt`.** An approval the human dismisses (or ignores) stays local-only. The notification is the only reminder, and nothing later re-surfaces the stranded approval. This is precisely how SPEC-026/027 were lost.
2. **G-2, no born-stale guard.** Approving from a working copy not at `HEAD == origin/main` mints a sidecar against a stale tree; the hash can then disagree with `main`'s bytes ([#404](https://github.com/AIClarityAU/minspec/issues/404), SPEC-029).
3. **G-3, no stranded-approval detector.** Nothing compares "approved sidecars committed locally" with "sidecars on `origin/main`", so a stranded approval is invisible until a gate reading committed sidecars fails on some other branch.
4. **G-4, batching/PR noise.** Each approval opens its own PR; approving several specs in a sitting produces several.

## Functional Requirements

- **FR-1 (stranded-approval detector, offline).** A deterministic check lists approvals whose sidecar exists in the local `HEAD` (or the working tree) but is absent or different on the remote-tracking ref of the default branch. It reads local refs only (no fetch); it reports "as of last fetch" with the ref's age. *Rationale: closes G-3 and covers every stranding cause, including ones this spec did not foresee.*
- **FR-2 (surface it, not just once).** The detector result is shown as a non-modal status-bar item or toast that persists until resolved, with a single action that runs the SPEC-050 push+PR path for exactly the stranded files. It never re-nags a dismissed session more than once per session. *Rationale: closes G-1 without changing the `prompt` consent default.*
- **FR-3 (pre-mint freshness guard).** Before `Approve Spec` writes a sidecar, compare `HEAD` to the remote-tracking default branch (local refs). If the working copy is behind, or the approved file differs from the remote-tracking copy, warn with the specific divergence and require an explicit override; it never fetches on its own (offline invariant). *Rationale: closes G-2; the staleness class of SPEC-029/#404.*
- **FR-4 (reuse, do not fork).** Landing goes through the existing `commit-on-approve` -> `approve-push` -> `approval-pr` path. No new commit, push or PR implementation (SPEC-050 FR-4).
- **FR-5 (batching).** Pending stranded approvals are landed together as one PR when the human acts on FR-2's action, instead of one PR per approval. The per-approval path stays available. *Rationale: closes G-4 without an "Approve & Open PR" duplicate command.*
- **FR-6 (consent unchanged).** No new network action without the existing consent: `pushOnApprove: never` means FR-2's action is never offered to push; FR-1 and FR-3 stay purely local.

## Invariants (must not break)

- **INV-1 (offline by default, constitution #1).** FR-1 and FR-3 make no network call; only the user-clicked action in FR-2 reaches the network, under `pushOnApprove` consent ([DR-071](../../../docs/decisions/DR-071.md)).
- **INV-2 (no silent gate, constitution #2).** An errored or unreadable remote-tracking ref is reported visibly ("could not determine"), never treated as "nothing stranded".
- **INV-3 (blast radius, constitution #3).** Everything is gated on the `.minspec/` opt-in marker; no machine-wide config is written ([DR-078](../../../docs/decisions/DR-078.md)).
- **INV-4 (never moves the primary checkout).** No checkout/switch/merge/rebase/reset of the developer's tree; pathspec commits only.
- **INV-5 (never mints or edits an approval).** Landing transports records `Approve Spec` wrote; it never writes `status`, a sidecar, or `approvedBy` (DR-012).
- **INV-6 (no direct push to a protected branch).** Landing on `main` always means branch + PR, never a direct push.

## Acceptance Criteria

- **AC-1.** Given a committed-locally sidecar absent from `origin/main`, the detector lists it; given identical bytes on both, it lists nothing.
- **AC-2.** With the remote-tracking ref missing or unreadable, the detector reports "could not determine", not an empty result.
- **AC-3.** Dismissing the FR-2 notice leaves the status item visible; the action opens one PR covering all stranded files.
- **AC-4.** Approving when `HEAD` is behind the remote-tracking default branch shows the FR-3 warning naming the divergence; the override proceeds and records nothing different in the sidecar.
- **AC-5.** With `pushOnApprove: never`, no push/PR is offered and no network call occurs.
- **AC-6.** Existing SPEC-050 and SPEC-039 tests pass unchanged.

## Out of scope

- Changing the `pushOnApprove` default from `prompt` (DR-071 condition 1).
- Enabling auto-merge from the extension (the docs-lane workflow owns it).
- A new "Approve & Open PR" command (see Decision D-2).

## Decisions needed (Clarify)

- **D-1 - how much of the issue is already shipped?** SPEC-050 is `status: planning` but its code appears present. **Option A (rec):** treat SPEC-050 as the landing mechanism and scope this spec to FR-1..FR-3, FR-5 (above). Cost: depends on SPEC-050's real state; if it is not shipped, this spec is blocked on it. **Option B:** fold these FRs into SPEC-050 as an amendment. Cost: re-approval of an already hash-locked spec.
- **D-2 - landing on approve vs on demand.** **Option A (rec):** keep per-approval push consent as today and add the persistent detector + batched action (FR-2/FR-5). Cost: still one human click to land. **Option B:** an "Approve & Open PR" variant that lands immediately. Cost: a second entry point and PR noise on frequent approvals, which the issue itself flags.
- **D-3 - freshness guard strictness.** **Option A (rec):** warn with explicit override (FR-3). Cost: a determined user can still mint a stale approval. **Option B:** hard block until `HEAD == origin/main`. Cost: blocks legitimate offline approvals and approvals on feature branches.
- **D-4 - spec id.** `SPEC-137` is the next unused id on disk; open pull requests are invisible from this checkout, so confirm no collision at approval.

## Open Questions

- **Q-1.** Is SPEC-050 implemented end to end (`approval-pr.ts` seam, `minspec.approvalPr`, tests)? Plan must verify by code, not frontmatter.
- **Q-2.** Where does the stranded-approval check run - on activation, on focus, or only on approve? (Latency vs freshness; resolve in Plan.)

## Traceability

Issue [#430](https://github.com/AIClarityAU/minspec/issues/430); evidence [#404](https://github.com/AIClarityAU/minspec/issues/404), [#429](https://github.com/AIClarityAU/minspec/pull/429); rationale DR-034, DR-071, DR-078; sibling specs SPEC-050 (PR-open), SPEC-039 (docs-lane push), SPEC-029 (staleness UX). No new DR: no choice here is irreversible in under a day.
