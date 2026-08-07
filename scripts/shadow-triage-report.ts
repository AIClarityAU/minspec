/**
 * shadow-triage-report.ts — aggregate the shadow-triage JSONL and evaluate the two
 * rollback triggers from #1338.
 *
 * The aggregation (`aggregate`) is a PURE function over parsed rows, so the pilot's
 * verdict is unit-testable against synthetic rows rather than only against whatever
 * the log happens to contain. `main()` is the only impure part: read file, print.
 *
 * ── The two triggers (#1338's staged plan, step 1) ───────────────────────────
 *   "Dual-run GLM alongside the current triage on the next 50 public-repo issues,
 *    GLM output discarded. Metrics: exact tier and type agreement, and verdict-block
 *    schema conformance. Rollback trigger: agreement below 90%, or malformed blocks
 *    above 2%."
 *
 * Two denominators, deliberately NOT merged — the distinction is the difference
 * between "GLM is unfit" and "z.ai was down":
 *
 *   errored     no usable response came back at all (timeout, non-zero exit, empty
 *               body). An infrastructure fact about the pilot, not a fact about GLM.
 *               Excluded from BOTH metrics; reported on its own line so a reader can
 *               see how much of the sample the endpoint ate.
 *   responded   a response came back. This is the denominator for MALFORMED %,
 *               because schema conformance is a property of a response.
 *   conformant  the response carried a well-formed verdict block. This is the
 *               denominator for AGREEMENT %, because you cannot agree with a verdict
 *               that was never emitted — scoring an absent verdict as disagreement
 *               would double-count the same defect the malformed metric already
 *               reports, and scoring it as agreement would be worse.
 *
 * ── Why "PASS/FAIL" is not enough ────────────────────────────────────────────
 * A trigger evaluated over an empty log is not a PASS and it is not a FAIL — it is
 * INSUFFICIENT. Printing PASS there would announce the pilot cleared a bar it was
 * never measured against, and printing FAIL would condemn a model that never ran.
 * In a product whose whole claim is that the signpost does not lie, "no data" has to
 * be its own answer. Exit codes: 0 PASS · 1 FAIL · 2 INSUFFICIENT.
 */

import * as fs from 'node:fs';

/** The gate's normalised verdict, as `triage-decide.sh --fields` projects it. */
export interface ShadowFields {
  label?: string;
  role?: string;
  hold?: string;
  tier?: string;
  human_only?: string;
}

export interface ShadowAgreement {
  label: boolean;
  role: boolean;
  hold: boolean;
  tier: boolean;
  human_only: boolean;
  all: boolean;
}

export interface ShadowRow {
  schema: string;
  issue: number;
  repo: string;
  at: string;
  model: string;
  baseUrl?: string;
  /** The response carried a well-formed verdict block. */
  conformant: boolean;
  latencyMs: number;
  /** Non-null when NO usable response came back (timeout / non-zero exit / empty). */
  error: string | null;
  live: ShadowFields;
  shadow: ShadowFields;
  agree: ShadowAgreement;
}

export const AGREEMENT_FIELDS = ['label', 'role', 'hold', 'tier', 'human_only'] as const;
export type AgreementField = (typeof AGREEMENT_FIELDS)[number];

/** #1338's thresholds, in one place so the report and any future gate read the same numbers. */
export const AGREEMENT_MIN_PCT = 90;
export const MALFORMED_MAX_PCT = 2;
/** The pilot's target sample size (#1338: "the next 50 public-repo issues"). */
export const TARGET_SAMPLE = 50;

export type TriggerVerdict = 'PASS' | 'FAIL' | 'INSUFFICIENT';

export interface ShadowReport {
  n: number;
  errored: number;
  responded: number;
  conformant: number;
  models: string[];
  /** Per-field agreement %, over CONFORMANT rows. null when there are none. */
  agreementPct: Record<AgreementField, number | null>;
  /** The headline #1338 metric: exact tier AND type (label) agreement. */
  tierTypeAgreementPct: number | null;
  /** Malformed %, over RESPONDED rows. null when there are none. */
  malformedPct: number | null;
  medianLatencyMs: number | null;
  triggers: {
    agreement: { verdict: TriggerVerdict; value: number | null; threshold: number };
    malformed: { verdict: TriggerVerdict; value: number | null; threshold: number };
  };
  overall: TriggerVerdict;
}

const pct = (num: number, den: number): number | null =>
  den === 0 ? null : Math.round((num / den) * 1000) / 10;

/**
 * Parse a JSONL log. Unreadable lines are COUNTED, never silently dropped: a report
 * that quietly ignored half its input would understate n and overstate confidence.
 */
export function parseRows(text: string): { rows: ShadowRow[]; unparseable: number } {
  const rows: ShadowRow[] = [];
  let unparseable = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && typeof parsed.issue === 'number') {
        rows.push(parsed as ShadowRow);
      } else {
        unparseable++;
      }
    } catch {
      unparseable++;
    }
  }
  return { rows, unparseable };
}

