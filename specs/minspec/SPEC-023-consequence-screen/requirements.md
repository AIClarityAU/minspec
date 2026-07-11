---
id: SPEC-023
type: requirements
status: implementing
tier: T4
product: minspec
epic: EPIC-004  # Classifier Validation
---

# MinSpec — Consequence Screen: Tier-0 Blast-Radius Analyzers (Requirements)

**Date:** 2026-06-06
**Status:** Implementing (SDD Implement phase)
**Decision:** [DR-022](../../../docs/decisions/DR-022.md) §1 (this spec is the contract that decision's "always-on consequence axis" governs)
**Triggered by:** [#88](https://github.com/harvest316/minspec/issues/88) — Tier-0 consequence-screen analyzers; itself a prerequisite backstop for the consequence-hybrid HITL gate ([DR-033](../../../docs/decisions/DR-033.md) §3).
**Epic:** [EPIC-004 Classifier Validation](../../../docs/epics/EPIC-004-classifier-validation.md)
**Relates:** [DR-021](../../../docs/decisions/DR-021.md) (the classifier floor model this extends), [SPEC-004](../SPEC-004-classifier-validation/requirements.md) (the κ=0.80 validation basis this re-runs).

---

## Context

The tier classifier today ([classifier.ts](../../../packages/minspec/src/lib/classifier.ts))
scores ceremony from **diff-size** signals only (files changed, lines changed, file
types, cross-directory, new files, dependency change). [DR-022](../../../docs/decisions/DR-022.md)
reframes ceremony as **risk-response**: how much a change can *hurt* (its blast radius),
not how *big* it is. The canonical failure it targets is the 2-line change to a
200-caller function — trivially small, potentially catastrophic — which size-only
scoring under-tiers (the measured under-tiering class: a subtle change scored low because
the diff is small).

This spec is **DR-022 §1, step 1**: the always-on **consequence axis** — a set of
deterministic, offline (Tier-0) analyzers that emit `ClassificationSignal`s into the
existing max-over-signals `classify()`, alongside the diff-size signals (which demote
from *dominant driver* to *ordinary inputs*).

### Reality-check (three premises in #88 that the codebase contradicts — resolved below)

1. **`classify()` is NOT in `packages/shared`.** It lives in
   [classifier.ts](../../../packages/minspec/src/lib/classifier.ts) with its signal
   producers. `@aiclarity/shared` is dependency-free (conformance contract only). → see
   Clarification 1.
2. **There is no AST/call-graph index to reuse.** Repo-wide there is no call graph, no
   import graph, no reachability index. The only AST code is the **deprecated**
   `ast-analyzer.ts`, which [DR-021](../../../docs/decisions/DR-021.md) Decision 4
   forbids wiring into `classify()`. The flagship signal (impact-reach) therefore has **no
   data source today**. → see Clarification 2.
3. **#88 is gated on [#91](https://github.com/harvest316/minspec/issues/91).** DR-022
   says do not *ship* the reach model before #91 validates it (as diff-size was validated
   at κ=0.80). → see Clarification 3.

## Resolved Clarifications (Clarify phase — approved by Paul Harvey 2026-06-06)

| # | Question | Resolution |
|---|---|---|
| C1 | **Placement** — move `classify()` to `shared`, or keep it? | **Keep `classify()` + `ClassificationSignal` in `packages/minspec/src/lib`.** Build the analyzers there, next to the engine. Do NOT relocate to `shared` (that would touch the `@aiclarity/shared` contract that ScroogeLLM also consumes — out-of-scope blast). Revisit only if scrooge needs them. |
| C2 | **Index engine** — what powers impact-reach with no graph? | **impact-reach ships DEGRADED-BY-DEFAULT in v1.** No new heavy dependency (no `ts-morph`/TS compiler). It emits an honest `degraded` marker ("call graph unavailable → size fallback"); the real cross-file reference index is a **follow-up**, gated by #91. |
| C3 | **Validation gating** — on by default, or off pending #91? | **The 4 graph-free analyzers land ON** (the upward-only ratchet makes this structurally safe — they can only *raise* a tier). **impact-reach stays OFF/degraded pending #91.** The validation harness ([SPEC-004](../SPEC-004-classifier-validation/requirements.md)) is **re-run** and the tier-shift delta reported; #91 owns acceptance thresholds. |
| C4 | **Sensitive-sink catalog scope** | **Small, capped v1 list** (DR-022 R2): paths/identifiers for `auth`, `login`, `token`, `secret`, `password`, `payment`, `charge`, `stripe`, `pii`, and raw-SQL/credential patterns. Growth requires a deliberate edit, not drift. |

## Scope

### In scope (v1)
- The four **graph-free** consequence analyzers (FR-2…FR-5), **enabled**.
- The **impact-reach** analyzer (FR-1) shipped **degraded-by-default** with an honest marker.
- The additive contract changes to `ClassificationSignal` + the analyzer input types (FR-6).
- Demoting diff-size from dominant signal to one input among many (FR-7).
- Re-running the validation harness and **reporting** the tier-shift delta (FR-8).

### Out of scope (explicitly deferred)
- The real cross-file **reference/call-graph index** for impact-reach → follow-up issue, **gated by #91**.
- **#91**'s validation *acceptance* (this spec only re-runs and reports the delta; #91 decides pass/fail thresholds for the reach model).
- The `tier → risk-profile` **data-model migration** ([#90](https://github.com/harvest316/minspec/issues/90)).
- The **positioning flip** (making consequence the *primary* unit) — DR-022 keeps it gated until validated.
- Any move of `classify()` into `packages/shared`.

## Invariants (must hold; T0 tests)

- **INV-1 Tier-0.** Analyzers import no `vscode`, perform no network, invoke no AI. Git/disk
  IO stays behind the existing injectable seam in the command layer and is passed *in* as
  data; analyzers are pure `(input) => ClassificationSignal[]`.
- **INV-2 `classify()` stays pure.** No file/graph IO inside `classify()`. Its existing
  pure-function contract + T0 tests pass **verbatim**.
- **INV-3 Upward-only ratchet** (DR-021 / DR-022 §1). A consequence signal can only floor
  ceremony **up**. A clean analyzer emits no signal (or a `T1` signal), never a downgrade.
  *Property test:* adding any consequence signal to a signal set never lowers the result.
- **INV-4 Honest degrade, never silent.** When data is unavailable, an analyzer emits a
  **visible** `degraded` marker or nothing — never a silently-wrong tier. (SPEC-010 FR-6 /
  SPEC-012 FR-15 precedent.)
- **INV-5 No silent reclassification.** Any change to existing tier outputs from demoting
  diff-size is **measured and reported** (FR-8), not slipped in.

## Functional Requirements

- **FR-1 Impact-reach (flagship, degraded in v1).** For each changed exported symbol,
  *intends* to measure downstream caller/reach count. v1 has no index → emits a single
  `degraded: true` marker signal (`name: "reach_unavailable"`, `tierContribution: 'T1'`,
  `explain: "call graph unavailable; using size signals"`). MUST NOT emit a fabricated
  reach number. The real measurement is the #91-gated follow-up.
- **FR-2 Public-API surface delta.** Count exported symbols added / removed / signature-
  changed at a package's public boundary (barrel/entry files). Removed or changed exports
  floor higher than additions. Degrade: when pre-change content is absent, additions-only,
  flagged `degraded`.
- **FR-3 Irreversibility.** Detect file **deletions**, migration files (`migrations/`,
  `*.sql`, `*.prisma`), and destructive schema ops (`DROP TABLE`, `ALTER … DROP`, removed
  Prisma `model`/columns). Works from diff status + path + content. Degrade: path/status
  alone when content absent, flagged `degraded`.
- **FR-4 Sensitive-sink reach.** Flag changes touching sensitive regions per the capped C4
  catalog (path + identifier + raw-SQL/credential regex). Transitive sink reach only when a
  reference index is present (not in v1) → v1 degrades to **direct** matches, flagged.
- **FR-5 Concurrency.** Detect introduced/modified concurrency primitives (`Promise.all`,
  `Worker`, locks/mutexes, timers, `Atomics`, transaction blocks, `async` around shared
  state). Content regex over changed JS/TS. Absent content → emits nothing ("absent, not
  wrong"; no size proxy exists for concurrency, so no degraded marker needed).
- **FR-6 Additive contract.** Extend `ClassificationSignal` with **optional** fields only
  (`axis?: 'scope'|'consequence'`, `degraded?: boolean`, `explain?: string`) so all existing
  producers stay valid and no wire/data-model migration is forced. Define `ConsequenceInput`,
  `ReferenceIndex` (nullable), `ConsequenceAnalyzer`.
- **FR-7 Demote diff-size.** Size signals keep their thresholds but become ordinary entries
  in the signal array; `classify()`'s max-over-`tierContribution` is unchanged. "Demotion" =
  adding higher-authority consequence signals that can outrank size, NOT lowering size
  thresholds. (`weight` is not read by `classify()` — re-weighting is cosmetic and must not
  be presented as the demotion mechanism.)
- **FR-8 Re-validate + report.** Run the [SPEC-004](../SPEC-004-classifier-validation/requirements.md)
  validation harness with consequence analyzers ON vs OFF; report how many of the 120
  instances shift tier and in which direction. All shifts MUST be upward (INV-3); the
  over-tiering bound must be re-checked. Numbers are **reported**, not hard-asserted (#91
  owns thresholds).

## Acceptance Criteria

Each criterion is a checkable pass/fail condition on the analyzers once built, traceable
to the FR/INV it discharges. Written at Specify close (pre-code) — not yet an audit of
built code, a target for Plan/Tasks to build against and for tests to prove.

### A. Impact-reach — degraded flagship (FR-1)

- **AC-1 — No fabricated reach.** Given `refIndex === null` (always true in v1), When
  impact-reach runs on any changed exported symbol, Then it emits exactly one
  `degraded: true` signal (`name: "reach_unavailable"`, `tierContribution: 'T1'`) and never
  a fabricated numeric reach/caller count. *(FR-1, INV-4)*

### B. Public-API surface delta (FR-2)

- **AC-2 — Removed/changed export floors higher than an addition.** Given a barrel/entry
  file diff with `oldContent` present, When an export is removed or its signature changed,
  Then the emitted signal's `tierContribution` is strictly higher than for an
  additions-only diff. *(FR-2)*
- **AC-3 — Missing old content degrades honestly.** Given `oldContent` is absent, When the
  analyzer runs, Then it treats the diff as additions-only and marks the signal
  `degraded: true` — it never guesses a removal. *(FR-2, INV-4)*

### C. Irreversibility (FR-3)

- **AC-4 — Deletion / migration / destructive-schema each trip independently.** Given a
  changed-file set containing (a) a file deletion, (b) a path under `migrations/`, `*.sql`,
  or `*.prisma`, or (c) content containing `DROP TABLE`, `ALTER … DROP`, or a removed Prisma
  `model`/column, When the analyzer runs, Then each case independently emits an
  irreversibility signal. *(FR-3)*
- **AC-5 — Content-absent fallback.** Given file content is unavailable, When the analyzer
  runs, Then it falls back to path/status alone and marks the signal `degraded: true`.
  *(FR-3, INV-4)*

### D. Sensitive-sink reach (FR-4)

- **AC-6 — Direct hit trips on the capped C4 catalog.** Given a changed path, identifier, or
  raw-SQL/credential pattern matching the C4 list (`auth`, `login`, `token`, `secret`,
  `password`, `payment`, `charge`, `stripe`, `pii`, credential/SQL regex), When the analyzer
  runs, Then it emits a sensitive-sink signal. *(FR-4)*
- **AC-7 — No fabricated transitive reach in v1.** Given `refIndex === null`, When a
  sensitive symbol is touched only indirectly (no direct match), Then the analyzer does not
  invent a transitive hit — v1 checks direct matches only, and the signal is marked
  `degraded: true`. *(FR-4, INV-4)*

### E. Concurrency (FR-5)

- **AC-8 — Concurrency primitive trips.** Given changed JS/TS content introducing or
  modifying `Promise.all`, `Worker`, a lock/mutex, a timer, `Atomics`, or a transaction block
  around shared state, When the analyzer runs, Then it emits a concurrency signal. *(FR-5)*
- **AC-9 — Absent content emits nothing, not a false degrade.** Given content is
  unavailable, When the analyzer runs, Then it emits no signal at all (not even
  `degraded`) — concurrency has no size-based proxy to fall back to, so "absent" stays
  absent rather than becoming a manufactured degrade marker. *(FR-5)*

### F. Contract + wiring (FR-6, FR-7)

- **AC-10 — Additive-only contract.** Given the existing `ClassificationSignal` producers
  (size signals), When the new optional fields (`axis`, `degraded`, `explain`) are added,
  Then every existing producer/consumer compiles and behaves unchanged — no required field
  added, no existing signature broken. *(FR-6)*
- **AC-11 — `classify()` purity preserved.** Given the consequence analyzers are wired in
  above `classify()`, When `classify()` runs, Then it performs no file/graph IO itself and
  its existing T0 test suite passes **verbatim**. *(INV-1, INV-2)*
- **AC-12 — Demotion is additive, not threshold-lowering.** Given the diff-size signals'
  existing thresholds, When consequence signals are introduced, Then no size-signal
  threshold changes — "demotion" means solely that higher-authority consequence signals now
  sit in the same max-over-`tierContribution` set, not that size thresholds were lowered.
  *(FR-7)*

### G. Upward-only ratchet + re-validation (INV-3, FR-8)

- **AC-13 — Monotonicity property holds.** Given any signal set `S` and any consequence
  signal `C`, When `C` is added to `S`, Then `classify(S ∪ {C})` never yields a tier lower
  than `classify(S)`. *(INV-3 — property test)*
- **AC-14 — ON/OFF delta reported, not asserted.** Given the SPEC-004 120-instance
  validation harness, When re-run with consequence analyzers ON vs OFF, Then every instance
  whose tier shifts shifts **upward only**, and the shift count/direction is recorded per
  FR-8 — pass/fail acceptance thresholds are explicitly **not** enforced here (owned by
  [#91](https://github.com/harvest316/minspec/issues/91)). *(FR-8, INV-5)*

### H. Tier-0 boundary

- **AC-15 — No forbidden imports.** Given the analyzer module source, When statically
  inspected, Then it imports no `vscode` and performs no network/AI call — git/disk IO
  enters only via the injected `ConsequenceInput`, never from inside the analyzer module.
  *(INV-1)*

## Contract (TypeScript sketch — finalized in Plan)

```ts
interface ClassificationSignal {
  readonly name: string;
  readonly value: number | boolean;
  readonly weight: number;
  readonly tierContribution: Tier;
  // NEW — additive, optional; absent on legacy size signals:
  readonly axis?: 'scope' | 'consequence';   // size signals = 'scope'
  readonly degraded?: boolean;
  readonly explain?: string;                  // e.g. "reaches 14 callers"
}

interface ConsequenceInput {
  readonly changedFiles: ReadonlyArray<{
    path: string; insertions: number; deletions: number;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    content?: string; oldContent?: string;
  }>;
  readonly refIndex: ReferenceIndex | null;   // null ⇒ degrade (always null in v1)
}

interface ReferenceIndex {                      // built by the #91-gated follow-up
  callerCount(symbol: SymbolRef): number;
  reachCount(symbol: SymbolRef): number;
  exportedSymbolsOf(filePath: string): SymbolRef[];
}

type ConsequenceAnalyzer = (input: ConsequenceInput) => ClassificationSignal[];
```

Feed path (command layer in `minspec`):
```
const sizeSignals  = await analyzeGitDiff(root, {...});           // demoted: just inputs
const consequence  = runConsequenceAnalyzers(buildInput(...));    // 5 analyzers (reach degraded)
const result       = classify([...sizeSignals, ...consequence], config);  // unchanged max-over
```

## Test Plan

**T0 (invariants):** `classify()` existing cases pass verbatim (INV-2); monotonicity
property test (INV-3); purity/offline assertion — no `vscode`/`simple-git` import in the
analyzer module (INV-1); `refIndex: null` → impact-reach emits a `degraded` marker, size
signals still floor (INV-4).

**T1 (contract, one suite per analyzer):** public-API removed-export > added-export, no
`oldContent` ⇒ additions-only + degraded; irreversibility — a deletion, a `migrations/`
path, a `DROP TABLE` each trip, path-only fallback when content absent; sensitive-sink —
direct hit trips, transitive only with `refIndex` (n/a v1), degrades to direct-only;
concurrency — `Promise.all`/`Worker`/lock trip, stat-only diff emits nothing.

**Blast-radius / FR-8 test:** run the validation harness with analyzers ON; assert every
shift is **upward** and the over-tiering bound is not breached (numbers recorded, not
hard-asserted — #91 owns acceptance).

## Risks

- **Reworks classifier core (the #88 blast radius).** Enabling the 4 analyzers changes the
  predicted tier distribution and **invalidates the size-only κ=0.80 run** until re-measured
  (FR-8). Mitigation: upward-only ratchet (no tier can drop), measured ON/OFF delta, reach
  kept off pending #91.
- **Sink catalog drift.** Mitigation: capped C4 list; growth is a deliberate edit.
- **Degraded flagship reads as "done."** Mitigation: impact-reach emits a *visible*
  `degraded` marker; this spec explicitly scopes the real index as a #91-gated follow-up.

## Follow-ups (tracked)

- Real cross-file **reference/call-graph index** for impact-reach (FR-1's full form),
  **gated by [#91](https://github.com/harvest316/minspec/issues/91)** → [#195](https://github.com/harvest316/minspec/issues/195).
- **#91** — validation acceptance thresholds for the reach model (owns FR-8's pass/fail).
- **#90** — `tier → risk-profile` data-model migration (consumes this spec's signals).
- Positioning flip (consequence as primary unit) — DR-022, post-validation.
