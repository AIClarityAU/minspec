---
id: SPEC-069
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-069 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - same epic as DR-081, the accepted decision this contracts
relates_to: [DR-081, DR-047, DR-063, DR-066, DR-108, DR-112, SPEC-031, SPEC-054, SPEC-065, SPEC-071, "#1376", "#1654", "#1029", "#3216", "#3270"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-069 - Design: an approval-record PR is settled by a deterministic witness

Plan for [requirements.md](requirements.md). The contract is that file; this one says how
to build it. Citations of "today" are against `origin/main` at `00f9ce35`, the commit this
plan was written on. The requirements were written at an earlier commit and several of
their line numbers have moved (for example the `on:` block is now `ai-review.yml:176-178`,
not `:145-147`); this file cites the symbol first and the line as a hint. New code is named
by symbol, because its line numbers will move.

## Approach in one paragraph

One new pure-JavaScript module, `.github/scripts/approval-record-pr.js`, answers the
path-shape question (FR-1), the arming question (FR-9, FR-10) and the witness question
(FR-6, FR-7), with no hashing in it. Every hash is computed by the existing
`scripts/approval-provenance.py`, which gains a `--gate` mode that returns a
machine-readable verdict and a non-zero exit, while its advisory output stays byte for byte
what `review-branch.sh` reads today (FR-4). A new workflow, `approval-integrity.yml`, runs
both from a trusted base checkout and posts the `approval-integrity` check-run as the
reviewer App (FR-3, FR-7, FR-8, D-2). It ships advisory. `ai-review.yml` learns to skip every
voter for a content-neutral approval-record set, but only while `approval-integrity` is in
the branch's required set and its workflow is active, which it reads from GitHub on each run
(FR-5, FR-9, FR-10). `ready-to-merge.yml` accepts the integrity check-run as the head
witness, but only on a head whose `ai-review` check-run is that exemption (FR-6). Turning
the saving on is then one ruleset act, which is the founder's, after the advisory run has
agreed with the panel five times in a row (D-5) and after delegated approvals can pass the
approver check (see *Sequencing with the PR #3216 spec*).

## Clarify selections this plan builds on

requirements.md records D-1 to D-6 as questions with a recommendation each, and its
`clarify: done` was signed with them in place. This plan builds the recommended option for
each and states the cost the requirements already name, so a reader can see what is being
accepted. If the founder later picks another option, the task that changes is named.

| Decision | Built as | Cost accepted | Task that changes if overturned |
|---|---|---|---|
| D-1 approver list | `approvers` in `.minspec/config.json`, read from the BASE commit (the key already exists: `config.ts:88`, value `["github@harvest316.com"]`) | The list is gate surface. Reading it from base means an approval PR cannot widen its own list; a PR that edits the list is not an approval-record set (FR-1) and gets the full panel | 4 |
| D-2 trusted checkout | `approval-integrity.yml` checks out `pull_request.base.sha`, fetches the head as data only, exactly as `ai-review.yml` does | A PR that changes the checker is judged by the previous checker. Such a PR touches `.github/` and is never an approval-record set | 5 |
| D-3 cancel on close | Every close, merged or not | A PR merged by `--admin` while its review ran loses the post-hoc verdict that review would have written | 6 |
| D-4 downstream | This repository only (see *Blast radius*) | Adopter repositories keep paying the full panel on approval PRs | none; a later decision adds the workflow and module to the template registry |
| D-5 rollout bar | 5 consecutive approval-record PRs on which the check and the panel agree | About a week of full-panel spend before any saving | 11 |
| D-6 tier | T4 | none further | none |

## What the plan relies on (read at 00f9ce35)

- **The four gate files are shipped to adopters verbatim.** `scripts/gen-ci-templates.mjs`
  embeds `ai-review.yml` (`:43`), `ready-to-merge.yml` (`:49`), `approval-provenance.py`
  (`:128`) and `ai-review-guard.js` (`:167`) into `ci-review-templates.ts`, and
  `npm run validate` fails when the embedded copy is stale. So every edit to those four
  reaches adopter repositories on their next refresh. The design makes each edit inert
  there by construction (next section); it does not try to keep the edits out of the copy.
- **The required set is readable by the App.** `GET /repos/AIClarityAU/minspec/rules/branches/main`
  with an installation token from `~/.claude/scripts/gh-app-token.sh` returned 200 on
  2026-10-28, with one `required_status_checks` rule from ruleset 18352261 listing `lint`,
  `test`, `MinSpec SDD validation`, `ai-review`, `ready-to-merge`, `build`.
  `GET .../actions/workflows/ai-review.yml` with the same token returned 200. Measured from
  the container with the App's installation token, not from inside an Actions run; task 9
  re-checks it in a run.
- **`approval-provenance.py` already computes FR-3's hard part.** `report_for`
  (`approval-provenance.py:182-277`) compares the sidecar's `specHash` against
  `spec_hash()` of the approvable at head, using `canonical.py` (the Python twin, parity
  pinned by `canonical-parity.test.ts`). It reads `merge_base(base, head)` (`:111`) so it
  judges the same tree `git diff base...head` shows. `_is_agent_identity` (`:303`) already
  refuses `[bot]`, `unknown` and empty approvers for DR acceptance. Its `_git` and `_show`
  helpers return `''`/`None` on any git failure, which is right for facts and wrong for a
  gate; gate mode must not use them unwrapped.
- **ready-to-merge is re-run only by `pull_request` events** (`ready-to-merge.yml:96`:
  opened, synchronize, reopened, labeled, unlabeled). A check-run completing does not
  re-run it. The ai-review verdict reaches it today because the App's label write fires
  `labeled`.
- **`decideStatus`** (`ai-review-guard.js:1811`) is green only on a verified
  `ai-review:pass` plus a verified head witness; **`decideReviewCheck`**
  (`ai-review-guard.js:1984`) maps a machinery PR to `neutral` and is the only place the
  `ai-review` conclusion is chosen. **`verifyHeadPassCheckRun`** (`:1708`) is the pattern
  for an App-identity, head-SHA, completed-and-success check-run witness.
- **Delegated approvals are routine.** SPEC-231's sidecar (merged in #3156) carries
  `approvedBy: "minspec-sdd[bot]"`, `basis: "delegation:DLG-001"`, and `baselineBlob: ""`.
  FR-3(5) as written ("a permitted human approver") fails that record.
- **The delegated-approval spec** (spec-only PR #3216, open; its id is not settled, so this plan cites the PR) makes delegated records pass the provenance
  facts and says the CI wiring of `approval-integrity` stays with SPEC-069; its FR-9 lists
  what it needs from that wiring: head bytes read from a base checkout, full history, the
  repository identity, and a way to resolve dependencies.

## Blast radius (INV-5, D-4)

Nothing in this plan adds a file to the template registry. The two new files,
`approval-integrity.yml` and `approval-record-pr.js`, exist only in this repository. The
edits to the four shipped files are inert in an adopter repository because each new branch
depends on one of those two files:

- `ai-review.yml` arms the exemption only when `approval-integrity` is a required check AND
  its workflow file is active. An adopter has no such workflow, so the arm read returns
  "not armed" and every PR takes the panel, as today.
- `ready-to-merge.yml` takes the new witness branch only when
  `.github/scripts/approval-record-pr.js` exists in its base checkout, and only on a head
  whose `ai-review` check-run is the exemption, which an adopter never posts.
- `approval-provenance.py --gate` has no caller downstream. The advisory mode
  `review-branch.sh` calls is unchanged.
- `decideStatus` and `decideReviewCheck` gain optional parameters whose absence keeps
  today's result.

`managed-script-dependencies.test.ts` asserts that a managed script never calls an
unmanaged sibling, because an inert caller downstream was once a silent bug (#1026). Here
inertness downstream is the intended behaviour, so task 8 adds an explicit test: the
rendered adopter copy of `ready-to-merge.yml`, run against a base with no
`approval-record-pr.js`, takes today's path. That makes the deliberate gap visible rather
than accidental.

## Architecture

### `approval-record-pr.js` (owned, `implements:`)

CommonJS, no dependencies, Node built-ins only, loadable from a base checkout by
`actions/github-script` and by `node -e`. Every export is pure.

- `sidecarApprovable(path)` - for `.minspec/approvals/<rel>.json` returns `<rel>`, else
  `null`. Strips the exact prefix and suffix; never a pattern guess (FR-1b). Rejects a
  `<rel>` that is empty, absolute, or contains a `..` segment.
- `classifyChangedSet(entries)` - `entries` is `[{ path, status }]` with status one of
  `A M D T` (from `git diff --name-status --no-renames`) or the GitHub `pulls.listFiles`
  spellings (`added modified removed changed`), normalised inside. Returns
  `{ isApprovalRecord, sidecars, approvables, reason }`. True iff the list is non-empty,
  every path is a sidecar or an approvable that a changed sidecar in the same list points
  at, and no sidecar is deleted. A `renamed` entry, an unknown status, or a list the caller
  marks truncated is `false` with a reason. Commit message, title and labels are not
  inputs (FR-1).
  - *The deleted-sidecar rule is a narrowing this plan adds.* FR-3(1) requires every
    changed sidecar to parse at head, so a set that deletes one can never pass the check.
    Exempting it from the panel would leave the PR red with no reviewer at all. Excluding
    it sends that PR to the panel, which is the "expensive, never unchecked" direction
    FR-9 names.
- `isIntegrityArmed({ rules, workflow })` - `rules` is the parsed body of
  `GET /rules/branches/main`, `workflow` the parsed body of
  `GET /actions/workflows/approval-integrity.yml`. True iff some rule of type
  `required_status_checks` lists the context `approval-integrity` AND `workflow.state` is
  `active`. Anything else, including a non-array `rules`, a missing body, or an error
  object, is `false` (FR-9, FR-10).
- `decideIntegrityCheck({ set, gate, error })` - maps the classification and the gate
  verdict to `{ conclusion, title, summary }`: `neutral` with title
  "not an approval-record PR" when `set.isApprovalRecord` is false for a determinate
  set, or when the set qualifies on paths but `gate.contentNeutral` is false (FR-2: the
  PR is an ordinary content PR and the panel reviews it); `success` when the gate verdict
  passes; `failure` otherwise, with the first failing predicate and its path in the title
  and every failure listed in the summary (FR-8). An indeterminate set (no list, git
  error) or any `error` is `failure`, never `neutral`.
- `verifyIntegrityWitness({ checkRuns, allowlist, headSha })` - the
  `verifyHeadPassCheckRun` rules for the name `approval-integrity`: head SHA match,
  latest by completion time, `completed` + `success`, posting App slug in the allowlist.
  Deny by default (FR-7, INV-6).
- `isApprovalRecordExemption({ checkRuns, allowlist, headSha })` - true iff the latest
  `ai-review` check-run on the head is from an allowlisted App, `completed`, `neutral`,
  and carries `external_id: "approval-record-exempt"`.
- `INTEGRITY_CHECK_NAME = 'approval-integrity'`, `EXEMPT_EXTERNAL_ID`.

### `approval-provenance.py --gate` (modified, `affects:`)

`approval-provenance.py --gate <base> <head>` prints one JSON object and exits 0 when
every changed sidecar passes, 1 when any fails, 2 on a usage error or any internal error.
The advisory call with two arguments is untouched, and its output for every existing test
fixture stays byte-identical (FR-4, R6).

```text
{ "verdict": "pass" | "fail",
  "contentNeutral": true | false,
  "sidecars": [ { "sidecar", "approvable", "ok", "failures": [ { "predicate", "detail" } ] } ] }
```

- Gate mode uses its own strict git helpers that raise on failure; an exception anywhere
  is exit 2 with the message on stderr. Nothing is swallowed (FR-8, INV-1).
- Predicates, in FR-3 order: `parse` (JSON object with the six required fields),
  `specPathSelf` (`specPath` equals the path derived from the sidecar's own location),
  `hashMatch` (`specHash == spec_hash(approvable @ head)`), `approvableExists`,
  `approver`, `baselineBlob` (when the value is 40 hex, `git cat-file -e <value>^{blob}`
  succeeds; an empty or absent value passes, as FR-3(6) is conditional).
- `contentNeutral` is true iff every approvable present in the changed set has
  `spec_hash(@ merge-base) == spec_hash(@ head)` (FR-2). It reuses `spec_hash`; there is
  no new hashing code (FR-4, INV-4).
- `approver`: `approvedBy` must be in `approvers` read from `.minspec/config.json` at the
  merge base, and `_is_agent_identity` must return `None`. A missing file, missing key, or
  empty list at base fails the predicate with that reason (D-1). The check is one function,
  `approver_reason(record, base)`, so the PR #3216 spec can extend it with the delegation witness
  without touching the others.

### `approval-integrity.yml` (owned, `implements:`)

Two jobs.

**`integrity`** on `pull_request` `[opened, synchronize, reopened]`, concurrency group
`approval-integrity-<pr>` with cancel-in-progress. Permissions `contents: read`. Steps:

1. Mint the App token (the `ai-review.yml` step, same pinned action). Unset secrets: post
   nothing and fail the job with an error annotation. That leaves no `approval-integrity`
   check-run, which while advisory blocks nothing and once required blocks visibly.
2. Check out `pull_request.base.sha`, `fetch-depth: 0`, `persist-credentials: false`
   (D-2). Fetch the head SHA as data. A failed fetch is a failure, not an empty diff.
3. `git diff --name-status --no-renames base...head` into a file; a non-zero exit or an
   empty list is an indeterminate set.
4. `node` loads `approval-record-pr.js` from the base checkout and classifies the set.
   If it qualifies on paths, run `python3 scripts/approval-provenance.py --gate base head`
   and keep stdout and the exit code.
5. `decideIntegrityCheck`, then post the `approval-integrity` check-run on the head SHA
   with the App token. The post is the load-bearing write: no `|| true`, retried like
   `ready-to-merge.yml`'s `withRetry`.
6. Remove, then add, the label `approval-integrity` as the App, so `ready-to-merge` sees a
   `labeled` event after the check exists. The label is a trigger only; nothing reads it
   as evidence. Only on an approval-record set.
7. `if: failure()` - post `approval-integrity` = `failure` with "internal error: <step>"
   when the token exists, so an error in steps 2 to 6 is red and named (FR-8).

**`cancel-review`** on `pull_request` `[closed]` (FR-12, D-3). Job-level
`concurrency: { group: ai-review-pr-<pr>, cancel-in-progress: true }`, the same group
`ai-review.yml:187-189` uses, and one no-op step. Entering the group cancels the in-flight
`ai-review` run. I believe, unverified, that a job-level group and a workflow-level group
with the same name share one namespace in a repository; task 6 proves it on a real closed
PR before it is relied on. If they do not, the fallback is the same job inside
`ai-review.yml` with `closed` added to its trigger and every other job guarded on the
action, which ships to adopters and therefore needs its own D-4 answer.

The workflow file is not templated, so neither job reaches an adopter (D-4).

### `ai-review.yml` (modified, `affects:`)

- **New step `arm`**, after the App token, `continue-on-error: true`: reads the two
  endpoints above with the App token and writes `armed=yes|no` from
  `isIntegrityArmed`. Any error, a missing module in the base checkout, or a missing token
  writes `armed=no` (FR-9). The token is used only inside this step's `gh api` calls, the
  same confinement the carry step uses.
- **In the review step**, between the END of the machinery classification and the
  `verdict-carry-apply` block, a marked block `>>> approval-record-exempt` runs when
  `ARMED=yes`, `CHANGED_OK=yes` and `SELF_EDIT=no`: it classifies
  `git diff --name-status --no-renames "$BASE...$HEAD"`, and on a qualifying set runs
  `approval-provenance.py --gate` and reads `contentNeutral`. The gate's pass or fail on
  the other predicates does not matter here; that is `approval-integrity`'s verdict to
  give. If the set qualifies and is content-neutral, the block writes `exempt=approval-record`,
  `is_machinery=false`, a body file explaining the exemption, and exits the step before
  `run_voter` is defined. Any failure inside the block falls through to the panel (FR-5).
- **`decideReviewCheck(label, isMachineryPr, carried, exemption)`**: when `exemption` is
  `'approval-record'` it returns `neutral`, title "AI review: approval record - settled by
  approval-integrity, voters not run", and `externalId: 'approval-record-exempt'`; the
  check-run post step passes `external_id` through. Machinery wins over exemption if both
  were ever true (they cannot be: an approval-record set has no machinery path).
- **The post step** on an exempt run removes `ai-review:pending` and applies no verdict
  label: not `pass`, which would be a false review claim, and not `changes`, which would
  block. It posts the body file as the review comment. No summon, no remediation.
- INV-7: after this change `decideReviewCheck` returns `neutral` for exactly two reasons.
  Task 7's test enumerates them.

### `ready-to-merge.yml` and `decideStatus` (modified, `affects:`)

- **`decideStatus({ ..., integrityWitness })`**: when `integrityWitness` is supplied and
  `verified`, it satisfies the same slot as `passVerified && headVerified`. `CHANGES` and
  `hold:*` still make the status red. Description: "approval record verified by
  approval-integrity". Omitted: unchanged behaviour.
- **In the workflow**, only when `require.resolve('./.github/scripts/approval-record-pr.js')`
  succeeds in the base checkout: list the PR's files with `pulls.listFiles` (status per
  file; more than 3000 files or a read error counts as not an approval-record set), classify,
  and if it qualifies read the head's check-runs for `approval-integrity` and `ai-review`.
  `integrityWitness.verified` is `verifyIntegrityWitness(...)` AND
  `isApprovalRecordExemption(...)`. Requiring the exemption marker means that while the
  check is advisory, and in every adopter, an integrity success never shortens the path:
  the PR still needs the panel's pass (FR-10 step 1). Read errors leave the witness
  unverified.
- `ready-to-merge.yml` gains `checks: read` use for a second name only; its permissions
  block already has `checks: read`.

### Sequencing with the PR #3216 spec (delegated approvals)

Once `approval-integrity` is required and the exemption arms, a content-neutral approval
PR is decided by `approval-integrity` alone. A delegated record (`approvedBy:
minspec-sdd[bot]`) fails FR-3(5) as SPEC-069 states it, so from that moment every delegated
approval PR would be red until merged by `--admin`, which is the bypass DR-081 forbids.
That spec is the one that makes the approver check accept a covered delegation. So the
ruleset act (task 12) waits until either the PR #3216 spec's approver extension has merged into
`approver_reason`, or delegated approvals have stopped. Nothing before task 12 is affected:
while advisory, a red `approval-integrity` on a delegated record blocks nothing, and it is
counted as a disagreement only if the panel passed a record the check failed for a reason
other than the delegation (task 11 says how it is counted).

That spec's FR-9 needs, from this wiring: head bytes read from a base checkout (step 2 and
`_show(head, ...)`), full history (`fetch-depth: 0`), the repository identity (pass
`GITHUB_REPOSITORY` into the gate step's environment), and a way to resolve dependencies.
The last is that spec's own D1; this plan installs nothing in the integrity job.

## Files

| File | Change | Owner |
|---|---|---|
| `.github/scripts/approval-record-pr.js` | new | this spec (`implements:`) |
| `.github/scripts/approval-record-pr.test.js` | new | this spec (`implements:`) |
| `.github/workflows/approval-integrity.yml` | new | this spec (`implements:`) |
| `scripts/approval-provenance.py` | `--gate` mode | `affects:` |
| `.github/workflows/ai-review.yml` | arm step, exempt block, `external_id`, post step | `affects:` (SPEC-031 owns) |
| `.github/workflows/ready-to-merge.yml` | integrity witness branch | `affects:` |
| `.github/scripts/ai-review-guard.js` | `decideStatus`, `decideReviewCheck` parameters | `affects:` |
| `.github/workflows/ci.yml` | one `node --test` line for the new test file | `affects:` |
| `.github/scripts/ai-review-guard.test.js` | cases for the two guard changes | not in `affects:`; it is the guard's shipped suite and every guard change adds its cases here (SPEC-211) |
| `packages/minspec/tests/approval-provenance.test.ts` | gate-mode cases | not in `affects:`; the existing test file of an `affects:` script |
| `packages/minspec/tests/approval-integrity-workflow.test.ts` | new: workflow shape tests | not in `affects:`; a test, owned by no spec |
| `packages/minspec/tests/ai-review-approval-exempt-glue.test.ts` | new: runs the marked block verbatim | as above, same pattern as `ai-review-verdict-carry-glue.test.ts` |
| `packages/minspec/src/lib/ci-review-templates.ts` | regenerated by `node scripts/gen-ci-templates.mjs`, never by hand | generated |

## Invariants, and how each is tested

| Invariant | Test | How |
|---|---|---|
| INV-1 no silent gate | `approval-record-pr.test.js`, `approval-provenance.test.ts`, `approval-integrity-workflow.test.ts` | Every FR-8 case yields `failure` with a named predicate; gate mode exits 2 on a planted git failure (a missing head SHA) instead of 0; the workflow test asserts the check-run post step and the label step carry no `|| true` and that an `if: failure()` step posts `failure` |
| INV-2 record, never approvable | `approval-record-pr.test.js`, glue test | A sidecar plus an edited body line of its own approvable is `contentNeutral: false`, gets `neutral` from integrity, and the glue block runs the panel; a spec-only PR is not a set at all |
| INV-3 offline | `approval-integrity-workflow.test.ts` | The integrity job has no `claude`, `npm ci` or `curl` call; `approval-record-pr.js` requires only Node built-ins (asserted by scanning its `require` calls) |
| INV-4 one hash | `approval-integrity-workflow.test.ts` | `approval-record-pr.js` contains no `createHash`; the corpus scan in `canonical-parity.test.ts` still finds exactly two canonicalizers |
| INV-5 blast radius | `approval-integrity-workflow.test.ts`, task 8's test | Neither new file is an `outputPath` in the template registry; the rendered adopter `ready-to-merge.yml` with no module takes today's path |
| INV-6 identity + SHA | `approval-record-pr.test.js` | A success from a non-allowlisted slug, from the right slug on another SHA, or without the exemption `external_id` does not verify |
| INV-7 two exemptions | `ai-review-guard.test.js` | The set of inputs for which `decideReviewCheck` returns `neutral` is exactly machinery and approval-record |

Each check has a negative control in the same file: a planted fault that turns it red.

## Testing

- **`approval-record-pr.test.js`** (`node --test`, CI line added in task 1): table cases for
  `classifyChangedSet` (sidecar only; sidecar + own approvable; two sidecars + their two
  approvables; + any third path; sidecar + unrelated approvable; deleted sidecar; renamed;
  unknown status; empty list; `..` in the derived path); `isIntegrityArmed` over recorded
  API bodies (required + active; required + `disabled_manually`; active + not required;
  error object; `null`); `decideIntegrityCheck` for each conclusion; the two verifiers.
- **`approval-provenance.test.ts`** (real git + `python3`, the file's existing harness):
  the #1029 shape (spec edited in an earlier merged commit, sidecar-only PR) passes; a
  forged hash fails `hashMatch`; malformed JSON fails `parse`; a record filed under another
  path fails `specPathSelf`; a deleted approvable fails `approvableExists`; a bot or
  unlisted approver fails `approver`; a 40-hex `baselineBlob` naming no object fails;
  `approvers` widened at head but not at base still fails; advisory output for every
  existing fixture is unchanged.
- **`approval-integrity-workflow.test.ts`**: parses the YAML; triggers, base checkout,
  `persist-credentials: false`, pinned actions, job-level concurrency group text equals
  `ai-review.yml`'s group text, no load-bearing `|| true`, the failure step exists.
- **`ai-review-approval-exempt-glue.test.ts`**: extracts the `approval-record-exempt` block
  and runs it in a fixture repository with `run_voter` replaced by a function that appends
  to a file. Exempt case: the file is empty and the outputs say `exempt=approval-record`.
  Not armed, not content-neutral, extra path, `CHANGED_OK=no`, machinery: the block falls
  through. That asserts zero voters on the run, as the acceptance criterion asks, not the
  absence of a comment.
- **Live, recorded in the PR or issue that closes the task**: task 6 (a closed PR cancels a
  running review), task 9 (the arm step reads both endpoints inside Actions), task 12 (the
  first armed approval PR: zero voters in the log, `ready-to-merge` green without
  `--admin`).

## Build order

1. Pure module and its CI line (tasks 1, 2), then gate mode (tasks 3, 4). These carry the
   invariant tests and change no gate.
2. The advisory workflow (task 5) and the cancel job (task 6). From here the check runs on
   real approval PRs and blocks nothing.
3. The guard parameters (task 7), the ready-to-merge branch (task 8) and the ai-review
   exemption (task 9). All three are inert until the ruleset act, so their order among
   themselves is free; this order keeps each PR reviewable alone.
4. The advisory count (task 11) and the delegated-approval check (task 10), then the founder's
   ruleset act (task 12), which arms everything at once.

## Design decisions and the rejected alternatives

- **Arm from the required set, read live, not from a repository variable.** R2 asks that
  the exemption be armed off the check's required-ness. A variable is a hand-flipped flag
  that can say "armed" while the check is not required, which is "green and unchecked".
  Cost: two API reads per ai-review run, and a read failure costs a full panel.
- **ready-to-merge trusts the integrity witness only beside the exemption marker.** The
  alternative, reading the required set again in ready-to-merge, gives two readers that can
  disagree: ai-review exempts, ready-to-merge reads "not armed", the PR is red with no
  review. Keying on the marker ai-review posted means both always act on one reading.
  Cost: ready-to-merge reads one more check-run name.
- **Hashing stays in Python.** FR-4 forbids a third hasher, and the Node twin is
  TypeScript that the base checkout cannot run without a build. Cost: the integrity and
  ai-review jobs need `python3`, which the runner image has and `review-branch.sh` already
  uses.
- **A label toggle re-runs ready-to-merge.** The alternative, `workflow_run`, runs without
  the `pull_request` payload that ready-to-merge's base pin depends on
  (`ready-to-merge.yml` "Require a trusted base commit"). Cost: one remove and one add per
  integrity run, so two queued ready-to-merge runs.
- **Non-approval PRs get `neutral` from integrity, not `success`.** Once required, the check
  must not block ordinary PRs, and `success` on a PR it did not examine would read as a
  verification. Cost: one more `neutral` on the PR's check list; it is not an `ai-review`
  exemption, so INV-7 is unaffected.
- **No exemption for a deleted sidecar** (see `classifyChangedSet`). Cost: an un-approval
  PR keeps paying for the panel.

## Follow-ups (tracked)

- Delegated approvers in `approver_reason`: the PR #3216 spec (spec PR #3216, delegated approval
  records reach the approval PR gates). Task 12 waits on it.
- Downstream shipping (D-4 option b): no issue by design, as requirements.md records;
  a decision to ship files the issue.
- The ruleset act: task 12, the founder's.
- None other.
