---
id: SPEC-326
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - "approved" certifies the spec text only; this reports when the merged code no longer matches it
aspects: [spec-conformance, post-merge, report-only, ai-review, untrusted-input, no-silent-gate, measurement]
depends_on: [SPEC-038]  # the implements:/affects: ownership declaration is how a merged diff finds its spec (FR-2)
relates_to: [SPEC-216, SPEC-070, SPEC-041, SPEC-212, DR-033, DR-056, DR-079, "#3645", "#643"]
implements: none
implements_reason: >-
  Specify phase only. Expected surface (not claimed yet, see Clarify Q1 and Q4): a new
  report-only workflow under .github/workflows/, a pure decision module and its test under
  .github/scripts/, a role prompt scripts/roles/spec-conformance.md, and a role-allowlist
  and trusted-block change in scripts/review-branch.sh. Ownership is declared in Plan,
  before approval mints a hash (SPEC-051).
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-326: After a merge, report where the merged code contradicts the approved spec it implements

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> this spec, answers the questions under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the normal
> spec-approval gate before anything changes. Each requirement is written under the
> recommended option of each question. Picking a different option changes only the
> requirements that question names.

Triggered by: #3645 (flag a merged diff that contradicts its approved spec). Source: the
fortnightly competitor check of 2026-11-11, queue item cl1111.

**No new decision record.** The change is a report-only workflow, a role prompt and a pure
module. Each can be removed in under a day (the under-a-day decision-record filter). Turning
the report into a merge gate later **is** a decision that needs a record, and this spec does
not make it (FR-12, Clarify Q5).

## In plain terms

An approval certifies the spec's text. MinSpec hashes that text and reports when it changes
(`canonicalSpecHash`, `packages/minspec/src/lib/approval.ts:344`; `resolveStatus`, `:489`).
Nothing compares the **code** that later merges with what that approved text requires or
forbids. The issue cites an outside finding (Uvik) that 7.9% of tickets with a spec shipped a
diff that contradicted it. I take that number from the issue. It is not measured on this
repo, and FR-10 exists to measure our own rate.

This spec adds a check that runs **after** a pull request merges to `main`. It finds the
approved spec or specs that own the changed files. A model-backed reviewer then reads the
approved requirements and the merged diff and lists two kinds of finding:

- **contradicts**: the code does something an FR, AC or invariant rules out;
- **omits**: the code leaves out something an FR, AC or invariant requires, *within the part
  of the spec this merge claims to deliver* (FR-6).

The check reports. It never blocks a merge, reverts anything or edits a spec.

## Problem (observed, with citations)

- **Approval binds text, not code.** The approval record stores a hash of the spec's
  canonical content (`approval.ts:344`) and compares it on read (`approval.ts:489`). No input
  to that comparison comes from implementation files.
- **The pre-merge review is not handed the spec.** `scripts/review-branch.sh` accepts roles
  `reviewer|security|architect|skeptic` only (`scripts/review-branch.sh:73-76`). The only
  trusted block it adds to the diff is `<approval_provenance>` (`:132-134`). No voter receives
  the approved `requirements.md` next to the diff. The architect role's scope bullet judges a
  diff against "the scope its spec/issue/PR states". SPEC-212 records that the voter is never
  given that scope. SPEC-216 (status `planning`, not built) adds an approved-requirements
  block for **design.md** pull requests only.
- **Ownership is declared, not checked for meaning.** SPEC-038 (status `done`) requires a
  T3/T4 spec past Clarify to declare `implements:`/`affects:` paths. `scripts/hooks/spec-gate.py`
  reads those paths (`declared_impl_files`, `:326`) to block edits **before** approval. After
  approval the declaration says *which* files a spec owns. Nothing uses it to ask whether the
  changes to those files still match the spec. #643 (drift gate) covers declared paths that
  disappear. It does not cover code that contradicts the spec.

