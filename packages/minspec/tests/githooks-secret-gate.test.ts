/**
 * `.githooks/pre-commit` — this repo must run the secret gate it ships (#1583).
 *
 * The gap this closes: MinSpec scaffolds a gitleaks pre-commit gate into every
 * project it initializes, but its own live hook (`core.hooksPath=.githooks`) ran
 * no secret scan at all, and no workflow did either. So the one loop that would
 * have caught #1514 — a scaffolded file that MinSpec's own gate was guaranteed to
 * reject, which every adopter hit on their first commit — was switched off by
 * construction here, and the defect reached adopters instead.
 *
 * These tests run the REAL `.githooks/pre-commit` (core.hooksPath points straight
 * at it) with a STUBBED `gitleaks` on PATH. Asserting on the hook's source text
 * would pass against a gate that never runs, and the stub keeps the result
 * deterministic on CI, where gitleaks is not installed.
 *
 * The last case is the #1040 lesson as a standing control: a per-gate bypass must
 * scope to ITS OWN gate and never fall through as a whole-hook `exit 0`. That is
 * constitution invariant 2 (no silent gate) — the exact defect #1040 fixed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const REAL_HOOKS_DIR = path.resolve(__dirname, '../../../.githooks');

/** The redacted shape real gitleaks emits: rule id, file and line, value masked. */
const STUB_FINDING = [
  'Finding:     example_key="REDACTED"',
  'Secret:      REDACTED',
  'RuleID:      generic-api-key',
  'File:        scripts/example.sh',
  'Line:        197',
].join('\n');

let tmp: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-secret-gate-')));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function initRepoWithRealHook(): void {
  const git = (args: string[]) => execFileSync('git', args, { cwd: tmp, stdio: 'pipe' });
  // No remote: the protected-branch guard correctly stays out of the way, so these
  // assertions are about the secret gate alone.
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@minspec.test']);
  git(['config', 'user.name', 'MinSpec Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'core.hooksPath', REAL_HOOKS_DIR]);
}

/** Install a fake `gitleaks`; returns a PATH that finds it first. */
function stubGitleaks(exitCode: number, output = ''): string {
  const dir = path.join(tmp, '.stub-bin');
  fs.mkdirSync(dir, { recursive: true });
  const stub = path.join(dir, 'gitleaks');
  fs.writeFileSync(
    stub,
    `#!/bin/sh\ncat <<'MINSPEC_STUB_EOF'\n${output}\nMINSPEC_STUB_EOF\nexit ${exitCode}\n`,
  );
  fs.chmodSync(stub, 0o755);
  return `${dir}${path.delimiter}${process.env.PATH ?? ''}`;
}

/** PATH with the directory holding a real `gitleaks` removed. */
function pathWithoutGitleaks(): string {
  let realDir: string | undefined;
  try {
    realDir = path.dirname(
      execFileSync('sh', ['-c', 'command -v gitleaks'], { encoding: 'utf8' }).trim(),
    );
  } catch {
    realDir = undefined;
  }
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter((p) => p && p !== realDir)
    .join(path.delimiter);
}

function stageFile(name = 'change.txt'): void {
  fs.writeFileSync(path.join(tmp, name), 'content\n');
  execFileSync('git', ['add', name], { cwd: tmp, stdio: 'pipe' });
}

/** Stage a symlink straight into the index (mirrors githooks-adr-bypass-scope). */
function stageSymlink(linkpath: string, target: string): void {
  const sha = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: tmp, input: target })
    .toString()
    .trim();
  execFileSync('git', ['update-index', '--add', '--cacheinfo', `120000,${sha},${linkpath}`], {
    cwd: tmp,
    stdio: 'pipe',
  });
}

function commit(env: Record<string, string> = {}): { code: number; out: string } {
  const r = spawnSync('git', ['commit', '-m', 'test'], {
    cwd: tmp,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { code: r.status ?? 1, out: `${r.stderr ?? ''}${r.stdout ?? ''}` };
}

describe('.githooks/pre-commit secret gate — run the gate we ship (#1583)', () => {
  it('BLOCKS a commit whose staged changes trip gitleaks', () => {
    initRepoWithRealHook();
    stageFile();
    const r = commit({ PATH: stubGitleaks(1, STUB_FINDING) });

    expect(r.code).not.toBe(0);
    expect(r.out).toContain('secret gate');
    expect(() => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmp, stdio: 'pipe' })).toThrow();
  });

  it('shows the finding — rule, file and line — not just a refusal', () => {
    initRepoWithRealHook();
    stageFile();
    const r = commit({ PATH: stubGitleaks(1, STUB_FINDING) });

    expect(r.out).toContain('generic-api-key');
    expect(r.out).toContain('scripts/example.sh');
    expect(r.out).toContain('197');
  });

  it('a clean scan is silent and the commit lands', () => {
    initRepoWithRealHook();
    stageFile();
    const r = commit({ PATH: stubGitleaks(0) });

    expect(r.code).toBe(0);
    expect(r.out).not.toContain('secret gate: gitleaks found');
  });

  it('degrades gracefully: no gitleaks installed warns but never wedges the commit', () => {
    initRepoWithRealHook();
    stageFile();
    const r = commit({ PATH: pathWithoutGitleaks() });

    expect(r.code).toBe(0);
    expect(r.out).toContain('gitleaks not installed');
  });

  it('SECRET_GATE_OFF=1 bypasses this gate', () => {
    initRepoWithRealHook();
    stageFile();
    const r = commit({ PATH: stubGitleaks(1, STUB_FINDING), SECRET_GATE_OFF: '1' });

    expect(r.code).toBe(0);
  });

  it('CONTROL (#1040): SECRET_GATE_OFF must not bypass any OTHER gate', () => {
    initRepoWithRealHook();
    // The symlink gate's own defect: an absolute-target symlink must still be
    // refused while the secret gate is explicitly switched off. A per-gate bypass
    // that reaches past its own gate is the silent-gate failure invariant 2 forbids.
    stageSymlink('bad-link', '/etc/passwd');
    const r = commit({ PATH: stubGitleaks(1, STUB_FINDING), SECRET_GATE_OFF: '1' });

    expect(r.code).not.toBe(0);
    expect(r.out).toContain('symlink');
  });
});
