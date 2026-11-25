---
id: SPEC-413
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - frontmatter-declared contract signals (amends the #23 contract-frontmatter spec)
aspects: [contract-driven-development, frontmatter, validation, escape-hatch, tier-0]
relates_to: [SPEC-114, SPEC-109, SPEC-038, "#4018", "#23", "#4020", "#133"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3). The one
# NEW file is the test that pins the escape. The code this spec changes lives in files the #23
# contract-frontmatter spec owns (cdd-links.ts, its validator function, its panel section),
# none of which exists yet; listing them here would double-own them. They are named under
# "Files this would touch" and promoted to `affects:` at Plan, the SPEC-114 / SPEC-040 precedent.
implements: [packages/minspec/tests/cdd-contracts-none.test.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-413: Admit `contracts: none` plus `contracts_reason:` in the contract frontmatter

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks the two questions under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the
> normal spec-approval gate before any code changes. Every requirement is written under each
> question's recommended option.

Materializes **[#4018](https://github.com/AIClarityAU/minspec/issues/4018)** (SPEC-114
Follow-ups item 1). It amends the contract-frontmatter spec for
**[#23](https://github.com/AIClarityAU/minspec/issues/23)**. No decision record (DR) is
needed; see [Why no new DR](#why-no-new-dr).

## One-Sentence Scope

A spec may answer the `contracts:` field with the single token `none` together with a
non-empty `contracts_reason:`, and the #23 spec's warn-only validator, parser and panel treat
that as a valid, visible declaration of "this spec has no code contract", never as a
malformed path.

## Context (read, not inferred)

### Why this exists

SPEC-114 (refactorability enablers) FR-3 warns when a T3 or T4 spec with seams in its
`## Costly to Refactor` section declares no `contracts:` entry. Its FR-4 says that
`contracts: none` plus a non-empty `contracts_reason:` must satisfy that warning, because many
seams are not code (a file grammar, a section order). A warning that cannot be answered
honestly teaches people to ignore it. SPEC-114 does not own the `contracts:` field. Its
Clarify question DQ-2 has a recorded selection, Option A
(`specs/minspec/SPEC-114-refactorability-enablers/requirements.md:477`): keep the specs
separate, and amend the #23 spec so it admits the shape. SPEC-114 FR-20 keeps its
seam-contract slice out of Plan until that has happened.

### The #23 spec, as it stands

The contract-frontmatter spec for #23 claims **SPEC-100** and lives only on the unmerged
branch `agent/issue-23` (tip `86d0fb509`, dated 2026-10-02, read from the local
remote-tracking ref `origin/agent/issue-23`; this dispatch makes no network call). No spec
on `main` at `e53958e1` declares `id: SPEC-100`. The id is not final until that branch
merges, so this spec names it as "the #23 spec (SPEC-100 on its branch)". What it says
about `contracts:`:

- **Its FR-1:** `contracts:` is "a list of `{ path: string, type: string }` entries". It has
  no scalar form.
- **Its FR-3:** every `contracts[].path` must be a repo-relative path that passes
  `isEscapingPath`.
- **Its FR-4:** `contracts[].type` is a closed vocabulary, `typescript` or `zod`.
- **Its FR-5:** `validateCddLinks` emits warnings only. It warns on a malformed or dangling
  entry, and it has "No missing-direction check": a spec that declares none of its three
  fields produces zero violations.
- **Its FR-6:** the Active Spec panel renders each `contracts[]` entry as a file link.

As written, `contracts: none` is malformed under that spec. `none` is not a list of maps,
it has no `path` or `type`, and under FR-5 it would read as a dangling entry. The shape
SPEC-114 FR-4 relies on would therefore produce a warning of its own.

### The precedent this mirrors, read from code on `main` at `e53958e1`

SPEC-038 already ships the same escape for `implements:`, in `validateOwnership`
(`packages/minspec/src/lib/spec-validator.ts:1002`):

- `spec-validator.ts:1018-1019`: `fmListField(raw, 'implements')` tokenizes the value, and
  the escape holds when there is exactly one token whose lowercase form is `none`. Because
  `fmListField` (`spec-validator.ts:768-781`) splits on commas, whitespace and brackets, the
  inline forms `none`, `None`, `[none]` and `"none"` and the one-item block list `- none`
  all yield the token list `['none']`.
- `spec-validator.ts:1020,1025`: the reason is `rawFrontmatterField(raw, 'implements_reason')`,
  which returns `undefined` when the key is absent or its value is empty after
  inline-comment stripping (`spec-validator.ts:428-443`). A block scalar (`>-`) counts as
  present. That is the corpus's shape for 9 `implements_reason:` values, according to the
  comment at `spec-validator.ts:854`.
- `spec-validator.ts:1042`: the `none` token is exempt from the path-validity check.

SPEC-109 (canonical frontmatter schema, `status: planning` on `main`) lists the SPEC-038
pair as rows 12 and 13 of its field table: `implements` is "list of paths, or `none`" and
`implements_reason` is "scalar". Its FR-13 warns on any key that is not in its table. Its
Coordination table (`specs/minspec/SPEC-109-canonical-frontmatter-schema/requirements.md:397`) expects the #23 spec to add three
rows, `contracts`, `invariant_tests` and `file_allowlist`, and does not know
`contracts_reason`. Registering that key is **#4020**, a separate follow-up from SPEC-114.
It is not part of this spec.

## Functional Requirements

Each requirement below amends the #23 spec, named "SPEC-100" for short. Requirements of
that spec that are not named here stay unchanged.

- **FR-1 - `contracts:` gains a second form, the `none` escape.** In addition to the
  SPEC-100 FR-1 list of `{path, type}` maps, the value of `contracts:` may be the escape
  token. The escape is recognised exactly as `implements:` recognises its own (DQ-2). The
  field's tokens, read with the same tokenizer `validateOwnership` uses (`fmListField`, or
  the single successor that replaces it), are exactly one token, and that token lowercases
  to `none`. The inline forms `none`, `None`, `[none]` and `"none"` and the one-item block
  list `- none` are all the escape. A list that contains `none` together with any
  `{path, type}` entry is **not** the escape (FR-4).

- **FR-2 - One new optional key, `contracts_reason:`.** It is a top-level scalar. It counts
  as present exactly when `rawFrontmatterField(raw, 'contracts_reason')` (or the same
  successor reader `implements_reason` uses) returns a value. In other words it must be
  non-empty after inline-comment stripping, and a block scalar counts as present. It has no
  vocabulary and no minimum length beyond non-empty. It only qualifies `contracts: none`.

- **FR-3 - The escape is valid only with a reason.** `contracts: none` plus a present
  `contracts_reason:` is a **valid declaration**. `validateCddLinks` emits zero violations
  for the `contracts:` field. It does not run the SPEC-100 FR-3 path check, the FR-4 type
  vocabulary check or the FR-5 dangling-path check against the token `none`.

- **FR-4 - Three malformed shapes, each one warning.** `validateCddLinks` adds three rules.
  Each is `warning` severity, in keeping with SPEC-100 FR-5, and each produces one violation
  per spec:
  - `cdd.contracts.none-without-reason`: the field is the escape (FR-1) and
    `contracts_reason:` is absent or empty (FR-2). The fix hint names both fixes: add a
    one-line `contracts_reason:`, or list the real contract file(s).
  - `cdd.contracts.reason-without-none`: `contracts_reason:` is present and `contracts:` is
    absent or is a list. A reason that qualifies nothing implies a declaration that was not
    made. This is the reverse of the rule above (#137 symmetry).
  - `cdd.contracts.none-mixed`: the `contracts:` token list contains `none` (any case) and
    is not exactly the escape, for example `[none, {path: ..., type: zod}]`. The `none`
    token is reported once. It is never passed on as a path to the SPEC-100 FR-3 or FR-5
    checks, so a mixed list cannot also raise a "dangling path `none`" warning.

- **FR-5 - Still no missing-direction check in the #23 spec.** A spec that declares neither
  `contracts:` nor `contracts_reason:` still gets zero violations from `validateCddLinks`,
  as SPEC-100 FR-5, FR-8 and INV-1 require. The direction "a seam with no contract" belongs
  to SPEC-114 FR-3, which reads this spec's escape through FR-6. This spec does not add it
  a second time.

- **FR-6 - One reader, one contract type, consumed and never re-parsed.** The #23 spec's
  module (`cdd-links.ts`, SPEC-100's `implements:`) exports one pure function that turns a
  spec's raw frontmatter into a discriminated union:

  ```ts
  /** The one reading of a spec's `contracts:` + `contracts_reason:` (SPEC-413 FR-6). */
  export type ContractsDeclaration =
    | { kind: 'absent' }                                    // neither key present
    | { kind: 'none'; reason: string | undefined }          // FR-1 escape; reason per FR-2
    | { kind: 'list'; entries: ReadonlyArray<{ path: string; type: string }> }
    | { kind: 'malformed'; detail: 'none-mixed' | 'unparseable' };
  ```

  A `contracts_reason:` with no escape is reported by FR-4 from the reason reader. It does
  not need a variant of its own. `validateCddLinks` (FR-3, FR-4), the Active Spec panel
  (FR-7) and SPEC-114's `seam-check.ts` (its FR-3 and FR-4) all take this value. None of
  them re-tokenizes `contracts:`. SPEC-114 FR-4 is then satisfied exactly when
  `kind === 'none' && reason !== undefined`. The module stays Tier-0: no `vscode`, no
  network, no file system.

- **FR-7 - The panel shows the answer, not a broken link.** When the declaration is
  `kind: 'none'`, the SPEC-100 FR-6 panel section renders one plain-text line, "Contracts:
  none", followed by the reason text. The reason is HTML-escaped the same way the panel
  escapes every other spec-authored string, and it is never rendered as a file link. If the
  reason is missing, the line shows the `none-without-reason` warning text inline. That
  matches how SPEC-100 FR-6 shows a dangling path.

- **FR-8 - Authoring guidance names the escape.** In the same change, the place that tells
  authors how to declare `contracts:` must also describe the escape in one sentence, the
  way `spec-validator.ts:1034` describes `implements: none` plus `implements_reason:`. Today
  that place is the SPEC-100 validator fix hints. If SPEC-100 later adds authoring guidance
  to `/minspec-specify`, the sentence goes there too.

## Files this would touch (promoted to `affects:` at Plan)

All except the test file are owned by the #23 spec and do not exist on `main` yet:
`packages/minspec/src/lib/cdd-links.ts` (FR-1, FR-2, FR-6),
`packages/minspec/src/lib/spec-validator.ts` (`validateCddLinks`, FR-3, FR-4, FR-8),
`packages/minspec/src/views/spec-panel-html.ts` (FR-7). New:
`packages/minspec/tests/cdd-contracts-none.test.ts` (every AC below).

## Acceptance Criteria

- **AC-1.** A spec with `contracts: none` and `contracts_reason: the seam is a file grammar,
  not a type` gets zero `cdd.*` violations. The reader returns
  `{ kind: 'none', reason: 'the seam is a file grammar, not a type' }`. (FR-1, FR-2, FR-3, FR-6)
- **AC-2.** Each of `None`, `[none]`, `"none"` and a one-item block list `- none`, each with
  a reason, gives the same result as AC-1. Each one is a separate test case. (FR-1, DQ-2)
- **AC-3.** `contracts: none` with `contracts_reason:` absent gives exactly one
  `cdd.contracts.none-without-reason` warning. The same happens when the reason is an empty
  value or holds only an inline `# comment`. `npm run validate` still exits 0 in every case.
  (FR-2, FR-4)
- **AC-4.** A `contracts_reason:` with `contracts:` absent gives exactly one
  `cdd.contracts.reason-without-none` warning. The same happens when `contracts:` is a
  one-entry list of a valid `{path, type}` map. (FR-4)
- **AC-5.** `contracts: [none, {path: packages/shared/src/x.ts, type: zod}]` gives exactly
  one `cdd.contracts.none-mixed` warning. It gives **no** path-validity or dangling-path
  warning that names `none`. (FR-4)
- **AC-6.** Over the whole corpus, a spec that declares neither key gets the same violation
  count before and after this change. Measure it as SPEC-100 AC-7 does. (FR-5)
- **AC-7.** Given the AC-1 fixture, the panel renders the text "Contracts: none" and the
  reason, with no link element. A reason that contains `<script>` is rendered escaped.
  (FR-7)
- **AC-8.** Every SPEC-114 test that exercises its FR-4 (its AC-2) builds its input with the
  FR-6 reader, or reads the reader's output. A test asserts that `seam-check.ts` does not
  tokenize the `contracts` key itself. That test is a source-text check, so it is paired
  with a behavioural case: a `[none]` fixture must satisfy SPEC-114 FR-3 through the reader.
  (FR-6)

## Invariants (must not break)

- **INV-1 - Offline core (constitution invariant 1).** The reader, the validator rules and
  the panel line make no network call.
- **INV-2 - No silent gate (constitution invariant 2).** All three new rules are `warning`
  severity and appear in `npm run validate` output. Nothing here blocks a commit or a merge,
  so no new load-bearing gate is created. Promoting any of the three to `error` needs a new
  DR. The escape never hides a finding: `none` without a reason is reported (FR-4).
- **INV-3 - Blast radius (constitution invariant 3).** Every touched file is under
  `packages/minspec/`. Nothing is written outside an opted-in workspace.
- **INV-4 - The escape mirrors `implements: none`; it does not fork from it.** The token
  rule (FR-1) and the reason rule (FR-2) use the same readers `validateOwnership` uses. If
  those readers are replaced, both escapes move together. That is the duplicate-predicate
  drift risk, closed by sharing the reader rather than by a reminder.
- **INV-5 - Backward compatible.** A spec that uses neither key is unaffected (FR-5, AC-6).
  A spec that already uses a SPEC-100 list form validates exactly as SPEC-100 specifies.
- **INV-6 - Approval hash unchanged in scope.** `contracts_reason:` is content. The
  canonical hash strips only `status` and `phases` (SPEC-109 Coordination row for DR-088
  §1), so adding or editing the reason after approval stales the approval. That is
  intended: the reason is part of what a human approved. Authors declare it in Specify,
  like `implements:`.

## Decisions needed (Clarify)

Each question carries a recommended option and the cost of that option. Approving this spec
as written ratifies the recorded selections.

### DQ-1 - Where does this amendment live until the #23 spec merges?

The #23 spec is on an unmerged branch that this dispatch cannot edit (its allowlist is new
`specs/**` content on a branch cut from `main`).

- **Option A - this spec is the standing amendment, approved in the same sitting as the #23
  spec (rec).** SPEC-413 defines only the escape, and the #23 spec keeps everything else
  about `contracts:`. Plan for the #23 spec reads both. When the #23 spec's branch is next
  refreshed, its FR-1 gains one line, "or `none`, see SPEC-413". SPEC-114 FR-20's
  precondition becomes "the #23 spec and SPEC-413 are both approved". *Cost:* the grammar of
  one field is split across two documents, so a reader of the #23 spec alone misses the
  escape until that one-line pointer lands. INV-4 and FR-6 confine the drift risk to prose,
  because the code has one reader.
- **Option B - fold this text into the #23 spec on its branch, then mark SPEC-413
  `superseded`.** One document owns the field, which is what SPEC-114 DQ-2's phrase
  "amend the #23 spec" reads most literally as. *Cost:* it needs another dispatch on a
  branch untouched since 2026-10-02, which may also have to renumber (its id is not final).
  Until that happens, nothing reviewable exists, and SPEC-114's seam-contract slice stays
  blocked on that work.

**Recorded selection: the recommended option,** Option A. This spec is the standing
amendment, approved in the same sitting as the #23 spec, and it gives the #23 spec's FR-1 a
one-line pointer when that branch is next refreshed. An agent copied the (rec) option; no
human chose it. Recorded 2026-11-24 under DR-123. Approval of this spec ratifies it.

### DQ-2 - Which spellings of `none` count as the escape?

- **Option A - exactly the `implements:` rule: one token, case-insensitive, inline or
  bracketed or one-item block list (rec).** Authors who already write `implements: none`
  get the same behaviour, and INV-4 holds by construction because the reader is shared.
  *Cost:* `[none]` and `- none` look like lists. Because they are admitted, the
  `{kind: 'list'}` branch must check for the escape first, a small ordering rule in the
  reader that a test must pin (AC-2).
- **Option B - only the bare scalar `contracts: none`.** This is the strictest grammar, and
  any other spelling gets `none-mixed`. *Cost:* the two escapes diverge. A spelling that
  passes on `implements:` warns on `contracts:`, and the reader can no longer be shared,
  which reopens the drift INV-4 closes.

**Recorded selection: the recommended option,** Option A, the `implements:` rule. An agent
copied the (rec) option; no human chose it. Recorded 2026-11-24 under DR-123. Approval of
this spec ratifies it.

## Out of Scope

- **Registering `contracts_reason:` in SPEC-109's field table.** That is #4020. Until it
  lands, SPEC-109 FR-13 reports `contracts_reason` as an unknown key on every spec that uses
  the escape. That is expected and not a defect of this spec. #4020 should also widen the
  `contracts` row's shape to "list of `{path, type}`, or `none`", to match SPEC-109 row 12.
- **The "seam with no contract" warning.** That is SPEC-114 FR-3, which consumes FR-6.
- **Measuring how often `none` is chosen.** That is already a dated line in
  `docs/backlog.md` (the SPEC-114 FR-3 measurement after ten specs).
- **The same escape for `invariant_tests:` or `file_allowlist:`.** Nobody has asked for it.
  Neither field has a missing-direction check that would need an honest "none" answer.

## Why no new DR

Every part of this can be undone in under a day. The change is one optional key, one more
accepted value, three warn-only rules, a reader variant and a panel line, and reverting
them needs no migration. A spec that adopted the escape would be left with an unknown key,
which SPEC-109 FR-13 warns about and never rejects. The design follows an existing accepted
pattern (SPEC-038's `implements: none`) rather than making a new choice. A DR becomes
necessary only if a rule here is promoted from `warning` to `error` (INV-2).

## Follow-ups (tracked)

- **#4018** (this issue) also tracks the one-line pointer in the #23 spec's FR-1 (DQ-1
  Option A), because that pointer is the remainder of this issue's own ask: "amend the
  contract-frontmatter work for #23".
- **#4020**: register `contracts_reason:` and widen the `contracts` row in SPEC-109.

## Traceability

- **Issue:** [#4018](https://github.com/AIClarityAU/minspec/issues/4018); parent work
  [#23](https://github.com/AIClarityAU/minspec/issues/23), [#133](https://github.com/AIClarityAU/minspec/issues/133).
- **Specs:** SPEC-114 (refactorability enablers: FR-3, FR-4, FR-20, DQ-2),
  the #23 contract-frontmatter spec (SPEC-100 on `agent/issue-23`), SPEC-109 (canonical
  frontmatter schema), [SPEC-038](../SPEC-038-spec-code-ownership/requirements.md)
  (the `implements: none` precedent).
- **Decisions:** DR-123 (who closes Clarify on a T3 spec). No new DR.
