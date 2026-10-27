---
id: SPEC-252
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology — the spec→code ownership contract
aspects: [validate, ownership, dispatch, no-silent-gate, authoring-time, specify-only]
depends_on: []
relates_to: ["#2323", "#1561", "#2108", "#2250", "#2264", "#1489", "#1543", "#1800", DR-003, SPEC-038, SPEC-070, SPEC-233]
implements: [packages/minspec/tests/specify-ownership-warn.test.ts, tests/specify-dispatch-ownership-guard.test.ts]  # NEW — the pinning tests this spec owns (FR-6)
affects: [scripts/dispatch-issue.sh, scripts/validate-frontmatter.ts, .minspec/hooks/validate.py, packages/minspec/src/lib/spec-validator.ts]  # Modified, not owned. spec-validator.ts only exports/reuses violationsIntroducedByApproval; no new rule logic is forked
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-252: A T3/T4 spec still being specified is warned — and the specify-only dispatch is stopped — when approval would refuse it for a missing `implements:`

> **This is a SPECIFICATION ONLY.** Written for issue #2323. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## One-sentence scope

A T3/T4 requirements spec in the specifying band (`status: new` or `specifying`) that
`violationsIntroducedByApproval` says approval would refuse must produce a visible WARN at
commit and in CI, and the specify-only dispatch must not publish a spec of its own that does.

## Root cause (measured in issue #2323; re-checked against this base where noted)

The one producer that writes T3/T4 specs unattended — the drain's specify-only dispatch prompt
in `scripts/dispatch-issue.sh` — omits `implements:` from the frontmatter list it tells the
agent to write, and the agent's only pre-publish check (`npm run validate`) cannot see the
gap: Rule 15 reaches `validateOwnership`, which does nothing while `phases.plan` is `pending`,
and `plan` leaves `pending` only when the approve keystroke advances it
(`phasesForApproval`, `lifecycle.ts`). The first gate that can see the gap is therefore the
approval refusal, after the founder has already read the spec; at the default
`ownershipDeclaration: "warn"` not even that fires. Instances: SPEC-078 (refused 2026-10-01),
SPEC-071 before it; 6 of 16 T3/T4 requirements specs created since #1491 lacked `implements:`.

Mechanism, not state: the prose that is meant to prevent it (`/minspec-specify`,
`slash-commands.ts`; the dispatch field list) is model-trusted, and the deterministic checker
is armed by the very act (approval) that the gap should have blocked. **Missing gate:** an
authoring-time check that asks the question approval will ask. This is the asymmetry DR-003
Phase 4 names, and the Decision SPEC-233 deferred as its D2.

Boundary with neighbours (so no second owner emerges): SPEC-233 / #2108 fixes the
`MinSpec: Validate` editor command only; #2264 fails an *armed* spec (plan `in-progress`/`done`)
at commit and CI; this spec covers the *unarmed specifying band*, at commit/CI and in the
specify-only dispatch. #1561's template ask reaches no producer (no live spec template; `createSpec`
has no non-test caller).

## Scope boundary

In: the WARN in `scripts/validate-frontmatter.ts` Rule 15 and the shipped `validate.py`
port; the specify-only dispatch's pre-publish refusal; the dispatch field-list prose line.

