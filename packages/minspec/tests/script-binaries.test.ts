/**
 * #979 — a package.json script must not run a binary that no declared dependency provides
 * (e.g. `npx tsx` with `tsx` undeclared resolves over the network: offline-invariant breach,
 * floating gate interpreter). Unit half pins the predicate; T0 half runs the real script.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { findUndeclaredBinaries, leadingBinary } from '../../../scripts/lib/script-binaries';

const REPO_ROOT = process.cwd();
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

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
  it('every script binary in the real package.json is declared', () => {
    if (!fs.existsSync(TSX)) return; // deps not installed in this checkout; script itself fails closed
    const r = spawnSync(TSX, [path.join(REPO_ROOT, 'scripts', 'check-script-binaries.ts')], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    });
    expect(`${r.stdout}${r.stderr}`).toContain('all resolve');
    expect(r.status).toBe(0);
  });
});
