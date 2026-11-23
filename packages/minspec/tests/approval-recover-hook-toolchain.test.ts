/**
 * in97 (T3 regression, 2026-11-22) — approval recovery on protected main could not
 * commit, because its throwaway worktree has no node_modules and the repo's own
 * pre-commit gates resolve their toolchain from the worktree they run in.
 *
 * Measured: at 04:56-04:57Z the founder's editor created `approvals/decisions-dr-101-*`,
 * `-dr-115-*`, `-dr-124-*`, `spec-012-*` and `spec-042-*` in his primary, each pointing
 * at origin/main's tip with NO commit (same as #3880 on 2026-11-19). Recovery reached
 * `worktree add -b` and then failed before the commit.
 *
 * Root cause: `recoverProtectedBranchApproval` commits in a fresh worktree off
 * `origin/<base>` that carries no `node_modules`. This repo's approval-race gate
 * (`.githooks/pre-commit`, #3726, landed 2026-11-16) resolves tsx from the hook's own
 * checkout (`$race_root/node_modules/.bin/tsx`), falling back to `npx --no-install tsx`,
 * and is relevant to EVERY approval commit (a sidecar is always staged). With no
 * `node_modules` in the worktree the fallback works only where a stale npx-cache entry
 * holds tsx (true in the container, where #3880's repro passed), and fails closed
 * elsewhere. Reproduced: the same staged sidecar commits with the warm cache and fails
 * (`npm error`, exit 1) with `npm_config_cache` pointed at an empty directory.
 *
 * This test needs no npm: a real git repo whose pre-commit hook fails unless
 * `<hook checkout>/node_modules/.bin/tsx` exists, exactly the lookup the real gate makes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { recoverProtectedBranchApproval } from '../src/lib/approval-recover';

let tmp: string;
let primary: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

const HOOK = `#!/usr/bin/env bash
# Mirrors the approval-race gate's toolchain lookup (.githooks/pre-commit, #3726).
root="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
if [ ! -x "$root/node_modules/.bin/tsx" ]; then
  echo "approval race gate: cannot resolve tsx from $root - failing closed" >&2
  exit 1
fi
exit 0
`;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-recover-toolchain-'));
  const origin = path.join(tmp, 'origin.git');
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  primary = path.join(tmp, 'primary');
  git(tmp, 'clone', '-q', origin, primary);
  git(primary, 'config', 'user.email', 'tester@example.com');
  git(primary, 'config', 'user.name', 'T');
  fs.mkdirSync(path.join(primary, '.githooks'));
  fs.writeFileSync(path.join(primary, '.githooks', 'pre-commit'), HOOK, { mode: 0o755 });
  fs.writeFileSync(path.join(primary, '.gitignore'), 'node_modules/\n');
  fs.mkdirSync(path.join(primary, 'docs'));
  fs.writeFileSync(path.join(primary, 'docs', 'DR-001.md'), 'status: proposed\n');
  git(primary, 'add', '-A');
  git(primary, 'commit', '-q', '-m', 'init');
  git(primary, 'push', '-q', 'origin', 'main');
  git(primary, 'config', 'core.hooksPath', '.githooks');
  // The primary checkout HAS its dependencies installed, as the founder's does.
  fs.mkdirSync(path.join(primary, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(primary, 'node_modules', '.bin', 'tsx'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  // The approval the editor just wrote: uncommitted in the primary.
  fs.writeFileSync(path.join(primary, 'docs', 'DR-001.md'), 'status: accepted\n');
  fs.mkdirSync(path.join(primary, '.minspec', 'approvals', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(primary, '.minspec', 'approvals', 'docs', 'DR-001.md.json'), '{"hash":"x"}\n');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('in97 — recovery commit sees the primary checkout toolchain', () => {
  it('recovers through a hook that resolves its toolchain from the committing checkout', async () => {
    const res = await recoverProtectedBranchApproval(
      primary,
      [path.join(primary, 'docs', 'DR-001.md'), path.join(primary, '.minspec', 'approvals', 'docs', 'DR-001.md.json')],
      'chore(approve): DR-001 accepted',
      { slug: 'docs-dr-001', now: new Date('2026-11-22T04:56:49Z') },
    );
    expect(res.error ?? '').toBe('');
    expect(res.outcome).toBe('recovered');
    // The commit landed on the pushed branch, carrying exactly the approval paths.
    const files = git(primary, 'show', '--name-only', '--format=', `origin/${res.branch}`).trim().split('\n').sort();
    expect(files).toEqual(['.minspec/approvals/docs/DR-001.md.json', 'docs/DR-001.md']);
  });

  it('never commits node_modules and never deletes the primary toolchain on cleanup', async () => {
    const res = await recoverProtectedBranchApproval(
      primary,
      [path.join(primary, 'docs', 'DR-001.md'), path.join(primary, '.minspec', 'approvals', 'docs', 'DR-001.md.json')],
      'chore(approve): DR-001 accepted',
      { slug: 'docs-dr-001' },
    );
    expect(res.outcome).toBe('recovered');
    const tree = git(primary, 'ls-tree', '-r', '--name-only', `origin/${res.branch}`);
    expect(tree).not.toMatch(/node_modules/);
    expect(fs.existsSync(path.join(primary, 'node_modules', '.bin', 'tsx'))).toBe(true);
  });

  it('a primary without node_modules is unchanged: the hook refusal is reported as failed', async () => {
    fs.rmSync(path.join(primary, 'node_modules'), { recursive: true, force: true });
    const res = await recoverProtectedBranchApproval(
      primary,
      [path.join(primary, 'docs', 'DR-001.md'), path.join(primary, '.minspec', 'approvals', 'docs', 'DR-001.md.json')],
      'chore(approve): DR-001 accepted',
      { slug: 'docs-dr-001' },
    );
    expect(res.outcome).toBe('failed');
    expect(res.error).toMatch(/cannot resolve tsx/);
  });
});
