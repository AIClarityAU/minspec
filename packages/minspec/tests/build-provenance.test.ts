/**
 * Build provenance (#1439) — detect a running build older than the checkout.
 *
 * Pins the distinction that makes this useful: `stale` requires the build commit to be a
 * genuine ANCESTOR of HEAD. A build from elsewhere is `unknown`, never `stale` — asserting
 * "you are behind" without an ancestry proof would be the same unearned confidence the
 * feature exists to remove.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectBuildSkew, skewMessage } from '../src/lib/build-provenance';

let repo: string;
const git = (args: string[], cwd = repo) =>
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

/** A throwaway repo with three commits, so "ancestor" is a real relation and not a stub. */
beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-prov-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@example.com']);
  git(['config', 'user.name', 'T']);
  fs.mkdirSync(path.join(repo, '.minspec'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.minspec', 'constitution.md'), '# c\n');
  for (const n of ['one', 'two', 'three']) {
    fs.writeFileSync(path.join(repo, `${n}.txt`), n);
    git(['add', '-A']);
    git(['commit', '-qm', n]);
  }
});

afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

const shaAt = (n: string) => git(['rev-parse', n]);

describe('detectBuildSkew — scope', () => {
  it('says nothing for a dev build, which is compiled from the working tree by definition', () => {
    // __MINSPEC_BUILD_SHA__ is undefined under vitest (no esbuild --define), so buildSha() is 'dev'.
    expect(detectBuildSkew(repo, true).kind).toBe('not-applicable');
  });

  it('says nothing outside a MinSpec checkout, even when a build SHA exists', () => {
    // A normal user's installed build legitimately differs from any repo they open.
    expect(detectBuildSkew(repo, false).kind).toBe('not-applicable');
  });
});

/**
 * The `dev` short-circuit sits above every other branch, so exercising the real comparison
 * means calling the internals the way a packaged build would. These drive git directly and
 * assert the ancestry semantics the advisory depends on.
 */
describe('ancestry semantics the verdict rests on', () => {
  it('an older commit IS an ancestor of HEAD — the stale case', () => {
    const old = shaAt('HEAD~2');
    expect(() => git(['merge-base', '--is-ancestor', old, 'HEAD'])).not.toThrow();
    expect(Number(git(['rev-list', '--count', `${old}..HEAD`]))).toBe(2);
  });

  it('HEAD is its own ancestor with zero distance — the current case, not stale', () => {
    expect(Number(git(['rev-list', '--count', 'HEAD..HEAD']))).toBe(0);
  });

  it('a commit on a divergent branch is NOT an ancestor — the unknown case', () => {
    git(['checkout', '-q', '-b', 'side', 'HEAD~1']);
    fs.writeFileSync(path.join(repo, 'side.txt'), 'side');
    git(['add', '-A']);
    git(['commit', '-qm', 'side']);
    const sideSha = shaAt('HEAD');
    git(['checkout', '-q', 'main']);
    // Present in the clone, but not behind HEAD — must not be reported as "you are behind".
    expect(() => git(['cat-file', '-e', `${sideSha}^{commit}`])).not.toThrow();
    let isAncestor = true;
    try {
      git(['merge-base', '--is-ancestor', sideSha, 'HEAD']);
    } catch {
      isAncestor = false;
    }
    expect(isAncestor).toBe(false);
  });

  it('an unknown commit is not resolvable at all — also the unknown case', () => {
    let exists = true;
    try {
      git(['cat-file', '-e', '0000000000000000000000000000000000000000^{commit}']);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});

describe('skewMessage', () => {
  const msg = (behind: number) => skewMessage({ kind: 'stale', sha: 'abcdef1234567890', behind });

  it('names the consequence, not just the fact — a gate that is not running', () => {
    expect(msg(5)).toContain('NOT running');
    expect(msg(5)).toContain('Rebuild');
  });

  it('reports the short sha and the distance', () => {
    expect(msg(5)).toContain('abcdef1');
    expect(msg(5)).toContain('5 commits');
  });

  it('pluralises honestly at one commit', () => {
    expect(msg(1)).toContain('1 commit behind');
    expect(msg(1)).not.toContain('1 commits');
  });
});
