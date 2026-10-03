---
id: SPEC-109
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology — DR-025 (canonical frontmatter schema) lives here
aspects: [frontmatter, schema, validation, round-trip, signpost-integrity, tier-0, drift]
relates_to: [DR-025, DR-024, DR-022, DR-088, DR-034, DR-003, DR-014, SPEC-022, SPEC-038, SPEC-061, "#96", "#107", "#90", "#93", "#58", "#23", "#2324"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3). All
# four files are NEW (none exists at 350c6fa4). The module path assumes DQ-1 Option A; under
# Option B the first entry moves to packages/shared/src/ and this line is edited BEFORE approval.
implements: [packages/minspec/src/lib/spec-frontmatter-schema.ts, packages/minspec/tests/spec-frontmatter-schema.test.ts, packages/minspec/tests/spec-frontmatter-roundtrip.test.ts, packages/minspec/tests/spec-frontmatter-corpus.test.ts]
# Modified, not owned. No spec lists any of these under `implements:` (grepped every
# specs/*/SPEC-*/requirements.md and specs/minspec/requirements.md for the file names).
affects: [packages/minspec/src/lib/spec.ts, packages/minspec/src/lib/spec-validator.ts, packages/minspec/src/lib/spec-manager.ts, packages/minspec/src/lib/spec-layout.ts, packages/minspec/src/lib/scaffold.ts, packages/minspec/src/views/frontmatter-completion.ts, packages/minspec/src/views/spec-panel.ts, scripts/validate-frontmatter.ts, specs/minspec/design.md]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — One canonical spec frontmatter schema: the type, the writer, the validators and the documented example agree with the corpus (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, template, or test is created by this
> document. It is the Specify-phase artifact for
> [#96](https://github.com/AIClarityAU/minspec/issues/96). A human reads it, answers the
> questions under [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it
> through the normal spec-approval gate before any Plan, Tasks or Implement work begins.

**Triggered by:** [#96](https://github.com/AIClarityAU/minspec/issues/96) — "canonicalize
spec frontmatter schema — type, validator, and doc examples have drifted".
**Decision this rests on:** [DR-025](../../../docs/decisions/DR-025.md) (canonical spec
frontmatter schema owns field set and order — one source, one gate; `status: accepted`).
This spec is that decision's materialization; see [Why no new DR](#why-no-new-dr).

## One-Sentence Scope

Declare the spec frontmatter schema once, in code, and make the `SpecFrontmatter` type, the
spec writer, the in-extension validator, the corpus gate (`npm run validate`), the
frontmatter completion provider and the documented example all derive from that one
declaration, so that the tool never writes a frontmatter field the author did not put there.

## Context — what is true today (measured at `350c6fa4`, not taken from the issue)

Issue #96 was written when the corpus had 19 spec files. It has 130 now, and four months of
changes landed in between. Per CLAUDE.md's Evidence Discipline every premise was re-measured;
several no longer hold, and one defect the issue did not name is worse than the ones it did.

### Reality-check on the issue's table

| Issue #96 says | Today | Evidence |
|---|---|---|
| `type`, `product` are absent from the type | **Stale.** Both are modeled, as optional | `spec.ts:60`, `spec.ts:67` |
| `title`, `created`, `phases` are required by the type | **Still true** | `spec.ts:47`, `:50`, `:51` |
| `tier` is required by the type | **Still true**; 40 of 130 files omit it | `spec.ts:48`; corpus count below |
| Edge fields are absent from the type | **Still true.** They survive a write only as opaque passthrough lines (#2324) | `spec.ts:86-98`, `KNOWN_FRONTMATTER_KEYS` at `spec.ts:192` |
| The validator does not enforce a required set | **Partly stale.** `id`, `status`, primary-spec `tier` and conditional `superseded-by` are asserted, as warnings | `CLOSED_SET_FIELDS`, `spec-validator.ts:533-560` |
| The SPEC-002 `design.md` example is the legacy schema | **Still true**; the file is `specs/minspec/design.md` (its `id:` is SPEC-001) | `specs/minspec/design.md:115-128` |
| `frontmatter-completion.ts` known fields are stale | **Still true.** It completes `status`, `tier`, phase keys and `epic`; not `type` | `packages/minspec/src/views/frontmatter-completion.ts:114-123` |
| #93 (approve gate expects single-file phase sections) | Addressed in code: split files skip the in-file phase-section check | `spec-validator.ts:995`, Rule 7 comment in `scripts/validate-frontmatter.ts` |
| #58 (spec id collisions) | Addressed in code: Rule 18, fatal | `scripts/lib/spec-id-collision.ts`, `scripts/validate-frontmatter.ts` Rule 18 |

Whether #93 and #58 are *closed* on GitHub was not checked — this dispatch has no network —
and an issue's state is not evidence either way. The code citations are.

### Field usage across the corpus (130 `specs/**/*.md` files)

By `type:` — requirements 76, design 31, tasks 20, absent 3.

| Field | Files | Notes |
|---|---|---|
| `id`, `status`, `epic` | 130 | universal |
| `type`, `product` | 127 | the three without are `SPEC-039/requirements.md`, `SPEC-039/design.md`, `SPEC-050/design.md` |
| `tier` | 90 | all 76 `requirements` files; 6 `design`, 5 `tasks`, and the 3 untyped files |
| `relates_to` | 85 | |
| `implements` | 69 | SPEC-038 ownership |
| `phases` | 66 | 52 requirements, 7 design, 7 tasks |
| `aspects` | 44 | |
| `depends_on` | 36 | |
| `affects` | 36 | SPEC-038 ownership |
| `implements_reason` | 27 | |
| `title` | 10 | legacy |
| `created` | 6 | legacy |
| `superseded-by` | 1 | |
| `supersedes` | 0 | modeled as an edge kind (`artifact-graph.ts:102`), unused in specs |

### The defect the issue did not name: the writer invents frontmatter

`parseSpec` fills three required-by-type fields with values the file never contained, and
`serializeFrontmatter` then writes them out unconditionally:

- `tier` absent → `'T2'` (`spec.ts:302`), emitted at `spec.ts:387`.
- `created` absent → **today's date** (`spec.ts:304`), emitted at `spec.ts:396`. The value
  depends on the day the tool runs.
- `title` absent → the first `# ` heading (`spec.ts:300`), emitted at `spec.ts:381`.
- `phases` absent → five `pending` entries (`spec.ts:312-318`), emitted at `spec.ts:402-405`.

Measured by running `writeSpec(parseSpec(raw))` over every file in `specs/`:

| Outcome of one parse → write round trip | Files (of 130) |
|---|---|
| byte-identical to the input | **0** |
| `specHash` (the approval hash) changed | **130** |
| gained a `title:` line it did not have | 120 |
| gained a `created:` line (today's date) | 124 |
| gained a `tier:` line (`T2`) | 40 |
| gained a `phases:` block | 64 |

The hash result counts body re-serialisation as well as frontmatter; the four "gained" rows
are frontmatter alone. `title`, `created` and `tier` are content to the canonical hash, which
strips only `status` and `phases` (`packages/shared/src/canonical.ts:14-16`, `:62-82`), so each
injected line on its own voids a recorded approval.

This path is live, not hypothetical. The Active Spec panel's task checkbox calls
`writeSpec` on the open spec file (`packages/minspec/src/views/spec-panel.ts:166`); `MinSpec: Migrate Layout`
does too (`spec-manager.ts:681`, `spec-layout.ts:154`). Ticking one task in a split-layout
`design.md` therefore writes `tier: T2` — a ceremony level nobody chose — plus a creation date
of today, and stales the approval. DR-025 predicted this ("a latent correctness bug the moment
anything calls `writeSpec`") when it believed the writer was bypassed entirely; it no longer
is.

### Why it keeps drifting: nothing owns the field list

The set of known keys is restated in at least five places, none derived from another:
`SpecFrontmatter` (`spec.ts:45-77`), `KNOWN_FRONTMATTER_KEYS` (`spec.ts:192`, whose own
comment says "keep in sync"), `serializeFrontmatter` (`spec.ts:378-407`), `CLOSED_SET_FIELDS`
(`spec-validator.ts:533`), and the completion provider's key dispatch
(`frontmatter-completion.ts:114-123`). The corpus gate re-parses frontmatter with its own
function (`scripts/validate-frontmatter.ts:82`) and asserts a different required set (`id`
and `epic`, both fatal) from the in-extension validator (`id`, `status`, primary `tier`, all
warnings). Twelve TypeScript files carry their own frontmatter-block regex. The comment at
`spec-validator.ts:470` still describes the corpus as "21 files, 2026-06-04".

Root cause, in DR-003's terms: the *mechanism* is hand-copied key lists with no binding
between them; the *missing gate* is a test that fails when one copy disagrees with the
declaration. A reconciliation of the five lists without that gate is the data-only fix DR-025
already rejected.

### Field order

DR-025's order is `id, type, status, tier, product, epic`, then references. For those six
keys, 122 of 130 files already conform; the commonest sequences are the full six (81 files)
and the six without `tier` (38). Extending the order across every known key, 19 files are out
of order, and 16 of those 19 have a path that appears in an approval sidecar under
`.minspec/approvals/` (a text match on the path, so an upper bound on live approvals, not a
count of them). Reordering changes `specHash` — verified by swapping `id:` and `type:` in
SPEC-075 and comparing hashes. So an order backfill costs re-approvals; see DQ-2.

## Functional Requirements

### The declaration

- **FR-1 (one declaration).** A single exported, ordered table MUST declare every spec
  frontmatter field MinSpec recognises. Per field it records: the YAML key exactly as written
  on disk; the value shape (scalar, closed-set scalar, list, nested map); the closed set
  where one exists; when the field is required (FR-4); whether it is a lifecycle field the
  tool writes or a content field the author writes; and whether it is legacy. Table order IS
  the canonical emit order (DR-025 §1). The module MUST be a leaf with no `vscode`, `fs` or
  network dependency (constitution invariant 1) and MUST NOT import `spec.ts` or
  `spec-validator.ts`, for the cycle reason recorded at the top of `spec-vocabulary.ts`.

- **FR-2 (the field set).** The table MUST contain exactly these keys, in this order, unless
  a Clarify answer changes it. Keys are recorded as the corpus spells them — including the one
  hyphenated key among underscored ones — because renaming a content key voids every approval
  on a file that carries it.

  | # | Key | Shape | Class |
  |---|---|---|---|
  | 1 | `id` | scalar `SPEC-NNN` | identity |
  | 2 | `type` | closed set `SPEC_TYPES` | layout |
  | 3 | `status` | closed set `SPEC_STATUSES` | lifecycle (tool-written) |
  | 4 | `superseded-by` | reference | content, conditional |
  | 5 | `tier` | closed set `T1`-`T4` | content |
  | 6 | `product` | scalar slug | content |
  | 7 | `epic` | reference, may carry an inline `# title` comment | content |
  | 8 | `aspects` | list | content |
  | 9 | `depends_on` | list of references | edge |
  | 10 | `supersedes` | list of references | edge |
  | 11 | `relates_to` | list of references | edge |
  | 12 | `implements` | list of paths, or `none` | ownership (SPEC-038) |
  | 13 | `implements_reason` | scalar | ownership (SPEC-038) |
  | 14 | `affects` | list of paths | ownership (SPEC-038) |
  | 15 | `title` | scalar | legacy |
  | 16 | `created` | scalar date | legacy |
  | 17 | `phases` | nested map of `PHASES` → phase status | lifecycle (tool-written) |

  `superseded-by` sits directly under `status` because `serializeFrontmatter` already emits
  it there (`spec.ts:395`) and it only exists to qualify `status: superseded`.

- **FR-3 (the type derives from the table).** `SpecFrontmatter` MUST model every key in
  FR-2, and its optionality MUST match FR-4: `id` and `status` required; everything else
  optional. `tier`, `title`, `created` and `phases` become optional — today they are required
  (`spec.ts:47-51`). The three edge keys and `aspects` become modeled fields rather than
  opaque passthrough lines. A compile-time or test-time binding MUST fail the build when the
  type's key set and the table's key set differ.

- **FR-4 (required-ness).** The table records these rules, which are the union of what the
  two validators assert today, reconciled:

  | Field | Required when |
  |---|---|
  | `id` | always |
  | `status` | always |
  | `tier` | the file is a primary spec: no `type`, or `type: requirements` (the existing `isPrimarySpec`, `spec-validator.ts:531`) |
  | `superseded-by` | `status: superseded` |
  | `type` | the file sits in a split-layout spec directory and is named `requirements.md`, `design.md` or `tasks.md`; the value MUST equal the file's base name |
  | `epic` | the repository has registered epics (project policy, unchanged from Rule 2 + 5) |

  `product` is NOT required: a single-product repository legitimately omits it
  (`spec.ts:54-60`). `type` is NOT required of a single-file spec — its absence is the
  single-file signal (`spec-vocabulary.ts:86-94`) and `flat` is still the default layout
  (`config.ts:132`). `title`, `created`, `phases` and every edge and ownership key are never
  required by this spec; SPEC-038's own arming rule for `implements:` is untouched.

### The parser and the writer

- **FR-5 (absence stays absence).** `parseSpec` MUST NOT substitute a value for an absent
  `tier`, `created`, `title` or `phases`. An absent field parses to `undefined`. The date
  default at `spec.ts:304` is removed outright: no code path may put the current date into a
  parsed spec.

- **FR-6 (defaults move to named resolvers).** Every consumer that needs a value where the
  file has none MUST obtain it from a named function, never from the parser:
  - *effective tier* — a secondary split file (`design`, `tasks`) resolves to its
    `requirements.md` sibling's `tier`; a primary spec with no `tier` resolves to the
    existing fallback **and** keeps raising `frontmatter.tier.missing`. The fallback value
    stays `T2` so no gate changes its verdict (INV-4).
  - *display title* — frontmatter `title` when present and non-empty, else the first `# `
    heading. This is today's rule (`spec.ts:296-300`), relocated.
  - *phase map* — absent `phases` reads as all-`pending` for consumers that iterate phases.
    This is today's rule, relocated; SPEC-061 (the phaseless approval writer) owns when a
    `phases:` block gets materialized on disk, and this spec does not change that.

- **FR-7 (the writer emits only what is there).** `serializeFrontmatter` MUST emit a key
  only when the parsed spec carries it, in FR-2 order, followed by unrecognised keys in their
  original relative order (the #2324 passthrough, kept). It MUST NOT emit `title`, `created`,
  `tier` or `phases` for a spec that did not have them.

- **FR-8 (round-trip stability).** For every file in `specs/`, `writeSpec(parseSpec(raw))`
  MUST leave the frontmatter's set of keys and each key's value unchanged. Where the file's
  keys are already in FR-2 order, the frontmatter block MUST be byte-identical. This is the
  property whose absence the Context table measures (0 of 130 today).

- **FR-9 (existing-file writes do not reorder).** A write to an EXISTING spec file — the
  task checkbox, a status or phase transition — MUST NOT move a frontmatter line the write
  did not otherwise change. Canonical order is applied when a file is created
  (`createSpec`, `buildTasksMdContent`, a layout migration that creates new files) and by the
  explicit backfill DQ-2 decides. Rationale: reordering as a side effect of ticking a
  checkbox would void an approval for a cosmetic reason, which is the failure FR-5 to FR-8
  exist to remove.

- **FR-10 (creation emits the canonical shape).** `createSpec` MUST stop emitting `title:`
  and `created:` unless DQ-3 keeps them, and MUST emit keys in FR-2 order. The scaffolded
  `tasks.md` (`scaffold.ts:139-146`) already matches FR-2 order; it MUST take its key order
  from the table rather than from its own literal list.

### The validators

- **FR-11 (one rule set, two severities).** The in-extension validator
  (`spec-validator.ts`) and the corpus gate (`scripts/validate-frontmatter.ts`) MUST both
  evaluate FR-4 from the table. `CLOSED_SET_FIELDS` is derived from it, not restated. The
  corpus gate MUST stop using its own `parseFrontmatter` (`:82`) for spec rules.
  Severity is split exactly as it is today for `epic`: the shipped extension warns and never
  blocks (DR-025 §3, DR-013 §4); this repository's corpus gate may fail. Which rules fail
  here is DQ-4.

- **FR-12 (type agrees with file name).** A file named `requirements.md`, `design.md` or
  `tasks.md` inside a `SPEC-NNN-*` directory whose `type:` is absent or differs from its base
  name MUST be reported (`frontmatter.type.mismatch`). Three files trip this today (Context).
  The root split files `specs/minspec/{requirements,design,tasks}.md` are in scope: they
  carry `type:` and pass.

- **FR-13 (unknown keys are surfaced, never rejected).** A top-level frontmatter key that
  is not in the table MUST produce a warning naming the key and, when one table key is within
  a small edit distance, suggesting it (`relate_to` → `relates_to`). It MUST NOT fail any
  gate and MUST NOT be dropped on write. Rationale: three specs in flight add keys
  (Coordination, below); a hard reject would turn every new field into a two-step landing.

- **FR-14 (order is advisory).** A file whose recognised keys are not in FR-2 order MUST
  produce a warning (`frontmatter.order`), never a failure, in both validators. DR-025
  rejected a hard block on order and this spec does not reopen that.

- **FR-15 (the witness cannot go quiet).** If the table cannot be loaded, or a spec file
  cannot be read, the corpus gate MUST fail visibly rather than skip the frontmatter rules
  (constitution invariant 2). The existing bare `catch {}` around Rule 2 + 5
  (`scripts/validate-frontmatter.ts`, "specs/ doesn't exist yet — fine") MUST distinguish
  "no `specs/` directory" from "a rule threw", and report the second.

### Derived surfaces

- **FR-16 (completion).** The completion provider MUST take its value candidates from the
  table: `type` gains completions (it has none today), `TIER_VALUES`, `PHASE_STATUS_VALUES`
  and `PHASE_KEYS` stop being hand-typed mirrors (`frontmatter-completion.ts:48-59`).
  Completion stays values-only; key completion is out of scope. SPEC-108 (frontmatter approval
  affordance, in flight for #94) edits the same function and is not blocked by this.

- **FR-17 (the documented example).** The "Spec file format" block in
  `specs/minspec/design.md:115-128` MUST be replaced with examples that validate against the
  table: one split-layout `requirements.md` frontmatter and one single-file spec. A test MUST
  extract every fenced frontmatter example from that section and run it through the same
  rules as a real spec, so the example cannot drift again without a red test. `design.md` is
  an approvable; the edit is a content change and re-approval of SPEC-001's design file is an
  expected, stated cost.

- **FR-18 (the drift gate).** A test MUST fail when any of the following disagrees with the
  table: the `SpecFrontmatter` key set (FR-3); the keys `serializeFrontmatter` can emit; the
  validator's field list; the completion provider's closed-set values; the edge kinds in
  `artifact-graph.ts:102` and `@aiclarity/shared`'s `EdgeKind` (`next-task.ts:61`). This is
  the gate whose absence is the root cause.

- **FR-19 (corpus witness).** A test MUST run the table's rules over the real `specs/`
  tree and assert the counts this spec's migration leaves behind (zero required-field
  violations, zero type mismatches), failing with the offending paths rather than a bare
  count. It MUST fail, not skip, when it finds zero spec files.

### Migration

- **FR-20 (the three untyped files).** `SPEC-039/requirements.md`, `SPEC-039/design.md` and
  `SPEC-050/design.md` MUST gain `type:` and `product:` lines so FR-12 starts clean. Adding a
  line changes `specHash`; the path of `SPEC-039/requirements.md` appears in an approval
  sidecar, so that one file needs re-approval. This is a founder act and is listed, not
  performed, by the implementing change.

- **FR-21 (no silent sweep).** No other corpus file is rewritten by this spec unless DQ-2
  or DQ-3 selects an option that says so. Any sweep that is selected MUST touch key lines
  only — no added comments, no whitespace changes — and MUST print, before writing, the list
  of files whose approval it will void.

## Acceptance Criteria

1. **AC-1 (round trip).** For all files under `specs/`, `writeSpec(parseSpec(raw))` adds no
   frontmatter key and changes no frontmatter value. Counts of files gaining `title`,
   `created`, `tier`, `phases`: 0, 0, 0, 0 (today: 120, 124, 40, 64). *(FR-5, FR-7, FR-8)*
2. **AC-2 (no clock in the parser).** Parsing a spec with no `created:` twice under two
   different mocked dates yields deep-equal results. *(FR-5)*
3. **AC-3 (checkbox does not stale approval).** Given an approved split-layout `tasks.md`
   with no `tier`, `title` or `created`, toggling a task through the same code path the panel
   uses leaves the file's frontmatter block byte-identical. *(FR-7, FR-9)*
4. **AC-4 (effective tier).** A `design.md` with no `tier` beside a `requirements.md` with
   `tier: T4` resolves to `T4`, and the file on disk still has no `tier:` line after a write.
   *(FR-6)*
5. **AC-5 (drift gate bites).** Adding a key to the table without adding it to
   `SpecFrontmatter` — and, separately, adding an emitted key to the writer without adding it
   to the table — each turn the FR-18 test red. Demonstrated by mutation, both directions.
6. **AC-6 (type mismatch).** A `design.md` with `type: tasks`, and one with no `type`, each
   report `frontmatter.type.mismatch`; a flat single-file spec with no `type` reports
   nothing. *(FR-12)*
7. **AC-7 (unknown key).** `relate_to: [DR-001]` warns and suggests `relates_to`, exits zero
   from `npm run validate`, and survives a write unchanged. *(FR-13)*
8. **AC-8 (one rule set).** A fixture missing `status:` is reported by both
   `validateSpec` and `npm run validate`, under the same rule id. Today only the first
   reports it. *(FR-11)*
9. **AC-9 (example is checked).** Restoring today's legacy example block into
   `specs/minspec/design.md` turns the FR-17 test red.
10. **AC-10 (corpus green).** `npm run validate`, `npm test`, `npm run lint` and the build
    pass on the corpus after FR-20. *(FR-19)*
11. **AC-11 (fail visibly).** With the table import made to throw, `npm run validate` exits
    non-zero and names the frontmatter rules as not run. *(FR-15)*

## Invariants (must not break)

- **INV-1 — Offline, Tier-0** (constitution invariant 1). The table, the resolvers and every
  rule are pure; no network, no `vscode` in the declaration module.
- **INV-2 — No silent gate** (constitution invariant 2). FR-15 and FR-19: an errored or
  empty witness fails visibly.
- **INV-3 — Blast radius** (constitution invariant 3). Nothing here changes behaviour in a
  repository without `.minspec/`. The fatal half of FR-11 lives in this repository's
  `scripts/validate-frontmatter.ts`, not in a shipped template; the shipped
  `.minspec/hooks/validate.py` is not modified (Out of Scope).
- **INV-4 — No gate changes its verdict on an unchanged file.** Completeness requirements,
  split-coverage (Rule 7), acceptance-criteria checks and SPEC-038 ownership arming all read
  tier. Each MUST reach the same verdict on every existing corpus file before and after,
  proven by a before/after run over `specs/`, not argued. In particular a typeless file with
  no tier still evaluates as `T2` via the FR-6 fallback.
- **INV-5 — The canonical hash contract is untouched.** `canonical.ts` and its Python twin
  `scripts/hooks/canonical.py` are not modified; the corpus-parity test keeps passing. This
  spec changes what the *writer* puts in a file, never how a file is hashed.
- **INV-6 — Unrecognised frontmatter survives a write** (#2324). FR-7 and FR-13 keep the
  passthrough.
- **INV-7 — Foreign vocabularies are not blocked.** A Spec Kit `plan.md` or `tasks.md` with
  no frontmatter, and a status outside `SPEC_STATUSES`, produce at most a warning from the
  extension (`spec-validator.ts:464-467`).
- **INV-8 — `spec-vocabulary.ts` stays a leaf**, and `check-import-cycles` stays green.
- **INV-9 — Lifecycle writers keep working on a phaseless spec.** SPEC-061's behaviour for a
  spec with no `phases:` block is neither assumed nor altered.

## Coordination with in-flight work

Read from local remote-tracking refs on 2026-10-03; none of the three is on `main`.

| In flight | Touches | How this spec meets it |
|---|---|---|
| SPEC-097 risk-profile frontmatter contract (#90), branch `agent/issue-90` | Replaces scalar `tier` with a profile container; its own text says it must not reach Plan until #91 clears | `tier` stays an optional scalar here. The table is where SPEC-097 later registers its field; FR-6's *effective tier* resolver is the single seam it would re-point. See DQ-5 |
| SPEC-100 CDD contract frontmatter (#23), branch `agent/issue-23` | Adds `contracts:`, `invariant_tests:`, `file_allowlist:` and extends `SpecFrontmatter` | Whichever lands second adds three rows to the table. Until then FR-13 keeps them as preserved unknown keys with a warning |
| SPEC-108 frontmatter approval affordance (#94), branch `agent/issue-94` | Adds a completion item in `frontmatter-completion.ts` | Same file, different function arm (FR-16). A textual merge conflict is possible; no design conflict |
| DR-088 §1 (ownership keys leave the canonical hash) | Would make edits to `implements` / `implements_reason` / `affects` hash-neutral | Not relied on. `canonical.ts:62-82` strips only `status` and `phases` today, so this spec treats all three as hash-covered |

## Decisions needed (Clarify)

Requirements above are written under each recommended option. Choosing another option changes
only the requirements that question names.

### DQ-1 — Where does the declaration live?

- **Option A (rec): a new leaf module in the extension, `packages/minspec/src/lib/spec-frontmatter-schema.ts`.**
  `scripts/validate-frontmatter.ts` already imports from `packages/minspec/src/lib/`, so both
  validators reach it with no new dependency edge. *Cost:* `@aiclarity/shared` keeps its own
  `EdgeKind` list (`next-task.ts:61`), bound to the table by the FR-18 test rather than by an
  import — a tested mirror, not a single definition.
- **Option B: `packages/shared/src/`, exported from `@aiclarity/shared`.** That package is the
  stated home for Tier-0 contract types, and `EdgeKind` could then import the table directly.
  *Cost:* widens a public package surface that DR-014 holds to version lockstep, on the
  strength of one consumer; and DR-014's own move of the classifier there is still `proposed`
  and unexecuted (#54), so this would be the first real migration into it.

### DQ-2 — Field-order backfill: when, and at what cost?

DR-025 §4 decided the older files are backfilled to canonical order "after the gate exists".
It also recorded that this voids approvals. Measured now: 19 files are out of FR-2 order and
up to 16 of them carry an approval record.

- **Option A (rec): no sweep in this spec. Order is canonical for files the tool creates
  and advisory (`frontmatter.order` warning) for the rest; an out-of-order file is reordered
  the next time it is edited for a substantive reason, when it needs re-approval anyway.**
  *Cost:* DR-025 §4 is carried out lazily rather than as one step, so 19 warnings stay on the
  corpus for an unbounded time and join a warning stream that is already largely unread.
- **Option B: one sweep as the last task of this spec, key lines only (FR-21), followed by
  re-approval of every swept file.** Honours DR-025 §4 as written and leaves zero order
  warnings. *Cost:* up to 16 founder re-approvals for a change with no semantic content.
- **Option C: sweep only the files with no approval record.** *Cost:* at most 3 of the 19
  qualify, so it removes little and leaves the same question open for the rest.

### DQ-3 — What happens to the legacy `title:` and `created:`?

10 files carry `title:`, 6 carry `created:`. Readers exist: the display title
(`spec-manager.ts:310`), and `createSpec` writes both (`spec-manager.ts:369-375`).

- **Option A (rec): demote both to optional legacy fields. Preserved where present, never
  injected, not emitted for newly created specs; the title a human sees comes from the `# `
  heading.** *Cost:* two places a title can live remain supported indefinitely, and a file
  whose `title:` and heading disagree shows the frontmatter one — a small standing
  inconsistency rather than a clean removal.
- **Option B: remove both from the 10 and 6 files and from the schema.** One title source,
  smaller table. *Cost:* voids the approval on each edited file, and drops the only recorded
  creation date those specs have (git history still holds the first commit).
- **Option C: keep `created` as an emitted field for new specs only.** *Cost:* the corpus
  then has a field present on new specs and absent on 124 older files, which is the drift
  shape this spec exists to end.

### DQ-4 — Which FR-4 rules fail `npm run validate` in this repository?

Today `id` and `epic` fail; `status`, primary `tier` and `type` do not reach the corpus gate
at all. DR-025 §3 says the validator gate is soft, and DR-099 notes that later records added
blocking gates where they argued for them.

- **Option A (rec): presence of `id`, `status`, `epic`, primary-spec `tier`, conditional
  `superseded-by`, and FR-12 type/file-name agreement are fatal here; order and unknown keys
  warn. The shipped extension stays warning-only.** The corpus already satisfies every one of
  these except the three FR-20 files, so the gate lands green. The argument for blocking: an
  absent `tier` or `status` is not cosmetic — the reader substitutes a value, so the SPECS
  pane shows a ceremony level or lifecycle state nobody wrote. *Cost:* widens the set of
  fatal corpus rules beyond what DR-025 §3 literally says, so DR-025 needs a dated note
  recording that presence became fatal in this repository's gate while order stayed soft.
- **Option B: everything new is a warning, as DR-025 §3 reads.** No DR note needed. *Cost:*
  the next missing `tier` is reported among the existing warnings and, on past form, not
  acted on — the outcome DR-025's own R3 names.

### DQ-5 — Sequence relative to the risk-profile migration (#90)?

Issue #96 suggests folding into or sequencing after #90.

- **Option A (rec): land this first, with `tier` as an optional scalar.** The round-trip
  defect is live now, and SPEC-097's own text holds it out of Plan until #91 (reach
  validation) clears, which has no date. *Cost:* the table and the *effective tier* resolver
  are edited a second time when the profile container arrives.
- **Option B: wait for #90.** One edit to the tier field instead of two. *Cost:* the writer
  keeps inventing `tier: T2` and a creation date on every checkbox toggle for as long as #91
  stays open.

### DQ-6 — Is this the spec for #107 as well?

DR-025's tracked follow-up is #107 ("implement the canonical schema, validator field-order
gate, skill-template alignment, and G1/G2 backfill"). No spec on `main` or on any local
remote ref cites #107 or DR-025 as its decision (searched every ref's `specs/` tree for
`DR-025`, `#107` and `issues/96`; the only hit is SPEC-080 quoting DR-025's advisory wording).
Whether #107 is still open was not checkable offline.

- **Option A (rec): yes — one spec materializes DR-025 for both issues, and #107 is closed
  against it once this is approved.** *Cost:* #107's "skill-template alignment" item (the
  `/minspec-specify` guidance that tells an agent what frontmatter to write) is then tracked
  only by the Out-of-Scope note below until a follow-up issue is filed for it.
- **Option B: keep #107 separate for the order gate and backfill; this spec covers only the
  type, writer and required set.** *Cost:* two specs editing the same table and the same
  validator function in sequence, with DQ-2 answered twice.

## Why no new DR

DR-025 (accepted 2026-07-25) already records the irreversible choice: one schema in code owns
field set and order, the writer is the single emitter, the validator asserts presence, and
backfill follows the gate. `docs/decisions/INDEX.md` was searched for `frontmatter` and
`schema`; DR-025 is the only in-force record on this decision. This spec implements it and
adds no choice that takes more than a day to undo: the table's location (DQ-1) is a file
move, and severities (DQ-4) are one-line changes.

Two points where this spec departs from DR-025's wording, both put to the human above rather
than decided here: FR-9 and DQ-2 Option A defer the §4 backfill, and DQ-4 Option A makes
presence fatal in this repository's gate. If either recommended option is approved, DR-025
gets a dated amendment note in the Plan phase. That edit is listed here so it is not a
prose-only follow-up; it is not made by this dispatch because no option has been chosen.

DR-025's Context and Negative sections have also aged — it cites `spec.ts:25`/`:227` (now
`:45`/`:378`), says no spec on disk has `title`/`created`/`phases` (10, 6 and 66 do), and
describes the approval hash as covering the whole file (it is canonical since SPEC-022). The
decision is unaffected; the Plan-phase amendment note should correct the citations at the
same time.

## Out of Scope

- **The risk-profile container** replacing scalar `tier` — SPEC-097 / #90.
- **The CDD keys** `contracts`, `invariant_tests`, `file_allowlist` — SPEC-100 / #23.
- **Renaming any key** (for example `superseded-by` → `superseded_by`). It would void
  approvals for consistency alone.
- **The Python readers.** `scripts/hooks/spec-gate.py` (`fm_value`, `fm_list`,
  `parse_phases`) and the shipped `.minspec/hooks/validate.py` template parse frontmatter
  independently and apply the same absent-tier → `T2` fallback
  (`template-registry.ts:1986-1988`). INV-4 keeps their verdicts aligned with the TypeScript
  side because the fallback value does not change. Binding them to the table is a separate
  piece of work touching a managed template (DR-090) and needs its own issue.
- **The `/minspec-specify` skill guidance** on which frontmatter to author (DR-025
  Consequences, "skill template is edited once"). Needs its own issue; see DQ-6.
- **DR and epic frontmatter.** `adr-manager.ts` and `epic-manager.ts` have their own key
  sets; this spec is spec files only.
- **Consolidating the twelve frontmatter-block regexes** into one reader. FR-11 removes one
  (the corpus gate's); the rest are ID and collision helpers that deliberately avoid
  `parseSpec`.
- **Key completion** in the editor, and any change to SPEC-108's approval affordance.

The three "needs its own issue" items above are not filed by this dispatch, which may not
run `gh`. They are repeated in `.agent-summary.md` so they reach a human.

## Alternatives considered and rejected

- **Patch the type only** (add the edge fields, mark three fields optional), as the issue's
  item 1 literally asks. Rejected: it leaves five unbound key lists and the parser defaults,
  so the writer still invents fields and the next field drifts the same way.
- **A JSON Schema file as the source, with generated TypeScript.** Rejected for now: adds a
  codegen step and a runtime validator dependency to a Tier-0 package, for a 17-row table
  whose conditional rules (`requiredWhen` on type, on status, on file name) JSON Schema
  expresses awkwardly. A typed constant table gives the same single source.
- **Keep the parser defaults and filter in the writer** (emit `tier` only if the raw text
  had it). Rejected: the parsed object would still claim `tier: 'T2'` for a file that has
  none, so every reader between parse and write sees a value nobody wrote. Absence has to be
  representable.
- **Make `type` and `product` universally required**, as the issue's "19/19" suggests.
  Rejected: flat single-file specs and single-product repositories are supported shapes
  (`config.ts:132`, `spec.ts:54-60`); the corpus of this repository is not the schema.
- **Reject unknown keys.** Rejected: see FR-13.
- **Reorder on every write.** Rejected: see FR-9.

## Test plan (for the Plan phase to place)

- `spec-frontmatter-schema.test.ts` — the FR-18 drift gate and the FR-4 rule table, including
  both mutation directions of AC-5.
- `spec-frontmatter-roundtrip.test.ts` — FR-5 to FR-9 and AC-1 to AC-4, with the mocked-clock
  case, over fixtures of every corpus shape (typed with and without `tier`, flat single-file,
  legacy with `title`/`created`, phaseless, unknown keys with attached comments).
- `spec-frontmatter-corpus.test.ts` — FR-19 over the real `specs/` tree, plus the FR-17
  example extraction. Must fail on zero files found.
- INV-4 before/after comparison of every tier-dependent rule over `specs/`, recorded in the
  implementing pull request.

## Traceability

- Issue: [#96](https://github.com/AIClarityAU/minspec/issues/96); sibling
  [#107](https://github.com/AIClarityAU/minspec/issues/107) (DR-025's follow-up, see DQ-6).
- Decision: [DR-025](../../../docs/decisions/DR-025.md). Related:
  [DR-024](../../../docs/decisions/DR-024.md) (tier demotion direction),
  [DR-022](../../../docs/decisions/DR-022.md) (superseded; origin of the edge vocabulary),
  [DR-088](../../../docs/decisions/DR-088.md) (ownership keys and the hash),
  [DR-034](../../../docs/decisions/DR-034.md) (canonical hash),
  [DR-003](../../../docs/decisions/DR-003.md) (root cause is mechanism plus missing gate).
- Spec id: SPEC-109 was chosen as one above the highest `SPEC-NNN` directory on `main` or on
  any locally known remote branch (SPEC-108, `agent/issue-94`). A branch pushed since the
  last fetch could still claim it; Rule 18 catches a duplicate once both are on one base.
