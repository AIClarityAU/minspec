/**
 * #2217 — the npm-10-arborist-crash preinstall gate.
 *
 * On npm 10.9.8, `npm install` crashes inside `@npmcli/arborist`
 * ("Cannot read properties of null (reading 'edgesOut')") because of
 * vitest's reciprocal peer pin on `@vitest/coverage-v8`. npm 11 doesn't
 * have the bug. `scripts/check-npm-toolchain.mjs` runs as `preinstall` —
 * before npm resolves the tree — so the crash becomes a clear message
 * naming npm 11 as the fix, instead of an arborist stack trace with no
 * pointer to the cause.
 *
 * `npm ci` is deliberately exempt: it doesn't hit the bug, and every CI
 * workflow in this repo runs `npm ci` exclusively — gating it too would
 * fail CI on whatever npm Node 22 happens to bundle, for no benefit.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  REQUIRED_NPM_MAJOR,
  parseNpmMajor,
  checkNpmToolchain,
  formatReport,
} from '../../../scripts/check-npm-toolchain.mjs';

const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'check-npm-toolchain.mjs');

describe('scripts/check-npm-toolchain.mjs — parseNpmMajor', () => {
  it('reads the major version out of a real npm user-agent string', () => {
    expect(parseNpmMajor('npm/11.0.2 node/v22.23.2 linux x64 workspaces/false')).toBe(11);
    expect(parseNpmMajor('npm/10.9.8 node/v22.23.2 linux x64 workspaces/false')).toBe(10);
  });

  it('returns null for a missing or unparseable user-agent', () => {
    expect(parseNpmMajor(undefined)).toBeNull();
    expect(parseNpmMajor('')).toBeNull();
    expect(parseNpmMajor('yarn/1.22.19 npm-user-agent-lookalike')).toBeNull();
    expect(parseNpmMajor('some unrelated string')).toBeNull();
  });
});

describe('scripts/check-npm-toolchain.mjs — checkNpmToolchain (pure verdict)', () => {
  it('fails closed on npm 10 for a plain install', () => {
    const result = checkNpmToolchain({
      npm_command: 'install',
      npm_config_user_agent: 'npm/10.9.8 node/v22.23.2 linux x64 workspaces/false',
    });
    expect(result.ok).toBe(false);
    expect(result.npmMajor).toBe(10);
  });

  it('fails closed on npm 10 for audit fix, update, uninstall, dedupe — not just install', () => {
    for (const npm_command of ['audit', 'update', 'uninstall', 'dedupe']) {
      const result = checkNpmToolchain({
        npm_command,
        npm_config_user_agent: 'npm/10.9.8 node/v22.23.2 linux x64 workspaces/false',
      });
      expect(result.ok).toBe(false);
    }
  });

  it('passes on npm 11+ for a plain install', () => {
    const result = checkNpmToolchain({
      npm_command: 'install',
      npm_config_user_agent: 'npm/11.0.2 node/v22.23.2 linux x64 workspaces/false',
    });
    expect(result.ok).toBe(true);
    expect(result.npmMajor).toBe(11);
  });

  it('exempts npm ci even on npm 10 — npm ci does not hit the arborist bug', () => {
    const result = checkNpmToolchain({
      npm_command: 'ci',
      npm_config_user_agent: 'npm/10.9.8 node/v22.23.2 linux x64 workspaces/false',
    });
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('npm-ci-exempt');
  });

  it('fails open when the npm version cannot be determined', () => {
    const result = checkNpmToolchain({ npm_command: 'install' });
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('npm-version-undetected');
  });

  it(`REQUIRED_NPM_MAJOR is ${REQUIRED_NPM_MAJOR}, matching package.json's engines.npm floor`, () => {
    expect(REQUIRED_NPM_MAJOR).toBe(11);
  });
});

describe('scripts/check-npm-toolchain.mjs — formatReport', () => {
  it('names npm 11 and the npx workaround on failure, and says npm ci is unaffected', () => {
    const report = formatReport({ ok: false, reason: 'npm-too-old', npmMajor: 10 });
    expect(report).toContain('npm 10.x cannot install this lockfile');
    expect(report).toContain('npx npm@11 install');
    expect(report).toContain('npm ci` is unaffected');
  });
});

describe('scripts/check-npm-toolchain.mjs — the preinstall gate, as npm actually runs it', () => {
  function runGate(env: Record<string, string | undefined>) {
    const result = spawnSync('node', [SCRIPT], {
      cwd: path.resolve(__dirname, '..', '..', '..'),
      encoding: 'utf-8',
      env: { ...process.env, ...env },
    });
    if (result.error) throw result.error;
    return { status: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
  }

  it('exits 1 with an actionable message when npm 10 runs a plain install', () => {
    const { status, output } = runGate({
      npm_command: 'install',
      npm_config_user_agent: 'npm/10.9.8 node/v22.23.2 linux x64 workspaces/false',
    });
    expect(status).toBe(1);
    expect(output).toContain('FAIL npm 10.x cannot install this lockfile');
    expect(output).toContain('npx npm@11 install');
  });

  it('exits 0 when npm 11 runs a plain install', () => {
    const { status, output } = runGate({
      npm_command: 'install',
      npm_config_user_agent: 'npm/11.0.2 node/v22.23.2 linux x64 workspaces/false',
    });
    expect(status).toBe(0);
    expect(output).toContain('npm toolchain check passed');
  });

  it('exits 0 for npm ci on npm 10 — the exempt path CI relies on', () => {
    const { status, output } = runGate({
      npm_command: 'ci',
      npm_config_user_agent: 'npm/10.9.8 node/v22.23.2 linux x64 workspaces/false',
    });
    expect(status).toBe(0);
    expect(output).toContain('npm ci` does not hit the npm 10 arborist crash');
  });
});
