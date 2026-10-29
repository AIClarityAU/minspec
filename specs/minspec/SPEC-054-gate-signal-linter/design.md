---
id: SPEC-054
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-054 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
relates_to: [DR-066, DR-063, DR-005, DR-033, DR-055, SPEC-071, "#895", "#1859", "#2671", "#810", "#854", "#857", "#560"]
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: pending
---

# SPEC-054 - Design: the DR-066 gate-signal linter

Plan for [requirements.md](requirements.md), built under the seven recorded Clarify decisions
(DQ-1 to DQ-7, every recommendation accepted). Citations of "today" are against `origin/main`
`281774d9`, the commit this plan was written on. The spec took its line numbers months earlier
and many have moved (`ai-review.yml` grew by about 400 lines); "Reconciliation with main" gives
what moved. New code is cited by symbol, because its line numbers will move too.

This linter enforces **two of constitution invariant 2's three clauses** (clause 1, swallowed
gate-signal writes; clause 3, single-witness required contexts). Clause 2 has no detector after
this ships (DQ-5).

## What Plan found that the spec did not have

1. **A clause-1 lint already exists, with a different predicate.** `scripts/check-swallowed-gate-signal.ts`
   and its pure half `scripts/lib/swallowed-gate-signal.ts` (#1859, extended by #2671) landed
   after this spec was written. It flags a *captured* value whose failure is swallowed and which
   later drives control flow (`swallowed-gate-signal.ts:11-22`), in `.sh` files and `package.json`
   scripts only. FR-1's predicate is a different property: a *write* of a commit status,
   check-run or gate label whose failure is unobserved or unsurfaced, in workflow YAML, workflow
   JavaScript and scripts. Neither predicate implies the other: `gh pr edit --remove-label
   "ai-review:pass" 2>/dev/null || true` (`ai-review.yml:269`) captures nothing, so #1859 never
   sees it, and a swallowed `ready=$(gh ... || true)` writes nothing, so FR-1 never sees it.
   **Decision:** build FR-1 as the spec names it (`scripts/check-gate-signals.ts`), alongside
   #1859's lint, not as an extension of it. The two keep separate markers (`swallow-ok:` is
   same-line; `gate-signal-allow:` is line-above per FR-2), so one line can need both and the
   reason for each stays specific. *Rejected:* widening #1859's lib to cover writes. Its
   three-property definition of "load-bearing" is the reason it is landable (118 `|| true`
   under `scripts/`, `swallowed-gate-signal.ts:24-27`); grafting a second, unrelated predicate
   onto it makes both harder to reason about and shares no logic beyond a line splitter.
2. **The App cannot push workflow files.** The installation has no `workflows` scope (host
   DR-079), so any commit touching `.github/workflows/**` is pushed by the founder. #1859 met
   the same wall and enforced its lint through a T0 vitest test instead of a named CI step
   (`check-swallowed-gate-signal.ts:31-38`). This plan cannot avoid workflow edits entirely:
   FR-6 requires the FR-1 step in `ci.yml`'s `lint` job, a new FR-3 job, and FR-2 annotations
   on the swallowed writes in `ai-review.yml`. Those land together in **one machinery pull
   request**, pushed and merged by the founder (task group 5). Everything else is agent-landable
   first, so that pull request is small and reviewable.
3. **Running FR-1 "as the existing `lint` job" means its required context is `lint`, which is
   already required.** FR-6 allows "as (or alongside) the existing `lint` job". As a step in
   `lint`, FR-1's verdict reaches the ruleset through the `lint` context, which is one of
   `main`'s six required contexts today. So the only new required context is the FR-3 job's,
   named `gate-witnesses`. AC-10's self-membership check asserts `lint` and `gate-witnesses`.
   *Rejected:* a separate `gate-signals` job. It adds a second ruleset mutation (a founder
   act, since the App lacks administration write) and a second context to keep required, for
   no detection gain.
4. **The existing ruleset tooling FR-6 names is `updateRulesetRequiredChecks`**
   (`ruleset-advisor.ts:841`): GET, idempotent union of contexts preserving `integration_id`
   pins, full PUT. It is the safe path; a hand-retyped PUT payload drops required checks (a
   ruleset update is a full replacement). It needs administration write, which only the
   founder's account holds, so the ruleset step is founder-only (task 6.1).
