/**
 * T0 - the drain's spec close-out stage (#1595, Step 0d of a cycle).
 *
 * Drives the real `close_finished_specs` out of `drain-inbox.sh` with a stub producer, so
 * the switch, the arguments and the loud-failure arms are exercised rather than asserted
 * on source text. The producer's own decisions are pinned in `close-finished-specs.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useHostileAmbientDrainKnobs } from './helpers/drain-env';
import { useShellTimeout } from './helpers/shell-timeout';

useHostileAmbientDrainKnobs();
useShellTimeout();

const DRAIN = path.resolve(__dirname, '../../../scripts/drain-inbox.sh');
const content = fs.readFileSync(DRAIN, 'utf-8');

function stageBlock(): string {
  const start = content.indexOf('CLOSEOUT_CMD="${MINSPEC_DRAIN_CLOSEOUT_CMD:-}"');
  const end = content.indexOf('# arm_delegated_spec_merges: Step 0c of a cycle');
  if (start < 0 || end <= start) {
    throw new Error('Could not extract close_finished_specs from drain-inbox.sh: markers moved. Fix the extractor.');
  }
  return content.slice(start, end);
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-closeout-'));
  fs.mkdirSync(path.join(tmp, 'scripts'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(exitCode: number | null, env: Record<string, string> = {}) {
  const argsFile = path.join(tmp, 'args');
  const stub = path.join(tmp, 'stub.sh');
  fs.writeFileSync(stub, `#!/usr/bin/env bash\nprintf '%s\\n' "$PWD" "$@" > ${JSON.stringify(argsFile)}\nexit ${exitCode ?? 0}\n`, { mode: 0o755 });
  const script = [
    'set -euo pipefail',
    `REPO="AIClarityAU/minspec"`,
    `REMEDIATE=${JSON.stringify(path.join(tmp, 'scripts', 'remediate-pr.sh'))}`,
    stageBlock(),
    'close_finished_specs; echo "rc=$?"',
  ].join('\n');
  const r = spawnSync('bash', ['-c', script], {
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', ...(exitCode === null ? {} : { MINSPEC_DRAIN_CLOSEOUT_CMD: stub }), ...env },
  });
  const args = fs.existsSync(argsFile) ? fs.readFileSync(argsFile, 'utf-8').split('\n').filter(Boolean) : undefined;
  return { ...r, args };
}

describe('Step 0d runs the close-out producer in write mode, never fatally', () => {
  it('runs from the cycle\'s repo root with --write and the per-cycle cap', () => {
    const r = run(0);
    expect(r.stdout).toContain('rc=0');
    expect(r.args).toEqual([tmp, '--repo-root', tmp, '--repo', 'AIClarityAU/minspec', '--max', '10', '--write']);
  });

  it('the switch turns it off, and says so', () => {
    const r = run(0, { MINSPEC_DRAIN_CLOSEOUT: '0' });
    expect(r.args).toBeUndefined();
    expect(r.stdout).toContain('spec close-out: off');
  });

  it('a refused run is loud on stderr and does not fail the cycle', () => {
    const r = run(1);
    expect(r.stdout).toContain('rc=0');
    expect(r.stderr).toContain('spec close-out REFUSED');
  });

  it('a mid-write failure is loud on stderr and does not fail the cycle', () => {
    const r = run(2);
    expect(r.stdout).toContain('rc=0');
    expect(r.stderr).toContain('spec close-out FAILED');
  });

  it('an invalid cap is refused loudly, the producer is not run', () => {
    const r = run(0, { MINSPEC_DRAIN_CLOSEOUT_MAX: 'x' });
    expect(r.args).toBeUndefined();
    expect(r.stderr).toContain('not a positive integer');
  });

  it('a missing producer script is loud, and nothing is run', () => {
    const r = run(null);
    expect(r.stdout).toContain('rc=0');
    expect(r.stderr).toContain('spec close-out NOT run: no producer');
  });

  it('run_cycle calls the stage', () => {
    const body = content.slice(content.indexOf('run_cycle() {'));
    expect(body).toMatch(/^\s*close_finished_specs\s*$/m);
  });
});
