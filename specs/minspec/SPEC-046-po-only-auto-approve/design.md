---
id: SPEC-046
type: design
status: specifying
product: minspec
epic: EPIC-002  # Signpost Integrity
---

# PO-only Auto-Approve — Design

> Plan phase for [SPEC-046](./requirements.md) — the HOW for the accepted-in-principle
> [DR-068](../../../docs/decisions/DR-068.md) decision 4, under the [DR-056](../../../docs/decisions/DR-056.md)
> human-approver invariant. The requirements (FR-1..FR-8, INV-1..INV-6, RD-1..RD-3, AC-1..AC-7)
> are binding; this encodes the technical approach. This design **amends** FR-3, RD-2 and
> extends FR-1 — see *Spec amendments (plan-driven)* below; those amendments are applied to
> the requirements in the same change.
>
> Chosen from a judge-panel of three approaches (persist / virtual / min-blast) with
> adversarial invariant + consumer-completeness verification. Winner: **virtual derivation,
> no minting**, hardened with a policy-authorship gate.
>
> **File:line anchors below are from the Plan's grounding snapshot; re-verify against current
> `main` at implement time (the structural facts — enum, resolveStatus, deriveStatus — are
> stable; line numbers may have shifted).**

## Approach

Auto-approval adds a **state, not a stored record**. There is **no per-approvable
`kind:"auto"` sidecar**. An approvable resolves to a new fourth approval-state
`auto-approved` **live** from committed config when (a) it has no valid human record and
(b) its audience's policy is `auto` at the current schema version. The **config entry is
the record**: one human-authored, gate-verified `audiences.<name>` block per audience.

Why virtual beats persist (the two axes that matter for a never-wrong product):

1. **DR-056 airtight by construction.** The auto path shares **zero** code with the human
   write path. `assertHumanApprover` (approval.ts:523) is not merely un-launderable but
   **unreachable** on the auto path — nothing mints a `kind:"auto"` value, so INV-4 is
   unfalsifiable by absence, not vigilance.
2. **No churn (RD-2).** Freshness is policy-bound, not hash-bound; the auto arm never
   compares `specHash`, so content edits cause no bot rewrite.

The adversary proved the one real cost: virtual moves the entire DR-056 threat surface **up
one level onto `config.json`**, which today has no human-authorship gate and is eligible for
native ai-review auto-merge — an agent could enable `auto` for a whole audience with zero
human act. That is not a reason to abandon virtual; it is the **one missing gate**. This
design adds a **policy-authorship gate** (commit-time + CI + merge-lane) so enabling a policy
is enforced human-only — "enforce, don't trust the model."

## Data model & types

No new record type. Two additions to `packages/minspec/src/lib/approval.ts`:

- **`ApprovalStatus`** (:33) gains `'auto-approved'`. Its twin `ApprovalState`
  (next-task.ts:52) and `ResolverApprovalState` gain it too. The `satisfies
  Record<ApprovalStatus, …>` at artifact-graph.ts:84 is the **compile guard** — the build
  breaks until `APPROVAL_STATE_MAP` maps `'auto-approved':'auto-approved'`.
- **`ApprovalRecord`** (:55-64) gains `readonly kind: 'human' | 'migrated'`. **There is
  deliberately no `'auto'` in the record union** — an on-disk `kind:"auto"` is corruption.
  `approveSpec` emits only `'human'`; `migrate-approvals.ts` emits only `'migrated'`.

An auto-approved spec has `getApprovalRecord() === undefined`. Provenance lives once per
audience in `config.json`: `audiences.<name> = { approval, enabledBy, enabledAt,
policyVersion, policyRef }`, where `enabledBy` is **verified equal to the committing git
author** by the policy-authorship gate — never trusted as a free JSON literal.

### kind back-fill (closes the INV-2 hole `kind` would open)

`normalizeRecord` (approval-store.ts:64-104) derives absent `kind` from the existing
`migrated` boolean: `migrated === true ? 'migrated' : 'human'`. Legacy human records
(migrated absent/false) → `'human'`; legacy migrate records → `'migrated'`. **No data
migration.** `isValidRecord` accepts `kind ∈ {'human','migrated'}` only.

## resolveStatus & policy resolution (RD-2 wired)

`resolveStatus` stays **pure**; policy is version-resolved by the caller:

```ts
resolveStatus(record: ApprovalRecord | undefined,
              currentHash: string | null,
              policy: AudiencePolicy = 'human'): ApprovalStatus
```

Order:
0. **Defense-in-depth:** if `record` present and `record.kind` is not `'human'` and not
   `'migrated'` → treat as no record (fall through). A merged persist-branch sidecar or an
   `isValidRecord` bug cannot launder auto→approved.
