/**
 * T3 — remediation worktrees get their OWN node_modules (#3238).
 *
 * remediate-pr.sh built /tmp/minspec-remediate/pr-N with a bare `git worktree add` and
 * never installed dependencies. The agent sandbox has no network, so its own `npm ci`
 * failed and every run escalated on the fail-closed validate gate (missing handlebars).
 * Fix: scripts/lib/provision-worktree-modules.sh runs `npm ci --offline` in the worktree,
 * checks the toolchain, and the script skips the agent run when it fails. Never a symlink
 * (#3224: `npm ci` through a symlink emptied the primary's node_modules).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const LIB = path.resolve(__dirname, '../../../scripts/lib/provision-worktree-modules.sh');
const LAUNCH_ENV = path.resolve(__dirname, '../../../scripts/lib/agent-context.sh');
const SCRIPT = path.resolve(__dirname, '../../../scripts/remediate-pr.sh');

function fixture(npmBody: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-modules-'));
  const bin = path.join(dir, 'bin');
  const wt = path.join(dir, 'wt');
  fs.mkdirSync(bin);
  fs.mkdirSync(wt);
  fs.writeFileSync(path.join(bin, 'npm'), `#!/usr/bin/env bash\necho "npm $*" >> "${dir}/calls"\n${npmBody}\n`, { mode: 0o755 });
  writeLock(wt, REGISTRY_LOCK);
  return { dir, bin, wt };
}

// The shape of this repo's own lockfile: registry tarballs plus workspace links.
const REGISTRY_LOCK = {
  name: 't', lockfileVersion: 3, requires: true,
  packages: {
    '': { name: 't', workspaces: ['packages/shared'] },
    'node_modules/handlebars': { version: '4.7.8', resolved: 'https://registry.npmjs.org/handlebars/-/handlebars-4.7.8.tgz' },
    'node_modules/@aiclarity/shared': { resolved: 'packages/shared', link: true },
    'packages/shared': { name: '@aiclarity/shared' },
  },
};

function writeLock(wt: string, lock: unknown) {
  fs.writeFileSync(path.join(wt, 'package-lock.json'), typeof lock === 'string' ? lock : JSON.stringify(lock));
}

function lockWith(name: string, entry: Record<string, unknown>) {
  return { ...REGISTRY_LOCK, packages: { ...REGISTRY_LOCK.packages, [`node_modules/${name}`]: entry } };
}

function run(f: { dir: string; bin: string; wt: string }) {
  return spawnSync('bash', ['-c', `source "${LIB}" && provision_worktree_modules "${f.wt}"`], {
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}`, AGENT_LAUNCH_ENV: LAUNCH_ENV },
  });
}

const INSTALL_OK = `mkdir -p node_modules/.bin node_modules/handlebars
printf '#!/bin/sh\\n' > node_modules/.bin/tsx; chmod +x node_modules/.bin/tsx
echo 'module.exports={}' > node_modules/handlebars/index.js`;

describe('provision_worktree_modules (#3238)', () => {
  it('a failing offline install fails closed and says so', () => {
    const f = fixture('echo "npm ERR! ENOTCACHED" >&2; exit 1');
    const r = run(f);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/node_modules/);
    expect(fs.readFileSync(path.join(f.dir, 'calls'), 'utf-8')).toMatch(/ci .*--offline/);
    // The tree is an untrusted PR branch: none of its lifecycle scripts may run here.
    expect(fs.readFileSync(path.join(f.dir, 'calls'), 'utf-8')).toMatch(/--ignore-scripts/);
  });

  it('a successful offline install gives a real, non-symlink node_modules', () => {
    const f = fixture(INSTALL_OK);
    const r = run(f);
    expect(r.status).toBe(0);
    expect(fs.lstatSync(path.join(f.wt, 'node_modules')).isSymbolicLink()).toBe(false);
  });

  it('with no scrubbed-environment launcher it installs nothing and fails closed', () => {
    const f = fixture(INSTALL_OK);
    const r = spawnSync('bash', ['-c', `source "${LIB}" && unset AGENT_LAUNCH_ENV && provision_worktree_modules "${f.wt}"`], {
      encoding: 'utf-8',
      env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}` },
    });
    expect(r.status).not.toBe(0);
    expect(fs.existsSync(path.join(f.dir, 'calls'))).toBe(false);
  });

  it('an install that exits 0 but leaves no usable toolchain still fails closed', () => {
    const f = fixture('mkdir -p node_modules');
    expect(run(f).status).not.toBe(0);
  });

  it('refuses a node_modules symlink and never runs npm through it', () => {
    const f = fixture(INSTALL_OK);
    const shared = path.join(f.dir, 'shared');
    fs.mkdirSync(shared);
    fs.symlinkSync(shared, path.join(f.wt, 'node_modules'));
    const r = run(f);
    expect(r.status).not.toBe(0);
    expect(fs.existsSync(path.join(f.dir, 'calls'))).toBe(false);
  });
});

// npm reads a .npmrc committed in the tree and fetches any `resolved` URL the lockfile
// names. --offline and --ignore-scripts stop neither: measured with npm 10.9.9, a tree's
// `.npmrc` line `git=<path>` plus a git dependency made `npm ci --offline --ignore-scripts`
// execute <path> (`<path> --no-replace-objects ls-remote https://...`). So the tree's npm
// configuration and its non-registry sources are refused before npm is started.
describe('provision_worktree_modules refuses tree-controlled npm configuration (security)', () => {
  const refusedWithoutNpm = (f: { dir: string }, r: ReturnType<typeof run>, why: RegExp) => {
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(why);
    expect(fs.existsSync(path.join(f.dir, 'calls'))).toBe(false);
  };

  it('refuses a worktree that carries its own .npmrc', () => {
    const f = fixture(INSTALL_OK);
    fs.writeFileSync(path.join(f.wt, '.npmrc'), 'git=./evil.sh\n');
    refusedWithoutNpm(f, run(f), /\.npmrc/);
  });

  it('refuses a worktree that carries npm-shrinkwrap.json, which npm ci prefers over the vetted lockfile', () => {
    const f = fixture(INSTALL_OK);
    fs.writeFileSync(path.join(f.wt, 'npm-shrinkwrap.json'), JSON.stringify(lockWith('evil', { version: '1.0.0', resolved: 'git+https://x/y.git' })));
    refusedWithoutNpm(f, run(f), /npm-shrinkwrap\.json/);
  });

  it('refuses a .npmrc that is a dangling symlink', () => {
    const f = fixture(INSTALL_OK);
    fs.symlinkSync(path.join(f.dir, 'nowhere'), path.join(f.wt, '.npmrc'));
    refusedWithoutNpm(f, run(f), /\.npmrc/);
  });

  it.each([
    ['git+ssh://git@example.invalid/x.git#0123456789abcdef0123456789abcdef01234567'],
    ['git+https://github.com/x/y.git#0123456789abcdef0123456789abcdef01234567'],
    ['https://example.invalid/evil-1.0.0.tgz'],
    ['http://registry.npmjs.org/evil/-/evil-1.0.0.tgz'],
    ['https://registry.npmjs.org.example.invalid/evil/-/evil-1.0.0.tgz'],
    ['file:../evil.tgz'],
  ])('refuses a lockfile entry resolved from %s', (resolved) => {
    const f = fixture(INSTALL_OK);
    writeLock(f.wt, lockWith('evil', { version: '1.0.0', resolved }));
    refusedWithoutNpm(f, run(f), /resolved|registry/);
  });

  it('refuses a dependency with no resolved source (npm would fall back to the package.json spec)', () => {
    const f = fixture(INSTALL_OK);
    writeLock(f.wt, lockWith('evil', { version: '1.0.0' }));
    refusedWithoutNpm(f, run(f), /resolved|registry/);
  });

  it.each([['/etc'], ['../outside'], ['packages/../../outside']])('refuses a workspace link that leaves the tree (%s)', (resolved) => {
    const f = fixture(INSTALL_OK);
    writeLock(f.wt, lockWith('evil', { resolved, link: true }));
    refusedWithoutNpm(f, run(f), /resolved|registry/);
  });

  it.each([
    ['missing', null],
    ['unparseable', '{not json'],
    ['a version-1 lockfile with no packages map', { name: 't', lockfileVersion: 1, dependencies: {} }],
  ])('fails closed when the lockfile is %s', (_label, lock) => {
    const f = fixture(INSTALL_OK);
    if (lock === null) fs.rmSync(path.join(f.wt, 'package-lock.json'));
    else writeLock(f.wt, lock);
    refusedWithoutNpm(f, run(f), /package-lock\.json/);
  });

  it('installs a registry-only lockfile with workspace links, and tells npm never to run git', () => {
    const f = fixture(INSTALL_OK);
    const r = run(f);
    expect(r.status).toBe(0);
    expect(fs.readFileSync(path.join(f.dir, 'calls'), 'utf-8')).toMatch(/--git=false/);
  });
});

describe('remediate-pr.sh wiring (#3238)', () => {
  const src = fs.readFileSync(SCRIPT, 'utf-8');
  it('provisions the worktree before any agent launch, and skips the run visibly on failure', () => {
    const prov = src.indexOf('provision_worktree_modules "$WORKTREE"');
    const agentCtx = src.indexOf('# ── Agent remediation (review findings OR failing checks)');
    expect(prov).toBeGreaterThan(-1);
    expect(prov).toBeLessThan(agentCtx);
    expect(src).toMatch(/remediation-unrunnable: no node_modules/);
  });
});
