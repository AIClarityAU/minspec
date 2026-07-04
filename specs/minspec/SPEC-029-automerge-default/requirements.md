---
id: SPEC-029
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute
relates_to: [SPEC-024, SPEC-023]  # the auto-merge gate this configures · the consequence signals it gates on
---

# MinSpec — Auto-Merge Default (init-time question) — Requirements

**Date:** 2026-07-04
**Status:** Specifying (SDD Specify phase)
**Decision:** [DR-033](../../../docs/decisions/DR-033.md) §3 (consequence-hybrid HITL gate-placement) · [#183](https://github.com/AIClarityAU/minspec/issues/183) (the three gate-placement modes)
**Triggered by:** [#229](https://github.com/AIClarityAU/minspec/issues/229) — "init-time question to set auto-merge-on-clean default (gate-placement #183)."
**Consumes:** [SPEC-024](../SPEC-024-auto-merge-eligibility/requirements.md) — the eligibility gate. This spec supplies the `mode` input that SPEC-024 FR-6 / C4 reads; it does not change the gate.

> This spec sets the **project's default answer** to one question: *when reviewer +
> security verdicts come back CLEAN, should a low-blast PR auto-merge, or hold for a
> ~30s human read?* It is a **policy + UX** surface, not a decision engine — SPEC-024 is
> the engine. The **shipped default and its safety linkage are human-only calls** (issue
> #229 triage: `decide/policy`); see *Decisions needed (Clarify)*.

---

## Context

SPEC-024's gate already resolves a `mode` (`consequence-hybrid` | `pr-gate`), but today
that mode comes **only** from an environment variable: `dispatch-issue.sh:382` reads
`MINSPEC_AUTOMERGE_MODE` (default `pr-gate`), exact-string `consequence-hybrid` to opt in.
**Nothing persists or asks for that choice** — a project has no durable, discoverable way
to record "auto-merge low-blast is on/off here." A dev must remember to export an env var
on every dispatch. #229 closes that: ask **once, at init**, persist the answer as project
policy, and have the dispatch read it.

This is the on-ramp for auto-merge. The gate ships **off** (`pr-gate`) and is
deny-by-default; this spec is how a project deliberately, visibly turns it on.

### What exists (do not rebuild)

| Piece | Where | State |
|---|---|---|
| Pure eligibility gate + mode kill-switch | `packages/minspec/src/lib/auto-merge.ts` (SPEC-024) | built |
| Mode resolution (env → mode), merge action | `scripts/dispatch-issue.sh:382`, `:431` | built (env-only source) |
| Typed project config loader + defaults | `packages/minspec/src/lib/config.ts:37,83` | built |
| Idempotent `config.json` scaffold (never overwrites) | `packages/minspec/src/lib/scaffold.ts:263` | built |
| Post-init non-modal offer pattern | `init.ts` `offerScaffoldCommit` / `offerRulesetAdvisory` | built (the pattern to follow) |
| VS Code `contributes.configuration` block | `packages/minspec/package.json:429` | built (extend it) |

## Scope

### In scope
- **FR-1** persist the mode as **project policy** in `.minspec/config.json` (`autoMerge.mode`), with a typed default in `config.ts`.
- **FR-2** the **init-time question** — a non-modal, ask-once post-init offer that writes the choice, following the `offerScaffoldCommit`/`offerRulesetAdvisory` pattern.
- **FR-3** **wire the dispatch** to read `config.json` as the mode source (env var stays as an explicit override for CI/one-off).
- **FR-4** a **VS Code Workspace-scoped setting** (`minspec.autoMerge.mode`) mirroring the config, for Settings-UI discoverability and change-later — write-through to `config.json` (single source of truth for the script).

### Out of scope (explicitly)
- The eligibility decision itself — that is SPEC-024 and unchanged here.
- `plan-gate` HITL mode (#183 option 2) — deferred with SPEC-024.
- Closing SPEC-024's open wrong-merge holes (#489 / #490 / #491 / #466) — separate; but they **bear on the Clarify decision below** (whether to even offer the on-switch yet).
- Per-issue / per-PR mode override — the mode is per-project policy.

## Invariants (must hold; T0 tests)

- **INV-1 Deny-by-default default.** The shipped default is `pr-gate` (auto-merge OFF).
  An absent / malformed / unknown `autoMerge.mode` resolves to `pr-gate`. Only the exact
  string `consequence-hybrid` enables auto-merge. **No fail-open path** — mirrors the
  SPEC-024 gate kill-switch (`auto-merge-gate.ts` `normalizeMode`).
- **INV-2 Dismissal is safe.** If the init question is dismissed / escaped / times out,
  the project is left at `pr-gate`. The question **never** pre-selects or defaults to
  `consequence-hybrid`; there is no dark-pattern nudge toward auto-merge. Turning auto-merge
  on is always an explicit, affirmative click.
- **INV-3 Project scope, never global.** The setting is **Workspace / project-policy**
  scope. A personal/Global default must never silently switch on auto-merge for every
  project the user opens (per the HITL config-scope rule: scope by who-owns-the-pref —
  merge policy is owned by the project, not the person).
- **INV-4 Single source of truth for the consumer.** `.minspec/config.json` is
  authoritative for the dispatch script. The VS Code setting (FR-4) writes through to it
  and must not diverge; the script never reads VS Code settings directly.
- **INV-5 Ask at most once.** The init question is idempotent — asked only when
  `autoMerge.mode` is absent. Re-running init / refresh never re-asks a project that has
  already answered (respects `scaffold.ts` config idempotency). Changing the answer later
  is done through the setting (FR-4), not by re-prompting.
- **INV-6 Enabling is auditable.** The resolved mode is already recorded per-decision by
  SPEC-024 (FR-7 audit + `dispatch-issue.sh` log line). Enabling auto-merge for a project
  is a committed change to `config.json` — visible in git, not a hidden runtime flag.

## Functional Requirements

- **FR-1 Persisted policy.** Add `autoMerge: { mode: 'pr-gate' | 'consequence-hybrid' }`
  to the `config.ts` shape and defaults (`mode` default `'pr-gate'`). `loadConfig` returns
  it merged with defaults so absence reads as `pr-gate`. `scaffold.ts` continues to write
  `config.json` without an `autoMerge` block by default (absence ⇒ off), or writes an
  explicit `pr-gate` — **whichever keeps INV-1/INV-5** (an explicit `pr-gate` is clearer;
  an absent key is simpler — pin in Plan).
- **FR-2 Init-time question.** After the scaffold/harness writes in `initCommand`
  (`init.ts:428`+), and only when `autoMerge.mode` is **absent**, present a non-modal offer
  (following `offerScaffoldCommit`): *"When review + security come back clean, auto-merge
  low-blast PRs automatically, or hold every PR for a ~30-second human read?"* Two explicit
  actions — **"Hold every PR (recommended)"** → `pr-gate`; **"Auto-merge low-blast"** →
  `consequence-hybrid`. Dismiss ⇒ `pr-gate` (INV-2). Writes the chosen mode to
  `config.json`. Never blocks the init result (best-effort, like the ruleset advisory).
- **FR-3 Dispatch reads the policy.** In `dispatch-issue.sh`, resolve the mode with
  precedence: explicit `MINSPEC_AUTOMERGE_MODE` env (override for CI/one-off) →
  `.minspec/config.json` `autoMerge.mode` → `pr-gate`. Preserve the exact-string,
  no-fail-open guard: any value other than `consequence-hybrid` ⇒ `pr-gate` (INV-1). Add
  the `config.json` read (currently `:382` reads env only).
- **FR-4 VS Code setting (write-through mirror).** Add `minspec.autoMerge.mode` (enum
  `pr-gate` | `consequence-hybrid`, default `pr-gate`, `scope: "resource"`/window i.e.
  Workspace, `markdownDescription` naming the consequence) to `package.json`
  `contributes.configuration`. Changing it writes through to `.minspec/config.json` (INV-4);
  the Settings UI is a discoverable change-later surface, not a second source of truth.

## Contract (TypeScript sketch)

```ts
// config.ts shape extension
type AutoMergeMode = 'pr-gate' | 'consequence-hybrid';
interface MinspecConfig {
  // …existing (version, specsDir, decisionsDir, thresholds, phaseMappings)…
  autoMerge?: { mode: AutoMergeMode };   // absent ⇒ 'pr-gate' (INV-1)
}
// resolution (mirrors dispatch precedence)
const resolveMode = (env: string | undefined, cfg?: AutoMergeMode): AutoMergeMode =>
  env === 'consequence-hybrid' ? 'consequence-hybrid'
  : (env && env !== '') ? 'pr-gate'                 // explicit non-optin env ⇒ off
  : cfg === 'consequence-hybrid' ? 'consequence-hybrid'
  : 'pr-gate';                                      // absent/unknown ⇒ off (deny-by-default)
```

## Decisions needed (Clarify — human-only, #229 `decide/policy`)

- **C1 — Shipped default.** Confirm the shipped/default answer is **`pr-gate`** (hold every
  PR; auto-merge off). *(Recommended: yes — deny-by-default, and it matches the existing
  gate kill-switch. This spec assumes it.)*
- **C2 — Offer the on-switch now, given SPEC-024's open holes?** Enabling
  `consequence-hybrid` routes low-blast PRs to a **no-human merge** through the SPEC-024
  gate, which still has **open wrong-merge holes**: #489 (self-reported root cause), #490
  (analyzer false-negative on subtle code), #491 (swallowed audit failure). Choose:
  - **(a)** the init question offers **only `pr-gate`** (auto-merge visibly "coming soon,
    gated on #489/#490/#491") until those close — *safest, honours never-wrong*;
  - **(b)** offer both, but the `consequence-hybrid` action shows a **loud warning** naming
    the open holes before it writes;
  - **(c)** offer both freely (the gate is deny-by-default and the holes are pre-existing).
  *(Recommendation: **(a)** or **(b)**. The whole product promise is a never-wrong signpost;
  shipping a one-click on-switch for a gate with three known un-closed wrong-merge paths
  undercuts it. This is your call.)*
- **C3 — Setting is authoritative or config.json?** Confirm `config.json` is the source of
  truth and the VS Code setting writes through (FR-4 / INV-4), vs. making the setting
  primary. *(Recommended: config.json primary — the dev-time script consumer cannot read VS
  Code settings.)*

## Test Plan

- **T0 (invariants):** INV-1 absent/`""`/garbage/`PR-GATE`(wrong case) `autoMerge.mode` →
  resolves `pr-gate`; only exact `consequence-hybrid` → on. INV-2 dismissed init question →
  `pr-gate` and no write of `consequence-hybrid`. INV-3 the setting's declared scope is
  Workspace (assert `package.json` `scope`). INV-4 writing the setting updates
  `config.json`. INV-5 init with an existing `autoMerge.mode` → question NOT shown.
- **T1 (contract):** `resolveMode` precedence table (env override > config > default);
  `loadConfig` merges an absent `autoMerge` to the default.
- **FR-3 dispatch:** a `config.json` with `consequence-hybrid` and no env → dispatch runs
  the gate in hybrid; env `pr-gate` overrides a config `consequence-hybrid` → hold.

## Risks

- **A global/personal default silently auto-merges every project.** Mitigation: INV-3
  Workspace scope; T0 asserts the declared scope.
- **The on-switch outruns the gate's correctness.** Mitigation: C2 — gate the offer (or warn)
  on #489/#490/#491. Erring toward "hold" costs a 30s skim; erring "merge" costs a bad `main`.
- **Two sources of truth (setting vs config.json) drift.** Mitigation: INV-4 write-through,
  config.json authoritative; the script never reads settings.

## Follow-ups (tracked)

- SPEC-024 open wrong-merge holes that condition C2: #489, #490, #491 (+ #466 TOCTOU).
- If C2 chooses (a)/(b), the "auto-merge available once #489/#490/#491 close" state may want
  a small follow-up to flip the offer on when they land.
- `plan-gate` HITL mode (#183 option 2) — deferred with SPEC-024.
