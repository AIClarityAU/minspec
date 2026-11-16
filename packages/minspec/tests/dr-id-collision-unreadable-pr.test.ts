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

/**
 * World: base holds DR-001. Subject PR 100 adds `subjectFile`. Open PRs 200 (readable,
 * adds `readableFile`) and 300 (diff unrenderable: the batched query AND its REST
 * listing both 500). `subjectBroken` makes PR 100's own listing 500.
 */
function world(opts: { subjectFile: string; readableFile: string; subjectBroken?: boolean }): string {
  const added = (f: string) => `[[{"filename":"${f}","status":"added"}]]`;
  const subject = opts.subjectBroken
    ? `echo '${ERR500}' >&2 ; exit 1`
    : `echo '${added(opts.subjectFile)}'`;
  return `#!/bin/sh
argv="$*"
case "$argv" in
  *"contents/specs?ref=main"*) echo '[[{"type":"dir","path":"specs/minspec"}]]' ;;
  *"contents/specs/minspec?ref=main"*) echo '[[{"type":"dir","path":"specs/minspec/SPEC-231-a"}]]' ;;
  *"pulls/100/files"*) ${subject} ;;
  *"pulls/200/files"*) echo '${added(opts.readableFile)}' ;;
  *"pulls/300/files"*) echo '${ERR500}' >&2 ; exit 1 ;;
  *"contents/docs/decisions?ref="*) echo '[[{"path":"docs/decisions/DR-001-a.md","type":"file"}]]' ;;
  *"files(first"*) echo '${ERR500}' >&2 ; exit 1 ;;
  *"graphql"*) echo '{"data":{"repository":{"pullRequests":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"number":100},{"number":200},{"number":300}]}}}}' ;;
  *) echo "unexpected gh call: $argv" >&2 ; exit 1 ;;
esac
`;
}

describe('#3791 — one unrenderable open PR does not fail every PR', () => {
  it('passes, and names the unreadable PR, when only ANOTHER PR cannot be read', () => {
    const r = runCli(world({ subjectFile: 'docs/decisions/DR-010-x.md', readableFile: 'docs/decisions/DR-020-y.md' }));
    expect(r.out).toMatch(/open PR #300 is unreadable/);
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
