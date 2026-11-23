---
id: SPEC-069
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-069 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - same epic as DR-081, the accepted decision this contracts
relates_to: [DR-081, DR-112, SPEC-031, "#1376", "#1654", "#3216", "#3270"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-069 - Tasks

The order below is the order of work. Each task is one pull request, ends with the full
suite green, and names the requirement IDs it satisfies, the files it touches and the test
that proves it. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md), which no task edits.

Every backticked path in this file is a file a task edits or creates. Files a task only
reads are named in prose. Paths not in requirements.md's `implements:`/`affects:` are
listed with their reason in design.md, *Files*.

Shared rules for every task:

- No new hashing code anywhere (FR-4, INV-4). Hashes come from `approval-provenance.py`,
  which calls `canonical.py`.
- No load-bearing write ends in `|| true`, and no error turns into a pass or a skip
  (FR-8, INV-1). Every new check has a negative control in the same test that shows it
  can go red.
- A task that edits `ai-review.yml`, `ready-to-merge.yml`, `ai-review-guard.js` or
  `approval-provenance.py` regenerates `packages/minspec/src/lib/ci-review-templates.ts`
  with `node scripts/gen-ci-templates.mjs`, never by hand, and confirms `--check` passes.
  Neither new file is added to the template registry (D-4, INV-5).
- Run the task's own test, then `npx vitest run`, `node --test .github/scripts/*.test.js`,
  `npm run lint`, `npm run typecheck` and `npm run validate` before calling it done.
- A task that touches `.github/` or `scripts/` is review machinery: its pull request goes
  through the machinery merge path (DR-112), never an ordinary auto-merge.
- Until task 12, nothing here changes how any PR is reviewed or merged. A task whose change
  alters an existing PR's review or `ready-to-merge` result before then is wrong.

## 1 - The changed-set predicate (FR-1, INV-2)

- [ ] **1.1** `.github/scripts/approval-record-pr.js` - `sidecarApprovable` and
  `classifyChangedSet` as design.md, *approval-record-pr.js*, describes, including the
  deleted-sidecar, renamed, unknown-status, truncated and `..` refusals. Node built-ins
  only.
- [ ] **1.2** `.github/scripts/approval-record-pr.test.js` - the `classifyChangedSet` table
  from design.md, *Testing*, written with `node:test`, plus a case that the function
  ignores any `title`, `labels` or `message` property on its input.
- [ ] **1.3** `.github/workflows/ci.yml` - add `node --test .github/scripts/approval-record-pr.test.js`
  beside the line that runs `ai-review-guard.test.js`.
  *Done when:* the new test is green in CI, and a planted third path in the
  "sidecar + own approvable" case turns that case red.

## 2 - Arming, the check decision and the two witnesses (FR-6, FR-7, FR-8, FR-9, FR-10, INV-6)

- [ ] **2.1** `.github/scripts/approval-record-pr.js` - `isIntegrityArmed`,
  `decideIntegrityCheck`, `verifyIntegrityWitness`, `isApprovalRecordExemption`,
  `INTEGRITY_CHECK_NAME`, `EXEMPT_EXTERNAL_ID`.
- [ ] **2.2** `.github/scripts/approval-record-pr.test.js` - `isIntegrityArmed` over recorded
  bodies (the 2026-10-28 `rules/branches/main` body from design.md with and without an
  `approval-integrity` entry; workflow `active` and `disabled_manually`; an error object;
  `null`); `decideIntegrityCheck` for `neutral` (not a set; set but not content-neutral),
  `success`, `failure` per predicate, and indeterminate; each verifier against a wrong
  slug, a wrong SHA, an older success superseded by a newer failure, an in-progress run,
  and, for the exemption, a missing `external_id`.
  *Done when:* green; FR-10's "cannot be armed while advisory" is the not-required case.

## 3 - `approval-provenance.py --gate`: the record and the tree (FR-2, FR-3 parts 1-4, FR-4, FR-8)

