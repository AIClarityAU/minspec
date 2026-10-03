---
id: SPEC-097
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology — same epic DR-025 itself carries
aspects: [frontmatter, schema, validator-gate, drift, traceability, no-silent-gate]
relates_to: [DR-025, DR-003, DR-013, DR-012, DR-022, "#107"]
implements: [packages/minspec/src/lib/frontmatter-schema.ts, packages/minspec/tests/frontmatter-schema-order.test.ts]
affects: [packages/minspec/src/lib/spec.ts, packages/minspec/src/lib/spec-validator.ts, packages/minspec/src/lib/spec-vocabulary.ts, packages/minspec/src/lib/slash-commands.ts, scripts/validate-frontmatter.ts, specs/minspec/SPEC-004-classifier-validation/requirements.md, specs/minspec/SPEC-005-auto-structure-repair/requirements.md, specs/minspec/SPEC-006-stub-completeness-gate/requirements.md, specs/minspec/SPEC-007-epic-grouping/requirements.md, specs/minspec/SPEC-010-signpost-correctness/requirements.md, specs/minspec/SPEC-011-epic-backfill/requirements.md, specs/minspec/SPEC-039-push-docs-lane-command/requirements.md]  # all owned elsewhere or pre-existing content this spec reorders/backfills, never a second owner (SPEC-047 pattern) — new logic is isolated in the owned frontmatter-schema.ts
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — One canonical frontmatter field schema owns field set and order, enforced by a soft validator gate (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, template, or test is created by this
> document. It is the Specify-phase artifact for #107, which triage classified `T3` ·
> `role:dev` · `hold:specify` — so the spec is the gate, not the fix. A human reads it,
> answers the **Decisions needed (Clarify)** questions below, and approves it through the
> normal spec-approval gate before any code changes.

**Id note.** `SPEC-096` is the highest id on disk at specify-time; no open branch/PR named
`SPEC-097`+ was found in this checkout's remote refs (`git ls-remote --heads origin`,
`gh search code`), so this is `SPEC-097`. Renumber at review time if the collision gate
(`scripts/validate-frontmatter.ts` → `checkDeclaredSpecIds`) disagrees.

## One-Sentence Scope

Define the spec frontmatter field set and declaration order exactly once, in code, and give
`spec-validator.ts` a soft (warning-only) gate that checks every spec against it — so the
drift #107 reports stops being re-introduced the moment the gate exists, independent of
whether every reference field also gets a typed accessor.

## Design rationale already on record

**DR-025** (`docs/decisions/DR-025.md`, accepted 2026-07-25) diagnosed the root cause —
no canonical owner, a dead `serializeFrontmatter` emitter, no validator check — and decided
the shape of the fix: one schema, a soft gate mirroring DR-013's epic rule, then backfill.
This spec materializes that decision. **Nothing below re-opens DR-025's core decision**
(canonical schema + soft gate); the **Decisions needed** section below is new ground DR-025
did not reach, surfaced by re-verifying its claims against the repo as it stands today
(2026-10-03, ten weeks and ~20 more specs after DR-025 was written).

## Context — re-verified against today's code and corpus, not re-asserted from the issue

The issue body (and DR-025) describe the drift from a table written on 2026-06-01. Re-reading
the code and the disk corpus now turns up both confirmations and corrections:

### Confirmed: the gate is genuinely missing

`spec-validator.ts`'s `CLOSED_SET_FIELDS` array (`:534-560`) only covers `id`, `status`,
`tier`, `type`, `superseded-by` — presence-checked symmetrically (`checkClosedSetField`,
`:563-602`), WARN severity. `product`, `epic` (handled separately, DR-013, `:919-946`),
`aspects`, `depends_on`, `relates_to`, `implements`, `affects` have **no** presence check, and
**no** field has an order check of any kind. Confirmed: zero `order` references anywhere in
the file.

### Confirmed, with two more concrete divergences than the issue names

