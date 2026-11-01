---
id: SPEC-247
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - a gate MinSpec runs on itself but does not ship to adopters blocks nothing where adopters commit
aspects: [validator, scaffold, managed-region, parity, drift, silent-gate, adopter, tier-0]
relates_to: [SPEC-038, SPEC-075, SPEC-081, SPEC-211, SPEC-070, DR-037, DR-066, DR-077, DR-087, "#2261", "#2250", "#1557", "#2297", "#654", "#1418", "#626", "#1226", "#220", "#1145"]
# Ownership is not claimed in Specify. The Python port lives in template-registry.ts
# (VALIDATE_PY), a shared file several specs touch under `affects:`; where the rule
# manifest lives depends on DQ-2. Declared at Plan, after Clarify.
implements: none
implements_reason: >-
  Every candidate home for the change (template-registry.ts, scripts/validate-frontmatter.ts)
  is a shared file other specs already list under affects:, and the manifest's location is
  DQ-2. Ownership is declared at Plan, once Clarify settles the per-rule dispositions.
affects: [packages/minspec/src/lib/template-registry.ts, scripts/validate-frontmatter.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-247: Every FATAL rule in the Node validator is either shipped in validate.py or recorded as dev-only

## In plain terms

MinSpec checks its own specs and decision records with a Node script,
`scripts/validate-frontmatter.ts`. It ships a separate Python script, `.minspec/hooks/validate.py`,
to the projects that adopt it (voip-sms-inbox, for example). That Python script is the one
an adopter's commit hook and CI actually run. It describes itself as the Python twin of the
Node script, but it carries only four of the Node script's blocking rules. The rest block
mistakes in MinSpec's own repo and nowhere else. Nothing records whether that is on purpose
for any given rule, so the gap shows up only when an adopter merges something the rule would
have caught. That is how #2250 happened.

This spec does two things. First, it puts each blocking rule into one of two groups:
**ported** (the Python script runs it too, with a test proving both scripts give the same
verdict) or **dev-only** (it stays in MinSpec's own repo, with a written reason). Second, it
adds a check that fails when someone adds a blocking rule to the Node script without putting
it in one of those two groups.

**Recommended:** port the five rules that protect any adopter's corpus (acceptance criteria,
duplicate spec ids, duplicate decision ids, status agreement, and the domain-doc checks), and
mark the rest dev-only. **Cost:** each ported rule is a second implementation that has to be
maintained, and adopters with existing mistakes will see red CI on their next refresh until
they fix them. **Riskiest assumption:** that the larger rules (status agreement, DR index
drift) can be ported to Python faithfully enough for a parity test to hold over the whole
corpus. Plan must prove this per rule before committing to it (FR-4).

> **SPECIFICATION ONLY.** The dispatch that wrote this created no code, script, workflow or
> test. A human reads it, settles the questions under
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before anything is built.

Materializes **[#2261](https://github.com/AIClarityAU/minspec/issues/2261)** - *"shipped
validate.py omits most of the Node validator's FATAL rules, so adopter CI never runs them"*,
found while fixing #2250. The general case is #1557 (self-hosting drift). No DR is minted:
every choice here is a code-level classification that can be reversed in under a day by
moving a rule between lists. DR-077 already records the governing pattern (one rule, two
implementations, bound by a behavioural parity test). DQ-5 asks whether DR-077 should be
amended to name this second instance.

**Id note.** `SPEC-247` is the highest claimed id plus one. It was read on 2026-10-27 across every
local and remote-tracking ref in this checkout (highest: `SPEC-246`, on an unmerged branch).
Open pull requests not fetched into this checkout cannot be seen offline. If the id collides at
review time, renumber.

**Tier note.** Triage recorded T3. The mechanical scope is two source files and one new test per
ported rule, plus a manifest test. The change also reaches every adopter's merge gating: a newly
ported FATAL rule can turn an adopter's CI red on its next harness refresh (DQ-3).

## One-Sentence Scope

Classify every FATAL rule in `scripts/validate-frontmatter.ts` as ported-to-`validate.py` (with
a TS-vs-Python parity test) or dev-only (with a recorded reason), port the rules classified as
ported, and add a deterministic check that fails when a FATAL rule exists in neither list.

## Context - what the code does today (read at `983e9107`, not inferred)

### Root cause

**Mechanism.** The shipped validator is a hand-written re-implementation
(`VALIDATE_PY`, `packages/minspec/src/lib/template-registry.ts:1782`; doc comment `:1743-1781`).
When a FATAL rule is added to the Node validator, nothing requires a decision about the Python
twin. The default outcome is that the rule is not shipped, and that outcome is invisible: MinSpec's
own CI runs `npm run validate` (the Node script), so every check MinSpec runs on itself is green
whether or not adopters get the rule. Every fix in this family was verified in the one repo
where the gap cannot be seen (the #2250 test header records this,
`packages/minspec/tests/shipped-ownership-gate-2250.test.ts:9-20`).

**Missing gate.** No check compares the Node validator's set of FATAL rules with the set
`validate.py` implements plus a list of rules deliberately kept dev-only. The only parity test
today covers one rule (SPEC-038 ownership, `shipped-ownership-gate-2250.test.ts`), added after the
adopter incident.

**Which validator an adopter runs.** The scaffolded CI step
(`template-registry.ts:1110-1124`) runs `npm run validate` only if the adopter's own
`package.json` defines it, otherwise `python3 .minspec/hooks/validate.py`, otherwise
`npx --no-install @aiclarity/minspec-validator`. The scaffolded pre-commit hook
(`template-registry.ts:1601-1640`) tries the same npm package, then `validate.py --pre-commit`,
then a shell floor. **`@aiclarity/minspec-validator` has no source in this monorepo**
(`ls packages` → `broker extension-pack minspec shared`). I believe it is not published, but I
have not checked the npm registry. In practice, then, `validate.py` is the shipped validator.

### Inventory - every FATAL path in `scripts/validate-frontmatter.ts`

"FATAL" means the rule can call `fail()` (`:84`), which sets a non-zero exit (`:1144-1146`).
That includes rules whose severity comes from config and can be ratcheted to `error`. The
file has 27 `fail(` call sites; the definition at `:84` is the 28th match. The rule numbers come
from the `// Rule N` comment headers. **Rule 20 is used twice** (`:391` plain-terms, `:988`
doubled frontmatter; both are WARN-only), so a rule number on its own is not a unique key (FR-1).

| Node rule | What it blocks | Def. | In `validate.py` today | Recommended disposition |
|---|---|---|---|---|
| 1 | `docs/domain/*.md` without `type: domain` | `:121` | **yes** | ported (no change) |
| 3 | task checklist `- [ ]` in a domain doc | `:124` | no | **port** |
| 4 | "acceptance criteria" in a domain doc | `:127` | no | **port** |
| 2 | spec without `id: SPEC-NNN` | `:271` | **yes** | ported (no change) |
| 5 | spec with missing or unregistered `epic:` while `docs/epics/` has epics, plus the #2465 "epic files unreadable" fail | `:247`, `:275-281` | no | **dev-only**. The source comment calls it "a project-policy gate for THIS repo ... the shipped extension keeps epics soft (warning, FR-9)" (`:230-235`) |
| 17 | two DR files declaring one `id:`, or `id:` disagreeing with filename | `:366-379` | no (`validate.py` checks only the `DR-NNN` shape) | **port** |
| 18 | two spec dirs declaring one `id:`, or `id:` disagreeing with dir | `:428-441` | no | **port** |
| 8 | `INDEX.md` status disagreeing with a DR's `status:` | `:458-462` | no | **DQ-1** (port recommended, depends on whether adopters' INDEX is generated, see DQ-1) |
| 16 | accepted DR claiming to amend a DR that never mentions it | `:481-485` | no | **DQ-1** (dev-only recommended) |
| 11 | body status line, or a second status claim (#1223), disagreeing with frontmatter `status:` | `:582-614` | no | **port** |
| 12 | `gen-ci-templates.mjs` outputs stale | `:656-707` | no | **dev-only**. The generator and its outputs exist only in this repo; the rule already returns early when they are absent (`:676-677`) |
| 13 | T3/T4 spec with no acceptance criteria | `:718-726` | no | **port** |
| 15 | T3/T4 spec past Clarify without `implements:`; malformed owned path | `:738-746` | **yes** (#2250) | ported (no change) |
| 22 | spec at `implement: in-progress/done` whose `implements:` files are absent | `:763-776` | no | **DQ-1** (port recommended; config-ratcheted, `implementEvidence` default `warn`, `config.ts:164`) |
| 14 | managed-region file with diverged body and no markers | `:795-804` | no | **DQ-1** (dev-only recommended: needs the template registry, which `validate.py` does not carry) |
| 23 | `status:` line carrying more than its value | `:852-881` | no | **DQ-1** (port recommended; config-ratcheted, `statusLineAnnotation` default `warn`, `config.ts:166`) |
| 19 | forbidden integrity words (DR-087) in `specs/`, `docs/` | `:932-958` | no | **dev-only**. DR-087 is a MinSpec product-claim policy; imposing it on an adopter's prose would breach invariant 3 |
| 24 | "known limit" with no issue ref in `packages/*/src/` | `:1099-1127` | no | **dev-only**. The rule is keyed to MinSpec's own source layout |

**Drift in the other direction.** `validate.py` runs one blocking check the Node validator does
not: the `id: DR-NNN` shape on every decision file (`VALIDATE_PY` main, `id: DR-NNN` branch;
Node gap tracked as #2297). The manifest (FR-1) records this so the parity check does not report
it as an unexplained difference.

**Scope difference that matters for porting.** In `--pre-commit` mode `validate.py` reads only
the **staged** files (`staged_files`, `main()` `pre_commit` branch). Rules 17 and 18 are
corpus-wide: a duplicate id is a property of two files, and only one of them may be staged. Rule 8
compares `INDEX.md` against every DR file. A faithful port has to evaluate these over the whole
index snapshot (staged blobs plus unchanged tracked files), not over the staged list (FR-5).

**Same family, from the issue.** The shipped `/minspec-specify` prose
(`packages/minspec/src/lib/slash-commands.ts:96-97`) says that until the declaration exists "the
spec-gate stays un-armed for this spec's own files, in every repo". `scripts/hooks/spec-gate.py`
is not a managed template (`grep -n "spec-gate" packages/minspec/src/lib/template-registry.ts` →
no match; SPEC-070 FR-11 records the same finding). An adopter has no spec-gate to arm. See DQ-4.

## Functional Requirements

- **FR-1 (one manifest names every FATAL rule's disposition).** A single machine-readable manifest
  lists every FATAL-capable rule in `scripts/validate-frontmatter.ts` under a **unique key**
  (not the bare rule number, because Rule 20 is used twice). Each entry carries exactly one
  disposition:
  - `ported`: names the `validate.py` function or branch that implements it, and the parity
    test file that binds the two;
  - `dev-only`: carries a non-empty one-sentence reason, citing the invariant, DR, or repo-layout
    fact that justifies it;
  - `shipped-only`: for a check `validate.py` runs that Node does not (today, the `id: DR-NNN`
    shape, #2297). Each such entry cites its tracking issue.
  The manifest location and format are set at Plan (DQ-2).

- **FR-2 (drift gate: a new FATAL rule cannot land unclassified).** A deterministic, offline check
  fails when `scripts/validate-frontmatter.ts` contains a FATAL path that has no manifest entry,
  and when the manifest names a rule that no longer exists. "FATAL path" is detected
  structurally, not from the word `FATAL` in a comment: Rules 2, 13, 14, 15, 22 and 23 have
  headers that never say FATAL. The recommended detection is DQ-2 (A): attribute each `fail(`
  call site to its nearest preceding `// Rule` header, and require the manifest to record the
  per-rule call-site count. A `fail(` added under an existing header then changes the count and
  fails the gate too. The failure message names the rule key and the two ways to fix it (port
  it, or add a `dev-only` entry with a reason).

- **FR-3 (the drift gate runs on MinSpec's own CI, red on failure).** The FR-2 check runs as a vitest
  test (CI runs `npx vitest`, not `npm test`), or as a rule inside `npm run validate`. Either way
  it runs on every pull request with no `paths:` filter, and it fails visibly rather than
  warning (constitution invariant 2). If the source cannot be read, or the scan finds zero
  `fail(` sites, it **fails**: an empty scan is a broken witness, not a clean one.

- **FR-4 (port each rule classified `ported`, with behavioural parity).** For each rule settled
  as `ported` at Clarify, `VALIDATE_PY` gains a Python implementation and a parity test asserts
  that the TS rule and the Python rule return **the same verdict per file** (pass, or fail with
  the same rule key). The test runs over (a) a fixture matrix that includes at least one passing
  and one failing case per sub-condition of the rule, and (b) this repo's whole `specs/` and
  `docs/decisions/` corpus, following the #2250 pattern (`shipped-ownership-gate-2250.test.ts`).
  When the TS rule calls a shared library function (`checkAcceptanceCriteria`,
  `checkStatusParity`/`inspectAllStatusClaims`, `checkDeclaredDrIds`, `checkDeclaredSpecIds`,
  `validateDrIndexStatus`), parity is measured against **that function**, not a re-derivation.
  **Before porting each rule**, Plan records a feasibility note: the size of the TS logic, the
  readers it depends on (for example `parseSpec` section parsing for Rule 13), and whether a
  stdlib-only Python port is realistic. A rule whose port Plan cannot show to be faithful goes
  back to Clarify. It does not ship as an approximate port.

- **FR-5 (corpus-wide rules see the whole corpus in pre-commit mode).** A ported rule whose verdict
  depends on more than one file (17, 18, and 8 if ported) is evaluated over the full commit
  snapshot in `--pre-commit` mode: staged blobs for staged paths, plus the committed version for
  every other tracked path in scope. It must not be evaluated over the staged list alone. If the
  snapshot cannot be listed, the run fails closed, as the existing `could not list staged files`
  branch does.

- **FR-6 (config-ratcheted rules honour the adopter's config).** A ported rule whose Node severity
  comes from `.minspec/config.json` (Rules 22 and 23, if ported) reads the same key with the same
  default that `loadConfig` resolves. This mirrors `ownership_declaration()` in `VALIDATE_PY`.
  It FAILs at `error` and prints a visible WARN at `warn`. A malformed config is reported, not
  silently defaulted (SPEC-218).

- **FR-7 (corpus roots come from config, consistent with SPEC-075).** A ported rule reads its
  corpus roots the way the Node rule does: the decisions dir from `.minspec/config.json`
  `decisionsDir`, default `docs/decisions` (Node `resolveDecisionsDir`, `:97-111`). If SPEC-075
  (validate.py corpus from config) lands first, ported rules use its resolver and do not add a
  second one.

- **FR-8 (the shipped self-description tells the truth).** The `VALIDATE_PY` module docstring and
  the TS doc comment above it (`template-registry.ts:1743-1781`) stop calling the script a twin of
  "the Node validator's core FATAL checks" in general terms. They state that the set of rules it
  carries is defined by the manifest (FR-1), and point to it.

- **FR-9 (the shipped specify prose matches what is scaffolded).** Per DQ-4: the
  `/minspec-specify` prose at `slash-commands.ts:96-97` must not tell an adopter that a spec-gate
  exists in their repo while none is scaffolded. Recommended (DQ-4 A): qualify the sentence so it
  is true in both MinSpec's repo and an adopter's.

## Acceptance Criteria

- [ ] **AC-1.** The manifest (FR-1) has an entry for every rule in the inventory table above, each
  with exactly one disposition. Every `dev-only` entry has a non-empty reason. Every `ported`
  entry names a parity test file that exists.
- [ ] **AC-2.** Mutation: adding a new `// Rule 99` block containing a `fail(` call to a copy of
  `validate-frontmatter.ts` makes the FR-2 check fail, and the message names the rule and both
  fixes. Control: the unmodified file passes.
- [ ] **AC-3.** Mutation: adding one extra `fail(` call inside an **existing** rule's block (no new
  header) makes the FR-2 check fail (call-site count mismatch). Removing a rule's block while
  keeping its manifest entry also fails.
- [ ] **AC-4.** The FR-2 check fails when the source path is unreadable, and when the scan
  attributes zero `fail(` sites. Each case is tested.
- [ ] **AC-5.** For each `ported` rule: the parity test runs Python and TS over the fixture matrix
  and the live corpus and asserts per-file verdict equality. Each sub-condition fixture is
  written to fail against the pre-port `validate.py` (red first, DR-003).
- [ ] **AC-6.** For Rules 17 and 18 (and 8 if ported): a pre-commit fixture where only ONE of two
  colliding files is staged, and the other is already committed, makes
  `validate.py --pre-commit` exit non-zero.
- [ ] **AC-7.** For each config-ratcheted ported rule: the same violating fixture FAILs under
  `error`, emits a WARN and exits 0 under `warn`, and the parity test covers both severities.
- [ ] **AC-8.** A scaffold into a fresh temp repo writes a `validate.py` that runs on a stock
  `python3`, uses only the stdlib (no new import outside the stdlib), and makes no network call
  (invariant 1).
- [ ] **AC-9.** `VALIDATE_PY`'s docstring and doc comment reference the manifest. No sentence in
  either claims parity with the Node validator beyond what the manifest lists (FR-8).
- [ ] **AC-10.** Per DQ-4's outcome: the `/minspec-specify` prose no longer asserts a spec-gate in a
  repo where none is scaffolded, or a scaffolded spec-gate exists and is tested.

## Invariants (must not break)

- **Constitution 1 (offline).** `validate.py` and the drift gate make no network call. The port uses
  the stdlib only.
- **Constitution 2 (no silent gate).** Every ported rule fails closed and visibly on an unreadable
  input (the existing `unreadable (<reason>)` pattern). A zero-file scan is reported, never read
  as clean. The drift gate fails on an empty scan.
- **Constitution 3 (blast radius).** A rule reaches only repos carrying `.minspec/`, via the
  managed `validate.py` they opted into. Rules that encode MinSpec's own product or repo policy
  (5, 12, 19, 24) are `dev-only` precisely so they never reach an adopter.
- **DR-066 (fail-closed CI).** The scaffolded CI step's chain is unchanged. No new branch may exit
  0 without a validator having run.
- **DR-077 (dual implementation needs a parity test).** No rule is marked `ported` without a
  behavioural parity test.
- **#2250's pins hold.** `shipped-ownership-gate-2250.test.ts` stays green, and Rule 15 is marked
  `ported` in the manifest.

## Decisions needed (Clarify)

All 5 decisions are resolved: an agent session recorded each option this document already
recommended, under delegation DLG-001 (DR-108, the delegated-approval record). No human
chose them; they are ratified only by approval of this spec.

- **DQ-1 - disposition of the contested rules (8, 14, 16, 22, 23).**
  **Recorded selection: Option (A),** port rules **8, 22, 23** and mark **14, 16** dev-only.
  - **(A) (rec):** port **8, 22, 23**; mark **14, 16** dev-only. Rule 8: the extension's accept path
    regenerates `INDEX.md` (`adr-manager.ts:231`). I believe the same holds in an adopter repo
    (unverified for adopters), so adopters would have an INDEX that can drift.
    Rules 22 and 23 are config-ratcheted, so porting them changes nothing for an adopter until
    they opt into `error`. Rule 14 needs the whole template registry rendered, which a
    stdlib-only Python file cannot carry. Rule 16 parses amendment prose ("amends", "supersedes")
    whose grammar is MinSpec's own DR convention. **Cost:** three more Python ports to maintain.
    Rule 8's port depends on the INDEX row format staying stable.
  - **(B):** port only the six uncontested rules (3, 4, 11, 13, 17, 18) and mark all five
    contested rules dev-only. Cheaper, but an adopter's INDEX can then drift unchecked, which is
    the #220 defect.
  - **(C):** port everything, 14 and 16 included. Maximal parity; Rule 14 likely needs a generated
    data table embedded in `validate.py`, a large new surface.

- **DQ-2 - how the drift gate detects FATAL rules, and where the manifest lives.**
  **Recorded selection: Option (A),** a text scan that attributes each `fail(` call site to its
  nearest preceding `// Rule <key>` header, with the manifest a TS module beside the validator.
  - **(A) (rec):** text scan. Attribute each `fail(` call site to its nearest preceding
    `// Rule <key>` header. The manifest records `{key, disposition, reason|portRef, failSites}`,
    a TS module beside the validator (e.g. `scripts/lib/validator-rule-manifest.ts`), and a vitest
    test compares the two. No refactor of the 1,150-line validator. **Cost:** it is a text match.
    A `fail(` placed above the first header, or a header comment edited carelessly, can
    misattribute. The count requirement (AC-3) catches additions, but not a rule moved between
    headers with the same count.
  - **(B):** refactor `validate-frontmatter.ts` into a registry of rule objects
    (`{key, severity, run}`) and drive the manifest from the registry. Structural and exact.
    **Cost:** a rewrite of a load-bearing gate, with its own regression risk. It is out of
    proportion to this issue.

- **DQ-3 - how a newly ported FATAL rule reaches adopters that already violate it.**
  **Recorded selection: Option (A),** ship it at FATAL; the adopter's refresh PR shows any
  existing violation red, and it is fixed in that PR.
  - **(A) (rec):** ship it at FATAL. The refresh reaches an adopter as a pull request. That PR's CI
    runs the new `validate.py`, and any existing violation shows red there and is fixed in the
    same PR. **Cost:** an adopter's refresh PR may be blocked until their corpus is cleaned. For
    voip-sms-inbox, the size of that is unmeasured.
  - **(B):** ship each newly ported rule behind a config key that defaults to `warn`, following the
    FR-7 ratchet pattern. **Cost:** this repeats the #2250 failure, where `warn` was seeded and
    nothing ever advanced it.

- **DQ-4 - the spec-gate claim in the shipped `/minspec-specify` prose.**
  **Recorded selection: Option (A),** correct the prose (FR-9) in this spec, and track
  scaffolding `spec-gate.py` for adopters as a separate issue.
  - **(A) (rec):** correct the prose (FR-9) in this spec, and track scaffolding `spec-gate.py` for
    adopters as a separate issue. **Cost:** adopters still have no spec-gate. The prose becomes
    true, but the protection is still missing.
  - **(B):** add `scripts/hooks/spec-gate.py` to `MANAGED_REGION_TEMPLATES` here. **Cost:** this is
    scope expansion (CLAUDE.md triage rule 2). Spec-gate is a separate gate with its own arming
    and ownership semantics (SPEC-070, SPEC-081), and it needs its own spec.

- **DQ-5 - record the pattern in a DR?** **(A) (rec):** no new DR. Add an "applies also to
  `validate.py`" note to DR-077 when it is next touched. **Cost:** the manifest's dev-only
  criteria live only in code comments. **(B):** mint a DR stating the dev-only criteria (repo
  layout, MinSpec product policy, needs the extension runtime). **Cost:** one more record, for a
  classification that can be reversed in under a day.
  **Recorded selection: Option (A),** no new DR; add an "applies also to `validate.py`" note to
  DR-077 when it is next touched.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| A port is approximately right, so the parity test passes on the corpus and fixtures but diverges on an adopter's unusual shape | FR-4 requires per-sub-condition fixtures, and a Plan feasibility note before each port; a rule that cannot be shown faithful returns to Clarify |
| The live-corpus parity test passes vacuously because the corpus has no violations of a rule | AC-5 requires failing fixtures per sub-condition, written red first; the corpus pass is additive evidence, not the proof |
| Newly ported FATAL rules turn adopter CI red on refresh | DQ-3: the red appears on the refresh PR, where it can be fixed; cost stated |
| The manifest becomes the second place to maintain (the issue's named cost) | The drift gate (FR-2) makes forgetting it a red test, not a silent default |
| A rule marked dev-only for convenience rather than principle | FR-1 requires a reason that cites an invariant, DR, or layout fact; the reviewer reads every dev-only reason |
| The `@aiclarity/minspec-validator` tier is published one day and runs neither manifest | Out of scope; FR-8's docstring makes the manifest the single statement of shipped rules for any future tier to cite |

## Out of scope

- The shell floor tier (`minspec_shell_gate` in the pre-commit template). It stays a minimal
  last resort and is not held to manifest parity.
- Fixing the Node side of #2297 (the DR `id:` shape). This spec only records it as `shipped-only`.
- Warn-only rules (6, 7, 9, 10, 11b, both Rule 20s, 21). They cannot block, so their absence from
  `validate.py` is not this defect.
- Scaffolding `spec-gate.py` for adopters (DQ-4 B).

## Follow-ups (tracked)

- **Spec-gate for adopters (DQ-4 A).** Needs a new issue at Clarify if DQ-4 A is chosen; the
  dispatch that wrote this cannot file issues. Prior evidence: SPEC-070 FR-11.
- **#2297.** The Node validator does not yet gate the DR `id:` shape; recorded as `shipped-only` (FR-1).
- **#1557.** Self-hosting drift, the general case; this spec closes the validator instance only.
- **SPEC-075.** validate.py corpus from config; ordering interaction in FR-7.
