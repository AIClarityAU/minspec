/**
 * #1713 — a build killed at its time bound while the quota window is closed is a QUOTA
 * PAUSE, not a code failure. A `claude -p` that waits out a limit prints no notice, so the
 * drain's text classifier cannot see it; the dispatcher asks the meter and answers by exit
 * status (DISPATCH_RC_QUOTA_PAUSED), which the drain books as a pause, never toward
 * MAX_CONSEC_FAIL.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const ROOT = path.resolve(__dirname, '../../..');
const dispatch = fs.readFileSync(path.join(ROOT, 'scripts', 'dispatch-issue.sh'), 'utf-8');
const drain = fs.readFileSync(path.join(ROOT, 'scripts', 'drain-inbox.sh'), 'utf-8');
const constant = (src: string, name: string): number =>
  Number(new RegExp(`^${name}=(\\d+)$`, 'm').exec(src)?.[1]);

function outcomeOf(status: number): string {
  const fn = drain.match(/^_dispatch_outcome\(\) \{[\s\S]*?^\}/m)![0];
  const consts = ['_DISPATCH_RC_DECLINED', '_DISPATCH_RC_STARTED', '_DISPATCH_RC_QUOTA_PAUSED']
    .map((n) => `${n}=${constant(drain, n)}`).join('\n');
  const r = spawnSync('bash', ['-c', `${consts}\n${fn}\n_dispatch_outcome "$1"`, 'bash', String(status)], { encoding: 'utf-8' });
  return r.stdout;
}

describe('#1713 quota-attributed build timeout', () => {
  const QUOTA = constant(dispatch, 'DISPATCH_RC_QUOTA_PAUSED');

  it('the status is shared with the drain and clear of the other answers and the signal range', () => {
    expect(QUOTA).toBeGreaterThan(0);
    expect(constant(drain, '_DISPATCH_RC_QUOTA_PAUSED')).toBe(QUOTA);
    expect([0, 1, 42, 75, 76, 78, 124, 137]).not.toContain(QUOTA);
    expect(QUOTA).toBeLessThan(126);
  });

  it('the drain reads that status as a quota outcome, not a failure', () => {
    expect(outcomeOf(QUOTA)).toBe('quota');
    expect(outcomeOf(3)).toBe('failed');
    expect(outcomeOf(76)).toBe('started');
  });

  it('the dispatcher reads the build status first, asks the meter, and only a closed window reclassifies', () => {
    const elseAt = dispatch.indexOf('AGENT_RC=$?');
    const crashAt = dispatch.indexOf('#1307 — a CRASH raises the human gate');
    const quotaAt = dispatch.indexOf('    exit_quota_paused\n  fi', elseAt);
    expect(elseAt).toBeGreaterThan(0);
    expect(quotaAt).toBeGreaterThan(elseAt);
    expect(quotaAt).toBeLessThan(crashAt);
    const block = dispatch.slice(elseAt, crashAt).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(block).toContain('"$AGENT_RC" == "124" || "$AGENT_RC" == "137"');
    expect(block).toContain('--quota-cap');
    expect(block).toContain('== closed*');
    // Quota pause keeps readiness: no human gate, no crash stamp.
    expect(block).not.toContain('needs-human-review');
    expect(block).not.toContain('agent-crashed');
    expect(block).toContain('--remove-label "agent-running"');
  });

  it('a blind meter (closed unknown / stale / no-reading) is not a quota witness and keeps the crash path', () => {
    const elseAt = dispatch.indexOf('AGENT_RC=$?');
    const crashAt = dispatch.indexOf('#1307 — a CRASH raises the human gate');
    const cond = dispatch.slice(elseAt, crashAt).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
      .match(/if \[\[ "\$AGENT_RC"[\s\S]*?; then/)![0];
    const run = (verdict: string, rc: number): string => {
      const script = `AGENT_RC=${rc}; SCRIPT_DIR=$T; ${cond.replace(/\$\{SCRIPT_DIR\}\/drain-inbox.sh/, '$T/fake.sh')} echo QUOTA; else echo CRASH; fi`;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-'));
      fs.writeFileSync(path.join(dir, 'fake.sh'), `echo '${verdict}'\nexit ${verdict.startsWith('open') ? 0 : 42}\n`);
      const r = spawnSync('bash', ['-c', script.replace(/\$T/g, dir)], { encoding: 'utf-8' });
      fs.rmSync(dir, { recursive: true, force: true });
      return r.stdout.trim();
    };
    expect(run('closed 7d 95% vs 92.4% ramped; 5h not judged | defer:600 (7d window)', 124)).toBe('QUOTA');
    expect(run('closed unknown | defer:stale (reading is old)', 124)).toBe('CRASH');
    expect(run('closed unknown | defer:no-scratch (mktemp failed)', 137)).toBe('CRASH');
    expect(run('closed 7d unreported; 5h not judged | defer:no-reading (x)', 124)).toBe('CRASH');
    expect(run('open 7d 10%', 124)).toBe('CRASH');
    expect(run('closed 7d 95% vs 92.4% ramped | defer:600', 1)).toBe('CRASH');
  });

  it('the drain pauses the cycle on a quota outcome on both dispatch paths', () => {
    const hits = drain.match(/\[\[ "\$outcome" == "quota" \]\].*saw_quota=1; QUOTA_PAUSE_CAUSE="gate"/g) ?? [];
    expect(hits.length).toBe(2);
  });

  it('the exit trap treats the new status as one only exit_quota_paused may leave on', () => {
    expect(dispatch).toMatch(/"\$rc" == "\$DISPATCH_RC_QUOTA_PAUSED"/);
  });
});
