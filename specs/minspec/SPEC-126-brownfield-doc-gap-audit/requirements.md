---
id: SPEC-126
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology - Initialize, the frontmatter contracts and the approval gate live here; this extends Initialize to a project that already has documents
aspects: [init, onboarding, brownfield, audit, approval, tier-0, consent, filesystem]
relates_to: [DR-033, DR-034, DR-056, DR-074, DR-029, DR-012, SPEC-022, SPEC-096, SPEC-038, "#205", "#107", "#96", "#94", "#131", "#147", "#163", "#156", "#114", "#137", "#95", "#116"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3). All nine
# files are NEW. They hold under every answer in "Decisions needed (Clarify)": the scan, the
# remediation planner, the flagged-baseline writer, the command, and the tests that pin them.
implements: [packages/minspec/src/lib/doc-audit.ts, packages/minspec/src/lib/doc-remediation.ts, packages/minspec/src/lib/baseline-approval.ts, packages/minspec/src/commands/audit-docs.ts, packages/minspec/tests/doc-audit.test.ts, packages/minspec/tests/doc-remediation.test.ts, packages/minspec/tests/baseline-approval.test.ts, packages/minspec/tests/audit-docs-command.test.ts, packages/minspec/tests/init-greenfield-unchanged.test.ts]
# Modified, not owned. init.ts gains one call after the scaffold; extension.ts and package.json
# register the command; config.ts gains the optional key DQ-4 names; approval.ts exports what the
# flagged writer shares with approveSpec; adr-manager.ts is touched only under DQ-3 Option A; the
# last entry is SPEC-096's command inventory test, which every new command must be added to.
affects: [packages/minspec/src/commands/init.ts, packages/minspec/src/extension.ts, packages/minspec/package.json, packages/minspec/src/lib/config.ts, packages/minspec/src/lib/approval.ts, packages/minspec/src/lib/adr-manager.ts, packages/minspec/tests/commands-opt-in-invariant.test.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-126: Initialize audits the documents a project already has, offers fixes by consequence, and asks how to treat them for approval

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers the five questions under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the normal
> spec-approval gate before any code changes. Every requirement below is written under each
> question's recommended option, so approving the spec as it stands accepts those
> recommendations. Choosing a different option changes only the requirements that question
> names.

Materializes **[#205](https://github.com/AIClarityAU/minspec/issues/205)** - *"init-time
brownfield doc-gap audit + tiered fix + auto-approve-vs-review prompt."* The driver was a
project initialized on 2026-06-11 that carried a 41KB single-file decision log holding 14
decisions, date-suffixed documents at its root, no frontmatter and no `specs/` directory.
Initialize reported success and left every one of those documents outside MinSpec's
registers. (That description is the issue's; the project is not in this repository and was
not inspected for this spec.)

**Id note.** `SPEC-097` to `SPEC-125` each appear as a spec directory on at least one
branch visible from this worktree (local and remote-tracking refs, newest dated 2026-10-03;
`SPEC-097` alone is claimed by 21 different branches). `SPEC-126` is the first id no visible
ref uses. Open pull requests could not be listed from here (no network on this dispatch), so
if the id collides at review time, renumber.

**Tier note.** T4 (complete ceremony). The change adds a command, two library modules and a
second writer of approval records, and it touches the approval boundary that DR-034
(committed, attributed approval ground truth) governs. The predicted tier is an upward-only
floor.

## One-Sentence Scope

When a project that already has Markdown documents is initialized (or audited later by
command), MinSpec reports which of them fall short of its conventions in five named ways,
offers each fix at a level of ceremony that matches what the fix can break, and asks once
whether the imported documents are to be reviewed one at a time or recorded as an
already-acted-on baseline, recording the answer and who gave it.

## Context - what the code does today (read at commit `350c6fa4`)

Every `file:line` below was read at that commit and is written as a repository-relative
path.

### Initialize looks at nothing the project already has

- `initCommand` (`packages/minspec/src/commands/init.ts:1230`) calls `scaffold(folder)` and
  `generateHarnessFiles(folder)`, shows *"Initialized .minspec/ and generated harness
  files"*, then runs the coverage prompt and the GitHub pull-request advisory on first
  initialization only (`isFirstInit`, `:1243`, `:1276`), then the commit offer and the two
  ruleset advisories. No step reads an existing document.
- `scaffold()` creates `.minspec/` and calls `writeScaffoldDefaults` (`packages/minspec/src/lib/scaffold.ts:394-398`),
  which writes `config.json` when absent and the epic index. It does not create the specs
  directory or the decisions directory, and it lists no documents.
- The three document directories come from config: `specs`, `docs/decisions`, `docs/epics`
  by default (`packages/minspec/src/lib/config.ts:127-131`), each resolved inside the workspace root or refused
  (`resolveAndValidate`, `packages/minspec/src/lib/config.ts:201-208`).

### What MinSpec recognises as a document of each kind

- A decision is a file named `DR-<number>…​.md`, an epic `EPIC-<number>…​.md`, a spec a file
  named `requirements.md` or `spec.md` (`packages/minspec/src/lib/approvable.ts:25-27`, `:36-43`). Recognition is
  by filename alone.
- `listAdrs` reads only the configured decisions directory and only files matching that
  name (`packages/minspec/src/lib/adr-manager.ts:1363-1370`). A decision file with no frontmatter is listed with
  a made-up `proposed` status (`:1380-1396`). A single file holding many decisions matches
  nothing and is not listed.
- The next decision number is the highest number among files in that one directory plus one
  (`nextAdrNumber`, `packages/minspec/src/lib/adr-manager.ts:105-120`). Decisions held in a file elsewhere do not
  count, so the first decision created after initializing such a project is numbered 1 and
  duplicates a number the project already used.
- One place already replaces a missing or invalid tier with `T2` without saying so: the
  fallback inside `findSpecDirsMissingTasksMd` (`packages/minspec/src/lib/scaffold.ts`, the function ending at
  `:271`).

### The approval foundation the issue was waiting for exists

The issue says R3 (its third requirement, the review-or-baseline question) needs #95
(shared, attributed approvals) and #116 (deterministic status) first. Checked against code,
not against issue state:

- A spec approval is one committed file per spec under `.minspec/approvals/`, keyed by the
  spec's repository-relative path (`packages/minspec/src/lib/approval-store.ts:26`, `:80-83`, `:168-172`).
- The record carries `specPath`, `specHash`, `approvedAt`, `approvedBy`, `tier`, `migrated`
  and `baselineBlob` (`packages/minspec/src/lib/approval.ts:59-68`). `approvedBy` is `git config user.email`
  captured at approval time (`:357`).
- `approveSpec` refuses an agent or absent identity (`assertHumanApprover`,
  `packages/minspec/src/lib/approval.ts:478-481`, called at `:534`), refuses a folder that has not opted in
  (`assertOptedIn`), and always writes `migrated: false` (`:602`).
- `migrated: true` is defined as *"an approval the human never performed, flagged so the
  gate treats it valid-but-flagged"* (`packages/minspec/src/lib/approval.ts:44-47`). It resolves to `approved`
  when the hash matches (`resolveStatus`, `:489-496`).
- **Nothing the extension ships writes `migrated: true`, and nothing it ships shows it.**
  The two writers are dev-time scripts in this repository
  (`scripts/migrate-approvals.ts:286-304`, `scripts/reconcile-approver-identity.mjs:121`).
  The one reader that reports it is this repository's own hook
  (`scripts/hooks/spec-gate.py:580-582`, warning text at `:621`) and `npm run facts`
  (`scripts/facts.ts:458`). A search of `packages/minspec/src` for `migrated` finds only the
  store's shape check and the type (`packages/minspec/src/lib/approval-store.ts:106`, `:130`,
  `packages/minspec/src/lib/approval.ts:67`). A search of `packages/minspec/src/lib/template-registry.ts` for `spec-gate` finds
  nothing, so an adopter's project receives no surface for the flag.
- **Only specs have approval records.** `.minspec/approvals/` in this repository contains
  one subdirectory, `specs`. Accepting a decision is a rewrite of its `status:` frontmatter
  line (`acceptAdrCommand`, `packages/minspec/src/commands/adr.ts:278-291`; `setAdrStatus`,
  `packages/minspec/src/lib/adr-manager.ts:777`), with no hash and no approver recorded.

### What DR-034 already decided about approvals nobody performed

DR-034 (committed, attributed approval ground truth) section 5 handled this repository's own
unbacked specs by writing records marked `migrated: true`, *"honest about provenance (no
manufactured 'human approved at hash X' claim)"* (`docs/decisions/DR-034.md:173-178`). Its
rejected alternatives include *"Backfill the 7 unbacked specs as real approvals. Rejected:
manufactures human approvals that never happened"* (`:255-257`). The issue's "auto-approve
all" is the same act on an adopter's corpus, so that decision already governs it (DQ-1).