1. Valid human/migrated record → unchanged human path: `currentHash===null ? 'unapproved'
   : record.specHash===currentHash ? 'approved' : 'stale'`. **A valid record always wins** —
   so FR-7 human→auto leaves human records intact, and a stale human record stays stale even
   under auto policy (conservative, honest; documented edge).
2. No valid record → `policy==='auto' && currentHash!==null ? 'auto-approved' : 'unapproved'`.

RD-2 lives in the resolver, not here:

```ts
resolveAudiencePolicy(config, audienceName, currentSchemaVersion): 'human' | 'auto'
// 'auto' IFF audiences.<name>.approval==='auto' AND audiences.<name>.policyVersion===currentSchemaVersion
// else 'human'  (stale/mismatched version fails safe to human)
```

**Ownership:** `resolveAudiencePolicy`, `CURRENT_POLICY_SCHEMA_VERSION`, and
`isApprovalSatisfied` live in a **new owned module** `packages/minspec/src/lib/audience-policy.ts`
(this spec's sole `implements:`). Everything else — `approval.ts`, `config.ts`, `lifecycle.ts`,
the shared resolver, views, commands, `spec-gate.py` — is `affects:` (owned by SPEC-041 /
SPEC-022 / the gate spec), edited but not owned, so no ownership collision.

`getApprovalStatus(rootDir, specFilePath, policy?)` is the impure fs wrapper: when `policy`
is omitted it `loadConfig` + reads the spec's `audience:` frontmatter + applies
`resolveAudiencePolicy(config, audience, CURRENT_POLICY_SCHEMA_VERSION)`. The
`buildArtifactGraph` hot loop (artifact-graph.ts:326) **injects** an already-resolved policy
(memoize config once per graph build) to avoid N config loads.

## The gate-equivalent seam — `isApprovalSatisfied`

One exported helper is the single seam that makes `auto-approved` **gate-equivalent** while
staying **display-distinct**:

```ts
export const isApprovalSatisfied = (s: ApprovalStatus): boolean =>
  s === 'approved' || s === 'auto-approved';
```

Every **gate** site routes through it; every **display** site keeps an explicit
`auto-approved` arm. Gate sites (must change, none is compile-guarded except the map):

- `deriveStatus` lifecycle.ts:114: `approvalState!=='approved'` →
  `!isApprovalSatisfied(approvalState)`. Auto now advances to `implementing`/`done`. **T0
  test guards this** (line 114 is not compile-guarded).
- shared `next-task.ts`: `gateCleared` (:232), `isNextActionable` (:230), incoherence
  detector (:433), gate-emission `pendingApproval` (:687) — route through the helper.
  `naturalKind`/`isAdvancing` branch on record presence — unchanged.
- `approve.ts` (:179), `approve-active.ts` (:174).
- Python twin `is_approval_satisfied(a)` (below).

## Consumer checklist (every site — a miss is a lying signpost)

| Kind | File:line | Change |
|---|---|---|
| type | approval.ts:33 / 55-64 / 478 / 488 | `ApprovalStatus`+auto; `ApprovalRecord`+`kind`; `resolveStatus`+policy+fall-through; `getApprovalStatus`+optional policy; export `isApprovalSatisfied` |
| type | approval-store.ts:64-104 | `normalizeRecord` back-fill kind; `isValidRecord` kind∈{human,migrated}; **symmetric read backstop**: reject record whose `approvedBy ∈ BUILTIN_AGENT_IDENTITIES(+env)` as tampering |
| gate | lifecycle.ts:114 | `!isApprovalSatisfied(...)` |
| type | artifact-graph.ts:80 / 326 | `APPROVAL_STATE_MAP`+auto (compile guard); memoize config + inject resolved policy |
| twin | packages/shared/src/next-task.ts:52 / 232 / 433 / 687 | `ApprovalState`+auto; twin `isApprovalSatisfied`; gates via helper |
| display | spec-tree-provider.ts:327 / 337 / 367 / 384 / 391 | distinct icon (**not** `lock`, not `warning`), tag ` · auto-approved`, `contextValue 'specNode.autoApproved'`, tooltip "auto-approved by policy — no human review", a11y renders `${approval}` verbatim |
| gate | spec-tree-provider.ts:607-617 | `getNeedsReapprovalGroup` **unchanged** (stale-keyed; auto excluded by design) |
| display | approve-active.ts:186 | `describeNode` renders status verbatim → prints `auto-approved` (was a **missed** consumer) |
| gate | validate.ts:51 | feeds `auto-approved` to `validateSpec`; widen option type (was a **missed** consumer) |
| gate | spec-validator.ts:906 / 1154 | mirror-drift + monotonicity flow via `deriveStatus` (auto-safe); widen `approvalState` type; **add** `audience:` closed-set rule; **add** INV read-backstop rule |
| config | config.ts:43-59 / 105 | `MinspecConfig`+`audiences?`; post-merge audiences-only validator (bad `approval`→`'human'`+warn); export `resolveAudiencePolicy` + `CURRENT_POLICY_SCHEMA_VERSION` |
| type | spec.ts | optional `audience` frontmatter + `specAudience(fm)` helper |
| type | trust-metrics.ts / approval-diff.ts | tolerate new `kind`; auto has no record → existing undefined-record handling covers; `approval-diff` stays stale-keyed (no baselineBlob) |
| type | migrate-approvals.ts:106-115 | stamp `kind:'migrated'` (closes INV-2 hole) |
| twin | spec-gate.py:457-462 / 245-262 | +auto verdict branch; read-record reject `kind∉{human,migrated}` and `approvedBy∈denylist`; `_load_audience_policy` w/ version gate |
| gate | .githooks/pre-commit | **NEW** policy-authorship gate (below) |
| config | .github/workflows/ready-to-merge.yml | exclude PRs touching `audiences.*.approval` from native auto-merge → human/`--admin` lane |

## Config & audience mapping

`loadConfig` (config.ts:105) deep-merges with zero validation today. Add a **narrow
post-merge pass scoped to the `audiences` block only** (not a general schema): a bad
`approval` value coerces to `'human'` + `console.warn` (**fail safe toward review, never
silently auto**); garbage entries drop (→ absent → human). A spec maps to an audience via a
new optional closed-set `audience:` frontmatter field, validated against declared config keys
(absent or unknown → human, never auto by accident). The audiences validator + mapping +
version gate + human-default must be **byte-identical** in TS and Python, proven by shared
golden fixtures.

## Policy-authorship gate (the moved DR-056 surface)

Editing `audiences.<name>.approval` is a **human-only act**, enforced at two independent
layers so a bypass needs both to fail:

1. **Commit-time** — `.githooks/pre-commit`: if the staged diff changes
   `audiences.<name>.approval`, reject unless the committing git author passes `checkApprover`
   (not in `BUILTIN_AGENT_IDENTITIES`, incl `minspec-sdd[bot]`) **and** `enabledBy === author
   email`. Bypass env var like the existing RCDD gate.
2. **CI / merge-lane** — `spec-gate.py` enforces the same server-side (not bypassable by a
   missing local hook), and `ready-to-merge.yml` excludes config-policy PRs from native
   ai-review auto-merge (an AI reviewer is not a human approver) → human/`--admin` lane,
   mirroring the `.github/scripts` self-edit guard.

## Python twin & parity

- `spec-gate.py` verdict block (:457-462): add `elif _load_audience_policy(cwd, spec_rel,
  CURRENT_SCHEMA_VERSION)=='auto' and isinstance(cur,str): auto-approved`. Block set at `:491`
  unchanged (auto ∉ block set).
- `read_record` (:245-262): reject `kind∉{human,migrated}` and `approvedBy∈denylist`
  (symmetric backstop) → return None so such a sidecar never resolves to approved.
- New `_load_audience_policy` + `is_approval_satisfied` + policy-authorship enforcement,
  byte-identical to TS via **shared golden fixtures**.
- `canonical.py` — **no change** (hash-only; `kind` lives in the sidecar, not the body).

## Test plan (T0 first)

| Tier | File | Asserts |
|---|---|---|
| T0 | lifecycle.test.ts | `deriveStatus(all-done,'auto-approved',∅)==='done'`; never `'specifying'` (guards the un-compile-guarded L114) |
| T0 | approval.test.ts | resolveStatus: no-record+auto+hash→`auto-approved`; +hash null→`unapproved`; +human policy→`unapproved`; valid human record wins under auto; stale human stays stale under auto; `{kind:'auto'}`→falls through |
| T0 | config.test.ts | `resolveAudiencePolicy` version gate + fail-safe: auto+match→auto; auto+mismatch/absent→human; garbage→human+warn; unknown audience→human |
| T0 | approver-identity.test.ts | policy-authorship gate rejects bot author / `enabledBy≠author`; migrate output is `kind:'migrated'`; sidecar w/ `approvedBy∈denylist` rejected by `isValidRecord` |
| T0 | test_spec_gate.py | twin parity: auto verdict + PASS; auto+hash None→BLOCK; on-disk `kind:'auto'`→no-record/breach; human under auto stays approved/stale; version mismatch→human→BLOCK; bot-authored policy commit→breach |
| T1 | next-task.test.ts | `gateCleared('auto-approved')`; no pending-human task emitted; no incoherence flag for implementing+auto-approved |
| T1 | fixtures/parity | TS `resolveAudiencePolicy` vs py `_load_audience_policy` byte-identical on golden set |
| T2 | spec-tree-provider.test.ts | distinct auto arm (icon≠lock/≠warning, tag, contextValue); existing `:628` STATUS_GROUPS-exhaustive still passes (SpecStatus axis untouched) |
| T2 | validate.test.ts | `validate.ts:51` handles `auto-approved`; mirror-drift does not warn on a legitimately-advanced auto spec |
| T3 | approval.test.ts | FR-7 regression: auto spec → flip policy to human (or bump schema version) → `unapproved`; human records untouched across flip |

## Build order

1. Types + `isApprovalSatisfied` + `APPROVAL_STATE_MAP` (compile guard forces the cascade) — build red→green.
2. `resolveStatus` policy branch + defense-in-depth; `resolveAudiencePolicy` + `CURRENT_POLICY_SCHEMA_VERSION`; config validator. T0 tests.
3. `kind` on record + `normalizeRecord` back-fill + symmetric read backstop + `migrate-approvals` stamp. T0.
4. Gate-site routing (lifecycle, shared resolver, commands) + display arms (tree, approve-active). T1/T2.
5. Python twin + shared golden fixtures. Parity T0/T1.
6. Policy-authorship gate (`.githooks/pre-commit` + `spec-gate.py` + `ready-to-merge.yml`). T0.
7. `audience:` frontmatter + validator closed-set rule. T2.

All of 1–5 land in **one PR** (TS + shared + Python together) or parity tests fail.

## Risks

| Risk | Mitigation |
|---|---|
| FR-3 amendment rejected by reviewers (they hold per-item provenance load-bearing) → approach disqualified | Amendment submitted explicitly (below); fallback = persist/hybrid, which re-introduces the write-trigger/sweep/bot-writes INV-4 tension both winner and adversary flag |
| Policy-authorship pre-commit hook absent (fresh clone / hooksPath unset) or bypassed | Server-side twin in `spec-gate.py` (CI, unbypassable) **and** merge-lane exclusion — two independent layers must both fail |
| Twin drift (value + helper + resolver across minspec/shared/python) | Single PR + shared golden fixtures as parity oracle; CI parity blocks merge |
| Stale-human-under-auto surprises a solo PO-dev (record wins → shows stale) | Documented; the human `revokeApproval` to fall through to auto. Honest — never silently upgrades stale |
| Standing prospective waiver: one gated edit auto-approves all future specs; agent could author both audience + specs | `policyVersion`/`CURRENT_POLICY_SCHEMA_VERSION` forces human re-confirm on schema change; agent config edits forced through the human lane. Open decision to scope auto to human-authored creation commits |
| Terminal-collapse: auto spec at done/archived loses visible approval marker | Open decision: distinct terminal cue vs accept per RD-1 that terminal erases the approval axis for both kinds (absent sidecar = the distinguisher) |
| Missed display arm renders auto as fallback | Fails **safe** (under-shows, never launders as human); checklist + tests enumerate every display site |

## Spec amendments (plan-driven — applied to requirements.md)

- **FR-3 amend:** the auto policy **is** the record — a single committed per-audience
  `config.json` entry with `enabledBy` verified equal to the committing human git author by the
  policy-authorship gate; **no per-approvable sidecar** is written (state derived virtually);
  the informational `specHash` snapshot is dropped (RD-2 already declared it informational).
- **RD-2 reinterpret:** freshness = `audiences.<name>.policyVersion === CURRENT_POLICY_SCHEMA_VERSION`,
  evaluated live in `resolveAudiencePolicy` (no per-approvable pin).
- **FR-1 extend:** spec→audience mapping is a new optional closed-set `audience:` frontmatter
  field, validated against declared config keys (absent/unknown → human, never auto by accident).
- **New INV-5 (policy-authorship gate):** editing `audiences.<name>.approval` is a human-only
  act, enforced commit-time + CI + merge-lane.
- **New INV-6 (symmetric read backstop):** an on-disk record with `kind ∉ {human,migrated}` or
  `approvedBy ∈ denylist` is tampering, rejected at read time in both twins.
- **Migrate clarify:** migrate-approvals records are `kind:'migrated'` (WARN, counts as
  satisfied per FR-5) and never collapse to `'human'`.

## Open decisions

- Terminal-collapse cue: distinct marker for auto-advanced terminal specs vs accept RD-1
  erasure (recommend a cheap tooltip line — preserves honesty).
- Positive git artifact for auto-approval (append-only `.minspec/auto-approvals.log` or an
  `autoApprovedUnder:` frontmatter note) — closes an audit-by-absence gap; defer unless
  per-item audit is required. Never a `kind:'human'` record.
- Scope auto to specs whose **creation commit** is human-authored (blocks agent authoring both
  policy and specs) — weigh vs solo-dev ergonomics.
- `getApprovalStatus` memoization: optional param + memoized inject in the hot loop (recommended).
- Auto-approved tree glyph — defer to UX review (must differ from lock and warning).
