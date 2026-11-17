/**
 * #3452 - dispatching an issue whose agent/issue-N branch already exists must not exit
 * 255 (`fatal: a branch named ... already exists`) and must never delete the branch.
 * Real git repos in a tmpdir; `gh` is a stub on PATH.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const LIB = path.resolve(__dirname, '../../../scripts/lib/issue-branch.sh');
const BR = 'agent/issue-7';

let tmp: string, repo: string, wt: string, bin: string;

function git(cwd: string, ...a: string[]): string {
  const r = spawnSync('git', a, { cwd, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function sh(script: string, env: Record<string, string> = {}) {
  return spawnSync('bash', ['-c', `source "${LIB}"; ${script}`], {
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env },
  });
}
function commit(cwd: string, file: string) {
  fs.writeFileSync(path.join(cwd, file), file);
  git(cwd, 'add', file);
  git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', file);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-branch-'));
  const origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  wt = path.join(tmp, 'wt');
  bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'checkout', '-q', '-b', 'main');
  commit(repo, 'base');
  git(repo, 'push', '-q', 'origin', 'main');
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\necho "${GH_STUB_OUT:-0}"\n[ -z "$GH_STUB_FAIL" ]\n', { mode: 0o755 });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('issue_branch_state', () => {
  it('absent when neither local nor origin has the branch', () => {
    expect(sh(`issue_branch_state "${repo}" ${BR}`).stdout.trim()).toBe('absent');
  });
  it('empty when the branch has no commit beyond origin/main', () => {
    git(repo, 'branch', BR);
    expect(sh(`issue_branch_state "${repo}" ${BR}`).stdout.trim()).toBe('empty');
  });
  it('work when the branch carries a commit not on origin/main (local only)', () => {
    git(repo, 'checkout', '-q', '-b', BR);
    commit(repo, 'a');
    git(repo, 'checkout', '-q', 'main');
    expect(sh(`issue_branch_state "${repo}" ${BR}`).stdout.trim()).toBe('work');
  });
});

describe('issue_branch_open_pr', () => {
  it('0 when gh lists an open PR, 1 when none, 2 when gh fails', () => {
    expect(sh(`issue_branch_open_pr o/r ${BR}; echo $?`, { GH_STUB_OUT: '1' }).stdout.trim().split('\n').pop()).toBe('0');
    expect(sh(`issue_branch_open_pr o/r ${BR}; echo $?`, { GH_STUB_OUT: '0' }).stdout.trim().split('\n').pop()).toBe('1');
    expect(sh(`issue_branch_open_pr o/r ${BR}; echo $?`, { GH_STUB_FAIL: '1' }).stdout.trim().split('\n').pop()).toBe('2');
  });
});

/** Mirrors the case block in dispatch-issue.sh (which uses launcher_git; plain git here). */
function plan() {
  return sh(`
    read -r M REF FF <<<"$(issue_branch_plan "${repo}" ${BR})"
    case "$M" in
      new) git -C "${repo}" worktree add -b ${BR} "${wt}" origin/main >&2 ;;
      existing) git -C "${repo}" worktree add "${wt}" ${BR} >&2
        [[ "$REF" == "-" ]] || git -C "${wt}" merge --ff-only -q "$REF" >&2 ;;
      track) git -C "${repo}" worktree add -b ${BR} "${wt}" "$REF" >&2
        [[ "$FF" == "-" ]] || git -C "${wt}" merge --ff-only -q "$FF" >&2 ;;
      *) exit 1 ;;
    esac
    issue_branch_state "${repo}" ${BR}
  `);
}

describe('worktree creation per issue_branch_plan: an existing agent/issue-N does not fail (was rc=255)', () => {
  it('absent: creates the branch from origin/main', () => {
    const r = plan();
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('empty');
    expect(git(wt, 'branch', '--show-current')).toBe(BR);
  });

  it('work (local): continues from the branch and keeps its commit', () => {
    git(repo, 'checkout', '-q', '-b', BR);
    commit(repo, 'earlier');
    const tip = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'checkout', '-q', 'main');
    const r = plan();
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('work');
    expect(git(wt, 'rev-parse', 'HEAD')).toBe(tip);
    expect(fs.existsSync(path.join(wt, 'earlier'))).toBe(true);
  });

  it('work (origin only): tracks the remote tip', () => {
    git(repo, 'checkout', '-q', '-b', BR);
    commit(repo, 'earlier');
    const tip = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'push', '-q', 'origin', BR);
    git(repo, 'checkout', '-q', 'main');
    git(repo, 'branch', '-q', '-D', BR);
    const r = plan();
    expect(r.status).toBe(0);
    expect(git(wt, 'rev-parse', 'HEAD')).toBe(tip);
  });

  it('work (local behind origin): fast-forwards onto origin, losing nothing', () => {
    git(repo, 'checkout', '-q', '-b', BR);
    commit(repo, 'one');
    git(repo, 'push', '-q', 'origin', BR);
    commit(repo, 'two');
    git(repo, 'push', '-q', 'origin', BR);
    const tip = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'reset', '-q', '--hard', 'HEAD~1');
    git(repo, 'checkout', '-q', 'main');
    const r = plan();
    expect(r.status).toBe(0);
    expect(git(wt, 'rev-parse', 'HEAD')).toBe(tip);
  });

  it('empty: reuses the branch, moved forward to origin/main', () => {
    git(repo, 'branch', BR);
    commit(repo, 'newer');
    git(repo, 'push', '-q', 'origin', 'main');
    const main = git(repo, 'rev-parse', 'HEAD');
    const r = plan();
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('empty');
    expect(git(wt, 'rev-parse', 'HEAD')).toBe(main);
  });
});

describe('dispatch-issue.sh wiring', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../../scripts/dispatch-issue.sh'), 'utf-8');
  it('stands down before the claim on a branch with work and an open PR', () => {
    const gate = src.indexOf('issue_branch_open_pr "$REPO" "$BRANCH"');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(src.indexOf('lease_flock "$ISSUE"; then'));
  });
  it('never deletes the issue branch', () => {
    expect(src).not.toMatch(/branch -D "\$BRANCH"/);
  });
  it('the origin/main worktree add is only the `new` branch of the plan', () => {
    expect(src).toMatch(/"\$BRANCH_MODE" == "new" \]\]; then\n\s+launcher_git -C "\$REPO_ROOT" worktree add -b "\$BRANCH" "\$WORKTREE" origin\/main\n/);
    expect(src.match(/worktree add -b "\$BRANCH" "\$WORKTREE" origin\/main/g)).toHaveLength(1);
  });

});
