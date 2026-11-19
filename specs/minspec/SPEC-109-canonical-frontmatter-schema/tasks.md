---
id: SPEC-109
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-109 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - DR-025 (canonical frontmatter schema) lives here
relates_to: [DR-025, "#96", "#107", "#1033"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-109 - Tasks

The order below is the order of work. Each numbered task is one pull request, ends with
`npm test`, `npm run typecheck`, `npm run lint` and `npm run validate` green, and names the
requirement IDs it satisfies, the files it touches and the test that proves it. Tests are
written first inside each task and observed red before the code that turns them green. The
plan is [design.md](design.md); the contract is [requirements.md](requirements.md), which no
task edits.

Shared rules for every task:

- `packages/minspec/src/lib/spec-frontmatter-schema.ts` stays a leaf: its only imports are
  `./spec-vocabulary` and `import type` from `@aiclarity/shared`. `spec-vocabulary.ts` is
  not edited (INV-8).
- `packages/shared/src/canonical.ts`, `scripts/hooks/canonical.py`,
  `.minspec/hooks/validate.py` and `packages/minspec/src/lib/template-registry.ts` are never
  edited (INV-3, INV-5).
- No task rewrites a spec file's frontmatter except task 7's three FR-20 files (FR-21).
- Paths in `packages/minspec/src` that requirements.md does not declare are edited only
  where design.md, *Files*, names them; list each one in the pull request body with the
  reason.
- Fake timers are set inside the test that needs them, never in a `beforeAll`.

## 1 - The schema leaf: table, splitter, readers, checker (FR-1, FR-2, FR-4, FR-12, FR-13, FR-14; INV-1)

- [ ] **1.1** `packages/minspec/tests/spec-frontmatter-schema.test.ts` (new, owned) - cases,
  written first and observed red (module missing):
  - the table's keys equal FR-2's 17 keys in FR-2 order; `prop`, `shape`, `fieldClass`,
    `toolWritten`, `legacy` and `required` per row as design.md, *The table*, lists;
  - `assertTableWellFormed` throws on a duplicated key, a duplicated prop, a `closed-set`
    row without `closedSet`, and an empty table, and accepts the real table;
  - `joinFrontmatter(splitFrontmatter(y)) === y` for fixtures with comments above and
    between keys, blank lines, folded `implements_reason:` continuations, block `- item`
    lists, a nested `phases:` map, a trailing comment, and a malformed non-key line; and
    for the frontmatter of every file under `specs/` (fails, not skips, on zero files);
  - `readFrontmatterBlock` finds the block in LF and CRLF content and returns `undefined`
    with no fence;
  - `readScalar` strips an inline comment outside quotes and keeps a `#` inside quotes;
    `readList` reads `[a, "#96", c]  # note`, a block list, and `none`; `readPhaseMap`
    strips inline comments from child values;
  - `checkSpecFrontmatter`: one fixture per FR-4 row, present and absent, asserting the
    rule id and `presence` flag; AC-6 (`design.md` with `type: tasks`, and with no `type`,
    under `specs/x/SPEC-NNN-a/` each give `frontmatter.type.mismatch`; a flat
    `specs/SPEC-NNN-b.md` with no `type` gives nothing); FR-12's root arm
    (`specs/minspec/design.md` with `siblingNames: ['requirements.md','tasks.md']`, no `type`:
    mismatch; the same path with `siblingNames` absent, or holding only one other name:
    nothing, the root arm is skipped, not guessed); a path-less call skips FR-12; AC-7's finding (`relate_to:` gives `frontmatter.key.unknown` naming
    `relates_to`, `presence: false`); an out-of-order file gives one `frontmatter.order`
    with `presence: false`; `status: draft` gives `frontmatter.status.unknown` (INV-7);
  - INV-1: the module's `import` declarations are exactly `./spec-vocabulary` and a
    type-only `@aiclarity/shared`.
- [ ] **1.2** `packages/minspec/src/lib/spec-frontmatter-schema.ts` (new, owned) - the
  table declared `as const satisfies readonly FrontmatterField[]`, `SPEC_TIERS`,
  `PHASE_STATUSES`, `PHASE_KEYS`, `assertTableWellFormed`, `splitFrontmatter`,
  `joinFrontmatter`, `readFrontmatterBlock`, the three readers, `checkSpecFrontmatter` with
  the bounded edit-distance suggestion, and a compile-time two-way binding of the three
  edge rows' keys to `EdgeKind`. Rule ids for existing rules are the ones
  `spec-validator.ts` emits today.
  *Done when:* 1.1 is green and `npx tsx scripts/check-import-cycles.ts` passes.

