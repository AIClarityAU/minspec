---
id: SPEC-216
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - gate-signal integrity; a merge-relevant witness that can be absent with nothing turning red
aspects: [ai-review, design-scope, plan-phase, invented-requirements, no-silent-gate, second-witness, required-check, machinery]
depends_on: [DR-057, DR-104]  # DR-057 routes generated design.md through a PR; DR-104 is the carry rule this check reuses
relates_to: [SPEC-212, SPEC-046, SPEC-065, SPEC-035, DR-033, DR-066, DR-079, DR-109, "#1938", "#1876", "#1881", "#1882", "#679"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3). The NEW
# files are owned here: the role prompt (FR-6), the workflow that runs the check and posts
# its witness (FR-1, FR-9), the pure decision module (FR-2, FR-4, FR-7, FR-8) and its tests.
# Modified, not owned: review-branch.sh gains the role's trusted input block and defang
# (FR-5); the shared guard gains the second-witness read (FR-10); ready-to-merge.yml calls it;
# ci.yml gains the step that runs the new test file (FR-13). The guard, its test file,
# review-branch.sh and ready-to-merge.yml are shipped templates, so ci-review-templates.ts is
# regenerated (FR-12a), never hand-edited.
implements: [scripts/roles/design-scope.md, .github/workflows/design-scope.yml, .github/scripts/design-scope-decide.js, .github/scripts/design-scope-decide.test.js]
affects: [scripts/review-branch.sh, .github/scripts/ai-review-guard.js, .github/scripts/ai-review-guard.test.js, .github/workflows/ready-to-merge.yml, .github/workflows/ci.yml, packages/minspec/src/lib/ci-review-templates.ts]
phases:
  specify: in-progress
  clarify: done
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-216: A design PR cannot read as ready until a scope check has compared it, FR by FR, against the approved requirements

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. No workflow,
> script, role prompt or ruleset is touched. A human reads this spec, answers the questions
> under [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the
> normal spec-approval gate before anything changes. Every requirement is written under each
> question's recommended option. Choosing another option changes only the requirements that
> question names.

Triggered by: #1938 (Plan-phase designs: the founder's scope-check condition is not a gate).
Rests on DR-057 (generated `design.md` takes the PR review lane), DR-104 (a verdict is
carried across a push that leaves its input byte-identical) and DR-033 §6 (the review
panel's security model). **No new decision record.** A new workflow, a new role prompt and one
more required check can all be reverted in under a day (the under-a-day decision-record
filter). Removing the required check is a ruleset edit. The decision this gate enforces, the
founder's 2026-09-09 ruling on #1876, is not recorded in any DR in this repo; whether to record
it is Clarify Q4, not something this spec decides.

## In plain terms

On 2026-09-09 the founder decided that a T3/T4 `design.md` no longer needs its own human
approval, on one condition: every Plan batch first gets an adversarial check, and the first
thing that check asks is whether the design invents requirements. That condition exists only
as a comment on #1876. When a restart killed the batch before the check ran, nothing noticed.
Two designs (#1881, #1882) then carried `ai-review:pass` and `awaiting-approval` and looked
ready to merge. When the check was finally run by hand, both failed it.

This spec turns the condition into a gate. Any pull request that adds or edits a
`specs/**/design.md` gets a separate, model-backed **design-scope** check. The check reads the
approved `requirements.md` from the base branch and the design from the head. It has to
account for every FR in the requirements and list anything in the design that no FR asks for.
The check posts its own required check-run. `ready-to-merge` independently refuses to go green
on a design PR without a passing design-scope witness on the current head. If the check did not
run, could not finish, or returned something malformed, the PR stays visibly red.

## Problem (observed, with citations)

- **The condition is prose only.** The founder's ruling is a comment on #1876. Searching
  `docs/decisions/`, `specs/`, `.github/` and `scripts/` for it, for "invented requirement",
  and for any check name that encodes it finds nothing. I searched for the vocabulary listed
  here; a differently worded encoding could exist, but no workflow under `.github/workflows/`
  names one (`ls .github/workflows` lists 13 files and none of them concerns design scope).
- **The panel that does run judges a document, not a comparison.** `ai-review.yml:689-699`
  requires the architect and skeptic voters under `panel` coverage. `scripts/roles/architect.md`
  asks about design fit, scope, reversibility, contracts and alternatives. The scope bullet
  judges a diff against "the scope its spec/issue/PR states", and SPEC-212 (in flight, #1919)
  shows that voter is never given that scope. No voter is handed the approved
  `requirements.md` next to a `design.md` and told to account for each FR.
- **One channel passed both designs.** The issue reports that #1881 passed two ai-review
  rounds and #1882 one, and that both then failed the manual check (six and four sections
  respectively cannot be built as written). I take these numbers from the issue and have not
  re-run either check.

**Root cause (mechanism plus missing gate).** The mechanism: the founder's condition was
attached to a process step (a Plan batch) held only in a supervisor's memory, so a restart
that killed the batch also killed the step. The missing gate: no merge-relevant signal depends
on the check having run, so its absence cannot turn anything red. That is the shape
constitution invariant 2 forbids. FR-1 and FR-9 are the missing check. FR-10 is the
independent second witness invariant 2 asks for.

## Non-goals

- **Folding the comparison into ai-review's existing voters.** The issue's second option, and
  rejected there: it would rely on the same channel that passed both designs, and invariant 2
  asks for an independent second witness. This check is a separate workflow with a separate
  prompt and a separate check-run. It still uses the same model provider, so it is
  independent in producer and input, not in model. That limit is stated, not hidden.
- **Keeping it as a manual Chief-of-Staff step.** The issue's third option. That is the
  arrangement that failed.
- **Judging design quality.** Coherence, correctness and citations stay with the ai-review
  panel. This check asks one question: does the design stay within what the approved
  requirements ask for, and does it account for all of it?
- **`tasks.md`.** Clarify Q2.
- **Shipping the check to adopters.** Clarify Q3. Under the recommended option the gate is
  armed in this repo only, and the shipped templates carry its reads dormant (FR-12a).
- **Re-litigating #1881 and #1882.** They are under revision against the manual check today.
  Once this gate lands they pass through it like any other design PR.

## Functional requirements

### When the check applies

- **FR-1 - Trigger predicate.** A pull request is a *design PR* when
  `git diff --name-status -z <base>...<head>` (three-dot, the same range `review-branch.sh`
  diffs) lists at least one path matching `specs/**/design.md` with status `A`, `M`, or `R`
  (destination path) or `C`. A deletion (`D`) alone does not make it a design PR. The
  predicate lives in one pure function in `.github/scripts/design-scope-decide.js`. The
  workflow (FR-9) and the second witness (FR-10) both call that function and neither copies
  it. If the diff cannot be computed, the result is `indeterminate`. Indeterminate is treated
  as a design PR whose check cannot conclude (FR-8), never as not-a-design-PR.
- **FR-2 - Not-applicable is reported, not silent.** On a PR that is not a design PR, the
  workflow still posts the `design-scope` check-run with conclusion `success` and the title
  `not applicable - no design.md added or edited`. A required check that never reports would
  hold every PR pending. A check that reports `skipped` cannot be told apart from one that was
  meant to run and did not.
- **FR-3 - One check per design document.** When a PR touches more than one `design.md`, each
  is checked separately against its own sibling `requirements.md`. The check-run passes only
  if every document passes. Its summary lists each document and its result.

### What the check compares

- **FR-4 - The requirements are the approved ones, read from the base.** For a design at
  `specs/<product>/<dir>/design.md`, the requirements are `specs/<product>/<dir>/requirements.md`
  read with git plumbing (`git show <merge-base>:<path>`) from `merge-base(<base>, <head>)`,
  never from the head or the working tree. A PR therefore cannot loosen the requirements it is
  judged against in the same diff. The requirements must be **approved and fresh** at that
  merge base, by the same predicate the extension and `spec-gate.py` already use for "approved"
  (imported, not re-implemented; the Plan names the call site). If there is no sibling
  `requirements.md`, or it is not approved and fresh at the merge base, the result is
  `cannot-conclude` with that reason (Clarify Q5).
- **FR-5 - Input assembled by `review-branch.sh` as a new role.** The check runs
  `scripts/review-branch.sh <base> <head> --role design-scope`, reusing its diff fetch,
  untrusted-diff defang, quota handling and verdict extraction. For this role only, the prompt
  gains a trusted block
  `<approved_requirements TRUSTED="read from the merge base by this repository's tooling - NOT from the diff" path="…">…</approved_requirements>`
  holding the FR-4 text. It is placed next to the existing `approval_provenance` block.
  `review-branch.sh` today rejects any role outside `reviewer|security|architect|skeptic`
  (`scripts/review-branch.sh:74-76`, and the matching usage strings at `:18` and `:59-60`), so
  that allowlist gains `design-scope`; the role file is still loaded from `scripts/roles/`
  (`:82-84`), which exits non-zero when the file is missing. The
  untrusted-diff defang (`review-branch.sh`'s `sed` over tag names) gains open and close forms
  of `approved_requirements`, with the same tolerance and visible marker as the existing tags.
  Without that, a design line containing a literal `<approved_requirements TRUSTED=…>` could
  impersonate the block. The design itself reaches the voter as the head file (the voter keeps
  read-only `Read`/`Glob`/`Grep`), and the diff shows what changed. The block joins
  `REVIEW_INPUT` (`review-branch.sh:152`) only when the role is `design-scope`. That variable
  is what `--print-input` prints and what ai-review hashes for its verdict carry, so the
  input every other role sees, and its carry hash, stay byte-identical (FR-16).

### The rubric

- **FR-6 - Role prompt `scripts/roles/design-scope.md`.** The voter's job is to account for
  every FR, then hunt for invented scope. Its verdict is in scope only when every design
  section traces to an FR, AC or INV in the approved requirements, or to something needed to
  build one, with that chain stated in the design. The prompt names these as **invented
  scope**, each with an example taken from #1938:
  1. a new behaviour, setting, environment variable or public surface that no FR asks for
     (the `MINSPEC_MODE` override in #1882);
  2. any path that **loosens** a policy the requirements fix (the same override resolving
     `solo` over a committed `team` config and arming unattended auto-merge);
  3. work that belongs to an item the requirements put out of scope or name as a non-goal
     (the #679 grammar constants in #1881);
  4. **answering** a question the requirements leave open for a human (a Clarify question or
     open question), as opposed to recording it as still open (#1881);
  5. **narrowing or widening** an approved FR, AC or open question (#1881).

  A design that records an open question as needing the founder's decision, rather than
  answering it, is not inventing scope. The SPEC-065 design's OQ-2 is that shape. The voter
  does not judge design quality (see Non-goals).
- **FR-7 - Verdict format, machine-checkable.** The voter emits exactly one block:

  ```
  <design_scope_verdict doc="specs/…/design.md">
  verdict: pass | changes
  fr: <FR-id> | designed | <design section reference>
  fr: <FR-id> | deferred | <the design's stated reason>
  invented: none
  invented: <design section reference> | <category 1-5> | <one-line reason>
  </design_scope_verdict>
  ```

  It contains one `fr:` row per FR, and either a single `invented: none` or one row per
  finding. Every field is clamped and neutralised through the guard's existing
  `clampField`/`defangProtocolTokens` (`.github/scripts/ai-review-guard.js:106`, `:128`) before
  it is rendered anywhere, not through a second copy. As with every voter (DR-079), the verdict
  travels out of band.

### The deterministic decision

- **FR-8 - The decision is computed, not just read off the model.** A pure function in
  `design-scope-decide.js` takes the FR-4 requirements text and the voter's raw output and
  returns `pass`, `changes`, `blocked` or `cannot-conclude`, plus a reason:
  - **FR set.** The FR ids the requirements *define* are extracted by one function: a line
    whose first token, after an optional list marker (`-`, `*`) or heading marker (`##` to
    `######`) and optional `**`, matches `FR-\d+(\.\d+)?[a-z]?`. Cross-references inside
    prose (such as "SPEC-038 FR-1") are not definitions. If the extractor finds zero FRs, the
    result is `cannot-conclude` (`no FR definitions found in requirements`).
  - **Coverage.** The set of `fr:` ids in the verdict must equal the extracted set: none
    missing, none unknown, none duplicated. Any mismatch → `cannot-conclude`
    (`verdict does not account for FR-x`), never `pass`.
  - **Agreement, one direction only.** Any `invented:` row other than `none` → `changes`,
    whatever the `verdict:` line says. `verdict: changes` → `changes`. The function can lower
    a verdict and can never raise one.
  - **No block, more than one block per document, an unparseable block, or a `doc=` that
    names a document other than the one checked** → `cannot-conclude`.
  - **Voter unavailable.** A quota or outage, by the guard's existing `isQuotaExhaustion`
    classification (`ai-review-guard.js:314`), → `blocked`, which stays eligible for retry and
    is kept apart from `changes`, the same split `ai-review.yml`'s combine step keeps.

### The witness and its second, independent reader

- **FR-9 - Workflow `.github/workflows/design-scope.yml`.** The workflow triggers on
  `pull_request` (`opened`, `synchronize`, `reopened`, `ready_for_review`). It is never
  `pull_request_target`. It checks out and runs the **base** branch's copies of
  `review-branch.sh`, `scripts/roles/design-scope.md` and `design-scope-decide.js`, the same
  base-trust `ai-review.yml` uses, so a PR cannot edit the check that judges it. It posts the
  `design-scope` check-run on the head SHA as the reviewer App (`minspec-sdd[bot]`, App token),
  with these conclusions: `success` for `pass` or not applicable, `failure` for `changes` or
  `cannot-conclude`, and `failure` with a title naming the outage for `blocked`. No producer
  step uses `|| true` or `2>/dev/null` on the signal it writes; a failed step fails the job and
  the check-run. The check-run summary carries the rendered FR table and the invented-scope
  rows, so the human can see why without opening logs. A `changes` or `cannot-conclude`
  result also posts one PR comment with the same content.
  - **Carry (DR-104).** On a push whose FR-5 input is byte-identical to the input of the last
    completed round on the previous head (same requirements text, same design file bytes,
    same base copies of role and decide module), the previous result is carried to the new
    head with a fresh check-run that says it was carried and from which commit. Any input
    change re-runs the check. Carry reuses the guard's existing round-record functions and
    adds no second implementation.
- **FR-10 - `ready-to-merge` is the independent second witness.** The guard step in
  `ready-to-merge.yml` (already base-pinned) calls the FR-1 predicate itself. On a design PR,
  or an indeterminate one, it requires a completed `design-scope` check-run on the **current
  head SHA**, conclusion `success`, posted by an allowlisted reviewer identity (the same
  allowlist and head-binding strictness as `verifyHeadPassCheckRun`,
  `ai-review-guard.js:1566`). If that check-run is absent, stale, failed or from any other
  identity, `ready-to-merge` posts `failure` with the description
  `design-scope check missing or not passed on this head`. This holds even when the PR carries
  a verified `ai-review:pass`. Two producers must each fail for the gate to open falsely: the
  design-scope workflow, and the guard's own reading of the diff. A permissions or
  configuration gap that stops `design-scope.yml` from running leaves no check-run, and
  `ready-to-merge` turns red on its own.
- **FR-11 - `awaiting-approval` is not applied to a design PR without the witness.** The
  `awaiting-approval` sync in `ready-to-merge.yml` (DR-063, SPEC-031 FR-9a) treats a design PR
  without a passing FR-10 witness as not ready. That is the label that made #1881 and #1882
  read as ready for a human, so the "your turn" signal can no longer appear before the
  founder's condition is met.
- **FR-12 - Required check.** `design-scope` is added to `main`'s required-check set. This is
  a human ruleset edit: the App does not hold `admin:write`, and a ruleset PUT replaces the
  whole set, so the edit must re-send every existing required check. Until the ruleset carries
  it, FR-10 alone still holds the gate closed, because `ready-to-merge` is already required.
- **FR-12a - Shipped files carry the change dormant, and the base tree arms it.**
  `review-branch.sh`, `ai-review-guard.js` (with its test file) and `ready-to-merge.yml` are
  shipped to adopters verbatim through the generated
  `packages/minspec/src/lib/ci-review-templates.ts` (bodies at `:1479` for `ready-to-merge.yml`,
  `:2420` for `review-branch.sh`, `:4367` for the guard and `:5842` for its test file), so
  FR-5, FR-10 and FR-11 change files adopters receive. To keep this repo-only (Clarify Q3
  option `a`, constitution invariant 3), the FR-10 and FR-11 reads apply **only when
  `.github/workflows/design-scope.yml` exists in the base tree** the guard is already pinned
  to. The `design-scope.yml` workflow and `scripts/roles/design-scope.md` are not added to the
  templates, so in an adopter repo the reads stay off, and `--role design-scope`, though accepted by
  the widened allowlist (FR-5), stops at the missing-role-file check and exits non-zero. In this repo the gate is armed as soon as the workflow merges. Disarming it
  means deleting that workflow in a machinery PR, which merges only by human `--admin`, so
  disarming is deliberate and visible, never a configuration gap. The rejected alternative,
  an Actions repository variable as the switch, lives outside the tree and is exactly the
  "one configuration gap disables the check" shape invariant 2 forbids. `ci-review-templates.ts`
  is regenerated, never hand-edited.

### Tests

- **FR-13 - Pure-function tests (`design-scope-decide.test.js`)**, run on plain Node with
  `node --test`, as CI runs the guard's own suite (`.github/workflows/ci.yml:113` names each
  file explicitly). `ci.yml` therefore gains a step naming the new file. A test file that no
  CI step names gates nothing:
  - FR-1 predicate: `A`, `M`, `R` (source and destination), `C`, `D`-only, a
    `design.md` outside `specs/`, a nested `specs/a/b/design.md`, and diff failure →
    indeterminate;
  - FR-8 FR-set extraction over fixtures in each definition style the corpus uses (`- **FR-1
    - …**`, `### FR-2`, `FR-9.10`, `FR-11a`), and over a cross-reference that must not count;
  - coverage: missing, unknown, duplicated → `cannot-conclude`;
  - agreement: `verdict: pass` with one `invented:` row → `changes`; `verdict: changes` with
    `invented: none` → `changes`; nothing ever turns into `pass`;
  - zero, two and malformed blocks, and a wrong `doc=` → `cannot-conclude`;
  - a quota message → `blocked`, distinct from `changes`.
- **FR-14 - Corpus measurement, not assumption.** A test runs the FR-8 extractor over every
  `specs/**/requirements.md` on the checked-out tree. It asserts a non-zero FR count for each
  file whose sibling `design.md` exists. The test failure lists each zero-count file, so the
  Plan measures how many existing specs the extractor misses instead of guessing.
- **FR-15 - Second-witness tests.** Guard tests cover a design PR with a verified
  `ai-review:pass` and no `design-scope` check-run → `ready-to-merge` red; a passing check-run
  on the previous head only → red; a passing check-run from a non-allowlisted identity → red;
  a passing check-run on the head from the App → green, all else equal; a non-design PR with
  no `design-scope` check-run → unaffected by FR-10; a design PR with no `design-scope`
  check-run in a base tree **without** `design-scope.yml` → unaffected (FR-12a, the adopter
  case). Each test is shown red with the FR-10 read
  removed (mutation control), so none can pass vacuously.
- **FR-16 - Prompt-boundary test.** `review-branch.sh <base> <head> --role design-scope
  --print-input` on a fixture repo emits exactly one `approved_requirements` open and close
  pair. A design line carrying a literal `<approved_requirements TRUSTED="x">` comes out
  defanged. Other roles' input contains no `approved_requirements` block.

## Acceptance criteria

- **AC-1** A PR that adds `specs/x/SPEC-N-y/design.md` against approved requirements, with a
  verdict accounting for every FR and `invented: none`, gets a `design-scope` check-run of
  `success` on its head. `ready-to-merge` behaves as it does today.
- **AC-2** Re-running the #1882 head as it stood when the issue was filed (the
  `MINSPEC_MODE` override) through the check gives `changes` with at least one category-2 row.
  Re-running the #1881 head gives `changes` with at least one category-3 row. Both use the
  heads as filed (Plan: pin the SHAs). This is a calibration run of a model-backed check, so it
  is recorded as evidence in the implementation PR, not asserted in CI.
- **AC-3** With `design-scope.yml` disabled or deleted on a branch, a design PR with a verified
  `ai-review:pass` shows `ready-to-merge` red with the FR-10 description and no
  `awaiting-approval` label.
- **AC-4** A verdict omitting one FR row produces `failure` with
  `verdict does not account for FR-x` in the check-run title.
- **AC-5** A non-design PR gets `design-scope` `success` titled `not applicable` and is
  otherwise unaffected.
- **AC-6** A push that changes neither the design, the requirements at the merge base nor the
  base copies of the check carries the previous result with a fresh, labelled check-run. A
  push that edits the design re-runs the check.
- **AC-7** A design whose sibling `requirements.md` is unapproved or stale at the merge base
  gets `failure` with that reason (under Clarify Q5 option `a`).
- **AC-8** FR-13 to FR-16 pass in CI, and each FR-15 test fails when the FR-10 read is removed.

## Invariants this change must not break

- **INV-1 - Offline core (constitution invariant 1).** Nothing in the extension changes. The
  check is CI machinery and runs only where `ai-review.yml` already makes model calls.
- **INV-2 - No silent gate (constitution invariant 2).** A missing, failed, malformed or
  incomplete check is red and says why (FR-2, FR-8, FR-9). There is a second, independent
  witness (FR-10). No producer step swallows an error.
- **INV-3 - Blast radius (constitution invariant 3).** The check covers this repo only. The
  shipped templates that change (FR-12a) behave exactly as before in any repo whose base tree
  has no `design-scope.yml`, and that workflow and its role file are not shipped (Clarify Q3
  option `a`). FR-15 includes a test that `ready-to-merge` is unchanged when the workflow is
  absent from the base tree.
- **INV-4 - Trust boundary (DR-033 §6).** No PR title, body or linked-issue text enters the
  prompt. The requirements come from the merge base. The diff and design stay untrusted and
  defanged. The voter keeps read-only tools. The check runs the base copies of its own
  machinery.
- **INV-5 - Verdict out of band (DR-079).** The verdict is parsed from the voter's output and
  rendered by the guard's existing neutralisation. No new path renders model text unescaped.
- **INV-6 - One predicate per question.** The FR-1 trigger, the FR-4 approval test and the
  FR-8 FR extraction each exist once and are imported by every caller.
- **INV-7 - Lower, never raise.** The deterministic decision (FR-8) can turn a model `pass`
  into `changes` or `cannot-conclude`, and never the reverse.

## Rollout notes (facts, not requirements)

- `design-scope.yml`, `review-branch.sh`, `ai-review-guard.js` and `ready-to-merge.yml` are
  machinery. The implementing PR merges by human `--admin`, not auto-merge.
- Base-trust means the PR that adds the workflow is not itself checked by it. The first design
  PR checked is the first one opened or pushed after the merge.
- Design PRs open at merge time (including #1881 and #1882 if still open) turn red on
  `ready-to-merge` at their next event until a `design-scope` run passes. That is intended.
- Cost: one more model-backed voter run per design-PR push, carried when inputs are unchanged.
  DR-109 (accepted) already puts specs at the machinery voter count. This check is in addition
  to the panel, not a replacement for any voter.
- SPEC-212 (in flight) gives the architect voter a declared-scope block for every diff. It
  answers "does this diff stay inside what its spec owns?", while this spec answers "does
  this design ask for things its requirements do not?". The two do not overlap and can land
  in either order. Both edit `review-branch.sh`'s defang `sed`, so whichever lands second
  rebases onto the other.
- The spec id SPEC-216 was taken as one above the highest id visible across local
  remote-tracking refs (SPEC-215) at authoring time. No cross-PR spec-id gate exists on the
  base yet (SPEC-205 is in flight), so a collision is possible and is renumbered if found.

## Decisions needed (Clarify)

All 6 decisions are answered, not ratified: an agent session selected on 2026-10-25, for each, the option this document already recommended. No human chose them, and no delegation covers authoring Clarify answers. Delegation DLG-001 (DR-108) made none of these selections and covers spec approval and engineering-DR acceptance only. An agent-recorded selection carries no consent, whoever prompted it. It is ratified only by approval of this spec, the founder's or the bot's under DLG-001, and that approval may overturn it.

- **Q1 - How many passing runs a design needs.** The issue's interim process requires two
  independent passing runs before a PR returns to ready.
  **Recorded selection: (a),** one run per head with FR-8's deterministic coverage and agreement checks, since two runs double tokens, wall-clock and quota `blocked` exposure on every design push.
  `a` **(rec)** one run per head, with FR-8's deterministic coverage and agreement checks.
  *Cost:* a single model run has variance, so a design that a second run would fail can pass.
  The coverage check limits but does not remove this.
  `b` two runs, both of which must pass. *Cost:* twice the tokens and wall-clock on every
  design push, and twice the exposure to quota `blocked`.
- **Q2 - Whether `tasks.md` is covered too.** DR-057 also routes generated `tasks.md` through a
  PR, and a task list can also invent scope.
  **Recorded selection: (a),** `design.md` only, as the founder's condition and #1938 state; a `tasks.md` check would need a second rubric and widen scope beyond the issue.
  `a` **(rec)** `design.md` only, as the founder's condition and #1938 state. *Cost:* a
  generated `tasks.md` that adds work no FR asks for is still caught only by the existing
  panel, which is the same channel that missed these two designs.
  `b` `design.md` and `tasks.md`, the latter compared against requirements and the approved
  design. *Cost:* a second rubric and FR-8 variant to build and calibrate, and wider scope
  than the issue asks for.
- **Q3 - Whether the check ships to adopters.** The guard, `review-branch.sh` and
  `ready-to-merge.yml` are shipped templates, so some shipped bytes change either way (FR-12a).
  **Recorded selection: (a),** this repo only, since shipping the workflow armed by default would give adopters an uncalibrated required model-backed check and red design PRs.
  `a` **(rec)** this repo only: the shipped files carry the reads dormant, armed by
  `design-scope.yml` existing in the base tree, and that workflow and its role are not
  shipped. *Cost:* adopters receive code they do not run, and an adopter running Plan-phase
  automation gets no scope gate until a later spec ships the workflow.
  `b` ship the workflow and role too, armed by default. *Cost:* adopters get a new required
  model-backed check, and its token spend, before it has been calibrated here, and every
  adopter's design PRs go red until their ruleset and reviewer App are set up for it.
- **Q4 - Whether to record the founder's 2026-09-09 ruling (#1876) as a decision record.** That
  ruling (no human approval for a T3/T4 `design.md`, conditional on this check) exists only as
  an issue comment. This spec enforces its condition but does not restate the ruling
  authoritatively.
  **Recorded selection: (a),** a separate DR quoting the founder's comment verbatim, so a later reader cannot remove this gate without knowing it was the price of that ruling.
  `a` **(rec)** yes, in a separate DR whose text quotes the founder's comment verbatim and
  cites this spec as the gate enforcing its condition. *Cost:* one more record for the founder
  to accept, and until it lands this gate enforces a condition the register does not show.
  `b` no; the issue comment stays the only record. *Cost:* the register holds no record of why
  design PRs skip human approval, so a later reader can remove this gate without knowing it
  was the price of that ruling.
- **Q5 - What happens when the requirements are not approved and fresh at the merge base.**
  **Recorded selection: (a),** `cannot-conclude` is red, because under (b) the PR controls both sides of the comparison and could widen the requirements to fit an invented design.
  `a` **(rec)** `cannot-conclude` → red. A design can only be checked against approved
  requirements. *Cost:* a PR that bundles a requirements edit with its design, or a design
  edit to a spec whose approval went stale, is red until it is split or re-approved, or a
  human merges with `--admin`.
  `b` compare against the head's requirements and mark the check-run `unapproved baseline`.
  *Cost:* the PR controls both sides of the comparison, so it can widen the requirements to
  fit an invented design and pass.
- **Q6 - How a false `changes` is overridden.**
  **Recorded selection: (a),** no override except fixing the design or a human `--admin` merge, since a label override adds a forgeable surface and becomes the default response to a red check.
  `a` **(rec)** only by fixing the design or a human `--admin` merge. No label or comment
  overrides it. *Cost:* a check that is wrong costs the founder a keystroke each time, and a
  run of false `changes` early on is friction until the rubric is calibrated.
  `b` a human-applied `design-scope:override` label, provenance-checked like `ai-review:pass`.
  *Cost:* a new forgeable-label surface to guard, and an override that is easy to apply
  becomes the default response to a red check.

## Follow-ups (tracked)

None filed by this dispatch: it cannot run `gh`, and every candidate follow-up is a Clarify
question above whose answer decides whether it exists (Q2 `tasks.md`, Q3 template shipping,
Q4 the DR). Whoever answers Clarify materialises any follow-up its answers create, per DR-023.
