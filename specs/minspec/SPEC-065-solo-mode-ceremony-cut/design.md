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
# phases: kept, not the majority pattern (2 of 21 other design.md files on main carry one:
# SPEC-044, SPEC-051) but the precedent this doc follows deliberately - SPEC-051 is the
# same shape (status: planning, implements: none, a Plan document mid-SDD-cycle) and
# carries the identical block for the same reason: status: alone is one value and cannot
# say specify/clarify are done while plan is in-progress and tasks/implement are still
# pending, which is real state a T4 Plan-phase doc needs to expose. Not used to gate
# anything here - requirements.md's `tier` is what spec-gate.py reads.
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
> the requirements do not ask for were considered and deliberately not designed: a merge
> queue and an `ai-review-retry` attempt cap are tracked follow-ups (#1394, #1204 – see
> *Follow-ups*), and `mode` becoming a typed field of `MinspecConfig` is OQ-7. A fourth, an
> environment-variable override of `mode` that an earlier draft of this Plan designed, has
> been **removed**: no FR or AC asks for one, and it could loosen policy (see *Contracts*).
> Where the requirements are genuinely undecidable, the gap is flagged in **Open
> questions** — an invented requirement gets built and never re-examined; a flagged one
> gets answered.

---

## What this Plan is designing against (measured, not assumed)

Every claim below was read out of the tree at `origin/main` on 2026-09-09, and re-checked on
2026-09-11 against this PR's merge of `origin/main` at `267c1f2c`. Line numbers throughout are
from that merged tree.

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
| `ready-to-merge.yml` subscribes **only** to `pull_request` (`opened, synchronize, reopened, labeled, unlabeled`), and reads the PR's labels from the event payload | `.github/workflows/ready-to-merge.yml:82-90`, `:176` | Its `labeled` run fires when `ai-review-runner` applies `ai-review:pass`, i.e. **before** that run completes, so before any `workflow_run` witness can exist, and nothing re-runs it afterwards. The witness has to drive the re-evaluation itself (D10) |
| This repo already re-runs a `pull_request` workflow from another workflow, using `GITHUB_TOKEN` with `actions: write` | `.github/workflows/ai-review-retry.yml:27-29` (permission), `:129-135` (`gh run rerun`) | The re-evaluation seam D10 uses is already in production here, not new |
| Two more machinery-only signals say "a human must review" | `ai-review.yml:936-986` posts `machinery-review-required` = `action_required`, titled *"Machinery PR — human review required"* (`:956`); `shouldSummonHumanReview` returns true for any machinery PR (`ai-review-guard.js:975-977`), and `ai-review.yml:1184-1201` then applies `needs-human-review` | Neither gates a merge: neither is among the six required checks (`requirements.md:58-60`), and `needs-human-review` is read as a countermand only on **issues** (`scripts/dispatch-ready-check.sh:635`). But both would be false on a machinery PR that merges unattended – see **OQ-8** |
| The broad machinery set is six directory prefixes plus two generator files | `packages/minspec/src/lib/machinery-paths.ts:52-78`; hand-copied at `ai-review.yml:404` and `scripts/dispatch-issue.sh:143` | `profile.ts`, `machinery-paths.ts` and `.minspec/config.json` are **not** machinery. That constrains the witness self set (see *Contracts*) and raises **OQ-9** |
| The native auto-merge arm is decided when dispatch opens the PR, before any review has completed | `scripts/dispatch-issue.sh:1048-1089` (`gh pr merge --auto` at `:1084`) | Nothing that needs a witness to exist can be evaluated at that seam – see **OQ-1** |
| `tsx` is pinned, and `scripts/lib/autonomy.sh` refuses to fetch a runner over the network | `package.json:36` (`tsx` 4.23.1); `autonomy.sh:87-99`; `.github/workflows/dr-id-collision.yml:55-73` runs TypeScript in CI after `npm ci` | How bash and YAML execute `profile.ts` (see *Contracts*): the pinned runner from `node_modules/.bin`, never `npx` |
| #1839 (patch-fingerprint re-attestation) records a fingerprint, and nothing consumes it yet | `ai-review-guard.js:366-376` (*"has no production caller"*); the consumer is #1840 | The witness reads neither the fingerprint nor `findReattestableVerdict`. It depends only on `ai-review:pass` label provenance and on `ai-review-runner` completing |

---

## Approach

Five seams, deliberately kept independent so they can land, fail and be reverted separately.

1. **One resolver, no second reader.** A net-new Tier-0 module `packages/minspec/src/lib/profile.ts`
   exports the profile type, two resolver functions and one CLI entry. TypeScript consumers
   import it. Bash (`scripts/dispatch-issue.sh`) and YAML (`machinery-witness.yml`) *execute*
   it through the pinned `tsx` runner and read one token from its stdout, under a single
   consumer rule (grammar in *Contracts*). Nothing else reads the `mode` key. Its value grammar
   mirrors `scripts/lib/autonomy.ts`'s exact-token, deny-by-default `resolveAutonomy` byte for
   byte, because two settings that disagree about what "on" means is the drift shape this repo
   has already paid for twice (`gh-bot.sh`'s write vocabulary #1401, the machinery regex #1758).
   It deliberately does **not** copy `readAutonomy`'s environment-variable override
   (`autonomy.ts:201-203`): the config file is its only input.

2. **The machinery witness is a `workflow_run` job, and its trust root is GitHub's own
   default-branch sourcing.** A new `.github/workflows/machinery-witness.yml` runs after
   `ai-review-runner` completes. Because GitHub always takes a `workflow_run` workflow from
   the default branch, a PR cannot edit the file that judges it — the property is structural,
   not remembered, which is exactly what DQ-2 asked for. By then `ready-to-merge.yml` has
   already run, and nothing would run it again, so the witness finishes by re-running the PR's
   latest `ready-to-merge` run (D10). That is the same `gh run rerun` shape `ai-review-retry.yml`
   already uses, and it makes the gate re-evaluate with the witness present.

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

5. **The native auto-merge arm is gated on the profile, at its single source.**
   `native_automerge_enabled` (`scripts/dispatch-issue.sh:75-88`) is amended to check the
   profile *before* it consults `MINSPEC_AUTOMERGE_NATIVE` / `autoMerge.native` at all: under
   `team` it returns false unconditionally, whatever the env or config says. Both of its call
   sites change behaviour as a result — the arm at `scripts/dispatch-issue.sh:1048` never
   marks the PR `--auto`, and the HOLD/silence branch at `scripts/dispatch-issue.sh:1959`
   takes the `else` arm it already has, posting the existing "Auto-merge HELD" comment and
   `needs-human-skim` label. Neither branch is new; only the boolean feeding them is. This is
   FR-3's second clause discharged at the same seam as its first: one function, one profile
   check, both halves of the acceptance criterion. The profile reaches this bash function
   through a new `profile_mode` function **inside `scripts/dispatch-issue.sh`** (declared
   `affects:`). It executes `profile.ts`'s CLI with the pinned `tsx` runner and fails closed to
   `team` (never `solo`) on any runner error, under the same failure policy
   `autonomy_may_proceed` applies (`scripts/lib/autonomy.sh:87-122`). It is not a separate
   `scripts/lib/profile.sh` (D11). See the component table and *Contracts*.

FR-5 needs almost no new code: it is satisfied by construction, because this Plan **deletes
nothing**, and every profile-keyed branch has `team` as the default arm. That treats FR-5's two
MUSTs (retained in source, reachable under `team`) as the whole requirement. Whether its title,
"parked behind the profile", also means *off* under `solo` is OQ-10. FR-3's non-machinery
half is seam 5 above, and it is a real behaviour change under `team` — not a re-source of an
unconditional switch, because the switch was unconditional before this Plan and is
profile-conditional after it. FR-3's machinery half is the arm slice below (OQ-1).

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
  The witness stage checks out the PR's `base.sha`, read from `GET /pulls/{n}` (trusted
  GitHub data), and only when `base.ref` is the default branch. It resolves the profile from
  that checkout's `.minspec/config.json`. `ready-to-merge.yml` stays profile-agnostic: it accepts
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

