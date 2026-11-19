import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findShadowingEntries, pythonModuleInstalled } from './pythonpath-shadow.mjs';

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

test('coverage/ directory is harmless when the real module is installed', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'coverage'));
  assert.deepEqual(findShadowingEntries(d, undefined, () => true), []);
});

test('installed module does not excuse a .py file or a dir with __init__.py', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'coverage.py'), '');
  fs.mkdirSync(path.join(d, 'pytest'));
  fs.writeFileSync(path.join(d, 'pytest', '__init__.py'), '');
  assert.equal(findShadowingEntries(d, undefined, () => true).length, 2);
});

test('pythonModuleInstalled: stdlib yes, nonsense no', () => {
  assert.equal(pythonModuleInstalled('json'), true);
  assert.equal(pythonModuleInstalled('definitely_not_a_module_xyz'), false);
});
