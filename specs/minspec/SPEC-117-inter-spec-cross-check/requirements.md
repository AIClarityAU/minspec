---
id: SPEC-117
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — one spec stating something false about another is a false signpost no single-spec check can see
aspects: [validator, corpus, cross-spec, gate, no-silent-gate, tier-0, tier-1-contract, reality-check]
relates_to: [DR-029, DR-030, DR-004, DR-015, DR-003, DR-053, SPEC-016, SPEC-013, SPEC-010, SPEC-038, SPEC-075, "#147", "#131", "#137", "#121", "#161", "#98"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038; the SPEC-096
# precedent). Both files are NEW. Existing files this spec will MODIFY (the corpus validator
# entry point, and whichever module ends up hosting the wiring) are deliberately NOT listed
# under `affects:` here: which files they are is a Plan-phase measurement, and SPEC-060's
# frontmatter note records that `affects:` arms the spec-gate on the listed file, which on a
# file as busy as the corpus validator would hold up unrelated sessions while this spec is
# unapproved (I have read that note, not re-measured the gate). FR-15 makes the Plan add them.
implements: [packages/minspec/src/lib/corpus-cross-check.ts, packages/minspec/tests/corpus-cross-check.test.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Inter-spec cross-check: the corpus becomes a unit of analysis (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, template, or test is created by this
> document. It is the Specify-phase artifact for
> [#147](https://github.com/AIClarityAU/minspec/issues/147), dispatched under the
> specify-only gate (DR-076 solo-mode ceremony / #1169). Nothing may be built from it until a
> human approves it.

**Status:** specifying
**Issue:** [#147](https://github.com/AIClarityAU/minspec/issues/147) — inter-spec cross-check as a Slice 2 (reality-check reviewer) AI check
**Rests on:** [DR-029](../../../docs/decisions/DR-029.md) (self-audit + trust stack, §3 and §8 build slices) ·
[DR-030](../../../docs/decisions/DR-030.md) (spec prose is untrusted input) ·
[DR-004](../../../docs/decisions/DR-004.md) (tier model) ·
[DR-015](../../../docs/decisions/DR-015.md) (agent code ships in a separate extension)
**Epic:** [EPIC-002 Signpost Integrity](../../../docs/epics/EPIC-002-signpost-integrity.md)

## One-Sentence Scope

Give MinSpec a check whose unit of analysis is the **whole spec corpus** rather than one
spec: a deterministic, offline floor that finds what can be found without a model
(unresolved paragraph references, out-of-range line citations, contradicted status claims,
double-owned files, one-sided traceability links), plus a defined, advisory input and output
contract through which the Tier-1 reality-check reviewer
([SPEC-016](../../agent-execute/SPEC-016-reality-check/requirements.md)) can judge what only
reasoning can (semantic contradiction, ownership ambiguity, claim plausibility).

## Context

### The gap, and its mechanism

Every reasoning check MinSpec specifies today stops at the edge of one spec:

- DR-029 §3 L2 consistency is "id-based" and scoped to one spec's own FR set
  (`docs/decisions/DR-029.md:103`).
- SPEC-016 FR-2 gives the reviewer one spec's "frozen Zone A + FR-set + the written
  self-audit" as input (`specs/agent-execute/SPEC-016-reality-check/requirements.md:51-55`);
  FR-3's checks are all "per FR" of that spec (`:56-60`).
- The `minspec-analyze` skill cross-checks spec, plan and tasks of one feature.

The mechanism behind the gap, per the issue and confirmed above: DR-029 scoped the reviewer
to a single spec's self-audit, so **no artifact ever owned the corpus as a unit**. A checker
that needs a corpus-wide view therefore has nowhere to be called from.

### The mechanism is visible in code today — a built detector with no caller

This is the strongest evidence, and it changes what the spec must do.

`validateStatusClaims` (`packages/minspec/src/lib/spec-validator.ts:1475`) is exactly the
detector for the issue's second bullet: it scans prose for `implemented|done|built|shipped`
within 40 characters of a `SPEC-NNN` reference and reports when the referenced spec's actual
status contradicts the claim (`:1426-1435`, `:1475-1512`). Its header cites the same incident
the issue cites (an earlier design document calling SPEC-014's webview implemented while
SPEC-014 was `specifying`, `:1412-1415`). It has ten unit tests
(`packages/minspec/tests/spec-validator.test.ts:1518-1584`).

**It has no production caller.** A search of every `.ts`, `.py` and `.mjs` file in the
repository for `validateStatusClaims` returns the definition and the test file, and nothing
else (measured at `350c6fa4`). The function takes a caller-supplied map of id to actual
status (`:1477`), and nothing in the repository builds that map for the whole corpus — which
is the gap restated as code: the detector exists, the corpus view it needs does not.

So the deterministic half of this feature is **partly wiring, not invention**, and a spec
that told a builder to write a status-claim detector would create a second one.

### What already exists — inventory (measured at `350c6fa4`)

| Class from #147 | Exists today | Where | State |
|---|---|---|---|
| `SPEC-NNN` / `DR-NNN` / `EPIC-NNN` / file-path resolution | yes | Rule 9, `scripts/validate-frontmatter.ts:415-446`; `reference-checker.ts:117-207` | warn-only; 78 findings on the corpus today (33 DR, 16 spec, 29 file) |
| Duplicate spec id, id disagreeing with directory | yes | Rule 18, `scripts/validate-frontmatter.ts:332-368` | fatal |
| Duplicate DR id | yes | Rule 17, `:288-330` | fatal |
| DR amendment not carried into its target | yes | Rule 16, `:385-413` | fatal |
| Missing or unresolvable `epic:` | yes | Rule 2 + 5, `:211-240` | fatal |
| Status claim about another spec | detector only | `spec-validator.ts:1475` | **built, tested, never called** |
| Line citation still in range | no | `reference-checker.ts:18-20` defers it to #147 by name; existence of the file is all that is checked | absent |
| Paragraph reference resolves (`SPEC-013 FR-11` names a real FR) | no | `reference-checker.ts:65` matches ids only | absent |
| One file owned by two specs | no gate | `facts owns <path>` reports it (`scripts/facts.ts`, header) but nothing fails or warns | absent — 1 instance today: `scripts/dispatch-issue.sh` under `implements:` of both SPEC-044 and SPEC-073 |
| Same FR defined twice with different text | no | — | absent |
| Phase-map propagation (#131) | no detector | `cross-checks` returns no hits in `packages/minspec/src` or `packages/shared/src` | absent; the phase itself is not in code |
| Semantic contradiction, ownership ambiguity, claim plausibility | no | SPEC-016 is single-spec | absent |

Corpus size for scale: 76 spec directories, 100 decision records. The validator's current
run prints 181 non-fatal warnings.

### Two corrections to the issue's framing

1. **The deterministic half does not belong on the SPEC-013 floor.** The issue proposes
   "Slice 1 (deterministic, SPEC-013 floor)". SPEC-013's floor is per-spec by design (its
   layers L0 to L4 read one spec's FR set) and it is unbuilt: its frontmatter declares
   `implements: none` because "its central mechanism is unbuilt"
   (`specs/minspec/SPEC-013-risk-section-policy/requirements.md:11-20`). The corpus-level
   checks that *are* built live in the corpus validator
   (`scripts/validate-frontmatter.ts`) over pure modules in `packages/minspec/src/lib/`.
   This spec attaches there. It does not wait on SPEC-013.
2. **The requirements seed is not available.** The issue names
   `specs/CROSS-CHECK-REPORT.md` as the seed. That file is not in this checkout, and
   `git log --all -- specs/CROSS-CHECK-REPORT.md` returns nothing across every ref known
   locally. The lens list below is therefore derived from the issue's five bullets and the
   inventory above, not from the report. See CQ-4.

### State of the Tier-1 side

SPEC-016 is `status: implementing`. Its invocation code is specified to live in the
agent-execute extension, never in `packages/minspec` or `packages/shared` (SPEC-016 FR-8,
FR-10). No reality-check invocation exists in this repository; whether one exists in the
agent-execute repository (`AIClarityAU/sealbox`) is **unverified from this checkout**. This
spec therefore treats the Tier-1 lens as a contract it defines and a consumer it does not
build.

### Why no new DR

Nothing here is a choice that cannot be undone in under a day. The deterministic checks are
additive validator rules that can be deleted. The Tier-1 lens is advisory under DR-029 §4
and can be switched off. The tier split is DR-004's, the packaging boundary DR-015's, the
untrusted-input handling DR-030's, all applied unchanged. Widening the reviewer from one
spec to a neighbourhood extends DR-029 §5 without contradicting it. One exception is flagged
rather than hidden: if CQ-1 is answered with option `b` (amend SPEC-016), or if the Plan
fixes a finding schema that both repositories depend on, that is a cross-repository contract
and the Plan must record it in a DR before building (FR-13).

## Functional Requirements

### Part A — the corpus view (Tier 0)

- **FR-1 (one corpus model, built once).** A pure module builds a single in-memory model of
  the corpus from the configured specs, decisions and epics directories: for each spec its
  id, product, derived status, tier, `epic:`, `implements:` and `affects:` paths,
  `relates_to:` and `depends_on:` targets, and its defined paragraph ids (`FR-N`, `AC-N`,
  `INV-N`, `OQ-N`, `CQ-N`, `R-N`); for each decision its id and status; for each epic its id
  and the specs it lists. Every check in this spec reads this model. No check re-globs or
  re-parses the corpus on its own.
- **FR-2 (status is derived, never read off the page).** A spec's status in the model MUST
  be the derived status (`deriveStatus`, the same oracle `facts status` uses), not the
  literal `status:` line, which is a mirror that can drift
  (`packages/minspec/src/lib/artifact-graph.ts:12-16`). A spec whose status cannot be
  derived is recorded as unknown, and a check that needs it reports nothing about that spec.
- **FR-3 (Tier 0).** The model and every Part A and Part B check MUST be pure functions over
  text and an injected file probe, in the shape `reference-checker.ts` already uses: no
  `vscode` import, no network, no model call, no filesystem access of their own.

### Part B — deterministic inter-spec checks

- **FR-4 (wire the existing status-claim detector).** `validateStatusClaims` MUST be called
  over every spec and decision record with the FR-1 status map. The existing function is
  reused; a second detector MUST NOT be written. A claim about the artifact's own id is
  excluded (a spec describing its own state is not an inter-spec claim).
- **FR-5 (paragraph references resolve).** A reference to a paragraph of another spec, in
  the forms the corpus actually uses (`SPEC-013 FR-11`, `SPEC-013's FR-11`, and the DR-053
  slash form `SP13/FR11` once #679 ships it), MUST be reported when the target spec exists
  but defines no such paragraph. A target spec that does not exist is Rule 9's finding and
  is not reported twice.
- **FR-6 (line citations are in range).** A `path:N`, `path:N-M`, `path#LN` or `path#LN-LM`
  citation whose file exists MUST be reported when `N` or `M` exceeds the file's line count.
  This closes the deferral recorded at `reference-checker.ts:18-20`. Whether the cited lines
  still *say* what the citing sentence claims is not decidable without reasoning and is
  Part C's job, not this requirement's.
- **FR-7 (one owner per file).** A path listed under `implements:` by two or more distinct
  spec ids MUST be reported, naming every claimant. A path one spec `implements:` and
  another `affects:` is the intended shape and is not reported. The policy on what is exempt
  and how severe the finding is belongs to CQ-3.
- **FR-8 (one definition per paragraph id).** Within one spec directory, a paragraph id that
  is *defined* (a bold lead-in such as `**FR-3`) more than once across `requirements.md`,
  `design.md` and `tasks.md` with non-identical text MUST be reported. A *reference* to
  `FR-3` is not a definition. The definition pattern MUST be fixed in the Plan against the
  measured corpus, with the count of definitions it finds stated, so the rule is not tuned
  on a guess.
- **FR-9 (traceability links are two-sided).** The model MUST report: (a) an epic that lists
  a spec whose `epic:` names a different epic; (b) a spec whose `epic:` names an epic that
  does not list it, where that epic lists specs at all; (c) a decision record with no
  `Triggered by:` line. Issue numbers are checked for form only. Whether issue `#N` exists
  is a network question and is never asked (constitution invariant 1).
- **FR-10 (phase-map propagation detector).** A spec whose `phases:` map lacks a phase that
  the configured lifecycle requires for its tier, or carries one the lifecycle does not
  define, MUST be reported. This is the detector #131 lacks. It is inert for the
  `cross-checks` phase until that phase exists in configuration; the requirement is that
  when #131 lands the phase, incomplete propagation is found by a rule rather than by a
  reader.

### Part C — the Tier-1 corpus lens (contract defined here, built in agent-execute)

- **FR-11 (neighbourhood, not the whole corpus).** For a spec under review, the lens input
  is that spec plus its **neighbourhood**: every spec it names in `relates_to:` or
  `depends_on:`, every spec that names it, every spec sharing an `implements:` or `affects:`
  path with it, and every spec it cites in its body. The neighbourhood is computed by a
  Tier-0 function from the FR-1 model, so the same spec yields the same neighbourhood on
  every machine. A whole-corpus sweep is a separate, explicitly requested run with its cost
  shown before it starts, under SPEC-016 FR-7's rules.
- **FR-12 (what the lens judges, and what it is told to skip).** Given the neighbourhood,
  the lens looks for: two specs stating rules that cannot both hold; one spec specifying a
  mechanism another spec owns; a status or behaviour claim about another spec that the other
  spec's text does not support; and a line citation whose target no longer says what the
  citing sentence claims. Every Part B finding for the neighbourhood is passed to the lens
  as an **exclusion**, in SPEC-016 FR-2's sense: already found deterministically, do not
  re-report.
- **FR-13 (finding contract, fixed before build).** Deterministic findings and lens findings
  share one schema, whose type may live in `packages/shared` (a type only, no invocation,
  per SPEC-016 FR-10). Each finding carries at minimum: the check that produced it, the
  citing artifact and location, the target artifact and location, a provenance field that
  distinguishes `deterministic` from `model`, and for a `model` finding a quoted evidence
  span from each side. A model finding with no evidence span from both sides is dropped by
  the normaliser. The exact schema is a Plan deliverable, and if both repositories depend on
  it the Plan records it in a decision record before any code.
- **FR-14 (advisory, degrading, untrusted).** The lens inherits SPEC-016's invariants
  without exception: its verdict is advisory and never blocks approval or writes into an
  artifact (FR-5); absent or failed, it returns a typed fallback and Part B stands as the
  full experience (FR-8); neighbour specs are passed as delimited data over stdin to a
  tools-off, single-turn, credential-free call (FR-9). A neighbourhood widens the
  untrusted-input surface from one document to several, so every neighbour is inside the
  data envelope, never in the instructions.

### Part D — surfacing and severity

- **FR-15 (one rule, every surface).** Part B findings MUST be produced by the same
  functions on the commit and CI surface (`npm run validate`) and in the editor, following
  the Rule 15 precedent of calling the identical function from both
  (`scripts/validate-frontmatter.ts:632-637`). The Plan MUST name the existing files it
  modifies and add them to this spec's frontmatter before approval of the plan.
- **FR-16 (a check that cannot run says so).** If the corpus model cannot be built, or a
  check throws, the run MUST print that the named check validated nothing, in the wording
  Rules 16 to 19 already use (`:326-329`, `:412`). A silent `catch {}` is not permitted for
  any check this spec adds. Whether that case warns or fails follows CQ-2.
- **FR-17 (a clean result states what it counted).** Each check MUST report how many
  artifacts and how many candidate references it examined, so "no findings" over zero
  candidates is distinguishable from "no findings" over the corpus.
- **FR-18 (escape hatch is visible and local).** A finding that is correct to ignore (a
  deliberate historical statement, a cross-repository reference) is suppressed only by a
  marker on the same line, following the `claim-ok` and `@namespace` precedents. No
  suppression list in a separate file.

## Acceptance Criteria

- [ ] **AC-1 — the existing detector runs on the corpus.** A fixture corpus in which spec A
  says "implemented (SPEC-B)" while SPEC-B derives `specifying` produces a
  `status-claim.contradicted` finding from `npm run validate`, and the same fixture with
  SPEC-B at `implementing` produces none. *(FR-4, FR-2)*
- [ ] **AC-2 — no second detector.** `validateStatusClaims` has at least one production
  caller and the repository contains one status-claim regex, not two. *(FR-4)*
- [ ] **AC-3 — status is derived.** A fixture whose literal `status:` line says `done` while
  its phases derive `specifying` is treated as `specifying` by every check. *(FR-2)*
- [ ] **AC-4 — paragraph references.** `SPEC-B FR-99` is reported when SPEC-B exists and has
  no FR-99; not reported when SPEC-B has it; and not reported by this check when SPEC-B does
  not exist. *(FR-5)*
- [ ] **AC-5 — line range.** `path:900` against a 40-line file is reported; `path:40` is
  not; a citation to a missing file is reported once, by Rule 9, not twice. *(FR-6)*
- [ ] **AC-6 — double ownership.** Two fixture specs listing one path under `implements:`
  yield one finding naming both; `implements:` in one and `affects:` in the other yields
  none. Run against the real corpus at the approved base, the check reports exactly the
  instances a hand count finds (one at `350c6fa4`). *(FR-7)*
- [ ] **AC-7 — duplicate definition.** One spec directory defining `FR-3` with different
  text in two files is reported; identical text is not; a mere reference is not. *(FR-8)*
- [ ] **AC-8 — two-sided links, both directions.** Each of FR-9's three cases has a failing
  fixture and a passing fixture. The epic case is tested from both sides, so a check that
  only looks one way cannot pass (the #137 symmetric-validation lesson). *(FR-9)*
- [ ] **AC-9 — phase map.** A T3 fixture missing a required phase key is reported; one with
  the full set is not. *(FR-10)*
- [ ] **AC-10 — neighbourhood is deterministic.** For a fixed fixture corpus the
  neighbourhood of a named spec is the same set in the same order on repeated runs, and
  includes a spec that cites it without being cited back. *(FR-11)*
- [ ] **AC-11 — the floor stands alone.** With no model installed, every Part B check runs
  and reports; no code path in `packages/minspec` or `packages/shared` imports or spawns a
  model, verified by a test that spawns none. *(FR-3, FR-14)*
- [ ] **AC-12 — evidence or dropped.** A model finding lacking a quoted span from either
  side is removed by the normaliser, verified by a Tier-0 test over a canned verdict. *(FR-13)*
- [ ] **AC-13 — a broken check is loud.** Forcing the corpus model to throw yields a visible
  "validated nothing" line naming each affected check, and the run's summary is not
  indistinguishable from a clean one. *(FR-16)*
- [ ] **AC-14 — vacuous pass is ruled out.** The suite includes a control fixture with zero
  specs, and asserts the reported examined-count is zero rather than asserting only "no
  findings". *(FR-17)*
- [ ] **AC-15 — identical on both surfaces.** The editor and `npm run validate` call the
  same functions; a test fails if a second implementation of any Part B check appears.
  *(FR-15)*

## Invariants

- **INV-1 (offline core).** No Part A or Part B path makes a network or model call
  (constitution invariant 1). Issue existence is never checked.
- **INV-2 (no silent gate).** A check that did not run is reported as not having run
  (constitution invariant 2). FR-16 and FR-17 are this invariant applied.
- **INV-3 (blast radius).** The checks read only the corpus of the project they run in and
  write nothing outside it (constitution invariant 3).
- **INV-4 (advisory lens).** A model finding never blocks approval, never writes into an
  artifact, and never changes a deterministic finding's severity (DR-029 §4; SPEC-016
  INV — Advisory).
- **INV-5 (the model is never the floor).** No deterministic finding depends on a model
  having run, and no model finding is presented without its `model` provenance
  (DR-029 §3, "degrades to the floor, never *is* the floor").
- **INV-6 (no false positive that blocks).** A check whose match is lexical, FR-4 above all,
  MUST NOT be fatal. A wrong fatal blocks a legitimate commit, which `status-parity.ts:13-16`
  already names as forbidden.
- **INV-7 (no reimplementation).** Existing rules (9, 16, 17, 18, 2 + 5) and
  `validateStatusClaims` are consumed, not duplicated. One fact is checked in one place.
- **INV-8 (untrusted neighbours).** Every neighbour spec handed to the lens is data
  (DR-030). A larger input is a larger injection surface, not a different trust level.

## Out of scope

- Building the reality-check reviewer itself, its prompt, or its invocation — SPEC-016, in
  agent-execute.
- SPEC-013's per-spec floor (L0 to L4). This spec neither builds nor depends on it.
- Adding the `cross-checks` phase to the lifecycle — #131. FR-10 only detects incomplete
  propagation.
- Coverage ownership between SPEC-013 and SPEC-010 — #121. FR-7 would *detect* a
  double-claimed file; deciding who owns coverage is #121's.
- Promoting Rule 9 from warning to fatal, or clearing its 78 current findings.
- Any online check of issue or pull-request existence.
- The DR-053 v2 paragraph grammar itself (#679, #681). FR-5 consumes it when it ships.
- Cleaning the corpus of whatever these checks find. Findings are filed, not fixed here.

## Risks & Mitigations

| # | Risk | Likelihood · Impact | Mitigation |
|---|---|---|---|
| R-1 | **Warnings nobody reads.** The validator already prints 181; adding warn-only checks adds to a pile. Rules 17 and 18 record this as how earlier gaps survived (`scripts/validate-frontmatter.ts:298-299`, `:344-345`). | High · High | CQ-2 decides the severity path. FR-17's counts make each check's result legible on its own line. |
| R-2 | **Lexical false positives.** FR-4 matches a verb near an id and cannot read negation ("SPEC-014 is not implemented" matches). | High · Med | INV-6 keeps it non-fatal; FR-18's same-line marker; the lens (FR-12) is the reasoning layer for exactly these. |
| R-3 | **Neighbourhood explosion.** A hub spec cited by most of the corpus has a neighbourhood near 76 specs; cost and context grow with it. | Med · Med | FR-11 computes the set deterministically so its size is known before any call; the Plan sets a cap and a stated ordering for what is dropped, and a dropped neighbour is named in the verdict, never silently omitted. |
| R-4 | **Same-model agreement.** Author and lens share priors and agree on a shared error. | Med · High | SPEC-016 FR-4's two decorrelated lenses apply; FR-13's two-sided evidence span makes every model finding checkable by a reader in seconds. Residual, named. |
| R-5 | **Injection through a neighbour.** A spec the reviewer was not asked about steers the verdict on one it was. | Med · Med | FR-14 and INV-8: every neighbour in the data envelope, tools-off, single turn; worst case one wrong advisory. |
| R-6 | **Contract fixed in one repository, consumed in another.** The finding type is defined here and used in agent-execute. | Med · High | FR-13: schema before build, recorded in a decision record if both sides depend on it. |
| R-7 | **Definition pattern mis-tuned.** FR-8's "what counts as defining FR-3" is a regex over house style and can miss or over-match. | Med · Low | FR-8 requires the Plan to state the measured count of definitions the pattern finds across the corpus before the rule is written. |
| R-8 | **The spec id.** SPEC-117 was chosen as one above the highest spec number on any branch known to the local checkout (116). An id claimed on a branch not yet fetched would collide. | Low · Med | Rule 18 is fatal on a duplicate id, so a collision fails visibly at merge rather than landing. |

## Decisions needed (Clarify)

### CQ-1 (shape) — how the corpus lens relates to SPEC-016, which is approved and hash-locked

- **`a` — this spec defines the lens as a contract; SPEC-016 is not edited (rec).** Part C
  stands here, references SPEC-016's FR-2, FR-5, FR-7, FR-8, FR-9 and FR-10 by id, and is
  built in agent-execute against this spec.
  **Cost:** two specs govern one reviewer. Someone reading SPEC-016 alone will not learn it
  has a corpus lens, and its FR-2 input list will be incomplete as written until a later
  amendment.
- **`b` — amend SPEC-016 to add the lens.** One spec owns the whole reviewer.
  **Cost:** any edit voids SPEC-016's approval (its own frontmatter note), so a spec that is
  `implementing` drops back to needing your re-approval, and work in flight against it is
  building from an unapproved document until you give it.
- **`c` — split this into two specs, one per product.** A Tier-0 spec here, a Tier-1 spec
  under `specs/agent-execute/`.
  **Cost:** two approvals instead of one for a single feature, and the finding contract
  (FR-13) has to be stated in both or owned by one and cited by the other.

### CQ-2 (severity) — how a new deterministic check becomes load-bearing

- **`d` — each check ships as a warning and flips to fatal once the corpus is clean for it
  (rec).** The Rule 15 ratchet (`scripts/validate-frontmatter.ts:636-638`). FR-4 never flips
  (INV-6).
  **Cost:** between ship and flip the check is one more line among 181 warnings, and the
  flip depends on someone doing the cleanup; nothing forces it to happen.
- **`e` — fatal from day one, with the corpus cleaned in the same change.** What Rules 16,
  17 and 18 did.
  **Cost:** the change that adds the checks also has to resolve every finding, including
  the SPEC-044 / SPEC-073 ownership question (CQ-3), which makes one pull request carry both
  mechanism and a pile of content edits to approved specs, each of which voids an approval.
- **`f` — a recorded baseline: existing findings tolerated, any new one fatal.**
  **Cost:** the baseline is a file, and a file can be edited to hide a finding. It becomes a
  thing that itself needs guarding.

### CQ-3 (policy) — is a file under two specs' `implements:` an error?

Measured: one instance today (`scripts/dispatch-issue.sh`, SPEC-044 and SPEC-073). SPEC-075's
frontmatter calls "one owner per file" a precedent; I found no rule enforcing it.

- **`g` — exactly one `implements:` owner; every other spec that changes the file uses
  `affects:` (rec).** A spec that supersedes another is exempt for the superseded id.
  **Cost:** resolving the existing instance means editing the frontmatter of SPEC-044 or
  SPEC-073, which voids that spec's approval and needs your re-approval.
- **`h` — report it, never fail on it.**
  **Cost:** `facts owns` already reports it and nothing has acted on that; a second report
  is unlikely to change the outcome.

### CQ-4 (input) — the requirements seed is missing

`specs/CROSS-CHECK-REPORT.md`, which #147 names as the seed, is not in the repository or in
any locally known ref's history.

- **`i` — accept the five lenses from the issue body as the full list (rec).**
  **Cost:** whatever themes the report held beyond those five bullets are not in this spec,
  and nobody will know which.
- **`j` — you supply the report and this spec is revised against it before approval.**
  **Cost:** approval waits on locating a file from 2026-06-04 that may no longer exist.

## Follow-ups (not yet filed)

The dispatch that wrote this spec had no network access, so none of these has an issue
number. Each needs one before this spec is approved, or it is a prose-only follow-up.

- Decide and apply the resolution for the SPEC-044 / SPEC-073 double ownership of
  `scripts/dispatch-issue.sh` (depends on CQ-3).
- Add a back-link to this spec in DR-029's `## Follow-ups (tracked)` section (DR-023's
  materialisation rule).
- Sweep the silent `catch {}` blocks in Rules 6, 7, 8, 9 and 10
  (`scripts/validate-frontmatter.ts:271`, `:284`, `:381`, `:444`, `:460`), which Rule 16's
  own comment notes and leaves for "a separate sweep" (`:410-411`). Rule 9's is the relevant
  one here: an unreadable corpus currently prints nothing.
- Correct the issue's pointer to `specs/CROSS-CHECK-REPORT.md` once CQ-4 is answered.

## Test

T0, owned by this spec: `packages/minspec/tests/corpus-cross-check.test.ts`. It drives the
real functions against fixture corpora, one failing and one passing fixture per acceptance
criterion, and asserts on finding content and examined-counts rather than exit codes alone.
It must include the zero-spec control (AC-14) and the forced-throw case (AC-13), so the suite
cannot go green by finding nothing to check. No test in this spec spawns a model; the lens
side is tested here only through canned verdicts against the FR-13 normaliser.