5. **No YAML parser is a dependency, and none is added.** Dependency budget is 0. The scanner
   reads workflows line by line with indentation tracking, the way
   `scripts/check-gh-bot-attribution.sh` already does, and fails closed on any block shape it
   does not recognise. JavaScript (`github-script` `script:` blocks and `.github/scripts/*.js`)
   is parsed with the `typescript` compiler API, already a root dev dependency
   (`package.json:41`).
6. **The FR-4 follow-up issue was never filed.** The spec says to record its number on the FR-4
   tombstone, but requirements.md is hash-locked, so the number goes in this file's Follow-ups
   instead (task 7.1), not into requirements.md.

## Reconciliation with main (`281774d9`)

| Spec cites | Today | Note |
|---|---|---|
| `ruleset-advisor.ts:274` `rulesetGuardsDefaultBranchChecks` | `:296` | not exported |
| `ruleset-advisor.ts:574` `RulesetFull` | `:651` | not exported |
| `ruleset-advisor.ts:589` `extractRequiredContexts` | `:666` | not exported |
| `ruleset-advisor.ts:608-640` `listRequiredCheckContexts` | `:685-723` | same three-way `null` collapse, plus the per-ruleset `continue` on detail GET and parse failure |
| `ai-review.yml:224-231` four `gh label create` self-heals | `:256-266`, now five (`ai-review:carried` added) | excluded by the DQ-7 decision below |
| `ai-review.yml:233-234` | `:269`, `:273`, `:274` | three swallowed label writes now |
| `ai-review.yml:964-969` status post | `:1384` onward | `if ! gh api ... statuses ...` |
| `ai-review.yml:810-812`, `:878-880` check-run posts | `:1220`, `:1288` | `if ! gh api -X POST .../check-runs ... >/dev/null; then` |
| `ai-review.yml:973`, `:1054` bare writes | `:1411`, `:1585` | observed under inherited `-e` |
| `ai-review.yml:976`, `:978`, `:1055-1056` | `:1445`, `:1483`, `:1485`, `:1560`, `:1600`, `:1605`, `:1617` | swallowed; candidates for annotation |
| `scripts/review-pr.sh:209` | `:259` | `--remove-label ... 2>/dev/null \|\| true` under `set -euo pipefail` (`:21`) |
| `ready-to-merge.yml:387-445` octokit label writes | `:526-583` | |
| `ci.yml:68-69` `check:gh-bot` step | `lint` job at `:68`, step at `:120-121` | |

The list of day-one findings above is verified-not-exhaustive, exactly as FR-6 says. The
implementing pull requests take the scanner's own output as authoritative. Tests key on line
**content**, never on these numbers.

## Components

Four owned files (requirements.md `implements:`), plus edits to files the spec does not own.

| File | Role | Network |
|---|---|---|
| `scripts/lib/gate-manifest.ts` | FR-5 typed manifest, the gate-label set | none |
| `scripts/check-gate-signals.ts` | FR-1/FR-2 scanner: pure exported functions + an IO entry under a main guard | none |
| `scripts/audit-gate-witnesses.ts` | FR-3 checker + AC-10 self-membership: pure exported functions + an IO entry that owns its `gh` calls | `gh api` only |
| `packages/minspec/tests/gate-signal-linter.test.ts` | every AC's test | none (FR-3 is driven through an injected runner) |
| `packages/minspec/src/lib/ruleset-advisor.ts` (edit) | export three pure helpers (INV-4) | - |
| `package.json` (edit) | `check:gate-signals`, `audit:gate-witnesses` | - |
| `scripts/**` (edits) | FR-2 annotations on agent-pushable findings | - |
| `.github/workflows/*.yml`, `ci-review-templates.ts` (machinery) | annotations, the `lint` step, the `gate-witnesses` job, regenerated templates | - |

The pure-plus-IO split in one file follows `scripts/audit-ruleset-integration-ids.ts` rather
than adding a fifth owned file. The test imports the pure exports; the IO entry runs only when
the file is executed directly.

