/**
 * auto-merge.ts — SPEC-024 (Auto-Merge Eligibility Gate), FR-1 / FR-4a / FR-5.
 *
 * THE single highest-consequence decision in MinSpec: it decides which PRs merge
 * to `main` with NO human eyes. Everything else in the auto-build chain is an
 * input; `decideAutoMerge` is the decision.
 *
 * This module is the PURE, Tier-0 core (INV-6). It performs NO IO: no `vscode`,
 * no `fs`, no network, no `child_process`. The IO — running the FR-2 red→green
 * prover, reading the diff, running the analyzers/scanner — happens upstream in
 * the dispatch/script layer and is passed IN as data. The module imports only
 * TYPES (erased at compile time), so it stays a leaf with zero runtime deps.
 *
 * INVARIANTS (T0 — see auto-merge.test.ts):
 *  - INV-1 Deny by default. `eligible: true` ONLY when EVERY FR-1 condition is
 *    affirmatively satisfied. Any missing / unknown / unverified input ⇒
 *    `eligible: false`. There is no "probably fine."
 *  - INV-2 Unmeasured blast = high blast. Reach degraded/unknown AND the diff
 *    touches an exported surface ⇒ ineligible. Never auto-merge a change whose
 *    blast radius cannot be measured.
 *  - INV-3 No unproven regression. Eligibility requires the FR-2 prover to have
 *    proven the named regression red-on-base AND green-on-head. A self-reported
 *    `regressionProvenBaseRed` on `reviewSignals` is IGNORED — the prover result
 *    (`proverResult`) is the sole authority. Absent prover ⇒ not proven.
 *  - INV-4 Hollow tests block. Any `scanTestSource` finding (`stub` OR `hollow`)
 *    ⇒ ineligible.
 *  - INV-5 Held-for-human filter is upstream and absolute. This gate is only ever
 *    invoked for already-auto-build-eligible issues (DR-033 filter:
 *    marketing/legal/decide/irreversible-architecture/billing/published-sites
 *    never reach here). It does not re-litigate the filter; it assumes it.
 *  - INV-6 Decision is pure + auditable. Pure function of its inputs; every
 *    decision emits a non-empty structured `reason` and a `failed[]` list.
 *
 * FR-5 is deny-by-default over the analyzer's REAL emitted signal NAMES: a novel/
 * unmapped signal name is treated as `high` (dangerous until a human classifies
 * it) — the INVERSE of an allowlist. Erring `high` costs a 30s skim; erring `low`
 * costs a bad `main`.
 */

import type { ReviewSignalsInput } from '@aiclarity/shared';
import type { TestFinding } from './test-scanner';
import type { ClassificationSignal } from './classifier';

// ─── Contract (SPEC-024) ─────────────────────────────────────────────────────

/**
 * FR-2 prover result (produced by the IO/exec layer, NEVER self-reported by an
 * agent). The SOLE authority for the red→green regression proof (INV-3).
 */
export interface ProverResult {
  /** TRUE iff the named regression was RUN against BASE and observed to FAIL. */
  readonly regressionProvenBaseRed: boolean;
  /** TRUE iff the named regression was RUN against HEAD and observed to PASS. */
  readonly regressionGreenOnHead: boolean;
  /** Human-readable note, e.g. "test X red on base, green on head" | "test not found". */
  readonly note: string;
}

/** Per-dev HITL mode (#183 / DR-033 C4). Default = consequence-hybrid. */
export type AutoMergeMode = 'consequence-hybrid' | 'pr-gate';

/**
 * The pure input to `decideAutoMerge`. Everything the decision needs, measured
 * upstream and passed in as data.
 *
 * NOTE: `touchesExportedSurface` and `blast` are NOT inputs — they are DERIVED
 * inside the gate from `consequenceSignals` (FR-4a / FR-5), so the gate has a
 * single source of truth.
 */
