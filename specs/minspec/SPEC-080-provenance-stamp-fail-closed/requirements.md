---
id: SPEC-080
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — a swallowed provenance failure is DR-066's
                # "no silent gate" family, one layer under SPEC-060's build-stamp work
relates_to: [SPEC-060, SPEC-054, DR-003, DR-066]
# Ownership: FR-1/FR-2 touch files SPEC-060 already declared `implements:`
# (scripts/build-extension.sh, packages/minspec/src/lib/build-provenance.ts,
# packages/minspec/src/extension.ts). SPEC-060 is `plan: in-progress`, not yet
# implemented for these two files' present shape, so no live approval hash is at
# risk — but this spec does NOT re-declare `implements:` on them (SPEC-038 FR-3):
# doing so would create the exact dual-ownership collision DR-038/SPEC-038 exists
# to prevent. See "Decisions needed" DQ-1 for how Plan should reconcile this with
# SPEC-060 rather than silently forking ownership.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — A build that cannot prove its own commit must fail, not ship stamped "unknown" (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch that
> produced it (role:dev, dispatched Specify-only per DR-076/#1169 tier gate). A human reads
> this spec, resolves **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves
> it through the normal spec-approval gate before anything is built.

> Materializes **[#1517](https://github.com/AIClarityAU/minspec/issues/1517)** — surfaced while
> grounding SPEC-060's Clarify decisions against merged code (#1477, merged
> 2026-08-14T04:33:21Z). Related: [#1504](https://github.com/AIClarityAU/minspec/issues/1504).
> Builds on [SPEC-060](../SPEC-060-build-provenance-stamp/requirements.md) (stamp-and-surface
> build provenance) and depends on the linter [SPEC-054](../SPEC-054-gate-signal-linter/requirements.md)
> names (see DQ-1 — SPEC-054 is not yet implemented; `scripts/check-gate-signals.ts` does not
> exist in this worktree).

## One-Sentence Scope

A packaged build whose commit cannot be determined must fail the build visibly instead of
shipping stamped `unknown`, the running extension must say something when it cannot prove its
own build's provenance instead of staying silent, and the class of shell-script fallback that
produced this bug in the first place — `cmd || echo <default>` on a load-bearing signal — must
become mechanically detectable so the next instance reds instead of shipping.

## Context

Grounded in the current code, with `file:line` evidence — several citations below correct
citations in the issue body that had drifted from the file as it stands in this worktree
(the file grew between when #1517 was filed and this spec being written; RCDD calls for citing
the code, not trusting a prior citation).

### The fallback: `scripts/build-extension.sh:29`

```bash
sha="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
```

The comment eight lines above it (`:26-28`) already names the hazard for the *dirty-tree* case
("silently stamping the last commit would misreport what is actually running") but the very
next statement commits the sibling failure for the *no-commit-at-all* case: when `git rev-parse`
fails — no `.git`, a detached worktree missing its object store, `git` absent from `PATH` — the
error is swallowed and the string `unknown` becomes the stamp, indistinguishable at every
downstream consumer from a real (if unresolvable) SHA. This is constitution invariant #2's
first clause by name: *"no load-bearing gate signal is written with a swallowed error
(`|| true`)"* — `|| echo unknown` is the same shape with a friendlier spelling.

The script already contains, four lines later (`:30-32`), the *pattern this spec asks it to
extend*: a dirty tree does not silently reuse a stamp that would misdescribe the build — it
mutates the stamp to say so (`-dirty` suffix). A `git rev-parse` failure gets no equivalent
treatment; it is simply absorbed.

### The runtime surface stops at one verdict kind: `packages/minspec/src/extension.ts:736`

```ts
const verdict = detectBuildSkew(folder, isMinspecRepo);
if (verdict.kind !== 'stale') return;
```

(Line 736 in this worktree — the issue body cited `:690`; the file has grown since #1517 was
filed.) `detectBuildSkew` (`packages/minspec/src/lib/build-provenance.ts:99-145`) returns four
verdict kinds — `not-applicable`, `current`, `stale`, `unknown` — and `surfaceBuildSkewAdvisory`
acts on exactly one of them. A build stamped `unknown` (whether from this bug, a shallow clone,
or a build whose commit this checkout has never seen) produces the identical "nothing happens"
outcome as a build that is perfectly current. The two are not distinguishable to the person
looking at the editor, which is the exact false-signpost class SPEC-060 and this repo's
evidence-discipline convention (CLAUDE.md, "Evidence Discipline") both exist to remove.

### The gate-signal linter this bug should have tripped does not exist yet

[SPEC-054](../SPEC-054-gate-signal-linter/requirements.md) (`status: planning`, `plan:
in-progress`, `implement: pending`) specifies `scripts/check-gate-signals.ts` — verified absent
from this worktree (`ls scripts/check-gate-signals*` → no such file). So the issue's claim that
"nothing enforces [invariant #2] on shell scripts" is doubly true right now: not only does
SPEC-054's linter not cover shell scripts for *this* pattern, SPEC-054's linter does not exist
in any form yet. FR-3 below is scoped against SPEC-054's **eventual** shape, not against
present code, and DQ-1 asks Plan to resolve the sequencing rather than let two specs each half-own
the same future file.

Separately: SPEC-054 FR-1, as specified, only classifies a write as gate-relevant when it POSTs a
*commit status, check-run, or gate-relevant label*. A shell variable assignment like
`sha="$(cmd || echo unknown)"` is none of those three — it is a **local provenance value**, not
a network-visible gate signal. SPEC-054's existing FR-1 predicate would not catch this bug even
once implemented, exactly as filed. Widening it to catch this shape is new scope, not a
one-line addition to an existing rule (see FR-3 and DQ-1).

### The `unknown` verdict already fires in every workspace, not only the dogfood one — a live blast-radius risk for FR-2

`surfaceBuildSkewAdvisory`'s dogfood gate (`extension.ts:734`) is
`fs.existsSync(path.join(folder, '.minspec', 'constitution.md'))`. Every repo that has run
**MinSpec: Init** has that file (`scaffold.ts` writes it into every adopter, not only this
repo), so the predicate is true in every consumer workspace today — a defect already recorded
and normatively resolved at [SPEC-060 DQ-4](../SPEC-060-build-provenance-stamp/requirements.md#decisions-needed-clarify),
but **not yet implemented** (verified: `extension.ts:734` still reads exactly the
`existsSync` check DQ-4 describes as the bug). Today that predicate bug is harmless in practice
only because line 736 discards every verdict except `stale`, and a consumer's installed build
can almost never appear `stale` against a repo it was never built from (it is normally
`unknown`, silently dropped). **If FR-2 below ships before SPEC-060 DQ-4's predicate fix
lands, that silence is exactly what stops being silent** — every consumer workspace that ran
Init would start surfacing an "unknown build provenance" notice on every activation, which is
a constitution invariant #3 (blast radius) violation this spec must not introduce. This
sequencing dependency is normative, not a nice-to-have — see FR-2's MUST-NOT clause and DQ-2.

## Functional Requirements

- **FR-1 (fail the build when the commit cannot be determined).** `scripts/build-extension.sh`
  MUST exit non-zero and produce no `.vsix`/bundle output when `git rev-parse HEAD` fails,
  rather than stamping the literal string `unknown` and proceeding. The failure message MUST
  name the cause (git absent, not a checkout, or the underlying git error) so the operator does
  not have to reverse-engineer it from a downstream symptom. *Rationale: constitution invariant
  #2, clause 1 — a load-bearing signal (the provenance stamp) must not be written through a
  swallowed error.*
- **FR-2 (a genuinely unresolvable stamp gets a runtime surface, but only once it is safe to).**
  `surfaceBuildSkewAdvisory` MUST act on `verdict.kind === 'unknown'` as well as `'stale'`,
  informationally distinguishing the two (an `unknown` build is not necessarily behind — it may
  be a shallow clone or a different repo entirely — so the copy must not claim staleness it
  cannot prove; see `detectBuildSkew`'s own doc comment at `build-provenance.ts:113-118` on why
  `unknown` must never be reworded as `stale`). **FR-2 MUST NOT ship ahead of, or independently
  of, the `isMinspecRepo` predicate fix that [SPEC-060 DQ-4](../SPEC-060-build-provenance-stamp/requirements.md#decisions-needed-clarify)
  already specifies** — shipping FR-2 first turns that pre-existing, currently-silent predicate
  bug into an active blast-radius violation (every consumer-repo activation surfacing a
  provenance notice it has no reason to see). See DQ-2 for how Plan sequences this.
  *Rationale: the issue's stated defect — "an unverifiable stamp produces nothing at build time
  and nothing at run time" — is only half of what needs fixing without also closing the
  blast-radius gap FR-2 would otherwise open.*
- **FR-3 (extend gate-signal-style detection to shell-script provenance fallbacks).** A
  deterministic, offline check MUST flag a shell assignment of the shape
  `<var>="$(<cmd> ... || echo <default>)"` (or the `|| printf`/`|| :`-suffixed equivalents) in
  `scripts/**.sh` when `<var>` is subsequently used as a provenance or gate-relevant value (e.g.
  baked into a build artifact via `--define`, written to a signpost file, or otherwise read by
  a consumer that cannot tell "real value" from "the fallback string") — unless the line carries
  an explicit allow-annotation naming why the fallback is safe. **Where this check lives is a
  Clarify decision (DQ-1), not assumed here**: SPEC-054 already claims
  `scripts/check-gate-signals.ts` under `implements:` and is unimplemented, so this spec must not
  silently fork a second, competing owner of that file. *Rationale: issue's fix (3) — "the next
  `|| echo <default>` on a load-bearing signal reddens instead of shipping."*
- **FR-4 (escape hatch is opt-in, not inherited).** If a non-git build path is ever wanted (e.g.
  packaging from a source tarball with no `.git`), it MUST be an explicit flag/env var the
  invoker states deliberately (e.g. `--allow-unstamped`), never a default fallback a failure
  silently exercises. FR-1's failure is the default in the absence of that flag. *Rationale:
  issue's own fix (1), second sentence — matches the CLAUDE.md commit-msg gate's own escape-hatch
  convention (`RCDD_GATE_OFF=1`), an explicit, named, opt-in bypass rather than a silent one.*

## Acceptance Criteria

- **AC-1 (FR-1, the exact repro).** Running `scripts/build-extension.sh` with `git` unresolvable
  (`PATH` scrubbed of it, or run outside any git checkout) exits non-zero, writes no `out/*.js`
  bundle, and prints a message identifying that the commit could not be determined.
- **AC-2 (FR-1, negative — unaffected path).** The existing dirty-tree behaviour
  (`build-extension.sh:30-32`, the `-dirty` suffix) and the existing post-build stamp-verification
  check (`build-extension.sh:86-91`) are unchanged for a normal, resolvable `git rev-parse`.
- **AC-3 (FR-2, unknown surfaces).** With `detectBuildSkew` returning `{kind: 'unknown', ...}`
  in a fixture where the dogfood predicate is true, `surfaceBuildSkewAdvisory` shows a
  notification distinct in wording from the `stale` case (no claim of "N commits behind").
- **AC-4 (FR-2, still scoped — the blast-radius negative).** The same `unknown` fixture, with the
  dogfood predicate false (a normal consumer workspace, post-DQ-4-fix predicate), produces no
  notification — mirroring SPEC-060 AC-5's existing negative test, now extended to the `unknown`
  branch.
- **AC-5 (FR-3, true positive).** A fixture `scripts/*.sh` line matching
  `sha="$(git rev-parse HEAD 2>/dev/null || echo unknown)"` (i.e. this exact bug, reproduced as a
  fixture) is flagged by the check with no allow-annotation present.
- **AC-6 (FR-3, negative — the annotated escape hatch).** The same fixture line, carrying a valid
  allow-annotation with a reason, produces zero findings — mirroring SPEC-054 FR-2's
  already-specified annotation shape, reused rather than reinvented (DQ-1).
- **AC-7 (FR-4).** A build invoked with the explicit opt-in flag, under an unresolvable `git`,
  produces an artifact stamped with an unambiguous "unstamped" marker (not the string `unknown`,
  which this spec's own AC-5 fixture now treats as a *finding* string) and does not exit non-zero;
  the same invocation without the flag exits non-zero per AC-1.

## Invariants

- **INV-1 (no silent gate — constitution #2).** A build that cannot prove its commit fails
  visibly and closed, never silently proceeding under a placeholder value; the placeholder
  string `unknown` must not appear as a stamp value anywhere any of FR-1–FR-4 ship, except
  behind FR-4's explicit, named opt-in.
- **INV-2 (Tier-0 / offline — constitution #1).** All of FR-1–FR-4 run against local `git` state
  and local source files only; none calls the network. (`build-extension.sh` already satisfies
  this; FR-3's checker must too, matching SPEC-054's own INV-2.)
- **INV-3 (blast radius — constitution #3).** FR-2's runtime surface must not activate in any
  workspace that is not this repo's own dogfood checkout — this is the concrete instance of
  invariant #3 that DQ-2's sequencing exists to protect, not a restatement of SPEC-060's INV-3
  in isolation.
- **INV-4 (single owner per implementing file — SPEC-038 FR-3).** Whichever spec ends up
  claiming `scripts/check-gate-signals.ts` (or wherever FR-3's checker lands per DQ-1) is
  declared `implements:` by exactly one spec at a time; this spec does not declare it until
  DQ-1 is resolved.

## Decisions needed (Clarify)

- **DQ-1 — Where does FR-3 (shell-script provenance-fallback detection) actually live: as new
  scope folded into SPEC-054 before it ships, as a standalone addition this spec owns once
  SPEC-054 exists, or as its own follow-up issue deferred behind SPEC-054's implementation?**

  SPEC-054 already declares `implements: [scripts/check-gate-signals.ts, ...]` and is
  unimplemented (`plan: in-progress`). This spec's FR-3 describes a **different predicate**
  (a local-variable fallback assignment, not a network-visible status/check-run/label POST) that
  SPEC-054's own FR-1 text, as written, would not catch. Three real options:
  - **Option A — fold FR-3 into SPEC-054 as a new FR before SPEC-054 implements.** Keeps one
    linter, one file, one spec of record for "shell-script gate-signal hygiene." Costs:
    reopens an already-Clarified spec (SPEC-054's seven DQs are settled) to add an eighth
    predicate, and delays this issue's fix until SPEC-054's Plan/Tasks/Implement all move,
    which is a larger unit of work than #1517 alone asked for.
  - **Option B — this spec owns a second, sibling script** (e.g.
    `scripts/check-provenance-fallbacks.ts`) that runs independently of, and is not blocked by,
    SPEC-054's implementation. Costs: two small offline shell-linting scripts instead of one,
    with the attendant risk (already named in SPEC-054 R1/R3) of the "second drifting matcher"
    pattern this repo's own conventions warn against (SPEC-051 INV-5, cited inside SPEC-054
    itself) — a future contributor has to know both exist.
  - **Option C — defer FR-3 to its own follow-up issue, filed now, scoped explicitly to run
    after SPEC-054 ships**, and this spec (SPEC-080) ships only FR-1/FR-2/FR-4 (the
    build-extension.sh and runtime-surface halves). Costs: the class-level fix (any future
    `|| echo <default>` on a provenance variable) stays unenforced for longer, exactly the
    "fixes the instance, not the property" gap the issue's own recommendation warned against
    when it said lead with (3).
  - *Recommendation to confirm:* **Option C (rec)** — split FR-3 out now as a filed follow-up
    (dependent on SPEC-054), and let this spec ship the concrete instance fix (FR-1/FR-2/FR-4)
    without waiting on an unimplemented sibling spec's Plan/Tasks/Implement cycle. Cost of this
    recommendation, stated: it is the issue's own second-choice ordering (pair (1) with (3) was
    the alternative offered), accepted here for the reason the issue itself gave — "the cost of
    leading with (3) is that this specific bad stamp keeps shipping until the linter lands" is
    reversed if C ships FR-1 without waiting for FR-3, so the actual regression risk C accepts
    is only the *next* instance of this bug class elsewhere, not a continuation of this one.

- **DQ-2 — Sequencing FR-2 against SPEC-060 DQ-4's predicate fix: same PR, or a hard blocking
  dependency recorded and enforced how?**

  FR-2's own MUST-NOT clause states the ordering requirement; this DQ is about **how it is
  enforced**, since "record a dependency in prose" is exactly the "trust the model" pattern the
  constitution and this repo's SDD phases exist to not rely on.
  - **Option A — this spec's Plan phase includes the `isMinspecRepo` predicate fix as a
    prerequisite task, done in the same PR as FR-2**, even though the predicate itself is
    SPEC-060's `implements:`-declared territory. Costs: this spec's diff touches a file another
    spec already claims, which needs an explicit cross-spec note (mirroring how SPEC-079 handles
    a shared file via `affects:` rather than `implements:`) to avoid a SPEC-038 ownership
    collision.
  - **Option B — FR-2 is blocked (not merely sequenced) on SPEC-060's own implementation
    reaching the DQ-4 fix, tracked as a dependency this spec's Tasks phase cannot schedule past.**
    Costs: FR-2 ships whenever SPEC-060 gets there, which may be much later than FR-1/FR-4, and
    this issue's fix (2) stays open for that whole window.
  - *Recommendation to confirm:* **Option A (rec)** — the predicate fix is a two-line change
    (`extension.ts:734`) already fully specified by SPEC-060 DQ-4's three normative steps, so
    bundling it removes the sequencing risk directly rather than trusting two independently
    dispatched PRs to land in the right order. Cost: the ownership note above, which Plan must
    write explicitly rather than skip.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | FR-1 turning a swallowed error into a hard failure could break an existing CI/local flow that today tolerates a `git`-less environment producing an `unknown`-stamped build no one noticed was degraded. | FR-4's explicit opt-in flag preserves that path for anyone who genuinely needs it; AC-7 tests it. Grep of `scripts/*.sh` and CI workflows for callers of `build-extension.sh` is a Plan-phase task to confirm no caller currently relies on silent `unknown`. |
| R2 | FR-2, if shipped without DQ-2's sequencing, reproduces the SPEC-060 DQ-4 blast-radius bug live in every consumer workspace. | DQ-2's recommended Option A folds the predicate fix into the same PR; AC-4 is the required negative test. |
| R3 | FR-3's predicate ("provenance or gate-relevant value") is fuzzier than SPEC-054's POST-shaped one and risks false-positiving on ordinary `|| echo` defaults that are not load-bearing (e.g. a cosmetic log line). | Scope FR-3 narrowly at Plan: flag only assignments whose variable is later consumed by a `--define`, written to a file consumed by a gate, or otherwise reaches a signpost — not every `|| echo` in `scripts/**`. Reuse SPEC-054's allow-annotation shape (AC-6) as the escape hatch for any remaining false positive. |

## Out of Scope

- **Rebuilding or generalizing `detectBuildSkew`'s ancestry logic.** This spec adds one new
  reachable branch (`unknown`) to the existing surface function; it does not change how `stale`,
  `current`, or `not-applicable` are computed.
- **Fixing SPEC-060 DQ-4's predicate as a standalone deliverable of this spec.** DQ-2 folds it in
  only as a *prerequisite* for FR-2's safety, under SPEC-060's own `implements:` ownership — this
  spec does not claim authorship of `isMinspecRepo` beyond what DQ-2's Option A requires.
  Reflected in `implements:`/`affects:` staying empty in this frontmatter until Plan settles DQ-2.
- **Implementing SPEC-054 itself.** FR-3 depends on SPEC-054 existing (DQ-1); this spec does not
  build SPEC-054's own seven FRs.
- **Any non-git packaging path beyond the explicit FR-4 opt-in.** No new supported build
  provenance sources (e.g. reading a CI-injected SHA from an env var) are introduced here.

## Traceability

- **Issue:** [#1517](https://github.com/AIClarityAU/minspec/issues/1517) — `build-extension.sh`
  swallows a failed `git rev-parse` into a stamp of `unknown`, and the `unknown` verdict is
  silent at runtime too.
- **Builds on:** [SPEC-060](../SPEC-060-build-provenance-stamp/requirements.md) — stamp-and-surface
  build provenance; this spec is the fail-closed/unknown-surfacing half SPEC-060's own FR-1/FR-3
  did not cover.
- **Depends on (DQ-1):** [SPEC-054](../SPEC-054-gate-signal-linter/requirements.md) — gate-signal
  linter, not yet implemented in this worktree.
- **Related:** [#1504](https://github.com/AIClarityAU/minspec/issues/1504).
- **Method:** RCDD (mechanism + missing gate) — root cause named in the issue itself: *"a
  load-bearing provenance signal is written through a swallowed error, so the absence of
  provenance is indistinguishable from provenance that happens to say `unknown`."*
