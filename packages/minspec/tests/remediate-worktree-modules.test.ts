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
const SCRIPT = path.resolve(__dirname, '../../../scripts/remediate-pr.sh');

function fixture(npmBody: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-modules-'));
  const bin = path.join(dir, 'bin');
  const wt = path.join(dir, 'wt');
  fs.mkdirSync(bin);
  fs.mkdirSync(wt);
  fs.writeFileSync(path.join(bin, 'npm'), `#!/usr/bin/env bash\necho "npm $*" >> "${dir}/calls"\n${npmBody}\n`, { mode: 0o755 });
  return { dir, bin, wt };
}

function run(f: { dir: string; bin: string; wt: string }) {
  return spawnSync('bash', ['-c', `source "${LIB}" && provision_worktree_modules "${f.wt}"`], {
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}` },
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
  });

  it('a successful offline install gives a real, non-symlink node_modules', () => {
    const f = fixture(INSTALL_OK);
    const r = run(f);
    expect(r.status).toBe(0);
    expect(fs.lstatSync(path.join(f.wt, 'node_modules')).isSymbolicLink()).toBe(false);
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
