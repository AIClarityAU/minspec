/**
 * #3566 — scaffolding a project that is NESTED in another git repo (the e2e
 * fixture under this checkout, or any monorepo subfolder) must not rewrite the
 * enclosing repo's `core.hooksPath` or stage files in its index (constitution
 * invariant 3: blast radius is the opted-in project).
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { generateHarnessFiles, refreshHarnessFiles, isOwnGitRoot } from '../src/lib/scaffold';

const dirs: string[] = [];
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}
function mk(): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nested-iso-')));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('scaffold never touches an enclosing git repo (#3566)', () => {
  it('leaves parent core.hooksPath and index untouched', () => {
    const parent = mk();
    git(parent, 'init', '-q');
    git(parent, 'config', 'core.hooksPath', '.githooks');
    const child = path.join(parent, 'fixture');
    fs.mkdirSync(path.join(child, '.minspec'), { recursive: true });
    fs.writeFileSync(path.join(child, '.minspec', 'config.json'), '{}');

    expect(isOwnGitRoot(child)).toBe(false);
    generateHarnessFiles(child);
    refreshHarnessFiles(child);

    expect(git(parent, 'config', '--local', 'core.hooksPath').trim()).toBe('.githooks');
    expect(git(parent, 'diff', '--cached', '--name-only').trim()).toBe('');
  });

  it('still arms hooksPath in a project that is its own git root', () => {
    const own = mk();
    git(own, 'init', '-q');
    fs.mkdirSync(path.join(own, '.minspec'), { recursive: true });
    fs.writeFileSync(path.join(own, '.minspec', 'config.json'), '{}');
    expect(isOwnGitRoot(own)).toBe(true);
    generateHarnessFiles(own);
    expect(git(own, 'config', '--local', 'core.hooksPath').trim()).toBe('.minspec/hooks');
  });
});
