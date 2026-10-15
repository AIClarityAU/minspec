---
id: SPEC-191
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a defined term is a signpost; an undefined one makes the reader guess
aspects: [ux, render, tier-0, glossary, vocabulary]
relates_to: [SPEC-035, SPEC-018, SPEC-014, DR-053]
implements: none
implements_reason: specified but not yet built — Specify phase only (#672). Build is paused with the SPEC-018 pretty-webview work; render-host module paths are undecided. Declares owned files on implementation, per the SPEC-034 precedent.
---

# MinSpec — Project Term Glossary: dotted-underline hover cards (Requirements)

**Date:** 2026-10-16
**Status:** Specifying
**Issue:** [#672](https://github.com/AIClarityAU/minspec/issues/672) — project-wide term glossary.
**Sibling:** [SPEC-035](../SPEC-035-approvable-ref-lozenges/requirements.md) (approvable-ref lozenges + hover cards). SPEC-035 is the *reference* half (title/status/summary of an SP/DR/issue); this spec is the *vocabulary* half. SPEC-035 names #672 as out of its scope; this spec names the lozenge work as out of its scope.

**Triggered by:** founder request, parked verbatim in #672 — *"maintain a dictionary of project-wide terms that have a dotted underline in the pretty webview, so you can also hover over them to show a card that explains what they mean, and where they were first introduced. this includes globals like company in-speak, industry lingo and 'big words' that lower-vocab people might not know (like 'counterfactual' — AI has broader vocab than most people), project-wide terms / key concepts (like 'never-wrong'), etc"*

## One-Sentence Scope

In the pretty webview, every occurrence of a term defined in a project glossary renders with a dotted underline and a hover/focus card giving its plain-language meaning and where it was first introduced.

## Context

The authoring LLM has a wider vocabulary than many readers, and the project coins its own ("never-wrong", "RCDD", "machinery", "counterfactual"). Today the reader either guesses or asks. The same problem SPEC-035 solves for references — restating a fact in prose that a live render can supply — applies to definitions: a term is re-explained inline in every doc, differently each time, and drifts.

Two kinds of term share one mechanism but differ in source and trust:
- **Project terms** — coined here, with a real first-introduction point (a DR, spec, or issue).
- **General terms** — industry lingo and "big words" with no project origin; the card gives a meaning and no "introduced in" (or names none honestly).

Render host is the SPEC-018 custom editor / SPEC-014 review pane (webview only; the plain text editor is untouched).

## Functional Requirements

- **FR1 — glossary store.** One committed, human-readable file holds the project glossary (location and format: see DQ-1). Each entry carries: `term`, optional `aliases` (plurals, abbreviations), `definition` (plain language, short), `kind` (`project` | `general`), and `introduced_in` (a DR-053 reference, e.g. `DR-003`, or `#N`) — required for `kind: project`, optional for `general`.
- **FR2 — detect terms (Tier-0).** A pure function matches glossary terms/aliases over the text of the rendered approvable: whole-word, case-insensitive by default with a per-entry `case_sensitive` override (for acronyms such as `RCDD`), longest-match first (`never-wrong` before `never`), skipping fenced code blocks, inline code, link text/URLs, headings' anchor ids, and the text already inside an SPEC-035 lozenge. No `fs`/`vscode`/network/LLM imports.
- **FR3 — render.** Each match renders with a dotted underline, visually distinct from SPEC-035 lozenges and from links. Only the **first occurrence per section** is underlined (DQ-2 decides granularity) so dense documents are not a wall of dots.
- **FR4 — hover/focus card.** Hover **or keyboard focus** opens a card with the term, its definition, and "first introduced in" as a navigable reference (resolved through the DR-053 / `project-prefix` resolver, shared with SPEC-035). Open/close and next/prev term each have a keyboard path (RSI standing constraint).
- **FR5 — introduced-in is checked, not trusted.** `introduced_in` must resolve to an existing approvable or issue at validate time. A dangling reference fails `npm run validate` visibly; at render time an unresolvable one degrades to the definition with no "introduced in" line — never a dead link or a wrong target.
- **FR6 — don't underline the defining location.** At the `introduced_in` document the term is not underlined (the doc is the definition); other occurrences are.
- **FR7 — suggest, never auto-add.** A glossary-gap aid may *propose* candidate terms (e.g. an LLM-flagged "big word" or a repeated coined hyphenated phrase) as a reviewable diff to the glossary file. It never writes silently, and detection/render (FR2–FR4) never depend on it. Tier-1 only, behind the existing opt-in (invariant 1); not required for v1.
- **FR8 — authoring guidance.** Authoring guidance tells the LLM that a glossary term need not be re-defined inline when the glossary covers it. Where it lives is DQ-4.
- **FR9 — opt-out and scoping.** The feature is off in repos without `.minspec/` (invariant 3), and a setting disables underlines while keeping the glossary file. Stale entries (term appears nowhere in the corpus) are reported by validate as advisory, not failing.
- **FR10 — graceful degrade.** Missing, empty, or malformed glossary file → no underlines, a single visible advisory, and the view otherwise unchanged. A malformed *entry* is skipped and reported; it never breaks the others.

## Decisions needed (Clarify)

- **DQ-1 — where the glossary lives.**
  (a) **One file `.minspec/glossary.md`** (rec) — Markdown table or headed entries, read by the same pure parser pattern as `.minspec/project-prefixes.md`; one place to review, diff, and approve. Cost: grows into a long file; merge conflicts when many sessions add terms.
  (b) **Frontmatter-per-entry files under `docs/glossary/`** — no conflicts, per-term history. Cost: many tiny files, slower validate, harder to skim for duplicates.
  (c) **Inside the constitution.** Cost: the constitution is hash-locked; every new term would void its approval — rejected unless the founder says otherwise.
- **DQ-2 — underline granularity.** First occurrence per document, per section (rec), or every occurrence. Per-section is a compromise: long specs re-orient the reader without carpeting the page. Cost: a reader who jumps mid-document may not see the term in an earlier section — mitigated by per-section.
- **DQ-3 — is the glossary an approvable (hash-locked)?** (a) **No — plain curated file, validated for shape and dangling refs only** (rec): adding a term is cheap, matching "just enough human". Cost: a wrong definition ships with no approval gate; a lie in a definition is a signpost lie. (b) Hash-locked per DR-012: each definition is reviewed. Cost: every added word costs a human approval, which will make the glossary rot from neglect.
- **DQ-4 — where "don't re-define" guidance lives.** Authoring prompt only (rec, cheapest), constitution rule, or a validate advisory flagging inline re-definitions. Cost of rec: prose-only, model-trusted, will drift (constitution: enforce, don't trust the model).
- **DQ-5 — general terms: curated or LLM-suggested?** v1 curated-only (rec): the founder or an LLM-proposed diff adds each. Cost: cold start — an empty glossary underlines nothing; seeding is a one-off task (see Out of Scope). Alternative: allow on-demand LLM definition for unlisted words — rejected for v1: a generated definition on hover is unreviewed and offline-breaking (invariant 1).
- **DQ-6 — should `kind: general` terms be shared across projects** (a user-level glossary) rather than per repo? Per-repo only for v1 (rec; user-level config would change behaviour outside the opt-in repo, invariant 3). Cost: each repo re-lists "counterfactual".

## Costly to Refactor

- **The glossary file format** (FR1/DQ-1) — every entry authored against it.
- **The match rules** (FR2) — shared with SPEC-035's detector; the two must agree on precedence (lozenge beats term) or share one tokenizer.
- **Cheap to reverse:** underline style, card layout, per-section vs per-document granularity.

## Acceptance Criteria

- **AC1** With glossary entry `never-wrong`, a rendered approvable containing "never-wrong" shows a dotted underline; "never wrong" (no hyphen) and `never-wrong` inside inline code do not.
- **AC2** Hover **or** keyboard focus opens a card with definition and "first introduced in"; every card action is reachable without a mouse.
- **AC3** `introduced_in: DR-003` card's link navigates to DR-003; changing `introduced_in` to a nonexistent id fails `npm run validate`.
- **AC4** `RCDD` (`case_sensitive`) underlines `RCDD`, not "rcdd" inside another word; alias `counterfactuals` matches entry `counterfactual`.
- **AC5** A term inside a SPEC-035 lozenge, a fenced block, or a URL is not underlined; at the entry's `introduced_in` document it is not underlined.
- **AC6** Missing/malformed glossary → no underlines, one advisory, no render error; one malformed entry does not hide the others.
- **AC7** Detection and parse modules import no `vscode`, network, or LLM (checked by an import-boundary test).
- **AC8** In a repo without `.minspec/` the webview behaviour is unchanged.

## Out of Scope

- Reference lozenges for approvables/paragraphs — [SPEC-035](../SPEC-035-approvable-ref-lozenges/requirements.md).
- **Seeding** the initial glossary (choosing which existing terms/jargon to define) — a content task for after approval, not part of this spec.
- Underlining in the plain text editor, GitHub-rendered Markdown, or PR descriptions.
- Per-user reading-level adaptation ("explain at my level").
- Any network/LLM call in detection or render.

## Invariants

- **INV-tier0-detection** — term detection and glossary parsing are pure functions over text; no `vscode`, network, or LLM (invariant 1: offline).
- **INV-introduced-in-checked** — a displayed "first introduced in" resolves to a real target or is omitted; it is never a dead or guessed link (never-wrong; DR-003 evidence discipline).
- **INV-graceful-degrade** — absent/invalid glossary or entry degrades to plain text with a visible advisory, never an error or silent partial render. Not a silent gate (invariant 2): the validate failure on dangling `introduced_in` is loud.
- **INV-opt-in-blast-radius** — behaviour changes only in repos with `.minspec/` (invariant 3); no user-level or machine-wide config.
- **INV-keyboard** — card open/close and term navigation have keyboard paths (RSI).