- **D10 – The witness drives `ready-to-merge`'s re-evaluation by re-running its latest run.**
  `ready-to-merge.yml` subscribes only to `pull_request` events (`:82-90`). Its `labeled` run
  fires while `ai-review-runner` is still going, so it can never see a `workflow_run`
  witness, and nothing runs it again. So after posting the check-run, the witness's `post`
  job waits for the newest `ready-to-merge` run on the head SHA to complete and re-runs it
  (`POST /actions/runs/{id}/rerun`, with `GITHUB_TOKEN` and `actions: write`). That is the
  shape `ai-review-retry.yml:129-135` already uses in production. A re-run replays the
  original `pull_request` payload, so `pull_request.base.sha` is present and the self-forge
  pin (`ready-to-merge.yml:111-127`) is untouched. `ready-to-merge.yml`'s trigger set,
  permissions and single-writer rule (`:13-15`) all stay unchanged.
  *Rejected: add a `check_run` or `workflow_run` trigger to `ready-to-merge.yml`.* The most
  direct fix. Cost: neither event carries `pull_request.base.sha`, and the job refuses to run
  without it (`:111-118`), so the self-forge defence would have to be redesigned inside a
  required gate.
  *Rejected: have the witness apply a label with the App token, which fires a fresh
  `labeled` event.* That gives a fresh payload and needs no new permission. Cost: a label
  whose only purpose is to be an event, and it races any in-flight `ready-to-merge` run,
  because that workflow has no `concurrency` group.
  *Rejected: have the witness post `ready-to-merge` itself.* That makes a second writer of
  the gate status, which `ready-to-merge.yml:13-15` forbids.
  Cost of the chosen seam: `actions: write` on the `post` job's token. Also, a re-run reads
  labels from the replayed payload (`ready-to-merge.yml:176`), so it does not see a label
  change that lands between the newest run's event and the re-run. Two racing
  `ready-to-merge` runs already have that stale-payload problem today, so it is not new. It is
  recorded under *Risks*.

- **D11 – The bash reader is a function inside `scripts/dispatch-issue.sh`, not a new
  `scripts/lib/profile.sh`.** There is exactly one bash consumer (`native_automerge_enabled`),
  and `dispatch-issue.sh` is declared in `affects:`.
  *Rejected: `scripts/lib/profile.sh`, the shape `scripts/lib/autonomy.sh` established.* It
  would be reusable by a future second bash consumer. Cost: a third file outside the approved
  ownership declaration (OQ-2), for a single caller. That is what made the FR-3 slice depend
  on OQ-2 in the earlier draft.

---

## Components, by path, and the seam at each

