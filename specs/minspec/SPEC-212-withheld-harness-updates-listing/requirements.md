---
id: SPEC-212
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a hold MinSpec keeps must stay discoverable, not be announced once and then go dark
aspects: [harness, refresh, merge, no-silent-gate, offline, tier-0, read-only]
depends_on: [DR-089]  # DR-089 (accepted) is the withheld-template-hash recording this listing reads
relates_to: [SPEC-043, SPEC-058, "#2037", "#2032", "#1697", "#1785", "#760"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3).
# Draft file names; the Plan may rename them, and must then update this line.
implements: [packages/minspec/src/lib/withheld-updates.ts, packages/minspec/src/commands/show-withheld.ts, packages/minspec/tests/withheld-updates.test.ts]
# Modified, not owned.
affects: [packages/minspec/src/lib/scaffold.ts, packages/minspec/src/lib/merge-refresh.ts, packages/minspec/src/extension.ts, packages/minspec/package.json]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-212 - List the harness updates MinSpec is withholding

Triggered by: [#2037](https://github.com/AIClarityAU/minspec/issues/2037) (split out of #2032,
the pinned `Pre-Commit Checks` section in scroogellm). Rests on
[DR-089](../../../docs/decisions/DR-089.md) (accepted): a held section records the hash of
the template body MinSpec declined to write.

**Scope (one sentence):** give a human a read-only, offline, on-demand way to ask "which
harness sections is MinSpec holding, and what is it withholding from each?", and stop the
one-time hold notice from claiming that no other way exists.

Tier T3 (full spec cycle): a new palette command, a new library module, and edits to the
notice text in `scaffold.ts` and a docstring in `merge-refresh.ts`. No change to what the
merge decides or records.

## Problem

A held harness section is announced exactly once and is invisible after that.

### Mechanism (root cause)

All line numbers below are as of `origin/main` `6df91ac4`.

1. **The report is tied to the missing baseline, not to the hold.** `mergeFile` reports a
   hold through `reportHold` (`packages/minspec/src/lib/merge-refresh.ts:779`). The INV-2
   guard branch calls it only when there is no baseline: `if (!oldHash) reportHold(...)`
   (`merge-refresh.ts:897`). The fail-closed branch fires only when there is no baseline
   (`merge-refresh.ts:985-1021`, which calls `reportHold` at `:1021`).
2. **The hold records a hash that can never match disk.** The same run records the hash
   of the template body it did not write into `withheldTemplateHashes`
   (`merge-refresh.ts:892`, `:1018`, `:1049`). DR-089 §1 makes this deliberate.
3. **So every later refresh takes the user-modified branch, which reports nothing.** On
   the next refresh `oldHash` exists and differs from disk. That sends the section to the
   `oldHash && existingHash !== oldHash` branch (`merge-refresh.ts:1022-1050`). That branch
   keeps the body and records the withheld hash again, but never calls `reportHold`. The
   hold carries on, and nothing reports it.
4. **The notice says this outright.** `preservedWithoutBaselineMessage`
   (`scaffold.ts:835`): *"This is the only notice you will get about it, and the hold
   STANDS"*.

**Missing gate:** there is no read surface. The product has no command, view or
diagnostic that lists held sections. Point 4 was an honest statement of that gap, not a
fix for it. Measured in #2037: scroogellm's `CLAUDE.md` kept shipping an inverted
sentence for weeks while every refresh declined to write the corrected paragraph, and no
part of the product could be asked about it.

### Two classes of hold, both silent after the first refresh