/** Pure aggregation. No IO, no clock, no environment. */
export function aggregate(rows: ShadowRow[]): ShadowReport {
  const n = rows.length;
  const errored = rows.filter((r) => r.error != null && r.error !== '').length;
  const responded = rows.filter((r) => r.error == null || r.error === '');
  const conformantRows = responded.filter((r) => r.conformant === true);

  const agreementPct = Object.fromEntries(
    AGREEMENT_FIELDS.map((f) => [
      f,
      pct(conformantRows.filter((r) => r.agree?.[f] === true).length, conformantRows.length),
    ]),
  ) as Record<AgreementField, number | null>;

  const tierTypeAgreementPct = pct(
    conformantRows.filter((r) => r.agree?.tier === true && r.agree?.label === true).length,
    conformantRows.length,
  );

  const malformedPct = pct(responded.length - conformantRows.length, responded.length);

  const latencies = rows.map((r) => r.latencyMs).filter((v) => typeof v === 'number' && v >= 0).sort((a, b) => a - b);
  const medianLatencyMs = latencies.length ? latencies[Math.floor((latencies.length - 1) / 2)] : null;

  // A null value means the metric had no denominator — INSUFFICIENT, never PASS.
  const agreementVerdict: TriggerVerdict =
    tierTypeAgreementPct == null ? 'INSUFFICIENT' : tierTypeAgreementPct >= AGREEMENT_MIN_PCT ? 'PASS' : 'FAIL';
  const malformedVerdict: TriggerVerdict =
    malformedPct == null ? 'INSUFFICIENT' : malformedPct <= MALFORMED_MAX_PCT ? 'PASS' : 'FAIL';

  // FAIL dominates INSUFFICIENT dominates PASS: one tripped trigger is a rollback
  // regardless of the other, and a missing metric can never be reported as overall PASS.
  const overall: TriggerVerdict =
    agreementVerdict === 'FAIL' || malformedVerdict === 'FAIL'
      ? 'FAIL'
      : agreementVerdict === 'INSUFFICIENT' || malformedVerdict === 'INSUFFICIENT'
        ? 'INSUFFICIENT'
        : 'PASS';

  return {
    n,
    errored,
    responded: responded.length,
    conformant: conformantRows.length,
    models: [...new Set(rows.map((r) => r.model).filter(Boolean))].sort(),
    agreementPct,
    tierTypeAgreementPct,
    malformedPct,
    medianLatencyMs,
    triggers: {
      agreement: { verdict: agreementVerdict, value: tierTypeAgreementPct, threshold: AGREEMENT_MIN_PCT },
      malformed: { verdict: malformedVerdict, value: malformedPct, threshold: MALFORMED_MAX_PCT },
    },
    overall,
  };
}

const show = (v: number | null, unit = '%') => (v == null ? 'n/a' : `${v}${unit}`);

export function formatReport(r: ShadowReport, unparseable = 0): string {
  const lines: string[] = [];
  lines.push('Shadow triage — GLM (z.ai) vs the live gate (#1338)');
  lines.push('');
  // The model line is first because an agreement number without a model id is not a
  // measurement of anything (#1338: "any pilot must pin the model explicitly").
  lines.push(`  model(s)           ${r.models.length ? r.models.join(', ') : '(none)'}`);
  if (r.models.length > 1) {
    lines.push('    ⚠ more than one model in this log — the agreement figure mixes targets.');
  }
  lines.push(`  samples (n)        ${r.n}${r.n < TARGET_SAMPLE ? `  (pilot target: ${TARGET_SAMPLE})` : ''}`);
  lines.push(`    responded        ${r.responded}`);
  lines.push(`    endpoint errors  ${r.errored}`);
  lines.push(`    conformant       ${r.conformant}`);
  if (unparseable) lines.push(`    unparseable rows ${unparseable}  ⚠ excluded from every figure below`);
  lines.push(`  median latency     ${show(r.medianLatencyMs, 'ms')}`);
  lines.push('');
  lines.push('  Agreement with the live gate (over conformant rows)');
  for (const f of AGREEMENT_FIELDS) lines.push(`    ${f.padEnd(16)} ${show(r.agreementPct[f])}`);
  lines.push('');
  lines.push('  Rollback triggers (#1338)');
  lines.push(
    `    tier+type agreement  ${show(r.tierTypeAgreementPct).padEnd(8)} (need >= ${AGREEMENT_MIN_PCT}%)   ${r.triggers.agreement.verdict}`,
  );
  lines.push(
    `    malformed blocks     ${show(r.malformedPct).padEnd(8)} (need <= ${MALFORMED_MAX_PCT}%)    ${r.triggers.malformed.verdict}`,
  );
  lines.push('');
  lines.push(`  OVERALL: ${r.overall}`);
  if (r.overall === 'INSUFFICIENT') {
    lines.push('  No trigger can be judged yet — this is not a pass. Collect more samples.');
  }
  return lines.join('\n');
}

function main(argv: string[]): number {
  let log = '.minspec/shadow-triage.jsonl';
  let asJson = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--log' && argv[i + 1]) log = argv[++i];
    else if (argv[i] === '--json') asJson = true;
  }

  let text = '';
  try {
    text = fs.readFileSync(log, 'utf-8');
  } catch {
    // A missing log is the ordinary pre-pilot state, not an error — the harness is
    // inert until a key is configured. Say so plainly instead of throwing.
    if (asJson) {
      console.log(JSON.stringify({ ...aggregate([]), log, exists: false }, null, 2));
    } else {
      console.log(`Shadow triage — no log at ${log}.`);
      console.log('The harness is inert until MINSPEC_SHADOW_TRIAGE_KEY is set (#1338).');
    }
    return 2;
  }

  const { rows, unparseable } = parseRows(text);
  const report = aggregate(rows);
  console.log(asJson ? JSON.stringify({ ...report, log, unparseable }, null, 2) : formatReport(report, unparseable));
  return report.overall === 'PASS' ? 0 : report.overall === 'FAIL' ? 1 : 2;
}

// Only run when invoked directly, so the pure functions above stay importable by tests.
if (process.argv[1] && /shadow-triage-report\.ts$/.test(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
