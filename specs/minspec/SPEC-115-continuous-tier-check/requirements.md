---
id: SPEC-115
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-004  # Classifier Validation - DR-009/DR-021 (what a tier may and may not claim) live here
aspects: [tier, classifier, validator, diagnostics, quick-fix, approval-hash, tier-0]
relates_to: [DR-021, DR-026, DR-012, DR-024, DR-004, DR-014, SPEC-004, SPEC-005, SPEC-013, SPEC-022, "#138", "#103", "#90", "#91"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1/FR-2). Both
# files are NEW and are needed under every Clarify answer below: FR-1 (the floor function)
# and its tests exist whichever options the human picks.
implements: [packages/minspec/src/lib/tier-floor.ts, packages/minspec/tests/tier-floor.test.ts]
# Modified, not owned. Named from the code read for this spec; the Plan phase may narrow it.
affects: [packages/minspec/src/lib/spec-validator.ts, packages/minspec/src/lib/diagnostics.ts, packages/minspec/src/lib/spec.ts, packages/minspec/src/extension.ts, scripts/validate-frontmatter.ts]
---

# SPEC-115: A spec's declared tier is checked against its own content on every save, and a shortfall is offered as a one-click raise

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers the six questions under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the
> normal spec-approval gate before any code changes. Every requirement below is written
> under each question's recommended option, so approving the spec as it stands accepts
> those recommendations. Choosing a different option changes only the requirements that
> question names.

