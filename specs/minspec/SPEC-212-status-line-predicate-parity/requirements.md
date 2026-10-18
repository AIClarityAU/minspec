---
id: SPEC-212
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - the docs-lane gate ships to every adopter via Refresh Harness Files
aspects: [docs-lane, governance, status-transition, validator-asymmetry, parity, no-silent-gate, harness, tier-0, offline]
depends_on: [DR-029, DR-086]  # DR-029: a DR is born proposed, acceptance is a human act; DR-086 §2: DR acceptance and T3/T4 spec approval always stop and ask
relates_to: ["#1940", "#1847", "#1858", "#2124", "#2078", "#2158", "#1875", "#1873", "#2149", "#1912"]
# Ownership declared in Specify (SPEC-038). This spec creates no new source file. Every
# change lands in files that already exist and are shared with other work, so it owns none.
implements: none
implements_reason: >-
  The gate, its two mirrors and the status readers are shared files that several specs and
  defect fixes edit. Owning them from one defect spec would freeze them for every other
  change.
affects: [.github/workflows/docs-lane.yml, packages/minspec/src/lib/governance-transition.ts, scripts/lib/governance-transition.sh, packages/minspec/src/lib/ci-review-templates.ts, packages/minspec/src/lib/adr-manager.ts, packages/minspec/src/lib/spec-validator.ts, packages/minspec/tests/governance-lane-eligibility.test.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-212: The docs-lane status gate refuses every status line a MinSpec reader honours

Source issue: #1940 (docs-lane governance gate narrower than MinSpec's own status readers).
Rests on DR-029 (DR acceptance is a human act) and DR-086 §2 (acceptance and T3/T4 spec
approval always stop and ask).

## In plain terms

The docs-lane workflow auto-merges docs-only pull requests. It refuses to do that when a
pull request changes a `status:` line under `docs/decisions/` or `specs/`, because
accepting a DR or approving a spec is a human act. It spots such a line with one regular
expression. MinSpec's own code reads a status line more loosely than that expression
does. So a status line written in a slightly odd format (`status : accepted`, a tab
before the colon, or an indented `status:` in a DR's frontmatter) counts as the record's
status, but the gate does not see it. The pull request can then auto-merge a DR
acceptance with no human keystroke.

The fix makes it a tested rule that **any status line a MinSpec reader honours is a line
the gate refuses**. It also stops the validator from accepting status formats nobody
needs. Then this can't drift again without a test going red.

## One-Sentence Scope

Make the docs-lane governance gate's status-line predicate at least as wide as every
MinSpec frontmatter status reader. Enforce that with a cross-reader parity test, and add
an independent validator witness that rejects non-canonical frontmatter status lines.

## Context - what the code does today (read from this worktree's base, `8feaf98a`, not inferred)

The issue was filed against an older `main`. Since then #2124 changed the predicate, so
the issue's quoted regex and line numbers are stale. The gap itself is still open.

**The gate.** `.github/workflows/docs-lane.yml:267`:
`grep -qE '^[+-]([*_>|-]+ ?)?[*_]*[Ss]tatus:'`. It allows markdown decoration and either
case before the word. It does **not** allow whitespace between `status` and `:`. It
**deliberately** does not allow leading whitespace (comment at `docs-lane.yml:202-208`):
an indented `status:` is treated as a TypeScript or YAML literal inside a fenced block.
The comment names two such files.

**Three pinned copies of that predicate.** The same string is in
`packages/minspec/src/lib/governance-transition.ts` (`STATUS_TRANSITION_PATTERN`, used by
the label producer `approval-pr.ts`) and in `scripts/lib/governance-transition.sh` (used
by `push-docs.sh`). `packages/minspec/tests/governance-lane-eligibility.test.ts` pins all
three character for character and runs the workflow's ERE through real `grep -E`. The
workflow body is also embedded verbatim in `packages/minspec/src/lib/ci-review-templates.ts`
(line 2144), which is how adopters receive it.

**The readers, and how wide each is:**

| Reader | Location | Whitespace before `:` | Leading indent | Duplicate key |
|---|---|---|---|---|
| Lifecycle strip for the approval hash | `packages/shared/src/canonical.ts:44` `/^status[ \t]*:/` | yes | no | strips all |
| DR list reader `parseFrontmatterYaml` | `packages/minspec/src/lib/adr-manager.ts:66-77` | yes (`\s*:`) | **yes: the line is trimmed first** | last one wins |
| Spec reader `parseFrontmatterYaml` | `packages/minspec/src/lib/spec.ts:144` | yes (`\s*:`) | no: 2+ spaces makes it a nested key, 1 space makes it unparsed | last one wins (unverified, inferred from the loop shape) |
| Status writers `setSpecStatus` / `setEpicStatus` / `setAdrStatus` | `spec.ts:606`, `epic-manager.ts:318`, `adr-manager.ts:821` `/^status[ \t]*:[ \t]*.*$/m` | yes | no (#2149) | rewrites the **first** |
| Amendment-gap scanner | `adr-manager.ts:292` `/^status:[ \t]*accepted\s*$/m` | **no** | no | n/a |
| Duplicate-block detector | `adr-manager.ts:487` `/^status[ \t]*:/m` | yes | no | n/a |
| Status annotation rule | `spec-validator.ts:933` `/^status[ \t]*:/` | yes | no | first |

### Root cause

No single rule says what "a line that sets a status" looks like. Six readers and a gate
each define it separately (the gate's three copies are pinned to each other). The
existing parity test pins the gate's copies **to each other**. Nothing pins the gate
**to the readers**. A gate narrower than the reader it protects is the
validator-asymmetry class: it checks the form it expects, not every form the system
accepts. The missing gate is a test that compares the gate with the readers.

### Measured

- Whitespace before the colon. `git grep -nE '^([*_>|-]+ ?)?[*_]*[Ss]tatus[ \t]+:' -- docs/decisions specs`
  gives **0 lines**. Widening the predicate to accept it refuses nothing in today's corpus.
- Indented status. The same search with a leading `[ \t]+` gives **3 lines**, all in
  bodies, none in frontmatter: SPEC-023 `requirements.md:235`, SPEC-065 `design.md:463`,
  SPEC-070 `requirements.md:705`. Matching leading whitespace everywhere would refuse a
  pull request that touches any of those lines.
- Duplicate column-0 `status:` keys inside one frontmatter block: **0 files** today.
- Escapes reported in #1940, from AIClarityAU/scroogellm#159 using a stubbed `gh`:
  (a) `+status : accepted` added below an unchanged `status: proposed`; (b) an indented
  `+  status: accepted`, or a tab before the colon; (c) a new DR born with
  `+status : accepted`. Against the **current** predicate, (a), (c) and the tab case still
  escape, because `[ \t]` before the colon isn't matched. (b) with an indent escapes by
  design. Only the DR reader honours it, because it trims the line.

How serious this is: exploiting it means formatting the line on purpose, being able to
apply the `docs-lane` label, and passing the required `ai-review`. MinSpec's writers
always emit the canonical `status: <value>`, so an honest acceptance is caught. This is a
defence-in-depth gap, not an open door. It still matters: the gate exists for the case
where nobody remembered to check (#1847).

## Functional Requirements

- **FR-1 - Colon whitespace is matched.** The status-transition predicate allows
  `[ \t]*` between the status word and the colon. The same character change goes into
  all three pinned copies: `docs-lane.yml`, `governance-transition.ts` and
  `governance-transition.sh`. The regenerated `ci-review-templates.ts` picks it up from
  the workflow and is never hand-edited.
- **FR-2 - Indented frontmatter status is caught, as decided in DQ-1.** A diff that adds
  or removes an indented `status:` line that a reader honours as frontmatter status must
  not arm auto-merge. DQ-1 decides how. An indented `status:` in a fenced block in a body
  must keep riding the lane, unless DQ-1 decides to accept that cost.
- **FR-3 - Reader/gate parity test (the missing gate).** A Tier-0 test builds one shared
  fixture set of status-line forms. It covers at least: canonical; space before the
  colon; tab before the colon; 1-, 2- and 4-space and tab indent; a duplicate key after
  an unchanged canonical one; a new file whose first status line is non-canonical;
  `Status:`; and the markdown-decorated prose forms #2124 already covers. For each form
  it records which of the readers in the table above treat that line as a frontmatter
  status. It then asserts that **if any reader honours the form, the gate refuses a diff
  that adds it and a diff that removes it**. The gate side runs the workflow's own ERE
  through real `grep -E`, extracted from `docs-lane.yml` the way
  `governance-lane-eligibility.test.ts` already does. Adding a reader with a new width
  without updating the fixture set makes the test fail, not silently pass.
- **FR-4 - Independent validator witness.** `npm run validate` flags a non-canonical
  frontmatter status line in a DR or spec as an **error**. It covers whitespace before
  the colon, a leading indent on a line that a reader takes as top-level `status`, and
  more than one top-level `status` key in one block. Constitution invariant 2 requires a
  second witness: the gate's grep is one producer, and a missed form there would
  otherwise pass silently. This makes the non-canonical form fail CI on its own, however
  the gate is configured.
- **FR-5 - Amendment-gap scanner reconciled on purpose.** The scanner at
  `adr-manager.ts:292` is stricter than the DR reader: a DR stored as `status : accepted`
  is listed as accepted but skipped by the scanner. This is settled by DQ-2, not by
  widening it as a side effect of FR-1.
- **FR-6 - The gate's comment block is updated with the change.** The
  `docs-lane.yml:186-236` comment and the `STATUS_TRANSITION_PATTERN` doc comment explain
  the new colon allowance and the DQ-1 outcome. They keep saying "THIS IS A FLOOR, NOT A
  CENSUS", and they cite the FR-3 test as the place that defines the width.
- **FR-7 - The refusal still fails closed.** Absent and undecodable patches keep being
  treated as transitions. A refusal still revokes any earlier arming (#1875). Nothing in
  the changed path writes a gate signal with `|| true`.

## Acceptance Criteria

- **AC-1** Each of these diffs under `docs/decisions/` causes the lane to refuse and
  `exit 1`: `+status : accepted`, `+status\t: accepted`, a `+status : accepted` added
  below an unchanged `status: proposed`, and a new file born with `+status : accepted`.
  Shown with the extracted `run:` script against a stubbed `gh`, the same method #1940
  used.
- **AC-2** A diff adding `+  status: accepted` inside a DR's frontmatter is refused, or
  under DQ-1 option (c) fails `npm run validate`. Either way, it can't reach `main` with
  no human keystroke.
- **AC-3** A diff that edits SPEC-023 `requirements.md:235` (an indented TypeScript
  `status:` literal in a fenced block) behaves as DQ-1 decides, and the test pins that
  behaviour.
- **AC-4** `governance-lane-eligibility.test.ts` still passes with all three copies
  identical. The FR-3 parity test fails if any one of the following is reverted alone:
  the colon change in any copy, the DQ-1 indent handling, or a reader widened without a
  fixture.
- **AC-5** `npm run validate` gives an error on a fixture spec or DR whose frontmatter
  has `status : planning`, an indented `status:` the DR reader would honour, or two
  `status:` keys. It gives no new finding on the current corpus. That is measured: 0
  matching lines today, see Measured.
- **AC-6** The FR-3 test is shown to fail against an unpatched copy before the fix lands
  (red, then green). This proves it isn't passing vacuously.

## Invariants (must not break)

- **INV-1 - Constitution 1, offline.** The validator and the parity test are Tier-0: no
  network. Only the workflow calls `gh`, as it already does.
- **INV-2 - Constitution 2, no silent gate.** A widened predicate never fails open. Every
  error path in the changed workflow block refuses. FR-4 is the second, independent
  witness.
- **INV-3 - Constitution 3, blast radius.** The changed workflow reaches adopters only
  through Refresh Harness Files, in repos that already have `.minspec/`. The validator
  rule acts only inside a MinSpec project.
- **INV-4 - A typo fix still rides the lane.** An edit to a DR or spec body that changes
  no status line still auto-merges. The gate stays line-scoped, not file-scoped (#1754).
- **INV-5 - Mirrors stay identical.** The three predicate copies remain character for
  character the same (#2078, #2158).

## Decisions needed (Clarify)

### DQ-1 - How is an indented frontmatter `status:` caught?

Only the DR reader honours it, because it trims each line. A diff line carries no
information about whether it sits in frontmatter or in a fenced block.

- **(a) Match leading whitespace everywhere in the gate.** Simple. Cost: a pull request
  touching any of the 3 indented body lines measured above, or any future fenced example,
  loses the lane and needs a human merge. #2124 rejected exactly this.
- **(b) Scope by frontmatter in the gate.** Fetch the head (and base) blob of each
  governance file, find the closing `---`, and refuse an indented status line only when
  its line number in the hunk falls inside that range. Cost: one more API call per
  governance file. A second fetch must also fail closed. And this is the most code in a
  machinery workflow that only a human `--admin` can merge.
- **(c) (rec) Narrow the reader, not the gate.** Make `adr-manager.ts`'s
  `parseFrontmatterYaml` stop trimming leading indent for top-level keys, like the spec
  reader and every writer, so an indented `status:` is no longer a DR's status. Then the
  FR-4 validator turns an indented key into an error. The gate keeps excluding
  indentation, and the parity test proves no reader honours that form. Cost: a DR that
  relies on an indented frontmatter key today would lose that key silently, unless the
  FR-4 error lands in the same change. The corpus has 0 such lines, measured, but
  adopter repos are unmeasured.

### DQ-2 - Is the amendment-gap scanner reconciled?

- **(a) (rec) Leave it strict and depend on FR-4.** Once non-canonical status lines are
  validation errors, a strict scanner misses nothing in a valid corpus. Cost: the scanner
  stays one more definition of the status line, kept honest only by FR-4 and the FR-3
  fixture set, which must include it.
- **(b) Widen it to `^status[ \t]*:[ \t]*accepted`.** Cost: one more widening to keep in
  sync, and it changes amendment-gap findings for adopters who hand-format status lines.

### DQ-3 - Duplicate status keys: an error, or fixed by a writer?

The writers rewrite the **first** `status:`. The DR reader reads the **last**. A file
with two status keys therefore says one thing to the writer and another to the reader.

- **(a) (rec) A validator error (part of FR-4).** Cost: a hand-edit that leaves a
  duplicate behind now fails validate instead of quietly working.
- **(b) Make every reader take the first key as well.** Cost: it changes reader behaviour
  in a shared parser, and the gate still has to refuse the added line under FR-1 anyway.

## Why no new DR

No choice here takes more than a day to undo. A predicate widening, a validator rule and
a test can each be reverted in one commit. DQ-1 option (b) would be the exception only if
it brought in a new fetch-and-parse pattern for workflows, and if chosen it gets a DR in
Plan.

## Out of Scope

- The two disposition forms no line-based predicate can see: a `## Status` section body,
  and an amendment disposition that is only in a heading. Tracked on #2124.
- Fetching the file list once (#1873), and revoke-on-refusal mechanics (#1875). Both are
  separate items.
- Porting the change to AIClarityAU/scroogellm#159. That repo picks it up through Refresh
  Harness Files once this ships.

## Alternatives considered and rejected

- **Widen only the gate to the issue's proposed `^[+-][[:space:]]*status[[:space:]]*:`.**
  Rejected for three reasons. It would drop #2124's markdown-decoration and case
  coverage. It brings back the fenced-literal false refusals that #2124 measured and
  excluded. And it leaves the readers free to drift apart again, because nothing compares
  them with the gate. FR-1 takes the safe half of it, the colon whitespace.
- **One literal predicate shared by bash and TypeScript.** Not available. No artefact
  both can execute (see the `governance-transition.ts` header). The pinned mirrors plus
  FR-3 are the substitute.

## Test plan (for the Plan phase to place)

- Extend `governance-lane-eligibility.test.ts` with the FR-3 fixture set, or put it next
  to that file.
- Add validator unit fixtures for FR-4 / AC-5.
- Replay the stubbed-`gh` `run:` extraction for AC-1.
- Mutation-check AC-4: revert each copy one at a time and confirm the test goes red.

## Traceability

- Issue: #1940. Parent gate: #1847 / #1858. Predicate history: #2124. Mirrors: #2078,
  #2158. Writer anchoring: #2149.
- Machinery change: `docs-lane.yml` is a workflow, so the implementing pull request needs
  a human `--admin` merge.