## The manifest (FR-5, DQ-1, DQ-3)

```ts
export type SignalMechanism = 'status' | 'check-run' | 'label';

/** One independent signal a required context rests on. */
export interface GateWitness {
  workflow: string;            // '.github/workflows/ai-review.yml'
  job: string;                 // the job id key
  step?: string;               // the step name, when one step posts it
  mechanism: SignalMechanism;
  signal: string;              // the status context, check-run name or label written
  permission: 'statuses:write' | 'checks:write' | 'pull-requests:write' | 'issues:write';
  app: string;                 // posting identity, e.g. 'github-actions[bot]', 'minspec-sdd[bot]'
}

export interface GateEntry {
  context: string;             // the required ruleset context, verbatim
  witnesses: readonly GateWitness[];
  /** FR-3 option (b): set only when the sole witness fails closed and visibly. */
  failClosed?: { reason: string; evidence: string }; // evidence = repo path proving it
}

export const GATE_MANIFEST: readonly GateEntry[];
export const GATE_LABEL_PATTERNS: readonly RegExp[]; // ai-review:*, ready-to-merge, awaiting-approval, blocked-by
```

Entries at ship: the six required contexts recorded at `docs/decisions/DR-047.md:47` (`lint`,
`test`, `MinSpec SDD validation`, `ai-review`, `ready-to-merge`, `build`) and `gate-witnesses`.

- **`ready-to-merge`** carries two witnesses, the `ai-review/pass` commit status and the
  `ai-review` check-run, both from `ai-review.yml`. They differ in mechanism, so AC-6 passes.
  The three context strings (`ai-review/pass`, `ai-review`, `ready-to-merge`) stay distinct
  fields, as AC-6 demands; the test asserts it.
- **`ai-review`** has one witness (its own check-run), so it is AC-5-shaped and ships with a
  `failClosed` entry whose evidence is the fail-closed post at `ai-review.yml:1288` onward. A
  second witness is out of scope.
- **`lint`, `test`, `build`, `gate-witnesses`** are Actions job contexts: one witness each, the
  job's own check-run. Their `failClosed` reason is that a required context that never reports
  blocks the merge as "Expected - waiting for status", which is visible; their evidence is
  `ci.yml`.
- **`MinSpec SDD validation`** is AC-9's expected single-witness finding. It ships with a
  `failClosed` entry citing `minspec-validate.yml`'s final `exit 1` arm (#933). That is my
  reading of the file, not something its code asserts; the reviewer of task 1.2 checks it.

A `failClosed` entry is an escape hatch of the same kind as FR-2's annotation, so it carries
the same two properties: a non-empty reason and a non-empty `evidence` path the test proves
exists, and the FR-3 run prints every `failClosed` entry it honoured, every run.

**Freshness (R3).** Without a new FR, the test checks the manifest offline against the tree:
every witness's workflow file exists and contains its `job` as a job key, and, when `step` is
set, a step of that name. This catches a renamed or removed producer at the pull request that
renames it. It cannot prove the step still *posts* the signal; that stays residual.

**SPEC-071.** Its DQ-3 recommends extending this manifest. The types are exported so it can;
this spec adds no field for it.

## FR-1 scanner

### Inputs and walk

`.github/workflows/*.yml` (`run:` and `actions/github-script` `script:` blocks),
`.github/scripts/**/*.js` (excluding `*.test.js`), and `scripts/**` files ending `.sh`, `.js`,
`.mjs`, `.ts` (excluding tests). `packages/minspec/src/lib/ci-review-templates.ts` is
generated (`scripts/gen-ci-templates.mjs`) and excluded; its source files are scanned.

**Fail closed.** An unreadable file, a missing root, a walk that found zero workflows, or a
block scalar the extractor does not recognise is an error: exit 2, message names the file. No
path exits 0 without having read the tree, the same rule #1859's checker states
(`check-swallowed-gate-signal.ts:24-29`).

### Write predicate (what is a gate-signal write)

