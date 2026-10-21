/**
 * T0 — the approval-only self-merge seam (`scripts/alta-self-merge.ts`) writes only when
 * the judge says eligible AND every required check is green AND the base has not moved,
 * binds the merge to the judged head SHA, and turns every API failure into a visible
 * "needs the founder" with no write.
 *
 * `gh` is a stub that answers from a table; `git` is a real repository whose `fetch` is
 * replaced by pointing the refs the seam reads at fixture commits.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { specHash } from '../../shared/src/canonical';
import type { GitBytes } from '../../../scripts/lib/alta-approval-only';
import {
  failingRequiredChecks,
  main,
  parseArgs,
  prsForHead,
  readRequiredChecks,
  runOne,
  type Gh,
  type RunDeps,
} from '../../../scripts/alta-self-merge';

const REPO = 'AIClarityAU/minspec';
const SPEC = 'specs/minspec/SPEC-900-fixture/requirements.md';
const SIDECAR = `.minspec/approvals/${SPEC}.json`;
const FOUNDER = 'github@harvest316.com';
const CFG = { founderLogins: ['harvest316'], founderEmails: [FOUNDER] };
const ENV = { ALTA_FOUNDER_LOGINS: 'harvest316', ALTA_FOUNDER_EMAILS: FOUNDER, GH_TOKEN: 'ghs_test' };

const spec = (status: string): string => `---\nid: SPEC-900\nstatus: ${status}\ntier: T3\n---\n\nBody.\n`;
const record = (content: string, approvedAt: string): string =>
  JSON.stringify({ specPath: SPEC, specHash: specHash(content), approvedAt, approvedBy: FOUNDER, tier: 'T3', migrated: false, baselineBlob: '' }, null, 2) + '\n';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function repoWithAltA(): { git: GitBytes; base: string; head: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alta-seam-'));
  dirs.push(dir);
  const run = (args: readonly string[]): Buffer =>
    execFileSync('git', args as string[], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_AUTHOR_NAME: 'f', GIT_AUTHOR_EMAIL: FOUNDER, GIT_COMMITTER_NAME: 'f', GIT_COMMITTER_EMAIL: FOUNDER },
    });
  const commit = (files: Record<string, string>): string => {
    for (const [p, c] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
      fs.writeFileSync(path.join(dir, p), c);
    }
    run(['add', '-A']);
    run(['commit', '-q', '--no-verify', '-m', 'c']);
    return run(['rev-parse', 'HEAD']).toString().trim();
  };
  run(['init', '-q', '-b', 'main']);
  const base = commit({ [SPEC]: spec('specifying'), [SIDECAR]: record(spec('specifying'), '2026-10-01T00:00:00.000Z') });
  const head = commit({ [SPEC]: spec('planning'), [SIDECAR]: record(spec('planning'), '2026-10-21T00:00:00.000Z') });
  run(['update-ref', 'refs/alta/base', base]);
  const git: GitBytes = (args) => (args[0] === 'fetch' ? Buffer.from('') : run(args));
  return { git, base, head };
}

interface Api {
  pull?: unknown;
  rules?: unknown;
  checkRuns?: unknown;
  statuses?: unknown;
  baseTip?: string;
  fail?: RegExp;
}

/** A `gh` stub answering from `api`; records every call. */
function stubGh(head: string, base: string, api: Api = {}): { gh: Gh; calls: string[][] } {
  const calls: string[][] = [];
  const gh: Gh = (args) => {
    calls.push([...args]);
    const joined = args.join(' ');
    if (api.fail && api.fail.test(joined)) throw new Error(`HTTP 502 for ${joined}`);
    const route = args.filter((a) => a.startsWith('repos/'))[0] ?? '';
    if (route === `repos/${REPO}`) return JSON.stringify({ default_branch: 'main' });
    if (route === `repos/${REPO}/pulls/7`) {
      return JSON.stringify(
        api.pull ?? {
          title: 'chore(approve): SPEC-900 approved',
          state: 'open',
          draft: false,
          merged: false,
          commits: 1,
          user: { login: 'harvest316' },
          base: { ref: 'main', repo: { full_name: REPO } },
          head: { sha: head, repo: { full_name: REPO } },
          labels: [{ name: 'ai-review:pass' }],
        },
      );
    }
    if (route.startsWith(`repos/${REPO}/pulls/7/commits`)) {
      return JSON.stringify([[{ sha: head, parents: [{ sha: base }], author: { login: 'harvest316' } }]]);
    }
    if (route === `repos/${REPO}/rules/branches/main`) {
      return JSON.stringify(
        api.rules ?? [
          { type: 'deletion' },
          {
            type: 'required_status_checks',
            parameters: { required_status_checks: [{ context: 'test' }, { context: 'ai-review', integration_id: 4212099 }, { context: 'ready-to-merge' }] },
          },
        ],
      );
    }
    if (route.startsWith(`repos/${REPO}/commits/${head}/check-runs`)) {
      return JSON.stringify(
        api.checkRuns ?? [
          {
            check_runs: [
              { id: 1, name: 'test', status: 'completed', conclusion: 'success', app: { id: 15368 } },
              { id: 2, name: 'ai-review', status: 'completed', conclusion: 'success', app: { id: 4212099 } },
            ],
          },
        ],
      );
    }
    if (route.startsWith(`repos/${REPO}/commits/${head}/statuses`)) {
      return JSON.stringify(api.statuses ?? [[{ context: 'ready-to-merge', state: 'success' }]]);
    }
    if (route === `repos/${REPO}/git/ref/heads/main`) return JSON.stringify({ object: { sha: api.baseTip ?? base } });
    if (route === `repos/${REPO}/pulls/7/merge`) return JSON.stringify({ merged: true });
    if (route === `repos/${REPO}/issues/7/comments`) return JSON.stringify({ id: 1 });
    if (route === `repos/${REPO}/commits/${head}/pulls`) return JSON.stringify([{ number: 7, state: 'open', head: { sha: head } }]);
    throw new Error(`unexpected gh call: ${joined}`);
  };
  return { gh, calls };
}

