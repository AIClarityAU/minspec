---
id: SPEC-046
title: PO-only mode — per-audience approval policy (auto-approve)
type: requirements
status: specifying
tier: T3
product: minspec
created: 2026-07-21
epic: EPIC-002  # Signpost Integrity
depends_on: [DR-068, SPEC-022, DR-056]
relates_to: [SPEC-023, SPEC-024, SPEC-045]
implements: [packages/minspec/src/lib/audience-policy.ts, packages/minspec/tests/auto-approve.test.ts]
affects: [packages/minspec/src/lib/approval.ts, packages/minspec/src/lib/approval-store.ts, packages/minspec/src/lib/config.ts, packages/minspec/src/lib/lifecycle.ts, packages/minspec/src/lib/artifact-graph.ts, packages/shared/src/next-task.ts, packages/minspec/src/lib/spec.ts, packages/minspec/src/lib/spec-validator.ts, packages/minspec/src/views/spec-tree-provider.ts, packages/minspec/src/commands/approve.ts, packages/minspec/src/commands/approve-active.ts, packages/minspec/src/commands/validate.ts, scripts/hooks/spec-gate.py, scripts/migrate-approvals.ts, .githooks/pre-commit, .github/workflows/ready-to-merge.yml]  # owned by SPEC-041 (approval*.ts), SPEC-022/gate (spec-gate.py), others — auto-approve modifies-not-owns; new logic is isolated in the owned audience-policy.ts
phases:
  specify: done
  clarify: done
  plan: done
  tasks: pending
  implement: pending
---

# SPEC-046: PO-only mode — per-audience approval policy (auto-approve)

## Summary

Let a solo builder say "I only want to sign off on *what we're building and why* — not the
technical detail." MinSpec then treats the technical parts as approved automatically, but
shows that honestly ("cleared by a standing rule — no person reviewed this"), and still runs
all its automatic safety checks. It never pretends a person reviewed something they didn't.

## Context

DR-068 (decision 4) adds a per-project setting so a developer upgrading from vibe-coding can
be PO-only: technical approvables auto-pass so they are not forced to review the *how*. This
collides with DR-056 (approver must be human) and the never-wrong signpost. The
[Plan](./design.md) resolved the persist-vs-virtual fork in favour of a **virtual** model:
auto-approval is a *derived state*, not a written record — the committed config policy is the
record — which makes the DR-056/containment invariants airtight by construction.

## Requirements

- **FR-1 (policy config + audience mapping).** `.minspec/config.json` gains a per-audience
  policy: `audiences: { <name>: { approval: "human"|"auto", enabledBy, enabledAt,
  policyVersion, policyRef } }`, default `human`. A narrow audiences-only post-merge validator
  coerces a bad `approval` to `human` + warns (fail safe; the loader has no schema today). A
  spec maps to an audience via a new optional closed-set `audience:` frontmatter field,
  validated against declared config keys (absent/unknown → human, never auto by accident).
- **FR-2 (auto satisfies the gate, virtually).** When a spec's audience policy resolves to
  `auto`, an approvable with no valid human record derives the distinct `auto-approved` state
  **live from config — no per-approvable record is written**. `auto-approved` is
  gate-equivalent (clears the human-review gate) via a single `isApprovalSatisfied` helper.
- **FR-3 (the policy IS the record — no sidecar).** The auto policy is the record: a single
  committed per-audience `config.json` entry whose `enabledBy` is **verified equal to the
  committing human git author** by the policy-authorship gate (INV-5) — never a trusted JSON
  literal. **No per-approvable `kind:"auto"` sidecar is written**; the state is derived. The
  `ApprovalRecord` union gains `kind: "human"|"migrated"` only — an on-disk `kind:"auto"` is
  corruption (INV-6). A human `approvedBy` is never populated for auto (there is no auto record).
- **FR-4 (DR-056 not laundered).** The human-not-bot gate stays strict on the human path
  (`assertHumanApprover`); the auto path never touches it (it writes nothing). A bot can never
  mint a `kind:"human"` record.
- **FR-5 (waives review, not gates).** Auto-approval waives *human review only*. The
  deterministic gates still run on auto-approved approvables — `validate`, the SPEC-023
  consequence screen, and SPEC-024 auto-merge eligibility — exactly as for human approvals.
