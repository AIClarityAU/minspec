/**
 * T3 — the carried-vs-reviewed split in scripts/review-churn-report.sh (#2636).
 *
 * The verdict carry built for #1688 (DR-104) lets a round post a completed `ai-review`
 * check run WITHOUT the voters running — the previous head's pass is carried forward.
 * review-churn-report.sh's `churn-count` block (review-churn-count.test.ts) cannot
 * tell the two apart: it just counts completed check runs. Once the carry is live,
 * every carried round would be miscounted as a repeat review "that could be skipped" —
 * when the voters never ran at all.
 *
 * This block reads the check run's own TITLE (`planVerdictCarry` /
 * `renderCarriedComment` in ai-review-guard.js append "verdict carried forward" to it —
 * DR-104 Decision 5) to tell carried from reviewed, and — among reviewed rounds —
 * flags the ones whose patch-fingerprint matches an earlier pass (the churn-count
 * `skippable` definition) as "reviewed although nothing changed": a case the carry
 * would have been expected to catch and didn't. It splits the refusal by the one
 * reason this instrument CAN tell mechanically from check-run data alone — whether the
 * immediately preceding commit ever completed a round — and bundles every other cause
 * (including moved hunks — DR-104 follow-up #2635) into "other", documented in the
 * script as NOT a moved-hunks count on its own.
 *
 * The block is executed VERBATIM out of the script so this cannot drift from what
 * actually runs; it is bracketed by `# >>> carry-count` / `# <<< carry-count` and
 * extraction fails loudly if the markers go missing.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const SCRIPT = path.resolve(__dirname, '../../../scripts/review-churn-report.sh');
const src = fs.readFileSync(SCRIPT, 'utf-8');
const BEGIN = '# >>> carry-count';
const END = '# <<< carry-count';

function carryBlock(): string {
  const b = src.indexOf(BEGIN);
  const e = src.indexOf(END);
  if (b < 0 || e < 0 || e <= b) {
    throw new Error(
      `carry-count markers missing from ${SCRIPT} — the block this test executes has ` +
        `moved. Fix the markers rather than deleting the test: without it, #2636's ` +
        `carried-vs-reviewed split has no enforcement at all.`,
    );
  }
  return src.slice(src.indexOf('\n', b) + 1, e);
}

type Counts = {
  carried: number;
  reviewed: number;
  nochange: number;
  refused_incomplete: number;
  refused_other: number;
};

/**
 * Drive the real block over a per-SHA cache, in the given commit order. `rowsBySha[sha]`
 * is zero or more TSV rows (ts, conclusion, slug, fingerprint, title) — zero rows (or an
 * absent key) models a commit whose ai-review round never completed, matching how
 * sha-emit leaves an empty cache file for that case.
 */
function count(shas: string[], rowsBySha: Record<string, string[]>): Counts {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carry-count-'));
  for (const sha of shas) {
    const rows = rowsBySha[sha] ?? [];
    fs.writeFileSync(path.join(dir, sha), rows.length ? rows.join('\n') + '\n' : '');
  }
  // $shas must carry REAL newlines (the block reads it with `<<<`), and
  // JSON.stringify would escape them to a literal backslash-n instead — so the list
  // goes into its own file and is read back with `$(cat ...)`, never interpolated
  // into the script text directly.
  const shasFile = path.join(dir, '.shas-order');
  fs.writeFileSync(shasFile, shas.join('\n'));
  const script = [
    'set -uo pipefail',
    'REVIEWER_SLUG=minspec-sdd',
    `SHACACHE=${JSON.stringify(dir)}`,
    'carry_carried=0; carry_reviewed=0; carry_nochange=0',
    'carry_refused_incomplete=0; carry_refused_other=0',
    `shas="$(cat ${JSON.stringify(shasFile)})"`,
    carryBlock(),
    'printf "%s %s %s %s %s\\n" "$carry_carried" "$carry_reviewed" "$carry_nochange" ' +
      '"$carry_refused_incomplete" "$carry_refused_other"',
  ].join('\n');
  const out = execFileSync('bash', ['-c', script], { encoding: 'utf-8' }).trim();
  const [carried, reviewed, nochange, refused_incomplete, refused_other] = out
    .split(/\s+/)
    .map(Number);
  return { carried, reviewed, nochange, refused_incomplete, refused_other };
}

