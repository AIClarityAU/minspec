---
id: SPEC-128
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-004  # Classifier Validation — DR-021's floor model and DR-022/024's artifact-vs-diff rethink both live here
aspects: [classifier, classify-toast, ux, tier-0, honest-degrade, frontmatter]
relates_to: [DR-021, DR-022, DR-024, SPEC-004, SPEC-023, "#216", "#333"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1/FR-2; the shipped
# `/minspec-specify` guidance). The one new module and its test are required under every DQ
# answer below (DQ-1's options differ on what the module READS, not on whether it exists).
implements: [packages/minspec/src/lib/classify-artifact-binding.ts, packages/minspec/tests/classify-artifact-binding.test.ts]
# Modified, not owned. classify.ts belongs to no spec's `implements:` today (grepped across
# specs/*/requirements.md); this spec adds a call site in it but does not claim it.
# adr-manager.ts and spec.ts are modified only if DQ-1 needs a DR tier reader (adr-manager.ts
# has none today); spec.ts already exposes `frontmatter.tier` and needs no change for the spec
# half of DQ-1.
affects: [packages/minspec/src/commands/classify.ts, packages/minspec/src/lib/adr-manager.ts, packages/minspec/src/lib/consequence-analyzers.ts, packages/minspec/src/lib/git-analyzer.ts, packages/minspec/tests/commands.test.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-128: The classify toast names the SPEC or DR it is reclassifying, instead of only the raw diff

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks its Clarify questions, and approves it through the normal spec-approval
> gate before any code changes. Every requirement below assumes the **recommended** option
> in each open question under
> [Decisions needed (Clarify)](#decisions-needed-clarify); approving this spec as written
> accepts those recommendations, and picking a different option changes only the
> requirements that question names.

Materializes **facet 1** of
[#216](https://github.com/AIClarityAU/minspec/issues/216) — *"Classify toast is
artifact-blind + apes an approval it never performs."* Facets 2 and 3 of that issue are
**already shipped**, not open: commit `22563da7`
(`fix(#216): silent passive auto-classify + name the driving signal, drop confidence%`,
merged in pull request #333) made the auto-on-commit path a passive status-bar line with no
buttons (`packages/minspec/src/commands/classify.ts:128-131`), replaced the
"(N% confidence)" headline with the name of the driving signal
(`classify.ts:113-122`), relabeled the Show Details number "Signal agreement" instead of
"confidence" (`classify.ts:176-179`), and added the "Advisory — ... nothing is saved" detail
line to the toast itself (`classify.ts:161-170`). Facet 1 — the toast never reads a DR or
SPEC, only the git diff — is unchanged and is this spec's whole scope.

## One-Sentence Scope

When the diff being classified (staged or working-tree, whichever `analyzeGitDiff` actually
used) touches exactly one spec's `requirements.md` or one `docs/decisions/DR-NNN.md`, the
classify command reads that file's own authored `tier:` and reports the diff's predicted
tier **against it, by name** ("SPEC-128 is tagged T2; this diff reads T3" instead of "Current
changes → T2"); every other diff shape keeps today's message unchanged.

## Context — what the code does today

**The claim "it never loads a DR or SPEC" is confirmed.** `grep -rn reclassif
packages/minspec/src` returns nothing, and `classifyCommand` (`classify.ts:34-229`) calls
only `analyzeGitDiff` (`:71`, `:74`) and `buildConsequenceInput` (`:90`) — both read the git
diff's size and content, never a specs or decisions directory. Separately,
`findActiveSpec` (`packages/minspec/src/lib/active-spec.ts:17-64`) **does** load a spec's
`tier:` (via `summarizeActiveSpec`, `active-spec.ts:82-100`), but it is wired only into the
status bar (`extension.ts`) and the **Show Status** command — not into `classifyCommand` —
and it picks "the most likely active spec" by status heuristic over the whole specs
directory, not the spec a given diff actually touches, so it is the wrong tool for this: it
would bind an unrelated commit to whatever spec happens to be `implementing`.

**The ingredients `buildConsequenceInput` already has.** `classify.ts:90-93` already builds
a `ConsequenceInput` (`packages/minspec/src/lib/consequence-analyzers.ts:61-65`) whose
`changedFiles: ReadonlyArray<ChangedFile>` (`consequence-analyzers.ts:49-58`) carries each
changed file's `path` and its new `content`, read from the same git view `usedStaged`
selected (`git-analyzer.ts:303-306` builds it; `classify.ts:67-69` picks staged vs working
tree once and both the signals and the consequence input use that same choice, per SPEC-023
FR-7). So the new code this spec needs does not have to re-read the diff: it can filter
`consequenceInput.changedFiles` for paths matching a spec's `requirements.md` or a
`docs/decisions/DR-NNN.md`, and parse `tier:` out of the `content` already in hand.

**A spec's tier is already exposed; a DR's is not.** `parseSpec` (`packages/minspec/src/lib/
spec.ts:269`) returns `frontmatter.tier` for any spec file — `active-spec.ts:93` already
reads it this way. No equivalent public reader exists for a DR: `AdrSummary`
(`adr-manager.ts:27-35`) carries `id`, `title`, `status`, `date`, `filePath` and `epic`, but
not `tier`, and the module's own frontmatter parser (`parseFrontmatterYaml`,
`adr-manager.ts:69`) is a bare, unexported function. Reading a DR's `tier:` for this feature
needs either exporting that parser or adding a narrow `drTier(content)` reader beside it —
a small, contained addition, not a new parsing strategy.

**The caveat the issue itself names.** [DR-022](../../../docs/decisions/DR-022.md) proposed
moving `tier` from an authored scalar to a value **derived** from a risk profile's required
phases, but DR-022 is **`status: superseded`** — only the Fork-B *contract direction* was
accepted, in [DR-024](../../../docs/decisions/DR-024.md), and DR-024 itself gates the actual
reach/profile model on [#91](https://github.com/AIClarityAU/minspec/issues/91)
(unvalidated). So today, in the shipped code, `tier:` in a spec's or a DR's frontmatter is
still the **authored** scalar `parseSpec`/`TIERS` (`config.ts:5`, `:14`) already use
everywhere else (`active-spec.ts:93`, `classify.ts:104-122`). This spec compares against
that authored scalar — see [DQ-5](#dq-5-compare-against-the-authored-tier-or-the-not-yet-
shipped-phase-profile).

## Functional Requirements

"The artifact" means a spec's `requirements.md` or a `docs/decisions/DR-NNN.md` file. "The
diff" means the same changed-file set `classifyCommand` already computed for the run
(`usedStaged`-selected, `classify.ts:67-78`) — no second git read.

- **FR-1 — Detect a single touched artifact.** After `buildConsequenceInput` runs
  (`classify.ts:90`), a new pure function (in the module this spec's `implements:` names)
  MUST scan `consequenceInput.changedFiles` for paths matching `specs/**/requirements.md` or
  `docs/decisions/DR-*.md`, and return:
  - the one matching artifact, when **exactly one** matches (DQ-1, DQ-2);
  - `undefined` when zero match, or when more than one matches (DQ-2) — the existing
    artifact-blind path (FR-5) runs unchanged in both cases.

- **FR-2 — Read the artifact's own authored tier.** Given the one matched artifact, a reader
  MUST return its `tier:` and a display id (`SPEC-NNN` from frontmatter `id:`, or `DR-NNN`
  from the filename) using the **post-change** content already in `ChangedFile.content`
  (`consequence-analyzers.ts:55`) — not a fresh file read — so a diff that only just added
  `tier:` is read correctly. A spec reads through `parseSpec` (`spec.ts:269`); a DR reads
  through a new or newly-exported reader beside `adr-manager.ts:69` (DQ-1). A file with no
  parseable `tier:` (new, not-yet-filled-in template) is treated as "no match" (falls back
  to FR-5), not as an error.

- **FR-3 — Compare, and classify the direction.** Using `TIERS` (`config.ts:14`) for
  ordering, compare the artifact's authored tier to `predictedTier`
  (`classify.ts:104`, already computed before the headline is built) and classify the result
  as `higher` (diff reads above the artifact's tag), `same`, or `lower` (diff reads below
  it). No artifact tier is ever written or changed by this comparison (read-only; DQ-4).

- **FR-4 — The artifact-bound headline replaces the generic one for that run.** When FR-1
  found exactly one artifact, the headline built at `classify.ts:120-122` MUST instead name
  the artifact and the comparison from FR-3, keeping the existing driving-signal clause
  (`classify.ts:118-119`, kept from the already-shipped facet-2 fix) unchanged in form:
  - `higher`: `MinSpec: {id} is tagged {authoredTier}; this diff reads {predictedTier}{driverClause} — consider upgrading.`
  - `same`: `MinSpec: {id} ({authoredTier}) — this diff matches{driverClause}.`
  - `lower`: `MinSpec: {id} is tagged {authoredTier}; this diff reads {predictedTier}{driverClause}.`
    (no "upgrade"/"downgrade" verb — DR-021's ratchet is upward-only, and naming a
    *downgrade* here would read as the toast second-guessing a human's own tier choice,
    which no part of today's toast does; see DQ-3)
  The toast's existing detail line, actions (Show Details / Auto-classify / the T1 bump-up),
  dismiss behaviour, and the "Advisory — ...nothing is saved" wording
  (`classify.ts:161-170`) are **unchanged** by this spec — FR-4 only changes the headline
  string, not the toast's mechanics, so none of the already-shipped facet-2 fix is touched.

- **FR-5 — Everything else is the unaffected fallback.** When FR-1 finds no single artifact
  (zero touched, or more than one — DQ-2), `classifyCommand` MUST behave exactly as it does
  on `main` today: the `classify.ts:120-122` headline, byte-for-byte. This is the large
  majority of commits (anything not editing a spec's `requirements.md` or a DR file) and
  this spec changes nothing about them.

- **FR-6 — Auto (on-commit) path uses the same headline.** The passive status-bar line the
  already-shipped facet-3 fix shows (`classify.ts:128-131`) MUST use the same headline FR-4
  produces when an artifact is matched, and the unchanged one otherwise — one headline
  function, read by both the interactive toast and the status-bar line, so the two surfaces
  cannot read differently for the same diff (the shape `pickDrivingSignal` already has,
  `classify.ts:118`). The auto path gains no new buttons; FR-4 touches text only.

- **FR-7 — Show Details stays truthful about what it is showing.** The output channel
  (`classify.ts:172-190`) MUST keep reporting the diff's own signals and phases unchanged;
  when an artifact was matched, it additionally states the artifact's id and authored tier
  as a labeled line, so a user who opens it sees where the headline's comparison came from
  rather than having to trust the one-line toast.

## Acceptance Criteria

- [ ] Editing only `specs/minspec/SPEC-004-classifier-validation/requirements.md` (tier
      `T4` already) in a diff the classifier would size as `T2` produces the headline's
      `lower` form naming `SPEC-004` and both tiers. (FR-1–FR-4)
- [ ] A diff sized `T3` that edits only a DR file tagged `tier: T2` in its frontmatter
      produces the `higher` form naming that `DR-NNN` and "consider upgrading". (FR-1–FR-4)
- [ ] A diff that edits a spec's `requirements.md` AND an unrelated source file produces the
      artifact-bound headline for that spec — FR-1 matches on the artifact file being
      present, not on it being the only file in the diff. (FR-1)
- [ ] A diff touching two specs' `requirements.md` files, or a spec's and a DR's, produces
      today's unchanged generic headline (the DQ-2 fallback), not a guess at which one to
      name. (FR-1, FR-5)
- [ ] A diff touching no spec or DR file produces today's unchanged generic headline,
      byte-for-byte against `main`. (FR-5)
- [ ] The auto-on-commit status-bar line and the interactive toast's headline agree for the
      same diff shape (same artifact match, same comparison direction). (FR-6)
- [ ] A spec file with `tier:` missing or unparseable in the diff's new content is treated
      as no match (generic headline), not a crash or a blank id. (FR-2)
- [ ] Show Details, opened after an artifact-bound headline, names the same artifact id and
      tier the headline did. (FR-7)
- [ ] None of the already-shipped facet-2/3 behaviour regresses: the auto path still shows
      no buttons, the toast still carries the "Advisory — nothing is saved" detail, and
      "Signal agreement" (not "confidence") still labels the Show Details percentage.
      (FR-4, FR-6 — existing coverage re-run, not new)

## Invariants (must not break)

- **INV-1 — Offline core (constitution invariant 1, DR-004).** No network call. Every read
  this spec adds is a local file already in the working tree (via `ChangedFile.content`) or
  a local directory scan (FR-1's glob) — same offline posture `analyzeGitDiff` and
  `buildConsequenceInput` already have.
- **INV-2 — No silent gate (constitution invariant 2).** This spec adds no gate of any kind
  — the toast remains advisory-only, same as today (DR-021 Decision 2). A read that cannot
  parse an artifact degrades to FR-5's fallback, visibly the same message a non-artifact
  diff gets, never a crash and never a blank/garbled headline.
- **INV-3 — Read-only (new for this spec, see DQ-4).** Nothing this spec adds writes to a
  spec's or a DR's frontmatter, mints or invalidates an approval hash, or changes
  `.minspec/calibration.json`'s shape. The existing bump-up button's write
  (`classify.ts:191-206`) is untouched and unrelated.
- **INV-4 — DR-021's upward-only ratchet is unaffected.** `predictedTier`/`applyFloor`
  (`classify.ts:104`) and `classify()`'s max-over-signals ranking are not touched by this
  spec; FR-1–FR-7 only change what the *headline* says about a value that already exists.
- **INV-5 — No nagging (constitution principles 2 and 4, inherited from the facet-3 fix).**
  This spec adds no new toast, no new trigger, and no new frequency — it changes the text of
  a toast/status-bar line that already fires today, for the same diffs it already fires for.

## Decisions needed (Clarify)

Each question names the option this document assumes, and its cost, following this
repository's own convention (`SPEC-096` DQ format; DR-086 §2/§4 — under `"autonomy": "act"`
an agent proceeds on its stated recommendation and records what it did not take, since
nobody sees the rejected options live). Approving this spec as written ratifies the
recommended option in every row below; naming a different option changes only the
requirements that row cites.

### DQ-1 — How far does artifact detection reach?

**Recommended: Option A** — match only a spec's `requirements.md` or a
`docs/decisions/DR-NNN.md` file, read from `ChangedFile.content` already in hand.

- **Option A — direct-edit binding only (rec).** FR-1/FR-2 as written. *Cost:* a diff that
  changes only *code* a spec owns (via `implements:`/`affects:`) — the common "building
  SPEC-NNN" commit — still gets the generic headline; this spec does not make the toast say
  "this is SPEC-NNN's code." That is a materially bigger feature (a reverse index from
  changed-file path to the spec(s) that declare it under `implements:`/`affects:` —
  `scripts/hooks/spec-gate.py:382` parses those lists today, for a different gate, and
  nothing in `packages/minspec/src` currently inverts them into a lookup) and is better
  specified on its own once this narrower, already-well-grounded slice ships. Filed as a
  follow-up if wanted: **the human approving this spec should confirm whether to file it, or
  decline it as scope creep** — no issue number is invented here.
- **Option B — also bind via `implements:`/`affects:` ownership.** *Cost:* requires building
  and validating a new reverse index (not test-covered anywhere today), a tie-break policy
  when a changed file is claimed by more than one spec, and a decision about whether a stale
  `implements:` list (the spec says it owns a file the code no longer does) should be
  trusted. Meaningfully larger than FR-1–FR-7 above; risks under-delivering both halves in
  one build.

### DQ-2 — More than one artifact touched in the same diff

**Recommended: Option B** — fall back to today's generic headline; do not guess.

- **Option A — bind to all of them, listing each.** *Cost:* a longer, multi-line headline
  that reads worse as a one-line toast title than the current single-tier message, and a new
  decision about ordering when they disagree.
- **Option B — fall back to the unchanged generic message (rec).** FR-1/FR-5. *Cost:* a
  commit that edits a DR together with the spec it governs (plausible — drafting both in one
  pass) gets no artifact-bound message, same as any multi-file diff today. Not a regression;
  simply not improved by this spec.
- **Option C — bind to the first match in file-list order.** *Cost:* an order-dependent
  headline (which file `git diff` lists first, an implementation detail) silently picks a
  "winner" with no principle behind it — the kind of ungrounded heuristic facet 1 exists to
  remove, not add elsewhere.

### DQ-3 — Does a `lower` (over-tiered) comparison say anything prescriptive?

**Recommended: Option A** — report it, but with no "downgrade" verb or action.

- **Option A — informational only, no verb (rec).** FR-4's `lower` form. DR-021's ratchet is
  explicitly upward-only for the *predicted floor*; this spec keeps that stance for the
  *message* too — it never suggests a human lower an artifact's authored tier. *Cost:* a
  genuinely over-tiered DR/spec (tagged T4, edited by a one-line diff) gets a slightly odd
  "reads T1" line with nothing to do about it; harmless, but also not actionable.
- **Option B — omit the `lower` case entirely; only ever report `higher` or `same`.**
  *Cost:* silently drops information the issue's own framing ("grounded, actionable
  message") would consider useful context, for no honesty gain — FR-5's fallback already
  exists for every case this spec does not want to speak to, and `lower` is not ambiguous
  the way DQ-2's multi-artifact case is.

### DQ-4 — A one-click action to raise the artifact's own tier?

**Recommended: Option A** — none; stay read-only, exactly like every other part of today's
toast except the one existing bump-up button (which writes to the override log, not to any
artifact's frontmatter).

- **Option A — read-only message, no new button (rec).** INV-3. Raising a spec's or DR's
  `tier:` is an edit to a file that, once approved, carries a canonical approval hash
  (`packages/minspec/src/lib/approval.ts` — noted in `SPEC-096`'s own frontmatter-editing
  discipline); a toast button that edits it would either silently stale that approval or
  need to know whether one exists, neither of which this spec's narrow scope should decide
  in passing. *Cost:* a human who agrees with the suggestion still does the edit by hand,
  same as they would for any other spec/DR change today — not a new burden, just not a
  shortcut.
- **Option B — a button that writes the new tier into the artifact's frontmatter.**
  *Cost:* needs its own approval-staleness analysis (does it invalidate a hash? does it
  refuse on an approved file the way other mutating commands refuse pre-opt-in writes?) —
  a second spec's worth of work, and one this issue's own text never asked for (it asked for
  a better *message*, Context section, "a grounded, actionable message... is buildable" —
  about the words, not a new control).

### DQ-5 — Compare against the authored tier, or the not-yet-shipped phase-profile?

**Recommended: Option A** — the authored `tier:` scalar, as it exists in shipped code today.

- **Option A — authored tier (rec).** FR-2/FR-3 as written. [DR-022](../../../docs/decisions/DR-022.md)
  is `status: superseded`; only its Fork-B *contract direction* survives, in
  [DR-024](../../../docs/decisions/DR-024.md), itself gated on
  [#91](https://github.com/AIClarityAU/minspec/issues/91) and unbuilt. Comparing against a
  model that does not exist in the running extension would be speculative, not grounded —
  exactly what facet 1 is trying to stop doing. *Cost:* if/when #91 validates and DR-024's
  profile model ships, this comparison's *unit* changes from a tier letter to a required-
  phase set; FR-1/FR-2's artifact-lookup plumbing does not need to change, only what FR-3
  compares — a forward note for that future spec, not a blocker now.
  - **Option B — wait for the phase-profile model.** *Cost:* blocks this entire,
  already-scoped fix on unscheduled, unvalidated work (#91) with no date, over a caveat the
  issue itself only raised as a "watch for" note, not a requirement.

## Why no new DR

This changes what a toast's headline says and adds one small, pure, read-only reader; it
adds no store, no setting, no new kind of consent, and nothing it does survives a `git
revert` of this change (the DR-359 reversible-in-under-a-day filter). It does not touch
DR-021's ratchet, DR-022/024's superseded/gated model, or any approval mechanics (DQ-4
Option A keeps it read-only). A DR becomes necessary only if Plan or a later Clarify round
picks DQ-1 Option B (the `implements:`/`affects:` reverse index) or DQ-4 Option B (a
tier-writing button that touches approval hashes) — both are the options this document does
**not** recommend.

## Out of Scope

- **Ownership-based binding** (code owned by a spec via `implements:`/`affects:`, not the
  spec file itself). DQ-1.
- **A button that writes a new tier into a spec's or DR's frontmatter.** DQ-4.
- **The not-yet-shipped DR-022/024 phase-profile model.** DQ-5; tracked by #91, not this
  spec.
- **Epics.** `docs/epics/*.md` frontmatter carries no `tier:` field
  (`docs/epics/EPIC-004-classifier-validation.md:1-6`), so epics are not artifacts under
  FR-1's definition; nothing here adds one.
- **Anything about facets 2 or 3 of #216.** Already shipped (see Context); this spec adds no
  behaviour there and the Acceptance Criteria's last row exists only to confirm no
  regression.

## Alternatives considered and rejected

Recorded because this spec was written without a live conversation (DR-086 §4).

- **Reusing `findActiveSpec`/`summarizeActiveSpec` directly.** Rejected: it resolves "the
  most likely active spec in the whole project" by a status heuristic, not "the spec this
  diff touches" — it would bind an unrelated commit (e.g. a typo fix in an unrelated file)
  to whatever spec happens to be `implementing`, which is a different and less honest claim
  than the one facet 1 asks for.
- **Feeding the comparison into `classify()` as a new signal.** Rejected: `classify()`'s
  max-over-`tierContribution` ranking (DR-021) decides the *predicted floor itself*; an
  artifact's authored tier is not evidence about the diff's mechanical scope, it is a
  *comparison target* for the message. Mixing the two would let an old, stale `tier:` on an
  unrelated DR silently raise the floor of an unrelated diff — a new, unintended coupling.
- **Always naming the artifact even when it is not the only file changed, by majority diff
  size.** Rejected in favor of DQ-1 Option A's simpler "any match, read-only" rule: a
  size-based tie-break is itself an ungrounded heuristic, the exact shape facet 1 exists to
  remove.

## Test plan (for the Plan phase to place)

- **Unit, pure function:** FR-1's matcher and FR-2's readers, given synthetic
  `ConsequenceInput.changedFiles`, with cases: zero matches, one spec match, one DR match,
  two matches (either combination), a match with missing/unparseable `tier:`.
- **Integration, `classifyCommand`:** each Acceptance Criteria row, using the same harness
  pattern `commands.test.ts` already has for `classifyCommand` (staged and working-tree
  fixtures), asserting on the exact headline string and on the Show Details channel content
  for FR-7.
- **Not vacuous:** each Acceptance Criteria row's mutant (remove the artifact match, remove
  the comparison, swap `higher`/`lower`) is shown to turn the corresponding test red, with a
  clean control run.
- **Regression:** the existing facet-2/3 tests (status-bar-only auto path, no-buttons
  assertion, "Signal agreement" wording, "Advisory" detail line) re-run unchanged and green.

## Traceability

- **Issue:** [#216](https://github.com/AIClarityAU/minspec/issues/216) — facet 1 only.
- **Already resolved by this issue:** facet 2 (apes an approval) and facet 3 (noise on
  auto-commit), both by commit `22563da7`, pull request #333.
- **Governing decisions:** [DR-021](../../../docs/decisions/DR-021.md) (the upward-only
  ratchet this spec does not touch), [DR-022](../../../docs/decisions/DR-022.md)
  (superseded — the phase-profile caveat DQ-5 answers), [DR-024](../../../docs/decisions/DR-024.md)
  (the surviving Fork-B direction, gated on #91).
- **Specs this touches:** [SPEC-004](../SPEC-004-classifier-validation/requirements.md) (the
  κ=0.80 diff-size validation this spec's comparison sits beside, unchanged),
  [SPEC-023](../SPEC-023-consequence-screen/requirements.md) (owns `buildConsequenceInput`
  and the staged/working-tree view selection this spec reuses, per its FR-7).
- **DR for this spec:** none, by design; see "Why no new DR" for the two conditions that
  would require one.