| Path | Ownership | Change | Seam |
|---|---|---|---|
| `packages/minspec/src/lib/profile.ts` | **new, `implements:`** | Whole file | Resolution is pure: `fs.readFileSync` + `JSON.parse` only. A CLI entry (`runProfileCli`) plus an argv-keyed main guard (the `autonomy.ts:338-350` shape) let bash and YAML execute it. No `vscode`, no network, no `child_process`, no environment read. |
| `packages/minspec/tests/profile.test.ts` | **new, `implements:`** | Whole file | T0 for FR-1/AC-1/AC-2, the CLI grammar, and AC-4's hermetic dispatch cases |
| `packages/minspec/tests/solo-mode-keep-gates.test.ts` | **new, `implements:`** | Whole file | T0 for FR-6/AC-6 and FR-5/AC-7 |
| `.github/workflows/machinery-witness.yml` | **new, `implements:`** | Whole file | `on: workflow_run: workflows: [ai-review-runner], types: [completed]`. Two jobs, specified under *Contracts*. `evaluate` has a read-only `GITHUB_TOKEN` and **no App token**; it checks out the base, runs `npm ci`, and executes `profile.ts` and `isMachineryPath` through `tsx`. `post` mints the App token only after evaluation, posts the check-run, and re-runs `ready-to-merge` (D10). |
| `packages/minspec/tests/machinery-witness.test.ts` | **new, `implements:`** | Whole file | Parses the two self-set lists and the `witness-classify`, `witness-decide` and `witness-reevaluate` blocks back out of the YAML between their `# >>> name` / `# <<< name` markers and executes them, so the test cannot drift from what CI runs |
| `.github/workflows/ready-to-merge.yml` | `affects:` | Read the head's `machinery-witness` check-runs and pass them into the guard | One extra `github.paginate(checks.listForRef, { check_name: 'machinery-witness' })` call and one extra argument. The decision stays in the guard. The trigger set, permissions and base pin are **unchanged**, because re-evaluation is driven from the witness side (D10). |
| `.github/scripts/ai-review-guard.js` | **UNDECLARED — OQ-2** | `MACHINERY_WITNESS_CHECK_NAME`; `verifyHeadMachineryWitness()`; a third channel in `verifyHeadPassWitness()`; an `ai-review:unreadable` arm in `decideReviewCheck()`; the label added to `VERDICT_LABELS`. `shouldSummonHumanReview` (`:975-977`) may also change under **OQ-8** | Pure functions, unit-tested, mirroring `verifyHeadPassCheckRun` |
| `scripts/review-decide.sh` | **UNDECLARED — OQ-2** | Two `echo` lines: the no-parseable-verdict fall-through (`:113`) and the `BEGIN_COUNT != 1` refusal (the branch at `:155-156`) | stdout is the label contract; nothing else changes |
| `.github/workflows/ai-review.yml` | `affects:` | `gh label create "ai-review:unreadable"` alongside the other three; one case arm in the `# >>> verdict-combine` block | The combine block is executed verbatim by its test, so the arm is covered the moment it is written |
| `.github/workflows/ai-review.yml`: the `machinery-review-required` step (`:936-986`) and the summon step (`:1184-1201`) | `affects:` | **Blocked on OQ-8.** Both say a human must review every machinery PR. That is true until the machinery arm slice lands and false after it, so whatever OQ-8 decides lands in that slice | None designed until OQ-8 is answered |
| `scripts/dispatch-issue.sh` (FR-2, machinery arm) | `affects:` | Under `solo`, let a witnessed machinery PR merge without a keystroke. **Blocked on OQ-1**, which also has to settle *where* the arm runs | Not designed |
| `scripts/dispatch-issue.sh` (FR-3, seam 5) | `affects:` | A new `profile_mode` function; a `--check-profile` pure seam beside `--check-native-automerge` (`:93-95`); and, as the first check in `native_automerge_enabled` (`:75-88`), ahead of its env/config checks at `:81-87`, a line that returns false unless `profile_mode` prints `solo`. Not blocked on OQ-1 or OQ-2. **Sequenced after the config flip** (*Build order*) | Both call sites (`:1048`'s `--auto` arm, `:1959`'s HOLD/silence branch) are unchanged code reading one new boolean |
| `.minspec/config.json` | not declared – see OQ-2 | `"mode": "solo"`, added by a **human** PR (the config flip) | Withheld from native auto-merge by `paths_have_approvable_doc` mandate 2 (`dispatch-issue.sh:188-190`) and stop-classed `edits-the-autonomy-rules` (`:244`), so it reaches a human by construction |
| `scripts/auto-merge-gate.ts` | `affects:` | **No change this Plan can justify** — see OQ-5 | — |

**Untouched, and that is the FR-5 design.** The following are not edited at all:
`docs-lane.yml`; `scripts/push-docs.sh`; DR-065's presence-gated fast-forward
(`checkout_occupied` / `sync_shared_checkouts` in `scripts/drain-inbox.sh:311` and `:373`,
which mirror `isCheckoutOccupied` in `packages/minspec/src/lib/presence.ts:301`);
`shouldAwaitApproval` in the guard (`:811-815`); and the drain's HITL escalation
(`reconcile_done_issues`, `scripts/drain-inbox.sh:614-636`). None of them reads
`.minspec/config.json` today: a grep of `docs-lane.yml`, `push-docs.sh` and `drain-inbox.sh`
for `config.json` returns nothing. "Parked means retained" is strongest when it is enforced by
the absence of a diff. AC-7 then asserts it by execution, entry point by entry point (table
below).

---

## Contracts

```ts
// packages/minspec/src/lib/profile.ts — Tier-0: no vscode, no network, no exec, no env.
// Imports: exactly `node:fs` and `node:path`.

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
 * Resolve from `<repoRoot>/.minspec/config.json` — the SOURCE, per FR-1 and #183, and
 * the ONLY input. No environment variable is consulted.
 * Every failure — missing file, unreadable, malformed JSON, absent key, non-string
 * value — resolves to `team`, the shape of `readAutonomy`'s config half
 * (scripts/lib/autonomy.ts:205-212). A repo with no `.minspec/` therefore resolves to
 * `team` because the read fails, and no earlier stage exists that could pre-empt it:
 * INV-4 by construction.
 */
export function readProfileMode(repoRoot: string): Profile;

/**
 * The CLI seam, mirroring runAutonomyCli (scripts/lib/autonomy.ts:260). It prints
 * nothing itself; the main guard prints `line` and exits with `exitCode`.
 *   argv exactly ['--repo-root', <non-empty dir>] → { exitCode: 0, line: 'solo' | 'team' }  (to stdout)
 *   anything else                                  → { exitCode: 2, line: <usage> }         (to stderr; stdout empty)
 */
export function runProfileCli(argv: readonly string[]): { exitCode: 0 | 2; line: string };

// Main guard, keyed on argv[1] for the reason autonomy.ts:338-345 gives (vitest imports
// the module as ESM, tsx runs it as CJS):
//   if (/(^|[\\/])profile\.ts$/.test(process.argv[1] ?? '')) { … }
// Checked 2026-09-11: under tsx 4.23.1, process.argv[1] is the script path.
```

**The CLI grammar, and the one rule every non-TypeScript consumer applies.**

```
<root>/node_modules/.bin/tsx <root>/packages/minspec/src/lib/profile.ts --repo-root <root>
  exit 0, stdout exactly "solo\n" or "team\n"     resolved (every config failure is team, per D3)
  exit 2, stdout empty, one usage line on stderr   usage error
```

A consumer treats the profile as `solo` **only if** the runner exited 0 **and** its stdout,
with one trailing newline removed, is exactly `solo`. Anything else resolves to `team`: no
runner at that path, a non-zero exit, empty stdout, or any other stdout. In that case the
consumer says why in one visible line (`::warning` in YAML, stderr in bash), so a dead
resolver is never mistaken for a `team` config. There is no `npx` fallback, for the reason
`autonomy.sh:92-98` gives: `npx` fetches a missing package over the network, which would be
an unconsented call made to obtain the thing that decides.

- **bash**: `profile_mode` in `scripts/dispatch-issue.sh` prints `solo` or `team` and always
  exits 0. `<root>` is `$(cd "${SCRIPT_DIR}/.." && pwd)`, the same root
  `native_automerge_enabled` already reads its config from (`dispatch-issue.sh:86`). **No
  environment variable redirects it.** That differs from `autonomy.sh`'s
  `MINSPEC_AUTONOMY_REPO_ROOT` test seam (`:39-45`) on purpose: pointing the reader at a
  fixture that says `solo` would arm unattended merge in a repo whose committed config says
  `team`, the same loosening the removed `MINSPEC_MODE` override had. Tests use a hermetic
  copy of the script instead (`drain-selfheal.test.ts:263-301` is the existing pattern).
