---
id: SPEC-024
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-007  # Agent Execute
relates_to: [SPEC-014, SPEC-012, SPEC-006]  # review-webview skim surface · next-task signpost · hollow-test scanner
---

# MinSpec — Auto-Merge Eligibility Gate (Requirements)

**Date:** 2026-06-07
**Status:** Specifying (SDD Specify phase)
**Decision:** [DR-033](../../../docs/decisions/DR-033.md) §3 (this spec is the *consumer* that decision describes but never had)
**Triggered by:** [#199](https://github.com/harvest316/minspec/issues/199) — "nothing consumes the signals to skip the PR gate; this is the actual auto-approve on-switch."
**Epic:** [EPIC-007 Agent Execute](../../../docs/epics/EPIC-007-agent-execute.md)

> ⚠️ **Read this one.** This is the single highest-consequence gate in MinSpec: it decides
> which PRs merge to `main` **with no human eyes**. Everything else in the auto-build chain
> is an input; this is the decision. If any doc deserves a careful human read before build,
> it is this one.

---

## Context

[DR-033](../../../docs/decisions/DR-033.md) §3 records the consequence-hybrid HITL gate:
low-blast changes auto-merge on green signals; high-blast changes hold for a ~30s
PR-summary read. But the codebase has **no consumer**: `classify()` emits a *tier*, the
three backstops emit *signals*, and the dev-time loop ([#172](https://github.com/harvest316/minspec/issues/172))
runs an **unconditional PR-gate** (everything holds). Nothing turns the signals into a
merge-vs-hold decision. This spec is that decision.

### Inputs already built (the backstops — all in open PRs, must merge first)

| Input | Source | State |
|---|---|---|
| 3-signal review block + input model | #180 → PR #194 (`renderReviewSignals` / `ReviewSignalsInput`) | wired into dispatch |
| hollow/stub test detector | #130 → PR #196 (`scanTestSource`) | **detector only, unwired** |
| blast-radius signals (consequence axis) | #88 → SPEC-023 → PR #198 (`runConsequenceAnalyzers`) | 4 graph-free ON, reach degraded |

### Two gaps this spec closes (found during analysis, [#199](https://github.com/harvest316/minspec/issues/199))

1. **No red→green prover.** #194 only *renders* `regressionProvenBaseRed`; nothing **sets**
   it. Signal-2 is therefore always UNVERIFIED. Auto-merging on an unproven regression =
   trusting the agent's own tests, the exact hole DR-033 names. → **FR-2** builds the prover.
2. **Degraded reach must fail safe.** impact-reach ships degraded (real index [#195](https://github.com/harvest316/minspec/issues/195)
   + validation [#91](https://github.com/harvest316/minspec/issues/91) pending). A degraded
   signal that floors `T1` (as SPEC-023 emits) is **unsafe** for the merge decision — it
   reads as "low blast" when blast is actually *unknown*. → **FR-4** conservative degrade.

## Resolved Clarifications (approved by Paul Harvey 2026-06-07)

| # | Decision |
|---|---|
| C1 | **Minimal on-switch.** Ship auto-merge using the 4 graph-free analyzers + conservative reach-degrade. Do NOT block on #195/#91 — they widen low-blast coverage later, they are not the on-switch. |
| C2 | **Eligibility is deny-by-default.** A change merges only if EVERY condition is affirmatively met. Any missing/unverified/unknown input ⇒ HOLD. There is no "probably fine." |
| C3 | **Subsumes #197.** This gate wires the #130 hollow-test detector as one of its inputs; #197's activation requirement is satisfied here. |
| C4 | **Default mode = consequence-hybrid** (#183 / DR-033), per-dev overridable. `PR-gate` mode = the gate always returns HOLD (status quo). `plan-gate` mode is out of scope (deferred). |

## Scope

### In scope
- **FR-1** the pure eligibility decision function.
- **FR-2** the red→green regression prover.
- **FR-3** hollow-test gate input (wires #130 — closes #197's activation).
- **FR-4** conservative reach-degrade rule + **FR-4a** the *derived* `touchesExportedSurface` (single source of truth).
- **FR-5** blast-radius classification of a PR (low vs high), deny-by-default over the analyzer's signal names.
- **FR-6** loop integration: replace #172's unconditional hold with eligible→merge / else→hold.
- **FR-7** an audit trail: every merge/hold decision records which conditions passed/failed.
- **FR-8** high-blast skim surface: hand the held PR + signal block to SPEC-014's in-IDE review-webview as a keyboard-first next-human-task (GitHub comment is the degraded fallback).

### Out of scope (explicitly)
- The real call-graph index (#195) and reach validation (#91) — conservative degrade covers their absence.
- `plan-gate` HITL mode (#183 option 2).
- Auto-merge of anything in the **held-for-human filter** (DR-033: marketing/legal/decide/irreversible-architecture/billing/published-sites) — those never reach this gate.
- Branch-protection / GitHub-side merge-queue config (deployment concern, separate).

## Invariants (must hold; T0 tests)

- **INV-1 Deny by default.** `decideAutoMerge` returns `eligible: true` ONLY when all FR-1
  conditions are affirmatively satisfied. Any unknown/missing/unverified input ⇒ `eligible:
  false`. Property test: a decision with any input absent is never eligible.
- **INV-2 Unmeasured blast = high blast.** reach degraded/unknown AND the diff touches an
  exported/public symbol ⇒ ineligible. Never auto-merge a change whose blast radius cannot
  be measured (FR-4).
- **INV-3 No unproven regression.** `eligible` requires `regressionProvenBaseRed === true`
  produced by the FR-2 prover (base actually ran red), not a self-reported field.
- **INV-4 Hollow tests block.** Any `scanTestSource` finding (`stub` OR `hollow`) on a
  changed/added test ⇒ ineligible.
- **INV-5 Held-for-human filter is upstream and absolute.** This gate is only ever invoked
  for already-auto-build-eligible issues (DR-033 filter). It does not re-litigate the filter;
  it assumes it. (Documented so no one wires it to bypass the filter.)
- **INV-6 Decision is pure + auditable.** `decideAutoMerge` is a pure function of its inputs
  (the IO — running the prover, reading signals — happens upstream and is passed in). Every
  decision emits a structured reason (FR-7).
- **INV-7 Keyboard-first approve.** The high-blast approve+merge action (FR-8) is reachable
  by a two-key chord / hotkey, never mouse-only. It is the highest-frequency human action in
  the loop; a mouse-only path is a defect (global RSI rule). T-test: the surface exposes a
  bound key for approve+merge.

## Functional Requirements

- **FR-1 Eligibility decision.** `decideAutoMerge(input: AutoMergeInput): AutoMergeDecision`.
  `eligible` iff: all three review signals green (incl. prover-produced red→green, INV-3)
  **and** no hollow/stub finding **and** blast-radius = low (FR-5) **and** (reach known low
  **or** `touchesExportedSurface` is false — the FR-4a *derived* predicate, not a caller
  boolean). Otherwise `{ eligible: false, reason, failed: string[] }`.
- **FR-2 Red→green prover.** Given the PR's base SHA, head SHA, and the named regression
  test(s): in an isolated checkout/worktree, run the test against **base** and assert it
  FAILS; run against **head** and assert it PASSES. Emits `regressionProvenBaseRed` +
  `regressionGreenOnHead`. Honest failure modes: test not found, test green on base (not a
  real regression), test red on head → all ⇒ NOT proven ⇒ ineligible. This is IO/exec
  (not Tier-0-pure) → lives in the dispatch/script layer, feeds the pure FR-1 as data.
  **The prover is the sole authority for `regressionProvenBaseRed`:** the dispatch MUST
  overwrite any agent-supplied value on `ReviewSignalsInput` with the prover's result, so a
  self-reported `true` can never survive into FR-1 (INV-3). Absent/failed prover run ⇒ `false`.
- **FR-3 Hollow-test input.** Run `scanTestSource` (#130) over changed/added test files;
  any finding ⇒ INV-4 ineligible. (This is the activation #197 asked for.)
- **FR-4 Conservative reach-degrade.** When a consequence signal set contains the
  `reach_unavailable` degraded marker (SPEC-023 FR-1) AND `touchesExportedSurface` (FR-4a) is
  true, classify the PR **high-blast** (hold). Reach-unknown is treated as worst-case, never
  best-case. (In v1 `reach_unavailable` is *always* present — impact-reach has no index — so
  every v1 merge's safety reduces to `touchesExportedSurface`; its derivation is therefore
  load-bearing and pinned in FR-4a.)
- **FR-4a `touchesExportedSurface` is DERIVED, not a caller input.** Compute it inside the
  gate from `consequenceSignals`: true iff any `public_api_added` / `public_api_changed` /
  `public_api_removed` signal is present. **Fail-safe:** if the public-API analyzer emitted a
  degraded/`export *` sentinel or a "content-unavailable" `public_api_changed` (it could not
  read the old/new surface — a documented `publicApiAnalyzer` blind spot), force
  `touchesExportedSurface = true`. It is never supplied by the dispatch as an independent
  boolean (that would be a second, un-reconciled source of truth for the one conjunct the v1
  gate leans on). Unknown/unreadable surface ⇒ assume exported-touch ⇒ hold.
- **FR-5 Blast classification (deny-by-default over signal *names*).** Map the consequence
  signal set to `low | high`. The classifier keys on the analyzer's **actual emitted signal
  names**, not abstract families, and **defaults unknown names to `high`** (a novel/unmapped
  signal is treated as dangerous until a human classifies it — the inverse of an allowlist).
  Concretely, from the live `consequence-analyzers.ts` (SPEC-023): **high** if any of —
  `irreversible_deletion`, `irreversible_migration`, `destructive_schema_op` (irreversibility);
  `sensitive_sink`; `public_api_added` / `public_api_changed` / `public_api_removed`;
  `concurrency`, `timer`, `transaction` — trips, OR the FR-4 degrade condition holds, **OR any
  consequence signal name not in the low-blast recognition set is present**. A signal counts
  toward `low` only if it is explicitly recognized as low-blast (currently: the `reach_unavailable`
  degrade marker is handled by FR-4, not counted low here; there is no other low-blast signal in
  v1). Any future analyzer signal is therefore `high` until this list is deliberately updated.
  (This is the routing DR-033 §3 keys auto-merge on; erring `high` costs a 30s skim, erring
  `low` costs a bad `main`.)
- **FR-6 Loop integration.** In the #172 dispatch, after a PR's checks are green, call the
  prover (FR-2) + gate (FR-1). `eligible` ⇒ `gh pr merge --squash` (low-blast, no human).
  Else ⇒ **do not merge; emit a high-blast review task (FR-8)** carrying the #180 signal
  block + the blast reason, and label the PR `needs-human-skim`. Honors the per-dev mode
  (C4): in `PR-gate` mode the gate always holds (every PR routes to FR-8).
- **FR-7 Decision audit.** Every invocation appends a record (PR#, eligible, failed
  conditions, blast class, signal snapshot) to an audit log, so a wrong auto-merge is
  traceable to which condition lied.
- **FR-8 High-blast skim surface (hand-off to SPEC-014).** A held PR surfaces as a
  **next-human-task** in the [SPEC-012](../SPEC-012-next-task-resolver/requirements.md)
  signpost and renders **in-IDE** via the [SPEC-014](../SPEC-014-review-webview/requirements.md)
  review-webview — non-modal (#104), not a GitHub tab the human must go find. The surface
  shows the #180 three-signal block + the one-line blast reason (which consequence signal
  tripped, e.g. "sensitive-sink: auth/"), and offers exactly two actions: **approve+merge**
  and **open diff**. The approve+merge action MUST be reachable by a **two-key chord /
  keyboard hotkey** (INV-7) — skimming + merging high-blast PRs is the *highest-frequency*
  human action in the loop, so the keyboard path is a requirement, not an enhancement.
  **Degraded fallback** (honest, not silent): when no IDE surface is attached (headless /
  cron / CI dispatch), FR-6 posts the same block as a GitHub PR comment and the human
  merges via `gh pr merge`. The block content is identical across surfaces (one renderer,
  #180) — only the host differs.

## Contract (TypeScript sketch)

```ts
interface AutoMergeInput {
  readonly reviewSignals: ReviewSignalsInput;      // from #180; regressionProvenBaseRed OVERWRITTEN by the FR-2 prover
  readonly hollowFindings: TestFinding[];          // from #130 scanTestSource
  readonly consequenceSignals: ClassificationSignal[]; // from #88 runConsequenceAnalyzers — sole source for blast + exported-surface
  readonly mode: 'consequence-hybrid' | 'pr-gate'; // #183 per-dev (default hybrid)
  // NOTE: touchesExportedSurface is NOT an input — it is DERIVED from consequenceSignals (FR-4a),
  // so the gate has a single source of truth. blast is DERIVED via FR-5 (deny-by-default on names).
}
interface AutoMergeDecision {
  readonly eligible: boolean;
  readonly blast: 'low' | 'high';
  readonly reason: string;
  readonly failed: string[];   // condition keys that blocked eligibility ([] iff eligible)
}
type DecideAutoMerge = (input: AutoMergeInput) => AutoMergeDecision;

// FR-2, IO layer (not pure):
interface ProverResult {
  regressionProvenBaseRed: boolean;
  regressionGreenOnHead: boolean;
  note: string; // "test X red on base, green on head" | "test not found" | ...
}
```

## Test Plan

**T0 (invariants):** INV-1 deny-by-default property (drop any input → never eligible);
INV-2 degraded-reach + exported touch → ineligible; INV-3 self-reported (un-proven)
regression → ineligible; INV-4 any hollow/stub finding → ineligible; INV-6 purity + every
decision has a non-empty reason. **FR-5 deny-by-default:** a novel/unmapped consequence
signal name (e.g. a fabricated `"future_signal"`) → **high-blast** (guards the allowlist
inversion, finding 1); each of `destructive_schema_op` / `timer` / `transaction` alone →
high. **FR-4a derivation:** `reach_unavailable` + an `export *` sentinel (or content-unavailable
`public_api_changed`) → `touchesExportedSurface=true` → ineligible (guards the second-source-of-truth
hole, finding 2); no `public_api_*` signal → `touchesExportedSurface=false`.

**T1 (contract):** a fully-green low-blast change → eligible; each single failing condition
flips it to ineligible with the right `failed[]` key; a change tripping any high signal
(`irreversible_*` / `destructive_schema_op` / `sensitive_sink` / `public_api_*` /
`concurrency` / `timer` / `transaction`) → high-blast hold even with all review signals green;
`pr-gate` mode → always hold.

**FR-2 prover tests:** a real regression (red→green) proves; a test green-on-base → not
proven; a test red-on-head → not proven; missing test → not proven.

## Risks

- **A wrong auto-merge reaches `main` unseen.** Mitigations: deny-by-default (INV-1),
  unmeasured-blast-is-high (INV-2), real prover not self-report (INV-3), audit trail (FR-7),
  and per-dev `pr-gate` kill-switch (C4). The human merge of THIS spec's PR is itself the
  backstop for the gate's own correctness.
- **Prover flakiness** (flaky regression on base/head). Mitigation: prover treats any
  non-deterministic result as NOT proven ⇒ hold (fail safe).
- **Over-conservative = nothing auto-merges.** Acceptable failure direction: a held PR costs
  a 30s skim; a wrong merge costs a bad `main`. Bias to hold.

## Follow-ups (tracked)

- Widen low-blast coverage once reach is real + validated: #195 (index), #91 (validation).
- **FR-8's in-IDE path is gated on [SPEC-014](../SPEC-014-review-webview/requirements.md)**
  (`status: specifying` — no built webview yet). Buildable now: the GitHub-comment degraded
  fallback; the keyboard-first review-webview surface + the INV-7 T-test land only when
  SPEC-014 ships. Not read as buildable-now.
- `plan-gate` HITL mode (#183 option 2) — deferred.
- Productize as the `aiclarity.agent-execute` gate surface (EPIC-007) — this dev-time gate is the prototype.
