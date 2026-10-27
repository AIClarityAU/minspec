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

function gate(opts: { prs: string; prFails?: boolean; issue?: number }) {
  fs.writeFileSync(path.join(tmp, 'prs.json'), opts.prs);
  const stub = [
    '#!/usr/bin/env bash',
    'case "$1 $2" in',
    '  "issue view")',
    '    if [[ "$*" == *"--json state"* ]]; then echo OPEN; else echo \'{"comments":[]}\'; fi ;;',
    '  "pr list")',
    opts.prFails ? '    exit 1 ;;' : `    cat ${JSON.stringify(path.join(tmp, 'prs.json'))} ;;`,
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
  it('refuses when a non-agent/ branch PR closes the issue, and names it', () => {
    const r = gate({ prs: JSON.stringify([{ number: 3116, closingIssuesReferences: [{ number: 3115 }] }]) });
    expect(r.status).toBe(1);
    expect(r.out).toContain('#3116');
  });
  it('allows when open PRs close other issues only', () => {
    const r = gate({ prs: JSON.stringify([{ number: 9, closingIssuesReferences: [{ number: 1 }] }, { number: 10, closingIssuesReferences: [] }]) });
    expect(r.status).toBe(0);
  });
  it('allows when there are no open PRs', () => {
    expect(gate({ prs: '[]' }).status).toBe(0);
  });
  it('fails closed, visibly, when the PR list cannot be read', () => {
    const r = gate({ prs: '[]', prFails: true });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/fail closed/);
  });
  it('fails closed on unparseable PR output', () => {
    expect(gate({ prs: 'not json' }).status).toBe(1);
  });
});
