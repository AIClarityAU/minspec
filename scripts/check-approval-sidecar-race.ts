#!/usr/bin/env -S npx tsx
/**
 * check-approval-sidecar-race.ts — pre-commit write-side gate for the
 * approve-then-edit race (#424). Decision logic: scripts/lib/approval-sidecar-race.ts.
 *
 * Reads the STAGED index (not the working tree), so an unstaged edit cannot mask or
 * trigger it. Exit 0 = clean; exit 1 = refusal OR could not establish cleanliness
 * (fails closed, constitution invariant 2). Offline, no network (invariant 1).
 *
 * #3831: a `sidecar-not-restaged` on a SPEC that a live delegation covers is a warning,
 * not a refusal (the bot re-approves after the content merges). "Covered" is the same
 * `evaluateDelegation` pre-check the delegated caller runs, with every witness read from
 * the COMMITTED tree (HEAD), so a commit cannot grant itself coverage by staging a record.
 * Any witness missing or unreadable is "not covered", and the commit is refused as before.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { specHash } from '../packages/shared/src/canonical';
import {
  APPROVALS_PREFIX,
  applyDelegationCoverage,
  checkApprovables,
  sidecarPathFor,
  type RaceCoverage,
  type StagedApprovable,
} from './lib/approval-sidecar-race';
import { actForPath, frontmatterField } from './lib/approval-actor';
import { BOT_ACTOR, evaluateDelegation, parseDelegations, type Delegation, type Tier } from './lib/autonomy';
import { readRepeatFixShare, utcToday } from './lib/repeat-fix-share';

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

const TIERS: readonly Tier[] = ['T1', 'T2', 'T3', 'T4'];

/** The witnesses every coverage question shares, read once from HEAD. A string = why not covered. */
interface CoverageContext {
  readonly repo: string;
  readonly delegations: Delegation[];
  readonly share: number | undefined;
  readonly today: string;
}

function readCoverageContext(): CoverageContext | string {
  const text = tryGit(['show', 'HEAD:.minspec/delegations.json']);
  if (text === null) return 'no committed .minspec/delegations.json at HEAD';
  const delegations = parseDelegations(text);
  if (delegations === undefined) return 'the committed .minspec/delegations.json is unreadable';
  const url = tryGit(['remote', 'get-url', 'origin'])?.trim() ?? '';
  const repo = url.match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/)?.[1];
  if (repo === undefined) return 'the repository is unknown (no GitHub origin remote)';
  const root = git(['rev-parse', '--show-toplevel']).trim();
  const today = utcToday();
  return { repo, delegations, share: readRepeatFixShare(root, 'HEAD', today).share, today };
}

function coverageFor(ctx: CoverageContext | string, specPath: string): RaceCoverage {
  if (typeof ctx === 'string') return { covered: false, detail: ctx };
  const act = actForPath(specPath);
  if (act !== 'spec-approval') return { covered: false, detail: 'only spec edits are covered' };
  // The tier is a witness like the rest: read from HEAD, so a commit cannot change a spec's
  // tier into scope and grant itself coverage. Absent at HEAD or unreadable => not covered.
  const headSpec = tryGit(['show', `HEAD:${specPath}`]);
  const tier = headSpec === null ? undefined : frontmatterField(headSpec, 'tier');
  if (tier === undefined || !TIERS.includes(tier as Tier)) {
    return { covered: false, detail: 'the committed (HEAD) spec declares no tier T1..T4' };
  }
  const decisionStatus = (id: string): string | undefined => {
    if (!/^DR-\d+$/.test(id)) return undefined;
    const t = tryGit(['show', `HEAD:docs/decisions/${id}.md`]);
    return t === null ? undefined : frontmatterField(t, 'status');
  };
  // The delegated caller's own pre-check shape: the bot records, a second AI will give the
  // verdict when it re-approves. This asks only "would a delegated re-approval be in scope?".
  const v = evaluateDelegation(ctx.delegations, decisionStatus, {
    repo: ctx.repo,
    act,
    tier: tier as Tier,
    actor: BOT_ACTOR,
    author: '(pre-check)',
    verdictBy: '(pre-check verdict)',
    repeatFixShare: ctx.share,
    today: ctx.today,
    paths: [specPath],
  });
  return { covered: v.covered, detail: v.detail };
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

  // Witnesses are read only when an approval is being voided, and only once.
  let ctx: CoverageContext | string | undefined;
  const { refusals, warnings } = applyDelegationCoverage(failures, (f) => {
    ctx ??= readCoverageContext();
    return coverageFor(ctx, f.path);
  });

  if (warnings.length > 0) {
    process.stderr.write(
      '⚠ approval race gate (#424, #3831) warning: this commit voids an approval a live delegation covers.\n' +
        '  The spec reads stale until the delegated re-approval lands; the freeze gate refuses code against it meanwhile.\n',
    );
    for (const f of warnings) process.stderr.write(`  [${f.check}] ${f.path}\n      ${f.detail}\n`);
  }
  if (refusals.length === 0) return 0;

  process.stderr.write('✖ approval race gate (#424): this commit leaves an approval not matching its file:\n');
  for (const f of refusals) process.stderr.write(`  [${f.check}] ${f.path}\n      ${f.detail}\n`);
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
