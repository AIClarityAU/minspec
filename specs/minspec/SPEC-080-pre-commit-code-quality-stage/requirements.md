---
id: SPEC-080
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-003  # SDD Core Methodology — DR-037, the pre-commit gate harness this adds a stage to, is itself epic: EPIC-003 (docs/decisions/DR-037.md:2)
aspects: [harness, gate, pre-commit, code-quality, tier-0, no-silent-gate, opportunistic-tool, config, offline, dry, complexity]
relates_to: [DR-037, DR-066, DR-099, SPEC-054, SPEC-066, SPEC-075]
implements: [packages/minspec/tests/pre-commit-code-quality-stage.test.ts]  # NEW — the T0 this spec owns
affects: [packages/minspec/src/lib/template-registry.ts, .minspec/hooks/pre-commit, .minspec/config.json]  # template-registry.ts is claimed by no spec's implements:; follows SPEC-066/SPEC-075/SPEC-063 precedent of affects:-only for this shared file
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — A deterministic, offline code-quality stage extends the scaffolded pre-commit gate; correctness blocks, metrics warn (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, template, or test is created by this
> document. It is the Specify-phase artifact for
> [#1555](https://github.com/AIClarityAU/minspec/issues/1555), which the deterministic triage
> gate classified T3/T4 and authorised Specify-phase-only (DR-076 / #1169) — so the spec is the
> gate, not the fix.

## One-Sentence Scope

Add a fourth, opportunistic, offline stage to the scaffolded `.minspec/hooks/pre-commit` gate
that runs deterministic (non-LLM) code-quality checks over the staged tree — language-detected,
config-adjustable, with deterministic-correctness checks (shell/workflow syntax, typecheck)
blocking and metric checks (duplication, complexity, circular deps, dead code) warning by
default — so DRY, atomicity, and dead-code hygiene are enforced by a parser instead of restated
as unenforceable constitution prose.

## Context

### Why this and not constitution prose — the issue's own framing

#1555 opens by asking whether the constitution should carry principles like DRY, atomicity, or
SDD, and argues mostly not, citing the constitution's own Principle 8 ("Don't hope an LLM will
follow rules — enforce it via code") and Goal G-1 ("AI-slop guardrails... write-time
enforcement") / G-2 ("prevent tech debt") / G-6 ("determinism as moat") — all present in
`.minspec/constitution.md` today. A prose principle restating SDD is redundant (SDD already is
the tiering/phase/validator machinery); a prose principle restating DRY is exactly the
model-trusted, universally-true, unenforceable text the constitution's own enforcement
philosophy exists to avoid. The half of the idea worth building is the enforceable half: a
copy-paste / complexity / dead-code detector applied deterministically at commit time, "with a
number," the same way the existing pre-commit stages already enforce spec frontmatter and secret
scanning rather than asking for either in prose.

### The harness this extends, measured

`.minspec/hooks/pre-commit` is a managed-region template (`template-registry.ts`,
`name: 'pre-commit-hook'`, `outputPath: .minspec/hooks/pre-commit`) established by
[DR-037](../../../docs/decisions/DR-037.md) (`epic: EPIC-003`). Read directly
(`packages/minspec/src/lib/template-registry.ts:1183-1540`), it runs **four** stages today, not
the three #1555 names:

| # | Stage | What it does | Fails on |
|---|---|---|---|
| 0 | Protected-branch guard | Refuses an authored commit on the push-protected default branch | Always (no opt-out tool) |
| 1 | Author-identity gate | Opt-in allowlist of author emails | Always, once opted in |
| 2 | Secret scan (`gitleaks`) | Blocks on a finding; **opportunistic** — absent tool warns and continues | Finding present |
| 3 | SDD validation | Highest-fidelity validator available (Node → python3 → shell), each tier `exit $?`s directly (`template-registry.ts:1529,1535,1540`) | Spec/DR frontmatter or egress violation |

#1555's own table calls the secret scan "Stage 1" and SDD validation "Stage 2", omitting the
author-identity gate (Stage 1 in the live code) — a plausible-inference slip, not a
deliberate renumbering (Evidence Discipline / CLAUDE.md). This spec's Functional Requirements
below therefore refer to the new work as **Stage 4**, matching the code as it exists, and the
requirements/fixtures Plan derives from this spec must not accidentally mean "insert before the
existing Stage 3" because of the issue's off-by-one.

### The architectural obstacle a new stage runs into

Stage 3's three tiers each call `exit $?` directly the moment they run
(`template-registry.ts:1526-1540`, all three fall-through branches). Appending a Stage 4 after
Stage 3 in the shell script as written today is a no-op — the process has already exited. FR-6
below exists because of this, cited with line numbers so Plan does not have to rediscover it.

### The graceful-degrade precedent already in this hook

Stage 2 (gitleaks) already establishes the shape #1555 asks Stage 4 to reuse
(`template-registry.ts:1428-1450`): tool present → run it, block on a real finding; tool absent
→ print one `⚠` advisory line naming what was skipped and why, then continue. #1538
(`fix(#1538): make the secret gate show the finding it blocks on`, commit `a3e63968`) is the
project's own lesson that a gate's *evidence* — not just its verdict — must be visible; this
spec's FR-3 generalises that lesson to Stage 4's larger tool roster, where silent all-tools-
skipped is a materially bigger risk (one tool vs. up to eight).

### Constitution invariants this spec is answerable to

- **Invariant 1 (offline).** Every Stage-4 check must run against the staged tree with no
  network call — the same bar Stage 2/3 already clear.
- **Invariant 2 (no silent gate).** A check that is applicable (language detected) and whose
  tool is available must never run and have its result go unreported — pass, warn, or block,
  never swallowed. A missing witness (tool not installed) fails the *gate* open (never blocks
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
count) **warn** until a project explicitly opts a check into blocking, because those checks
produce false positives "constantly" (switch statements, generated files, genuinely-similar-but-
not-identical branches) and a developer who hits one mid-commit reaches for
`MINSPEC_GATE_OFF=1` — which disables Stage 2's secret scan in the same keystroke. This spec
adopts that split as its baseline (FR-8) rather than re-deriving it, and records the remaining
open design surface — exact v1 tool roster, config key shape, bypass surface, reporting
cadence — under Decisions needed below, because the issue itself does not resolve those and a
spec asserting a resolution nobody decided would be exactly the ungrounded-declarative class
Evidence Discipline warns against.

### Why a DR, not just this spec

DR-037's four existing stages are each **block-or-skip**: a tool present always blocks on a
real finding (branch guard, author identity, gitleaks, SDD validation all do), and the only
non-blocking outcome is *tool absence*. Stage 4 introduces a new outcome this harness has never
had: a check **runs, finds a real, tool-confirmed violation, and does not block by design**
(the metric-check warn path). That is a new enforcement policy for this harness, not an
application of the existing one to a new file — the same distinction SPEC-075 draws when it
argues "applying an existing posture to one file" does *not* need a new DR, and the mirror
case here is that inventing a **new** class of outcome *does*. [DR-099](../../../docs/decisions/DR-099.md)
(accompanying this spec, status `proposed`) records that decision and its rejected alternatives;
this spec is the normative requirements text, DR-099 is the rationale and price.

## Functional Requirements

- **FR-1 (Stage 4 exists, opportunistic per tool).** `.minspec/hooks/pre-commit` MUST gain a
  Stage 4 that runs after Stage 3 completes (not instead of, not interleaved). Each check
  within Stage 4 MUST be independently opportunistic: if its tool is not resolvable
  (`command -v` / `npx --no-install`, mirroring Stage 2's and Stage 3's own probes), that one
  check is skipped and Stage 4 continues to the next — an absent tool for one check MUST NOT
  skip or block any other check.

- **FR-2 (staged-tree scope only).** Every Stage-4 check MUST operate over `git diff --cached`
  (the staged tree), never the full working tree, matching Stage 3's `minspec_shell_gate` scope
  discipline (`template-registry.ts:1469`) and keeping the stage fast.

- **FR-3 (visible roster — the #1538 lesson applied to a larger tool set).** For every check
  that IS applicable (its language/file-type is present in the staged set), Stage 4 MUST report
  one of: it ran and passed, it ran and warned (with the finding), it ran and blocked (with the
  finding), or it was SKIPPED because its tool is not resolvable (with the tool name and an
  install pointer). A check that is applicable must never go unreported. (Exact cadence —
  every commit vs. condensed — is DQ-3.)

- **FR-4 (non-applicable is silent, applicable-but-missing is not).** A check whose
  language/file-type is entirely absent from the project (e.g. no `pyproject.toml` and no
  staged `.py` file) MUST produce no output at all — never a nag for a check that could never
  apply. This is the opposite case from FR-3 and the two must not be conflated: "not
  applicable" is silent, "applicable but the tool is missing" is a visible, named skip.

- **FR-5 (language detection, not project-type configuration).** Applicability is determined by
  presence of the relevant marker file(s) (`tsconfig.json`, `pyproject.toml`/`setup.cfg`,
  a staged `*.sh`, a staged `.github/workflows/*.yml`) — never a new required config field a
  project must set before Stage 4 does anything.

- **FR-6 (Stage 3's control flow must survive Stage 4's insertion).** Stage 3's three tiers
  (`template-registry.ts:1526-1540`) each `exit $?` directly today; this MUST change to
  capturing that exit code into a variable so Stage 4 can run afterward, and the hook's final
  exit code MUST be non-zero if Stage 3 failed, OR Stage 4 blocked, or both — Stage 4 passing
  MUST NOT mask a Stage-3 failure, and Stage 3 passing MUST NOT be reported as the whole
  commit's verdict if Stage 4 then blocks.

- **FR-7 (offline, no new dependency in the shipped package).** No Stage-4 check may perform a
  network call. `packages/minspec`'s own `package.json` MUST NOT gain a new runtime dependency
  because of this change — every Stage-4 tool is an externally-installed CLI the hook probes
  for opportunistically (FR-1), exactly like `gitleaks` (Stage 2) and the Node-tier SDD
  validator (Stage 3) already do.

- **FR-8 (default severity: correctness blocks, metrics warn).** Absent project config, a
  check whose finding has near-zero false-positive risk (shell syntax, GitHub Actions workflow
  syntax, project-native typecheck) MUST block the commit on a real finding. A check whose
  finding is a metric crossing a threshold (duplication %, cyclomatic complexity, function
  length, circular-dependency count, unused-export count) MUST warn only, never block, unless
  the project's `.minspec/config.json` explicitly opts that specific check into blocking.

- **FR-9 (thresholds are config-adjustable, lenient by default).** Every metric check's
  threshold MUST be overridable per project via `.minspec/config.json` (exact key shape: DQ-4).
  Shipped defaults MUST be lenient — the risk named in #1555 is a gate strict enough to be
  switched off, and a switched-off gate protects nothing (Stage 0's own "a gate that over-blocks
  gets switched off" reasoning, `template-registry.ts:1204-1206`, applies here verbatim).

- **FR-10 (one bypass surface, pending DQ-2).** Stage 4 MUST NOT default to minting a new
  bypass environment variable distinct from `MINSPEC_GATE_OFF=1` unless Clarify decides
  otherwise (DQ-2) — an additional bypass is exactly the gate-surface proliferation the
  "no silent gate" invariant's "no required check hinges on a single [bypassable] producer"
  language warns against in spirit, even though Stage 4 is not itself a *required* CI check.

## Acceptance Criteria

- **AC-1.** A repo with `tsconfig.json` and a staged `.ts` file containing a real type error:
  the commit is refused, and the printed message names the file, the line, and that the
  typecheck tool produced it.
- **AC-2.** A repo with `jscpd` resolvable and a staged pair of near-duplicate files exceeding
  the default duplication threshold: the commit SUCCEEDS, and a warning naming `jscpd` and the
  two files is printed to stderr.
- **AC-3.** A repo with no `tsconfig.json`, no `pyproject.toml`/`setup.cfg`, and no staged
  `.sh` or `.github/workflows/*.yml` file: Stage 4 produces zero output and does not affect the
  exit code.
- **AC-4.** A repo with `tsconfig.json` present but no typecheck tool resolvable via
  `command -v`/`npx --no-install`: Stage 4 prints exactly one skip line naming the tool and
  does not block.
- **AC-5.** A fixture where Stage 3 fails (e.g. a staged spec missing `id: SPEC-NNN`) and every
  Stage-4 check passes: the commit is still refused, proving FR-6's exit-code capture does not
  let Stage 4 mask a Stage-3 failure.
- **AC-6.** A fixture where Stage 3 passes and a Stage-4 blocking check (e.g. `shellcheck` on a
  staged `.sh` file with a real syntax error) fails: the commit is refused.
- **AC-7.** A project's `.minspec/config.json` opting a metric check into `blocking: true`
  (shape per DQ-4) causes that check's threshold violation to refuse the commit instead of
  warning, on the same fixture that produced AC-2's warn-only result.
- **AC-8.** `git diff` of `packages/minspec/package.json` before and after this change's
  implementation shows no added `dependencies`/`devDependencies` entries attributable to Stage
  4 (FR-7).

## Invariants

- **INV-1 (no silent gate, constitution invariant 2).** An applicable, tool-available check's
  result (pass/warn/block) is always visible; only "check not applicable" is silent (FR-3/FR-4).
- **INV-2 (opportunistic degrade, DR-037 precedent).** A missing optional tool never blocks a
  commit; it degrades to exactly one printed advisory line per missing tool.
- **INV-3 (offline, constitution invariant 1).** No Stage-4 check performs a network call.
- **INV-4 (blast radius, constitution invariant 3).** Stage 4 ships only inside the managed
  `.minspec/hooks/pre-commit` region; it changes behaviour only in a project that already has
  `.minspec/` at its root. Unchanged by this spec — recorded because it is easy to assume a
  gate-harness change needs its own opt-in check when the existing one already covers it.
- **INV-5 (Stage-3 verdict preserved).** For any staged tree that would have passed or failed
  Stage 3 before this change, Stage 3's own verdict is unchanged after Stage 4 is inserted
  (FR-6, AC-5).
- **INV-6 (one owner per shared file).** This spec owns only the new Stage-4 test;
  `template-registry.ts` and `.minspec/config.json` stay `affects:`, consistent with
  SPEC-066/SPEC-075/SPEC-063's precedent for this same file.

## Decisions needed (Clarify)

### DQ-1 (scope) — v1 tool roster breadth

- **`a` — ship only the three near-zero-false-positive, blocking checks in v1: shellcheck,
  actionlint, project-native typecheck (rec).** Matches the issue's own recommendation
  literally (it recommends blocking only these three in "the first release"). **Cost:** the
  DRY/atomicity/dead-code motivations that opened #1555 — jscpd, complexity/function-length,
  madge, knip/ts-prune — stay unbuilt until a v2. Mitigate by filing the v2 tracking issue in
  the same breath Clarify picks this option, so the deferral does not silently evaporate
  (CLAUDE.md's "Prose-only follow-up leak" lesson).
- **`b` — ship the full eight-tool table from #1555 in one spec/implementation.** **Cost:**
  a much larger per-commit adopter install/education burden, a bigger surface for the
  "believes it has quality gating while every check silently skips" risk #1555 itself names,
  and a single Plan/Tasks/Implement cycle that has to get eight tool integrations right at
  once instead of three.

### DQ-2 (policy) — bypass surface

- **`a` — Stage 4 reuses `MINSPEC_GATE_OFF=1`, no new env var (rec).** **Cost:** a rare false
  positive on a *blocking* Stage-4 check (shellcheck/actionlint/typecheck — chosen precisely
  for near-zero false-positive rate) has no scoped escape hatch; the only bypass available also
  disables Stage 2's secret scan, which is the exact training-toward-the-dangerous-bypass risk
  #1555 warns about, just rarer because blocking checks were chosen for low false-positive
  rate rather than eliminated entirely.
- **`b` — add a `QUALITY_GATE_OFF=1` bypass scoped to Stage 4 only.** **Cost:** a second bypass
  environment variable is gate-surface proliferation — more ways a required-in-spirit check can
  be silently skipped, each one needing its own audit trail in any future gate-hygiene sweep
  (the class SPEC-054 exists to catch).

### DQ-3 (UX) — reporting cadence

- **`a` — print the full per-check RAN/WARNED/BLOCKED/SKIPPED roster on every commit (rec).**
  Matches the #1538 "show your evidence" precedent directly and is the cheapest to implement
  correctly (no session-state to track). **Cost:** up to 3-8 extra stderr lines on every
  commit in a fully-configured project, in tension with Principle 4 ("avoid nagging") at high
  commit frequency.
- **`b` — condense to one summary line when everything ran clean, full roster only on a
  warn/block/skip.** **Cost:** a "clean" summary line still has to prove it isn't silently
  passing because nothing ran (the vacuous-pass shape #1050/#1538 both name) — needs its own
  test asserting the summary line only fires when every applicable check genuinely executed.

### DQ-4 (shape) — config key for thresholds/severity

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

## Test

T0 (owned by this spec): `packages/minspec/tests/pre-commit-code-quality-stage.test.ts` — drives
the real `PRE_COMMIT_HOOK` managed-region content against fixture repos, one per acceptance
criterion above. It MUST include, as a control, a fixture proving Stage 3's own pass/fail
verdict is byte-identical before and after Stage 4's insertion (INV-5/AC-5/AC-6) — without that
control the suite could pass by never actually exercising Stage 3 at all, the vacuous-pass shape
a coverage-changing gate produces by construction (CLAUDE.md "Tests can pass vacuously").
