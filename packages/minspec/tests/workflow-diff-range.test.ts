/**
 * #1274 — T2: `workflow_diff_range`, the shared range helper extracted from
 * `.githooks/pre-push`'s #1263 fix so every caller judges "what does this push
 * introduce" the same, correct way.
 *
 * `git diff A..B` is the two-endpoint TREE diff (`git diff A B`), not a
 * reachability-aware one. A caller that hands it a base which has moved ahead of
 * where the branch forked also gets back every file the BASE changed since —
 * files the push does not touch, whose commits are already on the remote. That
 * bug shipped twice: once in the hook (#1263, fixed), and independently in
 * dispatch-issue.sh's `shepherd_publish` (#1274, this fix) — see
 * shepherd-publish-range.test.ts for that call site's wiring.
 *
 * These drive the REAL function, sourced fresh per test in a disposable git repo
 * — no mocking of `git merge-base` or `git diff`.
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const LIB = path.resolve(__dirname, '../../../scripts/lib/workflow-paths.sh');

let repo: string;
const made: string[] = [];

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

/** Call the real function with the given args and return the printed range. */
function diffRange(...args: string[]): string {
  const quoted = args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
  return execFileSync(
    'bash',
    ['-c', `set -euo pipefail; . "${LIB}"; workflow_diff_range ${quoted}`],
    { cwd: repo, encoding: 'utf8' },
  ).trim();
}

function freshRepo(): void {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wdr-'));
  made.push(repo);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 'T');
}

afterAll(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

describe('workflow_diff_range (#1274)', () => {
  it('uses the two-dot ancestor range for an ordinary fast-forward', () => {
    freshRepo();
    write('a.txt', '1\n');
    const first = commit('first');
    write('b.txt', '2\n');
    const second = commit('second');
    expect(diffRange(first, second, 'main')).toBe(`${first}..${second}`);
  });

  it('falls back to base_ref three-dot when prev_sha is empty (new branch)', () => {
    freshRepo();
    write('a.txt', '1\n');
    const tip = commit('first');
    expect(diffRange('', tip, 'main')).toBe(`main...${tip}`);
  });

  it('falls back to base_ref three-dot when prev_sha is NOT an ancestor (rebase/reset)', () => {
    freshRepo();
    write('a.txt', '1\n');
    const base = commit('base');
    git('branch', 'feature', base);
    write('a.txt', '2\n');
    const mainAdvanced = commit('main moves on');
    git('checkout', '-q', 'feature');
    write('b.txt', '1\n');
    const oldFeatureTip = commit('feature work');
    git('reset', '-q', '--hard', mainAdvanced);
    write('c.txt', '1\n');
    const newFeatureTip = commit('feature work, rebuilt on advanced main');

    // Premise: oldFeatureTip really is abandoned — not an ancestor of the new tip.
    expect(() => git('merge-base', '--is-ancestor', oldFeatureTip, newFeatureTip)).toThrow();

    expect(diffRange(oldFeatureTip, newFeatureTip, 'main')).toBe(`main...${newFeatureTip}`);
  });

  it('the ancestor arm excludes a change an EARLIER push of this ref already carried', () => {
    // The regression this function exists to prevent re-introducing: a workflow
    // edit already on the remote must not be re-flagged by a later, unrelated push.
    freshRepo();
    fs.mkdirSync(path.join(repo, '.github/workflows'), { recursive: true });
    write('.github/workflows/ci.yml', 'name: ci\n');
    const pushed = commit('workflow edit — already on the remote');
    write('src.txt', 'x\n');
    const next = commit('unrelated follow-up');

    const range = diffRange(pushed, next, 'main');
    expect(range).toBe(`${pushed}..${next}`);
    const files = execFileSync('git', ['-C', repo, 'diff', '--name-only', range], {
      encoding: 'utf8',
    });
    expect(files).not.toMatch(/workflows\/ci\.yml/);
  });

  it('defaults base_ref to origin/main when omitted', () => {
    freshRepo();
    write('a.txt', '1\n');
    const tip = commit('first');
    expect(diffRange('', tip)).toBe(`origin/main...${tip}`);
  });
});