- [ ] **3.1** `scripts/approval-provenance.py` - the `--gate <base> <head>` mode and its JSON
  shape from design.md, with strict git helpers that raise, exit codes 0/1/2, and the
  `parse`, `specPathSelf`, `hashMatch`, `approvableExists` predicates and `contentNeutral`.
  The two-argument advisory path is not edited beyond sharing `spec_hash` and `merge_base`.
- [ ] **3.2** `packages/minspec/tests/approval-provenance.test.ts` - gate cases: the #1029
  shape passes; forged hash; malformed JSON; record filed under another path; deleted
  approvable; an approvable body edit gives `contentNeutral: false`; a missing head SHA
  exits 2, not 0. Every existing advisory case is unchanged.
- [ ] **3.3** Regenerate `packages/minspec/src/lib/ci-review-templates.ts`.
  *Done when:* green, and `gen-ci-templates.mjs --check` passes.

## 4 - `--gate`: approver and baseline (FR-3 parts 5-6, D-1)

- [ ] **4.1** `scripts/approval-provenance.py` - `approver_reason(record, base)` reading
  `approvers` from `.minspec/config.json` at the merge base and refusing what
  `_is_agent_identity` refuses; the `baselineBlob` predicate (40 hex must name a blob; empty
  or absent passes). Pass `GITHUB_REPOSITORY` through untouched for the PR #3216 spec.
- [ ] **4.2** `packages/minspec/tests/approval-provenance.test.ts` - an approver in the base
  list passes; a bot, `unknown`, empty, or unlisted approver fails with that reason; a list
  widened at head but not at base still fails; no file or no key at base fails; a 40-hex
  value naming no object fails; `""` passes.
