---
id: SPEC-050
type: tasks
# tier lives on requirements.md (the single tier-carrying approvable, per the spec-gate
# convention). A tier on a NON-approved sibling doc is treated by spec-gate.py as a second
# unapproved spec and can shadow the approved requirements.md — so this doc omits it.
# (SPEC-050 is T2.)
# Mirrors requirements.md's status. This doc has NO approval record of its own — only
# requirements.md is signed — so the field is descriptive, never a seal; read the sidecar for
# the real state. Kept ONLY because spec-validator.ts:525 marks `status` required
# UNCONDITIONALLY (unlike `tier`:529, which is requiredWhen: isPrimarySpec). Dropping it here
# is the right end-state (#972) but needs that schema change first — a code fix, not a doc edit.
status: planning
product: minspec
epic: EPIC-009  # Team Readiness — docs-lane push ergonomics (grain b of #575/#781)
relates_to: [SPEC-039, DR-071, DR-060, DR-061, DR-012]
phases:
  specify: done
  clarify: done
  plan: done
  tasks: in-progress
  implement: pending
---

# MinSpec — Silent approval PR (Tasks)

Tasks map to the FR/INV/AC set in [requirements.md](./requirements.md) and the module plan
in [design.md](./design.md). Materializes
[#788](https://github.com/AIClarityAU/minspec/issues/788).

**Two vertical slices; ordering is load-bearing** — Slice 1 extracts the seam with SPEC-039
as its only caller and **zero behaviour change**, so AC-10 can prove the refactor is inert
*before* Slice 2 changes anything. Reversing them would make a regression indistinguishable
from a new feature's bug.

**Nothing here is implemented yet** — every box is unchecked and stays unchecked until its
code exists and its test passes. A checked box is a claim (evidence discipline).

**Dependency budget: 0 new npm dependencies** (design.md §Dependency budget). Everything is
`child_process` + `gh`, both already in use. Adding one is a stop-and-discuss, not a task.

**Ownership note (SPEC-038).** `requirements.md` is approved and hash-locked
(`75ecc600…`, `github@harvest316.com`, 2026-08-05), and its `implements:` names exactly
`approval-pr.ts`, `commit-on-approve.ts` and `approval-pr.test.ts`. So the pure PR-body
builder design.md sketched as a separate `approval-pr-body.ts` is **folded into
`approval-pr.ts`** as an exported pure function instead — a third owned file would require
editing `implements:`, which would stale a fresh human approval for a file-layout
preference. It is also cohesive on its own terms: one lib that builds and opens a lane PR.

---

## Slice 1 — the seam — PENDING

Covers **FR-4**, **AC-10**, and the INV-3/INV-5 groundwork the second slice relies on.
Thinnest path: SPEC-039's command keeps working, through new code.

### T0 — Invariants (write first, before implementation)
- [ ] `packages/minspec/tests/approval-pr.test.ts` (**new — owned**) — **INV-3 / AC-8**: a
      stub `ExecRun` records every `(file, args, cwd)` and the suite asserts no
      `checkout` / `switch` / `merge` / `rebase` / `reset` argv is **ever** recorded, on any
      path including every failure branch. Asserted on recorded argv, never by inspection.
- [ ] same file — **INV-5**: every outcome resolves; a stub that rejects at each `gh` step in
      turn produces a typed result and **no** thrown exception escapes `openLanePr`.

### T1 — Contract
- [ ] same file — the `LanePrResult` shape holds for all seven `LanePrOutcome` values:
      `prUrl` present exactly on `created` / `adopted` / `not-docs-only`, `labelled` present
      and correct, `error` present on the four failure outcomes (design.md §Modules).

### Implementation
- [ ] `packages/minspec/src/lib/approval-pr.ts` (**new — owned**) — relocate verbatim from
      `push-docs-lane.ts`, no logic change: `ExecRun` + `defaultExecRun`
      ([:85-112](../../../packages/minspec/src/commands/push-docs-lane.ts#L85)), `isEnoent` +
      `describeError` ([:114-128](../../../packages/minspec/src/commands/push-docs-lane.ts#L114)),
      `isNetworkError` + `isAuthError` ([:130-142](../../../packages/minspec/src/commands/push-docs-lane.ts#L130)),
      `slugFromOriginUrl` ([:186-192](../../../packages/minspec/src/commands/push-docs-lane.ts#L186)).
      **No `vscode` import** — that is what makes the argv assertions above possible.
- [ ] same file — `openLanePr(input, run)`: `gh auth status` pre-flight → `isDocsCorpusPath`
      allowlist check to decide the label → `gh pr create` → adopt on an "already exists"
      rejection via `gh pr list --head <branch> --state open --json url`.
- [ ] `packages/minspec/src/commands/push-docs-lane.ts` (**affects**) — replace its
      PR-creation block ([:398-429](../../../packages/minspec/src/commands/push-docs-lane.ts#L398))
      with one `openLanePr` call; keep folder resolution, the docs scan, the modal consent
      gate, the temp worktree, copy/`git rm`/commit/push, and `surface()` untouched.
      `PushDocsOutcome` is unchanged — map `created`/`adopted`/`not-docs-only` → `pushed`,
      the four failure outcomes pass through by name.

### Gate — Slice 1 is done only when this holds
- [ ] `packages/minspec/tests/push-docs-lane.test.ts` (**not owned — must not be edited**)
      passes **unchanged** — **AC-10 / R3**. Editing that file to make it pass would destroy
      the only evidence the refactor is inert.

---

## Slice 2 — auto-open on approve — PENDING

Covers **FR-1, FR-2, FR-3, FR-5, FR-6, FR-7, FR-8**, **INV-1, INV-2, INV-4**, and
**AC-1 – AC-9, AC-11**. Depends on Slice 1's gate being green.

### T0 — Invariants (write first, before implementation)
- [ ] `packages/minspec/tests/approval-pr.test.ts` — **INV-1 / AC-7**: with
      `pushOnApprove: never`, and separately with `prompt` + the user declining, the recorded
      runner logs **zero** calls across the whole path. A call-recording test, so "no network"
      is observed rather than reasoned about.
- [ ] same file — **INV-4 / AC-9**: on every path, no file under `.minspec/approvals/**` is
      written and no `status:` line is emitted anywhere. This spec transports a record the
      approve command already wrote; it must never author one.
- [ ] same file — **INV-2 / AC-2**: a fixture whose changed paths include a non-allowlisted
      path yields `labelled: false` and the `docs-lane` label is absent from the recorded
      `gh pr create` argv.

### T1 — Contract
- [ ] same file — `buildApprovalPrBody()` (pure, exported from `approval-pr.ts`) renders the
      OQ-2 provenance block from an `ApprovalRecord`
      ([approval.ts:55-64](../../../packages/minspec/src/lib/approval.ts#L55)): artifact path,
      tier, approver email, `specHash`, approval commit SHA. Pure-function assertions, no
      runner. Presentation only — the sidecar stays authoritative.

### Implementation
- [ ] `packages/minspec/package.json` (**affects**) — contribute `minspec.approvalPr`
      (`auto` | `manual`, default `auto`, `scope: window`) with `enumDescriptions` naming
      what each value does (**FR-1**, R4).
- [ ] `packages/minspec/src/lib/approval-pr.ts` (**owned**) — add the exported pure
      `buildApprovalPrBody()` (see the ownership note above).
- [ ] `packages/minspec/src/commands/commit-on-approve.ts` (**owned**) — widen
      `pushApprovalIfEnabled` to `(rootDir, slug, paths)`; the caller already holds `paths`
      (`CommitApprovalResult.paths`, declared
      [approve-commit.ts:81](../../../packages/minspec/src/lib/approve-commit.ts#L81),
      populated on the `'committed'` return at
      [:246](../../../packages/minspec/src/lib/approve-commit.ts#L246)). No new state.
- [ ] same file — the `'pushed-branch'` arm
      ([:171-186](../../../packages/minspec/src/commands/commit-on-approve.ts#L171)) branches
      on `approvalPr`: `manual` → today's code path byte-for-byte; `auto` → `openLanePr`, then
      a **non-blocking** info toast carrying the PR URL (**FR-2, FR-3**).
- [ ] same file — every failure outcome (`gh-absent`, `gh-unauthenticated`, `offline`,
      `failed`) falls back to the identical legacy toast **plus a short reason**
      (**FR-5 / AC-4**). Never a throw, never a silent nothing.
- [ ] same file — a `not-docs-only` outcome surfaces a notification stating that auto-merge
      will **not** run and why (**AC-11**). Without the label the lane never runs, so an
      unannounced unlabelled PR is silence indistinguishable from success — the stranding
      class this spec exists to end.
- [ ] same file — **FR-7 / AC-6**: `outcome: 'pushed'` (non-protected branch) runs no `gh` at
      all; there is no PR to open.

### FR-8 — the one-time standing-consent offer
- [ ] `packages/minspec/src/commands/commit-on-approve.ts` (**owned**) — add a third action,
      **"Always push from now on"**, to the `prompt` notification
      ([:146-155](../../../packages/minspec/src/commands/commit-on-approve.ts#L146)), beside
      `Push` / `Not now`. On click: write `minspec.pushOnApprove: 'always'` to
      `ConfigurationTarget.Global` — the user's **own** settings, never the workspace file
      (DR-071's corollary) — then proceed with this push, so the click is not also a decline.
- [ ] same file — show the offer **once**: record it under its own `skipPrefKey` in the #883
      `answeredSignatures` map via `loadPreferences` / `savePreferences`
      (`auto-bootstrap.ts:82` / `:101` / `:68`). Never re-nag.
      ⚠️ That file contains two raw NUL bytes at line 223, so plain `grep` silently skips it
      and it reads as empty — use `grep -a`. Filed as
      [#1266](https://github.com/AIClarityAU/minspec/issues/1266); it does not block this task.
- [ ] `packages/minspec/package.json` — verify `pushOnApprove`'s contributed default is
      **still `prompt`** and remains untouched (DR-071 condition 1). This is a
      *don't-change-it* task; assert it in a test rather than trusting review.

### Gate — Slice 2 is done only when these hold
- [ ] **AC-3** asserted **structurally**: on the happy path `prUrl` is populated *before* any
      `showInformationMessage` promise is awaited, so no future edit can make a click
      load-bearing.
- [ ] **AC-1**: `auto` creates a PR; `manual` runs no `gh pr create` and shows the legacy
      notification unchanged. Both against the stub runner.
- [ ] **AC-5 / FR-6**: with an existing open PR for the branch, no second PR is created and
      the existing URL is reported.
- [ ] Full suite green, and `npm run validate` clean.

---

## Out of scope (do not do these here)

- Changing `pushOnApprove`'s contributed default to `always` — deliberately not done
  (DR-071 condition 1); FR-8 reaches the same outcome by the user's own act.
- Calling `gh pr merge --auto` — the lane workflow does it on the label; duplicating that
  would bypass its docs-only re-verification.
- Fixing [#1266](https://github.com/AIClarityAU/minspec/issues/1266) (the NUL bytes) — noted
  above only because it obstructs reading `auto-bootstrap.ts`.
