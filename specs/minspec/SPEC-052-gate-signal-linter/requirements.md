---
id: SPEC-052
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — DR-066's own domain (ai-review/ready-to-merge/bumblebee gate incidents)
aspects: [ci, gates, required-checks, silent-failure, provenance, tier-0, lint, constitution]
relates_to: [DR-066, DR-063, DR-005, DR-033, DR-055]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
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
construction, the exact failure class behind #560, #810, and #857.

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
visible") is named in the issue as a stretch goal — DR-066 flags it as real debt (#811, the
`MinSpec SDD validation` required check is a fake-green stub) but does not claim a static check
can prove it in general; this spec scopes clause 2 accordingly (see FR-4 and Decisions needed).

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
(the async, `gh`-backed reader, `ruleset-advisor.ts:608`) already fetches and parses via the
pure helper `extractRequiredContexts` (`ruleset-advisor.ts:588-598`). This mirrors the existing split: `npm run validate`/`npm run lint` stay network-free;
the ruleset audit is its own `gh api`-backed script, run as a distinct CI job (or reusing the
audit script's existing invocation point) — never folded into the offline gate.

### No existing "independent producer" manifest

Unlike clause 1 (greppable from source) and the ruleset-context list (already parsed by
`ruleset-advisor.ts`), there is **no existing data source** mapping *"required context X is
produced by workflow jobs Y and Z"* — that mapping does not exist anywhere in the repo today.
DR-063/#854 hand-built exactly one instance of this (the `ready-to-merge` gate reads either the
`ai-review/pass` status OR the `ai-review` check-run — `ready-to-merge.yml:271-304`), but nothing
generalises it. Building this mapping is the actual design work of clause 3 and is not small
enough to guess at Specify — see DQ-1.

## Functional Requirements

- **FR-1 (clause 1 — static gate-signal write scan).** A new Tier-0 script statically scans
  workflow YAML (`.github/workflows/*.yml`) and any script it shells out to
  (`.github/scripts/**`, `scripts/**`) for lines that POST a commit status
  (`gh api .../statuses`, `createCommitStatus`), a check-run (`gh api .../check-runs`), or a
  gate-relevant label (`issues.addLabels`/`removeLabels` naming `ai-review:*`,
  `ready-to-merge`, `awaiting-approval`, or any label named in a required-check condition) AND
  are followed by, or wrapped in, an error-swallowing pattern (`|| true`, `2>/dev/null` on that
  same statement, an unchecked non-zero exit in a shell step, a bare `.catch(() => {})` /
  swallowed promise in a `github-script` step). Each match is a finding unless the line (or the
  enclosing block) carries the FR-2 allow-annotation.
- **FR-2 (explicit allow-annotation for legitimate best-effort writes).** A single, greppable
  annotation (exact syntax is a Clarify decision, DQ-2) exempts a specific write from FR-1 —
  for genuinely non-load-bearing side-effects (an audit comment, a cosmetic label) named in
  DR-066's Decision as legitimate. The annotation MUST require a reason string, so an exemption
  is self-documenting and greppable for future audit, not a bare escape hatch.
- **FR-3 (clause 3 — required-context witness count).** A second script (network/`gh`-backed,
  run as its own CI job, not part of `npm run lint`) reads the repo's branch-protection ruleset
  `required_status_checks` contexts (reusing `listRequiredCheckContexts` /
  `extractRequiredContexts` in `ruleset-advisor.ts`) and, for each required context, asserts either (a) ≥2
  independent producers per the FR-5 manifest, or (b) an explicit `fail-closed-and-visible`
  annotation on its sole producer (DQ-3 decides the annotation's exact form and what "independent"
  requires). A context satisfying neither fails the CI job.
- **FR-4 (clause 2 stretch — absence-fails-visible, best-effort scope).** Where FR-5's manifest
  records a producer's *failure path* (its non-success branch), statically assert that path posts
  a red/failing signal rather than silently returning success/exit 0. This clause is scoped to
  what the manifest can express structurally; it is not a general prover of "does this workflow
  correctly propagate every failure" (see Out of Scope). Ship FR-1–FR-3 and FR-5 first; FR-4 may
  ship in the same PR or a fast-follow — Plan decides, not this spec.
