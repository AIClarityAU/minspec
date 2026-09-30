---
id: SPEC-080
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a green `npm run typecheck` that cannot reach the test tree is a check that reads as coverage it does not have
aspects: [ci, typecheck, vitest, tests, silent-gate, tier-0]
relates_to: [DR-003, SPEC-079, "#1399", "#957", "#1659", "#1423", "#1424"]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-080: The vitest test tree must be covered by a TypeScript project, not just transpiled

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch
> that produced it. A human reads this spec, resolves
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before anything is built.

Materializes **[#1660](https://github.com/AIClarityAU/minspec/issues/1660)** — `npm run
typecheck` covers `packages/minspec/src` and `packages/shared/src`, but no TypeScript
project's `include` glob reaches `packages/*/tests/**`, the tree vitest actually runs. A
green typecheck today says nothing about whether any test file in the repository compiles.

## One-Sentence Scope

Give every file vitest's own `include` glob reaches a TypeScript project that checks it,
wired into the existing required `npm run typecheck` step, without weakening the two build
projects it already covers.

## Context — verified against this repo's current `HEAD`, not inferred

### The gap, confirmed by re-reading both tsconfigs and the typecheck script

- `packages/minspec/tsconfig.json:9` — `"include": ["src/**/*.ts"]`. Builds the extension
  (esbuild strips types at bundle time; this tsc run is the only thing that checks them).
- `packages/minspec/tsconfig.test.json:13` — `"include": ["src/test/**/*.ts"]`. This is the
  **vscode-test** integration tree (`pretest:e2e` → `tsc -p tsconfig.test.json`), a different
  tree from the vitest unit suite entirely — same word "test" in the path, different tree.
- `packages/shared/tsconfig.json:8` — `"include": ["src/**/*.ts"]`. Same shape as minspec's.
- `package.json:22` — `"typecheck": "tsc --noEmit -p packages/shared/tsconfig.json && tsc
  --noEmit -p packages/minspec/tsconfig.json"`. Exactly the two projects above; nothing else.
- `vitest.config.ts:29` — `include: ['packages/*/tests/**/*.test.ts']`. This is the tree that
  actually runs under `npm test`, and it matches neither tsconfig's `include`.

### The hole is larger than the issue's own repro — verified, not assumed

The issue's control test and title name `packages/minspec/tests/**`. Reading
`vitest.config.ts`'s own include glob (`packages/*/tests/**/*.test.ts`, a package-generic
pattern) and then checking which packages actually have a `tests/` directory today shows the
same gap in a second package:

- `packages/minspec/tests/` — 317 `*.test.ts` files, plus non-test `.ts` files those tests
  import (`tests/helpers/shell-timeout.ts`, `tests/helpers/gh-bot-env.ts`,
  `tests/helpers/run-tsx-cli.ts`). All 317 test files import `describe`/`it`/`expect`
  explicitly `from 'vitest'` (checked: zero files rely on injected globals), so no
  `types: ["vitest/globals"]` entry is needed to close this — a plain project covering the
  directory is sufficient.
- `packages/shared/tests/` — 7 `*.test.ts` files (`canonical`, `eslint-ignores`, `next-task`,
  `rework`, `trust-model`, `review-signals`, `project-prefix`). `packages/shared/tsconfig.json`
  excludes this directory by the same mechanism (`include: ["src/**/*.ts"]`) as minspec's.
- `packages/broker` and `packages/extension-pack` have no `tests/` directory today, so they
  are not part of the gap — but nothing about the fix should be specific to two hardcoded
  package names, since a third package's `tests/` dir would silently re-open exactly this
  hole the day it is added (see FR-1).

So the corpus this spec closes is **two** packages' test trees today (324 `.test.ts` files
total, plus the three helper files), not one, and the fix must generalize rather than
special-case the package the issue happened to be filed against.

### Confirms the issue's own control proof

Reproduced independently in this dispatch (a fresh session, not trusting the issue's prose
per Evidence Discipline): `packages/minspec/tsconfig.json` and `tsconfig.test.json` each have
an `include` glob that provably cannot match anything under `tests/` — this is a property of
the glob strings themselves (`src/**/*.ts` and `src/test/**/*.ts`), not something that needed
a live `tsc` run to confirm. This dispatch's sandbox could run `npm test`, `npm run validate`,
`npm run lint`, and `npm ci`, but a direct `tsc`/`npx`/`node` invocation required an approval
this non-interactive session had no way to grant, so the **actual pre-existing type-error
count** under a project that covers `tests/**` is **not measured here** — see DQ-1. Everything
else in this Context section is read from the committed glob strings and file listings, not
inferred from them.

