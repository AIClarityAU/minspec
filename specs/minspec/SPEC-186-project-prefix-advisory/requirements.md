---
id: SPEC-186
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a cross-project ref that resolves to nothing, silently, is a signpost that points nowhere
aspects: [cross-project, references, project-prefix, advisory, toast, tier-0, tier-1-seam, offline, blast-radius]
depends_on: [DR-053, DR-027, DR-004, "#679"]  # DR-053 is the accepted grammar this spec wires; DR-027 the separate registers that make prefixes necessary; DR-004 the tier split; #679 the module v1-to-v2 update DR-053 names as a hard predecessor to any runtime use of the table
relates_to: [SPEC-035, SPEC-025, DR-032, DR-074, "#500", "#614", "#58", "#267", "#124", "#681", "#396"]
# Ownership declared in Specify (SPEC-038). Paths are PROVISIONAL - the Plan phase may
# rename them; the shape is fixed: one pure detector, one thin vscode wiring layer, one
# suggestion seam, and their tests. The shared module itself is changed by #679, not here.
implements: [packages/minspec/src/lib/prefix-advisory.ts, packages/minspec/src/lib/prefix-suggestion-provider.ts, packages/minspec/src/commands/project-prefix.ts, packages/minspec/tests/prefix-advisory.test.ts, packages/minspec/tests/project-prefix-command.test.ts]
affects: [packages/minspec/src/extension.ts, packages/minspec/package.json]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-186: Cross-project prefix advisory - read the prefix table, flag unknown project codes without failing, and offer to add the row

## In plain terms

