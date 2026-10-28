---
id: SPEC-266
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - a shipped gate that reads a valid spec as "nothing to check" blocks nothing where adopters commit
aspects: [validator, managed-region, parity, silent-gate, adopter, tier-0, frontmatter]
relates_to: [SPEC-038, SPEC-081, SPEC-247, DR-077, "#2914", "#2261", "#2262", "#1543", "#2371", "#2630"]
# Ownership is not claimed in Specify. The Python port lives in template-registry.ts
# (VALIDATE_PY), a shared file other specs list under affects:. Declared at Plan.
implements: none
implements_reason: >-
  The Python ownership port sits in packages/minspec/src/lib/template-registry.ts, a shared
  file other specs already list under affects:, and the TypeScript twin question is DQ-1.
  Ownership is declared at Plan, once Clarify settles the scope.
affects: [packages/minspec/src/lib/template-registry.ts, packages/minspec/src/lib/ownership-path-rules.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-266: The shipped ownership check never reads a valid spec as "nothing to check"

**Status:** specifying

## In plain terms

SPEC-038's ownership rule says a T3/T4 spec past Clarify must name the code it owns, and
that no path may climb out of the repo. MinSpec ships that rule to adopters inside
`.minspec/hooks/validate.py`. The script reads spec frontmatter with a small hand-written
parser. That parser assumes things about spacing and quoting that YAML does not promise.
Eight valid-but-unusual shapes make it misread a spec. Five of them make a violation pass
silently (the escape rule is meant to fail every time); three refuse a correct spec or
accept a bad path.

This spec does two things. First, the parser **fails closed**: a shape it cannot read with
certainty is reported as "unparseable ownership frontmatter", never read as empty. Second,
the parser is widened so the eight shapes read correctly. The eight adopter cases are ported
into the shipped suite so every adopter carries the evidence.

**Recommended:** both steps, with fail-closed first. **Cost:** a spec the parser now flags
as unparseable turns an adopter's CI red until the frontmatter is rewritten; widening
shrinks that set but never to zero. **Riskiest assumption:** that "cannot read with
certainty" can be defined narrowly enough to avoid flagging the canonical shapes MinSpec
itself writes (FR-1 and AC-6 bound this).

> **SPECIFICATION ONLY.** The dispatch that wrote this created no code, script, workflow or
> test. A human reads it, settles the questions under
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before anything is built.

Materializes **[#2914](https://github.com/AIClarityAU/minspec/issues/2914)** - *"shipped
validate.py ownership check fails open on five YAML-valid frontmatter shapes"*, found by
adopter tests in AIClarityAU/memory-fabric#40 (strict `xfail` cases in
`tests/test_validate_ownership.py`). No DR is minted: the choices are parser behaviour,
reversible in under a day. Same class as #2371 (adopter evidence shipped with the port).

## One-Sentence Scope

Make the Python ownership port in `validate.py` report any frontmatter shape it cannot read
with certainty as an error instead of reading it as empty, widen its parser so the eight
reported shapes read as YAML does, and ship the eight cases in the repo's suite.

## Context - what the code does today (read at `bd2d754f`, not inferred)

All line refs are inside the `VALIDATE_PY` string in
`packages/minspec/src/lib/template-registry.ts`.

| # | Defect | Mechanism (function, ~line) | Effect |
|---|---|---|---|
| 1 | `type:` not comment-stripped | `ownership_violations` (~2093) strips `tier`/`plan` but lowercases raw `type` | `type: requirements  # primary` is not in `("", "requirements")`, rule returns `[]` |
| 2 | `tier: "T3"  # note` | `strip_inline_comment` (1963) tests surrounding quotes before stripping the comment | the quote test fails (last char is `e`), so the comment is stripped but the quotes stay: returns `"T3"`, not in `TIERS`, falls back to T2, rule disarmed |
| 3 | `..\..\x.py` | `owned_path` (2052) returns None when no `/` before backslash normalisation | not escaping, not owned; passes the always-FAIL escape rule |
| 4 | column-0 `- item` | `frontmatter_list` item regex (~2036) requires `[ \t]+-` | `affects:` list reads empty; escaping path passes |
| 5 | one-space `phases:` child | `parse_frontmatter_yaml` (1972) nests only `\s{2,}` lines | plan reads pending, rule disarmed |
| 6 | comment on `implements:` key line | `raw_frontmatter_field` (2006) reads the comment as the inline value | list never read; reported MISSING |
| 7 | column-0 `implements:` sequence | same as 4 | reported MISSING |
| 8 | `C:/x/a.py` | `escapes_repo` (2064) treats only a leading `/` as absolute | counts as valid repo-relative owned path |

Cases 1-5 fail open; 6-8 are wrong-but-visible (6, 7 refuse a correct spec; 8 accepts a bad
path). Root cause: the port hand-parses a YAML subset on whitespace and quoting assumptions
YAML does not make, and the parity tests exercise only the canonical shapes MinSpec writes.
The missing gate: nothing distinguishes "the parser read this as empty" from "the field is
genuinely empty", so every misread degrades to the quiet branch.

**TypeScript twin (checked, not assumed).** `ownership-path-rules.ts` has the same
slash-before-normalise order for cases 3 (lines 47, 72) and no drive-letter test (case 8).
Whether the TS frontmatter reader shares cases 1, 2, 4-7 is not yet read; see DQ-1.

## Functional Requirements

- **FR-1 (fail closed).** When the ownership check runs on a spec file, it MUST emit an
  `error`-severity violation `ownership.frontmatter.unparseable` (one message naming the
  field and line) if any of `type`, `tier`, `phases.plan`, `implements`, `affects` is
  present in a shape the parser cannot classify with certainty. "Certainty" is defined by an
  explicit list of recognised shapes (FR-2 to FR-6), not by the absence of a match. A field
  that is absent, or present and empty in a recognised shape, is NOT unparseable.
- **FR-2 (scalar comments).** `type`, `tier`, `phases.plan` and `implements_reason` strip a
  trailing ` # comment` before comparison. A quoted scalar is unquoted and its comment
  stripped in either order: `"T3"  # note` reads `T3`. A `#` inside quotes is content.
- **FR-3 (path normalisation).** Backslashes become `/` BEFORE the "names a path" test, so
  `..\..\x.py` is an escaping path.
- **FR-4 (absolute forms).** A drive-letter path (`C:/x/a.py`, `C:\x\a.py`) and a UNC-style
  leading `//` are absolute, so they escape the repo and are never a valid owned path.
- **FR-5 (block sequences).** A block sequence item at column 0 (`- item`) or indented any
  amount reads as a list item of the preceding key. A comment on the key line
  (`implements:  # owned code`) does not make the value inline.
- **FR-6 (nested keys).** A child of `phases:` indented by one or more spaces or a tab reads
  as nested. A mix of indent widths inside one block is unparseable (FR-1), not guessed.
- **FR-7 (severity unchanged).** Existing severities hold: escape rule always `error`;
  missing-`implements` follows `ownershipDeclaration`. `ownership.frontmatter.unparseable`
  is always `error` (never downgraded by `warn`), because a skipped check is a silent gate.
- **FR-8 (evidence ships).** The eight cases, each with its expected verdict, are in the
  repo's own suite and exercised against the generated `validate.py`, not a copy of it.
- **FR-9 (parity guard).** Every frontmatter shape in the eight-case fixture also runs
  through the TypeScript validator, and the expected verdicts agree, OR the divergence is
  recorded as a dev-only difference with a reason (DQ-1 settles which).

## Acceptance Criteria

- **AC-1.** For each of cases 1-5, the fixture spec yields a violation (escape/missing/
  unparseable as the case dictates) instead of `[]`. Each test fails on `bd2d754f` and passes
  after the change.
- **AC-2.** For cases 6 and 7, a correct spec yields no `ownership.implements.missing`.
- **AC-3.** For case 8, `C:/x/a.py` in `implements:` yields no valid owned path and in
  `affects:` yields `ownership.implements.invalid`.
- **AC-4.** A frontmatter value in a shape outside FR-2 to FR-6 (for example a flow mapping
  for `phases`, or a multi-line folded `tier`) yields `ownership.frontmatter.unparseable`,
  exit non-zero, and the message names the field.
- **AC-5.** Fail-closed is checked by mutation: replacing the unparseable branch with an
  empty-read makes at least one test fail.
- **AC-6.** Every spec under `specs/` in this repo, and the scaffold templates MinSpec
  writes, produce zero `ownership.frontmatter.unparseable`. A widened parser that flags the
  canonical shapes fails this.
- **AC-7.** The pre-commit and full-scan modes both surface the new violation; neither
  swallows it (invariant 2).

## Invariants (must not break)

1. **No silent gate** (constitution invariant 2). A shape the parser cannot read is an
   error, never a quiet pass; the new check is not wrapped in a swallowed exception.
2. **Offline** (invariant 1). Pure text parsing; no new dependency, no network.
3. **Blast radius** (invariant 3). Changes ship only through the managed region of repos
   that opted in via `.minspec/`; no change to repos without it.
4. **Canonical shapes keep their verdicts.** Every spec shape MinSpec writes reads exactly
   as before (AC-6).
5. **One rule, two implementations, bound by behavioural parity** (DR-077). The Python port
   stays a port of SPEC-038, not a new rule set.
6. **Escape rule stays always-error** (SPEC-038), independent of `ownershipDeclaration`.

## Decisions needed (Clarify)

- **DQ-1: do the TypeScript validators get the same fix?**
  - **(rec) Fix both**, with one shared fixture proving agreement (FR-9). **Cost:** touches
    `ownership-path-rules.ts` and the TS frontmatter reader, widening the change and
    possibly turning currently-green MinSpec specs red.
  - Python only; record TS as a follow-up issue. **Cost:** the two validators disagree on
    the same input, which DR-077 exists to prevent, and the Node gate keeps failing open on
    case 3 and 8 here.
- **DQ-2: how to treat an unreadable shape.**
  - **(rec) Error always** (FR-7). **Cost:** an adopter with an exotic but valid shape is
    blocked until they rewrite it.
  - Follow `ownershipDeclaration` (warn by default). **Cost:** the unparseable case then
    disarms the escape rule on default config, which is the defect.
- **DQ-3: parser strategy.**
  - **(rec) Keep the hand parser, add the recognised-shape list** (FR-1). **Cost:** a
    growing list of shapes to maintain; each new valid shape is a bug until added.
  - Vendor a real YAML parser into `validate.py`. **Cost:** adopters' Python gains a
    dependency or a bundled file (breaks the zero-dependency script; needs a DR).
- **DQ-4: rollout to existing adopters.** Refresh re-ships `validate.py`; adopters with
  specs the new check flags go red. Options: **(rec)** ship as-is, since a fail-open gate is
  worse than a red one; **cost:** surprise red on refresh. Or ship `warn` for one release;
  **cost:** one release still fails open.

## Risks & Mitigations

- Over-flagging canonical specs: AC-6 scans the corpus and scaffold templates.
- Parser widening re-introduces a different misread: each shape gets a fixture (FR-8) and
  the mutation check (AC-5).
- Fixtures pass against a copy, not the shipped script: FR-8 requires the generated file.

## Out of scope

- The other FATAL-rule gap between Node and Python (SPEC-247, #2261).
- Validator crash skipping the ownership check (#2262).
- Rule never arming on existing specs (#1543).
- Replacing the frontmatter reader wholesale.

## Follow-ups (tracked)

- Cross-validator parity for the remaining frontmatter fields: SPEC-247.
- TS-side fix if DQ-1 resolves to Python-only: file at Clarify.
- memory-fabric `xfail(strict=True)` markers come off after the port ships: adopter-side,
  AIClarityAU/memory-fabric#40.