const FP_A = 'a'.repeat(64);
const FP_B = 'b'.repeat(64);
const row = (
  concl: string,
  fp: string,
  title = '',
  ts = '2026-09-12T00:00:00Z',
  slug = 'minspec-sdd',
) => [ts, concl, slug, fp, title].join('\t');
const CARRIED_TITLE = 'ai-review: pass (verdict carried forward from abcd1234, voters did not run)';

describe('carried-vs-reviewed split (#2636)', () => {
  it('counts a carried round by its check-run title, not by its conclusion', () => {
    const c = count(['s1', 's2'], {
      s1: [row('success', FP_A, '', '2026-09-12T01:00:00Z')],
      s2: [row('success', FP_A, CARRIED_TITLE, '2026-09-12T02:00:00Z')],
    });
    expect(c.carried).toBe(1);
    expect(c.reviewed).toBe(1);
  });

  it('flags a byte-identical re-review that was NOT carried as nothing-changed', () => {
    const c = count(['s1', 's2'], {
      s1: [row('success', FP_A, '', '2026-09-12T01:00:00Z')],
      s2: [row('success', FP_A, '', '2026-09-12T02:00:00Z')],
    });
    expect(c.reviewed).toBe(2);
    expect(c.nochange).toBe(1);
  });

  it('does not flag a reviewed round whose patch differs from every earlier pass', () => {
    const c = count(['s1', 's2'], {
      s1: [row('success', FP_A, '', '2026-09-12T01:00:00Z')],
      s2: [row('success', FP_B, '', '2026-09-12T02:00:00Z')],
    });
    expect(c.nochange).toBe(0);
  });

  it('does not count a repeat when the earlier run did not pass', () => {
    const c = count(['s1', 's2'], {
      s1: [row('failure', FP_A, '', '2026-09-12T01:00:00Z')],
      s2: [row('failure', FP_A, '', '2026-09-12T02:00:00Z')],
    });
    expect(c.nochange).toBe(0);
  });

  it('attributes the refusal to an incomplete predecessor when the prior commit never completed', () => {
    const c = count(['s1', 's2', 's3'], {
      s1: [row('success', FP_A, '', '2026-09-12T01:00:00Z')],
      // s2 has no cache entry at all: its round never completed.
      s3: [row('success', FP_A, '', '2026-09-12T03:00:00Z')],
    });
    expect(c.nochange).toBe(1);
    expect(c.refused_incomplete).toBe(1);
    expect(c.refused_other).toBe(0);
  });

  it('attributes the refusal to "other" when the immediate predecessor DID complete', () => {
    const c = count(['s1', 's2', 's3'], {
      s1: [row('success', FP_A, '', '2026-09-12T01:00:00Z')],
      s2: [row('success', FP_B, '', '2026-09-12T02:00:00Z')],
      s3: [row('success', FP_A, '', '2026-09-12T03:00:00Z')],
    });
    expect(c.nochange).toBe(1);
    expect(c.refused_incomplete).toBe(0);
    expect(c.refused_other).toBe(1);
  });

  it('picks the LATEST run on a SHA with more than one completed check-run', () => {
    const c = count(['s1', 's2'], {
      s1: [
        row('failure', FP_B, '', '2026-09-12T01:00:00Z'),
        row('success', FP_A, '', '2026-09-12T01:05:00Z'),
      ],
      s2: [row('success', FP_A, '', '2026-09-12T02:00:00Z')],
    });
    // s1's LATEST run passed on FP_A, so s2's byte-identical patch is a repeat, and s1
    // did complete — reading only s1's first (failed, FP_B) run would get both wrong.
    expect(c.nochange).toBe(1);
    expect(c.refused_incomplete).toBe(0);
  });

  it('never attributes a repeat to a non-allowlisted app', () => {
    const c = count(['s1', 's2'], {
      s1: [row('success', FP_A, '', '2026-09-12T01:00:00Z', 'somebody-else')],
      s2: [row('success', FP_A, '', '2026-09-12T02:00:00Z')],
    });
    expect(c.nochange).toBe(0);
  });
});