Materializes **[#138](https://github.com/AIClarityAU/minspec/issues/138)** - *"minspec
should detect and autofix tier incorrectness as it goes. the reclassify command should be
unnecessary."* (founder, verbatim).

**Id note.** `SPEC-097` through `SPEC-114` are claimed on unmerged branches (read from all
279 local remote-tracking refs, newest dated 2026-10-03; `SPEC-097` alone is claimed by
fifteen branches). `SPEC-115` was the lowest id above every claim visible from this
checkout. Open pull requests are not visible offline, and sibling dispatches running at the
same moment may pick the same number, so if the id collides at review time, renumber.

## One-Sentence Scope

Compute, from a spec's own text and nothing else, the lowest tier that text can honestly
carry; whenever the declared `tier:` sits below it (or is missing), say so on the `tier:`
line and in every validation run, and offer the correction as one click - never lowering a
tier, never writing an approval record, never asking the user to run a command.

## Reality-check - what the issue assumes, checked against `origin/main` 350c6fa4

The issue body was written on 2026-06-04. Four of its premises were checked against code
and the corpus rather than taken on its word (CLAUDE.md, Evidence Discipline).

1. **"The reclassify command" does not exist.** Searching `packages/minspec/src` and
   `packages/minspec/package.json` for `reclassif` returns nothing. The only tier command
   is `minspec.classify`, "MinSpec: Classify Task Complexity"
   (`packages/minspec/package.json:96-97`). It measures a *diff*, and its command file
   contains no spec-frontmatter write (`packages/minspec/src/commands/classify.ts`,
   searched for `writeFile` and `frontmatter`: no hits); its one persistent effect is the
   bump-up record in `.minspec/calibration.json` (`classify.ts:140-141`). So today
   **nothing re-evaluates a spec's `tier:` after it is first written** - there is no
   command to make unnecessary, only a gap to close. This spec reads the founder's
   sentence as: no command, existing or future, should be needed to keep a tier right.

2. **"Tierless specs silently default to T2" is half fixed.** The parser still coerces a
   missing or unrecognized tier to `T2` (`packages/minspec/src/lib/spec.ts:302`). The
   *detection* half of #103 has shipped: a primary spec with no `tier:` now draws a
   `frontmatter.tier.missing` warning (`packages/minspec/src/lib/spec-validator.ts:541-545`,
   rule emitted at `:595`). What has not shipped is any *offer to fix it*, and the warning
   cannot say what the tier should be. In this repo's corpus today, 0 of 76 primary specs
   are tierless.

3. **"Tier change voids approval" is true, and the reason matters.** The canonical
   approval hash removes exactly `status` and `phases` from the frontmatter and keeps
   everything else, `tier` included (`packages/shared/src/canonical.ts:14-16`). So editing
   `tier:` on an approved spec makes that approval stale. The same file shows the body is
   inside the hash too (`canonical.ts:130`), which gives a useful consequence: **a spec
   that grows requirements after approval is already stale because of the growth itself**,
   so raising its tier in the same edit costs no additional re-approval.

4. **The proposed rubric does not predict the declared tier, in one direction
   especially.** The issue offers "FR count (T2 ~3-5, T3 ~6-12, T4 >12)". Measured over
   the 76 primary specs on `origin/main` (counting distinct FR ids that open a list item,
   heading, table row or bold lead; `FR-4a`/`FR-4b` counted once):

   | Reading of the rubric | Specs |
   |---|---|
   | Declared tier is **below** what the FR count implies | 5 |
   | Declared tier is **above** what the FR count implies | 28 |
   | Declared tiers in the corpus | T2: 3 · T3: 46 · T4: 27 · missing: 0 |

   The five below-floor specs are SPEC-039 (T2, 6 FRs), SPEC-050 (T2, 8), SPEC-076
   (T2, 8), SPEC-042 (T3, 17) and SPEC-077 (T3, 20). All five carry an approval record.
   The 28 above-floor specs are not errors: a spec is legitimately T4 for reasons a count
   cannot see (a hard-to-reverse seam, a security boundary). **So the FR count is usable
   as a lower bound and useless as an exact answer** - the same shape
   [DR-021](../../../docs/decisions/DR-021.md) found for the diff-based classifier, and it
   leads to the same design: a floor that only ever moves up.

   A second candidate from the issue, "cross-package contract present", was measured the
   only way the corpus allows: `implements:`/`affects:` paths spanning two or more
   `packages/<name>` roots. 37 of 76 specs declare ownership at all; four span packages
   (SPEC-041, SPEC-046, SPEC-070, SPEC-086) and all four are already T3 or T4. The rule
   would flag nothing today.

   The remaining three candidates ("declared UX/data/API aspect", "number of hard
   invariants", "blast-radius / hard-to-reverse seams") have no deterministic detector
   defined anywhere and were not measured. They are not in this spec's first rule table
   (DQ-3).

**What the issue's dependency actually is.** The issue says this "depends on resolving the
classifier diff-size bias". That bias is not resolved and DR-021 decided it will not be:
the diff-based classifier ships as a floor. This spec does not need it resolved, because
the check below never reads a diff. It has its own evidence debt instead - the rule table
is new and unjudged - and FR-13 is where that debt is paid.

## Functional Requirements

Terms. A **primary spec** is the requirements artifact: a single-file spec, or the
`requirements.md` of a split-layout spec (`isPrimarySpec`, `spec-validator.ts:532`).
The **declared tier** is the literal `tier:` value in the file, not the parser's coerced
value. The **floor** is the result of FR-1. A **shortfall** is a declared tier that ranks
below the floor.

### The signal

- **FR-1 - Intrinsic floor function.** One pure function takes a primary spec's text and
  returns a floor tier plus the list of signals that produced it, each signal carrying a
  name, the value observed, and the tier it contributes. The floor is the highest
  contribution; no signals means `T1`. It reads the spec's own frontmatter and body and
  nothing else: no diff, no git, no file system beyond the text handed to it, no network,
  no model call, no clock. The same text always yields the same result.
- **FR-2 - First rule table (under DQ-3's recommended option).** Two rules:
  1. *Requirement count.* Six or more distinct FR definitions contribute `T3`; thirteen
     or more contribute `T4`. An FR definition is an FR id that opens a list item, a
     heading, a table row or a bold lead in the body; a letter suffix does not make a new
     id. A mention of an FR in running prose, or of another spec's FR, is not a definition.
  2. *Cross-package ownership.* `implements:` and `affects:` paths that fall under two or
     more distinct `packages/<name>` roots contribute `T3`.

  The table is data, carries a version identifier, and is the only place a threshold
  lives.
- **FR-3 - What counts as a finding.** A finding exists only for a primary spec, and only
  when the declared tier ranks below the floor. A declared tier at or above the floor
  produces nothing: no diagnostic, no message, no suggestion. The check never proposes a
  lower tier (DR-021 Decision 1; DQ-6).
- **FR-4 - Missing tier.** For a primary spec with no `tier:` or an unrecognized one, the
  existing `frontmatter.tier.missing`/`.unknown` warning additionally names the tier it
  will offer: the higher of the floor and `T2`. `T2` is the value the parser is already
  applying, so the offer never drops below the ceremony currently in effect.

### Reporting

- **FR-5 - One rule, every surface.** The shortfall is a single validator rule emitted
  from the FR-1 function, and it appears identically in the editor's diagnostics, in
  "MinSpec: Validate", and in the commit/CI validation path (`npm run validate`, which
  runs `scripts/validate-frontmatter.ts` and already imports `spec-validator.ts` at `:31`).
  There is one implementation; no surface re-derives the floor. The message states the
  declared tier, the floor, every signal that reached the floor with its observed value,
  the exact frontmatter line that resolves it, and which phases the higher tier newly
  requires. Severity is `warning` (DQ-2).
- **FR-6 - Continuous, with no command.** In the editor the check re-runs when a spec is
  saved and when its text changes, on the same events the reference diagnostics already
  use (`packages/minspec/src/lib/diagnostics.ts:238-239`). No palette command is added and
  none needs to be run for a shortfall to appear or clear. Each run is a scan of one
  document already in memory; it adds no work to extension activation (constitution
  constraint 3).
- **FR-14 - The check does not claim to measure difficulty.** Every user-facing string
  says the floor reflects how much the spec declares, not how hard the work is (DR-021
  Decision 3). No string calls a tier "correct" or "wrong"; the finding says the declared
  tier is below the floor and why.

### The fix

- **FR-7 - One-click raise.** The finding carries an action, "Raise tier to Tn", where Tn
  is the floor (or FR-4's value for a missing tier). Accepting it changes the `tier:` line
  only - inserting the line if absent, keeping any inline comment on it - as an edit the
  user can undo, and never over unsaved changes it would clobber
  ([DR-026](../../../docs/decisions/DR-026.md), dirty-editor safe). Nothing is written
  until the user accepts (DQ-1). No finding and no action are produced in a folder with no
  `.minspec/` marker (constitution invariant 3).
- **FR-8 - Approval is never touched, and the cost is stated first.** When the spec has an
  approval record whose hash currently matches, the action's label or detail says, before
  it is accepted, that raising the tier makes the approval stale and the spec will need
  re-approval. The raise never creates, edits or deletes an approval record and never
  edits `status:`. Re-approval happens through the existing approve path and no other.
- **FR-9 - Newly required phases start unfinished.** After a raise, every phase the new
  tier requires that the spec has not completed reads as pending everywhere phase progress
  is shown. The raise marks no phase done, skipped or in progress. *(How an absent phase
  key renders today was not verified for this spec; the Plan phase must check it and, if
  an absent key reads as anything other than pending, fix that as part of this FR.)*
- **FR-10 - Keeping the declared tier is possible and stays visible.** A second action,
  "Keep Tn (acknowledge floor Tm)", records in the spec's frontmatter the floor the human
  has seen and declined (DQ-4). While the floor is at or below the acknowledged value the
  finding drops to information level and **is still listed** on every surface in FR-5,
  worded as acknowledged. If the floor later rises above the acknowledged value the
  warning returns. An acknowledgment with no shortfall left to acknowledge is reported as
  removable.
- **FR-11 - A current approval is not disturbed by the check alone.** For a spec whose
  approval hash currently matches, a shortfall is reported at information level with the
  text "applies at the next re-approval", and raises no toast (DQ-5). The moment the
  approval is stale or absent, FR-5's warning applies.
- **FR-12 - MinSpec never mints a tier.** No MinSpec write puts a `tier:` value into a
  spec that the author did not type or accept through FR-7. In particular, a spec with no
  `tier:` still has no `tier:` after any tool write to its frontmatter. *(The parser
  coerces a missing tier to `T2` at `spec.ts:302` and the serializer emits
  `tier: ${fm.tier}` unconditionally at `spec.ts:387`, so I believe a parse-then-write
  round trip turns a missing tier into a written `T2`. That was read from the two lines,
  not reproduced. The Plan phase must reproduce it or refute it; if real, it is the
  mechanism behind #103's "silently", and closing it is in scope.)*

### Evidence

- **FR-13 - The rule table is judged against this corpus before it ships.** The
  implementing pull request includes the list of specs the shipped function flags across
  this repository, produced by running the function rather than by hand. With FR-2's table
  at `origin/main` 350c6fa4 the expected list is the five specs named in the
  Reality-check; a different list is explained in the pull request. The founder marks each
  flag right or wrong, and the verdicts are recorded in this spec's `tasks.md` Findings.
  A rule with a wrong verdict has its threshold revisited in the same pull request, or the
  verdict is recorded as an accepted false positive. No rule is added to the table later
  without the same list and the same verdicts.

## Acceptance Criteria

- [ ] **AC-1 (FR-1).** The floor function is called twice on the same text and returns
      equal results; a test asserts its module imports no `vscode`, `fs`, `child_process`
      or network module.
- [ ] **AC-2 (FR-2).** A spec with five FR definitions yields `T1`, with six yields `T3`,
      with twelve yields `T3`, with thirteen yields `T4`. `FR-4a` and `FR-4b` count once.
      An FR id that appears only in running prose counts zero. Ownership paths under one
      package yield no contribution; under two yield `T3`.
- [ ] **AC-3 (FR-3, DQ-6).** A `T4` spec with two FR definitions produces no finding on
      any surface. No message anywhere in the feature contains a suggestion to lower a tier.
- [ ] **AC-4 (FR-4).** A tierless primary spec with eight FR definitions is offered `T3`;
      a tierless primary spec with two is offered `T2`, not `T1`.
- [ ] **AC-5 (FR-5).** For one fixture spec, the editor diagnostic, "MinSpec: Validate"
      and `scripts/validate-frontmatter.ts` report the same rule id and the same floor.
      The message contains the declared tier, the floor, each driving signal's value and
      the resolving frontmatter line.
- [ ] **AC-6 (FR-6).** Adding a sixth FR definition to an open `T2` spec makes the
      finding appear with no command run; removing it makes the finding clear. The
      contributed-commands list in `package.json` gains no entry.
- [ ] **AC-7 (FR-7).** Accepting the raise changes exactly one line of the file; an
      inline comment on the `tier:` line survives; one undo restores the original text. In
      a folder without `.minspec/` no finding and no action appear.
- [ ] **AC-8 (FR-8).** On a spec with a matching approval, the action text names the
      staleness before acceptance. After acceptance the approval record's bytes are
      unchanged, `status:` is unchanged, and the spec's approval status reads stale.
- [ ] **AC-9 (FR-9).** After raising `T2` to `T3` on a spec with only `specify` and `plan`
      recorded, the `tasks` and `implement` phases read as pending and the completed count
      does not rise.
- [ ] **AC-10 (FR-10).** After "Keep", the finding is present at information level on all
      three surfaces of AC-5. Adding FR definitions until the floor passes the acknowledged
      value restores the warning. Raising the declared tier to the floor makes the
      acknowledgment report as removable.
- [ ] **AC-11 (FR-11).** A shortfall on a spec with a matching approval is reported at
      information level with the "next re-approval" text; after any content edit that
      makes the approval stale, it is reported at warning level.
- [ ] **AC-12 (FR-12).** A tierless spec is parsed and written back by every MinSpec write
      path that rewrites frontmatter; the result contains no `tier:` line.
- [ ] **AC-13 (FR-13).** The implementing pull request body carries the generated flag
      list and `tasks.md` carries a verdict per flagged spec.
- [ ] **AC-14 (FR-14).** A test over the feature's user-facing strings finds none of
      "difficulty", "harder", "correct tier", "wrong tier".

## Invariants (must not break)

- **INV-1 - Offline and deterministic.** The check makes no network call and no model
  call, and gives the same answer in the editor, at commit and in CI (constitution
  invariant 1; goal G-6; [DR-004](../../../docs/decisions/DR-004.md)).
- **INV-2 - Upward only.** Nothing in this feature lowers a tier, offers to, or reports a
  tier as too high (DR-021 Decision 1).
- **INV-3 - Offer, never silent.** No tier value reaches a file without a human accepting
  it, and no finding is ever hidden by being acknowledged (DR-026; FR-10; FR-12).
- **INV-4 - Approval records are written only by the approve path.** This feature reads
  approval state and never writes it ([DR-012](../../../docs/decisions/DR-012.md);
  SPEC-022).
- **INV-5 - The canonical hash is unchanged.** `tier` stays inside the canonical approval
  hash; this spec changes neither what is hashed nor how
  (`packages/shared/src/canonical.ts`).
- **INV-6 - Blast radius.** No finding, toast or write in a folder with no `.minspec/`
  marker (constitution invariant 3; SPEC-096).
- **INV-7 - No silent gate.** If the check errors on a spec, that spec's result is a
  visible failure naming the spec, never an absent finding (constitution invariant 2).
  This binds from day one even though the rule is advisory, so that promoting it to a gate
  later (DQ-2) needs no rework.
- **INV-8 - The diff-based classifier is untouched.** `minspec.classify`, its floor
  (`applyFloor`) and its bump-up affordance behave exactly as before.
- **INV-9 - Signals stay named.** The floor function returns its signals, not only a
  scalar, so that the result can later feed the risk-profile container
  ([DR-024](../../../docs/decisions/DR-024.md) Decision 1) without a second analyzer.

## Decisions needed (Clarify)

### DQ-1 - Does "autofix" mean applied, or offered?

The founder's sentence says "autofix". The issue's design notes, written by the session
that parked it, say "detect-then-offer, never silent". Those differ.

- `a` **Always a one-click offer (rec).** Matches DR-026 and SPEC-005 as they stand.
  Cost: every shortfall takes one click, and it reads "autofix" as "the fix is handed to
  you in place" rather than "the fix happens".
- `b` Apply the raise automatically on a spec with no approval record, with a visible
  notice and undo; offer only when an approval exists. Costs: MinSpec edits a document the
  user may be typing in; an unjudged rule table (FR-13) raises ceremony on its own false
  positives; and it overturns DR-026's offer-never-silent posture, so it needs that
  decision record amended first.
- `c` Apply automatically everywhere. Cost: everything in `b`, plus approvals go stale
  with no human act.

Changes FR-7 and INV-3.

### DQ-2 - Advisory, or a gate?

- `a` **Warning only in the first release (rec).** Cost: an under-tiered spec can still be
  approved at the lower tier, with only a warning in the way - the shape principle 8
  ("enforce it via code") warns about.
- `b` An error at approval time for a spec with an unacknowledged shortfall. Cost: the
  first rule table has been judged on five flags, none yet by a human, and a gate built on
  it blocks approvals on its false positives.

Recommended sequencing: `a` now, and revisit `b` once FR-13's verdicts exist. Changes
FR-5's severity.

### DQ-3 - Which signals are in the first rule table?

- `a` **Requirement count and cross-package ownership (rec).** Both are computable from
  the spec's text and both were measured (five flags and zero flags). Cost: under-tiering
  that shows up as neither - a three-FR spec that moves a security boundary - is not
  caught.
- `b` Requirement count only. Cost: drops a rule that costs nothing today, and loses the
  one signal that speaks to contract breadth.
- `c` All five candidates in the issue. Cost: three of them ("UX/data/API aspect",
  "hard invariants", "hard-to-reverse seams") have no deterministic definition and no
  measurement; shipping them is shipping guesses under a never-wrong banner.

Changes FR-2.

### DQ-4 - Where does "keep this tier" live?

- `a` **A frontmatter key in the spec (rec).** One source of truth, visible to whoever
  reads the spec, seen by CI with no new store. Unknown frontmatter keys already survive a
  tool round trip (`spec.ts:186-194`, #2324). Costs: the key is inside the approval hash,
  so acknowledging on an approved spec makes that approval stale (DQ-5's recommendation
  removes most of that); and an agent authoring a spec can write the key itself - nothing
  but FR-10's always-visible listing stands in the way.
- `b` A committed record under `.minspec/`, outside the hash. Cost: a new committed store
  and format that the validator, the hook and CI must all read, and the override no longer
  sits in the document the approver reads.
- `c` `.minspec/preferences.json`. Not viable as it stands: that file is git-ignored
  (`.gitignore:93`), so CI and every other checkout would still warn.

Changes FR-10.

### DQ-5 - What happens to the five approved specs that are already below the floor?

SPEC-039, SPEC-042, SPEC-050, SPEC-076 and SPEC-077 each carry an approval record.

- `a` **Information only until the next re-approval (rec).** No approval is disturbed by
  shipping this. Cost: those five keep their lower ceremony until something else makes
  them stale, which for a finished spec may be never.
- `b` Warn immediately. Cost: clearing each warning, by raising or by acknowledging under
  DQ-4 `a`, makes that approval stale - five re-approvals on day one.

Changes FR-11.

### DQ-6 - Should a tier that looks too high ever be mentioned?

The founder said "tier incorrectness", which covers both directions.

- `a` **Never (rec).** DR-021 Decision 1 is upward-only, and the measurement shows 28 of
  76 specs sit above the count-implied floor for reasons a count cannot see. Cost: a
  genuinely over-tiered spec keeps paying ceremony it does not need, and this feature will
  not say so.
- `b` Mention it at information level, with no action. Cost: 28 notices on this corpus on
  day one, most of them wrong, against principle 4 ("avoid nagging").

Changes FR-3 and INV-2; `b` would also need DR-021 revisited.

## Why no new DR

Under the recommended options this spec applies decisions already in force rather than
making one: the upward-only direction is DR-021 Decision 1 extended from a diff to a
spec; the offer-never-silent fix is DR-026; the approval interaction is DR-012/SPEC-022
unchanged. The thresholds in FR-2 are data in one table and can be changed in minutes.
`docs/decisions/INDEX.md` was searched for an existing record on continuous tier checking
(terms: tier, classif, ratchet, reclassif, tier-check, mismatch); DR-021, DR-022 (status
superseded) and DR-024 are the nearest and none decides this.

Two answers above would require a decision record before any build: DQ-1 `b` or `c`
(amends DR-026) and DQ-6 `b` (revisits DR-021).

## Out of Scope

- Lowering a tier, or any downward suggestion (INV-2).
- Removing, renaming or changing `minspec.classify` or `minspec.autoClassifyOnCommit`
  (INV-8). The two checks answer different questions - how big is this change, and how
  much does this spec declare - and both are floors.
- The diff-size bias of the diff-based classifier (DR-021 decided it; SPEC-004 measured it).
- Replacing scalar `tier` with a risk-profile container - #90, gated on #91, per DR-024.
  INV-9 keeps this spec compatible with it and does nothing more.
- Any signal that needs a model to read the spec (DR-021 Decision 5: opt-in, not core).
- `tier:` on decision records and epics, and split-layout `design.md`/`tasks.md` files,
  which legitimately omit a tier.
- The triage tier assigned to GitHub issues by the dispatch pipeline (DR-070, DR-091).

## Alternatives considered and rejected

- **Autofix toward the diff-based classifier.** Rejected by the issue itself and by
  measurement: that classifier predicts T1 for 89 of 120 cases (DR-021 Context), so
  correcting specs toward it would push tiers the wrong way.
- **Treat the FR-count rubric as the tier.** Rejected by the Reality-check table: it
  disagrees with the declared tier in 33 of 76 specs, 28 of them downward.
- **A "Reclassify Spec" palette command.** Rejected: it is the thing the founder asked to
  be unnecessary, and a check that waits to be run is not continuous.
- **Hold the acknowledgment in a git-ignored file.** Rejected: CI would disagree with the
  editor (DQ-4 `c`).
- **Take `tier` out of the canonical hash so a raise costs no re-approval.** Rejected: the
  tier decides which phases and which human reads are required, so an approval that
  survives a tier change is an approval of different ceremony than was signed (INV-5).
- **Block the save or the commit on a shortfall.** Rejected for the first release: the
  rule table is unjudged (DQ-2).

## Test plan (for the Plan phase to place)

Unit tests on the floor function for every threshold boundary in AC-2 and for the FR
definition forms in FR-2; a parity test feeding one fixture through the three surfaces of
AC-5; an approval-interaction test for AC-8 that compares the record's bytes before and
after; a round-trip test for AC-12 over every frontmatter write path; and the corpus run
of FR-13, whose output is committed evidence, not an assertion. A fixture that only the
intended rule can flag is needed for each rule, so that a green test cannot come from the
other rule firing.

## Traceability

- Triggered by: [#138](https://github.com/AIClarityAU/minspec/issues/138).
- Extends: #103 (tierless spec defaults to T2) - detection shipped at
  `spec-validator.ts:541-545`; the fix offer (FR-4) and the round-trip question (FR-12)
  are what remain.
- Rests on: [DR-021](../../../docs/decisions/DR-021.md) (upward-only floor),
  [DR-026](../../../docs/decisions/DR-026.md) (offer, never silent),
  [DR-012](../../../docs/decisions/DR-012.md) (content-hash approval),
  [DR-004](../../../docs/decisions/DR-004.md) (Tier-0, offline).
- Compatible with, does not implement: [DR-024](../../../docs/decisions/DR-024.md)
  Decision 1, #90, #91.
- Evidence for the diff-based classifier:
  [SPEC-004](../SPEC-004-classifier-validation/requirements.md).
