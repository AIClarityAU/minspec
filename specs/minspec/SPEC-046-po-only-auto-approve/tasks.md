---
id: SPEC-046
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-046 is T3.)
# status mirrors requirements.md. This file has no approval record of its own: only
# requirements.md is signed, so status and phases describe and never seal.
status: planning
product: minspec
epic: EPIC-002  # Signpost Integrity
relates_to: [DR-068, DR-056, SPEC-041, SPEC-023, SPEC-024, "#3254", "#3288", "#952", "#953", "#954", "#955"]
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: pending
---

# SPEC-046 - Tasks

The contract is [requirements.md](./requirements.md) (FR-1..FR-8, INV-1..INV-6, AC-1..AC-9,
RD-1..RD-5, CQ-1..CQ-9). The approach is [design.md](./design.md), read together with its
section *Re-verification against main before Tasks (2026-10-28)*, which this list follows
where the two differ. Build issue: #3254.

Each numbered task is one pull request: one concern, its own test, green when it lands.
Line numbers are from `origin/main` at `7430af21`; re-read them before editing.

Every backticked path in this file is a file the task edits or creates. Files a task only
reads are named in prose, so the spec gate's ownership signal stays as narrow as the change.
New tests go in the owned file `packages/minspec/tests/auto-approve.test.ts` unless a task
names another; Python behaviour is tested from that file through a python3 subprocess, the
way the canonical golden Python test already does, because no workflow runs
`test_spec_gate.py`.

## Order, and why

The slices run so that nothing can resolve `auto` before the gate that keeps `auto`
human-only exists (design re-verification point 5):

1. **The record slice** - record kind and the read backstop. No behaviour change for any
   committed sidecar.
2. **The authorship-gate slice** - INV-5's three layers. Still nothing reads `audiences`.
3. **The policy slice** - the resolver and the `audience:` field. Dark: no config has an
   `audiences` block.
4. **The state slice** - the `auto-approved` value, gate routing, the Python verdict.
5. **The surfaces slice** - display arms, commands, machine-gate proof, final check.

Tasks inside a slice may run in parallel unless a task says otherwise. A task that finds the
code no longer matches what it describes stops with `DEEPER:` and does not improvise.

Tasks 1.1, 1.2 and 4.1 edit `approval.ts` or `approval-store.ts`, owned by SPEC-041. Each of
their pull request bodies says so and links #955 (owner ack before a code PR merges, CQ-9).
Tasks 2.3 and 2.4 change machinery (`.githooks/`, `.github/`) and merge through the
machinery lane.

## 1 - The record slice (FR-3, INV-2, INV-6, RD-4)

- [ ] **1.1** Record kind, on every reader and writer at once (a required field that one
  writer omits does not compile). `packages/minspec/src/lib/approval.ts` - add
  `readonly kind: 'human' | 'migrated'` to `ApprovalRecord`, with no `'auto'`; the record
  `approveSpec` writes carries `kind: 'human'`. `packages/minspec/src/lib/approval-store.ts` -
  `isValidRecord` (`:97`) accepts `kind` absent or in `{human, migrated}` and rejects any
  other value; `normalizeRecord` (`:122`) back-fills an absent `kind` as
  `migrated === true ? 'migrated' : 'human'`. `scripts/migrate-approvals.ts` - its records
  carry `kind: 'migrated'` and never `'human'`.
  Before writing, read `scripts/lib/approval-actor.ts` and `scripts/approval-integrity.ts`; if
  either rejects an unknown sidecar key, stop with `DEEPER:` (the new key would fail their
  checks) rather than editing them.
  *Test:* `packages/minspec/tests/auto-approve.test.ts` - a sidecar with `kind: "auto"` or
  `kind: 7` reads as no record (AC-9, TS half, kind arm); a legacy record back-fills `human`,
  a `migrated: true` one `migrated` (RD-4); a record written by `approveSpec` under a human
  identity has `kind: 'human'`, and under a bot identity `approveSpec` still throws
  `ApproverDeniedError` (AC-2, INV-2). `packages/minspec/tests/migrate-approvals.test.ts` -
  migrated output has `kind: 'migrated'`.
  *Done when:* those pass, `npm run typecheck` is clean, and `approval.test.ts`,
  `approver-identity.test.ts` and the canonical parity tests pass unchanged (the hash covers
  the body, not the sidecar).

