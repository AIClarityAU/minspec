/**
 * Commit-on-approve — T0 invariant tests for the Tier-0 `commitApproval` helper.
 *
 * The load-bearing invariants (never-wrong):
 *   1. Pathspec-safety — the commit contains ONLY the approval's own paths (the
 *      flipped doc + the possibly brand-new, untracked record), never another
 *      session's pre-staged file, and NEVER a foreign sibling matched by a git
 *      glob metachar in the path (GIT_LITERAL_PATHSPECS).
 *   2. Never a false 'committed' — detached HEAD is refused, not silently orphaned.
 *   3. No stranded staging — a failed commit unstages its paths from the shared index.
 * These run real `git` in a temp repo.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { commitApproval, isUntrackedAtHead } from '../src/lib/approve-commit';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-commit-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function git(args: string[], cwd = tmp): string {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
}

function initRepo(dir: string): void {
  git(['init', '-b', 'main'], dir);
  git(['config', 'user.email', 'test@minspec.test'], dir);
  git(['config', 'user.name', 'MinSpec Test'], dir);
  // core.hooksPath → an empty dir so a real repo's approval commit never trips a
  // scaffolded gate during the test.
  const hooks = path.join(dir, '.nohooks');
  fs.mkdirSync(hooks, { recursive: true });
  git(['config', 'core.hooksPath', hooks], dir);
}

/** Write `content` to `rel` under tmp, mkdir -p its parent, return the abs path. */
function write(rel: string, content: string): string {
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  return abs;
}

/** Files touched by the tip commit, repo-relative, sorted. */
function filesInHead(): string[] {
  return git(['show', '--name-only', '--pretty=format:', 'HEAD']).trim().split('\n').filter(Boolean).sort();
}