### One gate this repository has that adopters do not

This repository's own pre-commit hook refuses a newly added decision file whose status is
anything but `proposed` (`.githooks/pre-commit:5-16`, check at `:219`). A search of
`packages/minspec/src/lib/template-registry.ts` and `packages/minspec/src/lib/hook-templates.ts` for that gate finds nothing, so it is
not in the hook MinSpec generates for adopters. It still states the principle DQ-3 has to
square with: acceptance is a separate human act.

## Definitions

- **Existing document**: a Markdown file inside the workspace root that MinSpec did not
  write, selected by FR-2.
- **Kind**: `spec`, `decision`, `epic`, or `unknown`.
- **Gap**: one way one existing document falls short. Five classes, FR-3.
- **Fix level**: `safe`, `structural`, or `needs-human`, FR-5 to FR-9.
- **Individual review**: every imported document starts unapproved and is approved or
  accepted one at a time through the commands that exist today.
- **Flagged baseline**: imported documents are recorded as already acted on, each record
  marked as an import nobody reviewed inside MinSpec, attributed to the person who chose it.

## Functional Requirements

### The audit

**FR-1 - Where it runs.** The audit runs (a) inside **MinSpec: Initialize SDD Structure**,
after the scaffold and harness writes succeed and before the commit offer, and (b) from a new
palette command, **MinSpec: Audit Existing Documents**, on any initialized project. Both
call one library function. The command exists because the driver project was already
initialized when the gap was found, and Initialize alone would never reach it again.
- FR-1a. The command refuses in a folder without `.minspec/`, with the same message the
  other commands use (SPEC-096, only Initialize creates the opt-in marker). It creates no
  directory before that check.
