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
import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';

const HOOK = path.resolve(__dirname, '../../../.githooks/pre-push');
const ZERO = '0'.repeat(40);

// Spawns real `git` per assertion — see #1099 for why the default 5s is too tight here.
vi.setConfig({ testTimeout: 30_000 });
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
  git('commit', '-q', '-m', msg);
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
  // Identity must live in the REPO, not on the individual commit commands: `git rebase`
  // below creates commits of its own and never sees a `-c user.email` passed to `commit`.
  // A dev box usually has a global identity so a per-command form still passes locally —
  // a CI runner has none, and only the rebase case fails there. Set it once, here.
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 'T');
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

  it('ALLOWS a fast-forward update to an existing remote branch', () => {
    // NOTE: `first` is a linear ancestor of `second`, so `first..second` and
    // `first...second` are identical and this case passes against the UNFIXED hook
    // too. It is a guard against regressing the ordinary path, NOT evidence for the
    // else-arm fix — the diverged case below is what proves that.
    write('src/feature.ts', 'export const b = 2;\n');
    const first = commit('first');
    write('src/more.ts', 'export const c = 3;\n');
    const second = commit('second');
    const { code, err } = runHook(second, first);
    expect(err).not.toMatch(/refusing to push/);
    expect(code).toBe(0);
  });

  it('ALLOWS an incremental push to a branch whose EARLIER pushed commit touched a workflow', () => {
    // The server judges only the ref-update range, so this push adds no workflow change:
    // the workflow edit is already on the remote. Basing on the default branch instead of
    // `remote_sha` would re-flag it on every subsequent push — trading one false positive
    // for another, and breaking the same fail-open contract (#1273 architect review).
    //
    // WHAT THIS GUARDS: it passes against the ORIGINAL hook as well as the fixed one, so
    // it is not evidence for the range fix. It fails against the intermediate
    // "always $base...$local_sha" version — a regression introduced and caught during this
    // PR's review. Kept so that regression cannot return unnoticed.
    write('.github/workflows/deploy.yml', 'name: Deploy\non: push\n');
    const pushed = commit('workflow edit — already on the remote');
    write('src/feature.ts', 'export const b = 2;\n');
    const next = commit('unrelated follow-up, no workflow touched');

    // Premise: this really is an ordinary fast-forward, not a divergence.
    expect(() => git('merge-base', '--is-ancestor', pushed, next)).not.toThrow();

    const { code, err } = runHook(next, pushed);
    expect(err).not.toMatch(/refusing to push/);
    expect(code).toBe(0);
  });

  it('ALLOWS a force-push after a rebase, where remote_sha is on the ABANDONED line', () => {
    // The else-arm's actual claim. `remote_sha` here is NOT an ancestor of `local_sha`:
    // the branch was rebased onto the advanced main, so the old tip sits on a discarded
    // history that predates main's workflow edit. Two-dot then reports that workflow file
    // as changed by this push; three-dot diffs from the merge-base and does not.
    write('src/feature.ts', 'export const b = 2;\n');
    const oldTip = commit('feature work, pushed before the rebase');

    git('rebase', 'origin/main');
    const newTip = git('rev-parse', 'HEAD');

    // Prove the premise rather than assume it: the histories really did diverge, so
    // `oldTip` is NOT an ancestor of `newTip` (`--is-ancestor` exits nonzero => throws).
    expect(newTip).not.toBe(oldTip);
    expect(() => git('merge-base', '--is-ancestor', oldTip, newTip)).toThrow();

    const { code, err } = runHook(newTip, oldTip);
    expect(err).not.toMatch(/refusing to push/);
    expect(code).toBe(0);
  });
});
