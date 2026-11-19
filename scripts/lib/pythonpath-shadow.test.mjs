import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findShadowingEntries } from './pythonpath-shadow.mjs';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pyshadow-'));
}

test('clean root has no shadowing entries', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'scripts'));
  assert.deepEqual(findShadowingEntries(d), []);
});

test('Vitest coverage/ directory is flagged', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'coverage'));
  assert.deepEqual(findShadowingEntries(d), [{ module: 'coverage', entry: 'coverage', kind: 'directory' }]);
});

test('coverage.py file is flagged; a FILE named like a dir module is not a directory hit', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'coverage.py'), '');
  fs.writeFileSync(path.join(d, 'pytest'), '');
  assert.deepEqual(findShadowingEntries(d), [{ module: 'coverage', entry: 'coverage.py', kind: 'file' }]);
});
