---
id: SPEC-066
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — the merge-gate witness family (same home as SPEC-054/DR-066)
aspects: [ci, gates, required-checks, silent-failure, merge-gate, provisioning, tier-0]
depends_on: [SPEC-054]  # the DR-066 enforcement linter; FR-5 asks it to carry the recurrence rule rather than minting a third checker
relates_to: [SPEC-054, SPEC-024, SPEC-062, SPEC-033, DR-066, DR-063, DR-047, DR-057]
implements: none
implements_reason: >-
  Creates no new source file under the recommended shape. FR-1/FR-2 rename a job id inside
  an existing workflow, FR-3 corrects matchers inside existing scripts, FR-4 widens an
  existing audit module, FR-6 regenerates an existing generated file. Every path is
  modified, never created, and each is owned elsewhere (the CI-review stack by SPEC-033's
  provisioning surface, the pin audit by the #560 remediation) — so `implements: none` with
  the blast radius under `affects:`, matching SPEC-051/SPEC-059's modify-don't-own shape.
  If Clarify DQ-2 resolves toward a standalone recurrence checker instead of amending
  SPEC-054, that new script becomes this spec's first `implements:` entry at Plan.
affects:
  - .github/workflows/ready-to-merge.yml
  - scripts/review-pr.sh
  - packages/minspec/src/lib/ruleset-integration-audit.ts
  - scripts/audit-ruleset-integration-ids.ts
  - packages/minspec/src/lib/ci-review-templates.ts
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — One required-context name, one witness (Requirements)

> Materializes **[#1482](https://github.com/AIClarityAU/minspec/issues/1482)**, filed while
> rebasing #1209 (DR-079). Same family as
> **[#864](https://github.com/AIClarityAU/minspec/issues/864)** (loud witness-or-fail when
> *no* SHA-pass witness is present — the opposite failure direction),
> **[#895](https://github.com/AIClarityAU/minspec/issues/895)** (the ≥2-witnesses linter,
> specified as [SPEC-054](../SPEC-054-gate-signal-linter/requirements.md) FR-3),
> **[#810](https://github.com/AIClarityAU/minspec/issues/810)** (`ready-to-merge` stuck RED
> on genuine passes — the inverse symptom on the same signal) and
> **[#560](https://github.com/AIClarityAU/minspec/issues/560)** (a required check pinned to
> an app that can never satisfy it). The governing rule is
> [DR-066](../../../docs/decisions/DR-066.md) / constitution invariant #2 — *no silent
> gate*. This spec does not re-litigate that rule; it closes a specific way the rule can be
> satisfied on paper and defeated in fact.

## One-Sentence Scope

Make the required branch-protection context `ready-to-merge` resolvable to exactly one
witness — the verdict-carrying commit status — by renaming the workflow job whose check run
currently claims the same name, sweeping every consumer that matches on that name, repairing
the one in-repo audit that is today satisfied by the wrong witness, and leaving behind a
deterministic gate so a second witness can never re-claim a required context name.

## Context

### The collision (verified in this worktree, 2026-08-23)

One workflow file produces **two objects that share the required name**:

| Witness | Produced at | What it means |
|---|---|---|
| Check run `ready-to-merge` | [`.github/workflows/ready-to-merge.yml:80`](../../../.github/workflows/ready-to-merge.yml#L80) (`name: ready-to-merge`) + [`:100`](../../../.github/workflows/ready-to-merge.yml#L100) (job id `ready-to-merge`, **no `name:` override**) | green whenever the job *executed without erroring* |
| Commit status `ready-to-merge` | [`:169`](../../../.github/workflows/ready-to-merge.yml#L169) (fail-closed post) and [`:335`](../../../.github/workflows/ready-to-merge.yml#L335) (authoritative post), both `context: 'ready-to-merge'` | the actual gate verdict (`success` iff a provenance-verified `ai-review:pass`) |

`ready-to-merge` is a required status check on `main`
([DR-047:47](../../../docs/decisions/DR-047.md), [DR-057:29](../../../docs/decisions/DR-057.md),
and the live-ruleset dump recorded at
[SPEC-065:229-243](../SPEC-065-solo-mode-ceremony-cut/requirements.md) — the only in-repo
record of its `integration_id: 15368` pin). **No machine-readable required-check list is
committed to this repo**; the live ruleset is the sole source of truth, fetched at runtime by
`scripts/audit-ruleset-integration-ids.ts`.

> The issue cited `:78`, `:98`, `:160`, `:326`. The file has shifted since filing; the four
> lines above are the current, re-read positions. The substance is unchanged.

The workflow header already anticipates a **narrower** hazard at
[`:15`](../../../.github/workflows/ready-to-merge.yml#L15) — *"do not add a second workflow
that also posts this status, or the two will race on the same (sha, context)"*. That covers
two *status posters*. It does not cover a check run and a status colliding on one name, which
is what happens on every run of this workflow.

### Why three of them appeared at once

`.github/workflows/ready-to-merge.yml` declares **no `concurrency:` group** (grepped: zero
matches for `concurrency`/`cancel-in-progress`). The trigger list at
[`:84`](../../../.github/workflows/ready-to-merge.yml#L84) is
`[opened, synchronize, reopened, labeled, unlabeled]`, so three activity types inside ~10s
produced three concurrent runs and three same-named check runs on #1209's head. The collision
is routine, not a one-off. (See Out of scope — the concurrency question is deliberately not
folded in here.)

### A confirmed wrong-witness resolution already exists — inside our own tooling

The issue's open question is what *GitHub* resolves the name to. That question is still open
(below). But this repo contains a resolver of its own that **provably** resolves
`ready-to-merge` to the job check run, and it was read line-by-line for this spec:

- [`packages/minspec/src/lib/ruleset-integration-audit.ts:34-39`](../../../packages/minspec/src/lib/ruleset-integration-audit.ts#L34)
  defines `ObservedCheckRun.name` as *"matched against a pin's `context`"*.
- `auditRequiredCheckPins` (same file, ~`:137`) keys observations by check-run **name** and
  compares them to ruleset **contexts**.
- Its only feed is check runs:
  [`scripts/audit-ruleset-integration-ids.ts:132`](../../../scripts/audit-ruleset-integration-ids.ts#L132)
  fetches `repos/{owner}/{repo}/commits/{sha}/check-runs`. It never calls
  `commits/{sha}/status`, so **a context produced only as a commit status is invisible to
  this audit.**

Consequence, today: the `ready-to-merge` pin audits `ok` **only because the job check run
happens to carry the same name and the same app id (15368)**. The verdict-carrying status is
never examined. That is the same wrong-witness substitution the issue describes, confirmed in
code rather than inferred — and it is a second reason to act that does not depend on
resolving GitHub's behaviour. It also means the rename has a trap: once the job check run is
gone, this audit flips `ready-to-merge` to `unobserved`, which the module's own doc comment
(~`:120`) classifies as *"Inconclusive … NOT a failure"*. Silently and permanently
inconclusive, for the only required context that carries a non-null pin. FR-4 exists for that.

### Every consumer of the name

Read line-by-line during this pass:

| # | Site | Reads | Effect of a job rename |
|---|---|---|---|
| C1 | [`scripts/dispatch-issue.sh:1687-1689`](../../../scripts/dispatch-issue.sh#L1687) — `gh api …/commits/{sha}/status --jq '[.statuses[] \| select(.context=="ready-to-merge")]'` | **status** (the `/status` endpoint never returns check runs) | none — correct today |
| C2 | [`scripts/review-pr.sh:87-88`](../../../scripts/review-pr.sh#L87) — `gh pr checks … \| grep -viE '^ready-to-merge[[:space:]]'` | **ambiguous** — `gh pr checks` prints check runs *and* statuses in one table, so this suppresses both | must be re-derived; a name like `ready-to-merge gate` would still match this prefix pattern, which is why FR-2 forbids prefix relations |
| C3 | [`packages/minspec/src/lib/ruleset-advisor.ts:352-353`](../../../packages/minspec/src/lib/ruleset-advisor.ts#L352) — `READY_TO_MERGE_CHECK = 'ready-to-merge'`, doc-commented *"(commit status)"*; pushed into the required contexts at [`:431`](../../../packages/minspec/src/lib/ruleset-advisor.ts#L431) | declares the **required context** | none — the context name does not change (FR-7) |
| C4 | [`packages/minspec/src/lib/ruleset-integration-audit.ts`](../../../packages/minspec/src/lib/ruleset-integration-audit.ts) + [`scripts/audit-ruleset-integration-ids.ts:132`](../../../scripts/audit-ruleset-integration-ids.ts#L132) | **check run**, keyed on a status context | breaks silently → `unobserved`. See FR-4 |
| C5 | [`scripts/validate-frontmatter.ts:516-522`](../../../scripts/validate-frontmatter.ts#L516) — Rule 12, **FATAL** | not a witness read | any edit to `ready-to-merge.yml` **must** be followed by `node scripts/gen-ci-templates.mjs`, or `npm run validate` fails |

Reported by a repo-wide sweep and **not** individually re-read in this pass — Plan must
confirm each before relying on it: `packages/minspec/src/lib/ci-review-templates.ts:1073-1074`
(base64 copy of the whole workflow, the Rule-12 artifact), `template-registry.ts:1806-1807`
(scaffolding path), `commands/init.ts:842` (`hasWorkflow('ready-to-merge.yml')` probe),
`packages/minspec/tests/ruleset-integration-audit.test.ts:122-124` (a fixture that pairs
`context:'ready-to-merge'` with `name:'ready-to-merge'` and expects `ok` — i.e. it encodes the
collision as the happy path), `packages/minspec/tests/ruleset-advisor.test.ts:1166-1176`
(binds the *status* context only, so it is rename-safe). Roughly thirty further hits across
`ai-review.yml`, `docs-lane.yml`, `ci.yml`, `main-red-watch.yml`, `remediate-pr.sh`,
`dispatch-issue.sh` and several DRs were classified as prose/comment-only.

Also surfaced by that sweep and worth its own attention at Plan: `remediate-pr.sh:396-416`
and `dispatch-issue.sh:1219-1241` filter `statusCheckRollup` on `.name`, a field
`StatusContext` objects do not carry — so the `ready-to-merge` **status** is invisible to the
drain and the shepherd today. That is adjacent, not caused by the rename, and is not in this
spec's scope.

### Blast radius reaches adopter repos

`ready-to-merge.yml` is not only this repo's CI — it is a **scaffolded template** MinSpec
writes into adopter repos (`template-registry.ts:1806-1807`, embedded at
`ci-review-templates.ts:1073-1074`, gated by Rule 12). Any adopter that followed the advisor
and required `ready-to-merge` (`ruleset-advisor.ts:431`) inherited the identical
two-witnesses-one-name shape. The fix is therefore a template fix, not a local one
(constitution invariant #3 cuts both ways: what MinSpec ships lands in the adopter's repo, so
a defect in the shipped artifact is a defect in every opted-in repo).

### What is NOT verified

**Which witness GitHub's required-status-check evaluation actually honours.** Not confirmed
here, and deliberately not guessed at about a merge gate. On #1209 the question was masked:
the required `ai-review` context was absent for the new head SHA, so the PR was blocked
regardless. Defence in depth held on that PR; that says nothing about a PR where `ai-review`
is present and green while the `ready-to-merge` status is `failure`. Reproducing it needs
exactly that state, then reading `mergeStateStatus` (`BLOCKED` vs `CLEAN`/`UNSTABLE`). See
DQ-1 — whether to build that repro is a human call, not an assumption this spec should make
in either direction.

What *is* verified is that the ambiguity exists, that one in-repo resolver already picks the
wrong witness (C4), and that the hazard ships to adopters. FR-1 removes the ambiguity without
needing the answer.

## Functional Requirements

- **FR-1 (one required name, one witness).** After this change, the required context
  `ready-to-merge` MUST be produced by exactly one object: the commit status posted at
  `ready-to-merge.yml:169`/`:335`. The workflow job MUST NOT emit a check run bearing that
  name — achieved by giving the job a distinct id and/or an explicit `name:`. The workflow
  `name:` at `:80` MAY stay as-is or change; what matters is the **check-run name**, which
  derives from the job's `name:`/id, not the workflow's.
- **FR-2 (distinct, not merely different).** The job's new check-run name MUST NOT equal the
  required context, and MUST NOT be a prefix of it nor be prefixed by it. Rationale is
  concrete, not stylistic: C2 matches `^ready-to-merge[[:space:]]`, so `ready-to-merge gate`
  would still be conflated by a matcher this spec is meant to disentangle. Substring-adjacent
  names re-create the bug for loose matchers.
- **FR-3 (sweep before rename, and prove the sweep).** Every site that matches the name MUST
  be enumerated and each classified as status-reader / check-run-reader / ambiguous /
  prose-only, and each behaviour-bearing site updated so it reads the witness it *means*. The
  Context tables above are the starting inventory, not the finished sweep: C1–C5 were read
  directly, the second list was not. Plan MUST re-derive the inventory from the tree at
  implementation time rather than trusting this spec's snapshot. The sweep — not the rename —
  is the work.
- **FR-4 (the pin audit must not go quietly blind).** `auditRequiredCheckPins` and its CLI
  MUST NOT report a required context as `unobserved`/inconclusive merely because that context
  is produced as a commit status rather than a check run. Two acceptable shapes: sample
  `commits/{sha}/status` alongside `commits/{sha}/check-runs` and match a pin against either
  witness kind; or keep the check-run-only sample and emit a distinct, loud finding
  (*"required context X is a commit status; this audit cannot observe it"*) that is visibly
  reported rather than folded into the benign `unobserved` bucket. A required check whose
  verification silently degrades to "cannot tell" is the constitution-#2 failure shape this
  whole spec is about, and it MUST NOT be introduced as a side effect of fixing the original
  one. Whether this lands here or separately is DQ-3.
- **FR-5 (recurrence gate — a data fix alone is a tell).** A deterministic check MUST exist
  that fails when any required status-check context is claimed by more than one witness kind
  (check run *and* commit status) on the same head. Per DR-003's Phase-4 asymmetry rule, the
  rename is the data fix and this is the missing gate; shipping only the rename repeats the
  mechanism. Where this rule lives is DQ-2. Whichever home is chosen, it MUST NOT be a third
  independent implementation of "read the ruleset's required contexts" — SPEC-054 FR-3
  already owns that read, and duplicating it produces two checkers that can disagree.
- **FR-6 (the adopter template carries the fix).** The rename MUST land in the scaffolded
  template, not only in this repo's live workflow: `node scripts/gen-ci-templates.mjs` MUST
  be re-run so `packages/minspec/src/lib/ci-review-templates.ts` is byte-identical to the
  edited source, satisfying Rule 12 (FATAL,
  [`validate-frontmatter.ts:516`](../../../scripts/validate-frontmatter.ts#L516)). Adopter
  repos that already require the `ready-to-merge` **context** are unaffected by the rename
  because FR-7 holds the context name fixed.
- **FR-7 (do not touch the required name or the live ruleset).** The commit-status context
  string stays `ready-to-merge`, and this change makes **no** edit to branch protection. Any
  approach that renames the required context would open a window in which `main`'s required
  check does not exist and every PR reads as satisfying it — a strictly worse fail-open than
  the one being fixed.
- **FR-8 (the workflow stays the single status writer).** The `:15` "single writer" property
  MUST survive: exactly one job, all events, posting `context: 'ready-to-merge'`. FR-1 must
  not be implemented by splitting the post into a second job or workflow.

## Acceptance Criteria

- [ ] **AC-1 (FR-1).** On a PR head after the change, the check rollup contains **zero**
  objects named `ready-to-merge` other than the `StatusContext`. Verified by reading the
  rollup for a real head SHA (`gh pr view --json statusCheckRollup`, or
  `commits/{sha}/check-runs` + `commits/{sha}/status`), not by reading the YAML.
- [ ] **AC-2 (FR-1, the negative case is the point).** A PR whose `ready-to-merge` status is
  `failure` while the workflow job itself completed successfully reports
  `mergeStateStatus: BLOCKED`. This is the acceptance test the original hazard demands: the
  gate must be red when the verdict is red, whatever the job did.
- [ ] **AC-3 (FR-2).** The chosen check-run name satisfies the prefix rule: neither
  `startsWith('ready-to-merge')` nor `'ready-to-merge'.startsWith(name)` holds. Asserted in a
  test against the workflow source, so a later rename cannot quietly reintroduce a prefix
  relation.
- [ ] **AC-4 (FR-3).** The PR body (or a spec/Plan artifact) carries the full re-derived
  inventory with each site's witness classification, and every behaviour-bearing site is
  either updated or explicitly recorded as correct-as-is with the reason. `scripts/review-pr.sh`
  specifically: its exclusion still suppresses the `ready-to-merge` **status** row (preserving
  the documented chicken-and-egg avoidance at `:83-86`) and now also handles the renamed job
  row deliberately — included or excluded by explicit choice, recorded in the comment.
- [ ] **AC-5 (FR-4).** With a fixture where the ruleset pins context `ready-to-merge` and the
  observed sample contains **no** check run of that name (the post-rename reality), the audit
  does not emit a quiet `unobserved`: it either resolves the pin from the commit status or
  emits a distinct, visible finding naming the witness-kind mismatch. The existing fixture at
  `ruleset-integration-audit.test.ts:122-124`, which pairs `context:'ready-to-merge'` with a
  same-named check run and expects `ok`, is re-framed rather than left encoding the collision
  as the happy path.
- [ ] **AC-6 (FR-5).** A test proves the recurrence gate fails on a synthetic head where one
  required context name appears as both a check run and a commit status, and passes when it
  appears as only one. The check runs in CI, not only as a unit test.
- [ ] **AC-7 (FR-6).** `npm run validate` passes with no Rule-12 staleness finding, i.e. the
  embedded template was regenerated in the same commit as the workflow edit.
- [ ] **AC-8 (FR-7).** `git diff` touches no ruleset/branch-protection configuration, and
  `READY_TO_MERGE_CHECK` in `ruleset-advisor.ts` is unchanged (`'ready-to-merge'`), so
  `ruleset-advisor.test.ts:1166-1176` passes untouched.
- [ ] **AC-9 (FR-8).** Exactly one `createCommitStatus({… context: 'ready-to-merge' …})`
  call-site *job* remains; the count of posting jobs is unchanged at one.
- [ ] **AC-10 (regression witness for the original symptom).** Whatever DQ-1 resolves,
  the answer — reproduced result, or an explicit "not reproduced, ambiguity removed instead" —
  is written into the PR body. A merge-gate fix that leaves no record of what the gate did
  before is not auditable later.

## Decisions needed (Clarify)

- **DQ-1 — Reproduce GitHub's resolution order before landing the rename, or fix the
  ambiguity without ever learning the answer?** Reproducing needs a PR staged with
  `ai-review` green, the `ready-to-merge` status `failure`, and the job check run green, then
  a read of `mergeStateStatus`.
  *Recommendation: **do not gate the fix on the repro** — remove the ambiguity now, and record
  the question as answered-by-construction (AC-10).*
  *Cost of that recommendation:* we never learn whether the gate was genuinely fail-open, so
  we cannot size the past exposure — specifically, we cannot tell whether any already-merged
  PR merged on a green job check run over a failing status. That evidence ages out with the
  head SHAs, so choosing not to look is choosing not to be able to look later. If a
  retrospective audit of past merges matters, the repro must come first.
- **DQ-2 — Where does the recurrence gate (FR-5) live: amended into
  [SPEC-054](../SPEC-054-gate-signal-linter/requirements.md) FR-3, or a standalone check
  shipped by this spec?** SPEC-054 FR-3 already reads the live ruleset's required contexts and
  already treats **mechanism diversity** (status / check-run / label) as what makes two
  producers independent. This issue is a sharp counterexample to that bar as written: here two
  producers of *different mechanisms* exist for one context, which reads as a healthy ≥2
  under FR-3, while in fact they share a name and disagree. So SPEC-054's manifest needs a
  witness-*name* dimension either way.
  *Recommendation: **amend SPEC-054** — one rule, one linter, one ruleset read (the
  no-reimplementation discipline SPEC-059 INV-2 records).*
  *Cost of that recommendation:* SPEC-054 is at `plan`, unimplemented. Coupling FR-5 to it
  means the rename ships now and the gate ships later, leaving an unguarded interval in which
  nothing stops a second witness re-claiming a required name — the exact recurrence this spec
  is trying to foreclose. A standalone check would close that interval immediately at the cost
  of a second ruleset reader to later reconcile.
- **DQ-3 — Is the pin-audit repair (FR-4) in scope here, or a separate issue?** Keeping it
  here means this spec spans `.github/`, `scripts/` and `packages/minspec/src` plus tests.
  *Recommendation: **keep it in scope**.*
  *Cost of that recommendation:* it turns a one-line YAML change into a multi-package change
  with real review surface and a longer path to merge — and because the workflow lives under
  `.github/`, the PR is machinery and picks up the `machinery-review-required` human gate
  regardless. The counter-argument for splitting is real, but splitting means knowingly
  landing a rename that makes an existing audit permanently inconclusive, which is trading one
  silent-gate defect for another.
- **DQ-4 — What is the new job/check-run name?** Candidates: `merge-gate`, `gate`,
  `ai-review-gate`.
  *Recommendation: **`merge-gate`*** — unambiguous, and it satisfies FR-2's prefix rule, which
  `ready-to-merge-gate` and `ready-to-merge gate` both fail.
  *Cost of that recommendation:* in the PR checks list a human now sees `merge-gate` and
  `ready-to-merge` side by side and may read them as two separate systems rather than a job
  and its verdict — the very legibility the current (broken) shared name buys. Mitigation is a
  comment in the workflow and a `description` on the status, not a name that re-collides.
- **DQ-5 — Concurrency.** Three simultaneous runs on one head are what made the collision
  visible, and the workflow has no `concurrency:` group. Adding
  `concurrency: {group: ready-to-merge-${{ github.event.pull_request.number }},
  cancel-in-progress: true}` would cut the duplicate check runs — but `cancel-in-progress` on
  a *gate* can cancel the run that would have posted the authoritative red, which is a
  fail-open of a different shape.
  *Recommendation: **out of scope here; file it separately** so it gets its own analysis
  rather than riding along on a rename.*
  *Cost of that recommendation:* the duplicate-run noise persists after this fix, and a reader
  who saw #1482's three-check-runs evidence may believe this spec addressed it. **Not yet
  filed — this dispatch has no network access.** Plan MUST file it and replace this sentence
  with the issue number before the spec leaves Clarify (prose-only follow-ups are a leak).

## Invariants (must hold)

- **INV-1 (constitution #2 — no silent gate).** A required check must resolve to the witness
  that can express failure. Neither the fix nor its side effects may leave a required check
  verified by a witness that is green whenever the workflow merely ran (FR-1), nor leave its
  verification silently inconclusive (FR-4).
- **INV-2 (constitution #2 — second witness preserved).** `ready-to-merge` and `ai-review`
  remain distinct required contexts with distinct producers; nothing here reduces the number
  of independent witnesses on the merge gate (#810/#864's redundancy stays intact).
- **INV-3 (no gate-less window).** The required context name never changes and branch
  protection is never edited (FR-7), so at no point does `main` require a context that nothing
  produces — or produce a context nothing requires.
- **INV-4 (constitution #3 — blast radius).** The fix ships in the scaffolded template so
  opted-in adopter repos get the corrected shape (FR-6); MinSpec must not leave a known
  merge-gate ambiguity in the artifact it writes into other people's repos.
- **INV-5 (single status writer).** Exactly one job, all events, posts
  `context: 'ready-to-merge'` (FR-8) — the property `ready-to-merge.yml:15` protects.
- **INV-6 (no reimplementation of the ruleset read).** FR-5's gate reuses SPEC-054 FR-3's
  ruleset read rather than adding a second one that can drift from it.
- **INV-7 (Tier-0 unaffected).** Nothing here adds a network call to the extension's offline
  path; the recurrence gate and the pin audit are `gh`-backed CI/CLI surfaces, exactly as they
  are today.

## Risks & Mitigations

| # | Risk | L·I | Mitigation |
|---|---|---|---|
| R1 | The sweep misses a consumer, and a poller/dashboard keyed on the job check run silently stops matching — the exact cost the issue names. | Med·High | FR-3 requires a re-derived inventory with per-site witness classification, and AC-4 requires it recorded; C1–C5 above are a verified starting point, not the answer. |
| R2 | The rename makes the pin audit permanently `unobserved` for the one non-null-pinned required context, trading one silent defect for another. | **High (certain absent FR-4)**·High | FR-4 + AC-5; DQ-3 asks explicitly whether to accept this risk by deferring. |
| R3 | The workflow edit lands without regenerating the embedded template — Rule 12 is FATAL, so CI reddens; worse, if regenerated wrongly, adopters get a divergent template. | Med·Med | FR-6 + AC-7; Rule 12 already fails closed on drift. |
| R4 | GitHub in fact honours the commit status, so the change is "unnecessary" and gets deprioritised — leaving the ambiguity, and the confirmed wrong-witness audit (C4), in place. | Med·Med | The C4 finding is verified in code and does not depend on GitHub's behaviour; DQ-1's recommendation deliberately decouples the fix from the unknown. |
| R5 | A future contributor re-collides the names (adds a job named after a required context) because nothing stops them. | Med·High | FR-5's recurrence gate; without it this spec is a data fix and R5 is near-certain over time (DR-003 Phase-4). |
| R6 | Renaming the job changes the check name humans have learned to look for in the PR UI, and a reviewer reads the absent `ready-to-merge` check run as "the gate did not run". | Med·Low | DQ-4's cost clause; mitigate with a workflow comment and a clear status `description`, never by re-colliding the name. |

## Out of scope

- **Adding a `concurrency:` group to `ready-to-merge.yml`** — DQ-5; needs its own analysis
  because `cancel-in-progress` on a gate is itself a fail-open shape.
- **Changing the required-context set on `main`**, or editing the live ruleset in any way
  (FR-7). DR-047/DR-057's six required contexts stand.
- **The `statusCheckRollup`-on-`.name` blind spot** in `remediate-pr.sh:396-416` /
  `dispatch-issue.sh:1219-1241`, which makes the `ready-to-merge` *status* invisible to the
  drain and the shepherd. Adjacent and not caused by the rename; noted in Context so the next
  reader does not have to rediscover it.
- **Committing a machine-readable required-check manifest to the repo.** Tempting (there is
  none today) but it is SPEC-054 FR-5's design question, not this spec's.
- **Any change to the ai-review provenance/staleness guards** (`ai-review-guard.js`) — this
  spec does not touch what makes the status green, only which object carries the name.

## Dependencies

- **[SPEC-054](../SPEC-054-gate-signal-linter/requirements.md)** (#895) — owns the DR-066
  enforcement linter and the live-ruleset read. FR-5 depends on it under DQ-2's recommended
  resolution; its FR-3 "mechanism diversity" bar needs a witness-name dimension either way.
- **[SPEC-024](../SPEC-024-auto-merge-eligibility/requirements.md)** — its auto-merge conjunct
  is explicitly the `ready-to-merge` **status** (AC-18), matching C1; unaffected by the rename,
  and its correctness is one of the things AC-8/AC-9 must not disturb.
- **[SPEC-062](../SPEC-062-autonomous-pr-drain/requirements.md)** — FR-2 requires the same
  status before an unattended merge; a downstream consumer of the witness this spec protects.
- **[SPEC-033](../SPEC-033-repo-governance-provisioning/requirements.md)** / `ruleset-advisor.ts`
  — owns the required-context advice and the scaffolded workflow; FR-6/FR-7 are constraints
  imposed by that ownership.
- **[DR-066](../../../docs/decisions/DR-066.md)** (no silent gate), **[DR-063](../../../docs/decisions/DR-063.md)**
  (the two-witness mechanism), **[DR-047](../../../docs/decisions/DR-047.md)** /
  **[DR-057](../../../docs/decisions/DR-057.md)** (the required-context list) — consumed as
  accepted; none is re-litigated here.

## Follow-ups (tracked)

- **DQ-5 concurrency question** — MUST be filed as its own issue at Plan; not filed on this
  dispatch (no network). Replace with the issue number before Clarify closes.
- **`statusCheckRollup` `.name`-only filters** (Out of scope, item 3) — same: file at Plan or
  record explicitly as accepted-and-unfiled with a reason.
- **SPEC-054 FR-3 amendment** — if DQ-2 resolves as recommended, SPEC-054 gains the
  witness-name rule; that edit is a change to another spec and belongs in its own PR, not this
  one.
