---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity
aspects: [ux]
depends_on: [SPEC-018]
relates_to: [SPEC-014, SPEC-022, DR-012, "#544"]
---

# MinSpec — Per-Commit Diff-Colour Timeline in the Approvable Editor (Requirements)

**Date:** 2026-10-16
**Status:** Specifying (spec only — nothing built)
**Triggered by:** [#544](https://github.com/AIClarityAU/minspec/issues/544) — user directive
2026-07-06 during SPEC-018 review, parked under DR-360. No DR yet: the choices below are
reversible in under a day (see Decisions needed).

## Problem

SPEC-018 FR-15 gives the approvable editor a quiet change-highlight (gutter bar + light tint):
a reviewer sees *that* a paragraph changed, not *when* or *in which revision*. This spec adds an
opt-in lens over that floor: each commit that touched the document gets its own colour, and a
legend lets the reviewer narrow the view to the most recent X commits.

## Scope

A **layer on SPEC-018 FR-15**, in the SPEC-018 custom editor only. Out of scope: any change to
the FR-15 default, the approval hash, or non-approvable markdown; line-level `git blame` UI
outside the editor; remote/hosted history (PR comments, forge APIs).

**Precondition:** SPEC-018 FR-15 must be shipped. SPEC-018 is `implementing`; verify the FR-15
code exists (cite `file:line`) before planning — a spec's `status` is not evidence the feature is
built (CLAUDE.md Evidence Discipline).

## Functional requirements

- **FR-1 (per-commit attribution, read-only).** For the open approvable, compute for each
  paragraph/block range the commit that last touched it (per Decision D1: last-touch vs
  all-touching commits), from the local git history of that file. The data source is local
  `git log` / `git blame` only, run read-only; no network call, no write to the repo, index or
  working tree.
- **FR-2 (distinct colour per commit).** Each commit in the displayed window is assigned a
  distinct colour from a fixed, ordered, colour-blind-safe palette with a light and a dark
  variant, chosen by the active VS Code theme kind (including high-contrast). Assignment is
  deterministic for a given ordered commit list (same history → same colours). When commits
  exceed the palette size, colours are assigned to the newest N−1 and older commits share one
  neutral "older" colour; the legend states this.
- **FR-3 (in-document marks).** A new or changed paragraph shows a coloured bar beside it in the
  commit's colour (enriched gutter bar, extending FR-15's). A small intra-paragraph change MAY
  instead show a highlighter-style background in the commit's colour, only when the changed span
  is below a threshold (Decision D3). It MUST NOT use dense underline/strikethrough (FR-15).
- **FR-4 (scrollbar markers).** The editor shows overview-ruler markers at the position of each
  marked paragraph in the same colours, like a standard diff overview ruler.
- **FR-5 (interactive legend / timeline).** A colour-coded legend lists the commits in the
  window, newest first, each showing colour, short SHA, subject, author-date. Selecting an entry
  focuses that commit (others dimmed); selecting a range, or "last X", shows only the most recent
  X commits and dims or hides older marks (Decision D4: dim vs hide). Dimming is per-mark and
  reversible; a one-click "clear" returns to the unfiltered lens.
- **FR-6 (opt-in, quiet by default).** The timeline is OFF by default; the default reading state
  is the unchanged FR-15 floor. It is entered by an explicit toggle (command + button). Whether
  the choice persists across sessions is Decision D5. Enabling it never auto-runs on open.
- **FR-7 (keyboard path).** Every frequent action has a keyboard path with no mouse need:
  toggle the lens; cycle "most recent X commits" (X steps through 1, 2, 3, … all, then off);
  move legend focus; select the focused commit; clear. Commands are in the Command Palette
  ("MinSpec: …"), and bindings do not collide with SPEC-018's outline/section bindings.
- **FR-8 (view layer only).** Marks, tint, bar, ruler and legend are rendered over the document;
  they MUST NOT alter document bytes, trigger a `WorkspaceEdit`, dirty the document, or change
  its approval hash (DR-012 / SPEC-022). Toggling or filtering produces zero document edits.
- **FR-9 (accuracy under edit and rename).** Marks track the live buffer: for unsaved edits the
  current text is diffed against HEAD so uncommitted paragraphs show as a distinct "uncommitted"
  entry (its own legend item and colour), never mis-attributed to the last commit. File renames
  are followed (`--follow` semantics). If history is unavailable (not a git repo, shallow clone,
  untracked file, git absent), the lens shows an explicit "history unavailable: <reason>"
  state — never an empty lens that reads as "nothing changed" (invariant 2: no silent gate).
- **FR-10 (bounded cost).** Attribution is computed off the extension-host critical path, cached
  per (file, HEAD sha, buffer version), invalidated on HEAD change or edit, and bounded (commit
  window cap, per Decision D2). A slow/large history shows a progress state and a "showing last
  N commits" truncation notice, not a hang.
