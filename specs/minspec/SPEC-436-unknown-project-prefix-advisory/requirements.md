---
id: SPEC-436
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a cross-project ref must say which project it means, and an unknown code must be visible, not silently dropped
aspects: [references, cross-project, tier-0, tier-1-seam, advisory, ux]
depends_on: [DR-053]   # the accepted reference grammar and its "not fail loud" + tier-split rules (§5, §6)
relates_to: [DR-053, DR-027, DR-004, SPEC-035, SPEC-025, SPEC-021, "#500", "#58", "#614", "#679", "#681", "#267", "#124"]
implements: none
implements_reason: >-
  Specify phase only. Which files carry the work is decided at Plan. The likely
  candidates are packages/shared/src/project-prefix.ts (suggester and typo-match helpers,
  after #679 lands), packages/minspec/src/lib/diagnostics.ts or a sibling module (the
  advisory diagnostic), and a new extension-side table loader and toast.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — An unknown project code in a cross-project reference gets a suggestion and an offer to edit the table, never a failure (Requirements)

> **SPECIFICATION ONLY.** Written by a Specify-only dispatch (DR-076/#1169). Nothing is built
> until a human resolves **Decisions needed (Clarify)** and approves it.

> Materializes [#500](https://github.com/AIClarityAU/minspec/issues/500) (short project
> prefix for cross-project SDD refs). The design decision behind it is already recorded and
> accepted: [DR-053](../../../docs/decisions/DR-053.md) (paragraph-addressable reference
> scheme). §5 makes an unknown code advisory, §6 splits the work into Tier-0 (offline core:
> read, resolve, format, deterministic suggestion) and Tier-1 (assistant suggestion), and §9
> reserves `CON`. **No new decision record is minted**: everything here that cannot be undone
> in under a day is already settled in DR-053.

## One-Sentence Scope

When an artifact cites another project with a project code the table
`.minspec/project-prefixes.md` does not know, MinSpec shows a visible, non-blocking advisory
that suggests a code and offers to add the row. The deterministic offline core always
produces the suggestion, and an optional Tier-1 provider may replace it with a better one.

## What #500 asked for vs what DR-053 settled

#500 (2026-07-05) asked for a **2-letter**, dash-joined prefix (`MS-SPEC-019`). DR-053 v2,
accepted 2026-07-14, superseded that form with **3 uppercase letters, slash-joined**
(`MIN/SP19`, `SCR#204`), case-insensitive on input. This spec follows DR-053, not the issue
title. The parts of #500 that still hold are: a committed, editable mapping table; a
deterministic Tier-0 core; never failing loud; a suggestion plus a non-modal offer to edit
the table; and the LLM as an optional Tier-1 seam.

## Current behaviour (cited, checked on 2cb12b06)

- **Mapping table: exists.** `.minspec/project-prefixes.md` holds the 3-letter rows
  `MIN`/`SCR`/`SEA`/`MMO`. Its own banner says that no runtime loader reads it today.
- **Tier-0 core: built, but still the v1 grammar.** `packages/shared/src/project-prefix.ts`:
  - `parsePrefixTable` (`:103`) reads pipe rows and skips any row with an empty project cell
    (`:126`).
  - `resolveRef` (`:144`) returns `'unknown-prefix'` rather than throwing. It only matches
    the v1 forms `XX-SPEC-019` and `XX#500` (prefix regex `[A-Z]{2,5}`, `:86`), not `MIN/SP19`.
  - `suggestPrefixDeterministic` (`:223`) returns **2** letters (`:236`) and does not reserve
    `CON`.
- **No extension caller.** A grep of `packages/minspec/src` for `parsePrefixTable`,
  `resolveRef`, `suggestPrefix` and `unknown-prefix` returns nothing. Outside the shared package, the table's
  path appears only as data in dispatch scope lists (`scripts/dispatch-issue.sh:390`,
  `packages/minspec/tests/dispatch-automerge-doc-exclusion.test.ts:118`), never as input to
  a reader. So today an unknown code
  produces no signal anywhere: it is not an error and it is not an advisory either.
- **Existing surface to reuse.** `packages/minspec/src/lib/diagnostics.ts:202`
  (`registerReferenceDiagnostics`) already puts dangling-reference squiggles on specs and DRs
  through one `DiagnosticCollection`, and `isCheckableArtifact` (`:165`) defines which files
  count.
- **Existing provider-seam pattern.** `ConstitutionProvider`
  (`packages/minspec/src/lib/constitution-proposer.ts:78`, SPEC-025) has a deterministic seed
  now and a Tier-1 LLM provider later, behind one interface. FR-5 copies that shape.
- **Hard predecessor.** [#679](https://github.com/AIClarityAU/minspec/issues/679) moves the
  module from v1 to v2 (slash grammar, 3-letter codes, `#N` cross-project, dual-read,
  version-aware gate, `CON` reservation). DR-053 calls it a *hard predecessor to any runtime
  table use*. This spec cannot ship before #679 merges.

## Functional Requirements

- **FR-1 Load the table.** The extension reads `.minspec/project-prefixes.md` from the
  workspace root through an fs adapter and parses it with the shared Tier-0 parser. A
  missing or unreadable file gives the empty map (every code is unknown), never an
  exception. A save of the table file refreshes the map and re-evaluates every open
  artifact. No network call is made.
- **FR-2 Detect cross-project refs by the DR-053 §4 contract.** In the same artifact set
  that `isCheckableArtifact` admits, find cross-project tokens using the v2 grammar from
  #679: a PROJECT segment followed by an approvable segment (`XYZ/SP3`, `XYZ/DR7/FR2`,
  `XYZ#12`, `XYZ/CON/G-3`). A bare 3-letter word (`SEA`, `MIN`) is never a reference (§4).
  Detection skips fenced code blocks and inline code spans, so an example in documentation
  does not trigger an advisory.
- **FR-3 Unknown code produces a visible advisory, never a failure.** Each detected token
  whose PROJECT code is not in the map gets one editor diagnostic at the token. Its severity
  is set by DQ-1 and is never `Error`. The message names the code and the suggestion from
  FR-4. `npm run validate`, the pre-commit hooks and CI do **not** fail on an unknown code
  (DR-053 §5). A known code produces no diagnostic.
- **FR-4 Deterministic suggestion (Tier-0, always available).** For an unknown code the
  core produces, offline:
  - (a) **Likely typo.** If exactly one known code is within one edit (one substitution,
    insertion, deletion or adjacent transposition, case-insensitive), it is offered as
    "did you mean `MIN`?". If two or more qualify, none is offered.
  - (b) **New row.** Otherwise the core offers to add the code the author typed, as a new
    row. The author typed this code, so it is used as-is and not replaced. It is offered
    only if it is grammatical: 3 letters, not taken, not `CON`.
  - (c) **Ungrammatical code.** If the typed code is not grammatical (for example a v1
    2-letter code; see DQ-4), the core suggests a grammatical code from the v2 suggester
    (3 letters, skipping taken codes and `CON`).
- **FR-5 Tier-1 suggestion seam.** A `PrefixSuggestionProvider` interface (contract below)
  lets a Tier-1 provider (the assistant or the `agent-execute` extension) propose a
  suggestion. Only the deterministic provider ships in this spec. A provider result passes
  the same Tier-0 checks as FR-4 (grammatical, unique, not `CON`) before it is shown. A
  result that fails them, an error, or no answer within the provider's timeout all fall back
  to the deterministic suggestion silently, because the advisory still shows. An LLM
  suggestion is never written to disk without the author's explicit action (FR-6).
- **FR-6 Non-modal offer to edit the table.** On **save** of an artifact that introduces an
  unknown code (not on every keystroke), MinSpec shows one non-modal information toast with
  these actions:
  - **"Add `XYZ` to project table"** opens `.minspec/project-prefixes.md` and inserts the
    proposed row as an *unsaved* edit, cursor in the empty project cell. The author fills in
    the cell and saves.
  - **"Use `MIN`"** appears only for a typo suggestion. It replaces the token in the artifact
    as an unsaved edit.
  - **"Don't ask for `XYZ`"** suppresses the toast for that code in this workspace. The
    diagnostic from FR-3 stays.

  The toast never steals focus, never uses `modal: true`, and appears at most once per code
  per session.
- **FR-7 Row insertion is a text edit, not a rewrite.** The new row is inserted as text
  directly after the last row of the table. Other bytes of the file are not re-serialised or
  reformatted, and the row uses the uppercase rendered form. A table with no rows still has
  its header row, and the insertion goes after the header separator. A row saved with the
  project cell left empty is dropped by the parser (`project-prefix.ts:126`), so the code
  stays unknown and the diagnostic stays visible. The unfinished entry is not silently
  accepted.
- **FR-8 Quick fix parity.** The same actions as FR-6 are offered as code actions on the
  FR-3 diagnostic. Dismissing the toast or suppressing a code therefore never removes the
  way to fix it.
- **FR-9 `CON` is reserved.** Neither the deterministic suggester, a provider result nor the
  add-row action ever proposes or inserts `CON` as a project code (DR-053 §9). A table row
  that already holds `CON` is not used for resolution (the #679 resolver owns that rule) and
  gets an advisory diagnostic in the table file itself.
- **FR-10 Opt-in only.** All of this runs only in a workspace with `.minspec/` at the repo
  root (constitution invariant 3). In any other repo it neither activates nor writes.

### Contract (Tier-0, `@aiclarity/shared`; final names settled at Plan)

```ts
/** Why the core is suggesting: a likely typo of a known code, or a new row. */
export type PrefixSuggestionKind = 'typo' | 'new-row';

export interface PrefixSuggestion {
  kind: PrefixSuggestionKind;
  /** The unknown code as typed, uppercased. */
  unknown: string;
  /** For 'typo': the known code meant. For 'new-row': the code to add (FR-4b/c). */
  code: string;
  /** 'deterministic' or the provider's id: the advisory names where the suggestion came from. */
  source: 'deterministic' | string;
}

/** Pure, offline: FR-4. Never throws; always returns one suggestion. */
export function suggestForUnknownCode(unknown: string, map: PrefixMap): PrefixSuggestion;

/** Pure: FR-5/FR-9 gate on any suggestion, including a provider's. */
export function isAcceptableNewCode(code: string, map: PrefixMap): boolean;

/** Tier-1 seam (extension side, mirrors SPEC-025's ConstitutionProvider). */
export interface PrefixSuggestionProvider {
  readonly id: string;
  /** May return undefined; any rejection or timeout → deterministic fallback. */
  suggest(unknown: string, context: { map: PrefixMap; artifactPath: string }): Promise<PrefixSuggestion | undefined>;
}
```

## Acceptance Criteria

- **AC-1** Table `MIN/SCR/SEA/MMO`. Artifact cites `MNI/SP19`: one diagnostic on the
  `MNI` token suggests `MIN` (typo). `XYZ/SP3`: one diagnostic suggests adding `XYZ` as a new
  row. `MIN/SP19`: no diagnostic (FR-2, FR-3, FR-4).
- **AC-2** The prose words `SEA`, `fly into SEA` and `Apple M1`, and a fenced block containing
  `XYZ/SP3`, produce no diagnostic (FR-2).
- **AC-3** With `XYZ/SP3` unknown, `npm run validate` and the pre-commit hook exit 0 (FR-3).
  *Negative control:* with a genuine frontmatter error injected, validate still fails, so
  the advisory cannot mask a real failure.
- **AC-4** `.minspec/project-prefixes.md` absent: every cross-project token gets an advisory
  and nothing throws. After the file is created and saved, the known codes clear without a
  reload (FR-1).
- **AC-5** The add-row action on a table with four rows inserts exactly one line after the
  last row. All other bytes are identical, including non-ASCII characters and CRLF endings.
  The edit is unsaved. Saving it with the project cell empty leaves `XYZ` unknown and the
  diagnostic shown (FR-6, FR-7).
- **AC-6** A provider that returns `CON`, `MIN` (already taken), `AB` (2 letters) or
  throws, or does not answer within its timeout, results in the deterministic suggestion
  being shown and no write. A provider returning a valid unused code has it shown with its
  `source` named (FR-5, FR-9).
- **AC-7** Saving the same artifact twice with the same unknown code shows the toast once.
  After "Don't ask for `XYZ`" the toast does not appear again for `XYZ` in that workspace,
  but the diagnostic and its quick fix remain (FR-6, FR-8).
- **AC-8** In a folder without `.minspec/`, opening a markdown file that cites `XYZ/SP3`
  produces no diagnostic, no toast and no file write (FR-10).
- **AC-9** A unit test asserts that the deterministic suggestion path makes no network call
  and does not import `vscode`. It runs under the shared package's existing Tier-0 import
  test, if one exists, or a new one (invariant 1).
- **AC-10** `suggestForUnknownCode` never returns `CON`, never returns a taken code for
  `new-row`, and always returns 3 uppercase letters for `new-row`. This is a property test
  over random project names and random taken-sets (FR-4, FR-9).

## Invariants this must not break

- **Offline core** (constitution inv. 1): detection, resolution and the deterministic
  suggestion use no network. The Tier-1 provider is optional, off by default, and its
  absence changes nothing but the suggestion's source.
- **No silent gate** (inv. 2): this is deliberately **not** a gate (DR-053 §5), so it must
  not be added to any required check. It is also never *silent*: an unknown code always
  yields a visible diagnostic, and suppressing the toast never suppresses the diagnostic.
- **Blast radius** (inv. 3): it activates only under `.minspec/` and writes only the
  project's own `.minspec/project-prefixes.md`, and only through an unsaved edit that the
  author saves.
- **DR-027 separate registers**: local ids stay unprefixed. Nothing here adds a prefix to an
  intra-project ref.
- **DR-053 §4 detection contract**: a ref must carry an approvable segment. Bare codes are
  never detected.
- **HITL UX**: non-modal, focus-preserving, at most once per code per session. The
  author's edit is the confirmation, and nothing is written on their behalf.

## Out of scope

- The `project-prefix` module's move from v1 to v2 (grammar, dual-read, version-aware gate,
  `CON` in the resolver) is [#679](https://github.com/AIClarityAU/minspec/issues/679), a hard
  predecessor.
- Corpus migration to the v2 grammar is [#681](https://github.com/AIClarityAU/minspec/issues/681).
- Rendering refs as lozenges or hover cards is SPEC-035.
- Teaching the DR-032/SPEC-021 egress guard the v2 grammar is DR-053's egress follow-up.
- Building any real Tier-1 LLM provider. Only the interface and the deterministic provider
  ship here.
- Numbering within a repo (#267) and across repos (#124).

## Decisions needed (Clarify)

- **DQ-1 Diagnostic severity for an unknown code.**
  - (a) **(rec)** `Information`. It shows in the Problems panel and as a blue squiggle,
    which is visible without reading as a defect, matching DR-053 §5's "advisory". Cost: it
    is easier to ignore than a warning, so an unknown code can persist in merged docs.
  - (b) `Warning`, the same as dangling refs. Cost: it puts an advisory on the same level
    as a real broken reference and adds noise to the existing collection.
  - (c) `Hint`. Cost: nearly invisible (dots only, not in the Problems panel), which comes
    close to the "silent drop" DR-053 §5 forbids.
- **DQ-2 Overlap with #614.** DR-053's Follow-ups lists
  [#614](https://github.com/AIClarityAU/minspec/issues/614) as "Tier-1 advisory (unknown
  code → suggest + edit table)", which is this spec's scope. This dispatch could not read
  #614 (no network), so the overlap is inferred from DR-053's one-line label, unverified.
  - (a) **(rec)** This spec owns the whole advisory (Tier-0 suggestion, seam, toast, table
    edit). #614 is re-scoped to building a real Tier-1 provider against FR-5's interface, or
    closed as materialized here. Cost: someone must re-read #614 and edit it, or two
    trackers drift.
  - (b) This spec keeps only the Tier-0 parts and #614 owns the seam and toast. Cost: the
    toast and its fallback get specified twice, in two places.
- **DQ-3 Typo suggestion (FR-4a) in scope?**
  - (a) **(rec)** Yes, edit distance 1 with a unique match. With only four codes, a typo is
    the most likely cause of an unknown code. Cost: one more pure helper and its tests, and
    a wrong guess is possible when a genuinely new code sits one letter from an old one
    (the new-row action is still offered alongside).
  - (b) No, offer only new-row. Cost: a typo invites the author to add a junk row.
- **DQ-4 Legacy v1 tokens (`MS-SPEC-019`, `MS#500`).** #679's dual-read resolves these, but
  `MS` is not in the 3-letter table.
  - (a) **(rec)** No advisory for a v1-form token. The #681 migration rewrites them, and
    flagging them now would light up every pre-migration doc. Cost: a real unknown v1 code
    is also silent until migration. That is acceptable only because v1 codes are a closed,
    historical set.
  - (b) Advise on v1 tokens, with a quick fix to rewrite to v2. Cost: it pulls migration
    work forward into this spec and floods diagnostics.
- **DQ-5 "Project has no prefix yet" while composing a ref** (#500's second case:
  `formatCrossRef` returns null).
  - (a) **(rec)** Defer. No extension command composes cross-project refs today (the grep
    above found no caller), so there is no surface to attach a toast to. The Tier-0
    suggester serves that future caller as-is. Cost: an agent writing a ref to an unmapped
    repo gets no prompt until such a command exists.
  - (b) Add a "MinSpec: Add Project Prefix" palette command now. Cost: it adds a public
    surface with no consumer (scope creep under the triage rules).

## Follow-ups (tracked)

- [#679](https://github.com/AIClarityAU/minspec/issues/679): module v1→v2, hard predecessor.
- [#614](https://github.com/AIClarityAU/minspec/issues/614): reconcile per DQ-2.
- None new: every other consequence is listed under Out of scope with an existing owner.
