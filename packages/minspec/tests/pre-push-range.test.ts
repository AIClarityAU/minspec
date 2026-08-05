/**
 * #1263 — T3 regression: the pre-push workflow gate must judge only the commits
 * being pushed, never files where the BASE moved ahead.
 *
 * The hook's own header states it "FAILS OPEN by design ... never to become a new
 * obstacle". The two-dot range broke that contract in the closed direction: for a new
 * branch it built `range="$base..$local_sha"` and handed it to `git diff`, which reads
 * `A..B` as the two-endpoint diff `git diff A B` — NOT the merge-base diff `A...B`. So
 * every path where origin/main had moved ahead was attributed to the push, and any
 * stale branch was refused as soon as main had touched `.github/workflows/**` since the
 * branch was cut.
 *
 * These drive the REAL hook in a temp repo. `MINSPEC_FAKE_APP_CRED=1` forces the
 * credential probe (the seam workflow-paths.sh exposes for exactly this), so the
 * decision is provable without a credential helper or network.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';

const HOOK = path.resolve(__dirname, '../../../.githooks/pre-push');
const ZERO = '0'.repeat(40);

// Spawns real `git` per assertion — see #1099 for why the default 5s is too tight here.
beforeAll(() => {
  vi.setConfig({ testTimeout: 30_000 });
});
afterAll(() => {
  vi.resetConfig();
});

let repo: string;

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function write(rel: string, body: string): void {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

function commit(msg: string): string {
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '-q', '-m', msg);
  return git('rev-parse', 'HEAD');
}

/** Run the hook exactly as git would: refs on stdin, remote name + URL as argv. */
function runHook(localSha: string, remoteSha: string = ZERO): { code: number; err: string } {
  const r = spawnSync('bash', [HOOK, 'origin', 'https://github.com/o/r.git'], {
    cwd: repo,
    input: `refs/heads/feature ${localSha} refs/heads/feature ${remoteSha}\n`,
    encoding: 'utf8',
    env: { ...process.env, MINSPEC_FAKE_APP_CRED: '1', MINSPEC_ALLOW_WORKFLOW_PUSH: '0' },
  });
  return { code: r.status ?? -1, err: r.stderr ?? '' };
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'prepush-'));
  git('init', '-q', '-b', 'main');
  write('.github/workflows/ci.yml', 'name: CI\non: push\n');
  write('src/app.ts', 'export const a = 1;\n');
  const base = commit('base');
  // The branch is cut HERE, then main advances and edits a workflow file.
  git('branch', 'feature', base);
  write('.github/workflows/ci.yml', 'name: CI\non: [push, pull_request]\n');
  const newMain = commit('main moves ahead, touching a workflow');
  git('update-ref', 'refs/remotes/origin/main', newMain);
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  git('checkout', '-q', 'feature');
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('#1263 pre-push gate judges only the pushed commits', () => {
  it('ALLOWS a stale new branch that touches no workflow file', () => {
    // The bug: refused, naming the workflow file main changed after the branch's base.
    write('src/feature.ts', 'export const b = 2;\n');
    const sha = commit('feature work, no workflow touched');
    const { code, err } = runHook(sha);
    expect(err).not.toMatch(/refusing to push/);
    expect(code).toBe(0);
  });

  it('still REFUSES a branch that genuinely edits a workflow file', () => {
    write('.github/workflows/deploy.yml', 'name: Deploy\non: push\n');
    const sha = commit('add a workflow');
    const { code, err } = runHook(sha);
    expect(err).toMatch(/refusing to push/);
    expect(err).toContain('.github/workflows/deploy.yml');
    expect(code).not.toBe(0);
  });

  it('still REFUSES a STALE branch that also edits a workflow (no overshoot)', () => {
    // The fix must not buy the allow-case by ignoring workflow paths on stale branches.
    write('src/feature.ts', 'export const b = 2;\n');
    write('.github/workflows/deploy.yml', 'name: Deploy\non: push\n');
    const sha = commit('stale branch that DOES touch a workflow');
    const { code, err } = runHook(sha);
    expect(err).toMatch(/refusing to push/);
    expect(err).toContain('.github/workflows/deploy.yml');
    expect(code).not.toBe(0);
  });

  it('ALLOWS an update to an existing remote branch whose base moved on', () => {
    // The `else` arm: remote_sha is a real ancestor here, but the same three-dot
    // reasoning must hold once histories diverge (e.g. a force-push after a rebase).
    write('src/feature.ts', 'export const b = 2;\n');
    const first = commit('first');
    write('src/more.ts', 'export const c = 3;\n');
    const second = commit('second');
    const { code, err } = runHook(second, first);
    expect(err).not.toMatch(/refusing to push/);
    expect(code).toBe(0);
  });
});
