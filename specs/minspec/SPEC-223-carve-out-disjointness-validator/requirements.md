---
id: SPEC-223
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - DR-066's domain (no silent gate); the carve-out filter sits in front of the invariant-2 second witness
aspects: [machinery, carve-out, dispatch, auto-merge-withhold, no-silent-gate, validator-asymmetry]
depends_on: [DR-066, DR-061]  # DR-066: no silent gate / independent second witness; DR-061: the native auto-merge whose arming the withhold set refuses
relates_to: ["#2026", "#2018", "#2024", "#1758", "#1264", "#981", "#833", SPEC-039]
implements: none
implements_reason: >-
  A hardening of two existing files (machinery-paths.ts and its carve-out test) that no
  spec owns; owning machinery-paths.ts from a hardening spec would freeze the canonical
  machinery set for every other change to it.
affects: [packages/minspec/src/lib/machinery-paths.ts, packages/minspec/tests/machinery-carve-outs.test.ts]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-223: Carve-out disjointness becomes a validator refusal, not only a test loop

Triggered by: #2026 (raised as `low` by the security voter on #2024; the carve-out
mechanism itself is #2018). No DR - see "Why no new DR".

## In plain terms

Two files under `scripts/` are exempt from the "machinery" classification (the carve-outs:
`scripts/facts.ts`, `scripts/review-churn-report.sh`). In `scripts/dispatch-issue.sh` the
exemption is applied once, before a single combined check that also covers three other
reasons a human must own a merge (docs, governance config, publishing). So a carved path is
exempt from all four reasons, not just machinery. That is only safe while no carve-out is
also a docs, governance or publishing path.

A test already checks that today. The issue asks whether that check should also live in the
carve-out validator function, next to the four checks that are already there. This spec
says yes, in the cheapest form that does not move any pattern out of the file that owns it,
and leaves the final choice of form to the human (see Decisions needed).

## One-Sentence Scope

Add a pure, parameterised disjointness refusal to `machinery-paths.ts` and make the existing
DISJOINTNESS test block call it, with negative tests proving it refuses, without moving any
withhold pattern out of the file that owns it today.

## Context - what the code does today (read from this worktree, base 6df91ac4)

- **The exposed call site.** `scripts/dispatch-issue.sh:389-391`, `paths_have_approvable_doc`,
  runs one `grep -qE` over
  `DOCS_CORPUS_RE | ^\.minspec/ | ^\.cursorrules$ | PUBLISH_PATH_RE | MACHINERY_PATH_RE`,
  reading from `machinery_carve_out_filter` (`:320-334`). A carved path therefore cannot match
  any of the five alternatives.
- **The other call sites are not exposed.** `:480`/`:483` and `:1513-1517` test each mandate
  in a separate `grep`, and only the machinery `grep` reads the filtered list. The ai-review
  workflow filters into its own `MACHINERY_CANDIDATES` variable, used only by the machinery
  guard (`.github/workflows/ai-review.yml`, about line 575). So `paths_have_approvable_doc` is
  the only place disjointness carries weight.
- **The overlap is real.** `PUBLISH_PATH_RE` (`dispatch-issue.sh:266`) contains
  `^\.github/workflows/deploy-sites\.yml$`, which is also under the `.github/` machinery
  prefix.
- **Where the three other mandate patterns live:**
  - `DOCS_CORPUS_RE` is in `scripts/lib/docs-corpus.sh:26`. It **already has a TypeScript
    original**: `DOCS_CORPUS_REGEX` in `packages/minspec/src/lib/docs-corpus.ts:55`. That
    module imports nothing (Tier-0 pure, `:16`). The shell copy is pinned to it by
    `dispatch-automerge-doc-exclusion.test.ts`.
  - `PUBLISH_PATH_RE` is defined only in `dispatch-issue.sh:266`, pinned to
    `deploy-sites.yml` by `dispatch-automerge-publish-exclusion.test.ts`. It has no
    TypeScript copy.
  - The governance arm `^\.minspec/|^\.cursorrules$` is an inline literal, written twice in
    `dispatch-issue.sh` (`:390`, `:1513`) and once in the test (`machinery-carve-outs.test.ts:351`).
- **The validator.** `assertCarveOutsWellFormed()` (`machinery-paths.ts`) refuses an empty
  list, malformed paths, duplicates, overlap with `MACHINERY_SINGLE_FILES`, and paths outside
  every `MACHINERY_DIR_PREFIXES` prefix. It does not check disjointness.
