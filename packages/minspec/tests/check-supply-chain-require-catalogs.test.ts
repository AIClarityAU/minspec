/**
 * check-supply-chain.sh — release mode (#2410). SUPPLY_CHAIN_REQUIRE_CATALOGS=1 must
 * fail closed (exit 2) when the catalog dir has no *.json; default mode stays
 * inventory-only (exit 0). Also pins the package:release wiring.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const SCRIPT = path.resolve(__dirname, '../../../scripts/check-supply-chain.sh');
let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-req-'));
  fs.mkdirSync(path.join(tmp, 'empty'));
  fs.mkdirSync(path.join(tmp, 'full'));
  fs.writeFileSync(path.join(tmp, 'full', 'c.json'), '{}');
  // Stand-in scanner: succeeds, writes nothing.
  fs.writeFileSync(path.join(tmp, 'bb'), '#!/bin/sh\nexit 0\n');
  fs.chmodSync(path.join(tmp, 'bb'), 0o755);
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(catalogs: string, extra: NodeJS.ProcessEnv = {}) {
  const r = spawnSync('sh', [SCRIPT], {
    env: {
      PATH: process.env.PATH ?? '',
      HOME: tmp,
      BUMBLEBEE_BIN: path.join(tmp, 'bb'),
      BUMBLEBEE_CATALOGS: path.join(tmp, catalogs),
      BUMBLEBEE_CACHE: path.join(tmp, 'cache'),
      ...extra,
    },
    encoding: 'utf-8',
    cwd: tmp,
  });
  return { status: r.status, stderr: r.stderr ?? '' };
}

describe('SUPPLY_CHAIN_REQUIRE_CATALOGS release mode (#2410)', () => {
  it('empty catalog dir + require switch exits 2', () => {
    const r = run('empty', { SUPPLY_CHAIN_REQUIRE_CATALOGS: '1' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('SUPPLY_CHAIN_REQUIRE_CATALOGS=1');
  });

  it('empty catalog dir without the switch stays inventory-only (exit 0)', () => {
    const r = run('empty');
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('inventory-only run');
  });

  it('populated catalog dir + require switch passes', () => {
    const r = run('full', { SUPPLY_CHAIN_REQUIRE_CATALOGS: '1' });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('0 findings');
  });

  it('package:release fetches then requires catalogs', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'),
    );
    const cmd: string = pkg.scripts['package:release'];
    expect(cmd).toContain('fetch-bumblebee-catalogs.sh');
    expect(cmd).toContain('SUPPLY_CHAIN_REQUIRE_CATALOGS=1');
    expect(cmd.indexOf('fetch-bumblebee-catalogs.sh')).toBeLessThan(cmd.indexOf('SUPPLY_CHAIN_REQUIRE_CATALOGS'));
  });
});