- **YAML**: the `witness-classify` step of `machinery-witness.yml` (below), with `<root>` set
  to the base checkout.

**No environment override exists.** FR-1 says the mode MUST NOT be inferable *only* from an
environment variable, and AC-1 tests the no-environment case; neither asks for an override. An
earlier draft of this Plan copied `readAutonomy`'s `MINSPEC_AUTONOMY` precedence
(`autonomy.ts:201-203`) as `MINSPEC_MODE`. Under that draft an exported `MINSPEC_MODE=solo`
would have won over a committed `mode: team` and, through seam 5, armed unattended native
auto-merge. It was a new interface, not a requirement, and it is removed. Adding an override
later is a Clarify question, not a Plan choice.

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

1. the profile is `solo`, as reported by the `witness-classify` step (the CLI run against the
   base checkout under the consumer rule above);
2. the PR resolved unambiguously from `workflow_run.pull_requests`, cross-checked against
   `GET /repos/{o}/{r}/commits/{head_sha}/pulls` — a disagreement, an empty list (a fork
   PR), or more than one match posts nothing. `GET /repos/{o}/{r}/pulls/{n}` must also show
   it open, with `head.sha` equal to `workflow_run.head_sha` (otherwise the run is stale and
   posts nothing) and `base.ref` equal to the repository's default branch. The last check
   matters because a check-run is bound to a SHA, not a PR, so a witness posted for a PR into
   any other branch could be read by a PR into `main` with the same head;