- **The test.** `machinery-carve-outs.test.ts:342-375` parses `DOCS_CORPUS_RE` and
  `PUBLISH_PATH_RE` out of the shell files, hard-codes the governance arm, checks that each
  parsed pattern is non-empty, includes a control proving `PUBLISH_PATH_RE` matches a
  `.github/` path, and asserts that no real carve-out matches any of them.

### The finding that reframes the issue

`assertCarveOutsWellFormed()` and `buildMachineryCarveOutRegexSource()` have **no
production caller**. Grepping the `.ts/.js/.yml/.sh` sources for both names finds only
`machinery-carve-outs.test.ts` (`:189`, `:210`, `:380`, `:494-519`, `:557`).
`scripts/auto-merge-gate.ts:52-56` imports only the three arrays. Both shell consumers carry
hand-copies of the pattern and run no TypeScript. So the four existing refusals are also
enforced only when the test suite runs. "Refused at generation time, not test time" is not a
stronger enforcement point here: generation happens inside the test.

The real asymmetry is smaller than the issue says, and it is about *form*:

1. The four existing refusals live in a pure function that takes the list as a parameter.
   Each refusal has a negative test that feeds it a violating list (`:494-519`), so each one
   is proven to fire.
2. The disjointness check exists only as a loop over the **real** list. No test feeds it a
   violating carve-out, so nothing proves it fires. The `PUBLISH_PATH_RE` control proves the
   *pattern* matches a `.github/` path. It does not prove the *assertion* would flag a carved
   path. A refactor that, for example, iterated an empty mandate list would pass the loop and
   go unnoticed. The non-empty check at `:354-362` covers each entry but not the length of the
   list itself.

This spec closes (1)/(2) for disjointness without the ownership change the issue's
recommended option costs.

## Functional Requirements

- **FR-1 - pure disjointness refusal.** `machinery-paths.ts` exports a pure function. Its
  default form is `assertCarveOutsDisjoint(carveOuts, mandates)`. `mandates` is a non-empty
  list of `{ name: string; source: string }`, where `source` is a POSIX-ERE pattern source.
  The function throws if any carve-out matches any mandate. The error names the carve-out, the
  mandate, and why it matters: the carve-out filter runs before `paths_have_approvable_doc`'s
  combined `grep`, so a match would silently exempt the path from that mandate as well. The
  function imports nothing new, which keeps the module dependency-free (stated in its header
  and on `isMachineryPath`).
- **FR-2 - fails closed on a vacuous call.** The function throws, and does not pass, when:
  `mandates` is empty; any `source` is empty or only whitespace; or a `source` does not
  compile as a JavaScript `RegExp`. A disjointness check against zero patterns or an
  unparseable pattern proves nothing, so it must not report clean (constitution invariant 2).
- **FR-3 - the test wires the real patterns into it.** The DISJOINTNESS block of
  `machinery-carve-outs.test.ts` calls FR-1 with the real `MACHINERY_CARVE_OUTS` and with the
  mandate sources it already reads from the files that own them: `DOCS_CORPUS_RE` parsed from
  `scripts/lib/docs-corpus.sh`, `PUBLISH_PATH_RE` parsed from `scripts/dispatch-issue.sh`, and
  the governance arm. No pattern moves. Each shell file stays the owner of what it owns today.
  The existing parse-not-empty check and the `PUBLISH_PATH_RE` control stay in place.
- **FR-4 - the mandate list is pinned by count.** The test asserts it passes exactly three
  mandates, named `DOCS_CORPUS_RE`, `PUBLISH_PATH_RE` and `governance`. Dropping one from the
  call then fails visibly instead of narrowing the check.
- **FR-5 - negative tests prove each refusal fires.** Using `.github/workflows/deploy-sites.yml`
  as the carve-out (under a machinery prefix, matches `PUBLISH_PATH_RE`), FR-1 throws and the
  message names `PUBLISH_PATH_RE`. One negative case per FR-2 condition, each asserting its own
  message, so a throw for the wrong reason does not count. One positive case: a disjoint
  carve-out with all three mandates passes.
- **FR-6 - the governance arm is checked for drift.** The governance literal the test passes
  must be checked against `dispatch-issue.sh:390`, either by parsing it from that line or by
  asserting the line contains it verbatim. Otherwise, if `dispatch-issue.sh` widens that arm
  (say to a new governance file), the disjointness check silently stays on the old set. This is
  the same hand-copy drift #1758 diagnosed, in the one pattern that currently has no pin.