- FR-1b. Inside Initialize the audit adds at most one non-modal notice, and only when it
  found something: the count of documents with gaps and an **Open report** action. It
  applies no fix and asks no question until the person opens the report.
- FR-1c. A failure anywhere in the audit never fails Initialize and never suppresses its
  success message. It is shown as its own warning naming what failed.

**FR-2 - Which files are examined.** The candidate set is every `.md` file inside the
workspace root that git tracks or that is untracked and not ignored. In a folder that is not
a git repository it is every `.md` file found by walking the root, skipping `node_modules`
and directories whose name starts with a dot.
- FR-2a. Never candidates: anything under `.minspec/`; every path MinSpec's templates
  write (the template registry's output paths); `README`, `CHANGELOG`, `LICENSE`,
  `CONTRIBUTING`, `CODE_OF_CONDUCT` and `SECURITY` files at any depth; each register's own
  `INDEX.md`; any path listed as set aside (FR-9d).
- FR-2b. A file that cannot be read is reported by path under its own heading in the
  report. It is never skipped without mention.
- FR-2c. The audit reads files and runs local `git` only. It makes no network call and
  starts no model (constitution invariant 1).

**FR-3 - Kind, then the five gap classes.** Each candidate is given a kind by fixed rules,
in this order: a frontmatter `id:` beginning `SPEC-`, `DR-` or `EPIC-`; then the filename
patterns the extension already uses (`packages/minspec/src/lib/approvable.ts:25-27`) plus `ADR-<number>`; then,
for decisions only, a file containing two or more headings that each name a numbered
decision (the single-file register); otherwise `unknown`. Then:

| Class | Applies to | A document has this gap when |
|---|---|---|
| **Misplaced** | spec, decision, epic | it is outside the directory config names for its kind |
| **Inconsistent naming** | spec, decision, epic | its filename does not follow the convention for its kind, or it is a single-file register holding several entries |
| **Missing frontmatter** | spec, decision, epic | it has no frontmatter block, or lacks a field the shipped validator requires for its kind |
| **Missing cross-check sections** | spec | a section rule of the shipped spec validator reports it (today `acceptance.missing`, `packages/minspec/src/lib/spec-validator.ts:687`, and the `aspect.*` rules) |
| **Unclassified complexity** | spec | it has no `tier:` or one outside T1 to T4 |

- FR-3a. **One definition of "required".** For the frontmatter and section classes the
  audit calls the same rule code the validator runs. It defines no field list or section
  list of its own. When #107 (canonical frontmatter schema), #131, #147 or #163 (the
  cross-check work) change those rules, the audit changes with them and needs no edit.
- FR-3b. A document of `unknown` kind has no gap class. It is listed once, under **Other
  Markdown**, with the needs-human action in FR-9d. Under DQ-5 Option A only `unknown`
  documents at the workspace root or under a top-level `docs/` directory are listed.
- FR-3c. A decision or spec whose body is still the unedited template MinSpec generates is
  reported as **Unfilled template** under needs-human (fill it or delete it).
- FR-3d. Kind and gap detection are pure functions of file path and file content. The same
  tree produces the same report, in the same order, on every run and every platform.

