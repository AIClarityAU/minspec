/**
 * T1/T2 — drain-inbox.sh continuous-loop seams (#239 + #609).
 *
 * The session-scoped continuous drain is a shell change; its decision logic is
 * exposed as PURE CLI seams (no gh/git/claude) so it is unit-testable in isolation
 * — same convention as dispatch-ready-check.test.ts / dispatch-escalate-retry.test.ts.
 * These assert the two safety-critical properties:
 *   • the loop dies WITH the session (session-alive / should-continue), and
 *   • a Claude usage-limit signal is classified as quota (backoff, not death).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const DRAIN = path.resolve(__dirname, '../../../scripts/drain-inbox.sh');
const DRAIN_SRC = fs.readFileSync(DRAIN, 'utf-8');

function run(args: string[], input?: string): { code: number; out: string } {
  try {
    const out = execFileSync('bash', [DRAIN, ...args], { input, encoding: 'utf-8' });
    return { code: 0, out: out.trim() };
  } catch (e: any) {
    return { code: e.status ?? 1, out: (((e.stdout ?? '') as string) + ((e.stderr ?? '') as string)).trim() };
  }
}

// A pid that is (essentially) never a live process — probes the "session gone" path.
const DEAD_PID = '2147483646';
const nowSec = () => Math.floor(Date.now() / 1000);

describe('drain-inbox.sh — session-lifetime seam (#239: loop dies with the session)', () => {
  it('--session-alive: exit 0 for a live pid, exit 1 for a dead pid', () => {
    expect(run(['--session-alive', String(process.pid)]).code).toBe(0);
    expect(run(['--session-alive', DEAD_PID]).code).toBe(1);
  });

  it('--should-continue: continues while the session is alive and before the cap', () => {
    const r = run(['--should-continue', String(process.pid), String(nowSec() + 3600)]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('continue');
  });

  it('--should-continue: stops once past the MAX_LIFETIME cap (backstop)', () => {
    const r = run(['--should-continue', String(process.pid), String(nowSec() - 10)]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/max-lifetime/i);
  });

  it('--should-continue: stops when the session pid is gone (the load-bearing tie)', () => {
    const r = run(['--should-continue', DEAD_PID, String(nowSec() + 3600)]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/ended/i);
  });

  it('--resolve-session-pid: prints a numeric anchor pid (falls back to PPID off-session)', () => {
    expect(run(['--resolve-session-pid']).out).toMatch(/^\d+$/);
  });
});

describe('drain-inbox.sh — quota classifier seam (#609: pause, do not die)', () => {
  it('--is-quota: exit 0 on a usage-limit signal, exit 1 on ordinary output', () => {
    // Reuses ai-review-guard.js isQuotaExhaustion — the SAME classifier review-branch.sh
    // uses, so bash and JS never drift on what a session-limit signal is.
    expect(run(['--is-quota'], "You've hit your session limit · resets 10:30am (UTC)").code).toBe(0);
    expect(run(['--is-quota'], 'Fixed the off-by-one in the tier classifier; added a regression test.').code).toBe(1);
  });
});

describe('drain-inbox.sh — single-instance lock records the LOOP pid, not the dead parent (#676)', () => {
  it('writes $BASHPID (the loop subshell) to the lock, never the parent $$', () => {
    // In `( … ) &`, $$ stays the PARENT pid — which exits right after `disown`, so a
    // $$-lock is dead-on-arrival and the stale-lock reclaim spawns duplicate loops
    // (double-dispatch / quota abuse). ai-review #676 BLOCKING/HIGH.
    expect(DRAIN_SRC, 'lock must be written from $BASHPID').toMatch(/echo\s+"\$BASHPID"\s*>\s*"\$LOCK"/);
    expect(DRAIN_SRC, 'lock must NOT be written from $$').not.toMatch(/echo\s+"\$\$"\s*>\s*"\$LOCK"/);
  });

  it('bash semantics: $BASHPID differs from $$ inside a backgrounded subshell (why the fix is needed)', () => {
    const out = execFileSync('bash', ['-c', '( echo "$$ $BASHPID" ) & wait'], { encoding: 'utf-8' }).trim();
    const [dollarDollar, bashpid] = out.split(/\s+/);
    expect(bashpid).not.toBe(dollarDollar); // $$ = inherited parent pid; $BASHPID = the subshell's own
  });
});
