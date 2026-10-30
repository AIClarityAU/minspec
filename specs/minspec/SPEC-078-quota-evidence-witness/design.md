---
id: SPEC-078
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-078 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
relates_to: [DR-063, DR-079, SPEC-031, SPEC-074, "#2178", "#1630", "#1204", "#1086", "#3250"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-078 - Design: the retry sees the quota evidence the reviewer saw

Plan for [requirements.md](requirements.md), built under its four recorded Clarify
selections: DQ-1 option A (decline notice once, on transition), DQ-2 rule A carried by
mechanism C (one aggregated marker, retry only when every blocked voter captured
evidence), DQ-3 option A (`reason: quota`, `evidence: captured`, PAYG failure shown in the
detail) and DQ-4 option A (no log-reading second witness; fix the producer). Citations of
"today" are against `origin/main` `281774d9`, the commit this plan was written on. The
requirements cite older line numbers; the ones below were re-read. New code is named by
symbol, because its line numbers will move.

## Approach in one paragraph

Three files change, in the order the evidence flows. In `scripts/review-branch.sh` the
streams of the attempt that `quota_failure()` classified are copied into a snapshot before
the PAYG failover can overwrite them, and `emit_unavailable` decides `captured` by running
the same per-stream classifier on that snapshot, so the marker and the routing decision
can no longer disagree; the six-word grep only picks which lines a human sees. In
`.github/workflows/ai-review.yml` a new bracketed block reads the unavailable block of
every required voter that blocked, computes one panel-wide `evidence:` line under rule A,
the latest stated reset instant, and the per-voter details, and the blocked comment prints
that line first. In `.github/workflows/ai-review-retry.yml` the decline path keeps its
`NONE` test and its label, and adds one plain-words comment per blocked run plus a step
summary line. Every behaviour is pinned by `packages/minspec/tests/quota-evidence-witness.test.ts`,
which drives the real script and the real workflow text, never a re-implementation.

## Where the evidence is lost today (re-read on 281774d9)

| Requirement finding | Code today | What goes wrong |
|---|---|---|
| C (overwrite) | `run_reviewer` assigns the globals `AGENT_OUT` (`scripts/review-branch.sh:298`, `:317`) and `AGENT_ERR` (`:322`); the failover calls `run_reviewer payg` (`:506`); `emit_unavailable "$(quota_detail)"` (`:514`) and `quota_detail` (`:483`) read the globals | the text judged is the PAYG attempt's, never the subscription attempt that proved quota |
| C (side effect) | `emit_unavailable` computes `err_len`, `out_len` and `classified_via` from the same globals (`:432-434`) | the diagnostic fields describe the wrong attempt too |
| A (two predicates) | `quota_failure` (`:473-479`) calls `is_quota` / `is_quota_strict` (`:402-413`), i.e. `isQuotaExhaustion` / `isQuotaExhaustionStrict` (`.github/scripts/ai-review-guard.js:314`, `:343`); `emit_unavailable` decides on its own grep (`:420`) | `Too Many Requests`, `insufficient credit`, `session limit` are quota to the router and `NONE` to the marker |
| B (one voter) | the blocked comment reads `$REVIEWER_OUT` alone for the reset time (`.github/workflows/ai-review.yml:932`) and the detail (`:945`) | a blocking non-reviewer voter's evidence and reset time never reach the PR |
| FR-6 (silent decline) | the `NONE` branch prints two log lines and adds `needs-human-review` (`.github/workflows/ai-review-retry.yml:91-107`) | the PR says nothing about why |

FR-3's caller enumeration, re-checked: `emit_unavailable` has one caller (`:514`), reached
only inside `if quota_failure; then` (`:500`). A failure with both streams empty takes the
crash branch (`:520-523`), because both classifiers return false on empty text. So after
this plan `review-branch.sh` never prints `NONE`; the `NONE` arm stays for a future caller.
Task 2 re-runs this enumeration and records the result in its pull request.

Other producers of the unavailable marker, read and left alone: `scripts/review-approvable.sh:275`
writes the block with no `evidence:` line. A missing line already means *retry*
(`ai-review-retry.yml:85-88`, INV-4), so it cannot cause a false `NONE`. Its marker is out
of this spec's scope, and nothing here changes how it is read.

## review-branch.sh (FR-1, FR-2, FR-3; AC-1, AC-2, AC-3, AC-6, AC-8)

### The snapshot

Immediately after `if quota_failure; then` and before the failover block, the script copies
the classifying attempt into four new globals:

- `CLASSIFY_ERR` - `$AGENT_ERR` as it stands;
- `CLASSIFY_OUT_TEXT` - `$(agent_stdout_text)`, the decoded `.result` text, so the snapshot
  holds exactly what the classifier judged;
- `CLASSIFY_OUT_BYTES` - its byte count, computed as today's `out_len` is;
- `CLASSIFY_BRANCH` - `stderr(loose)` when `CLASSIFY_ERR` has non-space text, else
  `stdout(strict)`, the same rule `quota_failure` uses.

The failover still reassigns `AGENT_OUT` and `AGENT_ERR`; nothing that decides the marker
reads them afterwards. When the failover ran, `PAYG_ERR` and `PAYG_OUT_TEXT` are copied the
same way after `run_reviewer payg`, and `PAYG_RAN=yes` is set.

### One predicate

A new function `classified_quota` takes no arguments and applies `quota_failure`'s rule to
the snapshot: `is_quota "$CLASSIFY_ERR"` when `CLASSIFY_ERR` has non-space text, else
`is_quota_strict "$CLASSIFY_OUT_TEXT"`. `quota_failure` itself is rewritten to apply the
same rule to the live globals through one shared helper, `quota_rule <err> <out_text>`, so
there is exactly one place that says which stream is judged by which classifier (INV-3).
Both arms end in `is_quota` / `is_quota_strict`, which call the guard module; no keyword
list in bash decides anything.

`emit_unavailable` stops taking the detail text as `$1`. It reads the snapshot:

- `evidence: captured` when `classified_quota` succeeds, else
  `evidence: NONE (reason is inferred, not observed)`. The `NONE` text is byte-identical to
  today's, because the retry matches it (`ai-review-retry.yml:90`).
- `classified_via`, `stderr_bytes` and `stdout_bytes` come from the snapshot.
- `reason: quota` is unchanged (DQ-3 option A). No new field and no new marker value.

### What a human sees in `detail:`

The six-word grep survives as a line picker only (FR-2). The detail is, in order:

1. Up to three lines of the classifying text that the grep picks, indented two spaces.
2. If the grep picked none (the AC-3 case: `Too Many Requests` matches no grep word), the
   first three non-blank lines of the classifying stream, each cut to 200 characters. A
   captured block therefore never shows an empty detail.
3. When `PAYG_RAN=yes`, a line `  payg failover (not classified): ` followed by up to three
   non-blank lines of `PAYG_ERR`, then of `PAYG_OUT_TEXT`, each cut to 200 characters, or
   `  payg failover (not classified): wrote nothing` (FR-1: added, labelled, never
   substituted; DQ-3 option A: a broken PAYG setup stays readable in the detail).

The `NONE` arm keeps today's `(no diagnostic text on either stream - see #1630)` line.
Redaction is unchanged: the workflow's `redact` runs over the whole block before it reaches
a comment (`.github/workflows/ai-review.yml:502-520`), and the PAYG lines pass through it
the same way.

### Rejected alternatives

- **Pass the subscription streams to `emit_unavailable` as arguments.** Works, but keeps a
  caller able to hand it the wrong attempt's text, which is the defect. A snapshot taken at
  the one point where classification happened cannot be mis-fed.
- **Hard-code `evidence: captured` because the only caller is inside `quota_failure`.**
  Correct today, but a future caller would then print `captured` with no observation,
  breaking FR-3's "keep the `NONE` arm" and INV-2. Re-running the classifier costs one
  `node` start on an outage path.
- **Widen the grep to the classifier's words.** Two lists that must be kept aligned is the
  drift INV-3 forbids.

## ai-review.yml: one panel-wide marker (FR-4; AC-4; DQ-2)

### The block

A new region bracketed `# >>> evidence-aggregate` / `# <<< evidence-aggregate`, placed after
`# <<< verdict-combine` and before the comment body is built, defines one shell function,
`aggregate_unavailable`, and calls it. It is executed verbatim by the test, the precedent
`ai-review-verdict-combine.test.ts` set for `verdict-combine`. Inputs are the variables the
collect step already sets: `REVIEWER_OUT`/`REVIEWER_LABEL`, and for each of security,
architect and skeptic the `_REQUIRED`, `_OUT` and `_LABEL` triple. For each required voter
whose label is `ai-review:blocked`:

- extract its `REVIEW_UNAVAILABLE_BEGIN`..`END` block with the same line-anchored sed the
  detail uses today (`:945`), then `redact`;
- read its `evidence:` value: `captured`, `NONE`, or absent;
- run `parseResetInstant` on that voter's output, as `:932-938` does for the reviewer.

It sets three outputs:

| Output | Rule |
|---|---|
| `PANEL_EVIDENCE` | `NONE` if any blocked voter's block says `NONE`; `captured` if at least one block exists and every block says `captured`; empty if no blocked voter emitted a block |
| `PANEL_EVIDENCE_MISSING` | comma-separated names of the voters whose block said `NONE` (empty otherwise) |
| `PANEL_RESET` | the latest of the stated reset instants, compared as epoch seconds; empty if none stated |

and `PANEL_DETAIL`, the per-voter sections (`#### <voter>` heading, then the redacted block in
a code fence).

**Why an unreported voter contributes nothing.** A voter whose label is empty or unknown
already makes the panel `blocked` (`ANY_UNREPORTED`, `.github/workflows/ai-review.yml:842-873`) but has no block to read.
Counting it as `NONE` would turn a missing witness into "give up", which INV-4 forbids; it
stays as today, where a missing marker means retry. Rule A applies to the voters that did
emit a block. If every blocked voter is unreported, `PANEL_EVIDENCE` is empty and the
comment carries no `evidence:` line, exactly today's fail-safe.

**Why the latest reset instant.** The retry skips while the stated instant is in the
future (`ai-review-retry.yml:118-126`). A retry before the last voter's window resets
re-blocks on that voter and spends tokens on the others, which is what #1204 measured.

### The comment

In the `blocked` branch of the body builder (`:914-956`):

- When `PANEL_EVIDENCE` is non-empty, print, before any per-voter text, one line
  `> Quota evidence across the panel - evidence: <value>`, and, when `NONE`, a following
  `<!-- ai-review-evidence-missing: <names> -->` marker for the retry's notice.
- `<!-- ai-review-reset: $PANEL_RESET -->` replaces the reviewer-only reset marker, with
  the same human line above it.
- The `<details>` section prints `PANEL_DETAIL` instead of the reviewer-only `det`.

**Placement is load-bearing.** The retry reads
`[.comments[].body | capture("evidence: (?<e>NONE|captured)").e] | last`
(`ai-review-retry.yml:89-90`). `capture` without the `g` flag returns the **first** match in
a body, and `last` picks the latest comment holding one. So the aggregated line must come
before every per-voter block in the same body, or a voter's own line is what the retry
reads. The test asserts this on the rendered body. The retry's extraction is not changed
(DQ-2 mechanism C).

## ai-review-retry.yml: a decline the PR can read (FR-6, FR-7; AC-5, AC-6, AC-7; DQ-1)

The `NONE` test (`:89-91`), the label self-heal and `--add-label` (`:102-106`) are kept as
they are (FR-7, INV-2). The missing-marker fall-through (`:85-88`) is untouched (INV-4).
Inside the `NONE` branch, before `continue`:

1. Look up the latest ai-review run id for the branch (`gh run list`, the call `:130-131`
   already makes). Call it `rid`, or `unknown` when none is found.
2. Read the comments once, and skip steps 3 and 4 if any body contains
   `<!-- ai-review-retry-declined: $rid -->` (DQ-1 option A: once per blocked run).
3. Read `<!-- ai-review-evidence-missing: (?<v>[a-z,]+) -->` from the latest comment that has
   one; empty means the voters are not named (an old-format block).
4. `gh pr comment` with a body that says, in words: which voter(s) produced no quota
   diagnostic (or "the reviewer panel" when unnamed); that the block is therefore treated as
   a possible crash, not an outage, and will not be retried automatically; what to do next
   (open the linked ai-review run and read the voter's stderr group, then re-run the
   workflow, or push a fix); and the idempotency marker. The body links the run when `rid`
   is known.
5. Append one line naming the PR and the voter(s) to `$GITHUB_STEP_SUMMARY`. This runs on
   every tick that declines, because the summary belongs to that run, not the PR.

**The notice must not be read as evidence.** It is a comment on the same PR, so it must not
contain the strings `evidence: NONE`, `evidence: captured` or `<!-- ai-review-reset:`;
otherwise it becomes the "latest" match the retry reads. The test asserts the body is free
of all three.

Permissions are unchanged: `issues: write` already covers PR comments and the label
(`:35-44`). Everything is created inside the repo the workflow runs in (INV-5).

**Rejected: key the notice on the `needs-human-review` label.** A machinery PR can already
carry that label for a different reason (`ai-review.yml` summons a human on machinery
pass/changes), which would suppress the first notice. A marker keyed on the run says
exactly "this block was explained".

## Generated copies

`packages/minspec/src/lib/ci-review-templates.ts` embeds byte-exact copies of all three
files (`scripts/gen-ci-templates.mjs:43`, `:55`, `:73`). Every task that changes one of them
runs `node scripts/gen-ci-templates.mjs` and commits the regenerated file in the same pull
request; `npm run validate` fails on a stale copy. The generated file is never hand-edited
and is not in this spec's `affects:` (requirements.md's frontmatter comment says why).

