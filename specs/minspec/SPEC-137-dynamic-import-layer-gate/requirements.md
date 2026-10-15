---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - code-change safety (same epic as SPEC-040, whose gate this completes)
aspects: [architecture, tier-0, validation, no-silent-gate]
relates_to: [SPEC-040, DR-064, DR-066, DR-014, "#989"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). SPEC-040 is `done`
# and hash-locked and lists import-cycle-check.ts / check-import-cycles.ts under its own
# `implements:`; this spec therefore EXTENDS those files rather than owning them, and the
# only file it creates is the test below.
implements: [packages/minspec/tests/dynamic-import-layer-gate.test.ts]
affects: [packages/minspec/src/lib/import-cycle-check.ts, scripts/check-import-cycles.ts, eslint.config.mjs]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137 - Close the dynamic `import()` hole in the layer gate

Materializes [#989](https://github.com/AIClarityAU/minspec/issues/989) - *"dynamic `import()`
escapes the SPEC-040 layer gate entirely."* Rests on DR-064 (import-boundary design) and DR-066
(no silent gate). SPEC-040 is `status: done` and hash-locked, so this is a new spec, not an
edit to it.

## One-Sentence Scope

Make `npm run check:cycles` fail when any module under `lib/` has a dynamic `import()` whose
specifier resolves into `views/` or `commands/`, or is the literal `vscode`, so that the layer
contract SPEC-040 FR-1/FR-3 states for static imports also holds for dynamic ones.

## Context - measured, not inferred

- Probe table in #989: at a `lib/` host, static `import ... from "../views/x"` and
  `import type` are errors (FR-1); `import "vscode"` warns (FR-3); `await import("../views/x")`
  and `await import("vscode")` produce **no diagnostic**.
- eslint cannot see it: `no-restricted-imports` (core and `@typescript-eslint`) has no
  `ImportExpression` handler (comment block, `eslint.config.mjs:16-30`).
- The cycle gate sees it and drops it: `valueSpecifiers` scans only top-level statements and
  states dynamic `import()` is "deliberately NOT counted"
  (`packages/minspec/src/lib/import-cycle-check.ts:310-313`). Sound for cycles (a dynamic
  import cannot cause a load-time partial-init failure); it just means no gate examines them.
- Live idiom, all legitimate today: `lib/git-analyzer.ts:394` (`await import('fs')`),
  `commands/classify.ts`, `commands/init.ts`. `lib/spec-manager.ts` also contains five
  `import('./spec').PhaseStatus` occurrences - those are **type-position** `ImportType` nodes,
  not `ImportExpression`, and are a different construct (see DQ-3).
- Because dynamic imports can sit anywhere in a file (inside functions, arguments, ternaries),
  finding them needs a full AST walk; the existing scanner is deliberately a cheap top-level
  statement scan, so the new walk must not change what the cycle graph counts (FR-4).

## Functional Requirements

- **FR-1 Detection.** For every module under `lib/**` in the scanned source root, find every
  `ImportExpression` (a call of the form `import(<arg>)`) anywhere in the file, including
  nested scopes, and record its specifier and line.
- **FR-2 Direction assertion.** A dynamic specifier in a `lib/**` module is a violation when it
  (a) resolves, via the same resolver used for static edges, to a file under `views/` or
  `commands/`; or (b) is exactly `vscode`. Node builtins, `@aiclarity/shared`, and relative
  targets inside `lib/` are not violations. The set of forbidden targets MUST be derived from
  the same definition FR-1/FR-3 of SPEC-040 uses, or a test MUST pin that the two agree
  (see DQ-2), so the layers cannot be loosened in one place only.
- **FR-3 No silent gate (DR-066).** A dynamic `import()` whose argument is not a string literal
  (or a no-substitution template literal) cannot be resolved. It MUST NOT be silently skipped:
  it is reported as `unresolved` in a lib module and fails the gate, unless covered by an
  explicit, reviewed allowance mechanism (DQ-1). Likewise any parse failure or unresolvable
  relative specifier follows the existing `unresolved`/throw behaviour rather than shrinking
  the checked set.
- **FR-4 Cycle graph unchanged.** The value-import graph and cycle detection MUST produce
  identical results to today; dynamic edges stay excluded from cycles. The new data is a
  separate output (e.g. a list of layer violations), not extra graph edges. Existing
  `import-cycle-check` and `check-import-cycles-cli` tests pass unmodified.
- **FR-5 Surfacing.** `npm run check:cycles` prints each violation as
  `FAIL <file>:<line> dynamic import of <specifier> crosses layer (lib -> views|commands|vscode)`
  and exits non-zero. No new script, no new CI step: the existing `lint`-job step covers it.
- **FR-6 Self-check.** The gate asserts it actually walked dynamic-import candidates in the
  fixture/real tree sense required by DR-066: a test proves a deliberately planted violation
  fails the gate, so a walk that silently stopped finding nodes cannot read as "0 violations".
- **FR-7 Comment sweep.** The "KNOWN COVERAGE LIMIT" block in `eslint.config.mjs` and the
  "deliberately NOT counted" paragraph in `import-cycle-check.ts` are updated to say dynamic
  edges are now covered by the direction assertion (and where), so no signpost lies.
- **FR-8 Tier-0.** No new dependency; the walk uses the `typescript` compiler API already used
  by the module. No network, no `vscode` import (DR-014, invariant 1).

## Acceptance Criteria

- **AC-1** Fixture `lib/` file with `await import('../views/x')` -> gate fails, names file and line.
- **AC-2** Same with `../commands/x`, a deep-relative `../../src/views/x`, and `await import('vscode')` -> each fails.
- **AC-3** Dynamic `import()` nested inside a function, a callback and a ternary is found (not just top-level).
- **AC-4** `await import('fs')`, `import('./other-lib-module')` and `import('@aiclarity/shared')` in `lib/` -> no violation.
- **AC-5** The same dynamic imports inside `views/` or `commands/` hosts -> no violation (direction is only asserted for `lib/`).
- **AC-6** Non-literal argument (`import(name)`) in `lib/` -> reported and gate fails (FR-3).
- **AC-7** Running the gate on the real tree at implementation time exits 0 (today's `lib/` has no violating dynamic import; verified by running, not assumed), and cycle results are byte-identical to before (FR-4).
- **AC-8** `import('./spec').PhaseStatus` type positions in `lib/spec-manager.ts` do not fail the gate (subject to DQ-3).

## Invariants this change must not break

- **INV-1** The cycle gate's verdict is unchanged for every existing input (FR-4).
- **INV-2** SPEC-040 INV-4: the fix is never an `eslint-disable`; a legitimately needed
  exception goes through a reviewed mechanism, not a silenced line.
- **INV-3** Constitution invariant 2 (no silent gate): unresolvable dynamic specifiers fail visibly.
- **INV-4** Constitution invariant 1 / DR-014: dev/CI tooling stays offline and adds no dependency.
- **INV-5** Blast radius (constitution invariant 3): dev/CI check in this repo only; nothing here is shipped into adopter repos.

## Decisions needed (Clarify)

- **DQ-1 Non-literal dynamic specifiers.** (a) Fail unconditionally **(rec)** - strictest, no
  hole; cost: a future legitimate computed `import(x)` in `lib/` needs a code change or a DR
  amendment. (b) Fail unless the line carries a reviewed marker comment - flexible; cost: a
  marker is exactly the self-silencing shape INV-2 distrusts. (c) Warn only - cost: reintroduces
  a silent under-cover.
- **DQ-2 Where the forbidden-target set lives.** (a) Duplicate the rule in the checker plus a
  test that parses `eslint.config.mjs` patterns and pins agreement **(rec)** - small change;
  cost: two definitions held in sync by a test. (b) Extract one shared constant imported by both
  eslint config and the checker - single source; cost: touches eslint config loading and
  `eslint.config.mjs` is review machinery.
- **DQ-3 Type-position `import('x').T` (`ImportType`).** FR-1 of SPEC-040 bans type imports from
  `views/` too, and `import('../views/x').T` is another form eslint does not see. (a) Out of scope,
  note in FR-7 comments, file a follow-up **(rec)** - keeps this change to the runtime edge the issue
  names; cost: a type-level lib-to-views edge stays ungated. (b) Cover `ImportType` in the same
  walk - closes both; cost: widens scope past #989 and needs a decision on whether type edges
  warrant the same severity.
- **DQ-4 Mechanism.** (a) Extend `import-cycle-check.ts` + `check:cycles` **(rec)** - reuses the AST
  walk and CI step, as #989 suggests; cost: the file is named for cycles but now also asserts
  layering, so its name and the runner's doc comment under-describe it. (b) A dedicated eslint
  rule with an `ImportExpression` visitor - gives in-editor feedback; cost: new custom-rule
  machinery in `eslint.config.mjs` and a rule file, more surface than the issue's "cheap close".

## Follow-ups (tracked)

- DQ-3 outcome (a) files a follow-up issue for the `ImportType` edge; none exists yet, so none is cited here.
