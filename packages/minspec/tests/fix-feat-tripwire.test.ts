/**
 * T0 — monthly fix:feat tripwire (#691).
 *
 * Covers commit-type classification, area classification, `git log --numstat`
 * parsing, month aggregation of count- and churn-based ratios, and the
 * tripwire's two independent triggers (ceiling breach, sustained rise) —
 * including the exact 0.56 → 0.95 → 1.52 shape the 2026-07-13 audit found.
 */

import { describe, it, expect } from 'vitest';
import {
  aggregateByMonth,
  buildGitLogArgs,
  classifyArea,
  classifyCommitKind,
  evaluateTripwire,
  parseGitLog,
  type Commit,
  type MonthStats,
} from '../src/lib/fix-feat-tripwire';

// ─── classifyCommitKind ───────────────────────────────────────────────────────

describe('classifyCommitKind', () => {
  it.each([
    ['fix: root cause the thing', 'fix'],
    ['fix(#701): reconstruct approval-diff baseline', 'fix'],
    ['fix!: breaking fix', 'fix'],
    ['fix(scope)!: breaking scoped fix', 'fix'],
    ['feat: add tripwire', 'feat'],
    ['feat(#691): monthly fix:feat tripwire', 'feat'],
    ['chore(approve): SPEC-006 approved', 'other'],
    ['docs: update README', 'other'],
    ['Merge pull request #704 from AIClarityAU:fix/701', 'other'],
    ['random subject with no prefix', 'other'],
    ['fixture: not actually a fix', 'other'],
  ])('classifies %j as %s', (subject, expected) => {
    expect(classifyCommitKind(subject)).toBe(expected);
  });
});

// ─── classifyArea ─────────────────────────────────────────────────────────────

describe('classifyArea', () => {
  it.each([
    ['packages/minspec/src/lib/fix-feat-tripwire.ts', 'product'],
    ['packages/minspec/tests/fix-feat-tripwire.test.ts', 'product'],
    ['.github/workflows/ci.yml', 'machinery'],
    ['scripts/fix-feat-tripwire.ts', 'machinery'],
    ['sites/minspec.dev/index.html', 'sites'],
    ['docs/decisions/DR-060.md', 'other'],
    ['specs/minspec/tasks.md', 'other'],
    ['README.md', 'other'],
  ])('classifies %j as %s', (path, expected) => {
    expect(classifyArea(path)).toBe(expected);
  });
});

// ─── buildGitLogArgs ──────────────────────────────────────────────────────────

describe('buildGitLogArgs', () => {
  it('omits --since when not given', () => {
    const args = buildGitLogArgs();
    expect(args).not.toContain(expect.stringMatching(/^--since=/));
    expect(args.some((a) => a.startsWith('--since='))).toBe(false);
  });

  it('appends --since=<expr> when given', () => {
    const args = buildGitLogArgs('2026-01-01');
    expect(args).toContain('--since=2026-01-01');
  });

  it('always requests --no-merges, --numstat, and short dates', () => {
    const args = buildGitLogArgs();
    expect(args).toContain('--no-merges');
    expect(args).toContain('--numstat');
    expect(args).toContain('--date=short');
  });
});

// ─── parseGitLog ──────────────────────────────────────────────────────────────

const MARKER = '\x01FFT-COMMIT\x01';
const SEP = '\x1f';

function fakeLogBlock(sha: string, date: string, subject: string, numstat: string[]): string {
  const header = `${MARKER}${sha}${SEP}${date}${SEP}${subject}`;
  return [header, ...numstat].join('\n');
}

describe('parseGitLog', () => {
  it('parses a single commit with numstat lines', () => {
    const raw = fakeLogBlock('abc123', '2026-07-01', 'fix(#691): thing', [
      '10\t2\tpackages/minspec/src/lib/foo.ts',
      '5\t0\tscripts/bar.ts',
    ]);
    const commits = parseGitLog(raw);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      sha: 'abc123',
      date: '2026-07-01',
      month: '2026-07',
      subject: 'fix(#691): thing',
      kind: 'fix',
    });
    expect(commits[0].files).toEqual([
      { path: 'packages/minspec/src/lib/foo.ts', additions: 10, deletions: 2 },
      { path: 'scripts/bar.ts', additions: 5, deletions: 0 },
    ]);
  });

  it('parses multiple commits back to back', () => {
    const raw =
      fakeLogBlock('sha1', '2026-06-15', 'feat: a', ['1\t1\tpackages/a.ts']) +
      '\n' +
      fakeLogBlock('sha2', '2026-06-20', 'fix: b', ['2\t2\tpackages/b.ts']);
    const commits = parseGitLog(raw);
    expect(commits.map((c) => c.sha)).toEqual(['sha1', 'sha2']);
  });

  it('treats binary numstat markers (-\\t-\\t<path>) as zero churn', () => {
    const raw = fakeLogBlock('sha1', '2026-07-01', 'feat: add image', ['-\t-\tsites/logo.png']);
    const commits = parseGitLog(raw);
    expect(commits[0].files).toEqual([{ path: 'sites/logo.png', additions: 0, deletions: 0 }]);
  });

  it('handles a commit with no file changes (empty numstat)', () => {
    const raw = fakeLogBlock('sha1', '2026-07-01', 'chore: bump', []);
    const commits = parseGitLog(raw);
    expect(commits).toHaveLength(1);
    expect(commits[0].files).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseGitLog('')).toEqual([]);
  });

  it('skips a header with a missing sha or date', () => {
    const raw = `${MARKER}${SEP}${SEP}broken`;
    expect(parseGitLog(raw)).toEqual([]);
  });
});

// ─── aggregateByMonth ─────────────────────────────────────────────────────────

