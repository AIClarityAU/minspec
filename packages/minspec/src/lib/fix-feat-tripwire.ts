/**
 * Monthly fix:feat tripwire (#691).
 *
 * 2026-07-13 malleability audit measured this repo's fix:feat ratio rising by
 * commit count (0.56 May → 0.95 Jun → 1.52 Jul-partial) while line-churn ratio
 * in product src stayed flat around 0.22:1, and found 24-32% of fix volume
 * lands on machinery/site files, not product — a raw unsplit ratio hides that.
 * Nothing in the repo measured this on an ongoing basis; this module is the
 * PURE decision core (commit classification, month aggregation, sustained-rise
 * detection) for a tripwire that will. All I/O — running `git log` — lives in
 * the CLI wrapper (`scripts/fix-feat-tripwire.ts`); this file takes only an
 * already-captured `git log` string so the logic is unit-testable without a
 * real repo.
 *
 * KNOWN LIMITATION: a renamed file's numstat path (`old => new` or
 * `{old => new}`) is treated as one opaque path string for area classification
 * — renames occasionally misclassify by area, but never drop churn from the
 * total. Acceptable for a monthly trend tripwire; not a source of truth.
 */

/** Conventional-commit type this module cares about; everything else is `other`. */
export type CommitKind = 'fix' | 'feat' | 'other';

/** Where a changed file lives, for the product/machinery/sites split. */
export type Area = 'product' | 'machinery' | 'sites' | 'other';

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
}

export interface Commit {
  sha: string;
  /** YYYY-MM-DD, from `git log --date=short`. */
  date: string;
  /** YYYY-MM, derived from {@link date}. */
  month: string;
  subject: string;
  kind: CommitKind;
  files: FileChange[];
}

// Delimiters chosen to never plausibly appear in a commit subject or sha.
const COMMIT_MARKER = '\x01FFT-COMMIT\x01';
const FIELD_SEP = '\x1f';

/**
 * Build the `git log` argv that {@link parseGitLog} expects to consume.
 * `--no-merges` excludes GitHub's two-parent "Merge pull request" commits so
 * each underlying fix/feat commit is counted exactly once.
 */
export function buildGitLogArgs(since?: string): string[] {
  const args = [
    'log',
    '--no-merges',
    '--date=short',
    `--pretty=format:${COMMIT_MARKER}%H${FIELD_SEP}%ad${FIELD_SEP}%s`,
    '--numstat',
  ];
  if (since) args.push(`--since=${since}`);
  return args;
}

const CONVENTIONAL_TYPE_RE = /^(\w+)(\([^)]*\))?!?:\s*/;

/** Classify a commit subject's conventional-commit type. Case-insensitive on the type token. */
export function classifyCommitKind(subject: string): CommitKind {
  const m = CONVENTIONAL_TYPE_RE.exec(subject.trim());
  if (!m) return 'other';
  const type = m[1].toLowerCase();
  if (type === 'fix') return 'fix';
  if (type === 'feat') return 'feat';
  return 'other';
}

/** Classify a repo-relative file path into the product/machinery/sites/other split. */
export function classifyArea(filePath: string): Area {
  if (filePath.startsWith('.github/') || filePath.startsWith('scripts/')) return 'machinery';
  if (filePath.startsWith('sites/')) return 'sites';
  if (filePath.startsWith('packages/')) return 'product';
  return 'other';
}

/**
 * Parse the raw stdout of a `git log` run with {@link buildGitLogArgs}' argv
 * into structured commits. Tolerant of a trailing/leading blank block; a
 * numstat line with fewer than 3 tab-separated fields is skipped rather than
 * throwing (defensive parsing, matching the rest of this module family).
 */
export function parseGitLog(raw: string): Commit[] {
  const commits: Commit[] = [];
  const blocks = raw.split(COMMIT_MARKER).filter((b) => b.trim() !== '');

  for (const block of blocks) {
    const lines = block.split('\n');
    const header = lines[0] ?? '';
    const [sha, date, ...subjectParts] = header.split(FIELD_SEP);
    if (!sha || !date) continue;
    const subject = subjectParts.join(FIELD_SEP).trim();

    const files: FileChange[] = [];
    for (const line of lines.slice(1)) {
      if (line.trim() === '') continue;
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const [addRaw, delRaw, ...pathParts] = parts;
      const path = pathParts.join('\t');
      // Binary files report `-\t-\t<path>` — not text churn, counted as 0.
      const additions = addRaw === '-' ? 0 : Number.parseInt(addRaw, 10) || 0;
      const deletions = delRaw === '-' ? 0 : Number.parseInt(delRaw, 10) || 0;
      files.push({ path, additions, deletions });
    }

    commits.push({
      sha,
      date,
      month: date.slice(0, 7),
      subject,
      kind: classifyCommitKind(subject),
      files,
    });
  }

  return commits;
}

export interface AreaChurn {
  fixLines: number;
  featLines: number;
  /** fixLines / featLines, or null when featLines is 0 (undefined ratio, not zero). */
  ratio: number | null;
}

