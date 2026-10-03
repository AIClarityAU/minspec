---
id: SPEC-110
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - root-cause-before-fix is methodology the product ships to adopters, the same epic DR-003 (root-cause-driven debugging) sits in
aspects: [rcdd, root-cause, commit-msg-hook, harness-template, gate-asymmetry, refresh-merge, tier-0, offline, blast-radius]
relates_to: [DR-003, DR-037, DR-023, DR-074, SPEC-043, SPEC-058, SPEC-025, "#106", "#1557", "#247"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 ownership-before-approval).
# The one NEW file is the behavioural test FR-9 requires; it holds under every DQ answer below.
implements: [packages/minspec/tests/root-cause-gate-value.test.ts]
# Modified, not owned. template-registry.ts carries no single `implements:` owner (grepped
# across specs/ for `implements:.*template-registry` - no hit). `.minspec/hooks/commit-msg`
# is this repo's own scaffolded copy of the shipped hook. `.githooks/commit-msg` is this
# repo's own gate (FR-8). dr037-hook-scaffolds.test.ts pins the hook's current text.
affects: [packages/minspec/src/lib/template-registry.ts, .minspec/hooks/commit-msg, .githooks/commit-msg, packages/minspec/tests/dr037-hook-scaffolds.test.ts, packages/minspec/CHANGELOG.md, docs/decisions/DR-003.md]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-110: Finish shipping "root cause is a mechanism, not a restated symptom" to adopter projects

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers the questions under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the
> normal spec-approval gate before any code changes. Every requirement below is written
> under each decision's recommended option, so approving the spec as it stands accepts
> those recommendations. Choosing a different option changes only the requirements that
> decision names.