## 2 - `SpecFrontmatter` follows the table; resolvers; no behaviour change (FR-3, FR-6; AC-5 type half)

This task changes types and call sites only. `parseSpec` still fills its defaults (an
untiered `design.md` still parses as `tier: 'T2'`), so every resolver returns the value it is
given and no output changes, the panel badge included. The resolvers and
`readRequirementsSiblingTier` are built and unit-tested here; AC-4's visible change (the
badge showing the sibling's tier) is delivered by task 3, once `parseSpec` stops filling
`tier`.

- [ ] **2.1** `packages/minspec/tests/spec-frontmatter-roundtrip.test.ts` (new, owned) -
  resolver cases (pure functions given explicit inputs; no claim about `parseSpec`): `effectiveTier` (own valid tier; `design`/`tasks` with a supplied sibling
  tier; no tier and no sibling gives `T2`; a `requirements` file ignores a supplied sibling);
  `displayTitle` (frontmatter `title`, empty `title` falls to the H1, no H1 falls to `id`);
  `phaseMap` (absent gives five `pending`); AC-4's resolution half through
  `readRequirementsSiblingTier` on a temp directory holding `requirements.md` with
  `tier: T4` and a tier-less `design.md`.
- [ ] **2.2** `packages/minspec/src/lib/spec.ts` - `SpecFrontmatter` gains `aspects`,
  `dependsOn`, `supersedes`, `relatesTo`, `implements`, `implementsReason`, `affects`;
  `tier`, `title`, `created`, `phases` become optional; the `_schemaBinding` exact-keys
  constant (design.md, *The compile-time binding*); `effectiveTier`, `displayTitle`,
  `phaseMap`, `readRequirementsSiblingTier`. `serializeFrontmatter` reads optional fields
  through the resolvers for now, so its output is unchanged. `parseSpec` fills the seven new
  fields from the raw block (they stay in `extraFrontmatter` as well, so the writer still
  emits them once, from there).
- [ ] **2.3** Call sites, each switched to a resolver with no other change:
  `packages/minspec/src/lib/spec-validator.ts` (`effectiveTier(spec.frontmatter)` with no
  sibling, `phaseMap`), `packages/minspec/src/lib/spec-manager.ts`,
  `packages/minspec/src/views/spec-panel.ts` (`displayTitle`), and the undeclared files
  design.md names: `src/views/spec-panel-html.ts` (the tier badge calls `effectiveTier` and passes
  `readRequirementsSiblingTier` for a split `design`/`tasks` file; no visible change until
  task 3.3, because `parseSpec` still supplies `T2`),
  `src/extension.ts`, `src/lib/spec-catalog.ts`, `src/lib/spec-progress.ts`,
  `src/lib/spec-closeout.ts`, `src/lib/artifact-graph.ts`. `src/lib/lifecycle.ts`:
  `phasesForApproval` accepts `undefined` and resolves it to all-`pending` first (D6).
  `npm run typecheck` lists the sites; fix exactly those.
- [ ] **2.4** AC-5, type half, by mutation: add a row to the table only, then a prop to
  `SpecFrontmatter` only; `npm run typecheck` fails each time; revert. Record both outputs
  in the pull request.
  *Done when:* 2.1 is green, the full suite is green with no existing test edited, and the
  two mutation runs are recorded.

## 3 - Absence stays absence; the writer edits in place (FR-5, FR-7, FR-8, FR-9; AC-1, AC-2, AC-3, AC-4 write half; INV-4, INV-6, INV-7, INV-9)

