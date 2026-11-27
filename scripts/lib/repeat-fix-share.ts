/**
 * The repeat-fix share: the measurement DR-108's ratio tripwire reads (#2854 item 2).
 *
 * WHY IT EXISTS. A delegation (`.minspec/delegations.json`) suspends itself when the
 * repeat-fix share passes its tripwire (13% for DLG-001), and `evaluateDelegation` treats
 * an unknown share as "suspended". Without a producer the share is always unknown, so the
 * delegation could never activate. This is the producer.
 *
 * THE DEFINITION, so the number means one thing everywhere it is quoted:
 *
 *   - Window: the 60 days ending on `today` (UTC), by COMMITTER date, merges excluded.
 *   - A fix commit is one whose subject is a conventional `fix`: `fix:`, `fix!:`,
 *     `fix(scope):`. The same prefix the RCDD commit-msg gate keys on.
 *   - A fix is ATTRIBUTED when its scope cites an issue: `fix(#123): ...`.
 *   - A fix in the window is a REPEAT when its scope cites an issue that an EARLIER fix
 *     commit, at any time in history, already cited. Fixing the same issue twice is the
 *     shape DR-003 (RCDD) exists to drive down.
 *   - share = repeats / fixes in the window.
 *
 * Known bias, in the safe direction: a pull request that lands several `fix(#N)` commits
 * through a merge commit counts each one after the first as a repeat, so the share reads
 * HIGH, never low. An unattributed fix counts in the denominator but can never be a repeat,
 * which reads low; that is why the share is refused (unknown) when fewer than 80% of the
 * window's fixes are attributed.
 *
 * DR-108 quotes 6.7% (11 of 165) from a measurement whose method was not recorded. This
 * definition does not reproduce that figure exactly; it is the one the tripwire reads from
 * now on.
 *
 * FAIL CLOSED. Every way the number could be wrong yields `share: undefined`: git missing
 * or erroring, a shallow clone (history cut off makes earlier citations invisible, so
 * repeats read low), an unparseable date, no fix commits in the window, or attribution
 * below the floor.
 *
 * Offline: local git only. Lives in `scripts/`, not shipped (DR-086 §5).
 */
import { execFileSync } from 'child_process';

export const WINDOW_DAYS = 60;
export const MIN_ATTRIBUTION = 0.8;

export interface CommitLine {
  readonly sha: string;
  /** ISO-8601 committer date. */
  readonly date: string;
  readonly subject: string;
}

export interface RepeatFixMeasure {
  /** The share (0..1), or `undefined` when it cannot be trusted. */
  readonly share: number | undefined;
  readonly fixes: number;
  readonly repeats: number;
  readonly attributed: number;
  /** `YYYY-MM-DD`, inclusive. Empty when the window could not be computed. */
  readonly windowStart: string;
  readonly windowEnd: string;
  /** Why `share` is undefined. Absent when it is known. */
  readonly reason?: string;
}

