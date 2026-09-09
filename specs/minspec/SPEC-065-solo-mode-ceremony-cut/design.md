---
id: SPEC-065
type: design
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology — ceremony is the methodology, so cutting it belongs here
# tier deliberately omitted: it lives on requirements.md, the single tier-carrying
# approvable. A T3/T4 tier on a NON-approved sibling doc is read by spec-gate.py as a
# second unapproved spec and can shadow the approved requirements.md through its
# dedup-by-id over an unsorted glob (the SPEC-044 note). SPEC-065 is T4.
aspects: [governance, hitl, auto-merge, branch-protection, ai-review, profile, tier-0]
relates_to: [DR-075, DR-076, DR-086, DR-033, DR-047, DR-066, DR-061, SPEC-024, SPEC-031, SPEC-038, SPEC-051]
implements: none
implements_reason: Plan document. Ownership is already declared in the APPROVED requirements.md (implements:/affects:); a second copy here could drift from the hash-locked one. This Plan finds that declaration narrower than the design needs - see OQ-2, a founder decision, not a Plan edit.
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-065 — Design: solo mode, the DR-076 ceremony cut (Plan)

**Requirements:** [requirements.md](requirements.md) (APPROVED — read, never edited by this
Plan) · **Decisions:** [DR-075](../../../docs/decisions/DR-075.md),
[DR-076](../../../docs/decisions/DR-076.md), [DR-086](../../../docs/decisions/DR-086.md) ·
**Umbrella:** [#1169](https://github.com/AIClarityAU/minspec/issues/1169)

> **Scope discipline.** This Plan designs FR-1..FR-6 and nothing else. Three capabilities
> the requirements do not ask for were considered and are recorded as open questions rather
> than designed: a merge queue (DQ-1 explicitly leaves it open, not foreclosed), an
> `ai-review-retry` attempt cap, and `mode` becoming a typed field of `MinspecConfig`.
> Where the requirements are genuinely undecidable, the gap is flagged in **Open
> questions** — an invented requirement gets built and never re-examined; a flagged one
> gets answered.

---

## What this Plan is designing against (measured, not assumed)

Every claim below was read out of the tree at `origin/main` on 2026-09-09.

| Fact | Where | Consequence for this design |
|---|---|---|
| There is **no `mode` key** and no profile resolver anywhere in the repo | `.minspec/config.json`; `grep -rn "'solo'"` over `*.ts *.sh *.js *.yml` returns only a comment in `scripts/lib/autonomy.ts` and an unrelated test fixture | FR-1 is entirely greenfield |
| `autonomy: act` **is** set, and `mayProceed` is live at the merge arm | `.minspec/config.json`; `scripts/dispatch-issue.sh` → `autonomy_may_merge` → `scripts/lib/autonomy.sh` → `scripts/lib/autonomy.ts` | The second axis already exists and is the pattern FR-1 mirrors — and the source of the FR-2 collision (OQ-1) |
| A machinery PR is denied a SHA-bound pass witness on **both** channels | `ai-review.yml` sets `PASS_STATE=failure` when `IS_MACHINERY=true`; `decideReviewCheck` returns `neutral` for machinery (`.github/scripts/ai-review-guard.js`) | FR-2 must add a **third** channel; it cannot un-suppress these two without deleting the self-certification property |
| `ready-to-merge` greens only on `passVerified && headVerified && !changes` | `decideStatus` in `ai-review-guard.js` | The witness must satisfy `headVerified`; the `ai-review:pass` label half is already honest on a clean machinery PR |
| `on: pull_request` sources the workflow **body** from the PR head | GitHub platform behaviour; this is the fact DQ-2 measured and the reason a base checkout is not sufficient | The trusted stage cannot be a job inside `ai-review.yml` |
| A `workflow_run` workflow is sourced from the **default branch** | Measured in-repo 2026-09-09: `gh run list --workflow=main-red-watch.yml --json headBranch,event` returns `headBranch: "main"` on every `workflow_run` run, although its triggers (`CI`, `MinSpec Validate`) run on PR branches | This is the trust root FR-2 needs, and the repo already runs one (`main-red-watch.yml`, App token and all) |
| FR-4's class 1 is **still live**, narrowed but not closed | `review-decide.sh`: the `-z "$BLOCK"` branch tries `isQuotaExhaustionStrict` and otherwise falls to `echo "ai-review:changes"   # fail closed: no parseable verdict` | The non-quota half of #1234 still reads as "the reviewer wants changes" |
| FR-4's class 2 is live and **documented as open in the code itself** | `review-decide.sh`, above `BEGIN_COUNT`: *"The asymmetry costs a false `ai-review:changes` when a reviewer names the token in prose without a second block present (the reviewer half of #1157, still open)"* | FR-4 has a named, cited call site |
| `packages/minspec/src/lib/**` is bundled by tree-shaking from one entry point | `scripts/build-extension.sh`: `exec npx esbuild src/extension.ts --bundle …` | A `profile.ts` with no importer reachable from `src/extension.ts` never enters the shipped `.vsix` — the INV-4 argument, checkable |
| `ai-review.yml`, `ready-to-merge.yml`, `review-decide.sh` and `ai-review-guard.js` are **verbatim SOURCES** of the templates shipped to adopters | `scripts/gen-ci-templates.mjs` `SOURCES[]`; pinned byte-for-byte by `packages/minspec/tests/ci-review-templates-gen.test.ts` | Every file FR-2 and FR-4 must edit is an adopter-facing artifact — see **OQ-3**, the sharpest conflict this Plan found |

---

## Approach

Four seams, deliberately kept independent so they can land, fail and be reverted separately.

1. **One resolver, no second reader.** A net-new Tier-0 module `packages/minspec/src/lib/profile.ts`
   exports the profile type and exactly two functions. Every consumer — TypeScript, bash and
   YAML — reaches the setting through it. It mirrors `scripts/lib/autonomy.ts`'s
   exact-token, deny-by-default discipline byte for byte, because two settings that disagree
   about what "on" means is the drift shape this repo has already paid for twice
   (`gh-bot.sh`'s write vocabulary #1401, the machinery regex #1758).

2. **The machinery witness is a `workflow_run` job, and its trust root is GitHub's own
   default-branch sourcing.** A new `.github/workflows/machinery-witness.yml` runs after
   `ai-review-runner` completes. Because GitHub always takes a `workflow_run` workflow from
   the default branch, a PR cannot edit the file that judges it — the property is structural,
   not remembered, which is exactly what DQ-2 asked for.

3. **The witness does not re-review; it certifies that stage 1 ran base-equal code.** The
   trusted stage refuses to certify any PR that touches the *witness self set* — the
   enumerable list of files that determine stage 1's own behaviour. For every other machinery
   PR, stage 1's workflow body and control plane are byte-identical to base, so its verdict
   is as trustworthy as a base run, and the trusted stage re-verifies its provenance rather
   than re-deriving it. This is what makes DQ-2's "small and enumerable" exception real
   instead of aspirational.

4. **False reds get their own vocabulary, split by whether retrying can help.** FR-4's two
   classes are given different labels because they have different remedies: an absent
   verdict is an outage and belongs on the retry lane; a protocol-parsing anomaly is
   deterministic in the diff and must never enter it.

FR-3 and FR-5 need almost no new code. FR-3 is already true for non-machinery PRs (native
auto-merge is on and config-backed; the requirements say so under *What is already true*),
so its design work is to re-source the switch from the profile without changing the
behaviour. FR-5 is satisfied by construction: this Plan **deletes nothing**, and every
profile-keyed branch has `team` as the default arm.

---

## Design decisions, and what the rejected alternatives would have cost

- **D1 — The resolver lives in `packages/minspec/src/lib/`, not `scripts/lib/`.**
  `implements:` names `packages/minspec/src/lib/profile.ts`, and the precedent is
  `packages/minspec/src/lib/auto-merge.ts`: a pure decision core in the package, imported
  directly by `scripts/auto-merge-gate.ts` (see its import block). The import graph, not a
  test, then enforces the sharing for the TypeScript consumers.
  *Rejected: `scripts/lib/profile.ts`, alongside `autonomy.ts`.* It would have matched the
  autonomy axis exactly, and `autonomy.ts`'s header gives a real reason for that location
  (an agent acting unattended in an adopter's repo is a larger claim than one scoped here).
  Cost of rejecting it: `profile.ts` sits inside the shipped package, so INV-4 has to be
  argued rather than being true by location. The argument is checkable — the bundle is
  tree-shaken from `src/extension.ts` — and D7 turns it into a test.

- **D2 — The exported names are `Profile`, `resolveProfileMode`, `readProfileMode`; the
  config key stays `mode`.** `resolveMode` already exists in `scripts/auto-merge-gate.ts`
  and answers a *different* question (`consequence-hybrid | pr-gate`). Two functions with
  one name answering two questions in one repo is a reader trap and a grep trap.
  *Rejected: reusing `resolveMode`.* It would have made AC-2's "mirrors `resolveMode`'s
  exact-token discipline" literal. Cost: a permanent ambiguity in every future grep, and a
  real chance of a wrong import in a script that already imports the other one.

- **D3 — `team` is the deny-by-default resolution, and it is the value of *every* failure.**
  Absent key, absent file, unreadable file, malformed JSON, wrong type, misspelling, wrong
  case, `true`, `"Solo"` — all resolve to `team`. AC-2 requires the safer profile; `team` is
  the profile that holds for a human.
  *Rejected: defaulting to `solo` in a repo whose `.minspec/config.json` exists.* Cheaper to
  roll out, and tempting because this repo *is* solo. Cost: it inverts the fail direction on
  the highest-consequence setting in the repo, and it would make MinSpec's own default
  behaviour in an adopter repo depend on a file's presence rather than its content — an
  invariant-3 hazard for a one-line saving.

- **D4 — The witness is a new check-run named `machinery-witness`, not an overload of
  `ai-review/pass`.** Reusing the existing context would need no change to
  `ready-to-merge.yml` at all, because `verifyHeadPassStatus` already accepts
  `ai-review/pass`=success from an allowlisted identity. That is genuinely the smallest
  diff available.
  *Rejected because it makes a signpost lie.* `ai-review.yml` posts `ai-review/pass` =
  `failure` for a machinery PR, so the witness stage would be overwriting a failure with a
  success on the same `(sha, context)` — a race with the workflow that owns that context,
  and afterwards `ai-review/pass` would no longer mean "the AI review passed". This repo's
  own norm is one writer per gate signal (`ready-to-merge.yml`'s header states it for its
  own status). Cost of rejecting: `ready-to-merge.yml` and `ai-review-guard.js` must both
  change, which is what drags OQ-2 and OQ-3 into scope.

- **D5 — The trusted stage certifies provenance; it does not re-run the reviewer.** The
  alternative — check out the base and run `scripts/review-branch.sh` again from the trusted
  workflow — is the only design that needs no witness self set at all, because the verdict
  would be produced by base code invoked from a base file.
  *Rejected on cost and on quota.* It is a second full panel review on 13% of PRs (the
  measured machinery share), and machinery PRs are exactly the ones the panel is slowest on.
  It also doubles this repo's exposure to the `ai-review:blocked` outage class that FR-4
  exists to make legible. The accepted cost of rejecting it: correctness now depends on the
  witness self set being complete, which is a list a human maintains. D6 is the mitigation,
  and OQ-4 records the residual.

- **D6 — The witness self set is carried in `machinery-witness.yml` itself, and is checked
  from the copy that is running.** Because `workflow_run` sources that file from the default
  branch, the list that gates is always the base list; a PR cannot shrink the list in the
  same PR that would exploit the shrink. The file is itself a member of the set, so editing
  the list stops for a human.
  *Rejected: putting the set in `packages/minspec/src/lib/machinery-paths.ts` next to the
  broad machinery set.* That is where a reader would look for it, and it would be importable
  rather than hand-copied. Cost of rejecting: a fourth path-set definition in this repo,
  which is precisely the #1758 drift class — mitigated, not eliminated, by pinning the list
  with a test that parses it back out of the workflow (the `# >>> … # <<<` technique
  `ai-review-verdict-combine.test.ts` already uses to execute a workflow block verbatim).
  `machinery-paths.ts` is also undeclared in this spec's ownership (OQ-2), so editing it
  carries its own cost.

- **D7 — The profile is read from the **base** tree, never the head, and only in one place.**
  The witness stage checks out `pull_request.base.sha` and resolves the profile from that
  checkout's `.minspec/config.json`. `ready-to-merge.yml` stays profile-agnostic: it accepts
  a provenance-verified `machinery-witness` check-run, and that check-run only ever exists
  under `solo`, so the profile is enforced once, at the producer.
  *Rejected: having `ready-to-merge.yml` read the profile too.* It reads more explicitly.
  Cost: two readers of the same setting on the same decision, one of which sits in a
  `pull_request` workflow whose body comes from the head — i.e. a PR could flip its own gate
  by editing the file that reads the profile. One reader, at the trusted end, is the only
  version of this that is safe.

- **D8 — FR-4 splits the two classes rather than merging them.** Class 1 (no parseable
  verdict, not quota-shaped) becomes `ai-review:blocked`; class 2 (`BEGIN_COUNT != 1`)
  becomes a new `ai-review:unreadable`.
  *Rejected: routing both to `ai-review:blocked`.* One-line change, no new label, no
  `decideReviewCheck` arm. Cost: `ai-review-retry.yml` selects hourly on `ai-review:blocked`,
  and class 2 is **deterministic in the diff content** — a reviewer reading a DR about the
  review protocol will quote the marker on every retry — so it would create an unbounded
  hourly retry burning quota on an outcome that cannot change. The repo has already paid for
  futile retries once (#1602: five of six attempts fired inside the reset window, which is
  why the reset-marker guard exists).
  *Rejected: one new label for both.* Cleaner vocabulary. Cost: class 1 genuinely *is*
  unavailability and genuinely *is* retry-able, so it would lose the automatic recovery the
  retry lane gives it — trading a real liveness property for tidiness.

- **D9 — `machinery-witness` must never be a required status check.** It is absent by
  design on every non-machinery PR and under `team`, and a required check that is absent
  blocks. `ready-to-merge` stays the single load-bearing gate; the witness is an input to it.
  This is not a preference — making it required would make `ready-to-merge`'s green depend
  on a producer that is silent in the common case, which is the exact single-producer failure
  constitution invariant 2 names.

---

## Components, by path, and the seam at each

| Path | Ownership | Change | Seam |
|---|---|---|---|
| `packages/minspec/src/lib/profile.ts` | **new, `implements:`** | Whole file | Pure: `fs.readFileSync` + `JSON.parse` only. No `vscode`, no network, no `child_process`. Consumers import the function; nobody re-reads the file. |
| `packages/minspec/tests/profile.test.ts` | **new, `implements:`** | Whole file | T0 for FR-1/AC-1/AC-2 |
| `packages/minspec/tests/solo-mode-keep-gates.test.ts` | **new, `implements:`** | Whole file | T0 for FR-6/AC-6 |
| `.github/workflows/machinery-witness.yml` | **new, `implements:`** | Whole file | `on: workflow_run: workflows: [ai-review-runner], types: [completed]`. Own token `contents: read`; every write via the App token, SHA-pinned `create-github-app-token` exactly as `main-red-watch.yml` does. |
| `packages/minspec/tests/machinery-witness.test.ts` | **new, `implements:`** | Whole file | Parses the witness self set and the decision block back out of the YAML between `# >>> witness-self-set` / `# <<<` markers and executes them, so the test cannot drift from what CI runs |
| `.github/workflows/ready-to-merge.yml` | `affects:` | Read the head's `machinery-witness` check-runs and pass them into the guard | One extra `github.paginate(checks.listForRef, { check_name })` call and one extra argument. The decision stays in the guard. |
| `.github/scripts/ai-review-guard.js` | **UNDECLARED — OQ-2** | `MACHINERY_WITNESS_CHECK_NAME`; `verifyHeadMachineryWitness()`; a third channel in `verifyHeadPassWitness()`; an `ai-review:unreadable` arm in `decideReviewCheck()`; the label added to `VERDICT_LABELS` | Pure functions, unit-tested, mirroring `verifyHeadPassCheckRun` |
| `scripts/review-decide.sh` | **UNDECLARED — OQ-2** | Two `echo` lines: the no-parseable-verdict fall-through and the `BEGIN_COUNT != 1` refusal | stdout is the label contract; nothing else changes |
| `.github/workflows/ai-review.yml` | `affects:` | `gh label create "ai-review:unreadable"` alongside the other three; one case arm in the `# >>> verdict-combine` block | The combine block is executed verbatim by its test, so the arm is covered the moment it is written |
| `scripts/dispatch-issue.sh` | `affects:` | Under `solo`, allow the machinery-only stop class to be discharged by the witness — **blocked on OQ-1** | Reaches the profile through the same TypeScript authority, in the shape `scripts/lib/autonomy.sh` established |
| `scripts/auto-merge-gate.ts` | `affects:` | **No change this Plan can justify** — see OQ-5 | — |

**Untouched, and that is the FR-5 design.** `docs-lane.yml`, `scripts/push-docs.sh`, DR-065's
presence-gated fast-forward (`packages/minspec/src/lib/presence.ts`, `merge-refresh.ts`),
`shouldAwaitApproval` in the guard, and the drain's HITL escalations are not edited at all.
"Parked means retained" is strongest when it is enforced by the absence of a diff; AC-7 then
asserts the absence rather than trusting it.

---

## Contracts

```ts
// packages/minspec/src/lib/profile.ts — Tier-0: no vscode, no network, no exec.

/**
 * The consent axis (DR-075/DR-076): whose consent a merge requires.
 * Orthogonal to `autonomy: ask | act` (DR-086 §1), which answers whether the human
 * is consulted on a choice the agent has already analysed.
 */
export type Profile = 'solo' | 'team';

/**
 * Exact-token, deny-by-default. `solo` ONLY when the value is EXACTLY that token
 * (whitespace-trimmed). Everything else — absent, empty, misspelled, differently
 * cased, `true`, garbage — resolves to `team`. There is no fail-open path.
 * Byte-for-byte the discipline of `resolveAutonomy` (scripts/lib/autonomy.ts) and
 * `resolveMode` (scripts/auto-merge-gate.ts).
 */
export function resolveProfileMode(raw: string | undefined): Profile;

/**
 * Resolve from `<repoRoot>/.minspec/config.json` — the SOURCE, per FR-1 and #183.
 * `MINSPEC_MODE`, when present, is read THROUGH resolveProfileMode, so an env var can
 * never express a policy the config grammar cannot. Every failure — missing file,
 * unreadable, malformed JSON, absent key, wrong type — resolves to `team`.
 * A repo with no `.minspec/` therefore resolves to `team`: INV-4 by construction.
 */
export function readProfileMode(repoRoot: string, env?: NodeJS.ProcessEnv): Profile;
```

```jsonc
// .minspec/config.json — the new key. Sibling of the existing `autonomy` and
// `autoMerge` keys, which are likewise read by their own resolvers and are NOT
// fields of the `MinspecConfig` interface (packages/minspec/src/lib/config.ts).
{ "mode": "solo" }
```

```ts
// The witness, as posted by .github/workflows/machinery-witness.yml.
// A GitHub check-run on the PR's head SHA, from the minspec-sdd App.
interface MachineryWitnessCheckRun {
  name: 'machinery-witness';
  head_sha: string;                                  // GitHub-assigned; the reviewed head
  status: 'completed';
  conclusion: 'success' | 'action_required';
  output: { title: string; summary: string };        // summary names the reason, always
}
```

`conclusion` is `success` only when **all** of these hold, and the stage fails closed on any
one it cannot establish:

1. `readProfileMode(<base checkout>) === 'solo'`;
2. the PR resolved unambiguously from `workflow_run.pull_requests`, cross-checked against
   `GET /repos/{o}/{r}/commits/{head_sha}/pulls` — a disagreement, an empty list (a fork
   PR), or more than one match posts nothing;
3. the changed-file set was enumerated **completely** from
   `GET /repos/{o}/{r}/pulls/{n}/files` (trusted GitHub data, never stage 1's output) — a
   short page or an API error posts nothing;
4. the set **is** machinery per the base tree's `isMachineryPath` — if not, this witness has
   no opinion and posts nothing, because the ordinary `ai-review` witness already covers it;
5. the set touches **no** member of the witness self set — otherwise `action_required`, with
   the offending path named;
6. a provenance-verified `ai-review:pass` is bound to this head, verified through the base
   guard's `verifyPassProvenance` against the same `AI_REVIEW_BOT_LOGINS` allowlist
   `ready-to-merge.yml` uses.

```js
// .github/scripts/ai-review-guard.js — the third head-witness channel.
const MACHINERY_WITNESS_CHECK_NAME = 'machinery-witness';

/** Same shape and same deny-by-default posture as verifyHeadPassCheckRun. */
function verifyHeadMachineryWitness({ checkRuns, allowlist, headSha })
  // -> { verified: boolean, reason: string }

/** Gains one optional argument; the two existing channels are unchanged and tried first. */
function verifyHeadPassWitness({ statuses, checkRuns, allowlist, headSha, machineryCheckRuns })
```

`decideStatus` is **not** changed. It already requires `passVerified && headVerified &&
!changes`; the machinery witness only supplies `headVerified`. A non-machinery PR can never
be greened by this channel, because condition (4) above means no such witness is ever posted
for one.

```
# The witness self set, carried verbatim in .github/workflows/machinery-witness.yml
# between `# >>> witness-self-set` and `# <<< witness-self-set`, and pinned by
# packages/minspec/tests/machinery-witness.test.ts.
.github/workflows/ai-review.yml            # stage 1
.github/workflows/machinery-witness.yml    # stage 2 — this file
.github/workflows/ready-to-merge.yml       # the consumer gate
.github/scripts/ai-review-guard.js         # the decision module both stages load
scripts/review-branch.sh                   # the reviewer control plane
scripts/review-decide.sh                   # the deterministic verdict gate
scripts/roles/**                           # the voter prompts
scripts/lib/agent-context.sh               # sourced unguarded by review-branch.sh
packages/minspec/src/lib/machinery-paths.ts# the classifier the witness keys on
packages/minspec/src/lib/profile.ts        # the profile resolver the witness reads
.minspec/config.json                       # the profile value itself
```

```ts
// FR-4 — the label vocabulary after this spec.
type ReviewLabel =
  | 'ai-review:pass'        // unchanged
  | 'ai-review:changes'     // the reviewer READ the code and objects. Nothing else.
  | 'ai-review:blocked'     // the reviewer could not RUN. Retry-able; ai-review-retry owns it.
  | 'ai-review:unreadable'  // NEW. The reviewer ran, but its output could not be read as a
                            // verdict. Deterministic in the diff, so NOT retry-able.
  | 'ai-review:pending';    // unchanged
```

---

## Invariants, and how each is tested

T0 first: every row below is written and red before the behaviour it constrains exists.

| Invariant | What must hold | T0 test, by execution |
|---|---|---|
| **INV-1** / constitution 2 — no silent gate | No new load-bearing signal is written with a swallowed error; a missing or errored witness fails closed **and visibly** | `machinery-witness.test.ts`: drive the decision block with each failure input (no PR, PR disagreement, short files page, API error, base checkout missing, guard unloadable) and assert the outcome is "post nothing or `action_required`", never `success`; and assert every such path emits a `::warning` — the #810 lesson, where a silently swallowed 403 made a required gate unsatisfiable repo-wide |
| **INV-1**, second witness | `ready-to-merge` must not come to hinge on the machinery witness alone | `machinery-witness.test.ts`: with the witness absent, a non-machinery PR still greens through the existing `ai-review/pass` **or** `ai-review` channels; `verifyHeadPassWitness` tries the two existing channels before the new one |
| **INV-2** — approval stays human under both profiles | `checkApprover` / `assertHumanApprover` (`packages/minspec/src/lib/approval.ts`) deny an agent identity regardless of `mode` | `solo-mode-keep-gates.test.ts`: run against a fixture repo with `mode: solo` and again with `mode: team`; assert identical denial |
| **INV-3** — irreversible/outward-facing stays human under both profiles | `mayProceed` denies `irreversible-or-outward-facing` and `approval-or-acceptance` whatever the profile says | `solo-mode-keep-gates.test.ts`: call `mayProceed('act', …)` and also drive the whole bash seam (`dispatch-issue.sh --autonomy-stop-classes` and the `autonomy_may_merge` path) with a `mode: solo` fixture config; assert `proceed: false` under both profiles |
| **INV-4** / constitution 3 — blast radius | The profile is per-project and changes nothing in a repo without `.minspec/` | `profile.test.ts`: `readProfileMode(<tmpdir with no .minspec>)` is `team`; and an import-shape assertion that `src/extension.ts` has no path to `profile.ts`, so `scripts/build-extension.sh`'s `esbuild src/extension.ts --bundle` tree-shakes it out of the shipped `.vsix` (the shape `auto-merge.test.ts` already uses to pin `auto-merge.ts`'s purity) |
| Constitution 1 — offline | `profile.ts` makes no network call | Same import-shape assertion: the module's import list is exactly `node:fs` and `node:path` |

### FR-6's keep list, asserted by execution (AC-6)

Each gate runs **twice** — once against a fixture repo whose `.minspec/config.json` says
`mode: solo`, once `mode: team` — and the assertion is that the outcome is identical **and**
is the rejecting one. Profile-invariance is the property; running both arms is what proves it
rather than asserting it.

| Keep gate (DR-076) | Executed entry point | Assertion |
|---|---|---|
| Hash-locked approval staleness | `canonicalSpecHash` + `resolveStatus` / `getApprovalStatus` (`approval.ts`) over a fixture spec and sidecar, with one content byte edited | status resolves stale under both profiles |
| Tier classifier upward-only floor | `applyFloor(predicted, userTier)` (`classifier.ts`) | `applyFloor('T4', 'T1') === 'T4'` under both |
| Frontmatter / validator gates | `validateSpec` and `validateOwnership` (`spec-validator.ts`) on a T4 fixture with no `implements:` | the same `ownership.implements.missing` violation under both |
| RCDD `Root cause:` hook | spawn `.githooks/commit-msg <tmpfile>` with a `fix:` subject and no `Root cause:` line | non-zero exit under both |
| T3/T4 approval stays human | `checkApprover` — INV-2 row above | denied under both |
| Irreversible / outward-facing stays human | `mayProceed` — INV-3 row above | `proceed: false` under both |

A source-text check that the profile is imported only by its declared consumers is worth
having as a T1 drift guard, but it is **explicitly not** how AC-6 is discharged — AC-6 says
"by execution, not by source text", and the table above is the execution.

### The rest of the acceptance criteria

| AC | Tier | How |
|---|---|---|
| AC-1 (FR-1) | T0 | `profile.test.ts`: with `env` emptied, drive **each** consumer's resolution path — `readProfileMode` directly, and the bash seam — against one fixture repo, and assert they return the same value. Asserted by driving consumers, not by reading the file |
| AC-2 (FR-1, negative) | T0 | `profile.test.ts`: a table of `undefined`, `''`, `'Solo'`, `' solo '` (accepted, trimmed), `'sol o'`, `'true'`, `'team '`, `{}`, `42`, malformed JSON, missing file → every one resolves `team` except the exact token |
| AC-3 (FR-2) | T0 + T2 | `machinery-witness.test.ts`: the decision block, executed verbatim from the YAML, returns `success` for a machinery PR with a verified pass and no self-set touch, and `action_required` for one that touches a self-set path. Both halves, as AC-3 requires. The end-to-end merge is a T2 observation on the first real machinery PR after landing |
| AC-4 (FR-3) | T0 | `machinery-witness.test.ts` + `profile.test.ts`: with `mode: team` the witness stage posts nothing, so `ready-to-merge` holds exactly as today |
| AC-5 (FR-4) | T3, red-then-green | `review-decide.test.ts` extension, using **reproductions** of #1234 and #1157: a voter output with no verdict block and no quota phrasing → `ai-review:blocked`; a voter output that names `REVIEW_VERDICT_BEGIN` in prose with a single real block → `ai-review:unreadable`. Both must be red against today's script before the fix |
| AC-6 (FR-6) | T0 | The keep-list table above |
| AC-7 (FR-5) | T0 | `solo-mode-keep-gates.test.ts`: with `mode: team`, the docs-lane / presence-ff / `awaiting-approval` seams behave as they do today — driven through `shouldAwaitApproval` and the presence predicates, plus an assertion that the profile is not an input to any of them |

---

## Build order

Named, not numbered, and ordered so that nothing behavioural lands before the T0 that
constrains it.

- **The keep-list slice (FR-6).** `solo-mode-keep-gates.test.ts` alone. Depends on nothing,
  changes nothing, and must be green *before* any profile-keyed branch exists — otherwise
  the keep list is prose again.
- **The resolver slice (FR-1).** `profile.ts` + `profile.test.ts`. Lands with **no `mode`
  key in `.minspec/config.json`**, so it resolves `team` and nothing changes. Turning the
  profile on is a separate human act — `.minspec/` paths are withheld from native auto-merge
  by `paths_have_approvable_doc`'s second mandate, so the config PR reaches a human by
  construction. This is the same landing posture `scripts/lib/autonomy.sh` states for its own
  key, and for the same reason.
- **The false-red slice (FR-4).** `review-decide.sh`, the `decideReviewCheck` arm, the label
  creation and the combine arm. Independent of the profile entirely, useful on its own, and
  it makes solo mode safer rather than depending on it. Blocked only by OQ-2/OQ-3.
- **The witness slice (FR-2).** `machinery-witness.yml`, the guard channel,
  `ready-to-merge.yml`'s extra read, and `machinery-witness.test.ts`. Blocked on OQ-3.
- **The arm slice (FR-2/FR-3, dispatch).** Blocked on OQ-1. Until it lands, a machinery PR
  under `solo` reaches a **green** `ready-to-merge` and then waits for a merge keystroke —
  which is already a strictly better position than today's total block, and is a safe
  intermediate state to sit in.

## Dependency budget

Zero new dependencies. Everything uses what is already here: `node:fs`/`node:path`, `jq`,
`actions/github-script`, the SHA-pinned `create-github-app-token`, and vitest.

## Risks

- **The witness self set is a human-maintained list (D5/D6).** If a file that determines
  stage 1's behaviour is added and not added to the list, a PR touching it could be certified
  by a stage it had influenced. Mitigations: the list is checked from the base copy, it
  contains itself, and `machinery-witness.test.ts` asserts each named path exists on disk and
  is a member of the broad machinery set. Residual: OQ-4.
- **Concentration, as the requirements already record.** Under `solo` the AI review is the
  only reader of most changes, so a false green matters more. Nothing in this design widens
  what counts as a green: the witness supplies only the head-binding half of a decision that
  still requires a provenance-verified `ai-review:pass` label and no `ai-review:changes`.
- **`strict` is on (DQ-1, applied 2026-08-22).** Every merge invalidates every other open
  PR's base, so a machinery PR that becomes mergeable may still need a merge-forward first.
  That is the accepted cost recorded in the requirements, not a new one — but it interacts:
  unattended machinery merges raise the merge rate, which raises the rebase rate.
- **A persistently non-conforming voter under D8.** Class 1 routes to `ai-review:blocked`,
  which `ai-review-retry.yml` re-runs hourly. A voter that never emits a verdict block for a
  non-quota reason would loop. Existing mitigation: the retry's reset-marker guard. An
  attempt cap would close it properly, but `ai-review-retry.yml` is neither declared here nor
  asked for by any FR — recorded as a follow-up, not designed.

---

## Open questions

Each of these is genuinely undecidable from the approved requirements. None is resolved here.

- **OQ-1 — FR-2 collides with DR-086 §2.1, and the collision is in code.**
  FR-2 requires a machinery PR to merge under `solo` with no human keystroke. But
  `scripts/dispatch-issue.sh`'s `autonomy_stop_classes_for_paths` maps `MACHINERY_PATH_RE`
  to the stop class `irreversible-or-outward-facing`, and `mayProceed`
  (`scripts/lib/autonomy.ts`) denies on **any** non-empty stop-class list *whatever the
  autonomy setting says* — deliberately, because stop classes outrank the setting. So under
  today's code, `--auto` is never armed on a machinery PR and a green `ready-to-merge` merges
  nothing. DR-086 §1 declares the two axes orthogonal; here they are not.
  Two resolutions exist and both are amendments, not implementations. **(a) The witness
  discharges the class**: dispatch stops emitting `irreversible-or-outward-facing` for a
  machinery path when the profile is `solo` *and* a verified `machinery-witness` exists,
  which keeps the frozen list intact and confines the change to `dispatch-issue.sh`
  (declared) — **(rec)**, because it is the smallest change and leaves DR-086's list
  untouched; its cost is that "the stop class was discharged by a witness" is a new concept
  that DR-086 §2 does not currently contain, so the list stops being purely enumerable.
  **(b) Amend DR-086 §2.1** to scope the machinery clause by profile — honest and explicit,
  but it edits an accepted DR and `scripts/lib/autonomy.ts` is out of this spec's declared
  ownership *and* is itself a §2.6 stop class ("anything that would edit this list").
  ➡️ This is a founder decision. Until it is answered, the arm slice cannot be designed, and
  designing it either way would be inventing a requirement.

- **OQ-2 — the approved ownership declaration is narrower than any correct implementation.**
  `affects:` lists `ai-review.yml`, `ready-to-merge.yml`, `auto-merge-gate.ts`,
  `dispatch-issue.sh`. The design needs three files that appear in neither `implements:` nor
  `affects:`: `scripts/review-decide.sh` (owned by SPEC-031 — FR-4's only call site),
  `.github/scripts/ai-review-guard.js` (unowned by any spec — FR-2's witness channel and
  FR-4's check arm), and a bash seam for the profile (a new `scripts/lib/profile.sh`, or an
  extension of `scripts/lib/autonomy.sh`). This does not mechanically block anything —
  `validateOwnership` checks presence and path validity, not completeness, and the spec-gate
  only blocks a file an *unapproved* spec declares — but it leaves SPEC-038's map wrong for
  the files the work actually touches. Fixing the declaration means editing hash-locked
  frontmatter, which stales the founder's sign-off: SPEC-051's trap, exactly.
  ➡️ Founder decision: re-approve after an `affects:` amendment, or accept the widened set as
  a Plan-level record. This Plan does not edit `requirements.md`.

- **OQ-3 — every file FR-2 and FR-4 must edit is shipped to adopters, and Out of Scope
  forbids that.** `scripts/gen-ci-templates.mjs`'s `SOURCES[]` embeds `ai-review.yml`,
  `ready-to-merge.yml`, `review-decide.sh` and `ai-review-guard.js` **verbatim** into
  `packages/minspec/src/lib/ci-review-templates.ts`, and
  `packages/minspec/tests/ci-review-templates-gen.test.ts` pins the regeneration
  byte-for-byte. So an FR-2 or FR-4 PR either reddens that test or regenerates the templates —
  and regenerating is a change to what MinSpec installs in an adopter's repo, which the
  requirements' *Out of Scope* rules out. `ci-review-templates.ts` is also, by
  `machinery-paths.ts`'s own reckoning, the machinery with the largest blast radius in the
  repo, so the PR that regenerates it is the hardest PR here to merge — the exact block FR-2
  exists to lift, encountered on the way to lifting it.
  A narrow reading is available and may well be the intent: the profile-keyed branches are
  **inert** in an adopter repo, because a repo with no `mode` key resolves to `team` and
  behaves byte-for-byte as today, so *behaviour* in a non-opting repo is unchanged and
  constitution invariant 3 is satisfied even though bytes move. **(rec)** — it is the only
  reading under which FR-2 and FR-4 are buildable at all; its cost is that adopters receive a
  `ready-to-merge.yml` that reads a `machinery-witness` check no producer in their repo will
  ever post, and an `ai-review:unreadable` label they never see, which is dead surface in
  somebody else's repository.
  ➡️ Founder decision, because it turns on how Out of Scope was meant.
  **Note:** the new `machinery-witness.yml` is *not* in `SOURCES[]`, so the new file itself
  ships nowhere. Only the edits to the four existing files are affected.

- **OQ-4 — how complete must the witness self set be, and who keeps it complete?**
  D5's correctness reduces to that list. This Plan proposes the eleven entries above and a
  test that each exists and is machinery, but nothing derives the list from the actual
  determinants of stage 1's behaviour, and a derivation is not obviously possible (a workflow
  file's transitive dependencies are not statically enumerable across YAML, bash and Node).
  The requirements say the exception must be "small and enumerable" but do not say who
  enumerates it or what happens when the enumeration is wrong.
  ➡️ Needs an answer before the witness slice ships. A candidate worth costing at Tasks: make
  the *broad* machinery set the self set for a first release — i.e. certify nothing, which is
  today's behaviour — and narrow it only once the enumeration has a maintainer.

- **OQ-5 — `scripts/auto-merge-gate.ts` is declared in `affects:` and this design finds
  nothing it needs.** The consequence-hybrid gate is mutually exclusive with native
  auto-merge (`native_automerge_enabled` returns 1 when `MINSPEC_AUTOMERGE_MODE ==
  consequence-hybrid`), and FR-3's unattended path is the native one, so the SPEC-024 gate is
  not on it. AC-2 cites `resolveMode` as a *pattern to mirror*, not a thing to change. Either
  the declaration anticipates a change this Plan has not found — most likely keeping
  `BOUNDARY_DIR_PREFIXES` in lock-step with the machinery set, which this design does not
  narrow — or it is a precautionary listing.
  ➡️ Confirm the intent before Tasks, so the slice is not padded with a change nobody asked
  for.

- **OQ-6 — DR-086's own follow-up asked SPEC-065's Clarify a question it did not answer.**
  DR-086's *Follow-ups (tracked)* says: *"`autonomy` joins `mode` as a second axis on FR-1's
  single-resolver setting; the Clarify pass must decide whether it is one setting with two
  fields or two settings."* SPEC-065's Clarify pass (DQ-1..DQ-4) does not cover it, and
  `autonomy` has since shipped as its own top-level key with its own resolver in
  `scripts/lib/autonomy.ts`. This Plan assumes **two settings, two resolvers, one grammar**,
  because that is what already exists and because merging them would edit `autonomy.ts` (out
  of scope, and a §2.6 stop class). But it is an assumption filling a hole the requirements
  left, so it is recorded here rather than presented as decided.
  ➡️ Confirm, or say so and the resolver slice merges the two.

- **OQ-7 — should `mode` become a typed field of `MinspecConfig`?** It currently would not
  be: `autoMerge` and `autonomy` are both read by their own resolvers and are absent from the
  `MinspecConfig` interface (`packages/minspec/src/lib/config.ts`), so `mode` following them
  is the consistent choice and is what this Plan designs. DR-086's own amendment note calls
  the same gap out for `autonomy` — *"the setting is unvalidated and invisible to the product
  surface"* — and tracks it as minspec#1795. Adding `mode` to `MinspecConfig` would be
  scope creep here and would duplicate #1795's work.
  ➡️ Recorded so the decision is deliberate rather than inherited.

## Follow-ups (not designed here)

- An attempt cap for `ai-review-retry.yml`, so a persistently non-conforming voter cannot
  loop forever (the D8 risk). Not asked for by any FR; `ai-review-retry.yml` is undeclared.
- A merge queue as the eventual answer to `strict`'s serialisation cost. DQ-1 explicitly
  leaves it open and not foreclosed; it is not this spec's work.
- `allow_update_branch` is `false`, so there is no one-click affordance to soften `strict`.
  DQ-1 names enabling it as "a sensible companion change" and says it is **NOT** part of that
  decision — so it is not part of this Plan either.