**FR-4 - The report.** The audit produces one read-only Markdown report opened in an editor
tab, grouped first by the five classes (plus **Other Markdown**, **Unfilled template** and
**Unreadable**), each entry naming the path, the gap, the proposed fix and its fix level.
- FR-4a. The report states its counts and what they were counted over: files examined,
  files with at least one gap, gaps per class.
- FR-4b. The report is not written into the workspace. Re-running the audit regenerates it.
- FR-4c. Zero findings produces no report and no notice inside Initialize. From the command
  it produces one line: nothing to fix, and how many files were examined.

### Fixes, by what they can break

DR-033 (auto-triage and auto-build) places the human gate by blast radius: reversible and
isolated changes proceed, irreversible or far-reaching ones wait for a person. FR-5 to FR-9
apply that to documents.

**FR-5 - Rules for every fix.**
- FR-5a. No fix overwrites an existing file. A target that exists makes the item
  needs-human.
- FR-5b. No fix deletes a file, except the explicit per-file removal in FR-8d.
- FR-5c. No fix writes body prose. Fixes move, rename, split along existing boundaries,
  add frontmatter fields whose value is already present in the document, and regenerate
  indexes.
- FR-5d. A file with uncommitted changes is not touched by a batch action. It is listed
  with that reason and can be fixed on its own after the person confirms.
- FR-5e. Every write resolves inside the workspace root through the existing check
  (`resolveAndValidate`) and creates directories only through the shared guard that cannot
  create `.minspec/` (SPEC-096 FR-4).
- FR-5f. After any fix is applied the audit re-runs and the report shows the new state. A
  fix that did not close its gap is reported as not closed, never as applied.

**FR-6 - Safe fixes: one action applies them all.** A fix is `safe` only when all of these
hold: no file content changes other than relative links (FR-6b), no identifier is chosen,
the target path is free, and the folder is a git repository. The safe fixes are:
1. create a register directory config names and the project lacks;
2. move a document whose filename already follows the convention into its kind's directory;
3. rename a document to the convention when its number is already unambiguous in its own
   frontmatter or filename (for example `adr-7-foo.md` to `DR-007-foo.md`);
4. regenerate a register index after the above (`regenerateDrIndex`,
   `packages/minspec/src/lib/adr-manager.ts:1134`, and the epic index).

- FR-6a. **Apply safe fixes** applies every safe item in one action and reports how many
  were applied and how many were held back, with reasons.
- FR-6b. A move or rename rewrites the relative Markdown links it would otherwise break:
  those inside the moved file and those in other candidate files that point at it. The
  number of links rewritten is reported.
- FR-6c. **Demotion.** A move or rename is `structural`, not `safe`, when the old path
  appears as text in any tracked file that is not Markdown (a script, a workflow, a site
  configuration). The audit cannot know what that reference does.
- FR-6d. In a folder that is not a git repository there is no single undo, so no batch
  action is offered and every fix is confirmed per item.
- FR-6e. With commit-on-approve enabled, applied safe fixes are committed as one commit of
  their own, by pathspec, containing only paths the fixes touched.

**FR-7 - Structural fixes: shown before they happen.** A `structural` fix is applied one
item at a time, after the person has seen a preview of exactly which files it creates and
changes. There is no action that applies all structural fixes.

**FR-8 - Splitting a single-file register.**
- FR-8a. The split creates one decision file per entry in the decisions directory and
  regenerates the index. The original file is not modified and not removed.
- FR-8b. An entry keeps the number it has in the original. An entry whose number is
  missing, repeated, or already used by a file in the decisions directory is not split; it
  becomes a needs-human item (FR-9a). The rest of the register is still split.
- FR-8c. **Verification is computed.** After the split, every line of the original belongs
  either to exactly one created file or to a list the report shows as "not part of any
  entry" (a preamble, a table of contents). The split is verified when that accounting is
  complete and each created file's body equals its entry in the original. An unverified
  split is reported as such and FR-8d is not offered.
- FR-8d. Only after verification does the report offer **Remove original** for that one
  file, as its own structural action. Until then, and for as long as the original remains,
  later audits report it as "split, original kept" and do not report it as a new register.
- FR-8e. The status each created decision file carries is set by FR-12.
- FR-8f. A file that starts with frontmatter and is given frontmatter by the split is
  never left with two frontmatter blocks (the defect class `detectDoubledFrontmatter`,
  `packages/minspec/src/lib/adr-manager.ts:511`, exists to find).

**FR-9 - Needs-human items: never applied by the tool.** These are listed with an action
that takes the person to the document or asks them one question. No batch action includes
them, and no setting changes that.
- FR-9a. **Numbers.** Assigning a `SPEC-` or `DR-` number where the document does not
  already carry an unambiguous one. The picker shows the next free number as information and
  the person confirms or types another.