- **FR-6 (honest display, distinct state).** The derived approval-state gains a distinct
  `auto-approved` value (alongside `approved | stale | unapproved`), derived **live from
  audience policy** (an auto-approved spec has no record) — it never collapses to `approved`
  (RD-1). Every surface shows it distinctly (e.g. "auto-approved — no human review"). No code
  path renders or serializes auto as a human approval.
- **FR-7 (policy transitions).** Flipping `auto`→`human` (or bumping the schema version past a
  pinned `policyVersion`) withdraws the waiver: specs previously auto-approved resolve to
  `unapproved` (fresh human approval required) — nothing to delete, since no auto record
  exists. `human`→`auto` leaves existing human records intact (stronger).
- **FR-8 (offline).** Local config + local resolution; no network (Tier-0).

## Invariants (T0 — tests before implementation)

- **INV-1.** No auto-approved spec is displayed or serialized as a human approval;
  `auto-approved` is a distinct state and no `kind:"auto"` record exists to be mistaken for one.
- **INV-2.** The human approval path is unreachable by a non-human identity (DR-056 held).
- **INV-3.** Machine gates run regardless of approval policy.
- **INV-4 (containment).** Nothing mints a `kind:"auto"` record — the auto state is *derived,
  never written*. `auto-approved` is producible ONLY by resolving a human-committed config
  policy; no agent/CI/command path can create it (RD-3).
- **INV-5 (policy-authorship gate).** Editing `audiences.<name>.approval` is a human-only act,
  enforced commit-time (`.githooks/pre-commit`) + CI (`spec-gate.py`) + merge-lane
  (config-policy PRs excluded from native auto-merge → human/`--admin`). The committing git
  author must pass `checkApprover` and equal `enabledBy`.
- **INV-6 (symmetric read backstop).** An on-disk record with `kind ∉ {human,migrated}`, or
  whose `approvedBy ∈ denylist`, is tampering — rejected at read time in BOTH twins
  (`isValidRecord` + `spec-gate.py read_record`); `resolveStatus` treats it as no record.

## Acceptance Criteria

- [ ] **AC-1 (FR-2/FR-3).** With `approval: auto`, a spec with no human record derives
      `auto-approved` from config — **no sidecar is written** (`getApprovalRecord()===undefined`),
      no `approvedBy` exists.
- [ ] **AC-2 (INV-2).** A bot identity cannot produce a `kind:"human"` record (the human path
      throws for a bot).
- [ ] **AC-3 (FR-5).** An auto-approved spec that fails `validate`/SPEC-023/SPEC-024 is still
      blocked by those gates.
- [ ] **AC-4 (INV-1).** No code path maps an auto-approved spec to "approved by `<email>`" (test).
- [ ] **AC-5 (FR-7).** Flipping the audience to `human` (or bumping the schema version) flips its
      specs to `unapproved`; existing human records are untouched.
- [ ] **AC-6 (FR-1).** An unknown/garbage `approval` value validates to `human` (deny toward review).
- [ ] **AC-7 (RD-2).** Editing an auto-approved spec's content neither changes its `auto-approved`
      state nor writes anything; bumping `CURRENT_POLICY_SCHEMA_VERSION` past the pinned
      `policyVersion` flips it to `unapproved`.
- [ ] **AC-8 (INV-5).** A commit changing `audiences.<name>.approval` whose git author ∈ denylist,
      or where `enabledBy ≠ author`, is rejected by the policy-authorship gate (commit + CI).
- [ ] **AC-9 (INV-6).** A hand-written sidecar with `kind:"auto"` or `approvedBy ∈ denylist` is
      treated as no-record (never resolves to approved) in both TS and Python.

## Resolved Decisions (Clarify + Plan)

- **RD-1 (status vocabulary) — distinct `auto-approved` approval-state.** A separate axis from
  the spec-lifecycle enum, so `SPEC_STATUSES` is **untouched**; the derived *approval-state*
  gains a fourth value `auto-approved`. A discriminated value makes every consumer handle it
  (type-forced via the `APPROVAL_STATE_MAP satisfies Record<…>` compile guard) rather than
  trusting each UI to remember.
- **RD-2 (freshness) — policy-bound, live, no per-approvable pin.** Fresh iff
  `audiences.<name>.approval==='auto'` AND `policyVersion === CURRENT_POLICY_SCHEMA_VERSION`,
  evaluated live in `resolveAudiencePolicy`. Content edits never stale an auto-approved spec
  (no `specHash` compare); the machine gates (FR-5) still gate changed content.
