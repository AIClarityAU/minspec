/**
 * #3176 review of #3185: the dispatcher says "my own gh read got a 401" by EXIT STATUS
 * (DISPATCH_RC_AUTH_FAILED), to a caller that asks, and only when its OWN first `gh` call
 * (before the claim) was refused. The drain keys on that number and never on output text,
 * because the build agent's prose travels on the same output (#2233).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { drainBaseEnv } from './helpers/drain-env';

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'scripts')) && fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('repo root not found');
}
const ROOT = findRepoRoot();
const DISPATCH = path.join(ROOT, 'scripts', 'dispatch-issue.sh');
const DRAIN = path.join(ROOT, 'scripts', 'drain-inbox.sh');
const constant = (src: string, name: string): number =>
  Number(new RegExp(`^${name}=(\\d+)$`, 'm').exec(src)?.[1]);

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-authfail-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function run(stderr: string, ghRc: number, ask: boolean): { status: number | null; out: string } {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env bash
echo ${JSON.stringify(stderr)} >&2
exit ${ghRc}
`, { mode: 0o755 });
  const env: NodeJS.ProcessEnv = { ...drainBaseEnv(), PATH: `${bin}:${process.env.PATH}`,
    MINSPEC_FRESHNESS_CHECKED: '1', MINSPEC_GH_APP_TOKEN_SCRIPT: path.join(tmp, 'no-such') };
  delete env.MINSPEC_DISPATCH_OUTCOME_STATUS; delete env.MINSPEC_CLAIM_OFF;
  delete env.GH_TOKEN; delete env.GITHUB_TOKEN;
  if (ask) env.MINSPEC_DISPATCH_OUTCOME_STATUS = '1';
  const r = spawnSync('bash', [DISPATCH, '77'], { encoding: 'utf-8', env });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('#3176: dispatch-issue.sh answers an observed 401 on its own issue read by exit status', () => {
  const AUTH = constant(fs.readFileSync(DISPATCH, 'utf-8'), 'DISPATCH_RC_AUTH_FAILED');

  it('the number is shared with the drain, and clear of 0, 1, the other answers and the signal range', () => {
    expect(constant(fs.readFileSync(DRAIN, 'utf-8'), '_DISPATCH_RC_AUTH_FAILED')).toBe(AUTH);
    expect([0, 1, 75, 76]).not.toContain(AUTH);
    expect(AUTH).toBeLessThan(126);
  });

  it('asked, a 401 from gh is the auth-failed status, and gh\'s message is still shown', () => {
    const r = run('HTTP 401: Bad credentials (https://api.github.com/graphql)', 1, true);
    expect(r.status).toBe(AUTH);
    expect(r.out).toContain('HTTP 401: Bad credentials');
  });

  it('NOT asked, the same 401 is the plain failure it always was', () => {
    expect(run('HTTP 401: Bad credentials', 1, false).status).toBe(1);
  });

  it('asked, a gh failure that is not a 401 keeps its own status', () => {
    const r = run('HTTP 500: upstream exploded', 3, true);
    expect(r.status).toBe(3);
  });
});
