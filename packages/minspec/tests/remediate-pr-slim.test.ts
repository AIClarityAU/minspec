/**
 * #927: remediate-pr.sh must pass the role as --system-prompt-file (context-slim,
 * same lever as #912/#925), gated by MINSPEC_DISPATCH_SLIM_CONTEXT, and the role
 * file it points at must exist.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const SCRIPTS = path.resolve(__dirname, '../../../scripts');
const SRC = fs.readFileSync(path.join(SCRIPTS, 'remediate-pr.sh'), 'utf-8');

// The launch line is located by its prompt argument; the gate in agent-launch-sites.test.ts
// forbids naming the CLI itself in any scripts/ file that is not a launch.
const LAUNCH = '-p "$RUN_PROMPT"';

describe('remediate-pr.sh slim context (#927)', () => {
  it('agent launch expands SYS_PROMPT_ARGS', () => {
    const call = SRC.slice(SRC.indexOf(LAUNCH));
    expect(call.slice(0, 600)).toMatch(/SYS_PROMPT_ARGS\[@\]/);
  });

  it('slim context is gated by the kill-switch and uses --system-prompt-file', () => {
    expect(SRC).toMatch(/MINSPEC_DISPATCH_SLIM_CONTEXT:-1\}" != "0"/);
    expect(SRC).toMatch(/SYS_PROMPT_ARGS=\(--system-prompt-file "\$REMEDIATE_ROLE_FILE"\)/);
  });

  it('role file exists and SYS_PROMPT_ARGS is defined before the launch', () => {
    expect(fs.existsSync(path.join(SCRIPTS, 'roles', 'dev.md'))).toBe(true);
    expect(SRC.indexOf(LAUNCH)).toBeGreaterThan(-1);
    expect(SRC.indexOf('SYS_PROMPT_ARGS=()')).toBeGreaterThan(-1);
    expect(SRC.indexOf('SYS_PROMPT_ARGS=()')).toBeLessThan(SRC.indexOf(LAUNCH));
  });
});

describe('#3949: checks_in_flight is age-bounded', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../../scripts/remediate-pr.sh'), 'utf-8');
  const fn = src.slice(src.indexOf('checks_in_flight() {'), src.indexOf('# is_deterministic_drift_log'));
  const call = (rollup: unknown[]) =>
    spawnSync('bash', ['-c', `${fn}\nchecks_in_flight "$1"`, 'x', JSON.stringify({ statusCheckRollup: rollup })], { encoding: 'utf-8' });
  const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString().replace(/\.\d+Z$/, 'Z');

  it('a fresh in-progress check is in flight', () => {
    expect(call([{ name: 'a', status: 'IN_PROGRESS', startedAt: ago(60) }]).stdout.trim()).toBe('yes');
  });
  it('a check in progress for 9 days is not, and is named on stderr', () => {
    const r = call([{ name: 'actionlint', status: 'IN_PROGRESS', startedAt: ago(9 * 86400) }]);
    expect(r.stdout.trim()).toBe('no');
    expect(r.stderr).toContain('Stuck check actionlint');
  });
  it('IN_PROGRESS with a conclusion is inconsistent state, not in flight', () => {
    expect(call([{ name: 'a', status: 'IN_PROGRESS', conclusion: 'SUCCESS', startedAt: ago(60) }]).stdout.trim()).toBe('no');
  });
  it('a queued check with no start time is in flight', () => {
    expect(call([{ name: 'a', status: 'QUEUED' }]).stdout.trim()).toBe('yes');
  });
});