export interface AutoMergeInput {
  /** #180 review-signal inputs. Its self-reported regression-proof flags are
   *  IGNORED for eligibility — the prover (`proverResult`) overrides them. */
  readonly reviewSignals: ReviewSignalsInput;
  /** #130 `scanTestSource` findings over changed/added test files. */
  readonly hollowFindings: TestFinding[];
  /** #88 `runConsequenceAnalyzers` output — SOLE source for blast + exported-surface. */
  readonly consequenceSignals: ClassificationSignal[];
  /** #183 per-dev HITL mode (default hybrid). */
  readonly mode: AutoMergeMode;
  /** FR-2 prover result. The AUTHORITY for the red→green proof (INV-3).
   *  Absent ⇒ not proven ⇒ deny-by-default. */
  readonly proverResult?: ProverResult;
  /** #489 — the REAL git-diff file paths (gate-supplied, from `buildChangedFiles`).
   *  The AUTHORITY for Signal-1's `rootCauseFiles ⊆ changedFiles` check, replacing
   *  the agent's self-reported `reviewSignals.changedFiles` (which the agent could
   *  make self-consistent to pass trivially). Absent ⇒ the agent's own set is used
   *  (the pure-decision unit tests inject their diff there); the production gate
   *  ALWAYS supplies it, so the self-report never counts. Same real-diff source the
   *  consequence/hollow signals already use. */
  readonly changedFilePaths?: readonly string[];
}

/** The decision. `failed` is `[]` iff `eligible`. `reason` is always non-empty (INV-6). */
export interface AutoMergeDecision {
  readonly eligible: boolean;
  readonly blast: 'low' | 'high';
  readonly reason: string;
  /** Condition keys that blocked eligibility ([] iff eligible). */
  readonly failed: string[];
}

export type DecideAutoMerge = (input: AutoMergeInput) => AutoMergeDecision;

// ─── FR-5 signal-name recognition sets (deny-by-default) ─────────────────────

/**
 * The analyzer's REAL emitted high-blast signal names (from consequence-analyzers.ts,
 * SPEC-023). A change tripping ANY of these is high-blast. Growth requires a
 * deliberate edit here — never silent drift.
 */
const HIGH_SIGNAL_NAMES: ReadonlySet<string> = new Set([
  // FR-3 irreversibility
  'irreversible_deletion',
  'irreversible_migration',
  'destructive_schema_op',
  // FR-4 sensitive-sink
  'sensitive_sink',
  // FR-2 public-API surface delta
  'public_api_added',
  'public_api_changed',
  'public_api_removed',
  // FR-5 concurrency (its `explain` covers timer/transaction sub-patterns)
  'concurrency',
  // Defense-in-depth (BLOCKER 1 / #414): the public-API analyzer skips non-code
  // files, so a manifest change (package.json dep add/bump, `exports`/`main`/`bin`
  // edit, lockfile, workspace manifest) emits NO consequence signal and would
  // otherwise classify low-blast → auto-merge unseen. The IO/exec layer
  // (auto-merge-gate.ts) INJECTS this signal for any changed manifest/boundary
  // file so blast=high → hold. Recognized here (not merely caught by the
  // unknown-name default) so `blastExplain` names it in the FR-8 hold reason.
  'manifest_changed',
]);

/** The `public_api_*` names — presence ⇒ the diff touches an exported surface (FR-4a). */
const PUBLIC_API_NAMES: ReadonlySet<string> = new Set([
  'public_api_added',
  'public_api_changed',
  'public_api_removed',
]);

/**
 * The impact-reach degrade marker (SPEC-023 FR-1). It is RECOGNIZED but is NOT
 * itself high-blast — its effect on the decision is the FR-4 condition (combined
 * with `touchesExportedSurface`). It is NOT counted toward `low` either.
 */
const REACH_UNAVAILABLE = 'reach_unavailable';

/**
 * Affirmative low-blast signal names (DR-058 / #490). A change classifies `low`
 * ONLY when one of these is present — an analyzer POSITIVELY certified the change
 * class is low-CONSEQUENCE. Absence (an empty set, or only `reach_unavailable`) is
 * UNMEASURED, which is `high` (deny-by-default): silence is no longer read as
 * safety — that was the #490 hole. Grows by deliberate edit; every entry MUST grade
 * consequence, never diff size (the SPEC-004 classifier anti-pattern). v1 catalog:
 * `low_blast_docs_test_only` — the diff touches only documentation and/or test
 * files, so no product source ships (gate-injected by `detectLowBlastDocsTest`).
 */
export const LOW_BLAST_DOCS_TEST = 'low_blast_docs_test_only';
const LOW_BLAST_SIGNAL_NAMES: ReadonlySet<string> = new Set([LOW_BLAST_DOCS_TEST]);

// ─── FR-4a `touchesExportedSurface` (DERIVED, single source of truth) ─────────