## Testing

All tests live in `packages/minspec/tests/quota-evidence-witness.test.ts`, the file
requirements.md's `implements:` names. Each task adds one `describe` block, writes it first,
and records the red run against the unchanged code in its pull request (FR-8).

- **review-branch.sh fixtures.** The harness of `review-branch-verdict-beats-quota.test.ts`
  (temp git repo, stub `claude` on `PATH`) is copied, not imported, since that file exports
  nothing. The stub answers `--help` with `--json-schema` and picks its output by which
  login it was handed: `ANTHROPIC_API_KEY` set means the PAYG launch, otherwise the
  subscription launch. That the launch program hands each attempt only its own login is
  read from `scripts/lib/agent-context.sh:176-227, 299-303`, not run; task 1 confirms it
  with a control (a stub that prints which variable it saw).
- **AC-8, behavioural.** The real `review-branch.sh`, `scripts/lib/agent-context.sh` and
  the roles it reads are copied into a temp tree with the same layout, and
  `.github/scripts/ai-review-guard.js` there is a wrapper that re-exports the real module
  but whose `isQuotaExhaustion` also accepts a sentinel `QZX-SENTINEL-7`, a string no grep
  word matches. Stderr `QZX-SENTINEL-7` must yield `evidence: captured`. If the decision
  ever moves to a private list, the router still says quota and the marker says `NONE`, and
  the test is red. This is a behaviour check, not a source-text one.
