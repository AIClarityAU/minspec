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
> Five gaps that earlier drafts filled by assumption are now flagged instead of settled:
> whether `autoMerge.native` is still a second switch under `solo` (OQ-11; a T0 had pinned
> the guess), whether an exported `MINSPEC_AUTOMERGE_MODE` may still merge a PR under `team`
> (OQ-5), what acts on an `ai-review:unreadable` PR (OQ-12), whether docs-lane, a third
> unattended merge actor, may still merge under `team` (OQ-13), and how far FR-4's
> "protocol-parsing anomaly" reaches (OQ-14). OQ-3's earlier recommendation rested on a false
> description of what happens in an adopter repo. FR-4's edits are **not** inert there, and
> the question is rewritten with the real consequences.
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
| The broad machinery set is six directory prefixes plus two generator files | `packages/minspec/src/lib/machinery-paths.ts:52-78`; hand-copied at `ai-review.yml:404` and `scripts/dispatch-issue.sh:143` | `profile.ts`, `machinery-paths.ts` and `.minspec/config.json` are **not** machinery. That constrains the witness self set (see *Contracts*) and raises **OQ-9**. The set is also wider than FR-2's `.github/**` and `scripts/**`, which raises **OQ-15** |
| The native auto-merge arm is decided when dispatch opens the PR, before any review has completed | `scripts/dispatch-issue.sh:1048-1089` (`gh pr merge --auto` at `:1084`) | Nothing that needs a witness to exist can be evaluated at that seam – see **OQ-1** |
| `tsx` is pinned, and `scripts/lib/autonomy.sh` refuses to fetch a runner over the network | `package.json:36` (`tsx` 4.23.1); `autonomy.sh:87-99`; `.github/workflows/dr-id-collision.yml:55-73` runs TypeScript in CI after `npm ci` | How bash and YAML execute `profile.ts` (see *Contracts*): the pinned runner from `node_modules/.bin`, never `npx` |
| #1839 (patch-fingerprint re-attestation) records a fingerprint, and nothing consumes it yet | `ai-review-guard.js:366-376` (*"has no production caller"*); the consumer is #1840 | The witness reads neither the fingerprint nor `findReattestableVerdict`. It depends only on `ai-review:pass` label provenance and on `ai-review-runner` completing |
| `dispatch-issue.sh` has a **second** actor that merges a green PR with no human: SPEC-024's consequence-hybrid gate | `scripts/dispatch-issue.sh:1841-1846` (mode from `MINSPEC_AUTOMERGE_MODE` alone), `:1859` (runs `auto-merge-gate.ts`), `:1915-1922` (the conjuncts, then `gh pr merge --squash`) | It never passes through `native_automerge_enabled`, so seam 5 does not reach it – see **OQ-5** |
| A **third** unattended merge actor sits outside dispatch: docs-lane | `.github/workflows/docs-lane.yml:247` (`gh pr merge --auto --squash`, on any docs-only PR whose labels include `docs-lane`, gated at `:36`); the label is applied by `scripts/push-docs.sh:157-158` itself when an agent opens the PR. A grep of `.github`, `scripts`, `packages/minspec/src` and `packages/shared/src` for `gh pr merge`, `pulls/…/merge` and the GraphQL auto-merge mutation finds these three actors and nothing else, apart from `docs-lane.yml:69`'s `--disable-auto`, which only revokes | Under **either** profile an agent's docs-only PR merges once green with no human act. Seam 5 does not reach it, and AC-4 and AC-7 disagree about whether it should – see **OQ-13** |
| `ai-review.yml`'s post step re-normalises the verdict before it applies it | `.github/workflows/ai-review.yml:1013-1019`: only `pass` and `blocked` survive; every other value becomes `ai-review:changes` | A new verdict label must be admitted there, or it lands as `changes` (the FR-4 contract) |
| Each downstream consumer selects only the labels or conclusions it names | retry: `ai-review-retry.yml:65` (`ai-review:blocked`); remediation: `remediate-pr.sh:124` and `:402-407` (the `changes` label, or an `ai-review` check concluding `FAILURE`/`ERROR`); summon: `shouldSummonHumanReview`, `ai-review-guard.js:975-994` | A new label that no consumer names is stranded – see **OQ-12** |
| No test in this repo executes a github-script body | a grep of `packages/minspec/tests` for `AsyncFunction` or `new Function` finds nothing; `ai-review-verdict-combine.test.ts:54` runs its extracted block with `execFileSync('bash', …)` | The witness's four JS blocks need a new harness, specified under *Contracts* |

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

5. **Dispatch's native auto-merge arm is denied under `team`, at that arm's single source.**
   It is the single source of *that* arm only. The repo has three unattended merge actors
   (fact table), and seam 5 reaches one of them.
   `native_automerge_enabled` (`scripts/dispatch-issue.sh:75-88`) is amended to check the
   profile *before* it consults `MINSPEC_AUTOMERGE_NATIVE` / `autoMerge.native` at all: under
   `team` it returns false unconditionally, whatever the env or config says. Both of its call
   sites change behaviour as a result — the arm at `scripts/dispatch-issue.sh:1048` never
   marks the PR `--auto`, and the HOLD/silence branch at `scripts/dispatch-issue.sh:1959`
   takes the `else` arm it already has, posting the existing "Auto-merge HELD" comment and
   `needs-human-skim` label. Neither branch is new; only the boolean feeding them is.
   Three things this seam does **not** settle, and it says so rather than implying it does.
   (i) What the function returns under `solo`: whether `autoMerge.native` is still the second
   switch that FR-3's "not an opt-in" rules out is **OQ-11**, and until it is answered the
   `solo` path is left exactly as it is today. (ii) The second unattended merge actor in the
   same script, SPEC-024's consequence-hybrid `gh pr merge --squash` (`:1915-1922`). Its mode
   comes from `MINSPEC_AUTOMERGE_MODE` alone (`:1841-1846`) and never passes through this
   function, so an exported env var can still merge a PR under a committed `team` – **OQ-5**.
   (iii) The third actor, outside dispatch altogether: `docs-lane.yml:247` arms `--auto` on an
   agent's docs-only PR under either profile – **OQ-13**.
   Seam 5 therefore discharges AC-4's `team` half for the native actor only. The profile reaches this bash function
   through a new `profile_mode` function **inside `scripts/dispatch-issue.sh`** (declared
   `affects:`). It executes `profile.ts`'s CLI with the pinned `tsx` runner and fails closed to
   `team` (never `solo`) on any runner error, under the same failure policy
   `autonomy_may_proceed` applies (`scripts/lib/autonomy.sh:87-122`). It is not a separate
   `scripts/lib/profile.sh` (D11). See the component table and *Contracts*.

FR-5 needs almost no new code: it is satisfied by construction, because this Plan **deletes
nothing**, and every profile-keyed branch has `team` as the default arm. That treats FR-5's two
MUSTs (retained in source, reachable under `team`) as the whole requirement. Whether its title,
"parked behind the profile", also means *off* under `solo` is OQ-10. FR-3's non-machinery
half is seam 5 above for the native actor's `team` deny, and it is a real behaviour change
under `team` — not a re-source of an unconditional switch, because the switch was
unconditional before this Plan and is profile-conditional after it. Its `solo` arm is OQ-11,
the second merge actor is OQ-5, the third (docs-lane) is OQ-13, and FR-3's machinery half is
the arm slice below (OQ-1). None of the four is designed here.

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
  tree-shaken from `src/extension.ts` — and the INV-4 row of the *Invariants* table turns it
  into a test (a reachability assertion over esbuild's metafile for `src/extension.ts`, specified
  in that row).

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
  with a test that parses it back out of the workflow. The list lives in a github-script
  body, so that test is **new harness work**: the `# >>> … # <<<` technique
  `ai-review-verdict-combine.test.ts` uses runs only bash `run:` blocks (`:54`), and no test in
  this repo executes a github-script body today. The harness is specified under *Contracts*.
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

- **D12 – `ai-review:unreadable` ranks below `blocked` in the panel combine, and its
  `ai-review` check-run concludes `action_required`, not `failure`.** Precedence becomes
  `changes` > `blocked` (which includes an unreported voter) > `unreadable` > `pass`.
  `changes` must outrank it for the reason the combine already states
  (`ai-review.yml:545`, `:581`): a real objection from a voter that read the code is never
  hidden behind another voter's outage or anomaly. Both orders for the remaining pair satisfy
  FR-4 and AC-5, since each label is distinct from `changes` and neither can reach `pass`, so
  the choice between them belongs to the Plan. `blocked` goes first because it is the one of
  the two that recovers on its own. `ai-review-retry` re-runs the PR, and if the anomaly
  recurs, the next run lands on `unreadable` and leaves the retry lane. So class 2 still
  cannot loop by itself, which is the property D8 needs.
  *Rejected: `unreadable` above `blocked`.* It reports the deterministic fault at once. Cost:
  it hides an outage, so the PR loses its automatic retry, and whoever acts on it (OQ-12) is
  handed a review that was also incomplete.
  *Rejected: conclusion `failure`.* It is what `decideReviewCheck`'s `else` arm returns today
  (`ai-review-guard.js:927-928`). Cost: its title reads "changes requested", which is the
  collapse FR-4 exists to end. `failure` is also the conclusion that `remediate-pr.sh:402-407`
  and `dispatch-issue.sh:1417-1420` select on, so it would enrol the PR in code remediation
  implicitly and answer OQ-12 by the back door. `action_required` still blocks the required
  check, which is the reading the `blocked` arm's own comment records
  (`ai-review-guard.js:910-915`).

---

## Components, by path, and the seam at each