3. the changed-file set was enumerated **completely** from
   `GET /repos/{o}/{r}/pulls/{n}/files` (trusted GitHub data, never stage 1's output) — a
   short page or an API error posts nothing;
4. at least one changed path is machinery per `isMachineryPath`, executed from the base
   checkout by `witness-classify`. If none is, this witness has no opinion and posts nothing,
   because the ordinary `ai-review` witness already covers the PR;
5. the set touches **no** entry of either self-set list below — otherwise `action_required`,
   with the offending path named;
6. a provenance-verified `ai-review:pass` is bound to this head, verified through the base
   guard's `verifyPassProvenance` against the same `AI_REVIEW_BOT_LOGINS` allowlist
   `ready-to-merge.yml` uses, from the same inputs `ready-to-merge.yml:198-250` gathers.

**The witness workflow, job by job.** This is the seam that carries YAML to the TypeScript
authorities. The resolver and the classifier are *executed* from the base checkout; they are
never re-implemented and never read with `jq`.

```yaml
# .github/workflows/machinery-witness.yml (shape; every `uses:` SHA-pinned)
on:
  workflow_run: { workflows: [ai-review-runner], types: [completed] }
permissions: {}                     # nothing at the top; each job grants its own
concurrency: { group: "machinery-witness-${{ github.event.workflow_run.head_sha }}", cancel-in-progress: false }

jobs:
  evaluate:                         # NO App token exists in this job
    if: github.event.workflow_run.event == 'pull_request'
    permissions: { contents: read, pull-requests: read, issues: read }
    outputs: { post: …, conclusion: …, title: …, summary: …, head_sha: … }
    steps:
      - resolve   # github-script, GITHUB_TOKEN: conditions 2-3. Writes the file list as JSON
                  # to $RUNNER_TEMP/files.json; outputs pr, base_sha, head_sha
      - uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd    # v5.0.1, as ai-review.yml:244
        with: { ref: <base_sha from resolve>, persist-credentials: false }
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020  # v4.4.0, as ai-review.yml:251
        with: { node-version: '22' }
      - run: npm ci                 # the BASE lockfile, which pins tsx 4.23.1 (package.json:36)
      - classify  # run:, between `# >>> witness-classify` / `# <<< witness-classify`:
                  #   PROFILE   <- node_modules/.bin/tsx packages/minspec/src/lib/profile.ts
                  #                  --repo-root "$GITHUB_WORKSPACE"   (consumer rule above)
                  #   MACHINERY <- node_modules/.bin/tsx -e '<require("./packages/minspec/src/lib/
                  #                  machinery-paths.ts").isMachineryPath over the JSON list at
                  #                  $FILES_JSON>'; prints exactly `true` or `false`, and anything
                  #                  else fails the job (visible, posts nothing)
      - decide    # github-script, between `# >>> witness-decide` / `# <<< witness-decide`:
                  # requires the BASE guard and fails closed if it is absent, exactly as
                  # ready-to-merge.yml:154-173 does; conditions 1, 4, 5, 6 -> outputs
  post:
    needs: evaluate
    if: needs.evaluate.outputs.post == 'true'
    permissions: { actions: write } # the GITHUB_TOKEN is used for the re-run only
    steps:
      - uses: actions/create-github-app-token@f2acddfb5195534d487896a656232b016a682f3c # v1.9.0, as ai-review.yml:192
      - post      # POST /repos/{o}/{r}/check-runs as the App: the MachineryWitnessCheckRun below
      - reevaluate  # github-script, between `# >>> witness-reevaluate` / `# <<< witness-reevaluate`
                    # (D10): take the newest ready-to-merge.yml run with head_sha = <head_sha> and
                    # event pull_request; poll until completed (10 x 30 s); POST .../actions/runs/{id}/rerun.
                    # No run, a timeout, or an API error -> core.setFailed. The check-run exists,
                    # but ready-to-merge stays red until the next pull_request event: closed AND visible
```

There are two jobs so that the App token never shares a job with the packages `npm ci`
installed, and a compromised dependency cannot read it. File names are PR-controlled strings,
so the list only ever travels as a JSON file whose path is in `env`. It is never interpolated
into a shell or script body, the discipline `ready-to-merge.yml:73-78` states. Two facts were
checked on 2026-09-11. First, `tsx -e` can `require()` a `.ts` module (tsx 4.23.1,
node 22.23.2). Second, the runs API filters by `head_sha`:
`GET /actions/workflows/ready-to-merge.yml/runs?head_sha=…` returned only that head's runs,
each with `event: pull_request`.

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
# The witness self set: two lists, carried verbatim in .github/workflows/machinery-witness.yml
# and pinned by packages/minspec/tests/machinery-witness.test.ts.

# >>> witness-self-set                      (every entry MUST be broad-set machinery)
.github/workflows/ai-review.yml            # stage 1
.github/workflows/machinery-witness.yml    # stage 2 — this file
.github/workflows/ready-to-merge.yml       # the consumer gate
.github/scripts/ai-review-guard.js         # the decision module both stages load
scripts/review-branch.sh                   # the reviewer control plane
scripts/review-decide.sh                   # the deterministic verdict gate
scripts/roles/**                           # the voter prompts
scripts/lib/agent-context.sh               # sourced unguarded by review-branch.sh
# <<< witness-self-set

# >>> witness-self-set-nonmachinery         (each entry names the gate that holds it alone)
.minspec/config.json                       # the profile value; alone, held by paths_have_approvable_doc mandate 2
# <<< witness-self-set-nonmachinery
```

**Why two lists, and what the test asserts.** Condition 4 means the witness only ever judges
a PR that touches at least one broad-set path. A self-set entry that is *not* broad-set
machinery can therefore only bite on a mixed PR. A PR that touches such a file alone takes the
ordinary non-machinery path, and the witness never sees it. The earlier draft put three such
files in one list and said the test asserted each one was machinery. That test was red by
construction, since `machinery-paths.ts:52-78` contains none of them, and the protection was
silently partial. The contract is now:

- every entry matches at least one tracked path (`git ls-files`, with `**` expanded);
- every path matched by `witness-self-set` satisfies `isMachineryPath`;
- no entry in `witness-self-set-nonmachinery` satisfies `isMachineryPath`, and each is admitted
  only because an executed gate holds a PR that touches it alone. The test pipes the path into
  `bash scripts/dispatch-issue.sh --paths-have-approvable-doc` (the pure seam at
  `dispatch-issue.sh:193-195`) and requires `hold`. That is by execution, not by source text;
- the `witness-decide` block returns `action_required` for a PR that touches any entry of
  either list together with a machinery path.

`profile.ts` and `machinery-paths.ts` are in **neither** list, pending **OQ-9**. The witness
reads both from the base checkout, so a PR cannot influence its own certification through
them. Whether a change to either must still stop for a human is DQ-2's residual, which this
Plan cannot settle, and the witness slice does not ship until OQ-9 is answered.

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
| **INV-1** / constitution 2 — no silent gate | No new load-bearing signal is written with a swallowed error; a missing or errored witness fails closed **and visibly** | `machinery-witness.test.ts`: drive the `witness-decide` block with each failure input (no PR, PR disagreement, stale head, non-default base branch, short files page, API error, base checkout missing, guard unloadable, a resolver that exits non-zero or prints anything but `solo`/`team`) and assert the outcome is "post nothing or `action_required`", never `success`; drive the `witness-reevaluate` block with no run, a run that never completes, and a rerun API error, and assert each fails the job; and assert every such path emits a `::warning` or `::error` — the #810 lesson, where a silently swallowed 403 made a required gate unsatisfiable repo-wide |
| **INV-1**, second witness | `ready-to-merge` must not come to hinge on the machinery witness alone | `machinery-witness.test.ts`: with the witness absent, a non-machinery PR still greens through the existing `ai-review/pass` **or** `ai-review` channels; `verifyHeadPassWitness` tries the two existing channels before the new one |
| **INV-2** — approval stays human under both profiles | `checkApprover` / `assertHumanApprover` (`packages/minspec/src/lib/approval.ts`) deny an agent identity regardless of `mode` | `solo-mode-keep-gates.test.ts`: run against a fixture repo with `mode: solo` and again with `mode: team`; assert identical denial |
| **INV-3** — irreversible/outward-facing stays human under both profiles | `mayProceed` denies `irreversible-or-outward-facing` and `approval-or-acceptance` whatever the profile says | `solo-mode-keep-gates.test.ts`: call `mayProceed('act', …)` and also drive the whole bash seam (`dispatch-issue.sh --autonomy-stop-classes` and the `autonomy_may_merge` path) with a `mode: solo` fixture config; assert `proceed: false` under both profiles |
| **INV-4** / constitution 3 — blast radius | The profile is per-project and changes nothing in a repo without `.minspec/` | `profile.test.ts`: `readProfileMode(<tmpdir with no .minspec>)` is `team`; and an import-shape assertion that `src/extension.ts` has no path to `profile.ts`, so `scripts/build-extension.sh`'s `esbuild src/extension.ts --bundle` tree-shakes it out of the shipped `.vsix` (the shape `auto-merge.test.ts` already uses to pin `auto-merge.ts`'s purity) |
| Constitution 1 — offline | `profile.ts` makes no network call, and no consumer fetches a runner | Same import-shape assertion: the module's import list is exactly `node:fs` and `node:path`. And `profile.test.ts` runs `dispatch-issue.sh --check-profile` in a hermetic copy with no `node_modules/.bin/tsx`, with a `PATH` stub for `npx` that fails the test if invoked, and asserts `team` (the `autonomy.sh:92-98` rule) |

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
| AC-1 (FR-1) | T0 | `profile.test.ts`: with the environment emptied, drive **each** consumer's resolution path against one fixture repo, and assert all three return the same value, for a `solo` fixture and for a `team` fixture. The three are: `readProfileMode` directly; the bash consumer through `dispatch-issue.sh --check-profile` in a hermetic copy (the `drain-selfheal.test.ts:263-301` pattern, plus `profile.ts` and a `node_modules` symlink so the pinned runner resolves); and the YAML consumer, by executing the `witness-classify` block verbatim under bash. Asserted by driving consumers, not by reading the file |
| AC-2 (FR-1, negative) | T0 | `profile.test.ts`: a table of `undefined`, `''`, `'Solo'`, `' solo '` (accepted, trimmed), `'sol o'`, `'true'`, `'team '`, `{}`, `42`, malformed JSON, missing file → every one resolves `team` except the exact token. The CLI grammar: `--repo-root` missing or empty, or any extra argument, gives exit 2 with empty stdout. The consumer rule, through the bash seam: no runner → `team`; a runner that exits 0 printing `Solo` or `solo ` → `team`; a runner that exits non-zero printing `solo` → `team`. And because no environment override exists, `MINSPEC_MODE=solo` exported over a `mode: team` config still resolves `team`, which guards that the removed interface stays removed |
| AC-3 (FR-2) | T0 + T2 | `machinery-witness.test.ts`: the decision block, executed verbatim from the YAML, returns `success` for a machinery PR with a verified pass and no self-set touch, and `action_required` for one that touches a self-set path. Both halves, as AC-3 requires. The re-evaluation seam is T0 too: the `witness-reevaluate` block, executed against stubbed run lists, re-runs the newest completed `ready-to-merge` run for the head, waits for an in-progress one, and fails the job when there is none. What remains T2 is only the platform chain (`workflow_run` fires, the re-run replays the `pull_request` payload, `ready-to-merge` greens), observed on the first real machinery PR after landing. The seam that chain exercises is specified above; the T2 run checks it rather than discovering it |
| AC-4 (FR-3) | T0 | `profile.test.ts` drives the existing `--check-native-automerge` behavioral seam (`dispatch-issue.sh:93-95`) in hermetic copies. It reuses the technique `drain-selfheal.test.ts:263-301` uses, carried into a declared test file rather than by editing that one, and adds a `mode` fixture dimension: `mode: solo` + `autoMerge.native: true` → `on`; `mode: team` + the identical `autoMerge.native: true` → `off`; `mode: solo` + no `autoMerge.native` key → `off`. The last case keeps the existing default pinned, because once the profile arm exists, `drain-selfheal.test.ts:263-301`'s own hermetic case (no `profile.ts` in its copy, so `team`) passes for the wrong reason. This is the one test in this Plan that exercises a non-machinery PR's actual merge arm, so it is the one AC-4 needs — a machinery-witness/profile.test.ts pairing cannot discharge AC-4 because the witness never posts for a non-machinery PR under either profile (condition 4 above), so it cannot distinguish them. Note: `drain-selfheal.test.ts:255-257` (`MINSPEC_AUTOMERGE_NATIVE=1` forces ON) runs against the REAL config. After seam 5 it passes only while the committed config says `solo`, which is one reason seam 5 lands after the config flip |
| AC-5 (FR-4) | T3, red-then-green | `review-decide.test.ts` extension, using **reproductions** of #1234 and #1157: a voter output with no verdict block and no quota phrasing → `ai-review:blocked`; a voter output that names `REVIEW_VERDICT_BEGIN` in prose with a single real block → `ai-review:unreadable`. Both must be red against today's script before the fix |
| AC-6 (FR-6) | T0 | The keep-list table above |
| AC-7 (FR-5) | T0 | `solo-mode-keep-gates.test.ts`, one entry point per FR-5 subsystem: the table below |

