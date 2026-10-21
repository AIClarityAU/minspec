/**
 * T3 regression — #2974: an approval recovered off protected `main` left the primary
 * checkout dirty until its PR merged (recurred 2026-10-21 on MinSpecPro DR-102 and
 * memory-fabric DR-001: sidecar, DR file and docs/decisions/INDEX.md left behind after
 * the branch was pushed and the PR opened).
 *
 * Root cause: `recoverProtectedBranchApproval` copies the approval into a throwaway
 * worktree and never retires the originals, and nothing could retire them, because the
 * editor read approval state only from the working-tree sidecar and lifecycle status
 * only from the document's frontmatter — so the dirty copies were the only thing keeping
 * the panel honest.
 *
 * Everything here runs REAL git against a bare `origin`, so "the primary is clean" is
 * asserted on `git status --porcelain`, not on a recorded argv.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { recoverProtectedBranchApproval, settleRecoveredApproval } from '../src/lib/approval-recover';
import { getApprovalStatus, canonicalSpecHash } from '../src/lib/approval';
import { writeRecord, sidecarPath, readRecord } from '../src/lib/approval-store';
import { listAdrs, setAdrStatus } from '../src/lib/adr-manager';
import { listSpecs } from '../src/lib/spec-catalog';
import { inflightFile } from '../src/lib/approval-inflight';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: cwd },
  }).toString();
}

const DR_REL = 'docs/decisions/DR-001-pick-a-thing.md';
const INDEX_REL = 'docs/decisions/INDEX.md';
const SPEC_REL = 'specs/demo/SPEC-001-demo/requirements.md';

const DR_TEXT = [
  '---',
  'id: DR-001',
  'title: Pick a thing',
  'status: proposed',
  'date: 2026-10-01',
  '---',
  '',
  '# DR-001: Pick a thing',
  '',
  '## Status',
  '',
  '**Proposed**, 2026-10-01',
  '',
  '## Decision',
  '',
  'We pick the thing.',
  '',
].join('\n');

function specText(status: string, specify: string, plan: string, body = 'The demo shall work.'): string {
  return [
    '---',
    'id: SPEC-001',
    'title: Demo',
    'tier: T2',
    `status: ${status}`,
    'phases:',
    `  specify: ${specify}`,
    `  plan: ${plan}`,
    '---',
    '',
    '# SPEC-001: Demo',
    '',
    `**Status:** ${status.charAt(0).toUpperCase() + status.slice(1)}`,
    '',
    '## Requirements',
    '',
    body,
    '',
  ].join('\n');
}

let tmp: string;
let origin: string;
let root: string;

function porcelain(): string {
  return git(root, 'status', '--porcelain', '--untracked-files=all').trim();
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'inflight-2974-')));
  origin = path.join(tmp, 'origin.git');
  root = path.join(tmp, 'primary');
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, root);
  git(root, 'config', 'user.email', 'founder@example.com');
  git(root, 'config', 'user.name', 'Founder');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'config', 'core.hooksPath', '/dev/null');
  fs.mkdirSync(path.join(root, '.minspec'), { recursive: true });
  fs.writeFileSync(path.join(root, '.minspec', 'config.json'), '{}\n');
  fs.mkdirSync(path.join(root, 'docs/decisions'), { recursive: true });
  fs.writeFileSync(path.join(root, DR_REL), DR_TEXT);
  fs.writeFileSync(path.join(root, INDEX_REL), '# Decisions\n\n| DR-001 | Pick a thing | proposed |\n');
  fs.mkdirSync(path.dirname(path.join(root, SPEC_REL)), { recursive: true });
  fs.writeFileSync(path.join(root, SPEC_REL), specText('specifying', 'in-progress', 'pending'));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  git(root, 'push', '-q', '-u', 'origin', 'main');
});

/** Accept DR-001 the way `applyStatus` does: flip status, write the sidecar, edit INDEX. */
function acceptDr(): string[] {
  const dr = path.join(root, DR_REL);
  setAdrStatus(dr, 'accepted');
  writeRecord(root, {
    specPath: DR_REL,
    specHash: canonicalSpecHash(dr)!,
    approvedAt: '2026-10-21T06:39:00.000Z',
    approvedBy: 'founder@example.com',
    tier: 'T2',
    migrated: false,
    baselineBlob: '',
  });
  fs.writeFileSync(path.join(root, INDEX_REL), '# Decisions\n\n| DR-001 | Pick a thing | accepted |\n');
  return [dr, path.join(root, INDEX_REL), sidecarPath(root, DR_REL)];
}

