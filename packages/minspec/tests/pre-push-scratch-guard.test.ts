/**
 * #3100 — pre-push refuses rescue branch creation and scratch-dir paths.
 * Drives the REAL hook in a temp repo; no network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';

const HOOK = path.resolve(__dirname, '../../../.githooks/pre-push');
const ZERO = '0'.repeat(40);
vi.setConfig({ testTimeout: 30_000 });

let repo: string;
const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
function write(rel: string, body: string) {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}
function commit(msg: string) {
  git('add', '-A', '-f');
  git('commit', '-q', '-m', msg);
  return git('rev-parse', 'HEAD');
}
function run(ref: string, sha: string, env: Record<string, string> = {}) {
  const r = spawnSync('bash', [HOOK, 'origin', 'https://github.com/o/r.git'], {
    cwd: repo,
    input: `refs/heads/x ${sha} ${ref} ${ZERO}\n`,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: r.status ?? -1, err: r.stderr ?? '' };
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'prepush-scratch-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 'T');
  write('a.txt', 'a\n');
  const base = commit('base');
  git('update-ref', 'refs/remotes/origin/main', base);
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  git('checkout', '-q', '-b', 'x');
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('pre-push scratch/rescue guard (#3100)', () => {
  it('refuses creating a rescue/* ref', () => {
    write('b.txt', 'b\n');
    const sha = commit('b');
    const r = run('refs/heads/rescue/foo-1025', sha);
    expect(r.code).toBe(1);
    expect(r.err).toContain('rescue/foo-1025');
  });

  it('refuses a push that adds .scratch-*/ paths', () => {
    write('.scratch-readout/notes.md', 'x\n');
    const sha = commit('scratch');
    const r = run('refs/heads/feature', sha);
    expect(r.code).toBe(1);
    expect(r.err).toContain('.scratch-readout/notes.md');
  });

  it('allows an ordinary push', () => {
    write('b.txt', 'b\n');
    const sha = commit('b');
    expect(run('refs/heads/feature', sha).code).toBe(0);
  });

  it('honours the explicit bypass', () => {
    write('.scratch-readout/notes.md', 'x\n');
    const sha = commit('scratch');
    expect(run('refs/heads/rescue/y', sha, { MINSPEC_ALLOW_SCRATCH_PUSH: '1' }).code).toBe(0);
  });
});
