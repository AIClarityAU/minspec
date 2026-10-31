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
    expect(run(d).status).toBe(1);
    fs.writeFileSync(path.join(d, VERSION_FILE), '{"version":"0.1.1"}\n');
    commit(d);
    expect(run(d).status).toBe(0);
  });

  it('exits 2 (not a pass) when the base cannot be resolved', () => {
    const d = repo();
    const r = spawnSync(tsx, [script, '--base', 'nope'], { cwd: d, encoding: 'utf-8' });
    expect(r.status).toBe(2);
  });
});