const writes = (calls: string[][]): string[][] => calls.filter((c) => c.includes('-X'));
const deps = (gh: Gh, git: GitBytes, over: Partial<RunDeps> = {}): RunDeps => ({ gh, git, cfg: CFG, merge: true, token: 'ghs_test', ...over });

describe('alta-self-merge seam — merges only the judged head, only when green', () => {
  it('merges an eligible, green PR: squash, bound to the judged head, then one audit comment', () => {
    const { git, base, head } = repoWithAltA();
    const { gh, calls } = stubGh(head, base);
    expect(runOne(REPO, 7, deps(gh, git))).toEqual({ pr: 7, decision: 'merged', headSha: head, records: [SPEC] });
    const w = writes(calls);
    expect(w).toHaveLength(2);
    expect(w[0]).toEqual([
      'api', '-X', 'PUT', `repos/${REPO}/pulls/7/merge`, '-f', `sha=${head}`, '-f', 'merge_method=squash', '-f', 'commit_title=chore(approve): SPEC-900 approved (#7)',
    ]);
    expect(w[0]).not.toContain('--admin');
    expect(w[1][3]).toBe(`repos/${REPO}/issues/7/comments`);
    expect(w[1].join(' ')).toContain(head);
  });

  it('a dry run (no --merge) reports eligible and writes nothing', () => {
    const { git, base, head } = repoWithAltA();
    const { gh, calls } = stubGh(head, base);
    expect(runOne(REPO, 7, deps(gh, git, { merge: false }))).toMatchObject({ decision: 'eligible', headSha: head });
    expect(writes(calls)).toHaveLength(0);
  });

  it('a declined PR writes nothing and is not an error', () => {
    const { git, base, head } = repoWithAltA();
    const { gh, calls } = stubGh(head, base, {
      pull: {
        title: 't', state: 'open', draft: false, merged: false, commits: 1, user: { login: 'minspec-sdd[bot]' },
        base: { ref: 'main', repo: { full_name: REPO } }, head: { sha: head, repo: { full_name: REPO } }, labels: [{ name: 'ai-review:pass' }],
      },
    });
    expect(runOne(REPO, 7, deps(gh, git))).toMatchObject({ decision: 'needs-founder', error: false });
    expect(writes(calls)).toHaveLength(0);
  });

  it.each([
    ['a failed required check-run', { checkRuns: [{ check_runs: [{ id: 1, name: 'test', status: 'completed', conclusion: 'failure', app: { id: 1 } }, { id: 2, name: 'ai-review', status: 'completed', conclusion: 'success', app: { id: 4212099 } }] }] }, 'test'],
    ['a pending required check-run', { checkRuns: [{ check_runs: [{ id: 1, name: 'test', status: 'in_progress', conclusion: null, app: { id: 1 } }, { id: 2, name: 'ai-review', status: 'completed', conclusion: 'success', app: { id: 4212099 } }] }] }, 'test'],
    ['a run reporting success while not completed', { checkRuns: [{ check_runs: [{ id: 1, name: 'test', status: 'in_progress', conclusion: 'success', app: { id: 1 } }, { id: 2, name: 'ai-review', status: 'completed', conclusion: 'success', app: { id: 4212099 } }] }] }, 'test'],
    ['a newer failing run supersedes an older pass', { checkRuns: [{ check_runs: [{ id: 1, name: 'test', status: 'completed', conclusion: 'success', app: { id: 1 } }, { id: 9, name: 'test', status: 'completed', conclusion: 'failure', app: { id: 1 } }, { id: 2, name: 'ai-review', status: 'completed', conclusion: 'success', app: { id: 4212099 } }] }] }, 'test'],
    ['ai-review passed by the wrong App', { checkRuns: [{ check_runs: [{ id: 1, name: 'test', status: 'completed', conclusion: 'success', app: { id: 1 } }, { id: 2, name: 'ai-review', status: 'completed', conclusion: 'success', app: { id: 666 } }] }] }, 'ai-review'],
    ['a failing required status', { statuses: [[{ context: 'ready-to-merge', state: 'failure' }, { context: 'ready-to-merge', state: 'success' }]] }, 'ready-to-merge'],
    ['a missing required status', { statuses: [[]] }, 'ready-to-merge'],
  ] as [string, Api, string][])('%s → waiting, no merge', (_n, api, ctx) => {
    const { git, base, head } = repoWithAltA();
    const { gh, calls } = stubGh(head, base, api);
    const out = runOne(REPO, 7, deps(gh, git));
    expect(out).toMatchObject({ decision: 'waiting' });
    if (out.decision === 'waiting') expect(out.reason).toContain(ctx);
    expect(writes(calls)).toHaveLength(0);
  });

  it('base moved after the judgement → waiting, no merge', () => {
    const { git, base, head } = repoWithAltA();
    const { gh, calls } = stubGh(head, base, { baseTip: 'f'.repeat(40) });
    expect(runOne(REPO, 7, deps(gh, git))).toMatchObject({ decision: 'waiting', reason: 'base branch moved since the judgement' });
    expect(writes(calls)).toHaveLength(0);
  });

  it.each([
    ['the pull read', /pulls\/7$/],
    ['the commits read', /pulls\/7\/commits/],
    ['the ruleset read', /rules\/branches/],
    ['the check-runs read', /check-runs/],
    ['the statuses read', /statuses/],
    ['the base tip read', /git\/ref\/heads/],
    ['the merge call', /pulls\/7\/merge/],
  ])('an API error on %s → needs-founder, error, nothing merged', (_n, fail) => {
    const { git, base, head } = repoWithAltA();
    const { gh, calls } = stubGh(head, base, { fail });
    expect(runOne(REPO, 7, deps(gh, git))).toMatchObject({ decision: 'needs-founder', error: true });
    expect(writes(calls).filter((c) => c[3].endsWith('/comments'))).toHaveLength(0);
  });

  it('a ruleset with no required checks cannot prove green → error, no merge', () => {
    const { git, base, head } = repoWithAltA();
    const { gh, calls } = stubGh(head, base, { rules: [{ type: 'deletion' }] });
    expect(runOne(REPO, 7, deps(gh, git))).toMatchObject({ decision: 'needs-founder', error: true });
    expect(writes(calls)).toHaveLength(0);
  });

  it('an empty token refuses before any write', () => {
    const { git, base, head } = repoWithAltA();
    const { gh, calls } = stubGh(head, base);
    expect(runOne(REPO, 7, deps(gh, git, { token: '' }))).toMatchObject({ decision: 'needs-founder', error: true, reason: expect.stringContaining('GH_TOKEN is empty') });
    expect(writes(calls)).toHaveLength(0);
  });

  it('a failed fetch is an error and writes nothing', () => {
    const { base, head } = repoWithAltA();
    const { gh, calls } = stubGh(head, base);
    const git: GitBytes = () => {
      throw new Error('fetch failed');
    };
    expect(runOne(REPO, 7, deps(gh, git))).toMatchObject({ decision: 'needs-founder', error: true });
    expect(writes(calls)).toHaveLength(0);
  });

  it('a judge-internal error is reported as an error', () => {
    const { git, base, head } = repoWithAltA();
    const { gh } = stubGh(head, base);
    const broken: GitBytes = (args) => (args[0] === 'diff' ? Buffer.from('garbage\0x\0') : git(args));
    expect(runOne(REPO, 7, deps(gh, broken))).toMatchObject({ decision: 'needs-founder', error: true });
  });

  it('a default branch name that could be read as a git option is refused', () => {
    const { git, base, head } = repoWithAltA();
    const { gh: inner } = stubGh(head, base);
    const gh: Gh = (args) => (args[1] === `repos/${REPO}` ? JSON.stringify({ default_branch: '--upload-pack=x' }) : inner(args));
    expect(runOne(REPO, 7, deps(gh, git))).toMatchObject({ decision: 'needs-founder', error: true });
  });

  it('a merged PR whose audit comment fails is reported as an error', () => {
    const { git, base, head } = repoWithAltA();
    const { gh } = stubGh(head, base, { fail: /issues\/7\/comments/ });
    expect(runOne(REPO, 7, deps(gh, git))).toMatchObject({ decision: 'needs-founder', error: true, reason: 'merged; audit comment failed' });
  });
});

