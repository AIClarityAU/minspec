import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
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

const HAS_PYTHON = spawnSync('python3', ['--version'], { stdio: 'ignore' }).status === 0;

test('pythonModuleInstalled: stdlib yes, nonsense no', { skip: !HAS_PYTHON && 'python3 not installed' }, () => {
  assert.equal(pythonModuleInstalled('json'), true);
  assert.equal(pythonModuleInstalled('definitely_not_a_module_xyz'), false);
});

test('pythonModuleInstalled probe keeps user site-packages: no -I, no PYTHONPATH, cwd /', () => {
  const prev = process.env.PYTHONPATH;
  process.env.PYTHONPATH = '/some/workspace/root';
  try {
    let seen;
    const fake = (cmd, args, opts) => {
      seen = { cmd, args, opts };
      return { status: 0 };
    };
    assert.equal(pythonModuleInstalled('coverage', fake), true);
    assert.equal(seen.cmd, 'python3');
    assert.ok(!seen.args.includes('-I'), '-I would hide user site-packages');
    assert.ok(!('PYTHONPATH' in seen.opts.env), 'PYTHONPATH must be removed from the probe env');
    assert.equal(seen.opts.cwd, '/');
    assert.equal(pythonModuleInstalled('coverage', () => ({ status: 1 })), false);
  } finally {
    if (prev === undefined) delete process.env.PYTHONPATH;
    else process.env.PYTHONPATH = prev;
  }
});

// #1185 scope: the runnability scan covers THIS repo's root only. Build a throwaway
// workspace mirroring the checker's layout and run the real script in it. A
// `coverage.py` FILE always shadows regardless of what python has installed, so the
// outcome does not depend on the host's python.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let picomatchDir = null;
try {
  picomatchDir = path.dirname(path.dirname(createRequire(import.meta.url).resolve('picomatch')));
} catch {
  /* picomatch not resolvable: the end-to-end test below is skipped */
}

function runChecker(shadowIn) {
  const ws = tmp();
  const repo = path.join(ws, 'MinSpecPro');
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.cpSync(path.join(REPO, 'scripts', 'lib'), path.join(repo, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(
    path.join(REPO, 'scripts', 'check-testing-panel-discovery.mjs'),
    path.join(repo, 'scripts', 'check-testing-panel-discovery.mjs'),
  );
  fs.cpSync(path.join(REPO, '.vscode'), path.join(repo, '.vscode'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(repo, 'package.json'));
  fs.mkdirSync(path.join(repo, '.github', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.github', 'scripts', 'ai-review-guard.test.js'), "import 'node:test';\n");
  fs.symlinkSync(picomatchDir, path.join(repo, 'node_modules'));
  const target = shadowIn === 'repo' ? repo : path.join(ws, shadowIn);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'coverage.py'), '');
  return spawnSync('node', ['scripts/check-testing-panel-discovery.mjs'], { cwd: repo, encoding: 'utf8' });
}

test('checker: shadow in a SIBLING repo does not fail; same shadow in THIS repo does', { skip: !picomatchDir && 'picomatch not resolvable' }, () => {
  const sibling = runChecker('sealbox');
  assert.equal(sibling.status, 0, sibling.stdout + sibling.stderr);
  const own = runChecker('repo');
  assert.equal(own.status, 1, own.stdout + own.stderr);
  assert.match(own.stdout, /coverage\.py shadows python module "coverage"/);
});
