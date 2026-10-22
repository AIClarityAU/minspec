---
id: SPEC-211
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - what the harness ships into an adopter must arrive with the evidence its own comments cite
aspects: [harness, parity, ai-review, evidence-discipline, test-coverage, no-silent-gate, tier-0, offline]
depends_on: [DR-097, DR-066]  # DR-097 defines the voter-reuse functions whose tests move; DR-066 is the fail-closed rule the new gate follows
relates_to: [SPEC-043, "#2371", "#2163", "#2142", "#2165", "#2059", "#1941", "#2897", "#871", "#2164"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3; the
# shipped `/minspec-specify` guidance). This spec creates no new source file: the new gate
# (FR-5, FR-6) lives inside the existing shipped suite, which no spec owns today (parsed
# across every `implements:` line in specs/ at origin/main f3850fde).
implements: none
implements_reason: >-
  Every change lands in existing files no spec owns, and the two new gates must live inside
  the shipped suite itself so they travel to adopters with it; owning a shared, parity-managed
  file from a defect spec would freeze it for every other change to the guard.
# Modified, not owned. The guard changes in comments only (INV-1). ci-review-templates.ts is
# generated (FR-7) and is never hand-edited. template-registry.ts changes in one comment
# only: the shipped suite's runtime sibling list (task 5.1). The two vitest files are deleted under DQ-1
# option (a); choosing option (b) removes them from this list.
affects: [.github/scripts/ai-review-guard.js, .github/scripts/ai-review-guard.test.js, packages/minspec/src/lib/ci-review-templates.ts, packages/minspec/src/lib/template-registry.ts, packages/minspec/tests/voter-survivor-reuse.test.ts, packages/minspec/tests/review-protocol-tokens.test.ts]
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: pending
---

# SPEC-211: The ai-review guard ships with the tests its comments cite, and a gate keeps it that way

## In plain terms

MinSpec copies its ai-review guard (`.github/scripts/ai-review-guard.js`) and that guard's
test file into every repo that adopts it. #2163 added four functions to the guard but put
their tests in a MinSpec-only file that is not copied. So every adopter's harness-refresh
pull request now carries four exported functions with no visible test, under comments that
say tests prove them, and the ai-review panel blocks it (AIClarityAU/memory-fabric #40,
AIClarityAU/voip-sms-inbox #121, sealbox). An adopter cannot fix that honestly: the files
are managed and the next refresh overwrites any hand edit.

This spec moves those tests into the shipped test file, rewrites the four guard comments
that cite tests an adopter cannot see, and adds two checks to the shipped test file: every
function the guard exports must be used by the shipped tests, and every test the guard's
comments cite by name must exist there. Guard behaviour does not change. Cost: the shipped
test file grows by about 45 cases, one known gap (`parseCliVerdict`, #1941) is listed in a
visible exemption instead of being fixed here, and adopters see the fix only after their
next refresh from a rebuilt extension. Riskiest assumption: that "the name appears in the test code" is a good
enough proxy for "the function is tested" (see Limitations).

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. A human reads
> it, checks the one question under **[Clarify selections](#clarify-selections-recorded-by-an-agent-2026-10-18-ratified-only-by-approval-of-this-spec)**,
> and approves it through the normal spec-approval gate before any code changes. Every
> requirement is written under the recommended answer, so approving the spec as it stands
> accepts that answer. Choosing the other option changes only FR-3 and the `affects:` list.

Materializes **[#2371](https://github.com/AIClarityAU/minspec/issues/2371)** - *"harness
refresh ships voter-reuse code into adopters without its tests, so every adopter's refresh
PR is blocked at ai-review:changes."* The issue offers three directions. This spec takes
(a), port the tests into the shipped suite, plus the harness-parity check the issue
suggests. Direction (b), withholding the functions from adopters until #2165 wires them, and
(c), rewording the comments only, are under Alternatives.

**Id note.** `SPEC-211` is the highest claimed id plus one. Claimed ids were read on
2026-10-18 across `origin/main` at `f3850fde` (highest on disk: 134), the files of all open
pull requests (highest: 210, #2892), every remote-tracking branch (highest: 210), every
local branch of the primary checkout, and every worktree under
`~/code/.worktrees/MinSpecPro/` (none above 210). If the id collides at review time,
renumber.

**Tier note.** Triage recorded T3 (full spec cycle). Mechanical scope: five existing files
changed or deleted plus one generated file, under the classifier's 15-file mark for T4
(`packages/minspec/src/lib/git-analyzer.ts:34-39`). It touches `.github/`, so the pull
request is machinery and merges by human `--admin`.

## One-Sentence Scope

Make the shipped `ai-review-guard.test.js` carry the behavioural tests for every function
the shipped `ai-review-guard.js` exports and every test the guard's comments cite, and add
two checks inside that suite that fail when either stops being true.

## Context - what the code does today (read from `origin/main` f3850fde, not inferred)

### Root cause

**Root cause:** #2163 added `selectVotersToRun`, `renderVoterRecord`, `parseVoterRecords`
and `isStructuralVerdictBlock` to the parity-managed guard and placed their tests in
`packages/minspec/tests/voter-survivor-reuse.test.ts` and
`packages/minspec/tests/review-protocol-tokens.test.ts`, which are vitest files the harness
does not ship. **Missing gate:** #871 made the guard and its test file one parity-managed
unit (`packages/minspec/tests/ai-review-guard-test-parity.test.ts`), but that gate checks
that the test FILE ships and passes. Nothing checks that the shipped suite covers what the
guard exports, or that a test named in a guard comment is in the shipped suite. The gate is
asymmetric in exactly the SPEC-004 way: it validates the file that exists and never asserts
the coverage that should exist.

### Measured

The bullets down to the re-measurement bullet were measured at `origin/main` `f3850fde`,
when this spec was written; each carries that prefix. The re-measurement bullet gives the
numbers at `23a58c2f`, which FR-5a and the acceptance criteria are written against.

- At `f3850fde`: the guard exports 62 names: 41 functions and 21 constants
  (`.github/scripts/ai-review-guard.js:1960-2023`, counted with `Object.keys(require(...))`
  and `typeof`).
- At `f3850fde`: 9 of the 41 functions did not appear in the shipped suite outside comments:
  `selectVotersToRun`, `renderVoterRecord`, `parseVoterRecords`, `isStructuralVerdictBlock`
  (the #2163 four), `renderVerdictBlock`, `defangProtocolTokens`, `parseCliVerdict`,
  `isQuotaExhaustionStrict`, `wholeCheckRunListing`. The same nine, and only those, fail
  FR-5's stricter "used" test (a call or member access after comments and string literals
  are stripped; re-measured 2026-10-18 by the independent approver), so the T0 red count
  held under either reading. 6 constants were likewise absent:
  `VOTER_RECORD_PREFIX`, `VERDICT_END_TOKEN`, `UNAVAILABLE_TOKEN`, `ROUND_RECORD_PREFIX`,
  `VERDICT_SCHEMA`, `PENDING`.
- `voter-survivor-reuse.test.ts` holds 32 cases in three groups (round-trip, 5;
  `selectVotersToRun`, 15; structural verdict, 12). `review-protocol-tokens.test.ts` holds 3
  fixed cases plus one generated case per (site, token) pair: 10 pairs over
  `scripts/review-decide.sh`, `scripts/review-branch.sh`, `.github/workflows/ai-review.yml`
  and the guard itself. All three sibling files are themselves shipped generator sources
  (`scripts/gen-ci-templates.mjs` `CI_TEMPLATE_SOURCE_PATHS`).
- At `f3850fde`: the shipped suite passed 185 of 185 under `node --test` (190 of 190 at
  `23a58c2f`, below). It runs in CI on every pull
  request with no path filter (`.github/workflows/ci.yml:113`, job `lint`). Under `npm test`
  it runs too, as a scaffolded copy, through
  `packages/minspec/tests/ai-review-guard-test-parity.test.ts:214`. Moving a case from
  vitest into the shipped suite therefore keeps it in both local and CI runs.
- The suite already reads sibling shipped files at run time (its `ai-review.yml` and
  `docs-lane.yml` cases; parity test comment at `:216-218`), so a ported token pin that
  reads siblings follows an existing pattern.
- Guard comments that cite a test an adopter cannot find in the shipped suite:

  | Line | Text (abridged) | What it cites |
  |---|---|---|
  | 504-507 | "a cross-file test can pin them ... the test is (#2163 review)" | `review-protocol-tokens.test.ts` (vitest) |
  | 636-637 | "the diff's own test reused across two SHAs and proved it" | a pre-merge version of `voter-survivor-reuse.test.ts` |
  | 652-653 | "the test asserting recency passed only because the fixture happened to be ordered" | same |
  | 836 | "a test pins it to what review-branch.sh reads" | `packages/minspec/tests/ai-review-verdict-carry-glue.test.ts` (vitest, git-fixture integration) |

  Every other comment in the guard that mentions a test either names
  `ai-review-guard.test.js` (lines 6-9, 241-242) or describes a function the shipped suite
  does exercise (lines 310, 363, 452, 1200, 1860). Line 694's "(#2163 review)" cites a
  review finding, not a test.
- `parseCliVerdict`, `defangProtocolTokens`, `renderVerdictBlock` and `VERDICT_SCHEMA` are
  the subject of #1941 (port 38 tests salvaged in scroogellm#160). At `f3850fde`,
  `isQuotaExhaustionStrict` and `wholeCheckRunListing` had no tracking item; #2897 was
  filed for them while writing this spec, and #2901 closed it.
- **Re-measured at `origin/main` `23a58c2f` (2026-10-18, Plan phase), after #2901 merged.**
  #2901 (closing #2897) added shipped cases for `isQuotaExhaustionStrict` and
  `wholeCheckRunListing`, so the suite now passes 190 of 190 and 7 of the 41 function
  exports are unused under FR-5's reading: the #2163 four, `renderVerdictBlock`,
  `defangProtocolTokens` and `parseCliVerdict`. The FR-5a list and the acceptance criteria
  below are written against this re-measurement; the paragraphs above keep the
  `f3850fde` numbers they were written from.
- The embedded copies adopters receive are generated:
  `node scripts/gen-ci-templates.mjs` writes `packages/minspec/src/lib/ci-review-templates.ts`
  (`AI_REVIEW_GUARD_JS`, `AI_REVIEW_GUARD_TEST_JS`), and Rule 12 of
  `scripts/validate-frontmatter.ts:593-665` fails `npm run validate` when they are stale.
  `template-registry.ts:2709` and `:2733` only reference those constants; there is no second
  copy.

## Functional Requirements

- **FR-1 - Voter-reuse behaviour is tested in the shipped suite.** Every case in
  `voter-survivor-reuse.test.ts` gets a counterpart in `.github/scripts/ai-review-guard.test.js`
  that makes the same assertion, written with `node:test` and `node:assert/strict`. Each
  ported title starts with the function under test and a colon, matching the suite's
  existing convention (`parseAllowlist: ...`), followed by the vitest title. At minimum one
  named case exists for each guard rail:
  1. a voter that emitted nothing is never a survivor;
  2. reuse copies the verdict verbatim and never upgrades `changes` or `blocked` to `pass`;
  3. an unattested or off-allowlist record is ignored, an empty allowlist reuses nothing and
     says why in `notes`, and a check-run not named `ai-review` is ignored;
  4. a record whose digest does not match its payload is ignored;
  5. no patch fingerprint means no reuse;
  6. `headSha` is required, and a record from a different head SHA is never reused, same
     patch or not;
  7. among records on the same head the most recent by timestamp wins, and reversing the
     input order gives the same answer.

  Plus: `renderVoterRecord` / `parseVoterRecords` round-trip (verbatim block; block with
  blank lines and markdown fences; whitespace-only payload refused; empty block or invalid
  role renders `''`), and `isStructuralVerdictBlock` accepting what `renderVerdictBlock`
  produces for both verdicts and an indented block with findings, and rejecting the
  fail-closed placeholder, an UNAVAILABLE marker (alone or inside a well-formed block), two
  BEGIN markers, an unterminated block, END before BEGIN, a marker mentioned only in prose, two
  BEGINs sharing one END, one BEGIN with two ENDs, and a prose-only BEGIN paired with a real
  END.
- **FR-2 - The protocol-token pin is in the shipped suite.** The cases of
  `review-protocol-tokens.test.ts` are ported the same way: the token-shape case, one case
  per (site, token) pair over the four sites it lists, and the two `defangProtocolTokens`
  cases. Each (site, token) case has a literal title naming its site and token, never a
  templated one, because FR-6 resolves citations against literal titles only and FR-4
  cites these cases. Sibling files are read relative to the suite's own location. A sibling that cannot
  be read fails its case and names the path (constitution invariant 2); it is never skipped.
- **FR-3 - No duplicate copies (DQ-1, option a).** Once every case of a vitest file has a
  shipped counterpart, that vitest file is deleted. The pull request body carries the
  mapping, one line per deleted vitest title to its shipped title. DR-097's two citations of
  `voter-survivor-reuse.test.ts` (its claims table and its root-cause paragraph) are
  repointed to the shipped suite, keeping the original `#2163 @ <sha>` commit addresses,
  which stay true. No other wording in DR-097 changes.
- **FR-4 - Guard comments cite only tests a reader of the shipped files can find.** The four
  comments in the Measured table are rewritten. A comment that cites a test does so in one
  fixed form, `ai-review-guard.test.js: "<exact test title>"`. Lines 504-507 claim a
  cross-file pin, so they cite the ported per-(site, token) cases that read the sibling
  files, never the token-shape case, which checks shape only and reads no other file. Lines 636-637 and 652-653 keep their history (that the first version was wrong
  and three voters caught it) and cite the ported cross-SHA and recency cases as what now
  pins the fix. Line 836 stops claiming that a shipped test checks what `review-branch.sh`
  reads, because none does; it may cite the existing shipped case that pins which scripts
  are in the panel key (`#1688 panel key: an unreadable or incomplete listing yields NO key,
  so nothing carries`), and states the narrower thing that case proves. No comment in the
  guard claims a test that is not in the shipped suite.
- **FR-5 - Export-reference gate.** The shipped suite contains a case that loads the guard,
  takes every export whose value is a function, and fails unless each name is USED in the
  suite's own source: a whole-word occurrence immediately followed by `(` (a call) or
  immediately preceded by `.` (member access, e.g. `guard.name`), counted only after
  comments, string and template literals, and the exemption declaration are removed. An
  occurrence that is only an import - a name in the `const { ... } = require(...)`
  destructuring list - or only text inside a test title does not count, so adding a name to
  the import list or to a title cannot satisfy the gate. The failure message lists every missing name and the two ways to fix it: add a
  behavioural case, or add an exemption entry naming a tracking issue. The core check is a
  pure helper (export names, source text, exemptions in; missing names and stale exemptions
  out), and the suite exercises it against a synthetic input with one name planted missing,
  so the gate is shown able to fail on every run.
- **FR-5a - Exemptions are explicit and shrink-only.** Exemptions are one commented list in
  the suite; each entry names the function, a tracking issue as `AIClarityAU/minspec#N`, and a
  one-line reason. The gate fails when an exempted name is no longer exported, or is now
  referenced (the exemption is stale and must be deleted). The initial list is exactly:
  `parseCliVerdict` (#1941). `isQuotaExhaustionStrict` and `wholeCheckRunListing` were on
  this list when the spec was written; #2901 gave them shipped cases before implementation
  began, so listing them now would fail this requirement's own stale-exemption rule.
  `renderVerdictBlock` and `defangProtocolTokens` are not exempted, because the
  ported cases from FR-1 and FR-2 already reference them.
- **FR-5b - The gate fails closed.** It fails, never passes, when the guard cannot be
  loaded, when it finds zero function exports, or when the suite cannot read its own source
  (the helper given a `null`, `undefined` or empty source text reports failure, not an
  empty missing list).
- **FR-6 - Citation gate.** The shipped suite contains a case that reads the guard's source,
  collects every citation in the FR-4 form, and fails for each cited title that is not the
  exact title of a test in the suite. Finding zero citations is a failure, because FR-4
  introduces at least three. As with FR-5, the core is a pure helper exercised against a
  planted unresolvable title on every run.
- **FR-7 - Embedded copies regenerated, not edited.** After the guard and suite change,
  `node scripts/gen-ci-templates.mjs` regenerates
  `packages/minspec/src/lib/ci-review-templates.ts`. No hand edit to a generated file.
- **FR-8 - The shipped suite stays plain Node.** It requires only `node:` built-in modules
  and `./ai-review-guard.js`. No package dependency and no network call is added.

## Costly to Refactor

1. **The citation form `ai-review-guard.test.js: "<title>"` becomes a contract the FR-6
   gate parses.** Changing the form later means rewriting every citation and the parser
   together. Check: the parser and the form are defined once, next to each other.
2. **The exemption list ships to every adopter.** Removing or reshaping it reaches adopters
   only through their next refresh. Check: entries carry a full `AIClarityAU/minspec#N` ref,
   so the line means the same thing in an adopter repo.
3. **Deleting the vitest files repoints an accepted DR (DR-097).** Low: a citation change,
   with the original commit addresses kept. Check: DR-097's decision text is unchanged.

Everything else is low: comments, tests and one regenerated file, revertable in one commit.

## Acceptance Criteria

- [ ] **Shipped suite green** - `node --test .github/scripts/ai-review-guard.test.js` exits 0
      with `# fail 0`, and `# tests` is at least 190 plus the number of ported cases.
      (FR-1, FR-2)
- [ ] **Every guard rail named** - for each of the seven FR-1 rails, a test title in the
      shipped suite starts with `selectVotersToRun:` and names the rail; the PR body maps
      each rail to its title. (FR-1)
- [ ] **Every vitest case accounted for** - the PR body maps all 32 titles of
      `voter-survivor-reuse.test.ts` and every case of `review-protocol-tokens.test.ts` to a
      shipped title, and each mapped title exists in the suite (checked by a grep of the
      quoted titles). (FR-1, FR-2, FR-3)
- [ ] **Export gate passes and can fail** - the FR-5 case passes on the branch; in a scratch
      copy, adding `function zzUnreferenced() {}` to the guard's exports makes it fail naming
      `zzUnreferenced`, and removing every call and member access of `selectVotersToRun`
      from a copy of the suite - leaving its import-list entry and its `selectVotersToRun:`
      test titles in place - makes it fail naming `selectVotersToRun`. Both scratch copies
      are discarded. (FR-5)
- [ ] **Exemptions exact and shrink-only** - the exemption list holds exactly
      `parseCliVerdict` with its issue ref; in a scratch copy, adding a case that calls
      `parseCliVerdict` without deleting its exemption makes the gate fail as stale. (FR-5a)
- [ ] **Gate fails closed** - the suite contains cases showing the FR-5 helper reports
      failure on an empty export set and on a `null`/empty source text. (FR-5b)
- [ ] **No uncheckable test claims** - `grep -n -E "the diff's own test|the test asserting
      recency|the test is \(#2163 review\)|a test pins it to what review-branch.sh reads"
      .github/scripts/ai-review-guard.js` prints nothing, and the FR-6 case passes with at
      least three citations resolved; in a scratch copy, a citation with an invented title
      makes it fail naming that title. (FR-4, FR-6)
- [ ] **Guard behaviour unchanged** - the guard with comments and whitespace removed
      (`npx esbuild .github/scripts/ai-review-guard.js --minify-whitespace`) is
      byte-identical at the merge base and at the branch head, and
      `Object.keys(require('./.github/scripts/ai-review-guard.js'))` is identical at both.
      (INV-1)
- [ ] **Plain Node only** - every `require(` in the shipped suite names a `node:` module or
      `./ai-review-guard.js`. (FR-8)
- [ ] **Generated copies current** - `node scripts/gen-ci-templates.mjs --check` exits 0
      and `npm run validate` exits 0. (FR-7)
- [ ] **Parity and full suite green** - `ai-review-guard-test-parity.test.ts` (including
      the scaffolded-repo `node --test` run) and `managed-region-enumeration.test.ts` pass,
      and `npm test`, `npm run lint` and `npm run typecheck` exit 0. (FR-7, INV-5)
- [ ] **Vitest copies gone, DR-097 still true** - the two vitest files no longer exist, and
      every remaining hit of `git grep -n -E "voter-survivor-reuse\.test\.ts|review-protocol-tokens\.test\.ts"
      -- ':!specs/minspec/SPEC-211-shipped-guard-test-parity/'` is on a line that also
      carries a `#2163 @ <sha>` commit address. This spec is excluded because it names the
      files to describe their deletion. (FR-3)

## Invariants (must not break)

- **INV-1 - Guard behaviour unchanged.** The guard's diff is comments only. If porting a
  case exposes a real defect in the guard, implementation stops and reports it (`DEEPER:`)
  rather than changing the guard inside this spec.
- **INV-2 - No silent gate (constitution invariant 2, DR-066).** Both new gates and the
  ported sibling-file reads fail closed and visibly (FR-2, FR-5b, FR-6). Neither gate may
  skip, warn, or pass on an input it could not read.
- **INV-3 - Offline core (constitution invariant 1).** No test makes a network call.
- **INV-4 - Blast radius (constitution invariant 3, DR-074).** The change reaches an adopter
  only through that adopter's own Refresh Harness Files. No adopter file is edited by hand,
  including AIClarityAU/memory-fabric #40.
- **INV-5 - The managed set does not change.** No path is added to or removed from
  `MANAGED_REGION_TEMPLATES` or `CI_TEMPLATE_SOURCE_PATHS`; the pinned enumeration in
  `managed-region-enumeration.test.ts` is untouched.

## Limitations, stated plainly

- **"Used" is a textual proxy for "tested".** A name that is called in test code but whose
  result is never meaningfully asserted passes FR-5. An import-list entry or a test title
  alone does not (FR-5), which closes the two cheapest ways to satisfy the gate without a
  test. FR-1 and FR-2 supply real behavioural
  cases for the functions this spec is about; the gate stops the zero-coverage case
  recurring, which is the case #2371 is. A call-recording gate was considered and rejected
  (Alternatives).
- **Constants are outside the gate.** FR-5 checks function exports only. After FR-1 and
  FR-2, `ROUND_RECORD_PREFIX`, `VERDICT_SCHEMA` and `PENDING` remain unreferenced
  (`VERDICT_SCHEMA` is in #1941's scope). Recorded in `docs/backlog.md`.
- **FR-6 only sees citations in the fixed form.** A future comment that says "a test
  proves this" in free prose is not caught by a machine; FR-4's form is the convention that
  makes the claim checkable.
- **Adopters are fixed only by their next refresh** from an extension build that includes
  this change. Until then memory-fabric #40 and the other open refresh pull requests stay
  blocked; each needs a fresh refresh, not a hand edit.

## Clarify selections (recorded by an agent 2026-10-18; ratified only by approval of this spec)

### DQ-1 - What happens to the two vitest files once their cases are ported?

- **(a) Delete them and repoint DR-097's two citations (rec).** One copy of each case, in
  the file that ships, still run by `npm test` through the scaffolded-suite parity case and
  by CI's `lint` job. Cost: an accepted DR's body is edited (citations only), and the cases
  lose vitest's typed fixtures.
- (b) Keep them unchanged. No DR edit. Cost: about 45 cases exist twice and can drift apart,
  and a reader of either copy cannot tell which one is authoritative.

## Why no new DR

Every part can be reverted in under a day: tests, comments, a regenerated file. The choice
of direction (a) over (b) and (c) is recorded here and on #2371. DR-097's decision is
unchanged; only where its evidence lives moves.

## Out of Scope

- **Wiring `selectVotersToRun` into `ai-review.yml`.** #2165.
- **Running the shipped suite automatically in adopters' CI.** #2059.
- **Porting the scroogellm#160 tests for `parseCliVerdict`, `renderVerdictBlock`,
  `defangProtocolTokens`, `VERDICT_SCHEMA`, `parseResetInstant`.** #1941. FR-2's ported
  cases reference two of these; #1941's deeper coverage still applies.
- **Cases for `isQuotaExhaustionStrict` and `wholeCheckRunListing`.** #2897, done by #2901.
- **The lower-severity findings listed on #2371** (`validate.py` `is_escaping_path` severity,
  `parseVoterRecords` greedy base64 on concatenated records, the two-dot diff misreading a
  refresh branch as a DR revert). Each is a dated line in `docs/backlog.md`.
- **A coverage gate for any other shipped script.** The guard is the only shipped script
  with a shipped test suite.

## Alternatives considered and rejected

- **Withhold the voter-reuse functions from adopters until #2165 wires them (#2371 option
  b).** Needs a second, filtered copy of the guard for adopters, which breaks the
  byte-identical parity #871 established and makes adopters' guard differ from MinSpec's.
- **Reword the comments to cite the upstream vitest path (#2371 option c).** Leaves four
  exported, security-relevant functions with no test in the adopter's tree, which is the
  part of the finding the reviewer and architect voters raised independently of the
  comments.
- **Gate on functions actually called during the run (wrap the exports and record calls).**
  Stronger than a textual check, but several existing cases run the guard in a child
  process, which the recorder cannot see, and the wrapping would itself change how every
  other case loads the guard. Rejected for this spec; the textual gate closes the
  zero-coverage class at much lower cost.
- **Put the gate in a vitest file.** It would not travel to adopters, so an adopter's
  reviewer could not see the evidence that the shipped suite is complete.

## Test plan (for the Plan phase to place)

- **T0, before any port:** the FR-5 and FR-6 cases, shown red on the current tree (FR-5:
  six missing names, the seven measured at `23a58c2f` less the one exempted; FR-6: zero citations in the
  fixed form), with the planted-failure helper cases green.
- **T1:** the ported FR-1 and FR-2 cases, written first against the unchanged guard; all
  should pass on arrival, since the guard is not changing (INV-1). A ported case that fails
  is a `DEEPER:` stop, not a guard edit.
- **Not vacuous:** the scratch-copy mutations in the Acceptance Criteria, each with a clean
  control run.

## Traceability

- **Issue:** [#2371](https://github.com/AIClarityAU/minspec/issues/2371).
- **Origin of the functions:** #2163 (voter-survivor reuse, for #2142); decision
  [DR-097](../../../docs/decisions/DR-097.md).
- **Earlier instance of the same class:** #871 (the guard shipped without its test file at
  all), whose parity test this spec extends from "the file ships" to "the file covers what
  ships".
- **Follow-ups:** #2897 (filed from this spec: two remaining untested exports; closed by #2901), #1941
  (existing: scroogellm#160 port), backlog lines dated 2026-10-18 in `docs/backlog.md`.
- **Adopter pull requests blocked by this defect:** AIClarityAU/memory-fabric #40,
  AIClarityAU/voip-sms-inbox #121.
- **DR for this spec:** none, by design; see "Why no new DR".
