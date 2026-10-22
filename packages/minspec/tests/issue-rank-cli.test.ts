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
import { runCli, parseIssuePages, loadOrder, type CliDeps } from '../../../scripts/rank-issues';
import { buildArtifactGraph } from '../src/lib/artifact-graph';
import { approveSpec } from '../src/lib/approval';
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
  const REPO = 'AIClarityAU/minspec';
  const here = (number: number) => ({ number, repository: { nameWithOwner: REPO } });
  const page = (nodes: unknown[], totalCount = nodes.length) => ({
    data: { repository: { issues: { totalCount, pageInfo: { hasNextPage: false, endCursor: null }, nodes } } },
  });
  const node = (number: number, over: Record<string, unknown> = {}) => ({
    number,
    title: `t${number}`,
    body: 'Blocked by #1',
    labels: { totalCount: 1, nodes: [{ name: 'agent-ready' }] },
    blockedBy: { totalCount: 1, nodes: [here(2)] },
    ...over,
  });

  it('flattens pages into records, including native blocked-by numbers', () => {
    const got = parseIssuePages(JSON.stringify([page([node(5)], 2), page([node(6, { body: null })], 2)]), REPO);
    expect(got.totalCount).toBe(2);
    expect(got.issues).toEqual([
      { number: 5, title: 't5', body: 'Blocked by #1', labels: ['agent-ready'], blockedBy: [2] },
      { number: 6, title: 't6', body: '', labels: ['agent-ready'], blockedBy: [2] },
    ]);
    expect(got.notes).toEqual([]);
  });

  it('notes nested truncation instead of hiding it', () => {
    const got = parseIssuePages(
      JSON.stringify([page([node(5, { blockedBy: { totalCount: 150, nodes: [here(2)] } })])]),
      REPO,
    );
    expect(got.notes.join('\n')).toMatch(/#5.*1 of 150/);
  });

  it('a native blocker in ANOTHER repository is not an edge from the local issue sharing its number', () => {
    // Broken implementation this catches: reading blockedBy by number alone, so
    // sealbox#55 blocking minspec#100 becomes minspec#55 -> #100 and minspec#55 jumps
    // the queue on term 1 for a relation it has no part in.
    const blockedBy = {
      totalCount: 2,
      nodes: [here(7), { number: 55, repository: { nameWithOwner: 'AIClarityAU/sealbox' } }],
    };
    const got = parseIssuePages(JSON.stringify([page([node(100, { blockedBy })])]), 'aiclarityau/MINSPEC');
    expect(got.issues[0].blockedBy).toEqual([7]); // same repo matches case-insensitively
    expect(got.notes.join('\n')).toMatch(/#100 blockedBy: AIClarityAU\/sealbox#55 .*not a local edge/);
  });

  it.each([
    ['not JSON', 'nope'],
    ['not an array', JSON.stringify(page([]))],
    ['an empty array', '[]'],
    // `data` is present and valid alongside `errors` (a field-level error nulls one
    // field, not the page), so only the errors check can make this throw.
    ['a GraphQL error beside valid data', JSON.stringify([{ ...page([node(5)]), errors: [{ message: 'Field blockedBy does not exist' }] }])],
    ['a blocker with no repository', JSON.stringify([page([node(5, { blockedBy: { totalCount: 1, nodes: [{ number: 2 }] } })])])],
    ['a missing repository', JSON.stringify([{ data: { repository: null } }])],
    ['a malformed node', JSON.stringify([page([{ number: 'five' }])])],
  ])('throws on %s', (_name, raw) => {
    expect(() => parseIssuePages(raw, REPO)).toThrow();
  });
});

// ─── The structural-order loader on a real workspace ─────────────────────────

type Kind = 'new' | 'specifying' | 'implementing' | 'done' | 'archived' | 'superseded';

/**
 * A MinSpec workspace whose specs reach the graph with the given DERIVED statuses.
 * buildArtifactGraph derives status from phases and the approval store and reads the
 * frontmatter `status:` line only for the human-set terminals, so each kind is built
 * the way it really arises: phases for new/specifying, a real approval for
 * implementing/done, the status line for archived/superseded.
 */
