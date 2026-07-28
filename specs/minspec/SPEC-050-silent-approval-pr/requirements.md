---
id: SPEC-050
type: requirements
# 🔒 Once approved, hash-locked: approved bytes recorded in the per-file sidecar
# .minspec/approvals/specs/minspec/SPEC-050-silent-approval-pr/requirements.md.json (.specHash).
# RULE (state-independent): `status` is a tool-written mirror of the DERIVED lifecycle status,
# written ONLY by "MinSpec: Approve Spec" (approve.ts:284) together with the sidecar. An agent
# must never hand-write either. Read the sidecar, never this prose, for the current state.
status: specifying
tier: T2
product: minspec
epic: EPIC-009  # Team Readiness — docs-lane push ergonomics; grain (b) of #575/#781, the sibling of SPEC-039's grain (a)
aspects: [approval, docs-lane, pull-request, auto-merge, consent, tier-1, hitl, g8-git-transparency]
relates_to: [SPEC-039, DR-051, DR-060, DR-061, DR-012]
implements: [packages/minspec/src/lib/approval-pr.ts, packages/minspec/tests/approval-pr.test.ts]
# ownership (SPEC-038): approval-pr.ts is net-new and owned here. commit-on-approve.ts is
# existing, undeclared-by-any-spec code this spec restructures — declared implements: to take
# primary ownership (the SPEC-043/044 pattern for existing-but-owned code).
# push-docs-lane.ts / approve-push.ts are REUSED seams (SPEC-039's and the Alt+A push path's):
# modifies-not-owns, so they sit in affects:.
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Silent approval PR (Requirements)

