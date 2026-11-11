/**
 * dr-index-scope.ts — confine an approval commit's INDEX.md diff to ONE decision (#2021).
 *
 * `regenerateDrIndex` rebuilds the whole register from every DR on disk, so a
 * regenerated INDEX carries every OTHER decision's uncommitted status change too.
 * Committing it under an approval pathspec shipped those rows in an unrelated
 * approval commit (DR-090's `accepted` row rode along with DR-091's acceptance
 * while DR-090.md still said `proposed`). This rewrites the on-disk INDEX to the
 * committed (HEAD) INDEX with only the accepted decision's entry spliced in.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { spliceDrIndexEntry } from './dr-index-splice';

/** The INDEX.md content committed at HEAD, or null (untracked, no HEAD, not a repo). */
function committedIndex(repoRoot: string, indexPath: string): string | null {
  try {
    const rel = path.relative(repoRoot, indexPath).split(path.sep).join('/');
    return execFileSync('git', ['show', `HEAD:${rel}`], {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/**
 * Rewrite `indexPath` so it differs from the committed INDEX only in `drId`'s entry.
 * Returns true when rewritten. Returns false — leaving the file untouched — when
 * there is no committed INDEX or no entry for the id (nothing to scope against;
 * for a brand-new register the whole file is legitimately this decision's).
 * Never throws.
 */
export function scopeIndexToDr(repoRoot: string, indexPath: string, drId: string): boolean {
  try {
    const base = committedIndex(repoRoot, indexPath);
    if (base === null) return false;
    const working = fs.readFileSync(indexPath, 'utf-8');
    const next = spliceDrIndexEntry(base, working, drId);
    if (next === null) return false;
    if (next !== working) fs.writeFileSync(indexPath, next, 'utf-8');
    return true;
  } catch {
    return false;
  }
}
