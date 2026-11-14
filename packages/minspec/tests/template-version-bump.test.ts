/**
 * #1989 — shipped template edits must bump the extension version.
 * Unit half pins the predicate; T0 half runs the real script against a throwaway git repo.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  checkTemplateVersionBump,
  readVersion,
  VERSION_FILE,
  VIOLATION_EXIT_CODE,
} from '../../../scripts/lib/template-version-bump';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const REG = 'packages/minspec/src/lib/template-registry.ts';

describe('checkTemplateVersionBump', () => {
  it('passes when no template file changed', () => {
    expect(checkTemplateVersionBump(['README.md'], '0.1.26', '0.1.26').ok).toBe(true);
  });
  it('fails when a template changed and the version is unchanged', () => {
    const v = checkTemplateVersionBump([REG], '0.1.26', '0.1.26');
    expect(v.ok).toBe(false);
    expect(v.touched).toEqual([REG]);
  });
  it('covers slash-command guidance and ownership-rule sources (interpolated into scaffolds)', () => {
    for (const f of ['packages/minspec/src/lib/slash-commands.ts', 'packages/minspec/src/lib/ownership-path-rules.ts']) {
      expect(checkTemplateVersionBump([f], '0.1.26', '0.1.26').ok).toBe(false);
    }
  });
  it('passes when a template changed and the version moved', () => {
    expect(checkTemplateVersionBump([REG], '0.1.26', '0.1.27').ok).toBe(true);
  });
  it('fails closed on an unreadable version', () => {
    expect(checkTemplateVersionBump([REG], null, '0.1.27').ok).toBe(false);
    expect(readVersion('not json')).toBeNull();
    expect(readVersion('{"version":"1.2.3"}')).toBe('1.2.3');
  });
});

describe('check-template-version-bump script (T0)', () => {
  const script = path.join(process.cwd(), 'scripts', 'check-template-version-bump.ts');
  const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');

  function repo(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tvb-'));
    const g = (...a: string[]) =>
      execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...a], { cwd: d, stdio: 'pipe' });
    g('init', '-q', '-b', 'main');
    fs.mkdirSync(path.join(d, path.dirname(REG)), { recursive: true });
    fs.mkdirSync(path.join(d, path.dirname(VERSION_FILE)), { recursive: true });
    fs.writeFileSync(path.join(d, REG), 'a\n');
    fs.writeFileSync(path.join(d, VERSION_FILE), '{"version":"0.1.0"}\n');
    g('add', '.');
    g('commit', '-qm', 'base');
    g('checkout', '-qb', 'feat');
    return d;
  }
  const run = (d: string) =>
    spawnSync(tsx, [script, '--base', 'main'], { cwd: d, encoding: 'utf-8' });
  const commit = (d: string) => {
    execFileSync('git', ['add', '.'], { cwd: d });
    execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'x'], { cwd: d });
  };

  it('rejects a template edit without a bump, accepts it with one', () => {
    const d = repo();
    fs.writeFileSync(path.join(d, REG), 'b\n');
    commit(d);
    expect(run(d).status).toBe(VIOLATION_EXIT_CODE);
    fs.writeFileSync(path.join(d, VERSION_FILE), '{"version":"0.1.1"}\n');
    commit(d);
    expect(run(d).status).toBe(0);
  });

  it('exits 2 (not a pass) when the base cannot be resolved', () => {
    const d = repo();
    const r = spawnSync(tsx, [script, '--base', 'nope'], { cwd: d, encoding: 'utf-8' });
    expect(r.status).toBe(2);
  });

  it('--head checks the named ref, not HEAD', () => {
    const d = repo();
    fs.writeFileSync(path.join(d, REG), 'b\n');
    commit(d);
    const bad = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: d, encoding: 'utf-8' }).trim();
    fs.writeFileSync(path.join(d, VERSION_FILE), '{"version":"0.1.1"}\n');
    commit(d);
    expect(run(d).status).toBe(0);
    expect(spawnSync(tsx, [script, '--base', 'main', '--head', bad], { cwd: d, encoding: 'utf-8' }).status).toBe(
      VIOLATION_EXIT_CODE,
    );
  });

  it('tries origin/main first, falls back to main', () => {
    const d = repo();
    const g = (...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...a], { cwd: d, encoding: 'utf-8' });
    const baseSha = g('rev-parse', 'main').trim();
    fs.writeFileSync(path.join(d, REG), 'b\n');
    commit(d);
    const noBase = () => spawnSync(tsx, [script], { cwd: d, encoding: 'utf-8' });
    // No origin/main: falls back to local main (= base) => the unbumped edit is a violation.
    expect(noBase().status).toBe(VIOLATION_EXIT_CODE);
    // origin/main at the base, local main moved onto the tip: origin/main must win => violation.
    g('update-ref', 'refs/remotes/origin/main', baseSha);
    g('branch', '-f', 'main', 'HEAD');
    expect(noBase().status).toBe(VIOLATION_EXIT_CODE);
    // Control: if main had won the diff would be empty (ok). Prove it by removing origin/main.
    g('update-ref', '-d', 'refs/remotes/origin/main');
    expect(noBase().status).toBe(0);
  });
});

describe('.githooks/pre-push template gate (T0)', () => {
  const hookSrc = path.join(process.cwd(), '.githooks', 'pre-push');
  const zero = '0'.repeat(40);

  function hookRepo(withNodeModules = true): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tvb-hook-'));
    const g = (...a: string[]) =>
      execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...a], { cwd: d, stdio: 'pipe' });
    for (const f of ['.githooks/pre-push', 'scripts/check-template-version-bump.ts', 'scripts/lib/template-version-bump.ts']) {
      fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
      fs.copyFileSync(path.join(process.cwd(), f), path.join(d, f));
    }
    if (withNodeModules) fs.symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(d, 'node_modules'));
    fs.mkdirSync(path.dirname(path.join(d, REG)), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(d, VERSION_FILE)), { recursive: true });
    fs.writeFileSync(path.join(d, REG), 'a\n');
    fs.writeFileSync(path.join(d, VERSION_FILE), '{"version":"0.1.0"}\n');
    fs.writeFileSync(path.join(d, '.gitignore'), 'node_modules\n');
    g('init', '-q', '-b', 'main');
    g('add', '.');
    g('commit', '-qm', 'base');
    g('checkout', '-qb', 'feat');
    return d;
  }
  const sha = (d: string, ref = 'HEAD') => execFileSync('git', ['rev-parse', ref], { cwd: d, encoding: 'utf-8' }).trim();
  const push = (d: string, stdin: string) =>
    spawnSync('bash', [path.join(d, '.githooks', 'pre-push'), 'origin', 'https://example.invalid/x.git'], {
      cwd: d,
      input: stdin,
      encoding: 'utf-8',
    });
  const edit = (d: string, bump: boolean) => {
    fs.writeFileSync(path.join(d, REG), 'b\n');
    if (bump) fs.writeFileSync(path.join(d, VERSION_FILE), '{"version":"0.1.1"}\n');
    execFileSync('git', ['add', '.'], { cwd: d });
    execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'x'], { cwd: d });
  };

  it('blocks only on a proven violation', () => {
    const d = hookRepo(true);
    edit(d, false);
    const r = push(d, `refs/heads/feat ${sha(d)} refs/heads/feat ${zero}\n`);
    expect(r.status).toBe(1);
  });

  it('judges the pushed sha, not HEAD', () => {
    const d = hookRepo(true);
    edit(d, false);
    const bad = sha(d);
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: d });
    // HEAD (main) is clean, but the pushed sha is the violating one.
    expect(push(d, `refs/heads/feat ${bad} refs/heads/feat ${zero}\n`).status).toBe(1);
  });

  it('does not block a deletion push', () => {
    const d = hookRepo(true);
    edit(d, false);
    expect(push(d, `(delete) ${zero} refs/heads/feat ${sha(d)}\n`).status).toBe(0);
  });

  it('allows a bumped edit', () => {
    const d = hookRepo(true);
    edit(d, true);
    expect(push(d, `refs/heads/feat ${sha(d)} refs/heads/feat ${zero}\n`).status).toBe(0);
  });

  it('does NOT block when the check crashes on load (tsx/npx exit 1) - warns instead', () => {
    const d = hookRepo(true);
    fs.writeFileSync(path.join(d, 'scripts', 'lib', 'template-version-bump.ts'), 'this is not ( valid');
    edit(d, false);
    const r = push(d, `refs/heads/feat ${sha(d)} refs/heads/feat ${zero}\n`);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/NOT blocking/);
  });

  it('does NOT block when the check cannot determine (exit 2, no base ref)', () => {
    const d = hookRepo(true);
    edit(d, false);
    execFileSync('git', ['branch', '-m', 'main', 'trunk'], { cwd: d });
    const r = push(d, `refs/heads/feat ${sha(d)} refs/heads/feat ${zero}\n`);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/NOT blocking/);
  });

  it('hardcodes the same violation code as the library', () => {
    expect(fs.readFileSync(hookSrc, 'utf-8')).toContain(`"$rc" = "${VIOLATION_EXIT_CODE}"`);
  });
});