/**
 * FR-4a — `touchesExportedSurface` is DERIVED from the consequence signals, never
 * supplied by the caller. TRUE iff any `public_api_added` / `public_api_changed` /
 * `public_api_removed` signal is present.
 *
 * Fail-safe: the public-API analyzer emits a `public_api_*` signal EVEN in its
 * degraded / `export *` sentinel / "content-unavailable" `public_api_changed`
 * paths (it could not read the old/new surface). Because this predicate keys on
 * the signal NAME (not on whether content was readable), every such degraded
 * emission still forces `touchesExportedSurface = true` — an unknown/unreadable
 * surface is assumed to be an exported touch (⇒ hold).
 */
export function deriveTouchesExportedSurface(
  signals: ReadonlyArray<ClassificationSignal>,
): boolean {
  return signals.some((s) => PUBLIC_API_NAMES.has(s.name));
}

// ─── FR-5 Blast classification (deny-by-default over signal NAMES) ────────────

/**
 * FR-5 — map the consequence signal set to `low | high`, keying on the analyzer's
 * ACTUAL emitted signal names and DEFAULTING UNKNOWN NAMES TO `high` (a novel/
 * unmapped signal is treated as dangerous until a human classifies it — the
 * inverse of an allowlist).
 *
 * `high` iff:
 *  - any recognized high signal name is present, OR
 *  - the FR-4 degrade condition holds (`reach_unavailable` present AND
 *    `touchesExportedSurface`), OR
 *  - ANY signal name that is neither a recognized high name nor the recognized
 *    `reach_unavailable` degrade marker is present (unknown ⇒ high).
 *
 * A signal counts toward `low` ONLY if it is explicitly recognized as low-blast
 * (`LOW_BLAST_SIGNAL_NAMES`). #490 / DR-058: `low` requires AFFIRMATIVE evidence —
 * an empty set, or a set carrying only `reach_unavailable`, is UNMEASURED and
 * therefore `high` (deny-by-default). Silence is not safety: the old fall-through
 * to `low` on an empty set let a subtle CODE change that tripped no analyzer
 * auto-merge unseen. `reach_unavailable` is still handled by FR-4 and is NOT itself
 * low.
 */
export function classifyBlast(
  signals: ReadonlyArray<ClassificationSignal>,
  touchesExportedSurface: boolean,
): 'low' | 'high' {
  const hasReachUnavailable = signals.some((s) => s.name === REACH_UNAVAILABLE);

  // FR-4 conservative reach-degrade: unmeasured reach that touches an exported
  // surface is worst-case (INV-2).
  if (hasReachUnavailable && touchesExportedSurface) return 'high';

  // Recognized high, or ANY unrecognized name (deny-by-default), ⇒ high.
  for (const s of signals) {
    if (HIGH_SIGNAL_NAMES.has(s.name)) return 'high'; // recognized high
    if (s.name === REACH_UNAVAILABLE) continue; // recognized, handled by FR-4
    if (LOW_BLAST_SIGNAL_NAMES.has(s.name)) continue; // recognized affirmative-low
    return 'high'; // unrecognized name ⇒ high
  }

  // #490 / DR-058: `low` ONLY with affirmative low-blast evidence. Empty set or
  // reach-only set ⇒ unmeasured ⇒ high (this `return` was `'low'` — the hole).
  return signals.some((s) => LOW_BLAST_SIGNAL_NAMES.has(s.name)) ? 'low' : 'high';
}

/** One-line reason naming which consequence signal drove a high-blast verdict (FR-8). */
function blastExplain(
  signals: ReadonlyArray<ClassificationSignal>,
  touchesExportedSurface: boolean,
): string | undefined {
  const hasReachUnavailable = signals.some((s) => s.name === REACH_UNAVAILABLE);
  if (hasReachUnavailable && touchesExportedSurface) {
    return 'reach unavailable (no call-graph index) and the diff touches an exported surface — blast unmeasured (INV-2)';
  }
  for (const s of signals) {
    if (HIGH_SIGNAL_NAMES.has(s.name)) {
      return s.explain ? `${s.name}: ${s.explain}` : s.name;
    }
  }
  for (const s of signals) {
    if (
      s.name !== REACH_UNAVAILABLE &&
      !HIGH_SIGNAL_NAMES.has(s.name) &&
      !LOW_BLAST_SIGNAL_NAMES.has(s.name)
    ) {
      return `unrecognized consequence signal '${s.name}' — treated high (deny-by-default, FR-5)`;
    }
  }
  // #490 / DR-058: no high, no unrecognized — but also no affirmative low-blast
  // signal ⇒ the change class was never positively certified low-consequence.
  if (!signals.some((s) => LOW_BLAST_SIGNAL_NAMES.has(s.name))) {
    return 'no affirmative low-blast signal — the change was not certified low-consequence (empty/opaque signal set); unmeasured ⇒ hold (DR-058 #490)';
  }
  return undefined;
}