When a spec or decision cites another project - `SCR/SP4`, `SEA#12` - the three-letter
code in front says which project. The codes live in a small committed table,
`.minspec/project-prefixes.md`. Today nothing in the extension reads that table. This spec
wires it in. When a document uses a code the table does not know, MinSpec does not fail
and does not stay silent: it shows a quiet note on the reference and, once, a toast
offering to add the missing row to the table, with a suggested code. You confirm by saving
the table. MinSpec suggests the code itself, offline. A smarter suggestion from an AI
assistant can plug in later through the same slot. MinSpec never calls a model.

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. A human reads
> it, answers [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it
> through the normal spec-approval gate before any design or code.

**Origin.** Issue [#500](https://github.com/AIClarityAU/minspec/issues/500) (backlog
decision #5, 2026-07-05). The design rests on the **accepted**
[DR-053](../../../docs/decisions/DR-053.md) (paragraph-addressable reference scheme, v2,
accepted 2026-07-14). No new DR is minted: DR-053 already decides the grammar (§1-§4),
the not-fail-loud rule (§5) and the tier split (§6). This spec is the build of DR-053's
Tier-1 follow-up, [#614](https://github.com/AIClarityAU/minspec/issues/614) (unknown code
→ suggest + edit table), plus the Tier-0 wiring it needs.

**Where the issue text is superseded.** #500 asks for a **2-letter** prefix joined with a
dash (`MS-SPEC-019`). DR-053 v2, accepted after #500 was written, replaced that with
**3-letter** codes joined with a slash (`MIN/SP19`), and issues/PRs as `SCR#204`. This
spec follows the accepted DR. The 2-letter dash form is treated as legacy (FR-6).

## One-Sentence Scope

Load `.minspec/project-prefixes.md` into the extension, report a cross-project reference
whose project code is not in the table as an advisory (never an error), and offer once, in
a non-modal toast, to add the missing row with a deterministically suggested code behind a
provider seam a Tier-1 assistant can later fill.

## Context - what exists today (measured 2026-10-16 at `5f792386`)

- **The Tier-0 core exists but is v1.** `packages/shared/src/project-prefix.ts` exports
  `parsePrefixTable`, `resolveRef`, `formatCrossRef`, `suggestPrefixDeterministic`,
  `isCrossProjectRef`. It accepts 2-5-letter prefixes and the **dash** grammar only
  (`CROSS_SDD_RE`, `project-prefix.ts:85`), and `suggestPrefixDeterministic` produces a
  **2-letter** code (`project-prefix.ts:222-241`). Unknown prefixes already resolve to
  `'unknown-prefix'` rather than throwing (`project-prefix.ts:182-187`).
- **Nothing in the extension calls it.** `grep -rn project-prefix packages/minspec/src`
  returns no hits; the only consumer is the `packages/shared/src/index.ts:14` re-export.
- **The table is 3-letter.** `.minspec/project-prefixes.md` holds `MIN`/`SCR`/`SEA`/`MMO`
  and itself warns: do not wire this table to the resolver until #679 lands, or the
  module emits the `MIN-SPEC-019` chimera that is in neither grammar.
- **The editor-time advisory pattern exists.** `packages/minspec/src/lib/diagnostics.ts`
  maps pure checker output to `vscode.Diagnostic`s on save (#316), keeping the mapping
  core pure and testable without `vscode`. This spec reuses that pattern.
- **The Tier-1 hand-off pattern exists.** SPEC-025's constitution generator
  (`packages/minspec/src/commands/constitution.ts:16-45`) keeps MinSpec model-free and
  defines a provider seam that the future agent-execute extension fills. This spec's
  suggestion seam copies that shape.
- **Corpus measurement** (regex over `specs/` and `docs/decisions/`, this commit):
  `SCR#204` ×12, `MIN/SP19` ×11, `MS-SPEC-019` ×8, `OQ#1` ×6, `MS#500` ×5,
  `SC-DR-007` ×3, `SC#26` ×3, `PR#996` ×3, `MIN-SPEC-019` ×3, `PR#436` ×2, `PR#879` ×1.
  The 2-letter `OQ#1` / `PR#996` hits are prose, not refs: a detector that accepted
  2-letter codes would flag them. Requiring **exactly 3** letters (DR-053 §1) excludes
  them by construction. The v1 and chimera forms appear only as quoted examples inside
  DR-053, the prefix table and SPEC-035.

## Terms

- **Project code** - the 3-uppercase-letter PROJECT segment of DR-053 (`MIN`, `SCR`).
- **Cross-project ref** - a token that starts with a project code and carries at least an
  approvable segment: `MIN/SP19`, `SCR/DR7/FR3`, `SCR#204` (DR-053 §4).
- **Unknown code** - a project code that has no row in the prefix table.
- **Approvable document** - a markdown file under `specs/` or `docs/decisions/`, or an
  epic file. (Scope of the scan; see Clarify D-4.)
- **Suggestion provider** - the seam that proposes a code for a project, or a project for
  a code. The built-in one is deterministic and offline; a Tier-1 one may be registered.

## Functional Requirements

### A. Reading the table (Tier-0)

- **FR-1 - Load the table only in an opted-in repo.** The extension reads
  `.minspec/project-prefixes.md` only when the workspace folder has the `.minspec/` marker
  at its root (constitution invariant 3). No marker, no read, no advisory, no toast.
- **FR-2 - Missing or broken table is an empty table.** A missing file, or one with no
  valid rows, yields an empty map. Malformed rows are skipped, as `parsePrefixTable`
  already does. Neither case throws or blocks anything.
- **FR-3 - Reload on change.** Saving the table file refreshes the map and re-runs the
  advisory on open approvable documents, so a newly added row clears its advisory without
  a window reload.
- **FR-4 - Hard predecessor gate.** FR-1 to FR-3 do not ship until #679 has landed the v2
  grammar in `@aiclarity/shared` (3-letter codes, `/` join, `SP|DR|EP`, `<CODE>#N`, and a
  version-aware gate that rejects the `MIN-SPEC-019` chimera). This is DR-053's stated
  hard predecessor. It is a build-order rule. The Plan phase must not work around it by
  adding a second parser here.

### B. Detecting unknown codes (Tier-0)

- **FR-5 - Detection contract is DR-053 §4, no wider.** A token is a candidate only if
  it is a 3-letter code followed by an approvable segment (`/SP<n>`, `/DR<n>`, `/EP<n>`,
  optionally `/<PARA>`) or by `#<n>`. A bare code (`SEA`, `MIN`) is never a ref. 2-letter
  and 4-plus-letter prefixes are never candidates. Detection lives in a pure function
  (text + map → findings with line and column), with no `vscode`, `fs`, network or model.
- **FR-6 - Legacy v1 forms are not "unknown".** A v1 dash-form ref (`MS-SPEC-019`,
  `SC#26` with a 2-letter code) is not reported as an unknown code. Whether it gets a
  separate "legacy form" hint is left to #681 (corpus migration) and is out of scope here.
- **FR-7 - Fenced code and inline code are skipped.** Tokens inside fenced code blocks or
  inline backticks are not candidates, so quoted grammar examples (as in DR-053 itself)
  never trigger the advisory.
- **FR-8 - Advisory severity only.** Each unknown code is surfaced as an
  **Information**-severity diagnostic on the token, source `MinSpec`, message naming the
  code and the table path. It is never Warning or Error. It never feeds `npm run
  validate`, the pre-commit hook, CI, or any required check (DR-053 §5).
- **FR-9 - Known codes are silent.** A cross-project ref whose code is in the table
  produces no diagnostic. This spec does not render known refs; that is SPEC-035's
  lozenge work.

### C. Offering the fix (non-modal)

- **FR-10 - One toast per unknown code, then silence.** The first time an unknown code is
  detected in a workspace, MinSpec shows **one** non-modal information toast: "`XYZ` is
  not in the project-prefix table. Add it?" with actions **Add to table** and **Not now**.
  The toast does not take focus. After either action, or if the toast is dismissed, no
  further toast is shown for that code in that workspace (remembered in workspace state).
  The diagnostic (FR-8) stays until the row exists. A one-time prompt asks once and then
  stays quiet. It never silently picks a default.
- **FR-11 - Quick Fix on the diagnostic.** The same "Add to table" action is available as
  a Quick Fix on the diagnostic. This is the way back in after the toast has been
  dismissed.
- **FR-12 - "Add to table" edits, the human saves.** The action opens
  `.minspec/project-prefixes.md` (creating it from the standard template if absent, inside
  `.minspec/` only), appends a row `| XYZ | <project> | <repo> |` as an unsaved edit, and
  selects the project cell for the user to type over. MinSpec does not save the file. The
  human confirms by saving it, which is the auto-detect-and-offer pattern #500 asks for.
- **FR-13 - Palette path for a project with no code yet.** A command **MinSpec: Add
  Project Prefix** asks for the project name (and optionally the repo `owner/repo`),
  asks the suggestion provider for a code, and opens the same pre-filled, unsaved row as
  FR-12. This covers #500's "a project has none yet" case. (Kept or dropped by Clarify D-3.)
- **FR-14 - Uniqueness at offer time.** A suggested code is never one already in the
  table. If the user types a code that duplicates an existing row, the next table save
  surfaces an Information diagnostic on the duplicate row. `parsePrefixTable` already
  keeps the first occurrence and drops later ones, so the duplicate is never silently
  honoured.

### D. Suggestion provider seam (Tier-0 default, Tier-1 slot)

- **FR-15 - One provider interface.** A `PrefixSuggestionProvider` with two operations:
  `suggestCode(project, takenCodes) → code` and `suggestProject(code, knownProjects) →
  project | undefined`. Both resolve in the same call. Neither may throw for an ordinary
  "no idea" answer; an `undefined` project leaves the cell blank for the human.
- **FR-16 - Built-in provider is deterministic and offline.** The default provider
  implements `suggestCode` with the v2 rule from DR-053 §1: first 3 letters of the
  project name, uppercased, walking forward on collision so a batch of projects never
  collapses to one code. `suggestProject` returns `undefined`, since nothing offline can
  infer a project from three letters. Identical input yields identical output.
- **FR-17 - Tier-1 registers, MinSpec never calls a model.** A Tier-1 extension
  (agent-execute, DR-015) may register a provider that replaces the default. MinSpec
  itself makes no network or model call on any path in this spec. If a registered
  provider throws, times out (budget set in Plan) or returns a code that fails the
  3-letter or uniqueness rule, MinSpec falls back to the built-in provider and still
  shows the offer. A failing provider never removes the offer.

## Acceptance Criteria

- **AC-1** In a workspace with `.minspec/`, a spec containing `XYZ/SP3` (XYZ not in the
  table) shows one Information diagnostic on `XYZ/SP3` and one toast, and nothing is
  written to disk.
- **AC-2** Reopening the spec, saving it, or reloading the window shows no second toast
  for `XYZ`. The diagnostic is still present.
- **AC-3** Choosing **Add to table** opens the table with an unsaved appended row
  starting `| XYZ |`. Saving the table clears the `XYZ/SP3` diagnostic without a reload.
- **AC-4** In a workspace **without** `.minspec/`, the same text produces no diagnostic,
  no toast and no file read of `.minspec/project-prefixes.md`.
- **AC-5** Negative detection, using the measured corpus forms: `OQ#1`, `PR#996`,
  `MS-SPEC-019`, `MS#500`, `SC-DR-007`, a bare `SEA`, prose "fly into SEA", and any token
  inside backticks or a fenced block produce **zero** findings.
- **AC-6** Known-code refs `MIN/SP19`, `SCR#204`, `SCR/DR7/FR3` produce zero findings
  against the committed table.
- **AC-7** Running the detector over the full current corpus (`specs/`, `docs/decisions/`)
  yields a finding list that is printed in the implementation PR. Each entry is either a
  genuine unknown cross-project ref or the detector is tightened. The count is stated,
  not asserted as zero.
- **AC-8** `npm run validate`, the pre-commit hook and CI pass on a tree that contains an
  unknown code. The advisory never gates.
- **AC-9** With no Tier-1 provider registered, **MinSpec: Add Project Prefix** given
  `sealbox` with `SEA` taken suggests a 3-letter uppercase code that is not `SEA` and not
  any other code in the table. The exact collision walk is defined in Plan and pinned by a
  unit test.
- **AC-10** A registered provider that throws, or returns `SEAL`, `se`, or an existing
  code, results in the built-in suggestion being offered, and the toast still appears.
- **AC-11** A static test asserts the new modules import nothing from `http`, `https`,
  `net`, `fetch` wrappers or any model SDK (invariant 1).

## Invariants (must not break)

- **Constitution 1 - offline.** No network or model call on any path. The Tier-1 provider
  is someone else's extension, opted into by installing it.
- **Constitution 2 - no silent gate.** This feature is advisory and is deliberately **not**
  a gate. It must never be wired into a required check. If a later change does make it
  gating, that change owns the fail-closed rule; this spec does not.
- **Constitution 3 - blast radius.** Reads and writes happen only under a workspace
  folder that has `.minspec/` at its root. The only write is the unsaved edit to
  `.minspec/project-prefixes.md`, and the human saves it.
- **DR-053 §5 - not fail loud.** An unknown code never throws, never errors, and is never
  silently dropped. It is always visible as at least the diagnostic.
- **DR-053 §4 - detection contract.** No bare-code or 2-letter detection.
- **DR-027 - separate registers.** Unprefixed local ids are never flagged.
- **HITL UX** - toasts are non-modal and never steal focus.

## Decisions needed (Clarify)

- **D-1 - Fold #679 in, or wait for it?** `a` Keep #679 a separate predecessor and block
  this spec's build on it **(rec)**. Cost: nothing here ships until #679 lands, and #679
  has no spec of its own yet. `b` Fold the module v1-to-v2 update into this spec. Cost:
  this spec grows into the shared module and its grammar tests, a much larger T3 with a
  second review surface (SPEC-035 also consumes the module).
- **D-2 - Does this spec close #614 as well as #500?** `a` Yes: #614 is DR-053's name for
  exactly FR-10 to FR-17, so one spec materialises both **(rec)**. Cost: #614's own
  wording, which this session could not read offline, may hold a requirement not captured
  here, so it should be checked before #614 is closed. `b` No, keep #614 separate. Cost:
  two specs over one toast.
- **D-3 - Keep the palette command (FR-13)?** `a` Keep it **(rec)**. Without it, #500's
  "a project has none yet" case has no entry point, because no flow in the extension
  emits a cross-project ref today. Cost: one more palette command. `b` Drop it and handle
  only unknown codes found in text. Cost: adding a project means hand-editing the table.
- **D-4 - Scan scope.** `a` Approvable documents only: `specs/`, `docs/decisions/`, epic
  files **(rec)**. Cost: a bad code in `CLAUDE.md` or a README goes unflagged. `b` Every
  markdown file in an opted-in workspace. Cost: more noise, and READMEs are where prose
  like "SEA#1" is likeliest.
- **D-5 - Toast memory scope.** `a` Per workspace, in VS Code workspace state, not
  committed **(rec)**. Cost: each clone or machine sees the toast once. `b` Committed
  under `.minspec/`. Cost: a dismissal becomes a tracked file change and a merge-conflict
  surface for a cosmetic preference.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Built before #679, the table yields the `MIN-SPEC-019` chimera | FR-4 build-order gate; D-1 |
| R2 | False positives in prose annoy and train users to ignore MinSpec | FR-5/FR-7 contract; AC-5 negative set from measured corpus; AC-7 corpus run |
| R3 | A Tier-1 provider returns junk or hangs | FR-17 validation + fallback; AC-10 |
| R4 | Advisory quietly promoted to a gate later | Invariant: never in a required check; AC-8 |
| R5 | Egress guard (DR-032 / SPEC-021) does not know v2 refs | Out of scope here; tracked by DR-053's egress follow-up |

## Out of Scope

- The `project-prefix` module v1-to-v2 change itself (#679), unless D-1 says otherwise.
- Corpus migration to v2 refs, and any legacy-form hint (#681).
- Rendering known refs as lozenges or hover cards (SPEC-035).
- Cross-repo **number allocation** (#124) and mint-at-merge (#267). Prefixes disambiguate
  ids. They do not allocate them.
- Resolving a ref to the other repo's content (needs network or a sibling checkout).

## Alternatives considered and rejected

- **Fail loud on an unknown code** (validator error). Rejected by #500 and DR-053 §5.
  It blocks a commit over a missing table row.
- **Write the row automatically.** Rejected. The table is a committed decision, and an
  agent-minted row is a borrowed sign-off. The human saves the edit (FR-12).
- **Call a model from MinSpec for the suggestion.** Rejected by invariant 1 and DR-004.
  The seam (FR-15 to FR-17) gives the same outcome when a Tier-1 extension is installed.
- **Modal dialog.** Rejected. It steals focus. Non-modal toast plus Quick Fix instead.

## Traceability

- Issue: [#500](https://github.com/AIClarityAU/minspec/issues/500). Tier-1 half:
  [#614](https://github.com/AIClarityAU/minspec/issues/614).
- Decision: [DR-053](../../../docs/decisions/DR-053.md) (accepted). No new DR.
- Predecessor: [#679](https://github.com/AIClarityAU/minspec/issues/679).
- Siblings: SPEC-035 (render consumer), SPEC-025 (provider-seam precedent), #681
  (migration), #396 (duplicate-id gate).
