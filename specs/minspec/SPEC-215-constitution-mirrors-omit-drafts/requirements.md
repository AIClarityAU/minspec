---
id: SPEC-215
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a harness mirror must not present a pending proposal as a binding rule
aspects: [harness, constitution, template-registry, signpost-integrity, tier-0, offline]
depends_on: [SPEC-025]  # SPEC-025 owns the DRAFT convention (INV-2, FR-7, FR-8 compaction) this spec reads
relates_to: [SPEC-025, SPEC-043, SPEC-095, "#1937", "#705", "#2520", "AIClarityAU/memory-fabric#30"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3).
implements: none
implements_reason: >-
  Every change lands in existing shared files (constitution.ts, template-registry.ts,
  template-engine.ts, constitution-compaction.ts) that many specs touch; owning them from a
  defect spec would freeze them for every other change.
# Modified, not owned. template-registry.ts is machinery: its pull request needs a human
# --admin merge and never auto-merges.
affects: [packages/minspec/src/lib/constitution.ts, packages/minspec/src/lib/template-engine.ts, packages/minspec/src/lib/template-registry.ts, packages/minspec/src/lib/constitution-compaction.ts, packages/minspec/src/lib/constitution-nudge.ts, packages/minspec/src/lib/constitution-proposer.ts, packages/minspec/tests/refresh-constitution-draft-fixed-point.test.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-215: Constitution mirrors leave out DRAFT entries, and say how many they left out

## In plain terms

A constitution entry that starts with `DRAFT:` is a proposal waiting for a human to accept
it (SPEC-025 INV-2). MinSpec copies the lead sentence of every Invariants entry into
CLAUDE.md, AGENTS.md and `.cursorrules`, under a heading that says "These rules must never
be violated". It copies DRAFT entries too. So an agent that reads only CLAUDE.md is told
that unaccepted proposals are rules it must never break. On one real adopter
constitution (AIClarityAU/memory-fabric#30), 15 of the 25 lines in that list were pending.

This spec makes the three mirror files leave DRAFT entries out of their lists, and print
one line saying how many were left out and where to find them. `constitution.md` itself
does not change. Cost: an agent that reads only the instruction files no longer sees
pending rules until a human accepts them (via **MinSpec: Compact Constitution** or by
deleting the marker). That is the intent, but it is a real loss of signal for anyone who
relied on the agent obeying a rule before accepting it.

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. A human reads
> it, checks the four questions under **[Decisions needed (Clarify)](#decisions-needed-clarify)**,
> and approves it through the normal spec-approval gate before any code changes. Every
> requirement is written under the recommended answer, so approving the spec as it stands
> accepts those answers.

Materializes **[#1937](https://github.com/AIClarityAU/minspec/issues/1937)** -
*"Constitution summaries list DRAFT entries under 'must never be violated' with no
legend"*. No new DR: see [Why no new DR](#why-no-new-dr).

## One-Sentence Scope

Make the CLAUDE.md, AGENTS.md and `.cursorrules` constitution mirrors omit DRAFT-marked
entries and report the omitted count, using one shared DRAFT predicate that Compact
Constitution also uses, without changing how `constitution.md` is parsed, rendered or
stored.

## Context - what the code does today (read at `23a58c2f`, not inferred)

- `parseConstitution` (`packages/minspec/src/lib/constitution.ts:133`) returns every list
  item under `## Invariants`, `## Principles` and `## Constraints` through `extractListItems`,
  text unchanged, `DRAFT:` prefix included.
- `buildContext` (`packages/minspec/src/lib/template-engine.ts:136-155`) passes those arrays
  straight into the context that **every** template renders from, including
  `constitution.md` itself (`template-registry.ts:792`, `{{#each invariants}}
  {{incremented @index}}. {{this}}`).
- The three mirrors render invariants through `{{firstSentence this}}`
  (`template-engine.ts:36`, `constitution.ts:86`):
  - CLAUDE.md: `template-registry.ts:187-199`, numbered, under "These rules must never be
    violated."
  - AGENTS.md: `template-registry.ts:644-656`, "### Key Invariants", under the same phrase.
  - `.cursorrules`: `template-registry.ts:716-728`, "## Invariants".
  - `.cursorrules` also renders `## Principles` in full text (`template-registry.ts:730-740`),
    DRAFT entries included.
- When the invariants array is empty, each mirror renders the placeholder
  `<!-- Add project invariants here -->`.
- No line in `constitution.ts`, `template-engine.ts` or `template-registry.ts` mentions
  DRAFT (grep at `23a58c2f`).
- Three separate DRAFT checks already exist, and they disagree:
  - `isDraftLine` (`constitution-proposer.ts:88-93`) matches a list line whose text starts
    with `DRAFT:`.
  - `isAllTemplate` (`constitution-nudge.ts:72-76`) matches item text starting with `DRAFT:`.
  - `stripDraftMarker` (`constitution-compaction.ts:34-39`) matches only a bullet followed by
    exactly `DRAFT:`. `DRAFT?:` and `**DRAFT:**` survive compaction.
- `seedConstitution` (`scaffold.ts:78`) writes deterministic DRAFT entries into every fresh
  Initialize and Refresh. So this defect reaches every new adopter, not only constitutions
  written with an LLM. I believe the seed writes Invariants entries as well as Principles
  entries, but I have not checked that. The #2520 test checks a seeded **principle**
  appearing in `.cursorrules` (`packages/minspec/tests/refresh-constitution-draft-fixed-point.test.ts:64`).

The root cause, per DR-003, is in two parts. The mechanism is a mirror rendering path that
treats a parsed list item as a binding rule without checking its acceptance state. The
missing gate is the absence of any single DRAFT predicate that both the mirrors and
compaction must use. Without one, three hand-copied checks have already drifted apart.

## Functional Requirements

- **FR-1 - One shared DRAFT predicate.** `constitution.ts` exports a pure
  `isDraftItem(text: string): boolean`. It is true when the item's text, after leading
  whitespace, starts with one of the recognised DRAFT markers (DQ-2). It is false
  otherwise, including when `DRAFT` appears anywhere other than the start. The predicate is
  case-sensitive.
- **FR-2 - Mirrors omit DRAFT entries.** The CLAUDE.md, AGENTS.md and `.cursorrules`
  invariant lists render only the items for which `isDraftItem` is false. Under DQ-3, the
  `.cursorrules` Principles list follows the same rule.
- **FR-3 - Never a silent omission.** When a mirror list leaves out one or more items, the
  mirror prints exactly one line after the list stating the count and pointing to the
  constitution. Example: `> 3 proposed entries in .minspec/constitution.md are marked DRAFT
  and not listed here; they are not binding until accepted.` The line sits outside the
  list, so it does not argue with the heading. When nothing is left out, no line is
  printed and the output is byte-identical to today's.
- **FR-4 - All-DRAFT is not "empty".** When every item in a section is DRAFT, the mirror
  prints the FR-3 line instead of `<!-- Add project invariants here -->`. That placeholder
  tells the reader the project has no invariants, which is false when entries exist and
  are only pending. The placeholder still appears when the section has zero items.
- **FR-5 - Ordinals follow the constitution (DQ-4).** CLAUDE.md's numbered list keeps the
  1-based position each item has in `constitution.md` (counting DRAFT items), so "invariant
  3" means the same rule in both files. Gaps in the numbering are expected and are allowed.
- **FR-6 - The constitution's own data path does not change.** `parseConstitution`,
  `buildContext`'s existing `invariants`/`principles`/`constraints` arrays, and the
  `constitution.md` template keep their current output, byte for byte. The filtering
  happens at mirror render time: either a Handlebars helper, or additional context fields
  (for example `bindingInvariants` with ordinals, and `draftInvariantCount`) that only the
  mirror templates read. The Plan phase picks the form.
- **FR-7 - Existing checks use the shared predicate.** `isAllTemplate`
  (`constitution-nudge.ts`), `isDraftLine` (`constitution-proposer.ts`) and
  `stripDraftMarker` (`constitution-compaction.ts`) all delegate to the FR-1 predicate,
  each with its own line-or-item framing. So "is this a DRAFT?" has one answer everywhere.
- **FR-8 - Compaction strips every marker the mirrors hide (DQ-2).** Compact Constitution
  removes every marker form that FR-1 recognises, and still asks for human confirmation
  (SPEC-025 FR-8). After compaction no entry stays hidden from the mirrors, which is what
  the "until compacted" cost in #1937 assumes.

## Acceptance Criteria

- **AC-1** A constitution with invariants `[A, DRAFT: B, C]` renders CLAUDE.md items `1. A`
  and `3. C`, then one FR-3 line with count 1. AGENTS.md and `.cursorrules` list `A` and
  `C`, each followed by one FR-3 line with count 1.
- **AC-2** A constitution with no DRAFT items renders all three mirrors byte-identical to
  their output at `23a58c2f`. A golden comparison proves this.
- **AC-3** A constitution whose invariants are all DRAFT renders the FR-3 line in each
  mirror and does not render `<!-- Add project invariants here -->`. A constitution with
  zero invariants still renders the placeholder.
- **AC-4** `isDraftItem` table test. True for `DRAFT: x`, `  DRAFT: x`, and each DQ-2 form.
  False for `x DRAFT: y`, `Draft: x`, `DRAFTING the API`, `DRAFTS: x`, and the empty string.
- **AC-5** Rendering `constitution.md` from a constitution that contains DRAFT items returns
  those items unchanged, with their markers (FR-6). `parseConstitution` output is unchanged
  for the memory-fabric#30-shaped fixture: 25 items, markers preserved.
- **AC-6** Compaction of a constitution containing every DQ-2 form leaves no item for which
  `isDraftItem` is true, and still reports `unchanged: true` for a DRAFT-free input.
- **AC-7** The #2520 fixed-point property still holds: Refresh 2 on an untouched project
  leaves every mirror byte-identical to Refresh 1. The assertion at
  `packages/minspec/tests/refresh-constitution-draft-fixed-point.test.ts:64` changes under DQ-3: the seeded DRAFT
  principle shows up as the FR-3 count line, not as list text.
- **AC-8** A mutation check: making `isDraftItem` always return false must fail AC-1, and
  making it always return true must fail AC-2. This keeps the test from passing vacuously.
- **AC-9** CRLF input (SPEC-095) behaves the same as LF input for AC-1 and AC-6.

## Invariants (must not break)

- **INV-1 - No silent promotion, no silent loss.** Any item that is not DRAFT still appears
  in every mirror it appears in today. Any DRAFT item that is left out is counted visibly
  (FR-3). Constitution invariant 2 (no silent gate) applies here in spirit: the mirror
  either tells the reader that something was left out, or it leaves nothing out.
- **INV-2 - `constitution.md` is never rewritten by this change.** Refresh must not drop or
  alter a DRAFT entry in the constitution (FR-6, AC-5). SPEC-025 INV-2 (never overwrite
  human content) is preserved.
- **INV-3 - Tier-0, offline, deterministic.** All of this is pure string logic with no
  network and no LLM (constitution invariant 1). The same constitution always renders the
  same bytes.
- **INV-4 - Blast radius.** Behaviour changes only in repos that carry `.minspec/`
  (constitution invariant 3), and only in the MinSpec-managed sections of the three mirrors.
  The section-merge rules that protect human edits (DR-011 harness markers; SPEC-043 manifest
  consistency) stay as they are.
- **INV-5 - Refresh is still a fixed point** (#2520): AC-7.

## Decisions needed (Clarify)

Each question names a recommended option **(rec)** and what that option costs. The
requirements above are written under every recommendation.

Each selection below restates the option this document already marks (rec). It was
copied by an agent session; neither a human nor a delegation chose it, and DLG-001
(DR-108) does not cover recording Clarify selections. This section is not marked
resolved: it needs the founder's answer before approval.

- **DQ-1 - How mirrors treat DRAFT entries.**
  **Recorded selection: Option (a),** leave DRAFT entries out and print one count line,
  so the omission is not silent (INV-1).

  - **(a) (rec)** Leave them out, and print one count line (FR-2, FR-3). Cost: pending rules
    are invisible to an agent that reads only CLAUDE.md, so a rule the author wanted
    followed before formally accepting it is not followed.
  - (b) A second list, "Proposed, not binding". Cost: longer instruction files on every
    agent load, and agents may still treat listed text as instructions.
  - (c) A legend only, with items kept in the list. Cost: the legend contradicts the
    "must never be violated" heading it sits under. #1937 rates this the weakest option.
  - The issue's own recommendation is (a) without the count line. The count line is added
    here so the omission is not silent (INV-1). It is cheap to drop at Clarify if not wanted.
- **DQ-2 - Which marker forms count as DRAFT.**
  **Recorded selection: Option (a),** case-sensitive `DRAFT:` and `DRAFT?:`, optionally
  bold, fixes the whole defect without hiding an accepted rule that starts with "Draft".

  - **(a) (rec)** Case-sensitive `DRAFT:` and `DRAFT?:`, either one optionally wrapped in
    bold (`**DRAFT:**`, `**DRAFT?:**`). Compaction strips all four (FR-8). Cost: compaction
    now also accepts `DRAFT?:` entries, which the author marked as less certain. The
    compaction confirmation diff is the only check on that.
  - (b) Only the literal `DRAFT:`, as in SPEC-025 today. Cost: the 2 `DRAFT?:` entries in
    memory-fabric#30 stay in the "must never be violated" list, so the defect is only
    partly fixed.
  - (c) Any leading `DRAFT` token, matched case-insensitively. Cost: could hide an accepted
    rule that happens to start with "Draft". AC-4 exists to rule this out.
- **DQ-3 - Do the `.cursorrules` Principles get the same treatment?**
  **Recorded selection: Option (a),** principles go through the same predicate, count
  line and placeholder rule, since the defect has the same shape there.

  - **(a) (rec)** Yes. Principles go through the same predicate, the same count line and the
    same placeholder rule. Cost: this goes beyond the issue's invariant-only wording, and
    the #2520 test assertion changes (AC-7).
  - (b) No, invariants only. Cost: `.cursorrules` keeps presenting seeded DRAFT principles
    as the project's adopted principles. The heading is softer, but the defect has the
    same shape.
- **DQ-4 - Numbering in CLAUDE.md once DRAFT entries are left out.**
  **Recorded selection: Option (a),** keep the constitution's ordinals with gaps, so
  "invariant N" means the same rule in CLAUDE.md and in the constitution.

  - **(a) (rec)** Keep the constitution's ordinals, with gaps (FR-5). Cost: a numbered list
    that skips numbers looks odd and may be "corrected" by hand inside a managed section.
  - (b) Renumber 1..N. Cost: "invariant 3" means different rules in CLAUDE.md and in the
    constitution, and prose that cites ordinals (this repo's CLAUDE.md does) quietly points
    at the wrong rule.

## Why no new DR

Every choice here can be reversed within a day: it is template text plus one pure
predicate, and nothing is persisted. The DRAFT convention itself is SPEC-025's, and this
spec does not change what DRAFT means, only where it is shown. `docs/decisions/INDEX.md`
was searched for "constitution" and "DRAFT", and no in-force DR covers how mirrors render
pending entries.

## Out of Scope

- Changing the DRAFT convention, the proposer's output, or the seed catalogue (SPEC-025).
- Rendering Constraints or Goals in mirrors. No mirror renders them today.
- Detecting that a constitution has been edited since the last Refresh. Mirrors stay
  derived at Refresh time, as they are now.
- Migrating adopter constitutions. The next Refresh from a rebuilt extension applies the fix.

## Alternatives considered and rejected

- **Filtering inside `parseConstitution` or `buildContext`.** Rejected: the `constitution.md`
  template renders from the same context, so Refresh would drop DRAFT entries from the
  constitution itself (breaks INV-2).
- **Leaving the predicate in three places and adding the mirror as a fourth copy.**
  Rejected: the three copies have already drifted (`DRAFT?:` is a DRAFT to nobody), so a
  fourth would drift too. FR-7 replaces the copies with one predicate.

## Test plan (for the Plan phase to place)

Unit tests: the `isDraftItem` table (AC-4), and mirror renders through `renderTemplate`
(AC-1 to AC-3, AC-5, AC-9). Compaction tests (AC-6). The updated #2520 refresh test (AC-7).
A recorded mutation run for AC-8. Run `tsc` on the new test files, because `tests/` sits
outside every tsconfig include.

## Traceability

- Issue: #1937. Evidence: AIClarityAU/memory-fabric#30 (25 parsed lines, 15 DRAFT-marked).
- Builds on: SPEC-025 (DRAFT convention, compaction), #705 (lead-sentence mirrors),
  SPEC-095 (CRLF), #2520 (refresh fixed point), SPEC-043 (manifest consistency).

## Follow-ups (tracked)

None. Everything this spec surfaces is covered by its own FRs.
