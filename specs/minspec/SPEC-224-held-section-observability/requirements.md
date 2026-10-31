---
id: SPEC-224
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a refresh that reports success while a section silently lags its template is a false signpost
aspects: [harness-refresh, merge-refresh, manifest, observability, no-silent-gate, blast-radius, tier-0, offline]
depends_on: [DR-089]  # the hold this spec makes visible is DR-089's fail-closed preservation; nothing here weakens it
relates_to: [SPEC-043, SPEC-079, DR-089, DR-066, "#2028", "#1697", "#1753", "#1724", "#760"]
# Ownership is deliberately NOT claimed yet. Whether this spec creates a new source file
# (a hold-ledger writer) depends on how DQ-1 below resolves. Every path named under
# `affects:` is modified under every answer to DQ-1.
implements: none
implements_reason: >-
  No new source file is certain under every answer to the Clarify questions. The hold
  inventory (FR-1) is computed inside the existing merge and refresh path. A ledger
  writer, if DQ-1 picks option (a), is claimed at Plan, before approval mints a hash.
affects: [packages/minspec/src/lib/merge-refresh.ts, packages/minspec/src/lib/scaffold.ts, packages/minspec/src/commands/init.ts]
phases:
  specify: done
  clarify: done
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-224: A held harness section stays visible for as long as the hold stands

## In plain terms

When *MinSpec: Refresh Harness Files* cannot prove that a section of a managed file
(`CLAUDE.md`, `AGENTS.md`, `.minspec/constitution.md`, ...) is its own output, it keeps
the existing text and does not apply the template's update. DR-089 (manifest records
authorship) made that hold correct. This spec does not change it.

The problem is that the hold goes invisible. MinSpec announces it once, on the refresh
that creates it. Every later refresh keeps holding the section and says only
"MinSpec: Refreshed harness files." That includes a later refresh whose template changed
the held section again. The record of which sections are held is in a gitignored,
machine-local file, so another machine, a reviewer and CI cannot see it either. A section
held two months ago looks exactly like one rendered this morning.