- FR-9b. **Tier.** Choosing T1 to T4 for a spec. No option is preselected and no tier is
  inferred from the document. (An assisted suggestion is #114's subject, not this spec's.)
- FR-9c. **Cross-check sections.** The action opens the document. MinSpec inserts neither
  the section nor a placeholder for it: the person verifies these, so a generated one would
  be the thing the check exists to prevent.
- FR-9d. **Other Markdown.** For each listed document the person chooses: it is a spec, it
  is a decision, or set it aside. Set-aside paths are stored in committed config
  (`docAudit.setAside`) and are not reported again.
- FR-9e. **Unfilled templates.** Fill or delete, by hand.

### How imported documents are treated for approval

**FR-10 - The question.** When the report contains at least one document eligible for the
flagged baseline (FR-11b, FR-12b), it carries one question, asked in the report and not as a
modal dialog: *review each imported document individually*, or *record them as an
already-acted-on baseline*.
- FR-10a. Individual review is the default. Dismissing, closing the report or doing
  nothing is individual review, and writes no approval of any kind.
- FR-10b. The baseline is chosen by an explicit action that lists every document it will
  cover, by path, with the count. Any listed document can be excluded before confirming.
  The confirm control is not the default button and is not reachable by pressing Enter on
  the notice.
- FR-10c. The baseline is refused, before anything is written, when the captured identity
  is absent or is an agent identity. This is the existing check (`checkApprover`,
  `packages/minspec/src/lib/approval.ts:447-472`), not a second list. DR-056 (approver identity must be
  agent-proof) applies unchanged.
- FR-10d. The question is not asked on a project with no eligible document, and is not
  asked again for documents an earlier answer already covered.
- FR-10e. The answer is recorded in committed config under `docAudit.baseline`: which
  option, by whom (`git config user.email`), when (UTC), and for the baseline the list of
  paths covered (DQ-4). An individual-review answer is recorded the same way so that a later
  reader can tell "chose to review" from "was never asked".

**FR-11 - What the baseline writes for a spec.**
- FR-11a. One approval record per covered spec through the existing store, identical to
  the record Approve Spec writes except `migrated: true`: canonical hash of the current
  content, `approvedBy` the confirming person, `approvedAt` now, `tier` the spec's tier
  (DQ-1).
- FR-11b. A spec is eligible only if Approve Spec would accept it today: it has an id and a
  valid tier, and passes the same completeness and ownership checks (DQ-2). An ineligible
  spec stays in individual review and the report says which check it failed.
- FR-11c. The baseline performs the same phase advance Approve Spec performs, so that the
  spec's recorded status and its derived status agree afterwards. No covered spec may fail
  the validator's `status.mirror-drift` rule as a result.
- FR-11d. A baseline record is never written over an existing record.
- FR-11e. **The flag is visible.** Wherever the extension shows a spec as approved, a
  spec whose record has `migrated: true` reads as *approved (imported baseline, not
  reviewed)*, with the action to approve it properly, which replaces the record with an
  ordinary one. Today nothing shipped shows the flag (Context), so without this requirement
  the baseline would be indistinguishable from a reviewed approval.

**FR-12 - What each option means for a decision.**
- FR-12a. Under individual review every imported decision file is created or left with
  `status: proposed`, whatever the source said. The source's own status wording stays in the
  body. Each is accepted through **MinSpec: Accept ADR**, one at a time.
- FR-12b. Under the baseline an imported decision carries the status its source states,
  mapped to MinSpec's four statuses, plus a frontmatter marker recording that the status was
  imported and from which file (DQ-3). A status that does not map cleanly is not guessed:
  the decision stays `proposed` and is listed under needs-human.
- FR-12c. A decision with the marker is shown as *imported, not reviewed* wherever the
  extension lists decision status. Accepting it through the command removes the marker.

### Unchanged behaviour

**FR-13 - A project with no existing documents.** When the candidate set (FR-2) is empty, or
no candidate has a gap and none is `unknown`, Initialize writes exactly the files it writes
today, shows exactly the messages it shows today, and adds no key to `config.json`.

**FR-14 - Re-running.** Running the audit twice with no change in between produces the same
report and writes nothing. Running it after all offered fixes are applied reports only
needs-human items.

## Contract (for the Plan phase to place; not code)

The audit and the fix planner are a library boundary with the command on one side and
tests on the other. The shapes below are the agreement; names may change in Plan, the
fields may not be dropped.

```ts
type DocKind = 'spec' | 'decision' | 'epic' | 'unknown';
type GapClass =
  | 'misplaced' | 'naming' | 'frontmatter' | 'cross-check-sections' | 'unclassified-tier';
type FixLevel = 'safe' | 'structural' | 'needs-human';

interface DocGap {
  readonly path: string;          // repository-relative, POSIX
  readonly kind: DocKind;
  readonly gapClass: GapClass;
  readonly detail: string;        // what is wrong, in words a person can act on
  readonly fix?: PlannedFix;      // absent when the only remedy is authoring
}

interface PlannedFix {
  readonly level: FixLevel;
  readonly demotedBecause?: string;        // FR-6c, FR-5a, FR-5d: why it is not `safe`
  readonly creates: readonly string[];     // paths
  readonly moves: readonly { from: string; to: string }[];
  readonly rewritesLinksIn: readonly string[];
}

interface AuditReport {
  readonly examined: number;               // FR-4a: what the counts are over
  readonly gaps: readonly DocGap[];
  readonly otherMarkdown: readonly string[];
  readonly unfilledTemplates: readonly string[];
  readonly unreadable: readonly string[];  // FR-2b: never dropped
  readonly baselineEligible: readonly string[];
}
```

`.minspec/config.json` gains one optional key. Absent means never asked and nothing set
aside; `loadConfig` already tolerates absent and unknown keys (`packages/minspec/src/lib/config.ts:179-193`).

```jsonc
"docAudit": {
  "setAside": ["notes/scratch.md"],
  "baseline": {
    "choice": "individual",                // or "flagged-baseline"
    "decidedBy": "person@example.com",
    "decidedAt": "2026-10-03T00:00:00Z",
    "covered": []                          // paths, flagged-baseline only
  }
}
```

## Acceptance Criteria

- **AC-1** (FR-1, FR-3, FR-4). On a fixture project holding a single-file register with
  several numbered decisions, two date-suffixed root documents, no frontmatter anywhere and
  no specs directory, Initialize completes with its usual message plus one notice, and the
  opened report groups every finding under the five classes with the counts FR-4a names.
- **AC-2** (FR-13). On an empty fixture, and on one holding only a `README.md`, the files
  and messages Initialize produces are identical with and without this change, and
  `config.json` has no `docAudit` key.
- **AC-3** (FR-6). **Apply safe fixes** moves and renames the eligible documents, rewrites
  the relative links that pointed at them, regenerates the index, changes no other byte of
  any document, and the re-run report lists none of those gaps.
- **AC-4** (FR-6c, FR-5a, FR-5d). A move whose old path appears in a tracked script, a
  move whose target exists, and a move of a file with uncommitted changes are each held back
  from the batch, each with its own stated reason.
- **AC-5** (FR-7, FR-8). Splitting the register creates one file per uniquely numbered
  entry, leaves the original byte-identical, reports verified only when every original line
  is accounted for, and offers **Remove original** only then. An entry with a repeated
  number is not split and appears under needs-human.
- **AC-6** (FR-9). No action, setting or sequence of actions assigns a number, sets a
  tier, inserts a section, or classifies an **Other Markdown** document without a per-item
  human choice. A test enumerates the batch actions and asserts none of them touches a
  needs-human item.
- **AC-7** (FR-10). With eligible documents present the question appears in the report;
  doing nothing writes no approval record and no status change. Individual review and
  baseline answers are both written to `docAudit.baseline` with identity and time.
- **AC-8** (FR-10c). With an agent identity or no identity configured, choosing the
  baseline is refused with the existing reason text and writes nothing: no record, no
  status, no config key.
- **AC-9** (FR-11). After a baseline, each covered spec has a record with `migrated: true`
  and the confirming identity, reads as *approved (imported baseline, not reviewed)* in
  the extension, and passes the validator with no `status.mirror-drift`. An ineligible spec
  has no record and the report names the failed check.
- **AC-10** (FR-12). Under individual review every created decision file has `status:
  proposed`. Under the baseline a decision whose source says accepted carries `accepted`
  plus the marker; one whose source status does not map stays `proposed` under needs-human.
- **AC-11** (FR-1a). The audit command run in a folder without `.minspec/` refuses and
  leaves the folder with no new file or directory.
- **AC-12** (FR-2c). The audit completes with the network unavailable and starts no
  process other than `git`.
- **AC-13** (FR-14, FR-3d). Two consecutive audits of an unchanged tree produce
  byte-identical reports and no write.

## Invariants (must not break)

- **INV-1 - Offline.** No network call and no model invocation anywhere in the audit, the
  fixes or the baseline (constitution invariant 1).
- **INV-2 - Nothing passes quietly.** An unreadable file, a failed fix, an unverified split
  and a failed audit are each shown. None is reported as success or dropped from the counts
  (constitution invariant 2).
- **INV-3 - Opted-in projects only.** The audit never creates `.minspec/`, never runs in a
  folder without it except as part of the Initialize that just created it, and never reads
  or writes outside the workspace root (constitution invariant 3; SPEC-096).
- **INV-4 - No approval a person did not perform is recorded as one.** Every record or
  status the baseline writes carries its import flag. No path in this change writes
  `migrated: false` (DR-034 section 5 and its rejected alternative).
- **INV-5 - An agent cannot baseline.** The baseline goes through the same identity check
  as Approve Spec, at the library boundary and not only in the command (DR-056).
- **INV-6 - No fix destroys or invents content.** No overwrite, no deletion outside
  FR-8d, no generated prose, no inferred number or tier.
- **INV-7 - One rule source.** The audit's idea of a required field or section is the
  validator's. A document the audit calls clean passes the validator for those rules, and
  the reverse.
- **INV-8 - No habit of approving in bulk.** Individual review is the default, silence is
  never consent, and the baseline's confirm is never the default control (constitution
  principle 2, *avoid UX patterns that train the user into rubber-stamping*).