- [ ] **1.2** The TS denylist backstop. `packages/minspec/src/lib/approval-store.ts` -
  `isValidRecord` also rejects a record whose `approvedBy` fails `checkApprover`
  (`approval.ts:447`) with the built-in denylist plus `MINSPEC_AGENT_IDENTITIES`. Use
  `checkApprover` itself, never a second list: the two delegated sidecars carrying the bare
  login `minspec-sdd[bot]` must stay valid (design re-verification point 3). Depends on 1.1.
  *Test:* `packages/minspec/tests/auto-approve.test.ts` - a sidecar whose `approvedBy` is each
  built-in denylist entry, in any letter case, reads as no record (AC-9, TS half, denylist
  arm); every sidecar committed under `.minspec/approvals/` still reads as a valid record
  (regression guard for the delegated records).
  *Done when:* those pass.

- [ ] **1.3** The Python read backstop. `scripts/hooks/spec-gate.py` - `read_record` (`:282`)
  returns `None` for `kind` present and not in `{human, migrated}`, and for an `approvedBy`
  in the agent denylist. The Python denylist is a literal in `spec-gate.py`.
  *Test:* `packages/minspec/tests/auto-approve.test.ts` - through python3, the same corrupt
  sidecars as 1.1 and 1.2 read as no record (AC-9, Python half); a parity case asserts the Python
  denylist equals `BUILTIN_AGENT_IDENTITIES` lower-cased, so adding an identity on one side
  only fails the test.
  *Done when:* those pass and `packages/minspec/tests/spec-gate.test.ts` passes unchanged.

## 2 - The authorship-gate slice (INV-5, AC-8)

- [ ] **2.1** Pin the merge-lane layer that already exists. Test only:
  `packages/minspec/tests/auto-approve.test.ts` - a change touching only
  `.minspec/config.json` is (a) withheld from native auto-merge by `scripts/dispatch-issue.sh`
  (mandate 2, `:368-374`, and the `edits-the-autonomy-rules` stop class, `:489`), (b) refused
  by the delegated merge (`scripts/lib/delegated-merge.ts`, its `.minspec/` refusal), and (c)
  outside the docs-lane corpus. Drive each through the entry point its existing tests use;
  read those tests first. If any of the three does not withhold, stop with `DEEPER:`.
  *Done when:* the three cases pass, and each fails when its withhold is removed in a
  scratch copy (record the three mutation results in the pull request body).

- [ ] **2.2** The one predicate. `scripts/hooks/spec-gate.py` - add
  `policy_authorship_violations(repo, base, head)`: for each commit in `base..head` whose diff
  changes any `audiences.<name>.approval` in `.minspec/config.json`, a violation when the
  commit's author email is in the agent denylist (1.3), is empty or `unknown`, or differs from
  that audience's `enabledBy` at that commit. A config that does not parse as JSON at either
  side of a commit is a violation, never a pass (constitution invariant 2). Expose it as
  `spec-gate.py --policy-authorship <base> <head>`, printing each violation and exiting
  non-zero on any. Also accept `--policy-authorship-staged`, which judges the index against
  `HEAD` with the committer identity git would use (`git var GIT_AUTHOR_IDENT`), for 2.3.
  Depends on 1.3 (shared denylist).
  *Test:* `packages/minspec/tests/auto-approve.test.ts` - in a temp git repo: a bot-authored
  commit setting `approval: "auto"` fails; a human commit with `enabledBy` not equal to its
  author fails; a human commit with matching `enabledBy` passes; a commit not touching
  `audiences` passes; a commit leaving `config.json` unparseable fails; the staged mode
  agrees with the range mode on each case.
  *Done when:* those pass.

