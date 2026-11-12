/**
 * `.githooks/pre-commit` — generated-template gate (#3546).
 *
 * Runs the REAL hook against a throwaway repo whose `scripts/gen-ci-templates.mjs`
 * is a minimal stand-in: it exports the same two path lists the hook reads and
 * honours `--check` (exit 1 while a marker file says "stale"). The hook wiring is
 * what is under test: staged source + stale → blocked with the regenerate command;
 * unrelated staged path → untouched; fresh → allowed; unreadable list → fail closed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const REAL_HOOKS_DIR = path.resolve(__dirname, '../../../.githooks');
let tmp: string;

const write = (rel: string, body: string) => {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};
const git = (args: string[]) => execFileSync('git', args, { cwd: tmp, stdio: 'pipe' });

const GENERATOR = `
import { existsSync } from 'node:fs';
export const CI_TEMPLATE_SOURCE_PATHS = ['scripts/copied-source.sh'];
export const CI_TEMPLATE_OUTPUT_PATHS = ['out/generated.ts'];
if (process.argv[1] && process.argv[1].endsWith('gen-ci-templates.mjs') && process.argv.includes('--check')) {
  if (existsSync('STALE')) { console.error('STALE: out/generated.ts'); process.exit(1); }
}
`;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-gen-gate-')));
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@minspec.test']);
  git(['config', 'user.name', 'MinSpec Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'core.hooksPath', REAL_HOOKS_DIR]);
  write('scripts/gen-ci-templates.mjs', GENERATOR);
  write('scripts/copied-source.sh', '#!/bin/sh\n');
  write('other.txt', 'a\n');
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function commit(env: Record<string, string> = {}): { code: number; out: string } {
  const r = spawnSync('git', ['commit', '-m', 'test'], {
    cwd: tmp,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { code: r.status ?? 1, out: `${r.stderr ?? ''}${r.stdout ?? ''}` };
}

describe('pre-commit generated-template gate (#3546)', () => {
  it('blocks a staged generator source while the generated file is stale, naming the regenerate command', () => {
    write('STALE', '');
    git(['add', 'scripts/copied-source.sh', 'scripts/gen-ci-templates.mjs']);
    const r = commit();
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('node scripts/gen-ci-templates.mjs');
  });

  it('still blocks when the staged list overflows the pipe buffer and the source sorts first (no SIGPIPE bypass)', () => {
    // `git diff --cached --name-only | grep -q` under pipefail exits 141 once grep quits on
    // an early match with output still pending, which silently skipped the gate.
    write('STALE', '');
    const dir = 'zz-bulk-' + 'x'.repeat(80);
    const bulk: string[] = [];
    for (let i = 0; i < 1500; i++) bulk.push(`${dir}/f${String(i).padStart(5, '0')}.txt`);
    for (const f of bulk) write(f, 'a\n');
    expect(bulk.join('\n').length).toBeGreaterThan(128 * 1024);
    git(['add', 'scripts/copied-source.sh', 'scripts/gen-ci-templates.mjs', dir]);
    const r = commit();
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('node scripts/gen-ci-templates.mjs');
  });

  it('allows a staged generator source when the generated file is fresh', () => {
    git(['add', 'scripts/copied-source.sh', 'scripts/gen-ci-templates.mjs']);
    expect(commit().code).toBe(0);
  });

  it('ignores a commit that stages no generator source, even while stale', () => {
    write('STALE', '');
    git(['add', 'other.txt']);
    expect(commit().code).toBe(0);
  });

  it('fails closed when the generator source list cannot be read', () => {
    write('scripts/gen-ci-templates.mjs', 'throw new Error("boom");\n');
    git(['add', 'scripts/gen-ci-templates.mjs', 'other.txt']);
    const r = commit();
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('Failing closed');
  });

  it('GEN_CI_TEMPLATES_GATE_OFF=1 bypasses only this gate', () => {
    write('STALE', '');
    git(['add', 'scripts/copied-source.sh', 'scripts/gen-ci-templates.mjs']);
    expect(commit({ GEN_CI_TEMPLATES_GATE_OFF: '1' }).code).toBe(0);
  });
});
