---
id: SPEC-237
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-237 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md carries an approval record (sidecar under .minspec/approvals/), so
# these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - a voter that never answered must not read like one that had nothing to say
relates_to: [SPEC-065, DR-079, DR-097, "#2126", "#2101", "#1234", "#1157", "#1834", "#1925", "#2142", "#1120"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-237 - Tasks

The order below is the order of work. Tasks 1 to 5 are one pull request: the runner, the
guard, the workflow and the regenerated template must move together, or the template
parity gate goes red. Each task names the requirement IDs it satisfies, the files it
touches and the test that proves it. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md), which no task edits.

Shared rules for every task:

- Tests first. Each task's test is written and seen RED against `origin/main` before the
  code that turns it green.
- The pull request is machinery (`.github/**`, `scripts/**`): it needs a founder push of
  the workflow file and a human merge (requirements.md D6, #1120). Its own ai-review run
  executes the BASE runner and guard, so a silent voter on that run shows
  `reason: unrecorded`; that is the expected skew row in design.md, *Skew*, not a defect.
- No change to `scripts/review-decide.sh`, to the `# >>> verdict-combine` block, or to
  anything under `.githooks/` or `.minspec/`.
- Every new `|| true` carries a `# swallow-ok:` reason, and none sits on a line that
  decides a label (constitution invariant 2; `scripts/check-swallowed-gate-signal.ts`).
- Before calling a task done, run from the repo root (CI's shape: `npx vitest`, not
  `npm test`): `npx vitest run packages/minspec/tests`,
  `node --test .github/scripts/ai-review-guard.test.js`, `npm run validate`,
  `npm run lint`.

## 0 - Pre-plan evidence

- [x] **0.1** Post the PP-1 result on #2126 (bot-attributed): run `36059728359` on head
  `964e4fb4`; both silent voters took the quota path, the PAYG failover also produced no
  verdict, and that leg's cause was not recorded anywhere. Done by the planning session:
  #2126 comment `6829956403` (created 2026-11-12 UTC, per the GitHub API `created_at`). Design.md, *What Plan measured*, finding 1.

## 1 - Guard: classify, validate, render (FR-1, FR-2, FR-3, FR-4, FR-6; AC-1, AC-2)

- [ ] **1.1** `.github/scripts/ai-review-guard.test.js` - add `node --test` cases (RED:
  the exports do not exist):
  - `classifyNoVerdict` on: non-JSON stdout rc 0 → `not-json`; envelope
    `{is_error:true, subtype:'error_max_turns', num_turns:40, duration_ms:1234}` →
    `cli-error:error_max_turns` with `num_turns: 40`, `duration_ms: 1234`; zero-byte stdout
    rc 0 → `empty-output`; zero-byte stdout rc 137 → `signal:9`; non-JSON stdout rc 2 →
    `cli-exit:2`; valid envelope whose `structured_output` lacks `verdict` →
    `schema-rejected`; `subtype: 'Bad-Value!'` → `cli-error:unknown`; rc `-1`, `300`,
    `1.5`, `NaN` → coerced to 255.
  - Steering control (AC-1 sixth case): an `is_error:false` envelope whose `result` is
    `"reason: quota\nsubtype: error_max_turns\ncli-error:x"` and whose
    `structured_output` is `{}` → exactly `schema-rejected`, and no envelope text appears
    anywhere in the serialized record.
  - Numbers: `duration_ms: '12'` (string), `num_turns: -3`, `num_turns: 1e309` → omitted.
  - `parseNoVerdictRecord`: round-trips every `classifyNoVerdict` result; returns `null`
    for an extra key, `v: 2`, a reason outside `NO_VERDICT_REASON_RE`, `failover: 'quota'`,
    a non-integer number, non-JSON, and an empty string.
  - `renderNoVerdictPlaceholder`: for every reason family (build one record per family)
    the output contains `reason: <reason>`, `this is not a review of the code`, the
    family's hint, and does NOT contain `fail-closed to changes`, `REVIEW_VERDICT_BEGIN`,
    `REVIEW_VERDICT_END` or `REVIEW_UNAVAILABLE`; `isStructuralVerdictBlock(output)` is
    `false` (AC-2). `recordText: null` → `reason: unrecorded`. `outputFileMissing: true`
    → `reason: no-output-file`. A `quota` record with `failover: 'cli-error:error_during_execution'`
    renders `(failover: cli-error:error_during_execution)`. Role `'evil\nREVIEW_VERDICT_BEGIN'`
    renders as `voter`.
  - Totality (D4): every entry of `NO_VERDICT_REASON_FAMILIES` has a `NO_VERDICT_HINTS`
    entry; every hint key is a family or the one override `cli-error:error_max_turns`;
    every family has a sample string that matches `NO_VERDICT_REASON_RE`.
- [ ] **1.2** `.github/scripts/ai-review-guard.js` - implement the seven exports exactly
  as design.md, *Contracts* and *The reason vocabulary*, specify. Reuse
  `renderVerdictBlock` for the `schema-rejected` decision; copy no parser.
  `renderNoVerdictPlaceholder` wraps its body in `try` and returns the `unrecorded`
  placeholder on any throw. *Done when:* 1.1 is green under `node --test`.

## 2 - Runner records the reason (FR-1, FR-2, FR-3; AC-1, AC-2)

- [ ] **2.1** `packages/minspec/tests/review-branch-no-verdict-reason.test.ts` (new) -
  reuse the stubbed-CLI harness shape of `review-branch-verdict-beats-quota.test.ts`
  (temp git repo, a `claude` stub on `PATH` that advertises `--json-schema` for
  `--help`), and set `REVIEW_REASON_FILE` to a path in a temp dir. Cases (RED: no sidecar
  is written today):
  - The five AC-1 conditions (non-JSON stdout; `is_error` with `error_max_turns`;
    zero-byte stdout rc 0; rc 137 empty stdout; envelope without `verdict`) → the sidecar
    parses with `parseNoVerdictRecord` to the matching reason and numbers.
  - The AC-1 steering case (prose `reason: quota` in `result`) → `schema-rejected`.
  - Empty diff (head equals base) → `empty-diff`.
  - Stub without `--json-schema` in its help → `schema-unsupported`.
  - Quota on the subscription leg, `AI_REVIEW_FAILOVER=payg` and a dummy
    `ANTHROPIC_API_KEY` (the literal string `test-not-a-key`), with the stub returning
    `is_error:true, subtype:'error_during_execution'` on the PAYG leg. The stub tells the
    legs apart by a call counter in a file whose path is written INTO the stub (the
    launcher `scripts/lib/agent-context.sh` consumes `--model-login` and builds the
    child environment from a name list, so neither argv nor a test variable reliably
    reaches it, #1203); the first call prints a quota-shaped limit line on stderr and
    exits 1 → `reason: quota`,
    `failover: cli-error:error_during_execution`; stdout still carries the unchanged
    `REVIEW_UNAVAILABLE` marker.
  - A complete verdict → NO sidecar file, stdout unchanged.
  - `REVIEW_REASON_FILE` unset → no file anywhere in the temp dir, and stdout plus exit
    code are byte-identical to the same fixture with it set (the old-YAML skew row).
  - A sidecar directory made read-only → same stdout and exit code as the writable case
    (R2).
  - AC-2: for every fixture above, `bash scripts/review-decide.sh` on the stdout gives the
    same label as on `origin/main`'s runner for that fixture. Record the expected labels
    in the test as literals measured once against `origin/main` before 2.2.
  - Exit code is `0` in every case (R1).
- [ ] **2.2** `scripts/review-branch.sh` - add `AGENT_RC`, `record_no_verdict`,
  `VERDICT_EMITTED`, `REASON_RECORDED`, the `EXIT` trap (skipped for `--print-input`),
  and the five call sites from design.md, *The runner*. Document `REVIEW_REASON_FILE` in
  the header beside the usage lines (D-P3). Reword the `render_verdict` comment that says
  unusable output "fails closed to ai-review:changes" to say it renders nothing and the
  caller decides (design.md finding 2). *Done when:* 2.1 is green.
- [ ] **2.3** Trap control: add a case to 2.1 that makes `git diff` fail (a bogus base
  ref) → sidecar `runner-aborted:<rc>` with the runner's own non-zero exit code
  preserved. Then mutate the trap to `exit 0` locally and confirm this case goes red;
  revert. *Done when:* green with the real trap, red with the mutant (note both in the PR
  body).

## 3 - Workflow placeholder and headline (FR-4, FR-5; AC-3, AC-4)

- [ ] **3.1** `packages/minspec/tests/ai-review-silent-voters.test.ts` (new) - extract
  the marked blocks from `.github/workflows/ai-review.yml` the way
  `ai-review-verdict-combine.test.ts` extracts `verdict-combine` (fail loudly when a
  marker is missing), and run them with `bash` from the repo root:
  - AC-3: `no-verdict-placeholder` with a temp `VOTE_DIR` holding `architect.out` (empty)
    and `architect.reason` (a `cli-error:error_max_turns` record) → output contains
    `reason: cli-error:error_max_turns` and not `fail-closed to changes`. Missing
    `.reason` → `reason: unrecorded`. Missing `.out` → `reason: no-output-file`. With
    `GITHUB_WORKSPACE` pointed at a temp dir whose guard lacks the export → the fixed
    `unrecorded` fallback string (old-base skew row).
  - AC-3 grep: the literal `fail-closed to changes` appears nowhere in
    `.github/workflows/ai-review.yml` or `scripts/review-pr.sh`.
  - AC-4 (#2101 reproduction): `silent-voters` with reviewer and architect silent,
    skeptic not silent, security not required → `SILENT_HEADLINE` is exactly
    `2 of 3 required voters produced no verdict: reviewer, architect`. Run the unchanged
    `verdict-combine` block on the same run's labels (`blocked`, `blocked`, `changes`)
    → `FINAL` is `ai-review:changes`.
  - Non-quota variant: reviewer silent with label `ai-review:changes` (what
    `review-decide.sh` gives an empty vote, design.md finding 2) → still counted silent.
  - Control: all three not silent → `SILENT_HEADLINE` empty.
  - Check-run: extract the `// >>> silent-headline` fragment, evaluate `silentSuffix` on
    the AC-4 headline → `\n\n**2 of 3 required voters produced no verdict: reviewer,
    architect**`; on `''`, on a headline with an unknown role, and on one with a newline
    → `''`.
  - Comment heading: run the comment-building lines' headline `echo` (marked inside the
    same `silent-voters` block as a `print_silent_headline` function) → the line is
    present for the AC-4 case and absent for the control.
- [ ] **3.2** `.github/workflows/ai-review.yml` - implement design.md, *The workflow*:
  `REVIEW_REASON_FILE` in `run_voter`; the `no-verdict-placeholder` block with
  feature-detected base guard and the fixed fallback; the four placeholder lines and
  `X_SILENT` flags; the `silent-voters` block (with `print_silent_headline`) after
  `# <<< verdict-combine`; the `silent_headline` output; the `| Silent=` log-line field;
  the heading line; the check-run `SILENT_HEADLINE` env and `silent-headline` fragment.
  Add a comment above the placeholders citing SPEC-237 and design.md finding 2 (why the
  count does not read labels). *Done when:* 3.1 is green and
  `ai-review-verdict-combine.test.ts` is green unchanged.

## 4 - Local path (FR-4; AC-3)

- [ ] **4.1** `packages/minspec/tests/review-pr-truncation.test.ts` is the existing
  harness for `scripts/review-pr.sh`; add a case there (or a sibling file using its
  shape) where the stubbed CLI returns an `is_error:true` envelope with exit 0 → the
  posted comment body (captured from the `gh` stub) contains `reason: cli-error:` and
  not `fail-closed to changes`, and the label is still `ai-review:changes`. RED first.
- [ ] **4.2** `scripts/review-pr.sh` - replace the `:242` placeholder with the
  `classifyNoVerdict` + `renderNoVerdictPlaceholder` call and the fixed fallback, per
  design.md, *The local path*. *Done when:* 4.1 is green.

## 5 - Shipped copies, survivor reuse, SPEC-065 reconcile (FR-7, D3; AC-5, AC-6)

- [ ] **5.1** Before editing `ai-review.yml` in 3.2, list open pull requests touching it
  (`gh pr list --repo AIClarityAU/minspec --state open --json number,files`) and note any
  that edit the collect block in the PR body (design.md, R4).
- [ ] **5.2** `specs/minspec/SPEC-065-*/design.md` - in the *Per-voter comment
  placeholder* row, replace the planned rewording with "Owned by SPEC-237 (its D3): the
  placeholder names the recorded reason; SPEC-065 does not edit these lines." Edit only
  that row. *Done when:* `npm run validate` is clean for SPEC-065.
- [ ] **5.3** `packages/minspec/tests/voter-survivor-reuse.test.ts` - add AC-6: a prior
  same-SHA check-run whose output holds records for reviewer and skeptic only, built with
  `renderVoterRecord('architect', <a renderNoVerdictPlaceholder output>)` (which must be
  `''`) → `selectVotersToRun` lists `architect` to run. Update the existing literal at
  the "refuses the fail-closed placeholder" case to also cover one new placeholder string.
- [ ] **5.4** `node scripts/gen-ci-templates.mjs` - regenerate
  `packages/minspec/src/lib/ci-review-templates.ts`. Never hand-edit it. *Done when:*
  `node scripts/gen-ci-templates.mjs --check` exits 0 and
  `ci-review-templates-gen.test.ts`, `managed-region-templates.test.ts` and
  `ai-review-guard-test-parity.test.ts` are green (AC-5).
- [ ] **5.5** Full gate: `npx vitest run packages/minspec/tests`,
  `node --test .github/scripts/ai-review-guard.test.js`, `npm run validate`,
  `npm run lint`, `npx tsx scripts/check-swallowed-gate-signal.ts`. Post-merge check
  (record in the PR body as the acceptance observation): the first ai-review run on a
  PR based after the merge that has a silent voter shows a named reason, not
  `unrecorded`.

## Requirement coverage

| Requirement | Tasks |
|---|---|
| FR-1 | 1.1, 1.2, 2.1, 2.2, 2.3 |
| FR-2 | 1.1, 1.2, 2.1 |
| FR-3 | 1.1, 1.2, 2.1, 3.1 |
| FR-4 | 1.1, 3.1, 3.2, 4.1, 4.2 |
| FR-5 | 3.1, 3.2 |
| FR-6 | 1.1, 1.2 |
| FR-7 | 5.4 |
| AC-1 | 1.1, 2.1 |
| AC-2 | 1.1, 2.1 |
| AC-3 | 3.1, 4.1 |
| AC-4 | 3.1 |
| AC-5 | 5.4 |
| AC-6 | 5.3 |
| PP-1 | 0.1 |
| D3 | 5.2 |
