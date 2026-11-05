/**
 * The implement close-out producer (#1595, `scripts/lib/close-finished-specs.ts`): the
 * machine step that moves a finished spec to `done` without a human.
 *
 * Driven against a real temporary git repository with a bare `origin`, so the worktree,
 * the evidence lookup, the commit and the push are the real ones. Only GitHub (`gh`), the
 * token mint and the approval verdict are faked.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { runCloseout, BRANCH_PREFIX, type CloseoutDeps } from '../../../scripts/lib/close-finished-specs';
import { parseSpec } from '../src/lib/spec';

const git = (cwd: string, args: readonly string[], env?: NodeJS.ProcessEnv): string =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env, GIT_CONFIG_NOSYSTEM: '1', HOME: os.tmpdir() },
  });

const req = (id: string, implement = 'in-progress'): string =>
  ['---', `id: ${id}`, 'type: requirements', 'status: implementing', 'tier: T3', 'implements: [src/a.ts]',
    'phases:', '  specify: done', '  clarify: done', '  plan: done', '  tasks: done', `  implement: ${implement}`, '---', '', `# ${id}`, ''].join('\n');
const tasks = (id: string, ticks: readonly boolean[]): string =>
  ['---', `id: ${id}`, 'type: tasks', 'status: implementing', 'phases:', '  implement: in-progress', '---', '',
    ...ticks.map((t, i) => `- [${t ? 'x' : ' '}] task ${i + 1}`), ''].join('\n');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function fixture(): { repo: string; origin: string; wtRoot: string } {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'closeout-producer-'));
  dirs.push(top);
  const origin = path.join(top, 'origin.git');
  const repo = path.join(top, 'repo');
  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '--quiet', '-b', 'main', repo]);
  const write = (rel: string, body: string): void => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), body);
  };
  const commit = (msg: string): void => {
    git(repo, ['add', '-A']);
    git(repo, ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', msg]);
  };
  write('.minspec/config.json', '{}\n');
  write('src/a.ts', 'export const a = 1;\n');
  write('specs/p/SPEC-901-done/requirements.md', req('SPEC-901'));
  write('specs/p/SPEC-901-done/tasks.md', tasks('SPEC-901', [false, false]));
  write('specs/p/SPEC-902-wip/requirements.md', req('SPEC-902'));
  write('specs/p/SPEC-902-wip/tasks.md', tasks('SPEC-902', [true, false]));
  commit('docs: specs');
  write('specs/p/SPEC-901-done/tasks.md', tasks('SPEC-901', [true, true]));
  commit('feat(#10): SPEC-901 build (#11)');
  git(repo, ['remote', 'add', 'origin', origin]);
  git(repo, ['push', '--quiet', 'origin', 'main']);
  git(repo, ['fetch', '--quiet', 'origin']);
  return { repo, origin, wtRoot: path.join(top, 'wt') };
}

function fakeDeps(o: { token?: string; openHeads?: string[] } = {}): CloseoutDeps & { ghCalls: string[][] } {
  const ghCalls: string[][] = [];
  return {
    ghCalls,
    git: (cwd, args, env) => git(cwd, ['-c', 'core.hooksPath=/dev/null', ...args], env),
    gh: (args) => {
      ghCalls.push([...args]);
      if (args[0] === 'api') return '{}';
      if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify((o.openHeads ?? []).map((h) => ({ headRefName: h })));
      if (args[0] === 'pr' && args[1] === 'create') return 'https://github.com/o/r/pull/77\n';
      throw new Error(`unexpected gh ${args.join(' ')}`);
    },
    mintToken: () => o.token ?? 'ghs_fake',
    approvalState: () => 'approved',
  };
}

const opts = (f: { repo: string; wtRoot: string }, write: boolean) => ({
  repoRoot: f.repo, repo: 'o/r', base: 'origin/main', max: 10, write, worktreeRoot: f.wtRoot,
});

describe('close-finished-specs (#1595 producer)', () => {
  it('dry run: finds the finished spec, cites the merged commit that ticked its list, writes nothing', () => {
    const f = fixture();
    const r = runCloseout(opts(f, false), fakeDeps());
    expect(r.ok).toBe(true);
    expect(r.closed.map((c) => c.spec)).toEqual(['SPEC-901']);
    expect(r.closed[0]).toMatchObject({ tasks: 2, subject: 'feat(#10): SPEC-901 build (#11)', pr: 11 });
    expect(git(f.repo, ['status', '--porcelain'])).toBe('');
    expect(git(f.repo, ['worktree', 'list'])).not.toContain('spec-closeout');
  });

  it('write: pushes one bot branch with only the closed spec\'s lifecycle lines changed, and opens one PR', () => {
    const f = fixture();
    const deps = fakeDeps();
    const r = runCloseout(opts(f, true), deps);
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.url).toBe('https://github.com/o/r/pull/77');
    const branch = r.branch!;
    expect(branch.startsWith(BRANCH_PREFIX)).toBe(true);

    const files = git(f.origin, ['diff', '--name-only', 'main', branch]).trim().split('\n').sort();
    expect(files).toEqual(['specs/p/SPEC-901-done/requirements.md', 'specs/p/SPEC-901-done/tasks.md']);
    const closed = parseSpec(git(f.origin, ['show', `${branch}:specs/p/SPEC-901-done/requirements.md`])).frontmatter;
    expect(closed.phases.implement).toBe('done');
    expect(closed.status).toBe('done');
    expect(git(f.origin, ['log', '-1', '--format=%an', branch]).trim()).toBe('minspec-sdd[bot]');

    const create = deps.ghCalls.find((c) => c[1] === 'create')!;
    expect(create).toContain(branch);
    // never merges, never arms auto-merge
    expect(deps.ghCalls.some((c) => c.includes('merge'))).toBe(false);
    expect(git(f.repo, ['worktree', 'list'])).not.toContain('spec-closeout');
  });

  it('refuses the whole run with no bot token, writing nothing under any identity', () => {
    const f = fixture();
    const r = runCloseout(opts(f, true), fakeDeps({ token: '' }));
    expect(r.refused?.reason).toBe('no-bot-token');
    expect(git(f.origin, ['for-each-ref', '--format=%(refname)', 'refs/heads']).trim()).toBe('refs/heads/main');
  });

  it('stands down while a close-out pull request is already open', () => {
    const f = fixture();
    const deps = fakeDeps({ openHeads: [`${BRANCH_PREFIX}abc`] });
    const r = runCloseout(opts(f, true), deps);
    expect(r.ok).toBe(true);
    expect(r.closed).toEqual([]);
    expect(deps.ghCalls.some((c) => c[1] === 'create')).toBe(false);
  });

  it('a stale approval is never closed', () => {
    const f = fixture();
    const r = runCloseout(opts(f, false), { ...fakeDeps(), approvalState: () => 'stale' });
    expect(r.closed).toEqual([]);
  });
});