Materializes **[#106](https://github.com/AIClarityAU/minspec/issues/106)** - *"ship RCDD
'mechanism-not-state' refinement as a product constitution/harness template."* The
discipline itself is decided in [DR-003](../../../docs/decisions/DR-003.md) (root-cause-driven
debugging), in its 2026-06-01 addendum (`docs/decisions/DR-003.md:105-121`): a root cause
names the mechanism that produced the bad state and the check that should have rejected
it; a fix that only edits data means the check is still missing; and a repaired check must
be inspected for one-sidedness (it validates values that exist but never asserts one
should exist).

**Id note.** `SPEC-109` is the highest id found across `origin/main`, all 273 remote
refs in this worktree's `.git` as last fetched, every local branch and every local
worktree, checked 2026-10-03 with no network. Ids `SPEC-097` and `SPEC-092` are each
already claimed by several in-flight branches, so collisions are live. This is therefore
`SPEC-110`. If it collides at review time, renumber.

**Tier note.** T3 (full spec cycle). The change is small in files (one source file, two
hook files, two test files, a changelog line, one DR line) but it changes what a git hook
refuses in every adopter repository that refreshes, which is a cross-boundary behaviour
change. The predicted tier is a floor.

## One-Sentence Scope

Close the gap between what DR-003's addendum decided and what MinSpec actually ships to
adopters: make the scaffolded `commit-msg` hook refuse a `Root cause:` line that says
nothing, make its refusal teach the mechanism-and-missing-check shape without citing
MinSpec's own decision records, state the one-sided-check question in the shipped
`CLAUDE.md` section, and give `AGENTS.md` and `.cursorrules` the rule they currently lack.

## Context - what ships today (read from `main` at 350c6fa4, not inferred)

### The issue's premise is partly out of date

The issue was filed when the product shipped no root-cause guidance at all. Two later
changes shipped most of it. What follows is read from the code, so the spec covers only
what is still missing.

| Part of DR-003's addendum | Shipped to adopters? | Where |
|---|---|---|
| A `fix:` commit must carry a `Root cause:` line | **Yes**, since 2026-06-27 (commit `8d471a19`, pull request #319 for issue #247) | `COMMIT_MSG_HOOK`, `packages/minspec/src/lib/template-registry.ts:1591`, check at `:1657-1672`; scaffolded to `.minspec/hooks/commit-msg` (`:2653-2660`) |
| The line must name a mechanism, not restate the symptom | **Prose only**, in `CLAUDE.md`, since 2026-08-15 (commit `bbd9c57f`, pull request #1562 for issue #1557) | `### Root-cause gate`, `template-registry.ts:566-575` |
| A data-only fix means the check is still missing | **Prose only**, same section | `template-registry.ts:577-581` |
| Inspect the repaired check for one-sidedness | **Half a sentence.** "a check is missing or one-sided" appears; the question to ask of a check does not | `template-registry.ts:578-579` |
| Any of the above in `AGENTS.md` or `.cursorrules` | **No.** Neither template contains "root cause", "diagnos" or "symptom" | `AGENTS_MD_TEMPLATE` `:607-690`, `CURSORRULES_TEMPLATE` `:692-769` (case-insensitive search of the file; the only hits are in the `CLAUDE.md` template and the hook) |
| Any of the above in the constitution template | **No** | `CONSTITUTION_MD_TEMPLATE` `:771-824` |

### What the shipped hook accepts today (measured)

The scaffolded hook at `.minspec/hooks/commit-msg` was run against six commit messages on
2026-10-03. Exit 1 is a refusal.

| Commit body under a `fix:` subject | Exit | Reading |
|---|---|---|
| no `Root cause:` line (control) | 1 | the gate fires |
| `Root cause:` with nothing after it | **0** | an empty diagnosis passes |
| `Root cause: <one sentence>` | **0** | the placeholder printed by the hook's own refusal passes when pasted back |
| `Root cause: n/a.` | **0** | a non-answer passes |
| `Root cause: the field was missing.` | 0 | a restated symptom passes |
| `No root cause: found yet` | 0 | the token is matched anywhere on a line |

The check is one `grep -Eiq 'root[ -]cause:'` (`template-registry.ts:1661`). It asserts
the token exists and never that anything follows it. That is the one-sided check
DR-003's addendum describes, sitting inside the gate that enforces DR-003. The fifth row
cannot be fixed by a pattern: whether a sentence names a mechanism is a judgement, and
this spec does not pretend otherwise (see FR-3 and DQ-1).

### What the shipped refusal tells the author

```
✗ MinSpec RCDD gate (DR-003): fix commit missing root cause.
      Root cause: <one sentence>
  RCDD Phase 2 (diagnose) precedes Phase 3 (fix).
```

(`template-registry.ts:1665-1672`, abridged.) Three defects, all in text an adopter sees
at the moment of refusal:

1. **It teaches the shape the addendum replaced.** "one sentence" is the pre-addendum
   wording that admitted the symptom-as-cause commit which triggered the addendum
   (`docs/decisions/DR-003.md:99-103`).
2. **It cites `DR-003`.** In an adopter's repository that id means the adopter's own third
   decision record, or nothing. Ids are local to a repository (`CLAUDE.md`, "Cross-project
   & paragraph references"). The pointer resolves to the wrong document.
3. **It uses "RCDD" and "Phase 2 / Phase 3".** Neither is defined in any file MinSpec
   scaffolds: the only occurrences of "RCDD" in `template-registry.ts` are in this hook and
   in source comments. The four phases exist only in this repository's `DR-003`.

The pull request that shipped the prose stripped "local DR/issue numbers and file paths"
from the five `CLAUDE.md` sections for exactly this reason (commit `bbd9c57f` message).
The hook text was not part of that pass.

### How these files are refreshed (existing mechanisms, unchanged by this spec)

- **The hook** is a managed-region file. *MinSpec: Refresh Harness Files* replaces the
  text between the markers and leaves everything outside them alone; a file whose markers
  were deleted is skipped with a warning, never overwritten
  (`template-registry.ts:895-903`, `:2653-2660`).
- **`CLAUDE.md`, `AGENTS.md`, `.cursorrules`** go through the section-level merge
  (`TEMPLATE_NAMES`, `template-registry.ts:62-68`; `mergeFile` called at
  `packages/minspec/src/lib/scaffold.ts:1696`). Sections are split on `## ` headings only
  (`packages/minspec/src/lib/merge-refresh.ts:219-235`). A section the adopter edited is
  kept; an unedited one is regenerated (`merge-refresh.ts:4-16`).
- **Consequence.** `### Root-cause gate` is a sub-heading of `## Pre-Commit Checks`, so it
  travels with that whole section. An adopter who edited anything under `## Pre-Commit
  Checks` keeps their version and does not receive new wording. The hook's refusal text
  has no such gap, which is why FR-4 puts the teaching there first.

The issue asked for "refresh-merge semantics so `minspec init --refresh` preserves user
edits". Those semantics exist (SPEC-043 harness refresh manifest consistency, SPEC-058
harness refresh merge path). There is no `minspec` shell command; the entry point is the
palette command above. This spec adds no merge machinery.

### What it costs to add prose

Shipping the five sections took the rendered `CLAUDE.md` from 4,635 to 26,744 characters,
about 5,500 more tokens in every session of every adopter (commit `bbd9c57f` message,
"MEASURED COST"). The root-cause section is 953 characters today
(`template-registry.ts:566-581`). FR-5 and FR-6 therefore carry character budgets.

## Functional Requirements

Written under the recommended option of each decision below.

### The hook checks that the line says something

**FR-1 - Empty value refused.** On a `fix:` subject, the scaffolded `commit-msg` hook
refuses when every `Root cause:` line in the message has no value. The *value* of a line
is the text after the first `root cause:` or `root-cause:` match on that line
(case-insensitive), with surrounding whitespace and the Markdown emphasis characters `*`,
`_` and `` ` `` removed from both ends. If that is empty, the value is the next line of the
message, provided that line is not blank, trimmed the same way. A message passes when at
least one such line has a value that FR-1, FR-2 and FR-3 all accept.

The next-line rule exists so the wrapped style stays legal:

```
Root cause:
  nothing set the field on create, and the validator only checks references that exist.
```

**FR-2 - Unfilled placeholder refused.** A value that begins with `<` and ends with `>`
is refused. That covers the placeholder the hook prints today (`<one sentence>`) and the
one FR-4 introduces.

**FR-3 - Closed set of non-answers refused** *(DQ-1, Option B)*. A value is refused when,
lower-cased and with trailing `.`, `!` and whitespace removed, it is exactly one of:
`n/a`, `na`, `none`, `unknown`, `tbd`, `todo`, `?`, `-`. The match is on the whole value,
never a substring, so "none of the callers set the flag, and no test covered the unset
case" passes. The set is closed and listed in one place in the hook.

**What FR-1 to FR-3 do not do, stated so nobody reads the gate as stronger than it is:**
they do not judge whether the sentence names a mechanism. `Root cause: the field was
missing.` still passes, and so does `No root cause: found yet`. The hook's own header
comment and the `CLAUDE.md` section (FR-5) must each say this in one sentence. A gate that
is described as checking for a mechanism while only checking for non-emptiness would be a
false signpost.

**FR-4 - The refusal teaches the shape and stands alone.** Every refusal the root-cause
gate prints (missing line, empty value, placeholder, non-answer):

- a. names which of those four conditions fired, in plain words;
- b. shows the line to add with a placeholder for both halves, in this form:
  `Root cause: <what produced the bad state> - <which check should have caught it>`;
- c. gives one contrasting pair, a restated symptom and a cause, no longer than the pair
  in the shipped `CLAUDE.md` section (`template-registry.ts:572-574`);
- d. states the data-only corollary in one line: if the fix only edits data or
  configuration, the check that let the bad state through is still missing;
- e. says what to do when the cause is genuinely unknown: keep diagnosing, or commit under
  a subject that is not `fix:`;
- f. keeps the existing bypass line (`MINSPEC_GATE_OFF=1 git commit ...`);
- g. contains no decision-record id, no issue number, no "RCDD" and no phase number. It
  may point at "the Root-cause gate section of CLAUDE.md" by heading name, worded so it is
  still true in a project that has no `CLAUDE.md`;
- h. is at most 16 lines, so it fits a terminal without scrolling.

Only the refusal *output* is in scope for (g). Source comments inside the hook that cite
MinSpec's decision records, and the follow-up gate's refusal, are listed under
[Out of Scope](#out-of-scope).

### The shipped prose

**FR-5 - `CLAUDE.md`: the one-sided-check question, and an honest statement of the gate.**
The `### Root-cause gate` section of the `CLAUDE.md` template gains:

- a. the question to ask of the check that is added or repaired: does it only validate
  values that are present, and never assert that one should be present? With one generic
  example that names no MinSpec file, issue or decision record;
- b. one sentence stating what the hook now refuses (empty, placeholder, the non-answer
  set) and one stating what it cannot (whether the sentence names a mechanism);
- c. no new `## ` heading, so the section keys the refresh merge uses do not change
  (`merge-refresh.ts:219-235`).

Budget: the rendered `CLAUDE.md` grows by no more than 600 characters.

**FR-6 - `AGENTS.md` and `.cursorrules` get the rule** *(DQ-2, Option A)*. Each template
gains the rule under a heading it already has (`## Rules` in `AGENTS.md`,
`template-registry.ts:685`; `## Before Making Changes` in `.cursorrules`, `:722`), never
a new `## ` heading. Content: before a fix, write the cause as a mechanism plus the check
that should have caught it; a restated symptom is not a cause; a data-only fix means the
check is still missing. No decision-record id, issue number or "RCDD". Budget: 450
characters per file.

**FR-7 - The constitution template is not changed** *(DQ-3, Option A)*.
`CONSTITUTION_MD_TEMPLATE` and the constitution proposer are untouched.
`.minspec/constitution.md` stays the adopter's own statement of their invariants.

### This repository's own gate

**FR-8 - `.githooks/commit-msg` gets the same value check.** This repository commits
through `.githooks/` (`package.json:11`), not through the scaffolded copy, and its own gate
has the same one-sided check (`.githooks/commit-msg:52`). FR-1 to FR-3 apply to it too,
with its existing bypass variable (`RCDD_GATE_OFF`) and its existing advisory for
mislabelled non-fix subjects (`.githooks/commit-msg:30-47`) unchanged. Its refusal may keep
citing DR-003, because in this repository that id resolves correctly. Without this, MinSpec
would enforce on adopters a check it does not run on itself.

### Tests

**FR-9 - Behavioural test, run against the real hook text.** A new test
(`packages/minspec/tests/root-cause-gate-value.test.ts`) executes the scaffolded hook
content with `sh` against message files, the way `dr037-hook-scaffolds.test.ts:256-259`
does, and asserts exit codes and stderr for at least:

| Case | Expect |
|---|---|
| no `Root cause:` line | refused; stderr names the missing line |
| `Root cause:` then end of message | refused; stderr names the empty value |
| `Root cause:` then a blank line then prose | refused |
| `Root cause:` then the value on the next line | accepted |
| `**Root cause:** <prose>` | accepted |
| `Root cause: <one sentence>` and FR-4's own placeholder | refused; stderr names the placeholder |
| each of the eight FR-3 values, with and without a trailing full stop, in mixed case | refused |
| a real sentence that begins with "None" or "Unknown" | accepted |
| two `Root cause:` lines, the first empty and the second real | accepted |
| a non-`fix:` subject with an empty `Root cause:` | accepted (the gate does not apply) |
| `MINSPEC_GATE_OFF=1` with an empty value | accepted |
| a `git commit -v` message whose only real `Root cause:` text is below the scissors line | refused |
| every refusal's stderr | contains none of `DR-`, `#` followed by a digit, `RCDD`, `Phase`; is 16 lines or fewer |

The same table runs against `.githooks/commit-msg` for the rows FR-8 covers. Assertions on
source text alone are not sufficient (they pass without the behaviour).

**FR-10 - Template tests.** The rendered `CLAUDE.md`, `AGENTS.md` and `.cursorrules` are
asserted to contain the new rule, to contain no unrendered placeholder, and to stay inside
the FR-5 and FR-6 budgets measured against the rendering at the commit before the change.

**FR-11 - Existing pins re-checked.** `dr037-hook-scaffolds.test.ts:258` accepts
`Root cause: the widget was null.` (still accepted). `:274` uses `Root cause: n/a.` as a
fixture inside a test of the follow-up gate, which expects a refusal; under FR-3 the
refusal must still come from the follow-up gate, as that test's sibling at `:269` asserts
by message. The Plan phase decides whether to change that fixture or pin the ordering.

### Records

**FR-12 - Changelog.** `packages/minspec/CHANGELOG.md` states that after *Refresh Harness
Files* a `fix:` commit with an empty, placeholder or non-answer `Root cause:` is refused
where it previously passed, and names the bypass.

**FR-13 - DR-003's follow-up line is corrected.** `docs/decisions/DR-003.md:131-133` says
this is "not built". The implementing change rewrites that line to say what shipped and
when (the hook in #319, the prose in #1562) and to cite this spec for the remainder, each
claim backed by the `file:line` in the Context table above. No new decision is recorded;
the line is a follow-up pointer.

## Acceptance Criteria

- **AC-1.** In a freshly scaffolded project, a `fix:` commit whose body is `Root cause:`
  and nothing else is refused, and the same commit with a real sentence is accepted.
  (FR-1)
- **AC-2.** Pasting the placeholder from the refusal back into the message is refused.
  (FR-2, FR-4b)
- **AC-3.** Each of the eight non-answers is refused; a sentence that merely starts with
  one of those words is accepted. (FR-3)
- **AC-4.** No root-cause refusal contains a decision-record id, an issue number, "RCDD" or
  a phase number, and every refusal says which condition fired. (FR-4)
- **AC-5.** The rendered `CLAUDE.md` contains the one-sided-check question and a sentence
  saying the hook cannot judge whether a mechanism was named; it grew by 600 characters or
  fewer and has the same set of `## ` headings as before. (FR-5)
- **AC-6.** The rendered `AGENTS.md` and `.cursorrules` each contain the rule, grew by 450
  characters or fewer, and have the same set of `## ` headings as before. (FR-6)
- **AC-7.** `CONSTITUTION_MD_TEMPLATE` is byte-identical to its value before the change.
  (FR-7)
- **AC-8.** In an existing project, *Refresh Harness Files* updates the hook's managed
  region and leaves bytes outside the markers unchanged; a `CLAUDE.md` whose `## Pre-Commit
  Checks` section the adopter edited keeps the adopter's text. Both are existing behaviour
  and must still hold. (INV-3)
- **AC-9.** This repository's own `.githooks/commit-msg` refuses the same empty,
  placeholder and non-answer values. (FR-8)
- **AC-10.** The FR-9 test fails against the hook text at 350c6fa4 and passes after the
  change, shown by running it both ways.
- **AC-11.** `docs/decisions/DR-003.md` no longer says the product ships none of this.
  (FR-13)

## Invariants (must not break)

- **INV-1 - Offline.** The hook reads only the message file. No network call, no tracker
  lookup, no dependency beyond POSIX `sh`, `grep`, `sed`, `awk` (the tools it already
  uses). Constitution invariant 1.
- **INV-2 - No silent gate, both directions.** A missing or unreadable message file still
  fails open, as today (`template-registry.ts:1599-1600`): that is a missing prerequisite.
  An internal error inside the new value check refuses the commit; it must not fall
  through to exit 0. Constitution invariant 2, and the fail-direction rule the shipped
  `CLAUDE.md` already states.
- **INV-3 - Blast radius.** Nothing changes in a repository until someone runs Initialize
  or *Refresh Harness Files* there. No write outside the managed region of the hook, and no
  overwrite of a harness section the adopter edited. Constitution invariant 3.
- **INV-4 - The token is a stable contract.** `Root cause:` keeps its spelling, its
  case-insensitivity and its space-or-hyphen form (`docs/decisions/DR-003.md:75`). No
  second required token is added (DQ-1 Option C is the only option that would break this).
- **INV-5 - Only `fix:` subjects are gated.** The subject pattern at
  `template-registry.ts:1658` is unchanged.
- **INV-6 - The follow-up gate is untouched.** Same triggers, same escapes, same order
  relative to the root-cause check (`template-registry.ts:1622-1655`).
- **INV-7 - The gate is described as what it is.** No shipped text claims the hook verifies
  that a mechanism was named.
- **INV-8 - Byte-stable managed region.** The hook content stays free of per-project
  substitution, so the region is identical across projects
  (`template-registry.ts:958-960`).

## Decisions needed (Clarify)

Four questions. Each names a recommended option and what that option costs.

### DQ-1 - How much should the hook check?

The hook can check form. It cannot check meaning.

- **Option A - empty and placeholder only** (FR-1, FR-2). Smallest change; almost no risk of
  refusing an honest commit. Leaves `Root cause: n/a` passing.
- **Option B - A plus the closed non-answer set (rec)** (adds FR-3). Catches the cheapest
  way to satisfy the gate while saying nothing. **Cost:** a blocklist is never complete
  ("see above", "as discussed" still pass), so it can read as stronger than it is; and an
  author who truly does not know the cause now has to use the bypass or drop the `fix:`
  type, which is friction on an honest commit.
- **Option C - require a second line naming the check** (for example `Missed by:`).
  The only option that makes the second half structurally present. **Cost:** breaks the
  stable-token contract DR-003 names as its one hard seam (INV-4), refuses every `fix:`
  commit written the way adopters write them today, and still cannot tell a real answer
  from a filled-in blank. Would need a DR-003 amendment.

Choosing A removes FR-3 and its rows in FR-9. Choosing C replaces FR-3, changes FR-4b and
INV-4, and adds a decision record.

### DQ-2 - Should `AGENTS.md` and `.cursorrules` carry the rule?

- **Option A - yes, a short rule in each, under an existing heading (rec)** (FR-6). Agents
  that never read `CLAUDE.md` currently get the refusal with no prior guidance. **Cost:**
  up to 450 more characters of MinSpec's opinion in two files in every adopter project and
  every session that loads them; and an adopter who already edited that section does not
  receive it (the refresh keeps their version).
- **Option B - no; rely on the hook's refusal (FR-4) to teach every tool.** The refusal
  reaches any actor that commits, whichever file it reads. **Cost:** the lesson arrives
  only after a wasted fix attempt, which is the order DR-003 exists to prevent.

Choosing B removes FR-6 and AC-6.

### DQ-3 - Should the constitution carry it?

The issue names a `.minspec/constitution.md` template first.

- **Option A - no (rec)** (FR-7). The constitution is the adopter's own invariants; its
  template ships only commented examples (`template-registry.ts:771-824`). **Cost:** the
  first surface the issue named is deliberately left unused, and the one file MinSpec
  treats as the adopter's governing document does not carry the discipline.
- **Option B - propose it as a DRAFT principle through the constitution proposer**
  (SPEC-025; `packages/minspec/src/lib/constitution-proposer.ts:10-23`, `:83-84`).
  Additive and marked DRAFT, so it never overwrites the adopter's text. **Cost:** puts a
  MinSpec opinion into a user-owned file and leaves a DRAFT entry the adopter must accept
  or delete, in every project. It also overlaps `SPEC-099` (constitution lifecycle phase,
  in flight on branch `agent/issue-19`, not approved), which changes how that file is
  governed.

Choosing B adds requirements to this spec and makes SPEC-025 an affected owner.

### DQ-4 - Should the hook warn when a `fix:` commit changes only data or configuration?

This is the only mechanical handle on the data-only corollary, which the shipped prose
itself says "nothing enforces" (`template-registry.ts:580-581`).

- **Option A - no (rec).** The hook keeps reading only the message. **Cost:** the
  corollary stays prose, which is the "trust the model" shape constitution principle 8
  ("Don't hope an LLM will follow rules - enforce it via code",
  `.minspec/constitution.md:22`) warns against.
- **Option B - a non-blocking warning** when every staged path of a `fix:` commit is a
  data, configuration or documentation file. **Cost:** deciding what counts as "data" by
  file extension is a guess that is wrong for projects whose product is configuration; the
  hook gains a dependency on the staged diff, with new failure modes on amend, merge and
  partial commits; and a warning that fires often trains people to ignore the hook.

Choosing B adds requirements, test rows and a larger blast radius; it would be worth
re-checking the tier.

## Why no new DR

Every choice here can be undone in under a day by editing one template string and
refreshing. The discipline is already decided in DR-003, the hook's delivery in DR-037
(editor-independent gate harness), and the blast-radius rule in DR-074. `INDEX.md` was
searched for "root cause", "RCDD", "commit-msg" and "harness" before concluding this; no
other in-force record covers it. DQ-1 Option C is the exception and is flagged there.

## Out of Scope

- **Judging whether a sentence names a mechanism.** Not decidable offline by a shell
  pattern. An AI reviewer could; that is a different surface.
- **The four-phase protocol as shipped prose** (reproduce, diagnose, fix, harden). The
  shipped section deliberately carries the outcome, not the protocol. `SPEC-097` (bug
  lifecycle, in flight on branch `agent/issue-22`, not approved) proposes those phases as
  a first-class record and names the `commit-msg` gate as something it must reconcile
  with. If both are approved, whichever lands second rebases onto the other's hook text.
- **The advisory for bug fixes labelled as `chore:` or `refactor:`.** This repository's
  own hook has it (`.githooks/commit-msg:30-47`); the shipped hook does not. A separate
  feature with its own false-positive question.
- **Other MinSpec-internal ids in adopter-visible hook text.** The follow-up gate's refusal
  cites `DR-023/DR-059` and `#1918` (`template-registry.ts:1646-1651`), and the hook's
  header comment cites `DR-037`. Same defect class as FR-4g, different gate. Not tracked
  by an issue yet: this dispatch may not create one, so it is raised in the dispatch
  summary for a human to file.
- **New refresh or merge machinery.** None is needed.
- **Sub-section merge granularity** (so `### Root-cause gate` could update independently
  of the rest of `## Pre-Commit Checks`). Owned by the harness-refresh specs.
- **Migrating existing commit history.** The gate reads new commits only.

## Alternatives considered and rejected

- **Do nothing; the prose already shipped.** Rejected: the hook still accepts an empty
  line and its refusal still teaches the replaced shape and points at the wrong document.
  Measured above.
- **Ship DR-003 itself, or a debugging-checklist file, into adopter projects** (the
  issue's third suggestion). Rejected: a new generated file is a new refresh surface and
  another document for every session to load, for content that fits in the section that
  already exists. The #1557 change measured that cost.
- **Anchor the token to the start of a line.** Rejected: it would refuse `**Root cause:**`
  and list-item forms that pass today, for the sake of one contrived false accept.
- **A minimum length or word count for the value.** Rejected: arbitrary, trivially padded,
  and it refuses terse true causes.
- **Put the teaching only in `CLAUDE.md`.** Rejected: an adopter who edited any part of
  `## Pre-Commit Checks` never receives it, and tools that read other files never see it.
  The refusal text reaches everyone who commits.

## Test plan (for the Plan phase to place)

1. FR-9's table as a behavioural test against the rendered hook, run with `sh`, including a
   control that the old hook text fails it (AC-10).
2. The same value-check rows against `.githooks/commit-msg`.
3. Rendered-template assertions and character budgets (FR-10).
4. A refresh test: a project scaffolded from the pre-change templates, then refreshed,
   gets the new hook region with outside-marker bytes preserved, and keeps an edited
   `## Pre-Commit Checks` section (AC-8).
5. Run under the invocation CI uses, not only the local one.

## Traceability

- Issue: [#106](https://github.com/AIClarityAU/minspec/issues/106) - ship the
  mechanism-not-state refinement to adopter projects.
- Decision: [DR-003](../../../docs/decisions/DR-003.md) - root-cause-driven debugging;
  addendum at `:92-128`, follow-up line at `:131-133`, stable-token note at `:75`.
- Delivery mechanism: DR-037 (editor-independent gate harness), SPEC-043 (harness refresh
  manifest consistency), SPEC-058 (harness refresh merge path).
- Prior shipping changes: #247 via pull request #319 (the hook); #1557 via pull request
  #1562 (the prose).
- Neighbours in flight, not dependencies: SPEC-097 bug lifecycle (#22), SPEC-099
  constitution lifecycle phase (#19).
