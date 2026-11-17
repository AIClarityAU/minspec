---
id: SPEC-369
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity
aspects: [ux, validator, no-silent-gate, offline]
depends_on: []
relates_to: ["#1639", "#1394", "SPEC-065", "SPEC-051", "SPEC-029", "DR-065", "DR-003"]
implements: none
implements_reason: >-
  Specify phase only. Nothing is built yet; the behind-upstream probe, the approve-time
  confirmation and the facts command are all planned (#1639).
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-369: Approvable surfaces say when the checkout they read is behind its upstream

Issue: #1639. Design rests on constitution invariant 1 (offline), invariant 2 (no silent gate), DR-065 (presence gate: never move a shared checkout's `HEAD`) and SPEC-051 (approval hash semantics). Sibling class: #1394 (CI judged against a stale merge base).

## Problem

Every approvable-facing surface (ownership gate, parity rules, signpost, `facts`) reads the **working tree**, which is the right source for an editor. Nothing compares the working tree's `HEAD` with the upstream ref or surfaces the gap, so "this file is old" and "this file is wrong" look identical to the human.

Two directions, only one of which announces itself:

- **False blocked** (observed 2026-08-22): a checkout 4 commits behind `origin/main` showed SPEC-065 as missing `implements:`, which had been on `main` since the Clarify merge (#1626). Approve was refused; diagnosis took ~10 minutes.
- **False approved** (not yet observed, worse): a behind checkout can show a spec whose ownership, phases or status satisfy every gate while the version on `main` does not. The human signs bytes that are not the bytes that will be built from. The hash lock does not help: it binds what was approved, and that genuinely is what the approver saw.

Root cause (mechanism): a gate that reads a local snapshot cannot know the snapshot is current, and no producer exists for "HEAD is N commits behind upstream" on any approvable surface. The missing gate is that signal, not a data fix.

## Scope

A **signal**, not an auto-pull. The surfaces stay read-only. Never fetch, pull, rebase or move `HEAD` (DR-065).

## Functional requirements

- **FR-1 Behind-gap probe.** A pure, offline function returns `{ behind: number, upstream: string }` or an explicit `unknown` with a reason. It counts commits reachable from the already-fetched remote-tracking ref (`@{upstream}`, falling back to `origin/<default branch>` when no upstream is configured) and not from `HEAD`. It runs only local `git` plumbing (`rev-list --count`); it MUST NOT run `git fetch`, `git ls-remote` or any network call.
- **FR-2 Zero gap is silent.** `behind === 0` renders nothing on any surface, so the indicator does not become noise.
- **FR-3 Indicator on approvable surfaces.** When `behind > 0`, the surface that hosts the approve action (and the signpost/spec status surface) states plainly: "reading a checkout N commits behind `origin/main`" (N and ref from FR-1).
- **FR-4 Approve confirmation.** `MinSpec: Approve` on a behind checkout requires an explicit confirmation naming the gap ("approve the version I can see?"). Declining aborts with no sidecar written. Zero gap or `unknown`-handled per FR-6 proceeds as today.
- **FR-5 `facts` reports the gap.** `npm run facts` gains a read-only `checkout` command printing HEAD, upstream ref, behind count, and ahead count, with exit semantics matching the other `facts` commands.
- **FR-6 Unknown is visible, not silent.** If the probe cannot decide (no upstream ref, detached `HEAD`, ref never fetched, git absent), the result is `unknown` with a reason. `facts` prints it; the approve path does NOT block on `unknown` but shows the reason once in the confirmation text (invariant 2: a missing witness is not a silent pass, and not a hard block for a repo with no remote).
- **FR-7 Staleness of the remote-tracking ref itself.** The signal is relative to the last fetch; the message says "as of last fetch" so a never-fetched checkout is not read as current.
- **FR-8 Opt-in boundary.** Applies only in a repo with `.minspec/` at its root (constitution invariant 3).

## Acceptance criteria

- **AC-1** With `HEAD` N>0 commits behind the upstream ref, the probe, the approve surface and `facts checkout` each report N and the ref.
- **AC-2** Test asserts no network: the probe is run with a stubbed git runner that fails the test if any command other than local read-only plumbing is invoked (no `fetch`, `pull`, `ls-remote`, `remote update`).
- **AC-3** With `behind === 0`, no indicator text is emitted by any surface (asserted against each renderer's output).
- **AC-4** Declining the FR-4 confirmation writes no approval sidecar and leaves `HEAD` unchanged.
- **AC-5** Unknown states (no upstream, detached `HEAD`) yield `unknown` plus a reason, never `behind: 0`.
- **AC-6** Probe never mutates repo state (`HEAD`, index, refs) — asserted by comparing `rev-parse HEAD` and `status --porcelain` before/after.

## Invariants this change must not break

- INV-1 Offline: no network call, no auto-fetch (constitution invariant 1).
- INV-2 Fail visibly: an undecidable probe is reported as `unknown`, never collapsed into "current" (constitution invariant 2).
- INV-3 Read-only: no auto-pull/advance of `HEAD` (DR-065).
- INV-4 Approval hash semantics unchanged (SPEC-051): the signal adds a confirmation, never alters `specHash` or sidecar format.
- INV-5 Opt-in boundary: inert without `.minspec/` (constitution invariant 3).

## Decisions needed (Clarify)

1. **Approve on a behind checkout: confirm or refuse?** Options: (a) explicit modal-free confirmation, approver can proceed (rec) — costs: a habitual click-through can still approve stale bytes; (b) hard refuse until the checkout is advanced — costs: blocks the founder when the gap is irrelevant to the spec (an unrelated commit), adding a manual step against tenet 1; (c) refuse only when the behind commits touch the spec or its owned files — most precise, costs a path-diff computation and a new place for the gate to be wrong. The issue asks for "at minimum" (a).
2. **Remote-tracking ref when no upstream is configured.** Options: `origin/<default>` fallback (rec) — costs: wrong in repos whose default is not what the branch tracks; or treat as `unknown` — costs: agent worktrees on fresh branches would always read `unknown`.
3. **Surface set for FR-3.** Approve command + spec tree/signpost (rec, matches the issue's "where the approve action lives") versus every surface listed in the issue (ownership gate, parity rules) — costs: more renderers to wire and test; deferral leaves the false-blocked message uncorrelated with the gap.
4. **Should the ownership-gate failure message append the gap?** This directly shortens the observed diagnosis (rec: yes, only when `behind > 0`) — costs: touches a gate's message format that other tests may pin.
