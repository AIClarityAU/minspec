---
id: SPEC-039
title: "Push docs via lane" — an editor command that opens a docs-lane PR
status: implementing
tier: T2
epic: EPIC-009  # Team Readiness — docs-lane push ergonomics (grain a of #575/#781)
---

# SPEC-039 — "Push docs via lane" command

## Context
The `docs-lane` workflow (#575/#781) auto-merges docs-only PRs labelled `docs-lane`;
`scripts/push-docs.sh` opens them from the CLI. This spec ports that to an editor
command so a maintainer lands docs from inside VS Code, keyboard-first, without the
terminal. Grain (a) of the docs-lane ergonomics; auto-on-approve (#788) is deferred.

## Functional Requirements
- **FR-1** Command `minspec.pushDocsLane` titled "MinSpec: Push docs via lane" in the
  palette, plus a non-conflicting keybinding (a two-key chord) shown in the palette.
- **FR-2** On invoke, gather working-tree changed paths limited to the docs corpus
  (`specs/**`, `docs/**`, `.minspec/approvals/**`, top-level `*.md`). None → advisory
  toast "No docs changes to push", stop.
- **FR-3** Before any network, a confirmation surfaces the file list AND that this
  opens a PR (a network action) — explicit consent for constitution invariant #1.
- **FR-4** On confirm: create a temp worktree off `origin/main`, copy the docs files
  in, commit (message prompted, default `docs: update <n> file(s) via docs-lane`),
  push branch `docs-lane/<shortsha>-<n>`, `gh pr create --label docs-lane`. Remove the
  worktree in a finally. Success toast shows the PR URL (openable).
- **FR-5** NEVER move the primary checkout HEAD or index. NEVER push a non-docs path.
- **FR-6** Graceful degrade: not a repo / detached / no `origin` / `gh` absent / `gh`
  not authenticated / offline → a typed advisory toast, NEVER a thrown exception.

## Invariants (T0 — tests first)
- **INV-1 (constitution #1: offline/consent)** No network unless the user invoked the
  command AND confirmed FR-3. The pure corpus helper does zero I/O.
- **INV-2 (corpus-only)** A non-docs path is never pushed — `isDocsCorpusPath` rejects it.
- **INV-3 (primary untouched)** primary HEAD + index unchanged after any run/failure.
- **INV-4 (never throws)** every failure mode returns a typed result → advisory toast.

## Delivery
Shipped in PR #797 (command + keybinding `ctrl+k ctrl+p`, 49 tests); the lane
foundation (`docs-lane.yml` + `scripts/push-docs.sh`) in #781. The editor command
is for a human editing docs; the CLI (`push-docs.sh`) is the agent's primitive,
since docs edits are generally agent-driven. This very note was landed through the
lane as the first agent-driven end-to-end exercise of it.