### Why this is a Signpost Integrity issue, not a cosmetic gap (this spec's epic)

`ci.yml:97-106`'s own comment on the existing `Typecheck` step states the precedent this spec
extends: *"Nothing else typechecks the source (#1424)... a TypeScript error could merge past a
fully green suite — and did: #1423 carried a TS2339 through 240/240 test files and 4970
passing tests, caught by an AI reviewer rather than any gate. Measured 0 pre-existing errors
in both packages when this was added, so it is required from day one rather than
advisory-then-ratcheted."* That incident was about `src/`; #1660 is the same shape, one layer
down — `tests/**` has never once been measured, so a second #1423 inside the test tree itself
(a type error in a test that never happens to run its erroring branch, or that becomes a
silent runtime no-op) would look identical: everything green, nothing caught. #1399 names the
same structural pattern from a different mechanism (a guard that could not reach what it
guarded); #957 is the issue's other cited sibling.

## Functional Requirements

- **FR-1 (one project, package-generic).** A TypeScript project MUST check every `.ts` file
  under `packages/*/tests/**` — mirroring `vitest.config.ts`'s own `include` glob shape so a
  new package's `tests/` directory is covered the day vitest starts running it, with no second
  edit required. Enumerating today's two packages by name is the trap FR-1 exists to avoid
  (see Context's "generalize, not special-case" finding).
- **FR-2 (wired into the existing required check, not a new one).** The new project MUST be
  invoked by `npm run typecheck` (`package.json:22`), so the existing required `lint` CI job's
  `Typecheck` step (`ci.yml:104-106`, already a required check per this job's presence in
  `ci.yml`) covers it. No new CI step, workflow, or job — constitution invariant 2's "no
  single producer a config gap can disable" is satisfied by reuse, not by standing up a second
  gate that itself could silently stop running.
- **FR-3 (build projects unweakened).** `packages/minspec/tsconfig.json`,
  `packages/minspec/tsconfig.test.json`, and `packages/shared/tsconfig.json` keep their
  current `include` scope and `rootDir`/`outDir` unchanged. The issue's Option 2 (widen the
  build tsconfig to include `tests/**`) is rejected by this FR: it would require excluding
  tests from emit by hand, and a mistake there pollutes `out/` — the exact cost the issue
  itself names for that option.
- **FR-4 (checking-only, never emits).** The new project MUST set `noEmit: true` (or be
  invoked with `--noEmit`, matching how the two existing projects are already invoked) and
  MUST NOT write into any package's `out/` directory or any other tracked path.
- **FR-5 (no silent suppression).** Any pre-existing type error the new project surfaces MUST
  be fixed as a real type correction, not hidden with `@ts-nocheck`, a blanket `@ts-expect-error`,
  a widened `any`, or a narrowed `include` that excludes the offending file. A suppressed
  error is the same shape as the gap this spec closes — a check that reads green without
  covering what it claims to (DR-003's sibling rule: a data/config fix alone, with the gate
  still not actually reaching the file, is not a fix). Scope of *when* this fixing happens is
  DQ-1, not whether.
- **FR-6 (self-test of the gate).** A test or script pins that the new project's `include`
  glob actually reaches a real file in each covered package's `tests/` directory (e.g.
  asserting a known test file's path matches the compiled `include` pattern, or running the
  new project against a fixture file with a deliberate type error, structurally the same proof
  the issue used by hand). This closes the exact failure mode #1399 names: a guard that
  *looks* like it covers something it structurally cannot reach.

## Acceptance Criteria

