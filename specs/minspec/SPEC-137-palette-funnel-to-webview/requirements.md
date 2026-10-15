---
id: SPEC-137
type: requirements
status: specifying
tier: T2
product: minspec
epic: EPIC-002  # Signpost Integrity
aspects: [ux, palette, webview]
depends_on: [SPEC-018]
relates_to: [SPEC-014, SPEC-022, "#532"]
---

# MinSpec — Funnel palette users into the approvable editor (Requirements)

**Date:** 2026-10-16
**Status:** Specifying
**Triggered by:** [#532](https://github.com/AIClarityAU/minspec/issues/532) — parked user directive
2026-07-05 during SPEC-018 re-approval. No DR: every choice here is a `package.json`
`when`-clause, reversible in under a day.

## Problem

[SPEC-018](../SPEC-018-spec-custom-editor/requirements.md) makes a custom editor the primary
surface for reading, reviewing and editing approvables. The Command Palette still lists every
low-level `minspec.*` command. Invoking a granular create/regenerate/backfill/inject command
there bypasses the guided flow the editor exists to provide.

**State at time of writing (verified):** `packages/minspec/package.json` has no `customEditors`
contribution and `src/` registers no custom editor provider, so SPEC-018's editor has **not
shipped**. This spec is therefore gated: nothing here may be built until FR-1 holds.

## Functional requirements

- **FR-1 (gate).** No palette hiding lands until the SPEC-018 custom editor is contributed
  (`contributes.customEditors`) and registered, and the entry points that replace each hidden
  command exist in it (see FR-5). Hiding a command whose replacement does not exist strands users.
- **FR-2 (hide, not delete).** Hidden commands stay registered, so `vscode.commands.executeCommand`,
  keybindings, tree-view and webview invocations keep working. Only the palette listing changes,
  via `contributes.menus.commandPalette` `when` clauses.
- **FR-3 (classification).** Each `minspec.*` command in `contributes.commands` is assigned exactly
  one class in this spec's table (Decision D1 fixes the membership): **user-facing** (always in
  palette) or **funneled** (palette-hidden once the funnel is active).
- **FR-4 (context key).** Funneled commands carry a `when` clause on a key the extension sets
  with `setContext` (Decision D2). Existing `"when": "false"` entries are untouched.
- **FR-5 (replacement path).** For every funneled command, the editor, a tree-view item or a
  tree-view title/context menu offers the same action. A test enumerates funneled commands and
  asserts each has such a non-palette entry point.
- **FR-6 (escape hatch).** Setting `minspec.palette.showAllCommands` (default `false`) restores
  the full palette. Per the repo's workspace-config rule it defaults to the funnel behaviour.
- **FR-7 (drift gate).** A validator/test fails when a command in `contributes.commands` is in
  neither class, so a newly added command cannot silently appear unclassified.

## Acceptance criteria

- **AC-1.** With the editor shipped and funnel active, the palette lists only user-facing
  commands; each funneled command is absent from the palette and still executes via
  `executeCommand`.
- **AC-2.** With `minspec.palette.showAllCommands = true`, or before the editor is active
  (key unset), every command appears as today.
- **AC-3.** The FR-5 and FR-7 tests exist and fail when a funneled command loses its replacement
  or a command is unclassified (mutation-checked).
- **AC-4.** No command is removed from `contributes.commands` or from the registration code.

## Invariants not to break

- **Offline (invariant 1):** purely declarative `package.json` plus one `setContext`; no network.
- **No silent gate (invariant 2):** the classification check fails visibly in the validator, not best-effort.
- **Blast radius (invariant 3):** the funnel key is set only when `.minspec/` exists at the repo
  root, so a repo that did not opt in sees no palette change.

## Decisions needed (Clarify)

**D1 — Which commands stay user-facing.**
The issue proposes keeping `minspec.init`, `minspec.classify`, `minspec.nextTask`,
`minspec.showSpecPanel` and hiding granular create/regenerate/backfill/inject commands
(`createAdr`, `createEpic`, `regenerateDrIndex`, `regenerateEpicIndex`, `backfillEpics`,
`injectContext`, `removeContext`, `generateExample`, `migrateLayout`, …).
- **(rec) Option A — the issue's list, plus `status`, `declareScope`, `park`, `validateSpec`,
  `approveSpec`.** These are session/lifecycle entry points with no webview equivalent.
  Cost: a larger visible list; the boundary is a judgement call that will need revisiting.
- Option B — only the issue's four. Cost: users lose palette access to `declareScope`/`park`
  with no editor replacement, violating FR-1's intent.
- Option C — per-command audit in the plan phase. Cost: delays this spec's approval.

**D2 — Conditional context key vs unconditional hide.**
- **(rec) Option A — context key `minspec.approvableEditorActive`,** set at activation when
  the custom editor is registered and `.minspec/` exists. Cost: one more context key to keep
  correct; if never set, the funnel silently never applies (covered by AC-2 and a test).
- Option B — unconditional `when` clause hide. Cost: hides commands in repos/hosts where the
  editor is unavailable (e.g. restricted or untrusted workspaces), stranding users.

**D3 — Escape-hatch setting (FR-6).** (rec) Keep it, defaulting to funnel-on; cost: one more
setting to document. Alternative: no setting, cost: power users with no palette recourse
except keybindings.

## What this is NOT

- Not removal of any command, and not a change to the commands' behaviour.
- Not a change to SPEC-018's editor scope; only consumes it.
- Not actionable until SPEC-018 ships (FR-1).