- **FR-5 (producer manifest — the new data this spec introduces).** A small, hand-maintained,
  version-controlled manifest (format is DQ-1) lists each required-check context and its
  producer(s): which workflow + job (+ optionally which step) posts it, and by what mechanism
  (status / check-run / label). FR-3 and FR-4 are both queries over this manifest; it is the
  single source of truth clause 3/4 checks read, so a new gate is wired into the linter by
  adding one manifest entry, not by teaching the linter new YAML-parsing heuristics per gate.
- **FR-6 (CI wiring, fail the build).** FR-1 runs as (or alongside) the existing `lint` job in
  `ci.yml`, offline, on every push/PR. FR-3 (and FR-4, if shipped together) runs as its own job,
  using the repo's own `gh` auth already available to workflow jobs; both jobs are **required**
  contexts themselves once wired (Clarify confirms whether they join `main`'s ruleset at Plan
  or ship advisory-first — see DQ-4). Either job's failure fails the PR/build, per constitution
  invariant #2 clause 2 applied reflexively to the linter's own signal.
- **FR-7 (Tier-0 scope discipline).** FR-1/FR-2/FR-5's static scanner and manifest ship under
  `scripts/` (Tier-0 dev-time tooling per this repo's Agent Dispatch section), import no
  `vscode`, and make no network call; FR-3/FR-4's ruleset-reading script is explicitly the one
  exception (already precedented by `audit-ruleset-integration-ids.ts`) and MUST be a separate
  entry point, never silently invoked from the offline path.

## Acceptance Criteria

- **AC-1 (FR-1, true positive).** A fixture workflow step that posts a commit status via
  `gh api … || true` is flagged as a finding; the script's process exit is non-zero.
- **AC-2 (FR-1, true negative).** A fixture workflow step that posts a commit status with its
  exit code checked (no swallow) produces zero findings for that line.
- **AC-3 (FR-2).** The same `|| true` fixture, once carrying a valid allow-annotation with a
  reason, produces zero findings; the annotation's presence and reason text are both asserted
  (a bare annotation with no reason is itself a finding).
- **AC-4 (regression — the exact #810 shape).** A fixture reproducing `ai-review.yml`'s
  pre-#854 `gh api … statuses … || true` line (no allow-annotation) is flagged; run against
  the actual current `ai-review.yml` (post-#854, which already surfaces the failure via
  `::warning` + the dual-witness fallback per `ready-to-merge.yml:271-304`) the scanner MUST
  emit **zero** findings for that specific line — proving the checker doesn't false-positive on
  the already-fixed instance while it would have caught the original.
- **AC-5 (FR-3, missing second witness).** A fixture ruleset requiring a context with exactly
  one manifest producer and no fail-closed annotation fails the job.
- **AC-6 (FR-3, satisfied).** `ready-to-merge`'s real required context, evaluated against a
  manifest entry recording its two DR-063 witnesses (`ai-review/pass` status OR `ai-review`
  check-run), passes.
- **AC-7 (FR-6, wired and required).** `npm run lint` (or the equivalent `ci.yml` job) exits
  non-zero when FR-1 has a finding; the PR this spec's implementation ships in demonstrates the
  new job(s) actually running in `ci.yml`, not merely present as an unwired script.
- **AC-8 (FR-7, offline boundary).** The FR-1/FR-2 script makes zero network calls (asserted by
  running it with network access removed/mocked, or by static import audit showing no `gh api`/
  `fetch`/`octokit` call on that path); the FR-3 script is the sole exception and is invoked
  from a distinct npm script / CI step, never from `npm run lint`.
- **AC-9 (#811 debt, informational not blocking this spec).** Running FR-3 against this repo's
  actual current ruleset MAY surface `MinSpec SDD validation` (#811's known stub) as a
  single-witness finding; this spec does not require #811 to be fixed first, but the finding
  existing on first run is evidence the checker is looking at the real data, not a fixture.

## Invariants

- **INV-1 (no silent gate, applied reflexively — constitution #2).** The new linter's own
  failure must itself be visible and required, never best-effort — it cannot ship as a
  `continue-on-error` or non-required job, or it recreates the exact defect class it exists to
  close (#857's shape).
- **INV-2 (offline core — constitution #1).** FR-1/FR-2/FR-5 make no network call; only the
  explicitly-separate FR-3/FR-4 job does, and it uses the repo's own already-authorized `gh`
  session (no new credential, no call to a service outside GitHub's API for this repo).
- **INV-3 (blast radius — constitution #3).** Everything this spec adds lives under `scripts/`
  and `.github/workflows/ci.yml` of *this* repo; it changes no behavior in a repo, org, or
  machine-wide config that did not opt in (no global git hook, no user-level config).
- **INV-4 (one source of truth per gate, not a second drifting matcher).** FR-3/FR-4 MUST read
  required contexts via the existing `ruleset-advisor.ts` parsing (`listRequiredCheckContexts`
  / the pure `extractRequiredContexts` helper already at `ruleset-advisor.ts:588-598`), not a new,
  independent YAML/JSON parse of the ruleset — the same drift lesson as SPEC-051's INV-5 (two
  checks of the same rule must not disagree).

## Decisions needed (Clarify)

These are genuine forks a human must pick before Plan; guessing them here would encode an
irreversible manifest/annotation format nobody has agreed to.

- **DQ-1 — Producer-manifest format and location.** Options: (a) a new JSON/YAML file
  (e.g. `.minspec/gate-manifest.json` — but note `.minspec/` is normally MinSpec's own SDD
  state, not CI config, so this may want a `scripts/`-owned location instead, e.g.
  `scripts/lib/gate-manifest.json`); (b) inline structured comments in each workflow file next
  to the write they document (keeps the mapping next to the code but harder to query
  centrally); (c) a small TypeScript module (like `ruleset-advisor.ts`'s
  `DEFAULT_REQUIRED_CHECK_CONTEXTS`) exporting a typed producer table. *Recommendation to
  confirm:* (c) — typed, importable by both the FR-3 checker and (per INV-4) reusable by
  `ruleset-advisor.ts` consumers, and consistent with how `DEFAULT_REQUIRED_CHECK_CONTEXTS`
  already models "the required context list" as code, not a config file.
- **DQ-2 — Allow-annotation syntax (FR-2).** No existing convention in this repo (checked: no
  `eslint-disable`-style marker for gate exemptions exists today). Options: a YAML step-level
  `# gate-signal-allow: <reason>` comment immediately above the flagged line; a step-level
  `env: GATE_SIGNAL_ALLOW: "<reason>"`; or a central allowlist (rejected — defeats the
  "self-documenting at the point of use" goal). *Recommendation to confirm:* inline comment
  form, scanned by line proximity (same pattern the scanner already needs for `|| true`
  detection).
- **DQ-3 — What counts as "independent" for FR-3's ≥2-witness check.** Two jobs in the *same*
  workflow file sharing one `GITHUB_TOKEN`/App installation arguably share a single point of
  failure (an App permission gap breaks both) — is that "independent" for this check, or must
  the two producers differ in credential/App/trigger to count? DR-063's actual fix (status OR
  check-run, both from `ai-review.yml`) suggests the DR's bar is *mechanism* diversity
  (status vs. check-run), not *credential* diversity — but this spec should not assume that
  silently. *Recommendation to confirm:* mechanism-diversity bar (matches the shipped DR-063
  precedent), with credential-diversity flagged as a stronger future bar, not this spec's.
- **DQ-4 — Ship the new CI job(s) as required from day one, or advisory-first?** Making FR-3
  required immediately means this repo's *own* ruleset gets a chance to fail on #811 debt
  before it's fixed (AC-9). Options: (a) required immediately, accept #811 blocks until fixed
  (forces the debt to be paid, consistent with "no silent gate" not tolerating known debt
  quietly); (b) advisory (non-required) for one cycle, required after #811 lands. *Recommendation
  to confirm:* (a) — DR-066 explicitly lists #811 as debt this linter should surface, and an
  advisory-first rollout of a "no silent gate" gate would itself be a soft form of the class it
  polices.
- **DQ-5 — Where does FR-4 (absence-fails-visible) actually get judged feasible?** It's a
  "stretch" in the issue for a reason — proving a workflow's failure branch posts red in general
  is not a small static-analysis problem. Plan needs to scope FR-4 concretely (which shapes of
  failure path count, e.g. "step has no `if: failure()` handler that swallows" vs. exhaustive
  control-flow analysis) or explicitly split it to a follow-up issue. *Recommendation to
  confirm:* scope FR-4 at Plan to exactly what the FR-5 manifest can express (a producer's
  documented failure step exists and is not itself best-effort) — decline general workflow
  control-flow proof.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Static `|| true` scan false-positives on legitimate non-gate uses elsewhere in the same workflow file. | FR-1 scopes matches to lines that both post a gate signal AND swallow — not every `|| true` in the file; AC-2 asserts the negative case. |
| R2 | FR-2's allow-annotation becomes a rubber-stamp escape hatch, reopening exactly what DR-066 closes. | Reason string required (AC-3); annotation is inline and greppable, so a future audit (or a follow-up "audit all allow-annotations" check) can review every exemption at once. |
| R3 | FR-3's manifest drifts from the real workflows (a producer renamed/removed, manifest not updated) and the check passes on stale data. | Out of this spec's guaranteed scope; flagged as residual risk for Plan — a manifest-freshness check (e.g. does every named job/step still exist) is a natural FR-8 candidate if Plan has room. |
| R4 | Making FR-3 required immediately (DQ-4 option a) blocks unrelated PRs on pre-existing #811 debt the moment this ships. | Named explicitly in DQ-4 for the human to accept or reject; not decided silently. |

## Out of Scope

- **Fixing #811 or #857 themselves.** This spec builds the *checker* that flags them; the
  remediation of each named debt item is its own issue/PR (already filed, per DR-066's
  Follow-ups).
- **A general prover that every CI workflow's failure paths propagate correctly.** FR-4 is
  scoped to what the FR-5 manifest can express structurally, not exhaustive control-flow
  analysis of arbitrary Actions YAML.
- **Changing the branch-protection ruleset itself** (adding/removing required contexts, adding
  the new linter jobs to it) — DQ-4 raises whether/when this happens, but the ruleset mutation
  is a Plan/Implement act via the existing `ruleset-advisor.ts` tooling, not this spec's FRs.
- **Non-GitHub-Actions CI** — this repo has one CI system; no abstraction over a hypothetical
  second one.

## Traceability

- **Issue:** [#895](https://github.com/AIClarityAU/minspec/issues/895) — enforcement linter for
  DR-066, filed on Accept per DR-066's own Follow-ups section.
- **Decision:** [DR-066](../../../docs/decisions/DR-066.md) — "No silent gate" (accepted
  2026-07-22); this spec implements its Decision paragraph's named enforcement mechanism and
  constitution Invariant #2's clauses 1 and 3 (clause 2 partially, per FR-4's scoped stretch).
- **Precedent this generalises:** [DR-063](../../../docs/decisions/DR-063.md) / #854 — the one
  hand-built dual-witness instance (`ready-to-merge.yml:271-304`) that FR-3's manifest must be
  able to express as data, not bespoke code, for the *next* gate.
- **Existing tooling reused:** `packages/minspec/src/lib/ruleset-advisor.ts`
  (`listRequiredCheckContexts`, `extractRequiredContexts`, `DEFAULT_REQUIRED_CHECK_CONTEXTS`),
  `scripts/audit-ruleset-integration-ids.ts` (precedent for a `gh`-backed, non-offline audit
  script as a separate entry point from `npm run lint`).
- **Known debt this will surface (not fix):** #811 (`MinSpec SDD validation` fake-green stub,
  clause 2), #857 (bumblebee scan silently red + non-required, clauses 2/3).
- **Instances the class already produced:** #560 (wrong App id pin), #810 / fixed #854
  (best-effort status swallow).