- **Status:** `gh api ... /statuses/...`, `createCommitStatus(`.
- **Check-run:** `gh api ... /check-runs` with a POST or PATCH (`-X POST`, `-X PATCH`,
  `--method`, or any `-f`/`-F`/`--input` field, which makes `gh api` POST by default).
  A GET read (`?check_name=`, no fields) is not a write. Also `checks.create(`, `checks.update(`.
- **Label:** `gh pr edit` / `gh issue edit` with `--add-label` or `--remove-label`;
  `issues.addLabels(`, `issues.removeLabel(`, `issues.setLabels(`.

A label write is **gate-relevant** when any label it names matches `GATE_LABEL_PATTERNS`.
**Decision on the fork DQ-7 left open: the narrower predicate.** Creating a label *object*
(`gh label create`, `issues.createLabel`) is not a gate-signal write and is never matched.
*Why:* it writes no state on any pull request, issue or commit, so a reader of the gate never
sees it. If creation fails and the label is then needed, the dependent `--add-label` fails, and
that write is the one the scanner judges. *Cost:* a future gate that reads label *existence* as
a signal would be missed; none exists today. *Rejected:* annotating each self-heal. There are
now five at `ai-review.yml:256-266` alone plus others (`ai-review.yml:1333`, `:1558`, `:1615`,
`main-red-watch.yml:91`), and a waiver that every reader learns to skip is R2's rubber stamp.

**Label named by a variable** (`--add-label "$LABEL"`, `--remove-label "$_other"`): the scanner
cannot resolve it, so it treats it as gate-relevant. This fails toward more findings, which
costs annotations rather than a silent pass. *Rejected:* resolving same-file assignments; it is
a shell evaluator in miniature and still misses values that arrive from another step.

### Shell exit-status model (FR-1 "unobserved", FR-6 corollary)

Each shell text unit (a `run:` block, or a `.sh` file) starts with an `errexit` flag:

