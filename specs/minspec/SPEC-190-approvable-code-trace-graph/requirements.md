---
id: SPEC-190
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a spec that says "built" when the code does not support it is a lying signpost
aspects: [traceability, drift, false-built, validation, tier-0, offline, no-silent-gate, never-wrong, spec-gate]
depends_on: [SPEC-038, DR-062]  # SPEC-038 supplies the file-level implements: edges this refines to symbols; DR-062 §6 names this work as its leg B (approvable to code)
relates_to: [SPEC-041, SPEC-022, DR-053, DR-034, DR-069, DR-032, DR-003, "#643", "#362", "#626", "#627", "#681"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-3). Every
# path below is needed under every answer to the open questions: a pure verdict engine,
# a symbol extractor, a link-store reader/writer, and the tests that pin each of them.
# Paths are greenfield; FR-4 of SPEC-038 allows that.
implements: [packages/shared/src/trace-graph.ts, packages/shared/tests/trace-graph.test.ts, packages/minspec/src/lib/symbol-index.ts, packages/minspec/src/lib/trace-links.ts, packages/minspec/tests/symbol-index.test.ts, packages/minspec/tests/trace-links.test.ts, packages/minspec/tests/trace-graph-validator.test.ts]
# Modified, not owned: the corpus validator gains the trace check; the old line-anchored
# store and its CodeLens consumer are migrated (FR-11); the shared barrel exports the engine.
affects: [packages/minspec/src/lib/spec-validator.ts, packages/minspec/src/lib/traceability.ts, packages/minspec/src/views/codelens-provider.ts, packages/shared/src/index.ts, scripts/validate-frontmatter.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-190: Approvable-to-code trace graph - each requirement links to a named symbol or test, and a deterministic check catches "says built, isn't" and "built, then changed"

> Traces to **[#643](https://github.com/AIClarityAU/minspec/issues/643)**. Named as
> **leg B** (approvable to code) by [DR-062](../../../docs/decisions/DR-062.md) §6, whose
> leg A (approvable to approvable) is [SPEC-041](../SPEC-041-cross-artifact-staleness/requirements.md).
> Refines the file-level `implements:` edges of [SPEC-038](../SPEC-038-spec-code-ownership/requirements.md),
> which lists this exact work as its out-of-scope R2 follow-on ("declared path vanishes after
> a refactor"). Paragraph ids follow [DR-053](../../../docs/decisions/DR-053.md). No DR is
> minted by this spec yet - see "Decision records" below.

## In plain terms

Today a spec can say "FR-3 is built" and nothing checks the code. The checks we have catch
a wrong status line or a reference to a missing document, but not a requirement whose code
was never written, was deleted in a refactor, or was quietly changed after sign-off. The
only guard for those is the AI review panel, which should be the last line, not the only
one.

This spec adds a small committed list per spec: "FR-3 is implemented by function
`backfillEpicsCommand` in this file, and checked by this test." A check then reads the code
itself - no AI, no network - and reports three things: a link whose function or test no
longer exists (**broken**: the spec claims code that is not there), a linked function whose
code has changed since the link was recorded (**drifted**: someone should re-read FR-3), and
a spec marked done with requirements that link to nothing (**untraced**).

Links name functions and tests, never line numbers, because line numbers are what went
stale in 20 files during the #627 audit.

## One-Sentence Scope

Each spec's functional requirements may be linked to named code symbols and tests in a
committed, per-spec link record, and a Tier-0 (offline, no AI) check resolves every link
against the working tree and reports broken, drifted and untraced requirements through the
corpus validator.

## Context

**The residual class.** The #362 backfill showed that, after the mechanical gates - #626
status parity (`packages/minspec/src/lib/status-parity.ts`), the dangling-reference
resolver, and the accepted-on-proposed check - every remaining defect was an approvable
asserting a code fact the code does not support ("extracted to packages/shared", "modal
confirm", "Layer 2 delivered"). Those gates check the artifact against other artifacts. None
checks it against code.

**What exists today, measured in this checkout.**

- **File-level ownership** - SPEC-038's `implements:` / `affects:` frontmatter (status
  `done`). It names files, explicitly allows paths that do not exist yet (SPEC-038 FR-4),
  and does not say which requirement a file serves. It cannot detect drift by design
  (SPEC-038 R2).
- **A line-anchored link store** - `packages/minspec/src/lib/traceability.ts` reads
  `.minspec/traceability.json`, whose schema (`traceability.ts:7-17`) stores
  a `files` list of entries shaped `<path>:<start>-<end>` - file plus line range. A CodeLens
  (`packages/minspec/src/views/codelens-provider.ts`) consumes it. Line ranges are the
  exact anchor #643 says rots. This repo has no `.minspec/traceability.json`, so no link
  data exists here; adopters may have some (unverified).
- **CodeGraph** - the issue proposes resolving symbols against "the existing CodeGraph
  index". In this repo that index is `.codegraph/`, listed in `.gitignore:133` under the
  comment "CodeGraph local index (33M+ SQLite db, machine-local, rebuilt on demand)". It is
  an external tool, not part of MinSpec, absent on a fresh clone and in CI, and DR-029 R5
  classes it Tier-1. **This spec therefore does not make CodeGraph the resolver** (see FR-5
  and OQ-1); the issue's "fresh clone / CI / teammate must see them" requirement cannot be
  met by a gitignored index.
- **A test parser** - `packages/minspec/src/lib/test-scanner.ts` already extracts `it` /
  `test` titles from test source (`test-scanner.ts:39`, `:165-204`). The test-anchor
  resolver should reuse it rather than writing a second parser.
- **The approval-time fingerprint primitive** - SPEC-041 FR-1 snapshots an upstream
  artifact's hash at approval and derives `upstream-stale` on read. DR-062 §6 says #643's
  drift flag "is exactly this DR's `upstreamDeps` primitive pointed at code". SPEC-041 is
  `implementing`; `upstreamDeps` has no code yet (no match for the name under
  `packages/*/src`).

**A correction to the issue's drift rule.** The issue says drift is "target symbol hash
changed since the FR was **approved**". For greenfield work the symbol does not exist when
the spec is approved - approval precedes Implement - so there is no hash to take at
approval. The baseline must therefore be taken when the **link is recorded**, during or
after Implement (FR-6). This is the one place this spec departs from the issue's wording,
and it is load-bearing.

## Terms

- **Requirement id** - a functional-requirement handle in a spec body: `FR-3` (today's
  corpus form) or `FR3` (DR-053 v2 form, not yet migrated, #681). Both are accepted and
  treated as the same id.
- **Symbol anchor** - a repo-relative source path plus a qualified symbol name, e.g.
  `packages/minspec/src/lib/epic-backfill.ts#backfillEpicsCommand` or `...#ClassName.method`.
  Never a line number.
- **Test anchor** - a repo-relative test path plus the test's title path, e.g.
  `packages/minspec/tests/epic-backfill.test.ts#backfill > writes one epic per tag`.
- **Link** - one requirement id paired with one or more symbol anchors and zero or more
  test anchors, plus the fingerprint of each anchor at the time the link was recorded.
- **Fingerprint** - a hash of a symbol's (or test's) own source text after normalisation
  (OQ-5). It covers only that symbol's text, not what it calls.
- **Link record** - the committed file holding all links for one spec (FR-2).
- **Verdict** - the computed result per requirement: `linked`, `drifted`, `broken`,
  `untraced`, `exempt`, or `unresolvable`. Verdicts are derived on every run and never
  committed.

## Functional Requirements

### A. The links (committed ground truth)

- **FR-1 - Links are committed; verdicts are derived.** Links are the spec's contract with
  the code and MUST be committed, so a fresh clone, CI and a teammate see the same links
  (EPIC-009 team visibility). Verdicts MUST NOT be committed; they are recomputed from the
  links and the working tree on every run. Nothing that reads a verdict may cache it across
  a change to either input without recomputing.
- **FR-2 - One link record per spec, outside the hashed spec body.** Links live in a
  per-spec link record (location: OQ-2), not in `requirements.md` frontmatter. Reason: the
  symbols usually do not exist when the spec is approved, and adding them to frontmatter
  later would edit hashed bytes and stale the approval (SPEC-038 FR-3's note on
  `canonical.ts`). The record's schema is a versioned, validated contract (a Zod schema or
  TypeScript interface in `@aiclarity/shared`), and an unknown `version` is a visible error,
  never a silent skip.
- **FR-3 - Anchors name symbols and tests, never lines.** A symbol anchor or test anchor
  MUST NOT contain a line number or line range. A record carrying one fails validation with
  a message naming the anchor. Every symbol anchor's path MUST also appear in the spec's
  `implements:` or `affects:` list (SPEC-038), so the trace graph only refines declared
  ownership and never widens it; a link to an undeclared path is a validation error naming
  the path to add.
- **FR-4 - Explicit exemption.** A requirement that has no code (a process rule, a
  documentation requirement) is marked `exempt` in the link record with a one-line reason,
  mirroring SPEC-038 FR-5's `implements: none`. An exemption is an on-purpose, reviewable
  statement; a missing entry is `untraced`, not exempt.

### B. Resolution (deterministic, offline, in-repo)

- **FR-5 - The resolver is part of MinSpec, not an external index.** Anchors are resolved
  by a symbol extractor shipped in MinSpec and run against the working tree (parser choice:
  OQ-1). It MUST work on a fresh clone with no prior indexing step and with no network.
  CodeGraph or any other local index MAY be used as an accelerator only if its answer is
  identical to the in-repo extractor's; it MUST NOT be the only witness (constitution
  invariant 2: no required check may hinge on a single producer that one config gap
  disables).
- **FR-6 - Fingerprint taken when the link is recorded.** Writing or updating a link
  records the current fingerprint of every anchor in it. Drift is measured against that
  recorded fingerprint, never against the spec's approval time (see "A correction to the
  issue's drift rule" above).
- **FR-7 - Verdict per requirement.** For each requirement id extracted from the spec body
  (FR-9), the engine returns exactly one verdict:
  - `broken` - at least one anchor does not resolve (file gone, symbol renamed or removed,
    test title changed). This is the **false-built** signal.
  - `drifted` - every anchor resolves, and at least one current fingerprint differs from
    the recorded one. The finding names the requirement and the anchor ("re-read FR-3:
    `backfillEpicsCommand` changed since its link was recorded").
  - `linked` - every anchor resolves with its recorded fingerprint.
  - `exempt` - FR-4.
  - `untraced` - no link and no exemption.
  - `unresolvable` - an anchor is in a language or form the extractor cannot parse
    (FR-10). Distinct from `broken`, and never reported as `linked`.
  Links in the record whose requirement id no longer appears in the spec body are reported
  as **orphan links** (the requirement was renumbered or deleted).
- **FR-8 - The engine is a pure function.** The verdict computation is a pure function of
  (link record, spec body, symbol table) in `@aiclarity/shared` - no filesystem, no
  `vscode`, no network, no clock. The extractor that produces the symbol table lives in
  `packages/minspec` (it reads files). The same inputs always yield the same verdicts.

### C. Visible failure, never a silent pass

- **FR-9 - Requirement-id extraction fails visibly.** The engine extracts requirement ids
  from the spec body deterministically, accepting both `FR-3` and `FR3`. A spec that has a
  link record but from which zero requirement ids can be extracted is a visible finding
  ("no requirement ids found in SPEC-NNN - links cannot be checked"), never a pass.
  Duplicate requirement ids in one spec are a visible finding.
- **FR-10 - Unparseable is not green.** A source file the extractor cannot parse, or a
  language it does not support, yields `unresolvable` for every anchor in it, reported by
  name. It MUST NOT count toward `linked` and MUST NOT silence a `done` check (FR-12). A
  crash inside the extractor fails the trace check closed and visibly, with the file named
  (constitution invariant 2).

### D. Where it reports

- **FR-11 - Migrate, do not run two stores.** The line-anchored `.minspec/traceability.json`
  is superseded. Where it exists, a one-off migration converts each line-range entry whose
  range falls inside exactly one symbol into a symbol anchor, and lists every other entry
  for manual relinking; it never guesses. The CodeLens consumer reads the new link records
  after migration. Until migrated, an existing `traceability.json` is reported as legacy;
  it is not silently ignored.
- **FR-12 - Corpus validator integration.** The corpus validator (`spec-validator.ts`,
  run by `npm run validate`) runs the trace check over every spec with a link record, and
  over every spec whose literal or derived status is `done`. Severity per verdict follows
  OQ-3. At minimum: `broken`, orphan links, line-number anchors, undeclared paths and
  extractor failures are reported by spec, requirement id and anchor; `drifted` is reported
  and names the requirement to re-read.
- **FR-13 - A trace can veto "done", never confer it.** A spec whose status is `done` and
  that has any requirement `broken`, `untraced` or `unresolvable` is a validator finding
  ("SPEC-NNN says done; FR-3 is untraced"). The reverse MUST NOT hold: all requirements
  `linked` does **not** make a spec `done` or move any phase. A resolving symbol proves the
  code exists, not that it does what the requirement says - artifact existence is not
  feature existence (CLAUDE.md, Evidence Discipline). Whether `deriveStatus`
  (`packages/minspec/src/lib/lifecycle.ts:133`) should itself floor such a spec is OQ-7;
  this spec delivers the validator finding only.
- **FR-14 - Recording and refreshing links.** A link can be written or its fingerprints
  refreshed (acknowledging drift) by editing the link record and by a MinSpec palette
  command that resolves the anchors and writes the current fingerprints. A refresh is an
  ordinary committed change visible in the pull-request diff. Who may refresh, and whether
  a refresh needs a human, is OQ-4.

## Acceptance Criteria

- **AC-1 (broken)** - A spec links FR-2 to `foo.ts#doThing`; renaming `doThing` to
  `doOtherThing` makes `npm run validate` report FR-2 `broken`, naming the anchor.
- **AC-2 (drifted)** - Changing the body of `doThing` without renaming it reports FR-2
  `drifted`; refreshing the link (FR-14) returns it to `linked`.
- **AC-3 (normalisation)** - Reformatting `doThing` (whitespace only, and comments only if
  OQ-5 picks comment-stripping) leaves FR-2 `linked`.
- **AC-4 (test anchor)** - Renaming the `it(...)` title a link names reports `broken`.
- **AC-5 (no line numbers)** - A link record containing `foo.ts:3-5` or `foo.ts#L3`
  fails validation, naming the anchor (FR-3).
- **AC-6 (declared ownership)** - A symbol anchor in a file absent from both
  `implements:` and `affects:` fails validation, naming the path (FR-3).
- **AC-7 (done veto)** - A `done` spec with one untraced, non-exempt FR produces a finding;
  the same spec with every FR linked or exempt produces none (FR-13).
- **AC-8 (no promotion)** - Linking every FR of a `specifying` spec does not change its
  literal status, derived status or phases (FR-13).
- **AC-9 (fresh clone)** - In a fresh clone with no `.codegraph/` and no network, the check
  produces the same verdicts as in a working checkout (FR-5).
- **AC-10 (fails closed)** - Forcing the extractor to throw on one file makes the trace
  check fail visibly with that file named; a file in an unsupported language reports
  `unresolvable`, never `linked` (FR-10).
- **AC-11 (ids)** - A spec with a link record and no extractable FR ids is a finding;
  `FR3` and `FR-3` resolve to the same id; a link to a deleted FR is an orphan (FR-7, FR-9).
- **AC-12 (purity)** - The engine module imports nothing from `fs`, `vscode` or any network
  module, enforced by the existing import-boundary check (SPEC-040) or a test (FR-8).
- **AC-13 (migration)** - A `traceability.json` entry whose range sits inside one function
  converts to that function's anchor; one spanning two functions is listed for manual
  relinking and not converted (FR-11).
- **AC-14 (both directions, #137)** - A test asserts the check fails on a *missing* link
  for a `done` spec AND on an *invalid* present link, so the validator-asymmetry class
  cannot return.

## Invariants (must not break)

- **INV-1 (constitution #1 - offline).** Resolution, fingerprinting and verdicts make no
  network call and need no account, token or prior indexing.
- **INV-2 (constitution #2 - no silent gate).** Any parse failure, unsupported language,
  unknown record version or missing requirement id is reported visibly. No verdict is
  written with a swallowed error, and an unresolvable link never reads as green.
- **INV-3 (constitution #3 - blast radius).** The check runs only in a project carrying
  `.minspec/`. Link records are written only inside that project, and the palette command
  refuses in a folder that has not opted in (as `codelens-provider.ts` already does for
  `traceability.json`, SPEC-096 FR-6).
- **INV-4 (no LLM in the decision path).** No model decides a verdict, suggests a
  materiality judgment, or writes a fingerprint. An LLM may later *suggest* candidate links
  for a human or reviewed agent to commit (out of scope); it never resolves them.
- **INV-5 (existence is not correctness).** A trace verdict may lower confidence in a
  status claim (veto `done`), never raise it (FR-13).
- **INV-6 (no approval mutation).** Recording, refreshing or migrating links never writes
  to `.minspec/approvals/` and never edits a hashed spec body, so it can never stale or
  forge an approval.
- **INV-7 (Tier-0 purity).** The verdict engine stays in `@aiclarity/shared` with no
  `vscode`, filesystem or network import.

## Decisions needed (Clarify)

Each option names the recommendation **(rec)** and what the recommendation costs.

### OQ-1 - Which parser resolves symbols?

- **a - The TypeScript compiler API** (`typescript`, already a root devDependency) for
  `.ts/.tsx/.js/.jsx`; every other language is `unresolvable` until a per-language
  extractor is added. **(rec)** - it is the reference parser for the code this repo writes,
  so it never reports a real symbol as missing. Cost: shipping it in the extension bundle
  adds several megabytes (size unmeasured - measure at Plan), or the check runs only from
  `npm run validate`/CI and not inside the editor; and adopters writing other languages get
  `unresolvable` everywhere until more extractors exist.
- **b - A regex top-level-declaration extractor**, like `ast-analyzer.ts`'s `EXPORT_RE`.
  No dependency. Rejected as the authority: a declaration form the regex misses reports a
  real symbol as `broken`, a false block, and body extents need brace matching that strings
  and template literals break.
- **c - The CodeGraph index.** Rejected as the authority: it is gitignored, machine-local
  and absent in CI and on a fresh clone (`.gitignore:133`), so the check would either fail
  closed everywhere it is not installed or pass silently - the latter breaks invariant 2.
  Allowed as an accelerator under FR-5.
- **d - tree-sitter (WASM).** Language-general. Cost: per-language grammar files and a
  WASM runtime in the bundle; more to maintain. A credible later step if adopters need
  non-TS languages.

### OQ-2 - Where does the link record live?

- **a - Mirror the approvals layout:** `.minspec/traces/specs/<product>/SPEC-NNN-<slug>.json`,
  beside the existing `.minspec/approvals/specs/...` records. **(rec)** - follows a pattern
  the repo already has, keeps per-spec files path-disjoint so ~15 concurrent sessions do
  not conflict on one file, and keeps tooling that scans spec folders unaffected. Cost: the
  links are one directory away from the spec they describe, so a reader of the spec folder
  does not see them.
- **b - Beside the spec:** `specs/<product>/SPEC-NNN-<slug>/trace.json`. Most visible in
  review. Cost: spec-folder tooling (`spec-layout.ts`, approvals keyed per file) must be
  checked to ignore it - unverified.
- **c - Extend the single `.minspec/traceability.json` to a v2 schema.** Reuses the
  existing reader and CodeLens. Cost: one shared JSON file edited by every concurrent
  implementation PR - a merge-conflict hotspot by construction.
- **d - Frontmatter of `requirements.md`.** Rejected: adding links after approval stales
  the approval (FR-2).

### OQ-3 - How hard does each verdict fail?

- **a - Graded ratchet. (rec)** `broken`, orphan, line-number anchor, undeclared path and
  extractor failure are **errors from day one** (no links exist yet, so nothing breaks
  on arrival). `drifted` is a **warning always** - it asks for a re-read, not a fix.
  `untraced` on a `done` spec ships as a **warning**, the corpus is backfilled, then it
  flips to error - SPEC-038 FR-7's warn, backfill, error ratchet. Cost: until the flip, a
  `done` spec with no links is only warned about, so the motivating false-built class is
  caught for linked specs immediately but for unlinked ones only after backfill.
- **b - All errors at once.** Cost: every existing `done` spec fails `validate` the day it
  ships, blocking every commit (the SPEC-038 R1 failure mode).
- **c - All warnings.** Cost: a broken link - the false-built signal the issue exists for -
  never blocks, so the check is advisory like the AI panel it was meant to back up.

### OQ-4 - Who may refresh fingerprints (acknowledge drift)?

- **a - Anyone, as a committed edit visible in the PR diff. (rec)** Links are first
  written during Implement, mostly by agents, so the initial fingerprint is already
  agent-recorded; drift is a warning (OQ-3a) and the review panel sees every fingerprint
  change. Cost: an agent can silence its own drift warning in the same PR that caused it;
  only review catches that.
- **b - Human-only, attributed, like SPEC-041 FR-7's re-acknowledgement.** Consistent with
  leg A. Cost: a human keystroke for every refactor that touches a linked symbol, and it
  is inconsistent unless the *initial* link is also human-attested, which puts a human
  sign-off on every link.

### OQ-5 - What does the fingerprint normalise away?

- **a - Hash the token stream: strip whitespace and comments. (rec)** Reformatting and
  comment edits do not flag drift. Cost: a behaviour change made only through a comment
  directive (`// @ts-ignore`, `eslint-disable`, a JSDoc type in a `.js` file) does not
  flag.
- **b - Hash text with whitespace normalised, comments kept.** Cost: every comment or doc
  edit flags drift, which trains people to refresh without reading.
- In either case the fingerprint covers only the symbol's own text; a change in a function
  it calls does not drift it. That is a stated limit, not a defect.

### OQ-6 - Do DR claims enter the first slice?

- **a - Specs only first. (rec)** Specs already carry `FR-N` ids; DRs have no stable
  paragraph ids until the DR-053 corpus migration (#681). Cost: the issue's own examples
  ("extracted to packages/shared" in a DR) stay with the AI panel until a follow-on slice.
- **b - DRs too, keyed by an ad-hoc claim id.** Cost: invents a second id grammar ahead of
  DR-053 v2, which would then need migrating.

### OQ-7 - Should `deriveStatus` consume the trace verdict?

- **a - Not in this spec; validator finding only. (rec)** Keeps the blast radius off the
  signpost derivation (DR-034, DR-069) until the verdicts have run on the real corpus.
  Cost: the signpost may still show `done` for a spec the validator flags, until a
  follow-on wires the floor in.
- **b - Floor a `done` spec with a non-`linked`, non-exempt FR to `implementing`.** Cost:
  touches the authoritative status derivation and every surface that renders it; a false
  `broken` from the extractor would then visibly demote a correct spec.

## Decision records

No DR is minted by this spec. Two choices become costly to reverse once links exist in the
corpus: the link-record schema and location (OQ-2) and the resolver (OQ-1). Under the
DR-359 filter (parent register, mmo-platform: a choice that cannot be undone in under a day) they need a DR. That DR is
written **after** Clarify answers OQ-1 and OQ-2 and **before** design.md is approved, so it
records a decision rather than a menu. It extends DR-062 §6 (leg B) and must carry
`Triggered by: #643`. Searched before deciding: `docs/decisions/INDEX.md` for "trace",
"symbol", "drift", "false-built", "graph" - DR-062 assigns leg B to #643 but decides
nothing about it; DR-053 supplies the id grammar; DR-038 is the artifact-level DAG; none
decides a code-link schema or resolver.

## Costly to Refactor

- The **link-record schema and location** (OQ-2): once specs carry links, a move is a
  corpus migration.
- The **anchor grammar** (`path#Qualified.name`, `path#describe > it`): every record
  depends on it.
- The **fingerprint normalisation** (OQ-5): changing it later flags every link drifted at
  once, a mass refresh.
- **Cheap to reverse:** severity per verdict (OQ-3), who may refresh (OQ-4), and whether
  `deriveStatus` consumes the verdict (OQ-7).

## Risks

| # | Risk | L·I | Mitigation |
|---|---|---|---|
| R1 | Extractor misses a real symbol, so a correct spec reads `broken` (false block). | Med·High | OQ-1a uses the reference parser; unsupported forms read `unresolvable`, not `broken` (FR-10). |
| R2 | Drift warnings are so frequent that people refresh without reading. | Med·Med | OQ-5a ignores formatting and comments; drift names the requirement to re-read. |
| R3 | A link to an existing but wrong symbol reads `linked` - the trace proves existence, not correctness. | High·Med | FR-13 / INV-5: a trace can veto `done`, never confer it; correctness stays with tests and review. |
| R4 | Links are never written, so the check fires on nothing (the "zero corpus uses" fate of `supersedes:` noted in DR-062 §6). | High·Med | The `done` veto (FR-13) under the OQ-3a ratchet makes an untraced `done` spec visible; backfill is part of the ratchet. |
| R5 | Requirement-id extraction differs across spec generations (SPEC-136 groups FRs under lettered headings). | Med·Med | FR-9 accepts both id forms and fails visibly when it finds none; Plan measures extraction over the whole corpus before the error flip. |
| R6 | Concurrent PRs collide on the link store. | Med·Med | OQ-2a per-spec files. |
| R7 | Performance on the full corpus is worse than the issue's "sub-ms" (that figure is unverified, and a full parse costs more). | Med·Low | Cache per file by git blob hash; Plan measures before choosing editor-time vs CI-only. |

## Out of Scope

- DR and epic claims (OQ-6a).
- Changing `deriveStatus` (OQ-7a).
- Any change to `scripts/hooks/spec-gate.py`; the gate keeps reading file-level
  `implements:` (SPEC-038 FR-8).
- LLM-suggested links; transitive (call-graph) drift; paragraph-level links other than
  `FR-N` (DR-053's other paragraph types).
- Leg A (SPEC-041) and leg C (#804).

## Test plan (for the Plan phase to place)

Unit tests for the pure engine over hand-built symbol tables (every verdict, orphan links,
duplicate ids, both id forms); extractor tests over fixture sources including the forms
that break regex extractors (overloads, default exports, class methods, arrow functions
assigned to `const`, template literals containing braces); link-store tests for schema
version, line-number rejection and undeclared paths; one validator integration test per
acceptance criterion. Mutation-test the engine: a fixture that always passes because the
extractor returned an empty table must be caught (the "tests can pass vacuously" class),
so at least one test asserts a non-empty symbol table before asserting a verdict.

## Traceability

- Issue: [#643](https://github.com/AIClarityAU/minspec/issues/643). Motivated by #362 (the
  backfill) and #627 (20 stale line citations). Interim gate it sits above: #626.
- Design rationale: [DR-062](../../../docs/decisions/DR-062.md) §6 (leg B),
  [DR-053](../../../docs/decisions/DR-053.md) (id grammar, and its note that #643 anchors to
  symbol plus test, not line), [DR-032](../../../docs/decisions/DR-032.md) (same
  deterministic-gate family).
- Layering, lowest first: deterministic artifact gates (#626, dangling-ref,
  accepted-on-proposed), then status derivation, then **this trace graph**, then the AI
  panel as the semantic backstop.
