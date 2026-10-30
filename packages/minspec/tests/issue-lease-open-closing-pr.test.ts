/**
 * #3161 — the dispatch gate refuses an issue that an OPEN PR already closes, whatever the
 * PR's branch name (#3116 was `fix/3115-…`, not `agent/issue-3115`) or author. Runs the real
 * lease_gate_open_unshipped with a stub `gh` on PATH.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const LEASE = path.resolve(__dirname, '../../../scripts/lib/issue-lease.sh');
let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lease-closing-pr-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

type Pr = { number: number; authorAssociation?: string; author?: object | null; refs?: number[]; refsTruncated?: boolean };
const node = (p: Pr) => ({
  number: p.number,
  authorAssociation: p.authorAssociation ?? 'NONE',
  author: p.author ?? null,
  closingIssuesReferences: { pageInfo: { hasNextPage: !!p.refsTruncated }, nodes: (p.refs ?? []).map((n) => ({ number: n, repository: { nameWithOwner: 'x/y' } })) },
});
const page = (prs: Pr[], more = false) =>
  JSON.stringify({ data: { repository: { pullRequests: { pageInfo: { hasNextPage: more, endCursor: more ? 'C' : null }, nodes: prs.map(node) } } } });

/** `pages[0]` answers the first call, `pages[1]` the call that carries a cursor. */
function gate(opts: { pages?: string[]; graphqlFails?: boolean; issue?: number }) {
  (opts.pages ?? [page([])]).forEach((b, i) => fs.writeFileSync(path.join(tmp, `page${i}.json`), b));
  const stub = [
    '#!/usr/bin/env bash',
    'case "$1 $2" in',
    '  "issue view")',
    '    if [[ "$*" == *"--json state"* ]]; then echo OPEN; else echo \'{"comments":[]}\'; fi ;;',
    // `gh pr list --json` has no authorAssociation field: the real command exits non-zero. The gate must not use it.
    '  "pr list") echo "unknown JSON field" >&2; exit 1 ;;',
    '  "api graphql")',
    opts.graphqlFails ? '    exit 1 ;;' : `    if [[ "$*" == *"cursor="* ]]; then cat ${JSON.stringify(path.join(tmp, 'page1.json'))}; else cat ${JSON.stringify(path.join(tmp, 'page0.json'))}; fi ;;`,
    '  *) exit 1 ;;',
    'esac',
  ].join('\n');
  const bin = path.join(tmp, 'gh');
  fs.writeFileSync(bin, stub, { mode: 0o755 });
  const r = spawnSync('bash', ['-c', `source ${JSON.stringify(LEASE)}; lease_gate_open_unshipped ${opts.issue ?? 3115}`], {
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${tmp}:${process.env.PATH}`, MINSPEC_LEASE_REPO: 'x/y' },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('lease_gate_open_unshipped: open closing PR (#3161)', () => {
  const APP = { __typename: 'Bot', login: 'minspec-sdd', databaseId: 299695933 };
  it('refuses when a collaborator PR closes the issue, and names it', () => {
    const r = gate({ pages: [page([{ number: 3116, authorAssociation: 'OWNER', refs: [3115] }])] });
    expect(r.status).toBe(1);
    expect(r.out).toContain('#3116');
  });
  it('refuses when the pipeline App (by account id) opened the closing PR', () => {
    const r = gate({ pages: [page([{ number: 3116, authorAssociation: 'CONTRIBUTOR', author: APP, refs: [3115] }])] });
    expect(r.status).toBe(1);
  });
  it('ignores a closing PR from an untrusted author, including a lookalike App login', () => {
    for (const who of [
      { authorAssociation: 'NONE', author: { __typename: 'User', login: 'rando', databaseId: 5 } },
      { authorAssociation: 'FIRST_TIME_CONTRIBUTOR', author: { __typename: 'User', login: 'minspec-sdd', databaseId: 6 } },
      { author: { __typename: 'Bot', login: 'minspec-sdd', databaseId: 1 } },
      { author: null },
    ]) {
      expect(gate({ pages: [page([{ number: 77, refs: [3115], ...who }])] }).status).toBe(0);
    }
  });
  it('does not treat an issue of the same number in another repo as this one', () => {
    const body = JSON.parse(page([{ number: 9, authorAssociation: 'OWNER', refs: [3115] }]));
    body.data.repository.pullRequests.nodes[0].closingIssuesReferences.nodes[0].repository.nameWithOwner = 'other/repo';
    expect(gate({ pages: [JSON.stringify(body)] }).status).toBe(0);
  });
  it('reads the next page: a closing PR on page 2 is found', () => {
    const r = gate({ pages: [page([{ number: 1 }], true), page([{ number: 3116, authorAssociation: 'MEMBER', refs: [3115] }])] });
    expect(r.status).toBe(1);
    expect(r.out).toContain('#3116');
  });
  it('fails closed when the list never ends (cap)', () => {
    expect(gate({ pages: [page([{ number: 1 }], true), page([{ number: 2 }], true)] }).status).toBe(1);
  });
  it('fails closed when a PR closing list is itself truncated', () => {
    expect(gate({ pages: [page([{ number: 1, authorAssociation: 'OWNER', refsTruncated: true }])] }).status).toBe(1);
  });
  it('fails closed on a GraphQL errors payload', () => {
    expect(gate({ pages: [JSON.stringify({ errors: [{ message: 'boom' }], data: null })] }).status).toBe(1);
  });
  it('allows when open PRs close other issues only', () => {
    const r = gate({ pages: [page([{ number: 9, authorAssociation: 'OWNER', refs: [1] }, { number: 10 }])] });
    expect(r.status).toBe(0);
  });
  it('allows when there are no open PRs', () => {
    expect(gate({ pages: [page([])] }).status).toBe(0);
  });
  it('fails closed, visibly, when the PR list cannot be read', () => {
    const r = gate({ graphqlFails: true });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/fail closed/);
  });
  it('fails closed on unparseable PR output', () => {
    expect(gate({ pages: ['not json'] }).status).toBe(1);
  });
});
