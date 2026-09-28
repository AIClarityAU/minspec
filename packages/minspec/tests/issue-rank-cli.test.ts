/**
 * T0/T2 — the rank-issues CLI shell (#2196).
 *
 * The pure ranker is proven in issue-rank.test.ts. This file pins the thin IO shell the
 * drain actually executes: stdin in, the SAME set of numbers out, and a non-zero exit —
 * with NOTHING on stdout — on any failure. A partial list with exit 0 is the one outcome
 * the drain cannot detect, because a shorter queue looks exactly like a smaller backlog.
 *
 * The last block runs the real script through tsx with a stub `gh` on PATH, the way the
 * drain invokes it, so the main-guard, the gh argv and the structural-order loader are
 * exercised for real rather than re-described.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { runCli, parseIssuePages, type CliDeps } from '../../../scripts/rank-issues';
import type { IssueRecord, StructuralOrder } from '../../../scripts/lib/issue-rank';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const ORDER: StructuralOrder = {
  size: 3,
  spec: new Map([
    ['SPEC-001', 0],
    ['SPEC-002', 1],
  ]),
  epic: new Map([['epic-001', { position: 2, id: 'EPIC-001' }]]),
};

function rec(number: number, over: Partial<IssueRecord> = {}): IssueRecord {
  return { number, title: `issue ${number}`, body: '', labels: [], ...over };
}

interface Harness {
  deps: CliDeps;
  stdout: () => string;
  stderr: () => string;
}

function harness(
  stdin: string,
  issues: IssueRecord[] | Error,
  order: StructuralOrder | Error = ORDER,
  totalCount?: number,
): Harness {
  let out = '';
  let err = '';
  const deps: CliDeps = {
    readStdin: () => stdin,
    fetchOpenIssues: () => {
      if (issues instanceof Error) throw issues;
      return { issues, totalCount: totalCount ?? issues.length, notes: [] };
    },
    loadStructuralOrder: () => {
      if (order instanceof Error) throw order;
      return order;
    },
    out: (s) => {
      out += s;
    },
    err: (s) => {
      err += s;
    },
  };
  return { deps, stdout: () => out, stderr: () => err };
}

const WORLD = [
  rec(10, { labels: ['agent-ready-specify'] }),
  rec(11, { title: 'feat(SPEC-002): b', labels: ['agent-ready'] }),
  rec(12, { labels: ['agent-ready'] }),
  rec(13, { body: 'Blocked by #12' }),
];

describe('rank-issues CLI: same set out, reordered', () => {
  it('prints the candidates reordered, one per line', () => {
    const h = harness('10\n11\n12\n', WORLD);
    expect(runCli([], h.deps)).toBe(0);
    // 12 unblocks #13; 11 has a spec; 10 is spec-less and specify-tier.
    expect(h.stdout()).toBe('12\n11\n10\n');
  });

  it('keeps a candidate the fetch did not return (INV-1 at the shell)', () => {
    const h = harness('10\n4242\n', WORLD);
    expect(runCli([], h.deps)).toBe(0);
    expect(h.stdout().trim().split('\n').map(Number).sort((a, b) => a - b)).toEqual([10, 4242]);
  });

  it('tolerates blank lines and surrounding whitespace, and de-duplicates', () => {
    const h = harness('\n 12 \n\n12\n10\n', WORLD);
    expect(runCli([], h.deps)).toBe(0);
    expect(h.stdout()).toBe('12\n10\n');
  });

  it('empty input is an empty (successful) permutation and fetches nothing', () => {
    const h = harness('\n', new Error('must not be called'));
    expect(runCli([], h.deps)).toBe(0);
    expect(h.stdout()).toBe('');
  });
});

describe('rank-issues CLI: every failure is non-zero with an EMPTY stdout', () => {
  it('a failed fetch', () => {
    const h = harness('10\n11\n', new Error('HTTP 401: Bad credentials'));
    expect(runCli([], h.deps)).not.toBe(0);
    expect(h.stdout()).toBe('');
    expect(h.stderr()).toMatch(/Bad credentials/);
  });

  it('a failed structural-order load', () => {
    const h = harness('10\n', WORLD, new Error('no specs found'));
    expect(runCli([], h.deps)).not.toBe(0);
    expect(h.stdout()).toBe('');
    expect(h.stderr()).toMatch(/no specs found/);
  });

  it('a non-numeric input line is refused, never silently dropped', () => {
    const h = harness('10\nabc\n11\n', WORLD);
    expect(runCli([], h.deps)).not.toBe(0);
    expect(h.stdout()).toBe('');
    expect(h.stderr()).toMatch(/abc/);
  });

  it('an unknown flag', () => {
    const h = harness('10\n', WORLD);
    expect(runCli(['--frobnicate'], h.deps)).not.toBe(0);
    expect(h.stdout()).toBe('');
  });
});

describe('rank-issues CLI: no silent caps', () => {
  it('says so on stderr when fewer issues came back than the repo reports open', () => {
    const h = harness('10\n', WORLD, ORDER, 900);
    expect(runCli([], h.deps)).toBe(0);
    expect(h.stderr()).toMatch(/4 of 900/);
  });
});

describe('rank-issues CLI --explain', () => {
  it('prints a row per candidate with each term, and counts the spec-less', () => {
    const h = harness('10\n11\n12\n4242\n', WORLD);
    expect(runCli(['--explain'], h.deps)).toBe(0);
    const out = h.stdout();
    for (const n of [10, 11, 12, 4242]) expect(out).toMatch(new RegExp(`#${n}\\b`));
    // Row order is rank order.
    expect(out.indexOf('#12')).toBeLessThan(out.indexOf('#11'));
    expect(out.indexOf('#11')).toBeLessThan(out.indexOf('#10'));
    expect(out).toMatch(/SPEC-002/);
    expect(out).toMatch(/unblocks 1/);
    // 10, 12 and 4242 serve no spec; only 11 does.
    expect(out).toMatch(/3 of 4 candidate\(s\) serve no spec or epic/);
    expect(out).toMatch(/1 of 4 candidate\(s\) .*not in the fetched open issues/);
  });
});

describe('parseIssuePages: the gh --paginate --slurp shape, validated', () => {
  const page = (nodes: unknown[], totalCount = nodes.length) => ({
    data: { repository: { issues: { totalCount, pageInfo: { hasNextPage: false, endCursor: null }, nodes } } },
  });
  const node = (number: number, over: Record<string, unknown> = {}) => ({
    number,
    title: `t${number}`,
    body: 'Blocked by #1',
    labels: { totalCount: 1, nodes: [{ name: 'agent-ready' }] },
    blockedBy: { totalCount: 1, nodes: [{ number: 2 }] },
    ...over,
  });

  it('flattens pages into records, including native blocked-by numbers', () => {
    const got = parseIssuePages(JSON.stringify([page([node(5)], 2), page([node(6, { body: null })], 2)]));
    expect(got.totalCount).toBe(2);
    expect(got.issues).toEqual([
      { number: 5, title: 't5', body: 'Blocked by #1', labels: ['agent-ready'], blockedBy: [2] },
      { number: 6, title: 't6', body: '', labels: ['agent-ready'], blockedBy: [2] },
    ]);
    expect(got.notes).toEqual([]);
  });

  it('notes nested truncation instead of hiding it', () => {
    const got = parseIssuePages(
      JSON.stringify([page([node(5, { blockedBy: { totalCount: 150, nodes: [{ number: 2 }] } })])]),
    );
    expect(got.notes.join('\n')).toMatch(/#5.*1 of 150/);
  });

  it.each([
    ['not JSON', 'nope'],
    ['not an array', JSON.stringify(page([]))],
    ['an empty array', '[]'],
    ['a GraphQL error', JSON.stringify([{ errors: [{ message: 'Field blockedBy does not exist' }] }])],
    ['a missing repository', JSON.stringify([{ data: { repository: null } }])],
    ['a malformed node', JSON.stringify([page([{ number: 'five' }])])],
  ])('throws on %s', (_name, raw) => {
    expect(() => parseIssuePages(raw)).toThrow();
  });
});

// ─── End to end: the real script, as the drain runs it ───────────────────────

function repoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'scripts', 'rank-issues.ts')) && fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('repo root not found from ' + __dirname);
}

describe('rank-issues.ts end to end (tsx, stub gh on PATH)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-issues-e2e-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** A minimal MinSpec workspace: EPIC-002 is ordered BEFORE EPIC-001. */
  function fixtureRoot(): string {
    const root = path.join(tmp, 'ws');
    fs.mkdirSync(path.join(root, 'docs', 'epics'), { recursive: true });
    fs.mkdirSync(path.join(root, 'specs', 'p', 'SPEC-001-a'), { recursive: true });
    fs.mkdirSync(path.join(root, 'specs', 'p', 'SPEC-002-b'), { recursive: true });
    const epic = (id: string, slug: string, order: number) =>
      `---\nid: ${id}\nslug: ${slug}\ntitle: ${slug}\nstatus: active\norder: ${order}\n---\n\n# ${id}\n`;
    fs.writeFileSync(path.join(root, 'docs', 'epics', 'EPIC-001-alpha.md'), epic('EPIC-001', 'alpha', 2));
    fs.writeFileSync(path.join(root, 'docs', 'epics', 'EPIC-002-beta.md'), epic('EPIC-002', 'beta', 1));
    const spec = (id: string, epicId: string, status: string) =>
      `---\nid: ${id}\ntype: requirements\nstatus: ${status}\ntier: T2\nepic: ${epicId}\n---\n\n# ${id}\n`;
    // SPEC-001 claims `done`, SPEC-002 claims `implementing`: status must not matter,
    // only that SPEC-002's epic is ordered first.
    fs.writeFileSync(path.join(root, 'specs', 'p', 'SPEC-001-a', 'requirements.md'), spec('SPEC-001', 'EPIC-001', 'done'));
    fs.writeFileSync(
      path.join(root, 'specs', 'p', 'SPEC-002-b', 'requirements.md'),
      spec('SPEC-002', 'EPIC-002', 'implementing'),
    );
    return root;
  }

  function stubGh(pages: unknown, exit = 0): { bin: string; argsFile: string } {
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const fixture = path.join(tmp, 'pages.json');
    const argsFile = path.join(tmp, 'gh-args');
    fs.writeFileSync(fixture, JSON.stringify(pages));
    fs.writeFileSync(
      path.join(bin, 'gh'),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${JSON.stringify(argsFile)}\n` +
        (exit === 0 ? `cat ${JSON.stringify(fixture)}\n` : 'echo "HTTP 401: Bad credentials" >&2\n') +
        `exit ${exit}\n`,
      { mode: 0o755 },
    );
    return { bin, argsFile };
  }

  function run(stdin: string, bin: string, extra: string[] = []) {
    const root = repoRoot();
    return spawnSync(
      path.join(root, 'node_modules', '.bin', 'tsx'),
      [path.join(root, 'scripts', 'rank-issues.ts'), '--repo', 'AIClarityAU/minspec', '--root', fixtureRoot(), ...extra],
      { input: stdin, encoding: 'utf-8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } },
    );
  }

  const nodes = [
    { number: 1, title: 'feat(SPEC-001): a', body: '', labels: { totalCount: 0, nodes: [] }, blockedBy: { totalCount: 0, nodes: [] } },
    { number: 2, title: 'feat(SPEC-002): b', body: '', labels: { totalCount: 0, nodes: [] }, blockedBy: { totalCount: 0, nodes: [] } },
    { number: 3, title: 'chore: c', body: '', labels: { totalCount: 0, nodes: [] }, blockedBy: { totalCount: 0, nodes: [] } },
    { number: 4, title: 'chore: d', body: 'Blocked by #3', labels: { totalCount: 0, nodes: [] }, blockedBy: { totalCount: 0, nodes: [] } },
  ];
  const pages = [{ data: { repository: { issues: { totalCount: 4, pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } }];

  it('ranks by unblocks, then the fixture workspace structural order', () => {
    const { bin, argsFile } = stubGh(pages);
    const r = run('1\n2\n3\n', bin);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    // #3 unblocks #4; then SPEC-002 (EPIC-002, order 1) before SPEC-001 (EPIC-001, order 2).
    expect(r.stdout).toBe('3\n2\n1\n');
    // One paged GraphQL query that asks for the native relation too.
    const args = fs.readFileSync(argsFile, 'utf-8');
    expect(args).toMatch(/^api\ngraphql\n--paginate\n--slurp\n/);
    expect(args).toMatch(/blockedBy/);
    expect(args).toMatch(/owner=AIClarityAU/);
  });

  it('exits non-zero with an empty stdout when gh fails', () => {
    const { bin } = stubGh(pages, 1);
    const r = run('1\n2\n3\n', bin);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/Bad credentials/);
  });
});