describe('alta-self-merge readers', () => {
  it('readRequiredChecks keeps integration ids and throws on a malformed rule', () => {
    const { gh } = stubGh('a'.repeat(40), 'b'.repeat(40));
    expect(readRequiredChecks(gh, REPO, 'main')).toEqual([{ context: 'test' }, { context: 'ai-review', integrationId: 4212099 }, { context: 'ready-to-merge' }]);
    const bad: Gh = () => JSON.stringify([{ type: 'required_status_checks', parameters: {} }]);
    expect(() => readRequiredChecks(bad, REPO, 'main')).toThrow('not an array');
    expect(() => readRequiredChecks(() => '{}', REPO, 'main')).toThrow('not an array');
  });

  it('failingRequiredChecks accepts a green check-run or a green status for a context', () => {
    const head = 'a'.repeat(40);
    const { gh } = stubGh(head, 'b'.repeat(40));
    expect(failingRequiredChecks(gh, REPO, head, [{ context: 'test' }, { context: 'ready-to-merge' }])).toEqual([]);
  });

  it('prsForHead lists open PRs whose head is the SHA', () => {
    const head = 'a'.repeat(40);
    const gh: Gh = () =>
      JSON.stringify([
        { number: 7, state: 'open', head: { sha: head } },
        { number: 8, state: 'closed', head: { sha: head } },
        { number: 9, state: 'open', head: { sha: 'c'.repeat(40) } },
      ]);
    expect(prsForHead(gh, REPO, head)).toEqual([7]);
  });

  it('parseArgs validates its inputs', () => {
    expect(parseArgs(['--repo', REPO, '--pr', '7', '--merge'])).toEqual({ repo: REPO, prs: [7], headSha: undefined, merge: true });
    expect(() => parseArgs(['--repo', REPO])).toThrow('--pr or --head-sha');
    expect(() => parseArgs(['--repo', 'x', '--pr', '7'])).toThrow('--repo');
    expect(() => parseArgs(['--repo', REPO, '--pr', '0'])).toThrow('positive integer');
    expect(() => parseArgs(['--repo', REPO, '--head-sha', 'abc'])).toThrow('40-hex');
    expect(() => parseArgs(['--repo', REPO, '--pr', '7', '--admin'])).toThrow('unknown argument');
  });
});