#### AC-7's entry points (FR-5)

Each row runs against a `mode: team` fixture, which is AC-7's condition, and again against
`mode: solo`. It asserts the same outcome both times, which is the executed form of "the
profile is not an input to any of them". Every harness already exists; this suite reuses the
technique and does not edit the file it comes from.

| FR-5 subsystem | Executed entry point | Harness it reuses | Assertion |
|---|---|---|---|
| Docs-lane | the `run:` block of `.github/workflows/docs-lane.yml`, run under bash with a stubbed `gh` | `extractRunBlock` in `docs-lane-hold.test.ts` | a docs-only PR labelled `docs-lane` arms auto-merge; the same PR with a `hold:*` label does not |
| `scripts/push-docs.sh` | `bash scripts/push-docs.sh …` against a fixture origin | `push-docs-sh.test.ts` (fixture repo at `:87-116`) | a docs-only change is pushed on the lane branch |
| Presence-gated fast-forward (DR-065) | `drain-inbox.sh --checkout-occupied <root>` and `--sync-checkouts` (`:1319-1329`), and TS `isCheckoutOccupied` (`presence.ts:301`) | `presence-sync-parity.test.ts` (`:72`, `:283`) | a dormant, clean, on-`main` checkout fast-forwards; an occupied one stays fetch-only |
| `awaiting-approval` labelling | `shouldAwaitApproval` (`ai-review-guard.js:811-815`) | direct call | green + auto-merge unarmed + no open blockers + not draft → `true`; every other combination → `false` |
| Team-scale drain HITL | `reconcile_done_issues` (`drain-inbox.sh:614-636`) | `runReconciler` in `drain-reconcile.test.ts` (`:93`, cases at `:153-177`) | an `agent-done` issue with no merged PR loses `agent-done` and gains `needs-human-review` |

DR-076 names the last class, "drain-inbox HITL escalations sized for team throughput"
(`DR-076.md:95`), without listing its members. `reconcile_done_issues` is the drain's own
escalation with an executable harness today. If FR-5 means more members than that, the
question belongs to OQ-10.

---

## Build order

Named, not numbered, and ordered so that nothing behavioural lands before the T0 that
constrains it, and nothing lands before the config state it depends on.

- **The keep-list slice (FR-6).** `solo-mode-keep-gates.test.ts` alone. Depends on nothing,
  changes nothing, and must be green *before* any profile-keyed branch exists — otherwise
  the keep list is prose again.
- **The resolver slice (FR-1).** `profile.ts` (resolver and CLI) + `profile.test.ts`. Nothing
  consumes the resolver yet, so landing it changes nothing, whatever the config says.
- **The config flip.** A human PR adding `"mode": "solo"` to `.minspec/config.json`. It is
  withheld from native auto-merge by `paths_have_approvable_doc` mandate 2
  (`dispatch-issue.sh:188-190`) and stop-classed `edits-the-autonomy-rules` (`:244`), so it
  reaches a human by construction. It changes nothing on its own, because nothing reads `mode`
  yet. **It must land before the auto-merge gate slice.** That is a deliberate contrast with
  the `autonomy` rollout, which accepted its arms going dark until the key was set
  (`scripts/lib/autonomy.sh:26-30`). Here the arm that would go dark is this repo's live merge
  path.
- **The auto-merge gate slice (FR-3, dispatch).** `profile_mode`, `--check-profile`, and the
  profile check in `native_automerge_enabled` (seam 5), with AC-4's cases in `profile.test.ts`.
  Not blocked on OQ-1 or OQ-2, since every file it touches is declared. **Blocked on the config
  flip.** `.minspec/config.json` today has `autoMerge.native: true` and no `mode` key, so
  landing seam 5 first would resolve `team` and switch off this repo's live native auto-merge.
  Every dispatched PR would then take the HOLD branch (`dispatch-issue.sh:1959-1966`: the
  "Auto-merge held" comment and `needs-human-skim`). This is the slice AC-4 actually exercises.
- **The false-red slice (FR-4).** `review-decide.sh`, the `decideReviewCheck` arm, the label
  creation and the combine arm. Independent of the profile entirely, useful on its own, and
  it makes solo mode safer rather than depending on it. Blocked on OQ-2 (two of its files are
  undeclared) and OQ-3 (all of its files are template sources).