const FIX_SUBJECT = /^fix(?:\(([^)]*)\))?!?:/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Issue ids a fix commit's scope cites, or `undefined` when it is not a fix commit. */
export function fixScopeIssues(subject: string): string[] | undefined {
  const m = subject.match(FIX_SUBJECT);
  if (!m) return undefined;
  return [...(m[1] ?? '').matchAll(/#(\d+)/g)].map((x) => x[1]);
}

/**
 * Pure. `history` is every non-merge commit reachable from the measured ref with a
 * committer date on or before the end of `today`, in any order.
 */
export function measureRepeatFixShare(history: readonly CommitLine[], today: string): RepeatFixMeasure {
  const unknown = (reason: string, partial: Partial<RepeatFixMeasure> = {}): RepeatFixMeasure => ({
    share: undefined,
    fixes: 0,
    repeats: 0,
    attributed: 0,
    windowStart: '',
    windowEnd: '',
    ...partial,
    reason,
  });

  if (!ISO_DATE.test(today) || Number.isNaN(Date.parse(`${today}T00:00:00Z`))) {
    return unknown(`unreadable date "${today}"`);
  }
  const endMs = Date.parse(`${today}T23:59:59.999Z`);
  const startMs = Date.parse(`${today}T00:00:00Z`) - (WINDOW_DAYS - 1) * 86_400_000;
  const windowStart = new Date(startMs).toISOString().slice(0, 10);
  const span = { windowStart, windowEnd: today };

  const dated: { ms: number; c: CommitLine }[] = [];
  for (const c of history) {
    const ms = Date.parse(c.date);
    if (Number.isNaN(ms)) return unknown(`unreadable committer date "${c.date}" on ${c.sha}`, span);
    if (ms <= endMs) dated.push({ ms, c });
  }
  // Oldest first, sha as a stable tie-break, so "earlier" is well defined.
  dated.sort((a, b) => a.ms - b.ms || a.c.sha.localeCompare(b.c.sha));

  const seen = new Set<string>();
  let fixes = 0;
  let repeats = 0;
  let attributed = 0;
  for (const { ms, c } of dated) {
    const ids = fixScopeIssues(c.subject);
    if (ids === undefined) continue;
    if (ms >= startMs) {
      fixes++;
      if (ids.length > 0) attributed++;
      if (ids.some((id) => seen.has(id))) repeats++;
    }
    for (const id of ids) seen.add(id);
  }

  const counts = { fixes, repeats, attributed, ...span };
  if (fixes === 0) return unknown('no fix commits in the window, so there is no ratio to read', counts);
  if (attributed / fixes < MIN_ATTRIBUTION) {
    return unknown(
      `only ${attributed} of ${fixes} fix commits cite an issue (below ${MIN_ATTRIBUTION * 100}%), so repeats cannot be seen`,
      counts,
    );
  }
  return { share: repeats / fixes, ...counts };
}

export type GitRunner = (args: readonly string[]) => string;

const defaultGit =
  (repoRoot: string): GitRunner =>
  (args) =>
    execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 });

/** Today as `YYYY-MM-DD`, UTC. */
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Measure from git. `ref` is the history to measure, e.g. the merge base's ref in CI.
 * Never throws: any git failure is an unknown share.
 */
export function readRepeatFixShare(
  repoRoot: string,
  ref: string,
  today: string = utcToday(),
  git: GitRunner = defaultGit(repoRoot),
): RepeatFixMeasure {
  const unknown = (reason: string): RepeatFixMeasure => ({
    share: undefined,
    fixes: 0,
    repeats: 0,
    attributed: 0,
    windowStart: '',
    windowEnd: '',
    reason,
  });
  let text: string;
  try {
    if (git(['rev-parse', '--is-shallow-repository']).trim() !== 'false') {
      return unknown('the clone is shallow, so earlier fixes are invisible and repeats would read low');
    }
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    text = git(['log', '--no-merges', '--format=%H%x09%cI%x09%s', ref]);
  } catch (err) {
    return unknown(`git could not read the history of ${ref}: ${String(err).split('\n')[0]}`);
  }
  const history: CommitLine[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const [sha, date, ...rest] = line.split('\t');
    if (!sha || !date) return unknown(`unparseable git log line: ${line.slice(0, 80)}`);
    history.push({ sha, date, subject: rest.join('\t') });
  }
  return measureRepeatFixShare(history, today);
}

// CLI: `npx tsx scripts/lib/repeat-fix-share.ts [--repo-root <dir>] [--ref <ref>] [--today YYYY-MM-DD]`
// Prints one JSON line. Exit 0 when the share is known, 1 when it is not.
if (/(^|[\\/])repeat-fix-share\.ts$/.test(process.argv[1] ?? '')) {
  const argv = process.argv.slice(2);
  const opt = (k: string): string | undefined => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const m = readRepeatFixShare(opt('--repo-root') ?? process.cwd(), opt('--ref') ?? 'HEAD', opt('--today') ?? utcToday());
  console.log(JSON.stringify(m));
  process.exit(m.share === undefined ? 1 : 0);
}