- [ ] **3.1** `packages/minspec/tests/spec-frontmatter-roundtrip.test.ts` - fixture cases,
  red against task 2's writer: for each corpus shape in design.md, *Test plan*, parse then
  write leaves the frontmatter block byte-identical; AC-2 (no `created:`, parsed under
  `vi.setSystemTime` at two dates: deep-equal); AC-3 (an approved split `tasks.md` with no
  `tier`/`title`/`created`, toggled through `toggleTask` + `writeSpec` as
  `spec-panel.ts` `handleMessage` does: frontmatter block byte-identical); AC-4 end to end,
  red against task 2: parse the tier-less `design.md` from 2.1 beside its `tier: T4`
  `requirements.md`, then the badge's tier computation (`effectiveTier` with
  `readRequirementsSiblingTier`) gives `T4` where task 2 gives `T2`, and the file has no
  `tier:` line after a write; a status change rewrites
  only the `status:` line; a phase change rewrites only that child line and keeps a child's
  inline comment elsewhere; a transition on a phaseless spec inserts `phases:` at its table
  position (INV-9); an unknown key with a comment above it, mid-block and last, survives in
  place (INV-6); a Spec Kit `plan.md` with no frontmatter and a `status: draft` file write
  back unchanged (INV-7); a spec with no source (built in memory) is emitted in table order
  with unknown keys last (FR-7, D2).
- [ ] **3.2** `packages/minspec/tests/spec-frontmatter-corpus.test.ts` (new, owned) - AC-1
  over every file under `specs/`: zero files gain `title`, `created`, `tier` or `phases`, no
  key's value changes, and the frontmatter block is byte-identical; fails with the paths,
  and fails on zero files. INV-4 equivalence: for every file, the violations returned by
  `validateSpec`, `checkAcceptanceCriteria` and `validateOwnership` on the new parse equal
  those returned on the same parse with today's defaults filled in (`tier ?? 'T2'`,
  all-`pending` `phases`, `displayTitle` as `title`, today's date as `created`).
- [ ] **3.3** `packages/minspec/src/lib/spec.ts` - `parseSpec` reads every value through
  `splitFrontmatter` and the readers, keeps the split as `frontmatterSource`, derives
  `extraFrontmatter` from it, and substitutes nothing for an absent `tier`, `created`,
  `title` or `phases`; `parseFrontmatterYaml`, `extractUnknownFrontmatterLines` and
  `KNOWN_FRONTMATTER_KEYS` are removed. `serializeFrontmatter` implements both branches of
  design.md, *The writer*; `writeSpec` passes `frontmatterSource`. This is the task that
  delivers AC-4's visible change: with no filled `tier`, the Active Spec panel badge on a
  tier-less split `design.md` or `tasks.md` shows its `requirements.md` sibling's tier.
  Gates still call `effectiveTier` without a sibling (D5), so no verdict moves.
- [ ] **3.4** `packages/minspec/src/lib/spec-layout.ts` - `splitSpecForSpecKit` gives the
  `spec.md` shard the source's `frontmatterSource`; `mergeSpecKitShards` carries the
  `spec.md` shard's. `packages/minspec/src/lib/spec-manager.ts` - `migrateLayout` writes the
  new file from a spec with `frontmatterSource` removed (canonical order, design.md, *Where
  each writer lands*).
- [ ] **3.5** Existing tests that assert an injected default (`tier` read as `T2`, a
  `created:` of today, a `title:` line, a materialised `phases:` on a phaseless file) go red
  here by design. Rewrite each to assert the resolver or the absence instead, never delete
  one, and list every file and test name in the pull request body.
- [ ] **3.6** INV-4 before/after, recorded: on the base and on this branch run
  `npm run validate` and a scratch script that prints, per file under `specs/`, the rule
  ids from `validateSpec`; paste both counts and the empty diff into the pull request.
  *Done when:* 3.1 and 3.2 are green, the suite is green, and 3.6 shows no verdict change.

## 4 - Creation emits the canonical shape (FR-10)

- [ ] **4.1** `packages/minspec/tests/spec-frontmatter-roundtrip.test.ts` - `createSpec` in a
  temp root (flat and spec-kit layouts, with and without `product`): no `title:` or
  `created:` line, keys in table order, the body's first `# ` heading is the title it was
  given, and the returned summary's `title` is that title. `buildTasksMdContent` on a
  requirements source with every inherited key: output byte-identical to today's (pin the
  literal), and its key order equals the table's filtered order.