> Materializes **[#788](https://github.com/AIClarityAU/minspec/issues/788)** ("wire ext Alt+A commit-on-approve to the docs-lane"), the grain **[SPEC-039](../SPEC-039-push-docs-lane-command/requirements.md) explicitly deferred**: *"auto-on-approve (#788) is deferred."* Traces to a founder UX report of 2026-07-28 after approving SPEC-042 on the 0.1.24 build. Serves constitution goal **[G-8 — git transparency](../../../.minspec/constitution.md#L47)**: *"MinSpec handles git for the developer … a non-git-literate dev never has to understand or resolve branches, rebases, stranded approvals, or push rejections."*

## One-Sentence Scope

When an approval commit has been pushed to a side branch because the current branch is protected, **finish the job**: open the `docs-lane` PR automatically (which the existing workflow turns into an auto-merge), instead of handing the developer a compare URL and a browser form — governed by a new per-developer setting whose default is automatic and whose `manual` value preserves today's behaviour exactly.

## Context

Grounded in the current code, with `file:line` evidence.

- **The approval flow already pushes; it stops one step short.** [`pushApprovalIfEnabled`](../../../packages/minspec/src/commands/commit-on-approve.ts#L90) runs the push, and on a protected branch [`pushApproval`](../../../packages/minspec/src/lib/approve-push.ts#L169) returns `outcome: 'pushed-branch'` with a `compareUrl` ([approve-push.ts:146-150](../../../packages/minspec/src/lib/approve-push.ts#L146)). The handler then shows a notification whose only action opens that URL in a browser ([commit-on-approve.ts:120-133](../../../packages/minspec/src/commands/commit-on-approve.ts#L120)):

  ```ts
  `Approval pushed on '${result.branch}' (this branch is protected, so it needs a PR).`,
  'Open PR',
  …
  if (c === 'Open PR') void vscode.env.openExternal(vscode.Uri.parse(url));
  ```

  Its inline comment reads *"opening the PR is one click."* In practice it is a browser round-trip **plus GitHub's PR-creation form**. No `gh pr create` runs anywhere on this path.

- **The resulting PR does not auto-merge, because nothing labels it.** Live instance [#1035](https://github.com/AIClarityAU/minspec/pull/1035): `labels: ai-review:pending`, `automerge: none`, `merge: BLOCKED`. Both of its files — `.minspec/approvals/…/requirements.md.json` and `specs/…/requirements.md` — match the lane allowlist verbatim ([docs-lane.yml:41](../../../.github/workflows/docs-lane.yml#L41): `^(specs/|docs/|skills/.*\.md$|\.minspec/approvals/|[^/]+\.md$)`). It **qualified** for the lane and was simply not labelled; a human added the label by hand to unblock it.

- **Labelling is the whole of "auto-merge".** [`docs-lane.yml:30`](../../../.github/workflows/docs-lane.yml#L30) gates on `contains(github.event.pull_request.labels.*.name, 'docs-lane')` and the job then verifies docs-only paths before enabling auto-merge ([:33](../../../.github/workflows/docs-lane.yml#L33), [:57](../../../.github/workflows/docs-lane.yml#L57)). A mislabelled non-docs PR is **refused loudly** with a comment and no auto-merge ([:52-54](../../../.github/workflows/docs-lane.yml#L52)). So this spec never needs to call `gh pr merge --auto` itself, and cannot cause a code change to ride the lane.

- **The PR-creation machinery already exists.** SPEC-039's [`push-docs-lane.ts`](../../../packages/minspec/src/commands/push-docs-lane.ts) already builds a temp worktree, pushes, and runs `gh pr create --label docs-lane`, with a typed outcome union covering `gh-absent`, `gh-unauthenticated`, `offline`, `failed` ([:61-64](../../../packages/minspec/src/commands/push-docs-lane.ts#L61)) and a bounded-timeout `git`/`gh` runner ([:43](../../../packages/minspec/src/commands/push-docs-lane.ts#L43)). This spec **reuses** that seam rather than growing a second PR-opening path.

- **The consent model is already articulated and already covers the network.** `minspec.pushOnApprove` is a tri-state (`never` | `prompt` | `always`, default `prompt`) whose documented semantics are: `never` — no git, no network; `prompt` — *"the click is the explicit consent"*; `always` — *"the user set this deliberately; the setting is the consent"* ([commit-on-approve.ts:78-88](../../../packages/minspec/src/commands/commit-on-approve.ts#L78)). **The network boundary is crossed by the push, which this spec does not change.** Opening a PR for a branch that has already been pushed is the same authorized act completing, not a new boundary — which is why this spec does not need to weaken constitution invariant #1 (see INV-1 and OQ-1).

**Core gap (one sentence):** every approval on a protected branch costs the developer a toast, a browser trip, a PR form, and a manual label — for a record they already signed with one keystroke, and which the lane would have merged untouched.

## Functional Requirements

- **FR-1 (new setting, automatic by default).** A new setting `minspec.approvalPr` with values `auto` (**default**) and `manual`, `scope: window`. `auto` — after a successful `pushed-branch`, MinSpec opens the PR itself. `manual` — today's behaviour exactly: the notification with the `Open PR` action and the compare URL, unchanged. *Rationale: the founder's stated preference is automatic; a developer who wants to hand-drive keeps a one-value opt-out.*
- **FR-2 (open the PR, labelled for the lane).** On `outcome: 'pushed-branch'` with `approvalPr: auto`, run `gh pr create` against the pushed branch with `--label docs-lane`, a deterministic title (`chore(approve): <SPEC-ID> approved for implementation`, matching the commit subject) and a body naming the approved artifact, its tier, and the approver email from the record. *Rationale: the label is what the lane keys on ([docs-lane.yml:30](../../../.github/workflows/docs-lane.yml#L30)); auto-merge follows without MinSpec asking for it.*
- **FR-3 (no interactive toast in the happy path).** Success surfaces as a **non-blocking** informational notification carrying the PR URL, or as a status-suffix — never a prompt requiring a click to complete the operation. *Rationale: the reported defect is that the completion step is handed back to the human.*
- **FR-4 (reuse SPEC-039's seam, do not duplicate it).** PR creation goes through the shared `git`/`gh` runner and typed-outcome machinery already in [`push-docs-lane.ts`](../../../packages/minspec/src/commands/push-docs-lane.ts), extracted to a seam both callers use. No second `gh pr create` implementation. *Rationale: one PR-opening path means one place where timeout, offline, and auth handling are correct.*
- **FR-5 (graceful degrade to today's behaviour).** `gh` absent, unauthenticated, offline, or `gh pr create` failing → fall back to **exactly** the FR-1 `manual` surface (notification + `Open PR` + compare URL) with a short reason appended. Never a thrown exception, never a silent nothing. *Rationale: SPEC-039 INV-4; the branch is already pushed, so the approval is safe either way and the developer must be told the PR was not opened.*
- **FR-6 (idempotent).** If an open PR already exists for the branch, adopt it (report its URL) rather than creating a second one. *Rationale: a re-approval that reuses a branch must not fan out duplicate PRs.*
- **FR-7 (`pushed` outcome untouched).** When the push went straight to a non-protected branch (`outcome: 'pushed'`), no PR is created — there is nothing to open. *Rationale: the PR exists only because a protected branch refuses a direct push.*

## Invariants

- **INV-1 (no new network boundary).** This spec adds **no** network action that `minspec.pushOnApprove` had not already authorized: it runs only after a **successful push** on the same approval act. With `pushOnApprove: never` — or when the user declines the `prompt` — **nothing here ever runs**. Constitution [invariant #1](../../../.minspec/constitution.md#L5) is preserved unchanged, not reinterpreted.
- **INV-2 (never a non-docs PR).** MinSpec labels `docs-lane` only for a branch whose changed paths are entirely within the lane allowlist; the workflow independently re-verifies and refuses loudly otherwise ([docs-lane.yml:52-54](../../../.github/workflows/docs-lane.yml#L52)). Two independent checks, and code physically cannot ride the lane.
- **INV-3 (never moves the primary checkout).** No `checkout`, `switch`, `merge`, `rebase` or `reset` on the developer's working tree; the approval commit and its branch already exist. (Worktree rule [DR-046](../../../docs/decisions/DR-046.md) / rule #8.)
- **INV-4 (never mints or edits an approval record).** This spec transports a record that **MinSpec: Approve Spec** already wrote. It never writes `status`, never writes a sidecar, never sets `approvedBy` ([DR-012](../../../docs/decisions/DR-012.md), and the forged-sign-off class of [#1025](https://github.com/AIClarityAU/minspec/issues/1025)).
- **INV-5 (never throws).** Every failure mode returns a typed result surfaced as an advisory notification (SPEC-039 INV-4). An approval must never be lost or obscured by a PR-opening failure.

## Vertical slices (thinnest-first; ordering is load-bearing)

1. **Slice 1 — the seam.** Extract the shared `gh pr create` + typed-outcome seam from `push-docs-lane.ts` into `approval-pr.ts`, with SPEC-039's command as its first caller and no behaviour change. Pure refactor, fully unit-tested against a stub runner.
2. **Slice 2 — auto-open on approve.** Add `minspec.approvalPr`, wire the `pushed-branch` branch of [commit-on-approve.ts:120](../../../packages/minspec/src/commands/commit-on-approve.ts#L120) to the seam, non-blocking success notification, full degrade path (FR-5) and idempotency (FR-6).

## Out of scope (tracked elsewhere)

- **Changing `pushOnApprove`'s default** from `prompt` to `always` — a genuine consent-model change, deliberately excluded here (see OQ-1).
- **Enabling auto-merge from the extension** — the lane workflow does it on the label; MinSpec calling `gh pr merge --auto` would duplicate a gate and bypass its docs-only re-verification.
- **The AI panel's false forgery verdict** on approval PRs — [#1025](https://github.com/AIClarityAU/minspec/issues/1025), fix in flight at [#1026](https://github.com/AIClarityAU/minspec/pull/1026). Independent of this spec, but note that until it lands each auto-opened PR still draws a false blocking review, so this spec removes only one of the two frictions.
- **Approval PRs for non-docs artifacts** — nothing outside the lane allowlist may be auto-labelled (INV-2).

## Open Questions

- **OQ-1 (should `pushOnApprove`'s default become `always`?).** With `prompt` (today's default), the developer still clicks once per approval — so "silent by default" holds only *after* that click. Flipping the default to `always` would make the whole flow silent, but it makes a **network call the default with no per-action consent**, which is a constitution invariant #1 question, not a UX preference. *Proposed:* **keep `prompt` as the default in this spec**; the click that authorizes the push is a reasonable single consent point, and this spec removes every step after it. Revisit as its own change with its own DR if the founder wants full silence. Resolve in Clarify.
- **OQ-2 (PR body content).** Should the body embed the approval record (hash, approver, tier) for reviewer provenance — which would help [#1026](https://github.com/AIClarityAU/minspec/pull/1026)'s panel — or stay minimal? *Proposed:* include hash, tier, approver and the commit SHA, since the panel demonstrably cannot derive provenance from a diff. Resolve in Clarify.
- **OQ-3 (`manual` vs reusing `pushOnApprove`).** Should this be its own setting, or a fourth `pushOnApprove` value? *Proposed:* **its own setting** — the two axes are independent (whether to push; what to do once pushed), and overloading one enum makes `never`/`prompt`/`always`/`auto` incoherent. Resolve in Clarify.

## Acceptance Criteria

- **AC-1 (FR-1).** With `approvalPr: auto` and a `pushed-branch` outcome, a PR is created; with `manual`, no `gh pr create` runs and the legacy notification appears unchanged. Both asserted against a stub runner.
- **AC-2 (FR-2, INV-2).** The created PR carries the `docs-lane` label and a title matching the approval commit subject; a fixture whose changed paths include a non-allowlisted path is **never** labelled.
- **AC-3 (FR-3).** The happy path shows no notification with a completing action — asserted structurally, so a future change cannot reintroduce a required click.
- **AC-4 (FR-5, INV-5).** Each of `gh-absent`, `gh-unauthenticated`, `offline`, `failed` degrades to the `manual` surface with a reason, and no case throws.
- **AC-5 (FR-6).** With an existing open PR for the branch, no second PR is created and the existing URL is reported.
- **AC-6 (FR-7).** With `outcome: 'pushed'`, no `gh pr create` runs.
- **AC-7 (INV-1).** With `pushOnApprove: never`, and with `prompt` + the user declining, **zero** `git`/`gh`/network calls occur on the whole path — a call-recording test.
- **AC-8 (INV-3).** No `git checkout`/`switch`/`merge`/`rebase`/`reset` is ever invoked — asserted on the recorded runner argv, not by inspection.
- **AC-9 (INV-4).** No file under `.minspec/approvals/**` and no `status:` line is written anywhere on this path.
- **AC-10 (FR-4).** SPEC-039's `minspec.pushDocsLane` command continues to pass its existing tests against the extracted seam (no behaviour change from Slice 1).

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Auto-opened PRs pile up unreviewed if the lane stalls | The lane's own gates are unchanged; a stalled PR is visible in the normal queue, and #1024/#816's `awaiting-approval` signal still applies |
| R2 | A branch reused across re-approvals fans out duplicate PRs | FR-6 idempotency + AC-5 |
| R3 | Extracting the seam regresses SPEC-039's command | Slice 1 is a pure refactor gated by SPEC-039's existing tests (AC-10) before Slice 2 changes behaviour |
| R4 | Silent PR creation surprises a developer who expected a prompt | Default is documented in the setting's `enumDescriptions`; `manual` restores prior behaviour exactly (FR-1) |

## Traceability

- **Issue:** [#788](https://github.com/AIClarityAU/minspec/issues/788) — wire Alt+A commit-on-approve to the docs-lane.
- **Deferred from:** [SPEC-039](../SPEC-039-push-docs-lane-command/requirements.md) ("auto-on-approve (#788) is deferred") — this is grain (b) to its grain (a).
- **Goal:** constitution [G-8](../../../.minspec/constitution.md#L47) — git transparency; closes the last manual step of [#880](https://github.com/AIClarityAU/minspec/issues/880) (approvals stop stranding).
- **Adjacent, not blocking:** [#1025](https://github.com/AIClarityAU/minspec/issues/1025) / [#1026](https://github.com/AIClarityAU/minspec/pull/1026) (panel provenance), [#1019](https://github.com/AIClarityAU/minspec/issues/1019) (stale-build provenance).
- **Lane:** [DR-060](../../../docs/decisions/DR-060.md) / [DR-061](../../../docs/decisions/DR-061.md) (the auto-merge pipeline this joins), `#575`/`#781` (the docs-lane itself).