- [ ] **4.3** Regenerate `packages/minspec/src/lib/ci-review-templates.ts`.
  *Done when:* green, and the existing SPEC-231 delegated sidecar fails only `approver`
  (that is the expected result until the PR #3216 spec; see task 10).

## 5 - `approval-integrity.yml`, advisory (FR-3, FR-7, FR-8, D-2, INV-3, INV-5)

- [ ] **5.1** `.github/workflows/approval-integrity.yml` - the `integrity` job, steps 1 to 7
  of design.md, *approval-integrity.yml*. Every `uses:` pinned by SHA. Not added to the
  ruleset.
- [ ] **5.2** `packages/minspec/tests/approval-integrity-workflow.test.ts` - the shape tests
  from design.md, *Testing*: triggers, base checkout, `persist-credentials: false`, pinned
  actions, no load-bearing `|| true`, the `if: failure()` step, no `claude`/`npm ci`/`curl`,
  neither new file in the template registry, no `createHash` in `approval-record-pr.js`.
  *Done when:* green, and on the first approval PR after merge the `approval-integrity`
  check-run appears on the head SHA from `minspec-sdd`, with the label toggled. Record the
  PR number on the build issue (#3270).

## 6 - Cancel the review when a PR closes (FR-12, D-3)

- [ ] **6.1** `.github/workflows/approval-integrity.yml` - the `cancel-review` job, on
  `closed`, job-level group `ai-review-pr-<pr>`, cancel-in-progress, one no-op step.
- [ ] **6.2** `packages/minspec/tests/approval-integrity-workflow.test.ts` - the group text
  equals `ai-review.yml`'s workflow-level group text, so a rename of one fails the test.
  *Done when:* green, and one real PR closed while its `ai-review` run was in progress shows
  that run `cancelled` (link both runs on #3270). If it does not cancel, stop and take the
  fallback in design.md, which needs a D-4 answer before it ships.

## 7 - Guard parameters (FR-5, FR-6, INV-7)

- [ ] **7.1** `.github/scripts/ai-review-guard.js` - `decideStatus` accepts
  `integrityWitness`; `decideReviewCheck` accepts `exemption` and returns `externalId` for
  `'approval-record'`. Both unchanged when the new argument is absent.
- [ ] **7.2** `.github/scripts/ai-review-guard.test.js` - verified witness is green;
  unverified is red; witness plus `ai-review:changes` or a `hold:*` label is red; no witness
  gives today's result for every existing case; INV-7: across every label, machinery,
  carried and exemption combination, `neutral` occurs for exactly machinery and
  approval-record.
- [ ] **7.3** Regenerate `packages/minspec/src/lib/ci-review-templates.ts`.
  *Done when:* green.

## 8 - ready-to-merge takes the integrity witness (FR-6, FR-7, INV-5)

- [ ] **8.1** `.github/workflows/ready-to-merge.yml` - the branch in design.md,
  *ready-to-merge.yml and decideStatus*: only when the module resolves in the base
  checkout; `pulls.listFiles`; both check-run reads with `withRetry`; pass
  `integrityWitness` to `decideStatus`.
- [ ] **8.2** `packages/minspec/tests/approval-integrity-workflow.test.ts` - the branch is
  guarded on the module resolving; and the adopter case from design.md, *Blast radius*: the
  rendered template copy, with no module present, never builds an `integrityWitness`.
- [ ] **8.3** Regenerate `packages/minspec/src/lib/ci-review-templates.ts`.
  *Done when:* green, and on the next approval PR `ready-to-merge` behaves exactly as before
  (no exemption marker exists yet, so the witness cannot verify).

## 9 - ai-review exempts an armed approval record (FR-5, FR-9, FR-11, INV-2)

- [ ] **9.1** `.github/workflows/ai-review.yml` - the `arm` step, the
  `>>> approval-record-exempt` block between the machinery classification and
  `verdict-carry-apply`, `external_id` on the check-run post, and the exempt post path (no
  verdict label, pending removed, explanation comment).
- [ ] **9.2** `packages/minspec/tests/ai-review-approval-exempt-glue.test.ts` - runs the
  marked block verbatim as design.md, *Testing*, describes: zero `run_voter` calls on the
  exempt case; fall-through when not armed, not content-neutral, an extra path, a spec
  content PR (FR-11), `CHANGED_OK=no`, machinery, or the gate script exiting 2.
- [ ] **9.3** Regenerate `packages/minspec/src/lib/ci-review-templates.ts`.
  *Done when:* green, and the `arm` step's log on the next PR shows both reads returned 200
  inside Actions with `armed=no` (the check is not required yet). If either read is refused,
  stop: the design's arm mechanism needs a permission the App does not have, and that is an
  App-permission decision for the founder (SPEC-071 DQ-2 has the same question).

## 10 - Delegated approvers reach the approver check (precondition of task 12)

- [ ] **10.1** Read the state of the delegated-approval spec (PR #3216, delegated approval records reach
  the approval PR gates). Task 12 may start only when its approver extension has merged into
  `approver_reason`, or when no delegated approval has merged for 14 days. Record which
  on #3270. No code in this task.

## 11 - The advisory count (FR-10 step 2, D-5)

- [ ] **11.1** After task 9 merges, for each approval-record PR in merge order, note on
  #3270: PR number, head SHA, `approval-integrity` conclusion and failing predicate,
  the panel's verdict. They agree when integrity `success` meets panel `pass`, or integrity
  `failure` meets a panel finding on the same record. An integrity failure on `approver` for
  a delegated record, before task 10 is satisfied, is not counted either way. Any other
  disagreement resets the count and gets an RCDD issue with `inbox`.
  *Done when:* 5 consecutive agreements are recorded.

## 12 - Arm it: the ruleset act (FR-10 step 2 and 3) - founder only

- [ ] **12.1** Agent: put the exact command to the founder that adds `approval-integrity` to
  ruleset 18352261's required checks as a union with the current set (lint, test, MinSpec SDD
  validation, ai-review, ready-to-merge, build at 2026-10-28), never a retyped replacement.
  The App holds no administration write, so this is his act.
- [ ] **12.2** Founder: run it.
- [ ] **12.3** Agent: on the first approval-record PR afterwards, record on #3270 that the
  `arm` step read `armed=yes`, no voter started, `ai-review` is `neutral` with the
  exemption `external_id`, and `ready-to-merge` went green without `--admin`. That closes
  the acceptance criteria "Zero voters", "Still mergeable without `--admin`" and
  "Ordering enforced". Rollback at any point: remove the context from the ruleset.
