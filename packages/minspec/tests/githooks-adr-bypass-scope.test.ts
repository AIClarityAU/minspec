/**
 * `.githooks/pre-commit` — ADR_BORN_GATE_OFF must scope to the DR-029
 * born-status block only, T3 regression (issue #1040).
 *
 * Root cause: the flag was implemented as a whole-hook `[ ... ] && exit 0`
 * instead of wrapping just the DR-029 block it names. `ADR_BORN_GATE_OFF=1`
 * is the documented, routine workaround for merge commits (the DR-029 gate
 * false-positiving on merge-into-stale-branch — see the hook's own header
 * comment), so in normal use every merge commit silently skipped the
 * committable-symlink gate (#913) and the validate gate too — a silent
 * gate, which invariant 2 (constitution) forbids.
 *
 * This test proves the bypass no longer reaches the symlink gate: with
 * ADR_BORN_GATE_OFF=1 set and NO DR file staged at all (so the DR-029 block
 * has nothing to check), a staged symlink with an absolute target must
 * still be rejected by the symlink gate.
 *
 * Runs the REAL `.githooks/pre-commit` script (core.hooksPath points
 * straight at it), same pattern as commit-on-approve.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const REAL_HOOKS_DIR = path.resolve(__dirname, '../../../.githooks');

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-adr-bypass-scope-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function git(args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', args, {
    cwd: tmp,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: env ? { ...process.env, ...env } : process.env,
  }).toString();
}

function initRepoWithRealHook(): void {
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@minspec.test']);
  git(['config', 'user.name', 'MinSpec Test']);
  git(['config', 'core.hooksPath', REAL_HOOKS_DIR]);
}

/** Stage a symlink `linkpath` -> `target` directly in the index (no working-tree
 *  symlink needed — `git update-index` accepts a blob + mode straight in). */
function stageSymlink(linkpath: string, target: string): void {
  const sha = execFileSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: tmp,
    input: target,
  })
    .toString()
    .trim();
  git(['update-index', '--add', '--cacheinfo', `120000,${sha},${linkpath}`]);
}

describe('ADR_BORN_GATE_OFF scoping (#1040) — must not bypass the whole hook', () => {
  it('with ADR_BORN_GATE_OFF=1 and no DR staged, a bad symlink is still rejected by the symlink gate', () => {
    initRepoWithRealHook();
    // No docs/decisions/DR-*.md staged at all — the DR-029 block this flag
    // names has nothing to do. If the flag still reached past it (the bug),
    // the whole hook would exit 0 and this commit would land.
    stageSymlink('bad-link', '/etc/passwd');

    expect(() =>
      git(['commit', '-m', 'test: stage a bad symlink'], { ADR_BORN_GATE_OFF: '1' })
    ).toThrow();
    // Nothing landed — the symlink gate blocked it despite the ADR bypass.
    expect(() => git(['rev-parse', 'HEAD'])).toThrow();
  });

  it('sanity: the same bad symlink IS committed when its own gate (SYMLINK_GATE_OFF) is off', () => {
    initRepoWithRealHook();
    stageSymlink('bad-link', '/etc/passwd');

    // Both bypasses on: proves the commit is otherwise clean (no other gate
    // objects) and the symlink gate is what blocked it above.
    expect(() =>
      git(['commit', '-m', 'test: stage a bad symlink'], {
        ADR_BORN_GATE_OFF: '1',
        SYMLINK_GATE_OFF: '1',
      })
    ).not.toThrow();
    expect(git(['rev-parse', 'HEAD'])).toBeTruthy();
  });
});
