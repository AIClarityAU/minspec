---
id: SPEC-182
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - validator-asymmetry family (soft side) + Tier-1 advisor seam
aspects: [validate, advisory, project-prefixes, toast, consent, tier-0, tier-1]
relates_to: [DR-053, DR-050, DR-004, "#500", "#614", "#561", "#396", "#679"]
---

# SPEC-182: Unknown cross-project prefix advisory

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers the questions under *Decisions needed (Clarify)*, and approves it through the
> normal spec-approval gate before any code changes. Requirements are written under each
> decision's recommended option, so approving as-is accepts those recommendations.

Materializes [#614](https://github.com/AIClarityAU/minspec/issues/614) - the Tier-1 seam
atop [DR-053](../../../docs/decisions/DR-053.md) / [#500](https://github.com/AIClarityAU/minspec/issues/500).

## Problem

#500 landed the Tier-0 core: `.minspec/project-prefixes.md` and the `@aiclarity/shared`
`project-prefix` module. `resolveRef` (`packages/shared/src/project-prefix.ts:144`) returns
`{ status: 'unknown-prefix' }` for a prefixed token (`XX-SPEC-NNN`, `XX-DR-NNN`,
`XX-EPIC-NNN`, `XX#NNN`) whose prefix has no table row, and never throws. **Nothing consumes
that result.** A corpus artifact citing `ZZ-SPEC-004` for a project missing from the table
is silently accepted: the reference is unresolvable and no one is told the table is
incomplete.

## Scope

In: (a) a non-fatal `validate` warning, (b) a consent-gated toast offering to add a table
row, (c) an optional offer during `MinSpec: Initialize SDD Structure` to seed rows for
sibling repos.
Out: the Tier-0 core (done, #500); within-repo id uniqueness (#396); the v2 `/`-joined
grammar (`MIN/SP19/FR3`) - emitter and resolver are still v1 dash grammar until #679, and
this spec detects only what `resolveRef` resolves today (see FR-9).

## Functional requirements

- **FR-1 (detect, pure).** A pure function in the Tier-0 layer scans artifact text and returns
  every token that `resolveRef` classifies `unknown-prefix`, with file-relative line,
  the prefix, and the token. It uses `parsePrefixTable` over the table text and takes the
  table text as input (no filesystem, no `vscode`, no network). Local refs and known
  cross-project refs are never reported.
- **FR-2 (scan surface).** The detector scans the same corpus the validator already walks
  (`specs/`, `docs/decisions/`, per SPEC-075 corpus-from-config), skipping fenced code
  blocks and inline code spans so that quoted examples (as in this spec) do not warn.
- **FR-3 (warning, never fatal).** `npm run validate` and the in-extension validator emit one
  **warning**-severity diagnostic per distinct unknown prefix per file, naming the prefix,
  the first offending token with line, and the path `.minspec/project-prefixes.md`. Exit
  code is unchanged: an unknown prefix must never fail `validate`, never block commit, never
  fail CI (the #500 "do not fail loud" contract).
- **FR-4 (missing or malformed table is not a warning storm).** If `.minspec/project-prefixes.md`
  is absent, the detector emits no per-token warnings; it emits at most a single
  repo-level informational line. A half-edited table degrades to its good rows
  (`parsePrefixTable` already ignores malformed rows).
- **FR-5 (toast offer).** When the extension detects unknown prefixes (on save of a corpus
  file, or on the validate run), it shows ONE non-modal toast per prefix per session, over
  the visible artifact, offering "Add row" and "Dismiss". "Dismiss" records the prefix as
  declined for the workspace so it is not re-offered (see DQ-3). Never a modal; never
  focus-stealing.
- **FR-6 (suggest, Tier-0 default).** "Add row" opens an input prefilled with
  `suggestPrefixDeterministic(project, takenPrefixes)` where the project name is taken from
  a sibling-repo name if resolvable, else left for the human to type. Works fully offline.
- **FR-7 (suggest, Tier-1 optional).** If and only if the user has already opted into a Tier-1
  model for suggestions (DR-004 / DR-050 consent model), a nicer prefix may replace the
  prefill (`minspec -> MS` rather than `MI`). It is a suggestion in the same editable
  input; the Tier-0 value is the fallback when Tier-1 is off, unavailable, or errors. No
  network call is made without that prior consent (constitution invariant 1).
- **FR-8 (consent-gated write).** The row is appended to `.minspec/project-prefixes.md` only
  after the human confirms or edits the value in the input. The write: refuses a prefix
  already in the table (case-insensitive) or a project already present; validates the
  prefix against the same `[A-Z]{2,5}` shape the parser accepts; is an append that
  preserves the file's existing bytes and line endings (no re-serialising the table); and
  is skipped silently-visibly (error toast, no write) on any failure - never a swallowed error.
- **FR-9 (grammar boundary).** Detection covers exactly the tokens `resolveRef` handles. Tokens
  of the DR-053 v2 slash grammar are not detected until #679 widens `resolveRef`; this spec
  names that dependency rather than re-implementing parsing, so there is one grammar owner.
- **FR-10 (init offer).** During `MinSpec: Initialize SDD Structure`, if sibling directories
  at the workspace's parent contain `.minspec/` (the opt-in marker) and have no row in the
  table, offer once to seed them, listing each proposed `prefix | project` for per-row
  confirmation. Declining seeds nothing. Reading sibling directories is a local read only;
  the workspace's own repo is never modified by looking at a sibling, and a sibling is
  never written to.
- **FR-11 (opt-in boundary).** None of FR-1..FR-10 runs, warns or writes in a repo without
  `.minspec/` (constitution invariant 3).

## Acceptance criteria

- **AC-1.** Given a spec containing `ZZ-SPEC-004` and no `ZZ` row, `validate` prints a warning
  that names `ZZ` and `.minspec/project-prefixes.md` and exits 0.
- **AC-2.** Given the same text inside a fenced block or backticks, no warning.
- **AC-3.** Given a known prefix (`MS`) and bare local refs (`SPEC-004`, `#500`), no warning.
- **AC-4.** Given no table file, zero per-token warnings and exit 0.
- **AC-5.** Declining the toast writes nothing; accepting writes exactly one appended row and a
  re-run of `validate` no longer warns for that prefix.
- **AC-6.** A duplicate prefix or invalid shape in the input is rejected with a visible message
  and the file is byte-identical afterwards.
- **AC-7.** With the Tier-1 option off, the prefill equals `suggestPrefixDeterministic` and no
  network call occurs (asserted by a test that fails on any network attempt).
- **AC-8.** In a directory without `.minspec/`, nothing in this spec activates.

## Invariants this must not break

- Constitution 1: offline by default; Tier-1 suggestion only after existing consent.
- Constitution 2: a warning is advisory by design, NOT a gate, so the "no silent gate" rule is
  satisfied by never pretending it gates; the write path fails visibly (FR-8).
- Constitution 3: blast radius is the installed project; siblings are read-only (FR-10/11).
- DR-053: the table remains the single source; the Tier-0 module stays free of `vscode`/network
  and stays the one grammar owner.

## Decisions needed (Clarify)

- **DQ-1 - false positives on `XX#NNN`.** `resolveRef`'s issue form matches any 2-5 capital
  letters before `#NNN`, so `PR#12`, `CI#3`, `ID#4`, `HEAD#1` look like unknown prefixes.
  Options: **(a, rec)** a built-in ignore-list of common non-project tokens plus a table-side
  `ignore` convention - fewer false warnings; costs a maintained list and a small grammar
  addition to the table file. (b) Warn on `XX-KIND-NNN` forms only and skip bare `XX#NNN` -
  zero false positives; costs missing real unknown issue-prefixes. (c) Warn on everything -
  simplest; costs noise that teaches users to ignore the warning.
- **DQ-2 - toast trigger.** **(a, rec)** On save of a corpus file - immediate and in context;
  costs a save hook and debouncing. (b) Only after a `validate` run - simpler; costs the
  offer arriving late and rarely.
- **DQ-3 - where "declined" persists.** **(a, rec)** Workspace state (not committed) - no repo
  churn; costs the decline being per-machine. (b) A committed `ignore` row in the table -
  shared across collaborators; costs a mutating write the user did not ask for on decline.
- **DQ-4 - sibling discovery for FR-10.** **(a, rec)** Immediate siblings of the workspace
  folder only - bounded and predictable; costs missing repos kept elsewhere. (b) A
  configurable list of roots - flexible; costs a new setting and a wider filesystem read.
- **DQ-5 - Tier-1 suggestion in this slice.** **(a, rec)** Specify the seam (FR-7) but build
  Tier-0 prefill first - ships offline value; costs the nicer prefix arriving later.
  (b) Build both together - complete; costs coupling to the consent model and a larger PR.
- **DQ-6 - sibling spec.** #561 (autolink-advisor) is cited as the shape sibling, but no
  `autolink` advisor exists in the tree today. Shall this spec define the shared
  "Tier-0 read / Tier-1 suggest / consent-gated write" helper itself, or reuse
  `ruleset-advisor` (DR-050) only? **(a, rec)** Reuse the DR-050 shape without extracting a
  shared helper - minimal blast radius; costs a second near-copy that #561 may later
  need to reconcile. (b) Extract a shared helper now - one shape; costs touching an
  accepted advisor outside this issue's scope.
