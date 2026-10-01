---
id: SPEC-080
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — DR-066's own domain (no-silent-gate family); same epic as SPEC-078/SPEC-079
relates_to: [DR-050, DR-066, DR-074, DR-004, SPEC-033, SPEC-078, SPEC-079, "#1567"]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-080: MinSpec must surface an under-configured review harness, not swallow it

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch
> that produced it. A human reads this spec, resolves
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before anything is built.

Materializes **[#1567](https://github.com/AIClarityAU/minspec/issues/1567)** —
*"MinSpec detects an under-configured review harness and never says so (secrets, repo
vars, App installation)"*, filed while dogfooding a fresh project that hit all three
gaps: a 404 filing an issue as the bot, `ai-review.yml` skipping silently, and the
ruleset advisor quietly narrowing the checks it offers.

## One-Sentence Scope

Report exactly which review-harness setup signals — the gating secrets, the
governance-relevant repo variables, and (where it is actually producible) App
installation — are absent, once, after init/refresh, instead of the probe's answer
being computed and then discarded the way `probeReviewerConfigured` is today.

## Context — what the issue's root-cause paragraph checks out on, read fresh

### The boolean-discard, confirmed

`probeReviewerConfigured` (`packages/minspec/src/lib/ruleset-advisor.ts:768-790`) reads
`repos/{owner}/{repo}/actions/secrets`, intersects the names against `REVIEWER_SECRETS`
(`:712-716`: `CLAUDE_CODE_OAUTH_TOKEN`, `MINSPEC_APP_ID`, `MINSPEC_APP_PRIVATE_KEY`), and
returns a single boolean. Its only caller, `resolveWantedChecks` (`init.ts:775-798`),
folds that boolean into `resolveTieredRequiredChecks`'s inputs and nothing else —
confirmed by reading both functions in full: no branch anywhere logs, toasts, or
otherwise surfaces *which* secret (if any) is missing. `offerRulesetAdvisory`
(`init.ts:887-1021`), the only consumer of the resolved check set, only ever compares
*check names* against what a ruleset requires; a Tier-A gap silently narrows the
offered ruleset to Tier-B checks, with no message saying why. The issue's root-cause
claim holds exactly as stated.

`REVIEWER_OPTIONAL_SECRETS` (`ruleset-advisor.ts:740`, currently `ANTHROPIC_API_KEY`
only) is deliberately *not* part of the gating set — folding it in would reopen the
#559 deadlock symmetrically (an unset PAYG failover key would then read as "not
configured" and strip Tier-A checks from a repo whose reviewer works fine). This
spec's design must preserve that split, not flatten it while fixing the reporting gap.

### The variables gap, confirmed by grep (zero hits)

`grep -rn "actions/variables"` across `packages/`, `.github/`, and `scripts/` returns
**nothing**. The four variables the issue names are real, scaffolded, referenced
repo-wide:

