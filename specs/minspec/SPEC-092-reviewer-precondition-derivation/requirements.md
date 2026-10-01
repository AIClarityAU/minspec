---
id: SPEC-092
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-009  # Team Readiness - same epic as SPEC-034 (the broker) and SPEC-033 (the provisioning this probe feeds)
aspects: [reviewer, provenance, required-checks, rulesets, probe, secrets, broker, drift, silent-gate, contract-test]
depends_on: [DR-050, DR-054, DR-066]
relates_to: [SPEC-034, SPEC-033, SPEC-071, SPEC-054, DR-033, DR-074, "#826", "#796", "#819", "#559", "#564"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1/FR-2; the shipped
# `/minspec-specify` guidance) - `implements:` is inside the canonical hash, so adding it after
# approval would stale the sign-off. Three files, required under every DQ answer below:
#   - reviewer-preconditions.ts      NEW   the precondition model + the derivation (FR-2..FR-5)
#   - reviewer-preconditions.test.ts NEW   the agreement table + three-valued verdict (FR-3, FR-6)
#   - reviewer-secrets-enforcement.test.ts EXISTS (landed by #819), listed under no spec's
#     `implements:` or `affects:` (grepped `reviewer-secrets-enforcement` across specs/ - zero
#     hits). FR-1 rewrites what it binds, so this spec takes it rather than leaving it unowned.
implements: [packages/minspec/src/lib/reviewer-preconditions.ts, packages/minspec/tests/reviewer-preconditions.test.ts, packages/minspec/tests/reviewer-secrets-enforcement.test.ts]
# Modified, not owned. ruleset-advisor.ts is in no spec's `implements:` (SPEC-063 and SPEC-071
# list it under `affects:`, which is shareable). ai-review.yml is owned by SPEC-031; this spec
# touches it only if DQ-1 resolves to a declared-preconditions block, and then in step with
# SPEC-034's own edit of the same guard.
affects: [packages/minspec/src/lib/ruleset-advisor.ts, packages/minspec/src/commands/init.ts, packages/minspec/src/lib/ci-review-templates.ts, .github/workflows/ai-review.yml, packages/minspec/tests/ruleset-advisor.test.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-092: The reviewer-configured probe derives its preconditions from the workflow, never from a frozen list

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, checks **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves through
> the normal spec-approval gate. Every capability below is *specified, not built*.
>
> Materializes **[#826](https://github.com/AIClarityAU/minspec/issues/826)** - "de-freeze
> `REVIEWER_SECRETS` when the OIDC/App-token broker lands", parked from the #796
> reviewer-secret enforcement work (pull request #819) as a watch item on
> [SPEC-034](../SPEC-034-oidc-review-broker/requirements.md) (the OIDC review token-broker).

## One-Sentence Scope

Replace the hand-maintained three-name tuple that decides whether `ai-review` may become a
required check with a derivation from the reviewer workflow's own guard and mint-path
selection, bind the two by a contract test that goes red the moment the guard changes shape,
and stop collapsing "could not tell" into "not configured" - so that when SPEC-034 (the OIDC
review token-broker) makes the per-repo App secrets optional, a working broker repo is not
silently left with no independent-review gate.

## Context

### The decision this probe makes, and which way it fails

`probeReviewerConfigured` (`packages/minspec/src/lib/ruleset-advisor.ts:768-791`) answers one
question: can this repo produce an `ai-review` check at all? `resolveWantedChecks`
(`packages/minspec/src/commands/init.ts:790-794`) feeds the answer into
`resolveTieredRequiredChecks`, which adds `ready-to-merge` and `ai-review` to the wanted
required-check set only when it is true (`ruleset-advisor.ts:431-432`).

The two wrong answers are not equally bad:

| wrong answer | consequence | visible? |
|---|---|---|
| "configured" when the repo cannot post the check | `ai-review` is required and never posted - every merge blocks (the #559 permanent-pending deadlock) | yes - red on every pull request |
| "not configured" when the repo posts the check fine | `ai-review` is never offered as required - the provenance gate is **absent**, and merges are auto-eligible with no independent review | **no** - nothing is red, nothing is said |

Everything in the current code is tuned against the first row. Every failure path returns
`false` (`ruleset-advisor.ts:779`, `:783-786`), described in the source as "fail-safe". It is
fail-safe against a deadlock and fail-**open** against an absent gate, and it is silent in
both directions. Constitution invariant 2 (no silent gate; DR-066) says a missing or errored
witness "fails the gate closed and visibly (never silently passes or stops evaluating)". A
probe error that quietly removes a merge gate from the offer is the "stops evaluating" case.

### What is frozen today

`REVIEWER_SECRETS` is a literal three-name tuple (`ruleset-advisor.ts:712-716`):
`CLAUDE_CODE_OAUTH_TOKEN`, `MINSPEC_APP_ID`, `MINSPEC_APP_PRIVATE_KEY`. The probe requires
all three (`:790`). That is correct for the workflow as it ships today: the guard step skips
the whole run unless all three are non-empty (`.github/workflows/ai-review.yml:172-185`), and
the only mint path is the native `actions/create-github-app-token` step (`:189-195`).

### What SPEC-034 changes

SPEC-034 (the OIDC review token-broker) is approved for implementation
(`.minspec/approvals/specs/minspec/SPEC-034-oidc-review-broker/requirements.md.json`,
`approvedAt` 2026-09-30) and partly built: `packages/broker/src/` holds the Worker; the
workflow half is task 1.4b, not started
(`specs/minspec/SPEC-034-oidc-review-broker/tasks.md:32`). When that half lands:

- **FR-11 (default shipped identity)** - "a fresh repo works with only the App-install
  grant - no per-repo variable" (`SPEC-034 requirements.md:142-145`). The per-repo
  `MINSPEC_APP_ID` / `MINSPEC_APP_PRIVATE_KEY` are no longer needed on the default path.
- **FR-10 / OQ-4 (enterprise override)** - the workflow "selects the native path when a
  customer app-id secret + `AI_REVIEW_BOT_LOGINS` are configured, else falls back to the
  shared-App broker" (`SPEC-034 requirements.md:252-257`).

So after SPEC-034 the reviewer is producible by **either of two mint paths**, and which one
is active in a given repo is decided at run time by which names are present in that repo. A
single flat list of always-required names cannot express that. With the tuple left as it is,
a repo on the broker default path has `CLAUDE_CODE_OAUTH_TOKEN` and no App secrets, the probe
returns `false`, and row two of the table above is the result - on exactly the repos the
broker exists to serve.

### Why the existing contract test would not catch it

The enforcement test added by pull request #819
(`packages/minspec/tests/reviewer-secrets-enforcement.test.ts`) is the guard #826 is worried
about, and reading it confirms the worry:

- Its binding assertion compares the names the workflow **references** - every
  `secrets.<NAME>` match in the file (`:51-53`) - against the two constants joined together
  (`:70`, `:76`). After SPEC-034 the workflow still references `MINSPEC_APP_ID` and
  `MINSPEC_APP_PRIVATE_KEY` (the override path consumes them), so the referenced set does
  not change and the assertion stays green with the tuple untouched.
- Whether a referenced name is **gating** or **optional** is not derived from anything. It
  is a hand classification: the source says adding a name to the optional list "is the
  explicit claim 'the reviewer works without it'" (`ruleset-advisor.ts:737-738`). Nothing
  reads the guard step to check that claim.
- The "whole set" property (`:104-112`, and its twin at
  `packages/minspec/tests/ruleset-advisor.test.ts:1034-1041`) compares the probe to the
  constant the probe itself reads. It is true for any value of the constant.

**Reference is the axis the test measures; gating is the axis the decision depends on.** The
test was built to stop the #796 two-of-three bug (a name the guard requires but the probe
forgot), and it does. It cannot see a name the guard has *stopped* requiring.

### Three further gaps the same review surfaced

These are the same defect class (a precondition the probe assumes instead of observes) and
are the reason a "move two names to the optional list" patch would be wrong:

1. **Version skew between the extension and the repo.** The probe runs inside the installed
   extension against whatever `ai-review.yml` the repo has. `resolveWantedChecks` only checks
   that the file **exists** (`init.ts:781-782`, `:792`). A repo scaffolded before the broker
   change still carries the three-secret guard; a newer extension that has relaxed its list
   would report it "configured" on the inference credential alone, require `ai-review`, and
   deadlock it - the #559 failure, re-opened from the other side. The required set is a
   property of the workflow file in the repo, not of the extension build.
2. **The broker path has a precondition that is not a secret.** SPEC-034 FR-4 (app
   installation precondition) makes the broker refuse a repo where the `minspec-sdd` App is
   not installed. A secret-names read cannot see that. I believe, unverified, that
   `GET /repos/{owner}/{repo}/installation` is callable only with an App JWT and so is not
   available to the user's own `gh` token - which would make the installation state
   unobservable from where the probe runs. That must be confirmed live at Clarify or Plan
   (DQ-3).
3. **Path selection reads a variable, not only secrets.** The override is selected by the
   app-id secret *and* the `AI_REVIEW_BOT_LOGINS` Actions variable
   (`.github/workflows/ready-to-merge.yml:161` reads it today, defaulting to
   `minspec-sdd[bot]`). The probe reads secret names only. A probe that mirrors the selection
   predicate needs the variable's presence, or must say plainly that it could not evaluate
   that term.

A fourth is live **today**, independent of SPEC-034, and is put to the human as DQ-4 rather
than assumed in scope: the probe reads `repos/{owner}/{repo}/actions/secrets`
(`ruleset-advisor.ts:773-778`). I believe, unverified live, that this endpoint lists
repository-level secrets only and that organization secrets shared with the repo are listed
by a separate endpoint - in which case a repo whose reviewer credentials are set at the
organization level reads "not configured" now. SPEC-034 FR-10 explicitly allows the override
credentials to be a "repo/org secret" (`SPEC-034 requirements.md:138`).

### Why this is a spec and not a checklist line

#826 asks for this to be folded into SPEC-034 as a blocking checklist item rather than run
as standalone work. The dependency is honoured (FR-9 below, and the pointer added to
SPEC-034's task list in the same change). The requirements themselves are recorded here
because SPEC-034's `requirements.md` was approved on 2026-09-30 and is hash-locked: adding
functional requirements to it would stale a sign-off the founder gave the day before this was
written. See DQ-6.

## Functional Requirements

- **FR-1 - The gating set is derived from the guard and bound by a test that can land now.**
  A contract test derives, from the shipped `ai-review.yml`, the names whose absence makes
  the workflow skip without posting an `ai-review` check - the *gating* set, as distinct from
  the *referenced* set - and asserts that the probe requires exactly that set on every path.
  The test MUST go red, not skip, when the guard step is missing, renamed, or has a shape the
  derivation does not recognise. This requirement has no dependency on SPEC-034: against
  today's three-name guard it passes, and it is what turns #826 from a note someone must
  remember into a failing check on the pull request that changes the guard.

- **FR-2 - Preconditions are modelled as alternative paths, not one flat list.** A single
  module expresses reviewer producibility as a set of named mint paths. Each path lists the
  secret names it needs and any named precondition that is not a secret (an installed App, a
  set variable). The reviewer is producible when the credentials common to every path are
  present and at least one path is fully satisfied. The probe's required names come from this
  model and from nowhere else.

- **FR-3 - Path selection in the probe agrees with path selection in the workflow.** For
  every combination of present and absent names the workflow's selection logic can
  distinguish, the probe's verdict equals what the workflow would do: post an `ai-review`
  check, or not. This is asserted as an exhaustive table over the combinations (the space is
  small - a handful of names), not as chosen examples. The half-configured override is a
  named row: an app-id with no private key, or the reverse, MUST NOT read as configured, and
  MUST NOT silently read as "broker path" unless the workflow itself falls back that way.

- **FR-4 - The derivation reads the workflow file in the repo being probed.** The required
  set for a repo comes from that repo's own `.github/workflows/ai-review.yml` on disk, not
  from the copy embedded in the extension (`AI_REVIEW_WORKFLOW`,
  `packages/minspec/src/lib/ci-review-templates.ts:36`). An older three-secret workflow is
  probed against three names; a broker-era workflow against the broker-era model. This is a
  local file read and adds no network call.

- **FR-5 - A workflow the derivation cannot read yields "unknown", never a guess.** A
  missing guard, a hand-edited guard, an unparseable file, or a workflow newer than the
  extension understands produces an explicit *unknown* verdict carrying the reason. It MUST
  NOT fall back to the embedded copy's model, to a built-in default list, or to `false`.

- **FR-6 - The verdict is three-valued and the values are never collapsed.** The probe
  returns one of *configured*, *not configured*, or *unknown*, each with a machine-readable
  reason. *Not configured* is reserved for an observation: the names were read and a
  required one is absent. A failed `gh` call, a non-zero exit, unparseable output
  (`ruleset-advisor.ts:779-786` today), an unrecognised workflow (FR-5), and a precondition
  the probe has no means to observe are all *unknown*. Each cause is distinguishable from
  the others in the reason.

- **FR-7 - "Unknown" is shown to the user and never silently drops the gate.** When the
  verdict is *unknown*, the init and refresh advisory says so in the one existing offer -
  naming what could not be determined and what the user can check - instead of omitting
  `ai-review` and `ready-to-merge` from the offer without comment. Whether *unknown* then
  defaults to offering the checks or to withholding them is DQ-2; under either answer the
  state is stated, and the fully-configured, nothing-to-do case stays silent as it is today.

- **FR-8 - Both shipped copies are bound, and the existing properties survive.** FR-1 holds
  for the repo's own workflow and for the embedded copy the extension scaffolds into other
  repos. The properties the #819 test already pins are kept: no `secrets.<NAME>` reference
  may appear in either copy without being declared; the optional set (today
  `ANTHROPIC_API_KEY`, `ruleset-advisor.ts:740`) stays disjoint from every path's required
  set; and omitting any one required name of a path makes that path unsatisfied.

- **FR-9 - SPEC-034 cannot ship its workflow change past this.** The change that alters the
  guard or mint path in the scaffolded `ai-review.yml` (SPEC-034 task 1.4b, and tasks 4.1
  and 5.1 after it) lands with the FR-1 test green against the new guard, which requires
  FR-2 and FR-3 to be in place for the paths that change introduces. SPEC-034's task list
  carries a blocking item pointing here, so the dependency is visible from the place the
  implementer is working, and SPEC-034 AC-10's override secret names are the names the
  override path in FR-2 lists.

- **FR-10 - No second enumeration is left behind.** Once the model in FR-2 exists,
  `REVIEWER_SECRETS` is either removed or computed from it; it is not kept as a second
  hand-edited list. Prose that restates the three names as the probe's contract - the doc
  comments at `ruleset-advisor.ts:697-711` and `:743-767`, and DR-050's Amendment 2026-07-16,
  which "enumerates the **full** reviewer-secret set" by name - is updated or annotated in
  the same change so no signpost keeps describing the frozen tuple (see Follow-ups).

- **FR-11 - Names only, as now.** The probe continues to read secret **names** and never
  values. If DQ-3 or DQ-4 adds a read (variable presence, organization-secret names), it
  reads presence or names only, through the user's own `gh`, and the extension opens no
  socket.

## Invariants (must not break)

- **INV-1 - Offline core (constitution invariant 1; DR-050).** The derivation in FR-4 and
  FR-5 is a local file read. The only network reads are read-only probes of the repo's own
  configuration through the user's authenticated `gh`, in the class DR-050 Amendments
  2026-07-01 and 2026-07-16 authorise. **A read of a new endpoint is not covered by those
  amendments**, which enumerate their endpoints; it needs its own amendment accepted before
  implementation (DQ-3, DQ-4, DQ-5).
- **INV-2 - No silent gate (constitution invariant 2; DR-066).** No path in this feature
  turns a failed or impossible observation into a quiet "not configured". No swallowed
  error, no default-to-false on the verdict path.
- **INV-3 - Blast radius (constitution invariant 3; DR-074).** The probe reads only the repo
  it was invoked in. No organization-wide enumeration; an organization-secrets read, if DQ-4
  admits one, is the per-repo listing of secrets shared with *this* repo.
- **INV-4 - Detection never mutates.** Nothing here writes a ruleset. Adding a check stays
  behind the user's explicit click (DR-050), and an existing required check is never removed
  because a probe verdict changed - `updateRulesetRequiredChecks` only adds
  (`ruleset-advisor.ts:855-868`), and SPEC-071 FR-9 (union-never-remove property test) pins
  that.
- **INV-5 - The #559 guard is not traded away.** A repo that demonstrably cannot post
  `ai-review` (an observed-absent required name) is still never offered it as required. This
  spec narrows what counts as an observation; it does not relax the rule.
- **INV-6 - SPEC-034's provenance model is untouched.** Nothing here changes who may apply
  `ai-review:pass`, the `AI_REVIEW_BOT_LOGINS` allowlist, or `ai-review-guard.js`
  (SPEC-034 FR-8, DR-033 §6). This spec decides only whether the check is *offered as
  required*.
- **INV-7 - No credential value enters the tree, a log, a toast, or a test fixture.** Names
  only; fixtures use the real names with no values (the #819 test already works this way).

## Acceptance Criteria

- [ ] **The tripwire fires on a guard change** - with the guard step in a fixture copy of
      `ai-review.yml` edited to stop requiring `MINSPEC_APP_ID` and
      `MINSPEC_APP_PRIVATE_KEY`, and the probe unchanged, the FR-1 test fails and names the
      two names. The same fixture passes today's reference-only assertion, demonstrating the
      gap this closes. (FR-1)
- [ ] **An unrecognised guard is red, not skipped** - a fixture with the guard step removed
      or renamed fails FR-1 with a message saying the guard could not be located. (FR-1)
- [ ] **Broker-path repo reads configured** - given a broker-era workflow and a repo holding
      the inference credential and no App secrets, with every observable broker precondition
      met, the verdict is *configured*. This is #826's headline scenario. (FR-2, FR-3)
- [ ] **Override-path repo reads configured** - given the same workflow and the override
      names from SPEC-034 AC-10 present, the verdict is *configured* by the override path.
      (FR-2, FR-3, FR-9)
- [ ] **Half-configured override does not read configured** - app-id without private key,
      and private key without app-id, each produce the verdict the workflow's own behaviour
      implies, with the half-configured state named in the reason. (FR-3)
- [ ] **Agreement is exhaustive** - a table-driven test covers every presence/absence
      combination of the names the selection logic reads, for each supported workflow
      generation, and asserts probe verdict equals workflow outcome. (FR-3)
- [ ] **Old workflow, new extension** - a repo carrying today's three-secret workflow and
      only the inference credential reads *not configured*, regardless of the extension's
      embedded copy. (FR-4, INV-5)
- [ ] **Unreadable workflow is unknown** - a hand-edited or truncated workflow yields
      *unknown* with a reason, and neither Tier-A check is silently added or silently
      dropped. (FR-5, FR-7)
- [ ] **A failed read is not "not configured"** - `gh` exiting non-zero, `gh` missing, and
      unparseable output each yield *unknown* with a distinct reason; none yields *not
      configured*. (FR-6, INV-2)
- [ ] **Unknown is visible** - with an *unknown* verdict the advisory text states what could
      not be determined; a test asserts the text, not just the return value. With
      *configured* and nothing missing, the flow is silent as before. (FR-7)
- [ ] **Both copies bound; declared-only references kept** - FR-1 passes against the repo
      workflow and the embedded copy; an undeclared `secrets.<NAME>` in either fails. (FR-8)
- [ ] **Optional stays optional** - a repo with a satisfied path and no `ANTHROPIC_API_KEY`
      reads *configured*. (FR-8)
- [ ] **No leftover list** - no hand-maintained array of required reviewer secret names
      exists outside the FR-2 model; a grep-level assertion or review confirms it, and the
      doc comments and DR-050 note in FR-10 are updated. (FR-10)
- [ ] **SPEC-034 carries the pointer** - `specs/minspec/SPEC-034-oidc-review-broker/tasks.md`
      has an unticked blocking item referencing this spec and #826. (FR-9)
- [ ] **Names only** - no code path requests, logs, or displays a secret value; a test
      asserts the probe's `gh` arguments contain no value-returning call. (FR-11, INV-7)

## Decisions needed (Clarify)

Each names a recommendation and what the recommendation costs.

- **DQ-1 - How is the gating set derived from the workflow?**
  - **(A) Parse the guard step.** Read the guard's `env:` map and its emptiness test.
    *Cost:* it is a shell-in-YAML parse; a legitimate refactor of the guard breaks the
    derivation and reads as *unknown* until the parser is taught the new shape.
  - **(B) A declared preconditions block in the workflow, bound to the guard by test -
    recommended (rec).** The workflow carries a small machine-readable declaration of its
    mint paths and their required names; the extension reads the declaration from the repo's
    file (FR-4); MinSpec's own CI asserts declaration and guard agree for the shipped copies
    (FR-1). *Cost:* in an adopter's repo the declaration is trusted, not re-verified - an
    adopter who hand-edits the guard without the declaration gets a wrong verdict, and it
    adds a managed block to a workflow SPEC-031 owns, edited in the same window as
    SPEC-034's task 1.4b.
  - **(C) A table in the extension keyed by workflow generation.** Recognise the scaffolded
    file by a version marker and look the paths up. *Cost:* a third place to update on every
    guard change, which is the enumeration this spec exists to remove; rejected unless (A)
    and (B) both prove unworkable in Plan.

- **DQ-2 - What does an *unknown* verdict do to the offer?**
  - **(A) Offer the checks, with the uncertainty stated - recommended (rec).** The user's
    click decides, having been told what could not be confirmed. *Cost:* a user who accepts
    on a repo that genuinely cannot post the check deadlocks their merges until they fix the
    reviewer or remove the check. That is a visible, recoverable red - but it is the #559
    experience, now reachable by one click.
  - **(B) Withhold the checks, with the uncertainty stated.** Keeps today's deadlock-averse
    default and adds the visibility. *Cost:* the gate is still absent after a flaky read,
    and a notice is easier to dismiss than a red check; the dangerous row of the table in
    Context stays the default outcome.
  - **(C) Keep today's silent `false`.** *Cost:* leaves the invariant-2 gap in place. Not
    recommended; listed so that rejecting it is a recorded decision.

- **DQ-3 - Broker-path preconditions the probe may not be able to see.** The `minspec-sdd`
  App being installed on the repo (SPEC-034 FR-4) and the `AI_REVIEW_BOT_LOGINS` variable
  both bear on which path runs and whether it works.
  - **(A) Treat an unobservable precondition as *unknown* and let DQ-2 govern -
    recommended (rec).** No new endpoint, no DR-050 amendment. *Cost:* every broker-path repo
    lands in *unknown* at init, so the "stated uncertainty" variant of the offer becomes the
    common case on the default path rather than the exception, which rubs against the
    constitution's "avoid nagging" principle.
  - **(B) Add read-only probes for the variable's presence and, if a user-token endpoint
    exists, the installation.** *Cost:* each is a new autonomous network read, needing a
    DR-050 amendment accepted first (INV-1); the installation read may not be possible with
    a user token at all (unverified - see Context).
  - **(C) Use the workflow's own output as the witness: has an `ai-review` check-run ever
    been posted on this repo.** The strongest evidence of producibility, and independent of
    how the token was minted. *Cost:* a new endpoint class (check-runs) needing a DR-050
    amendment, and it says nothing on a fresh repo with no pull requests yet. Worth
    recording as the second, independent witness invariant 2 asks for, as a later addition.

- **DQ-4 - Include organization-level secrets in the names read?** If the unverified belief
  in Context holds, an organization-secret repo reads "not configured" today.
  - **(A) Include it in this spec - recommended (rec).** Same function, same failure
    direction, same test. *Cost:* one more endpoint for DR-050 to enumerate (names only,
    still the repo's own configuration), and the spec stops being purely "when SPEC-034
    lands" - part of it becomes worth building now.
  - **(B) Split it out as its own issue.** *Cost:* a live instance of the absent-gate
    failure waits on a separate queue, and I could not file that issue from this dispatch
    (no network), so it would exist only as this paragraph until a human files it.
  - ➡️ Either way, confirm the endpoint behaviour live before deciding; the premise is
    marked unverified.

- **DQ-5 - Does this need a DR?** None is minted here. *Recommendation:* **no new DR; a
  DR-050 amendment if and only if DQ-3 (B/C) or DQ-4 (A) adds an endpoint (rec).** *Cost:*
  the three-valued verdict and the "unknown offers the check" default (DQ-2 A) change what
  MinSpec proposes in every adopter's repo without a decision record of their own - they
  are recorded only in this spec. Both are reversible in under a day (a default in one
  function), which is why the ADR filter does not require one.

- **DQ-6 - Separate spec, or amend SPEC-034?** #826 asked for a checklist item on SPEC-034.
  *Recommendation:* **keep this spec, plus the pointer in SPEC-034's task list (rec).**
  *Cost:* two specs describing one seam, and the dependency is enforced by the FR-1 test and
  a task-list line rather than by SPEC-034's own acceptance criteria - if the test were
  deleted, nothing in SPEC-034's approved text would object. The alternative is to edit
  SPEC-034's requirements, which stales the approval recorded on 2026-09-30.

- **DQ-7 - Build order.** FR-1 has no dependency on the broker.
  *Recommendation:* **land FR-1 and FR-6/FR-7 now, and FR-2 to FR-5 with SPEC-034's
  workflow change (rec).** *Cost:* the first landing rewrites a test and a return type for a
  behaviour change nobody can observe until the broker ships, and the three-valued verdict
  touches `init.ts` callers twice - once now, once when paths arrive.

## Out of Scope

- **The broker, the workflow's mint steps, and the override wiring** - SPEC-034. This spec
  constrains what the probe must agree with; it does not design the workflow change.
- **Whether a half-configured override should fall back to the broker or fail** - a
  SPEC-034 workflow behaviour. FR-3 requires the probe to agree with whichever is built.
- **`approve-on-label.yml`**, which also consumes `MINSPEC_APP_ID` and
  `MINSPEC_APP_PRIVATE_KEY` (`.github/workflows/approve-on-label.yml:70-71`, `:146-149`). It
  is not in the scaffolded review stack (`ci-review-templates.ts` exports no such workflow)
  and posts no required check, so it does not bear on this probe. How it mints a token on a
  broker-path repo is unaddressed anywhere I found and is noted here so it is not lost.
- **Detecting that a required check was later removed** - SPEC-071 (required-check drift
  witness).
- **Tier-B code checks** (`lint` / `test` / `build`) and their producibility detection.
- **Environment-scoped secrets.** The scaffolded workflow declares no `environment:`, so
  they cannot satisfy its guard.

## Security Review Notes

Written under the security role; this is a review of the *design*, since there is no code
diff to review.

| Concern | Assessment |
|---|---|
| Security misconfiguration by default (OWASP A05) | The core finding. Today's failure default removes a merge gate silently. FR-6/FR-7 and DQ-2 address it. |
| Software and data integrity (OWASP A08) | `ai-review` is the provenance gate DR-033 §6 relies on. A probe that under-reports leaves auto-merge eligible without independent review - the WRONG-MERGE class #826 names. |
| Secret exposure | The probe reads names only (DR-050 Amendment 2026-07-16). FR-11 and INV-7 keep it that way; any added read is presence-only. No secret value appears in this spec or its diff. |
| Trusting attacker-influenced input | FR-4 reads a workflow file from the working tree. A contributor who can edit that file can already disable the reviewer outright, so the derivation grants nothing new; but DQ-1 (B)'s declared block must never be able to make the verdict *more* permissive than the guard for the shipped copies - which is what the FR-1 binding asserts. |
| Confused selection | A probe that says "broker path" while the workflow takes the override (or the reverse) mis-states which identity will post. FR-3's exhaustive agreement table is the control. |
| New dependencies | None proposed. Derivation is string/YAML handling inside the extension; if Plan wants a YAML parser, that is a dependency decision to make there, with `npm audit` reviewed. |

## Alternatives considered and rejected

Recorded because this session ran under autonomy `act` (DR-086 §4).

- **Move the two App names from `REVIEWER_SECRETS` to `REVIEWER_OPTIONAL_SECRETS` when the
  broker lands.** Rejected. It passes the existing test and is wrong three ways: an older
  three-secret workflow would read configured and deadlock (gap 1), a half-configured
  override would read configured, and a broker repo without the App installed would read
  configured. It swaps one frozen list for another.
- **Amend SPEC-034 with these requirements.** Rejected - DQ-6. It stales an approval given
  the previous day.
- **Leave it as a watch item until SPEC-034's workflow half is written.** Rejected. A watch
  item is a rule someone must remember (constitution principle 8). FR-1 is buildable today
  and converts the reminder into a failing test.
- **Derive from the extension's embedded workflow copy.** Rejected - FR-4. The embedded copy
  describes what the extension would scaffold, not what the repo runs.
- **Flip every failure to `true`.** Rejected. It re-opens #559 wholesale and is just as
  silent; the defect is the collapse to two values, not which of the two is chosen.
- **Tier T3.** Rejected for the specify pass. The change alters which merge gates MinSpec
  proposes in other people's repositories and may add a network read; the tier is an
  upward-only floor.

## Follow-ups (tracked)

- SPEC-034 task-list pointer - added in this change
  (`specs/minspec/SPEC-034-oidc-review-broker/tasks.md`, item 6.4).
- DR-050 amendment for any added endpoint - conditional on DQ-3 / DQ-4; **not filed**, to be
  raised at Clarify if either resolves that way.
- DR-050 Amendment 2026-07-16 names the three secrets as the probe's full set; it needs a
  dated note when FR-10 lands. Tracked by FR-10 and its acceptance criterion; no separate
  issue.
- Organization-secret visibility (DQ-4) and `approve-on-label.yml` on a broker-path repo
  (Out of Scope) have **no issue filed** - this dispatch had no network access. They exist
  only in this document until a human files them or DQ-4 folds the first one in.

## Traceability

- **Issue:** [#826](https://github.com/AIClarityAU/minspec/issues/826) - de-freeze
  `REVIEWER_SECRETS` when the broker lands.
- **Origin:** #796 (reviewer-secret enforcement; the two-of-three probe bug) and pull request
  #819 (the enforcement test this spec rewrites); #559 (the permanent-pending deadlock the
  probe was built against); #564 (the tiered required-check resolver).
- **Blocks:** [SPEC-034](../SPEC-034-oidc-review-broker/requirements.md) (OIDC review
  token-broker) tasks 1.4b, 4.1, 5.1.
- **Consumer:** [SPEC-033](../SPEC-033-repo-governance-provisioning/requirements.md) (repo
  governance provisioning) FR-3 - the ruleset offer this verdict feeds.
- **Sibling:** [SPEC-071](../SPEC-071-required-check-drift-witness/requirements.md)
  (required-check drift witness) - catches a gate removed after it was required; this spec
  covers a gate never offered.
- **Decisions:** [DR-050](../../../docs/decisions/DR-050.md) (read-only config probes are
  autonomous; Amendment 2026-07-16 authorises the secret-names read),
  [DR-054](../../../docs/decisions/DR-054.md) §4 (shared App plus broker; customer-own-app
  override), [DR-066](../../../docs/decisions/DR-066.md) (no silent gate),
  [DR-033](../../../docs/decisions/DR-033.md) §6 (provenance guard),
  [DR-074](../../../docs/decisions/DR-074.md) (blast radius).
- **Spec id:** SPEC-092 was taken as one above the highest id visible on disk (number 086) or
  on any locally-known remote branch (number 091). Remote refs were not refreshed by this
  dispatch, so a newer in-flight claim is possible; a duplicate id is the case to check at
  review.
