---
id: SPEC-095
type: requirements
status: planning
tier: T4
product: minspec
epic: EPIC-002  # Signpost Integrity - on a CRLF checkout the signpost's inputs read every decision as proposed, and the writers behind them damage or refuse the files they are derived from
aspects: [line-endings, crlf, windows, frontmatter, harness-refresh, approval-hash, byte-order-mark, silent-gate, tier-0]
relates_to: [SPEC-022, SPEC-043, DR-003, DR-011, DR-034, DR-037, DR-066, DR-074, "#2397", "#2398", "#2404", "#2405", "#153", "#1668"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038, the spec-code
# ownership spec, FR-1/FR-2; the shipped `/minspec-specify` guidance). Declaring after
# approval would edit the bytes the canonical hash covers and stale the sign-off. All three
# files are NEW. The two tests (FR-9, FR-10) are required under the recorded DQ-7
# selection. The helper (FR-1) is required under the recorded DQ-1 selection and under its
# Option B. All three are named now because adding one later would edit hashed bytes;
# choosing an option that removes one edits this spec anyway.
implements: [packages/minspec/src/lib/text-io.ts, packages/minspec/tests/text-round-trip.test.ts, packages/minspec/tests/text-io-inventory.test.ts]
# Modified, not owned: the twenty-three existing source files the recorded options change.
# Eighteen hold a reader, a writer or a command path that changes for CRLF or for FR-6.
# Five hold a reader that survives CRLF today and is routed through the helper under
# DQ-10 Option A (artifact-graph, auto-bootstrap, constitution-nudge, reference-checker,
# template-engine); choosing DQ-10 Option B removes those five, and that choice edits this
# spec anyway.
# The spec gate freezes `affects:` paths exactly as it freezes `implements:`
# (`scripts/hooks/spec-gate.py:382`), and only once a spec's phases reach the
# implementation range (`:565-567`): nothing is frozen while this spec is in Specify, and
# if its approval goes stale during its build, edits to all twenty-three are blocked for
# every session until it is approved again. `packages/shared/src` is absent on purpose
# (FR-8, INV-1).
affects: [packages/minspec/src/lib/adr-manager.ts, packages/minspec/src/lib/epic-manager.ts, packages/minspec/src/lib/spec.ts, packages/minspec/src/lib/spec-manager.ts, packages/minspec/src/lib/spec-layout.ts, packages/minspec/src/lib/merge-refresh.ts, packages/minspec/src/lib/scaffold.ts, packages/minspec/src/lib/constitution.ts, packages/minspec/src/lib/constitution-compaction.ts, packages/minspec/src/lib/constitution-proposer.ts, packages/minspec/src/lib/constitution-nudge.ts, packages/minspec/src/lib/status-parity.ts, packages/minspec/src/lib/epic-backfill.ts, packages/minspec/src/lib/slash-commands.ts, packages/minspec/src/lib/context-injector.ts, packages/minspec/src/lib/parking-lot.ts, packages/minspec/src/lib/artifact-graph.ts, packages/minspec/src/lib/auto-bootstrap.ts, packages/minspec/src/lib/reference-checker.ts, packages/minspec/src/lib/template-engine.ts, packages/minspec/src/views/spec-panel.ts, packages/minspec/src/commands/constitution.ts, packages/minspec/src/commands/adr.ts]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-095: MinSpec reads a CRLF file the same as an LF one, and writes it back as it found it

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks its Clarify questions, and approves it through the normal spec-approval
> gate before any code changes. Each question carries an agent-recorded selection under
> **[Clarify selections](#clarify-selections-recorded-by-an-agent-2026-10-02-ratified-only-by-approval-of-this-spec)**;
> the human answers by approving this spec with those in place, or by changing them first.
> Every requirement below is written under each decision's recommended option, so approving
> the spec as it stands accepts those recommendations and leaves no question open. Choosing
> a different option changes only the requirements that decision names.

Materializes **[#2397](https://github.com/AIClarityAU/minspec/issues/2397)** - *"windows:
CRLF files break frontmatter and section parsing - Accept Decision prepends a second
frontmatter block, Refresh doubles CLAUDE.md, Approve Spec fails."* It is one of the three
Windows hazards the proposed preview-release decision record treats as blocking
(`docs/decisions/DR-100.md:122`). The three symptoms in the title are instances. This spec
specifies the property they are instances of: every read of a document, and every writer
that reads a document and writes it back.

**Id note.** 095 was assigned to this spec. When it was written, 096 was claimed by an
open pull request (#2469, the opt-in marker spec), 094 was on a remote branch with no pull
request, and no branch or open pull request held 095 (checked across `origin/main`, every
remote branch and every open pull request on 2026-10-02). If the id collides at review
time, renumber.

**Tier note.** T4 by mechanical scope, not by difficulty. The recorded options change the
twenty-three existing source files in `affects:` and add the three files in `implements:`,
twenty-six in all. The classifier's own file-count rule puts sixteen or more files at T4
(`packages/minspec/src/lib/git-analyzer.ts:30-39`). Triage estimated T3 from about eight
library files; the inventory below found more. A predicted tier is a floor that may be
raised and is never lowered. The build is cut into two slices, and the preview release
waits on the first only (Delivery slices).

## One-Sentence Scope

Make every read of a document in the extension hand on text that parses the same whether
the file is CRLF or LF, make every writer that reads a document and writes it back leave
it in the line ending it found, put both behind one helper so that a lone CR and a leading
byte order mark are read the same way, and pin the property with a behaviour test and an
inventory test that fail when a document can be read or written outside that helper,
without this spec changing what the approval hash covers.

## Context - what the code does today (read from `origin/main` 5fc471cd)

**How each statement was established.** **(R)** means reproduced for this spec: the named
function was run on Linux against LF and CRLF copies of files MinSpec itself generated
(`generateHarnessFiles`, `createAdr`, `createEpic`, `createSpec`), or of a short
hand-written fixture where a generated file does not reach the path, in scratch scripts
that are not committed. **(C)** means read from the code and not run. Two fresh-context
reviews of earlier drafts found missed sites and wrong statements; they are corrected
here, and every statement marked (R) was then run again at this commit, except the one
about the patch for #2404 (the byte order mark issue), which names the commit it was run
at. Nothing was run on a Windows machine. Neither source tree has line-ending code that
depends on the platform: neither references `os.EOL`, and `process.platform` appears only
for a keybinding label (`packages/minspec/src/views/status-bar.ts:91`) and a path
comparison (`packages/minspec/src/lib/presence.ts:309`) **(C)**. That a CRLF input on Linux
therefore reaches the same statements a CRLF checkout reaches on Windows is inferred from
that, unverified on Windows.

### Where CRLF comes from, and why the sibling pin does not remove it

- #2398 (the line-ending pin for scaffolded hooks and scripts, closed) pins only what a
  shell or a CI runner executes: `.minspec/hooks/**`, `.claude/hooks/**`,
  `scripts/**/*.sh`, `scripts/**/*.py` and `.github/workflows/*.yml`
  (`packages/minspec/src/lib/scaffold.ts:337-343`). Its comment leaves the generated
  Markdown out on purpose and names the parsers as separate work (`:328-334`). **(C)**
- The same comment records the premise that on Windows `core.autocrlf=true` is git's
  default and that the next checkout turns files CRLF (`:322-324`). The default is taken
  from that comment and from the issue, unverified here. The conversion is reproduced:
  with `core.autocrlf=true` set by hand, deleting and checking out a committed 49-line LF
  file leaves 49 CRLF lines and a clean `git status`. **(R)**
- This repository pins its own `specs/**` and `.minspec/approvals/**` to LF in
  `.gitattributes` and nothing else, so its decision records, epics and harness files
  would be CRLF on such a checkout as well. **(C)**

### Three mechanisms

1. **A frontmatter pattern that needs `---` followed directly by a line feed, matched
   against the raw file.** The same expression is declared at
   `packages/minspec/src/lib/adr-manager.ts:63`,
   `packages/minspec/src/lib/epic-manager.ts:63`, `packages/minspec/src/lib/spec.ts:103`,
   `packages/minspec/src/lib/scaffold.ts:117` and
   `packages/minspec/src/lib/epic-backfill.ts:185` and `:244`. In a CRLF file the first line
   is `---` and then a carriage return, so none of them matches. What happens next is
   decided by each caller's no-match branch: some treat the file as having no frontmatter,
   some throw. A leading byte order mark defeats the same pattern for the same reason.
2. **A split on `\n` followed by a pattern anchored with `$` and no multiline flag, or by
   an exact comparison.** In JavaScript `.` does not match a carriage return and `$`
   without the `m` flag matches only at the end of the string, so a line that still
   carries its carriage return is not recognised. `parseSections`
   (`packages/minspec/src/lib/merge-refresh.ts:221`, `:234`), `parseSectionsLower`
   (`packages/minspec/src/lib/constitution.ts:99`, `:111`), `stripDraftMarker`
   (`packages/minspec/src/lib/constitution-compaction.ts:34`) and the head-callout status
   pattern (`packages/minspec/src/lib/status-parity.ts:129`, `:189`) have this shape.
3. **Writers that put LF text into a file whose other lines are CRLF, or re-serialize the
   whole file with LF.** Every generator joins its lines with `\n` (for example
   `packages/minspec/src/lib/spec.ts:454`), and no writer looks at the line ending of the
   file it is editing.

Counted with a text search at this commit, with the test and benchmark trees left out: 59
splits on a newline, 11 fence patterns that need a bare line feed, 85 `readFileSync`
calls, 5 `getText` calls and 55 `writeFileSync` calls, across 118 source files. A few
reads and writes go by another name, such as the asynchronous read at
`packages/minspec/src/lib/git-analyzer.ts:395` and the injected pair at
`packages/minspec/src/commands/constitution.ts:72` and `:86`. The tables below hold every
site that was found to go wrong; FR-10 is where each of the rest is classified, and the
requirements bind every site, not only the rows.

### What that does

**Readers that return a wrong answer, with no error**

| Reader | On a CRLF file | |
|---|---|---|
| `listAdrs` (`packages/minspec/src/lib/adr-manager.ts:1308-1326`) | Every record reads `proposed`; its title comes from the file name; its date and epic are empty | R |
| `listEpics` (`packages/minspec/src/lib/epic-manager.ts:118-140`) | Every epic reads `proposed` with order 999, and a title and slug from the file name | R |
| `buildArtifactGraph` (`packages/minspec/src/lib/artifact-graph.ts:563-577`), fed by those two | A register in which every decision is accepted and every epic active has nothing pending on the LF copy. On the CRLF copy the signpost says "Next Task: Accept DR-001" | R |
| `adrHasFrontmatter` (`packages/minspec/src/lib/adr-manager.ts:544-550`) | `false` for a record that has frontmatter | R |
| `readArtifactEpic` (`packages/minspec/src/lib/epic-manager.ts:282-291`) | `null` for an artifact that carries `epic:` | R |
| `validateDrIndexStatus` (`packages/minspec/src/lib/adr-manager.ts:1163-1170`) | A false mismatch for each accepted record: it reads `proposed` against an INDEX that says `accepted` | R |
| `validateDrAmendments` (`packages/minspec/src/lib/adr-manager.ts:352-360`) | A `supersedes:` claim written in frontmatter is not read. The LF copy reports the unacknowledged amendment; the CRLF copy reports nothing | R |
| `inspectAllStatusClaims`, `checkStatusParity` (`packages/minspec/src/lib/status-parity.ts:129`, `:189`) | A `> **Status: proposed ...**` head callout is not seen. The LF copy reports the mismatch with frontmatter `accepted`; the CRLF copy returns nothing | R |
| `parseSections` (`packages/minspec/src/lib/merge-refresh.ts:218-245`) | 13 sections on the LF copy of a generated `CLAUDE.md`, 1 on the CRLF copy | R |
| `hashSection` (`packages/minspec/src/lib/merge-refresh.ts:251-253`) | A different hash for the same content, because the carriage returns inside the body are hashed | R |
| `parseConstitution` (`packages/minspec/src/lib/constitution.ts:128-140`) | No invariants, principles or constraints from a constitution that lists them | R |
| `compactConstitution` (`packages/minspec/src/lib/constitution-compaction.ts:43-75`) | Provenance lines are removed and the `DRAFT:` markers are left in place | R |
| `buildTasksMdContent`, `findSpecDirsMissingTasksMd` (`packages/minspec/src/lib/scaffold.ts:116-128`, `:137-163`, `:219-272`) | The scaffolded `tasks.md` gets the placeholder id (`:138`) and none of the inherited fields; a spec directory that lacks a `tasks.md` is not found | R |
| `extractExistingSummary` (`packages/minspec/src/lib/adr-manager.ts:901-908`) | A summary already in the INDEX is not found, so the rule that keeps a hand-edited one cannot apply | R |
| `collectArtifacts` (`packages/minspec/src/lib/epic-backfill.ts:184-198`, `:244`) | The digest sent with a backfill proposal is the frontmatter text, and a decision's `epic:` is not read. The `product:` read at `:244` has the same pattern | R, the last clause C |
| `checkManagedRegionMarkers` (`packages/minspec/src/lib/scaffold.ts:949-983`, `:1153-1158`) | A managed file whose two marker lines were stripped is reported as diverged, where the LF copy is reported as healable | R |
| `migrateLegacyClaudeSlashCommandShims` (`packages/minspec/src/lib/scaffold.ts:882-885`) | A pristine legacy slash-command shim that Refresh deletes on LF is kept on CRLF | R |

**Writers that damage a file or a register, and report success**

| Writer | On a CRLF file | |
|---|---|---|
| `setAdrStatus` (`packages/minspec/src/lib/adr-manager.ts:709-717`), behind **Accept Decision** and `Alt+A` | An LF block is put in front of the record. The file is left with four `---` lines, two `status:` lines and mixed endings; the original block, still saying `proposed`, is now body text | R for the function, C for the commands |
| `refreshHarnessFiles` (`packages/minspec/src/lib/scaffold.ts:1662-1666`) through `mergeFile` (`packages/minspec/src/lib/merge-refresh.ts:986-990`) | Every template section is appended again, with no notice. `CLAUDE.md` 419 to 836 lines and 12 to 24 headings, `AGENTS.md` 95 to 169 lines, `.cursorrules` 63 to 125, `.minspec/constitution.md` 39 to 77 lines and 4 to 8 headings, `.minspec/labels.md` 97 to 178 | R |
| `seedConstitution` (`packages/minspec/src/lib/scaffold.ts:72-86`) through `integrateProposal` (`packages/minspec/src/lib/constitution-proposer.ts:333-347`) | On its own, as when Initialize is run again (`packages/minspec/src/lib/scaffold.ts:1499`), it appends four headings to the constitution (39 to 53 lines, 4 to 8 headings). On a constitution that already holds human rules it also adds a DRAFT entry under the duplicate heading, where the LF copy adds nothing | R |
| `regenerateDrIndex` (`packages/minspec/src/lib/adr-manager.ts:1062-1085`), which also runs 300 ms after any decision file changes in an initialized project (`packages/minspec/src/extension.ts:526-553`) | The INDEX is rewritten with every status `proposed` and every title taken from a file name | R for the function, C for the watcher |
| `writeEpicIndex` (`packages/minspec/src/lib/epic-manager.ts:640-649`) | The same for the epic INDEX: `proposed`, order 999 | R |
| `applyBackfill` (`packages/minspec/src/lib/epic-backfill.ts:737-779`) | An epic nothing joins is created and nothing is tagged: each tagged artifact looks untagged, so the epic is created, then each tag throws and is counted as skipped | R |

**Writers that refuse**

| Writer | On a CRLF file | |
|---|---|---|
| `setSpecStatus`, `setSpecPhases`, `advanceSpecToImplementing` (`packages/minspec/src/lib/spec.ts:559-562`, `:667-670`, `:735-738`) | Throw `No frontmatter block in <path>`. **Approve Spec** calls the third for a spec in status `new` or `specifying` (`packages/minspec/src/commands/approve.ts:341-345`) and shows the message as a failure (`:414-418`) | R for the functions, C for the command |
| `setEpicStatus`, `setEpicOrder`, `setArtifactEpic` (`packages/minspec/src/lib/epic-manager.ts:302-305`, `:334-337`, `:261-264`) | Throw the same. **Accept Epic** (`packages/minspec/src/commands/epic.ts:28`) and epic drag-and-drop (`packages/minspec/src/views/epic-dnd-controller.ts:74`) surface it | R for the functions, C for the commands |

**Writers that succeed, and leave something other than the CRLF form of their LF result**

| Writer | On a CRLF file | |
|---|---|---|
| `writeSpec` (`packages/minspec/src/lib/spec.ts:454`), reached from `writeSpecFile` (`:480-482`), the spec panel's checkbox write (`packages/minspec/src/views/spec-panel.ts:166`) and `writeSpecKitDir` (`packages/minspec/src/lib/spec-layout.ts:272-293`) | The whole file is rewritten LF: a 37-line CRLF spec comes back as 28 LF lines after one phase transition | R |
| `migrateLayout` (`packages/minspec/src/lib/spec-manager.ts:639-697`) | A CRLF spec is replaced by LF files and the original is deleted: 36 CRLF lines became an LF `spec.md`, `plan.md` and `tasks.md` | R |
| `ensureGitignoreEntries`, `ensureGitattributesEntries` (`packages/minspec/src/lib/scaffold.ts:494-525`, `:355-379`) | An LF block is appended to a CRLF file | R for the first, C for the second |
| `spliceManagedRegion` (`packages/minspec/src/lib/merge-refresh.ts:1546-1553`) | Its block, the whitespace beside the markers and the end of the file are written LF, and everything else is copied through. A file with no more than one line on each side of the markers comes back wholly LF; with more, the endings between those lines stay CRLF and the file is mixed | R |
| `injectAgentsSlashSection` (`packages/minspec/src/lib/slash-commands.ts:324-345`), `injectContext` (`packages/minspec/src/lib/context-injector.ts:57-75`), `mergeDrIndex` (`packages/minspec/src/lib/adr-manager.ts:1017-1042`), `mergeEpicIndex` (`packages/minspec/src/lib/epic-manager.ts:624-637`), `appendToParkingLotFile` (`packages/minspec/src/lib/parking-lot.ts:190-217`) | Each inserts, appends or joins with LF and leaves the rest as found, so the file ends with mixed endings | R for the first three, C for the last two |
| `removeContext` (`packages/minspec/src/lib/context-injector.ts:81-98`) | Its blank-line clean-up (`:93-94`) does not match CRLF, so the file is left with blank lines the LF copy does not have; its endings stay CRLF | R |

### Readers that survive CRLF today, and what they do with a lone CR or a leading mark

Measured at this commit, which does not hold the #2404 fix. "Same" means the result equals
the LF result. Mixed CRLF and LF endings gave the LF result in every row.

| Reader | CRLF | Lone CR | Leading U+FEFF | |
|---|---|---|---|---|
| `parseSpec` (`packages/minspec/src/lib/spec.ts:276`), and what reads a spec through it: the spec list, and `validateSpec` (`packages/minspec/src/lib/spec-validator.ts:912`) | same | same | the id reads as empty | R |
| `specHash` (`packages/shared/src/canonical.ts:91`) | same | same | a different hash | R |
| `frontmatterBlock` (`packages/minspec/src/lib/artifact-graph.ts:105-108`) | same | same | no block is found | C |
| The recorded project name (`packages/minspec/src/lib/template-engine.ts:58`, `:66-70`) | same | same | not found, so the directory name is used | R |
| `fileEntryExists` (`packages/minspec/src/lib/parking-lot.ts:97-110`) | same | same | a heading on the first line is not found | R |
| The spec id sniff behind `nextSpecId` (`packages/minspec/src/lib/spec-manager.ts:92`, `:178-179`) | same | same | same | R |
| `detectEpicStub` through `extractSection` (`packages/minspec/src/lib/epic-manager.ts:553-560`) | same | same | same | R |
| `extractReferences` (`packages/minspec/src/lib/reference-checker.ts:117-123`) | same | the artifact's own `epic:` is reported as a reference | same | R |
| `isPristineDesignStub` (`packages/minspec/src/lib/auto-bootstrap.ts:454-477`) | same | a pristine stub is not recognised | same | R |
| The constitution nudge's rescan (`packages/minspec/src/lib/constitution-nudge.ts:95-126`) | same | a human list item is not seen | same | R |
| `splitManagedRegion` (`packages/minspec/src/lib/merge-refresh.ts:1509-1524`) | same | the region is not found | same | R |
| `inspectStatusLine`, the `## Status` form (`packages/minspec/src/lib/status-parity.ts:146-172`) | same | the status is not seen | same | R |
| `parsePrefixTable` (`packages/shared/src/project-prefix.ts:108`), which nothing in either tree calls | same | no rows are read | same | R |

Also holding for CRLF:

- The editor-document readers work on the text the editor hands them, by line or with the
  multiline flag (`packages/minspec/src/views/frontmatter-completion.ts:80-91`,
  `packages/minspec/src/views/codelens-provider.ts:136`,
  `packages/minspec/src/lib/diagnostics.ts:53-62`). **(C)**
- JSON state is read with `JSON.parse`, which accepts either ending: a CRLF
  `.minspec/config.json` loads the same settings as its LF copy **(R)**. It does not accept
  a leading byte order mark, which is outside this spec (Out of Scope; #2474, the issue
  for a byte order mark in `.minspec/config.json`).
- The shipped Python validator reads in text mode, which turns CRLF into LF before its
  pattern runs (`packages/minspec/src/lib/template-registry.ts:1710`, `:2015`, and for the
  staged blob `:1780-1784`). In both modes it exits 0 on a CRLF spec and exits 1 when the
  `id:` line is removed from it, so the pass is not a silent one **(R)**. It rejects a
  marked spec, which is outside this spec (Out of Scope; #2477, the issue for the two
  Python readers that are blind to the mark).
- Two sites that share the fence pattern are harmless.
  `packages/minspec/src/lib/spec-validator.ts:411` reads text `parseSpec` already
  normalized **(R)**, and `packages/minspec/src/lib/spec-manager.ts:330` runs only on a
  file MinSpec wrote with LF a few statements earlier (`:406-413`) **(C)**.

### The approval hash does not differ between a CRLF and an LF checkout

- `canonicalizeSpec` normalizes line endings before anything else
  (`packages/shared/src/canonical.ts:91`) and so does its Python twin
  (`scripts/hooks/canonical.py:59`). SPEC-022 (the approval foundation) requires it
  (`specs/minspec/SPEC-022-approval-foundation/requirements.md:131-132`, `:241-243`).
- Measured **(R)**: a spec approved while LF still reads `approved` after the same file is
  rewritten CRLF. `specHash` is equal for the LF, CRLF, mixed and lone-CR copies.
  `scripts/hooks/canonical.py --hash` on the CRLF file prints the digest the TypeScript
  function returns. A CRLF blob committed with `core.autocrlf=false` hashes the same as its
  LF content.
- The spec gate reads through Python text mode, so a file whose first bytes are `---`,
  carriage return, line feed arrives as `---` and a line feed, and its head pattern matches
  (`scripts/hooks/spec-gate.py:516-522`). **(R, with a probe that repeats those lines.)**
- Already pinned: `packages/minspec/tests/canonical.test.ts:76-89`, the `crlf.input` and
  `crlf.expected` golden pair in `packages/minspec/tests/fixtures/canonical/` that both
  twins assert, `scripts/hooks/test_canonical.py:76-78`, and the corpus parity test
  (`packages/minspec/tests/canonical-parity.test.ts:73-82`).
- Two writers change the hash by what they write, on an LF file today: `setArtifactEpic`
  adds an `epic:` line, and `setSpecStatus` rewrites a body `**Status:**` word **(R)**.
  Both throw on a CRLF file today, so there they change nothing.

So an approval is not valid on one machine and stale on another because of line endings.
The twins do disagree on four trailing code points, which is #1668 (the canonicalizer
divergence issue); its own measurement lists CRLF and lone CR among the inputs that agree.

### What git does with each way of writing a file back

Measured with git 2.43.0 on Linux. The change in each case is one line of a 49-line file.
**(R)**

| Repository | MinSpec rewrites the file LF | MinSpec keeps CRLF |
|---|---|---|
| `core.autocrlf=true`: LF blob, CRLF working tree | `git diff --stat` shows 1 insertion and 1 deletion. `git add` prints "LF will be replaced by CRLF the next time Git touches it". With `core.safecrlf=true` it fails: "fatal: LF would be replaced by CRLF" | 1 insertion and 1 deletion, no warning, no failure |
| `core.autocrlf=false`: CRLF blob | 49 insertions and 49 deletions | 1 insertion and 1 deletion |

A file left with mixed endings behaves like the LF rewrite in the first row: the warning by
default and the refusal under `core.safecrlf=true`. So does a new LF file, which is what
every file MinSpec creates is. Git reads a CRLF `.gitattributes` and a CRLF `.gitignore`
correctly (`git check-attr` and `git check-ignore` both resolve), so keeping those two
files CRLF does not break the pin. Under a `text eol=lf` pin, `git add` stores a CRLF
working file as LF and leaves the working copy CRLF until the next checkout. A hook whose
lines end CRLF does not start: exit 127, `/usr/bin/env: 'sh\r': No such file or
directory`. **(R)**

### The gate that should have caught it

None. Every CI job runs on Linux (#2405, the Windows CI job proposal), no test feeds CRLF
to a writer, and the one earlier fix (#153, the bug-hunt list whose CRLF item is the
`parseSpec` change at `packages/minspec/src/lib/spec.ts:270-276`) repaired the reader a
user had tripped over and left the same pattern in the writers further down the file.

### Where this differs from the issue

- The issue's line numbers are from `f124c74a`. The same sites are cited here at `5fc471cd`.
- The issue lists regenerating `docs/decisions/INDEX.md` among the things that work with
  CRLF. Measured here it does not when the decision records themselves are CRLF: every
  entry is rewritten `proposed` with a file-name title.
- The issue calls Accept Decision an ordinary act that reports success. Read from the
  code, the path first shows a modal saying the record "predates MinSpec and has no
  frontmatter block", with one button, **Add Frontmatter**
  (`packages/minspec/src/commands/adr.ts:210-219`); the damage is done when that button is
  pressed. The modal's statement is false for a CRLF record, and the tree and the signpost
  are what lead there: every decision shows the inline Accept
  (`packages/minspec/src/views/adr-tree-provider.ts:79`). **(C)**
- The issue's Refresh figures are one line higher throughout (`CLAUDE.md` 420 to 837, here
  419 to 836). That looks like a difference in how lines are counted, not in behaviour
  (inferred, unverified).
- The issue leaves five sites "not traced to a user-visible failure". Three are in the
  tables above (`packages/minspec/src/lib/epic-backfill.ts:185`, `:244` and
  `packages/minspec/src/lib/scaffold.ts:117`); the other two are the harmless pair under
  "Also holding for CRLF".

### The byte order mark and #2404

- #2404 (a UTF-8 byte order mark makes a spec invisible and changes its approval hash) has
  a finished fix that is not on `main`: commit `814ce538`, which exists only locally and
  as a patch at the time of writing. It removes one leading U+FEFF immediately before the
  line-ending normalization in `parseSpec`, `canonicalizeSpec`, `getSpecBodyOnly` and the
  Python twin, regenerates the embedded copy of the twin
  (`packages/minspec/src/lib/ci-review-templates.ts:3273`), and adds a `bom.input` and
  `bom.expected` golden pair beside the CRLF pair. **(Read from the patch.)**
- With that patch applied to a throwaway copy of `ff968418` **(R)**: a spec that starts
  with the mark parses and hashes like the bare one. Every other reader and writer tried
  still fails on a file that starts with the mark, the way it fails on CRLF:
  `setSpecStatus` and `advanceSpecToImplementing` throw, `listAdrs` and `listEpics` read
  `proposed`, `setEpicStatus` throws, and `setAdrStatus` puts a second block in front and
  leaves the mark stranded behind it.
- The commit's message calls the writers a gap "suited to a shared read helper". FR-1 is
  that helper. So this spec does not specify the mark's removal from the canonical form
  or from `parseSpec`, which is the commit's, and it does specify that every other reader
  and writer gets the same treatment through the one helper (DQ-8).
- Two places the commit and this spec both leave alone were measured and filed: the
  shipped Python validator rejects a marked spec and this repository's spec gate skips
  one (#2477), and `JSON.parse` rejects a marked `.minspec/config.json` (#2474).

## Functional Requirements

**A document**, in what follows, is a file MinSpec parses or edits as text: a spec, a
decision record, an epic, an INDEX file, a harness file (`CLAUDE.md`, `AGENTS.md`,
`.cursorrules`, `DESIGN.md`, the constitution, the labels file), the parking lot, a
managed hook, script, workflow or slash-command shim, `.gitignore` and `.gitattributes`.
JSON, source code handed to an analyzer, bytes that are compared or copied, and the output
of a child process are not documents; FR-10 says how each is classed.

The Context tables are the instances found so far; FR-10's inventory is the complete list.

- **FR-1 - One place where text from disk is prepared for parsing, and put back.**
  `packages/minspec/src/lib/text-io.ts` MUST own three steps, and be the only place in
  `packages/minspec/src` that performs them. Preparing: remove one leading U+FEFF, then
  turn every CRLF and every lone CR into LF, which is the rule the approval hash uses
  (`packages/shared/src/canonical.ts:91`). Detecting: the line ending of a text (FR-4) and
  whether it began with the mark. Restoring: give each line of LF text the ending FR-4
  assigns it, line by line, and put the mark back. The mark step is the one the #2404
  commit performs in `parseSpec`; it moves here unchanged, in Slice 2 (DQ-8). The
  normalizers the extension carries today (`packages/minspec/src/lib/spec.ts:276`,
  `packages/minspec/src/lib/artifact-graph.ts:106` and `:162`, and the either-ending
  patterns at `packages/minspec/src/lib/auto-bootstrap.ts:468-477`) MUST call the module in
  place of their own copy, so that there is one rule. Today `parseSpec` misses the mark
  until the #2404 commit, `frontmatterBlock` misses it after that commit too, and
  `isPristineDesignStub` misses a lone CR (Context). The canonicalizer in
  `packages/shared/src/canonical.ts` keeps its own lines and is not edited by this spec
  (FR-8).

- **FR-2 - Readers: text is prepared where it is read.** Every read of a document from
  disk MUST hand on prepared text: it goes through the module, or the text is handed whole
  to a parser that prepares it (`parseSpec`) or to the canonicalizer. Everything
  downstream then sees LF text with no mark, so every function that is given a path
  returns for a CRLF file what it returns for the LF equivalent, with text taken from the
  file compared after line endings are normalized. The same holds for mixed CRLF and LF
  endings, for a lone CR, and, from Slice 2, for a file that begins with U+FEFF. A file a
  reader rejects in LF is rejected in each of those forms for the same reason. The
  functions the Context tables name that are given the text and not a path MUST also
  prepare it at their own entry, so that each row holds for the function itself: this
  repository's commit gate hands four of them text it read itself
  (`scripts/validate-frontmatter.ts:429`, `:481`, `:495`, `:506`). A function outside
  those tables that is given text relies on the read that feeds it. What is not bound:
  - the text of an open editor document that is read in place, by line or with the
    multiline flag, because positions in it have to stay the editor's (Context). Editor
    text that is handed to `parseSpec` is prepared there;
  - `parsePrefixTable`, which nothing in either tree calls. It is left as it is so that
    the shared package is not edited (INV-1);
  - text that is not a document.

- **FR-3 - Writers: a file with one line ending comes back in it.** For every function
  that writes a document it read, and for the functions the Context tables name that take
  a document's text and return that document's text: when every line of the input ends
  CRLF, the output MUST be exactly the CRLF form of the output for the LF equivalent, byte
  for byte, and the same for a lone CR. A file that began with U+FEFF still begins with
  it, and a writer never adds one (DQ-3). FR-5 names the writes this does not cover. It
  follows that nothing is appended or prepended that the LF run does not add, that a
  writer which succeeds on LF succeeds on CRLF, and that a file with one line ending has
  one afterwards.

- **FR-4 - A file with more than one line ending.** A file's line ending is whichever of
  CRLF, LF and lone CR ends most of its lines; a tie, or no terminator at all, is LF. In
  what a writer produces, a line whose text also stands in the input keeps the ending it
  had there, and every other line takes the file's ending. Where the same text stands
  more than once, its occurrences are paired in order. This is one rule for every writer,
  and it is the helper's restoring step (FR-1): a writer never converts a line it did not
  change, and on a file with one ending the rule is FR-3. FR-5 names the writes it does
  not cover (DQ-2).

- **FR-5 - Which writes are LF.** (a) A file MinSpec creates is written LF, whatever it
  was generated from. The one exception is a layout migration
  (`packages/minspec/src/lib/spec-manager.ts:639-697`), which replaces a spec with files
  that hold the same text: those are written in that spec's ending. (b) A JSON file
  MinSpec re-serializes is written LF, as today: its own state under `.minspec/`
  (`packages/minspec/src/lib/approval-store.ts:160-164`,
  `packages/minspec/src/lib/config.ts:238-249`), and `.claude/settings.json` when it
  merges its hook registration into it
  (`packages/minspec/src/lib/claude-settings.ts:161-177`), which is the user's file and is
  reformatted whole on an LF copy too (measured: 4 lines become 22 in either ending).
  `JSON.parse` reads either ending, so nothing misparses; what an LF rewrite costs on a
  CRLF checkout is #2466 (the issue for LF files MinSpec writes). (c) A managed file that
  MinSpec's own `.gitattributes` block pins to LF
  (`packages/minspec/src/lib/scaffold.ts:337-343`) is written LF throughout, the lines
  outside its markers included. Which files are written this way MUST agree with the pin:
  a test asserts, with `git check-attr` on a scaffolded project, that they are exactly the
  managed files git reports as `eol: lf`. How the set is held is Plan's to choose; INV-4
  rules out a git call or a new dependency to compute it at run time, so that test is what
  keeps it in step with the pin. FR-2 applies to reading all of these (DQ-4).

- **FR-6 - A writer never mistakes "could not read the frontmatter" for "has no
  frontmatter".** `setAdrStatus` MUST decide by the record's first non-blank line, with a
  leading U+FEFF ignored. If that line is not `---`, the record has no frontmatter and a
  block is synthesized, which is what the branch's comment says it is for
  (`packages/minspec/src/lib/adr-manager.ts:597-600`). If that line is `---` and no block
  can be parsed, it MUST throw, name the file, and write nothing; today it synthesizes
  whenever the pattern does not match (`:711-717`). The two commands that set a decision's
  status, Accept and Set Decision Status, share one path
  (`packages/minspec/src/commands/adr.ts:200`); it MUST NOT then say the record predates
  MinSpec or offer to add frontmatter (`:210-219`). Measured on LF files today: a blank
  line before the block, or a missing closing fence, takes the synthesize branch and gets
  a second block (DQ-5). **(R)**

- **FR-7 - Section hashes do not depend on line endings.** `hashSection` MUST return, for
  any body, the hash of that body's LF form, and the manifest record and its self-check
  (`packages/minspec/src/lib/scaffold.ts:1382-1386`) MUST use the same value. What this
  does to manifests that already exist: an entry recorded from LF bytes, which is every
  entry Initialize writes and every entry a Refresh on LF files writes, has exactly the
  value the new rule computes and stays valid. An entry recorded from bytes that held
  carriage returns stops matching; only a Refresh that ran on a CRLF or mixed file under
  today's code can have written one. A mismatch never licenses replacing authored content
  that differs from the template's (`packages/minspec/src/lib/merge-refresh.ts:951-979`),
  so the worst outcome is a withheld template update. The manifest is machine-local and
  gitignored (`packages/minspec/src/lib/scaffold.ts:288`), so no two machines compare one.
  The template baseline is hashed from templates held in memory
  (`packages/minspec/src/lib/template-registry.ts:849-862`) and is unaffected.

- **FR-8 - This spec does not change what the approval hash covers.** Apart from the #2404
  commit that Slice 2 starts from, the implementing change MUST NOT touch
  `packages/shared/src/canonical.ts`, `scripts/hooks/canonical.py` or the embedded copy in
  `packages/minspec/src/lib/ci-review-templates.ts`. Preparing text for parsing, and
  restoring a file's line endings or mark, cannot make an approval stale or valid: the
  canonical form is built after line endings are normalized, and after the mark is removed
  once the #2404 commit is in. One thing does reach existing approvals, and it is not a
  change to what the hash covers: a write whose content stales an approval on an LF file
  does the same on a CRLF file once the writer stops throwing there. Assigning an epic,
  and rewriting a body status word, both do that on LF today (Context). The #2404 commit
  changes the canonical form for one input, a leading U+FEFF. That change and its effect
  on existing approvals are #2404's to state; its source comment says no approved spec
  carries the mark, and checked here no tracked file under `specs/`, `docs/` or
  `.minspec/` in this repository begins with one or contains a carriage return.

- **FR-9 - One behaviour test over a table of input variants.**
  `packages/minspec/tests/text-round-trip.test.ts` MUST run every function in one list
  against every row of one table of variants, on a project built with the real generators
  and on hand-written fixtures where a generated file does not reach the path.
  - **The list** holds every function the Context tables name, apart from
    `parsePrefixTable`, and, for every document read FR-10 lists, a function that reaches
    it. A function that is not exported is reached through the exported one that calls
    it.
  - **The variants** are named ways of writing the same content to disk: CRLF, lone CR,
    mixed CRLF and LF, and a leading byte order mark with LF and with CRLF. The table is
    the single extension point, so a reader or writer that is blind to a variant fails by
    name. The two mark rows arrive with Slice 2 (DQ-8).
  - **What is asserted is computed from the LF run and from the kind of file written
    (FR-5), never written out per function.** A reader's result equals its LF result. For
    a variant with one ending, each document a writer leaves, or the text it returns, is
    the LF run's converted to that ending, with the mark where it was (FR-3); a new file, a
    re-serialized JSON file and a pinned file equal the LF run's file, and a migrated
    spec's files are in the spec's ending (FR-5). For the mixed variant a writer does not
    throw where the LF run does not; its output equals the LF output once endings are
    normalized; every line whose text stands exactly once in the input and once in the
    output keeps its ending; and every line whose text is not in the input ends in the
    file's ending (FR-4).
  - **Named cases** cover the rest: FR-6 on LF and CRLF input; FR-7 with a manifest
    recorded on the LF copy and honoured on the CRLF copy; FR-8, by asserting that LF and
    CRLF forms hash equally in both twins for every spec in `specs/`; a pinned hook with
    user lines on both sides of its region; a migrated CRLF spec; and one end-to-end case
    that commits a generated project, sets `core.autocrlf=true`, checks the files out
    again, runs the writers, and asserts that `git diff --stat` shows only the intended
    lines and that `git add` prints no line-ending warning for a document a writer
    modified. The files FR-5 keeps LF are outside that last assertion; what git says about
    them is #2466.
  - **No row may pass by finding nothing.** Each row carries a control showing that its LF
    result depends on what was parsed: it differs from the result on a fixture with that
    content removed, and a writer's LF run changes the file. Each pairing of a function
    and a variant that the Context shows going wrong today MUST be shown red on the
    pre-change code, pair by pair; a test that is red as a whole is not enough.
  - **A case that cannot run fails.** A case that needs `git` or `python3` MUST fail,
    naming the tool, when the tool is missing; an early return that leaves it green, the
    shape at `packages/minspec/tests/gitattributes.test.ts:213`, is not acceptable, and
    neither is a skip.

- **FR-10 - One inventory test over every place text enters or leaves.**
  `packages/minspec/tests/text-io-inventory.test.ts` MUST scan every source file under
  `packages/minspec/src`, with the exclusions the existing source-scan invariants use
  (`packages/minspec/tests/invariants.test.ts:93-108`), and under `packages/shared/src`,
  and hold one declared inventory with two pins.
  1. **Every read of a file or of an editor document's text, and every file write,** by
     whatever name it goes: the asynchronous form
     (`packages/minspec/src/lib/git-analyzer.ts:395`) and an injected one
     (`packages/minspec/src/commands/constitution.ts:72`, `:86`) count. A read is classed
     as a document read through the FR-1 module, naming the FR-9 row that reaches it; as
     a document handed whole to a parser that prepares it, or to the canonicalizer; as
     text handed whole to something that owns its own line handling (`JSON.parse`, the
     TypeScript compiler, and the tier analyzers' patterns, which carry no line anchor:
     `packages/minspec/src/lib/ast-analyzer.ts:40-42`), a class that is safe for line
     endings and not for a leading mark (#2474, the issue for a byte order mark in
     `.minspec/config.json`); as bytes that are compared or copied and never parsed; or as
     an editor document read in place, naming the test that proves it reads CRLF. A write
     is classed as a document restored through the module, a new file, re-serialized
     JSON, an LF-pinned file, or a byte copy.
  2. **Every place that names a carriage return, U+FEFF, `os.EOL` or `process.platform`,**
     so that a private normalizer or a platform branch cannot appear beside the module
     unnoticed (INV-5). Each entry says why it stays: the canonicalizer,
     `parsePrefixTable`, a child-process reader
     (`packages/minspec/src/commands/push-docs-lane.ts:121-122`), a pattern that only
     excludes the character (`packages/minspec/src/lib/command-references.ts:39`), a
     script embedded in a template (`packages/minspec/src/lib/template-registry.ts:1957`),
     and the two platform checks the Context names are the kinds that remain.

  The test MUST fail in both directions for each pin: a site the scan finds that the
  inventory does not list, including a new one in a file already listed, and an entry that
  no longer matches a site. Reads are the boundary on purpose. A document read has only
  two classes open to it, the module or a parser that goes through it, so a parser added
  later is handed prepared text whatever it assumes, and a new read that would hand it raw
  text fails here until it is classified. That is how a new parser that assumes LF and a
  new one that is blind to the mark are caught the same way. It is a text scan: it proves
  each site was classified, not that the classification is right, and it does not see a
  caller outside the two trees handing raw text to an exported function; its header MUST
  say both. FR-9 is what proves behaviour. The test MUST be shown to fail on the code
  before the slice that adds it.

- **FR-11 - Nothing else changes.** For an LF file with no leading mark, every function
  produces the bytes it produces today, with the one exception FR-6 names. Initialize
  writes no new `.gitattributes` entry (DQ-6), this change reads and writes no git
  configuration, no setting is added, and no command, view or message changes other than
  what the two status commands show for a record FR-6 refuses.

## Acceptance Criteria

- [ ] **AC-1.** One module holds the prepare, detect and restore steps, and no other file
      in `packages/minspec/src` names a carriage return, U+FEFF, `os.EOL` or
      `process.platform` outside the sites the inventory lists. (FR-1, FR-10)
- [ ] **AC-2.** On a CRLF copy of a generated project the decision list, the epic list and
      the signpost read the same as on the LF copy, and a register in which every decision
      is accepted shows nothing pending. (FR-2)
- [ ] **AC-3.** The status parity check, the amendment check and the INDEX drift check
      return the same findings for CRLF as for LF, whether they are handed a path or the
      text. (FR-2)
- [ ] **AC-4.** A `tasks.md` scaffolded from a CRLF `requirements.md` carries the real id
      and inherited fields, and a pristine legacy shim is removed on CRLF as on LF. (FR-2)
- [ ] **AC-5.** Every reader in the table of readers that survive CRLF today returns its LF
      result for a lone-CR file, and for a marked file once the #2404 commit is in;
      `parsePrefixTable` is the one named exception. (FR-2)
- [ ] **AC-6.** Accept Decision on a CRLF record leaves one frontmatter block and one
      `status:` line, and the file equals the CRLF form of the LF result. (FR-3)
- [ ] **AC-7.** Refresh Harness Files on a CRLF copy of a settled project changes no byte
      of the five harness documents: the same line and heading counts, CRLF throughout,
      and no duplicate heading in the constitution. (FR-2, FR-3, FR-7)
- [ ] **AC-8.** Approve Spec on a CRLF spec in status `new` or `specifying` succeeds, and
      the approval reads `approved` on an LF copy and on a CRLF copy of the file. (FR-3,
      FR-8)
- [ ] **AC-9.** Accept Epic, epic reorder and Backfill Epics behave on CRLF as on LF, and
      Backfill creates no epic that nothing joins. (FR-2, FR-3)
- [ ] **AC-10.** After a writer runs on a document with one line ending, the document still
      has that one ending; on a `core.autocrlf=true` checkout `git diff --stat` shows only
      the intended lines and `git add` prints no line-ending warning for it. (FR-3)
- [ ] **AC-11.** A writer that finds a leading U+FEFF leaves it in place, and no writer
      adds one. (FR-3)
- [ ] **AC-12.** On a document with mixed endings, a line whose text a write leaves
      unchanged keeps its ending, a line the write adds or changes ends in the majority
      ending, and a tie is LF. (FR-4)
- [ ] **AC-13.** A file MinSpec creates is LF; a spec migrated to another layout keeps the
      ending it had; re-serialized JSON is LF; and a pinned file comes back LF throughout,
      so a CRLF hook with user lines on both sides of its region runs after one Refresh.
      The files written that way are exactly the managed files git reports as `eol: lf`.
      (FR-5)
- [ ] **AC-14.** `setAdrStatus` on a record whose first non-blank line is `---` and that
      has no readable block throws and leaves the file unchanged; Accept and Set Decision
      Status then show that error and no offer to add frontmatter; a record that does not
      open with `---` still gets a block after the existing prompt. (FR-6)
- [ ] **AC-15.** A manifest recorded on the LF copy of a project is honoured on its CRLF
      copy: no section is held and none is replaced that the LF run does not replace.
      (FR-7)
- [ ] **AC-16.** Apart from the #2404 commit Slice 2 starts from, the implementing change
      touches none of the three hash files, and `canonical.test.ts`,
      `canonical-parity.test.ts` and `test_canonical.py` pass unmodified by it. (FR-8)
- [ ] **AC-17.** `text-round-trip.test.ts` runs every listed function against every
      variant; every row has its control; every pairing the Context shows going wrong is
      shown red on the pre-change code; and a case whose tool is missing fails. (FR-9)
- [ ] **AC-18.** `text-io-inventory.test.ts` is shown to fail on the code before it.
      Afterwards it fails when a file read, an editor-document read or a file write is
      added anywhere in the two source trees without an entry, when a carriage return,
      U+FEFF, `os.EOL` or `process.platform` is named outside the listed sites, and when
      an entry no longer matches a site. (FR-10)
- [ ] **AC-19.** For LF input with no leading mark, the existing suites pass unmodified
      except where they pin the synthesize branch for a record with an unreadable block,
      and the change adds no `.gitattributes` entry and no setting. (FR-11)

## Delivery slices

One spec and one approval, and the tier stays what the whole change makes it. The build
lands in two slices. **The preview release waits on Slice 1 only.**

**Slice 1 - a default Git for Windows checkout works.** The target is a project checked
out with `core.autocrlf=true`, where every file has one line ending (Context). After it,
none of the 31 rows in the Context can be reached on such a checkout, apart from the
pinned files FR-5 writes LF on purpose, and no MinSpec write leaves a document with two
endings, so the checkout stays in the state the slice covers.

- *Requirements:* FR-1 without its mark step, and with the normalizers in the five DQ-10
  files left where they are until Slice 2; FR-2 and FR-3 for the reads and the functions
  behind the four tables of what goes wrong; FR-4; FR-5; FR-7; FR-8; FR-11.
- *Acceptance criteria:* AC-2, AC-3, AC-4, AC-6 to AC-10, AC-12, AC-13, AC-15, AC-16 and
  AC-19, and the CRLF and mixed rows of AC-17.
- *Tests:* `text-round-trip.test.ts` with the CRLF and mixed rows for every function in
  those four tables, each row with its control and shown red first; the three symptom
  cases; the named cases for FR-5, FR-7 and FR-8; and the end-to-end
  `core.autocrlf=true` case.
- *Files:* the helper, that test, and the `affects:` files that hold a reader or a writer
  in those four tables.
- *It does not depend on the #2404 commit.* The mark step joins the helper in Slice 2.

**Slice 2 - the property is pinned.** FR-10's inventory test; the lone-CR rows and the two
mark rows of FR-9 for every listed function; the mark step of FR-1, which starts from the
#2404 commit (DQ-8); the reads of the five files DQ-10 adds; and FR-6. AC-1, AC-5, AC-11,
AC-14, AC-18 and the rest of AC-17.

**Considered for Slice 1 and not adopted: an LF pin on the documents, plus normalizing on
read.** The cheapest candidate is to extend the pin #2398 added
(`packages/minspec/src/lib/scaffold.ts:337-343`) to the documents MinSpec manages, so that
git checks them out LF, and to normalize in the readers for whatever is CRLF anyway.
Measured with git 2.43.0 **(R)**:

- It covers a file git checks out after the pin exists: under `core.autocrlf=true` such a
  file is LF in the working tree.
- It does not cover a checkout that predates the pin. The pin's writer leaves files on
  disk alone on purpose (`:350-353`), and they stay CRLF until git next checks them out.
  It does not cover a file created or saved CRLF outside git. So the readers have to be
  fixed either way, and with them fixed the pin adds nothing to correctness.
- Under the pin, `git add` of a CRLF document warns "CRLF will be replaced by LF", and
  with `core.safecrlf=true` it is refused ("fatal: CRLF would be replaced by LF"). The
  refusal changes sides; it does not go away.
- The pin's entries are a fixed list and the three document directories are configurable
  (`packages/minspec/src/lib/config.ts:45-47`), so the entries would have to be generated
  for each project.
- What it does to the user's own files: it sets a line-ending policy for documents the
  project's authors write, their `CLAUDE.md` and `AGENTS.md` included. In a repository
  whose blobs are CRLF, every pinned file shows as modified the moment the pin is added,
  with nothing else touched (two files, 7 insertions and 7 deletions), and stays so until
  someone commits the conversion.
- It saves little. With the documents LF by policy, a writer that splices or appends
  still has to bring the whole file to one ending, which is the work FR-3 asks for.

That candidate is DQ-6 Option B joined to DQ-1 Option B. Slice 1 takes its reader half,
and FR-3 in place of the pin.

## Invariants (must not break)

- **INV-1 - The approval hash is not this spec's to change (SPEC-022, the approval
  foundation; DR-034, approval ground truth).** No requirement here alters the canonical
  form, and how this spec reads or writes line endings and the mark makes no approval
  stale or valid. `packages/shared/src` is not modified by this spec's own changes.
- **INV-2 - No silent gate (constitution invariant 2, DR-066).** For the documents this
  spec covers, no reader's answer changes because of a line ending or a leading mark, and
  no check MinSpec runs stops finding things for that reason. A test that cannot run
  fails. What a list shows for a block that cannot be parsed for any other reason is
  #2468 (the issue for lists that read an unparseable block as none).
- **INV-3 - Blast radius (constitution invariant 3, DR-074).** On a document it edits, a
  MinSpec write changes only the lines it means to change: it does not convert the others
  or remove a byte order mark. It writes no line-ending policy for the documents a
  project authors and touches no git configuration. FR-5 names the writes that are LF.
- **INV-4 - Offline core (constitution invariant 1).** No network call, no new child
  process outside tests, and no new dependency.
- **INV-5 - No platform branch (constitution goal G-6).** Behaviour depends on the bytes of
  the file and never on `process.platform` or `os.EOL`, so the same input gives the same
  output on every machine and the property is testable on the Linux CI that exists.
  FR-10's second pin holds it.
- **INV-6 - What MinSpec did not change, it does not convert.** A line whose text a write
  leaves unchanged keeps its bytes, in every document. That keeps the promises already in
  the code: what is outside a marker block is preserved (DR-011, marker-bounded updates;
  the managed-region merge at `packages/minspec/src/lib/merge-refresh.ts:1473-1481`), and
  a section MinSpec kept is emitted as it was read (`:285-292`). The one exception is a
  managed file that MinSpec's own pin declares LF (FR-5, DQ-4).
- **INV-7 - Library boundaries.** The helper is plain library code with no `vscode`
  import, so the pinned list of `lib/` files that import `vscode` stays as it is
  (`packages/minspec/tests/import-boundaries.test.ts:60-73`).

## Clarify selections (recorded by an agent 2026-10-02; ratified only by approval of this spec)

Each decision carries a recommendation and its cost. The requirements above assume the
recommended option in every case.

DQ-1 to DQ-10 each carry a **Recorded selection** line naming the option this document
already recommended. An agent session wrote those lines on 2026-10-02, and no human chose
them. This repository runs with `"autonomy": "act"` (`.minspec/config.json:58`), under which
an agent proceeds on a stated recommendation and leaves the options it did not take on
record (DR-086, the autonomy decision record, §2 and §4), which is why the options stay
below with their costs. Approving a T4 spec is the second class on that record's stop list
(`scripts/lib/autonomy.ts:68-70`), so nothing here stands in for that approval: the lines
propose, and approving this spec is what ratifies them. An approval records a canonical
hash that covers this body (`packages/minspec/src/lib/approval.ts:4-8`) and reads as stale
once the hash stops matching (`resolveStatus`, `:483-490`), so an approval of this text
covers these selections and changing one afterwards voids it. When the lines were written
no approval of this spec had landed on `main` (`status: specifying`, `clarify: pending`). A
question in this section with no **Recorded selection** line is still open.

### DQ-1 - What does MinSpec do with a file's line endings, reading and writing back?

**Recorded selection: Option A,** normalize on read and write the file back in its own line
ending.

None of the three options changes the approval hash: the canonical form is built after
line endings are normalized, in both twins, and that was measured for LF, CRLF, mixed and
lone-CR copies (Context). They differ in what git and a reviewer see.

- **Option A - normalize on read, write back in the file's own line ending (rec).** FR-1
  to FR-4. A write changes only the lines it means to change in every git configuration
  measured: one line in the diff and no warning for the document. *Cost:* every writer
  has to carry what it read to its write so the endings can be put back, which is one
  more thing a new writer can forget and the reason FR-10 pins writes as well as reads; a
  file with mixed endings needs a rule of its own (DQ-2); and the files MinSpec creates are still LF
  (DQ-4), so on a `core.autocrlf=true` checkout with `core.safecrlf=true` an approval's
  commit is still refused, on its new approval record (#2466, the issue for LF files
  MinSpec writes; inferred from the measured `git add`, unverified end to end).
- **Option B - normalize on read, always write LF.** What `writeSpec` does today
  (`packages/minspec/src/lib/spec.ts:454`), and the least code. *Cost:* in a repository
  whose blobs are CRLF the first write turns a one-line change into a whole-file diff
  (measured: 49 insertions and 49 deletions), which is the camouflage the harness merge was
  rewritten to avoid (`packages/minspec/src/lib/merge-refresh.ts:288-292`); and on a
  `core.autocrlf=true` checkout every `git add` of a document MinSpec touched prints a
  line-ending warning and is refused under `core.safecrlf=true`, for every document and
  not only for new files.
- **Option C - no normalization; make each pattern and split accept a carriage return.**
  The shape of the earlier fix (#153, the bug-hunt list). *Cost:* every site in the Context
  tables needs its own change, the next parser is one more place to forget, which is how
  the writers were left broken beside a fixed reader, and a tolerant pattern still leaves
  every writer putting LF text into CRLF files.

### DQ-2 - Which ending is a file's own, and what happens to a file with mixed endings

**Recorded selection: Option A,** a line MinSpec does not change keeps its ending, and
what it writes takes the majority ending.

- **Option A - the majority of CRLF, LF and lone CR is the file's ending; a line whose
  text a write leaves unchanged keeps the ending it had, and every other line takes the
  file's (rec).** FR-4. One rule for every writer, held in the helper, and it keeps the
  promises the code already makes about text MinSpec did not write (INV-6). A file
  today's writers have left mixed is not unified by it: of the files today's Refresh
  doubles, a `CLAUDE.md` holds 419 CRLF lines and 417 LF and an `AGENTS.md` 76 and 93
  (measured), so what MinSpec writes next is CRLF in the first and LF in the second, and
  the lines it leaves alone stay as they are. *Cost:* a file that is mixed stays mixed, so
  git goes on warning about it and refuses it under `core.safecrlf=true` until someone
  fixes those lines; where MinSpec's own earlier LF text outnumbers the user's CRLF lines
  the majority is LF on a CRLF checkout; the helper has to keep every line's ending and
  not only the file's; and lines with the same text, blank lines above all, are paired by
  order, so which of two identical lines keeps which terminator is the helper's choice.
- **Option B - every writer rewrites the whole file in its majority ending.** The least
  code, and a mixed file comes out with one ending. *Cost:* a write would change the
  terminators of lines it did not change: outside a marker block, and inside a section
  MinSpec kept, which the code says it never does
  (`packages/minspec/src/lib/merge-refresh.ts:1473-1481`, `:285-292`).
- **Option C - the first line's ending decides.** *Cost:* one stray first line flips the
  choice, and the damaged decision record measured above has exactly that shape, an LF
  block in front of a CRLF body.

### DQ-3 - A leading byte order mark when a file is written back

**Recorded selection: Option A,** the mark is kept.

The helper removes a leading U+FEFF before parsing (FR-1), so a writer either puts it back
or loses it. This question is about writers only. What the canonical hash and `parseSpec`
do with the mark belongs to #2404 (the byte order mark issue) and its finished commit.

- **Option A - keep it: a file that started with the mark still starts with it (rec).**
  FR-3. The same rule as DQ-1, a write changes only what it means to. *Cost:* the mark
  stays in the file, so every reader outside the helper goes on meeting it. Two were
  measured: the shipped Python validator rejects a marked spec with "missing or invalid
  `id: SPEC-NNN`", so its commit is refused, and this repository's spec gate skips a
  marked spec and so freezes nothing for it (#2477, the issue for those two readers).
- **Option B - drop it on the first write.** A marked file MinSpec writes once would pass
  those two readers afterwards. *Cost:* MinSpec edits three bytes nobody asked it to
  touch; a marked file MinSpec never writes is still rejected, so #2477 is needed either
  way; and removing the mark can change how the author's own tools read the file (Windows
  PowerShell 5.1 reads a file with no mark in the system code page; taken from its
  documentation, unverified here).

### DQ-4 - Files MinSpec creates, and executed files it pins to LF

**Recorded selection: Option A,** new files are LF, a migrated spec keeps its ending, and
a pinned executed file is written LF throughout.

- **Option A - a new file is LF; the files a layout migration writes take the spec's
  ending; a managed file that MinSpec's own `.gitattributes` block pins is written LF
  throughout (rec).** FR-5. LF is what git stores, it keeps the output independent of the
  machine, and it is the choice #2398 (the line-ending pin, closed) made for those files.
  Writing a pinned file LF throughout is what lets a hook run again after one Refresh:
  today a CRLF hook with one user line before its region keeps a carriage return on its
  first line and does not start (measured: exit 127). It goes one step past #2398, which
  left bytes already on disk alone (`packages/minspec/src/lib/scaffold.ts:350-353`).
  *Cost:* in a pinned file MinSpec removes the carriage returns of user lines it did not
  otherwise change, which is the one exception to INV-6 (git does the same at the next
  checkout under the pin, measured); and on a CRLF checkout a newly created spec or
  decision record is LF until git next checks it out, so `git add` prints one warning for
  it and refuses it under `core.safecrlf=true` (#2466, the issue for LF files MinSpec
  writes).
- **Option B - new files take the platform's ending (`os.EOL`).** *Cost:* the first
  platform branch in code that has none, different bytes on different machines for the
  same input (constitution goal G-6, `.minspec/constitution.md:53-54`), and CRLF blobs in
  any repository that does not normalize on commit.
- **Option C - in a pinned file, leave the lines outside the markers as found, as today.**
  No line MinSpec did not change is converted anywhere. *Cost:* the hook above stays
  unrunnable until it is checked out again under the pin, and one file is written by two
  rules at once.

### DQ-5 - A decision record whose frontmatter is there but cannot be read

**Recorded selection: Option A,** refuse and write nothing.

- **Option A - refuse: `setAdrStatus` throws and writes nothing, and the Accept path does
  not offer to add frontmatter (rec).** FR-6. Synthesizing a block is for a hand-written
  record that has none (#201, the fix that added the branch). A second block in front of
  an existing one destroys the record's own status, and it happens today on LF files with
  a blank first line or an unclosed block as well as on CRLF. *Cost:* such a record cannot
  have its status changed from MinSpec until a human repairs the block, and a hand-written
  record that happens to open with a `---` rule is refused where today it is given
  frontmatter. What the lists show for a block that is still unreadable is unchanged and
  is #2468 (the issue for lists that read an unparseable block as none).
- **Option B - keep synthesizing, and rely on FR-2 to make CRLF records parse.** *Cost:*
  the mechanism stays, so the next input the pattern cannot read is given a second block
  with no warning.

### DQ-6 - Should Initialize also pin the generated Markdown to LF?

**Recorded selection: Option A,** no pin for documents.

- **Option A - no; MinSpec reads and writes either ending and writes no line-ending policy
  for the documents a project authors (rec).** FR-11. *Cost:* CRLF stays in Windows working
  trees for good, so the property has to be held by tests for as long as the code lives
  (FR-9, FR-10) and is never made moot by git.
- **Option B - extend the pin to specs, decisions, epics and the harness Markdown, as this
  repository does for its own `specs/**`.** *Cost:* an entry only changes files git checks
  out after it exists; it does nothing for a file created or saved CRLF in the editor
  before git touches it (that the editor does so by default on Windows is general
  knowledge about the product, unverified here); it sets a convention for files the
  project's own authors edit; and the parsers still have to be fixed for every project
  that does not carry it.

### DQ-7 - How is the property kept true after this change?

**Recorded selection: Option A,** the variant behaviour test and the inventory test
together.

- **Option A - one behaviour test over a table of input variants, and one inventory test
  over every place text enters or leaves (rec).** FR-9, FR-10. Text is prepared where it
  is read, so the inventory pins reads and writes: a document read cannot be added
  without going through the helper, whatever parser sits behind it, and a new variant is
  one row applied to every listed function. *Cost:* the inventory is a text scan, so it
  proves each site was classified and not that the classification is right; it does not
  see a caller outside the two trees handing raw text to an exported function; it holds
  about 150 entries at this commit (the reads and writes counted in the Context); and
  every new file read or write in the extension needs an entry from now on.
- **Option B - regression tests for the three symptoms in the issue title.** *Cost:* this
  is how the earlier fix left the writers broken: one reader was pinned and nothing
  stopped the next one.
- **Option C - a Windows CI job instead (#2405, the Windows CI job proposal).** *Cost:* it
  needs a workflow change only a human can push, it starts red, and it finds a line-ending
  defect only where an existing test happens to read a checked-out file. It complements
  Option A and does not replace it.

### DQ-8 - Sequencing against the finished fix for #2404

**Recorded selection: Option A,** build the mark's slice on that commit and consume it.
Option B is not taken, so the mark's removal from the canonical form is not specified
here.

The fix is commit `814ce538` and is not on `main` (Context).

- **Option A - start the slice that brings the mark into the helper from that commit, and
  move its leading-mark step into the helper unchanged (rec).** One seam for both kinds of
  input, and one inventory that guards it. Slice 1, which the preview waits on, does not
  depend on that commit (Delivery slices). If the commit has not merged when Slice 2
  starts, Plan adopts it as that slice's base and does not write a second strip. *Cost:*
  that slice carries another change that has to pass review with it or before it, both
  touch the same line (`packages/minspec/src/lib/spec.ts:276`), a diff of the combined
  work against `main` includes that commit's edits to the three hash files, which FR-8
  excludes by name, and until that commit lands the two mark rows of FR-9 cannot pass.
- **Option B - specify the mark's removal here as well.** *Cost:* a second implementation
  of a finished fix, and a change to what the approval hash covers made under a spec about
  line endings.
- **Option C - leave the mark out and guard line endings only.** *Cost:* the helper would
  exist and the readers the commit did not reach would stay blind to the mark beside it,
  with a second test needed later for the same seam.

### DQ-9 - Files already damaged by today's behaviour

**Recorded selection: Option A,** no detection or repair in this change. Detection is
#2467 (the issue for a record with two blocks or a harness file with doubled sections).

- **Option A - do not detect or repair here (rec).** No project is known to hold such a
  file: the listing is flagged unpublished, its earlier versions report one install, and
  the release record still speaks of the first session on the Windows machine the preview
  is for (`docs/decisions/DR-100.md:76-79`, `:122`). Whether an earlier published build
  damaged a file somewhere is unknown, unverified. *Cost:* a decision record that already
  has two blocks, or a harness file already doubled, stays that way until a human sees it
  in a diff.
- **Option B - add a validator warning for both shapes in this change.** *Cost:* a rule
  for a state that may not exist anywhere, added to a change that already touches
  twenty-six files.

### DQ-10 - Do the readers that already survive CRLF move behind the helper too?

**Recorded selection: Option A,** every document read goes through the helper, in the
second slice.

Of the readers that read a CRLF file correctly today, six misread a lone-CR file, and
three besides `parseSpec` and the hash misread a file that begins with the mark (Context).
None of them blocks a Windows checkout, which is what #2397 is about.

- **Option A - route every document read through the helper (rec).** FR-1, FR-2. One kind
  of document read, no exception in the tests beyond the one FR-2 names, and a marked
  decision record is read the same way by the lists and by the graph. *Cost:* five more
  source files change (`artifact-graph.ts`, `auto-bootstrap.ts`, `constitution-nudge.ts`,
  `reference-checker.ts`, `template-engine.ts`), each is frozen with the rest if this
  spec's approval goes stale during its build, and readers that are not broken on a
  Windows checkout are touched by the same spec as the ones that are.
- **Option B - change only what goes wrong on CRLF, and pin the rest by name.** The
  smallest change. *Cost:* those readers stay blind, so a marked decision record is read
  correctly by the lists and wrongly by the graph; FR-2 would hold for CRLF and mixed
  endings only; FR-10 would carry a named list of raw reads that may only shrink; and an
  issue would be needed to empty it.

## Why no new DR

Nothing here is hard to reverse. The line-ending policy lives in one helper, moving it
between Options A and B of DQ-1 is a change to that helper, and a file written under either
is read correctly under the other. No stored format changes: the approval hash is untouched
(FR-8) and the section hash returns today's value for every LF body (FR-7). The tier is T4
by size, not because an architectural commitment is being made. A decision record would be
needed only if a later change wanted line endings to enter what the approval hash covers,
which no option here does.

## Out of Scope

- **The byte-order-mark fix itself.** What the canonical hash, `parseSpec`, the Python
  twin and the embedded copy do with a leading U+FEFF, and the `bom.*` golden pair, are
  #2404 (the byte order mark issue) and its commit `814ce538`. This spec's second slice
  starts from that commit (DQ-8).
- **A byte order mark in the Python hooks.** The shipped validator rejects a marked spec
  with a message about its id, and this repository's spec gate skips one **(R)**. Neither
  is in the two source trees' TypeScript; that is #2477 (the issue for those two readers).
- **A byte order mark in JSON state.** `JSON.parse` rejects a leading U+FEFF, so a
  `.minspec/config.json` saved with one loads as the defaults, and the coverage prompt
  then rewrites the file with only its own key **(R)**. JSON is parsed whole, not as
  lines, so it is outside this spec's seam; that is #2474 (the issue for a byte order mark
  in `.minspec/config.json`).
- **A Windows CI job.** #2405 (the Windows CI job proposal).
- **The pin for hooks and scripts, and the `python3` placeholder.** #2398 (the line-ending
  pin, closed) and #2400 (the `python3` placeholder issue), each its own work.
- **This repository's own dev-time scripts.** `scripts/validate-frontmatter.ts:71` and two
  helpers carry the same fence pattern, and with CRLF epic files the epic gate is skipped.
  That is #2465 (the issue for the repository's own validator); the four library
  functions it calls are in the Context tables and are fixed here by FR-2.
- **Functions the two trees export only for scripts.** `validateStatusClaims`
  (`packages/minspec/src/lib/spec-validator.ts:1475`) and `scanTestSource`
  (`packages/minspec/src/lib/test-scanner.ts:504`) have no caller in either tree. Handed
  raw text, both give the LF answer for CRLF and a different one for a lone CR **(R)**.
  What a script hands them is the script's to prepare; the second reads test source,
  which is not a document.
- **LF files MinSpec writes on a CRLF checkout.** New files and re-serialized JSON stay LF
  (FR-5); what git does with them under `core.safecrlf=true` is #2466 (DQ-4).
- **Detecting or repairing files already damaged.** #2467 (DQ-9).
- **What the lists show for a frontmatter block that is still unreadable.** #2468 (DQ-5).
- **Tidy Primary's comparison with the origin blob.** `classifyPrimary` compares raw
  working-tree bytes with the blob (`packages/minspec/src/lib/tidy-primary.ts:258-264`),
  so on a `core.autocrlf=true` checkout a file whose content matches origin is classed as
  an orphan where the LF checkout classes it as redundant **(R)**. It fails toward keeping
  the file. It compares any file, binary included, so the fix is to ask git and not to
  normalize text. That is #2472 (the issue for that comparison); FR-10 lists the read as
  bytes.
- **Text that comes from a child process.** `git` output is split on `\n` at
  `packages/minspec/src/lib/git-remotes.ts:65`, `packages/minspec/src/lib/presence.ts:344`,
  `packages/minspec/src/lib/git-analyzer.ts:200`,
  `packages/minspec/src/lib/approval.ts:240` and
  `packages/minspec/src/lib/fix-feat-tripwire.ts:96`. The first three trim or test a
  prefix and are indifferent to a carriage return; the last two would carry one into a
  commit id or a path if git ever wrote CRLF to a pipe, which it is not known to do,
  unverified on Windows. One sibling already strips it
  (`packages/minspec/src/commands/push-docs-lane.ts:121-122`). **(C)**
- **`parsePrefixTable`.** Nothing in either tree calls it
  (`packages/shared/src/project-prefix.ts:108`). It reads CRLF and a marked file correctly
  and reads no rows from a lone-CR file **(R)**; changing it means editing the shared
  package, which this spec leaves alone.
- **An open editor document.** Whether the editor can hand MinSpec text that still holds a
  lone CR or the mark is not known (unverified); those readers are pinned for CRLF only.
- **Other line separators.** U+2028, U+2029 and U+0085 are not line endings here.
- **How faithfully `writeSpec` re-serializes.** It rebuilds frontmatter and section order
  by design; this spec changes only the line endings it writes.

## Alternatives considered and rejected

Recorded because this spec was written without a live conversation (DR-086, the autonomy
decision record, section 4).

- **Fixing the three symptoms in the title.** Rejected: the Context holds 31 rows of
  readers and writers that go wrong on CRLF, and the three are not the worst of them.
  The signpost naming an accepted decision as the next task, and the constitution gaining
  duplicate sections, are not in the title.
- **Converting a project's files to LF on Initialize or Refresh.** Rejected: it rewrites
  every line of files the user did not ask MinSpec to touch, and git converts them back at
  the next checkout.
- **Normalizing inside each parser and leaving the writers alone.** Rejected: readers
  would agree and every writer would still splice LF into CRLF files.
- **Putting the helper in `@aiclarity/shared`.** Rejected: no parser in that package needs
  it (of its two readers of file content, the canonicalizer normalizes and
  `parsePrefixTable` has no caller), and keeping the package untouched is what lets FR-8
  be checked by looking at the diff.
- **Making every exported function that takes text prepare it itself.** Rejected: there
  are well over a hundred of them, almost all are only ever handed text a read has
  already prepared, and binding the reads binds them all at once. The functions in the
  Context tables do prepare at their own entry, because a script outside the two trees
  calls four of them with text it read itself.
- **Pinning every split on a line feed in the inventory.** Rejected: once text is prepared
  where it is read, a split on a line feed is correct, and a pin on about a hundred of
  them would guard nothing the pin on reads does not.
- **Claiming the twenty-three source files under `implements:`.** Rejected: a defect spec
  should not become the owner of modules it did not specify. The helper and the two tests
  are what it creates.
- **Asserting the property with unit tests of the patterns.** Rejected: the failures are
  in what each caller does when a pattern does not match, so the tests run the callers on
  generated files.

## Test plan (for the Plan phase to place)

- **T0, before each slice's implementation:** the rows and cases that slice brings, shown
  red on the code before it: `text-round-trip.test.ts` (FR-9) from Slice 1, and
  `text-io-inventory.test.ts` (FR-10) in Slice 2. The scratch measurements behind the
  Context tables are the first draft of the variant table and the function list.
- **T3, one per symptom in the issue:** Accept Decision, Refresh Harness Files and Approve
  Spec on a CRLF copy, as named cases inside FR-9's test, so a regression names the
  symptom.
- **T1, in the same file as FR-9's test:** the helper's three steps, including the tie,
  the file with no terminator, the lone CR, a mark followed by each ending, and the
  line-by-line restore on a mixed file with repeated lines.
- **Existing tests that stay green unmodified:** `canonical.test.ts`,
  `canonical-parity.test.ts`, `test_canonical.py`, `spec.test.ts`, the merge-refresh
  suites and `gitattributes.test.ts`.
- **Existing tests that may change:** any that pin `setAdrStatus` synthesizing a block for
  a record that opens with `---` (FR-6).

## Traceability

- **Issue:** [#2397](https://github.com/AIClarityAU/minspec/issues/2397).
- **Depends on:** [#2404](https://github.com/AIClarityAU/minspec/issues/2404) (the byte
  order mark issue), through its finished commit `814ce538` (DQ-8).
- **Follow-ups filed from this spec:**
  [#2465](https://github.com/AIClarityAU/minspec/issues/2465) (the repository's own
  validator assumes LF), [#2466](https://github.com/AIClarityAU/minspec/issues/2466) (LF
  files MinSpec writes are refused under `core.safecrlf=true`),
  [#2467](https://github.com/AIClarityAU/minspec/issues/2467) (detecting files already
  damaged), [#2468](https://github.com/AIClarityAU/minspec/issues/2468) (lists that read an
  unparseable block as none), [#2472](https://github.com/AIClarityAU/minspec/issues/2472)
  (Tidy Primary compares raw bytes with the origin blob),
  [#2474](https://github.com/AIClarityAU/minspec/issues/2474) (a byte order mark in
  `.minspec/config.json` reverts every setting to its default),
  [#2477](https://github.com/AIClarityAU/minspec/issues/2477) (the shipped Python validator
  and the spec gate are blind to a byte order mark).
- **Adjacent, not absorbed:** [#2398](https://github.com/AIClarityAU/minspec/issues/2398)
  (the line-ending pin, closed), [#2405](https://github.com/AIClarityAU/minspec/issues/2405)
  (a Windows CI job), [#1668](https://github.com/AIClarityAU/minspec/issues/1668) (the
  canonicalizer divergence on four code points),
  [#153](https://github.com/AIClarityAU/minspec/issues/153) (the bug-hunt list whose CRLF
  item fixed `parseSpec` alone).
- **Governing specs and decisions:**
  [SPEC-022](../SPEC-022-approval-foundation/requirements.md) (the canonical hash, whose
  FR-3 already requires line-ending independence),
  [SPEC-043](../SPEC-043-harness-refresh-manifest-consistency/requirements.md) (the harness
  manifest FR-7 keeps consistent), [DR-034](../../../docs/decisions/DR-034.md) (approval
  ground truth), [DR-011](../../../docs/decisions/DR-011.md) (marker-bounded updates),
  [DR-037](../../../docs/decisions/DR-037.md) (the git hooks record the managed-region
  merge cites), [DR-003](../../../docs/decisions/DR-003.md) (root cause before fix, and the
  gate that should have rejected the state),
  [DR-066](../../../docs/decisions/DR-066.md) (no silent gate),
  [DR-074](../../../docs/decisions/DR-074.md) (blast radius).
- **Context for urgency:** the proposed preview-release decision record
  (`docs/decisions/DR-100.md:122`).
- **DR for this spec:** none, by design; see "Why no new DR".
