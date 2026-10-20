/**
 * Which pull request last changed an artifact's CONTENT, read offline from git (#2854).
 *
 * A delegated approval record cites the AI review comment it rests on (`verdictBy`).
 * `scripts/approval-integrity.ts` cannot reach GitHub, so it cannot fetch that comment;
 * what it can check offline is that the comment is on the RIGHT pull request: the one
 * that last changed the artifact's canonical content on the base. A hand-written record
 * citing a pass comment from some other pull request is refused.
 *
 * "Content" means the canonical hash (`specHash`), so a `status:`/`phases:` flip, which
 * is what an approval pull request itself makes, is skipped and never mistaken for the
 * content change.
 *
 * The pull request number is read from the first-parent commit's subject: a squash merge
 * ends `(#N)`, a merge commit starts `Merge pull request #N`. Anything else (a direct push,
 * an unrecognised subject, a git failure, no history) is `undefined`, and an unknown
 * content pull request denies a delegated record.
 */
import { execFileSync } from 'child_process';

import { specHash } from '../../packages/shared/src/canonical';

export type Git = (args: readonly string[]) => string;

const defaultGit =
  (repoRoot: string): Git =>
  (args) =>
    execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });

/** The pull request a first-parent commit subject names, or undefined. */
export function prFromSubject(subject: string): number | undefined {
  const m = subject.match(/^Merge pull request #(\d+) /) ?? subject.match(/\(#(\d+)\)\s*$/);
  return m ? Number(m[1]) : undefined;
}

const MAX_COMMITS = 500;

export function readContentPullRequest(
  repoRoot: string,
  ref: string,
  relPath: string,
  git: Git = defaultGit(repoRoot),
): number | undefined {
  const show = (rev: string): string | null => {
    try {
      return git(['show', `${rev}:${relPath}`]);
    } catch {
      return null;
    }
  };
  let log: string;
  try {
    log = git(['log', '--first-parent', `--max-count=${MAX_COMMITS}`, '--format=%H%x09%s', ref, '--', relPath]);
  } catch {
    return undefined;
  }
  for (const line of log.split('\n')) {
    if (line.trim() === '') continue;
    const tab = line.indexOf('\t');
    if (tab < 0) return undefined;
    const sha = line.slice(0, tab);
    const subject = line.slice(tab + 1);
    const now = show(sha);
    const before = show(`${sha}^1`);
    const changed = now === null || before === null || specHash(now) !== specHash(before);
    if (changed) return prFromSubject(subject);
  }
  return undefined;
}
