/**
 * `.githooks/pre-commit` — template-version gate (#1989).
 *
 * The gap this closes: `packages/minspec/src/lib/template-registry.ts` (and its
 * generated modules `ci-review-templates.ts` / `hook-templates.ts`) is the source
 * of EVERY artifact MinSpec scaffolds into an adopter's repo, but nothing coupled
 * a change there to a bump of `packages/minspec/package.json`'s "version". VS Code
 * keys an install on `publisher.name@version`, so two builds that both call
 * themselves the same version are not reliably distinguishable — reinstalling the
 * newer one over the older can silently no-op, leaving stale templates resident
 * with no error. That happened for real on 2026-09-11 (0222fdd9, #1778): the
 * scaffolded CLAUDE.md's Author-identity-gate section changed and the version did
 * not move.
 *
 * These tests run the REAL `.githooks/pre-commit` (core.hooksPath points straight
 * at it) — asserting on the hook's source text would pass against a gate that
 * never runs, the standing lesson from the secret-gate suite.
 *
 * The last case is the #1040 lesson as a standing control: a per-gate bypass must
 * scope to ITS OWN gate and never fall through as a whole-hook `exit 0`.
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

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-tmpl-ver-gate-')));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const write = (rel: string, body: string) => {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};

function writeMinspecPackageJson(version: string): void {
  write(
    'packages/minspec/package.json',
    JSON.stringify({ name: 'minspec', publisher: 'aiclarity', version }, null, 2) + '\n',
  );
}

/** A repo with an initial commit carrying a template file + minspec package.json. */
function initRepo(version = '0.1.26'): void {
  const git = (args: string[]) => execFileSync('git', args, { cwd: tmp, stdio: 'pipe' });
  // No remote, so the protected-branch guard correctly stays out of the way and
  // these assertions are about the template-version gate alone.
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@minspec.test']);
  git(['config', 'user.name', 'MinSpec Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'core.hooksPath', REAL_HOOKS_DIR]);

  writeMinspecPackageJson(version);
  write('packages/minspec/src/lib/template-registry.ts', 'export const FOO = "bar";\n');
  write('packages/minspec/src/lib/ci-review-templates.ts', 'export const CI = "x";\n');
  write('packages/minspec/src/lib/hook-templates.ts', 'export const HOOK = "y";\n');
  write('packages/minspec/src/lib/unrelated.ts', 'export const UNRELATED = 1;\n');
  git(['add', '.']);
  execFileSync('git', ['commit', '-m', 'chore: initial'], {
    cwd: tmp,
    stdio: 'pipe',
    env: { ...process.env, RCDD_GATE_OFF: '1' },
  });
}

const stage = (...files: string[]) =>
  execFileSync('git', ['add', ...files], { cwd: tmp, stdio: 'pipe' });

function commit(env: Record<string, string> = {}): { code: number; out: string } {
  const r = spawnSync('git', ['commit', '-m', 'test'], {
    cwd: tmp,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { code: r.status ?? 1, out: `${r.stderr ?? ''}${r.stdout ?? ''}` };
}

/** A failing `gitleaks`, to prove one gate's bypass does not disable another. */
function stubFailingGitleaks(): string {
  const dir = path.join(tmp, '.stub-bin');
  fs.mkdirSync(dir, { recursive: true });
  const stub = path.join(dir, 'gitleaks');
  fs.writeFileSync(stub, `#!/bin/sh\necho 'RuleID: generic-api-key'\nexit 1\n`);
  fs.chmodSync(stub, 0o755);
  return `${dir}${path.delimiter}${process.env.PATH ?? ''}`;
}

describe('.githooks/pre-commit template-version gate (#1989)', () => {
  it('BLOCKS a commit editing template-registry.ts without bumping packages/minspec/package.json', () => {
    initRepo();
    write('packages/minspec/src/lib/template-registry.ts', 'export const FOO = "changed";\n');
    stage('packages/minspec/src/lib/template-registry.ts');

    const r = commit();

    expect(r.code).not.toBe(0);
    expect(r.out).toContain('template-version gate');
    // Nothing new was committed — still just the initial commit from initRepo().
    const log = execFileSync('git', ['log', '--oneline'], { cwd: tmp, encoding: 'utf8' });
    expect(log.trim().split('\n')).toHaveLength(1);
  });

  it('BLOCKS a commit editing a generated template module (ci-review-templates.ts) without a bump', () => {
    initRepo();
    write('packages/minspec/src/lib/ci-review-templates.ts', 'export const CI = "changed";\n');
    stage('packages/minspec/src/lib/ci-review-templates.ts');

    const r = commit();

    expect(r.code).not.toBe(0);
    expect(r.out).toContain('template-version gate');
  });

  it('BLOCKS even when package.json is staged but "version" itself did not change', () => {
    initRepo();
    write('packages/minspec/src/lib/hook-templates.ts', 'export const HOOK = "changed";\n');
    // Touch package.json without bumping version (e.g. a dependency edit).
    write(
      'packages/minspec/package.json',
      JSON.stringify({ name: 'minspec', publisher: 'aiclarity', version: '0.1.26', extra: true }, null, 2) + '\n',
    );
    stage('packages/minspec/src/lib/hook-templates.ts', 'packages/minspec/package.json');

    const r = commit();

    expect(r.code).not.toBe(0);
    expect(r.out).toContain('template-version gate');
  });

  it('ALLOWS a commit that bumps the version alongside the template change', () => {
    initRepo('0.1.26');
    write('packages/minspec/src/lib/template-registry.ts', 'export const FOO = "changed";\n');
    writeMinspecPackageJson('0.1.27');
    stage('packages/minspec/src/lib/template-registry.ts', 'packages/minspec/package.json');

    const r = commit();

    expect(r.out).not.toContain('✖ template-version gate');
    expect(r.code).toBe(0);
  });

  it('does not fire at all when the commit touches neither the template source nor its generated modules', () => {
    initRepo();
    write('packages/minspec/src/lib/unrelated.ts', 'export const UNRELATED = 2;\n');
    stage('packages/minspec/src/lib/unrelated.ts');

    const r = commit();

    expect(r.code).toBe(0);
    expect(r.out).not.toContain('template-version gate');
  });

  it('TEMPLATE_VERSION_GATE_OFF scopes to its own gate and does not disable the secret gate (#1040, invariant 2)', () => {
    initRepo();
    write('packages/minspec/src/lib/template-registry.ts', 'export const FOO = "changed";\n');
    stage('packages/minspec/src/lib/template-registry.ts');

    const r = commit({ TEMPLATE_VERSION_GATE_OFF: '1', PATH: stubFailingGitleaks() });

    // The template-version gate is off...
    expect(r.out).not.toContain('✖ template-version gate');
    // ...but the unrelated secret gate still fires.
    expect(r.out).toContain('secret gate');
    expect(r.code).not.toBe(0);
  });
});