- **FR-7 - comments say where the check lives.** `assertCarveOutsWellFormed`'s doc comment and
  the `MACHINERY_CARVE_OUTS` "CONSTRAINTS every entry must satisfy" list (`machinery-paths.ts`)
  name disjointness as a constraint, enforced by `assertCarveOutsDisjoint`, called from the
  carve-out test with patterns read from their owning shell files. They also say why it is a
  separate function: the patterns are bash, owned elsewhere, and `machinery-paths.ts` stays
  dependency-free. The comment at `dispatch-issue.sh:379-388` stays accurate unchanged, because
  it already points at the test file. It is deliberately not edited, which keeps this change
  off a second machinery file.

## Acceptance Criteria

- **AC-1** - `assertCarveOutsDisjoint(['.github/workflows/deploy-sites.yml'], [{name:'PUBLISH_PATH_RE', source: <real PUBLISH_PATH_RE>}])`
  throws, and the message contains both the path and `PUBLISH_PATH_RE`.
- **AC-2** - `assertCarveOutsDisjoint(MACHINERY_CARVE_OUTS, [])` throws, and the message says
  the mandate list is empty. An empty-`source` mandate throws, and so does an
  uncompilable-`source` mandate, each with its own message.
- **AC-3** - With today's real list and the three real patterns, the call does not throw. This
  is the existing invariant, now asserted through the validator.
- **AC-4 (mutation)** - Dropping one mandate from the call, or making FR-1 return early, turns
  the suite red. The Plan phase says how this is shown, either by a mutation run or by the
  FR-4 count assertion plus the FR-5 negatives.
- **AC-5** - Widening the governance arm at `dispatch-issue.sh:390` without updating the test
  turns the suite red (FR-6).
- **AC-6** - `git diff --name-only` for the implementing PR lists only the two files in
  `affects:`.
- **AC-7** - `npm test`, `npm run lint` and `npm run validate` pass. Because CI runs
  `npx vitest` rather than `npm test`, the new tests must sit in a file CI already runs. The
  existing `machinery-carve-outs.test.ts` does.

## Invariants (must not break)

- **INV-1 (behaviour unchanged).** No shell file changes. `MACHINERY_PATH_RE`,
  `MACHINERY_CARVE_OUT_RE`, `PUBLISH_PATH_RE`, `DOCS_CORPUS_RE`, the governance arm, and
  `machinery_carve_out_filter`'s fail-closed branches are byte-identical before and after.
  Dispatch withholds exactly the same changed-sets.
- **INV-2 (no silent gate, constitution invariant 2).** Every new check fails closed and
  visibly. It never reports clean on an empty or unparseable input (FR-2, FR-4).
- **INV-3 (single canonical machinery set, #1758).** No new copy of `MACHINERY_PATH_RE` or of
  the carve-out pattern is introduced anywhere.
- **INV-4 (module purity).** `machinery-paths.ts` gains no import. It stays dependency-free
  for `scripts/auto-merge-gate.ts`, which imports it.
- **INV-5 (blast radius, constitution invariant 3).** Nothing scaffolded into an adopter
  changes. In an adopter, `ai-review.yml`'s carve-out pattern is empty (`ai-review.yml`, about
  line 565), and that file is not touched.
- **INV-6 (offline, constitution invariant 1).** No network access. Pure functions and local
  file reads only.

## Decisions needed (Clarify)

All 2 decisions are answered, not ratified: an agent session selected on 2026-10-25, for each, the option this document already recommended. No human chose them, and no delegation covers authoring Clarify answers. Delegation DLG-001 (DR-108) made none of these selections and covers spec approval and engineering-DR acceptance only. An agent-recorded selection carries no consent, whoever prompted it. It is ratified only by approval of this spec, the founder's or the bot's under DLG-001, and that approval may overturn it.

**DQ-1 - which form closes the asymmetry.** Every option edits `machinery-paths.ts`, which is
listed in `MACHINERY_SINGLE_FILES`. So every option, including the doc-only one, is a
machinery PR that a human must merge (ai-review gives it no SHA-bound pass). That cost is the
same across the options and does not decide between them.

**Recorded selection: Option (a),** the spec's reason is that it makes the check proven and drift-pinned with negative tests without touching live gate files.