/** Approve SPEC-001 the way `approve.ts` does: advance lifecycle, then record the hash. */
function approveSpecDoc(body?: string): string[] {
  const spec = path.join(root, SPEC_REL);
  fs.writeFileSync(spec, specText('planning', 'done', 'in-progress', body));
  writeRecord(root, {
    specPath: SPEC_REL,
    specHash: canonicalSpecHash(spec)!,
    approvedAt: '2026-10-21T06:37:00.000Z',
    approvedBy: 'founder@example.com',
    tier: 'T2',
    migrated: false,
    baselineBlob: '',
  });
  return [spec, sidecarPath(root, SPEC_REL)];
}

async function recoverAndSettle(absPaths: string[], slug: string) {
  const res = await recoverProtectedBranchApproval(root, absPaths, `chore(accept): ${slug}`, {
    slug,
    baseBranch: 'main',
  });
  expect(res.outcome).toBe('recovered');
  const settled = await settleRecoveredApproval(root, res, { baseBranch: 'main' });
  return { res, settled };
}

function drStatus(): string | undefined {
  return listAdrs(root).find((a) => a.id === 'DR-001')?.status;
}

function specSummary() {
  return listSpecs(root).find((s) => s.id === 'SPEC-001');
}

describe('#2974 — a recovered approval leaves the primary clean and the panel approved', () => {
  it('DR accept: zero dirty paths, yet the DR still reads accepted and approved', async () => {
    const paths = acceptDr();
    expect(porcelain()).not.toBe('');
    const { settled } = await recoverAndSettle(paths, 'DR-001');

    expect(porcelain()).toBe('');
    expect(settled.kept).toEqual([]);
    expect(getApprovalStatus(root, path.join(root, DR_REL))).toBe('approved');
    expect(drStatus()).toBe('accepted');
    // The restored document really is main's copy — the overlay is what reads accepted.
    expect(fs.readFileSync(path.join(root, DR_REL), 'utf-8')).toBe(DR_TEXT);
  });

  it('spec approve: zero dirty paths, yet the spec still reads approved with its pushed lifecycle', async () => {
    const paths = approveSpecDoc();
    await recoverAndSettle(paths, 'SPEC-001');

    expect(porcelain()).toBe('');
    expect(getApprovalStatus(root, path.join(root, SPEC_REL))).toBe('approved');
    const s = specSummary();
    expect(s?.status).toBe('planning');
    expect(s?.currentPhase).toBe('plan');
  });

  it('the in-flight record lives in the git directory, never in the working tree', async () => {
    await recoverAndSettle(acceptDr(), 'DR-001');
    const file = inflightFile(root, DR_REL)!;
    expect(path.dirname(file)).toBe(path.join(root, '.git'));
    expect(fs.existsSync(file)).toBe(true);
  });

  it('a linked worktree keeps its OWN record (per-worktree git dir, not the common one)', () => {
    const wt = path.join(tmp, 'linked');
    git(root, 'worktree', 'add', '-q', '-b', 'side', wt);
    const file = inflightFile(wt, DR_REL)!;
    expect(path.dirname(file)).toBe(path.join(root, '.git', 'worktrees', 'linked'));
    expect(file).not.toBe(inflightFile(root, DR_REL));
  });

  it('merge: once main carries the approval and the primary has it, the record is cleared', async () => {
    const { res } = await recoverAndSettle(acceptDr(), 'DR-001');
    // The PR merges (fast-forward of main to the approval commit), the branch is
    // deleted, and the primary pulls.
    git(root, 'push', '-q', 'origin', `${res.sha}:refs/heads/main`);
    git(root, 'push', '-q', 'origin', '--delete', res.branch!);
    git(root, 'fetch', '-q', '--prune', 'origin');

    // Merged but not yet pulled: still accepted (main carries it), still clean.
    expect(drStatus()).toBe('accepted');
    expect(getApprovalStatus(root, path.join(root, DR_REL))).toBe('approved');

    git(root, 'merge', '-q', '--ff-only', 'origin/main');
    expect(porcelain()).toBe('');
    expect(getApprovalStatus(root, path.join(root, DR_REL))).toBe('approved');
    expect(drStatus()).toBe('accepted');
    expect(fs.existsSync(inflightFile(root, DR_REL)!)).toBe(false);
  });

  it('closed unmerged: once the branch is gone and main never got it, the overlay stops', async () => {
    const { res } = await recoverAndSettle(acceptDr(), 'DR-001');
    git(root, 'push', '-q', 'origin', '--delete', res.branch!);
    git(root, 'fetch', '-q', '--prune', 'origin');

    expect(drStatus()).toBe('proposed');
    expect(getApprovalStatus(root, path.join(root, DR_REL))).toBe('unapproved');
    expect(readRecord(root, DR_REL)).toBeUndefined();
    // Kept, not deleted: with the branch gone it may be the only copy of the approval.
    expect(fs.existsSync(inflightFile(root, DR_REL)!)).toBe(true);
  });

  it('a later founder edit to the restored document ends its lifecycle overlay', async () => {
    await recoverAndSettle(acceptDr(), 'DR-001');
    fs.appendFileSync(path.join(root, DR_REL), '\nA new thought.\n');
    expect(drStatus()).toBe('proposed');
    expect(getApprovalStatus(root, path.join(root, DR_REL))).toBe('stale');
  });
});

