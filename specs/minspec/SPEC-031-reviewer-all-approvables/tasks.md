---
id: SPEC-031
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-031 is T3.)
# status and phases here carry the current phase state. requirements.md stays frozen at its
# approved hash (approval sidecar under .minspec/approvals/), so its own phases lag. This file
# has no approval record of its own: these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-010  # Reviewer Across All Approvables
relates_to: [DR-047, DR-063, SPEC-012, SPEC-038, SPEC-054, "#527", "#528", "#529", "#530", "#330", "#453"]
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: pending
---

# SPEC-031 - Tasks

The order below is the order of work. Each task is one agent run: one concern, a few files,
its own test. It names the requirement IDs it satisfies, the files it touches, and what an
outside observer checks to call it done. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md).

Every backticked path in this file is a file this change edits or creates. Files it only reads
are named in prose, so the spec gate's ownership signal stays as narrow as the change.

**Regeneration rule.** `ai-review-guard.js`, its test, `review-approvable.sh`, `review-pr.sh`,
`approvable-reviewer.md` and the workflows are adopter templates. Any task that edits one
re-runs the template generator (scripts/gen-ci-templates.mjs) in the same run so
`packages/minspec/src/lib/ci-review-templates.ts` matches, and its done-condition includes the
generator's `--check` mode and the managed-region parity tests.

Groups 1 to 7 are agent-landable (groups 2, 4, 5, 6 and 7 are machinery pull requests under
the existing bot-merge rules). Group 8 touches `.github/workflows/**`, which the App cannot
push (no `workflows` scope): an agent prepares the branch, the founder pushes it. Each test
task is written red first, then made green in the same run, and the run's pull request quotes
the red. A guard over behaviour that already holds (group 1) cannot start red: its pull request
quotes a local mutation that turns it red instead.

## 1 - T0 invariant guards

- [ ] **1.1** (INV-1, INV-2) `packages/minspec/tests/spec-031-invariants.test.ts` (new).
  `describe('INV-2 no approve label')`: no file under `scripts/`, `.github/` or
  `packages/*/src` contains the literal `ai-approved`. `describe('INV-1 fresh context')`: every
  `claude -p` launch line in `scripts/review-approvable.sh` and `scripts/review-pr.sh` carries a
  role system prompt and none carries `--resume`, `--continue` or `--session-id`.
  `describe('INV-2 text-only reviewer')`: the `## File allowlist` section of
  `scripts/roles/approvable-reviewer.md` says `None`. INV-7 is already guarded by the existing
  invariants test (packages/minspec/tests/invariants.test.ts); this task only cites it.
  *Done when:* green; the pull request quotes a local mutation (an `ai-approved` literal in a
  scratch copy, a `--resume` on one launch line) turning each block red.

## 2 - FR-8 table and the FR-4 contract (pure)

- [ ] **2.1** (FR-8, INV-3, INV-6) `packages/shared/src/approvable-types.ts` (new),
  `packages/shared/src/index.ts` (export) - `ReviewType`, `ReviewTypeRow`, `REVIEW_TYPES`,
  `classifyApprovable`, `isHumanGated`, `isReviewedAtBreadth` exactly as design.md "The type
  table". No IO, no vscode.
  Test `packages/shared/tests/approvable-types.test.ts`: classification of each path form and
  each frontmatter `type:`; frontmatter wins over path; `isHumanGated('issue', x)` false for
  every `x` including `['issue']` and `[]`; every high type gated for `autoApprove` equal to
  the full type list; `design`/`tasks` gated iff unlisted; breadth order; no row's status
  context is `ai-review/pass`; for `spec`, `dr`, `epic` paths the answer agrees with
  `classifyApprovablePath` (packages/minspec/src/lib/approvable.ts, read only).
  *Done when:* green, `npm run typecheck` passes.
- [ ] **2.2** (FR-4 contract, INV-4) `packages/shared/src/approvable-types.ts` -
  `isHumanTaskEligible({ type, greenlit, priorStageGatesClear, humanGateOpen, autoApprove })`.
  Test (same file, `describe('FR-4 contract')`): true only when all four hold for a gated type;
  false for `issue` in every combination; false for `design` when `autoApprove` lists it.
  *Done when:* green; the pull request comments on #528 (bot-attributed) naming the export.