// ─── FR-4 reach-known-low (deny-by-default) ──────────────────────────────────

/**
 * Is downstream reach AFFIRMATIVELY measured as low? Deny-by-default (INV-2):
 * `true` ONLY with a real, non-degraded reach measurement from the #195/#91
 * reference index. v1 has NO index — the impact-reach analyzer emits only the
 * `reach_unavailable` degrade marker — so this is ALWAYS false in v1, and FR-1's
 * reach conjunct reduces to `!touchesExportedSurface` (spec FR-4). Absence of a
 * measurement is NOT proof of low reach. Flip this when the index lands.
 */
export function reachKnownLow(
  signals: ReadonlyArray<ClassificationSignal>,
): boolean {
  // A degrade marker means reach is explicitly unmeasured.
  if (signals.some((s) => s.name === REACH_UNAVAILABLE)) return false;
  // No affirmative low-reach signal type exists in v1; there is nothing that can
  // prove low reach here. Deny-by-default ⇒ false.
  return false;
}

// ─── FR-1 review-signal green predicates ─────────────────────────────────────
//
// These reproduce, structurally, the exact green conditions of the #180 renderer
// (`renderReviewSignals` in @aiclarity/shared). A parity test in auto-merge.test.ts
// pins them to the renderer's "all three green" sentinel so they can never drift.

/** Signal 1 — the stated root cause maps onto the diff. */
export function rootCauseGreen(rs: ReviewSignalsInput): boolean {
  const cause = (rs.rootCause ?? '').trim();
  if (cause === '') return false;
  const rcFiles = rs.rootCauseFiles ?? [];
  if (rcFiles.length === 0) return false;
  const changed = new Set(rs.changedFiles ?? []);
  return rcFiles.every((f) => changed.has(f));
}

/**
 * Signal 2 — a named regression PROVABLY fails on base and passes on head. NOTE:
 * `rs` here MUST already carry the prover-authoritative flags (see
 * `withVerifiedAuthority`); the raw agent self-report is never trusted (INV-3).
 */
export function regressionGreen(rs: ReviewSignalsInput): boolean {
  const test = (rs.regressionTest ?? '').trim();
  if (!test) return false;
  return rs.regressionProvenBaseRed === true && rs.regressionProvenHeadGreen === true;
}

/** Signal 3 — the gate (test/lint/build/validate) is fully green. */
export function gateGreen(rs: ReviewSignalsInput): boolean {
  const gate = rs.gate;
  if (!gate) return false;
  return (
    gate.test === 'pass' &&
    gate.lint === 'pass' &&
    gate.build === 'pass' &&
    gate.validate === 'pass'
  );
}

/** All three #180 review signals green. Mirrors the renderer's `allGreen`. */
export function allReviewSignalsGreen(rs: ReviewSignalsInput): boolean {
  return rootCauseGreen(rs) && regressionGreen(rs) && gateGreen(rs);
}

/**
 * INV-3 + #489 — overlay the gate's VERIFIED authority onto the agent's review
 * signals, discarding the corresponding self-reports so neither Signal-1 nor
 * Signal-2 can be passed by an agent grading its own homework:
 *
 *  - **Proof (Signal-2):** the FR-2 `prover` result is the SOLE authority for the
 *    red→green proof. Any self-reported `regressionProvenBaseRed`/`…HeadGreen` on
 *    `rs` is DISCARDED. Absent prover ⇒ both false (deny-by-default).
 *  - **Diff (Signal-1, #489):** the REAL git-diff paths (`realChangedFiles`) are
 *    the SOLE authority for `changedFiles`. Signal-1 checks `rootCauseFiles ⊆
 *    changedFiles`; when BOTH came from the agent, it passed trivially by claiming
 *    a self-consistent set. The real diff (same source the consequence/hollow
 *    signals already use) replaces it. Absent a supplied diff, `rs.changedFiles`
 *    is used unchanged — the pure-decision unit tests inject their diff there; the
 *    production gate ALWAYS supplies `realChangedFiles`, so the self-report never
 *    counts toward eligibility.
 *
 * KNOWN ASYMMETRY (advisory, non-blocking — flagged in #728 review): Signal-2's
 * "absent ⇒ deny" and Signal-1's "absent ⇒ fall back to the caller's own set" are
 * not symmetric. Today this is inert (the production gate always supplies
 * `realChangedFiles`), but it re-opens the Signal-1 bypass for any FUTURE caller
 * of `decideAutoMerge` that skips `changedFilePaths`. Closing it — e.g. an
 * explicit "real-diff-known" deny flag on `AutoMergeInput` — changes this INV-1
 * gate's contract and the pinned "pure-unit-test path preserved" test above, so
 * it needs a deliberate design pass (architect), not a drive-by edit; tracked for
 * a follow-up rather than changed here.
 */