- [ ] **4.2** `packages/minspec/src/lib/spec-manager.ts` - `createSpec` per design.md,
  *Creation*. `packages/minspec/src/lib/scaffold.ts` - `buildTasksMdContent` takes its key
  order from `SPEC_FRONTMATTER_FIELDS`.
  *Done when:* 4.1 is green, and the existing `createSpec`/`buildTasksMdContent` tests are
  green or rewritten under 3.5's rule.

## 5 - The extension validator evaluates the table (FR-11 extension half, FR-12, FR-13, FR-14)

- [ ] **5.1** `packages/minspec/tests/spec-frontmatter-schema.test.ts` - drift cases:
  every `CLOSED_SET_FIELDS` key is a table key and its valid set equals the row's
  `closedSet`. Through `validateSpec` with `repoRelativePath`: AC-6's three fixtures as
  warnings; AC-7's unknown key as a warning; an out-of-order file as one
  `frontmatter.order` warning; every finding's `severity` is `warning`; the rule ids and
  messages of the pre-existing `frontmatter.*` rules are unchanged on today's fixtures.
- [ ] **5.2** `packages/minspec/src/lib/spec-validator.ts` - `CLOSED_SET_FIELDS` built from
  the table, required-ness from `RequiredWhen`, `checkSpecFrontmatter`'s FR-12/13/14
  findings appended as warnings, `ValidateSpecOptions.repoRelativePath` and `siblingNames`, and the
  "21 files, 2026-06-04" comment replaced by a pointer to the table.
  `packages/minspec/src/commands/validate.ts` and `src/commands/approve.ts` (undeclared)
  pass `repoRelativePath` and the base names of the file's directory (`siblingNames`).
  *Done when:* 5.1 is green and approving a corpus spec in the Extension Development Host
  shows no new warning on a file in FR-2 order.

## 6 - Completion and the rest of the drift gate (FR-16, FR-18; AC-5 writer half)

- [ ] **6.1** `packages/minspec/tests/spec-frontmatter-schema.test.ts` - `TIER_VALUES`,
  `PHASE_STATUS_VALUES`, `PHASE_KEYS` equal the table's sets; `TIERS` and `PHASES` from
  `config.ts` equal `SPEC_TIERS` and `PHASE_KEYS`; `frontmatterValueCompletions` offers
  `requirements`, `design`, `tasks` on a `type:` line inside frontmatter and nothing outside
  it; the writer run on a fully populated `SpecFrontmatter` with no source emits exactly the
  table's keys in table order; `EDGE_KINDS` from `artifact-graph.ts` equals the table's
  edge keys.
- [ ] **6.2** `packages/minspec/src/views/frontmatter-completion.ts` - the three exported
  lists derived from the table, and a `type` arm. `packages/minspec/src/lib/artifact-graph.ts`
  (undeclared) - export `EDGE_KINDS`.
- [ ] **6.3** AC-5, writer half, by mutation: add `lines.push('foo: x')` to the writer's
  canonical branch; the 6.1 case goes red; revert. Record the output in the pull request.
  *Done when:* 6.1 is green and the mutation is recorded.

## 7 - Corpus data, the documented example, and the paper trail (FR-17, FR-19, FR-20; AC-9; DR-025 note)

- [ ] **7.1** `packages/minspec/tests/spec-frontmatter-corpus.test.ts` - FR-19: zero
  `presence` findings from `checkSpecFrontmatter` over `specs/` (with `epicsRegistered`
  true), failing with the offending paths; FR-17: extract every fenced block in
  `specs/minspec/design.md`'s *Spec file format* section whose first line is `---`, assert
  there are at least two, and check each with `checkSpecFrontmatter` as a split
  `requirements.md` and as a flat file respectively; zero findings. Observed red: FR-19 on
  the three FR-20 files, FR-17 on today's legacy example.
- [ ] **7.2** `specs/minspec/SPEC-039-push-docs-lane-command/requirements.md`,
  `specs/minspec/SPEC-039-push-docs-lane-command/design.md`,
  `specs/minspec/SPEC-050-silent-approval-pr/design.md` - add `type: <base name>` after
  `id:` and `product: minspec` after `status:`; key lines only, nothing else (FR-21). The
  pull request body states that this voids the approval of
  `SPEC-039-push-docs-lane-command/requirements.md`.
- [ ] **7.3** `specs/minspec/design.md` - replace the *Spec file format* example per
  design.md, *The documented example*. The pull request body states that this voids the
  approval of `specs/minspec/design.md`.