- **The witness slice (FR-2).** `machinery-witness.yml`, the guard channel,
  `ready-to-merge.yml`'s extra read, and `machinery-witness.test.ts`. Blocked on OQ-2, OQ-3,
  OQ-4 and OQ-9.
- **The machinery arm slice (FR-2, dispatch).** Blocked on OQ-1, and it carries OQ-8's answer
  with it. Until it lands, a machinery PR under `solo` reaches a **green** `ready-to-merge` and
  then waits for a merge keystroke. That is already a strictly better position than today's
  total block, and a safe intermediate state to sit in. In that state `machinery-review-required`
  and `needs-human-review` are still true, because a human does press merge.

## Dependency budget

Zero new dependencies. Everything uses what is already here: `node:fs`/`node:path`; the
pinned `tsx` 4.23.1 (`package.json:36`), run from `node_modules/.bin` after `npm ci` and never
through `npx`; `jq`; `actions/github-script`; `actions/checkout`, `actions/setup-node` and
`create-github-app-token` at the SHAs `ai-review.yml` already pins (`:244`, `:251`, `:192`);
and vitest.

## Risks

- **The witness self set is a human-maintained list (D5/D6).** If a file that determines
  stage 1's behaviour is added and not added to the list, a PR touching it could be certified
  by a stage it had influenced. Mitigations: the list is checked from the base copy and
  contains itself. `machinery-witness.test.ts` asserts that every entry matches a tracked
  path, that every `witness-self-set` path is broad-set machinery, and that every
  non-machinery entry is held alone by an executed gate (*Contracts*). Residual: OQ-4, plus
  OQ-9 for the two files the witness reads from base.