function mkCommit(overrides: Partial<Commit>): Commit {
  return {
    sha: 'sha',
    date: '2026-07-01',
    month: '2026-07',
    subject: 'fix: x',
    kind: 'fix',
    files: [],
    ...overrides,
  };
}

describe('aggregateByMonth', () => {
  it('counts fix/feat/other per month and computes count-ratio', () => {
    const commits: Commit[] = [
      mkCommit({ kind: 'fix' }),
      mkCommit({ kind: 'fix' }),
      mkCommit({ kind: 'feat' }),
      mkCommit({ kind: 'other' }),
    ];
    const [month] = aggregateByMonth(commits);
    expect(month.fixCount).toBe(2);
    expect(month.featCount).toBe(1);
    expect(month.otherCount).toBe(1);
    expect(month.countRatio).toBe(2);
  });

  it('yields a null count-ratio when there are zero feats that month (not zero or Infinity)', () => {
    const commits: Commit[] = [mkCommit({ kind: 'fix' })];
    const [month] = aggregateByMonth(commits);
    expect(month.countRatio).toBeNull();
  });

  it('splits churn by area and computes per-area + overall churn ratios', () => {
    const commits: Commit[] = [
      mkCommit({
        kind: 'fix',
        files: [
          { path: 'packages/a.ts', additions: 8, deletions: 2 }, // 10 product
          { path: 'scripts/b.ts', additions: 3, deletions: 1 }, // 4 machinery
        ],
      }),
      mkCommit({
        kind: 'feat',
        files: [
          { path: 'packages/c.ts', additions: 4, deletions: 1 }, // 5 product
          { path: 'sites/d.html', additions: 2, deletions: 0 }, // 2 sites
        ],
      }),
    ];
    const [month] = aggregateByMonth(commits);
    expect(month.churnByArea.product).toEqual({ fixLines: 10, featLines: 5, ratio: 2 });
    expect(month.churnByArea.machinery).toEqual({ fixLines: 4, featLines: 0, ratio: null });
    expect(month.churnByArea.sites).toEqual({ fixLines: 0, featLines: 2, ratio: 0 });
    expect(month.overallChurn).toEqual({ fixLines: 14, featLines: 7, ratio: 2 });
  });

  it('sorts months ascending and handles multiple months independently', () => {
    const commits: Commit[] = [
      mkCommit({ month: '2026-07', kind: 'fix' }),
      mkCommit({ month: '2026-05', kind: 'feat' }),
      mkCommit({ month: '2026-06', kind: 'fix' }),
    ];
    const months = aggregateByMonth(commits);
    expect(months.map((m) => m.month)).toEqual(['2026-05', '2026-06', '2026-07']);
  });

  it('returns an empty array for no commits', () => {
    expect(aggregateByMonth([])).toEqual([]);
  });
});

// ─── evaluateTripwire ─────────────────────────────────────────────────────────

function mkMonth(month: string, countRatio: number | null): MonthStats {
  const emptyChurn = { fixLines: 0, featLines: 0, ratio: null as number | null };
  return {
    month,
    fixCount: 0,
    featCount: 0,
    otherCount: 0,
    countRatio,
    churnByArea: {
      product: { ...emptyChurn },
      machinery: { ...emptyChurn },
      sites: { ...emptyChurn },
      other: { ...emptyChurn },
    },
    overallChurn: { ...emptyChurn },
  };
}

describe('evaluateTripwire', () => {
  it('fires the exact #691 audit shape: 3 consecutive rising months', () => {
    const months = [mkMonth('2026-05', 0.56), mkMonth('2026-06', 0.95), mkMonth('2026-07', 1.52)];
    const alerts = evaluateTripwire(months, { sustainedMonths: 3, countRatioCeiling: 2.0 });
    expect(alerts.some((a) => a.reason.includes('rose for 3 consecutive months'))).toBe(true);
  });

  it('does not fire a sustained-rise alert on a flat or falling series', () => {
    const months = [mkMonth('2026-05', 0.9), mkMonth('2026-06', 0.9), mkMonth('2026-07', 0.5)];
    const alerts = evaluateTripwire(months, { sustainedMonths: 3, countRatioCeiling: 2.0 });
    expect(alerts.some((a) => a.reason.includes('consecutive months'))).toBe(false);
  });

  it('does not fire a sustained-rise alert when a month in the window has a null ratio', () => {
    const months = [mkMonth('2026-05', 0.5), mkMonth('2026-06', null), mkMonth('2026-07', 1.5)];
    const alerts = evaluateTripwire(months, { sustainedMonths: 3, countRatioCeiling: 2.0 });
    expect(alerts.some((a) => a.reason.includes('consecutive months'))).toBe(false);
  });

  it('fires a ceiling alert when a single month meets/exceeds the ceiling', () => {
    const months = [mkMonth('2026-07', 1.0)];
    const alerts = evaluateTripwire(months, { sustainedMonths: 3, countRatioCeiling: 1.0 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].month).toBe('2026-07');
    expect(alerts[0].reason).toContain('meets/exceeds ceiling');
  });

  it('does not fire a ceiling alert below the ceiling', () => {
    const months = [mkMonth('2026-07', 0.99)];
    const alerts = evaluateTripwire(months, { sustainedMonths: 3, countRatioCeiling: 1.0 });
    expect(alerts).toEqual([]);
  });

  it('ignores a null-ratio month for the ceiling check', () => {
    const months = [mkMonth('2026-07', null)];
    const alerts = evaluateTripwire(months, { sustainedMonths: 3, countRatioCeiling: 1.0 });
    expect(alerts).toEqual([]);
  });

  it('returns no alerts for an empty month list', () => {
    expect(evaluateTripwire([])).toEqual([]);
  });
});