`serializeFrontmatter` (`packages/minspec/src/lib/spec.ts:378-407`) emits, in order: `id,
title, type, tier, status, superseded-by, created, epic, product`. Scanning the frontmatter
key order of all 74 `requirements.md` specs on disk shows a **stable convention since
`SPEC-054`** (2026-08-07, two weeks after DR-025 was accepted) through `SPEC-096`
(2026-10-01) — 35+ specs, zero exceptions:

```
id, type, status, [superseded-by], tier, product, [epic],
[aspects], [depends_on], [relates_to],
implements (or implements: none + implements_reason),
[affects], phases
```

(bracketed fields are optional; the claim is about the *relative* order of fields that are
present, never about requiring an absent one.) Against that stable order, the writer has two
concrete bugs beyond the title/created problem the issue already names:

- **`tier` before `status`** (`spec.ts:387`, `:392`) — every spec on disk has `status` before
  `tier`.
- **`epic` before `product`** (`spec.ts:397`, `:400`) — every spec on disk has `product`
  before `epic`.

### Correction: `title` is not dead code; `created` is

DR-025 §1 says "drop dead `title`/`created` if unused (confirm no reader depends on them
first)" and flags this as open (Risk R1). Checking now, per this project's own Evidence
Discipline rule (cite `file:line`, not plausible inference):

- **`created`** has **zero** readers outside `spec.ts` itself — `grep -rn
  "frontmatter\.created\|fm\.created" packages/minspec/src` returns only the writer line
  (`spec.ts:396`) that re-emits whatever the parser defaulted in (`:304`). It is genuinely
  dead: a pure round-trip field with no behavioral effect anywhere.
- **`title`** has **live** readers, all with a graceful fallback: `spec-panel.ts:69`
  (`spec.frontmatter.title || spec.frontmatter.id`), `spec-panel-html.ts:158`
  (`frontmatter.title || frontmatter.id`), `epic-backfill.ts:256` (`fm.title || fm.id`), plus
  `spec-manager.ts:308`, `spec-progress.ts:57`, `spec-catalog.ts:94` (all read it into a
  `SpecSummary`/picker label). It is not dead; it is **optional with a working fallback**,
  the same shape `epic:`/`product:` already use (`spec.ts:397,400`: `if (fm.epic) …`).

### Correction: the backfill's named targets are smaller than the table claims

The issue's (and DR-025's) drift table lists "minspec 001/002/003" as G1 backfill targets.
`git log --all -- "specs/minspec/SPEC-001*" "specs/minspec/SPEC-002*" "specs/minspec/SPEC-003*"
"specs/minspec/SPEC-008*" "specs/minspec/SPEC-009*"` returns **no history at all** — these
paths have never existed in this repository (full history, not a shallow clone: `git
rev-parse --is-shallow-repository` → `false`, 1510 commits). The G1/G2 specs that actually
exist on disk and diverge from the stable order are **six**: `SPEC-004`, `SPEC-005`,
`SPEC-006`, `SPEC-007`, `SPEC-010`, `SPEC-011` — all six already carry a committed approval
sidecar under `.minspec/approvals/specs/minspec/SPEC-0{04,05,06,07,10,11}-*/` (verified by
listing that directory), which is the live wrinkle DR-025's own Risk R2 named but did not
sequence (see DQ-2).

### Out of this repo's reach: scrooge's own `100/101/102`

The same drift table's `scroogellm 100/101/102` row is **not addressable from this repo at
all** — ScroogeLLM was split into `AIClarityAU/scroogellm` (private) per DR-027 and keeps its
own, independent DR/spec register (`CLAUDE.md` Project Overview, SDD Phases). Constitution
invariant 3 (blast radius) forbids anything this repo ships from reaching a repo that has not
opted in. This spec's backfill (FR-9) is scoped to this repo's `specs/` only; if scrooge wants
the same convention, that is a separate issue filed in that repo, not a follow-up here.

### The gate ships inside the extension — this is normal evolution, not a new risk class