This spec makes every refresh report the sections it is holding, and re-notifies when a
template update arrives for a section that is already held. It also stops the drift check
from calling a file current when the file contains a held section that has fallen behind
its template. The open question for the human is whether the hold list should also live in
a committed file (DQ-1).

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. A human reads
> it, answers the questions under **[Decisions needed (Clarify)](#decisions-needed-clarify)**,
> and approves it through the normal spec-approval gate before any code changes.

Materializes **[#2028](https://github.com/AIClarityAU/minspec/issues/2028)**: *"a
withheld CLAUDE.md section is invisible after its one-time notice - gitignored baseline,
no marker, refresh reports success."* Rests on **[DR-089](../../../docs/decisions/DR-089.md)**
(the manifest records authorship, not disk; `status: accepted`).

**Id note.** `SPEC-224` is the highest claimed id plus one. On 2026-10-19 the ids were
read from `specs/` across every local and remote-tracking ref in this checkout (480
remote refs; highest claimed spec number: 223). Open pull requests not fetched into this
checkout are invisible to that scan. If the id collides at review time, renumber.

**Tier note.** Triage recorded T3. Mechanical scope: three existing source files plus
tests, and possibly one new writer and one new adopter-facing tracked file under DQ-1 (a).
Under DQ-1 (a) the file format ships into every adopter's `.minspec/` and cannot be
withdrawn in under a day. That needs a DR at Plan (see Follow-ups).

## One-Sentence Scope

Make every harness refresh report, by file and heading, every section it is currently
holding against the template. Re-notify when a held section's template moves. Never let
the refresh summary or the drift check describe a file with a lagging hold as current.
Which body a refresh keeps does not change.

## Root cause (mechanism, verified against code at `6df91ac4`)

This section describes the mechanism by which a hold becomes silent. It does not claim
that this mechanism caused the scroogellm instance in #2028. That remains **unverified**,
as the issue itself says.

1. **The notice is tied to the absence of a baseline, and the hold removes that absence.**
   `mergeFile`'s fail-closed branch (`packages/minspec/src/lib/merge-refresh.ts:985-1021`)
   runs only when `!oldHash`. It keeps the body, records the *withheld template hash* in
   `withheldTemplateHashes`, and calls `reportHold`. On the next refresh `oldHash` is
   present and differs from disk, so the section lands in the "user modified" branch
   (`merge-refresh.ts:1022-1050`). That branch keeps the body and re-records the withheld
   template hash, but it does **not** report. The INV-2 list guard has the same shape:
   it reports only `if (!oldHash)` (`merge-refresh.ts:897`).
2. **A later template change to a held section is withheld with no signal at all.** The
   user-modified branch records `hashSection(genSection.body)` of the *current* template
   on every run (`merge-refresh.ts:1048-1049`). Nothing compares it with the hash the
   previous run withheld, so a second, third or tenth update to that section is
   declined with nothing reported.
3. **The refresh summary is driven only by baseline-less holds.**
   `refreshSummaryMessage` (`packages/minspec/src/commands/init.ts:1511-1516`) counts
   only `kind === 'preserved-without-baseline'` warnings. With every hold now
   baseline-backed, it prints the bare success line.
4. **The drift baseline asserts currency after every refresh.** `refreshHarnessFiles`
   calls `saveTemplateBaseline(rootDir, computeTemplateBaseline())` unconditionally
   (`packages/minspec/src/lib/scaffold.ts:1824`, under the comment *"after a refresh the user's files
   are in sync with the current bundled template, so drift must read false"*). That
   statement is false for every held section.
5. **The only record of a hold is machine-local.** `.minspec/generated-hashes.json` is in
   MinSpec's declared machine-local set (`scaffold.ts:300`), and DR-089 deliberately kept
   it there. DR-089's "Alternatives rejected" section rejected committing the manifest
   because it changes on every refresh.

**Missing gate.** Nothing checks that a standing hold is reported anywhere after its first
run, so "a hold is never silent" holds for one refresh and then stops. The sibling #1753
(report the edits MinSpec preserved because the baseline proved them the user's) is the
same gap from the other direction. This spec covers it (FR-1 counts those holds) and
coordinates with #1753 (see Follow-ups).

## Functional requirements

- **FR-1 (hold inventory, every refresh).** Every refresh computes the complete set of
  sections it kept while declining a rendered template body that differs in content. Each
  entry carries `outputPath`, `heading` (displayed via the existing `displayHeading`
  rule) and a state:
  - `new`: the hold was first made on this refresh. This covers today's
    `preservedWithoutBaseline` set, from the fail-closed branch and from the INV-2 guard
    when it withheld content.
  - `template-moved`: a hold that already stood, whose currently rendered template body
    hashes differently from the withheld template hash the prior manifest recorded for
    that heading.
  - `standing`: a hold that already stood, whose template has not moved since.

  The inventory is derived from the same branch decisions `mergeFile` already makes. It
  is never a second classifier run over the two bodies, because two classifiers drift
  (the #1697 NEW-1 lesson recorded in the fail-closed branch, `merge-refresh.ts:985-1021`). A section the
  "same content, different bytes" branch keeps is **not** a hold: nothing was withheld.
  A user-added heading the template does not carry is **not** a hold either: there is no
  template body to withhold.
- **FR-2 (summary never omits a standing hold).** The refresh summary line states the
  number of held sections whenever the inventory is non-empty. The bare
  "Refreshed harness files." appears only when the inventory is empty. The count is the
  count of FR-1 entries, not the count of notices.
- **FR-3 (re-notify on a template move).** A `template-moved` hold raises a notice of the
  same informational, no-overwrite class as today's `'preserved-without-baseline'`
  notice. It names file and heading and says that a newer template update was withheld.
  It is folded into the existing single-notice-per-refresh rule (#1697 F3), so a
  refresh with several moved holds still raises one notice. A `standing` hold raises no
  notice beyond the FR-2 count. That is the answer to the alert-fatigue cost #2028 names:
  a notice re-fires only when there is new withheld content, never just because a hold
  exists.
- **FR-4 (the drift check does not claim a lagging file is current).** After a refresh
  with at least one `new` or `template-moved` hold, MinSpec's template-drift signal must
  not report the affected file as in sync with the bundled template. How (a per-file
  exclusion from the saved template baseline, or a held-file flag the drift reader
  consults) is a Plan decision. The observable requirement is that the drift signal and
  the FR-1 inventory never disagree about whether a file is behind its template.
- **FR-5 (a way to inspect holds on demand).** A human can ask "is this file current?"
  without running a refresh and without diffing by hand. The minimum is that the FR-1
  inventory from the most recent refresh can be re-shown from the editor: an action on
  the notice, and either a palette command or an entry in an existing status surface,
  chosen at Plan. Offline, read-only, no network.
- **FR-6 (durable, reviewable record).** Depends on **DQ-1**. Under the recommended
  option (a), each refresh writes the inventory to a committed file under `.minspec/`.
  The file is sorted deterministically, has no timestamps, and contains `outputPath`,
  `heading` and `state` only, so it changes only when the hold set or a hold's state
  changes, never on every refresh. Under (b) or (c), FR-6 is dropped and FR-5 is the
  only inspection path.

## Invariants (must not break)

- **INV-1 (DR-089 preservation is unchanged).** Which body `mergeFile` keeps, and which
  hash it records, is byte-for-byte unchanged on every branch. This spec only adds
  reporting. Every existing `merge-refresh*.test.ts` and scaffold refresh test stays green
  without edits to its assertions.
- **INV-2 (a report is never evidence).** Neither the FR-1 inventory nor an FR-6 ledger is
  ever read by `mergeFile` or by `recordVerifyAndSaveManifest` as evidence of
  authorship. Authorship evidence stays solely in the DR-089 manifest. A hand-edited or
  merge-conflicted ledger can therefore never release a hold or cause an overwrite.
  (If a committed ledger could release a hold, it would be the "commit the manifest"
  route DR-089 rejected, with weaker integrity.)
- **INV-3 (no overwrite affordance).** No notice this spec adds offers "Re-scaffold
  (overwrite)" or any write action. The reason is the #1697 F2 defect recorded at
  `init.ts:1414-1425`. The only documented release stays as today: empty the section's
  body.
- **INV-4 (offline, invariant 1).** The inventory, the notices, the drift change and the
  ledger make no network call.
- **INV-5 (blast radius, invariant 3).** Anything new is written only inside a project
  that already has `.minspec/` at its root, and only under `.minspec/`. No marker or
  comment is written into the user's prose (DQ-2).
- **INV-6 (no silent gate, invariant 2).** A failure to compute or write the inventory or
  ledger is surfaced as an error notice, never swallowed. It must not abort the refresh
  after the files are already written, because SPEC-043's all-or-nothing concern is about
  the managed files, not the report. The refresh summary must then not print the bare
  success line.
- **INV-7 (advisory, not gating, in adopter repos).** Nothing in this spec turns a hold
  into a failing CI check or merge blocker in an adopter repository (DQ-3).

## Acceptance criteria

All criteria run offline against fixture projects in vitest. Each one also mutation-checks
its own assertion: a run that removes the behaviour under test must turn the case red.

- **AC-1 (FR-1, FR-2: the second refresh is not silent).** In a fixture with no manifest
  entry for a CLAUDE.md section whose content differs from the template, refresh 1
  reports the hold as `new`. With the fixture unchanged, refresh 2 reports it as
  `standing`, and the summary line names one held section. Today refresh 2 prints the
  bare success line (mechanism 3), so this case is red on `6df91ac4`.
- **AC-2 (FR-3: a template move under a hold re-notifies).** After AC-1's refresh 2,
  change the bundled template body for that heading and refresh again. The section
  is still held (INV-1), its state is `template-moved`, and exactly one
  informational notice names that file and heading. Today nothing is reported
  (mechanism 2). Red on `6df91ac4`.
- **AC-3 (FR-3: no re-notify without new content).** Refresh again with the template
  unchanged. The state returns to `standing` and no notice is raised. Only the summary
  count remains.
- **AC-4 (FR-1 exclusions).** A section kept by the "same content, different bytes"
  branch, a user-added heading absent from the template, and an emptied (released)
  section each produce no inventory entry.
- **AC-5 (FR-1 covers the baseline-proven user edit).** A section whose recorded baseline
  differs from disk (a proven user edit), refreshed against a template whose content
  differs, is in the inventory. That is the #1753 case, so the summary no longer omits it.
- **AC-6 (FR-4).** After AC-1's refresh 1, the drift signal reports the fixture's
  CLAUDE.md as behind its template. After the section is emptied and refreshed (released),
  the drift signal reports it as current.
- **AC-7 (INV-1).** For each fixture in AC-1 to AC-5, the merged file bytes and the saved
  manifest are identical to those produced by the code at `6df91ac4`.
- **AC-8 (INV-2).** Under DQ-1 (a), deleting, emptying or hand-editing the ledger between
  two refreshes changes no merged byte and no manifest entry. The next refresh rewrites
  the ledger from the FR-1 inventory.
- **AC-9 (INV-6).** Inject a failure into the inventory or ledger write. The refresh still
  completes its file writes, an error notice is shown, and the summary does not print the
  bare success line.
- **AC-10 (FR-6 determinism, DQ-1 (a) only).** Two refreshes of the same project state
  produce byte-identical ledgers. A refresh that changes no hold leaves the ledger
  untouched (no write, no mtime change).

## Decisions needed (Clarify)

All 4 decisions are answered, not ratified: an agent session selected on 2026-10-25, for each, the option this document already recommended. No human chose them, and no delegation covers authoring Clarify answers. Delegation DLG-001 (DR-108) made none of these selections and covers spec approval and engineering-DR acceptance only. An agent-recorded selection carries no consent, whoever prompted it. It is ratified only by approval of this spec, the founder's or the bot's under DLG-001, and that approval may overturn it.

- **DQ-1: Where does the durable record of holds live?**
  **Recorded selection: Option (a),** the spec marks a committed hold ledger under
  `.minspec/` as its recommendation because it is reviewable in a pull request and the same
  on every clone.
  - **(a) A committed hold ledger under `.minspec/` (rec).** It contains `outputPath`,
    `heading` and `state` only, sorted, with no hashes and no timestamps. It is
    reviewable in a pull request, it is the same on every clone, and CI could read it. It
    churns only when holds change, which avoids the reason DR-089 rejected committing the
    manifest. **Cost:** it is a new adopter-facing file format that ships into every
    adopter's `.minspec/` and cannot be withdrawn in under a day, so it needs its own DR.
    Two branches that both refreshed can conflict on it. And per #2028, holds become
    review surface that a repo with many customised sections may learn to skim.
  - **(b) No committed file. Report-only (FR-1 to FR-5).** **Cost:** another machine,
    a reviewer and CI still cannot see which sections are held without running the
    extension, which leaves property 2 of #2028 unfixed.
  - **(c) Store holds inside the existing tracked `.minspec/config.json`.** **Cost:**
    generated state mixed into a hand-edited config file. Every refresh with a hold change
    dirties the user's config, which repeats the "rewritten on every refresh" noise the
    machine-local list exists to stop.
- **DQ-2: Inline `minspec:held` marker in the held section?** **No (rec).** **Cost of the
  recommendation:** someone reading the file directly, without the extension or the
  ledger, gets no in-file cue. **Cost of yes:** MinSpec's bookkeeping is written into
  prose MinSpec has agreed not to touch, and the marker can be deleted along with the
  hold's own content.
  **Recorded selection: No inline marker (rec),** because a marker writes MinSpec's
  bookkeeping into prose MinSpec has agreed not to touch.
- **DQ-3: Should a parity or CI check fail on a `template-moved` hold?** **No, advisory
  only (rec, INV-7).** **Cost of the recommendation:** a lagging hold in an adopter repo
  still merges. The signal is the FR-2 and FR-3 report (and the ledger diff under DQ-1
  (a)), not a red check. **Cost of yes:** an advisory becomes a merge blocker in adopter
  repos for what may be a deliberate local edit, which widens MinSpec's blast radius.
  That is a separate, opt-in follow-up if ever wanted.
  **Recorded selection: No, advisory only (rec, INV-7),** because a blocking check would
  widen MinSpec's blast radius in adopter repos.
- **DQ-4: How often does a notice re-fire?** **Only on `template-moved` (rec, FR-3).**
  **Cost of the recommendation:** a `standing` hold is reported only as a count in the
  summary line, and a human who skims that line may still miss it. The alternative,
  a notice on every refresh while any hold stands, is the "notice fires on every refresh
  forever" alert fatigue DR-089 rejected.
  **Recorded selection: Only on `template-moved` (rec, FR-3),** because a notice on every
  refresh is the alert fatigue DR-089 rejected.

## Alternatives considered

- **Release holds automatically when the template moves.** Rejected. That is the
  #1697 overwrite through a new door, and it breaks INV-1 and DR-089 §2.
- **Commit `generated-hashes.json`.** Rejected, for the reason DR-089 already records:
  it changes every refresh and conflicts across branches.
- **Re-notify on every refresh while a hold stands.** Rejected under DQ-4's
  recommendation, on alert-fatigue grounds.

## Not in scope

- Correcting scroogellm's `CLAUDE.md` (#2028 says this is a regenerate-through-the-
  extension job for a human).
- Proving that the mechanism above caused the scroogellm instance.
- Managed-region (marker-bounded) files. Those are overwritten inside their markers, not
  section-held. Their drift is SPEC-079's.
- Changing the fail-closed or user-modified preservation decision itself (INV-1).

## Follow-ups (tracked)

- **#1753** (report preserved edits): FR-1 and AC-5 cover the "summary omits it" half.
  At Plan, decide whether #1753 is closed by this spec or narrowed to anything left over.
- **#760** (offline manifest consistency check): unaffected (INV-2 keeps the ledger out of
  authorship). Recorded so its owner knows that a ledger, if DQ-1 (a) is chosen, is not
  an input.
- **#1724** (heading-keyed authorship maps): the FR-1 inventory inherits heading-keying.
  A duplicate heading reports once. Accepted here and tracked there.
- **DR at Plan, conditional on DQ-1 (a):** record the ledger format and its "report, never
  evidence" rule (INV-2), and amend DR-089's consequence that "the report falls silent
  after one refresh" to "the notice falls silent, the count does not". Not minted now,
  because no irreversible choice is made until Clarify answers DQ-1.
