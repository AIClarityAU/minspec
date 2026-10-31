---
id: SPEC-130
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-130 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-002  # Signpost Integrity - an approval voided by recording progress is a false "needs re-approval" signpost
relates_to: [DR-102, DR-035, DR-034, DR-087, DR-090, SPEC-022, SPEC-070, "#224", "#1668", "#3267"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-130 - Design: checkbox state leaves the approval hash

Plan for [requirements.md](requirements.md), built under the recorded Clarify answers
(Option A for DQ-1 to DQ-4: every task-list line in the body, code samples included, no
migration, a tick-only stale record may resolve fresh and is reported by path). Citations
of "today" are against `origin/main` `91c103d1`, the commit this plan was written on. New
code is cited by symbol, because its line numbers move.

## Approach in one paragraph

One private helper, `uncheckTaskItems(body)`, is added to each canonicalizer twin and called
on the body only, after the lifecycle strip and before the rejoin, so the frontmatter is
never touched. It splits on `\n`, applies the FR-1 expression to each line with a single
replacement, and rejoins. The Python twin changes in the same commit and the embedded copy in
`ci-review-templates.ts` is regenerated, never hand-edited. Before that commit, a frozen copy
of today's Node canonicalizer is vendored into the test fixtures and pinned to the nine golden
pairs that exist today, and a standing corpus test classifies every approval sidecar under
both hashers. That test is green before the step lands (both hashers are the same function)
and stays green after it (measured: no fresh record covers a ticked document). The step
then lands with its golden pairs, and the tests that can only pass once it exists - the
voided-record fixture, the character-class scan, the flip-every-checkbox property, and the
end-to-end approval and gate cases - follow it. The prose FR-9 names is repaired last.
No hashing call site changes (FR-4).

## Re-measured at `91c103d1` (FR-11, AC FR-11)

Computed with the shipped `scripts/hooks/canonical.py` and a scratch canonicalizer carrying
the FR-1 expression, over the tree at `91c103d1`, on 2026-10-28. The requirements table was
taken at `a482aee6`; the rows that moved are marked.

| Measurement | At `a482aee6` | At `91c103d1` |
|---|---|---|
| Approval sidecars under `.minspec/approvals/` | 78 | **95** (84 `requirements.md`, 2 `design.md`, 1 `tasks.md`, **8 decision records**: DR-102, DR-107 to DR-113) |
| Fresh under today's hash | 76 | **93** |
| Stale under today's hash | 2 | 2 (`specs/minspec/design.md`, `specs/minspec/tasks.md`, unchanged) |
| Fresh sidecars whose document contains a ticked item | 0 | 0 |
| Records fresh today and stale under the new hash (FR-7, the voided set) | 0 | **0** |
| Records stale today and fresh under the new hash (FR-8, the restored set) | 0 | **0** |
| Unreadable sidecars, or sidecars naming a missing document | not measured | 0 |
| Acceptance-criteria checkboxes in `requirements.md` files | 358, ticked 0 | **604 in 162 files**, ticked 0 |
| Checkboxes in decision records and epics | 13, ticked 0 | 13 in 125 files, ticked 0 |
| Checkboxes in `design.md` files | 2, ticked 1 | 2 in 35 files, ticked 1 (the same code sample, `specs/minspec/design.md`) |
| Ticked items across `tasks.md` files | 453 in 21 files | **480 of 648 in 22 files** |
| Non-standard markers | 1 (`- [~]`) | 1 (the same line, `specs/minspec/SPEC-004-classifier-validation/tasks.md:28`) |
| `tasks.md` files that open with frontmatter / carry `tier:` | 21 / 5 | 22 / 5 |

**What moved, and why it does not change the plan.** Eight decision records now carry
approval sidecars; none of them contains a ticked item, so the population this change could
void is still zero. Both the voided and the restored sets are empty, so no record needs a
re-approval before the implementing pull request merges, and FR-8's list is expected to print
empty. The implementing pull request re-runs this by the FR-7 test itself, not by this table.

**SPEC-070 (ownership leaves the hash) has not landed.** Its plan is in flight (#3284) and
its first slice also edits both twins and vendors a frozen hasher of its own
(`scripts/lib/canonical-pre-ownership-strip.ts`). FR-11 is satisfied by one rule, stated in
task 1.1: the vendored copy is taken from `packages/shared/src/canonical.ts` **as it stands on
`main` when task 1.1 is implemented**, not from this plan's base. If SPEC-070's first slice
(its blank-line block terminator fix) has landed by then, the copy includes it; if not, the
copy excludes it and SPEC-070 vendors after this change. The re-measure is the FR-7 test run
at implementation time.

## The step

### The expression, identical text in both twins

```
^([ \t]*(?:>[ \t]*)*(?:[-*+]|[0-9]{1,9}[.)])[ \t]+)\[[xX]\](?=[ \t]|$)
```

- **Node:** a module-level `const TASK_CHECKBOX_TICKED_RE = /…/;` with no flags. No `g` is
  needed: the expression is anchored, applied per line, and matches at most once.
  Replacement `'$1[ ]'`.
- **Python:** `_TASK_CHECKBOX_TICKED_RE = re.compile(r'…')` with no flags, applied with
  `.sub(r'\1[ ]', line, count=1)`.
- **Why the per-line split rather than a multiline flag.** JavaScript's `m` flag and Python's
  `re.M` agree on `^`, but Python's `$` also matches before a trailing `\n`; splitting on
  `\n` first leaves no newline inside any line, so `$` means end of line in both. The body is
  already EOL-normalized by step 1, so no `\r` reaches the expression.
- **Why it cannot backtrack badly.** Every quantified group is delimited by a character the
  next group cannot consume (`>` closes a quote prefix, the list marker is a fixed set, the
  bracket is literal), and the match is anchored at the start of a line with a bounded ordinal
  (`{1,9}`), so a failing line is rejected in time linear in its length.
- **Length-preserving by construction.** `[x]` becomes `[ ]`: one character for one. The
  Contract's length property holds without a separate test, and the FR-6 idempotence case
  covers it indirectly (a second pass finds no `[x]` to rewrite).

### Where it runs

```
normalized = EOL-normalize(raw)                     # step 1
m = FRONTMATTER_RE match                             # step 2
if m:  fm = stripLifecycle(m[1])                    # step 3
       body = uncheckTaskItems(normalized[m.end:])  # step 4 (new)
       joined = '---\n' + fm + '\n---\n' + body     # step 5
else:  joined = uncheckTaskItems(normalized)        # step 4 (new): no frontmatter, whole document
relative-link collapse                               # step 6
trailing-whitespace strip, newline collapse          # step 7
sha256                                               # step 8
```

The step runs before the trailing-whitespace strip, so `- [x]   ` matches on the space after
the bracket and then loses its trailing spaces to step 7, giving `- [ ]`. `- [x]` at the end of
a line matches on `$`. A document whose frontmatter does not match `FRONTMATTER_RE` is all
body today (`canonical.ts:96-98`) and stays all body, so the two branches cover every input.

### Header comments (FR-9, first bullet)

Both headers gain the same new step 4, worded identically:

> 4. In the body only (the whole document when there is no frontmatter), rewrite each ticked
>    task-list marker - a list item whose marker is followed by `[x]` or `[X]` - to the
>    unticked `[ ]`. Nothing else on the line changes. A tick records progress and is not
>    covered by approval; editing the item's text still is.

and steps 4 to 7 renumber to 5 to 8. The "Consequence" paragraph in the Node header gains one
sentence: ticking or unticking a task-list item does not void an approval. The wording avoids
the three words DR-087 (integrity words are claims) forbids and never says a tick is checked
by the tool (FR-10).

## The frozen pre-change copy and its pin (FR-7)

`packages/minspec/tests/fixtures/canonical-pre-checkbox.ts` (new, owned) is a verbatim copy of
`packages/shared/src/canonical.ts` from `main` at the time task 1.1 is implemented (FR-11),
reduced to what hashing needs - the four module-level expressions, `stripLifecycle`,
`canonicalizeSpec` and `specHash` - with the exports renamed `preCheckboxCanonicalize` and
`preCheckboxSpecHash` so no import can pick up the wrong one by name. It imports `crypto` only.
A header comment records the source commit sha and says the file is frozen on purpose and is
never updated to follow `canonical.ts`.

**The pin uses a frozen list of pair names, not the directory.** The vendored copy is run over
the golden pairs that exist before this change, named in a constant
`PRE_CHECKBOX_GOLDEN_PAIRS` in the test file: today `body-status-kept`, `crlf`,
`inline-comments`, `link-collapse`, `multi-trailing-newline`, `no-frontmatter`,
`phases-blank-terminated`, `phases-with-comment`, `trailing-ws` (nine; re-listed from `main` at
task 1.1). The test fails, never skips, if the list is empty or any named pair is missing.

Rejected alternatives, recorded here because under the `act` autonomy setting this file is the
only review path for them:

| Alternative | Why rejected |
|---|---|
| Enumerate the directory and exclude this change's new pairs by a name prefix | Every pair a later change adds (SPEC-070 plans four) would be run through a hasher frozen before it existed and go red for a reason unrelated to this spec. A frozen list pins exactly the population FR-7 names. |
| Pin the copy by `preCheckboxSpecHash(raw) === specHash(raw)` over the corpus | True only until the step lands; it inverts on the first ticked file, so it cannot be a standing pin. FR-7 names the golden pairs. |
| Import `@aiclarity/shared` for the "old" side, or read the old file from a git ref | FR-7 forbids the first (it computes the new hash on both sides). A git ref is unavailable in a shallow CI clone. |
| Place the copy under `scripts/lib/`, beside SPEC-070's frozen copy | FR-7 fixes the path, and `implements:` declares it; moving it would mean editing the approved requirements. |

## The corpus test (FR-6, FR-7, FR-8)

`packages/minspec/tests/checkbox-basis-corpus.test.ts` (new, owned). One file, four describe
blocks, each landing in the task that can make it green.

**[A] the classifier, a pure function local to the test file.**
`classifyApprovalBasis(rootDir)` walks `<rootDir>/.minspec/approvals/**/*.json` and returns
`{ voided: string[], restored: string[], errors: string[] }`, each entry a repo-relative path:

- The approvable path is derived from the sidecar's location (strip the
  `.minspec/approvals/` prefix and the `.json` suffix), the same derivation
  `scripts/approval-integrity.ts` uses, and is cross-checked against the record's `specPath`;
  disagreement is an error.
- Unreadable JSON, a non-object, a missing approvable, or a non-string `specHash` is an
  **error**, never a skip (FR-7, INV-3). An empty walk is an error too: a test that classifies
  zero records proves nothing.
- `old = preCheckboxSpecHash(raw) === record.specHash`,
  `new = specHash(raw) === record.specHash`, with `specHash` imported from
  `@aiclarity/shared` (the shipped twin). `old && !new` → `voided`; `!old && new` →
  `restored`.

Freshness is exactly the equality the readers use: `approval.ts:495`, `spec-gate.py:543-546`
and `scripts/approval-integrity.ts:183-184` all compare the stored `specHash` to the hash of
the file's current bytes. No other field takes part.

**[B] FR-7 and FR-8 on the real tree and on fixture trees.**

- Real tree: `errors` empty; `voided` empty, failing with every voided path in the message.
- FR-8 report: `restored` printed by path under a heading that says the list is informational
  once the change has landed (it then contains every record approved over a ticked document,
  by construction). It never fails the build.
- Fixture trees, built in a temp dir: one unreadable sidecar → `errors` names it; one sidecar
  naming a missing document → `errors` names it; zero sidecars → `errors` non-empty.
- Fixture tree with one record minted by `preCheckboxSpecHash` over a document holding a ticked
  item → `voided` names that record. This case is red until the step lands (both hashers
  agree before it), so it is added in task 3.1, after the step, with its red output on the
  pre-step tree quoted in that pull request as the step's own red-before evidence.

**[C] FR-6, the pair property, both twins.** Over every `specs/**/*.md`,
`docs/decisions/*.md` and `docs/epics/*.md`: build `flipped` by toggling every task-list
checkbox in the body (`[ ]` ↔ `[x]`, using the FR-1 grammar widened to `[ xX]`); assert
`specHash(raw) === specHash(flipped)` and
`canonicalizeSpec(canonicalizeSpec(raw)) === canonicalizeSpec(raw)` in Node; then send every
`{raw, flipped}` pair to **one** `python3` subprocess (a short inline driver that imports
`scripts/hooks/canonical.py` and returns both hashes and the idempotence result per file as
JSON) and assert the same in Python, and that each Python hash equals the Node hash. One
subprocess, not one per file, keeps the cost to a single interpreter start over ~350 files.
`python3` absent or the driver failing is a **failure**, mirroring
`canonical-golden-python.test.ts:46-52`, never the skip that `canonical-parity.test.ts:67`
carries (INV-3: no new skip path). A non-vacuity control asserts the walk found more than zero
documents and more than zero ticked lines.

**[D] the frozen copy's pin** (above).

## The character-class scan (FR-2)

Added to `packages/minspec/tests/canonical.test.ts` (modified). It reads both source files as
text, extracts the expression assigned to `TASK_CHECKBOX_TICKED_RE` (Node regex literal) and
`_TASK_CHECKBOX_TICKED_RE` (Python raw string), and asserts:

- each extraction finds exactly one expression (fail if the constant is missing or renamed:
  a scan of nothing passes vacuously);
- neither contains `\s`, `\S`, `\d`, `\D`, `\w`, `\W`, `\b`, `\B`, `\p{` or `\P{`, and neither
  carries a flag;
- the two expression texts are byte-identical to each other and to the FR-1 text.

The mutation evidence AC FR-2 asks for (introduce `\s`, then `\d`, into each twin in turn;
the scan fails each time) is run once by the implementer and quoted in the pull request body.
It is not committed as a test, because a committed mutant is a second copy of the expression.

## The end-to-end acceptance cases (AC FR-1)

- **Extension side**, in `packages/minspec/tests/approval.test.ts` (modified): approve a
  temp-dir spec carrying `- [ ] **Done** - x. (FR-1)` with `approveSpec`; tick it →
  `getApprovalStatus` is `approved`; untick → `approved`; change the item's text → `stale`;
  add an item → `stale`; change `[ ]` to `[~]` → `stale`.
- **Gate side**, in `packages/minspec/tests/spec-gate.test.ts` (modified), with the file's
  existing `writeSpec` / `approve` / `runGate` helpers: an approved spec that declares
  `implements: [x.ts]` and carries one criterion; tick it and an edit to `x.ts` is allowed;
  change the criterion's text and the same edit is denied; `[~]` is denied.

These go after the step and are green on landing.

## Prose (FR-9, FR-10)

| Where | Today | Change |
|---|---|---|
| `scaffold.ts:163-165` (shipped into every scaffolded `tasks.md`) | "Ticking a checkbox here is body-only - it never voids spec approval (DR-035)." | "Ticking a checkbox here records progress; it does not affect approval." No decision or spec id (SPEC-021). True for a `tasks.md` with frontmatter, because the step is body-only and the checkboxes are in the body. |
| `scaffold.ts:101`, `auto-bootstrap.ts:443`, `auto-bootstrap.ts:754` | Source comments citing DR-035 for "a T3/T4 split spec needs a `tasks.md`" | Reworded to state the rule with no `DR-035` token. AC FR-9 requires `grep -n "DR-035" packages/minspec/src` to return nothing, and these three are the rest of what it returns today. `auto-bootstrap.ts` is not in `affects:`; it is named in tasks.md so the spec gate's tasks.md signal covers it. Comment-only edits. |
| `slash-commands.ts`, the `specify` body, after the Acceptance Criteria paragraph | Says nothing about ticks | One sentence: "Ticking a criterion does not affect approval: a tick records progress, so never use a tick to record a choice - write the choice as text." |
| `slash-commands.ts`, the `implement` body, after "update the checkbox" | Says nothing about approval | One sentence: "Ticking a task does not affect approval; a tick records progress and is never the way to record a choice." |
| `.claude/commands/minspec-specify.md`, `.claude/commands/minspec-implement.md` | This repository's own committed copies of those two managed regions | Brought in line with the new bodies in the same commit, so the repository that builds MinSpec reads the guidance it ships. |
| `packages/minspec/CHANGELOG.md` | No unreleased section | A new `## [Unreleased]` section with one entry carrying the three statements FR-9 lists. |
| DR-034, SPEC-022 | Describe the old canonical form | Not edited (FR-9 last bullet, Out of Scope). |

Wording in both guidance sentences is true from an adopter's vantage (DR-090): it names no
file of this repository and no decision id. The guidance lookup FR-9 leaves to the Plan phase
is answered by the table: the Specify and Implement guidance MinSpec ships is the `specify`
and `implement` entries of `SPEC_KIT_COMMANDS` in `slash-commands.ts`, rendered into
`.claude/commands/` and the other tools' equivalents.

## Requirement → task map

| Requirement | Task(s) |
|---|---|
| FR-1, Contract step 4 | 2.1 |
| FR-2 | 4.1 |
| FR-3 | 2.1 |
| FR-4 | every task (no call site in any allowlist); checked in 7.1 |
| FR-5 | 2.1 |
| FR-6 | 4.2 |
| FR-7 | 1.1, 1.2, 3.1 |
| FR-8 | 1.2, 7.1 |
| FR-9 | 2.1 (headers), 6.1, 6.2, 6.3 |
| FR-10 | 2.1, 6.1, 6.2, 6.3 (wording); checked in 7.1 |
| FR-11 | this section; 1.1 (vendor from `main` at implementation time) |
| AC FR-1 | 5.1, 5.2 |
| INV-1 | 2.1, 4.2 |
| INV-2 | 2.1 (pure string transform, no new import) |
| INV-3 | 1.2, 4.1, 4.2 (fail, never skip) |
| INV-4 | 2.1 (no new delivery path; the embed is the existing one) |
| INV-5 | 1.2 |
| INV-6 | 2.1 (near-miss pairs), 5.1, 5.2 |
| INV-7 | every task (no sidecar in any allowlist) |

## Risks found while planning

| Risk | Mitigation |
|---|---|
| Another spec lists a file this plan edits in its own `affects:` (for example `slash-commands.ts` is in SPEC-047's), and that spec is unapproved, so the spec gate blocks the edit | A blocked edit is a `DEEPER:` stop for the task, never a workaround. The guard is the spec gate doing its job. |
| SPEC-070's first slice lands between this plan and task 1.1 | Task 1.1 vendors from `main` at its own time (FR-11). Task 2.1 rebases its two-twin edit onto whatever is there; the golden pairs pin the outcome either way. |
| A ticked document is approved after this plan and before the step merges | The FR-7 test fails on the implementing pull request and names it; DQ-3 says the human re-approves it. |
| The CRLF golden input is normalized to LF by git | `crlf.input` exists today as CRLF with no `.gitattributes` rule for the fixtures directory; the new CRLF pair is checked with `file` before commit, as the existing one is. |
