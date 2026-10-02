---
id: SPEC-103
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a document that still claims a review against a value that has since changed is a false signpost
aspects: [staleness, traceability, frontmatter, validation, tier-0, no-silent-gate, parity, downstream]
relates_to: [DR-062, DR-011, DR-004, DR-066, DR-074, DR-090, SPEC-041, SPEC-075, SPEC-038, "#44", "#643", "#147"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3). All three
# files are NEW and are needed under every recommended Clarify option below. Choosing CQ-1
# option `b` (do not build) empties both lists and closes this spec.
implements: [packages/minspec/src/lib/tracked-targets.ts, packages/minspec/tests/tracked-targets.test.ts, packages/minspec/tests/tracked-targets-parity.test.ts]
# Modified, not owned. template-registry.ts and .minspec/hooks/validate.py are also under
# `affects:` in SPEC-075 (validate corpus from config), which is still `specifying`; whichever
# of the two is built second rebases onto the other (see Risks R4).
affects: [packages/minspec/src/lib/template-registry.ts, .minspec/hooks/validate.py, scripts/validate-frontmatter.ts, packages/minspec/src/lib/diagnostics.ts, packages/minspec/src/extension.ts, packages/minspec/src/lib/config.ts, packages/minspec/src/commands/validate.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Review-gated documents: report when the thing a document was reviewed against has changed (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, template, or test is created by this
> document. It is the Specify-phase artifact for
> [#44](https://github.com/AIClarityAU/minspec/issues/44), which triage classified as needing a
> spec before any build. A human reads it, answers the questions under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the normal
> spec-approval gate. Every requirement below is written under each question's **recommended**
> option; choosing a different option changes only the requirements that question names.

**Id note.** The six ids after `SPEC-096` are claimed by other in-flight specify dispatches:
read from every remote-tracking branch and every local worktree visible from this checkout on
2026-10-02 (the first of the six is claimed four times over there; the sixth by the worktree
for issue 37, not yet pushed). So this is `SPEC-103`. Open pull requests are not visible from
a network-less checkout; if the id collides at review time, renumber the directory and the
`id:` line together.

**Tier note.** T3 (full spec cycle: specify, plan, tasks, implement). The recommended design
touches three new files and seven existing ones, above the seven-file T2 ceiling and below the
fourteen-file T3 ceiling in `.minspec/config.json` (`thresholds`).

## One-Sentence Scope

Let a markdown document declare, in its own frontmatter, the files or single lines it was
reviewed against together with the value each had at review time, and have the editor, the
commit hook and CI all report, from one deterministic offline rule, when a declared value no
longer matches — without ever recording a new value on the reviewer's behalf.

## Context

### The problem, as the issue states it

A document can be true only while some other thing in the repository holds a particular
value. The issue's trigger is an anonymisation self-assessment whose verdict holds only for
telemetry schema version 1 (scroogellm's `DR-010@scroogellm`): bump the schema and the
verdict silently stops applying, and nothing says so. The issue names two more of the same
shape — a security review tied to a dependency version, and a decision record tied to a
source file — and asks whether MinSpec should offer one declarative mechanism or leave each
project to write its own test.

### What exists today (read at `a024a751`, not inferred)

- **Nothing reads a `tracks:` key.** A search of `packages/minspec/src` and `specs/` for
  `tracks:` as a frontmatter key finds no reader and no declaring document.
- **The trigger document is not in this repository.** `docs/research/` holds six files and
  the self-assessment is not one of them; `packages/scroogellm` does not exist here. Both went
  with the split recorded in DR-027 (ScroogeLLM to its own repository). So the one known
  consumer lives in another repository — I believe it is still there, unverified from this
  checkout — and that repository already has the interim per-project test the issue
  describes. This matters for CQ-1.
- **No document outside the three approvable folders carries frontmatter here.** Of the six
  tracked markdown files under `docs/` outside `docs/decisions/` and `docs/epics/`, none
  begins with a frontmatter block (counted by reading the first line of each). This
  repository has no ready-made first user of the feature either.
- **The neighbouring problem is large, and is not this one.** Specs and decision records here
  cite code by `file:line` 1,914 times across 118 files (counted with the pattern
  `<path>.(ts|py|sh|json|yml):<digits>` over `specs/` and `docs/decisions/`). Those are
  *implicit* citations that rot; checking them is tracked as #147 (does the cited line still
  hold the cited symbol) and #643 (symbol-anchored trace between approvables and code,
  "leg B" of DR-062). This spec covers only the *explicit* declaration the issue sketches.

### Prior decisions this design must sit inside

- **DR-062 (approval validity is graph-aware)** fixed the spine for every staleness feature:
  record what something was signed off against, *derive* drift on read, and never let the
  tool rewrite a sign-off (`docs/decisions/DR-062.md:55-56`, `:115-119`). It rejected a
  watcher that rewrites records and an LLM that judges whether a change matters
  (`:179-184`). This spec applies the same spine to a document and a code value.
- **SPEC-041 (cross-artifact staleness)** carries DR-062 between approvables and is
  `implementing`. Its `upstreamDeps` field and `upstream-stale` state are **not in the code
  yet**: a search of `packages/*/src` for either term finds nothing. This spec must not
  depend on them.
- **DR-004 (tier model)**: MinSpec core is Tier 0, fully offline
  (`docs/decisions/DR-004.md:24`). The extension's runtime dependencies are `handlebars`,
  `simple-git` and the shared package only (`packages/minspec/package.json`, `dependencies`).
- **G-6 (determinism as moat)**: the same rule fires in the editor, at commit, and in CI
  (`.minspec/constitution.md:53-54`). The commit and CI rule for adopters is a Python
  standard-library script, `.minspec/hooks/validate.py`, called from
  `.minspec/hooks/pre-commit:88` and `.github/workflows/minspec-validate.yml:40`. Any rule
  this spec adds must therefore exist twice — TypeScript and Python — and agree. The
  precedent for holding twins together is the canonical-hash pair with its parity and golden
  tests (`packages/shared/src/canonical.ts:1-7`).

### Three findings that shape the requirements

1. **The issue's frontmatter sketch is not readable by either existing parser.** Measured
   with a throwaway probe (not part of this change) feeding both parsers a two-entry
   list-of-maps `tracks:` block:
   - The Python validator's reader splits each line on its first colon into one flat map
     (`.minspec/hooks/validate.py:36-47`). It returned `tracks` as empty, plus a key literally
     named `- target` and a key `recorded`, each holding only the **last** entry's value. The
     first entry is lost without any error.
   - The extension's reader has no list-of-maps form (`packages/minspec/src/lib/spec.ts:133`,
     nested lines handled at `:143`). It does preserve the block verbatim through a
     read-then-write round trip, as an unrecognised key (`spec.ts:205`; the probe confirmed
     the five lines survive unchanged).

   So the sketch needs a purpose-built reader in both languages, and a reader that fails to
   recognise an entry reports *fewer entries*, which looks exactly like "nothing to check".
   That is the silent-gate shape of constitution invariant 2, and FR-4 and INV-1 exist to
   close it.

2. **"Reuse the existing hash and marker stores" does not hold up; reuse the primitives.**
   `.minspec/generated-hashes.json` answers a different question — whether a section of a
   managed file is MinSpec's own output (`packages/minspec/src/lib/merge-refresh.ts:1334`,
   DR-011) — and a recorded hash there is treated as evidence of authorship. Putting review
   fingerprints in it would mix two kinds of evidence in a store whose misreading already
   deleted user content once (#1697). `.minspec/traceability.json` maps a requirement to
   `file:line` ranges and holds no values or hashes
   (`packages/minspec/src/lib/traceability.ts:1-17`). What *is* reusable: sha-256 over
   normalised line endings, the dependency-free frontmatter-reading pattern, the
   twin-with-parity-test pattern, and the existing diagnostics wiring.

3. **Symbol-value resolution through CodeGraph is not available to a Tier-0 rule.**
   CodeGraph here is a machine-local index, ignored by git (`.gitignore:132-133`) and reached
   through an external tool; it is not a dependency of the extension, and it does not exist
   in the commit hook or in CI. DR-029 already classes it as Tier 1 (local tool delegation,
   opt-in) (`docs/decisions/DR-029.md:196`). A rule that resolves in the editor and cannot
   resolve in CI breaks G-6. This drives the recommendation in CQ-3.

### Why no decision record yet

The frontmatter shape (CQ-2) and what a target may be (CQ-3) become a public contract the day
an adopter writes a `tracks:` block: withdrawing or reshaping it breaks their documents, which
is not undoable in under a day. That needs a decision record. It is not minted by this
dispatch because the decision itself is the human's and has not been made — a record written
now would record a guess. **FR-13 makes the record a precondition of the Plan phase.** No
existing record covers it: `docs/decisions/INDEX.md` was searched for staleness, drift,
tracking and review-gating; DR-062 is the nearest and decides the approvable-to-approvable
direction only, naming the code direction as owned elsewhere (`docs/decisions/DR-062.md:141-146`).

## Terms

- **Tracking document** — a markdown document whose frontmatter has a `tracks:` key.
- **Entry** — one item under `tracks:`: a `target`, an optional `select`, and a `recorded`.
- **Current value** — what the target resolves to now (FR-2).
- **Verdict** — exactly one of `current` (recorded equals current), `drifted` (they differ),
  `unresolvable` (the target cannot be resolved to one value), or `malformed` (the entry
  cannot be read).

## Functional Requirements

- **FR-1 (declaration).** A markdown document MAY declare `tracks:` in its frontmatter as a
  block list. Each entry has `target` (required: a repo-relative path, forward slashes),
  `select` (optional: a literal string) and `recorded` (required: the value at review time).
  Example, for the issue's trigger and for a dependency version:

  ```yaml
  tracks:
    - target: src/telemetry/point.ts
      select: "schemaVersion:"
      recorded: "schemaVersion: 1 as const,"
    - target: package.json
      select: '"jose":'
      recorded: '"jose": "^6.2.10",'
    - target: docs/threat-model.md
      recorded: sha256:9f2c…   # whole file
  ```

  *Shape is CQ-2; what a target may be is CQ-3.*

- **FR-2 (resolution — two forms, both text-level).**
  - *Whole file* (no `select`): the current value is `sha256:` followed by the hex digest of
    the file's bytes after every CRLF and lone CR is replaced by LF. *Rationale: a checkout
    with different line endings must not read as drift.*
  - *Single line* (`select` present): exactly one line of the file must contain the `select`
    string as a literal substring; the current value is that line with leading and trailing
    whitespace removed. Zero matching lines, or two or more, is `unresolvable`.
    `select` is **never** a regular expression. *Rationale: the Python and JavaScript regex
    dialects differ, and the two implementations must agree byte for byte.*
  - `recorded` is compared to the current value as an exact string, in full. Display may
    shorten a hash; comparison never does.

- **FR-3 (verdict is derived, nothing is stored).** A verdict is a pure function of the entry
  and the target file's present contents. No verdict, timestamp or cache is written anywhere,
  and no file or directory is created. *Rationale: DR-062's spine; and no new store means no
  new writer of `.minspec/`.*

- **FR-4 (a declaration that cannot be read is an error, never "no declaration").** Each of
  these is `malformed` and is reported at `error` severity regardless of FR-9's setting: an
  entry missing `target` or `recorded`; an unknown key in an entry; a `target` that is
  absolute, contains a `..` segment, or resolves outside the repository root; a `target`
  naming the tracking document itself; two entries with the same `target` and `select`; and
  — independently of the entry reader — **a frontmatter block that contains a top-level
  `tracks` key from which zero entries were read.** *Rationale: finding 1. The last clause is
  a second witness that does not share the entry reader's failure modes (invariant 2).
  Precedent for "invalid declaration is always an error":
  `packages/minspec/src/lib/spec-validator.ts:836`.*

- **FR-5 (which documents are read).** The rule reads every markdown file under the
  configured specs directory, the configured decisions directory, and `docs/`, plus markdown
  files at the repository root. A document that declares `tracks:` **outside** that set MUST
  be reported by the editor when it is opened or saved, saying the commit and CI rule will not
  read it. *Rationale: a declaration no gate reads is a promise nobody keeps. If SPEC-075
  (validate corpus from config) lands a configured corpus list first, this rule reads that
  list instead of defining a second one.*

- **FR-6 (one rule, four call sites, one answer).** The same entries produce the same verdicts
  and the same current values in:
  1. the editor — diagnostics on the tracking document, anchored on the entry's `recorded`
     line, through the existing diagnostics wiring
     (`packages/minspec/src/extension.ts:648`);
  2. the adopter validator `.minspec/hooks/validate.py`, in both its full run and its
     `--pre-commit` run;
  3. this repository's own `npm run validate` (`scripts/validate-frontmatter.ts`);
  4. the **MinSpec: Validate** palette command, when the spec it checks declares `tracks:`
     (`packages/minspec/src/commands/validate.ts:21`).

  Call sites 2 and 3 evaluate **every** tracking document on every run, including
  `--pre-commit`. *Rationale: a staged-files-only check misses the common case — the target
  is staged and the tracking document is not.*

- **FR-7 (the message says what to do).** A `drifted` report names the tracking document, the
  target and `select`, the recorded value, the current value, and the remedy: re-review the
  document, then set `recorded` to the printed current value. An `unresolvable` report says
  which of the two reasons applied (file missing; zero or several lines matched, with the
  count). Wording follows the consumer's vantage (DR-090): it describes the adopter's
  document, never this repository's.

- **FR-8 (the tool never records a value).** No MinSpec code path writes or changes a
  `recorded` value, and the first version ships no quick-fix or command that does. The current
  value is printed so a human copies it deliberately. *Rationale: setting `recorded` is the
  claim "I re-reviewed this"; a one-click bump is the rubber-stamp affordance constitution
  principle 2 warns about, and an automatic one forges a review (DR-062 section 4).*

- **FR-9 (severity is the project's choice, visible by default).** A new optional key in
  `.minspec/config.json`, `trackedTargets`, takes `warn` (the default when absent) or `error`.
  `drifted` and `unresolvable` are reported at that severity; under `error` they fail the
  commit hook and CI. Any other value for the key is itself a fatal configuration error that
  names the file and the value; it MUST NOT fall back to `warn`. *Precedent: the
  `ownershipDeclaration` key (`packages/minspec/src/lib/config.ts:60`, default at `:140`).
  Severity is CQ-4.*

- **FR-10 (the run states what it checked).** When at least one tracking document exists,
  call sites 2 and 3 print one line giving the number of tracking documents and entries
  evaluated and the count per verdict. When none exists, output is unchanged from today.
  *Rationale: "all current" and "checked nothing" must not look alike.*

- **FR-11 (editor: tell the person who just changed a target).** When a saved file is the
  target of one or more entries and that save moves an entry from `current` to `drifted`, the
  editor shows one non-modal notice naming the tracking documents affected. It appears once
  per entry per transition, not on every later save. *Rationale: the person bumping the
  schema is the one who can act; constitution principle 4 (avoid nagging) bounds the
  frequency. Same surface pattern as SPEC-041 FR-6.*

- **FR-12 (approvables: re-recording is re-approval, by existing behaviour).** When the
  tracking document is a hash-locked approvable, the `tracks:` block stays inside the
  canonical approval hash: canonicalisation removes only `status` and `phases`
  (`packages/shared/src/canonical.ts:14-16`), and this spec MUST NOT add `tracks` to that
  list. Editing `recorded` therefore stales the approval, and the existing attributed approve
  act is the acknowledgement. A `drifted` entry does **not** change the derived approval
  status in this spec (see Out of scope).

- **FR-13 (decision record before Plan).** Before this spec's Plan phase starts, the answers
  to CQ-2 and CQ-3 MUST be recorded in a decision record that states the frontmatter contract
  and the exact scalar-quoting rule for `recorded` and `select`, references this spec and
  `Triggered by: #44`, and takes its number from the collision gate.

## Acceptance Criteria

- **AC-1 (trigger case).** A fixture document tracking the line selected by `schemaVersion:`
  reports `current`; changing `1` to `2` in the target reports `drifted`, and the message
  contains both line texts and the document's path.
- **AC-2 (whole file).** A whole-file entry reports `current`; changing one byte of the target
  reports `drifted`; converting the target's line endings to CRLF with no other change still
  reports `current`.
- **AC-3 (unresolvable, both reasons).** Deleting the target reports `unresolvable` naming a
  missing file. A `select` matching no line, and one matching two lines, each report
  `unresolvable` with the match count.
- **AC-4 (malformed is loud).** Each malformed shape in FR-4 produces an `error` naming the
  document, with `trackedTargets` unset. In particular a `tracks:` block written in a form the
  entry reader does not accept (for example an inline `tracks: [a, b]`) is an error, not zero
  entries.
- **AC-5 (severity).** With `trackedTargets` absent, a drifted fixture exits zero from the
  Python validator and prints the warning. With `error`, it exits non-zero. With
  `trackedTargets: "eror"`, the validator exits non-zero naming the config file and does not
  evaluate at `warn`.
- **AC-6 (parity).** For one shared golden fixture set — including values containing quotes,
  colons, `#`, tabs and non-ASCII characters — the TypeScript and Python implementations
  return identical verdicts and identical current values for every entry.
- **AC-7 (pre-commit sees an unstaged tracking document).** With the target change staged and
  the tracking document unstaged, the `--pre-commit` run reports the drift.
- **AC-8 (no declaration, no change).** For a fixture with no `tracks:` key anywhere, both
  validators' exit code and output are byte-identical to today's.
- **AC-9 (count line).** With two tracking documents holding three entries, the run prints
  the two and the three and a per-verdict breakdown.
- **AC-10 (no write).** After every call site has run against a fixture, the fixture's file
  listing and every file's bytes are unchanged, and no `.minspec/` directory has been created
  in a fixture that lacked one.
- **AC-11 (outside the read set).** Opening a document under `packages/` that declares
  `tracks:` produces the editor report required by FR-5.
- **AC-12 (approval hash untouched).** The canonical hash of every spec in this repository is
  identical before and after the change; and for a fixture approvable, editing `recorded`
  changes its canonical hash.
- **AC-13 (notice frequency).** Saving a target so an entry drifts shows the FR-11 notice
  once; saving the same target again without a new transition shows nothing.

## Invariants

- **INV-1 (no silent pass).** Every entry that is declared yields a verdict that is reported.
  No code path may turn an unreadable declaration, an unreadable target, or an unreadable
  config value into `current` or into silence (constitution invariant 2).
- **INV-2 (read-only).** The feature writes nothing: no `recorded` value, no store, no
  directory. It cannot create `.minspec/` (constitution invariant 3; SPEC-096).
- **INV-3 (offline, Tier 0, inside the repository).** No network call, no new runtime
  dependency, Python standard library only, no CodeGraph, no compiler invoked at check time.
  A target never resolves outside the repository root (constitution invariants 1 and 3).
- **INV-4 (one answer).** The four call sites of FR-6 never disagree about a verdict or a
  current value for the same files (G-6).
- **INV-5 (projects that do not declare are unaffected).** No `tracks:` key anywhere means no
  change in exit code, output or behaviour.
- **INV-6 (the approval hash is not redefined).** `packages/shared/src/canonical.ts` and its
  Python twin are not modified.
- **INV-7 (activation stays cheap).** The editor computes verdicts after activation and on
  save, never blocking activation (constitution constraint 3), and only in a folder that has
  opted in (`packages/minspec/src/lib/preferences.ts:159`).
- **INV-8 (one owner per file).** This spec owns only its three new files.

## Decisions needed (Clarify)

Six questions. Each names the recommended option and what that option costs.

### CQ-1 — Build this in MinSpec at all, or leave each project to its own test?

- **`a` — build it, as specified here (rec).** One declaration serves every document and
  every language, a non-programmer can write it, and the rule runs in the editor as well as
  in CI.
  **Cost:** it creates a permanent public frontmatter contract and a second
  TypeScript-and-Python twin to keep in parity forever, for a feature with **one** known
  consumer, which lives in another repository, belongs to a shelved product, and already has
  a working per-project test. It is also not on the Phase 1 (Dogfood-ready — the blocker
  line) list, so it must not displace anything that is.
- **`b` — do not build; close #44 pointing at the per-project test pattern.** Zero new
  surface.
  **Cost:** every further document of this kind needs someone to write and maintain a test
  by hand, the check never appears in the editor, and the pattern stays undiscoverable to an
  adopter.

### CQ-2 — Where the declaration and the recorded value live

- **`c` — in the document's own frontmatter, as a block list (rec).** The issue's sketch. The
  claim travels with the document, shows in every diff, and survives a rename.
  **Cost:** neither existing parser reads a list of maps (finding 1), so two purpose-built
  readers must be written and held in parity, and a strict quoting rule must be fixed for
  values containing quotes and colons. This is the contract FR-13 records.
- **`d` — in one JSON file under `.minspec/`, keyed by document path.** Both languages parse
  JSON natively; no YAML subset to define.
  **Cost:** the claim is invisible when reading the document, a renamed document orphans its
  entry (a class this repository already has to detect for approval sidecars,
  `scripts/validate-frontmatter.ts:458`), and it adds a new writer-adjacent file under the
  opt-in marker.

### CQ-3 — What a target may be

- **`e` — a whole file, or one line picked by a literal string (rec).** Language-agnostic,
  identical in Python and TypeScript, works in the commit hook and CI, and for the single-line
  form the report reads "was X, now Y" in plain text.
  **Cost:** it is textual, not semantic. Reformatting or re-indenting inside the selected
  line reads as drift; a change of meaning elsewhere in the file that leaves the line alone
  is missed; a value spread over several lines can only be tracked as the whole file; and a
  renamed symbol reads as `unresolvable` until the author updates `select`.
- **`f` — whole file only.** Smallest possible build.
  **Cost:** every unrelated edit to the target file demands a re-review. For the trigger case
  that means any change to the telemetry source, which trains the reviewer to bump the hash
  without reading — the opposite of the goal.
- **`g` — resolve a symbol's value through CodeGraph or the TypeScript compiler.** Semantic:
  immune to reformatting, and follows a rename.
  **Cost:** not Tier 0 (finding 3). It cannot run in the Python commit hook or in CI, so
  either those call sites pass without checking — a silent gate — or they fail permanently.
  It is also TypeScript-only, which excludes the issue's own dependency-version example. If
  wanted, it belongs to #643 as a Tier 1 addition on top of `e`, not in place of it.

### CQ-4 — Does drift block, or only warn?

- **`h` — project setting, `warn` by default, `error` opt-in (rec; FR-9).**
  **Cost:** under the default a drift can sit unread indefinitely; it is visible but nothing
  forces the re-review. Under `error`, every commit in the repository is blocked by one
  drifted document until someone re-reviews it, including commits by people who did not cause
  the drift — which pushes toward bumping `recorded` unread (see CQ-6).
- **`i` — always an error.** Matches the issue's interim test, which fails CI on drift.
  **Cost:** an adopter cannot adopt the declaration gradually; the first drift blocks the
  repository.
- **`j` — always a warning.** Never blocks.
  **Cost:** the feature can never be made into a gate, so a project that wants the interim
  test's strength must keep the interim test.

### CQ-5 — Does a drifted document appear in the next-task signpost?

- **`k` — not in this spec (rec).** Drift shows as editor diagnostics, the FR-11 notice, and
  the validator's output.
  **Cost:** a drift is seen only by someone who opens the document, saves a target, or reads
  the validator's output; the status bar — the one place the issue names that this spec does
  not deliver — stays silent. A follow-up issue is needed and is **not yet filed** (see
  Follow-ups).
- **`l` — add a "re-review this document" task class to the resolver now.**
  **Cost:** it changes the shared next-task resolver, the never-wrong core every other
  signpost guarantee rests on (`packages/shared/src/next-task.ts`), and pushes this spec to
  T4 (complete ceremony: all phases).

### CQ-6 — Is an unattributed edit to `recorded` an acceptable acknowledgement?

Applies to documents that are **not** approvables; approvables are already covered by FR-12.

- **`m` — yes, for the first version (rec).** Re-recording is an ordinary edit, visible in
  the diff of the commit or pull request that makes it.
  **Cost:** the rule then measures "someone changed the value", not "someone re-reviewed".
  An agent facing a red check can make it green with a one-line edit, and nothing
  distinguishes that from a real review except whoever reads the diff. This is the "trust
  the model" shape constitution principle 8 names as the failure mode.
- **`n` — require an attributed, committed acknowledgement record, as approvals have.**
  **Cost:** a new store and a new human-identity check, coupled to approval machinery that
  SPEC-041 is still changing; it makes this T4 and needs its own decision record.

## Out of scope

- **A drifted entry changing an approvable's approval status.** An approved spec whose
  tracked target has drifted still derives `approved` and carries a drift report beside it.
  Making code drift an input to approval validity is "leg B" of DR-062, owned by #643.
- **Checking the implicit `file:line` citations** already in the corpus (#147, #643).
- **A Claude Code `PreToolUse` gate.** Rejected rather than deferred: drift is *caused by*
  the edit, so there is nothing to deny before it; the actor-agnostic place to catch it is
  the commit hook (DR-062 section 3 reasoning).
- **Targets in another repository or on the network** (constitution invariants 1 and 3).
- **Tracking a region bounded by marker comments inside the target file.** Considered as a
  more robust alternative to `select`; it requires editing the target, which is impossible
  for JSON files and for files the reviewer does not own.
- **Autocompletion for the `tracks:` key** in the frontmatter completion provider.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | The two readers disagree on an edge of the quoting rule, so the editor says `current` and CI says `drifted`. | FR-13 fixes the rule in a decision record before Plan; AC-6's golden fixtures cover quotes, colons, `#`, tabs and non-ASCII. |
| R2 | A reader silently drops entries (finding 1). | FR-4's independent zero-entries check; AC-4. |
| R3 | Under `warn`, reviewers learn to ignore the warning; under `error`, they learn to bump `recorded` unread. | Named as the cost in CQ-4 and CQ-6; FR-8 withholds the one-click bump. Not eliminated. |
| R4 | SPEC-075 (validate corpus from config) changes the same Python template and the same registry file. | Both list them under `affects:` only; the second to build rebases, and FR-5 says whose corpus list wins. |
| R5 | A large repository with many tracking documents slows the commit hook. | Reads are bounded to declared targets; the Plan phase measures the hook on this repository before and after. |

## Rejected alternatives (recorded because nobody reviews them live)

- **Store the recorded value in `.minspec/generated-hashes.json`** — mixes review evidence
  into authorship evidence (finding 2).
- **A watcher that updates `recorded` when the target changes** — forges a review (DR-062,
  `docs/decisions/DR-062.md:179-181`).
- **An LLM judging whether a change to the target matters** — puts a model in the decision
  path (`docs/decisions/DR-062.md:182-184`).
- **A regular-expression `select`** — dialect differences between the two implementations.
- **An inline one-line form** such as `tracks: ["path :: select :: recorded"]` — avoids a
  new block reader but invents a delimiter grammar that is harder to read and to escape.
- **Reusing the general spec frontmatter parser** — it has no list-of-maps form, and widening
  it risks every existing spec's parse for one new key.

## Test

T0 (owned by this spec):

- `packages/minspec/tests/tracked-targets.test.ts` — one case per acceptance criterion against
  the pure module, plus the no-write assertion of AC-10.
- `packages/minspec/tests/tracked-targets-parity.test.ts` — runs the shipped Python template
  and the TypeScript module over the same golden fixtures (AC-6).

Both must include a **control**: a fixture known to be drifted must be reported as drifted by
the same run that reports the others as current, so the suite cannot pass by finding no
entries at all.

## Follow-ups

Not filed — this dispatch has no network access, so each needs a human or a later session to
file it before this spec is approved:

- A decision record for the `tracks:` contract (FR-13), once CQ-2 and CQ-3 are answered.
- If CQ-5 is answered `k`: an issue for surfacing drifted documents in the next-task
  signpost.
- If CQ-6 is answered `m`: an issue for an attributed acknowledgement, so the stated cost has
  a tracked home.
- A note on #643 that this spec delivers the explicit-declaration half and leaves approval
  validity to it.

## Traceability

- **Originating issue:** [#44](https://github.com/AIClarityAU/minspec/issues/44).
- **Rests on:** [DR-062](../../../docs/decisions/DR-062.md) (derive drift on read, never
  rewrite a sign-off), [DR-004](../../../docs/decisions/DR-004.md) (Tier 0),
  [DR-066](../../../docs/decisions/DR-066.md) (no silent gate),
  [DR-074](../../../docs/decisions/DR-074.md) (blast radius),
  [DR-090](../../../docs/decisions/DR-090.md) (managed prose from the consumer's vantage),
  [DR-011](../../../docs/decisions/DR-011.md) (the marker store this spec deliberately does
  not reuse).
- **Siblings:** [SPEC-041](../SPEC-041-cross-artifact-staleness/requirements.md) (the
  approvable-to-approvable direction),
  [SPEC-075](../SPEC-075-validate-corpus-from-config/requirements.md) (shares the Python
  validator), #643 and #147 (implicit citations).
