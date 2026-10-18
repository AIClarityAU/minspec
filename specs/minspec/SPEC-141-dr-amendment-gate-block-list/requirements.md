---
id: SPEC-141
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - the amendment gate is a methodology check; this closes a silent miss in it
aspects: [adr, frontmatter, validator, no-silent-gate, parser]
depends_on: [DR-003]  # RCDD: root cause = mechanism + missing gate
relates_to: ["#1448", "#1145", DR-044, DR-049, DR-081]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). Modified, not
# owned: no new files; the change lands in the existing parser and its existing test file.
affects: [packages/minspec/src/lib/adr-manager.ts, packages/minspec/tests/dr-amendments.test.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-141: The DR amendment gate sees block-list frontmatter claims

Issue: #1448. Builds on the #1145 amendment gate (`validateDrAmendments`). No DR yet; none
needed unless the Clarify answer below picks the option that adds a new FATAL.

## In plain terms

A decision record can say it amends another one in its frontmatter. Two spellings are
already understood: `supersedes_partial: [DR-076, DR-047]` and `supersedes: DR-015`. The
third legal YAML spelling, a list written one item per line under the key, is not seen at
all, so the gate reports "clean" for a claim it never read. This spec makes the gate read it.

## Root cause (mechanism, not state)

`parseFrontmatterYaml` (`packages/minspec/src/lib/adr-manager.ts:70-80`) is line-oriented and
matches `^(\w[\w-]*)\s*:\s*(.+)$`. The `(.+)` needs content on the same line as the colon, so
`supersedes_partial:` followed by newline never produces a key, and the `  - DR-076`
continuation lines match no key pattern and are dropped. The consumer
(`validateDrAmendments`, `adr-manager.ts:~355-362`) reads `fields[key]` and cannot see what
the parser never produced. The missing gate: the "KNOWN LIMIT" test in
`packages/minspec/tests/dr-amendments.test.ts` pins the silence, but nothing fails when a
real DR is written this way, a FATAL gate that fails open on a legal input (constitution
invariant 2, no silent gate).

Call sites of `parseFrontmatterYaml` (surveyed on this branch, 3 of them):

| Site | Reads | Effect of a block-list change |
|---|---|---|
| `adr-manager.ts:~357` amendment gate | `supersedes`, `supersedes_partial` | the fix target |
| `adr-manager.ts:~1262` drift scan | `status` only | none unless `status:` were a block list (not a legal status) |
| `adr-manager.ts:~1424` `listAdrs` | `id`, `title`, `status`, `date`, `epic` | only if one of these is a block list; `epic` is the one plausible case |

Line numbers are from reading the file during Specify and will drift; the plan re-greps.

## Functional requirements

- **FR-1.** A frontmatter key whose value is a block list (key with nothing after the colon,
  followed by indented `- item` lines) yields a value, instead of being dropped.
- **FR-2.** `validateDrAmendments` records an amendment claim for every `DR-NNN` item of a
  `supersedes:` or `supersedes_partial:` block list, with the same per-item rules as the
  inline form: first id per item, case-normalised, trailing `# comment` ignored, an item
  naming no DR dropped.
- **FR-3.** The block-list and inline-flow forms of the same list produce identical claims
  (property: for any list of ids, both spellings yield the same set).
- **FR-4.** The block list ends at the first line that is not an item of it (a new key, a
  dedented line, or the closing `---`). A blank line or `#` comment line inside the list does
  not end it.
- **FR-5.** Keys that already parse (inline, bare scalar, quoted) return byte-identical
  values to today. Every existing parser and amendment test stays green unmodified.
- **FR-6.** Both block-list indentations are accepted: `  - DR-1` and `- DR-1` flush with the
  key (both are legal YAML).
- **FR-7.** The "KNOWN LIMIT" test is replaced by positive tests for FR-1..FR-6; the stale
  comment in `validateDrAmendments` and its doc that describe the limit are removed
  (sweep with grep for "block-list" / "KNOWN LIMIT").

## Acceptance criteria

- **AC-1.** A fixture DR with `supersedes_partial:` then `  - DR-076` / `  - DR-047`, accepted,
  whose targets do not mention it, yields two gaps. Written red against base first.
- **AC-2.** The same fixture in inline form yields the identical two gaps.
- **AC-3.** A block list followed by another key (`status: accepted`) does not swallow that key.
- **AC-4.** A block-list item with a trailing `# superseded by DR-099` note yields only the
  item's own id, never DR-099.
- **AC-5.** A DR with a block-list `epic:` still lists with a defined `epic` (survey result
  pinned by a test, whichever way Clarify decides).
- **AC-6.** `npm test`, `npm run validate`, `npm run lint` pass; corpus gap count is unchanged
  (zero DRs use the block form today, so no new FATAL appears on `docs/decisions/`).

## Invariants this must not break

- Invariant 1: pure string parsing, offline.
- Invariant 2: the fix removes a fail-open; it must not add a swallowed error. A malformed
  block list must be reported or parsed, never silently ignored.
- Existing `status`, `id`, `title`, `date` readers behave as today for every file in the corpus.
- No new dependency (no YAML library; the file's "lightweight, no dependency" contract holds).

## Decisions needed (Clarify)

The issue offers three options. All three are real; the first is the issue's recommendation.

1. **(rec) Teach `parseFrontmatterYaml` block lists, returning an inline-flow string.**
   A block list is joined to `[DR-076, DR-047]`, so `parseAmendmentTargets` and the
   `Record<string, string>` return type are unchanged. The survey above shows the two other
   callers read scalar keys only, so the ripple is confined to a key that was previously
   absent now being present. Cost: one shared function changes, and a block-list item
   containing a comma or `]` would be mis-split by the downstream inline reader; an
   array-returning shape avoids that but ripples the return type through all three callers.
2. **Narrow block-list scanner used only by the amendment gate.** Smallest blast radius.
   Cost: two parsers for one format, the divergence that produced this bug class.
3. **Reject block lists at validation, require inline form.** Cheapest to build. Cost: a new
   FATAL on legal YAML, and it is a policy change that would need a DR.

Sub-question under option 1: join to a string (rec, no type change) or return `string[]`
(correct for commas, touches all callers)?

## Out of scope

Nested lists, multi-line scalars (`|`, `>`), anchors, and other YAML features; any change to
which keys the gate reads.
