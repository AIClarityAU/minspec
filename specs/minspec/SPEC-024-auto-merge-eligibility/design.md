---
id: SPEC-024
type: design
status: implementing
product: minspec
epic: EPIC-007  # Agent Execute
---

# MinSpec — Auto-Merge Eligibility Gate (Plan)

**Requirements:** [requirements.md](requirements.md) · **Triggered by:** [#199](https://github.com/AIClarityAU/minspec/issues/199) · **Decision:** [DR-033](../../../docs/decisions/DR-033.md) §3

> ⚠️ **Backfilled as-built.** This Plan documents the architecture that already
> shipped and merged (PR [#412](https://github.com/AIClarityAU/minspec/pull/412) +
> #422/#475), so the T4 spec is structurally complete and reviewable. It is written
> against the real code (`auto-merge.ts`, `auto-merge-gate.ts`, `dispatch-issue.sh`),
> not as a forward proposal — every claim cites `file:line`. Where the build diverged
> from or extended the original requirements (e.g. `manifest_changed` #414, boundary
> files #422), that is called out. The known gaps this Plan does **not** close are in
> *Deferred & Follow-ups* (they are the requirements' Acceptance Criteria §J).

---

## Approach

The gate is split into two layers on the Tier-0 purity boundary (INV-6):

1. **Pure decision core** — `packages/minspec/src/lib/auto-merge.ts`. A single pure
   function `decideAutoMerge(input): AutoMergeDecision` (`auto-merge.ts:312`) and its
   helpers. **No IO**: imports only types (`ReviewSignalsInput`, `TestFinding`,
   `ClassificationSignal`), no `vscode` / `fs` / `path` / `child_process` / network.
   Every input is measured upstream and passed in as data. This is what makes the
   highest-consequence decision unit-testable and air-gapped.
2. **IO / exec layer** — `scripts/auto-merge-gate.ts` (740 lines) + `scripts/dispatch-issue.sh`.
   Runs the FR-2 prover in a real worktree, reads the diff, runs the analyzers/scanner,
   resolves the mode, writes the audit log, and performs the merge or the hold. It feeds
   the pure core and acts on its verdict.

The whole gate is **deny-by-default** (INV-1): `eligible` is a conjunction; any missing,
unknown, or unverified input collapses to `eligible: false` with a populated `failed[]`.
Erring `high`/hold costs a 30-second human skim; erring `low`/merge costs a bad `main` —
so every ambiguity resolves toward hold.

## Decision algorithm (FR-1, `decideAutoMerge` `auto-merge.ts:312`)

`eligible === true` iff **all** of:

| Conjunct | Predicate | Source |
|---|---|---|
| mode is hybrid | `input.mode === 'consequence-hybrid'` (else `pr-gate` short-circuits to hold) | `:330` |
| consequence signals present | `Array.isArray(consequenceSignals)` (absent ⇒ assume exported-touch + high) | `:318` |
| 3 review signals green | `rootCauseGreen && regressionGreen && gateGreen` on the **prover-overlaid** signals | `:341–350` |
| no hollow/stub | `hollowFindings` is a known array and empty | `:352–358` |
| blast low | `classifyBlast(...) === 'low'` | `:360–361` |
| reach conjunct | `reachKnownLow(signals) OR !touchesExportedSurface` | `:363–364` |

`failed[]` accumulates the specific key of every unmet conjunct; `reason` is always
non-empty (INV-6). `pr-gate` mode returns early with `failed: ['pr-gate-mode']` but still
reports the derived blast (`:330–337`).

## Design decisions (rationale)

- **D1 — Pure/IO split on the Tier-0 boundary (INV-6).** The decision is a pure function;
  all IO happens upstream and is passed in. Rationale: the one unit that can merge to
  `main` unseen must be exhaustively unit-testable and free of ambient state. Enforced by
  a test that greps the module's imports (`auto-merge.test.ts:431`).
- **D2 — Deny-by-default over signal *names*, not families (FR-5, `classifyBlast`
  `auto-merge.ts:180`).** `HIGH_SIGNAL_NAMES` is a closed set; **any name not recognized as
  low-blast is treated `high`** (`:190–195`) — the inverse of an allowlist. Rationale: a
  novel analyzer signal must not sneak through as "low" because nobody classified it yet.
  In v1 there is *no* low-blast signal, so the only `low` outcome is a signal set with at
  most the `reach_unavailable` marker and no exported touch (`:197`).
- **D3 — Prover is the sole authority for the red→green proof (INV-3).**
  `withProverAuthority` (`:292`) overwrites any agent-supplied
  `regressionProvenBaseRed`/`...HeadGreen` on `reviewSignals` with the prover's result;
  absent prover ⇒ both `false`. Rationale: an agent must not be able to self-certify the
  regression that lets its own PR merge.
- **D4 — `touchesExportedSurface` is DERIVED, never a caller input (FR-4a,
  `deriveTouchesExportedSurface` `:154`).** Computed as `some(signal ∈ public_api_*)`.
  Rationale: a single source of truth; the v1 safety of every merge reduces to this one
  predicate, so it cannot be a second, un-reconciled boolean. Degraded/`export *`/content-
  unavailable emissions still carry a `public_api_*` name ⇒ still force `true` (fail-safe).
- **D5 — Conservative reach-degrade (INV-2, `reachKnownLow` `:232`).** `reachKnownLow` is
  **always `false` in v1** (no call-graph index), so the reach conjunct reduces to
  `!touchesExportedSurface`. `reach_unavailable` + exported touch escalates to `high`
  (`classifyBlast:188`). Absence of a measurement is never read as proof of low reach.
- **D6 — Mode resolves deny-by-default with no fail-open (`resolveMode`
  `auto-merge-gate.ts:72`).** Exact string `consequence-hybrid` opts in; everything else ⇒
  `pr-gate`. The dispatch adds a further conjunct: a PR merges only when `eligible` **and**
  the independent-reviewer `ready-to-merge` status is `success` (`dispatch-issue.sh:431–433`)
  — `eligible` is necessary, not sufficient.
- **D7 — Manifest/boundary injection covers the analyzer's non-code blind spots (#414,
  #422).** The public-API analyzer skips non-code files, so a `package.json` / lockfile /
  `exports` edit (#414) or a CI/build boundary file (`.github/workflows`, `tsconfig.json`,
  `.npmrc`, `Jenkinsfile`, `.githooks/*` — #422) would emit no signal and read low-blast.
  The IO layer injects `manifest_changed` (`detectManifestChange`) / a boundary signal
  (`detectBoundaryChange`) so blast escalates to `high`. `manifest_changed` is a recognized
  `HIGH_SIGNAL_NAME` (`auto-merge.ts:123`) so it also names itself in the hold reason.
- **D8 — Fail-safe on diff failure (MAJOR-5).** `buildChangedFiles` throws on an
  unresolvable base ref; `main()`'s catch converts the throw to a HOLD — never a silent
  0-file diff read as "nothing changed" (`auto-merge-gate.ts:464` test, `:714–731` catch).

## Data model / contracts

The `AutoMergeInput` / `AutoMergeDecision` / `ProverResult` contracts are in
[requirements.md](requirements.md) *Contract* and realized verbatim at `auto-merge.ts:50–94`.
Signal-name sets are module constants: `HIGH_SIGNAL_NAMES` (`:103`), `PUBLIC_API_NAMES`
(`:127`), `REACH_UNAVAILABLE` (`:138`). Growth of the high set requires a deliberate edit
there — never silent drift.

## Loop integration (FR-6, `dispatch-issue.sh`)

1. Resolve mode: `MINSPEC_AUTOMERGE_MODE` env → `pr-gate` default (`:382`).
2. Run the gate (`npx tsx auto-merge-gate.ts --worktree … --base … --mode …`, `:400`);
   the gate runs the prover, builds the diff, runs analyzers + scanner, calls the pure
   core, appends the audit record, and prints the `AutoMergeDecision`.
3. Merge predicate (`:431`): `ELIGIBLE == true && PR_NUM set && mode == consequence-hybrid
   && ready-to-merge == success` ⇒ `gh pr merge --squash`. Else ⇒ label `needs-human-skim`
   + post the FR-8 fallback comment.

## FR-8 surface

- **Built:** the degraded GitHub-comment fallback — `renderReviewSignals` block +
  one-line blast reason posted via `gh pr comment` (`auto-merge-gate.ts:707`,
  `dispatch-issue.sh:462`). One renderer, identical block across surfaces.
- **Deferred:** the in-IDE keyboard-first review-webview surface (INV-7) — gated on
  [SPEC-014](../SPEC-014-review-webview/requirements.md). `dispatch-issue.sh:445` notes the
  deferral. This is unbuilt (Acceptance Criteria AC-22/AC-23).

## Build order (as executed)

1. `350ec12` — pure eligibility core + T0/T1 tests (`auto-merge.ts`, `auto-merge.test.ts`).
2. `9cc76d1` — FR-2 red→green prover + FR-6 loop wiring + FR-7 audit (`auto-merge-gate.ts`).
3. `f65d979` — adversarial hardening: closed 5 wrong-merge paths (BLOCKER 1 manifest #414,
   BLOCKER 2 executed-assertion prover, MAJOR 3/4 mode deny-by-default, MAJOR 5 diff-throw).
4. Merged as PR **#412**; then `08455ea` (#422/#475) added CI/build-boundary escalation.

## Test plan

Realized in `packages/minspec/tests/auto-merge.test.ts` (pure core: INV-1 deny-by-default
property, INV-3 prover authority, INV-4 hollow, FR-5 unknown-name→high, FR-4a derivation,
INV-2 reach-degrade, C4 pr-gate, INV-6 purity) and `auto-merge-gate.test.ts` (prover
red→green cannot be fooled, `detectManifestChange`/`detectBoundaryChange`, `resolveMode`
deny-by-default, `buildChangedFiles` throw→HOLD). Per-AC coverage + the test-gaps are the
requirements' **Acceptance Criteria** table.

## Risks

Per [requirements.md](requirements.md) *Risks*: a wrong auto-merge reaching `main` unseen
(mitigated by deny-by-default, unmeasured-blast-is-high, prover-not-self-report, audit,
per-dev `pr-gate` kill-switch); prover flakiness (any non-deterministic result ⇒ not
proven ⇒ hold); over-conservatism (acceptable — bias to hold).

## Open plan questions

- Requirements `status: specifying` is stale (code merged) — the correct transition is an
  approval decision, out of this Plan's scope.

## Deferred & Follow-ups

These are the requirements' **Acceptance Criteria §J** — wrong-merge directions the built
gate does **not** close, each tracked:

- **#489** — Signal-1 root cause is agent-self-reported, not cross-checked vs the real diff.
- **#490** — empty/low consequence-signal set on subtle *code* → low-blast (analyzer false-negative).
- **#491** — `appendAudit` swallows write failure ⇒ wrong merge untraceable (FR-7 best-effort).
- **#466** — TOCTOU: merge not pinned to the evaluated SHA.
- **AC-22/AC-23 / INV-7** — FR-8 in-IDE keyboard-first surface, gated on SPEC-014.
- Widen low-blast coverage once reach is real + validated: #195 (index), #91 (validation).

## Plan review (adversarial pass)

The Acceptance-Criteria audit (opus, fresh-context, 2026-07-04 — see requirements §J and
PR #492) served as this Plan's adversarial review: it verified the pure core against its
tests and surfaced the four wrong-merge directions above. No further plan-review pass is
outstanding for the *as-built* code; the open items are tracked issues, not plan defects.
