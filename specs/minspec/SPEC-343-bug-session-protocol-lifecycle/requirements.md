---
id: SPEC-343
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - RCDD (DR-003) is part of the methodology; this gives bug work its own first-class lifecycle
aspects: [bug, rcdd, lifecycle, validator, tree-view, tier-0]
relates_to: [DR-003, DR-025]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — First-class Bug Session Protocol lifecycle (Requirements)

> Materializes **[#22](https://github.com/AIClarityAU/minspec/issues/22)**. Design rests on
> [DR-003](../../../docs/decisions/DR-003.md) (RCDD — Root-Cause-Driven Debugging, formerly "Bug Session
> Protocol"; accepted). This spec does not re-litigate DR-003's four phases or its `Root cause:` gate
> token — it gives them a state machine, a file type, a validator rule and a sidebar group.

## One-Sentence Scope

Add a `bug` artifact type with its own four-phase lifecycle (`reproduce → diagnose → fix → harden`),
stored as `bugs/BUG-NNN-slug.md`, created from a Command Palette command, gated on a written
root-cause sentence before `fix` and on a regression test before `harden`, and shown in a separate
"Bugs" group in the tree view.

## Problem

SDD models feature work. Bug-fix work, roughly half of developer time, is governed only by DR-003 prose
in CLAUDE.md plus the commit-msg `Root cause:` gate (`.githooks/commit-msg`, `fix:` commits only). There is
no artifact that records a bug's reproduction, diagnosis or phase, so the work is invisible to the
explorer, the status surfaces and the validator. A bug fixed without a recorded root cause is caught only
at commit time, after the diagnosis effort is spent or skipped.

## Functional requirements

- **FR-1 Artifact.** A bug is a markdown file `bugs/BUG-NNN-slug.md` (directory configurable like
  `specsDir`, default `bugs`). `NNN` is zero-padded, allocated as max existing plus one, with the same
  collision caveats as spec ids (see Decisions needed D-4).
- **FR-2 Frontmatter.** Required keys: `id: BUG-NNN`, `type: bug`, `status` (one of the four phases),
  `severity: low|med|high|critical`. Conditional key: `root_cause` (a one-sentence string), required from
  `fix` onward. Optional: `issue` (GitHub issue ref), `epic`, `relates_to`, `regression_test`.
- **FR-3 Phases.** Status values and order: `reproduce` → `diagnose` → `fix` → `harden`, plus terminal
  `closed` (see D-1). Transitions advance one step at a time; moving backwards (e.g. `fix` → `diagnose`
  when the diagnosis proves wrong) is allowed and clears no data.
- **FR-4 Create command.** A Command Palette entry "MinSpec: New Bug" prompts for a title and severity and
  writes `bugs/BUG-NNN-slug.md` from a template with a body section per phase (Reproduce: steps, actual vs
  expected; Diagnose: `Root cause:` line, why tests missed it, deeper-issue check; Fix; Harden). It is not
  a shell command (project rule: MinSpec is an extension, not a CLI). The issue's `minspec bug new <title>`
  wording is read as the palette command.
- **FR-5 Advance command.** A palette entry "MinSpec: Advance Bug Phase" moves the active bug one phase,
  applying the gates in FR-6 and FR-7 and refusing with a visible reason when a gate fails.
- **FR-6 Root-cause gate (reproduce/diagnose → fix).** Advancing to `fix` requires a non-empty
  `Root cause: <sentence>` line in the body and the mirrored `root_cause` frontmatter value (the body line
  is the source of truth; see D-2). Same token as the DR-003 commit-msg gate so one phrase serves both.
- **FR-7 Regression-test gate (fix → harden).** Advancing to `harden` requires a recorded regression test
  (`regression_test` frontmatter naming a test, plus a body note that it failed before the fix). The gate
  checks the field is present and that the named test file exists in the repo; it cannot prove the red-then-green
  run (see D-3).
- **FR-8 T0 validator rule.** `npm run validate` / the extension validator reports an **error** for any bug
  whose `status` is `fix`, `harden` or `closed` and which lacks a root cause (FR-6 form), for an invalid
  `severity`, an unknown `status`, a missing `id`/`type`, or an `id` not matching the filename. A bug in
  `reproduce` or `diagnose` without a root cause is valid. A `harden`/`closed` bug without
  `regression_test` is an error.
- **FR-9 Sidebar.** The tree view gains a "Bugs" group beside Specs, listing bugs ordered by severity then
  id, each labelled with its phase and severity, with the same open/refresh behaviour as spec nodes.
  The group is hidden when the repo has no `.minspec/` (constitution invariant 3) and shows no node
  when `bugs/` is empty.
- **FR-10 Phase 1-2 source-edit warning (informational).** While the active bug is in `reproduce` or
  `diagnose`, an edit to a source file outside the bug file shows a non-blocking warning ("RCDD Phase 1-2:
  no code changes until a root cause is written"). It never blocks a save or commit. See D-5 for the
  definition of "active".
- **FR-11 Offline.** All of the above is Tier 0: file reads/writes only, no network call (invariant 1).

## Acceptance criteria

- **AC-1** "New Bug" with title "Login loops" and severity `high` creates `bugs/BUG-001-login-loops.md`
  with `type: bug`, `status: reproduce`, `severity: high`, and the four phase sections.
- **AC-2** Advancing a `diagnose` bug with no `Root cause:` line is refused with a message naming the
  missing line; the file is unchanged. With the line present it moves to `fix`.
- **AC-3** A hand-edited bug with `status: fix` and no root cause fails validation with an error naming
  the file; the same file at `status: diagnose` passes.
- **AC-4** Advancing `fix` → `harden` with no `regression_test` is refused; with a `regression_test`
  naming a nonexistent file it is refused; with an existing file it advances.
- **AC-5** Invalid `severity: urgent` fails validation.
- **AC-6** The tree shows a "Bugs" group with one node per bug, severity-ordered; a repo without
  `.minspec/` shows no group.
- **AC-7** Editing a `src` file while a bug is in `diagnose` raises a warning and does not block the save.
- **AC-8** A repo with no `bugs/` directory validates exactly as before (no new error, no new warning).

## Invariants this change must not break

- **Invariant 1 (offline).** No network call anywhere in this feature.
- **Invariant 2 (no silent gate).** Both phase gates and the validator rule fail visibly; no gate result
  is written with a swallowed error. The FR-10 warning is explicitly informational, and the spec says so
  rather than presenting it as a gate.
- **Invariant 3 (blast radius).** Nothing is created, shown or validated in a repo lacking `.minspec/`.
- The DR-003 commit-msg gate (`fix:` commits need `Root cause:`) is unchanged; this feature is additive.
- Existing spec lifecycle, ids and validators are unchanged: `BUG-` ids never collide with `SPEC-`/`DR-` ids,
  and spec discovery must not pick up `bugs/`.

## Out of scope

- Enforcing FR-10 (edit blocking), per the issue ("informational gate; warning only").
- Proving the regression test failed before the fix (needs running the test against base; see D-3).
- Linking bugs to the RCDD fields in `.review-signals.json` or auto-creating a bug from a `fix:` commit.
- Team-mode workflows, bug triage queues, or GitHub issue sync (a detection/integration split per the
  triage rule: this spec only stores an optional `issue` ref).

## Decisions needed (Clarify)

- **D-1 Terminal state.** DR-003 has four phases; a finished bug needs a resting state.
  - (a) **(rec)** Add `closed` after `harden`, keeping the four named phases intact. Cost: a fifth status value
    the issue did not list.
  - (b) Treat `harden` as terminal. Cost: a finished bug stays "in progress" in the tree forever, which is a
    false signpost.
- **D-2 Where root cause lives.** The issue lists both a `root_cause:` frontmatter key and a `Root cause:`
  line.
  - (a) **(rec)** Body line is the source of truth; frontmatter `root_cause` is derived by the advance command.
    Cost: two places that can drift, so the validator must also check they agree.
  - (b) Frontmatter only. Cost: diverges from the DR-003 commit-msg token that people already write.
- **D-3 Regression-test proof.** FR-7 checks presence only.
  - (a) **(rec)** Presence plus file-exists check now. Cost: a test that never failed passes the gate.
  - (b) Run the named test against the pre-fix commit. Cost: needs a runner and git plumbing per language and
    is a plan-level feature of its own.
- **D-4 Id allocation.** `max+1` on disk collides across concurrent branches (the DR register hit this, #1226).
  - (a) **(rec)** Same max+1 as specs, with a validator duplicate-id error. Cost: collisions surface only at
    validation, not creation.
  - (b) Reuse the spec-id collision gate across open PRs. Cost: network-dependent, so it cannot be Tier 0.
- **D-5 "Active bug" for FR-10.** Options: (a) **(rec)** the single bug whose phase is `reproduce`/`diagnose`
  and which was most recently edited; cost: wrong when several bugs are open. (b) Bind a bug to the current
  git branch via `issue`/branch name; cost: needs a naming convention. (c) Drop FR-10 from this spec and ship it later.
- **D-6 Tier and shape.** Issue says T3 (new surface). Confirm that the design/tasks phases are wanted
  rather than collapsing to T2.