**Root cause (mechanism plus missing gate).** The mechanism: the approval gate's input is the
spec's bytes alone. Every later witness (the spec-gate hook, ai-review, the validators)
either checks the spec or checks the code against general rules, never the code against the
spec. The missing gate: no signal anywhere turns visible when a merged diff departs from the
approved requirements. This spec adds that signal as a report first. Whether it becomes a gate
is a later decision, backed by the precision measured in FR-10.

## Non-goals

- **Blocking or reverting a merge.** Report only (the issue's own cost note). Promotion to a
  gate is FR-12 and Clarify Q5.
- **Editing a spec or its approval.** The check never writes to `specs/`, `.minspec/approvals/`
  or any approval record. A finding never makes an approval stale.
- **Judging code quality.** Correctness, security and style stay with the ai-review panel.
  This check asks one question: does the merged change obey the approved spec it implements?
- **Design.md scope.** That is SPEC-216 (a design invents requirements). This spec compares
  **code** with requirements.
- **Declared paths that vanish.** That is #643.
- **Merges no approved spec owns.** They are counted (FR-3) but not judged. Asking a model
  which spec an unowned change "probably" implements is out of scope.
- **Running inside the extension.** The comparison needs a model, so it cannot live in the
  Tier-0 extension (constitution invariant 1). See Clarify Q4 for adopters.

## Functional requirements

### When the check runs

- **FR-1 Trigger.** The check runs once per commit that lands on `main` by a pull-request
  merge (a `push` to `main`). The diff under review is that commit against its **first
  parent** (`git diff <sha>^1 <sha>`). With squash merges, that is exactly the pull request's
  change. The last eight commits on `main` on 2026-11-13 each have one parent and a `(#N)`
  subject, so this repo squash-merges in practice. A true merge commit is still diffed against
  its first parent. The pull request is identified by the trailing `(#N)` in the
  squash subject. If no number can be identified, the report still runs and is written to the
  run summary (FR-8) without a PR comment. Direct pushes that are not merges are handled the
  same way. A manual `workflow_dispatch` with a commit SHA re-runs the check for that commit.

### Finding the spec

- **FR-2 Spec selection is deterministic.** A spec governs the merged diff when all of these
  hold, evaluated on the **first parent** (the state before the merge):
  1. its `requirements.md` declares `implements:` or `affects:` paths (SPEC-038), and at
     least one changed path matches one of them, by the same match the spec-gate applies
     (`owned_match`, `scripts/hooks/spec-gate.py:460`, called or shared, never re-implemented;
     the declared-path validity rules stay those of
     `packages/minspec/src/lib/ownership-path-rules.ts`, already parity-pinned to the gate);
  2. it is **approved and fresh** at the first parent, by the same predicate the extension
     uses (`resolveStatus`, imported, not copied).

  A spec referenced by id (`SPEC-NNN`) in the squash commit message but owning no changed path
  is listed in the report as "referenced, owns none of the changed files" and is **not**
  judged (Clarify Q2). Selection runs without a model, so it is cheap and reproducible.
- **FR-3 Ungoverned merges are counted, not judged.** When no spec is selected, the check
  makes no model call. It records `no-governing-spec` with the changed-path count in the run
  summary and the measurement log (FR-10). This keeps the token cost to merges that have a
  spec to compare against.
- **FR-4 Unapproved or stale owners are reported, not judged.** A spec that owns a changed path
  but is not approved, or whose approval is stale at the first parent, is listed as "owner not
  approved: <status>". It is not judged, because there is no approved text to compare against.
  A stale owner is itself a signal worth showing.

### What is compared

- **FR-5 Inputs, with trust stated.** For each selected spec the reviewer receives:
  - the spec's `requirements.md`, read with `git show <sha>^1:<path>` (the approved bytes as
    they stood before the merge, never the merged or working-tree copy, so a pull request
    cannot rewrite the spec it is judged against), inside a trusted block
    `<approved_spec TRUSTED="read from the pre-merge commit by this repository's tooling - NOT from the diff" id="SPEC-NNN" path="…">`;
  - the merged diff, restricted to the paths that spec owns plus a list of the other changed
    paths by name, inside the existing `<untrusted_diff>` channel;
  - read-only `Read`/`Glob`/`Grep` over the merged tree, the same tool set the ai-review voters
    hold.

  The diff defang in `review-branch.sh` gains open and close forms of `approved_spec`, with the
  same tolerance and visible marker as the existing tags. Without that, a line in the diff could
  impersonate the trusted block. If SPEC-216's `approved_requirements` block has landed by Plan,
  the Plan reuses it instead of adding a second tag (Clarify Q3).
