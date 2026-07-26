/**
 * SPEC-044 Slice 1 — T0/T1: issue-lease.sh pure claim seams (`--classify-claim`,
 * `--is-live`). These are the safety-critical, unit-testable core of the work-item
 * claim lease — NO gh/git/claude, driven by fixture inputs (same convention as
 * remediate-pr-classify.test.ts). They assert:
 *   • INV-1 exactly-one-owner: across N racers exactly ONE gets `own`.
 *   • FR-2/AC-9 deterministic winner: earliest serverOrder → sessionId; claimedAt is
 *     NEVER a key.
 *   • INV-6 fail-toward-not-double-working: enum_complete=0 / unparseable ⇒ stand-down.
 *   • INV-2/FR-8/FR-12: live before TTL, reclaimable after (stale / same-machine dead
 *     pid); foreign host judged by TTL alone; a live-but-hung owner past ABS_MAX is
 *     force-expired despite a live pid.
 */
import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const SCRIPT = path.resolve(__dirname, '../../../scripts/lib/issue-lease.sh');
const HOST = os.hostname();
const NOW = Math.floor(Date.now() / 1000);

function iso(offsetSec = 0): string {
  return new Date((NOW + offsetSec) * 1000).toISOString().replace(/\.\d+Z$/, '.000Z');
}

/** A pid that is (almost certainly) dead — same technique as presence-sync-parity. */
function deadPid(): number {
  for (let p = 4_000_000; p < 4_000_050; p++) {
    try {
      process.kill(p, 0);
    } catch (e: any) {
      if (e?.code === 'ESRCH') return p;
    }
  }
  return 3_999_999;
}

interface ClaimFixture {
  sessionId: string;
  host?: string;
  worktreeRoot?: string;
  pid?: number;
  claimedAt?: string;
  lastRenewed?: string;
  serverOrder: number;
}

function claim(f: ClaimFixture) {
  return {
    sessionId: f.sessionId,
    host: f.host ?? HOST,
    worktreeRoot: f.worktreeRoot ?? '/w',
    pid: f.pid ?? process.pid, // alive, owned by the test runner (avoids the EPERM edge)
    claimedAt: f.claimedAt ?? iso(),
    lastRenewed: f.lastRenewed ?? iso(),
    serverOrder: f.serverOrder,
  };
}

/** Run `--classify-claim`; returns { decision, winner }. */
function classify(claims: object[], self: string, complete: 0 | 1, now = NOW): { decision: string; winner: string } {
  const out = execFileSync('bash', [SCRIPT, '--classify-claim', JSON.stringify(claims), self, String(now), String(complete)], {
    encoding: 'utf-8',
  });
  const [decision = '', winner = ''] = out.split('\n');
  return { decision: decision.trim(), winner: winner.trim() };
}

/** Run `--is-live`; returns true iff live (exit 0 / "live"), false on exit 1 / "dead". */
function isLiveSafe(lastRenewed: string, claimedAt: string, pid: number, host: string, selfHost: string, now = NOW): boolean {
  try {
    const out = execFileSync('bash', [SCRIPT, '--is-live', lastRenewed, claimedAt, String(pid), host, selfHost, String(now)], {
      encoding: 'utf-8',
    });
    return out.trim() === 'live';
  } catch {
    return false; // exit 1 ⇒ dead
  }
}

// ── T0 / INV-1: exactly-one-owner across N racers ────────────────────────────
describe('issue-lease --classify-claim: INV-1 exactly-one-owner', () => {
  it('across N live racers, exactly ONE sees `own`, the rest `stand-down`', () => {
    const N = 6;
    const claims = Array.from({ length: N }, (_, i) => claim({ sessionId: `sid-${i}`, serverOrder: 100 + i }));
    let owns = 0;
    for (let i = 0; i < N; i++) {
      const { decision, winner } = classify(claims, `sid-${i}`, 1);
      if (decision === 'own') owns++;
      // The winner is always the same session (earliest serverOrder = sid-0).
      expect(winner).toBe('sid-0');
      expect(decision).toBe(i === 0 ? 'own' : 'stand-down');
    }
    expect(owns, 'exactly one owner').toBe(1);
  });

  it('a loser retracts + stands down; only the winner proceeds (AC-1 seam half)', () => {
    const claims = [claim({ sessionId: 'winner', serverOrder: 10 }), claim({ sessionId: 'loser', serverOrder: 20 })];
    expect(classify(claims, 'winner', 1).decision).toBe('own');
    expect(classify(claims, 'loser', 1).decision).toBe('stand-down');
  });
});

