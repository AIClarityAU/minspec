---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - the harness-refresh commit offer must not claim or lose files silently
aspects: [scaffold, commit-offer, gitignore, no-silent-gate, tier-0, offline, rcdd]
relates_to: [SPEC-043, SPEC-096, DR-003, DR-074, "#763", "#758", "#760", "#610", "#1054"]
---

# SPEC-137: Scaffold commit offer - ignored managed paths are surfaced, never silently stranded or dropped

Issue: #763 (harness-refresh commit offer aborts when `.claude/` is gitignored).
Related: #758 (auto-commit direction), #760 (marker-presence gate), #610 (the managed-path list).

## Scope sentence

When a managed (scaffolded) path is gitignored, the commit offer stages everything trackable, and
tells the user - visibly - which managed files it could not stage and why.

## Current state (verified against code, not the issue text)

- `defaultCommitter().add()` (`packages/minspec/src/commands/init.ts`, `add`) ALREADY runs
  `git.checkIgnore(paths)` and drops ignored paths before one `git.add`. So defect 1 of #763
  ("single all-or-nothing add") is, I believe, already mitigated in HEAD; unverified against the
  exact version the reporter ran - the reporter's toast text is git's native
  "paths are ignored" refusal, which that filter should prevent. The Plan phase MUST reproduce
  first (FR-1) before changing anything: if it reproduces on HEAD, the root cause is something
  else (candidates: `checkIgnore` throwing and being swallowed by the bare `catch`; a path form
  mismatch between what `check-ignore` echoes and the `paths` entries; the stub committers used by
  tests never exercising the real filter).
- The filter is SILENT: ignored paths vanish from the commit with no notice (the very
  "best-effort, swallowed" shape invariant 2 forbids), and a `checkIgnore` failure falls through
  to `git add` with no signal.
- `.claude/commands/minspec-*.md` shims and `.claude/settings.json` are in the managed set
  (`MANAGED_REGION_TEMPLATES`, `CLAUDE_SETTINGS_PATH`). A repo ignoring `.claude/` can never track
  them, so collaborators/CI never receive them. Nothing tells the user.

## Functional requirements

- **FR-1 Reproduce first.** A failing test using the REAL `defaultCommitter` against a temp git
  repo whose `.gitignore` contains `.claude/` and whose managed set includes an ignored
  `.claude/commands/minspec-specify.md` plus trackable files. Must state whether it fails on HEAD
  (RCDD: record the observed mechanism, not the reporter's symptom).
- **FR-2 Partial staging.** The offer stages every trackable managed path and commits them even
  when other managed paths are ignored. One ignored path never prevents the rest.
- **FR-3 Visible skip.** Every managed path excluded because it is gitignored is reported to the
  user in the offer's result toast/notice, naming each path (collapsed to one notice, not one per
  file) and the ignore rule when `check-ignore -v` provides it.
- **FR-4 Fail closed on a dead filter.** If the ignore check itself cannot run (git error), the
  offer does not silently proceed as if nothing were ignored: it either stages per-path and
  reports each per-path failure, or declines the commit with a visible message. It never
  swallows the error (constitution invariant 2).
- **FR-5 Trackability assertion.** Before staging, the offer computes
  `intended = managed paths that exist`, `stageable = intended minus ignored`, and asserts that
  `staged = stageable` after `git add` (via the existing `dirty()`/index state). Any intended path
  that is neither staged nor reported under FR-3 is a defect surfaced to the user (symmetric to the
  marker-presence gate, #760).
- **FR-6 Ignore-vs-managed warning.** On scaffold/refresh, when a managed output path is
  gitignored, MinSpec emits a managed-output warning (same channel as `ManagedRegionWarning`) so
  the loss of VCS tracking is visible at write time, not only at commit time.
- **FR-7 No rewrite of the user's ignore rules without consent.** MinSpec does NOT edit a
  `.claude/` ignore rule on its own (see Decisions needed D-1). Constitution invariant 3: a
  user's deliberate ignore is their configuration.
- **FR-8 Opt-in boundary.** All behaviour above runs only where `.minspec/` exists (SPEC-096);
  no network call is added (invariant 1).

## Acceptance criteria

- AC-1: real-git test, `.claude/` ignored: commit contains CLAUDE.md, AGENTS.md, workflows, roles
  and scripts; does not contain `.claude/**`; result notice lists the `.claude/**` paths.
- AC-2: real-git test, no ignores: behaviour and commit contents byte-identical to today.
- AC-3: real-git test with `check-ignore` forced to fail (e.g. injected committer): no silent
  success; user sees a message.
- AC-4: scaffold/refresh into a repo ignoring `.claude/` yields a visible warning naming the shims.
- AC-5: mutation check - removing the FR-3 notice or the FR-5 assertion turns a test red.

## Invariants that must not break

- Core works offline; no new network call (inv. 1).
- No silent gate: no swallowed error on a path that decides what is committed (inv. 2).
- Blast radius: no write outside the opted-in project; user ignore rules untouched without
  consent (inv. 3).
- Existing commit-offer behaviour on the default branch (#1054), branch naming (#1298) unchanged.

## Out of scope

Auto-commit direction (#758), marker-presence gate (#760) - tracked separately.

## Decisions needed (Clarify)

- **D-1: how to treat shims in a repo that ignores `.claude/`.**
  - (a) **(rec)** Warn only (FR-3, FR-6). Cost: the shims stay untracked for that repo until the
    user edits their own `.gitignore`; collaborators still do not receive them.
  - (b) Append a narrowing to `.gitignore` (replace blanket `.claude/` with specific
    `.claude/settings.local.json` etc. and add `!.claude/commands/minspec-*.md`). Cost: rewrites a
    user-owned rule, may un-ignore content they meant to hide, and a negation cannot re-include a
    file whose parent directory is ignored, so the blanket rule must be rewritten - highest
    invariant-3 risk.
  - (c) Write an opt-in prompt offering (b) once. Cost: extra UI and a persisted decision.
- **D-2: on a dead ignore check (FR-4), stage per-path and report, or decline the commit?**
  Rec: decline with a visible message (simplest, fail closed); cost: user must commit manually
  when git is partially broken.
- **D-3: is defect 1 already fixed?** If FR-1 shows green on HEAD, shrink this spec to FR-3 to
  FR-6 and close the all-or-nothing claim in #763 with the evidence.
