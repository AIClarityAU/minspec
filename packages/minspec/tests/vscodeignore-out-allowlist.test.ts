import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// #1493 — vsce shipped stale tsc output (out/lib, out/commands) next to the bundle.
describe('.vscodeignore ships only the bundle from out/', () => {
  const lines = readFileSync(join(__dirname, '..', '.vscodeignore'), 'utf8')
    .split('\n')
    .map((l) => l.trim());
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

  it('main is the bundle', () => {
    expect(pkg.main).toBe('./out/extension.js');
  });
  it('excludes all of out/ then re-includes only the bundle', () => {
    const excl = lines.indexOf('out/**');
    const incl = lines.indexOf('!out/extension.js');
    expect(excl).toBeGreaterThanOrEqual(0);
    expect(incl).toBeGreaterThan(excl);
    expect(lines.filter((l) => l.startsWith('!out/'))).toEqual(['!out/extension.js']);
  });
});