- [ ] **2.3** Commit-time layer. `.githooks/pre-commit` - a new stage that runs
  `spec-gate.py --policy-authorship-staged` when `.minspec/config.json` is staged, and
  blocks the commit on a non-zero exit, printing the violations. Bypass with
  `POLICY_GATE_OFF=1`, scoped to this stage only (the #1040 rule in the hook's header: a
  bypass never skips another stage). A missing `python3` blocks, it does not skip. Depends on
  2.2.
  *Test:* `packages/minspec/tests/auto-approve.test.ts` - in a temp repo with
  `core.hooksPath` at a copy of the hook: a bot-identity commit enabling `auto` is refused;
  the same commit with `POLICY_GATE_OFF=1` lands while the hook's other stages still run; a
  human matching commit lands.
  *Done when:* those pass and the hook's existing tests pass unchanged.

- [ ] **2.4** CI layer. `.github/workflows/ready-to-merge.yml` - a step in the `gate` job,
  after "Require a trusted base commit", that runs the **base** checkout's
  `scripts/hooks/spec-gate.py --policy-authorship <base sha> <head sha>` and fails the job on
  a non-zero exit (design re-verification point 1). Never `|| true`, never
  `continue-on-error`. Depends on 2.2. Machinery: merges through the machinery lane.
  *Test:* `packages/minspec/tests/auto-approve.test.ts` - parse the workflow YAML and assert
  the step exists in `gate`, runs the base copy, has no `continue-on-error`, and its command
  has no `|| true`.
  *Done when:* that passes and `npm run lint` passes on the workflow.

## 3 - The policy slice (FR-1, RD-2, CQ-7, CQ-8; dark)

- [ ] **3.1** The resolver. `packages/shared/src/next-task.ts` - export
  `CURRENT_POLICY_SCHEMA_VERSION = 1` (constant only in this task).
  `packages/minspec/src/lib/audience-policy.ts` (new, owned) - `AudiencePolicy = 'human' |
  'auto'`; `resolveAudiencePolicy(config, audienceName, currentSchemaVersion)` returning
  `'auto'` only when `audiences[name].approval === 'auto'` and `policyVersion` equals the
  current version, else `'human'`; re-export the constant. `packages/minspec/src/lib/config.ts`
  - `MinspecConfig` (`:43`) gains optional `audiences`; after the merge in `loadConfig`
  (`:204`), a pass over the `audiences` block only coerces a bad `approval` to `'human'` with
  a `console.warn`, and drops a non-object entry. Depends on 2.4 having merged (order rule
  above). Before merging, read #3288; if it is decided, apply its condition here.
  *Test:* `packages/minspec/tests/auto-approve.test.ts` - auto with matching version gives
  `auto`; auto with a mismatched or absent `policyVersion` gives `human`; garbage `approval`
  gives `human` and warns; an unknown or absent audience gives `human` (AC-6); bumping the
  version past a pinned `policyVersion` gives `human` (AC-7, second half).
  *Done when:* those pass; nothing yet calls the resolver outside the test.

- [ ] **3.2** The `audience:` field. `packages/minspec/src/lib/spec.ts` - optional
  `audience` frontmatter and a `specAudience(fm)` helper. `packages/minspec/src/lib/spec-validator.ts`
  - a rule: a present `audience:` naming no key of the config's `audiences` block is an
  error; absent is fine. This is the rule CQ-7 homes in this spec. Depends on 3.1 (config
  type).
  *Test:* `packages/minspec/tests/auto-approve.test.ts` - unknown audience is a validator
  error naming the file; a declared audience is clean; no audience is clean; `npm run
  validate` on this repo stays green (no spec carries the field yet).
  *Done when:* those pass.

## 4 - The state slice (FR-2, FR-7, RD-1, RD-2, CQ-4)