- **FR-6 Omission is judged against the slice, not the whole spec.** One merge often delivers
  one slice of a spec. A reviewer that compared every merge with the full spec would report
  every unbuilt requirement on every merge. So an **omits** finding is allowed only when one
  of these holds:
  1. the merge or its pull request names the FR, AC or task it delivers (in the squash message,
     or as a checked item in the spec's `tasks.md` changed by this merge), and the diff leaves
     out something that named item requires; or
  2. the merge moves the spec's `status` to `done` or its `phases.implement` to `done`. Then
     every FR, AC and invariant is in scope, and an omission is checked against the **merged
     tree**, not only the diff.

  In every other case the reviewer reports **contradicts** findings only.

### The rubric and the verdict

- **FR-7 Role prompt `scripts/roles/spec-conformance.md`.** The reviewer reports a finding only
  when it can cite both sides: the spec paragraph (FR, AC, INV or Non-goal id, or quoted line)
  and the code location (`file:line` in the merged tree). Its categories:
  1. **contradicts**: the code does what an FR, AC, invariant or non-goal rules out (e.g. a
     network call in a path the spec says is offline; a setting the spec says must not exist);
  2. **omits** (only under FR-6): a required behaviour in scope for this merge is absent;
  3. **exceeds**: the code adds a user-visible behaviour, setting or public surface in owned
     files that no FR asks for. Reported as `info`, never counted as a contradiction.

  The reviewer does not report style, quality or a "better approach". A requirement the code
  meets in a way the reviewer would not have chosen is not a finding. Where the spec is silent,
  the reviewer says nothing.
- **FR-8 Machine-checkable verdict, rendered safely.** The reviewer emits exactly one block per
  selected spec:

  ```
  <spec_conformance_verdict spec="SPEC-NNN" sha="<merge sha>">
  result: conforms | departs
  finding: <contradicts|omits|exceeds> | <spec paragraph id or quoted line> | <file:line> | <one-line reason>
  finding: none
  </spec_conformance_verdict>
  ```

  A pure function (in a new `.github/scripts/` module, with a unit test) parses that block. It
  returns `conforms`, `departs` or `cannot-conclude` with a reason. A block that is missing,
  duplicated, carries a different `spec` or `sha`, or has a finding without both citations
  becomes `cannot-conclude`, never `conforms`. A finding whose `file:line` does not exist in
  the merged tree, or whose spec paragraph id does not exist in the approved text, is dropped
  from the verdict, and the drop is listed. Every rendered field passes through the guard's
  existing `clampField`/`defangProtocolTokens` (`.github/scripts/ai-review-guard.js`), not a
  second copy.

### Reporting

- **FR-9 Where the report goes.** For each run the workflow writes:
  1. the job summary: one row per selected spec with its result, and each finding with both
     citations;
  2. when a PR number was identified (FR-1) and at least one spec is `departs` or
     `cannot-conclude`: one comment on the merged pull request, posted under the review bot
     identity (DR-033 section 6, DR-056), headed `Spec conformance (report only, does not
     block)`. A run where every spec `conforms` posts no comment, to keep noise down. The job
     summary still records it.

  The workflow files no issue and applies no label (Clarify Q6).
- **FR-10 Measurement log.** Each run appends one JSON line per selected spec, plus one
  `no-governing-spec` line, to a durable artifact (Clarify Q7 decides where). The line records:
  merge sha, PR number, spec id, result, finding counts by category, and the model and token
  count. A later human or agent mark of each finding as `true` or `false` uses the same key
  (merge sha, spec id, finding index). This is the evidence FR-12 needs, and it is how this repo
  learns its own rate in place of the 7.9% figure.
- **FR-11 A check that could not run is visible.** Any failure (model unavailable, quota,
  parse failure, git error, missing file) makes the workflow run end **red** with the reason in
  the job summary. A failed run is never reported as `conforms` and never ends green with zero
  findings. Because the check is not a required status (FR-12), a red run blocks nothing. The
  `main-red-watch` signal decides whether a red post-merge run is surfaced to a human (Clarify
  Q8). The workflow never uses `continue-on-error` or `|| true` on a step whose output it
  reports.

### Promotion

- **FR-12 Report-only until a recorded decision.** The workflow is not added to any ruleset's
  required checks and does not run on `pull_request`. Moving it before merge, or making it
  required, is out of this spec. That needs a decision record citing FR-10 precision data and a
  separate spec. This spec records the threshold the founder sets in Clarify Q5 so the later
  decision has a bar to meet.

## Acceptance criteria

- **AC-1** Given a merge whose changed paths match no approved spec's `implements:`/`affects:`,
  no model call is made, and the log gains one `no-governing-spec` line. (Test: the pure
  selection function on a fixture tree; the model seam is asserted not called.)
- **AC-2** Given a merge that changes a path owned by an approved, fresh spec, exactly that
  spec is selected, and its `requirements.md` is read from `<sha>^1`, not from `<sha>`. (Test:
  a fixture where the merge also edits the spec; the trusted block carries the pre-merge bytes.)
- **AC-3** Given an owner that is unapproved or stale at the first parent, it is listed as
  "owner not approved" and not sent to the reviewer.
- **AC-4** Given a reviewer output with a missing block, two blocks for one spec, a mismatched
  `sha`, or a finding lacking a citation, the decision is `cannot-conclude`, and the run ends
  red. (Unit tests on the pure parser, one per case.)
- **AC-5** Given a finding citing a `file:line` absent from the merged tree, or a paragraph id
  absent from the approved spec, that finding is dropped and listed as dropped.
- **AC-6** Given a diff containing a literal `<approved_spec TRUSTED=…>` line, the reviewer
  input shows the defanged marker in place of the tag. (Test via `review-branch.sh
  --print-input`.)
- **AC-7** Given the role is not `spec-conformance`, `review-branch.sh --print-input` output is
  byte-identical to before this change, so the existing ai-review voters and their carry hash
  (DR-104) are unaffected.
- **AC-8** Given a merge that does not move the spec to done and names no FR or task, any
  `omits` finding is rejected by the parser (FR-6) and listed as out of slice.
- **AC-9** The workflow is absent from every ruleset's required checks, and has no
  `pull_request` trigger. (Asserted by a test over the workflow file and the committed ruleset
  snapshot, if one exists. Otherwise the Plan names how this is witnessed.)
- **AC-10** Given every selected spec `conforms`, no PR comment is posted, and the job summary
  and log both record the result.

## Invariants (must not break)

- **INV-1 Offline core** (constitution invariant 1). Nothing in `packages/minspec` or
  `packages/shared` makes a model or network call for this feature. The comparison runs in CI
  only.
- **INV-2 No silent gate** (constitution invariant 2). A run that could not conclude is red and
  says why. It never reads as `conforms`. The check is labelled report-only everywhere it
  appears, so nobody mistakes it for a gate that passed.
- **INV-3 Blast radius** (constitution invariant 3). Under the recommended option of Clarify Q4
  the workflow runs in this repo only. If it ships to adopters, it ships dormant unless the repo
  has `.minspec/` and opts in.
- **INV-4 Approvals are untouched.** No finding writes to a spec, an approval record or a
  sidecar, or changes any spec's resolved status.
- **INV-5 Untrusted diff.** The diff and PR text are data to the reviewer, never instructions.
  The reviewer holds read-only tools only. Only the deterministic workflow posts, and it posts
  clamped, defanged fields (FR-8).
- **INV-6 One predicate each.** Path ownership and approval freshness are called from their
  existing implementations, never copied (the duplicate-predicate drift class).

## Decisions needed (Clarify)

1. **Which repos run it.** (a) This repo only, as dev-time machinery like ai-review **(rec)**;
   cost: adopters do not get the feature that the competitor check said is a differentiator,
   and they will not get it until a later spec. (b) Ship it as a scaffolded template now, dormant
   until opted in; cost: one more template in `ci-review-templates.ts` to keep in sync, and an
   adopter-facing model cost before we know the false-positive rate.
2. **How a merge finds its spec.** (a) Ownership paths only, with an explicit `SPEC-NNN` in the
   commit listed but not judged **(rec)**; cost: a spec that never declared `implements:`
   (T1/T2, or T3/T4 before Clarify) is never checked. (b) Also judge specs named in the commit
   or linked issue; cost: a commit that mentions a spec in passing pays for a model call and
   gets judged against a spec it does not implement.
3. **Share the trusted block with SPEC-216.** (a) One generic block for "approved spec text",
   used by both checks, introduced by whichever lands first **(rec)**; cost: the two specs are
   coupled in Plan, and the second one edits the first one's defang list. (b) A separate
   `approved_spec` tag; cost: two near-identical trusted channels, each needing its own defang.
4. **Where the comparison lives long-term.** (a) CI workflow now, with the agent-execute
   extension (Tier 1, DR-015) as a later home for a local run **(rec)**; cost: the founder sees
   findings only on GitHub, not in the editor. (b) Agent-execute only; cost: nothing runs
   unattended after merge, which is the case the issue is about.
5. **Promotion bar.** The bar FR-12 records for a later gate. (a) At least 30 judged merges
   with finding precision of 80% or more over the FR-10 marks **(rec)**; cost: at the current
   merge rate the bar may take weeks, and someone has to mark each finding true or false.
   (b) No bar now; decide when data exists; cost: the report can run indefinitely with no
   trigger to review it.
6. **What a `departs` result triggers.** (a) PR comment only **(rec)**; cost: a comment on a
   merged PR is easy to miss, so findings rely on someone reading the log. (b) Also file an
   `inbox` issue per `departs` result; cost: if precision is low, the founder's queue fills
   with false findings, against core tenet 1.
7. **Where the measurement log lives.** (a) A workflow artifact plus an append to a log file
   on a dedicated data branch **(rec)**; cost: a write to the repo from CI on every judged
   merge, needing a write token in that job. (b) Workflow artifacts only; cost: artifacts
   expire (90 days by default), so the FR-12 evidence can age out before the bar is met.
8. **Does a red post-merge run alert anyone.** (a) Yes, through the existing `main-red-watch`
   path **(rec)**; cost: a model or quota outage pages the same channel as a broken build.
   (b) No, the job summary only; cost: a broken check can sit unnoticed, the shape constitution
   invariant 2 forbids for gates (this is not a gate, but its silence still hides the signal).

## Out of scope

- Moving the check to before the merge, or making it required (FR-12).
- Path drift (#643). Design-scope (SPEC-216).
- Back-filling the check over already-merged history. It may be run by hand with
  `workflow_dispatch` (FR-1), but no sweep is specified.

## Follow-ups (tracked)

- The gate decision of FR-12: deferred until FR-10 evidence exists. Recorded here as the
  promotion bar of Clarify Q5, not as an issue, because it cannot change a decision within 30
  days.