Out:
- The approve refusal path (unchanged) and #2264's armed-spec error.
- Moving ownership out of the canonical hash (SPEC-070 / #1800).
- Backfilling legacy `implementing`/`planning` specs approval would refuse (#1543). The WARN
  deliberately excludes them (FR-1).
- A spec template placeholder and a tier-raise prompt (no live producer for either).
- The **DEEPER** finding in #2323 (`writeSpec`/`serializeFrontmatter` drops unknown
  frontmatter keys such as `implements:` on a task-toggle round-trip). Different mechanism,
  different files; it needs its own issue — see [Decisions needed](#decisions-needed-clarify) D4.

## Functional requirements

- **FR-1 — Band and predicate.** For each T3/T4 primary spec with `type: requirements` and
  `status` of `new` or `specifying`, Rule 15 runs the shared approval-advance predicate
  (`violationsIntroducedByApproval`, `spec-validator.ts`) with the repo's config and a
  filesystem `pathExists`. Specs outside the band (`planning`, `implementing`, `done`, …) and
  T1/T2 specs are not evaluated by this rule.
- **FR-2 — WARN, never FAIL.** When the predicate returns an `ownership.implements.missing`
  violation *at error severity*, print a WARN naming the rule id and the fix
  ("approval will be refused: declare `implements:` now, or `implements: none` with
  `implements_reason:`"), and exit 0. Warn-severity results from the predicate (repos at
  `ownershipDeclaration: "warn"`) are printed as the same WARN: the advisory is the point.
  <!-- Clarify D1 decides whether config 'warn' repos get the WARN. -->
- **FR-3 — One predicate, two ports.** `validate.py` implements the same decision as the TS
  rule. No second formulation of "what does approval introduce" is invented in either port;
  the Python port is pinned to the TS verdict by a parity test, the same shape as #2264's
  parity suite.
- **FR-4 — Dispatch refusal.** After the agent exits and before publish, the specify-only
  dispatch evaluates FR-1/FR-2 on each spec the diff adds or modifies. If any would WARN, the
  dispatch publishes nothing (no branch, no PR) and posts an issue comment naming the spec and
  rule — a sibling of `specify_scope_stray`, same hand-off, same fail-closed posture: an
  evaluator that errors or is missing counts as "would WARN" and is named, never skipped
  (constitution invariant 2).
- **FR-5 — Prompt line.** The dispatch prompt's frontmatter field list gains `implements:`
  (or `implements: none` plus `implements_reason:`), so a compliant agent passes FR-4 on its
  first try. The prompt states that this prose is the helper and FR-4 is the control.
- **FR-6 — Pinned by behaviour.** Tests drive the real validator and the real dispatch seam
  (like `--specify-scope-stray`), not source-text greps.
- **FR-7 — Idempotent past the band.** Once approval advances the spec, FR-1 no longer
  applies to it; the armed-spec rule (#2264) takes over. No double reporting.

## Acceptance criteria

- **AC-1 (validator, red today)** Fixture shaped as SPEC-078 at its birth: T3,
  `type: requirements`, `status: specifying`, `specify: done`, clarify/plan `pending`, no
  `implements:`, config `ownershipDeclaration: error`. `validate-frontmatter.ts` and
  `validate.py` each print a WARN containing `ownership.implements.missing` and exit 0.
  On base: neither prints anything about ownership.
- **AC-2 (unchanged variants)** Same fixture as T2; with `implements:` declared; with
  `implements: none` + `implements_reason:`; at `status: implementing` (build band, already an
  error under #2264) — none gain a new WARN.
- **AC-3 (parity)** TS and Python verdicts equal for every AC-1/AC-2 fixture.
- **AC-4 (dispatch, red today)** Feeding the pre-publish guard a diff that adds the AC-1
  fixture: it refuses, names the spec and rule, and publishes nothing. On base: it publishes.
  With `implements:` added, it publishes.
- **AC-5 (fail closed)** The guard's evaluator missing or throwing → refusal naming that
  failure, not a silent publish.
- **AC-6 (measured blast)** Run on main at implementation time, the WARN fires on exactly the
  specs the predicate says approval would refuse within the band (issue measured 1: SPEC-078;
  re-measure and record the count in the PR).
- **AC-7** The prompt text contains the `implements:` line (FR-5), and the AC-4 test fails if
  FR-4's guard is removed while the prompt line remains (the prose is not the control).

## Invariants (must not break)

- **INV-1** Offline; no new network call, no new dependency (constitution invariant 1).
- **INV-2** No silent gate: WARN is visible; guard failures are visible and fail closed (invariant 2).
- **INV-3** Blast radius: the Python port and its WARN ship only where `.minspec/` opted in (invariant 3).
- **INV-4** SPEC-038 FR-3 holds: nothing *fails* for a parked specifying-band draft; constitution
  Principle 4 (avoid nagging) holds — one WARN per spec per run, only inside the band.
- **INV-5** `approve.ts` refusal and `assertOwnershipDeclaredForAdvance` semantics unchanged.
- **INV-6** `validateSpec` stays filesystem-free; `pathExists` is injected.
- **INV-7** The PR touches `scripts/` and `.minspec/hooks`, so it is machinery and needs a human `--admin` merge.

## Cost, stated plainly

A specify-only dispatch that cannot yet name its owned code now either stops and goes to the
founder, or declares a guessed greenfield path / `implements: none`. A wrong guess arms the
spec-gate on files the spec does not own until corrected (the risk #1561 names); the founder
sees the guess in the frontmatter he is already reading, so correcting it before approval is
free. The Python port gains approval-advance logic — a TS/Python drift point #2264's architect
review already flagged — hence FR-3's parity pin.

## Decisions needed (Clarify)

- **D1 — Config `warn` repos: show the WARN?** (A) **(rec)** Yes, always WARN in the band:
  the dispatch guard (FR-4) must not depend on a repo's dial, and a WARN costs the reader one
  line. Cost: a repo that deliberately chose `warn` still sees a line it may consider noise.
  (B) Respect config: WARN only when approval would actually refuse. Cost: at `warn` the dispatch
  guard is inert and the gap SPEC-078 showed stays invisible there.
- **D2 — Dispatch guard: refuse, or WARN in the PR body?** (A) **(rec)** Refuse and hand to the
  founder (issue comment), matching `specify_scope_stray`. Cost: a dispatch that cannot name
  its code produces no PR at all. (B) Publish with a PR-body warning. Cost: the founder reads a
  spec the machinery already knows approval will refuse — the failure #2323 reports.
- **D3 — `implements: none` as the escape.** Allow it from the agent (rec; already a legal
  declaration, the founder sees it) or require a real path. Cost of allowing: an agent may
  take the easy exit; mitigated only by the founder's read.
- **D4 — The DEEPER `writeSpec` key-dropping bug.** (A) **(rec)** File as its own issue
  (different files, different tier path). Cost: it stays live (voip SPEC-003 exposed) until
  scheduled. (B) Fold into this spec. Cost: widens a T3 into the extension's writer surface
  and delays the validator fix.
