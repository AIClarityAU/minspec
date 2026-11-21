---
id: SPEC-237
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-237 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md carries an approval record (see the approval note in the opening
# paragraph), so these two fields describe and never seal.
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

# SPEC-237 - Design: a silent ai-review voter names its reason (Plan)

Plan for [requirements.md](requirements.md) (read, never edited by this Plan). Approval
record: approved by `minspec-sdd[bot]` on 2026-11-01 (21:14 UTC), per the sidecar
`.minspec/approvals/specs/minspec/SPEC-237-silent-voter-named-reason/requirements.md.json`
on `origin/main` (`specHash` `4dd788ac...`, which matches `specHash()` of `requirements.md`
on `origin/main`; the sidecar's `basis` field is `delegation:DLG-001`). Its `status:` is
`planning`, the phase after approval. The Clarify selections are as requirements.md's
Decisions section words them (answered, not ratified); this Plan was built under
them, the five recorded selections: D1 (a) sidecar file, D2 (a) keep
`ai-review:changes` and add the headline, D3 (a) this spec owns all five placeholder
copies, D4 yes (hints, total over the reason set), D5 no DR. Citations of "today" are
against `origin/main` `5c580584`. New code is named by symbol, because its line numbers
will move. The task list is [tasks.md](tasks.md).

## Approach in one paragraph

A new pure function in `.github/scripts/ai-review-guard.js`, `classifyNoVerdict`, turns
what the harness observed about one CLI call (stdout text, exit code, stderr byte count)
into a closed-vocabulary reason plus re-typed numbers. `scripts/review-branch.sh` calls it
on every exit that prints no verdict block and writes the result as one JSON line to the
sidecar path the caller names in the `REVIEW_REASON_FILE` environment variable; an `EXIT`
trap makes that total, so an exit nobody anticipated still records `runner-aborted:<rc>`.
A second pure guard function, `renderNoVerdictPlaceholder`, re-validates a sidecar record
and renders the placeholder line with the reason, the numbers and a fixed author hint; it
never throws and degrades to `reason: unrecorded`. `ai-review.yml` passes the sidecar path,
uses the renderer for all four voter placeholders, and gains a small marked
`silent-voters` block that counts required voters whose verdict block came back empty and
writes "N of M required voters produced no verdict: roles" into the comment heading, the
step log line and the `ai-review` check-run summary. `scripts/review-pr.sh` classifies
in-process (it calls the CLI itself, so it needs no sidecar). The label decision
(`review-decide.sh`, the `verdict-combine` block) is not touched.

## What Plan measured that the spec did not know

Each was run or read against `5c580584`, not inferred.

1. **PP-1 is done: the #2101 voters were quota, and the failover leg's cause was lost.**
   The ai-review run on head `964e4fb4` is Actions run `36059728359` (2026-09-24T21:10Z).
   Its `voter stderr - reviewer` and `voter stderr - architect` groups each read, in order:
   `subscription quota hit - failing over to PAYG API`, `PAYG failover also produced no
   verdict`, `reviewer UNAVAILABLE (quota/transient ...)`. The log line shows
   `Reviewer=ai-review:blocked | Architect(yes)=ai-review:blocked | Skeptic(yes)=
   ai-review:changes | FINAL=ai-review:changes`. So FR-1's `quota` names this instance,
   and the vote file already carried `reason: quota` in its `REVIEW_UNAVAILABLE` marker,
   yet the comment showed the fixed placeholder, because `extract_block` reads only the
   verdict markers. What no channel recorded is **why the PAYG leg also failed**. The
   reason set is therefore incomplete in one place, and Plan extends it (as PP-1 directs):
   a quota record carries a `failover` field holding the PAYG leg's own classified reason
   (D-P2 below). This finding is posted on #2126 as task 0.1.
2. **A silent non-quota voter is labelled `changes` today, not `blocked`.** The spec's
   context says an empty voter label sets `ANY_UNREPORTED` and yields `blocked` since
   #1234. The `*)` arm exists, but `review-decide.sh` never hands it an empty label for an
   empty vote: run on empty input it prints `ai-review:changes` to stdout and exits 2
   (`scripts/review-decide.sh:113-114`), and the workflow captures stdout with `|| true`.
   Measured: `printf '\n' | bash scripts/review-decide.sh` prints `ai-review:changes`. Only
   the quota path (`REVIEW_UNAVAILABLE`, mapped to `blocked`) and a crash of
   `review-decide.sh` itself reach `blocked`/unreported. Changing that is SPEC-065's work
   (its design.md *Class 1* row), not this spec's. Two consequences for this plan:
   - FR-5's count cannot key on the label. A silent non-quota voter would read as an
     objector. The `silent-voters` block keys on the **empty verdict block** instead
     (D-P4).
   - The old phrase "fail-closed to changes" is accurate today for the non-quota case and
     false for the quota case. FR-4 drops it either way; the replacement wording, "this is
     not a review of the code", is true in both cases and stays true after SPEC-065.
3. **The workflow runs from the PR head, its scripts from the base.** `ai-review.yml`
   triggers on `pull_request`, so the YAML is the merge ref's, while the "Checkout TRUSTED
   base" step (`ref: base.sha`) supplies `scripts/review-branch.sh` and the guard. The
   check-run step already feature-detects base-guard helpers for this reason (#1834,
   #1925). Every new seam in this plan is skew-safe in both directions (see *Skew*).
4. **Survivor reuse is helper-only today.** `renderVoterRecord` and `selectVotersToRun`
   have no call site in any workflow (`grep -n renderVoterRecord .github/workflows/*.yml`
   finds none). AC-6 is therefore proved at the helper level, which is where the
   property lives (`renderVoterRecord` refuses any non-structural block).
5. **`review-pr.sh` does not call `review-branch.sh`.** It runs `claude -p` itself
   (`scripts/review-pr.sh:196-208`) and leaves the PR unlabeled when the CLI exits
   non-zero. Its placeholder (`:242`) is reached only after an exit-0 call whose envelope
   rendered no verdict. D1's "same plumbing" for the local path is therefore an in-process
   call to `classifyNoVerdict`, not a sidecar.
6. **There is one more no-verdict exit than the spec lists.** `review-branch.sh` refuses
   to review when the guard's schema is unreadable or the CLI lacks `--json-schema`
   (`:255-258`), printing nothing. It also exits 1 on a bad argument or missing role file
   (`:69`, `:75`, `:85`), and `set -e` can end it anywhere (for example a failing
   `git diff`). Plan adds `schema-unsupported` and the trap-recorded
   `runner-aborted:<rc>` (D-P1).

## The reason vocabulary (FR-1, FR-6)

Closed set. A reason string is valid only if it matches `REASON_RE`:

```
^(empty-diff|guard-missing|schema-unsupported|empty-output|not-json|schema-rejected|quota
 |no-output-file|unrecorded|cli-exit:[0-9]{1,3}|signal:[0-9]{1,3}|runner-aborted:[0-9]{1,3}
 |cli-error:[a-z_]{1,40})$
```

(one line in code; wrapped here). Families and who records them:

| Reason | Recorded by | Condition | Author hint (FR-6) |
|---|---|---|---|
| `empty-diff` | runner | `git diff base...head` empty (`:96`) | Nothing to review: the head adds no change against base (#1680). |
| `guard-missing` | runner | guard file absent at the schema preflight | Re-run the same head; the reviewer harness was incomplete. |
| `schema-unsupported` | runner | schema unreadable, or CLI lacks `--json-schema` | Re-run the same head; the reviewer CLI could not take a schema. |
| `signal:<n>` | `classifyNoVerdict` | `rc >= 128`, no usable envelope; `n = rc - 128` | Re-run the same head; the reviewer process was killed. |
| `cli-exit:<rc>` | `classifyNoVerdict` | `rc != 0`, `rc < 128`, no usable envelope | Re-run the same head; the reviewer CLI failed before answering. |
| `empty-output` | `classifyNoVerdict` | zero-byte stdout, `rc == 0` | Re-run the same head; the reviewer returned nothing. |
| `not-json` | `classifyNoVerdict` | non-empty stdout, not a JSON object, `rc == 0` | Re-run the same head; the reviewer's reply was unreadable. |
| `cli-error:<subtype>` | `classifyNoVerdict` | envelope `is_error === true`; subtype per FR-1 | Re-run the same head; or, for `error_max_turns`, change the diff (split it) or escalate to a human. |
| `schema-rejected` | `classifyNoVerdict` | envelope fine, `renderVerdictBlock` returned `''` | Change the diff or escalate: the reviewer answered in a shape the gate refuses. |
| `quota` | runner | existing quota path (marker unchanged) | Wait for the quota window or re-run; not a review of the code. |
| `runner-aborted:<rc>` | runner `EXIT` trap | any exit that printed no verdict and recorded no reason | Re-run the same head; if it repeats, the runner itself is broken. |
| `no-output-file` | workflow | `$VOTE_DIR/<role>.out` missing | Re-run the same head; the voter process left no output. |
| `unrecorded` | renderer | sidecar missing, unreadable, or failed validation | Re-run the same head; no reason was recorded (an older runner, or a damaged record). |

`classifyNoVerdict`'s precedence, first match wins: zero-byte stdout (then `rc == 0` gives
`empty-output`, `rc >= 128` gives `signal`, else `cli-exit`); stdout not a JSON object
(same `rc` split, with `rc == 0` giving `not-json`); `is_error === true` gives
`cli-error`; anything else gives `schema-rejected`. `rc` outside `0..255` or non-integer is
coerced to 255 before classification, so `REASON_RE`'s three-digit bound always holds.

The hint table is a frozen object keyed by family (`cli-exit`, `signal`, `cli-error`, ...),
with one override key, `cli-error:error_max_turns`, looked up first. Totality (D4) is a
test: every family in `NO_VERDICT_REASON_FAMILIES` has a hint, and no hint key names a
family outside it.

## Architecture

### Contracts (FR-1, FR-2, FR-3)

```ts
// Record written to the sidecar, one JSON line, and returned by classifyNoVerdict.
interface NoVerdictRecord {
  v: 1;
  reason: string;          // matches REASON_RE
  rc: number;              // integer 0..255
  stdout_bytes: number;    // integer >= 0
  stderr_bytes: number;    // integer >= 0
  duration_ms?: number;    // integer >= 0, only when the envelope parsed
  num_turns?: number;      // integer >= 0, only when the envelope parsed
  failover?: string;       // quota only: the PAYG leg's reason, matches REASON_RE, never 'quota'
}

classifyNoVerdict(input: { stdout: string; rc: number; stderrBytes: number }): NoVerdictRecord
parseNoVerdictRecord(text: string): NoVerdictRecord | null   // null on ANY deviation
renderNoVerdictPlaceholder(input: { role: string; recordText: string | null;
                                    outputFileMissing?: boolean }): string
// exported constants: NO_VERDICT_REASON_RE, NO_VERDICT_REASON_FAMILIES, NO_VERDICT_HINTS
```

What enters a record: the exit code, two byte counts, and from the envelope only
`is_error` (boolean), `subtype` (regex-restricted, else `unknown`), `duration_ms` and
`num_turns` (finite non-negative integers, else omitted). Never `result`, never stderr text,
never anything from `structured_output` beyond whether `renderVerdictBlock` accepted it.

`parseNoVerdictRecord` re-validates everything: exactly the known keys, `v === 1`,
`reason` and `failover` against `REASON_RE`, numbers re-typed as integers in range. One
deviation returns `null`, and the renderer then says `unrecorded`. That is the FR-3
fail-safe direction: a damaged or forged record can only lose detail, never change a label
(nothing on the label path reads it) and never inject text (every rendered byte comes from
the vocabulary, the role allowlist or a re-typed integer).

`renderNoVerdictPlaceholder` output shape:

```
(<role> produced no verdict - reason: <reason>[ (failover: <reason>)] · rc=<n>[ · turns=<n>]
 · stdout=<n>B - <hint> - this is not a review of the code)
```

(one line). `role` is checked against `reviewer|security|architect|skeptic`; anything else
renders as `voter`. The function never throws: a top-level `try` returns the fixed
`unrecorded` placeholder for the role. A unit test asserts no output ever contains
`REVIEW_VERDICT_BEGIN`, `REVIEW_VERDICT_END` or `REVIEW_UNAVAILABLE`, across every
reason, so `isStructuralVerdictBlock` is `false` for all of them (AC-2, DR-097 condition 5).

### The runner: `scripts/review-branch.sh` (FR-1, FR-2, FR-3)

- `run_reviewer` stores its exit code in a global `AGENT_RC` before returning it. The two
  call sites keep `|| true` (label path unchanged).
- New `record_no_verdict <reason-or-empty> [failover]`: when `REVIEW_REASON_FILE` is
  unset, does nothing (callers that never asked keep today's behaviour exactly). When the
  first argument is empty, it asks `classifyNoVerdict` (via the same `node -e` +
  `require(process.env.GUARD)` shape the file already uses) with `AGENT_OUT`, `AGENT_RC`
  and `${#AGENT_ERR}`; otherwise it builds the record for the named runner-side reason
  through a sibling guard helper, `noVerdictRecordFor(reason, numbers)`, which applies the
  same validation. It writes the line atomically (`mktemp` in the sidecar's directory,
  then `mv`) and sets `REASON_RECORDED=1`. A failure to write is reported on stderr and
  annotated `# swallow-ok: diagnostic sidecar; a missing record renders "unrecorded" and
  never changes a label`, which is what `scripts/check-swallowed-gate-signal.ts` requires.
- Call sites: the empty-diff exit (`empty-diff`); the schema preflight (`guard-missing`
  when `[[ ! -f $GUARD ]]`, else `schema-unsupported`); the quota exit (`quota`, with
  `failover` = the PAYG leg's classified reason when the failover ran); the final
  non-quota exit (classified).
- `VERDICT_EMITTED=1` is set immediately before each `printf '%s' "$VERDICT_BLOCK"`.
- An `EXIT` trap, installed after argument parsing and skipped in `--print-input` mode:
  `rc=$?`; if `REVIEW_REASON_FILE` is set and neither `VERDICT_EMITTED` nor
  `REASON_RECORDED`, it writes `runner-aborted:<rc>` with zero byte counts; then
  `exit $rc`. The trap never prints to stdout, so the vote stream is unchanged.
  Argument errors at `:69`/`:75` happen before the trap exists; they are covered by the
  workflow's `unrecorded` fallback and are a caller bug, not a voter outcome.
- The usage-line comment and the `render_verdict` header comment are updated where they
  say "fails closed to ai-review:changes" (finding 2: it is `changes` only for the
  non-quota path).

### The workflow: `.github/workflows/ai-review.yml` (FR-3, FR-4, FR-5)

- `run_voter` exports `REVIEW_REASON_FILE="$VOTE_DIR/$1.reason"` for the one call.
- A new marked block `# >>> no-verdict-placeholder` / `# <<< no-verdict-placeholder`
  defines `no_verdict_placeholder <role>`: if `$VOTE_DIR/<role>.out` is missing it passes
  `outputFileMissing`; it reads `$VOTE_DIR/<role>.reason` if present; it calls
  `renderNoVerdictPlaceholder` from the base guard **only if** `typeof` says the export
  exists; otherwise, or on any node failure, it prints the fixed shell string
  `(<role> produced no verdict - reason: unrecorded - re-run the same head - this is not
  a review of the code)`. The four `[ -z "$X_BLOCK" ] && X_BLOCK="(... fail-closed to
  changes)"` lines become `[ -z "$X_BLOCK" ] && { X_BLOCK="$(no_verdict_placeholder
  <role>)"; X_SILENT=yes; }`. Each `X_SILENT` defaults to `no`.
- A new marked block `# >>> silent-voters` / `# <<< silent-voters`, placed directly after
  `# <<< verdict-combine` (which is not edited): for each role with `X_REQUIRED=yes`
  (reviewer is always required) it counts `REQUIRED_COUNT`, and appends the role to
  `SILENT_ROLES` when `X_SILENT=yes`. If any are silent, `SILENT_HEADLINE="<n> of <m>
  required voters produced no verdict: <role>, <role>"`, else empty. It reads no label,
  so it cannot change `FINAL`, and the combine block's own test keeps passing untouched.
- `SILENT_HEADLINE` goes to `$GITHUB_OUTPUT` as `silent_headline`, is appended to the
  existing `Coverage=... | FINAL=...` log line as `| Silent=<n>/<m>(<roles>)`, and is
  printed as `> ⚠️ **<headline>** - see each voter's line below.` immediately after the
  `## 🤖 AI review` heading, before the `blocked` explanation or the verdict blocks.
- The check-run step gains `SILENT_HEADLINE: ${{ steps.review.outputs.silent_headline }}`
  and, inside its `node -e`, a marked fragment (`// >>> silent-headline` /
  `// <<< silent-headline`) defining `silentSuffix(h)`: returns `"\n\n**" + h + "**"` when
  `h` matches `^[0-9]{1,2} of [0-9]{1,2} required voters produced no verdict:
  (reviewer|security|architect|skeptic)(, (reviewer|security|architect|skeptic))*$`, else
  `""`. The summary becomes `c.summary + silentSuffix(...) + marker + round`. The check is
  in the head YAML, so it needs no base-guard feature detection.
- Carry path (`carry=yes`): no voter ran, so no headline; unchanged.

### The local path: `scripts/review-pr.sh` (FR-4)

On the empty-block line (`:242`) it calls `renderNoVerdictPlaceholder` with the record
from `classifyNoVerdict({ stdout: AGENT_OUT, rc: 0, stderrBytes })` in one `node -e`, with
the same fixed fallback string when the guard lacks the export. Its label logic (fail
closed to `ai-review:changes`) is unchanged.

### Shipped copies (FR-7)

`node scripts/gen-ci-templates.mjs` regenerates `packages/minspec/src/lib/ci-review-templates.ts`
(it embeds the workflow, `review-branch.sh`, `review-pr.sh`, the guard and the guard's test
file). `ci-review-templates-gen.test.ts`, `managed-region-templates.test.ts` and
`ai-review-guard-test-parity.test.ts` are the parity gates; `npm run validate` runs the
`--check` staleness path.

## Skew (finding 3)

| Head YAML | Base scripts + guard | Result |
|---|---|---|
| new | old (the implementing PR's own run; any PR while base predates the merge) | The old runner ignores `REVIEW_REASON_FILE`; no sidecar. The old guard lacks the renderer; the shell fallback prints `reason: unrecorded`. Headline and check-run suffix work (head-side). Label unchanged. |
| old | new (a PR branched before the merge, base after) | The old YAML sets no `REVIEW_REASON_FILE`; the new runner writes nothing and its stdout is byte-identical to today's. Old placeholder wording shows until that PR rebases. Label unchanged. |
| new | new | Full behaviour. |

The implementing PR is machinery (D6): its own ai-review run is in the first row and is
expected to show `unrecorded` for any silent voter. That is not a defect.

## Decisions (recorded alternatives)

Plan-level choices inside the Clarify selections. Recorded here because under the `act`
autonomy mode nobody sees them live (DR-086 §4).

- **D-P1 Extend the reason set with `schema-unsupported`, `runner-aborted:<rc>`,
  `unrecorded`.** Chosen: the set stays closed (one regex), and every exit is covered.
  Rejected: folding the schema refusal into `guard-missing` (two different fixes: a
  missing file versus an old CLI), and leaving unanticipated exits unrecorded (they would
  then render as `unrecorded`, indistinguishable from an old runner).
- **D-P2 `failover` sub-field on `quota`.** Chosen because PP-1 showed the PAYG leg's
  cause is exactly what was lost on #2101. Rejected: reporting the PAYG leg's reason as
  the top-level reason (would drop `quota`, which is what decides `blocked` and the retry
  path), and a second sidecar per leg (two records to reconcile).
- **D-P3 Pass the sidecar path by environment variable, not a `--reason-file` flag.**
  Chosen because of skew: the head YAML calls the base runner, and today's runner exits 1
  on an unknown argument (`:69`), which would silence every voter on the implementing PR
  and on every PR whose base predates the merge. An unknown environment variable is
  ignored. Cost: the trigger-agnostic contract comment ("takes only positional base/head
  plus --role") gains one optional variable, documented in the header.
- **D-P4 Count silence by empty verdict block, not by label.** Chosen because of finding
  2: a non-quota silent voter is labelled `changes`. Rejected: keying on `ANY_UNREPORTED`
  (misses both #2101 voters, which were `blocked`) and keying on "label not pass/changes"
  (misses the non-quota case).
- **D-P5 Headline computed in the head YAML (shell + inline JS), placeholder rendered by
  the base guard.** The headline is built from role names and two counts, so it needs no
  shared vocabulary and gains skew immunity by living in the YAML. The placeholder needs
  the vocabulary, the hints and the validator that `review-pr.sh` also uses, so it lives in
  the guard with a feature-detected fallback. Rejected: putting both in the guard (the
  implementing PR's own check-run would lack the headline) and both in the YAML (the hint
  table would be duplicated into `review-pr.sh`, a drift pair).
- **D-P6 Sidecar is one JSON line, not `key: value` lines.** It is produced and consumed
  only by node, and a strict-keys JSON parse is a smaller validator than a line grammar.
  It is not shaped like the `REVIEW_*` protocol, so no extractor can mistake it.

## Files

| File | Change |
|---|---|
| `.github/scripts/ai-review-guard.js` | Add `classifyNoVerdict`, `noVerdictRecordFor`, `parseNoVerdictRecord`, `renderNoVerdictPlaceholder`, `NO_VERDICT_REASON_RE`, `NO_VERDICT_REASON_FAMILIES`, `NO_VERDICT_HINTS`; export them. |
| `.github/scripts/ai-review-guard.test.js` | `node --test` cases for the four functions (shipped test, parity-managed). |
| `scripts/review-branch.sh` | `AGENT_RC`, `record_no_verdict`, `VERDICT_EMITTED`, `EXIT` trap, five call sites, header comment for `REVIEW_REASON_FILE`. |
| `.github/workflows/ai-review.yml` | `REVIEW_REASON_FILE` in `run_voter`; `no-verdict-placeholder` block; four placeholder lines; `silent-voters` block; output, log line, comment heading; check-run env + `silent-headline` fragment. |
| `scripts/review-pr.sh` | Placeholder at the empty-block line. |
| `packages/minspec/src/lib/ci-review-templates.ts` | Regenerated, never hand-edited. |
| `packages/minspec/tests/review-branch-no-verdict-reason.test.ts` (new) | AC-1, AC-2 (runner level). |
| `packages/minspec/tests/ai-review-silent-voters.test.ts` (new) | AC-3, AC-4 (executes the marked blocks verbatim). |
| `packages/minspec/tests/voter-survivor-reuse.test.ts` | AC-6 case. |
| `specs/minspec/SPEC-065-*/design.md` | D3: the placeholder row defers to SPEC-237. |

Every file except the last two test files and SPEC-065's design is machinery
(`.github/**`, `scripts/**`, the generated template), so the implementation PR is a founder
push and a human merge (D6, #1120). Nothing under `.githooks/` or `.minspec/` changes, and
`packages/minspec/src/` changes only by regeneration.

## Risks

- **R1 The trap changes an exit code.** Mitigation: the trap captures `$?` first and
  re-exits with it; task 2.1 asserts the runner's exit code is unchanged on every fixture.
- **R2 The sidecar write blocks a voter.** It runs after the vote is decided and its
  failure is swallowed with an annotation; task 2.1 includes a read-only sidecar directory
  case that still yields the same stdout and exit code.
- **R3 Check-run summary length.** The suffix is at most about 100 bytes, against a
  65,535-byte limit; voter records are not stored there today (finding 4).
- **R4 SPEC-065 lands first and rewrites the same lines.** D3 gives this spec ownership;
  task 5.1 lists open PRs touching `ai-review.yml`'s collect block before editing and
  records any overlap in the PR body.
- **R5 Hint wording goes stale when SPEC-065 makes non-quota silence `blocked`.** The
  hints describe what the author should do, not the label, so they stay true; the
  totality test catches a new reason, not a changed label.

## Follow-ups (tracked)

- PP-1 result posted on #2126 (comment 6829956403, task 0.1, done).
- SPEC-065 design.md placeholder row reconciled (task 5.2, D3).
- Finding 2 (silent non-quota voter labelled `changes`) is SPEC-065's existing *Class 1*
  requirement; no new item.
- Survivor reuse wiring (finding 4) belongs to #2142; no new item.