- **FR-11 (offline, scoped).** No network call; works air-gapped (invariant 1). The lens does
  nothing in a repo without `.minspec/` (invariant 3) — it is part of the opted-in editor only.

## Acceptance criteria

- [ ] **AC-1 (FR-1, FR-8).** A T0 test over a fixture repo with ≥3 commits touching distinct
  paragraphs asserts each paragraph maps to the expected commit, and that computing it leaves the
  repo (`git status`, index, refs) and the file bytes unchanged.
- [ ] **AC-2 (FR-2).** The palette passes a colour-blind-safety check (deuteranopia, protanopia,
  tritanopia simulation: adjacent entries stay distinguishable) in light, dark and
  high-contrast; assignment is deterministic across two runs; overflow collapses to the neutral
  "older" colour with the legend noting it.
- [ ] **AC-3 (FR-3, FR-4).** Marked paragraphs get a bar and an overview-ruler marker in their
  commit's colour; an intra-paragraph change under the threshold renders as background highlight;
  no underline/strikethrough appears.
- [ ] **AC-4 (FR-5).** With 6 commits, "last 2" shows only the two newest commits' marks and
  dims/hides the other four; "clear" restores all; the legend order is newest-first.
- [ ] **AC-5 (FR-6).** On first open the lens is off and the FR-15 rendering is byte-for-byte
  identical to a build without this feature; enabling it is explicit.
- [ ] **AC-6 (FR-7).** Each of toggle / cycle-X / select / clear is invocable by keyboard alone,
  registered in the palette, with no binding conflict against SPEC-018.
- [ ] **AC-7 (FR-8).** Toggling, filtering and selecting produce zero document edits, the
  document is not dirty, and the approval hash is unchanged (view-layer test, as AC-16 of SPEC-018).
- [ ] **AC-8 (FR-9).** An unsaved edit shows as "uncommitted", not as the last commit; a renamed
  file keeps attribution across the rename; a non-git folder, shallow clone and untracked file
  each show the explicit unavailable state with the reason.
- [ ] **AC-9 (FR-10).** A 500-commit history does not block the UI; the truncation notice names
  the window; a second open at the same HEAD hits the cache (no second `git` spawn).
- [ ] **AC-10 (FR-11).** The feature code path imports no network module (import-boundary test,
  SPEC-040) and is inert without `.minspec/`.

## Invariants (must not break)

- **INV-View-only** — same class as SPEC-018 INV-Attention-view-only / FR-15: the lens never
  alters document bytes, the buffer's dirty state, or the approval hash.
- **INV-Quiet-default** — the default reading state remains the FR-15 floor.
- **INV-Read-only-git** — only read-only git plumbing/porcelain; never a write, fetch or network
  operation. Constitution invariants 1 (offline), 2 (no silent gate: history-unavailable is
  visible), 3 (blast radius: opt-in marker).
- **INV-Accessible** — colour is never the only signal: each mark also carries its legend
  identity (short SHA tooltip / accessible label), and the palette is colour-blind-safe.

## Decisions needed (Clarify)

- **D1 — attribution model.** (a) **last-touch per paragraph** `(rec)` — simple, matches
  `git blame`, one colour per paragraph; cost: a paragraph edited in three revisions shows only
  the latest, hiding its earlier history. (b) all touching commits (striped/stacked) — richer;
  cost: visual noise that fights "not distracting", harder palette/legend.
- **D2 — window cap and palette size.** Recommend palette of 8 colours + neutral "older", commit
  window default 50; cost: older history is collapsed, which a reviewer of a long-lived spec may
  want. Alternative: user-configurable, more config surface.
- **D3 — intra-paragraph threshold.** Background highlight vs paragraph bar: options (a) bar only,
  no intra-paragraph `(rec)`, cheapest and quietest; cost: the issue's "highlighter for smaller
  changes" is deferred; (b) include highlighter with a word-diff threshold; cost: needs a
  sub-paragraph diff and tuning, more tests.
- **D4 — dim vs hide.** Recommend dim `(rec)` (reversible, nothing "disappears" — cf. SPEC-018 R8);
  cost: still some visual noise. Hide gives a cleaner "what changed lately" view but can mask
  content a reviewer needed. Could offer both via a modifier.
- **D5 — persistence.** Per-session only `(rec)` (honours "quiet default"); cost: re-enable each
  time. Alternative: remembered per workspace setting; cost: drifts toward being the de-facto
  default.
- **D6 — precondition.** Confirm SPEC-018 FR-15 has shipped before this is planned (#544 says
  "do not start before FR-15 ships"); the planning phase must cite the code.

## Follow-ups (tracked)

- Implementation plan/tasks: after this spec is approved (SDD T3: plan, tasks, implement).
- SPEC-018 FR-15 and AC-16 already point to #544 as the parked timeline; on approval, SPEC-018
  `relates_to` SHOULD gain SPEC-137 (separate edit, not in this spec's PR).