describe('#2974 guard — founder work is never restored away', () => {
  it('a transported path edited after the push (working bytes != pushed blob) is NOT restored', async () => {
    const paths = acceptDr();
    const res = await recoverProtectedBranchApproval(root, paths, 'chore(accept): DR-001', {
      slug: 'DR-001',
      baseBranch: 'main',
    });
    expect(res.outcome).toBe('recovered');
    const edited = fs.readFileSync(path.join(root, DR_REL), 'utf-8') + '\nFounder note written after the push.\n';
    fs.writeFileSync(path.join(root, DR_REL), edited);

    const settled = await settleRecoveredApproval(root, res, { baseBranch: 'main' });
    expect(fs.readFileSync(path.join(root, DR_REL), 'utf-8')).toBe(edited);
    expect(settled.kept).toContain(DR_REL);
    expect(settled.restored).not.toContain(DR_REL);
  });

  it('a register INDEX edited after the push is NOT restored — only the byte guard stands between it and a restore', async () => {
    // INDEX.md has no lifecycle check, so this pins the pushed-blob comparison itself.
    const paths = acceptDr();
    const res = await recoverProtectedBranchApproval(root, paths, 'chore(accept): DR-001', {
      slug: 'DR-001',
      baseBranch: 'main',
    });
    const edited = fs.readFileSync(path.join(root, INDEX_REL), 'utf-8') + '| DR-002 | Founder draft | proposed |\n';
    fs.writeFileSync(path.join(root, INDEX_REL), edited);

    const settled = await settleRecoveredApproval(root, res, { baseBranch: 'main' });
    expect(fs.readFileSync(path.join(root, INDEX_REL), 'utf-8')).toBe(edited);
    expect(settled.kept).toEqual([INDEX_REL]);
    expect(settled.reasons[INDEX_REL]).toContain('pushed blob');
    // Everything proven was still settled.
    expect(settled.restored).toContain(DR_REL);
  });

  it('a sidecar whose bytes differ from the pushed blob aborts the whole settle — nothing touched', async () => {
    const paths = acceptDr();
    const res = await recoverProtectedBranchApproval(root, paths, 'chore(accept): DR-001', {
      slug: 'DR-001',
      baseBranch: 'main',
    });
    const side = sidecarPath(root, DR_REL);
    fs.appendFileSync(side, ' ');
    const before = porcelain();

    const settled = await settleRecoveredApproval(root, res, { baseBranch: 'main' });
    expect(settled.restored).toEqual([]);
    expect(settled.inflight).toBeUndefined();
    expect(porcelain()).toBe(before);
    expect(fs.existsSync(inflightFile(root, DR_REL)!)).toBe(false);
  });

  it('a document whose pushed body differs from main beyond lifecycle stays in place, still approved', async () => {
    // The founder edited the requirement AND approved, all uncommitted on main.
    // Restoring would show the OLD requirement in the editor until merge.
    const paths = approveSpecDoc('The demo shall work, and fast.');
    const { settled } = await recoverAndSettle(paths, 'SPEC-001');

    expect(settled.kept).toEqual([SPEC_REL]);
    expect(porcelain()).toBe(`M ${SPEC_REL}`);
    expect(fs.readFileSync(path.join(root, SPEC_REL), 'utf-8')).toContain('and fast');
    expect(getApprovalStatus(root, path.join(root, SPEC_REL))).toBe('approved');
    expect(specSummary()?.status).toBe('planning');
  });

  it('a recovery with no commit SHA settles nothing', async () => {
    const paths = acceptDr();
    const res = await recoverProtectedBranchApproval(root, paths, 'chore(accept): DR-001', {
      slug: 'DR-001',
      baseBranch: 'main',
    });
    const before = porcelain();
    const settled = await settleRecoveredApproval(root, { ...res, sha: undefined }, { baseBranch: 'main' });
    expect(settled.restored).toEqual([]);
    expect(porcelain()).toBe(before);
  });
});