- **A re-run replays a stale payload (D10).** The re-run reads labels from the replayed event
  (`ready-to-merge.yml:176`), so it does not see a label changed between that event and the
  re-run. The next label event re-runs the gate with a fresh payload. The verdict labels
  themselves are settled before the witness starts, because the `ai-review-runner` run whose
  completion triggers it is what writes them. Two racing `ready-to-merge` runs already have
  this problem today (the workflow has no `concurrency` group), so it is not a new one.
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
  asked for by any FR. It is tracked as #1204 (ai-review:blocked has no bounded retry) and not
  designed here.

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
  which keeps the frozen list intact — **(rec)**, because it leaves DR-086's list untouched;
  its cost is that "the stop class was discharged by a witness" is a new concept that DR-086
  §2 does not currently contain, so the list stops being purely enumerable.
  **(b) Scope the machinery mapping by profile.** The stop class's text, "Includes --admin
  and bypassing a failing check", is the `irreversible-or-outward-facing` summary in
  `STOP_CLASSES` (`scripts/lib/autonomy.ts:62-65`, sourced to DR-086 §2.1). Machinery reaches
  that class only through dispatch's mapping, which calls itself "a conservative read of a
  class" (`scripts/dispatch-issue.sh:222-226`, applied at `:250-251`). So (b) edits that
  mapping (declared), and arguably DR-086 §2.1's reading. If it touches `STOP_CLASSES` it also
  edits `scripts/lib/autonomy.ts`, which is out of this spec's declared ownership *and* is
  itself a §2.6 stop class ("anything that would edit this list"). An earlier draft of this
  OQ put the clause in DR-086 §2.1's text; it is in the code cited here.
  **Either option must also settle *where* the arm runs.** Dispatch decides the arm when it
  opens the PR (`dispatch-issue.sh:1048-1089`, `gh pr merge --auto` at `:1084`), before
  `ai-review` or the witness has run, so "a verified `machinery-witness` exists" cannot be
  evaluated at that seam. Either the arm moves to an actor that runs after the witness (for
  example the witness's `post` job arming auto-merge as the App), or dispatch arms
  unconditionally under `solo` and leaves `ready-to-merge` as the only hold. The second
  option retires mandate 4, the independent second witness (`dispatch-issue.sh:123-131`), which
  exists so that a machinery PR never hinges on one producer (constitution invariant 2). So
  (a) is not "confined to `dispatch-issue.sh`", as an earlier draft said.
  ➡️ This is a founder decision. Until it is answered, the arm slice cannot be designed, and
  designing it either way would be inventing a requirement.

- **OQ-2 — the approved ownership declaration is narrower than any correct implementation.**
  `affects:` lists `ai-review.yml`, `ready-to-merge.yml`, `auto-merge-gate.ts`,
  `dispatch-issue.sh`. The design needs two code files that appear in neither `implements:`
  nor `affects:`: `scripts/review-decide.sh` (owned by SPEC-031 — FR-4's only call site) and
  `.github/scripts/ai-review-guard.js` (unowned by any spec — FR-2's witness channel and
  FR-4's check arm). Two more are conditional or human-authored. `machinery-paths.ts` joins
  them only if OQ-9 is answered (a). `.minspec/config.json` is edited by the config flip, which
  is a human act, but the ownership map is what a reader consults to find what this spec
  changed. An earlier draft also listed a new `scripts/lib/profile.sh`; D11 moves that reader
  into `dispatch-issue.sh`, which is declared, so the FR-3 slice no longer depends on this
  question. This does not mechanically block anything —
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
  ships nowhere. Only the edits to the four existing files are affected, including whatever
  OQ-8 decides for `ai-review.yml`'s two human-review signals.

- **OQ-4 — how complete must the witness self set be, and who keeps it complete?**
  D5's correctness reduces to that list. This Plan proposes the entries above and a test that
  pins each entry's existence and classification, but nothing derives the list from the actual
  determinants of stage 1's behaviour, and a derivation is not obviously possible (a workflow
  file's transitive dependencies are not statically enumerable across YAML, bash and Node).
  The requirements say the exception must be "small and enumerable" but do not say who
  enumerates it or what happens when the enumeration is wrong.
  ➡️ Needs an answer before the witness slice ships. A candidate worth costing at Tasks: make
  the *broad* machinery set the self set for a first release — i.e. certify nothing, which is
  today's behaviour — and narrow it only once the enumeration has a maintainer.

- **OQ-5 — `scripts/auto-merge-gate.ts` is declared in `affects:`; this design still finds
  nothing IN THAT FILE for FR-3 to need.** FR-3's second clause — "the `pr-gate`
  deny-by-default behaviour is retained as the `team` profile's setting" — is discharged at
  seam 5, not here: `native_automerge_enabled` (`scripts/dispatch-issue.sh:75-88`) now denies
  under `team` regardless of config, which drops a non-machinery PR straight into the
  existing HOLD/`needs-human-skim` branch (`scripts/dispatch-issue.sh:1959`) — the same shape
  `pr-gate` (HOLD) already names, without `auto-merge-gate.ts` ever being invoked. That file's
  own `AutoMergeMode` axis (`consequence-hybrid` vs `pr-gate`) is mutually exclusive with
  native auto-merge and orthogonal to `mode` — FR-3 does not ask it to become profile-aware,
  and AC-2 cites `resolveMode` only as a *pattern to mirror*, not a thing to change. So the
  earlier draft's "precautionary listing" was reading FR-3's first clause and missing that
  its second clause is fully answered elsewhere in this design, not left open. Either the
  `affects:` declaration anticipates a change this Plan has not found — most likely keeping
  `BOUNDARY_DIR_PREFIXES` in lock-step with the machinery set, which this design does not
  narrow — or it is an ownership-declaration mismatch, the same shape as OQ-2's three files.
  ➡️ Confirm the intent before Tasks: either fold this file out of `affects:` at the next
  approved revision (alongside OQ-2), or name the change this Plan has not found.

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

- **OQ-8 – what should the two existing machinery signals say on a machinery PR that merges
  unattended? NOT decided; needs the founder via Clarify.** On every machinery PR,
  `ai-review.yml` posts `machinery-review-required` as `action_required`, titled "Machinery
  PR — human review required" (`:936-986`, title at `:956`). It also applies
  `needs-human-review`, because `shouldSummonHumanReview` returns true for any machinery PR
  (`ai-review-guard.js:975-977`, applied at `ai-review.yml:1184-1201`). Neither gates a merge,
  so FR-2 is buildable without touching them. But once the machinery arm slice lands, both
  would tell a reader that a human must review a PR that merged without one, which is the
  lying signpost D4 rejects. Before that slice they are true, so whatever is decided lands in
  that slice.
  **(a)** On `success`, the witness's `post` job removes `needs-human-review`, and its
  check-run summary says it discharges `machinery-review-required`. `ai-review.yml`'s summary
  text for that check is reworded to state the discharge condition – **(rec)**, because it keeps
  the only profile read at the trusted end (D7), and stage 1 needs to know nothing about the
  profile. Its cost: a merged `solo` machinery PR still shows an `action_required`
  `machinery-review-required` beside a green witness, so a reader has to read both. The
  witness also becomes one more writer of `needs-human-review`, which five scripts and
  workflows already write.
  **(b)** The witness updates the `machinery-review-required` check-run itself (the same App
  posted it) to `success`. That gives one signal, and a true one. Cost: two writers of one
  check-run, the norm D4 uses to reject overloading `ai-review/pass`.
  **(c)** Stage 1 reads the profile and posts neither signal under `solo`. Cost: a second
  profile reader, in a workflow whose body comes from the PR head, which is what D7 rejects.
  Every option edits `ai-review.yml`, which is a template source (OQ-3).
  ➡️ Founder decision.

- **OQ-9 – do the resolver and the classifier the witness reads count as machinery? NOT
  decided; needs the founder via Clarify.** The witness reads `profile.ts` and
  `machinery-paths.ts` from the base checkout, so no PR can influence its own certification
  through them. But neither is in the broad set (`machinery-paths.ts:52-78`), so a PR that
  touches only one of them is not machinery. The witness never runs for it (condition 4), it
  takes the ordinary `ai-review` path, and under `solo` it merges with no human. A
  `machinery-paths.ts`-only PR can already do that today, because neither `dispatch-issue.sh:143`
  nor `:188-190` matches it. DQ-2's residual says a PR that changes the witness mechanism
  itself must still stop for a human. Whether these two files count as "the witness
  mechanism" is not stated. Putting them in the self set cannot answer that either, because
  condition 4 makes a non-machinery self-set entry bite only on mixed PRs (see *Contracts*).
  **(a)** Add both to `MACHINERY_SINGLE_FILES`, and so to `witness-self-set` – **(rec)**,
  because `machinery-paths.ts`'s own membership test ("does this code decide whether some
  other change is allowed", `:30-32`) already describes both, and it makes DQ-2's residual
  hold for them. Its cost: it edits `machinery-paths.ts` (undeclared, OQ-2) and its two pinned
  hand-copies (`ai-review.yml:404`, which then regenerates a template, OQ-3; and
  `dispatch-issue.sh:143`). It also changes behaviour under **both** profiles: under `team`, an
  edit to either file then needs `--admin`, as every machinery PR does today.
  **(b)** Leave the broad set alone and keep both out of the self set. Cost: under `solo`, the
  classifier and the resolver the witness keys on can change on an ordinary AI pass with no
  human, which reads DQ-2's residual as not covering them.
  ➡️ Founder decision. The witness slice does not ship until it is answered.

- **OQ-10 – does FR-5's "parked behind the profile" require the four subsystems to be OFF
  under `solo`? NOT decided; needs the founder via Clarify.** FR-5's two MUSTs are that they
  remain in source and remain reachable under `team`. This Plan satisfies both by editing none
  of them, so all four behave identically under both profiles, and AC-7 asserts exactly that.
  DR-076 says to PARK docs-lane and presence-ff behind the team profile (`DR-076.md:94`) and to
  SIMPLIFY `awaiting-approval` and drain HITL to solo scale (`:95`); DR-081 later amended the
  docs-lane row (`:19-27`). Turning any of them off under `solo` is behaviour FR-5 does not
  state.
  **(a)** As designed: no profile branch in any of them – **(rec)**, because it is everything
  the MUSTs ask for and adds no surface. Its cost: under `solo`, `awaiting-approval` and the
  drain's escalations keep firing at today's scale, so this spec does not deliver DR-076's
  "simplify".
  **(b)** Give each one a `solo` arm. Cost: four new consumers of the profile, spread across
  four subsystems, each a behaviour change that needs its own acceptance criteria.
  ➡️ Founder decision.

## Follow-ups (tracked)

- **#1204** (ai-review:blocked has no bounded retry, open): the attempt cap the D8 risk needs,
  so a persistently non-conforming voter cannot loop forever. No FR asks for it, and
  `ai-review-retry.yml` is undeclared here.
- **#1394** (strict=true serialises the merge queue, open): a merge queue as the eventual
  answer to `strict`'s serialisation cost. DQ-1 leaves it open and not foreclosed; it is not
  this spec's work.

Considered and **not** a follow-up: `allow_update_branch` (currently `false`). DQ-1 calls
enabling it "a sensible companion change" and says it is **NOT** part of that decision, so
this Plan neither designs nor tracks it.
