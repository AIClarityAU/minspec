/**
 * T3 regression for #3791: one open PR whose diff GitHub cannot render (HTTP 500
 * "this diff is temporarily unavailable") failed the "DR id uniqueness" check on EVERY
 * PR, because the batched GraphQL file listing made GitHub render all diffs at once.
 *
 * Properties pinned (stub `gh` via DR_ID_GH_BIN, no network):
 *   1. an unreadable OTHER PR is reported and skipped, not a red;
 *   2. a real collision with a READABLE other PR still fails;
 *   3. the PR under test being unreadable still fails closed.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'scripts', 'check-dr-id-collision.ts');
const ERR500 =
  'gh: Server Error: Sorry, this diff is temporarily unavailable due to heavy server load. (HTTP 500)';

function runCli(script: string): { status: number; out: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-3791-'));
  const bin = path.join(tmp, 'gh');
  fs.writeFileSync(bin, script, { mode: 0o755 });
  try {
    const out = execFileSync(
      'npx',
      ['tsx', CLI, '--repo', 'AIClarityAU/minspec', '--pr', '100', '--base', 'main'],
      {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        env: { ...process.env, DR_ID_GH_BIN: bin, GITHUB_ACTIONS: '', DR_ID_RATE_LIMIT_MAX_WAIT_MS: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const ERR403 = 'gh: Resource not accessible by integration (HTTP 403)';
const ERR502 = 'gh: Bad Gateway (HTTP 502)';
const ERRNET = 'error connecting to api.github.com';

type Others = Record<number, string>; // PR number -> added file, or a stderr message that makes it fail

/**
 * World: base holds DR-001. Subject PR 100 adds `subjectFile`. `others` maps each other
 * open PR to the DR file it adds, or to an error line (its REST listing exits 1 with
 * that stderr). The batched GraphQL query always fails with the unrenderable-diff 500,
 * forcing the per-PR path. `subjectBroken` makes PR 100's own listing 500.
 */
function worldOf(opts: { subjectFile: string; others: Others; subjectBroken?: boolean }): string {
  const added = (f: string) => `[[{"filename":"${f}","status":"added"}]]`;
  const subject = opts.subjectBroken
    ? `echo '${ERR500}' >&2 ; exit 1`
    : `echo '${added(opts.subjectFile)}'`;
  const nums = [100, ...Object.keys(opts.others).map(Number)].map((n) => `{"number":${n}}`).join(',');
  const cases = Object.entries(opts.others)
    .map(([n, v]) =>
      v.startsWith('docs/')
        ? `  *"pulls/${n}/files"*) echo '${added(v)}' ;;`
        : `  *"pulls/${n}/files"*) echo '${v}' >&2 ; exit 1 ;;`,
    )
    .join('\n');
  return `#!/bin/sh
argv="$*"
case "$argv" in
  *"contents/specs?ref=main"*) echo '[[{"type":"dir","path":"specs/minspec"}]]' ;;
  *"contents/specs/minspec?ref=main"*) echo '[[{"type":"dir","path":"specs/minspec/SPEC-231-a"}]]' ;;
  *"pulls/100/files"*) ${subject} ;;
${cases}
  *"contents/docs/decisions?ref="*) echo '[[{"path":"docs/decisions/DR-001-a.md","type":"file"}]]' ;;
  *"files(first"*) echo '${ERR500}' >&2 ; exit 1 ;;
  *"graphql"*) echo '{"data":{"repository":{"pullRequests":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[${nums}]}}}}' ;;
  *) echo "unexpected gh call: $argv" >&2 ; exit 1 ;;
esac
`;
}

/** Back-compat shape: readable PR 200 plus unreadable PR 300 (unrenderable diff). */
function world(opts: { subjectFile: string; readableFile: string; subjectBroken?: boolean }): string {
  return worldOf({
    subjectFile: opts.subjectFile,
    subjectBroken: opts.subjectBroken,
    others: { 200: opts.readableFile, 300: ERR500 },
  });
}

describe('#3791 — one unrenderable open PR does not fail every PR', () => {
  it('passes, and names the unreadable PR, when only ANOTHER PR cannot be read', () => {
    const r = runCli(world({ subjectFile: 'docs/decisions/DR-010-x.md', readableFile: 'docs/decisions/DR-020-y.md' }));
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/open PR #300 is unreadable/);
  });

  it('still FAILS a real collision with a readable other PR', () => {
    const r = runCli(world({ subjectFile: 'docs/decisions/DR-020-x.md', readableFile: 'docs/decisions/DR-020-y.md' }));
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('DR-020');
  });

  it('still FAILS a real collision with main while another PR is unreadable', () => {
    const r = runCli(world({ subjectFile: 'docs/decisions/DR-001-z.md', readableFile: 'docs/decisions/DR-020-y.md' }));
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('DR-001');
  });

  it('FAILS CLOSED when the PR under test is the unreadable one', () => {
    const r = runCli(
      world({ subjectFile: 'docs/decisions/DR-010-x.md', readableFile: 'docs/decisions/DR-020-y.md', subjectBroken: true }),
    );
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/FAILED CLOSED/);
  });
});

describe('#3791 — only the unrenderable-diff signature is tolerated (fail closed otherwise)', () => {
  const sub = 'docs/decisions/DR-010-x.md';

  it('FAILS CLOSED when another PR listing returns 403', () => {
    const r = runCli(worldOf({ subjectFile: sub, others: { 200: 'docs/decisions/DR-020-y.md', 300: ERR403 } }));
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toMatch(/FAILED CLOSED/);
  });

  it('FAILS CLOSED when another PR listing returns 502', () => {
    const r = runCli(worldOf({ subjectFile: sub, others: { 200: 'docs/decisions/DR-020-y.md', 300: ERR502 } }));
    expect(r.status, r.out).not.toBe(0);
  });

  it('FAILS CLOSED on a network error reading another PR', () => {
    const r = runCli(worldOf({ subjectFile: sub, others: { 200: 'docs/decisions/DR-020-y.md', 300: ERRNET } }));
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toMatch(/FAILED CLOSED/);
  });

  it('FAILS CLOSED when EVERY other open PR is unreadable (500)', () => {
    const r = runCli(worldOf({ subjectFile: sub, others: { 300: ERR500, 301: ERR500 } }));
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toMatch(/FAILED CLOSED/);
  });

  it('FAILS CLOSED when more than 3 other PRs are unreadable', () => {
    const others: Others = { 200: 'docs/decisions/DR-020-y.md', 201: 'docs/decisions/DR-021-y.md' };
    for (const n of [300, 301, 302, 303]) others[n] = ERR500;
    const r = runCli(worldOf({ subjectFile: sub, others }));
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toMatch(/FAILED CLOSED/);
  });

  it('PASSES with a warning when one of many other PRs is unreadable (500)', () => {
    const others: Others = { 300: ERR500 };
    for (let i = 0; i < 9; i++) others[200 + i] = `docs/decisions/DR-0${30 + i}-y.md`;
    const r = runCli(worldOf({ subjectFile: sub, others }));
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/open PR #300 is unreadable/);
  });
});
