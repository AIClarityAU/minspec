---
id: SPEC-109
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-109 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - DR-025 (canonical frontmatter schema) lives here
relates_to: [DR-025, DR-003, DR-034, DR-088, SPEC-038, SPEC-061, "#96", "#107", "#1033", "#2297", "#2324"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-109 - Design: one canonical spec frontmatter schema (Plan)

Plan for [requirements.md](requirements.md) (APPROVED; read, never edited by this Plan),
built under the six recorded Clarify selections (DQ-1 to DQ-6, option A each). Citations of
"today" are against `origin/main` `64d24aed`. New code is cited by symbol, because its line
numbers move. The task list is [tasks.md](tasks.md).

## Approach in one paragraph

A new leaf module, `spec-frontmatter-schema.ts`, holds the 17-row field table (FR-1, FR-2)
and one lossless frontmatter splitter that cuts the YAML block into *entries* (a key line,
its continuation lines, and the comment or blank lines directly above it). `parseSpec` keeps
those entries on the `ParsedSpec` and reads every value from them, leaving an absent field
`undefined` (FR-5). The writer then works **in place**: an entry whose value the caller did
not change is re-emitted byte for byte, a changed value rewrites only its own line (or, for
`phases:`, only the child lines that changed), a newly set key is inserted at its table
position, and a file with no source entries (a new spec) is emitted in table order (FR-7 to
FR-10). Consumers that need a value where the file has none call one of three named
resolvers in `spec.ts` (FR-6). Both validators evaluate one pure checker exported by the
schema module (FR-11 to FR-14); the extension maps every finding to a warning, this
repository's corpus gate maps the DQ-4 presence rules to failures. Compile-time bindings in
`src/` (which CI typechecks) and a drift test tie the type, the writer, the validator, the
completion provider and the edge kinds to the table (FR-16, FR-18).

## What Plan measured that the spec did not know

Each was run against `64d24aed`, not inferred. The scratch scripts called `parseSpec` /
`writeSpec` / `specHash` from a checkout with `node_modules` installed.

1. **The corpus has grown from 130 to 277 files** (`requirements` 203, `design` 40,
   `tasks` 31, untyped 3). The round trip is as broken as the spec said, at the new scale:
   `writeSpec(parseSpec(raw))` is byte-identical for **0 of 277**, the frontmatter block is
   identical for 0 of 277, `specHash` changes for **277 of 277**, and the gained lines are
   `title` 267, `created` 271, `phases` 65, `tier` 60. No key is ever lost (#2324 holds).
2. **Every key in the corpus is already in the FR-2 table.** Present counts: `id` 277,
   `status` 277, `epic` 277, `type` 274, `product` 274, `relates_to` 233, `phases` 212,
   `tier` 217, `implements` 190, `aspects` 169, `depends_on` 140, `implements_reason` 120,
   `affects` 82, `title` 10, `created` 6, `superseded-by` 1, `supersedes` 0. So FR-13's
   unknown-key warning starts at zero findings on this corpus.
3. **FR-4 presence already holds except FR-12.** No primary spec lacks `tier`, no file
   lacks `status`. The three FR-20 files are still the only `type` mismatches:
   `SPEC-039/requirements.md`, `SPEC-039/design.md`, `SPEC-050/design.md`. Of those, only
   `SPEC-039/requirements.md` has an approval sidecar, as the spec said.
4. **22 files are out of FR-2 order, and 19 of them have an approval sidecar at exactly
   their path** (the spec's 19/16 at 130 files; the three root files
   `specs/minspec/{requirements,design,tasks}.md` are among them). DQ-2 Option A leaves all
   22 as `frontmatter.order` warnings.
5. **The body round trip is a separate, smaller defect.** Ignoring frontmatter and outer
   whitespace, `writeSpec` keeps the body of 267 of 277 files and all 31 `tasks.md` files.
   It is out of this spec's scope (R2), but it means AC-3's "frontmatter block
   byte-identical" is the right bar for a checkbox write: no `tasks.md` body moves.
6. **FR-15's second half already holds.** The bare `catch {}` around Rule 2 + 5 that the
   spec quotes was replaced by `listCorpus` / `eachFile` with `failClosed: true` (#2000,
   `scripts/validate-frontmatter.ts`, `listCorpus` and `eachFile`). What remains is the
   first half: the table itself failing to load.
7. **A loader hook can make one import throw inside the spawned gate.** Under this repo's
   `tsx` in CJS mode, a `NODE_OPTIONS=--import=<hook>` whose `register()`ed `resolve` hook
   redirects one specifier to a module that throws makes `await import()` of that specifier
   reject, and the caller's `catch` sees the error (measured; the same works with a
   `--require` hook). That is AC-11's harness, with no product switch.
8. **CI typechecks `packages/minspec/src` but not `tests/` or `scripts/`**
   (`.github/workflows/ci.yml`, step `npm run typecheck`; `tsconfig.json` `include:
   ["src/**/*.ts"]`). So the FR-3/FR-18 type bindings must live in `src/` to be a gate, and
   `scripts/lib/delegated-approval.ts`, which reads `parsed.frontmatter.phases` and is not
   typechecked, must keep working at runtime without an edit (D6).
9. **`scripts/` is review machinery** (`MACHINERY_DIR_PREFIXES`,
   `packages/minspec/src/lib/machinery-paths.ts`). Only one task touches it.

## Architecture

### The table (FR-1, FR-2, FR-4)

`packages/minspec/src/lib/spec-frontmatter-schema.ts` (new, owned). Imports only
`./spec-vocabulary` (a leaf) and `import type { EdgeKind } from '@aiclarity/shared'`
(erased at runtime). No `vscode`, no `fs`, no `./config` (which imports `fs`), no
`./spec`, no `./spec-validator`.

```ts
export type FieldShape = 'id' | 'closed-set' | 'scalar' | 'reference' | 'list' | 'paths-or-none' | 'phase-map';
export type FieldClass = 'identity' | 'layout' | 'lifecycle' | 'content' | 'edge' | 'ownership' | 'legacy';
export type RequiredWhen =
  | { kind: 'always' }
  | { kind: 'never' }
  | { kind: 'primary-spec' }                 // no type, or type: requirements
  | { kind: 'status-is'; status: 'superseded' }
  | { kind: 'split-file-name' }              // FR-12: the value must equal the base name
  | { kind: 'epics-registered' };            // project policy, Rule 2 + 5
export interface FrontmatterField {
  readonly key: string;                      // on disk, exactly as the corpus spells it
  readonly prop: string;                     // SpecFrontmatter property
  readonly shape: FieldShape;
  readonly closedSet?: readonly string[];
  readonly fieldClass: FieldClass;
  readonly toolWritten: boolean;             // lifecycle: status, phases
  readonly legacy: boolean;                  // title, created
  readonly required: RequiredWhen;
}
export const SPEC_FRONTMATTER_FIELDS: readonly FrontmatterField[];   // FR-2 order = emit order
```

Rows, in order: `id`/`id`; `type`/`type` (closed set `SPEC_TYPES`); `status`/`status`
(`SPEC_STATUSES`, tool-written); `superseded-by`/`supersededBy`; `tier`/`tier`
(`SPEC_TIERS`); `product`; `epic`; `aspects`; `depends_on`/`dependsOn`;
`supersedes`/`supersedes`; `relates_to`/`relatesTo`; `implements` (`paths-or-none`);
`implements_reason`/`implementsReason`; `affects`; `title` (legacy); `created` (legacy);
`phases` (`phase-map`, tool-written). The module also owns the two closed sets that today
live as private literals: `SPEC_TIERS = ['T1','T2','T3','T4']` and
`PHASE_STATUSES = ['pending','in-progress','done','skipped']`, plus `PHASE_KEYS`. They are
not imported from `config.ts` (it imports `fs`); the drift test binds them to `TIERS` and
`PHASES` there instead (FR-18).

`assertTableWellFormed(table)` throws on a duplicate key or prop, a `closed-set` row with
no `closedSet`, or an empty table. The corpus gate calls it before trusting the table
(FR-15).

### The splitter (shared by the parser, the writer and the corpus gate)

```ts
export interface FrontmatterEntry {
  readonly key: string;              // top-level key
  readonly leading: readonly string[]; // comment and blank lines directly above it
  readonly lines: readonly string[];   // the key line + every indented continuation line
}
export interface SplitFrontmatter {
  readonly entries: readonly FrontmatterEntry[];
  readonly trailing: readonly string[];  // comments or blanks after the last key
}
export function splitFrontmatter(yaml: string): SplitFrontmatter;
export function joinFrontmatter(split: SplitFrontmatter): string;
export function readFrontmatterBlock(content: string): string | undefined;  // LF or CRLF fence
```

The contract is **lossless**: `joinFrontmatter(splitFrontmatter(y)) === y` for every `y`.
This generalises `extractUnknownFrontmatterLines` (`spec.ts`), which already walks the same
shape but keeps only unknown keys and drops comments above known ones. A line that is
neither a key, a continuation, a comment nor blank (malformed YAML) is kept in the next
entry's `leading` so the join stays lossless.

Value readers, one per shape, also pure and exported: `readScalar` (strips an inline
`# comment` outside quotes, joins folded continuation lines), `readList` (inline
`[a, "b", c]`, with `#` inside quotes kept, and block `- item` lists; `none` is returned as
`'none'` for `paths-or-none`), `readPhaseMap` (child `key: value` lines, inline comments
stripped). `epic` is the exception the parser already makes: its parsed value keeps the
inline `# title` comment (`spec.ts`, `parseSpec`, comment above `tier:`), because
`epicRefValue` strips it later.

### The checker (FR-4, FR-11 to FR-14)

```ts
export type FrontmatterRule =
  | 'frontmatter.<key>.missing'      // one id per required key, e.g. frontmatter.tier.missing
  | 'frontmatter.<key>.unknown'      // present closed-set value outside the set
  | 'frontmatter.type.mismatch'      // FR-12
  | 'frontmatter.key.unknown'        // FR-13
  | 'frontmatter.order';             // FR-14
export interface FrontmatterFinding {
  readonly rule: string;
  readonly key: string;
  readonly message: string;
  readonly fixHint: string;
  readonly presence: boolean;        // true for the DQ-4 presence rules the corpus gate fails on
}
export interface FrontmatterContext {
  readonly repoRelativePath?: string; // FR-12 needs the base name and the parent directory
  readonly epicsRegistered?: boolean;  // FR-4 epic row; undefined = do not evaluate
  // Base names of the files beside this one. Supplied by the CALLER, who read the directory;
  // the checker does no I/O. FR-12's root-file arm needs it. undefined = not supplied.
  readonly siblingNames?: readonly string[];
}
export function checkSpecFrontmatter(raw: string, ctx: FrontmatterContext): FrontmatterFinding[];
```

`presence: true` marks exactly the DQ-4 Option A set: `id`, `status`, `epic` (when
`epicsRegistered`), primary-spec `tier`, conditional `superseded-by`, and
`frontmatter.type.mismatch`. Order and unknown keys are `presence: false`. Rule ids for
the rules that already exist are unchanged (`frontmatter.status.missing`,
`frontmatter.tier.missing`, `frontmatter.status.unknown`, ...), so no consumer that keys on
a rule id moves. The unknown-key suggestion uses a Damerau-Levenshtein distance of at most
2 against table keys, and names a candidate only when exactly one key is that close.

FR-12 applies when the base name is `requirements.md`, `design.md` or `tasks.md` and the
parent directory matches `^SPEC-\d+` **or** the file is one of the root split files
(`specs/<product>/{requirements,design,tasks}.md` whose siblings include the other two).
The second arm is what keeps `specs/minspec/design.md` in scope, as FR-12 requires. The
path alone cannot decide it, because sibling existence is a directory fact. So the checker
stays pure by taking the sibling set as an explicit input, `ctx.siblingNames`, which the
caller fills from a directory read it already does or makes (`readdirSync` of the file's
parent): the corpus gate and `commands/validate.ts`/`approve.ts` supply it. The root arm
applies only when `siblingNames` is supplied and holds the other two base names. The
`SPEC-\d+` arm needs the path only. A path-less call (an editor buffer with no file) skips
FR-12 and says nothing; a call with a root-shaped path and no `siblingNames` skips the root
arm and says nothing, never guesses.

### `SpecFrontmatter` and the parser (FR-3, FR-5)

`SpecFrontmatter` gains `aspects`, `dependsOn`, `supersedes`, `relatesTo` (each
`readonly string[]`), `implements` (`readonly string[] | 'none'`), `implementsReason` and
`affects`, and `tier`, `title`, `created`, `phases` become optional. `id` and `status` stay
required: FR-5 names only the four, so `id` still parses to `''` and an unrecognised or
absent `status` still coerces to `'new'` (the validator keeps warning about both).

`ParsedSpec` gains `frontmatterSource?: SplitFrontmatter`. `extraFrontmatter` stays, now
computed from the split (entries whose key is not in the table), so the shard builders in
`spec-layout.ts` and every synthetic `ParsedSpec` keep compiling and behaving.

`parseSpec` replaces `parseFrontmatterYaml` with `splitFrontmatter` plus the value readers.
`new Date()` disappears from the parser; a test pins that (AC-2). An invalid present value
(`tier: T9`) parses to `undefined`, as an absent one does, and the validator's
`frontmatter.tier.unknown` still reports it from the raw line. `resolvePhaseStatus`, which
infers single-file phase sections from their body when `phases:` is silent, is unchanged.

**The compile-time binding (FR-3, FR-18).** In `spec.ts`:

```ts
type SchemaProp = (typeof SPEC_FRONTMATTER_FIELDS)[number]['prop'];
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _schemaBinding: Exact<keyof SpecFrontmatter, SchemaProp> = true;
```

For this to bind, `SPEC_FRONTMATTER_FIELDS` is declared `as const satisfies readonly
FrontmatterField[]`, so `prop` is a literal union. A key added to either side makes
`npm run typecheck` fail in CI. A matching binding in the schema module ties the three edge
rows to `EdgeKind` in both directions.

### The resolvers (FR-6)

In `spec.ts`, beside the parser (they need the body and, for one, the filesystem; the leaf
cannot have either):

```ts
export function effectiveTier(fm: SpecFrontmatter, opts?: { requirementsSiblingTier?: Tier }): Tier;
export function displayTitle(spec: ParsedSpec): string;
export function phaseMap(fm: SpecFrontmatter): Record<Phase, PhaseStatus>;
export function readRequirementsSiblingTier(filePath: string): Tier | undefined;
```

- `effectiveTier`: the file's own valid `tier`; else, for a `design` or `tasks` file with a
  sibling tier supplied, that tier; else `'T2'`. The fallback value is today's, so no gate
  verdict moves (INV-4).
- `displayTitle`: non-empty frontmatter `title`, else the first `# ` heading in the
  preamble, else `id`. That is today's rule (`parseSpec`, `title:`) plus the `|| id` every
  current display site already appends.
- `phaseMap`: `fm.phases` when present, else all five `pending`, which is what the parser
  materialises today.
- `readRequirementsSiblingTier`: reads `requirements.md` beside a split `design.md` or
  `tasks.md`; `undefined` when absent or unreadable. Only display surfaces call it.

**Which consumers pass a sibling.** Gates do not. `spec-validator.ts` (`validateSpec`,
`checkAcceptanceCriteria`, the completeness and ownership rules) calls
`effectiveTier(spec.frontmatter)` with no sibling, so a tier-less `design.md` still
evaluates as `T2`, exactly as today. Passing the sibling there would make
`checkAcceptanceCriteria` demand acceptance criteria from a T3/T4 `design.md`, and Rule 13
is fatal, so it would red the corpus: that is the INV-4 violation the split avoids. The
Active Spec panel's tier badge (`spec-panel-html.ts`) is the display surface that passes
the sibling, which is AC-4's behaviour. The catalog (`spec-catalog.ts`) already prefers a
`requirements.md` entry per id (`rankOf`), so it needs only `effectiveTier(fm)`.

### The writer (FR-7, FR-8, FR-9, FR-10)

`serializeFrontmatter(fm, extra, source?)` gains the third argument; `writeSpec` passes
`spec.frontmatterSource`.

**With a source (an existing file).** Walk `source.entries` in order:

1. Key not in the table: emit `leading` + `lines` verbatim (#2324, INV-6).
2. Table key whose current value deep-equals the value the reader takes from this entry:
   emit verbatim. This is the path every unchanged field takes, which is what makes FR-8
   hold for **every** file, in order or not.
3. Table key whose value is now `undefined`: drop the entry and its `leading` lines.
4. Changed scalar: emit `leading`, then `key: <value>` (no inline comment carried; the
   same as `setSpecStatus` already does for `status:`).
5. Changed `phases:`: keep the key line and every unchanged child line byte for byte;
   rewrite a changed child as `<original indent><phase>: <value>`; append a child that is
   new in `PHASE_KEYS` order after the last child that precedes it.

Then insert each table key that has a value but no entry, directly after the last emitted
entry whose table index is lower (or first, if none), rendered canonically. Finally emit
`trailing`.

**Without a source (a new file, or a spec assembled in memory).** Emit every present table
key in table order, rendered canonically, then `extra` verbatim. Canonical rendering:
scalars `key: value`; lists inline `key: [a, b]` with an item quoted when it starts with
`#` or contains `, ` (the corpus style, e.g. `"#96"`); `implements: none`; `phases:` as a
block with two-space children in `PHASE_KEYS` order.

**Where each writer lands.** The task-checkbox write (`spec-panel.ts`, `handleMessage`),
lifecycle transitions and archive (`spec-manager.ts`, via `writeEntry`) and the spec-kit
`spec.md` shard all carry a source, so they edit in place (FR-9). `createSpec`, a layout
migration that writes a new file, and `getSpec`'s portable `content` have no source and get
table order (FR-10). `splitSpecForSpecKit` and `mergeSpecKitShards` carry
`frontmatterSource` the same way they already carry `extraFrontmatter`; the migration
paths (`spec-manager.ts`, `migrateLayout`) drop it on purpose so the new file is
emitted canonically. A migration changes the file's path and so needs a new approval in
any case.

A transition on a phaseless spec sets `phases`, so the writer inserts a `phases:` block:
that is today's behaviour, which INV-9 leaves alone. `setSpecPhases` and `setSpecStatus`
are already line-level and are not touched.

### Creation (FR-10)

`createSpec` (`spec-manager.ts`) stops putting `title` and `created` in the frontmatter
(DQ-3 Option A); the human title it is given goes into the body as the `# ` heading, which
is where `displayTitle` reads it, and it continues to use that title for the slug and the
returned summary. `buildTasksMdContent` (`scaffold.ts`) builds its key order by filtering
`SPEC_FRONTMATTER_FIELDS` to `id`, `type` and `TASKS_MD_INHERITED_FIELDS`, so it can no
longer drift from the table. Its emitted bytes are unchanged today (it already matches
FR-2), which its existing tests pin.

### The two validators (FR-11, FR-12, FR-13, FR-14)

- **Extension** (`spec-validator.ts`): `CLOSED_SET_FIELDS` is built from the table (rows
  whose `shape` is `closed-set` or `id`, plus `superseded-by`), and `checkClosedSetField`'s
  required-ness reads the row's `RequiredWhen`. `validateSpec` appends
  `checkSpecFrontmatter`'s FR-12/13/14 findings, all `severity: 'warning'`.
  `ValidateSpecOptions` gains `repoRelativePath?: string` and `siblingNames?: readonly string[]`;
  `commands/validate.ts` and `commands/approve.ts` already hold `spec.filePath`, pass it
  relative to the root, and pass the base names of its parent directory. The stale "21 files,
  2026-06-04" comment is rewritten to cite the table instead of a corpus count.
- **Corpus gate** (`scripts/validate-frontmatter.ts`): a new **Rule 27** (the next free
  number at `64d24aed`; re-check on rebase) loads the schema through a guarded
  `await import(...)`, calls `assertTableWellFormed`, then runs `checkSpecFrontmatter`
  over every `specs/**/*.md` with `epicsRegistered: epicRefs.size > 0` and `siblingNames`
  from a `readdirSync` of each file's directory. A `presence` finding calls `fail()`, the
  rest `warn()`. FR-11 requires the gate to stop using its own `parseFrontmatter` for spec
  rules, so every rule that parses a **spec** file moves to the schema's
  `readFrontmatterBlock` + `splitFrontmatter` + `readScalar`, with messages and fatality
  unchanged: Rule 2 + 5 (`id`, `epic`), Rule 7 split coverage (`type`, `tier`, the read at
  `parseFrontmatter(readFileSync(file, ...))` in the Rule 7 `eachFile`), Rule 9's reference
  registry (spec `id`, in `buildReferenceRegistry`), and Rule 11 status parity (spec
  `status`, the `kind: 'spec'` arm of its `eachFile`). Rule 11 also reads decision records
  and Rule 9 also reads epics; those reads keep `parseFrontmatter`, which stays only for
  DR and epic files, out of FR-11's scope. After the change no call passes a spec file to
  `parseFrontmatter`; task 8.1 proves it by a gate test (see tasks).
- **Load failure (FR-15, AC-11).** If the import or `assertTableWellFormed` throws, the
  gate calls `fail()` with `Rule 27 (spec frontmatter schema) validated NOTHING: <error>`
  and skips only Rule 27; every other rule still runs and the exit is non-zero.

### Completion (FR-16)

`frontmatter-completion.ts` keeps its exported names (`TIER_VALUES`,
`PHASE_STATUS_VALUES`, `PHASE_KEYS`) but defines them from the table's closed sets, and
gains a `type` arm whose candidates are the `type` row's closed set. The ADR `status` arm
and the `epic` arm are untouched. SPEC-108 edits a different arm of the same function.

### The documented example (FR-17)

`specs/minspec/design.md`, *Spec file format*: the legacy block (`title:`, `created:`, no
`type`/`product`/`epic`) is replaced by two fenced examples, a split-layout
`requirements.md` and a single-file spec, each valid under `checkSpecFrontmatter`. The
corpus test extracts every fenced block in that section whose first line is `---` and
checks it with the same function, so the legacy block coming back turns it red (AC-9).

## Decisions, and the alternatives rejected

- **D1 - Edit in place, not re-serialise.** FR-8 asks for byte identity where keys are in
  order; FR-9 forbids moving lines on an existing-file write. Re-emitting from a parsed
  object can meet neither once comments are involved: the corpus carries comments above
  known keys (this file's own frontmatter does), and today's writer drops them. Rejected:
  "re-serialise in table order, then restore comments" (no stable anchor for a comment
  once lines move), and "filter the writer by the raw text" (the requirements already
  reject it: the parsed object would still claim values nobody wrote).
- **D2 - FR-7's "unknown keys after the table keys" governs new files only.** For an
  existing file FR-9 wins and an unknown key stays where it was. Reading FR-7 literally on
  an existing file would move lines, which FR-9 forbids and which would change
  `specHash`. On this corpus the point is moot today (measurement 2: zero unknown keys),
  but SPEC-100's three keys will be unknown until it registers them.
- **D3 - The leaf owns `SPEC_TIERS`, `PHASE_STATUSES`, `PHASE_KEYS`.** It cannot import
  `config.ts` (`fs`). Two literal lists bound by test is the same price DQ-1 Option A
  already pays for `EdgeKind`.
- **D4 - Resolvers live in `spec.ts`, not the leaf.** `displayTitle` needs the body and
  `readRequirementsSiblingTier` needs `fs`.
- **D5 - Gates call `effectiveTier` without a sibling.** See *The resolvers*. Rejected:
  sibling-aware gates. More correct in the abstract, but it changes verdicts (INV-4) and
  would make Rule 13 fatal on existing `design.md` files.
- **D6 - `phasesForApproval` accepts an absent map.** `lifecycle.ts`'s `phasesForApproval`
  gains `| undefined` and resolves it to all-`pending` (the `phaseMap` rule) before its
  existing logic. That keeps `scripts/lib/delegated-approval.ts`, which passes
  `parsed.frontmatter.phases` straight in and is not typechecked, correct with no edit to
  a machinery file.
- **D7 - One pure checker, two severity maps.** The alternative, the corpus gate calling
  `validateSpec`, drags the ownership, close-out and evidence rules (which already run
  there as separate numbered rules) into Rule 27 and double-reports them.
- **D8 - AC-11 by loader hook.** Rejected: an environment variable that makes the import
  fail (a product switch whose only purpose is a test, and the kind DR-066 forbids on a
  gate), and copying the script into a fixture tree (its imports are relative to its own
  path, so the copy would load the real schema).
- **D9 - No DR.** The requirements' *Why no new DR* holds: DR-025 is the decision. The
  DQ-2/DQ-4 departures get the dated amendment note the requirements promised (task 7).

## Files

| Path | Declared in requirements.md | Change |
|---|---|---|
| `packages/minspec/src/lib/spec-frontmatter-schema.ts` | `implements:` (new) | the table, closed sets, splitter, value readers, checker |
| `packages/minspec/tests/spec-frontmatter-schema.test.ts` | `implements:` (new) | table rules, splitter losslessness, checker, the FR-18 drift gate |
| `packages/minspec/tests/spec-frontmatter-roundtrip.test.ts` | `implements:` (new) | FR-5 to FR-10 over fixtures; AC-2, AC-3, AC-4 |
| `packages/minspec/tests/spec-frontmatter-corpus.test.ts` | `implements:` (new) | AC-1 over `specs/`, FR-19, FR-17, INV-4 equivalence |
| `packages/minspec/src/lib/spec.ts` | `affects:` | type, parser, writer, resolvers, binding |
| `packages/minspec/src/lib/spec-validator.ts` | `affects:` | derived `CLOSED_SET_FIELDS`, checker findings, `effectiveTier`/`phaseMap` reads |
| `packages/minspec/src/lib/spec-manager.ts` | `affects:` | resolvers; `createSpec` emits no `title`/`created` |
| `packages/minspec/src/lib/spec-layout.ts` | `affects:` | carries `frontmatterSource` through shards |
| `packages/minspec/src/lib/scaffold.ts` | `affects:` | `buildTasksMdContent` key order from the table |
| `packages/minspec/src/views/frontmatter-completion.ts` | `affects:` | derived value lists, `type` arm |
| `packages/minspec/src/views/spec-panel.ts` | `affects:` | `displayTitle` for the panel title |
| `scripts/validate-frontmatter.ts` | `affects:` | Rule 27; Rules 2 + 5, 7, 9 and 11 read spec files through the schema |
| `specs/minspec/design.md` | `affects:` | FR-17 example |
| `packages/minspec/src/views/spec-panel-html.ts` | **not declared** | `displayTitle`, sibling-aware `effectiveTier` for the badge, `phaseMap` |
| `packages/minspec/src/extension.ts` | **not declared** | resolver calls where it builds a summary from frontmatter |
| `packages/minspec/src/lib/spec-catalog.ts`, `spec-progress.ts`, `spec-closeout.ts`, `artifact-graph.ts` | **not declared** | resolver calls (`effectiveTier`, `displayTitle`, `phaseMap`); `artifact-graph.ts` also exports `EDGE_KINDS` for the drift test |
| `packages/minspec/src/lib/lifecycle.ts` | **not declared** | D6 |
| `packages/minspec/src/commands/validate.ts`, `commands/approve.ts` | **not declared** | pass `repoRelativePath` |
| `packages/minspec/tests/validate-frontmatter-rule-mutants.test.ts` | **not declared** | a Rule 27 mutant (its ledger refuses an unaccounted rule) and golden-corpus `type:` lines if needed |
| existing tests that assert an injected default | **not declared** | rewritten to assert the resolver instead (task 3 lists them) |
| `specs/minspec/SPEC-039-push-docs-lane-command/{requirements,design}.md`, `specs/minspec/SPEC-050-silent-approval-pr/design.md` | FR-20 (named in the body) | `type:` and `product: minspec` lines |
| `docs/decisions/DR-025.md` | named in *Why no new DR* | dated amendment note |
| `docs/backlog.md` | DR-023 forward rule | two follow-up lines (*Follow-ups*) |

The undeclared rows are not in the approved `implements:`/`affects:` lists. Declaring them
would mean editing requirements.md, which stales the approval, so they are named here and
in tasks.md instead, as SPEC-080's Plan did. Every source edit among them is a call-site
change forced by FR-3 making four fields optional (the compiler finds each one) or a
one-line export the FR-18 test needs. I believe no gate refuses a change to an undeclared
file of an approved spec (`scripts/hooks/spec-gate.py` gates files owned by unapproved
specs); that is read from its docstring, not exercised.

## Contracts

No payload crosses a package boundary. The module's exports above are the contract; the
observable ones the tests pin:

- `joinFrontmatter(splitFrontmatter(y)) === y` for every string `y`.
- `writeSpec(parseSpec(raw))` has the same frontmatter block as `raw`, byte for byte, for
  every file whose frontmatter the caller did not change.
- `checkSpecFrontmatter` returns findings whose `rule` ids are a superset of the ids the
  extension emits today for the same fields.
- The corpus gate's exit is non-zero when any `presence` finding exists or when Rule 27
  could not load its table.

## Invariants, and where each is tested

| Invariant | Test |
|---|---|
| INV-1 offline, Tier-0 | the schema test asserts the module's import declarations are exactly `./spec-vocabulary` and a type-only `@aiclarity/shared`, and `check-import-cycles` stays green |
| INV-2 no silent gate | AC-11 (loader hook); FR-19's zero-files case fails; Rule 27's mutant in the ledger |
| INV-3 blast radius | the fatal map lives only in `scripts/validate-frontmatter.ts`; `.minspec/hooks/validate.py` and `template-registry.ts` are not touched (the task allowlists say so) |
| INV-4 no verdict change | corpus test: for every file, the violations `validateSpec`, `checkAcceptanceCriteria` and `validateOwnership` return on the new parse equal those they return on the same parse with today's defaults filled in (`tier ?? 'T2'`, all-pending `phases`, H1 `title`); plus the before/after run recorded in the task 3 pull request |
| INV-5 hash contract untouched | `canonical.ts` and `scripts/hooks/canonical.py` are not in any task's file list; the corpus-parity test stays green |
| INV-6 unknown keys survive | roundtrip fixtures with an unknown key, with and without a comment above it, mid-block and last |
| INV-7 foreign vocabularies | roundtrip and checker fixtures: a Spec Kit `plan.md` with no frontmatter, and `status: draft`, give warnings only and write back unchanged |
| INV-8 leaf | `spec-vocabulary.ts` is not edited; `check-import-cycles` |
| INV-9 phaseless lifecycle writers | a transition fixture on a phaseless spec gains the same `phases:` block it gains today, at the table position |

## Test plan

- **`spec-frontmatter-schema.test.ts`** - table: FR-2 keys in order, each row's shape and
  class, `assertTableWellFormed` throws on a duplicated key. Splitter: losslessness over
  fixtures (comments, blank lines, folded scalars, block lists, malformed lines, CRLF read
  through `readFrontmatterBlock`) and over every file in `specs/`. Readers: inline lists
  with quoted `#`, block lists, `none`, inline comments. Checker: AC-6, AC-7's warning and
  suggestion, the FR-4 table row by row, order warnings, `presence` flags. Drift gate
  (FR-18): `TIER_VALUES`/`PHASE_STATUS_VALUES`/`PHASE_KEYS` and the `type` candidates equal
  the table's sets; `TIERS` and `PHASES` from `config.ts` equal `SPEC_TIERS` and
  `PHASE_KEYS`; `CLOSED_SET_FIELDS` keys are table keys; a writer run on a fully populated
  `SpecFrontmatter` with no source emits exactly the table keys in table order;
  `EDGE_KINDS` equals the table's edge rows. The type binding is compile-time (above).
- **`spec-frontmatter-roundtrip.test.ts`** - one fixture per corpus shape (typed with and
  without `tier`, flat single-file, legacy `title`/`created`, phaseless, unknown keys with
  comments, out-of-order keys, `epic` with an inline title, CRLF): parse then write leaves
  the frontmatter byte-identical. AC-2 with `vi.setSystemTime` at two dates (set inside the
  test, not in a hook). AC-3 through `toggleTask` + `writeSpec` exactly as `spec-panel.ts`
  calls them. AC-4 through `readRequirementsSiblingTier` on a temp directory. Lifecycle
  writes: a status change rewrites one line; a phase change rewrites one child line; a
  phaseless transition inserts `phases:` at its table position. Creation: `createSpec`
  output has no `title:`/`created:` and is in table order.
- **`spec-frontmatter-corpus.test.ts`** - AC-1 over every file in `specs/` (counts of
  gained `title`/`created`/`tier`/`phases` are all 0, frontmatter byte-identical); FR-19
  (zero `presence` findings, failing with the paths; fails, never skips, on zero files);
  FR-17 example extraction; INV-4 equivalence.
- **Corpus gate** - AC-8: one fixture missing `status:` is reported by `validateSpec` and
  by `npm run validate` under `frontmatter.status.missing`. AC-11: the loader hook from
  measurement 7 redirects the schema module to one that throws; the gate exits non-zero,
  names Rule 27 as not run, and still prints a finding from a later rule (control: the
  same fixture without the hook passes). AC-7's exit-zero half: `relate_to:` in a fixture
  warns and exits 0. All spawned through `runTsxCli`.
- **Mutation, AC-5.** Before calling task 2 done: add a key to the table only, then a key
  to `SpecFrontmatter` only: `npm run typecheck` fails both times. Add a hand-written
  `lines.push('foo: x')` to the canonical branch of the writer: the drift test goes red.
  Revert each; record the three outcomes in the pull request.

## Risks

- **R1 - Approvals that this spec voids, all stated in the requirements.** `specs/minspec/
  design.md` (FR-17) and `SPEC-039/requirements.md` (FR-20) have sidecars and need
  re-approval after task 6. `SPEC-039` is `implementing`; until it is re-approved its
  approval reads stale. Nothing else is rewritten (FR-21, DQ-2 Option A).
- **R2 - Body re-serialisation still moves 10 of 277 bodies.** A writer call on one of those
  files still changes `specHash`. Out of scope here; recorded as a backlog line. No
  `tasks.md` is among the 10 (measurement 5), so the checkbox path, the one live writer on
  approved split files, is clean.
- **R3 - In-flight specs add keys.** SPEC-097 (risk profile), SPEC-100 (CDD keys) and
  SPEC-108 (completion) are still open. Whichever lands second adds rows; until then their
  keys are FR-13 warnings and survive writes in place (D2).
- **R4 - A quoted `id:`** (`id: "SPEC-001"`) is read verbatim on the Node side today
  (#2297). `readScalar` keeps that behaviour (it strips comments, not quotes, for `id`), so
  this spec neither fixes nor worsens #2297.
- **R5 - The undeclared files.** Ten source files outside the ownership lists change. Each
  change is a resolver call the compiler demands. A reviewer reading only `affects:` will
  see them as scope creep; the *Files* table is the answer.
- **R6 - Rule numbering.** Another open pull request may claim Rule 27 first. The rule-
  mutant ledger catches a duplicate; renumber on rebase.

## Dependency budget

Zero new dependencies. The distance function is ten lines in the schema module.

## Follow-ups (tracked)

- DR-025 dated amendment note (DQ-2 lazy backfill, DQ-4 presence fatal here, corrected
  citations): task 7 of this plan.
- #107 closes against this spec once it ships (DQ-6 Option A); #1033 (status missing passes
  `npm run validate`) is closed by AC-8.
- Binding the Python readers (`scripts/hooks/spec-gate.py`, the shipped `validate.py`) to
  the table, the `/minspec-specify` skill guidance on which frontmatter to author, and the
  body re-serialisation drift (R2): `backlog:` lines added by task 7 (no decision in the
  next 30 days turns on them).
- #2297 (quoted `id`): already filed; unchanged by this spec (R4).