- [ ] **2.3** (FR-8, design P2) `.github/scripts/ai-review-guard.js` - CommonJS twin:
  `REVIEW_TYPES`, `classifyApprovable`, `isHumanGated`, `isReviewedAtBreadth`, exported.
  Tests: cases in `.github/scripts/ai-review-guard.test.js`, and a parity block in
  `packages/shared/tests/approvable-types.test.ts` that requires the guard and deep-compares
  `REVIEW_TYPES` and the classifier output over the 2.1 path list.
  *Done when:* green, regeneration rule satisfied.
- [ ] **2.4** (FR-8) `scripts/review-approvable.sh` - `detect_type` obtains the type from the
  guard's `classifyApprovable` (the same `node -e` require pattern `is_quota` uses) and prints
  the row's `label`; the path-only `case` arms go. Unknown stays "SDD approvable".
  Test: cases in `packages/minspec/tests/review-approvable.test.ts` for a DR, an epic, the
  constitution, `design.md`, `tasks.md`, `plan.md`, a `requirements.md`, and a file with
  `type: design` frontmatter at an unrelated path.
  *Done when:* green, regeneration rule satisfied.

## 3 - FR-6 / FR-7 config

- [ ] **3.1** (FR-6, FR-7, INV-6) `packages/minspec/src/lib/config.ts` - optional
  `review?: { breadth; depth; autoApprove }` on the config type and `resolveReviewConfig(raw)`
  returning `{ breadth, depth, autoApprove, warnings }`: defaults `all` / `single` / `[]`;
  unknown breadth or depth falls back with a warning; `autoApprove` keeps only types whose row
  is `autoApprovable` or `issue`, dropping others with a warning naming each.
  Test `packages/minspec/tests/review-config.test.ts`: absent block gives the defaults and no
  warning; `autoApprove: ['spec','design']` gives `['design']` and one warning naming `spec`;
  `depth: 'panel'` and `breadth: 'critical-only'` accepted together (the FR-7 axes are
  independent); a garbage breadth falls back.
  *Done when:* green, `npm run typecheck` passes.
- [ ] **3.2** (FR-6, FR-7) `.github/scripts/ai-review-guard.js` - `readReviewConfig(jsonText)`
  with the same rules, plus `prOnlyAutoAcceptedDocs(changedFiles, config)` (design.md
  "Merge-gate reflection"). Tests: guard test cases, and a parity block in
  `packages/minspec/tests/review-config.test.ts` running both readers over the same inputs.
  `prOnlyAutoAcceptedDocs`: true for `[design.md, tasks.md]` with both listed; false when one
  file is code or a DR; false for an empty list.
  *Done when:* green, regeneration rule satisfied.
- [ ] **3.3** (FR-6 OQ-1, FR-7 OQ-2) `.minspec/config.json` - add
  `"review": { "breadth": "all", "depth": "single", "autoApprove": ["design", "tasks"] }`,
  editing the file as text (no reformat of other keys).
  Test (`describe('dogfood config')` in `packages/minspec/tests/review-config.test.ts`): the real
  file resolves to exactly that block with zero warnings; `git diff` of the file touches only
  the added lines.
  *Done when:* green, `npm run validate` passes.

## 4 - FR-1 prompts and runner modes

- [ ] **4.1** (FR-1) `scripts/roles/approvable-reviewer.md` - add the **Issue** bullet in
  "Per-type substance checks" with FR-1's wording (reproducible, single concern, named root
  cause, AI-reviewed never human-gated) and a sentence that `plan.md` is the Plan type and
  `design.md` the design type. Add a line under "Constraints" that when no tools are granted
  the reviewer judges the content only and does not report unread references as defects.
  Test (`review-approvable.test.ts`): the role contains one bullet per `REVIEW_TYPES` label
  except `pr`.
  *Done when:* green, regeneration rule satisfied.
- [ ] **4.2** (FR-1, OQ-4, the `claude -p` untrusted-input rule) `scripts/review-approvable.sh` - `--type <slug>` (overrides
  classification; validated against `REVIEW_TYPES`) and `--no-tools` (launch with `--tools ""`
  instead of `Read,Glob,Grep`); `--type issue` implies `--no-tools`.
  Test (`review-approvable.test.ts`, using the agent-launch harness in
  packages/minspec/tests/helpers/agent-launch-harness.ts, read only): default launch carries
  the read-only tools; `--no-tools` and `--type issue` carry `--tools ""` and no `Read`; an
  unknown `--type` exits 1.
  *Done when:* green, regeneration rule satisfied.

## 5 - FR-3 recording and the merge gate (pure)