// ── T1 / AC-9: deterministic winner truth table ──────────────────────────────
describe('issue-lease --classify-claim: FR-2/AC-9 winner truth table', () => {
  it('no claim (complete) ⇒ `claim`, winner = self', () => {
    expect(classify([], 'sid-A', 1)).toEqual({ decision: 'claim', winner: 'sid-A' });
  });

  it('live self only ⇒ `own`', () => {
    expect(classify([claim({ sessionId: 'sid-A', serverOrder: 5 })], 'sid-A', 1).decision).toBe('own');
  });

  it('live non-self only ⇒ `stand-down`, winner = that session', () => {
    const { decision, winner } = classify([claim({ sessionId: 'sid-B', serverOrder: 5 })], 'sid-A', 1);
    expect(decision).toBe('stand-down');
    expect(winner).toBe('sid-B');
  });

  it('stale non-self + live self ⇒ `own` (stale filtered out)', () => {
    const claims = [
      claim({ sessionId: 'sid-STALE', serverOrder: 1, lastRenewed: iso(-10_000), claimedAt: iso(-10_000) }),
      claim({ sessionId: 'sid-A', serverOrder: 100 }),
    ];
    expect(classify(claims, 'sid-A', 1).decision).toBe('own');
  });

  it('earliest serverOrder wins regardless of array order', () => {
    const claims = [claim({ sessionId: 'sid-late', serverOrder: 900 }), claim({ sessionId: 'sid-early', serverOrder: 3 })];
    expect(classify(claims, 'sid-early', 1)).toEqual({ decision: 'own', winner: 'sid-early' });
    expect(classify(claims, 'sid-late', 1).decision).toBe('stand-down');
  });

  it('equal serverOrder ⇒ sessionId tiebreak (lexically smallest wins)', () => {
    const claims = [claim({ sessionId: 'sid-B', serverOrder: 7 }), claim({ sessionId: 'sid-A', serverOrder: 7 })];
    expect(classify(claims, 'sid-A', 1)).toEqual({ decision: 'own', winner: 'sid-A' });
    expect(classify(claims, 'sid-B', 1).decision).toBe('stand-down');
  });

  it('claimedAt is NEVER a deciding key — an earlier claimedAt does not beat an earlier serverOrder', () => {
    // sid-B has the OLDER claimedAt (would win if claimedAt decided) but a LATER
    // serverOrder; sid-A (newer claimedAt, earliest serverOrder) must win.
    const claims = [
      claim({ sessionId: 'sid-A', serverOrder: 2, claimedAt: iso(0) }),
      claim({ sessionId: 'sid-B', serverOrder: 9, claimedAt: iso(-30) }),
    ];
    expect(classify(claims, 'sid-A', 1)).toEqual({ decision: 'own', winner: 'sid-A' });
  });

  it('foreign-host live claim (TTL alone) still wins over self', () => {
    const claims = [
      claim({ sessionId: 'sid-remote', host: 'other-host', pid: deadPid(), serverOrder: 1 }),
      claim({ sessionId: 'sid-A', serverOrder: 2 }),
    ];
    // The remote claim is judged live by TTL alone (foreign pid unobservable) and wins.
    expect(classify(claims, 'sid-A', 1)).toEqual({ decision: 'stand-down', winner: 'sid-remote' });
  });
});

// ── T0 / INV-6: fail toward not-double-working ───────────────────────────────
describe('issue-lease --classify-claim: INV-6 stand-down under any doubt', () => {
  it('enum_complete=0 ⇒ stand-down even with a winning self claim', () => {
    const claims = [claim({ sessionId: 'sid-A', serverOrder: 1 })];
    expect(classify(claims, 'sid-A', 0).decision).toBe('stand-down');
  });

  it('unparseable claims_json ⇒ stand-down (never a false `own`)', () => {
    const out = execFileSync('bash', [SCRIPT, '--classify-claim', 'not-json', 'sid-A', String(NOW), '1'], {
      encoding: 'utf-8',
    });
    expect(out.split('\n')[0].trim()).toBe('stand-down');
  });

  it('requires exactly 4 args (usage error otherwise)', () => {
    let code = 0;
    try {
      execFileSync('bash', [SCRIPT, '--classify-claim', '[]', 'sid-A'], { encoding: 'utf-8', stdio: 'pipe' });
    } catch (e: any) {
      code = e.status ?? 1;
    }
    expect(code).toBe(2);
  });
});

// ── T0 / INV-2 / FR-8 / FR-12: liveness + reclaim-on-expiry ──────────────────
describe('issue-lease --is-live: reclaim only on positive expiry', () => {
  it('fresh heartbeat, same host, alive pid ⇒ live', () => {
    expect(isLiveSafe(iso(), iso(), process.pid, HOST, HOST)).toBe(true);
  });

  it('stale heartbeat (past TTL) ⇒ dead (reclaimable)', () => {
    expect(isLiveSafe(iso(-10_000), iso(-10_000), process.pid, HOST, HOST)).toBe(false);
  });

  it('same-machine DEAD pid ⇒ dead (reclaimable)', () => {
    expect(isLiveSafe(iso(), iso(), deadPid(), HOST, HOST)).toBe(false);
  });

  it('foreign host, fresh heartbeat, unobservable pid ⇒ live (TTL alone, safe degrade)', () => {
    expect(isLiveSafe(iso(), iso(), deadPid(), 'other-host', HOST)).toBe(true);
  });

  it('foreign host, stale heartbeat ⇒ dead (reclaims on TTL)', () => {
    expect(isLiveSafe(iso(-10_000), iso(-10_000), 42, 'other-host', HOST)).toBe(false);
  });

  it('AC-3c — a live-but-hung owner past ABS_MAX is force-expired despite a live pid', () => {
    // Fresh heartbeat (renew ticker still alive) + alive pid, but claimedAt older than
    // the ~2h absolute ceiling ⇒ dead. Verifies the wall-clock ceiling, not just TTL.
    const past = -3 * 3600; // 3h > LEASE_ABS_MAX_SECS (7200s)
    expect(isLiveSafe(iso(), iso(past), process.pid, HOST, HOST)).toBe(false);
  });

  it('unparseable heartbeat ⇒ dead', () => {
    expect(isLiveSafe('not-a-date', iso(), process.pid, HOST, HOST)).toBe(false);
  });
});