describe('alta-self-merge main', () => {
  it('exit 0 and a merged line for an eligible green PR found by head SHA', () => {
    const { git, base, head } = repoWithAltA();
    const { gh } = stubGh(head, base);
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(main(['--repo', REPO, '--head-sha', head, '--merge'], ENV, gh, git)).toBe(0);
    expect(JSON.parse(String(out.mock.calls[0][0]))).toMatchObject({ pr: 7, decision: 'merged' });
  });

  it('exit 1 when an API error stops the judgement; exit 2 on bad arguments', () => {
    const { git, base, head } = repoWithAltA();
    const { gh } = stubGh(head, base, { fail: /pulls\/7$/ });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(main(['--repo', REPO, '--pr', '7', '--merge'], ENV, gh, git)).toBe(1);
    expect(main(['--repo', REPO], ENV, gh, git)).toBe(2);
    const { gh: failPulls } = stubGh(head, base, { fail: /\/pulls$/ });
    expect(main(['--repo', REPO, '--head-sha', head], ENV, failPulls, git)).toBe(1);
  });

  it('with no founder configured nothing is eligible and nothing is written', () => {
    const { git, base, head } = repoWithAltA();
    const { gh, calls } = stubGh(head, base);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(main(['--repo', REPO, '--pr', '7', '--merge'], { GH_TOKEN: 'ghs_test' }, gh, git)).toBe(0);
    expect(writes(calls)).toHaveLength(0);
  });
});
