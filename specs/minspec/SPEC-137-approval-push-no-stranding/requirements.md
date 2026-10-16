---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness — approvals must reach the remote; sibling of SPEC-050 (what happens after the push)
aspects: [approval, push, consent, protected-branch, stranded-approvals, offline, tier-0, g8-git-transparency, retroactive-spec]
depends_on: [DR-071]
relates_to: [SPEC-050, SPEC-039, SPEC-057, DR-050, DR-051, DR-071, DR-077, DR-078, "#1022", "#1023"]
implements: [packages/minspec/src/lib/approve-push.ts, packages/minspec/src/commands/commit-on-approve.ts]
affects: [packages/minspec/package.json]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Approval push, no stranding (Requirements)

> Materializes **[#1022](https://github.com/AIClarityAU/minspec/issues/1022)** ("Alt+A commits the approval but never pushes — records strand on one machine"). **This is a retroactive spec**: the fix shipped in #1023 (commit `33ece16c`) before any spec existed, and SPEC-050 (what happens *after* the push) and DR-071 (standing consent) were written on top of it. This spec records the contract of the **push step itself** so it has an owner and a checkable acceptance list. It specifies behaviour already present in code; it does not ask for new code except where **Decisions needed** says so.

## One-Sentence Scope

After an approval commit, MinSpec gets the *same commit* to the remote — directly when the branch is pushable, via a new branch at that commit when the branch is protected — only with the user's consent, never switching the checkout, and always saying plainly when the record is still local-only.

## Context (evidence, `file:line`)

- **Symptom.** 2026-07-27: three duplicate recovery PRs (#996, #1017, #1018) for the same two stranded records, two closed.
- **Root cause (mechanism + missing gate).** (1) The commit step never pushed; (2) approvals land on `main`, which is protected, so a manual `git push` is rejected too — no path from Alt+A to the remote existed. The missing gate: the toast said `· committed`, a false signpost for a record present on one laptop only.
- **Current state (verified by reading code, not issue prose).**
  - Settings `minspec.pushOnApprove` (`never|prompt|always`, default `prompt`) and `minspec.protectedBranches` are contributed in `packages/minspec/package.json:486` and `:515`.
  - `decidePushPlan` returns `push-current` / `push-new-branch` / `skip` (`approve-push.ts:50-79`); `pushApproval` returns `pushed`, `pushed-branch` (with `compareUrl`), `failed`, `skipped`, `not-a-repo` (`approve-push.ts:139-237`).
  - Failure surfaces as ` · push failed — still local only (see console)` (`commit-on-approve.ts:1017`).
  - Mode read via `pushOnApproveMode()` (`commit-on-approve.ts:305`), non-modal prompt with `Push` / `Not now` (`:334-336`).
- **Drift from the issue text.** The issue says default `protectedBranches` is `["main","master"]`; the shipped default is `["main","master","trunk"]` (`package.json:515-524`). This spec follows the code (FR-3).

## Functional Requirements

- **FR-1 (no strand without a signal).** After a successful approval commit, the approval result MUST NOT read as complete while the record exists only locally. Each outcome states its true state in the toast suffix: pushed, pushed on a side branch (PR needed), declined/never (local only), or failed (local only).
- **FR-2 (consent tri-state).** `minspec.pushOnApprove`: `never` — no git push, no network, no prompt; `prompt` (**default**) — a non-modal offer whose click is the consent, dismissal or `Not now` sends nothing; `always` — the setting is the consent (DR-071 standing consent). The default MUST remain `prompt`.
- **FR-3 (protected branches by setting, not probe).** `minspec.protectedBranches` (default `["main","master","trunk"]`) decides protection from configuration, requiring no network call.
- **FR-4 (non-protected branch).** Push the current branch: `git push -u origin <branch>`; outcome `pushed`.
- **FR-5 (protected branch → same commit, new branch).** Create a branch at the approval commit's SHA, push that, and report `pushed-branch` with a compare URL. The user's checkout and current branch are never switched, reset or rewritten (rule #8 / DR-051). The branch name is unique per approval (`approvalBranchName`, `approve-push.ts:128`).
- **FR-6 (failure is visible).** Any push failure yields ` · push failed — still local only` plus detail in the console/log; never swallowed, never reported as success.
- **FR-7 (non-pushable states).** Detached HEAD, no branch, or not a repository → `skipped`/`not-a-repo` with the reason surfaced; no push attempted.
- **FR-8 (hand-off to SPEC-050).** What happens after `pushed-branch` (PR opening) is owned by SPEC-050; this spec only guarantees the compare URL is offered when that path is `manual` or degraded.

## Invariants

- **INV-1 (offline default).** Constitution invariant 1: with `never`, or `prompt` unanswered, **zero** network I/O occurs. Network is crossed only by the consented push, to the repository's own configured remote.
- **INV-2 (no silent gate).** A failed push is rendered, not best-effort (constitution invariant 2).
- **INV-3 (blast radius).** No writes outside the opted-in project (`.minspec/` marker); the "always" choice is stored per-project per DR-078, never machine-wide.
- **INV-4 (checkout safety).** FR-5 never moves HEAD of the shared checkout.

## Acceptance Criteria

- **AC-1.** `pushOnApprove: never` → no `git push` process spawned (FR-2, INV-1).
- **AC-2.** `prompt` + dismiss/`Not now` → no `git push`; suffix says local only (FR-1, FR-2).
- **AC-3.** Feature branch + consent → `git push -u origin <branch>` runs once; outcome `pushed` (FR-4).
- **AC-4.** On `main` + consent → no push to `main`; a new branch at the same SHA is pushed; HEAD unchanged before/after (FR-5, INV-4).
- **AC-5.** Remote rejects → suffix contains `push failed — still local only` (FR-6).
- **AC-6.** Detached HEAD → no push, reason surfaced (FR-7).
- **AC-7.** Branch listed in `protectedBranches` but absent from the issue's original list (e.g. `trunk`) is treated as protected (FR-3).

Coverage already exists in `packages/minspec/tests/approve-push.test.ts`, `approve-push-wiring.test.ts`, `commit-on-approve.test.ts`; Plan phase should map each AC to a named test and add any missing one.

## Decisions needed (Clarify)

- **D-1 (is a new spec the right home?).** Options: **(a) (rec)** adopt this retroactive SPEC-137 as owner of the push step — one place for FR/AC; cost: a spec that documents shipped behaviour needs a human read for no new capability. **(b)** fold these FRs into SPEC-050 — fewer files; cost: SPEC-050 is hash-locked/approved-track, so edits force re-approval. **(c)** close #1022 as covered by DR-071 + code with no spec; cost: the push contract has no AC owner and can regress unnoticed.
- **D-2 (`trunk` default).** Code ships `trunk`; the issue lists only `main`,`master`. Recommend keeping code (`trunk` is a common protected name); cost: a repo using `trunk` unprotected gets a branch+PR instead of a direct push.
- **D-3 (failure UX).** The suffix says `(see console)`; the console is rarely read. Recommend a follow-up to offer a `Retry push` action; cost: new surface and tests, so it is out of scope here unless approved.

## Out of scope

PR opening and `docs-lane` labelling (SPEC-050); recovery of already-stranded branches (SPEC-057); changing the `prompt` default.

## Traceability

Issue #1022; fix PR #1023; DR-071 (standing consent), DR-078 (per-project store), DR-051 (shared-checkout safety); SPEC-050, SPEC-039, SPEC-057.