- `AI_REVIEW_FAILOVER` — `.github/workflows/ai-review.yml:284`, read defensively by
  `review-branch.sh` (`AI_REVIEW_FAILOVER == payg && -n ANTHROPIC_API_KEY`, per
  `ruleset-advisor.ts:722-724`'s own comment). Unset → default `wait` path, unchanged
  behaviour.
- `AI_REVIEW_COVERAGE` — `.github/workflows/ai-review.yml:285,299`, documented default
  `panel` (`COVERAGE="${AI_REVIEW_COVERAGE:-panel}"`).
- `AI_REVIEW_HUMAN_REVIEWERS` — `.github/workflows/ai-review.yml:1008,1215`.
- `AI_REVIEW_BOT_LOGINS` — `.github/workflows/ready-to-merge.yml:45,161,198,278,503`;
  unset falls back to the literal default `'minspec-sdd[bot]'` (`:161`).

The scaffolded copy (`packages/minspec/src/lib/ci-review-templates.ts`'s
`AI_REVIEW_WORKFLOW`, consumed by `template-registry.ts:2163`) carries the same
references — confirmed by the file being the source this repo's own
`.github/workflows/ai-review.yml` is rendered from (SPEC-079's Context establishes this
producer relationship for the same constant). So every repo MinSpec scaffolds
`ai-review.yml`/`ready-to-merge.yml` into references all four, and nothing has ever
read them back.

The issue's nuance is correct and must survive into the design: `AI_REVIEW_FAILOVER`
and `AI_REVIEW_COVERAGE` are read defensively with documented defaults — reporting an
unset-but-defaulted variable as a *failure* is a false positive with a specific,
named cost (DR-066's own "a check people disable takes the genuine warning with it").
Only `AI_REVIEW_HUMAN_REVIEWERS` / `AI_REVIEW_BOT_LOGINS` change *who can approve or
be treated as the review bot* — a governance-visible consequence — and are the only
two worth a line even informationally.

### The App-installation gap — NOT a third instance of the same fix, verified against DR-050

This is where the issue's "Ask" (one toast naming all three) does not survive contact
with what this repo has already measured. **[DR-050](../../../docs/decisions/DR-050.md)'s
own Amendment (2026-08-25)** — triggered by a different issue (#1694, an org-picker for
repo creation) but directly on point here — tested every account-scope endpoint a
Tier-0 extension could use to learn about App installation, against a real `gh` OAuth
token with `repo`/`workflow`/`read:org` scopes:

| Endpoint | Result |
|---|---|
| `GET /user/installations` | 403 — requires a user-to-server token from the App's own OAuth flow |
| `GET /orgs/{org}/installation` | 401 — requires an App JWT |
| `GET /repos/{owner}/{repo}/installation` | 401 — requires an App JWT |

The amendment's own conclusion: *"MinSpec holds no App private key and runs no OAuth
flow, so it can produce neither credential."* That amendment is itself recorded as
**`proposed`, not accepted** — a genuine widening of the DR-050 boundary (repo config →
user account) that is explicitly withheld pending the founder's own ratification, and
is not this spec's to re-litigate or assume. Grepping this repo's source for
`memberships/orgs`, `user/installations`, or `.../installation` outside `DR-050.md`
itself returns nothing — #1694 is not built, so there is no existing account-scope
probe this spec could extend either.

Separately, and this is the mechanism the issue's own symptom actually matches: the
issue's 404 is not "the App does not exist" — it is **"the App's installation exists
but does not cover this repo's owner/repo pair"** (the issue's own words: *"an
installation covering four repos under one org returns 404 for a repo under a
different owner"*). Distinguishing that requires calling a repo-scoped, App-token
endpoint for *this specific repo* — which requires an **installation token**, minted
from `MINSPEC_APP_ID` + `MINSPEC_APP_PRIVATE_KEY`. The Tier-0 VS Code extension never
holds those values (they are CI repo secrets, read by `probeReviewerConfigured` only
as *names*, never values, per DR-050 Amendment 2026-07-16). **The credential needed to
answer this question exists only inside CI**, where `.github/workflows/ai-review.yml`
already mints exactly such a token via `actions/create-github-app-token`
(`:192-195`) — after the secret-presence guard at `:176-181` already passed. A
repo-selection gap (App installed, this repo not in it) is the one failure mode that
guard cannot catch, because it only checks the secrets *exist*, not that the
installation *covers this repo*.

**What this means for the design:** Part 3 of the issue's Ask (App installation) is not
addable to the same Tier-0, autonomous, IDE-side probe that Parts 1–2 use. It is
producible — but only from inside a CI run that already has the App credentials, which
is a different surface (a workflow step / job output / PR comment), on a different
cadence (fires when `ai-review.yml` runs, not at IDE init), than the toast the issue's
mockup shows. [Decisions needed](#decisions-needed-clarify) DQ-1 is for choosing how
that surface reports it — the issue's single combined toast, as literally specified,
is not achievable without either reopening DR-050's unratified account-scope amendment
(not this spec's call to make) or inventing a Tier-0 App-JWT credential path that
does not exist today and that DR-050 never authorised.

## Functional Requirements

- **FR-1 — Report which gating secret(s) are absent, not just whether all are
  present.** Extend (or add alongside) `probeReviewerConfigured` a variant that
  returns the *missing subset* of `REVIEWER_SECRETS`, reusing that constant as the
  sole source of truth (no second hand-written name list — the discipline
  `reviewer-secrets-enforcement.test.ts` already enforces for the existing boolean
  must extend to the new missing-subset shape). The existing boolean-returning call
  sites (`resolveWantedChecks` et al.) are unaffected; this is additive.

- **FR-2 — New Tier-0 autonomous probe of the repo's own Actions variables.** A `gh
  api GET repos/{owner}/{repo}/actions/variables` read, in the same read-only-config
  class as the existing `.../rulesets` and `.../actions/secrets` NAMES reads (DR-050
  Amendments 2026-07-01 / 2026-07-16): reads the repo's own configuration, egresses
  nothing, runs autonomously with no prior consent toast, fails safe (any read
  failure → treat as "cannot determine", never a false positive). Reports presence/
  absence of a small constant list — start at `AI_REVIEW_HUMAN_REVIEWERS` and
  `AI_REVIEW_BOT_LOGINS` per FR-3's classification; Plan decides whether
  `AI_REVIEW_FAILOVER`/`AI_REVIEW_COVERAGE` are read at all or skipped entirely since
  FR-3 forbids surfacing them as missing.

- **FR-3 — Informational, never a failure, for defaulted variables (preserves the
  issue's own nuance).** `AI_REVIEW_FAILOVER` and `AI_REVIEW_COVERAGE` MUST NOT be
  reported as absent/missing/a problem under any circumstance — both are read
  defensively with a documented default and an unset value is the ordinary case, not
  a defect. `AI_REVIEW_HUMAN_REVIEWERS` and `AI_REVIEW_BOT_LOGINS` MAY be reported,
  and only informationally (never blocking, never narrowing the required-check set) —
  because they change who can approve or be treated as the review bot, a
  governance-visible fact worth one line, per the issue's own "Important nuance"
  section.

- **FR-4 — App-installation-on-this-repo is answered where the credential actually
  lives, not invented in the Tier-0 extension.** No code added by this spec may
  attempt to answer "is the App installed on this repo" from `packages/minspec` using
  a user-scope `gh` token — that path is tested-infeasible (Context) and its one
  plausible extension (DR-050's account-scope amendment) is explicitly unratified and
  out of this spec's authority to ratify. The signal is instead produced where
  `MINSPEC_APP_ID`/`MINSPEC_APP_PRIVATE_KEY` are already live: inside the scaffolded
  CI workflow, immediately after the existing `actions/create-github-app-token` step
  (`ai-review.yml:192-195`), by distinguishing "token mint failed" (secrets absent or
  malformed — already loud, the action step itself fails) from "token minted but a
  repo-scoped call 404s" (installed, this repo not selected) with a named, readable
  diagnostic — never a bare 404 surfacing only when an unrelated agent write fails
  later. DQ-1 decides the exact mechanism and cadence.

- **FR-5 — One consolidated IDE-side advisory for what the extension CAN determine
  (FR-1, FR-2/FR-3).** Extends the existing `offerRulesetAdvisory` pattern
  (`init.ts:887`) rather than inventing a second, competing toast pathway: fires
  post-init/refresh, at most once per state, only when a GitHub remote resolves AND
  `ai-review.yml` is scaffolded in the target folder (mirrors `offerRulesetAdvisory`'s
  existing non-repo / no-remote / not-scaffolded early-returns — a repo that
  deliberately runs offline-first, no ai-review, gets zero toast, addressing the
  issue's own named false-positive risk). Suppressible permanently via a per-repo
  git-config flag, same shape as `RENAME_DECLINED_CONFIG`
  (`init.ts:628`/`offerRemoteRenameAdvisory`) — not `workspaceState`, so the
  suppression travels with the repo, not the editor profile.

- **FR-6 — No second hand-written list, either direction.** Whatever new constant
  lists the four variable names (or the subset FR-3 keeps reportable) lives once,
  consumed by both the probe and its own enforcement test — the same anti-drift shape
  `REVIEWER_SECRETS` + `reviewer-secrets-enforcement.test.ts` already establish for
  secrets. A second, independently typed list is the exact bug class DR-063/SPEC-074/
  SPEC-079 FR-1 already closed for adjacent constants; this spec must not reopen it
  for variables.

## Invariants (must not break)

- **INV-1 — No silent gate (constitution invariant 2, [DR-066](../../../docs/decisions/DR-066.md)).**
  This spec's entire premise is closing an instance of this invariant's failure mode;
  its own output must not become a new quiet failure (e.g., a toast-construction error
  swallowed the same way the boolean is swallowed today).
- **INV-2 — Offline core / Tier-0 boundary unchanged (constitution invariant 1,
  [DR-004](../../../docs/decisions/DR-004.md), [DR-050](../../../docs/decisions/DR-050.md)).**
  FR-2's variables read is authorised by the SAME class of carve-out DR-050's
  Amendments 2026-07-01/2026-07-16 already established (read-only GET of the repo's
  own config, egresses nothing, autonomous) — it is a new *endpoint* inside an
  *already-accepted* class, not a new class. FR-4 explicitly does NOT add any new
  network path to the extension; it stays entirely inside CI, where a network call to
  the user's own git host already happens.
- **INV-3 — Blast radius stays opt-in (constitution invariant 3,
  [DR-074](../../../docs/decisions/DR-074.md)).** FR-4's CI-side change only affects a
  repo that already scaffolded `ai-review.yml` (opted in via `.minspec/`); it is a
  diff to a managed-region template, not a new file class, and ships to adopters only
  on their own next refresh.
- **INV-4 — The #559 deadlock split is preserved.** `REVIEWER_OPTIONAL_SECRETS`
  (`ANTHROPIC_API_KEY`) stays out of the gating/missing-subset reported by FR-1; an
  unset PAYG key must never read as "reviewer not configured" and must never narrow
  the required-check set. Symmetrically, FR-3's informational variables must never
  narrow it either.
- **INV-5 — No new false-positive class (issue's own stated risk).** A repo that
  deliberately runs with no reviewer secrets, no App, and no ai-review workflow (a
  legitimate, arguably-default MinSpec setup) must see zero new toasts from this
  spec — FR-5's scaffolded-workflow-present gate is what keeps this true structurally,
  not a promise to remember.

## Acceptance Criteria

- [ ] **AC-1 (FR-1).** Given `actions/secrets` returns 2 of 3 `REVIEWER_SECRETS`
      names, the new missing-subset probe returns exactly the one absent name (not a
      boolean); given all 3, returns empty; given a `gh api` failure, returns
      "indeterminate" (not "all missing" — fail-safe must not manufacture a false
      failure list).
- [ ] **AC-2 (FR-2, FR-3).** Given `actions/variables` lacks `AI_REVIEW_BOT_LOGINS`,
      the probe reports it as informational; given it also lacks
      `AI_REVIEW_FAILOVER`/`AI_REVIEW_COVERAGE`, neither appears in any output at all
      (not even informationally) — asserted by a test that fails if either name is
      ever emitted.
- [ ] **AC-3 (FR-4).** A workflow-level fixture: secrets present and well-formed,
      `create-github-app-token` step fails with a repo-scope 404-shaped error →
      the diagnostic emitted names "App not installed for this repo" distinctly from
      a fixture where the secrets themselves are absent/malformed (today's existing
      NOTICE at `ai-review.yml:181`). The two failure modes must not read as the same
      message.
- [ ] **AC-4 (FR-5, INV-5).** Fixture: no GitHub remote → zero toast, zero `gh api`
      call beyond what `offerRulesetAdvisory` already makes today. Fixture: remote
      present, `ai-review.yml` NOT scaffolded → zero toast. Fixture: remote present,
      `ai-review.yml` scaffolded, nothing missing → zero toast (silent-on-success,
      matching `offerRulesetAdvisory`'s existing convention). Fixture: something
      missing, user picks the decline action → a per-repo git-config flag is written
      and a second init in the same repo produces no toast.
- [ ] **AC-5 (FR-6).** A test fails if a variable name referenced by
      `ai-review.yml`/`ready-to-merge.yml` (via a grep-based enforcement test mirroring
      `reviewer-secrets-enforcement.test.ts`) exists that the new shared constant does
      not know about — closing the "zero references to `actions/variables`" gap
      permanently, not just for today's four names.
- [ ] **AC-6 (INV-4).** A fixture with `ANTHROPIC_API_KEY` absent and all three
      `REVIEWER_SECRETS` present still reports "fully configured" — the optional
      secret never appears in FR-1's missing subset.

## Decisions needed (Clarify)

- **DQ-1 — Mechanism and cadence for FR-4's App-installation-on-this-repo signal.**
  - **(A) Inline step in `ai-review.yml`, right after the existing
    `create-github-app-token` step — catch its specific failure shape and rewrite the
    message (rec).** Cheapest: no new workflow, no new trigger, reuses the step that
    already runs on every PR. *Cost:* only fires on a PR that triggers `ai-review.yml`
    — a repo that scaffolded the harness but has not yet opened a PR gets no signal
    until the first one, same timing as today, just a clearer message when it does.
  - **(B) A dedicated lightweight preflight workflow/job, independent of a PR
    trigger** (e.g., on push to the default branch, or a manual dispatch). Answers the
    question proactively, closer to the issue's "once after init" framing. *Cost:* a
    new scaffolded file (new managed-region entry, new adopter-facing surface, larger
    blast radius than (A) — closer to SPEC-079's DQ-1 Option D shape) and a second
    workflow run consuming Actions minutes on every push.
  - **(C) Documentation-only — leave the raw failure as-is but make the existing
    NOTICE/first-failure text name this specific cause explicitly** ("if secrets are
    present but you still see a 404, the App's installation may not cover this repo —
    see docs"). *Cost:* cheapest of all, but it's exactly the reactive-only pattern
    the issue is complaining about — a human still has to fail first and go read the
    error to learn what's wrong, which is the whole gap FR-4 exists to close.
  - *Recommendation:* **(A)**, with (C)'s clearer wording folded in regardless of
    which of (A)/(B) is chosen — (A) is a small, reversible diff to a template already
    in `MANAGED_REGION_TEMPLATES`, it fires at the moment the credential actually
    exists, and it does not add a new adopter-facing file the way (B) would.

- **DQ-2 — Does FR-5's consolidated advisory extend `offerRulesetAdvisory` itself, or
  become a sibling function called alongside it?** `offerRulesetAdvisory` already
  computes `resolveWantedChecks` → `probeReviewerConfigured` on the same code path
  this spec extends; reusing that call is the "one transform, not two" discipline
  FR-1/FR-6 already commit to for the probes themselves.
  - **(A) Extend `offerRulesetAdvisory` to also report the missing-secret/variable
    detail inline in its existing toast copy (rec).** One function, one call site,
    one probe pass — avoids computing `probeReviewerConfigured` twice per init.
    *Cost:* `offerRulesetAdvisory`'s toast copy is already dense (required-check
    diffing); adding setup-completeness detail risks a single toast trying to say too
    much.
  - **(B) A new sibling function, its own toast, its own suppression flag.**
    Cleaner separation of concerns (ruleset-shape advice vs harness-completeness
    advice are different questions). *Cost:* two `gh api` probe passes where one
    would do unless the underlying probe result is explicitly shared/cached between
    them, and a second toast a user can dismiss independently of the first —
    plausibly two toasts firing back-to-back on the same init.
  - Plan phase should pick based on how large the combined copy reads in practice,
    not guessed here.

- **DQ-3 — Does this spec need its own DR?** Checked against the DR-359 filter (costs
  more than a day to undo?): FR-1/FR-2/FR-5 are additive reads inside an
  *already-accepted* DR-050 carve-out class and revertible diffs to
  `ruleset-advisor.ts`/`init.ts`. FR-4 Option (A) is a revertible diff to one
  scaffolded workflow step. **No new DR is required for DQ-1 Option (A)/(C).** If
  Clarify selects DQ-1 Option (B) (a new scaffolded preflight workflow — a new
  adopter-facing file, same shape as SPEC-079 DQ-1 Option D), that crosses into
  first-time-ownership-of-a-new-managed-file territory and this determination MUST be
  revisited before Plan completes, per the DR-359 filter and SPEC-079 DQ-2's identical
  precedent.

## Out of Scope

- **Ratifying or otherwise resolving DR-050's Amendment (2026-08-25)** (the
  account-scope org-picker read for #1694). That amendment is about a different
  feature (repo-creation owner picker) and this spec's FR-4 does not depend on it —
  it is cited in Context only as prior, directly-on-point evidence that account-scope
  App-installation detection was tested and found Tier-0-infeasible.
- **Detecting App installation from the VS Code extension by any means.** Ruled out
  in Context/FR-4 as not producible without a credential the extension does not and
  should not hold.
- **Changing `REVIEWER_OPTIONAL_SECRETS` membership or the #559 deadlock split
  itself.** INV-4 preserves it; this spec only adds reporting on top.
- **A `MinSpec: Check Review Setup` explicit-invocation command** — the issue's own
  named alternative. Not pursued as the primary mechanism (FR-5 picks the automatic,
  post-init advisory instead, per the issue's own recommendation), but nothing here
  forecloses adding one later as a supplementary, explicit-pull surface.
- **Building SPEC-078's evidence-witness fix or SPEC-079's managed-region parity
  fix.** Cited as sibling no-silent-gate / single-source-of-truth precedent, not
  re-specified here.

## Alternatives considered and rejected

Recorded because the session ran under autonomy `act`, where nobody sees the rejected
options live (DR-086 §4).

- **Specifying FR-4 as literally described in the issue's Ask (one toast naming App
  installation alongside secrets/variables).** Rejected on evidence: the credential
  needed to answer the App-installation question does not exist in the Tier-0
  extension and DR-050's one plausible path to it is explicitly unratified. Building a
  spec on the issue's un-verified assumption that this is reachable the same way the
  other two are would repeat the exact "plausible-inference ≠ observation" failure
  this project's Evidence Discipline rule exists to prevent.
- **Treating the unset-but-defaulted variables as reportable failures, matching a
  naive reading of "MinSpec never checked these."** Rejected — the issue's own
  "Important nuance" section already identifies this as a false-positive risk with a
  named cost (a check that cries wolf gets disabled, taking the genuine warning with
  it); FR-3 encodes that nuance as a hard requirement rather than leaving it to the
  implementer's judgment at Plan.
- **Folding `ANTHROPIC_API_KEY` into the newly-reportable "missing" set for
  symmetry with the other three secrets.** Rejected — it is deliberately excluded
  from `REVIEWER_SECRETS` precisely to avoid reopening the #559 deadlock's mirror
  image (`ruleset-advisor.ts:726-733`); reporting it as "missing" would misrepresent
  an optional capability as a defect.

## Traceability

- **Issue:** [#1567](https://github.com/AIClarityAU/minspec/issues/1567) — "MinSpec
  detects an under-configured review harness and never says so (secrets, repo vars,
  App installation)."
- **No silent gate:** [DR-066](../../../docs/decisions/DR-066.md) (constitution
  invariant 2) — this spec's entire premise.
- **Network posture / read-only-config-probe carve-out this spec extends, and the one
  boundary it explicitly declines to cross:**
  [DR-050](../../../docs/decisions/DR-050.md), Amendments 2026-07-01, 2026-07-16
  (extended by FR-2) and 2026-08-25 (proposed, not accepted — cited as evidence, not
  extended or ratified, by FR-4).
- **Offline core:** [DR-004](../../../docs/decisions/DR-004.md) (constitution
  invariant 1).
- **Blast radius:** [DR-074](../../../docs/decisions/DR-074.md) (constitution
  invariant 3) — bounds FR-4's CI-side change.
- **Single-source-of-truth precedent this spec follows (FR-1, FR-6):**
  `REVIEWER_SECRETS` / `reviewer-secrets-enforcement.test.ts`
  (`packages/minspec/src/lib/ruleset-advisor.ts:712-740`,
  `packages/minspec/tests/reviewer-secrets-enforcement.test.ts`); the same discipline
  SPEC-079 FR-1 and SPEC-074 FR-1/INV-3 apply to their own constants.
  [SPEC-078](../SPEC-078-quota-evidence-witness/requirements.md) is the same "one
  producer, one predicate" shape applied to a different evidence marker.
- **Toast-suppression precedent this spec follows (FR-5):**
  `offerRemoteRenameAdvisory` / `RENAME_DECLINED_CONFIG`
  (`packages/minspec/src/commands/init.ts:627-708`) — per-repo git-config flag, not
  `workspaceState`.
- **Existing probe/advisory this spec extends rather than forks (FR-5, DQ-2):**
  `offerRulesetAdvisory` / `resolveWantedChecks`
  (`packages/minspec/src/commands/init.ts:775-1021`).
- **DR for this spec:** none yet, by design — DQ-3 states the exact condition (DQ-1
  resolving to Option B) under which one becomes required before Plan completes.
