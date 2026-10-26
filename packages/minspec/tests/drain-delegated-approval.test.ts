/**
 * T0 - the drain's delegated-approval stage (#2981, DR-108, Step 0b of a cycle).
 *
 * Drives the real `record_delegated_approvals` out of `drain-inbox.sh` with a stub
 * caller, so the switch, the arguments and the loud-failure arms are exercised rather
 * than asserted on source text. The caller's own decisions are pinned in
 * `delegated-approval-caller.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useHostileAmbientDrainKnobs } from './helpers/drain-env';
import { useShellTimeout } from './helpers/shell-timeout';

// Module scope (#2574). The stage runs with an explicit env below, so ambient knobs
// cannot reach it; primed anyway so the scrub gate holds for every drain test file.
useHostileAmbientDrainKnobs();
useShellTimeout();

const DRAIN = path.resolve(__dirname, '../../../scripts/drain-inbox.sh');
const content = fs.readFileSync(DRAIN, 'utf-8');

function stageBlock(): string {
  const start = content.indexOf('DELEGATED_APPROVAL_CMD="${MINSPEC_DRAIN_DELEGATED_APPROVAL_CMD:-}"');
  const end = content.indexOf('# sweep_open_prs: Step 3 of a cycle.');
  if (start < 0 || end <= start) {
    throw new Error('Could not extract record_delegated_approvals from drain-inbox.sh: markers moved. Fix the extractor.');
  }
  return content.slice(start, end);
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-dlg-'));
  fs.mkdirSync(path.join(tmp, 'scripts'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(exitCode: number, env: Record<string, string> = {}) {
  const argsFile = path.join(tmp, 'args');
  const stub = path.join(tmp, 'stub.sh');
  fs.writeFileSync(stub, `#!/usr/bin/env bash\nprintf '%s\\n' "$PWD" "$@" > ${JSON.stringify(argsFile)}\nexit ${exitCode}\n`, { mode: 0o755 });
  const script = [
    'set -euo pipefail',
    `REPO="AIClarityAU/minspec"`,
    `REMEDIATE=${JSON.stringify(path.join(tmp, 'scripts', 'remediate-pr.sh'))}`,
    stageBlock(),
    'record_delegated_approvals; echo "rc=$?"',
  ].join('\n');
  const r = spawnSync('bash', ['-c', script], {
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', MINSPEC_DRAIN_DELEGATED_APPROVAL_CMD: stub, ...env },
  });
  const args = fs.existsSync(argsFile) ? fs.readFileSync(argsFile, 'utf-8').split('\n').filter(Boolean) : undefined;
  return { ...r, args };
}

describe('Step 0b runs the caller in write mode, never fatally', () => {
  it('runs from the cycle\'s repo root with --write and the per-cycle cap', () => {
    const r = run(0);
    expect(r.stdout).toContain('rc=0');
    expect(r.args).toEqual([tmp, '--repo-root', tmp, '--repo', 'AIClarityAU/minspec', '--max', '5', '--write']);
  });

  it('the switch turns it off, and says so', () => {
    const r = run(0, { MINSPEC_DRAIN_DELEGATED_APPROVAL: '0' });
    expect(r.args).toBeUndefined();
    expect(r.stdout).toContain('delegated approval: off');
  });

  it('a refused run is loud on stderr and does not fail the cycle', () => {
    const r = run(1);
    expect(r.stdout).toContain('rc=0');
    expect(r.stderr).toContain('delegated approval REFUSED');
  });

  it('a mid-write failure is loud on stderr and does not fail the cycle', () => {
    const r = run(2);
    expect(r.stdout).toContain('rc=0');
    expect(r.stderr).toContain('delegated approval FAILED');
  });

  it('an invalid cap is refused loudly, the caller is not run', () => {
    const r = run(0, { MINSPEC_DRAIN_DELEGATED_APPROVAL_MAX: '0' });
    expect(r.args).toBeUndefined();
    expect(r.stderr).toContain('not a positive integer');
  });

  it('a missing caller script is loud, and nothing is run', () => {
    const script = [
      `REPO="AIClarityAU/minspec"`,
      `REMEDIATE=${JSON.stringify(path.join(tmp, 'scripts', 'remediate-pr.sh'))}`,
      stageBlock(),
      'record_delegated_approvals; echo "rc=$?"',
    ].join('\n');
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf-8', env: { PATH: process.env.PATH ?? '' } });
    expect(r.stdout).toContain('rc=0');
    expect(r.stderr).toContain('delegated approval NOT run: no caller');
  });

  it('run_cycle calls the stage', () => {
    const body = content.slice(content.indexOf('run_cycle() {'));
    expect(body).toMatch(/^\s*record_delegated_approvals\s*$/m);
  });
});
