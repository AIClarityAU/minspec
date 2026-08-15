---
id: SPEC-054
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — DR-066's own domain (ai-review/ready-to-merge/bumblebee gate incidents)
aspects: [ci, gates, required-checks, silent-failure, provenance, tier-0, lint, constitution]
relates_to: [DR-066, DR-063, DR-005, DR-033, DR-055]
implements: [scripts/check-gate-signals.ts, scripts/audit-gate-witnesses.ts, scripts/lib/gate-manifest.ts, packages/minspec/tests/gate-signal-linter.test.ts]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# MinSpec — Enforcement linter for DR-066 "No silent gate" (Requirements)

> Materializes **[#895](https://github.com/AIClarityAU/minspec/issues/895)**, the enforcement-linter
> follow-up that [DR-066](../../../docs/decisions/DR-066.md) named at Accept: *"a prose invariant
> without a linter is a hope."* DR-066 is `accepted` (2026-07-22) and its rule is already in
> `.minspec/constitution.md` Invariants — this spec does **not** re-litigate the rule, it designs
> the deterministic check that gives it write-time teeth.

## One-Sentence Scope

Add a Tier-0, mostly-offline CI check that fails the build when a gate-signal write on a
load-bearing path swallows its error (constitution invariant #2 clause 1), and a separate,
network-using CI job that fails when a required branch-protection context has fewer than two
independent producers and no explicit fail-closed annotation (clause 3) — closing, by
construction, the exact failure class behind #560, #810, and #857. Clause 2 ("a missing or
errored witness fails the gate closed and visibly") is **not** covered: DQ-5 withdrew FR-4 from
this spec at Clarify, so this linter enforces two of the invariant's three clauses and must not
be read as enforcing the whole of it.

## Context

DR-066 was triggered by three incidents that each made a merge gate *look* present while
enforcing nothing:

- **#560** — `ready-to-merge`'s required context was pinned to the wrong GitHub App id; the
  ruleset waited on a check that could never post.
- **#810** (fixed by #854 / DR-063) — `ai-review.yml` posted the load-bearing `ai-review/pass`
  commit status **best-effort**; a missing `statuses: write` permission 403'd the POST, `|| true`
  swallowed it, and `ready-to-merge` (then single-witness) read `failure` on every genuinely
  passing PR.
- **#857** — the `bumblebee` supply-chain scan (DR-005) has been red on `main` for days; because
  it is **not** a required context, the red is invisible and non-blocking.

DR-066's Decision names the enforcement mechanism directly (its own text, not paraphrase):

> *"a CI/lint check that (a) flags `|| true` / swallowed errors on any line that posts a commit
> status, check-run, or gate label, and (b) asserts every **required** ruleset context is backed
> by ≥2 independent producers or an explicit fail-closed-and-visible annotation."*

That is clauses 1 and 3 of the constitution invariant. Clause 2 ("absence fails closed and
visible") was carried through Specify as a stretch goal (FR-4) and is **withdrawn** from this
spec at Clarify (DQ-5): it shipped with no acceptance criterion, and DR-066 itself does not
claim a static check can prove it in general. Its one named instance is already remediated –
`MinSpec SDD validation` is no longer a fake-green stub. `fix(#811)` (95a14e5, PR #933) made
`.github/workflows/minspec-validate.yml` run the highest-fidelity validator actually present
and `exit 1` when none is found, with the always-green branch called out by name in the step's
own comment (`minspec-validate.yml:27-49`). The *class* stays undetected, which is the accepted
cost of DQ-5 – see Decisions (settled at Clarify) and Out of Scope.

### The two clauses need two different runtimes, not one script

Clause 1 (`|| true` / swallowed errors on gate-signal writes) is answerable by **static analysis
of workflow YAML + `.github/scripts/` + `scripts/` source** — no network call, matching
constitution invariant #1 (core functionality works offline). The existing `check:cycles`
job (`ci.yml`) and `validate-frontmatter.ts` are precedent for this shape: a pure, offline, Tier-0
script wired into `npm run lint` or a sibling `npm run` script.

Clause 3 (required-context witness count) is **not** answerable offline: it needs the live
branch-protection ruleset from the GitHub API (`gh api repos/{owner}/{repo}/rulesets`),
exactly what `scripts/audit-ruleset-integration-ids.ts` already fetches for the #560 pin audit,
and what `packages/minspec/src/lib/ruleset-advisor.ts`'s `listRequiredCheckContexts`
(the async, `gh`-backed reader, `ruleset-advisor.ts:608-640`) already fetches and parses via the
pure helper `extractRequiredContexts` (`ruleset-advisor.ts:589-598`). Clarify settled that FR-3
reuses the **pure helpers only** — `extractRequiredContexts` for parsing *and*
`rulesetGuardsDefaultBranchChecks` (`:274`) for selecting which ruleset applies — and owns its
own `gh` call, because that reader collapses a read
failure into the same `null` as "no ruleset" — see DQ-6 and INV-4. This mirrors the existing
split: `npm run validate`/`npm run lint` stay network-free; the ruleset audit is its own
`gh api`-backed script, run as a distinct CI job (or reusing the audit script's existing
invocation point) — never folded into the offline gate.

### No existing "independent producer" manifest

Unlike clause 1 (greppable from source) and the ruleset-context list (already parsed by
`ruleset-advisor.ts`), there is **no existing data source** mapping *"required context X is
produced by workflow jobs Y and Z"* — that mapping does not exist anywhere in the repo today.
DR-063/#854 hand-built exactly one instance of this (the `ready-to-merge` gate reads either the
`ai-review/pass` status OR the `ai-review` check-run — `ready-to-merge.yml:270-306`), but nothing
generalises it. Building this mapping is the actual design work of clause 3 and was not small
enough to guess at Specify; Clarify settled its shape as a typed TypeScript module at
`scripts/lib/gate-manifest.ts` (DQ-1).

## Functional Requirements

- **FR-1 (clause 1 — static gate-signal write scan).** A new Tier-0 script statically scans
  workflow YAML (`.github/workflows/*.yml`) and any script it shells out to
  (`.github/scripts/**`, `scripts/**`) for lines that POST a commit status
  (`gh api .../statuses`, `createCommitStatus`), a check-run (`gh api .../check-runs`), or a
  gate-relevant label. **The label predicate MUST cover both write forms this repo actually
  uses.** An earlier draft named only the octokit form (`issues.addLabels`/`removeLabels`),
  which would have missed every real gate-label write here and — since this job ships as a
  required context (DQ-4) — shipped a silently under-enforcing linter inside the
  no-silent-gate linter. Verified against this worktree:
  - **gh CLI (the dominant form).** `gh pr edit … --add-label/--remove-label` and
    `gh issue edit … --add-label/--remove-label`. Every gate-label write in the workflows
    takes this form: `ai-review.yml:233-234`, `:973`, `:976`, `:978`, `:1054-1056`, and in
    the scripts tree `scripts/review-pr.sh:209-210`.
  - **octokit.** `issues.addLabels` (plural) and `issues.removeLabel` (**singular** — the
    plural `removeLabels` appears nowhere in this repo, so the earlier predicate's remove
    half matched nothing even for octokit). Real instances: `ready-to-merge.yml:387-392`
    and `:409-414` (`addLabels`), `:394-403`, `:417-426` and `:440-445` (`removeLabel`).

  A label write is **gate-relevant** when it names one of `ai-review:*`, `ready-to-merge`,
  `awaiting-approval`, `blocked-by`, or any label named in a required-check condition, on a PR
  or issue. **Left open for Plan (DQ-7):** `ai-review.yml:224-231`'s four
  `gh label create … 2>/dev/null || true` self-heal lines create label *objects* rather than
  apply gate labels, and need *either* a narrower predicate (add/remove only, never create)
  *or* four FR-2 annotations. DQ-7 named both as acceptable and chose neither.

  Such a write is a **finding** when its failure is either **unobserved** or **unsurfaced** –
  DQ-7 settled the bar as *observed AND surfaced*, and FR-1's earlier "`2>/dev/null` on that
  same statement" trigger is superseded by it:
  - **Unobserved** — the statement's exit status cannot reach any branch *and* cannot fail the
    step: `|| true` (and its variants), a non-zero exit in a step whose shell does not carry
    `-e`, a bare `.catch(() => {})` or otherwise swallowed promise in a `github-script` step.
    Note a bare command in an ordinary `run:` step is **observed**, because Actions' default
    shell supplies `-e` — see FR-6's corollary for why the scanner must not decide this from
    the step's `set` line.
  - **Unsurfaced** — the exit status *is* tested, but the failure branch neither emits a
    visible signal (a `::warning`/`::error` workflow command, `core.warning`/`core.setFailed`,
    a `$GITHUB_STEP_SUMMARY` append) nor fails the step.

  A stream redirect on the statement (`>/dev/null`, `2>/dev/null`, `>/dev/null 2>&1`) is **not**
  on its own a finding. The repo's post-#854 house shape redirects *and* tests *and* warns –
  `if ! gh api … >/dev/null 2>&1; then echo "::warning …"; fi` at
  `.github/workflows/ai-review.yml:964-969` (the `ai-review/pass` commit status), and the same
  test-and-warn wrapper — over a stdout-only redirect — at `:810-812` (the `ai-review`
  check-run) and `:878-880` (`machinery-review-required`). A redirect whose exit status is *dropped* is a finding under
  "unobserved", which is exactly the pre-#854 `gh api … || true` shape. Each match is a finding
  unless the flagged write carries the FR-2 allow-annotation **on the line immediately above
  it** — one placement rule, stated identically here and in FR-2 (an earlier draft said "the
  line (or the enclosing block)", which is a second, looser rule the scanner cannot honour
  simultaneously).
- **FR-2 (explicit allow-annotation for legitimate best-effort writes).** A line-granular inline
  comment `# gate-signal-allow: <reason>` on the line immediately above the flagged write
  exempts that single write from FR-1 (DQ-2 settled) — for genuinely non-load-bearing
  side-effects (an audit comment, a cosmetic label) named in DR-066's Decision as legitimate.
  Step-level and file-level waivers were rejected as too coarse: `ai-review.yml`'s verdict step
  holds the load-bearing status post (`:964-969`) and the deliberately tolerate-absence label
  cleanups (`:976`, `:978`) inside one step. Two properties are mandatory, both copied from the
  repo's shipped sibling scanner `scripts/check-gh-bot-attribution.sh`: the annotation MUST
  carry a reason string, so an exemption is self-documenting and greppable for future audit and
  a bare annotation is itself a finding (`check-gh-bot-attribution.sh:53` — "the allowlist is
  the escape hatch, and every entry carries a reason"); and the scanner MUST print,
  unconditionally on every run, a summary of every waiver it honoured (`:216-219` — "Always
  print what was waived. A silently-skipped file reads as 'covered'").
- **FR-3 (clause 3 — required-context witness count).** A second script (network/`gh`-backed,
  run as its own CI job, not part of `npm run lint`) reads the repo's branch-protection ruleset
  `required_status_checks` contexts and, for each required context, asserts either (a) ≥2
  independent producers per the FR-5 manifest, or (b) an explicit `fail-closed-and-visible`
  annotation on its sole producer. A context satisfying neither fails the CI job. Three points
  are settled, not open:
  - **"Independent" means mechanism diversity** (DQ-3): two producers count as independent when
    they use different signal mechanisms (commit status / check-run / label), even from one
    workflow file under one App token. That is the bar DR-063 shipped and the axis #810 failed
    on — `statuses: write` and `checks: write` are separate GitHub App permission scopes, and
    the #810 post-mortem names the missing one at `.github/workflows/ai-review.yml:936-944`.
    Credential/App diversity is a stronger future bar, not this spec's.
  - **Read the ruleset through the pure parser, with the checker's own `gh` call** (DQ-6). FR-3
    MUST NOT delegate the read to `listRequiredCheckContexts`, which collapses read failure into
    the same `null` as "no ruleset"; it owns its own `gh api` invocation with explicit
    exit-code handling and distinguishes read/parse failure (fail the job, loudly) from a
    ruleset that genuinely requires zero contexts (also a finding, different message). See
    INV-4 for the mechanism and the line-level evidence.
  - **Ships as a REQUIRED branch-protection context from day one** (DQ-4, option (a')), with its
    PR sequenced to land with or after the #811 remediation. That precondition is already
    satisfied: `fix(#811)` landed as 95a14e5 (PR #933).
- **FR-4 — WITHDRAWN at Clarify (DQ-5); clause 2 is not in this spec.** The "absence fails
  closed and visible" static check is split to its own follow-up issue and is **out of scope
  here**. It carried zero acceptance criteria (AC-1–AC-4 cover FR-1/FR-2, AC-5/AC-6 cover FR-3,
  AC-7 and AC-10 cover FR-6, AC-8 covers FR-7, AC-9 is informational), and a spec whose whole subject is
  checks that look present while enforcing nothing must not itself carry an untestable
  requirement. The number is retained as a tombstone so FR-5–FR-7 and the AC cross-references
  keep their identities. **Follow-up issue: not yet filed** (this Clarify pass was allowlisted
  to this file only) — record its number here and in Traceability on filing.
- **FR-5 (producer manifest — the new data this spec introduces).** A small, hand-maintained,
  version-controlled **typed TypeScript module at `scripts/lib/gate-manifest.ts`** (DQ-1
  settled — already the path this spec's `implements:` frontmatter names) lists each
  required-check context and its producer(s): which workflow + job (+ optionally which step)
  posts it, by what mechanism (status / check-run / label), and — per DQ-3 — the **permission
  scope** that write needs plus the **posting App identity**, so the independence bar can be
  tightened later without a manifest format change. `scripts/lib/` already holds typed TS
  helpers for exactly this class of dev-time check (`scripts/lib/dr-id-collision.ts`,
  `scripts/lib/spec-id-collision.ts`), and the `scripts/ → packages/` import direction is
  already precedented (`scripts/audit-ruleset-integration-ids.ts:29-35` imports
  `extractRequiredCheckPins` from `packages/minspec/src/lib/ruleset-integration-audit.ts:62`),
  never the reverse. FR-3 is a query over this manifest; it is the single source of truth the
  clause-3 check reads, so a new gate is wired into the linter by adding one manifest entry,
  not by teaching the linter new YAML-parsing heuristics per gate.
- **FR-6 (CI wiring, fail the build, and join the ruleset).** FR-1 runs as (or alongside) the
  existing `lint` job in `ci.yml`, offline, on every push/PR. FR-3 runs as its own job, using
  the repo's own `gh` auth already available to workflow jobs. Both jobs join `main`'s ruleset
  as **required** contexts on ship — not advisory-first (DQ-4 settled). Either job's failure
  fails the PR/build, per constitution invariant #2 applied **reflexively to this spec's own
  two jobs**: their signal must itself fail closed and visibly. (That is the invariant
  *governing* the new gates, not a claim that this spec *detects* clause-2 violations
  elsewhere — it does not; DQ-5 withdrew that detector and the One-Sentence Scope and Out of
  Scope say so.) Two consequences of "required on ship" are normative here, not optional:
  - **Ruleset membership is an act this FR requires, and it is asserted.** Adding both
    contexts to `main`'s ruleset is part of shipping FR-6, executed through the existing
    `ruleset-advisor.ts` tooling. AC-10 binds the resulting state so the DQ-4 decision is
    testable rather than merely asserted in prose; Out of Scope excludes only *other* ruleset
    changes, not this one.
  - **Day-one annotation precondition (from FR-1's label predicate + DQ-4).** Making the FR-1
    job required means every pre-existing gate-signal write that fails the observed-and-
    surfaced bar reds `main` the moment it lands. Verified against this worktree, that set includes:
    `ai-review.yml:233-234` (`--remove-label "ai-review:pass"` / `--add-label
    "ai-review:pending"`, both `2>/dev/null || true`), `:976` and `:978` (verdict-label
    cleanups, same shape), `:1055-1056` (the fail-closed step's two `|| true` removals), and
    `scripts/review-pr.sh:209` (`|| true` explicitly defeating that file's `set -euo pipefail`
    at `:21`). Each is deliberately tolerate-absence (rationale in the comment at
    `ai-review.yml:201-205`), so each MUST carry an FR-2 allow-annotation **in the same PR that
    makes the job required**. Annotating after the requirement lands is the sequencing that reds
    every merge. Treat this list as verified-not-exhaustive: the implementing PR takes the
    scanner's own output as authoritative, since the gate-label writes in `ready-to-merge.yml`
    pass the bar today (`:394-403`/`:417-426` rethrow a non-404 via `isBenignRemovalError`;
    `:387-392`/`:409-414` are caught and surfaced by `core.warning` at `:428-430`) and a later
    edit could change that.

    **Corollary for FR-1's "unobserved" test in shell steps — do not read `set` lines alone.**
    A `run:` step inherits `-e` from the Actions default shell, and an inner `set -uo pipefail`
    does **not** clear it — the repo says so in its own comment at `ai-review.yml:451-453`
    (*"this step inherits `-e` from the Actions default shell (`set -uo pipefail` does not
    clear it)"*). So a bare, un-suffixed gate-label write in such a step **is** observed:
    `ai-review.yml:1054` (`--add-label "ai-review:changes"`, in a step whose only `set` is
    `-uo pipefail` at `:1048`) and `:973` are compliant, not findings. A scanner that decided
    "unobserved" from the step's visible `set` line would false-positive on both. The exit-status
    model must be: inherited `-e` unless an explicit `shell:` override removes it, then `|| true`
    / `|| :` / a trailing `; true` / an untested command substitution as the ways it is defeated.
- **FR-7 (Tier-0 scope discipline).** FR-1/FR-2/FR-5's static scanner and manifest ship under
  `scripts/` (Tier-0 dev-time tooling per this repo's Agent Dispatch section), import no
  `vscode`, and make no network call; FR-3's ruleset-reading script is explicitly the one
  exception (already precedented by `audit-ruleset-integration-ids.ts`) and MUST be a separate
  entry point, never silently invoked from the offline path.

## Acceptance Criteria

- **AC-1 (FR-1, true positive).** A fixture workflow step that posts a commit status via
  `gh api … || true` is flagged as a finding; the script's process exit is non-zero.
- **AC-2 (FR-1, the observed/surfaced boundary — both directions).** Two fixtures, each posting a
  commit status with its exit status checked: the one whose failure branch emits a visible signal
  (`::warning`) produces **zero** findings for that line; the one whose failure branch is empty
  (or writes only to a suppressed stream) and does not fail the step **is** a finding. Exit-code
  observation alone is not sufficient under the settled DQ-7 bar — otherwise the swallow simply
  moves inside the `if`-block.
- **AC-3 (FR-2).** The same `|| true` fixture, once carrying a valid allow-annotation with a
  reason, produces zero findings; the annotation's presence and reason text are both asserted
  (a bare annotation with no reason is itself a finding). The run's output is asserted to
  contain the honoured waiver in its always-printed waiver summary (DQ-2's compensating
  control) — a waiver that is honoured silently fails this AC.
- **AC-4 (regression — the exact #810 shape, and its post-#854 fix).** A fixture reproducing
  `ai-review.yml`'s pre-#854 `gh api … statuses … || true` line (no allow-annotation) is
  flagged: its exit status is dropped, so it is "unobserved" under FR-1. Run against the
  **actual current** `.github/workflows/ai-review.yml`, the scanner MUST emit **zero** findings
  for the post-#854 status post at `:964-969` —
  `if ! gh api "repos/$REPO/statuses/$PR_HEAD_SHA" -f state=… -f context="ai-review/pass" … >/dev/null 2>&1; then echo "::warning title=ai-review/pass status not posted::…"; fi`
  — whose exit status is tested by `if !` and whose failure branch emits an actionable
  `::warning`, i.e. observed AND surfaced, notwithstanding that it redirects both streams. The
  same zero-findings result MUST hold for the two check-run posts at `:810-812` and
  `:878-880`, which share the `if ! … ; then echo "::warning …"; fi` wrapper but redirect
  **stdout only** (`>/dev/null`, where the status post adds `2>&1`) — a difference that does
  not affect satisfiability, because FR-1's carve-out treats all three redirect forms alike
  and keys the verdict on observation and surfacing. Together this proves the checker does not false-positive on the
  already-fixed instances while it would have caught the original. (Before DQ-7 this AC was
  unsatisfiable: FR-1's literal `2>/dev/null` trigger flagged the very line AC-4 requires to be
  clean. DQ-7 records the contradiction and the resolution.)
- **AC-5 (FR-3, missing second witness).** A fixture ruleset requiring a context with exactly
  one manifest producer and no fail-closed annotation fails the job.
- **AC-6 (FR-3, satisfied under the settled mechanism-diversity bar).** The required context
  under test is **`ready-to-merge`** — the one gate DR-063/#854 actually gave two independent
  witnesses. Evaluated against a manifest entry recording those two witnesses — the
  `ai-review/pass` commit status (`ai-review.yml:964-969`) and the `ai-review` check-run
  (`ai-review.yml:810-812`, body computed by the tested pure `decideReviewCheck` at `:792-804`)
  — `ready-to-merge` passes, because the two differ in mechanism (DQ-3). `ready-to-merge`
  combines exactly these two for the head SHA (`ready-to-merge.yml:271-274` statuses,
  `:280-286` check-runs, `:287-292` verifier calling `verifyHeadPassWitness`, declared at
  `.github/scripts/ai-review-guard.js:410` under the comment at `:401-409`: *"The gate needs
  ONE proof that THIS head SHA was the reviewed one. Two independent channels can carry it"*),
  then posts the authoritative `ready-to-merge` commit status itself
  (`ready-to-merge.yml:321-328`, with the fail-closed post at `:155-162`). That is the shipped
  instance FR-5's manifest must express as data.

  **Three context strings, deliberately distinct — the manifest and this AC must not conflate
  them**, because doing so is how a two-witness claim gets attached to a single-witness gate:
  - **`ai-review/pass`** — a *commit status* context, `ai-review-guard.js:36`.
  - **`ai-review`** — a *check-run name*, `ai-review-guard.js:42` (bound to the verifier as
    `PASS_CHECK_NAME` at `:340` so producer and verifier can never drift, #822). It is *also*
    the name of one of `main`'s six required contexts.
  - **`ready-to-merge`** — the commit-status context posted by `ready-to-merge.yml`, and the
    required context this AC is about.

  The reason this AC names `ready-to-merge` rather than `ai-review`: the required context
  `ai-review` has exactly **one** producer (the check-run posted at `ai-review.yml:810-812`), so
  under FR-3 it is an AC-5-shaped case, not an AC-6-shaped one, and the implementing PR must
  resolve it via option (b) — an explicit fail-closed-and-visible annotation — or by giving it a
  second witness. (I read `ai-review`'s single-producer status off `CHECK_NAME` and the sole
  `check-runs` POST; it is not asserted by any code, and AC-10's read of the live ruleset is what
  would confirm the context name is required at all.)
- **AC-7 (FR-6, wired — the jobs run).** `npm run lint` (or the equivalent `ci.yml` job) exits
  non-zero when FR-1 has a finding; the PR this spec's implementation ships in demonstrates the
  new job(s) actually running in `ci.yml`, not merely present as an unwired script. This AC
  covers *running*; **AC-10 covers *required*** — running is not the same claim, and asserting
  only the first is how a job ships in #857's shape (present, green-or-red, and non-blocking).
- **AC-8 (FR-7, offline boundary).** The FR-1/FR-2 script makes zero network calls (asserted by
  running it with network access removed/mocked, or by static import audit showing no `gh api`/
  `fetch`/`octokit` call on that path); the FR-3 script is the sole exception and is invoked
  from a distinct npm script / CI step, never from `npm run lint`.
- **AC-9 (single-witness reality check — informational, not blocking this spec).** Running FR-3
  against this repo's actual current ruleset is expected to surface at least one single-producer
  required context: `MinSpec SDD validation` has exactly one producer, the `validate` job in
  `.github/workflows/minspec-validate.yml:14-16`. A finding existing on first run is evidence
  the checker is reading real data, not a fixture. The framing has changed since Specify —
  #811's *fake-green* defect is fixed (95a14e5 / PR #933; the job now fails closed,
  `minspec-validate.yml:27-49`), so what remains for that context is a clause-3 single-witness
  question, not a clause-2 stub. Under FR-3 it can pass only via option (b), an explicit
  fail-closed-and-visible annotation on its sole producer; I read its post-#933 shape as able to
  carry that honestly, but that is my inference from `:27-49`, not something the code asserts.
- **AC-10 (FR-6 / DQ-4 — the jobs are REQUIRED contexts, asserted against the live ruleset).**
  DQ-4's core is that both new jobs ship as required branch-protection contexts, not
  advisory-first. That state is asserted two ways, because a settled decision with no test is
  the "looks present, enforces nothing" shape this whole spec exists to close:
  - **Self-membership, continuously.** The FR-3 checker, which already reads `main`'s
    `required_status_checks` contexts to do its clause-3 work, additionally asserts that its
    **own** context name and the FR-1 job's context name are both present in that list, and
    fails the job (loudly, with the observed list printed) when either is absent. This is the
    cheapest available enforcement of INV-1: it runs on every PR, needs no new data source, and
    catches a later ruleset edit that quietly demotes either job. It also makes the ordering
    explicit — on the very first run, before the ruleset mutation lands, this assertion fails,
    which is the correct signal, not a bug.
  - **Ship-time evidence, once.** The implementing PR records the post-mutation required-context
    list read from the live ruleset (the same read `scripts/audit-ruleset-integration-ids.ts`
    already performs), showing both new contexts alongside the six recorded at
    `docs/decisions/DR-047.md:47` / `docs/decisions/DR-057.md:28-29`. The recorded six are a DR's
    prose snapshot, not a live read, so this AC is satisfied by the API response, not by those
    DRs.

  A self-assertion has a known limit and it is accepted, not overlooked: the checker can only
  assert its own membership while it is *running*, so removing the job from `ci.yml` entirely
  defeats it. Nothing short of an out-of-band watcher closes that, and this spec does not build
  one — the ship-time evidence bullet plus a required `ready-to-merge` are what stand behind it.

## Invariants

- **INV-1 (no silent gate, applied reflexively — constitution #2).** The new linter's own
  failure must itself be visible and required, never best-effort — it cannot ship as a
  `continue-on-error` or non-required job, or it recreates the exact defect class it exists to
  close (#857's shape). DQ-4 settles this concretely: both jobs are required contexts on ship,
  not advisory-first.
- **INV-2 (offline core — constitution #1).** FR-1/FR-2/FR-5 make no network call; only the
  explicitly-separate FR-3 job does, and it uses the repo's own already-authorized `gh`
  session (no new credential, no call to a service outside GitHub's API for this repo).
- **INV-3 (blast radius — constitution #3).** Everything this spec adds — under `scripts/` and
  `.github/workflows/ci.yml`, plus its two required contexts on `main`'s ruleset — is scoped to
  *this* repo; it changes no behavior in a repo, org, or
  machine-wide config that did not opt in (no global git hook, no user-level config).
- **INV-4 (one source of truth per gate, not a second drifting matcher — and not a silent one).**
  FR-3 MUST parse required contexts with `ruleset-advisor.ts`'s existing **pure** helper
  `extractRequiredContexts` (`ruleset-advisor.ts:589-598`), not a new, independent YAML/JSON
  parse of the ruleset — the same drift lesson as SPEC-051's INV-5 (two checks of the same rule
  must not disagree). It MUST NOT use `listRequiredCheckContexts` (`ruleset-advisor.ts:608-640`)
  as its reader (DQ-6). That function collapses three distinct outcomes into one `null` — `gh`
  exiting non-zero (`:614`), `JSON.parse` throwing or yielding a non-array (`:620-622`, `:618`),
  and no matching branch ruleset found (`:639`) — and says so in its own doc comment (`:605-606`:
  "`null` on any read/parse failure ⇒ the caller treats it as 'none' and offers to create"). That
  collapse is correct for its caller `init.ts`, which offers to *create* a ruleset; for a gate it
  means a missing token, a revoked permission or a GitHub outage reads as *zero required
  contexts*, hence zero assertions, hence green — a silent gate inside the no-silent-gate linter,
  and load-bearing the moment DQ-4 makes the job required. So the FR-3 checker owns its own `gh`
  invocation with explicit exit-code handling and fails closed **and loudly** on a read failure,
  in the shape `ready-to-merge.yml:297-306` already uses (catch → `core.warning` +
  `verified: false` carrying an explicit reason, never "unreadable = absent").

  **What "not a second parse" actually covers — parsing is not the whole of the read.**
  `listRequiredCheckContexts` does three separable things, and a checker that owns its own
  `gh` call inherits all three, not just the last: it (1) fetches, (2) **selects** which of the
  repo's rulesets is the one that guards the default branch's checks, then (3) extracts the
  contexts. Only (3) is `extractRequiredContexts`. Selection is the loop at
  `ruleset-advisor.ts:623-638`, which skips `target !== 'branch'` (`:624`), skips
  `enforcement === 'disabled'` (`:625`), skips a non-numeric `id` (`:626`), GETs each candidate
  ruleset's detail (`:627`), and then applies the predicate `rulesetGuardsDefaultBranchChecks`
  (declared `ruleset-advisor.ts:274`) — which itself
  encodes the non-obvious rule that a ruleset counts when its `conditions.ref_name.include`
  holds `~DEFAULT_BRANCH`, `~ALL`, or any `refs/heads/*`, **and** it carries a
  `required_status_checks` rule (`:278-290`). Re-deriving that by hand is exactly the drifting
  second matcher this INV forbids, so it MUST be reused, not re-implemented.

  So the mechanical note for Plan is **three** exports, not two — `extractRequiredContexts`
  (`:589`), its parameter type `RulesetFull` (`:574`), and `rulesetGuardsDefaultBranchChecks`
  (`:274`), none exported today, all three required by INV-4 (or re-homed into a shared pure
  module). The predicate takes `unknown`, so it needs no shape export alongside it.
  `runSafe` (`:159`) is deliberately **not** on that list:
  the fetch-and-exit-code half is precisely what DQ-6 hands to the checker to own, because
  `runSafe`'s callers here collapse failure into `null`. Note the checker must also handle two
  silent-collapse points this loop contains that the doc comment does not name: a per-ruleset
  detail GET failing (`:628`) and its `JSON.parse` throwing (`:630-634`) both `continue`, so a
  single unreadable ruleset silently reduces to "not the guarding one". Under DQ-4 that must
  fail the job with an explicit reason, never fall through to `null`/green.

## Decisions (settled at Clarify)

All seven were put to the human as options with a named recommendation, the cost of that
recommendation, and a reversibility read; **every recommendation was accepted as written**. The
costs are recorded verbatim in substance because the accepted price is the part a future reader
needs most — a decision without its cost reads as free.

**DQ-6 and DQ-7 were not in the original list.** They surfaced during Clarify, from grounding the
spec's own claims against the code rather than reading the spec's prose — which is itself the
signal about how incomplete the Specify-phase list was. DQ-7 is not merely a missing fork: it
reports a live self-contradiction between FR-1 and AC-4 that Plan could not have built to.

Line references below were re-verified against this worktree. Two citations carried into Clarify
were wrong and are corrected in place, flagged where the correction matters.

- **DQ-1 — Producer-manifest format and location. SETTLED: (c), a typed TypeScript module at
  `scripts/lib/gate-manifest.ts`** — over a JSON/YAML config file, inline per-workflow comments,
  or the same module placed in `packages/minspec/src/lib/`.
  *Why:* `scripts/lib/` already holds typed TS helpers for exactly this class of dev-time check
  (`scripts/lib/dr-id-collision.ts`, `scripts/lib/spec-id-collision.ts`), so this adds a file to
  an established home rather than inventing a convention, and the dependency direction is
  already precedented one way: `scripts/audit-ruleset-integration-ids.ts:29-35` imports
  `extractRequiredCheckPins` from `packages/minspec/src/lib/ruleset-integration-audit.ts:62`,
  never the reverse. DQ-1's own recommendation argued for (c) partly because the manifest would
  be "reusable by `ruleset-advisor.ts` consumers" — phrasing that quietly implies placement
  *inside the shipped extension* and directly conflicts with FR-7 ("ship under `scripts/`") and
  INV-3. The comparator it cited, `DEFAULT_REQUIRED_CHECK_CONTEXTS` (`ruleset-advisor.ts:80`,
  value `['MinSpec SDD validation']`), is a shipped-product constant describing what MinSpec
  proposes to *any user's* repo; the gate manifest describes MinSpecPro's *own* CI, which is
  repo-specific data with no business inside the `.vsix`.
  *Accepted cost:* the manifest is then unreachable from extension code, so if MinSpec ever
  wants to ship dual-witness advice to users as a product feature it needs a second home or a
  move. And a TS module is less machine-writable than JSON: a future "add a gate entry" tool
  would need codegen rather than a JSON write. *Reversible easily.*

- **DQ-2 — Allow-annotation syntax (FR-2). SETTLED: a line-granular inline comment
  `# gate-signal-allow: <reason>`, plus the two properties the existing sibling scanner proves
  matter — a mandatory reason string, and an always-printed summary of every waiver honoured on
  that run.**
  *Why:* DQ-2 asserted "no existing convention in this repo" and rejected a central allowlist
  outright; both claims needed qualifying. The repo has a close analogue already shipped and
  wired into CI: `scripts/check-gh-bot-attribution.sh` (248 lines, run as `npm run check:gh-bot`
  in `ci.yml`'s `lint` job at `ci.yml:68-69`) statically scans workflows and scripts for a policy
  violation and exempts via a central `allowlist_reason()` function (`:74`, consulted at `:143`
  and `:173`), with a mandatory reason (`:53`) and an unconditional waiver printout (`:216-219`).
  So the house precedent is central-with-reasons, not inline. What defeats copying it is
  granularity, not principle: its allowlist is keyed by *file path*, and `ai-review.yml` holds
  both kinds of write inside a single step — deliberately best-effort gate-label writes at
  `:233-234` (rationale in the comment at `:201-205`: "removing the stale pass is load-bearing,
  but a transient label-API hiccup here must not red the run") and at `:976`/`:978`, alongside
  the load-bearing status post at `:964-969`. A file-keyed waiver would silently exempt the
  repo's most important workflow wholesale. Hence inline for granularity, inheriting the two
  properties that make the central form trustworthy. *(Citation correction: Clarify cited
  `ci.yml:58-59` for the `check:gh-bot` wiring; that range is the ai-review-guard comment block.
  The step is `ci.yml:68-69`.)*
  *Accepted cost:* inline annotations are edited by whoever touches the line, so there is no
  single file in which to review every exemption — auditing them becomes a grep rather than
  opening one list, which is exactly the drift risk R2 names. The always-print-waivers summary
  is the compensating control and it must actually be built: FR-2 as written required the reason
  but *not* the printout, so accepting this recommendation added a requirement (now in FR-2,
  asserted by AC-3). *Reversible only at cost.*

- **DQ-3 — What "independent" means for FR-3's two-witness check. SETTLED: mechanism diversity
  is the pass bar — and the FR-5 manifest records each producer's permission scope and posting
  App identity now, so the bar can be tightened later without a manifest format change.**
  *Why:* the spec read DR-063's precedent correctly and it verifies: `ready-to-merge` reads
  commit statuses (`ready-to-merge.yml:271-274`) and check-runs (`:280-286`) for the same head
  SHA and combines them through one verifier (`:287-292`), both produced by `ai-review.yml` under
  the same App token. More importantly, mechanism diversity is not merely what we happened to
  ship: it maps onto the real failure axis of #810, a missing `statuses: write` permission on the
  App installation (post-mortem comment at `ai-review.yml:936-944`). `statuses: write` and
  `checks: write` are separate GitHub App permission scopes, so a mechanism-diverse pair is
  genuinely permission-scope-diverse against that class. Credential diversity is strictly
  stronger, but nothing in the repo satisfies it today — including `ready-to-merge`, the gate
  AC-6 requires to pass, so choosing it would have meant rewriting AC-6 too. (`ready-to-merge`
  is the subject there, not `ai-review`: its two witnesses are the `ai-review/pass` commit
  status and the `ai-review` check-run — different strings, declared at
  `.github/scripts/ai-review-guard.js:36` and `:42` — and both are *inputs* `ready-to-merge`
  reads, never producers of the required context `ai-review`. See AC-6.)
  *Accepted cost:* mechanism diversity does not cover #560's class — a required context pinned
  to the wrong GitHub App id. Both witnesses there come from the same App, so a bad pin kills
  both simultaneously and FR-3 would still report the gate as satisfied. That is the *first*
  incident in DR-066's own list, and this decision leaves it to
  `scripts/audit-ruleset-integration-ids.ts` rather than closing it here. *Reversible easily.*

- **DQ-4 — Required from day one, or advisory-first? SETTLED: (a') required immediately, with
  FR-3's PR sequenced to land with or after the #811 remediation.**
  *Why:* the spec's argument for (a) holds — an advisory rollout of a "no silent gate" gate is a
  soft instance of the class it polices, INV-1 forbids shipping it as `continue-on-error` or
  non-required, and solo mode (DR-075/DR-076) explicitly keeps model-defending gates while
  cutting only human-coordination ceremony, so an advisory check is model-trusted by
  construction. The repo also demonstrates option (b)'s cost empirically: `ci.yml:228-229`'s
  `security` / "Supply-chain scan (bumblebee)" job is precisely #857's shape — present, and not
  among the six required contexts `main` carries (`lint, test, MinSpec SDD validation,
  ai-review, ready-to-merge, build`, as recorded at `docs/decisions/DR-047.md:47` and
  `docs/decisions/DR-057.md:28-29`), therefore invisibly red. What DQ-4 omitted is a cost on the
  (a) side: FR-3 is network-dependent, so as a required context it reds every merge during a
  GitHub API hiccup, and per constitution invariant #2 it may not `|| true` its way out of that.
  Sequencing behind #811 keeps day-one red confined to genuine faults, which is the difference
  between a gate people trust and one they learn to bypass. *(Citation correction: Clarify cited
  `ci.yml:218-219` for the bumblebee job; it is at `:228-229`. And the "non-required" claim rests
  on those two DRs' recorded context list — the live ruleset was not read from this worktree.)*
  *Accepted cost:* it couples this spec's ship date to #811, which the spec's own Out of Scope
  section explicitly disclaims — so this decision re-adds a dependency the spec deliberately
  shed. And a required network-dependent check means a GitHub API outage blocks all merges with
  no sanctioned escape, since `--admin` is human-only under the house rule. *Reversible only at
  cost.*
  *Precondition status:* the #811 half is already satisfied — `fix(#811): make MinSpec SDD
  validation gate fail-closed (DR-066)` landed as 95a14e5 (PR #933); `minspec-validate.yml:27-49`
  now runs the highest-fidelity validator present and `exit 1`s when none is found.
  *A second precondition, propagated here after the fact (not a change to this decision):*
  "required on ship" also means the FR-1 job reds `main` on day one for every pre-existing
  gate-label write that fails the observed-and-surfaced bar. FR-6 enumerates that set
  (`ai-review.yml:233-234`, `:976`, `:978`, `:1055-1056`, `scripts/review-pr.sh:209`) and makes
  their FR-2 annotations a same-PR requirement. DQ-4 sequenced this spec behind #811 but said
  nothing about that set, because DQ-7 had not yet widened the write predicate to the `gh pr
  edit --add-label/--remove-label` form these lines actually use.
  *Now also propagated to:* AC-10, which asserts the required-context state DQ-4 settled — the
  decision previously lived only in FR-6/INV-1 prose with no acceptance criterion behind it.

- **DQ-5 — Is FR-4 (absence-fails-visible) part of this spec at all? SETTLED: (b), split it to a
  follow-up issue. FR-4 is withdrawn here.**
  *Why:* this was the one DQ that was Plan-phase detail wearing a Clarify costume, and its own
  text said so — FR-4 read "Plan decides, not this spec" and DQ-5's recommendation was "scope
  FR-4 at Plan", an instruction to Plan rather than a fork for a human. The genuinely
  human-shaped question underneath is binary in-or-out, and there is a concrete reason to answer
  "out": FR-4 had **zero acceptance criteria**. AC-1 through AC-4 cover FR-1/FR-2, AC-5 and AC-6
  cover FR-3, AC-7 covers FR-6, AC-8 covers FR-7, and AC-9 is explicitly informational — nothing
  tested FR-4. *(AC-10 was added after this decision, propagating DQ-4's required-context
  consequence; it too covers FR-6, so the count against FR-4 is unchanged. Its addition applies
  DQ-5's own "an FR with no AC is not testable" argument consistently — DQ-4's settled state had
  been asserted only in FR-6/INV-1 prose.)* An FR with no AC either is not shipping or is not testable, and in a spec whose
  entire subject is checks that look present while enforcing nothing, carrying an untestable FR
  is thematically the wrong thing to do. Splitting it also lets FR-4 be scoped against a manifest
  that exists rather than one that was still a DQ-1 fork.
  *Accepted cost:* constitution invariant #2's clause 2 (absence fails closed and visible) then
  has **no automated detector** after this spec ships, so #811's fake-green-stub class stays
  model-trusted (that *instance* is remediated by #933; the *class* is caught by nothing). The
  spec will also read to a casual reader as enforcing the whole invariant when it enforces two of
  three clauses — the follow-up issue and the Out of Scope section have to carry that caveat
  loudly, which is why it is now also stated in the One-Sentence Scope and on the FR-4 tombstone.
  *Reversible easily.*
  *Open action:* the follow-up issue is **not yet filed** — this Clarify pass was allowlisted to
  this file only. Record its number on the FR-4 tombstone and in Traceability when it is filed.

- **DQ-6 (surfaced during Clarify — absent from the original list; found by grounding INV-4
  against the code) — When FR-3 cannot read the ruleset at all, does its job fail closed, and how
  does it tell that apart from "ruleset read fine, it happens to require nothing"? SETTLED: (b),
  export the pure `extractRequiredContexts` helper and give the FR-3 checker its own `gh`
  invocation with explicit exit-code handling.**
  *Why:* INV-4 mandated reading required contexts through `ruleset-advisor.ts` rather than a new
  parse, which is right — but the function it named collapses three outcomes into one value.
  `listRequiredCheckContexts` returns `null` when `gh api` exits non-zero
  (`ruleset-advisor.ts:614`), when `JSON.parse` throws or yields a non-array (`:620-622`, `:618`),
  and when no matching branch ruleset is found (`:639`); its own doc comment states the intent
  plainly at `:605-606` — "`null` on any read/parse failure ⇒ the caller treats it as 'none' and
  offers to create". That collapse is correct for its current caller, `init.ts`, whose job is to
  offer to create a ruleset. For a gate it is precisely constitution invariant #2's failure mode:
  a missing token, a revoked permission or a GitHub outage yields `null`, which reads as zero
  required contexts, which means zero assertions to make, which exits green. That is a silent
  gate inside the silent-gate linter, and it becomes load-bearing the moment DQ-4 makes the job
  required. The repo already has the correct shape to copy: `ready-to-merge.yml:297-306` catches
  a failed witness read and sets `verified: false` with an explicit reason rather than treating
  unreadable as absent. Mechanical note for Plan either way: `extractRequiredContexts` (`:589`)
  is not exported today, and neither is its parameter type `RulesetFull` (`:574`), so INV-4
  already required a small export change regardless of which option was picked. *(That note was
  under-counted at Clarify, and INV-4 now carries the corrected version: parsing is only step
  three of the read. A checker owning its own `gh` call must also reproduce ruleset **selection**
  — the loop at `ruleset-advisor.ts:623-638` and its predicate `rulesetGuardsDefaultBranchChecks`
  (`:274`), not exported either. So it is three exports, not two. This corrects the note, not
  the decision: (b) is still the settled option, and the
  correction makes its cost bigger, not smaller.)*
  *Accepted cost:* exporting internals of a shipped extension module to serve a dev-time script
  widens `ruleset-advisor.ts`'s public surface for a non-product consumer. And the checker then
  owns its own `gh` invocation, which is one more place the call shape (endpoint, pagination,
  ruleset selection) can drift from the extension's — a smaller version of the very drift INV-4
  exists to prevent (now carried as R6). *Reversible only at cost.*
  *Propagated to:* INV-4 (rewritten) and FR-3.

- **DQ-7 (surfaced during Clarify — absent from the original list; it reports a live
  self-contradiction in this spec) — Does FR-1 treat a gate-signal write as acceptable when its
  exit code is merely checked, or only when the failure is also surfaced visibly? SETTLED: (b),
  observed AND surfaced.**
  *Why:* FR-1 and AC-4 contradicted each other against the real file, and Plan could not have
  built to both. FR-1 listed "`2>/dev/null` on that same statement" as a swallow trigger; AC-4
  required zero findings against the current `ai-review.yml` status post. That post is
  `if ! gh api "repos/$REPO/statuses/$PR_HEAD_SHA" … >/dev/null 2>&1; then echo "::warning …"; fi`
  at `ai-review.yml:964-969` — it redirects both streams and does not fail the step, so under
  FR-1's literal text it was a finding, while AC-4 said it must not be. Option (b) resolves the
  contradiction on the correct axis: what changed in #854 was not that stderr was preserved, it
  was that the failure became *visible* (the `::warning`) and that a second witness existed. (b)
  still flags the pre-#854 `gh api … || true` shape that AC-4 needs as a true positive, and it
  matches the repo's post-#854 house shape uniformly — the same `if ! … ; then echo "::warning …"`
  wrapper guards the `ai-review` check-run at `:810-812` and `machinery-review-required` at
  `:878-880`. It also makes the day-one annotation burden concrete rather than hypothetical: a
  matcher keyed on "line names an `ai-review:*` label and swallows" hits `ai-review.yml:224-231`'s
  four `gh label create … 2>/dev/null || true` self-heal lines, which create label *objects*
  rather than apply gate labels — R1's false-positive risk, made concrete. Those need either a
  narrower predicate (add/remove only, never create) or FR-2 annotations. *(Citation correction:
  Clarify cited the status post as `ai-review.yml:957-962`; that range is the `PASS_DESC` branch
  immediately above it. The post itself is `:964-969`.)*
  *Accepted cost:* "surfaced" is a fuzzier predicate than "exit code checked". The scanner has to
  recognise an open set of surfacing forms — `::warning`, `::error`, `core.warning`,
  `core.setFailed`, a step-summary append — so it needs its own internal allowlist of accepted
  surfacing patterns, and it will false-negative the first time someone surfaces a failure in a
  novel way. That is a second escape hatch to maintain alongside FR-2's (now carried as R5).
  *Reversible only at cost.*
  *Propagated to:* FR-1 and AC-4, both edited so they agree under the settled reading. The
  add/remove-vs-create fork this record leaves open **stays open** — FR-1 and R1 carry it as a
  Plan-phase choice. Separately, FR-1's write-form list was widened to the `gh pr edit
  --add-label/--remove-label` CLI shape those four lines share with the repo's real gate-label
  writes, without which the settled bar would have been enforced against a form this repo does
  not use.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Static `\|\| true` scan false-positives on legitimate non-gate uses elsewhere in the same workflow file — concretely, `ai-review.yml:224-231`'s four `gh label create … 2>/dev/null \|\| true` self-heal lines, which name `ai-review:*` labels but create label *objects* rather than apply a gate label (DQ-7 surfaced this as a real, not hypothetical, hit). | FR-1 scopes matches to lines that both post a gate signal AND fail the observed-and-surfaced bar — not every `\|\| true` in the file; AC-2 asserts both directions of that bar. **Disposition left open for Plan (DQ-7):** either a narrower predicate excluding label-*object* creation (`gh label create` / `issues.createLabel`), or four FR-2 annotations — DQ-7 named both and chose neither. FR-6 carries the day-one annotation set the widened write-form list makes due. |
| R2 | FR-2's allow-annotation becomes a rubber-stamp escape hatch, reopening exactly what DR-066 closes. | Reason string required (AC-3); annotation is inline and greppable, so a future audit (or a follow-up "audit all allow-annotations" check) can review every exemption at once. DQ-2 adds the compensating control the sibling scanner proves matters: every waiver honoured is printed unconditionally on every run (`check-gh-bot-attribution.sh:216-219`), so a waiver can never be honoured silently. |
| R3 | FR-3's manifest drifts from the real workflows (a producer renamed/removed, manifest not updated) and the check passes on stale data. | Out of this spec's guaranteed scope; flagged as residual risk for Plan — a manifest-freshness check (e.g. does every named job/step still exist) is a natural FR-8 candidate if Plan has room. |
| R4 | Making FR-3 required immediately blocks unrelated PRs — on pre-existing debt, or on a GitHub API hiccup, since the job is network-dependent and may not `\|\| true` its way out. | **Decided, not open:** DQ-4 settled (a'), required from day one with the PR sequenced with or after the #811 fix — which has already landed (95a14e5 / PR #933), so the pre-existing-debt half is discharged. The API-outage half is the accepted cost, with no sanctioned escape (`--admin` is human-only). |
| R5 | DQ-7's "surfaced" predicate is fuzzy: the scanner needs its own internal allowlist of accepted surfacing forms (`::warning`, `::error`, `core.warning`, `core.setFailed`, step-summary append) and will false-negative on a novel one. | Accepted cost of DQ-7. The allowlist is a second escape hatch alongside FR-2's and must be kept as short and as reviewable — extending it is a code change in the linter, visible in review, not an inline annotation. |
| R6 | FR-3 owning its own `gh` invocation (DQ-6) lets the call shape — endpoint, pagination, ruleset selection — drift from `ruleset-advisor.ts`'s, a smaller version of the drift INV-4 exists to prevent. | Accepted cost of DQ-6, at the strength recorded there: endpoint, pagination **and ruleset selection** can all drift. INV-4 bounds only the reusable pure halves (`extractRequiredContexts`; the predicate `rulesetGuardsDefaultBranchChecks`, `ruleset-advisor.ts:274`) — the selection *loop* around that predicate (`:623-638`) sits inside `listRequiredCheckContexts`, which INV-4 forbids reusing, so the checker re-implements it. |

## Out of Scope

- **Constitution invariant #2's clause 2 — "a missing or errored witness fails the gate closed
  and visibly" — in any form.** FR-4 is withdrawn (DQ-5); clause 2 gets **no automated detector**
  from this spec, and after it ships that class remains model-trusted. State this loudly wherever
  the spec is summarised: **this linter enforces two of the invariant's three clauses.** The
  split-out work is a follow-up issue (not yet filed at the time of this Clarify pass). Note the
  one *named instance*, #811's fake-green `MinSpec SDD validation` stub, is already remediated
  (95a14e5 / PR #933, `minspec-validate.yml:27-49`) — the instance, not the class.
- **Fixing #857 itself, or any remaining named debt.** This spec builds the *checker* that flags
  them; the remediation of each named debt item is its own issue/PR (already filed, per DR-066's
  Follow-ups).
- **A general prover that every CI workflow's failure paths propagate correctly.** This was
  FR-4's ceiling and remains out of scope for its follow-up: whatever ships there is bounded by
  what the FR-5 manifest can express structurally, not exhaustive control-flow analysis of
  arbitrary Actions YAML.
- **Changing the branch-protection ruleset *beyond* adding this spec's two contexts.** Adding
  them is **in** scope and required: DQ-4 settled that both jobs join `main`'s ruleset as
  required contexts on ship, FR-6 makes that mutation an Implement act (through the existing
  `ruleset-advisor.ts` tooling), and AC-10 asserts the resulting state. An earlier draft of this
  bullet excluded "adding/removing required contexts" outright, which read directly against
  FR-6 — the exclusion was never meant to cover the one mutation the spec's own decision
  requires. What stays out: touching any *other* required context, removing existing ones,
  changing bypass actors, or any broader ruleset redesign.
- **Non-GitHub-Actions CI** — this repo has one CI system; no abstraction over a hypothetical
  second one.

## Traceability

- **Issue:** [#895](https://github.com/AIClarityAU/minspec/issues/895) — enforcement linter for
  DR-066, filed on Accept per DR-066's own Follow-ups section.
- **Decision:** [DR-066](../../../docs/decisions/DR-066.md) — "No silent gate" (accepted
  2026-07-22); this spec implements its Decision paragraph's named enforcement mechanism and
  constitution Invariant #2's clauses 1 and 3. **Clause 2 is not implemented here** — FR-4 was
  withdrawn at Clarify (DQ-5) and becomes a follow-up issue, **not yet filed**; record its number
  here and on the FR-4 tombstone when it is.
- **Precedent this generalises:** [DR-063](../../../docs/decisions/DR-063.md) / #854 — the one
  hand-built dual-witness instance (`ready-to-merge.yml:270-306`: statuses at `:271-274`,
  check-runs at `:280-286`, combined at `:287-292`, fail-closed catch at `:297-306`) that FR-3's
  manifest must be able to express as data, not bespoke code, for the *next* gate.
- **Existing tooling reused:** `packages/minspec/src/lib/ruleset-advisor.ts` — specifically the
  pure `extractRequiredContexts` (`:589-598`) **and** the pure selection predicate
  `rulesetGuardsDefaultBranchChecks` (`:274-291`), both to be exported per DQ-6/INV-4 along with
  `extractRequiredContexts`'s parameter type `RulesetFull` (`:574`); and, for context on
  the product-side default, `DEFAULT_REQUIRED_CHECK_CONTEXTS` (`:80`). `listRequiredCheckContexts`
  (`:608-640`) is deliberately **not** reused as FR-3's reader (INV-4 / DQ-6) — only its two pure
  halves are, never its fetch-and-collapse wrapper.
  `scripts/audit-ruleset-integration-ids.ts` is the precedent for a `gh`-backed, non-offline
  audit script as a separate entry point from `npm run lint`, and for the `scripts/ → packages/`
  import direction.
- **Known debt this will surface (not fix):** #857 (bumblebee scan silently red and non-required
  — the job exists at `ci.yml:228-229` and is absent from the six required contexts recorded in
  `DR-047.md:47` / `DR-057.md:28-29`); `MinSpec SDD validation` as a single-witness required
  context (AC-9). #811's fake-green stub is **no longer** live debt: fixed by 95a14e5 / PR #933.
- **Instances the class already produced:** #560 (wrong App id pin), #810 / fixed #854
  (best-effort status swallow).
