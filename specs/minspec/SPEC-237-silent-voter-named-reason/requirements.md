---
id: SPEC-237
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - a voter that never answered must not read like one that had nothing to say
aspects: [ai-review, voters, no-silent-gate, fail-closed, observability, machinery]
depends_on: []
relates_to: ["#2126", "#535", "#1680", "#1157", "#1470", "#1720", "#1234", "#1630", "#2142", "#1120", DR-079, DR-097, SPEC-065, SPEC-182]
implements: none
implements_reason: >-
  Specify phase only. The owned files are settled at Plan, after Decisions D1 to D3; the
  likely touch set is listed under affects below.
# Modified but owned elsewhere. Every path is machinery, so the eventual change is a
# founder push plus a human merge (#1120), not an App push.
affects: [scripts/review-branch.sh, .github/workflows/ai-review.yml, .github/scripts/ai-review-guard.js, scripts/review-pr.sh, scripts/gen-ci-templates.mjs, packages/minspec/src/lib/ci-review-templates.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-237: An ai-review voter that produced no verdict says why, and the run says how many never answered

> **This is a SPECIFICATION ONLY.** Written for issue #2126 (two of three ai-review voters
> emitted no verdict block on a 267-line markdown diff). Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves
> it. No decision record is created at this stage; see D5.

## In plain terms

Each ai-review voter either returns a verdict block or returns nothing. When it returns
nothing, the pull-request comment shows one fixed sentence, "(architect emitted no verdict
block - fail-closed to changes)", whatever actually happened. The reason does exist: the
runner prints it to the Actions log. It never reaches the comment, the label or the
check-run.

This spec makes three changes:

1. The runner records a short, closed-vocabulary reason for every no-verdict outcome.
2. The comment placeholder shows that reason.
3. The run headline states how many required voters never answered, even when another
   voter's real objection decides the label.

The fail-closed behaviour itself does not change.

## Context: what the code does today (verified on this branch, base `7a200191`)

**Where the reason is lost.** `scripts/review-branch.sh` ends in one of three ways:

| Exit path | stdout (the vote file) | Reason recorded where |
|---|---|---|
| Verdict rendered (`:493-495`, `:507-509`) | the verdict block | n/a |
| Quota or transient (`:500-515`) | a `REVIEW_UNAVAILABLE` marker with `reason: quota` and byte counts (`:418-446`) | stdout, so the comment can show it |
| Any other failure (`:518-523`) | **nothing** | stderr only: `failed (non-quota)` plus the raw envelope and stderr |

The third path also covers the empty-diff exit at `:96-97`. That exit writes nothing to
stdout and prints a different stderr line.

`render_verdict` (`:390-396`) returns empty for several distinct conditions, and all of
them collapse into that third path. `parseCliVerdict` (`ai-review-guard.js:172-182`)
returns `''` for each of these: stdout is not JSON, the envelope is not an object,
`is_error === true`, or `renderVerdictBlock(structured_output)` rejects the payload. The
CLI exit code `rc` is captured in `run_reviewer` (`:286`, `:301`, `:320`). Nothing
downstream reads it, because `run_reviewer subscription || true` (`:492`) discards it.

**Where the silence is displayed.** `ai-review.yml:774-804` substitutes a fixed
placeholder whenever `extract_block` comes back empty. The wording is the same for every
cause, and it still says "fail-closed to changes".

That wording has been **false since #1234**. An empty or unrecognised voter label now
sets `ANY_UNREPORTED` (`:865`), and the outcome is `ai-review:blocked`, not `changes`
(`:870-871`). The outcome is `changes` only when some other voter objected. A second copy
of the stale wording is at `scripts/review-pr.sh:242`. SPEC-065's design.md (row at its
`:753`) already plans to reword the four workflow copies to "no code verdict was read".

