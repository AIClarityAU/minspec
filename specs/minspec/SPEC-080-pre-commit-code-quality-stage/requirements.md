---
id: SPEC-080
type: requirements
status: planning
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology — DR-037, the pre-commit gate harness this adds a stage to, is itself epic: EPIC-003 (docs/decisions/DR-037.md:2)
aspects: [harness, gate, pre-commit, code-quality, tier-0, no-silent-gate, opportunistic-tool, offline]
relates_to: [DR-037, DR-066, DR-099, SPEC-054, SPEC-066, SPEC-075]
implements: [packages/minspec/tests/pre-commit-code-quality-stage.test.ts]  # NEW — the T0 this spec owns
affects: [packages/minspec/src/lib/template-registry.ts, .minspec/hooks/pre-commit, packages/minspec/tests/scaffold-is-committable.test.ts]  # template-registry.ts is claimed by no spec's implements:; follows SPEC-066/SPEC-075/SPEC-063 precedent of affects:-only for this shared file
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# MinSpec - A deterministic, offline code-quality stage extends the scaffolded pre-commit gate; v1 ships three correctness checks that block, and the metric checks wait for v2 (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, template, or test is created by this
> document. It is the Specify-phase artifact for
> [#1555](https://github.com/AIClarityAU/minspec/issues/1555), which the deterministic triage
> gate classified T3/T4 and authorised Specify-phase-only (DR-076 / #1169) — so the spec is the
> gate, not the fix. A human reads it, checks its Clarify questions, and approves it through
> the normal spec-approval gate before anything is built. Each question carries an
> agent-recorded selection under
> **[Clarify selections](#clarify-selections-recorded-by-an-agent-2026-10-02-ratified-only-by-approval-of-this-spec)**;
> the human answers by approving this spec with those in place, or by changing them first.
> Every requirement below is written under those selections, so approving the spec as it
> stands accepts them and leaves no Clarify question open.

## One-Sentence Scope

Add a Stage 4 to the scaffolded `.minspec/hooks/pre-commit` gate, after its four existing
stages, that runs deterministic (non-LLM), offline, language-detected code-quality checks over
the staged tree: v1 ships exactly three, each of which blocks on a real finding and is skipped
visibly when its tool is absent - shell syntax (`shellcheck`), GitHub Actions workflow syntax
(`actionlint`) and the project's TypeScript typecheck (`tsc`) - and defers the metric checks
(duplication, complexity and function length, circular dependencies, dead code), the half of
#1555 that would enforce DRY, atomicity and dead-code hygiene by parser, to a v2 tracked as
[#2463](https://github.com/AIClarityAU/minspec/issues/2463).

## Context

### Why this and not constitution prose — the issue's own framing

#1555 opens by asking whether the constitution should carry principles like DRY, atomicity, or
SDD, and argues mostly not, citing MinSpec's own constitutional rule, "enforce, don't trust the
model". That rule is the constitution's Principle 8 ("Don't hope an LLM will follow rules -
enforce it via code"), and its goals G-1 (AI-slop guardrails, write-time enforcement), G-2
(prevent tech debt) and G-6 (determinism as moat) point the same way; all are present in
`.minspec/constitution.md` today. A prose principle restating SDD is redundant (SDD already is
the tiering/phase/validator machinery); a prose principle restating DRY is exactly the
model-trusted, universally-true, unenforceable text the constitution's own enforcement
philosophy exists to avoid. The half of the idea worth building is the enforceable half: a
copy-paste / complexity / dead-code detector applied deterministically at commit time, "with a
number," the same way the existing pre-commit stages already enforce spec frontmatter and secret
scanning rather than asking for either in prose.

v1 does not deliver that half yet. Under DQ-1's recorded selection it builds the stage and
three correctness checks; the copy-paste, complexity and dead-code detectors this section
argues for are the metric checks under [Deferred to v2](#deferred-to-v2), tracked as
[#2463](https://github.com/AIClarityAU/minspec/issues/2463). The argument above is the reason
the stage exists, not a description of what v1 enforces.

### The harness this extends, measured

`.minspec/hooks/pre-commit` is a managed-region template (`template-registry.ts`,
`name: 'pre-commit-hook'`, `outputPath: .minspec/hooks/pre-commit`) established by
[DR-037](../../../docs/decisions/DR-037.md) (`epic: EPIC-003`). Read directly
(`packages/minspec/src/lib/template-registry.ts:1190-1547`; every line number in this spec was
read from `origin/main` at `821544d8`), it runs **four** stages today, not the three #1555
names:

| # | Stage | What it does | Fails on |
|---|---|---|---|
| 0 | Protected-branch guard | Refuses an authored commit on the push-protected default branch | Always (no opt-out tool) |
| 1 | Author-identity gate | Opt-in allowlist of author emails | Always, once opted in |
| 2 | Secret scan (`gitleaks`) | Blocks on a finding; **opportunistic** — absent tool warns and continues | Finding present |
| 3 | SDD validation | Highest-fidelity validator available (Node → python3 → shell), each tier `exit $?`s directly (`template-registry.ts:1536,1542,1547`) | Spec/DR frontmatter violation; some other findings are printed and do not fail (below) |

Stage 3 is not purely fail-or-pass, and the first draft of this spec said it was. It already
prints warnings that let the commit through. The shell tier warns on a `minspec:managed:`
marker found outside the hooks directory ("the (2) leak is a warning only",
`template-registry.ts:1470-1473`, printed at `:1519-1520`). The python tier (`validate.py`,
the `VALIDATE_PY` template in the same file) prints `WARN` instead of `FAIL` for a spec that
declares no `implements:`, unless `.minspec/config.json` sets `ownershipDeclaration` to
`error` (`template-registry.ts:1808-1825`, emitted at `:2055-2065`), and it warns and carries
on when that config file cannot be read (`:1818-1823`). FR-6 changes how Stage 3 exits, so
INV-5 covers these warnings as well as the verdict, and AC-9 exercises the first two.

#1555's own numbering calls the secret scan "Stage 1" and SDD validation "Stage 2", omitting the
author-identity gate (Stage 1 in the live code) — a plausible-inference slip, not a
deliberate renumbering (Evidence Discipline / CLAUDE.md). This spec's Functional Requirements
below therefore refer to the new work as **Stage 4**, matching the code as it exists, and the
requirements/fixtures Plan derives from this spec must not accidentally mean "insert before the
existing Stage 3" because of the issue's off-by-one.

### The architectural obstacle a new stage runs into

Stage 3's three tiers each call `exit $?` directly the moment they run
(`template-registry.ts:1533-1547`, all three fall-through branches). Appending a Stage 4 after
Stage 3 in the shell script as written today is a no-op — the process has already exited. FR-6
below exists because of this, cited with line numbers so Plan does not have to rediscover it.

### The graceful-degrade precedent already in this hook

Stage 2 (gitleaks) already establishes the shape #1555 asks Stage 4 to reuse
(`template-registry.ts:1435-1457`): tool present → run it, block on a real finding; tool absent
→ print one `⚠` advisory line naming what was skipped and why, then continue. #1538
(`fix(#1538): make the secret gate show the finding it blocks on`, commit `a3e63968`) is the
project's own lesson that a gate's *evidence* — not just its verdict — must be visible; this
spec's FR-3 generalises that lesson to Stage 4's larger tool roster, where silent all-tools-
skipped is a materially bigger risk (one tool vs. three in v1, and up to eight once v2 adds
the metric checks).

### Constitution invariants this spec is answerable to

- **Invariant 1 (offline).** Every Stage-4 check must run against the staged tree with no
  network call — the same bar Stage 2/3 already clear.
- **Invariant 2 (no silent gate).** A check that is applicable (language detected) and whose
  tool is available must never run and have its result go unreported - pass or block, never
  swallowed (v1 has no warn-on-finding result; that belongs to the deferred metric checks). A
  missing witness (tool not installed) fails the *gate* open (never blocks
  on an absence) but must fail the *reporting* closed (the absence itself is never silent) —
  the same split Stage 2 already draws between "tool missing" (warn, continue) and "tool found
  a secret" (block).
- **Invariant 3 (blast radius).** Unchanged by construction: Stage 4 ships only inside the
  `.minspec/hooks/pre-commit` managed region, which only reaches a project that has already
  opted in via `.minspec/` at its root.

### Recommendation this spec inherits from the issue

#1555's own "Recommendation and its cost" section proposes: deterministic-correctness checks
(shell syntax, workflow syntax, typecheck) **block**, because their false-positive rate is
near-zero; metric checks (duplication %, complexity score, circular-dependency count, dead-code
count) **warn** until a project explicitly opts a check into blocking, because complexity and
duplication limits produce false positives "constantly" (switch statements, generated files,
genuinely-similar-but-not-identical branches) and a developer who hits one mid-commit reaches for
`MINSPEC_GATE_OFF=1` — which disables Stage 2's secret scan in the same keystroke. This spec
adopts that split as its policy baseline rather than re-deriving it, and builds only its
blocking half in v1 (FR-8). Under DQ-1's recorded selection the metric checks, and with them
the warn-only outcome, are deferred to v2 ([Deferred to v2](#deferred-to-v2),
[#2463](https://github.com/AIClarityAU/minspec/issues/2463)). That is narrower than the issue,
which recommends shipping the metric checks warn-only in the same first release, so the v1
tool roster is the one point where this spec departs from it (DQ-1). The design surface the
issue leaves unresolved - bypass surface, reporting cadence, config key shape - is DQ-2 to
DQ-4. All four are recorded under Clarify selections below, each with a selection recorded by
an agent and ratified only by approval of this spec, because a spec asserting a resolution
nobody decided would be exactly the ungrounded-declarative class Evidence Discipline warns
against.

### Why a DR, not just this spec

Because v1 adds checks that block, and in this register a new block is argued in a record,
not assumed. Earlier records state an advisory default, rejecting a hard block on the ground
that only DR-012, the approval gate, blocks (DR-023, DR-025, DR-040). Later records that
did add a blocking commit gate argue for it where they add it (DR-051, DR-059 and DR-062 are
three), and DR-059 makes its case against that default explicitly. Three new checks that can
refuse a commit owe the same, whatever shape Stage 2 already has. The first draft of this
spec did not make that argument: it described blocking as what every existing stage does and
stopped there.

The deferred half needs a record for the opposite reason. #1555 means the metric class, once
built, to find a real violation and let the commit through by default, and that rule has to
outlive this spec's v1 to bind the checks v2 builds.
[DR-099](../../../docs/decisions/DR-099.md) (accompanying this spec, status `proposed`)
records both, with its rejected alternatives: correctness checks block, argued there as three
new blocks against that default; metric checks warn by default; and v1 builds the first class
only. This spec is the normative requirements text for v1; DR-099 is the rationale and the
price.

## Functional Requirements

- **FR-1 (Stage 4 exists, opportunistic per tool).** `.minspec/hooks/pre-commit` MUST gain a
  Stage 4 that runs after Stage 3 completes (not instead of, not interleaved). Each check
  within Stage 4 MUST be independently opportunistic: if its tool is not resolvable
  (`command -v` / `npx --no-install`, mirroring Stage 2's and Stage 3's own probes), that one
  check is skipped and Stage 4 continues to the next — an absent tool for one check MUST NOT
  skip or block any other check.

- **FR-2 (staged-tree scope only).** Every Stage-4 check MUST operate over `git diff --cached`
  (the staged tree), never the full working tree, matching Stage 3's `minspec_shell_gate` scope
  discipline (`template-registry.ts:1476`) and keeping the stage fast. For `shellcheck` and
  `actionlint` that is each staged file's staged content, the way the shell gate reads it
  (`:1476`, `:1481`). For the typecheck it is the staged tree as a whole, because `tsc`
  resolves a project and not a file. That is the one case that is not fast by construction,
  and as written it means a type error anywhere in the staged tree refuses a commit that
  stages TypeScript. How to build that tree per commit, what it costs, and whether the verdict
  should be narrowed to the staged files are raised for Plan as #2471; narrowing it would
  amend this requirement. AC-12 pins staged content against the working copy for both kinds
  of check. No criterion pins which errors in the staged tree count for the typecheck, because
  #2471 may narrow it.

- **FR-3 (visible roster — the #1538 lesson applied to a larger tool set).** For every check
  that applies to the commit (FR-5), Stage 4 MUST report one of: it ran and passed, it ran and
  blocked (with the finding), or it was SKIPPED because its tool is not resolvable (with the
  tool name and an install pointer). A check that applies must never go unreported, and the
  report is printed on every commit, not condensed when everything passed (DQ-3). A tool that
  is resolvable but fails to run is not a fourth state: the hook's existing fail direction,
  which this spec does not change, is that an internal error fails closed
  (`template-registry.ts:1182-1188`), so it is reported as blocked, with the tool's own output.
  v1 has no "ran and warned" state: a finding that warns is the deferred metric checks' outcome
  (FU-5 under [Deferred to v2](#deferred-to-v2)).

- **FR-4 (non-applicable is silent, applicable-but-missing is not).** A check that does not
  apply to the commit (FR-5; e.g. the typecheck in a project with no `tsconfig.json`, or in a
  commit that stages no TypeScript) MUST produce no output at all, never a nag for a check
  that has nothing to judge. This is the opposite case from FR-3 and the two must not be
  conflated: "not applicable" is silent, "applicable but the tool is missing" is a visible,
  named skip.

- **FR-5 (language detection, not project-type configuration).** Whether a check applies to a
  commit is determined by what the project and the staged set contain, never by a new required
  config field a project must set before Stage 4 does anything. For the three v1 checks:
  - shell syntax (`shellcheck`) applies when a `*.sh` file is staged;
  - workflow syntax (`actionlint`) applies when a `.github/workflows/*.yml` file is staged;
  - the typecheck (`tsc`) applies when the project has a `tsconfig.json` and a TypeScript
    source file is staged.

  A Python marker (`pyproject.toml`, `setup.cfg`, a staged `*.py`) selects nothing in v1: the
  Python tools #1555 names are `radon` and `ruff`, a metric check and a linter, and neither is
  a v1 check ([Deferred to v2](#deferred-to-v2)).

- **FR-6 (Stage 3's control flow must survive Stage 4's insertion).** Stage 3's three tiers
  (`template-registry.ts:1533-1547`) each `exit $?` directly today; this MUST change to
  capturing that exit code into a variable so Stage 4 can run afterward, and the hook's final
  exit code MUST be non-zero if Stage 3 failed, OR Stage 4 blocked, or both — Stage 4 passing
  MUST NOT mask a Stage-3 failure, and Stage 3 passing MUST NOT be reported as the whole
  commit's verdict if Stage 4 then blocks.

- **FR-7 (offline, no new dependency in the shipped package).** No Stage-4 check may perform a
  network call. `packages/minspec`'s own `package.json` MUST NOT gain a new runtime dependency
  because of this change — every Stage-4 tool is an externally-installed CLI the hook probes
  for opportunistically (FR-1), exactly like `gitleaks` (Stage 2) and the Node-tier SDD
  validator (Stage 3) already do.

- **FR-8 (v1 roster and severity: three correctness checks, each blocks).** v1's Stage 4
  consists of exactly three checks: shell syntax (`shellcheck`), GitHub Actions workflow syntax
  (`actionlint`), and the project-native typecheck, which in v1 is the TypeScript compiler's
  (`tsc`), the only typecheck tool #1555 names. Each MUST block the commit on a real finding.
  #1555 gives this class by example ("a shell script is malformed, a workflow is invalid,
  types do not compile") and names no severities, so this spec fixes what counts as a real
  finding: for `shellcheck`, a finding at its error severity; for `actionlint`, a finding of
  its own workflow checks, with the shellcheck and pyflakes passes it can run over `run:`
  blocks turned off, which is how this repo's CI runs it (`.github/workflows/ci.yml:137-140`,
  `:152`); for `tsc`, an error it reports. Anything below that line, such as a `shellcheck`
  style, info or warning note in a script or in a `run:` block, neither blocks nor prints in
  v1 (INV-7). v1 MUST NOT run a metric check (duplication %, cyclomatic complexity, function
  length, circular-dependency count, unused-export count), even where its tool is resolvable,
  and no v1 check has a warn-only mode. The other half of #1555's split - metric checks warn
  by default until a project opts one into blocking - is DR-099's policy for the checks under
  [Deferred to v2](#deferred-to-v2) (FU-1); it is not a v1 requirement.

- **FR-9 (no config surface in v1).** v1's Stage 4 MUST NOT read a `.minspec/config.json` key,
  and this spec adds none: a v1 check has no threshold to adjust and its severity is fixed by
  FR-8, so no project setting can turn a v1 check's block into a warning or switch a v1 check
  off. The requirement first written here - every metric check's threshold overridable per
  project, with lenient shipped defaults - is kept as FU-2 under
  [Deferred to v2](#deferred-to-v2), and DQ-4 records where those settings go when v2 builds
  them.

- **FR-10 (one bypass surface; DQ-2).** `MINSPEC_GATE_OFF=1` MUST skip Stage 4 as it skips
  every other stage (`template-registry.ts:1195` exits before any stage runs), and Stage 4
  MUST NOT mint a bypass environment variable of its own. The hook already carries two scoped
  environment switches, for Stage 0 (`MINSPEC_ALLOW_MAIN=1`, `template-registry.ts:1246`) and
  for Stage 1 (`EMAIL_GATE_OFF=1`, `template-registry.ts:1355`); DQ-2 records the choice not
  to add a third, and what that choice costs.

## Acceptance Criteria

- **AC-1.** A repo with `tsconfig.json` and a staged `.ts` file containing a real type error:
  the commit is refused, and the printed message names the file, the line, and that the
  typecheck tool produced it.
- **AC-2.** A repo with `jscpd` resolvable and a staged pair of near-duplicate files that no v1
  check objects to: the commit succeeds, and no line naming `jscpd` or duplication is printed,
  neither a finding nor a roster entry, proving v1 runs no metric check even where its tool is
  installed (FR-8, INV-7). The warn-only behaviour first specified here is FU-3 under
  [Deferred to v2](#deferred-to-v2).
- **AC-3.** A commit to which no v1 check applies (no staged `.sh` file, no staged
  `.github/workflows/*.yml` file, and either no `tsconfig.json` or no staged TypeScript file):
  Stage 4 produces zero output and does not affect the exit code. The same holds in a project
  with `pyproject.toml` and a staged `.py` file, which select nothing in v1 (FR-4, FR-5).
- **AC-4.** A repo with `tsconfig.json` present and a staged `.ts` file, but no `tsc`
  resolvable via `command -v`/`npx --no-install`: Stage 4 prints exactly one skip line naming
  `tsc` and does not block.
- **AC-5.** A fixture where Stage 3 fails (e.g. a staged spec missing `id: SPEC-NNN`) and every
  Stage-4 check passes: the commit is still refused, proving FR-6's exit-code capture does not
  let Stage 4 mask a Stage-3 failure.
- **AC-6.** A fixture where Stage 3 passes and a Stage-4 blocking check (e.g. `shellcheck` on a
  staged `.sh` file with a real syntax error) fails: the commit is refused.
- **AC-7.** On the fixtures of AC-1 and AC-6, adding a `codeQuality` key to
  `.minspec/config.json` that asks for the opposite of the default (the DQ-4 shape, for example
  a v1 check marked `blocking: false` or `enabled: false`) changes neither verdict: both
  commits are still refused, proving v1 reads no severity and no switch from config (FR-9).
  The opt-into-blocking behaviour first specified here is FU-4 under
  [Deferred to v2](#deferred-to-v2).
- **AC-8.** `git diff` of `packages/minspec/package.json` before and after this change's
  implementation shows no added `dependencies`/`devDependencies` entries attributable to Stage
  4 (FR-7).
- **AC-9.** Two fixtures where Stage 3 only warns and every Stage-4 check passes: one where
  the shell tier runs, with a staged file outside `.minspec/hooks/` carrying a
  `minspec:managed:` marker; and one where the python tier runs, with a staged T3 spec whose
  `plan` phase is `in-progress` and which declares no `implements:`, in a project whose
  `.minspec/config.json` does not set `ownershipDeclaration` to `error`. In both, the warning
  is still printed and the commit still succeeds, proving FR-6's exit-code capture neither
  drops a Stage-3 warning nor turns it into a failure (INV-5).
- **AC-10.** A commit that stages a clean `.sh` file and a clean `.ts` file, in a repo with
  `tsconfig.json` where `shellcheck` is resolvable and `tsc` is not: Stage 4 prints one line
  saying `shellcheck` ran and passed and one skip line naming `tsc`, and the commit succeeds.
  A second commit of the same kind prints the same two lines, proving the roster is printed
  every time and that one check's missing tool does not skip another (FR-1, FR-3, DQ-3).
- **AC-11.** On the fixture of AC-6, `MINSPEC_GATE_OFF=1` lets the commit through with no
  Stage-4 output, and `QUALITY_GATE_OFF=1` changes nothing: the commit is still refused
  (FR-10, DQ-2).
- **AC-12.** Two pairs of fixtures, one with `shellcheck` on a staged `.sh` file and one with
  `tsc` on a staged `.ts` file in a repo with `tsconfig.json`. In the first of each pair the
  file's staged content has the error (a syntax error, a type error) while its working-tree
  copy is already fixed: the commit is refused. In the second the staged content is clean and
  the working-tree copy has the error: the commit succeeds. Together they prove the verdict
  follows staged content, not the working tree (FR-2).
- **AC-13.** With `shellcheck` and `actionlint` resolvable, a freshly scaffolded project
  commits its scaffold through its own hook: the commit succeeds and the roster shows both
  checks ran and passed. Where either tool is absent the case reports as skipped, not as
  passed (INV-8).

## Invariants

- **INV-1 (no silent gate, constitution invariant 2).** An applicable, tool-available check's
  result (pass or block in v1) is always visible; only "check not applicable" is silent
  (FR-3/FR-4).
- **INV-2 (opportunistic degrade, DR-037 precedent).** A missing optional tool never blocks a
  commit; it degrades to exactly one printed advisory line per missing tool.
- **INV-3 (offline, constitution invariant 1).** No Stage-4 check performs a network call.
- **INV-4 (blast radius, constitution invariant 3).** Stage 4 ships only inside the managed
  `.minspec/hooks/pre-commit` region; it changes behaviour only in a project that already has
  `.minspec/` at its root. Unchanged by this spec — recorded because it is easy to assume a
  gate-harness change needs its own opt-in check when the existing one already covers it.
- **INV-5 (Stage-3 verdict preserved).** For any staged tree that would have passed or failed
  Stage 3 before this change, Stage 3's own verdict is unchanged after Stage 4 is inserted,
  and so is every Stage-3 warning that is printed without failing the commit (FR-6, AC-5,
  AC-9).
- **INV-6 (one owner per shared file).** This spec owns only the new Stage-4 test;
  `template-registry.ts` stays `affects:`, consistent with SPEC-066/SPEC-075/SPEC-063's
  precedent for this same file, and so does the existing scaffold test INV-8 names.
  `.minspec/config.json` is not listed, because v1 does not touch it (FR-9).
- **INV-7 (v1 adds no warn-on-finding outcome).** No v1 path prints a code-quality finding and
  lets the commit through. A v1 check that applies passes, blocks, or is skipped because its
  tool is absent, and a tool that fails to run blocks (FR-3). The warn outcome belongs to the
  deferred metric checks and to DR-099's policy for them (FR-8, AC-2).
- **INV-8 (the scaffold stays committable, #1514).** MinSpec scaffolds shell scripts and
  workflows of its own (`template-registry.ts:2474`, `:2615` and others), so Stage 4 lints
  them on an adopter's first commit wherever its tools are installed. That commit MUST still
  succeed. `packages/minspec/tests/scaffold-is-committable.test.ts` is the existing T0 for
  this rule: it commits the scaffold through the scaffold's own hook. With the v1 tools
  absent that commit succeeds without Stage 4 having judged anything, so the existing T0
  alone does not prove this invariant for Stage 4; AC-13 does.

## Clarify selections (recorded by an agent 2026-10-02; ratified only by approval of this spec)

Each decision carries a recommendation and its cost. The requirements above assume the
recorded selection in every case.

DQ-1 to DQ-4 each carry a **Recorded selection** line naming the option this document
already recommended. An agent session wrote those lines on 2026-10-02 (AEST; 2026-10-01 UTC),
and no human chose them. This repository runs with `"autonomy": "act"`
(`.minspec/config.json:58`), under which an agent proceeds on a stated recommendation and
leaves the options it did not take on record (DR-086 §2 and §4), which is why the options
stay below with their costs. Approving a T4 spec is the second class on that section's stop
list (`scripts/lib/autonomy.ts:68-70`), so nothing here stands in for that approval: the
lines propose, and approving this spec is what ratifies them. An approval records a canonical
hash that covers this body (`packages/minspec/src/lib/approval.ts:4-8`) and reads as stale
once the hash stops matching (`resolveStatus`, `:483-490`), so an approval of this text covers
these selections and changing one afterwards voids it. When the lines were written no
approval of this spec existed on `main` or on this branch (`status: specifying`,
`clarify: pending`). A question in this section with no **Recorded selection** line is still
open.

DQ-1 needed more than a line. This document marked option `a` as recommended while its
requirements, its acceptance criteria and DR-099 were written as if option `b` had been
taken. The chief-of-staff agent session settled that in favour of the option already marked,
and the selection came with a rewrite: the title, the scope sentence, the Context sections
that describe the split, FR-3 to FR-5, FR-8, FR-9, AC-2 to AC-4, AC-7, INV-1, INV-6, the new
INV-7, the Test section and DR-099 now describe the three-check v1, and what was first written
for the metric checks is kept under [Deferred to v2](#deferred-to-v2). A reader who wants
option `b` instead changes DQ-1 and restores those requirements before approving.

The same pass corrected statements in the first drafts of this spec and of DR-099 that the
code, the issue and the register do not support. Stage 3 already has findings that warn
without failing (Context; hence INV-5's second half and AC-9). `MINSPEC_GATE_OFF=1` is not
the hook's only switch, as DR-099 had said it was (FR-10, DQ-2). A new block has to be
argued, because earlier records state an advisory default, and the first drafts treated
blocking as given (Why a DR; DR-099). And #1555 does not itself cite the constitution's
goals, nor recommend a three-check first release (Context, DQ-1).

The pass also made explicit what the first draft left to inference: FR-5 says when each check
applies; FR-8 says what a real finding is; FR-2 says what it means for the typecheck as
written, and sends the design of that to Plan (#2471); AC-10, AC-11 and AC-12 pin DQ-3, DQ-2
and FR-2's staged content; and INV-8 with AC-13 names an existing rule this change must not
break. None of these is a recorded selection. A reader who disagrees with one changes it
before approving.

### DQ-1 (scope) — v1 tool roster breadth

**Recorded selection: Option `a`,** the three blocking checks only: `shellcheck`, `actionlint`
and the project-native typecheck (`tsc`). Option `b` is not taken, so no metric check is built
by this spec; the deferred checks are tracked as
[#2463](https://github.com/AIClarityAU/minspec/issues/2463) and listed under
[Deferred to v2](#deferred-to-v2). The reasons recorded with the selection: it is the option
this document already recommended; it builds the stage end to end (FR-1 to FR-7) with three
tool integrations instead of the full table's eight; and it asks an adopter to install three
tools, not eight, which also shrinks the surface for the failure #1555 names, a project that
believes it has quality gating while every check silently skips.

- **`a` — ship only the three near-zero-false-positive, blocking checks in v1: shellcheck,
  actionlint, project-native typecheck (rec).** These are the three checks #1555 recommends
  blocking on in "the first release". The option is narrower than the issue, which recommends
  shipping the metric checks warn-only in that same release. **Cost:** the
  DRY/atomicity/dead-code motivations that opened #1555 — jscpd, complexity/function-length,
  madge, knip/ts-prune — stay unbuilt until a v2. Mitigate by filing the v2 tracking issue in
  the same breath Clarify picks this option, so the deferral does not silently evaporate
  (DR-023: "Prose-only follow-ups are not allowed to stand"). It was filed as #2463 when this
  selection was recorded.
- **`b` — ship the full eight-tool table from #1555 in one spec/implementation.** **Cost:**
  a much larger per-commit adopter install/education burden, a bigger surface for the risk
  #1555 itself names (a project "can believe it has quality gating while every check is
  silently skipping"), and a single Plan/Tasks/Implement cycle that has to get eight tool
  integrations right at once instead of three. This option is what #1555 itself recommends
  for the first release, with the metric checks warn-only.

### DQ-2 (policy) — bypass surface

**Recorded selection: Option `a`,** Stage 4 reuses `MINSPEC_GATE_OFF=1` and gets no bypass
variable of its own (FR-10, AC-11). Re-checked against the three-check v1: every v1 check is
of the blocking class this option's cost was written about, so the selection holds, and its
cost applies from v1 on.

- **`a` — Stage 4 reuses `MINSPEC_GATE_OFF=1`, no new env var (rec).** **Cost:** a rare false
  positive on a *blocking* Stage-4 check (shellcheck/actionlint/typecheck — chosen precisely
  for near-zero false-positive rate), or a true finding the developer does not want to fix in
  that commit, has no scoped escape hatch (v1 has no config switch either, FR-9); the only
  bypass available also disables Stage 2's secret scan, which is the exact
  training-toward-the-dangerous-bypass risk #1555 warns about, just rarer because blocking
  checks were chosen for low false-positive rate rather than eliminated entirely.
- **`b` — add a `QUALITY_GATE_OFF=1` bypass scoped to Stage 4 only.** **Cost:** a second bypass
  environment variable is gate-surface proliferation — more ways a required-in-spirit check can
  be silently skipped, each one needing its own audit trail in any future gate-hygiene sweep
  (the class SPEC-054 exists to catch). "A second" counts the variables that would skip
  Stage 4. It would not be the hook's first scoped switch: Stage 0 and Stage 1 each have one
  (FR-10).

### DQ-3 (UX) — reporting cadence

**Recorded selection: Option `a`,** the full per-check roster on every commit (FR-3, AC-10).
Re-checked against the three-check v1: the roster is at most three lines, one per check that
applies, and a line says the check passed, was BLOCKED or was SKIPPED. WARNED has no producer
until v2 (FU-5).

- **`a` — print the full per-check RAN/WARNED/BLOCKED/SKIPPED roster on every commit (rec).**
  Matches the #1538 "show your evidence" precedent directly and is the cheapest to implement
  correctly (no session-state to track). **Cost:** up to three extra stderr lines on every
  commit in a fully-configured v1 project (up to eight once v2 adds the metric checks), in
  tension with Principle 4 ("avoid nagging") at high commit frequency.
- **`b` — condense to one summary line when everything ran clean, full roster only on a
  warn/block/skip.** **Cost:** a "clean" summary line still has to prove it isn't silently
  passing because nothing ran, so it needs its own test asserting the summary line only fires
  when every applicable check genuinely executed.

### DQ-4 (shape) — config key for thresholds/severity

**Recorded selection: Option `a`,** a new top-level `codeQuality` key, kept apart from the
existing `thresholds` key. Re-checked against the three-check v1: no v1 check has a threshold
or an adjustable severity, so v1 adds no key and reads none (FR-9). The selection fixes where
the deferred metric checks' thresholds and opt-into-blocking flag go when v2 builds them
(#2463); the per-check field names and their validation are for that work to pin.

- **`a` — a new top-level `.minspec/config.json` key, e.g. `codeQuality`, holding per-check
  `{ enabled, blocking, ...thresholds }` (rec).** Avoids colliding with the EXISTING
  `thresholds` key (`.minspec/config.json:8-12` in this repo), which already means T1/T2/T3
  ceremony size maxima — a same-name-different-meaning collision would be confusing and risks
  a future merge writing the wrong shape into the wrong consumer. **Cost:** one more top-level
  key to document and validate.
- **`b` — nest under the existing `thresholds` key as a new sub-object
  (`thresholds.codeQuality.jscpd.maxPercent`).** **Cost:** `thresholds.t1Max` (ceremony tier
  size) and `thresholds.codeQuality.jscpd.maxPercent` (duplication percentage) read as
  unrelated concepts sharing one name, which is exactly the kind of prose-shaped ambiguity the
  constitution's enforce-don't-trust-the-model stance exists to avoid in code, not just prose.

## Deferred to v2

Under DQ-1's recorded selection the metric checks are not built by this spec. They are tracked
as [#2463](https://github.com/AIClarityAU/minspec/issues/2463). Nothing in this section is a
v1 requirement or a v1 acceptance criterion. It is kept because it is the reasoning #1555
opened with, and the v2 work starts from it.

| Check | Tool named in #1555 | What it would enforce |
|---|---|---|
| Copy-paste / duplication | `jscpd` | DRY, with a real threshold |
| Cyclomatic complexity and function length | eslint `complexity` / `max-lines-per-function`; `radon` (Python) | atomicity: small units that do one thing |
| Circular dependencies | `madge` | module boundaries |
| Dead code / unused exports | `knip`, `ts-prune` | dead-code hygiene |

#1555's table also lists project-native lint (`eslint`, `ruff`) in the same row as the
typecheck. v1 takes only the typecheck from that row, and this spec never assigned general
lint to a class, so whether it joins Stage 4 is left to the v2 work as well. So are the
Python markers (`pyproject.toml`, `setup.cfg`, a staged `*.py`), which the first draft listed
under FR-5 and which select only `radon` and `ruff`.

What was first written for these checks, kept as follow-up items:

- **FU-1 (default severity: metric checks warn).** A check whose finding is a metric crossing
  a threshold (duplication %, cyclomatic complexity, function length, circular-dependency
  count, unused-export count) warns only and never blocks, unless the project's
  `.minspec/config.json` explicitly opts that specific check into blocking. This was the
  second half of FR-8 as first written. The reason is #1555's own: complexity and duplication
  limits produce false positives "constantly" (switch statements, generated files,
  genuinely-similar-but-not-identical branches), and a developer who hits one mid-commit
  reaches for `MINSPEC_GATE_OFF=1`, which disables Stage 2's secret scan in the same
  keystroke. DR-099 records this as the policy for the class.
- **FU-2 (thresholds are config-adjustable, lenient by default).** Every metric check's
  threshold is overridable per project via `.minspec/config.json`, under the key DQ-4 selects.
  Shipped defaults are lenient: the risk named in #1555 is a gate strict enough to be switched
  off, and a switched-off gate protects nothing (Stage 0's own "a gate that over-blocks gets
  switched off" reasoning, `template-registry.ts:1211-1212`, applies here verbatim). This was
  FR-9 as first written.
- **FU-3 (a metric finding warns and the commit succeeds).** A repo with `jscpd` resolvable
  and a staged pair of near-duplicate files exceeding the default duplication threshold: the
  commit SUCCEEDS, and a warning naming `jscpd` and the two files is printed to stderr. This
  was AC-2 as first written.
- **FU-4 (opting a metric check into blocking).** A project's `.minspec/config.json` opting a
  metric check into `blocking: true` causes that check's threshold violation to refuse the
  commit instead of warning, on the same fixture as FU-3. This was AC-7 as first written.
- **FU-5 (the roster's fourth state).** FR-3's report gains "it ran and warned (with the
  finding)" for these checks, and DQ-3's roster gains WARNED. Both were in FR-3 and DQ-3 as
  first written.

Why these wait, where #1555 would ship them warn-only in the first release, is DQ-1 option
`b`'s cost: a larger install and education burden for an adopter, a bigger surface for a
project that believes it has quality gating while every check silently skips, and one
Plan/Tasks/Implement cycle that has to get eight tool integrations right at once instead of
three. The price of waiting is DQ-1 option `a`'s cost: until v2 is built, nothing MinSpec
scaffolds measures duplication, complexity, circular dependencies or dead code.

## Test

T0 (owned by this spec): `packages/minspec/tests/pre-commit-code-quality-stage.test.ts` — drives
the real `PRE_COMMIT_HOOK` managed-region content against fixture repos, one per acceptance
criterion above except AC-13. Every criterion is a v1 criterion: nothing under
[Deferred to v2](#deferred-to-v2) gets a fixture here, and AC-2 and AC-7 are the two that
prove the deferral holds (a resolvable metric tool is not run; a config key changes nothing).
It MUST include, as a control, a fixture proving Stage 3's own pass/fail verdict and its
warn-only output are byte-identical before and after Stage 4's insertion
(INV-5/AC-5/AC-6/AC-9). Without that control the suite could pass by never actually
exercising Stage 3 at all, which is how a test of a gate that changes what runs passes
vacuously. AC-13 extends the existing `scaffold-is-committable.test.ts`, which this spec
affects and does not own. It needs both tools where the suite runs, and CI installs
`actionlint` only inside its own job today (`.github/workflows/ci.yml:141-152`), so Plan MUST
say where the suite gets them: a case that only ever reports skipped does not prove INV-8.
