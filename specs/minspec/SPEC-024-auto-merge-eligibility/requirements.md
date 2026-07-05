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
**Status:** Specifying (derived — INV-1: unapproved ⇒ `specifying`, regardless of code state; see `deriveStatus`, `packages/minspec/src/lib/lifecycle.ts:114`). This is **not actually accurate to the codebase**: the gate is built, merged (#412), and running (`packages/shared/src/review-signals.ts`), with acceptance criteria backfilled (#492). But this T4 spec was never run through the real Approve step, so the derived status floors at `specifying` and cannot legitimately read `implementing` or `done` until a human approves it. Once approved, status will next derive from phase completion — `done` is additionally gated on open acceptance holes #489/#490/#491/#466 + INV-7 keyboard.
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
  `concurrency` (its `explain` covers the timer/transaction sub-patterns — `concurrency` is the
  only emitted name) — trips, OR the FR-4 degrade condition holds, **OR any
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

## Acceptance Criteria

Each criterion is a checkable pass/fail condition on the built gate, traceable to the
FR/INV it discharges and to the test (or code) that proves it. **This section was written
*after* the gate merged (PR #412); the status column is an audit of the merged code, not a
forward plan.** A criterion is met only on the **authoritative** signal (the test asserts
the behaviour / the code path exists), never on artifact-existence (RCDD evidence
discipline).

**Status legend:** ✅ met (code + passing test) · 🟡 met, test-gap (code present, no
dedicated test found — add a T-test) · ⛔ unmet (required, not implemented) · ⏳ deferred
(explicitly out of v1 scope or gated on another spec).

### A. Core eligibility & purity

- **AC-1 — Deny-by-default.** Given an `AutoMergeInput` with **any** required conjunct
  absent / `undefined` / unknown, When `decideAutoMerge` runs, Then `eligible === false`
  and `failed[]` names the missing conjunct; an entirely empty object never throws and is
  ineligible. *(FR-1, INV-1 — ✅ `auto-merge.test.ts:124` drop-each-input property + `:150`;
  🟡 sub-clause "`failed[]` names the missing conjunct" is code-only (`auto-merge.ts:338–364`) —
  the property test asserts only `failed.length > 0`, not the specific key. Add a key-assertion test.)*
- **AC-2 — Eligible baseline.** Given all three review signals green (prover-verified
  red→green), no hollow/stub findings, `blast === 'low'`, and (reach known-low **or**
  `touchesExportedSurface === false`), When `decideAutoMerge` runs, Then `eligible === true`,
  `blast === 'low'`, `failed === []`. *(FR-1 — ✅ `auto-merge.test.ts:112`.)*
- **AC-3 — Pure Tier-0 + always-reasoned.** `decideAutoMerge` performs no IO (imports no
  `vscode` / `fs` / `path` / `child_process` / network; value-level imports are type-only,
  erased at runtime) and **every** decision — eligible or not — carries a non-empty `reason`
  and a `failed[]` that is `[]` iff eligible. *(INV-6 — ✅ purity `auto-merge.test.ts:431`;
  non-empty reason + `failed === []` on the eligible path `auto-merge.test.ts:113–118`.)*

### B. Regression prover — sole authority (INV-3 / FR-2)

- **AC-4 — Prover overrides self-report.** Given `reviewSignals.regressionProvenBaseRed ===
  true` but **no** `proverResult`, Then ineligible; and given a genuine prover red→green
  with a self-report of `false`, Then the prover wins ⇒ eligible. The agent's self-report is
  never trusted. *(INV-3 — ✅ `auto-merge.test.ts:159`.)*
- **AC-5 — Honest prover failure modes.** green-on-base / red-on-head / test-not-found /
  flaky-across-runs / no-test-named / broken-base-env / load-collection-error on base ⇒ **NOT
  proven** ⇒ ineligible. A "red" verdict requires an *executed assertion failure*, never a
  load error. *(FR-2 — ✅ `auto-merge-gate.test.ts:118` + `:152`.)*

### C. Hollow / stub tests (INV-4 / FR-3)

- **AC-6 — Any hollow or stub finding blocks.** Given `scanTestSource` returns ≥1 finding of
  kind `hollow` **or** `stub` on a changed/added test, Then ineligible (`failed` ∋
  `hollow-tests`); a missing `hollowFindings` array ⇒ ineligible
  (`hollow-findings-missing`). Closes #197's activation requirement. *(INV-4, FR-3 — ✅
  present-finding path `auto-merge.test.ts:207`; 🟡 the `hollow-findings-missing` (absent-array)
  key is code-only (`auto-merge.ts:353–355`) — no test names it. Add one.)*

### D. Blast classification — deny-by-default over signal NAMES (FR-5)

- **AC-7 — Unknown name ⇒ high (allowlist inversion).** Given a novel/unmapped consequence
  signal name (e.g. a fabricated `future_signal`), Then `blast === 'high'` and the change is
  ineligible. A signal counts toward `low` only if explicitly recognized as low-blast (v1: none).
  *(FR-5 — ✅ `auto-merge.test.ts:223` + end-to-end `:262`.)*
- **AC-8 — Recognized high signals hold.** Any of `irreversible_deletion` /
  `irreversible_migration` / `destructive_schema_op` / `sensitive_sink` / `public_api_*` /
  `concurrency` ⇒ high-blast hold **even with all three review signals green**. *(FR-5 — ✅
  `auto-merge.test.ts:236` + `:401`.)*
- **AC-9 — The only low outcome.** A signal set containing at most the `reach_unavailable`
  marker and **no** exported touch ⇒ `low`; an empty signal set ⇒ `low`. *(FR-5 — ✅
  `auto-merge.test.ts:254`.)*
- **AC-10 — Manifest change ⇒ high (defence-in-depth, #414 / BLOCKER-1).** A changed
  dependency/boundary manifest (`package.json`, `exports`/`main`/`bin`, lockfile, workspace
  manifest) — which the public-API analyzer skips — is injected as `manifest_changed` by the
  IO layer and classifies **high**; a `package.json`-only diff holds end-to-end. *(Extends
  FR-5 beyond the doc's original signal list — ✅ `auto-merge.test.ts:272`,
  `auto-merge-gate.test.ts:235`.)*
- **AC-11 — CI/build boundary change ⇒ high (#422).** A diff touching a CI/build boundary
  (`.github/workflows/*`, `tsconfig.json`, `.npmrc`, `Jenkinsfile`, `.githooks/*`, …) holds;
  an ordinary `src/*.ts` change is **not** force-escalated by this matcher. *(Extends FR-5 —
  ✅ `auto-merge-gate.test.ts:286`.)*

### E. Reach & exported surface (INV-2 / FR-4 / FR-4a)

- **AC-12 — `touchesExportedSurface` is derived, never an input.** Computed inside the gate
  as `some(signal ∈ public_api_*)`; there is no caller boolean. *(FR-4a — ✅
  `auto-merge.test.ts:301`.)*
- **AC-13 — Degraded surface fails safe to "touched".** A degraded / `export *` sentinel or a
  content-unavailable `public_api_changed` (analyzer couldn't read old/new surface) forces
  `touchesExportedSurface === true`. *(FR-4a — ✅ `auto-merge.test.ts:302` + `:312`.)*
- **AC-14 — Unmeasured blast = high (v1 load-bearing conjunct).** `reach_unavailable` +
  exported touch ⇒ high, ineligible (`failed` ∋ `unmeasured-blast`); `reachKnownLow` is
  **always** `false` in v1 (no index), so eligibility's reach conjunct reduces to
  `!touchesExportedSurface`. *(INV-2, FR-4 — ✅ `auto-merge.test.ts:344`.)*
- **AC-15 — No exported signal ⇒ not touched.** No `public_api_*` signal present ⇒
  `touchesExportedSurface === false`. *(FR-4a — ✅ `auto-merge.test.ts:321`.)*

### F. Mode, kill-switch & loop integration (C4 / FR-6)

- **AC-16 — `pr-gate` mode always holds.** A change that would be eligible under
  `consequence-hybrid` holds under `pr-gate`, and the hold still reports the derived blast
  class. *(C4 — ✅ `auto-merge.test.ts:412`.)*
- **AC-17 — Mode resolves deny-by-default at the IO seam.** `parseArgs` with no `--mode` ⇒
  `pr-gate` (**auto-merge OFF by default**); garbage `--mode` ⇒ `pr-gate`; only the exact
  opt-in token ⇒ `consequence-hybrid`. No fail-open. *(C4 / MAJOR-4 — ✅
  `auto-merge-gate.test.ts:85`.)*
- **AC-18 — Loop wires eligible→merge / else→hold (merge predicate is a conjunction, not
  `eligible` alone).** In the #172 dispatch, a PR merges (`gh pr merge --squash`, no human)
  **only** when `ELIGIBLE === true` **AND** a PR number is resolved **AND**
  `AUTOMERGE_MODE === consequence-hybrid` **AND** the independent-reviewer `ready-to-merge`
  status is `success` (`dispatch-issue.sh:431–433`). `eligible` is necessary, not sufficient —
  the reviewer greenlight is an additional gate. Any miss ⇒ **no merge**, PR labelled
  `needs-human-skim`, hold body (the #180 signal block + blast reason) posted. *(FR-6 — ✅
  code `dispatch-issue.sh:431–440` merge / `:440,:463` label / `:462` hold comment. 🟡 no
  end-to-end shell test for the branch selection or the four-way conjunction — add one.)*
- **AC-19 — Diff failure fails safe to HOLD.** An unresolvable base ref / git failure ⇒
  `buildChangedFiles` throws ⇒ `main()`'s catch converts it to a HOLD; never a silent 0-file
  diff read as "nothing changed". *(FR-6 / MAJOR-5 — ✅ the *throw* is tested
  `auto-merge-gate.test.ts:464`; 🟡 the throw→HOLD conversion in `main()` (`auto-merge-gate.ts:714–731`)
  is code-only — no test drives `main()`'s catch to assert a HOLD is emitted. Add one.)*

### G. Audit trail (FR-7)

- **AC-20 — Every decision is recorded.** Each gate invocation appends a record (PR#,
  eligible, `failed[]`, blast, signal snapshot) to `.minspec/auto-merge-audit.log` (resolved
  to the shared main-repo root across worktrees), so a wrong auto-merge is traceable to the
  condition that lied. *(FR-7 — 🟡 code `auto-merge-gate.ts:591–615`, called `:691`; **no
  dedicated test** for the appended record's shape/content — add a T1.)*

### H. High-blast skim surface (FR-8 / INV-7)

- **AC-21 — Degraded GitHub-comment fallback (buildable now).** With no IDE surface attached
  (headless / cron / CI), the held PR receives the identical #180 signal block + one-line
  blast reason as a `gh pr comment`; the human merges via `gh pr merge`. One renderer across
  surfaces. *(FR-8 fallback — ✅ code `auto-merge-gate.ts:707` render + `dispatch-issue.sh:462`
  post. 🟡 no test asserting the posted body equals the renderer output — add one.)*
- **AC-22 — In-IDE review surface (gated on SPEC-014).** A held PR surfaces as a
  [SPEC-012](../SPEC-012-next-task-resolver/requirements.md) next-human-task and renders in the
  [SPEC-014](../SPEC-014-review-webview/requirements.md) review-webview (non-modal), offering
  exactly two actions — approve+merge, open diff. *(FR-8 in-IDE — ⛔ **not wired**:
  `dispatch-issue.sh:445` itself notes the in-IDE surface is deferred; only the AC-21 fallback
  exists. SPEC-014 is now `status: implementing` — the Follow-ups note below is stale.)*
- **AC-23 — Keyboard-first approve+merge (INV-7).** The approve+merge action is bound to a
  two-key chord / hotkey — never mouse-only — with a T-test asserting a bound key exists.
  *(INV-7 — ⛔ **unmet**: depends on the AC-22 surface, which is not built; no bound key, no
  T-test. This is the one hard invariant with zero coverage and must gate the FR-8 in-IDE
  build.)*

### I. Upstream scope guard (INV-5)

- **AC-24 — Gate assumes the held-for-human filter, never re-litigates it.** The gate is
  invoked only for issues already past the DR-033 held-for-human filter
  (marketing/legal/decide/irreversible-architecture/billing/published-sites never reach it);
  it does not re-check the filter. *(INV-5 — this is a **documentation assertion, not a
  self-checkable criterion**: the pure gate cannot verify an upstream property, so there is
  nothing for it to assert. Documented at `auto-merge.ts:27`. **Checkable form to add:** a
  dispatch-level test that the gate is never invoked for a held-for-human category — that
  test, not the gate, is the enforceable acceptance condition.)*

### J. Known wrong-merge directions with NO acceptance coverage (⛔ — the audit's real teeth)

A wrong `eligible` reaches `main` unseen; these are the paths by which the *current* gate
could emit one, none of which any AC above closes. Surfaced by the adversarial audit of PR
#412; each is a required acceptance condition the gate does **not** yet meet. Materialized as
tracked issues (Follow-ups) — an unmet ⛔ here is a live hole, not a note.

- **AC-25 — Signal-1 (root cause) must be cross-checked against the REAL diff, not the
  agent's self-report.** Unlike Signal-2 (independently established by the FR-2 prover),
  `rootCauseGreen` (`auto-merge.ts:249–256`) checks `rootCauseFiles ⊆ changedFiles` where
  **both** come from the agent-authored signals file (`dispatch-issue.sh:393–394`), not from
  `buildChangedFiles`' real git diff. An agent passes Signal-1 trivially by making its claimed
  `rootCauseFiles` a subset of its own claimed `changedFiles`. *(⛔ no prover/cross-check for
  Signal-1; the one review conjunct without an independent witness. Acceptance: `changedFiles`
  used for Signal-1 must be the real git diff, or Signal-1 must not count toward auto-merge.
  Tracked: [#489](https://github.com/AIClarityAU/minspec/issues/489).)*
- **AC-26 — Empty / low consequence-signal set on a subtle CODE change must not float to
  `low`-blast.** `classifyBlast([], false) === 'low'` (`auto-merge.ts:197`): a high-consequence
  *code* edit (auth, money-path, logic) that trips no analyzer and is not a manifest/boundary
  file emits an empty signal set ⇒ low ⇒ eligible. The #414/#422 injections cover only
  *non-code* blind spots; nothing covers an analyzer **false-negative on code**. This is the
  deepest hole and aligns with the standing "classifier measures diff size, not difficulty"
  finding (SPEC-004). *(⛔ no floor on unanalyzed code; deny-by-default stops at *known* signal
  names, not at *absence of signal*. Acceptance: an analyzed-code change with zero recognized
  signals but non-trivial reach/size must not auto-classify low.
  Tracked: [#490](https://github.com/AIClarityAU/minspec/issues/490).)*
- **AC-27 — Audit-write failure must not be silently swallowed.** `appendAudit`
  (`auto-merge-gate.ts:610–616`) catches its own error and only logs to stderr; the merge
  proceeds regardless. FR-7 is best-effort, so a wrong auto-merge whose audit append failed
  leaves nothing to trace — defeating the trail's purpose exactly when it matters. *(⛔
  contradicts FR-7's "every decision is recorded". Acceptance: an audit-append failure on an
  `eligible` decision must block the merge (fail-safe to HOLD), not proceed untraced.
  Tracked: [#491](https://github.com/AIClarityAU/minspec/issues/491).)*
- **AC-28 — The merge must be pinned to the evaluated SHA (TOCTOU).** The prover/diff run on
  the local worktree HEAD, but `gh pr merge "$PR_NUM"` (`dispatch-issue.sh:436`) merges the
  PR's *current* head with no `--match-head-commit`. If the PR head advances between evaluation
  and merge, **unevaluated code merges to `main`**. *(⛔ no SHA pin. Acceptance: the merge asserts
  the PR head equals the SHA the gate evaluated, else re-evaluate or HOLD. Same TOCTOU family as
  open [#466](https://github.com/AIClarityAU/minspec/issues/466) (SHA-bind the ai-review label);
  this is the gate-evaluation-SHA→merge-SHA variant — fold into #466 or file a sibling.)*

### Acceptance summary (audit of merged PR #412)

- **Met with tests (✅):** AC-2, AC-4..AC-17 (core minus the sub-clause gaps below) — the pure
  decision core, prover, blast/reach classification, mode kill-switch.
- **Met, test-gap (🟡):** AC-1 (missing-conjunct key), AC-3 (reasoned-path now cited), AC-6
  (absent-array key), AC-18 (loop conjunction), AC-19 (throw→HOLD conversion), AC-20
  (audit-record shape), AC-21 (fallback body parity). Code exists; add the named tests.
- **Not self-checkable (AC-24):** documentation assertion; the enforceable form is a
  dispatch-level test that the gate is never called for a held-for-human category.
- **Unmet, deferred (⛔ ⏳):** AC-22 + AC-23 — the FR-8 **in-IDE keyboard-first** surface;
  fallback (AC-21) covers the loop today, but **INV-7 has zero implementation** and must gate
  any SPEC-014-backed FR-8 build.
- **Unmet, live holes (⛔):** AC-25..AC-28 — self-reported root cause, analyzer false-negative
  on code, swallowed audit failure, TOCTOU merge SHA. These are the paths to a wrong auto-merge
  the gate does **not** yet close; each is tracked (Follow-ups).

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
inversion, finding 1); `destructive_schema_op` alone → high; a `concurrency` signal → high. **FR-4a derivation:** `reach_unavailable` + an `export *` sentinel (or content-unavailable
`public_api_changed`) → `touchesExportedSurface=true` → ineligible (guards the second-source-of-truth
hole, finding 2); no `public_api_*` signal → `touchesExportedSurface=false`.

**T1 (contract):** a fully-green low-blast change → eligible; each single failing condition
flips it to ineligible with the right `failed[]` key; a change tripping any high signal
(`irreversible_*` / `destructive_schema_op` / `sensitive_sink` / `public_api_*` /
`concurrency`) → high-blast hold even with all review signals green;
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
  (now `status: implementing` — verify the review-webview actually renders a *held-PR* skim
  surface before marking AC-22/AC-23 met; SPEC-014's existing webview is the spec/ADR approval
  surface, not the PR skim surface). Buildable now: the GitHub-comment degraded fallback
  (AC-21). The keyboard-first review-webview surface (AC-22) + the INV-7 bound-key T-test
  (AC-23) land only when SPEC-014 ships the held-PR surface. Not read as buildable-now.
- **Wrong-merge holes surfaced by the PR-#412 acceptance audit (Acceptance Criteria §J),
  filed per DR-023:** AC-25 self-reported root cause → [#489](https://github.com/AIClarityAU/minspec/issues/489);
  AC-26 analyzer false-negative on code → [#490](https://github.com/AIClarityAU/minspec/issues/490);
  AC-27 swallowed audit failure → [#491](https://github.com/AIClarityAU/minspec/issues/491);
  AC-28 TOCTOU merge SHA → fold into [#466](https://github.com/AIClarityAU/minspec/issues/466).
- `plan-gate` HITL mode (#183 option 2) — deferred.
- Productize as the `aiclarity.agent-execute` gate surface (EPIC-007) — this dev-time gate is the prototype.