- **INV-9 - Initialize on a project with no existing documents is unchanged** (FR-13).

## Decisions needed (Clarify)

Five questions. Each names the recommended option and what that option costs.

### DQ-1 - What does "auto-approve all" write for a spec?

The issue asks that the choice be "attributed + recorded in the approvals ground truth
(DR-034), not silent".

- **Option A (rec)** - a record with `migrated: true`, attributed to the person who chose
  the baseline. This is the mechanism DR-034 section 5 already decided for approvals nobody
  performed. **Cost:** DR-034 keeps its gate at warning strength until no `migrated` record
  remains, so an adopter who baselines carries that flag until each spec is properly
  approved; and FR-11e has to add the first shipped surface for the flag, which is extra
  work this option makes mandatory.
- **Option B** - an ordinary record, `migrated: false`. Simplest, and the spec then looks
  exactly like a reviewed one. It is the alternative DR-034 rejected by name, so choosing it
  needs a new decision record superseding that part of DR-034 before Plan.
- **Option C** - no baseline for specs at all; the question is asked for decisions only.
  Removes the tension for specs and leaves a person with many historical specs to approve
  each one.

Changes FR-11 and INV-4.

### DQ-2 - Must a spec pass Approve Spec's checks to be baselined?

- **Option A (rec)** - yes: id, valid tier, completeness and ownership checks, exactly as
  Approve Spec applies them. **Cost:** on a typical legacy corpus few or no specs will
  qualify on the first run, so the baseline will mostly cover decisions until the
  needs-human gaps are closed. A person may read that as the feature not working.
