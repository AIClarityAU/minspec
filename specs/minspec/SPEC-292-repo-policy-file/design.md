---
id: SPEC-292
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-292 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - one place an agent and a reviewer read "what is allowed here"
relates_to: ["#2985", "#912", "#1688", "SPEC-254", "DR-011", "DR-015", "DR-079", "DR-106", "DR-109"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-292 - Design: one repo policy file, loaded by every agent prompt and every AI review (Plan)

Plan for [requirements.md](requirements.md) (approved; read, never edited by this Plan),
built under the six recorded Clarify selections: D1 (a) a new `.minspec/policy.md`;
D2 (a) a pointer index plus an optional repo-local rules section; D3 (a) reviews inline
the policy file and the constitution, decision records by index only; D4 (a) the four
surfaces `dispatch-issue.sh`, `remediate-pr.sh`, `review-branch.sh`,
`review-approvable.sh`; D5 (a) the existing CLAUDE.md / AGENTS.md mirrors are not
collapsed here; D6 (a) fail closed once the file has been scaffolded, a visible notice in
a repo that predates it. Citations of "today" are against `origin/main` `e9924bf3`. New
code is named by symbol, because its line numbers will move. The task list is
[tasks.md](tasks.md).

## Approach in one paragraph

A new shell library, `scripts/lib/policy-block.sh`, is the one place that reads the
policy (and, for reviews, the constitution) from a named git ref, wraps it in a trusted
block, and reports a status. All four launchers source it and embed its output; none of
them reads the files any other way. The policy file is a new managed-region template
(`.minspec/policy.md`, HTML-comment markers, like the role files) whose managed region is
a pointer table and whose repo-local section sits outside the markers. A pure function
added to `packages/minspec/src/lib/constitution.ts` checks the file for copied
constitution text and for its size; `scripts/validate-frontmatter.ts` runs it in this
repo and a Python twin in the scaffolded `validate.py` runs it in adopters, held to the
same answers by a shared-fixture parity test. Every claim that a prompt contains the
policy is proved through the existing launch harness
(`packages/minspec/tests/helpers/agent-launch-harness.ts`), which runs the real launcher
against a stub `claude` and records the prompt the stub received.

## What Plan measured that the spec did not know

Each was read in code at `e9924bf3` or computed, not inferred, unless marked.

1. **The prose carriers moved.** The "Read CLAUDE.md for invariants" lines the spec cites
   at `dispatch-issue.sh:1368` and `:1432` are now at `scripts/dispatch-issue.sh:1540`
   (Specify-only prompt) and `:1603` (build prompt); `remediate-pr.sh` carries its own at
   `scripts/remediate-pr.sh:1289`. Both dispatch prompts are assigned to `PROMPT`, and the
   escalation retry rebuilds `RUN_PROMPT` from `PROMPT`
   (`scripts/dispatch-issue.sh:2493`, `:2559`), so a block inside `PROMPT` reaches the
   retry with no second edit. `remediate-pr.sh` does the same (`:1317`, `:1341`).
2. **"The harness manifest" cannot be the D6 witness in CI.** The section-hash manifest is
   `.minspec/generated-hashes.json` (`packages/minspec/src/lib/merge-refresh.ts:1148`),
   which MinSpec declares machine-local and gitignores (`merge-refresh.ts:669-673`); it is
   not in this repo's tracked files (`git ls-files .minspec`). The ai-review job checks out
   the base with `fetch-depth: 0` (`.github/workflows/ai-review.yml:286`), so the base's
   full history is present. The design therefore keeps D6 (a)'s intent - fail closed once
   the file has existed - and reads "has existed" from committed history, not from the
   machine-local manifest. See *D6 witness* below.
3. **The policy must stay out of the reviewable-input hash.** `--print-input` prints
   `REVIEW_INPUT`, the diff plus provenance block (`scripts/review-branch.sh:152-155`), and
   ai-review hashes it to decide whether a push changed anything a reviewer reads
   (`ai-review.yml:368-369`, `ai-review-guard.js` `planVerdictCarry`). The policy block is
   built from the base, not from the change, so it goes into `USER_CONTENT` beside
   `REVIEW_INPUT`, not inside it. A new `--print-prompt` prints the whole `USER_CONTENT`
   for FR-6. Consequence: a policy edit on the base does not by itself void a carried
   verdict on an open pull request; the next push to that pull request is reviewed under
   the new policy (Risks, R3).
4. **The tag defanging is per-script.** `review-branch.sh` neutralises `untrusted_diff` and
   `approval_provenance` inside the diff (`:113-115`). `review-approvable.sh`,
   `dispatch-issue.sh` and `remediate-pr.sh` defang nothing today (no `defang` in any of
   them). A forged `<repository_policy>` block inside an issue body, approvable or findings
   text would sit beside the real one, so every untrusted payload in a prompt that carries
   the policy block goes through one shared filter, `policy_defang`.
5. **The four launchers already have real-launch test runners.** `runDispatch`,
   `runRemediate`, `runReviewBranch` and `runReviewApprovable`
   (`agent-launch-harness.ts:787`, `:1149`, `:1045`, `:1067`) start the real script with a
   stub `claude` whose prompt is recorded (`Launch.prompt`, `:86-87`). FR-6 extends these
   fixtures (a committed policy file at the base) rather than building a new seam, and
   asserts on the recorded prompt, never on script source text.
6. **Scaffold shape.** Managed-region templates are not Handlebars-rendered, so their
   region is project-independent (`template-registry.ts:972-984`). Markdown files take
   `commentStyle: 'html'`, as the four role files do (`template-registry.ts:2728-2750`).
   The membership of `MANAGED_REGION_TEMPLATES` is pinned by path and by count (31) in
   `packages/minspec/tests/managed-region-enumeration.test.ts:55-100`; the CI stack is
   mirrored in `CI_STACK` (`managed-region-templates.test.ts:323-348`) and in
   `scripts/gen-ci-templates.mjs` `SOURCES`. `scripts/lib/agent-context.sh` is the
   precedent for a scaffolded library sourced by `review-branch.sh`
   (`template-registry.ts:2695`).
7. **The decision index is too large to inline.** `docs/decisions/INDEX.md` is 87,440
   bytes (118 entries). D3 (a)'s "list DRs by index only" is therefore read as: the policy
   names the index path, and voters `Read` a record on demand. Inlining the index would
   cost about nine times the constitution.
8. **D3 cost, measured on recent runs.** 38 of the 40 most recent successful ai-review
   runs (from 2026-11-06) started voters, 135 voter runs in all (about 3.6 per run). Four
   usage lines from run 43244728119 read `in` 3,865-4,002, `cache_write` 16,182-32,612,
   `cache_read` 44,757-254,921, `out` 3,622-7,198, `turns` 3-10, `cost_usd` 0.29-0.64.
   The constitution is 9,749 bytes; the policy file is planned at under 2 KB. At about 4
   bytes per token (inferred, not tokenised), the new blocks add about 3,000 prompt tokens
   per voter, paid once as cache write and then as cache read on each later turn: roughly
   6-7% of one voter run's cost, about $0.035 (inferred from the four lines). Scaled to the
   week (251 successful runs since 2026-11-06, about 95% with voters, about 850 voter runs,
   inferred), that is about $30 a week in API-equivalent terms. Its share of the weekly
   quota cap cannot be computed from the repository, because the cap's absolute size is
   not recorded here; task 1.2 computes it with the runner's usage readout before any
   build, against DR-106's 2% tie-break (Risks, R1).

## Architecture

### The policy file: `.minspec/policy.md` (FR-1, FR-2, D1, D2)

A new `ManagedRegionTemplate` in `packages/minspec/src/lib/template-registry.ts`:

```ts
{
  name: 'policy-md',
  outputPath: '.minspec/policy.md',
  commentStyle: 'html',
  content: POLICY_MD,
  preamble: POLICY_MD_PREAMBLE,
}
```

`POLICY_MD` (the managed region; text fixed here so the build is mechanical, wording may be
tightened at build as long as FR-3 and the AC-1 test pass on it):

```markdown
This file is an index. It names where each kind of rule lives in this repository and
restates none of them. AI reviews and dispatched agents are given this file from the base
branch; open the named file for the rule itself.

| Where | What it governs |
|---|---|
| `.minspec/constitution.md` | The invariants and principles; AI reviews also receive it whole. |
| The decision register (`decisionsDir` in `.minspec/config.json`; `docs/decisions/` by default) and its `INDEX.md` | Why each architectural choice was made. Open the record a change touches. |
| `specs/` (`specsDir` in `.minspec/config.json`) | Approved requirements. A change implements them; it does not rewrite them. |
| `.minspec/config.json` | Approvers, auto-merge and ownership settings. |
| `.minspec/approvals/` | Recorded sign-offs on specs and decisions. |
| `.github/workflows/minspec-validate.yml`, `.github/workflows/ai-review.yml`, `.minspec/hooks/` | The checks a change must pass. |
| `CLAUDE.md`, `AGENTS.md` | Working conventions for agents in this repository. |
```

`POLICY_MD_PREAMBLE` is the title plus the D2 (a) section. It sits before the start
marker, so it is written when the file is first scaffolded and kept as surrounding
content by every later refresh (`preamble`, `template-registry.ts:993-1002`: "a refresh
preserves it as surrounding content via `spliceManagedRegion`"). A multi-line preamble
has precedent: the slash-command shims use one for their YAML frontmatter. No scaffold
code changes. The repo-local section therefore comes above the index:

```markdown
# Repository policy

## Rules that live nowhere else

<!-- Optional. Add a rule here only when none of the files above is its natural home.
Each rule lives in exactly one file: if it belongs in the constitution or a decision
record, put it there and point to it. -->

## Where the rules live (managed by MinSpec)
```

Refresh behaviour is the existing managed-region path (`refreshManagedRegionTemplates`,
`packages/minspec/src/lib/scaffold.ts:1232`): the region is rewritten, everything outside
it is kept (FR-1, DR-011). The file is under `.minspec/`, so it is written only into an
opted-in repo (invariant 3) and is in this repo's never-auto-merge set by the existing
`^\.minspec/` arm (`scripts/dispatch-issue.sh:406`, `:1908`), which is FR-10 with no new
withhold entry. Task 2.5 pins that with a test rather than trusting the regex.

This repo's own `.minspec/policy.md` carries the same region plus a repo-local section
pointing at the two rules that have no other home here: the never-auto-merge path
classes (`scripts/dispatch-issue.sh`, the comment above `DOCS_CORPUS_RE`) and the
single-funnel merge rule (`docs/claude-md-details.md#merge-funnel`). Pointers only.

### The no-duplication and size check (FR-3, FR-9)

Added to `packages/minspec/src/lib/constitution.ts`, beside `parseConstitution` and
`firstSentence`, which it reuses (no new file under `packages/*/src/`, so
`implements: none` stays true):

```ts
export const POLICY_MAX_BYTES = 4096;
export const POLICY_SHINGLE_WORDS = 8;
export const POLICY_LEAD_MIN_WORDS = 6;

export interface PolicyViolation {
  rule: 'policy.copies-constitution' | 'policy.too-large';
  line: number;      // 1-based line in the policy file; 0 for too-large
  message: string;   // names the line text (clamped) and the constitution item it copies
}

export function checkPolicyFile(policy: string, constitution: string): PolicyViolation[];
```

The overlap rule, fixed here as FR-3 requires:

- **Normalisation** (both texts): strip Markdown emphasis, backticks and link syntax,
  lower-case, replace every run of non-letter-non-digit characters with one space.
- **Lead-sentence match.** For every invariant, principle and constraint item that
  `parseConstitution` returns, take `firstSentence(item)`. If its normalised form has at
  least `POLICY_LEAD_MIN_WORDS` words and occurs inside a normalised policy line (or a
  normalised run of up to three consecutive lines, so a wrapped paste is caught), that is
  a violation naming the line and the item.
- **Shingle match.** Any run of `POLICY_SHINGLE_WORDS` consecutive normalised words that
  occurs in both the policy file and the full normalised text of those constitution items
  is a violation naming the first policy line the run touches.
- **Scope.** The whole file, including the D2 repo-local section (D2 (a)'s stated cost).
  The marker comment lines are excluded.
- **Size.** `Buffer.byteLength(policy) > POLICY_MAX_BYTES` is one `policy.too-large`
  violation stating both numbers.

Why these numbers. Eight words: the shortest current invariant lead (invariant 1, "Core
functionality works offline - no network calls without explicit user consent") is 11
normalised words, so an eight-word window catches any paste of it and any partial paste
of a longer item, while a pointer line naming an invariant by title ("invariant 2, no
silent gate") shares at most three or four consecutive words. Five words was rejected:
ordinary phrases such as "the project it is installed in" would fire on honest pointer
lines. Twelve was rejected: it misses a paste of invariant 1's lead sentence. The
lead-sentence arm exists for leads of six to seven words, which the shingle arm would
miss. A lead under six words is not checked by either arm (Risks, R4). 4,096 bytes: the
template region is under 2 KB, which leaves room for a repo-local section of several
rules while keeping the policy block under about 1,000 tokens per voter.

Surfaces:

- **This repo:** a new numbered, FATAL rule in `scripts/validate-frontmatter.ts` (the next
  free rule number at build time). It reads `.minspec/policy.md` and
  `.minspec/constitution.md`; an absent policy file is no finding (D6 handles absence at
  review time); an unreadable one is reported through the existing `reportUnrunnable`
  helper, fatal, never skipped silently (invariant 2).
- **Adopters:** the managed region of `VALIDATE_PY` (`template-registry.ts:1813`) gains
  the same check in Python (`check_policy_file`). It parses the constitution's
  `## Invariants`, `## Principles` and `## Constraints` list items the way
  `parseConstitution` does and reproduces `firstSentence` and the normalisation exactly.
  Two copies of one predicate drift, so a parity test runs both over one shared fixture
  table (task 2.3) and fails on any difference in rule id or line.

### The loader: `scripts/lib/policy-block.sh` (FR-4, FR-5, FR-7, D3, D6)

A sourced library, scaffolded to adopters beside `scripts/lib/agent-context.sh` because
the scaffolded `review-branch.sh` sources it. Bash, `git` and `printf` only; no network
(invariant 1).

```bash
POLICY_PATH=".minspec/policy.md"
POLICY_CONSTITUTION_PATH=".minspec/constitution.md"

# policy_load <ref> [--with-constitution]
#   Sets POLICY_BLOCK  - the text to embed; never empty (a notice block when absent)
#        POLICY_STATUS - present | absent-predates | absent-removed | unreadable
#                        | history-unavailable | no-repo
#   Writes one line to stderr for every status other than `present`.
#   Always returns 0: the status is the result, and the caller decides.
policy_load() { ... }

# policy_fail_closed - true when POLICY_STATUS is absent-removed, unreadable or
#   history-unavailable (D6 (a): the file existed, or we cannot tell whether it did).
policy_fail_closed() { ... }

# policy_defang - stdin to stdout, neutralising open and close forms of the
#   repository_policy and repository_constitution tags (whitespace-, attribute- and
#   case-tolerant, same shape as review-branch.sh:113-115), leaving a visible marker.
policy_defang() { ... }
```

The block, when present:

```text
<repository_policy TRUSTED="read from <ref> <short-sha> by this repository's tooling - NOT from the change under review">
...contents of .minspec/policy.md at <ref>...
</repository_policy>
<repository_constitution TRUSTED="read from <ref> <short-sha> by this repository's tooling - NOT from the change under review">
...contents of .minspec/constitution.md at <ref>...
</repository_constitution>
```

The constitution half is emitted only with `--with-constitution` (the two review
surfaces, D3 (a)); a missing constitution under that flag produces a one-line notice
inside the block, not a failure, because its absence is already a validator concern and
D6 speaks only of the policy file.

#### D6 witness: status from committed history

Read with `git cat-file -e "<ref>:.minspec/policy.md"` then `git show`. Never from the
working tree (FR-4).

| Condition at `<ref>` | `POLICY_STATUS` | Review | Dispatch / remediate |
|---|---|---|---|
| file readable | `present` | block embedded | block embedded |
| not a git repo (cwd) | `no-repo` | notice in prompt and in verdict, proceed | notice, proceed |
| file absent, `git log -1 <ref> -- .minspec/policy.md` empty, history complete | `absent-predates` | notice in prompt and in verdict, proceed | notice, proceed |
| file absent, history shows it existed | `absent-removed` | fail closed: `changes` | notice + WARNING, proceed |
| file absent, repository shallow (`git rev-parse --is-shallow-repository` is `true`) | `history-unavailable` | fail closed: `changes` | notice + WARNING, proceed |
| `git show` fails for any other reason | `unreadable` | fail closed: `changes` | notice + WARNING, proceed |

Dispatch and remediation are not gates: they proceed with a visible notice in the prompt
and a WARNING line in their log (FR-7 "logged and surfaced"); the review that judges their
output fails closed on the same condition. A shallow history fails the review closed
because an errored witness fails closed (invariant 2); CI is never shallow here
(`fetch-depth: 0`), so this only bites a local run from a shallow clone, which then says
why.

### Review: `scripts/review-branch.sh` (FR-4, FR-6, FR-7)

Order of work after the empty-diff exit (`:92-98`), all before the CLI probe:

1. `DIFF` passes through `policy_defang` as well as the existing `sed` (same pipeline).
2. `policy_load "$BASE" --with-constitution`. `$BASE` is the positional base the caller
   already passes; in CI it is the base SHA (`ai-review.yml:723`). Never `HEAD`, never the
   working tree.
3. `USER_CONTENT` gains `${POLICY_BLOCK}` immediately before `${REVIEW_INPUT}`, and one
   instruction paragraph: the policy and constitution blocks are trusted repository input
   read from the base; judge the change against them; a change to either file in the diff
   is judged against the base version shown here. `REVIEW_INPUT` and `--print-input` are
   unchanged (measured point 3).
4. New flag `--print-prompt`: prints `USER_CONTENT` and exits 0, no CLI probe, no token,
   like `--print-input`. Usage text and the header comment name it.
5. If `policy_fail_closed`: print a canonical verdict block built from a script-authored
   object - `verdict: changes`, `blocking: 1`, a summary naming the status and the base
   SHA, one finding located at `.minspec/policy.md` saying what to restore - rendered
   through the existing `render_verdict` (`parseCliVerdict`, so the delimiters still come
   from the guard, DR-079), and exit 0. No voter starts, so no tokens are spent.
6. If `POLICY_STATUS` is `absent-predates` or `no-repo`: after a voter returns, a `note`
   finding located at `.minspec/policy.md` ("no repository policy at base <sha>; reviewed
   without it") is appended to `structured_output.findings` before `render_verdict`, on
   both the subscription and the pay-as-you-go path, through one function,
   `render_with_policy_note`. `blocking` and `verdict` are never changed by it. This is the
   "visible notice in the posted verdict" of D6 for a repo that predates the file.

The scaffolded copy is regenerated with `node scripts/gen-ci-templates.mjs` (FR-8, AC-7),
and the new library is registered in `SOURCES`, `CI_REVIEW_STACK_TEMPLATES`, `CI_STACK`
and the pinned enumeration.

### Review: `scripts/review-approvable.sh` (FR-4, D4)

Gains `--policy-ref <ref>`, default `origin/main`, read in the repository that contains
the document (`git -C "$(dirname "$DOC")" rev-parse --show-toplevel`). The approvable
`CONTENT` goes through `policy_defang`; `USER_CONTENT` embeds the block (with
constitution) before `<untrusted_approvable>`; the fail-closed and note paths are the same
two functions as in `review-branch.sh`. It stays drift-gated and unscaffolded
(`gen-ci-templates.mjs`, "Drift-gated only; not scaffolded"); its embedded copy is
regenerated.

### Dispatch: `scripts/dispatch-issue.sh` and `scripts/remediate-pr.sh` (FR-5, D4)

- `dispatch-issue.sh`: after the issue body is read and before either `PROMPT` heredoc,
  `ISSUE_BODY` goes through `policy_defang`, then
  `policy_load origin/main` runs in `$REPO_ROOT` (the dispatcher's checkout, already
  fetched; never the agent's worktree, which an earlier attempt's branch may have edited).
  In both heredocs the line "Read CLAUDE.md for invariants." (and, in the build prompt,
  "Read AGENTS.md for task intake rules.") is replaced by `${POLICY_BLOCK}` followed by one
  sentence: the policy above is the index of where each rule lives; open those files when
  the task touches them. CLAUDE.md stays readable on demand and out of the ambient load
  (SPEC-254, #912 context-slim: unchanged).
- `remediate-pr.sh`: same, with `FINDINGS` / `CONTEXT` through `policy_defang` and the
  block replacing the "Read CLAUDE.md for invariants and RCDD" clause's first half (the
  RCDD `Root cause:` instruction stays, it is a commit-gate fact, not a policy copy).
- Neither gets the constitution (D3 is about review; FR-5 names the policy file only).

### Pointers in the harness files (FR-8)

The `CLAUDE.md` and `AGENTS.md` Handlebars templates (`template-registry.ts`; in
CLAUDE.md the `## Commands` section, `:257`; in AGENTS.md its nearest equivalent, chosen
at build) gain one line: "Where each rule lives:
`.minspec/policy.md` (an index; reviews and dispatched agents are given it)." This
repo's own `CLAUDE.md` and `AGENTS.md` get the same line by hand in the same pull
request, so this repo's own agents reach it from the file they already read.

## Decisions (recorded alternatives)

Under `act` autonomy nobody sees these live; this section is their review path.

- **One shared loader, not four inline reads.** Rejected: inlining a `git show` in each
  launcher. Four copies of a fail-closed predicate drift (the repo's own lesson on
  duplicated predicates); one library is tested once and sourced four times.
- **D6 witness from git history, not from the machine-local manifest.** Rejected: (i) the
  section-hash manifest, absent in every CI run and fresh clone (measured point 2), so D6
  would always see "predates" and never fail closed; (ii) a new committed key in
  `.minspec/config.json`, which a repo could drop together with the file in one commit and
  silently downgrade to "predates". History cannot be rewritten by an ordinary pull
  request, and CI has it in full.
- **Policy outside `REVIEW_INPUT`.** Rejected: adding it to the hashed input, which would
  void every carried verdict on every open pull request whenever the base policy changes
  and re-run the panel on all of them. Accepted cost: R3.
- **Fail-closed verdict synthesised by the script, not "no verdict".** Rejected: emitting
  nothing (which the gate also reads as `changes`), because the posted comment would then
  say "no verdict" with no reason, and FR-7 / AC-5 require the outcome be visible.
- **Constitution inlined in reviews only, decision records by index only.** D3 (a) as
  recorded; the index is not inlined (measured point 7).
- **Check lives in `constitution.ts`.** Rejected: a new `policy-file.ts`, which would put a
  new file under `packages/*/src/` and make `implements: none` false, forcing a
  requirements edit and re-approval.

## Files

| File | Change | Task |
|---|---|---|
| `docs/decisions/DR-NNN-repo-policy-file.md` (+ `INDEX.md` row) | the adopting decision record, FR-11 | 1 |
| `docs/backlog.md` | two dated lines (Follow-ups) | 1 |
| `packages/minspec/src/lib/constitution.ts` | `checkPolicyFile` + constants | 2 |
| `scripts/validate-frontmatter.ts` | new FATAL rule | 2 |
| `packages/minspec/src/lib/template-registry.ts` | `POLICY_MD` template; `VALIDATE_PY` region; CLAUDE.md / AGENTS.md pointer line; `policy-block-lib` CI-stack entry | 2, 3, 5 |
| `.minspec/policy.md` (new) | this repo's policy file | 2 |
| `.minspec/hooks/validate.py` | this repo's copy of the new region | 2 |
| `CLAUDE.md`, `AGENTS.md` | one pointer line each | 5 |
| `scripts/lib/policy-block.sh` (new) | the loader | 3 |
| `scripts/review-branch.sh`, `scripts/review-approvable.sh` | load, `--print-prompt`, fail-closed, note | 4 |
| `scripts/dispatch-issue.sh`, `scripts/remediate-pr.sh` | load, defang, prose replaced | 4 |
| `scripts/gen-ci-templates.mjs`, `packages/minspec/src/lib/ci-review-templates.ts` | register and regenerate | 3, 4 |
| `packages/minspec/tests/policy-file-check.test.ts` (new) | FR-3 / FR-9 rule cases | 2 |
| `packages/minspec/tests/policy-file-parity.test.ts` (new) | TS vs Python twin | 2 |
| `packages/minspec/tests/policy-block-lib.test.ts` (new) | loader statuses, defang | 3 |
| `packages/minspec/tests/policy-load.test.ts` (new) | FR-6 / AC-3 / AC-4 / AC-5 through the launch harness | 4 |
| `packages/minspec/tests/helpers/agent-launch-harness.ts` | fixture option: policy at base / head / removed | 4 |
| `packages/minspec/tests/managed-region-enumeration.test.ts`, `managed-region-templates.test.ts` | pinned membership 31 to 33, `CI_STACK` row | 2, 3 |
| `packages/minspec/tests/scaffold-policy.test.ts` (new) | AC-1 | 2 |

No file under `.github/` changes. Files under `.minspec/` and the scaffolded CI stack do,
so tasks 2 and 3-4 each need a human-owned or machinery merge (R2).

## Risks

- **R1 The D3 cost is over 2% of the weekly budget.** Measured point 8 puts it near 6-7%
  of review spend (inferred); its share of the cap is not yet known. Task 1.2 computes it
  first. If it exceeds 2%, DR-106 hands the decision to tenet 2, which points at D3 (b);
  that changes a recorded Clarify answer, so the build stops there and the finding is
  surfaced rather than built around.
- **R2 Two merges need a human or machinery path.** Adding `.minspec/policy.md` is withheld
  from auto-merge by design (FR-10), and `scripts/review-branch.sh` plus the CI-stack
  templates are machinery. That is the gate working; tasks are split so each pull request
  is one of the two kinds.
- **R3 A base policy change does not re-review open pull requests.** Accepted (Decisions,
  third bullet). The next push to each is reviewed under the new policy.
- **R4 A constitution item with a lead under six words is unchecked by the lead arm** and
  is caught only if the paste runs to eight words. No current lead is that short (the
  shortest is 11 words); task 2.1 includes a fixture that documents the boundary.
- **R5 Existing review-branch and dispatch tests assert prompt or output shape.** The
  fixture repositories have no policy file and no history of one, so they take
  `absent-predates`: the prompt gains a notice block and a voter verdict gains a `note`
  finding. Task 4 runs the whole suite and updates those assertions to the new expected
  output, never loosens them.

## Follow-ups (tracked)

- D5 (a), collapsing the invariant mirrors in CLAUDE.md / AGENTS.md to a pointer:
  nothing in the next 30 days depends on it, so task 1.3 adds one dated line to
  `docs/backlog.md` rather than an issue. backlog: "SPEC-292 D5 follow-up - collapse the
  CLAUDE.md / AGENTS.md invariant mirrors to a pointer at `.minspec/policy.md`".
- D3 budget measurement: done as task 1.2 before build, not deferred.
- A constitution size ceiling (it is inlined into every voter and is not under FR-9's
  ceiling): backlog line added by task 1.3. backlog: "SPEC-292 - no size ceiling on the
  inlined constitution; review cost grows with it".
