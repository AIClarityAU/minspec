import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * T3 regression (#1120): a push that touches `.github/workflows/**` with a GitHub
 * App credential must be refused LOCALLY, with an actionable message.
 *
 * GitHub gates workflow files behind a separate `workflows: write` permission —
 * `contents: write`, which the minspec-sdd App has, is documented as insufficient.
 * So the server rejects such a push outright, and it does so only at `git push`,
 * after the work is already sealed into branch history:
 *
 *   ! [remote rejected] … (refusing to allow a GitHub App to create or update
 *     workflow `.github/workflows/ai-review.yml` without `workflows` permission)
 *
 * Every `MinSpec: Refresh Harness Files` rewrites five managed workflow templates,
 * so this fires on every harness refresh in every consuming repo until the App is
 * granted the permission.
 *
 * These drive a REAL `git push` against a local bare remote. A mocked push cannot
 * prove a hook fires — the same class of gap that shipped an inert guard in #1057,
 * where the fixture manufactured a precondition production lacked.
 */

const repoRoot = path.resolve(__dirname, '../../..');
const made: string[] = [];

function git(cwd: string, ...args: string[]) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

function mustGit(cwd: string, ...args: string[]) {
  const r = git(cwd, ...args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return (r.stdout ?? '').trim();
}

/**
 * A repo wired exactly like a MinSpec project: core.hooksPath=.githooks, the real
 * pre-push hook and its lib copied in, and a local bare remote to push at.
 *
 * `credentialIsApp` fakes the credential probe the way production sees it — git
 * hands an installation token the fixed username `x-access-token`.
 */
function makeRepo({ credentialIsApp }: { credentialIsApp: boolean }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-prepush-'));
  made.push(dir);
  const work = path.join(dir, 'work');
  const remote = path.join(dir, 'remote.git');

  mustGit(dir, 'init', '--bare', remote);
  fs.mkdirSync(work);
  mustGit(work, 'init', '--initial-branch', 'main');
  mustGit(work, 'config', 'user.email', 'test@example.com');
  mustGit(work, 'config', 'user.name', 'Test');
  mustGit(work, 'remote', 'add', 'origin', remote);

  // A credential helper that answers with the username production would see.
  // No real secret anywhere — the guard reads the username only.
  const user = credentialIsApp ? 'x-access-token' : 'a-human';
  mustGit(work, 'config', 'credential.helper', `!f() { echo username=${user}; echo password=x; }; f`);

  fs.mkdirSync(path.join(work, '.githooks'), { recursive: true });
  fs.mkdirSync(path.join(work, 'scripts/lib'), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, '.githooks/pre-push'), path.join(work, '.githooks/pre-push'));
  fs.copyFileSync(
    path.join(repoRoot, 'scripts/lib/workflow-paths.sh'),
    path.join(work, 'scripts/lib/workflow-paths.sh'),
  );
  fs.chmodSync(path.join(work, '.githooks/pre-push'), 0o755);
  mustGit(work, 'config', 'core.hooksPath', '.githooks');

  fs.writeFileSync(path.join(work, 'seed.txt'), 'seed\n');
  mustGit(work, 'add', '-A');
  mustGit(work, 'commit', '-m', 'seed');
  mustGit(work, 'push', '-q', '-u', 'origin', 'main');
  return { work, remote };
}

function commitFile(work: string, rel: string, body = 'x\n') {
  const abs = path.join(work, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  mustGit(work, 'add', '-A');
  mustGit(work, 'commit', '-m', `add ${rel}`);
}

afterAll(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

describe('pre-push blocks an App-credentialed workflow push', () => {
  it('is testing the real hook, not a copy that drifted (anti-vacuity)', () => {
    const hook = fs.readFileSync(path.resolve(repoRoot, '.githooks/pre-push'), 'utf8');
    const lib = fs.readFileSync(path.resolve(repoRoot, 'scripts/lib/workflow-paths.sh'), 'utf8');
    expect(hook).toContain('workflow-paths.sh');
    expect(lib).toContain('WORKFLOW_PATH_RE');
    // If core.hooksPath were unset in the fixture the hook would never run and
    // every "blocked" assertion below would silently invert to a pass.
    const { work } = makeRepo({ credentialIsApp: true });
    expect(mustGit(work, 'config', '--get', 'core.hooksPath')).toBe('.githooks');
  });

  it('refuses a push touching .github/workflows/ and names the remedy', () => {
    const { work } = makeRepo({ credentialIsApp: true });
    mustGit(work, 'checkout', '-q', '-b', 'chore/refresh');
    commitFile(work, '.github/workflows/ai-review.yml', 'name: ai-review\n');

    const res = git(work, 'push', '-u', 'origin', 'chore/refresh');
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/refusing to push/);
    expect(res.stderr).toMatch(/\.github\/workflows\/ai-review\.yml/);
    expect(res.stderr).toMatch(/workflows: write/);
    expect(res.stderr).toMatch(/MINSPEC_ALLOW_WORKFLOW_PUSH=1/);
  });

  it('actually prevents the ref reaching the remote', () => {
    const { work, remote } = makeRepo({ credentialIsApp: true });
    mustGit(work, 'checkout', '-q', '-b', 'chore/refresh');
    commitFile(work, '.github/workflows/ci.yml', 'name: ci\n');
    git(work, 'push', '-u', 'origin', 'chore/refresh');
    // The point of the guard: nothing landed. A message without this is theatre.
    expect(git(remote, 'rev-parse', '--verify', 'chore/refresh').status).not.toBe(0);
  });

  it('allows a workflow push under a HUMAN credential (never a new obstacle)', () => {
    const { work, remote } = makeRepo({ credentialIsApp: false });
    mustGit(work, 'checkout', '-q', '-b', 'human/wf');
    commitFile(work, '.github/workflows/ci.yml', 'name: ci\n');
    const res = git(work, 'push', '-u', 'origin', 'human/wf');
    expect(res.status, res.stderr).toBe(0);
    expect(git(remote, 'rev-parse', '--verify', 'human/wf').status).toBe(0);
  });

  it('allows an App push that touches no workflow file', () => {
    const { work, remote } = makeRepo({ credentialIsApp: true });
    mustGit(work, 'checkout', '-q', '-b', 'feat/code');
    commitFile(work, 'packages/minspec/src/thing.ts', 'export const x = 1;\n');
    const res = git(work, 'push', '-u', 'origin', 'feat/code');
    expect(res.status, res.stderr).toBe(0);
    expect(git(remote, 'rev-parse', '--verify', 'feat/code').status).toBe(0);
  });

  it('honours the env escape hatch', () => {
    const { work, remote } = makeRepo({ credentialIsApp: true });
    mustGit(work, 'checkout', '-q', '-b', 'chore/override');
    commitFile(work, '.github/workflows/ci.yml', 'name: ci\n');
    const res = spawnSync('git', ['push', '-u', 'origin', 'chore/override'], {
      cwd: work,
      encoding: 'utf8',
      env: { ...process.env, MINSPEC_ALLOW_WORKFLOW_PUSH: '1' },
    });
    expect(res.status, res.stderr).toBe(0);
    expect(git(remote, 'rev-parse', '--verify', 'chore/override').status).toBe(0);
  });

  it('honours the git-config escape hatch', () => {
    const { work, remote } = makeRepo({ credentialIsApp: true });
    mustGit(work, 'config', 'minspec.allowWorkflowPush', 'true');
    mustGit(work, 'checkout', '-q', '-b', 'chore/cfg');
    commitFile(work, '.github/workflows/ci.yml', 'name: ci\n');
    const res = git(work, 'push', '-u', 'origin', 'chore/cfg');
    expect(res.status, res.stderr).toBe(0);
    expect(git(remote, 'rev-parse', '--verify', 'chore/cfg').status).toBe(0);
  });

  it('does not block a branch DELETION (no content to reject)', () => {
    const { work, remote } = makeRepo({ credentialIsApp: true });
    mustGit(work, 'checkout', '-q', '-b', 'tmp/gone');
    commitFile(work, 'note.txt');
    mustGit(work, 'push', '-q', '-u', 'origin', 'tmp/gone');
    mustGit(work, 'checkout', '-q', 'main');
    const res = git(work, 'push', 'origin', '--delete', 'tmp/gone');
    expect(res.status, res.stderr).toBe(0);
    expect(git(remote, 'rev-parse', '--verify', 'tmp/gone').status).not.toBe(0);
  });

  it('is inert when the lib is absent (partial checkout must still push)', () => {
    const { work, remote } = makeRepo({ credentialIsApp: true });
    fs.rmSync(path.join(work, 'scripts/lib/workflow-paths.sh'));
    mustGit(work, 'checkout', '-q', '-b', 'chore/nolib');
    commitFile(work, '.github/workflows/ci.yml', 'name: ci\n');
    mustGit(work, 'add', '-A');
    const res = git(work, 'push', '-u', 'origin', 'chore/nolib');
    expect(res.status, res.stderr).toBe(0);
    expect(git(remote, 'rev-parse', '--verify', 'chore/nolib').status).toBe(0);
  });
});
