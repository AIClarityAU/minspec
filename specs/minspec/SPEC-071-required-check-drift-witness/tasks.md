---
id: SPEC-071
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-071 is T4.)
# status and phases here carry the current phase state. requirements.md stays frozen at its
# approved hash (approval sidecar under .minspec/approvals/), so its own phases lag. This file
# has no approval record of its own: these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
relates_to: [DR-066, DR-074, DR-112, SPEC-054, "#1782", "#3249", "#3433"]
phases:
  specify: done
  clarify: done
  plan: in-progress  # the own-repo landing is planned; the scaffold landing waits on DQ-7's record
  tasks: done
  implement: pending
---

# SPEC-071 - Tasks

The order below is the order of work. Each task is one agent run: one concern, a few files, its
own test. It names the requirement IDs it satisfies, the files it touches, what it needs first,
and what an outside observer checks to call it done. The plan is [design.md](design.md); the
contract is [requirements.md](requirements.md).

Every backticked path in this file is a file this change edits or creates. Files it only reads
are named in prose, so the spec gate's ownership signal stays as narrow as the change.

Group 1 needs nothing and starts now, as an ordinary pull request. Group 2 touches the scripts
folder, so it takes the machinery route and the bot merges it under DR-112 (bot merges of
machinery pull requests). Group 3 touches the workflows folder, which the App cannot push: the
founder pushes it. Group 5 is blocked on a decision record the founder must accept. Each test is
written red first, then made green in the same run, and the run's pull request quotes the red.

## 1 - FR-9, the sanctioned writer stays union-never-remove

- [ ] **1.1** (FR-9, AC union property) `packages/minspec/tests/ruleset-union-property.test.ts`
  (new, owned) - drive the real `updateRulesetRequiredChecks` through a fake runner and capture the
  PUT body. A table plus a small seeded generator, with no new dependency, covers observed sets
  that are empty, single-element and large, additions that are empty, overlapping and disjoint, and
  contexts carrying `integration_id` pins. It asserts: the PUT's context set contains every observed
  context, each pin survives, and no PUT is sent when nothing is missing. It also asserts the advisor
  has exactly one `-X PUT` call site, so a second writer fails here.
  *Needs:* nothing.
  *Done when:* green, and a planted mutant that builds the list from the additions alone fails it.
  Quote that mutant's failure in the pull request.
- [ ] **1.2** (FR-9, AC seed constant) `packages/minspec/src/lib/ruleset-advisor.ts` - extend the
  comment on `DEFAULT_REQUIRED_CHECK_CONTEXTS`: it is a scaffold-time seed only, not the drift
  baseline, and the drift check's expected set is read from the gate manifest. No code change. Add
  a case to `packages/minspec/tests/ruleset-union-property.test.ts` asserting the comment immediately
  above the constant says both.
  *Needs:* nothing.
  *Done when:* green, and the existing ruleset-advisor tests pass unchanged.

## 2 - The checker, offline (machinery route; no workflow yet)

All tests in this group are in `packages/minspec/tests/check-required-checks.test.ts`, so the
tasks run in sequence, not in parallel.

