/**
 * #979 — a package.json script must not run a binary that no declared dependency provides
 * (e.g. `npx tsx` with `tsx` undeclared resolves over the network: offline-invariant breach,
 * floating gate interpreter). Unit half pins the predicate; T0 half runs the real script.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { checkRepoScriptBinaries, findUndeclaredBinaries, leadingBinary } from '../../../scripts/lib/script-binaries';

const REPO_ROOT = process.cwd();

describe('#979 findUndeclaredBinaries', () => {
  it('flags `npx tsx` when tsx is not declared', () => {
    const r = findUndeclaredBinaries({ validate: 'npx tsx a.ts' }, new Set(['vitest']));
    expect(r.map((x) => x.binary)).toEqual(['tsx']);
  });
  it('passes `npx tsx` when tsx is declared', () => {
    expect(findUndeclaredBinaries({ validate: 'npx tsx a.ts' }, new Set(['tsx']))).toEqual([]);
  });
  it('checks every segment of a compound command', () => {
    const r = findUndeclaredBinaries({ x: 'npm run a && rimraf dist | cat' }, new Set());
    expect(r.map((x) => x.binary)).toEqual(['rimraf']);
  });
  it('ignores env assignments, flags after npx, paths and platform tools', () => {
    expect(leadingBinary('FOO=1 npx -y tsx a.ts')).toBe('tsx');
    expect(leadingBinary('./run.sh')).toBeNull();
    expect(findUndeclaredBinaries({ a: 'node x.mjs && bash y.sh' }, new Set())).toEqual([]);
  });
});

describe('#979 repo scripts (T0)', () => {
  // In-process, no `tsx` spawn: a witness that needed tsx to run could not see tsx removed
  // (the earlier `if (!existsSync(tsx)) return;` passed silently in exactly that case).
  it('every script binary in the real ROOT package.json is declared and installed (workspace manifests are out of scope)', () => {
    const r = checkRepoScriptBinaries(REPO_ROOT);
    expect(r.errors).toEqual([]);
    expect(r.scriptCount).toBeGreaterThan(0);
  });

  function fixture(pkg: object, installed: Record<string, object>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'script-binaries-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
    for (const [name, manifest] of Object.entries(installed)) {
      fs.mkdirSync(path.join(root, 'node_modules', name), { recursive: true });
      fs.writeFileSync(path.join(root, 'node_modules', name, 'package.json'), JSON.stringify(manifest));
    }
    return root;
  }

  it('fails when tsx is removed from devDependencies but a script still runs `npx tsx`', () => {
    const root = fixture({ scripts: { validate: 'npx tsx a.ts' }, devDependencies: {} }, {});
    const r = checkRepoScriptBinaries(root);
    expect(r.errors.join('\n')).toContain('"tsx"');
  });

  it('fails closed when a declared package is not installed', () => {
    const root = fixture({ scripts: { validate: 'npx tsx a.ts' }, devDependencies: { tsx: '^4' } }, {});
    expect(checkRepoScriptBinaries(root).errors.join('\n')).toContain('not installed');
  });

  it('fails closed when package.json is missing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'script-binaries-'));
    expect(checkRepoScriptBinaries(root).errors.join('\n')).toContain('not found');
  });

  it('passes when the binary comes from an installed declared package', () => {
    const root = fixture(
      { scripts: { validate: 'npx tsx a.ts' }, devDependencies: { tsx: '^4' } },
      { tsx: { name: 'tsx', bin: { tsx: 'dist/cli.mjs' } } },
    );
    expect(checkRepoScriptBinaries(root).errors).toEqual([]);
  });
});