- [ ] **7.4** AC-9 by mutation: restore the legacy block; 7.1's FR-17 case goes red; revert.
- [ ] **7.5** `docs/decisions/DR-025.md` - a dated amendment note: §4's backfill is lazy
  (DQ-2 Option A); presence of `id`, `status`, `epic`, primary-spec `tier`, conditional
  `superseded-by` and type/file-name agreement is fatal in this repository's corpus gate
  while order stays a warning (DQ-4 Option A); the stale citations (`spec.ts:25`/`:227`,
  "no spec has `title`/`created`/`phases`", "the hash covers the whole file") corrected.
  `docs/backlog.md` - three dated lines: binding the Python readers to the table; the
  `/minspec-specify` frontmatter guidance; the body re-serialisation drift (design.md, R2).
- [ ] **7.6** After merge, re-approve the two voided files (the founder, or the bot where
  delegation DLG-001 covers spec approval). Listed, not performed by the implementing
  pull request (FR-20).
  *Done when:* 7.1 is green, `npm run validate` is green, and 7.4 is recorded.

## 8 - The corpus gate evaluates the table (FR-11 corpus half, all spec-reading rules, FR-12 root arm, FR-15; AC-7, AC-8, AC-10, AC-11) - machinery

`scripts/` is review machinery, so this pull request needs a machinery merge. It depends on
task 7 (the FR-12 rule is fatal and would red on the three FR-20 files).

- [ ] **8.1** `packages/minspec/tests/spec-frontmatter-corpus.test.ts` - spawned through
  `runTsxCli` against fixture trees: AC-8 (a spec missing `status:` is reported by
  `validateSpec` and by the gate, both under `frontmatter.status.missing`, and the gate
  exits non-zero); a primary spec missing `tier` and an AC-6 mismatch each fail the gate;
  AC-7 (`relate_to:` warns, names `relates_to`, exit 0); an out-of-order file warns, exit 0;
  AC-11 (a `NODE_OPTIONS=--import=<hook>` hook, per design.md measurement 7, redirects
  `spec-frontmatter-schema` to a module that throws: exit non-zero, output names Rule 27 as
  validated nothing, and a finding from a later rule is still printed; control: the same
  tree without the hook exits 0). The hook case first asserts the redirect landed (the
  thrown message appears in the output), so it cannot pass vacuously. FR-11 one-parser
  cases, each red before 8.3: a fixture spec with CRLF line endings and one with an inline
  comment on `type:`/`tier:`/`id:`/`status:` is read identically by Rule 7, Rule 9 and
  Rule 11 and by Rule 27 (no rule reports it unreadable while another accepts it); and a
  source-text case asserting that no `parseFrontmatter(` call in `scripts/validate-frontmatter.ts`
  sits in a spec-reading path (the allowed call sites are the DR and epic readers, listed by
  name). Root-arm FR-12 case: `specs/<product>/design.md` with its two siblings and no
  `type` fails the gate; the same file alone in its directory does not.
- [ ] **8.2** `packages/minspec/tests/validate-frontmatter-rule-mutants.test.ts`
  (undeclared) - a Rule 27 mutant (delete `status:` from one golden spec; Rule 27 is the
  only finding); add `type:` lines to golden spec files if the golden corpus otherwise trips
  FR-12.
- [ ] **8.3** `scripts/validate-frontmatter.ts` - Rule 27 per design.md, *The two
  validators*, including the guarded `await import` and `assertTableWellFormed`; Rule 2 + 5
  reads `id` and `epic` through the schema reader with its messages and fatality unchanged;
  Rule 7 (split coverage), Rule 9's spec-`id` registry read and Rule 11's `kind: 'spec'`
  `status` read do the same (FR-11: no spec file goes through the local `parseFrontmatter`).
  Rule 27 passes `siblingNames` from `readdirSync`. The local `parseFrontmatter` stays for
  the DR and epic readers only.
  *Done when:* 8.1 and 8.2 are green, `npm run validate` on this repository is green with
  zero Rule 27 failures (AC-10), and the full suite, lint and build pass.

## Close-out

- [ ] **9.1** After task 8 merges: comment on #96, #107 and #1033 with the merged pull
  requests and close them (DQ-6 Option A).