- **RD-3 (containment) → INV-4.**
- **RD-4 (migrate records).** `migrate-approvals` records are `kind:'migrated'` (WARN, counts
  as satisfied per FR-5) and MUST NOT collapse to `'human'`; `normalizeRecord` back-fills absent
  `kind` from the legacy `migrated` boolean.
- **RD-5 (virtual over persist) — Plan decision.** Auto-approval is a derived state, not a
  written sidecar. Chosen by a judge-panel + adversarial review: virtual makes INV-2/INV-4/
  DR-056 airtight by construction (the auto path shares zero code with the human writer) and
  RD-2 no-churn falls out for free. The adversary's one catch — virtual moves the DR-056 surface
  onto `config.json` — is closed by INV-5. See [design.md](./design.md).

## Clarifications (post-Plan)

Concrete questions the Plan surfaced ([design.md](./design.md) *Open decisions*), each with a
decision or a follow-up task. (Clarify was `done` pre-Plan; these refine it.)

- **CQ-1 — Terminal-collapse cue.** When an auto-approved spec reaches `done`/`archived`, does
  it keep a visible cue, or does terminal erase the approval axis for both kinds?
  **Decided:** keep a distinct tooltip line "advanced under auto policy — no human review" on
  terminal auto-advanced specs (cheap, preserves honesty); the absent sidecar stays the audit
  distinguisher.
- **CQ-2 — Positive git artifact.** Does auto-approval emit a positive artifact (append-only
  `.minspec/auto-approvals.log` / frontmatter note), or is config-commit git-blame + sidecar
  absence enough? **Decided (v1):** no per-item artifact — the human-authored config commit
  (git-blame: who/when/which audience) is the provenance. **Follow-up task:** revisit if
  per-item audit granularity is later required.
- **CQ-3 — Prospective-waiver scope.** Does `auto` apply to all future specs in the audience,
  or only specs whose creation commit is human-authored? **Decided (v1):** all future specs —
  the policy-authorship gate (INV-5) already forces the policy edit human and routes agent
  config edits to the human lane. **Follow-up task:** add an optional per-spec creation-author
  check if the standing-waiver risk proves real (weigh vs solo-dev ergonomics).
- **CQ-4 — Resolver memoization.** Is the injected-policy path in `buildArtifactGraph`
  mandatory? **Decided:** `getApprovalStatus` takes an optional policy param (internal resolve
  when omitted); the hot loop injects a policy resolved from a config loaded once per graph
  build.
- **CQ-5 — Auto-approved tree glyph.** Which codicon (must differ from `lock` and `warning`)?
  **Follow-up task (UX/impeccable):** pick the glyph; implement uses a distinct placeholder
  (e.g. `pass-filled`/`shield`) until chosen. Not blocking the logic.
- **CQ-6 — FR-3 amendment (governance).** Does "config-is-the-record, no per-approvable
  sidecar" hold, or do reviewers require per-item provenance? **Blocking, human-gated:** pending
  DR-068 acceptance + SPEC-046 review. If rejected → fallback persist/hybrid (re-introduces the
  write-trigger/sweep/bot-writes INV-4 tension). This gates implementation start.
- **CQ-7 — `audience:` frontmatter validation.** Closed-set against config-declared keys only?
  **Decided:** yes — unknown/absent audience → `human` (never `auto` by accident); an unknown
  key is a validator error (rule lives in SPEC-047). `CURRENT_POLICY_SCHEMA_VERSION` is bumped
  by the extension on any audience-membership/policy-schema change, forcing human re-confirm.

## Costly to Refactor

The committed cross-language contract is the `audiences` config schema, the `policyVersion` /
`CURRENT_POLICY_SCHEMA_VERSION` freshness semantics, the `auto-approved` `ApprovalStatus`
value, and the record `kind` field — all byte-identical across the TS + Python twins and fixed
before first use.

## Out of scope

- Approval routing (SPEC-045); teams multi-role policies beyond `human`|`auto` (future).

## Traceability

DR-068 (decision 4, R2/R7); [design.md](./design.md) (Plan / RD-5); SPEC-022 (record + hash);
SPEC-023, SPEC-024 (machine gates); DR-056 (human gate); EPIC-002.
