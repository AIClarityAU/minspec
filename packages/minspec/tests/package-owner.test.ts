import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Owner-keyed package.json fields must name the canonical owner (#507):
// the native issue reporter and marketplace links route off them.
const CANONICAL = 'https://github.com/AIClarityAU/minspec';

describe('package.json canonical owner (#507)', () => {
  for (const rel of ['../package.json', '../../extension-pack/package.json']) {
    it(`${rel} repository/bugs point at AIClarityAU`, () => {
      const pkg = JSON.parse(readFileSync(join(__dirname, rel), 'utf8'));
      expect(pkg.repository.url).toBe(CANONICAL);
      if (pkg.bugs) expect(pkg.bugs.url).toBe(`${CANONICAL}/issues`);
    });
  }
});