- A workflow `run:` block inherits `-e` from the Actions default shell. An explicit `shell:`
  on the step decides instead: `bash` and `sh` keep `-e`; a custom template without `-e`
  (`bash {0}`) clears it. An inner `set -uo pipefail` does **not** clear it
  (`ai-review.yml`'s own comment, cited in FR-6).
- A `.sh` file has `-e` only when a top-level `set` turns it on (`set -e`, `set -euo
  pipefail`, `set -o errexit`) or the shebang carries `-e`.
- A later `set +e` / `set +o errexit` clears it until a `set -e` restores it. This is shell
  semantics; the spec's model names the `shell:` override as the way `-e` is removed, and this
  adds the only other one, which can only produce more findings, never fewer.

A gate-signal write is then classified:

| Shape | Verdict |
|---|---|
| bare statement, `errexit` on | observed, fails the step: **ok** |
| bare statement, `errexit` off | **unobserved** |
| `... \|\| true`, `\|\| :`, trailing `; true` | **unobserved** |
| inside `local`/`export`/`declare`/`readonly` assignment, or a substitution embedded in another command (`echo "$(gh ...)"`) | **unobserved** (the outer command's status masks it) |
| plain `x=$(gh ...)` with `errexit` on | observed: **ok** |
| `if ! W; then B; fi`, `if W; then ...; else B; fi`, `W \|\| B`, `W \|\| { B; }` | look at failure branch `B` |

The failure branch `B` is **surfaced** when it contains one of the surfacing forms, or fails the
step (`exit` with a non-zero literal, `return` non-zero, `false`). Surfacing forms (R5's
allowlist, kept as one exported constant in `check-gate-signals.ts`, extended only by a code
change): `::warning`, `::error`, `>> "$GITHUB_STEP_SUMMARY"` (any quoting), and in JavaScript
`core.warning(`, `core.error(`, `core.setFailed(`, `core.summary`. A branch with none of these
and no failing exit is **unsurfaced**. A redirect on the write (`>/dev/null`, `2>/dev/null`,
`>/dev/null 2>&1`) never decides the verdict on its own (FR-1 carve-out).

Continuation lines (`\` endings) are joined before classification, with the reported line being
the write's first line. Like #1859's lexer, this is not a full shell parser and does not follow
a write into a function defined elsewhere; it under-reports. A pass is a floor on clause 1, not
a proof.

### JavaScript model (github-script blocks and `.js` files)

Parsed with `ts.createSourceFile`. For each call matching the write predicate:

| Shape | Verdict |
|---|---|
| awaited (or returned) and not inside a `try`, not chained with `.catch` | throw fails the step: **ok** |
| neither awaited, returned, nor chained (floating promise) | **unobserved** |
| `.catch(handler)` | handler is the failure branch |
| inside `try { } catch (e) { handler }` | handler is the failure branch |

A handler is surfaced when it calls a JavaScript surfacing form or rethrows (`throw`), including
a conditional rethrow such as `ready-to-merge.yml`'s `isBenignRemovalError` path (`:573-583`).
An empty handler or one that only logs with `console.log` is **unsurfaced**. A handler that
calls a local helper is followed one level into a same-block function declaration; deeper than
that it is unsurfaced and needs an annotation.

### FR-2 annotation and waiver summary

The token is `gate-signal-allow: <reason>`, on the line immediately above the write's first
line, after the host language's comment leader: `#` in shell and YAML, `//` in JavaScript (a
`#` is a syntax error there). That is the only reading of FR-2's `# gate-signal-allow:` that
can annotate a `github-script` write; FR-2's placement rule and reason rule are unchanged.

- A reason shorter than one non-space word is a finding (`bare annotation`), mirroring
  `check-gh-bot-attribution.sh:53`.
- An annotation not followed by a gate-signal write is a finding (`orphan annotation`), so a
  waiver cannot survive the line it waived being deleted.
- Every run prints a waiver summary, including `0 waivers honoured`, listing file, line and
  reason for each (`check-gh-bot-attribution.sh:216-219`'s rule).

### Output and exit

`file:line  <unobserved|unsurfaced|bare annotation|orphan annotation>  <the write>`, then the
waiver summary, then a count. Exit 0 = no findings; exit 1 = findings; exit 2 = could not do its
job. AC-7 rests on exit 1 failing the `lint` job.

## FR-3 checker

### Read (DQ-6, INV-4)

The checker owns its `gh` invocations through an injected `CommandRunner`-shaped function (the
type `ruleset-advisor.ts` already uses), so tests drive every branch without a network:

1. `gh api --paginate repos/{owner}/{repo}/rulesets`. Non-zero exit, unparseable output, or a
   non-array is **read failure**: exit 2 with the reason and `gh`'s stderr.
2. Select, re-implementing the loop at `ruleset-advisor.ts:701-721` (R6, accepted): skip
   `target !== 'branch'`, `enforcement === 'disabled'`, non-numeric `id`. GET each candidate's
   detail. **Unlike that loop, a failed GET or an unparseable body is read failure (exit 2),
   never `continue`**, which closes the two collapse points INV-4 names.
3. Apply the exported `rulesetGuardsDefaultBranchChecks` to each detail, and the exported
   `extractRequiredContexts` to each guarding one. **Union** the contexts across every guarding
   ruleset, where `listRequiredCheckContexts` returns the first match: GitHub enforces every
   active ruleset, so the union is what a merge actually needs. No guarding ruleset, or a union
   of zero contexts, is a finding with its own message (DQ-6: different from a read failure).

`{owner}/{repo}` come from `--repo owner/name` or `GITHUB_REPOSITORY`; neither set is exit 2.

### Evaluate (pure)

`evaluateWitnesses(required, manifest, self)` returns findings, one per rule:

- required context with no manifest entry: `no manifest entry`;
- entry with fewer than two distinct `mechanism` values and no `failClosed`:
  `single witness (AC-5)`;
- `failClosed` with an empty reason or evidence: `invalid fail-closed annotation`;
- AC-10 self-membership: each name in `self` (`lint`, `gate-witnesses`, exported as a constant)
  absent from `required`: `not a required context`, printing the observed list in full.

A manifest entry whose context is not required is printed as a notice (stale manifest), not a
finding: it does not weaken any gate, and the freshness test owns manifest hygiene.

The run prints every `failClosed` entry honoured, every run. Exit 0 / 1 / 2 as FR-1.

### Network posture

This is the only networked path (FR-7, INV-2). It uses the job's own `github.token`. Reading
rulesets needs only metadata read, as far as I know (unverified): the first run in CI proves
it, and a 403 is read failure, exit 2, loudly, which is the correct outcome if the belief is
wrong. A GitHub API outage reds every merge with no sanctioned escape (DQ-4's accepted cost).

## CI wiring (FR-6) - the machinery pull request

- `ci.yml` `lint` job: a step `Check gate-signal writes (DR-066 clause 1)` running
  `npm run check:gate-signals`, under the job's existing `docs_only` gating. A docs-only change
  set cannot add a gate-signal write, because `.github/**` and `scripts/**` are outside the docs
  corpus (`ci.yml:31-58`); task 5.2 confirms that from the classifier's path list.
- `ci.yml` new job `gate-witnesses` (name and job id both `gate-witnesses`, so the context
  string matches `self`): no path filter, no `docs_only` skip, `permissions: contents: read`,
  `env: GH_TOKEN: ${{ github.token }}`, `npm ci` then `npm run audit:gate-witnesses`. Never
  `continue-on-error` (INV-1).
- FR-2 annotations on every swallowed write the scanner reports in `.github/workflows/**`,
  with `scripts/gen-ci-templates.mjs` re-run so `ci-review-templates.ts` matches.
- A T0 test that runs the scanner over the real tree and expects exit 0. It must land in this
  same pull request: before the workflow annotations exist it is red, and it runs in `test`.

**Ordering.** On the machinery pull request itself, `gate-witnesses` fails AC-10 because the
ruleset does not yet require it. That is the spec's stated correct signal (AC-10), and the job
is not yet required, so it does not block the merge. The founder then adds `gate-witnesses` to
the ruleset (task 6.1), re-runs the job on `main`, and the live read is recorded (task 6.2).
Between merge and 6.1, `main` shows one red non-required check: #857's shape for minutes, not
days. *Rejected:* adding the context to the ruleset first; that blocks every open pull request
until the job exists on their base.

## Invariants, and where each is held

| Invariant | Held by |
|---|---|
| INV-1 no silent gate, reflexively | both jobs required (`lint` already, `gate-witnesses` by 6.1); AC-10 self-membership; exit 2 on any could-not-run path in both scripts; no `continue-on-error` (test greps `ci.yml`) |
| INV-2 offline core | AC-8 test: static import audit of `check-gate-signals.ts` and `gate-manifest.ts` (no `child_process`, `node:http(s)`, `fetch(`, `octokit`); `package.json`'s `lint`, `check:*` and `pretest` scripts never reach `audit-gate-witnesses` |
| INV-3 blast radius | only this repo's `scripts/`, `ci.yml`, workflow comments and its own ruleset; the workflow comment edits reach adopters through the managed `ai-review.yml` template, and are comments only |
| INV-4 one source of truth | the three exported pure helpers are imported, never copied; the test asserts `audit-gate-witnesses.ts` imports them and contains no `required_status_checks` literal of its own |

## Rejected alternatives (DR-086 section 4)

- Extending #1859's lint (finding 1). Separate `gate-signals` context (finding 3). A YAML
  dependency (finding 5). Annotating label-object creation (DQ-7 fork). Resolving
  variable label names. First-match ruleset selection (silently ignores a second active ruleset).
  Ruleset mutation before the job exists (ordering).

## Risks added by this plan

| # | Risk | Mitigation |
|---|---|---|
| P1 | The line-based workflow extractor misreads an unusual block scalar and skips a write. | Unrecognised shapes are exit 2, not skipped; the test covers the literal, strip-literal and folded block forms and a one-line `run:`. |
| P2 | Variable-named labels produce more day-one annotations than the spec's list. | Each costs one reasoned line; the waiver summary keeps them countable. |
| P3 | The founder push of the machinery pull request stalls the spec at its last mile. | Groups 1-4 leave that pull request as comments, one step, one job and one test, so the ask is small; 6.1 is one paste. |

## Follow-ups (tracked)

- FR-4 / clause 2 detector: filed by task 7.1; record its number here. Until then: not filed.
- `MinSpec SDD validation` and `ai-review` staying single-witness with `failClosed` entries is
  FR-3 option (b) as the spec allows, not a deferred item. None.
