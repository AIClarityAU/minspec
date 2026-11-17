---
id: SPEC-310
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a ref that silently picks one of two targets is a lying signpost
aspects: [references, resolver, dr-053, ambiguity, code-fence, tier-0, ref-check]
depends_on: []
relates_to: ["#1646", "#679", "#681", "#161", "#316", "#1640", "#1226", DR-053, DR-027, SPEC-035, SPEC-252, SPEC-021]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan. Expected surface:
  `packages/shared/src/project-prefix.ts` (the shared result-state type),
  `packages/minspec/src/lib/reference-checker.ts` (extraction and resolution),
  `scripts/validate-frontmatter.ts` Rule 9's registry builder, and their tests. None of it is
  claimed yet.
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-310: A reference with more than one possible target resolves to `ambiguous`, and a ref inside a code fence is not a reference

> **This is a SPECIFICATION ONLY.** Written for issue
> [#1646](https://github.com/AIClarityAU/minspec/issues/1646). Nothing is built until this spec
> is approved, after [Decisions needed (Clarify)](#decisions-needed-clarify) are resolved.
>
> Design rests on **DR-053** (paragraph-addressable reference scheme; accepted 2026-07-14,
> not yet shipped). It refines DR-053 §5 (an unknown code is advisory) by adding a state
> DR-053 does not name. No new decision record is minted: the state set has zero production
> callers today (see Context), so it can be changed in well under a day. See
> [Follow-ups](#follow-ups-tracked) for the DR-053 addendum this should get once #679 ships.

## One-sentence scope

Give reference resolution one shared set of result states in which `ambiguous` (two or more
real candidates) is returned explicitly, creates no link and lists every candidate, and make
reference extraction skip fenced code blocks, before #679 (the `project-prefix` v2 grammar
update) fixes the resolver contract in place.

## In plain terms

Today a reference either "exists" or is "dangling". There is no third answer for "this could
mean two different things". The id registry is a set of id strings, so if two files both
claim `DR-077` (two open pull requests did exactly that in #1226; had both merged, the tree
would hold two `DR-077` files), the checker sees one `DR-077`, says it exists, and any
tool that follows the link picks one silently. DR-053 v2 makes this much more common: an
elided ref like `SP19/FR3` can match a definition in more than one file.

Separately, the checker reads every `SPEC-NNN`, `DR-NNN` and `path:line` token in a file,
including ones quoted inside a fenced code block as an example. A quoted example is not a
citation.

This spec fixes both while the resolver contract is still cheap to change.

## Context (measured 2026-11-12, tree at `8aa90ad0`)

### What exists

- **Two resolvers, neither knows "ambiguous".**
  - `packages/shared/src/project-prefix.ts:69-81` — `RefResolution` is
    `local | cross-project | unknown-prefix | null`. It is syntactic only: it never checks
    whether a target exists. **It has zero production call sites**: a grep for `resolveRef`,
    `parsePrefixTable`, `formatCrossRef` and `isCrossProjectRef` outside tests and the module
    itself finds only the barrel export in `packages/shared/src/index.ts`.
  - `packages/minspec/src/lib/reference-checker.ts:161-191` — `resolve()` checks existence
    against a `ReferenceRegistry` and returns a violation or `null`. Two answers only:
    exists or dangling.
- **The registry cannot see a collision.** `ReferenceRegistry` (`reference-checker.ts:46-55`)
  holds `Set<string>` of ids. `buildReferenceRegistry` (`scripts/validate-frontmatter.ts:230-274`)
  adds each spec, decision and epic id to a set, so two files declaring the same id collapse
  into one entry and the reference "resolves". This is the structural blind spot. The
  unmerged draft spec for #679 (directory `project-prefix-v2-grammar` on branch
  `agent/issue-679`, tip `d38b9daca`), in its FR-5, sends an elided ref with insufficient
  context to "advisory, same as an unknown prefix", which also has no candidate list.
- **A live collision, found while writing this spec.** That #679 draft declares the id
  number 080, and `main` already has a different spec with that number
  (`specs/minspec/SPEC-080-pre-commit-code-quality-stage/`). If the draft merged as it is,
  every reference to that id would resolve "exists" today and silently mean whichever spec
  the reader had in mind. Under this spec it would resolve `ambiguous` with both
  directories. This is why this document never cites the #679 draft by its id. The draft
  needs renumbering before it merges; that belongs to #679, not here.
- **Consumers.** `checkReferences` is called from `scripts/validate-frontmatter.ts:620`
  (Rule 9, printed as non-fatal `ref-check` warnings) and `packages/minspec/src/lib/diagnostics.ts:194`
  (editor squiggles, `DiagnosticSeverity.Warning` at `:229`, #316). SPEC-035's design states
  that its Slice C (v2 grammar lozenges) has "no resolver contract" yet and is planned
  against #679's resolver (`specs/minspec/SPEC-035-approvable-ref-lozenges/design.md:68`).
- **Extraction has no fence awareness.** `extractReferences` (`reference-checker.ts:117-158`)
  removes only the `id:` and `epic:` frontmatter lines, then runs three regexes over the
  whole text.

### Measured warnings

`npm run validate` at `8aa90ad0` prints **117** `ref-check` warnings (the issue's figure of
59 is older). A throwaway classification script (approximate fence detection: a line
starting with three backticks or tildes toggles a fence; not CommonMark-exact) gives:

| Group | Every occurrence in a fenced block | Every occurrence in a fence or inline code span | At least one in prose |
|---|---|---|---|
| File citations (45) | 2 | 36 | 9 |
| SPEC refs (25) | 3 | 7 | 18 |
| Parent-register DR refs: `DR-355`, `DR-359`, `DR-360`, `DR-362` (46) | 0 | 4 | 42 |
| Other DR refs (1) | 0 | 1 | 0 |

What this says:

1. **Fence-aware extraction removes about 5 warnings, not dozens.** The value is in what it
   prevents (an example quoted in a fence never becomes a citation), not in today's count.
2. **Skipping inline code too would blind the file-citation check.** 34 of 45 file-citation
   warnings come from citations that appear only inside inline code spans, because that is
   how authors write `scripts/validate-frontmatter.ts:620`. See D2.
3. **No current warning is an ambiguity.** No SPEC id is declared in two different spec
   directories at this tree (checked: every repeated `id: SPEC-NNN` sits in one directory's
   `requirements.md`/`design.md`/`tasks.md`). The 46 parent-register refs have **zero** local
   candidates, which is "broken", not "ambiguous": ambiguity needs two or more candidates the
   resolver can actually see. The issue calls them "exactly the ambiguity DR-053 exists to
   resolve"; that holds for a human reader, not for the resolver. How to classify them is D3.

### Where ambiguity will come from

- **Id collision.** Two files claim one id (the #1226 near-miss on `DR-077`). Today it reads
  as "exists".
- **Elided paragraph refs (DR-053 v2).** A spec is one approvable spread over up to three
  files with the same `id:`. `SP19/FR3` resolves against every file of SPEC-19 that
  **defines** `FR3`. If both `requirements.md` and `design.md` define one, the ref is
  ambiguous. A file that merely cites `FR3` is not a candidate (FR-3).
- **Intra-document shorthand read out of context.** A bare `FR3` lifted into an issue body
  has no document context at all.

### Prior art

sdyckjq (`wiki-link-index.js:30-48,128-137`, summarised in
`docs/research/llm-wiki-pattern-2026-08-22.md` lesson L10, PR #1640) indexes pages by path
rather than name, so two same-named pages stay distinct, and a bare-name link to them
resolves to `ambiguous`, creates no edge, and reports every candidate. Its parser skips code
fences (`wikilink-parser.js:35-98`). The research note records that sdyckjq's licence grant is
broken, so the **technique** may be reused and the **code** may not (note, line 241).

## Functional requirements

### Result states

- **FR-1. One shared state set.** Reference resolution against a registry returns exactly
  one of these states. The type is defined once, in `@aiclarity/shared` (Tier 0), and both
  `reference-checker.ts` and the #679 resolver use it, so the two cannot drift.

  | State | Meaning | Creates a link/edge | Carries |
  |---|---|---|---|
  | `resolved` | exactly one candidate | yes | the candidate |
  | `ambiguous` | two or more candidates | **no** | **every** candidate |
  | `broken` | zero candidates in a register the resolver can read | no | the reason |
  | `unknown-prefix` | project code not in `.minspec/project-prefixes.md` (DR-053 §5) | no | the prefix |
  | `external` | explicitly another register (`@namespace` suffix, or a known cross-project code) that cannot be checked offline | no | the project |

  A token that is not a reference at all stays `null`, as today.
- **FR-2. `ambiguous` never guesses.** For an `ambiguous` result, no consumer may pick a
  candidate: no "first match", no "most recent", no "same directory wins". The candidate
  list is complete (not truncated) and sorted deterministically by repo-relative path, so
  two runs over the same tree return byte-identical output.
- **FR-3. Candidates are definitions, not mentions.** A candidate is a place that
  **defines** the target: a spec directory or decision/epic file whose id it is, or, for a
  paragraph ref, a file whose typed item carries that paragraph id. A file that only cites
  the id is never a candidate.
- **FR-4. Candidate identity is the approvable, not the file.** At the approvable level a
  spec is one candidate however many of its files (`requirements.md`, `design.md`,
  `tasks.md`) carry its `id:`, so `SP19` is never ambiguous because a spec has three files.
  Two **different** spec directories, or two decision files, claiming one id are two
  candidates. At the paragraph level, a candidate is a (file, paragraph id) pair.
- **FR-5. The registry records where each id is defined.** The registry maps each id to the
  list of repo-relative paths that define it, instead of a set of id strings, so a collision
  is visible to the resolver. Building the registry keeps today's per-file error handling
  (`validate-frontmatter.ts:236-244`): an unreadable file is named, never silently skipped.

### Surfacing

- **FR-6. Every surface names every candidate.** The `ref-check` line printed by
  `npm run validate` and the editor diagnostic both state the state name and list every
  candidate path, e.g. `ambiguous DR reference: DR-077 matches 2 records: docs/decisions/DR-077-a.md, docs/decisions/DR-077-b.md`.
- **FR-7. Severity is a field of the result, not of the surface.** Each state carries a
  severity class (`error` or `warning`) fixed by this spec's table in D1. Each surface maps
  the class to what it can show. Whether any surface becomes fatal is D1.
- **FR-8. Consumers that draw links treat non-`resolved` as no link.** Any consumer that
  turns a ref into a navigable link or graph edge (SPEC-035 lozenges, a future trace graph)
  creates one only for `resolved`. For `ambiguous` it shows the candidate list rather than
  a link. This spec states the contract; SPEC-035 Slice C owns the rendering.

### Fence-aware extraction

- **FR-9. A ref inside a fenced code block is not a reference.** Reference extraction skips
  the contents of every fenced code block, opened by three or more backticks or tildes,
  closed by a fence of the same character at least as long, following the CommonMark fence
  rule (a fence may be indented up to three spaces; a backtick fence's info string may not
  contain a backtick). Fence lines themselves are skipped.
- **FR-10. An unclosed fence is reported, never silently swallowing the rest of the file.**
  CommonMark runs an unclosed fence to the end of the document. Extraction follows that
  rule, and the checker emits one advisory finding naming the file and the line of the
  opening fence, so a stray fence cannot hide every later reference without a trace.
- **FR-11. Inline code spans are handled per D2.** Until D2 is decided the build must not
  change how inline code spans are treated.
- **FR-12. One extractor.** Fence handling lives in one shared function used by every
  reference extractor in scope, not re-implemented per caller (the duplicated-predicate
  drift the repo has hit before).

### Parent-register refs

- **FR-13. Parent-register numbers are classified per D3**, and the message for each one
  says which rule classified it, so a reader can tell "not in this register" from "typo".

## Invariants (must not break)

- **INV-1. Offline (constitution invariant 1).** Resolution and extraction read only the
  working tree. No network call, no read of another repo's register.
- **INV-2. No silent gate (constitution invariant 2).** Whatever severity D1 settles, a
  check that cannot run (registry build fails, a file cannot be read) says so visibly, as
  Rule 9 already does through `reportUnrunnable`. A fence-related skip is never silent
  (FR-10).
- **INV-3. Never fail loud on an unknown code (DR-053 §5).** `unknown-prefix` stays advisory
  and never throws. No new state introduces a thrown exception on any input.
- **INV-4. Never a silent wrong answer.** No state may resolve to one target when two exist
  (FR-2). This is the reason for the spec.
- **INV-5. Elision stays display-only (DR-053 §7).** Nothing in this spec rewrites a
  stored reference.
- **INV-6. Tier 0.** The shared type and the extraction function import no `vscode`, no
  filesystem module and no LLM.

## Acceptance criteria

- [ ] **AC-1.** Given a registry where two decision files both define `DR-077`, a ref to
      `DR-077` returns `ambiguous` with both paths, sorted by path. (FR-1, FR-2, FR-5)
- [ ] **AC-2.** Given one spec directory whose `requirements.md`, `design.md` and
      `tasks.md` all carry `id: SPEC-019`, a ref to `SPEC-019` returns `resolved`. (FR-4)
- [ ] **AC-3.** Given two spec directories that both declare `SPEC-019`, a ref to
      `SPEC-019` returns `ambiguous` with both directories. (FR-4)
- [ ] **AC-4.** Given SPEC-19's `requirements.md` and `design.md` each defining a typed
      item `FR3`, `SP19/FR3` returns `ambiguous` with both files; if `design.md` only cites
      `FR3`, it returns `resolved` to `requirements.md`. (FR-3; runs once the #679 paragraph
      grammar exists)
- [ ] **AC-5.** Running the resolver twice over the same registry gives byte-identical
      candidate lists. (FR-2)
- [ ] **AC-6.** A `DR-999` that appears only inside a fenced block (backtick and tilde, a
      four-backtick fence containing a three-backtick line, an indented-by-three fence)
      yields no reference; the same token in prose yields one. (FR-9)
- [ ] **AC-7.** A file whose fence never closes yields one advisory finding naming the
      opening line, and no references after it. (FR-10)
- [ ] **AC-8.** The `ref-check` line and the editor diagnostic for an ambiguous ref both
      contain the state name and every candidate path. (FR-6)
- [ ] **AC-9.** Every state carries a severity class, and the class matches D1's table.
      (FR-7)
- [ ] **AC-10.** No input string makes the resolver or extractor throw (a fuzz or property
      test over random text, including unbalanced fences). (INV-3)
- [ ] **AC-11.** Over the corpus at the build commit, the count of `ref-check` warnings
      falls by exactly the number whose every occurrence is in a fenced block, and the PR
      states both counts measured with the shipped extractor, not this spec's approximate
      script. (FR-9)
- [ ] **AC-12.** The shared type and extractor import no `vscode`, `fs`, `node:fs` or
      network module (an import-boundary test, not a text grep of the source). (INV-6)

## Decisions needed (Clarify)

Recorded selections: each of the 4 selections below is the option this document marks recommended, copied by the runner's agent on 2026-11-13. These are not human choices and no delegation made them; the approver confirms or changes each.

- **D1. How severe is `ambiguous`, and where?**
  - **(a) (rec)** Severity class `error` for `ambiguous` and `broken`, `warning` for
    `unknown-prefix`, none for `external` (sdyckjq's split). Surfaces keep today's channels:
    `npm run validate` keeps Rule 9 non-fatal and the editor keeps `Warning`, and the
    classes are promoted together when Rule 9 is promoted. **Cost:** a new collision is
    still only a warning in CI until Rule 9 goes fatal; the `dr-id-collision` gate, also
    advisory, is the only other witness for DR collisions.
  - **(b)** Make `ambiguous` fatal in `npm run validate` now (zero ambiguous refs today, so
    nothing goes red on day one). **Cost:** once #681 migrates the corpus to elided v2
    forms, every elided collision blocks a commit at the pre-commit baseline gate, before
    authors have any tool that rewrites them; and it is a new required gate, which needs an
    independent second witness under constitution invariant 2.

  **Recorded selection: Option (a),** severity `error` for `ambiguous` and `broken`, `warning` for `unknown-prefix`, none for `external`; surfaces keep today's channels. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.
- **D2. Are inline code spans excluded too?**
  - **(a) (rec)** Fenced blocks only. Inline code stays a reference. **Cost:** a ref
    quoted inline as an example (`` `DR-999` `` in a sentence about the format) still
    warns; an author must write it some other way.
  - **(b)** Skip inline code spans as well. **Cost:** blinds the file-citation check:
    34 of today's 45 file-citation warnings are citations written only in inline code,
    because a citation such as `scripts/validate-frontmatter.ts:620` is normally backticked.

  **Recorded selection: Option (a),** fenced blocks only are excluded; inline code stays a reference. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.
- **D3. How are parent-register numbers (`DR-359` and friends) classified?**
  - **(a) (rec)** `broken`, with a message naming the likely cause ("not in this register;
    if this is an `mmo-platform` number, write it `MMO/DR359`"). The `MMO/DR359` form
    resolves `external`. The 46 refs are rewritten by #681's migration. **Cost:** the 46
    warnings stay until #681 runs.
  - **(b)** A further state, `foreign`, chosen when the line carries the attribution words
    `parent-register-refs.test.ts` already accepts ("parent register", "global"). **Cost:**
    a second copy of that attribution predicate, which SPEC-252 records as already too loose
    (a negation counts as attribution), and a state that disappears once #681 rewrites the
    refs.
  - Not offered: calling them `ambiguous`. The resolver sees zero candidates for them,
    because the parent register is in another repo and invariant 1 forbids reading it.

  **Recorded selection: Option (a),** `broken`, with a message naming the likely cause and the `MMO/DR359` form. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.
- **D4. Where does this land relative to #679?**
  - **(a) (rec)** This spec is built first (the shared type, registry and extractor), and
    the #679 spec's FR-5 and FR-8 are amended to return these states. **Cost:** #679 waits on
    this build, or rebases onto it.
  - **(b)** Fold these requirements into the #679 spec and close this one. **Cost:** that
    spec is already at T3 with four open decisions; adding fence handling and the registry
    change widens it beyond the `project-prefix` module.

  **Recorded selection: Option (a),** this spec is built first, and the #679 spec's FR-5 and FR-8 are amended to return these states. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.

## Out of scope

- Indented (four-space) code blocks. Inside lists, four-space indentation is ordinary
  continuation text, so treating it as code would drop real references. Rejected below.
- HTML comments (`<!-- dr-summary:DR-053 ... -->` markers in `docs/decisions/INDEX.md`).
- The paragraph-segment grammar itself, the prefix table wiring and dual-read: #679.
- Rewriting the 46 parent-register refs or any other corpus migration: #681.
- The guard hook that blocked git commands quoted in issue bodies (memory note
  `f-guar-grep`): a different extractor in a different place. FR-12's shared function may
  serve it later; nothing here changes it.
- Rendering the candidate list in the editor: SPEC-035 Slice C.

## Alternatives rejected

- **Return `ambiguous` as an error object or throw.** Breaks DR-053 §5 and INV-3, and makes
  every consumer wrap the resolver.
- **Pick the "best" candidate (same directory, newest file).** The silent wrong answer
  DR-003 and INV-4 forbid; it is exactly what the id set does today.
- **Fold `ambiguous` into `broken`.** Loses the candidate list, which is what a reader needs
  to fix the ref.
- **Copy sdyckjq's `wikilink-parser.js`.** Its licence grant is broken (research note, line
  241). Re-implement from the described behaviour.
- **Treat indented code blocks as code.** Misreads list-continuation lines (Out of scope).

## Follow-ups (tracked)

- **#679** — the `project-prefix` v2 grammar update adopts FR-1's states (D4). Its spec's
  FR-5 and FR-8 need the amendment D4 describes, and its draft spec must be renumbered
  before merging: it reuses id number 080, already held on `main` (see Context).
- **#681** — corpus migration rewrites parent-register refs to `MMO/DRn` (D3).
- **SPEC-035** — Slice C renders `ambiguous` as a candidate list (FR-8).
- **DR-053 addendum** — once #679 ships, §5 should name `ambiguous` beside "unknown is
  advisory", so the decision record matches the shipped contract. Not filed by this
  dispatch, which has no issue-tracker access; the human or dispatcher should file it or
  add a `docs/backlog.md` line at Clarify.