describe('commitApproval — pathspec-safe commit-on-approve', () => {
  it('commits the flipped doc AND a new untracked sidecar record together', async () => {
    initRepo(tmp);
    const doc = write('specs/minspec/SPEC-007-foo/requirements.md', 'body\n');
    git(['add', '-A']);
    git(['commit', '-m', 'init']);

    // Approval: doc mutated (status flip) + a NEW untracked record sidecar.
    fs.appendFileSync(doc, 'status: implementing\n');
    const rec = write('.minspec/approvals/specs/minspec/SPEC-007-foo/requirements.md.json', '{"a":1}\n');

    const res = await commitApproval(tmp, [doc, rec], 'chore(approve): SPEC-007 approved');

    expect(res.outcome).toBe('committed');
    expect(filesInHead()).toEqual([
      '.minspec/approvals/specs/minspec/SPEC-007-foo/requirements.md.json',
      'specs/minspec/SPEC-007-foo/requirements.md',
    ]);
    expect(git(['status', '--porcelain']).trim()).toBe(''); // clean tree
  });

  it('NEVER bundles another session\'s pre-staged file (the invariant)', async () => {
    initRepo(tmp);
    const doc = write('DR-001.md', 'status: proposed\n');
    git(['add', '-A']);
    git(['commit', '-m', 'init']);

    // Another concurrent session has pre-staged an UNRELATED file into the index.
    write('other.txt', 'other work\n');
    git(['add', '--', 'other.txt']);

    // Our approval mutates the doc and creates the record.
    fs.writeFileSync(doc, 'status: accepted\n');
    const rec = write('.minspec/approvals/DR-001.md.json', '{"ok":true}\n');

    const res = await commitApproval(tmp, [doc, rec], 'chore(accept): DR-001 accepted');

    expect(res.outcome).toBe('committed');
    // other.txt must NOT be in the commit …
    expect(filesInHead()).toEqual(['.minspec/approvals/DR-001.md.json', 'DR-001.md']);
    // … and must remain staged, uncommitted, for its owning session.
    expect(git(['status', '--porcelain']).trim()).toBe('A  other.txt');
  });

  it('NEVER matches a foreign sibling via a git glob metachar in the path (literal pathspec)', async () => {
    // A POSIX-legal but glob-shaped directory: SPEC-[1] — the bracket is a git
    // pathspec char class that would otherwise match a sibling SPEC-1.
    initRepo(tmp);
    const doc = write('specs/SPEC-[1]/requirements.md', 'body\n');
    const sibling = write('specs/SPEC-1/requirements.md', 'sibling body\n');
    git(['add', '-A']);
    git(['commit', '-m', 'init']);

    // Approve the bracketed spec; a concurrent session edited the sibling.
    fs.appendFileSync(doc, 'status: implementing\n');
    fs.appendFileSync(sibling, 'CONCURRENT EDIT — must not be committed\n');

    const res = await commitApproval(tmp, [doc], 'chore(approve): bracketed');

    expect(res.outcome).toBe('committed');
    // ONLY the bracketed doc — the sibling must be neither committed nor staged.
    expect(filesInHead()).toEqual(['specs/SPEC-[1]/requirements.md']);
    expect(git(['diff', '--cached', '--name-only']).trim()).toBe(''); // nothing left staged
    // The sibling's concurrent edit survives untouched in the working tree.
    expect(git(['diff', '--name-only']).trim()).toBe('specs/SPEC-1/requirements.md');
  });

  it('refuses to commit in detached HEAD (never a false "committed")', async () => {
    initRepo(tmp);
    const doc = write('requirements.md', 'body\n');
    git(['add', '-A']);
    git(['commit', '-m', 'init']);
    // Detach HEAD onto the initial commit SHA.
    const sha = git(['rev-parse', 'HEAD']).trim();
    git(['checkout', '--detach', sha]);
    fs.appendFileSync(doc, 'status: implementing\n');

    const res = await commitApproval(tmp, [doc], 'chore(approve): detached');

    expect(res.outcome).toBe('detached-head');
    // Nothing committed, and the change is not left staged in the shared index.
    expect(git(['diff', '--cached', '--name-only']).trim()).toBe('');
  });

  it('drops non-existent paths and still commits the ones that exist', async () => {
    initRepo(tmp);
    write('EPIC-001.md', 'status: proposed\n');
    git(['add', '-A']);
    git(['commit', '-m', 'init']);
    const doc = path.join(tmp, 'EPIC-001.md');
    fs.writeFileSync(doc, 'status: active\n');
    const missingIndex = path.join(tmp, 'INDEX.md'); // never created (best-effort regen skipped)

    const res = await commitApproval(tmp, [doc, missingIndex], 'chore(accept): EPIC-001 activated');

    expect(res.outcome).toBe('committed');
    expect(res.paths).toEqual(['EPIC-001.md']);
  });

  it('returns nothing-to-commit (and leaves index clean) when the approval changed nothing', async () => {
    initRepo(tmp);
    const doc = write('requirements.md', 'body\n');
    git(['add', '-A']);
    git(['commit', '-m', 'init']);
    // doc is identical to HEAD — re-approving must not create an empty commit.
    const res = await commitApproval(tmp, [doc], 'chore(approve): noop');
    expect(res.outcome).toBe('nothing-to-commit');
    expect(git(['diff', '--cached', '--name-only']).trim()).toBe(''); // not left staged
  });

  it('returns nothing-to-commit when no path exists', async () => {
    initRepo(tmp);
    write('seed', 'x');
    git(['add', '-A']);
    git(['commit', '-m', 'init']);
    const res = await commitApproval(tmp, [path.join(tmp, 'ghost.md')], 'chore(approve): ghost');
    expect(res.outcome).toBe('nothing-to-commit');
  });

  it('returns not-a-repo (never rejects) outside a git work tree', async () => {
    const doc = write('requirements.md', 'body\n'); // tmp is NOT a git repo here
    const res = await commitApproval(tmp, [doc], 'chore(approve): x');
    expect(res.outcome).toBe('not-a-repo');
  });

  it('degrades to failed AND unstages when git rejects the commit', async () => {
    initRepo(tmp);
    const doc = write('requirements.md', 'body\n');
    git(['add', '-A']);
    git(['commit', '-m', 'init']);
    fs.appendFileSync(doc, 'changed\n');

    // Injected runner: pass the guards/stage/diff/reset, throw only on 'commit' —
    // mimics a pre-commit hook rejecting the approval commit. stderr carried on err.
    const stub = (args: readonly string[]): string => {
      if (args[0] === 'commit') {
        const e = new Error('Command failed') as Error & { stderr: string };
        e.stderr = 'hook rejected: root cause missing';
        throw e;
      }
      return git([...args]);
    };
    const res = await commitApproval(tmp, [doc], 'chore(approve): x', stub);
    expect(res.outcome).toBe('failed');
    expect(res.error).toContain('hook rejected');
    // Invariant 3: the change must NOT be left staged for another session to sweep.
    expect(git(['diff', '--cached', '--name-only']).trim()).toBe('');
  });
});

describe('isUntrackedAtHead — detects a create that was never committed (#577)', () => {
  it('is true for a brand-new file with no HEAD version', async () => {
    initRepo(tmp);
    write('seed.md', 'x\n');
    git(['add', '-A']);
    git(['commit', '-m', 'init']);
    const drPath = write('docs/decisions/DR-001.md', '---\nstatus: proposed\n---\n');

    expect(await isUntrackedAtHead(tmp, drPath)).toBe(true);
  });

  it('is false once the file has been committed', async () => {
    initRepo(tmp);
    const drPath = write('docs/decisions/DR-001.md', '---\nstatus: proposed\n---\n');
    git(['add', '-A']);
    git(['commit', '-m', 'init']);

    expect(await isUntrackedAtHead(tmp, drPath)).toBe(false);
  });

  it('stays false across an in-place edit that has not been re-committed', async () => {
    initRepo(tmp);
    const drPath = write('docs/decisions/DR-001.md', '---\nstatus: proposed\n---\n');
    git(['add', '-A']);
    git(['commit', '-m', 'init']);
    fs.writeFileSync(drPath, '---\nstatus: accepted\n---\n');

    // The file HAS a HEAD version — this is a Modify, not the #577 scenario.
    expect(await isUntrackedAtHead(tmp, drPath)).toBe(false);
  });

  it('is true when there is no HEAD commit at all (unborn branch)', async () => {
    initRepo(tmp); // no commits made
    const drPath = write('docs/decisions/DR-001.md', '---\nstatus: proposed\n---\n');

    expect(await isUntrackedAtHead(tmp, drPath)).toBe(true);
  });
});
