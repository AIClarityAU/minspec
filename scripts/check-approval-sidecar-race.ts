#!/usr/bin/env -S npx tsx
/**
 * check-approval-sidecar-race.ts — pre-commit write-side gate for the
 * approve-then-edit race (#424). Decision logic: scripts/lib/approval-sidecar-race.ts.
 *
 * Reads the STAGED index (not the working tree), so an unstaged edit cannot mask or
 * trigger it. Exit 0 = clean; exit 1 = refusal OR could not establish cleanliness
 * (fails closed, constitution invariant 2). Offline, no network (invariant 1).
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { specHash } from '../packages/shared/src/canonical';
import {
  APPROVALS_PREFIX,
  checkApprovables,
  sidecarPathFor,
  type StagedApprovable,
} from './lib/approval-sidecar-race';

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function tryGit(args: string[]): string | null {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function lines(out: string): string[] {
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

function main(): number {
  // No HEAD (initial commit) => no committed sidecar can exist; staged sidecars are still checked.
  const hasHead = tryGit(['rev-parse', '--verify', '-q', 'HEAD']) !== null;
  const stagedAcmr = lines(git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).replace(/\0/g, '\n'));
  const staged = new Set(stagedAcmr);
  // Staged deletions: a deleted sidecar is a deliberate "Revoke Approval", not a race.
  const stagedDeleted = new Set(lines(git(['diff', '--cached', '--name-only', '--diff-filter=D', '-z']).replace(/\0/g, '\n')));

  const gitDir = git(['rev-parse', '--git-dir']).trim();
  let mergeHead: string | null = null;
  const mergeFile = path.resolve(gitDir, 'MERGE_HEAD');
  if (fs.existsSync(mergeFile)) mergeHead = fs.readFileSync(mergeFile, 'utf-8').trim();

  const items: StagedApprovable[] = [];
  for (const p of stagedAcmr) {
    if (p.startsWith(APPROVALS_PREFIX)) continue;
    const sidecar = sidecarPathFor(p);
    const sidecarStaged = staged.has(sidecar);
    const headSidecarText = hasHead ? tryGit(['show', `HEAD:${sidecar}`]) : null;
    if (!sidecarStaged && headSidecarText === null) continue; // never approved

    const stagedBlob = git(['rev-parse', `:${p}`]).trim();
    // A merge brings in the other side's bytes; those were not authored here.
    if (mergeHead && tryGit(['rev-parse', `${mergeHead}:${p}`])?.trim() === stagedBlob) continue;

    items.push({
      path: p,
      stagedContent: git(['show', `:${p}`]),
      headSidecarText,
      sidecarStaged,
      stagedSidecarText: sidecarStaged ? git(['show', `:${sidecar}`]) : null,
      sidecarDeleted: stagedDeleted.has(sidecar),
    });
  }

  // A sidecar staged on its own (approvable not part of this commit) must still describe the
  // approvable as it will exist after the commit: the INDEX copy (== HEAD when unstaged),
  // never the working tree.
  for (const sc of stagedAcmr) {
    if (!sc.startsWith(APPROVALS_PREFIX) || !sc.endsWith('.json')) continue;
    const target = sc.slice(APPROVALS_PREFIX.length, -'.json'.length);
    if (staged.has(target)) continue; // handled above
    const indexContent = tryGit(['show', `:${target}`]);
    if (indexContent === null) continue; // no such approvable (e.g. non-spec sidecar)
    items.push({
      path: target,
      stagedContent: indexContent,
      headSidecarText: null,
      sidecarStaged: true,
      stagedSidecarText: git(['show', `:${sc}`]),
    });
  }

  const failures = checkApprovables(items, specHash);
  if (failures.length === 0) return 0;

  process.stderr.write('✖ approval race gate (#424): this commit leaves an approval not matching its file:\n');
  for (const f of failures) process.stderr.write(`  [${f.check}] ${f.path}\n      ${f.detail}\n`);
  process.stderr.write('  Override (rare): APPROVAL_RACE_GATE_OFF=1 git commit ...\n');
  return 1;
}

try {
  process.exit(main());
} catch (e) {
  process.stderr.write(`✖ approval race gate (#424): could not run — failing closed.\n  ${(e as Error).message}\n`);
  process.stderr.write('  Override: APPROVAL_RACE_GATE_OFF=1 git commit ...\n');
  process.exit(1);
}
