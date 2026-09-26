/**
 * `.githooks/pre-commit` — the DR-029 born gate must not fire on DRs that a
 * merge brings in, T3 regression (issue #2057).
 *
 * Root cause: the gate selects its files with `git diff --cached
 * --name-status --diff-filter=A`, which during a merge is computed against
 * HEAD alone. Every DR the incoming branch already carries is absent from
 * HEAD, so it reads as newly added and is judged on its `status:` — which is
 * `accepted`, because the founder accepted it on `main` weeks ago. The gate
 * has no way to ask whether THIS commit authored the file or merely inherited
 * it, so the false positive is systematic: it fires on every merge-from-main
 * into any branch older than the most recent DR acceptance.
 *
 * That matters beyond the nuisance. The documented escape is
 * `ADR_BORN_GATE_OFF=1`, so a gate that a correct, routine operation cannot
 * pass trains reflexive override-setting — the exact behaviour #1043 was
 * filed to stop (the hook's own header records it).
 *
 * The fix: a file this commit did not author has a blob identical to one of
 * the merge parents. Only a DR whose content differs from BOTH parents was
 * written here, and only that one is judged.
 *
 * Runs the REAL `.githooks/pre-commit` (core.hooksPath points straight at
 * it), same pattern as githooks-adr-bypass-scope.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const REAL_HOOKS_DIR = path.resolve(__dirname, '../../../.githooks');

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-born-gate-merge-'));
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

function writeFile(rel: string, body: string): void {
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

/**
 * The scratch repo is not a MinSpec project, so it has no validator for the
 * DR-index gate to run and that gate fails closed on every commit here. It is
 * unrelated to the born check, so the commits under test carry its documented
 * override. That the override does NOT blind the born gate is proved by the
 * two rejection cases below, which still fail on the born gate's own message
 * with this same variable set.
 */
const COMMIT_ENV = { DR_INDEX_GATE_OFF: '1' };

/** Setup commits bypass the hook entirely — they stage history the gate is
 *  meant to have already accepted, not the commit under test. */
function seedCommit(message: string): void {
  git(['add', '-A']);
  git(['commit', '--no-verify', '-m', message]);
}

const ACCEPTED_DR = ['---', 'id: DR-090', 'status: accepted', '---', '', 'Accepted weeks ago.', ''].join(
  '\n'
);

/**
 * Builds the exact shape from #2057: a feature branch that predates a DR's
 * acceptance on main, then `git merge main` staged but not yet committed.
 */
function setUpStaleBranchMergingMain(): void {
  initRepoWithRealHook();
  writeFile('README.md', 'seed\n');
  seedCommit('chore: seed');

  git(['branch', 'feature']);

  // main accepts DR-090 — a separate human act, already done.
  writeFile('docs/decisions/DR-090.md', ACCEPTED_DR);
  seedCommit('docs: accept DR-090');

  // feature diverges without ever seeing DR-090.
  git(['checkout', 'feature']);
  writeFile('src.txt', 'feature work\n');
  seedCommit('feat: unrelated work');

  git(['merge', 'main', '--no-commit', '--no-ff']);
}

describe('DR-029 born gate on merge commits (#2057)', () => {
  it('does not fire on a DR the merge inherited from the other parent', () => {
    setUpStaleBranchMergingMain();

    // Preserves the premise: the gate's own file selection really does see
    // DR-090 as an addition. Without this the test could pass because the
    // merge staged nothing, proving nothing about the gate.
    const added = git(['diff', '--cached', '--name-status', '--diff-filter=A']);
    expect(added).toContain('docs/decisions/DR-090.md');

    // The commit under test runs the real hook, with no override set.
    expect(() => git(['commit', '-m', 'merge main into feature'], COMMIT_ENV)).not.toThrow();
    expect(git(['log', '-1', '--format=%P']).trim().split(/\s+/)).toHaveLength(2);
  });

  it('still rejects a DR genuinely authored inside the merge resolution', () => {
    setUpStaleBranchMergingMain();

    // Same merge, but the author also writes a brand-new DR while resolving.
    // Its content differs from BOTH parents, so the gate must still judge it.
    writeFile(
      'docs/decisions/DR-091.md',
      ['---', 'id: DR-091', 'status: accepted', '---', '', 'Born accepted — not allowed.', ''].join('\n')
    );
    git(['add', 'docs/decisions/DR-091.md']);

    expect(() => git(['commit', '-m', 'merge main into feature'], COMMIT_ENV)).toThrow(/DR-091/);
  });

  it('still rejects a DR born accepted in an ordinary non-merge commit', () => {
    initRepoWithRealHook();
    writeFile('README.md', 'seed\n');
    seedCommit('chore: seed');

    writeFile('docs/decisions/DR-092.md', ACCEPTED_DR.replace('DR-090', 'DR-092'));
    git(['add', 'docs/decisions/DR-092.md']);

    expect(() => git(['commit', '-m', 'docs: add DR-092'], COMMIT_ENV)).toThrow(/DR-092/);
  });
});