- [ ] **4.1** The state and the lifecycle gate. `packages/minspec/src/lib/approval.ts` -
  `ApprovalStatus` (`:39`) gains `'auto-approved'`; `resolveStatus` (`:489`) takes `policy:
  AudiencePolicy = 'human'` and follows design *resolveStatus & policy resolution* exactly
  (a record whose `kind` is neither `human` nor `migrated` falls through; a valid record always
  wins; no record plus `auto` plus a non-null hash gives `auto-approved`);
  `getApprovalStatus` (`:499`) takes an optional policy and otherwise resolves it from config
  and the spec's `audience:`. `packages/minspec/src/lib/audience-policy.ts` - export
  `isApprovalSatisfied`. `packages/shared/src/next-task.ts` - `ApprovalState` (`:56`) gains
  `'auto-approved'` (type only). `packages/minspec/src/lib/artifact-graph.ts` -
  `APPROVAL_STATE_MAP` (`:87`) maps the new value; the `satisfies` guard (`:91`) forces it.
  `packages/minspec/src/lib/lifecycle.ts` - `:140` becomes
  `!isApprovalSatisfied(approvalState)`. Depends on 3.1.
  *Test:* `packages/minspec/tests/auto-approve.test.ts` - `deriveStatus` with all phases done
  and `auto-approved` gives `done`, never `specifying`; the `resolveStatus` table from the
  design's T0 row; with `auto`, a spec with no sidecar resolves `auto-approved` and
  `getApprovalRecord()` is `undefined` and nothing is written (AC-1); editing the spec body
  leaves it `auto-approved` and writes nothing (AC-7, first half); flipping the audience to
  `human` gives `unapproved` and a human record elsewhere is byte-identical after (AC-5, T3
  regression for FR-7).
  *Done when:* those pass and `npm run typecheck` is clean. A compile error the new value
  causes in a file 5.1 or 5.2 owns is fixed here by rendering `auto-approved` as today's
  unapproved arm (fail safe: under-shows, never shows a human approval); the distinct arm is
  5.1's and 5.2's. If the type change breaks
  `scripts/facts.ts` or `scripts/next-task.ts`, which only print the value, stop with
  `DEEPER:` (they are outside this spec's declared files).

- [ ] **4.2** The shared resolver's gates. `packages/shared/src/next-task.ts` - a twin
  `isApprovalStateSatisfied` used at `gateCleared` (`:280`), the implementing-but-unapproved
  incoherence check (`:481`) and the approval filter at `:863`; `packages/shared` cannot
  import the minspec package (DR-014), hence the twin. Depends on 4.1.
  *Test:* `packages/shared/tests/next-task.test.ts` - an `auto-approved` gate is cleared; no
  pending-human-approval task is emitted for it; no incoherence flag for implementing plus
  `auto-approved`. `packages/minspec/tests/auto-approve.test.ts` - the twin and
  `isApprovalSatisfied` agree on all four values.
  *Done when:* those pass.

- [ ] **4.3** Policy resolved once per graph build. `packages/minspec/src/lib/artifact-graph.ts`
  - load config once per `buildArtifactGraph` call and pass each spec's resolved policy into
  `getApprovalStatus` (the call feeding `:545`), per CQ-4. Depends on 4.1.
  *Test:* `packages/minspec/tests/auto-approve.test.ts` - for a fixture project of three
  specs, `loadConfig` is called once per build, and the graph's approval states equal those
  from calling `getApprovalStatus` per spec without the injected policy.
  *Done when:* that passes.

- [ ] **4.4** The Python verdict. `scripts/hooks/spec-gate.py` - `_load_audience_policy(cwd,
  spec_rel)` reading `.minspec/config.json`, the spec's `audience:`, and
  `CURRENT_POLICY_SCHEMA_VERSION` from `packages/shared/src/next-task.ts` with one anchored
  pattern (any count other than one match resolves `human`, design re-verification point 4);
  the verdict block (`:545-551`) gains the `auto-approved` arm after the record arms; an
  `is_approval_satisfied` helper; `auto-approved` is not in the block set. New golden
  fixtures `packages/minspec/tests/fixtures/audience-policy/cases.json` (config, audience,
  version, expected). Depends on 3.1 and 4.1.
  *Test:* `packages/minspec/tests/auto-approve.test.ts` - every golden case gives the same
  answer from `resolveAudiencePolicy` and from Python; the version Python reads equals the TS
  import; through `spec-gate.sh`, an auto spec with a hash passes, an auto spec whose hash is
  `None` blocks, a human record under auto stays approved or stale, a version mismatch
  blocks.
  *Done when:* those pass and `spec-gate.test.ts` passes unchanged.

## 5 - The surfaces slice (FR-5, FR-6, INV-1, INV-3, CQ-1, CQ-5)

- [ ] **5.1** The tree. `packages/minspec/src/views/spec-tree-provider.ts` - an explicit
  `auto-approved` arm at each approval branch (`:186-197` icon and tag, `:226-227`
  contextValue `specNode.autoApproved`, `:242-243` tooltip "auto-approved by policy - no
  human review"), icon `shield` as CQ-5's placeholder until #954 picks one (never `lock`,
  never `warning`); a terminal spec that advanced under auto keeps the tooltip line
  "advanced under auto policy - no human review" (CQ-1). The needs-reapproval group (`:466`)
  is unchanged. Depends on 4.1.
  *Test:* `packages/minspec/tests/spec-tree-provider.test.ts` - the auto arm's icon is
  neither `lock` nor `warning`, tag and contextValue are distinct, no label or tooltip says
  "approved by" (AC-4, INV-1); the existing status-group exhaustiveness case passes.
  *Done when:* those pass.

- [ ] **5.2** The commands. `packages/minspec/src/commands/approve-active.ts` - the filter at
  `:181` stops offering an `auto-approved` spec as needing approval only if it routes through
  `isApprovalSatisfied`; the description at `:194` prints the state verbatim.
  `packages/minspec/src/commands/approve.ts` - each `include` predicate (`:47`, fed at `:75`)
  given an explicit answer for `auto-approved` (approving one is allowed and writes a human
  record, which then wins). `packages/minspec/src/commands/validate.ts` - `:56` passes the
  state through; `packages/minspec/src/lib/spec-validator.ts` - the `approvalState` option
  type (`:713`) widens, and mirror-drift (`:1240`) does not warn on a legitimately advanced
  auto spec. Depends on 4.1.
  *Test:* `packages/minspec/tests/auto-approve.test.ts` - an auto spec appears with
  `auto-approved` in the approve-active list description, never `approved`; it can still be
  approved by a human; validate reports no mirror-drift for an implementing auto spec.
  *Done when:* those pass.

- [ ] **5.3** Machine gates still run. Test only:
  `packages/minspec/tests/auto-approve.test.ts` - an `auto-approved` spec that fails
  `validate` is still reported failing; the SPEC-023 consequence screen and SPEC-024
  auto-merge eligibility return the same verdict for an auto spec as for a human-approved
  one with the same content (AC-3, FR-5, INV-3). Read those gates' modules to drive them;
  edit none. If either keys on `=== 'approved'` and so treats auto as unapproved, stop with
  `DEEPER:`. Depends on 4.1.
  *Done when:* those pass.

- [ ] **5.4** Close-out. `specs/minspec/SPEC-046-po-only-auto-approve/tasks.md` - tick each
  box with the pull request that landed it, verified against the code, not the title. Run
  `npm test`, `npm run lint`, `npm run typecheck` and `npm run validate`; grep the tree for
  an `'auto'` record kind and for any `approved by` rendering of an auto state (INV-1,
  INV-4). Set `phases.implement` to `done` in this file only once every box is ticked and
  green. Depends on every task above.
  *Done when:* all four commands exit 0 and both greps return nothing.

## Not tasks of this spec

- Enabling `auto` in any repository: a human edit of `.minspec/config.json`, gated by 2.2-2.4.
- The per-item audit artifact (#952), the creation-author scope (#953), the final glyph
  (#954), the owner-ack protocol (#955), and the adopter reach of INV-5 (#3288).