- **Option B** - the baseline skips the completeness check (the flag carries the caveat).
  More documents covered at once; an incomplete spec then counts as approved for every gate
  that reads approval status, which is the state the completeness check exists to prevent.

Changes FR-11b and AC-9.

### DQ-3 - What status does an imported decision carry under the baseline?

Decisions have no approval record today, only a `status:` line (Context).

- **Option A (rec)** - carry the status the source states, plus a frontmatter marker that
  it was imported and from where; shown as *imported, not reviewed* until accepted through
  the command. **Cost:** it adds a decision frontmatter key that the canonical-schema work
  (#107) must admit, and since nothing hashes a decision the marker can be deleted by a
  plain edit, so it informs and does not enforce.
- **Option B** - every imported decision is `proposed` under both answers, so the baseline
  does nothing for decisions. Fully consistent with "acceptance is a separate human act";
  the issue's own example (14 historical decisions already acted on) then gets no relief.
- **Option C** - wait for decisions to gain approval records (a spec for that is in flight
  on an unmerged branch) and write flagged records for them like specs. One mechanism for
  both kinds; this spec would then be blocked on work that has not been approved.

Changes FR-12, AC-10, and whether `adr-manager.ts` is touched.

### DQ-4 - Where is the answer itself recorded?

- **Option A (rec)** - `docAudit.baseline` in `.minspec/config.json`, which is already
  committed. **Cost:** the list of covered paths lives in a general config file that people
  edit by hand, and it goes stale when a covered file is later moved.
- **Option B** - a separate committed file under `.minspec/` for the import record. Keeps
  config small and gives a later gate one file to verify; it is a new committed format in
  every adopter's repository, which is hard to change after release and would need a
  decision record.
- **Option C** - the commit alone records it (author and message). No new key; but with
  commit-on-approve off nothing is recorded, and a later audit cannot tell an answered
  question from an unasked one, so it would ask again.

Changes FR-10e, FR-9d and the config contract.

### DQ-5 - How far does the audit look for documents of unknown kind?

- **Option A (rec)** - only at the workspace root and under a top-level `docs/` directory.
  **Cost:** a stray design note kept elsewhere (inside a package, say) is never reported,
  and the report does not say so per file, only as a total of unknown documents not listed.
- **Option B** - the whole repository. Nothing is missed; a repository with many package
  READMEs and vendored documentation produces a list long enough that people stop reading
  it.

Changes FR-3b only. Documents of a recognised kind are found anywhere under either option.

## Why no new DR

Under the recommended options nothing here is a choice that takes more than a day to undo.
The flagged record reuses a shape and a rule DR-034 already fixed; the config key is
optional and additive; the fixes are moves and splits a single revert undoes. Two answers
would need one before Plan: DQ-1 Option B (it reverses a DR-034 rejected alternative) and
DQ-4 Option B (a new committed format in adopters' repositories).
`docs/decisions/INDEX.md` was searched for an existing decision on brownfield import,
grandfathering and baselines (terms searched: brownfield, grandfather, baseline, import,
migrat); DR-034 section 5 is the only one that covers it.

## Out of Scope

- Any AI or model assistance: suggesting a tier, drafting sections, proposing how to split
  an unnumbered register. #114 (semantic difficulty signal) owns tier suggestion.
- Defining the canonical frontmatter schema or new cross-check section rules. #107, #96,
  #131, #147 and #163 own those; this spec consumes whatever rules ship (FR-3a).
- Approval records for decisions (see DQ-3 Option C).
- Showing the audit inside the onboarding walkthrough (#156).
- Non-Markdown documents, and documents outside the workspace root.
- Importing another tool's layout (Spec Kit, Kiro). The existing **Migrate Spec Layout**
  command (`packages/minspec/src/commands/migrate.ts`) converts between MinSpec's own two layouts and is not
  changed.
- Fixing the silent `T2` fallback in `findSpecDirsMissingTasksMd` (Context). It is the same
  defect class as #137 and deserves its own issue; none was filed by this dispatch, which
  has no network access.

## Alternatives considered and rejected

- **Apply the safe fixes automatically during Initialize.** Rejected: Initialize would
  move a project's files before the person had seen a list of them. FR-1b makes the report
  the first thing that happens.
- **A modal dialog for the review-or-baseline question.** Rejected: a modal over a hidden
  artifact asks for a decision about documents the person cannot see, which is the
  rubber-stamp pattern constitution principle 2 names.
- **Baseline as the default with review as the opt-in.** Rejected by the issue itself and
  by DR-034's evidence rule.
- **Insert empty section headings for missing cross-check sections.** Rejected: it converts
  a visible gap into an unfilled template, which FR-3c would then report.
- **Write the report into the workspace.** Rejected: a committed report goes stale the
  moment a fix is applied, and a stale report is a false signpost.
- **Ship the audit as a command only, leaving Initialize alone.** Rejected: the failure the
  issue reports is Initialize saying "Initialized" and nothing else on a project full of
  non-conforming documents.

## Test plan (for the Plan phase to place)

- Pure-function tests for kind and gap detection over fixture trees, including CRLF files
  and a register with a preamble, repeated numbers and an unnumbered entry.
- A property test for FR-8c: for generated registers, split then account for every line.
- The greenfield pin (AC-2) compares the full file listing and message sequence of
  Initialize with the audit present against a recorded baseline from before the change.
- The identity refusal (AC-8) is driven at the library function, not only the command.
- AC-6's enumeration test fails when a new batch action is added without being classified.
- Each test of a refusal carries a control that shows the same call succeeding when the
  refusal condition is absent, so a test cannot pass because nothing ran.

## Traceability

| Issue requirement | Requirements here |
|---|---|
| R1, gap scan at init, five classes | FR-1 to FR-4 |
| R2, safe fixes in one action | FR-5, FR-6 |
| R2, structural fixes reviewed, original kept | FR-7, FR-8 |
| R2, human-only fixes cannot be auto-applied | FR-9 |
| R3, ask; default individual; opt-in baseline; attributed and recorded | FR-10 to FR-12 |
| Greenfield unchanged | FR-13 |

Rests on: [DR-034](../../../docs/decisions/DR-034.md) (approval ground truth, section 5
flagged records), [DR-033](../../../docs/decisions/DR-033.md) (gate placed by blast
radius), [DR-056](../../../docs/decisions/DR-056.md) (agent-proof approver identity),
[DR-074](../../../docs/decisions/DR-074.md) (blast radius and the opt-in marker).