- [ ] **5.1** (FR-3) `.github/scripts/ai-review-guard.js` - `typeVerdictLabel(type, outcome)`,
  `typeStatusContext(type)` (null for `issue` and `pr`), `aggregateTypeVerdicts(list)` (worst
  wins: escalated > changes > pending > pass), `ALL_TYPE_LABELS`.
  Tests (guard test): aggregation order; two specs give one label; `issue` has no context;
  every label starts `ai-review:<type>:`; `escalated` is refused for `issue`.
  *Done when:* green, regeneration rule satisfied.
- [ ] **5.2** (INV-4, INV-8, FR-9b) `.github/scripts/ai-review-guard.js` - `decideStatus` input
  `typeSignals: { labels, statuses }`: a non-pass per-type label or a `failure`/`pending`
  per-type status yields `failure` with the type named; per-type pass never upgrades.
  Tests (guard test): `ai-review:spec:changes` with combined `ai-review:pass` gives failure; a
  hand-added `ai-review:spec:pass` beside a failing `ai-review/spec` status gives failure; a
  removed `:changes` label with the status still failing gives failure; for each failing case
  `shouldAwaitApproval` is false (INV-8); no `typeSignals` behaves exactly as today (the
  existing cases pass unchanged).
  *Done when:* green, regeneration rule satisfied.
- [ ] **5.3** (FR-6, INV-6) `.github/scripts/ai-review-guard.js` - `shouldAwaitApproval` input
  `onlyAutoAcceptedDocs`: true returns false. Tests (guard test), the spec's acceptance trio:
  `autoApprove` off, design.md-only greenlit PR awaits; on, it does not; a DR-only PR awaits
  with `autoApprove` on (via `prOnlyAutoAcceptedDocs` from 3.2).
  *Done when:* green, regeneration rule satisfied.

## 6 - FR-5 ordering (pure)

- [ ] **6.1** (FR-5, INV-5) `.github/scripts/ai-review-guard.js` - `parseImplements(text)`
  (the frontmatter `implements:` and `affects:` lists, comments stripped) and
  `planReviewOrdering({ changedFiles, docs })` returning `{ deferred, reviewNow }`, matching
  case-insensitively like `owned_match` in scripts/hooks/spec-gate.py (read only).
  Tests (guard test): the spec's mixed PR (a spec, its implementing code, an unrelated fix) with
  the spec not greenlit defers only the implementing file; greenlit defers nothing; a file
  claimed by a greenlit and an ungreenlit doc is deferred; a doc without `implements:` defers
  nothing; `parseImplements` reads this spec's own requirements.md frontmatter (read only) to
  its three paths.
  *Done when:* green, regeneration rule satisfied.

## 7 - Local runner and remediation

- [ ] **7.1** (FR-1, FR-3, FR-5, FR-7) `scripts/review-pr.sh` - after the diff review: classify
  each changed file, filter by breadth (config read from the base ref, never the PR head), run
  `review-approvable.sh --type <t> --no-tools` per document (depth `panel` adds `--role
  architect` and `--role skeptic`, worst wins), decide, aggregate, post `ai-review/<type>`
  statuses and per-type labels, append the `### Per-type review` section; compute
  `planReviewOrdering` and list deferred files in the comment. Writes are observed (no
  `|| true` on any gate-signal write).
  Test `packages/minspec/tests/review-pr-per-type.test.ts` (new) with a stub `gh` on `PATH` and
  `REVIEW_APPROVABLE_REVIEWER_CMD`: a PR with a spec (reviewer returns changes) and a design.md
  (pass) posts `ai-review/spec` failure, `ai-review/design` success and the two labels; breadth
  `critical-only` skips the design.md; a head-side config edit is ignored; a failing `gh`
  write exits non-zero; a reviewer quota result gives `ai-review:<type>:pending` and the
  combined `ai-review:blocked`.
  *Done when:* green, `npm run check:swallowed-gate` passes (and SPEC-054's
  `check:gate-signals` too, if it has landed by then), regeneration rule satisfied.
- [ ] **7.2** (FR-2) `scripts/remediate-pr.sh` - `classify_pr` treats `ai-review:<type>:changes`
  as remediable with the per-type findings; non-automation branch: set
  `ai-review:<type>:escalated` and `agent-escalated` once per head SHA and dispatch nothing;
  budget exhausted: add `ai-review:<type>:escalated` beside today's `agent-escalated`.
  Test: cases in `packages/minspec/tests/remediate-pr-classify.test.ts`.
  *Done when:* green; existing remediate tests unchanged and green.

## 8 - Machinery pull request (founder pushes; App has no `workflows` scope)

One pull request for the group. An agent prepares the branch; the founder pushes it.