`spec-validator.ts` is extension code; every adopter who installs MinSpec runs it. A new
WARN-only rule here behaves exactly like DR-013's existing epic rule (`:919-946`), which
already ships to every adopter today — this is not a new blast-radius category, just one more
soft rule in the same file (see Invariants, INV-3).

## Functional Requirements

- **FR-1 (one schema, one source).** The frontmatter field set and declaration order are
  expressed exactly once, in code, in a new leaf module with no other imports (same shape as
  `spec-vocabulary.ts`, which exists for the identical reason — avoiding a `spec.ts ↔
  spec-validator.ts` import cycle, `spec-vocabulary.ts`'s own docblock). Both
  `spec-validator.ts`'s order check (FR-6) and `spec.ts`'s `serializeFrontmatter` (FR-3)
  import it; no second hard-coded order literal may exist anywhere in the codebase after
  this lands (checked by AC-1 / INV-5).

- **FR-2 (the canonical order, evidence-based).** The canonical order is:
  `id, type, status, [superseded-by], tier, product, [epic], [aspects], [depends_on],
  [relates_to], implements (or implements: none + implements_reason), [affects], phases`.
  This is the Context section's verified stable-corpus order, not the issue's original
  drift table taken at face value. Plan MUST re-run the same corpus scan
  (`awk '/^---$/{c++;next} c==1 && /^[a-zA-Z_-]+:/{print $1}'` over every
  `specs/**/requirements.md`) immediately before freezing the schema, since more specs land
  on `main` daily and this spec's own dispatch is one of them.

- **FR-3 (writer reconciled).** `serializeFrontmatter` (`spec.ts:378-407`) emits `status`
  before `tier` (currently reversed) and `product` before `epic` (currently reversed), per
  FR-2. Both changes are confirmed-safe: no code reads positional order, only the parser's
  key-based lookup (`parseFrontmatterYaml`), so reordering the writer cannot change parsed
  values, only emitted byte order.

- **FR-4 (`created` dropped; `title` kept and demoted to optional).** `created` is removed
  from `SpecFrontmatter` and the writer (dead per Context). `title` stays, emitted only when
  present (`if (fm.title) …`, matching the existing `epic`/`product` pattern), never
  fabricated for a spec that has none — the id/H1-heading fallback already in use
  (`firstH1Heading`, `spec.ts:114-120`) is untouched.

- **FR-5 (`product:` becomes a checked field).** 73 of 74 `requirements.md` specs on disk
  carry `product:`. Add it to `CLOSED_SET_FIELDS` (`spec-validator.ts:534-560`) as
  `required: true, requiredWhen: isPrimarySpec` — the same conditional `tier` already uses
  (`:545`) — WARN severity, not error (consistent with every existing rule in that array).
  See DQ-3 for a scope question this raises for single-product adopters.

- **FR-6 (the order gate itself — soft, raw-key based).** `spec-validator.ts` gains a new
  rule, `frontmatter.order.mismatch`, WARN severity (mirrors DR-013's epic rule, `:919-946`,
  and the symmetric closed-set pattern, `:948-965`; never blocks, per DR-025 Decision §3).
  It reads the raw frontmatter block's top-level keys in their as-written order — the exact
  tokenization `extractUnknownFrontmatterLines` already performs (`spec.ts:205-235`), so no
  new YAML parsing is introduced — and asserts those keys, filtered to ones FR-2's schema
  recognizes, form a subsequence of the canonical order (i.e. for any two recognized keys A
  before B in the raw text, canonical order must not place B before A). A key the schema does
  not recognize is skipped for ordering purposes (see FR-7) — it neither satisfies nor
  violates the check.

- **FR-7 (decoupled from full typing of every reference field — DQ-1 decides the rest).**
  FR-6's check works whether or not `depends_on`/`aspects`/`relates_to`/`implements`/
  `affects`/`implements_reason` are ever individually typed into `SpecFrontmatter`. Today
  they travel as opaque, verbatim-preserved lines (`ParsedSpec.extraFrontmatter`,
  `spec.ts:70-98`, `#2324`) that `extractUnknownFrontmatterLines` already returns in original
  order — exactly the data FR-6 needs. DR-025 §1 originally called for typing all of them;
  whether this spec still does that (fully, partially, or not at all) is **DQ-1**, not
  something FR-6 requires either way.

- **FR-8 (authoring guidance matches the gate).** `FRONTMATTER_GUIDANCE`
  (`slash-commands.ts:80-99`) and the `specify` command body (`:129-138`) state FR-2's order
  explicitly — today they say nothing about order at all, which is exactly how a
  freshly-authored spec (SPEC-045 through SPEC-049, written days before DR-025's own
  acceptance) drifted in the first place. The guidance text imports the same FR-1 schema
  module rather than restating the order as a second literal (AC-8 / INV-5).

- **FR-9 (backfill — scoped to what actually exists here).** Reorder `SPEC-004`, `SPEC-005`,
  `SPEC-006`, `SPEC-007`, `SPEC-010`, `SPEC-011` to FR-2's order (the six real, on-disk
  divergent specs — see Context's correction; **not** the non-existent `SPEC-001/002/003`
  the issue's table names). Backfill `SPEC-039-push-docs-lane-command` with the `product:`
  line FR-5 now checks for. `AIClarityAU/scroogellm`'s own specs are explicitly untouched
  (Context, "Out of this repo's reach").

- **FR-10 (approval staleness stays visible, never silently preserved).** All six of FR-9's
  targets carry a committed approval sidecar (`.minspec/approvals/specs/minspec/SPEC-0{04,
  05,06,07,10,11}-*/`) whose canonical hash covers frontmatter bytes other than
  `status`/`phases` (SPEC-022). Reordering those bytes stales every one of those approvals
  through the existing, correct mechanism (DR-012) — this spec MUST NOT suppress, special-
  case, or carry forward a stale approval as if it were still current (constitution's
  no-borrowed-identity-approval rule). DQ-2 decides *when* the backfill happens, not whether
  the staleness is allowed to show.

## Costly to Refactor

- **The canonical order itself (FR-1/FR-2).** Once the gate (FR-6) ships and specs are
  written against it, changing the order again repeats the exact thrash this spec exists to
  stop — re-verify FR-2 against the live corpus (not just this document) before Plan freezes
  it.
- **Whether reference fields get typed (DQ-1).** Picking "type them all" after shipping the
  raw-key version (FR-6/FR-7) means revisiting every `ParsedSpec` construction site a second
  time — decide once, before Plan, not incrementally.
- Everything else here — writer order, `created` removal, the backfill — is a reversible,
  sub-day diff; no new DR is needed (see below).

## Acceptance Criteria

- [ ] **One schema, no duplicate literal** — grep confirms exactly one module declares the
  canonical field order, imported by the validator, the writer, and the slash-command
  guidance text. (FR-1, FR-8)
- [ ] **Writer order fixed** — a unit test round-trips a spec through `writeSpec` and asserts
  `status` precedes `tier` and `product` precedes `epic` in the emitted bytes; today's code
  fails this (red), the fix passes (green). (FR-3)
- [ ] **`created` gone, `title` preserved** — writing a spec with neither field round-trips
  without inventing either; a spec authored with `title:` keeps it unchanged through a
  write cycle. (FR-4)
- [ ] **`product:` required-when-primary** — a primary (non-split-layout) spec missing
  `product:` produces a `frontmatter.product.missing` warning; a secondary design/tasks file
  does not. (FR-5)
- [ ] **Order warning fires on a real violation** — a fixture with `status:` written before
  `type:` produces exactly one `frontmatter.order.mismatch` warning; today's validator
  produces none (red → green). (FR-6)
- [ ] **Order warning is silent on canonical order regardless of which optional fields are
  present** — fixtures covering every optional-field-present/absent combination in the stable
  corpus produce zero order warnings. (FR-6, FR-2)
- [ ] **Unrecognized fields never trip the order check** — a fixture with a key the schema
  does not model produces no order warning attributable to that key, and the fields around it
  are still checked normally. (FR-7)
- [ ] **Never blocks** — `npm run validate` exits 0 on a spec whose only finding is an order
  or `product.missing` warning; only an existing hard-required-field absence can fail it.
  (FR-6, FR-5, Invariants INV-1)
- [ ] **Guidance text and gate agree** — the `specify` command body's stated order is read
  from the same FR-1 module the validator checks against, not duplicated by hand. (FR-8,
  INV-5)
- [ ] **Backfill targets match reality** — after backfill, the six named specs
  (`SPEC-004/005/006/007/010/011`) produce zero order warnings; `git diff` for this spec's
  implementation touches no path under a scrooge product or outside this repo. (FR-9)
- [ ] **Staleness surfaces, never hidden** — after backfill, the existing approval-staleness
  check reports all six reordered specs as `stale`, never as still `approved`. (FR-10)

## Invariants

- **INV-1 (constitution 2, no silent gate).** Every new WARN (`frontmatter.order.mismatch`,
  `frontmatter.product.missing`) is returned/printed by the normal validator output path —
  never computed and discarded, never swallowed by a `|| true`-shaped catch. `npm run
  validate`'s exit code continues to mean what it means today: these are warnings, and a
  warning-only run still exits 0, by design (DR-025 Decision §3), not by omission.
- **INV-2 (DR-012/SPEC-022, approval integrity preserved).** Neither the gate nor the
  backfill may fabricate, extend, or silently re-stamp an approval. A byte change to a spec's
  frontmatter always re-exposes it to the existing canonical-hash mechanism unchanged.
- **INV-3 (constitution 3, blast radius — correctly scoped, not overclaimed).** The validator
  rule (FR-6) ships inside the extension and will warn in every adopter's repo, exactly as
  DR-013's epic rule already does — ordinary feature evolution of shipped, opted-in code, not
  a new risk category. What stays strictly inside *this* repo's walls: the **backfill**
  (FR-9), which touches only this monorepo's own `specs/`, and never reaches
  `AIClarityAU/scroogellm` or any other repo.
- **INV-4 (constitution 1, offline).** No network call is introduced anywhere in this
  change; the order check is pure string/array comparison over frontmatter text the
  validator already has in memory.
- **INV-5 (single source — DR-025's own "Costly to Refactor" callout, carried forward).**
  The canonical order/field-set is declared in exactly one place (FR-1). A parity test
  (SPEC-074's single-classifier-guarantee shape) asserts the validator's check, the writer's
  emit order, and the guidance text's stated order are all read from that one module — never
  three independently-maintained literals agreeing by luck, which is the precise failure
  DR-025 diagnosed in the first place.

## Decisions needed (Clarify)

These are genuine forks a human must pick before Plan; none was guessed here.

- **DQ-1 — Does the order/field-set check read raw frontmatter text, or does every
  reference field first get typed into `SpecFrontmatter`?**
  - **Option A — raw-key check now; no new typed fields (rec).** FR-6/FR-7 as written:
    the order check reads the same raw-text tokens `extractUnknownFrontmatterLines` already
    produces. `SpecFrontmatter` only gets the FR-3/FR-4 fixes (writer order, drop `created`).
    *Cost:* DR-025 §1's literal instruction ("add `type`, `product`, and optional
    `depends_on`, `aspects`, `relates_to`" to the interface) is only half-done — `type` and
    `product` are already typed (verified: `spec.ts:67-73`, present since before this spec),
    but `depends_on`/`aspects`/`relates_to`/`implements`/`affects` stay untyped, opaque text.
    Any future consumer that wants a structured accessor for those fields (rather than
    grepping raw text) still has none; that becomes a separate, explicitly deferred want.
  - **Option B — type every reference field into `SpecFrontmatter` first, per DR-025 §1 as
    originally written**, and run the order check off the typed object instead of raw text.
    *Cost:* touches every `ParsedSpec` construction site in the codebase (the same "touches
    every reader" lesson SPEC-095 already paid for on a smaller change) for fields the order
    check does not actually need typed to work — materially larger diff and regression
    surface on an already-T3 change, for benefit (FR-7) that Option A gets for free.
  - *Trade-off:* A ships the thing #107 actually asked for (a canonical order + a gate) with
    the smallest footprint; B completes DR-025's original wording literally, at a cost DR-025
    did not anticipate because the raw-text `extraFrontmatter` mechanism (#2324) did not exist
    when DR-025 was written.

- **DQ-2 — Does the backfill (FR-9) land in this same change, or as a separate follow-up
  once the gate is visible?**
  - **Option A — separate follow-up, filed once this spec's gate lands (rec).** The six
    stale-on-reorder approvals (FR-10) get their own single-purpose PR: reorder + re-approve,
    reviewable on its own terms. *Cost:* between the gate landing and the follow-up landing,
    the six specs visibly warn `frontmatter.order.mismatch` — drift made visible, not drift
    continuing silently.
  - **Option B — bundle the backfill into this spec's own implementation,** re-approving all
    six specs in the same change that ships the schema/gate logic. *Cost:* inflates a
    multi-file T3 change with six more file diffs and six unrelated re-approvals, and ties
    the gate's landing to getting a human to re-read and re-approve six specs that have
    nothing to do with the mechanism itself.
  - *Trade-off:* DR-025 Decision §4 already says "backfill… after the gate exists, so the
    line holds once swept" — Option A is the literal reading of that; Option B trades a
    larger single PR for no visible interim warning window.

- **DQ-3 — Should `product:` becoming required-when-primary (FR-5) be conditioned on this
  repo actually being multi-product, so a single-product adopter never sees a new warning
  they have no vocabulary to resolve?**
  - **Option A — condition on a "multi-product" signal (rec)**, e.g. more than one distinct
    `product:` value already present across the corpus — the same shape the existing epic
    rule uses (`knownEpicRefs.size > 0`, `spec-validator.ts:939`) to stay silent in a
    pre-epic repo. A single-product adopter never sees `frontmatter.product.missing`.
    *Cost:* one more conditional to design and test; "multi-product" needs a precise, cheap
    definition (count of distinct values? an explicit config flag?) — itself a small
    sub-decision for Plan.
  - **Option B — ship unconditionally required-when-primary.** *Cost:* every installed
    adopter who has never set `product:` (the common single-extension-repo case this very
    comment at `spec.ts:398-400` was written to accommodate) gets a new warning the day they
    upgrade MinSpec, for a field their repo has no use for — the opposite of DR-025's own
    "soft rule, never surprise" framing (Decision §3).
  - *Trade-off:* A costs a small amount of extra design now to avoid a real, if soft, UX
    regression for every single-product adopter on the next release; B is simpler to build
    and accepts that regression.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | FR-2's canonical order goes stale between Specify and Plan as more specs land on `main`. | FR-2 requires Plan to re-run the corpus scan before freezing the schema, not trust this document's snapshot. |
| R2 | Backfilling six approved specs (FR-9) silently gets treated as still-approved. | INV-2 + FR-10 make staleness an explicit, tested outcome (AC "Staleness surfaces, never hidden"). |
| R3 | DQ-3 left unresolved ships a new single-product-adopter regression. | DQ-3 is a Clarify blocker, not a default — Plan must carry the recorded answer, not invent one. |
| R4 | A second hard-coded order literal (e.g. a copy-pasted array in a test fixture) reintroduces DR-025's exact failure mode. | INV-5's parity test fails if validator/writer/guidance ever disagree. |
| R5 | The order check's "unrecognized key is skipped" rule (FR-6/FR-7) is read as "anything goes," silently widening what counts as valid. | FR-6 only skips ordering for *unrecognized* keys; FR-5's required-field presence check (and the existing `CLOSED_SET_FIELDS` ones) still fire independently. |

## Out of Scope

- **`AIClarityAU/scroogellm`'s own specs** (the issue's `100/101/102`) — separate repo, own
  DR register, constitution invariant 3. If wanted there, file it in that repo.
- **Making the order/field-set check an error instead of a warning.** DR-025 Decision §3
  already settled WARN; revisiting that is a DR amendment, not this spec.
- **The approval-hash algorithm itself (SPEC-022).** This spec only exercises it as designed
  by changing bytes; it does not change what the hash covers or how staleness is computed.
- **Typing every reference field into `SpecFrontmatter`**, unless DQ-1 picks Option B.
- **Re-litigating DR-013's epic rule** or any other existing `CLOSED_SET_FIELDS` member —
  this spec only adds `product` (FR-5) and the order check (FR-6) alongside them.

## Why no new DR

The DR-359 filter asks whether a decision costs more than a day to undo. DR-025 already
recorded the one decision here that would have warranted a DR (canonical schema + soft gate,
accepted 2026-07-25) — this spec materializes it, it does not re-decide it. DQ-1 (raw-key vs.
typed check) and DQ-2 (backfill sequencing) are both reversible code-structure choices; DQ-3
(a conditional on an existing rule) is a reversible on/off switch. None crosses the DR-359
bar. The recorded Clarify selections, once this spec is approved, are the durable record of
how DR-025's open risks (R1/R2 in that document) were resolved — no second document is
needed; if a future session wants that resolution more visible than a spec's Clarify section,
it can append it to DR-025 as a follow-up note, but that is not required for this spec to
proceed.

## Test plan (for the Plan phase to place)

1. AC "one schema, no duplicate literal" / "guidance text and gate agree": a parity test
   (SPEC-074's single-classifier-guarantee shape) imports the FR-1 schema module from the
   validator, the writer, and the guidance-text builder, asserting all three resolve to the
   same array reference — fails if any of the three ever hard-codes a second copy.
2. AC "writer order fixed" / "`created` gone, `title` preserved": `spec.ts` round-trip unit
   tests, run red against pre-fix code first (DR-003's root-cause discipline — a test that
   has never failed proves nothing).
3. AC "`product:` required-when-primary" / "order warning fires" / "silent on canonical
   order" / "never trips on unrecognized fields" / "never blocks": `spec-validator.test.ts`
   fixtures, one per case, each red before FR-5/FR-6 land.
4. AC "backfill targets match reality": run the real validator against the six backfilled
   specs (not synthetic fixtures) and assert zero `frontmatter.order.mismatch` findings;
   separately assert the diff touches no scrooge-product or out-of-repo path.
5. AC "staleness surfaces, never hidden": extend the existing approval-staleness test harness
   (the SPEC-029/SPEC-041 lineage) with the six reordered specs, asserting `stale`.

New test file (owned by this spec, declared under `implements:`):
`packages/minspec/tests/frontmatter-schema-order.test.ts`.

## Traceability

- **Issue:** [#107](https://github.com/AIClarityAU/minspec/issues/107) — "canonical spec
  frontmatter schema + field-order validator gate," filed per DR-360 (session-scope park) from
  the question "can we have a standard ordering of the frontmatter fields? is that just
  backfill from older schemas?"
- **Design rationale:** [DR-025](../../../docs/decisions/DR-025.md) — accepted 2026-07-25,
  names the root-cause mechanism and the DR-012 approval-void consequence this spec's FR-10 /
  DQ-2 resolve the sequencing for.
- **Triage verdict:** `agent-ready-specify` · `role:dev` · `tier:T3` · `hold:specify` — T3
  multi-file schema reconciliation + new validator gate + template + backfill, Specify phase
  only authorized on this dispatch.
- **Precedent gates reused:** DR-013 (soft epic warning, `spec-validator.ts:919-946`), the
  symmetric closed-set presence pattern (`:534-602`), SPEC-074's single-classifier-guarantee
  test shape, SPEC-047's "modifies-not-owns, new logic isolated in an owned module" ownership
  pattern.