export interface MonthStats {
  /** YYYY-MM */
  month: string;
  fixCount: number;
  featCount: number;
  otherCount: number;
  /** fixCount / featCount, or null when featCount is 0. */
  countRatio: number | null;
  churnByArea: Record<Area, AreaChurn>;
  /** Churn ratio across all areas combined. */
  overallChurn: AreaChurn;
}

function emptyAreaChurn(): AreaChurn {
  return { fixLines: 0, featLines: 0, ratio: null };
}

function ratioOf(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/**
 * Group commits by month and compute the count-based and area-split
 * churn-based fix:feat ratios for each. `other`-kind commits contribute to
 * `otherCount` only — they never enter a ratio.
 */
export function aggregateByMonth(commits: readonly Commit[]): MonthStats[] {
  const byMonth = new Map<string, Commit[]>();
  for (const c of commits) {
    const list = byMonth.get(c.month) ?? [];
    list.push(c);
    byMonth.set(c.month, list);
  }

  const months = Array.from(byMonth.keys()).sort();

  return months.map((month) => {
    const monthCommits = byMonth.get(month) ?? [];
    let fixCount = 0;
    let featCount = 0;
    let otherCount = 0;
    const churnByArea: Record<Area, AreaChurn> = {
      product: emptyAreaChurn(),
      machinery: emptyAreaChurn(),
      sites: emptyAreaChurn(),
      other: emptyAreaChurn(),
    };
    const overallChurn = emptyAreaChurn();

    for (const c of monthCommits) {
      if (c.kind === 'other') {
        otherCount++;
        continue;
      }
      if (c.kind === 'fix') fixCount++;
      else featCount++;

      for (const f of c.files) {
        const area = classifyArea(f.path);
        const lines = f.additions + f.deletions;
        if (c.kind === 'fix') {
          churnByArea[area].fixLines += lines;
          overallChurn.fixLines += lines;
        } else {
          churnByArea[area].featLines += lines;
          overallChurn.featLines += lines;
        }
      }
    }

    for (const area of Object.keys(churnByArea) as Area[]) {
      const a = churnByArea[area];
      a.ratio = ratioOf(a.fixLines, a.featLines);
    }
    overallChurn.ratio = ratioOf(overallChurn.fixLines, overallChurn.featLines);

    return {
      month,
      fixCount,
      featCount,
      otherCount,
      countRatio: ratioOf(fixCount, featCount),
      churnByArea,
      overallChurn,
    };
  });
}

export interface TripwireConfig {
  /** Consecutive strictly-increasing months of count-ratio to flag. Default 3. */
  sustainedMonths: number;
  /** A single month's count-ratio at/above this alerts regardless of trend. Default 1.0. */
  countRatioCeiling: number;
}

export const DEFAULT_TRIPWIRE_CONFIG: TripwireConfig = {
  sustainedMonths: 3,
  countRatioCeiling: 1.0,
};

export interface TripwireAlert {
  month: string;
  reason: string;
}

/**
 * Evaluate month-over-month stats against the tripwire. Two independent
 * triggers, either of which appends an alert:
 *
 *  - **ceiling** — any single month's count-ratio at/above
 *    `config.countRatioCeiling` (as many or more fixes than feats).
 *  - **sustained rise** — `config.sustainedMonths` consecutive months with a
 *    strictly increasing count-ratio (the exact shape the #691 audit found:
 *    0.56 → 0.95 → 1.52). A month with a null ratio (no feats that month)
 *    breaks the window rather than counting as a rise.
 *
 * Months are assumed pre-sorted ascending by {@link aggregateByMonth}.
 */
export function evaluateTripwire(
  monthStats: readonly MonthStats[],
  config: TripwireConfig = DEFAULT_TRIPWIRE_CONFIG,
): TripwireAlert[] {
  const alerts: TripwireAlert[] = [];

  for (const m of monthStats) {
    if (m.countRatio !== null && m.countRatio >= config.countRatioCeiling) {
      alerts.push({
        month: m.month,
        reason: `fix:feat commit-count ratio ${m.countRatio.toFixed(2)} meets/exceeds ceiling ${config.countRatioCeiling.toFixed(2)}`,
      });
    }
  }

  const n = config.sustainedMonths;
  if (n >= 2) {
    for (let i = n - 1; i < monthStats.length; i++) {
      const window = monthStats.slice(i - n + 1, i + 1);
      if (window.some((m) => m.countRatio === null)) continue;
      const rising = window.every(
        (m, idx) => idx === 0 || m.countRatio! > window[idx - 1].countRatio!,
      );
      if (rising) {
        alerts.push({
          month: window[window.length - 1].month,
          reason: `fix:feat commit-count ratio rose for ${n} consecutive months (${window
            .map((m) => m.countRatio!.toFixed(2))
            .join(' → ')})`,
        });
      }
    }
  }

  return alerts;
}
