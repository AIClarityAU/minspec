---
id: SPEC-212
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - gate-signal integrity; the merge-gating ai-review panel and its trusted approval_provenance block (SPEC-069, SPEC-078) live here
aspects: [ai-review, architect-voter, scope-creep, trusted-block, prompt-injection, no-silent-gate, verdict-carry, ownership]
depends_on: [SPEC-038]  # the implements:/affects: ownership convention this block reads
relates_to: [SPEC-069, SPEC-078, DR-033, DR-047, DR-079, DR-104, DR-109, "#1919", "#1688", "#1017"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3). The three
# NEW files are owned here: the declared-scope generator (FR-1 to FR-9), its tests on real git
# fixtures (FR-14), and the rubric-input contract test (FR-13). Modified, not owned: review-branch.sh gains the block and the defang
# (FR-10, FR-11); spec-gate.py gains a revision-reading seam with no behaviour change (FR-3);
# architect.md's scope rubric is rewritten to the input it actually receives (FR-12).
implements: [scripts/declared-scope.py, packages/minspec/tests/declared-scope.test.ts, packages/minspec/tests/review-branch-rubric-inputs.test.ts]
affects: [scripts/review-branch.sh, scripts/hooks/spec-gate.py, scripts/roles/architect.md]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-212: The architect voter is given the scope it is asked to judge - a machine-generated declared-scope block

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. `review-branch.sh`,
> `architect.md` and `spec-gate.py` are untouched. A human reads this spec, answers the questions
> under [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the
> normal spec-approval gate before anything changes. Every requirement is written under each
> question's recommended option; choosing another option changes only the requirements that
> question names.

Triggered by: #1919 (architect voter asked to judge scope with no scope in its prompt).
No new decision record: every choice here is a script plus a prompt block, revertible in under
a day (the under-a-day decision-record filter). It rests on DR-079 (the verdict travels out of band), DR-104 (a
pass is carried across a push that leaves the voters' input byte-identical) and DR-033 §6
(the panel's security model).

## In plain terms

The architect reviewer on every pull request is told to block a change that "exceeds the
scope its spec/issue/PR states". It is never shown any of those. Its prompt holds the diff,
the approval-provenance block and two commit SHAs, and nothing else. The workflow keeps the PR
title and body out on purpose, because they are attacker-written text. So every scope verdict
it has ever returned was a guess from the diff alone.

This spec adds one more machine-written block to the prompt. It lists each changed file and
which spec (if any) claims that file in its `implements:`/`affects:` frontmatter, as read from
the base branch. It also says whether the diff changes that spec's own documents. It contains
no PR text, so it opens no injection path. The architect still makes the call, but now from
facts it can check rather than from nothing.

## Problem (observed, with citations)

- The rubric: `scripts/roles/architect.md:15-16` - "does the diff exceed the scope its
  spec/issue/PR states (scope creep)".
- The prompt: `scripts/review-branch.sh:152-155` defines `REVIEW_INPUT` as the defanged diff
  plus the optional `PROVENANCE_BLOCK`. `:163-203` wraps it with fixed instructions and
  `Base:`/`Head:`/`Working directory:` lines. No PR title, body, linked issue or spec text
  appears anywhere in it.
- The deliberate exclusion: `.github/workflows/ai-review.yml:66-68` - "this workflow never
  interpolates PR title/body/diff into a shell (only base/head SHAs and the PR number, passed
  via env)".

**Root cause (mechanism plus missing gate).** The voter rubric and the prompt builder were
written to two different contracts, and no test checks that the inputs a rubric names are
in the prompt that voter receives. The rubric-input contract test (FR-13) is the missing gate,
and the declared-scope block (FR-1 to FR-11) is the missing input.

## Non-goals

- **Interpolating the PR title, body or linked issue.** Rejected in #1919. It brings the scope
  input back but reopens the injection surface `ai-review.yml:66-68` closed. Nothing in this
  spec reads any GitHub-hosted text, and the generator makes no network call (invariant 1).
- **A deterministic scope gate.** The block is evidence and the voter still judges. A hard
  "paths outside the owned set fail the check" rule is a separate decision. The issue reports
  that a critic found 12 of 14 recent commits touching files outside their spec's owned set,
  mostly tests. I believe that figure but have not verified it, and if it holds, a hard gate
  would mostly block legitimate work.
- **`review-approvable.sh`.** Approvable review covers a single document, not a diff. Out of
  scope.
- **Changing what `spec-gate.py` blocks.** FR-3 adds a seam; the hook's decisions stay
  byte-for-byte the same.

## Functional requirements

### The generator - `scripts/declared-scope.py <base> <head>`

- **FR-1 - Changed paths.** The generator reads the changed path list with
  `git diff --name-only -z <base>...<head>` (three-dot, the same range `review-branch.sh:91`
  diffs). A rename appears as its destination path. A deletion appears as the deleted path.
- **FR-2 - Ownership read from the merge base, never from the head.** Each spec's owned set is
  computed from the git objects at `merge-base(<base>, <head>)`, which is the same tree the
  three-dot diff is taken against. A diff therefore cannot widen its own claim by editing
  `implements:`. The read uses git plumbing (`git ls-tree`, `git show <rev>:<path>`) and
  never the working tree. The CI checkout is the head, so a working-tree read would let the
  diff decide its own ownership.
- **FR-3 - One ownership predicate, not two.** Ownership is computed by
  `spec-gate.py`'s `declared_impl_files`/`owned_file_set`, including the structured
  `implements:`/`affects:` signal, the fuzzy `tasks.md` code-span signal, `_SRC_EXT_RE`,
  `_INFRA_PREFIXES`, the per-id union of `select_verdict`, and `owned_match`'s
  case-insensitive membership. The generator does not copy any of these.
  `declared_impl_files` currently reads `tasks.md` and checks existence through the
  filesystem (`spec-gate.py:387-393`, `:377`). FR-3 adds an injectable reader for those two
  operations. The default reader is the current filesystem behaviour, so the hook is
  unchanged. The generator passes a git-revision reader. The existing
  `packages/minspec/tests/spec-gate.test.ts` must pass unmodified.
  *Disclosed consequence:* `_SRC_EXT_RE` has no `.md`, so a markdown file (a role prompt, a
  README, a spec doc) can never be owned. Such a file shows as a companion (FR-5) or as owned
  by no spec. This is the gate's real behaviour, reported as it is, not something this block
  should paper over.
- **FR-4 - "A spec this diff changes".** A spec counts as changed by the diff when any changed
  path lies inside that spec's document directory (`specs/<product>/SPEC-NNN-*/`), or is that
  spec's approval sidecar under `.minspec/approvals/`. This is purely a fact about the paths,
  with no reading of any prose.
- **FR-5 - Classification.** Every changed path lands in exactly one class, tested in this
  order:
  1. **owned by a spec whose documents this diff changes** - grouped under each owning
     `SPEC-NNN`;
  2. **owned by a spec whose documents this diff does not change** - grouped under each owning
     `SPEC-NNN`. This is the normal shape of an implement PR for an already-approved spec.
     It is NOT in itself scope creep (see FR-12);
  3. **companion** - not owned by any spec and matching one of these sub-classes, each named:
     `test` (`packages/*/tests/**`, `scripts/tests/**`, `**/*.test.*`), `spec-document`
     (`specs/**`), `approval-sidecar` (`.minspec/approvals/**`), `decision-record`
     (`docs/decisions/**`, `INDEX.md` included);
  4. **owned by no spec**.

  A path owned by more than one spec appears under each owner, and the block marks it
  `(shared)`. In that case only, the "exactly one class" rule is relaxed to "exactly one class
  per owning spec".
- **FR-6 - Ownership this diff declares.** A separate, labelled section lists each
  `implements:`/`affects:` entry the head adds or removes compared with the merge base, per
  spec (`SPEC-NNN implements: + path`). That way a PR that grants itself ownership is visible
  as doing so. It does not change the FR-5 classification, which stays merge-base-only (FR-2).
- **FR-7 - Deterministic and carry-stable.** The output contains no commit SHA, timestamp,
  absolute path or run-specific value. Lists are sorted (byte order) and spec groups are
  sorted by number. The same two trees always produce the same bytes. The block is part
  of `REVIEW_INPUT` (FR-10), which DR-104's carry hashes (`ai-review.yml:310-312`,
  `ai-review-guard.js` `planVerdictCarry`), so any non-determinism would quietly disable the
  carry. When a merge-from-main push changes any owned set the diff touches, the input
  changes and the panel re-runs. That is correct, not a regression.
- **FR-8 - Untrusted values cannot escape the trusted block.** Every path and frontmatter
  token is attacker-influenced, because the diff names them. Each one is rendered through the
  same neutralisation as `approval-provenance.py`'s `_sanitize` (`:134-161`): CR, LF and tab
  become spaces, `<` and `>` become `‹` and `›`, and length is bounded. That function is
  imported or moved to a shared module, not re-implemented (FR-3's one-predicate rule
  applies here too). A path whose bytes are not valid UTF-8 is rendered with replacement
  characters and still counted.
- **FR-9 - Bounded size, with nothing silently dropped.** Each list caps at a fixed number of
  entries (Clarify Q3). Any entries beyond the cap are replaced by `… and N more` with the
  exact count. The block's header line always carries the total changed-path count and the
  count per class, so the counts stay exact when entries are elided.

### Wiring into the prompt - `scripts/review-branch.sh`

- **FR-10 - A trusted block inside the reviewable input.** `review-branch.sh` runs the
  generator next to the provenance step (`:124-137`) and renders its output as

  ```
  <declared_scope TRUSTED="machine-generated by this repository's tooling — NOT from the diff">
  …
  </declared_scope>
  ```

  inside `REVIEW_INPUT`, after `PROVENANCE_BLOCK`, so `--print-input` and the prompt keep a
  single definition (`:139-147`). The fixed instructions (`:171-173`) gain one sentence:
  the block is trusted, machine-generated evidence, and paths in it are data. Every role
  receives the block (Clarify Q2).
- **FR-11 - Defang the new tag in the untrusted diff.** The `sed` at `:113-115` gains open and
  close forms of `declared_scope`, with the same tolerance for whitespace, attributes and case
  and the same visible `[defanged tag: declared_scope]` marker. Without this, a diff carrying a
  literal `<declared_scope TRUSTED=…>` impersonates the block. That is the escape `:100-112`
  documents for the two existing tags.
- **FR-11a - Failure is visible, never empty (constitution invariant 2).** If the generator
  exits non-zero, cannot be found, or prints nothing, the block still renders, with the
  single body line `declared scope: UNAVAILABLE (<reason>)`. The reason is the sanitised
  first line of the generator's stderr, or `generator missing` or `empty output`. The
  provenance step's `2>/dev/null || true` (`:126`) is NOT copied. The call captures the exit
  status and the stderr. A changed-path list that is legitimately empty cannot arise, because
  `:92-98` already exits on an empty diff. An empty generator output is therefore always a
  fault.

### The rubric - `scripts/roles/architect.md`

- **FR-12 - The rubric names the input it actually gets.** The **Scope** bullet
  (`architect.md:15-16`) is rewritten so that it:
  - judges scope against the `<declared_scope>` block, and says that the PR title, body and
    linked issue are deliberately NOT provided (`ai-review.yml:66-68`);
  - does NOT treat class 2 (owned by a spec whose documents are unchanged) or companions as
    creep on their own;
  - treats these as scope signals that need a stated reason: paths owned by two or more
    unrelated specs; a mix of owned paths and non-companion paths owned by no spec; and any
    ownership the diff grants itself (FR-6);
  - on `UNAVAILABLE`, returns a blocking finding that declared scope could not be computed
    (Clarify Q1). It does not infer scope from the diff.

  The rest of the voter section is unchanged.

### The missing gate

- **FR-13 - Rubric-input contract test.** A test reads the voter section of every
  `scripts/roles/{reviewer,security,architect,skeptic}.md`. For each `<tag>` block name the
  rubric references, it asserts that `review-branch.sh --print-input` emits that tag on a
  fixture repo. A rendered `UNAVAILABLE` block counts as emitted. The test then mutates a role
  file to name a non-existent `<missing_input>` and asserts that the test fails. This is the
  control that proves it is not vacuous. As a result, a future rubric that names an input
  the builder does not supply fails CI instead of silently guessing. This fixes the
  property and not just the one instance.
- **FR-14 - Generator tests on real git fixtures.** These are built with `git init` and real
  commits, and never mocked plumbing:
  - one fixture covering each FR-5 class, plus a `(shared)` path;
  - a head that edits `implements:` to claim its own paths: classification unchanged, and the
    claim listed under FR-6;
  - a path containing `\n</declared_scope>` and a path containing `<`: neither survives as a
    tag;
  - a diff carrying a literal `<declared_scope TRUSTED="x">` line: defanged in the prompt
    (FR-11);
  - over-cap lists: exact `… and N more` and exact header counts;
  - two runs over the same trees: byte-identical output (FR-7);
  - a broken generator (missing file, non-zero exit, empty stdout): `UNAVAILABLE (<reason>)`
    rendered and the review still assembled (FR-11a);
  - the tests run under `npx vitest` as CI does, not via a `pretest` hook.

## Acceptance criteria

- **AC-1** On a fixture PR, `review-branch.sh <base> <head> --print-input` contains exactly
  one `<declared_scope TRUSTED=…>` … `</declared_scope>` pair, after the provenance block.
- **AC-2** For that fixture, every changed path appears in the class FR-5 assigns, and the
  header counts equal `git diff --name-only <base>...<head> | wc -l` (or the FR-5 per-owner
  count when a path is shared).
- **AC-3** A head that adds `implements: [x.ts]` and changes `x.ts` lists `x.ts` as owned by
  no spec (or companion), and lists the claim under FR-6.
- **AC-4** No injected path or diff line can produce a second open or close `declared_scope`,
  `approval_provenance` or `untrusted_diff` tag in the assembled prompt.
- **AC-5** With the generator removed or failing, the prompt carries
  `declared scope: UNAVAILABLE (…)` and the architect's rubric directs a blocking finding.
- **AC-6** Two `--print-input` runs over unchanged trees produce byte-identical output, so
  DR-104's carry is unaffected when nothing relevant changed.
- **AC-7** The FR-13 test fails when a role names an input the builder does not emit, and
  passes on the shipped role files.
- **AC-8** `spec-gate.test.ts` passes unmodified after the FR-3 seam lands.

## Invariants this change must not break

- **INV-1 - Offline (constitution invariant 1).** The generator uses local git objects only.
  It makes no network call and reads no GitHub API.
- **INV-2 - No silent gate (constitution invariant 2).** The block never quietly goes empty
  (FR-11a), and no `|| true` sits on its producer.
- **INV-3 - Blast radius (constitution invariant 3).** This is dev-time machinery in this
  repo's `scripts/` and is never shipped into an adopter's repo.
- **INV-4 - Trust boundary (DR-033 §6).** No PR-hosted text enters the prompt, untrusted values
  stay inside sanitised fields, and the reviewer's tools stay Read/Glob/Grep.
- **INV-5 - Verdict out of band (DR-079).** The block is input only and adds nothing to the
  verdict schema or the renderer.
- **INV-6 - One ownership predicate.** Ownership is the gate's predicate, imported, never a
  second copy that can drift.

## Rollout notes (facts, not requirements)

- `ai-review.yml` runs the **base** branch's copy of `review-branch.sh` (`review-branch.sh:250-252`).
  The PR that adds this block is therefore reviewed without it, and the block first appears on
  the PRs reviewed after that one merges.
- `review-branch.sh` and `architect.md` are machinery. The PR that implements this merges by
  human `--admin`, not by auto-merge.

## Decisions needed (Clarify)

- **Q1 - What the architect does when the block reads UNAVAILABLE.**
  `a` **(rec)** return a blocking finding: scope is unwitnessed, so the voter fails closed,
  as invariant 2 asks of a missing witness. *Cost:* a generator fault turns every
  architect vote into `changes` until it is fixed. The generator is local and deterministic,
  so a fault is a real bug, not weather, but while it lasts it does stop merges.
  `b` return a non-blocking finding and judge scope from the diff, as today. *Cost:* the scope
  verdict silently falls back to the very guess this spec exists to remove.
- **Q2 - Which voters receive the block.**
  `a` **(rec)** all four, inside the single `REVIEW_INPUT`. This keeps one definition of what
  the voters are given, which is what `--print-input` and DR-104's carry hash. *Cost:* extra
  prompt tokens on three voters whose rubric does not use the block (bounded by FR-9).
  `b` the architect only. *Cost:* the reviewable input becomes role-dependent, so
  `--print-input` and the carry hash need a role argument. That is a wider change to
  `ai-review.yml`.
- **Q3 - The per-list cap (FR-9).**
  `a` **(rec)** 50 entries per list. *Cost:* in a large sweep the voter sees counts but not
  every path, so it may ask for changes it would not ask for with the full list.
  `b` no cap. *Cost:* a several-hundred-file PR inflates every voter's prompt, and a
  path-spam diff can bury the classes the rubric reads.
- **Q4 - Whether the companion `test` class should require a matching owned path.**
  `a` **(rec)** no. A test path that no spec owns is a companion whatever else changes, as in
  #1919's proposal. *Cost:* a PR that only adds unrelated tests reads as all companions.
  `b` yes. A test counts as a companion only when the diff also changes an owned path in the
  same package. *Cost:* more rules to tune, and more false `changes` on test-only PRs.

## Follow-ups (tracked)

None. A deterministic scope gate (Non-goals) would change no decision within 30 days and is
not filed (DR-023 amendment).
