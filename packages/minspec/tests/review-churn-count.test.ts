/**
 * T3 — the churn counting loop in scripts/review-churn-report.sh (#1840).
 *
 * This loop produces the number that decides whether to wire patch-hash
 * re-attestation, and it has already shipped three defects that each yielded
 * confident, plausible, WRONG output:
 *
 *   - eligibility (completed+success+allowlisted) was applied to the run being
 *     COUNTED rather than the run being re-attested FROM. Measured, that silently
 *     excluded 53% of runs, and it excluded them in the direction of arguing
 *     against wiring;
 *   - a per-SHA cache written without a trailing newline let one commit's rows be
 *     appended to the previous commit's last row, so `sort -u` merged two records
 *     and the parser read the wrong fields (that path is outside this block's
 *     markers: see review-churn-cache.test.ts, which is the test that catches it);
 *   - the per-PR commits fetch recorded no APIFAIL sentinel, so a failed fetch
 *     dropped a whole PR while the "refusing to report a partial dataset" guard
 *     stayed silent.
 *
 * None of those were visible in the output. The block is executed VERBATIM out of
 * the script so this cannot drift from what actually runs; it is bracketed by
 * `# >>> churn-count` / `# <<< churn-count` and extraction fails loudly if the
 * markers go missing.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const SCRIPT = path.resolve(__dirname, '../../../scripts/review-churn-report.sh');
const src = fs.readFileSync(SCRIPT, 'utf-8');
const BEGIN = '# >>> churn-count';
const END = '# <<< churn-count';

function countBlock(): string {
  const b = src.indexOf(BEGIN);
  const e = src.indexOf(END);
  if (b < 0 || e < 0 || e <= b) {
    throw new Error(
      `churn-count markers missing from ${SCRIPT} — the block this test executes has ` +
        `moved. Fix the markers rather than deleting the test: without it, the counting ` +
        `logic behind the #1840 decision has no enforcement at all.`,
    );
  }
  return src.slice(src.indexOf('\n', b) + 1, e);
}

type Counts = {
  tot: number; success: number; neutral: number; failure: number; other: number;
  fp_runs: number; skippable: number; nofp: number; offslug: number;
};

/** Run the real loop over canned TSV rows (ts \t conclusion \t slug \t fingerprint). */
function count(rows: string[]): Counts {
  const script = [
    'set -uo pipefail',
    'REVIEWER_SLUG=minspec-sdd',
    'tot=0; c_success=0; c_neutral=0; c_failure=0; c_other=0',
    'fp_runs=0; skippable=0; nofp=0; offslug=0',
    'rows="$ROWS"',
    countBlock(),
    'printf "%s %s %s %s %s %s %s %s %s\\n" "$tot" "$c_success" "$c_neutral" "$c_failure" ' +
      '"$c_other" "$fp_runs" "$skippable" "$nofp" "$offslug"',
  ].join('\n');
  const out = execFileSync('bash', ['-c', script], {
    env: { ...process.env, ROWS: rows.join('\n') },
    encoding: 'utf-8',
  }).trim();
  const [tot, success, neutral, failure, other, fp_runs, skippable, nofp, offslug] = out
    .split(/\s+/)
    .map(Number);
  return { tot, success, neutral, failure, other, fp_runs, skippable, nofp, offslug };
}

const FP_A = 'a'.repeat(64);
const FP_B = 'b'.repeat(64);
const row = (concl: string, fp: string, ts = '2026-09-12T00:00:00Z', slug = 'minspec-sdd') =>
  [ts, concl, slug, fp].join('\t');

describe('churn counting loop', () => {
  it('counts a repeat only when an EARLIER run passed on the same patch', () => {
    const c = count([
      row('success', FP_A, '2026-09-12T01:00:00Z'),
      row('success', FP_A, '2026-09-12T02:00:00Z'),
    ]);
    expect(c.fp_runs).toBe(2);
    expect(c.skippable).toBe(1);
  });

  it('does NOT count a repeat when the first run did not pass', () => {
    // Nothing to re-attest FROM: the gate requires a completed+success prior run.
    const c = count([
      row('failure', FP_A, '2026-09-12T01:00:00Z'),
      row('failure', FP_A, '2026-09-12T02:00:00Z'),
    ]);
    expect(c.fp_runs).toBe(2);
    expect(c.skippable).toBe(0);
  });

  it('DOES count a failed re-review of an already-passed patch', () => {
    // The regression that excluded 53% of runs. Eligibility describes the run being
    // re-attested FROM; a skipped run never gets a conclusion of its own, so filtering
    // on the counted run's conclusion drops exactly what re-attestation would prevent.
    const c = count([
      row('success', FP_A, '2026-09-12T01:00:00Z'),
      row('failure', FP_A, '2026-09-12T02:00:00Z'),
    ]);
    expect(c.skippable).toBe(1);
  });

  it('matches a non-adjacent earlier pass, not just the previous run', () => {
    // A,B,A must score 1: findReattestableVerdict scans ALL prior runs.
    const c = count([
      row('success', FP_A, '2026-09-12T01:00:00Z'),
      row('success', FP_B, '2026-09-12T02:00:00Z'),
      row('success', FP_A, '2026-09-12T03:00:00Z'),
    ]);
    expect(c.skippable).toBe(1);
  });

  it('never re-attests from a non-allowlisted app', () => {
    const c = count([
      row('success', FP_A, '2026-09-12T01:00:00Z', 'somebody-else'),
      row('success', FP_A, '2026-09-12T02:00:00Z'),
    ]);
    expect(c.offslug).toBe(1);
    expect(c.skippable).toBe(0);
  });

  it('keeps unfingerprinted runs out of the denominator but counts them by conclusion', () => {
    const c = count([row('success', '-'), row('neutral', '-')]);
    expect(c.nofp).toBe(2);
    expect(c.fp_runs).toBe(0);
    expect(c.tot).toBe(2);
  });

  it('tallies machinery neutrals, which can never be re-attested from', () => {
    // The structural limit on #1840: neutral is never a source, so these runs burn the
    // full voter panel and re-attestation cannot skip any of them.
    const c = count([
      row('neutral', FP_A, '2026-09-12T01:00:00Z'),
      row('neutral', FP_A, '2026-09-12T02:00:00Z'),
    ]);
    expect(c.neutral).toBe(2);
    expect(c.skippable).toBe(0);
  });

  it('keeps three distinct records distinct', () => {
    // NOT a guard against the cache-newline defect, despite an earlier comment here
    // claiming so. That defect lives in the fetch/cache emit path, OUTSIDE the
    // `# >>> churn-count` block this test executes, and reverting the cache fix leaves
    // every case in this file green - measured. review-churn-cache.test.ts covers it,
    // and goes red on that same mutant. What this case actually asserts is narrower:
    // the counting loop attributes each field of each row to the right counter.
    const c = count([
      row('success', FP_A, '2026-09-12T01:00:00Z'),
      row('neutral', FP_B, '2026-09-12T02:00:00Z'),
      row('failure', FP_B, '2026-09-12T03:00:00Z'),
    ]);
    expect(c.tot).toBe(3);
    expect(c.fp_runs).toBe(3);
    expect(c.success).toBe(1);
    expect(c.neutral).toBe(1);
    expect(c.failure).toBe(1);
  });
});