| Class | How it starts | Reported? |
|---|---|---|
| **A - no-baseline hold** | No proven baseline, and the template brings content the kept body lacks (#1697) | Once, by the notice. Never again. |
| **B - user-edit hold** | A proven baseline exists, the user edited the section, and the content differs from the template | **Never**, not even once. This is the classic "your edits are preserved" path. |

The two classes look the same in the persisted manifest: each records the withheld
template hash. From the next refresh on, each takes the same branch (point 3). This
spec lists both. See DQ-3.

### The design tension the issue names

`verifyGeneratedHashesConsistent` (`merge-refresh.ts:1522`) describes a non-empty result
as a manifest/disk **violation**. Its docstring (`merge-refresh.ts:1508-1517`) also
promotes it as *"an offline commit/CI-time check (#760)"* that *"CAN legitimately catch
drift"*. Since DR-089, that reading is false whenever the predicate runs over the
**persisted** manifest. A non-empty result there is the normal steady state of any
project with a hold. Measured in #2037 across four adopter projects: 1, 5, 1 and 0 such
entries.

**This spec settles the question (FR-6).** The predicate has two readings, and the
input map decides which one applies:

- **Over the disk-derived recording on the write path** (`scaffold.ts:1483`, SPEC-043
  FR-3b): non-empty means a **violation**. This reading is unchanged.
- **Over the persisted manifest:** non-empty means **held, or edited since the last
  refresh**. It is never a violation, and nothing may treat it as a failure signal.

## Functional requirements

- **FR-1 - Palette command.** Add **"MinSpec: Show Withheld Harness Updates"** to the
  Command Palette. For each opted-in workspace folder (a folder with `.minspec/` at its
  root, per invariant 3), it computes the listing defined in FR-2 to FR-4 and shows it to
  the human. The command never refreshes, never merges and never writes. The editor
  surface that shows the result is left to the Plan, under two constraints:
  - it is not a file written into the repository;
  - it is not a modal.
- **FR-2 - What counts as held (the detector).** A section is listed when **both** of
  these are true:
  - the folder's persisted `.minspec/generated-hashes.json` is spendable as evidence,
    meaning `loadProvenHashes` returns `state: 'proven'` (`merge-refresh.ts:1395`);
  - its recorded hash for a heading present on disk differs from `hashSection` of that
    heading's on-disk body.

  This is the comparison `verifyGeneratedHashesConsistent` already makes, applied to the
  proven map. The Plan may call that predicate or a sibling that shares
  `sectionHashesFromMarkdown`. The Plan must not add a second hashing path, because
  duplicated predicates drift.
- **FR-3 - What each row carries.** Each listed section shows:
  1. its file (path relative to the folder) and its heading;
  2. **withheld items:** how many content items the **current** rendered template body
     for that heading has that the on-disk body lacks;
  3. **dropped items:** how many content items the on-disk body has that the current
     template lacks.

  Both counts use the same `contentItems` normalisation that `generatedAddsContent`
  uses (`merge-refresh.ts:643`), so "content" means exactly what the merge means by it.

  The counts are measured against the template **as this MinSpec version renders it
  now**, not against the stale withheld hash. The template may have changed again since
  the hold began. The rendering must be read-only (INV-2). It must not run the
  pre-render `seedConstitution` write that `refreshHarnessFiles` performs (#2520). If
  it cannot render a heading without that write, the row says the count is unavailable
  and says why. It never invents a count.
- **FR-4 - Grouping, and saying what the detector cannot tell.**
  - Rows with **withheld items > 0** are listed first, under a heading that says MinSpec
    is withholding template content from them.
  - Rows with **withheld items = 0** come next. These sections differ from MinSpec's
    record, but the current template brings nothing they lack. That means either the
    hold no longer withholds anything, or the file was edited after the last refresh.
    Either way, the next refresh writes no template content into them.
  - The listing states, in one sentence, two facts:
    - it cannot tell a no-baseline hold (class A) from a preserved user edit (class B);
    - it cannot tell a hold from an edit made since the last refresh, because the
      manifest records only what the last refresh decided.
  - Each group repeats the release path the notice already gives: emptying a section
    ends its hold, and the next refresh takes the current template.
- **FR-5 - Never report "nothing" when the answer is "cannot tell".** These states are
  each reported in their own words, and none of them prints the zero-held message:
  - **manifest absent:** a fresh clone or new worktree, where the manifest is gitignored
    and machine-local;
  - **manifest present but not spendable:** `superseded` or `unreadable-version`, using
    the same reasons `preservedWithoutBaselineMessage` gives;
  - **manifest JSON unreadable;**
  - **manifested file present but unreadable.** `verifyGeneratedHashesConsistent`
    silently `continue`s past this case today (`merge-refresh.ts:1534`), so the listing
    must not inherit that skip.

  The zero-held message appears only when the manifest is proven and every manifested
  file was read. It names how many files and sections were examined, so an empty result
  can be told apart from an empty input.
- **FR-6 - Name the intended reading in code.** Rewrite the docstring of
  `verifyGeneratedHashesConsistent` to state both readings from "The design tension"
  above. Delete or correct the claim that it is ready to be an offline commit/CI drift
  check over the persisted manifest. If #760 (or any open work) intends to gate on the
  persisted manifest, that work has to be redirected: a gate built on this predicate
  would fail every project with a hold. The Plan records what it found for #760.
- **FR-7 - The notice stops saying it is the only one.** Change
  `preservedWithoutBaselineMessage` (`scaffold.ts:767-846`) as follows:
  - Replace *"This is the only notice you will get about it"* with a sentence that names
    the FR-1 command as the way to list held sections again.
  - Keep the sentence saying the hold STANDS and goes on withholding later updates. That
    part is still true, and it is the consequence the reader needs.
  - Keep the notice firing once. This spec does **not** make the notice repeat (DQ-2,
    option `r` rejected).
- **FR-8 - Multi-root.** With several workspace folders, the listing covers each
  opted-in folder separately and labels it. A folder without `.minspec/` is skipped and
  named as not opted in. It is never read past its marker check.

## Invariants (must not break)

- **INV-1 - Offline (constitution invariant 1).** The command and its library make no
  network call and import no network module.
- **INV-2 - Read-only.** Running the command changes no byte under the workspace folder.
  That covers the manifest, `template-baseline.json`, harness files, the constitution
  (no `seedConstitution`), git index and git config.
- **INV-3 - Blast radius (constitution invariant 3).** It reads only inside folders that
  carry `.minspec/` at the root.
- **INV-4 - No silent gate (constitution invariant 2).** Every read or parse failure
  surfaces as a row or message (FR-5). None is swallowed into a shorter or empty list.
- **INV-5 - Merge decision and recording unchanged.** `mergeFile`'s branch choice, its
  `withheldTemplateHashes` and `unauthoredHeadings` recording, and SPEC-043 FR-3b's
  write-path check all behave identically. Existing `merge-refresh` and `scaffold` tests
  stay green with no fixture edits, except the assertion on the notice sentence FR-7
  changes.
- **INV-6 - One hashing path.** Held-detection hashes through `sectionHashesFromMarkdown`
  and `hashSection`, the helpers the manifest is written with (SPEC-043 INV-4).

## Acceptance criteria

- **AC-1 (FR-2, FR-3).** Build a fixture shaped like scroogellm: a proven manifest whose
  `CLAUDE.md > Pre-Commit Checks` entry is a withheld template hash, and an on-disk body
  that lacks one item the current template has. The listing has exactly one row, for
  that file and heading, with withheld items = 1, in the "withholding" group.
- **AC-2 (FR-2, red-before-green).** On the AC-1 fixture with the on-disk body replaced
  by the current rendered template body, the listing reports zero held, and names the
  counts it examined.
- **AC-3 (FR-4).** A section edited after the last refresh, whose content items are a
  superset of the current template's, is listed with withheld items = 0, in the second
  group. It is not listed in the first.
- **AC-4 (FR-5).** Each of these produces its own message, and none of them is the
  zero-held message:
  - no manifest;
  - an unstamped (`superseded`) manifest;
  - a manifest stamped with an unknown version;
  - invalid JSON;
  - a manifested file that cannot be read.

  The unreadable-file case must fail on a variant that reuses the predicate's silent
  `continue`.
- **AC-5 (INV-2).** Snapshot every file's bytes and mtime under the fixture folder before
  and after the command runs, including a constitution that `seedConstitution` would
  change. They are identical.
- **AC-6 (INV-1).** The new module passes the existing offline/no-network invariant test
  that already guards `src/lib`.
- **AC-7 (FR-7).** The notice text no longer contains "only notice". It names the FR-1
  command. It still states the hold stands.
- **AC-8 (FR-8, INV-3).** In a two-folder workspace where one folder has no `.minspec/`,
  that folder is reported as not opted in, and none of its files is opened.
- **AC-9 (INV-5).** The full `merge-refresh*` and `scaffold*` suites pass unchanged. The
  one exception is the notice-text assertion updated for AC-7.
- **AC-10 (FR-6).** The docstring of `verifyGeneratedHashesConsistent` names both readings
  and no longer promotes a persisted-manifest CI drift gate. This is checked in review;
  it is prose and cannot be tested.

## Decisions needed (Clarify)

- **DQ-1 - Where the listing gets its truth from.**
  - `a` **Persisted manifest + read-only render of the current template (rec).** This is
    the issue's detector plus FR-3's counts. It is cheap and offline, and it is exact for
    "what did the last refresh decide to keep". *Cost:* it cannot tell a hold from an
    edit made since the last refresh, or class A from class B (FR-4 says so in the
    listing). It also says "cannot tell" in every fresh clone, because the manifest is
    machine-local.
  - `b` **A non-writing dry run of the whole refresh merge.** This reports exactly what
    the *next* refresh would hold, including class A vs B. *Cost:* no non-writing refresh
    path exists. `refreshHarnessFiles` seeds the constitution before it renders (#2520),
    so this means building and maintaining a second refresh pipeline that has to stay in
    step with the real one. That kind of duplicate drifts.
- **DQ-2 - Which surface (the issue's options).**
  - `c` **Palette command (rec, specified as FR-1).** *Cost:* a command nobody runs is not
    a gate, so a project can still sit pinned for weeks. This makes the state
    discoverable, not visible. FR-7 pointing the notice at the command is the partial
    mitigation.
  - `r` **Repeat the notice on every refresh.** Rejected: many holds are correct (the
    voip-sms-inbox hold is a ratified standing exception), so a toast on every refresh
    about a decision the user already made cries wolf and gets bypassed.
  - `s` **Status-bar or diagnostics entry while any section is held.** Deferred, not
    rejected. It is the only option that makes the hold *visible*, but it adds an
    always-on surface with its own rules for going quiet. If the human wants it, the
    recommendation is a follow-up spec that reuses this spec's library, so the detector
    is not built twice.
- **DQ-3 - Whether to list class B (preserved user edits with a proven baseline).**
  - `y` **List them (rec, as specified).** Each one withholds template updates just as a
    class-A hold does, and the question the human has ("is MinSpec sitting on anything?")
    has no exception for edits they made months ago. *Cost:* a heavily customised project
    gets a long list. FR-4's withheld-items grouping keeps the actionable rows at the
    top.
  - `n` **List only rows the manifest cannot prove are user edits.** Not achievable from
    the persisted manifest (DQ-1 `a`). It needs DQ-1 `b`.

## Alternatives recorded (DR-086 §4)

- **Persist a hold register** (a new `.minspec/holds.json` naming each held section and
  why). Rejected. It adds a second record of what the manifest already implies, and the
  two would have to be kept in step. A copy that drifts from the manifest is the failure
  this spec exists to stop.
- **Make `reportHold` also fire in the user-modified branch.** Rejected for this spec.
  It is option `r` by another route, turning every preserved user edit into a toast on
  every refresh.

## Decision record

No new DR. Every choice here can be undone in under a day: a command can be removed, a
docstring and a notice sentence can be reverted, and nothing persisted changes format.
The recording this spec reads is already decided by DR-089.

## Follow-ups (tracked)

- Status-bar / diagnostics surface (DQ-2 `s`): opened only if the human picks it at
  Clarify, as a follow-up spec. `None` until then.
- #760 (offline drift check): FR-6 requires the Plan to record whether #760's design
  depends on the persisted-manifest reading.
- #1785 (end-to-end pin of the withheld half of SPEC-043 AC-9): AC-1 of this spec uses
  the same fixture shape. The Plan should share the fixture rather than build a second
  one.