function statusWorkspace(root: string, kinds: Record<string, Kind>): void {
  const write = (rel: string, text: string): string => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
    return full;
  };
  const epic = (id: string, order: number) =>
    `---\nid: ${id}\nslug: ${id.toLowerCase()}\ntitle: ${id}\nstatus: active\norder: ${order}\n---\n\n# ${id}\n`;
  // SPEC-096: a MinSpec workspace is a folder that has opted in. The real approvals
  // below are recorded under `.minspec/`, which the approval store no longer creates.
  fs.mkdirSync(path.join(root, '.minspec'), { recursive: true });
  write('docs/epics/EPIC-001-a.md', epic('EPIC-001', 2));
  write('docs/epics/EPIC-002-b.md', epic('EPIC-002', 1));
  const EPIC: Record<string, string | undefined> = {
    'SPEC-001': 'EPIC-001',
    'SPEC-002': 'EPIC-002',
    'SPEC-003': 'EPIC-001',
    'SPEC-004': 'EPIC-002',
    'SPEC-005': undefined,
    'SPEC-006': 'EPIC-001',
  };
  const PHASES: Record<Kind, string> = {
    new: 'pending pending pending pending pending',
    specifying: 'in-progress pending pending pending pending',
    implementing: 'done done done done in-progress',
    done: 'done done done done done',
    archived: 'done done pending pending pending',
    superseded: 'done done pending pending pending',
  };
  for (const [id, kind] of Object.entries(kinds)) {
    const [specify, clarify, plan, tasks, implement] = PHASES[kind].split(' ');
    const status = kind === 'archived' || kind === 'superseded' ? kind : 'specifying';
    const file = write(
      `specs/p/${id}-x/requirements.md`,
      [
        '---',
        `id: ${id}`,
        'type: requirements',
        `status: ${status}`,
        'tier: T2',
        ...(EPIC[id] ? [`epic: ${EPIC[id]}`] : []),
        'phases:',
        `  specify: ${specify}`,
        `  clarify: ${clarify}`,
        `  plan: ${plan}`,
        `  tasks: ${tasks}`,
        `  implement: ${implement}`,
        '---',
        '',
        `# ${id}`,
        '',
      ].join('\n'),
    );
    if (kind === 'implementing' || kind === 'done') {
      approveSpec(root, file, 'T2', 'tester@example.com', () => new Date('2026-09-29T00:00:00.000Z'));
    }
  }
}

describe('loadOrder: the loader the drain ranks with is status-blind (INV-3)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-issues-order-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const IDS = ['SPEC-001', 'SPEC-002', 'SPEC-003', 'SPEC-004', 'SPEC-005', 'SPEC-006'];
  const KINDS: Kind[] = ['done', 'archived', 'implementing', 'superseded', 'specifying', 'new'];
  const assign = (kinds: readonly Kind[]) => Object.fromEntries(IDS.map((id, i) => [id, kinds[i]]));
  const workspace = (name: string, kinds: Record<string, Kind>): string => {
    const root = path.join(tmp, name);
    statusWorkspace(root, kinds);
    return root;
  };

  it('identical order whatever the specs\' derived statuses', () => {
    // Broken implementations this catches, each measured to survive the earlier suite:
    // dropping `done` specs, putting unfinished specs first, and dropping
    // archived/superseded ones — any filter or key on status placed in loadOrder.
    const reference = workspace('all-new', assign(IDS.map(() => 'new')));
    const mixed = workspace('mixed', assign(KINDS));
    const rotated = workspace('rotated', assign([...KINDS.slice(3), ...KINDS.slice(0, 3)]));

    // CONTROL: the fixture really reaches the graph with six distinct statuses. Without
    // this, a fixture whose status lines never reach the graph (the e2e one did exactly
    // that) passes against a status-keyed loader.
    const derived = Object.fromEntries(buildArtifactGraph(mixed).specs.map((sp) => [sp.id, sp.status]));
    expect(new Set(Object.values(derived)).size).toBeGreaterThanOrEqual(5);
    expect(derived).toMatchObject({ 'SPEC-001': 'done', 'SPEC-002': 'archived', 'SPEC-004': 'superseded' });

    const ref = loadOrder(reference);
    const bySlot = [...ref.spec.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    expect(bySlot).toEqual(['SPEC-002', 'SPEC-004', 'SPEC-001', 'SPEC-003', 'SPEC-006', 'SPEC-005']);
    for (const root of [mixed, rotated]) {
      const o = loadOrder(root);
      expect(o.size).toBe(ref.size);
      expect([...o.spec.entries()].sort()).toEqual([...ref.spec.entries()].sort());
      expect([...o.epic.entries()].sort()).toEqual([...ref.epic.entries()].sort());
    }
  });

  it('refuses a root with no specs rather than ranking with the spec term silently off', () => {
    // buildArtifactGraph degrades to an empty graph on a misconfigured root; ranked on
    // that, every candidate loses term 2 and the ranker still exits 0.
    fs.mkdirSync(path.join(tmp, 'empty'));
    expect(() => loadOrder(path.join(tmp, 'empty'))).toThrow(/no specs found/);
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
    // SPEC-002 is ARCHIVED — a status line the graph does read (the human-set terminals
    // are the only ones it takes from frontmatter) — and still ranks first, because its
    // epic is ordered first. A `done`/`implementing` line would prove nothing here: the
    // graph derives those from phases and approvals, so both specs would reach it as
    // `new`. The loadOrder block above covers every derived status.
    fs.writeFileSync(path.join(root, 'specs', 'p', 'SPEC-001-a', 'requirements.md'), spec('SPEC-001', 'EPIC-001', 'specifying'));
    fs.writeFileSync(
      path.join(root, 'specs', 'p', 'SPEC-002-b', 'requirements.md'),
      spec('SPEC-002', 'EPIC-002', 'archived'),
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