| Path | Ownership | Change | Seam |
|---|---|---|---|
| `packages/minspec/src/lib/profile.ts` | **new, `implements:`** | Whole file | Resolution is pure: `fs.readFileSync` + `JSON.parse` only. A CLI entry (`runProfileCli`) plus an argv-keyed main guard (the `autonomy.ts:338-350` shape) let bash and YAML execute it. No `vscode`, no network, no `child_process`, no environment read. |
| `packages/minspec/tests/profile.test.ts` | **new, `implements:`** | Whole file | T0 for FR-1/AC-1/AC-2, the CLI grammar, and AC-4's hermetic dispatch cases |
| `packages/minspec/tests/solo-mode-keep-gates.test.ts` | **new, `implements:`** | Whole file | T0 for FR-6/AC-6 under both profiles, and for FR-5/AC-7 under `team` only (AC-7's condition). The FR-5 rows' `solo` arm waits for OQ-10 |
| `.github/workflows/machinery-witness.yml` | **new, `implements:`** | Whole file | `on: workflow_run: workflows: [ai-review-runner], types: [completed]`. Two jobs, specified under *Contracts*. `evaluate` has a read-only `GITHUB_TOKEN` and **no App token**; it checks out the base, runs `npm ci`, and executes `profile.ts` and `isMachineryPath` through `tsx`. `post` mints the App token only after evaluation, posts the check-run, and re-runs `ready-to-merge` (D10). |
| `packages/minspec/tests/machinery-witness.test.ts` | **new, `implements:`** | Whole file | Executes the `witness-classify` bash block with the existing `# >>> name` / `# <<< name` technique, and the `witness-resolve` / `witness-decide` / `witness-post` / `witness-reevaluate` github-script bodies and the self-set lists with a **new** JS-marker harness (*Contracts*), so the test cannot drift from what CI runs. Also pins the no-interpolation rule for PR-controlled strings (*Contracts*) |
| `.github/workflows/ready-to-merge.yml` | `affects:` | Read the head's `machinery-witness` check-runs and pass them into the guard | One extra `github.paginate(checks.listForRef, { check_name: 'machinery-witness' })` call and one extra argument. It sits inside the existing head-witness block (`:279-315`), after the `ai-review` check-run read (`:289-295`), in its **own** `try`. On an error it emits `core.warning` and passes `machineryCheckRuns: undefined`, so a failed read can lose only the third channel, never the two existing ones. Placed in the shared `try` instead, an API error on the new read would flip a verified non-machinery PR to unverified through the shared `catch` (`:306-315`). That would be a behaviour change in an adopter repo, which has no producer (OQ-3). No test executes this script body. The guard half is tested: `ai-review-guard.test.js` asserts that `verifyHeadPassWitness` with `machineryCheckRuns: undefined` returns exactly what today's two-channel call returns. The decision stays in the guard. The trigger set, permissions (`checks: read` is already granted, `:96`) and base pin are **unchanged**, because re-evaluation is driven from the witness side (D10). |
| `.github/scripts/ai-review-guard.js` | **UNDECLARED — OQ-2** | FR-2: `MACHINERY_WITNESS_CHECK_NAME`; `verifyHeadMachineryWitness()`; a third channel in `verifyHeadPassWitness()`. FR-4: an `UNREADABLE` constant and export, an `UNREADABLE` arm in `decideReviewCheck()` (D12), and `UNREADABLE` in `VERDICT_LABELS` (`:1006`). `shouldSummonHumanReview` (`:975-994`) may also change, under **OQ-8** and **OQ-12** | Pure functions, unit-tested in `.github/scripts/ai-review-guard.test.js` (run by `ci.yml:113`), mirroring `verifyHeadPassCheckRun` |
| `scripts/review-decide.sh` | **UNDECLARED — OQ-2** | Two `echo` lines, per the FR-4 contract: the no-parseable-verdict fall-through (`:113`) and the `BEGIN_COUNT != 1` refusal (`:189`, inside the branch at `:156`) | stdout is the label contract. The change reaches **every** caller of the script, not only `ai-review.yml` (see *Contracts*, FR-4) |
| `.github/workflows/ai-review.yml` | `affects:` | FR-4, every stage in the *Contracts* table: a fifth `gh label create` beside the four at `:224-231` and beside `:1023-1026`; the combine arm and D12's precedence in `# >>> verdict-combine` (`:583-610`); the PR-comment notice (`:651`); the post-step normaliser (`:1013-1019`), bracketed by new `# >>> verdict-normalise` markers; and the backstop's literal fallback (`:1238`) | The combine and normaliser blocks are executed verbatim by `ai-review-verdict-combine.test.ts`, which needs new cases. No existing case feeds the new label, so the arm is **not** covered merely by being written |
| `packages/minspec/src/lib/ci-review-templates.ts` | **UNDECLARED — OQ-2**; itself machinery (`MACHINERY_SINGLE_FILES`, `machinery-paths.ts:75-77`) | Regenerated by `scripts/gen-ci-templates.mjs` in every FR-2 and FR-4 PR under OQ-3 (b) or (c). Under OQ-3 (a) it stays at today's bytes, and the generator changes instead | Pinned byte-for-byte by `ci-review-templates-gen.test.ts`, which needs no edit under (b) or (c) |
| FR-4's existing tests: `review-decide.test.ts`, `verdict-channel.test.ts`, `review-approvable.test.ts`, `ai-review-verdict-combine.test.ts`, `verdict-label-enforcement.test.ts`, `ai-review-verdict-label-coherence.test.ts` (all in `packages/minspec/tests/`), and `.github/scripts/ai-review-guard.test.js` | **UNDECLARED — OQ-2** | New cases, plus changed expectations wherever today's assertion *is* the collapse FR-4 removes; each is listed, with its lines, under OQ-2 | — |
| `packages/minspec/tests/drain-selfheal.test.ts` | **UNDECLARED — OQ-2** | A `mode` fixture dimension for its native auto-merge cases (`:255-257`, `:263-301`), which seam 5 makes config-dependent or right for the wrong reason | Exact edits depend on OQ-11 |
| `.github/workflows/ai-review.yml`: the `machinery-review-required` step (`:936-986`) and the summon step (`:1184-1201`) | `affects:` | **Blocked on OQ-8.** Both say a human must review every machinery PR. That is true until the machinery arm slice lands and false after it, so whatever OQ-8 decides lands in that slice | None designed until OQ-8 is answered |
| `scripts/dispatch-issue.sh` (FR-2, machinery arm) | `affects:` | Under `solo`, let a witnessed machinery PR merge without a keystroke. **Blocked on OQ-1**, which also has to settle *where* the arm runs | Not designed |
| `scripts/dispatch-issue.sh` (FR-3, seam 5) | `affects:` | A new `profile_mode` function; a `--check-profile` pure seam beside `--check-native-automerge` (`:93-95`); and, as the first check in `native_automerge_enabled` (`:75-88`), ahead of its env/config checks at `:81-87`, a line that returns false unless `profile_mode` prints `solo`. That is the `team` deny only: past it, the `solo` path runs today's env/config checks unchanged until **OQ-11** is answered. Not blocked on OQ-1 or OQ-2. **Sequenced after the config flip** (*Build order*) | Both call sites (`:1048`'s `--auto` arm, `:1959`'s HOLD/silence branch) are unchanged code reading one new boolean |
| `scripts/dispatch-issue.sh` (FR-3, the consequence-hybrid actor) | `affects:` | Whether the second merge actor's mode resolution (`:1841-1846`) becomes profile-aware. **Blocked on OQ-5** | Not designed |
| `.minspec/config.json` | not declared – see OQ-2 | `"mode": "solo"`, added by a **human** PR (the config flip) | Withheld from native auto-merge by `paths_have_approvable_doc` mandate 2 (`dispatch-issue.sh:188-190`) and stop-classed `edits-the-autonomy-rules` (`:244`), so it reaches a human by construction |
| `scripts/auto-merge-gate.ts` | `affects:` | **No change this Plan can justify** — see OQ-5. The file *is* invoked on the second actor's path (`dispatch-issue.sh:1859`), but the mode that decides that merge is resolved in `dispatch-issue.sh`, not here | — |

**Untouched, and that is the FR-5 design.** The following are not edited at all:
`docs-lane.yml`; `scripts/push-docs.sh`; DR-065's presence-gated fast-forward
(`checkout_occupied` / `sync_shared_checkouts` in `scripts/drain-inbox.sh:311` and `:373`,
which mirror `isCheckoutOccupied` in `packages/minspec/src/lib/presence.ts:301`);
`shouldAwaitApproval` in the guard (`:811-815`); and the drain's HITL escalation
(`reconcile_done_issues`, `scripts/drain-inbox.sh:614-636`). None of them reads
`.minspec/config.json` today: a grep of `docs-lane.yml`, `push-docs.sh` and `drain-inbox.sh`
for `config.json` returns nothing. "Parked means retained" is strongest when it is enforced by
the absence of a diff. AC-7 then asserts it by execution, entry point by entry point (table
below). Leaving `docs-lane.yml` untouched also leaves its unattended merge arm (`:247`) live
under `team`, which AC-4's plain wording contradicts. This absence of a diff does not settle
that. It is OQ-13.

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
   because the ordinary `ai-review` witness already covers the PR. That set is wider than the
   `.github/**` and `scripts/**` FR-2 names, and how much of it the witness may certify is
   **OQ-15**, not decided here;
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
      - resolve   # github-script, GITHUB_TOKEN: conditions 2-3. Its body carries
                  # `// >>> witness-resolve` / `// <<< witness-resolve`. Writes the file list as
                  # JSON to $RUNNER_TEMP/files.json; outputs pr, base_sha, head_sha. A failed
                  # condition fails the job (visible, posts nothing)
      - uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd    # v5.0.1, as ai-review.yml:244
        with: { ref: <base_sha from resolve>, persist-credentials: false }
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020  # v4.4.0, as ai-review.yml:251
        with: { node-version: '22' }
      - run: |                      # a `|` block, as the textual guard below requires of every body
          npm ci                    # the BASE lockfile, which pins tsx 4.23.1 (package.json:36)
      - classify  # run:, between `# >>> witness-classify` / `# <<< witness-classify`:
                  #   PROFILE   <- node_modules/.bin/tsx packages/minspec/src/lib/profile.ts
                  #                  --repo-root "$GITHUB_WORKSPACE"   (consumer rule above)
                  #   MACHINERY <- node_modules/.bin/tsx -e '<require("./packages/minspec/src/lib/
                  #                  machinery-paths.ts").isMachineryPath over the JSON list at
                  #                  $FILES_JSON>'; prints exactly `true` or `false`, and anything
                  #                  else fails the job (visible, posts nothing)
      - decide    # github-script. Its script body carries JS line-comment markers
                  # `// >>> witness-decide` / `// <<< witness-decide`, with the self-set
                  # region nested at the top (harness below). Requires the BASE guard and
                  # fails closed if it is absent, exactly as ready-to-merge.yml:154-173 does;
                  # conditions 1, 4, 5, 6 -> outputs
  post:
    needs: evaluate
    if: needs.evaluate.outputs.post == 'true'
    permissions: { actions: write } # the GITHUB_TOKEN is used for the re-run only
    steps:
      - uses: actions/create-github-app-token@f2acddfb5195534d487896a656232b016a682f3c # v1.9.0, as ai-review.yml:192
      - post      # github-script, App token; body carries `// >>> witness-post` / `// <<< witness-post`.
                  # Its inputs come from `evaluate` ONLY through env:
                  #   W_CONCLUSION / W_TITLE / W_SUMMARY / W_HEAD_SHA: ${{ needs.evaluate.outputs.<same> }}
                  # read as process.env.W_*, validated (below), then POST /repos/{o}/{r}/check-runs
                  # as the App: the MachineryWitnessCheckRun below
      - reevaluate  # github-script; body carries `// >>> witness-reevaluate` / `// <<< witness-reevaluate`
                    # (D10): take the newest ready-to-merge.yml run with head_sha = process.env.W_HEAD_SHA
                    # (env:, exactly as for `post`) and
                    # event pull_request; poll until completed (POLL_ATTEMPTS = 10, POLL_DELAY_MS =
                    # 30_000, through an injectable `sleep`); POST .../actions/runs/{id}/rerun.
                    # No run, a timeout, or an API error -> core.setFailed. The check-run exists,
                    # but ready-to-merge stays red until the next pull_request event: closed AND visible
```

There are two jobs so that the App token never shares a job with the packages `npm ci`
installed, and a compromised dependency cannot read it. File names are PR-controlled strings,
so the list only ever travels as a JSON file whose path is in `env`. It is never interpolated
into a shell or script body, the discipline `ready-to-merge.yml:73-78` states.

**The same rule holds across the job boundary, which is where the App token is.** Condition 5's
summary names the offending path, so `evaluate`'s `summary` output carries a PR-controlled
string into `post`. Every `needs.evaluate.outputs.*` value therefore enters a `post` step only
as an `env:` value, read as `process.env.W_*`. No `${{ … }}` expression appears inside any
`run:` or `script:` body in either job. `witness-post` validates before it writes. `W_CONCLUSION`
must be exactly `success` or `action_required`, and `W_HEAD_SHA` must match `^[0-9a-f]{40}$`;
anything else is `core.setFailed`, and nothing is posted. `W_TITLE` and `W_SUMMARY` reach the
REST call only as JSON string fields, which are data, never code. `machinery-witness.test.ts`
pins both halves. (1) Textually, because the repo has no YAML-parser dependency. Every `run:`
and `script:` value in the file must be a bare `|` block scalar, and the test fails on any other
form (single-line, folded `>`, a chomping indicator, quoted), so no body sits outside the scan.
It tracks each block by indentation (a block ends at the first non-blank line indented at or
left of its key) and asserts that no `${{` occurs inside one. (2) By execution:
the `witness-post` region, run under the harness below with a `W_SUMMARY` whose path holds a
backtick, `$(id)` and `${{ secrets.X }}`, reaches the stubbed `checks.create` call
byte-identical; a `W_CONCLUSION` of `failure`, or a 39-character `W_HEAD_SHA`, fails the job with
no call made.

Two facts were
checked on 2026-09-11. First, `tsx -e` can `require()` a `.ts` module (tsx 4.23.1,
node 22.23.2). Second, the runs API filters by `head_sha`:
`GET /actions/workflows/ready-to-merge.yml/runs?head_sha=…` returned only that head's runs,
each with `event: pull_request`.

**How `machinery-witness.test.ts` executes the four github-script bodies. This is new harness
work, not an existing technique.** `witness-classify` is a bash `run:` block, so the
`# >>> … # <<<` extraction `ai-review-verdict-combine.test.ts` already uses applies to it
unchanged. `witness-resolve`, `witness-decide`, `witness-post` and `witness-reevaluate` are JavaScript inside `script: |`, where
a `#` line is not valid code, and no test in this repo executes a github-script body today.
The contract:

- **Markers.** Each JS region is bracketed by line comments inside the script body:
  `// >>> witness-resolve` / `// <<< witness-resolve`,
  `// >>> witness-decide` / `// <<< witness-decide`, `// >>> witness-post` / `// <<< witness-post`
  and `// >>> witness-reevaluate` / `// <<< witness-reevaluate`, with
  `// >>> witness-self-set` / `// <<< witness-self-set` nested
  at the top of the decide region. The test fails loudly if any marker is missing, the way
  `ai-review-verdict-combine.test.ts:29-40` does.
- **Execution.** The test strips the block scalar's indentation from the extracted region and
  compiles it as `new AsyncFunction('github', 'context', 'core', 'require', 'process', 'sleep',
  region)`, where `AsyncFunction = Object.getPrototypeOf(async () => {}).constructor`. A
  marked region may reference no free identifier outside that parameter list. `github` is a
  stub whose `rest.*` and `paginate` return fixture data or throw a fixture error; `core` is a
  stub that records `setOutput`, `warning`, `error` and `setFailed`; `require` is Node's, so the
  base guard loads for real.
- **Time.** `sleep` is defined in the workflow **above** the region
  (`const sleep = (ms) => new Promise((r) => setTimeout(r, ms));`), so CI gets the real delay
  and the harness injects a no-op that records its argument. The poll uses two named constants
  inside the region, `POLL_ATTEMPTS = 10` and `POLL_DELAY_MS = 30_000`. The test asserts the
  attempt count and the delays through the recorded calls, never against wall-clock time.
- **Outputs.** A region reports only through `core.setOutput` and `core.setFailed`, which is
  what the INV-1 assertions read. The one exception is the `files.json` that `witness-resolve`
  writes under `process.env.RUNNER_TEMP`; the test points that at a temp dir and reads it.

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

```js
// The witness self set. Carried verbatim at the top of the `witness-decide` region of
// .github/workflows/machinery-witness.yml, so the lists the running block matches against
// ARE the lists the test reads. Pinned by packages/minspec/tests/machinery-witness.test.ts.
// >>> witness-self-set
const WITNESS_SELF_SET = [                    // every entry MUST be broad-set machinery
  '.github/workflows/ai-review.yml',          // stage 1
  '.github/workflows/machinery-witness.yml',  // stage 2 — this file
  '.github/workflows/ready-to-merge.yml',     // the consumer gate
  '.github/scripts/ai-review-guard.js',       // the decision module both stages load
  'scripts/review-branch.sh',                 // the reviewer control plane
  'scripts/review-decide.sh',                 // the deterministic verdict gate
  'scripts/roles/**',                         // the voter prompts
  'scripts/lib/agent-context.sh',             // sourced unguarded by review-branch.sh
];
const WITNESS_SELF_SET_NONMACHINERY = [       // each entry names the gate that holds it alone
  '.minspec/config.json',                     // the profile value; alone, held by paths_have_approvable_doc mandate 2
];
// Entry grammar, and the only matcher: an exact repo-relative path, or `<dir>/**` meaning
// every path under `<dir>/`. No other glob syntax exists, so there is no dependency.
function selfSetMatch(entry, file) {
  return entry.endsWith('/**') ? file.startsWith(entry.slice(0, -2)) : file === entry;
}
// <<< witness-self-set
```

The reason trails each entry as a JS comment, so it is never part of the data. The test gets
the arrays by evaluating the region alone
(`new Function(region + '; return { WITNESS_SELF_SET, WITNESS_SELF_SET_NONMACHINERY, selfSetMatch };')()`),
and gets the decision by executing the whole decide region, which contains it.

**Why two lists, and what the test asserts.** Condition 4 means the witness only ever judges
a PR that touches at least one broad-set path. A self-set entry that is *not* broad-set
machinery can therefore only bite on a mixed PR. A PR that touches such a file alone takes the
ordinary non-machinery path, and the witness never sees it. The earlier draft put three such
files in one list and said the test asserted each one was machinery. That test was red by
construction, since `machinery-paths.ts:52-78` contains none of them, and the protection was
silently partial. The contract is now:

- every entry obeys the two-rule grammar (no `*` anywhere except a trailing `/**`) and matches
  at least one tracked path (`git ls-files`, through the same `selfSetMatch` CI runs);
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
  | 'ai-review:changes'     // the reviewer READ the code and objects. Until OQ-14 is answered it
                            // also still carries the refusals this contract does not reroute:
                            // ESCALATE and a garbled `verdict:` / `blocking:`
                            // (review-decide.sh:87-89, :208-210, :217).
  | 'ai-review:blocked'     // the reviewer could not RUN. Retry-able; ai-review-retry owns it.
  | 'ai-review:unreadable'  // NEW. The reviewer ran, but its output could not be read as a
                            // verdict. Deterministic in the diff, so NOT retry-able.
  | 'ai-review:pending';    // unchanged
```

**FR-4, stage by stage.** A label is only as distinct as the last stage that handles it. An
earlier draft named two of these stages, and the post-step normaliser alone would have
rewritten the new label to `changes` before it was applied. A later revision still missed the
four per-voter comment placeholders and two lines of the script's own contract text; both are
rows now. Every stage from the voter's output to the applied label:

| Stage | Where | Change |
|---|---|---|
| Per-voter decision | `scripts/review-decide.sh:113` (no parseable verdict, not quota-shaped) and `:189` (`BEGIN_COUNT != 1`) | `:113` prints `ai-review:blocked` and exits 0, matching the existing `blocked` exits (`:83`, `:111`). `:189` prints `ai-review:unreadable` (it already exits 0). Every line of the script's own contract text that names the label set or the exit codes is rewritten to match: the header (`:4-5`, and `:8-10`, which lists "more than one verdict block" among the `changes` causes), the stdout and exit lines (`:27-28`), and the diagnostic's stdout note (`:171`); so is `ai-review.yml`'s header (`:19-22`). `:28` claims exit 2 on every non-clean path, which is already false at `:83`, `:111`, `:190` and `:217`. It becomes a statement of the exits as they stand after this slice. With OQ-14 unanswered, that is: stdout is the contract, exit 2 marks only the `changes` refusals at `:88` and `:209`, and exit 0 means everything else. No automated caller reads the exit status; every one discards it with `\|\| true` (`ai-review.yml:512`, `:520`, `:529`, `:538`; `dispatch-issue.sh:950`, `:958`; `review-pr.sh:206`). **Not rerouted, pending OQ-14:** the field-level refusals (`:208-210`, `:217`) and ESCALATE (`:87-89`) still print `changes`. An earlier draft kept them there as settled design ("FR-4 names two classes, and neither is this"); that was a Plan narrowing a MUST, and it is now a question |
| Per-voter comment placeholder | `ai-review.yml:514`, `:522`, `:531`, `:540` | Each reads "(… emitted no verdict block — fail-closed to changes)". The block is empty only when `review-decide.sh`'s `BLOCK` is too, because the display-side `extract_block` (`:314`) carries the same anchors (`review-decide.sh:66-67`). After this slice that outcome is `blocked` (the marker, quota, or class 1). It is `changes` only through ESCALATE, so the old text would contradict the label above it. Each becomes "(… emitted no verdict block — no code verdict was read)". No test pins these strings (a grep of `packages/minspec/tests` for "fail-closed to changes" finds nothing). `review-pr.sh:230`'s copy stays, because that script still collapses every non-`pass` label to `changes` (`:207-210`) |
| Panel combine | `ai-review.yml:583-610` (`# >>> verdict-combine`) | A fourth flag and arm, and one more `elif`, in full below (D12). The precedence comment above it (`:545-567`, "Precedence is changes > blocked > pass") is rewritten to D12's order |
| Self-edit override | `:628-630` | Unchanged: an indeterminate changed set still forces `changes` |
| PR comment | the branch at `:651` | One `if [ "$FINAL" = "ai-review:unreadable" ]` notice at the top of the non-`blocked` branch: the reviewer ran but its output could not be read as a verdict (#1157), this is not a code verdict, and it does not auto-retry |
| `ai-review` check-run | `decideReviewCheck` (`ai-review-guard.js:887`), called at `ai-review.yml:877` | A new arm after `BLOCKED` (`:910`): conclusion `action_required` (D12), title *"AI review output could not be read as a verdict — not a code verdict, does not auto-retry"*. A machinery PR still takes the `neutral` arm first, as it does for `blocked` (`ai-review-guard.test.js:389`) |
| Post-step normaliser | `ai-review.yml:1013-1019` | The keep-list becomes `ai-review:pass\|ai-review:blocked\|ai-review:unreadable) ;;`. The block is bracketed by new `# >>> verdict-normalise` / `# <<< verdict-normalise` markers so a test executes it. Its comment (`:1013-1015`), which calls `pass` and `blocked` "the only non-changes states", is rewritten with it. Without this arm the new label is applied as `changes` |
| Label object | the four up-front creates (`:224-231`) and the create-before-add (`:1023-1026`) | A fifth `gh label create "ai-review:unreadable"` in each place |
| SHA-bound pass witness | the `PASS_STATE` branch (`:1059`) | Unchanged: anything but a non-machinery `pass` posts `failure` |
| Label coherence | `decideVerdictLabels` (`ai-review-guard.js:1029`) over `VERDICT_LABELS` (`:1006`) | `UNREADABLE` joins `VERDICT_LABELS` and the exports. Without it `decideVerdictLabels` throws `unknown verdict` (`:1031`), the step fails, and the backstop labels the PR `changes` |
| Backstop clear | `ai-review.yml:1235-1238` | The literal fallback list gains `ai-review:unreadable` |
| Summon | `shouldSummonHumanReview` (`ai-review-guard.js:975-994`) | **OQ-12.** Today it returns false for this label on a non-machinery PR |
| Merge gate | `decideStatus` (`ai-review-guard.js:741`, green only at `:754`) | Unchanged: green needs a verified `ai-review:pass`, and an `unreadable` PR carries none. That, together with the `action_required` check, is AC-5's "neither is auto-merged" |

The combine block after this spec:

```bash
          # >>> verdict-combine
          ANY_BLOCKED=no
          ANY_CHANGES=no
          ANY_UNREPORTED=no
          ANY_UNREADABLE=no
          for pair in …; do            # the four "req:label" pairs, unchanged
            req="${pair%%:*}"
            lbl="${pair#*:}"
            [ "$req" = "yes" ] || continue
            case "$lbl" in
              ai-review:pass)       ;;
              ai-review:blocked)    ANY_BLOCKED=yes ;;
              ai-review:changes)    ANY_CHANGES=yes ;;
              ai-review:unreadable) ANY_UNREADABLE=yes ;;
              *)                    ANY_UNREPORTED=yes ;;
            esac
          done
          if [ "$ANY_CHANGES" = "yes" ]; then
            FINAL="ai-review:changes"
          elif [ "$ANY_BLOCKED" = "yes" ] || [ "$ANY_UNREPORTED" = "yes" ]; then
            FINAL="ai-review:blocked"
          elif [ "$ANY_UNREADABLE" = "yes" ]; then
            FINAL="ai-review:unreadable"
          fi
          # <<< verdict-combine
```

`FINAL` still starts at `ai-review:pass` (`:568`). So adding the `case` arm without the
matching `elif` would let `[pass, unreadable, pass, pass]` combine to `pass`, a fail-open, and
leaving the arm out would route the label through `*)` to `blocked`, the retry lane D8
rejects. The combine test pins both: that input must give `unreadable`.

**Callers of `review-decide.sh` that this design leaves unchanged, and why.** The `:113` and
`:189` changes reach every caller, not only `ai-review.yml`:

- `scripts/review-pr.sh:207-210` collapses anything but `pass`/`changes` to `changes`, as it
  already does for `blocked`. It has no automated caller: only comments, and the template
  generator's "drift-gated only; not scaffolded" entry (`scripts/gen-ci-templates.mjs:90-91`),
  reference it. FR-4's rationale is unattended operation, which this manual path is not.
- `scripts/review-approvable.sh` pipes into the gate, and nothing automated consumes its
  output: no workflow, script or extension source references it except the template
  generator's "drift-gated only; not scaffolded" entry (`scripts/gen-ci-templates.mjs:96-97`).
  Its empty-doc and crash cases (`review-approvable.test.ts:111`, `:134`) will read `blocked`,
  which is literally true because the reviewer never ran. With no automated consumer, no retry
  loop can form.
- `run_reviewer_stage` in `dispatch-issue.sh` (`:941-975`) is advisory. It posts a comment and
  never applies a label (`:1127`); CI's label is the authority.
- `ai-review-retry.yml` keeps selecting only `ai-review:blocked` (`:65`). Keeping `unreadable`
  out of it is D8's point.

---

## Invariants, and how each is tested

T0 first: every row below is written and red before the behaviour it constrains exists.

| Invariant | What must hold | T0 test, by execution |
|---|---|---|
| **INV-1** / constitution 2 — no silent gate | No new load-bearing signal is written with a swallowed error; a missing or errored witness fails closed **and visibly** | `machinery-witness.test.ts`: drive the `witness-resolve` block with each input of conditions 2-3 (no PR, PR disagreement, stale head, non-default base branch, short files page, API error) and assert it fails the job with no `pr` output and no `files.json`; drive the `witness-decide` block with each remaining failure input (API error, base checkout missing, guard unloadable, a resolver that exits non-zero or prints anything but `solo`/`team`) and assert the outcome is "post nothing or `action_required`", never `success`; drive the `witness-reevaluate` block with no run, a run that never completes, and a rerun API error, and assert each fails the job; and assert every such path emits a `::warning` or `::error` — the #810 lesson, where a silently swallowed 403 made a required gate unsatisfiable repo-wide |
| **INV-1**, second witness | `ready-to-merge` must not come to hinge on the machinery witness alone | `machinery-witness.test.ts`: with the witness absent, a non-machinery PR still greens through the existing `ai-review/pass` **or** `ai-review` channels; `verifyHeadPassWitness` tries the two existing channels before the new one |
| **INV-2** — approval stays human under both profiles | `checkApprover` / `assertHumanApprover` (`packages/minspec/src/lib/approval.ts`) deny an agent identity regardless of `mode` | `solo-mode-keep-gates.test.ts`: `approveSpec(fixtureRoot, specPath, 'T4', <agent identity>)` (`approval.ts:517`), which takes the repo root and calls `assertHumanApprover` before any write (`:524-528`), against a `mode: solo` and a `mode: team` fixture; assert it throws `ApproverDeniedError` and writes no sidecar under both. A direct `checkApprover` call takes no root, so it cannot see the fixture and is not the invariance proof (see the FR-6 table) |
| **INV-3** — irreversible/outward-facing stays human under both profiles | `mayProceed` denies `irreversible-or-outward-facing` and `approval-or-acceptance` whatever the profile says | `solo-mode-keep-gates.test.ts`, through `--may-merge` (`dispatch-issue.sh:316-318`) in a **hermetic copy** of the script tree whose own config carries the profile, never through `MINSPEC_AUTONOMY_REPO_ROOT`. The copy, its cases, the reason it asserts, and its profile-reachability witness are specified in *The INV-3 harness* below. A direct `mayProceed('act', …)` call is kept as a behaviour check, but it takes no config, so it is not the invariance proof |
| **INV-4** / constitution 3 — blast radius | The profile is per-project and changes nothing in a repo without `.minspec/` | `profile.test.ts`: `readProfileMode(<tmpdir with no .minspec>)` is `team`; and a **reachability** assertion over esbuild's metafile, so the claim is about the shipped bundle, not about one file's imports. The test calls esbuild's JS API (`esbuild` is already a devDependency, root `package.json:32`) with the entry point and bundle flags of `scripts/build-extension.sh` (`src/extension.ts` at `:73`/`:76`; `--bundle --external:vscode --format=cjs --platform=node` at `:52-55`), plus `metafile: true`, `write: false` and `absWorkingDir` set to `packages/minspec`. It asserts that no key of `metafile.inputs` ends in `src/lib/profile.ts`. `inputs` lists every file the bundler loaded, so this is stricter than tree-shaking: it forbids any import path at all. As a liveness control, `src/extension.ts` and `src/lib/config.ts` must both be keys, so a build that loaded nothing cannot pass. Checked 2026-09-11 against this tree: 163 inputs, both controls present, `auto-merge.ts` and `machinery-paths.ts` absent. `auto-merge.test.ts:454-470` is **not** the precedent: it regex-checks one module's direct imports and cannot see reachability |
| Constitution 1 — offline | `profile.ts` makes no network call, and no consumer fetches a runner | A direct-import assertion over `profile.ts`'s own source, the regex shape `auto-merge.test.ts:454-470` uses for `auto-merge.ts`: its import list is exactly `node:fs` and `node:path`. And `profile.test.ts` runs `dispatch-issue.sh --check-profile` in a hermetic copy with no `node_modules/.bin/tsx`, with a `PATH` stub for `npx` that fails the test if invoked, and asserts `team` (the `autonomy.sh:92-98` rule) |

### The INV-3 harness

The earlier form of this test pointed `MINSPEC_AUTONOMY_REPO_ROOT` at a fixture and varied
`mode` there. It could not fail, for three reasons. First, that variable moves only
`autonomy.sh`'s root (`scripts/lib/autonomy.sh:45`), never `profile_mode`'s, which derives its
root from `SCRIPT_DIR` and has no redirect (*Contracts*), so both arms read the same real-repo
profile. Second, it also moves the runner lookup (`:89`). A fixture with no `node_modules`
therefore denies at `:97` with `gate-invocation-failed` under both profiles, before `mayProceed`
runs. `autonomy-merge-gate.test.ts:188-198` shows a bare root denying that way, and `:281-282`
shows that a fixture root also needs `MINSPEC_AUTONOMY_TSX_BIN`. Third, the seam it named,
`--autonomy-stop-classes` (`dispatch-issue.sh:312-315`), only derives the class list and never
reads config. The deciding seam is `--may-merge` (`:316-318`), which runs `autonomy_may_merge`
(`:292`).

- **Copy.** A temporary root holding:
  - `scripts/dispatch-issue.sh`;
  - the seven `scripts/lib/*.sh` it sources at startup (`:26-67`: `agent-context`, `gh-bot`,
    `agent-egress`, `docs-corpus`, `autonomy`, `issue-lease`, `workflow-paths`), the list
    `drain-selfheal.test.ts:263-301` already copies;
  - `scripts/lib/autonomy.ts`, and `packages/minspec/src/lib/profile.ts` once the resolver slice
    has landed it;
  - a `node_modules` symlink to the real one;
  - `.minspec/config.json` = `{"autonomy":"act","mode":"solo"}`, then the same with `"team"`.
- **Environment.** `MINSPEC_AUTONOMY`, `MINSPEC_AUTONOMY_REPO_ROOT` and `MINSPEC_AUTONOMY_TSX_BIN`
  are **deleted** from the child env, not set to `''`, for the reason `seam()` records
  (`autonomy-merge-gate.test.ts:70-78`). With none of them set, `autonomy.sh` derives its root and
  its runner from the copy's own location (`:36`, `:45`, `:89`) and hands that root to the
  TypeScript as `--repo-root` (`:102`). `profile_mode` derives its root from the copy's
  `SCRIPT_DIR`. So **both readers see the fixture**.
- **Cases.** Each runs under both profiles and expects an identical outcome. Invocation:
  `bash <copy>/scripts/dispatch-issue.sh --may-merge`, with paths on stdin. The test parses the
  one line of JSON on stdout, and the exit code.
  1. Control, `packages/minspec/src/lib/config.ts`: exit 0, `reason: "proceed"`. This proves the
     copy's runner and its `autonomy: act` are live, so a dead harness fails the test rather than
     denying its way to green.
  2. `sites/index.html` (`PUBLISH_PATH_RE`, `dispatch-issue.sh:121`): exit 1,
     `reason: "stop-class-applies"`, with `detail` naming `irreversible-or-outward-facing`.
  3. An empty change set (`:238-240`): the same.
  4. `specs/<any>/requirements.md`: exit 1, `reason: "stop-class-applies"`, with `detail` naming
     `approval-or-acceptance`.
  Checked 2026-09-11 against this tree, with tsx 4.23.1 from `node_modules` and both configs, the
  outcomes were exactly these. The redirect-only form above returned `gate-invocation-failed`.
- **Reachability witness.** The auto-merge gate slice, which introduces `profile_mode`, adds one
  assertion to this harness: `--check-profile` in the same copy prints the fixture's mode. From
  then on, a `solo` branch added anywhere on the `--may-merge` path sees `solo` and turns the
  `solo` arm red. That holds for a branch in bash, and for one in `autonomy.ts`, which receives
  the copy root. Before that slice no profile reader exists, so there is nothing to reach.
- **Deliberately not a case: a machinery path.** `.github/**` and `scripts/**` reach
  `irreversible-or-outward-facing` only through dispatch's conservative mapping
  (`dispatch-issue.sh:222-226`, applied at `:250-251`). Both of OQ-1's options change that mapping
  under `solo`, so pinning the machinery outcome here would decide OQ-1 in a T0. It is added with
  OQ-1's answer.

### FR-6's keep list, asserted by execution (AC-6)

Each gate runs **twice** — once against a fixture repo whose `.minspec/config.json` says
`mode: solo`, once `mode: team` — and the assertion is that the outcome is identical **and**
is the rejecting one.

Running both arms proves profile-invariance **only where the executed entry point actually
receives the fixture**: its root, a process whose working directory is the fixture, or a
config loaded from it. A pure function whose signature has none of those cannot see the
fixture's `mode`. Examples are `applyFloor(predicted, userTier?)` (`classifier.ts:92`),
`checkApprover(email, extraDenied)` (`approval.ts:441`), `canonicalSpecHash(specFilePath)`
(`approval.ts:338`) and `mayProceed(autonomy, action)` (`scripts/lib/autonomy.ts:137`). Called
directly, both arms of such a function pass identically by construction, and they would stay
green if a `solo` branch were added at a call site. An earlier draft's table called exactly
those functions, so it could not fail. Each row below therefore drives the outermost
executable entry that does receive the fixture. `loadConfig` (`config.ts:119`) carries unknown
keys through `deepMerge` (`:100-113`), so the fixture's `mode` is present in the config object
that a config-taking gate receives.

| Keep gate (DR-076) | Executed entry point, and what of the fixture it receives | Assertion |
|---|---|---|
| Hash-locked approval staleness | `getApprovalStatus(fixtureRoot, specPath)` (`approval.ts:493`): takes the root, reads the fixture's committed sidecar, and hashes through `canonicalSpecHash`. Fixture: a spec and its sidecar, then one content byte edited | `stale` under both profiles |
| Tier classifier floor, and the ceremony it selects | `classify(t4Signals, loadConfig(fixtureRoot))` (`classifier.ts:109`), which reads `config.phaseMappings` (`:139`), the table a `solo` ceremony cut would key on; then `applyFloor(result.tier, 'T1')` | tier `T4`, and `suggestedPhases` contains every `phaseMappings.T4.requiredPhases` entry, under both |
| Frontmatter / validator gates | `validateOwnership(spec, loadConfig(fixtureRoot))` (`spec-validator.ts:784`) on a T4 fixture with no `implements:`, the fixture config setting `ownershipDeclaration: "error"` (read at `:813`) | the same `ownership.implements.missing` violation (`:812`) at `error` severity under both |
| RCDD `Root cause:` hook | spawn `.githooks/commit-msg <tmpfile>` with its working directory set to the fixture repo, a `fix:` subject and no `Root cause:` line | non-zero exit under both |
| T3/T4 approval stays human | `approveSpec(fixtureRoot, …)` — INV-2 row above | throws, and no sidecar, under both |
| Irreversible / outward-facing stays human | `--may-merge` in a hermetic copy whose root **is** the fixture, so the autonomy reader and the profile reader both see it; see *The INV-3 harness* above | `stop-class-applies`, naming the class, for the publish, empty-set and spec cases, identically under both. The control's `proceed` is the harness's liveness check, not a keep-gate outcome, so it is the one case here that is not "the rejecting one" |

**What this suite still cannot catch, stated rather than claimed.** `applyFloor`'s only
production caller is `packages/minspec/src/commands/classify.ts:86`
(`applyFloor(result.tier)`), inside the VS Code extension host. The two tests that execute it,
`classify-command.test.ts` and `commands.test.ts`, both mock `vscode` and `loadConfig` (`:14`,
`:66-68`; `:5`, `:72-74`), so neither can see a fixture's `mode`, and a `solo` branch at that
call site would pass this suite. An import of `profile.ts` there would turn INV-4's metafile test red (`classify.ts`
is in the bundle through `extension.ts:7`; checked 2026-09-11), but a read of `mode` off
`loadConfig`'s result would not. The "T1 drift guard" an earlier draft leaned on here named no
file, seam or consumer list, and is removed. Whether AC-6 accepts the residual is **OQ-16**.

### The rest of the acceptance criteria

| AC | Tier | How |
|---|---|---|
| AC-1 (FR-1) | T0 | `profile.test.ts`: with the environment emptied, drive **each** consumer's resolution path against one fixture repo, and assert all three return the same value, for a `solo` fixture and for a `team` fixture. The three are: `readProfileMode` directly; the bash consumer through `dispatch-issue.sh --check-profile` in a hermetic copy (the `drain-selfheal.test.ts:263-301` pattern, plus `profile.ts` and a `node_modules` symlink so the pinned runner resolves); and the YAML consumer, by executing the `witness-classify` block verbatim under bash. Asserted by driving consumers, not by reading the file |
| AC-2 (FR-1, negative) | T0 | `profile.test.ts`: a table of `undefined`, `''`, `'Solo'`, `' solo '` (accepted, trimmed), `'sol o'`, `'true'`, `'team '`, `{}`, `42`, malformed JSON, missing file → every one resolves `team` except the exact token. The CLI grammar: `--repo-root` missing or empty, or any extra argument, gives exit 2 with empty stdout. The consumer rule, through the bash seam: no runner → `team`; a runner that exits 0 printing `Solo` or `solo ` → `team`; a runner that exits non-zero printing `solo` → `team`. And because no environment override exists, `MINSPEC_MODE=solo` exported over a `mode: team` config still resolves `team`, which guards that the removed interface stays removed |
| AC-3 (FR-2) | T0 + T2, **partial — not discharged by this Plan** | `machinery-witness.test.ts`: the decision block, executed verbatim with the new harness (*Contracts*), returns `success` for a machinery PR with a verified pass and no self-set touch, and `action_required` for one that touches a self-set path. The `witness-reevaluate` block, executed against stubbed run lists, re-runs the newest completed `ready-to-merge` run for the head, waits for an in-progress one, and fails the job when there is none. That covers AC-3's second half (a PR that changes the witness cannot self-certify) and the decision behind its first. The first half's two outcomes are not T0. `ready-to-merge` reaching success is observed only at T2, on the first real machinery PR after landing (the platform chain: `workflow_run` fires, the re-run replays the `pull_request` payload, the gate greens). And **merging with no keystroke has no seam in this Plan**: it is the machinery arm slice, blocked on OQ-1. OQ-1 discloses that gap; this row no longer claims both halves |
| AC-4 (FR-3) | T0, **`team` half of the native actor only** | `profile.test.ts` drives the existing `--check-native-automerge` seam (`dispatch-issue.sh:93-95`) in hermetic copies. It reuses the `drain-selfheal.test.ts:263-301` technique inside a declared test file, adding a `mode` fixture dimension: `mode: team` + `autoMerge.native: true` → `off`; `mode: team` + `MINSPEC_AUTOMERGE_NATIVE=1` → `off` (an exported env var cannot loosen a committed `team`); `mode: solo` + `autoMerge.native: true` → `on`. What an **absent** key means under `solo` is not pinned: that is OQ-11, and an earlier draft's `mode: solo` + no key → `off` case, which hard-coded one answer, is removed. The case is written once OQ-11 is answered. This test exercises a non-machinery PR's actual merge arm, which is why AC-4 needs it: the witness never posts for a non-machinery PR under either profile (condition 4), so it cannot tell the two apart. It cannot see the second merge actor (`dispatch-issue.sh:1915-1922`) or the third (`docs-lane.yml:247`), so AC-4's `team` half is discharged for the native actor only, until OQ-5 and OQ-13 are answered. The existing `drain-selfheal.test.ts` cases that seam 5 changes are listed under OQ-2 |
| AC-5 (FR-4) | T3, red-then-green, **at the applied label, not only the voter's** | Two layers, both using **reproductions** of #1234 (a voter output with no verdict block and no quota phrasing) and #1157 (a voter output that names `REVIEW_VERDICT_BEGIN` in prose beside one real block). (1) `review-decide.test.ts`: the voter's label is `ai-review:blocked` and `ai-review:unreadable` respectively. (2) `ai-review-verdict-combine.test.ts`: each reproduction goes through the real `review-decide.sh`, then with three passing voters through the verbatim `verdict-combine` block, then through the verbatim `verdict-normalise` block. The assertion is on the label that would be applied. Layer 2 is what catches a missing combine arm (the label would fall through `*)` to `blocked`) or a missing normaliser arm (it would be applied as `changes`), which layer 1 alone cannot, because it stays green while the PR still receives `ai-review:changes`. Layer 2 also carries D12's precedence cases, including `[pass, unreadable, pass, pass]` → `unreadable`, never `pass`. For "neither is auto-merged", `ai-review-guard.test.js` asserts `decideReviewCheck(UNREADABLE, false).conclusion === 'action_required'` with a title distinct from `changes`', and that `decideStatus` over `['ai-review:unreadable']` is `failure`. All of these are red against today's code |
| AC-6 (FR-6) | T0 | The keep-list table above |
| AC-7 (FR-5) | T0, **`team` arm only** | `solo-mode-keep-gates.test.ts`, one entry point per FR-5 subsystem, against a `mode: team` fixture: the table below. The `solo` arm is not written until OQ-10 is answered |

#### AC-7's entry points (FR-5)

Each row runs against a `mode: team` fixture, which is AC-7's condition, and asserts today's
behaviour. It deliberately does **not** also run under `mode: solo`. What these subsystems
should do under `solo` is OQ-10, which is not decided. A `solo` arm asserting identical
behaviour would hard-code OQ-10's option (a) into a T0 that lands, in the keep-list slice,
before the founder answers. An earlier draft did exactly that. Once OQ-10 is answered, the
`solo` arm is added with the answer's expected outcome: identical under (a), off under (b).
Every harness already exists; this suite reuses the technique and does not edit the file it
comes from.

| FR-5 subsystem | Executed entry point | Harness it reuses | Assertion |
|---|---|---|---|
| Docs-lane | the `run:` block of `.github/workflows/docs-lane.yml`, run under bash with a stubbed `gh` | `extractRunBlock` in `docs-lane-hold.test.ts` | a docs-only PR labelled `docs-lane` arms auto-merge; the same PR with a `hold:*` label does not. This asserts AC-7 as approved. For this PR AC-4 reads the other way under `team`; that is OQ-13, and under its option (b) AC-7 and this row both change |
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

- **The keep-list slice (FR-6).** `solo-mode-keep-gates.test.ts` alone: the FR-6 rows under
  both profiles (AC-6), and the FR-5 rows under `team` only (AC-7). The FR-5 rows' `solo` arm
  is **not** in this slice, because it would decide OQ-10 before OQ-10 is answered. Depends on
  nothing, changes nothing, and must be green *before* any profile-keyed branch exists —
  otherwise the keep list is prose again.
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
- **The auto-merge gate slice (FR-3, dispatch — the `team` deny only).** `profile_mode`,
  `--check-profile`, and the `team` deny in `native_automerge_enabled` (seam 5), with AC-4's
  three cases in `profile.test.ts`. It also adds the INV-3 harness's reachability witness
  (`--check-profile` inside that copy), because this slice creates the first profile reader
  that witness can reach. The deny is common to every option of OQ-11, which is why it
  can land before OQ-11 is answered. The `solo` arm (OQ-11) and the second merge actor (OQ-5)
  are **not** in this slice. Not blocked on OQ-1. It reddens nothing, but it leaves two
  `drain-selfheal.test.ts` cases passing for the wrong reason (`:255-257`, `:263-301`, see
  OQ-2) until that file is amended, which needs OQ-2 (the file is undeclared) and OQ-11 (the
  expected values). **Blocked on the config flip.** `.minspec/config.json` today has
  `autoMerge.native: true` and no `mode` key, so landing seam 5 first would resolve `team` and
  switch off this repo's live native auto-merge. Every dispatched PR would then take the HOLD
  branch (`dispatch-issue.sh:1959-1966`: the "Auto-merge held" comment and `needs-human-skim`).
  This is the slice AC-4's `team` half exercises.
- **The false-red slice (FR-4).** `review-decide.sh`, the guard's `UNREADABLE` constant,
  `decideReviewCheck` arm and `VERDICT_LABELS` entry, and every `ai-review.yml` stage in the
  FR-4 contract table, with the tests listed under OQ-2. Independent of the profile entirely.
  That makes it useful on its own, and it makes solo mode safer rather than depending on it.
  It also means nothing keys it on `mode`, so it changes review behaviour in every adopter repo
  that runs the scaffolded stack; OQ-3 lists what changes. Blocked on OQ-2 (two code files,
  the generated templates and seven test files are undeclared), OQ-3 (every file it edits is a
  template source, and its edits are not inert there), **OQ-12**, and **OQ-14** (under its
  (b) or (c) the slice edits more lines of `review-decide.sh`). Without a consumer an
  `unreadable` PR is stranded, which is a liveness regression against today: class 2 currently
  reads `changes`, which remediation picks up and escalates to `needs-human-review` when its
  attempts are exhausted (`ai-review-guard.js:956-957`).
- **The witness slice (FR-2).** `machinery-witness.yml`, the guard channel,
  `ready-to-merge.yml`'s extra read, and `machinery-witness.test.ts`. Blocked on OQ-2, OQ-3,
  OQ-4, OQ-9 and OQ-15.
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
  non-quota reason would loop, here and, under OQ-3 (c), in every adopter repo that runs the
  scaffolded stack. Existing mitigation: the retry's reset-marker guard. An
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
  `dispatch-issue.sh`. The design edits every file below, and none appears in `implements:` or
  `affects:`. Each also has a row in the component table. An earlier version of this list named
  only the first two, so approving it would have forced a second post-approval edit, which is
  SPEC-051's trap again.
  - **Code.** `scripts/review-decide.sh` (owned by SPEC-031 — FR-4's per-voter call site), and
    `.github/scripts/ai-review-guard.js` (unowned by any spec — FR-2's witness channel, and
    FR-4's check arm, label and coherence set).
  - **Generated machinery.** `packages/minspec/src/lib/ci-review-templates.ts`, regenerated by
    every FR-2 and FR-4 PR under OQ-3 (b) or (c). It is itself in
    `MACHINERY_SINGLE_FILES` (`machinery-paths.ts:75-77`), where it is called the largest blast
    radius of anything in the set.
  - **Tests, FR-4.** Each needs new cases. Some also need changed expectations, wherever
    today's assertion *is* the collapse FR-4 removes:
    - `packages/minspec/tests/review-decide.test.ts` (AC-5 layer 1). For example, its
      no-verdict and garbage cases (`:44`, `:65`, `:256-257`) become `blocked`. Its
      second-block and prose-marker cases (`:129`, `:140`) become `unreadable`, and so does
      `:134`, a prose mention beside a real `changes` block. That case reads `unreadable`
      because the ambiguity guard cannot tell which block is the verdict
      (`review-decide.sh:117-126`).
    - `packages/minspec/tests/verdict-channel.test.ts`. `:163` and `:187` feed an empty block
      and become `blocked`; `:206` feeds two blocks and becomes `unreadable`.
    - `packages/minspec/tests/review-approvable.test.ts`. `:111` and `:134` become `blocked`.
    - `packages/minspec/tests/ai-review-verdict-combine.test.ts`, for AC-5 layer 2 and D12's
      precedence. No existing case feeds the new label.
    - `packages/minspec/tests/verdict-label-enforcement.test.ts`. Its A3 allowed set is
      `{PASS, CHANGES, BLOCKED} ∪ {pending}` (`:120-121`), so the first `ai-review:unreadable`
      literal in `ai-review.yml` or `review-decide.sh` fails it until the set admits
      `guard.UNREADABLE`.
    - `packages/minspec/tests/ai-review-verdict-label-coherence.test.ts`, for a backstop case
      covering the new literal fallback, beside `:321-329`.
    - `.github/scripts/ai-review-guard.test.js`, the guard's unit tests, run by `ci.yml:113`.
  - **Tests, FR-3.** `packages/minspec/tests/drain-selfheal.test.ts`. Its
    `MINSPEC_AUTOMERGE_NATIVE=1 forces ON` case (`:255-257`) runs against the real config, so it
    becomes config-dependent once seam 5 lands. Its hermetic no-key case (`:263-301`) then
    passes because its copy has no `profile.ts` and resolves `team`, not because of the
    `// false` default it names. Both need a `mode` fixture dimension, and the expected values
    depend on OQ-11.
  - **Conditional or human-authored.** `machinery-paths.ts`, only if OQ-9 is answered (a). Its
    test derives from the source (`machinery-paths.test.ts:40`), so it follows the edit.
    `ai-review-retry.yml` or `remediate-pr.sh`, only if OQ-12 is answered (b) or (c).
    `scripts/gen-ci-templates.mjs`, `ci-review-templates-gen.test.ts` and the template-freshness
    gate (`checkCiReviewTemplatesFresh`, `scripts/validate-frontmatter.ts:537`), only if OQ-3 is
    answered (a).
    `docs-lane.yml`, only if OQ-13 is answered (b).
    `.minspec/config.json`, edited by the config flip, which is a human act, but the ownership
    map is what a reader consults to find what this spec changed.

  An earlier draft also listed a new `scripts/lib/profile.sh`. D11 moves that reader into
  `dispatch-issue.sh`, which is declared, so the FR-3 slice no longer depends on this
  question. None of this blocks anything mechanically. `validateOwnership` checks presence and
  path validity, not completeness, and the spec-gate only blocks a file an *unapproved* spec
  declares. But it leaves SPEC-038's map wrong for the files the work actually touches.
  Fixing the declaration means editing hash-locked frontmatter, which stales the founder's
  sign-off: SPEC-051's trap, exactly.
  ➡️ Founder decision: re-approve after an `affects:` amendment covering the **whole** list
  above, or accept the widened set as a Plan-level record. This Plan does not edit
  `requirements.md`.

- **OQ-3 – FR-2 and FR-4 edit files MinSpec installs in adopter repos, and Out of Scope forbids
  any change to those. NOT decided; needs the founder via Clarify.**
  `scripts/gen-ci-templates.mjs`'s `SOURCES[]` embeds `ai-review.yml` (`:43`),
  `ready-to-merge.yml` (`:49`), `ai-review-retry.yml` (`:55`), `review-decide.sh` (`:73`) and
  `ai-review-guard.js` (`:161`) **verbatim** into `packages/minspec/src/lib/ci-review-templates.ts`.
  `CI_REVIEW_STACK_TEMPLATES` (`packages/minspec/src/lib/template-registry.ts:2111`) writes them
  into an adopter repo at `:2117`, `:2123`, `:2129`, `:2154` and `:2225`.
  `packages/minspec/tests/ci-review-templates-gen.test.ts` pins the regeneration byte-for-byte,
  so an FR-2 or FR-4 PR either reddens that test or changes what adopters receive. The
  requirements rule that out: "Any change to what MinSpec installs in an adopter's repo"
  (`requirements.md:359-360`). `ci-review-templates.ts` is also, by `machinery-paths.ts`'s own
  reckoning, the machinery with the largest blast radius in the repo, so the PR that regenerates
  it is the hardest PR here to merge. That is the exact block FR-2 exists to lift, met on the way
  to lifting it.
  **An earlier version of this question recommended a reading on a false premise.** It said the
  changes are inert in an adopter because "a repo with no `mode` key resolves to `team` and
  behaves byte-for-byte as today", and that adopters would get "an `ai-review:unreadable` label
  they never see". That holds for FR-2 and is false for FR-4. The false-red slice is independent
  of the profile (*Build order*), and nothing in it reads `mode`. What each edit actually does in
  an adopter repo, which has `.minspec/` but no `mode` key, and so resolves `team`:
  - **FR-2: the bytes move, the behaviour does not.** Nothing an adopter receives posts a
    `machinery-witness` check-run, because `machinery-witness.yml` is not in `SOURCES[]`. So the
    guard's third channel never verifies anything, and `decideStatus` is unchanged. The one way
    the new read could still change an outcome is an API error on it, and that is closed by
    giving the read its own `try` (component table, `ready-to-merge.yml` row).
  - **FR-4: the bytes and the behaviour both move.**
    - *Class 1* (no verdict block, not quota-shaped) is labelled `ai-review:blocked`, not
      `changes`. The scaffolded `ai-review-retry.yml` selects that label hourly (`:65`) and has
      no attempt cap (#1204). So a voter that persistently emits no block loops there, spending
      the adopter's quota. In an adopter with no remediation lane, the PR also loses the summon
      it gets today: `shouldSummonHumanReview` returns true for `changes` there
      (`ai-review-guard.js:990`), but returns false for `blocked` before that line is reached
      (`:976`). Its `ai-review` check-run becomes `action_required`, titled "AI review could
      not run — quota/transient (auto-retries)" (`:917`).
    - *Class 2* (`BEGIN_COUNT != 1`) is labelled `ai-review:unreadable`. The adopter's own
      `ai-review.yml` creates that label in their repo and posts an `action_required`
      `ai-review` check-run under the new title. What acts on it next is whatever OQ-12 decides,
      and that change ships too.
  - Every option of OQ-8, OQ-9 (a) and OQ-14 (b) or (c) also edits `ai-review.yml` or
    `review-decide.sh`, so each lands in the same place.
  **(a) Literal: no byte an adopter receives changes.** This repo's copies change, and the
  shipped templates stay at today's bytes. That means decoupling the generator for these
  sources: `scripts/gen-ci-templates.mjs`, its byte-for-byte pin test, and
  `checkCiReviewTemplatesFresh` (`scripts/validate-frontmatter.ts:537`). None of them is
  declared (OQ-2). Cost: this repo's review stack and the one it ships diverge, which is the
  drift class the generator exists to prevent (#678, the freshness gate). Adopters also keep
  both false-red classes.
  **(b) Behaviour frozen, bytes may move.** FR-2 lands as designed. FR-4 is keyed on the
  profile, so a `team` repo keeps today's labels. Cost: FR-4's decision then needs the profile
  inside the review stage, which is a second profile reader. It would sit either in
  `review-decide.sh`, whose own header says it must stay usable with nothing but bash
  (`review-decide.sh:32-35`), or in stage 1's workflow body, which comes from the PR head.
  Adopters keep the false reds as well.
  **(c) FR-2 and FR-4 are corrections to the shared review stack, not solo-only behaviour. They
  ship to adopters, and the Out of Scope line is amended at the next approved revision, which
  OQ-2 already needs – (rec).** Why: FR-4's MUST is not conditioned on `solo` in its text
  (`requirements.md:123-126`). The false reds it removes are defects in the shared stack:
  `review-decide.sh:165-168` records the class-2 contradiction on
  `AIClarityAU/voip-sms-inbox#28`, a repo running this stack. And a fork or a second profile
  reader each costs more than it saves. Its cost: adopter review behaviour changes, as listed
  above, by a founder amendment rather than by an adopter's opt-in. The sharpest part is the
  uncapped hourly retry of class 1 in someone else's repository. #1204's attempt cap would close
  it, but no FR asks for that cap and this Plan does not design it.
  ➡️ Founder decision, because it turns on how Out of Scope was meant. The witness slice and the
  false-red slice both wait for it.
  **Note:** the new `machinery-witness.yml` is *not* in `SOURCES[]`, so the new file itself
  ships nowhere. Only edits to the existing sources are affected.

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

- **OQ-5 – may the second unattended merge actor still merge a PR under `team`, and what is
  `scripts/auto-merge-gate.ts`'s `affects:` entry for? NOT decided; needs the founder via
  Clarify.** `scripts/dispatch-issue.sh` has two actors that can merge a green PR with no
  human (a third actor sits outside dispatch, in `docs-lane.yml`: OQ-13). Seam 5 gates the
  first, native `--auto` (`:1048-1089`). The second is SPEC-024's
  consequence-hybrid gate. `auto-merge-gate.ts` **is** invoked on that path (`:1859`, for every
  dispatched PR whose branch pushed). A direct `gh pr merge --squash` (`:1922`) follows when
  all of these hold (`:1915-1919`): the gate says eligible, a PR exists,
  `AUTOMERGE_MODE == consequence-hybrid`, `ready-to-merge == success`, and the autonomy verdict
  proceeds. That mode comes from `MINSPEC_AUTOMERGE_MODE` alone (`:1841-1846`) and never passes
  through `native_automerge_enabled`. So under a committed `mode: team`, an exported
  `MINSPEC_AUTOMERGE_MODE=consequence-hybrid` still merges a green, AI-passed PR with no human,
  given `autonomy: act`, a low-blast diff and a green `ready-to-merge`. That contradicts AC-4's
  "the same PR under `mode: team` holds for a human". It is also the shape this Plan removed
  `MINSPEC_MODE` for: an exported env var loosening a committed `team` policy. The HOLD reason
  on that path (`:1938`) even tells a reader to "opt in with
  MINSPEC_AUTOMERGE_MODE=consequence-hybrid". An earlier draft of this question said a `team`
  PR reaches the HOLD branch "without `auto-merge-gate.ts` ever being invoked", and called
  FR-3's second clause "fully answered" at seam 5. Both statements were wrong, and the
  founder was being asked to decide on that premise.
  **(a)** Gate the second actor on the profile, where its mode is resolved – **(rec)**.
  `AUTOMERGE_MODE` becomes `consequence-hybrid` only when `profile_mode` prints `solo` **and**
  the env is the exact token; under `team` it is `pr-gate`, whatever the env says. The
  resolution moves into a function with a pure seam beside `--check-native-automerge`: a
  `--check-automerge-mode` flag printing `consequence-hybrid` or `pr-gate`. Its T0 cases go in
  `profile.test.ts`: `team` + env `consequence-hybrid` → `pr-gate`; `solo` + env
  `consequence-hybrid` → `consequence-hybrid`; `solo` + env unset → `pr-gate`. The HOLD reason
  at `:1938` names the profile under `team`, where the env switch would be inert, instead of
  pointing at it. All of this is in `dispatch-issue.sh`, which is declared. `auto-merge-gate.ts`
  receives `--mode pr-gate`, and its `resolveMode` (`:78-80`) is untouched. It is the reading
  under which AC-4's `team` half holds as written. Its cost: SPEC-024's consequence-hybrid gate
  becomes `solo`-only. That changes another spec's feature under `team`, where it is today the
  only unattended merge path a team repo can opt into.
  **(b)** Leave the second actor env-driven under both profiles. Cost: AC-4's `team` half then
  holds only while the variable is unset, so a session's export decides what a committed
  `team` config means. That is the #183 failure mode FR-1 cites, turned the other way.
  Under both options, exporting the token under `solo` keeps today's meaning. It switches
  native off (`:81`) and hands the merge to the blast gate, so a high-blast green PR holds for
  a human. That is an env var *tightening* a committed `solo`. This Plan changes nothing there,
  but FR-3's MUST reads as unconditional, so whether it tolerates that is part of this question.
  Separately, and under either option, this design still finds no change **inside**
  `auto-merge-gate.ts`. Its `affects:` entry either anticipates one this Plan has not found, or
  it is an ownership mismatch of OQ-2's kind. The likeliest candidate is keeping
  `BOUNDARY_DIR_PREFIXES` (`:567`) in lock-step with the machinery set, which this design does
  not narrow.
  ➡️ Founder decision on (a) or (b), and confirm the `affects:` intent at the next approved
  revision (alongside OQ-2). The consequence-hybrid row of the component table stays
  undesigned until this is answered.

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
  of them. AC-7's suite asserts the `team` arm only, which is what AC-7 asks. It deliberately
  does not assert a `solo` arm: one asserting identical behaviour would decide this question
  in a T0 that lands, in the keep-list slice, before it is answered. An earlier draft did that.
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
  Either way, AC-7's `solo` arm is written with the answer: the same outcome as `team` under
  (a), off under (b).
  ➡️ Founder decision.

- **OQ-11 – under `solo`, is `autoMerge.native` still a second switch? NOT decided; needs the
  founder via Clarify.** FR-3 is titled "auto-merge is the default path, not an opt-in". It
  says that under `solo` a green PR carrying a provenance-verified `ai-review:pass` MUST merge
  without a human act. Today native auto-merge needs `MINSPEC_AUTOMERGE_NATIVE` or
  `autoMerge.native: true`, and defaults off (`dispatch-issue.sh:82-87`), which is an opt-in.
  An earlier draft of this Plan kept that second switch under `solo` without saying so, and
  pinned it with a T0 case (`mode: solo` + no key → `off`). That case is removed, and seam 5
  now adds only the `team` deny. The gap is latent in this repo, because its
  `.minspec/config.json` carries `autoMerge.native: true`.
  Every option keeps three things. The `team` deny runs before the env is read, so no env
  value can turn native on under `team`. The consequence-hybrid mutual exclusion stays
  (`:81`). And `MINSPEC_AUTOMERGE_NATIVE=0|false` remains a one-off off switch.
  **(a)** The profile is the switch. Under `solo` the function returns true without reading
  `autoMerge.native`. Cost: under `solo` no durable per-repo off switch remains, short of
  flipping to `team`, which also turns off FR-2's witness.
  **(b)** The profile sets the default, and the key can still opt out – **(rec)**. Under
  `solo` an absent key means on (`.autoMerge.native // true`), and only an explicit `false`
  turns it off. That makes auto-merge the default path while keeping a durable kill switch on
  the highest-consequence setting in the repo. Its cost: FR-3's MUST then holds only while
  nobody writes `autoMerge.native: false`, which reads "not an opt-in" as ruling out an opt-in
  but allowing an opt-out. And what an absent key means now depends on the profile, so
  `config.json` cannot be read without knowing `mode`.
  **(c)** Keep both switches, as the earlier draft did. Cost: under the plain reading of FR-3's
  title it is the opt-in FR-3 rules out, and it silently stops merging in any `solo` repo that
  lacks the key.
  Under every option, `autonomy: ask` still withholds the arm through `autonomy_may_merge`
  (`dispatch-issue.sh:1056`). FR-3 does not mention the autonomy axis, and whether that axis
  outranks FR-3's MUST under `solo` belongs with OQ-6.
  Until this is answered, seam 5 leaves the `solo` path exactly as it is today, which is
  option (c) in effect by inaction. So FR-3's first clause holds in this repo only because of
  the committed `autoMerge.native: true`. No test pins that interim state.
  ➡️ Founder decision. The `solo` arm of seam 5, AC-4's absent-key case, and the
  `drain-selfheal.test.ts` expectations (OQ-2) are written with the answer.

- **OQ-12 – what acts on an `ai-review:unreadable` PR? NOT decided; needs the founder via
  Clarify.** FR-4 requires the label to be distinct and never merged on. It says nothing about
  what happens next. With the FR-4 contract above and no further change, nothing does:
  - `ai-review-retry.yml` selects only `ai-review:blocked` (`:65`), which is D8's intent.
  - Remediation selects the `changes` label, or an `ai-review` check concluding `FAILURE` or
    `ERROR` (`remediate-pr.sh:124`, `:402-407`; the shepherd's copy is at
    `dispatch-issue.sh:1417-1425`). D12 makes this check `action_required`.
  - `shouldSummonHumanReview` returns false for this label on a non-machinery PR
    (`ai-review-guard.js:975-994`). A machinery PR is already summoned by its `isMachinery`
    arm (`:977`).

  So a non-machinery `unreadable` PR is stranded, the "routed to nobody" shape #816 guards
  against (`ai-review-guard.js:983-984`). That is also a liveness regression. Today class 2
  reads `changes`, which remediation picks up and escalates to `needs-human-review` when its
  attempts are exhausted.
  **(a)** Summon a human at once – **(rec)**. `shouldSummonHumanReview` returns true for
  `UNREADABLE`, beside its `BLOCKED` line, so the existing summon step applies
  `needs-human-review`. The outcome is deterministic in the diff (D8), so neither a retry nor
  a code change can move it. A human is genuinely the next actor, which is the one meaning
  #816 reserves the label for. Its cost: under `solo`, every class-2 event reaches the founder
  as `needs-human-review`. There is no automatic recovery even when the anomaly was a one-off;
  recovery is a manual re-run. The change is not keyed on `mode`, so under OQ-3 (c) it reaches
  every adopter repo as well.
  **(b)** One retry, then summon. `ai-review-retry.yml` also selects `unreadable`, capped at
  one attempt. Cost: it edits an undeclared workflow and needs the attempt cap #1204 tracks.
  It also spends one review per event on an outcome that D8 argues will usually recur.
  **(c)** Hand it to remediation, by having `remediate-pr.sh` select the label. Cost: an agent
  is asked to change code whose review passed. That burns quota and cannot fix the reviewer's
  output, and it edits an undeclared script.
  **(d)** No consumer. Cost: the stranding above.
  ➡️ Founder decision. The false-red slice does not ship until it is answered.

- **OQ-13 – docs-lane, a third unattended merge actor, merges under `team`, and AC-4 and AC-7
  disagree about whether it may. NOT decided; needs the founder via Clarify.**
  `.github/workflows/docs-lane.yml:247` runs `gh pr merge --auto --squash` on any docs-only PR
  whose labels include `docs-lane` (`:36`), under either profile. GitHub then merges it once the
  required checks are green, and those include a provenance-verified `ai-review:pass`. The label
  is not a human act: `scripts/push-docs.sh:157-158` applies it itself when an agent opens the PR.
  So under a committed `mode: team`, a green, AI-passed, non-machinery PR merges with no human.
  AC-4's plain wording says it must not: "the same PR under `mode: team` holds for a human"
  (`requirements.md:158-159`). FR-5 and AC-7 say the opposite for this lane. It MUST "remain
  reachable under `mode: team`" and "behave as [it does] today" (`requirements.md:132-134`,
  `:166-167`), and today it does exactly this.
  An earlier draft settled the tension without saying so. Its actor census named only
  dispatch's two actors, seam 5 claimed to deny native auto-merge "at its single source", and the
  AC-7 docs-lane row pins the arming as a T0. Together that reads AC-4 as covering dispatched
  PRs only, which is a decision the requirements do not make.
  **(a) AC-4 covers the PRs whose merge FR-3's actors decide (dispatch's native arm and the
  consequence-hybrid merge). Docs-lane is FR-5's retained machinery and keeps today's
  behaviour under `team` – (rec).** Why: it is the only reading under which AC-4 and AC-7 both
  hold as written. It also matches DR-076's disposition, which parks docs-lane behind the team
  profile (`DR-076.md:94`), and FR-5 reads parked as reachable under `team`. Its cost: under a
  committed `team`, "holds for a human" is false for the docs corpus. An agent's docs-only PR
  still merges unattended, and that includes content edits to specs and DRs short of a
  `status:` transition, which #1847 refuses (`docs-lane.yml:14-18`). AC-4's text also reads
  wider than what is built, until an approved revision narrows it.
  **(b) AC-4 covers every unattended merge actor, so docs-lane gains a `team` deny.** Cost: it
  contradicts FR-5 and AC-7 as approved, so the requirements need amending either way. It adds
  a profile reader to a `pull_request` workflow whose body comes from the PR head, which is
  D7's objection. `docs-lane.yml` is itself a template source (`gen-ci-templates.mjs:61`), so
  OQ-3 applies. And it switches the lane off in exactly the profile DR-076 parks it behind.
  The AC-7 docs-lane row asserts AC-7 as approved, so it lands unchanged under (a). Under (b),
  AC-7 and that row both change.
  ➡️ Founder decision. Until it is answered, AC-4's `team` half is discharged for dispatch's
  native actor only (see also OQ-5).

- **OQ-14 – how far does FR-4's "protocol-parsing anomaly" reach? NOT decided; needs the founder
  via Clarify.** FR-4's MUST covers "a fail-closed refusal caused by reviewer *unavailability* or
  by protocol-parsing anomaly" (`requirements.md:123-126`). Its Context (`:86-94`) and AC-5 name
  two classes, and the FR-4 contract above reroutes exactly those. `review-decide.sh` has three
  more fail-closed refusals that still print `ai-review:changes`, so they still read as "the
  reviewer wants changes":
  - a missing or non-integer `blocking:` inside the single block (`:208-210`);
  - a `verdict:` that is absent, or is neither `pass` nor `changes`, with `blocking: 0`. That
    reaches the final `changes` at `:217`, the same line a genuine `verdict: changes` reaches;
  - an `ESCALATE:` line (`:87-89`), the reviewer's explicit refusal to finish, which is checked
    before any block is read.
  An earlier draft kept the first two at `changes` as settled design ("FR-4 names two classes,
  and neither is this") and did not mention ESCALATE at all. That was a Plan narrowing a MUST
  without flagging it.
  **(a) Only the two observed classes.** This is what the contract reroutes today. Cost: two
  refusals that are plainly protocol-parsing anomalies on FR-4's text still wear `changes`, and
  under `solo` remediation then asks an agent to change code for a review that never objected.
  That is the collapse FR-4 exists to end.
  **(b) The field-level anomalies too, while ESCALATE stays `changes` – (rec).** A missing or
  non-integer `blocking:`, and an absent or unrecognised `verdict:`, leave `changes`. `:217`
  splits so that only a well-formed `verdict: changes`, or a positive `blocking:`, prints
  `changes`. Why: both are protocol-parsing anomalies on FR-4's plain text, while ESCALATE is a
  well-formed, deliberate refusal, not a parse failure. Its cost: ESCALATE still reads "the
  reviewer wants changes" when the reviewer said it could not finish, a residual false red that
  FR-4's rationale arguably covers. The label the field-level cases take then follows D8's
  retry-ability test, and the Plan designs it once this is answered. The candidate is
  `blocked`: this is class 1's failure one step later, and most likely transient model output
  rather than deterministic in the diff. That widens the uncapped-retry exposure (#1204, and
  OQ-3 for adopters).
  **(c) (b), plus ESCALATE.** Cost: ESCALATE fits neither existing refusal label. A retry by the
  same reviewer on the same diff will likely escalate again, looping in the uncapped lane, so
  `blocked` is wrong. The output was readable, so `unreadable` is wrong too. This option
  probably needs a fifth verdict label, with every stage of the FR-4 table repeated for it.
  Every option edits `review-decide.sh`, a template source (OQ-3), and `review-decide.test.ts`
  (OQ-2).
  ➡️ Founder decision. The false-red slice waits for it alongside OQ-3 and OQ-12, because
  under (b) or (c) it edits more lines of the same script.

- **OQ-15 – may the witness certify machinery outside `.github/**` and `scripts/**`? NOT
  decided; needs the founder via Clarify.** FR-2 names only those two (`requirements.md:109-111`).
  Condition 4 keys on `isMachineryPath`, whose set also holds `.githooks/` (the RCDD hook FR-6
  keeps), `.circleci/`, `.buildkite/`, `.husky/` and the two template generators
  (`machinery-paths.ts:52-78`). So an agent PR touching only `.githooks/commit-msg` or
  `ci-review-templates.ts` would be witnessed, and would merge with no human once the machinery
  arm slice lands. Today it needs `--admin`.
  **(a)** No: the witness posts nothing for a PR with any such path, which keeps today's
  `--admin` path – **(rec)**, because it certifies nothing FR-2 does not name. Its cost: a PR
  touching such a path beside a `.github/` or `scripts/` one stays on `--admin` too, which reads
  FR-2 narrower than its words. That includes any PR that regenerates `ci-review-templates.ts`,
  as every FR-2 and FR-4 PR does under OQ-3 (b) or (c).
  **(b)** Yes, the whole broad set, as drafted. Cost: the RCDD hook and the templates shipped to
  every adopter can change on AI signals alone.
  ➡️ Founder decision. The witness slice does not ship until it is answered.

- **OQ-16 – must AC-6's floor clause reach `applyFloor`'s call site? NOT decided; needs the
  founder via Clarify.** The floor row executes `classify` and `applyFloor`, not
  `classify.ts:86` (*What this suite still cannot catch*).
  **(a)** The floor row is enough, and the residual stays recorded – **(rec)**, because it adds
  no surface. Its cost: a `solo` branch at that call site that reads `mode` off `loadConfig`
  passes every test in this Plan.
  **(b)** Add a row that runs `classifyCommand(fixtureRoot)` with the real `loadConfig` and
  classifier. Cost: a new variant of `classify-command.test.ts`'s harness, which mocks both
  today, and the row belongs in the keep-list slice, before any profile reader exists.
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