- [ ] **8.1** (FR-3, FR-5 OQ-3) `.github/workflows/ai-review.yml` - (a) the run-start step also
  marks per-type pending for changed approvables; (b) a new step `Per-type approvable review
  (SPEC-031 FR-3)` before `Independent review → decide combined label`, running base scripts
  over head content with `--no-tools`, blob-keyed carry-forward, config from the base checkout;
  (c) the code reviewer receives the diff minus `planReviewOrdering`'s deferred files, and the
  verdict comment records `deferred:`; (d) `Carry the last verdict forward if nothing reviewable
  changed` refuses to carry when the previous verdict recorded deferred files. Labels are
  created idempotently before first write.
  Test `packages/minspec/tests/ai-review-per-type-workflow.test.ts` (new), content assertions:
  the step exists and precedes the combined step; it passes `--no-tools`; it reads config from
  the base path; it never references `AI_REVIEW_COVERAGE` (FR-7 two surfaces); no
  `continue-on-error`; the carry step checks for `deferred:`.
  *Done when:* actionlint passes and the regeneration rule is satisfied. The live run is
  observed by 9.1 after merge (the workflow runs from the base, so this pull request cannot
  exercise its own new step).
- [ ] **8.2** (INV-4, FR-6, FR-9) `.github/workflows/ready-to-merge.yml` - pass `typeSignals`
  (labels plus the head's `ai-review/*` statuses) to `decideStatus` and
  `onlyAutoAcceptedDocs` to `shouldAwaitApproval`, config from the trusted base checkout.
  Test (same new file, `describe('ready-to-merge')`): both inputs are passed; config path is
  the base checkout.
  *Done when:* actionlint passes, regeneration rule satisfied.
- [ ] **8.3** (FR-1 Issue, FR-3 OQ-4, INV-3) `.github/workflows/ai-review-issue.yml` (new) and
  its row in `scripts/gen-ci-templates.mjs` - design.md "FR-1 - the Issue reviewer".
  Test (same new file, `describe('issue reviewer')`): trigger is `issues: labeled`, filtered to
  `role:*` or `triage`; it calls `review-approvable.sh` with `--type issue`; the file contains
  none of `needs-human-review`, `awaiting-approval`, `hold:`; it posts as the bot; no
  `continue-on-error`.
  *Done when:* actionlint passes, regeneration rule satisfied, the template appears in the
  generated registry.

## 9 - Close-out

- [ ] **9.1** (acceptance evidence) after group 8 merges, on the first real pull request that
  carries an approvable, read its per-type statuses and labels, and on the first issue promoted
  from inbox read its `ai-review:issue:*` label and comment. Post both observations
  (bot-attributed) on #527, #529 and #530 with links.
  *Done when:* the comments exist and each quotes the observed status or label.

## Coverage

| Requirement | Tasks |
|---|---|
| FR-1 | 2.4, 4.1, 4.2, 7.1, 8.3 |
| FR-2 | 7.2 |
| FR-3 | 5.1, 7.1, 8.1, 8.3 |
| FR-4 | 2.2 (contract; resolver is #528) |
| FR-5 | 6.1, 7.1, 8.1 |
| FR-6 | 3.1, 3.2, 3.3, 5.3, 8.2 |
| FR-7 | 3.1, 3.2, 3.3, 7.1, 8.1 |
| FR-8 | 2.1, 2.3, 2.4 |
| FR-9a | shipped (`shouldAwaitApproval`); 5.2 keeps it coherent |
| FR-9b | 5.2, 8.2 |
| FR-9c | #816 (out of this spec) |
| INV-1 | 1.1 |
| INV-2 | 1.1, 5.2 |
| INV-3 | 2.1, 2.2, 8.3 |
| INV-4 | 2.2, 5.2, 8.2 |
| INV-5 | 6.1 |
| INV-6 | 2.1, 3.1, 5.3, 7.1 |
| INV-7 | existing invariants test (cited in 1.1) |
| INV-8 | 5.2 |
| Acceptance: spec reviewed before human queue | 5.2, 7.1, 8.1, 9.1 |
| Acceptance: mixed PR ordering | 6.1, 8.1 |
| Acceptance: Issue never a human task | 2.1, 8.3, 9.1 |
| Acceptance: `awaiting-approval` truthful | 5.2 |
| Acceptance: auto-approve off / on / DR | 5.3 |
| Acceptance: FR-2 escalation | 7.2 |
| Acceptance: FR-7 axes and surfaces | 3.1, 8.1 |
| Acceptance: reviewer never mutates | 1.1 |
