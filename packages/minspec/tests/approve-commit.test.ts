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

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { commitApproval, isUntrackedAtHead } from '../src/lib/approve-commit';

// #1099 — this suite drives real `git` child processes per assertion (commitApproval
// itself, plus the `git()` test helper). Under container scheduling contention a
// single `git` invocation can queue past the 5s default testTimeout even though
// nothing hung, and which suite trips it is non-deterministic run-to-run (#1099).
// Raised HERE, per-file, not globally — a genuinely hung test elsewhere still fails
// fast at the default. 30s is the value #1099 measured all affected suites passing
// reliably at.
vi.setConfig({ testTimeout: 30_000 });
afterAll(() => {
  vi.resetConfig();
});

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

  it('commits a brand-new sidecar even when the user set status.showUntrackedFiles=no', async () => {
    // Pins `--untracked-files=all` on the net-change probe. That flag is NOT
    // about untracked directories — given an explicit pathspec even the default
    // `normal` mode lists an untracked file. It defends against the USER'S git
    // config: with `status.showUntrackedFiles=no` the probe would come back
    // EMPTY for a brand-new sidecar, answer 'nothing-to-commit', and the
    // approval would silently never be committed — re-entering the #1064
    // silent-loss class through a setting MinSpec does not control.
    initRepo(tmp);
    write('specs/minspec/SPEC-008-bar/requirements.md', 'body\n');
    git(['add', '-A']);
    git(['commit', '-m', 'init']);
    git(['config', 'status.showUntrackedFiles', 'no']);

    // ONLY a new untracked sidecar — nothing tracked was modified, so the probe
    // is the sole thing standing between this approval and a silent no-op.
    const rec = write('.minspec/approvals/specs/minspec/SPEC-008-bar/requirements.md.json', '{"a":1}\n');

    const res = await commitApproval(tmp, [rec], 'chore(approve): SPEC-008 approved');

    expect(res.outcome).toBe('committed');
    expect(filesInHead()).toEqual([
      '.minspec/approvals/specs/minspec/SPEC-008-bar/requirements.md.json',
    ]);
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

/**
 * T3 regression — #1064 / #1022 / #874: the stranding family.
 *
 * Since #1041 the scaffolded pre-commit hook REFUSES a commit on the
 * push-protected default branch, because such a commit can never be pushed.
 * Accept ADR / Alt+A approve then wrote their files, hit the refusal, and left
 * the tree dirty with NO signal — the maintainer believed the DR was ratified
 * when it was not (reproduced live accepting DR-071, 2026-07-29).
 *
 * The fix resolves the DESTINATION before writing anything: on the default
 * branch `commitApproval` must refuse up front with a typed
 * `protected-branch` outcome, stage nothing, and commit nothing — leaving the
 * command layer to offer a branch. Failing open (unknown default) preserves
 * today's behaviour.
 */
describe('#1064 — destination guard on the default branch', () => {
  function setDefaultBranch(dir: string, branch: string): void {
    // origin/HEAD is a LOCAL ref, so this stays offline (Tier-0).
    git(['remote', 'add', 'origin', dir], dir);
    git(['update-ref', `refs/remotes/origin/${branch}`, 'HEAD'], dir);
    git(['symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${branch}`], dir);
  }

  it('refuses on the default branch, staging nothing and committing nothing', async () => {
    initRepo(tmp);
    const seed = path.join(tmp, 'seed.md');
    fs.writeFileSync(seed, 'seed\n');
    git(['add', '.'], tmp);
    git(['commit', '-m', 'seed'], tmp);
    setDefaultBranch(tmp, 'main');

    const doc = path.join(tmp, 'decision.md');
    fs.writeFileSync(doc, 'status: accepted\n');
    const before = git(['rev-parse', 'HEAD'], tmp).trim();

    const res = await commitApproval(tmp, [doc], 'chore(accept): DR-071');

    expect(res.outcome).toBe('protected-branch');
    expect(res.branch).toEqual({ current: 'main', default: 'main' });
    // no commit
    expect(git(['rev-parse', 'HEAD'], tmp).trim()).toBe(before);
    // invariant 3 — nothing left staged in the shared index
    expect(git(['diff', '--cached', '--name-only'], tmp).trim()).toBe('');
  });

  it('commits normally on a feature branch (unchanged behaviour)', async () => {
    initRepo(tmp);
    fs.writeFileSync(path.join(tmp, 'seed.md'), 'seed\n');
    git(['add', '.'], tmp);
    git(['commit', '-m', 'seed'], tmp);
    setDefaultBranch(tmp, 'main');
    git(['switch', '-c', 'feat/x'], tmp);

    const doc = path.join(tmp, 'decision.md');
    fs.writeFileSync(doc, 'status: accepted\n');

    const res = await commitApproval(tmp, [doc], 'chore(accept): DR-071');
    expect(res.outcome).toBe('committed');
  });

  it('fires via the hook FALLBACK when origin/HEAD is absent but a remote exists', async () => {
    // The case the first revision of this fix got wrong. The #1041 hook falls back
    // to main|master|trunk when origin/HEAD is missing, and its own comment says
    // that is the COMMON path ("absent in both repos this guard was written for").
    // A guard that failed open here would be inert exactly where the hook fires.
    initRepo(tmp);
    fs.writeFileSync(path.join(tmp, 'seed.md'), 'seed\n');
    git(['add', '.'], tmp);
    git(['commit', '-m', 'seed'], tmp);
    git(['remote', 'add', 'origin', 'https://example.invalid/repo.git'], tmp);
    // deliberately NO origin/HEAD ref

    const doc = path.join(tmp, 'decision.md');
    fs.writeFileSync(doc, 'status: accepted\n');
    const before = git(['rev-parse', 'HEAD'], tmp).trim();

    const res = await commitApproval(tmp, [doc], 'chore(accept): DR-071');

    expect(res.outcome).toBe('protected-branch');
    expect(res.branch).toEqual({ current: 'main', default: 'main' });
    expect(git(['rev-parse', 'HEAD'], tmp).trim()).toBe(before);
    expect(git(['diff', '--cached', '--name-only'], tmp).trim()).toBe('');
  });

  it('fails OPEN with no remote at all (nothing to push to, so nothing protected)', async () => {
    initRepo(tmp);
    fs.writeFileSync(path.join(tmp, 'seed.md'), 'seed\n');
    git(['add', '.'], tmp);
    git(['commit', '-m', 'seed'], tmp);
    // no origin/HEAD AND no remote — mirrors the hook, which does not guard here

    const doc = path.join(tmp, 'decision.md');
    fs.writeFileSync(doc, 'status: accepted\n');

    const res = await commitApproval(tmp, [doc], 'chore(accept): DR-071');
    expect(res.outcome).toBe('committed');
  });

  it('never moves the checkout: HEAD is on the same branch after a refusal', async () => {
    initRepo(tmp);
    fs.writeFileSync(path.join(tmp, 'seed.md'), 'seed\n');
    git(['add', '.'], tmp);
    git(['commit', '-m', 'seed'], tmp);
    setDefaultBranch(tmp, 'main');

    const doc = path.join(tmp, 'decision.md');
    fs.writeFileSync(doc, 'status: accepted\n');
    await commitApproval(tmp, [doc], 'chore(accept): DR-071');

    // rule #8 / DR-051 §4a — the shared checkout's HEAD is never moved.
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], tmp).trim()).toBe('main');
    expect(git(['branch', '--list'], tmp).trim()).toBe('* main');
  });
});

/**
 * #1112 — approve mid-merge/cherry-pick cannot commit, because git itself
 * refuses a PARTIAL (pathspec) commit while MERGE_HEAD or CHERRY_PICK_HEAD
 * exists: `fatal: cannot do a partial commit during a merge/cherry-pick`.
 * commit-on-approve is pathspec-only (invariant 1), so a bare commit is not an
 * available workaround — this is a genuine git constraint, not a guard bug.
 * The fix detects it UP FRONT (before any `git add`) and returns the distinct
 * `'merge-in-progress'` outcome instead of degrading to an unhelpful
 * `'failed'`. REVERT_HEAD is deliberately excluded: git allows a partial
 * commit mid-revert.
 */
describe('#1112 — mid-merge/cherry-pick guard (partial commit refusal)', () => {
  /** Stamp a git-dir marker so the repo LOOKS mid-operation (no real merge needed
   *  — commitApproval only checks for the marker file's existence). */
  function markInProgress(dir: string, marker: string): void {
    const head = git(['rev-parse', 'HEAD'], dir).trim();
    fs.writeFileSync(path.join(dir, '.git', marker), `${head}\n`);
  }

  it('MERGE_HEAD present: refuses up front with merge-in-progress, staging nothing', async () => {
    initRepo(tmp);
    const doc = write('requirements.md', 'body\n');
    git(['add', '-A']);
    git(['commit', '-m', 'init']);
    const before = git(['rev-parse', 'HEAD']).trim();
    fs.appendFileSync(doc, 'changed\n');
    markInProgress(tmp, 'MERGE_HEAD');

    const res = await commitApproval(tmp, [doc], 'chore(approve): x');

    expect(res.outcome).toBe('merge-in-progress');
    expect(res.operation).toBe('merge');
    // no commit made, nothing staged — the approval stays on disk, uncommitted
    expect(git(['rev-parse', 'HEAD']).trim()).toBe(before);
    expect(git(['diff', '--cached', '--name-only']).trim()).toBe('');
    expect(fs.readFileSync(doc, 'utf-8')).toContain('changed');
  });

  it('CHERRY_PICK_HEAD present: refuses with operation "cherry-pick"', async () => {
    initRepo(tmp);
    const doc = write('requirements.md', 'body\n');
    git(['add', '-A']);
    git(['commit', '-m', 'init']);
    fs.appendFileSync(doc, 'changed\n');
    markInProgress(tmp, 'CHERRY_PICK_HEAD');

    const res = await commitApproval(tmp, [doc], 'chore(approve): x');

    expect(res.outcome).toBe('merge-in-progress');
    expect(res.operation).toBe('cherry-pick');
    expect(git(['diff', '--cached', '--name-only']).trim()).toBe('');
  });

  it('REVERT_HEAD present: NOT refused — git allows a partial commit mid-revert', async () => {
    initRepo(tmp);
    const doc = write('requirements.md', 'body\n');
    git(['add', '-A']);
    git(['commit', '-m', 'init']);
    fs.appendFileSync(doc, 'changed\n');
    markInProgress(tmp, 'REVERT_HEAD');

    const res = await commitApproval(tmp, [doc], 'chore(approve): x');

    expect(res.outcome).toBe('committed');
  });

  it('a REAL merge in progress (git merge --no-commit --no-ff) is refused the same way', async () => {
    // Belt-and-braces: the tests above stamp the marker file directly (matching
    // what commitApproval actually reads); this one drives a genuine conflict-
    // free merge stopped before its own commit, to confirm MERGE_HEAD really is
    // present at that point and git really does refuse the partial commit this
    // module is working around (not just an assumption from the issue's table).
    initRepo(tmp);
    write('seed.md', 'seed\n');
    git(['add', '-A']);
    git(['commit', '-m', 'init']);
    git(['switch', '-q', '-c', 'feature']);
    write('feature.md', 'feature\n');
    git(['add', '-A']);
    git(['commit', '-m', 'feature']);
    git(['switch', '-q', 'main']);
    write('unrelated.md', 'unrelated\n');
    git(['add', '-A']);
    git(['commit', '-m', 'unrelated']);
    git(['merge', '--no-commit', '--no-ff', 'feature']);
    expect(fs.existsSync(path.join(tmp, '.git', 'MERGE_HEAD'))).toBe(true);

    const doc = write('requirements.md', 'approval\n');
    const res = await commitApproval(tmp, [doc], 'chore(approve): x');

    expect(res.outcome).toBe('merge-in-progress');
    expect(res.operation).toBe('merge');
    // MERGE_HEAD is still there — we never touched the merge itself.
    expect(fs.existsSync(path.join(tmp, '.git', 'MERGE_HEAD'))).toBe(true);
  });
});
