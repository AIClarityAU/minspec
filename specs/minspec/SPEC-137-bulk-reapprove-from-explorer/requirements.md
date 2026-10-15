---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - approval staleness UX
aspects: [ux, approval, explorer, hitl]
depends_on: [SPEC-029, DR-012]
relates_to: [SPEC-017, SPEC-022, SPEC-046, "#664"]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Approve everything under "Needs Re-Approval" in one gesture, from the explorer pane

Issue: #664 (bulk-approve specs/DRs needing re-approval from explorer pane). Builds on SPEC-029 (the pinned "Needs Re-Approval" group) and DR-012 (approving is an explicit human act).

## In plain terms

When many specs go stale (a template or shared-section edit touches a dozen), the only route today is right-click, Approve Spec, once per row. The issue asks for a right-click on the "Needs Re-Approval" group heading that approves everything under it. The risk is that a bulk gesture turns approval into a rubber stamp. So the design keeps the human act real: one confirmation that lists exactly what will be approved and what changed, and nothing is approved that the user was not shown.

## Context (verified against code)

- The group is `SpecGroupNode` with `kind: 'needsReapproval'` and `contextValue = 'specGroup'` (`packages/minspec/src/views/spec-tree-provider.ts:62,85`); members are non-terminal specs whose approval resolves `stale` (`:464-471`).
- Per-row approve is `minspec.approveSpec`, bound to `specNode` / `specNode.stale` rows in `view/item/context` (`packages/minspec/package.json:393-402`); its handler is `approveSpecCommand` (`packages/minspec/src/commands/approve.ts:221`), which runs validation and may raise modal errors (`:290,319,353`).
- The group's `contextValue` is `specGroup` for BOTH status groups and the re-approval group, so a menu cannot yet target only the re-approval group.
- The DR tree (`adr-tree-provider.ts`) has no "Needs Re-Approval" group today (only `adrNode.proposed` accept, `package.json:414`). "Stale DR" language appears only in folder-cache comments (`adr-tree-provider.ts:199`). I believe DR approval is a status flip (proposed to accepted) with no hash-staleness; unverified, see Decision D1.

## Functional requirements

- **FR-1 (menu on the group only).** Right-clicking the Needs Re-Approval group heading offers "Approve All (N)". It does not appear on status groups, spec rows, or other views. The re-approval group gets a distinct `contextValue` (for example `specGroup.needsReapproval`) and existing `specGroup` menus keep matching it.
- **FR-2 (one review step, not a rubber stamp).** Invoking it opens ONE non-modal-or-modal confirmation (see D2) listing every spec that will be approved, with its id, title and a way to open its "Show Changes Since Approval" diff (SPEC-029 FR-5). Nothing is approved until the user confirms.
- **FR-3 (per-spec deselect).** The user can exclude individual specs from the batch before confirming; excluded specs stay stale and in the group.
- **FR-4 (same gate per spec).** Each included spec goes through exactly the code path of `approveSpecCommand` (same validation, same approval record, same hash). Bulk is a loop over the existing approval, never a second approval implementation.
- **FR-5 (validation failures do not abort the batch, and are not swallowed).** A spec that fails approval validation is skipped, left stale, and reported in a final summary with its error. Other specs still approve. No failure is best-effort-hidden (invariant 2).
- **FR-6 (summary).** After the run, one message: "Approved X of N; Y skipped (reasons)". Skipped items remain in the group.
- **FR-7 (single commit/write batching).** Approval side effects (sidecar writes, commit-on-approve per `commit-on-approve.ts`) run once per spec as today, or once for the batch if D3 is chosen; either way no spec is left half-approved (frontmatter and sidecar both land or neither).
- **FR-8 (identity).** The approval is recorded for the human who confirmed. An agent or script path must never invoke bulk approve (no borrowed-identity approval); the command is UI-triggered only and refuses when invoked headless.
- **FR-9 (palette parity).** A palette command "MinSpec: Approve All Needing Re-Approval" runs the same flow, so the feature is not mouse-only.
- **FR-10 (offline, scoped).** No network calls (invariant 1). Only specs inside the opted-in `.minspec/` root of the folder owning the group are touched (invariant 3); in a multi-root workspace the group of one folder never approves another folder's specs.

## Decisions needed (Clarify)

- **D1 - DRs in scope?** The issue says "specs & DRs". DRs have no stale-approval state today (see Context).
  - (a) **(rec)** Specs only in this spec; file a follow-up if DR staleness is ever introduced. Cost: partially misses the issue's wording.
  - (b) Add a DR "Needs Re-Approval" group first, then bulk-approve both. Cost: a new staleness concept, larger tier (T4), needs its own DR.
  - (c) Bulk "Accept all proposed" on the DR pane. Cost: different meaning (proposed to accepted is a first approval, not re-approval) and weaker review of new decisions.
- **D2 - How strong is the confirmation?**
  - (a) **(rec)** Modal checklist (QuickPick with multi-select, all pre-ticked, diff action per item). Cost: one extra click versus the issue's literal "bulk-approve"; modal steals focus (DR-012 favours the explicit act, but the HITL-UX preference is non-modal over a visible artifact).
  - (b) Single modal "Approve N specs?" with no per-item list. Cost: rubber-stamp risk; user approves content never shown.
  - (c) No confirmation (the right-click is the act). Cost: one mis-click approves everything; weakest of the three.
- **D3 - Commit behaviour.** If `commit-on-approve` is enabled: (a) **(rec)** one commit per spec, as today (cost: N commits, noisy but each revertable); (b) one commit for the batch (cost: couples unrelated specs in one revert unit).
- **D4 - Approval cap.** Optional upper bound (e.g. warn above 25 specs). Recommend no cap in v1; cost: huge batches approve with little scrutiny.

## Acceptance criteria

- AC-1: With 3 stale specs, the group menu shows "Approve All (3)"; it is absent on status groups and spec rows. (FR-1)
- AC-2: Cancelling the confirmation approves nothing and changes no file. (FR-2)
- AC-3: Deselecting one spec leaves it stale and still listed; the other two become approved with hashes equal to what per-row Approve would have written. (FR-3, FR-4)
- AC-4: One spec failing validation: the other two approve; the summary names the failed one and its error; it remains stale. (FR-5, FR-6)
- AC-5: Invoked with no confirming UI (headless/agent path) it approves nothing and reports why. (FR-8)
- AC-6: In a two-folder workspace, bulk approve in folder A never changes folder B's specs. (FR-10)
- AC-7: The palette command yields the same result as the context menu. (FR-9)
- AC-8: Empty group: no menu entry shown (group is non-empty-only per SPEC-029 FR-4).

## Invariants this must not break

- Approval stays an explicit human act (DR-012); no path approves without the user's confirmation.
- No silent gate: per-spec failures are visible (invariant 2).
- Offline, no network (invariant 1); blast radius limited to the opted-in project (invariant 3).
- The approval hash and record are produced by the single existing implementation (FR-4); no parallel hashing.
- SPEC-029 behaviour of the group (live, non-empty-only, default-expanded) is unchanged.

## Out of scope

- Auto-approval without human confirmation (SPEC-046 covers narrow PO-only cases separately).
- Bulk approval of design.md / tasks.md sidecars beyond what per-row Approve already covers.
- Bulk revoke.

## Follow-ups (tracked)

- DR staleness group, if D1(b) is later wanted: not filed; filed only if the human chooses (b).