**Where the count is lost.** In the combine block (`ai-review.yml:846-873`),
`ANY_CHANGES` takes precedence over `ANY_UNREPORTED`. That precedence is correct: an
outage must never hide a finding (#1234). But no other output reports `ANY_UNREPORTED`.
The comment heading shows `FINAL` only (`:912`). The log line at `:907` shows each
voter's label as `<none>`, which says the voter is absent but not why.

PR #2101 was the case the issue reports: the skeptic said `changes`, two voters were
silent, so the label was `ai-review:changes`. That label is correct. The fact that two of
the three lenses never looked is visible only in two skimmable placeholder lines.

**What this rules out as the cause of #2101, and what it does not.**

- **Not a job timeout.** A grep of `ai-review.yml` for `timeout-minutes` finds nothing,
  so the job runs under GitHub's 6-hour default.
- **Possibly a CLI-internal limit.** For example, an envelope with `is_error: true` and a
  max-turns subtype. I believe this is plausible but have not verified it.
- **Not checkable offline.** The real cause of #2101 is in that run's Actions log, under
  the `voter stderr - reviewer` and `voter stderr - architect` groups that
  `ai-review.yml:763-769` replays. This dispatch has no network access, so it did not
  read that log. See Pre-plan task PP-1.

## Functional requirements

- **FR-1 Every no-verdict exit names a reason.** Every `review-branch.sh` exit that
  produces no verdict block MUST record exactly one reason from a closed set. The set
  below is a starting point; Plan may refine names but not open the set. Each reason
  must come from something the harness observed, never from the agent's prose:
  - `empty-diff`: the `:96` path.
  - `cli-exit:<rc>`: the CLI exited non-zero and stdout carried no usable envelope.
    If `rc` is 128 or more, the reason is `signal:<rc-128>`.
  - `empty-output`: stdout was zero bytes and `rc` was 0.
  - `not-json`: stdout was non-empty but not a JSON object.
  - `cli-error:<subtype>`: the envelope had `is_error: true`. `<subtype>` is the
    envelope's `subtype` field, restricted to `[a-z_]{1,40}`. Anything else becomes
    `unknown`.
  - `schema-rejected`: the envelope was fine, but `structured_output` was missing or
    `renderVerdictBlock` refused it.
  - `guard-missing`: the guard module was not found, so `render_verdict` returns at
    `:391`.
  - `quota`: the existing path, which keeps its `REVIEW_UNAVAILABLE` marker unchanged.
  - `no-output-file`: the voter process left no vote file. This reason is recorded by
    the workflow, not by the runner.

- **FR-2 Numeric evidence travels with the reason.** Alongside the reason, the runner
  records four numbers, each re-typed as a finite integer: `rc`, `stdout_bytes`,
  `stderr_bytes` and, when the envelope parses, `duration_ms` and `num_turns`.
  `emit_unavailable` (`:434-445`) already does this for byte counts; this extends it.
  No text from the envelope's `result`, from stderr, or from the diff may enter the
  record.

- **FR-3 The reason is carried on a channel the agent cannot write.** Where the reason
  is stored is decided in D1. Whatever the channel, it MUST be impossible for agent
  output to mint or override a reason. That is the authenticity property DR-079
  established for verdicts. The reason MUST also never be read as a verdict:
  `review-decide.sh`'s labels and `isStructuralVerdictBlock`
  (`ai-review-guard.js:618-634`) stay unchanged in what they accept.

- **FR-4 The placeholder shows the reason and stops lying.** All four voter placeholders
  in `ai-review.yml` and the one in `review-pr.sh:242` MUST include the FR-1 reason and
  the FR-2 numbers. They MUST drop the phrase "fail-closed to changes". Suggested shape:
  `(architect produced no verdict - reason: cli-error:error_max_turns · rc=1 · turns=40 ·
  stdout=812B - this is not a review of the code)`. The placeholder MUST NOT contain
  `REVIEW_VERDICT_BEGIN`, `REVIEW_VERDICT_END` or `REVIEW_UNAVAILABLE`. That keeps it
  non-structural, so survivor reuse (DR-097 condition 5) re-runs the voter instead of
  pinning the placeholder.

- **FR-5 The run headline counts the silent voters.** When one or more *required* voters
  have no verdict, three places MUST state "N of M required voters produced no verdict"
  and name the roles:
  - the comment heading, directly under the `## 🤖 AI review` line;
  - the step log line at `:907`;
  - the `ai-review` check-run summary.

  This applies whatever `FINAL` is, so it covers the `changes` case that #2101 hit. The
  label precedence `changes > blocked > pass` does not change (see D2 for the label
  itself).

- **FR-6 Reasons tell the author what to do.** Each reason carries a one-line author hint
  saying whether to re-run the same head or change the diff. Suggested mapping:
  - **Re-run:** `signal`, `cli-exit`, `empty-output`, `not-json` and `quota` look like
    transport or infrastructure problems.
  - **Change the diff or escalate:** `schema-rejected` and `cli-error:error_max_turns`
    may depend on content.
  - **Empty diff:** `empty-diff` points to #1680's remedy.

  The hint is fixed text keyed on the reason and is never generated.

- **FR-7 Shipped copies stay in lockstep.** The workflow and guard are managed templates
  (`scripts/gen-ci-templates.mjs` regenerates `ci-review-templates.ts`, which stores the
  verbatim workflow base64-encoded). The regenerated template and its parity test are
  part of the change.

## Acceptance criteria

Each AC is red on today's code and green after the change.

- **AC-1 (FR-1, FR-2)** A `review-branch.sh` test with a stubbed CLI covers each
  condition: non-JSON stdout, `is_error: true` with subtype `error_max_turns`, zero-byte
  stdout with rc 0, rc 137 with empty stdout, and a valid envelope whose
  `structured_output` lacks `verdict`. Each case yields the matching FR-1 reason plus the
  numbers. A sixth case puts the literal text `reason: quota` and a `subtype`-shaped
  string inside the envelope's `result`; the recorded reason is unchanged, which proves
  agent prose cannot steer it.
- **AC-2 (FR-3)** The `review-decide.sh` label is byte-identical before and after for
  every AC-1 fixture. `isStructuralVerdictBlock` returns `false` for every new
  placeholder string.
- **AC-3 (FR-4)** An executable-glue test runs the collect-verdicts block verbatim, the
  same way `ai-review-verdict-combine.test.ts` runs the combine block. It asserts that a
  silent architect's placeholder contains `reason:` and does not contain
  `fail-closed to changes`. A grep test asserts the phrase appears nowhere in
  `ai-review.yml` or `review-pr.sh`.
- **AC-4 (FR-5)** This reproduces #2101: skeptic `changes`, reviewer and architect
  silent. The test asserts that `FINAL` is still `ai-review:changes`, and that the
  comment heading and check-run summary both contain "2 of 3 required voters produced no
  verdict" and name `reviewer, architect`. A control with three verdicts shows no such
  line.
- **AC-5 (FR-7)** The managed-template parity test passes on the regenerated template.
- **AC-6 (survivor reuse)** In `voter-survivor-reuse.test.ts`, a prior run whose
  architect record is the new placeholder still selects the architect to re-run.

## Invariants this must not break

- **Constitution invariant 2 (no silent gate).** This change exists to serve it. A silent
  voter still fails the gate closed, and can never contribute `pass`. The change only
  makes the failure *legible*. No new `|| true` may sit on the path that decides a label.
  The reason channel is diagnostic: if it is missing or unreadable, the placeholder shows
  `reason: unrecorded` and the label is unchanged. It never fails open.
- **Invariant 1 (offline).** Not affected. This is CI-only, and the extension makes no
  network call.
- **Invariant 3 (blast radius).** The workflow and guard ship to adopters through the
  managed templates. They stay inside the blast radius because adopters opt in through
  `.minspec/`.
- **Untrusted-input discipline (#1157, #1470, DR-079).** No agent- or diff-derived text
  is added to the comment, log line or check-run beyond what is shown today. The reason
  comes from a closed vocabulary, and the numbers are re-typed. No new protocol token is
  introduced that a voter quoting the machinery could trip. If D1 chooses an in-band
  marker, that choice must show it does not reopen #1157.
- **DR-097 condition 5.** A placeholder is never a reusable verdict.

## Out of scope

- **Making voters fall silent less often.** That depends on the cause found in PP-1. If
  it is a CLI turn limit or a content-shaped failure, the fix is a separate issue against
  the voter prompt or CLI arguments.
- **Automatically re-running a silent voter.** DR-097 explicitly left that to a human
  trigger. Survivor reuse (#2142) already makes a manual re-run cheap.
- **#535 (security voter on large diffs) and #1680 (empty diff reads as three outages).**
  Both benefit from FR-1, because their reasons become `cli-*` and `empty-diff`
  respectively. Neither is closed by this spec.

## Pre-plan task

- **PP-1 Read the #2101 run log before Plan.** Read the Actions log for the ai-review run
  on head `964e4fb4` (comment 2026-09-24T21:12:09Z), in the `voter stderr - reviewer` and
  `voter stderr - architect` groups. Record the actual CLI envelope or error on #2126. The
  log is within GitHub's default 90-day retention until about 2026-12-23. This is root
  cause before fix (triage rule 0). It confirms whether FR-1's vocabulary would have
  named this instance. If it would not, the set is incomplete and Plan extends it.

## Decisions needed (Clarify)

All 5 decisions (D1 to D5) are answered, not ratified: an agent session selected, for each, the
option this document already recommended. No human chose them, and no delegation covers
authoring Clarify answers. Delegation DLG-001 (DR-108) made none of these selections and covers
spec approval and engineering-DR acceptance only. An agent-recorded selection carries no
consent, whoever prompted it. It is ratified only by approval of this spec, the founder's or the
bot's under DLG-001, and that approval may overturn it. D6 is not a choice.

- **D1 - Reason channel.**
  - **(a) Sidecar file (rec).** The runner writes `<vote>.reason` next to its stdout,
    with the path passed by the workflow. `review-decide.sh` is untouched, and no new
    token enters the stream that voters' prose can echo. The cost: the runner gains a
    second output contract, and `review-pr.sh` (local path) needs the same plumbing.
  - **(b) In-band `REVIEW_NOVERDICT` marker on stdout,** modelled on
    `REVIEW_UNAVAILABLE`. One stream, and it matches the existing pattern. The cost is a
    third protocol token that every extractor, counter and `defangProtocolTokens` must
    learn, which is the #1157 / #1470 hazard surface this repo keeps paying for.
  **Recorded selection: Option (a),** a sidecar file: the runner writes `<vote>.reason` next
  to its stdout, with the path passed by the workflow.
- **D2 - Label when a real objection coexists with silent voters.**
  - **(a) Keep `ai-review:changes` and add the FR-5 headline (rec).** The objection is
    real and actionable now, and the author's next push re-runs every voter anyway. The
    cost: `ai-review-retry` does not pick the PR up, so if the author agrees with the
    finding and pushes nothing, the silent lenses stay unread.
  - **(b) A new `ai-review:incomplete` label (or a second label beside `changes`).** The
    state shows up in label filters. The cost is a new label across the guard,
    `ready-to-merge`, retry and the extension's PR-review node, which is the widest diff
    of the three options.
  - **(c) Escalate to `blocked`.** Rejected in advance: it hides a real finding behind
    "could not run", which is exactly what #1234 removed.
  **Recorded selection: Option (a),** keep `ai-review:changes` and add the FR-5 headline.
- **D3 - Ownership of the placeholder wording versus SPEC-065.**
  - **(a) This spec owns all five placeholder copies (rec).** SPEC-065's design.md row
    at its `:753` defers to this spec at SPEC-065's next Plan edit. The cost is one
    cross-spec edit that someone must remember. Spec-alignment would flag it, but only
    if both specs' `affects:` overlap is checked.
  - **(b) SPEC-065 keeps the wording and this spec only adds the reason suffix.** No
    cross-spec edit, but two specs then edit the same five lines, with a merge-order risk.
  **Recorded selection: Option (a),** this spec owns all five placeholder copies.
- **D4 - Are the FR-6 hints worth the text?** **(rec) yes:** the issue asks for exactly
  this ("retry the same head or change the diff"). The cost is a mapping table that can
  go stale when a reason is added. Make it total over the FR-1 set, with a test that
  fails on an unmapped reason.
  **Recorded selection: Option (yes),** the FR-6 hints are worth the text, with a mapping
  total over the FR-1 set and a test that fails on an unmapped reason.
- **D5 - DR?** **(rec) no DR.** Every choice above can be reverted in under a day: no
  data migrates, and the label set is unchanged under D2(a). The cost: if D2 resolves to
  (b), that adds a label adopters will filter on, and Clarify should then require a DR.
  **Recorded selection: Option (no DR),** no DR, since every choice above can be reverted in
  under a day.
- **D6 - Delivery (not a choice; stated so it is not a surprise).** Every touched path
  is machinery (`.github/**`, `scripts/**`, `ci-review-templates.ts`). The App cannot
  push `.github/workflows/` (#1120), so the implementation PR needs a founder push and a
  human merge.

## Follow-ups (tracked)

- PP-1 lands as a comment on #2126 before Plan.
- SPEC-065 design.md row at `:753` is reconciled at its next edit if D3 resolves to (a).
  This is tracked here and on #2126, and is carried into this spec's tasks.md at Plan.