- **ai-review.yml block.** The `evidence-aggregate` region is extracted by its markers
  (the extractor throws if they go missing) and run in bash with cwd at the repo root, so
  `require("./.github/scripts/ai-review-guard.js")` resolves. `redact` is defined in the
  harness as `cat`, since redaction has its own tests.
- **ai-review-retry.yml.** The step's script is bracketed `# >>> retry-loop` /
  `# <<< retry-loop` and run with a stub `gh` on `PATH` that serves fixture JSON through
  the real `jq` for `--jq`, and appends every `pr comment`, `pr edit`, `label create` and
  `run rerun` call to a log the test reads. `GITHUB_STEP_SUMMARY` points at a temp file.
  gh's `--jq` is gojq and the stub uses jq 1.7; the one function used, `capture`, behaves
  the same in both for these patterns (read from both manuals, not run against gojq).

Merge note: every task changes `scripts/` or `.github/`, so each pull request is review
machinery and merges by a human, never by the bot. The review workflow runs the **base**
branch's copy of these files, so a change first runs live on the pull request after it
merges; the tests are the evidence before that.

## Risks

- **A stub-based test can pass without the feature.** Each task records its red run, and
  the AC-8 sentinel test is a control by construction.
- **The four tasks share one test file.** They are sequential; running two at once would
  conflict on it.
- **gojq versus jq.** If `capture` ever differs, the retry test passes locally and the
  live retry reads differently. The patterns here use no flags and no lookaround, which
  is the part both implement alike.