- **(a) A pure validator function, patterns stay where they are (rec).** FR-1 to FR-7 as
  written. The disjointness check becomes a parameterised refusal with negative tests, like
  the other four checks, and the governance arm gets its first drift pin.
  *Cost:* the enforcement point is unchanged. It is still the merge-gating test suite,
  because the validator has no production caller (see "The finding that reframes the
  issue"). This option makes the check proven and drift-pinned. It does not move it earlier.
  It also adds an exported function and about 40 lines of test.
- **(b) The issue's recommended option: move the three patterns into TypeScript, shell
  copies pinned to them.** Bash cannot source a TypeScript module, so in practice the shell
  copies become hand-copies pinned by tests, the pattern #1758 uses for the machinery
  regex. `DOCS_CORPUS_RE` already works this way, so the real move is `PUBLISH_PATH_RE` and
  the governance arm.
  *Cost:* `PUBLISH_PATH_RE` would gain a second definition (TypeScript, plus the pinned bash
  copy). It is already pinned on the other side to `deploy-sites.yml`, so it would carry two
  lock-step tests. The change touches `dispatch-issue.sh`, a live gate, plus at least two more
  files. It gains no enforcement point over (a), for the same no-production-caller reason.
- **(c) Doc comment only.** Write down that disjointness is deliberately test-enforced and why.
  *Cost:* it leaves the check with no negative test (nothing proves it fires) and leaves the
  governance arm unpinned. Those are the two concrete gaps the analysis above found.

Under the session's `act` autonomy, the recommendation (a) stands unless the human picks
otherwise. Approving this spec ratifies (a).

**DQ-2 - give the validator a production caller?** None of the five refusals runs outside
tests today. One option: a build-time step, or a tiny `scripts/` check run in CI, that calls
`buildMachineryCarveOutRegexSource()` and `assertCarveOutsDisjoint()`. That would make
"generation time" real.
- **Leave it out of this spec (rec).** *Cost:* the whole validator stays test-enforced, which
  is the repo's normal level for a cross-language invariant (the hand-copy pins work the same
  way). A new CI step would be a second machinery change, widening this past #2026's scope
  (triage rule 2). If wanted, it goes in a separate issue.
  **Recorded selection: Option Leave it out of this spec,** the spec's reason is that test enforcement is the repo's normal level for a cross-language invariant and a new CI step would widen scope.

## Limitations, stated plainly

- After this change, a carve-out that breaks disjointness still fails the **test suite**,
  not dispatch at runtime. That was already true of all four existing refusals.
- FR-6 pins the governance literal at `dispatch-issue.sh:390` only. The copy at `:1513` feeds
  a per-mandate `grep` that never sees the filtered list, so its disjointness does not matter.
  Whether `:390` and `:1513` drift apart from each other is a separate consistency question,
  and this spec does not address it.

## Why no new DR

Every option above can be undone in under a day: one exported function and its tests, or a
comment. No pattern changes owner under (a). The ADR filter (a DR only for a choice that cannot be
undone in under a day; it lives in the parent register, not this repo's) is not met. Checked
`docs/decisions/INDEX.md`: no decision covers carve-out disjointness. #2018 introduced the
carve-outs without a DR, and DR-066 already states the fail-closed rule this spec applies.

## Out of Scope

- Changing any withhold pattern, the carve-out list, or `machinery_carve_out_filter`.
- Restructuring `paths_have_approvable_doc` into per-mandate filtering. That would bring back
  a second copy of the machinery alternation, the #1758 drift that its comment
  (`dispatch-issue.sh:386-388`) rules out.
- DQ-2's production caller.
- De-duplicating the governance arm between `dispatch-issue.sh:390` and `:1513`.

## Alternatives considered and rejected

- **(b) and (c) of DQ-1.** Rejected in favour of (a), for the costs stated there.
- **Making `assertCarveOutsWellFormed` itself import `DOCS_CORPUS_REGEX` from
  `docs-corpus.ts`.** Rejected. It would break INV-4 (the module's dependency-free promise)
  and would still cover only one of the three mandates.
- **Reading the shell files from inside `machinery-paths.ts`.** Rejected. That is filesystem
  input in a module documented as "pure - it checks the SHAPE of the list, never the
  filesystem", and it would put `fs` into a module that `auto-merge-gate.ts` imports.

## Test plan (for the Plan phase to place)

All in `packages/minspec/tests/machinery-carve-outs.test.ts`, block 4 (DISJOINTNESS):
FR-3 wiring, FR-4 count pin, FR-5 negatives (one per refusal, message-matched) and the
positive control, FR-6 governance-literal pin. The existing per-pair loop may stay as a
readable second view, or be replaced by the validator call. Plan decides; INV-2 holds either
way.

## Traceability

- Issue: #2026. Origin: security-voter note on #2024. Mechanism under test: #2018.
- Rules applied: DR-066 (no silent gate), #1758 (one canonical machinery set, hand-copies
  pinned).
- Follow-ups: none filed. DQ-2, if the human wants it, becomes its own issue.