- **AC-1 (the issue's own repro, now red-then-green).** Given a copy of a real file under
  `packages/minspec/tests/` with `const __ctl: number = "definitely not a number";` appended,
  `npm run typecheck` FAILS today (reproduced structurally in this spec — see Context) and
  MUST fail after the fix lands, citing that file.
- **AC-2 (packages/shared/tests covered).** The same construction under
  `packages/shared/tests/` MUST also fail `npm run typecheck` after the fix. Today it does
  not fail (no project reaches it), matching the mirrored gap found in Context.
- **AC-3 (helper files covered).** A deliberate type error in
  `packages/minspec/tests/helpers/shell-timeout.ts` (a non-`*.test.ts` file inside `tests/`)
  MUST also fail `npm run typecheck` after the fix — proving the new project's `include` is
  `tests/**/*.ts`, not `tests/**/*.test.ts`.
- **AC-4 (build projects still green, still scoped).** After the fix,
  `tsc --noEmit -p packages/minspec/tsconfig.json`,
  `tsc --noEmit -p packages/minspec/tsconfig.test.json`, and
  `tsc --noEmit -p packages/shared/tsconfig.json` each still pass and still report zero files
  under any `tests/` directory (their `include` globs are unchanged, per FR-3).
- **AC-5 (a genuinely new package's tests/ is covered without a second edit).** A fixture
  package added under `packages/` with its own `tests/*.test.ts` directory is picked up by
  the new project's glob without editing the new project's config — proving FR-1's
  "package-generic" claim rather than asserting it.
- **AC-6 (real backlog, real green).** Every pre-existing type error the new project surfaces
  across the current corpus (packages/minspec/tests, packages/shared/tests, and the three
  helper files) is fixed for real; `npm run typecheck` is green with the new project wired in
  and FR-5 holds (no suppression in the diff). Sizing and sequencing of this AC is DQ-1.

## Invariants

- **INV-1 (constitution 1, offline).** Nothing here adds a network call; `tsc --noEmit` is
  already how `npm run typecheck` runs, unchanged in kind.
- **INV-2 (constitution 2, no silent gate).** The new coverage rides the existing required
  `Typecheck` step inside the `lint` job (FR-2) rather than a new, independently-disable-able
  step. A missing or misconfigured `include` glob on the new project must itself be visible —
  FR-6's self-test is what makes "the config silently stopped matching anything" detectable,
  the same shape #1399 was found by.
- **INV-3 (constitution 3, blast radius).** `tsconfig*.json` files are development tooling for
  this monorepo; grepped and confirmed absent from `template-registry.ts`'s
  `MANAGED_REGION_TEMPLATES` (nothing here is scaffolded into an adopter repo). This spec's
  blast radius stays inside `AIClarityAU/minspec` itself.
- **INV-4 (RCDD sibling rule).** FR-5 exists specifically so this spec's own Implement phase
  cannot close #1660 the way SPEC-004's missing `epic:` was first "fixed" — a data-only patch
  that leaves the gate still unable to reach what it's meant to guard. Fixing the surfaced
  errors without wiring the gate, or wiring the gate while suppressing what it finds, are both
  incomplete under this invariant.

## Decisions needed (Clarify)

### DQ-1 — Who fixes the pre-existing type-error backlog, and when?

This dispatch could not run `tsc` directly (sandboxed to `npm test` / `npm run validate` /
`npm run lint` / `npm ci`; a bare `tsc`, `npx`, or `node` invocation required an approval this
non-interactive session had no channel to grant). The real count of pre-existing errors across
324 test files and 3 helper files is genuinely unknown as of this spec — the issue's own
framing already expects it to be nonzero ("almost certainly surface a batch of pre-existing
type errors... lands as red until fixed, not as a clean one-liner").

- **Option A — Plan phase measures first, in an unsandboxed shell; the fix batch and the gate
  wiring land together in one Implement pass, sized by what Plan finds (rec).** Matches
  `ci.yml:102`'s own precedent for the *original* typecheck gate ("measured 0 pre-existing
  errors... required from day one rather than advisory-then-ratcheted") — this spec does the
  same measure-then-require sequencing, not a different one. *Cost:* Implement cannot start
  until Plan produces a real number; if the backlog is large, Tasks phase may need to split it
  into several PRs, which is more ceremony than a single clean diff.
- **Option B — land the gate now with narrow, individually-commented suppressions on every
  pre-existing violation; file one follow-up issue per suppression (or one issue covering all
  of them) to remove them for real.** *Cost:* this is the exact "check that appears to cover
  something it structurally cannot reach" shape #1399 and FR-5 exist to name and reject — a
  suppressed line reads green in `npm run typecheck` without the file actually being checked,
  which is a milder recurrence of the defect this spec was filed to close, not a fix of it.
- **Option C — ratchet: the new project only checks files added or touched after this spec
  lands; pre-existing files are excluded until someone touches them.** *Cost:* an excluded
  file is invisible in exactly the way the issue already showed causes real incidents (#1423);
  `ci.yml:102`'s own comment explicitly chose "required from day one" over this shape the
  first time the same tradeoff came up, for the same reason.

### DQ-2 — Exact shape of the new TypeScript project (one repo-root file vs. per-package)

FR-1 requires the `include` glob to be package-generic; it does not mandate a single file.

- **Option A — one `tsconfig.vitest.json` at the repo root**, `include:
  ["packages/*/tests/**/*.ts"]`, extending the root `tsconfig.json` for the same
  `strict`/`lib` baseline the two build projects already use (rec). *Cost:* one file that
  spans package boundaries is a minor precedent break from the per-package tsconfig pattern
  the repo otherwise uses everywhere.
- **Option B — one `tsconfig.vitest.json` per package** (`packages/minspec/tsconfig.vitest.json`,
  `packages/shared/tsconfig.vitest.json`, each scoped to its own `tests/`), with `npm run
  typecheck` invoking each in turn. *Cost:* a third package's `tests/` dir needs a new file
  AND a new line in `package.json`'s `typecheck` script — the exact "second edit" FR-1/AC-5
  are written to avoid; this option cannot satisfy AC-5 as written without also generating the
  per-package config, which is more machinery than Option A.

## Why no new DR

The DR-359 filter asks whether the choice costs more than a day to undo. Every change this
spec authorizes is a new (or widened) tsconfig `include` glob and one addition to the
`typecheck` npm script — a revertible diff to dev tooling, consuming an existing classifier
(`tsc`) and an existing required CI step. `docs/decisions/INDEX.md` has no entry for test-tree
typechecking. If DQ-1 resolves to Option B or C above (suppression or ratchet), revisit this —
standing up a permanent suppression or ratchet mechanism is closer to a load-bearing policy
choice than a one-line config change.

## Out of scope

- `packages/minspec/tsconfig.test.json` (the vscode-test integration tree under `src/test/`)
  — already covered by its own project; untouched by this spec (FR-3).
- `packages/broker` and `packages/extension-pack` — no `tests/` directory exists in either
  today (Context); FR-1's generalization means they are covered automatically if that changes,
  with no further spec needed.
- Fixing `packages/minspec/tests/drain-concurrency.test.ts`'s pre-existing failing assertion
  (`#1208 dispatch fan-out — width validation > defaults to 1`) observed while validating this
  spec's environment — a runtime assertion failure, not a type error, and unrelated to this
  issue's mechanism. Not filed as a new issue by this dispatch (scope discipline: verifying
  this one pre-existing red is worth a separate look is itself a judgment call for a human,
  not a given).
- Widening `eslint`'s type-aware rules over `tests/**` — a related but separate lever (ESLint,
  not `tsc`); not requested by #1660 and not assumed here.

## Test plan (for the Plan phase to place)

1. AC-1/AC-2/AC-3: fixture files with a deliberate type error, asserted to fail `tsc --noEmit`
   against the new project and to pass against it once removed — the same red/green shape
   SPEC-078's AC-8 uses for its own single-classifier guarantee.
2. AC-4: assert the two existing build projects' file lists are unchanged (e.g. via `tsc
   --listFilesOnly` or the parsed `include` glob) after the new project lands.
2. AC-5: a throwaway fixture package under a temp directory (or a `packages/` entry excluded
   from workspaces) with its own `tests/*.test.ts`, proving the glob — not the file list —
   does the covering.
3. AC-6: run the new project against the full corpus in an environment with `tsc` access (this
   dispatch's sandbox could not) and confirm zero errors post-fix.

## Traceability

- Issue: [#1660](https://github.com/AIClarityAU/minspec/issues/1660)
- Found while implementing: [#1659](https://github.com/AIClarityAU/minspec/issues/1659)
  (SPEC-061 DQ-1)
- Same structural pattern, different mechanism: [#1399](https://github.com/AIClarityAU/minspec/issues/1399),
  [#957](https://github.com/AIClarityAU/minspec/issues/957)
- Precedent this spec extends: [#1423](https://github.com/AIClarityAU/minspec/issues/1423),
  [#1424](https://github.com/AIClarityAU/minspec/issues/1424), `ci.yml:97-106`