- [ ] **2.1** (FR-2, FR-6, D-3, D-4, INV-5, AC drift, AC #1782 fixture, AC self-demotion)
  `scripts/check-required-checks.ts` (new, owned) - the pure part: `parseBranchRules(raw)`,
  which unions contexts across `required_status_checks` rules and keeps `ruleset_id` and
  `ruleset_source`; `evaluateDrift(required, expected)`, one finding per missing context; and
  `DRIFT_CONTEXT` set to `required-check-drift`. Self-membership calls the exported
  `evaluateWitnesses` from SPEC-054's audit script with `DRIFT_CONTEXT` as `self` and keeps only its
  `not a required context` findings. The own-name-in-the-declaration half is new here. Export a
  pure function that takes the expected set as an argument, so fixtures need no manifest edit.
  Test: memory-fabric's transition is the fixture (expected `MinSpec SDD validation`, `ready-to-merge`,
  `ai-review`; required list only `MinSpec SDD validation`), naming both dropped contexts; two rules
  union; removing the drift context from the list fails and prints the observed list; the file imports
  neither `DEFAULT_REQUIRED_CHECK_CONTEXTS` nor `listRequiredCheckContexts`.
  *Needs:* SPEC-054 task 1.2 (#3433, conflicting at this writing), SPEC-054 task 3.3.
  *Done when:* green.
- [ ] **2.2** (FR-3 a-d, FR-8, FR-10, INV-4, AC read failure, AC zero required, AC no cross-repo)
  same file - `readRequiredContexts(run, repo)` through an injected runner, reading the repo's
  `default_branch` first and that branch's rules second. Test with a fake runner, on both reads: non-zero with no 403/404 gives (a); `HTTP 403` and `HTTP 404` give (b), whose text names
  permission, visibility and rate limit; non-JSON, a non-array and a malformed rule each give (c); all
  exit 2 with distinct text, and none says "zero" or "no drift". `200 []` and a rule with an empty list
  give (d), exit 1. Every recorded call starts `repos/` plus the one repo and uses no write verb.
  *Needs:* 2.1.
  *Done when:* green.
- [ ] **2.3** (FR-5, D-2, AC stopped watcher) same file - `evaluateFreshness(lastSuccessAt, now,
  windowHours)` with the constant `FRESHNESS_WINDOW_HOURS = 24`, plus the read: one call each for
  `event=schedule` and `event=workflow_dispatch`, both with `status=success` on the default branch, newest
  `updated_at` wins. Test: fresh passes; older than the window fails; no run at all reports
  `unknown-and-failing`, never clean; a failed runs read is case (a), exit 2; a dispatch run newer than
  the last scheduled one counts.
  *Needs:* 2.2.
  *Done when:* green.
- [ ] **2.4** (FR-7, FR-8, lane modes, AC actionable finding) same file's IO entry under a main
  guard, and `package.json` script `"audit:required-checks": "npx tsx scripts/check-required-checks.ts"`.
  `--lane=per-change` runs drift, self and freshness; `--lane=out-of-band` runs drift and self; a
  missing or unknown lane is exit 2; `GITHUB_REPOSITORY` unset is exit 2; there is no `--repo` flag.
  The name is `audit:`, not `check:`, because SPEC-054's separation rule keeps networked scripts out of
  that family. Test: out-of-band mode never calls the runs endpoint; both modes exit 1 on the #1782
  fixture; the finding names missing contexts, observed and expected lists, the manifest path, ruleset
  id and source, and says nothing was repaired.
  *Needs:* 2.3.
  *Done when:* green, and a local run with the App token against AIClarityAU/minspec prints the live
  list (quote it; it reports `required-check-drift` absent, which is expected at this stage).

## 3 - The workflow (machinery pull request; founder pushes)

One pull request. An agent prepares the branch; the App has no `workflows` scope.

- [ ] **3.1** (FR-1, FR-4, D-1, D-2, D-6, INV-1) `.github/workflows/required-check-drift.yml` (new,
  owned) as in design.md "The workflow", and one new entry in `scripts/lib/gate-manifest.ts`: context
  `required-check-drift`, its job as the witness, and a `failClosed` entry, because SPEC-054's audit
  treats a lone witness with none as a finding. Cron `41 * * * *`. Keep the two lanes' job ids exact.
  *Needs:* 2.4 and SPEC-054 task 6.1 (until `gate-witnesses` is required, this check reports it as
  drift on every pull request).
  *Done when:* actionlint passes; SPEC-054's freshness test passes with the new entry;
  `required-check-drift` is red on this pull request with exactly two findings, its own context
  not required and freshness `unknown-and-failing`, and no read failure. A 403 means the belief in DQ-2 is wrong for the job token: stop and report, and do not
  widen permissions in the same run.
- [ ] **3.2** (FR-4, INV-1, AC two lanes, AC nothing best-effort) add to
  `packages/minspec/tests/check-required-checks.test.ts`, in the same pull request: parse the workflow
  and assert each lane has its own trigger condition, neither has `needs:` on the other, there is no
  `paths:` filter, no `continue-on-error` and no `|| true`, and `issues: write` appears only on the watch
  job. Run the swallowed-gate-signal scanner over the new files and expect clean.
  *Needs:* 3.1.
  *Done when:* green, and a fixture copy with a lane's condition removed or a `needs:` added fails it.

## 4 - Going live (order matters; see design.md "Landing order")

- [ ] **4.1** (DQ-5, FR-6) **Founder, right after group 3 merges:** add `required-check-drift` to
  `main`'s ruleset through the existing `updateRulesetRequiredChecks` union path, on the host
  (administration write; the App has none). The agent hands over the exact one-line command, with the
  ruleset id read live at hand-over time.
  *Needs:* 3.2 merged.
  *Done when:* the founder reports it ran.
- [ ] **4.2** (FR-4, FR-5, AC detector cannot be demoted) Agent: dispatch `required-check-drift-watch`
  on `main` and confirm success, re-run `required-check-drift` on one open pull request and confirm
  green, then post on #3249 the live required list and both run links, bot-attributed. If dispatch is
  refused, wait for the next scheduled run and report the refused dispatch: design.md's recovery path
  rests on it.
  *Needs:* 4.1.
  *Done when:* both are green and the comment is posted.
- [ ] **4.3** (close-out of the own-repo landing) Add a section to
  `specs/minspec/SPEC-071-required-check-drift-witness/design.md` recording the first month's longest
  schedule gap against the 24-hour window, and widen `FRESHNESS_WINDOW_HOURS` in
  `scripts/check-required-checks.ts` only if that gap came within 25% of it.
  *Needs:* 4.2, plus 30 days of runs.
  *Done when:* the measurement is recorded.

## 5 - Scaffold landing (BLOCKED on the founder's acceptance of its DR)

No task from 5.2 on starts until the decision record in 5.1 is accepted. Requirements.md's DQ-7
requires it. These tasks name the expected files; the DR may change them. Memory-fabric's standing
hold applies on top.

- [ ] **5.1** (DQ-7, DQ-4, DQ-5, FR-10) `docs/decisions/DR-NNN.md`, id from the DR collision gate -
  draft, status `proposed`: scaffold into `.minspec/` repos, adopter status (advisory-but-loud
  recommended, with the asymmetry stated), where an adopter's declaration lives since the gate manifest
  does not ship, and classic protection (R5). Carry measured evidence from 4.2 and 4.3's data so far.
  *Needs:* 4.2.
  *Done when:* the DR is merged as proposed, and the founder has been asked with recommendation and
  cost. Writing it needs no founder time; accepting it does.
- [ ] **5.2** (FR-1, FR-8, INV-2) `packages/minspec/src/lib/template-registry.ts` and the adopter
  declaration the DR names - ship the workflow only where `.minspec/` is at the root, with prose that
  holds in the receiving repo (DR-090). Test: no `.minspec/` means nothing is written; the shipped text
  names no minspec-only path.
  *Needs:* 5.1 ACCEPTED (founder).
  *Done when:* green, and managed-parity tests pass.
- [ ] **5.3** (FR-3 b, FR-10, DQ-5, R5) `scripts/check-required-checks.ts` - the adopter mode the DR
  chose: loud without blocking if advisory, the permission state always printed and never skipped, and
  the zero-required message names classic protection as a possible cause. The asymmetry is documented
  at the scaffold site. Test: each state prints; none is silent.
  *Needs:* 5.2.
  *Done when:* green, and one real adopter run is quoted.

## Coverage

| Requirement | Tasks |
|---|---|
| FR-1 | 2.1, 3.1, 5.2 |
| FR-2 | 2.1 |
| FR-3 | 2.2, 2.3 |
| FR-4 | 3.1, 3.2, 4.2 |
| FR-5 | 2.3, 4.2 |
| FR-6 | 2.1, 4.1 |
| FR-7 | 2.4 |
| FR-8 | 2.2, 2.4, 5.2 |
| FR-9 | 1.1, 1.2 |
| FR-10 | 2.2, 5.3 |
| INV-1 | 3.2 |
| INV-2 | 2.2, 5.2 |
| INV-3 | 1.2 (comment only; no runtime path) |
| INV-4 | 2.2 |
| INV-5 | 2.1 |
| INV-6 | 3.1 (DQ-2's stop rule) |