function withVerifiedAuthority(
  rs: ReviewSignalsInput,
  prover: ProverResult | undefined,
  realChangedFiles: readonly string[] | undefined,
): ReviewSignalsInput {
  return {
    ...rs,
    regressionProvenBaseRed: prover?.regressionProvenBaseRed === true,
    regressionProvenHeadGreen: prover?.regressionGreenOnHead === true,
    changedFiles: realChangedFiles !== undefined ? [...realChangedFiles] : rs.changedFiles,
  };
}

// ─── FR-1 the decision ───────────────────────────────────────────────────────

/**
 * Decide whether a PR is eligible to auto-merge to `main` with no human eyes.
 *
 * PURE (INV-6): a function of its inputs only. Deny-by-default (INV-1): returns
 * `eligible: true` ONLY when EVERY condition is affirmatively met; any missing/
 * unknown/unverified input yields `eligible: false` with a populated `failed[]`.
 */
export function decideAutoMerge(input: AutoMergeInput): AutoMergeDecision {
  const failed: string[] = [];

  // ── FR-4a / FR-5: derive exported-surface + blast (single source of truth) ──
  // Missing consequence signals ⇒ blast cannot be measured ⇒ deny-by-default:
  // assume exported-touch and high blast.
  const signalsKnown = Array.isArray(input?.consequenceSignals);
  const signals: ReadonlyArray<ClassificationSignal> = signalsKnown
    ? input.consequenceSignals
    : [];
  const touchesExportedSurface = signalsKnown
    ? deriveTouchesExportedSurface(signals)
    : true;
  const blast: 'low' | 'high' = signalsKnown
    ? classifyBlast(signals, touchesExportedSurface)
    : 'high';

  // ── C4 mode gate. pr-gate ⇒ ALWAYS hold (status quo), but report the blast. ──
  if (input?.mode === 'pr-gate') {
    return {
      eligible: false,
      blast,
      reason: 'pr-gate mode — every PR holds for a human skim (DR-033 C4 kill-switch).',
      failed: ['pr-gate-mode'],
    };
  }
  if (input?.mode !== 'consequence-hybrid') failed.push('mode-unknown');
  if (!signalsKnown) failed.push('consequence-signals-missing');

  // ── FR-1 (1): three review signals green, prover as SOLE authority (INV-3) ──
  const reviewSignals = input?.reviewSignals;
  if (!reviewSignals || typeof reviewSignals !== 'object') {
    failed.push('review-signals-missing');
  } else {
    const effective = withVerifiedAuthority(reviewSignals, input?.proverResult, input?.changedFilePaths);
    if (!rootCauseGreen(effective)) failed.push('root-cause');
    if (!regressionGreen(effective)) failed.push('regression-unproven');
    if (!gateGreen(effective)) failed.push('gate-not-green');
  }

  // ── FR-1 (2) / INV-4: no hollow or stub finding ─────────────────────────────
  const hollowKnown = Array.isArray(input?.hollowFindings);
  if (!hollowKnown) {
    failed.push('hollow-findings-missing');
  } else if (input.hollowFindings.length > 0) {
    failed.push('hollow-tests');
  }

  // ── FR-1 (3) / FR-5: blast must be low ──────────────────────────────────────
  if (blast !== 'low') failed.push('high-blast');

  // ── FR-1 (4) / FR-4 / INV-2: reach known low OR not an exported touch ───────
  if (!reachKnownLow(signals) && touchesExportedSurface) failed.push('unmeasured-blast');

  const eligible = failed.length === 0;

  let reason: string;
  if (eligible) {
    reason =
      'eligible: low-blast, all three review signals green (prover-verified red→green), ' +
      'no hollow/stub tests, reach conjunct satisfied — auto-merge.';
  } else {
    const explain = blast === 'high' ? blastExplain(signals, touchesExportedSurface) : undefined;
    reason =
      `hold (${blast}-blast): ${failed.join(', ')}.` +
      (explain ? ` blast reason — ${explain}.` : '');
  }

  return { eligible, blast, reason, failed };
}
