#!/usr/bin/env -S npx tsx
/**
 * check-worktree-salvage.ts — is a dirty worktree holding work that exists nowhere else? (#1259)
 *
 *   npx tsx scripts/check-worktree-salvage.ts <worktree-path>
 *
 * Exit 0 = NOTHING_UNIQUE (uncommitted state has zero insertions, no untracked authored files).
 * Exit 1 = SALVAGE (archive before removal, or surface as a human decision).
 * Exit 2 = the check could not run (not a git worktree, git failed). Never reads as safe.
 *
 * Orthogonal to the branch-level merged-PR and `git cherry` checks: this covers the
 * UNCOMMITTED dimension. Decision logic lives in lib/worktree-salvage.ts; this is IO only.
 */

import { execFileSync } from 'node:child_process';

import { classifyWorktree } from './lib/worktree-salvage';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function main(): number {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: check-worktree-salvage.ts <worktree-path>');
    return 2;
  }
  try {
    const result = classifyWorktree({
      stagedNumstat: git(dir, ['diff', '--cached', '--numstat']),
      unstagedNumstat: git(dir, ['diff', '--numstat']),
      untracked: git(dir, ['ls-files', '--others', '--exclude-standard']).split('\n'),
    });
    console.log(
      `${result.verdict}: +${result.insertions} -${result.deletions}` +
        (result.reasons.length ? ` — ${result.reasons.join('; ')}` : ''),
    );
    return result.verdict === 'SALVAGE' ? 1 : 0;
  } catch (e) {
    console.error(`check-worktree-salvage: could not read ${dir}: ${(e as Error).message}`);
    return 2;
  }
}

process.exit(main());
