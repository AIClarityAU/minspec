---
id: SPEC-078
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-078 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
relates_to: [DR-063, DR-079, SPEC-074, "#2178", "#1630", "#1204", "#3250"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-078 - Tasks

The order below is the order of work. Each task is one pull request, ends with the full
suite green, and names the requirement IDs it satisfies, the files it touches and the test
that proves it. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md), which no task edits.

Rules for every task:

- Write the task's `describe` block in `packages/minspec/tests/quota-evidence-witness.test.ts`
  first, run it against the unchanged code, and paste the red output into the pull request
  (FR-8). A test that is green before the fix is not done.
- The tasks run in order, one at a time: all four add to the same test file.
- Any change to `scripts/review-branch.sh`, `.github/workflows/ai-review.yml` or
  `.github/workflows/ai-review-retry.yml` is followed by `node scripts/gen-ci-templates.mjs`,
  and the regenerated `packages/minspec/src/lib/ci-review-templates.ts` is committed in the
  same pull request. Never hand-edit it.
- Run `npx vitest run` (what CI runs), `npm run typecheck` and `npm run validate` before
  calling a task done.
- Every task touches `scripts/` or `.github/`, so its pull request is review machinery and
  merges by a human.
- After a code change, sweep the comments around it: the `#1630` comment in
  `emit_unavailable` and the retry's `NONE` comment describe today's behaviour and must say
  the new one.

## 1 - The classifying attempt's streams survive the failover (FR-1; AC-1, AC-2)

- [ ] **1.1** `packages/minspec/tests/quota-evidence-witness.test.ts` (new) - the harness from
  design.md, *Testing*: temp git repo, stub `claude` that answers `--help` and picks its
  output by which login it was handed. Include the control: a stub that prints the login
  variable it saw, proving the subscription and PAYG launches are told apart. Then AC-1
  (subscription stderr `Claude AI usage limit reached`; `AI_REVIEW_FAILOVER=payg`,
  `ANTHROPIC_API_KEY` set; PAYG exits 1 with empty stdout and stderr
  `Credit balance is too low`) and AC-2 (PAYG writes nothing). Both expect
  `evidence: captured`, a detail containing the subscription limit line, and
  `classified_via: stderr(loose)` with the subscription attempt's byte counts.
- [ ] **1.2** `scripts/review-branch.sh` - the snapshot from design.md, *The snapshot*
  (`CLASSIFY_ERR`, `CLASSIFY_OUT_TEXT`, `CLASSIFY_OUT_BYTES`, `CLASSIFY_BRANCH`, and the
  `PAYG_*` copies with `PAYG_RAN`); `emit_unavailable` reads the snapshot instead of `$1`
  and the globals; the detail appends the labelled PAYG lines. The `captured`/`NONE`
  decision still uses today's grep in this task; task 2 replaces it.
  *Done when:* AC-1 and AC-2 are green, the control passes, and
  `review-branch-verdict-beats-quota.test.ts` is unchanged and green.

## 2 - One classifier decides `captured` (FR-2, FR-3; AC-3, AC-6, AC-8)

- [ ] **2.1** `packages/minspec/tests/quota-evidence-witness.test.ts` - AC-3 (no failover;
  stderr only `Too Many Requests`, and separately only `insufficient credit`): expect
  `evidence: captured` and a non-empty detail. AC-8: the temp-tree copy with the sentinel
  guard wrapper from design.md, *Testing*; stderr `QZX-SENTINEL-7` expects `captured`.
  AC-6 in its FR-3 form: a stub that exits 1 with both streams empty, and one whose stderr
  is a non-quota crash (`TypeError: x is not a function`), each produce no
  `REVIEW_UNAVAILABLE_BEGIN` and print the fail-closed line.
- [ ] **2.2** `scripts/review-branch.sh` - add `quota_rule <err> <out_text>`; rewrite
  `quota_failure` to call it on the live globals and add `classified_quota` calling it on
  the snapshot; `emit_unavailable` decides `captured` by `classified_quota`; the grep only
  picks detail lines, with the first-three-lines fallback. Keep the `NONE` arm and its exact
  text.
- [ ] **2.3** In the pull request body, record the FR-3 caller enumeration: every call of
  `emit_unavailable` in the file, and the condition each is reached under.
  *Done when:* AC-3, AC-6 and AC-8 are green; reverting 2.2's decision line to the grep
  turns AC-3 and AC-8 red (paste the output).

## 3 - The blocked comment carries every blocked voter's evidence (FR-4; AC-4; DQ-2)

- [ ] **3.1** `packages/minspec/tests/quota-evidence-witness.test.ts` - extract and run the
  `evidence-aggregate` region (the extractor throws if its markers are missing). Cases:
  AC-4 (reviewer `pass`; security `blocked` with `evidence: captured` and a CLI line
  `resets 8:40am (UTC)`): the rendered blocked body contains security's `evidence: captured`
  and `<!-- ai-review-reset: ... -->`. Rule A: two blocked voters, one `captured` and one
  `NONE`, give `PANEL_EVIDENCE=NONE` and the missing marker names the `NONE` voter; both
  `captured` give `captured`. An unreported voter (empty label, empty output) with no other
  block gives no `evidence:` line at all. Two stated resets give the later one. Placement:
  on a body with two voter blocks, `capture("evidence: (?<e>NONE|captured)")` run by `jq`
  returns the aggregated value.
- [ ] **3.2** `.github/workflows/ai-review.yml` - the `# >>> evidence-aggregate` /
  `# <<< evidence-aggregate` region with `aggregate_unavailable` after `verdict-combine`;
  the blocked branch of the body builder prints the aggregated line first, the
  `ai-review-evidence-missing` marker when `NONE`, `PANEL_RESET` as the reset marker, and
  `PANEL_DETAIL` in the `<details>` section. Remove the reviewer-only `RESET_ISO` and `det`
  computations they replace.
  *Done when:* the 3.1 cases are green and `ai-review-verdict-combine.test.ts` is unchanged
  and green.

## 4 - A declined retry says why, on the PR (FR-5, FR-6, FR-7; AC-5, AC-6, AC-7; DQ-1)

- [ ] **4.1** `packages/minspec/tests/quota-evidence-witness.test.ts` - run the
  `retry-loop` region with the stub `gh` from design.md, *Testing*. AC-5: a blocked PR whose
  latest blocked comment says `evidence: captured` is re-run (`run rerun` logged), and gets
  no decline comment. AC-6: `evidence: NONE` adds `needs-human-review` and is not re-run.
  AC-7: the same run posts one comment that names the voter from
  `ai-review-evidence-missing`, says it will not be retried automatically and what to do
  next, and writes a step-summary line naming the PR. Idempotency: a second tick with the
  declined marker for the same run id posts no second comment but still writes the summary
  line. INV-4: a comment with no `evidence:` line is re-run. The decline body contains none
  of `evidence: NONE`, `evidence: captured`, `<!-- ai-review-reset:`.
- [ ] **4.2** `.github/workflows/ai-review-retry.yml` - bracket the step's script
  `# >>> retry-loop` / `# <<< retry-loop`; in the `NONE` branch add the run lookup, the
  `ai-review-retry-declined` check, the comment and the summary line from design.md,
  *ai-review-retry.yml*. The `NONE` test, the label self-heal and the missing-marker
  fall-through stay as they are.
  *Done when:* the 4.1 cases are green and the four tasks' blocks all pass together.
